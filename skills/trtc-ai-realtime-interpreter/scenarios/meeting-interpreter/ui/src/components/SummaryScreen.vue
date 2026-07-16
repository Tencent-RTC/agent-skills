<script setup lang="ts">
import { ref } from 'vue'
import { FileText, Copy, RefreshCw } from 'lucide-vue-next'
import { useAppStore } from '@/store'

const app = useAppStore()
const copied = ref(false)

function copyAll() {
  const txt = (app.state.finalTranscript || [])
    .map((x) => `[${x.time}] ${x.speaker}: ${x.orig}${x.trans ? '  |  ' + x.trans : ''}`)
    .join('\n')
  try {
    navigator.clipboard.writeText(txt)
  } catch {
    /* ignore */
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <section class="sum-outer">
    <div class="sum-card">
      <div class="eyebrow">STEP 03 · TRANSCRIPT</div>
      <h2 class="title">
        Session Transcript <span class="italic font-serif dim">· Full Record</span>
      </h2>
      <p class="desc">Complete record of AI real-time translation from this session (original + translation).</p>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">
            <FileText :size="14" /> Full Transcript · {{ (app.state.finalTranscript || []).length }} entries
          </div>
          <div class="panel-actions">
            <button class="ghost-btn" @click="copyAll">
              <Copy :size="12" /><span>{{ copied ? 'Copied' : 'Copy' }}</span>
            </button>
            <button class="ghost-btn primary" @click="app.setScreen('setup')">
              <RefreshCw :size="12" /> Start Over
            </button>
          </div>
        </div>
        <div class="tr-scroll">
          <div v-if="!(app.state.finalTranscript || []).length" class="empty">
            No transcript captured in this session (AI Translate may not have been enabled, or no one spoke).
          </div>
          <div v-for="(t, i) in (app.state.finalTranscript || [])" :key="i" class="tr-row">
            <div class="tr-time">{{ t.time }}</div>
            <div class="tr-who">{{ t.speaker }}</div>
            <div>
              <div v-if="t.orig" class="tr-label">Original</div>
              <div v-if="t.orig" class="tr-text-o">{{ t.orig }}</div>
              <div v-if="t.trans" class="tr-text-t">
                <span class="tr-label" style="margin: 0 6px 0 0">Translation</span>{{ t.trans }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="foot">Transcript is kept for the current session only.</div>
    </div>
  </section>
</template>

<style scoped>
/* 与会议屏统一：蓝色渐变背景 + 深色玻璃卡片 */
.sum-outer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 24px;
  background:
    radial-gradient(80% 60% at 20% 10%, #1e3a8a 0%, transparent 60%),
    radial-gradient(70% 60% at 90% 100%, #1d4ed8 0%, transparent 55%),
    linear-gradient(180deg, #0b1224 0%, #0a0f1f 100%);
  overflow: auto;
}
.sum-card {
  width: 100%;
  max-width: 920px;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(28px) saturate(140%);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 22px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  padding: 36px 40px;
  color: #e2e8f0;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.22em;
  color: #94a3b8;
}
.title {
  margin-top: 10px;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #f1f5f9;
}
.title .dim { color: #475569; font-weight: 400; }
.title .italic { color: #cbd5e1; }
.desc {
  margin-top: 8px;
  font-size: 13.5px;
  color: #94a3b8;
}
.panel {
  margin-top: 24px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.panel-title {
  font-size: 12.5px;
  font-weight: 500;
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-actions { display: flex; gap: 8px; }
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
  color: #cbd5e1;
  transition: background 0.15s;
}
.ghost-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.ghost-btn.primary {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  border-color: transparent;
}
.tr-scroll {
  max-height: 520px;
  overflow-y: auto;
}
.tr-scroll::-webkit-scrollbar { width: 6px; }
.tr-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 3px; }
.tr-row {
  padding: 16px 18px;
  display: grid;
  grid-template-columns: 64px 130px 1fr;
  gap: 14px;
  align-items: start;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.tr-time {
  font: 500 11.5px/1.4 'SF Mono', monospace;
  color: #94a3b8;
  padding-top: 2px;
}
.tr-who { font-size: 12.5px; font-weight: 600; color: #f1f5f9; }
.tr-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  font-weight: 600;
  text-transform: uppercase;
  color: #94a3b8;
  margin-bottom: 2px;
}
.tr-text-o { font-size: 13.5px; color: #f1f5f9; line-height: 1.55; }
.tr-text-t {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.55;
  margin-top: 6px;
  padding-left: 10px;
  border-left: 2px solid rgba(147, 197, 253, 0.3);
}
.empty {
  padding: 40px;
  text-align: center;
  color: #64748b;
  font-size: 13px;
}
.foot { margin-top: 18px; font-size: 12px; color: #64748b; }
</style>
