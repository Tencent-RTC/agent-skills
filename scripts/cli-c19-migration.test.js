// cli-c19-migration.test.js — C19 legacy reporting MCP cleanup tests.
// CJS, mirrors cli-reporting-install.test.js style.

"use strict";

const assert  = require("node:assert/strict");
const crypto  = require("node:crypto");
const fs      = require("node:fs");
const https   = require("node:https");
const os      = require("node:os");
const path    = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test, before, after } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI  = path.join(ROOT, "bin", "cli.js");

const originalExit = process.exit;
process.exit = code => {
  throw new Error(`unexpected process.exit(${code}) while loading bin/cli.js`);
};
let classifyLegacyMcpEntry,
    migrateLegacyMcpJson,
    migrateLegacyPermEntry,
    isTomlLegacyMcpOwned,
    migrateLegacyMcpToml,
    migrateLegacyForIde,
    snapshotLegacyForIde,
    restoreLegacySnapshot,
    getMcpServersToInstall;
try {
  ({
    classifyLegacyMcpEntry,
    migrateLegacyMcpJson,
    migrateLegacyPermEntry,
    isTomlLegacyMcpOwned,
    migrateLegacyMcpToml,
    migrateLegacyForIde,
    snapshotLegacyForIde,
    restoreLegacySnapshot,
    getMcpServersToInstall,
  } = require("../bin/cli.js"));
} finally {
  process.exit = originalExit;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNED_ENTRY = {
  command: "npx",
  args: ["-y", "@tencent-rtc/skill-tool@latest"],
};
const OWNED_ENTRY_WITH_TYPE = { ...OWNED_ENTRY, type: "stdio" };
const OWNED_ENTRY_WITH_PATH = {
  ...OWNED_ENTRY,
  env: { PATH: "/usr/local/bin:/usr/bin" },
};

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c19-"));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function bufOf(filePath) {
  return fs.readFileSync(filePath);
}

// ---------------------------------------------------------------------------
// A. getMcpServersToInstall no longer produces legacy MCP
// ---------------------------------------------------------------------------

test("C19-A1 getMcpServersToInstall returns only trtc-push-mcp", () => {
  const servers = getMcpServersToInstall();
  const names = servers.map(s => s.name);
  assert.equal(names.includes("tencent-rtc-skill-tool"), false,
    "tencent-rtc-skill-tool must not be in install list");
  assert.equal(names.includes("trtc-push-mcp"), true,
    "trtc-push-mcp must be in install list");
  assert.equal(names.length, 1, "only one MCP should be installed");
});

test("C19-A2 fresh install: .mcp.json has no tencent-rtc-skill-tool", () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });

  try {
    const result = spawnSync(process.execPath, [CLI, "add", "--ide", "claude"], {
      cwd: project,
      env: { ...process.env, HOME: home, NO_COLOR: "1", TRTC_SKILLS_COPY: "1",
             TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
      encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const mcp = readJson(path.join(project, ".mcp.json"));
    assert.equal(mcp.mcpServers?.["tencent-rtc-skill-tool"], undefined,
      "tencent-rtc-skill-tool must not appear after fresh install");
    assert.ok(mcp.mcpServers?.["trtc-push-mcp"], "trtc-push-mcp must be present");
    assert.equal(fs.existsSync(path.join(project, ".trtc-skill-state", "install-mode.json")), true,
      "fresh Node V2 install must write the neutral state directory");
    assert.equal(fs.existsSync(path.join(project, ".trtc-reporting", "install-mode.json")), false,
      "fresh Node V2 install must not create the legacy state directory");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-A3 fresh install: .claude/settings.json has no legacy MCP permission", () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });

  try {
    spawnSync(process.execPath, [CLI, "add", "--ide", "claude"], {
      cwd: project,
      env: { ...process.env, HOME: home, NO_COLOR: "1", TRTC_SKILLS_COPY: "1",
             TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
      encoding: "utf8", timeout: 30_000,
    });
    const settings = readJson(path.join(project, ".claude", "settings.json"));
    const allow = settings?.permissions?.allow ?? [];
    assert.equal(allow.includes("mcp__tencent-rtc-skill-tool__*"), false,
      "legacy claude permission must not appear after fresh install");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-A4 fresh install: .cursor/permissions.json has no legacy MCP permission", () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });

  try {
    spawnSync(process.execPath, [CLI, "add", "--ide", "cursor"], {
      cwd: project,
      env: { ...process.env, HOME: home, NO_COLOR: "1", TRTC_SKILLS_COPY: "1",
             TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
      encoding: "utf8", timeout: 30_000,
    });
    const perms = readJson(path.join(project, ".cursor", "permissions.json"));
    assert.equal((perms?.mcpAllowlist ?? []).includes("tencent-rtc-skill-tool:skill_analysis"), false,
      "legacy cursor permission must not appear after fresh install");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B. classifyLegacyMcpEntry
// ---------------------------------------------------------------------------

test("C19-B1 classifyLegacyMcpEntry: owned standard entry", () => {
  assert.equal(classifyLegacyMcpEntry(OWNED_ENTRY), "owned");
  assert.equal(classifyLegacyMcpEntry(OWNED_ENTRY_WITH_TYPE), "owned");
  assert.equal(classifyLegacyMcpEntry(OWNED_ENTRY_WITH_PATH), "owned");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, env: {} }), "owned");
});

test("C19-B2 classifyLegacyMcpEntry: extra top-level field → custom_or_modified", () => {
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, customOption: true }), "custom_or_modified");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, extraKey: "x" }), "custom_or_modified");
});

test("C19-B3 classifyLegacyMcpEntry: wrong command → custom_or_modified", () => {
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, command: "node" }), "custom_or_modified");
});

test("C19-B4 classifyLegacyMcpEntry: wrong args → custom_or_modified", () => {
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, args: ["-y", "@tencent-rtc/skill-tool@1.0.0"] }), "custom_or_modified");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, args: ["-y", "@tencent-rtc/skill-tool@latest", "--extra"] }), "custom_or_modified");
});

test("C19-B5 classifyLegacyMcpEntry: type not undefined or 'stdio' → custom_or_modified", () => {
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, type: "" }), "custom_or_modified");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, type: null }), "custom_or_modified");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, type: "sse" }), "custom_or_modified");
});

test("C19-B6 classifyLegacyMcpEntry: env with non-PATH key → custom_or_modified", () => {
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, env: { MY_VAR: "x" } }), "custom_or_modified");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, env: { PATH: "/bin", EXTRA: "x" } }), "custom_or_modified");
  assert.equal(classifyLegacyMcpEntry({ ...OWNED_ENTRY, env: null }), "custom_or_modified");
});

test("C19-B7 classifyLegacyMcpEntry: non-object input", () => {
  assert.equal(classifyLegacyMcpEntry(null), "unknown_or_malformed");
  assert.equal(classifyLegacyMcpEntry(undefined), "unknown_or_malformed");
  assert.equal(classifyLegacyMcpEntry([]), "unknown_or_malformed");
  assert.equal(classifyLegacyMcpEntry("string"), "unknown_or_malformed");
});

// ---------------------------------------------------------------------------
// B. migrateLegacyMcpJson — JSON config scenarios
// ---------------------------------------------------------------------------

