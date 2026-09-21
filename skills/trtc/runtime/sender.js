// sender.js — direct HTTPS POST to CLS (C7).
//
// P0 endpoint:
//   POST https://ap-nanjing.cls.tencentcs.com/tracklog?topic_id=<topic>
//
// Config is centralized here. Override via env for testing:
//   TRTC_TELEMETRY_ENDPOINT   — base URL (must be HTTPS in production)
//   TRTC_TELEMETRY_TOPIC_ID   — topic UUID
//   TRTC_TELEMETRY_DRY_RUN=1  — skip network, no remove, no metadata update
//
// Field mapping is NOT in this file. schema.js owns toCLSContents().

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';

import { toCLSContents } from './schema.js';
import { sanitizeReportText } from './redact.js';
import { getOrCreate, isValidIdentityRecord } from './identity.js';
import { acknowledgeHookActivation } from './hook-activation.js';
import {
  listOutbox,
  readEvent,
  remove,
  moveToRejected,
  acquireReservation,
  releaseReservation,
  updateOutboxMetadata,
  isSafeEventId,
  resolveTelemetryRoot,
} from './outbox.js';
import {
  acquireProjectSendReservation,
  acknowledgeEvent,
  acknowledgeNoticeObligation,
  ensureNoticeObligation,
  gcEventAcknowledgements,
  readEventAcknowledgement,
  readProjectDenyGate,
  readNoticeObligation,
  releaseProjectSendReservation,
} from './control.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://ap-nanjing.cls.tencentcs.com';
const DEFAULT_TOPIC_ID = 'a1310e66-a3f5-4572-a1c3-7a327a27496d';

const DEFAULT_MAX_COUNT = 50;
const DEFAULT_MAX_DURATION_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2000;
const DEFAULT_RESERVATION_TIMEOUT_MS = 100;

const BACKOFF_TABLE = Object.freeze([
  1000, 2000, 5000, 15000, 60000, 300000, 1800000, 21600000,
]);

const RESPONSE_BODY_CAP = 4096;

function gcProjectEventAcknowledgements(root, projectKey, currentEventId, opts = {}) {
  if (!projectKey || !/^[a-f0-9]{32}$/.test(projectKey)) return;
  if (opts.gcState?.ran) return;
  if (opts.gcState) opts.gcState.ran = true;
  // ACK retention is maintenance, never part of Prompt delivery. Skip it
  // when the shared foreground deadline is nearly exhausted and cap each
  // scan so a large local receipt directory cannot starve the next hook.
  if (Number.isFinite(opts.deadlineMono) && opts.deadlineMono - performance.now() < 50) return;
  try {
    const protectedEventIds = new Set();
    if (typeof currentEventId === 'string') protectedEventIds.add(currentEventId);
    // flushOutbox already has the queue snapshot it is processing. Reuse
    // that snapshot instead of scanning the entire Outbox directory again
    // from this maintenance path. Callers without a snapshot skip GC rather
    // than claiming an incomplete protection set.
    if (!Array.isArray(opts.queuedEventIds)) return;
    for (const id of opts.queuedEventIds) {
      if (typeof id === 'string' && id) protectedEventIds.add(id);
    }
    const obligation = readNoticeObligation(root, projectKey);
    if (obligation.status === 'valid' && typeof obligation.value.first_event_id === 'string') {
      protectedEventIds.add(obligation.value.first_event_id);
    }
    // Retention is hygiene only; a permission or filesystem error here must
    // never turn a confirmed delivery into a sender failure.
    gcEventAcknowledgements(root, projectKey, {
      protectedEventIds,
      maxEntries: 128,
      deadlineMono: opts.deadlineMono,
    });
  } catch { /* best-effort local retention */ }
}

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

