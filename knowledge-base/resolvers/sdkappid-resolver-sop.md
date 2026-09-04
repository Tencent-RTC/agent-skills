# TRTC SDKAppID Resolver SOP

> Audience: AI runtime / agent / resolver implementation  
> Purpose: deterministically extract a single `sdkappid` from the current project when a high-confidence source exists  
> Scope: TRTC / Chat / TUIKit / TUICallKit / TUILiveKit / TUIRoomKit related project files only  
> Non-goal: do not infer product, do not guess from arbitrary numbers, do not collect secrets

---

## 1. Contract

Input:

- `project_root`
- optional `preferred_paths`
- optional `max_files`

Output:

```json
{
  "status": "resolved | not_found | conflict | invalid",
  "sdkappid": "1400xxxxxx | null",
  "source_type": "literal_config | test_usersig | uikit_binding | server_sig | runtime_call | null",
  "source_path_hint": "relative/path/only | null",
  "matched_field": "SDKAPPID | SDKAppID | sdkAppId | sdkappid | public_SDKAPPID | null",
  "candidates_count": 0,
  "conflict": false
}
```

Hard rules:

1. Resolve at most one `sdkappid`.
2. Never guess from an arbitrary integer.
3. Never collect `SECRETKEY`, `SDKSecretKey`, `userSig`, `userID`, `APPKey`, `bizId`, or any sibling field.
4. If multiple different high-confidence values exist, return `conflict`.
5. If no high-confidence value exists, return `not_found`.

---

## 2. Scan Order

Run exactly in this order. Stop immediately once a unique winner is found at a higher priority tier.

### Tier 0: Explicit trusted input

Accept only:

- explicit resolver argument `sdkappid`
- `.trtc-session.yaml` exact field `credentials.sdkappid`

If exactly one valid value exists, return `resolved`.

### Tier 1: Fixed literal config files

Scan only these filenames:

- `config.dart`
- `main.ts`
- `main.js`
- `App.vue`
- `GenerateTestUserSig.java`
- `GenerateTestUserSig.swift`
- `GenerateTestUserSig.h`
- `GenerateTestUserSig.js`
- `GenerateTestUserSig-es.js`
- `generateTestUserSig.js`
- `generate_test_user_sig.dart`

Accept only if both conditions hold:

1. file contains one accepted field name
2. file contains one accepted semantic context

If exactly one unique value is found across Tier 1, return it.

### Tier 2: UIKit / login runtime call sites

Scan only files with one of these frozen source extensions, then retain only
files whose executable-code view contains an accepted semantic context token:

- `.js`, `.jsx`, `.mjs`, `.cjs`
- `.ts`, `.tsx`
- `.vue`
- `.dart`

Extension matching is case-insensitive. Exclude TypeScript declaration files
(`*.d.ts`) and generated JavaScript bundles (`*.min.js`, `*.bundle.js`, with
the same exclusions for `.mjs`/`.cjs`). Do not infer additional extensions.

Accept only exact runtime call shapes:

- `LoginStore.shared.login(..., sdkAppID, ...)`
- `<TUIKit :SDKAppID="...">`
- `TUIKit.init({ SDKAppID: ... })` or the equivalent top-level object shorthand
  `TUIKit.init({ SDKAppID })`

If the value is a direct literal or a direct same-file constant binding, collect it.

If Tier 2 yields exactly one unique value and Tier 1 yielded none, return it.

### Tier 3: Server signature helpers

Scan only:

- `TLSSigAPIv2.java`
- `TLSSigAPIv2.js`
- `TLSSigAPIv2.py`
- `TLSSigAPIv2.php`
- `TLSSigAPITest.go`

Accept only:

- constructor first arg or function first arg that clearly represents `sdkappid`

If Tier 3 yields exactly one unique value and higher tiers yielded none, return it.

### Tier 4: Conflict / miss

- no valid candidate: `not_found`
- more than one distinct valid candidate in same highest-winning tier: `conflict`

Do not merge tiers to break conflicts.

---

## 3. Accepted Field Names

Match these field names case-sensitively as written:

- `SDKAPPID`
- `SDKAppID`
- `sdkAppId`
- `sdkappid`
- `public_SDKAPPID`

Do not accept:

- `appId`
- `AppID`
- `sdkId`
- `bizId`
- `roomId`

unless a future revision explicitly whitelists them.

---

## 4. Accepted Semantic Contexts

A file is eligible only if it contains at least one of:

- `GenerateTestUserSig`
- `genTestUserSig`
- `UserSig`
- `TLSSigAPIv2`
- `genSig`
- `LoginStore.shared.login`
- `TUIKit`
- `TUICallKit`
- `TUILiveKit`
- `TUIRoomKit`

