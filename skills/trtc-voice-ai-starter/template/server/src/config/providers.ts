import { nanoid } from 'nanoid'
import { env } from '../env.js'
import { genUserSig } from '../tencent/userSig.js'
import { sanitizeOverrides } from './overrides.js'
import type { OverrideKind } from './overrides.js'
import { logger } from '../logger.js'
import { resolveTtsVoice } from './voice.js'
import type { StartAIConversationRequest, STTConfig } from '../tencent/types.js'

/**
 * Request body for POST /agent/start — shared with the route layer.
 *
 * The three `*Overrides` maps are filtered through an allow-list before they
 * reach the Tencent API; credential and endpoint fields are env-only. See
 * `./overrides.ts`.
 */
export interface StartOpts {
  roomId: string
  targetUserId: string
  systemPrompt?: string
  greeting?: string
  sttOverrides?: Record<string, unknown>
  llmOverrides?: Record<string, unknown>
  ttsOverrides?: Record<string, unknown>
}

/** Apply the allow-list and log anything dropped, so it is never silent. */
function safeOverrides(
  kind: OverrideKind,
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  const { accepted, rejected } = sanitizeOverrides(kind, overrides)
  if (rejected.length > 0) {
    logger.warn({ kind, rejected }, 'dropped override keys that are not on the allow-list')
  }
  return accepted
}

/**
 * Build the StartAIConversation payload.
 *
 * Return type comes from the SDK, so field names and nesting are checked at
 * compile time. Note that LLMConfig / TTSConfig are JSON *strings* while
 * STTConfig is a plain object — that asymmetry is required by the API,
 * not an oversight.
 */
export function buildAgentPayload(opts: StartOpts): StartAIConversationRequest {
  const lang = env.STT_LANGUAGE.split('-')[0] // "en-US" → "en"
  // Resolved before anything else: a provider with no usable voice throws
  // TtsVoiceRequiredError (400) here instead of failing inside the TTS vendor.
  const { voiceId, overrides: ttsOverrides } = resolveTtsVoice(
    env.TTS_PROVIDER,
    lang,
    env.TTS_VOICE_ID,
    safeOverrides('tts', opts.ttsOverrides)
  )

  const botUserId = `robot_${nanoid(6)}`
  const { userSig } = genUserSig(botUserId)

  return {
    SdkAppId: env.TRTC_SDK_APP_ID,
    RoomId: opts.roomId,
    RoomIdType: 0,
    AgentConfig: {
      UserId: botUserId,
      UserSig: userSig,
      MaxIdleTime: env.AGENT_MAX_IDLE_TIME,
      TargetUserId: opts.targetUserId,
      WelcomeMessage: opts.greeting ?? env.AGENT_GREETING,
      InterruptMode: 2,
      InterruptSpeechDuration: 500,
      SubtitleMode: 1,
      FilterOneWord: true,
      TurnDetectionMode: 3,
      TurnDetection: { SemanticEagerness: 'auto' },
    },
    STTConfig: buildSTTConfig(safeOverrides('stt', opts.sttOverrides)),
    LLMConfig: JSON.stringify(
      buildLLMConfig(opts.systemPrompt, safeOverrides('llm', opts.llmOverrides))
    ),
    TTSConfig: JSON.stringify(
      buildTTSConfig(voiceId ?? '', lang, ttsOverrides)
    ),
  }
}

// ---- STT ----------------------------------------------------
// Non-Tencent providers pass their credentials through CustomParam as a JSON
// string (doc 68336). Add a provider by adding one entry to this table.

type CustomParamBuilder = () => Record<string, unknown>

const STT_CUSTOM_PARAMS: Record<string, CustomParamBuilder> = {
  // doc: https://trtc.io/document/68336
  azure: () => ({
    SubscriptionKey: env.STT_API_KEY ?? '',
    Region: env.STT_AZURE_REGION ?? '',
  }),
  // doc: https://trtc.io/document/79674
  deepgram: () => ({
    ApiKey: env.STT_API_KEY ?? '',
    Model: env.STT_MODEL ?? 'nova-3',
  }),
  // doc: https://trtc.io/document/79675
  soniox: () => ({
    ApiKey: env.STT_API_KEY ?? '',
    Model: env.STT_MODEL ?? 'stt-rt-v4',
  }),
}

