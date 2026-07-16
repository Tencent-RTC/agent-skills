#!/usr/bin/env node

"use strict";

/**
 * @tencent-rtc/trtc-agent-skills installer
 *
 * Installs the TRTC AI Integration skill suite (cross-referencing skills:
 * trtc + trtc-onboarding/docs/topic/search/apply + trtc-ai-service) plus the
 * shared knowledge-base into your IDE's skills directory, and wires up the
 * `tencent-rtc-skill-tool` MCP server (used for prompt / runtime telemetry).
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
 *   npx @tencent-rtc/trtc-agent-skills add --no-report
 *   npx @tencent-rtc/trtc-agent-skills add --list
 *   npx @tencent-rtc/trtc-agent-skills add --help
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");

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
  "trtc-conference",
  "trtc-ai-service",
  "trtc-ai-oral-coach",
  "trtc-ai-realtime-interpreter",
  "trtc-chat",
  "trtc-push",
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

const MCP_SERVER_NAME  = "tencent-rtc-skill-tool";
const MCP_SERVER_ENTRY = "@tencent-rtc/skill-tool@latest";

// Multi-MCP registry. tencent-rtc-skill-tool is always installed via npx.
// trtc-push-mcp is now public on npm and should be installed automatically with
// the skill suite. Maintainers can still force a local checkout via
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
  const servers = [
    {
      name: MCP_SERVER_NAME,
      entry: buildNpxMcpEntry(MCP_SERVER_ENTRY),
    },
  ];
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
  servers.push({ name: TRTC_PUSH_MCP_NAME, entry, note });
  return servers;
}

// Hooks distribution targets per IDE.
//   claude / codebuddy / codex: hooks/ files copied to <root>/.{ide}/hooks/, and
//     hooks/hooks.json is rewritten + merged into <root>/.{ide}/settings.json.
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
  },
  codebuddy: {
    hooksDir:        ".codebuddy/hooks",
    settingsFile:    ".codebuddy/settings.json",
    sourceConfig:    "hooks.json",
    rootPlaceholder: "${CODEBUDDY_PLUGIN_ROOT}",
    rootRewrite:     ".codebuddy",
    fallbackPlaceholder: "${CLAUDE_PLUGIN_ROOT}",
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
  "/skills/trtc/room-builder/guardrails/",
  "/skills/trtc-topic/guardrails/",   // legacy — removed from allowlist, kept for cleanup
  "/skills/trtc-apply/guardrails/",   // legacy — removed from allowlist, kept for cleanup
  "/skills/trtc-conference/hooks/",
  "/hooks/trtc-agent-skills/cursor-adapter.py",
];

function isOwnedHookEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.__trtc_agent_skills__) return true;
  // Cursor-style: { command: "...", ... }
  if (typeof entry.command === "string" && OWNED_COMMAND_HINTS.some(h => entry.command.includes(h))) {
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

// Knowledge-base lives next to the skills root (sibling), because skills
// reference it via ${CLAUDE_PLUGIN_ROOT}/knowledge-base — we mirror that by
// placing knowledge-base/ as a sibling of the skills dir's parent. To keep it
// simple and robust across IDEs, we copy KB into <skillsRoot>/../knowledge-base
// AND keep a project-root copy. See copyKnowledgeBase().

// ── fs helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
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

// ── project root resolution ───────────────────────────────────────────────────
// Walk UP from cwd for strong repo-root signals (P1 monorepo manifest,
// P2 package.json workspaces, P3 .git). Otherwise P4 cwd-local package.json,
// else P5 cwd. Same semantics as the reference installer.
function findProjectRoot(startCwd) {
  const start = path.resolve(startCwd);
  let dir = start;
  while (true) {
    if (
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(dir, "lerna.json")) ||
      fs.existsSync(path.join(dir, "turbo.json"))
    ) return dir;

    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg && pkg.workspaces) return dir;
      } catch { /* malformed — keep walking */ }
    }

    if (fs.existsSync(path.join(dir, ".git"))) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (fs.existsSync(path.join(start, "package.json"))) return start;
  return start;
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
    ${c.dim("MCP    :")} ${c.gray("tencent-rtc-skill-tool + npm trtc-push-mcp (local only with TRTC_PUSH_MCP_ENTRY)")}

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
    "trtc-chat":          "IM / Chat SDK integration",
    "trtc-push":          "TIMPush offline push integration (via trtc-push-mcp)",
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
  // Wipe only our exact hooks dir (not the IDE's hooks/ parent). For cursor
  // this is the namespaced .cursor/hooks/trtc-agent-skills/ subdir; for other
  // IDEs it coincides with the parent .{ide}/hooks/ dir.
  const hooksTarget = HOOKS_TARGETS[ide];
  const resolvedRoot = path.dirname(path.dirname(skillsRootAbs));
  const hooksDir = hooksTarget
    ? path.join(resolvedRoot, hooksTarget.hooksDir)
    : path.join(path.dirname(skillsRootAbs), "hooks");
  if (fs.existsSync(hooksDir)) { rmrf(hooksDir); }
  return wiped;
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
// __trtc_agent_skills__ where the IDE schema allows (claude/codebuddy/cursor),
// and fall back to command-path matching for strict-schema IDEs (codex).
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
          settings.hooks[event] = val.filter(e => !isOwnedHookEntry(e));
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
    out = out.replace(/\$\{[A-Z_]+:-[^}]+\}/g, ideAbsRoot);
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

