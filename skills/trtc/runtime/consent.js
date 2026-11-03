// Project-local, single-slot first Prompt hold and bounded notice delivery.
// This file deliberately never writes Pending/Outbox or performs network I/O.
// Older runtimes cannot discover this slot by draining their global queues.
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { resolveProjectStateDir } from './project-state.js';
import { acquireCoordinationReservation, releaseCoordinationReservation } from './session-context.js';

export const CONSENT_VERSION = 2;
export const CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOTICE_LIMIT = 2;
const ANONYMOUS_REPLAY_MS = 60_000;
const filePath = (root) => join(resolveProjectStateDir(root), 'experience-consent-v2.json');

export function readConsentState(root, key) {
  const path = filePath(root);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) return { status: 'corrupt' };
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value?.version !== CONSENT_VERSION || value.project_key !== key
      || !Number.isFinite(value.created_at) || !Number.isInteger(value.notice_count)
      || value.notice_count < 0 || value.notice_count > NOTICE_LIMIT
      || !['held', 'released', 'expired', 'discarded'].includes(value.first_status)
      || (value.notice_count > 0 && (!/^[a-f0-9]{32}$/.test(value.notice_attempt_id || '')
        || !Number.isFinite(value.presented_at)
        || !['zh-CN', 'en-US'].includes(value.notice_locale)
        || (value.notice_sessionid != null && typeof value.notice_sessionid !== 'string')))
      || (value.pending_choice != null && !['allowed', 'denied'].includes(value.pending_choice))
      || (value.first_event && (value.first_event.__project_key !== key
        || value.first_event.method !== 'prompt' || typeof value.first_event.text !== 'string'))) {
      return { status: 'corrupt' };
    }
    return { status: 'valid', value };
  } catch (err) { return { status: err?.code === 'ENOENT' ? 'missing' : 'corrupt' }; }
}

function atomicWrite(path, value, durable) {
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8');
    if (durable) fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(tmp, path);
    if (durable) {
      const dir = openSync(dirname(path), 'r');
      try { fsyncSync(dir); } catch (err) {
        if (!['EINVAL', 'ENOSYS', 'EPERM', 'EACCES'].includes(err?.code)) throw err;
      } finally { closeSync(dir); }
    }
    return true;
  } catch { return false; }
  finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* noop */ }
    try { unlinkSync(tmp); } catch { /* noop */ }
  }
}

export function updateConsentState(root, key, update, opts = {}) {
  // Reuse the existing project-local owner-token lock protocol. No global
  // state permissions are needed to accept a privacy answer in Codex.
  const dir = resolveProjectStateDir(root);
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { return { status: 'retryable', reason: 'consent_directory_unavailable' }; }
  const lock = acquireCoordinationReservation(root, 'consent', 'v2', {
    timeoutMs: opts.hook ? 1 : (opts.timeoutMs ?? 80),
  });
  if (!lock) return { status: 'retryable', reason: 'consent_busy' };
  try {
    const current = readConsentState(root, key);
    if (current.status === 'corrupt') return { status: 'retryable', reason: 'consent_corrupt' };
    const now = typeof opts.now === 'function' ? opts.now() : (opts.now ?? Date.now());
    let value = current.status === 'valid' ? JSON.parse(JSON.stringify(current.value)) : null;
    if (value?.first_event && (now < value.created_at || now - value.created_at > CONSENT_TTL_MS)) {
      delete value.first_event;
      value.first_status = 'expired';
    }
    const result = update(value, now);
    if (!result?.value) return result || { status: 'skipped' };
    const next = result.value;
    if (!atomicWrite(filePath(root), next, !opts.hook)) {
      // A failed notice claim is not a presentation. Preserve the old quota
      // and store a bounded retry on this same file when the filesystem
      // permits the diagnostic write. Total filesystem failure stays closed.
      if (opts.noticeRetry && current.status === 'valid') {
        const retry = { ...current.value };
        retry.notice_retry_count = Math.min((retry.notice_retry_count || 0) + 1, 7);
        retry.notice_retry_at = now + Math.min(60_000, 1000 * 2 ** (retry.notice_retry_count - 1));
        atomicWrite(filePath(root), retry, true);
      }
      return { status: 'retryable', reason: 'consent_write_failed' };
    }
    return { ...result, status: result.status || 'updated' };
  } finally { releaseCoordinationReservation(lock); }
}

export function consentTurn(input, ide, text, now) {
  const session = input?.raw_session_id || input?.session_id || input?.conversation_id || input?.thread_id || input?.host_thread_hint || '';
  const turn = input?.turn_id || '';
  return {
    base: createHash('sha256').update(JSON.stringify([ide, session, turn || text])).digest('hex'),
    reliable: Boolean(turn), now,
  };
}

function selectTurn(value, turn, now) {
  if (value.turn_base !== turn.base
    || (!turn.reliable && now - value.turn_seen_at > ANONYMOUS_REPLAY_MS)) {
    value.turn_base = turn.base;
    value.turn_id = randomBytes(16).toString('hex');
    value.turn_seen_at = now;
  }
}

export function holdFirstPrompt(root, key, event, turn, opts = {}) {
  return updateConsentState(root, key, (current, now) => {
    const value = current || {
      version: CONSENT_VERSION, project_key: key, created_at: now,
      first_status: 'held', first_event: event, notice_count: 0,
    };
    selectTurn(value, turn, now);
    // The foreground route hint may arrive after Hook capture. Enrich only
    // the same logical first turn; preserve its original text, ID and time.
    if (value.first_event && (value.first_event.__consent_turn_base === turn.base
      || (value.first_event.text === event.text && now - value.created_at <= ANONYMOUS_REPLAY_MS))) {
      for (const field of ['__route_hint', '__route_product', '__route_framework']) {
        if (event[field]) value.first_event[field] = event[field];
      }
    }
    return { status: 'awaiting_consent', value, durable: !opts.hook,
      event_id: value.first_event?.event_id };
  }, opts);
}

export function claimConsentNotice(root, key, { turn, sessionid = null, ide, locale, now = Date.now } = {}) {
  return updateConsentState(root, key, (value, time) => {
    if (!value) return { status: 'not_found' };
    if (time < value.created_at || time - value.created_at > CONSENT_TTL_MS) {
      return { status: 'expired', value };
    }
    if (turn) selectTurn(value, turn, time);
    if (value.notice_retry_at > time) return { status: 'backoff', value };
    if (value.notice_count >= NOTICE_LIMIT || value.notice_turn === value.turn_id) {
      return { status: 'not_required', value };
    }
    value.notice_count++;
    delete value.notice_retry_at;
    delete value.notice_retry_count;
    value.notice_turn = value.turn_id;
    value.notice_attempt_id = randomBytes(16).toString('hex');
    value.notice_sessionid = sessionid;
    value.notice_ide = ide;
    value.notice_locale = locale || value.notice_locale || 'zh-CN';
    value.presented_at = time;
    return { status: 'required', value, notice_attempt_id: value.notice_attempt_id,
      notice_locale: value.notice_locale };
  }, { now, noticeRetry: true });
}
