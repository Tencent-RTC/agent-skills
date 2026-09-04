// sdkappid-resolver.js — bounded, read-only SDKAppID discovery.
//
// The resolver implements knowledge-base/resolvers/sdkappid-resolver-sop.md.
// It only reads explicitly allowlisted project files, never follows symlinks,
// and never returns a partial result after a scan bound is exceeded.

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const RESOLVER_VERSION = '18.4';

const TIER1_FILES = new Set([
  'config.dart', 'main.ts', 'main.js', 'App.vue',
  'GenerateTestUserSig.java', 'GenerateTestUserSig.swift',
  'GenerateTestUserSig.h', 'GenerateTestUserSig.js',
  'GenerateTestUserSig-es.js', 'generateTestUserSig.js',
  'generate_test_user_sig.dart',
]);
const TIER3_FILES = new Set([
  'TLSSigAPIv2.java', 'TLSSigAPIv2.js', 'TLSSigAPIv2.py',
  'TLSSigAPIv2.php', 'TLSSigAPITest.go',
]);
const TIER2_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.dart',
]);
const WEB_TIER2_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue',
]);
const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'vendors', 'Pods',
  'DerivedData', '.gradle', '.idea', '.next', '.nuxt', 'build', 'dist',
  'coverage', 'target', 'out', '.cache',
  // Agent-owned configuration, installed Skills, worktrees and caches are
  // not user application source. Entering them can associate another
  // worktree/template's SDKAppID with the current project.
  '.agents', '.claude', '.codebuddy', '.codex', '.cursor', '.gemini',
  '.windsurf', '.worktrees',
]);
const SKIP_DIRS_LOWER = new Set([...SKIP_DIRS].map((name) => name.toLowerCase()));
const FIELD_NAMES = ['SDKAPPID', 'SDKAppID', 'sdkAppId', 'sdkappid', 'public_SDKAPPID'];
const FIELD_PATTERN = FIELD_NAMES.join('|');
const SEMANTIC_CONTEXT_RE = /GenerateTestUserSig|genTestUserSig|UserSig|TLSSigAPIv2|genSig|LoginStore\.shared\.login|TUIKit|TUICallKit|TUILiveKit|TUIRoomKit/;
const SEMANTIC_TOKENS = [
  'GenerateTestUserSig', 'genTestUserSig', 'UserSig', 'TLSSigAPIv2', 'genSig',
  'LoginStore', 'TUIKit', 'TUICallKit', 'TUILiveKit', 'TUIRoomKit',
  'useLoginStore', 'useLoginState', 'TRTC', 'enterRoom',
  'roomkit',  // R05 conference.login — '@tencentcloud/roomkit-web-vue3'/'roomkit-web-react' imports
  // R18 generic Web config fallback. These tokens only prefilter files; the
  // structured adapter still performs AST/context validation before extracting.
  'sdkAppId', 'SDKAppID', 'sdkappid', 'SDKAPPID', 'SDK_APP_ID', 'sdk_app_id',
  'trtcConfig', 'rtcConfig', 'trtcOptions', 'rtcOptions', 'trtcSettings', 'rtcSettings',
];
const SCOPE_MANIFESTS = [
  'pubspec.yaml', 'package.json', 'build.gradle', 'Podfile',
  'pyproject.toml', 'go.mod', '.trtc-session.yaml',
];
const PREFILTER_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_DIRS = 5000;
const DEFAULT_DEADLINE_MS = 500;
const WEB_MAX_FILE_BYTES = 256 * 1024;

export function resolveActiveScope(cwd, projectRoot) {
  let current;
  let root;
  try {
    root = realpathSync(resolve(projectRoot));
    current = realpathSync(resolve(cwd));
  } catch { return { scopeRoot: projectRoot, scopeManifest: null }; }
  // Containment check: cwd must be inside projectRoot
  const rel = relative(root, current);
  if (rel.startsWith('..') || isAbsolute(rel)) return { scopeRoot: root, scopeManifest: null };

  while (true) {
    for (const manifest of SCOPE_MANIFESTS) {
      try {
        if (existsSync(join(current, manifest))) {
          return { scopeRoot: current, scopeManifest: manifest };
        }
      } catch { /* permission denied */ }
    }
    // Also check for .xcodeproj / .xcworkspace directories
    try {
      const entries = readdirSync(current);
      if (entries.some((e) => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'))) {
        const match = entries.find((e) => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'));
        return { scopeRoot: current, scopeManifest: match };
      }
    } catch {}
    const parent = resolve(current, '..');
    if (parent === current) break;
    // Stop walking above projectRoot
    const parentRel = relative(root, parent);
    if (parentRel.startsWith('..') || isAbsolute(parentRel)) break;
    current = parent;
  }
  return { scopeRoot: root, scopeManifest: null };
}

export function hasSemanticToken(buffer) {
  for (const token of SEMANTIC_TOKENS) {
    if (buffer.includes(token)) return true;
  }
  return false;
}

function empty(status = 'not_found') {
  return {
    status,
    sdkappid: null,
    source_type: null,
    source_path_hint: null,
    matched_field: null,
    candidates_count: 0,
    conflict: status === 'conflict',
  };
}

function validSdkAppId(value) {
  const text = String(value ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!/^[0-9]+$/.test(text) || /^0+$/.test(text)) return null;
  if (/PLACEHOLDER|x{3,}|your|demo/i.test(text)) return null;
  return text;
}

function literalSdkAppId(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:[0-9]+|"[0-9]+"|'[0-9]+')$/.test(text)) return null;
  return validSdkAppId(text);
}

function sourceTypeFor(name) {
  if (name.startsWith('GenerateTestUserSig') || name === 'generateTestUserSig.js' || name === 'generate_test_user_sig.dart') {
    return 'test_usersig';
  }
  if (name.startsWith('TLSSigAPI') || name === 'TLSSigAPITest.go') return 'server_sig';
  return 'literal_config';
}

function isTier2SourceFile(name) {
  const lower = String(name).toLowerCase();
  if (/\.d\.ts$/.test(lower)) return false;
  if (/\.(?:min|bundle)\.(?:js|mjs|cjs)$/.test(lower)) return false;
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && TIER2_EXTENSIONS.has(lower.slice(dot));
}

function resultFor(candidates) {
  if (candidates.length === 0) return empty();
  const byValue = new Map();
  for (const candidate of candidates) {
    if (!byValue.has(candidate.sdkappid)) byValue.set(candidate.sdkappid, candidate);
  }
  if (byValue.size > 1) {
    return { ...empty('conflict'), candidates_count: candidates.length };
  }
  const winner = byValue.values().next().value;
  return {
    status: 'resolved',
    sdkappid: winner.sdkappid,
    source_type: winner.source_type,
    source_path_hint: winner.source_path_hint ?? null,
    matched_field: winner.matched_field ?? null,
    candidates_count: candidates.length,
    conflict: false,
  };
}

