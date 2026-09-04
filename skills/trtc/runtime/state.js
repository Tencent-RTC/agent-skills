// state.js — Dispatcher-layer promotion for V2 telemetry events.
//
// V2.3 §24.28 hard constraint: the `event_id` created by the Hook must
// carry through pending → dispatcher promote → outbox → CLS. This module
// enforces that constraint at the promote boundary using the SAME atomic
// claim primitive that outbox.js's gc() uses for eviction.
//
// The lifecycle:
//
//   1. Gate the untrusted `eventId` parameter with `outbox.isSafeEventId`
//      BEFORE composing any path. This kills path traversal like
//      `../outbox/legit` where `path.join` would resolve outside pending/.
//
//   2. **Atomically claim ownership** of pending/<eventId>.json via
//      `renameSync(pending, .claim-<pid>-<hex>.<eid>.json)`. renameSync
//      is a POSIX-atomic single-winner primitive — either promote gets
//      the claim, or GC's evictOne does, or another promote does. Whoever
//      loses observes ENOENT on their rename and takes the appropriate
//      exit branch. This *replaces* the earlier "read-then-compensate"
//      strategy, which had unclosable races on the deduped and early-
//      return paths.
//
//   3. If our rename fails with ENOENT:
//      - if outbox/<eid>.json exists → return `deduped` + clean any stale
//        tombstone. The event is safely in outbox; a tombstone would be
//        a duplicate drop record from a prior Hook retry that GC then
//        evicted.
//      - else → return `not_found`.
//
//   4. If we hold the claim, read + validate + writeOutbox. Any failure
//      path routes the claim to rejected/ (via moveToRejected which
//      accepts the claim path directly). On success, unlink the claim.
//
//   5. Unconditional stale tombstone cleanup: whenever promote leaves an
//      event in outbox (whether we were the fresh writer or lost the
//      linkSync race to a peer), any dropped/<eid>.json is stale by the
//      **at-most-one-bucket invariant**: an event lives in exactly one
//      of { pending, outbox, dropped }, never two.
//
//   6. Crash safety: if our process dies while holding a claim, gc's
//      `recoverOrphanClaims` picks it up on the next run — checks PID
//      liveness (`process.kill(pid, 0)`), and only if ESRCH commits a
//      `reason='recovered'` tombstone + unlinks. Alive/unknown liveness
//      is left alone (conservative). This is the same primitive that
//      handles crashed GC evictions.
//
// The base identity fields (event_id, time, method, text, schema_version,
// client_generation, platform) are IMMUTABLE across enrichment. This is
// enforced inside `outbox._buildMergedEvent` — state.js just calls it.

import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  readEvent,
  resolveTelemetryRoot,
  writeOutbox,
  moveToRejected,
  isSafeEventId,
  acquireReservation,
  releaseReservation,
  _buildMergedEvent,
  checkProjectWriteGate,
} from './outbox.js';
import { validateEvent } from './schema.js';

const PENDING = 'pending';
const OUTBOX = 'outbox';
const DROPPED = 'dropped';

function pendingDirFor(root) {
  return join(resolveTelemetryRoot(root), PENDING);
}

function pendingPathFor(root, eventId) {
  return join(pendingDirFor(root), `${eventId}.json`);
}

function outboxPathFor(root, eventId) {
  return join(resolveTelemetryRoot(root), OUTBOX, `${eventId}.json`);
}

function droppedPathFor(root, eventId) {
  return join(resolveTelemetryRoot(root), DROPPED, `${eventId}.json`);
}

function promoteClaimPath(root, eventId) {
  return join(
    pendingDirFor(root),
    `.claim-${process.pid}-${randomBytes(4).toString('hex')}.${eventId}.json`,
  );
}

/**
 * Coerce ANY value (including undefined / circular objects) to a short
 * printable string for use in a `rejected/__rejected.reason` blob.
 * Callers rely on this to embed an untrusted `base.event_id` without
 * risking a runtime TypeError. Bound at 64 chars.
 */
function safeStringifyForReason(v) {
  let s = null;
  try { s = JSON.stringify(v); } catch { s = null; }
  if (typeof s !== 'string') {
    try { s = String(v); } catch { s = '<unrepresentable>'; }
  }
  return s.slice(0, 64);
}

/**
 * Unlink dropped/<eventId>.json if it exists. Called whenever promote
 * leaves an event in outbox — the tombstone is stale by definition (the
 * event was NOT dropped, it was promoted). Preserves the
 * at-most-one-bucket invariant.
 */
function cleanStaleTombstone(root, eventId) {
  try { unlinkSync(droppedPathFor(root, eventId)); }
  catch (err) { if (err && err.code !== 'ENOENT') throw err; }
}

