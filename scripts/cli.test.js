const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const TEST_NODE_BIN = path.join(os.tmpdir(), "trtc-agent-skills-node-v20", "bin");
const TEST_NODE_EXEC = path.join(TEST_NODE_BIN, process.platform === "win32" ? "node.exe" : "node");
const TEST_PATH_ENV = ["/usr/bin", "/bin"].join(path.delimiter);
const TEST_LOCAL_MCP_ENTRY = path.join(os.tmpdir(), "trtc-push-mcp", "src", "index.js");

const originalExit = process.exit;
process.exit = (code) => {
  throw new Error(`unexpected process.exit(${code}) while loading bin/cli.js`);
};
let cli;
try {
  cli = require("../bin/cli.js");
} finally {
  process.exit = originalExit;
}

const {
  getDefaultPathFallbacks,
  buildNodePathEnv,
  buildNpxMcpEntry,
  resolveTrtcPushMcpEntry,
  reportingStatePath,
  readPromptReportingPreference,
  readAllReportingDisabled,
  writePromptReportingPreference,
  parsePromptReportingValue,
  resolvePythonCommand,
  ensurePythonDependencies,
  installMcpToml,
} = cli;

test("getDefaultPathFallbacks uses Windows system root", () => {
  assert.deepEqual(
    getDefaultPathFallbacks({
      platform: "win32",
      env: { SystemRoot: "D:\\Windows" },
    }),
    ["D:\\Windows\\System32", "D:\\Windows"]
  );
});

test("getDefaultPathFallbacks keeps Unix-style fallback paths", () => {
  assert.deepEqual(
    getDefaultPathFallbacks({ platform: "darwin", env: {} }),
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
  );
});

test("buildNodePathEnv deduplicates path entries and appends fallbacks", () => {
  const envPath = [TEST_NODE_BIN, "/usr/local/bin"].join(path.delimiter);
  const parts = buildNodePathEnv({
    execPath: TEST_NODE_EXEC,
    pathEnv: envPath,
    platform: "darwin",
    env: {},
  }).split(path.delimiter);

  assert.equal(parts[0], TEST_NODE_BIN);
  assert.equal(parts.indexOf(TEST_NODE_BIN), parts.lastIndexOf(TEST_NODE_BIN));
  assert.ok(parts.includes("/opt/homebrew/bin"));
  assert.ok(parts.includes("/usr/bin"));
});

test("buildNpxMcpEntry prefixes the active node bin in PATH", () => {
  const entry = buildNpxMcpEntry("@tencent-rtc/trtc-push-mcp@1", {
    execPath: TEST_NODE_EXEC,
    pathEnv: TEST_PATH_ENV,
  });

  assert.equal(entry.type, "stdio");
  assert.equal(entry.command, "npx");
  assert.deepEqual(entry.args, ["-y", "@tencent-rtc/trtc-push-mcp@1"]);
  assert.equal(entry.env.PATH.split(path.delimiter)[0], TEST_NODE_BIN);
});

test("resolveTrtcPushMcpEntry defaults to published npm package", () => {
  const entry = resolveTrtcPushMcpEntry({
    env: {
      PATH: TEST_PATH_ENV,
      TRTC_PUSH_MCP_PACKAGE: "@tencent-rtc/trtc-push-mcp@1",
    },
    execPath: TEST_NODE_EXEC,
    existsSync: () => false,
  });

  assert.equal(entry.source, "npm");
  assert.equal(entry.command, "npx");
  assert.deepEqual(entry.args, ["-y", "@tencent-rtc/trtc-push-mcp@1"]);
  assert.equal(entry.env.PATH.split(path.delimiter)[0], TEST_NODE_BIN);
});

test("resolveTrtcPushMcpEntry uses explicit local entry when provided", () => {
  const entry = resolveTrtcPushMcpEntry({
    env: {
      PATH: TEST_PATH_ENV,
      TRTC_PUSH_MCP_ENTRY: TEST_LOCAL_MCP_ENTRY,
    },
    existsSync: (target) => target === TEST_LOCAL_MCP_ENTRY,
  });

  assert.equal(entry.source, "env");
  assert.equal(entry.command, "node");
  assert.deepEqual(entry.args, [TEST_LOCAL_MCP_ENTRY]);
  assert.deepEqual(entry.env, { TRTC_PUSH_MCP_REPORT_DISABLED: "1" });
});

test("experience reporting flag accepts explicit on and off", () => {
  assert.equal(parsePromptReportingValue("on"), true);
  assert.equal(parsePromptReportingValue("off"), false);
  assert.throws(() => parsePromptReportingValue("maybe"), /must be on or off/);
});

