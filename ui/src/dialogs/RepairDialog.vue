<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'

/**
 * 修理構裝（內海戰鬥裡重創的構裝要付錢修；CYBERSPACE 6.5 節）：站在帶 repair_construct 的設施上，右欄「這裡」的「修理構裝」打開這一頁。
 * 哪幾件要修、每一件的價錢、現在修得了修不了與原因全是引擎的（features/netcombat 的 repairRows、repairBlock、repairDraft）；這裡只送出。只收現金。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()
const rows = computed(() => e.repair.rows())
const total = computed(() => rows.value.reduce((n, r) => n + r.price, 0))
const here = computed(() => e.repair.here())
function fix(id?: string) {
  const why = e.repair.fix(id)
  if (why) ui.toast(why, 'warn')
  else ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '修好了。')
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="修理構裝" :sub="here ?? '沒有修理服務'" size="md">
    <template #header><Hint title="修理構裝">內海戰鬥裡破損又中一次的構裝會壞掉，帶著壞掉的狀態直到修好：睡一覺、戰鬥裡改造師除錯，或在這裡付現金修。</Hint></template>
    <section class="panel cut pad" data-repair>
      <p class="h">壞掉的構裝</p>
      <div v-for="r in rows" :key="r.id" class="row" :data-repair-row="r.id">
        <b>{{ r.name }}</b>
        <span class="mono"><MoneyTag kind="cash" :amount="r.price" /></span>
        <ReasonButton sm :reason="e.repair.block(r.id)" :data-repair-one="r.id" @go="fix(r.id)">修這一件</ReasonButton>
      </div>
      <div v-if="!rows.length" class="empty-note" data-none>身上沒有需要修的構裝。</div>
      <div v-if="rows.length > 1" class="go"><ReasonButton sm pri :reason="e.repair.block()" data-repair-all @go="fix()">全修（<MoneyTag kind="cash" :amount="total" />）</ReasonButton></div>
      <div v-else-if="e.repair.block() && rows.length" class="blocking" data-why>{{ e.repair.block() }}</div>
    </section>
  </Dialog>
</template>

<style scoped>
.row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--space-3); align-items: center; padding: var(--space-2) 0; border-bottom: 1px dashed var(--line); }
.go { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
</style>
