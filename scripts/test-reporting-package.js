#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');

const PACKAGE_EVIDENCE_SCHEMA_VERSION = 1;
const BUNDLE_PATH = 'skills/trtc/runtime/telemetry.cjs';
const COLD_BUNDLE_PATH = 'skills/trtc/runtime/sdkappid-resolver-web.cjs';
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

function npmCommandFor(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...opts });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function parseArgs(argv) {
  let jsonOutput = null;
  let artifact = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json-output' && argv[index + 1]) {
      jsonOutput = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argv[index] === '--artifact' && argv[index + 1]) {
      artifact = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    const err = new Error('Usage: node scripts/test-reporting-package.js [--artifact <candidate.tgz>] [--json-output <evidence.json>]');
    err.code = 'USAGE';
    throw err;
  }
  return { jsonOutput, artifact };
}

function validateArtifact(path) {
  let stat;
  try { stat = lstatSync(path); }
  catch (err) { err.code = err.code || 'ARTIFACT_INVALID'; throw err; }
  if (!basename(path).endsWith('.tgz') || stat.isSymbolicLink() || !stat.isFile()
      || stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) {
    const err = new Error('Artifact must be a non-empty, finite, regular .tgz file');
    err.code = 'ARTIFACT_INVALID';
    throw err;
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function atomicCreateJson(outputPath, value) {
  if (existsSync(outputPath)) {
    const err = new Error(`Refusing to overwrite existing evidence: ${basename(outputPath)}`);
    err.code = 'OUTPUT_EXISTS';
    throw err;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const tmp = join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    linkSync(tmp, outputPath);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function buildPackageEvidence({ tarball, unpackRoot, repoRoot }) {
  const sourcePackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const artifactPackage = JSON.parse(readFileSync(join(unpackRoot, 'package', 'package.json'), 'utf8'));
  const sourceBundle = join(repoRoot, ...BUNDLE_PATH.split('/'));
  const artifactBundle = join(unpackRoot, 'package', ...BUNDLE_PATH.split('/'));
  const sourceColdBundle = join(repoRoot, ...COLD_BUNDLE_PATH.split('/'));
  const artifactColdBundle = join(unpackRoot, 'package', ...COLD_BUNDLE_PATH.split('/'));
  const evidence = {
    schema_version: PACKAGE_EVIDENCE_SCHEMA_VERSION,
    status: 'passed',
    error_code: null,
    tarball_sha256: sha256File(tarball),
    package_version: artifactPackage.version,
    artifact_bundle_sha256: sha256File(artifactBundle),
    source_bundle_sha256: sha256File(sourceBundle),
    cold_bundle_sha256: sha256File(sourceColdBundle),
  };
  if (artifactPackage.version !== sourcePackage.version) {
    const err = new Error('Packed package version does not match workspace package version');
    err.code = 'PACKAGE_VERSION_MISMATCH';
    throw err;
  }
  if (evidence.artifact_bundle_sha256 !== evidence.source_bundle_sha256) {
    const err = new Error('Packed telemetry bundle does not match workspace telemetry bundle');
    err.code = 'PACKAGE_BUNDLE_MISMATCH';
    throw err;
  }
  if (sha256File(artifactColdBundle) !== evidence.cold_bundle_sha256) {
    const err = new Error('Packed cold bundle does not match workspace cold bundle');
    err.code = 'COLD_BUNDLE_MISMATCH';
    throw err;
  }
  return evidence;
}

function verifyPackage({ repoRoot = resolve(__dirname, '..'), jsonOutput = null, artifact = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'trtc-pack-test-'));
  const cache = join(base, 'npm-cache');
  const packDir = join(base, 'pack');
  const unpackDir = join(base, 'unpack');
  const isolatedDir = join(base, 'isolated');
  mkdirSync(cache, { recursive: true });
  mkdirSync(packDir, { recursive: true });
  mkdirSync(unpackDir, { recursive: true });
  mkdirSync(isolatedDir, { recursive: true });

  try {
    let tarball;
    let artifactName;
    if (artifact) {
      tarball = resolve(artifact);
      validateArtifact(tarball);
      artifactName = basename(tarball);
    } else {
      const packed = run(npmCommandFor(), [
        'pack', '--ignore-scripts', '--json', '--pack-destination', packDir,
      ], {
        cwd: repoRoot,
        env: { ...process.env, npm_config_cache: cache, NPM_CONFIG_CACHE: cache },
      });
      const manifest = JSON.parse(packed.stdout);
      if (!Array.isArray(manifest) || manifest.length !== 1 || typeof manifest[0].filename !== 'string') {
        throw new Error(`Unexpected npm pack JSON: ${packed.stdout}`);
      }
      const listedFiles = new Set((manifest[0].files || []).map((item) => item.path));
      if (!listedFiles.has(BUNDLE_PATH)) throw new Error(`npm package is missing ${BUNDLE_PATH}`);
      if ([...listedFiles].some((name) => name.startsWith('tests/'))) throw new Error('npm package unexpectedly includes tests/');
      tarball = join(packDir, manifest[0].filename);
      artifactName = manifest[0].filename;
    }
    run('tar', ['-xzf', tarball, '-C', unpackDir]);
    const unpackedBundle = join(unpackDir, 'package', ...BUNDLE_PATH.split('/'));
    if (!existsSync(unpackedBundle)) throw new Error(`Unpacked bundle is missing: ${unpackedBundle}`);
    if (existsSync(join(unpackDir, 'package', 'tests'))) throw new Error('npm package unexpectedly includes tests/');

    const evidence = buildPackageEvidence({ tarball, unpackRoot: unpackDir, repoRoot });
    const isolatedBundle = join(isolatedDir, 'telemetry.cjs');
    copyFileSync(unpackedBundle, isolatedBundle);
    const smoke = run(process.execPath, [join(repoRoot, 'scripts', 'telemetry-bundle-smoke.js'), isolatedBundle], {
      cwd: isolatedDir,
      env: { ...process.env, TRTC_TELEMETRY_DRY_RUN: '1' },
    });
    if (jsonOutput) atomicCreateJson(jsonOutput, evidence);
    process.stdout.write(smoke.stdout);
    process.stdout.write(`npm tarball verified: ${artifactName}\n`);
    return evidence;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    verifyPackage(args);
    return 0;
  } catch (err) {
    process.stderr.write(`${err.code || 'PACKAGE_VERIFICATION_FAILED'}: ${err.message}\n`);
    return err.code === 'USAGE' ? 2 : 1;
  }
}

module.exports = {
  BUNDLE_PATH,
  PACKAGE_EVIDENCE_SCHEMA_VERSION,
  MAX_ARTIFACT_BYTES,
  atomicCreateJson,
  buildPackageEvidence,
  main,
  npmCommandFor,
  parseArgs,
  sha256File,
  verifyPackage,
};

if (require.main === module) process.exitCode = main();