// Copy the hooks/ source directory into <root>/.{ide}/hooks/ so the dispatched
// scripts (cursor-adapter.py + the underlying guardrail scripts referenced by
// hooks.json) sit next to the IDE's skills/.
function copyHooksDir(target, resolvedRoot) {
  const dest = path.join(resolvedRoot, target.hooksDir);
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
function mergeHooksConfig(target, resolvedRoot, ideAbsRoot, hooksDestAbs) {
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
    catch { existing = {}; }
  }
  if (!existing || typeof existing !== "object") existing = {};

  // The hooks payload sits under `hooks` (claude/codebuddy/cursor/codex all
  // use this key). For Cursor we additionally track our injected entries so we
  // can later remove only ours on uninstall.
  const incomingHooks = parsed.hooks || {};
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
      // Cursor format: hooks.<event> = [{command: ...}, ...]
      const stripped = (existing.hooks[eventName] || [])
        .filter(e => !isOwnedHookEntry(e));
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

  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return { settingsPath, eventCount: Object.keys(incomingHooks).length };
}

function installHooks(ideList, resolvedRoot) {
  for (const ide of ideList) {
    const target = HOOKS_TARGETS[ide];
    if (!target) continue;

    const ideAbsRoot = path.join(resolvedRoot, path.dirname(target.hooksDir));
    const hooksDest = copyHooksDir(target, resolvedRoot);
    console.log(c.green("    ✓ ") + `${ide} hooks → ${hooksDest}/`);

    const merged = mergeHooksConfig(target, resolvedRoot, ideAbsRoot, hooksDest);
    if (merged) {
      const isUserLevel = path.isAbsolute(target.settingsFile);
      const prefix = isUserLevel ? c.yellow("    ⚠ ") : c.green("    ✓ ");
      const note   = isUserLevel ? c.dim(" (user-level — affects all cursor projects)") : "";
      console.log(`${prefix}${ide} hooks settings → ${merged.settingsPath} ${c.dim(`(${merged.eventCount} events)`)}${note}`);
    }
  }
}

// ── AI instruction files installation ─────────────────────────────────────────
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injectMarkered(srcAbs, destAbs) {
  const trtcContent = fs.readFileSync(srcAbs, "utf8").trimEnd();
  const block = `${MD_MARKER_BEGIN}\n${trtcContent}\n${MD_MARKER_END}\n`;

  ensureDir(path.dirname(destAbs));
  if (!fs.existsSync(destAbs)) {
    fs.writeFileSync(destAbs, block, "utf8");
    return "new";
  }
  let existing = fs.readFileSync(destAbs, "utf8");
  const re = new RegExp(`${escapeRegex(MD_MARKER_BEGIN)}[\\s\\S]*?${escapeRegex(MD_MARKER_END)}\\n?`, "g");
  if (re.test(existing)) {
    existing = existing.replace(re, block);
    fs.writeFileSync(destAbs, existing, "utf8");
    return "replaced";
  }
  existing = existing.trimEnd() + "\n\n" + block;
  fs.writeFileSync(destAbs, existing, "utf8");
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
        try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
        catch { config = {}; }
      }
      if (!config.mcpServers || typeof config.mcpServers !== "object") {
        config.mcpServers = {};
      }
      for (const server of servers) {
        config.mcpServers[server.name] = server.entry;
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
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
    for (const [k, v] of Object.entries(serverEntry.env)) {
      lines.push(`[mcp_servers.${serverName}.env]`);
      lines.push(`${k} = "${String(v).replace(/"/g, '\\"')}"`);
    }
  }
  const newSection = lines.join("\n") + "\n";

  const escapedName = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `\\[mcp_servers\\.${escapedName}\\](?:\\.[^\\]\\n]+)?\\n(?:(?!\\[)[^\\n]*\\n)*`,
    "g"
  );
  content = content.replace(sectionRegex, "");
  content = content.trimEnd() + (content.trim() ? "\n\n" : "") + newSection;
  fs.writeFileSync(configPath, content, "utf8");
}

