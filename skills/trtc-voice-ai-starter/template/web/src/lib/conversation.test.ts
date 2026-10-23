// Tests for the subtitle / metric reducers.
//
// Run: pnpm --filter web test
//
// These cover the wire-format quirks of the agent's custom messages, which were
// reverse-engineered from runtime logs rather than from the API docs. If the
// agent ever changes its payload shape, these tests are the early warning.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reduceSubtitle, reduceMetric } from './conversation.js'
import type { SubtitleMessage, MetricMessage, Subtitle, Metrics } from '../types/events.js'

const SELF = 'user_abc'
const BOT = 'robot_xyz'

function subtitle(
  sender: string,
  payload: Partial<SubtitleMessage['payload']>
): SubtitleMessage {
  return {
    type: 10000,
    sender,
    payload: { text: '', end: false, ...payload },
  }
}

function metric(name: string, value: number): MetricMessage {
  return { type: 10020, sender: BOT, payload: { metric: name, value } }
}

const NO_METRICS: Metrics = { llmMs: null, ttsMs: null, sttMs: null }

describe('reduceSubtitle', () => {
  it('appends a new entry for the local user', () => {
    const out = reduceSubtitle([], subtitle(SELF, { text: 'hello' }), SELF)
    assert.equal(out.length, 1)
    assert.equal(out[0].role, 'user')
    assert.equal(out[0].text, 'hello')
    assert.equal(out[0].isFinal, false)
  })

  it('treats any other sender as the assistant', () => {
    const out = reduceSubtitle([], subtitle(BOT, { text: 'hi there' }), SELF)
    assert.equal(out[0].role, 'assistant')
  })

  it('updates the open entry in place instead of appending', () => {
    let out = reduceSubtitle([], subtitle(SELF, { text: 'hel' }), SELF)
    out = reduceSubtitle(out, subtitle(SELF, { text: 'hello world' }), SELF)
    assert.equal(out.length, 1)
    assert.equal(out[0].text, 'hello world')
  })

  it('keeps the id stable while an entry is being updated', () => {
    let out = reduceSubtitle([], subtitle(SELF, { text: 'a' }), SELF)
    const firstId = out[0].id
    out = reduceSubtitle(out, subtitle(SELF, { text: 'ab' }), SELF)
    assert.equal(out[0].id, firstId)
  })

  // `payload.text` is empty on the final message
  it('preserves the previous text when the final message has empty text', () => {
    let out = reduceSubtitle([], subtitle(SELF, { text: 'keep me' }), SELF)
    out = reduceSubtitle(out, subtitle(SELF, { text: '', end: true }), SELF)
    assert.equal(out.length, 1)
    assert.equal(out[0].text, 'keep me')
    assert.equal(out[0].isFinal, true)
  })

  it('starts a new entry once the previous one is final', () => {
    let out = reduceSubtitle([], subtitle(SELF, { text: 'first', end: true }), SELF)
    out = reduceSubtitle(out, subtitle(SELF, { text: 'second' }), SELF)
    assert.equal(out.length, 2)
    assert.equal(out[1].text, 'second')
  })

  it('does not create an empty bubble from an empty first message', () => {
    const out = reduceSubtitle([], subtitle(SELF, { text: '', end: true }), SELF)
    assert.deepEqual(out, [])
  })

  it('keeps user and assistant entries independent', () => {
    let out = reduceSubtitle([], subtitle(SELF, { text: 'question' }), SELF)
    out = reduceSubtitle(out, subtitle(BOT, { text: 'answer' }), SELF)
    assert.equal(out.length, 2)
    assert.equal(out[0].role, 'user')
    assert.equal(out[1].role, 'assistant')
  })

  // Real capture, 2026-10-20: tencent STT + deepseek-chat + flow TTS.
  // The agent streams a long reply as INCREMENTAL chunks; the user's STT text
  // is CUMULATIVE and revises itself. Replacing agent text left only
  // " Just let me know how I can help." on screen.
  describe('real capture: long agent reply', () => {
    const USER = 'user_5e16rp'
    const ROBOT = 'robot_qjcyRO'
    const R0 = 'f76559b2-c0a8-411f-ab73-725079b5ad16'
    const R1 = 'b699564d-e58b-4dc6-9c52-58c3555b76b4'
    const capture: [string, string, boolean, string][] = [
      [ROBOT, R0, false, 'Hello, how can I help you today?'],
      [ROBOT, R0, true, ''],
      [USER, R1, false, 'Can you please?'],
      [USER, R1, false, 'Can you please tell me about?'],
      [USER, R1, false, 'Please tell me about yourself.'],
      [USER, R1, false, 'Please tell me about yourself in five or six full sentences. Take your time.'],
      [USER, R1, true, 'Please tell me about yourself in five or six full sentences. Take your time. '],
      [ROBOT, R1, false, "I'm a voice assistant designed to help you with questions,"],
      [ROBOT, R1, false, ' tasks, and conversation.'],
      [ROBOT, R1, false, ' I can look up information,'],
      [ROBOT, R1, false, ' explain ideas,'],
      [ROBOT, R1, false, ' help with writing,'],
      [ROBOT, R1, false, ' and assist with planning.'],
      [ROBOT, R1, false, ' I aim to keep my answers clear and concise,'],
      [ROBOT, R1, false, ' especially in spoken conversation.'],
      [ROBOT, R1, false, " I don't have personal experiences or feelings,"],
      [ROBOT, R1, false, " but I'm built to respond in a helpful,"],
      [ROBOT, R1, false, ' friendly way.'],
      [ROBOT, R1, false, " I'm always ready to learn what you need and adapt to your preferences."],
      [ROBOT, R1, false, ' Just let me know how I can help.'],
      [ROBOT, R1, true, ''],
    ]
    const replay = () =>
      capture.reduce(
        (acc, [sender, roundid, end, text]) => reduceSubtitle(acc, subtitle(sender, { text, end, roundid }), USER),
        [] as Subtitle[],
      )

    it('shows the whole agent reply, not just the last chunk', () => {
      const out = replay()
      assert.equal(out.length, 3)
      assert.equal(
        out[2].text,
        "I'm a voice assistant designed to help you with questions, tasks, and conversation." +
          ' I can look up information, explain ideas, help with writing, and assist with planning.' +
          ' I aim to keep my answers clear and concise, especially in spoken conversation.' +
          " I don't have personal experiences or feelings, but I'm built to respond in a helpful, friendly way." +
          " I'm always ready to learn what you need and adapt to your preferences. Just let me know how I can help.",
      )
      assert.equal(out[2].isFinal, true)
    })

    it('replaces cumulative user text, including STT self-corrections', () => {
      const out = replay()
      assert.equal(out[1].role, 'user')
      assert.equal(out[1].text, 'Please tell me about yourself in five or six full sentences. Take your time. ')
    })

    it('keeps the greeting as its own finished entry', () => {
      const out = replay()
      assert.equal(out[0].text, 'Hello, how can I help you today?')
      assert.equal(out[0].isFinal, true)
    })
  })

  describe('agent chunk merging', () => {
    it('does not double the text if a provider sends cumulative agent text', () => {
      let out = reduceSubtitle([], subtitle(BOT, { text: 'Hello', roundid: 'r1' }), SELF)
      out = reduceSubtitle(out, subtitle(BOT, { text: 'Hello there', roundid: 'r1' }), SELF)
      assert.equal(out[0].text, 'Hello there')
    })

    it('closes an unfinished reply when a new round starts (interrupted agent)', () => {
      let out = reduceSubtitle([], subtitle(BOT, { text: 'I was saying', roundid: 'r1' }), SELF)
      out = reduceSubtitle(out, subtitle(BOT, { text: 'New answer', roundid: 'r2' }), SELF)
      assert.equal(out.length, 2)
      assert.equal(out[0].text, 'I was saying')
      assert.equal(out[0].isFinal, true)
      assert.equal(out[1].text, 'New answer')
    })

    it('trims the leading space of the first chunk', () => {
      const out = reduceSubtitle([], subtitle(BOT, { text: ' Leading', roundid: 'r1' }), SELF)
      assert.equal(out[0].text, 'Leading')
    })
  })

  describe('translations from the trans_ bot', () => {
    const withRound = (): Subtitle[] =>
      reduceSubtitle([], subtitle(BOT, { text: 'hello', end: true, roundid: 'r1' }), SELF)

    it('attaches the translation to the entry with the same roundId', () => {
      const out = reduceSubtitle(
        withRound(),
        subtitle('trans_1', { translation_text: '你好', roundid: 'r1' }),
        SELF
      )
      assert.equal(out.length, 1)
      assert.equal(out[0].text, 'hello')
      assert.equal(out[0].translation, '你好')
    })

    it('ignores a translation whose roundId matches nothing', () => {
      const prev = withRound()
      const out = reduceSubtitle(
        prev,
        subtitle('trans_1', { translation_text: '你好', roundid: 'nope' }),
        SELF
      )
      assert.equal(out, prev, 'should return the same reference')
    })

    it('ignores a translation with no roundId or no text', () => {
      const prev = withRound()
      assert.equal(reduceSubtitle(prev, subtitle('trans_1', { translation_text: '你好' }), SELF), prev)
      assert.equal(reduceSubtitle(prev, subtitle('trans_1', { roundid: 'r1' }), SELF), prev)
    })

    it('never creates a subtitle entry of its own', () => {
      const out = reduceSubtitle(
        [],
        subtitle('trans_1', { translation_text: '你好', roundid: 'r1' }),
        SELF
      )
      assert.deepEqual(out, [])
    })
  })
})

