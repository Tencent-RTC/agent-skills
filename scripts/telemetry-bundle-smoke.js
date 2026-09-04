#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join, resolve } = require('node:path');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

const argv = process.argv.slice(2);
const bundle = resolve(argv[0] || '');
const requiredMajorIndex = argv.indexOf('--require-node-major');
const requiredMajor = requiredMajorIndex >= 0 ? argv[requiredMajorIndex + 1] : null;
if (basename(bundle) !== 'telemetry.cjs') fail(`Expected telemetry.cjs, got ${basename(bundle)}`);
if (requiredMajor && process.versions.node.split('.')[0] !== requiredMajor) {
  fail(`Expected Node ${requiredMajor}, running ${process.versions.node}`);
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bundle, ...args], {
    encoding: 'utf8',
    ...options,
    env: {
      ...process.env,
      TRTC_REPORTING: 'on',
      TRTC_PROMPT_REPORTING: 'on',
      TRTC_TELEMETRY_DRY_RUN: '1',
      ...(options.env || {}),
    },
  });
  assert(result.status === 0, `${args[0]} exited ${result.status}: ${result.stderr}`);
  assert(result.stderr === '', `${args[0]} wrote stderr: ${result.stderr}`);
  if (args[0] === 'hook') {
    assert(result.stdout === '', `Hook protocol mismatch: ${JSON.stringify(result.stdout)}`);
    return { result, parsed: {} };
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { fail(`${args[0]} returned invalid JSON: ${result.stdout}`); }
  return { result, parsed };
}

const base = mkdtempSync(join(tmpdir(), 'trtc-bundle-smoke-'));
const project = join(base, 'project');
const state = join(base, 'state');
mkdirSync(project, { recursive: true });
writeFileSync(join(project, 'package.json'), '{}');

try {
  const common = ['--state-root', state, '--cwd', project];
  const hook = run(['hook', '--ide', 'claude', ...common], {
    cwd: project,
    input: JSON.stringify({
      prompt: 'bundle smoke 你好 password="my secret value"\nAuthorization: Basic dXNlcjpwYXNz，status=401 request_id=req-1',
      session_id: 'bundle-smoke',
      cwd: project,
    }),
  });
  assert(hook.result.stdout === '', `Hook protocol mismatch: ${JSON.stringify(hook.result.stdout)}`);

  const pendingDir = join(state, 'telemetry', 'pending');
  const pending = readdirSync(pendingDir).filter((name) => name.endsWith('.json'));
  assert(pending.length === 1, `Expected one pending event, got ${pending.length}`);
  const eventId = pending[0].slice(0, -'.json'.length);
  const pendingEvent = JSON.parse(readFileSync(join(pendingDir, pending[0]), 'utf8'));
  assert(!pendingEvent.text.includes('my secret value'), 'R5 secret leaked from bundle Hook');
  assert(!pendingEvent.text.includes('dXNlcjpwYXNz'), 'R14 credential leaked from bundle Hook');
  assert(pendingEvent.text.includes('password="[REDACTED]"'), 'R5 bundle output mismatch');
  assert(pendingEvent.text.includes('Authorization: Basic [REDACTED]'), 'R14 bundle output mismatch');
  assert(pendingEvent.text.includes('，status=401 request_id=req-1'), 'R14 swallowed bundle diagnostics');

  const invoked = run([
    'invoke', '--skillname', 'trtc-chat', '--product', 'chat', '--event-id', eventId, ...common,
  ], { cwd: project });
  assert(['promoted', 'deduped'].includes(invoked.parsed.status), `Invoke failed: ${JSON.stringify(invoked.parsed)}`);

  const legacy = run(['send', ...common], {
    cwd: project,
    input: JSON.stringify({
      event_id: 'legacy_bundle_smoke', method: 'prompt', text: 'legacy bundle smoke',
      skillname: 'trtc', product: 'chat',
    }),
  });
  assert(['queued', 'deduped'].includes(legacy.parsed.status), `Legacy send failed: ${JSON.stringify(legacy.parsed)}`);

  const invalidEvent = run(['event', '--text', 'not_a_real_event', ...common], { cwd: project });
  assert(invalidEvent.parsed.status === 'invalid', 'Unknown event type was accepted');

  const preference = run(['preference', '--enabled', 'on', ...common], { cwd: project });
  assert(preference.parsed.enabled === true, 'Preference command failed');

  process.stdout.write(`telemetry bundle smoke passed on Node ${process.versions.node}\n`);
} finally {
  rmSync(base, { recursive: true, force: true });
}
