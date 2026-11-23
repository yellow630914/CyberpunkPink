<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import GradeBadge from '../components/GradeBadge.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { fmt } from '../lib/price'
import { legalName } from '../lib/gearView'
import { DEGREE_NAME, POOL_NAME, addRow, failText, moneyKind, removeRow, rowKey, slotItemOf, stepText, toCart, type CartRow, type Pool } from '../lib/lifeView'

/**
 * 商店（UI.md 3.8 節、TRADE 第 3 節）：抬頭、買／賣兩個分頁、右邊是購物車（買賣一起結）、價格拆解、付款方式、殺價。
 * 價錢、拆解的每一步、選不了的原因、合計、能不能結帳、殺價的結果全是引擎的（stores/engine.ts 的 trade）；這裡只放進車、換付款方式、送出。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; shopId: string }>()
const e = useEngine()
const ui = useUi()
const look = e.gear.look

const view = computed(() => e.trade.view(props.shopId))
const lock = computed(() => e.trade.lock())
const tab = ref('buy')
const rows = ref<CartRow[]>([])
const focus = ref<{ mode: 'buy' | 'sell'; item: string; uid?: string } | null>(null)
const method = ref('haggle')

/** 付款：預設用收的那一種（先現金再帳戶）；兩種都不收的店（被趕出來）先停在現金 */
const pay = ref<Pool>('cash')
watch(view, (v) => { if (v && v.pay[pay.value] !== null && v.pay[pay.value === 'cash' ? 'cred' : 'cash'] === null) pay.value = pay.value === 'cash' ? 'cred' : 'cash' }, { immediate: true })

const plan = computed(() => (view.value && rows.value.length ? e.trade.plan(props.shopId, toCart(rows.value, pay.value)) : null))
const nameOf = (id: string): string => view.value?.shelf.find((r) => r.item === id)?.name ?? view.value?.sell.find((r) => r.item === id)?.name ?? e.contentName('item', id) ?? id
const gradeOf = (id: string): number => look.item(id)?.grade ?? 1
const lineOf = (r: CartRow) => (r.mode === 'buy' ? plan.value?.buy : plan.value?.sell)?.find((l) => l.item === r.item && (l.uid ?? '') === (r.uid ?? ''))

const focusQuote = computed(() => {
  const f = focus.value
  if (!f || !view.value) return null
  const row = f.mode === 'buy' ? view.value.shelf.find((r) => r.item === f.item) : view.value.sell.find((r) => r.item === f.item && (r.uid ?? '') === (f.uid ?? ''))
  return row ? { name: row.name, quote: row.quote, mode: f.mode } : null
})
const routes = computed(() => (focus.value ? e.trade.routes(focus.value.item) : null))
const districtName = (id: string): string => e.world.entry<{ name?: string }>('district', id)?.name ?? id

function slotOf(item: string, name: string) {
  const d = look.item(item)
  return slotItemOf({ item, name, ...(d ? { grade: d.grade, category: d.category, legal: d.legal } : {}) })
}
function addBuy(item: string) { rows.value = addRow(rows.value, 'buy', item); focus.value = { mode: 'buy', item } }
function addSell(item: string, uid?: string) { rows.value = addRow(rows.value, 'sell', item, 1, uid); focus.value = { mode: 'sell', item, ...(uid !== undefined ? { uid } : {}) } }
function remove(r: CartRow) { rows.value = removeRow(rows.value, rowKey(r)) }
function payClick(p: Pool) {
  const why = view.value?.pay[p]
  if (why) ui.toast(why, 'warn')
  else pay.value = p
}

const checkoutReason = computed(() => lock.value ?? view.value?.closed ?? (!rows.value.length ? '車是空的。' : plan.value?.problems[0] ?? null))
async function checkout() {
  const r = await e.trade.checkout(props.shopId, toCart(rows.value, pay.value))
  const why = failText(r, '結不了帳。')
  if (why) { ui.toast(why, 'warn'); return }
  ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '結帳完成。')
  rows.value = []
  focus.value = null
}