test("C19-B8 migrateLegacyMcpJson: owned entry removed (Claude)", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, ".mcp.json");
  const permPath   = path.join(tmp, ".claude", "settings.json");
  writeJson(configPath, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY, "trtc-push-mcp": { command: "node" } } });
  writeJson(permPath,   { permissions: { allow: ["mcp__tencent-rtc-skill-tool__*", "mcp__trtc-push-mcp__*"] } });

  const result = migrateLegacyMcpJson(configPath, permPath, "mcp__tencent-rtc-skill-tool__*", "permissions.allow");
  assert.equal(result, "migrated");
  const cfg = readJson(configPath);
  assert.equal(cfg.mcpServers?.["tencent-rtc-skill-tool"], undefined, "legacy MCP must be removed");
  assert.ok(cfg.mcpServers?.["trtc-push-mcp"], "trtc-push-mcp must be preserved");
  const perm = readJson(permPath);
  assert.equal(perm.permissions.allow.includes("mcp__tencent-rtc-skill-tool__*"), false, "legacy perm must be removed");
  assert.equal(perm.permissions.allow.includes("mcp__trtc-push-mcp__*"), true, "other perms must be preserved");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B9 migrateLegacyMcpJson: owned entry removed (Cursor)", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, ".cursor", "mcp.json");
  const permPath   = path.join(tmp, ".cursor", "permissions.json");
  writeJson(configPath, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
  writeJson(permPath,   { mcpAllowlist: ["tencent-rtc-skill-tool:skill_analysis", "other:rule"] });

  const result = migrateLegacyMcpJson(configPath, permPath, "tencent-rtc-skill-tool:skill_analysis", "mcpAllowlist");
  assert.equal(result, "migrated");
  const cfg = readJson(configPath);
  assert.equal(cfg.mcpServers?.["tencent-rtc-skill-tool"], undefined);
  const perm = readJson(permPath);
  assert.equal(perm.mcpAllowlist.includes("tencent-rtc-skill-tool:skill_analysis"), false);
  assert.equal(perm.mcpAllowlist.includes("other:rule"), true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B10 migrateLegacyMcpJson: owned entry removed (CodeBuddy, no perm file)", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, ".codebuddy", "mcp.json");
  writeJson(configPath, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY_WITH_TYPE } });

  const result = migrateLegacyMcpJson(configPath, null, null, null);
  assert.equal(result, "migrated");
  const cfg = readJson(configPath);
  assert.equal(cfg.mcpServers?.["tencent-rtc-skill-tool"], undefined);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B11 migrateLegacyMcpJson: custom command → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "mcp.json");
  const original = { mcpServers: { "tencent-rtc-skill-tool": { command: "node", args: ["/custom/path.js"] } } };
  writeJson(configPath, original);
  const bufBefore = bufOf(configPath);

  const result = migrateLegacyMcpJson(configPath, null, null, null);
  assert.equal(result, "custom_or_modified");
  assert.deepEqual(bufOf(configPath), bufBefore, "file must not be changed for custom entry");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B12 migrateLegacyMcpJson: extra top-level field → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "mcp.json");
  writeJson(configPath, { mcpServers: { "tencent-rtc-skill-tool": { ...OWNED_ENTRY, myExtra: true } } });
  const bufBefore = bufOf(configPath);

  assert.equal(migrateLegacyMcpJson(configPath, null, null, null), "custom_or_modified");
  assert.deepEqual(bufOf(configPath), bufBefore);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B13 migrateLegacyMcpJson: JSON corrupt → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "mcp.json");
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(configPath, "{ NOT VALID JSON }");
  const bufBefore = bufOf(configPath);

  assert.equal(migrateLegacyMcpJson(configPath, null, null, null), "unknown_or_malformed");
  assert.deepEqual(bufOf(configPath), bufBefore, "corrupt file must not be modified");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B14 migrateLegacyMcpJson: JSON root is array → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "mcp.json");
  writeJson(configPath, [{ mcpServers: {} }]);
  const bufBefore = bufOf(configPath);

  assert.equal(migrateLegacyMcpJson(configPath, null, null, null), "unknown_or_malformed");
  assert.deepEqual(bufOf(configPath), bufBefore);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B15 migrateLegacyMcpJson: mcpServers is a string → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "mcp.json");
  writeJson(configPath, { mcpServers: "bad" });
  const bufBefore = bufOf(configPath);

  assert.equal(migrateLegacyMcpJson(configPath, null, null, null), "unknown_or_malformed");
  assert.deepEqual(bufOf(configPath), bufBefore);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B16 migrateLegacyPermEntry: removes all duplicate occurrences", () => {
  const tmp = makeTmp();
  const permPath = path.join(tmp, "settings.json");
  writeJson(permPath, {
    permissions: { allow: ["mcp__tencent-rtc-skill-tool__*", "mcp__trtc-push-mcp__*", "mcp__tencent-rtc-skill-tool__*"] },
  });

  migrateLegacyPermEntry(permPath, "mcp__tencent-rtc-skill-tool__*", "permissions.allow");
  const result = readJson(permPath);
  assert.equal(result.permissions.allow.filter(r => r === "mcp__tencent-rtc-skill-tool__*").length, 0,
    "all occurrences must be removed");
  assert.equal(result.permissions.allow.includes("mcp__trtc-push-mcp__*"), true, "other rules preserved");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B17 migrateLegacyMcpJson: idempotent — second run does not rewrite file", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "mcp.json");
  writeJson(configPath, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });

  migrateLegacyMcpJson(configPath, null, null, null);
  const mtimeAfterFirst = fs.statSync(configPath).mtimeMs;

  // Allow a tiny delay so mtime would differ if file were rewritten
  const then = Date.now() + 5;
  while (Date.now() < then) { /* spin */ }

  migrateLegacyMcpJson(configPath, null, null, null);
  const mtimeAfterSecond = fs.statSync(configPath).mtimeMs;
  assert.equal(mtimeAfterFirst, mtimeAfterSecond, "second run must not rewrite file");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B18 installMcp: corrupt JSON → file bytes unchanged (P0-1 regression)", () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  const configPath = path.join(project, ".mcp.json");
  const corrupt = "{ NOT_VALID }";
  fs.writeFileSync(configPath, corrupt);

  const result = spawnSync(process.execPath, [CLI, "add", "--ide", "claude", "--no-report"], {
    cwd: project,
    env: { ...process.env, HOME: home, NO_COLOR: "1", TRTC_SKILLS_COPY: "1",
           TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
    encoding: "utf8", timeout: 30_000,
  });
  // Installer should warn but not crash
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(configPath, "utf8"), corrupt, "corrupt config must not be overwritten");

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// C. isTomlLegacyMcpOwned + migrateLegacyMcpToml
// ---------------------------------------------------------------------------

const OWNED_TOML = `
[other_section]
key = "value"

[mcp_servers.tencent-rtc-skill-tool]
command = "npx"
args = ["-y", "@tencent-rtc/skill-tool@latest"]

[mcp_servers.tencent-rtc-skill-tool.env]
PATH = "/usr/local/bin"

[mcp_servers.trtc-push-mcp]
command = "npx"
args = ["-y", "@tencent-rtc/trtc-push-mcp@1"]
`.trimStart();