describe('reduceMetric', () => {
  // The real payload is { metric, value }, not { LLMDuration, ... }
  it('maps the known exact metric names', () => {
    assert.equal(reduceMetric(NO_METRICS, metric('tts_first_frame_latency', 445)).ttsMs, 445)
    assert.equal(reduceMetric(NO_METRICS, metric('llm_ttft', 300)).llmMs, 300)
    assert.equal(reduceMetric(NO_METRICS, metric('asr_recognized_latency', 120)).sttMs, 120)
  })

  it('lets an exact match overwrite an earlier value', () => {
    const prev = { ...NO_METRICS, ttsMs: 999 }
    assert.equal(reduceMetric(prev, metric('tts_first_frame_latency', 445)).ttsMs, 445)
  })

  it('falls back to substring matching for unknown names', () => {
    assert.equal(reduceMetric(NO_METRICS, metric('some_tts_thing', 500)).ttsMs, 500)
    assert.equal(reduceMetric(NO_METRICS, metric('llm_other', 600)).llmMs, 600)
    assert.equal(reduceMetric(NO_METRICS, metric('stt_other', 70)).sttMs, 70)
  })

  it('does not let a fuzzy match overwrite an existing value', () => {
    const prev = { ...NO_METRICS, ttsMs: 445 }
    assert.equal(reduceMetric(prev, metric('some_tts_thing', 999)).ttsMs, 445)
  })

  it('ignores metrics it cannot classify', () => {
    const out = reduceMetric(NO_METRICS, metric('network_rtt', 42))
    assert.deepEqual(out, NO_METRICS)
  })
})
