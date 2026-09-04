// outbox.js — durable local event queue (V2 telemetry).
//
// See rollout §3 C5 for the locked contract. Concurrency-safety design:
//
//   * Filename schema is `<event_id>.json`. That, combined with `linkSync`
//     from tmp → final, gives us TRUE filesystem-level first-writer-wins:
//     two concurrent writes with the same event_id resolve to exactly one
//     file, atomically. `linkSync` on macOS/APFS reliably reports EEXIST to
//     the loser (verified by direct experiment; unlike unlinkSync which
//     lies to concurrent racers).
//
//   * Deletion during eviction uses rename(src → .claim-<pid>-<hex>.<name>)
//     as the atomic ownership grab, then commits via a compact TOMBSTONE
//     inside `dropped/<eid>.json` (again via linkSync, so same-eid
//     duplicate drops resolve to exactly one tombstone).
//
//   * Recovery: an orphan `.claim-<dead-pid>-<hex>.*.json` file left by a
//     crashed process is picked up by GC and committed to dropped/. Only
//     ESRCH (isPidAlive === false) qualifies; alive or unknown liveness
//     is left untouched.
//
//   * Orphan `.<hex>.*.tmp` files (crashed writers) are age-swept after 1d.
//
// Directory layout under `<stateRoot>/telemetry/`:
//   pending/    hook-captured, not yet attributed (payload files)
//   outbox/    complete, ready for Sender (payload files)
//   rejected/   schema-invalid; retention cap only, no drop counter impact
//   dropped/    COMPACT tombstones (no prompt/text content)
//
// Tombstone shape (kept small; no prompt contents leaked to a longer-lived
// on-disk artifact than needed):
//   { event_id, type, priority, reason, dropped_at }

import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';

import { isPidAlive } from './identity.js';
import { performance } from 'node:perf_hooks';
import { listActiveProducerLeases, readProjectDenyGate } from './control.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELEMETRY_DIR = 'telemetry';
const PENDING = 'pending';
const OUTBOX = 'outbox';
const REJECTED = 'rejected';
const DROPPED = 'dropped';
const LEGACY_UNATTRIBUTED = 'legacy-unattributed';

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;         // 7 days
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;                 // 10 MB
const DEFAULT_REJECTED_MAX = 200;
const DEFAULT_ORPHAN_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;  // 1 day
const DEFAULT_DROPPED_MAX_FILES = 10_000;
// Corrupt-file grace window: an unparseable `<eid>.json` may be a mid-write
// on the degraded (linkSync-unsupported) fallback path where the writer
// writes body chunks directly to finalPath. Never unlink until the file has
// been quiet for `corruptGraceMs`; a legitimate writer completes in μs so
// any file whose mtime hasn't advanced in 60s belongs to a dead writer.
// Choosing this at 60s is a lot of headroom for slow disks / paused
// debuggers; false-wait is fine, false-cleanup would kill an active writer.
const DEFAULT_CORRUPT_GRACE_MS = 60 * 1000;

// Priority tiers — evict order runs from P3 → P2 → P1 → P0.
const P0_EVENTS = new Set([
  'install_completed', 'install_failed',
  'upgrade_completed', 'upgrade_failed',
  'hook_activated',
]);
const P1_EVENTS = new Set([
  'test_run_started', 'test_run_completed',
  'upgrade_started',
]);

// event_id must be a safe filename fragment:
//   - 1..128 chars from [A-Za-z0-9._-]
//   - first char MUST be [A-Za-z0-9_] (rejects `.` `..` `.hidden` `-x`)
//     otherwise the resulting `<eid>.json` becomes a dot-prefixed file that
//     listDir() filters out → hidden ghost event, never GC'd
//   - not a Windows reserved basename (case-insensitive) — CON PRN AUX NUL
//     COM1..COM9 LPT1..LPT9. Windows treats these as reserved even with an
//     extension appended (NUL.txt / CON.log / COM1.data → same device), so
//     we reject the reserved name whether alone or followed by `.`.
const EVENT_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

/**
 * True iff `id` is a safe filename fragment for use as an event_id anywhere
 * in the telemetry tree.
 *
 * This is the SAME rule enforced by `requireEventId` for internal writes,
 * exposed so callers (state.js) can gate an untrusted `eventId` parameter
 * BEFORE composing it into a path. Kills `../outbox/legit` style traversal
 * attacks where a malicious eventId is resolved outside pending/ by
 * `path.join` collapsing `..` segments.
 *
 * Rejects: empty / non-string / leading `.` / leading `-` / any `/` or `\` /
 * length > 128 / Windows reserved device names (CON, NUL, COM1..9, LPT1..9,
 * PRN, AUX — with or without extension).
 */
export function isSafeEventId(id) {
  return typeof id === 'string'
    && id.length > 0
    && EVENT_ID_RE.test(id)
    && !WINDOWS_RESERVED_RE.test(id);
}
const FINAL_FILENAME_RE = /^([A-Za-z0-9._-]{1,128})\.json$/;
// `.claim-<pid>-<hex>.<eid>.json`
const CLAIM_FILENAME_RE = /^\.claim-(\d+)-[a-f0-9]+\.((?:[A-Za-z0-9._-]{1,128})\.json)$/;
const TMP_FILENAME_RE = /^\.[a-f0-9]+\..+\.tmp$/;

// Enrichment fields that Dispatcher / State are allowed to merge onto a
// pending event during promoteToOutbox. Base identity fields (event_id,
// time, method, text, schema_version, client_generation, platform) are
// immutable — attempts to override them via enrichment are silently
// dropped so a mis-typed enricher cannot rewrite event identity.
const ALLOWED_ENRICHMENT_KEYS = new Set([
  'useragent',
  'identity_scope',
  'identity_pending',
  'skillname',
  'product',
  'framework',
  'flow_id',
  'turn_id',
  'sdkappid',
  'delivery_guarantee',
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function resolveTelemetryRoot(stateRoot) {
  return join(stateRoot, TELEMETRY_DIR);
}

function subdirs(root) {
  const tel = resolveTelemetryRoot(root);
  return {
    tel,
    pending: join(tel, PENDING),
    outbox: join(tel, OUTBOX),
    rejected: join(tel, REJECTED),
    dropped: join(tel, DROPPED),
    legacy: join(tel, LEGACY_UNATTRIBUTED),
  };
}

function isPosix() { return process.platform !== 'win32'; }

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: isPosix() ? 0o700 : undefined });
  if (isPosix()) {
    try { chmodSync(dir, 0o700); } catch { /* SMB/FAT lacks POSIX bits */ }
  }
}

function ensureLayout(root) {
  const d = subdirs(root);
  ensureDir(d.tel);
  ensureDir(d.pending);
  ensureDir(d.outbox);
  ensureDir(d.rejected);
  ensureDir(d.dropped);
  return d;
}

// ---------------------------------------------------------------------------
// Per-eid reservation lock (round-8) — mechanism-layer serialization
// ---------------------------------------------------------------------------
//
// The reservation lock is a file at `<pending>/.reserve-<eid>` created via
// O_EXCL (atomic no-clobber). ALL five state-mutating primitives that
// touch a given event_id — writePending, writeOutbox, state.promote,
// evictOneWithReason, recoverOrphanClaims — must hold this lock before
// they read or modify pending/<eid>.json, outbox/<eid>.json, or
// dropped/<eid>.json. This is the ONLY mechanism-layer guarantee against
// the "check-and-commit" interleaving that layered existsSync/unlinkSync
// checks (rounds 4–7) cannot close.
//
// Codex round-8 reproduction (event completely lost):
//   Writer                                GC
//   ── create pending/<eid> ──
//                                         rename pending → claim
//                                         canonical pre-check: absent
//                                         commit dropped/<eid>
//   unlink dropped/<eid>  (writePending's round-7 sweep)
//                                         canonical post-check: absent
//                                         unlink claim
//   → three buckets are empty; event lost.
//
// Under the reservation lock this interleaving is impossible: whichever
// side acquires first runs to completion; the other observes the
// resulting steady state and dedups.
//
// File naming: `.reserve-<eid>` is invisible to all existing filters
// (CLAIM_FILENAME_RE, FINAL_FILENAME_RE, TMP_FILENAME_RE, isFinalEventFile,
// listDir) because they either require a specific prefix or exclude dot-
// files. No cross-scan interaction.
//
// Body: `<pid>\n<startMs>\n` — used only by orphan cleanup to detect
// crashed holders (dead PID + past graceMs → unlink).

const RESERVATION_PREFIX = '.reserve-';
const RESERVATION_FILENAME_RE = /^\.reserve-([A-Za-z0-9._-]{1,128})$/;
// Round-11: cleaner-owned scratch files use a DIFFERENT prefix so
// they do NOT match RESERVATION_FILENAME_RE. This lets iterators
// distinguish "reservation locks" from "cleaner-side rename targets"
// without extra parsing, and prevents a cleaner-owned file from being
// re-interpreted as a reservation in a subsequent gc pass.
const RESERVATION_SCRATCH_PREFIX = '.reservation-scratch-';
const RESERVATION_SCRATCH_RE = /^\.reservation-scratch-\d+-[a-f0-9]+\./;
// Round-12: cleanup mutex is now an O_EXCL FILE lock (was a mkdir
// directory in round-11). Files carry a `<pid>\n<startMs>\n<token>\n`
// body identical to per-eid reservations, so we can reuse the same
// dead-holder detection + atomic-steal protocol used for reservation
// orphans. This closes the round-11 gate item: a cleaner that crashed
// while holding the mutex would leave the directory in place forever
// with no safe recovery path (mkdir cannot be safely stolen because
// rmdir+mkdir is not atomic). The file-lock form supports:
//   * fresh acquire: openSync(path, 'wx') — atomic single-winner
//   * dead-holder steal: renameSync(path, .stealing-<pid>-<hex>) →
//     verify body still matches sampled → unlink → retry O_EXCL
// Rename is POSIX-atomic single-winner, so two racing stealers can
// never both succeed. Steal is only permitted when the current
// holder's PID is dead (`liveness(pid) === false`) AND the recorded
// startMs is past `mutexOrphanGraceMs` (default = reservation orphan
// grace, 60 s). Live or unknown holders never triggered.
const RESERVATION_CLEANUP_LOCK_FILE = '.reservation-cleanup.lock';
const RESERVATION_CLEANUP_STEAL_PREFIX = '.reservation-cleanup.stealing-';
const RESERVATION_CLEANUP_STEAL_RE = /^\.reservation-cleanup\.stealing-\d+-[a-f0-9]+$/;
const DEFAULT_RESERVATION_TIMEOUT_MS = 1000;
const DEFAULT_RESERVATION_GC_TIMEOUT_MS = 100;
// Round-9: Hook-stage callers MUST use this short timeout so a single
// event never blocks the Hook longer than V2.3 §17.2's <50ms budget.
// `writePendingFromHook` hardcodes it — Hook integrations cannot mis-
// configure by omission.
const HOOK_RESERVATION_TIMEOUT_MS = 25;
const DEFAULT_RESERVATION_ORPHAN_GRACE_MS = 60 * 1000;
// Backoff bounds. Kernel-level fs contention resolves in µs–ms.
const RESERVATION_BACKOFF_START_MS = 1;
const RESERVATION_BACKOFF_MAX_MS = 10;