const opt = computed(() => view.value?.bargain.options.find((o) => o.method === method.value) ?? null)
const bargainReason = computed(() => lock.value ?? view.value?.bargain.block ?? opt.value?.block ?? null)
async function bargain() {
  const r = await e.trade.bargain(props.shopId, method.value as never)
  const why = failText(r, '現在殺不了價。')
  if (why) { ui.toast(why, 'warn'); return }
  ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '殺價做完了。')
}
const METHOD_TEXT = (m: string): string => view.value?.bargain.options.find((o) => o.method === m)?.name ?? m
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" :title="view?.shop.name ?? '商店'" :sub="view ? `${view.shop.typeName}・${view.shop.districtName}` : ''" size="xl">
    <template v-if="view" #header>
      <span v-if="view.keeper" class="tag">店主：{{ view.keeper.name }}・親密度 {{ view.keeper.affinity }}</span>
      <span v-if="view.backer" class="tag" :class="{ warn: view.backer.hostility > 0 }">後台：{{ view.backer.name }}・好感 {{ view.backer.favor }}・敵對 {{ view.backer.hostility }}</span>
      <span v-if="view.pay.cred === null" class="tag"><MoneyTag kind="acc" icon-only :size="12" />收</span>
      <span v-if="view.pay.cash === null" class="tag"><MoneyTag kind="cash" icon-only :size="12" />收</span>
      <span v-if="view.scan_registered" class="tag warn">登記類掃橋</span>
      <Hint title="這間店">每天一張清單，買完了等明天。價錢是一步一步算出來的，選中一件就看得到每一步。用帳戶買違禁品，後台勢力的敵對值會加。登記類的東西一定要用帳戶買（買的時候掃你的橋）。</Hint>
    </template>
    <div v-if="!view" class="empty-note">這間店還沒有開放。</div>
    <div v-else class="shop">
      <section class="panel cut pad">
        <div v-if="lock" class="blocking" data-lock>{{ lock }}</div>
        <div v-else-if="view.closed" class="blocking" data-closed>{{ view.closed }}</div>
        <div v-if="view.discount.total > 0 || view.markup !== 1 || view.market.length" class="meta">
          <span v-if="view.discount.total > 0" class="tag">折扣 {{ Math.round(view.discount.total * 100) }}%<Hint>後台勢力的好感與店主的親密度折的（上限在引擎）。</Hint></span>
          <span v-if="view.markup !== 1" class="tag warn">敵對值加價 ×{{ view.markup }}</span>
          <span v-for="m in view.market" :key="m.category" class="tag" :class="{ warn: m.mult > 1 }">{{ m.name }}行情 ×{{ m.mult.toFixed(2) }}</span>
        </div>
        <Tabs v-model="tab" :tabs="[{ id: 'buy', label: '買' }, { id: 'sell', label: '賣' }]" />
        <div v-if="tab === 'buy'" class="goods" data-shelf>
          <div v-if="!view.shelf.length" class="empty-note">今天沒有上架的東西。</div>
          <div v-for="r in view.shelf" :key="r.item" class="gd" :class="{ 'is-unavailable': !!(r.block ?? lock), sel: focus?.mode === 'buy' && focus.item === r.item }" :style="{ '--gc': `var(--g${r.grade})` }" :data-item="r.item">
            <ItemSlot :item="slotOf(r.item, r.name)" size="sm" @select="focus = { mode: 'buy', item: r.item }" />
            <div class="gi">
              <b>{{ r.name }}</b>
              <small><GradeBadge :grade="(r.grade as 1 | 2 | 3 | 4 | 5)" small />・{{ r.tradeCategoryName }}<template v-if="r.legal !== 'free'">・<span class="warn-t">{{ legalName(r.legal) }}</span></template></small>
            </div>
            <div class="pr"><MoneyTag :kind="moneyKind(pay)" :amount="r.price" :size="13" /><small>剩 {{ r.left }}</small></div>
            <ReasonButton sm :reason="r.block ?? lock" :data-add="r.item" @go="addBuy(r.item)">放進車</ReasonButton>
          </div>
        </div>
        <div v-else class="goods" data-sell>
          <div v-if="!view.sell.length" class="empty-note">背包裡沒有這間店收的東西。</div>
          <div v-for="r in view.sell" :key="`${r.item}:${r.uid ?? ''}`" class="gd" :class="{ 'is-unavailable': !!(r.block ?? lock) }" :style="{ '--gc': `var(--g${gradeOf(r.item)})` }" :data-sell-item="r.item">
            <ItemSlot :item="slotOf(r.item, r.name)" :qty="r.qty" size="sm" @select="focus = { mode: 'sell', item: r.item, ...(r.uid !== undefined ? { uid: r.uid } : {}) }" />
            <div class="gi"><b>{{ r.name }}</b><small>{{ r.tradeCategoryName }}<template v-if="r.cargo">・貨物</template><template v-if="r.decay < 1">・收購 ×{{ r.decay.toFixed(2) }}</template></small></div>
            <div class="pr"><MoneyTag :kind="moneyKind(pay)" :amount="r.price" :size="13" /><small>×{{ r.qty }}</small></div>
            <ReasonButton sm :reason="r.block ?? lock" @go="addSell(r.item, r.uid)">放進車</ReasonButton>
          </div>
        </div>
      </section>
      <aside class="panel cut pad cart">
        <p class="h">購物車</p>
        <div v-if="!rows.length" class="empty-note">還沒有東西。</div>
        <div v-for="r in rows" :key="rowKey(r)" class="ln" data-cart-line>
          <span class="lm">{{ r.mode === 'buy' ? '買' : '賣' }}</span>
          <button type="button" class="lnm" :style="{ color: `var(--g${gradeOf(r.item)})` }" @click="focus = { mode: r.mode, item: r.item, ...(r.uid !== undefined ? { uid: r.uid } : {}) }">{{ nameOf(r.item) }}<template v-if="r.qty > 1"> ×{{ r.qty }}</template></button>
          <b class="mono" :class="{ plus: r.mode === 'sell' }">{{ lineOf(r) ? `${r.mode === 'sell' ? '+' : ''}${fmt(lineOf(r)!.total)}` : '—' }}</b>
          <button type="button" class="rm" :aria-label="`拿掉${nameOf(r.item)}`" @click="remove(r)">✕</button>
        </div>
        <template v-if="focusQuote">
          <p class="h mt">{{ focusQuote.name }}・{{ focusQuote.mode === 'buy' ? '價格' : '收購價' }}拆解<Hint>每一步照引擎算的：名字、乘多少、▲ 變貴 ▼ 變便宜，到這一步為止的數字。</Hint></p>
          <div class="brk" data-breakdown>
            <div v-for="s in focusQuote.quote.steps" :key="s.id" :class="s.mult > 1 ? 'u' : s.mult < 1 ? 'd' : ''">{{ stepText(s).name }} <template v-if="s.id !== 'catalog'">{{ stepText(s).mult }} {{ stepText(s).arrow }} {{ stepText(s).pct }} </template>→ {{ fmt(s.value) }}</div>
            <div>＝ {{ fmt(focusQuote.quote.price) }}</div>
          </div>
          <div v-if="routes && routes.best" class="k note" data-routes>價差：{{ routes.categoryName }}在{{ districtName(routes.best.buy.district) }}最便宜（{{ fmt(routes.best.buy.price) }}），{{ districtName(routes.best.sell.district) }}賣最好（{{ fmt(routes.best.sell.price) }}）<Hint>{{ routes.best.margin < 0 ? '搬過去賣是虧的。' : '搬過去賣有賺。' }}不含店家倍率、折扣與收購遞減。</Hint></div>
        </template>
        <div class="bg">
          <p class="h mt">殺價<Hint>整車一起，每間店每天一次。DC、成功率與每一種殺法能不能用都是引擎算的。</Hint></p>
          <div v-if="view.bargain.today" class="k note" data-bargain-today>今天殺過了：{{ METHOD_TEXT(view.bargain.today.method) }}・{{ DEGREE_NAME[view.bargain.today.degree] }}・×{{ view.bargain.today.mult }}</div>
          <div class="go left">
            <select v-model="method" class="waysel" aria-label="怎麼殺">
              <option v-for="o in view.bargain.options" :key="o.method" :value="o.method">{{ o.name }}<template v-if="o.chance !== undefined">（DC {{ o.dc }}・{{ Math.round(o.chance * 100) }}%）</template></option>
            </select>
            <ReasonButton sm :reason="view.bargain.dc === null ? '這間店不能殺價。' : bargainReason" data-bargain @go="bargain">殺價</ReasonButton>
          </div>
        </div>
        <div class="payseg" role="radiogroup" aria-label="付款">
          <button v-for="p in (['cash', 'cred'] as const)" :key="p" type="button" role="radio" :aria-checked="pay === p" :class="{ on: pay === p, 'is-unavailable': !!view.pay[p] }" :title="view.pay[p] ?? undefined" :data-pay="p" @click="payClick(p)">
            {{ POOL_NAME[p] }}<small><MoneyTag :kind="moneyKind(p)" :amount="e.money[p]" :size="11" /></small>
            <small v-if="view.pay[p]" class="why">{{ view.pay[p] }}</small>
          </button>
        </div>
        <div v-if="plan" class="sum">
          <div v-if="plan.buy.length" class="kv"><span>買</span><b class="mono">{{ fmt(plan.buyTotal) }}</b></div>
          <div v-if="plan.sell.length" class="kv"><span>賣</span><b class="mono plus">+{{ fmt(plan.sellTotal) }}</b></div>
        </div>
        <div class="total"><span>{{ plan && plan.net < 0 ? '收進' : '合計' }}</span><MoneyTag :kind="moneyKind(pay)" :amount="Math.abs(plan?.net ?? 0)" :size="16" /></div>
        <div v-for="p in plan?.problems ?? []" :key="p" class="blocking" data-problem>{{ p }}</div>
        <div class="go"><ReasonButton pri :reason="checkoutReason" data-checkout @go="checkout">結帳</ReasonButton></div>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.waysel { max-width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 5px 6px; font: 700 var(--fs-sm) var(--font); }
