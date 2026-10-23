#!/usr/bin/env node
// verify-credentials.mjs
// Usage: node scripts/verify-credentials.mjs --type trtc|tencent|llm|all
// Output: JSON to stdout  (exit 0 = ok, exit 1 = validation failed)
//
// Error codes:
//   E000  .env file not found
//   E001  TRTC keys missing or invalid format
//   E002  Tencent Cloud keys missing
//   E003  LLM key / URL / model missing or invalid
//   E004  Network unreachable (TRTC API host derived from TENCENT_CLOUD_REGION)

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

const __dir = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dir, '../.env')

// ---- Minimal .env parser ----------------------------------------

function parseEnv(content) {
  const result = {}
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) result[key] = val
  }
  return result
}

// ---- CLI args ---------------------------------------------------

function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx !== -1 ? process.argv[idx + 1] : null
}

const type = arg('--type') ?? 'all'
const validTypes = ['trtc', 'tencent', 'llm', 'all']
if (!validTypes.includes(type)) {
  out({ ok: false, errors: [{ code: 'E000', message: `Unknown --type "${type}". Valid: ${validTypes.join(', ')}` }] })
  process.exit(1)
}

// ---- Load .env --------------------------------------------------

if (!existsSync(ENV_PATH)) {
  out({ ok: false, errors: [{ code: 'E000', message: `.env file not found at ${ENV_PATH}` }] })
  process.exit(1)
}

const env = parseEnv(readFileSync(ENV_PATH, 'utf8'))

// ---- Checks -----------------------------------------------------

const errors = []

function check(code, condition, message) {
  if (!condition) errors.push({ code, message })
}

function present(key) {
  return typeof env[key] === 'string' && env[key].trim().length > 0
}

if (type === 'trtc' || type === 'all') {
  check('E001', present('TRTC_SDK_APP_ID'), 'TRTC_SDK_APP_ID is missing')
  check('E001', /^\d+$/.test(env['TRTC_SDK_APP_ID'] ?? ''), 'TRTC_SDK_APP_ID must be a numeric App ID')
  check('E001', present('TRTC_SDK_SECRET_KEY'), 'TRTC_SDK_SECRET_KEY is missing')
  check('E001', (env['TRTC_SDK_SECRET_KEY'] ?? '').length >= 16, 'TRTC_SDK_SECRET_KEY looks too short')
}

if (type === 'tencent' || type === 'all') {
  check('E002', present('TENCENT_CLOUD_SECRET_ID'), 'TENCENT_CLOUD_SECRET_ID is missing')
  check('E002', present('TENCENT_CLOUD_SECRET_KEY'), 'TENCENT_CLOUD_SECRET_KEY is missing')
  check('E002', present('TENCENT_CLOUD_REGION'), 'TENCENT_CLOUD_REGION is missing')

  // Keep in sync with server/src/tencent/endpoint.ts (SUPPORTED_REGIONS).
  // Duplicated because this script runs before any dependency is installed.
  const validRegions = ['ap-guangzhou', 'ap-singapore', 'ap-tokyo', 'na-ashburn', 'na-siliconvalley']
  const region = env['TENCENT_CLOUD_REGION'] ?? ''
  check('E002',
    validRegions.includes(region),
    `TENCENT_CLOUD_REGION "${region}" is not a supported region. Valid: ${validRegions.join(', ')}`
  )
}

// ---- API host ---------------------------------------------------
// Mirrors resolveEndpoint() in server/src/tencent/endpoint.ts: ap-guangzhou is
// served by the China site, the other four regions by the international one.

function apiHost() {
  const override = (env['TENCENT_CLOUD_ENDPOINT'] ?? '').trim()
  if (override) return override
  return env['TENCENT_CLOUD_REGION'] === 'ap-guangzhou'
    ? 'trtc.tencentcloudapi.com'
    : 'trtc.intl.tencentcloudapi.com'
}

if (type === 'llm' || type === 'all') {
  const provider = env['LLM_PROVIDER'] ?? 'hunyuan'
  const validProviders = ['hunyuan', 'openai', 'azure', 'deepseek', 'minimax', 'qwen', 'doubao']
  check('E003',
    validProviders.includes(provider),
    `LLM_PROVIDER "${provider}" is not a recognised provider`
  )
  check('E003', present('LLM_API_KEY'), 'LLM_API_KEY is missing')
  check('E003', present('LLM_API_URL'), 'LLM_API_URL is missing')
  check('E003',
    !present('LLM_API_URL') || /^https?:\/\/\S+$/.test(env['LLM_API_URL'].trim()),
    'LLM_API_URL must be a full http(s) URL'
  )
  check('E003', present('LLM_MODEL'), 'LLM_MODEL is missing')
}

// ---- Network reachability (all / tencent) ----------------------

async function checkNetwork(host) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port: 443 })
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 5000)
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.on('error', () => { clearTimeout(timer); resolve(false) })
  })
}

async function main() {
  if (errors.length > 0) {
    out({ ok: false, type, errors })
    process.exit(1)
  }

  if (type === 'all' || type === 'tencent') {
    const host = apiHost()
    const reachable = await checkNetwork(host)
    if (!reachable) {
      out({ ok: false, type, errors: [{ code: 'E004', message: `${host} is not reachable (check firewall / proxy)` }] })
      process.exit(1)
    }
  }

  out({ ok: true, type, message: 'All credentials look good.' })
  process.exit(0)
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
}

main()
