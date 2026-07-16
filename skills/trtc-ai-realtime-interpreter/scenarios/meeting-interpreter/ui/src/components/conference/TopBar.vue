<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { LayoutGrid, UserSquare2, Wifi, Copy, Check, Sparkles } from 'lucide-vue-next'
import { useDeviceState, NetworkQuality } from 'tuikit-atomicx-vue3/room'

const props = defineProps<{
  roomName: string
  roomId: string
  layout: 'grid' | 'sidebar'
  aiOn?: boolean
  agentState?: 'idle' | 'listen' | 'translate' | 'speak'
  agentLabel?: string
  mode?: string
  canControlAi?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-layout'): void
  (e: 'stop-ai'): void
}>()

const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
const timerText = computed(() => {
  const m = String(Math.floor(elapsed.value / 60)).padStart(2, '0')
  const s = String(elapsed.value % 60).padStart(2, '0')
  return `${m}:${s}`
})
onMounted(() => {
  timer = setInterval(() => elapsed.value++, 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const { networkInfo } = useDeviceState()
const netLabel = computed(() => {
  const q = networkInfo.value?.quality
  if (!q) return ''
  return ['', 'Excellent', 'Good', 'Fair', 'Poor', 'Very poor', 'Disconnected'][q] ?? ''
})
const netColor = computed(() => {
  const q = networkInfo.value?.quality
  if (!q) return '#94a3b8'
  if (q <= NetworkQuality.Good) return '#34d399'
  if (q <= NetworkQuality.Poor) return '#fbbf24'
  return '#f87171'
})

const copied = ref(false)
const roomIdShort = computed(() => (props.roomId ? props.roomId.slice(-10) : ''))
async function copyRoomId() {
  if (!props.roomId) return
  try {
    await navigator.clipboard.writeText(props.roomId)
  } catch {
    /* ignore */
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="conf-top">
    <div class="left">
      <span class="live-dot"></span>
      <span class="conf-title truncate">{{ roomName || 'Meeting' }}</span>
      <span class="font-mono timer">{{ timerText }}</span>
    </div>

    <div class="center">
      <div v-if="aiOn" class="agent-bar" :class="agentState">
        <span class="agent-avatar"><Sparkles :size="13" /></span>
        <span class="wave"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="agent-label">AI Interpreter · {{ agentLabel }}</span>
        <button
          class="agent-mode font-mono"
          :class="{ 'is-stop': canControlAi }"
          :title="canControlAi ? 'Click to stop AI Translate' : (mode || '').toUpperCase()"
          :disabled="!canControlAi"
          @click="canControlAi && emit('stop-ai')"
        >
          <span class="mode-text">{{ (mode || '').toUpperCase() }}</span>
          <span class="stop-text">Stop</span>
        </button>
      </div>
    </div>

    <div class="right">
      <button v-if="roomId" class="room-chip" :title="`Room ID: ${roomId} (click to copy)`" @click="copyRoomId">
        <Check v-if="copied" :size="11" />
        <Copy v-else :size="11" />
        <span class="font-mono">{{ roomIdShort }}</span>
      </button>
      <span v-if="netLabel" class="net-chip" :style="{ color: netColor }">
        <Wifi :size="12" />{{ netLabel }}
      </span>
      <button class="top-btn" @click="emit('toggle-layout')">
        <LayoutGrid v-if="layout === 'grid'" :size="13" />
        <UserSquare2 v-else :size="13" />
        <span>{{ layout === 'grid' ? 'Grid' : 'Sidebar' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 顶栏：透明背景，与下方舞台无缝衔接，浅色文字 */
.conf-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 10px;
  background: transparent;
  position: relative;
  z-index: 5;
  flex-shrink: 0;
}
.left, .right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 0 0 auto;
}
.center {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.conf-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #f1f5f9;
  max-width: 320px;
}
.timer {
  font-size: 12px;
  color: #94a3b8;
  margin-left: 2px;
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.22);
  flex-shrink: 0;
}
.room-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 11px;
  color: #cbd5e1;
  transition: all 0.15s;
  backdrop-filter: blur(10px);
}
.room-chip:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.net-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
}
.top-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 8px;
  font-size: 12px;
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.15s;
}
.top-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

/* AI 状态条：玻璃芯片，和顶栏 chip 同高 */
.agent-bar {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px 4px 4px;
  border-radius: 999px;
  background: rgba(30, 58, 138, 0.55);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(147, 197, 253, 0.35);
  color: #fff;
  box-shadow: 0 6px 20px rgba(29, 78, 216, 0.3);
  max-width: 100%;
}
.agent-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.agent-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.agent-mode {
  position: relative;
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.18);
  letter-spacing: 0.04em;
  white-space: nowrap;
  border: 1px solid transparent;
  color: inherit;
  font-family: inherit;
  cursor: default;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  overflow: hidden;
}
.agent-mode .stop-text { display: none; }
.agent-mode.is-stop {
  cursor: pointer;
}
.agent-mode.is-stop:hover {
  background: rgba(220, 38, 38, 0.85);
  color: #fff;
  border-color: rgba(254, 202, 202, 0.7);
}
.agent-mode.is-stop:hover .mode-text { display: none; }
.agent-mode.is-stop:hover .stop-text { display: inline; }
.wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 12px;
}
.wave i {
  display: inline-block;
  width: 2.5px;
  height: 100%;
  background: #fff;
  border-radius: 2px;
  animation: agwave 1s ease-in-out infinite;
}
.wave i:nth-child(2) { animation-delay: 0.1s; }
.wave i:nth-child(3) { animation-delay: 0.2s; }
.wave i:nth-child(4) { animation-delay: 0.3s; }
.wave i:nth-child(5) { animation-delay: 0.4s; }
@keyframes agwave {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}
.agent-bar.translate .wave i { background: #fbbf24; }
.agent-bar.speak .wave i { background: #8fd7b0; }
.agent-bar.idle .wave i { animation: none; transform: scaleY(0.3); opacity: 0.5; }

/* 主持人 hover 状态条：右侧出现 Stop 按钮（红色描边/填充） */
.agent-stop {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.18s, transform 0.18s, background 0.15s, border-color 0.15s, color 0.15s;
}
.agent-bar:hover .agent-stop,
.agent-stop:focus-visible {
  opacity: 1;
  transform: translateX(0);
  border-color: rgba(248, 113, 113, 0.55);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
}
.agent-stop:hover {
  background: rgba(220, 38, 38, 0.85);
  color: #fff;
  border-color: rgba(254, 202, 202, 0.7);
}
</style>
