// ============================================================
// Tencent Cloud TRTC API types — single re-export point
//
// The SDK ships full TypeScript definitions for every TRTC API.
// We re-export the ones we use here so that:
//   1. The deep import path appears exactly once in the codebase.
//      If the SDK restructures, only this file changes.
//   2. Field names are checked by the compiler instead of by hand.
//      There were two field-name bugs (`TranscriptionParams`
//      vs `TranscriptionParam`, `RecognizeConfig` vs `AsrParam`) that
//      were found by reading these very definitions manually — the
//      compiler does that job for free.
//
// Note: `LLMConfig` / `TTSConfig` are typed `string` by the SDK because
// the API expects them JSON-stringified. The shapes
// we stringify into are declared in `config/providers.ts`.
// ============================================================

export type {
  // Conversation APIs
  StartAIConversationRequest,
  StopAIConversationRequest,
  ControlAIConversationRequest,
  UpdateAIConversationRequest,
  DescribeAIConversationRequest,
  // Transcription APIs (bilingual subtitles)
  StartAITranscriptionRequest,
  StopAITranscriptionRequest,
  // Nested config objects
  AgentConfig,
  STTConfig,
  TranscriptionParams,
  RecognizeConfig,
  TranslationConfig,
} from 'tencentcloud-sdk-nodejs/tencentcloud/services/trtc/v20190722/trtc_models.js'
