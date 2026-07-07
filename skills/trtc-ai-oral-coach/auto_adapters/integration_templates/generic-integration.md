# Oral Coach — Generic API Integration Guide (L3 Fallback)

> When the Agent cannot identify your tech stack, connect directly via the REST API below.

## 1. Start the Coach Backend

```bash
cd <skill_root> && nohup bash start.sh > /tmp/coach-start.log 2>&1 &
# Default: http://localhost:8000
```

Check health: `curl -sS http://localhost:8000/api/v1/health` — expects `{"status":"ok"}` with 3 green LEDs.

## 2. API Call Sequence

A complete coaching session follows this flow:

```
getConfig → TRTC enter room → agent/start → scene/generate (optional) → practice loop {
  correct (per-sentence) / suggest (hints) / invoke (push-to-talk)
} → report → agent/farewell → TRTC leave room
```

## 3. Endpoint Reference

### Core (conversation-core)

| Method | Path | Key Body Fields |
|:---|:---|:---|
| POST | `/api/v1/config` | `{userid}` |
| POST | `/api/v1/agent/start` | `{RoomId, Scenario, Level, Style, Voice, AgentConfig{UserId,UserSig,TargetUserId}}` |
| POST | `/api/v1/agent/stop` | `{TaskId}` |
| POST | `/api/v1/agent/farewell` | `{TaskId, Lang?, FarewellText?}` |
| POST | `/api/v1/agent/invoke` | `{TaskId, Text?}` |
| GET  | `/api/v1/health` | — |

### Coach Capabilities

| Method | Path | Key Body Fields |
|:---|:---|:---|
| POST | `/api/v1/scene/generate` | `{Field, Scenario, Level, Style, Language, Context}` |
| POST | `/api/v1/correct` | `{UserSentence, Scenario, Level, ScenarioTopic?, UILanguage?}` |
| POST | `/api/v1/suggest` | `{AiLastMessage, Scenario, Level, Style, ScenarioTopic?}` |
| POST | `/api/v1/report` | `{Scenario, Level, Style, DurationSec, Transcript[], Language}` |
| POST | `/api/v1/kb/retrieve` | `{query, top_k?}` (optional capability) |

### Custom Messages (TRTC Data Channel)

| CMD | Direction | Meaning |
|:---|:---|:---|
| 10000 | cloud → client | Subtitle (AI speech text) |
| 10001 | cloud → client | AI state (listening/speaking/thinking) |
| 20000 | client → cloud | Text input (skip ASR) |
| 20001 | client → cloud | Manual interrupt |

## 4. Call Examples

### Get Config & Enter Room

```bash
# 1) Get credentials
curl -sS -X POST http://localhost:8000/api/v1/config \
  -H "Content-Type: application/json" \
  -d '{"userid":"student_001"}'
# → { sdkAppId, roomId, userId, userSig, agentUserId, ... }

# 2) Enter TRTC room with returned credentials (use TRTC Web SDK)
# 3) Start agent
curl -sS -X POST http://localhost:8000/api/v1/agent/start \
  -H "Content-Type: application/json" \
  -d '{
    "RoomId": "...",
    "Scenario": "travel",
    "Level": "intermediate",
    "Style": "friend",
    "AgentConfig": {"UserId": "...", "UserSig": "...", "TargetUserId": "ai_coach_001"}
  }'
# → { TaskId, SessionId }
```

### Coach Capabilities

```bash
# Sentence correction (returns: corrected, explanation, grammar tips)
curl -sS -X POST http://localhost:8000/api/v1/correct \
  -H "Content-Type: application/json" \
  -d '{"UserSentence":"I go to park yesterday","Scenario":"travel","Level":"intermediate"}'

# Reply suggestions (returns 3 hints)
curl -sS -X POST http://localhost:8000/api/v1/suggest \
  -H "Content-Type: application/json" \
  -d '{"AiLastMessage":"What did you do last weekend?","Scenario":"travel","Level":"intermediate","Style":"friend"}'

# 4-dimension report
curl -sS -X POST http://localhost:8000/api/v1/report \
  -H "Content-Type: application/json" \
  -d '{"Scenario":"travel","Level":"intermediate","Style":"friend","DurationSec":120,"Transcript":[...],"Language":"en"}'
```

## 5. Security

- **HTTPS** enforced in production (WebRTC requires it on non-localhost)
- **Never expose SDKSecretKey** to the client — only `userSig` (time-limited) is sent
- **SSRF protection** on KB outbound — private/internal IPs blocked