// Produce two same-length views: `source` keeps string literals for tightly
// controlled value extraction, while `code` blanks comments and all string
// contents so field/context/call matches must originate in executable code.
// Triple-quoted Python/PHP-style documentation strings are masked as a unit.
function delimiterIsEscaped(input, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && input[i] === '\\'; i--) backslashes++;
  return (backslashes & 1) === 1;
}

function lexSource(input, deadlineMono, fileName = '') {
  const lowerName = String(fileName).toLowerCase();
  const hashComments = lowerName.endsWith('.py') || lowerName.endsWith('.php');
  const slashLineComments = !lowerName.endsWith('.py');
  const htmlComments = lowerName.endsWith('.vue');
  let source = '';
  let code = '';
  let quote = null;
  let blockEnd = null;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    if ((i & 0xfff) === 0 && performance.now() > deadlineMono) return null;
    const ch = input[i];
    const next = input[i + 1];
    if (blockEnd) {
      if (input.startsWith(blockEnd, i)) {
        source += ' '.repeat(blockEnd.length); code += ' '.repeat(blockEnd.length);
        i += blockEnd.length - 1; blockEnd = null;
      } else if (ch === '\n') { source += '\n'; code += '\n'; }
      else { source += ' '; code += ' '; }
      continue;
    }
    if (quote) {
      // Python permits an escaped triple delimiter inside a triple-quoted
      // string. Only an even run of preceding backslashes closes the string.
      if (quote.length === 3 && input.startsWith(quote, i) && !delimiterIsEscaped(input, i)) {
        source += quote; code += '   '; i += 2; quote = null; escaped = false;
        continue;
      }
      source += ch; code += ch === '\n' ? '\n' : ' ';
      if (quote.length === 1) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && input[i + 1] === ch && input[i + 2] === ch) {
      quote = ch.repeat(3); source += quote; code += '   '; i += 2; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch; source += ch; code += ' '; continue;
    }
    if (ch === '/' && next === '*') {
      source += '  '; code += '  '; blockEnd = '*/'; i++; continue;
    }
    if (htmlComments && input.startsWith('<!--', i)) {
      source += '    '; code += '    '; blockEnd = '-->'; i += 3; continue;
    }
    if (slashLineComments && ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') { source += ' '; code += ' '; i++; }
      if (i < input.length) { source += '\n'; code += '\n'; }
      continue;
    }
    if (hashComments && ch === '#' && next !== '[') {
      while (i < input.length && input[i] !== '\n') { source += ' '; code += ' '; i++; }
      if (i < input.length) { source += '\n'; code += '\n'; }
      continue;
    }
    source += ch; code += ch;
  }
  return performance.now() > deadlineMono ? null : { source, code };
}

function maskedText(input) {
  return input.replace(/[^\r\n]/g, ' ');
}

function htmlTagEnd(input, start, deadlineMono) {
  let quote = null;
  for (let i = start; i < input.length; i++) {
    if ((i & 0xff) === 0 && performance.now() > deadlineMono) return null;
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

// Vue template text is HTML, not JavaScript. Discover real SFC regions from
// the raw document before applying a language lexer, otherwise an apostrophe
// in text such as "Don't connect" can hide a later <script setup> block.
// HTML comments are skipped and escaped examples (`&lt;script>`) never look
// like tags. A raw <script> is treated as a real HTML/SFC tag, matching Vue's
// own parsing model.
function lexVueSource(input, deadlineMono) {
  const lower = input.toLowerCase();
  const regions = [];
  const scriptRanges = [];
  const stack = [];
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
  ]);
  for (let i = 0; i < input.length;) {
    if ((i & 0xfff) === 0 && performance.now() > deadlineMono) return null;
    if (input.startsWith('<!--', i)) {
      const close = input.indexOf('-->', i + 4);
      if (close < 0) return null;
      i = close + 3;
      continue;
    }
    if (input[i] === '<') {
      const closing = input[i + 1] === '/';
      const nameStart = i + (closing ? 2 : 1);
      let nameEnd = nameStart;
      while (/[A-Za-z0-9:_-]/.test(input[nameEnd] || '')) nameEnd++;
      const next = input[nameEnd];
      if (nameEnd === nameStart || !(next === '>' || next === '/' || /\s/.test(next || ''))) {
        i++;
        continue;
      }
      const tagEnd = htmlTagEnd(input, i, deadlineMono);
      if (tagEnd === null) return null;
      if (tagEnd < 0) return null;
      const originalName = input.slice(nameStart, nameEnd);
      const tagName = originalName.toLowerCase();
      const tag = input.slice(i, tagEnd + 1);
      const selfClosing = /\/\s*>$/.test(tag);

      if (!closing && tagName === 'script') {
        const bodyStart = tagEnd + 1;
        let closeStart = lower.indexOf('</script', bodyStart);
        while (closeStart >= 0) {
          const closeNext = input[closeStart + 8];
          if (closeNext === '>' || /\s/.test(closeNext || '')) break;
          closeStart = lower.indexOf('</script', closeStart + 2);
        }
        if (closeStart < 0) return null;
        const closeEnd = htmlTagEnd(input, closeStart, deadlineMono);
        if (closeEnd === null || closeEnd < 0) return null;
        // Only top-level SFC script blocks are executable resolver sources.
        // A script-shaped example nested in template/custom-block content is
        // skipped as display content.
        if (stack.length === 0) {
          const body = input.slice(bodyStart, closeStart);
          const views = lexSource(body, deadlineMono, 'component.ts');
          if (!views) return null;
          regions.push({ start: bodyStart, end: closeStart, views });
          scriptRanges.push([bodyStart, closeStart]);
        }
        i = closeEnd + 1;
        continue;
      }

      if (!closing && originalName === 'TUIKit' && stack[0] === 'template') {
        const views = lexSource(tag, deadlineMono, 'component.ts');
        if (!views) return null;
        regions.push({ start: i, end: tagEnd + 1, views });
      }

      if (closing) {
        const openIndex = stack.lastIndexOf(tagName);
        if (openIndex >= 0) stack.length = openIndex;
      } else if (!selfClosing && !voidElements.has(tagName)) {
        stack.push(tagName);
      }
      // Skip the whole quote-aware tag so script-shaped attribute text is not
      // revisited as a top-level block.
      i = tagEnd + 1;
      continue;
    }
    i++;
  }
  if (performance.now() > deadlineMono) return null;
  regions.sort((a, b) => a.start - b.start);
  const scriptEnds = new Set(scriptRanges.map(([, end]) => end));
  const source = [];
  const code = [];
  let cursor = 0;
  for (const region of regions) {
    if (region.start < cursor) continue;
    let gap = maskedText(input.slice(cursor, region.start));
    // Each SFC script body is a separate source unit. Preserve that EOF as a
    // same-length newline boundary so a final expression cannot consume the
    // following </script>/<template> gap after regions are recombined.
    if (scriptEnds.has(cursor) && gap.length > 0) gap = `\n${gap.slice(1)}`;
    source.push(gap, region.views.source);
    code.push(gap, region.views.code);
    cursor = region.end;
  }
  let tail = maskedText(input.slice(cursor));
  if (scriptEnds.has(cursor) && tail.length > 0) tail = `\n${tail.slice(1)}`;
  source.push(tail); code.push(tail);
  const result = { source: source.join(''), code: code.join(''), scriptRanges };
  return performance.now() > deadlineMono ? null : result;
}

