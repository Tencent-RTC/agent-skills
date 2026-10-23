# AGENTS.md

Instructions for AI coding assistants working on this project.

## A. Safety red lines

1. **Secrets never leave `server/`**: `TRTC_SDK_SECRET_KEY`,
   `TENCENT_CLOUD_SECRET_KEY`, and `LLM_API_KEY` must not appear in any file
   under `web/`, in Vite env prefixed with `VITE_`, or in browser-visible code.
   **`.env` protection is not guaranteed here.** The published package does
   not carry a `.gitignore` (npm strips files with that exact name), so a
   landed copy of this template may have none. Before writing any real key,
   run `git check-ignore -v .env`; if it prints nothing, add `.env` to the
   enclosing project's `.gitignore` first. Never force-add it.
2. **UserSig is computed in `server/src/tencent/userSig.ts`** and served via
   `GET /userSig`. Never compute UserSig in the browser.
3. **Webhook endpoint requires signature verification**: `server/src/tencent/webhook.ts`
   implements `verifyTencentSignature`. Do not remove or bypass this check.
4. **Never log secrets**: the logger in `server/src/logger.ts` redacts fields
   ending in `_KEY`, `_SECRET`, or `_TOKEN`.

## C. Architecture conventions

1. **All Tencent Cloud REST API calls go through `server/src/tencent/client.ts`**.
   Never write TC3-HMAC-SHA256 signing inline in a route handler.
2. **Switching STT / LLM / TTS provider** = edit `.env` → `POST /agent/stop`
   → `POST /agent/start`. Do NOT use `UpdateAIConversation` to swap providers
   at runtime — that API is for prompt and context updates only.
3. **Prefer webhook events over polling `/agent/status`**. `DescribeAIConversation`
   is not implemented by default; if you need it, add a new route rather than
   polling from the frontend.
4. **Custom message protocol**:
   - Bot → client: `cmdID=1`
     - type 10000 = subtitle  `{text: string, end: boolean}`
     - type 10001 = status    `{state: 1=listening 2=thinking 3=speaking 4=interrupted}`
     - type 10020 = metric    LLM / TTS / STT latency per turn (doc 68334)
     - type 10030 = error     Bot-side errors (doc 68335)
   - Client → bot: `cmdID=2`
     - type 20000 = push text `{message: string}`
     - type 20001 = interrupt  (no payload)
   See `web/src/hooks/useCustomMessage.ts` for the parsing implementation.
5. **`startLocalAudio` profile**: use the default `TRTC.TYPE.AUDIO_PROFILE_STANDARD`
   for voice agent scenarios (40 kbps mono, low latency). Do not pass `profile: 'speech'`
   — that string is not a valid value in TRTC Web SDK v5. For denoising, use the
   separate `AIDenoiser` plugin if needed.
   **Muting**: use `trtc.updateLocalAudio({ mute: true/false })` — there is no
   `muteLocalAudio` method in v5.
6. **Room ID is a numeric room passed as a digits-only string.** The
   `StartAIConversation` `RoomId` field is a **string** (e.g. `"1234567"`) and
   the payload always sets `RoomIdType: 0` (numeric room), so the value must be
   1–10 digits, no leading zero, ≤ 4294967294. Server routes validate with
   `numericRoomId` + `isRoomIdInRange` (`server/src/routes/schemas.ts`); the
   browser passes the same digits and the SDK's `enterRoom` converts them with
   `parseInt`. TRTC treats string room `"123"` and numeric room `123` as
   different rooms — string rooms mean `RoomIdType: 1`, out of scope here.
7. **Bot userId convention**: this template uses `robot_${nanoid(6)}` as the
   `AgentConfig.UserId` (e.g. `robot_x7k2m9`). The `robot_` prefix follows TRTC
   sample conventions; the random suffix ensures uniqueness per session. The raw
   `StartAIConversation` API has no enforced format requirement.
8. **TRTC client SDK**: use `trtc-sdk-v5`. Do not use the older `trtc-js-sdk`
   (v4) package — its API surface is different.

## D. File and dependency conventions

1. **Adding a new server route**: create `server/src/routes/<name>.ts`, register
   in `server/src/index.ts`, and update `.env.example` (template root) if new env vars
   are introduced.
2. **Adding a dependency**: install in the correct workspace —
   `pnpm --filter web add <pkg>` or `pnpm --filter server add <pkg>`.
   Never install at the workspace root unless it is a shared dev tool.
3. **Do not restructure `server/` or `web/` directories**. The starter kit
   publishes updates and expects this layout — restructuring blocks the upgrade path.
4. **UI styling** (`web/src/`): light theme only, no dark mode; colours only
   via the `var(--…)` tokens in `web/src/styles/tokens.css` — no hex / `rgb()` /
   `hsl()` literals elsewhere, add a token first; system font stack, no web
   fonts; no emoji in the UI. `pnpm --filter web test` fails on violations.

## E. Common tasks

| Task | Where |
|---|---|
| Add a new backend endpoint | `server/src/routes/<name>.ts` |
| Change subtitle display | `web/src/components/SubtitleStream.tsx` |
| Integrate a custom LLM | `server/src/config/providers.ts` → `buildLLMConfig()` |
| Handle webhook events | `server/src/routes/webhook.ts` (event switch) |
| Change default voice | `.env` → `TTS_VOICE_ID` — a voice of the current `TTS_PROVIDER` (Flow: https://trtc.io/document/79682). Optional for flow; required for minimax / azure / elevenlabs / cartesia / inworld (`/agent/start` → 400 `TTS_VOICE_ID_REQUIRED`). Logic: `server/src/config/voice.ts` |
| Add environment variables | `.env.example` + `server/src/env.ts` (zod schema) |
| Verify credentials | `pnpm verify` |
| Switch provider | `pnpm switch-provider --category tts --to minimax` |

## F. Information sources

- Full TRTC Conversational AI docs index: https://trtc.io/llms/conversational-ai.txt
- Error code lookup / pricing / quota: if your IDE has TRTC skills installed,
  use the `trtc-docs` skill for authoritative answers
- Key API references:
  - `StartAIConversation` → https://trtc.io/document/64963.md
  - `StopAIConversation` → https://trtc.io/document/65296.md
  - Subtitle callback → https://trtc.io/document/68333.md
  - Status callback → https://trtc.io/document/68332.md
  - Server Webhook → https://trtc.io/document/68331.md

---

If any convention here conflicts with a direct user instruction, follow the user.
