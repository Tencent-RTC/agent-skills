// redact.js — local text redaction.
//
// Owns the 14 production redaction rules + 32KB truncation. The Python CLI is
// a transport shim only and intentionally has no second redactor.
//
// Application order is intentional — do not reorder without updating rollout §6.2:
//   R1  PEM private key (multi-line)      → [REDACTED]
//   R2  Bearer token                       → "Bearer [REDACTED]"
//   R3  JWT (three-segment)                → [REDACTED]
//   R4  AWS AKIA / Tencent AKID            → [REDACTED]
//   R5  Secret-label key/value (中英文)    → keep label, value → [REDACTED]
//   R6  Cookie / Set-Cookie header         → keep label, value → [REDACTED]
//   R7  URL query token/sig/usersig...     → keep prefix, value → [REDACTED]
//   R8  32+ hex chars                      → [REDACTED]
//   R9  Email                              → [REDACTED]
//   R10 CN mobile                          → [REDACTED]
//   R11 /Users/xxx  /home/xxx              → /Users/[USER]  /home/[USER]
//   R12 C:\Users\xxx                       → C:\Users\[USER]
//   R13 IPv4 (private/loopback/link-local) → [REDACTED]   (public IPs preserved)
//   R14 Authorization Basic/Digest/OAuth   → keep header + scheme, redact value
//   T1  Truncate > 32KB: keep head 3/4 + tail 1/4, insert TRUNCATED marker
//
// Compatibility notes:
//   The rules are project-owned and verified by Node fixture/golden tests.
//   R13 uses an explicit range list rather than a platform IP helper so its
//   output cannot drift with the host runtime. The compatibility Python CLI
//   delegates to this Node implementation and does not duplicate these rules.

export const REDACTED = '[REDACTED]';
export const USER_REDACTED = '[USER]';

export const MAX_REPORTED_TEXT_BYTES = 32 * 1024;
export const TRUNCATION_MARKER = '\n...[TRUNCATED FOR REPORTING]...\n';

// ============================================================================
// Regexes, in application order.
// Every RE uses the `g` flag so `String.replace` hits all occurrences.
// ============================================================================

// R1 — PEM private key (multi-line, DOTALL semantics via `s` flag).
const PEM_PRIVATE_KEY_RE =
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gs;

// R2 — HTTP Bearer token.
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

// R3 — JWT (three base64url segments).
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

// R4 — AWS access key ID / Tencent Cloud access key ID.
const CLOUD_ACCESS_ID_RE = /\b(?:AKIA|AKID)[A-Z0-9]{12,}\b/g;

// R5 — labelled secrets. Keep paired, unclosed and unquoted forms separate so
// quoted values may contain spaces without permitting a match to cross a line.
// The patterns contain no nested unbounded quantifiers and scan linearly.
const SECRET_LABEL_PREFIX =
  '(?<label>["\'“”‘’]?(?:' +
    'secret[\\t _-]*(?:key|id)?|api[\\t _-]*key|access[\\t _-]*token|' +
    'refresh[\\t _-]*token|id[\\t _-]*token|auth(?:orization)?[\\t _-]*token|' +
    'client[\\t _-]*secret|private[\\t _-]*key|password|passwd|pwd|usersig|' +
    'session[\\t _-]*(?:token|secret)|' +
    'credential|密钥|密码|令牌|访问令牌|用户签名' +
    ')["\'“”‘’]?[\\t ]*[:：=][\\t ]*)';

const SECRET_LABEL_PAIRED_RES = Object.freeze([
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>")(?<value>(?:\\\\[^\\r\\n]|[^"\\\\\\r\\n])+)(?<close>")`, 'gi'),
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>')(?<value>(?:\\\\[^\\r\\n]|[^'\\\\\\r\\n])+)(?<close>')`, 'gi'),
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>“)(?<value>[^”\\r\\n]+)(?<close>”)`, 'gi'),
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>‘)(?<value>[^’\\r\\n]+)(?<close>’)`, 'gi'),
]);

