// ============================================================
// Conversational AI callback event types
//
// Doc: https://www.tencentcloud.com/document/product/647/68331
//
// `EventType` is a NUMBER, not a string. The earlier implementation switched
// on `'AIConversationStart'` / `'AIConversationExit'` / `'AIConversationRobotError'`,
// which do not appear anywhere in the real payload — so every delivery fell
// through to the `default` branch and nothing was ever logged or persisted.
// ============================================================

/** `EventGroupId` for the AI service group (`EVENT_GROUP_AI_SERVICE`). */
export const AI_SERVICE_EVENT_GROUP = 9

/** Documented `EventType` values. 907 is not defined by the docs. */
export const AIEvent = {
  /** Task started. `Payload.Status` 0 = success, 1 = failure. */
  Start: 901,
  /** Task stopped. `Payload.LeaveCode` explains why. */
  Stop: 902,
  /** Complete STT sentence, or complete LLM reply. */
  Message: 903,
  /** Start of an STT-recognised sentence. */
  SpeechStart: 904,
  /** AI finished speaking for this round. */
  SpeakingFinished: 905,
  /** LLM/TTS metric sample. */
  Metric: 906,
  /** Metric error. */
  ErrorMetric: 908,
  /** Session ready — audio/video channels established. */
  SessionStatus: 909,
} as const

export type AIEventType = (typeof AIEvent)[keyof typeof AIEvent]

/**
 * Why a task stopped (`EventType` 902, `Payload.LeaveCode`).
 *
 * 98 and 99 are the two worth alerting on: 98 is an internal error that the
 * docs say to retry, and 99 means the bot was left alone in the room.
 */
export const LEAVE_CODE_REASONS: Record<number, string> = {
  0: 'stop API called',
  1: 'bot removed by the application',
  2: 'room dissolved by the application',
  3: 'bot removed by the TRTC server',
  4: 'room dissolved by the TRTC server',
  98: 'internal error (retry recommended)',
  99: 'no other user stream in the room — idle timeout',
}

/** Common `EventInfo` fields, shared by every event type. */
export interface AICallbackEventInfo {
  EventMsTs?: string | number
  TaskId?: string
  RoomId?: string
  RoomIdType?: number
  Payload?: Record<string, unknown>
}

/**
 * Callback envelope.
 *
 * The docs' field table says `CallbackMsTs` while every example uses
 * `CallbackTs`; both are accepted here rather than guessing which one the
 * server actually sends.
 */
export interface AICallbackBody {
  EventGroupId?: number
  EventType?: number
  CallbackTs?: number
  CallbackMsTs?: number
  EventInfo?: AICallbackEventInfo
}