function lexFileSource(input, deadlineMono, fileName) {
  return String(fileName).toLowerCase().endsWith('.vue')
    ? lexVueSource(input, deadlineMono)
    : lexSource(input, deadlineMono, fileName);
}

function matchStartsInCode(file, match) {
  return Number.isInteger(match.index) && /\S/.test(file.code[match.index] || '');
}

// A regex may begin in executable code while a later capture originates in a
// string (for example TUIKit.init({ help: "SDKAppID: 140..." })). Locate the
// exact captured field occurrence immediately before the captured value and
// require that field to be visible in the code view.
function capturedFieldStartsInCode(file, match, fieldIndex, valueIndex) {
  const value = match[valueIndex];
  const field = match[fieldIndex];
  if (typeof value !== 'string' || typeof field !== 'string') return false;
  const valueOffset = match[0].lastIndexOf(value);
  // Search strictly before the captured value: field and value may have the
  // same spelling (`SDKAppID: SDKAppID`).
  const fieldOffset = match[0].lastIndexOf(field, valueOffset - 1);
  if (valueOffset < 0 || fieldOffset < 0) return false;
  return /\S/.test(file.code[match.index + fieldOffset] || '');
}

// TypeScript/Dart generic invocations can contain commas that are not call
// separators (`makeContext<Map<String, int>>()`). Treat `<...>` as a delimiter
// only when a balanced close is followed by an invocation `(`; comparisons
// remain ordinary operators.
function isGenericInvocationStart(code, index, end) {
  let depth = 0;
  for (let i = index; i < end; i++) {
    const ch = code[i];
    if (ch === '<') depth++;
    else if (ch === '>') {
      depth--;
      if (depth === 0) {
        let next = i + 1;
        while (next < end && /\s/.test(code[next])) next++;
        return code[next] === '(';
      }
      if (depth < 0) return false;
    } else if (depth > 0 && (ch === ';' || ch === '\n')) return false;
  }
  return false;
}

// Parse one call using the already-masked code view. Strings and comments are
// spaces there, so their commas and parentheses never affect argument
// boundaries. Nested calls/arrays/objects remain balanced and are allowed.
function topLevelCallArguments(file, openParen, deadlineMono, maxChars = 2000) {
  const args = [];
  let start = openParen + 1;
  const delimiters = [];
  const end = Math.min(file.code.length, openParen + 1 + maxChars);
  for (let i = openParen + 1; i < end; i++) {
    if ((i & 0xff) === 0 && performance.now() > deadlineMono) return null;
    const ch = file.code[i];
    if (ch === '<' && (delimiters.at(-1) === '>' || isGenericInvocationStart(file.code, i, end))) delimiters.push('>');
    else if (ch === '(') delimiters.push(')');
    else if (ch === '[') delimiters.push(']');
    else if (ch === '{') delimiters.push('}');
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
      if (ch === '>' && delimiters.at(-1) !== '>') continue;
      if (ch === ')' && delimiters.length === 0) {
        args.push([start, i]);
        return { status: 'ok', args };
      }
      if (delimiters.pop() !== ch) return { status: 'malformed', args: [] };
    } else if (ch === ',' && delimiters.length === 0) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  return performance.now() > deadlineMono ? null : { status: 'malformed', args: [] };
}

function relativeHint(root, path) {
  return relative(root, path).split(sep).join('/');
}

