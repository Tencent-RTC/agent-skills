import { config } from 'dotenv'
import { z } from 'zod'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_REGIONS } from './tencent/endpoint.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../.env') })

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful voice assistant in a real-time spoken conversation. ' +
  'Everything you write is spoken aloud, so write only plain spoken sentences: ' +
  'no markdown, bold, headings, bullet points, numbered lists, emoji or URLs. ' +
  'When listing things, mention at most three, connect them naturally ' +
  '("first..., then..., and finally..."), and ask if the user wants to hear more. ' +
  'Keep each reply to one to three short sentences. ' +
  'Write numbers, dates, prices and phone numbers the way they are spoken. ' +
  'Reply in the language the user speaks.'

const schema = z.object({
  // TRTC
  TRTC_SDK_APP_ID: z.coerce.number().int().positive(),
  TRTC_SDK_SECRET_KEY: z.string().min(1),

  // Tencent Cloud API
  TENCENT_CLOUD_SECRET_ID: z.string().min(1),
  TENCENT_CLOUD_SECRET_KEY: z.string().min(1),
  // StartAIConversation supports exactly these 5 regions. Validated here as
  // well as in scripts/verify-credentials.mjs, so a typo fails at boot with a
  // readable message instead of as an opaque API rejection.
  TENCENT_CLOUD_REGION: z.enum(SUPPORTED_REGIONS),
  // Optional escape hatch; normally derived from the region (see tencent/endpoint.ts)
  TENCENT_CLOUD_ENDPOINT: z.string().optional(),

  // LLM
  LLM_API_KEY: z.string().min(1),
  LLM_API_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),

  // STT
  STT_PROVIDER: z.string().default('tencent'),
  STT_LANGUAGE: z.string().default('en'),   // language the USER speaks
  STT_API_KEY: z.string().optional(),
  STT_AZURE_REGION: z.string().optional(),
  STT_MODEL: z.string().optional(),

  // Agent output language (for bilingual transcription of AI's TTS output)
  // Defaults to STT_LANGUAGE if not set — override when AI speaks a different language than the user
  AGENT_LANGUAGE: z.string().optional(),
  // Target language for bilingual translation. Must be set explicitly — no auto-inference.
  // Examples: zh, en, ja, ko, fr, de, es (ISO 639-1)
  BILINGUAL_TARGET_LANG: z.string().optional(),

  // TTS
  TTS_PROVIDER: z.string().default('flow'),
  TTS_VOICE_ID: z.string().optional(),  // flow: optional (language default); other providers except custom: required — see config/voice.ts
  TTS_API_KEY: z.string().optional(),          // minimax / elevenlabs / cartesia / inworld / custom APIKey
  TTS_API_URL: z.string().optional(),          // minimax / custom APIUrl
  TTS_AZURE_SUBSCRIPTION_KEY: z.string().optional(),
  TTS_AZURE_REGION: z.string().optional(),
  TTS_MINIMAX_GROUP_ID: z.string().optional(),

  // Agent behavior
  // The LLM's reply is spoken by TTS and shown verbatim as subtitles, so the
  // default prompt rules out chat formatting (markdown, lists) — following the
  // Vapi / ElevenLabs voice prompting guides. Keep .env.example in sync.
  AGENT_SYSTEM_PROMPT: z.string().default(DEFAULT_SYSTEM_PROMPT),
  AGENT_GREETING: z.string().default('Hello, how can I help you today?'),
  AGENT_MAX_IDLE_TIME: z.coerce.number().default(60),

  // Server
  SERVER_PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // UserSig issuance (GET /userSig)
  // 2h by default: a client-side room token should be short-lived, and the
  // client can simply ask for another one. Capped at 24h.
  USERSIG_EXPIRE_SECONDS: z.coerce.number().int().positive().max(86400).default(7200),
  // When set, GET /userSig requires `Authorization: Bearer <token>`.
  // Leave empty for local development only — see routes/userSig.ts.
  USERSIG_AUTH_TOKEN: z.string().optional(),

  // Webhook (optional)
  WEBHOOK_SIGNING_SECRET: z.string().optional(),
  // Accept unsigned webhook deliveries. Default false: without a signing
  // secret the endpoint would otherwise be an unauthenticated disk write.
  WEBHOOK_ALLOW_UNSIGNED: z
    .enum(['true', 'false'])
    .default('false')
    .transform(v => v === 'true'),
  // Hard cap for data/conversations.jsonl so a flood cannot fill the disk.
  WEBHOOK_LOG_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors
  console.error('❌ Invalid or missing environment variables:')
  for (const [key, issues] of Object.entries(errors)) {
    console.error(`  ${key}: ${issues?.join(', ')}`)
  }
  console.error('\nCopy .env.example to .env and fill in the required values.')
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