Rationale:

- file names alone are insufficient because the same names are reused across products
- semantic context is required to prove Tencent RTC ecosystem relevance

---

## 5. Allowed Extraction Shapes

Extract only these shapes:

### Shape A: Direct literal assignment

Examples:

```text
SDKAPPID = 1400000000
public_SDKAPPID = 1400000000
static int sdkAppId = 1400000000
const SDKAppID = 1400000000
sdkappid: 1400000000
```

### Shape B: Direct object/config binding

Examples:

```text
<TUIKit :SDKAppID="1400000000" />
const config = { SDKAppID: 1400000000 }
```

### Shape C: Direct constructor / function first arg

Examples:

```text
new TLSSigAPIv2(1400000000, key)
new TLSSigAPIv2.Api(1400000000, key)
GenSig(1400000000, key, ...)
```

### Shape D: Direct same-file constant reference

Allowed only if:

1. the referenced identifier is declared in the same file
2. the identifier resolves to one numeric literal
3. there is no reassignment

Example:

```text
const SDK_APP_ID = 1400000000
LoginStore.shared.login(context, SDK_APP_ID, userID, userSig, ...)
```

Do not follow imports across files in P0.

---

## 6. Validation Rules

Before returning a candidate:

1. value must be numeric after trimming quotes
2. value must be positive
3. value must not be `0`
4. value must not contain placeholder markers:
   - `PLACEHOLDER`
   - `xxxx`
   - `xxx`
   - `your`
   - `demo`
5. value must not be an expression:
   - `process.env.*`
   - `${...}`
   - string concatenation
   - function call result

If a matched field fails validation, discard it and continue scanning.

---

## 7. Forbidden Behavior

Never do any of the following:

1. scan the whole repo for every integer
2. read dependency caches, build output, git history, or vendor bundles
3. collect `SECRETKEY`, `SDKSecretKey`, `secretKey`
4. collect `userSig`, `usersig`, `userID`, `userid`
5. infer from comments alone
6. infer from screenshots, docs text, or README prose without code/config evidence
7. choose one value when multiple distinct values exist in the same winning tier
8. rewrite project files or create `.trtc-session.yaml` just to cache the result
9. enter Agent-owned configuration, installed Skill, cache, or worktree roots:
   - `.agents`
   - `.claude`
   - `.codebuddy`
   - `.codex`
   - `.cursor`
   - `.gemini`
   - `.windsurf`
   - `.worktrees`

Allowlisted files that exceed the bounded file-size limit, cannot be read
completely, or change identity during the safety check make that resolution
attempt `invalid`. Do not select a unique value from a partial candidate set.
`max_files` and `max_dirs` are shared budgets for the whole resolver call, not
fresh budgets per tier. Directory exclusions are compared case-insensitively
so Windows case variants cannot re-enter Agent or dependency directories.

Field names, semantic contexts, and call shapes must occur in executable code,
not inside ordinary, template, or triple-quoted strings. A quoted numeric value
may be read only after its assignment/attribute/call shape has been anchored in
the code view. Every captured field is checked at its exact source offset; a
call beginning in code does not make a field embedded in a later string valid.
Call arguments are split only at top-level commas in the masked code view, so
commas inside strings, nested calls, arrays, and objects cannot change the
SDKAppID argument position. Escaped triple-quote delimiters remain part of the
documentation string and do not expose its remaining contents as code.
Apply comment rules by source language: `#` is not a JavaScript/TypeScript
comment (private fields remain code), Python `//` remains floor division, and
Vue HTML comments are masked. For structured calls, require correctly nested
delimiter types; crossed delimiters such as `([)]` are malformed and yield no
candidate. `TUIKit.init` may contribute only a top-level field of its first
object argument; fields in nested or later unrelated objects are ignored.
Inside Vue SFCs, `TUIKit.init` and `LoginStore.shared.login` are executable-call
sources only when they occur within a real top-level `<script>` or
`<script setup>` body.
Ordinary template text, including code examples inside `<pre>`/`<code>`, must
not produce runtime-call candidates; template discovery remains limited to a
real `<TUIKit ...>` start-tag attribute. SFC block discovery happens before
JavaScript/TypeScript lexical masking, so quotes and backticks in template text
cannot change the lexical state of a later script body.
Re-check the resolver deadline after bounded reads, lexical
masking, and tier extraction; an expired call returns `invalid`, never a late
`resolved` result.

---

## 8. Source Type Mapping

Return `source_type` using this mapping:

