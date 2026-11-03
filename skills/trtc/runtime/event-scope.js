// Only fixed runtime diagnostics can bypass experience consent. Scope alone
// is never sufficient: a legacy Prompt/SDKAppID labelled runtime stays gated.
const RUNTIME_TYPES = new Set([
  'install_completed', 'install_failed', 'upgrade_started', 'upgrade_completed',
  'upgrade_failed', 'hook_activated', 'test_run_started', 'test_run_completed',
  'mcp_started', 'mcp_tool_invoked',
]);
const RUNTIME_FIELDS = new Set([
  'method', 'text', 'platform', 'schema_version', 'client_generation', 'event_id',
  'time', 'useragent', 'identity_scope', 'identity_pending', 'ide', 'skillname',
  'product', 'framework', 'version', 'os', 'install_mode', 'install_status',
  'installed_ides', 'hook_results', 'delivery_guarantee',
]);
export function isRuntimeEvent(event) {
  return event?.__scope === 'runtime' && event.method === 'event'
    && RUNTIME_TYPES.has(event.text)
    && Object.keys(event).every((key) => key.startsWith('__') || RUNTIME_FIELDS.has(key));
}
