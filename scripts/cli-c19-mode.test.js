"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Readable } = require("node:stream");

const mode = require("../bin/reporting-mode.js");
const { findProjectRoot: installerFindProjectRoot } = require("../bin/cli.js");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c19-mode-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { root, project, home };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function legacyMcp() {
  return { command: "npx", args: ["-y", "@tencent-rtc/skill-tool@latest"] };
}

function oldSkill(project, ide = "claude") {
  const root = { claude: ".claude", cursor: ".cursor", codebuddy: ".codebuddy", codex: ".codex" }[ide];
  const file = path.join(project, root, "skills/trtc/SKILL.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "python3 tools/reporting.py prompt --input-stdin\n", "utf8");
  fs.mkdirSync(path.join(project, root, "skills/trtc/tools"), { recursive: true });
  fs.writeFileSync(path.join(project, root, "skills/trtc/tools/reporting.py"), "# legacy\n", "utf8");
}

async function runRuntimeHook(runtime, project, state) {
  return runtime.runCli(["hook", "--ide", "claude"], {
    cwd: project,
    stateRoot: state,
    stdin: Readable.from([Buffer.from(JSON.stringify({
      prompt: "legacy runtime guard probe",
      session_id: "c19-runtime-guard",
      cwd: project,
    }))]),
    env: { ...process.env, TRTC_REPORTING: "on", TRTC_PROMPT_REPORTING: "on" },
  });
}

test("C19 root parity: installer and Runtime resolve all canonical fixture shapes identically", async () => {
  const cases = require("../tests/reporting-v2/fixtures/c19/project-root-cases.json");
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  for (const fixture of cases) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `trtc-c19-root-${fixture.id}-`));
    const repo = path.join(base, "repo");
    const child = path.join(repo, "packages", "app");
    fs.mkdirSync(child, { recursive: true });
    for (const signal of fixture.signals) {
      if (signal === "package.json:workspaces") {
        fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }), "utf8");
      } else if (signal === "package.json:child") {
        fs.writeFileSync(path.join(child, "package.json"), "{}\n", "utf8");
      } else {
        fs.writeFileSync(path.join(repo, signal), "\n", "utf8");
      }
    }
    const expected = mode.canonicalizeProjectPath(path.join(fixture.expected === "repo" ? repo : child));
    assert.equal(installerFindProjectRoot(child), expected, `${fixture.id}: installer`);
    assert.equal(runtime.resolveProjectRoot({ explicitCwd: child }), expected, `${fixture.id}: runtime`);
  }
});

test("C19 mode: a user-level legacy MCP alone does not taint a new project", () => {
  const { project, home } = tmpProject();
  writeJson(path.join(home, ".cursor/mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  assert.deepEqual(mode.resolveReportingMode(project, { home, ides: ["claude"] }), {
    mode: "node_v2", reason: "fresh_project",
  });
});

test("C19 mode: project-local legacy MCP alone is fail-safe", () => {
  const { project, home } = tmpProject();
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  assert.deepEqual(mode.resolveReportingMode(project, { home, ides: ["claude"] }), {
    mode: "unknown", reason: "project_legacy_mcp",
  });
});

test("C19 mode: old Skill plus user-level owned MCP is legacy_mcp", () => {
  const { project, home } = tmpProject();
  oldSkill(project);
  writeJson(path.join(home, ".cursor/mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  assert.deepEqual(mode.resolveReportingMode(project, { home, ides: ["claude"] }), {
    mode: "legacy_mcp", reason: "legacy_footprint",
  });
});