.shop { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 12px; align-items: start; }
.goods { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, max(360px, calc(50% - 6px))), 1fr)); gap: 6px; margin-top: 10px; }
.gd { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 10px; background: var(--bg-2); border-left: 3px solid var(--gc); }
.gd.sel { box-shadow: inset 0 0 0 1px var(--a); }
.gi { min-width: 0; }
.gi b { font-size: var(--fs-ui); color: var(--gc); margin-right: 6px; }
.gi small { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; font-size: var(--fs-fine); color: var(--ink-3); margin-top: 2px; }
.pr { text-align: right; display: grid; justify-items: end; }
.pr small { font-size: var(--fs-tiny); color: var(--ink-3); }
.warn-t { color: var(--warn); }
.ln { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; align-items: center; font-size: var(--fs-sm); padding: 6px 0; border-bottom: 1px dashed var(--line); }
.lm { font-size: var(--fs-fine); font-weight: 900; color: var(--ink-3); }
.lnm { background: none; border: 0; padding: 0; cursor: pointer; text-align: left; font-weight: 800; min-width: 0; }
.plus { color: var(--ram); }
.rm { background: none; border: 0; color: var(--ink-3); cursor: pointer; }
.mt { margin-top: 12px; }
.brk { padding: 10px; background: var(--bg-term); font: 700 var(--fs-fine) var(--mono); line-height: 1.9; color: var(--ink-2); overflow-wrap: anywhere; }
.brk .u { color: var(--warn); } .brk .d { color: var(--ram); }
.go.left { justify-content: flex-start; align-items: center; flex-wrap: wrap; }
.payseg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 10px; }
.payseg button { padding: 8px; text-align: center; background: var(--bg-2); font-size: var(--fs-sm); font-weight: 800; color: var(--ink-3); border: 0; cursor: pointer; display: grid; justify-items: center; gap: 2px; min-width: 0; }
.payseg button.on { background: var(--a); color: var(--on-a); }
.payseg button.on :deep(.money) { color: var(--on-a); }
.payseg .why { font-weight: 600; font-size: var(--fs-tiny); line-height: 1.3; white-space: normal; }
.sum { margin-top: 8px; }
.total { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-term); margin-top: 8px; font-weight: 900; }
.note { display: flex; align-items: center; gap: 4px; margin-top: 6px; letter-spacing: 0; flex-wrap: wrap; }
@media (max-width: 900px) { .shop { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .gd { grid-template-columns: 40px minmax(0, 1fr) auto; } .gd .btn { grid-column: 2 / -1; justify-self: end; } }
</style>
