<script setup lang="ts">
import type { SceneView } from '@engine/src/features/scene'

/**
 * 成人場景開始前的確認框（scene_gate，LEWD_SYSTEM 3.1 節；UI 第 10 節）：和誰、性質、目的、略過時怎麼算；進入或略過。
 * 所有參與者都是成年人。略過的結果（契合與體悟）是引擎直接算的，這裡只說明。
 */
defineProps<{ view: SceneView; title: string; busy: boolean }>()
defineEmits<{ (e: 'enter'): void; (e: 'skip'): void }>()
</script>

<template>
  <div class="gate" role="dialog" aria-modal="true" aria-label="成人場景的確認" data-gate>
    <div class="box panel cut pad">
      <h3>{{ title }}</h3>
      <p>接下來可能是一場成人場景。你可以自己操作，或略過，讓這一段寫成敘事並自動結算。所有參與者都是成年人。</p>
      <div class="kv"><span>和誰</span><b data-gate-who>{{ view.people.partner.name }}</b></div>
      <div v-if="view.place" class="kv"><span>在哪裡</span><b>{{ view.place }}</b></div>
      <div class="kv"><span>性質</span><b data-gate-nature>{{ view.nature_name }}<template v-if="view.role !== 'none'">（{{ view.role_name }}）</template></b></div>
      <div class="kv"><span>目的</span><b data-gate-goal>{{ view.goal ? view.goal.name : '沒有' }}</b></div>
      <div class="kv"><span>略過時</span><b>不操作：照雙方的數值直接算出契合，體悟打折，這一段寫成敘事</b></div>
      <div class="go">
        <button type="button" class="btn sm" data-skip :class="{ 'is-unavailable': busy }" @click="$emit('skip')">略過</button>
        <button type="button" class="btn sm pri" data-enter @click="$emit('enter')">進入場景</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: var(--z-sheet); padding: var(--space-4); }
.box { width: min(480px, 100%); display: grid; gap: var(--space-2); background: var(--bg-1); }
h3 { margin: 0; }
p { margin: 4px 0; color: var(--ink-2); line-height: 1.7; }
</style>
