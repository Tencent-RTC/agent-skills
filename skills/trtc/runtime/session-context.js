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
  return typeof value === 'string' && /^sess_[a-f0-9_]{8,64}$/.test(value);
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

function bindingPath(projectRoot, sessionid) {
  return join(coordinationRoot(projectRoot), BINDING_DIR, `${sessionid}.json`);
}

function contextPath(projectRoot, sessionid) {
  return join(coordinationRoot(projectRoot), CONTEXT_DIR, `${sessionid}.json`);
}

function stagePath(projectRoot, sessionid, stageKey) {
  return join(coordinationRoot(projectRoot), STAGE_DIR, `${digest(sessionid, stageKey)}.json`);
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
export function readStageReceipt(projectRoot, sessionid, stageKey) {
  const value = readJson(stagePath(projectRoot, sessionid, stageKey));
  return value && value.sessionid === sessionid ? value : null;
}

export function writeStageReceipt(projectRoot, sessionid, stageKey, value, opts = {}) {
  if (!safeSessionId(sessionid)) throw new TypeError('invalid anonymous sessionid');
  writeJsonAtomic(stagePath(projectRoot, sessionid, stageKey), {
    sessionid,
    event_id: value.event_id,
    source: value.source,
    claimed_sources: Array.isArray(value.claimed_sources)
      ? [...new Set(value.claimed_sources.filter((v) => typeof v === 'string'))].slice(0, 8)
      : [],
    time: value.time,
  }, { durable: opts.durable !== false });
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
