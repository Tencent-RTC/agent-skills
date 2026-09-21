// preference.js — dependency-free, project-scoped telemetry preference.
//
// The dedicated preference.json is authoritative for the Node runtime.  The
// legacy Python state.json remains readable so an upgrade never resurrects a
// preference that the user already made.  No project path is written to the
// device state root; callers use a one-way project key on queued events.

import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  ALLOWED,
  ALLOW_RETRY,
  CONTROL_RETRY,
  DISABLED,
  DISABLE_RETRY,
  NOTICE_ATTEMPT_MAX_AGE_MS,
  acquireProjectAdmissionReservation,
  acquireControlReservation,
  controlKey,
  isCanonicalOption,
  readControlTurn,
  readDenyTombstone,
  readNoticeReceipt,
  recordNoticeRetry,
  quarantineDenyTombstone,
  releaseControlReservation,
  updateNoticeStatus,
  writeControlTurn,
  writeDenyTombstone,
  writeDenyTombstoneFromHook,
  releaseProjectAdmissionReservation,
} from './control.js';
import { projectStateDirs, resolveProjectStateDir } from './project-state.js';

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const PREF_FILE = 'preference.json';
const LEGACY_STATE_FILE = 'state.json';
const LOCK_FILE = '.pref-owner.json';
const LOCK_GRACE_FOREGROUND_MS = 5000;

const VALID_CONTINUATION_CHOICES = new Set(['unanswered', 'allowed', 'denied']);

function noticeCapabilityFresh(receipt) {
  if (receipt?.status !== 'valid') return false;
  const state = receipt.value?.status;
  // Once a choice has been durably accepted, its transaction is a recovery
  // obligation rather than a fresh authorization capability.  It remains
  // resumable after the seven-day capability window so a crash or a failed
  // preference/notice write cannot strand the project in a half-applied state.
  if (['allow_pending', 'deny_pending'].includes(state)) return true;
  if (!['pending_output', 'awaiting_choice'].includes(state)) return true;
  return Number.isFinite(receipt.value.created_at)
    && Date.now() - receipt.value.created_at <= NOTICE_ATTEMPT_MAX_AGE_MS;
}

function controlTurnAccepted(turn, choice) {
  if (turn?.status !== 'valid' || turn.value?.control_kind !== choice) return false;
  return choice === 'allowed'
    ? ['allowed_pending', 'allowed', 'retryable'].includes(turn.value.control_status)
    : ['deny_pending', 'denied', 'retryable'].includes(turn.value.control_status);
}

function acceptedControlFact(stateRoot, key, choice, turn = null, tombstone = null) {
  if (controlTurnAccepted(turn || readControlTurn(stateRoot, key, controlKey(key, choice)), choice)) return true;
  // The bounded Hook deny path can durably create the kill-switch tombstone
  // before the foreground process writes its replay turn. Treat that as an
  // accepted deny transaction even when the notice capability has expired.
  return choice === 'denied'
    && (tombstone || readDenyTombstone(stateRoot, key)).status === 'valid';
}

// A deny is a kill-switch transaction.  Serialize only the short tombstone
// write with Prompt admission; do not hold this lock while preference writes,
// queue purging, or network/sender work waits for existing producers.
function writeDenyWithAdmission(stateRoot, key, controlKeyValue, opts = {}) {
  const hook = opts.source === 'hook';
  const requested = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : (hook ? 25 : 120);
  const deadlineMono = Number.isFinite(opts.deadlineMono)
    ? opts.deadlineMono : performance.now() + requested;
  const lock = acquireProjectAdmissionReservation(stateRoot, key, {
    timeoutMs: Math.min(requested, Math.max(0, deadlineMono - performance.now())),
    deadlineMono,
    _hookMode: hook,
  });
  if (!lock) return { status: hook ? 'retryable' : 'error', reason: 'admission_busy' };
  try {
    const writerOpts = {
      ...opts,
      timeoutMs: Math.min(requested, Math.max(0, deadlineMono - performance.now())),
      deadlineMono,
    };
    return hook
      ? writeDenyTombstoneFromHook(stateRoot, key, controlKeyValue, writerOpts)
      : writeDenyTombstone(stateRoot, key, controlKeyValue, writerOpts);
  } finally {
    releaseProjectAdmissionReservation(lock);
  }
}

const OFF_TEXTS = new Set([
  '关闭体验上报', '停止体验上报', '关闭提示词上报', '停止提示词上报',
  '关闭prompt上报', '停止prompt上报', 'turn off experience reporting',
  'disable experience reporting', 'stop experience reporting',
  'turn off prompt reporting', 'disable prompt reporting', 'stop prompt reporting',
]);
const ON_TEXTS = new Set([
  '开启体验上报', '恢复体验上报', '开启提示词上报', '恢复提示词上报',
  '开启prompt上报', '恢复prompt上报', 'turn on experience reporting',
  'enable experience reporting', 'resume experience reporting',
  'turn on prompt reporting', 'enable prompt reporting', 'resume prompt reporting',
]);

