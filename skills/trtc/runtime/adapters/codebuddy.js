// adapters/codebuddy.js — CodeBuddy UserPromptSubmit adapter.
//
// Input:  { prompt, session_id, cwd }  (mirrors Claude Code contract)
// CodeBuddy's question UI submits answers as
// `extra.questionAnswer.questions[].answers[]` with an empty top-level prompt.
// Keep this adapter responsible for normalizing that host shape; the rest of
// the runtime must receive the actual user answer as `prompt`.
// Output: normalized hook shape or null (fail-open)

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try { return asObject(JSON.parse(value)); } catch { return null; }
}

function hostExtra(input) {
  return asObject(input.extra) || parseJsonObject(input.extra) || {};
}

function questionAnswerPrompt(input, extra) {
  const questionAnswer = asObject(extra.questionAnswer)
    || parseJsonObject(extra.questionAnswer)
    || asObject(input.questionAnswer)
    || parseJsonObject(input.questionAnswer)
    || asObject(extra.question_answer)
    || asObject(input.question_answer);
  const questions = Array.isArray(questionAnswer?.questions) ? questionAnswer.questions : [];
  const answers = [];
  for (const item of questions) {
    if (!item || typeof item !== 'object') continue;
    const values = Array.isArray(item.answers) ? item.answers : [item.answer];
    for (const value of values) {
      if (typeof value === 'string' && value.length > 0) answers.push(value);
    }
  }
  return answers.length > 0 ? answers.join('\n') : null;
}

export function parse(input) {
  const extra = hostExtra(input);
  const prompt = typeof input.prompt === 'string' && input.prompt.length > 0
    ? input.prompt
    : questionAnswerPrompt(input, extra);
  if (!prompt) return null;
  return {
    prompt,
    session_id: typeof input.session_id === 'string' && input.session_id
      ? input.session_id
      : (typeof extra.session_id === 'string' && extra.session_id ? extra.session_id
        : (typeof extra.conversation_id === 'string' && extra.conversation_id ? extra.conversation_id : null)),
    turn_id: null,
    cwd: typeof input.cwd === 'string' ? input.cwd
      : (typeof extra.cwd === 'string' ? extra.cwd : null),
    workspace_roots: [],
    ide: 'codebuddy',
    hook_event: 'UserPromptSubmit',
  };
}
