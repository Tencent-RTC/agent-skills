// C20 control-plane state.  This module is deliberately independent from
// preference.js and telemetry.js so the Hook and the Python compatibility
// shim can use the same project/fingerprint protocol without importing the
// reporting pipeline.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import noticeSpec from './continuation-notice.js';
import { choiceFromLocalizedText, normalizeNoticeLocale } from './notice-locale.js';

export const NOTICE_VERSION = noticeSpec.version;
export const NOTICE_STATES = Object.freeze([
  'pending_output', 'awaiting_choice', 'allow_pending', 'deny_pending',
  'allowed', 'denied', 'ignored',
]);
export const CONTROL_STATES = Object.freeze([
  'allowed_pending', 'allowed', 'deny_pending', 'denied', 'retryable',
]);
export const ALLOW_LABEL = noticeSpec.allow_label;
export const DENY_LABEL = noticeSpec.deny_label;
export const ALLOWED = noticeSpec.markers.allowed;
export const CONTROL_RETRY = noticeSpec.markers.choice_retry;
export const ALLOW_RETRY = noticeSpec.markers.allow_retry;
export const DISABLED = noticeSpec.markers.disabled;
export const DISABLE_RETRY = noticeSpec.markers.disable_retry;
export const NOTICE_REQUIRED = noticeSpec.markers.notice_required;

const PROJECT_KEY_RE = /^[a-f0-9]{32}$/;
const CONTROL_KEY_RE = /^[a-f0-9]{64}$/;
const ATTEMPT_RE = /^[a-f0-9]{32}$/;
const OWNER_FILE = '.control-owner';
const SEND_OWNER_FILE = '.send-owner';
const PRODUCER_DIR = 'producer-leases';
const LOCK_GRACE_MS = 5000;
const UNSUPPORTED_DIR_FSYNC = new Set(['EINVAL', 'ENOSYS', 'EPERM', 'EACCES', 'ENOENT']);
// Hook invocations in one host process commonly target the same project. Once
// the fixed producer directory has been validated/created, avoid repeating a
// recursive mkdir on every prompt; each lease itself remains O_EXCL.
const READY_PRODUCER_DIRS = new Set();

export function isCanonicalOption(text) {
  return choiceFromLocalizedText(text);
}

export function controlKey(projectKey, option) {
  if (!PROJECT_KEY_RE.test(projectKey) || !['allowed', 'denied'].includes(option)) return null;
  const fingerprint = createHash('sha256').update(option === 'allowed' ? ALLOW_LABEL : DENY_LABEL).digest('hex');
  return createHash('sha256')
    .update(projectKey).update('\0').update(fingerprint).update('\0').update(String(NOTICE_VERSION))
    .digest('hex');
}

export function optionFingerprint(option) {
  if (!['allowed', 'denied'].includes(option)) return null;
  return createHash('sha256').update(option === 'allowed' ? ALLOW_LABEL : DENY_LABEL).digest('hex');
}

function validProjectKey(value) { return typeof value === 'string' && PROJECT_KEY_RE.test(value); }
function validControlKey(value) { return typeof value === 'string' && CONTROL_KEY_RE.test(value); }
function validAttempt(value) { return typeof value === 'string' && ATTEMPT_RE.test(value); }

function controlDir(stateRoot, projectKey) {
  if (!validProjectKey(projectKey)) return null;
  return join(stateRoot, 'telemetry', 'control', projectKey);
}

function paths(stateRoot, projectKey) {
  const dir = controlDir(stateRoot, projectKey);
  if (!dir) return null;
  return {
    dir,
    notice: join(dir, 'notice-v1.json'),
    tombstone: join(dir, 'deny-v1.tombstone'),
    lock: join(dir, OWNER_FILE),
    sendLock: join(dir, SEND_OWNER_FILE),
    producerDir: join(dir, PRODUCER_DIR),
    turns: join(dir, 'control-turns'),
  };
}

