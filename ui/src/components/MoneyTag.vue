<script setup lang="ts">
import { fmt } from '../lib/price'
/** 錢：圖示當單位，數字前面不寫 C$（UI.md 3.5 節）。acc 帳戶、cash 現金晶片、fav 人情；人情加 owe 是「你欠的」，用橘字。 */
defineProps<{ kind: 'acc' | 'cash' | 'fav'; amount?: number; size?: number; iconOnly?: boolean; owe?: boolean }>()
const NAMES = { acc: '帳戶', cash: '現金晶片', fav: '欠你的人情' }
</script>

<template>
  <span class="money" :class="[kind, { owe }]" :title="owe ? '你欠的人情' : NAMES[kind]">
    <svg :width="size ?? 16" :height="size ?? 16" viewBox="0 0 24 24" aria-hidden="true">
      <template v-if="kind === 'acc'"><rect x="2" y="5" width="20" height="14" rx="3" fill="#C9B8E8" /><rect x="2" y="8.5" width="20" height="3" fill="#8E7CC3" /><rect x="5" y="14" width="6" height="2.4" rx="1.2" fill="#F3E9FF" /><circle cx="17.5" cy="15.2" r="1.8" fill="#F06AA0" /></template>
      <template v-else-if="kind === 'cash'"><path d="M7 3h10l4 4v10l-4 4H7l-4-4V7z" fill="#F06AA0" /><rect x="8" y="8" width="8" height="8" rx="1.5" fill="#F2C14E" /><path d="M8 11h8M8 13h8M11 8v8M13 8v8" stroke="#F06AA0" stroke-width="1.1" /></template>
      <template v-else><path d="M3 6h14l4 6-4 6H3z" fill="#F2C14E" /><circle cx="16" cy="12" r="1.8" fill="#17111F" /><rect x="6" y="9.5" width="6" height="2" rx="1" fill="#17111F" /><rect x="6" y="13" width="4" height="2" rx="1" fill="#17111F" /></template>
    </svg>
    <span class="sr-only">{{ owe ? '你欠的人情' : NAMES[kind] }}</span><template v-if="!iconOnly">{{ fmt(amount ?? 0) }}</template>
  </span>
</template>

<style scoped>
.money { display: inline-flex; align-items: center; gap: 5px; font: 800 var(--fs-sm) var(--mono); white-space: nowrap; }
.money svg { display: block; flex: none; }
.acc { color: var(--money-acc); } .cash { color: var(--money-cash); } .fav { color: var(--money-fav); } .fav.owe { color: var(--warn); }
[data-skin="net"] .acc { color: var(--ink-2); }
</style>
