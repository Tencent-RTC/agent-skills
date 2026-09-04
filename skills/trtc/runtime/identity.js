// identity.js — anonymous useragent management.
//
// Returns `{ useragent, identity_scope }`, identity_scope ∈ 'device'|'ephemeral'.
// See rollout §3 C4 for the locked contract.
//
// Concurrency correctness protocol (invariants verified by test_identity*):
//
//   1. Only ONE process ever writes identity.json for a given stateRoot at a
//      time. Enforced by the real write lock `identity.lock/`.
//
//   2. A stale-cleanup racer is NOT allowed to steal the write lock from an
//      ALIVE holder, even if OWNER's ts is >30s old (the holder may be simply
//      paused). Enforced by a two-step protocol:
//        (a) acquire the cleanup mutex `identity.cleanup.lock/` (mkdir-atomic,
//            with its own short stale sweep)
//        (b) re-read OWNER; if token/ts changed → refuse to clean
//        (c) `process.kill(pid, 0)` liveness check:
//              alive        → refuse to clean
//              dead (ESRCH) → allowed
//              unknown      → refuse (conservative; installer maintenance
//                              will handle in the rare EPERM case)
//        (d) unlink OWNER + rmdir lockDir
//        (e) release cleanup mutex
//      Because (a)–(e) happen while holding the cleanup mutex, two cleaners
//      cannot simultaneously decide the same lock is stale. That closes the
//      TOCTOU window that plain "double-check then unlink" leaves open.
//
//   3. Identity write is tmp → fsync → rename → dir-fsync. Safe under (1)
//      because no other writer can be alive at the same time.
//
//   4. `peekIdentity()` is pure. It never mutates. Only
//      `quarantineCorruptIdentity()` mutates and it is called strictly inside
//      the write lock.
//
//   5. Timeouts use `performance.now()` (monotonic) and clamp `sleepSync`
//      against remaining budget so `maxWaitMs` is honored exactly, not
//      "up to one full backoff late".
//
// Storage roots (never bind to "claude" — Skill is shared across
// Cursor / Codex / Claude Code / CodeBuddy):
//   macOS   ~/Library/Application Support/tencent-rtc-skill/
//   Linux   $XDG_STATE_HOME/tencent-rtc-skill/   or  ~/.local/state/tencent-rtc-skill/
//   Windows %LOCALAPPDATA%\TencentRTC\Skill\
//
// Ephemeral fallback:
//   POSIX   os.tmpdir()/tencent-rtc-skill-<uid>/   (uid isolates users on /tmp)
//   Windows os.tmpdir()/tencent-rtc-skill-ephemeral/
//           (os.tmpdir on Windows is already per-user; NO username read)
//
// Legacy identity acceptance:
//   New IDs are always UUID v4 (crypto.randomUUID). Legacy IDs from prior
//   installs may be in other opaque formats (ua_<hex>, UUID v1, etc.). We
//   accept any string matching /^[A-Za-z0-9._-]{8,128}$/ so existing anonymous
//   IDs survive a reinstall.

import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeSync,
  statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path, { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDENTITY_FILE = 'identity.json';
const LOCK_DIR = 'identity.lock';
const CLEANUP_LOCK_DIR = 'identity.cleanup.lock';
const OWNER_FILE = 'OWNER';

const STALE_LOCK_MS = 30_000;
const LEGACY_CLEANUP_MUTEX_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_LOCK_ATTEMPTS = 100;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9._-]{8,128}$/;

// Sync sleep that yields CPU. Node main thread supports Atomics.wait.
const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(SLEEP_BUF, 0, 0, ms);
}
function backoffMs(attempt) {
  return Math.min(40, 5 * (1 << Math.min(attempt, 4)));
}

// Monotonic clock for deadlines. Never subject to wall-clock jumps.
function monotonicNow() {
  return performance.now();
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveStateRoot(env = process.env, platform = process.platform) {
  // Host integrations may bind a project-isolated state directory directly in
  // the generated Hook/Stop command.  This must take precedence over the
  // device-wide default so a project cannot accidentally write to (or read
  // from) another project's telemetry state.  Only absolute paths are
  // accepted; malformed values fall through to the normal platform resolver.
  const explicit = env?.TRTC_TELEMETRY_STATE_ROOT;
  const explicitIsAbsolute = typeof explicit === 'string' && explicit.length > 0
    && (platform === 'win32' ? path.win32.isAbsolute(explicit) : path.isAbsolute(explicit));
  if (explicitIsAbsolute) return explicit;
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'tencent-rtc-skill');
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    if (local) return path.win32.join(local, 'TencentRTC', 'Skill');
    const profile = env.USERPROFILE || homedir();
    return path.win32.join(profile, 'AppData', 'Local', 'TencentRTC', 'Skill');
  }
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, 'tencent-rtc-skill');
  return join(homedir(), '.local', 'state', 'tencent-rtc-skill');
}

