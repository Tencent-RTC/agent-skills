<script setup lang="ts">
import ChatPanel from './ChatPanel.vue'
import PeoplePanel from './PeoplePanel.vue'
import TranscriptPanel from './TranscriptPanel.vue'
import type { AgentState, TranscriptItem } from '@/composables/useAiInterpreter'

defineProps<{
  activePanel: 'chat' | 'people' | 'transcript' | null
  transcript: TranscriptItem[]
  curBubble: { speaker: string; orig: string; trans: string }
  agentState: AgentState
  mode: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <aside class="side-panel" :class="{ open: activePanel !== null }">
    <div class="side-inner">
      <div class="pane" :class="{ hidden: activePanel !== 'transcript' }">
        <TranscriptPanel
          :transcript="transcript"
          :cur-bubble="curBubble"
          :agent-state="agentState"
          :mode="mode"
          @close="emit('close')"
        />
      </div>
      <div class="pane" :class="{ hidden: activePanel !== 'chat' }">
        <ChatPanel @close="emit('close')" />
      </div>
      <div class="pane" :class="{ hidden: activePanel !== 'people' }">
        <PeoplePanel @close="emit('close')" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 侧栏：与主区同玻璃面，无 border-left，无独立 bg，形成一体 */
.side-panel {
  width: 0;
  flex-shrink: 0;
  overflow: hidden;
  background: transparent;
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  position: relative;
}
.side-panel::before {
  /* 仅一道极淡的分隔线 */
  content: '';
  position: absolute;
  left: 0;
  top: 18px;
  bottom: 18px;
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
}
.side-panel.open {
  width: 380px;
}
.side-inner {
  width: 380px;
  height: 100%;
  position: relative;
}
.pane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pane.hidden { display: none; }
</style>