function _httpsPost(url, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    // Strict protocol enforcement: only https: allowed. Any other
    // protocol (http:, ftp:, file:, etc.) is rejected with a clear
    // error. Local HTTP testing must use the _transport injection.
    if (parsed.protocol !== 'https:') {
      const err = new Error(
        `_httpsPost: protocol "${parsed.protocol}" not allowed — only https: is permitted. `
        + 'Use opts._transport for local HTTP testing.',
      );
      err.code = 'ERR_TLS_REQUIRED';
      return reject(err);
    }

    const payload = Buffer.from(body, 'utf8');
    const totalTimeoutMs = opts.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    const reqOpts = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    };
    if (opts.ca) reqOpts.ca = opts.ca;

    const req = httpsRequest(reqOpts, (res) => {
      const chunks = [];
      let totalBytes = 0;
      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes <= RESPONSE_BODY_CAP) chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(hardDeadline);
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8').slice(0, RESPONSE_BODY_CAP),
        });
      });
      res.on('error', (err) => { clearTimeout(hardDeadline); reject(err); });
    });

    // Hard total timeout — covers connect + TLS handshake + response
    // transfer. Node's built-in `request.setTimeout` is an IDLE timer
    // (resets on each data chunk), so a slow-drip server would never
    // trigger it. This absolute deadline destroys the socket
    // unconditionally after totalTimeoutMs.
    const hardDeadline = setTimeout(() => {
      req.destroy();
      const err = new Error(`request total timeout (${totalTimeoutMs}ms)`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, totalTimeoutMs);

    req.on('error', (err) => { clearTimeout(hardDeadline); reject(err); });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

function nextRetryMs(retryCount, random) {
  const idx = Math.min(retryCount, BACKOFF_TABLE.length - 1);
  const base = BACKOFF_TABLE[idx];
  const jitter = base * 0.2 * ((random || Math.random)() - 0.5);
  return Math.round(base + jitter);
}

function recordSenderDiagnostic(root, eventId, code, nowFn, locked = false) {
  try {
    updateOutboxMetadata(root, eventId, {
      __sender_last_error: String(code || 'send_error').slice(0, 64),
      __sender_last_attempt_at: nowFn(),
    }, { reservationTimeoutMs: 0, _locked: locked });
  } catch { /* diagnostics are best-effort and never affect delivery */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Flush outbox events to CLS. Each event is processed under a per-eid
 * reservation lock (read → send → remove/update) so concurrent Senders
 * and GC cannot corrupt the same file.
 *
 * @param {string} root — state root
 * @param {object} [opts]
 * @param {number} [opts.maxCount=50]
 * @param {number} [opts.maxDurationMs=5000] — total wall-time budget
 * @param {number} [opts.requestTimeoutMs=2000] — per HTTP request
 * @param {number} [opts.reservationTimeoutMs=100]
 * @param {number} [opts.identityWaitMs=100] — bounded enrichment wait; an
 *   unavailable identity leaves the event queued and unsent
 * @param {object} [opts.env=process.env] — environment used for endpoint,
 *   topic, and dry-run configuration
 * @param {Function} [opts._transport] — inject for testing (url, body, opts) => Promise<{statusCode, body}>
 * @param {boolean} [opts._dryRun] — skip network, no remove, no update
 * @param {Function} [opts.now] — injectable clock (default Date.now)
 * @param {Function} [opts.random] — injectable RNG (default Math.random)
 * @param {(event:object)=>boolean} [opts.isEventEnabled] — local privacy gate
 * @param {string[]} [opts.eventIds] — process only these event ids
 * @param {string[]} [opts.priorityEventIds] — move these ids to the front
 * @param {string[]} [opts.forceRetryEventIds] — ignore retry_after for bounded
 *   installer retries of these ids only
 * @returns {Promise<{sent, sent_event_ids, retried, rejected, skipped, errors}>}
 */
export async function flushOutbox(root, opts = {}) {
  const env = opts.env || process.env;
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const reservationTimeoutMs = opts.reservationTimeoutMs ?? DEFAULT_RESERVATION_TIMEOUT_MS;
  const transport = opts._transport || _httpsPost;
  const removeEvent = opts._remove || remove;
  const dryRun = opts._dryRun || env.TRTC_TELEMETRY_DRY_RUN === '1';
  const nowFn = opts.now || Date.now;
  const randomFn = opts.random || Math.random;
  // Production is fail-closed by default. Test-only legacy fixtures may
  // explicitly pass authoritativeGate:false; merely injecting a transport
  // is not an implicit privacy bypass.
  const requireAuthoritativeGate = opts.authoritativeGate !== false;
  const isEventEnabled = typeof opts.isEventEnabled === 'function'
    ? opts.isEventEnabled
    : () => !requireAuthoritativeGate;
  const eventIds = Array.isArray(opts.eventIds) ? new Set(opts.eventIds) : null;
  const priorityEventIds = new Set(Array.isArray(opts.priorityEventIds) ? opts.priorityEventIds : []);
  const forceRetryEventIds = new Set(Array.isArray(opts.forceRetryEventIds) ? opts.forceRetryEventIds : []);

  const endpoint = env.TRTC_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
  const topicId = env.TRTC_TELEMETRY_TOPIC_ID || DEFAULT_TOPIC_ID;
  const url = `${endpoint}/tracklog?topic_id=${topicId}`;

  const deadlineMono = performance.now() + maxDurationMs;
  let paths = listOutbox(root);
  // Preserve the complete queue identity set for ACK-GC protection before
  // applying an explicit eventIds filter. The flush already paid for this
  // snapshot as part of delivery; GC must not perform another unbounded scan.
  const queuedEventIds = paths
    .map((path) => basename(path).replace(/\.json$/, ''))
    .filter((id) => typeof id === 'string' && id.length > 0);
  if (eventIds) {
    paths = paths.filter((path) => eventIds.has(basename(path).replace(/\.json$/, '')));
  }
  if (priorityEventIds.size > 0) {
    paths.sort((a, b) => {
      const aid = basename(a).replace(/\.json$/, '');
      const bid = basename(b).replace(/\.json$/, '');
      return Number(priorityEventIds.has(bid)) - Number(priorityEventIds.has(aid));
    });
  }
  const result = { sent: 0, sent_event_ids: [], retried: 0, rejected: 0, skipped: 0, errors: [] };
  const gcState = { ran: false };

  let processed = 0;
  for (const path of paths) {
    if (processed >= maxCount) break;

    let remaining = deadlineMono - performance.now();
    if (remaining <= 0) break;

    // Derive eventId from filename (basename handles both / and \ separators)
    const filename = basename(path);
    const eid = filename.replace(/\.json$/, '');
    if (!isSafeEventId(eid)) {
      result.skipped++;
      continue;
    }

    // Determine project context before taking locks. Production events must
    // carry a project key; injected legacy fixtures may explicitly opt out
    // by providing a transport and leaving authoritativeGate unset.
    let hint = null;
    try { hint = readEvent(path); } catch { hint = null; }
    const projectKey = hint?.__project_key;
    if (requireAuthoritativeGate && !/^[a-f0-9]{32}$/.test(projectKey || '')) {
      result.skipped++;
      result.errors.push({ event_id: eid, code: 'missing_project_key' });
      continue;
    }

    // Lock order is project send reservation → event reservation. The
    // project lock is released immediately after transport() is invoked;
    // network response waiting never blocks deny/recovery.
    let projectLock = null;
    if (/^[a-f0-9]{32}$/.test(projectKey || '')) {
      projectLock = acquireProjectSendReservation(root, projectKey, {
        timeoutMs: Math.min(reservationTimeoutMs, remaining),
      });
      if (!projectLock) {
        recordSenderDiagnostic(root, eid, 'send_busy', nowFn);
        result.skipped++;
        result.errors.push({ event_id: eid, code: 'send_busy', retryable: true });
        continue;
      }
    }

    // Acquire event reservation (clamped to remaining budget)
    const effectiveReservationTimeout = Math.min(reservationTimeoutMs, remaining);
    const lock = acquireReservation(root, eid, {
      reservationTimeoutMs: effectiveReservationTimeout,
    });
    if (!lock) {
      if (projectLock) releaseProjectSendReservation(projectLock);
      recordSenderDiagnostic(root, eid, 'send_busy', nowFn);
      result.skipped++;
      result.errors.push({ event_id: eid, code: 'send_busy', retryable: true });
      continue;
    }

    try {
      // Recompute remaining after lock wait
      remaining = deadlineMono - performance.now();
      if (remaining <= 0) break;

      // Re-read under lock
      const event = readEvent(path);
      if (event === null) {
        result.skipped++;
        processed++;
        continue;
      }

      if (requireAuthoritativeGate && event.__project_key !== projectKey) {
        result.skipped++;
        result.errors.push({ event_id: eid, code: 'project_key_changed' });
        continue;
      }

      if (projectKey) {
        const denyGate = readProjectDenyGate(root, projectKey);
        if (!denyGate.allowed) {
          result.skipped++;
          result.errors.push({ event_id: eid, code: `deny_gate_${denyGate.status}` });
          continue;
        }
      }

      // Re-check local preference immediately before the network boundary.
      // A disabled event remains queued only when the caller cannot safely
      // purge it under contention; it is never POSTed in that state.
      let enabled = false;
      try { enabled = isEventEnabled(event) !== false; } catch { enabled = false; }
      if (!enabled) {
        result.skipped++;
        continue;
      }

      // A successful CLS response can be followed by a local crash or a
      // failed unlink.  In that window the event remains in Outbox, but the
      // durable ACK fact means another HTTP request would only be a duplicate
      // logical event.  Clear it locally without touching the network.
      const localNoticeObligation = event.method === 'prompt' && projectKey
        ? readNoticeObligation(root, projectKey)
        : null;
      const localEventAck = event.method === 'prompt' && projectKey
        ? readEventAcknowledgement(root, projectKey, eid)
        : null;
      const locallyAcknowledged = event.__sender_acknowledged === true
        || localEventAck?.status === 'valid'
        || (localNoticeObligation?.status === 'valid'
          && localNoticeObligation.value.first_event_id === eid
          && localNoticeObligation.value.acknowledged === true);
      if (locallyAcknowledged) {
        // A first Prompt has a second local fact (the project notice
        // obligation) in addition to the event-local ACK.  If the process
        // crashed after writing __sender_acknowledged but before the
        // obligation was committed, do not delete the last durable candidate
        // and strand the notice forever.  Rebuild/ACK the obligation from this
        // same candidate first; this path never performs another HTTP POST.
        const isFirstCandidate = event.method === 'prompt'
          && /^[a-f0-9]{32}$/.test(projectKey || '')
          && (event.__first_prompt_candidate === true
            || (localNoticeObligation?.status === 'valid'
              && localNoticeObligation.value.first_event_id === eid));
        if (isFirstCandidate) {
          let obligation = localNoticeObligation || readNoticeObligation(root, projectKey);
          if (obligation.status === 'missing'
            || (obligation.status === 'corrupt' && event.__first_prompt_candidate === true)) {
            const ensured = ensureNoticeObligation(root, projectKey, eid, {
              acknowledgedAt: nowFn(),
              noticeLocale: event.notice_locale,
              timeoutMs: Math.min(100, Math.max(1, deadlineMono - performance.now())),
              allowCorruptReplacement: event.__first_prompt_candidate === true,
            });
            if (['created', 'already_present'].includes(ensured.status)) {
              obligation = readNoticeObligation(root, projectKey);
            }
          }
          if (obligation.status !== 'valid' || obligation.value.first_event_id !== eid) {
            recordSenderDiagnostic(root, eid, 'ack_failed', nowFn, true);
            result.retried++;
            result.errors.push({ event_id: eid, code: 'ack_failed', reason: 'obligation_repair_failed' });
            processed++;
            continue;
          }
          if (obligation.value.acknowledged !== true) {
            try {
              const ackFn = opts._acknowledgePrompt
                || ((ackRoot, ackEvent, ackKey, ackOpts) => acknowledgeNoticeObligation(
                  ackRoot, ackKey, ackEvent.event_id, ackOpts,
                ));
              const ack = await ackFn(root, event, projectKey, {
                acknowledgedAt: nowFn(),
                noticeLocale: event.notice_locale,
                timeoutMs: Math.min(100, Math.max(1, deadlineMono - performance.now())),
              });
              if (!ack || !['updated', 'already_present'].includes(ack.status)) {
                throw new Error(ack?.reason || 'prompt_ack_not_persisted');
              }
            } catch (ackErr) {
              recordSenderDiagnostic(root, eid, 'ack_failed', nowFn, true);
              result.retried++;
              result.errors.push({ event_id: eid, code: 'ack_failed', reason: ackErr?.code || ackErr?.message || 'prompt_ack_not_persisted' });
              processed++;
              continue;
            }
          }
        }
        // A legacy/event-local ACK or first-Prompt obligation may have been
        // persisted by an older runtime before the standalone receipt was
        // introduced. Backfill that receipt before removing the last local
        // copy, otherwise a later owner invoke could misclassify it as lost.
        if (event.method === 'prompt' && /^[a-f0-9]{32}$/.test(projectKey || '')) {
          // Revalidate even an already visible receipt. acknowledgeEvent()
          // fsyncs the receipt and its directory before this last local copy
          // is removed, closing the rename-without-directory-fsync window.
          const receiptFn = opts._acknowledgeEvent || acknowledgeEvent;
          const receipt = receiptFn(root, projectKey, eid, { acknowledgedAt: nowFn() });
          if (!receipt || !['created', 'already_present'].includes(receipt.status)) {
            recordSenderDiagnostic(root, eid, 'ack_failed', nowFn, true);
            result.retried++;
            result.errors.push({ event_id: eid, code: 'ack_failed', reason: receipt?.reason || 'ack_receipt_write_failed' });
            processed++;
            continue;
          }
        }
        try {
          removeEvent(path);
        } catch (removeErr) {
          recordSenderDiagnostic(root, eid, 'remove_failed', nowFn, true);
          result.errors.push({ event_id: eid, code: 'remove_failed', statusCode: 200 });
        }
        // The logical event was already acknowledged before this cleanup
        // attempt. Count it as sent even when the local unlink must be retried.
        result.sent++;
        result.sent_event_ids.push(eid);
        gcProjectEventAcknowledgements(root, projectKey, eid, { gcState, deadlineMono, queuedEventIds });
        processed++;
        continue;
      }

      // This is the sender linearization point. The project tombstone and
      // preference gate have both been checked while the project lock and
      // event reservation are held.
      opts.finalGateReached?.({ event_id: eid, project_key: projectKey, event });

      // Check retry eligibility
      const retryAfter = event.__sender_retry_after;
      if (typeof retryAfter === 'number' && nowFn() < retryAfter && !forceRetryEventIds.has(eid)) {
        result.skipped++;
        processed++;
        continue;
      }

      // Dry-run: skip network, no remove, no metadata update
      if (dryRun) {
        result.skipped++;
        processed++;
        continue;
      }

      // Hook/install hot paths may atomically queue an event before Identity
      // is available. Never send such an event anonymously: retry bounded
      // enrichment under the same event reservation and leave it queued when
      // the device identity is still contended.
      let sendEvent = event;
      if (!isValidIdentityRecord(event)) {
        remaining = deadlineMono - performance.now();
        if (remaining <= 0) break;
        try {
          const identity = getOrCreate({
            stateRoot: root,
            maxWaitMs: Math.min(opts.identityWaitMs ?? 100, remaining),
          });
          sendEvent = { ...event, ...identity, identity_pending: false };
        } catch (identityErr) {
          result.skipped++;
          result.errors.push({ event_id: eid, code: 'identity_unavailable' });
          processed++;
          continue;
        }
      }

      // Defense at the final network boundary: an upgraded Runtime can inherit
      // Pending/Outbox files written by an older redactor. Sanitize a send-only
      // copy so those legacy bytes cannot bypass the current privacy rules;
      // the durable event remains unchanged for idempotent retry metadata.
      sendEvent = {
        ...sendEvent,
        ...(typeof sendEvent.text === 'string'
          ? { text: sanitizeReportText(sendEvent.text) }
          : {}),
        ...(typeof sendEvent.answer === 'string'
          ? { answer: sanitizeReportText(sendEvent.answer) }
          : {}),
      };

      // Build CLS payload
      let wireContents;
      try {
        wireContents = toCLSContents(sendEvent);
      } catch (schemaErr) {
        // Local schema error — only path to rejected
        try {
          moveToRejected(root, path, `schema_error: ${schemaErr.message}`, { _locked: true });
        } catch { /* move best-effort */ }
        result.rejected++;
        result.errors.push({ event_id: eid, code: 'schema_error' });
        processed++;
        continue;
      }

      const clsBody = JSON.stringify({
        logs: [{ contents: wireContents, time: event.time }],
        source: '',
      });

      // HTTP POST (clamped to remaining budget)
      const effectiveRequestTimeout = Math.min(requestTimeoutMs, remaining);
      let response;
      let transportPromise;
      try {
        transportPromise = transport(url, clsBody, {
          ...(opts._transportOpts || {}),
          // timeoutMs MUST come last — _transportOpts cannot override
          // the deadline-clamped effective timeout.
          timeoutMs: effectiveRequestTimeout,
        });
        if (projectLock) {
          releaseProjectSendReservation(projectLock);
          projectLock = null;
        }
        response = await transportPromise;
      } catch (netErr) {
        recordSenderDiagnostic(root, eid, netErr.code || 'network', nowFn, true);
        // Network / DNS / TLS / timeout → retry
        const retryCount = event.__sender_retry_count || 0;
        const retryMs = nextRetryMs(retryCount, randomFn);
        try {
          const metaRes = updateOutboxMetadata(root, eid, {
            __sender_retry_count: retryCount + 1,
            __sender_retry_after: nowFn() + retryMs,
            __sender_last_error: String(netErr.code || 'network').slice(0, 64),
            __sender_last_attempt_at: nowFn(),
          }, { _locked: true });
          if (!metaRes.ok) {
            result.errors.push({ event_id: eid, code: 'metadata_update_failed' });
          }
        } catch {
          result.errors.push({ event_id: eid, code: 'metadata_update_failed' });
        }
        result.retried++;
        result.errors.push({ event_id: eid, code: netErr.code || 'network' });
        processed++;
        continue;
      }

      // Response handling
      if (response.statusCode >= 200 && response.statusCode < 300) {
        // hook_activated is not acknowledged merely because it reached the
        // local Outbox. Publish its local ack only after CLS confirms 2xx.
        // If the ack cannot be persisted, keep the event for a later retry.
        if (event.text === 'hook_activated') {
          try {
            const ack = (opts._acknowledgeHookActivation || acknowledgeHookActivation)(root, event);
            if (!ack?.applicable || !ack?.acked) throw new Error('invalid activation ack payload');
          } catch {
            result.retried++;
            result.errors.push({ event_id: eid, code: 'ack_failed', statusCode: 200 });
            recordSenderDiagnostic(root, eid, 'ack_failed', nowFn, true);
            processed++;
            continue;
          }
        }
        // A first Prompt has two durable consequences: the CLS ACK fact and
        // removal of its Outbox record.  Persist the ACK fact while the event
        // reservation is still held, *before* removing the event.  If this
        // write fails, retain the event and retry the same event_id later;
        // deleting it first would leave a successfully delivered Prompt with
        // no local proof from which to recover the privacy notice.
        if (event.method === 'prompt' && /^[a-f0-9]{32}$/.test(projectKey || '')
          && (event.__first_prompt_candidate === true
            || (localNoticeObligation?.status === 'valid'
              && localNoticeObligation.value.first_event_id === eid))) {
          let obligation = readNoticeObligation(root, projectKey);
          if (obligation.status === 'corrupt' && event.__first_prompt_candidate !== true) {
            result.retried++;
            result.errors.push({ event_id: eid, code: 'ack_failed', reason: 'obligation_corrupt', statusCode: response.statusCode });
            processed++;
            continue;
          }
          // If a process died after Pending became durable but before the
          // first-obligation write, repair that identity at the ACK boundary.
          // A failure keeps the event queued; deleting it would lose the only
          // durable bridge to the post-ACK notice.
          if (obligation.status === 'missing'
            || (obligation.status === 'corrupt' && event.__first_prompt_candidate === true)) {
            const ensured = ensureNoticeObligation(root, projectKey, eid, {
              acknowledgedAt: nowFn(),
              timeoutMs: Math.min(100, Math.max(1, deadlineMono - performance.now())),
              allowCorruptReplacement: event.__first_prompt_candidate === true,
            });
            if (['created', 'already_present'].includes(ensured.status)) {
              obligation = readNoticeObligation(root, projectKey);
            } else if (ensured.status !== 'conflict') {
              result.retried++;
              result.errors.push({ event_id: eid, code: 'ack_failed', reason: 'obligation_write_failed', statusCode: response.statusCode });
              processed++;
              continue;
            }
          }
          if (obligation.status === 'valid'
            && obligation.value.first_event_id === eid
            && obligation.value.acknowledged !== true) {
            try {
              const ackFn = opts._acknowledgePrompt || ((ackRoot, ackEvent, ackKey) => acknowledgeNoticeObligation(
                ackRoot,
                ackKey,
                ackEvent.event_id,
                {
                  acknowledgedAt: nowFn(),
                  noticeLocale: opts.noticeLocale,
                  timeoutMs: Math.min(100, Math.max(1, deadlineMono - performance.now())),
                },
              ));
              const ack = await ackFn(root, event, projectKey);
              if (!ack || !['updated', 'already_present'].includes(ack.status)) {
                throw new Error(ack?.reason || 'prompt_ack_not_persisted');
              }
            } catch (ackErr) {
              result.retried++;
              result.errors.push({
                event_id: eid,
                code: 'ack_failed',
                reason: ackErr?.code || ackErr?.message || 'prompt_ack_not_persisted',
                statusCode: response.statusCode,
              });
              processed++;
              continue;
            }
          }
        }
        // Persist an event-local ACK before removing the Outbox file. This
        // covers non-first Prompts too, so a remove failure never causes a
        // second HTTP request on the next flush. The marker is local-only and
        // is never included in the CLS payload.
        try {
          // Write the standalone receipt first.  If the process dies after
          // this point, the receipt is enough to suppress a second POST even
          // when the event-local metadata write or unlink did not finish.
          if (event.method === 'prompt' && /^[a-f0-9]{32}$/.test(projectKey || '')) {
            const receiptFn = opts._acknowledgeEvent || acknowledgeEvent;
            const eventAck = receiptFn(root, projectKey, eid, {
              acknowledgedAt: nowFn(),
            });
            if (!eventAck || !['created', 'already_present'].includes(eventAck.status)) {
              throw new Error(eventAck?.reason || 'ack_receipt_write_failed');
            }
          }
          const ackMeta = updateOutboxMetadata(root, eid, {
            __sender_acknowledged: true,
            __sender_acknowledged_at: nowFn(),
          }, { _locked: true });
          if (!ackMeta?.ok) {
            // A concurrent sender may have removed the record after CLS
            // accepted this request but before our local ACK marker. The
            // network delivery is already confirmed; treat ENOENT as an
            // idempotent success rather than retrying a second HTTP request.
            if (ackMeta.error === 'event_not_found') {
              result.sent++;
              result.sent_event_ids.push(eid);
              gcProjectEventAcknowledgements(root, projectKey, eid, { gcState, deadlineMono, queuedEventIds });
              processed++;
              continue;
            }
            throw new Error('ack_metadata_write_failed');
          }
        } catch (ackErr) {
          result.retried++;
          result.errors.push({ event_id: eid, code: 'ack_failed', reason: 'ack_metadata_write_failed', statusCode: response.statusCode });
          recordSenderDiagnostic(root, eid, 'ack_failed', nowFn, true);
          processed++;
          continue;
        }
        // Success — remove from outbox. An activation ack may coexist with
        // the event after a remove failure; the Hook sees the ack and does not
        // recreate another event, while Sender may safely retry the same eid.
        try {
          removeEvent(path);
        } catch (removeErr) {
          // Event stays in outbox; CLS may receive a duplicate on next
          // flush — analysis queries use count(distinct event_id).
          result.errors.push({ event_id: eid, code: 'remove_failed', statusCode: 200 });
        }
        result.sent++;
        // Callers that gate a user-facing continuation notice need to know
        // that this specific event, rather than merely some event in the
        // same flush, received a confirmed 2xx response. Keep this as an
        // explicit id list instead of inferring from sent count (activation
        // or another queued event may be sent in the same batch).
        result.sent_event_ids.push(eid);
        gcProjectEventAcknowledgements(root, projectKey, eid, { gcState, deadlineMono, queuedEventIds });
      } else {
        recordSenderDiagnostic(root, eid, `http_${response.statusCode}`, nowFn, true);
        // ALL non-2xx → retry (never reject on remote status)
        const retryCount = event.__sender_retry_count || 0;
        const retryMs = nextRetryMs(retryCount, randomFn);
        try {
          const metaRes = updateOutboxMetadata(root, eid, {
            __sender_retry_count: retryCount + 1,
            __sender_retry_after: nowFn() + retryMs,
            __sender_last_error: `http_${response.statusCode}`.slice(0, 64),
            __sender_last_attempt_at: nowFn(),
          }, { _locked: true });
          if (!metaRes.ok) {
            result.errors.push({ event_id: eid, code: 'metadata_update_failed' });
          }
        } catch {
          result.errors.push({ event_id: eid, code: 'metadata_update_failed' });
        }
        result.retried++;
        result.errors.push({
          event_id: eid,
          code: 'http_error',
          statusCode: response.statusCode,
        });
      }
      processed++;
    } finally {
      releaseReservation(lock);
      if (projectLock) releaseProjectSendReservation(projectLock);
    }
  }

  return result;
}

// Exported for testing
export { _httpsPost, nextRetryMs, BACKOFF_TABLE, DEFAULT_ENDPOINT, DEFAULT_TOPIC_ID };
