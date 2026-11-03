// platform-memory.js — Lightweight, project+product scoped platform memory.
//
// Lives at <stateRoot>/telemetry/platform-memory.json.
// Never writes to the project directory. Never appears on wire.
//
// Why this exists: the dispatcher knows the customer platform only when the
// current turn happens to mention it, so a multi-turn conversation that
// stops repeating "Android" on every prompt would otherwise degrade the
// whole thread to `framework=unknown`. Continuity is scoped by product on
// purpose — a project may legitimately use Chat on Android and Conference
// on Web, and neither may leak into the other.
//
// Two sources feed the fallback chain, most authoritative first:
//   1. `.trtc-session.yaml` `platform` — formally declared by the guided
//      integration flow (see tools/session.py VALID_PLATFORMS).
//   2. This memory file — the last platform the runtime actually observed
//      for this project+product pair.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MEMORY_FILE = 'platform-memory.json';
const MEMORY_VERSION = 1;
const MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MEMORY_BYTES = 256 * 1024;
const MAX_MEMORY_ENTRIES = 200;
const SESSION_FILENAME = '.trtc-session.yaml';

// Mirrors tools/session.py VALID_PLATFORMS. Session values outside this set
// are never valid, so they are ignored rather than trusted.
const SESSION_PLATFORMS = new Set(['web', 'android', 'ios', 'flutter', 'electron', 'unity']);

// `unknown` means "not identified yet" and `n-a` means "this question has no
// platform dimension at all". Neither describes a project's platform, so
// neither is ever persisted — otherwise `n-a` would poison later turns that
// legitimately need the real platform.
const NON_PLATFORM_VALUES = new Set(['unknown', 'n-a']);

export function memoryPath(stateRoot) {
  return join(stateRoot, 'telemetry', MEMORY_FILE);
}

export function isStorableFramework(value) {
  if (typeof value !== 'string') return false;
  const framework = value.trim();
  return !!framework && !NON_PLATFORM_VALUES.has(framework);
}

export function memoryKey(projectKeyValue, product) {
  return `${projectKeyValue}:${product}`;
}

export function readMemory(stateRoot) {
  const path = memoryPath(stateRoot);
  if (!existsSync(path)) return { version: MEMORY_VERSION, entries: {} };
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.length > MAX_MEMORY_BYTES) return { version: MEMORY_VERSION, entries: {} };
    const data = JSON.parse(raw);
    if (data?.version !== MEMORY_VERSION) return { version: MEMORY_VERSION, entries: {} };
    if (!data.entries || typeof data.entries !== 'object') return { version: MEMORY_VERSION, entries: {} };
    return data;
  } catch {
    return { version: MEMORY_VERSION, entries: {} };
  }
}

export function writeMemory(stateRoot, memory) {
  const path = memoryPath(stateRoot);
  const content = JSON.stringify(memory);
  if (content.length > MAX_MEMORY_BYTES) return false;
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return false;
  }
}

/** Last platform observed for this project+product, or null when absent/expired. */
export function recallFramework(stateRoot, projectKeyValue, product, now = Date.now()) {
  if (!projectKeyValue || !product || NON_PLATFORM_VALUES.has(product)) return null;
  const entry = readMemory(stateRoot).entries?.[memoryKey(projectKeyValue, product)];
  if (!entry || typeof entry.framework !== 'string') return null;
  if (!isStorableFramework(entry.framework)) return null;
  if (typeof entry.updated_at !== 'number') return null;
  if (now > entry.updated_at + MEMORY_TTL_MS) return null;
  return entry.framework;
}

/**
 * Record a platform for this project+product. A different platform in a later
 * turn always overwrites the previous one. Returns true when the file changed.
 */
export function rememberFramework(stateRoot, projectKeyValue, product, framework, opts = {}) {
  if (!projectKeyValue || !product || NON_PLATFORM_VALUES.has(product)) return false;
  if (!isStorableFramework(framework)) return false;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const source = typeof opts.source === 'string' ? opts.source : 'dispatcher';
  const memory = readMemory(stateRoot);
  if (!memory.entries) memory.entries = {};
  const key = memoryKey(projectKeyValue, product);
  const existing = memory.entries[key];
  // Idempotent refresh: rewriting the same live value would churn the file on
  // every single turn for no benefit.
  if (existing && existing.framework === framework && now <= (existing.updated_at ?? 0) + MEMORY_TTL_MS) {
    return false;
  }
  const keys = Object.keys(memory.entries);
  if (keys.length >= MAX_MEMORY_ENTRIES && !memory.entries[key]) {
    let oldestKey = keys[0];
    let oldestTs = memory.entries[keys[0]]?.updated_at ?? Infinity;
    for (const candidate of keys) {
      const ts = memory.entries[candidate]?.updated_at ?? 0;
      if (ts < oldestTs) { oldestTs = ts; oldestKey = candidate; }
    }
    delete memory.entries[oldestKey];
  }
  memory.entries[key] = { framework, source, updated_at: now };
  return writeMemory(stateRoot, memory);
}

/**
 * Read only top-level scalars from `.trtc-session.yaml`.
 *
 * The runtime is dependency-free and must stay that way, so this is a
 * deliberately minimal reader: it looks at unindented `key: value` lines and
 * ignores lists, blocks, nested keys and comments. It is used for one hint
 * (`platform`) and, when present, one scope check (`product`).
 */
function readTopLevelScalars(text, wanted) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || /^\s/.test(line) || line.startsWith('#') || line.startsWith('---')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!wanted.includes(key)) continue;
    let value = line.slice(separator + 1).trim();
    value = value.replace(/\s+#.*$/, '');
    if (value.length >= 2) {
      const first = value[0];
      if ((first === '"' || first === "'") && value.endsWith(first)) value = value.slice(1, -1);
    }
    if (value) out[key] = value.trim();
  }
  return out;
}

/**
 * The platform formally declared by the guided integration flow, or null.
 * Never throws: a malformed or missing session simply yields no hint.
 */
export function readSessionPlatform(projectRoot) {
  if (!projectRoot) return null;
  let text;
  try {
    text = readFileSync(join(projectRoot, SESSION_FILENAME), 'utf8');
  } catch {
    return null;
  }
  const scalars = readTopLevelScalars(text, ['platform', 'product']);
  const platform = scalars.platform;
  if (!platform || !SESSION_PLATFORMS.has(platform)) return null;
  return { platform, product: scalars.product || null };
}

/**
 * Continuity lookup: session first, then memory. Returns
 * `{ framework, source }` or null when neither knows the platform for this
 * project+product. Callers use `source` to decide whether the value is
 * trustworthy enough to persist.
 *
 * A session `product` that disagrees with the current product means the
 * session describes a different integration, so it is not carried over.
 */
export function resolveFrameworkContinuity({ projectRoot, stateRoot, projectKeyValue, product, now = Date.now() }) {
  if (!product || NON_PLATFORM_VALUES.has(product)) return null;
  const session = readSessionPlatform(projectRoot);
  if (session && (!session.product || session.product === product)) {
    return { framework: session.platform, source: 'session' };
  }
  const remembered = recallFramework(stateRoot, projectKeyValue, product, now);
  return remembered ? { framework: remembered, source: 'memory' } : null;
}
