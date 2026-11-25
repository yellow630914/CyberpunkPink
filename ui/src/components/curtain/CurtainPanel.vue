<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CurtainView } from '@engine/src/features/curtain'
import HeatBar from './HeatBar.vue'
import CurtainRoom from './CurtainRoom.vue'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { ORDER_STATE, actLine, turnsLine, turnsWidth } from '../../lib/curtainView'

/**
 * 簾後館一趟裡的面板（CYBERSPACE 8.8 節；dev/work/M4-ui-curtain.md 第 3 項）：場熱與三個刻度、第幾幕與這一幕用了幾回合、票根、點單（先看內容再選接受或拒絕）、化妝室。
 * 全部讀引擎的 curtainView 與 orderChoices；做事是 store 的 curtain.use／rest。「這裡」的選項合進子網頁自己的選單（lib/curtainView 的 curtainOptions）。這裡沒有規則。
 */
const props = defineProps<{ view: CurtainView }>()
const e = useEngine()
const ui = useUi()

const offer = computed(() => (props.view.offer ? e.curtain.orders() : null))
const partner = ref<string | undefined>(undefined)
watch(() => offer.value?.offer.node, () => { partner.value = undefined })
const tierName = computed(() => e.curtain.member()?.tiers.find((t) => t.id === props.view.tier)?.name ?? props.view.tier)
const doneCount = computed(() => props.view.orders.filter((o) => o.state === 'done').length)

async function decide(id: 'order:accept' | 'order:refuse') {
  const o = offer.value
  if (!o) return
  const r = await e.curtain.use(id, o.offer.node, partner.value ? { with: partner.value } : {})
  if (r.status !== 'applied' && r.reason) ui.toast(r.reason, 'warn')
  else if (e.state.reports.at(-1)?.outcome.summary) ui.toast(e.state.reports.at(-1)!.outcome.summary)
}

// 化妝室：剛進一幕、還沒走動時開著；關掉之後這一幕不再自己跳出來
const roomClosed = ref<number | null>(null)
const roomOpen = computed(() => props.view.room && roomClosed.value !== props.view.act.number + (props.view.encore ? 100 : 0))
const closeRoom = () => { roomClosed.value = props.view.act.number + (props.view.encore ? 100 : 0) }
</script>

<template>
  <div class="cp" data-curtain-panel>
    <section class="panel cut pad" data-curtain-head>
      <div class="trh"><b data-night>簾後館・{{ view.night.name }}</b>
        <span class="tag" data-tier>{{ tierName }}</span>
        <span v-if="view.night.feature" class="tag hot" data-feature>本週主打</span><span v-if="view.pure_stage" class="tag" data-pure>純舞台</span>
        <Hint title="簾後館">暗礁裡會員制的成人地城：四幕，每一幕有遭遇、點單、賞箱。觀眾的興致叫場熱，照場熱換打賞；全隊倒下是落幕，要付代價，可以喊停。</Hint></div>
      <div class="kv"><span>幕</span><b data-act>{{ actLine(view) }}</b></div>
      <div class="kv"><span>這一幕</span><b data-turns>{{ turnsLine(view) }}</b></div>
      <div class="ratio" aria-hidden="true"><i :style="{ width: turnsWidth(view) + '%' }" /></div>
      <div v-if="view.act.boss" class="kv"><span>層主</span><b data-boss>{{ e.curtain.nameOf('enemy', view.act.boss) }}</b></div>
      <div class="kv"><span>票根</span><b data-stubs>{{ view.stubs }} 枚（每枚 <MoneyTag kind="cash" :amount="view.stub_value" />）</b></div>
      <div v-if="view.sponsor" class="kv" data-sponsor><span>贊助人</span><b>在場</b></div>
      <div v-if="view.signed" class="kv"><span>檔期</span><b>簽著</b></div>
      <div v-if="view.cut" class="blocking" data-cut>場熱掉到 0，觀眾散場了：這一趟只能收場。</div>
      <div v-else-if="view.encore_open" class="note" data-encore-open>觀眾喊著安可：走完終幕之後可以加演。</div>
    </section>

    <section class="panel cut pad"><HeatBar :view="view" /></section>

    <section class="panel cut pad" data-orders>
      <p class="h">點單<Hint title="點單">觀眾用打賞點的要求：走到節點才出現，先看內容再決定。接受就照做，完成的話場熱往上、拿票根；拒絕場熱往下。點單全部接受且完成，也能加演。</Hint></p>
      <div v-if="offer" class="offer" data-offer>
        <p class="otext" data-offer-text>{{ offer.text }}</p>
        <label v-if="offer.partners.length" class="pick">合演的對象
          <select v-model="partner" data-partner><option :value="undefined">館方的演出者</option><option v-for="p in offer.partners" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        </label>
        <div class="acts">
          <ReasonButton pri sm :reason="offer.choices[0]!.block" data-accept @go="decide('order:accept')">{{ offer.choices[0]!.name }}</ReasonButton>
          <ReasonButton sm :reason="offer.choices[1]!.block" data-refuse @go="decide('order:refuse')">{{ offer.choices[1]!.name }}</ReasonButton>
        </div>
        <p class="note">要站在點單的節點上才能決定（旁邊不行）。</p>
      </div>
      <p v-if="view.pending" class="note" data-pending>等著結算：{{ view.pending.text }}</p>
      <div v-if="view.orders.length" class="olist" data-order-list><span v-for="(o, i) in view.orders" :key="i" class="tag" :class="{ ok: o.state === 'done' }" :data-order-state="o.state">{{ o.name }}・{{ ORDER_STATE[o.state] }}<template v-if="o.stubs"> +{{ o.stubs }}</template></span></div>
      <p v-if="!offer && !view.orders.length" class="note">這一趟還沒有點單。走到點單的節點，在「這裡」選看點單。</p>
      <p v-else class="note" data-order-done>完成 {{ doneCount }}／{{ view.orders.length }}</p>
    </section>

    <CurtainRoom v-if="roomOpen" :view="view" @close="closeRoom" />
  </div>
</template>

<style scoped>
.cp { display: grid; gap: var(--space-4); min-width: 0; }
.trh { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); flex-wrap: wrap; }
.ratio { height: 6px; background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); margin: var(--space-2) 0; }
.ratio i { display: block; height: 100%; background: var(--ap); }
.note { margin: var(--space-2) 0 0; color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.6; }
.offer { display: grid; gap: var(--space-3); padding: var(--space-3); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--ap); margin-bottom: var(--space-3); }
.otext { margin: 0; line-height: 1.7; font-weight: 700; }
.pick { display: grid; gap: var(--space-2); font-size: var(--fs-fine); color: var(--ink-3); font-weight: 700; }
.pick select { background: var(--bg-1); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line-2); padding: 6px 8px; font: inherit; }
.acts { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.olist { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
</style>
