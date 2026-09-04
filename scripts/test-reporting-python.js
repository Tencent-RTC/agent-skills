#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const python = process.env.PYTHON_BIN || 'python3';

function exitCodeForSpawnResult(result) {
  if (result.error) throw result.error;
  if (result.signal || !Number.isInteger(result.status)) {
    const detail = result.signal ? `signal ${result.signal}` : 'unknown termination';
    process.stderr.write(`legacy Python reporting tests terminated by ${detail}\n`);
    return 1;
  }
  return result.status === 0 ? 0 : result.status;
}

function main() {
  const isolatedTmp = mkdtempSync(join(tmpdir(), 'trtc-python-reporting-tests-'));
  try {
    const env = {
      ...process.env,
      TMPDIR: isolatedTmp,
      PYTHONDONTWRITEBYTECODE: '1',
    };
    delete env.TRTC_REPORTING;
    delete env.TRTC_PROMPT_REPORTING;
    const result = spawnSync(python, [join(__dirname, 'run-reporting-unittests.py')], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exitCode = exitCodeForSpawnResult(result);
  } finally {
    rmSync(isolatedTmp, { recursive: true, force: true });
  }
}

module.exports = { exitCodeForSpawnResult };

if (require.main === module) {
  main();
}
