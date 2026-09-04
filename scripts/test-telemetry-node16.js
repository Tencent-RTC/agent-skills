#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const bundle = join(repoRoot, 'skills', 'trtc', 'runtime', 'telemetry.cjs');
const coldBundle = join(repoRoot, 'skills', 'trtc', 'runtime', 'sdkappid-resolver-web.cjs');
const smoke = join(repoRoot, 'scripts', 'telemetry-bundle-smoke.js');
const currentMajor = process.versions.node.split('.')[0];
const node16 = process.env.NODE16_BIN || (currentMajor === '16' ? process.execPath : null);

if (!node16) {
  process.stderr.write('NODE16_BIN is required: C10 must run the committed bundle with a real Node 16 binary\n');
  process.exit(1);
}

const probe = spawnSync(node16, ['-p', 'process.versions.node'], { encoding: 'utf8' });
if (probe.status !== 0) {
  process.stderr.write(`Unable to execute NODE16_BIN=${node16}: ${probe.stderr || probe.error || ''}\n`);
  process.exit(1);
}
const version = probe.stdout.trim();
if (version.split('.')[0] !== '16') {
  process.stderr.write(`NODE16_BIN must be Node 16; received ${version}\n`);
  process.exit(1);
}

// ── Smoke: telemetry.cjs ──────────────────────────────────────────────────────
const result = spawnSync(node16, [smoke, bundle, '--require-node-major', '16'], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, NODE16_BIN: node16 },
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);
process.stdout.write(`verified telemetry.cjs with Node ${version}\n`);

// ── Smoke: sdkappid-resolver-web.cjs (cold bundle) ───────────────────────────
if (!existsSync(coldBundle)) {
  process.stderr.write(`Cold bundle missing: ${coldBundle}\n`);
  process.exit(1);
}

// Inline smoke: require the cold bundle, call extract(), verify shape
const coldSmokeScript = `
'use strict';
const path = require('node:path');
const adapter = require(${JSON.stringify(coldBundle)});
if (typeof adapter.extract !== 'function') {
  throw new Error('cold bundle must export extract() function, got: ' + typeof adapter.extract);
}
if (typeof adapter.WEB_ADAPTER_VERSION !== 'string') {
  throw new Error('cold bundle must export WEB_ADAPTER_VERSION string');
}
// Verify extract() works on a simple TypeScript source (R01)
const rTs = adapter.extract({ source: 'TUIKit.init({ SDKAppID: 1400009901 });', relativePath: 'main.ts', ext: '.ts', byteLength: 40 });
if (!rTs || rTs.status !== 'ok') throw new Error('cold bundle TS extract() failed: ' + JSON.stringify(rTs));
if (!rTs.candidates.some(c => c.sdkappid === '1400009901')) throw new Error('cold bundle did not find SDKAppID in TS: ' + JSON.stringify(rTs.candidates));
process.stdout.write('cold bundle TypeScript (R01) OK\\n');
// Verify Vue SFC extract() works (exercises @vue/compiler-sfc + compiler-dom on Node 16)
const vueSrc = '<template><TUIKit :SDKAppID=\\"1400009902\\" /></template>\\n<script setup>\\nconst x = 1;\\n</script>';
const rVue = adapter.extract({ source: vueSrc, relativePath: 'App.vue', ext: '.vue', byteLength: vueSrc.length });
if (!rVue || rVue.status !== 'ok') throw new Error('cold bundle Vue extract() failed: ' + JSON.stringify(rVue));
if (!rVue.candidates.some(c => c.sdkappid === '1400009902')) throw new Error('cold bundle did not find SDKAppID in Vue: ' + JSON.stringify(rVue.candidates));
process.stdout.write('cold bundle Vue SFC (R02) OK\\n');
`;

const tmp = mkdtempSync(join(tmpdir(), 'trtc-cold-smoke-'));
const scriptPath = join(tmp, 'cold-smoke.js');
try {
  writeFileSync(scriptPath, coldSmokeScript);
  const coldResult = spawnSync(node16, [scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE16_BIN: node16 },
  });
  process.stdout.write(coldResult.stdout || '');
  process.stderr.write(coldResult.stderr || '');
  if (coldResult.status !== 0) {
    process.stderr.write(`Cold bundle smoke failed with Node ${version}\n`);
    process.exit(coldResult.status || 1);
  }
  process.stdout.write(`verified sdkappid-resolver-web.cjs with Node ${version}\n`);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

