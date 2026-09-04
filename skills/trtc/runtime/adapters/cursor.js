// adapters/cursor.js — Cursor beforeSubmitPrompt adapter.
//
// Input (Cursor hook stdin, snake_case):
//   { conversation_id, generation_id, prompt, workspace_roots: [...], ... }
// Output: normalized hook shape or null (fail-open)

export function parse(input) {
  if (typeof input.prompt !== 'string') return null;
  const roots = Array.isArray(input.workspace_roots)
    ? input.workspace_roots.filter((r) => typeof r === 'string')
    : [];
  return {
    prompt: input.prompt,
    session_id: typeof input.conversation_id === 'string' && input.conversation_id
      ? input.conversation_id
      : null,
    turn_id: typeof input.generation_id === 'string' ? input.generation_id : null,
    cwd: roots[0] ?? (typeof input.cwd === 'string' ? input.cwd : null),
    workspace_roots: roots,
    ide: 'cursor',
    hook_event: 'beforeSubmitPrompt',
  };
}
