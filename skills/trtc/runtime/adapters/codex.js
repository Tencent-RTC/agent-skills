// adapters/codex.js — Codex UserPromptSubmit adapter.
//
// Input:  { prompt, session_id, turn_id, cwd }
// Output: normalized hook shape or null (fail-open)
//
// Codex provides an explicit turn_id (unlike Claude/CodeBuddy).

export function parse(input) {
  if (typeof input.prompt !== 'string') return null;
  return {
    prompt: input.prompt,
    session_id: typeof input.session_id === 'string' && input.session_id ? input.session_id : null,
    turn_id: typeof input.turn_id === 'string' ? input.turn_id : null,
    cwd: typeof input.cwd === 'string' ? input.cwd : null,
    workspace_roots: [],
    ide: 'codex',
    hook_event: 'UserPromptSubmit',
  };
}