const SECRET_LABEL_UNCLOSED_RES = Object.freeze([
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>")(?<value>(?:\\\\[^\\r\\n]|[^"\\\\\\r\\n])+)(?=\\r?$)`, 'gim'),
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>')(?<value>(?:\\\\[^\\r\\n]|[^'\\\\\\r\\n])+)(?=\\r?$)`, 'gim'),
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>“)(?<value>[^”\\r\\n]+)(?=\\r?$)`, 'gim'),
  new RegExp(`${SECRET_LABEL_PREFIX}(?<open>‘)(?<value>[^’\\r\\n]+)(?=\\r?$)`, 'gim'),
]);

const SECRET_LABEL_UNQUOTED_RE = new RegExp(
  `${SECRET_LABEL_PREFIX}(?<value>[^\\s,\\uff0c;\\uff1b&"'“”‘’]+)`,
  'gi',
);

// R6 — Cookie / Set-Cookie header. Full line up to newline is treated as value.
const COOKIE_HEADER_RE =
  /\b(?<label>cookie|set-cookie)\s*:\s*(?<value>[^\r\n]+)/gim;

// R7 — URL query with a sensitive parameter name.
const URL_SECRET_QUERY_RE = new RegExp(
  '(?<prefix>[?&](?:access[_-]?token|auth|authorization|credential|' +
    'key|password|secret|session[_-]?token|sig|signature|token|usersig)=)' +
    '(?<value>[^&#\\s]+)',
  'gi',
);

// R8 — 32+ hex chars run. Sits AFTER R5 so label values are already redacted
// and cannot be double-consumed here.
const SECRET_HEX_RE = /\b[0-9a-fA-F]{32,}\b/g;

// R9 — email.
const EMAIL_RE =
  /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])/g;

// R10 — CN mobile phone number, optionally with +86 prefix.
const CN_MOBILE_RE = /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)/g;

// R11 — /Users/<name> or /home/<name> path prefix. Preserves the prefix,
// redacts only the user-name segment.
const UNIX_USER_PATH_RE = new RegExp(
  String.raw`(?<prefix>/(?:Users|home)/)[^/\s]+`,
  'g',
);

// R12 — Windows `C:\Users\<name>` path prefix.
const WINDOWS_USER_PATH_RE = new RegExp(
  String.raw`(?<prefix>\b[A-Z]:\\Users\\)[^\\/\s]+`,
  'gi',
);

// R13 — IPv4 dotted quad. Redacted only if the address falls in one of the
// hand-checked private / loopback / link-local ranges (see isRedactableIPv4).
const IPV4_RE =
  /(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)/g;

// R14 — Authorization values for non-Bearer schemes. Prompt text commonly
// embeds headers inside curl commands, Markdown bullets or quoted code, so the
// header may start anywhere after a non-identifier boundary. Basic always
// consumes only its RFC token68 value, regardless of surrounding quotes.
// Digest/OAuth quoted forms consume their auth-param payload to the matching
// delimiter; their unquoted forms consume only the current line.
// Authorization-Info cannot match because `:` must follow the exact header.
const AUTHORIZATION_PAIRED_RES = Object.freeze([
  /(?<open>")(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^"\\\r\n])+)(?<close>")/gim,
  /(?<open>')(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^'\\\r\n])+)(?<close>')/gim,
  /(?<open>“)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^”\r\n]+)(?<close>”)/gim,
  /(?<open>‘)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^’\r\n]+)(?<close>’)/gim,
]);
const AUTHORIZATION_UNCLOSED_RES = Object.freeze([
  /(?<open>")(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^"\\\r\n])+)(?=\r?$)/gim,
  /(?<open>')(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^'\\\r\n])+)(?=\r?$)/gim,
  /(?<open>“)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^”\r\n]+)(?=\r?$)/gim,
  /(?<open>‘)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^’\r\n]+)(?=\r?$)/gim,
]);
// Basic uses RFC token68, whose boundary lets us preserve same-line status,
// request IDs and other diagnostics. Digest/OAuth auth-param lists contain
// spaces and commas, so their safe unquoted boundary remains the line ending.
const AUTHORIZATION_BASIC_RE =
  /(?<boundary>^|[^A-Za-z0-9_-])(?<prefix>authorization[\t ]*:[\t ]*basic\b[\t ]+)(?<value>[A-Za-z0-9._~+\/-]+=*)(?=$|[^A-Za-z0-9._~+\/=-])/gim;
