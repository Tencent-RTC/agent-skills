<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  RoomView,
  RoomLayoutTemplate,
  useRoomState,
  useRoomParticipantState,
  RoomEvent,
  RoomParticipantEvent,
} from 'tuikit-atomicx-vue3/room'
import { useConversationListState } from 'tuikit-atomicx-vue3/chat'
import TopBar from './TopBar.vue'
import Toolbar from './Toolbar.vue'
import SidePanel from './SidePanel.vue'
import ParticipantViewUI from './ParticipantViewUI.vue'
import { useConference } from '@/composables/useConference'
import { useAiInterpreter } from '@/composables/useAiInterpreter'
import { useAppStore } from '@/store'

const app = useAppStore()
const { currentRoom, leave, end } = useConference()
const { participantList, participantWithScreen, getParticipantList, localParticipant, subscribeEvent: subscribeParticipantEvent, unsubscribeEvent: unsubscribeParticipantEvent } = useRoomParticipantState()
const { setActiveConversation } = useConversationListState()
const { subscribeEvent: subscribeRoomEvent, unsubscribeEvent: unsubscribeRoomEvent } = useRoomState()

const ai = useAiInterpreter()

watch(
  () => currentRoom.value?.roomId,
  async (rid) => {
    if (rid) {
      await getParticipantList({})
      setActiveConversation(`GROUP${rid}`)
      ai.syncState()
    }
  },
  { immediate: true },
)

const manualLayout = ref<'grid' | 'sidebar'>('grid')
const layout = computed(() => (participantWithScreen.value ? 'sidebar' : manualLayout.value))
const layoutTemplate = computed(() =>
  layout.value === 'sidebar' ? RoomLayoutTemplate.SidebarLayout : RoomLayoutTemplate.GridLayout,
)
function toggleLayout() {
  manualLayout.value = manualLayout.value === 'grid' ? 'sidebar' : 'grid'
}

const activePanel = ref<'chat' | 'people' | 'transcript' | null>(null)
function togglePanel(p: 'chat' | 'people' | 'transcript') {
  activePanel.value = activePanel.value === p ? null : p
}
watch(
  () => ai.aiOn.value,
  (on) => {
    if (on) activePanel.value = 'transcript'
  },
)

// 与 People 面板一致的计数：过滤掉 listener(_lsnr) 与 bot(ai_)，AI 开启时 +1 个 mock AI Host
const attendeeCount = computed(() => {
  const real = participantList.value.filter(
    (p: any) => !p.userId.endsWith('_lsnr') && !p.userId.startsWith('ai_'),
  ).length
  return real + (ai.aiOn.value ? 1 : 0)
})
const isHost = computed(() => app.state.isHost || localParticipant.value?.role === 1)

const aiError = ref('')

async function onStartAi(mode: string, ttsEnabled: boolean) {
  aiError.value = ''
  try {
    await ai.start(mode, ttsEnabled)
    activePanel.value = 'transcript'
  } catch (e: any) {
    const msg = e?.message || String(e)
    aiError.value = msg
    console.error('start AI failed', e)
  }
}
async function onStopAi() {
  aiError.value = ''
  try {
    await ai.stop()
  } catch (e: any) {
    aiError.value = e?.message || String(e)
    console.error('stop AI failed', e)
  }
}

const agentLabel = computed(() => {
  switch (ai.agentState.value) {
    case 'listen':
      return 'Listening'
    case 'translate':
      return 'Translating'
    case 'speak':
      return 'Speaking'
    default:
      return 'AI Interpreter'
  }
})

