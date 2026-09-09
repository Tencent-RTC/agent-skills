"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Readable } = require("node:stream");

const mode = require("../bin/reporting-mode.js");
const {
  findProjectRoot: installerFindProjectRoot,
  snapshotLegacyForIde,
  migrationStateForSnapshots,
  restoreDurableMigration,
  recoverInterruptedMigration,
  getResumableInstallState,
} = require("../bin/cli.js");

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

async function runRuntimeHook(runtime, project, state, ide = "claude") {
  return runtime.runCli(["hook", "--ide", ide], {
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
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
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

test("C19 mode: target IDE pairing ignores another IDE's legacy MCP", () => {
  const { project, home } = tmpProject();
  oldSkill(project, "claude");
  writeJson(path.join(home, ".cursor/mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });

  assert.equal(mode.resolveReportingMode(project, { home, ide: "claude" }).mode, "unknown",
    "Claude has an old Skill but no paired MCP");
  assert.equal(mode.resolveReportingMode(project, { home, ide: "cursor" }).mode, "node_v2",
    "Cursor MCP alone cannot taint a fresh Cursor project");
  assert.equal(mode.resolveReportingMode(project, { home, ide: "all" }).mode, "unknown",
    "mixed all-IDE state must fail safe");
});

test("C19 mode: explicit add upgrade intent switches a complete legacy IDE to Node V2", () => {
  const { project, home } = tmpProject();
  oldSkill(project, "claude");
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  assert.deepEqual(mode.resolveReportingMode(project, {
    home, ide: "claude", upgradeIntent: true,
  }), { mode: "node_v2", reason: "explicit_upgrade" });
});

test("C19 mode: explicit add is also the repair entry for an incomplete legacy IDE", () => {
  const { project, home } = tmpProject();
  oldSkill(project, "claude");
  assert.deepEqual(mode.resolveReportingMode(project, {
    home, ide: "claude", upgradeIntent: true,
  }), { mode: "node_v2", reason: "explicit_upgrade" });
  assert.equal(mode.resolveReportingMode(project, { home, ide: "claude" }).mode, "unknown",
    "without explicit upgrade, the incomplete legacy chain remains fail-safe");
});

test("C19 marker: adding Node V2 for one IDE does not disable another IDE's legacy chain", () => {
  const { project, home } = tmpProject();
  oldSkill(project, "claude");
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test", ides: ["cursor"] });
  const marker = JSON.parse(fs.readFileSync(mode.markerPath(project), "utf8"));
  assert.equal(marker.schema_version, 2);
  assert.equal(marker.ide_modes.cursor, "node_v2");
  assert.equal(mode.resolveReportingMode(project, { home, ide: "cursor" }).mode, "node_v2");
  assert.equal(mode.resolveReportingMode(project, { home, ide: "claude" }).mode, "legacy_mcp");
});

test("C19 migration recovery restores the old chain after an interrupted staged upgrade", () => {
  const { root, project, home } = tmpProject();
  oldSkill(project, "claude");
  const mcp = path.join(project, ".mcp.json");
  const instructions = path.join(project, "CLAUDE.md");
  writeJson(mcp, { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  fs.writeFileSync(instructions, "legacy claude instructions\n", "utf8");
  const originalSkill = fs.readFileSync(path.join(project, ".claude/skills/trtc/SKILL.md"), "utf8");
  const originalInstructions = fs.readFileSync(instructions, "utf8");
  const durableRoot = path.join(project, ".trtc-skill-state", "migrations", "0123456789abcdef0123456789abcdef");
  const snapshot = snapshotLegacyForIde("claude", project, home, durableRoot);
  const migration = migrationStateForSnapshots([snapshot]);
  assert.ok(migration);
  // Simulate the point after Node files were staged and legacy files disabled.
  fs.rmSync(path.join(project, ".claude/skills/trtc"), { recursive: true, force: true });
  fs.mkdirSync(path.join(project, ".claude/skills/trtc"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude/skills/trtc", "SKILL.md"), "node staged\n", "utf8");
  fs.writeFileSync(instructions, "node dispatcher instructions\n", "utf8");
  writeJson(mcp, { mcpServers: { "trtc-push-mcp": { command: "npx", args: ["-y", "push"] } } });
  // A marker from an older Node install must not be mistaken for this
  // migration's commit because it has no matching generation/IDE binding.
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "old", ides: ["claude"] });
  mode.writeInstallStage(project, "node_v2", "complete", { migration });
  const recovered = recoverInterruptedMigration(project);
  assert.equal(recovered.status, "rolled_back");
  assert.equal(fs.readFileSync(path.join(project, ".claude/skills/trtc/SKILL.md"), "utf8"), originalSkill);
  assert.equal(fs.readFileSync(instructions, "utf8"), originalInstructions,
    "legacy AI instructions must be restored with the old chain");
  assert.deepEqual(JSON.parse(fs.readFileSync(mcp, "utf8")).mcpServers["tencent-rtc-skill-tool"], legacyMcp());
  assert.equal(fs.existsSync(path.join(project, ".trtc-skill-state", "install-stage.json")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("C19 migration recovery removes a newly created instruction file when legacy file was absent", () => {
  const { root, project, home } = tmpProject();
  oldSkill(project, "claude");
  const mcp = path.join(project, ".mcp.json");
  const instructions = path.join(project, "CLAUDE.md");
  writeJson(mcp, { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  const durableRoot = path.join(project, ".trtc-skill-state", "migrations", "fedcba9876543210fedcba9876543210");
  const snapshot = snapshotLegacyForIde("claude", project, home, durableRoot);
  const migration = migrationStateForSnapshots([snapshot]);
  fs.writeFileSync(instructions, "node dispatcher instructions\n", "utf8");
  writeJson(mcp, { mcpServers: { "trtc-push-mcp": { command: "npx", args: ["-y", "push"] } } });
  mode.writeInstallStage(project, "node_v2", "complete", { migration });
  const recovered = recoverInterruptedMigration(project);
  assert.equal(recovered.status, "rolled_back");
  assert.equal(fs.existsSync(instructions), false,
    "new instruction file must be removed when the legacy project had none");
  fs.rmSync(root, { recursive: true, force: true });
});

test("C19 migration restore is retryable after a crash deletes a target before copying its backup", () => {
  const { root, project, home } = tmpProject();
  try {
    oldSkill(project, "claude");
    const mcp = path.join(project, ".mcp.json");
    writeJson(mcp, { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
    const durableRoot = path.join(project, ".trtc-skill-state", "migrations", "0123456789abcdef0123456789abcdef");
    const snapshot = snapshotLegacyForIde("claude", project, home, durableRoot);
    const migration = migrationStateForSnapshots([snapshot]);
    let interrupted = false;
    assert.equal(restoreDurableMigration(project, migration, {
      home,
      _testHookAfterRemove: () => {
        if (!interrupted) {
          interrupted = true;
          throw new Error("simulated_restore_crash");
        }
      },
    }), false);
    assert.equal(fs.existsSync(path.join(project, ".claude/skills/trtc")), false,
      "the injected crash must leave the first target absent");

    assert.equal(restoreDurableMigration(project, migration, { home }), true,
      "a later recovery must accept the expected missing target and retry");
    assert.equal(fs.existsSync(path.join(project, ".claude/skills/trtc/SKILL.md")), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(mcp, "utf8")).mcpServers["tencent-rtc-skill-tool"], legacyMcp());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("C19 stage updates retain the install event identity for the same generation", () => {
  const { project, root } = tmpProject();
  try {
    const ownerToken = "0123456789abcdef0123456789abcdef";
    const createdAt = Date.now();
    mode.writeInstallStage(project, "node_v2", "started", {
      ownerToken,
      installerVersion: "test",
      installEventId: "event-stage-stable",
      installAcknowledged: false,
      installIdes: ["cursor"],
      installEventCreatedAt: createdAt,
    });
    mode.writeInstallStage(project, "node_v2", "hooks", {
      ownerToken,
      installerVersion: "test",
    });
    const stage = mode.readInstallStage(project);
    assert.equal(stage.value.install_event_id, "event-stage-stable");
    assert.equal(stage.value.install_acknowledged, false);
    assert.deepEqual(stage.value.install_ides, ["cursor"]);
    assert.equal(stage.value.install_event_created_at, createdAt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("C19 migration recovery rejects an out-of-root backup without deleting it", () => {
  const { project, root } = tmpProject();
  const outside = path.join(root, "must-survive.txt");
  fs.writeFileSync(outside, "keep\n", "utf8");
  try {
    mode.writeInstallStage(project, "node_v2", "complete", {
      ownerToken: "0123456789abcdef0123456789abcdef",
      installerVersion: "test",
      installIdes: ["claude"],
      migration: {
        phase: "legacy_disabled",
        backup_root: outside,
        snapshots: [],
      },
    });
    const recovered = recoverInterruptedMigration(project);
    assert.equal(recovered.status, "invalid");
    assert.equal(fs.readFileSync(outside, "utf8"), "keep\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
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

test("C19 stage: install event identity and ACK state survive recovery", () => {
  const { project, root } = tmpProject();
  try {
    mode.writeInstallStage(project, "node_v2", "complete", {
      installerVersion: "test",
      installEventId: "install-event-stable",
      installAcknowledged: false,
      installIdes: ["cursor", "claude", "cursor"],
      installEventCreatedAt: Date.now(),
    });
    let stage = mode.readInstallStage(project);
    assert.equal(stage.status, "valid");
    assert.equal(stage.value.install_event_id, "install-event-stable");
    assert.equal(stage.value.install_acknowledged, false);
    assert.deepEqual(stage.value.install_ides, ["claude", "cursor"]);
    assert.equal(Number.isFinite(stage.value.install_event_created_at), true);

    mode.writeInstallStage(project, "node_v2", "complete", {
      installerVersion: "test",
      ownerToken: stage.value.owner_token,
      installEventId: "install-event-stable",
      installAcknowledged: true,
      installIdes: ["claude", "cursor"],
      installEventCreatedAt: stage.value.install_event_created_at,
    });
    stage = mode.readInstallStage(project);
    assert.equal(stage.status, "valid");
    assert.equal(stage.value.install_event_id, "install-event-stable");
    assert.equal(stage.value.install_acknowledged, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("C19 stage: install mode survives lifecycle rewrites for recovery analytics", () => {
  const { project, root } = tmpProject();
  try {
    const ownerToken = "abcdefabcdefabcdefabcdefabcdefab";
    mode.writeInstallStage(project, "node_v2", "started", {
      ownerToken,
      installerVersion: "test",
      installEventId: "install-mode-stable",
      installMode: "all",
      installIdes: ["claude", "cursor"],
      installEventCreatedAt: Date.now(),
    });
    mode.writeInstallStage(project, "node_v2", "complete", {
      ownerToken,
      installerVersion: "test",
    });
    const stage = mode.readInstallStage(project);
    assert.equal(stage.status, "valid");
    assert.equal(stage.value.install_mode, "all");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("C19 install event resume: target IDE is part of the reuse key, not event age", () => {
  const { project, root } = tmpProject();
  try {
    const createdAt = Date.now();
    mode.writeInstallStage(project, "node_v2", "complete", {
      installerVersion: require("../package.json").version,
      ownerToken: "0123456789abcdef0123456789abcdef",
      installEventId: "install-event-resume",
      installAcknowledged: false,
      installIdes: ["claude"],
      installEventCreatedAt: createdAt,
    });
    const stage = mode.readInstallStage(project);
    const missingMarker = { status: "missing" };
    assert.equal(getResumableInstallState(stage, missingMarker, ["claude"], { now: createdAt }).canResume, true);
    assert.equal(getResumableInstallState(stage, missingMarker, ["cursor"], { now: createdAt }).canResume, false,
      "a different target IDE must receive a new event generation");
    assert.equal(getResumableInstallState(stage, missingMarker, ["claude"], {
      now: createdAt + 365 * 24 * 60 * 60 * 1000,
    }).canResume, true, "a delayed retry must keep the same event identity");

    mode.writeInstallStage(project, "node_v2", "complete", {
      installerVersion: require("../package.json").version,
      ownerToken: stage.value.owner_token,
      installEventId: "install-event-resume",
      installAcknowledged: true,
      installIdes: ["claude"],
      installEventCreatedAt: createdAt,
    });
    mode.writeInstallMarker(project, "node_v2", { installerVersion: "test", ides: ["claude"] });
    const acknowledgedStage = mode.readInstallStage(project);
    const committedMarker = mode.readInstallMarker(project);
    assert.equal(getResumableInstallState(acknowledgedStage, committedMarker, ["claude"], { now: createdAt }).canResume, false,
      "a committed generation must not be reused by a later explicit add");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test("C19 Runtime: compatibility send is also blocked in an unmarked legacy project", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  oldSkill(project, "claude");
  writeJson(path.join(project, ".mcp.json"), { mcpServers: { "tencent-rtc-skill-tool": legacyMcp() } });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    const result = await runtime.runCli(["send"], {
      cwd: project,
      stateRoot: state,
      stdin: Readable.from([Buffer.from(JSON.stringify({ method: "prompt", text: "must stay on legacy MCP" }))]),
      env: { ...process.env, TRTC_REPORTING: "on", TRTC_PROMPT_REPORTING: "on" },
    });
    assert.equal(result.status, "disabled");
    assert.deepEqual((await import("../skills/trtc/runtime/outbox.js")).listOutbox(state), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("C19 Runtime: Root self-invoke is a hard no-op and preserves Pending", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test" });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    await runRuntimeHook(runtime, project, state);
    const before = (await import("../skills/trtc/runtime/outbox.js")).listPending(state);
    assert.equal(before.length, 1);
    const result = await runtime.runCli([
      "invoke", "--skillname", "trtc", "--cwd", project,
    ], { cwd: project, stateRoot: state, env: { ...process.env, TRTC_REPORTING: "on", TRTC_PROMPT_REPORTING: "on" } });
    assert.equal(result.status, "skipped");
    assert.equal(result.error, "root_dispatcher_not_owner");
    assert.equal(result.marker, "TRTC_REPORTING_ROOT_INVOKE_REJECTED_V1");
    const after = (await import("../skills/trtc/runtime/outbox.js")).listPending(state);
    assert.deepEqual(after.map((event) => event.event_id), before.map((event) => event.event_id));
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

test("C19 Runtime: Hook uses its --ide target when marker contains mixed IDE modes", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  // This is a valid mixed project: Codex has already migrated, while Claude
  // remains grandfathered on the old chain. A Codex Hook must not perform a
  // global four-IDE scan and get blocked as unknown.
  mode.writeInstallMarker(project, "legacy_mcp", { installerVersion: "test", ides: ["claude"] });
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test", ides: ["codex"] });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    const result = await runRuntimeHook(runtime, project, state, "codex");
    assert.deepEqual(result, {});
    assert.equal((await import("../skills/trtc/runtime/outbox.js")).listPending(state).length, 1);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("C19 Runtime: per-IDE node marker plus restored legacy footprint is fail-safe", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test", ides: ["codex"] });
  oldSkill(project, "codex");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"),
    "[mcp_servers.tencent-rtc-skill-tool]\ncommand = \"npx\"\nargs = [\"-y\", \"@tencent-rtc/skill-tool@latest\"]\n", "utf8");
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    assert.deepEqual(await runRuntimeHook(runtime, project, state, "codex"), {});
    assert.deepEqual((await import("../skills/trtc/runtime/outbox.js")).listPending(state), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("C19 Runtime: install reporting uses installed-ides in mixed mode", async () => {
  const { project, home } = tmpProject();
  const state = path.join(project, ".runtime-state");
  mode.writeInstallMarker(project, "legacy_mcp", { installerVersion: "test", ides: ["claude"] });
  mode.writeInstallMarker(project, "node_v2", { installerVersion: "test", ides: ["codex"] });
  const runtime = await import("../skills/trtc/runtime/telemetry.js");
  try {
    const result = await runtime.runCli([
      "install", "--cwd", project, "--state-root", state,
      "--event-id", "C19_MIXED_INSTALL", "--installed-ides", "codex",
      "--install-mode", "specific", "--version", "test", "--os", process.platform,
    ], {
      cwd: project,
      env: { ...process.env, TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
    });
    assert.equal(result.status, "failed");
    assert.equal((await import("../skills/trtc/runtime/outbox.js")).listOutbox(state).length, 1);
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
    assert.equal(install.status, "failed");
    const prompt = await runRuntimeHook(runtime, project, state);
    assert.deepEqual(prompt, {});
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
