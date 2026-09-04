// cli-c19-migration.test.js — C19 legacy reporting MCP cleanup tests.
// CJS, mirrors cli-reporting-install.test.js style.

"use strict";

const assert  = require("node:assert/strict");
const crypto  = require("node:crypto");
const fs      = require("node:fs");
const https   = require("node:https");
const os      = require("node:os");
const path    = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
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
    getMcpServersToInstall;
try {
  ({
    classifyLegacyMcpEntry,
    migrateLegacyMcpJson,
    migrateLegacyPermEntry,
    isTomlLegacyMcpOwned,
    migrateLegacyMcpToml,
    migrateLegacyForIde,
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

before(() => {
  const npmCache  = path.join(TARBALL_SHARED_TMP, "npm-cache");
  const packDir   = path.join(TARBALL_SHARED_TMP, "pack");
  const unpackDir = path.join(TARBALL_SHARED_TMP, "unpack");
  fs.mkdirSync(packDir,   { recursive: true });
  fs.mkdirSync(unpackDir, { recursive: true });

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = spawnSync(npmCmd, [
    "pack", "--ignore-scripts", "--json",
    "--cache", npmCache,
    "--pack-destination", packDir,
  ], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
  if (packed.status !== 0) throw new Error("npm pack failed:\n" + packed.stderr);

  const manifest = JSON.parse(packed.stdout);
  const tarball  = path.join(packDir, manifest[0].filename);

  const untar = spawnSync("tar", ["-xzf", tarball, "-C", unpackDir],
    { encoding: "utf8", timeout: 30_000 });
  if (untar.status !== 0) throw new Error("tar failed: " + untar.stderr);

  sharedCli = path.join(unpackDir, "package", "bin", "cli.js");
});

after(() => {
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

test("C19-D1 seeded legacy (real tarball): legacy MCP and project files are grandfathered unchanged", async () => {
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
    assert.deepEqual(claude, seededMcp, "claude: legacy project config must remain unchanged");

    const cursor = readJson(cursorMcp);
    assert.deepEqual(cursor, seededMcp, "cursor: legacy user config must remain unchanged");

    const buddy = readJson(buddyMcp);
    assert.deepEqual(buddy, seededMcp, "codebuddy: legacy user config must remain unchanged");

    const toml = fs.readFileSync(codexToml, "utf8");
    assert.equal(toml, OWNED_TOML, "codex: legacy user config must remain byte-identical");
    assert.equal(fs.existsSync(path.join(project, ".trtc-reporting", "install-mode.json")), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, ".trtc-reporting", "install-mode.json"), "utf8")).mode, "legacy_mcp");
    assert.equal(fs.existsSync(path.join(project, ".claude", "skills", "trtc", "runtime", "telemetry.cjs")), false,
      "legacy project must not receive the Node Prompt runtime");
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

test("C19-D5 legacy grandfathering (real tarball): upgrade preserves old chain and installs no Node Prompt Hook", async () => {
  const tmp = makeTmp();
  try {
    const project = path.join(tmp, "project");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    const home = path.join(tmp, "home");
    fs.mkdirSync(home, { recursive: true });
    const claudeMcp = path.join(project, ".mcp.json");
    const before = JSON.stringify({ mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } }, null, 2) + "\n";
    writeJson(claudeMcp, { mcpServers: { "tencent-rtc-skill-tool": OWNED_ENTRY } });
    fs.mkdirSync(path.join(project, ".claude", "skills", "trtc", "tools"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "SKILL.md"),
      "python3 tools/reporting.py prompt --input-stdin\n", "utf8");
    fs.writeFileSync(path.join(project, ".claude", "skills", "trtc", "tools", "reporting.py"), "# legacy\n", "utf8");

    const installResult = runPackagedInstaller(project, home, ["--ide", "claude"]);
    assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);
    assert.equal(fs.readFileSync(claudeMcp, "utf8"), before, "legacy MCP must remain byte-identical");
    assert.equal(fs.existsSync(path.join(project, ".claude", "hooks")), false, "legacy upgrade must not create Node hooks");
    assert.equal(fs.existsSync(path.join(project, ".claude", "skills", "trtc", "runtime", "telemetry.cjs")), false,
      "legacy upgrade must not copy Node runtime");
    const marker = path.join(project, ".trtc-reporting", "install-mode.json");
    assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).mode, "legacy_mcp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
