<script setup lang="ts">
import { computed } from 'vue'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import { FULL_PAGES } from '../router'

/** 還沒重做的 Demo（docs/mockups/ 的複本，放在 public/legacy/）：第三版只剩成人場景用 iframe 接上。 */
const props = defineProps<{ demo: string }>()
const page = computed(() => FULL_PAGES.find(p => p.path === `/demo/${props.demo}`))
const src = computed(() => `${import.meta.env.BASE_URL}legacy/${page.value?.legacy ?? 'adult-scene.html'}`)
</script>

<template>
  <div class="legacy">
    <StatusBar back :title="page?.name ?? 'Demo'" />
    <div class="bar"><span class="tag">Demo</span><b>{{ page?.name }}</b><Hint title="舊的 Demo">這一頁是 docs/mockups 裡已經可以操作的 Demo，原封不動地接進來。三個戰場在第三版已經重做成元件（現實戰鬥、內海戰鬥、輿論戰）；成人場景還是舊 Demo，第四版照它重做。</Hint><a class="btn sm" :href="src" target="_blank" rel="noopener">在新分頁打開</a></div>
    <iframe :src="src" :title="page?.name" />
  </div>
</template>

<style scoped>
.legacy { height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 2px solid var(--line); flex-wrap: wrap; flex: none; }
.bar .btn { margin-left: auto; }
iframe { flex: 1; width: 100%; border: 0; background: #17111F; min-height: 0; }
</style>