// Deliberately parse only the one trusted YAML path used by telemetry. This
// avoids a runtime dependency while refusing aliases, flow maps and other
// YAML constructs that could broaden the data surface. The parser accepts a
// normal indented mapping and quoted/unquoted scalar values.
function sessionSdkAppId(input, deadlineMono) {
  const lines = String(input).split(/\r?\n/);
  let credentialsIndent = null;
  for (const raw of lines) {
    if (performance.now() > deadlineMono) return null;
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, '        ').length;
    const line = raw.trim();
    if (credentialsIndent === null) {
      if (/^credentials\s*:\s*(?:#.*)?$/.test(line)) credentialsIndent = indent;
      continue;
    }
    if (indent <= credentialsIndent) {
      credentialsIndent = /^credentials\s*:\s*(?:#.*)?$/.test(line) ? indent : null;
      continue;
    }
    const match = line.match(/^sdkappid\s*:\s*(["']?[0-9]+["']?)\s*(?:#.*)?$/);
    if (match) return validSdkAppId(match[1]);
  }
  return null;
}

function directBindings(file, deadlineMono, { immutableOnly = false, allowedAt = null } = {}) {
  const bindings = new Map();
  const permits = typeof allowedAt === 'function' ? allowedAt : () => true;
  const assignment = immutableOnly
    ? /\b(?:const|final)\s+(?:(?:int|number|Int|UInt32|long|String|var|dynamic)\s+)?([A-Za-z_$][\w$]*)\b\s*(?::\s*(?:int|number|Int|UInt32|long))?\s*=\s*([^,;}\]\n]+)/g
    : /\b([A-Za-z_$][\w$]*)\b\s*(?::\s*(?:int|number|Int|UInt32|long))?\s*(?::=|=)\s*([^,;}\]\n]+)/g;
  for (const match of file.source.matchAll(assignment)) {
    if (performance.now() > deadlineMono) return null;
    if (!matchStartsInCode(file, match)) continue;
    if (!permits(match.index)) continue;
    const id = match[1];
    const sdkappid = literalSdkAppId(match[2]);
    if (!sdkappid) continue;
    const allAssignments = new RegExp(String.raw`\b${id.replace(/[$]/g, '\\$&')}\b\s*(?:(?::[^=;\n]+)?=|:=)`, 'g');
    let assignments = 0;
    for (const occurrence of file.source.matchAll(allAssignments)) {
      if (performance.now() > deadlineMono) return null;
      if (matchStartsInCode(file, occurrence) && permits(occurrence.index)) assignments++;
    }
    if (assignments === 1) bindings.set(id, sdkappid);
  }
  return bindings;
}

// dartTopLevelBindings — HC-1 compliant brace-depth-tracked const extraction for Dart files.
// Uses file.code (masked) for depth tracking; uses file.source for value extraction.
// Returns null on deadline, malformed bracket structure, or depth anomaly.
// Never returns partial results.
function dartTopLevelBindings(file, deadlineMono) {
  // Phase 1: validate entire file bracket structure against masked code view (HC-1)
  let depth = 0;
  for (let i = 0; i < file.code.length; i++) {
    if ((i & 0xfff) === 0 && performance.now() > deadlineMono) return null;
    const ch = file.code[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return null; // malformed: closing brace before any open
    }
  }
  if (depth !== 0) return null; // malformed: unclosed brace after full scan

  // Phase 2: collect depth-0 const bindings; track depth as we advance linearly
  const bindings = new Map();
  let scanDepth = 0;
  let scanPos = 0;

  function advanceTo(target) {
    while (scanPos < target) {
      const ch = file.code[scanPos];
      if (ch === '{') scanDepth++;
      else if (ch === '}') scanDepth--;
      scanPos++;
    }
  }

  // Match `const [type] identifier =` in masked code view
  const constRe = /\bconst\s+(?:int\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=/g;
  for (const match of file.code.matchAll(constRe)) {
    if (performance.now() > deadlineMono) return null;
    advanceTo(match.index);
    if (scanDepth !== 0) continue; // skip function-local const (HC-1 guarantee)

    // Extract value from source view at same position
    const eqOffset = match[0].lastIndexOf('=');
    const valueStart = match.index + eqOffset + 1;
    const semicolonPos = file.source.indexOf(';', valueStart);
    if (semicolonPos < 0) continue;
    const valueStr = file.source.slice(valueStart, semicolonPos).trim();
    const sdkappid = literalSdkAppId(valueStr);
    if (!sdkappid) continue;

    const name = match[1];
    // Count all depth-0 const declarations for this name (single-assignment only)
    const dupRe = new RegExp(String.raw`\bconst\s+(?:int\s+|var\s+)?${name.replace(/[$]/g, '\\$&')}\s*=`, 'g');
    let count = 0;
    let countDepth = 0;
    for (const dup of file.code.matchAll(dupRe)) {
      if (performance.now() > deadlineMono) return null;
      // Recompute depth at each dup match position
      let d2 = 0;
      for (let i2 = 0; i2 < dup.index; i2++) {
        const c2 = file.code[i2];
        if (c2 === '{') d2++;
        else if (c2 === '}') d2--;
      }
      if (d2 === 0) count++;
    }
    if (count === 1) bindings.set(name, sdkappid);
  }
  return bindings;
}

// restrictedTier2Candidates — R13 TUICallKit.instance.login for Dart files.
// Returns null on deadline or HC-1 bracket anomaly (propagated from dartTopLevelBindings).
// Returns null on HC-2 malformed exact-shape call (fail-closed).
// Returns Candidate[] (possibly empty) otherwise.
function restrictedTier2Candidates(file, deadlineMono) {
  if (!SEMANTIC_CONTEXT_RE.test(file.code)) return [];
  const bindings = dartTopLevelBindings(file, deadlineMono);
  if (bindings === null) return null; // deadline or malformed bracket structure → propagate invalid

  const out = [];
  const loginRe = /\bTUICallKit\.instance\.login\s*\(/g;
  for (const match of file.code.matchAll(loginRe)) {
    if (performance.now() > deadlineMono) return null;
    const openParen = match.index + match[0].lastIndexOf('(');
    const parsed = topLevelCallArguments(file, openParen, deadlineMono);
    if (!parsed) return null; // deadline
    if (parsed.status === 'malformed') return null; // HC-2: unclosed exact shape → invalid
    if (parsed.args.length < 1) continue;
    const [valueStart, valueEnd] = parsed.args[0];
    const value = file.source.slice(valueStart, valueEnd).trim();
    const codeValue = file.code.slice(valueStart, valueEnd).trim();
    const sdkappid = literalSdkAppId(value)
      || (/^[A-Za-z_$][\w$]*$/.test(codeValue) ? bindings.get(codeValue) : null);
    if (sdkappid) out.push({ sdkappid, source_type: 'runtime_call', source_path_hint: file.hint, matched_field: null });
  }
  return out;
}

function tier1Candidates(file, deadlineMono) {
  if (!TIER1_FILES.has(file.name) || !SEMANTIC_CONTEXT_RE.test(file.code)) return [];
  const regex = new RegExp(String.raw`\b(${FIELD_PATTERN})\b\s*(?::\s*(?:int|number|Int|UInt32|long))?\s*[:=]\s*([^,;}\]\n]+)`, 'g');
  const out = [];
  for (const match of file.source.matchAll(regex)) {
    if (performance.now() > deadlineMono) return null;
    if (!matchStartsInCode(file, match)) continue;
    const sdkappid = literalSdkAppId(match[2]);
    if (!sdkappid) continue;
    out.push({ sdkappid, source_type: sourceTypeFor(file.name), source_path_hint: file.hint, matched_field: match[1] });
  }
  return out;
}

function tier3Candidates(file, deadlineMono) {
  if (!TIER3_FILES.has(file.name) || !SEMANTIC_CONTEXT_RE.test(file.code)) return [];
  const out = [];
  const bindings = directBindings(file, deadlineMono);
  if (!bindings) return null;
  const call = /(?:new\s+TLSSigAPIv2(?:\.Api)?|\bNewTLSSigAPIv2|\bTLSSigAPIv2(?:\.Api)?|\b[Gg]enSig)\s*\(\s*(\$?[A-Za-z_$][\w$]*|[0-9]+)/g;
  for (const match of file.source.matchAll(call)) {
    if (performance.now() > deadlineMono) return null;
    if (!matchStartsInCode(file, match)) continue;
    const identifier = match[1].replace(/^\$/, '');
    const sdkappid = validSdkAppId(match[1]) || bindings.get(identifier);
    if (sdkappid) out.push({ sdkappid, source_type: 'server_sig', source_path_hint: file.hint, matched_field: null });
  }
  return out;
}

function insideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function isSkippedDir(name) {
  return SKIP_DIRS_LOWER.has(String(name).toLowerCase());
}

function entersSkippedDir(root, candidate) {
  const rel = relative(root, candidate);
  return rel.split(sep).some(isSkippedDir);
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Open and read one allowlisted file without following a final symlink.
 * Size checks and reads use the same descriptor; repeated inode checks bind
 * the descriptor to the path/canonical-root decision despite path swaps.
 */
function readBoundedRegularFile(path, root, maxBytes, deadlineMono) {
  let fd;
  try {
    if (performance.now() > deadlineMono) return { status: 'invalid' };
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { status: 'skip' };
    if (opened.size > maxBytes) return { status: 'invalid' };

    const before = lstatSync(path);
    if (before.isSymbolicLink() || !sameInode(opened, before)) return { status: 'invalid' };
    const canonical = realpathSync(path);
    if (!insideRoot(root, canonical)) return { status: 'invalid' };
    const after = lstatSync(path);
    if (after.isSymbolicLink() || !sameInode(opened, after)) return { status: 'invalid' };

    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      if (performance.now() > deadlineMono) return { status: 'invalid' };
      const size = Math.min(64 * 1024, maxBytes + 1 - total);
      const buffer = Buffer.allocUnsafe(size);
      const read = readSync(fd, buffer, 0, size, total);
      if (read === 0) break;
      chunks.push(buffer.subarray(0, read));
      total += read;
    }
    if (total > maxBytes) return { status: 'invalid' };
    const finalStat = fstatSync(fd);
    if (!sameInode(opened, finalStat) || finalStat.size > maxBytes) return { status: 'invalid' };
    if (performance.now() > deadlineMono) return { status: 'invalid' };
    return { status: 'ok', canonical, content: Buffer.concat(chunks, total).toString('utf8'),
      snapshot: { ino: finalStat.ino, size: finalStat.size, mtimeMs: finalStat.mtimeMs } };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP') return { status: 'skip' };
    return { status: 'invalid' };
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* descriptor cleanup is best-effort */ }
    }
  }
}

function collectFiles(root, allowedFiles, opts, deadlineMono, budget) {
  const maxBytes = Number.isInteger(opts.max_file_bytes) && opts.max_file_bytes > 0 ? opts.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
  const found = new Map();
  let invalid = false;
  const allows = typeof allowedFiles === 'function'
    ? allowedFiles
    : (name) => allowedFiles.has(name);

  function add(path) {
    if (found.has(path)) return;
    const cached = budget.fileCache.get(path);
    if (cached) {
      if (cached._rawOnly) {
        // Web file was read in Tier 2 without lexing (_rawOnly). Lex lazily now.
        // Budget was already consumed — do NOT decrement again.
        if (performance.now() > deadlineMono) { invalid = true; return; }
        const rawContent = cached._rawOnlyContent || cached.rawContent;
        if (!rawContent) { invalid = true; return; }
        const views = lexFileSource(rawContent, deadlineMono, cached.name);
        if (!views) { invalid = true; return; }
        const lexed = {
          name: cached.name, path: cached.path, hint: cached.hint,
          source: views.source, code: views.code,
          vueScriptRanges: views.scriptRanges ?? null,
          rawContent: null, _snapshot: cached._snapshot,
        };
        budget.fileCache.set(path, lexed);
        budget.fileCache.set(cached.path, lexed);
        found.set(cached.path, lexed);
        return;
      }
      found.set(cached.path, cached); return;
    }
    if (performance.now() > deadlineMono) { invalid = true; return; }
    // `max_files` is a hard read budget across all tiers. Do not open a
    // lower-tier file merely to discover that the budget was exhausted.
    if (budget.files <= 0) { invalid = true; return; }
    const read = readBoundedRegularFile(path, root, maxBytes, deadlineMono);
    if (read.status === 'invalid') { invalid = true; return; }
    if (read.status !== 'ok') return;
    const canonicalCached = budget.fileCache.get(read.canonical);
    if (canonicalCached) {
      if (canonicalCached._rawOnly) {
        // Lazy-lex the canonical _rawOnly entry (same as path-keyed case above)
        if (performance.now() > deadlineMono) { invalid = true; return; }
        const rawContent = canonicalCached._rawOnlyContent || canonicalCached.rawContent;
        if (!rawContent) { invalid = true; return; }
        const views2 = lexFileSource(rawContent, deadlineMono, canonicalCached.name);
        if (!views2) { invalid = true; return; }
        const lexed2 = {
          name: canonicalCached.name, path: canonicalCached.path, hint: canonicalCached.hint,
          source: views2.source, code: views2.code,
          vueScriptRanges: views2.scriptRanges ?? null,
          rawContent: null, _snapshot: canonicalCached._snapshot,
        };
        budget.fileCache.set(path, lexed2);
        budget.fileCache.set(read.canonical, lexed2);
        found.set(lexed2.path, lexed2);
        return;
      }
      budget.fileCache.set(path, canonicalCached);
      found.set(canonicalCached.path, canonicalCached);
      return;
    }
    budget.files--;
    // Token prefilter: skip expensive lexing if raw content has no semantic token
    if (typeof allowedFiles === 'function' && !hasSemanticToken(read.content)) return;
    const views = lexFileSource(read.content, deadlineMono, basename(read.canonical));
    if (!views) { invalid = true; return; }
    const file = {
      name: basename(read.canonical), path: read.canonical,
      hint: relativeHint(root, read.canonical),
      source: views.source,
      code: views.code,
      vueScriptRanges: views.scriptRanges ?? null,
      // rawContent stored for web files when structured adapter is active (production or test injection)
      rawContent: (opts._webAdapter || opts._loadWebAdapter) ? read.content : null,
      // snapshot stored so concurrent modification can be detected after adapter returns
      _snapshot: (opts._webAdapter || opts._loadWebAdapter) ? read.snapshot : null,
    };
    budget.fileCache.set(path, file);
    budget.fileCache.set(read.canonical, file);
    found.set(read.canonical, file);
  }

  for (const preferred of Array.isArray(opts.preferred_paths) ? opts.preferred_paths : []) {
    const candidate = resolve(root, String(preferred));
    if (insideRoot(root, candidate)
        && !entersSkippedDir(root, candidate)
        && allows(basename(candidate))) add(candidate);
  }

  const stack = [root];
  while (stack.length > 0 && !invalid) {
    if (performance.now() > deadlineMono) { invalid = true; break; }
    const dir = stack.pop();
    if (!budget.dirsSeen.has(dir)) {
      if (budget.dirs <= 0) { invalid = true; break; }
      budget.dirs--;
      budget.dirsSeen.add(dir);
    }
    let entries = budget.directoryCache.get(dir);
    if (!entries) {
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      budget.directoryCache.set(dir, entries);
    }
    for (const entry of entries) {
      if (invalid) break;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) stack.push(path);
      } else if (entry.isFile() && allows(entry.name)) add(path);
    }
  }
  return invalid ? null : [...found.values()];
}

