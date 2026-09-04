// schema.js — event envelope + CLS field mapping SOURCE OF TRUTH.
//
// Every V2 event MUST include (V2.3 rollout Q1 decision):
//   schema_version: 2
//   client_generation: "v2"
//   event_id
//
// Legacy events (produced by skill-tool Legacy Adapter) carry:
//   client_generation: "legacy"
//   delivery_guarantee: "legacy_best_effort"
//
// Responsibility split:
//   schema.js  → owns the mapping rules and implements toCLSContents().
//                Wire-side names (`verison`, `level`, `type`, `userid`) live
//                only here. A grep-style test enforces the unique typo
//                `verison` and the literal `client_generation:"v2"` do not
//                appear anywhere else in the runtime; that's sufficient to
//                catch accidental duplication of the mapping. The other
//                wire names (`level`/`type`/`userid`) collide with common
//                English words and are enforced structurally instead: this
//                module rejects any input event that already carries them.
//   sender.js  → the only caller of toCLSContents(), invoked at the network
//                boundary immediately before POSTing to CLS. Never re-maps.

import { randomUUID } from 'node:crypto';

// ============================================================================
// Event type enumeration — V2.3 §11.2.
// Values appear as `text` when `method === METHOD.EVENT`.
// ============================================================================

export const EVENT_TYPES = Object.freeze({
  INSTALL_COMPLETED: 'install_completed',
  INSTALL_FAILED: 'install_failed',
  UPGRADE_STARTED: 'upgrade_started',
  UPGRADE_COMPLETED: 'upgrade_completed',
  UPGRADE_FAILED: 'upgrade_failed',
  HOOK_ACTIVATED: 'hook_activated',
  TEST_RUN_STARTED: 'test_run_started',
  TEST_RUN_COMPLETED: 'test_run_completed',
  MCP_STARTED: 'mcp_started',
  MCP_TOOL_INVOKED: 'mcp_tool_invoked',
});

const VALID_EVENT_TEXTS = new Set(Object.values(EVENT_TYPES));

// ============================================================================
// Wire-format constants. Not spelled anywhere else in the runtime.
// ============================================================================

export const SCHEMA_VERSION = 2;
export const CLIENT_GENERATION_V2 = 'v2';
export const CLIENT_GENERATION_LEGACY = 'legacy';
export const PLATFORM = 'skill';

export const METHOD = Object.freeze({
  PROMPT: 'prompt',
  EVENT: 'event',
  FEEDBACK: 'feedback',
});

const VALID_METHODS = new Set(Object.values(METHOD));

// ============================================================================
// Internal ↔ wire field mapping (owned by schema.js).
// sender.js is the ONLY caller of `toCLSContents`.
// ============================================================================

const INTERNAL_TO_WIRE = Object.freeze({
  version: 'verison',     // preserve historic CLS typo (rollout Q1)
  skillname: 'level',
  product: 'type',
  sessionid: 'userid',
});

// Wire-side names V2 events must NOT spell directly — see toCLSContents.
const WIRE_ONLY_KEYS = new Set(Object.values(INTERNAL_TO_WIRE));

// Internal queue-state fields that must never reach the CLS wire output.
// They serve as signals between telemetry pipeline stages but carry no
// analytical value and must not be exposed to the backend.
const WIRE_STRIPPED_INTERNAL_KEYS = new Set([
  'identity_pending',
  // C20: first-use opt-out control fields — internal state only
  'continuation_choice',
  'continuation_choice_version',
  'continuation_choice_updated_at',
  'continuation_notice_required',
  'continuation_notice_version',
  'notice_attempt_id',
  'preference_revision',
]);

// Exposed for tests that need to assert the mapping table shape.
export { INTERNAL_TO_WIRE };

// ============================================================================
// Public API
// ============================================================================

/**
 * Attach V2 envelope fields to a partial event.
 *
 * The V2 wire contract fields (platform, schema_version, client_generation)
 * are authoritative and CANNOT be overridden by the caller — a caller-supplied
 * value (even null/undefined) is discarded. Only `event_id` and `time` may be
 * supplied by the caller; a nullish value falls back to a fresh UUID / now.
 *
 * `event_id` preservation is required by V2.3 §24.28: the hook-generated id
 * carries end-to-end through pending → promote → outbox → CLS, and
 * `state.promote()` must not regenerate it.
 */
