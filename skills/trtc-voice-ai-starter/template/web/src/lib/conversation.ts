// ============================================================
// Subtitle + metric reducers — pure functions, no React involved.
//
// These are extracted from useTRTC so they can be unit-tested. That matters
// more here than elsewhere: the wire format was reverse-engineered from
// runtime debug logs, not from documentation, so it is the
// most fragile logic in the project and the most likely to regress.
//
// Quirks encoded below, all discovered at runtime:
//   - the user's STT subtitles are CUMULATIVE: each message carries the whole
//     utterance so far, and may revise earlier words ("Can you please tell me
//     about?" → "Please tell me about yourself.") → replace
//   - the agent's subtitles are INCREMENTAL: each message carries only the next
//     chunk, with its own leading space (" tasks, and conversation.") → append.
//     Replacing here showed only the last chunk of a long reply
//   - `payload.text` is empty on the agent's final message → keep the text
//   - `payload.roundid` is shared by a user turn and the agent reply to it
//   - translations arrive from a separate `trans_` bot in `translation_text`
// The fixture in conversation.test.ts is a real capture of all of the above.
// ============================================================

import type {
  SubtitleMessage,
  MetricMessage,
  Subtitle,
  Metrics,
} from '../types/events.js'

/**
 * Fold an incoming subtitle message into the existing subtitle list.
 *
 * Returns the same array reference when nothing changed, so React can skip
 * re-rendering.
 */
export function reduceSubtitle(
  prev: Subtitle[],
  msg: SubtitleMessage,
  selfUserId: string
): Subtitle[] {
  const roundId = msg.payload.roundid

  // ---- Translation from the `trans_` bot: attach to its original entry ----
  if (msg.sender.startsWith('trans_')) {
    const translation = msg.payload.translation_text
    if (!translation || !roundId) return prev

    const idx = prev.findLastIndex(s => s.role === 'assistant' && s.roundId === roundId)
    if (idx === -1) return prev

    return replaceAt(prev, idx, { ...prev[idx], translation })
  }

  // ---- Normal subtitle: update the open (non-final) entry, or append ----
  const role = msg.sender === selfUserId ? 'user' : 'assistant'
  let base = prev
  let idx = prev.findLastIndex(s => s.role === role && !s.isFinal)

  // An open entry from an earlier round never received its `end` (e.g. the
  // agent was interrupted). Close it rather than gluing the new round onto it.
  if (idx !== -1 && roundId && prev[idx].roundId && prev[idx].roundId !== roundId) {
    base = replaceAt(prev, idx, { ...prev[idx], isFinal: true })
    idx = -1
  }
  const isUpdate = idx !== -1
  const previous = isUpdate ? base[idx].text : ''
  const incoming = msg.payload.text ?? ''

  const text = !incoming
    ? previous                                     // final message: keep what we have
    : role === 'user'
      ? incoming                                   // cumulative: replace
      : appendChunk(previous, incoming)            // incremental: append

  // Nothing to show and nothing to update — don't create an empty bubble.
  if (!isUpdate && !text) return base

  const entry: Subtitle = {
    id: isUpdate ? base[idx].id : `${role}-${Date.now()}`,
    role,
    text,
    isFinal: msg.payload.end,
    ts: Date.now(),
    roundId,
  }

  return isUpdate ? replaceAt(base, idx, entry) : [...base, entry]
}

/**
 * Append an agent chunk. Chunks carry their own leading space, so plain
 * concatenation is correct. If a provider ever sends cumulative agent text
 * instead, the incoming text starts with what we already hold — take it as
 * a replacement rather than duplicating the whole reply.
 */
function appendChunk(previous: string, incoming: string): string {
  if (!previous) return incoming.trimStart()
  if (incoming.startsWith(previous)) return incoming
  return previous + incoming
}

// Metric names are not stable across providers, so match the known ones
// exactly and fall back to substring matching for everything else.
const EXACT_METRIC_FIELDS: Record<string, keyof Metrics> = {
  tts_first_frame_latency: 'ttsMs',
  llm_ttft: 'llmMs',
  asr_recognized_latency: 'sttMs',
}

/** Fold a metric message into the latency panel state. */
export function reduceMetric(prev: Metrics, msg: MetricMessage): Metrics {
  const { metric, value } = msg.payload

  const exact = EXACT_METRIC_FIELDS[metric]
  if (exact) return { ...prev, [exact]: value }

  const field = inferMetricField(metric)
  // Only fill from a fuzzy match if we have nothing better yet.
  if (!field || prev[field] !== null) return prev
  return { ...prev, [field]: value }
}

function inferMetricField(metric: string): keyof Metrics | null {
  if (metric.includes('tts')) return 'ttsMs'
  if (metric.includes('llm')) return 'llmMs'
  if (metric.includes('asr') || metric.includes('stt')) return 'sttMs'
  return null
}

function replaceAt<T>(arr: T[], idx: number, value: T): T[] {
  return [...arr.slice(0, idx), value, ...arr.slice(idx + 1)]
}
