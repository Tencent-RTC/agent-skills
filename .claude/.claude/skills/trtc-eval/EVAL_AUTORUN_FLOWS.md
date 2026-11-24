# TRTC Eval Autorun: Visual Flow Diagrams

## 1. DSL-Based Autorun (cases.json::auto_run_flow object)

```
┌─────────────────────────────────────────────────────────────────┐
│ CASE AUTHORING (cases.json)                                      │
├─────────────────────────────────────────────────────────────────┤
│ {                                                                │
│   "test_id": "TC-CONF-WEB-001",                                 │
│   "auto_run_flow": {                                             │
│     "depends_on": ["login"],                                    │
│     "imports": { "room": "tuikit-atomicx-vue3/room" },         │
│     "hooks": { "roomApi": { "from": "room", ... } },          │
│     "steps": [                                                  │
│       { "call": "roomApi.createRoom", ... }                   │
│     ]                                                           │
│   }                                                              │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ BUILD PHASE: flow_codegen.py (DSL → TypeScript)                │
├─────────────────────────────────────────────────────────────────┤
│ Inputs:                                                          │
│  • cases.json::auto_run_flow (AutoRunFlow object)              │
│  • templates/web-demo/src/autorun/_builtin/ (builtin flows)   │
│                                                                  │
│ Processing:                                                      │
│  1. Parse DSL: imports, hooks, vars, steps                     │
│  2. Validate: all hook aliases resolve, vars check             │
│  3. Interpolate: {{var}} → ${var} in templates                │
│  4. Render to TypeScript                                        │
│                                                                  │
│ Outputs (workspace/src/autorun/):                               │
│  ✓ _runtime.ts (copied verbatim)                               │
│  ✓ login.ts (copied + rewritten imports)                       │
│  ✓ TC-CONF-WEB-001.ts (generated from DSL)                    │
│  ✓ autoRunCoordinator.ts (flow registry + dispatcher)         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ ENV SETUP: log-bridge.mjs                                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Read launch.env (source of truth)                           │
│ 2. Inject into .env.local:                                     │
│    VITE_TRTC_TEST_SDKAPPID=1400000000                          │
│    VITE_TRTC_TEST_USERID=user_001                              │
│    VITE_TRTC_TEST_USERSIG=...                                  │
│    VITE_EVAL_RUN_NONCE=abc...                                  │
│    VITE_EVAL_AUTO_RUN_FLOW=TC-CONF-WEB-001  ← KEY             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER STARTUP: src/main.ts                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. loadEnv()  // Reads VITE_* vars                             │
│ 2. if (env.autoRunFlow) {  // "TC-CONF-WEB-001"               │
│      await runAutoFlow(env.autoRunFlow)                        │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ FLOW EXECUTION: autoRunCoordinator.runAutoFlow()               │
├─────────────────────────────────────────────────────────────────┤
│ const FLOWS = {                                                  │
│   "TC-CONF-WEB-001": () => import("./TC-CONF-WEB-001"),       │
│   "login": () => import("./login")                             │
│ };                                                               │
│                                                                  │
│ for (const flowId of ["TC-CONF-WEB-001"]) {                   │
│   const mod = await FLOWS[flowId]();                           │
│   await Promise.race([mod.run(), timeout]);                    │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ GENERATED FLOW: TC-CONF-WEB-001.ts                             │
├─────────────────────────────────────────────────────────────────┤
│ export async function run(): Promise<void> {                   │
│   await (await import("./login")).run();  // depends_on        │
│   const env = getEnv();                                         │
│   const room = await import("tuikit-atomicx-vue3/room");      │
│   const roomApi = (room as any).useRoomState();               │
│   const roomId = `eval_${env.userId}_${Date.now()}`;          │
│   console.log("[autorun:TC-CONF-WEB-001] createRoom");        │
│   await withTimeout(                                            │
│     roomApi.createRoom({ roomId }),                            │
│     10000,                                                      │
│     "createRoom"                                               │
│   );                                                             │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LOG CAPTURE: puppeteer → runtime.log                            │
├─────────────────────────────────────────────────────────────────┤
│ [autorun:TC-CONF-WEB-001] createRoom                            │
│ [autorun:login] |Login|login start                              │
│ [autorun:login] onLoginSuccess                                  │
│ [autorun:TC-CONF-WEB-001] room created, userId=user_001        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ VERIFICATION: runtime_monitor.py                                │
├─────────────────────────────────────────────────────────────────┤
│ expected_events = ["onLoginSuccess", "..."]                    │
│ actual_events = ["onLoginSuccess", ...]  ✓ HIT                │
│ dynamic_score = hits / expected.length                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Self-Driven Autorun (cases.json::auto_run_flow = null)

```
┌─────────────────────────────────────────────────────────────────┐
│ CASE AUTHORING (cases.json)                                      │
├─────────────────────────────────────────────────────────────────┤
│ {                                                                │
│   "test_id": "TC-CONF-WEB-NEW",                                │
│   "auto_run_flow": null  // or []  ← SELF-DRIVEN MODE         │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ AI GENERATION: ai_extracted_code/                               │
├─────────────────────────────────────────────────────────────────┤
│ // filepath: src/generated/eval-autorun.ts                     │
│                                                                  │
│ export async function evalAutoRun(env): Promise<void> {        │
│   const trtcClient = (window as any).__trtcClient;             │
│   await trtcClient.login(env);                                 │
│   await trtcClient.createRoom({ roomId: env.roomId });        │
│   await trtcClient.publish();                                  │
│   await new Promise(r => setTimeout(r, 30_000));               │
│   await trtcClient.unpublish();                                │
│ }                                                                │
│                                                                  │
│ // CRITICAL: Register on window for log-bridge detection       │
│ window.__evalAutoRun = evalAutoRun;                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ BUILD PHASE: code_injector.py                                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. Extract filepath: from AI code                              │
│ 2. Inject into workspace/src/generated/eval-autorun.ts        │
│ 3. Generate minimal autoRunCoordinator stub                   │
│    export async function runAutoFlow(_: string) {}            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ ENV SETUP: log-bridge.mjs                                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Read launch.env                                             │
│ 2. Inject into .env.local:                                     │
│    VITE_TRTC_TEST_SDKAPPID=...                                 │
│    VITE_TRTC_TEST_USERID=...                                   │
│    VITE_TRTC_TEST_USERSIG=...                                  │
│    VITE_EVAL_RUN_NONCE=...                                     │
│    (NO VITE_EVAL_AUTO_RUN_FLOW - key difference!)              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER STARTUP: src/main.ts                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. loadEnv()  // autoRunFlow is null/undefined                │
│ 2. if (!env.autoRunFlow) {  // skipped                         │
│      // Optional: show UI or wait                              │
│    }                                                             │
│ 3. (AI-generated code mounts and registers eval-autorun)      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ EVAL-AUTORUN DETECTION: log-bridge (Step 5d)                   │
├─────────────────────────────────────────────────────────────────┤
│ // Poll for up to 5 seconds                                    │
│ const hasAutoRun = await page.evaluate(() => {                 │
│   return typeof window.__evalAutoRun === "function";           │
│ });                                                              │
│                                                                  │
│ if (hasAutoRun) {                                              │
│   const creds = readLaunchEnv(workspace);                      │
│   const env = {                                                │
│     sdkAppId: Number(creds.get("TRTC_TEST_SDKAPPID")),       │
│     userId: creds.get("TRTC_TEST_USERID"),                    │
│     userSig: creds.get("TRTC_TEST_USERSIG"),                  │
│     roomId: `eval_${nonce.slice(0, 8)}`                       │
│   };                                                             │
│   await page.evaluate(async (env) => {                         │
│     await window.__evalAutoRun(env);  ← INVOKE                │
│   }, env);                                                      │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ AI-DRIVEN EXECUTION: eval-autorun.ts                            │
├─────────────────────────────────────────────────────────────────┤
│ await evalAutoRun({                                             │
│   sdkAppId: 1400000000,                                        │
│   userId: "user_001",                                          │
│   userSig: "...",                                              │
│   roomId: "eval_abc12345"                                      │
│ });                                                              │
│                                                                  │
│ // AI manages timing, error handling, event logging             │
│ // No coordinator, no DSL — pure custom logic                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LOG CAPTURE: puppeteer → runtime.log                            │
├─────────────────────────────────────────────────────────────────┤
│ [eval] Logging in...                                            │
│ [eval] Creating room...                                         │
│ [eval] Publishing stream...                                     │
│ [eval] Test completed successfully                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ VERIFICATION: runtime_monitor.py                                │
├─────────────────────────────────────────────────────────────────┤
│ expected_events = ["onLoginSuccess", ...]                      │
│ actual_events = ... (parsed from [eval] and SDK logs)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Credential Flow: launch.env → Runtime

```
┌─────────────────────────────────────┐
│ Source of Truth: launch.env         │
├─────────────────────────────────────┤
│ TRTC_TEST_SDKAPPID=1400000000       │
│ TRTC_TEST_USERID=user_001           │
│ TRTC_TEST_USERSIG=base64...         │
└─────────────────────────────────────┘
          (read-only)
             ↓
┌──────────────────────────────────────────┐
│ log-bridge.mjs: readLaunchEnv()          │
├──────────────────────────────────────────┤
│ Writes to workspace/.env.local:          │
│ VITE_TRTC_TEST_SDKAPPID=1400000000      │
│ VITE_TRTC_TEST_USERID=user_001           │
│ VITE_TRTC_TEST_USERSIG=base64...        │
│ VITE_EVAL_AUTO_RUN_FLOW=TC-CONF-WEB-001 │
└──────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────┐
│ Vite Build: import.meta.env              │
├──────────────────────────────────────────┤
│ VITE_* vars compile into bundle          │
└──────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────┐
│ Runtime: src/env.ts                      │
├──────────────────────────────────────────┤
│ export function loadEnv(): TrtcTestEnv { │
│   return {                               │
│     sdkAppId: Number(                    │
│       import.meta.env                    │
│         .VITE_TRTC_TEST_SDKAPPID         │
│     ),                                   │
│     userId: import.meta.env              │
│       .VITE_TRTC_TEST_USERID,            │
│     userSig: import.meta.env             │
│       .VITE_TRTC_TEST_USERSIG,           │
│     autoRunFlow: import.meta.env         │
│       .VITE_EVAL_AUTO_RUN_FLOW || null   │
│   };                                     │
│ }                                        │
└──────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────┐
│ AI Code (post-injection):                │
├──────────────────────────────────────────┤
│ const env = loadEnv();                   │
│ const client = new TRTC({                │
│   sdkAppId: env.sdkAppId,  ← REAL VALUE │
│   userId: env.userId,      ← REAL VALUE │
│   userSig: env.userSig     ← REAL VALUE │
│ });                                      │
└──────────────────────────────────────────┘
```

---

## 4. Entry Bridge: Injection → Reachability

```
┌──────────────────────────────────────────────┐
│ AI-Generated Code (ai_extracted_code/)       │
├──────────────────────────────────────────────┤
│ // filepath: src/generated/App.vue           │
│ <template>                                    │
│   <div class="room">                          │
│     <!-- AI's UI -->                          │
│   </div>                                      │
│ </template>                                   │
│                                               │
│ <script setup lang="ts">                     │
│ import { useRoomState } from "...";          │
│ // AI-generated component logic              │
│ </script>                                     │
└──────────────────────────────────────────────┘
          ↓ (code_injector.inject)
┌──────────────────────────────────────────────┐
│ Injected into Workspace                      │
├──────────────────────────────────────────────┤
│ workspace/src/generated/App.vue ✓           │
└──────────────────────────────────────────────┘
          ↓ (code_injector._apply_entry_bridge)
┌──────────────────────────────────────────────┐
│ Entry Bridge Generated (main.ts patched)     │
├──────────────────────────────────────────────┤
│ import { loadEnv } from "./env";             │
│ import { runAutoFlow } from                  │
│   "./autorun/autoRunCoordinator";            │
│                                               │
│ async function bootstrap() {                 │
│   const env = loadEnv();                     │
│   if (env.autoRunFlow) {                    │
│     await runAutoFlow(env.autoRunFlow);     │
│   } else {                                   │
│     // Dynamic import injected App           │
│     const mod = await import(                │
│       "./generated/App"                      │
│     );                                       │
│     new mod.default(root);                  │
│   }                                          │
│ }                                            │
│                                               │
│ bootstrap();                                 │
└──────────────────────────────────────────────┘
          ↓
┌──────────────────────────────────────────────┐
│ Browser Runtime                              │
├──────────────────────────────────────────────┤
│ ✓ App.vue mounts                             │
│ ✓ SDK APIs invoked                           │
│ ✓ Events logged → runtime.log                │
└──────────────────────────────────────────────┘
```

---

## 5. Code Generation Pipeline: DSL → TypeScript

```
DSL (AutoRunFlow from cases.json)
│
├─ depends_on: ["login"]
│  └─→ Copy _builtin/login.ts
│      └─→ Rewrite imports: ../_runtime → ./_runtime
│      └─→ autoRunCoordinator registers "login"
│
├─ imports: { "room": "tuikit-atomicx-vue3/room" }
│  └─→ Emit: const room = await import("...");
│
├─ hooks: { "roomApi": { from: "room", call: "useRoomState" } }
│  └─→ Emit: const roomApi = (room as any).useRoomState();
│
├─ vars: { "roomId": { expr: "`eval_${env.userId}`" } }
│  └─→ Emit: const roomId = (`eval_${env.userId}`);
│
└─ steps: [
     { call: "roomApi.createRoom", args: [...], ... },
     { sleep: 2000 },
     { log: "done" }
   ]
   └─→ Emit: console.log(...), await new Promise(...), etc.
   
             ↓ (flow_codegen._render_dsl)
       
Generated TypeScript File (workspace/src/autorun/TC-CONF-WEB-001.ts)
│
└─ export async function run(): Promise<void> { ... }
   └─→ Bundled by Vite
   └─→ Imported by autoRunCoordinator
   └─→ Executed by runAutoFlow()
```

---

## 6. Full Test Lifecycle: Build → Run → Monitor

```
ORCHESTRATOR (case_runner_orchestrator.py)
│
├─ Write .eval-meta/launch.env (credentials)
│
└─→ demo_runner.py --phase build
   │
   ├─ template_fetcher.copy_template()
   │  └─ web-demo/ → workspace/
   │
   ├─ web_profile.detect_web_framework(ai_code_dir)
   │  └─ Scans AI output → "vue3"
   │
   ├─ web_profile.apply_web_profile(workspace, "vue3")
   │  └─ Patches vite.config.ts, package.json, main.ts
   │
   ├─ code_injector.inject(workspace, ai_code_dir)
   │  ├─ Extract filepath declarations from AI code
   │  ├─ Copy to workspace/src/generated/
   │  └─ Generate entry bridge (patch main.ts)
   │
   ├─ flow_codegen.generate() [if auto_run_flow is object/list]
   │  ├─ DSL → TypeScript compilation
   │  └─ Write autoRunCoordinator.ts + flows
   │
   └─ builder.build()
      └─ npm ci && npm run build
      
   ✓ BUILD SUCCESSFUL → emit("exit_code": 0)

      ↓

└─→ demo_runner.py --phase run
   │
   ├─ launcher.run() spawns log-bridge.mjs
   │  ├─ Injects .env.local (credentials + flow id)
   │  ├─ npm run dev (Vite dev server)
   │  └─ Puppeteer headless Chrome launch
   │
   ├─ Browser navigates to dev URL
   │  ├─ main.ts bootstrap
   │  ├─ loadEnv() reads VITE_* vars
   │  ├─ [DSL mode] autoRunCoordinator.runAutoFlow()
   │  │   └─ Dynamic import of flows
   │  │   └─ Sequential await
   │  │
   │  └─ [Self-driven] window.__evalAutoRun detection
   │      └─ log-bridge invokes with credentials
   │
   ├─ Flow execution (30-60 seconds)
   │  ├─ SDK API calls
   │  ├─ Events logged: console.log([autorun:...])
   │  └─ runtime.log captured by Puppeteer
   │
   └─ Browser closes / timeout
   
   ✓ RUN COMPLETED → emit("exit_code": 0)

      ↓

└─→ runtime_monitor.py
   │
   ├─ Read runtime.log
   ├─ Parse [autorun:...] markers + SDK events
   ├─ Match against expected_events
   ├─ Compute dynamic_score
   └─ Combine with static_score (from evaluator.py)
   
   ✓ FINAL SCORE: static=0.85, dynamic=0.92, composite=0.89
```

