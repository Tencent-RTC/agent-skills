'use strict';

// Run directly with:
//   node --test scripts/test-codex-attribution-permissions.test.js
// This is an OS-permission regression test, not an fs mock. It installs a
// temporary Python shim + locally built Node bundle, stages through the Hook,
// and then removes write permission from the isolated global telemetry state.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { delimiter, dirname, join, resolve } = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repo = resolve(__dirname, '..');

function input(value) { return Readable.from([Buffer.from(JSON.stringify(value))]); }

function snapshotFiles(root) {
  const files = new Map();
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.set(path, fs.readFileSync(path).toString('base64'));
      else throw new Error(`unexpected non-regular test state entry: ${path}`);
    }
  }
  visit(root);
  return files;
}

function makeReadOnly(root) {
  const originalModes = [];
  function visit(path) {
    const stat = fs.lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), 'test permission changes must not follow a symlink');
    originalModes.push([path, stat.mode & 0o777]);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(path)) visit(join(path, name));
      fs.chmodSync(path, 0o555);
    } else {
      fs.chmodSync(path, 0o444);
    }
  }
  visit(root);
  return () => {
    // Restore ancestors first so cleanup is always possible after failure.
    for (const [path, mode] of originalModes) fs.chmodSync(path, mode);
  };
}

