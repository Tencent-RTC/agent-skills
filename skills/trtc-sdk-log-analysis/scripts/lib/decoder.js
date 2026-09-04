import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function hasVendoredDecoder(vendorDir) {
  // Pure-TypeScript vendor: package.json + dist CLI entry.
  return fs.existsSync(path.join(vendorDir, 'package.json'))
    && fs.existsSync(path.join(vendorDir, 'dist', 'cjs', 'node', 'cli.js'));
}

export function resolveDecoderCommand({ skillDir, env = process.env } = {}) {
  if (!skillDir) throw new Error('resolveDecoderCommand requires skillDir');

  if (env.CLOG_DECODER_BIN) {
    const configured = String(env.CLOG_DECODER_BIN).trim();
    if (!path.isAbsolute(configured)) {
      throw new Error('CLOG_DECODER_BIN must be an absolute path to a trusted local decoder');
    }
    if (!fs.existsSync(configured) || !fs.statSync(configured).isFile()) {
      throw new Error(`CLOG_DECODER_BIN does not point to a local file: ${configured}`);
    }
    return {
      mode: 'custom-bin',
      command: configured,
      args: [],
      description: 'CLOG_DECODER_BIN override',
    };
  }

  const vendorDir = path.join(skillDir, 'vendor', 'clog-decoder');
  if (hasVendoredDecoder(vendorDir)) {
    return {
      mode: 'vendored',
      command: process.execPath,
      args: [path.join(vendorDir, 'dist', 'cjs', 'node', 'cli.js')],
      description: 'vendored TypeScript decoder',
    };
  }

  return {
    mode: 'unavailable',
    command: null,
    args: [],
    description: 'no trusted local decoder configured',
  };
}

export function decodeFile(inputPath, outputPath, { skillDir, env = process.env, timeoutMs } = {}) {
  const resolved = resolveDecoderCommand({ skillDir, env });
  if (resolved.mode === 'unavailable') {
    throw new Error(
      '未找到可信的本地 .clog/.xlog decoder。请提供解码后的 .log/.txt，或配置 CLOG_DECODER_BIN 后重试；不会自动通过 npx 下载 decoder。',
    );
  }
  const result = spawnSync(resolved.command, [...resolved.args, inputPath, outputPath], {
    env,
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  if (result.error) {
    throw new Error(`clog decode failed (${resolved.mode}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`clog decode failed (${resolved.mode}, exit ${result.status}): ${details}`);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`clog decode produced empty output: ${outputPath}`);
  }
  return { ...resolved, outputPath };
}
