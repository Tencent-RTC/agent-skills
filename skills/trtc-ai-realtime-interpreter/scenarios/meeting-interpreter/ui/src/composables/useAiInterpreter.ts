import { ref, computed } from 'vue'
import TRTC from 'trtc-sdk-v5'
import { useRoomParticipantState } from 'tuikit-atomicx-vue3/room'
import { useAppStore } from '@/store'
import {
  startSession,
  stopSession,
  fetchSessionState,
} from '@/api/backend'

/**
 * Layer 2 · AI 实时翻译模块（mock 集成，独立于 Conference 把 AI 当成员）。
 *
 * - 主持人开关 → 后端按当前真实参会人扇出多路 StartAIConversation（每路 TargetUserId 绑定一个真人）。
 * - 另起 trtc-sdk-v5 静默旁听客户端（strRoomId 进同一房间，autoReceiveAudio=false 不播音频，只收 CUSTOM_MESSAGE），
 *   解析 cmd 10000 字幕 / cmd 10001 AI 状态，渲染统一转写面板。
 * - 字幕发送者用「载荷里的 data.sender」字段判定（ASR 原文=说话人 userId；AI 译文=bot userId），
 *   而非 TRTC 传输层的 event.userId（后者始终是 bot）。
 */
export type AgentState = 'idle' | 'listen' | 'translate' | 'speak'

export interface TranscriptItem {
  speaker: string
  orig: string
  trans: string
  time: string
}

