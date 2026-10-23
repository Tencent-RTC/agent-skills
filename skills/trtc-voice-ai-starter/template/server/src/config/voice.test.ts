import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTtsVoice, TtsVoiceRequiredError, DEFAULT_VOICE_IDS } from './voice.js'

const voice = (...args: Parameters<typeof resolveTtsVoice>) => resolveTtsVoice(...args).voiceId

const isVoiceRequired = (provider: string, field: string, flowId?: string) => (err: unknown) => {
  assert.ok(err instanceof TtsVoiceRequiredError)
  assert.equal(err.statusCode, 400)
  assert.equal(err.code, 'TTS_VOICE_ID_REQUIRED')
  assert.match(err.message, new RegExp(`TTS_PROVIDER=${provider}`))
  assert.match(err.message, new RegExp(`ttsOverrides\\.${field}`))
  if (flowId) assert.match(err.message, new RegExp(`${flowId} is a Flow voice`))
  return true
}

// ---- flow ----------------------------------------------------

test('flow falls back to the language default when TTS_VOICE_ID is unset', () => {
  assert.equal(voice('flow', 'en', undefined), DEFAULT_VOICE_IDS.en)
  assert.equal(voice('flow', 'zh', undefined), DEFAULT_VOICE_IDS.zh)
})

test('flow falls back to the English voice for a language with no default', () => {
  // Pronunciation still follows STT_LANGUAGE: the flow builder sends Language.
  assert.equal(voice('flow', 'ja', undefined), DEFAULT_VOICE_IDS.en)
})

test('an empty or blank TTS_VOICE_ID counts as unset', () => {
  assert.equal(voice('flow', 'zh', ''), DEFAULT_VOICE_IDS.zh)
  assert.equal(voice('flow', 'zh', '   '), DEFAULT_VOICE_IDS.zh)
})

test('an explicit TTS_VOICE_ID wins over the default, trimmed', () => {
  assert.equal(voice('flow', 'en', ' v-male-A4b9KqP2 '), 'v-male-A4b9KqP2')
})

// ---- providers that need their own voice ----------------------

for (const [provider, field] of [
  ['minimax', 'VoiceType'],
  ['azure', 'VoiceName'],
  ['elevenlabs', 'VoiceId'],
  ['cartesia', 'VoiceId'],
  ['inworld', 'VoiceId'],
] as const) {
  test(`${provider}: no voice → 400 TTS_VOICE_ID_REQUIRED, in every language`, () => {
    for (const lang of ['en', 'zh', 'ja']) {
      assert.throws(() => resolveTtsVoice(provider, lang, undefined), isVoiceRequired(provider, field))
      assert.throws(() => resolveTtsVoice(provider, lang, '  '), isVoiceRequired(provider, field))
    }
  })

  test(`${provider}: a Flow voice left over in TTS_VOICE_ID is rejected`, () => {
    for (const flowId of ['v-female-p9Xy7Q1L', 'female-kefu-xiaoyue', 'v-male-A4b9KqP2', 'male-kefu-xiaoxu']) {
      assert.throws(() => resolveTtsVoice(provider, 'en', flowId), isVoiceRequired(provider, field, flowId))
    }
  })

  test(`${provider}: a Flow voice in ttsOverrides.${field} is rejected too`, () => {
    assert.throws(
      () => resolveTtsVoice(provider, 'en', 'my-voice', { [field]: 'v-female-p9Xy7Q1L' }),
      TtsVoiceRequiredError
    )
  })

  test(`${provider}: its own voice from TTS_VOICE_ID is used`, () => {
    assert.equal(voice(provider, 'en', 'my-voice'), 'my-voice')
  })

  test(`${provider}: ttsOverrides.${field} wins over TTS_VOICE_ID and is trimmed`, () => {
    assert.equal(voice(provider, 'en', undefined, { [field]: 'ov' }), 'ov')
    assert.equal(voice(provider, 'en', 'env', { [field]: '  ov  ' }), 'ov')
  })
}

// ---- override edge cases --------------------------------------

test("an override in another provider's voice field does not count", () => {
  assert.throws(() => resolveTtsVoice('minimax', 'en', undefined, { VoiceId: 'x' }), TtsVoiceRequiredError)
})

test('empty, blank and non-string overrides do not count', () => {
  for (const bad of ['', '   ', 123, null, { a: 1 }, ['x']]) {
    assert.equal(voice('flow', 'en', 'env', { VoiceId: bad }), 'env')
    assert.throws(() => resolveTtsVoice('azure', 'en', undefined, { VoiceName: bad }), TtsVoiceRequiredError)
  }
})

test('every voice field is stripped from the returned overrides', () => {
  const input = { VoiceId: 'v-female-p9Xy7Q1L', VoiceType: '', VoiceName: 'n', Speed: 1.2 }
  const { voiceId, overrides } = resolveTtsVoice('minimax', 'en', 'female-tianmei', input)
  assert.equal(voiceId, 'female-tianmei')
  assert.deepEqual(overrides, { Speed: 1.2 })
  // input is not mutated
  assert.equal(input.VoiceId, 'v-female-p9Xy7Q1L')
})

// ---- providers that take no voice -----------------------------

test('custom takes no voice, never throws, and gets voice fields stripped', () => {
  const r = resolveTtsVoice('custom', 'ja', 'v-female-p9Xy7Q1L', { VoiceId: 'x', Speed: 1 })
  assert.equal(r.voiceId, undefined)
  assert.deepEqual(r.overrides, { Speed: 1 })
})

test('unknown providers are passed through untouched', () => {
  const ov = { VoiceId: 'x' }
  const r = resolveTtsVoice('some-new-vendor', 'ja', undefined, ov)
  assert.equal(r.voiceId, undefined)
  assert.equal(r.overrides, ov)
})
