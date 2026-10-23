// ============================================================
// Override allow-lists
//
// `POST /agent/start` lets the caller pass `sttOverrides` / `llmOverrides` /
// `ttsOverrides` straight into the StartAIConversation payload. TypeScript
// types are erased at runtime, so before this guard existed any caller that
// could reach the server was able to overwrite `APIKey` / `APIUrl` and point
// the agent's LLM or TTS traffic at a host of its choosing — using *our*
// Tencent Cloud task to do it.
//
// Credentials and endpoints are therefore env-only and are never accepted
// from a request body. Everything that is merely *behaviour* (voice, speed,
// prompt, temperature, …) stays overridable, which is what the overrides
// were for in the first place.
//
// This is an allow-list on purpose: a deny-list silently accepts whatever
// new credential field a future provider introduces.
// ============================================================

export type OverrideKind = 'stt' | 'llm' | 'tts'

const ALLOWED_KEYS: Record<OverrideKind, ReadonlySet<string>> = {
  // doc: https://trtc.io/document/68336 — `CustomParam` carries provider
  // credentials and is deliberately absent.
  stt: new Set([
    'Language',
    'AlternativeLanguage',
    'VadLevel',
    'VadSilenceTime',
    'HotWordList',
    'FilterModal',
    'FilterPunc',
    'FilterDirty',
    'ConvertNumMode',
  ]),
  // `LLMType` / `APIKey` / `APIUrl` are env-only: they decide *which*
  // provider gets called and with whose key.
  llm: new Set([
    'Model',
    'SystemPrompt',
    'Temperature',
    'TopP',
    'MaxTokens',
    'History',
    'Streaming',
    'Timeout',
  ]),
  // `TTSType` is env-only because it selects the credential set; the voice
  // field name differs per provider, so all three spellings are allowed.
  tts: new Set([
    'Model',
    'ModelId',
    'VoiceId',
    'VoiceType',
    'VoiceName',
    'Speed',
    'Volume',
    'Pitch',
    'Rate',
    'Language',
    'Emotion',
  ]),
}

export interface SanitizeResult {
  accepted: Record<string, unknown>
  /** Keys dropped because they are not on the allow-list; logged by the caller. */
  rejected: string[]
}

/**
 * Keep only the override keys that are safe to take from a request body.
 *
 * Pure function — see `overrides.test.ts`.
 */
export function sanitizeOverrides(
  kind: OverrideKind,
  overrides?: Record<string, unknown>
): SanitizeResult {
  if (!overrides) return { accepted: {}, rejected: [] }

  const allowed = ALLOWED_KEYS[kind]
  const accepted: Record<string, unknown> = {}
  const rejected: string[] = []

  for (const [key, value] of Object.entries(overrides)) {
    if (allowed.has(key)) {
      accepted[key] = value
    } else {
      rejected.push(key)
    }
  }

  return { accepted, rejected }
}