/**
 * Unlink pending/<eventId>.json if it exists. Called by promote AFTER
 * writeOutbox commits — any file at that path now must have arrived after
 * we claimed the original pending (renameSync moved it to `.claim-*`), so
 * it is a race-window artifact from a concurrent `writePending`. The
 * at-most-one-bucket invariant demands we remove it. ENOENT is expected
 * and ignored.
 */
function cleanStalePending(root, eventId) {
  try { unlinkSync(pendingPathFor(root, eventId)); }
  catch (err) { if (err && err.code !== 'ENOENT') throw err; }
}

export function isPending(root, eventId) {
  if (!isSafeEventId(eventId)) return false;
  return existsSync(pendingPathFor(root, eventId));
}

export function isOutbox(root, eventId) {
  if (!isSafeEventId(eventId)) return false;
  return existsSync(outboxPathFor(root, eventId));
}

/**
 * Promote the pending event with `eventId` into outbox/ after merging
 * whitelisted enrichment and validating the merged shape.
 *
 * @param {string} root                       stateRoot (identity's home)
 * @param {string} eventId                    Hook-assigned event_id.
 *                                            Must satisfy `isSafeEventId`.
 * @param {object} [enrichment]               attribution fields
 * @param {object} [opts]
 * @param {()=>number} [opts.now]             time injection for tests
 * @param {(evt:object)=>void} [opts.validate] validator override
 * @returns {{
 *   status: 'promoted' | 'deduped' | 'not_found' | 'invalid',
 *   event_id: string,
 *   path?: string,
 *   deduped?: boolean,
 *   degraded?: boolean,
 *   error?: string,
 * }}
 */
export function promote(root, eventId, enrichment, opts = {}) {
  if (!isSafeEventId(eventId)) {
    throw new TypeError(
      `promote: eventId must be a safe filename fragment (see isSafeEventId): ${JSON.stringify(eventId)}`,
    );
  }

  // Round-8 per-eid reservation lock. Held across the ENTIRE promote
  // critical section — renameSync claim, readEvent, validate, writeOutbox,
  // cleanStale{Tombstone,Pending}, unlinkClaim. This is the mechanism-
  // layer guarantee against the round-8 event-loss sequence (writer's
  // pending sweep racing GC's tombstone commit for the same eid).
  //
  // Under this lock: writePending, writeOutbox, evictOneWithReason, and
  // recoverOrphanClaims for `eventId` are blocked until we return. We
  // pass `_locked: true` to nested calls (writeOutbox below) to avoid
  // deadlock on re-acquire.
  const reservation = acquireReservation(root, eventId, opts);
  if (!reservation) {
    // Contention with another actor on the same eid beyond the timeout.
    // Report as `not_found` rather than throwing — a promote failing to
    // acquire the lock means another actor is currently handling this
    // event, and the caller's retry will observe the outcome.
    return { status: 'not_found', event_id: eventId, error: 'reservation_timeout' };
  }
  try {
    return _promoteLocked(root, eventId, enrichment, opts);
  } finally {
    releaseReservation(reservation);
  }
}

