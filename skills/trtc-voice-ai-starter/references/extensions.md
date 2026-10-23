# Extension Capabilities

Loaded from SKILL.md §11 when the user asks about something outside the main
Quick Start / Integrate path.

## Code changes in Path A (Quick Start)

Quick Start only edits `.env`. The §14 File Write Whitelist does not include
`$TEMPLATE_ROOT/server/src/` or `$TEMPLATE_ROOT/web/src/`, so when the user
asks for anything that needs code — a new backend endpoint, a UI change,
calling `/transcription/start` from the page — **do not write those files**,
and do not ask the user for permission to bypass §14. Instead:

1. **Say why, in one line**: Quick Start keeps the template untouched so it
   can be re-run and upgraded; code changes belong to the user's own project.
2. **Deliver in the chat**:
   - the relevant TRTC doc (routing table below);
   - a complete code skeleton that follows `template/AGENTS.md` (§C conventions,
     §E "Add a new backend endpoint");
   - the exact file path it goes in, and every other line that must change
     (e.g. the `app.register(...)` line in `server/src/index.ts`);
   - how to check it works (a `curl` against `localhost:3000`, or what to look
     for in the page).
3. **Let the user choose**, with AskUserQuestion:
   - *Add it myself* — done; answer follow-up questions about the skeleton.
   - *Integrate into my own project* — switch to SKILL.md §9 Path B. There the
     server code lives in `$PROJECT_ROOT/voice-ai-server/`, which is on the
     whitelist, so you may apply the change there.

`server/src/` is reloaded by `tsx watch`, so a user adding the skeleton
themselves does not need to restart — unlike `.env` edits.

### Example skeleton — bot status (`POST /agent/status`)

`describeAIConversation` already exists in `server/src/tencent/client.ts`; the
route is all that is missing. Per `AGENTS.md` §C.3, prefer webhooks over polling
this from the frontend.

```ts
// server/src/routes/agentStatus.ts
import type { FastifyInstance } from 'fastify'
import { describeAIConversation } from '../tencent/client.js'
import { taskId } from './schemas.js'

export async function agentStatusRoutes(app: FastifyInstance) {
  app.post<{ Body: { taskId: string } }>('/status', {
    schema: {
      body: {
        type: 'object',
        required: ['taskId'],
        properties: { taskId },
        additionalProperties: false,
      },
    },
    handler: async (request) => {
      const result = await describeAIConversation({ TaskId: request.body.taskId })
      return { taskId: request.body.taskId, status: result.Status ?? null }
    },
  })
}
```

Register it in `server/src/index.ts`, next to the other agent routes:

```ts
import { agentStatusRoutes } from './routes/agentStatus.js'
await app.register(agentStatusRoutes, { prefix: '/agent' })
```

Check: `curl -sS -X POST localhost:3000/agent/status -H 'content-type: application/json' -d '{"taskId":"<taskId from /agent/start>"}'`

## Routing

| User asks about | Point to |
|---|---|
| Add a new backend endpoint / UI change | § Code changes in Path A above |
| Query bot status / poll | Doc 64964 + the bot-status skeleton above |
| Standalone STT (streaming/single/file) | Docs 80841 / 80843 / 80844 + curl examples |
| Standalone TTS | Docs 81360 / 81361 + curl example |
| Custom context / multi-turn memory | Doc 65318 + `LLMConfig.History` explanation |
| Custom TTS engine | Doc 65315 + HTTP streaming contract |
| Bilingual subtitles / real-time translation | See § Bilingual Subtitles below |
| Barge-in / interrupt tuning | Doc 65319 + auto vs manual interrupt params |
| Meeting transcription (multi-party) | Read `../trtc-ai-realtime-interpreter/SKILL.md` (relative to the skill root) |

## Bilingual Subtitles

The starter kit's UI does not include a bilingual toggle by default. The backend endpoints `POST /transcription/start` and `POST /transcription/stop` are already implemented and ready to use.

In Path A, the `.env` keys below are yours to write; the call to
`/transcription/start` lives in `web/src/`, so deliver it per § Code changes in
Path A (snippet for `web/src/hooks/useAgent.ts` after `startAgent` resolves).

**How it works:**
1. After `POST /agent/start` succeeds and returns `botUserId`
2. Call `POST /transcription/start` with `{ roomId, agentUserId: botUserId }`
3. The server starts a `StartAITranscription` task that subscribes to the AI bot's audio
4. Translation direction is auto-inferred from `AGENT_LANGUAGE` env var (falls back to `STT_LANGUAGE`)
5. Translated subtitles arrive as type 10000 custom messages with `translation_text` field
6. The web UI already renders `sub.translation` when present — no frontend changes needed

**Required `.env` config:**
```
STT_LANGUAGE=en              # language the USER speaks
AGENT_LANGUAGE=en            # language the AI speaks — transcription source only, does not change the reply language
BILINGUAL_TARGET_LANG=ja     # language to translate into — must be set explicitly
```

Translation only activates if `BILINGUAL_TARGET_LANG` is set. There is no auto-inference of the target language.

**Why not in the main UI:**
- Requires correctly configuring both `STT_LANGUAGE` and `AGENT_LANGUAGE`
- Needs a matching TTS voice for the AI's output language (see `TTS_VOICE_ID`)
- Configuration errors silently produce no output — poor quickstart experience
- No mainstream voice AI platform includes translation in their basic quickstart
