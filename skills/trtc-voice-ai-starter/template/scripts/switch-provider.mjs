#!/usr/bin/env node
// switch-provider.mjs
// Usage: node scripts/switch-provider.mjs --category stt|llm|tts --to <provider>
//
// Edits .env in-place to update the provider selection.
// After switching, restart the server for changes to take effect.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dir, '../.env')

// ---- Supported provider catalogue ------------------------------

const PROVIDERS = {
  llm: {
    // For LLM, switching also sets LLM_API_URL and LLM_MODEL defaults (the server reads these, not LLM_PROVIDER)
    hunyuan:  { key: 'LLM_PROVIDER', value: 'hunyuan',  apiUrl: 'https://hunyuan.cloud.tencent.com/openai/v1/chat/completions', model: 'hunyuan-2.0-instruct-20251111', note: 'Also update LLM_API_KEY' },
    openai:   { key: 'LLM_PROVIDER', value: 'openai',   apiUrl: 'https://api.openai.com/v1/chat/completions',                   model: 'gpt-4o-mini',                   note: 'Also update LLM_API_KEY' },
    azure:    { key: 'LLM_PROVIDER', value: 'azure',    apiUrl: '',                                                             model: '',                              note: 'Set LLM_API_URL to your Azure OpenAI endpoint and LLM_API_KEY' },
    deepseek: { key: 'LLM_PROVIDER', value: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions',                    model: 'deepseek-chat',                 note: 'Also update LLM_API_KEY' },
    minimax:  { key: 'LLM_PROVIDER', value: 'minimax',  apiUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2',           model: 'MiniMax-Text-01',               note: 'Also update LLM_API_KEY' },
    qwen:     { key: 'LLM_PROVIDER', value: 'qwen',     apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo',            note: 'Also update LLM_API_KEY (DashScope key)' },
    doubao:   { key: 'LLM_PROVIDER', value: 'doubao',   apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',    model: '',                              note: 'Set LLM_MODEL to your endpoint ID and update LLM_API_KEY' },
  },
  stt: {
    tencent:  { key: 'STT_PROVIDER', value: 'tencent',  note: 'Uses TENCENT_CLOUD_SECRET_ID + TENCENT_CLOUD_SECRET_KEY (already configured)' },
    azure:    { key: 'STT_PROVIDER', value: 'azure',    note: 'Requires STT_API_KEY (SubscriptionKey) and STT_AZURE_REGION (e.g. eastus)' },
    deepgram: { key: 'STT_PROVIDER', value: 'deepgram', note: 'Requires STT_API_KEY (ApiKey) and STT_MODEL (e.g. nova-3)' },
    soniox:   { key: 'STT_PROVIDER', value: 'soniox',   note: 'Requires STT_API_KEY (ApiKey) and STT_MODEL (e.g. stt-rt-v4)' },
  },
  tts: {
    flow:       { key: 'TTS_PROVIDER', value: 'flow',       note: 'TRTC built-in TTS, no external account needed. Set TTS_VOICE_ID (see doc 79682)' },
    minimax:    { key: 'TTS_PROVIDER', value: 'minimax',    note: 'Requires TTS_API_KEY, TTS_API_URL, TTS_MINIMAX_GROUP_ID, TTS_VOICE_ID' },
    azure:      { key: 'TTS_PROVIDER', value: 'azure',      note: 'Requires TTS_AZURE_SUBSCRIPTION_KEY, TTS_AZURE_REGION, TTS_VOICE_ID (VoiceName)' },
    elevenlabs: { key: 'TTS_PROVIDER', value: 'elevenlabs', note: 'Requires TTS_API_KEY and TTS_VOICE_ID' },
    cartesia:   { key: 'TTS_PROVIDER', value: 'cartesia',   note: 'Requires TTS_API_KEY and TTS_VOICE_ID' },
    inworld:    { key: 'TTS_PROVIDER', value: 'inworld',    note: 'Requires TTS_API_KEY and TTS_VOICE_ID' },
    custom:     { key: 'TTS_PROVIDER', value: 'custom',     note: 'Requires TTS_API_KEY and TTS_API_URL (your TTS endpoint)' },
  },
}

// ---- CLI args --------------------------------------------------

function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx !== -1 ? process.argv[idx + 1] ?? null : null
}

const category = arg('--category')
const to       = arg('--to')
const listMode = process.argv.includes('--list')

if (listMode) {
  console.log('\nAvailable providers:\n')
  for (const [cat, providers] of Object.entries(PROVIDERS)) {
    console.log(`  ${cat}:`)
    for (const [name, info] of Object.entries(providers)) {
      console.log(`    ${name.padEnd(12)} — ${info.note}`)
    }
  }
  console.log()
  process.exit(0)
}

if (!category || !to) {
  console.error('Usage: node scripts/switch-provider.mjs --category stt|llm|tts --to <provider>')
  console.error('       node scripts/switch-provider.mjs --list')
  process.exit(1)
}

if (!PROVIDERS[category]) {
  console.error(`Unknown --category "${category}". Valid: ${Object.keys(PROVIDERS).join(', ')}`)
  process.exit(1)
}

const spec = PROVIDERS[category][to]
if (!spec) {
  const valid = Object.keys(PROVIDERS[category]).join(', ')
  console.error(`Unknown provider "${to}" for category "${category}". Valid: ${valid}`)
  process.exit(1)
}

// ---- Load .env -------------------------------------------------

if (!existsSync(ENV_PATH)) {
  console.error(`.env not found at ${ENV_PATH}\nRun: cp .env.example .env`)
  process.exit(1)
}

function setEnvKey(text, key, val) {
  if (!val) return text  // skip empty values (azure/doubao require manual input)
  const re = new RegExp(`^(${key}\\s*=).*$`, 'm')
  return re.test(text)
    ? text.replace(re, `$1${val}`)
    : text.trimEnd() + `\n${key}=${val}\n`
}

let content = readFileSync(ENV_PATH, 'utf8')

// Voice IDs belong to one TTS provider. Keeping the old one after a switch
// sends e.g. a Flow ID to minimax, so comment it out: Flow falls back to its
// language default, the other providers make /agent/start return 400
// TTS_VOICE_ID_REQUIRED until a voice of their own is set.
let clearedVoice = null
if (category === 'tts') {
  const prev = content.match(/^TTS_PROVIDER\s*=\s*(.*?)\s*$/m)?.[1] || 'flow'
  const voiceRe = /^TTS_VOICE_ID\s*=\s*(.*?)\s*$/m
  const voice = content.match(voiceRe)?.[1]
  if (prev !== to && voice) {
    clearedVoice = { prev, voice }
    content = content.replace(voiceRe, (line) => `# ${line}   # voice of TTS_PROVIDER=${prev}`)
  }
}

// Update primary key
content = setEnvKey(content, spec.key, spec.value)

// For LLM: also update LLM_API_URL and LLM_MODEL (these are what the server actually reads)
if (category === 'llm' && spec.apiUrl) content = setEnvKey(content, 'LLM_API_URL', spec.apiUrl)
if (category === 'llm' && spec.model)  content = setEnvKey(content, 'LLM_MODEL',   spec.model)

writeFileSync(ENV_PATH, content, 'utf8')

// ---- Output summary --------------------------------------------

console.log(`\n✔  Switched ${category.toUpperCase()} provider → ${to}`)
console.log(`   ${spec.key}=${spec.value}`)
if (category === 'llm' && spec.apiUrl) console.log(`   LLM_API_URL=${spec.apiUrl}`)
if (category === 'llm' && spec.model)  console.log(`   LLM_MODEL=${spec.model}`)
console.log(`\n   Note: ${spec.note}`)
if (clearedVoice) {
  console.log(`\n   TTS_VOICE_ID=${clearedVoice.voice} was a ${clearedVoice.prev} voice and has been commented out.`)
  console.log(to === 'flow' || to === 'custom'
    ? '   No action needed unless you want a specific voice.'
    : `   Set TTS_VOICE_ID to a ${to} voice before starting an agent.`)
}
// .env is read once at startup (tsx watch only reloads src/), so the running
// server must be stopped first — starting a second one fails on the ports.
console.log('\n   Restart the server to apply (.env is not hot-reloaded):')
console.log('     lsof -ti :3000 -sTCP:LISTEN | xargs kill; lsof -ti :5173 -sTCP:LISTEN | xargs kill')
console.log('     bash start.sh        # from the template root')
console.log('   Then restart any live agent session: POST /agent/stop → POST /agent/start\n')

// v1: provider switch reporting placeholder
// TODO: replace with actual analytics event once reporting infrastructure is ready
// reportProviderSwitch({ category, provider: to })
