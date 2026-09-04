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
let legacyReportingStatePath;
let writePromptReportingPreference;
let reportInstall;
let buildPromptHookCommand;
let buildHostStopCommand;
let stripOwnedHookEntries;
let stripOwnedMarkerBlocks;
let injectMarkered;
let installHooks;
try {
  ({
    reportingStatePath,
    legacyReportingStatePath,
    writePromptReportingPreference,
    reportInstall,
    buildPromptHookCommand,
    buildHostStopCommand,
    stripOwnedHookEntries,
    stripOwnedMarkerBlocks,
    injectMarkered,
    installHooks,
  } = require("../bin/cli.js"));
} finally {
  process.exit = originalExit;
}

test("C13 marker injection collapses nested and orphan installer markers", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-marker-repair-"));
  const src = path.join(tmp, "source.md");
  const dest = path.join(tmp, "CODEBUDDY.md");
  const begin = "<!-- TRTC-AGENT-SKILLS:BEGIN -->";
  const end = "<!-- TRTC-AGENT-SKILLS:END -->";
  try {
    fs.writeFileSync(src, `${begin}\nNEW DISPATCHER\n${end}\n`, "utf8");
    fs.writeFileSync(dest,
      `user-before\n${begin}\nOLD ONE\n${begin}\nOLD TWO\n${end}\n${end}\n${end}\nuser-after\n`,
      "utf8");
    assert.equal(injectMarkered(src, dest), "replaced");
    const repaired = fs.readFileSync(dest, "utf8");
    assert.equal(repaired.split(begin).length - 1, 1);
    assert.equal(repaired.split(end).length - 1, 1);
    assert.match(repaired, /user-before/);
    assert.match(repaired, /user-after/);
    assert.match(repaired, /NEW DISPATCHER/);
    assert.doesNotMatch(repaired, /OLD ONE|OLD TWO/);
    const malformed = `keep\n${begin}\nunterminated\n`;
    fs.writeFileSync(dest, malformed, "utf8");
    assert.equal(injectMarkered(src, dest), "skipped-malformed");
    assert.equal(fs.readFileSync(dest, "utf8"), malformed);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("C13 nested hook cleanup preserves user siblings and matcher order", () => {
  const userA = { type: "command", command: "user-a" };
  const oldTrtc = { type: "command", command: "python3 /tmp/skills/trtc/tools/reporting.py bind-session" };
  const userB = { type: "command", command: "user-b" };
  for (const ide of ["claude", "codebuddy", "codex"]) {
    const result = stripOwnedHookEntries([{ matcher: ide, hooks: [userA, oldTrtc, userB], __trtc_agent_skills__: true }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].matcher, ide);
    assert.deepEqual(result[0].hooks, [userA, userB]);
    assert.equal(result[0].__trtc_agent_skills__, undefined);
  }
  assert.deepEqual(stripOwnedHookEntries([{ command: "user" }, { command: "/x/hooks/trtc-agent-skills/cursor-adapter.py bind" }]), [{ command: "user" }]);
  assert.deepEqual(stripOwnedHookEntries([{ command: "user" }, { command: "C:\\x\\skills\\trtc\\runtime\\telemetry.cjs hook" }]), [{ command: "user" }]);
});

test("C13 prompt command uses direct Node runtime and quotes paths", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc hook 'quoted' "));
    const runtime = path.join(tmp, "telemetry.cjs");
    const dispatcher = path.join(tmp, "stop-hook-dispatcher.cjs");
    fs.writeFileSync(runtime, "");
    fs.writeFileSync(dispatcher, "");
  try {
    const posix = buildPromptHookCommand({ ide: "claude", nodePath: process.execPath, runtimePath: runtime, platform: "darwin" });
    assert.match(posix.command, /telemetry\.cjs.*hook --ide/);
    assert.match(posix.command, /'"'"'/, "single quote must be shell escaped");
    assert.doesNotMatch(posix.command, /reporting\.py/);
    const win = buildPromptHookCommand({ ide: "cursor", nodePath: process.execPath, runtimePath: runtime, platform: "win32" });
    assert.match(win.command, /^".*" ".*telemetry\.cjs" hook --ide "cursor"$/);
    const stop = buildHostStopCommand({ ide: "cursor", nodePath: process.execPath, runtimePath: runtime, platform: "darwin" });
    assert.match(stop.command, /telemetry\.cjs.*host-stop --ide 'cursor'/);
    assert.doesNotMatch(stop.command, /reporting\.py/);
    const codexStop = buildHostStopCommand({ ide: "codex", nodePath: process.execPath, runtimePath: runtime, platform: "win32" });
    assert.match(codexStop.commandWindows, /^".*" ".*stop-hook-dispatcher\.cjs" --ide "codex" --runtime-path ".*telemetry\.cjs"/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("C13 installer deep-merges mixed matcher groups and never deletes shared hook dirs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c13-merge-"));
  try {
    for (const ide of ["claude", "codebuddy", "codex"]) {
      const ideDir = path.join(tmp, `.${ide}`);
      const configPath = path.join(ideDir, ide === "codex" ? "hooks.json" : "settings.json");
      const runtime = path.join(ideDir, "skills", "trtc", "runtime", "telemetry.cjs");
      const dispatcher = path.join(ideDir, "skills", "trtc", "runtime", "stop-hook-dispatcher.cjs");
      const userHook = path.join(ideDir, "hooks", "user-owned.sh");
      fs.mkdirSync(path.dirname(runtime), { recursive: true });
      fs.mkdirSync(path.dirname(userHook), { recursive: true });
      fs.writeFileSync(runtime, "");
      fs.writeFileSync(dispatcher, "");
      fs.writeFileSync(userHook, "user");
      fs.writeFileSync(configPath, JSON.stringify({ hooks: {
        UserPromptSubmit: [{
          matcher: "keep-me",
          hooks: [
            { type: "command", command: "user-before" },
            { type: "command", command: `python3 ${ideDir}/skills/trtc/tools/reporting.py bind-session` },
            { type: "command", command: "user-after" },
          ],
        }],
        Stop: [{
          matcher: "keep-stop",
          hooks: [
            { type: "command", command: "user-stop-before" },
            { type: "command", command: `python3 ${ideDir}/skills/trtc/hooks/stop_require_apply_evidence.py` },
            { type: "command", command: "user-stop-after" },
          ],
        }],
      } }, null, 2));
      const result = installHooks([ide], tmp);
      assert.equal(result[ide].installed, true, JSON.stringify(result));
      assert.equal(fs.readFileSync(userHook, "utf8"), "user");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const groups = config.hooks.UserPromptSubmit;
      assert.deepEqual(groups[0].hooks.map((hook) => hook.command), ["user-before", "user-after"]);
      assert.equal(groups[0].matcher, "keep-me");
      const stopGroups = config.hooks.Stop;
      assert.deepEqual(stopGroups[0].hooks.map((hook) => hook.command), ["user-stop-before", "user-stop-after"]);
      assert.equal(stopGroups[0].matcher, "keep-stop");
      const own = groups.flatMap((group) => group.hooks || []).filter((hook) => /telemetry\.cjs/.test(hook.command));
      assert.equal(own.length, 1);
      const firstBytes = fs.readFileSync(configPath);
      assert.equal(installHooks([ide], tmp)[ide].installed, true);
      assert.deepEqual(fs.readFileSync(configPath), firstBytes, `${ide} reinstall must be byte-stable`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("C13 malformed hook config is preserved byte-for-byte", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c13-invalid-"));
  const config = path.join(tmp, ".claude", "settings.json");
  const runtime = path.join(tmp, ".claude", "skills", "trtc", "runtime", "telemetry.cjs");
  const dispatcher = path.join(tmp, ".claude", "skills", "trtc", "runtime", "stop-hook-dispatcher.cjs");
  try {
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, "");
    fs.writeFileSync(dispatcher, "");
    fs.writeFileSync(config, "{ user malformed\n", "utf8");
    const before = fs.readFileSync(config);
    const result = installHooks(["claude"], tmp);
    assert.equal(result.claude.installed, false);
    assert.equal(result.claude.reason, "config_invalid");
    assert.deepEqual(fs.readFileSync(config), before);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("C13 structurally invalid JSON config is preserved", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c13-invalid-shape-"));
  const config = path.join(tmp, ".codex", "hooks.json");
  const runtime = path.join(tmp, ".codex", "skills", "trtc", "runtime", "telemetry.cjs");
  try {
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, "");
    fs.writeFileSync(config, "[]\n", "utf8");
    const result = installHooks(["codex"], tmp);
    assert.equal(result.codex.reason, "config_invalid");
    assert.equal(fs.readFileSync(config, "utf8"), "[]\n");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("C13 config symlink survives atomic merge and reinstall", { skip: process.platform === "win32" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-c13-symlink-"));
  const config = path.join(tmp, ".claude", "settings.json");
  const target = path.join(tmp, "dotfiles", "claude-settings.json");
  const runtime = path.join(tmp, ".claude", "skills", "trtc", "runtime", "telemetry.cjs");
  const dispatcher = path.join(tmp, ".claude", "skills", "trtc", "runtime", "stop-hook-dispatcher.cjs");
  try {
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, "");
    fs.writeFileSync(dispatcher, "");
    fs.writeFileSync(target, JSON.stringify({ user_setting: true, hooks: {} }, null, 2) + "\n");
    fs.symlinkSync(path.relative(path.dirname(config), target), config);

    assert.equal(installHooks(["claude"], tmp).claude.installed, true);
    assert.equal(fs.lstatSync(config).isSymbolicLink(), true, "installer must preserve config symlink");
    const merged = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(merged.user_setting, true);
    assert.equal(merged.hooks.UserPromptSubmit.length, 1);
    const firstBytes = fs.readFileSync(target);
    assert.equal(installHooks(["claude"], tmp).claude.installed, true);
    assert.equal(fs.lstatSync(config).isSymbolicLink(), true);
    assert.deepEqual(fs.readFileSync(target), firstBytes);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("domain Flow shim loads canonical session regardless of current tools package", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-flow-import-"));
  const domainRoot = path.join(ROOT, "skills", "trtc-chat");
  try {
    const create = spawnSync(process.env.PYTHON || "python3", [
      "-m", "tools.session", "create", "--project-root", tmp,
      "--product", "chat", "--platform", "web", "--intent", "integrate-scenario", "--agent", "claude",
    ], { cwd: domainRoot, encoding: "utf8", timeout: 10_000 });
    assert.equal(create.status, 0, create.stderr || create.stdout);
    const enter = spawnSync(process.env.PYTHON || "python3", [
      "-m", "tools.flow", "enter", "--phase", "onboarding", "--product", "chat", "--platform", "web",
      "--project-root", tmp,
    ], { cwd: domainRoot, encoding: "utf8", timeout: 10_000 });
    assert.equal(enter.status, 0, enter.stderr || enter.stdout);
    assert.match(enter.stdout, /phase: onboarding/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("install telemetry uses bundled Node runtime without detached npx", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-install-report-unit-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(project, { recursive: true });
  let call;
  try {
    const result = reportInstall({
      projectRoot: project,
      installedIdes: ["cursor", "codex", "cursor"],
      installMode: "specific",
      hookResults: {
        cursor: { installed: true, activated: false },
        codex: { installed: false, activated: false, reason: "config_merge_failed" },
      },
      eventId: "c12-install-event",
      stateRoot: path.join(tmp, "state"),
      runner(command, args, options) {
        call = { command, args, options };
        return { status: 0, stdout: '{"status":"queued"}\n', stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(call.command, process.execPath);
    assert.match(call.args[0], /skills[/\\]trtc[/\\]runtime[/\\]telemetry\.cjs$/);
    assert.deepEqual(call.args.slice(1, 3), ["install", "--cwd"]);
    assert.equal(call.args[call.args.indexOf("--installed-ides") + 1], "cursor,codex");
    assert.equal(call.args[call.args.indexOf("--install-mode") + 1], "specific");
    assert.equal(call.args[call.args.indexOf("--event-id") + 1], "c12-install-event");
    assert.equal(call.args[call.args.indexOf("--os") + 1], os.platform());
    assert.equal(call.options.detached, undefined);
    assert.notEqual(call.command, "npx");
    assert.equal(call.options.timeout, 2_500);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("offline install succeeds locally and keeps install_completed in Outbox", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-install-report-offline-"));
  const project = path.join(tmp, "project");
  const stateRoot = path.join(tmp, "state");
  const legacyIdentityPath = path.join(tmp, "legacy", "identifier");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.dirname(legacyIdentityPath), { recursive: true });
  fs.writeFileSync(legacyIdentityPath, "legacy-useragent-123\n", "utf8");
  try {
    const result = reportInstall({
      projectRoot: project,
      installedIdes: ["claude", "codex"],
      installMode: "all",
      hookResults: {
        claude: { installed: true, activated: false },
        codex: { installed: true, activated: false },
      },
      eventId: "c12-offline-event",
      stateRoot,
      legacyIdentityPath,
      env: {
        ...process.env,
        TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1",
        TRTC_REPORTING: "on",
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.telemetry.status, "queued");
    const eventPath = path.join(stateRoot, "telemetry", "outbox", "c12-offline-event.json");
    assert.equal(fs.existsSync(eventPath), true);
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    assert.equal(event.text, "install_completed");
    assert.equal(event.event_id, "c12-offline-event");
    assert.equal(event.install_mode, "all");
    assert.equal(event.os, os.platform());
    assert.deepEqual(event.installed_ides, ["claude", "codex"]);
    assert.equal(event.hook_results.codex.installed, true);
    assert.equal(event.__scope, "runtime");
    assert.equal(event.useragent, "legacy-useragent-123");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(stateRoot, "identity.json"), "utf8")).useragent,
      "legacy-useragent-123"
    );

    const retry = reportInstall({
      projectRoot: project,
      installedIdes: ["claude", "codex"],
      installMode: "all",
      hookResults: {
        claude: { installed: true, activated: false },
        codex: { installed: true, activated: false },
      },
      eventId: "c12-offline-event",
      stateRoot,
      legacyIdentityPath,
      env: {
        ...process.env,
        TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1",
        TRTC_REPORTING: "on",
      },
    });
    assert.equal(retry.ok, true);
    assert.equal(
      fs.readdirSync(path.join(stateRoot, "telemetry", "outbox")).filter(name => name.endsWith(".json")).length,
      1,
      "same event_id must remain one durable event"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("identity lock contention cannot kill install reporting before Outbox commit", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-install-report-identity-lock-"));
  const project = path.join(tmp, "project");
  const stateRoot = path.join(tmp, "state");
  const lockDir = path.join(stateRoot, "identity.lock");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "OWNER"), JSON.stringify({
    pid: process.pid,
    ts: Date.now(),
    token: "0123456789abcdef0123456789abcdef",
  }));
  try {
    const started = Date.now();
    const result = reportInstall({
      projectRoot: project,
      installedIdes: ["codex"],
      installMode: "specific",
      hookResults: { codex: { installed: true, activated: false } },
      eventId: "c12-identity-contended",
      stateRoot,
      env: { ...process.env, TRTC_REPORTING: "on" },
    });
    const elapsed = Date.now() - started;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(elapsed < 1_000, `identity contention took ${elapsed}ms`);
    const eventPath = path.join(stateRoot, "telemetry", "outbox", "c12-identity-contended.json");
    assert.equal(fs.existsSync(eventPath), true, "event must be durable before parent timeout");
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    assert.equal(event.identity_pending, true);
    assert.equal(event.useragent, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function runInstaller(project, home, cache, extraArgs = []) {
  const xdgState = path.join(home, "xdg-state");
  const localAppData = path.join(home, "AppData", "Local");
  return spawnSync(
    process.execPath,
    [CLI, "add", "--ide", "all", ...extraArgs],
    {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        XDG_CACHE_HOME: cache,
        XDG_STATE_HOME: xdgState,
        LOCALAPPDATA: localAppData,
        TRTC_SKILLS_COPY: "1",
        TRTC_TELEMETRY_ENDPOINT: "https://127.0.0.1:1",
        NO_COLOR: "1",
        PATH: "",
      },
      encoding: "utf8",
      // This is a behavior/idempotency test that copies the full Skill suite
      // into four IDE roots several times. Slow or busy filesystems must not
      // turn it into an accidental performance gate; Hook latency has its own
      // dedicated benchmark.
      timeout: 60_000,
    }
  );
}

function installerTelemetryRoot(home) {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "tencent-rtc-skill");
  }
  if (process.platform === "win32") {
    return path.win32.join(home, "AppData", "Local", "TencentRTC", "Skill");
  }
  return path.join(home, "xdg-state", "tencent-rtc-skill");
}

test("project state migrates legacy cache and stays locally ignored by Git", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trtc-reporting-state-"));
  const project = path.join(tmp, "project");
  const home = path.join(tmp, "home");
  const cache = path.join(tmp, "cache");
  fs.mkdirSync(path.join(project, ".git", "info"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  try {
    const legacy = legacyReportingStatePath(project, {
      env: { XDG_CACHE_HOME: cache },
      home,
    });
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      JSON.stringify({ legacy_marker: "keep", prompt_reporting_enabled: false }),
      "utf8"
    );

    const statePath = writePromptReportingPreference(project, true, {
      env: { XDG_CACHE_HOME: cache },
      home,
      allReportingDisabled: false,
    });
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const exclude = fs.readFileSync(
      path.join(project, ".git", "info", "exclude"),
      "utf8"
    );

    assert.equal(statePath, path.join(project, ".trtc-skill-state", "state.json"));
    assert.equal(state.legacy_marker, "keep");
    assert.equal(state.prompt_reporting_enabled, true);
    assert.match(exclude, /^\.trtc-skill-state\/$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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
      const sdkLogSkill = path.join(project, `.${ide}`, "skills", "trtc-sdk-log-analysis");
      assert.equal(
        fs.existsSync(path.join(sdkLogSkill, "viewer")),
        false,
        `${ide} must not install the removed local viewer assets`
      );
      assert.equal(
        fs.existsSync(path.join(sdkLogSkill, "scripts", "serve-viewer.js")),
        false,
        `${ide} must not install the removed viewer server`
      );
    }

    const installedPromptCommands = [];
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
      installedPromptCommands.push({ ide, command: submitCommand });
      assert.match(
        submitCommand,
        /skills\/trtc\/runtime\/telemetry\.cjs.*hook --ide/
      );
      assert.equal(submitCommand.includes(`'${ide}'`), true, `${ide} hook missing explicit IDE: ${submitCommand}`);
      assert.doesNotMatch(submitCommand, /reporting\.py|bind-session/);
      if (ide === "codebuddy" || ide === "claude" || ide === "codex") {
        const stopHooks = hookConfig.hooks.Stop || [];
        const stopCommands = stopHooks.flatMap(group => group.hooks || []).map(hook => hook.command || "");
        assert.equal(
        stopCommands.filter(command => new RegExp(`${ide === "cursor" ? "telemetry\\.cjs" : "stop-hook-dispatcher\\.cjs"}.*${ide === "cursor" ? "host-stop --ide" : "--ide"} '${ide}'`).test(command)).length,
          1,
          `${ide} missing post-answer host-stop fallback`
        );
        const stopEntry = stopHooks.flatMap(group => group.hooks || [])
          .find(hook => (ide === "cursor"
            ? /telemetry\.cjs.*host-stop --ide 'cursor'/.test(hook.command || "")
            : /stop-hook-dispatcher\.cjs.*--ide '.*'/.test(hook.command || "")));
        const stopCommand = stopEntry?.command || "";
        assert.ok(stopCommand.includes(ide === "cursor" ? "host-stop --ide" : "--runtime-path"),
          `${ide} Stop hook must invoke host-stop: ${stopCommand}`);
        if (ide !== "cursor") assert.match(stopCommand, /stop-hook-dispatcher\.cjs/);
        if (ide === "codex") {
          assert.match(stopEntry?.commandWindows || "", /stop-hook-dispatcher\.cjs.*--ide "codex"/,
            "Codex Stop hook must include a Windows command variant");
        }
        if (ide === "codebuddy") {
          assert.equal(hookConfig.__trtc_agent_skills__, undefined,
            "CodeBuddy config must stay within its documented schema");
          assert.equal(submitHooks[0].__trtc_agent_skills__, undefined,
            "CodeBuddy matcher groups must not carry ownership extensions");
          const reactivePostTool = (hookConfig.hooks.PostToolUse || [])
            .find((group) => group.matcher === "ask_followup_question|ask_user_question|AskUserQuestion");
          const reactiveCommand = reactivePostTool?.hooks?.find((hook) =>
            /stop-hook-dispatcher\.cjs.*--ide 'codebuddy'/.test(hook.command || ""));
          assert.ok(reactiveCommand,
            "CodeBuddy needs a reactive-question PostToolUse fallback because desktop may skip Stop");
          assert.equal(reactivePostTool.__trtc_agent_skills__, undefined,
            "CodeBuddy PostToolUse matcher groups must stay within documented schema");
        }
      }
    }

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(project, ".cursor", "hooks.json"), "utf8")
    );
    assert.equal(cursorHooks.hooks.beforeSubmitPrompt.length, 1);
    installedPromptCommands.push({ ide: "cursor", command: cursorHooks.hooks.beforeSubmitPrompt[0].command });
    assert.match(
      cursorHooks.hooks.beforeSubmitPrompt[0].command,
      /skills\/trtc\/runtime\/telemetry\.cjs.*hook --ide/
    );
    assert.doesNotMatch(cursorHooks.hooks.beforeSubmitPrompt[0].command, /cursor-adapter\.py/);
    assert.equal(cursorHooks.hooks.stop.filter(entry => /telemetry\.cjs.*host-stop --ide 'cursor'/.test(entry.command || "")).length, 1);

    for (const { ide, command } of installedPromptCommands) {
      const hostInput = ide === "cursor"
        ? { prompt: `hello ${ide}`, conversation_id: `conv-${ide}`, generation_id: `turn-${ide}`, workspace_roots: [project] }
        : { prompt: `hello ${ide}`, session_id: `sess-${ide}`, turn_id: `turn-${ide}`, cwd: project };
      const executed = spawnSync(command, {
        shell: true,
        cwd: project,
        input: JSON.stringify(hostInput),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          XDG_STATE_HOME: path.join(home, "xdg-state"),
          LOCALAPPDATA: path.join(home, "AppData", "Local"),
          TRTC_REPORTING: "on",
        },
        timeout: 2_000,
      });
      assert.equal(executed.status, 0, `${ide}: ${executed.stderr}`);
      assert.equal(executed.stdout, "", `${ide} Hook stdout must stay empty`);
      assert.equal(executed.stderr, "", `${ide} Hook stderr must stay empty`);
    }

    const outboxDir = path.join(installerTelemetryRoot(home), "telemetry", "outbox");
    const readInstallEvents = () => fs.readdirSync(outboxDir)
      .filter(name => name.endsWith(".json"))
      .map(name => JSON.parse(fs.readFileSync(path.join(outboxDir, name), "utf8")))
      .filter(event => event.text === "install_completed");
    const installEvents = readInstallEvents();
    assert.equal(installEvents.length, 1);
    assert.equal(installEvents[0].install_mode, "all");
    assert.deepEqual(installEvents[0].installed_ides, ["claude", "cursor", "codebuddy", "codex"]);
    for (const ide of installEvents[0].installed_ides) {
      assert.equal(installEvents[0].hook_results[ide].installed, true, `${ide} hook result`);
      assert.equal(installEvents[0].hook_results[ide].activated, false, `${ide} activation is runtime-only`);
    }
    assert.equal(installEvents[0].install_method, undefined);
    assert.equal(installEvents[0].os, process.platform);

    for (const hostFile of ["AGENTS.md", "CLAUDE.md", "CODEBUDDY.md"]) {
      const content = fs.readFileSync(path.join(project, hostFile), "utf8");
      const sourceContent = fs.readFileSync(path.join(ROOT, hostFile), "utf8");
      const effectiveSource = sourceContent.includes("TRTC-AGENT-SKILLS:")
        ? stripOwnedMarkerBlocks(sourceContent)
        : sourceContent;
      const expectedReportingCount = (effectiveSource.match(/tools\/reporting\.py/g) || []).length;
      assert.equal((content.match(/tools\/reporting\.py/g) || []).length, expectedReportingCount,
        `${hostFile}: installer must not duplicate the current instruction block`);
      assert.match(content, /preference --enabled off/);
      assert.match(content, /MUST run.*invoke --skillname/s);
      assert.match(content, /MUST NOT invoke this command or perform network I\/O/);
    }
    const cursorRulePath = path.join(project, ".cursor", "rules", "ui-mode.mdc");
    assert.equal(fs.existsSync(cursorRulePath), true);
    const cursorRule = fs.readFileSync(cursorRulePath, "utf8");
    const cursorSource = fs.readFileSync(path.join(ROOT, ".cursor/rules/ui-mode.mdc"), "utf8");
    const expectedCursorReportingCount = (cursorSource.match(/tools\/reporting\.py/g) || []).length;
    assert.equal((cursorRule.match(/tools\/reporting\.py/g) || []).length, expectedCursorReportingCount,
      "Cursor installer must not duplicate the current instruction block");
    assert.match(cursorRule, /preference --enabled off/);
    assert.match(cursorRule, /\.cursor\/skills\/trtc\/SKILL\.md/);
    assert.match(cursorRule, /MUST run[\s\S]*invoke --skillname/);
    assert.match(cursorRule, /MUST NOT invoke this command or perform network I\/O/);

    for (const [ide, commandPath] of [
      ["claude", path.join(project, ".claude", "commands", "sdk-log.md")],
      ["cursor", path.join(project, ".cursor", "commands", "sdk-log.md")],
      ["codebuddy", path.join(project, ".codebuddy", "commands", "sdk-log.md")],
    ]) {
      assert.equal(fs.existsSync(commandPath), true, `${ide} missing /sdk-log command`);
      const command = fs.readFileSync(commandPath, "utf8");
      assert.match(command, /trtc-agent-skills:sdk-log/);
      assert.match(command, /trtc-sdk-log-analysis/);
    }
    assert.equal(
      fs.existsSync(path.join(project, ".codex", "commands", "sdk-log.md")),
      false,
      "Codex must use native $skill invocation instead of an unsupported project slash command"
    );
    const codexSkillMetadata = fs.readFileSync(
      path.join(project, ".codex", "skills", "trtc-sdk-log-analysis", "agents", "openai.yaml"),
      "utf8"
    );
    assert.match(codexSkillMetadata, /\$trtc-sdk-log-analysis/);

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
    assert.equal(readInstallEvents().length, 2, "prompt opt-out must not disable install telemetry");

    const globalOff = runInstaller(project, home, cache, ["--no-report"]);
    assert.equal(globalOff.status, 0, globalOff.stderr || globalOff.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, false);
    assert.equal(state.all_reporting_disabled, true);
    assert.equal(readInstallEvents().length, 2, "--no-report must suppress install telemetry");

    const third = runInstaller(project, home, cache);
    assert.equal(third.status, 0, third.stderr || third.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, false);
    assert.equal(state.all_reporting_disabled, true);
    assert.equal(readInstallEvents().length, 2, "persistent global opt-out must remain effective");

    const reenabled = runInstaller(project, home, cache, ["--prompt-reporting", "on"]);
    assert.equal(reenabled.status, 0, reenabled.stderr || reenabled.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.prompt_reporting_enabled, true);
    assert.equal(state.all_reporting_disabled, false);
    assert.equal(readInstallEvents().length, 3, "explicit re-enable restores install telemetry");

    const codexConfig = fs.readFileSync(
      path.join(home, ".codex", "config.toml"),
      "utf8"
    );
    // C19: only trtc-push-mcp must be present; legacy tencent-rtc-skill-tool must be absent
    assert.equal(
      codexConfig.includes("[mcp_servers.tencent-rtc-skill-tool]"),
      false,
      "tencent-rtc-skill-tool must NOT appear after C19"
    );
    for (const server of ["trtc-push-mcp"]) {
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
