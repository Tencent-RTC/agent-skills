const assert = require("node:assert/strict");
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
