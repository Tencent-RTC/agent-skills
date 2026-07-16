/**
 * 实时翻译字幕/状态自定义消息解析器（框架无关，不依赖任何 UI 库）。
 *
 * TRTC Conversational AI 通过 CUSTOM_MESSAGE 广播两类消息：
 *   - cmd 10000：字幕（可能是某个真人的 ASR 原文，也可能是 AI 的译文/欢迎语）
 *   - cmd 10001：AI 状态（1=本轮结束 / 2=思考中(翻译中) / 3=正在播报）
 *
 * sender 归属判断：消息载荷里的 `data.sender` 是"逻辑发送者"（真人的 userId 或
 * bot 的 userId），不是 TRTC 传输层的 event.userId（后者在单目标模式下也可能不是
 * 真正的说话人）。命中 botUserIds 集合 -> 认为是 AI 译文；否则是某个真人的原文。
 *
 * 使用方式：
 *   const parser = createSubtitleParser({
 *     isBot: (userId) => botUserIds.has(userId),
 *     resolveSpeakerName: (userId) => participantList.find(...)?.nameCard || userId,
 *     onBubbleUpdate: (bubble) => { ... },      // 当前气泡（说话人/原文/译文）更新
 *     onArchive: (item) => { ... },              // 一轮结束，归档一条完整转写记录
 *     onAgentState: (state) => { ... },           // idle/listen/translate/speak
 *   })
 *   silentListener.onCustomMessage((event) => parser.handle(event))
 */

export type AgentState = 'idle' | 'listen' | 'translate' | 'speak'

export interface TranscriptItem {
  speaker: string
  orig: string
  trans: string
  time: string
}

export interface CurrentBubble {
  speaker: string
  orig: string
  trans: string
}

export interface SubtitleParserOptions {
  /** 判断某个 userId 是否为 AI bot 身份 */
  isBot: (userId: string) => boolean
  /** 把真人 userId 解析成展示名（昵称），找不到则原样返回 userId */
  resolveSpeakerName: (userId: string) => string
  /** 计时起点距今的 mm:ss 格式化（调用方可传入自己的计时逻辑），默认从第一次调用起计时 */
  nowTime?: () => string
  onBubbleUpdate?: (bubble: CurrentBubble) => void
  onArchive?: (item: TranscriptItem) => void
  onAgentState?: (state: AgentState) => void
}

export interface SubtitleParserHandle {
  handle: (event: any) => void
  reset: () => void
  getTranscript: () => TranscriptItem[]
  getCurrentBubble: () => CurrentBubble
}

function defaultNowTime(startRef: { ts: number }) {
  return () => {
    if (!startRef.ts) startRef.ts = Date.now()
    const t = Math.floor((Date.now() - startRef.ts) / 1000)
    const m = String(Math.floor(t / 60)).padStart(2, '0')
    const s = String(t % 60).padStart(2, '0')
    return `${m}:${s}`
  }
}

export function createSubtitleParser(opts: SubtitleParserOptions): SubtitleParserHandle {
  const transcript: TranscriptItem[] = []
  let curSpeaker = ''
  let curOrig = ''
  let curTrans = ''
  const startRef = { ts: 0 }
  const nowTime = opts.nowTime || defaultNowTime(startRef)

  function emitBubble() {
    opts.onBubbleUpdate?.({ speaker: curSpeaker, orig: curOrig, trans: curTrans })
  }

  function handle(event: any): void {
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
    const sender: string = data.sender || event.userId || ''
    const payload = data.payload || {}

    if (data.type === 10000) {
      const raw = (payload.text || '').trim()
      if (!raw) return
      if (opts.isBot(sender)) {
        if (!curSpeaker) curSpeaker = 'AI Interpreter'
        curTrans = raw
        emitBubble()
        opts.onAgentState?.('speak')
      } else {
        curSpeaker = opts.resolveSpeakerName(sender)
        curOrig = raw
        emitBubble()
        if (payload.end !== true) opts.onAgentState?.('translate')
      }
    } else if (data.type === 10001) {
      const st = payload.state
      if (st === 1) {
        if (curOrig || curTrans) {
          const item: TranscriptItem = { speaker: curSpeaker || 'AI Interpreter', orig: curOrig, trans: curTrans, time: nowTime() }
          transcript.push(item)
          opts.onArchive?.(item)
        }
        curSpeaker = ''
        curOrig = ''
        curTrans = ''
        emitBubble()
        opts.onAgentState?.('listen')
      } else if (st === 2) {
        opts.onAgentState?.('translate')
      } else if (st === 3) {
        opts.onAgentState?.('speak')
      }
    }
  }

  function reset(): void {
    transcript.length = 0
    curSpeaker = ''
    curOrig = ''
    curTrans = ''
    startRef.ts = 0
    emitBubble()
  }

  return {
    handle,
    reset,
    getTranscript: () => transcript,
    getCurrentBubble: () => ({ speaker: curSpeaker, orig: curOrig, trans: curTrans }),
  }
}