// ── Claude Code permissions (pre-approve MCP tool) ──────────────────────────────
function installClaudePermissions(ideList, resolvedRoot) {
  if (!ideList.includes("claude")) return;

  const settingsDir  = path.join(resolvedRoot, ".claude");
  const settingsPath = path.join(settingsDir, "settings.json");
  ensureDir(settingsDir);

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
    catch { settings = {}; }
  }
  if (!settings.permissions || typeof settings.permissions !== "object") settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

  const rules = [`mcp__${MCP_SERVER_NAME}__*`, `mcp__${TRTC_PUSH_MCP_NAME}__*`];
  const added = rules.filter(r => !settings.permissions.allow.includes(r));
  if (added.length > 0) {
    settings.permissions.allow.push(...added);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
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
    try { perms = JSON.parse(fs.readFileSync(permPath, "utf8")); }
    catch { perms = {}; }
  }
  if (!Array.isArray(perms.mcpAllowlist)) perms.mcpAllowlist = [];

  const rules = [
    `${MCP_SERVER_NAME}:skill_analysis`,
    `${TRTC_PUSH_MCP_NAME}:*`,
  ];
  const added = rules.filter(r => !perms.mcpAllowlist.includes(r));
  if (added.length > 0) {
    perms.mcpAllowlist.push(...added);
    fs.writeFileSync(permPath, JSON.stringify(perms, null, 2) + "\n", "utf8");
    console.log(c.green("    ✓ ") + `cursor permissions → ${permPath}`);
  } else {
    console.log(c.dim(`    ✓ cursor permissions already set, skipped`));
  }
}

// ── install reporting (fire-and-forget) ─────────────────────────────────────────
// Spawns the MCP server with --report. All reporting details (endpoint, etc.)
// live inside the MCP server; install.js only passes context fields.
function reportInstall({ ide }) {
  const payload = JSON.stringify({
    method: 2,                 // 2 = trtc-agent-skills install (1=chat-web-skill, 2=trtc-agent-skills)
    version: PKG_VERSION,
    framework: "all",
    ide,
    os: os.platform(),
  });

  try {
    const { spawn } = require("child_process");
    const child = spawn("npx", ["-y", MCP_SERVER_ENTRY, "--report", payload], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // never block install on reporting failure
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
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

  const isClean   = args.includes("--clean");
  const noReport  = args.includes("--no-report");
  const ideArg    = getFlag(args, "--ide");

  // Resolve ideList:
  //   no --ide        → auto-detect installed IDEs (default behavior)
  //   --ide all       → install for every supported IDE
  //   --ide <name>    → install for that specific IDE only
  let ideList;
  let ideListSource;  // for the CLI hint
  if (!ideArg) {
    ideList = detectInstalledIDEs();
    ideListSource = "auto-detected";
  } else if (ideArg === "all") {
    ideList = Object.keys(IDE_TARGETS);
    ideListSource = "all";
  } else {
    ideList = [ideArg];
    ideListSource = "explicit";
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

  // 2. Install hooks (per-IDE: copy hooks dir + merge settings.json hooks).
  console.log(`\n  ${c.bold("HOOKS")}`);
  installHooks(ideList, resolvedRoot);

  // 3. Install AI instruction files (CLAUDE.md / AGENTS.md / CODEBUDDY.md /
  //    .cursor/rules/ui-mode.mdc) so the agent has routing rules.
  console.log(`\n  ${c.bold("AI INSTRUCTIONS")}`);
  installAiInstructions(ideList, resolvedRoot);

  // 4. Install MCP server config + permissions.
  console.log(`\n  ${c.bold("MCP")}`);
  installMcp(ideList, resolvedRoot);
  installClaudePermissions(ideList, resolvedRoot);
  installCursorPermissions(ideList, resolvedRoot);

  // 5. Anonymous install reporting (fire-and-forget; opt out via --no-report).
  if (!noReport) reportInstall({ ide: ideArg || ideListSource });

  // 6. Done.
  console.log(`\n  ${c.bold("Done.")} ${c.dim("Just describe what you want to build in your IDE — the skill activates automatically.")}\n`);
}

module.exports = {
  getDefaultPathFallbacks,
  buildNodePathEnv,
  buildNpxMcpEntry,
  resolveTrtcPushMcpEntry,
  getMcpServersToInstall,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(c.red(`\n  Error: ${err.message || err}\n`));
    if (err.stack && process.env.DEBUG) console.error(c.dim(err.stack) + "\n");
    process.exit(1);
  }
}
