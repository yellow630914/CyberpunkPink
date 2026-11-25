<script setup lang="ts">
import { computed } from 'vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import Hint from '../Hint.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { curtainResultOf, resultTitle } from '../../lib/curtainView'

/**
 * 簾後館一趟的結算（curtain.result 報告的資料）：獎金、打賞（場熱那一段、乘了什麼）、票根、保證金；有加演的邀請就列加演。
 * 數字都是引擎算好的；加演能不能開與原因是引擎的 encoreBlocks。
 */
const props = defineProps<{ data: Record<string, unknown>; summary: string; actions?: boolean }>()
const e = useEngine()
const ui = useUi()
const r = computed(() => curtainResultOf(props.data))
const encoreOf = computed(() => e.curtain.encoreOf())
const encoreWhy = computed(() => { const b = e.curtain.encoreBlocks(); return b.length ? b.join('') : null })
async function encore() {
  const res = await e.curtain.encore()
  if (res.status !== 'applied') ui.toast(res.reason ?? '現在加演不了。', 'warn')
}
</script>

<template>
  <div class="cr" data-curtain-result>
    <h4 data-cr-title>簾後館結算：{{ resultTitle(r) }}</h4>
    <p class="sum" data-cr-summary>{{ summary }}</p>
    <div class="kv"><span>場熱</span><b data-cr-heat>{{ r.heat }}</b></div>
    <div v-if="!r.early" class="kv"><span>破關獎金</span><b data-cr-prize><MoneyTag kind="cash" :amount="r.prize" /></b></div>
    <div class="kv"><span>打賞<Hint>場熱那一段的比例換成打賞，乘上主打的加成與包場的扣除。</Hint></span><b data-cr-tips><MoneyTag kind="cash" :amount="r.tips" />（×{{ r.tipsRatio }}）</b></div>
    <div class="kv"><span>保證金</span><b data-cr-deposit><template v-if="r.refund > 0">退回 <MoneyTag kind="cash" :amount="r.refund" /></template><template v-if="r.forfeited > 0"><template v-if="r.refund > 0">・</template>沒收 <MoneyTag kind="cash" :amount="r.forfeited" /></template></b></div>
    <div class="kv"><span>票根</span><b data-cr-stubs>{{ r.stubs }} 枚</b></div>
    <p v-for="(l, i) in r.lines" :key="i" class="ln" data-cr-line>{{ l }}</p>
    <div v-if="actions && encoreOf" class="enc" data-encore>
      <b>加演</b><small>觀眾喊著安可：可以接著進第 5、6 幕（敵人更強，獎金更高，保證金不加）。</small>
      <small v-if="encoreWhy" class="why" data-encore-why>{{ encoreWhy }}</small>
      <ReasonButton sm pri :reason="encoreWhy" data-encore-go @go="encore">加演</ReasonButton>
    </div>
  </div>
</template>

<style scoped>
.cr { display: grid; gap: var(--space-2); }
h4 { margin: 0; font-size: var(--fs-card); }
.sum { margin: 0; font-weight: 800; line-height: 1.6; }
.ln { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; }
.enc { display: grid; gap: var(--space-2); justify-items: start; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--ap); }
.enc small { color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.5; }
.enc .why { color: var(--warn); }
</style>