export function makeEnvelope(partial = {}) {
  const p = partial ?? {};
  return {
    ...p,
    platform: PLATFORM,
    schema_version: SCHEMA_VERSION,
    client_generation: CLIENT_GENERATION_V2,
    event_id: p.event_id ?? randomUUID(),
    time: p.time ?? Date.now(),
  };
}

/**
 * Convert an internal event to the CLS `contents` shape.
 *
 * Applies field renames (see INTERNAL_TO_WIRE); omits undefined/null and
 * __ prefixed internal keys. CLS requires all contents values to be strings:
 * - string → unchanged
 * - number | boolean → String(value)
 * - array | object → JSON.stringify(value)
 *
 * logs[0].time (set by sender.js) remains a number and is NOT affected here.
 * Local Pending/Outbox events retain their original types; only the wire
 * payload produced by this function is fully string-valued.
 *
 * Throws if the input already carries a wire-side name (`verison`, `level`,
 * `type`, `userid`). Callers must use the internal names — this prevents
 * key-order ambiguity when both the internal and wire forms are set.
 */
export function toCLSContents(event) {
  if (event == null || typeof event !== 'object') {
    throw new TypeError('event must be a non-null object');
  }
  const conflicting = [];
  for (const wire of WIRE_ONLY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(event, wire)) {
      conflicting.push(wire);
    }
  }
  if (conflicting.length > 0) {
    throw new Error(
      `event contains wire-side field(s) ${conflicting.map((k) => `"${k}"`).join(', ')} ` +
        '— use the internal name (version/skillname/product/sessionid) instead',
    );
  }
  const out = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith('__')) continue;
    if (WIRE_STRIPPED_INTERNAL_KEYS.has(key)) continue;
    const wireKey = INTERNAL_TO_WIRE[key] ?? key;
    if (typeof value === 'string') {
      out[wireKey] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[wireKey] = String(value);
    } else {
      out[wireKey] = JSON.stringify(value);
    }
  }
  return out;
}

/**
 * Throw on missing / malformed required envelope fields.
 * Returns `true` on success so callers can assert.
 *
 * Method-specific contracts:
 *   - `prompt`   → `text` must be a string (the redacted prompt body)
 *   - `event`    → `text` must be one of EVENT_TYPES values
 *   - `feedback` → `feedback` must be "0" or "1" (existing CLS convention)
 */
export function validateEvent(event) {
  if (event == null || typeof event !== 'object') {
    throw new TypeError('event must be a non-null object');
  }
  if (event.platform !== PLATFORM) {
    throw new Error(`platform must be "${PLATFORM}"`);
  }
  if (event.schema_version !== SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (event.client_generation !== CLIENT_GENERATION_V2) {
    throw new Error(`client_generation must be "${CLIENT_GENERATION_V2}"`);
  }
  if (typeof event.event_id !== 'string' || event.event_id.length === 0) {
    throw new Error('event_id is required');
  }
  if (typeof event.time !== 'number' || !Number.isFinite(event.time)) {
    throw new Error('time must be a finite number (ms since epoch)');
  }
  if (typeof event.method !== 'string') {
    throw new Error('method is required');
  }
  if (!VALID_METHODS.has(event.method)) {
    throw new Error(`method "${event.method}" is not a recognized method`);
  }

  switch (event.method) {
    case METHOD.EVENT:
      if (!VALID_EVENT_TEXTS.has(event.text)) {
        throw new Error(`text "${event.text}" is not a recognized event type`);
      }
      break;
    case METHOD.PROMPT:
      if (typeof event.text !== 'string') {
        throw new Error('prompt event must have text');
      }
      break;
    case METHOD.FEEDBACK:
      if (event.feedback !== '0' && event.feedback !== '1') {
        throw new Error('feedback event must have feedback in {"0","1"}');
      }
      break;
    // no default — VALID_METHODS gate above already rejected unknown values
  }

  return true;
}