/**
 * collectTier2RawFiles — Tier 2 file collection.
 *
 * Web files (.js/.ts/.vue etc.): raw bytes + snapshot only — no lexing.
 *   Avoids paying the legacy lexer deadline cost before the structured adapter runs.
 *   A _rawOnly marker in budget.fileCache tells Tier 3 to lazy-lex without re-reading.
 * Dart files: lexed immediately (needed for restrictedTier2Candidates).
 * Any read failure is fail-closed (returns null).
 */
function collectTier2RawFiles(root, opts, deadlineMono, budget) {
  const maxBytes = Number.isInteger(opts.max_file_bytes) && opts.max_file_bytes > 0 ? opts.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
  const found = new Map();
  let invalid = false;
  const rawCache = new Map();

  function add(path) {
    if (found.has(path)) return;
    // Check shared budget.fileCache first — may have been read/lexed by Tier 1 or another Tier 2 file
    const cached = budget.fileCache.get(path);
    if (cached) {
      const rawFromCache = {
        name: cached.name, path: cached.path, hint: cached.hint,
        rawContent: cached.rawContent || cached._rawOnlyContent || null,
        _preLexed: (cached.source !== undefined && !cached._rawOnly)
          ? { source: cached.source, code: cached.code, vueScriptRanges: cached.vueScriptRanges ?? null }
          : null,
        _lexFailed: false,
        _snapshot: cached._snapshot || null,
      };
      rawCache.set(path, rawFromCache);
      found.set(cached.path, rawFromCache);
      return;
    }
    if (rawCache.has(path)) { found.set(rawCache.get(path).path, rawCache.get(path)); return; }
    if (performance.now() > deadlineMono) { invalid = true; return; }
    if (budget.files <= 0) { invalid = true; return; }
    const read = readBoundedRegularFile(path, root, maxBytes, deadlineMono);
    if (read.status === 'invalid') { invalid = true; return; }
    if (read.status !== 'ok') return;
    if (rawCache.has(read.canonical)) {
      rawCache.set(path, rawCache.get(read.canonical));
      found.set(rawCache.get(read.canonical).path, rawCache.get(read.canonical));
      return;
    }
    budget.files--;
    if (!hasSemanticToken(read.content)) return; // token prefilter — no TRTC signal, skip

    const rawName = basename(read.canonical);
    const rawExt = extname(rawName).toLowerCase();
    const snapshot = read.snapshot || null;
    const isWebFile = WEB_TIER2_EXTENSIONS.has(rawExt);

    const rawFile = {
      name: rawName, path: read.canonical,
      hint: relativeHint(root, read.canonical),
      rawContent: read.content,
      _preLexed: null,
      _lexFailed: false,
      _snapshot: snapshot,
    };

    if (isWebFile) {
      // Web path: store raw bytes only. A _rawOnly marker lets Tier 3 lazy-lex without re-reading.
      const rawOnlyCacheEntry = {
        name: rawName, path: read.canonical, hint: relativeHint(root, read.canonical),
        _rawOnly: true, _rawOnlyContent: read.content, _snapshot: snapshot,
        rawContent: (opts._webAdapter || opts._loadWebAdapter) ? read.content : null,
      };
      budget.fileCache.set(path, rawOnlyCacheEntry);
      budget.fileCache.set(read.canonical, rawOnlyCacheEntry);
    } else {
      // Dart path: lex immediately so restrictedTier2Candidates can use code/source views.
      const views = lexFileSource(read.content, deadlineMono, rawName);
      rawFile._preLexed = views
        ? { source: views.source, code: views.code, vueScriptRanges: views.scriptRanges ?? null }
        : null;
      rawFile._lexFailed = !views;

      if (views) {
        const fullFile = {
          name: rawName, path: read.canonical, hint: relativeHint(root, read.canonical),
          source: views.source, code: views.code,
          vueScriptRanges: views.scriptRanges ?? null,
          rawContent: null, _snapshot: snapshot,
        };
        budget.fileCache.set(path, fullFile);
        budget.fileCache.set(read.canonical, fullFile);
      }
    }

    rawCache.set(path, rawFile);
    rawCache.set(read.canonical, rawFile);
    found.set(read.canonical, rawFile);
  }

  for (const preferred of Array.isArray(opts.preferred_paths) ? opts.preferred_paths : []) {
    const candidate = resolve(root, String(preferred));
    if (insideRoot(root, candidate) && !entersSkippedDir(root, candidate) && isTier2SourceFile(basename(candidate))) {
      add(candidate);
    }
  }

  const stack = [root];
  while (stack.length > 0 && !invalid) {
    if (performance.now() > deadlineMono) { invalid = true; break; }
    const dir = stack.pop();
    if (!budget.dirsSeen.has(dir)) {
      if (budget.dirs <= 0) { invalid = true; break; }
      budget.dirs--;
      budget.dirsSeen.add(dir);
    }
    let entries = budget.directoryCache.get(dir);
    if (!entries) {
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      budget.directoryCache.set(dir, entries);
    }
    for (const entry of entries) {
      if (invalid) break;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) stack.push(path);
      } else if (entry.isFile() && isTier2SourceFile(entry.name)) add(path);
    }
  }

  if (invalid) return null;
  const allFiles = [...found.values()];
  const webFiles = allFiles.filter((f) => WEB_TIER2_EXTENSIONS.has(extname(f.name).toLowerCase()));
  const dartFiles = allFiles.filter((f) => extname(f.name).toLowerCase() === '.dart');
  return { webFiles, dartFiles };
}

