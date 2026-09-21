'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const https = require('node:https');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

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

function runPythonPrompt(script, project, env, payload) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.env.PYTHON_BIN || 'python3', [
      script, 'prompt', '--input-stdin', '--require-input', '--ide', 'codebuddy', '--debug',
    ], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolveResult({ status, signal, stdout, stderr });
    });
    child.stdin.end(JSON.stringify({ ...payload, cwd: project, ide: 'codebuddy' }));
  });
}

test('real Python CodeBuddy stage/invoke shares one bounded foreground notice budget', async () => {
  const repo = resolve(__dirname, '..');
  const script = join(repo, 'skills/trtc/tools/reporting.py');
  const { projectKey } = await import(pathToFileURL(join(repo, 'skills/trtc/runtime/preference.js')));
  const { readNoticeReceipt } = await import(pathToFileURL(join(repo, 'skills/trtc/runtime/control.js')));
  const base = mkdtempSync(join(tmpdir(), 'python-codebuddy-notice-'));
  const project = join(base, 'project');
  const state = join(base, 'state');
  const markerDir = join(project, '.trtc-skill-state');
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(project, 'package.json'), '{}\n');
  writeFileSync(join(markerDir, 'install-mode.json'), JSON.stringify({
    schema_version: 2,
    mode: 'node_v2',
    installer_version: '1.1.0',
    updated_at: new Date().toISOString(),
    install_generation: 'c'.repeat(32),
    install_ides: ['codebuddy'],
    ide_modes: { codebuddy: 'node_v2' },
  }));

  const requests = [];
  const server = https.createServer({
    cert: readFileSync(join(repo, 'tests/reporting-v2/fixtures/tls/localhost-cert.pem')),
    key: readFileSync(join(repo, 'tests/reporting-v2/fixtures/tls/localhost-key.pem')),
  }, (req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.once('end', () => {
      requests.push(...JSON.parse(body).logs.map((log) => log.contents));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    // A real Python process and packaged Node runtime execute both phases.
    // Only the transport destination is replaced by this loopback TLS server;
    // no production endpoint or installed user preference can be reached.
    const env = {
      ...process.env,
      TRTC_PROJECT_DIR: project,
      TRTC_TELEMETRY_STATE_ROOT: state,
      TRTC_TELEMETRY_ENDPOINT: `https://127.0.0.1:${server.address().port}`,
      TRTC_REPORTING: 'on',
      TRTC_PROMPT_REPORTING: 'on',
      TRTC_TELEMETRY_DRY_RUN: '0',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      PYTHONDONTWRITEBYTECODE: '1',
    };
    const key = projectKey(project);
    const noticeSpec = JSON.parse(readFileSync(join(repo, 'skills/trtc/runtime/continuation-notice.json'), 'utf8'));
    let noticeAttempt;
    for (let turn = 1; turn <= 3; turn += 1) {
      const result = await runPythonPrompt(script, project, env, {
        text: turn === 2 ? '请继续集成聊天功能' : `CodeBuddy Python foreground prompt ${turn}`,
        session_id: 'codebuddy-python-notice-session',
        turn_id: `codebuddy-python-notice-turn-${turn}`,
        route_hint: 'trtc-chat', product: 'chat', framework: 'web',
      });
      assert.equal(result.status, 0, JSON.stringify(result));
      assert.equal(result.signal, null, JSON.stringify(result));
      const locale = turn === 1 ? 'en-US' : 'zh-CN';
      const localized = noticeSpec.locales[locale];
      const expected = turn <= 2
        ? `TRTC_REPORTING_NOTICE_REQUIRED_V1\n${localized.body}\n\n**${localized.allow_label}**　　**${localized.deny_label}**\n`
        : '';
      assert.equal(result.stdout.replace(/\r\n/g, '\n'), expected, `turn ${turn}: ${JSON.stringify(result)}`);
      const receipt = readNoticeReceipt(state, key);
      assert.equal(receipt.status, 'valid');
      assert.equal(receipt.value.foreground_attempts, Math.min(turn, 2),
        'stage and invoke must not each consume an attempt for the same foreground turn');
      assert.equal(receipt.value.status, 'awaiting_choice');
      assert.equal(receipt.value.notice_locale, turn === 1 ? 'en-US' : 'zh-CN',
        'recovery language changes on the same receipt, but exhausted prompts do not rewrite it');
      noticeAttempt ||= receipt.value.notice_attempt_id;
      assert.equal(receipt.value.notice_attempt_id, noticeAttempt, 'recovery must retain the same notice');
      assert.equal(requests.filter((event) => event.method === 'prompt').length, turn,
        'each real Prompt must reach the mock endpoint once without a Stop Hook');
    }

    const allowed = await runPythonPrompt(script, project, env, {
      text: '同意继续体验数据上报', control_choice: 'allow',
      session_id: 'codebuddy-python-notice-session', turn_id: 'codebuddy-python-notice-allow',
    });
    assert.equal(allowed.status, 0, JSON.stringify(allowed));
    assert.equal(allowed.stdout.trim(), 'TRTC_REPORTING_ALLOWED_V1', JSON.stringify(allowed));
    assert.equal(requests.filter((event) => event.method === 'prompt').length, 3,
      'privacy choices must not become Prompt events');

    const next = await runPythonPrompt(script, project, env, {
      text: 'CodeBuddy Python foreground after allow',
      session_id: 'codebuddy-python-notice-session', turn_id: 'codebuddy-python-notice-turn-4',
      route_hint: 'trtc-chat', product: 'chat', framework: 'web',
    });
    assert.equal(next.status, 0, JSON.stringify(next));
    assert.equal(next.stdout.trim(), '', JSON.stringify(next));
    const prompts = requests.filter((event) => event.method === 'prompt');
    assert.equal(prompts.length, 4);
    assert.equal(new Set(prompts.map((event) => event.event_id)).size, 4,
      'the two Python phases must send only one logical event per ordinary Prompt');
    assert.equal(readNoticeReceipt(state, key).value.status, 'allowed');
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(base, { recursive: true, force: true });
  }
});
