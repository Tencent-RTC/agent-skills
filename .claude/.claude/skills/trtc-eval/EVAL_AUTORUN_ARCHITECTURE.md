# TRTC Eval System: Autorun & Demo Scaffold Architecture

## Overview

The TRTC eval system has two complementary modes for driving SDK API tests:

1. **DSL-Based Autorun (Default)** — Cases define a declarative flow in `cases.json::auto_run_flow` that gets compiled to TypeScript at build time
2. **Self-Driven Autorun (Optimizer v2)** — AI generates an `eval-autorun.ts` that registers itself on `window.__evalAutoRun` and manages execution

---

## 1. Directory Structure

### Key Paths

```
/Users/yuxiwei/Desktop/trtc-ai-integration/.claude/skills/trtc-eval/
├── templates/
│   ├── web-demo/                          # Web demo template (Vue/React/Vanilla)
│   │   ├── INJECTION.json                 # Injection point definitions
│   │   ├── src/
│   │   │   ├── main.ts                    # Bootstrap (loads env, runs autoflow)
│   │   │   ├── env.ts                     # Environment variable loader + TrtcTestEnv
│   │   │   ├── generated/                 # AI-injected code destination
│   │   │   │   └── anchorView.ts          # Placeholder for AI code
│   │   │   └── autorun/                   # Autorun flows (template + generated)
│   │   │       ├── _runtime.ts            # Shared runtime helpers (getEnv, withTimeout)
│   │   │       └── _builtin/              # Hand-written builtin flows
│   │   │           ├── login.ts           # Idempotent login + event subscription
│   │   │           └── anchorStartThenEnd.ts  # Live anchor flow driver
│   │   ├── profiles/                      # Framework-specific overrides
│   │   │   ├── vanilla/
│   │   │   ├── vue2/
│   │   │   ├── vue3/
│   │   │   └── react/
│   │
│   ├── ios-demo/                          # iOS template (Swift)
│   └── android-demo/                      # Android template (Kotlin)
│
├── scripts/
│   ├── demo_runner.py                     # Main orchestrator (build + run phases)
│   ├── log-bridge.mjs                     # Browser launcher + log forwarder
│   ├── runtime_monitor.py                 # Log parser + event matcher
│   │
│   └── lib/
│       ├── flow_codegen.py                # DSL → TypeScript compiler
│       ├── code_injector.py               # AI code → workspace injection + entry bridge
│       ├── template_fetcher.py            # Template copy + framework profile apply
│       ├── builder.py                     # Vite/build system orchestration
│       ├── launcher.py                    # Headless Chrome + device launch
│       ├── creds_normalizer.py            # Placeholder → real credential rewrite
│       └── platforms/                     # Platform-specific adapters
│           ├── web.py
│           ├── ios.py
│           └── android.py
│
└── tests/
    └── benchmark/
        └── cases.json                     # 1300+ test cases with DSL flows
```

---

## 2. How Autorun Is Currently Driven (DSL-Based Path)

### 2.1 Cases.json Structure

```json
{
  "test_id": "TC-CONF-WEB-001",
  "platform": "web",
  "auto_run_flow": {
    "depends_on": ["login"],
    "imports": {
      "room": "tuikit-atomicx-vue3/room"
    },
    "hooks": {
      "roomApi": { "from": "room", "call": "useRoomState" }
    },
    "vars": {
      "roomId": { "expr": "`eval_${env.userId}_${Date.now()}`" }
    },
    "steps": [
      {
        "call": "roomApi.createRoom",
        "args": [{ "roomId": "{{roomId}}" }],
        "on_error": "abort"
      },
      {
        "sleep": 2000
      },
      {
        "log": "room created, userId={{userId}}"
      }
    ],
    "defaults": {
      "timeout_ms": 10000,
      "on_error": "continue"
    }
  }
}
```

**Key Notes:**
- `auto_run_flow` can be:
  - `null` / empty → self-driven mode (AI generates eval-autorun.ts)
  - `list[str]` → legacy, directly import builtin .ts files (e.g., `["login"]`)
  - `AutoRunFlow` object → DSL compiled to TS

### 2.2 Build-Time Flow Compilation (flow_codegen.py)

**Invoked by:** `demo_runner.py::build` phase