/**
 * runWebTier2 — production Tier 2 path for Web files (.js/.jsx/.mjs/.cjs/.ts/.tsx/.vue).
 * Calls webAdapter.extract() on each file and returns { candidates, invalid, failure }.
 * failure values: null | 'extract_error' | 'contract_error'
 * Adapter returning { status: 'invalid' } is a normal source-level parse result, not a failure.
 */
function runWebTier2(webFiles, webAdapter, deadlineMono) {
  const candidates = [];
  for (const rawFile of webFiles) {
    if (!rawFile.rawContent) continue;
    if (Buffer.byteLength(rawFile.rawContent, 'utf8') > WEB_MAX_FILE_BYTES) {
      return { candidates: [], invalid: true, failure: null };
    }
    if (performance.now() > deadlineMono) return { candidates: [], invalid: true, failure: null };

    let result;
    try {
      result = webAdapter.extract({
        source: rawFile.rawContent,
        relativePath: rawFile.hint || rawFile.name,
        ext: extname(rawFile.name),
        byteLength: Buffer.byteLength(rawFile.rawContent, 'utf8'),
      });
    } catch {
      return { candidates: [], invalid: true, failure: 'extract_error' };
    }

    if (!result || typeof result.status !== 'string' || !Array.isArray(result.candidates)) {
      return { candidates: [], invalid: true, failure: 'contract_error' };
    }

    if (performance.now() > deadlineMono) return { candidates: [], invalid: true, failure: null };

    // Post-call inode/mtime check against read-time snapshot (concurrent modification guard)
    const snapshot = rawFile._snapshot;
    if (snapshot) {
      try {
        const afterStat = lstatSync(rawFile.path);
        if (afterStat.ino !== snapshot.ino || afterStat.size !== snapshot.size || afterStat.mtimeMs !== snapshot.mtimeMs) {
          return { candidates: [], invalid: true, failure: null };
        }
      } catch { return { candidates: [], invalid: true, failure: null }; }
    }

    if (result.status === 'invalid') {
      // Source-level parse failure — normal for malformed files, not an adapter fault
      return { candidates: [], invalid: true, failure: null };
    }

    for (const c of result.candidates) {
      const sdkappid = validSdkAppId(c?.sdkappid);
      if (sdkappid) candidates.push({ sdkappid, source_type: 'runtime_call', source_path_hint: rawFile.hint, matched_field: null });
    }
  }
  return { candidates, invalid: false, failure: null };
}

/**
 * runRestrictedLegacyTier2 — Dart Tier 2 path using restrictedTier2Candidates (R13).
 * Returns { candidates, invalid }.
 */
function runRestrictedLegacyTier2(dartFiles, deadlineMono) {
  const candidates = [];
  for (const rawFile of dartFiles) {
    if (rawFile._lexFailed) return { candidates: [], invalid: true };
    let file;
    if (rawFile._preLexed) {
      file = {
        name: rawFile.name, path: rawFile.path, hint: rawFile.hint,
        source: rawFile._preLexed.source,
        code: rawFile._preLexed.code,
        vueScriptRanges: rawFile._preLexed.vueScriptRanges,
      };
    } else if (rawFile.rawContent) {
      const views = lexFileSource(rawFile.rawContent, deadlineMono, rawFile.name);
      if (!views || performance.now() > deadlineMono) return { candidates: [], invalid: true };
      file = {
        name: rawFile.name, path: rawFile.path, hint: rawFile.hint,
        source: views.source, code: views.code,
        vueScriptRanges: views.scriptRanges ?? null,
      };
    } else {
      continue;
    }
    const extracted = restrictedTier2Candidates(file, deadlineMono);
    if (!extracted || performance.now() > deadlineMono) return { candidates: [], invalid: true };
    candidates.push(...extracted);
  }
  return { candidates, invalid: false };
}