export function useAiInterpreter() {
  const app = useAppStore()
  const { participantList } = useRoomParticipantState()

  const aiOn = ref(false)
  const agentState = ref<AgentState>('idle')
  const transcript = ref<TranscriptItem[]>([])
  const botUserIds = ref<Set<string>>(new Set())
  const busy = ref(false)

  // 当前进行中的气泡（原文 + 译文累加，round end 后归档）
  const curSpeaker = ref('')
  const curOrig = ref('')
  const curTrans = ref('')

  let listenerClient: any = null
  let meetingStartTs = 0

  function nowTime() {
    if (!meetingStartTs) meetingStartTs = Date.now()
    const t = Math.floor((Date.now() - meetingStartTs) / 1000)
    const m = String(Math.floor(t / 60)).padStart(2, '0')
    const s = String(t % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  function speakerName(userId: string): string {
    const p: any = participantList.value.find((x: any) => x.userId === userId)
    return p?.nameCard || p?.userName || userId
  }

  /** 当前真实参会人（排除 listener 与 bot 身份）——扇出目标。 */
  function realParticipants(): string[] {
    return participantList.value
      .map((p: any) => p.userId)
      .filter((id: string) => !id.endsWith('_lsnr') && !id.startsWith('ai_'))
  }

  function setAgentState(st: AgentState) {
    agentState.value = st
  }

  function setAiOn(on: boolean) {
    aiOn.value = on
    app.setAiOn(on)
  }

  function handleCustomMessage(event: any) {
    let text: string
    try {
      text = new TextDecoder().decode(event.data)
    } catch {
      return
    }
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return
    }
    // 关键：用载荷里的 data.sender（逻辑发送者），不是 TRTC 传输层 event.userId
    const sender: string = data.sender || event.userId || ''
    const payload = data.payload || {}

    if (data.type === 10000) {
      const raw = (payload.text || '').trim()
      if (!raw) return
      const isBot = botUserIds.value.has(sender)
      if (isBot) {
        // AI 译文（或欢迎语）。若本回合还没有人类说话人，则记为 AI Host
        if (!curSpeaker.value) curSpeaker.value = 'AI Host'
        curTrans.value = raw
        setAgentState('speak')
      } else {
        // 某个人类参会人的 ASR 原文
        curSpeaker.value = speakerName(sender)
        curOrig.value = raw
        if (payload.end !== true) setAgentState('translate')
      }
    } else if (data.type === 10001) {
      const st = payload.state
      if (st === 1) {
        // 本回合结束 -> 归档
        if (curOrig.value || curTrans.value) {
          transcript.value.push({
            speaker: curSpeaker.value || 'AI Host',
            orig: curOrig.value,
            trans: curTrans.value,
            time: nowTime(),
          })
        }
        curSpeaker.value = ''
        curOrig.value = ''
        curTrans.value = ''
        setAgentState('listen')
      } else if (st === 2) {
        setAgentState('translate')
      } else if (st === 3) {
        setAgentState('speak')
      }
    }
  }

  async function startListener() {
    const cfg = app.state.config
    if (!cfg || listenerClient) return
    const client = TRTC.create({ assetsPath: 'https://web.sdk.qcloud.com/trtc/webrtc/v5/assets/' })
    listenerClient = client
    client.on(TRTC.EVENT.CUSTOM_MESSAGE, handleCustomMessage)
    client.on(TRTC.EVENT.ERROR, (e: any) => console.error('[AI listener error]', e))
    await client.enterRoom({
      strRoomId: app.state.roomId,
      scene: 'rtc' as any,
      sdkAppId: cfg.sdkappid,
      userId: cfg.listener_userid,
      userSig: cfg.listener_usersig,
      // 旁听客户端不播音频：避免与 Conference 客户端重复播放 bot 的 TTS（多条问候语叠放）
      autoReceiveAudio: false,
    } as any)
    // 静默旁听：不 startLocalAudio / startLocalVideo
  }

  async function stopListener() {
    if (!listenerClient) return
    try {
      await listenerClient.exitRoom()
    } catch {
      /* ignore */
    }
    try {
      listenerClient.destroy()
    } catch {
      /* ignore */
    }
    listenerClient = null
  }

  /** 主持人开启 AI 翻译（按当前参会人扇出）。 */
  async function start(mode: string, ttsEnabled: boolean) {
    if (busy.value || aiOn.value) return
    busy.value = true
    try {
      const cfg = app.state.config
      const res = await startSession({
        roomId: app.state.roomId,
        roomIdType: 1, // Conference 字符串房间号
        callerUserId: cfg?.userid || '',
        mode,
        participants: realParticipants(),
        ttsEnabled,
      })
      if (!res.bots || res.bots.length === 0) {
        throw new Error('翻译会话启动失败：没有成功启动任何翻译 bot')
      }
      botUserIds.value = new Set((res.bots || []).map((b) => b.botUserId))
      app.setMode(mode)
      transcript.value = []
      curSpeaker.value = ''
      curOrig.value = ''
      curTrans.value = ''
      meetingStartTs = Date.now()
      await startListener()
      setAiOn(true)
      setAgentState('listen')
    } catch (e) {
      // 不吞错误：re-throw 让调用方（ConferenceRoom.vue 的 onStartAi）能 catch 并展示给用户
      console.error('[AI Interpreter] start failed:', e)
      throw e
    } finally {
      busy.value = false
    }
  }

  /** 主持人关闭 AI 翻译。 */
  async function stop() {
    if (busy.value) return
    busy.value = true
    try {
      const cfg = app.state.config
      await stopSession({ roomId: app.state.roomId, callerUserId: cfg?.userid || '' })
      await stopListener()
      setAiOn(false)
      botUserIds.value = new Set()
      setAgentState('idle')
      curSpeaker.value = ''
      curOrig.value = ''
      curTrans.value = ''
    } finally {
      busy.value = false
    }
  }

  /**
   * 同步当前房间 AI 状态（幂等）：
   *   active 且未开 -> 启动旁听 + 置开启
   *   active 且已开 -> 仅刷新 botUserIds
   *   未开启且已开 -> 停止旁听 + 置关闭
   * 非主持人进房/轮询时调用，以感知主持人开关。
   */
  async function syncState() {
    try {
      const st = await fetchSessionState(app.state.roomId)
      if (st.active) {
        botUserIds.value = new Set((st.bots || []).map((b) => b.botUserId))
        if (st.mode) app.setMode(st.mode)
        if (!aiOn.value) {
          setAiOn(true)
          setAgentState('listen')
          await startListener()
        }
      } else if (aiOn.value) {
        await stopListener()
        setAiOn(false)
        setAgentState('idle')
      }
    } catch (e) {
      console.error('AI syncState failed', e)
    }
  }

  return {
    aiOn,
    agentState,
    transcript,
    busy,
    curBubble: computed(() => ({
      speaker: curSpeaker.value,
      orig: curOrig.value,
      trans: curTrans.value,
    })),
    start,
    stop,
    syncState,
  }
}