**Input:** 
- `case.auto_run_flow` (AutoRunFlow object or list[str])
- `workspace` (where compiled flows go)
- `builtin_root` (template's `src/autorun/_builtin/`)

**Output:**
```
workspace/src/autorun/
├── _runtime.ts                    # Copied from template
├── login.ts                       # Copied + import rewritten from _builtin/
├── TC-CONF-WEB-001.ts             # Generated from DSL (if AutoRunFlow form)
└── autoRunCoordinator.ts          # Registers all flows + dispatcher
```

**Generated Flow Example (from DSL above):**

```typescript
// AUTO-GENERATED from cases.json :: TC-CONF-WEB-001.auto_run_flow
import { withTimeout, getEnv } from "./_runtime";

export async function run(): Promise<void> {
  // 1. Sequential await of builtin dependencies
  await (await import("./login")).run();
  
  // 2. Get env
  const env = getEnv();
  
  // 3. Imports
  const room = await import("tuikit-atomicx-vue3/room");
  
  // 4. Hooks
  const roomApi = (room as any).useRoomState();
  
  // 5. Vars
  const roomId = (`eval_${env.userId}_${Date.now()}`);
  
  // 6. Steps
  console.log(`[autorun:TC-CONF-WEB-001] createRoom`);
  try {
    await withTimeout(roomApi.createRoom({ "roomId": roomId }), 10000, "createRoom");
  } catch (e) {
    console.error(`[autorun:TC-CONF-WEB-001] createRoom failed: ${(e as Error).message}`);
    return;
  }
  
  await new Promise((r) => setTimeout(r, 2000));
  
  console.log(`[autorun:TC-CONF-WEB-001] room created, userId=${env.userId}`);
}
```

**autoRunCoordinator Registration:**

```typescript
// AUTO-GENERATED by scripts/lib/flow_codegen.py
type FlowModule = { run: () => Promise<void> };

const FLOWS: Record<string, () => Promise<FlowModule>> = {
  "TC-CONF-WEB-001": () => import("./TC-CONF-WEB-001"),
  "login": () => import("./login"),
};

export async function runAutoFlow(flowIds: string): Promise<void> {
  const ids = flowIds.split(",").map((s) => s.trim()).filter(Boolean);
  for (const flowId of ids) {
    const loader = FLOWS[flowId];
    if (!loader) {
      console.error(`[MyApplication] Unknown flow: ${flowId}`);
      continue;
    }
    try {
      const mod = await loader();
      await Promise.race([mod.run(), timer]);
      console.log(`[MyApplication] auto-run flow done: ${flowId}`);
    } catch (e) {
      console.error(`[MyApplication] auto-run flow failed: ${flowId}: ${e.message}`);
    }
  }
}
```

### 2.3 Runtime Flow Dispatch

**Flow:**
1. **demo_runner.py** `build` phase generates flows + coordinator
2. **demo_runner.py** `run` phase starts Vite dev server
3. **log-bridge.mjs** (launched by run phase):
   - Injects `VITE_EVAL_AUTO_RUN_FLOW=TC-CONF-WEB-001` into `.env.local`
   - Spawns Vite dev server
   - Launches Headless Chrome via Puppeteer
4. **Browser bootstrap (src/main.ts)**:
   ```typescript
   const env = loadEnv(); // Reads VITE_EVAL_AUTO_RUN_FLOW
   if (env.autoRunFlow) {
     await runAutoFlow(env.autoRunFlow);  // Invokes coordinator dispatcher
     return;
   }
   ```

---

## 3. Self-Driven Autorun (Optimizer v2)

### 3.1 When It Activates

When `cases.json::auto_run_flow` is `null` or empty `[]`:

```json
{
  "test_id": "TC-CONF-WEB-NEW",
  "platform": "web",
  "auto_run_flow": null  // or []
}
```

### 3.2 AI's Generated eval-autorun.ts

**AI-Generated File (in ai_extracted_code/):**

```typescript
// eval-autorun.ts — self-driven test orchestration
// filepath: src/generated/eval-autorun.ts

export async function evalAutoRun(env: {
  sdkAppId: number;
  userId: string;
  userSig: string;
  roomId: string;
}): Promise<void> {
  // Get the SDK API (injected in main.ts or by other AI-generated code)
  const trtcClient = (window as any).__trtcClient;
  if (!trtcClient) {
    console.error("[eval] TRTC client not initialized");
    return;
  }
  
  // Custom test flow — entirely self-managed
  try {
    console.log("[eval] Logging in...");
    await trtcClient.login(env);
    
    console.log("[eval] Creating room...");
    await trtcClient.createRoom({ roomId: env.roomId });
    
    console.log("[eval] Publishing stream...");
    await trtcClient.publish();
    
    // Wait 30 seconds
    await new Promise(r => setTimeout(r, 30_000));
    
    console.log("[eval] Unpublishing...");
    await trtcClient.unpublish();
    
    console.log("[eval] Test completed successfully");
  } catch (e) {
    console.error("[eval] Test failed:", e);
  }
}

// **CRITICAL:** Register on window for log-bridge detection
window.__evalAutoRun = evalAutoRun;
```

**Where it goes:**
- Flow: `code_injector.py` extracts `filepath:` from AI code
- Destination: `workspace/src/generated/eval-autorun.ts`
- **NOT compiled by flow_codegen** — it's user-generated, not DSL-based

### 3.3 Build-Phase Handling (demo_runner.py)

```python
flow_ids = case.autorun_flow_ids()
if flow_ids:
    # DSL mode: compile flows
    flow_codegen.generate(case=case, workspace=workspace, ...)
else:
    # Self-driven mode: write minimal stub coordinator
    autorun_dir = workspace / "src" / "autorun"
    autorun_dir.mkdir(parents=True, exist_ok=True)
    (autorun_dir / "autoRunCoordinator.ts").write_text(
        '// Stub for self-driven eval mode.\n'
        '// log-bridge will detect window.__evalAutoRun and invoke it.\n'
        'export async function runAutoFlow(_flowIds: string): Promise<void> {}\n'
    )
```

### 3.4 Runtime Detection & Invocation (log-bridge.mjs)

**Step 5d in log-bridge — After page loads:**

```javascript
// Wait up to 5 seconds for __evalAutoRun to appear on window
const hasAutoRun = await page.evaluate(() => {
  return new Promise((resolve) => {
    if (typeof window.__evalAutoRun === "function") {
      resolve(true);
      return;
    }
    // Poll 200ms × 25 attempts = 5 seconds
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
  // Build env from launch.env (single source of truth)
  const creds = readLaunchEnv(workspace);
  const env = {
    sdkAppId: Number(creds.get("TRTC_TEST_SDKAPPID")),
    userId: creds.get("TRTC_TEST_USERID"),
    userSig: creds.get("TRTC_TEST_USERSIG"),
    roomId: `eval_${nonce.slice(0, 8)}`,
  };
  
  // Invoke the AI-generated function
  await page.evaluate(async (env) => {
    try {
      await window.__evalAutoRun(env);
    } catch (err) {
      console.error("[eval] fatal:", err.message);
    }
  }, env);
} else {
  // Fall back to DSL-based autoRunCoordinator
  console.log("[log-bridge] No evalAutoRun found, using autoRunCoordinator flow");
}
```

---

## 4. Demo Scaffold Structure

### 4.1 Web Demo Template Layout

```
templates/web-demo/
├── INJECTION.json              # Injection points (AI code targets)
├── src/
│   ├── main.ts                 # Bootstrap → loads env → runs flow
│   ├── env.ts                  # TrtcTestEnv interface + loadEnv()
│   ├── generated/              # AI-injected code + entry point
│   │   └── anchorView.ts       # Placeholder for injected code
│   └── autorun/                # Flow execution layer
│       ├── _runtime.ts         # Helpers: getEnv(), withTimeout()
│       └── _builtin/           # Hand-written flows
│           ├── login.ts        # Idempotent login + event handlers
│           └── anchorStartThenEnd.ts  # Live anchor orchestration
├── profiles/                   # Framework selection layer
│   ├── vanilla/
│   │   ├── main.ts
│   │   └── vite.config.ts
│   ├── vue3/
│   │   ├── main.ts
│   │   └── package.patch.json  # Adds vue/vue3 deps
│   ├── vue2/
│   │   ├── main.ts
│   │   └── package.patch.json
│   └── react/
│       ├── main.ts
│       └── package.patch.json
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 4.2 INJECTION.json

```json
{
  "template_version": "1.0.0",
  "platform": "web",
  "supported_frameworks": ["vanilla", "vue3", "vue2", "react"],
  "default_framework": "vanilla",
  "injection_points": [
    {
      "name": "anchorView.ts",
      "path": "src/generated/anchorView.ts",
      "placeholder": true,
      "replace_mode": "overwrite"
    }
  ],
  "auto_run_flows": {
    "anchor_start_then_end": {
      "entry": "src/autorun/anchorStartThenEnd.ts",
      "description": "...",
      "timeout_sec": 60
    }
  }
}
```

### 4.3 Framework Profile Selection

**Flow (demo_runner.py build phase):**

```python
if case.platform == "web":
    # Detect framework from AI output (Vue SFC → vue3, JSX → react, etc.)
    framework = web_profile.detect_web_framework(
        case_dir / "ai_extracted_code"
    )
    # Apply profile: patches package.json, vite.config.ts, main.ts
    web_profile.apply_web_profile(workspace, framework)
```

**Example Profile Patch (vue3):**
- Adds `vue` and `vue3` dependencies to package.json
- Overwrites vite.config.ts to enable Vue SFC compilation
- Replaces main.ts to mount a Vue app

---

## 5. Code Injection & Entry Bridge

### 5.1 Injection Pipeline (code_injector.py)

**Priority Chain (highest → lowest):**

1. **Explicit `injection_map` from cases.json** (backward compat)
2. **Filepath declarations in AI code** (`<!-- filepath: src/generated/Foo.vue -->`)
3. **Content-feature detection** (header comments → imports reverse-inference)
4. **Fallback naming** (`block_00.ts` → `src/generated/`)

### 5.2 Entry Bridge Generation

After injection, `_apply_entry_bridge()` scans injected files for entry points:

**Web (vanilla):**
```typescript
// Detects default export / named function (mount/render/init) / class (XxxView)
// Patches src/main.ts to import and invoke it
const entry = await import("./generated/myComponent");
if (typeof entry.default === "function") {
  const result = entry.default(root);
  if (result?.then) await result;
}
```

**iOS (Swift):**
```swift
// Detects UIViewController subclass, generates init call
// Overwrites SceneDelegate.swift to set as rootViewController
let vc = InjectedViewController()
window.rootViewController = vc
```

**Android (Kotlin):**
```kotlin
// Detects Activity / Fragment subclass
// Overwrites MainActivity.kt to launch or load it
startActivity(Intent(this, InjectedActivity::class.java))
```

---

## 6. Credential Flow

### 6.1 Source of Truth: launch.env

**Location:** `<case_dir>/.eval-meta/launch.env`

**Written by:** `case_runner_orchestrator.py` from skill config + shell env

```
TRTC_TEST_SDKAPPID=1400000000
TRTC_TEST_USERID=user_001
TRTC_TEST_USERSIG=...base64...
```

### 6.2 Environment Variable Translation

**log-bridge.mjs** reads `launch.env` (single source of truth) and injects into `.env.local`:

```javascript
VITE_TRTC_TEST_SDKAPPID=1400000000
VITE_TRTC_TEST_USERID=user_001
VITE_TRTC_TEST_USERSIG=...base64...
VITE_EVAL_RUN_NONCE=abc1234...
VITE_EVAL_AUTO_RUN_FLOW=TC-CONF-WEB-001  // (DSL mode only)
```

**Vite imports** (compiled into bundle):

```typescript
// src/env.ts
export function loadEnv(): TrtcTestEnv {
  return {
    sdkAppId: Number(import.meta.env.VITE_TRTC_TEST_SDKAPPID),
    userId: import.meta.env.VITE_TRTC_TEST_USERID,
    userSig: import.meta.env.VITE_TRTC_TEST_USERSIG,
    autoRunFlow: import.meta.env.VITE_EVAL_AUTO_RUN_FLOW || null,
  };
}
```

### 6.3 Credential Normalization (post-injection)

**creds_normalizer.py** rewrites placeholder values in injected code:

**Before:**
```typescript
const sdkAppId = 1400000000;
const userId = 'user_001';
const userSig = 'YOUR_USERSIG';
```

**After:**
```typescript
const sdkAppId = import.meta.env.VITE_TRTC_TEST_SDKAPPID;
const userId = import.meta.env.VITE_TRTC_TEST_USERID;
const userSig = import.meta.env.VITE_TRTC_TEST_USERSIG;
```

---

## 7. _runtime.ts: Shared Helpers

**Location:** `src/autorun/_runtime.ts`

**Purpose:** Dependency-free utilities used by all generated flows

```typescript
// Get the test environment (thrown if missing)
export function getEnv(): TrtcTestEnv {
  const env = (globalThis as any).__trtcEnv;
  if (!env) throw new Error("__trtcEnv not populated");
  return env;
}

// Race a promise against a timeout (returns undefined on timeout, not reject)
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T | undefined> {
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => {
      console.warn(`[autorun] ${label} timed out after ${ms}ms`);
      resolve(undefined);
    }, ms)
  );
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
```

**Used in Generated Flows:**

```typescript
import { withTimeout, getEnv } from "./_runtime";