function tier0(root, opts, deadlineMono) {
  const candidates = [];
  const explicit = validSdkAppId(opts.sdkappid);
  if (explicit) candidates.push({ sdkappid: explicit, source_type: 'literal_config', source_path_hint: null, matched_field: 'sdkappid' });
  const sessionPath = join(root, '.trtc-session.yaml');
  const read = readBoundedRegularFile(sessionPath, root, DEFAULT_MAX_FILE_BYTES, deadlineMono);
  if (read.status === 'invalid') return { status: 'invalid', candidates };
  if (read.status === 'ok') {
    const session = sessionSdkAppId(read.content, deadlineMono);
    if (performance.now() > deadlineMono) return { status: 'invalid', candidates };
    if (session) candidates.push({ sdkappid: session, source_type: 'literal_config', source_path_hint: '.trtc-session.yaml', matched_field: 'sdkappid' });
  }
  return { status: 'ok', candidates };
}

/** Resolve one high-confidence SDKAppID without changing project files. */
export function resolveSdkAppId(projectRoot, opts = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return empty('invalid');
  const deadlineMs = Number.isFinite(opts.deadline_ms) && opts.deadline_ms >= 0 ? opts.deadline_ms : DEFAULT_DEADLINE_MS;
  const deadlineMono = performance.now() + deadlineMs;
  let root;
  try {
    root = realpathSync(resolve(projectRoot));
    if (!lstatSync(root).isDirectory()) return empty('invalid');
  } catch { return empty('invalid'); }
  if (performance.now() > deadlineMono) return empty('invalid');

  // Tier 0 ALWAYS runs first — explicit input overrides everything including cache
  const trustedInput = tier0(root, opts, deadlineMono);
  if (trustedInput.status === 'invalid') return empty('invalid');
  const trusted = resultFor(trustedInput.candidates);
  if (trusted.status !== 'not_found') return trusted;

  // Active scope: narrow scan to nearest manifest directory
  const cwd = opts.cwd || root;
  const { scopeRoot, scopeManifest } = resolveActiveScope(cwd, root);
  const scanRoot = scopeRoot;

  // Cache lookup — only after Tier 0 yields not_found
  // Disable cache entirely when caller overrides scan parameters: the cached
  // fingerprint was computed under different limits and cannot be safely reused.
  const usingDefaultParams = (
    (!opts.max_files || opts.max_files === DEFAULT_MAX_FILES) &&
    (!opts.max_dirs || opts.max_dirs === DEFAULT_MAX_DIRS) &&
    (!opts.max_file_bytes || opts.max_file_bytes === DEFAULT_MAX_FILE_BYTES) &&
    (!opts.preferred_paths || opts.preferred_paths.length === 0)
  );
  let cache = null;
  let key = null;
  if (usingDefaultParams && opts.stateRoot && opts._cache) {
    const { readCache, lookupCache, scopeKey } = opts._cache;
    key = scopeKey(scanRoot);
    cache = readCache(opts.stateRoot);
    const cached = lookupCache(cache, key, RESOLVER_VERSION);
    if (cached && isCacheValid(cached, scanRoot, scopeManifest)) {
      // Recompute fingerprint using the same tier used when writing (tiered = faster)
      const tier = (cached.fingerprintTier >= 1 && cached.fingerprintTier <= 3) ? cached.fingerprintTier : 3;
      const currentFP = computeCandidateFingerprint(scanRoot, deadlineMono, opts, tier);
      if (currentFP != null && cached.candidateFingerprint === currentFP) {
        return {
          status: cached.status,
          sdkappid: cached.sdkappid,
          source_type: cached.source_type,
          source_path_hint: null,
          matched_field: null,
          candidates_count: 0,
          conflict: cached.status === 'conflict',
          _cached: true,
        };
      }
      // candidateFingerprint mismatch or compute failed → invalidate, rescan
    }
  }

  const budget = {
    files: Number.isInteger(opts.max_files) && opts.max_files > 0 ? opts.max_files : DEFAULT_MAX_FILES,
    dirs: Number.isInteger(opts.max_dirs) && opts.max_dirs > 0 ? opts.max_dirs : DEFAULT_MAX_DIRS,
    dirsSeen: new Set(),
    fileCache: new Map(),
    directoryCache: new Map(),
  };
  // Resolve Tier 1 before opening broader Tier 2 call-site sources. Cached
  // files and directory entries prevent duplicate reads/traversal work while
  // preserving one cross-tier budget.
  const configFiles = collectFiles(scanRoot, TIER1_FILES, opts, deadlineMono, budget);
  if (!configFiles) return empty('invalid');
  const literalCandidates = [];
  for (const file of configFiles) {
    const extracted = tier1Candidates(file, deadlineMono);
    if (!extracted || performance.now() > deadlineMono) return empty('invalid');
    literalCandidates.push(...extracted);
  }
  const literalResult = resultFor(literalCandidates);
  if (literalResult.status !== 'not_found') {
    if (cache && key) {
      const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 1);
      if (fp) writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, literalResult, fp, 1);
    }
    return literalResult;
  }

  // Tier 2: structured Web adapter + restricted Dart lexer
  // collectTier2RawFiles returns { webFiles, dartFiles } or null (invalid).
  const tier2Raw = collectTier2RawFiles(scanRoot, opts, deadlineMono, budget);
  if (tier2Raw === null) return empty('invalid');

  // Web path: production structured adapter
  // Resolver never loads modules; telemetry provides _loadWebAdapter or _webAdapter (tests).
  const { adapter: webAdapter, failure: loaderFailure } =
    opts._webAdapter
      ? { adapter: opts._webAdapter, failure: null }
      : (tier2Raw.webFiles.length > 0
          ? (opts._loadWebAdapter?.() ?? { adapter: null, failure: 'missing' })
          : { adapter: null, failure: null });

  const webResult = (tier2Raw.webFiles.length > 0 && webAdapter)
    ? runWebTier2(tier2Raw.webFiles, webAdapter, deadlineMono)
    : { candidates: [], invalid: !webAdapter && tier2Raw.webFiles.length > 0, failure: loaderFailure };

  // Propagate adapter failure reason to telemetry via callback (fail-open)
  if (webResult.failure) {
    try { opts._onAdapterFailure?.(webResult.failure); } catch {}
  }

  // Dart path: restricted legacy lexer (R13 TUICallKit)
  const dartResult = tier2Raw.dartFiles.length > 0
    ? runRestrictedLegacyTier2(tier2Raw.dartFiles, deadlineMono)
    : { candidates: [], invalid: false };

  if (webResult.invalid || dartResult.invalid) return empty('invalid');

  const runtimeCandidates = [...webResult.candidates, ...dartResult.candidates];
  const runtimeResult = resultFor(runtimeCandidates);
  if (runtimeResult.status !== 'not_found') {
    if (cache && key) {
      const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 2);
      if (fp) writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, runtimeResult, fp, 2);
    }
    return runtimeResult;
  }
  const serverFiles = collectFiles(scanRoot, TIER3_FILES, opts, deadlineMono, budget);
  if (!serverFiles) return empty('invalid');
  const serverCandidates = [];
  for (const file of serverFiles) {
    const extracted = tier3Candidates(file, deadlineMono);
    if (!extracted || performance.now() > deadlineMono) return empty('invalid');
    serverCandidates.push(...extracted);
  }
  const serverResult = resultFor(serverCandidates);
  if (serverResult.status !== 'not_found') {
    if (cache && key) {
      const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 3);
      if (fp) writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, serverResult, fp, 3);
    }
    return serverResult;
  }
  const notFound = empty();
  if (cache && key) {
    const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 3);
    if (fp) writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, notFound, fp, 3);
  }
  return notFound;
}

function writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, result, candidateFingerprint, fingerprintTier) {
  if (!opts.stateRoot || !opts._cache || !cache || !key) return;
  const { updateEntry, writeCache } = opts._cache;
  let manifestMtime = null;
  if (scopeManifest) {
    try { manifestMtime = lstatSync(join(scanRoot, scopeManifest)).mtimeMs; } catch {}
  }
  let sourceFingerprint = null;
  if (result.status === 'resolved' && result.source_path_hint) {
    try {
      const sourcePath = join(scanRoot, result.source_path_hint);
      const stat = lstatSync(sourcePath);
      if (stat.isFile()) sourceFingerprint = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    } catch {}
  }
  updateEntry(cache, key, result, {
    fingerprint: sourceFingerprint,
    candidateFingerprint: candidateFingerprint || null,
    fingerprintTier: fingerprintTier || 3,
    manifestMtime,
    resolverVersion: RESOLVER_VERSION,
    scopeManifest: scopeManifest || null,
    sourcePath: result.source_path_hint || null,
  });
  try { writeCache(opts.stateRoot, cache); } catch {}
}

// maxTier: 1 = only Tier 1 files, 2 = Tier 1+2, 3 = all tiers
function computeCandidateFingerprint(scanRoot, deadlineMono, opts, maxTier) {
  const maxBytes = Number.isInteger(opts.max_file_bytes) && opts.max_file_bytes > 0 ? opts.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
  // Tier-bounded file budget: Tier 1 has very few files, avoid wasting the shared budget
  const tierFileLimit = maxTier === 1 ? 50 : (maxTier === 2 ? DEFAULT_MAX_FILES : DEFAULT_MAX_FILES);
  let maxFiles = Math.min(
    Number.isInteger(opts.max_files) && opts.max_files > 0 ? opts.max_files : DEFAULT_MAX_FILES,
    tierFileLimit,
  );
  const candidates = [];
  const stack = [scanRoot];
  const dirsSeen = new Set();
  let dirs = Number.isInteger(opts.max_dirs) && opts.max_dirs > 0 ? opts.max_dirs : DEFAULT_MAX_DIRS;
  while (stack.length > 0) {
    if (performance.now() > deadlineMono) return null;
    const dir = stack.pop();
    if (dirsSeen.has(dir)) continue;
    if (dirs <= 0) return null;
    dirs--;
    dirsSeen.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return null; } // fail-closed: readdirSync error would also fail full scan
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) stack.push(join(dir, entry.name));
      } else if (entry.isFile()) {
        const name = entry.name;
        const isTier1 = TIER1_FILES.has(name);
        const isTier3 = TIER3_FILES.has(name);
        const isTier2 = isTier2SourceFile(name); // union: TLSSigAPIv2.js matches both Tier2 ext and Tier3
        const inScope =
          (maxTier >= 1 && isTier1) ||
          (maxTier >= 2 && isTier2) ||
          (maxTier >= 3 && isTier3);
        if (!inScope) continue;
        if (maxFiles <= 0) return null; // budget exhaustion → fail-closed
        maxFiles--;
        const absPath = join(dir, name);
        const rel = relative(scanRoot, absPath);
        let stat;
        try { stat = lstatSync(absPath); }
        catch { return null; } // fail-closed
        if (!stat.isFile()) continue;
        if (stat.size > maxBytes) {
          candidates.push(`oversized:${rel}:${stat.size}:${stat.ino}`);
        } else {
          candidates.push(`${rel}:${stat.size}:${stat.mtimeMs}:${stat.ino}`);
        }
      }
    }
  }
  candidates.sort();
  return createHash('sha256').update(candidates.join('\n')).digest('hex').slice(0, 32);
}

function isCacheValid(cached, scanRoot, scopeManifest) {
  // Structural validation — fail-closed on any anomaly
  if (!cached || typeof cached.status !== 'string') return false;
  if (!['resolved', 'not_found', 'conflict', 'invalid'].includes(cached.status)) return false;
  // timestamp must be a finite positive number
  if (!Number.isFinite(cached.timestamp) || cached.timestamp <= 0) return false;
  // ttl must be null or a non-negative finite number
  if (cached.ttl !== null && cached.ttl !== undefined) {
    if (!Number.isFinite(cached.ttl) || cached.ttl < 0) return false;
  }
  // resolved requires a valid numeric sdkappid
  if (cached.status === 'resolved') {
    if (!cached.sdkappid) return false;
    if (!/^[0-9]+$/.test(String(cached.sdkappid))) return false;
    if (/^0+$/.test(String(cached.sdkappid))) return false;
  }
  // non-resolved must not carry a sdkappid
  if (cached.status !== 'resolved' && cached.sdkappid != null) return false;
  // candidateFingerprint format check (32 hex chars)
  if (cached.candidateFingerprint != null) {
    if (typeof cached.candidateFingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(cached.candidateFingerprint)) return false;
  }

  // Check manifest mtime
  if (cached.manifestMtime != null) {
    const manifest = cached.scopeManifest || scopeManifest;
    if (manifest) {
      try {
        const currentMtime = lstatSync(join(scanRoot, manifest)).mtimeMs;
        if (Math.abs(currentMtime - cached.manifestMtime) >= 1) return false;
      } catch { return false; }
    }
  }
  // For resolved entries, verify source file fingerprint
  if (cached.status === 'resolved' && cached.fingerprint && cached.sourcePath) {
    try {
      const sourcePath = join(scanRoot, cached.sourcePath);
      const stat = lstatSync(sourcePath);
      if (!stat.isFile()) return false;
      const currentFP = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
      if (currentFP !== cached.fingerprint) return false;
    } catch { return false; }
  }
  // Resolved entries without fingerprint get a 1-hour fallback TTL
  if (cached.status === 'resolved' && !cached.fingerprint) {
    const age = Date.now() - cached.timestamp;
    if (age > 60 * 60 * 1000) return false;
  }
  return true;
}

export const _SDKAPPID_RESOLVER_LIMITS = Object.freeze({
  max_files: DEFAULT_MAX_FILES,
  max_file_bytes: DEFAULT_MAX_FILE_BYTES,
  max_dirs: DEFAULT_MAX_DIRS,
  deadline_ms: DEFAULT_DEADLINE_MS,
});
