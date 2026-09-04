#!/usr/bin/env node
'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const esbuild = require('esbuild');

const repoRoot   = resolve(__dirname, '..');
const pkgVersion = require(join(repoRoot, 'package.json')).version || '0.0.0';
const checkOnly  = process.argv.includes('--check');

// ── Bundle specs ─────────────────────────────────────────────────────────────

const BUNDLES = [
  {
    name: 'telemetry',
    entry:   join(repoRoot, 'skills', 'trtc', 'runtime', 'telemetry.js'),
    outfile: join(repoRoot, 'skills', 'trtc', 'runtime', 'telemetry.cjs'),
    warnSizeBytes: 1024 * 1024,
    // telemetry.cjs must NOT include Babel or Vue packages
    forbiddenInputPatterns: ['@babel/', '@vue/'],
    define: { 'process.env.TRTC_TELEMETRY_RUNTIME_VERSION': JSON.stringify(pkgVersion) },
    plugins: [],
  },
  {
    name: 'web-adapter',
    entry:   join(repoRoot, 'skills', 'trtc', 'runtime', 'sdkappid-resolver-web.js'),
    outfile: join(repoRoot, 'skills', 'trtc', 'runtime', 'sdkappid-resolver-web.cjs'),
    warnSizeBytes: 4 * 1024 * 1024,
    forbiddenInputPatterns: [],  // Babel/Vue are expected here
    define: {},
    // @vue/compiler-sfc bundles consolidate.js which has optional requires for
    // ~40 template engines (velocityjs, pug, handlebars, etc.) that are never
    // installed. These are exhaustively listed here to avoid brittle plugin logic.
    external: [
      'velocityjs','dustjs-linkedin','atpl','liquor','twig','ejs','eco','jazz',
      'jqtpl','hamljs','hamlet','whiskers','haml-coffee','hogan.js','templayed',
      'handlebars','underscore','lodash','walrus','mustache','just','ect','mote',
      'toffee','dot','bracket-template','ractive','htmling','babel-core','plates',
      'react-dom/server','react','vash','slm','marko','teacup/lib/express',
      'coffee-script','squirrelly','twing',
      // additional packages discovered via metafile scan:
      'tinyliquid','liquid-node','jade','then-jade','dust','dustjs-helpers',
      'swig','swig-templates','razor-tmpl','pug','then-pug','qejs','nunjucks',
      'arc-templates/dist/es5',
      // @babel/traverse optional color support
      'supports-color',
    ],
    plugins: [],
  },
];

// Node built-ins that may appear without the node: prefix in older bundles
const NODE_BUILTINS = new Set([
  'fs','path','url','util','process','vm','crypto','os','stream','events',
  'buffer','http','https','net','child_process','readline','zlib','tls','dns',
  'dgram','cluster','module','assert','perf_hooks','worker_threads','async_hooks',
  'v8','inspector','timers','string_decoder','constants','punycode','querystring',
  'domain','sys','tty',
]);

// ── Per-bundle build + validate ───────────────────────────────────────────────

async function buildOne(spec) {
  const result = await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints:   [spec.entry],
    outfile:        spec.outfile,
    bundle:         true,
    platform:       'node',
    format:         'cjs',
    target:         ['node16'],
    sourcemap:      false,
    legalComments:  'none',
    charset:        'utf8',
    metafile:       true,
    write:          false,
    logLevel:       'silent',
    define:         spec.define,
    plugins:        spec.plugins || [],
    external:       spec.external || [],
  });

  if (!Array.isArray(result.outputFiles) || result.outputFiles.length !== 1) {
    throw new Error(`${spec.name}: build must produce exactly one file; got ${result.outputFiles?.length ?? 0}`);
  }

  // Non-node external imports check — intentionally externalized packages are allowed
  const allowedExternals = new Set(spec.external || []);
  const invalidExternals = [];
  for (const output of Object.values(result.metafile?.outputs || {})) {
    for (const imported of output.imports || []) {
      if (!imported.external) continue;
      const p = imported.path;
      if (p.startsWith('node:') || NODE_BUILTINS.has(p)) continue;
      if (allowedExternals.has(p)) continue;
      invalidExternals.push(p);
    }
  }
  if (invalidExternals.length > 0) {
    throw new Error(`${spec.name}: bundle has non-Node external imports: ${[...new Set(invalidExternals)].join(', ')}`);
  }

  // Forbidden input check (metafile-based, not string search)
  if (spec.forbiddenInputPatterns.length > 0) {
    const inputs = Object.keys(result.metafile?.inputs || {});
    const forbidden = inputs.filter(p => spec.forbiddenInputPatterns.some(pat => p.includes(pat)));
    if (forbidden.length > 0) {
      throw new Error(
        `${spec.name}: bundle must not include these inputs: ${forbidden.join(', ')}\n` +
        `(Pattern match: ${spec.forbiddenInputPatterns.join(', ')})`
      );
    }
  }

  const contents = Buffer.from(result.outputFiles[0].contents);
  if (contents.byteLength > spec.warnSizeBytes) {
    process.stderr.write(`warning: ${spec.name} bundle is ${(contents.byteLength / 1024).toFixed(1)} KiB (> ${spec.warnSizeBytes / 1024} KiB)\n`);
  }

  return contents;
}

function sha256hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function atomicWrite(outfile, contents) {
  const tmp = join(dirname(outfile), `.${require('node:path').basename(outfile)}-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, contents, { flag: 'wx', mode: 0o644 });
    renameSync(tmp, outfile);
  } finally {
    try { unlinkSync(tmp); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Build ALL bundles before writing any (staged build → publish-time consistency)
  const built = [];
  for (const spec of BUNDLES) {
    const contents = await buildOne(spec);
    built.push({ spec, contents });
    process.stdout.write(`validated ${spec.name} (${contents.byteLength} bytes  sha256=${sha256hex(contents).slice(0, 16)}...)\n`);
  }

  if (checkOnly) {
    for (const { spec, contents } of built) {
      if (!existsSync(spec.outfile)) throw new Error(`Committed bundle is missing: ${spec.outfile}`);
      const committed = readFileSync(spec.outfile);
      if (!committed.equals(contents)) {
        throw new Error(`Committed ${spec.name} bundle is stale; run npm run build:telemetry and commit the result`);
      }
      process.stdout.write(`${spec.name} bundle is current (${contents.byteLength} bytes)\n`);
    }
    return;
  }

  // All validated → write all
  for (const { spec, contents } of built) {
    atomicWrite(spec.outfile, contents);
    process.stdout.write(`wrote ${spec.outfile} (sha256=${sha256hex(contents).slice(0, 16)}...)\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exitCode = 1;
});
