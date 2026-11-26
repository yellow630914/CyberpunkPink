
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import RetreatPanel from '../components/body/RetreatPanel.vue'
import GridMap, { type CellView, type MapToken } from '../components/GridMap.vue'
import RidePanel from '../components/RidePanel.vue'
import LogView from '../components/LogView.vue'
import ChainBar from '../components/ChainBar.vue'
import PartyRow from '../components/PartyRow.vue'
import Hint from '../components/Hint.vue'
import Icon from '../components/Icon.vue'
import { useGame } from '../stores/game'
import { useEngine } from '../stores/engine'
import { useUi, PENDING_DIALOGS, type DialogName } from '../stores/ui'
import { useSettings } from '../stores/settings'
import { useGuides } from '../lib/useGuides'
import { lifeDialogOf } from '../lib/lifeView'
import { fmt } from '../lib/price'
import type { Point, Facility } from '../data/types'
import { KEY_OF } from '../lib/keys'
import HereOptions from '../components/HereOptions.vue'
import { pressE, type HereOption } from '../lib/here'
import { deskOption } from '../lib/partsView'
import { auctionOption, stageOf } from '../lib/auctionView'
import { cellInfo, exitList, facilityIcons, fogOf, hereItems } from '../lib/worldView'
import { factionOf, favorTotals, identityOf } from '../lib/peopleView'

/**
 * 主畫面（UI.md 第 3 節）：左欄現在這一塊的街區圖（城市地圖是對話框，工具列「城市」或 M）、小隊、委託條；中欄工具列、紀錄、行動列；右欄這裡的人、地點、進行中。
 * 手機：上面狀態列，下面四個分頁（地圖、紀錄、這裡、工具）。
 * 街區圖、走路、「這裡」能做的事、出口、搭車都是引擎的（features/world、transit）：這裡只畫，不判斷。
 */
const g = useGame()
const e = useEngine()
const ui = useUi()
const st = useSettings()
void PENDING_DIALOGS
const router = useRouter()
/** 潛入與子網：在網內的一趟行程裡就回到子網那一頁；其餘打開「潛入與登出」（站在接入點上列費用，潛入中列去處與登出；做不到的原因是引擎的） */
const netOn = computed(() => e.net.view() !== null)
const diving = computed(() => e.dive.view().diving)
function toNet() { if (netOn.value) void router.push('/subnet'); else ui.openRoot('dive') }
const mobileTab = ref<'map' | 'log' | 'here' | 'tools'>('log')
const freeText = ref('')

// ---- 街區格子（引擎的 gridView 與 worldView） ----
const w = computed(() => e.world.view())
const grid = computed(() => e.world.grid())
const icons = computed(() => facilityIcons(e.world.entry('block', w.value.block?.id ?? '')))
const ride = computed(() => e.transit.view().ride)
function cellView(x: number, y: number): CellView {
  return grid.value ? cellInfo(x, y, grid.value, w.value, icons.value) : { kind: 'void' }
}
const fog = (x: number, y: number) => (grid.value ? fogOf(x, y, grid.value) : 'hidden')
const tokens = computed<MapToken[]>(() => (grid.value ? [{ id: 'me', x: grid.value.at[0], y: grid.value.at[1], label: '你', kind: 'me' }] : []))
/** 走：一個方向或一個目的地交給引擎（碰到事情它會停）；被擋下把引擎的原因放提示列。 */
function go(to: [number, number] | 'north' | 'south' | 'east' | 'west') {
  const r = e.world.walk(to)
  if (!r.ok) { ui.toast(r.reason ?? '現在走不了。', 'warn'); return }
  if (w.value.facility && window.innerWidth <= 720) mobileTab.value = 'here'
}
function onCell(p: Point) { go([p.x, p.y]) }
/** 鍵盤：方向鍵或 WASD 走一格（App.vue 的全域快捷鍵，不必先點地圖） */
function onStep(d: Point) { go(d.x > 0 ? 'east' : d.x < 0 ? 'west' : d.y > 0 ? 'south' : 'north') }
/**
 * 到了就看得到選單、按 E 才做（UI.md 1.1 節，第四版）：站在設施上，右欄「這裡」立刻列出引擎給的每一項能做的事（灰掉的帶引擎的原因），但不自動執行。
 * E 做這一格的預設選項。出口：引擎在走上出口那一格時就換到隔壁那一塊（走路是引擎的），所以出口只列在右欄「出口」裡，點了是走過去。
 */
