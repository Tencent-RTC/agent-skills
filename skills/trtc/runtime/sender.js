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
import { getOrCreate } from './identity.js';
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
  readProjectDenyGate,
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
 * @param {Function} [opts._transport] — inject for testing (url, body, opts) => Promise<{statusCode, body}>
 * @param {boolean} [opts._dryRun] — skip network, no remove, no update
 * @param {Function} [opts.now] — injectable clock (default Date.now)
 * @param {Function} [opts.random] — injectable RNG (default Math.random)
 * @param {(event:object)=>boolean} [opts.isEventEnabled] — local privacy gate
 * @param {string[]} [opts.eventIds] — process only these event ids
 * @param {string[]} [opts.priorityEventIds] — move these ids to the front
 * @returns {Promise<{sent, sent_event_ids, retried, rejected, skipped, errors}>}
 */
export async function flushOutbox(root, opts = {}) {
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const reservationTimeoutMs = opts.reservationTimeoutMs ?? DEFAULT_RESERVATION_TIMEOUT_MS;
  const transport = opts._transport || _httpsPost;
  const removeEvent = opts._remove || remove;
  const dryRun = opts._dryRun || process.env.TRTC_TELEMETRY_DRY_RUN === '1';
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

  const endpoint = process.env.TRTC_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
  const topicId = process.env.TRTC_TELEMETRY_TOPIC_ID || DEFAULT_TOPIC_ID;
  const url = `${endpoint}/tracklog?topic_id=${topicId}`;

  const deadlineMono = performance.now() + maxDurationMs;
  let paths = listOutbox(root);
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
      if (!projectLock) { result.skipped++; continue; }
    }

    // Acquire event reservation (clamped to remaining budget)
    const effectiveReservationTimeout = Math.min(reservationTimeoutMs, remaining);
    const lock = acquireReservation(root, eid, {
      reservationTimeoutMs: effectiveReservationTimeout,
    });
    if (!lock) {
      if (projectLock) releaseProjectSendReservation(projectLock);
      result.skipped++;
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

      // This is the sender linearization point. The project tombstone and
      // preference gate have both been checked while the project lock and
      // event reservation are held.
      opts.finalGateReached?.({ event_id: eid, project_key: projectKey, event });

      // Check retry eligibility
      const retryAfter = event.__sender_retry_after;
      if (typeof retryAfter === 'number' && nowFn() < retryAfter) {
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

      // Hook/install hot paths may durably queue an event before Identity is
      // available. Never send such an event anonymously: retry bounded
      // enrichment under the same event reservation and leave it queued when
      // the device identity is still contended.
      let sendEvent = event;
      if (event.identity_pending === true || typeof event.useragent !== 'string') {
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
        // Network / DNS / TLS / timeout → retry
        const retryCount = event.__sender_retry_count || 0;
        const retryMs = nextRetryMs(retryCount, randomFn);
        try {
          const metaRes = updateOutboxMetadata(root, eid, {
            __sender_retry_count: retryCount + 1,
            __sender_retry_after: nowFn() + retryMs,
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
            processed++;
            continue;
          }
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
      } else {
        // ALL non-2xx → retry (never reject on remote status)
        const retryCount = event.__sender_retry_count || 0;
        const retryMs = nextRetryMs(retryCount, randomFn);
        try {
          const metaRes = updateOutboxMetadata(root, eid, {
            __sender_retry_count: retryCount + 1,
            __sender_retry_after: nowFn() + retryMs,
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
