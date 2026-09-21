"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { runTelemetry } = require("../skills/trtc/runtime/stop-hook-dispatcher.cjs");

test("Stop dispatcher forwards the canonical state root only to Codex", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-stop-dispatcher-root-"));
  const runtime = path.join(root, "runtime.cjs");
  const capture = path.join(root, "argv.json");
  fs.writeFileSync(runtime, [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.TRTC_CAPTURE, JSON.stringify(process.argv.slice(1)));",
    "process.stdout.write(JSON.stringify({ systemMessage: 'ok' }));",
  ].join("\n"), "utf8");
  const env = { ...process.env, TRTC_CAPTURE: capture };
  const stateRoot = path.join(root, "codex state");
  try {
    const codex = runTelemetry(runtime, "codex", "{}", env, root, stateRoot);
    assert.equal(codex.status, 0);
    const codexArgs = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.deepEqual(codexArgs.slice(-2), ["--state-root", stateRoot]);

    const cursor = runTelemetry(runtime, "cursor", "{}", env, root, stateRoot);
    assert.equal(cursor.status, 0);
    const cursorArgs = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.equal(cursorArgs.includes("--state-root"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