const here = computed(() => (w.value.facility ? w.value.facilities.find(f => f.marker === w.value.facility!.marker) ?? null : null))
/** 引擎列的項目要打開的畫面；還沒有畫面的給一句話 */
async function runUse(id: string) {
  const life = lifeDialogOf(id)
  if (life) ui.openRoot(life.name, life.props)
  else if (id === 'transit.board') ui.openRoot('transit')
  else if (id === 'world.go') {
    // 站在出口上「前往」：引擎的 arrive(出口的 to, 出口的 arrive)；被擋下顯示引擎的原因
    const r = await e.world.go()
    if (r.status === 'refused') ui.toast(r.reason ?? '現在過不去。', 'warn')
  } else ui.toast('這一項的畫面還沒有接上引擎。')
}
/** 還沒搬進引擎的舊服務（診所、家園……；示意資料）：設施開著才列。搭車、商店、睡覺與休息已經是引擎的（右欄由格子上的項目列出），不重複。 */
const ENGINE_SERVICES = ['transit', 'shop', 'rest']
function optionsOf(f: Facility): HereOption[] {
  // 診所：開之前先問引擎（clinicGate：站在診所、或自己動得了刀）；開不了就灰掉並寫原因
  const svcs = (f.services ?? []).filter(s => !ENGINE_SERVICES.includes(s.action ?? '')).map((s, i) => ({ id: `svc${i}`, name: s.name, sub: s.price ? `現金 ${fmt(s.price)}` : undefined, ...(s.action === 'clinic' ? { reason: e.body.clinicGate() } : {}), run: () => service(s) }))
  return svcs
}
const hereOpts = computed<HereOption[]>(() => {
  const mine: HereOption[] = hereItems(grid.value).map(i => ({ id: i.id, name: i.name, reason: i.reason, run: () => runUse(i.id), ...(i.id.startsWith('trade.shop:') ? { auto: true } : {}) }))
  if (here.value?.open && g.facility) mine.push(...optionsOf(g.facility))
  // 組裝：站的設施帶 craft（店家、同人社團、原廠）時多一項；誰能做、工錢是引擎的 makers
  const craftHere = e.craft.here()
  // 進行中的活動（拍賣……）擋住的別的入口：灰掉、原因是引擎的那一句（blockOf）
  if (craftHere) mine.push({ id: 'craft', name: `組裝（${craftHere.name}）`, sub: '設計圖、零件、換零件、拆解', reason: e.blockOf('commit:craft.assemble'), run: () => ui.openRoot('craft') })
  // 機構的課（引擎的 teachOptions：腳下的設施教的基本功）：有課才多一項「上課」
  if (e.training.options().length) mine.push({ id: 'lesson', name: '上課', sub: `基本功 ${e.training.limits().facilityMax} 級以內`, reason: e.blockOf('commit:ability.lesson'), run: () => ui.openRoot('lesson') })
  // 同人社團的委託台（設施種類帶 unreg_desk）：訂做與取貨
  const desk = e.unreg.desk()
  if (desk) mine.push(deskOption(desk, () => ui.openRoot('partorder'), e.blockOf('commit:unreg.order')))
  // 拍賣行（設施種類帶 auction）：進行中的那一場照樣列、一直開得起來（回到拍賣廳）
  for (const h of e.auction.here()) {
    const s = e.auction.session(h.id)
    mine.push(auctionOption(h, () => ui.openRoot('auction', { house: h.id }), e.auction.view() ? '正在拍賣中' : s ? stageOf(s, e.auction.now()).name : '近期沒有開槌'))
  }
  // 契約：指令指定的地方就是這裡（引擎的 arriveBlock 成立）時多一項去做那一條；不在那裡的不列
  for (const o of e.contract.bound()?.queue ?? []) {
    if ((o.state === 'doing' || o.state === 'forced') && o.place && !o.arrived && e.contract.arriveBlock(o.id) === null) {
      mine.push({ id: `contract.arrive:${o.id}`, name: `去做：${o.name}`, sub: `契約・${o.place_name ?? ''}`, run: () => { const why = e.contract.arrive(o.id); if (why) ui.toast(why, 'warn') } })
    }
  }
  return mine
})
/** 戰後可以解剖的對象（引擎的 dissectOptions：打贏之後一小時內、一場一次）：不必站在設施上，所以另外列 */
const dissectOpts = computed<HereOption[]>(() => {
  const list = e.craft.dissectOptions()
  if (!list.length) return []
  return [{ id: 'dissect', name: '解剖', sub: list.map(o => o.name).join('、'), reason: list.every(o => o.block) ? list[0]!.block : null, run: () => ui.openRoot('craft', { tab: 'dissect' }) }]
})
function onEnter() {
  const msg = pressE(hereOpts.value)
  if (msg) ui.toast(msg, 'warn')
}
/** 這一塊街區的出口（右欄「出口」）：點了走過去，走上出口那一格引擎就換街區 */
const exits = computed(() => exitList(w.value))
function goExit(x: { at: [number, number] | null }) { if (x.at) go([x.at[0], x.at[1]]) }
// 上車之後地圖區換成車上的畫面，手機上切到「地圖」分頁
watch(() => ride.value !== null, on => { if (on) mobileTab.value = 'map' })