function installedFixture() {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'codex-owner-permissions-')));
  const project = join(base, 'project');
  const state = join(base, 'global-state');
  const skill = join(project, '.codex', 'skills', 'trtc');
  const runtime = join(skill, 'runtime');
  const tools = join(skill, 'tools');
  for (const directory of [runtime, tools, state, join(project, '.trtc-skill-state')]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(join(project, 'package.json'), '{}\n');
  fs.writeFileSync(join(project, '.trtc-skill-state', 'install-mode.json'), JSON.stringify({
    schema_version: 2, mode: 'node_v2', installer_version: '1.1.0',
    updated_at: new Date().toISOString(), install_generation: 'e'.repeat(32),
    install_ides: ['codex'], ide_modes: { codex: 'node_v2' },
  }));
  // A current Codex installation always carries the project binding. Keeping
  // it in this permission fixture ensures the test exercises the same
  // canonical-root path as the shipped Hook rather than the legacy env
  // compatibility fallback.
  fs.writeFileSync(join(project, '.trtc-skill-state', 'host-state-root.json'), JSON.stringify({
    schema_version: 2,
    bindings: { codex: { state_root: state, generation: 'e'.repeat(32), status: 'ready' } },
  }));
  for (const name of ['continuation-notice.json', 'continuation-notice.md']) {
    fs.copyFileSync(join(repo, 'skills/trtc/runtime', name), join(runtime, name));
  }
  fs.copyFileSync(join(repo, 'skills/trtc/tools/reporting.py'), join(tools, 'reporting.py'));
  fs.copyFileSync(join(repo, 'skills/trtc/SKILL.md'), join(skill, 'SKILL.md'));
  // Build only inside the fixture. Never update the tracked bundle as a test
  // side effect, and never accidentally execute a stale committed bundle.
  require('esbuild').buildSync({
    absWorkingDir: repo,
    entryPoints: [join(repo, 'skills/trtc/runtime/telemetry.js')],
    outfile: join(runtime, 'telemetry.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: ['node16'],
    sourcemap: false, legalComments: 'none', charset: 'utf8', logLevel: 'silent',
    define: { 'process.env.TRTC_TELEMETRY_RUNTIME_VERSION': JSON.stringify('1.1.0') },
  });
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`,
    TRTC_PROJECT_DIR: project,
    TRTC_TELEMETRY_STATE_ROOT: state,
    // Every child has an explicit loopback-only destination even if a bug
    // unexpectedly gets past the read-only state. The recovery sender below
    // uses an injected local receiver and cannot contact production either.
    TRTC_TELEMETRY_ENDPOINT: 'https://127.0.0.1:9',
    TRTC_REPORTING: 'on', TRTC_PROMPT_REPORTING: 'on', TRTC_TELEMETRY_DRY_RUN: '0',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  return { base, project, state, env, script: join(tools, 'reporting.py') };
}

function childWithBoundary(fixture, args, body, boundary, executable = process.execPath) {
  let command = executable;
  let childArgs = args;
  if (boundary === 'sandbox') {
    command = '/usr/bin/sandbox-exec';
    const profile = `(version 1)(allow default)(deny file-write* (subpath ${JSON.stringify(fixture.state)}))`;
    childArgs = ['-p', profile, executable, ...args];
  }
  return spawnSync(command, childArgs, {
    cwd: fixture.project, env: fixture.env,
    input: body === null ? undefined : JSON.stringify(body), encoding: 'utf8', timeout: 12000,
  });
}

async function verifyPermissionBoundary(t, boundary) {
  const { runCli } = await import(pathToFileURL(join(repo, 'skills/trtc/runtime/telemetry.js')));
  const { listPending, listOutbox, readEvent } = await import(pathToFileURL(join(repo, 'skills/trtc/runtime/outbox.js')));
  const f = installedFixture();
  const received = [];
  const common = {
    cwd: f.project, stateRoot: f.state, env: f.env,
    resolveSdkAppId: () => ({ status: 'not_found' }),
    flushOptions: {
      _transport: async (_url, body) => {
        received.push(...JSON.parse(body).logs.map((log) => log.contents));
        return { statusCode: 200, body: '{}' };
      },
    },
  };
  let restore = null;
  try {
    const expectedEventIds = [];
    const session = 'codex-permission-real-session';
    const owners = ['trtc-ai-customer-service-skill', 'trtc-ai-realtime-interpreter'];
    for (let turn = 0; turn < owners.length; turn += 1) {
      const text = `Please explain this AI integration, real permission test turn ${turn + 1}`;
      const turnId = `permission-turn-${turn + 1}`;
      // A 90-second-old first Hook is outside the old weak 60s matching
      // window. Matching the same host-thread hash must retain its identity.
      await runCli(['hook', '--ide', 'codex'], {
        ...common,
        now: () => Date.now() - (turn === 0 ? 90000 : 0),
        stdin: input({ prompt: text, session_id: session, turn_id: turnId, cwd: f.project }),
        flushOutbox: async () => { throw new Error('the Hook must not send'); },
      });
      const pending = listPending(f.state).map(readEvent).filter((event) => event.method === 'prompt');
      assert.equal(pending.length, 1, 'each Hook stages one event after the prior turn was ACKed');
      const originalEvent = pending[0];
      expectedEventIds.push(originalEvent.event_id);
      if (turn === 1) {
        // The Hook may crash after Pending is durable but before its stage
        // receipt rename. Reconstruct that missing local receipt even while
        // global state remains read-only; never mint a replacement event.
        const stageDir = join(f.project, '.trtc-skill-state/session-context-v2/stages');
        for (const name of fs.readdirSync(stageDir).filter((entry) => entry.endsWith('.json'))) {
          const path = join(stageDir, name);
          if (JSON.parse(fs.readFileSync(path, 'utf8')).event_id === originalEvent.event_id) fs.unlinkSync(path);
        }
      }
      const globalBefore = snapshotFiles(f.state);
      if (boundary === 'posix') restore = makeReadOnly(f.state);

      const probe = childWithBoundary(f, ['-e', `
        const fs = require('node:fs');
        const path = require('node:path');
        const state = process.env.TRTC_TELEMETRY_STATE_ROOT;
        let denied = false;
        try { fs.writeFileSync(path.join(state, 'must-not-write'), 'forbidden'); }
        catch (error) { if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error; denied = true; }
        if (!denied) process.exit(42);
        fs.writeFileSync(path.join(process.cwd(), 'project-write-probe'), 'allowed');
      `], null, boundary);
      assert.equal(probe.status, 0, `OS boundary must deny global writes and permit project writes: ${JSON.stringify(probe)}`);

      const result = childWithBoundary(f, [
        f.script, 'prompt', '--input-stdin', '--require-input', '--ide', 'codex', '--debug',
      ], {
        text, cwd: f.project, ide: 'codex', host_thread_hint: session,
        route_hint: owners[turn], product: 'ai-service', framework: 'web',
      }, boundary, process.env.PYTHON_BIN || 'python3');
      assert.equal(result.signal, null, JSON.stringify(result));
      assert.ok(result.status === 0 || result.status === 1,
        `read-only state may be retryable, but the foreground child must complete: ${JSON.stringify(result)}`);
      assert.doesNotMatch(result.stdout + result.stderr, /SyntaxError|ModuleNotFoundError|runtime_binding_invalid/);
      assert.deepEqual(snapshotFiles(f.state), globalBefore,
        'the actual restricted Python → Node process must not mutate global telemetry state');
      const stageDir = join(f.project, '.trtc-skill-state/session-context-v2/stages');
      const receipts = fs.readdirSync(stageDir).filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(fs.readFileSync(join(stageDir, name), 'utf8')));
      const matched = receipts.filter((receipt) => receipt.event_id === originalEvent.event_id);
      assert.ok(matched.some((receipt) => receipt.route_hint === owners[turn]),
        `project receipt must persist the explicit owner before a global-state failure: ${JSON.stringify({ result, matched })}`);
      assert.ok(matched.some((receipt) => receipt.product === 'ai-service' && receipt.framework === 'web'));
      assert.deepEqual([...new Set(receipts.map((receipt) => receipt.event_id))].sort(), [...expectedEventIds].sort(),
        'a restricted foreground call must reuse the Hook event rather than create another receipt identity');

      if (restore) { restore(); restore = null; }
      const recovered = await runCli(['host-stop', '--ide', 'codex'], {
        ...common,
        stdin: input({ session_id: session, turn_id: turnId, cwd: f.project }),
      });
      const prompts = received.filter((event) => event.method === 'prompt');
      assert.equal(prompts.length, turn + 1, `legal recovery sends the original Prompt: ${JSON.stringify(recovered)}`);
      assert.equal(prompts[turn].event_id, originalEvent.event_id);
      assert.equal(prompts[turn].level, owners[turn]);
      assert.equal(prompts[turn].type, 'ai-service');
      assert.equal(prompts[turn].framework, 'web');
      assert.equal(listPending(f.state).filter((path) => readEvent(path)?.method === 'prompt').length, 0);
      assert.equal(listOutbox(f.state).filter((path) => readEvent(path)?.method === 'prompt').length, 0);
    }
    assert.equal(new Set(expectedEventIds).size, 2, 'two real Prompt turns retain two distinct original event IDs');
    assert.deepEqual(received.filter((event) => event.method === 'prompt').map((event) => event.event_id), expectedEventIds);
    t.diagnostic('No production network was used; two real Python foreground calls recovered through a mock receiver.');
  } finally {
    if (restore) restore();
    fs.rmSync(f.base, { recursive: true, force: true });
  }
}

test('Codex read-only global state: real Python foreground persists both AI owners locally and recovery keeps their event IDs', async (t) => {
  if (process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() === 0) {
    t.skip('POSIX mode-bit isolation needs an unprivileged non-Windows process; run this test on macOS/Linux as a normal user.');
    return;
  }
  await verifyPermissionBoundary(t, 'posix');
});

test('Codex sandbox-exec read-only global state: real Python foreground preserves owner', async (t) => {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) {
    t.skip('macOS sandbox-exec is not available; the separate POSIX permission test still covers real denied filesystem writes.');
    return;
  }
  const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], {
    encoding: 'utf8', timeout: 3000,
  });
  if (probe.status !== 0) {
    t.skip(`sandbox-exec cannot start inside this host sandbox: ${(probe.stderr || probe.error?.message || `exit ${probe.status}`).trim()}`);
    return;
  }
  await verifyPermissionBoundary(t, 'sandbox');
});
