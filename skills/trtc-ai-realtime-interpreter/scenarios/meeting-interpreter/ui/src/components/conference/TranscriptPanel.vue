<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import type { AgentState, TranscriptItem } from '@/composables/useAiInterpreter'

const props = defineProps<{
  transcript: TranscriptItem[]
  curBubble: { speaker: string; orig: string; trans: string }
  agentState: AgentState
  mode: string
}>()

defineEmits<{ (e: 'close'): void }>()

const streamEl = ref<HTMLElement | null>(null)

const stateLabel = computed(() => {
  switch (props.agentState) {
    case 'listen':
      return 'Listening…'
    case 'translate':
      return 'Translating…'
    case 'speak':
      return 'Speaking…'
    default:
      return 'Idle'
  }
})

const modeLabel = computed(() => {
  const map: Record<string, string> = { 'zh-en': 'ZH ⇄ EN', 'zh-yue': 'ZH ⇄ YUE', 'en-yue': 'EN ⇄ YUE' }
  return map[props.mode] || props.mode.toUpperCase()
})

const hasCur = computed(() => !!(props.curBubble.orig || props.curBubble.trans))

watch(
  () => [props.transcript.length, props.curBubble.orig, props.curBubble.trans],
  async () => {
    await nextTick()
    if (streamEl.value) streamEl.value.scrollTop = streamEl.value.scrollHeight
  },
)
</script>

<template>
  <div class="tp-root">
    <div class="tp-head">
      <div class="tp-title">
        <span class="tp-badge"><Sparkles :size="11" /> AI LIVE</span>
        <span class="tp-name">Transcript</span>
        <span class="tp-mode font-mono">{{ modeLabel }}</span>
      </div>
      <button class="tp-close" title="Close" @click="$emit('close')"><X :size="15" /></button>
    </div>

    <div class="tp-state" :class="agentState">
      <span class="wave"><i></i><i></i><i></i><i></i><i></i></span>
      <span>{{ stateLabel }}</span>
    </div>

    <div ref="streamEl" class="tp-stream">
      <div v-for="(t, i) in transcript" :key="i" class="tp-item">
        <div class="tp-h"><b>{{ t.speaker }}</b><span class="font-mono">{{ t.time }}</span></div>
        <div v-if="t.orig" class="tp-o"><span class="tp-lang">ORIG</span>{{ t.orig }}</div>
        <div v-if="t.trans" class="tp-t"><span class="tp-lang">TRANS</span>{{ t.trans }}</div>
      </div>

      <div v-if="hasCur" class="tp-item live">
        <div class="tp-h"><b>{{ curBubble.speaker || '…' }}</b><span class="font-mono">live</span></div>
        <div v-if="curBubble.orig" class="tp-o"><span class="tp-lang">ORIG</span>{{ curBubble.orig }}</div>
        <div v-if="curBubble.trans" class="tp-t"><span class="tp-lang">TRANS</span>{{ curBubble.trans }}</div>
      </div>

      <div v-if="!transcript.length && !hasCur" class="tp-empty">
        Waiting for speech. Once the host starts AI Translate, everyone's speech will be translated and shown here in real time.
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 转写面板：深色玻璃，与侧栏一体化 */
.tp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  color: #e2e8f0;
}
.tp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  flex-shrink: 0;
}
.tp-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.tp-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #f1f5f9;
}
.tp-mode {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
  letter-spacing: 0.04em;
}
.tp-close {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  background: transparent;
  transition: all 0.15s;
}
.tp-close:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.tp-state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px 10px;
  font-size: 11.5px;
  color: #94a3b8;
  flex-shrink: 0;
}
.tp-state.speak { color: #6ee7b7; }
.tp-state.translate { color: #fbbf24; }
.wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 12px;
}
.wave i {
  display: inline-block;
  width: 2px;
  height: 100%;
  background: currentColor;
  border-radius: 2px;
  animation: tpwave 1s ease-in-out infinite;
}
.wave i:nth-child(2) { animation-delay: 0.1s; }
.wave i:nth-child(3) { animation-delay: 0.2s; }
.wave i:nth-child(4) { animation-delay: 0.3s; }
.wave i:nth-child(5) { animation-delay: 0.4s; }
@keyframes tpwave { 0%,100% { transform: scaleY(0.3);} 50% { transform: scaleY(1);} }
.tp-state.idle .wave i { animation: none; transform: scaleY(0.3); opacity: 0.5; }
.tp-stream {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.tp-stream::-webkit-scrollbar { width: 5px; }
.tp-stream::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 3px; }
.tp-item { animation: rise 0.3s ease both; }
.tp-item.live { opacity: 0.9; }
@keyframes rise { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: none;} }
.tp-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: #94a3b8;
}
.tp-h b { color: #f1f5f9; font-weight: 600; font-size: 11.5px; }
.tp-o {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.55;
  color: #f1f5f9;
}
.tp-t {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.55;
  color: #94a3b8;
  padding-left: 8px;
  border-left: 2px solid rgba(147, 197, 253, 0.3);
}
.tp-lang {
  font-size: 8.5px;
  letter-spacing: 0.1em;
  font-weight: 700;
  color: #94a3b8;
  margin-right: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
}
.tp-empty {
  margin: auto;
  color: #64748b;
  font-size: 12px;
  text-align: center;
  line-height: 1.6;
  padding: 0 20px;
}
</style>