// ---- 這裡 ----
/** 引擎的 npcsHere：這個位置、時段與星期對得上出沒表的人；親密度與階段也是引擎的 */
const people = computed(() => e.people.here().map(n => ({ npc: n, known: e.people.known().includes(n.id), affinity: e.people.affinity(n.id), stage: e.people.stage(n.id).name })))
const favorTotal = computed(() => favorTotals(e.people.favors()))
function service(s: NonNullable<Facility['services']>[number]) {
  switch (s.action) {
    case 'home': router.push('/home'); break
    case 'dungeon': router.push('/dungeon'); break
    case 'clinic': {
      const why = e.body.clinicGate()
      if (why) ui.toast(why, 'warn')
      else ui.openRoot('clinic', s.props ?? {})
      break
    }
    case 'garage': case 'mech': case 'fixer': case 'cut': case 'dye': ui.openRoot(s.action, s.props ?? {}); break
    default: ui.toast(`「${s.name}」的畫面在第四版做。`)
  }
}

// ---- 工具列 ----
const guides = useGuides()
/** 契約鈕：主角身上有管理級的契約（boundView）或持有別人的契約（heldPeople）才出現 */
const hasContract = computed(() => e.contract.bound() !== null || e.contract.held().length > 0)
const tools = computed(() => [
  { id: 'city', name: '城市', icon: 'ic-fac_metro' },
  { id: 'character', name: '角色', icon: 'ic-bs_resolve' },
  { id: 'bag', name: '背包', icon: 'ic-cargo' },
  { id: 'skills', name: '技能樹', icon: 'ic-sk_gun_passive' },
  { id: 'roster', name: '名冊', icon: 'ic-bs_negotiate' },
  { id: 'relations', name: '關係', icon: 'ic-bs_seduce', badge: favorTotal.value.youOwe || undefined },
  { id: 'memo', name: '備忘錄', icon: 'ic-bs_investigate', dot: guides.unseen.value.length > 0 },
  { id: 'craft', name: '組裝', icon: 'ic-tool' },
  { id: 'channel', name: '頻道', icon: 'ic-footage', badge: g.channel.events.length },
  { id: 'home', name: '家園', icon: 'ic-fac_home' },
  ...(hasContract.value ? [{ id: 'contract', name: '契約', icon: 'ic-bs_perform' }] : []),
] as Array<{ id: string; name: string; icon: string; badge?: number; dot?: boolean }>)
function tool(id: string) {
  if (id === 'home') router.push('/home')
  else if (id === 'city') ui.openRoot('city')
  else ui.openRoot(id as DialogName)
}
const billDue = computed(() => e.bills.preview())

// ---- 行動列 ----
/** 自由行動：交給引擎（擲骰、DC、結算都在引擎；判定開著時由 AI 選屬性與基本功）。被擋下時顯示引擎給的原因。 */
async function freeAction() {
  const text = freeText.value.trim()
  if (!text) { ui.toast('先寫下想做什麼。', 'warn'); return }
  freeText.value = ''
  mobileTab.value = 'log'
  const r = await e.act({ kind: 'free', text })
  if (r.status === 'refused') { ui.toast(r.reason ?? '現在做不了這件事。', 'warn'); freeText.value = text; return }
  guides.trigger('g_check')
}
/** 任務鏈列：st.s.chainRow 是顯示偏好（隱藏、一直展開、出錯時展開）。 */
const showChain = computed(() => e.chainSteps.length > 0 && (st.s.chainRow === '一直展開' || (st.s.chainRow !== '隱藏' && e.chainSteps.some(x => x.status === 'failed'))))

