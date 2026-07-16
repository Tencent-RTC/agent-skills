<script setup lang="ts">
import { computed, ref, watch, onUnmounted, nextTick } from 'vue'
import { Mic, MicOff, Video, VideoOff, MonitorUp, Languages, MessageSquare, Users, PhoneOff } from 'lucide-vue-next'
import { useDeviceState, DeviceStatus, useRoomParticipantState, RoomParticipantRole } from 'tuikit-atomicx-vue3/room'
import { modes } from '@/store'

const props = defineProps<{
  activePanel: 'chat' | 'people' | 'transcript' | null
  isHost: boolean
  attendeeCount: number
  aiOn: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-panel', panel: 'chat' | 'people' | 'transcript'): void
  (e: 'leave'): void
  (e: 'start-ai', mode: string, ttsEnabled: boolean): void
  (e: 'stop-ai'): void
}>()

const {
  microphoneStatus,
  openLocalMicrophone,
  closeLocalMicrophone,
  cameraStatus,
  openLocalCamera,
  closeLocalCamera,
  screenStatus,
  startScreenShare,
  stopScreenShare,
} = useDeviceState()
const { localParticipant } = useRoomParticipantState()

const isHost = computed(() => props.isHost || localParticipant.value?.role === RoomParticipantRole.Owner)
const aiTooltipShown = ref(false)
const aiPopoverOpen = ref(false)
const ttsEnabled = ref(false)

// AI popover 打开时：点击页面任何非 popover 区域都关闭它
function onDocPointerDown(e: PointerEvent) {
  const target = e.target as Node
  // ai-wrapRef 是按钮 + popover 的共同父容器，落在它内部的点击不处理
  if (aiWrapRef.value && aiWrapRef.value.contains(target)) return
  aiPopoverOpen.value = false
}
const aiWrapRef = ref<HTMLElement | null>(null)
watch(aiPopoverOpen, (open) => {
  if (open) {
    nextTick(() => document.addEventListener('pointerdown', onDocPointerDown))
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown)
  }
})
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))

async function toggleMic() {
  if (microphoneStatus.value === DeviceStatus.On) await closeLocalMicrophone()
  else await openLocalMicrophone()
}
async function toggleCam() {
  if (cameraStatus.value === DeviceStatus.On) await closeLocalCamera()
  else await openLocalCamera()
}
async function toggleShare() {
  if (screenStatus.value === DeviceStatus.On) await stopScreenShare()
  else await startScreenShare()
}
function onAiClick() {
  if (!isHost.value) {
    aiTooltipShown.value = true
    setTimeout(() => (aiTooltipShown.value = false), 1600)
    return
  }
  if (props.aiOn) emit('stop-ai')
  else aiPopoverOpen.value = !aiPopoverOpen.value
}
function pickMode(mode: string) {
  aiPopoverOpen.value = false
  emit('start-ai', mode, ttsEnabled.value)
}
</script>

