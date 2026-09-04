"use strict";

// C19 installer-side mode and transaction helpers.  This module deliberately
// owns no user configuration and never removes a legacy MCP entry.  The
// installer uses it before writing Skills, Hooks, instructions, MCP, or
// preferences so an existing project can remain on the grandfathered path.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MODE_SCHEMA_VERSION = 1;
const MODES = new Set(["node_v2", "legacy_mcp"]);
const PROJECT_STATE_DIR = ".trtc-skill-state";
const LEGACY_PROJECT_STATE_DIR = ".trtc-reporting";
const INSTALL_STAGE = "install-stage.json";
const INSTALL_LOCK = "install.lock";
const INSTALL_GRACE_MS = 30_000;
const LEGACY_NAME = "tencent-rtc-skill-tool";
const LEGACY_ARGS = ["-y", "@tencent-rtc/skill-tool@latest"];
const LEGACY_PERMITTED_KEYS = new Set(["command", "args", "type", "env"]);
const STAGES = new Set(["started", "hooks", "instructions", "mcp", "complete"]);

function markerDir(projectRoot, { mode } = {}) {
  const root = path.resolve(projectRoot);
  const current = path.join(root, PROJECT_STATE_DIR);
  const legacy = path.join(root, LEGACY_PROJECT_STATE_DIR);
  // Durable install marker/stage determines ownership. This preserves the
  // old directory for upgrades while making a fresh install use the new name.
  if (fs.existsSync(path.join(current, "install-mode.json")) ||
      fs.existsSync(path.join(current, INSTALL_STAGE))) return current;
  if (fs.existsSync(path.join(legacy, "install-mode.json")) ||
      fs.existsSync(path.join(legacy, INSTALL_STAGE))) return legacy;
  // A legacy-mode install must retain its historical project marker location
  // even when the old project had no state directory before this invocation.
  if (mode === "legacy_mcp") return legacy;
  if (fs.existsSync(current)) return current;
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

function markerPath(projectRoot) {
  return path.join(markerDir(projectRoot), "install-mode.json");
}

function stagePath(projectRoot) {
  return path.join(markerDir(projectRoot), INSTALL_STAGE);
}

function isSymlink(file) {
  try { return fs.lstatSync(file).isSymbolicLink(); }
  catch (err) { return err?.code !== "ENOENT"; }
}

function canonicalizeProjectPath(start) {
  const absolute = path.resolve(start || process.cwd());
  try { return fs.realpathSync.native(absolute); }
  catch { return absolute; }
}

// Kept here as the installer reference for the C19 root-parity fixture. The
// runtime uses the same ordered signals; tests exercise both implementations
// against the shared fixture so a future edit cannot silently split marker
// ownership between installer and Hook.
function findProjectRoot(start) {
  const startRoot = canonicalizeProjectPath(start);
  let current = startRoot;
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.join(current, "lerna.json")) ||
        fs.existsSync(path.join(current, "turbo.json")) ||
        fs.existsSync(path.join(current, ".trtc-session.yaml"))) return current;
    const packageFile = path.join(current, "package.json");
    if (fs.existsSync(packageFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
        if (pkg && pkg.workspaces) return current;
      } catch { /* malformed package continues the walk */ }
    }
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.existsSync(path.join(startRoot, "package.json")) ? startRoot : startRoot;
}

function safeReadJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const value = JSON.parse(raw);
    return { exists: true, valid: true, value };
  } catch (err) {
    if (err?.code === "ENOENT") return { exists: false, valid: false, value: null };
    return { exists: true, valid: false, value: null, error: err };
  }
}

function validMarker(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    value.schema_version === MODE_SCHEMA_VERSION && MODES.has(value.mode) &&
    typeof value.installer_version === "string" && value.installer_version.length <= 128 &&
    typeof value.updated_at === "string" && value.updated_at.length > 0;
}

function readInstallMarker(projectRoot) {
  const dir = markerDir(projectRoot);
  if (isSymlink(dir) || isSymlink(markerPath(projectRoot))) {
    return { status: "invalid", reason: "symlink_path" };
  }
  const result = safeReadJson(markerPath(projectRoot));
  if (!result.exists) return { status: "missing" };
  if (!result.valid || !validMarker(result.value)) {
    return { status: "invalid", reason: "malformed_marker" };
  }
  return { status: "valid", mode: result.value.mode, value: result.value };
}

