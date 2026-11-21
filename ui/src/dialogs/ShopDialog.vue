
<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import GradeBadge from '../components/GradeBadge.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { SHOPS } from '../data/shops'
import { ITEMS } from '../data/items'
import { buyPrice, sellPrice, fmt, type PriceQuote } from '../lib/price'
import type { Condition } from '../data/types'
import { reactive } from 'vue'
import { bargainDc, bargainResult, bargainWayReason, BARGAIN_WAYS, BARGAIN_MULT, BARGAIN_AFFINITY, SHOP_DEALS, validateDeal, rollShopEvent, shopDaySeed, type BargainWay, type BargainResult, type Deal, type ShopEventOpt } from '../lib/shopEvents'
import { seeded } from '../lib/combat/rng'
/** 一天之內已經處理過的店內事件、已經買走的特別交易（不進存檔：換一天就重來） */
const doneToday = reactive(new Set<string>())

/**
 * 商店（UI.md 3.8 節、TRADE 第 3 節）：抬頭、買／賣兩個分頁、右邊是購物車（買賣一起結）、價格拆解、付款方式、殺價。
 * 每件物品都用等級色與自己的圖標（UI 規則 1）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; shopId: string }>()
const g = useGame()
const ui = useUi()
const shop = computed(() => SHOPS[props.shopId])
const tab = ref('buy')
interface Line { key: string; mode: 'buy' | 'sell'; def: string; qty: number; condition: Condition; uid?: string; unit: number }
const cart = ref<Line[]>([])
const focus = ref<{ def: string; mode: 'buy' | 'sell'; condition: Condition } | null>(null)
const pay = ref<'cash' | 'acc'>('cash')
const bargain = ref<'none' | BargainResult>('none')
const way = ref<BargainWay>('talk')
const stock = ref(shop.value.stock.map(s => ({ ...s })))

const sellables = computed(() => g.inventory.filter(s => !s.unknown && ITEMS[s.def].price > 0))
const quote = computed<PriceQuote | null>(() => {
  if (!focus.value) return null
  const d = ITEMS[focus.value.def]
  return focus.value.mode === 'buy' ? buyPrice(d, shop.value, focus.value.condition) : sellPrice(d, shop.value, focus.value.condition)
})
const blackout = computed(() => doneToday.has(`${props.shopId}:${g.day}:blackout`))
const bargainMult = computed(() => (bargain.value === 'none' ? 1 : BARGAIN_MULT[bargain.value]) * (blackout.value ? 0.9 : 1))
const buyTotal = computed(() => Math.round(cart.value.filter(l => l.mode === 'buy').reduce((s, l) => s + l.unit * l.qty, 0) * bargainMult.value))
const sellTotal = computed(() => cart.value.filter(l => l.mode === 'sell').reduce((s, l) => s + l.unit * l.qty, 0))
const total = computed(() => buyTotal.value - sellTotal.value)
const wallet = computed(() => (pay.value === 'cash' ? g.money.cash : g.money.acc))
const shortBy = computed(() => Math.max(0, total.value - wallet.value))
const hasRegistered = computed(() => cart.value.some(l => l.mode === 'buy' && ITEMS[l.def].legality !== '自由'))

/** 這一件為什麼不能放進車（灰掉，UI.md 1.1 節）：賣完了、車裡已經是全部、錢包付不起這一件。 */
function buyReason(i: number): string | null {
  const s = stock.value[i]
  const inCart = cart.value.find(l => l.mode === 'buy' && l.def === s.def)?.qty ?? 0
  if (s.qty <= 0) return '賣完了，等明天。'
  if (inCart >= s.qty) return '店裡只剩這些了，都在車裡。'
  const unit = buyPrice(ITEMS[s.def], shop.value, s.condition ?? '全新').total
  if (unit > wallet.value + sellTotal.value - buyTotal.value) return `錢不夠：這一件 ${fmt(unit)}。`
  return null
}
function sellReason(uid: string): string | null {
  const st = g.stackOf(uid)!
  return (cart.value.find(l => l.mode === 'sell' && l.uid === uid)?.qty ?? 0) >= st.qty ? '你身上的都放進車了。' : null
}
function addBuy(i: number) {
  const s = stock.value[i]
  const inCart = cart.value.find(l => l.mode === 'buy' && l.def === s.def)
  if ((inCart?.qty ?? 0) >= s.qty) { ui.toast('店裡只剩這些了。', 'warn'); return }
  const unit = buyPrice(ITEMS[s.def], shop.value, s.condition ?? '全新').total
  if (inCart) inCart.qty++
  else cart.value.push({ key: `b-${s.def}`, mode: 'buy', def: s.def, qty: 1, condition: s.condition ?? '全新', unit })
  focus.value = { def: s.def, mode: 'buy', condition: s.condition ?? '全新' }
}
function addSell(uid: string) {
  const st = g.stackOf(uid)!
  const inCart = cart.value.find(l => l.mode === 'sell' && l.uid === uid)
  if ((inCart?.qty ?? 0) >= st.qty) { ui.toast('你身上只有這些。', 'warn'); return }
  const unit = sellPrice(ITEMS[st.def], shop.value, st.condition).total
  if (inCart) inCart.qty++
  else cart.value.push({ key: `s-${uid}`, mode: 'sell', def: st.def, qty: 1, condition: st.condition, uid, unit })
  focus.value = { def: st.def, mode: 'sell', condition: st.condition }
}
function remove(key: string) { cart.value = cart.value.filter(l => l.key !== key) }
// ---- 殺價（TRADE 第 5 節）：DC = 13 − ⌊店主親密度 ÷ 25⌋ ＋ 店的脾氣；結果 ×0.8／0.9／1／1.1 ----
const dc = computed(() => bargainDc(shop.value.keeperAffinity, shop.value.temper, way.value))
const WAY_MOD: Record<BargainWay, () => number> = { talk: () => (g.basics['交涉'] ?? 0) + 2, charm: () => (g.basics['誘惑'] ?? 0) + 2, flaw: () => (g.basics['街頭直覺'] ?? 0) + 1, press: () => (g.basics['威嚇'] ?? 0) + 1, favor: () => 0 }
const wayReason = (w: BargainWay) => bargainWayReason(w, { fame: g.fame[shop.value.district] ?? 0, usedOnly: cart.value.filter(l => l.mode === 'buy').every(l => l.condition === '二手'), blackOrGang: /黑市|幫派|冷庫/.test(shop.value.type) || ['鉻娘子', '孤星連', '野良'].includes(shop.value.backer), favors: g.money.fav })
function doBargain() {
  const r0 = wayReason(way.value)
  if (r0) { ui.toast(r0, 'warn'); return }
  if (dc.value === null) { ui.toast('原廠直營不能殺價。', 'warn'); return }
  let res: BargainResult, line: string
  if (way.value === 'favor') { g.money.fav--; res = '大成功'; line = '用掉一個人情：當成大成功' }
  else { const die = 1 + Math.floor(Math.random() * 20), mod = WAY_MOD[way.value](); res = bargainResult(die, mod, dc.value); line = `1d20 ${die} ＋ ${mod} 對 DC ${dc.value}：${res}` }
  bargain.value = res
  shop.value.keeperAffinity += BARGAIN_AFFINITY[res]
  ui.toast(`殺價（${BARGAIN_WAYS.find(x => x.id === way.value)!.name}）${line}：買的部分 ×${BARGAIN_MULT[res]}。${BARGAIN_AFFINITY[res] ? `${shop.value.keeper}的親密度 ${BARGAIN_AFFINITY[res] > 0 ? '+' : ''}${BARGAIN_AFFINITY[res]}。` : ''}`, res === '失敗' || res === '大失敗' ? 'warn' : 'info')
}

