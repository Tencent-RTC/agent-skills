// adapters/claude.js — Claude Code UserPromptSubmit adapter.
//
// Input:  { prompt, session_id, cwd }
// Output: normalized hook shape or null (fail-open)

export function parse(input) {
  if (typeof input.prompt !== 'string') return null;
  return {
    prompt: input.prompt,
    session_id: typeof input.session_id === 'string' && input.session_id ? input.session_id : null,
    turn_id: null,
    cwd: typeof input.cwd === 'string' ? input.cwd : null,
    workspace_roots: [],
    ide: 'claude',
    hook_event: 'UserPromptSubmit',
  };
}