export async function run(): Promise<void> {
  const env = getEnv();
  await withTimeout(somePromise, 10_000, "someOperation");
}
```

---

## 8. Builtin Flows

### 8.1 login.ts

**Purpose:** Idempotent login + event subscription

**Key Behaviors:**
- Runs `useLoginState().login()` (idempotent if already logged in)
- Polls `loginUserInfo.value.userId` with 200ms tick until truthy or timeout
- Subscribes to `onLoginExpired` and `onKickedOffline` events
- Logs cpp-style markers so `runtime_monitor` can match them

**Why Hand-Written:**
- Race condition handling: AI code's onMounted may fire in parallel
- Polling state machine (not expressible cleanly in DSL)
- Fire-and-forget event subscriptions

### 8.2 anchorStartThenEnd.ts

**Purpose:** Live anchor orchestration flow

**Sequence:**
1. Dynamically import `src/generated/anchorView.ts`
2. Call `startAnchor()` (AI-generated entry point)
3. Wait 30 seconds
4. Call `endAnchor()`

**Why Hand-Written:**
- Imports AI-generated code (not a known package)
- Exports are determined by AI, not SDK contract

---

## 9. Full Test Lifecycle

### 9.1 Build Phase

```
demo_runner.py --case-id TC-CONF-WEB-001 --run-dir /tmp/eval --phase build
├─ template_fetcher.copy_template()
│  └─ Copies web-demo/ to workspace/
├─ web_profile.detect_web_framework()
│  └─ Scans AI code → "vue3"
├─ web_profile.apply_web_profile(workspace, "vue3")
│  └─ Patches package.json, vite.config.ts, main.ts
├─ code_injector.inject()
│  └─ Writes workspace/src/generated/App.vue (from AI)
├─ flow_codegen.generate()
│  └─ Writes workspace/src/autorun/TC-CONF-WEB-001.ts + coordinator
├─ creds_normalizer.normalize_creds_in_workspace()
│  └─ Rewrites import.meta.env references
└─ builder.build(adapter, workspace)
   └─ npm ci && npm run build
