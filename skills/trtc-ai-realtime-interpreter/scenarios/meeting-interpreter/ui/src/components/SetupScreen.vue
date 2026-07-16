<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Video, ArrowRight, Loader, Users, ArrowLeft } from 'lucide-vue-next'
import { useConference } from '@/composables/useConference'
import { useAppStore } from '@/store'
import { fetchHealth, type HealthInfo } from '@/api/backend'

const app = useAppStore()
const { login, createRoom, joinExistingRoom } = useConference()

const mode = ref<'create' | 'join'>('create')
const name = ref('')
const joinRoomId = ref('')
const micOn = ref(false)
const camOn = ref(false)
const loading = ref(false)
const error = ref('')
const health = ref<HealthInfo | null>(null)

onMounted(async () => {
  try {
    health.value = await fetchHealth()
  } catch {
    error.value = '无法连接后端（/api/v1/health），请确认 backend 已通过 start.sh 启动。'
  }
})

function genRoomId() {
  return `room_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

async function doCreate() {
  if (!name.value.trim() || loading.value) return
  loading.value = true
  error.value = ''
  try {
    app.setDisplayName(name.value.trim())
    await login(name.value.trim())
    const rid = genRoomId()
    await createRoom(rid, `${name.value.trim()}'s Meeting`)
    app.setScreen('conference')
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function doJoin() {
  if (!name.value.trim() || !joinRoomId.value.trim() || loading.value) return
  loading.value = true
  error.value = ''
  try {
    app.setDisplayName(name.value.trim())
    await login(name.value.trim())
    await joinExistingRoom(joinRoomId.value.trim(), { micOn: micOn.value, camOn: camOn.value })
    app.setScreen('conference')
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="setup-outer">
    <div class="setup-card">
      <div class="eyebrow">
        <span class="dot"></span>STEP 01 · SETUP
      </div>
      <h2 class="title">
        Meeting with <span class="italic font-serif">AI Live Translator</span>
      </h2>
      <p class="desc">
        Enter your name to create or join a meeting. The host can start AI real-time translation in-meeting and pick a language pair.
      </p>

      <div v-if="error" class="alert">{{ error }}</div>
      <div v-else-if="health && health.status !== 'ok'" class="alert">
        Backend credentials missing: {{ health.missing?.join(', ') }} (configure them in backend/.env and restart)
      </div>

      <div class="flip-stage">
        <Transition name="flip" mode="out-in">
          <!-- Create 面板 -->
          <div v-if="mode === 'create'" key="create" class="panel">
            <div class="field">
              <div class="field-label">YOUR NAME</div>
              <input v-model="name" class="input" placeholder="e.g. Sarah Chen" />
            </div>
            <div class="actions">
              <button class="btn-primary" :class="{ disabled: !name.trim() || loading }" :disabled="!name.trim() || loading" @click="doCreate">
                <Loader v-if="loading" :size="16" class="animate-spin" />
                <Video v-else :size="16" />
                <span>Create Meeting</span>
                <ArrowRight :size="16" />
              </button>
              <button class="btn-secondary" @click="mode = 'join'">
                <Users :size="15" />
                <span>Join existing</span>
              </button>
            </div>
          </div>

          <!-- Join 面板 -->
          <div v-else key="join" class="panel">
            <button class="back-btn" @click="mode = 'create'">
              <ArrowLeft :size="15" />
              <span>Back</span>
            </button>
            <div class="field">
              <div class="field-label">YOUR NAME</div>
              <input v-model="name" class="input" placeholder="e.g. Sarah Chen" />
            </div>
            <div class="field">
              <div class="field-label">ROOM ID</div>
              <input v-model="joinRoomId" class="input mono" placeholder="room_xxxxxx" />
            </div>
            <div class="toggles">
              <label class="toggle-row">
                <span class="toggle-text">Microphone on when joining</span>
                <button type="button" class="toggle" :class="{ on: micOn }" @click="micOn = !micOn">
                  <span class="knob"></span>
                </button>
              </label>
              <label class="toggle-row">
                <span class="toggle-text">Camera on when joining</span>
                <button type="button" class="toggle" :class="{ on: camOn }" @click="camOn = !camOn">
                  <span class="knob"></span>
                </button>
              </label>
            </div>
            <button class="btn-primary" :class="{ disabled: !name.trim() || !joinRoomId.trim() || loading }" :disabled="!name.trim() || !joinRoomId.trim() || loading" @click="doJoin">
              <Loader v-if="loading" :size="16" class="animate-spin" />
              <Users v-else :size="16" />
              <span>Join Meeting</span>
              <ArrowRight :size="16" />
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </section>
</template>

<style scoped>
.setup-outer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(80% 60% at 20% 10%, #1e3a8a 0%, transparent 60%),
    radial-gradient(70% 60% at 90% 100%, #1d4ed8 0%, transparent 55%),
    linear-gradient(180deg, #0b1224 0%, #0a0f1f 100%);
  overflow: auto;
}
/* 固定加大容器，保证一屏完整可见 */
.setup-card {
  width: 100%;
  max-width: 720px;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(28px) saturate(140%);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 22px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  padding: 34px 44px 38px;
  color: #e2e8f0;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.22em;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 8px;
}
.eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
}
.title {
  margin-top: 10px;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.15;
  color: #f1f5f9;
  white-space: nowrap;
}
.title .italic { color: #cbd5e1; }
.desc {
  margin-top: 10px;
  font-size: 13.5px;
  color: #94a3b8;
  line-height: 1.6;
  max-width: 560px;
}
.alert {
  margin-top: 14px;
  font-size: 12.5px;
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.2);
  padding: 10px 14px;
  border-radius: 12px;
}

/* 翻页舞台：从右往左滑出 */
.flip-stage {
  margin-top: 22px;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.flip-enter-active,
.flip-leave-active {
  transition: transform 0.34s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.24s ease;
}
.flip-enter-from {
  transform: translateX(70px);
  opacity: 0;
}
.flip-leave-to {
  transform: translateX(-70px);
  opacity: 0;
}

.field { display: flex; flex-direction: column; gap: 8px; }
.field-label {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: #94a3b8;
}
.input {
  width: 100%;
  max-width: 480px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
  font-size: 14.5px;
  outline: none;
  transition: border 0.15s, background 0.15s;
}
.input.mono { font-family: 'SF Mono', monospace; font-size: 13.5px; }
.input::placeholder { color: #64748b; }
.input:focus {
  border-color: rgba(59, 130, 246, 0.6);
  background: rgba(255, 255, 255, 0.08);
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: flex-start;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  padding: 12px 22px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 500;
  transition: filter 0.2s ease;
}
.btn-primary:hover:not(.disabled) { filter: brightness(1.1); }
.btn-primary.disabled { background: rgba(148, 163, 184, 0.3); cursor: not-allowed; }
.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e2e8f0;
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.15s;
}
.btn-secondary:hover { background: rgba(255, 255, 255, 0.12); }

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 12px 6px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  font-size: 12.5px;
  transition: background 0.15s;
}
.back-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

/* 开关 */
.toggles {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  max-width: 480px;
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.toggle-text { font-size: 12.5px; color: #cbd5e1; }
.toggle {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e2e8f0;
  transition: transform 0.2s, background 0.2s;
}
.toggle.on {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  border-color: transparent;
}
.toggle.on .knob {
  transform: translateX(16px);
  background: #fff;
}

.animate-spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
