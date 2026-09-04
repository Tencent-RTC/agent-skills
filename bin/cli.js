#!/usr/bin/env node

"use strict";

/**
 * @tencent-rtc/trtc-agent-skills installer
 *
 * Installs the TRTC AI Integration skill suite (cross-referencing skills:
 * trtc + trtc-onboarding/docs/topic/search/apply + trtc-ai-service) plus the
 * shared knowledge-base into your IDE's skills directory, and wires up the
 * `trtc-push-mcp` MCP server for offline push notifications.
 *
 * IMPORTANT — why skills are copied as SIBLING DIRECTORIES:
 *   The entry skill `trtc/SKILL.md` routes to the others via relative paths
 *   like `../trtc-onboarding/SKILL.md`. They MUST remain siblings under the
 *   same skills root, otherwise routing breaks. We therefore copy each
 *   skills/<name>/ dir verbatim — we never concatenate them.
 *
 * Usage:
 *   npx @tencent-rtc/trtc-agent-skills add
 *   npx @tencent-rtc/trtc-agent-skills add --ide cursor
 *   npx @tencent-rtc/trtc-agent-skills add --ide all
 *   npx @tencent-rtc/trtc-agent-skills add --clean
 *   npx @tencent-rtc/trtc-agent-skills add --prompt-reporting off
 *   npx @tencent-rtc/trtc-agent-skills add --no-report
 *   npx @tencent-rtc/trtc-agent-skills add --list
 *   npx @tencent-rtc/trtc-agent-skills add --help
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const {
  markerDir,
  resolveReportingMode,
  findProjectRoot,
  writeInstallMarker,
  writeInstallStage,
  clearInstallStage,
  acquireProjectInstallLock,
  releaseProjectInstallLock,
} = require("./reporting-mode");

// ── tiny color helpers (no deps) ───────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s) => (useColor ? `\x1b[1m${s}\x1b[0m`  : s),
  cyan:   (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  green:  (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red:    (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  gray:   (s) => (useColor ? `\x1b[90m${s}\x1b[0m` : s),
  dim:    (s) => (useColor ? `\x1b[2m${s}\x1b[0m`  : s),
};

// ── paths ───────────────────────────────────────────────────────────────────────
const PKG_ROOT    = path.resolve(__dirname, "..");
const PKG_JSON    = require(path.join(PKG_ROOT, "package.json"));
const PKG_VERSION = PKG_JSON.version || "0.0.0";
const SKILLS_SRC  = path.join(PKG_ROOT, "skills");
const KB_SRC      = path.join(PKG_ROOT, "knowledge-base");
const HOOKS_SRC   = path.join(PKG_ROOT, "hooks");
const COMMANDS_SRC = path.join(PKG_ROOT, "commands");

// Dynamically discover all skills under SKILLS_SRC. Each skill must be a
// directory containing a SKILL.md entry point. `trtc` is always listed first;
// the rest are sorted alphabetically. This avoids the stale-hardcoded-list
// problem — adding a new skill directory is enough to get it installed.
//
// Security: only skills in SKILL_ALLOWLIST are installed. This prevents
// draft / fork / debug directories from being silently picked up.
const SKILL_ALLOWLIST = new Set([
  "trtc",
  "trtc-docs",
  "trtc-call",
  "trtc-conference",
  "trtc-ai-service",
  "trtc-ai-oral-coach",
  "trtc-ai-realtime-interpreter",
  "trtc-chat",
  "trtc-push",
  "trtc-sdk-log-analysis",
]);

function getSkillNames() {
  return fs.readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => SKILL_ALLOWLIST.has(name))
    .filter(name => fs.existsSync(path.join(SKILLS_SRC, name, "SKILL.md")))
    .sort((a, b) => {
      if (a === "trtc") return -1;
      if (b === "trtc") return 1;
      return a.localeCompare(b);
    });
}

// IDE skill-install targets (project-level). Each IDE reads skills from a
// different directory, but the layout inside is identical: one dir per skill.
const IDE_TARGETS = {
  claude:    { skillsRoot: ".claude/skills",    kind: "dir" },
  cursor:    { skillsRoot: ".cursor/skills",    kind: "dir" },
  codebuddy: { skillsRoot: ".codebuddy/skills", kind: "dir" },
  // Codex looks for hooks at <repo>/.codex/hooks.json (per
  // https://developers.openai.com/codex/hooks). We co-locate skills under
  // .codex/ as well so the rewritten hook commands (which use absolute paths)
  // point at the same root the hook config sits next to.
  codex:     { skillsRoot: ".codex/skills",     kind: "dir" },
};

// Project-level custom slash commands. Codex intentionally has no entry here:
// current Codex invokes project skills with `$skill-name`, not project custom
// slash-command files. Its explicit entry is provided by the installed Skill
// plus agents/openai.yaml metadata.
const COMMAND_TARGETS = {
  claude:    { sourceDir: "claude",    commandsRoot: ".claude/commands" },
  cursor:    { sourceDir: "cursor",    commandsRoot: ".cursor/commands" },
  codebuddy: { sourceDir: "codebuddy", commandsRoot: ".codebuddy/commands" },
};
const COMMAND_MARKER = "<!-- trtc-agent-skills:sdk-log -->";

// MCP config locations per IDE.
//   claude:    project-level <root>/.mcp.json (JSON)
//   cursor:    user-level ~/.cursor/mcp.json (JSON)
//   codebuddy: user-level ~/.codebuddy/mcp.json (JSON)
//   codex:     user-level ~/.codex/config.toml (TOML, [mcp_servers.xxx])
const MCP_TARGETS = {
  claude:    { configFile: ".mcp.json",                                       format: "json" },
  cursor:    { configFile: path.join(os.homedir(), ".cursor",    "mcp.json"),    format: "json" },
  codebuddy: { configFile: path.join(os.homedir(), ".codebuddy", "mcp.json"),    format: "json" },
  codex:     { configFile: path.join(os.homedir(), ".codex", "config.toml"),     format: "toml" },
};

// C19: Legacy reporting MCP — no longer installed; migrated away on upgrade.
const LEGACY_REPORTING_MCP_NAME    = "tencent-rtc-skill-tool";
const LEGACY_REPORTING_MCP_COMMAND = "npx";
const LEGACY_REPORTING_MCP_ARGS    = ["-y", "@tencent-rtc/skill-tool@latest"];
const LEGACY_REPORTING_CLAUDE_PERM = `mcp__${LEGACY_REPORTING_MCP_NAME}__*`;
const LEGACY_REPORTING_CURSOR_PERM = `${LEGACY_REPORTING_MCP_NAME}:skill_analysis`;

// Multi-MCP registry. Maintainers can force a local checkout via
// TRTC_PUSH_MCP_ENTRY / TIMPUSH_MCP_ENTRY when validating unpublished MCP code.
const TRTC_PUSH_MCP_NAME = "trtc-push-mcp";
const TRTC_PUSH_MCP_PACKAGE = process.env.TRTC_PUSH_MCP_PACKAGE || "@tencent-rtc/trtc-push-mcp@1";

function getDefaultPathFallbacks({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") {
    const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
    return [path.win32.join(systemRoot, "System32"), systemRoot];
  }
  return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
}

function buildNodePathEnv({
  execPath = process.execPath,
  pathEnv = process.env.PATH || "",
  platform = process.platform,
  env = process.env,
} = {}) {
  const nodeBin = path.dirname(execPath);
  const fallback = getDefaultPathFallbacks({ platform, env });
  const seen = new Set();
  return [nodeBin, ...pathEnv.split(path.delimiter), ...fallback]
    .filter(Boolean)
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join(path.delimiter);
}

function buildNpxMcpEntry(packageName, { execPath = process.execPath, pathEnv = process.env.PATH || "" } = {}) {
  return {
    type: "stdio",
    command: "npx",
    args: ["-y", packageName],
    env: {
      PATH: buildNodePathEnv({ execPath, pathEnv }),
    },
  };
}

function resolveTrtcPushMcpEntry({
  env = process.env,
  execPath = process.execPath,
  existsSync = fs.existsSync,
} = {}) {
  const fromEnv = env.TRTC_PUSH_MCP_ENTRY || env.TIMPUSH_MCP_ENTRY;
  if (fromEnv && existsSync(fromEnv)) {
    return {
      command: "node",
      args: [path.resolve(fromEnv)],
      source: "env",
      env: { TRTC_PUSH_MCP_REPORT_DISABLED: "1" },
    };
  }
  return {
    ...buildNpxMcpEntry(env.TRTC_PUSH_MCP_PACKAGE || TRTC_PUSH_MCP_PACKAGE, {
      execPath,
      pathEnv: env.PATH || "",
    }),
    source: "npm",
  };
}

function getMcpServersToInstall() {
  const trtcPushMcp = resolveTrtcPushMcpEntry();
  const entry = {
    type: "stdio",
    command: trtcPushMcp.command,
    args: trtcPushMcp.args,
  };
  if (trtcPushMcp.env) entry.env = trtcPushMcp.env;
  const note =
    trtcPushMcp.source === "npm"
      ? `npm → ${trtcPushMcp.args[1]}`
      : `local → ${trtcPushMcp.args[0]}`;
  return [{ name: TRTC_PUSH_MCP_NAME, entry, note }];
}

// Hooks distribution targets per IDE.
//   claude / codebuddy / codex: hooks/hooks.json is structurally rewritten and
//     merged into project config. Shared .{ide}/hooks/ directories are untouched.
//     The original hooks.json uses ${CLAUDE_PLUGIN_ROOT} / ${CODEBUDDY_PLUGIN_ROOT}
//     placeholders that get expanded by the IDE in plugin mode; in npx mode we
//     materialize them to absolute paths under the IDE's settings dir.
//   cursor: hooks-cursor.json is rewritten + merged into <root>/.cursor/hooks.json
//     (project-level). cursor-adapter.py is copied to
//     <root>/.cursor/hooks/trtc-agent-skills/ and its hardcoded
//     $HOME/.cursor/plugins/local/... reference is rewritten to the actual path.
const HOOKS_TARGETS = {
  claude: {
    hooksDir:        ".claude/hooks",
    settingsFile:    ".claude/settings.json",
    sourceConfig:    "hooks.json",
    rootPlaceholder: "${CLAUDE_PLUGIN_ROOT}",
    rootRewrite:     ".claude",
    fallbackPlaceholder: "${CODEBUDDY_PLUGIN_ROOT}",
    hostIde:           "claude",
  },
  codebuddy: {
    hooksDir:        ".codebuddy/hooks",
    settingsFile:    ".codebuddy/settings.json",
    sourceConfig:    "hooks.json",
    rootPlaceholder: "${CODEBUDDY_PLUGIN_ROOT}",
    rootRewrite:     ".codebuddy",
    fallbackPlaceholder: "${CLAUDE_PLUGIN_ROOT}",
    // CodeBuddy's settings parser is stricter than Claude's and some desktop
    // releases silently discard a matcher group containing our ownership
    // marker. Ownership is also recoverable from the absolute command path,
    // so keep the emitted config to the documented schema for this host.
    strictSchema:    true,
    hostIde:           "codebuddy",
  },
  codex: {
    hooksDir:        ".codex/hooks",
    // Codex loads hooks from <repo>/.codex/hooks.json (or ~/.codex/hooks.json)
    // — NOT from .agents/settings.json. See https://developers.openai.com/codex/hooks
    //
    // Codex CLI ≥0.135 parses hooks.json with a strict serde schema that rejects
    // unknown top-level fields ("unknown field `__trtc_agent_skills__`, expected
    // `hooks`"). We therefore mark codex as `strictSchema: true` so the merge
    // logic skips the marker injection (uninstall identifies our entries by
    // hook command path substrings instead — see OWNED_COMMAND_HINTS).
    settingsFile:    ".codex/hooks.json",
    sourceConfig:    "hooks.json",
    rootPlaceholder: "${CLAUDE_PLUGIN_ROOT}",
    rootRewrite:     ".codex",
    fallbackPlaceholder: "${CODEBUDDY_PLUGIN_ROOT}",
    strictSchema:    true,
    hostIde:         "codex",
  },
  cursor: {
    // Namespace under .cursor/hooks/trtc-agent-skills/ so we never collide
    // with another skill's hooks/ contents. cursor-adapter.py auto-detects
    // PLUGIN_ROOT by walking up to the nearest dir containing skills/, so
    // this nested location still resolves correctly.
    hooksDir:        ".cursor/hooks/trtc-agent-skills",
    settingsFile:    ".cursor/hooks.json",
    sourceConfig:    "hooks-cursor.json",
    // The hardcoded path string we need to rewrite in hooks-cursor.json.
    cursorAdapterPlaceholder: "$HOME/.cursor/plugins/local/trtc-agent-skills/hooks/cursor-adapter.py",
  },
};

// For IDEs whose hook config schema rejects unknown fields (codex), we cannot
// embed our `__trtc_agent_skills__` ownership markers. Instead, uninstall
// detects "our" hook entries by checking whether any command string contains
// one of these path-segment hints — every guardrail script we ship lives under
// `skills/<skill>/hooks/` or `skills/<skill>/guardrails/`, and the cursor
// adapter under our namespaced hooks subdir.
// NOTE: trtc-topic and trtc-apply are no longer in SKILL_ALLOWLIST, but their
// hints are kept here so --clean can remove hook entries left by older installs.
const OWNED_COMMAND_HINTS = [
  "/skills/trtc/hooks/",
  "/skills/trtc/tools/reporting.py",
  "/skills/trtc/runtime/telemetry.cjs",
  "/skills/trtc/runtime/stop-hook-dispatcher.cjs",
  "/skills/trtc/room-builder/guardrails/",
  "/skills/trtc-topic/guardrails/",   // legacy — removed from allowlist, kept for cleanup
  "/skills/trtc-apply/guardrails/",   // legacy — removed from allowlist, kept for cleanup
  "/skills/trtc-conference/hooks/",
  "/hooks/trtc-agent-skills/cursor-adapter.py",
];

function isOwnedHookCommand(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.command !== "string") return false;
  const normalized = entry.command.replace(/\\/g, "/");
  return OWNED_COMMAND_HINTS.some(hint => normalized.includes(hint));
}

function isOwnedHookEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.__trtc_agent_skills__) return true;
  // Cursor-style: { command: "...", ... }
  if (isOwnedHookCommand(entry)) {
    return true;
  }
  // Claude/Codex-style: { matcher?, hooks: [{ command, ... }] }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(h => h && typeof h === "object"
      && typeof h.command === "string"
      && OWNED_COMMAND_HINTS.some(hint => h.command.includes(hint)));
  }
  return false;
}

// Remove only our nested command, never an entire matcher group containing
// user-owned sibling hooks. The group is removed only when hooks[] is empty.
function stripOwnedHookEntries(value) {
  if (!Array.isArray(value)) return value;
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") { out.push(entry); continue; }
    if (Array.isArray(entry.hooks)) {
      const hooks = entry.hooks.filter(h => !isOwnedHookEntry(h));
      if (hooks.length > 0) {
        const kept = { ...entry, hooks };
        delete kept.__trtc_agent_skills__;
        out.push(kept);
      }
      continue;
    }
    if (!isOwnedHookEntry(entry)) out.push(entry);
  }
  return out;
}

function quotePosixArg(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function quoteWindowsArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildPromptHookCommand({ ide, nodePath = process.execPath, runtimePath, cwd = null, platform = process.platform }) {
  if (!HOOKS_TARGETS[ide]) throw new Error(`unsupported hook IDE: ${ide}`);
  if (!fs.existsSync(nodePath)) {
    const err = new Error("Node runtime not found"); err.code = "NODE_NOT_FOUND"; throw err;
  }
  if (!runtimePath || !fs.existsSync(runtimePath)) {
    const err = new Error("Telemetry runtime not found"); err.code = "RUNTIME_NOT_FOUND"; throw err;
  }
  const cwdArg = typeof cwd === "string" && cwd.length > 0
    ? ` --cwd ${quotePosixArg(cwd)}` : "";
  const cwdArgWindows = typeof cwd === "string" && cwd.length > 0
    ? ` --cwd ${quoteWindowsArg(cwd)}` : "";
  const command = `${quotePosixArg(nodePath)} ${quotePosixArg(runtimePath)} hook --ide ${quotePosixArg(ide)}${cwdArg}`;
  const commandWindows = `${quoteWindowsArg(nodePath)} ${quoteWindowsArg(runtimePath)} hook --ide ${quoteWindowsArg(ide)}${cwdArgWindows}`;
  return { command: platform === "win32" && ide === "cursor" ? commandWindows : command, commandWindows };
}

// Post-answer lifecycle fallback. Prompt Hooks are intentionally local-only;
// this command is wired to every host's Stop event. Stop runs after the
// assistant response and can safely perform the bounded foreground
// promote/flush when the host skipped the model-issued invoke instruction.
function buildHostStopCommand({ ide, nodePath = process.execPath, runtimePath, cwd = null, platform = process.platform }) {
  if (!HOOKS_TARGETS[ide]) throw new Error(`unsupported hook IDE: ${ide}`);
  if (!fs.existsSync(nodePath)) {
    const err = new Error("Node runtime not found"); err.code = "NODE_NOT_FOUND"; throw err;
  }
  if (!runtimePath || !fs.existsSync(runtimePath)) {
    const err = new Error("Telemetry runtime not found"); err.code = "RUNTIME_NOT_FOUND"; throw err;
  }
  const runtimeDir = path.dirname(runtimePath);
  const wrapperPath = path.join(runtimeDir, "stop-hook-dispatcher.cjs");
  if (!fs.existsSync(wrapperPath)) {
    const err = new Error("Stop hook dispatcher not found"); err.code = "STOP_DISPATCHER_NOT_FOUND"; throw err;
  }
  const guardPath = path.join(runtimeDir, "..", "hooks", "stop_require_apply_evidence.py");
  // Cursor has its own Stop output channel and historically did not run the
  // conference evidence guard. Keep its direct runtime command; the other
  // hosts need the wrapper so guard failures cannot discard structured JSON.
  const cwdArg = typeof cwd === "string" && cwd.length > 0
    ? ` --cwd ${quotePosixArg(cwd)}` : "";
  const cwdArgWindows = typeof cwd === "string" && cwd.length > 0
    ? ` --cwd ${quoteWindowsArg(cwd)}` : "";
  if (ide === "cursor") {
    const command = `${quotePosixArg(nodePath)} ${quotePosixArg(runtimePath)} host-stop --ide ${quotePosixArg(ide)}${cwdArg}`;
    const commandWindows = `${quoteWindowsArg(nodePath)} ${quoteWindowsArg(runtimePath)} host-stop --ide ${quoteWindowsArg(ide)}${cwdArgWindows}`;
    return { command: platform === "win32" ? commandWindows : command, commandWindows };
  }
  const guardArg = fs.existsSync(guardPath) ? ` --guard-path ${quotePosixArg(guardPath)}` : "";
  const guardArgWindows = fs.existsSync(guardPath) ? ` --guard-path ${quoteWindowsArg(guardPath)}` : "";
  const command = `${quotePosixArg(nodePath)} ${quotePosixArg(wrapperPath)} --ide ${quotePosixArg(ide)} --runtime-path ${quotePosixArg(runtimePath)}${cwdArg}${guardArg}`;
  const commandWindows = `${quoteWindowsArg(nodePath)} ${quoteWindowsArg(wrapperPath)} --ide ${quoteWindowsArg(ide)} --runtime-path ${quoteWindowsArg(runtimePath)}${cwdArgWindows}${guardArgWindows}`;
  return { command: platform === "win32" && ide === "cursor" ? commandWindows : command, commandWindows };
}

function writeJsonAtomic(file, value) {
  // Preserve dotfiles-managed config symlinks. Renaming over the symlink path
  // would replace the link itself and silently sever future synchronization;
  // instead atomically replace the resolved target in its own directory.
  let target = file;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      try { target = fs.realpathSync(file); }
      catch {
        const err = new Error("Hook config symlink target is unavailable");
        err.code = "CONFIG_INVALID";
        throw err;
      }
      if (!fs.statSync(target).isFile()) {
        const err = new Error("Hook config symlink target is not a file");
        err.code = "CONFIG_INVALID";
        throw err;
      }
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  ensureDir(path.dirname(target));
  const tmp = path.join(path.dirname(target), `.${crypto.randomBytes(6).toString("hex")}.${path.basename(target)}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, target);
    try {
      const dirFd = fs.openSync(path.dirname(target), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (err) {
      if (!err || !["EINVAL", "ENOSYS", "EPERM", "EACCES", "ENOENT"].includes(err.code)) throw err;
    }
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(tmp); } catch (err) { if (err?.code !== "ENOENT") throw err; }
  }
}

// AI instruction files distribution per IDE.
//   - root-md  : project-root markdown files (CLAUDE.md / AGENTS.md / CODEBUDDY.md).
//                If the file already exists, our content is wrapped in HTML
//                markers and injected/replaced inside the user's existing file.
//   - cursor-rule : a Cursor MDC rule with `alwaysApply: true` frontmatter.
//                Filename collision is virtually nil (users don't write a
//                ui-mode.mdc themselves), so we just copy/overwrite.
const AI_INSTRUCTION_TARGETS = {
  claude:    { type: "root-md",     filename: "CLAUDE.md" },
  codex:     { type: "root-md",     filename: "AGENTS.md" },
  codebuddy: { type: "root-md",     filename: "CODEBUDDY.md" },
  cursor:    { type: "cursor-rule", filename: ".cursor/rules/ui-mode.mdc" },
};

// Markers used to bracket our content inside user-owned root markdown files.
// Stable across versions so re-installs replace the prior block in place.
const MD_MARKER_BEGIN = "<!-- TRTC-AGENT-SKILLS:BEGIN -->";
const MD_MARKER_END   = "<!-- TRTC-AGENT-SKILLS:END -->";

// Remove every owned marker block, including nested/leftover markers from
// older installers.  A simple non-greedy regex only removes up to the first
// END marker; after an interrupted or repeated install that leaves trailing
// END markers and causes the next install to append a second dispatcher block.
// If a BEGIN marker has no matching END, keep the file untouched rather than
// deleting user content that may sit below the malformed block.
function stripOwnedMarkerBlocks(existing) {
  let output = "";
  let cursor = 0;
  let scan = 0;
  let depth = 0;
  while (scan < existing.length) {
    const begin = existing.indexOf(MD_MARKER_BEGIN, scan);
    const end = existing.indexOf(MD_MARKER_END, scan);
    if (begin < 0 && end < 0) break;
    const isBegin = begin >= 0 && (end < 0 || begin < end);
    const index = isBegin ? begin : end;
    if (isBegin) {
      if (depth === 0) output += existing.slice(cursor, index);
      depth += 1;
      scan = index + MD_MARKER_BEGIN.length;
    } else {
      if (depth === 0) {
        // An orphan END is installer residue; preserve surrounding user text
        // but remove the marker itself.
        output += existing.slice(cursor, index);
        cursor = index + MD_MARKER_END.length;
      } else {
        depth -= 1;
        if (depth === 0) cursor = index + MD_MARKER_END.length;
      }
      scan = index + MD_MARKER_END.length;
    }
  }
  if (depth !== 0) return null;
  return output + existing.slice(cursor);
}

// Knowledge-base lives next to the skills root (sibling), because skills
// reference it via ${CLAUDE_PLUGIN_ROOT}/knowledge-base — we mirror that by
// placing knowledge-base/ as a sibling of the skills dir's parent. To keep it
// simple and robust across IDEs, we copy KB into <skillsRoot>/../knowledge-base
// AND keep a project-root copy. See copyKnowledgeBase().

// ── fs helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Local source checkouts can contain development-only trees that npm never
// publishes. Copy-mode installs must not materialize those trees into every
// IDE target: a single Python virtualenv or node_modules directory can add
// hundreds of megabytes and make `--ide all` appear to hang.
const COPY_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".venv",
  "__pycache__",
  "node_modules",
]);

function shouldCopySourcePath(src) {
  return !COPY_EXCLUDED_DIRECTORY_NAMES.has(path.basename(src));
}

function copyRecursiveFallback(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      if (COPY_EXCLUDED_DIRECTORY_NAMES.has(entry)) continue;
      copyRecursiveFallback(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

function copyRecursive(src, dest) {
  // cpSync performs the directory walk natively and is substantially faster
  // for `--ide all` (thousands of small Skill files copied four times). Keep a
  // fallback for early Node 16 builds where cpSync was not yet available.
  if (typeof fs.cpSync === "function") {
    fs.cpSync(src, dest, {
      recursive: true,
      dereference: true,
      filter: shouldCopySourcePath,
    });
    return;
  }
  copyRecursiveFallback(src, dest);
}

function reportingStatePath(projectRoot) {
  return path.join(markerDir(projectRoot), "state.json");
}

function legacyReportingStatePath(projectRoot, { env = process.env, home = os.homedir() } = {}) {
  const resolved = path.resolve(projectRoot);
  let canonical = resolved;
  try { canonical = fs.realpathSync.native(resolved); }
  catch { /* Match Python Path.resolve() as closely as possible for existing projects. */ }
  const key = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const base = env.XDG_CACHE_HOME || path.join(home, ".cache");
  return path.join(base, "trtc-traces", `reporting-state-${key}.json`);
}

