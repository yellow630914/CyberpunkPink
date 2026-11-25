<script setup lang="ts">
import { computed } from 'vue'
import type { CurtainView } from '@engine/src/features/curtain'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'

/**
 * 化妝室（層與層之間；往下一幕之後引擎自己發一次休息）：感載歸零、餘韻全消、RAM 回滿是引擎做好的，這裡列引擎寫的句子；
 * 贊助人在場時才有「包場」（引擎的 curtainView.free）。包場做不到的原因是引擎的 block。
 */
const props = defineProps<{ view: CurtainView }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const e = useEngine()
const ui = useUi()
const lines = computed(() => e.curtain.roomLines())
const book = computed(() => props.view.free.find((u) => u.id === 'book') ?? null)
async function doBook() {
  const r = await e.curtain.rest({ book: true })
  if (r.status !== 'applied' && r.reason) ui.toast(r.reason, 'warn')
  else { ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '包場了。'); emit('close') }
}
</script>

<template>
  <div class="gate" role="dialog" aria-modal="true" aria-label="化妝室" data-room>
    <div class="box panel cut pad">
      <h3>化妝室</h3>
      <p v-for="(l, i) in lines" :key="i" class="ln" data-room-line>{{ l }}</p>
      <div v-if="book" class="opt" data-book-row>
        <span class="grow"><b>{{ book.name }}</b><small>贊助人在場：花一個探索回合讓他點一個私人的要求。</small><small v-if="book.block" class="why" data-book-why>{{ book.block }}</small></span>
        <ReasonButton sm pri :reason="book.block" data-book @go="doBook">{{ book.name }}</ReasonButton>
      </div>
      <div class="go"><button type="button" class="btn sm pri" data-room-close @click="emit('close')">回到舞台</button></div>
    </div>
  </div>
</template>

<style scoped>
.gate { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: var(--z-sheet); padding: var(--space-4); }
.box { width: min(460px, 100%); display: grid; gap: var(--space-3); background: var(--bg-1); max-height: 90vh; overflow: auto; }
.box h3 { margin: 0; }
.ln { margin: 0; color: var(--ink-2); line-height: 1.7; font-size: var(--fs-sm); }
.opt { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.opt .grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
.opt small { color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.5; }
.opt .why { color: var(--warn); }
</style>
