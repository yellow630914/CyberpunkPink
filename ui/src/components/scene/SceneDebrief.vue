<script setup lang="ts">
import type { Debrief } from '../../lib/scene/sceneView'

/**
 * 成人場景結束之後的戰報卡（UI.md 第 10 節）：評價、體悟、關係與傾向的變化、餘韻，和引擎結算的那一份報告一樣（引擎的 results 與 changes 照列）。
 * AI 開著時多一段整場的正文（成人路由）；成人的報告卡預設展開，設定的「折疊成人內容」打開時才收起來。
 */
defineProps<{ debrief: Debrief; fold: boolean; leaveText: string }>()
defineEmits<{ (e: 'leave'): void }>()
</script>

<template>
  <div class="gate" role="dialog" aria-modal="true" aria-label="成人場景的戰報" data-report>
    <div class="box panel cut pad">
      <h3>這一場結束了：{{ debrief.reasonName }}</h3>
      <div v-if="debrief.fit !== null" class="kv"><span>契合</span><b data-report-fit>{{ debrief.fit }}・{{ debrief.rating }}</b></div>
      <div v-if="debrief.insight !== null" class="kv"><span>體悟</span><b data-report-insight>+{{ debrief.insight }}</b></div>
      <ul class="res" data-report-results><li v-for="(r, i) in debrief.results" :key="i">{{ r }}</li></ul>
      <div v-if="debrief.changes.length" class="chg" data-report-changes>
        <span v-for="(c, i) in debrief.changes" :key="i" class="tag" :class="c.kind">{{ c.text }}</span>
      </div>
      <p v-for="(n, i) in debrief.notices" :key="'n' + i" class="t-fine">{{ n }}</p>
      <details v-if="debrief.text.length" class="prose" :open="!fold" data-report-text>
        <summary>整場的文字</summary>
        <p v-for="(p, i) in debrief.text" :key="i">{{ p }}</p>
      </details>
      <p v-else class="t-fine">沒有整場的文字：AI 關著時，只有上面的結算。</p>
      <div class="go"><button type="button" class="btn sm pri" data-leave @click="$emit('leave')">{{ leaveText }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.gate { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: var(--z-sheet); padding: var(--space-4); overflow-y: auto; }
.box { width: min(520px, 100%); display: grid; gap: var(--space-2); background: var(--bg-1); max-height: 100%; overflow-y: auto; }
h3 { margin: 0; }
.res { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; }
.chg { display: flex; gap: 6px; flex-wrap: wrap; }
.prose p { margin: 4px 0; color: var(--ink-2); line-height: var(--lh-prose, 1.8); }
.prose summary { cursor: pointer; font-weight: 800; }
</style>