- `literal_config`
  - `config.dart`
  - `main.ts`
  - `main.js`
  - `App.vue`
- `test_usersig`
  - any `GenerateTestUserSig*`
- `uikit_binding`
  - `TUIKit` prop / init
- `runtime_call`
  - `LoginStore.shared.login(...)`
- `server_sig`
  - any `TLSSigAPIv2*` or `GenSig(...)`

---

## 9. Path Hint Redaction

When returning `source_path_hint`:

1. always use a relative path
2. never include the absolute local path
3. keep only the minimal disambiguating suffix

Examples:

- `chat-demo-flutter/lib/config.dart`
- `Demo/debug/GenerateTestUserSig.js`
- `Swift/TUIKitDemo/TUIKitDemo/Private/GenerateTestUserSig.swift`

---

## 10. Resolution Algorithm

Execute exactly this algorithm:

1. initialize empty candidate buckets for Tier 0 to Tier 3
2. check Tier 0 explicit trusted input
3. scan Tier 1 fixed filenames under `project_root`
4. parse accepted extraction shapes and validate values
5. if Tier 1 has exactly one distinct value, return it
6. if Tier 1 has multiple distinct values, return `conflict`
7. scan Tier 2 runtime call sites only in files that already matched semantic contexts
8. if Tier 2 has exactly one distinct value, return it
9. if Tier 2 has multiple distinct values, return `conflict`
10. scan Tier 3 server signature helpers
11. if Tier 3 has exactly one distinct value, return it
12. if Tier 3 has multiple distinct values, return `conflict`
13. otherwise return `not_found`

No fallback tier may override a higher tier.

---

## 11. P0 File Allowlist

Use these fixed basenames for Tier 1 and Tier 3 in P0:

- `**/GenerateTestUserSig.java`
- `**/GenerateTestUserSig.swift`
- `**/GenerateTestUserSig.h`
- `**/GenerateTestUserSig.js`
- `**/GenerateTestUserSig-es.js`
- `**/generateTestUserSig.js`
- `**/generate_test_user_sig.dart`
- `**/config.dart`
- `**/main.ts`
- `**/main.js`
- `**/App.vue`
- `**/TLSSigAPIv2.java`
- `**/TLSSigAPIv2.js`
- `**/TLSSigAPIv2.py`
- `**/TLSSigAPIv2.php`
- `**/TLSSigAPITest.go`

Tier 2 is the sole exception to fixed basenames because runtime call-site names
are project-defined. It may scan only the frozen extensions and exclusions in
§2, under the same global `max_files`, `max_dirs`, per-file byte cap, deadline,
skip-directory, no-symlink, and root-containment checks. Do not add broader
extensions or extraction shapes in P0.

---

## 12. Known High-Confidence Examples

These are examples, not hardcoded absolute paths:

- `TUIKit_Android/chat/demo/app/src/main/java/io/trtc/tuikit/chat/demo/signature/GenerateTestUserSig.java`
- `Chat_UIKit/Swift/TUIKitDemo/TUIKitDemo/Private/GenerateTestUserSig.swift`
- `chat-uikit-ios-main/Demo/TUIKitDemo/Private/GenerateTestUserSig.h`
- `chat-demo-react-native/Demo/debug/GenerateTestUserSig.js`
- `chat-demo-flutter/lib/config.dart`
- `chat-uikit-vue/Vue3/Demo/main.ts`
- `TUICallKit/Web/basic-react/src/debug/GenerateTestUserSig-es.js`

Treat them as regression fixtures for tests.

---

## 13. Test Requirements

Minimum required tests:

1. resolves one literal `SDKAPPID` from `GenerateTestUserSig.java`
2. resolves one literal `public_SDKAPPID` from Swift demo file
3. resolves one literal `sdkappid` from `config.dart`
4. resolves one literal `SDKAppID` from Vue `main.ts`
5. resolves one literal from `GenerateTestUserSig-es.js`
6. ignores `SECRETKEY`
7. ignores `userSig`
8. ignores placeholder `SDKAPPID = 0`
9. ignores placeholder `SDKAPPID = "xxxx"`
10. returns `conflict` for two different valid literals in Tier 1
11. returns `not_found` for unrelated project files
12. returns same-file constant reference in `LoginStore.shared.login(...)`
13. finds that call in a non-Tier-1 basename such as `src/stores/login.ts`
14. rejects declaration/generated/unsupported extensions
15. rejects crossed delimiters and mutable/reassigned bindings
16. masks Vue HTML comments and ignores nested/unrelated `SDKAppID` objects
17. resolves top-level `TUIKit.init({ SDKAppID })` shorthand outside Tier 1 basenames
18. rejects Vue template display text while accepting script/setup calls and real TUIKit attributes
19. accepts template-first SFCs whose ordinary text contains apostrophes, quotes, or backticks

