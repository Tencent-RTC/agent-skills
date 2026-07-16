<script setup lang="ts">
import { computed } from 'vue'
import { Mic, MicOff, Sparkles } from 'lucide-vue-next'
import {
  DeviceStatus,
  RoomParticipantRole,
  VideoStreamType,
  useRoomParticipantState,
} from 'tuikit-atomicx-vue3/room'
import type { RoomParticipant } from 'tuikit-atomicx-vue3/room'
import { useAppStore } from '@/store'

const props = defineProps<{ participant: RoomParticipant; streamType: VideoStreamType }>()

const app = useAppStore()
const { speakingUsers, localParticipant } = useRoomParticipantState()

const isMicOn = computed(() => props.participant.microphoneStatus === DeviceStatus.On)
const isSpeaking = computed(() => (speakingUsers.value.get(props.participant.userId) ?? 0) > 0)
const isCameraOff = computed(() => props.participant.cameraStatus !== DeviceStatus.On)
// AI 机器人（StartAIConversation 扇出的 bot 进了 TUIRoomEngine 的成员列表）统一显示为 AI Host
const isBot = computed(() => props.participant.userId.startsWith('ai_'))
// 本地用户：SDK 的 local 名字可能未及时反映 setSelfInfo（降级成 userId），直接用输入的名字
const isLocal = computed(() => props.participant.userId === localParticipant.value?.userId)
const displayName = computed(() => {
  if (isBot.value) return 'AI Host'
  if (isLocal.value) return app.state.displayName || props.participant.nameCard || props.participant.userName || props.participant.userId
  return props.participant.nameCard || props.participant.userName || props.participant.userId
})
const isOwner = computed(() => props.participant.role === RoomParticipantRole.Owner)
const isAdmin = computed(() => props.participant.role === RoomParticipantRole.Admin)
const initials = computed(() => {
  if (isBot.value) return 'AI'
  const n = displayName.value.trim()
  if (!n) return '?'
  return n.slice(0, 2).toUpperCase()
})
const isScreenStream = computed(() => props.streamType === VideoStreamType.Screen)
</script>

<template>
  <div class="pvui" :class="{ speaking: isSpeaking && !isScreenStream }" :data-bot="isBot ? '1' : null">
    <!-- 摄像头关闭时的占位头像 -->
    <div v-if="isCameraOff && !isScreenStream" class="pvui-avatar">{{ initials }}</div>

    <!-- 右上角角色标 -->
    <span v-if="isBot && !isScreenStream" class="pvui-badge ai">AI</span>
    <span v-else-if="isOwner && !isScreenStream" class="pvui-badge">HOST</span>
    <span v-else-if="isAdmin && !isScreenStream" class="pvui-badge admin">ADMIN</span>

    <!-- 左下角名字 + 麦克风 -->
    <div v-if="!isScreenStream" class="pvui-name-chip">
      <span class="pvui-mic" :class="{ off: !isMicOn }">
        <Mic v-if="isMicOn" :size="11" />
        <MicOff v-else :size="11" />
      </span>
      <span class="pvui-name">{{ displayName }}</span>
    </div>

    <!-- 屏幕分享流的角标 -->
    <div v-else class="pvui-screen-chip">
      <Sparkles :size="11" />
      <span>{{ displayName }} · 共享屏幕</span>
    </div>
  </div>
</template>

<style scoped>
.pvui {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  overflow: hidden;
  pointer-events: none;
  transition: box-shadow 0.2s ease;
}
.pvui.speaking {
  box-shadow: inset 0 0 0 3px #3b7a57;
}
.pvui-avatar {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 82px;
  height: 82px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5a5d65, #2a2c31);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 600 26px/1 'Inter', sans-serif;
  letter-spacing: 0.02em;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35), inset 0 0 0 4px rgba(255, 255, 255, 0.06);
}
.pvui-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.pvui-badge.admin {
  background: rgba(192, 54, 44, 0.7);
}
.pvui-badge.ai {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  border: 1px solid rgba(147, 197, 253, 0.4);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.pvui-name-chip {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  background: rgba(15, 17, 21, 0.55);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 11.5px;
  font-weight: 500;
  max-width: calc(100% - 24px);
}
.pvui-mic {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #3b7a57;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.pvui-mic.off {
  background: #4b5563;
}
.pvui-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pvui-screen-chip {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(15, 17, 21, 0.6);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 11.5px;
  font-weight: 500;
}
</style>
