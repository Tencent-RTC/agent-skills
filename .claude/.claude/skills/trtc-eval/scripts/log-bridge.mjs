#!/usr/bin/env node
// scripts/log-bridge.mjs
//
// Web eval log stream — single entry point that:
//   1. Rewrites <workspace>/.env.local with the eval nonce
//   2. Spawns `npm run dev` inside the demo workspace
//   3. Waits for the Vite dev server port to accept TCP
//   4. Launches a headless Chromium via Puppeteer, navigates to the dev URL
//   5. Prints `TRTC_EVAL_NONCE=<nonce>` so runtime_monitor can verify provenance
//   6. Forwards every page console event as a JSON line to stdout (parsed by
//      scripts/lib/log_parsers/puppeteer_parser.py). The event schema carries
//      both the raw text and a best-effort `event` field (first /on[A-Z]\w+/
//      match) so Mode-A (JSON with event) and Mode-B (plain text with on* +
//      trtc keyword) parsers both succeed.
//   7. On SIGTERM: closes the browser, SIGTERMs the vite child (SIGKILL
//      fallback after 200ms), then exits 0.
//
// stdout is piped directly to cases/<id>/runtime.log by log_streamer.py —
// every line here lands in the runtime log untouched.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// Argv parsing — `--url <u> --nonce <hex> --workspace <path>`, all required.
// ---------------------------------------------------------------------------
function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i];
    else if (a === "--nonce") out.nonce = argv[++i];
    else if (a === "--workspace") out.workspace = argv[++i];
  }
  const missing = ["url", "nonce", "workspace"].filter((k) => !out[k]);
  if (missing.length) {
    process.stderr.write(
      `log-bridge: missing required args: ${missing.join(", ")}\n` +
        `usage: node scripts/log-bridge.mjs --url <u> --nonce <hex> --workspace <path>\n`,
    );
    process.exit(2);
  }
  return out;
}

// ---------------------------------------------------------------------------
// .env.local rewrite — mirrors scripts/lib/platforms/web.py::_inject_web_nonce.
// Strip any existing VITE_EVAL_RUN_NONCE=* line, append the fresh one.
// ---------------------------------------------------------------------------
function injectNonceEnv(workspace, nonce) {
  const envPath = join(workspace, ".env.local");
  let lines = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, "utf8")
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("VITE_EVAL_RUN_NONCE=") &&
          !line.startsWith("VITE_EVAL_AUTO_RUN_FLOW="),
      );
  }
  lines.push(`VITE_EVAL_RUN_NONCE=${nonce}`);
  // Propagate EVAL_AUTO_RUN_FLOW (set by the orchestrator from cases.json's
  // auto_run_flow[0]) into Vite's VITE_-prefixed namespace so env.ts's
  // loadEnv() can read it via import.meta.env. Without this hop, the
  // browser sees autoRunFlow=null and the AI's UI mounts instead of the
  // deterministic SDK exercise — which leaves expected_events at 0/N.
  const autoFlow = process.env.EVAL_AUTO_RUN_FLOW;
  if (autoFlow && autoFlow.trim() !== "") {
    lines.push(`VITE_EVAL_AUTO_RUN_FLOW=${autoFlow}`);
  }
  writeFileSync(envPath, lines.join("\n") + "\n", "utf8");
}


// ---------------------------------------------------------------------------
// TRTC test credential propagation — reads <case_dir>/.eval-meta/launch.env
// (written by the orchestrator from the skill's config.json / shell env) and
// translates the TRTC_TEST_* keys into the VITE_TRTC_TEST_* keys the frontend
// loadEnv() expects. Without this, Vite's requireEnv() throws and the demo
// crashes before any SDK init can run, which shows up as "JSHandle@error" in
// runtime.log.
//
// launch.env lives at <workspace>/../.eval-meta/launch.env. We resolve it from
// workspace (case_dir = parent of workspace) so log-bridge doesn't need an
// extra CLI flag.
// ---------------------------------------------------------------------------

/**
 * Parse <case_dir>/.eval-meta/launch.env and return a Map of KEY=value pairs.
 * This is the SINGLE SOURCE OF TRUTH for TRTC test credentials at runtime —
 * process.env may contain stale values from previous sessions.
 */
