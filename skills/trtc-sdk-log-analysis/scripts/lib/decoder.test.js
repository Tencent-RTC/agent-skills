import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveDecoderCommand } from './decoder.js';

test('does not download a decoder when no trusted local decoder exists', () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trtc-decoder-empty-'));
  assert.equal(resolveDecoderCommand({ skillDir, env: {} }).mode, 'unavailable');
});

test('rejects a relative CLOG_DECODER_BIN override', () => {
  assert.throws(
    () => resolveDecoderCommand({ skillDir: process.cwd(), env: { CLOG_DECODER_BIN: 'decoder' } }),
    /absolute path/,
  );
});

test('accepts an existing absolute decoder file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trtc-decoder-file-'));
  const decoder = path.join(dir, 'decoder');
  fs.writeFileSync(decoder, '#!/bin/sh\n', 'utf8');
  const resolved = resolveDecoderCommand({
    skillDir: process.cwd(),
    env: { CLOG_DECODER_BIN: decoder },
  });
  assert.equal(resolved.mode, 'custom-bin');
  assert.equal(resolved.command, decoder);
});
