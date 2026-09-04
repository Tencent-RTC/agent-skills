# SDKAppID Source Matrix

> Authority: This file is the authoritative per-product source matrix for the SDKAppID Resolver.
> Referenced by: `knowledge-base/resolvers/sdkappid-resolver-sop.md` §14.
> Rule: No extraction shape may be enabled in code without a frozen row here with status `enabled_existing` or `verified_pending`. Rows with `research_required` or `legacy_pending_evidence` must not be implemented or extended until verified. Rows with `forbidden` document shapes that must never extract.

---

## 1. Coverage Table

| Product | Web | Android | iOS | Flutter | Electron | Server |
|---------|-----|---------|-----|---------|----------|--------|
| Chat | R01, R02, R03, R18 | R09 | R10, R11 | R12 | (= Web) | R14-JS, R14-PY |
| Conference | R05, R06, R18 | research_required | research_required | research_required | (= Web) | R14-JS, R14-PY |
| Call | R18 | research_required | research_required | R13 | — | R14-JS, R14-PY |
| Live | R18 | research_required | R15 | research_required | — | R14-JS, R14-PY |
| RTC Engine | R07, R18 | research_required | research_required | research_required | (= Web) | — |
| Conversational AI | research_required | — | — | — | — | R16 |
| TIMPush | research_required | R17 | research_required | research_required | — | — |

Legend: `Rxx` = rule ID; `(= Web)` = same Web shapes apply; `research_required` = no verified source; `—` = not applicable.

**Conversational AI note**: Web frontend obtains `sdkAppId` from backend API response at runtime (`/api/v1/get_config`) — not statically extractable. The backend stores `TRTC_SDK_APP_ID` in `.env` or credentials config; R16 covers that server-side literal path only.

**TIMPush note**: Uses `registerPush(Context, int sdkAppId, ...)` on Android. SDKAppID must match the Chat SDKAppID for the same project. R17 documents the Android pattern; other platforms are `research_required`.

---

## 2. Status Definitions

| Status | Meaning | Allowed in code |
|--------|---------|-----------------|
| `enabled_existing` | Implemented and tested in C17. | Yes |
| `verified_pending` | API verified against real project code. Ready for C18. | After C18 implementation |
| `research_required` | No verified real-project source. | No |
| `legacy_pending_evidence` | Implemented in C17 but no real-world authority found. Must not be newly implemented, expanded, or used as authority for new adapters. | Retain existing only |
| `forbidden` | Shape explicitly does NOT contain SDKAppID. Documents a false pattern. | Never extract |

---

## 3. Fixture Schema

Each rule must include fixture categories as specified by its tier:

| Tier | Required fixtures | Exemption |
|------|-------------------|-----------|
| 1 (fixed basename) | positive, negative | conflict covered by cross-file test; malformed exempt (fixed file structure) |
| 2 (runtime call) | positive, negative, conflict, malformed | None |
| 3 (server helper) | positive, negative | conflict covered by cross-file test; malformed exempt (simple constructor) |

Fixture labels:
- **POSITIVE**: should extract SDKAppID
- **NEGATIVE**: must NOT extract (valid code, but wrong context / expression / wrong product / in string)
- **CONFLICT**: two different valid literals → `conflict` status
- **MALFORMED**: syntactically broken code (unclosed brackets, crossed delimiters) → parser must not crash, yield no candidate

---

## 4. Rules

### R01 · Chat Web · TUIKit.init (object property)

- **Status**: `enabled_existing`
- **Tier**: 2 (or 1 if in Tier 1 basename like `main.ts`/`App.vue`)
- **Source type**: `uikit_binding`
- **File pattern**: `.js`, `.ts`, `.jsx`, `.tsx`, `.vue`
- **Semantic context**: `TUIKit`
- **Exact shape**: `TUIKit.init({ SDKAppID: ⟨value⟩ })` or shorthand `TUIKit.init({ SDKAppID })`
- **Field name**: `SDKAppID`
- **Value form**: literal, binding, shorthand
- **Authority**: `sdkappid-resolver-sop.md` §2 Tier 2 (frozen from real `chat-uikit-vue` demo repos)

#### Fixtures

```javascript
// POSITIVE: literal property
TUIKit.init({ SDKAppID: 1400000101 });
```

```javascript
// POSITIVE: shorthand binding
const SDKAppID = 1400000102;
TUIKit.init({ SDKAppID });
```

