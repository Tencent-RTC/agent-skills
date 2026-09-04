'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { exitCodeForSpawnResult } = require('./test-reporting-python.js');

test('Python reporting wrapper succeeds only for status 0', () => {
  assert.equal(exitCodeForSpawnResult({ status: 0, signal: null }), 0);
  assert.equal(exitCodeForSpawnResult({ status: 7, signal: null }), 7);
});

test('Python reporting wrapper fails when the child is terminated by a signal', () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  try {
    assert.equal(exitCodeForSpawnResult({ status: null, signal: 'SIGKILL' }), 1);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.match(writes.join(''), /SIGKILL/);
});

test('Python reporting wrapper fails for an indeterminate termination', () => {
  const originalWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    assert.equal(exitCodeForSpawnResult({ status: null, signal: null }), 1);
  } finally {
    process.stderr.write = originalWrite;
  }
});