// ---- 當日特別交易（TRADE 第 10 節，AI 關著時用模板） ----
const deals = computed(() => (SHOP_DEALS[props.shopId] ?? []).map(d => { const value = d.item ? buyPrice(ITEMS[d.item], shop.value, '全新').total * (d.qty ?? 1) : 0; const v = validateDeal(d, value); return { d, price: Math.round(v.price * (blackout.value ? 0.9 : 1)), notes: v.notes } }))
const dealKey = (d: Deal) => `${props.shopId}:${g.day}:${d.id}`
function dealReason(d: Deal, price: number) { if (doneToday.has(dealKey(d))) return '今天已經買走了。'; if ((d.pay === 'cash' ? g.money.cash : g.money.acc) < price) return '錢不夠。'; return null }
function takeDeal(d: Deal, price: number) {
  if (d.pay === 'cash') g.money.cash -= price; else g.money.acc -= price
  if (d.item) g.addItem(d.item, d.qty ?? 1)
  if (d.affinity) shop.value.keeperAffinity += d.affinity
  doneToday.add(dealKey(d))
  g.addLog({ prose: [`${shop.value.name}的特別交易：${d.title}。${d.rumor ? `你聽到：${d.rumor}` : d.desc}`], changes: [...(price ? [{ text: `${d.pay === 'cash' ? '現金' : '帳戶'} −${fmt(price)}`, kind: 'minus' as const }] : []), ...(d.affinity ? [{ text: `${shop.value.keeper}的親密度 +${d.affinity}`, kind: 'plus' as const }] : [])] })
  ui.toast(`成交：${d.title}。`)
}