```javascript
// NEGATIVE: in string
TUIKit.init({ help: "SDKAppID: 1400000103" });
```

```javascript
// NEGATIVE: nested object (not top-level field)
TUIKit.init({ config: { SDKAppID: 1400000104 } });
```

```javascript
// NEGATIVE: mutable binding
let SDKAppID = 1400000105;
SDKAppID = getSdkAppId();
TUIKit.init({ SDKAppID });
```

```javascript
// CONFLICT: two different values in same tier
TUIKit.init({ SDKAppID: 1400000106 });
const SDKAppID = 1400000107; TUIKit.init({ SDKAppID });
```

```javascript
// MALFORMED: crossed delimiters
TUIKit.init({ SDKAppID: (1400000108] });
```

---

### R02 · Chat Web · TUIKit Vue template prop

- **Status**: `enabled_existing`
- **Tier**: 2
- **Source type**: `uikit_binding`
- **File pattern**: `.vue`
- **Semantic context**: `TUIKit`
- **Exact shape**: `<TUIKit :SDKAppID="⟨value⟩" />`
- **Field name**: `SDKAppID`
- **Value form**: literal, binding
- **Authority**: `sdkappid-resolver-sop.md` §2 Tier 2 (frozen from real `chat-uikit-vue` demo repos)

#### Fixtures

```vue
<!-- POSITIVE: literal attribute -->
<template><TUIKit :SDKAppID="1400000201" /></template>
```

```vue
<!-- NEGATIVE: template display text (not real component) -->
<template><pre>&lt;TUIKit :SDKAppID="1400000202" /&gt;</pre></template>
```

```vue
<!-- NEGATIVE: in HTML comment -->
<template><!-- <TUIKit :SDKAppID="1400000203" /> --></template>
```

```vue
<!-- CONFLICT: two different values -->
<template>
  <TUIKit :SDKAppID="1400000204" />
  <TUIKit :SDKAppID="1400000205" />
</template>
```

```vue
<!-- MALFORMED: unclosed tag -->
<template><TUIKit :SDKAppID="1400000206" </template>
```

---

