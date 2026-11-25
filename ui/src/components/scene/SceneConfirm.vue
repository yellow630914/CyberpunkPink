<script setup lang="ts">
import { ref } from 'vue'
import type { SceneView, StartSummary } from '@engine/src/features/scene'
import DirectionField from './DirectionField.vue'

/**
 * 成人場景開始前的確認框（scene_gate，LEWD_SYSTEM 3.1 節；UI 第 10 節）：誰、性質、身分、目的、會碰到的標籤、是不是單人、在哪一層、不展開的別的圈——
 * 全是引擎 startProblems 給的摘要（summary），這裡不判斷第幾步、不推論任何事。進入或略過；略過旁邊一格選填的「想怎麼發生」，原樣交給略過的那一步。
 * 所有參與者都是成年人。略過的結果（契合與體悟）是引擎直接算的，這裡只說明。
 * summary 問不出來（引擎擋下）時退回場景畫面資料裡有的名字。
 */
const props = defineProps<{ view: SceneView; summary: StartSummary | null; title: string; busy: boolean; aiLive: boolean }>()
const emit = defineEmits<{ (e: 'enter'): void; (e: 'skip', direction: string): void }>()
const direction = ref('')
const withNames = (): string => (props.summary ? props.summary.with.map((x) => x.name).join('、') : props.view.seats.slice(1).map((x) => x.name).join('、'))
const circleText = (c: Array<{ name: string }>): string => c.map((x) => x.name).join('、')
</script>

<template>
  <div class="gate" role="dialog" aria-modal="true" aria-label="成人場景的確認" data-gate>
    <div class="box panel cut pad">
      <h3>{{ title }}</h3>
      <p>接下來可能是一場成人場景。你可以自己操作，或略過，讓這一段寫成敘事並自動結算。所有參與者都是成年人。</p>
      <div v-if="summary?.kind === 'solo' || view.kind === 'solo'" class="kv"><span>這一場</span><b data-gate-who>獨自一人<template v-if="summary?.audience !== undefined">（{{ summary.audience ? '有人在看' : '沒有人在看' }}）</template></b></div>
      <div v-else class="kv"><span>和誰</span><b data-gate-who>{{ withNames() }}</b></div>
      <div v-if="summary?.circles?.length" class="kv" data-gate-circles><span>旁邊的圈</span><b>{{ summary.circles.map(circleText).join('；') }}</b></div>
      <div v-if="summary?.layer === 'net' || view.layer === 'net'" class="kv" data-gate-layer><span>在哪一層</span><b>內海<template v-if="summary?.dream">（夢）</template></b></div>
      <div v-if="view.place" class="kv"><span>在哪裡</span><b>{{ view.place }}</b></div>
      <div class="kv"><span>性質</span><b data-gate-nature>{{ summary?.nature_name ?? view.nature_name }}<template v-if="(summary?.role ?? view.role) !== 'none'">（{{ summary?.role_name ?? view.role_name }}）</template></b></div>
      <div class="kv"><span>目的</span><b data-gate-goal>{{ (summary?.goal ?? view.goal)?.name ?? '沒有' }}</b></div>
      <div v-if="summary?.tags.length" class="kv" data-gate-tags><span>會碰到</span><b class="chips"><span v-for="t in summary.tags" :key="t.id" class="tag">{{ t.name }}</span></b></div>
      <div v-if="summary?.filters.length" class="kv" data-gate-filters><span>內容篩選</span><b class="chips"><span v-for="f in summary.filters" :key="f.tag" class="tag">{{ f.name }}</span></b></div>
      <div v-if="summary?.reveal?.length" class="kv" data-gate-reveal><span>一眼看出</span><b><template v-for="(r, i) in summary.reveal" :key="r.id">{{ i ? '；' : '' }}{{ r.name }}：{{ r.axis ? `${r.axis.name} ${r.axis.level} 級` : '' }}{{ r.tag ? r.tag.name : '' }}</template></b></div>
      <div class="kv"><span>略過時</span><b>不操作：照雙方的數值直接算出契合，體悟打折，這一段寫成敘事</b></div>
      <DirectionField v-model="direction" :live="aiLive" />
      <div class="go">
        <button type="button" class="btn sm" data-skip :class="{ 'is-unavailable': busy }" @click="emit('skip', direction)">略過</button>
        <button type="button" class="btn sm pri" data-enter @click="emit('enter')">進入場景</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: var(--z-sheet); padding: var(--space-4); overflow-y: auto; }
.box { width: min(520px, 100%); display: grid; gap: var(--space-2); background: var(--bg-1); max-height: 100%; overflow-y: auto; }
h3 { margin: 0; }
p { margin: 4px 0; color: var(--ink-2); line-height: 1.7; }
.chips { display: inline-flex; gap: 6px; flex-wrap: wrap; }
</style>