// ---- 走進店裡的事件（EVENTS 3.1 節 enter_facility；同一天同一間店只擲一次） ----
const evt = computed(() => rollShopEvent(props.shopId, seeded(shopDaySeed(props.shopId, g.day))))
const evtDone = computed(() => !!evt.value && doneToday.has(`${props.shopId}:${g.day}:evt`))
const evtLine = ref('')
function evtReason(o: ShopEventOpt) { return o.price && o.price > 0 && g.money.cash < o.price ? '現金不夠。' : null }
function pickEvt(o: ShopEventOpt) {
  doneToday.add(`${props.shopId}:${g.day}:evt`)
  let ok = true, roll = ''
  if (o.check) { const die = 1 + Math.floor(Math.random() * 20), mod = (g.basics[o.check.skill] ?? 0) + 2; ok = die + mod >= o.check.dc; roll = `${o.check.skill} 1d20 ${die} ＋ ${mod} 對 ${o.check.dc}：${ok ? '成功' : '失敗'}。` }
  if (o.price && o.price > 0) g.money.cash -= o.price
  if (o.price === -1) doneToday.add(`${props.shopId}:${g.day}:blackout`)
  if (ok && o.affinity) shop.value.keeperAffinity += o.affinity
  if (!ok && o.hostility) g.hostility[shop.value.backer] = (g.hostility[shop.value.backer] ?? 0) + o.hostility
  evtLine.value = `${roll}${ok ? o.win : o.lose ?? o.win}`
  g.addLog({ prose: [evt.value!.text, evtLine.value] })
}
function checkout() {
  for (const l of cart.value) {
    if (l.mode === 'buy') {
      g.addItem(l.def, l.qty, l.condition)
      const s = stock.value.find(x => x.def === l.def)!
      s.qty -= l.qty
    } else if (l.uid) g.removeItem(l.uid, l.qty)
  }
  if (pay.value === 'cash') g.money.cash -= total.value
  else { g.money.acc -= total.value; if (buyTotal.value > 0) g.hostility[shop.value.backer] = (g.hostility[shop.value.backer] ?? 0) + 1 }
  g.addLog({ prose: [`你在${shop.value.name}結了帳。`], changes: [{ text: `${pay.value === 'cash' ? '現金' : '帳戶'} ${total.value >= 0 ? '−' : '+'}${fmt(Math.abs(total.value))}`, kind: total.value >= 0 ? 'minus' : 'plus' }] })
  ui.toast('結帳完成。')
  stock.value = stock.value.filter(s => s.qty > 0)
  cart.value = []
  focus.value = null
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" :title="shop.name" :sub="shop.type" size="xl">
    <template #header>
      <span class="tag">店主：{{ shop.keeper }}・{{ shop.keeperAffinity }}</span>
      <span class="tag">後台：{{ shop.backer }}</span>
      <span class="tag">脾氣：{{ shop.temper }}</span>
      <span v-if="shop.acceptsAccount" class="tag"><MoneyTag kind="acc" icon-only :size="12" />收</span>
      <span v-if="shop.acceptsCash" class="tag"><MoneyTag kind="cash" icon-only :size="12" />收</span>
      <span v-if="shop.scansRegistered" class="tag warn">登記類掃橋</span>
      <Hint title="這間店">每天第一次進來時生成當天的清單，買完了等明天。兩種錢都收的店，用帳戶付會留下紀錄，後台勢力的敵對值 +1。登記類的東西不管用哪種錢付，買了都會掃你的橋。</Hint>
    </template>
    <div class="shop">
      <section class="panel cut pad">
        <div v-if="evt && !evtDone" class="sevt" data-shop-event>
          <b>店裡出了一件事</b><p>{{ evt.text }}</p>
          <div class="go left"><ReasonButton v-for="o in evt.opts" :key="o.id" sm :reason="evtReason(o)" @go="pickEvt(o)">{{ o.name }}{{ o.check ? `（${o.check.skill} DC ${o.check.dc}）` : o.price && o.price > 0 ? `（${o.price}）` : '' }}</ReasonButton></div>
        </div>
        <p v-else-if="evtLine" class="sevt done">{{ evtLine }}</p>
        <Tabs v-model="tab" :tabs="[{ id: 'buy', label: '買' }, { id: 'sell', label: '賣' }]" />
        <div v-if="tab === 'buy' && deals.length" class="deals" data-deals>
          <p class="h">今天的特別交易<Hint>每間店每天第一次進來時，店主提出今天的特別交易（AI 關著時用模板）。每一筆只有一份；價格不會低於內容價值的 80%；氣氛交易只有氣氛，沒有隱藏的效果（TRADE 第 10 節）。</Hint></p>
          <div v-for="x in deals" :key="x.d.id" class="deal" :class="{ 'is-unavailable': !!dealReason(x.d, x.price) }">
            <span class="grow"><b>{{ x.d.title }}</b><small>{{ x.d.desc }}</small></span>
            <MoneyTag v-if="x.price" :kind="x.d.pay" :amount="x.price" :size="13" /><span v-else class="tag">不要錢</span>
            <ReasonButton sm :reason="dealReason(x.d, x.price)" :data-deal="x.d.id" @go="takeDeal(x.d, x.price)">{{ x.d.flavor ? '好啊' : '成交' }}</ReasonButton>
          </div>
        </div>
        <div v-if="tab === 'buy'" class="goods">
          <div v-for="(s, i) in stock" :key="s.def" class="gd" :class="{ special: s.special, 'is-unavailable': !!buyReason(i) }" :style="{ '--gc': `var(--g${ITEMS[s.def].grade})` }">
            <ItemSlot :item="ITEMS[s.def]" size="sm" @select="focus = { def: s.def, mode: 'buy', condition: s.condition ?? '全新' }" />
            <div class="gi">
              <b>{{ ITEMS[s.def].name }}</b><span v-if="s.special" class="tag hot">今日</span>
              <small>{{ ITEMS[s.def].type }}・<GradeBadge :grade="ITEMS[s.def].grade" small />・{{ ITEMS[s.def].brand }}<template v-if="s.condition && s.condition !== '全新'">・{{ s.condition }}</template><template v-if="ITEMS[s.def].legality !== '自由'">・<span class="warn-t">{{ ITEMS[s.def].legality }}</span></template></small>
            </div>
            <div class="pr"><MoneyTag kind="cash" :amount="buyPrice(ITEMS[s.def], shop, s.condition ?? '全新').total" :size="13" /><small>剩 {{ s.qty }}</small></div>
            <ReasonButton sm :reason="buyReason(i)" @go="addBuy(i)">放進車</ReasonButton>
          </div>
        </div>
        <div v-else class="goods">
          <div v-for="st in sellables" :key="st.uid" class="gd" :class="{ 'is-unavailable': !!sellReason(st.uid) }" :style="{ '--gc': `var(--g${ITEMS[st.def].grade})` }">
            <ItemSlot :item="ITEMS[st.def]" :qty="st.qty" size="sm" @select="focus = { def: st.def, mode: 'sell', condition: st.condition }" />
            <div class="gi"><b>{{ ITEMS[st.def].name }}</b><small>{{ ITEMS[st.def].type }}・<GradeBadge :grade="ITEMS[st.def].grade" small />・{{ st.condition }}</small></div>
            <div class="pr"><MoneyTag kind="cash" :amount="sellPrice(ITEMS[st.def], shop, st.condition).total" :size="13" /><small>×{{ st.qty }}</small></div>
            <ReasonButton sm :reason="sellReason(st.uid)" @go="addSell(st.uid)">放進車</ReasonButton>
          </div>
        </div>
      </section>
      <aside class="panel cut pad cart">
        <p class="h">購物車</p>
        <div v-if="!cart.length" class="empty-note">還沒有東西。</div>
        <div v-for="l in cart" :key="l.key" class="ln">
          <span class="lm">{{ l.mode === 'buy' ? '買' : '賣' }}</span>
          <button type="button" class="lnm" :style="{ color: `var(--g${ITEMS[l.def].grade})` }" @click="focus = { def: l.def, mode: l.mode, condition: l.condition }">{{ ITEMS[l.def].name }}<template v-if="l.qty > 1"> ×{{ l.qty }}</template></button>
          <b class="mono" :class="{ plus: l.mode === 'sell' }">{{ l.mode === 'sell' ? '−' : '' }}{{ fmt(l.unit * l.qty) }}</b>
          <button type="button" class="rm" :aria-label="`拿掉${ITEMS[l.def].name}`" @click="remove(l.key)">✕</button>
        </div>
        <template v-if="quote && focus">
          <p class="h mt">{{ ITEMS[focus.def].name }}・{{ focus.mode === 'buy' ? '價格' : '收購價' }}拆解<Hint>{{ focus.mode === 'buy' ? '售價＝目錄價 × 店家倍率 × 區倍率 × 類別行情 × 狀態，再打折扣（最多 30%）。每一步四捨五入。' : '收購價＝目錄價 × 收購比例 40% × 收購的區倍率 × 類別行情 × 狀態 × (1 ＋ 折扣 ÷ 2)。' }}</Hint></p>
          <div class="brk">
            <div>目錄價 {{ fmt(quote.base) }}</div>
            <div v-for="s in quote.steps" :key="s.label" :class="s.mult > 1 ? 'u' : s.mult < 1 ? 'd' : ''">{{ s.label }} ×{{ s.mult.toFixed(2) }} {{ s.mult > 1 ? '▲' : s.mult < 1 ? '▼' : '' }} → {{ fmt(s.value) }}</div>
            <div>＝ {{ fmt(quote.total) }}</div>
          </div>
        </template>
        <div class="go left">
          <select v-model="way" class="waysel" aria-label="怎麼殺"><option v-for="w in BARGAIN_WAYS" :key="w.id" :value="w.id">{{ w.name }}（{{ w.check }}）</option></select>
          <ReasonButton sm :reason="bargain !== 'none' ? '每間店每天只能殺價一次。' : !buyTotal ? '車裡沒有要買的東西。' : dc === null ? '原廠直營不能殺價。' : wayReason(way)" data-bargain @go="doBargain">殺價（整車）</ReasonButton>
          <span v-if="bargain !== 'none'" class="tag" :style="{ color: BARGAIN_MULT[bargain] < 1 ? 'var(--ram)' : 'var(--warn)' }">{{ bargain }} ×{{ BARGAIN_MULT[bargain] }}</span>
          <Hint>DC ＝ 13 − ⌊店主親密度 ÷ 25⌋ ＋ 店的脾氣（現在 {{ dc ?? '不能殺' }}）。大成功 ×0.8、親密度 +2；成功 ×0.9；失敗不變；大失敗 ×1.1、親密度 −3。每間店每天一次（TRADE 第 5 節）。</Hint>
        </div>
        <div class="payseg" role="radiogroup" aria-label="付款">
          <button type="button" role="radio" :aria-checked="pay === 'cash'" :class="{ on: pay === 'cash' }" @click="pay = 'cash'">現金晶片<small><MoneyTag kind="cash" :amount="g.money.cash" :size="11" /></small></button>
          <button type="button" role="radio" :aria-checked="pay === 'acc'" :class="{ on: pay === 'acc' }" :aria-disabled="!shop.acceptsAccount || undefined" @click="shop.acceptsAccount ? (pay = 'acc') : ui.toast('這間店只收現金。', 'warn')">帳戶<small><MoneyTag kind="acc" :amount="g.money.acc" :size="11" /></small></button>
        </div>
        <div class="total"><span>合計</span><MoneyTag :kind="pay" :amount="total" :size="16" /></div>
        <div v-if="pay === 'acc' && buyTotal" class="k note">{{ shop.backer }} 敵對值 +1<Hint>用帳戶付會留下紀錄。</Hint></div>
        <div v-if="hasRegistered" class="k note warn-t">車裡有登記類<Hint>登記類的東西不管用哪種錢付，買了都會掃你的橋。</Hint></div>
        <div v-if="shortBy > 0" class="blocking">{{ pay === 'cash' ? '現金' : '帳戶' }}不夠，還差 {{ fmt(shortBy) }}。</div>
        <div class="go"><ReasonButton pri :reason="!cart.length ? '車是空的。' : shortBy > 0 ? '錢不夠。' : null" @go="checkout">結帳</ReasonButton></div>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.sevt { padding: 10px 12px; margin-bottom: 10px; background: var(--bg-term); box-shadow: inset 3px 0 0 var(--ap); }
.sevt p { margin: 4px 0; }
.sevt.done { color: var(--ink-2); font-size: var(--fs-sm); }
.deals { margin-top: 10px; display: grid; gap: 6px; }
.deal { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 8px 10px; background: var(--bg-2); box-shadow: inset 3px 0 0 var(--a); max-width: 880px; }
.deal small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.grow { flex: 1; min-width: 0; }
.waysel { max-width: 200px; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 5px 6px; font: 700 var(--fs-sm) var(--font); }
.shop { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 12px; align-items: start; }
.goods { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, max(360px, calc(50% - 6px))), 1fr)); gap: 6px; margin-top: 10px; }
.gd { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 10px; background: var(--bg-2); border-left: 3px solid var(--gc); }
.gd.special { box-shadow: inset 0 0 0 1px var(--a); }
.gi { min-width: 0; }
.gi b { font-size: var(--fs-ui); color: var(--gc); margin-right: 6px; }
.gi small { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; font-size: var(--fs-fine); color: var(--ink-3); margin-top: 2px; }
.pr { text-align: right; display: grid; justify-items: end; }
.pr small { font-size: var(--fs-tiny); color: var(--ink-3); }
.warn-t { color: var(--warn); }
.ln { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; align-items: center; font-size: var(--fs-sm); padding: 6px 0; border-bottom: 1px dashed var(--line); }
.lm { font-size: var(--fs-fine); font-weight: 900; color: var(--ink-3); }
.lnm { background: none; border: 0; padding: 0; cursor: pointer; text-align: left; font-weight: 800; }
.ln .plus { color: var(--ram); }
.rm { background: none; border: 0; color: var(--ink-3); cursor: pointer; }
.mt { margin-top: 12px; }
.brk { padding: 10px; background: var(--bg-term); font: 700 var(--fs-fine) var(--mono); line-height: 1.9; color: var(--ink-2); }
.brk .u { color: var(--warn); } .brk .d { color: var(--ram); }
.go.left { justify-content: flex-start; align-items: center; }
.payseg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 10px; }
.payseg button { padding: 8px; text-align: center; background: var(--bg-2); font-size: var(--fs-sm); font-weight: 800; color: var(--ink-3); border: 0; cursor: pointer; display: grid; justify-items: center; gap: 2px; }
.payseg button.on { background: var(--a); color: #fff; }
.payseg button.on :deep(.money) { color: #fff; }
.total { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-term); margin-top: 8px; font-weight: 900; }
.note { display: flex; align-items: center; gap: 4px; margin-top: 6px; letter-spacing: 0; }
@media (max-width: 900px) { .shop { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .gd { grid-template-columns: 40px minmax(0, 1fr) auto; } .gd .btn { grid-column: 2 / -1; justify-self: end; } }
</style>