export function isValidProjectKey(value) { return validProjectKey(value); }

function ensureDir(path) {
  mkdirSync(path, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
}

function writeAll(fd, value) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  let offset = 0;
  while (offset < body.length) offset += writeSync(fd, body, offset, body.length - offset);
}

function fsyncDirBestEffort(dir, opts = {}) {
  try {
    if (typeof opts._fsyncDir === 'function') {
      opts._fsyncDir(dir);
      return { ok: true, injected: true };
    }
    const dfd = openSync(dir, 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
    return { ok: true };
  } catch (err) {
    if (UNSUPPORTED_DIR_FSYNC.has(err?.code)) return { ok: true, unsupported: true };
    return { ok: false, code: err?.code || 'directory_fsync_failed' };
  }
}

function durabilizeFile(path, dir, opts = {}) {
  try {
    const fd = openSync(path, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const synced = fsyncDirBestEffort(dir, opts);
    return synced.ok;
  } catch { return false; }
}

function atomicWrite(path, value, opts = {}) {
  const dir = dirname(path);
  ensureDir(dir);
  const tmp = join(dir, `.${randomBytes(8).toString('hex')}.control.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    writeAll(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(tmp, path);
    const synced = fsyncDirBestEffort(dir, opts);
    if (!synced.ok) throw Object.assign(new Error('directory_fsync_failed'), { code: synced.code });
    return true;
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch { /* noop */ }
    try { unlinkSync(tmp); } catch { /* noop */ }
    return false;
  }
}

function readJson(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function lstatRegularFile(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return { status: 'invalid' };
    return { status: 'regular' };
  } catch (err) {
    if (err?.code === 'ENOENT') return { status: 'missing' };
    return { status: 'error', reason: err?.code || 'lstat_failed' };
  }
}

function readAny(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function ownerToken() { return randomBytes(16).toString('hex'); }

export function acquireControlReservation(stateRoot, projectKey, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p) return null;
  ensureDir(p.dir);
  const deadline = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : performanceNow() + (opts.timeoutMs ?? 250);
  const token = ownerToken();
  const body = JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  while (performanceNow() < deadline) {
    try {
      const fd = openSync(p.lock, 'wx', process.platform === 'win32' ? undefined : 0o600);
      try { writeAll(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
      return { path: p.lock, token };
    } catch (err) {
      if (err?.code !== 'EEXIST') return null;
      let old = null;
      try { old = JSON.parse(readFileSync(p.lock, 'utf8')); } catch { /* stale by mtime below */ }
      let stale = false;
      try {
        const age = Date.now() - statSync(p.lock).mtimeMs;
        stale = age > (opts.staleGraceMs ?? LOCK_GRACE_MS)
          && (typeof old?.pid !== 'number' || !isProcessAlive(old.pid));
      } catch { stale = false; }
      if (stale) {
        try { renameSync(p.lock, `${p.lock}.stale.${token}`); } catch { /* racer */ }
        try { unlinkSync(`${p.lock}.stale.${token}`); } catch { /* noop */ }
      }
      sleepSync(Math.min(10, Math.max(1, deadline - performanceNow())));
    }
  }
  return null;
}

export function releaseControlReservation(lock) {
  if (!lock?.path || !lock?.token) return;
  try {
    const owner = readJson(lock.path);
    if (owner?.token === lock.token) unlinkSync(lock.path);
  } catch { /* another owner/recovery won */ }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err?.code !== 'ESRCH'; }
}

function performanceNow() {
  return Number(globalThis.performance?.now?.() ?? Date.now());
}
function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function validateNotice(value, projectKey) {
  if (!value || typeof value !== 'object' || !validProjectKey(projectKey)) return null;
  if (value.version !== NOTICE_VERSION || value.project_key !== projectKey
    || !NOTICE_STATES.includes(value.status) || value.notice_version !== NOTICE_VERSION
    || typeof value.event_id !== 'string' || value.event_id.length === 0
    || !validAttempt(value.notice_attempt_id) || !Number.isFinite(value.created_at)) return null;
  if (value.sessionid !== null && typeof value.sessionid !== 'string') return null;
  if (value.notice_locale !== undefined && !normalizeNoticeLocale(value.notice_locale)) return null;
  // Legacy receipts predate localization and are intentionally interpreted as
  // Chinese so an existing first-use flow remains replayable.
  return { ...value, notice_locale: normalizeNoticeLocale(value.notice_locale) || 'zh-CN' };
}

function validateTurn(value, projectKey, expectedKey) {
  if (!value || typeof value !== 'object' || value.version !== NOTICE_VERSION
    || value.project_key !== projectKey || !validControlKey(value.control_key)
    || value.control_key !== expectedKey || !CONTROL_STATES.includes(value.control_status)
    || !['allowed', 'denied'].includes(value.control_kind)
    || value.notice_version !== NOTICE_VERSION || !Number.isFinite(value.created_at)) return null;
  return { ...value };
}

export function readNoticeReceipt(stateRoot, projectKey) {
  const p = paths(stateRoot, projectKey);
  if (!p) return { status: 'invalid' };
  const file = lstatRegularFile(p.notice);
  if (file.status === 'missing') return { status: 'missing' };
  if (file.status !== 'regular') return { status: 'corrupt' };
  const value = validateNotice(readJson(p.notice), projectKey);
  return value ? { status: 'valid', value } : { status: 'corrupt' };
}

export function writeNoticeReceipt(stateRoot, projectKey, receipt) {
  const p = paths(stateRoot, projectKey);
  if (!p || !validAttempt(receipt?.notice_attempt_id)) return { status: 'error', reason: 'invalid_receipt' };
  const lock = acquireControlReservation(stateRoot, projectKey, { timeoutMs: 100 });
  if (!lock) return { status: 'error', reason: 'control_busy' };
  try {
    const existing = readNoticeReceipt(stateRoot, projectKey);
    if (existing.status === 'valid') return { status: 'already_present', receipt: existing.value };
    if (existing.status === 'corrupt') return { status: 'error', reason: 'receipt_corrupt' };
    const value = {
      version: NOTICE_VERSION, notice_version: NOTICE_VERSION, status: 'pending_output',
      project_key: projectKey, event_id: receipt.event_id, sessionid: receipt.sessionid ?? null,
      notice_attempt_id: receipt.notice_attempt_id, created_at: Number.isFinite(receipt.created_at) ? receipt.created_at : Date.now(),
      notice_locale: normalizeNoticeLocale(receipt.notice_locale) || 'zh-CN',
    };
    if (!atomicWrite(p.notice, value)) return { status: 'error', reason: 'receipt_write_failed' };
    return { status: 'created', receipt: value };
  } finally { releaseControlReservation(lock); }
}

export function noticeStatus(stateRoot, projectKey, attemptId, sessionid = null) {
  const p = paths(stateRoot, projectKey);
  if (!p || !validAttempt(attemptId)) return { status: 'not_found' };
  const lock = acquireControlReservation(stateRoot, projectKey, { timeoutMs: 100 });
  if (!lock) return { status: 'retry', marker: CONTROL_RETRY };
  try {
    const receipt = readNoticeReceipt(stateRoot, projectKey);
    if (receipt.status !== 'valid') return { status: receipt.status === 'missing' ? 'not_found' : 'retry', marker: CONTROL_RETRY };
    const value = receipt.value;
    // Python invoke may not have a host session identifier.  When both sides
    // have one it must match; otherwise the project+attempt capability is the
    // only safe bridge (never scan or guess among sessions).
    if (value.notice_attempt_id !== attemptId
      || (value.sessionid !== null && sessionid !== null && value.sessionid !== sessionid)) return { status: 'not_found' };
    if (value.status === 'pending_output') {
      const next = { ...value, status: 'awaiting_choice' };
      if (!atomicWrite(p.notice, next)) return { status: 'retry', marker: CONTROL_RETRY };
      return { status: 'required', notice_version: NOTICE_VERSION };
    }
    if (value.status === 'awaiting_choice') return { status: 'already_awaiting' };
    return { status: 'terminal', notice_status: value.status };
  } finally { releaseControlReservation(lock); }
}

export function updateNoticeStatus(stateRoot, projectKey, expected, status) {
  const p = paths(stateRoot, projectKey);
  if (!p || !NOTICE_STATES.includes(status)) return { status: 'error', reason: 'invalid_status' };
  const lock = acquireControlReservation(stateRoot, projectKey, { timeoutMs: 100 });
  if (!lock) return { status: 'retry', reason: 'control_busy' };
  try {
    const current = readNoticeReceipt(stateRoot, projectKey);
    if (current.status !== 'valid') return { status: 'retry', reason: current.status };
    if (expected && (current.value.status !== expected || (expected.event_id && current.value.event_id !== expected.event_id))) {
      return { status: 'conflict', value: current.value };
    }
    const next = { ...current.value, status };
    return atomicWrite(p.notice, next) ? { status: 'updated', value: next } : { status: 'error', reason: 'notice_write_failed' };
  } finally { releaseControlReservation(lock); }
}

export function readDenyTombstone(stateRoot, projectKey) {
  const p = paths(stateRoot, projectKey);
  if (!p) return { status: 'invalid' };
  const file = lstatRegularFile(p.tombstone);
  if (file.status === 'missing') return { status: 'missing' };
  if (file.status !== 'regular') return { status: 'corrupt' };
  const raw = readAny(p.tombstone);
  if (!raw) return { status: 'corrupt' };
  const value = readJson(p.tombstone);
  if (!value || value.version !== NOTICE_VERSION || value.project_key !== projectKey
    || value.notice_version !== NOTICE_VERSION || value.control_kind !== 'denied'
    || !validControlKey(value.control_key) || !Number.isFinite(value.created_at)) return { status: 'corrupt' };
  return { status: 'valid', value };
}

/**
 * Read the project kill switch without consulting preferences.  Missing is
 * the only state which permits a producer/sender to continue.  Every other
 * state is deliberately conservative: a malformed, foreign, symlink, or
 * special tombstone blocks network activity until foreground maintenance
 * repairs it.
 */
export function readProjectDenyGate(stateRoot, projectKey) {
  const result = readDenyTombstone(stateRoot, projectKey);
  if (result.status === 'missing') return { status: 'missing', allowed: true };
  if (result.status === 'valid') return { status: 'valid', allowed: false, value: result.value };
  if (result.status === 'invalid') return { status: 'invalid', allowed: false };
  return { status: 'corrupt', allowed: false, reason: result.reason || 'tombstone_unreadable' };
}

/**
 * Move a corrupt/foreign regular tombstone (or symlink) out of the active
 * path without following it.  Directories/devices/sockets are not moved and
 * remain a retryable fail-closed condition.
 */
export function quarantineDenyTombstone(stateRoot, projectKey, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p) return { status: 'retryable', reason: 'invalid_project_key' };
  let stat;
  try { stat = lstatSync(p.tombstone); }
  catch (err) {
    if (err?.code === 'ENOENT') return { status: 'missing' };
    return { status: 'retryable', reason: err?.code || 'tombstone_lstat_failed' };
  }
  // A symlink is safe to quarantine because rename never follows it. Other
  // special entries (directory/socket/device) must remain in place and make
  // foreground recovery retryable rather than silently moving an object.
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    return { status: 'retryable', reason: 'tombstone_special_file' };
  }
  try {
    ensureDir(join(p.dir, 'quarantine'));
    const destination = join(p.dir, 'quarantine', `deny-v1.${Date.now()}.${randomBytes(8).toString('hex')}.quarantine`);
    renameSync(p.tombstone, destination);
    const synced = fsyncDirBestEffort(p.dir, opts);
    if (!synced.ok) {
      // The quarantine rename is visible in this process but not yet
      // durable. Restore the active entry before returning so a concurrent
      // producer can never observe a temporary "missing" kill switch.
      try {
        renameSync(destination, p.tombstone);
        return { status: 'retryable', reason: synced.code || 'quarantine_dir_fsync_failed', restored: true };
      } catch {
        // If restoration races or the filesystem refuses it, leave an
        // intentionally invalid marker at the canonical path. Readers treat
        // corrupt tombstones as blocked, preserving fail-closed semantics;
        // foreground maintenance can retry quarantine later.
        try {
          const fd = openSync(p.tombstone, 'wx', process.platform === 'win32' ? undefined : 0o600);
          try { writeAll(fd, '{"quarantine_pending":true}\n'); } finally { closeSync(fd); }
          return { status: 'retryable', reason: synced.code || 'quarantine_dir_fsync_failed', fail_closed: true };
        } catch (markerErr) {
          if (markerErr?.code === 'EEXIST') {
            return { status: 'retryable', reason: synced.code || 'quarantine_dir_fsync_failed', fail_closed: true };
          }
          return { status: 'retryable', reason: 'quarantine_restore_failed', fail_closed: false };
        }
      }
    }
    return { status: 'quarantined', path: destination };
  } catch (err) {
    return { status: 'retryable', reason: err?.code || 'tombstone_quarantine_failed' };
  }
}

function acquireFileReservation(lockPath, owner, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : 100;
  const deadline = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : performanceNow() + timeoutMs;
  const token = ownerToken();
  const body = JSON.stringify({ ...owner, pid: process.pid, token, created_at: Date.now() });
  if (opts._dirReady !== true) ensureDir(dirname(lockPath));
  // Always make one bounded O_EXCL attempt even if the caller's shared Hook
  // deadline elapsed while another synchronous stage was running.  A
  // no-contention lease can still be published atomically; under contention
  // the first EEXIST returns immediately instead of waiting past budget.
  let firstAttempt = true;
  while (firstAttempt || performanceNow() <= deadline) {
    firstAttempt = false;
    try {
      const fd = openSync(lockPath, 'wx', process.platform === 'win32' ? undefined : 0o600);
      try { writeAll(fd, `${body}\n`); if (opts._hookMode !== true) fsyncSync(fd); } finally { closeSync(fd); }
      return { path: lockPath, token };
    } catch (err) {
      if (err?.code !== 'EEXIST') return null;
      let stale = false;
      let sampled = null;
      try {
        const stat = statSync(lockPath);
        const value = JSON.parse(readFileSync(lockPath, 'utf8'));
        sampled = value;
        const age = Date.now() - stat.mtimeMs;
        stale = age > (opts.staleGraceMs ?? LOCK_GRACE_MS)
          && typeof value?.pid === 'number' && !isProcessAlive(value.pid);
      } catch { stale = false; }
      if (stale) {
        const stalePath = `${lockPath}.stale.${token}`;
        try {
          renameSync(lockPath, stalePath);
          // The rename owns the old inode. Re-read the moved body before
          // unlinking it so a stale/release race cannot delete a new owner.
          const moved = JSON.parse(readFileSync(stalePath, 'utf8'));
          if (moved?.token === sampled?.token && moved?.pid === sampled?.pid) {
            unlinkSync(stalePath);
          } else {
            try { linkSync(stalePath, lockPath); } catch { /* new owner won */ }
            try { unlinkSync(stalePath); } catch { /* noop */ }
          }
        } catch { try { unlinkSync(stalePath); } catch { /* noop */ } }
      }
      const left = deadline - performanceNow();
      if (left > 0) sleepSync(Math.min(10, left));
    }
  }
  return null;
}

function releaseFileReservation(lock) {
  if (!lock?.path || !lock?.token) return;
  const releasing = `${lock.path}.releasing.${lock.token}`;
  try { renameSync(lock.path, releasing); } catch { return; }
  try {
    const value = JSON.parse(readFileSync(releasing, 'utf8'));
    if (value?.token === lock.token) unlinkSync(releasing);
    else {
      try { linkSync(releasing, lock.path); } catch { /* a new owner won */ }
      try { unlinkSync(releasing); } catch { /* noop */ }
    }
  } catch {
    try { unlinkSync(releasing); } catch { /* noop */ }
  }
}

/** Project-level serialization for foreground sender/deny/recovery work. */
export function acquireProjectSendReservation(stateRoot, projectKey, opts = {}) {
  const p = paths(stateRoot, projectKey);
  return p ? acquireFileReservation(p.sendLock, { project_key: projectKey, kind: 'send' }, opts) : null;
}

export function releaseProjectSendReservation(lock) { releaseFileReservation(lock); }

export function beginProducerLease(stateRoot, projectKey, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p) return { blocked: true, retryable: false, reason: 'invalid_project_key' };
  // Hook producer begin is a bounded fixed-path O_EXCL lease only. It must
  // not contend on the foreground send lock or perform durable fsync work;
  // foreground recovery owns that stronger serialization.
  if (opts._hookMode === true) {
    try {
      if (!READY_PRODUCER_DIRS.has(p.producerDir)) {
        ensureDir(p.producerDir);
        READY_PRODUCER_DIRS.add(p.producerDir);
      }
    } catch { return { blocked: true, retryable: true, reason: 'lease_dir_unavailable' }; }
    const lease = acquireFileReservation(join(p.producerDir, `${process.pid}-${ownerToken()}.json`), {
      project_key: projectKey, kind: 'producer',
    }, { timeoutMs: Math.min(25, opts.timeoutMs ?? 25), staleGraceMs: opts.staleGraceMs, _hookMode: true, _dirReady: true });
    return lease ? { lease, blocked: false } : { blocked: true, retryable: true, reason: 'lease_busy' };
  }
  const gate = readProjectDenyGate(stateRoot, projectKey);
  if (!gate.allowed) return { blocked: true, retryable: gate.status !== 'valid', reason: `deny_${gate.status}` };
  const sendLock = acquireProjectSendReservation(stateRoot, projectKey, opts);
  if (!sendLock) return { blocked: true, retryable: true, reason: 'send_busy' };
  try {
    const recheck = readProjectDenyGate(stateRoot, projectKey);
    if (!recheck.allowed) return { blocked: true, retryable: recheck.status !== 'valid', reason: `deny_${recheck.status}` };
    ensureDir(p.producerDir);
    const lease = acquireFileReservation(join(p.producerDir, `${process.pid}-${ownerToken()}.json`), {
      project_key: projectKey, kind: 'producer',
    }, { timeoutMs: opts.leaseTimeoutMs ?? opts.timeoutMs ?? 25, staleGraceMs: opts.staleGraceMs, _hookMode: opts._hookMode === true });
    if (!lease) return { blocked: true, retryable: true, reason: 'lease_busy' };
    return { lease, blocked: false };
  } finally { releaseProjectSendReservation(sendLock); }
}

export function endProducerLease(lease) { releaseFileReservation(lease); }

export function listActiveProducerLeases(stateRoot, projectKey, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p) return { active: 0, reclaimed: 0, busy: 0, error: 'invalid_project_key' };
  try { ensureDir(p.producerDir); } catch { return { active: 0, reclaimed: 0, busy: 1, error: 'lease_dir_unreadable' }; }
  let names;
  try { names = readdirSync(p.producerDir); } catch { return { active: 0, reclaimed: 0, busy: 1, error: 'lease_scan_failed' }; }
  let active = 0; let reclaimed = 0; let busy = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(p.producerDir, name);
    let value;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) { busy++; continue; }
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch { busy++; continue; }
    if (value?.project_key !== projectKey || typeof value.pid !== 'number') { busy++; continue; }
    let alive = null;
    try { alive = isProcessAlive(value.pid); } catch { alive = null; }
    if (alive === false && Date.now() - (value.created_at || 0) > (opts.staleGraceMs ?? LOCK_GRACE_MS)) {
      try { unlinkSync(path); reclaimed++; } catch { busy++; }
    } else if (alive === true || alive === null) active++;
  }
  return { active, reclaimed, busy };
}

/** Hook-only, bounded and non-durable deny marker. Never fsyncs or emits success. */
export function writeDenyTombstoneFromHook(stateRoot, projectKey, controlKeyValue, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p || !validControlKey(controlKeyValue)) return { status: 'retryable', reason: 'invalid_project_or_control_key' };
  const deadline = performanceNow() + Math.min(25, Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : 25);
  // The Hook cannot safely create a recursive directory tree inside its
  // 25ms budget. Foreground notice/install paths pre-create this directory;
  // if it is absent, return retryable and let the foreground shim retry.
  try {
    const dirStat = lstatSync(p.dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return { status: 'retryable', reason: 'control_dir_invalid', marker: DISABLE_RETRY };
  } catch { return { status: 'retryable', reason: 'control_dir_missing', marker: DISABLE_RETRY }; }
  if (performanceNow() > deadline) return { status: 'retryable', reason: 'deadline' };
  const value = {
    version: NOTICE_VERSION, project_key: projectKey, notice_version: NOTICE_VERSION,
    control_kind: 'denied', control_key: controlKeyValue, created_at: Date.now(),
    random_token: randomBytes(16).toString('hex'),
  };
  try {
    const fd = openSync(p.tombstone, 'wx', process.platform === 'win32' ? undefined : 0o600);
    try { writeAll(fd, `${JSON.stringify(value)}\n`); } finally { closeSync(fd); }
    if (performanceNow() > deadline) return { status: 'retryable', reason: 'deadline_after_close', marker: DISABLE_RETRY };
    // This is intentionally not a success marker: close only establishes a
    // best-effort deny_pending record. Foreground maintenance must fsync and
    // validate it before emitting the terminal disabled marker.
    return { status: 'pending', tombstone: value, marker: DISABLE_RETRY };
  } catch (err) {
    if (err?.code === 'EEXIST') return { status: 'already_present', marker: DISABLE_RETRY };
    return { status: 'retryable', reason: err?.code || 'tombstone_write_failed', marker: DISABLE_RETRY };
  }
}

export function writeDenyTombstone(stateRoot, projectKey, controlKeyValue, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p || !validControlKey(controlKeyValue)) return { status: 'error', reason: 'invalid_control_key' };
  ensureDir(p.dir);
  const existingPath = lstatRegularFile(p.tombstone);
  if (existingPath.status === 'invalid') {
    return { status: 'error', reason: 'tombstone_conflict' };
  }
  if (existingPath.status === 'error') {
    return { status: 'error', reason: existingPath.reason || 'tombstone_stat_failed' };
  }
  if (existingPath.status === 'regular') {
    const existing = readDenyTombstone(stateRoot, projectKey);
    return existing.status === 'valid' && existing.value.control_key === controlKeyValue
      ? (durabilizeFile(p.tombstone, p.dir, opts)
        ? { status: 'already_present', tombstone: existing.value }
        : { status: 'error', reason: 'tombstone_durability_failed' })
      : { status: 'error', reason: 'tombstone_conflict' };
  }
  const value = {
    version: NOTICE_VERSION, project_key: projectKey, notice_version: NOTICE_VERSION,
    control_kind: 'denied', control_key: controlKeyValue, created_at: Date.now(),
    random_token: randomBytes(16).toString('hex'),
  };
  // First writer wins. A direct O_EXCL write is safe for ownership; readers
  // treat malformed/foreign entries as a fail-closed kill switch.
  try {
    const fd = openSync(p.tombstone, 'wx', process.platform === 'win32' ? undefined : 0o600);
    try { writeAll(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    const synced = fsyncDirBestEffort(p.dir, opts);
    if (!synced.ok) return { status: 'error', reason: synced.code || 'directory_fsync_failed' };
    return { status: 'created', tombstone: value };
  } catch (err) {
    if (err?.code === 'EEXIST') {
      const raced = lstatRegularFile(p.tombstone);
      if (raced.status !== 'regular') return { status: 'error', reason: 'tombstone_conflict' };
      const existing = readDenyTombstone(stateRoot, projectKey);
      return existing.status === 'valid' && existing.value.control_key === controlKeyValue
        ? (durabilizeFile(p.tombstone, p.dir, opts)
          ? { status: 'already_present', tombstone: existing.value }
          : { status: 'error', reason: 'tombstone_durability_failed' })
        : { status: 'error', reason: 'tombstone_conflict' };
    }
    return { status: 'error', reason: err?.code || 'tombstone_write_failed' };
  }
}

function turnPath(p, key) { return join(p.turns, `${key}.json`); }

export function readControlTurn(stateRoot, projectKey, key) {
  const p = paths(stateRoot, projectKey);
  if (!p || !validControlKey(key)) return { status: 'invalid' };
  const path = turnPath(p, key);
  const file = lstatRegularFile(path);
  if (file.status === 'missing') return { status: 'missing' };
  if (file.status !== 'regular') return { status: 'corrupt' };
  const value = validateTurn(readJson(path), projectKey, key);
  return value ? { status: 'valid', value } : { status: 'corrupt' };
}

export function writeControlTurn(stateRoot, projectKey, key, value, opts = {}) {
  const p = paths(stateRoot, projectKey);
  if (!p || !validControlKey(key)) return { status: 'error', reason: 'invalid_control_key' };
  ensureDir(p.turns);
  const path = turnPath(p, key);
  const next = {
    version: NOTICE_VERSION, project_key: projectKey, notice_version: NOTICE_VERSION,
    control_key: key, control_kind: value.control_kind, control_status: value.control_status,
    created_at: Number.isFinite(value.created_at) ? value.created_at : Date.now(),
  };
  if (opts.firstWriter) {
    try {
      const fd = openSync(path, 'wx', process.platform === 'win32' ? undefined : 0o600);
      try { writeAll(fd, `${JSON.stringify(next)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
      const synced = fsyncDirBestEffort(p.turns, opts);
      if (!synced.ok) return { status: 'error', reason: synced.code || 'directory_fsync_failed' };
      return { status: 'created', value: next };
    } catch (err) {
      if (err?.code === 'EEXIST') {
        const existing = readControlTurn(stateRoot, projectKey, key);
        return existing.status === 'valid'
          ? { status: 'already_present', value: existing.value }
          : { status: 'error', reason: 'control_conflict' };
      }
      return { status: 'error', reason: err?.code || 'control_write_failed' };
    }
  }
  if (!atomicWrite(path, next, opts)) return { status: 'error', reason: 'control_write_failed' };
  return { status: 'updated', value: next };
}

export function hasControlState(stateRoot, projectKey) {
  const p = paths(stateRoot, projectKey);
  if (!p) return { status: 'invalid' };
  const notice = readNoticeReceipt(stateRoot, projectKey);
  const tombstone = readDenyTombstone(stateRoot, projectKey);
  let turns = [];
  try {
    turns = readdirSync(p.turns).filter((n) => CONTROL_KEY_RE.test(n.replace(/\.json$/, '')));
  } catch { /* missing is normal */ }
  return { status: 'ok', notice, tombstone, hasTurns: turns.length > 0 };
}
