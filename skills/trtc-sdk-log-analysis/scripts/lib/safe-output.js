// scripts/lib/safe-output.js
// Helpers for rendering untrusted log content into Markdown / chat UI safely.
// Node built-ins only.

import crypto from 'node:crypto';

const URL_RE = /https?:\/\/[^\s'"<>`\])}]+/gi;
const BASIC_AUTH_RE = /Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi;
const BEARER_AUTH_RE = /Authorization:\s*Bearer\s+[^\s,;|]+/gi;
const SECRET_RE = /\b(token|password|passwd|secret|signature|sign|usersig|privatemapkey|longpollingkey|auth(?:orization)?|x-cos-security-token|x-amz-[a-z0-9-]+)\s*[:=]\s*([^\s,;|]+)/gi;
const IDENTIFIER_RE = /\b(sdkapp(?:id|_id)|user(?:id|_id)|str_userid|uid|room(?:id|_id)|str_room_id|string_roomid|int_roomid|locationid|stream(?:id|_id)|device(?:id|_id)|camera(?:id|_id)|business_info|bussinfo)\s*[:=]\s*([^\s,;|}\]'"<>]+)/gi;
const DISPLAY_IDENTIFIER_RE = /(SDKAppID|用户ID|字符串房间号|数字房间号|整型房间ID|LocationId)\s*[:：]\s*([^\s,;|}\]'"<>]+)/gi;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;
const UNSAFE_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const REDACTION_SALT = crypto.randomBytes(16);

function identifierKind(key) {
  const normalized = String(key).toLowerCase();
  if (normalized.includes('sdkapp')) return 'sdkapp';
  if (normalized.includes('room') || normalized.includes('房间')) return 'room';
  if (normalized.includes('location')) return 'location';
  if (normalized.includes('stream')) return 'stream';
  if (normalized.includes('device') || normalized.includes('camera')) return 'device';
  if (normalized.includes('business')) return 'business';
  return 'user';
}

function stableAlias(kind, value) {
  const digest = crypto.createHash('sha256')
    .update(REDACTION_SALT)
    .update(`${kind}\0${value}`)
    .digest('hex')
    .slice(0, 10);
  return `<${kind}_${digest}>`;
}

function toText(value) {
  return value == null ? '' : String(value);
}

export function stripUnsafeControlChars(input) {
  return toText(input)
    .replace(ANSI_RE, '')
    .replace(BIDI_RE, '')
    .replace(UNSAFE_CONTROL_RE, '');
}

export function redactSensitiveText(input) {
  return stripUnsafeControlChars(input)
    .replace(BASIC_AUTH_RE, 'Authorization: <redacted>')
    .replace(BEARER_AUTH_RE, 'Authorization: <redacted>')
    .replace(URL_RE, '<redacted-url>')
    .replace(SECRET_RE, '$1=<redacted>')
    .replace(IDENTIFIER_RE, (match, key, value) => `${key}=${stableAlias(identifierKind(key), value)}`)
    .replace(DISPLAY_IDENTIFIER_RE, (match, key, value) => `${key}=${stableAlias(identifierKind(key), value)}`)
    .replace(IP_RE, '<redacted-ip>');
}

export function truncateText(input, maxChars = 1000) {
  const text = toText(input);
  const max = Number(maxChars);
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function neutralizeMarkdown(input) {
  return toText(input)
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\[/g, '［')
    .replace(/\]/g, '］')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）');
}

export function safeMarkdownTableCell(input, { maxChars = 280 } = {}) {
  return truncateText(
    neutralizeMarkdown(redactSensitiveText(input))
      .replace(/\|/g, '│')
      .replace(/\s+/g, ' ')
      .trim(),
    maxChars,
  );
}

function maxBacktickRun(text) {
  let max = 0;
  for (const match of toText(text).matchAll(/`+/g)) {
    max = Math.max(max, match[0].length);
  }
  return max;
}

export function safeCodeBlock(input, lang = 'text') {
  const text = redactSensitiveText(input);
  const fence = '`'.repeat(Math.max(3, maxBacktickRun(text) + 1));
  const language = String(lang || 'text').replace(/[^a-z0-9_-]/gi, '') || 'text';
  return `${fence}${language}\n${text}\n${fence}`;
}

export function safeEvidenceLine(lineNo, text, { maxChars = 1000, source = '' } = {}) {
  const sanitized = truncateText(
    redactSensitiveText(text)
      .replace(/\|/g, '│')
      .replace(/\r?\n/g, ' ↩ '),
    maxChars,
  );
  const location = source ? `${source}:L${lineNo}` : `L${lineNo}`;
  return `${location}: ${sanitized}`;
}
