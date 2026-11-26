<script setup lang="ts">
import { computed } from 'vue'
import { formatTime } from '@engine/src/core/util/time'
import MoneyTag from '../MoneyTag.vue'
import type { Settlement } from '../../lib/auctionView'
import { payKind } from '../../lib/auctionView'

/**
 * 這一場結束了（M4-ui-auction 第 6 項）：每一件誰得標、你得標的清單與總數、現在的時間。全部是結束那幾份報告上寫的（引擎的 outcome 與句子），這裡不算。
 */
const props = defineProps<{ settlement: Settlement }>()
defineEmits<{ (e: 'back'): void }>()
const s = computed(() => props.settlement)
const kind = computed(() => payKind(s.value.pay))
</script>

<template>
  <div class="res" data-result>
    <section class="panel cut pad">
      <p class="h">{{ s.left ? '你離場了，這一場結束了' : '這一場結束了' }}</p>
      <div class="kv"><span>得標</span><b data-won-count>{{ s.won.length }} 件</b></div>
      <div class="kv"><span>一共付了</span><b data-spent><MoneyTag :kind="kind" :amount="s.spent" /></b></div>
      <div class="kv"><span>現在是</span><b data-time>{{ formatTime(s.end) }}</b></div>
      <p class="tail" data-tail>{{ s.tail }}</p>
    </section>
    <section class="panel cut pad">
      <p class="h">每一件</p>
      <div v-for="r in s.rows" :key="r.lot" class="row" :class="{ mine: r.won, passed: r.result === 'passed' }" :data-row="r.lot">
        <span class="no mono">{{ r.lot + 1 }}</span>
        <b>{{ r.name }}</b>
        <span v-if="r.withdrawn" class="who" data-winner data-withdrawn>撤拍：{{ r.withdrawn }}</span>
        <span v-else-if="r.result === 'passed'" class="who" data-winner>流標</span>
        <span v-else class="who" data-winner>{{ r.won ? '你' : r.winnerName }}得標<MoneyTag :kind="kind" :amount="r.price" /></span>
      </div>
      <p v-if="!s.rows.length" class="empty-note">沒有落槌的紀錄。</p>
    </section>
    <section v-if="s.won.length" class="panel cut pad" data-mine>
      <p class="h">你得標的</p>
      <p v-for="(l, i) in s.gets" :key="i" class="line" data-get>{{ l }}</p>
    </section>
    <div class="go"><button type="button" class="btn pri" data-back @click="$emit('back')">回到會場</button></div>
  </div>
</template>

<style scoped>
.res { display: grid; gap: var(--space-4); }
.tail { margin: var(--space-3) 0 0; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; }
.row { display: flex; gap: var(--space-3); align-items: baseline; padding: var(--space-2) var(--space-3); background: var(--bg-2); margin-bottom: var(--space-2); flex-wrap: wrap; }
.row.mine { box-shadow: inset 3px 0 0 var(--a); }
.row.passed { color: var(--ink-3); }
.no { color: var(--ink-3); width: 1.6em; }
.who { display: inline-flex; gap: var(--space-2); align-items: center; color: var(--ink-2); font-size: var(--fs-sm); }
.line { margin: 0 0 var(--space-2); font-size: var(--fs-sm); line-height: 1.6; }
.go { display: flex; gap: var(--space-3); }
</style>