```

### 9.2 Run Phase

```
demo_runner.py --case-id TC-CONF-WEB-001 --run-dir /tmp/eval --phase run
└─ launcher.run()
   ├─ log-bridge.mjs (launched)
   │  ├─ Injects VITE_EVAL_AUTO_RUN_FLOW into .env.local
   │  ├─ Starts Vite dev server
   │  ├─ Launches Headless Chrome
   │  ├─ Navigates to dev URL
   │  ├─ [Wait 5s] Detects window.__evalAutoRun (false for DSL mode)
   │  └─ [Invokes] runAutoFlow("TC-CONF-WEB-001") via Puppeteer
   │
   └─ Browser (DevTools Protocol)
      ├─ Page loads
      ├─ main.ts runs
      │  ├─ loadEnv() reads VITE_* env vars
      │  └─ autoRunCoordinator.runAutoFlow("TC-CONF-WEB-001")
      │
      └─ runAutoFlow dispatcher
         ├─ Imports "./login"
         │  └─ login.run() → useLoginState().login()
         ├─ Imports "./TC-CONF-WEB-001"
         │  └─ Generated flow runs with hooks + vars + steps
         └─ Completes / times out (60s global)
```

### 9.3 Monitoring Phase

```
runtime_monitor.py
├─ Reads cases/<id>/runtime.log
├─ Parses console.log([autorun:...]) markers
├─ Matches expected_events from cases.json
├─ Scores dynamic_score (0-1 based on hit rate)
└─ Combines with static_score from evaluator.py
```

---

## 10. Key Design Decisions

### 10.1 Why DSL + Code Generation?

Instead of interpreting a JSON DSL at runtime:

1. **Sourcemaps & Debugging:** Generated .ts keeps full source context
2. **Build & Lint Integration:** tsc catches type errors; eslint runs normally
3. **Static Analysis:** `puppeteer_parser.expected_event_hit` matches console output verbatim
4. **Zero Runtime Overhead:** DSL interpreter doesn't ship in bundle

### 10.2 Why Two Autorun Paths?

- **DSL (existing):** Structured, auditable, covers 27 legacy flows
- **Self-driven (new):** AI-generated code can be more flexible & adapt to SDK changes without case re-authoring

### 10.3 Why Hand-Written Builtins?

Some flows (login, anchor orchestration) are kept hand-written because:
- Complex state machine logic (poll + race conditions)
- Idempotency requirements
- Event subscription patterns (fire-and-forget)

DSL doesn't cleanly express these; hand-written keeps them maintainable and reusable.

### 10.4 Why Credential Translation?

- **launch.env:** Single source of truth (read from config.json or shell)
- **→ .env.local:** VITE_ prefix (Vite's convention)
- **→ import.meta.env:** Bundled into JS, accessible at runtime
- **→ Placeholder rewrite:** AI code never sees real creds in ai_extracted_code/

---

## 11. Critical Paths for Extension

### 11.1 Adding a New Builtin Flow

1. Write `templates/web-demo/src/autorun/_builtin/<flow-id>.ts` with `export async function run()`
2. Reference in `cases.json::auto_run_flow::depends_on: ["<flow-id>"]`
3. flow_codegen automatically copies + import-rewrites + registers it

### 11.2 Adding a DSL Step Type

1. Add Pydantic class to `scripts/lib/schemas.py::AutoRunStep` union
2. Implement render function in `flow_codegen.py::_render_step()`
3. Test in `tests/unit/test_flow_codegen.py`

### 11.3 Supporting Self-Driven Mode

AI must generate `eval-autorun.ts` with:
```typescript
export async function evalAutoRun(env): Promise<void> { ... }
window.__evalAutoRun = evalAutoRun;
```

log-bridge detects it, reads credentials from launch.env, and invokes.

---

## 12. Test Data & Configuration

### 12.1 cases.json

**Location:** `tests/benchmark/cases.json`

**Contains:** 1300+ test cases across 4 products, 6 platforms, 100+ abilities

**Key Fields:**
- `test_id`: Unique identifier (e.g., `TC-CONF-WEB-001`)
- `auto_run_flow`: DSL object, legacy list[str], or null
- `demo_injection_map`: Legacy (backward compat)
- `expected_events`: Runtime log markers to match
- `constraints`: Static code requirements (must_include, must_not)
- `acceptance`: Pass thresholds (static_score_min, dynamic_score_min)

### 12.2 schema.json

**Location:** `tests/benchmark/schema.json`

**Purpose:** Pydantic schema validator for cases.json

---

## 13. Open Questions / Opportunities

1. **Self-driven Mode Adoption:** Should all new cases omit `auto_run_flow`?
   - Requires strong eval-autorun signature conventions
   - More flexible for AI, but less auditable

2. **Custom Entry Points:** Can AI register hooks beyond `__evalAutoRun`?
   - Currently assumes single entry; could extend for multiple flows

3. **Framework-Specific Helpers:** Should profiles inject framework-specific log markers?
   - Currently all consume same env.ts; could add vue3-specific setup

4. **Error Recovery:** Should log-bridge retry failed flows or just proceed?
   - Currently: one failure = logged + continue

---

## Summary

**eval-autorun** has evolved from a rigid DSL-only system to a hybrid:

- **DSL path (70%):** Cases define structured flows in JSON → compiled to TS at build time → coordinator dispatches
- **Self-driven path (30%):** AI generates eval-autorun.ts → registers on window → log-bridge invokes with creds

Both paths share:
- Same credential propagation (launch.env → .env.local → import.meta.env)
- Same entry bridge generation (AI code → workspace injection → reachable from main.ts)
- Same log forwarding (console.log → puppeteer → runtime.log → runtime_monitor)

The **demo scaffold** (web template) is:
- Framework-agnostic base + profile overlays (vanilla/vue3/vue2/react)
- Two-phase flow execution (main.ts bootstrap → autorun coordinator / eval-autorun)
- Three-layer dependency injection (env vars → generated code → SDK APIs)