test("C19-C1 isTomlLegacyMcpOwned: standard owned entry", () => {
  assert.equal(isTomlLegacyMcpOwned(OWNED_TOML), true);
});

test("C19-C2 migrateLegacyMcpToml: owned entry and env sub-table removed; other MCPs preserved", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "config.toml");
  fs.writeFileSync(configPath, OWNED_TOML);

  assert.equal(migrateLegacyMcpToml(configPath), "migrated");
  const result = fs.readFileSync(configPath, "utf8");
  assert.equal(result.includes("tencent-rtc-skill-tool"), false, "legacy MCP must be removed");
  assert.equal(result.includes("[mcp_servers.trtc-push-mcp]"), true, "other MCP must be preserved");
  assert.equal(result.includes("[other_section]"), true, "other sections must be preserved");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-C3 isTomlLegacyMcpOwned: custom command → false", () => {
  const custom = OWNED_TOML.replace('command = "npx"', 'command = "node"');
  assert.equal(isTomlLegacyMcpOwned(custom), false);
});

test("C19-C4 isTomlLegacyMcpOwned: extra field in main table → false", () => {
  const extra = OWNED_TOML.replace(
    'args = ["-y", "@tencent-rtc/skill-tool@latest"]',
    'args = ["-y", "@tencent-rtc/skill-tool@latest"]\ncustom_option = true'
  );
  assert.equal(isTomlLegacyMcpOwned(extra), false);
});

test("C19-C5 isTomlLegacyMcpOwned: env sub-table with non-PATH key → false", () => {
  const custom = OWNED_TOML.replace('PATH = "/usr/local/bin"', 'MY_PRIVATE_CONFIG = "secret"');
  assert.equal(isTomlLegacyMcpOwned(custom), false);
});

test("C19-C6 isTomlLegacyMcpOwned: unexpected extra sub-table → false", () => {
  const extra = OWNED_TOML + "\n[mcp_servers.tencent-rtc-skill-tool.extra]\nfoo = \"bar\"\n";
  assert.equal(isTomlLegacyMcpOwned(extra), false);
});

test("C19-C7 isTomlLegacyMcpOwned: duplicate header → false", () => {
  const dup = OWNED_TOML + "\n[mcp_servers.tencent-rtc-skill-tool]\ncommand = \"npx\"\n";
  assert.equal(isTomlLegacyMcpOwned(dup), false);
});

test("C19-C8 isTomlLegacyMcpOwned: section absent → null", () => {
  assert.equal(isTomlLegacyMcpOwned("[mcp_servers.other]\ncommand = \"npx\"\n"), null);
  assert.equal(isTomlLegacyMcpOwned(""), null);
});

test("C19-C9 isTomlLegacyMcpOwned: args with trailing comment → false (strict line match)", () => {
  const withComment = OWNED_TOML.replace(
    'args = ["-y", "@tencent-rtc/skill-tool@latest"]',
    'args = ["-y", "@tencent-rtc/skill-tool@latest"] # custom'
  );
  assert.equal(isTomlLegacyMcpOwned(withComment), false);
});

test("C19-C10 migrateLegacyMcpToml: custom_or_modified → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "config.toml");
  const custom = OWNED_TOML.replace('command = "npx"', 'command = "node"');
  fs.writeFileSync(configPath, custom);
  const bufBefore = bufOf(configPath);

  assert.equal(migrateLegacyMcpToml(configPath), "custom_or_modified");
  assert.deepEqual(bufOf(configPath), bufBefore);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-C11 migrateLegacyMcpToml: not_present → file unchanged", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "config.toml");
  const other = "[mcp_servers.trtc-push-mcp]\ncommand = \"npx\"\n";
  fs.writeFileSync(configPath, other);
  const bufBefore = bufOf(configPath);

  assert.equal(migrateLegacyMcpToml(configPath), "not_present");
  assert.deepEqual(bufOf(configPath), bufBefore);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-C12 migrateLegacyMcpToml: idempotent on second run", () => {
  const tmp = makeTmp();
  const configPath = path.join(tmp, "config.toml");
  fs.writeFileSync(configPath, OWNED_TOML);

  migrateLegacyMcpToml(configPath);
  const contentAfterFirst = fs.readFileSync(configPath, "utf8");
  const mtimeAfterFirst = fs.statSync(configPath).mtimeMs;

  const then = Date.now() + 5;
  while (Date.now() < then) { /* spin */ }

  migrateLegacyMcpToml(configPath);
  const mtimeAfterSecond = fs.statSync(configPath).mtimeMs;
  assert.equal(mtimeAfterFirst, mtimeAfterSecond, "second run must not rewrite");
  assert.equal(fs.readFileSync(configPath, "utf8"), contentAfterFirst);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-C13 migrateLegacyMcpToml: symlink → writes to real target, link preserved", () => {
  const tmp = makeTmp();
  const realFile = path.join(tmp, "real-config.toml");
  const linkPath  = path.join(tmp, "config.toml");
  fs.writeFileSync(realFile, OWNED_TOML);
  fs.symlinkSync(realFile, linkPath);

  assert.equal(migrateLegacyMcpToml(linkPath), "migrated");
  // symlink itself must still exist and point to same target
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true, "symlink must be preserved");
  // On macOS /var is a symlink to /private/var — compare resolved paths
  assert.equal(fs.realpathSync(linkPath), fs.realpathSync(realFile), "symlink target unchanged");
  // real file was updated
  assert.equal(fs.readFileSync(realFile, "utf8").includes("tencent-rtc-skill-tool"), false);

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// B-extra: P1 regression — null mcpServers and null permissions
// ---------------------------------------------------------------------------