// ---- 進行中的委託（引擎的 fixer.jobs 與 commission.view） ----
const job = computed(() => e.fixer.jobs()[0] ?? null)
const run = computed(() => e.commission.view())
/** 委託條的每一格：副本開著照引擎的階段軌（沒揭開的寫「？」），還沒出發只有接案、踩點、召集、出發四拍 */
const stages = computed(() => {
  if (run.value) return run.value.track.map(n => ({ name: n.known ? n.name : '？', face: (n.faces ?? []).map(f => ({ meat: 'm', net: 'n', opinion: 'o' }[f])), state: n.state === 'done' ? 'done' : n.state === 'current' ? 'now' : '' }))
  // 手上沒有委託時四格都不亮（沒有「做完」也沒有「現在」）
  const has = !!job.value
  return [{ name: '接案', face: [], state: has ? 'done' : '' }, { name: '踩點', face: [], state: has ? (job.value!.scouts > 0 ? 'done' : 'now') : '' }, { name: '召集', face: [], state: '' }, { name: '副本', face: [], state: '' }]
})
const jobLine = computed(() => (run.value ? `第 ${Math.min(run.value.stage, run.value.stages)} 階段` : job.value ? '還沒出發' : '去中間人那裡接案'))
</script>

<template>
  <div class="screen">
    <StatusBar />
    <div class="main" :data-mtab="mobileTab">
      <!-- 左欄 -->
      <div class="col left">
        <RidePanel v-if="ride" :ride="ride" />
        <section v-else class="panel cut map pad">
          <span class="tick" />
          <div class="maphd">
            <p class="h">{{ w.district?.name }}・{{ w.block?.name }}</p>
            <span class="grow" />
            <button type="button" class="btn sm" title="城市地圖（M）" @click="ui.openRoot('city')"><Icon id="ic-fac_metro" :size="16" fit />城市<kbd>M</kbd></button>
            <Hint title="地圖">街區是 13 × 9 的格子：點設施走過去：到了右欄「這裡」就列出能做的事，不會自動做；黃框、帶 E 的是預設，按 E 做它。走上邊上的出口就換到隔壁的街區（出口也列在右欄，點了走過去）。看不到的地方蓋著霧，走近才看得見。車站也是設施：走上去按 E 開選站。城市地圖（M）看你在哪裡，從那裡只能叫計程車。鍵盤：方向鍵或 WASD 走一格，E 做腳下的預設選項；不必先點地圖。</Hint>
          </div>
          <GridMap v-if="grid" :w="grid.size[0]" :h="grid.size[1]" :cell="cellView" :fog="fog" :tokens="tokens" :max-cell="30" :label="`${w.block?.name ?? ''}的街區圖`" @cell="onCell" @step="onStep" @enter="onEnter" />
          <div v-else class="empty-note">現在不在街區上。</div>
          <div class="legend"><span><i class="lg fac" />設施</span><span><i class="lg exit" />出口</span><span><i class="lg me" />你</span></div>
        </section>
        <section class="panel cut pad party">
          <p class="h">小隊</p>
          <PartyRow v-for="m in e.partyRows()" :key="m.id" :m="m" />
        </section>
        <section class="panel cut pad job">
          <p class="h">委託<Hint title="委託條">進行中的委託與它的階段。每一格寫階段名與可選的面（灰是現實、薄荷是內海、紫是輿論），現在的那格是粉色。點任一格打開委託頁（接案、踩點、召集、副本）。</Hint></p>
          <template v-if="job"><b>{{ job.title }}</b> <span class="tag">{{ e.fixer.entry(job.fixer)?.name ?? job.fixer }}</span></template><span v-else class="empty-note">手上沒有進行中的委託。</span>
          <div class="stages">
            <button v-for="(s, i) in stages" :key="i" type="button" class="stage" :class="s.state" @click="router.push('/commission')">
              {{ s.name }}<span class="faces"><i v-for="f in s.face" :key="f" :class="f" /></span>
            </button>
          </div>
        </section>
      </div>

      <!-- 中欄 -->
      <div class="col center">
        <nav class="panel cut tools" aria-label="工具列">
          <button v-for="t in tools" :key="t.id" type="button" class="tool cut-bg" :title="KEY_OF[t.id] ? `${t.name}（${KEY_OF[t.id]}）` : t.name" :aria-keyshortcuts="KEY_OF[t.id]" @click="tool(t.id)">
            <Icon :id="t.icon" :size="18" fit />{{ t.name }}<kbd v-if="KEY_OF[t.id]">{{ KEY_OF[t.id] }}</kbd><span v-if="t.badge" class="badge-n" data-badge>{{ t.badge }}</span><i v-if="t.dot" class="badge-dot" data-badge aria-label="有沒看過的指南" />
          </button>
        </nav>
        <RetreatPanel />
        <section class="panel cut logp"><ChainBar v-if="showChain" :steps="e.chainSteps" :busy="e.busy" :actions="e.stepActions" @retry="e.retryStep" @rules="e.useRules" @reroll="e.reroll()" /><LogView :entries="g.log" /></section>
        <section class="panel cut act">
          <form class="input" @submit.prevent="freeAction">
            <span class="die" aria-hidden="true" />
            <label class="sr-only" for="free">自由行動</label>
            <input id="free" v-model="freeText" placeholder="自由行動：想做什麼……" autocomplete="off" :disabled="e.busy">
            <button class="btn pri sm" type="submit" :disabled="e.busy">擲骰</button>
          </form>
          <div class="ctx">
            <button type="button" class="btn" data-rest @click="ui.openRoot('rest')">休息</button>
            <button type="button" class="btn" :class="{ pri: diving }" data-dive @click="toNet">{{ netOn ? '回到子網' : diving ? '去處與登出' : '潛入' }}</button>
            <button type="button" class="btn" @click="ui.openRoot('live')">直播</button>
          </div>
        </section>
      </div>

      <!-- 右欄 -->
      <div class="col right">
        <section class="panel cut pad here">
          <p class="h">這裡的人</p>
          <div v-if="!people.length" class="empty-note">這裡沒有認識的人。</div>
          <div v-for="p in people" :key="p.npc.id" class="person" :data-here-person="p.npc.id">
            <div class="ava" aria-hidden="true" />
            <div>
              <b>{{ p.npc.name }}</b> <span v-if="p.npc.faction" class="fac-tag">{{ factionOf(p.npc, e.people.look) }}</span>
              <div class="r">{{ identityOf(p.npc) }}</div>
              <div class="heart">{{ p.known ? `♥ ${p.affinity} ${p.stage}` : '還不認識' }}</div>
              <div class="acts">
                <button type="button" class="hot" data-talk @click="ui.openRoot('talk', { npcId: p.npc.id })">談</button>
                <button v-if="p.known" type="button" @click="ui.openRoot('relations', { npcId: p.npc.id })">關係</button>
              </div>
            </div>
          </div>
        </section>
        <section class="panel cut pad">
          <template v-if="ride">
            <p class="h">車上<Hint>上車之後，主畫面的地圖區換成這一趟的路線條。車廂裡的人、車上能做的事（打聽、整理背包、看窗外）還沒有接上引擎。</Hint></p>
            <div class="empty-note">你在{{ ride.line.name }}上；到站、下車在左邊的路線條上做。</div>
          </template>
          <template v-else>
            <p class="h">地點<template v-if="w.facility">：{{ w.facility.name }}</template><Hint>到了就列出能做的事，不會自動做。黃框、帶 E 的是預設：按 E 做它；點任何一個也可以。灰掉的點了會說原因。</Hint></p>
            <div v-if="!w.facility" class="empty-note">在街區圖上點一個設施走過去。</div>
            <template v-else>
              <HereOptions :options="hereOpts" data-here />
              <div v-if="!hereOpts.length" class="empty-note">這個設施沒有可以用的服務。</div>
            </template>
            <template v-if="dissectOpts.length"><p class="h" style="margin-top: 10px">戰後<Hint>打贏之後一小時內，倒下的對象身上有義體可以拆。拆人要付沉溺與敵對值的代價。</Hint></p><HereOptions :options="dissectOpts" data-here-dissect /></template>
            <p class="h" style="margin-top: 10px">出口<Hint>走到出口那一格就會換到隔壁的街區；也可以點這裡，你會走過去。</Hint></p>
            <div class="exits"><button v-for="x in exits" :key="x.marker" type="button" class="svc" :data-exit="x.to" @click="goExit(x)"><span>往{{ x.toName }}</span><span aria-hidden="true">→</span></button></div>
          </template>
        </section>
        <section class="panel cut pad">
          <p class="h">進行中</p>
          <button type="button" class="ong ongb" @click="router.push('/commission')"><span class="k2" style="background: var(--ap)">委託</span>{{ job?.title ?? '沒有進行中的委託' }}<small>{{ jobLine }}</small></button>
          <button type="button" class="ong ongb" data-favor-row @click="ui.openRoot('relations')"><span class="k2" style="background: var(--ep)">人情</span>欠你 {{ favorTotal.owedToYou }}<template v-if="favorTotal.youOwe">・<span class="warn-t">你欠 {{ favorTotal.youOwe }}</span></template><small>點開看是誰、多大</small></button>
          <button type="button" class="ong ongb" @click="ui.openRoot('bills')"><span class="k2" style="background: var(--warn)">帳單</span>{{ g.billIn }} 天後收租<small>帳戶要付 {{ fmt(billDue.money.cred.due) }}</small></button>
        </section>
      </div>

      <!-- 手機：工具 -->
      <div class="col mtools">
        <section class="panel cut pad">
          <p class="h">工具</p>
          <div class="tgrid">
            <button v-for="t in tools" :key="t.id" type="button" class="tool cut-bg" @click="tool(t.id)"><Icon :id="t.icon" :size="22" fit />{{ t.name }}<span v-if="t.badge" class="badge-n" data-badge>{{ t.badge }}</span><i v-if="t.dot" class="badge-dot" data-badge aria-label="有沒看過的指南" /></button>
            <button type="button" class="tool cut-bg" @click="ui.openRoot('bills')"><Icon id="ic-fac_barter" :size="22" fit />帳單</button>
            <button type="button" class="tool cut-bg" @click="ui.openRoot('saves')"><Icon id="ic-footage" :size="22" fit />存檔</button>
            <button type="button" class="tool cut-bg" data-subnet-tool @click="toNet"><Icon id="ic-net_hack" :size="22" fit />子網</button>
            <button type="button" class="tool cut-bg" @click="router.push('/dungeon')"><Icon id="ic-fac_under" :size="22" fit />地下城</button>
            <button type="button" class="tool cut-bg" @click="ui.openRoot('settings')"><Icon id="ic-tool" :size="22" fit />設定</button>
          </div>
        </section>
      </div>
    </div>
    <nav class="mtabs" aria-label="主畫面的分頁">
      <button v-for="t in [{ id: 'map', n: '地圖' }, { id: 'log', n: '紀錄' }, { id: 'here', n: '這裡' }, { id: 'tools', n: '工具' }] as const" :key="t.id" type="button" class="mtab" :class="{ on: mobileTab === t.id }" @click="mobileTab = t.id">{{ t.n }}</button>
    </nav>
  </div>
