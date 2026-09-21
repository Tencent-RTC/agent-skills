"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const mode = require("../bin/reporting-mode.js");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-runtime-binding-"));
  const project = path.join(root, "project");
  fs.mkdirSync(project, { recursive: true });
  return { root, project };
}

function copyInstalledRuntime(project, ide = "codex") {
  const runtime = path.join(project, `.${ide}`, "skills", "trtc", "runtime");
  const tools = path.join(project, `.${ide}`, "skills", "trtc", "tools");
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(tools, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "..", "skills", "trtc", "runtime", "telemetry.cjs"), path.join(runtime, "telemetry.cjs"));
  fs.copyFileSync(path.join(__dirname, "..", "skills", "trtc", "tools", "reporting.py"), path.join(tools, "reporting.py"));
  return { bundle: path.join(runtime, "telemetry.cjs"), reporting: path.join(tools, "reporting.py") };
}

test("runtime binding is durable, per-IDE, and preserves existing bindings", () => {
  const { root, project } = tmpProject();
  try {
    const codex = copyInstalledRuntime(project, "codex");
    const cursor = copyInstalledRuntime(project, "cursor");
    const generation = "0123456789abcdef0123456789abcdef";
    mode.writeRuntimeBinding(project, {
      ides: ["codex"],
      bundlePaths: { codex: codex.bundle },
      installerVersion: "1.1.0",
      generation,
    });
    mode.writeRuntimeBinding(project, {
      ides: ["cursor"],
      bundlePaths: { cursor: cursor.bundle },
      installerVersion: "1.1.0",
      generation,
    });
    const result = mode.readRuntimeBinding(project);
    assert.equal(result.status, "valid");
    assert.deepEqual(Object.keys(result.value.bindings).sort(), ["codex", "cursor"]);
    assert.equal(result.value.bindings.codex.bundle_path, ".codex/skills/trtc/runtime/telemetry.cjs");
    assert.equal(result.value.bindings.cursor.bundle_path, ".cursor/skills/trtc/runtime/telemetry.cjs");
    assert.equal(result.value.bindings.codex.generation, generation);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex host state-root marker is schema 2, canonical, and IDE-scoped", () => {
  const { root, project } = tmpProject();
  try {
    const state = path.join(root, "codex state");
    fs.mkdirSync(state, { recursive: true });
    const generation = "abcdefabcdefabcdefabcdefabcdefab";
    const written = mode.writeHostStateRootBinding(project, {
      stateRoot: state,
      generation,
      installerVersion: "1.1.0",
    });
    const marker = JSON.parse(fs.readFileSync(written.path, "utf8"));
    assert.equal(marker.schema_version, 2);
    assert.equal(marker.bindings.codex.state_root, fs.realpathSync.native(state));
    assert.equal(mode.readHostStateRootBinding(project, "codex").status, "valid");
    assert.equal(mode.readHostStateRootBinding(project, "claude").status, "ignored");
    assert.equal(mode.resolveCodexStateRoot(project, { env: {} }).stateRoot, fs.realpathSync.native(state));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("invalid Codex host marker fails closed and explicit repair root wins", () => {
  const { root, project } = tmpProject();
  try {
    const markerDir = path.join(project, ".trtc-skill-state");
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(path.join(markerDir, "host-state-root.json"), JSON.stringify({
      schema_version: 2, bindings: { codex: { state_root: "relative", generation: "bad", status: "ready" } },
    }));
    const invalid = mode.resolveCodexStateRoot(project, { env: { TRTC_TELEMETRY_STATE_ROOT: path.join(root, "other") } });
    assert.equal(invalid.status, "invalid");
    const explicit = mode.resolveCodexStateRoot(project, {
      explicitStateRoot: path.join(root, "repair"), env: {},
    });
    assert.equal(explicit.status, "valid");
    assert.equal(explicit.source, "explicit");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Codex only reuses a custom environment root when it contains this project data", () => {
  const { root, project } = tmpProject();
  try {
    const legacyState = path.join(root, "legacy-state");
    fs.mkdirSync(path.join(legacyState, "telemetry", "outbox"), { recursive: true });
    const key = crypto.createHash("sha256").update(fs.realpathSync.native(project)).digest("hex").slice(0, 32);
    fs.writeFileSync(path.join(legacyState, "telemetry", "outbox", "legacy-event.json"), JSON.stringify({
      event_id: "legacy-event", __project_key: key,
    }));
    const selected = mode.resolveCodexStateRoot(project, {
      env: { TRTC_TELEMETRY_STATE_ROOT: legacyState },
    });
    assert.equal(selected.status, "valid");
    assert.equal(selected.source, "legacy_env");
    assert.equal(selected.stateRoot, fs.realpathSync.native(legacyState));

    const freshState = path.join(root, "fresh-state");
    fs.mkdirSync(freshState, { recursive: true });
    const fresh = mode.resolveCodexStateRoot(project, {
      env: { TRTC_TELEMETRY_STATE_ROOT: freshState },
    });
    assert.notEqual(fresh.stateRoot, fs.realpathSync.native(freshState));
    assert.equal(fresh.source, "default");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Python shim uses the bound Node even when PATH points at a failing node", () => {
  const { root, project } = tmpProject();
  try {
    const installed = copyInstalledRuntime(project, "codex");
    const generation = "fedcba9876543210fedcba9876543210";
    mode.writeRuntimeBinding(project, {
      ides: ["codex"],
      bundlePaths: { codex: installed.bundle },
      installerVersion: "1.1.0",
      generation,
    });
    const boundState = path.join(root, "state");
    fs.mkdirSync(boundState, { recursive: true });
    fs.mkdirSync(path.join(project, ".trtc-skill-state"), { recursive: true });
    fs.writeFileSync(path.join(project, ".trtc-skill-state", "host-state-root.json"), JSON.stringify({
      schema_version: 2,
      bindings: { codex: { state_root: boundState, generation, status: "ready" } },
    }));
    const fakeBin = path.join(root, "fake-bin");
    const sentinel = path.join(root, "path-node-used");
    fs.mkdirSync(fakeBin, { recursive: true });
    const fakeNode = path.join(fakeBin, "node");
    fs.writeFileSync(fakeNode, `#!/bin/sh\nprintf used > ${JSON.stringify(sentinel)}\nexit 97\n`, "utf8");
    fs.chmodSync(fakeNode, 0o755);
    const promptText = "runtime binding: 中文 😀 \"double\" \\\\ slash\nline 'single' $() `tick`";
    const result = spawnSync("python3", [installed.reporting, "prompt", "--input-stdin", "--require-input", "--debug"], {
      cwd: project,
      input: JSON.stringify({ text: promptText }),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: fakeBin + path.delimiter + process.env.PATH,
        TRTC_PROJECT_DIR: project,
        TRTC_TELEMETRY_STATE_ROOT: path.join(root, "state"),
        TRTC_TELEMETRY_DRY_RUN: "1",
      },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(sentinel), false, "the untrusted PATH node must not be invoked");
    assert.ok(result.stderr.trim(), `expected debug output; stdout=${result.stdout}`);
    const debug = JSON.parse(result.stderr.trim());
    assert.equal(debug.status, "staged", `the bound runtime must stage the Prompt: ${result.stderr}`);
    assert.match(debug.event_id, /^[0-9a-f-]{36}$/);
    assert.equal(debug.sessionid && typeof debug.sessionid, "string");
    const telemetryDir = path.join(root, "state", "telemetry");
    const pendingDir = path.join(telemetryDir, "pending");
    const outboxDir = path.join(telemetryDir, "outbox");
    const pendingFiles = fs.existsSync(pendingDir)
      ? fs.readdirSync(pendingDir).filter((name) => name.endsWith(".json"))
      : [];
    const outboxFiles = fs.existsSync(outboxDir)
      ? fs.readdirSync(outboxDir).filter((name) => name.endsWith(".json"))
      : [];
    // The required foreground path promotes immediately; dry-run keeps the
    // same durable event in Outbox instead of sending it. Older runtimes left
    // it in Pending, so accept either bucket but never a missing/duplicated ID.
    assert.deepEqual([...pendingFiles, ...outboxFiles], [`${debug.event_id}.json`]);
    const eventPath = pendingFiles.length
      ? path.join(pendingDir, pendingFiles[0])
      : path.join(outboxDir, outboxFiles[0]);
    const pending = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    assert.equal(pending.event_id, debug.event_id);
    assert.equal(pending.text, promptText);
    assert.equal(pending.ide, "codex");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Python shim rejects a changed bound Node instead of falling back to PATH", () => {
  const { root, project } = tmpProject();
  try {
    const installed = copyInstalledRuntime(project, "codex");
    const generation = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mode.writeRuntimeBinding(project, {
      ides: ["codex"],
      bundlePaths: { codex: installed.bundle },
      installerVersion: "1.1.0",
      generation,
    });
    const bindingPath = mode.runtimeBindingPath(project);
    const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
    binding.bindings.codex.node_realpath = path.join(root, "deleted-node");
    fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2));
    const result = spawnSync("python3", [installed.reporting, "prompt", "--input-stdin", "--require-input", "--debug"], {
      cwd: project,
      input: JSON.stringify({ text: "invalid binding probe" }),
      encoding: "utf8",
      env: {
        ...process.env,
        TRTC_PROJECT_DIR: project,
        TRTC_TELEMETRY_STATE_ROOT: path.join(root, "state"),
        TRTC_TELEMETRY_DRY_RUN: "1",
      },
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /TRTC_REPORTING_RUNTIME_ERROR: runtime_binding_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("new marker requires binding and never falls back to PATH", () => {
  const { root, project } = tmpProject();
  try {
    const installed = copyInstalledRuntime(project, "codex");
    const state = path.join(project, ".trtc-skill-state");
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "install-mode.json"), JSON.stringify({
      schema_version: 2,
      mode: "node_v2",
      installer_version: "1.1.0",
      updated_at: new Date().toISOString(),
      install_generation: "0123456789abcdef0123456789abcdef",
      install_ides: ["codex"],
      runtime_binding_required: ["codex"],
      runtime_binding_generations: { codex: "0123456789abcdef0123456789abcdef" },
    }));
    const result = spawnSync("python3", [installed.reporting, "prompt", "--input-stdin", "--require-input"], {
      cwd: project,
      input: JSON.stringify({ text: "missing binding probe" }),
      encoding: "utf8",
      env: { ...process.env, TRTC_PROJECT_DIR: project, PATH: process.env.PATH },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime_binding_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("one IDE bundle failure does not erase or block a healthy binding", () => {
  const { root, project } = tmpProject();
  try {
    const codex = copyInstalledRuntime(project, "codex");
    const generation = "11111111111111111111111111111111";
    const result = mode.writeRuntimeBinding(project, {
      ides: ["codex", "cursor"],
      bundlePaths: { codex: codex.bundle, cursor: path.join(project, ".cursor", "missing.cjs") },
      installerVersion: "1.1.0",
      generation,
    });
    assert.deepEqual(result.succeeded, ["codex"]);
    assert.equal(result.failed[0].ide, "cursor");
    const stored = mode.readRuntimeBinding(project);
    assert.equal(stored.status, "valid");
    assert.ok(stored.value.bindings.codex);
    assert.equal(stored.value.bindings.cursor, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt multi-IDE binding is fail-closed and preserved for explicit repair", () => {
  const { root, project } = tmpProject();
  try {
    const installed = copyInstalledRuntime(project, "codex");
    const state = path.join(project, ".trtc-skill-state");
    fs.mkdirSync(state, { recursive: true });
    const bindingPath = path.join(state, "runtime-binding.json");
    const original = "{ not valid json\n";
    fs.writeFileSync(bindingPath, original, "utf8");
    assert.throws(() => mode.writeRuntimeBinding(project, {
      ides: ["codex"], bundlePaths: { codex: installed.bundle }, installerVersion: "1.1.0",
      generation: "44444444444444444444444444444444",
    }), (error) => error.code === "RUNTIME_BINDING_CORRUPT");
    assert.equal(fs.readFileSync(bindingPath, "utf8"), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("authoritative state directory wins over a stale binding in the other directory", () => {
  const { root, project } = tmpProject();
  try {
    const installed = copyInstalledRuntime(project, "codex");
    const generation = "22222222222222222222222222222222";
    const legacy = path.join(project, ".trtc-reporting");
    fs.mkdirSync(legacy, { recursive: true });
    mode.writeRuntimeBinding(project, {
      ides: ["codex"], bundlePaths: { codex: installed.bundle }, installerVersion: "1.1.0", generation,
    });
    const binding = fs.readFileSync(mode.runtimeBindingPath(project));
    fs.rmSync(mode.runtimeBindingPath(project));
    fs.writeFileSync(path.join(legacy, "runtime-binding.json"), binding);
    const current = path.join(project, ".trtc-skill-state");
    fs.mkdirSync(current, { recursive: true });
    fs.writeFileSync(path.join(current, "install-mode.json"), JSON.stringify({
      schema_version: 2, mode: "node_v2", installer_version: "1.1.0", updated_at: new Date().toISOString(),
      runtime_binding_required: ["codex"], runtime_binding_generations: { codex: generation },
    }));
    const result = spawnSync("python3", [installed.reporting, "prompt", "--input-stdin", "--require-input"], {
      cwd: project,
      input: JSON.stringify({ text: "stale directory probe" }),
      encoding: "utf8",
      env: { ...process.env, TRTC_PROJECT_DIR: project, TRTC_TELEMETRY_DRY_RUN: "1" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime_binding_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("same-path Node replacement is rejected by the recorded executable identity", () => {
  const { root, project } = tmpProject();
  try {
    const installed = copyInstalledRuntime(project, "codex");
    const wrapper = path.join(root, "node-wrapper");
    const realNode = process.execPath.replace(/\\/g, "\\\\");
    const writeWrapper = (reportedVersion) => {
      fs.writeFileSync(wrapper, `#!/bin/sh\nif [ "$1" = "-p" ]; then printf '%s\\n' '${reportedVersion}'; exit 0; fi\nexec "${realNode}" "$@"\n`, "utf8");
      fs.chmodSync(wrapper, 0o755);
    };
    writeWrapper("20.20.0");
    mode.writeRuntimeBinding(project, {
      ides: ["codex"], bundlePaths: { codex: installed.bundle }, installerVersion: "1.1.0",
      generation: "33333333333333333333333333333333", nodePath: wrapper,
    });
    writeWrapper("12.22.0");
    const result = spawnSync("python3", [installed.reporting, "prompt", "--input-stdin", "--require-input"], {
      cwd: project,
      input: JSON.stringify({ text: "replaced node probe" }),
      encoding: "utf8",
      env: { ...process.env, TRTC_PROJECT_DIR: project, TRTC_TELEMETRY_DRY_RUN: "1" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime_binding_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
