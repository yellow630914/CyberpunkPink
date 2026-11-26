<script setup lang="ts">
import type { CircleRec } from '@engine/src/features/scene'
import Hint from '../Hint.vue'

/**
 * 別的圈（不展開，UI 第 10 節）：每圈一行字——誰和誰、契合到什麼程度、這一回合引擎給的一句、有人到了幾次。
 * 數字與句子都是引擎的（sceneView.circles）；換圈與叫人過來是行動列的兩個行動（灰掉帶引擎的原因），這裡不判斷。
 */
defineProps<{ circles: CircleRec[]; nameOf: (id: string) => string; ratingOf: (fit: number) => string }>()
</script>

<template>
  <section v-if="circles.length > 0" class="panel cut pad circles" data-circles>
    <p class="h">別的圈<Hint>不展開的圈在旁邊一起算：每回合一個契合與感載，一行字說他們現在怎麼樣。主角可以花行動點換過去，或把那一圈的一個人叫過來。</Hint></p>
    <div v-for="c in circles" :key="c.id" class="ci" :data-circle="c.id">
      <b>{{ c.people.map(nameOf).join('、') }}</b>
      <span class="mono">契合 {{ c.fit }}・{{ ratingOf(c.fit) }}</span>
      <span v-if="Object.values(c.climax).some((n) => n > 0)" class="t-fine">{{ c.people.filter((id) => (c.climax[id] ?? 0) > 0).map((id) => `${nameOf(id)}到了 ${c.climax[id]} 次`).join('、') }}</span>
      <span v-if="c.out?.length" class="t-fine">{{ c.out.map(nameOf).join('、') }}已經退出</span>
      <span v-if="c.line" class="ln" data-circle-line>{{ c.line }}</span>
    </div>
  </section>
</template>

<style scoped>
.circles { display: grid; gap: var(--space-2); min-width: 0; }
.ci { display: flex; gap: 4px var(--space-3); align-items: baseline; flex-wrap: wrap; padding: 6px 10px; background: var(--bg-2); font-size: var(--fs-sm); min-width: 0; }
.ci .ln { flex-basis: 100%; color: var(--ink-2); font-size: var(--fs-fine); overflow-wrap: anywhere; }
</style>