function readObject(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function writeObjectAtomic(path, value) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
  const tmp = join(dir, `.${randomBytes(8).toString('hex')}.${PREF_FILE}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    const body = `${JSON.stringify(value, null, 2)}\n`;
    writeSync(fd, body, null, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
    try {
      const dirFd = openSync(dir, 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch (err) {
      if (!err || !['EINVAL', 'ENOSYS', 'EPERM', 'EACCES', 'ENOENT'].includes(err.code)) throw err;
    }
    return true;
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

function ancestors(projectRoot) {
  const result = [];
  let current = canonicalRoot(projectRoot);
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function canonicalRoot(projectRoot) {
  const absolute = resolve(projectRoot);
  try { return realpathSync(absolute); } catch { return absolute; }
}

// ---------------------------------------------------------------------------
// Owner-token lock — shared by all preference read-modify-write operations.
// graceMs: how old a lock must be before it is considered stale.
// ---------------------------------------------------------------------------

function _lockMode() { return process.platform === 'win32' ? undefined : 0o600; }

function _staleCheckAndClaim(lockPath, newToken, newOwnerData, graceMs) {
  // Step 1: lstat for mtime
  let stat;
  try { stat = lstatSync(lockPath); }
  catch (err) {
    if (err.code === 'ENOENT') {
      // Released between EEXIST and lstat; retry acquire once.
      try {
        writeFileSync(lockPath, newOwnerData, { flag: 'wx', mode: _lockMode() });
        return { acquired: true, token: newToken, lockPath };
      } catch { return { acquired: false, reason: 'busy' }; }
    }
    return { acquired: false, reason: 'busy' };
  }
  // Step 2: age check
  const age = Date.now() - stat.mtimeMs;
  if (age < graceMs) return { acquired: false, reason: 'busy' };
  // Step 3: read PID
  let pid = null;
  try {
    const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (typeof existing?.pid === 'number') pid = existing.pid;
  } catch { /* parse failed — rely on mtime */ }
  // Step 4: PID liveness
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      return { acquired: false, reason: 'busy' }; // process alive
    } catch (err) {
      if (err.code !== 'ESRCH') return { acquired: false, reason: 'busy' };
      // ESRCH: dead → stale
    }
  }
  // Step 5: atomic rename to claim
  const staleFile = lockPath + '.stale.' + newToken;
  try { renameSync(lockPath, staleFile); }
  catch (err) {
    if (err.code === 'ENOENT') {
      try {
        writeFileSync(lockPath, newOwnerData, { flag: 'wx', mode: _lockMode() });
        return { acquired: true, token: newToken, lockPath };
      } catch { return { acquired: false, reason: 'busy' }; }
    }
    return { acquired: false, reason: 'busy' };
  }
  // Write new owner with O_EXCL
  try {
    writeFileSync(lockPath, newOwnerData, { flag: 'wx', mode: _lockMode() });
  } catch { return { acquired: false, reason: 'busy' }; } // competitor won
  // Step 6: clean up stale files (best-effort)
  try { unlinkSync(staleFile); } catch { /* ignore */ }
  try {
    const prefDir = dirname(lockPath);
    for (const e of readdirSync(prefDir)) {
      if (e.startsWith(LOCK_FILE + '.stale.')) {
        try { unlinkSync(join(prefDir, e)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return { acquired: true, token: newToken, lockPath };
}

export function _acquirePreferenceLock(prefDir, { graceMs = LOCK_GRACE_FOREGROUND_MS } = {}) {
  mkdirSync(prefDir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
  const lockPath = join(prefDir, LOCK_FILE);
  const token = randomBytes(16).toString('hex');
  const ownerData = JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  try {
    writeFileSync(lockPath, ownerData, { flag: 'wx', mode: _lockMode() });
    return { acquired: true, token, lockPath };
  } catch (err) {
    if (err.code !== 'EEXIST') return { acquired: false, reason: 'lock_io_error' };
    return _staleCheckAndClaim(lockPath, token, ownerData, graceMs);
  }
}

export function _releasePreferenceLock(lockPath, token, _testHookAfterRename) {
  if (!lockPath || !token) return;
  const releasingFile = lockPath + '.releasing.' + token;
  try { renameSync(lockPath, releasingFile); }
  catch { return; } // ENOENT: already reclaimed; other errors: keep lock
  _testHookAfterRename?.(); // for barrier tests only — not present in production calls
  try {
    const existing = JSON.parse(readFileSync(releasingFile, 'utf8'));
    if (existing?.token === token) {
      unlinkSync(releasingFile);
    } else {
      // Token mismatch: the .releasing.* file contains another owner's lock data.
      // Restore it via a no-clobber hard-link so we don't silently lose that lock.
      // If a new owner has already acquired lockPath (linkSync → EEXIST), we just
      // clean up our .releasing.* file and leave the new lock untouched.
      try {
        linkSync(releasingFile, lockPath); // atomic no-clobber: EEXIST if new owner present
        unlinkSync(releasingFile);         // restored: remove the temporary .releasing.* name
      } catch {
        try { unlinkSync(releasingFile); } catch { /* ignore */ }
      }
    }
  } catch {
    try { unlinkSync(releasingFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Three-state preference source reader.
// Returns { status: 'missing' | 'valid' | 'corrupt', value? }.
// ---------------------------------------------------------------------------

export function readPreferenceSourceAt(root, source) {
  const fileName = source === 'preferred' ? PREF_FILE : LEGACY_STATE_FILE;
  let filePath = null;
  for (const dir of projectStateDirs(root)) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) { filePath = candidate; break; }
  }
  if (filePath === null) return { status: 'missing' };
  let raw;
  try { raw = readFileSync(filePath, 'utf8'); }
  catch { return { status: 'corrupt' }; }
  let value;
  try { value = JSON.parse(raw); }
  catch { return { status: 'corrupt' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt' };
  if (source === 'preferred') {
    const boolFields = ['prompt_reporting_enabled', 'all_reporting_disabled', 'purge_pending'];
    for (const f of boolFields) {
      if (value[f] !== undefined && typeof value[f] !== 'boolean') return { status: 'corrupt' };
    }
    const tsFields = ['prompt_reporting_updated_at', 'all_reporting_updated_at', 'continuation_choice_updated_at'];
    for (const f of tsFields) {
      if (value[f] !== undefined && (!Number.isInteger(value[f]) || value[f] < 0)) return { status: 'corrupt' };
    }
    if (value.continuation_choice !== undefined && !VALID_CONTINUATION_CHOICES.has(value.continuation_choice)) {
      return { status: 'corrupt' };
    }
    if (value.continuation_choice_version !== undefined &&
        (!Number.isInteger(value.continuation_choice_version) || value.continuation_choice_version <= 0)) {
      return { status: 'corrupt' };
    }
    if (value.preference_revision !== undefined &&
        (!Number.isSafeInteger(value.preference_revision) || value.preference_revision < 0)) {
      return { status: 'corrupt' };
    }
  } else {
    // legacy: validate only the two boolean fields
    for (const f of ['prompt_reporting_enabled', 'all_reporting_disabled']) {
      if (value[f] !== undefined && typeof value[f] !== 'boolean') return { status: 'corrupt' };
    }
  }
  return { status: 'valid', value };
}

// ---------------------------------------------------------------------------
// XDG legacy-cache reader — one-time backward-compat read at project root.
// The installer (bin/cli.js) migrates this data on every upgrade, but users
// who upgrade without re-running the installer need the Runtime to see it.
// ---------------------------------------------------------------------------

function _readXdgLegacyCache(projectRoot, env) {
  const cachePath = legacyCachePath(projectRoot, env);
  if (!existsSync(cachePath)) return { status: 'missing' };
  let raw;
  try { raw = readFileSync(cachePath, 'utf8'); }
  catch { return { status: 'corrupt' }; }
  let value;
  try { value = JSON.parse(raw); }
  catch { return { status: 'corrupt' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt' };
  for (const f of ['prompt_reporting_enabled', 'all_reporting_disabled']) {
    if (value[f] !== undefined && typeof value[f] !== 'boolean') return { status: 'corrupt' };
  }
  return { status: 'valid', value };
}

// ---------------------------------------------------------------------------
// Unified effective-preference resolver.
// scope: 'experience' (default) or 'runtime'.
// ---------------------------------------------------------------------------

function resolveEffectivePreference(projectRoot, env = process.env, scope = 'experience') {
  // 1. TRTC_REPORTING=off → false (all scopes, highest priority)
  if (envBoolean(env.TRTC_REPORTING) === false) return false;
  // 2. TRTC_PROMPT_REPORTING=off → false (non-runtime scope only)
  if (scope !== 'runtime' && envBoolean(env.TRTC_PROMPT_REPORTING) === false) return false;
  let promptPreference = null;
  const allRoots = ancestors(projectRoot);
  // 3. Ancestor walk with authority aggregation
  for (let i = 0; i < allRoots.length; i++) {
    const root = allRoots[i];
    const preferred = readPreferenceSourceAt(root, 'preferred');
    let prefValue;
    if (preferred.status === 'valid') {
      prefValue = preferred.value;
    } else if (preferred.status === 'corrupt') {
      return false; // fail-closed
    } else {
      // preferred missing → try legacy (state.json)
      const legacy = readPreferenceSourceAt(root, 'legacy');
      if (legacy.status === 'valid') {
        prefValue = legacy.value;
      } else if (legacy.status === 'corrupt') {
        return false; // fail-closed
      } else {
        // Both preferred and legacy missing at this root.
        // At the project root (first ancestor only), also check the XDG cache path
        // for one-time backwards compatibility with pre-C20.1b installations.
        if (i === 0) {
          const xdg = _readXdgLegacyCache(root, env);
          if (xdg.status === 'valid') {
            prefValue = xdg.value;
          } else if (xdg.status === 'corrupt') {
            return false; // fail-closed
          } else {
            continue; // all three sources missing → try parent
          }
        } else {
          continue; // ancestor has no preference → try further parent
        }
      }
    }
    // continuation_choice='denied' → hard close (blocks even TRTC_REPORTING=on)
    if ((prefValue.continuation_choice ?? 'unanswered') === 'denied') return false;
    // all_reporting_disabled is unconditional — cannot be bypassed by any env var
    if (prefValue.all_reporting_disabled === true) return false;
    // cache prompt_reporting_enabled — runtime scope ignores this flag
    if (scope !== 'runtime' && promptPreference === null && typeof prefValue.prompt_reporting_enabled === 'boolean') {
      promptPreference = prefValue.prompt_reporting_enabled;
    }
  }
  // 4. TRTC_PROMPT_REPORTING=on → true (non-runtime only, no hard-close reached)
  if (scope !== 'runtime' && envBoolean(env.TRTC_PROMPT_REPORTING) === true) return true;
  // 5. For runtime scope: default enabled if no hard-close above.
  if (scope === 'runtime') return true;
  // 5. cached preference or default enabled
  return promptPreference ?? true;
}

function envBoolean(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return null;
}

export function projectKey(projectRoot) {
  return createHash('sha256').update(canonicalRoot(projectRoot)).digest('hex').slice(0, 32);
}

export function preferencePath(projectRoot) {
  return join(resolveProjectStateDir(canonicalRoot(projectRoot)), PREF_FILE);
}

/** Resolve experience-reporting preference with environment overrides first. */
export function isReportingEnabled(projectRoot, env = process.env) {
  return resolveEffectivePreference(projectRoot, env, 'experience');
}

/** Runtime diagnostics ignore prompt/experience opt-out but never global opt-out. */
export function isReportingEnabledForScope(projectRoot, scope = 'experience', env = process.env) {
  return resolveEffectivePreference(projectRoot, env, scope === 'runtime' ? 'runtime' : 'experience');
}

/** Persist only preference data; never copy session/prompt state. */
export function setReportingPreference(projectRoot, enabled, opts = {}) {
  const filePath = preferencePath(projectRoot);
  const dir = dirname(filePath);
  const graceMs = opts.graceMs ?? LOCK_GRACE_FOREGROUND_MS;
  const lock = _acquirePreferenceLock(dir, { graceMs });
  if (!lock.acquired) {
    return { action: 'skip', reason: lock.reason ?? 'busy', enabled: Boolean(enabled), all_reporting_disabled: false, path: filePath };
  }
  try {
    // Use three-state read: corrupt → skip write (don't overwrite)
    const source = readPreferenceSourceAt(canonicalRoot(projectRoot), 'preferred');
    if (source.status === 'corrupt') {
      return { action: 'skip', reason: 'preference_corrupt', enabled: Boolean(enabled), all_reporting_disabled: false, path: filePath };
    }
    const current = source.status === 'valid' ? source.value : {};
    const next = {
      ...current,
      prompt_reporting_enabled: Boolean(enabled),
      prompt_reporting_updated_at: Math.floor((opts.now?.() ?? Date.now()) / 1000),
    };
    if (opts.purgePending !== undefined) next.purge_pending = Boolean(opts.purgePending);
    if (opts.allReportingDisabled !== undefined) {
      next.all_reporting_disabled = Boolean(opts.allReportingDisabled);
      next.all_reporting_updated_at = next.prompt_reporting_updated_at;
    }
    const persisted = writeObjectAtomic(filePath, next);
    return {
      action: persisted ? 'updated' : 'skip',
      reason: persisted ? null : 'state-unavailable',
      enabled: Boolean(enabled),
      all_reporting_disabled: next.all_reporting_disabled === true,
      path: filePath,
    };
  } finally {
    _releasePreferenceLock(lock.lockPath, lock.token);
  }
}

/** Read authoritative three-state preference for the project root (preferred only). */
export function readPreferenceState(projectRoot) {
  return readPreferenceSourceAt(canonicalRoot(projectRoot), 'preferred');
}

/** Recognize canonical C20 continuation-choice option labels (exact match, leading/trailing whitespace and trailing punctuation tolerated). */
export function continuationChoiceFromText(text) {
  return isCanonicalOption(text);
}

/**
 * Atomically persist a continuation choice under the preference lock.
 * Returns { action: 'updated' | 'skip' | 'preference_corrupt', reason? }.
 * 'denied' also sets all_reporting_disabled=true.
 * 'allowed' never widens a pre-existing all_reporting_disabled=true.
 * Corrupt preferred file → returns 'preference_corrupt', file bytes unchanged.
 */
export function setContinuationChoiceLocked(projectRoot, choice, opts = {}) {
  if (!VALID_CONTINUATION_CHOICES.has(choice)) return { action: 'skip', reason: 'invalid_choice' };
  const root = canonicalRoot(projectRoot);
  const dir = resolveProjectStateDir(root);
  const filePath = join(dir, PREF_FILE);
  const graceMs = opts.graceMs ?? LOCK_GRACE_FOREGROUND_MS;
  const lock = _acquirePreferenceLock(dir, { graceMs });
  if (!lock.acquired) return { action: 'skip', reason: lock.reason ?? 'busy' };
  try {
    const source = readPreferenceSourceAt(root, 'preferred');
    if (source.status === 'corrupt') return { action: 'preference_corrupt' };
    // When preferred is absent, check legacy to carry over global-off or detect corruption.
    let current = {};
    if (source.status === 'valid') {
      current = source.value;
    } else {
      const legacy = readPreferenceSourceAt(root, 'legacy');
      if (legacy.status === 'corrupt') {
        // Preferred missing + legacy corrupt → fail-closed; do not create an enabled preferred.
        return { action: 'preference_corrupt' };
      }
      if (legacy.status === 'valid') {
        if (legacy.value.all_reporting_disabled === true) {
          current = { all_reporting_disabled: true };
        }
        // legacy valid but no global-off: start fresh (let 'allowed' restore prompt reporting)
      } else {
        // Both preferred and legacy missing → check XDG cache (same hierarchy as resolver).
        const xdg = _readXdgLegacyCache(root, opts.env ?? process.env);
        if (xdg.status === 'corrupt') {
          return { action: 'preference_corrupt' };
        }
        if (xdg.status === 'valid' && xdg.value.all_reporting_disabled === true) {
          current = { all_reporting_disabled: true };
        }
        // XDG missing or no global-off → start fresh
      }
    }
    const now = Math.floor((opts.now?.() ?? Date.now()) / 1000);
    const revision = typeof current.preference_revision === 'number' ? current.preference_revision : 0;
    const next = {
      ...current,
      continuation_choice: choice,
      continuation_choice_version: 1,
      continuation_choice_updated_at: now,
      preference_revision: revision + 1,
    };
    if (choice === 'denied') {
      next.all_reporting_disabled = true;
      next.all_reporting_updated_at = now;
      // Align all closely related fields so downstream readers see a consistent state.
      next.prompt_reporting_enabled = false;
      next.purge_pending = true;
    }
    // 'allowed' never touches all_reporting_disabled (global-off preserved)
    const persisted = writeObjectAtomic(filePath, next);
    return { action: persisted ? 'updated' : 'skip', reason: persisted ? null : 'state-unavailable' };
  } finally {
    _releasePreferenceLock(lock.lockPath, lock.token);
  }
}

/**
 * Consume a continuation-choice response from the user.
 * Non-canonical text returns null and follows the ordinary Prompt path.
 * A canonical option is a control message only when the current project has
 * an applicable notice/control receipt.  Without one it remains ordinary
 * user text; this prevents a common onboarding phrase from being swallowed or
 * from changing reporting state in an unrelated conversation.
 */
export async function consumeContinuationChoice(projectRoot, text, opts = {}) {
  const explicit = opts.controlChoice ?? opts.control_choice;
  const choice = explicit === 'allow'
    ? 'allowed'
    : explicit === 'deny'
      ? 'denied'
      : explicit === 'ambiguous'
        ? 'ambiguous'
        : isCanonicalOption(text);
  // Non-control text remains on the ordinary Prompt path.  Canonical labels
  // are checked against a project-scoped notice below; without that receipt
  // they also remain ordinary Prompt text.
  if (!choice) return null;
  if (!opts.stateRoot) return { status: 'control_retry', control: true, marker: CONTROL_RETRY };
  const key = projectKey(projectRoot);

  // Ambiguous intent is deliberately a local, non-blocking transition.  It
  // never changes the reporting preference: the default remains enabled.  A
  // successful transition closes the current notice so a later foreground
  // entry does not ask the same question again.  If the single authoritative
  // notice file cannot be updated, keep ordinary Prompt delivery flowing and
  // retry the same-file transition after a bounded backoff.
  if (choice === 'ambiguous') {
    const notice = readNoticeReceipt(opts.stateRoot, key);
    if (notice.status === 'missing') return null;
    if (notice.status === 'corrupt') return { status: 'control_continue', control: true, defaulted: false, notice_error: 'notice_corrupt' };
    if (!['pending_output', 'awaiting_choice'].includes(notice.value.status)) {
      return { status: 'control_continue', control: true, defaulted: notice.value.status === 'defaulted' };
    }
    if (Number.isFinite(notice.value.choice_next_retry_at)
      && notice.value.choice_next_retry_at > Date.now()) {
      return { status: 'control_continue', control: true, defaulted: false, retry_suppressed: true };
    }
    const writeNotice = typeof opts._updateNoticeStatus === 'function'
      ? opts._updateNoticeStatus : updateNoticeStatus;
    const persisted = writeNotice(opts.stateRoot, key, notice.value.status, 'defaulted');
    if (['updated', 'conflict'].includes(persisted.status)) {
      return { status: 'control_continue', control: true, defaulted: true };
    }
    const retry = recordNoticeRetry(
      opts.stateRoot, key, notice.value.status,
      persisted.reason || 'notice_defaulted_write_failed', opts,
    );
    return {
      status: 'control_continue', control: true, defaulted: false,
      defaulted_retry: retry.status,
      notice_error: persisted.reason || 'notice_defaulted_write_failed',
    };
  }
  const ckey = controlKey(key, choice);
  // Test-only seam for deterministic write-failure coverage. Production
  // callers leave this unset and use the shared control writer directly.
  const writeTurn = typeof opts._writeControlTurn === 'function'
    ? opts._writeControlTurn : writeControlTurn;
  // The preference is the authoritative user-facing choice.  Control-turn
  // and notice files are replay/transport bookkeeping and may be unavailable
  // in a desktop sandbox.  Keep an injectable writer for deterministic
  // failure tests, but never let a best-effort auxiliary write erase an
  // already durable choice.
  const writeNotice = typeof opts._updateNoticeStatus === 'function'
    ? opts._updateNoticeStatus : updateNoticeStatus;
  const retry = (marker = CONTROL_RETRY) => ({
    status: 'control_retry', control: true, marker,
  });
  // Hook deny is a dedicated bounded hot path. It must not acquire the
  // control/notice lock or inspect preference state; foreground replay will
  // perform the complete deny transaction after this tombstone exists.
  if (choice === 'denied' && opts.source === 'hook') {
    const deadlineMono = Number.isFinite(opts.deadlineMono)
      ? opts.deadlineMono : performance.now() + (opts.timeoutMs ?? 25);
    const notice = readNoticeReceipt(opts.stateRoot, key);
    const turn = readControlTurn(opts.stateRoot, key, ckey);
    const tombstone = readDenyTombstone(opts.stateRoot, key);
    if (performance.now() > deadlineMono) return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
    if (tombstone.status === 'valid') return { status: 'control_in_progress', control: true, marker: DISABLE_RETRY };
    // A familiar phrase in an unrelated conversation is ordinary Prompt
    // text. Only a live project-scoped notice can authorize the control path.
    if (!noticeCapabilityFresh(notice) && !acceptedControlFact(opts.stateRoot, key, choice, turn, tombstone)) return null;
    if (notice.status !== 'valid'
      || !['pending_output', 'awaiting_choice', 'deny_pending'].includes(notice.value?.status)) return null;
    const tomb = writeDenyWithAdmission(opts.stateRoot, key, ckey, {
      ...opts,
      source: 'hook',
      timeoutMs: Math.max(0, Math.min(25, deadlineMono - performance.now())),
      deadlineMono,
    });
    if (['pending', 'already_present'].includes(tomb.status)) {
      return { status: 'control_in_progress', control: true, marker: DISABLE_RETRY };
    }
    return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
  }
  // Hook allow is also a best-effort hot path.  Do not acquire the control or
  // preference locks here: durable allow writes can involve several fsyncs
  // and routinely exceed the host Hook budget.  The following foreground
  // Python shim replays the same option and performs finishAllowed().  With
  // no applicable receipt this remains ordinary user text, just like the
  // deny path.
  if (choice === 'allowed' && opts.source === 'hook') {
    const deadlineMono = Number.isFinite(opts.deadlineMono)
      ? opts.deadlineMono : performance.now() + (opts.timeoutMs ?? 25);
    const notice = readNoticeReceipt(opts.stateRoot, key);
    const turn = readControlTurn(opts.stateRoot, key, ckey);
    const tombstone = readDenyTombstone(opts.stateRoot, key);
    if (performance.now() > deadlineMono) return { status: 'control_retry', control: true, marker: ALLOW_RETRY };
    const accepted = acceptedControlFact(opts.stateRoot, key, choice, turn, tombstone);
    if (notice.status === 'corrupt' && !accepted) return { status: 'control_retry', control: true, marker: ALLOW_RETRY };
    if (!noticeCapabilityFresh(notice) && !accepted) return null;
    // A global deny always wins over a stale or in-flight allow replay.
    if (tombstone.status === 'valid') return { status: 'control_in_progress', control: true, marker: DISABLE_RETRY };
    if (!['pending_output', 'awaiting_choice', 'allow_pending'].includes(notice.value?.status)
      && !accepted) return null;
    return { status: 'control_in_progress', control: true, marker: ALLOW_RETRY };
  }
  // Fast negative path for the overwhelmingly common case: no notice and no
  // control turn for this project.  Do this before acquiring the control lock
  // so a slow/contended lock cannot swallow a perfectly ordinary onboarding
  // phrase such as the canonical allow label.  Reads are fixed project paths;
  // no directory scan or mutation occurs here.
  const preNotice = readNoticeReceipt(opts.stateRoot, key);
  const preTurn = readControlTurn(opts.stateRoot, key, ckey);
  const preTombstone = readDenyTombstone(opts.stateRoot, key);
  if (preNotice.status === 'missing' && preTurn.status === 'missing'
    && !(choice === 'denied' && preTombstone.status === 'valid')) return null;
  if (preNotice.status === 'corrupt' || preTurn.status === 'corrupt') return retry();
  // A notice attempt is a seven-day capability. An old localized label is
  // ordinary user text (or an explicit enum control retry), never permission
  // to change the current project preference.
  if (preNotice.status === 'valid' && !noticeCapabilityFresh(preNotice)
    && !acceptedControlFact(opts.stateRoot, key, choice, preTurn, preTombstone)) {
    // A deny tombstone is the global kill switch even if a stale allow label
    // is presented later; let the locked path return the disabled marker.
    if (choice === 'allowed' && preTombstone.status === 'valid') return retry(DISABLE_RETRY);
    return null;
  }
  if (preTurn.status === 'missing' && preNotice.status === 'valid'
    && !['pending_output', 'awaiting_choice', 'allow_pending', 'deny_pending'].includes(preNotice.value.status)) return null;
  const finishAllowed = () => {
    // `allowed_pending` is deliberately resumable.  It can be left behind by
    // a crash or a failed preference write between the durable control-turn
    // claim and the terminal preference/control writes.
    const persisted = setContinuationChoiceLocked(projectRoot, 'allowed', opts);
    if (persisted.action !== 'updated') return retry(ALLOW_RETRY);
    const finalLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
    if (!finalLock) {
      return {
        status: 'control_in_progress', control: true, marker: ALLOWED,
        control_turn_persisted: false,
        control_turn_error: 'control_busy',
      };
    }
    let committed = false;
    try {
      const final = writeTurn(opts.stateRoot, key, ckey, {
        control_kind: 'allowed', control_status: 'allowed',
      });
      committed = ['updated', 'created', 'already_present'].includes(final.status);
    } finally { releaseControlReservation(finalLock); }
    // The preference above is the user-facing source of truth.  If the
    // auxiliary replay turn cannot be finalized, do not turn a completed
    // allow into an endless privacy prompt; report the diagnostic and let a
    // later foreground entry repair the replay file.
    const result = {
      status: 'control_in_progress', control: true, marker: ALLOWED,
      control_turn_persisted: committed,
      ...(committed ? {} : { control_turn_error: 'control_write_failed' }),
    };
    // Do not hold the control reservation while the notice writer acquires
    // it again. A failed notice update is also auxiliary: the durable
    // preference must suppress all future re-prompts.
    const currentNotice = readNoticeReceipt(opts.stateRoot, key);
    const expected = currentNotice.status === 'valid'
      ? currentNotice.value.status : null;
    if (expected && !['pending_output', 'awaiting_choice', 'allow_pending', 'allowed'].includes(expected)) {
      return {
        ...result,
        notice_persisted: false,
        notice_error: 'notice_state_conflict',
      };
    }
    if (expected && expected !== 'allowed') {
      const done = writeNotice(opts.stateRoot, key, expected, 'allowed');
      return {
        ...result,
        notice_persisted: ['updated', 'conflict'].includes(done.status),
        ...(['updated', 'conflict'].includes(done.status)
          ? {} : { notice_error: done.reason || 'notice_write_failed' }),
      };
    }
    return { ...result, notice_persisted: true };
  };
  const completeDenied = () => {
    // A Hook tombstone is intentionally only close-durable.  Before the
    // foreground path can persist the disabled preference, purge queues, or
    // emit the terminal marker, re-open the existing tombstone through the
    // durable writer.  This fsyncs the file and its directory; a close-only
    // artifact must never be treated as a completed deny.
    const durableTombstone = writeDenyWithAdmission(opts.stateRoot, key, ckey, opts);
    if (!['created', 'already_present'].includes(durableTombstone.status)) {
      return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
    }
    const persisted = setContinuationChoiceLocked(projectRoot, 'denied', opts);
    if (persisted.action !== 'updated') return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
    let purge = { busy: 0, errors: [] };
    if (typeof opts.purge === 'function') {
      try { purge = opts.purge(); } catch { purge = { busy: 1, errors: ['purge_failed'] }; }
    }
    const finalLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
    if (!finalLock || purge?.busy > 0 || purge?.errors?.length > 0
      || purge?.active_leases > 0 || purge?.lease_busy > 0) {
      if (finalLock) releaseControlReservation(finalLock);
      return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
    }
    const final = writeTurn(opts.stateRoot, key, ckey, {
      control_kind: 'denied', control_status: 'denied',
    });
    releaseControlReservation(finalLock);
    if (!['updated', 'created', 'already_present'].includes(final.status)) {
      return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
    }
    const done = writeNotice(opts.stateRoot, key, 'deny_pending', 'denied');
    if (!['updated', 'conflict'].includes(done.status)) return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
    return { status: 'control_in_progress', control: true, marker: DISABLED };
  };
  let lock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
  if (!lock) {
    // The foreground allow is already backed by a fresh, project-scoped
    // notice receipt.  A short-lived control-lock collision must not turn a
    // successful user choice into an endless re-prompt (this is observable in
    // Codex when a Hook and the foreground shim finish at the same time).
    // Persist the authoritative preference directly and treat the replay
    // turn/notice close as auxiliary; the next foreground entry can repair
    // those files.  Deny remains fail-closed while a tombstone is present.
    const allowable = choice === 'allowed'
      && opts.source !== 'hook'
      && preNotice.status === 'valid'
      && (noticeCapabilityFresh(preNotice)
        || acceptedControlFact(opts.stateRoot, key, choice, preTurn, preTombstone))
      && preTombstone.status !== 'valid'
      && preTombstone.status !== 'corrupt';
    if (!allowable) return retry();
    const persisted = setContinuationChoiceLocked(projectRoot, 'allowed', opts);
    if (persisted.action !== 'updated') return retry(ALLOW_RETRY);
    const expected = preNotice.value.status;
    const done = expected === 'allowed'
      ? { status: 'conflict' }
      : writeNotice(opts.stateRoot, key, expected, 'allowed');
    return {
      status: 'control_in_progress',
      control: true,
      marker: ALLOWED,
      control_turn_persisted: false,
      notice_persisted: ['updated', 'conflict'].includes(done.status),
      ...(done.status === 'updated' || done.status === 'conflict'
        ? {} : { notice_error: done.reason || 'notice_write_failed' }),
      control_turn_error: 'control_busy',
    };
  }
  let receipt;
  let turn;
  let tombstone;
  try {
    const notice = readNoticeReceipt(opts.stateRoot, key);
    receipt = notice.status === 'valid' ? notice.value : null;
    tombstone = readDenyTombstone(opts.stateRoot, key);
    turn = readControlTurn(opts.stateRoot, key, ckey);
    if (notice.status === 'valid' && !noticeCapabilityFresh(notice)
      && !acceptedControlFact(opts.stateRoot, key, choice, turn, tombstone)) {
      if (choice === 'allowed' && tombstone.status === 'valid') {
        return { status: 'control_in_progress', control: true, marker: DISABLE_RETRY };
      }
      return null;
    }
    // Any deny fact wins over an allow replay.  A malformed/foreign
    // tombstone is also fail-closed and must not be guessed around.
    if (tombstone.status === 'valid' || tombstone.status === 'corrupt') {
      if (choice === 'denied') {
        if (tombstone.status === 'corrupt') {
          // Keep the fail-closed gate while repairing an untrusted directory
          // entry: persist disabled first, atomically quarantine the entry
          // itself (including symlinks/special files), then recreate a
          // durable valid tombstone. Never parse or unlink it directly.
          releaseControlReservation(lock); lock = null;
          const disabled = setContinuationChoiceLocked(projectRoot, 'denied', opts);
          if (disabled.action !== 'updated') return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
          const quarantined = quarantineDenyTombstone(opts.stateRoot, key);
          if (!['quarantined', 'missing'].includes(quarantined.status)) {
            return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
          }
          const recreated = writeDenyWithAdmission(opts.stateRoot, key, ckey, opts);
          if (!['created', 'already_present'].includes(recreated.status)) {
            return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
          }
          return completeDenied();
        }
        if (turn.status === 'valid' && ['denied', 'deny_pending', 'retryable'].includes(turn.value.control_status)) {
          if (turn.value.control_status === 'denied') return { status: 'control_in_progress', control: true, marker: DISABLED };
          releaseControlReservation(lock); lock = null;
          return completeDenied();
        }
        if (tombstone.status === 'valid' && turn.status === 'missing') {
          // A Hook may have created only the bounded tombstone before the
          // host process exited. Foreground replay must reconstruct the
          // deny_pending control/notice phase instead of returning retry
          // forever with no turn to advance.
          releaseControlReservation(lock); lock = null;
          const controlLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
          if (!controlLock) return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
          let created = false;
          try {
            const result = writeTurn(opts.stateRoot, key, ckey, {
              control_kind: 'denied', control_status: 'deny_pending',
            }, { firstWriter: true });
            created = ['created', 'already_present'].includes(result.status);
          } finally { releaseControlReservation(controlLock); }
          if (!created) return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
          const currentNotice = readNoticeReceipt(opts.stateRoot, key);
          if (currentNotice.status === 'valid' && currentNotice.value.status === 'awaiting_choice') {
            const advanced = writeNotice(opts.stateRoot, key, 'awaiting_choice', 'deny_pending');
            if (!['updated', 'conflict'].includes(advanced.status)) return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
          }
          return completeDenied();
        }
        return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
      }
      return { status: 'control_in_progress', control: true, marker: tombstone.status === 'valid' ? DISABLED : CONTROL_RETRY };
    }
    // Replay receipt is the authoritative bridge between Hook and Python.
    if (turn.status === 'corrupt') return retry();
    if (turn.status === 'valid') {
      const state = turn.value.control_status;
      if (choice === 'allowed' && state === 'allowed') return { status: 'control_in_progress', control: true, marker: ALLOWED };
      if (choice === 'denied' && state === 'denied') return { status: 'control_in_progress', control: true, marker: DISABLED };
      if (choice === 'allowed' && state === 'allowed_pending') {
        releaseControlReservation(lock); lock = null;
        return finishAllowed();
      }
      if (state === 'allowed_pending' || state === 'deny_pending' || state === 'retryable') {
        return { status: 'control_in_progress', control: true, marker: state === 'deny_pending' ? DISABLE_RETRY : CONTROL_RETRY };
      }
      // Opposite choice cannot overturn an existing control turn.
      return { status: 'control_in_progress', control: true, marker: CONTROL_RETRY };
    }
    if (!receipt) {
      // No applicable notice means this familiar phrase is ordinary user
      // text.  Do not swallow it or mutate reporting state globally.
      return null;
    }
    if (!['pending_output', 'awaiting_choice', 'allow_pending', 'deny_pending'].includes(receipt.status)) {
      return { status: 'control_in_progress', control: true, marker: CONTROL_RETRY };
    }
    if (choice === 'allowed' && !['pending_output', 'awaiting_choice'].includes(receipt.status)) {
      return { status: 'control_in_progress', control: true, marker: CONTROL_RETRY };
    }
    if (choice === 'denied' && !['pending_output', 'awaiting_choice'].includes(receipt.status)) {
      return { status: 'control_in_progress', control: true, marker: CONTROL_RETRY };
    }
    if (choice === 'allowed') {
      // First writer wins for the project/fingerprint/version replay bridge.
      const created = writeTurn(opts.stateRoot, key, ckey, {
        control_kind: choice, control_status: 'allowed_pending',
      }, { firstWriter: true });
      if (!['created', 'already_present'].includes(created.status)) {
        // The replay file is auxiliary to the actual user choice.  Some
        // hosts can write the existing control directory but cannot create
        // its first control-turns child (for example a desktop sandbox).
        // Persist the choice and close the notice before returning so the
        // user is not asked again every foreground turn.  A later entry can
        // still recreate the replay file when the directory becomes
        // writable.
        releaseControlReservation(lock); lock = null;
        const persisted = setContinuationChoiceLocked(projectRoot, 'allowed', opts);
        if (persisted.action !== 'updated') return retry(ALLOW_RETRY);
        const currentNotice = readNoticeReceipt(opts.stateRoot, key);
        const expected = currentNotice.status === 'valid' ? currentNotice.value.status : null;
        if (expected && expected !== 'allowed') {
          const done = writeNotice(opts.stateRoot, key, expected, 'allowed');
          // The project preference was already durably written.  A notice
          // receipt that cannot be closed is recoverable bookkeeping, not a
          // reason to ask the user again on every subsequent Prompt.
          return {
            status: 'control_in_progress',
            control: true,
            marker: ALLOWED,
            control_turn_persisted: false,
            notice_persisted: ['updated', 'conflict'].includes(done.status),
            notice_error: ['updated', 'conflict'].includes(done.status) ? undefined : (done.reason || 'notice_write_failed'),
            control_turn_error: created.reason || 'control_turn_unavailable',
          };
        }
        return {
          status: 'control_in_progress',
          control: true,
          marker: ALLOWED,
          control_turn_persisted: false,
          control_turn_error: created.reason || 'control_turn_unavailable',
        };
      }
      releaseControlReservation(lock); lock = null;
      // Do not advance to allow_pending before the authoritative preference
      // is written.  `finishAllowed()` persists the choice first, then
      // closes the auxiliary replay/notice records best-effort.
    } else {
      // Deny is ordered tombstone → replay control → notice.  This ensures a
      // crash after the kill switch is durable can always be resumed.
      releaseControlReservation(lock); lock = null;
      const tomb = writeDenyWithAdmission(opts.stateRoot, key, ckey, opts);
      if (!(opts.source === 'hook' ? ['pending', 'already_present'].includes(tomb.status) : ['created', 'already_present'].includes(tomb.status))) {
        return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
      }
      // Hook stops at the bounded tombstone close. Control turn, notice,
      // preference and purge are foreground-only maintenance work.
      if (opts.source === 'hook') return { status: 'control_in_progress', control: true, marker: DISABLE_RETRY };
      const controlLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
      if (!controlLock) return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
      try {
        const created = writeTurn(opts.stateRoot, key, ckey, {
          control_kind: choice, control_status: 'deny_pending',
        }, { firstWriter: true });
        if (!['created', 'already_present'].includes(created.status)) {
          return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
        }
      } finally { releaseControlReservation(controlLock); }
      const advanced = writeNotice(opts.stateRoot, key, receipt.status, 'deny_pending');
      if (!['updated', 'conflict'].includes(advanced.status)) {
        return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
      }
    }
  } finally {
    // The control reservation must never be held while preference/purge work
    // executes; those operations have their own lock and may be retried.
    releaseControlReservation(lock);
  }

  if (choice === 'allowed') {
    return finishAllowed();
  }

  // Hook only establishes the kill switch and leaves foreground cleanup to
  // the Python shim.  This keeps the hot path bounded while making replay
  // deterministic and preventing the choice from entering telemetry.
  if (opts.source === 'hook') return { status: 'control_in_progress', control: true, marker: DISABLE_RETRY };
  const tomb = writeDenyWithAdmission(opts.stateRoot, key, ckey, opts);
  if (!['created', 'already_present'].includes(tomb.status)) {
    return { status: 'control_retry', control: true, marker: DISABLE_RETRY };
  }
  return completeDenied();
}

/** Recognize only narrow, explicit opt-in/out control messages. */
export function preferenceFromText(text) {
  if (typeof text !== 'string') return null;
  let normalized = text.trim().replace(/\s+/g, ' ').replace(/[。.!！?？ ]+$/u, '').toLowerCase();
  normalized = normalized.replace(/^(?:请帮我|麻烦帮我|麻烦|帮我|请|please\s+)?/iu, '').trim();
  if (OFF_TEXTS.has(normalized)) return false;
  if (ON_TEXTS.has(normalized)) return true;
  return null;
}

/** Legacy cache location used by reporting.py before project state existed.
 *
 * Migration boundary (C20.1b): resolveEffectivePreference no longer reads
 * this path. Users who stored their preference ONLY in this XDG cache (and
 * never ran the Node runtime after the project-scoped preference.json was
 * introduced) will not inherit their old setting. This is intentional: the
 * new installer (writePromptReportingPreference in bin/cli.js) writes to
 * the project state directory's state.json on every install, so any user who upgrades via
 * the installer will have their preference migrated automatically.
 *
 * If silent migration of the XDG cache is ever needed, add a one-shot read
 * of this path inside the 'both missing' branch of resolveEffectivePreference,
 * guarded by a once-written migration-sentinel flag in preference.json.
 */
export function legacyCachePath(projectRoot, env = process.env) {
  const key = createHash('sha256').update(canonicalRoot(projectRoot)).digest('hex').slice(0, 16);
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'trtc-traces', `reporting-state-${key}.json`);
}
