<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import ItemSlot from '../components/ItemSlot.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { ITEMS } from '../data/items'
import { BODY_PARTS } from '../data/character'
import { SURGEONS, installQuote, removeQuote, freeSlot, TUNE_FEE, type Surgeon } from '../lib/clinic'
import { chance } from '../lib/commission'
import { fmt } from '../lib/price'
import type { BodyPartId } from '../data/types'

/**
 * 診所（對話框，從診所設施的「裝義體與調校」打開；CYBERWARE 第 2 節、CRAFTING 10.2 節、LEWD_SYSTEM 第 4 節）。
 * 「義體」分頁：身上每個部位裝了什麼（點了看拆下的估價）、背包裡的義體（裝到哪一格、誰來做、手術費、沉溺成本、休養、併發症或檢定）。
 * 「調校」分頁：橋的 2 個調校槽，裝卸背包裡的調校。對話框：它是設施的一項服務，關掉回到街區。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; clinic?: string; black?: boolean }>()
const g = useGame()
const ui = useUi()
const tab = ref('cyber')
const who = ref<Surgeon>(props.black ? 'black' : 'clinic')
const pick = ref<string | null>(null)
const installed = computed(() => BODY_PARTS.map(p => ({ p, ids: g.cyber[p.id].slice(0, p.id === 'bridge' ? 1 : undefined) })))
const bagCyber = computed(() => g.inventory.filter(s => ITEMS[s.def]?.cyber && ITEMS[s.def].type !== '調校'))
const bagTunes = computed(() => g.inventory.filter(s => ITEMS[s.def]?.type === '調校'))
const sel = computed(() => (pick.value ? g.stackOf(pick.value) : null))
const selItem = computed(() => (sel.value ? ITEMS[sel.value.def] : null))
const quote = computed(() => (selItem.value ? installQuote(selItem.value, who.value) : null))
const target = computed(() => (selItem.value ? freeSlot(g.cyber[selItem.value.cyber!.part], selItem.value.cyber!.part) : -1))
const installReason = computed(() => {
  if (!selItem.value || !quote.value) return '先從背包選一件義體。'
  if (target.value < 0) return `${BODY_PARTS.find(p => p.id === selItem.value!.cyber!.part)?.name}沒有空槽：先拆一件。`
  if (who.value === 'black' && props.black === false) return '這間是正規診所，不做黑的。'
  if (g.money.acc < quote.value.fee) return '帳戶不夠。'
  return null
})
function install() {
  const it = selItem.value!, q = quote.value!, part = it.cyber!.part as BodyPartId
  g.money.acc -= q.fee
  g.advance(Math.max(30, q.hours * 60))
  let note = ''
  if (q.dc) { const die = 1 + Math.floor(Math.random() * 20); note = die + 4 >= q.dc ? `義體學 1d20(${die}) + 4 對 ${q.dc}：成功。` : `義體學 1d20(${die}) + 4 對 ${q.dc}：失敗，能用但帶一個瑕疵。` }
  if (q.complication && Math.random() * 100 < q.complication) note = '黑診所的手術留下一個併發症：那一側偶爾會麻。'
  g.cyber[part][target.value] = it.id
  g.removeItem(sel.value!.uid)
  g.addLog({ prose: [`你在${props.clinic ?? '診所'}裝上${it.name}。${note}`], changes: [{ text: `帳戶 −${fmt(q.fee)}`, kind: 'minus' }, { text: `沉溺的下限 +${q.sink}`, kind: 'minus' }] })
  ui.toast(`${it.name}裝好了。休養 ${q.hours} 小時。`)
  pick.value = null
}
const removing = ref<{ part: BodyPartId; i: number } | null>(null)
const remItem = computed(() => (removing.value ? ITEMS[g.cyber[removing.value.part][removing.value.i] ?? ''] ?? null : null))
const remQ = computed(() => (remItem.value ? removeQuote(remItem.value) : null))
function remove() {
  const r = removing.value!, it = remItem.value!, q = remQ.value!
  g.money.acc -= q.fee
  g.cyber[r.part][r.i] = null
  g.addItem(it.id, 1, '二手')
  g.advance(240)
  g.addLog({ prose: [`你在${props.clinic ?? '診所'}拆下${it.name}。`], changes: [{ text: `帳戶 −${fmt(q.fee)}`, kind: 'minus' }, { text: `沉溺的下限 −${q.sink}`, kind: 'plus' }] })
  removing.value = null
}
// ---- 調校 ----
const tuneSlots = computed(() => [1, 2].map(i => g.cyber.bridge[i] ?? null))
function installTune(uid: string) {
  const st = g.stackOf(uid)!
  const i = [1, 2].find(k => !g.cyber.bridge[k])
  if (!i) { ui.toast('兩個調校槽都滿了：先拆一個。', 'warn'); return }
  if (g.money.acc < TUNE_FEE.install) { ui.toast('帳戶不夠。', 'warn'); return }
  g.money.acc -= TUNE_FEE.install
  while (g.cyber.bridge.length < 3) g.cyber.bridge.push(null)
  g.cyber.bridge[i] = st.def
  g.removeItem(uid)
  g.advance(30)
  g.addLog({ prose: [`你在${props.clinic ?? '調校診所'}裝上${ITEMS[st.def].name}。`], changes: [{ text: `帳戶 −${TUNE_FEE.install}`, kind: 'minus' }] })
  ui.toast(`${ITEMS[st.def].name}裝好了。`)
}
function removeTune(i: number) {
  const id = g.cyber.bridge[i + 1]
  if (!id) return
  if (g.money.acc < TUNE_FEE.remove) { ui.toast('帳戶不夠。', 'warn'); return }
  g.money.acc -= TUNE_FEE.remove
  g.cyber.bridge[i + 1] = null
  g.addItem(id)
  ui.toast(`${ITEMS[id].name}拆下來了，收進背包。`)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="診所" :sub="`${clinic ?? '縫縫診所'}・義體手術與調校`" size="xl">
    <template #header>
      <Tabs v-model="tab" :tabs="[{ id: 'cyber', label: '義體' }, { id: 'tune', label: '調校' }]" />
      <Hint title="義體手術">裝上一件義體就墊高沉溺的下限（沉溺成本），拆掉拿回來。正規診所穩定成功、會登記；黑診所便宜，但有一成五的機會留下併發症；自己動手不收錢，要過義體學檢定。休養照侵入度：表層不用、一般 4 小時、侵入 1 天、重度 2 天、極限 4 天。</Hint>
    </template>
    <div v-if="tab === 'cyber'" class="cl">
      <section class="panel cut pad">
        <p class="h">身上的義體<Hint>點一件看拆下的估價。有授權鎖的要先解鎖。</Hint></p>
        <div class="grid2" style="--col-min: 240px">
          <div v-for="r in installed" :key="r.p.id" class="part">
            <span class="pn">{{ r.p.name }}</span>
            <div class="sl"><ItemSlot v-for="(id, i) in r.ids" :key="i" :item="id ? ITEMS[id] : null" :slot-icon="r.p.icon" size="sm" :selected="removing?.part === r.p.id && removing.i === i" :locked="!!(id && ITEMS[id].cyber?.license)" @select="id ? (removing = { part: r.p.id, i }) : ui.toast('空槽：從右邊的背包選一件裝上來。')" /></div>
          </div>
        </div>
        <div v-if="remItem && remQ" class="panel pad rem">
          <b>拆下 {{ remItem.name }}</b>
          <div class="kv"><span>手術費</span><b><MoneyTag kind="acc" :amount="remQ.fee" :size="12" /></b></div>
          <div class="kv"><span>沉溺的下限</span><b class="ok-t">−{{ remQ.sink }}</b></div>
          <div class="go left"><button type="button" class="btn sm" @click="removing = null">算了</button><ReasonButton sm :reason="remQ.reason ?? (g.money.acc < remQ.fee ? '帳戶不夠。' : null)" @go="remove">拆下</ReasonButton></div>
        </div>
      </section>
      <section class="panel cut pad stack">
        <p class="h">背包裡的義體</p>
        <div v-if="!bagCyber.length" class="empty-note">背包裡沒有義體。組裝或在義體零件行買。</div>
        <button v-for="st in bagCyber" :key="st.uid" type="button" class="lrow" :class="{ on: pick === st.uid }" :data-cyber="st.def" @click="pick = st.uid">
          <ItemSlot :item="ITEMS[st.def]" size="sm" inert />
          <span class="grow"><b>{{ ITEMS[st.def].name }}</b><small>{{ BODY_PARTS.find(p => p.id === ITEMS[st.def].cyber!.part)?.name }}・{{ ITEMS[st.def].cyber!.invasive }}・沉溺成本 {{ ITEMS[st.def].cyber!.sink }}</small></span>
        </button>
        <p class="h">誰來做</p>
        <div class="segs"><button v-for="s in SURGEONS" :key="s.id" type="button" :class="{ on: who === s.id }" :title="s.note" @click="who = s.id">{{ s.name }}</button></div>
        <p class="t-fine">{{ SURGEONS.find(s => s.id === who)!.note }}</p>
        <template v-if="selItem && quote">
          <div class="kv"><span>裝到</span><b>{{ BODY_PARTS.find(p => p.id === selItem!.cyber!.part)?.name }}{{ target >= 0 ? `第 ${target + 1} 格` : '（沒有空槽）' }}</b></div>
          <div class="kv"><span>手術費</span><b><MoneyTag kind="acc" :amount="quote.fee" :size="12" /></b></div>
          <div class="kv"><span>沉溺的下限</span><b class="warn-t">+{{ quote.sink }}</b></div>
          <div class="kv"><span>休養</span><b>{{ quote.hours ? `${quote.hours} 小時` : '不用' }}</b></div>
          <div v-if="quote.dc" class="kv"><span>義體學</span><b>對 {{ quote.dc }}・{{ chance(4, quote.dc) }}%</b></div>
          <div v-if="quote.complication" class="kv"><span>併發症</span><b class="warn-t">{{ quote.complication }}%</b></div>
          <p class="t-fine">效果：{{ selItem.cyber!.effect }}</p>
        </template>
        <div class="go"><ReasonButton pri :reason="installReason" data-install @go="install">動手術</ReasonButton></div>
      </section>
    </div>
    <div v-else class="cl">
      <section class="panel cut pad stack">
        <p class="h">橋的調校槽（2）<Hint title="調校">裝在橋的調校槽裡的韌體設定檔，每個都是雙面的。裝一個 {{ TUNE_FEE.install }}、拆一個 {{ TUNE_FEE.remove }}，半小時。</Hint></p>
        <div v-for="(id, i) in tuneSlots" :key="i" class="lrow">
          <ItemSlot :item="id ? ITEMS[id] : null" slot-icon="ic-cw_bridge" label="調校槽" size="sm" inert />
          <span class="grow"><b>{{ id ? ITEMS[id].name : '空的調校槽' }}</b><small>{{ id ? ITEMS[id].cyber?.effect : '從背包裝一個調校。' }}</small></span>
          <ReasonButton v-if="id" sm :reason="g.money.acc < TUNE_FEE.remove ? '帳戶不夠。' : null" @go="removeTune(i)">拆下</ReasonButton>
        </div>
      </section>
      <section class="panel cut pad stack">
        <p class="h">背包裡的調校</p>
        <div v-if="!bagTunes.length" class="empty-note">背包裡沒有調校。</div>
        <div v-for="st in bagTunes" :key="st.uid" class="lrow">
          <ItemSlot :item="ITEMS[st.def]" size="sm" inert />
          <span class="grow"><b>{{ ITEMS[st.def].name }}</b><small>{{ ITEMS[st.def].cyber?.effect }}</small></span>
          <ReasonButton sm pri :reason="tuneSlots.every(Boolean) ? '兩個調校槽都滿了。' : g.money.acc < TUNE_FEE.install ? '帳戶不夠。' : null" :data-tune="st.def" @go="installTune(st.uid)">裝上（{{ TUNE_FEE.install }}）</ReasonButton>
        </div>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.cl { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.part { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--bg-2); }
.pn { width: 4em; font-weight: 800; font-size: var(--fs-sm); flex: none; }
.sl { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.rem { margin-top: var(--space-4); display: grid; gap: var(--space-2); box-shadow: inset 3px 0 0 var(--a); }
.go.left { justify-content: flex-start; }
@media (max-width: 900px) { .cl { grid-template-columns: minmax(0, 1fr); } }
</style>