</template>

<style scoped>
.screen { height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
.main { flex: 1; min-height: 0; display: grid; grid-template-columns: 360px minmax(0, 1fr) 330px; gap: 12px; padding: 12px; }
.col { display: flex; flex-direction: column; gap: 12px; min-height: 0; min-width: 0; overflow: auto; }
.mtools { display: none; }
.maphd { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.maphd .h { margin: 0; }
.maphd .grow { flex: 1; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; font-size: var(--fs-fine); color: var(--ink-3); }
.lg { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.lg.fac { background: var(--tile-fac); } .lg.exit { box-shadow: inset 0 0 0 2px var(--b); } .lg.me { background: var(--a); border-radius: 50%; } .lg.npc { background: var(--c); border-radius: 50%; }
.stages { display: flex; gap: 6px; margin-top: 8px; }
.stage { flex: 1; padding: 6px 6px 7px; background: var(--bg-2); font-size: var(--fs-fine); color: var(--ink-3); font-weight: 700; border: 0; text-align: left; cursor: pointer; min-width: 0; }
.stage.done { background: #3A2B47; color: var(--ink-2); }
.stage.now { background: var(--a); color: #fff; }
.faces { display: flex; gap: 4px; margin-top: 4px; }
.faces i { width: 16px; height: 5px; border-radius: 2px; background: #ffffff22; }
.faces i.m { background: var(--ink-2); } .faces i.n { background: var(--net); } .faces i.o { background: var(--ep); }
.tools { display: flex; gap: 10px 8px; padding: 12px 20px 12px 12px; flex-wrap: wrap; flex: none; }
.tool { display: flex; align-items: center; gap: 6px; padding: 7px 12px; font-weight: 800; font-size: var(--fs-ui); color: var(--ink-2); position: relative; border: 0; cursor: pointer; }
.tool:hover { color: var(--ink); }
.ongb { display: block; width: 100%; text-align: left; border: 0; color: var(--ink); font: inherit; font-size: var(--fs-ui); cursor: pointer; }
.ongb:hover { background: var(--bg-3); }
.logp { flex: 1; min-height: 0; overflow: auto; padding: 4px 18px 10px; }
.act { padding: 10px; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; flex: none; }
.input { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); min-width: 0; }
.input input { flex: 1; min-width: 0; background: transparent; border: 0; color: var(--ink); font: 500 var(--fs-md) var(--font); outline: none; }
.input input::placeholder { color: var(--ink-3); }
.die { width: 24px; height: 24px; flex: none; background: var(--a); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.ctx { display: flex; gap: 6px; }
.person { display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: start; padding: 8px; background: var(--bg-2); border-radius: 12px; margin-bottom: 8px; }
.person .ava { width: 44px; height: 44px; border-radius: 10px; background: var(--bg-1); position: relative; overflow: hidden; }
.person .ava::before { content: ""; position: absolute; left: 12px; top: 8px; width: 20px; height: 20px; border-radius: 50%; background: var(--b); }
.person .ava::after { content: ""; position: absolute; left: 5px; top: 28px; width: 34px; height: 22px; border-radius: 12px 12px 0 0; background: var(--b); }
.person .r { font-size: var(--fs-fine); color: var(--ink-3); }
.heart { color: var(--a); font-size: var(--fs-fine); font-weight: 800; }
.fac-tag { font-size: var(--fs-tiny); font-weight: 800; padding: 1px 6px; border-radius: 5px; background: #3A2B47; color: var(--ink-2); }
.acts { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; }
.acts button { font-size: var(--fs-fine); font-weight: 800; padding: 4px 9px; border-radius: 7px; background: var(--bg-1); color: var(--ink-2); border: 0; cursor: pointer; }
.acts button.hot { background: var(--a); color: #fff; }
.svc { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 9px 10px; background: var(--bg-2); border-radius: 10px; margin-bottom: 6px; font-weight: 700; border: 0; cursor: pointer; color: var(--ink); font-size: var(--fs-ui); }
.svc:hover { background: var(--bg-3); }
.ong { padding: 8px 10px; background: var(--bg-2); border-radius: 10px; margin-bottom: 6px; font-size: var(--fs-ui); }
.ong small { display: block; color: var(--ink-3); font-size: var(--fs-fine); margin-top: 2px; }
.k2 { font-size: var(--fs-tiny); font-weight: 900; padding: 1px 6px; border-radius: 5px; margin-right: 6px; color: #17111F; }
.warn-t { color: var(--warn); }
.mtabs { display: none; }
.tgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; padding-top: 6px; }
.tgrid .tool { flex-direction: column; padding: 12px 6px; justify-content: center; }

@media (max-width: 1380px) { .main { grid-template-columns: 320px minmax(0, 1fr) 300px; } }
@media (max-width: 1180px) and (min-width: 721px) {
  .main { grid-template-columns: 300px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .left { grid-row: 1 / span 2; }
  .right { grid-column: 2; grid-row: 2; flex-direction: row; max-height: 34vh; }
  .right > section { flex: 1; overflow: auto; }
}
@media (max-width: 720px) {
  .main { display: block; padding: 8px; overflow: auto; }
  .col { display: none; overflow: visible; }
  .main[data-mtab="map"] .left, .main[data-mtab="log"] .center, .main[data-mtab="here"] .right, .main[data-mtab="tools"] .mtools { display: flex; }
  .center .tools { display: none; }
  .logp { overflow: visible; }
  .act { grid-template-columns: 1fr; }
  .ctx .btn { flex: 1; justify-content: center; }
  .mtabs { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--bg-term); border-top: 2px solid var(--line); flex: none; }
  .mtab { display: grid; place-items: center; padding: 12px 0 14px; font-size: var(--fs-ui); font-weight: 800; color: var(--ink-3); position: relative; border: 0; background: none; cursor: pointer; }
  .mtab.on { color: var(--a); }
  .mtab.on::before { content: ""; position: absolute; top: 0; left: 30%; right: 30%; height: 3px; background: var(--a); border-radius: 0 0 3px 3px; }
}
</style>
