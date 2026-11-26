<script setup lang="ts">
import { unavailable } from '../../lib/unavailable'
import { PERK_CATEGORY_NAME } from '../../lib/engineView'

/**
 * 建角第 7 步的特質清單：每一個特質都列出來。被內容篩選關掉的照樣列出、灰掉、寫原因（引擎的 perkFilterBlock），不能選；
 * 其他選不了的（點數不夠、數量到上限）也灰掉並寫引擎的原因。這裡不判斷，只編排。
 */
export interface PerkRowIn { id: string; name: string; category: string; desc: string; cost: number; flaw?: boolean }
defineProps<{
  perks: PerkRowIn[]
  picked: string[]
  /** 選這一個特質現在行不行（引擎的 perkBlock 與 perkFilterBlock）；行是 null */
  addBlock: (id: string) => string | null
  /** 被內容篩選關掉的原因（引擎的 perkFilterBlock）；沒關是 null */
  filterWhy: (id: string) => string | null
}>()
const emit = defineEmits<{ (e: 'toggle', id: string): void }>()
</script>

<template>
  <div class="grid2 traits" data-perks>
    <button v-for="t in perks" :key="t.id" type="button" class="lrow pick" :class="{ on: picked.includes(t.id), flaw: t.flaw }" v-bind="unavailable(addBlock(t.id))" :data-perk="t.id" @click="emit('toggle', t.id)">
      <span class="grow"><b>{{ t.name }}</b><small>{{ PERK_CATEGORY_NAME[t.category] ?? t.category }}・{{ t.desc }}</small><small v-if="filterWhy(t.id)" class="perk-off" data-perk-filter>{{ filterWhy(t.id) }}</small></span><b class="pt mono">{{ t.flaw ? '+' : '−' }}{{ t.cost }}</b>
    </button>
  </div>
</template>

<style scoped>
.grow { flex: 1; min-width: 0; }
.pick { margin-bottom: 4px; }
.pick small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.pick small.perk-off { color: var(--warn); }
.pt { font-size: var(--fs-md); color: var(--ap); min-width: 26px; text-align: right; }
.pt { font-size: var(--fs-md); color: var(--ap); min-width: 26px; text-align: right; }
</style>