function readInstallStage(projectRoot) {
  const dir = markerDir(projectRoot);
  if (isSymlink(dir) || isSymlink(stagePath(projectRoot))) {
    return { status: "invalid", reason: "symlink_path" };
  }
  const result = safeReadJson(stagePath(projectRoot));
  if (!result.exists) return { status: "missing" };
  const value = result.value;
  if (!result.valid || !value || typeof value !== "object" || Array.isArray(value) ||
      !MODES.has(value.target_mode) || typeof value.stage !== "string" ||
      !STAGES.has(value.stage) || typeof value.owner_token !== "string" ||
      !/^[0-9a-f]{32}$/.test(value.owner_token) || !Number.isInteger(value.pid) || value.pid <= 0 ||
      !Array.isArray(value.owned_files)) {
    return { status: "invalid", reason: "malformed_stage" };
  }
  return { status: "valid", value };
}

function ownedStagePaths(projectRoot) {
  const root = path.resolve(projectRoot);
  const paths = [];
  const skillRoots = [".claude/skills", ".cursor/skills", ".codebuddy/skills", ".codex/skills"];
  for (const skillRoot of skillRoots) paths.push(path.join(root, skillRoot, "trtc", "runtime", "telemetry.cjs"));
  paths.push(
    path.join(root, "CLAUDE.md"), path.join(root, "AGENTS.md"), path.join(root, "CODEBUDDY.md"),
    path.join(root, ".cursor", "rules", "ui-mode.mdc"),
    path.join(root, ".claude", "settings.json"), path.join(root, ".codebuddy", "settings.json"),
    path.join(root, ".codex", "hooks.json"), path.join(root, ".cursor", "hooks.json"),
  );
  return paths;
}

function ownedFilesSnapshot(projectRoot) {
  const root = path.resolve(projectRoot);
  const files = [];
  for (const file of ownedStagePaths(root)) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      files.push({
        path: path.relative(root, file).split(path.sep).join("/"),
        size: stat.size,
        mtime_ms: stat.mtimeMs,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      });
    } catch { /* absent installer-owned file is not in the snapshot */ }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function sameOwnedFiles(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return err?.code === "EPERM" ? true : err?.code === "ESRCH" ? false : null; }
}

function stageMinimumFootprint(projectRoot, stage) {
  const files = ownedFilesSnapshot(projectRoot);
  const paths = new Set(files.map((file) => file.path));
  const runtimes = [
    ".claude/skills/trtc/runtime/telemetry.cjs", ".cursor/skills/trtc/runtime/telemetry.cjs",
    ".codebuddy/skills/trtc/runtime/telemetry.cjs", ".codex/skills/trtc/runtime/telemetry.cjs",
  ];
  if (stage === "started") return true;
  if (stage === "hooks") return runtimes.some((file) => paths.has(file));
  if (stage === "instructions") {
    return runtimes.some((file) => paths.has(file)) &&
      ["CLAUDE.md", "AGENTS.md", "CODEBUDDY.md", ".cursor/rules/ui-mode.mdc"].some((file) => paths.has(file));
  }
  if (stage === "mcp" || stage === "complete") {
    return runtimes.some((file) => paths.has(file)) &&
      (paths.has(".claude/settings.json") || paths.has(".codebuddy/settings.json") || paths.has(".codex/hooks.json") || paths.has("CLAUDE.md"));
  }
  return false;
}

function isOwnedLegacyEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  if (Object.keys(entry).some((key) => !LEGACY_PERMITTED_KEYS.has(key))) return false;
  if (entry.command !== "npx" || !Array.isArray(entry.args) ||
      entry.args.length !== 2 || entry.args[0] !== LEGACY_ARGS[0] || entry.args[1] !== LEGACY_ARGS[1]) return false;
  if (entry.type !== undefined && entry.type !== "stdio") return false;
  if (entry.env !== undefined) {
    if (!entry.env || typeof entry.env !== "object" || Array.isArray(entry.env)) return false;
    const keys = Object.keys(entry.env);
    if (keys.length > 1 || (keys.length === 1 && (keys[0] !== "PATH" || typeof entry.env.PATH !== "string"))) return false;
  }
  return true;
}