function readReportingPreferenceValue(projectRoot, key, options = {}) {
  let current = path.resolve(projectRoot);
  try { current = fs.realpathSync.native(current); }
  catch { /* Use the resolved path for projects not created yet. */ }

  while (true) {
    for (const statePath of [
      reportingStatePath(current),
      legacyReportingStatePath(current, options),
    ]) {
      try {
        const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
        if (typeof data[key] === "boolean") return data[key];
      } catch { /* Check the next state source or parent project. */ }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function readPromptReportingPreference(projectRoot, options = {}) {
  return readReportingPreferenceValue(
    projectRoot,
    "prompt_reporting_enabled",
    options
  );
}

function readAllReportingDisabled(projectRoot, options = {}) {
  return readReportingPreferenceValue(
    projectRoot,
    "all_reporting_disabled",
    options
  ) === true;
}

// ---------------------------------------------------------------------------
// Installer preference lock — CJS equivalent of preference.js owner-token lock.
// Uses the same lock file path so both runtimes coordinate on the same inode.
// ---------------------------------------------------------------------------
const INSTALLER_LOCK_FILE = ".pref-owner.json";
const INSTALLER_LOCK_GRACE_MS = 5000;

function _acquireInstallerLock(prefDir) {
  const lockPath = path.join(prefDir, INSTALLER_LOCK_FILE);
  const token = crypto.randomBytes(16).toString("hex");
  const ownerData = JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  const mode = process.platform === "win32" ? undefined : 0o600;
  try {
    fs.writeFileSync(lockPath, ownerData, { flag: "wx", mode });
    return { acquired: true, token, lockPath };
  } catch (err) {
    if (err.code !== "EEXIST") return { acquired: false, reason: "lock_io_error" };
    return _staleCheckAndClaimCjs(lockPath, token, ownerData, mode);
  }
}

function _staleCheckAndClaimCjs(lockPath, newToken, newOwnerData, mode) {
  // Step 1: lstat for mtime
  let stat;
  try { stat = fs.lstatSync(lockPath); }
  catch (statErr) {
    if (statErr.code === "ENOENT") {
      // Released between EEXIST and lstat; retry acquire once.
      try {
        fs.writeFileSync(lockPath, newOwnerData, { flag: "wx", mode });
        return { acquired: true, token: newToken, lockPath };
      } catch { return { acquired: false, reason: "busy" }; }
    }
    return { acquired: false, reason: "busy" };
  }
  // Step 2: age check
  if (Date.now() - stat.mtimeMs < INSTALLER_LOCK_GRACE_MS) {
    return { acquired: false, reason: "busy" };
  }
  // Step 3: read PID from lock
  let pid = null;
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (typeof existing?.pid === "number") pid = existing.pid;
  } catch { /* parse failed — rely on mtime alone */ }
  // Step 4: PID liveness check — must not reclaim a lock held by a live process
  if (pid !== null) {
    try {
      process.kill(pid, 0); // throws if process is dead
      return { acquired: false, reason: "busy" }; // process alive
    } catch (killErr) {
      if (killErr.code !== "ESRCH") return { acquired: false, reason: "busy" };
      // ESRCH: process dead → stale, can reclaim
    }
  }
  // Step 5: atomic rename to claim
  const staleFile = lockPath + ".stale." + newToken;
  try { fs.renameSync(lockPath, staleFile); }
  catch (renameErr) {
    if (renameErr.code === "ENOENT") {
      try {
        fs.writeFileSync(lockPath, newOwnerData, { flag: "wx", mode });
        return { acquired: true, token: newToken, lockPath };
      } catch { return { acquired: false, reason: "busy" }; }
    }
    return { acquired: false, reason: "busy" };
  }
  // Write new owner with O_EXCL
  try {
    fs.writeFileSync(lockPath, newOwnerData, { flag: "wx", mode });
  } catch { return { acquired: false, reason: "busy" }; }
  // Step 6: clean up stale files (best-effort)
  try { fs.unlinkSync(staleFile); } catch { /* ignore */ }
  try {
    for (const e of fs.readdirSync(path.dirname(lockPath))) {
      if (e.startsWith(INSTALLER_LOCK_FILE + ".stale.")) {
        try { fs.unlinkSync(path.join(path.dirname(lockPath), e)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return { acquired: true, token: newToken, lockPath };
}

function _releaseInstallerLock(lockPath, token, _testHookAfterRename) {
  if (!lockPath || !token) return;
  const releasingFile = lockPath + ".releasing." + token;
  try { fs.renameSync(lockPath, releasingFile); } catch { return; }
  _testHookAfterRename?.(); // for barrier tests only
  let tokenMatches = false;
  try {
    const existing = JSON.parse(fs.readFileSync(releasingFile, "utf8"));
    tokenMatches = existing?.token === token;
  } catch { /* parse failed */ }
  if (tokenMatches) {
    try { fs.unlinkSync(releasingFile); } catch { /* ignore */ }
  } else {
    // No-clobber restore: link if lockPath is free, otherwise clean up .releasing.*
    try {
      fs.linkSync(releasingFile, lockPath);
      fs.unlinkSync(releasingFile);
    } catch {
      try { fs.unlinkSync(releasingFile); } catch { /* ignore */ }
    }
  }
}

function writePromptReportingPreference(projectRoot, enabled, options = {}) {
  const { allReportingDisabled, ...pathOptions } = options;
  const statePath = reportingStatePath(projectRoot);
  const prefDir = path.dirname(statePath);
  ensureDir(prefDir);
  const lock = _acquireInstallerLock(prefDir);
  if (!lock.acquired) {
    console.warn("[TRTC] Skipping preference write: preference lock is busy (reason: " + (lock.reason ?? "busy") + ")");
    return statePath;
  }
  try {
    let data = null;
    if (fs.existsSync(statePath)) {
      // Preference file exists — detect corruption before writing.
      let raw;
      try { raw = fs.readFileSync(statePath, "utf8"); } catch { raw = null; }
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed;
          } else {
            console.warn("[TRTC] Skipping preference write: preference.json is not a valid object");
            return statePath;
          }
        } catch {
          console.warn("[TRTC] Skipping preference write: preference.json is corrupt (JSON parse failed)");
          return statePath;
        }
      }
    }
    if (data === null) {
      // Preference file absent — try legacy path; do NOT fall back to {} for corrupt legacy.
      const legacyPath = legacyReportingStatePath(projectRoot, pathOptions);
      if (fs.existsSync(legacyPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed;
          } else {
            console.warn("[TRTC] Skipping preference write: legacy state is not a valid object");
            return statePath;
          }
        } catch {
          console.warn("[TRTC] Skipping preference write: legacy state is corrupt (JSON parse failed)");
          return statePath;
        }
      }
      if (data === null) data = {};
    }
    data.prompt_reporting_enabled = Boolean(enabled);
    data.prompt_reporting_updated_at = Math.floor(Date.now() / 1000);
    if (typeof allReportingDisabled === "boolean") {
      data.all_reporting_disabled = allReportingDisabled;
      data.all_reporting_updated_at = Math.floor(Date.now() / 1000);
    }
    writeJsonAtomic(statePath, data);
    excludeLocalReportingState(projectRoot);
    return statePath;
  } finally {
    _releaseInstallerLock(lock.lockPath, lock.token);
  }
}

function excludeLocalReportingState(projectRoot) {
  const gitDir = path.join(path.resolve(projectRoot), ".git");
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) return false;
  const excludePath = path.join(gitDir, "info", "exclude");
  ensureDir(path.dirname(excludePath));
  const current = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8")
    : "";
  const stateDirName = path.basename(markerDir(projectRoot));
  if (current.split(/\r?\n/).some(line => line.trim() === `${stateDirName}/`)) {
    return false;
  }
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(excludePath, `${prefix}${stateDirName}/\n`, "utf8");
  return true;
}

function parsePromptReportingValue(raw) {
  if (raw === undefined) return undefined;
  const value = String(raw).trim().toLowerCase();
  if (["on", "true", "yes", "1", "enabled"].includes(value)) return true;
  if (["off", "false", "no", "0", "disabled"].includes(value)) return false;
  throw new Error("--prompt-reporting must be on or off");
}

function rmrf(target) {
  if (fs.existsSync(target) || isSymlink(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); }
  catch { return false; }
}

// Local checkout install (npx from sibling / `node bin/cli.js` inside this repo)
// should symlink skills so edits under skills/ are live in IDE skill roots.
// Opt out with TRTC_SKILLS_COPY=1; force on with TRTC_SKILLS_SYMLINK=1.
function shouldSymlinkSkills(skillsRootAbs, resolvedRoot) {
  if (process.env.TRTC_SKILLS_COPY === "1") return false;
  if (process.env.TRTC_SKILLS_SYMLINK === "1") return true;
  const pkg = path.resolve(PKG_ROOT);
  const root = path.resolve(resolvedRoot);
  const skillsRoot = path.resolve(skillsRootAbs);
  return root === pkg || skillsRoot.startsWith(pkg + path.sep);
}

function installSkillDir(src, dest, { symlink }) {
  rmrf(dest);
  if (symlink) {
    ensureDir(path.dirname(dest));
    const rel = path.relative(path.dirname(dest), src);
    fs.symlinkSync(rel || src, dest, "dir");
    return "symlink";
  }
  copyRecursive(src, dest);
  return "copy";
}

// ── IDE auto-detection ────────────────────────────────────────────────────────
// When the user runs `npx ... add` without --ide, we auto-detect which IDEs
// they actually have installed by checking for their user-level config dirs.
// This way we don't pollute ~/.cursor/ for a user who only runs Claude Code.
//
// Detection markers per IDE — present means "this IDE is installed":
//   claude    : ~/.claude/      (created by Claude Code on first launch)
//   cursor    : ~/.cursor/      (created by Cursor on first launch)
//   codebuddy : ~/.codebuddy/   (created by CodeBuddy on first launch)
//   codex     : ~/.codex/       (created by Codex CLI on first launch)
//
// If nothing matches, fall back to claude (the most common starting point).
// Adding a new IDE later means: one new entry here + entries in the existing
// IDE_TARGETS / HOOKS_TARGETS / AI_INSTRUCTION_TARGETS / MCP_TARGETS maps.
const IDE_DETECTION_MARKERS = {
  claude:    [".claude"],
  cursor:    [".cursor"],
  codebuddy: [".codebuddy"],
  codex:     [".codex"],
};

function detectInstalledIDEs() {
  const home = os.homedir();
  const detected = [];
  for (const ide of Object.keys(IDE_TARGETS)) {
    const markers = IDE_DETECTION_MARKERS[ide] || [];
    if (markers.some(m => fs.existsSync(path.join(home, m)))) {
      detected.push(ide);
    }
  }
  return detected.length > 0 ? detected : ["claude"];
}

// ── argv parsing ──────────────────────────────────────────────────────────────
function getFlag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

// ── help / list ───────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
  ${c.bold("@tencent-rtc/trtc-agent-skills")} — Install TRTC AI Integration skills + MCP

  ${c.bold("Usage:")}
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add")}                  Auto-detect installed IDEs and install for each
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add --ide <name>")}     Install only for that IDE: claude / cursor / codebuddy / codex
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add --ide all")}        Install for every supported IDE
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add --clean")}          Wipe existing trtc* skill dirs first
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add --no-report")}      Skip anonymous install reporting
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add --list")}           List skills shipped in this package
    ${c.cyan("npx @tencent-rtc/trtc-agent-skills add --help")}           Show this help

  ${c.bold("Default behavior (no --ide):")}
    ${c.gray("Detects which IDEs are installed by checking ~/.{claude,cursor,codebuddy,codex}/")}
    ${c.gray("and installs for each one found. Falls back to claude if none detected.")}

  ${c.bold("Installs:")}
    ${c.dim("Skills :")} ${c.gray("<projectRoot>/.{ide}/skills/")}
    ${c.dim("KB     :")} ${c.gray("alongside the skills root as knowledge-base/")}
    ${c.dim("Hooks  :")} ${c.gray("<projectRoot>/.{ide}/hooks/  +  settings file with hook events wired")}
    ${c.dim("Rules  :")} ${c.gray("CLAUDE.md / AGENTS.md / CODEBUDDY.md (marker-merged)")}
    ${c.dim("MCP    :")} ${c.gray("npm trtc-push-mcp (local only with TRTC_PUSH_MCP_ENTRY)")}

  ${c.dim("Skills are copied as sibling dirs so relative routing (../trtc-onboarding) keeps working.")}
`);
}

function listSkills() {
  const descriptions = {
    "trtc":               "Entry router — detects product/platform, routes to sub-skills",
    "trtc-docs":          "Docs & error-code lookup",
    "trtc-conference":    "Video conference / multi-person room scenarios",
    "trtc-ai-service":    "AI customer service scenarios (TRTC Conversational AI)",
    "trtc-ai-oral-coach": "AI oral speaking coach / 口语陪练 (TRTC Conversational AI)",
    "trtc-ai-realtime-interpreter": "AI real-time interpretation / 实时翻译",
    "trtc-chat":          "IM / Chat SDK integration",
    "trtc-push":          "TIMPush offline push integration (via trtc-push-mcp)",
    "trtc-sdk-log-analysis": "Manual SDK runtime log collection and offline analysis",
  };
  console.log(`\n  ${c.bold("Skills shipped in this package:")}\n`);
  for (const name of getSkillNames()) {
    const desc = descriptions[name] || "";
    console.log(`  ${c.cyan(name + "/")}` + (desc ? ` ${c.dim(desc)}` : ""));
  }
  console.log("");
}

// ── core: skill install ─────────────────────────────────────────────────────────
function cleanSkills(skillsRootAbs, ide) {
  if (!fs.existsSync(skillsRootAbs)) return 0;
  let wiped = 0;
  for (const name of getSkillNames()) {
    const target = path.join(skillsRootAbs, name);
    if (fs.existsSync(target)) { rmrf(target); wiped++; }
  }
  // also wipe a co-located knowledge-base copy if present
  const kb = path.join(path.dirname(skillsRootAbs), "knowledge-base");
  if (fs.existsSync(kb)) { rmrf(kb); }
  // Only Cursor has a namespaced adapter directory owned by this package.
  // Claude/CodeBuddy/Codex share their hooks/ directory with users and other
  // tools, so install/clean must never recursively remove that directory.
  const hooksTarget = HOOKS_TARGETS[ide];
  const resolvedRoot = path.dirname(path.dirname(skillsRootAbs));
  if (ide === "cursor" && hooksTarget) {
    const hooksDir = path.join(resolvedRoot, hooksTarget.hooksDir);
    if (fs.existsSync(hooksDir)) { rmrf(hooksDir); }
  }
  return wiped;
}

function cleanCommands(ideList, resolvedRoot) {
  for (const ide of ideList) {
    const target = COMMAND_TARGETS[ide];
    if (!target) continue;
    const commandPath = path.join(resolvedRoot, target.commandsRoot, "sdk-log.md");
    if (!fs.existsSync(commandPath)) continue;
    const content = fs.readFileSync(commandPath, "utf8");
    if (content.includes(COMMAND_MARKER)) rmrf(commandPath);
  }
}

function installCommands(ideList, resolvedRoot) {
  for (const ide of ideList) {
    const target = COMMAND_TARGETS[ide];
    if (!target) {
      if (ide === "codex") {
        console.log(c.green("    ✓ ") + "codex explicit entry → $trtc-sdk-log-analysis");
      }
      continue;
    }

    const src = path.join(COMMANDS_SRC, target.sourceDir, "sdk-log.md");
    const dest = path.join(resolvedRoot, target.commandsRoot, "sdk-log.md");
    if (!fs.existsSync(src)) {
      console.log(c.yellow("    ⚠ ") + `${ide} /sdk-log source missing, skipped`);
      continue;
    }
    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, "utf8");
      if (!existing.includes(COMMAND_MARKER)) {
        console.log(c.yellow("    ⚠ ") + `${ide} /sdk-log already exists and is user-owned, skipped`);
        continue;
      }
    }
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    console.log(c.green("    ✓ ") + `${ide} /sdk-log → ${dest}`);
  }
}

// Strip our markered block from a root markdown file. If the file becomes
// empty after removal, delete it; otherwise leave the user's own content.
function cleanAiInstructions(ideList, resolvedRoot) {
  for (const ide of ideList) {
    const target = AI_INSTRUCTION_TARGETS[ide];
    if (!target) continue;
    const destAbs = path.join(resolvedRoot, target.filename);
    if (!fs.existsSync(destAbs)) continue;

    if (target.type === "cursor-rule") {
      // .cursor/rules/ui-mode.mdc was installed verbatim by us; safe to remove.
      rmrf(destAbs);
      continue;
    }
    if (target.type === "root-md") {
      let content = fs.readFileSync(destAbs, "utf8");
      const re = new RegExp(`\\n*${escapeRegex(MD_MARKER_BEGIN)}[\\s\\S]*?${escapeRegex(MD_MARKER_END)}\\n?`, "g");
      const stripped = content.replace(re, "").trimEnd();
      if (!stripped) {
        // The file existed only because we created it. Remove entirely.
        rmrf(destAbs);
      } else if (stripped !== content.trimEnd()) {
        fs.writeFileSync(destAbs, stripped + "\n", "utf8");
      }
    }
  }
}

// Strip our hook entries from each IDE's settings file. We tag entries with
// __trtc_agent_skills__ where the IDE schema allows (claude/cursor), and fall
// back to command-path matching for strict-schema IDEs (codebuddy/codex).
function cleanHooksSettings(ideList, resolvedRoot) {
  for (const ide of ideList) {
    const target = HOOKS_TARGETS[ide];
    if (!target) continue;

    const settingsPath = path.isAbsolute(target.settingsFile)
      ? target.settingsFile
      : path.join(resolvedRoot, target.settingsFile);
    if (!fs.existsSync(settingsPath)) continue;

    let settings;
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
    catch { continue; }
    if (!settings || typeof settings !== "object") continue;

    if (settings.__trtc_agent_skills__) delete settings.__trtc_agent_skills__;

    if (settings.hooks && typeof settings.hooks === "object") {
      for (const event of Object.keys(settings.hooks)) {
        const val = settings.hooks[event];
        if (Array.isArray(val)) {
          settings.hooks[event] = stripOwnedHookEntries(val);
          if (settings.hooks[event].length === 0) delete settings.hooks[event];
        } else if (val && typeof val === "object" && Array.isArray(val.hooks)) {
          // Some IDEs nest hooks under a single object per event instead of
          // an array. Filter the inner hooks list.
          val.hooks = val.hooks.filter(h => !isOwnedHookEntry(h));
          if (val.hooks.length === 0) delete settings.hooks[event];
        } else {
          // Unknown shape — leave it alone rather than risk corrupting it.
        }
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    }

    // For strict-schema codex, if we cleared everything, remove the file so
    // codex doesn't see a stale empty file.
    const onlyHadOurState = !settings.hooks && Object.keys(settings).length === 0;
    if (onlyHadOurState) {
      rmrf(settingsPath);
      continue;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
}

function installSkills(skillsRootAbs, resolvedRoot) {
  ensureDir(skillsRootAbs);
  const symlink = shouldSymlinkSkills(skillsRootAbs, resolvedRoot);
  const modes = [];
  for (const name of getSkillNames()) {
    const src = path.join(SKILLS_SRC, name);
    if (!fs.existsSync(src)) continue;
    const mode = installSkillDir(src, path.join(skillsRootAbs, name), { symlink });
    modes.push({ name, mode });
  }
  return { symlink, modes };
}

// Copy knowledge-base so that skills can resolve it. Skills use
// ${CLAUDE_PLUGIN_ROOT}/knowledge-base; the practical robust choice is to put
// knowledge-base as a sibling of the skills root (e.g. .claude/knowledge-base),
// which is what plugin-style roots expect.
function copyKnowledgeBase(skillsRootAbs) {
  const dest = path.join(path.dirname(skillsRootAbs), "knowledge-base");
  rmrf(dest);
  copyRecursive(KB_SRC, dest);
  return dest;
}

// ── isolated Python dependency bootstrap ─────────────────────────────────────
// The Skill's routing/session tools use PyYAML. Do not modify the user's global
// Python environment: install one cached copy and copy the importable `yaml/`
// package into each project-local trtc skill root.
function resolvePythonCommand({ env = process.env, runner = spawnSync } = {}) {
  const candidates = [env.TRTC_PYTHON, "python3", "python"].filter(Boolean);
  for (const command of candidates) {
    const probe = runner(command, ["--version"], {
      encoding: "utf8",
      env,
      timeout: 5_000,
    });
    if (!probe.error && probe.status === 0) return command;
  }
  return null;
}

function pythonCanImportYaml(command, cwd, {
  env = process.env,
  runner = spawnSync,
} = {}) {
  const probe = runner(command, ["-c", "import yaml"], {
    cwd,
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  return !probe.error && probe.status === 0;
}

function pythonDependencyCache(command, {
  env = process.env,
  home = os.homedir(),
  runner = spawnSync,
} = {}) {
  const version = runner(
    command,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    { encoding: "utf8", env, timeout: 5_000 }
  );
  const tag =
    !version.error && version.status === 0
      ? version.stdout.trim()
      : "unknown";
  const base = env.XDG_CACHE_HOME || path.join(home, ".cache");
  return path.join(base, "trtc-agent-skills", "python", tag, "site-packages");
}

function ensurePythonDependencies(ideList, resolvedRoot, options = {}) {
  const env = options.env || process.env;
  const runner = options.runner || spawnSync;
  const command = resolvePythonCommand({ env, runner });
  if (!command) {
    return {
      ok: false,
      reason: "python-not-found",
      message: "python3 was not found; TRTC routing tools cannot run",
    };
  }

  const roots = [...new Set(
    ideList.map(ide =>
      path.join(resolvedRoot, IDE_TARGETS[ide].skillsRoot, "trtc")
    )
  )];
  let missing = roots.filter(root =>
    !pythonCanImportYaml(command, root, { env, runner })
  );
  if (missing.length === 0) {
    return { ok: true, command, source: "python-environment", roots };
  }

  const cache = pythonDependencyCache(command, {
    env,
    home: options.home || os.homedir(),
    runner,
  });
  const cachedYaml = path.join(cache, "yaml");
  if (!fs.existsSync(cachedYaml)) {
    ensureDir(cache);
    const install = runner(
      command,
      [
        "-m", "pip", "install",
        "--disable-pip-version-check",
        "--no-input",
        "--target", cache,
        "PyYAML>=6,<7",
      ],
      {
        encoding: "utf8",
        env,
        timeout: 120_000,
      }
    );
    if (install.error || install.status !== 0 || !fs.existsSync(cachedYaml)) {
      return {
        ok: false,
        command,
        reason: "pyyaml-install-failed",
        message:
          (install.stderr || install.stdout || install.error?.message || "")
            .trim()
            .split("\n")
            .slice(-1)[0] || "PyYAML installation failed",
      };
    }
  }

  const skippedSymlinks = [];
  for (const root of missing) {
    if (isSymlink(root)) {
      skippedSymlinks.push(root);
      continue;
    }
    const destination = path.join(root, "yaml");
    rmrf(destination);
    copyRecursive(cachedYaml, destination);
  }
  missing = roots.filter(root =>
    !pythonCanImportYaml(command, root, { env, runner })
  );
  if (missing.length > 0) {
    return {
      ok: false,
      command,
      reason: skippedSymlinks.length
        ? "local-symlink-needs-pyyaml"
        : "pyyaml-verification-failed",
      message: `PyYAML is still unavailable in ${missing.length} installed skill root(s)`,
      roots,
    };
  }
  return { ok: true, command, source: "isolated-cache", cache, roots };
}

function verifyInstalledRuntime(runtime, options = {}) {
  if (!runtime.ok || !runtime.command || !runtime.roots?.length) return runtime;
  const env = options.env || process.env;
  const runner = options.runner || spawnSync;
  const root = runtime.roots[0];
  const routeProbe = runner(
    runtime.command,
    [
      "-c",
      "import yaml; from tools import query_classifier, search, session",
    ],
    { cwd: root, encoding: "utf8", env, timeout: 10_000 }
  );
  if (routeProbe.error || routeProbe.status !== 0) {
    return {
      ...runtime,
      ok: false,
      reason: "routing-runtime-check-failed",
      message: (routeProbe.stderr || routeProbe.stdout || "routing imports failed")
        .trim()
        .split("\n")
        .slice(-1)[0],
    };
  }

  const reporter = path.join(root, "tools", "reporting.py");
  const reportProbe = runner(
    runtime.command,
    [
      reporter,
      "send",
      "--product", "unknown",
      "--framework", "unknown",
      "--version", PKG_VERSION,
      "--sdkappid", "0",
      "--sessionid", "sess_install_check",
      "--method", "event",
      "--text", "install-health-check",
      "--dry-run",
    ],
    { cwd: root, encoding: "utf8", env, timeout: 10_000 }
  );
  if (reportProbe.error || reportProbe.status !== 0) {
    return {
      ...runtime,
      ok: false,
      reason: "reporting-runtime-check-failed",
      message: (reportProbe.stderr || reportProbe.stdout || "reporting check failed")
        .trim()
        .split("\n")
        .slice(-1)[0],
    };
  }
  return { ...runtime, verified: true };
}

// ── hooks installation ────────────────────────────────────────────────────────
// In plugin mode the IDE expands ${CLAUDE_PLUGIN_ROOT} / ${CODEBUDDY_PLUGIN_ROOT}
// to the plugin install root. In npx mode there's no plugin root, so we
// materialize those placeholders to absolute paths pointing at the IDE's
// settings dir (where we put .{ide}/skills/, .{ide}/hooks/, etc).
//
// `hooksDestAbs` is the absolute path the hooks/ source dir was actually
// copied to (e.g. <root>/.cursor/hooks/trtc-agent-skills for cursor, or
// <root>/.claude/hooks for claude). We use it to resolve cursor-adapter.py
// rather than reconstructing it from `ideAbsRoot + "hooks"`, because cursor
// nests its hooks one level deeper (under trtc-agent-skills/) for namespace
// isolation — see HOOKS_TARGETS.cursor.hooksDir.
function rewriteHooksContent(content, target, ideAbsRoot, hooksDestAbs) {
  let out = content;
  if (target.hostIde) {
    out = out.split("__TRTC_HOST_IDE__").join(target.hostIde);
  }
  if (target.rootPlaceholder) {
    // Replace BOTH ${CLAUDE_PLUGIN_ROOT} and ${CODEBUDDY_PLUGIN_ROOT} — the
    // bundled hooks.json uses `${CLAUDE_PLUGIN_ROOT:-${CODEBUDDY_PLUGIN_ROOT}}`
    // shell fallback, but in JSON-merged form (settings.json hooks field) the
    // shell expansion still applies because hook commands run in a shell. We
    // pre-resolve both for clarity and so plain-string consumers also work.
    const placeholders = [target.rootPlaceholder, target.fallbackPlaceholder].filter(Boolean);
    for (const ph of placeholders) {
      out = out.split(ph).join(ideAbsRoot);
    }
    // The bash `${VAR:-${OTHER}}` form leaves a literal `:-` between two
    // already-replaced absolute paths, which won't run. Simplify it: collapse
    // `<abs>:-<abs>` (or any duplicated form) back to a single `<abs>`.
    out = out.replace(
      /\$\{(?:CLAUDE_PLUGIN_ROOT|CODEBUDDY_PLUGIN_ROOT):-[^}]+\}/g,
      ideAbsRoot
    );
  }
  if (target.cursorAdapterPlaceholder) {
    // hooks-cursor.json hardcodes $HOME/.cursor/plugins/local/trtc-agent-skills/hooks/cursor-adapter.py
    // — rewrite to the project-local copy we just installed. The placeholder
    // sits inside a JSON string for a shell command (`python3 <path> arg`).
    // We need the resulting JSON string to evaluate to a shell-quoted path so
    // project paths with spaces don't break shell parsing — that means
    // emitting `\"<abs>\"` (JSON-escaped quotes) into the string.
    //
    // Use hooksDestAbs (the actual copy destination) — NOT ideAbsRoot+"hooks"
    // — because cursor's hooksDir is namespaced as
    // .cursor/hooks/trtc-agent-skills, so the script lives one level deeper
    // than the .cursor/hooks/ that ideAbsRoot+"hooks" would point at.
    const cursorAdapterAbs = path.join(hooksDestAbs, "cursor-adapter.py");
    const replacement = `\\"${cursorAdapterAbs}\\"`;
    out = out.split(target.cursorAdapterPlaceholder).join(replacement);
  }
  return out;
}

