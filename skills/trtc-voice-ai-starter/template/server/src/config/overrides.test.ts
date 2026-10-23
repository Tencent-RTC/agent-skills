import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeOverrides } from './overrides.js'

test('undefined overrides produce an empty result', () => {
  const { accepted, rejected } = sanitizeOverrides('llm', undefined)
  assert.deepEqual(accepted, {})
  assert.deepEqual(rejected, [])
})

test('allow-listed behaviour fields pass through', () => {
  const { accepted, rejected } = sanitizeOverrides('llm', {
    Temperature: 0.9,
    SystemPrompt: 'be terse',
  })
  assert.deepEqual(accepted, { Temperature: 0.9, SystemPrompt: 'be terse' })
  assert.deepEqual(rejected, [])
})

// The whole point of the allow-list: a caller must not be able to redirect
// the agent's LLM traffic or swap in its own key.
test('LLM credentials and endpoints are rejected', () => {
  const { accepted, rejected } = sanitizeOverrides('llm', {
    APIKey: 'sk-attacker',
    APIUrl: 'https://attacker.example/v1',
    LLMType: 'openai',
    Temperature: 0.2,
  })
  assert.deepEqual(accepted, { Temperature: 0.2 })
  assert.deepEqual(rejected.sort(), ['APIKey', 'APIUrl', 'LLMType'])
})

test('TTS credentials are rejected but voice settings are kept', () => {
  const { accepted, rejected } = sanitizeOverrides('tts', {
    VoiceId: 'v-female-p9Xy7Q1L',
    Speed: 1.2,
    APIKey: 'leak',
    SubscriptionKey: 'leak',
    GroupId: 'leak',
    TTSType: 'custom',
  })
  assert.deepEqual(accepted, { VoiceId: 'v-female-p9Xy7Q1L', Speed: 1.2 })
  assert.deepEqual(rejected.sort(), ['APIKey', 'GroupId', 'SubscriptionKey', 'TTSType'])
})

test('STT CustomParam is rejected because it carries provider credentials', () => {
  const { accepted, rejected } = sanitizeOverrides('stt', {
    Language: 'ja',
    CustomParam: JSON.stringify({ ApiKey: 'leak' }),
  })
  assert.deepEqual(accepted, { Language: 'ja' })
  assert.deepEqual(rejected, ['CustomParam'])
})

test('unknown keys are dropped rather than forwarded', () => {
  const { accepted, rejected } = sanitizeOverrides('tts', { SomeFutureField: 1 })
  assert.deepEqual(accepted, {})
  assert.deepEqual(rejected, ['SomeFutureField'])
})

// Prototype-pollution style keys must not survive the filter either.
test('__proto__ and constructor are not allow-listed', () => {
  const { accepted, rejected } = sanitizeOverrides('llm', JSON.parse('{"__proto__":{"x":1},"constructor":2}'))
  assert.deepEqual(accepted, {})
  assert.deepEqual(rejected.sort(), ['__proto__', 'constructor'])
})

test('the allow-list is per-kind: an STT field is not accepted as an LLM field', () => {
  const { rejected } = sanitizeOverrides('llm', { VadLevel: 3 })
  assert.deepEqual(rejected, ['VadLevel'])
})
