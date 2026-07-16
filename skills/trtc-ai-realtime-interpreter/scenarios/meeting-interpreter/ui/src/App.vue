<script setup lang="ts">
import { useAppStore } from '@/store'
import SetupScreen from '@/components/SetupScreen.vue'
import ConferenceRoom from '@/components/conference/ConferenceRoom.vue'
import SummaryScreen from '@/components/SummaryScreen.vue'

const app = useAppStore()
</script>

<template>
  <div class="mx-auto" style="max-width: 1440px">
    <main class="min-w-0">
      <SetupScreen v-if="app.state.screen === 'setup'" />
      <ConferenceRoom v-else-if="app.state.screen === 'conference'" />
      <SummaryScreen v-else />
    </main>
  </div>
</template>