### R03 · Chat Web · useLoginStore destructured login

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.js`, `.ts`, `.jsx`, `.tsx`, `.vue` (script block only)
- **Semantic context**: `useLoginStore`
- **Exact shape**: `const { login } = useLoginStore()` → `login({ sdkAppID: ⟨value⟩ })`; or chained `useLoginStore().login({ sdkAppID: ⟨value⟩ })`
- **Field name**: `sdkAppID`
- **Value form**: literal, binding, shorthand
- **Authority**: `knowledge-base/slices/chat/web/login-auth.md` lines 37–46

#### Support boundary

- Destructuring: `const { login } = useLoginStore()` → `login(...)` ✓
- Alias: `const { login: loginIM } = useLoginStore()` → `loginIM(...)` ✓
- Chained: `useLoginStore().login(...)` ✓
- Cross-file import of destructured function: ✗ (not supported)
- Reassignment after destructuring: ✗ (rejected)

#### Fixtures

```typescript
// POSITIVE: destructured (primary real-world pattern)
import { useLoginStore } from 'tuikit-atomicx-vue3/chat';
const { login } = useLoginStore();
await login({ sdkAppID: 1400000301, userID: 'u1', userSig: 's1' });
```

```typescript
// POSITIVE: chained
useLoginStore().login({ sdkAppID: 1400000302, userID: 'u1', userSig: 's1' });
```

```typescript
// POSITIVE: shorthand binding
const sdkAppID = 1400000303;
const { login } = useLoginStore();
await login({ sdkAppID, userID, userSig });
```

```typescript
// NEGATIVE: expression value
const { login } = useLoginStore();
login({ sdkAppID: Number(process.env.SDKAPPID), userID, userSig });
```

```typescript
// NEGATIVE: no useLoginStore context (unrelated login)
import { login } from './auth';
login({ sdkAppID: 1400000304, token: 'xxx' });
```

```typescript
// NEGATIVE: in string
const docs = "useLoginStore().login({ sdkAppID: 1400000305 })";
```

```typescript
// CONFLICT: two different values
const { login } = useLoginStore();
login({ sdkAppID: 1400000306 });
login({ sdkAppID: 1400000307 });
```

```typescript
// MALFORMED: unclosed object
const { login } = useLoginStore();
login({ sdkAppID: 1400000308, userID
```

---

### R04 · Chat/Live · LoginStore.shared.login (JS/TS positional)

- **Status**: `legacy_pending_evidence`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.ts`, `.js`, `.tsx`, `.jsx`, `.mjs`, `.cjs`
- **Semantic context**: `LoginStore`
- **Exact shape**: `LoginStore.shared.login(context, ⟨sdkAppID⟩, userID, userSig)` — second positional arg
- **Field name**: (positional)
- **Value form**: literal, binding
- **Authority**: `sdkappid-resolver-sop.md` §2 Tier 2 (frozen in C17; no real JS/TS product code found in this repo — only test fixtures use this shape. Real Web apps use `useLoginStore` R03 instead. Swift/iOS version exists as R15.)
- **Note**: Retain existing C17 implementation. Do not extend in C18. If no real-world JS/TS product evidence found by C18.3, evaluate removal.

#### Fixtures

```typescript
// POSITIVE: same-file const (as tested in C17)
const SDK_APP_ID = 1400000401;
LoginStore.shared.login(context, SDK_APP_ID, userID, userSig);
```

```typescript
// NEGATIVE: first arg is not context
LoginStore.shared.login("context, 1400000402, userID, userSig", other);
```

---

### R05 · Conference Web · conference.login (RoomKit official)

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.js`, `.ts`, `.jsx`, `.tsx`, `.vue` (script block only)
- **Semantic context**: `TUIRoomKit` OR `roomkit`
- **Exact shape**: `conference.login({ sdkAppId: ⟨value⟩, userId, userSig })`
- **Field name**: `sdkAppId`
- **Value form**: literal, binding, shorthand
- **Package allowlist**: `@tencentcloud/roomkit-web-vue3`, `@tencentcloud/roomkit-web-react` — exact names; no wildcards; other roomkit-like packages are negative
- **Import required**: yes — `conference` must be imported or destructured from a package in the allowlist
- **Authority**: `knowledge-base/slices/conference/web/official-roomkit-api.md` (`conference.login({ sdkAppId: number, userId: string, userSig: string })`)

#### Support boundary

- `import { conference } from '@tencentcloud/roomkit-web-vue3'` or `'@tencentcloud/roomkit-web-react'` ✓
- Alias: `import { conference as conf } from '@tencentcloud/roomkit-web-vue3'` → `conf.login(...)` ✓
- Package lookalike (e.g., `@tencentcloud/roomkit-react`, `@tencentcloud/roomkit-web`, unofficial packages): ✗
- `conference` assigned from custom function with no allowlisted import: ✗
- Cross-file import of `conference` binding: ✗ (not supported)

#### Fixtures

```typescript
// POSITIVE: literal
import { conference } from '@tencentcloud/roomkit-web-vue3';
await conference.login({ sdkAppId: 1400000501, userId: 'u1', userSig: 's1' });
```

```typescript
// NEGATIVE: expression (URL param)
const sdkAppId = Number(route.query.sdkAppId);
await conference.login({ sdkAppId, userId, userSig });
```

```typescript
// NEGATIVE: no TUIRoomKit/roomkit context
const conference = createCustomMeeting();
conference.login({ sdkAppId: 1400000502 });
```

```typescript
// CONFLICT: two different literals
await conference.login({ sdkAppId: 1400000503 });
await conference.login({ sdkAppId: 1400000504 });
```

```typescript
// MALFORMED: unclosed brace
await conference.login({ sdkAppId: 1400000505, userId
```

```typescript
// NEGATIVE: import from package lookalike (not in allowlist)
import { conference } from '@tencentcloud/roomkit-react';
await conference.login({ sdkAppId: 1400000506, userId: 'u1', userSig: 's1' });
```

---

### R06 · Conference Web · useLoginState destructured login

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.js`, `.ts`, `.jsx`, `.tsx`, `.vue` (script block only)
- **Semantic context**: `useLoginState`
- **Exact shape**: `const { login } = useLoginState()` → `login({ sdkAppId: ⟨value⟩ })`; or chained
- **Field name**: `sdkAppId`
- **Value form**: literal, binding, shorthand
- **Authority**: `knowledge-base/slices/conference/web/login-auth.md` lines 132–138

#### Support boundary

Same as R03 — destructuring, alias, chained. Cross-file not supported.

#### Fixtures

```typescript
// POSITIVE: destructured
import { useLoginState } from 'tuikit-atomicx-vue3/room';
const { login } = useLoginState();
await login({ sdkAppId: 1400000601, userId: 'u1', userSig: 's1' });
```

```typescript
// POSITIVE: shorthand
const sdkAppId = 1400000602;
const { login } = useLoginState();
await login({ sdkAppId, userId, userSig, scene: 5001 });
```

```typescript
// NEGATIVE: in comment
// const { login } = useLoginState(); login({ sdkAppId: 1400000603 })
```

```typescript
// CONFLICT: two different values
const { login } = useLoginState();
login({ sdkAppId: 1400000604 });
login({ sdkAppId: 1400000605 });
```

```typescript
// MALFORMED: missing closing paren
const { login } = useLoginState();
login({ sdkAppId: 1400000606
```

---

### R07 · RTC Engine Web · client.enterRoom

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.js`, `.ts`, `.jsx`, `.tsx`
- **Semantic context**: `TRTC` AND `enterRoom`
- **Exact shape**: `⟨client⟩.enterRoom({ sdkAppId: ⟨value⟩, ... })` where `⟨client⟩` was assigned from `TRTC.create(...)` in the same file
- **Field name**: `sdkAppId`
- **Value form**: literal, binding
- **Package allowlist**: `trtc-sdk-v5` — exact name. `trtc-sdk-js` and `@tencentcloud/trtc-sdk-js` are **not** in the allowlist (no Authority found for those packages)
- **Import required**: yes — `TRTC` must be a default import (`import TRTC from 'trtc-sdk-v5'`) from the allowlisted package
- **Authority**: `skills/trtc-ai-realtime-interpreter/scenarios/meeting-interpreter/ui/src/composables/useAiInterpreter.ts` lines 2 and 135–142

#### Support boundary

- `import TRTC from 'trtc-sdk-v5'` → `TRTC.create(...)` → `client.enterRoom({ sdkAppId })` ✓
- Alias: `import TrtcSdk from 'trtc-sdk-v5'` → `TrtcSdk.create()` → `client.enterRoom(...)` ✓ (follow binding)
- Default import from any other package (including `trtc-sdk-js`): ✗ (package not in allowlist)
- Named import (`import { TRTC } from 'trtc-sdk-v5'`): ✗ (must be default import)
- Any `.enterRoom()` without `TRTC.create` provenance in same file: ✗
- `const client` reassigned after `TRTC.create()`: ✗ (binding must remain constant)

#### Fixtures

```typescript
// POSITIVE: standard pattern
import TRTC from 'trtc-sdk-v5';
const client = TRTC.create({ assetsPath: '...' });
await client.enterRoom({ sdkAppId: 1400000701, userId: 'u1', userSig: 's1', roomId: 123 });
```

```typescript
// POSITIVE: same-file const
import TRTC from 'trtc-sdk-v5';
const sdkAppId = 1400000702;
const trtc = TRTC.create();
await trtc.enterRoom({ sdkAppId, userId, userSig, roomId });
```

```typescript
// NEGATIVE: environment variable
import TRTC from 'trtc-sdk-v5';
const client = TRTC.create();
await client.enterRoom({ sdkAppId: process.env.TRTC_SDKAPPID, userId, userSig });
```

```typescript
// NEGATIVE: no TRTC.create provenance
import TRTC from 'trtc-sdk-v5';
const client = createCustomClient();
await client.enterRoom({ sdkAppId: 1400000703, userId, userSig });
```

```typescript
// CONFLICT: two enterRoom with different values
import TRTC from 'trtc-sdk-v5';
const client = TRTC.create();
await client.enterRoom({ sdkAppId: 1400000704, roomId: 1 });
await client.enterRoom({ sdkAppId: 1400000705, roomId: 2 });
```

```typescript
// MALFORMED: unclosed object in enterRoom
import TRTC from 'trtc-sdk-v5';
const client = TRTC.create();
await client.enterRoom({ sdkAppId: 1400000706, userId
```

```typescript
// NEGATIVE: TRTC imported from package not in allowlist (trtc-sdk-js)
import TRTC from 'trtc-sdk-js';
const client = TRTC.create();
await client.enterRoom({ sdkAppId: 1400000707, userId: 'u1', userSig: 's1', roomId: 123 });
```

---

### R08 · RTC Engine Web · TRTC.create (forbidden)

- **Status**: `forbidden`
- **Note**: `TRTC.create()` does NOT accept `sdkAppId`. It takes only config like `{ assetsPath }`. SDKAppID is passed to `enterRoom()` (R07). This row prevents false extraction from `TRTC.create()` calls.

---

### R09 · Chat/Conference/Call · Android · GenerateTestUserSig.java

- **Status**: `enabled_existing`
- **Tier**: 1
- **Source type**: `test_usersig`
- **File pattern**: `GenerateTestUserSig.java` (fixed basename)
- **Semantic context**: `GenerateTestUserSig`
- **Exact shape**: `public static final int SDKAPPID = ⟨value⟩;` or `static int SDKAPPID = ⟨value⟩;`
- **Field name**: `SDKAPPID`
- **Value form**: literal
- **Authority**: SOP §11 P0 File Allowlist; §12 Known High-Confidence Examples (TUIKit_Android demo repos)

#### Fixtures

```java
// POSITIVE
public class GenerateTestUserSig {
    public static final int SDKAPPID = 1400000901;
    private static final String SECRETKEY = "...";
}
```

```java
// NEGATIVE: placeholder
public class GenerateTestUserSig { public static int SDKAPPID = 0; }
```

```java
// NEGATIVE: SECRETKEY (forbidden field)
public class GenerateTestUserSig { public static String SECRETKEY = "1400000902"; }
```

---

### R10 · Chat/Conference/Call · iOS · GenerateTestUserSig.swift

- **Status**: `enabled_existing`
- **Tier**: 1
- **Source type**: `test_usersig`
- **File pattern**: `GenerateTestUserSig.swift` (fixed basename)
- **Semantic context**: `GenerateTestUserSig`
- **Exact shape**: `let public_SDKAPPID = ⟨value⟩` or `static let SDKAPPID: Int = ⟨value⟩`
- **Field name**: `public_SDKAPPID` or `SDKAPPID`
- **Value form**: literal
- **Authority**: SOP §11 P0 File Allowlist; §12 Known High-Confidence Examples (Chat_UIKit/Swift demo repos)

#### Fixtures

```swift
// POSITIVE
class GenerateTestUserSig {
    let public_SDKAPPID = 1400001001
}
```

```swift
// NEGATIVE: placeholder
class GenerateTestUserSig { let public_SDKAPPID = 0 }
```

---

### R11 · Chat/Conference/Call · iOS · GenerateTestUserSig.h

- **Status**: `enabled_existing`
- **Tier**: 1
- **Source type**: `test_usersig`
- **File pattern**: `GenerateTestUserSig.h` (fixed basename)
- **Semantic context**: `GenerateTestUserSig`
- **Exact shape**: `static const int SDKAppID = ⟨value⟩;`
- **Field name**: `SDKAppID` or `SDKAPPID`
- **Value form**: literal
- **Authority**: SOP §11 P0 File Allowlist; §12 Known High-Confidence Examples (chat-uikit-ios-main demo)

#### Fixtures

```objectivec
// POSITIVE
// GenerateTestUserSig.h
static const int SDKAppID = 1400001101;
static NSString *const SECRETKEY = @"...";
```

```objectivec
// NEGATIVE: placeholder
static const int SDKAppID = 0; // replace with your SDKAppID
```

---

### R12 · Chat/Call · Flutter · config.dart literal

- **Status**: `enabled_existing`
- **Tier**: 1
- **Source type**: `literal_config`
- **File pattern**: `config.dart` (fixed basename)
- **Semantic context**: `UserSig` OR `genTestUserSig` OR `TUICallKit` OR `TUIKit`
- **Exact shape**: `const sdkappid = ⟨value⟩;`
- **Field name**: `sdkappid`
- **Value form**: literal
- **Authority**: SOP §11 P0 File Allowlist; §12 Known High-Confidence Examples (chat-demo-flutter demo repos)

#### Fixtures

```dart
// POSITIVE
const sdkappid = 1400001201;
String genTestUserSig(String userId) { return ''; }
```

```dart
// NEGATIVE: placeholder
const sdkappid = 0; // your sdkappid
```

---

### R13 · Call · Flutter · TUICallKit.instance.login (positional)

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.dart`
- **Semantic context**: `TUICallKit`
- **Exact shape**: `TUICallKit.instance.login(⟨sdkAppId⟩, userId, userSig)` — first positional arg
- **Field name**: (positional — first arg)
- **Value form**: literal, binding (same-file immutable)
- **Authority**: `skills/trtc-call/templates/lib/trtc_call/call_service.dart` line 31

#### Fixtures

```dart
// POSITIVE: literal
await TUICallKit.instance.login(1400001301, userId, userSig);
```

```dart
// POSITIVE: same-file const
const sdkAppId = 1400001302;
await TUICallKit.instance.login(sdkAppId, userId, userSig);
```

```dart
// NEGATIVE: cross-file expression
await TUICallKit.instance.login(TrtcCallBootstrap.sdkAppId!, userId, userSig);
```

```dart
// NEGATIVE: runtime expression
await TUICallKit.instance.login(int.parse(envSdkAppId), userId, userSig);
```

```dart
// CONFLICT: two different literals
await TUICallKit.instance.login(1400001303, userId, userSig);
await TUICallKit.instance.login(1400001304, userId, userSig);
```

```dart
// MALFORMED: unclosed parenthesis
await TUICallKit.instance.login(1400001305, userId
```

```dart
// NEGATIVE: wrong method name — must not extract
await TUICallKit.instance.init(1400001306, userId, userSig);
```

```dart
// NEGATIVE: function-local const — must not extract (out of scope for login call in different function)
void setup() {
  const sdkAppId = 1400001307;
}
void loginUser() {
  await TUICallKit.instance.login(sdkAppId, userId, userSig);
}
```

---

### R14-JS · Server · TLSSigAPIv2 constructor (JavaScript)

- **Status**: `enabled_existing`
- **Tier**: 3
- **Source type**: `server_sig`
- **File pattern**: `TLSSigAPIv2.js` (fixed basename)
- **Semantic context**: `TLSSigAPIv2`
- **Exact shape**: `new TLSSigAPIv2(⟨sdkAppID⟩, secretKey)` — first positional arg
- **Field name**: (positional)
- **Value form**: literal
- **Authority**: SOP §2 Tier 3, §11 P0 File Allowlist (frozen from real TRTC server SDK repos)

#### Fixtures

```javascript
// POSITIVE
const api = new TLSSigAPIv2(1400001401, "secretkey");
```

```javascript
// NEGATIVE: in string
const usage = "new TLSSigAPIv2(1400001402, key)";
```

---

### R14-PY · Server · TLSSigAPIv2 constructor (Python)

- **Status**: `enabled_existing`
- **Tier**: 3
- **Source type**: `server_sig`
- **File pattern**: `TLSSigAPIv2.py` (fixed basename)
- **Semantic context**: `TLSSigAPIv2`
- **Exact shape**: `TLSSigAPIv2(⟨sdkappid⟩, key)` — class constructor, first positional arg
- **Field name**: (positional)
- **Value form**: literal
- **Authority**: `skills/trtc-ai-oral-coach/capabilities/conversation-core/src/TLSSigAPIv2.py` line 34 (`def __init__(self, sdkappid, key)`)

#### Fixtures

```python
# POSITIVE
api = TLSSigAPIv2(1400001411, "secretkey")
```

```python
# NEGATIVE: in docstring
"""Usage: TLSSigAPIv2(1400001412, key)"""
class TLSSigAPIv2: pass
```

```python
# NEGATIVE: escaped triple-quote still docstring
"""doc \"\"\" still doc TLSSigAPIv2(1400001413, key)"""
class TLSSigAPIv2: pass
```

---

### R14-JAVA · Server · TLSSigAPIv2 constructor (Java)

- **Status**: `legacy_pending_evidence`
- **Tier**: 3
- **Source type**: `server_sig`
- **File pattern**: `TLSSigAPIv2.java` (fixed basename)
- **Semantic context**: `TLSSigAPIv2`
- **Exact shape**: `new TLSSigAPIv2(⟨sdkAppID⟩, key)` — constructor first arg
- **Field name**: (positional)
- **Value form**: literal
- **Authority**: SOP §11 P0 File Allowlist (no local Java source in this repo to verify exact constructor signature)

---

### R14-PHP · Server · TLSSigAPIv2 constructor (PHP)

- **Status**: `legacy_pending_evidence`
- **Tier**: 3
- **Source type**: `server_sig`
- **File pattern**: `TLSSigAPIv2.php` (fixed basename)
- **Semantic context**: `TLSSigAPIv2`
- **Exact shape**: `new TLSSigAPIv2(⟨sdkAppID⟩, $key)` — constructor first arg
- **Field name**: (positional)
- **Value form**: literal
- **Authority**: SOP §11 P0 File Allowlist (no local PHP source in this repo)

---

### R14-GO · Server · TLSSigAPITest (Go)

- **Status**: `legacy_pending_evidence`
- **Tier**: 3
- **Source type**: `server_sig`
- **File pattern**: `TLSSigAPITest.go` (fixed basename)
- **Semantic context**: `TLSSigAPIv2`
- **Exact shape**: `GenSig(⟨sdkAppID⟩, key, ...)` — function first arg (Go uses function, not constructor)
- **Field name**: (positional)
- **Value form**: literal
- **Authority**: SOP §2 Tier 3 (frozen; no local Go source in this repo)

---

### R15 · Live · iOS · LoginStore.shared.login (Swift named parameter)

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.swift`
- **Semantic context**: `LoginStore`
- **Exact shape**: `LoginStore.shared.login(sdkAppID: ⟨value⟩, userID: ..., userSig: ..., completion: ...)`
- **Field name**: `sdkAppID` (Swift named parameter, type `Int32`)
- **Value form**: literal (Int32), binding (same-file immutable)
- **Authority**: `knowledge-base/slices/live/ios/login-auth.md` lines 29–30, 70, 172

#### Fixtures

```swift
// POSITIVE: literal Int32
LoginStore.shared.login(sdkAppID: 1400001501,
                        userID: "user1",
                        userSig: "sig1",
                        completion: nil)
```

```swift
// POSITIVE: same-file const
let sdkAppID: Int32 = 1400001502
LoginStore.shared.login(sdkAppID: sdkAppID, userID: uid, userSig: sig, completion: nil)
```

```swift
// NEGATIVE: expression
LoginStore.shared.login(sdkAppID: Int32(envValue)!, userID: uid, userSig: sig, completion: nil)
```

```swift
// CONFLICT: two different literals
LoginStore.shared.login(sdkAppID: 1400001503, userID: "a", userSig: "s", completion: nil)
LoginStore.shared.login(sdkAppID: 1400001504, userID: "b", userSig: "s2", completion: nil)
```

```swift
// MALFORMED: unclosed paren
LoginStore.shared.login(sdkAppID: 1400001505, userID: "a"
```

---

### R16 · Conversational AI · Server config · TRTC_SDK_APP_ID

- **Status**: `research_required`
- **Tier**: 1
- **Source type**: `literal_config`
- **File pattern**: `.env`, `.env.example`, `credentials.py`, or backend config
- **Semantic context**: `TRTC` or `SDK_APP_ID`
- **Exact shape**: `TRTC_SDK_APP_ID=⟨value⟩` (.env) or `sdk_app_id = ⟨value⟩` (Python config)
- **Field name**: `TRTC_SDK_APP_ID` or `sdk_app_id`
- **Value form**: literal only
- **Authority**: Backend `.env` and credentials patterns in Conversational AI scenarios (real project survey needed to confirm static vs always-fetched)
- **Note**: Web frontend's `enterRoom({ sdkAppId: state.sdkAppId })` uses a runtime variable from `/api/v1/get_config` — not statically extractable. This rule targets the server-side `.env` / config source where the value originates as a literal. Needs verification that real deployments store this as a file literal rather than injecting via orchestration.

---

### R17 · TIMPush · Android · registerPush (positional)

- **Status**: `research_required`
- **Tier**: 2
- **Source type**: `runtime_call`
- **File pattern**: `.java`, `.kt`
- **Semantic context**: `TIMPush` OR `registerPush`
- **Exact shape**: `registerPush(context, ⟨sdkAppId⟩, appKey, callback)` — second positional arg (int)
- **Field name**: (positional — second arg)
- **Value form**: literal, binding
- **Authority**: `skills/trtc-push/references/timpush-sdk-api.md` line 24 (`registerPush(Context, int sdkAppId, String appKey, TIMPushCallback callback)`); `skills/trtc-push/references/hard-rules.md` line 24 (Chat SDKAppID must match TIMPush SDKAppID)
- **Note**: Typically uses the same SDKAppID as Chat. In practice, projects using TIMPush already have `GenerateTestUserSig.java` (R09). R17 provides an additional extraction path if R09 is absent. Needs real project verification.

### R18 · Cross-product Web · Generic TRTC config context fallback

- **Status**: `verified_pending`
- **Tier**: 2
- **Source type**: `literal_config`
- **File pattern**: `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`, `.vue`
- **Semantic context**: strong project config names (`trtcConfig`, `rtcConfig`, `trtcOptions`, `rtcOptions`, `trtcSettings`, `rtcSettings`, and equivalent `tui*` names), or an executable TRTC/TUIKit/TUICallKit/TUILiveKit/TUIRoomKit/RoomKit context within eight logical code lines
- **Exact shape**: `const trtcConfig = { sdkAppId: ⟨value⟩ }`, `trtcConfig.sdkAppId = ⟨value⟩`, or a generic `config`/`options` object or member assignment only when the same file contains the executable context window
- **Field name**: `sdkAppId`, `SDKAppID`, `sdkappid`, `SDKAPPID`, `SDK_APP_ID`, or `sdk_app_id`
- **Value form**: numeric literal or same-file immutable `const` binding; dynamic expressions, environment lookups, and cross-file values are not extracted
- **Conflict rule**: multiple distinct valid values in the same scan produce `conflict`; repeated copies of one value resolve normally
- **Authority**: `knowledge-base/resolvers/sdkappid-resolver-sop.md` §14 (generic config fallback constrained by the resolver safety rules)
- **Note**: This is a fallback after R01–R07. It is intentionally not a line-based search: comments and strings do not provide context, and a bare `config.sdkAppId` without a nearby executable TRTC signal is ignored.

#### Fixtures

```typescript
// POSITIVE: strong TRTC config object
const trtcConfig = { sdkAppId: 1400001801 };
```

```typescript
// POSITIVE: generic config with nearby executable TRTC context and immutable binding
const sdkAppId = 1400001802;
const config = { sdkAppId };
TRTC.create();
```

```typescript
// NEGATIVE: generic config has no executable TRTC context
const config = { sdkAppId: 1400001803 };
```

```typescript
// NEGATIVE: a comment/string mention is not context
const config = { sdkAppId: 1400001804 };
const note = 'TRTC.create() is documented here';
```

```typescript
// CONFLICT: two distinct generic values
const trtcConfig = { sdkAppId: 1400001805 };
const rtcOptions = { SDKAppID: 1400001806 };
```

```typescript
// MALFORMED: crossed delimiters
const trtcConfig = { sdkAppId: (1400001807] };
```

---

## 5. Semantic Context Tokens

### Currently enabled (C17)

`GenerateTestUserSig`, `genTestUserSig`, `UserSig`, `TLSSigAPIv2`, `genSig`, `LoginStore`, `TUIKit`, `TUICallKit`, `TUILiveKit`, `TUIRoomKit`

### Required for C18 new rules

| Token | Required by | Note |
|-------|------------|------|
| `useLoginStore` | R03 | |
| `useLoginState` | R06 | |
| `roomkit` | R05 | Alternative to existing `TUIRoomKit` |
| `enterRoom` (with `TRTC`) | R07 | Both must be present |
| `sdkAppId`, `SDKAppID`, `sdkappid`, `SDKAPPID`, `SDK_APP_ID`, `sdk_app_id`, `trtcConfig`, `rtcConfig`, `trtcOptions`, `rtcOptions`, `trtcSettings`, `rtcSettings` | R18 | Prefilter only; structured adapter applies the executable-context and immutable-binding checks |

---

## 6. Electron

Electron apps use Web SDK packages. Rules R01–R07 apply. No separate shapes needed.

---

## 7. C17 → C18 Gap Summary

| Rule | Gap description |
|------|-----------------|
| R03 | New `useLoginStore` context + destructuring support |
| R05 | New `roomkit` context + `conference.login` object field |
| R06 | New `useLoginState` context + destructuring support |
| R07 | New `enterRoom` context + TRTC.create provenance |
| R13 | New Dart `TUICallKit.instance.login` positional arg |
| R15 | Live iOS Swift named-parameter `LoginStore.shared.login(sdkAppID:)` |
| R04 | No real JS/TS project evidence; retain existing only |
| R18 | Generic project-owned Web config fallback for non-standard initialization files |
