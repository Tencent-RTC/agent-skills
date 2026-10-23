---
name: provider-config
description: Per-provider required .env keys and config field reference for LLM / STT / TTS switching in trtc-voice-ai-starter
metadata:
  type: reference
---

# Provider Configuration Reference

Quick lookup for the exact `.env` keys needed when switching providers.
After any change: restart server + restart agent (see SKILL.md §10).

---

## LLM Providers

All providers use OpenAI-compatible protocol (`LLMType: "openai"` in buildLLMConfig).
There is no default provider — the user fills in the one they already use.

| Provider | `LLM_API_URL` | `LLM_MODEL` example |
|---|---|---|
| Hunyuan | https://hunyuan.cloud.tencent.com/openai/v1/chat/completions | hunyuan-2.0-instruct-20251111 |
| OpenAI | https://api.openai.com/v1/chat/completions | gpt-4o-mini |
| DeepSeek | https://api.deepseek.com/chat/completions | deepseek-chat |
| Azure OpenAI | https://<resource>.openai.azure.com/openai/deployments/<deploy>/chat/completions?api-version=2024-02-01 | gpt-4o |
| MiniMax | https://api.minimax.chat/v1/text/chatcompletion_v2 | MiniMax-Text-01 |
| Qwen | https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions | qwen-turbo |
| Doubao | https://ark.cn-beijing.volces.com/api/v3/chat/completions | <endpoint-id> |

Required `.env` keys (all providers):
```
LLM_API_KEY=
LLM_API_URL=
LLM_MODEL=
```

---

## STT Providers

Source: https://trtc.io/document/68336

### tencent (default)
No extra keys needed.
```
STT_PROVIDER=tencent
STT_LANGUAGE=en     # one primary language per task, see the enum below
```

#### Changing the recognition language

Triggered by SKILL.md §10 for a language change (edit `.env` directly; not a `switch-provider.mjs` category). Do all four steps, in
order — the user asks for one thing and gets three silent side effects otherwise.

**1. Write `STT_LANGUAGE`** — it is passed straight through to
`STTConfig.Language`, so an unsupported code is not rejected: recognition just
degrades or returns nothing. Only these 28 codes are accepted:

```
zh yue en ar de fr es pt id it ko ru th vi ja tr hi ms nl sv da fi pl cs fil fa el hu
```

One primary language per task. There is no auto-detect, and no
multi-language mode. For anything outside the list, switch the provider:
`azure` and `deepgram` cover far more languages (see below).

**2. Rewrite `AGENT_GREETING` in the same language.** It is spoken verbatim
before the user says anything, so leaving `Hello, how can I help you today?`
means the agent opens in English and only switches once the user replies. Tell
the user you changed it.

**3. Check the TTS voice.** `TTS_VOICE_ID` picks the timbre, not the language.
Only Flow has a fallback (`DEFAULT_VOICE_IDS` in `server/src/config/voice.ts`:
`zh` → Chinese voice, anything else → English voice), and Quick Start writes
`TTS_VOICE_ID=v-female-p9Xy7Q1L` explicitly anyway, so after a language change
the voice is usually still the English one. The server does not warn about this
— telling the user is your job in this step.

What to do depends on the provider:

| `TTS_PROVIDER` | Language source | Action |
|---|---|---|
| `flow`, `azure` | Explicit `Language` field, set from `STT_LANGUAGE` | Keep the current voice — pronunciation follows `STT_LANGUAGE`; only the timbre stays the same. Flow has no ja/ko/fr/de/es voices (only zh / en / yue), so there is nothing better to switch to. Tell the user this and that a native-timbre voice needs `azure` or another provider |
| `minimax`, `elevenlabs`, `cartesia`, `inworld` | The voice itself — no language field is sent | `TTS_VOICE_ID` **must** be that provider's voice that speaks the new language. Ask the user to pick one from that provider's voice library; do not guess an ID. If it is unset, `/agent/start` returns 400 `TTS_VOICE_ID_REQUIRED` |
| `custom` | Your own TTS server | No voice field is sent; the language and voice are configured on that server |

**4. Restart the server.** `tsx watch` reloads `src/` but **not** `.env`;
without a restart the old language stays active. Restart as in SKILL.md §10
step 5, then restart any live session
(`POST /agent/stop` → `POST /agent/start`) and confirm to the user in their
language.

### azure
Doc: https://trtc.io/document/68336
```
STT_PROVIDER=azure
STT_API_KEY=<SubscriptionKey>     # from Azure Portal
STT_AZURE_REGION=eastus           # e.g. eastus, southeastasia, westeurope
STT_LANGUAGE=en
```

### deepgram
Doc: https://trtc.io/document/79674
```
STT_PROVIDER=deepgram
STT_API_KEY=<ApiKey>
STT_MODEL=nova-3                  # or nova-2
STT_LANGUAGE=en
```

### soniox
Doc: https://trtc.io/document/79675
```
STT_PROVIDER=soniox
STT_API_KEY=<ApiKey>
STT_MODEL=stt-rt-v4
STT_LANGUAGE=en
```

---

## TTS Providers

Source: https://trtc.io/document/68340

### flow (default, TRTC built-in)
Doc: https://trtc.io/document/79682 — No external account needed.
```
TTS_PROVIDER=flow
TTS_VOICE_ID=v-female-p9Xy7Q1L   # English female (Articulate Narrator)
```

Selected voice IDs:
| Language | Gender | Voice ID |
|---|---|---|
| English | Female | v-female-p9Xy7Q1L |
| English | Male | v-male-A4b9KqP2 |
| Chinese | Female | female-kefu-xiaoyue |
| Chinese | Male | male-kefu-xiaoxu |

Full list: https://trtc.io/document/79682

### minimax
Doc: https://trtc.io/document/79683
```
TTS_PROVIDER=minimax
TTS_API_KEY=<APIKey>
TTS_API_URL=https://api.minimax.chat/v1/t2a_v2
TTS_MINIMAX_GROUP_ID=<GroupId>
TTS_VOICE_ID=<VoiceType>          # e.g. female-tianmei
```

### azure
Doc: https://trtc.io/document/79686
```
TTS_PROVIDER=azure
TTS_AZURE_SUBSCRIPTION_KEY=<SubscriptionKey>
TTS_AZURE_REGION=eastus
TTS_VOICE_ID=en-US-AmandaMultilingualNeural   # VoiceName
```

### elevenlabs
Doc: https://trtc.io/document/79690
```
TTS_PROVIDER=elevenlabs
TTS_API_KEY=<APIKey>
TTS_VOICE_ID=<VoiceId>            # from ElevenLabs Voice Library
```

### cartesia
Doc: https://trtc.io/document/79685
```
TTS_PROVIDER=cartesia
TTS_API_KEY=<APIKey>
TTS_VOICE_ID=<VoiceId>            # from Cartesia Voice Library
```

### inworld
Doc: https://trtc.io/document/79689
```
TTS_PROVIDER=inworld
TTS_API_KEY=<APIKey>
TTS_VOICE_ID=<VoiceId>
```

### custom
```
TTS_PROVIDER=custom
TTS_API_KEY=<APIKey>
TTS_API_URL=<your TTS endpoint>
```
