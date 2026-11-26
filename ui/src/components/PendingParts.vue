<script setup lang="ts">
import { computed } from 'vue'
import Hint from './Hint.vue'
import ReasonButton from './ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'

/**
 * 等著交貨的未登錄零件（M4-ui-parts 第 2 項；CRAFTING 11.1 節）：每一筆寫類型、等級、來源；訂做的寫還要幾天，時間到了寫「到委託台取貨」，人在委託台就能取。
 * 沒有訂做的那幾筆是 store 在每一步之後自動交的（Game.unregDeliver；AI 開著時走任務鏈、沿用任務鏈列），這裡只看得到被活動擋住或停在半路的。
 * 交不交得了、原因、還要幾天、框架的名字與數字全是引擎的（store 的 unreg）；這裡只編排。orders 只列訂單，rest 只列其餘的。
 */
const props = defineProps<{ only?: 'orders' | 'rest' }>()
const e = useEngine()
const ui = useUi()
const rows = computed(() => e.unreg.pending().filter((r) => (props.only === 'orders' ? r.order : props.only === 'rest' ? !r.order : true)))

async function pick(id: string) {
  const r = await e.unreg.deliver(id)
  if (r.status === 'refused') ui.toast(r.reason ?? '現在交不了貨。', 'warn')
  else if (r.status === 'paused') ui.toast('交貨停在寫正文那一步，可以重試或用規則代替。', 'warn')
  else ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '收下了。')
}
async function byRules(id: string) {
  const r = await e.unreg.deliver(id, { autoRules: true })
  if (r.status === 'refused') ui.toast(r.reason ?? '現在交不了貨。', 'warn')
  else ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '用規則寫好，收下了。')
}
</script>

<template>
  <section class="pend" data-pending-box>
    <p class="h">等著交貨<Hint title="等著交貨">拿到的未登錄零件先排在這裡：框架（類型、材質、等級、牌子、屬性、怪癖）已經定了，只差名字、說明與怪癖那一句。報酬與窗口換來的會在下一步自動交貨；訂做的要滿了天數、人在同人社團的委託台才能取貨。</Hint></p>
    <p v-if="!rows.length" class="empty-note" data-pending-empty>沒有等著交貨的零件。</p>
    <div v-for="r in rows" :key="r.id" class="prow" :data-pending="r.id" :data-source="r.source">
      <span class="grow">
        <b data-pending-name>{{ r.frame.typeName }}・{{ r.frame.gradeName }} 級<small class="sub">　{{ r.frame.materialName }}・{{ r.frame.brandName }}</small></b>
        <small data-pending-from>來源：{{ r.from || '不明' }}</small>
        <small v-if="r.frame.quirk" data-pending-quirk>怪癖：{{ r.frame.quirk.name }}</small>
        <small v-if="r.order && r.waiting" class="eta" data-eta>還要 {{ r.days_left }} 天</small>
        <small v-else-if="r.order && !r.block" class="eta" data-ready>到了，到委託台取貨</small>
        <small v-else-if="r.order" class="eta" data-ready>時間到了：{{ r.block }}</small>
        <small v-else-if="r.paused" class="why" data-paused>交貨停在寫正文那一步（服務商沒有接）。可以重試，或用規則代替（名字與說明用預設清單的）。</small>
        <small v-else-if="r.block" class="why" data-block>{{ r.block }}</small>
      </span>
      <span class="acts">
        <ReasonButton v-if="r.order" sm pri :reason="r.block" data-pickup @go="pick(r.id)">取貨</ReasonButton>
        <template v-else-if="r.paused">
          <ReasonButton sm :reason="r.block" data-retry @go="pick(r.id)">重試</ReasonButton>
          <ReasonButton sm pri :reason="r.block" data-rules @go="byRules(r.id)">用規則代替</ReasonButton>
        </template>
      </span>
    </div>
  </section>
</template>

<style scoped>
.pend { display: grid; gap: var(--space-3); }
.prow { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--uq); min-width: 0; flex-wrap: wrap; }
.grow { flex: 1; min-width: 180px; display: grid; gap: 2px; }
.grow small { color: var(--ink-3); font-size: var(--fs-xs); }
.sub { color: var(--ink-3); font-weight: 400; }
.eta { color: var(--ink-2) !important; font-weight: 800; }
.why { color: var(--warn) !important; font-weight: 700; }
.acts { display: inline-flex; gap: var(--space-2); flex-wrap: wrap; }
</style>
