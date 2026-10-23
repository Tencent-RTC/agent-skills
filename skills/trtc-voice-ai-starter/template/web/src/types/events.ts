// ============================================================
// TRTC Conversational AI — Custom Message Types
//
// All messages arrive via TRTC SDK's onCustomMessage event.
// Messages from bot use cmdID=1; messages to bot use cmdID=2.
//
// Sources:
//   Subtitle  → doc 68333  type 10000
//   Status    → doc 68332  type 10001
//   Metric    → doc 68334  type 10020
//   Error     → doc 68335  type 10030
// ============================================================

/** TRTC custom-message channels: bot → client is 1, client → bot is 2. */
export const CmdId = {
  FromBot: 1,
  ToBot: 2,
} as const

/** Message type numbers, named. Keep in sync with the doc refs above. */
export const MessageType = {
  Subtitle: 10000,
  Status: 10001,
  Metric: 10020,
  Error: 10030,
  PushText: 20000,
  Interrupt: 20001,
} as const

// ---- Incoming (cmdID = 1, bot → client) --------------------

export interface SubtitleMessage {
  type: 10000
  sender: string               // userId of the speaker (user or bot)
  payload: {
    text: string               // transcript text (may be partial; empty in translation-only messages)
    end: boolean               // true = final segment, false = still speaking
    translation_text?: string  // present when TranslationConfig is active (trans_ bot)
    translation_language?: string
    roundid?: string
  }
}

export type AgentState = 1 | 2 | 3 | 4 | 5

/**
 * Named values for `AgentState` (doc 68332).
 * Prefer these over bare numbers at call sites.
 */
export const AgentStates = {
  Listening: 1,
  Thinking: 2,
  Speaking: 3,
  Interrupted: 4,
  Ended: 5,
} as const satisfies Record<string, AgentState>

export interface StatusMessage {
  type: 10001
  sender: string               // bot userId
  payload: {
    state: AgentState
  }
}

export interface MetricMessage {
  type: 10020
  sender: string
  payload: {
    metric: string    // e.g. "tts_first_frame_latency", "llm_ttft", "asr_recognized_latency"
    value: number     // milliseconds
    tag?: Record<string, string>
  }
}

export interface ErrorMessage {
  type: 10030
  sender: string
  payload: {
    code: number
    message: string
  }
}

export type IncomingMessage =
  | SubtitleMessage
  | StatusMessage
  | MetricMessage
  | ErrorMessage

// ---- Outgoing (cmdID = 2, client → bot) --------------------

export interface PushTextMessage {
  type: 20000
  sender: string               // client userId
  receiver: string[]           // [botUserId]
  payload: { message: string }
}

export interface InterruptMessage {
  type: 20001
  sender: string
  receiver: string[]           // [botUserId]
}

// ---- UI state types -----------------------------------------

export type SessionState = 'idle' | 'connecting' | 'active' | 'stopping'

export interface Subtitle {
  id: string
  role: 'user' | 'assistant'
  text: string
  translation?: string         // filled when bilingual mode is on
  isFinal: boolean
  ts: number
  roundId?: string             // used to match translation messages to the original entry
}

export interface Metrics {
  llmMs: number | null
  ttsMs: number | null
  sttMs: number | null
}
