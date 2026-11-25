<script setup lang="ts">
import ReasonButton from '../ReasonButton.vue'

/**
 * 報價卡：引擎給的報價（費用、成本、休養、機率、DC）一行一行列出來，下面是確認的按鈕。
 * 做不到時按鈕灰掉，原因（引擎的那一句話）直接顯示在卡上，擋住操作的警告不收進「?」（UI.md 規則 5）。
 * 元件只編排：數字與原因都是上面傳進來的，這裡不算。
 */
export interface QuoteRow { label: string; value: string; tone?: 'warn' | 'ok' | 'minus' | 'plain'; note?: string }
defineProps<{ title?: string; rows: QuoteRow[]; reason: string | null; action: string; pri?: boolean }>()
defineEmits<{ (e: 'go'): void }>()
</script>

<template>
  <div class="panel pad quote" data-quote>
    <b v-if="title" class="qt">{{ title }}</b>
    <div v-for="r in rows" :key="r.label" class="kv" :data-row="r.label"><span>{{ r.label }}</span><b :class="r.tone === 'warn' ? 'warn-t' : r.tone === 'ok' ? 'ok-t' : undefined">{{ r.value }}</b><small v-if="r.note" class="t-fine">{{ r.note }}</small></div>
    <div v-if="reason" class="blocking" data-reason>{{ reason }}</div>
    <div class="go left"><ReasonButton :pri="pri !== false" :reason="reason" data-go @go="$emit('go')">{{ action }}</ReasonButton></div>
  </div>
</template>

<style scoped>
.quote { display: grid; gap: var(--space-2); box-shadow: inset 3px 0 0 var(--a); }
.qt { font-size: var(--fs-card); }
.go.left { justify-content: flex-start; margin-top: var(--space-3); }
.blocking { margin-top: var(--space-2); }
</style>
