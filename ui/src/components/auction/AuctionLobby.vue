<script setup lang="ts">
import { computed, ref } from 'vue'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { PAY_CHOICES, lookBadge, stageOf } from '../../lib/auctionView'
import { fmt } from '../../lib/price'

/**
 * 拍賣行的會場外面（M4-ui-auction 第 1～4 項）：這一場的時間與階段、會員與推薦、目錄與預展看貨、進場。
 * 全部讀引擎（store 的 auction：sessionOf、catalogView、memberOf、refOptions、inspectOptions、enterBlocks）；擋住的原因逐字用引擎的。
 * 目錄與看貨不是會員也看得到；仿品的記號與競標者的預算不在這裡（引擎的讀法本來就不給）。
 */
const props = defineProps<{ house: string }>()
const e = useEngine()
const ui = useUi()

const session = computed(() => e.auction.session(props.house))
const stage = computed(() => (session.value ? stageOf(session.value) : null))
const catalog = computed(() => e.auction.catalog(props.house))
const member = computed(() => e.auction.member(props.house))
const refs = computed(() => e.auction.refOptions(props.house))
const crew = computed(() => e.craft.crew())
const by = ref<string>('')
const inspector = computed(() => (crew.value.some((c) => c.id === by.value) ? by.value : crew.value.find((c) => c.me)?.id ?? crew.value[0]?.id ?? ''))
const inspectRows = computed(() => new Map(e.auction.inspectOptions(props.house, inspector.value || undefined).map((o) => [o.index, o])))
const pay = ref<'cash' | 'cred'>('cash')
const enterBlocks = computed(() => e.auction.enterBlocks(props.house))
const enterReason = computed(() => (enterBlocks.value.length ? enterBlocks.value.join('') : null))
const lots = computed(() => (catalog.value && catalog.value.open ? catalog.value.lots : []))

async function look(lot: number) {
  const r = await e.auction.inspect({ house: props.house, lot, ...(inspector.value ? { by: inspector.value } : {}) })
  if (r.status !== 'applied') ui.toast(r.reason ?? '現在看不了貨。', 'warn')
  else ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '看過了。')
}
async function ask(npc: string, how: 'favor' | 'affinity') {
  const r = await e.auction.ref({ house: props.house, npc, pay: how })
  if (r.status !== 'applied') ui.toast(r.reason ?? '現在請不了推薦函。', 'warn')
  else ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '拿到推薦函了。')
}
async function enter() {
  const r = await e.auction.enter(props.house, pay.value)
  if (r.status !== 'applied') ui.toast(r.reason ?? '現在進不了場。', 'warn')
}
const PAY_HOW: Record<string, string> = { favor: '用一個人情換', affinity: '靠交情（不收東西）' }
const pct = (n: number): string => `${Math.round(n * 100)}%`
</script>