/**
 *   POSIX:   os.tmpdir()/tencent-rtc-skill-<uid>/    (isolates users on shared /tmp)
 *   Windows: os.tmpdir()/tencent-rtc-skill-ephemeral/
 *            (os.tmpdir on Windows is under %LOCALAPPDATA%\Temp or
 *             %USERPROFILE%\AppData\Local\Temp — already per-user; NO username read)
 */
export function resolveEphemeralRoot(platform = process.platform) {
  const base = tmpdir();
  if (platform === 'win32' || typeof process.getuid !== 'function') {
    return join(base, 'tencent-rtc-skill-ephemeral');
  }
  return join(base, `tencent-rtc-skill-${process.getuid()}`);
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function isPosix(platform = process.platform) {
  return platform !== 'win32';
}

function ensureDir(dir, platform = process.platform, opts = {}) {
  const mkdir = typeof opts._mkdirSync === 'function' ? opts._mkdirSync : mkdirSync;
  mkdir(dir, { recursive: true, mode: isPosix(platform) ? 0o700 : undefined });
  if (isPosix(platform)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* SMB/FAT lacks POSIX bits */
    }
  }
}

function fsyncDirBestEffort(dir) {
  let fd;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch (err) {
    if (
      err &&
      (err.code === 'EINVAL' ||
        err.code === 'ENOSYS' ||
        err.code === 'EPERM' ||
        err.code === 'EACCES' ||
        err.code === 'ENOENT')
    ) {
      return;
    }
    throw err;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function safeUnlink(p) {
  try { unlinkSync(p); } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
}
function safeRmdir(p) {
  try { rmdirSync(p); } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
}

function isSafeIdentifier(s) {
  return typeof s === 'string' && SAFE_IDENTIFIER_RE.test(s);
}
function isValidUUIDv4(s) {
  return typeof s === 'string' && UUID_V4_RE.test(s);
}

// ---------------------------------------------------------------------------
// PID liveness gate.
// Returns:
//   true   pid is alive and signalable
//   false  pid does not exist (ESRCH)
//   null   unknown (bad pid, EPERM, etc.) — caller must be conservative
// ---------------------------------------------------------------------------

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (!err) return null;
    if (err.code === 'ESRCH') return false;
    return null;                    // EPERM, EINVAL, etc.
  }
}

// ---------------------------------------------------------------------------
// Pure read (never mutates the file). Returns useragent or null.
// ---------------------------------------------------------------------------

