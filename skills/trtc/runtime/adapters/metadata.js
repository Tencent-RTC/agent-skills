// Shared host metadata whitelist for normalized Prompt hooks.
// Only routing/identity hints that are already supplied by a host are copied;
// arbitrary input fields never cross the adapter boundary.

const STRING_KEYS = Object.freeze([
  'host_source', 'event_source', 'host_kind', 'route_hint', 'product', 'framework',
  'raw_session_id', 'conversation_id', 'thread_id', 'locale', 'language',
]);
const BOOLEAN_KEYS = Object.freeze(['internal', 'is_internal', 'user_initiated']);

export function hostMetadata(input) {
  const out = {};
  for (const key of STRING_KEYS) {
    const value = input?.[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 512) out[key] = value;
  }
  // Some hosts use generic source/kind fields. Keep them under host-only names
  // so the runtime's own source (hook/python) remains authoritative.
  if (!out.host_source && typeof input?.source === 'string' && input.source.length <= 128) {
    out.host_source = input.source;
  }
  if (!out.host_kind && typeof input?.kind === 'string' && input.kind.length <= 128) {
    out.host_kind = input.kind;
  }
  for (const key of BOOLEAN_KEYS) {
    if (input?.[key] === true) out[key] = true;
  }
  return out;
}