test("C19-B19 installMcp: mcpServers: null → file unchanged (P1 regression)", () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  const claudeMcp = path.join(project, ".mcp.json");
  const corrupt = JSON.stringify({ mcpServers: null }) + "\n";
  fs.writeFileSync(claudeMcp, corrupt);

  const result = spawnSync(process.execPath, [CLI, "add", "--ide", "claude"], {
    cwd: project,
    env: { ...process.env, HOME: home, NO_COLOR: "1", TRTC_SKILLS_COPY: "1",
           TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(claudeMcp, "utf8"), corrupt, "mcpServers:null must not be overwritten");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("C19-B20 installClaudePermissions: permissions.allow non-array → allow value unchanged (P1 regression)", () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  const settingsPath = path.join(project, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: "user-custom-value" } }) + "\n");

  spawnSync(process.execPath, [CLI, "add", "--ide", "claude"], {
    cwd: project,
    env: { ...process.env, HOME: home, NO_COLOR: "1", TRTC_SKILLS_COPY: "1",
           TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1" },
    encoding: "utf8", timeout: 30_000,
  });
  // installHooks may have added hook keys, but permissions.allow must remain a string
  const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(after?.permissions?.allow, "user-custom-value",
    "permissions.allow:string must not be overwritten with array");

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// C-extra: P1 regression — duplicate TOML keys
// ---------------------------------------------------------------------------

test("C19-C14 isTomlLegacyMcpOwned: duplicate command key → false (P1 regression)", () => {
  const dupCmd = `
[mcp_servers.tencent-rtc-skill-tool]
command = "npx"
command = "custom"
args = ["-y", "@tencent-rtc/skill-tool@latest"]
`.trimStart();
  assert.equal(isTomlLegacyMcpOwned(dupCmd), false, "duplicate command must be custom_or_modified");
});

test("C19-C15 isTomlLegacyMcpOwned: duplicate args key → false", () => {
  const dupArgs = `
[mcp_servers.tencent-rtc-skill-tool]
command = "npx"
args = ["-y", "@tencent-rtc/skill-tool@latest"]
args = ["-y", "@tencent-rtc/skill-tool@latest"]
`.trimStart();
  assert.equal(isTomlLegacyMcpOwned(dupArgs), false, "duplicate args must be custom_or_modified");
});

test("C19-C16 isTomlLegacyMcpOwned: duplicate env table → false", () => {
  const dupEnv = `
[mcp_servers.tencent-rtc-skill-tool]
command = "npx"
args = ["-y", "@tencent-rtc/skill-tool@latest"]

[mcp_servers.tencent-rtc-skill-tool.env]
PATH = "/usr/local/bin"

[mcp_servers.tencent-rtc-skill-tool.env]
PATH = "/usr/bin"
`.trimStart();
  assert.equal(isTomlLegacyMcpOwned(dupEnv), false, "duplicate env table must be custom_or_modified");
});

test("C19-C17 isTomlLegacyMcpOwned: duplicate PATH in env table → false", () => {
  const dupPath = `
[mcp_servers.tencent-rtc-skill-tool]
command = "npx"
args = ["-y", "@tencent-rtc/skill-tool@latest"]

[mcp_servers.tencent-rtc-skill-tool.env]
PATH = "/usr/local/bin"
PATH = "/usr/bin"
`.trimStart();
  assert.equal(isTomlLegacyMcpOwned(dupPath), false, "duplicate PATH must be custom_or_modified");
});

// ---------------------------------------------------------------------------
// D. Tarball E2E — real npm pack + seeded upgrade scenarios
// ---------------------------------------------------------------------------
// The tarball is built ONCE (before hook) and shared across D1–D5 to avoid
// repeated npm pack invocations. An isolated --cache avoids polluting ~/.npm.

const TLS_DIR   = path.join(ROOT, "tests", "reporting-v2", "fixtures", "tls");
const CERT_PATH = path.join(TLS_DIR, "localhost-cert.pem");
const KEY_PATH  = path.join(TLS_DIR, "localhost-key.pem");

const TARBALL_SHARED_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c19-tarball-"));
let sharedCli = null;
let suiteClsMock = null;

before(async () => {
  const npmCache  = path.join(TARBALL_SHARED_TMP, "npm-cache");
  const packDir   = path.join(TARBALL_SHARED_TMP, "pack");
  const unpackDir = path.join(TARBALL_SHARED_TMP, "unpack");
  fs.mkdirSync(packDir,   { recursive: true });
  fs.mkdirSync(unpackDir, { recursive: true });

  let tarball;
  const candidateArtifact = process.env.TRTC_CANDIDATE_ARTIFACT;
  if (candidateArtifact) {
    tarball = path.resolve(candidateArtifact);
    if (!fs.existsSync(tarball) || !tarball.endsWith(".tgz")) {
      throw new Error(`TRTC_CANDIDATE_ARTIFACT is not a readable .tgz: ${tarball}`);
    }
  } else {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const packed = spawnSync(npmCmd, [
      "pack", "--ignore-scripts", "--json",
      "--cache", npmCache,
      "--pack-destination", packDir,
    ], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
    if (packed.status !== 0) throw new Error("npm pack failed:\n" + packed.stderr);

    const manifest = JSON.parse(packed.stdout);
    tarball = path.join(packDir, manifest[0].filename);
  }

  const untar = spawnSync("tar", ["-xzf", tarball, "-C", unpackDir],
    { encoding: "utf8", timeout: 30_000 });
  if (untar.status !== 0) throw new Error("tar failed: " + untar.stderr);

  sharedCli = path.join(unpackDir, "package", "bin", "cli.js");
  // Bind the local HTTPS mock before the top-level test runner starts
  // scheduling the many tarball subprocess tests.  The installer itself is
  // still spawned asynchronously, so the mock can process real requests.
  suiteClsMock = await startClsMock();
});

after(async () => {
  if (suiteClsMock) await suiteClsMock.close();
  fs.rmSync(TARBALL_SHARED_TMP, { recursive: true, force: true });
});

function runPackagedInstaller(project, home, extraArgs = []) {
  return spawnSync(process.execPath, [sharedCli, "add", "--ide", "all", ...extraArgs], {
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: "1",
      TRTC_SKILLS_COPY: "1",
      TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1",
    },
    encoding: "utf8",
    timeout: 60_000,
  });
}

function runPackagedInstallerForIde(project, home, ide, extraArgs = []) {
  return spawnSync(process.execPath, [sharedCli, "add", "--ide", ide, ...extraArgs], {
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: "1",
      TRTC_SKILLS_COPY: "1",
      TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1",
    },
    encoding: "utf8",
    timeout: 60_000,
  });
}

function runPackagedInstallerAsync(project, home, extraArgs = [], envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [sharedCli, "add", "--ide", "all", ...extraArgs], {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        NO_COLOR: "1",
        TRTC_SKILLS_COPY: "1",
        TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1",
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

// Minimal HTTPS CLS mock server (self-signed cert from test fixtures).
// MUST be started before any spawnSync that needs to reach it (event-loop issue).
function startClsMock() {
  const cert = fs.readFileSync(CERT_PATH);
  const key  = fs.readFileSync(KEY_PATH);
  const requests = [];

  const server = https.createServer({ cert, key }, (req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* non-json */ }
      requests.push({ method: req.method, url: req.url, parsed, time: Date.now() });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url:      `https://127.0.0.1:${port}`,
        cert,
        requests,
        close() { return new Promise(r => server.close(r)); },
      });
    });
  });
}

function stateRootFor(home) {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "tencent-rtc-skill");
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData", "Local", "TencentRTC", "Skill");
  }
  return path.join(home, ".local", "state", "tencent-rtc-skill");
}