<template>
  <div class="toolbar-wrap">
    <div class="toolbar">
      <button class="tb-btn" :class="{ active: microphoneStatus === DeviceStatus.On }" @click="toggleMic" title="Mic">
        <span class="tb-ico">
          <Mic v-if="microphoneStatus === DeviceStatus.On" :size="17" />
          <MicOff v-else :size="17" />
        </span>
        <span class="tb-label">Mic</span>
      </button>
      <button class="tb-btn" :class="{ active: cameraStatus === DeviceStatus.On }" @click="toggleCam" title="Camera">
        <span class="tb-ico"><Video v-if="cameraStatus === DeviceStatus.On" :size="17" /><VideoOff v-else :size="17" /></span>
        <span class="tb-label">Camera</span>
      </button>
      <button class="tb-btn" :class="{ active: screenStatus === DeviceStatus.On }" @click="toggleShare" title="Share">
        <span class="tb-ico"><MonitorUp :size="17" /></span>
        <span class="tb-label">Share</span>
      </button>

      <div class="ai-wrap" ref="aiWrapRef">
        <button
          class="tb-btn ai-btn"
          :class="{ on: aiOn }"
          @click="onAiClick"
          @mouseenter="!isHost && (aiTooltipShown = true)"
          @mouseleave="aiTooltipShown = false"
          title="AI Translate"
        >
          <span class="tb-ico"><Languages :size="17" /></span>
          <span class="tb-label">{{ aiOn ? 'AI On' : 'AI Translate' }}</span>
          <span v-if="aiTooltipShown" class="ai-tooltip">Only the host can start AI Translate</span>
        </button>
        <div v-if="aiPopoverOpen" class="ai-popover">
          <div class="ap-title">Select a translation pair</div>
          <button v-for="m in modes" :key="m.id" class="ap-item" @click="pickMode(m.id)">
            <span class="ap-pair">{{ m.a }} ⇄ {{ m.b }}</span>
            <span class="ap-hint">{{ m.hint }}</span>
          </button>
          <div class="ap-divider"></div>
          <label class="ap-tts-row">
            <span class="ap-tts-label">Read translations aloud</span>
            <span class="ap-tts-toggle">
              <input type="checkbox" v-model="ttsEnabled" />
              <span class="ap-tts-slider"></span>
            </span>
          </label>
        </div>
      </div>

      <button class="tb-btn" :class="{ active: activePanel === 'transcript' }" @click="emit('toggle-panel', 'transcript')" title="Transcript">
        <span class="tb-ico"><MessageSquare :size="17" /></span>
        <span class="tb-label">Transcript</span>
      </button>
      <button class="tb-btn" :class="{ active: activePanel === 'chat' }" @click="emit('toggle-panel', 'chat')" title="Chat">
        <span class="tb-ico"><MessageSquare :size="17" /></span>
        <span class="tb-label">Chat</span>
      </button>
      <button class="tb-btn" :class="{ active: activePanel === 'people' }" @click="emit('toggle-panel', 'people')" title="People">
        <span class="tb-ico"><Users :size="17" /></span>
        <span class="tb-label">People {{ attendeeCount }}</span>
      </button>

      <span class="tb-divider"></span>

      <button class="leave-btn" @click="emit('leave')">
        <PhoneOff :size="14" />
        <span>{{ isHost ? 'End' : 'Leave' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar-wrap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 18px;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 20;
}
.toolbar {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 5px 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  color: #cbd5e1;
}
.tb-btn {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 11px;
  background: transparent;
  color: #cbd5e1;
  transition: background 0.15s, color 0.15s, transform 0.15s;
  min-width: 60px;
  margin: 0 2px;
}
.tb-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.tb-btn.active {
  background: rgba(59, 130, 246, 0.25);
  color: #fff;
}
.tb-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
}
.tb-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
}

/* AI 按钮：默认虚线描边 + 紫色图标，和选中态(实心蓝填充)区分开 */
.ai-btn {
  margin: 0 6px;
  border: 1px dashed rgba(167, 139, 250, 0.5);
  color: #c4b5fd;
}
.ai-btn .tb-ico { color: #a78bfa; }
.ai-btn:hover {
  background: rgba(167, 139, 250, 0.1);
  color: #fff;
}
.ai-btn:hover .tb-ico { color: #c4b5fd; }

.tb-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 2px;
}
.ai-wrap { position: relative; }
.ai-btn.on {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  border: 1px solid rgba(196, 181, 253, 0.5);
  color: #fff;
  flex-direction: row;
  gap: 6px;
  padding: 6px 14px;
  min-width: 60px;
}
.ai-btn.on .tb-ico,
.ai-btn.on .tb-label { color: #fff; }
.ai-tooltip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  background: #0f172a;
  color: #fff;
  font-size: 11.5px;
  padding: 6px 12px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.ai-tooltip::after {
  content: '';
  position: absolute;
  top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #0f172a;
}
.ai-popover {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  padding: 8px;
  width: 220px;
  z-index: 30;
}
.ap-title {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: #94a3b8;
  padding: 6px 8px 4px;
  text-transform: uppercase;
}
.ap-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  background: transparent;
  transition: background 0.15s;
  color: #e2e8f0;
}
.ap-item:hover { background: rgba(255, 255, 255, 0.06); }
.ap-pair { font-size: 13px; font-weight: 600; }
.ap-hint { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
.ap-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 6px 4px;
}
.ap-tts-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}
.ap-tts-row:hover { background: rgba(255, 255, 255, 0.06); }
.ap-tts-label { font-size: 12.5px; font-weight: 500; color: #e2e8f0; }
.ap-tts-toggle {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 19px;
  flex-shrink: 0;
}
.ap-tts-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.ap-tts-slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.5);
  transition: background 0.2s;
  cursor: pointer;
}
.ap-tts-slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.ap-tts-toggle input:checked + .ap-tts-slider {
  background: #7c3aed;
}
.ap-tts-toggle input:checked + .ap-tts-slider::before {
  transform: translateX(15px);
}

.leave-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(220, 38, 38, 0.85);
  color: #fff;
  font-size: 11.5px;
  font-weight: 500;
  margin-left: 2px;
  transition: background 0.18s;
}
.leave-btn:hover { background: rgba(185, 28, 28, 0.95); }
</style>
