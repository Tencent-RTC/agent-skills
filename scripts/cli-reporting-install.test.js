const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "cli.js");

const originalExit = process.exit;
process.exit = code => {
  throw new Error(`unexpected process.exit(${code}) while loading bin/cli.js`);
};
let reportingStatePath;
try {
  ({ reportingStatePath } = require("../bin/cli.js"));
} finally {
  process.exit = originalExit;
}

function runInstaller(project, home, cache, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [CLI, "add", "--ide", "all", ...extraArgs],
    {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        XDG_CACHE_HOME: cache,
        TRTC_SKILLS_COPY: "1",
        NO_COLOR: "1",
        PATH: "",
      },
      encoding: "utf8",
      timeout: 30_000,
    }
  );
}

test("all IDE installs share persistent experience and global reporting preferences", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-reporting-install-"));
  const project = path.join(tmp, "project");
  const home = path.join(tmp, "home");
  const cache = path.join(tmp, "cache");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), "{}\n", "utf8");

  try {
    const first = runInstaller(project, home, cache);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.doesNotMatch(first.stdout, /\[Y\/n\]/);
    assert.doesNotMatch(first.stdout, /EXPERIENCE REPORTING|ALL REPORTING/);

    for (const ide of ["claude", "cursor", "codebuddy", "codex"]) {
      const reporter = path.join(project, `.${ide}`, "skills", "trtc", "tools", "reporting.py");
      const reporterV2 = path.join(project, `.${ide}`, "skills", "trtc", "tools", "reporting_v2.py");
      const chatReporter = path.join(
        project,
        `.${ide}`,
        "skills",
        "trtc-chat",
        "tools",
        "reporting.py"
      );
      assert.equal(fs.existsSync(reporter), true, `${ide} missing reporting.py`);
      assert.equal(fs.existsSync(reporterV2), true, `${ide} missing reporting_v2.py`);
      assert.equal(fs.existsSync(chatReporter), true, `${ide} missing chat reporting.py`);
    }

    for (const [ide, configName] of [
      ["claude", "settings.json"],
      ["codebuddy", "settings.json"],
      ["codex", "hooks.json"],
    ]) {
      const hookConfig = JSON.parse(
        fs.readFileSync(path.join(project, `.${ide}`, configName), "utf8")
      );
      const submitHooks = hookConfig.hooks.UserPromptSubmit || [];
      assert.equal(submitHooks.length, 1, `${ide} missing UserPromptSubmit hook`);
      const submitCommand = submitHooks[0].hooks[0].command;
      assert.match(
        submitCommand,
        /skills\/trtc\/tools\/reporting\.py.*bind-session/
      );
      assert.equal(
        submitCommand.includes(`TRTC_HOST_IDE="${ide}"`),
        true,
        `${ide} hook missing explicit IDE marker: ${submitCommand}`
      );
    }

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(project, ".cursor", "hooks.json"), "utf8")
    );
    assert.equal(cursorHooks.hooks.beforeSubmitPrompt.length, 1);
    assert.match(
      cursorHooks.hooks.beforeSubmitPrompt[0].command,
      /cursor-adapter\.py.*bind-reporting-session/
    );

    for (const hostFile of ["AGENTS.md", "CLAUDE.md", "CODEBUDDY.md"]) {
      const content = fs.readFileSync(path.join(project, hostFile), "utf8");
      assert.equal((content.match(/tools\/reporting\.py/g) || []).length, 2);
      assert.match(content, /preference --enabled off/);
    }
    const cursorRulePath = path.join(project, ".cursor", "rules", "ui-mode.mdc");
    assert.equal(fs.existsSync(cursorRulePath), true);
    const cursorRule = fs.readFileSync(cursorRulePath, "utf8");
    assert.equal((cursorRule.match(/tools\/reporting\.py/g) || []).length, 2);
    assert.match(cursorRule, /preference --enabled off/);
    assert.match(cursorRule, /\.cursor\/skills\/trtc\/SKILL\.md/);

    const statePath = reportingStatePath(project, {
      env: { XDG_CACHE_HOME: cache },
      home,
    });
    assert.equal(fs.existsSync(statePath), true, `missing ${statePath}\n${first.stdout}`);
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, true);
    assert.equal(state.all_reporting_disabled, false);

    const second = runInstaller(project, home, cache, ["--prompt-reporting", "off"]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, false);
    assert.equal(state.all_reporting_disabled, false);

    const globalOff = runInstaller(project, home, cache, ["--no-report"]);
    assert.equal(globalOff.status, 0, globalOff.stderr || globalOff.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, false);
    assert.equal(state.all_reporting_disabled, true);

    const third = runInstaller(project, home, cache);
    assert.equal(third.status, 0, third.stderr || third.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, false);
    assert.equal(state.all_reporting_disabled, true);

    const reenabled = runInstaller(project, home, cache, ["--prompt-reporting", "on"]);
    assert.equal(reenabled.status, 0, reenabled.stderr || reenabled.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, true);
    assert.equal(state.all_reporting_disabled, false);

    const codexConfig = fs.readFileSync(
      path.join(home, ".codex", "config.toml"),
      "utf8"
    );
    for (const server of ["tencent-rtc-skill-tool", "trtc-push-mcp"]) {
      const escaped = server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.equal(
        (codexConfig.match(new RegExp(`^\\[mcp_servers\\.${escaped}\\]$`, "gm")) || []).length,
        1,
        `${server} main MCP table must be unique`
      );
      assert.equal(
        (
          codexConfig.match(
            new RegExp(`^\\[mcp_servers\\.${escaped}\\.env\\]$`, "gm")
          ) || []
        ).length,
        1,
        `${server} env MCP table must be unique`
      );
    }
    assert.equal(
      codexConfig.includes("trtc_agent_skills_installer_duplicate"),
      false
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
