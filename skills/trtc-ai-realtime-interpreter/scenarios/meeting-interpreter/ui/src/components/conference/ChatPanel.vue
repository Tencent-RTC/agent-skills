<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MessageSquare, Send, X } from 'lucide-vue-next'
import { useMessageListState, useMessageInputState } from 'tuikit-atomicx-vue3/chat'
import { useRoomParticipantState } from 'tuikit-atomicx-vue3/room'

const emit = defineEmits<{ (e: 'close'): void }>()

const { messageList } = useMessageListState()
const { inputRawValue, updateRawValue, sendMessage } = useMessageInputState()
const { localParticipant } = useRoomParticipantState()

const streamEl = ref<HTMLElement | null>(null)

const inputText = computed({
  get: () => (typeof inputRawValue.value === 'string' ? inputRawValue.value : ''),
  set: (v: string) => updateRawValue(v),
})

const items = computed(() =>
  (messageList.value ?? [])
    .filter((m: any) => m?.payload?.text)
    .map((m: any) => ({
      id: m.ID ?? m.id ?? Math.random(),
      name: m.nick || m.from || 'Guest',
      text: String(m.payload.text),
      me: m.isSelf ?? m.from === localParticipant.value?.userId,
    })),
)

watch(
  () => items.value.length,
  async () => {
    await nextTick()
    if (streamEl.value) streamEl.value.scrollTop = streamEl.value.scrollHeight
  },
)

async function handleSend() {
  if (!inputText.value.trim()) return
  try {
    await sendMessage()
    inputText.value = ''
  } catch (e) {
    console.error('send failed', e)
  }
}
</script>

<template>
  <div class="chat-head">
    <div class="chat-head-title">
      <MessageSquare :size="13" /> Chat<span class="chat-head-sub">· Everyone</span>
    </div>
    <button class="side-close" title="Close" @click="emit('close')"><X :size="15" /></button>
  </div>
  <div ref="streamEl" class="stream chat-stream">
    <div v-for="m in items" :key="m.id" class="chat-msg" :class="{ me: m.me }">
      <div class="chat-meta">
        <template v-if="!m.me"><b>{{ m.name }}</b></template>
        <span>{{ m.me ? 'You' : '' }}</span>
      </div>
      <div class="chat-body">{{ m.text }}</div>
    </div>
    <div v-if="!items.length" class="empty-hint">No messages yet</div>
  </div>
  <div class="chat-input-row">
    <input
      class="chat-input"
      placeholder="Message everyone…"
      :value="inputText"
      @input="(e) => (inputText = (e.target as HTMLInputElement).value)"
      @keyup.enter="handleSend"
    />
    <button class="chat-send" @click="handleSend"><Send :size="14" /></button>
  </div>
</template>

<style scoped>
/* 聊天面板：深色玻璃，与侧栏一体化 */
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  flex-shrink: 0;
}
.chat-head-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #f1f5f9;
}
.chat-head-sub {
  color: #94a3b8;
  font-weight: 400;
  font-size: 11.5px;
  margin-left: 2px;
}
.side-close {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition: background 0.15s;
}
.side-close:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.stream {
  flex: 1;
  overflow-y: auto;
  padding: 4px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.stream::-webkit-scrollbar { width: 5px; }
.stream::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 3px; }
.chat-msg { display: flex; flex-direction: column; gap: 3px; animation: rise 0.3s ease both; }
@keyframes rise { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: none;} }
.chat-meta {
  font-size: 11px;
  color: #94a3b8;
  display: flex;
  gap: 6px;
  align-items: center;
}
.chat-meta b { color: #f1f5f9; font-weight: 600; font-size: 12px; }
.chat-body {
  font-size: 13px;
  color: #f1f5f9;
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 12px;
  border-radius: 12px;
  border-top-left-radius: 4px;
  align-self: flex-start;
  max-width: 88%;
  word-break: break-word;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.chat-msg.me .chat-body {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  align-self: flex-end;
  border-top-left-radius: 12px;
  border-top-right-radius: 4px;
  border-color: transparent;
}
.chat-msg.me .chat-meta { justify-content: flex-end; }
.empty-hint { margin: auto; color: #64748b; font-size: 12.5px; }
.chat-input-row {
  display: flex;
  gap: 6px;
  padding: 10px 14px 14px;
  flex-shrink: 0;
}
.chat-input {
  flex: 1;
  padding: 9px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12.5px;
  outline: none;
  color: #f1f5f9;
}
.chat-input::placeholder { color: #64748b; }
.chat-input:focus {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(255, 255, 255, 0.08);
}
.chat-send {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
