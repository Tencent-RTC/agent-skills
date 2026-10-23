import { useState, useRef, useCallback } from 'react'
import TRTC from 'trtc-sdk-v5'
import { fetchUserSig } from '../lib/api.js'
import { reduceSubtitle, reduceMetric } from '../lib/conversation.js'
import { releaseTrtc } from '../lib/session.js'
import { useCustomMessage } from './useCustomMessage.js'
import { CmdId, MessageType } from '../types/events.js'
import type {
  SubtitleMessage,
  StatusMessage,
  MetricMessage,
  ErrorMessage,
  Subtitle,
  Metrics,
  AgentState,
} from '../types/events.js'

const encoder = new TextEncoder()

const EMPTY_METRICS: Metrics = { llmMs: null, ttsMs: null, sttMs: null }

interface UseTRTCOptions {
  userId: string
}

export function useTRTC({ userId }: UseTRTCOptions) {
  // The instance is held in state so that useCustomMessage re-subscribes
  // whenever it changes. A ref alone does not re-render: subscribing with
  // `trtcRef.current` only worked because an unrelated setState happened to
  // follow. The ref mirrors the state for callbacks that must stay stable.
  const [trtc, setTrtc] = useState<TRTC | null>(null)
  const trtcRef = useRef<TRTC | null>(null)
  const [isJoined, setIsJoined] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [agentState, setAgentState] = useState<AgentState | null>(null)
  const [botError, setBotError] = useState<string | null>(null)
  const [subtitles, setSubtitles] = useState<Subtitle[]>([])
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS)

  // ---- Custom message handlers --------------------------------
  // The folding logic lives in lib/conversation.ts as pure functions.

  const onSubtitle = useCallback((msg: SubtitleMessage) => {
    setSubtitles(prev => reduceSubtitle(prev, msg, userId))
  }, [userId])

  const onStatus = useCallback((msg: StatusMessage) => {
    setAgentState(msg.payload.state)
  }, [])

  const onMetric = useCallback((msg: MetricMessage) => {
    setMetrics(prev => reduceMetric(prev, msg))
  }, [])

  const onError = useCallback((msg: ErrorMessage) => {
    const errMsg = `Agent error ${msg.payload.code}: ${msg.payload.message}`
    console.error('[TRTC bot error]', errMsg)
    setBotError(errMsg)
  }, [])

  useCustomMessage(trtc, { onSubtitle, onStatus, onMetric, onError })

  // ---- Room entry/exit ----------------------------------------

  // Detach first, then release: a join/leave racing with this call never
  // sees a half-released instance. Teardown errors are logged, not thrown —
  // releaseTrtc has destroyed the instance regardless.
  const release = useCallback(async () => {
    const current = trtcRef.current
    if (!current) return
    trtcRef.current = null
    setTrtc(null)
    const errors = await releaseTrtc(current)
    for (const err of errors) console.warn('[TRTC] teardown step failed', err)
  }, [])

  const join = useCallback(async (roomId: string) => {
    // Never run two instances: same userId in the same room kicks the first.
    await release()

    const { sdkAppId, userSig } = await fetchUserSig(userId)

    const instance = TRTC.create()
    trtcRef.current = instance
    setTrtc(instance)

    // If entering the room or opening the mic fails, release here rather
    // than relying on the caller — otherwise the instance outlives the error.
    try {
      await instance.enterRoom({
        roomId: parseInt(roomId, 10),
        sdkAppId,
        userId,
        userSig,
      })

      // Use AUDIO_PROFILE_STANDARD — recommended for voice agent scenarios
      await instance.startLocalAudio({ option: { profile: TRTC.TYPE.AUDIO_PROFILE_STANDARD } })
    } catch (err) {
      await release()
      throw err
    }

    // Clear any state left over from a previous session
    setIsJoined(true)
    setSubtitles([])
    setAgentState(null)
    setBotError(null)
    setMetrics(EMPTY_METRICS)
  }, [userId, release])

  const leave = useCallback(async () => {
    await release()
    setIsJoined(false)
    setAgentState(null)
    setIsMuted(false)
  }, [release])

  // ---- Mic control -------------------------------------------

  const setMuted = useCallback((muted: boolean) => {
    const trtc = trtcRef.current
    if (!trtc) return
    trtc.updateLocalAudio({ mute: muted })
    setIsMuted(muted)
  }, [])

  // ---- Send custom message to bot -----------------------------
  // Not used by the default UI (InterruptMode: 2 makes the agent self-interrupt);
  // kept as a reference for Path B integrations.

  const sendToBotRaw = useCallback((payload: object) => {
    const trtc = trtcRef.current
    if (!trtc) return
    trtc.sendCustomMessage({
      cmdId: CmdId.ToBot,
      data: encoder.encode(JSON.stringify(payload)).buffer,
    })
  }, [])

  const sendInterrupt = useCallback((botUserId: string) => {
    sendToBotRaw({ type: MessageType.Interrupt, sender: userId, receiver: [botUserId] })
  }, [sendToBotRaw, userId])

  return {
    trtc,
    isJoined,
    isMuted,
    agentState,
    botError,
    subtitles,
    metrics,
    join,
    leave,
    setMuted,
    sendInterrupt,
  }
}