<template>
  <div class="lobby">
    <section class="panel cut pad" data-session>
      <p class="h">這一場<Hint title="一場拍賣">每週一場：目錄在預展開始時公布，預展一天，之後開槌。同一場只能進一次；離場的話剩下的拍品都不喊了。</Hint>
        <span v-if="stage" class="tag" :class="{ hot: stage.id === 'live' }" data-stage :data-stage-id="stage.id">{{ stage.name }}</span></p>
      <template v-if="session">
        <div class="kv"><span>開槌</span><b data-start>{{ e.auction.at(session.start) }}</b></div>
        <div class="kv"><span>目錄公布</span><b data-catalog-at>{{ e.auction.at(session.catalog_at) }}</b></div>
        <div class="kv"><span>預展</span><b data-preview>{{ e.auction.at(session.preview.from) }}～{{ e.auction.at(session.preview.to) }}</b></div>
        <p v-if="stage" class="note" data-stage-hint>{{ stage.hint }}</p>
      </template>
      <p v-else class="empty-note" data-no-session>這一家近期沒有開槌。</p>
    </section>

    <section class="panel cut pad" data-member>
      <p class="h">會員<Hint title="會員">好感夠、或有人寫推薦函，才進得了場。被停權的話要等到恢復的那一天。不是會員也看得到目錄與預展。</Hint></p>
      <div v-if="member.member" class="kv" data-is-member><span>你是會員</span><b>{{ member.via === 'ref' ? '靠推薦函' : '靠好感' }}</b></div>
      <template v-else>
        <div v-for="(b, i) in member.blocks" :key="i" class="blocking" data-member-block>{{ b }}</div>
        <div v-if="refs.length && member.banned === undefined" class="refs" data-refs>
          <p class="h2">請人寫推薦函</p>
          <div v-for="r in refs" :key="r.npc" class="rrow" :data-ref="r.npc">
            <b>{{ r.name }}</b>
            <span class="pays">
              <ReasonButton v-for="p in r.pays" :key="p.pay" sm :pri="p.ok" :reason="e.auction.refBlock({ house, npc: r.npc, pay: p.pay })" :data-ref-pay="p.pay" @go="ask(r.npc, p.pay)">{{ PAY_HOW[p.pay] }}</ReasonButton>
            </span>
          </div>
        </div>
      </template>
    </section>

    <section class="panel cut pad cat" data-catalog>
      <p class="h">目錄<Hint title="預展與看貨">預展的時段裡，站在拍賣行裡可以看貨：零件與義體擲一次檢定（用你最高的那一項基本功），成功才知道是不是仿品或有瑕疵；失敗只知道看不出什麼。一件一次。藝術品、機密與契約沒有仿品的問題。價錢與成功率都是引擎算的。</Hint></p>
      <div v-if="catalog && !catalog.open" class="empty-note" data-catalog-closed>目錄還沒有公布：{{ e.auction.at(catalog.at) }}公布。</div>
      <div v-else-if="!catalog" class="empty-note">沒有這一家拍賣行的目錄。</div>
      <template v-else>
        <label v-if="crew.length > 1" class="pick">誰去看
          <select :value="inspector" data-by @change="by = ($event.target as HTMLSelectElement).value"><option v-for="c in crew" :key="c.id" :value="c.id">{{ c.name }}{{ c.me ? '（你）' : '' }}</option></select>
        </label>
        <p v-if="session && !session.inspectable" class="note" data-no-inspect>現在不是預展的時段，看貨的按鈕是灰的。</p>
        <div class="lots">
          <div v-for="l in lots" :key="l.index" class="lot" :data-lot="l.index">
            <span class="no mono">{{ l.index + 1 }}</span>
            <span class="grow">
              <b data-lot-name>{{ l.name }}<span class="tag k" data-lot-kind>{{ l.kind_name }}</span></b>
              <small v-if="l.desc" data-lot-desc>{{ l.desc }}</small>
              <small data-lot-cert>鑑定書：{{ l.cert }}</small>
              <small class="nums"><span data-lot-reserve>底價 {{ fmt(l.reserve) }}</span>　<span data-lot-step>一階 {{ fmt(l.step) }}</span></small>
              <small v-if="inspectRows.get(l.index)?.skill_name" data-lot-check>看貨：{{ inspectRows.get(l.index)!.skill_name }}・DC {{ inspectRows.get(l.index)!.dc }}・成功率 {{ pct(inspectRows.get(l.index)!.success ?? 0) }}</small>
            </span>
            <span class="acts">
              <span v-if="lookBadge(l)" class="tag" :class="`look-${lookBadge(l)!.tone}`" data-lot-looked :data-look="l.looked?.result">{{ lookBadge(l)!.name }}</span>
              <ReasonButton v-else-if="inspectRows.get(l.index)?.skill_name" sm :reason="inspectRows.get(l.index)!.blocks.join('') || null" data-lot-look @go="look(l.index)">看貨</ReasonButton>
            </span>
          </div>
        </div>
        <p class="note" data-bidders>預計到場的競標者：{{ catalog.bidders.count }} 位<template v-if="catalog.bidders.names.length">（{{ catalog.bidders.names.join('、') }}）</template></p>
      </template>
    </section>

    <section class="panel cut pad" data-enter>
      <p class="h">進場<Hint title="進場">整場用現金晶片還是帳戶付款，進場時選好，不能中途換。武器寄存在門口；會場掃了義體，沒有登記。</Hint></p>
      <div class="chips" role="group" aria-label="付款">
        <button v-for="c in PAY_CHOICES" :key="c.pay" type="button" class="btn sm" :class="{ pri: pay === c.pay }" :aria-pressed="pay === c.pay" :data-pay="c.pay" @click="pay = c.pay">{{ c.name }}</button>
      </div>
      <div v-for="(b, i) in enterBlocks" :key="i" class="blocking" data-enter-block>{{ b }}</div>
      <div class="go"><ReasonButton pri :reason="enterReason" data-enter-go @go="enter">進場</ReasonButton></div>
    </section>
  </div>
</template>

<style scoped>
.lobby { display: grid; gap: var(--space-4); }
.note { margin: var(--space-2) 0 0; color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.6; }
.h .tag { margin-left: var(--space-3); }
.h2 { margin: var(--space-3) 0 var(--space-2); font-size: var(--fs-sm); color: var(--ink-3); font-weight: 800; }
.rrow { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; padding: var(--space-2) var(--space-3); background: var(--bg-2); margin-bottom: var(--space-2); }
.pays { display: inline-flex; gap: var(--space-2); flex-wrap: wrap; }
.pick { display: grid; gap: var(--space-2); font-size: var(--fs-fine); color: var(--ink-3); font-weight: 700; margin-bottom: var(--space-3); }
.pick select { background: var(--bg-1); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line-2); padding: 7px 9px; font: inherit; max-width: 260px; }
.lots { display: grid; gap: var(--space-2); }
.lot { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); background: var(--bg-2); min-width: 0; flex-wrap: wrap; }
.no { flex: none; width: 1.6em; color: var(--ink-3); font-weight: 800; }
.grow { flex: 1; min-width: 200px; display: grid; gap: 2px; }
.grow small { color: var(--ink-3); font-size: var(--fs-xs); line-height: 1.5; }
.k { margin-left: var(--space-2); }
.nums { font-family: var(--mono); }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; }
.look-ok { color: var(--ok); } .look-bad { color: var(--warn); } .look-mid { color: var(--ink-3); }
.chips { display: flex; gap: var(--space-2); flex-wrap: wrap; margin: var(--space-3) 0; }
.go { display: flex; gap: var(--space-3); margin-top: var(--space-3); }
</style>
