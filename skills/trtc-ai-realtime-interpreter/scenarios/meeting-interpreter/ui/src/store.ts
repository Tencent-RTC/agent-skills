import { reactive, readonly } from 'vue'
import type { BackendConfig } from './api/backend'

// 全局应用状态（模块级单例，简单场景不引入 Pinia）。
// 三屏：'setup' → 'conference' → 'summary'
type Screen = 'setup' | 'conference' | 'summary'

export interface TranscriptItem {
  speaker: string
  orig: string
  trans: string
  time: string
}

interface AppState {
  screen: Screen
  displayName: string
  // 当前用户凭据（由后端签发）
  config: BackendConfig | null
  // 当前会议房间
  roomId: string
  roomName: string
  isHost: boolean
  // AI 翻译语言对（zh-en / zh-yue / en-yue）
  mode: string
  // AI 翻译是否开启（供 People 面板等读取，做 mock AI Host 显示）
  aiOn: boolean
  // 会话结束后的完整转录稿（供最后一屏展示）
  finalTranscript: TranscriptItem[]
}

const state = reactive<AppState>({
  screen: 'setup',
  displayName: '',
  config: null,
  roomId: '',
  roomName: '',
  isHost: false,
  mode: 'zh-en',
  aiOn: false,
  finalTranscript: [],
})

export const modes = [
  {
    id: 'zh-en',
    label: 'ZH ⇄ EN',
    a: 'Chinese',
    b: 'English',
    desc: 'Speak Chinese or English — AI translates bidirectionally and voices the translation.',
    hint: 'Mandarin <-> English',
  },
  {
    id: 'zh-yue',
    label: 'ZH ⇄ YUE',
    a: 'Chinese',
    b: 'Cantonese',
    desc: 'Speak Mandarin or Cantonese — AI relays each side in real time.',
    hint: 'Mandarin <-> Cantonese',
  },
  {
    id: 'en-yue',
    label: 'EN ⇄ YUE',
    a: 'English',
    b: 'Cantonese',
    desc: 'Speak English or Cantonese — instant bidirectional interpretation.',
    hint: 'English <-> Cantonese',
  },
]

export function useAppStore() {
  return {
    state: readonly(state),
    setScreen(s: Screen) {
      state.screen = s
    },
    setDisplayName(name: string) {
      state.displayName = name
    },
    setConfig(cfg: BackendConfig) {
      state.config = cfg
    },
    setRoom(roomId: string, roomName: string, isHost: boolean) {
      state.roomId = roomId
      state.roomName = roomName
      state.isHost = isHost
    },
    setMode(mode: string) {
      state.mode = mode
    },
    setAiOn(on: boolean) {
      state.aiOn = on
    },
    setFinalTranscript(items: TranscriptItem[]) {
      state.finalTranscript = items
    },
    resetRoom() {
      state.roomId = ''
      state.roomName = ''
      state.isHost = false
    },
  }
}