const showEndedDialog = ref(false)
const showKickedDialog = ref(false)
const leavingSelf = ref(false)
function onRoomEnded() {
  if (leavingSelf.value) return
  showEndedDialog.value = true
}
function confirmEnded() {
  showEndedDialog.value = false
  app.setFinalTranscript([...ai.transcript.value])
  app.setScreen('summary')
}
function onKickedFromRoom() {
  if (leavingSelf.value) return
  showKickedDialog.value = true
}
function confirmKicked() {
  showKickedDialog.value = false
  app.setFinalTranscript([...ai.transcript.value])
  app.setScreen('summary')
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let stageObserver: MutationObserver | null = null

const stageEl = ref<HTMLElement | null>(null)
// grid 中 AI 瓦片控制：
//   aiOn=true → 永远只显示 1 个 bot 瓦片（第一个）
//   aiOn=false → 所有 bot 瓦片全部隐藏（即便 SDK participantList 里有残留）
function applyBotTileFilter() {
  const root = stageEl.value
  if (!root) return
  const tiles = root.querySelectorAll<HTMLElement>('.participant-view')
  let firstKept = false
  tiles.forEach((el) => {
    const isBot = !!el.querySelector('.pvui[data-bot="1"]')
    if (!isBot) {
      el.style.display = ''
      return
    }
    if (ai.aiOn.value && !firstKept) {
      el.style.display = ''
      firstKept = true
    } else {
      el.style.display = 'none'
    }
  })
}
function scheduleFilter() {
  nextTick(() => {
    applyBotTileFilter()
    // 兜底：RoomView 渲染是异步的，再多等一帧确保新瓦片已挂载
    requestAnimationFrame(() => applyBotTileFilter())
  })
}
watch(
  () => [participantList.value, layout.value, ai.aiOn.value],
  scheduleFilter,
  { deep: true, immediate: true },
)

onMounted(() => {
  subscribeRoomEvent(RoomEvent.onRoomEnded, onRoomEnded)
  subscribeParticipantEvent(RoomParticipantEvent.onKickedFromRoom, onKickedFromRoom)
  pollTimer = setInterval(() => ai.syncState(), 5000)
  // 监听 stage 子树变化：新瓦片插入/移除都立即重过滤
  if (stageEl.value) {
    stageObserver = new MutationObserver(() => scheduleFilter())
    stageObserver.observe(stageEl.value, { childList: true, subtree: true })
  }
})
onUnmounted(() => {
  unsubscribeRoomEvent(RoomEvent.onRoomEnded, onRoomEnded)
  unsubscribeParticipantEvent(RoomParticipantEvent.onKickedFromRoom, onKickedFromRoom)
  if (pollTimer) clearInterval(pollTimer)
  stageObserver?.disconnect()
  stageObserver = null
})

async function onLeave() {
  leavingSelf.value = true
  if (ai.aiOn.value) {
    try {
      await ai.stop()
    } catch {
      /* ignore */
    }
  }
  app.setFinalTranscript([...ai.transcript.value])
  try {
    if (isHost.value) await end()
    else await leave()
  } catch (e) {
    console.error('leave failed', e)
  }
  app.setScreen('summary')
}
</script>

<template>
  <section class="conf-outer">
    <div class="conf-shell">
      <div class="conf-main">
        <TopBar
          :room-name="app.state.roomName || currentRoom?.roomName || 'Meeting'"
          :room-id="app.state.roomId"
          :layout="layout"
          :ai-on="ai.aiOn.value"
          :agent-state="ai.agentState.value"
          :agent-label="agentLabel"
          :mode="app.state.mode"
          :can-control-ai="isHost"
          @toggle-layout="toggleLayout"
          @stop-ai="onStopAi"
        />

        <div class="conf-stage" ref="stageEl">
          <div class="stage-head">
            <span class="stage-title">Participants</span>
            <span class="stage-meta">{{ attendeeCount }} in room · {{ layout === 'grid' ? 'Grid view' : 'Sidebar view' }}</span>
          </div>
          <div class="stage-body">
            <RoomView :layout-template="layoutTemplate">
              <template #participantViewUI="{ participant, streamType }">
                <ParticipantViewUI v-if="participant" :participant="participant" :stream-type="streamType" />
              </template>
            </RoomView>
          </div>
        </div>

        <Toolbar
          :active-panel="activePanel"
          :is-host="isHost"
          :attendee-count="attendeeCount"
          :ai-on="ai.aiOn.value"
          @toggle-panel="togglePanel"
          @leave="onLeave"
          @start-ai="onStartAi"
          @stop-ai="onStopAi"
        />
      </div>

      <SidePanel
        :active-panel="activePanel"
        :transcript="ai.transcript.value"
        :cur-bubble="ai.curBubble.value"
        :agent-state="ai.agentState.value"
        :mode="app.state.mode"
        @close="activePanel = null"
      />

      <div v-if="showEndedDialog" class="ended-mask">
        <div class="ended-dialog">
          <div class="ended-title">Meeting Ended</div>
          <div class="ended-desc">The host has ended the meeting.</div>
          <button class="ended-ok" @click="confirmEnded">OK</button>
        </div>
      </div>

      <div v-if="showKickedDialog" class="ended-mask">
        <div class="ended-dialog">
          <div class="ended-title">Removed from Meeting</div>
          <div class="ended-desc">You have been removed from the meeting by the host.</div>
          <button class="ended-ok" @click="confirmKicked">Got it</button>
        </div>
      </div>

      <div v-if="aiError" class="ai-error-toast">
        <span class="ai-error-icon">!</span>
        <span class="ai-error-msg">{{ aiError }}</span>
        <button class="ai-error-close" @click="aiError = ''">OK</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 整体：蓝色渐变背景 + 一体化深色玻璃卡片 */
.conf-outer {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(80% 60% at 20% 10%, #1e3a8a 0%, transparent 60%),
    radial-gradient(70% 60% at 90% 100%, #1d4ed8 0%, transparent 55%),
    linear-gradient(180deg, #0b1224 0%, #0a0f1f 100%);
  padding: 14px;
  overflow: hidden;
  display: flex;
}
.conf-shell {
  flex: 1;
  display: flex;
  flex-direction: row;
  border-radius: 22px;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(28px) saturate(140%);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  color: #e2e8f0;
}
.conf-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

/* 舞台：不再有白色内框，瓦片直接落在深色玻璃面上 */
.conf-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 8px 16px 110px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px 12px;
  flex-shrink: 0;
}
.stage-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #e2e8f0;
  letter-spacing: 0.01em;
}
.stage-meta {
  font-size: 11px;
  color: #94a3b8;
}
.stage-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 14px;
}
.stage-body :deep(.room-view),
.stage-body :deep(> div) {
  height: 100%;
}
/* RoomView 默认白底瓦片在深色玻璃上太刺眼，做个轻调暗与圆角 */
.stage-body :deep(.atomicx-participant-view) {
  border-radius: 14px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.5);
}
/* Atomicx GridLayout 的瓦片列表默认 flex-start 左对齐，单人时贴左很丑：仅改为居中，不破坏原宽度计算 */
.stage-body :deep(.stream-list-content) {
  place-content: center center !important;
}

/* agent-bar 已移至 TopBar，舞台不再覆盖任何悬浮状态条 */

/* 会议结束 / 被移除对话框 */
.ended-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.ended-dialog {
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  padding: 28px 32px 24px;
  width: 360px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  text-align: center;
  color: #e2e8f0;
}
.ended-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.ended-desc {
  margin-top: 8px;
  font-size: 13.5px;
  color: #94a3b8;
  line-height: 1.5;
}
.ended-ok {
  margin-top: 20px;
  width: 100%;
  padding: 11px 0;
  border-radius: 12px;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  transition: filter 0.18s;
}
.ended-ok:hover { filter: brightness(1.1); }

.ai-error-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 12px;
  background: rgba(220, 38, 38, 0.95);
  backdrop-filter: blur(16px);
  color: #fff;
  font-size: 13px;
  max-width: 600px;
  z-index: 2000;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.ai-error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.ai-error-msg { flex: 1; line-height: 1.4; }
.ai-error-close {
  padding: 4px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
  transition: background 0.15s;
}
.ai-error-close:hover { background: rgba(255, 255, 255, 0.35); }
</style>
