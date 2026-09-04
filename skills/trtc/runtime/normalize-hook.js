// normalize-hook.js — shared stdin JSON parsing + adapter dispatch for hook adapters.
//
// Each IDE delivers hook input via stdin JSON. This module handles:
//   1. Safe async stdin read (size limit, monotonic deadline, stream cleanup)
//   2. Dispatch to the correct adapter's parse() function
//
// Contract:
//   - readStdinJson and parseAdapter MUST NOT write to stdout or stderr
//   - parseAdapter NEVER throws (fail-open → null)
//   - C9 owns the no-op JSON output and exit code

import { performance } from 'node:perf_hooks';

import { parse as parseClaude } from './adapters/claude.js';
import { parse as parseCodebuddy } from './adapters/codebuddy.js';
import { parse as parseCodex } from './adapters/codex.js';
import { parse as parseCursor } from './adapters/cursor.js';
import { parse as parseGemini } from './adapters/gemini.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HOOK_TOTAL_BUDGET_MS = 45;
const DEFAULT_STDIN_BUDGET_MS = 20;
const DEFAULT_MAX_BYTES = 128 * 1024;

// ---------------------------------------------------------------------------
// readStdinJson
// ---------------------------------------------------------------------------

/**
 * Read and parse JSON from a Readable stream (default: process.stdin).
 *
 * Returns the parsed object or `null` on any failure (timeout, oversize,
 * non-JSON, JSON root not a plain object, stream error, empty input).
 *
 * Guarantees: all listeners and timers are cleaned up on ALL exit paths.
 * On timeout/oversize the stream is paused+destroyed to ensure the Node
 * process can exit cleanly (a resumed stdin holds the event loop).
 *
 * @param {object} [opts]
 * @param {Readable} [opts.stream]       default process.stdin
 * @param {number}   [opts.maxBytes]     default 128KB
 * @param {number}   [opts.deadlineMono] performance.now() deadline;
 *   if omitted, defaults to now + DEFAULT_STDIN_BUDGET_MS (20ms).
 *   C9 MUST pass the shared hook deadline; default is a safety net.
 * @returns {Promise<object|null>}
 */
export function readStdinJson(opts = {}) {
  const stream = opts.stream ?? process.stdin;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const deadlineMono = opts.deadlineMono ?? (performance.now() + DEFAULT_STDIN_BUDGET_MS);

  return new Promise((resolve) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    let timer = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      try { stream.pause(); } catch { /* ignore */ }
      if (result === null && !stream.destroyed) {
        try { stream.destroy(); } catch { /* ignore */ }
      }
      resolve(result);
    }

    function onData(chunk) {
      // Accumulate raw Buffers to avoid UTF-8 multi-byte split corruption.
      // String chunks (from Readable.from) are converted to Buffer first.
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        finish(null);
        return;
      }
      chunks.push(buf);
    }

    function onEnd() {
      if (totalBytes === 0) { finish(null); return; }
      // Single decode point: Buffer.concat then toString('utf8') ensures
      // multi-byte UTF-8 sequences spanning chunk boundaries are decoded
      // correctly (no U+FFFD for split 中文/emoji bytes).
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try { parsed = JSON.parse(raw); } catch { finish(null); return; }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        finish(null);
        return;
      }
      finish(parsed);
    }

    function onError() { finish(null); }

    // Check remaining budget BEFORE setting up listeners. If deadline
    // already passed, resolve null immediately without referencing timer.
    const remainingMs = Math.max(0, deadlineMono - performance.now());
    if (remainingMs <= 0) { finish(null); return; }

    timer = setTimeout(() => finish(null), remainingMs);

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);

    if (stream.readableEnded) {
      onEnd();
      return;
    }
    stream.resume();
  });
}

// ---------------------------------------------------------------------------
// parseAdapter
// ---------------------------------------------------------------------------

const ADAPTERS = {
  claude: parseClaude,
  codebuddy: parseCodebuddy,
  codex: parseCodex,
  cursor: parseCursor,
  gemini: parseGemini,
};

/**
 * Dispatch to the correct IDE adapter and return the normalized hook shape.
 *
 * NEVER throws. Returns null on:
 *   - unknown IDE
 *   - input not a plain object
 *   - adapter returns null (malformed input)
 *   - adapter throws (defensive catch)
 *
 * @param {string} ide
 * @param {object} input — parsed stdin JSON
 * @returns {NormalizedHook|null}
 */
export function parseAdapter(ide, input) {
  try {
    if (!ide || typeof ide !== 'string') return null;
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
    const adapter = ADAPTERS[ide];
    if (!adapter) return null;
    return adapter(input);
  } catch {
    return null;
  }
}
