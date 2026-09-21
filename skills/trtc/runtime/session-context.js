// session-context.js — anonymous legacy-session/context coordination for C11.
// Raw host conversation IDs are accepted only in memory and never written.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { isPidAlive } from './identity.js';
import { resolveProjectStateDir } from './project-state.js';

export const BINDING_TTL_MS = 30 * 60 * 1000;
export const CONTEXT_TTL_MS = 30 * 60 * 1000;
export const FINGERPRINT_DEDUP_WINDOW_MS = 10 * 1000;
export const RESERVATION_STALE_GRACE_MS = 60 * 1000;

const COORD_DIR = 'session-context-v2';
const LOCK_DIR = 'locks';
const BINDING_DIR = 'bindings';
const CONTEXT_DIR = 'contexts';
const STAGE_DIR = 'stages';
// A foreground host often omits its raw conversation/session id even though
// it does provide a stable turn id.  Keep a project-local, privacy-safe
// mapping for that exact turn so a Hook-created event remains addressable
// after Pending/Outbox cleanup.  The raw turn id is used only as a hash key;
// it is never persisted.
const TURN_RECEIPT_DIR = 'turn-receipts';
const TURN_RECEIPT_VERSION = 1;

function digest(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(String(part)).update('\0');
  return hash.digest('hex');
}

/** Pure anonymous session derivation shared by Hook and legacy bindings. */
export function deriveSessionId(projectRoot, ide, rawHostSessionId) {
  if (typeof rawHostSessionId !== 'string' || rawHostSessionId.length === 0) return null;
  return `sess_${digest(projectRoot, ide || 'unknown', rawHostSessionId).slice(0, 32)}`;
}

/** Stable fallback for non-context legacy events when no host binding exists. */
export function deriveProjectFallbackSession(projectRoot) {
  return `sess_project_${digest(projectRoot).slice(0, 24)}`;
}

export function promptFingerprint(text) {
  return digest(text).slice(0, 32);
}

export function coordinationRoot(projectRoot) {
  return join(resolveProjectStateDir(projectRoot), COORD_DIR);
}

function safeSessionId(value) {
  return typeof value === 'string' && /^(?:sess_[a-f0-9_]{8,64}|sess_project_[a-f0-9]{24})$/.test(value);
}

function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
}