test("C19 mode: each IDE's user-level owned MCP combines with its old Skill", () => {
  const userMcp = {
    claude: ".mcp.json",
    cursor: ".cursor/mcp.json",
    codebuddy: ".codebuddy/mcp.json",
  };
  for (const ide of ["claude", "cursor", "codebuddy", "codex"]) {
    const { project, home } = tmpProject();
    oldSkill(project, ide);
    if (ide === "codex") {
      fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
      fs.writeFileSync(path.join(home, ".codex/config.toml"),
        "[mcp_servers.tencent-rtc-skill-tool]\ncommand = \"npx\"\nargs = [\"-y\", \"@tencent-rtc/skill-tool@latest\"]\n", "utf8");
    } else {
      const config = path.join(ide === "claude" ? project : home, userMcp[ide]);
      writeJson(config, { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
    }
    assert.equal(mode.resolveReportingMode(project, { home }).mode, "legacy_mcp", `${ide} must remain legacy`);
  }
});

test("C19 mode: legacy Skill without MCP is unknown and cannot enable a second chain", () => {
  const { project, home } = tmpProject();
  oldSkill(project);
  assert.equal(mode.resolveReportingMode(project, { home, ides: ["claude"] }).mode, "unknown");
});

test("C19 marker: stable marker wins over unrelated user-level legacy MCP", () => {
  const { project, home } = tmpProject();
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test" });
  writeJson(path.join(home, ".codebuddy/mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  assert.equal(mode.resolveReportingMode(project, { home, ides: ["claude"] }).mode, "node_v2");
});

test("C19 marker: node_v2 plus old Skill and owned MCP is a conflict, not dual-chain Node", () => {
  const { project, home } = tmpProject();
  oldSkill(project, "claude");
  writeJson(path.join(home, ".cursor/mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test" });
  assert.equal(mode.resolveReportingMode(project, { home }).mode, "unknown");
});

test("C19 marker: node_v2 plus project-local legacy MCP is a conflict", () => {
  const { project, home } = tmpProject();
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test" });
  assert.deepEqual(mode.resolveReportingMode(project, { home }), {
    mode: "unknown", reason: "marker_footprint_conflict",
  });
});

test("C19 marker: malformed marker is fail-closed and is not rewritten", () => {
  const { project, home } = tmpProject();
  fs.mkdirSync(path.join(project, ".trtc-reporting"), { recursive: true });
  const marker = mode.markerPath(project);
  fs.writeFileSync(marker, "{broken\n", "utf8");
  assert.equal(mode.resolveReportingMode(project, { home }).mode, "unknown");
  assert.equal(fs.readFileSync(marker, "utf8"), "{broken\n");
});

test("C19 project state: fresh Node marker uses neutral .trtc-skill-state directory", () => {
  const { project } = tmpProject();
  const marker = mode.writeInstallMarker(project, "node_v2", { installerVersion: "test" });
  assert.equal(marker, path.join(project, ".trtc-skill-state", "install-mode.json"));
  assert.equal(fs.existsSync(path.join(project, ".trtc-reporting", "install-mode.json")), false);
});

test("C19 project state: existing .trtc-reporting marker remains the single owner", () => {
  const { project } = tmpProject();
  fs.mkdirSync(path.join(project, ".trtc-reporting"), { recursive: true });
  fs.writeFileSync(path.join(project, ".trtc-reporting", "install-mode.json"), JSON.stringify({
    schema_version: 1, mode: "node_v2", installer_version: "old", updated_at: new Date().toISOString(),
  }));
  const marker = mode.writeInstallMarker(project, "node_v2", { installerVersion: "new" });
  assert.equal(marker, path.join(project, ".trtc-reporting", "install-mode.json"));
  assert.equal(fs.existsSync(path.join(project, ".trtc-skill-state", "install-mode.json")), false);
});

test("C19 stage: incomplete node install can be resumed, while unknown never writes a marker", () => {
  const { project, home } = tmpProject();
  mode.writeInstallStage(project, "node_v2", "hooks", { installerVersion: "test", ownerPid: 2147483647 });
  fs.mkdirSync(path.join(project, ".claude/skills/trtc/runtime"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude/skills/trtc/runtime/telemetry.cjs"), "// owned\n", "utf8");
  // The stage snapshot was created before the runtime write; refresh it to
  // represent the crash point after the Hook/Skill phase completed.
  mode.writeInstallStage(project, "node_v2", "hooks", { installerVersion: "test", ownerPid: 2147483647 });
  assert.equal(mode.resolveReportingMode(project, { home, ides: ["claude"] }).mode, "node_v2");
  mode.clearInstallStage(project);
  assert.equal(fs.existsSync(mode.markerPath(project)), false);
});

test("C19 stage: active owner is busy and modified owned files are unknown", () => {
  const { project, home } = tmpProject();
  mode.writeInstallStage(project, "node_v2", "hooks", { installerVersion: "test", ownerPid: process.pid });
  assert.equal(mode.resolveReportingMode(project, { home }).reason, "install_in_progress");
  mode.writeInstallStage(project, "node_v2", "hooks", { installerVersion: "test", ownerPid: 2147483647 });
  fs.mkdirSync(path.join(project, ".claude/skills/trtc/runtime"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude/skills/trtc/runtime/telemetry.cjs"), "user-modified\n", "utf8");
  assert.equal(mode.resolveReportingMode(project, { home }).reason, "stage_footprint_changed");
});

test("C19 project lock: second owner cannot enter and release is token-safe", () => {
  const { project } = tmpProject();
  const first = mode.acquireProjectInstallLock(project);
  assert.equal(first.acquired, true);
  const second = mode.acquireProjectInstallLock(project, { graceMs: 0 });
  assert.equal(second.acquired, false);
  assert.equal(mode.releaseProjectInstallLock({ path: first.path, token: "wrong" }), false);
  assert.equal(fs.existsSync(first.path), true);
  assert.equal(mode.releaseProjectInstallLock(first), true);
  assert.equal(fs.existsSync(first.path), false);
});

test("C19 Runtime: unmarked legacy project cannot start a second Node Prompt chain", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  oldSkill(project, "claude");
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    const result = await runRuntimeHook(runtime, project, state);
    assert.deepEqual(result, {});
    assert.deepEqual(runtime && (await import("../skills/trtc/runtime/outbox.js")).listPending(state), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("C19 Runtime: install stage without committed marker is fail-safe", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  mode.writeInstallStage(project, "node_v2", "hooks", { installerVersion: "test", ownerPid: 2147483647 });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    assert.deepEqual(await runRuntimeHook(runtime, project, state), {});
    assert.deepEqual((await import("../skills/trtc/runtime/outbox.js")).listPending(state), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("C19 Runtime: malformed or incomplete marker is fail-safe", async () => {
  const cases = [
    { name: "malformed", value: "{broken\n" },
    { name: "incomplete", value: JSON.stringify({ schema_version: 1, mode: "node_v2" }) },
  ];
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  for (const fixture of cases) {
    const { project, home } = tmpProject();
    const state = path.join(project, ".runtime-state");
    fs.mkdirSync(path.join(project, ".trtc-reporting"), { recursive: true });
    fs.writeFileSync(path.join(project, ".trtc-reporting", "install-mode.json"), fixture.value, "utf8");
    try {
      assert.deepEqual(await runRuntimeHook(runtime, project, state), {}, fixture.name);
      assert.deepEqual((await import("../skills/trtc/runtime/outbox.js")).listPending(state), [], fixture.name);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test("C19 Runtime: complete node_v2 marker still permits Node Prompt staging", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test" });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    assert.deepEqual(await runRuntimeHook(runtime, project, state), {});
    assert.equal((await import("../skills/trtc/runtime/outbox.js")).listPending(state).length, 1);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("C19 Runtime: installer-owned stage permits only install reporting", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c19-stage-install-"));
  const project = path.join(tmp, "project");
  const state = path.join(tmp, "state");
  fs.mkdirSync(project, { recursive: true });
  try {
    const ownerToken = "0123456789abcdef0123456789abcdef";
    mode.writeInstallStage(project, "node_v2", "started", { ownerToken, ownerPid: process.pid });
    const runtime = await import("../skills/trtc/runtime/telemetry.js");
    const install = await runtime.runCli([
      "install", "--cwd", project, "--state-root", state,
      "--install-owner-token", ownerToken, "--event-id", "C19_STAGE_INSTALL",
      "--installed-ides", "codex", "--install-mode", "specific", "--version", "test", "--os", process.platform,
    ], { cwd: project, env: { ...process.env, TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" } });
    assert.equal(install.status, "queued");
    const prompt = await runRuntimeHook(runtime, project, state);
    assert.deepEqual(prompt, {});
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
