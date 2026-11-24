<script setup lang="ts">
import { computed } from 'vue'
import MoneyTag from './MoneyTag.vue'
import type { EndRecord } from '../stores/engine'
import { endParts, endTitle, mazeResultOf } from '../lib/diveView'

/**
 * 自己潛進去的一趟離開時的結算（M3-ui-dive）：引擎報告的句子（敵對值、後門、丟掉的東西都是它寫的）、帶走的東西；
 * 迷宮館再加評價、獎金、獎品、籌碼與押金退了沒有（maze.result 的資料）。只顯示，不算。
 */
const props = defineProps<{ end: EndRecord }>()
const parts = computed(() => endParts(props.end))
const maze = computed(() => (props.end.maze ? mazeResultOf(props.end.maze.data) : null))
</script>

<template>
  <section class="end" data-end>
    <h3 data-end-title>{{ endTitle(end) }}<small>{{ end.region }}</small></h3>
    <p v-if="parts.head" class="sum" data-end-summary>{{ parts.head }}</p>
    <p v-for="(l, i) in parts.lines" :key="i" class="ln" data-end-line>{{ l }}</p>
    <div v-if="!maze" class="loot" data-end-loot>
      <template v-if="end.loot.length"><span class="tag">帶走</span><span v-for="(l, i) in end.loot" :key="i" class="tag ok">{{ l.name }}<template v-if="l.qty > 1"> ×{{ l.qty }}</template></span></template>
      <span v-else class="note">這一趟沒有帶走東西。</span>
    </div>
    <div v-if="maze" class="mz" data-maze-result>
      <div class="rate" :class="{ fail: !maze.done }"><b data-rating>{{ maze.done ? maze.rating : '—' }}</b><small>{{ maze.done ? `評價・獎金 ×${maze.mult}` : '沒闖過' }}</small></div>
      <div class="kv"><span>回合</span><b data-m-rounds>{{ maze.rounds }}／標準 {{ maze.standard }}</b></div>
      <div class="kv"><span>倒下</span><b data-m-downs>{{ maze.downs }} 人次</b></div>
      <div class="kv"><span>獎金</span><b data-m-prize><MoneyTag kind="cash" :amount="maze.prize" /></b></div>
      <div class="kv"><span>籌碼</span><b data-m-chips>{{ maze.chips }} 枚（換 <MoneyTag kind="cash" :amount="maze.chipCash" />）</b></div>
      <div class="kv"><span>押金</span><b data-m-deposit>{{ maze.done ? '退回 ' : '沒收 ' }}<MoneyTag kind="cash" :amount="maze.done ? maze.refund : maze.forfeited" /></b></div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.end { display: grid; gap: var(--space-2); }
h3 { margin: 0; font-size: var(--fs-section); display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
h3 small { color: var(--ink-3); font-size: var(--fs-fine); font-weight: 700; }
.sum { margin: 0; font-weight: 800; line-height: 1.6; }
.ln { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; }
.loot { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
.note { color: var(--ink-3); font-size: var(--fs-fine); }
.mz { display: grid; gap: var(--space-1); }
.rate { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-2); }
.rate b { font: 900 var(--fs-2xl) var(--mono); color: var(--ap); }
.rate.fail b { color: var(--ink-3); }
.rate small { color: var(--ink-3); }
</style>