// Cursor still needs its namespaced Python adapter directory for non-Prompt
// guardrails. Other hosts execute guardrails directly from installed Skills.
function copyHooksDir(target, resolvedRoot, ide) {
  const dest = path.join(resolvedRoot, target.hooksDir);
  if (ide !== "cursor") return dest;
  rmrf(dest);
  copyRecursive(HOOKS_SRC, dest);
  return dest;
}

// Merge the rewritten hook config into the IDE's settings file. The settings
// file may already contain unrelated user state (permissions, MCP servers,
// other hooks); we only own the `hooks` key. For Cursor's user-level
// ~/.cursor/hooks.json we merge per-event arrays so a previously-installed
// project's adapter path gets replaced by ours but the user's own hook
// entries (if any) are preserved.
function mergeHooksConfig(target, resolvedRoot, ideAbsRoot, hooksDestAbs, ide) {
  const srcPath = path.join(HOOKS_SRC, target.sourceConfig);
  if (!fs.existsSync(srcPath)) return null;

  const rawSrc = fs.readFileSync(srcPath, "utf8");
  const rewritten = rewriteHooksContent(rawSrc, target, ideAbsRoot, hooksDestAbs);
  let parsed;
  try { parsed = JSON.parse(rewritten); }
  catch (err) {
    console.error(c.red(`    ✗ failed to parse rewritten ${target.sourceConfig}: ${err.message}`));
    return null;
  }

  const settingsPath = path.isAbsolute(target.settingsFile)
    ? target.settingsFile
    : path.join(resolvedRoot, target.settingsFile);
  ensureDir(path.dirname(settingsPath));

  let existing = {};
  if (fs.existsSync(settingsPath)) {
    try { existing = JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
    catch { return { settingsPath, error: "config_invalid" }; }
    if (!existing || typeof existing !== "object" || Array.isArray(existing)
        || (existing.hooks !== undefined
          && (!existing.hooks || typeof existing.hooks !== "object" || Array.isArray(existing.hooks)))) {
      return { settingsPath, error: "config_invalid" };
    }
  }
  if (!existing || typeof existing !== "object") existing = {};

  // The hooks payload sits under `hooks` (claude/codebuddy/cursor/codex all
  // use this key). For Cursor we additionally track our injected entries so we
  // can later remove only ours on uninstall.
  const incomingHooks = parsed.hooks || {};
  const runtimePath = path.join(resolvedRoot, IDE_TARGETS[ide].skillsRoot, "trtc", "runtime", "telemetry.cjs");
  const promptCommand = buildPromptHookCommand({ ide, runtimePath, cwd: resolvedRoot });
  const promptEvent = ide === "cursor" ? "beforeSubmitPrompt" : "UserPromptSubmit";
  incomingHooks[promptEvent] = ide === "cursor"
    ? [{ command: promptCommand.command }]
    : [{ hooks: [{
        type: "command",
        command: promptCommand.command,
        ...(ide === "codex" ? { commandWindows: promptCommand.commandWindows } : {}),
      }] }];

  // If the host skipped the model-issued foreground invoke, recover at the
  // post-answer lifecycle boundary. This is deliberately not attached to the
  // Prompt hook: the host-stop command runs only after the answer and is the
  // only automatic path allowed to promote/flush or surface the C20 notice.
  if (["cursor", "codebuddy", "claude", "codex"].includes(ide)) {
    const stopEvent = ide === "cursor" ? "stop" : "Stop";
    const stopCommand = buildHostStopCommand({ ide, runtimePath, cwd: resolvedRoot });
    if (ide === "cursor") {
      const existingStop = Array.isArray(incomingHooks[stopEvent]) ? incomingHooks[stopEvent] : [];
      incomingHooks[stopEvent] = existingStop.concat({ command: stopCommand.command });
    } else {
      const existingStop = Array.isArray(incomingHooks[stopEvent]) ? incomingHooks[stopEvent] : [];
      // The dispatcher owns both the evidence guard and host-stop.  Running
      // them as separate hooks is unsafe because hosts may discard one
      // command's stdout; composing them with `; exit guard_status` is also
      // unsafe because Claude ignores structured JSON on non-zero exit.
      // Replace only our old guard/telemetry entries and keep user hooks.
      const keptStop = [];
      for (const entry of existingStop) {
        if (Array.isArray(entry?.hooks)) {
          const hooks = entry.hooks.filter((hook) => !isOwnedHookEntry(hook));
          if (hooks.length > 0) keptStop.push({ ...entry, hooks });
        } else if (!isOwnedHookEntry(entry)) {
          keptStop.push(entry);
        }
      }
      incomingHooks[stopEvent] = keptStop.concat({ hooks: [{
        type: "command",
        command: stopCommand.command,
        ...(ide === "codex" ? { commandWindows: stopCommand.commandWindows } : {}),
      }] });

      // CodeBuddy desktop skips its Stop-hook check when an agent turn ends
      // after a reactive question tool (for example ask_followup_question).
      // That is the common onboarding path, and leaves the Prompt in Pending
      // forever even though UserPromptSubmit ran successfully. PostToolUse is
      // the host-supported lifecycle boundary immediately after that question
      // is rendered; restrict the fallback to those question tools so a normal
      // tool call cannot flush before the assistant has answered.
      if (ide === "codebuddy") {
        const postToolEvent = "PostToolUse";
        const existingPostTool = Array.isArray(incomingHooks[postToolEvent])
          ? incomingHooks[postToolEvent]
          : [];
        const postToolFallback = {
          matcher: "ask_followup_question|ask_user_question|AskUserQuestion",
          hooks: [{
            type: "command",
            command: stopCommand.command,
          }],
        };
        incomingHooks[postToolEvent] = existingPostTool.concat(postToolFallback);
      }
    }
  }
  if (!existing.hooks || typeof existing.hooks !== "object") existing.hooks = {};

  // For strict-schema IDEs (codex) we MUST NOT embed any ownership marker —
  // codex CLI ≥0.135 rejects the whole file with
  //   "unknown field `__trtc_agent_skills__`, expected `hooks`"
  // and skips all hooks. Identify our entries on uninstall via command-path
  // hints (see isOwnedHookEntry) instead.
  const useMarker = !target.strictSchema;

  // Marker to identify our entries so a future uninstall can filter precisely.
  const tagged = (entry) => {
    if (!useMarker) return entry;
    if (entry && typeof entry === "object") {
      return Object.assign({}, entry, { __trtc_agent_skills__: true });
    }
    return entry;
  };

  for (const [eventName, eventValue] of Object.entries(incomingHooks)) {
    if (Array.isArray(eventValue)) {
      const stripped = stripOwnedHookEntries(existing.hooks[eventName] || []);
      existing.hooks[eventName] = stripped.concat(eventValue.map(tagged));
    } else if (Array.isArray(existing.hooks[eventName])) {
      // existing is array (cursor-style), incoming is non-array (claude-style):
      // overwrite — this combination shouldn't happen in practice.
      existing.hooks[eventName] = eventValue;
    } else {
      // Claude/Codebuddy/Codex format: hooks.<event> = [{matcher, hooks:[...]}, ...]
      // For strict-schema codex, the bundled hooks.json IS the only source for
      // this key and we own the file; just replace.
      existing.hooks[eventName] = eventValue;
    }
  }

  // Top-level marker so a future uninstall can detect our presence quickly.
  // Skip for strict-schema IDEs (codex) — see useMarker above.
  if (useMarker) {
    existing.__trtc_agent_skills__ = {
      version: PKG_VERSION,
      hookEvents: Object.keys(incomingHooks),
    };
  } else if (existing.__trtc_agent_skills__) {
    // Defensive: if a previous (buggy) install left this field behind, clean
    // it up so codex doesn't keep failing schema validation.
    delete existing.__trtc_agent_skills__;
  }

  // Preserve / propagate top-level keys that the IDE expects (e.g. cursor
  // requires `"version": 1` at the root of ~/.cursor/hooks.json or it rejects
  // the file with "Config version must be a number"). Only copy keys we don't
  // already own (hooks, __trtc_agent_skills__) to avoid clobbering the user's
  // unrelated state.
  for (const [key, val] of Object.entries(parsed)) {
    if (key === "hooks" || key === "__trtc_agent_skills__") continue;
    if (existing[key] === undefined) existing[key] = val;
  }

  writeJsonAtomic(settingsPath, existing);
  let verified;
  try { verified = JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
  catch { return { settingsPath, error: "verification_failed" }; }
  const promptEntries = verified?.hooks?.[promptEvent];
  const ownedCount = Array.isArray(promptEntries)
    ? promptEntries.reduce((count, entry) => count + (Array.isArray(entry?.hooks)
      ? entry.hooks.filter(isOwnedHookCommand).length
      : Number(isOwnedHookCommand(entry))), 0)
    : 0;
  if (ownedCount !== 1) return { settingsPath, error: "verification_failed" };
  return { settingsPath, eventCount: Object.keys(incomingHooks).length };
}

function installHooks(ideList, resolvedRoot) {
  const results = {};
  for (const ide of ideList) {
    const target = HOOKS_TARGETS[ide];
    if (!target) {
      results[ide] = { installed: false, activated: false, reason: "unsupported_ide" };
      continue;
    }

    try {
      const ideAbsRoot = path.join(resolvedRoot, path.dirname(target.hooksDir));
      const hooksDest = copyHooksDir(target, resolvedRoot, ide);
      if (ide === "cursor") console.log(c.green("    ✓ ") + `${ide} hooks → ${hooksDest}/`);

      const merged = mergeHooksConfig(target, resolvedRoot, ideAbsRoot, hooksDest, ide);
      if (!merged || merged.error) {
        results[ide] = { installed: false, activated: false, reason: merged?.error || "config_merge_failed" };
        continue;
      }
      const isUserLevel = path.isAbsolute(target.settingsFile);
      const prefix = isUserLevel ? c.yellow("    ⚠ ") : c.green("    ✓ ");
      const note   = isUserLevel ? c.dim(" (user-level — affects all cursor projects)") : "";
      console.log(`${prefix}${ide} hooks settings → ${merged.settingsPath} ${c.dim(`(${merged.eventCount} events)`)}${note}`);
      // Project hooks are security-sensitive host configuration.  The
      // installer can write the config but it cannot grant the host's trust
      // decision or reload an already-running desktop session.  Make that
      // activation step explicit so a successful file write is not mistaken
      // for a live Hook.  This is especially important for Codex, which
      // records trust by the exact command definition hash, and CodeBuddy,
      // whose desktop /hooks panel may require review after an update.
      if (ide === "codex") {
        console.log(c.yellow("    ⚠ Codex: restart the session, open /hooks, and trust the new project Hook definitions before testing."));
      } else if (ide === "codebuddy") {
        console.log(c.yellow("    ⚠ CodeBuddy: restart the session and review/enable the project Hooks in /hooks before testing."));
      } else if (ide === "claude") {
        console.log(c.dim("    ↻ Claude Code: start a new session so the project Hook configuration is reloaded."));
      }
      results[ide] = { installed: true, activated: false };
    } catch (err) {
      // Telemetry receives a bounded enum-like reason, never a filesystem path
      // or other user-local detail embedded in an exception message.
      const reason = typeof err?.code === "string" && /^[A-Z0-9_]{2,32}$/.test(err.code)
        ? err.code.toLowerCase()
        : "hook_install_failed";
      results[ide] = { installed: false, activated: false, reason };
      console.log(c.yellow("    ⚠ ") + `${ide} hooks unavailable: ${reason}`);
    }
  }
  return results;
}

// ── AI instruction files installation ─────────────────────────────────────────
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injectMarkered(srcAbs, destAbs) {
  const source = fs.readFileSync(srcAbs, "utf8");
  // The package's root instruction files can themselves be a previously
  // installed, marker-merged file (for example after running the installer
  // from the source checkout).  Do not wrap that owned block a second time:
  // nested BEGIN/END markers make later installs ambiguous and can leave two
  // dispatcher copies in the target project.  Preserve the source unchanged
  // only when it has no markers; a malformed owned block is unsafe to copy.
  let normalizedSource = source;
  if (source.includes(MD_MARKER_BEGIN) || source.includes(MD_MARKER_END)) {
    const trimmedSource = source.trim();
    const sourceIsSingleBlock = trimmedSource.startsWith(MD_MARKER_BEGIN)
      && trimmedSource.endsWith(MD_MARKER_END);
    if (sourceIsSingleBlock) {
      const innerStart = trimmedSource.indexOf(MD_MARKER_BEGIN) + MD_MARKER_BEGIN.length;
      const innerEnd = trimmedSource.lastIndexOf(MD_MARKER_END);
      const inner = trimmedSource.slice(innerStart, innerEnd);
      normalizedSource = stripOwnedMarkerBlocks(inner);
    } else {
      normalizedSource = stripOwnedMarkerBlocks(source);
    }
  }
  if (normalizedSource === null) return "skipped-malformed";
  const trtcContent = normalizedSource.trimEnd();
  const block = `${MD_MARKER_BEGIN}\n${trtcContent}\n${MD_MARKER_END}\n`;

  ensureDir(path.dirname(destAbs));
  if (!fs.existsSync(destAbs)) {
    fs.writeFileSync(destAbs, block, "utf8");
    return "new";
  }
  const existing = fs.readFileSync(destAbs, "utf8");
  const stripped = stripOwnedMarkerBlocks(existing);
  if (stripped === null) {
    // Preserve malformed user-owned content and avoid making it worse. The
    // next clean install can repair it after the user resolves the marker.
    return "skipped-malformed";
  }
  const hadMarkers = stripped !== existing
    || existing.includes(MD_MARKER_BEGIN)
    || existing.includes(MD_MARKER_END);
  const merged = stripped.trimEnd() + "\n\n" + block;
  fs.writeFileSync(destAbs, merged, "utf8");
  if (hadMarkers) return "replaced";
  return "appended";
}

function installAiInstructions(ideList, resolvedRoot) {
  for (const ide of ideList) {
    const target = AI_INSTRUCTION_TARGETS[ide];
    if (!target) continue;

    const srcAbs  = path.join(PKG_ROOT, target.filename);
    const destAbs = path.join(resolvedRoot, target.filename);
    if (!fs.existsSync(srcAbs)) {
      console.log(c.dim(`    ✓ ${ide} instructions skipped (source missing)`));
      continue;
    }

    if (target.type === "cursor-rule") {
      ensureDir(path.dirname(destAbs));
      fs.copyFileSync(srcAbs, destAbs);
      console.log(c.green("    ✓ ") + `${ide} rule → ${destAbs}`);
    } else if (target.type === "root-md") {
      const action = injectMarkered(srcAbs, destAbs);
      const verb = action === "new" ? "created"
                 : action === "replaced" ? "updated marker block"
                 : action === "skipped-malformed" ? "skipped malformed marker block"
                 : "appended marker block";
      console.log(c.green("    ✓ ") + `${ide} instructions → ${destAbs} ${c.dim(`(${verb})`)}`);
    }
  }
}

// ── MCP installation ──────────────────────────────────────────────────────────
function installMcp(ideList, resolvedRoot) {
  const servers = getMcpServersToInstall();

  for (const ide of ideList) {
    const mcpTarget = MCP_TARGETS[ide];
    if (!mcpTarget) continue;

    const configPath = path.isAbsolute(mcpTarget.configFile)
      ? mcpTarget.configFile
      : path.join(resolvedRoot, mcpTarget.configFile);
    ensureDir(path.dirname(configPath));

    if (mcpTarget.format === "toml") {
      for (const server of servers) {
        installMcpToml(configPath, server.name, server.entry);
      }
    } else {
      let config = {};
      if (fs.existsSync(configPath)) {
        let raw;
        try { raw = fs.readFileSync(configPath, "utf8"); }
        catch {
          console.warn(`[trtc-install] skipping MCP write for ${ide}: cannot read config file`);
          continue;
        }
        try {
          config = JSON.parse(raw);
          if (!config || typeof config !== "object" || Array.isArray(config)) {
            console.warn(`[trtc-install] skipping MCP write for ${ide}: config root is not an object`);
            continue;
          }
        } catch {
          console.warn(`[trtc-install] skipping MCP write for ${ide}: config file is not valid JSON`);
          continue;
        }
      }
      if (config.mcpServers !== undefined &&
          (config.mcpServers === null || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
        console.warn(`[trtc-install] skipping MCP write for ${ide}: mcpServers field is not an object`);
        continue;
      }
      if (config.mcpServers === undefined) config.mcpServers = {};
      for (const server of servers) {
        config.mcpServers[server.name] = server.entry;
      }
      writeJsonAtomic(configPath, config);
    }
    const labels = servers
      .map(s => s.name + (s.note ? ` (${s.note})` : ""))
      .join(", ");
    console.log(c.green("    ✓ ") + `${ide} MCP → ${configPath}` + c.dim(` [${labels}]`));
  }
}

function installMcpToml(configPath, serverName, serverEntry) {
  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

  const sectionHeader = `[mcp_servers.${serverName}]`;
  const argsValue = JSON.stringify(serverEntry.args).replace(/,/g, ", ");
  const lines = [
    sectionHeader,
    `command = "${serverEntry.command}"`,
    `args = ${argsValue}`,
  ];
  if (serverEntry.env && typeof serverEntry.env === "object") {
    const envEntries = Object.entries(serverEntry.env);
    if (envEntries.length > 0) {
      lines.push(`[mcp_servers.${serverName}.env]`);
    }
    for (const [k, v] of envEntries) {
      lines.push(`${k} = "${String(v).replace(/"/g, '\\"')}"`);
    }
  }
  const newSection = lines.join("\n") + "\n";

  content = removeTomlTableHierarchy(content, `mcp_servers.${serverName}`);
  // Clean up tables left by the old duplicate-repair fallback. They are not
  // MCP configuration and only make subsequent installs harder to audit.
  content = removeTomlTableHierarchy(
    content,
    `trtc_agent_skills_installer_duplicate.${serverName}`
  );
  content = content.trimEnd() + (content.trim() ? "\n\n" : "") + newSection;
  fs.writeFileSync(configPath, content, "utf8");
}

function removeTomlTableHierarchy(content, tablePath) {
  const lines = String(content).split(/\r?\n/);
  const output = [];
  let removing = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/);
    const arrayTableMatch = line.match(/^\s*\[\[([^\[\]]+)\]\]\s*(?:#.*)?$/);
    if (tableMatch) {
      const currentPath = tableMatch[1].trim();
      removing =
        currentPath === tablePath ||
        currentPath.startsWith(`${tablePath}.`);
    } else if (arrayTableMatch) {
      removing = false;
    }
    if (!removing) output.push(line);
  }

  return output.join("\n");
}

// ── C19: Legacy reporting MCP migration ─────────────────────────────────────────
// Runs before installMcp() on every upgrade. Silently removes the old
// tencent-rtc-skill-tool entry when (and only when) it exactly matches the
// original installer-written form. Any user modification → leave it alone.

const ALLOWED_LEGACY_ENTRY_KEYS = new Set(["command", "args", "type", "env"]);

function classifyLegacyMcpEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "unknown_or_malformed";

  // Any key outside the original installer's field set → user customization
  for (const k of Object.keys(entry)) {
    if (!ALLOWED_LEGACY_ENTRY_KEYS.has(k)) return "custom_or_modified";
  }

  if (entry.command !== LEGACY_REPORTING_MCP_COMMAND) return "custom_or_modified";

  if (!Array.isArray(entry.args) ||
      entry.args.length !== 2 ||
      entry.args[0] !== LEGACY_REPORTING_MCP_ARGS[0] ||
      entry.args[1] !== LEGACY_REPORTING_MCP_ARGS[1]) return "custom_or_modified";

  // type: must be strictly undefined or "stdio" (rejects "", null, etc.)
  if (entry.type !== undefined && entry.type !== "stdio") return "custom_or_modified";

  // env: must be strictly undefined, or an object whose only allowed key is PATH (string)
  if (entry.env !== undefined) {
    if (!entry.env || typeof entry.env !== "object" || Array.isArray(entry.env)) return "custom_or_modified";
    const envKeys = Object.keys(entry.env);
    if (envKeys.length > 1) return "custom_or_modified";
    if (envKeys.length === 1 && (envKeys[0] !== "PATH" || typeof entry.env.PATH !== "string")) {
      return "custom_or_modified";
    }
  }

  return "owned";
}

function migrateLegacyMcpJson(configPath, permPath, permKey, permArrayPath) {
  if (!fs.existsSync(configPath)) return "not_present";
  let raw;
  try { raw = fs.readFileSync(configPath, "utf8"); } catch { return "read_error"; }
  let config;
  try { config = JSON.parse(raw); } catch { return "unknown_or_malformed"; }
  if (!config || typeof config !== "object" || Array.isArray(config)) return "unknown_or_malformed";

  const result = classifyLegacyMcpEntry(config?.mcpServers?.[LEGACY_REPORTING_MCP_NAME]);
  if (result !== "owned") return result;

  delete config.mcpServers[LEGACY_REPORTING_MCP_NAME];
  const newContent = JSON.stringify(config, null, 2) + "\n";
  if (newContent !== raw) writeJsonAtomic(configPath, config);

  if (permPath && permKey) migrateLegacyPermEntry(permPath, permKey, permArrayPath);
  return "migrated";
}

function migrateLegacyPermEntry(permPath, permKey, arrayPath) {
  if (!fs.existsSync(permPath)) return;
  let raw, obj;
  try { raw = fs.readFileSync(permPath, "utf8"); obj = JSON.parse(raw); } catch { return; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  const keys = arrayPath.split(".");
  const parent = keys.slice(0, -1).reduce((o, k) => o?.[k], obj);
  const lastKey = keys[keys.length - 1];
  const arr = parent?.[lastKey];
  if (!Array.isArray(arr) || !arr.includes(permKey)) return;
  parent[lastKey] = arr.filter(x => x !== permKey);
  const newContent = JSON.stringify(obj, null, 2) + "\n";
  if (newContent !== raw) writeJsonAtomic(permPath, obj);
}

function isTomlLegacyMcpOwned(content) {
  const TARGET_HEADER = `[mcp_servers.${LEGACY_REPORTING_MCP_NAME}]`;
  const ENV_HEADER    = `[mcp_servers.${LEGACY_REPORTING_MCP_NAME}.env]`;
  const SUBTABLE_RE   = new RegExp(`^\\[mcp_servers\\.${LEGACY_REPORTING_MCP_NAME}\\.`);

  const lines = content.split("\n");
  let mainHeaderCount = 0;
  let envHeaderCount  = 0;
  let inMain = false;
  let inEnv  = false;
  const mainLines = [];
  const envLines  = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inMain = false;
      inEnv  = false;
      if (trimmed === TARGET_HEADER) {
        mainHeaderCount++;
        if (mainHeaderCount > 1) return false;  // duplicate header → custom_or_modified
        inMain = true;
      } else if (trimmed === ENV_HEADER) {
        envHeaderCount++;
        if (envHeaderCount > 1) return false;   // duplicate env table → custom_or_modified
        inEnv = true;
      } else if (SUBTABLE_RE.test(trimmed)) {
        return false;  // unexpected sub-table → custom_or_modified
      }
      continue;
    }
    if (inMain) mainLines.push(trimmed);
    if (inEnv)  envLines.push(trimmed);
  }

  if (mainHeaderCount === 0) return null;  // section absent

  // Main table: only command and args allowed (plus blank lines / comments)
  for (const l of mainLines) {
    if (l === "" || l.startsWith("#")) continue;
    if (!/^(command|args)\s*=/.test(l)) return false;  // extra field
  }

  // command must appear exactly once with the correct value
  const cmdLines  = mainLines.filter(l => /^command\s*=/.test(l));
  const argsLines = mainLines.filter(l => /^args\s*=/.test(l));
  if (cmdLines.length !== 1 || argsLines.length !== 1) return false;  // duplicate or missing
  if (!/^command\s*=\s*"npx"\s*$/.test(cmdLines[0])) return false;
  if (!/^args\s*=\s*\["-y",\s*"@tencent-rtc\/skill-tool@latest"\]\s*$/.test(argsLines[0])) return false;

  // Env sub-table: only PATH = "..." allowed, exactly once
  if (envHeaderCount === 1) {
    const pathLines = envLines.filter(l => /^PATH\s*=/.test(l));
    if (pathLines.length !== 1) return false;  // zero or duplicate PATH
    for (const l of envLines) {
      if (l === "" || l.startsWith("#")) continue;
      if (!/^PATH\s*=\s*"[^"]*"\s*$/.test(l)) return false;  // non-PATH key or malformed PATH
    }
  }

  return true;
}

function writeTextAtomicFollowSymlink(filePath, content) {
  // Resolve symlinks before writing so we update the real target, not the link.
  // Broken symlink or symlink-to-non-file → throw (fail-closed).
  let realPath = filePath;
  try {
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      const resolved = fs.realpathSync(filePath);
      const rstat = fs.lstatSync(resolved);
      if (!rstat.isFile()) {
        const err = new Error("CONFIG_INVALID: symlink target is not a regular file");
        err.code = "CONFIG_INVALID";
        throw err;
      }
      realPath = resolved;
    }
  } catch (e) {
    if (e.code === "ENOENT" && e.message && !e.message.startsWith("CONFIG_INVALID")) {
      realPath = filePath;  // file does not exist yet — will be created
    } else {
      throw e;
    }
  }

  const dir = path.dirname(realPath);
  ensureDir(dir);
  const tmp = path.join(dir, `.c19mig.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "w", 0o600);
    fs.writeSync(fd, content, null, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, realPath);
    // Dir fsync after rename so the directory entry for the new file is durable.
    try {
      const dfd = fs.openSync(dir, "r");
      try { fs.fsyncSync(dfd); } catch (e) {
        if (!["EINVAL", "ENOSYS", "EPERM", "EACCES", "ENOENT"].includes(e?.code)) throw e;
      } finally { fs.closeSync(dfd); }
    } catch (e) {
      if (!["EINVAL", "ENOSYS", "EPERM", "EACCES", "ENOENT"].includes(e?.code)) throw e;
    }
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

function migrateLegacyMcpToml(configPath) {
  if (!fs.existsSync(configPath)) return "not_present";
  let content;
  try { content = fs.readFileSync(configPath, "utf8"); } catch { return "read_error"; }
  const owned = isTomlLegacyMcpOwned(content);
  if (owned === null) return "not_present";
  if (!owned) return "custom_or_modified";
  const cleaned = removeTomlTableHierarchy(content, `mcp_servers.${LEGACY_REPORTING_MCP_NAME}`);
  if (cleaned === content) return "no_change";
  writeTextAtomicFollowSymlink(configPath, cleaned);
  return "migrated";
}

function migrateLegacyForIde(ide, resolvedRoot) {
  switch (ide) {
    case "claude":
      migrateLegacyMcpJson(
        path.join(resolvedRoot, ".mcp.json"),
        path.join(resolvedRoot, ".claude", "settings.json"),
        LEGACY_REPORTING_CLAUDE_PERM,
        "permissions.allow"
      );
      break;
    case "cursor":
      migrateLegacyMcpJson(
        path.join(os.homedir(), ".cursor", "mcp.json"),
        path.join(resolvedRoot, ".cursor", "permissions.json"),
        LEGACY_REPORTING_CURSOR_PERM,
        "mcpAllowlist"
      );
      break;
    case "codebuddy":
      migrateLegacyMcpJson(
        path.join(os.homedir(), ".codebuddy", "mcp.json"),
        null, null, null
      );
      break;
    case "codex":
      migrateLegacyMcpToml(path.join(os.homedir(), ".codex", "config.toml"));
      break;
  }
}

// ── Claude Code permissions (pre-approve MCP tool) ──────────────────────────────
function installClaudePermissions(ideList, resolvedRoot) {
  if (!ideList.includes("claude")) return;

  const settingsDir  = path.join(resolvedRoot, ".claude");
  const settingsPath = path.join(settingsDir, "settings.json");
  ensureDir(settingsDir);

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    let raw;
    try { raw = fs.readFileSync(settingsPath, "utf8"); }
    catch {
      console.warn(`[trtc-install] skipping claude permissions write: cannot read settings file`);
      return;
    }
    try {
      settings = JSON.parse(raw);
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
        console.warn(`[trtc-install] skipping claude permissions write: settings root is not an object`);
        return;
      }
    } catch {
      console.warn(`[trtc-install] skipping claude permissions write: settings file is not valid JSON`);
      return;
    }
  }
  if (settings.permissions !== undefined &&
      (settings.permissions === null || typeof settings.permissions !== "object" || Array.isArray(settings.permissions))) {
    console.warn(`[trtc-install] skipping claude permissions write: permissions field is not an object`);
    return;
  }
  if (settings.permissions === undefined) settings.permissions = {};
  if (settings.permissions.allow !== undefined && !Array.isArray(settings.permissions.allow)) {
    console.warn(`[trtc-install] skipping claude permissions write: permissions.allow is not an array`);
    return;
  }
  if (settings.permissions.allow === undefined) settings.permissions.allow = [];

  const rules = [`mcp__${TRTC_PUSH_MCP_NAME}__*`];
  const added = rules.filter(r => !settings.permissions.allow.includes(r));
  if (added.length > 0) {
    settings.permissions.allow.push(...added);
    writeJsonAtomic(settingsPath, settings);
    console.log(c.green("    ✓ ") + `claude permissions → ${settingsPath}`);
  } else {
    console.log(c.dim(`    ✓ claude permissions already set, skipped`));
  }
}

// ── Cursor permissions (allowlist MCP tool) ─────────────────────────────────────
function installCursorPermissions(ideList, resolvedRoot) {
  if (!ideList.includes("cursor")) return;

  const permDir  = path.join(resolvedRoot, ".cursor");
  const permPath = path.join(permDir, "permissions.json");
  ensureDir(permDir);

  let perms = {};
  if (fs.existsSync(permPath)) {
    let raw;
    try { raw = fs.readFileSync(permPath, "utf8"); }
    catch {
      console.warn(`[trtc-install] skipping cursor permissions write: cannot read permissions file`);
      return;
    }
    try {
      perms = JSON.parse(raw);
      if (!perms || typeof perms !== "object" || Array.isArray(perms)) {
        console.warn(`[trtc-install] skipping cursor permissions write: permissions root is not an object`);
        return;
      }
    } catch {
      console.warn(`[trtc-install] skipping cursor permissions write: permissions file is not valid JSON`);
      return;
    }
  }
  if (perms.mcpAllowlist !== undefined && !Array.isArray(perms.mcpAllowlist)) {
    console.warn(`[trtc-install] skipping cursor permissions write: mcpAllowlist is not an array`);
    return;
  }
  if (!Array.isArray(perms.mcpAllowlist)) perms.mcpAllowlist = [];

  const rules = [`${TRTC_PUSH_MCP_NAME}:*`];
  const added = rules.filter(r => !perms.mcpAllowlist.includes(r));
  if (added.length > 0) {
    perms.mcpAllowlist.push(...added);
    writeJsonAtomic(permPath, perms);
    console.log(c.green("    ✓ ") + `cursor permissions → ${permPath}`);
  } else {
    console.log(c.dim(`    ✓ cursor permissions already set, skipped`));
  }
}

// ── install reporting (durable local event + bounded synchronous flush) ──────
// The official installer is the source of truth for install_completed. It
// invokes this package's self-contained runtime with the active Node binary:
// no nested npx, MCP dependency, Python, or detached child process.
function reportInstall({
  projectRoot,
  installedIdes,
  installMode,
  hookResults,
  eventId = crypto.randomUUID(),
  env = process.env,
  runner = spawnSync,
  runtimePath = path.join(PKG_ROOT, "skills", "trtc", "runtime", "telemetry.cjs"),
  stateRoot,
  legacyIdentityPath,
  installStageToken,
} = {}) {
  const args = [
    runtimePath,
    "install",
    "--cwd", path.resolve(projectRoot),
    "--event-id", eventId,
    "--installed-ides", [...new Set(installedIdes || [])].join(","),
    "--install-mode", installMode,
    "--hook-results-json", JSON.stringify(hookResults || {}),
    "--version", PKG_VERSION,
    "--os", os.platform(),
  ];
  if (stateRoot) args.push("--state-root", path.resolve(stateRoot));
  if (legacyIdentityPath) args.push("--legacy-identity-path", path.resolve(legacyIdentityPath));
  if (installStageToken) args.push("--install-owner-token", String(installStageToken));

  try {
    if (!fs.existsSync(runtimePath)) {
      return { ok: false, eventId, reason: "runtime_missing" };
    }
    const result = runner(process.execPath, args, {
      cwd: path.resolve(projectRoot),
      env,
      encoding: "utf8",
      timeout: 2_500,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (result.error) {
      return { ok: false, eventId, reason: result.error.code || "runtime_failed" };
    }
    if (result.status !== 0) {
      return { ok: false, eventId, reason: `runtime_exit_${result.status}` };
    }
    let telemetry = null;
    try { telemetry = JSON.parse(String(result.stdout || "").trim()); }
    catch { /* Outbox may still be durable even if stdout was malformed. */ }
    return { ok: true, eventId, telemetry };
  } catch (err) {
    const reason = String(err && (err.code || err.message) || "runtime_failed").slice(0, 64);
    return { ok: false, eventId, reason };
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
async function mainUnlocked() {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") { printHelp(); process.exit(0); }
  if (cmd === "--list" || cmd === "-l")          { listSkills(); process.exit(0); }
  if (cmd !== "add") {
    console.error(c.red(`\n  Unknown command: ${cmd}`));
    printHelp();
    process.exit(1);
  }
  if (args.includes("--list")) { listSkills(); process.exit(0); }
  if (args.includes("--help") || args.includes("-h")) { printHelp(); process.exit(0); }

  const isClean   = args.includes("--clean");
  const noReport  = args.includes("--no-report");
  const promptReportingFlagPresent = args.includes("--prompt-reporting");
  const promptReportingArg = getFlag(args, "--prompt-reporting");
  const ideArg    = getFlag(args, "--ide");
  if (promptReportingFlagPresent && promptReportingArg === undefined) {
    throw new Error("--prompt-reporting requires on or off");
  }

  // Resolve ideList:
  //   no --ide        → auto-detect installed IDEs (default behavior)
  //   --ide all       → install for every supported IDE
  //   --ide <name>    → install for that specific IDE only
  let ideList;
  let ideListSource;  // for the CLI hint
  let installMode;
  if (!ideArg) {
    ideList = detectInstalledIDEs();
    ideListSource = "auto-detected";
    installMode = "auto";
  } else if (ideArg === "all") {
    ideList = Object.keys(IDE_TARGETS);
    ideListSource = "all";
    installMode = "all";
  } else {
    ideList = [ideArg];
    ideListSource = "explicit";
    installMode = "specific";
  }
  for (const ide of ideList) {
    if (!IDE_TARGETS[ide]) {
      console.error(c.red(`\n  ✗ Unknown IDE: ${ide}. Valid: ${Object.keys(IDE_TARGETS).join(", ")}, all\n`));
      process.exit(1);
    }
  }

  const cwd = process.cwd();
  let resolvedRoot = findProjectRoot(cwd);
  // Guard: don't install into the package's own tree during local dev.
  if (resolvedRoot === PKG_ROOT) resolvedRoot = cwd;

  // C19 mode is resolved while the project lock is held by main().  It is
  // intentionally before any clean/install/write operation.
  const reportingModeResult = resolveReportingMode(resolvedRoot, {
    home: process.env.HOME || os.homedir(),
  });
  const reportingMode = reportingModeResult.mode;
  if (isClean && reportingMode !== "node_v2") {
    throw new Error(`--clean is not allowed for reporting mode ${reportingMode} (${reportingModeResult.reason})`);
  }
  if (reportingMode === "unknown") {
    console.warn(c.yellow(`  ⚠ Reporting mode is unknown (${reportingModeResult.reason}); preserving existing configuration and skipping installation.`));
    return;
  }
  if (reportingMode === "legacy_mcp") {
    console.log(c.yellow("  ↪ Existing legacy reporting project detected; preserving legacy MCP, Hooks, Skills, and instructions."));
    // Recording the stable grandfathered mode is the only write in this
    // branch. It contains no prompt, identity, or SDKAppID data and prevents
    // a later install from reclassifying the untouched project.
    writeInstallMarker(resolvedRoot, reportingMode, { installerVersion: PKG_VERSION });
    return;
  }
  const stage = writeInstallStage(resolvedRoot, reportingMode, "started", { installerVersion: PKG_VERSION });

  let promptReportingEnabled;
  let allReportingDisabled;
  const savedAllReportingDisabled = readAllReportingDisabled(resolvedRoot);
  if (noReport) {
    promptReportingEnabled = false;
    allReportingDisabled = true;
  } else if (promptReportingArg !== undefined) {
    promptReportingEnabled = parsePromptReportingValue(promptReportingArg);
    allReportingDisabled = promptReportingEnabled ? false : savedAllReportingDisabled;
  } else {
    const existingPreference = readPromptReportingPreference(resolvedRoot);
    if (typeof existingPreference === "boolean") {
      promptReportingEnabled = existingPreference;
      allReportingDisabled = savedAllReportingDisabled;
    } else {
      promptReportingEnabled = true;
      allReportingDisabled = false;
    }
  }

  console.log(`\n  ${c.bold(c.cyan("@tencent-rtc/trtc-agent-skills"))}  ${c.dim("v" + PKG_VERSION)}`);
  console.log(`  ${c.gray("cwd         : " + cwd)}`);
  console.log(`  ${c.gray("projectRoot : " + resolvedRoot)}`);
  const ideHint = ideListSource === "auto-detected"
    ? c.dim("  (auto-detected; pass --ide all or --ide <name> to override)")
    : ideListSource === "all"
      ? c.dim("  (--ide all)")
      : "";
  console.log(`  ${c.gray("IDE(s)      : " + ideList.join(", "))}${ideHint}`);
  console.log("");

  // 1. Install skill dirs (+ co-located knowledge-base) for each IDE.
  if (isClean) {
    // Clean settings hooks + AI instruction markers BEFORE we wipe the IDE
    // dirs, so we can read the existing settings.json files in place.
    cleanHooksSettings(ideList, resolvedRoot);
    cleanAiInstructions(ideList, resolvedRoot);
    cleanCommands(ideList, resolvedRoot);
  }
  for (const ide of ideList) {
    const target = IDE_TARGETS[ide];
    const skillsRootAbs = path.join(resolvedRoot, target.skillsRoot);
    console.log(`  ${c.bold(ide)}  ${c.gray("→ " + skillsRootAbs + "/")}`);

    if (isClean) {
      const wiped = cleanSkills(skillsRootAbs, ide);
      if (wiped > 0) console.log(c.dim(`    ✓ cleaned ${wiped} existing skill ${wiped === 1 ? "entry" : "entries"}`));
    }

    const { modes } = installSkills(skillsRootAbs, resolvedRoot);
    for (const { name, mode } of modes) {
      const tag = mode === "symlink" ? c.dim(" (symlink → skills/" + name + ")") : "";
      console.log(c.green("    ✓ ") + name + "/" + tag);
    }

    const kbDest = copyKnowledgeBase(skillsRootAbs);
    console.log(c.green("    ✓ ") + "knowledge-base/ " + c.dim("→ " + kbDest));
  }

  // 2. Install explicit log-analysis commands where the IDE supports them.
  console.log(`\n  ${c.bold("EXPLICIT COMMANDS")}`);
  installCommands(ideList, resolvedRoot);

  // 3. Ensure the installed Python tools can load their isolated YAML runtime.
  console.log(`\n  ${c.bold("PYTHON RUNTIME")}`);
  const pythonRuntime = verifyInstalledRuntime(
    ensurePythonDependencies(ideList, resolvedRoot)
  );
  if (pythonRuntime.ok) {
    const source =
      pythonRuntime.source === "isolated-cache"
        ? "isolated PyYAML"
        : "existing PyYAML";
    console.log(
      c.green("    ✓ ") +
      `${pythonRuntime.command} + ${source}` +
      c.dim(pythonRuntime.verified ? " (routing + reporting verified)" : "")
    );
  } else {
    console.log(
      c.yellow("    ⚠ ") +
      `Python runtime incomplete: ${pythonRuntime.message || pythonRuntime.reason}`
    );
    console.log(
      c.dim("      Skill responses continue, but Python-backed routing may degrade.")
    );
  }

  // 3. Install hooks (per-IDE: copy hooks dir + merge settings.json hooks).
  console.log(`\n  ${c.bold("HOOKS")}`);
  const hookResults = installHooks(ideList, resolvedRoot);
  writeInstallStage(resolvedRoot, reportingMode, "hooks", { installerVersion: PKG_VERSION, ownerToken: stage.ownerToken });

  // 4. Install AI instruction files (CLAUDE.md / AGENTS.md / CODEBUDDY.md /
  //    .cursor/rules/ui-mode.mdc) so the agent has routing rules.
  console.log(`\n  ${c.bold("AI INSTRUCTIONS")}`);
  installAiInstructions(ideList, resolvedRoot);
  writeInstallStage(resolvedRoot, reportingMode, "instructions", { installerVersion: PKG_VERSION, ownerToken: stage.ownerToken });

  // 5. Install MCP server config + permissions.
  console.log(`\n  ${c.bold("MCP")}`);
  installMcp(ideList, resolvedRoot);
  installClaudePermissions(ideList, resolvedRoot);
  installCursorPermissions(ideList, resolvedRoot);

  writePromptReportingPreference(
    resolvedRoot,
    promptReportingEnabled,
    {
      allReportingDisabled,
    }
  );

  // 6. Anonymous install reporting. The event is durable before a bounded
  // network flush; any reporting failure is independent from install success.
  if (!allReportingDisabled) {
    reportInstall({
      projectRoot: resolvedRoot,
      installedIdes: ideList,
      installMode,
      hookResults,
      installStageToken: stage.ownerToken,
    });
  }

  writeInstallStage(resolvedRoot, reportingMode, "complete", { installerVersion: PKG_VERSION, ownerToken: stage.ownerToken });
  writeInstallMarker(resolvedRoot, reportingMode, { installerVersion: PKG_VERSION });
  clearInstallStage(resolvedRoot);

  // 7. Done.
  console.log(`\n  ${c.bold("Done.")} ${c.dim("Just describe what you want to build in your IDE — the skill activates automatically.")}\n`);
}

// The project lock spans mode detection, clean gating, all installation
// writes, and the stable marker commit. Help/list and non-add commands retain
// their old behavior and do not create project state.
async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "add" || args.includes("--help") || args.includes("-h") || args.includes("--list")) {
    return mainUnlocked();
  }
  const cwd = process.cwd();
  let root = findProjectRoot(cwd);
  if (root === PKG_ROOT) root = cwd;
  const lock = acquireProjectInstallLock(root);
  if (!lock.acquired) throw new Error(`project install lock unavailable (${lock.reason || "busy"})`);
  try {
    return await mainUnlocked();
  } finally {
    releaseProjectInstallLock(lock);
  }
}

module.exports = {
  getDefaultPathFallbacks,
  buildNodePathEnv,
  buildNpxMcpEntry,
  resolveTrtcPushMcpEntry,
  getMcpServersToInstall,
  resolvePythonCommand,
  pythonCanImportYaml,
  pythonDependencyCache,
  ensurePythonDependencies,
  verifyInstalledRuntime,
  buildHostStopCommand,
  installMcpToml,
  removeTomlTableHierarchy,
  reportingStatePath,
  legacyReportingStatePath,
  readPromptReportingPreference,
  readAllReportingDisabled,
  writePromptReportingPreference,
  _releaseInstallerLock,
  parsePromptReportingValue,
  copyRecursive,
  buildPromptHookCommand,
  stripOwnedHookEntries,
  stripOwnedMarkerBlocks,
  injectMarkered,
  installHooks,
  reportInstall,
  // C19 migration (exported for unit testing)
  classifyLegacyMcpEntry,
  migrateLegacyMcpJson,
  migrateLegacyPermEntry,
  isTomlLegacyMcpOwned,
  migrateLegacyMcpToml,
  migrateLegacyForIde,
  resolveReportingMode,
  writeInstallMarker,
  writeInstallStage,
  clearInstallStage,
  acquireProjectInstallLock,
  releaseProjectInstallLock,
  findProjectRoot,
};

if (require.main === module) {
  main().catch(err => {
    console.error(c.red(`\n  Error: ${err.message || err}\n`));
    if (err.stack && process.env.DEBUG) console.error(c.dim(err.stack) + "\n");
    process.exit(1);
  });
}
