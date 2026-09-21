# UserSig Handling (Conference Web)

> Referenced during login code generation in A2-Q2 / A2-Q3 (login-auth slice),
> official-roomkit completion, and A1 (demo credentials).
>
> Conference Web supports **three** `usersig_source` branches (from business_decisions):
>
> | Value | Dev use | Login UI |
> |-------|---------|----------|
> | `local-dev` | Config + bundled signing lib | UserID only → `getBasicInfo(userId)` |
> | `console` | Paste test UserSig from TRTC console | UserID + SDKAppID + UserSig inputs |
> | `backend` | Production | UserID + API-fetched userSig |
>
> **Production** MUST use `backend`. `local-dev` and `console` are for development only.

---

## Path A — `local-dev`（config 本地自动签名，推荐）

Uses the bundled signing lib:

```
skills/trtc-conference/references/local-usersig/
```

| File | Purpose |
|------|---------|
| `basic-info-config.ts` | `SDKAPPID`, `SDKSECRETKEY`, `getBasicInfo(userId)` |
| `lib-generate-test-usersig-es.min.js` | Tencent test UserSig signer (dev only) |
| `lib-generate-test-usersig-es.min.d.ts` | TypeScript declarations |

### A2-Q2 (local-dev)

**短路**：若 session 已有 root 层写入的 `sdkappid`（非 null 非 0，由 root `flows/collect-sdkappid.md` 收集）—— SDKAppID 已收到，不再问；直接把 session 的 `sdkappid` 写入 `credentials.sdkappid` + `src/config/basic-info-config.ts` 的 `SDKAPPID`。**只需 Ask SecretKey**（写入 `basic-info-config.ts` 的 `SDKSECRETKEY`，**永不**写入 `.trtc-session.yaml`）。

未短路（session 无 sdkappid，作为 fallback）时走以下完整流程：

Ask **SDKAppID** + **SecretKey** (控制台 → 应用管理 → 应用信息).

- Write `SDKAPPID` to `credentials.sdkappid` in session (reporting).
- Write both into `src/config/basic-info-config.ts` — **never** persist SecretKey in `.trtc-session.yaml`.

### Login UI

UserID (+ meeting id). On submit: `login(getBasicInfo(userId))`.

```typescript
import { getBasicInfo } from '@/config/basic-info-config';
await login(getBasicInfo(userId));
```

### Handoff

```
1. 控制台复制 SDKAppID + SecretKey → 填入 src/config/basic-info-config.ts
2. 登录页输入 UserID（如 user001）— userSig 自动按 UserID 生成
⚠️ SecretKey 仅本地调试；生产请后端签发。
```

---

## Path B — `console`（控制台获取 UserSig 后粘贴）

Original flow — **retained**. User generates UserSig in TRTC console and pastes it.

### A2-Q2 (console)

**短路**：若 session 已有 root 层写入的 `sdkappid`（由 root `flows/collect-sdkappid.md` 收集）—— 直接采用，无需再问；生成代码时将 `SDK_APP_ID` 常量填入 session 的 sdkappid。**登录页仍需 UserSig 输入**（UserSig 与 SDKAppID 是两个独立凭证，UserSig 从控制台粘贴，与本节短路无关）。

未短路（session 无 sdkappid，作为 fallback）时：

Ask **SDKAppID** only (same as before). Do not collect SecretKey.

### Generated code

```typescript
const SDK_APP_ID = {sdkAppId};
const USER_ID = 'user001';
const USER_SIG = 'YOUR_USERSIG';  // ← paste from TRTC console
```

Login form MUST include:

- UserID input (pre-fill `user001`)
- SDKAppID input (pre-fill if known)
- UserSig input (`type="password"`) — empty or placeholder

**Pairing rule (MUST surface in UI):**

> UserSig 是按 **UserID** 在控制台签发的，两者必须一一对应。
> 在「UserSig 生成&校验」里填写的 UserID 必须与登录页一致。

### Handoff — 如何获取并填入 UserSig

```
⚠️ 还差一步才能登录：代码里的 userSig 是占位符，需从控制台获取。

1. 打开 https://console.trtc.io/（国内站 https://console.cloud.tencent.com）
2. 进入「快速跑通 / UserSig 生成&校验」
3. 输入与登录页相同的 UserID（如 user001）生成 UserSig
4. 将 userSig 填入 <文件路径> 的 USER_SIG / 登录表单 UserSig 框
   SDKAppID 填入 <文件路径> 的 SDK_APP_ID / SDKAppID 框

注意：控制台 userSig 仅开发联调，会过期；生产环境必须由后端签发。
```

Do **not** copy the signing bundle for `console`.

---

## Path C — `backend`（生产）

- No signing bundle, no SecretKey in client.
- Emit `fetch('/api/conference/usersig')` skeleton + TODO.
- `userSig` from API response at login time.

---

## Shared rules

### Never

- Call any `get_usersig` MCP tool.
- Hand-roll with `crypto-js` / `pako` / `HmacSHA256` / custom `src/utils/usersig.ts`
  (outside the bundled lib for `local-dev` only).
- Present dev paths as production-ready.

### Allowed

| Branch | Allowed |
|--------|---------|
| `local-dev` | `SDKSECRETKEY` in `basic-info-config.ts` + bundled `lib-generate-test-usersig-es.min` |
| `console` | Placeholder `YOUR_USERSIG` + login form paste fields; no SecretKey |
| `backend` | API skeleton only; no SecretKey |

### Branch self-check

| `usersig_source` | Expect | Forbid |
|------------------|--------|--------|
| `local-dev` | `getBasicInfo`, signing lib in `src/config/` | UserSig input on login page |
| `console` | UserSig + SDKAppID inputs, `YOUR_USERSIG` placeholder | Signing bundle, `SDKSECRETKEY` |
| `backend` | fetch skeleton | Signing bundle, SecretKey, UserSig placeholder as final value |