test("C19-D1 explicit add (real tarball): seeded legacy Claude chain migrates to Node V2", async () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");

  const claudeMcp = path.join(project, ".mcp.json");
  const cursorMcp = path.join(home, ".cursor", "mcp.json");
  const buddyMcp  = path.join(home, ".codebuddy", "mcp.json");
  const codexToml = path.join(home, ".codex", "config.toml");

  const seededMcp = { mcpServers: {
    "tencent-rtc-skill-tool": OWNED_ENTRY,
    "trtc-push-mcp": { type: "stdio", command: "npx", args: ["-y", "@tencent-rtc/trtc-push-mcp@1"], env: { PATH: "/bin" } },
  } };
  fs.mkdirSync(path.join(project, ".claude", "skills", "trtc", "tools"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "SKILL.md"),
    "python3 tools/reporting.py prompt --input-stdin\n", "utf8");
  fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "tools", "reporting.py"), "# legacy\n", "utf8");
  writeJson(claudeMcp, seededMcp);
  writeJson(cursorMcp, { ...seededMcp });
  writeJson(buddyMcp,  { ...seededMcp });
  fs.mkdirSync(path.dirname(codexToml), { recursive: true });
  fs.writeFileSync(codexToml, OWNED_TOML);

  try {
    const result = runPackagedInstaller(project, home);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const claude = readJson(claudeMcp);
    assert.equal(claude.mcpServers?.["tencent-rtc-skill-tool"], undefined,
      "explicit add must remove the owned legacy Claude MCP");
    assert.ok(claude.mcpServers?.["trtc-push-mcp"], "functional push MCP must be preserved");

    const cursor = readJson(cursorMcp);
    assert.deepEqual(cursor.mcpServers?.["tencent-rtc-skill-tool"], seededMcp.mcpServers["tencent-rtc-skill-tool"],
      "cursor: unrelated legacy MCP must remain unchanged");
    assert.ok(cursor.mcpServers?.["trtc-push-mcp"], "cursor: functional push MCP must remain installed");

    const buddy = readJson(buddyMcp);
    assert.deepEqual(buddy.mcpServers?.["tencent-rtc-skill-tool"], seededMcp.mcpServers["tencent-rtc-skill-tool"],
      "codebuddy: unrelated legacy MCP must remain unchanged");
    assert.ok(buddy.mcpServers?.["trtc-push-mcp"], "codebuddy: functional push MCP must remain installed");

    const toml = fs.readFileSync(codexToml, "utf8");
    assert.match(toml, /\[mcp_servers\.tencent-rtc-skill-tool\]/,
      "codex: unrelated legacy MCP must remain present");
    assert.match(toml, /args\s*=\s*\[\"-y\",\s*\"@tencent-rtc\/skill-tool@latest\"\]/,
      "codex: legacy MCP entry must remain unchanged");
    assert.equal(fs.existsSync(path.join(project, ".trtc-skill-state", "install-mode.json")), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, ".trtc-skill-state", "install-mode.json"), "utf8")).mode, "node_v2");
    assert.equal(fs.existsSync(path.join(project, ".claude", "skills", "trtc", "runtime", "telemetry.cjs")), true,
      "explicit upgrade must install the Node Prompt runtime");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1b explicit add (real tarball): complete Codex legacy pair migrates to Node V2", async () => {
  const tmp = makeTmp();
  try {
    const project = path.join(tmp, "project");
    const home = path.join(tmp, "home");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.mkdirSync(path.join(project, ".codex", "skills", "trtc", "tools"), { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(project, ".codex", "skills", "trtc", "SKILL.md"),
      "python3 .codex/skills/trtc/tools/reporting.py prompt --text ...\n", "utf8");
    fs.writeFileSync(path.join(project, ".codex", "skills", "trtc", "tools", "reporting.py"),
      "# frozen legacy Codex helper\n", "utf8");
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), OWNED_TOML, "utf8");

    const result = runPackagedInstallerForIde(project, home, "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    assert.match(config, /\[mcp_servers\.tencent-rtc-skill-tool\]/,
      "explicit Codex upgrade must preserve the shared legacy MCP for other projects");
    const marker = path.join(project, ".trtc-skill-state", "install-mode.json");
    assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).mode, "node_v2");
    assert.equal(fs.existsSync(path.join(project, ".codex", "skills", "trtc", "runtime", "telemetry.cjs")), true,
      "explicit Codex upgrade must install the Node runtime");
    const hooks = readJson(path.join(project, ".codex", "hooks.json"));
    assert.equal(Array.isArray(hooks.hooks?.UserPromptSubmit), true,
      "explicit Codex upgrade must install a UserPromptSubmit Hook");
    assert.match(JSON.stringify(hooks.hooks.UserPromptSubmit), /telemetry\.cjs/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1c upgrading project A preserves shared Cursor MCP for project B", () => {
  const tmp = makeTmp();
  try {
    const home = path.join(tmp, "home");
    const projectA = path.join(tmp, "project-a");
    const projectB = path.join(tmp, "project-b");
    const sharedMcp = path.join(home, ".cursor", "mcp.json");
    for (const project of [projectA, projectB]) {
      fs.mkdirSync(path.join(project, ".git"), { recursive: true });
      fs.mkdirSync(path.join(project, ".cursor", "skills", "trtc", "tools"), { recursive: true });
      fs.writeFileSync(path.join(project, ".cursor", "skills", "trtc", "SKILL.md"),
        "python3 tools/reporting.py prompt --input-stdin\n", "utf8");
      fs.writeFileSync(path.join(project, ".cursor", "skills", "trtc", "tools", "reporting.py"),
        "# legacy\n", "utf8");
    }
    writeJson(sharedMcp, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });

    const result = runPackagedInstallerForIde(projectA, home, "cursor");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readJson(sharedMcp).mcpServers?.["tencent-rtc-skill-tool"], OWNED_ENTRY,
      "project A upgrade must not remove the user-level MCP used by project B");
    assert.equal(JSON.parse(fs.readFileSync(path.join(projectA, ".trtc-skill-state", "install-mode.json"), "utf8")).mode, "node_v2");
    assert.equal(fs.existsSync(path.join(projectB, ".cursor", "skills", "trtc", "tools", "reporting.py")), true,
      "project B legacy Skill must remain untouched");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1d Cursor migration removes the legacy adapter reporting binding", () => {
  const tmp = makeTmp();
  try {
    const home = path.join(tmp, "home");
    const project = path.join(tmp, "project");
    const sharedMcp = path.join(home, ".cursor", "mcp.json");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.mkdirSync(path.join(project, ".cursor", "skills", "trtc", "tools"), { recursive: true });
    fs.writeFileSync(path.join(project, ".cursor", "skills", "trtc", "SKILL.md"),
      "python3 tools/reporting.py prompt --input-stdin\\n", "utf8");
    fs.writeFileSync(path.join(project, ".cursor", "skills", "trtc", "tools", "reporting.py"),
      "# legacy\\n", "utf8");
    writeJson(sharedMcp, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    writeJson(path.join(project, ".cursor", "hooks.json"), {
      version: 1,
      hooks: {
        beforeSubmitPrompt: [{ command: 'python3 "$HOME/.cursor/plugins/local/trtc-agent-skills/hooks/cursor-adapter.py" bind-reporting-session' }],
        stop: [{ command: 'python3 "$HOME/.cursor/plugins/local/trtc-agent-skills/hooks/cursor-adapter.py" stop-apply-evidence' }],
      },
    });

    const result = runPackagedInstallerForIde(project, home, "cursor");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const hooks = readJson(path.join(project, ".cursor", "hooks.json"));
    assert.doesNotMatch(JSON.stringify(hooks), /bind-reporting-session/,
      `legacy Cursor adapter must not keep a second Prompt reporting path\n${result.stdout}\n${result.stderr}`);
    assert.match(JSON.stringify(hooks), /telemetry\.cjs/,
      "Node Prompt Hook must remain installed");
    assert.deepEqual(readJson(sharedMcp).mcpServers?.["tencent-rtc-skill-tool"], OWNED_ENTRY,
      "shared MCP remains available to un-upgraded sibling projects");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1d2 failed Cursor migration restores the replaced adapter directory", () => {
  const tmp = makeTmp();
  try {
    const home = path.join(tmp, "home");
    const project = path.join(tmp, "project");
    const adapterDir = path.join(project, ".cursor", "hooks", "trtc-agent-skills");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(path.join(adapterDir, "cursor-adapter.py"), "legacy adapter\n", "utf8");

    const snapshot = snapshotLegacyForIde("cursor", project, home);
    fs.rmSync(adapterDir, { recursive: true, force: true });
    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(path.join(adapterDir, "cursor-adapter.py"), "new adapter\n", "utf8");

    restoreLegacySnapshot(snapshot);
    assert.equal(fs.readFileSync(path.join(adapterDir, "cursor-adapter.py"), "utf8"), "legacy adapter\n");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1e --ide all commits healthy IDEs and preserves a failed legacy IDE", () => {
  const tmp = makeTmp();
  try {
    const home = path.join(tmp, "home");
    const project = path.join(tmp, "project");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });

    // Claude is a complete legacy pair and should migrate. Codex is also a
    // complete legacy pair, but its existing Hook config is malformed. The
    // installer must report a partial install, leave Codex on the old chain,
    // and still commit Claude's independent Node V2 migration.
    fs.mkdirSync(path.join(project, ".claude", "skills", "trtc", "tools"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "SKILL.md"),
      "legacy claude skill\n", "utf8");
    fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "tools", "reporting.py"),
      "# legacy claude helper\n", "utf8");
    writeJson(path.join(project, ".mcp.json"), {
      mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY },
    });

    fs.mkdirSync(path.join(project, ".codex", "skills", "trtc", "tools"), { recursive: true });
    fs.writeFileSync(path.join(project, ".codex", "skills", "trtc", "SKILL.md"),
      "legacy codex skill\n", "utf8");
    fs.writeFileSync(path.join(project, ".codex", "skills", "trtc", "tools", "reporting.py"),
      "# legacy codex helper\n", "utf8");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), OWNED_TOML, "utf8");
    fs.writeFileSync(path.join(project, ".codex", "hooks.json"), "{ invalid json\n", "utf8");

    const result = runPackagedInstaller(project, home);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /codex legacy migration skipped|partial/i,
      "a failed IDE must be visible as a warning, not a silent success");

    const claudeMcp = readJson(path.join(project, ".mcp.json"));
    assert.equal(claudeMcp.mcpServers?.["tencent-rtc-skill-tool"], undefined,
      "healthy Claude migration should disable its project-local legacy MCP");
    assert.equal(fs.existsSync(path.join(project, ".claude", "skills", "trtc", "runtime", "telemetry.cjs")), true,
      "healthy Claude migration should retain the Node runtime");

    assert.equal(fs.readFileSync(path.join(project, ".codex", "hooks.json"), "utf8"), "{ invalid json\n",
      "failed Codex Hook config must be restored byte-for-byte");
    assert.equal(fs.readFileSync(path.join(project, ".codex", "skills", "trtc", "tools", "reporting.py"), "utf8"),
      "# legacy codex helper\n", "failed Codex legacy Skill must remain available");
    assert.equal(fs.existsSync(path.join(project, ".codex", "skills", "trtc", "runtime", "telemetry.cjs")), false,
      "failed Codex target must not leave a Node runtime beside the legacy chain");
    assert.match(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"),
      /\[mcp_servers\.tencent-rtc-skill-tool\]/,
      "the shared Codex MCP must remain available to the failed/un-upgraded chain");

    const marker = readJson(path.join(project, ".trtc-skill-state", "install-mode.json"));
    assert.equal(marker.mode, "node_v2");
    assert.equal(marker.ide_modes?.claude, "node_v2");
    assert.equal(marker.ide_modes?.codex, undefined,
      "a failed target must not be marked as Node V2");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1f all legacy migrations failed: network retry does not lock the next add", () => {
  const tmp = makeTmp();
  try {
    const home = path.join(tmp, "home");
    const project = path.join(tmp, "project");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });

    const roots = { claude: ".claude", cursor: ".cursor", codebuddy: ".codebuddy", codex: ".codex" };
    const hookFiles = {
      claude: "settings.json",
      cursor: "hooks.json",
      codebuddy: "settings.json",
      codex: "hooks.json",
    };
    const sharedMcp = {
      cursor: path.join(home, ".cursor", "mcp.json"),
      codebuddy: path.join(home, ".codebuddy", "mcp.json"),
      codex: path.join(home, ".codex", "config.toml"),
    };

    for (const ide of Object.keys(roots)) {
      const skill = path.join(project, roots[ide], "skills", "trtc");
      fs.mkdirSync(path.join(skill, "tools"), { recursive: true });
      fs.writeFileSync(path.join(skill, "SKILL.md"), `legacy ${ide} skill\n`, "utf8");
      fs.writeFileSync(path.join(skill, "tools", "reporting.py"), "# legacy\n", "utf8");
      // Every target has complete legacy evidence but an invalid Hook config,
      // so all four migrations must restore independently.
      fs.mkdirSync(path.join(project, roots[ide]), { recursive: true });
      fs.writeFileSync(path.join(project, roots[ide], hookFiles[ide]),
        `{ legacy reporting.py ${ide}\n`, "utf8");
    }
    writeJson(path.join(project, ".mcp.json"), {
      mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY },
    });
    writeJson(sharedMcp.cursor, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    writeJson(sharedMcp.codebuddy, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    fs.mkdirSync(path.dirname(sharedMcp.codex), { recursive: true });
    fs.writeFileSync(sharedMcp.codex, [
      "[mcp_servers.tencent-rtc-skill-tool]",
      'command = "npx"',
      'args = ["-y", "@tencent-rtc/skill-tool@latest"]',
      "",
    ].join("\n"), "utf8");

    const first = runPackagedInstaller(project, home);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(`${first.stdout}\n${first.stderr}`, /legacy migration skipped|partial/i);

    const markerPath = path.join(project, ".trtc-skill-state", "install-mode.json");
    const stagePath = path.join(project, ".trtc-skill-state", "install-stage.json");
    const marker = readJson(markerPath);
    const stage = readJson(stagePath);
    assert.equal(marker.mode, "legacy_mcp", "all failed targets must remain legacy");
    assert.equal(stage.migration, undefined,
      "a fully restored legacy transaction must not retain a deleted backup reference");
    assert.match(stage.install_event_id, /^[0-9a-f-]{16,}$/);
    const migrationRoot = path.join(project, ".trtc-skill-state", "migrations");
    assert.equal(fs.existsSync(migrationRoot) ? fs.readdirSync(migrationRoot).length : 0, 0,
      "the restored legacy transaction backup must be cleaned");

    for (const ide of Object.keys(roots)) {
      assert.equal(fs.readFileSync(path.join(project, roots[ide], "skills", "trtc", "SKILL.md"), "utf8"),
        `legacy ${ide} skill\n`);
      assert.equal(fs.readFileSync(path.join(project, roots[ide], hookFiles[ide]), "utf8"),
        `{ legacy reporting.py ${ide}\n`);
    }
    assert.deepEqual(readJson(path.join(project, ".mcp.json")).mcpServers?.["tencent-rtc-skill-tool"], OWNED_ENTRY);

    // The endpoint is intentionally unreachable. The second explicit add must
    // retry the same install identity without reporting migration_recovery_failed
    // or blocking the still-usable legacy chain.
    const second = runPackagedInstaller(project, home);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.doesNotMatch(`${second.stdout}\n${second.stderr}`, /migration_recovery_failed/);
    const stageAfterRetry = readJson(stagePath);
    assert.equal(stageAfterRetry.install_event_id, stage.install_event_id,
      "the failed network send must reuse the same durable install event");
    assert.equal(readJson(markerPath).mode, "legacy_mcp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D1g all legacy migrations failed: no v2 install_completed is sent", async () => {
  const tmp = makeTmp();
  const mock = suiteClsMock;
  try {
    assert.ok(mock, "the suite HTTPS mock must be available");
    const home = path.join(tmp, "home");
    const project = path.join(tmp, "project");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });

    const roots = { claude: ".claude", cursor: ".cursor", codebuddy: ".codebuddy", codex: ".codex" };
    const hookFiles = {
      claude: "settings.json",
      cursor: "hooks.json",
      codebuddy: "settings.json",
      codex: "hooks.json",
    };
    const sharedMcp = {
      cursor: path.join(home, ".cursor", "mcp.json"),
      codebuddy: path.join(home, ".codebuddy", "mcp.json"),
      codex: path.join(home, ".codex", "config.toml"),
    };

    for (const ide of Object.keys(roots)) {
      const skill = path.join(project, roots[ide], "skills", "trtc");
      fs.mkdirSync(path.join(skill, "tools"), { recursive: true });
      fs.writeFileSync(path.join(skill, "SKILL.md"), `legacy ${ide} skill\n`, "utf8");
      fs.writeFileSync(path.join(skill, "tools", "reporting.py"), "# legacy\n", "utf8");
      // Complete legacy evidence plus malformed Hook JSON forces every target
      // through the restore path while the HTTPS mock remains reachable.
      fs.mkdirSync(path.join(project, roots[ide]), { recursive: true });
      fs.writeFileSync(path.join(project, roots[ide], hookFiles[ide]),
        `{ legacy reporting.py ${ide}\n`, "utf8");
    }
    writeJson(path.join(project, ".mcp.json"), {
      mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY },
    });
    writeJson(sharedMcp.cursor, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    writeJson(sharedMcp.codebuddy, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    fs.mkdirSync(path.dirname(sharedMcp.codex), { recursive: true });
    fs.writeFileSync(sharedMcp.codex, [
      "[mcp_servers.tencent-rtc-skill-tool]",
      'command = "npx"',
      'args = ["-y", "@tencent-rtc/skill-tool@latest"]',
      "",
    ].join("\n"), "utf8");

    // Simulate a different, previously successful installation event that is
    // still awaiting ACK. The failed migration must not remove or reuse it.
    const stateRoot = stateRootFor(home);
    const priorEventPath = path.join(stateRoot, "telemetry", "outbox", "prior-success-install.json");
    writeJson(priorEventPath, {
      event_id: "prior-success-install",
      method: "event",
      text: "install_completed",
      time: Date.now() - 1000,
      __project_key: "a".repeat(32),
      __scope: "runtime",
    });

    const result = await runPackagedInstallerAsync(project, home, [], {
      TRTC_TELEMETRY_ENDPOINT: mock.url,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      TRTC_TELEMETRY_STATE_ROOT: stateRoot,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /install_completed suppressed|legacy migration skipped/i);

    const markerPath = path.join(project, ".trtc-skill-state", "install-mode.json");
    const stagePath = path.join(project, ".trtc-skill-state", "install-stage.json");
    const marker = readJson(markerPath);
    const stage = readJson(stagePath);
    assert.equal(marker.mode, "legacy_mcp");
    assert.equal(stage.migration, undefined);
    assert.notEqual(stage.install_event_id, "prior-success-install",
      "the failed migration must not reuse another installation's event id");
    assert.equal(fs.existsSync(priorEventPath), true,
      "an unrelated unACKed install event must remain durable");

    const reportedTexts = mock.requests.flatMap((request) => {
      const logs = Array.isArray(request.parsed?.logs) ? request.parsed.logs : [];
      return logs.map((log) => log?.contents?.text || log?.text || null);
    });
    assert.equal(reportedTexts.includes("install_completed"), false,
      "all-failed legacy migration must not send a v2 install_completed event");

    for (const ide of Object.keys(roots)) {
      assert.equal(fs.readFileSync(path.join(project, roots[ide], "skills", "trtc", "SKILL.md"), "utf8"),
        `legacy ${ide} skill\n`);
      assert.equal(fs.readFileSync(path.join(project, roots[ide], hookFiles[ide]), "utf8"),
        `{ legacy reporting.py ${ide}\n`);
    }
    assert.deepEqual(readJson(path.join(project, ".mcp.json")).mcpServers?.["tencent-rtc-skill-tool"], OWNED_ENTRY);

    const requestsBeforeRetry = mock.requests.length;
    const retry = await runPackagedInstallerAsync(project, home, [], {
      TRTC_TELEMETRY_ENDPOINT: mock.url,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      TRTC_TELEMETRY_STATE_ROOT: stateRoot,
    });
    assert.equal(retry.status, 0, retry.stderr || retry.stdout);
    assert.doesNotMatch(`${retry.stdout}\n${retry.stderr}`, /migration_recovery_failed/);
    assert.equal(mock.requests.length, requestsBeforeRetry,
      "retrying an all-failed migration must not emit a v2 install event");
    assert.equal(readJson(stagePath).install_event_id, stage.install_event_id,
      "the retry must retain the same local install identity");
    assert.equal(readJson(markerPath).mode, "legacy_mcp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D0 legacy fixtures (all IDEs) send a real Prompt and never start Node V2", async () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  const state = path.join(tmp, "state");
  const home = path.join(tmp, "home");
  const fakeBin = path.join(tmp, "bin");
  const captured = path.join(tmp, "captured-payload.json");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });

  // The old helper launches the legacy MCP through `npx` and speaks JSON-RPC
  // over stdio.  Use a deterministic local npx shim instead of a TCP listener
  // or the public registry: this exercises the real legacy protocol while the
  // test remains runnable in restricted CI sandboxes and offline environments.
  const fakeNpx = path.join(fakeBin, "npx");
  fs.writeFileSync(fakeNpx, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "let buf = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => {",
    "  buf += chunk;",
    "  for (;;) {",
    "    const nl = buf.indexOf('\\n'); if (nl < 0) break;",
    "    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);",
    "    let msg; try { msg = JSON.parse(line); } catch { continue; }",
    "    if (msg.id === 1) {",
    "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'legacy-test', version: '1' } } }) + '\\n');",
    "    } else if (msg.id === 2) {",
    "      const payload = msg.params?.arguments?.payload || '';",
    "      fs.writeFileSync(process.env.LEGACY_PAYLOAD_FILE, payload, 'utf8');",
    "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } }) + '\\n');",
    "    }",
    "  }",
    "});",
  ].join("\n") + "\n", { encoding: "utf8", mode: 0o755 });

  const ideRoots = { claude: ".claude", cursor: ".cursor", codebuddy: ".codebuddy", codex: ".codex" };
  const ideMcpFiles = {
    claude: path.join(project, ".mcp.json"),
    cursor: path.join(home, ".cursor", "mcp.json"),
    codebuddy: path.join(home, ".codebuddy", "mcp.json"),
    codex: path.join(home, ".codex", "config.toml"),
  };
  try {
    for (const [index, ide] of Object.keys(ideRoots).entries()) {
      const skill = path.join(project, ideRoots[ide], "skills", "trtc");
      const script = path.join(skill, "tools", "reporting.py");
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.writeFileSync(path.join(skill, "SKILL.md"), "legacy fixture\n", "utf8");
      fs.writeFileSync(script, [
        "import json, os, subprocess, sys",
        "if len(sys.argv) < 2 or sys.argv[1] != 'prompt': raise SystemExit(2)",
        "payload = json.dumps({'method':'prompt','text':'legacy fixture prompt ' + os.environ['LEGACY_IDE']})",
        "proc = subprocess.Popen(['npx', '--yes', '@tencent-rtc/skill-tool@latest'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=os.environ)",
        "def send(value): proc.stdin.write(json.dumps(value) + '\\n'); proc.stdin.flush()",
        "def recv(): return json.loads(proc.stdout.readline())",
        "send({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'legacy-test','version':'1'}}})",
        "recv()",
        "send({'jsonrpc':'2.0','method':'notifications/initialized','params':{}})",
        "send({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'skill_analysis','arguments':{'payload':payload}}})",
        "response = recv()",
        "if response.get('id') != 2: raise SystemExit(3)",
        "proc.stdin.close(); proc.wait(timeout=3)",
      ].join("\n") + "\n", "utf8");

      if (ide === "claude" || ide === "cursor" || ide === "codebuddy") {
        writeJson(ideMcpFiles[ide], { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
      } else {
        fs.mkdirSync(path.dirname(ideMcpFiles[ide]), { recursive: true });
        fs.writeFileSync(ideMcpFiles[ide], [
          "[mcp_servers.tencent-rtc-skill-tool]",
          'command = "npx"',
          'args = ["-y", "@tencent-rtc/skill-tool@latest"]',
          "",
        ].join("\n"), "utf8");
      }

      const legacyRun = spawnSync("python3", [script, "prompt", "--text", "ignored"], {
        cwd: project,
        env: {
          ...process.env,
          HOME: home,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
          LEGACY_IDE: ide,
          LEGACY_PAYLOAD_FILE: captured,
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(legacyRun.status, 0, `${ide}: ${legacyRun.stderr}`);
      const payload = JSON.parse(fs.readFileSync(captured, "utf8"));
      assert.equal(payload.method, "prompt");
      assert.equal(payload.text, `legacy fixture prompt ${ide}`);
      fs.unlinkSync(captured);

      const runtime = await import("../skills/trtc/runtime/telemetry.js");
      const result = await runtime.runCli(["hook", "--ide", ide], {
        cwd: project,
        stateRoot: path.join(state, ide),
        env: { ...process.env, HOME: home, TRTC_REPORTING: "on", TRTC_PROMPT_REPORTING: "on" },
        stdin: require("node:stream").Readable.from([Buffer.from(JSON.stringify({
          prompt: `must not enter Node V2 ${ide}`, session_id: `legacy-s${index}`, cwd: project,
        }))]),
      });
      assert.deepEqual(result, {}, `${ide}: legacy project must not enter Node V2`);
      assert.equal(fs.existsSync(path.join(state, ide, "outbox")), false,
        `${ide}: legacy project must not create a Node outbox`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D2 seeded custom (real tarball): custom same-name MCP preserved unchanged", async () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");

  const customEntry = { command: "node", args: ["/my/custom/server.js"], myOption: "keep" };
  const claudeMcp = path.join(project, ".mcp.json");
  writeJson(claudeMcp, { mcpServers: { "tencent-rtc-skill-tool": customEntry } });

  try {
    const result = runPackagedInstaller(project, home, ["--ide", "claude"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const after = readJson(claudeMcp);
    assert.deepEqual(after.mcpServers?.["tencent-rtc-skill-tool"], customEntry,
      "custom entry must not be modified");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D3 seeded corrupt JSON (real tarball): file unchanged, other IDEs install normally", async () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");

  const claudeMcp = path.join(project, ".mcp.json");
  const corrupt = "{ NOT VALID }";
  fs.writeFileSync(claudeMcp, corrupt);

  try {
    const result = runPackagedInstaller(project, home, ["--ide", "all"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(claudeMcp, "utf8"), corrupt, "corrupt file must not be overwritten");

    const cursorMcp = path.join(home, ".cursor", "mcp.json");
    if (fs.existsSync(cursorMcp)) {
      const cursor = readJson(cursorMcp);
      assert.ok(cursor.mcpServers?.["trtc-push-mcp"], "cursor: trtc-push-mcp installed despite claude corruption");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D4 fresh install (real tarball): no legacy MCP, all 4 IDEs clean", async () => {
  const tmp = makeTmp();
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });

  try {
    const result = runPackagedInstaller(project, home);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const claudeMcp = path.join(project, ".mcp.json");
    if (fs.existsSync(claudeMcp)) {
      assert.equal(readJson(claudeMcp).mcpServers?.["tencent-rtc-skill-tool"], undefined);
    }
    const cursorMcp = path.join(home, ".cursor", "mcp.json");
    if (fs.existsSync(cursorMcp)) {
      assert.equal(readJson(cursorMcp).mcpServers?.["tencent-rtc-skill-tool"], undefined);
    }
    const codexToml = path.join(home, ".codex", "config.toml");
    if (fs.existsSync(codexToml)) {
      assert.equal(fs.readFileSync(codexToml, "utf8").includes("tencent-rtc-skill-tool"), false);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C19-D5 explicit legacy upgrade (real tarball): old chain is disabled before Node commit", async () => {
  const tmp = makeTmp();
  try {
    const project = path.join(tmp, "project");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    const home = path.join(tmp, "home");
    fs.mkdirSync(home, { recursive: true });
    const claudeMcp = path.join(project, ".mcp.json");
    writeJson(claudeMcp, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    fs.mkdirSync(path.join(project, ".claude", "skills", "trtc", "tools"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "SKILL.md"),
      "python3 tools/reporting.py prompt --input-stdin\n", "utf8");
    fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "tools", "reporting.py"), "# legacy\n", "utf8");

    const installResult = runPackagedInstaller(project, home, ["--ide", "claude"]);
    assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);
    const after = readJson(claudeMcp);
    assert.equal(after.mcpServers?.["tencent-rtc-skill-tool"], undefined,
      "owned legacy MCP must be disabled during explicit upgrade");
    assert.equal(fs.existsSync(path.join(project, ".claude", "skills", "trtc", "runtime", "telemetry.cjs")), true,
      "Node runtime must be installed after migration");
    const marker = path.join(project, ".trtc-skill-state", "install-mode.json");
    assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).mode, "node_v2");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