function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function writeJsonAtomic(path, value, opts = {}) {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const tmp = join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    writeAll(fd, `${JSON.stringify(value)}\n`);
    if (opts.durable !== false) fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(tmp, path);
    if (opts.durable !== false) try {
      const dirFd = openSync(dir, 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch (err) {
      if (!['EINVAL', 'ENOSYS', 'EPERM', 'EACCES', 'ENOENT'].includes(err?.code)) throw err;
    }
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// Publish a JSON record without ever replacing an existing record.  Both the
// Hook and foreground paths use this primitive for turn receipts, so a race
// between them has one kernel-level winner.  The payload is written and (when
// requested) synced to a private temporary inode before linkSync publishes it
// under the final name; a crash therefore cannot leave a half-written final
// receipt.  Filesystems that do not support hard links are reported to the
// caller, which falls back to the shared coordination reservation below.
function writeJsonNoClobberAtomic(path, value, opts = {}) {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const tmp = join(dir, `.${randomBytes(8).toString('hex')}.receipt.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    writeAll(fd, `${JSON.stringify(value)}\n`);
    if (opts.durable !== false) fsyncSync(fd);
    closeSync(fd); fd = undefined;
    try {
      linkSync(tmp, path);
      if (opts.durable !== false) {
        try {
          const dirFd = openSync(dir, 'r');
          try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
        } catch (err) {
          // Directory fsync is not available on all supported hosts/filesystems
          // (notably Windows and some network/FAT mounts). The file has already
          // been fully written and published at this point; these platform
          // capability errors must not turn a successful claim into a retry.
          if (!['EINVAL', 'ENOSYS', 'EPERM', 'EACCES', 'ENOENT', 'EISDIR', 'EBADF', 'ENOTDIR', 'ENOTSUP', 'EOPNOTSUPP'].includes(err?.code)) throw err;
        }
      }
      return { status: 'created' };
    } catch (err) {
      if (err?.code === 'EEXIST') return { status: 'exists' };
      if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(err?.code)) {
        return { status: 'unsupported' };
      }
      throw err;
    }
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function bindingPath(projectRoot, sessionid) {
  return join(coordinationRoot(projectRoot), BINDING_DIR, `${sessionid}.json`);
}

function contextPath(projectRoot, sessionid) {
  return join(coordinationRoot(projectRoot), CONTEXT_DIR, `${sessionid}.json`);
}

function stagePath(projectRoot, sessionid, stageKey) {
  return join(coordinationRoot(projectRoot), STAGE_DIR, `${digest(sessionid, stageKey)}.json`);
}

function turnReceiptKey(ide, turnId) {
  if (typeof ide !== 'string' || ide.length === 0
    || typeof turnId !== 'string' || turnId.length === 0 || turnId.length > 1024) return null;
  return digest('turn-receipt', ide, turnId);
}

function turnReceiptPath(projectRoot, ide, turnId) {
  const key = turnReceiptKey(ide, turnId);
  return key ? join(coordinationRoot(projectRoot), TURN_RECEIPT_DIR, `${key}.json`) : null;
}

function listJson(dir) {
  try { return readdirSync(dir).filter((name) => /^sess_[a-f0-9_]{8,64}\.json$/.test(name)); }
  catch { return []; }
}

/** Refresh one already-anonymized host binding. No raw host ID is persisted. */
export function refreshBinding(projectRoot, sessionid, ide = 'unknown', opts = {}) {
  if (!safeSessionId(sessionid)) throw new TypeError('invalid anonymous sessionid');
  if (opts.hookMode === true) {
    const now = opts.now?.() ?? Date.now();
    const existing = readJson(bindingPath(projectRoot, sessionid));
    if (existing?.sessionid === sessionid && Number.isFinite(existing.updated_at)
      && now - existing.updated_at < (opts.ttlMs ?? BINDING_TTL_MS) / 2) {
      return { status: 'bound', sessionid };
    }
    writeJsonAtomic(bindingPath(projectRoot, sessionid), {
      sessionid,
      ide: typeof ide === 'string' ? ide.slice(0, 64) : 'unknown',
      updated_at: now,
    }, { durable: false });
    return { status: 'bound', sessionid };
  }
  const deadlineMono = opts.deadlineMono ?? (performance.now() + (opts.timeoutMs ?? 1000));
  const lock = acquireCoordinationReservation(projectRoot, 'binding', 'project', { ...opts, deadlineMono });
  if (!lock) return { status: 'busy' };
  try {
    const now = opts.now?.() ?? Date.now();
    writeJsonAtomic(bindingPath(projectRoot, sessionid), {
      sessionid,
      ide: typeof ide === 'string' ? ide.slice(0, 64) : 'unknown',
      updated_at: now,
    }, { durable: opts.hookMode !== true });
    cleanupExpiredBindings(projectRoot, { now, ttlMs: opts.ttlMs });
    return { status: 'bound', sessionid };
  } finally { releaseCoordinationReservation(lock); }
}

export function cleanupExpiredBindings(projectRoot, opts = {}) {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? BINDING_TTL_MS;
  const dir = join(coordinationRoot(projectRoot), BINDING_DIR);
  let removed = 0;
  for (const name of listJson(dir)) {
    const path = join(dir, name);
    const value = readJson(path);
    if (!value || !safeSessionId(value.sessionid) || !Number.isFinite(value.updated_at) || now - value.updated_at > ttlMs) {
      try { unlinkSync(path); removed++; } catch { /* concurrent cleanup */ }
    }
  }
  return removed;
}

export function listFreshBindings(projectRoot, opts = {}) {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? BINDING_TTL_MS;
  const dir = join(coordinationRoot(projectRoot), BINDING_DIR);
  const values = [];
  for (const name of listJson(dir)) {
    const value = readJson(join(dir, name));
    if (!value || !safeSessionId(value.sessionid) || !Number.isFinite(value.updated_at)) continue;
    if (now - value.updated_at <= ttlMs) values.push(value);
  }
  return values.sort((a, b) => a.sessionid.localeCompare(b.sessionid));
}

/** Resolve a legacy call without guessing among multiple live conversations. */
export function resolveAnonymousSession(projectRoot, opts = {}) {
  if (safeSessionId(opts.sessionid)) return { status: 'resolved', sessionid: opts.sessionid, source: 'explicit' };
  const bindings = listFreshBindings(projectRoot, opts);
  if (bindings.length === 1) return { status: 'resolved', sessionid: bindings[0].sessionid, source: 'binding' };
  if (bindings.length > 1) return { status: 'ambiguous', sessions: bindings.map((v) => v.sessionid) };
  if (opts.allowFallback === false) return { status: 'not_found' };
  return { status: 'resolved', sessionid: deriveProjectFallbackSession(projectRoot), source: 'fallback' };
}

/** Store a sanitized assistant question for the next prompt in one session. */
export function putContext(projectRoot, sessionid, question, opts = {}) {
  if (!safeSessionId(sessionid)) throw new TypeError('invalid anonymous sessionid');
  if (typeof question !== 'string' || question.length === 0) throw new TypeError('invalid context question');
  const lock = acquireCoordinationReservation(projectRoot, 'context', sessionid, opts);
  if (!lock) return { status: 'busy' };
  try {
    const now = opts.now?.() ?? Date.now();
    writeJsonAtomic(contextPath(projectRoot, sessionid), {
      sessionid,
      question,
      created_at: now,
      expires_at: now + (opts.ttlMs ?? CONTEXT_TTL_MS),
      consumed_by_event_id: null,
    });
    return { status: 'stored', sessionid };
  } finally { releaseCoordinationReservation(lock); }
}

/** Caller must hold the session/context reservation while using this snapshot. */
export function readContext(projectRoot, sessionid, opts = {}) {
  if (!safeSessionId(sessionid)) return null;
  const path = contextPath(projectRoot, sessionid);
  const value = readJson(path);
  const now = opts.now ?? Date.now();
  if (!value || value.sessionid !== sessionid || !Number.isFinite(value.expires_at) || value.expires_at < now) {
    if (existsSync(path)) try { unlinkSync(path); } catch { /* concurrent cleanup */ }
    return null;
  }
  return value;
}

export function hasContext(projectRoot, sessionid) {
  return safeSessionId(sessionid) && existsSync(contextPath(projectRoot, sessionid));
}

/** Mark consumption only after the Pending event exists. */
export function markContextConsumed(projectRoot, sessionid, eventId, expectedCreatedAt) {
  const path = contextPath(projectRoot, sessionid);
  const value = readJson(path);
  if (!value || value.sessionid !== sessionid || value.created_at !== expectedCreatedAt) return false;
  if (value.consumed_by_event_id && value.consumed_by_event_id !== eventId) return false;
  writeJsonAtomic(path, { ...value, consumed_by_event_id: eventId });
  return true;
}

/** Read/write is serialized by the caller's stage reservation. */
export function readStageReceipt(projectRoot, sessionid, stageKey, opts = {}) {
  const path = stagePath(projectRoot, sessionid, stageKey);
  const value = readJson(path);
  if (value && value.sessionid === sessionid) return value;
  return opts.reportInvalid && existsSync(path) ? { status: 'corrupt' } : null;
}

export function writeStageReceipt(projectRoot, sessionid, stageKey, value, opts = {}) {
  if (!safeSessionId(sessionid)) throw new TypeError('invalid anonymous sessionid');
  const previous = readStageReceipt(projectRoot, sessionid, stageKey);
  const attribution = previous?.event_id === value.event_id ? { ...previous, ...value } : value;
  writeJsonAtomic(stagePath(projectRoot, sessionid, stageKey), {
    sessionid,
    event_id: value.event_id,
    source: value.source,
    claimed_sources: Array.isArray(value.claimed_sources)
      ? [...new Set(value.claimed_sources.filter((v) => typeof v === 'string'))].slice(0, 8)
      : [],
    time: value.time,
    ...Object.fromEntries(['route_hint', 'product', 'framework']
      .filter((field) => typeof attribution[field] === 'string' && attribution[field].length > 0)
      .map((field) => [field, attribution[field]])),
  }, { durable: opts.durable !== false });
}

/**
 * Read the stable project+IDE+turn mapping used when a host omits raw
 * session identity.  Only an anonymized turn hash is persisted.
 */
export function readTurnReceipt(projectRoot, ide, turnId) {
  const path = turnReceiptPath(projectRoot, ide, turnId);
  if (!path) return null;
  const value = readJson(path);
  if (!value) return existsSync(path) ? { status: 'corrupt' } : null;
  if (!value || value.version !== TURN_RECEIPT_VERSION
    || value.turn_key !== turnReceiptKey(ide, turnId)
    || value.ide !== ide
    || !safeSessionId(value.sessionid)
    || typeof value.event_id !== 'string'
    || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(value.event_id)
    || !Number.isFinite(value.time)) return { status: 'corrupt' };
  return value;
}

/**
 * Persist a first-writer-wins mapping from an exact host turn to the event
 * staged for it.  A conflicting mapping is never overwritten: callers must
 * retry with the existing identity rather than minting a second event.
 */
export function writeTurnReceipt(projectRoot, ide, turnId, value, opts = {}) {
  const key = turnReceiptKey(ide, turnId);
  const path = turnReceiptPath(projectRoot, ide, turnId);
  if (!key || !path || !safeSessionId(value?.sessionid)
    || typeof value?.event_id !== 'string'
    || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(value.event_id)
    || !Number.isFinite(value.time)) return { status: 'invalid' };

  const next = {
    version: TURN_RECEIPT_VERSION,
    turn_key: key,
    ide,
    sessionid: value.sessionid,
    event_id: value.event_id,
    time: value.time,
  };

  // Hook and foreground writers share this exact no-clobber publication
  // protocol.  The temporary inode is complete before linkSync publishes it,
  // so a process crash cannot expose a half-written final receipt; linkSync's
  // EEXIST result gives both paths one kernel-level first writer.
  let publication;
  try {
    publication = writeJsonNoClobberAtomic(path, next, { durable: opts.durable !== false });
  } catch (err) {
    return { status: 'error', reason: err?.code || 'turn_receipt_write_failed' };
  }
  if (publication.status === 'created') return { status: 'created', value: next };

  const existing = readTurnReceipt(projectRoot, ide, turnId);
  if (existing?.status === 'corrupt') return { status: 'conflict', reason: 'turn_receipt_corrupt' };
  if (existing) {
    return existing.sessionid === value.sessionid && existing.event_id === value.event_id
      ? { status: 'already_present', value: existing }
      : { status: 'conflict', value: existing };
  }

  // Hard links can be unavailable on FAT/exFAT/SMB or restricted mounts. In
  // that case both callers fall back to the same coordination reservation;
  // the foreground path can wait briefly while a Hook simply returns retry so
  // the next foreground entry can repair the claim. The fallback still checks
  // the final record under the shared lock before publishing and never
  // replaces an existing mapping.
  if (publication.status === 'unsupported') {
    const lock = acquireCoordinationReservation(projectRoot, 'turn-receipt', key, opts);
    if (!lock) return { status: 'retry', reason: 'turn_receipt_busy' };
    try {
      const lockedExisting = readTurnReceipt(projectRoot, ide, turnId);
      if (lockedExisting?.status === 'corrupt') return { status: 'conflict', reason: 'turn_receipt_corrupt' };
      if (lockedExisting) {
        return lockedExisting.sessionid === value.sessionid && lockedExisting.event_id === value.event_id
          ? { status: 'already_present', value: lockedExisting }
          : { status: 'conflict', value: lockedExisting };
      }
      try {
        writeJsonAtomic(path, next, { durable: opts.durable !== false });
        return { status: 'created', value: next };
      } catch (err) {
        return { status: 'error', reason: err?.code || 'turn_receipt_write_failed' };
      }
    } finally { releaseCoordinationReservation(lock); }
  }

  // A concurrent writer may have published between linkSync's EEXIST and the
  // read above. Treat that as a transient retry rather than minting an ID.
  return { status: 'retry', reason: 'turn_receipt_unavailable' };
}

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeAll(fd, body) {
  const buffer = Buffer.from(body);
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
}

function parseOwner(raw) {
  try {
    const owner = JSON.parse(raw);
    if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return null;
    if (typeof owner.token !== 'string' || !/^[a-f0-9]{32}$/.test(owner.token)) return null;
    if (!Number.isFinite(owner.ts)) return null;
    return owner;
  } catch { return null; }
}

function lockPath(projectRoot, namespace, key) {
  const root = coordinationRoot(projectRoot);
  const dir = join(root, LOCK_DIR);
  mkdirSync(dir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
  return join(dir, `${digest(namespace, key)}.lock`);
}

function tryRecoverStale(path, sampledRaw, opts) {
  const owner = parseOwner(sampledRaw);
  if (owner) {
    if (opts.now() - owner.ts <= opts.staleGraceMs) return false;
    if (opts.pidAlive(owner.pid) !== false) return false;
  } else {
    let mtimeMs;
    try { mtimeMs = statSync(path).mtimeMs; } catch { return false; }
    if (opts.now() - mtimeMs <= opts.staleGraceMs) return false;
  }
  const scratch = `${path}.steal-${process.pid}-${randomBytes(8).toString('hex')}`;
  try { renameSync(path, scratch); } catch (err) {
    if (err?.code === 'ENOENT') return true;
    return false;
  }
  let moved = '';
  try { moved = readFileSync(scratch, 'utf8'); } catch { /* conservative below */ }
  if (moved !== sampledRaw) {
    try { linkSync(scratch, path); } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }
  try { unlinkSync(scratch); } catch { /* next acquisition can retry */ }
  return moved === sampledRaw;
}

/**
 * Acquire one owner-token reservation under a caller-owned absolute deadline.
 * Callers enforce the global binding → context → stage → event lock order.
 */
export function acquireCoordinationReservation(projectRoot, namespace, key, opts = {}) {
  const path = lockPath(projectRoot, namespace, key);
  const deadlineMono = Number.isFinite(opts.deadlineMono)
    ? opts.deadlineMono
    : performance.now() + (opts.timeoutMs ?? 1000);
  const now = opts.now || Date.now;
  const pidAlive = opts.isPidAlive || isPidAlive;
  const staleGraceMs = opts.staleGraceMs ?? RESERVATION_STALE_GRACE_MS;
  let backoff = 1;
  while (performance.now() < deadlineMono) {
    const token = randomBytes(16).toString('hex');
    let fd;
    try {
      fd = openSync(path, 'wx', process.platform === 'win32' ? undefined : 0o600);
      writeAll(fd, JSON.stringify({ pid: process.pid, ts: now(), token }));
      closeSync(fd); fd = undefined;
      return { path, token };
    } catch (err) {
      if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
      if (err?.code !== 'EEXIST') {
        try { unlinkSync(path); } catch { /* best-effort rollback of our O_EXCL file */ }
        throw err;
      }
      let raw = '';
      try { raw = readFileSync(path, 'utf8'); } catch (readErr) {
        if (readErr?.code === 'ENOENT') continue;
        throw readErr;
      }
      tryRecoverStale(path, raw, { now, pidAlive, staleGraceMs });
      const remaining = deadlineMono - performance.now();
      if (remaining <= 0) break;
      sleepSync(Math.min(backoff, remaining));
      backoff = Math.min(backoff * 2, 10);
    }
  }
  return null;
}

export function releaseCoordinationReservation(lock) {
  if (!lock || typeof lock.path !== 'string' || typeof lock.token !== 'string') {
    throw new TypeError('reservation handle must contain path and token');
  }
  let raw;
  try { raw = readFileSync(lock.path, 'utf8'); } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
  if (parseOwner(raw)?.token !== lock.token) return false;
  try { unlinkSync(lock.path); return true; } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}
