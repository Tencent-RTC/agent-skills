#!/usr/bin/env node
'use strict';

// Retain the exact candidate and evidence. Protocol tests deliberately do not
// attest that a real IDE rendered a notice or classified natural language.
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, 'dist', 'privacy-tests', stamp + '-' + randomBytes(3).toString('hex'));
fs.mkdirSync(output, { recursive: true });
const report = {
  schema_version: 1, started_at: new Date().toISOString(), output,
  host: { platform: process.platform, arch: process.arch, node: process.version },
  stages: [], real_ide_ui: { status: 'not_run', reason: 'Requires real IDE interaction and independent evidence.' },
};
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function run(name, command, args, env = process.env, timeoutMs = 180_000) {
  console.log('开始检查：' + name);
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(path.join(output, name + '.log'));
    const started = Date.now();
    const child = spawn(command, args, { cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', spawnError;
    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* already exited */ }
    }, timeoutMs);
    child.stdout.on('data', (v) => { stdout += v; log.write(v); });
    child.stderr.on('data', (v) => log.write(v));
    child.once('error', (err) => { spawnError = err; log.write(String(err)); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      log.end(() => {
        const counts = {};
        for (const key of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
          const match = stdout.match(new RegExp('^# ' + key + ' (\\d+)', 'm'));
          if (match) counts[key] = Number(match[1]);
        }
        report.stages.push({ name, status: code === 0 && !spawnError ? 'passed' : 'failed',
          exit_code: code, signal, duration_ms: Date.now() - started, log: name + '.log', ...counts });
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, status: 'running' }, null, 2) + '\n');
        console.log(`${name}：${code === 0 && !spawnError ? '通过' : '失败'}${counts.tests ? ` (${counts.pass}/${counts.tests})` : ''}`);
        if (code !== 0 || spawnError) reject(new Error(name + ' failed; see ' + path.join(output, name + '.log')));
        else resolve(stdout);
      });
    });
  });
}

function save() {
  report.finished_at = new Date().toISOString();
  report.status = report.stages.length === 6 && report.stages.every((v) => v.status === 'passed') ? 'passed' : 'failed';
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = ['# 严格隐私自动测试', '', `结果：${report.status}`, '',
    `分支：${report.branch || 'unknown'}；基础提交：${report.head || 'unknown'}；工作区含未提交改动：${report.dirty}`, '',
    `测试包：${report.artifact || '未生成'}`, '', `SHA-256：${report.artifact_sha256 || '未生成'}`, '',
    '| 检查 | 结果 | 日志 |', '| --- | --- | --- |',
    ...report.stages.map((v) => `| ${v.name} | ${v.status} | [日志](${v.log}) |`), '',
    '## 验证范围', '',
    '四个 IDE 的实际安装器、安装后 Hook、前台 Python 入口、运行时和本地 HTTPS 请求。', '',
    '同意/拒绝/模糊回复的协议测试显式传入分类；不能证明真实模型正确理解自然语言，也不能证明聊天窗口展示提示。', '',
    '真实 IDE 界面结果需另附截图、聊天记录与接收器记录；本报告默认标记为未运行。', '',
    '本命令是本次隐私改动的定向回归，不代表完整发布门禁通过。', ''];
  fs.writeFileSync(path.join(output, 'report.md'), lines.join('\n'));
}

async function main() {
  console.log('测试产物目录：' + output);
  const source = await run('source', 'git', ['status', '--porcelain']);
  report.dirty = Boolean(source.trim());
  // Read-only metadata, separate from the counted test stages.
  const { execFileSync } = require('node:child_process');
  report.branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  await run('build', process.execPath, ['scripts/build-telemetry.js']);
  report.bundle_sha256 = sha(path.join(root, 'skills/trtc/runtime/telemetry.cjs'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packOutput = await run('pack', npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', output]);
  const packed = JSON.parse(packOutput);
  report.artifact = path.join(output, packed[0].filename);
  report.artifact_sha256 = sha(report.artifact);
  const unitOutput = await run('consent', process.execPath, ['--test', '--test-concurrency=1',
    'tests/reporting-v2/unit/test_strict_consent.js', 'tests/reporting-v2/unit/test_notice_locale.js',
    'tests/reporting-v2/unit/test_codex_storage.js']);
  const regressionOutput = await run('regression', process.execPath, ['--test', '--test-concurrency=1', ...[
    'schema', 'redact', 'outbox', 'state', 'sender',
  ].map((name) => `tests/reporting-v2/unit/test_${name}.js`)]);
  const e2eOutput = await run('installed-package', process.execPath, ['--test', '--test-concurrency=1',
    'tests/reporting-v2/e2e/test_strict_consent_tarball.js',
    'tests/reporting-v2/e2e/test_codex_sandbox_spool.js'], {
    ...process.env, TRTC_C14_ARTIFACT: report.artifact, TRTC_C14_ARTIFACT_SHA256: report.artifact_sha256,
  }, 300_000);
  report.test_count = [unitOutput, regressionOutput, e2eOutput].reduce((n, value) =>
    n + Number(value.match(/^# tests (\d+)/m)?.[1] || 0), 0);
}

main().catch((error) => { report.error = String(error); process.exitCode = 1; })
  .finally(() => { save(); console.log('测试报告：' + path.join(output, 'report.md')); });