const AUTHORIZATION_PARAMS_UNQUOTED_RE =
  /(?<boundary>^|[^A-Za-z0-9_'"“”‘’-])(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^\r\n]+)/gim;

// ============================================================================
// Project-owned frozen IPv4 redaction ruleset — spec version R13.v1
// (established 2026-08-05). Any deliberate change MUST update the focused
// boundary tests, fixture set, and golden digest in the same review.
//
// CGNAT 100.64.0.0/10 and multicast 224.0.0.0/4 are intentionally NOT redacted;
// they are neither RFC 1918 private nor loopback nor link-local, and we
// prefer preserving them for troubleshooting network reachability.
// ============================================================================

function isRedactableIPv4(addr) {
  const parts = addr.split('.');
  if (parts.length !== 4) return false;
  const nums = new Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i];
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
    nums[i] = n;
  }
  const [a, b, c] = nums;

  // 0.0.0.0/8 — "this network" (is_private)
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC 1918 (is_private)
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/29 — IETF protocol assignments (is_private)
  if (a === 192 && b === 0 && c === 0 && nums[3] >= 0 && nums[3] <= 7) return true;
  // 192.0.0.170/31 — NAT64/DNS64 discovery (is_private)
  if (a === 192 && b === 0 && c === 0 && (nums[3] === 170 || nums[3] === 171)) return true;
  // 192.0.2.0/24 — TEST-NET-1 (is_private)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.168.0.0/16 — RFC 1918
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmark testing (is_private)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 — TEST-NET-2 (is_private)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 — TEST-NET-3 (is_private)
  if (a === 203 && b === 0 && c === 113) return true;
  // 240.0.0.0/4 — reserved / broadcast (is_private) — 240.x through 255.x
  if (a >= 240) return true;

  // Note: 100.64.0.0/10 (CGNAT) and 224.0.0.0/4 (multicast) are intentionally
  // NOT redacted per spec R13.v1. See file header for rationale.
  return false;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Apply R1..R14 to `text` in the fixed order. Falsy input passes through.
 */
export function redactText(text) {
  if (!text) return text;
  let out = text;

  out = out.replace(PEM_PRIVATE_KEY_RE, REDACTED);
  out = out.replace(BEARER_RE, `Bearer ${REDACTED}`);
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(CLOUD_ACCESS_ID_RE, REDACTED);

  for (const pattern of SECRET_LABEL_PAIRED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.label}${groups.open}${REDACTED}${groups.close}`;
    });
  }
  for (const pattern of SECRET_LABEL_UNCLOSED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.label}${groups.open}${REDACTED}`;
    });
  }
  out = out.replace(SECRET_LABEL_UNQUOTED_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.label}${REDACTED}`;
  });
  out = out.replace(COOKIE_HEADER_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.label}: ${REDACTED}`;
  });
  out = out.replace(URL_SECRET_QUERY_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.prefix}${REDACTED}`;
  });

  out = out.replace(SECRET_HEX_RE, REDACTED);
  out = out.replace(EMAIL_RE, REDACTED);
  out = out.replace(CN_MOBILE_RE, REDACTED);

  out = out.replace(UNIX_USER_PATH_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.prefix}${USER_REDACTED}`;
  });
  out = out.replace(WINDOWS_USER_PATH_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.prefix}${USER_REDACTED}`;
  });

  out = out.replace(IPV4_RE, (m) => (isRedactableIPv4(m) ? REDACTED : m));
  for (const pattern of AUTHORIZATION_PAIRED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.open}${groups.leading}${groups.prefix}${REDACTED}${groups.close}`;
    });
  }
  for (const pattern of AUTHORIZATION_UNCLOSED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.open}${groups.leading}${groups.prefix}${REDACTED}`;
    });
  }
  out = out.replace(AUTHORIZATION_BASIC_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.boundary}${groups.prefix}${REDACTED}`;
  });
  out = out.replace(AUTHORIZATION_PARAMS_UNQUOTED_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.boundary}${groups.prefix}${REDACTED}`;
  });

  return out;
}

/**
 * Redact then cap at MAX_REPORTED_TEXT_BYTES (32KB). Oversized text keeps
 * head 3/4 + tail 1/4 with a TRUNCATION_MARKER between them. Byte-level cuts
 * are moved to UTF-8 code-point boundaries so we do not emit split sequences.
 */
export function sanitizeReportText(text) {
  const redacted = redactText(text);
  if (typeof redacted !== 'string') return redacted;
  const buf = Buffer.from(redacted, 'utf8');
  if (buf.length <= MAX_REPORTED_TEXT_BYTES) return redacted;

  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  const available = MAX_REPORTED_TEXT_BYTES - markerBytes;
  if (available <= 0) return TRUNCATION_MARKER;

  const headBytes = Math.floor((available * 3) / 4);
  const tailBytes = available - headBytes;

  const head = safeUtf8Head(buf, headBytes);
  const tail = safeUtf8Tail(buf, tailBytes);
  return `${head}${TRUNCATION_MARKER}${tail}`;
}

// Cut a UTF-8 buffer at or before `size` bytes on a code-point boundary.
function safeUtf8Head(buf, size) {
  if (size >= buf.length) return buf.toString('utf8');
  let end = size;
  // A byte 10xxxxxx is a UTF-8 continuation byte; move back until we land
  // on a leading byte (0xxxxxxx or 11xxxxxx).
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

// Take the last `size` bytes but advance forward to the next code-point
// boundary if we started inside a multi-byte sequence.
function safeUtf8Tail(buf, size) {
  if (size >= buf.length) return buf.toString('utf8');
  let start = buf.length - size;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString('utf8');
}
