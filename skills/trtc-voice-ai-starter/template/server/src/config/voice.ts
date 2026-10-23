// ============================================================
// TTS voice resolution
//
// Kept free of `env` so it can be unit-tested without a .env file.
//
// Only Flow has a fallback: its voice IDs are what DEFAULT_VOICE_IDS holds.
// Sending a Flow ID to minimax / azure / elevenlabs / ... is not a fallback,
// it is an invalid request that fails somewhere inside the TTS vendor — so for
// those providers a missing voice is rejected up front with a message that
// names the fix.
// ============================================================

// Flow TTS voices per language (doc: https://trtc.io/document/79682).
export const DEFAULT_VOICE_IDS: Record<string, string> = {
  en: 'v-female-p9Xy7Q1L', // Articulate Narrator (English)
  zh: 'female-kefu-xiaoyue', // Chinese female
}

// Flow voice IDs this kit writes or documents (DEFAULT_VOICE_IDS, Quick Start,
// references/provider-config.md). If one of these reaches another provider, the
// .env was left over from Flow — treat it as "no voice configured".
const KNOWN_FLOW_VOICE_IDS = new Set([
  ...Object.values(DEFAULT_VOICE_IDS),
  'v-male-A4b9KqP2',
  'male-kefu-xiaoxu',
])

// The voice field each provider's TTSConfig uses. A provider absent from this
// map takes no voice (`custom`) or is unknown and passed through untouched.
export const TTS_VOICE_FIELD: Record<string, 'VoiceId' | 'VoiceType' | 'VoiceName'> = {
  flow: 'VoiceId',
  minimax: 'VoiceType',
  azure: 'VoiceName',
  elevenlabs: 'VoiceId',
  cartesia: 'VoiceId',
  inworld: 'VoiceId',
}
const ALL_VOICE_FIELDS = new Set(Object.values(TTS_VOICE_FIELD))

export class TtsVoiceRequiredError extends Error {
  readonly statusCode = 400
  readonly code = 'TTS_VOICE_ID_REQUIRED'

  constructor(provider: string, field: string, flowVoiceId?: string) {
    super(
      (flowVoiceId
        ? `TTS_VOICE_ID=${flowVoiceId} is a Flow voice and cannot be used with TTS_PROVIDER=${provider}. `
        : `TTS_PROVIDER=${provider} requires a voice. `) +
        `Set TTS_VOICE_ID in .env to a voice from ${provider}'s library and restart the server, ` +
        `or pass ttsOverrides.${field} in the request`
    )
    this.name = 'TtsVoiceRequiredError'
  }
}

const trimmed = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

export interface ResolvedTtsVoice {
  /** Voice to pass to the provider's builder; `undefined` if it takes none. */
  voiceId: string | undefined
  /**
   * The overrides with every voice field removed, so spreading them over the
   * built config cannot replace the resolved voice or add another provider's
   * voice field. Unknown providers get their overrides back unchanged.
   */
  overrides: Record<string, unknown>
}

/**
 * Pick the voice to send, or throw if the provider needs one and none is set.
 *
 * Precedence: non-blank `overrides[<provider's voice field>]` → non-blank
 * `envVoiceId` → Flow's language default (flow only) → TtsVoiceRequiredError.
 *
 * @param provider    TTS_PROVIDER
 * @param lang        primary language subtag of STT_LANGUAGE ("en", "ja", ...)
 * @param envVoiceId  TTS_VOICE_ID; an empty or blank string counts as unset
 * @param overrides   already allow-listed ttsOverrides; not mutated
 */
export function resolveTtsVoice(
  provider: string,
  lang: string,
  envVoiceId: string | undefined,
  overrides: Record<string, unknown> = {}
): ResolvedTtsVoice {
  const field = TTS_VOICE_FIELD[provider]
  if (!field && provider !== 'custom') return { voiceId: undefined, overrides }

  const cleaned = Object.fromEntries(
    Object.entries(overrides).filter(([k]) => !ALL_VOICE_FIELDS.has(k as never))
  )
  if (!field) return { voiceId: undefined, overrides: cleaned } // custom

  const voiceId = trimmed(overrides[field]) ?? trimmed(envVoiceId)
  if (voiceId) {
    if (provider !== 'flow' && KNOWN_FLOW_VOICE_IDS.has(voiceId)) {
      throw new TtsVoiceRequiredError(provider, field, voiceId)
    }
    return { voiceId, overrides: cleaned }
  }

  if (provider === 'flow') {
    return { voiceId: DEFAULT_VOICE_IDS[lang] ?? DEFAULT_VOICE_IDS['en'], overrides: cleaned }
  }
  throw new TtsVoiceRequiredError(provider, field)
}