function readLaunchEnv(workspace) {
  const caseDir = dirname(workspace);
  const launchEnvPath = join(caseDir, ".eval-meta", "launch.env");
  const source = new Map();
  if (!existsSync(launchEnvPath)) return source;

  const raw = readFileSync(launchEnvPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) source.set(m[1], m[2]);
  }
  return source;
}

function injectTrtcCredsEnv(workspace) {
  const source = readLaunchEnv(workspace);
  if (source.size === 0) return;

  // Keys the browser bundle needs; Vite only exposes VITE_*-prefixed ones.
  const toVite = {
    TRTC_TEST_SDKAPPID: "VITE_TRTC_TEST_SDKAPPID",
    TRTC_TEST_USERID: "VITE_TRTC_TEST_USERID",
    TRTC_TEST_USERSIG: "VITE_TRTC_TEST_USERSIG",
  };

  const envPath = join(workspace, ".env.local");
  let existing = [];
  if (existsSync(envPath)) {
    existing = readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => !/^VITE_TRTC_TEST_/.test(l));
  }
  for (const [src, viteKey] of Object.entries(toVite)) {
    const v = source.get(src);
    if (v !== undefined && v !== "") existing.push(`${viteKey}=${v}`);
  }
  // Remove trailing empty strings before rejoining to avoid double blank lines
  while (existing.length && existing[existing.length - 1] === "") existing.pop();
  writeFileSync(envPath, existing.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// TCP port probe — poll 127.0.0.1:<port> until it accepts a connection.
// ---------------------------------------------------------------------------
function parsePort(url) {
  const m = url.match(/:(\d+)(?:\/|$)/);
  return m ? Number.parseInt(m[1], 10) : 80;
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

// Find the first port in [start, start+span) that no one is listening on.
// Returns the chosen port or null if every port in the range is occupied.
//
// Why this exists: every eval run hardcodes 5173 in the case orchestrator,
// but a developer's own dev server (or the previous run's leftover vite)
// frequently squats on it. Without preflight, vite would spawn, fail with
// "Port 5173 is already in use", exit code=1, and dynamic eval would silently
// score 0.4 (compile_bonus only) without ever loading the page.
async function findFreePort(host, start, span) {
  for (let p = start; p < start + span; p++) {
    const occupied = await probeTcp(host, p, 200);
    if (!occupied) return p;
  }
  return null;
}

async function waitForPort(host, port, attempts, intervalMs) {
  for (let i = 0; i < attempts; i++) {
    if (await probeTcp(host, port, intervalMs)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// JSON log emitter — one line per event, parseable by puppeteer_parser.py.
// ---------------------------------------------------------------------------
function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function extractEvent(text) {
  const m = text && text.match(/\bon[A-Z]\w+\b/);
  return m ? m[0] : undefined;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { url, nonce, workspace } = parseArgv(process.argv.slice(2));

  // Step 1: write .env.local so Vite picks up VITE_EVAL_RUN_NONCE on dev start
  try {
    injectNonceEnv(workspace, nonce);
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "error",
      text: `log-bridge: failed to write .env.local: ${e.message}`,
      ok: false,
    });
    process.exit(1);
  }

  // Step 1b: propagate TRTC test creds from <case_dir>/.eval-meta/launch.env
  // into .env.local so the frontend's loadEnv() finds VITE_TRTC_TEST_*. Missing
  // launch.env is intentionally non-fatal — a case without creds will fail with
  // a much clearer "Missing required env" from the frontend than from log-bridge.
  try {
    injectTrtcCredsEnv(workspace);
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "warn",
      text: `log-bridge: failed to inject TRTC creds: ${e.message}`,
      ok: false,
    });
  }

  // Step 2: pick a free port (caller's --url is a hint; we may shift it).
  // Vite's default 5173 is frequently squatted on by a developer's own dev
  // server; without preflight, we'd silently inherit a 404 from whatever else
  // is bound, or watch vite exit code=1 with no useful signal.
  const host = "127.0.0.1";
  const requestedPort = parsePort(url);
  const chosenPort = await findFreePort(host, requestedPort, 20);
  if (chosenPort === null) {
    emit({
      ts: nowIso(),
      level: "error",
      text: `log-bridge: no free port in [${requestedPort}, ${requestedPort + 20})`,
      ok: false,
    });
    process.exit(1);
  }
  if (chosenPort !== requestedPort) {
    emit({
      ts: nowIso(),
      level: "info",
      text: `log-bridge: requested port ${requestedPort} occupied; using ${chosenPort}`,
      ok: true,
    });
  }
  const targetUrl = url.replace(`:${requestedPort}`, `:${chosenPort}`);

  // Step 3: spawn `npm run dev`. We pass --port + --strictPort so vite either
  // claims our chosen port or exits immediately — never silently shifts to a
  // different port that puppeteer wouldn't be able to find.
  const viteEnv = { ...process.env, EVAL_RUN_NONCE: nonce };
  const vite = spawn(
    "npm",
    ["run", "dev", "--", "--port", String(chosenPort), "--strictPort"],
    {
      cwd: workspace,
      env: viteEnv,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let viteExited = false;
  vite.on("exit", (code, signal) => {
    viteExited = true;
    emit({
      ts: nowIso(),
      level: code === 0 ? "info" : "warn",
      text: `log-bridge: vite child exited code=${code} signal=${signal || ""}`,
      ok: code === 0,
    });
  });
  // Surface vite stderr into runtime.log so build failures are visible
  vite.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trimEnd();
    if (text) {
      emit({ ts: nowIso(), level: "warn", text: `[vite] ${text}`, ok: true });
    }
  });

  // Step 4: wait for the dev server to listen
  const ready = await waitForPort(host, chosenPort, 30, 500);
  if (!ready || viteExited) {
    emit({
      ts: nowIso(),
      level: "error",
      text: `log-bridge: vite-not-ready host=${host} port=${chosenPort}`,
      ok: false,
    });
    try {
      vite.kill("SIGTERM");
    } catch {}
    process.exit(1);
  }

  // Step 5: launch Puppeteer and attach console listeners
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "error",
      text: `log-bridge: puppeteer import failed: ${e.message}. Run \`cd scripts && npm install\`.`,
      ok: false,
    });
    try {
      vite.kill("SIGTERM");
    } catch {}
    process.exit(1);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--use-gl=swiftshader",
        "--enable-webgl",
      ],
    });
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "error",
      text: `log-bridge: chromium launch failed: ${e.message}`,
      ok: false,
    });
    try {
      vite.kill("SIGTERM");
    } catch {}
    process.exit(1);
  }

  const page = await browser.newPage();

  // Step 5a: install browser-side probes BEFORE the page loads. These run in
  // the page context and emit JSON-tagged console.log lines that the host
  // captures via `page.on('console', ...)` below. Tagging with `__probe`
  // keeps the existing event extractor (`\bon\w+\b`) untouched while giving
  // runtime_monitor a separate channel for runtime-health signals.
  //
  // Why each probe:
  //  - window.error          → captures uncaught synchronous exceptions
  //                            (e.g. "X is not a constructor", TypeError)
  //  - unhandledrejection    → captures Promise rejections that nobody awaited
  //                            (login failures, fetch crashes)
  //  - console.warn override → captures Vue's "[Vue warn]" lifecycle warnings
  //                            (e.g. "onUnmounted called when no instance")
  //                            without polluting other warn output
  await page.evaluateOnNewDocument(() => {
    const tag = (probe, payload) =>
      console.log(JSON.stringify({ __probe: probe, ...payload }));

    window.addEventListener("error", (e) => {
      tag("window_error", {
        message: (e && e.message) || String(e),
        stack: e && e.error && e.error.stack,
        filename: e && e.filename,
        lineno: e && e.lineno,
      });
    });

    window.addEventListener("unhandledrejection", (e) => {
      const reason = e && e.reason;
      tag("unhandled_rejection", {
        message: reason && reason.message ? reason.message : String(reason),
        stack: reason && reason.stack,
      });
    });

    const origWarn = console.warn.bind(console);
    console.warn = function (...args) {
      try {
        const text = args
          .map((a) => (typeof a === "string" ? a : (a && a.toString && a.toString()) || String(a)))
          .join(" ");
        if (text.startsWith("[Vue warn]")) {
          tag("vue_warn", { text });
        }
      } catch {
        /* swallow probe errors — never break the host page */
      }
      origWarn.apply(console, args);
    };
  });

  // Step 5b: print the nonce marker BEFORE any console events so runtime_monitor
  // always finds it even if the page hangs. Must be the exact literal string
  // `TRTC_EVAL_NONCE=<nonce>` (see scripts/runtime_monitor.py:88-89).
  process.stdout.write(`TRTC_EVAL_NONCE=${nonce}\n`);

  page.on("console", (msg) => {
    let text;
    try {
      text = msg.text();
    } catch {
      text = String(msg);
    }
    const payload = {
      ts: nowIso(),
      level: msg.type(),
      text,
      ok: msg.type() !== "error",
    };
    // If this console line is a probe payload (JSON with __probe), surface
    // the probe key at the top level so runtime_monitor can group by probe
    // type without re-parsing the embedded JSON.
    const trimmed = text && text.trim();
    if (trimmed && trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj.__probe === "string") {
          payload.__probe = obj.__probe;
        }
      } catch {
        /* not JSON, fall through */
      }
    }
    const ev = extractEvent(text);
    if (ev) payload.event = ev;
    emit(payload);
  });
  page.on("pageerror", (err) => {
    emit({
      ts: nowIso(),
      level: "error",
      __probe: "page_error",
      text: `[pageerror] ${err && err.message ? err.message : String(err)}`,
      stack: err && err.stack,
      ok: false,
    });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    emit({
      ts: nowIso(),
      level: "warn",
      __probe: "request_failed",
      text: `[requestfailed] ${req.url()} :: ${failure ? failure.errorText : "unknown"}`,
      url: req.url(),
      reason: failure ? failure.errorText : "unknown",
      ok: false,
    });
  });
  // 4xx/5xx responses count as request failures too (puppeteer fires
  // requestfailed only on transport errors, not HTTP error status codes).
  page.on("response", (resp) => {
    const status = resp.status();
    if (status >= 400) {
      emit({
        ts: nowIso(),
        level: "warn",
        __probe: "request_failed",
        text: `[response ${status}] ${resp.url()}`,
        url: resp.url(),
        reason: `HTTP ${status}`,
        ok: false,
      });
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "error",
      text: `log-bridge: page.goto failed url=${targetUrl} err=${e.message}`,
      ok: false,
    });
    // Do not exit — runtime.log already has the nonce marker and the error.
    // Let orchestrator's 60s timer run its course, SIGTERM will clean up.
  }

  // Step 5d: AI self-driven mode — detect window.__evalAutoRun
  //
  // If the AI generated an eval-autorun.ts that registers itself on
  // window.__evalAutoRun, invoke it with TRTC test credentials. This is
  // the "optimizer v2" path that replaces the DSL-based autoRunCoordinator
  // for cases that omit auto_run_flow.
  //
  // Detection waits up to 5 seconds for the function to appear (the page
  // may still be mounting Vue/React components). If it never appears,
  // the existing autoRunCoordinator path (triggered by EVAL_AUTO_RUN_FLOW
  // env var) handles execution.
  try {
    // Wait briefly for the app to mount and register __evalAutoRun
    const hasAutoRun = await page.evaluate(() => {
      return new Promise((resolve) => {
        // Check immediately
        if (typeof window.__evalAutoRun === "function") {
          resolve(true);
          return;
        }
        // Poll for up to 5 seconds (app may still be mounting)
        let attempts = 0;
        const timer = setInterval(() => {
          attempts++;
          if (typeof window.__evalAutoRun === "function") {
            clearInterval(timer);
            resolve(true);
          } else if (attempts >= 25) {
            clearInterval(timer);
            resolve(false);
          }
        }, 200);
      });
    });

    if (hasAutoRun) {
      emit({
        ts: nowIso(),
        level: "info",
        text: "[log-bridge] AI-generated evalAutoRun detected, invoking self-driven mode",
        ok: true,
      });

      // Build env payload from launch.env (single source of truth for creds).
      // NEVER read process.env.TRTC_TEST_* here — it may contain stale values
      // from a previous session that shadow the correct config.json credentials.
      const creds = readLaunchEnv(workspace);
      const sdkAppId = creds.get("TRTC_TEST_SDKAPPID") || "";
      const userId = creds.get("TRTC_TEST_USERID") || "";
      const userSig = creds.get("TRTC_TEST_USERSIG") || "";
      const roomId = `eval_${nonce.slice(0, 8)}`;

      await page.evaluate(
        async (env) => {
          try {
            await window.__evalAutoRun(env);
          } catch (err) {
            console.error("[eval] fatal:", err && err.message ? err.message : String(err));
          }
        },
        {
          sdkAppId: sdkAppId ? Number(sdkAppId) : 0,
          userId,
          userSig,
          roomId,
        },
      );
    } else {
      emit({
        ts: nowIso(),
        level: "info",
        text: "[log-bridge] No evalAutoRun found, using existing autoRunCoordinator flow",
        ok: true,
      });
    }
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "warn",
      text: `[log-bridge] evalAutoRun detection/invocation error: ${e.message}`,
      ok: false,
    });
    // Non-fatal — the autoRunCoordinator path or SIGTERM timeout will handle it
  }

  // Step 5e: DOM assertion probes — after eval-autorun has had time to execute
  // and Vue components have mounted, snapshot the DOM to check if the AI's UI
  // was actually rendered. This probe feeds runtime_monitor's dom_has_content
  // signal, which gates the 0/0 = full-score loophole.
  try {
    // Wait for Vue components to mount + eval-autorun to complete
    await new Promise((r) => setTimeout(r, 3000));
    const domProbe = await page.evaluate(() => {
      const app = document.getElementById("app");
      if (!app) return { hasContent: false, childCount: 0, hasSkeleton: false, textLength: 0, interactiveElements: 0 };
      const textLength = app.innerText.trim().length;
      const interactiveElements = app.querySelectorAll(
        "button, input, select, textarea, [role='button'], a[href]"
      ).length;
      return {
        hasContent: textLength >= 50,
        childCount: app.children.length,
        hasSkeleton: app.querySelector(".eval-skeleton") !== null,
        textLength,
        interactiveElements,
      };
    });
    emit({
      ts: nowIso(),
      level: "info",
      __probe: "dom_snapshot",
      text: `[dom] content=${domProbe.hasContent} children=${domProbe.childCount} skeleton=${domProbe.hasSkeleton} textLen=${domProbe.textLength} interactive=${domProbe.interactiveElements}`,
      ok: domProbe.hasContent,
      hasContent: domProbe.hasContent,
      childCount: domProbe.childCount,
      hasSkeleton: domProbe.hasSkeleton,
      textLength: domProbe.textLength,
      interactiveElements: domProbe.interactiveElements,
    });
  } catch (e) {
    emit({
      ts: nowIso(),
      level: "warn",
      text: `[log-bridge] DOM probe error: ${e.message}`,
      ok: false,
    });
  }

  // Step 6: SIGTERM cascade — close browser, then kill vite (SIGKILL fallback
  // after 200ms), then exit 0. log_streamer.py sends SIGTERM via PID file.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await browser.close();
    } catch {}
    try {
      vite.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        if (!viteExited) vite.kill("SIGKILL");
      } catch {}
      process.exit(0);
    }, 200).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Keep the event loop alive; shutdown is driven by SIGTERM from log_streamer.
  // Puppeteer's internal handles normally suffice, but add a no-op interval as
  // a safety net against premature exit on pages that idle quickly.
  setInterval(() => {}, 60_000).unref();
}

main().catch((e) => {
  emit({
    ts: nowIso(),
    level: "error",
    text: `log-bridge: fatal ${e && e.stack ? e.stack : e}`,
    ok: false,
  });
  process.exit(1);
});
