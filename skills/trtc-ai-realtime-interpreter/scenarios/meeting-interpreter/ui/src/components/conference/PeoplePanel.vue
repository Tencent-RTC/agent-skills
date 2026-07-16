<script setup lang="ts">
import { computed } from 'vue'
import { Users, X, Mic, MicOff, Sparkles } from 'lucide-vue-next'
import {
  useRoomParticipantState,
  RoomParticipantRole,
  DeviceStatus,
} from 'tuikit-atomicx-vue3/room'
import { useAppStore } from '@/store'

const emit = defineEmits<{ (e: 'close'): void }>()

const app = useAppStore()
const { participantList, localParticipant, speakingUsers, kickParticipant, getParticipantList } = useRoomParticipantState()

const isHost = computed(() => app.state.isHost || localParticipant.value?.role === RoomParticipantRole.Owner)

const visibleParticipants = computed(() =>
  participantList.value.filter(
    (p: any) => !p.userId.endsWith('_lsnr') && !p.userId.startsWith('ai_'),
  ),
)

const displayList = computed(() => {
  const list: any[] = visibleParticipants.value.map((p: any) => ({ ...p, _ai: false }))
  if (app.state.aiOn) {
    list.unshift({ userId: '__ai_host__', nameCard: 'AI Host', userName: 'AI Host', role: -1, microphoneStatus: DeviceStatus.On, _ai: true })
  }
  return list
})
const count = computed(() => displayList.value.length)

function roleLabel(p: any) {
  if (p._ai) return 'AI Agent'
  if (p.role === RoomParticipantRole.Owner) return 'Host'
  if (p.role === RoomParticipantRole.Admin) return 'Admin'
  return 'Member'
}
function nameOf(p: any) {
  if (p.userId === localParticipant.value?.userId) {
    return app.state.displayName || p.nameCard || p.userName || p.userId
  }
  return p.nameCard || p.userName || p.userId
}
function initials(name: string) {
  const n = (name || '').trim()
  return n ? n.slice(0, 2).toUpperCase() : '?'
}
async function onKick(userId: string) {
  try {
    await kickParticipant({ userId })
    await getParticipantList({})
  } catch (e) {
    console.error('kick failed', e)
  }
}
</script>

<template>
  <div class="chat-head">
    <div class="chat-head-title">
      <Users :size="13" /> People<span class="chat-head-sub">· {{ count }} in meeting</span>
    </div>
    <button class="side-close" title="Close" @click="emit('close')"><X :size="15" /></button>
  </div>
  <div class="stream">
    <div v-for="p in displayList" :key="p.userId" class="people-item">
      <div class="people-avatar" :class="p._ai ? 'bot' : p.role === RoomParticipantRole.Owner ? 'host' : 'guest'">
        <Sparkles v-if="p._ai" :size="14" />
        <template v-else>{{ initials(nameOf(p)) }}</template>
      </div>
      <div class="people-info">
        <div class="people-name">
          {{ nameOf(p) }}
          <span v-if="p.userId === localParticipant?.userId" class="self-tag">you</span>
        </div>
        <div class="people-role">{{ roleLabel(p) }}</div>
      </div>
      <span v-if="p._ai" class="people-status speaking">
        <Sparkles :size="11" /><span class="dot"></span>Translating
      </span>
      <span v-else class="people-status" :class="{ speaking: (speakingUsers.get(p.userId) ?? 0) > 0, muted: p.microphoneStatus !== DeviceStatus.On }">
        <Mic v-if="p.microphoneStatus === DeviceStatus.On" :size="11" />
        <MicOff v-else :size="11" />
        <span class="dot"></span>
        {{ (speakingUsers.get(p.userId) ?? 0) > 0 ? 'Speaking' : p.microphoneStatus === DeviceStatus.On ? 'On' : 'Muted' }}
      </span>
      <button v-if="isHost && !p._ai && p.userId !== localParticipant?.userId" class="kick-btn" @click="onKick(p.userId)">Remove</button>
    </div>
    <div v-if="!count" class="empty-hint">Loading participants…</div>
  </div>
</template>

<style scoped>
/* 成员面板：深色玻璃，与侧栏一体化 */
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
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.stream::-webkit-scrollbar { width: 5px; }
.stream::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 3px; }
.people-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: background 0.15s;
}
.people-item:hover { background: rgba(255, 255, 255, 0.04); }
.people-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font: 600 12px/1 sans-serif;
  flex-shrink: 0;
}
.people-avatar.host { background: linear-gradient(135deg, #3b82f6, #2563eb); }
.people-avatar.guest { background: linear-gradient(135deg, #475569, #334155); }
.people-avatar.bot {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: 1px solid rgba(147, 197, 253, 0.4);
}
.people-info { flex: 1; min-width: 0; }
.people-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #f1f5f9;
  display: flex;
  align-items: center;
  gap: 6px;
}
.self-tag {
  font-size: 9px;
  font-weight: 600;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}
.people-role { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
.people-status {
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  color: #94a3b8;
}
.people-status .dot { width: 5px; height: 5px; border-radius: 50%; background: #475569; }
.people-status.speaking { color: #6ee7b7; font-weight: 500; }
.people-status.speaking .dot { background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15); }
.kick-btn {
  font-size: 10px;
  color: #fca5a5;
  padding: 3px 7px;
  border-radius: 6px;
  border: 1px solid rgba(248, 113, 113, 0.25);
  background: transparent;
  flex-shrink: 0;
}
.kick-btn:hover { background: rgba(248, 113, 113, 0.1); }
.empty-hint { margin: auto; color: #64748b; font-size: 12.5px; }
</style>