// Sync sleep primitive via Atomics.wait on a dummy SharedArrayBuffer.
// Node's stdlib has no sync sleep; busy-wait would burn CPU. This is a
// blocking kernel wait bounded by `ms` — precise enough for backoff.
const _syncSleepBuf = new Int32Array(new SharedArrayBuffer(4));
function _syncSleep(ms) {
  if (ms <= 0) return;
  Atomics.wait(_syncSleepBuf, 0, 0, ms);
}

export function _reservationPathFor(pendingDir, eventId) {
  return join(pendingDir, `${RESERVATION_PREFIX}${eventId}`);
}

// Round-12: global single-cleaner-at-a-time mutex for
// `cleanupOrphanReservations`. Switched from a `mkdirSync` directory
// (round-11) to an O_EXCL FILE lock so a cleaner that crashes while
// holding the mutex can be safely recovered — a directory-form mutex
// has no atomic steal path (rmdir+mkdir is not single-winner), which
// was the round-12 gate item.
//
// Protocol:
//   1. `openSync(path, 'wx')` — atomic no-clobber create; success →
//      write `<pid>\n<startMs>\n<token>\n` body, return handle.
//   2. On EEXIST: sample the holder's body + stat. If holder PID is
//      dead (`liveness(pid) === false`) AND `nowMs - startMs > graceMs`,
//      try to atomically steal:
//        a. `renameSync(path, .reservation-cleanup.stealing-<pid>-<hex>)`.
//           POSIX-atomic single-winner. ENOENT → someone else stole
//           first; return null (they will run cleanup).
//        b. Re-read the moved inode; body must equal the sampled body,
//           else a legit acquire raced between our stat and rename —
//           restore via linkSync (EEXIST tolerated, drop our copy) and
//           return null.
//        c. Body matches: unlink the stealing file, then retry step 1.
//   3. Otherwise (live or unknown-liveness holder): return null.
//
// Under this protocol two cleaners never both hold the mutex, and a
// dead cleaner's mutex is reclaimed on the next gc pass by whoever
// wins the atomic rename.
//
// Handle shape mirrors reservation locks: `{path, token}`. Release
// verifies token before unlinking (a dead-holder steal + fresh acquire
// leaves a different token; the original crashed holder's release —
// which never fires because the holder died — would have used the old
// token and been rejected anyway).
function _tryAcquireCleanupMutex(pendingDir, opts) {
  const nowFn = opts && opts.now ? opts.now : Date.now;
  const liveness = (opts && opts.isPidAlive) || isPidAlive;
  const graceMs = num(opts && opts.mutexOrphanGraceMs, DEFAULT_RESERVATION_ORPHAN_GRACE_MS);
  const lockPath = join(pendingDir, RESERVATION_CLEANUP_LOCK_FILE);

  // Allow one steal attempt per acquire call. A second EEXIST after a
  // successful steal means someone acquired in between our steal and
  // retry — legit contention, return null and let them finish.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomBytes(16).toString('hex');
    const startMs = nowFn();
    const body = `${process.pid}\n${startMs}\n${token}\n`;
    let fd;
    try {
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        // Sample holder body + stat to decide whether to steal.
        let holderBody;
        try { holderBody = readFileSync(lockPath, 'utf8'); }
        catch (readErr) {
          if (readErr && readErr.code === 'ENOENT') continue;   // gone, retry
          throw readErr;
        }
        let holderStat;
        try { holderStat = statSync(lockPath); }
        catch (statErr) {
          if (statErr && statErr.code === 'ENOENT') continue;   // gone, retry
          throw statErr;
        }
        const parts = holderBody.split('\n');
        const holderPid = Number(parts[0]);
        const holderStart = Number(parts[1]);
        const nowMs = nowFn();
        // Round-13: fallback path for empty / half-written / illegal
        // OWNER content. A crashed writer that failed after
        // `openSync('wx')` but before flushing the body leaves an
        // unparseable file that the round-12 protocol could NOT steal
        // (Number.isInteger / Number.isFinite guards both fail →
        // isStale=false → return null → mutex jammed forever).
        //
        // Two-arm stale test:
        //   * body parses (both PID and startMs) → legacy protocol:
        //     PID is dead AND body's own startMs is past grace.
        //   * body does NOT parse → treat as garbage from a crashed
        //     writer; steal if the inode's own mtime is past grace.
        //     Under mutex there is no legitimate holder producing a
        //     half-written body — a live acquire completes the write
        //     within microseconds, so anything past grace with an
        //     unparseable body is a crashed writer with no owner to
        //     protect.
        const parseable =
          Number.isInteger(holderPid) && holderPid > 0 &&
          Number.isFinite(holderStart);
        let isStale;
        if (parseable) {
          isStale = liveness(holderPid) === false && nowMs - holderStart > graceMs;
        } else {
          isStale = nowMs - holderStat.mtimeMs > graceMs;
        }
        if (!isStale) return null;
        if (attempt > 0) return null;   // already stole once; treat this as live contention

        // Atomic steal via rename. Two racing stealers cannot both win.
        const stealName = `${RESERVATION_CLEANUP_STEAL_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`;
        const stealPath = join(pendingDir, stealName);
        try {
          renameSync(lockPath, stealPath);
        } catch (renameErr) {
          if (renameErr && renameErr.code === 'ENOENT') return null;   // beat us to it
          throw renameErr;
        }

        // Verify: a legit acquire may have replaced the file between
        // our sample and rename (rename operates on the directory
        // entry — the inode we grabbed could be a new one).
        let movedBody;
        try { movedBody = readFileSync(stealPath, 'utf8'); }
        catch (readErr) {
          if (readErr && readErr.code === 'ENOENT') return null;
          throw readErr;
        }
        if (movedBody !== holderBody) {
          // Restore: legit holder — link the stolen file back at
          // lockPath. EEXIST → third actor re-populated, drop copy.
          try { linkSync(stealPath, lockPath); }
          catch (linkErr) { if (!linkErr || linkErr.code !== 'EEXIST') throw linkErr; }
          try { unlinkSync(stealPath); }
          catch (unlinkErr) { if (!unlinkErr || unlinkErr.code !== 'ENOENT') throw unlinkErr; }
          return null;
        }
        try { unlinkSync(stealPath); }
        catch (unlinkErr) { if (!unlinkErr || unlinkErr.code !== 'ENOENT') throw unlinkErr; }
        continue;   // retry O_EXCL create
      }
      throw err;
    }
    // Won O_EXCL. Write body (no fsync — cleanup mutex is transient,
    // orphan detection is content-based, same reasoning as round-12
    // change to reservation locks).
    try { writeAll(fd, body); }
    finally { closeSync(fd); }
    return { path: lockPath, token };
  }
  return null;
}

function _releaseCleanupMutex(handle) {
  if (!handle) return;
  let body;
  try { body = readFileSync(handle.path, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  const parts = body.split('\n');
  if (parts.length < 3 || parts[2] !== handle.token) return;
  try { unlinkSync(handle.path); }
  catch (err) { if (err && err.code !== 'ENOENT') throw err; }
}

/**
 * Low-level reservation acquire that takes a resolved pending directory
 * instead of a state root. Used by GC-internal call sites where the
 * telemetry layout is already resolved and we want to avoid an extra
 * `ensureLayout` traversal per event.
 *
 * @returns {string|null} lock path on success, `null` on timeout.
 */
function _acquireReservationByPending(pendingDir, eventId, opts = {}) {
  if (!isSafeEventId(eventId)) {
    throw new TypeError(
      `acquireReservation: eventId must be a safe filename fragment: ${JSON.stringify(eventId)}`,
    );
  }
  const lockPath = _reservationPathFor(pendingDir, eventId);
  // Round-9 owner-token: write a per-acquire random nonce into the lock
  // file. releaseReservation reads the file back and only unlinks if the
  // token matches — prevents the "orphan cleanup (or wrong-liveness
  // mock) unlinks our lock while we still nominally hold it, another
  // actor acquires a fresh lock, we then release and clobber theirs"
  // ownership-swap bug. Token is 128 bits — collision-free at any real
  // scale.
  const token = randomBytes(16).toString('hex');
  // `opts.now` feeds ONLY the body's `startMs` field (visible metadata,
  // used by orphan-cleanup to age the lock). It does NOT drive the
  // deadline clock — a test that freezes opts.now must not cause the
  // acquire loop to spin forever, and a system clock jump must not
  // extend or contract the timeout. Round-10: switched to
  // performance.now() (monotonic, unaffected by test injection or wall-
  // clock skew) for deadline math.
  const startMs = (opts.now || Date.now)();
  const body = `${process.pid}\n${startMs}\n${token}\n`;
  const timeoutMs = num(opts.reservationTimeoutMs, DEFAULT_RESERVATION_TIMEOUT_MS);
  const deadlineMono = performance.now() + timeoutMs;
  let backoff = RESERVATION_BACKOFF_START_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        const remainingMs = deadlineMono - performance.now();
        if (remainingMs <= 0) return null;
        // Round-12: clamp sleep to remaining time so we never blow
        // past the deadline by up to a full backoff quantum
        // (RESERVATION_BACKOFF_MAX_MS = 10ms). Before this change the
        // acquire could return null up to ~10ms past deadlineMono,
        // pushing writePendingFromHook's throw beyond its HOOK+15ms
        // budget. See rollout §7 C6 round-12.
        _syncSleep(Math.min(backoff, remainingMs));
        backoff = Math.min(backoff * 2, RESERVATION_BACKOFF_MAX_MS);
        continue;
      }
      throw err;
    }
    try {
      writeAll(fd, body);
      // Round-12: NO fsync on the reservation lock body. This is a
      // transient artifact — its only reader is orphan cleanup, which
      // is content-based (parses PID from body, checks liveness +
      // grace). If we crash before the write reaches disk, orphan
      // cleanup will treat the file as unparseable-past-grace and
      // reclaim it. Fsync here added ~10–30ms of macOS APFS jitter
      // per Hook call for no correctness benefit — the round-11 U28
      // p95=51ms failure traced back here (3× fsync per writePending:
      // lock body + event body + dir; the lock fsync is the only
      // one whose durability is not part of the contract).
    } finally {
      closeSync(fd);
    }
    return { path: lockPath, token };
  }
}

/**
 * Attempt to acquire the reservation lock for `eventId` under `root`.
 *
 * Blocks up to `opts.reservationTimeoutMs` (default 1000ms) waiting for a
 * concurrent holder to release. Uses `O_EXCL` create for atomic
 * winner-only semantics — EEXIST means someone else holds it, retry
 * after backoff.
 *
 * @returns {{path: string, token: string}|null} lock handle on success,
 *   `null` on timeout. The `token` field is required by
 *   releaseReservation to authenticate ownership (round-9).
 */
export function acquireReservation(root, eventId, opts = {}) {
  const d = ensureLayout(root);
  return _acquireReservationByPending(d.pending, eventId, opts);
}

