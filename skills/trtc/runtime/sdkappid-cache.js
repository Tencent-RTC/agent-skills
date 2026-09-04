// sdkappid-cache.js — Local persistent cache for SDKAppID Resolver results.
//
// Lives at <stateRoot>/telemetry/sdkappid-cache.json.
// Never writes to project directory. Never appears on wire.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CACHE_FILE = 'sdkappid-cache.json';
const CACHE_VERSION = 2;
const TTL_NOT_FOUND_MS = 15 * 60 * 1000;
const TTL_CONFLICT_MS = 5 * 60 * 1000;
const MAX_CACHE_BYTES = 256 * 1024;
const MAX_CACHE_ENTRIES = 100;

export function scopeKey(scopeRoot) {
  return createHash('sha256').update(scopeRoot).digest('hex').slice(0, 16);
}

export function cachePath(stateRoot) {
  return join(stateRoot, 'telemetry', CACHE_FILE);
}

export function readCache(stateRoot) {
  const path = cachePath(stateRoot);
  if (!existsSync(path)) return { version: CACHE_VERSION, entries: {} };
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.length > MAX_CACHE_BYTES) return { version: CACHE_VERSION, entries: {} };
    const data = JSON.parse(raw);
    if (data?.version !== CACHE_VERSION) return { version: CACHE_VERSION, entries: {} };
    if (!data.entries || typeof data.entries !== 'object') return { version: CACHE_VERSION, entries: {} };
    return data;
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

export function lookupCache(cache, key, resolverVersion, now = Date.now()) {
  if (!cache?.entries) return null;
  const entry = cache.entries[key];
  if (!entry) return null;
  if (entry.resolverVersion !== resolverVersion) return null;
  if (entry.ttl != null && now > entry.timestamp + entry.ttl) return null;
  return entry;
}

export function updateEntry(cache, key, result, { fingerprint, candidateFingerprint, fingerprintTier, manifestMtime, resolverVersion, scopeManifest, sourcePath }) {
  if (!cache.entries) cache.entries = {};
  const keys = Object.keys(cache.entries);
  if (keys.length >= MAX_CACHE_ENTRIES && !cache.entries[key]) {
    let oldestKey = keys[0];
    let oldestTs = cache.entries[keys[0]]?.timestamp ?? Infinity;
    for (const k of keys) {
      const ts = cache.entries[k]?.timestamp ?? 0;
      if (ts < oldestTs) { oldestTs = ts; oldestKey = k; }
    }
    delete cache.entries[oldestKey];
  }
  const ttl = result.status === 'not_found' ? TTL_NOT_FOUND_MS
    : (result.status === 'conflict' || result.status === 'invalid') ? TTL_CONFLICT_MS
    : null;
  cache.entries[key] = {
    resolverVersion,
    status: result.status,
    sdkappid: result.sdkappid || null,
    source_type: result.source_type || null,
    fingerprint: fingerprint || null,
    candidateFingerprint: candidateFingerprint || null,
    fingerprintTier: fingerprintTier || 3,
    sourcePath: sourcePath || null,
    scopeManifest: scopeManifest || null,
    manifestMtime: manifestMtime || null,
    timestamp: Date.now(),
    ttl,
  };
  return cache;
}

export function writeCache(stateRoot, cache) {
  const path = cachePath(stateRoot);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(cache);
  if (content.length > MAX_CACHE_BYTES) return;
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    try { unlinkSync(tmp); } catch {}
  }
}

export function invalidateEntry(cache, key) {
  if (cache?.entries) delete cache.entries[key];
  return cache;
}
