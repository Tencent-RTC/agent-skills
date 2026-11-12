// adapters/codebuddy.js — CodeBuddy UserPromptSubmit adapter.
//
// Input:  { prompt, session_id, cwd }  (mirrors Claude Code contract)
// CodeBuddy's question UI submits answers as
// `extra.questionAnswer.questions[].answers[]` with an empty top-level prompt.
// Keep this adapter responsible for normalizing that host shape; the rest of
// the runtime must receive the actual user answer as `prompt`.
// XML answer normalization is exported for the shared Hook/foreground/legacy
// Prompt gate below; both carriers stay owned by this adapter.
// Output: normalized hook shape or null (fail-open)

import { hostMetadata } from './metadata.js';

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

// Decode only CodeBuddy's complete native question-answer envelope. This is
// a bounded, literal grammar, not a general XML parser: no DTD, external
// entities, filesystem, network, or execution. User prose/quoted XML stays intact.
const MAX_ENVELOPE_LENGTH = 128 * 1024;

function element(source, name, withId = false) {
  const attrs = withId ? `(?:\\s+id\\s*=\\s*(?:"[^"<>]*"|'[^'<>]*'))?` : '';
  const open = source.trimStart().match(new RegExp(`^<${name}${attrs}\\s*>`));
  if (!open) return null;
  const text = source.trimStart();
  const close = `</${name}>`;
  const end = text.indexOf(close, open[0].length);
  if (end < 0) return null;
  return { body: text.slice(open[0].length, end), rest: text.slice(end + close.length) };
}

function answerText(body) {
  const text = body.trim();
  if (text.startsWith('<![CDATA[') && text.endsWith(']]>')) {
    const inner = text.slice(9, -3);
    return inner.includes(']]>') ? null : inner.trim();
  }
  if (/[<>]/.test(text) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(text)) return null;
  let valid = true;
  const value = text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity in named) return named[entity];
    const point = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (![9, 10, 13].includes(point) && !(point >= 0x20 && point <= 0xd7ff)
      && !(point >= 0xe000 && point <= 0xfffd) && !(point >= 0x10000 && point <= 0x10ffff)) {
      valid = false; return '';
    }
    return String.fromCodePoint(point);
  });
  return valid ? value : null;
}

export function normalizeCodebuddyAnswer(text, input = {}) {
  if (typeof text !== 'string' || input.user_initiated === true) return { text };
  const trimmed = text.trim();
  // Only a whole distinctive host envelope is eligible. A user discussing or
  // quoting it, or appending their own question, must not lose that input.
  if (!/^<question_answer>\s*<questions>/.test(trimmed)) return { text };
  const close = '</question_answer>';
  const end = trimmed.lastIndexOf(close);
  if (end >= 0 && trimmed.slice(end + close.length).trim()) return { text };
  const skipped = { reason: 'codebuddy_invalid_question_answer' };
  if (trimmed.length > MAX_ENVELOPE_LENGTH || end < 0) return skipped;
  const root = element(trimmed, 'question_answer');
  const questions = root && element(root.body, 'questions');
  if (!root || root.rest.trim() || !questions || questions.rest.trim()) return skipped;
  const answers = [];
  let rest = questions.body;
  let count = 0;
  while (rest.trim()) {
    if (++count > 256) return skipped;
    const item = element(rest, 'question_item', true);
    const question = item && element(item.body, 'question');
    const selected = question && element(question.rest, 'answers');
    if (!item || !question || !selected || selected.rest.trim()) return skipped;
    const value = answerText(selected.body);
    if (!value) return skipped;
    answers.push(value);
    rest = item.rest;
  }
  return answers.length ? { text: answers.join('\n') } : skipped;
}

export function parse(input) {
  const extra = hostExtra(input);
  const prompt = typeof input.prompt === 'string' && input.prompt.length > 0
    ? input.prompt
    : questionAnswerPrompt(input, extra);
  if (!prompt) return null;
  return {
    ...hostMetadata(input),
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