export function peekIdentity(identityPath) {
  let raw;
  try {
    raw = readFileSync(identityPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed && isSafeIdentifier(parsed.useragent)) return parsed.useragent;
  return null;
}

function quarantineCorruptIdentity(identityPath, now) {
  const stamp = typeof now === 'function' ? now() : Date.now();
  const dst = `${identityPath}.corrupt.${stamp}`;
  try {
    renameSync(identityPath, dst);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    try {
      unlinkSync(identityPath);
    } catch (u) {
      if (u && u.code === 'ENOENT') return;
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// OWNER file
// ---------------------------------------------------------------------------

function writeOwnerFile(lockDir, token, ts) {
  const p = join(lockDir, OWNER_FILE);
  const fd = openSync(p, 'w', 0o600);
  try {
    writeSync(fd, JSON.stringify({ token, pid: process.pid, ts }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readOwnerFileOrNull(lockDir) {
  try {
    const raw = readFileSync(join(lockDir, OWNER_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.token === 'string' &&
      Number.isFinite(parsed.ts) &&
      parsed.ts > 0
    ) {
      return parsed;
    }
    return null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

// Backward-compat export.
export function readOwnerFile(lockDir) {
  const raw = readFileSync(join(lockDir, OWNER_FILE), 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed.token === 'string' && Number.isFinite(parsed.ts)) {
    return parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cleanup mutex + verified stale-lock recovery.
// Never call this from outside a caller that has already observed a stale
// OWNER (ts is >STALE_LOCK_MS old). This helper enforces the token / PID gate.
// ---------------------------------------------------------------------------

// New cleanup mutexes carry the same PID/time/token ownership contract as the
// primary lock. A parseable dead owner can therefore be recovered without
// deleting a fresh holder. Legacy empty mutex directories remain conservative
// and are handled only by maintainIdentityState once identity.json exists.
function readCleanupMutexOwner(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isDirectory()) return readOwnerFileOrNull(path);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed.token === 'string' && Number.isFinite(parsed.ts)
      ? parsed
      : null;
  } catch { return null; }
}

function writeCleanupCandidate(path, token, nowMs) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, ts: nowMs, token }));
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function tryAcquireCleanupMutex(cleanupLockDir, opts = {}) {
  const now = opts.now || Date.now;
  const liveness = opts.isPidAlive || isPidAlive;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomBytes(16).toString('hex');
    const candidate = `${cleanupLockDir}.candidate-${process.pid}-${token}`;
    try {
      // Publish a fully-written owner atomically. Unlike mkdir→write OWNER,
      // the canonical lock is never visible in an unowned/partial state.
      writeCleanupCandidate(candidate, token, now());
      linkSync(candidate, cleanupLockDir);
      unlinkSync(candidate);
      return { path: cleanupLockDir, token };
    } catch (err) {
      try { unlinkSync(candidate); } catch { /* best effort */ }
      if (!err || !['EEXIST', 'EPERM'].includes(err.code)) throw err;
      if (err.code === 'EPERM' && !existsSync(cleanupLockDir)) throw err;
    }

    const owner = readCleanupMutexOwner(cleanupLockDir);
    if (!owner || now() - owner.ts <= STALE_LOCK_MS || liveness(owner.pid) !== false) {
      return null;
    }
    const scratch = `${cleanupLockDir}.recovered-${process.pid}-${randomBytes(8).toString('hex')}`;
    try { renameSync(cleanupLockDir, scratch); }
    catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'EEXIST' || err.code === 'ENOTEMPTY')) continue;
      throw err;
    }
    const moved = readCleanupMutexOwner(scratch);
    if (moved?.token === owner.token && moved.ts === owner.ts && liveness(moved.pid) === false) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      try { renameSync(scratch, cleanupLockDir); }
      catch { /* A fresh owner won the canonical path; preserve scratch. */ }
      return null;
    }
  }
  return null;
}

function releaseCleanupMutex(lock) {
  if (!lock || typeof lock.path !== 'string' || typeof lock.token !== 'string') return;
  const owner = readCleanupMutexOwner(lock.path);
  if (!owner || owner.token !== lock.token) return;
  try { unlinkSync(lock.path); } catch { /* orphan collector will handle */ }
}

/**
 * Verify + clean a stale lock under the cleanup mutex.
 *
 * Returns:
 *   { cleaned: true }
 *   { cleaned: false, reason: 'cleanup_busy' | 'owner_gone' | 'owner_changed'
 *                            | 'holder_alive' | 'liveness_unknown'
 *                            | 'owner_race' | 'lock_race' }
 *
 * Reasons other than 'cleaned:true' all mean "leave the lock alone".
 *
 * @param {string} lockDir
 * @param {{token: string, ts: number, pid?: number}} expected  what caller
 *   observed at the outer check. This helper re-reads under the cleanup
 *   mutex; a mismatch here means someone refreshed the lock between the
 *   caller's inspection and now.
 * @param {object} [opts]
 * @param {string}       [opts.cleanupLockDir]  override the cleanup mutex path
 * @param {()=>number}   [opts.now]             wall-clock override (tests)
 * @param {(pid:number)=>boolean|null} [opts.isPidAlive] injection point (tests)
 */
export function verifyAndCleanStaleLock(lockDir, expected, opts = {}) {
  if (!expected || typeof expected.token !== 'string') {
    return { cleaned: false, reason: 'bad_expected' };
  }
  const cleanupLockDir = opts.cleanupLockDir || defaultCleanupLockDir(lockDir);
  const now = opts.now || Date.now;
  const liveness = opts.isPidAlive || isPidAlive;

  const cleanupLock = tryAcquireCleanupMutex(cleanupLockDir, { now, isPidAlive: liveness });
  if (!cleanupLock) {
    return { cleaned: false, reason: 'cleanup_busy' };
  }
  try {
    const current = readOwnerFileOrNull(lockDir);
    if (!current) return { cleaned: false, reason: 'owner_gone' };
    if (current.token !== expected.token || current.ts !== expected.ts) {
      return { cleaned: false, reason: 'owner_changed' };
    }
    const alive = liveness(current.pid);
    if (alive === true) return { cleaned: false, reason: 'holder_alive' };
    if (alive === null) return { cleaned: false, reason: 'liveness_unknown' };

    // alive === false → cleared to remove.
    try {
      unlinkSync(join(lockDir, OWNER_FILE));
    } catch (err) {
      if (err && err.code === 'ENOENT') return { cleaned: false, reason: 'owner_race' };
      throw err;
    }
    try {
      rmdirSync(lockDir);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTEMPTY')) {
        return { cleaned: false, reason: 'lock_race' };
      }
      throw err;
    }
    return { cleaned: true };
  } finally {
    releaseCleanupMutex(cleanupLock);
  }
}

/**
 * Installer maintenance for legacy empty cleanup mutexes. With a valid
 * identity, eager-read makes removal safe. If identity is missing, removal is
 * allowed only after a long grace and when the primary lock owner is provably
 * dead. Parseable live/unknown cleanup owners are always preserved.
 */
export function maintainIdentityState(stateRoot, opts = {}) {
  const identityPath = join(stateRoot, IDENTITY_FILE);
  const cleanupLockDir = join(stateRoot, CLEANUP_LOCK_DIR);
  if (!existsSync(cleanupLockDir)) return { cleaned: false, reason: 'mutex_missing' };
  const liveness = opts.isPidAlive || isPidAlive;
  const owner = readCleanupMutexOwner(cleanupLockDir);
  if (owner && liveness(owner.pid) !== false) {
    return { cleaned: false, reason: 'holder_not_dead' };
  }
  const identity = peekIdentity(identityPath);
  // Once identity exists, stale cleanup state is irrelevant because every
  // caller takes the eager-read path. Avoid touching a possible legacy holder
  // during its old mkdir→OWNER publication window.
  if (identity) return { cleaned: false, reason: 'identity_present' };
  // Parseable dead owners are recovered by tryAcquireCleanupMutex with a token
  // re-check. This maintenance path is only for the legacy unowned directory.
  if (owner) return { cleaned: false, reason: 'identity_missing' };
  let sampledStat;
  let age;
  try {
    sampledStat = lstatSync(cleanupLockDir);
    age = (opts.now?.() ?? Date.now()) - sampledStat.mtimeMs;
  } catch { return { cleaned: false, reason: 'stat_failed' }; }
  if (!sampledStat.isDirectory()) return { cleaned: false, reason: 'unowned_nonlegacy_mutex' };
  if (age <= (opts.legacyGraceMs ?? LEGACY_CLEANUP_MUTEX_GRACE_MS)) {
    return { cleaned: false, reason: 'legacy_mutex_fresh' };
  }
  const mainOwner = readOwnerFileOrNull(join(stateRoot, LOCK_DIR));
  if (!mainOwner || liveness(mainOwner.pid) !== false) {
    return { cleaned: false, reason: 'main_owner_not_dead' };
  }
  const scratch = `${cleanupLockDir}.maintenance-${process.pid}-${randomBytes(8).toString('hex')}`;
  try { renameSync(cleanupLockDir, scratch); }
  catch (err) {
    if (err?.code === 'ENOENT') return { cleaned: false, reason: 'mutex_gone' };
    return { cleaned: false, reason: 'rename_failed' };
  }
  // The canonical path may have been replaced by a fresh holder after our
  // sample. Delete only the exact legacy inode we sampled; otherwise restore
  // the moved lock and leave recovery for a later installer pass.
  let movedStat;
  try { movedStat = lstatSync(scratch); }
  catch { return { cleaned: false, reason: 'scratch_missing' }; }
  if (movedStat.dev !== sampledStat.dev || movedStat.ino !== sampledStat.ino || readCleanupMutexOwner(scratch)) {
    try { renameSync(scratch, cleanupLockDir); } catch { /* preserve scratch */ }
    return { cleaned: false, reason: 'mutex_replaced' };
  }
  rmSync(scratch, { recursive: true, force: true });
  return { cleaned: true, reason: 'legacy_unowned' };
}

function defaultCleanupLockDir(lockDir) {
  return join(dirname(lockDir), CLEANUP_LOCK_DIR);
}

// ---------------------------------------------------------------------------
// Standalone lock acquisition (kept for tests).
// ---------------------------------------------------------------------------

export function acquireLock(lockDir, ownerToken, now = Date.now, staleMs = STALE_LOCK_MS, opts = {}) {
  const liveness = opts.isPidAlive || isPidAlive;
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    try {
      mkdirSync(lockDir);
      writeOwnerFile(lockDir, ownerToken, now());
      return;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
    }

    const ownerInfo = readOwnerFileOrNull(lockDir);
    const nowMs = now();
    if (ownerInfo == null || nowMs - ownerInfo.ts <= staleMs) {
      sleepSync(backoffMs(attempt));
      continue;
    }
    const outcome = verifyAndCleanStaleLock(lockDir, ownerInfo, {
      now,
      isPidAlive: liveness,
    });
    if (!outcome.cleaned) {
      // Cleanup refused (alive holder / unknown liveness / raced). Back off
      // before the next attempt so we don't burn 100 iterations in µs.
      sleepSync(backoffMs(attempt));
    }
  }
  const err = new Error(`identity: unable to acquire ${lockDir} after ${MAX_LOCK_ATTEMPTS} attempts`);
  err.code = 'ELOCKED';
  throw err;
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

function tryLegacy(legacyPaths, migrate) {
  if (!Array.isArray(legacyPaths) || legacyPaths.length === 0) return null;
  const defaultMigrate = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.useragent === 'string' ? parsed.useragent : null;
    } catch {
      return null;
    }
  };
  const fn = typeof migrate === 'function' ? migrate : defaultMigrate;
  for (const legacyPath of legacyPaths) {
    let raw;
    try {
      raw = readFileSync(legacyPath, 'utf8');
    } catch {
      continue;
    }
    let candidate;
    try {
      candidate = fn(raw, legacyPath);
    } catch {
      candidate = null;
    }
    if (isSafeIdentifier(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get-or-create the anonymous useragent for this device.
 *
 * @param {object} [opts]
 * @param {string}   [opts.stateRoot]
 * @param {string}   [opts.ephemeralRoot]
 * @param {string[]} [opts.legacyPaths]
 * @param {(raw:string,path:string)=>string|null} [opts.migrate]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {NodeJS.Platform}   [opts.platform]
 * @param {()=>number}        [opts.now]           wall-clock override (tests)
 * @param {()=>number}        [opts.monotonicNow]  monotonic override (tests)
 * @param {(pid:number)=>boolean|null} [opts.isPidAlive] test injection
 * @param {number}            [opts.maxWaitMs]
 *   Bound on total wait time. When exceeded, we do a last eager peek and,
 *   if still nothing, throw an error with code 'ETIMEDOUT'. Do NOT synthesize
 *   an ephemeral useragent on timeout — callers (e.g. hooks) should retain
 *   event_id and mark `identity_pending`, letting a downstream dispatcher
 *   enrich once the write completes.
 * @returns {{ useragent: string, identity_scope: 'device' | 'ephemeral' }}
 */
export function getOrCreate(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;

  const primary = opts.stateRoot || resolveStateRoot(env, platform);
  try {
    return finalize(tryWriteAt(primary, 'device', opts, platform));
  } catch (err) {
    if (!isRecoverableRootError(err)) throw err;
  }
  const ephemeral = opts.ephemeralRoot || resolveEphemeralRoot(platform);
  return finalize(tryWriteAt(ephemeral, 'ephemeral', opts, platform));
}

function finalize(result) {
  if (result.identity_scope !== 'device' && result.identity_scope !== 'ephemeral') {
    throw new Error(`identity: invalid identity_scope=${String(result.identity_scope)}`);
  }
  if (!isSafeIdentifier(result.useragent)) {
    throw new Error(`identity: invalid useragent=${String(result.useragent)}`);
  }
  return result;
}

function isRecoverableRootError(err) {
  if (!err) return false;
  return (
    err.code === 'EACCES' ||
    err.code === 'EROFS' ||
    err.code === 'EPERM' ||
    err.code === 'ENOSPC' ||
    err.code === 'EDQUOT'
  );
}

function tryWriteAt(root, scope, opts, platform) {
  ensureDir(root, platform, opts);
  const identityPath = join(root, IDENTITY_FILE);
  const lockDir = join(root, LOCK_DIR);
  const now = opts.now || Date.now;
  const mnow = opts.monotonicNow || monotonicNow;
  const startMono = mnow();
  const deadlineMono = Number.isFinite(opts.maxWaitMs) ? startMono + opts.maxWaitMs : Infinity;

  // Eager pure-read fast path.
  const eager = peekIdentity(identityPath);
  if (eager) return { useragent: eager, identity_scope: scope };

  const ownerToken = randomBytes(16).toString('hex');

  let acquired = false;
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    // Pure re-peek at the top: late arrivals bail out without ever
    // touching the lock.
    const midpeek = peekIdentity(identityPath);
    if (midpeek) return { useragent: midpeek, identity_scope: scope };

    // Deadline check before any sleep.
    const budget = deadlineMono - mnow();
    if (budget <= 0) {
      const last = peekIdentity(identityPath);
      if (last) return { useragent: last, identity_scope: scope };
      const err = new Error('identity: acquisition timed out');
      err.code = 'ETIMEDOUT';
      throw err;
    }

    try {
      mkdirSync(lockDir);
      writeOwnerFile(lockDir, ownerToken, now());
      acquired = true;
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
    }

    const ownerInfo = readOwnerFileOrNull(lockDir);
    const nowMs = now();
    if (ownerInfo == null || nowMs - ownerInfo.ts <= STALE_LOCK_MS) {
      // Fresh (or missing OWNER file — the holder is still writing it).
      // Sleep, clamped so we don't overshoot the deadline.
      const wait = Math.min(backoffMs(attempt), Math.max(1, budget));
      sleepSync(wait);
      continue;
    }
    // Stale-looking; try verified cleanup. The helper enforces the
    // cleanup mutex + PID liveness gate.
    const outcome = verifyAndCleanStaleLock(lockDir, ownerInfo, {
      now,
      isPidAlive: opts.isPidAlive,
    });
    if (!outcome.cleaned) {
      // Cleanup refused (alive holder / unknown liveness / raced). Back off,
      // clamped to remaining deadline budget.
      const wait = Math.min(backoffMs(attempt), Math.max(1, budget));
      sleepSync(wait);
    }
    // Whether cleanup succeeded or not, loop to attempt mkdir again.
  }

  if (!acquired) {
    const last = peekIdentity(identityPath);
    if (last) return { useragent: last, identity_scope: scope };
    const err = new Error(`identity: unable to acquire ${lockDir} after ${MAX_LOCK_ATTEMPTS} attempts`);
    err.code = 'ELOCKED';
    throw err;
  }

  try {
    // Inside the lock, peek + quarantine if needed.
    const inside = peekIdentity(identityPath);
    if (inside) return { useragent: inside, identity_scope: scope };
    if (existsSync(identityPath)) {
      quarantineCorruptIdentity(identityPath, now);
    }

    const legacy = tryLegacy(opts.legacyPaths, opts.migrate);
    const useragent = legacy || randomUUID();

    // Because we hold the lock and no other alive process can steal it
    // (PID liveness gate blocks stealing an alive holder), tmp + fsync +
    // rename is safe — there is no other concurrent writer.
    const tmpPath = `${identityPath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    const fd = openSync(tmpPath, 'wx', 0o600);
    try {
      writeSync(fd, JSON.stringify({ useragent, created_at: now() }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, identityPath);
    if (isPosix(platform)) {
      try { chmodSync(identityPath, 0o600); } catch { /* best-effort */ }
    }
    fsyncDirBestEffort(dirname(identityPath));
    return { useragent, identity_scope: scope };
  } finally {
    releaseOurLock(lockDir, ownerToken);
  }
}

function releaseOurLock(lockDir, ownerToken) {
  const current = readOwnerFileOrNull(lockDir);
  if (!current || current.token !== ownerToken) return;
  try { unlinkSync(join(lockDir, OWNER_FILE)); } catch (err) {
    if (err && err.code !== 'ENOENT') return;
  }
  try { rmdirSync(lockDir); } catch { /* orphan collector will handle */ }
}