test("reporting preferences are project scoped and preserve state", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-reporting-pref-"));
  const project = path.join(tmp, "project");
  const cache = path.join(tmp, "cache");
  fs.mkdirSync(project, { recursive: true });
  const options = { env: { XDG_CACHE_HOME: cache }, home: tmp };
  const statePath = reportingStatePath(project, options);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ existing: "kept" }), "utf8");

  writePromptReportingPreference(project, false, options);

  assert.equal(readPromptReportingPreference(project, options), false);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.existing, "kept");
  assert.equal(state.prompt_reporting_enabled, false);
  assert.equal(readAllReportingDisabled(project, options), false);

  writePromptReportingPreference(project, false, {
    ...options,
    allReportingDisabled: true,
  });
  assert.equal(readAllReportingDisabled(project, options), true);
  const nested = path.join(project, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(readPromptReportingPreference(nested, options), false);
  assert.equal(readAllReportingDisabled(nested, options), true);
  assert.equal(statePath.includes(project), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("python dependency bootstrap installs PyYAML into project-local skill roots", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-python-runtime-"));
  const project = path.join(tmp, "project");
  const root = path.join(project, ".codex", "skills", "trtc");
  fs.mkdirSync(root, { recursive: true });
  const runner = (command, args, options = {}) => {
    if (args[0] === "--version") return { status: 0, stdout: "Python 3.14\n" };
    if (args[0] === "-c" && args[1].includes("version_info")) {
      return { status: 0, stdout: "3.14\n" };
    }
    if (args[0] === "-c" && args[1] === "import yaml") {
      return {
        status: fs.existsSync(path.join(options.cwd, "yaml")) ? 0 : 1,
        stderr: "",
      };
    }
    if (args.includes("pip") && args.includes("install")) {
      const target = args[args.indexOf("--target") + 1];
      fs.mkdirSync(path.join(target, "yaml"), { recursive: true });
      fs.writeFileSync(path.join(target, "yaml", "__init__.py"), "", "utf8");
      return { status: 0, stdout: "" };
    }
    return { status: 1, stderr: "unexpected command" };
  };

  try {
    assert.equal(
      resolvePythonCommand({ env: {}, runner }),
      "python3"
    );
    const result = ensurePythonDependencies(["codex"], project, {
      env: { XDG_CACHE_HOME: path.join(tmp, "cache") },
      home: tmp,
      runner,
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.source, "isolated-cache");
    assert.equal(fs.existsSync(path.join(root, "yaml", "__init__.py")), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Codex MCP TOML install is idempotent across main and nested env tables", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-codex-mcp-"));
  const configPath = path.join(tmp, "config.toml");
  const initial = [
    "[unrelated]",
    'value = "keep"',
    "",
    "[mcp_servers.tencent-rtc-skill-tool]",
    'command = "old-npx"',
    'args = ["old-package"]',
    "[mcp_servers.tencent-rtc-skill-tool.env]",
    'PATH = "/old/path"',
    "",
    "[mcp_servers.tencent-rtc-skill-tool.env]",
    'EXTRA = "duplicate"',
    "",
    "[trtc_agent_skills_installer_duplicate.tencent-rtc-skill-tool]",
    'command = "stale"',
    "[trtc_agent_skills_installer_duplicate.tencent-rtc-skill-tool.env]",
    'PATH = "/stale/path"',
    "",
  ].join("\n");
  const entry = {
    command: "npx",
    args: ["-y", "@tencent-rtc/skill-tool@latest"],
    env: {
      PATH: "/current/path",
      TRTC_TEST: "1",
    },
  };

  try {
    fs.writeFileSync(configPath, initial, "utf8");
    installMcpToml(configPath, "tencent-rtc-skill-tool", entry);
    const once = fs.readFileSync(configPath, "utf8");
    installMcpToml(configPath, "tencent-rtc-skill-tool", entry);
    const twice = fs.readFileSync(configPath, "utf8");

    assert.equal(twice, once);
    assert.equal(
      (twice.match(/^\[mcp_servers\.tencent-rtc-skill-tool\]$/gm) || []).length,
      1
    );
    assert.equal(
      (twice.match(/^\[mcp_servers\.tencent-rtc-skill-tool\.env\]$/gm) || []).length,
      1
    );
    assert.equal(twice.includes("trtc_agent_skills_installer_duplicate"), false);
    assert.equal(twice.includes('value = "keep"'), true);
    assert.equal(twice.includes('PATH = "/current/path"'), true);
    assert.equal(twice.includes('TRTC_TEST = "1"'), true);
    assert.equal(twice.includes("/old/path"), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