function jsonHasOwnedMcp(file) {
  const result = safeReadJson(file);
  if (!result.exists || !result.valid || !result.value || typeof result.value !== "object") return false;
  return isOwnedLegacyEntry(result.value?.mcpServers?.[LEGACY_NAME]);
}

function tomlHasOwnedMcp(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return false; }
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\[mcp_servers\.tencent-rtc-skill-tool\]\s*$/.test(line));
  if (start < 0) return false;
  const section = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) break;
    section.push(lines[i]);
  }
  const sectionText = section.join("\n");
  const command = sectionText.match(/^\s*command\s*=\s*["']([^"']+)["']\s*$/m)?.[1];
  const args = sectionText.match(/^\s*args\s*=\s*\[\s*["']-y["']\s*,\s*["']@tencent-rtc\/skill-tool@latest["']\s*\]\s*$/m);
  return command === "npx" && !!args;
}

function legacyMcpPaths({ home = os.homedir(), projectRoot } = {}) {
  const root = path.resolve(projectRoot);
  return [
    path.join(root, ".mcp.json"),
    path.join(home, ".cursor", "mcp.json"),
    path.join(home, ".codebuddy", "mcp.json"),
    path.join(home, ".codex", "config.toml"),
  ];
}

function hasLegacyMcp({ home, projectRoot } = {}) {
  return legacyMcpPaths({ home, projectRoot }).some((file) =>
    file.endsWith("config.toml") ? tomlHasOwnedMcp(file) : jsonHasOwnedMcp(file));
}

// A project-local .mcp.json is stronger evidence than a user-level MCP
// configuration: it is loaded for this exact project and can therefore
// coexist with the Node Hook chain after a partial/older install.  User-level
// MCP alone remains intentionally ignored for fresh-project classification.
function hasProjectLegacyMcp(projectRoot) {
  return jsonHasOwnedMcp(path.join(path.resolve(projectRoot), ".mcp.json"));
}

function containsLegacyInstruction(file) {
  try {
    const content = fs.readFileSync(file, "utf8");
    return /reporting\.py\s+(?:bind-session)|tencent-rtc-skill-tool|skill_analysis/.test(content);
  } catch { return false; }
}

function hasLegacyHookFootprint(projectRoot, { ides = ["claude", "cursor", "codebuddy", "codex"] } = {}) {
  const root = path.resolve(projectRoot);
  const settings = [
    ".claude/settings.json", ".cursor/hooks.json", ".codebuddy/settings.json", ".codex/hooks.json",
  ];
  return settings.some((file) => {
    try { return /reporting\.py|tencent-rtc-skill-tool|skill_analysis/.test(fs.readFileSync(path.join(root, file), "utf8")); }
    catch { return false; }
  });
}

function hasLegacySkillFootprint(projectRoot, { ides = ["claude", "cursor", "codebuddy", "codex"] } = {}) {
  const root = path.resolve(projectRoot);
  const skillRoots = { claude: ".claude/skills", cursor: ".cursor/skills", codebuddy: ".codebuddy/skills", codex: ".codex/skills" };
  const oldSkill = ides.some((ide) => {
    const skill = path.join(root, skillRoots[ide] || "", "trtc");
    return fs.existsSync(path.join(skill, "SKILL.md"))
      && fs.existsSync(path.join(skill, "tools", "reporting.py"))
      && !fs.existsSync(path.join(skill, "runtime", "telemetry.cjs"));
  });
  const instructionFiles = ["CLAUDE.md", "AGENTS.md", "CODEBUDDY.md", ".cursor/rules/ui-mode.mdc"];
  return oldSkill || instructionFiles.some((file) => containsLegacyInstruction(path.join(root, file)));
}

function hasNodeFootprint(projectRoot, { ides = ["claude", "cursor", "codebuddy", "codex"] } = {}) {
  const root = path.resolve(projectRoot);
  const skillRoots = { claude: ".claude/skills", cursor: ".cursor/skills", codebuddy: ".codebuddy/skills", codex: ".codex/skills" };
  return ides.some((ide) => {
    return fs.existsSync(path.join(root, skillRoots[ide] || "", "trtc", "runtime", "telemetry.cjs"));
  });
}

function resolveReportingMode(projectRoot, { home = os.homedir(), ides, now = new Date() } = {}) {
  const root = path.resolve(projectRoot);
  const marker = readInstallMarker(root);
  const legacySkill = hasLegacySkillFootprint(root, { ides });
  const legacyMcp = hasLegacyMcp({ home, projectRoot: root });
  const projectLegacyMcp = hasProjectLegacyMcp(root);
  const legacyFootprint = legacySkill && legacyMcp;
  const stage = readInstallStage(root);

  if (marker.status === "invalid") return { mode: "unknown", reason: marker.reason };
  if (marker.status === "valid") {
    // A stable marker is authoritative for a completed install.  Only an
    // explicit old Hook plus old MCP is a contradiction; the current Node
    // instructions themselves still mention the Python compatibility shim,
    // and a user-level old MCP alone must not downgrade a Node project.
    // A project-local MCP config is authoritative evidence for this project,
    // even when no old Skill footprint remains.  A user-level MCP config is
    // only evidence when paired with an old project Hook/Skill; otherwise it
    // may belong to another project and must not taint a fresh install.
    if (marker.mode === "node_v2"
      && (projectLegacyMcp || (legacyMcp && (legacySkill || hasLegacyHookFootprint(root, { ides }))))) {
      return { mode: "unknown", reason: "marker_footprint_conflict" };
    }
    return { mode: marker.mode, reason: "marker" };
  }
  if (stage.status === "invalid") return { mode: "unknown", reason: stage.reason };
  if (stage.status === "valid" && stage.value.target_mode === "node_v2") {
    const alive = isPidAlive(stage.value.pid);
    if (alive !== false) return { mode: "unknown", reason: alive === true ? "install_in_progress" : "install_owner_unknown" };
    if (projectLegacyMcp || legacyFootprint || legacySkill) return { mode: "unknown", reason: "stage_footprint_conflict" };
    if (!stageMinimumFootprint(root, stage.value.stage)
      || !sameOwnedFiles(stage.value.owned_files, ownedFilesSnapshot(root))) {
      return { mode: "unknown", reason: "stage_footprint_changed" };
    }
    if (hasNodeFootprint(root, { ides })) return { mode: "node_v2", reason: "resume_stage" };
    if (stage.value.stage === "started") return { mode: "node_v2", reason: "resume_stage" };
    return { mode: "unknown", reason: "stage_footprint_missing" };
  }
  if (legacyFootprint) return { mode: "legacy_mcp", reason: "legacy_footprint" };
  if (projectLegacyMcp) return { mode: "unknown", reason: "project_legacy_mcp" };
  if (legacySkill && !legacyMcp) return { mode: "unknown", reason: "legacy_mcp_missing" };
  // A user-level old MCP by itself does not make a new project legacy.
  return { mode: "node_v2", reason: "fresh_project" };
}

function atomicJsonWrite(file, value) {
  const dir = path.dirname(file);
  if (isSymlink(dir) || isSymlink(file)) {
    const err = new Error("C19 state path must not be a symlink"); err.code = "REPORTING_STATE_SYMLINK"; throw err;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch (err) { if (err?.code !== "ENOENT") throw err; }
  }
}

function writeInstallMarker(projectRoot, mode, { installerVersion = "unknown", now = new Date() } = {}) {
  if (!MODES.has(mode)) throw new TypeError("only stable reporting modes may be committed");
  const dir = markerDir(projectRoot, { mode });
  atomicJsonWrite(path.join(dir, "install-mode.json"), {
    schema_version: MODE_SCHEMA_VERSION,
    mode,
    installer_version: String(installerVersion).slice(0, 128),
    updated_at: new Date(now).toISOString(),
  });
  return path.join(dir, "install-mode.json");
}

function writeInstallStage(projectRoot, targetMode, stage, { installerVersion = "unknown", ownerToken, ownerPid = process.pid, now = new Date() } = {}) {
  if (!MODES.has(targetMode)) throw new TypeError("invalid install stage mode");
  const token = ownerToken || crypto.randomBytes(16).toString("hex");
  atomicJsonWrite(stagePath(projectRoot), {
    schema_version: MODE_SCHEMA_VERSION,
    target_mode: targetMode,
    stage: String(stage),
    installer_version: String(installerVersion).slice(0, 128),
    owner_token: token,
    pid: ownerPid,
    updated_at: new Date(now).toISOString(),
    owned_files: ownedFilesSnapshot(projectRoot),
  });
  return { path: stagePath(projectRoot), ownerToken: token };
}

function clearInstallStage(projectRoot) {
  try { fs.unlinkSync(stagePath(projectRoot)); return true; }
  catch (err) { if (err?.code === "ENOENT") return false; throw err; }
}

function acquireProjectInstallLock(projectRoot, { now = Date.now(), graceMs = INSTALL_GRACE_MS } = {}) {
  const dir = markerDir(projectRoot);
  if (isSymlink(dir)) return { acquired: false, reason: "symlink_path" };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, INSTALL_LOCK);
  const token = crypto.randomBytes(16).toString("hex");
  const body = JSON.stringify({ pid: process.pid, token, started_at: now });
  try {
    fs.writeFileSync(lockPath, body, { flag: "wx", mode: process.platform === "win32" ? undefined : 0o600 });
    return { acquired: true, path: lockPath, token };
  } catch (err) {
    if (err?.code !== "EEXIST") return { acquired: false, reason: "lock_io_error" };
  }
  let existing;
  try { existing = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { existing = null; }
  let alive = null;
  if (typeof existing?.pid === "number") {
    try { process.kill(existing.pid, 0); alive = true; }
    catch (killErr) { if (killErr.code === "ESRCH") alive = false; }
  }
  let mtime = 0;
  try { mtime = fs.statSync(lockPath).mtimeMs; } catch { return { acquired: false, reason: "busy" }; }
  if (alive !== false || now - mtime < graceMs) return { acquired: false, reason: "busy" };
  const stale = `${lockPath}.stale.${token}`;
  try { fs.renameSync(lockPath, stale); } catch { return { acquired: false, reason: "busy" }; }
  try {
    fs.writeFileSync(lockPath, body, { flag: "wx", mode: process.platform === "win32" ? undefined : 0o600 });
  } catch {
    // Restore the displaced orphan only without clobbering a racer that
    // acquired the canonical path while we were reclaiming it.
    try { fs.linkSync(stale, lockPath); } catch {}
    try { fs.unlinkSync(stale); } catch {}
    return { acquired: false, reason: "busy" };
  }
  try { fs.unlinkSync(stale); } catch {}
  return { acquired: true, path: lockPath, token };
}

function releaseProjectInstallLock(lock, { force = false } = {}) {
  if (!lock?.path || !lock?.token) return false;
  const releasing = `${lock.path}.releasing.${lock.token}`;
  try { fs.renameSync(lock.path, releasing); }
  catch (err) { if (err?.code === "ENOENT") return true; return false; }
  let current;
  try { current = JSON.parse(fs.readFileSync(releasing, "utf8")); } catch { current = null; }
  if (force || current?.token === lock.token) {
    try { fs.unlinkSync(releasing); } catch (err) { if (err?.code !== "ENOENT") throw err; }
    return true;
  }
  // The inode was replaced between rename and verification (PID reuse or a
  // stale-lock cleaner race). Restore our displaced lock only if the path is
  // still free; never overwrite the new owner's lock.
  try {
    fs.linkSync(releasing, lock.path);
    fs.unlinkSync(releasing);
  } catch {
    try { fs.unlinkSync(releasing); } catch (err) { if (err?.code !== "ENOENT") throw err; }
  }
  return false;
}

module.exports = {
  MODE_SCHEMA_VERSION,
  MODES,
  PROJECT_STATE_DIR,
  LEGACY_PROJECT_STATE_DIR,
  markerDir,
  markerPath,
  stagePath,
  canonicalizeProjectPath,
  findProjectRoot,
  readInstallMarker,
  readInstallStage,
  resolveReportingMode,
  hasLegacyMcp,
  hasProjectLegacyMcp,
  hasLegacySkillFootprint,
  hasNodeFootprint,
  ownedFilesSnapshot,
  isPidAlive,
  writeInstallMarker,
  writeInstallStage,
  clearInstallStage,
  acquireProjectInstallLock,
  releaseProjectInstallLock,
};