function _promoteLocked(root, eventId, enrichment, opts) {
  const pendingPath = pendingPathFor(root, eventId);
  const claimPath = promoteClaimPath(root, eventId);

  // Atomic ownership grab. Exactly one racer succeeds; the rest see ENOENT.
  // This is mutually exclusive with gc's `evictOne` (same rename target),
  // so GC cannot evict pending during our promote, and we cannot promote
  // a pending that GC has already claimed. Under the round-8 reservation
  // lock the renameSync race is already eliminated by the lock itself;
  // this atomic protocol is kept as defense-in-depth for the case where
  // the reservation acquire is bypassed (e.g., a caller supplies
  // `_locked: true` incorrectly).
  try {
    renameSync(pendingPath, claimPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // Pending is gone. Either it was never written, it was claimed by
      // another promote, or it was evicted by GC. Disambiguate by outbox.
      if (existsSync(outboxPathFor(root, eventId))) {
        // Event is safely in outbox. Any tombstone in dropped/ is stale.
        cleanStaleTombstone(root, eventId);
        // Sweep any race-arrival pending too (round-5 reservation-protocol
        // symmetry — a writePending may have created pending/<eid>.json
        // after the winning promoter's claim-rename). Idempotent.
        cleanStalePending(root, eventId);
        return {
          status: 'deduped',
          event_id: eventId,
          path: outboxPathFor(root, eventId),
          deduped: true,
        };
      }
      return { status: 'not_found', event_id: eventId };
    }
    throw err;
  }

  // We hold `claimPath`. All subsequent exit paths dispose of it.
  const base = readEvent(claimPath);
  if (base === null) {
    // Extremely rare: claim exists but reads null (corrupted mid-flight?).
    try { unlinkSync(claimPath); } catch { /* ignore */ }
    return { status: 'invalid', event_id: eventId, error: 'claim readEvent returned null' };
  }

  const preGate = checkProjectWriteGate(root, base, opts);
  if (!preGate.allowed) {
    // A deny gate must not create a fresh active Rejected entry. The claim is
    // already an unattributed/disabled event and is safely discarded here;
    // foreground purge handles pre-existing legacy entries separately.
    try { unlinkSync(claimPath); } catch { /* noop */ }
    return { status: 'blocked', event_id: eventId, error: preGate.reason };
  }

  if (!isSafeEventId(base.event_id)) {
    // Unsafe internal event_id — route through `moveToRejected` with
    // `fallbackEventId=eventId` so the quarantined payload is observable
    // at `rejected/<safe-eventId>.json` rather than silently deleted.
    // `base.event_id` may be undefined / null / number / object; coerce
    // safely — `JSON.stringify(undefined)` returns `undefined` (not a
    // string), and `JSON.stringify(circular)` throws.
    const reason = `unsafe_internal_event_id:${safeStringifyForReason(base.event_id)}`;
    try {
      moveToRejected(root, claimPath, reason, { ...opts, fallbackEventId: eventId });
    } catch (mvErr) {
      try { unlinkSync(claimPath); } catch { /* ignore */ }
      if (mvErr && mvErr.code === 'ENOENT') {
        return { status: 'not_found', event_id: eventId };
      }
      throw mvErr;
    }
    return {
      status: 'invalid',
      event_id: eventId,
      error: `pending has unsafe internal event_id: ${safeStringifyForReason(base.event_id)}`,
    };
  }

  if (base.event_id !== eventId) {
    const reason = `mismatch:base.event_id=${JSON.stringify(base.event_id)}`;
    try {
      moveToRejected(root, claimPath, reason, opts);
    } catch (mvErr) {
      try { unlinkSync(claimPath); } catch { /* ignore */ }
      if (mvErr && mvErr.code === 'ENOENT') {
        return { status: 'not_found', event_id: eventId };
      }
      throw mvErr;
    }
    return {
      status: 'invalid',
      event_id: eventId,
      error: `pending event_id mismatch: expected ${JSON.stringify(eventId)}, got ${JSON.stringify(base.event_id)}`,
    };
  }

  // Build the merged event ONCE. validate() and writeOutbox() operate on
  // the same in-memory object — no re-read between validate and commit.
  const merged = _buildMergedEvent(base, enrichment);

  const validator = typeof opts.validate === 'function' ? opts.validate : validateEvent;
  try {
    validator(merged);
  } catch (err) {
    try {
      moveToRejected(root, claimPath, `schema:${err.message}`, opts);
    } catch (mvErr) {
      try { unlinkSync(claimPath); } catch { /* ignore */ }
      if (mvErr && mvErr.code === 'ENOENT') {
        return { status: 'not_found', event_id: eventId };
      }
      throw mvErr;
    }
    return { status: 'invalid', event_id: eventId, error: err.message };
  }

  // We hold the reservation for `eventId`; writeOutbox must NOT re-acquire.
  const outcome = writeOutbox(root, merged, { ...opts, _locked: true });

  if (outcome?.status === 'blocked') {
    try { unlinkSync(claimPath); } catch { /* noop */ }
    return { status: 'blocked', event_id: eventId, error: outcome.reason };
  }

  // At-most-one-bucket invariant: an event with `eventId` now exists in
  // outbox. Any tombstone in dropped/<eventId>.json is stale and must go.
  // This applies UNCONDITIONALLY — whether we're the fresh writer
  // (deduped=false) or lost the linkSync race to a peer (deduped=true).
  // A tombstone at this point could exist because:
  //   - a prior Hook retry wrote pending after an earlier promote
  //   - GC then evicted that retry-pending, creating a tombstone
  //   - the event was NEVER actually dropped — it's in outbox now.
  cleanStaleTombstone(root, eventId);

  // Round-5 reservation-protocol counterpart: while we held the claim, a
  // concurrent `writePending` could have re-created `pending/<eid>.json`
  // (its pre-check saw outbox empty because writeOutbox hadn't committed
  // yet). Now that outbox is committed, any pending/<eid>.json is a race
  // artifact — unlink it to preserve the at-most-one-bucket invariant.
  // writePending's own post-check catches most of these on its side; this
  // sweep closes the remaining window where its post-check ran BEFORE our
  // writeOutbox commit. ENOENT is expected and ignored.
  cleanStalePending(root, eventId);

  try { unlinkSync(claimPath); }
  catch (err) { if (err && err.code !== 'ENOENT') throw err; }

  // Belt-and-suspenders: one more pending sweep AFTER unlinkClaim, in
  // case writePending raced between our sweep and the claim removal
  // (its post-check would still see outbox and self-correct, but this
  // sweep converges deterministically without waiting for the writer).
  cleanStalePending(root, eventId);

  return {
    status: outcome.deduped ? 'deduped' : 'promoted',
    event_id: eventId,
    path: outcome.path,
    deduped: outcome.deduped,
    degraded: outcome.degraded,
  };
}