---

## 14. C18 Low-Impact Hybrid Resolver MVP

### Source Matrix

See `knowledge-base/resolvers/source-matrix.md` for the authoritative per-product
source matrix. No extraction shape may be enabled in code without a frozen row
in that file.

### Goal

C18 exists to increase SDKAppID attribution for existing projects without
asking the user to enter an SDKAppID, changing project files, installing
runtime dependencies, or adding work to the Prompt Hook. It is not a project to
build a universal multi-language AST platform.

The MVP keeps Tier 0 and the cross-platform fixed Tier 1/3 sources, reduces
repeat scanning with active-scope selection and a local cache, and adds a
structured parser only for prefiltered Web candidates. Mobile and server AST
adapters are deferred until production miss data demonstrates enough value.

### Source matrix before parser code

Before enabling any new extraction shape, add a frozen source-matrix row with:

1. TRTC product and platform
2. source language and supported file/container types
3. authoritative package/import/type names
4. exact initialization, constructor, login, or signature-helper symbol
5. SDKAppID field or argument position
6. accepted literal and same-file immutable binding shapes
7. forbidden lookalikes and documentation/example cases
8. positive, negative, conflict, malformed, and scoped-monorepo fixtures

Parser availability never authorizes broad integer or variable-name scanning.
For example, the Web matrix must explicitly distinguish the confirmed
`useLoginStore()` / `login({ sdkAppID: SDKAppID, ... })` shape from unrelated
functions that also happen to be named `login`.

The Web fallback row R18 is the limited exception for project-owned config
objects. It accepts only the frozen SDKAppID field aliases in the source
matrix, numeric literals or same-file immutable `const` bindings, and either a
strong TRTC/TUI config name or an executable TRTC product context within eight
logical code lines. A generic `config.sdkAppId` without that context, and any
comment, string, environment lookup, dynamic expression, mutable binding, or
cross-file value, remains `not_found`.

### MVP architecture rules

1. Hook must not call or load the Resolver, parser, or SDKAppID cache.
2. The core owns discovery, root containment, file/dir/byte/time budgets, tier
   priority, deduplication, conflict handling, and cache invalidation.
3. Default scope is the active cwd and nearest supported project manifest. Do
   not scan unrelated sibling applications merely because they share a
   monorepo root.
4. Keep the adapter interface thin: `supports(context)` and
   `extract(sourceContext)`. Adapters do not traverse directories.
5. Run exact product/API token prefiltering before parsing. Only prefiltered
   JS/TS/JSX/TSX candidates use Babel; only prefiltered `.vue` candidates may
   load the Vue compiler.
6. Tier 1/3 fixed helpers for Java, Swift/Objective-C headers, Dart, JavaScript,
   Python, PHP, and Go remain narrow parsers and do not require a full AST.
7. The shared candidate needs only the validated SDKAppID, tier, and source
   type. AST ranges, symbols, source paths, and snippets remain adapter-local.
8. Parser errors, unsupported syntax, incomplete reads, budget exhaustion, or
   file mutation fail closed for enrichment and must not fall back to regex
   extraction from partial source.

### Local cache contract

The cache lives in telemetry state, never in the project and never on wire:

- Tier 0 explicit/session input is evaluated before cache lookup.
- A resolved entry records the Resolver version, anonymous scope key, final
  value, and minimal fingerprint required to detect a changed source.
- A not-found entry uses a short TTL to avoid rescanning unchanged projects on
  every invoke.
- Conflict and invalid results may use only a short TTL or retry next session.
- Resolver-version, scope, or relevant-source changes invalidate the entry.
- Reporting opt-out means no cache read, resolution, or cache write.
- Cache corruption fails open for Prompt delivery and triggers a bounded fresh
  resolution, not use of stale bytes.

### Deferred scope

The following are not part of C18 MVP:

- Java/Kotlin, Swift/Objective-C, Dart, Go, Python, or PHP arbitrary-source AST
- Tree-sitter WASM and multi-grammar packaging
- cross-file symbol resolution
- environment-variable resolution
- scanning every application in a monorepo
- server runtime-injection reconstruction
- all-platform shadow rollout

After MVP release, use existing product/platform/framework fields and
SDKAppID presence to measure misses. A new platform adapter requires its own
source matrix, fixtures, performance budget, and review. It is valid to never
implement broad server AST if fixed sources provide sufficient coverage.