/**
 * Release a reservation lock acquired via `acquireReservation` /
 * `_acquireReservationByPending`. Round-9 owner-token protocol: reads
 * the lock file, verifies the token matches ours, and ONLY THEN unlinks.
 * If the file has been replaced (orphan cleanup + another actor
 * acquired), we return silently — the other actor now owns it.
 *
 * Round-11: the legacy string form is REMOVED. All callers must pass
 * the `{path, token}` handle returned by `acquireReservation`. Passing
 * a string throws `TypeError` — bypassing the token protocol is not
 * permitted from any code path (see rollout §7 C6 round-11).
 *
 * Accepts `null` / `undefined` (no-op).
 */
export function releaseReservation(lock) {
  if (!lock) return;
  if (typeof lock !== 'object' || typeof lock.path !== 'string' || typeof lock.token !== 'string') {
    throw new TypeError(
      'releaseReservation: expected {path, token} handle from acquireReservation; '
      + 'legacy string form was removed in round-11 to preserve the token-based '
      + 'ownership protocol. Got: ' + JSON.stringify(lock),
    );
  }
  const { path, token } = lock;
  // Token check: read the file and confirm we still own it. If the
  // file is gone (ENOENT), someone (orphan cleanup) removed our lock;
  // nothing to release, our critical section is anyway done. If the
  // file exists but contains a DIFFERENT token, another actor
  // acquired after ours was unlinked — don't touch theirs.
  let body;
  try { body = readFileSync(path, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  const parts = body.split('\n');
  // Format: `<pid>\n<startMs>\n<token>\n`. `token` is line index 2.
  if (parts.length < 3 || parts[2] !== token) return;
  try { unlinkSync(path); }
  catch (err) { if (err && err.code !== 'ENOENT') throw err; }
}

/**
 * Cleanup abandoned reservation locks. Round-12 rewrite: mutex is
 * now an O_EXCL file lock (previously a `mkdirSync` directory), so a
 * cleaner that crashes while holding the mutex is safely stealable by
 * the next gc pass — see `_tryAcquireCleanupMutex` for the atomic
 * steal protocol.
 *
 * Sequence:
 *   1. `_tryAcquireCleanupMutex(pendingDir, opts)`. Returns null if
 *      another live cleaner has the mutex; returns null after a failed
 *      steal attempt on a stale (dead-holder past-grace) mutex if a
 *      third actor won the steal race. Returns a `{path, token}`
 *      handle when we hold it.
 *   2. Sweep `.reservation-scratch-*` residue unconditionally (we hold
 *      the mutex; no other cleaner can be producing them). Also sweep
 *      `.reservation-cleanup.stealing-*` residue for the same reason
 *      (a mid-steal crash would leave this).
 *   3. For each `.reserve-<eid>` file: sample body+stat → gate on
 *      dead PID + past-grace → renameSync to `.reservation-scratch-
 *      <pid>-<hex>.<eid>` → verify moved body matches sampled → unlink
 *      (matched) or linkSync-restore + unlink scratch (unmatched).
 *   4. `_releaseCleanupMutex(handle)`.
 *
 * The round-9 owner-token check on `releaseReservation` still catches
 * the reverse scenario (holder tries to release a lock that was
 * cleaned + re-acquired by another actor).
 */
function cleanupOrphanReservations(pendingDir, liveness, now, graceMs, opts) {
  const mutex = _tryAcquireCleanupMutex(pendingDir, {
    now, isPidAlive: liveness,
    mutexOrphanGraceMs: (opts && opts.mutexOrphanGraceMs) || graceMs,
  });
  if (mutex === null) return 0;    // another cleaner has it
  try {
    let entries;
    try { entries = readdirSync(pendingDir); }
    catch (err) { if (err && err.code === 'ENOENT') return 0; throw err; }

    // Phase 1: residue sweep. Any `.reservation-scratch-*` file is by
    // definition orphaned — we hold the mutex, so no other cleaner is
    // producing scratch files right now, and any legit acquire uses
    // `.reserve-<eid>` (never the scratch prefix). Same reasoning for
    // `.reservation-cleanup.stealing-*` (round-12): only produced by
    // the mutex steal path, and only while a cleaner holds no mutex —
    // which is not us. Unlink freely.
    for (const name of entries) {
      if (RESERVATION_SCRATCH_RE.test(name) || RESERVATION_CLEANUP_STEAL_RE.test(name)) {
        try { unlinkSync(join(pendingDir, name)); }
        catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      }
    }

    // Phase 2: real orphan cleanup.
    const nowMs = now();
    let cleaned = 0;
    for (const name of entries) {
      if (!RESERVATION_FILENAME_RE.test(name)) continue;
      const p = join(pendingDir, name);

      // Sample body first (authenticates orphan identity below). If
      // unreadable, we fall back to stat-only past-grace unlink —
      // unreadable-past-grace means writer crashed before body was
      // written; no owner to protect.
      let sampledBody;
      try { sampledBody = readFileSync(p, 'utf8'); }
      catch (err) {
        if (err && err.code === 'ENOENT') continue;
        throw err;
      }
      let sampledStat;
      try { sampledStat = statSync(p); }
      catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }

      if (nowMs - sampledStat.mtimeMs < graceMs) continue;

      const first = sampledBody.split('\n', 1)[0];
      const pidNum = Number(first);
      const pid = Number.isInteger(pidNum) && pidNum > 0 ? pidNum : null;
      // Corrupt body (no PID). Past grace + unparseable → stale.
      if (pid === null) {
        try { unlinkSync(p); cleaned++; }
        catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
        continue;
      }
      if (liveness(pid) !== false) continue;

      // Atomic claim via rename to scratch. The scratch prefix
      // guarantees this file will not be re-interpreted as a
      // reservation on any subsequent gc iteration.
      const eidPart = name.slice(RESERVATION_PREFIX.length);
      const scratchName = `${RESERVATION_SCRATCH_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}.${eidPart}`;
      const scratchPath = join(pendingDir, scratchName);
      try {
        renameSync(p, scratchPath);
      } catch (err) {
        if (err && err.code === 'ENOENT') continue;   // moved by someone else
        throw err;
      }

      // Re-read the moved inode. Body must equal sampledBody for us
      // to confirm this is the orphan we identified. An in-band
      // acquire that raced by re-creating `p` between our stat and
      // rename would leave a different body content.
      let movedBody;
      try { movedBody = readFileSync(scratchPath, 'utf8'); }
      catch (err) {
        if (err && err.code === 'ENOENT') continue;
        throw err;
      }

      if (movedBody === sampledBody) {
        try { unlinkSync(scratchPath); cleaned++; }
        catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      } else {
        // Restore: linkSync scratch → p. EEXIST → third actor
        // already re-populated `p`, drop our copy silently.
        try { linkSync(scratchPath, p); }
        catch (err) { if (!err || err.code !== 'EEXIST') throw err; }
        try { unlinkSync(scratchPath); }
        catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      }
    }
    return cleaned;
  } finally {
    _releaseCleanupMutex(mutex);
  }
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

function payloadFilename(eventId) { return `${eventId}.json`; }
function tombstoneFilename(eventId) { return `${eventId}.json`; }

function decodeFinalName(name) {
  const m = FINAL_FILENAME_RE.exec(name);
  if (!m) return null;
  return { event_id: m[1] };
}

function isFinalEventFile(name) {
  if (name.startsWith('.')) return false;
  if (name.endsWith('.tmp')) return false;
  return FINAL_FILENAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// Atomic write with FS-level dedup:
//   tmp (wx) → linkSync(tmp, final).  linkSync EEXIST ⇒ another writer beat us.
// Returns { path, deduped, degraded }.
//   Winner    : deduped=false, degraded=false, file contains our body
//   Loser     : deduped=true, file contains the winner's body
//   Degraded  : some FS (FAT/exFAT/SMB/restricted sandbox) reject hardlinks
//               with ENOTSUP/EOPNOTSUPP/EPERM/EXDEV. Fall back to
//               `openSync(final, 'wx')` — O_CREAT|O_EXCL is atomic exclusive
//               create at the kernel level, so we still get first-writer-wins
//               without hardlink support. The tradeoff we accept on this
//               FS: content is not atomically visible (a mid-write crash
//               leaves a partial `<eid>.json`); GC's `gcBucket` treats an
//               unparseable final file as garbage and removes it.
// ---------------------------------------------------------------------------

// FS-level dedup via linkSync is unavailable on FAT/exFAT/SMB/restricted
// sandboxes. When the platform rejects the hardlink, fall back to a direct
// O_EXCL create at finalPath — atomic no-clobber, at the cost of losing
// tmp+fsync partial-write protection.
const LINK_UNSUPPORTED_CODES = new Set(['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV']);

function writeAll(fd, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  let offset = 0;
  while (offset < buf.length) {
    offset += writeSync(fd, buf, offset, buf.length - offset);
  }
}

/**
 * Degraded no-clobber create used only on filesystems that reject `linkSync`.
 * Uses `openSync(final, 'wx')` which is O_CREAT|O_EXCL — atomic exclusive
 * create at the kernel level. Never overwrites existing content.
 *
 * Exported for direct unit test coverage of the fallback branch.
 */
export function _atomicCreateNoClobber(finalPath, body, opts = {}) {
  const dir = dirname(finalPath);
  let fd;
  try {
    fd = openSync(finalPath, 'wx', 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      return { path: finalPath, deduped: true, degraded: true };
    }
    throw err;
  }
  try {
    writeAll(fd, body);
    if (!opts._skipFileFsync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (isPosix()) {
    try { chmodSync(finalPath, 0o600); } catch { /* best-effort */ }
  }
  if (!opts._skipDirFsync) fsyncDirBestEffort(dir);
  return { path: finalPath, deduped: false, degraded: true };
}

function atomicCreateOrDedupe(finalPath, body, opts = {}) {
  const dir = dirname(finalPath);
  const tmp = join(dir, `.${randomBytes(4).toString('hex')}.${basename(finalPath)}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeAll(fd, body);
    if (!opts._skipFileFsync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let deduped = false;
  try {
    linkSync(tmp, finalPath);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      deduped = true;
    } else if (err && LINK_UNSUPPORTED_CODES.has(err.code)) {
      // Hardlink unsupported. Discard tmp and fall back to a direct O_EXCL
      // create — atomic no-clobber, so we do NOT overwrite an existing file.
      try { unlinkSync(tmp); } catch { /* ignore */ }
      return _atomicCreateNoClobber(finalPath, body, opts);
    } else {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
  try { unlinkSync(tmp); } catch { /* ignore */ }
  if (!deduped) {
    if (isPosix()) {
      try { chmodSync(finalPath, 0o600); } catch { /* best-effort */ }
    }
    // Hook callers may opt out of file + dir fsync. The event is still
    // atomically visible through tmp + hardlink (or O_EXCL fallback), but
    // the OS may lose the newest best-effort prompt event on a power loss.
    // Non-Hook writers keep both syncs because their durability matters.
    if (!opts._skipDirFsync) fsyncDirBestEffort(dir);
  }
  return { path: finalPath, deduped, degraded: false };
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
    ) return;
    throw err;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Public read helpers
// ---------------------------------------------------------------------------

export function readEvent(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  try { return JSON.parse(raw); } catch { return null; }
}

function listDir(dirPath) {
  let entries;
  try { entries = readdirSync(dirPath); }
  catch (err) { if (err && err.code === 'ENOENT') return []; throw err; }
  return entries.filter(isFinalEventFile).sort().map((n) => join(dirPath, n));
}

export function listPending(root) { return listDir(subdirs(root).pending); }
export function listOutbox(root)  { return listDir(subdirs(root).outbox); }
export function listRejected(root) { return listDir(subdirs(root).rejected); }

export function remove(filePath) {
  try { unlinkSync(filePath); }
  catch (err) { if (err && err.code === 'ENOENT') return; throw err; }
}

/**
 * Remove unsent prompt events for one project after an explicit opt-out.
 * Private `__project_key` never crosses the Sender boundary.  Non-prompt
 * events and events from other projects are left untouched.
 */
export function purgeProjectPromptEvents(root, targetProjectKey, opts = {}) {
  if (typeof targetProjectKey !== 'string' || !/^[a-f0-9]{32}$/.test(targetProjectKey)) {
    throw new TypeError('purgeProjectPromptEvents: targetProjectKey must be a 32-char hex key');
  }
  const result = { removed: 0, busy: 0, skipped: 0 };
  for (const path of [...listPending(root), ...listOutbox(root), ...listRejected(root)]) {
    const event = readEvent(path);
    if (!event || event.method !== 'prompt' || event.__project_key !== targetProjectKey) {
      result.skipped++;
      continue;
    }
    const filename = basename(path);
    const eid = filename.endsWith('.json') ? filename.slice(0, -5) : '';
    if (!isSafeEventId(eid)) { result.skipped++; continue; }
    const lock = acquireReservation(root, eid, {
      ...opts,
      reservationTimeoutMs: Math.min(opts.reservationTimeoutMs ?? 25, 25),
    });
    if (!lock) { result.busy++; continue; }
    try {
      const current = readEvent(path);
      if (current && current.method === 'prompt' && current.__project_key === targetProjectKey) {
        remove(path);
        result.removed++;
      }
    } finally {
      releaseReservation(lock);
    }
  }
  return result;
}

/**
 * Purge every active event for a project after an explicit deny.  The
 * operation is intentionally fixed-point rather than a one-shot directory
 * snapshot: a promote can move Pending to Outbox while the first pass is
 * running.  Unattributed legacy entries are quarantined into a terminal,
 * non-sender directory instead of being guessed into a project or deleted.
 */
export function purgeProjectEvents(root, targetProjectKey, opts = {}) {
  if (typeof targetProjectKey !== 'string' || !/^[a-f0-9]{32}$/.test(targetProjectKey)) {
    throw new TypeError('purgeProjectEvents: targetProjectKey must be a 32-char hex key');
  }
  const result = {
    removed: 0, busy: 0, skipped: 0, errors: [], scans: 0, fixed_point: false,
    active_leases: 0, lease_busy: 0,
    legacy_unattributed: { found: 0, quarantined: 0, blocked: 0 },
    by_bucket: { pending: 0, outbox: 0, rejected: 0 },
  };
  let d;
  try { d = ensureLayout(root); }
  catch (err) {
    result.errors.push({ code: err?.code || 'layout_unavailable' });
    result.errors.push({ code: 'purge_retryable' });
    return result;
  }
  try { ensureDir(d.legacy); }
  catch (err) {
    result.errors.push({ code: err?.code || 'legacy_quarantine_unavailable' });
    result.errors.push({ code: 'purge_retryable' });
    return result;
  }
  const maxScans = Math.max(2, Number.isFinite(opts.maxScans) ? opts.maxScans : 3);
  const buckets = [d.pending, d.outbox, d.rejected];
  const bucketName = new Map([[d.pending, 'pending'], [d.outbox, 'outbox'], [d.rejected, 'rejected']]);
  let scanErrors = 0;

  const enumerate = () => {
    const files = [];
    for (const dir of buckets) {
      let names;
      try { names = readdirSync(dir); } catch (err) {
        if (err?.code === 'ENOENT') continue;
        scanErrors++;
        result.errors.push({ bucket: bucketName.get(dir), code: err?.code || 'scan_failed' });
        continue;
      }
      for (const name of names) {
        if (isFinalEventFile(name)) files.push({ dir, path: join(dir, name), name });
      }
    }
    return files;
  };

  for (let pass = 0; pass < maxScans; pass++) {
    result.scans++;
    let activeTarget = 0;
    let activeLegacy = 0;
    let passBusy = 0;
    scanErrors = 0;
    let passErrors = 0;
    const files = enumerate();
    passErrors += scanErrors;
    for (const item of files) {
      let event;
      try { event = readEvent(item.path); } catch (err) {
        result.errors.push({ bucket: bucketName.get(item.dir), code: err?.code || 'read_failed' });
        passErrors++;
        continue;
      }
      const project = event?.__project_key;
      const validKey = typeof project === 'string' && /^[a-f0-9]{32}$/.test(project);
      if (!validKey) {
        activeLegacy++;
        result.legacy_unattributed.found++;
        const rawEid = item.name.replace(/\.json$/, '');
        const eid = isSafeEventId(rawEid) ? rawEid : `legacy-${Date.now()}-${randomBytes(4).toString('hex')}`;
        let lock = null;
        if (isSafeEventId(rawEid)) {
          lock = acquireReservation(root, rawEid, { reservationTimeoutMs: Math.min(opts.reservationTimeoutMs ?? 25, 25) });
          if (!lock) { result.busy++; passBusy++; result.legacy_unattributed.blocked++; continue; }
        }
        try {
          const destination = join(d.legacy, `${eid}-${Date.now()}-${randomBytes(4).toString('hex')}.json`);
          try {
            renameSync(item.path, destination);
            result.legacy_unattributed.quarantined++;
          } catch (err) {
            if (err?.code !== 'ENOENT') {
              result.errors.push({ bucket: bucketName.get(item.dir), event_id: eid, code: err?.code || 'quarantine_failed' });
              passErrors++;
              result.legacy_unattributed.blocked++;
            }
          }
        } finally { if (lock) releaseReservation(lock); }
        continue;
      }
      if (project !== targetProjectKey) { result.skipped++; continue; }
      activeTarget++;
      const eid = item.name.replace(/\.json$/, '');
      if (!isSafeEventId(eid)) { result.busy++; passErrors++; result.errors.push({ bucket: bucketName.get(item.dir), code: 'unsafe_event_id' }); continue; }
      const lock = acquireReservation(root, eid, { reservationTimeoutMs: Math.min(opts.reservationTimeoutMs ?? 25, 25) });
      if (!lock) { result.busy++; passBusy++; continue; }
      try {
        const current = readEvent(item.path);
        if (current?.__project_key === targetProjectKey) {
          try { remove(item.path); result.removed++; result.by_bucket[bucketName.get(item.dir)]++; }
          catch (err) { passErrors++; result.errors.push({ bucket: bucketName.get(item.dir), event_id: eid, code: err?.code || 'remove_failed' }); }
        }
      } finally { releaseReservation(lock); }
    }
    // A producer may still be between begin and commit even when the three
    // active buckets are empty.  The deny tombstone prevents new leases, so
    // wait for the current set to drain before declaring a fixed point.
    let leases = { active: 0, busy: 0 };
    try {
      leases = listActiveProducerLeases(root, targetProjectKey, opts);
    } catch (err) {
      leases = { active: 0, busy: 1, error: err?.code || 'lease_scan_failed' };
    }
    result.active_leases = leases.active;
    result.lease_busy = leases.busy;
    if (leases.busy > 0) {
      result.busy += leases.busy;
      passBusy += leases.busy;
    }
    if (leases.error) {
      result.errors.push({ code: leases.error });
      passErrors++;
    }
    // A fresh scan is required even when the first snapshot was empty. It
    // catches Pending→Outbox transitions and gives us a stable fixed point.
    const residualClaims = buckets.some((dir) => {
      try { return readdirSync(dir).some((n) => n.startsWith('.claim-') || n.startsWith('.reserve-') || n.endsWith('.tmp')); }
      catch { return true; }
    });
    if (activeTarget === 0 && activeLegacy === 0 && passBusy === 0 && passErrors === 0
      && leases.active === 0 && leases.busy === 0 && !leases.error && !residualClaims) {
      result.fixed_point = true;
      break;
    }
  }
  if (!result.fixed_point) result.errors.push({ code: 'purge_retryable' });
  return result;
}

// ---------------------------------------------------------------------------
// Writers (with true FS-level event_id dedup)
// ---------------------------------------------------------------------------

function currentMs(opts) {
  const now = opts && opts.now;
  return typeof now === 'function' ? now() : Date.now();
}

function requireEventId(event) {
  const id = event && event.event_id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('outbox: event.event_id required');
  }
  if (!EVENT_ID_RE.test(id)) {
    throw new Error(`outbox: unsafe event_id ${JSON.stringify(id)}`);
  }
  if (WINDOWS_RESERVED_RE.test(id)) {
    throw new Error(`outbox: reserved event_id ${JSON.stringify(id)}`);
  }
  return id;
}

// Preserve caller-supplied `event.time` exactly (including 0 = epoch).
// The old `event.time || currentMs()` treated 0 as falsy and silently
// rewrote it — that broke state.js's validate/commit consistency (the
// validator saw time=0 and the committed file had time=now).
function withTime(event, opts) {
  const t = event.time;
  return { ...event, time: (t === undefined || t === null) ? currentMs(opts) : t };
}

/**
 * Low-level deny gate. Existing callers that predate C20 may continue to
 * write anonymous test fixtures, but every production event carries a
 * project key and therefore gets the kill-switch check here as well as in
 * telemetry/sender. Callers explicitly opting into the C20 contract must
 * pass a valid key; missing/invalid keys are quarantined by returning a
 * blocked result rather than creating an unattributed queue entry.
 */
export function checkProjectWriteGate(root, event, opts = {}) {
  const eventKey = event?.__project_key;
  const requestedKey = opts.projectKey ?? eventKey;
  const enforcing = opts.enforceProjectGate === true || eventKey !== undefined || opts.projectKey !== undefined;
  // C20 production and direct API contract are fail-closed. Older tests or
  // migration tools must explicitly opt into the compatibility escape hatch.
  if (!enforcing && opts._legacyFixtureCompat === true) return { allowed: true, status: 'legacy_compat' };
  if (!enforcing) return { allowed: false, status: 'legacy_unattributed', reason: 'project_key_required' };
  if (typeof requestedKey !== 'string' || !/^[a-f0-9]{32}$/.test(requestedKey)) {
    return { allowed: false, status: 'legacy_unattributed', reason: 'invalid_project_key' };
  }
  if (eventKey !== undefined && eventKey !== requestedKey) {
    return { allowed: false, status: 'legacy_unattributed', reason: 'project_key_mismatch' };
  }
  const gate = readProjectDenyGate(root, requestedKey);
  return gate.allowed ? { allowed: true, status: 'missing', projectKey: requestedKey }
    : { allowed: false, status: gate.status, reason: gate.reason || `deny_${gate.status}`, projectKey: requestedKey };
}

function blockedWriteResult(eid, gate) {
  return {
    status: 'blocked',
    event_id: eid,
    reason: gate.status === 'legacy_unattributed' ? 'legacy_unattributed' : 'reporting_disabled',
    gate: gate.status,
  };
}

export function writePending(root, event, opts = {}) {
  const d = ensureLayout(root);
  const eid = requireEventId(event);
  const gate = checkProjectWriteGate(root, event, opts);
  if (!gate.allowed) return blockedWriteResult(eid, gate);

  // Round-8 per-eid reservation. `opts._locked === true` is set by
  // state.promote, which already holds the reservation for `eid` across
  // its entire critical section — skip re-acquire to avoid deadlock.
  let lockPath = null;
  if (!opts._locked) {
    lockPath = acquireReservation(root, eid, opts);
    if (!lockPath) {
      const err = new Error(`writePending: reservation timeout for ${eid}`);
      err.code = 'RESERVATION_TIMEOUT';
      throw err;
    }
  }
  try {
    // Reservation protocol (round-5): a promote may have claimed
    // `pending/<eid>.json` (renamed to `.claim-<pid>-<hex>.<eid>.json`) and
    // committed `outbox/<eid>.json`. If either side of the reservation is
    // already committed, a fresh pending write would produce a pending +
    // outbox coexistence and violate the at-most-one-bucket invariant.
    //
    // Pre-check: if outbox already has this eid, the event is fully
    // persisted — nothing more to do. Return deduped only when the
    // canonical event belongs to this project. Explicit event IDs and
    // legacy queues can collide across projects, and a corrupt canonical
    // file is a conflict rather than proof of success.
    const outboxPath = join(d.outbox, payloadFilename(eid));
    if (existsSync(outboxPath)) {
      const existing = readEvent(outboxPath);
      const incomingKey = gate.projectKey;
      const existingKey = existing?.__project_key;
      if (!existing || (incomingKey && existingKey !== incomingKey)
        || (!incomingKey && existingKey)) {
        return {
          status: 'blocked',
          event_id: eid,
          reason: 'outbox_conflict',
          gate: 'outbox_conflict',
        };
      }
      return { path: outboxPath, deduped: true, degraded: false, reason: 'in_outbox' };
    }

    const finalPath = join(d.pending, payloadFilename(eid));
    // Hook-mode callers skip file + directory fsync — see
    // atomicCreateOrDedupe for the durability rationale. Non-Hook callers
    // keep the full sync guarantee.
    const outcome = atomicCreateOrDedupe(finalPath, JSON.stringify(withTime(event, opts)), {
      _skipDirFsync: opts._hookMode === true,
      _skipFileFsync: opts._hookMode === true,
    });

    const postGate = checkProjectWriteGate(root, event, opts);
    if (!postGate.allowed) {
      const current = readEvent(finalPath);
      const owned = current && (!gate.projectKey || current.__project_key === gate.projectKey);
      if (!outcome.deduped && owned) {
        try { unlinkSync(finalPath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
      }
      return blockedWriteResult(eid, postGate);
    }

    // Post-check: an ongoing promote may have committed outbox between our
    // pre-check and our atomicCreateOrDedupe. If so, roll back the pending
    // we just wrote — the event is safely in outbox. NOTE: under the
    // reservation lock this branch is unreachable except by our own
    // recursive call (opts._locked), because no other actor can commit
    // outbox for `eid` without holding the same lock. Kept as
    // defense-in-depth for the _locked path (state.promote's own
    // writeOutbox commits outbox from inside the same locked region).
    if (existsSync(outboxPath)) {
      try { unlinkSync(finalPath); }
      catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      return { path: outboxPath, deduped: true, degraded: outcome.degraded, reason: 'raced_outbox' };
    }

    // Round-7 canonical authority: writePending is the canonical entry
    // point for the pending bucket. Once we've committed a canonical
    // pending/<eid>.json, any dropped/<eid>.json for the same eid is by
    // definition a stale tombstone. Under the reservation lock this
    // sweep is also atomic w.r.t. any GC on the same eid.
    const droppedPath = join(d.dropped, payloadFilename(eid));
    try { unlinkSync(droppedPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return outcome;
  } finally {
    if (lockPath) releaseReservation(lockPath);
  }
}

/**
 * Hook-stage entry point (round-9). Semantically equivalent to
 * `writePending(root, event)` but hardcodes a very short reservation
 * timeout (`HOOK_RESERVATION_TIMEOUT_MS`, ≈25ms) so a single call cannot
 * exceed the V2.3 §17.2 Hook budget (<50ms end-to-end).
 *
 * Hook integrations MUST use this wrapper instead of `writePending`
 * directly. Rationale: the default `writePending` timeout is 1s to make
 * Dispatcher-side sender code robust to normal contention. A Hook that
 * accidentally used that default would block up to 1s under contention,
 * which is unacceptable in the request-hot-path.
 *
 * On timeout the caller MUST catch `err.code === 'RESERVATION_TIMEOUT'`
 * and drop the event — no other action is expected. The dropped event
 * is not observable in `dropped/` because the event never entered the
 * pipeline; Hook layers should log locally instead.
 *
 * @param {string} root
 * @param {object} event
 * @param {object} [opts] — same shape as writePending's opts EXCEPT that
 *   `reservationTimeoutMs` is FORCED to `HOOK_RESERVATION_TIMEOUT_MS`.
 *   If the caller supplies their own value it is ignored (defense-in-
 *   depth against Hook copy-paste callers).
 * @throws {Error} with `code === 'RESERVATION_TIMEOUT'` on contention.
 */
export function writePendingFromHook(root, event, opts = {}) {
  const callerBudget = Number.isFinite(opts.reservationTimeoutMs)
    ? Math.max(0, opts.reservationTimeoutMs)
    : HOOK_RESERVATION_TIMEOUT_MS;
  return writePending(root, event, {
    ...opts,
    reservationTimeoutMs: Math.min(HOOK_RESERVATION_TIMEOUT_MS, callerBudget),
    // Hook telemetry is best-effort: retain atomic publication but skip
    // file + directory fsync so the IDE request path is not gated on APFS
    // flush latency. See the Hook performance release gate.
    _hookMode: true,
  });
}

export const _HOOK_RESERVATION_TIMEOUT_MS = HOOK_RESERVATION_TIMEOUT_MS;

export function writeOutbox(root, event, opts = {}) {
  const d = ensureLayout(root);
  const eid = requireEventId(event);
  const gate = checkProjectWriteGate(root, event, opts);
  if (!gate.allowed) return blockedWriteResult(eid, gate);

  // Round-8 per-eid reservation (opts._locked skips re-acquire).
  let lockPath = null;
  if (!opts._locked) {
    lockPath = acquireReservation(root, eid, opts);
    if (!lockPath) {
      const err = new Error(`writeOutbox: reservation timeout for ${eid}`);
      err.code = 'RESERVATION_TIMEOUT';
      throw err;
    }
  }
  try {
    const finalPath = join(d.outbox, payloadFilename(eid));
    const outcome = atomicCreateOrDedupe(finalPath, JSON.stringify(withTime(event, opts)), {
      _skipDirFsync: opts._hookMode === true,
      _skipFileFsync: opts._hookMode === true,
    });

    const postGate = checkProjectWriteGate(root, event, opts);
    if (!postGate.allowed) {
      const current = readEvent(finalPath);
      const owned = current && (!gate.projectKey || current.__project_key === gate.projectKey);
      if (!outcome.deduped && owned) {
        try { unlinkSync(finalPath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
      }
      return blockedWriteResult(eid, postGate);
    }

    // Round-6 at-most-one-bucket enforcement. writeOutbox is a low-level
    // primitive: after it commits, the event is authoritative in outbox and
    // any pending/<eid>.json or dropped/<eid>.json for the SAME eid is
    // stale. Sweep both. Under the reservation lock this is atomic w.r.t.
    // any other same-eid actor.
    const committed = readEvent(finalPath);
    const ownsCommitted = committed && (!gate.projectKey || committed.__project_key === gate.projectKey);
    if (!ownsCommitted) return blockedWriteResult(eid, { status: 'legacy_unattributed', reason: 'event_owner_mismatch' });
    const pendingPath = join(d.pending, payloadFilename(eid));
    try { unlinkSync(pendingPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    const droppedPath = join(d.dropped, payloadFilename(eid));
    try { unlinkSync(droppedPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }

    return outcome;
  } finally {
    if (lockPath) releaseReservation(lockPath);
  }
}

/** Hook-only Outbox entry point with the same bounded reservation as Prompt staging. */
export function writeOutboxFromHook(root, event, opts = {}) {
  const callerBudget = Number.isFinite(opts.reservationTimeoutMs)
    ? Math.max(0, opts.reservationTimeoutMs)
    : HOOK_RESERVATION_TIMEOUT_MS;
  return writeOutbox(root, event, {
    ...opts,
    reservationTimeoutMs: Math.min(HOOK_RESERVATION_TIMEOUT_MS, callerBudget),
    _hookMode: true,
  });
}

// ---------------------------------------------------------------------------
// Atomic metadata update for Sender retry tracking (C7)
// ---------------------------------------------------------------------------

const SENDER_METADATA_WHITELIST = new Set([
  '__sender_retry_count',
  '__sender_retry_after',
]);

/**
 * Atomically update Sender-owned metadata on an outbox event. Uses
 * tmp + fsync + rename (same-path atomic replace) — NOT
 * atomicCreateOrDedupe (which is for first-write-wins, not updates).
 *
 * Whitelist: only `__sender_retry_count` and `__sender_retry_after`
 * are accepted. All other keys (especially event identity fields) are
 * rejected with a TypeError to prevent Sender code from accidentally
 * rewriting event content.
 *
 * @param {string} root  — state root
 * @param {string} eventId  — the event's event_id (must pass isSafeEventId)
 * @param {object} meta  — keys to merge (must all be in whitelist)
 * @param {object} [opts]
 * @param {boolean} [opts._locked]  — caller already holds reservation
 * @returns {{ ok: boolean, error?: string }}
 */
export function updateOutboxMetadata(root, eventId, meta, opts = {}) {
  if (!isSafeEventId(eventId)) {
    throw new TypeError(`updateOutboxMetadata: unsafe eventId ${JSON.stringify(eventId)}`);
  }
  if (!meta || typeof meta !== 'object') {
    throw new TypeError('updateOutboxMetadata: meta must be an object');
  }
  for (const k of Object.keys(meta)) {
    if (!SENDER_METADATA_WHITELIST.has(k)) {
      throw new TypeError(
        `updateOutboxMetadata: key "${k}" not in sender metadata whitelist. `
        + `Allowed: ${[...SENDER_METADATA_WHITELIST].join(', ')}`,
      );
    }
  }

  const d = ensureLayout(root);
  let lock = null;
  if (!opts._locked) {
    lock = acquireReservation(root, eventId, opts);
    if (!lock) {
      return { ok: false, error: 'reservation_timeout' };
    }
  }
  try {
    const filePath = join(d.outbox, payloadFilename(eventId));
    const event = readEvent(filePath);
    if (event === null) {
      return { ok: false, error: 'event_not_found' };
    }
    const updated = { ...event, ...meta };
    const body = JSON.stringify(updated);
    const tmp = join(d.outbox, `.${randomBytes(4).toString('hex')}.${eventId}.json.tmp`);
    let fd;
    try {
      fd = openSync(tmp, 'wx', 0o600);
    } catch (err) {
      return { ok: false, error: `tmp_create: ${err.code}` };
    }
    try {
      writeAll(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, filePath);
    } catch (err) {
      // Rename failed — preserve original, clean up tmp
      try { unlinkSync(tmp); } catch { /* ignore */ }
      return { ok: false, error: `rename: ${err.code}` };
    }
    fsyncDirBestEffort(d.outbox);
    return { ok: true };
  } finally {
    if (lock) releaseReservation(lock);
  }
}
function sanitizeEnrichment(enrichment) {
  const out = {};
  if (!enrichment || typeof enrichment !== 'object') return out;
  for (const k of Object.keys(enrichment)) {
    if (ALLOWED_ENRICHMENT_KEYS.has(k)) out[k] = enrichment[k];
  }
  return out;
}

/**
 * Build the merged event that promoteToOutbox will write.
 *
 * Kept as an exported helper (`_` prefix marks it as internal/test-only API)
 * so state.js can preview the merged shape for schema validation BEFORE the
 * atomic write. Duplicating this logic in state.js would create two sources
 * of truth for the base-field-immutability rules — this way there is one.
 *
 * The rules:
 *   1. Sanitize enrichment to the ALLOWED_ENRICHMENT_KEYS whitelist.
 *   2. Merge over base.
 *   3. Belt-and-suspenders: force base identity fields back (event_id, time,
 *      method, text, schema_version, client_generation, platform) so no
 *      enrichment can rewrite an event's identity, even if the whitelist
 *      leaks a key in a future edit.
 */
export function _buildMergedEvent(base, enrichment) {
  if (base == null || typeof base !== 'object') {
    throw new TypeError('_buildMergedEvent: base event must be an object');
  }
  const merged = { ...base, ...sanitizeEnrichment(enrichment) };
  merged.event_id = base.event_id;
  merged.time = base.time;
  if (base.method !== undefined) merged.method = base.method;
  if (base.text !== undefined) merged.text = base.text;
  if (base.schema_version !== undefined) merged.schema_version = base.schema_version;
  if (base.client_generation !== undefined) merged.client_generation = base.client_generation;
  if (base.platform !== undefined) merged.platform = base.platform;
  return merged;
}

/**
 * Read a pending event, merge whitelisted enrichment, write to outbox/,
 * remove pending. event_id is preserved from the base event even if the
 * caller mistakenly supplies a different one in enrichment.
 */
export function promoteToOutbox(root, pendingPath, enrichment, opts = {}) {
  const d = ensureLayout(root);
  const base = readEvent(pendingPath);
  if (base == null) {
    const err = new Error(`outbox: cannot read pending ${pendingPath}`);
    err.code = 'ENOENT';
    throw err;
  }
  const eid = requireEventId(base);
  const merged = _buildMergedEvent(base, enrichment);

  const outboxPath = join(d.outbox, payloadFilename(eid));
  const outcome = atomicCreateOrDedupe(outboxPath, JSON.stringify(merged));
  remove(pendingPath);
  return {
    path: outcome.path,
    event_id: eid,
    deduped: outcome.deduped,
    degraded: outcome.degraded,
  };
}

/**
 * Move a schema-invalid event aside. Retention cap trimmed on excess by
 * filesystem enumeration order; rejected files do NOT count toward drop
 * counter.
 *
 * @param {object} [opts]
 * @param {string} [opts.fallbackEventId]  If body.event_id is unsafe (fails
 *   `requireEventId`), name the rejected file with this safe eid instead of
 *   throwing. Preserves observability of quarantined events whose internal
 *   event_id was tampered with — the caller supplies the safe eid it knows
 *   the file to be about (typically the URL parameter that was gated by
 *   `isSafeEventId`).
 */
export function moveToRejected(root, srcPath, reason, opts = {}) {
  const d = ensureLayout(root);
  const body = readEvent(srcPath);
  if (body == null) {
    const err = new Error(`outbox: cannot read source ${srcPath}`);
    err.code = 'ENOENT';
    throw err;
  }
  let eid;
  try {
    eid = requireEventId(body);
  } catch (err) {
    // body.event_id is missing / unsafe / reserved. Use the caller-supplied
    // safe fallback if available so the event still lands somewhere
    // observable (rejected/<fallback>.json). Debug context comes from the
    // wrapper's `__rejected.reason` string.
    if (opts.fallbackEventId && isSafeEventId(opts.fallbackEventId)) {
      eid = opts.fallbackEventId;
    } else {
      throw err;
    }
  }
  const wrapped = { ...body, __rejected: { reason, ts: currentMs(opts) } };
  const dst = join(d.rejected, payloadFilename(eid));
  atomicCreateOrDedupe(dst, JSON.stringify(wrapped));
  remove(srcPath);

  const cap = opts.rejectedMax || DEFAULT_REJECTED_MAX;
  const rejected = listRejected(root);
  if (rejected.length > cap) {
    const excess = rejected.length - cap;
    for (let i = 0; i < excess; i++) remove(rejected[i]);
  }
  return { path: dst };
}

// ---------------------------------------------------------------------------
// Priority classification
// ---------------------------------------------------------------------------

function classifyEvent(event) {
  if (!event || typeof event !== 'object') return 'P3';
  const method = event.method;
  const type = event.text;
  if (method === 'event' && typeof type === 'string') {
    if (P0_EVENTS.has(type)) return 'P0';
    if (P1_EVENTS.has(type)) return 'P1';
    return 'P3';
  }
  if (method === 'prompt' && event.skillname && event.skillname !== 'unknown') return 'P2';
  return 'P3';
}

function eventType(event) {
  if (event && event.method === 'event' && typeof event.text === 'string') return event.text;
  return 'unknown';
}

const PRIORITY_ORDER = ['P3', 'P2', 'P1', 'P0'];

// ---------------------------------------------------------------------------
// Compact tombstone commit — dedup via linkSync EEXIST
// ---------------------------------------------------------------------------

function buildTombstone(event, eventId, reason, priority, droppedAt) {
  return {
    event_id: eventId,
    type: eventType(event),
    priority,
    reason,
    dropped_at: droppedAt,
  };
}

/**
 * Commit a tombstone for `eventId` into `droppedDir`, unconditionally
 * deduped by event_id. Returns:
 *   'created'    — this call newly created the tombstone (count as a drop)
 *   'duplicate'  — another tombstone for this event_id was already present
 */
function commitTombstone(droppedDir, tombstone) {
  const tombPath = join(droppedDir, tombstoneFilename(tombstone.event_id));
  const { deduped } = atomicCreateOrDedupe(tombPath, JSON.stringify(tombstone));
  return deduped ? 'duplicate' : 'created';
}

// Two-step atomic eviction: (1) rename src into a per-process claim in the
// same dir (protects against macOS unlink's non-atomicity), (2) commit a
// compact tombstone in dropped/ via linkSync EEXIST dedup, then unlink the
// claim regardless. Returns:
//   'evicted'    — we did the eviction and the drop was newly counted
//   'duplicate'  — we did the eviction but a tombstone already existed
//   'race'       — the source was gone before we could claim it
function evictOne(dir, filename, droppedDir, dropTs) {
  const src = join(dir, filename);
  const claimPath = join(dir, `.claim-${process.pid}-${randomBytes(4).toString('hex')}.${filename}`);
  try {
    renameSync(src, claimPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'race';
    throw err;
  }
  const event = readEvent(claimPath);
  const dec = decodeFinalName(filename);
  const eid = dec ? dec.event_id : (event && event.event_id) || filename.replace(/\.json$/, '');
  const priority = classifyEvent(event);
  const tomb = buildTombstone(event, eid, /* reason set by caller */ 'evicted', priority, dropTs);
  const status = commitTombstone(droppedDir, tomb);
  try { unlinkSync(claimPath); } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  return status === 'created' ? 'evicted' : 'duplicate';
}

// Reason-aware eviction wrapper.
//
// If `outboxPeerDir` is provided, evictOneWithReason performs an outbox
// coherence check both BEFORE and AFTER tombstone commit:
//
//   - Pre-check: if outbox/<eid>.json already exists at the moment we claim,
//     this pending is a duplicate (Hook retry after a prior successful
//     promote). No tombstone — just unlink the claim. Returns 'duplicate'.
//
//   - Post-check: if outbox/<eid>.json appears between our claim and our
//     tombstone commit (e.g., a direct writeOutbox from another code path,
//     or a concurrent promote), our tombstone is stale — undo it and
//     return 'duplicate'.
//
// This closes the "state.promote crashed after writeOutbox, before unlink
// claim" window: a subsequent gc.recoverOrphanClaims would otherwise
// resurrect the event as a `reason='recovered'` tombstone, violating the
// at-most-one-bucket invariant. See rollout §7 (C6 round-4) for the
// reproduction.
//
// Callers that pass `outboxPeerDir === null` skip the check — this is the
// correct behavior when evicting from outbox itself (the "peer" would be
// the source we're evicting, always present).
function evictOneWithReason(dir, filename, droppedDir, dropTs, reason, outboxPeerDir = null, opts = {}) {
  const src = join(dir, filename);
  const claimPath = join(dir, `.claim-${process.pid}-${randomBytes(4).toString('hex')}.${filename}`);

  // Round-8 per-eid reservation. Derive `eid` from `filename` (before
  // renameSync so we can acquire before any state mutation). Reservation
  // path is `<pending>/.reserve-<eid>`. `pending` is a sibling of
  // `dropped` under the telemetry root.
  const decEarly = decodeFinalName(filename);
  const eidForLock = decEarly ? decEarly.event_id : filename.replace(/\.json$/, '');
  const pendingDir = join(dirname(droppedDir), PENDING);
  let reservation = null;
  if (isSafeEventId(eidForLock)) {
    reservation = _acquireReservationByPending(pendingDir, eidForLock, {
      // GC path — short wait, skip on contention. Caller retries next scan.
      reservationTimeoutMs: num(opts.reservationTimeoutMs, DEFAULT_RESERVATION_GC_TIMEOUT_MS),
    });
    if (!reservation) return 'busy';
  }

  try {
    return _evictOneWithReasonLocked(dir, src, claimPath, filename, droppedDir, dropTs, reason, outboxPeerDir, opts);
  } finally {
    if (reservation) releaseReservation(reservation);
  }
}

function _evictOneWithReasonLocked(dir, src, claimPath, filename, droppedDir, dropTs, reason, outboxPeerDir, opts) {
  try {
    renameSync(src, claimPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'race';
    throw err;
  }
  const event = readEvent(claimPath);
  const dec = decodeFinalName(filename);
  const eid = dec ? dec.event_id : (event && event.event_id) || filename.replace(/\.json$/, '');

  const outboxPeerPath = outboxPeerDir ? join(outboxPeerDir, `${eid}.json`) : null;
  if (outboxPeerPath && existsSync(outboxPeerPath)) {
    // Duplicate: event is already in outbox. Discard the claim without
    // committing a tombstone. Round-5: also sweep any pre-existing
    // `dropped/<eid>.json` — a prior GC without the post-check patch
    // may have left a stale tombstone next to outbox.
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(claimPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return 'duplicate';
  }

  // Round-6 canonical-retry guard: if a fresh `<dir>/<eid>.json` exists
  // (a Hook retry that raced our claim rename, or a concurrent
  // writeOutbox depending on which bucket we're evicting from), the
  // canonical entry is the authoritative source. Tombstoning here would
  // produce a canonical + dropped coexistence. Discard the claim; the
  // canonical entry will proceed through its own lifecycle. Round-7:
  // ALSO sweep any pre-existing `dropped/<eid>.json` — canonical +
  // stale tombstone was the IS11 reproduction.
  const canonicalPeerPath = join(dir, `${filename}`);
  if (existsSync(canonicalPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(claimPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return 'duplicate';
  }

  // Round-7 test injection point: fires AFTER canonical pre-check passes
  // and BEFORE commitTombstone. Only used by IS10 to reproduce the
  // "pre-check clean, race writes canonical, commit tombstone" window.
  // Production code never sets this — it is opt-in via the gc opts bag.
  if (typeof opts._preCommitRaceHook === 'function') {
    opts._preCommitRaceHook({ dir, eid, filename });
  }

  const priority = classifyEvent(event);
  const tomb = buildTombstone(event, eid, reason, priority, dropTs);
  const status = commitTombstone(droppedDir, tomb);

  // Post-commit re-check. If the outbox appeared during our tombstone
  // commit window, our tombstone (whether we just created it, or it
  // already existed from a prior evict of the same eid) is stale — the
  // event is authoritative in outbox. Round-5: this ALSO applies when
  // `status === 'duplicate'` (a pre-existing tombstone for the same eid),
  // because commitTombstone identifies by path `dropped/<eid>.json` and
  // therefore the duplicate is for the exact same event.
  if (outboxPeerPath && existsSync(outboxPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(claimPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return 'duplicate';
  }

  // Round-7 canonical post-commit re-check: a fresh canonical entry may
  // have raced in between our canonical pre-check and this point. Roll
  // back the tombstone we just committed — canonical is authoritative.
  if (existsSync(canonicalPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(claimPath); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return 'duplicate';
  }

  try { unlinkSync(claimPath); }
  catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  return status === 'created' ? 'evicted' : 'duplicate';
}

// ---------------------------------------------------------------------------
// Drop counting — reads compact tombstones from dropped/
// ---------------------------------------------------------------------------

export function countDropped(root) {
  const d = subdirs(root);
  let entries;
  try { entries = readdirSync(d.dropped); }
  catch (err) { if (err && err.code === 'ENOENT') return { total: 0, by_type: {} }; throw err; }
  const by_type = {};
  let total = 0;
  for (const name of entries) {
    if (!isFinalEventFile(name)) continue;
    total++;
    const t = readEvent(join(d.dropped, name));
    const key = (t && typeof t.type === 'string') ? t.type : 'unknown';
    by_type[key] = (by_type[key] || 0) + 1;
  }
  return { total, by_type };
}

// ---------------------------------------------------------------------------
// gc — TTL + cap + orphan recovery
// ---------------------------------------------------------------------------

/**
 * Garbage-collect the telemetry directories:
 *   - Reclaim orphan claim files (dead-PID) into `dropped/` as tombstones.
 *   - Clean up crashed-writer `.<hex>.<name>.tmp` files past their age.
 *   - Enforce TTL + count + byte caps on `pending/` and `outbox/`; the
 *     evicted events are recorded as compact tombstones in `dropped/`.
 *   - Enforce TTL + count cap on `dropped/` and `rejected/`.
 *   - Protect active writers on the degraded fallback path (see
 *     `_atomicCreateNoClobber`): unparseable final files within
 *     `corruptGraceMs` are preserved; only files that have been quiet past
 *     the grace window are treated as crashed-writer artifacts.
 *
 * @param {string} root
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs]           default 7 days (TTL per bucket)
 * @param {number} [opts.maxFiles]           default 5000 per pending/outbox
 * @param {number} [opts.maxBytes]           default 10 MB per pending/outbox
 * @param {number} [opts.rejectedMax]        default 200 files in rejected/
 * @param {number} [opts.droppedMaxFiles]    default 10000 tombstones
 * @param {number} [opts.orphanTmpMaxAgeMs]  default 1 day for `.hex.name.tmp`
 * @param {number} [opts.corruptGraceMs]     default 60 s. Grace window
 *   applied to unparseable final files (`readEvent → null`). Only affects
 *   the degraded (linkSync-unsupported) fallback path where a writer writes
 *   body chunks directly to finalPath — within grace they are treated as
 *   possibly-active writers and preserved; past grace they are cleaned up
 *   (pending/outbox → tombstoned with `reason='corrupt_partial'`;
 *   dropped/rejected → unlinked, no recursive tombstone).
 * @param {()=>number} [opts.now]
 * @param {(pid:number)=>boolean|null} [opts.isPidAlive]
 */
export function gc(root, opts = {}) {
  const d = ensureLayout(root);
  const maxAgeMs = num(opts.maxAgeMs, DEFAULT_MAX_AGE_MS);
  const maxFiles = num(opts.maxFiles, DEFAULT_MAX_FILES);
  const maxBytes = num(opts.maxBytes, DEFAULT_MAX_BYTES);
  const rejectedMax = num(opts.rejectedMax, DEFAULT_REJECTED_MAX);
  const droppedMaxFiles = num(opts.droppedMaxFiles, DEFAULT_DROPPED_MAX_FILES);
  const orphanTmpMaxAgeMs = num(opts.orphanTmpMaxAgeMs, DEFAULT_ORPHAN_TMP_MAX_AGE_MS);
  const corruptGraceMs = num(opts.corruptGraceMs, DEFAULT_CORRUPT_GRACE_MS);
  const now = opts.now || Date.now;
  const liveness = opts.isPidAlive || isPidAlive;

  // Round-9 GC phase ordering: cleanupOrphanReservations MUST run first.
  // recoverOrphanClaims, gcBucket, and gcRejected all acquire per-eid
  // reservation locks (via evictOneWithReason / _recoverOneClaim). If a
  // dead-writer reservation is left over from a prior crash, those calls
  // would see EEXIST → timeout → 'busy' and skip the actual recovery
  // work. Cleanup the stuck locks first so the rest of gc runs unblocked.
  const reservationGraceMs = num(opts.reservationOrphanGraceMs, DEFAULT_RESERVATION_ORPHAN_GRACE_MS);
  const reservationsCleaned =
    cleanupOrphanReservations(d.pending, liveness, now, reservationGraceMs, opts);

  const recoveryPending = recoverOrphanClaims(d.pending, d.dropped, liveness, now, d.outbox, opts);
  const recoveryOutbox = recoverOrphanClaims(d.outbox, d.dropped, liveness, now, null, opts);
  const droppedRecovered = recoveryPending.recovered + recoveryOutbox.recovered;
  const orphanClaimsBusy = recoveryPending.busy + recoveryOutbox.busy;

  const tmpCleaned =
    cleanupOrphanTmp(d.pending, now, orphanTmpMaxAgeMs) +
    cleanupOrphanTmp(d.outbox, now, orphanTmpMaxAgeMs) +
    cleanupOrphanTmp(d.rejected, now, orphanTmpMaxAgeMs);

  const pendingRes = gcBucket(d.pending, d.dropped, maxAgeMs, maxFiles, maxBytes, corruptGraceMs, now, opts);
  const outboxRes = gcBucket(d.outbox, d.dropped, maxAgeMs, maxFiles, maxBytes, corruptGraceMs, now, opts);
  const rejectedRes = gcRejected(d.rejected, maxAgeMs, rejectedMax, corruptGraceMs, now);
  const droppedRes = gcDroppedDir(d.dropped, maxAgeMs, droppedMaxFiles, corruptGraceMs, now);

  return {
    pending: pendingRes,
    outbox: outboxRes,
    rejected: rejectedRes,
    dropped: droppedRes,
    orphan_claims_recovered: droppedRecovered,
    orphan_claims_busy: orphanClaimsBusy,
    orphan_tmp_cleaned: tmpCleaned,
    orphan_reservations_cleaned: reservationsCleaned,
    dropped_total_this_run:
      pendingRes.expired + pendingRes.evicted + pendingRes.corrupt_dropped +
      outboxRes.expired + outboxRes.evicted + outboxRes.corrupt_dropped +
      droppedRecovered,
  };
}

function num(v, fallback) { return Number.isFinite(v) ? v : fallback; }

function gcBucket(dir, droppedDir, maxAgeMs, maxFiles, maxBytes, corruptGraceMs, now, opts = {}) {
  const files = listDir(dir);
  const nowMs = now();
  const cutoff = nowMs - maxAgeMs;
  const kept = [];
  let expired = 0;
  let evicted = 0;
  let duplicates = 0;
  let corruptDropped = 0;
  let corruptSkipped = 0;
  // Round-9 introduced busy accounting; round-12 fixes the semantic
  // bug where a 'busy' outcome in Phase A caused the file to be
  // dropped from `kept` even though it is still on disk. `busy`
  // means "reservation held by another actor" — the file was not
  // evicted, and the next gc scan retries. It MUST count toward
  // `kept` so callers observing `kept + evicted + expired == files
  // seen at start` remains true. See rollout §7 C6 round-12 P0.
  let busy = 0;

  // If we're evicting from pending/, outbox/ is the peer to coherence-check
  // — a duplicate in outbox means the pending is a Hook retry we should
  // not tombstone. If we're evicting from outbox/ itself, skip the check
  // (the "peer" is the source we're evicting).
  const telemetryDir = dirname(droppedDir);
  const outboxDir = join(telemetryDir, OUTBOX);
  const outboxPeerDir = dir === outboxDir ? null : outboxDir;

  // Phase A: TTL sweep — read each event's content.time (filename no longer
  // encodes ts).
  for (const p of files) {
    const evt = readEvent(p);
    if (evt === null) {
      // Unparseable final file. Expected only on the degraded (linkSync-
      // unsupported) fallback where the writer writes directly to finalPath
      // and may not yet have finished. A silent unlink here would kill an
      // active writer's inode (writer keeps writing to a now-deleted file →
      // no error, but no event on disk either).
      //
      // Gate on mtime: within corruptGraceMs the writer MIGHT still be
      // finishing → leave alone. Past the grace window the writer is
      // certainly gone; commit a compact tombstone (so degraded-FS loss is
      // visible) and unlink via the standard rename+claim+tombstone dance.
      let mtimeMs;
      try { mtimeMs = statSync(p).mtimeMs; }
      catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }
      if (nowMs - mtimeMs < corruptGraceMs) {
        corruptSkipped++;
        continue;
      }
      const status = evictOneWithReason(dir, basename(p), droppedDir, nowMs, 'corrupt_partial', outboxPeerDir, opts);
      if (status === 'evicted') corruptDropped++;
      else if (status === 'duplicate') duplicates++;
      else if (status === 'busy') {
        // Round-12: file still on disk; count toward kept.
        busy++;
        kept.push({ path: p, ts: nowMs, event: null, _busy: true });
      }
      continue;
    }
    const ts = Number.isFinite(evt.time) ? Number(evt.time) : nowMs;
    if (ts < cutoff) {
      const status = evictOneWithReason(dir, basename(p), droppedDir, nowMs, 'ttl', outboxPeerDir, opts);
      if (status === 'evicted') expired++;
      else if (status === 'duplicate') duplicates++;
      else if (status === 'busy') {
        // Round-12: file still on disk; count toward kept. Note we
        // preserve the parsed event so Phase B's classifyEvent still
        // works (priority-ordered cap eviction).
        busy++;
        kept.push({ path: p, ts, event: evt, _busy: true });
      }
      continue;
    }
    kept.push({ path: p, ts, event: evt });
  }

  // Phase B: cap by count / bytes.
  const inspectFs = () => {
    let count = 0, bytes = 0;
    for (const k of kept) {
      if (k._evicted) continue;
      try {
        bytes += statSync(k.path).size;
        count++;
      } catch { /* gone on disk */ }
    }
    return { count, bytes };
  };

  let fs = inspectFs();
  if (fs.count > maxFiles || fs.bytes > maxBytes) {
    const byPriority = { P0: [], P1: [], P2: [], P3: [] };
    for (const k of kept) {
      if (k._evicted) continue;
      // Round-13: skip items already known-busy from Phase A. Retrying
      // eviction on them here (a) inflates `busy` counter by a second
      // increment for the same file, and (b) pays a second reservation
      // acquire timeout wait per gc call. Reproduction: TTL + cap
      // simultaneously — the busy file was TTL-expired in Phase A,
      // pushed to kept with `_busy`, then Phase B pulls it back in for
      // cap eviction, hits busy again → observed `kept=1, busy=2`
      // instead of expected `kept=1, busy=1`.
      if (k._busy) continue;
      k.priority = classifyEvent(k.event);
      byPriority[k.priority].push(k);
    }
    for (const cls of PRIORITY_ORDER) byPriority[cls].sort((a, b) => a.ts - b.ts);

    outer: for (const cls of PRIORITY_ORDER) {
      for (const victim of byPriority[cls]) {
        fs = inspectFs();
        if (fs.count <= maxFiles && fs.bytes <= maxBytes) break outer;
        const reason = fs.count > maxFiles ? 'cap_files' : 'cap_bytes';
        const status = evictOneWithReason(dir, basename(victim.path), droppedDir, nowMs, reason, outboxPeerDir, opts);
        // Round-9: only mark victim as evicted if we actually consumed
        // it. 'busy' means another actor holds the reservation — the
        // file is still there; next gc pass will retry. Leaving
        // `_evicted=false` keeps the invariant "kept.filter(!_evicted)"
        // accurate.
        if (status === 'evicted') { victim._evicted = true; evicted++; }
        else if (status === 'duplicate') { victim._evicted = true; duplicates++; }
        else if (status === 'busy') busy++;
        else if (status === 'race') victim._evicted = true;  // file was already gone
      }
    }
  }

  return {
    kept: kept.filter((k) => !k._evicted).length,
    expired,
    evicted,
    duplicates,
    busy,
    corrupt_dropped: corruptDropped,
    corrupt_skipped: corruptSkipped,
  };
}

function gcRejected(dir, maxAgeMs, rejectedMax, corruptGraceMs, now) {
  const files = listDir(dir);
  const nowMs = now();
  const cutoff = nowMs - maxAgeMs;
  let expired = 0;
  let corruptCleaned = 0;
  let corruptSkipped = 0;
  const survivors = [];
  for (const p of files) {
    // Detect mid-write partials on the degraded fallback path. moveToRejected
    // uses the same atomicCreateOrDedupe helper, so a rejected/<eid>.json
    // may be observed unparseable during a legitimate write.
    const body = readEvent(p);
    let mtimeMs;
    try { mtimeMs = statSync(p).mtimeMs; }
    catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }
    if (body === null) {
      if (nowMs - mtimeMs < corruptGraceMs) {
        corruptSkipped++;
        continue;
      }
      try { unlinkSync(p); corruptCleaned++; }
      catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      continue;
    }
    if (mtimeMs < cutoff) {
      remove(p);
      expired++;
      continue;
    }
    survivors.push(p);
  }
  const excess = Math.max(0, survivors.length - rejectedMax);
  for (let i = 0; i < excess; i++) remove(survivors[i]);
  return {
    kept: survivors.length - excess,
    expired,
    corrupt_cleaned: corruptCleaned,
    corrupt_skipped: corruptSkipped,
  };
}

function gcDroppedDir(dir, maxAgeMs, maxFiles, corruptGraceMs, now) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (err) {
    if (err && err.code === 'ENOENT') {
      return { kept: 0, expired: 0, corrupt_cleaned: 0, corrupt_skipped: 0 };
    }
    throw err;
  }
  const nowMs = now();
  const cutoff = nowMs - maxAgeMs;
  let expired = 0;
  let corruptCleaned = 0;
  let corruptSkipped = 0;
  const survivors = [];
  for (const name of entries) {
    if (!isFinalEventFile(name)) continue;
    const p = join(dir, name);
    const tomb = readEvent(p);
    if (tomb === null) {
      // Unparseable tombstone — active writer or crashed writer on the
      // degraded fallback path. Symmetric protection to gcBucket: grace
      // window guards the active-writer case. Never recursively commit a
      // tombstone for a broken tombstone (would need to reserve another
      // event_id and the recursion could loop under repeated corruption).
      let mtimeMs;
      try { mtimeMs = statSync(p).mtimeMs; }
      catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }
      if (nowMs - mtimeMs < corruptGraceMs) {
        corruptSkipped++;
        // NOTE: intentionally NOT pushed into `survivors` — that array feeds
        // the cap-trim loop below, and a fresh corrupt file must not be
        // evicted by cap. It stays on disk untouched until next GC.
        continue;
      }
      try { unlinkSync(p); corruptCleaned++; }
      catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      continue;
    }
    const ts = Number.isFinite(tomb.dropped_at) ? Number(tomb.dropped_at) : 0;
    if (ts < cutoff) {
      try { unlinkSync(p); expired++; }
      catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    } else {
      survivors.push({ path: p, ts });
    }
  }
  // Cap by count — evict oldest tombstones first.
  survivors.sort((a, b) => a.ts - b.ts);
  const excess = Math.max(0, survivors.length - maxFiles);
  for (let i = 0; i < excess; i++) {
    try { unlinkSync(survivors[i].path); expired++; }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  }
  return {
    kept: survivors.length - excess,
    expired,
    corrupt_cleaned: corruptCleaned,
    corrupt_skipped: corruptSkipped,
  };
}

// ---------------------------------------------------------------------------
// Orphan claim recovery — moves dead-pid `.claim-<pid>-<hex>.NAME.json` files
// into dropped/ as compact tombstones. Alive-pid or unknown-liveness claims
// are NEVER touched.
// ---------------------------------------------------------------------------

function recoverOrphanClaims(dir, droppedDir, liveness, now, outboxPeerDir = null, opts = {}) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (err) { if (err && err.code === 'ENOENT') return { recovered: 0, busy: 0 }; throw err; }
  let recovered = 0;
  let busy = 0;
  const nowMs = now();
  const pendingDir = join(dirname(droppedDir), PENDING);
  for (const name of entries) {
    const m = CLAIM_FILENAME_RE.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (liveness(pid) !== false) continue;                 // conservative: null/alive → skip
    const src = join(dir, name);
    const originalName = m[2];
    const evt = readEvent(src);
    const dec = decodeFinalName(originalName);
    const eid = dec ? dec.event_id : (evt && evt.event_id) || null;
    const eidSafe = eid && EVENT_ID_RE.test(eid) && !WINDOWS_RESERVED_RE.test(eid);
    if (!eidSafe) {
      // Cannot determine safe event_id; delete the claim to unblock progress.
      try { unlinkSync(src); } catch { /* ignore */ }
      continue;
    }

    // Round-8 per-eid reservation. Acquired per claim; if another actor
    // holds the lock for this eid, skip this claim (they will handle it,
    // or next gc pass will find the claim intact). Short timeout.
    // Round-10: 'busy' outcome tracked separately for gc-level
    // observability — a persistent non-zero busy count across scans is
    // a signal that some caller is holding a lock longer than expected.
    const reservation = _acquireReservationByPending(pendingDir, eid, {
      reservationTimeoutMs: num(opts.reservationTimeoutMs, DEFAULT_RESERVATION_GC_TIMEOUT_MS),
    });
    if (!reservation) { busy++; continue; }
    try {
      if (_recoverOneClaim(dir, name, src, eid, evt, droppedDir, outboxPeerDir, nowMs, opts)) recovered++;
    } finally {
      releaseReservation(reservation);
    }
  }
  return { recovered, busy };
}

// Returns true iff a new tombstone was created (increments recovered).
function _recoverOneClaim(dir, name, src, eid, evt, droppedDir, outboxPeerDir, nowMs, opts) {
  // Crash-window guard: if the claimant already committed the event into
  // outbox before dying (state.promote writes outbox BEFORE unlinking the
  // pending-claim), tombstoning here would create a both-buckets state.
  // Delete the orphan claim silently — the event is safely in outbox.
  // Round-5: also sweep any pre-existing `dropped/<eid>.json` — a prior
  // GC that observed the same crash window without the post-check patch
  // may have left a stale tombstone.
  const outboxPeerPath = outboxPeerDir ? join(outboxPeerDir, `${eid}.json`) : null;
  if (outboxPeerPath && existsSync(outboxPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(src); } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return false;
  }

  // Round-6 canonical-retry guard: if a fresh `<dir>/<eid>.json` exists
  // (a Hook retry after the original writer crashed, or a concurrent
  // writeOutbox for the same eid), that canonical file is the
  // authoritative source. Tombstoning here would produce a `pending +
  // dropped` (or `outbox + dropped`) coexistence. Delete the stale claim
  // and let the canonical entry proceed through its normal lifecycle.
  // Round-7: also sweep any pre-existing `dropped/<eid>.json` for the
  // canonical + stale-tombstone case (IS11 reproduction).
  const canonicalPeerPath = join(dir, `${eid}.json`);
  if (existsSync(canonicalPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(src); } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return false;
  }

  // Round-7 test injection point: fires AFTER canonical pre-check passes
  // and BEFORE commitTombstone. IS10 uses this to reproduce the
  // "pre-check clean, race writes canonical, commit tombstone" window.
  // Production code never sets this — it is opt-in via the gc opts bag.
  // Under the round-8 reservation lock this window is closed for all
  // in-band actors, but the hook remains callable for legacy tests.
  if (typeof opts._preCommitRaceHook === 'function') {
    opts._preCommitRaceHook({ dir, eid, name });
  }

  const priority = classifyEvent(evt);
  const tomb = buildTombstone(evt, eid, 'recovered', priority, nowMs);
  const status = commitTombstone(droppedDir, tomb);

  // Post-commit re-check: outbox appeared in the pre-check-to-commit
  // window (impossible under the reservation lock, kept for defense-in-
  // depth).
  if (outboxPeerPath && existsSync(outboxPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(src); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return false;
  }

  // Round-7 canonical post-commit re-check (defense-in-depth under round-8).
  if (existsSync(canonicalPeerPath)) {
    try { unlinkSync(join(droppedDir, `${eid}.json`)); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    try { unlinkSync(src); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return false;
  }

  try { unlinkSync(src); } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  return status === 'created';
}

function cleanupOrphanTmp(dir, now, maxAgeMs) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (err) { if (err && err.code === 'ENOENT') return 0; throw err; }
  const cutoff = now() - maxAgeMs;
  let cleaned = 0;
  for (const name of entries) {
    if (!TMP_FILENAME_RE.test(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); }
    catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }
    if (st.mtimeMs > cutoff) continue;
    try { unlinkSync(p); cleaned++; }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  }
  return cleaned;
}