function buildSTTConfig(overrides?: Record<string, unknown>): STTConfig {
  const base: STTConfig = {
    Language: env.STT_LANGUAGE,
    VadLevel: 3,
    VadSilenceTime: 1000,
  }

  if (env.STT_PROVIDER !== 'tencent') {
    base.CustomParam = JSON.stringify({
      STTType: env.STT_PROVIDER,
      ...STT_CUSTOM_PARAMS[env.STT_PROVIDER]?.(),
    })
  }

  return { ...base, ...overrides }
}

// ---- LLM ----------------------------------------------------

function buildLLMConfig(systemPrompt?: string, overrides?: Record<string, unknown>) {
  // All supported providers speak the OpenAI protocol, so LLMType is constant
  // and the provider is selected purely by LLM_API_URL / LLM_MODEL.
  return {
    LLMType: 'openai',
    Model: env.LLM_MODEL,
    APIKey: env.LLM_API_KEY,
    APIUrl: env.LLM_API_URL,
    Streaming: true,
    SystemPrompt: systemPrompt ?? env.AGENT_SYSTEM_PROMPT,
    History: 20,
    Temperature: 0.4,
    ...overrides,
  }
}

// ---- TTS ----------------------------------------------------
// One entry per provider. To add a provider, add a row here — the voice ID is
// passed in because providers disagree on the field name (VoiceId / VoiceType /
// VoiceName). Docs: flow 79682 · minimax 79683 · cartesia 79685 · azure 79686 ·
// elevenlabs 79690 · inworld & custom 79689.

type TTSConfigBuilder = (voiceId: string, lang: string) => Record<string, unknown>

const TTS_BUILDERS: Record<string, TTSConfigBuilder> = {
  flow: (VoiceId, Language) => ({
    TTSType: 'flow',
    Model: 'flow_01_turbo',
    VoiceId,
    Speed: 1.0,
    Volume: 1.0,
    Pitch: 0,
    Language,
  }),
  minimax: (VoiceType) => ({
    TTSType: 'minimax',
    Model: 'speech-2.8-turbo',
    APIUrl: env.TTS_API_URL ?? 'https://api.minimax.chat/v1/t2a_v2',
    APIKey: env.TTS_API_KEY ?? '',
    GroupId: env.TTS_MINIMAX_GROUP_ID ?? '',
    VoiceType,
    Speed: 1.0,
  }),
  azure: (VoiceName, Language) => ({
    TTSType: 'azure',
    SubscriptionKey: env.TTS_AZURE_SUBSCRIPTION_KEY ?? '',
    Region: env.TTS_AZURE_REGION ?? '',
    VoiceName,
    Language,
    Rate: 1.0,
  }),
  elevenlabs: (VoiceId) => ({
    TTSType: 'elevenlabs',
    Model: 'eleven_flash_v2_5',
    APIKey: env.TTS_API_KEY ?? '',
    VoiceId,
  }),
  cartesia: (VoiceId) => ({
    TTSType: 'cartesia',
    Model: 'sonic-3-2026-01-12',
    APIKey: env.TTS_API_KEY ?? '',
    VoiceId,
  }),
  inworld: (VoiceId) => ({
    TTSType: 'inworld',
    APIKey: env.TTS_API_KEY ?? '',
    VoiceId,
    ModelId: 'inworld-tts-1',
  }),
  custom: () => ({
    TTSType: 'custom',
    APIKey: env.TTS_API_KEY ?? '',
    APIUrl: env.TTS_API_URL ?? '',
  }),
}

function buildTTSConfig(
  voiceId: string,
  lang: string,
  overrides?: Record<string, unknown>
) {
  const build = TTS_BUILDERS[env.TTS_PROVIDER]
  // Unknown provider — pass TTSType through and let overrides fill the rest
  const config = build?.(voiceId, lang) ?? { TTSType: env.TTS_PROVIDER }
  return { ...config, ...overrides }
}
