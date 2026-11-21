
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type MapToken } from '../components/GridMap.vue'
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
import { settleBills, billMultiplier } from '../lib/bills'
import { fmt } from '../lib/price'
import { useWalk } from '../lib/useWalk'
import type { Point, Facility } from '../data/types'
import { KEY_OF } from '../lib/keys'
import { NPCS } from '../data/npcs'
import HereOptions from '../components/HereOptions.vue'
import { pressE, type HereOption } from '../lib/here'

/**
 * 主畫面（UI.md 第 3 節）：左欄現在這一塊的街區圖（城市地圖是對話框，工具列「城市」或 M）、小隊、委託條；中欄工具列、紀錄、行動列；右欄這裡的人、地點、進行中。
 * 手機：上面狀態列，下面四個分頁（地圖、紀錄、這裡、工具）。
 */
const g = useGame()
const e = useEngine()
const ui = useUi()
const st = useSettings()
void PENDING_DIALOGS
const router = useRouter()
const mobileTab = ref<'map' | 'log' | 'here' | 'tools'>('log')
const freeText = ref('')

// ---- 街區格子 ----
const bm = computed(() => g.blockMap)
const passable = (x: number, y: number) => { const c = bm.value.cells[y]?.[x]; return c !== undefined && c !== '#' }
const { path, walkTo } = useWalk({
  grid: () => ({ w: bm.value.w, h: bm.value.h, passable }),
  pos: () => g.loc.pos,
  step: p => { g.loc.pos = p; g.advance(1) },
})
function cellView(x: number, y: number): CellView {
  const c = bm.value.cells[y][x]
  const k = `${x},${y}`
  const f = bm.value.facilityAt.get(k)
  if (f) return { kind: 'fac', icon: f.icon, title: f.name, tint: f.id === g.loc.facility ? 'var(--a)' : undefined }
  const ex = bm.value.exitAt.get(k)
  if (ex) return { kind: 'exit', mark: '→', title: `往${ex}` }
  return { kind: c === '#' ? 'building' : 'street' }
}
const tokens = computed<MapToken[]>(() => {
  const t: MapToken[] = [{ id: 'me', x: g.loc.pos.x, y: g.loc.pos.y, label: '你', kind: 'me' }]
  for (const [k, f] of bm.value.facilityAt) for (const id of f.npcIds ?? []) {
    const [x, y] = k.split(',').map(Number)
    if (x === g.loc.pos.x && y === g.loc.pos.y) continue
    t.push({ id, x, y, label: NPCS[id].name.slice(0, 1), kind: 'npc', title: NPCS[id].name })
  }
  return t
})
function onCell(p: Point) {
  if (!passable(p.x, p.y)) return
  g.setFacility(null)
  walkTo(p, () => arrive(p))
}
/** 鍵盤：方向鍵或 WASD 走一格（App.vue 的全域快捷鍵，不必先點地圖）；走到哪裡就和那裡互動。 */
function onStep(d: Point) {
  const n = { x: g.loc.pos.x + d.x, y: g.loc.pos.y + d.y }
  if (!passable(n.x, n.y)) return
  g.setFacility(null)
  g.loc.pos = n
  g.advance(1)
  arrive(n)
}
/**
 * 到了就看得到選單、按 E 才做（UI.md 1.1 節，第四版）：走到設施上，右欄「這裡」立刻列出能做的事，但不自動執行；
 * 走到出口也只列出「往某某」。E 做這一格的預設選項：出口就換街區，設施就做第一個服務（黃框、帶 E）。點任何一個選項照樣能做。
 */
function optionsOf(f: Facility): HereOption[] {
  const svcs = (f.services ?? []).map((s, i) => ({ id: `svc${i}`, name: s.name, sub: s.price ? `現金 ${fmt(s.price)}` : undefined, run: () => service(f, s) }))
  const talks = (f.npcIds ?? []).map(id => ({ id: `talk-${id}`, name: `和${g.npcs[id]?.name ?? id}說話`, run: () => ui.openRoot('talk', { npcId: id }) }))
  return [...svcs, ...talks]
}
const hereExit = computed(() => bm.value.exitAt.get(`${g.loc.pos.x},${g.loc.pos.y}`) ?? null)
const hereOpts = computed<HereOption[]>(() => {
  if (hereExit.value) { const to = hereExit.value; return [{ id: 'exit', name: `往${to}`, exit: true, run: () => g.moveBlock(g.loc.district, to, g.loc.block) }] }
  return g.facility ? optionsOf(g.facility) : []
})
function arrive(p: Point) {
  const f = bm.value.facilityAt.get(`${p.x},${p.y}`)
  g.setFacility(f?.id ?? null)
  if ((f || bm.value.exitAt.get(`${p.x},${p.y}`)) && window.innerWidth <= 720) mobileTab.value = 'here'
}
function onEnter() {
  const msg = pressE(hereOpts.value)
  if (msg) ui.toast(msg, 'warn')
}
/** 這一塊街區的出口（右欄「這裡」裡的換地圖按鈕）：點了是明確的選擇，走過去就換街區 */
const exits = computed(() => [...bm.value.exitAt.entries()].map(([k, to]) => { const [x, y] = k.split(',').map(Number); return { to, x, y } }))
function goExit(e: { to: string; x: number; y: number }) { g.setFacility(null); walkTo({ x: e.x, y: e.y }, () => g.moveBlock(g.loc.district, e.to, g.loc.block)) }

// ---- 這裡 ----
const people = computed(() => (g.facility?.npcIds ?? []).map(id => g.npcs[id]))
function service(f: Facility, s: NonNullable<Facility['services']>[number]) {
  switch (s.action) {
    case 'shop': ui.openRoot('shop', { shopId: f.shopId }); break
    case 'home': router.push('/home'); break
    case 'dungeon': router.push('/dungeon'); break
    case 'transit': ui.openRoot('transit'); break
    case 'garage': case 'mech': case 'clinic': case 'fixer': case 'cut': case 'dye': ui.openRoot(s.action, s.props ?? {}); break
    case 'scene': router.push({ path: '/scene', query: { scene: String(s.props?.scene ?? ''), from: '/' } }); break
    case 'rest': g.advance(60); g.addLog({ prose: [`你在${f.name}待了一個小時，感載退了一些。`], changes: [{ text: '感載 −3', kind: 'plus' }] }); g.character.load[0] = Math.max(0, g.character.load[0] - 3); break
    default: ui.toast(`「${s.name}」的畫面在第四版做。`)
  }
}

// ---- 工具列 ----
const guides = useGuides()
const tools = computed(() => [
  { id: 'city', name: '城市', icon: 'ic-fac_metro' },
  { id: 'character', name: '角色', icon: 'ic-bs_resolve' },
  { id: 'bag', name: '背包', icon: 'ic-cargo' },
  { id: 'skills', name: '技能樹', icon: 'ic-sk_gun_passive' },
  { id: 'roster', name: '名冊', icon: 'ic-bs_negotiate' },
  { id: 'relations', name: '關係', icon: 'ic-bs_seduce', badge: 1 },
  { id: 'memo', name: '備忘錄', icon: 'ic-bs_investigate', dot: guides.unseen.value.length > 0 },
  { id: 'craft', name: '組裝', icon: 'ic-tool' },
  { id: 'channel', name: '頻道', icon: 'ic-footage', badge: g.channel.events.length },
  { id: 'home', name: '家園', icon: 'ic-fac_home' },
  { id: 'contract', name: '契約', icon: 'ic-bs_perform' },
] as Array<{ id: string; name: string; icon: string; badge?: number; dot?: boolean }>)
function tool(id: string) {
  if (id === 'home') router.push('/home')
  else if (id === 'city') ui.openRoot('city')
  else ui.openRoot(id as DialogName)
}
const billDue = computed(() => settleBills(g.bills.items, [], { acc: g.money.acc, cash: g.money.cash }, billMultiplier(st.s.billRule, st.s.billMult)))

// ---- 行動列 ----
/** 自由行動：交給引擎（擲骰、DC、結算都在引擎；判定開著時由 AI 選屬性與基本功）。被擋下時顯示引擎給的原因。 */
async function freeAction() {
  const text = freeText.value.trim()
  if (!text) { ui.toast('先寫下想做什麼。', 'warn'); return }
  freeText.value = ''
  mobileTab.value = 'log'
  const r = await e.act({ kind: 'free', text })
  if (r.status === 'blocked') { ui.toast(r.reason ?? '現在做不了這件事。', 'warn'); freeText.value = text; return }
  guides.trigger('g_check')
}
/** 任務鏈列：st.s.chainRow 是顯示偏好（隱藏、一直展開、出錯時展開）。 */
const showChain = computed(() => e.chainSteps.length > 0 && (st.s.chainRow === '一直展開' || (st.s.chainRow !== '隱藏' && e.chainSteps.some(x => x.status === 'failed'))))

const stages = [
  { name: '踩點', face: ['m'], state: 'done' },
  { name: '潛入子網', face: ['n'], state: 'now' },
  { name: '第三倉', face: ['m', 'n'], state: '' },
  { name: '收尾', face: ['m', 'o'], state: '' },
]
</script>

<template>
  <div class="screen">
    <StatusBar />
    <div class="main" :data-mtab="mobileTab">
      <!-- 左欄 -->
      <div class="col left">
        <section class="panel cut map pad">
          <span class="tick" />
          <div class="maphd">
            <p class="h">{{ g.district.name }}・{{ g.loc.block }}</p>
            <span class="grow" />
            <button type="button" class="btn sm" title="城市地圖（M）" @click="ui.openRoot('city')"><Icon id="ic-fac_metro" :size="16" fit />城市<kbd>M</kbd></button>
            <Hint title="地圖">街區是 13 × 9 的格子：點設施走過去：到了右欄「這裡」就列出能做的事，不會自動做；黃框、帶 E 的是預設，按 E 做它。走到邊上的箭頭再按 E 換街區（出口也列在「這裡」，點了直接走過去換）。車站也是設施：走上去按 E 開選站。城市地圖（M）看你在哪裡，從那裡只能叫計程車或開自己的車。鍵盤：方向鍵或 WASD 走一格，E 做腳下的預設選項；不必先點地圖。</Hint>
          </div>
          <GridMap :w="bm.w" :h="bm.h" :cell="cellView" :tokens="tokens" :path="path" :max-cell="30" :label="`${g.loc.block}的街區圖`" @cell="onCell" @step="onStep" @enter="onEnter" />
          <div class="legend"><span><i class="lg fac" />設施</span><span><i class="lg exit" />出口</span><span><i class="lg me" />你</span><span><i class="lg npc" />人</span></div>
        </section>
        <section class="panel cut pad party">
          <p class="h">小隊</p>
          <PartyRow v-for="m in g.party" :key="m.id" :m="m" />
        </section>
        <section class="panel cut pad job">
          <p class="h">委託<Hint title="委託條">進行中的委託與它的階段。每一格寫階段名與可選的面（灰是現實、薄荷是內海、紫是輿論），現在的那格是粉色。點任一格打開委託頁（接案、踩點、召集、副本）。</Hint></p>
          <b>藍鯨的帳本</b> <span class="tag">竊取・中型</span> <span class="tag">夢露</span>
          <div class="stages">
            <button v-for="s in stages" :key="s.name" type="button" class="stage" :class="s.state" @click="router.push('/commission')">
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
        <section class="panel cut logp"><ChainBar v-if="showChain" :steps="e.chainSteps" :busy="e.busy" @retry="e.retryStep" @rules="e.useRules" @reroll="e.reroll()" /><LogView :entries="g.log" /></section>
        <section class="panel cut act">
          <form class="input" @submit.prevent="freeAction">
            <span class="die" aria-hidden="true" />
            <label class="sr-only" for="free">自由行動</label>
            <input id="free" v-model="freeText" placeholder="自由行動：想做什麼……" autocomplete="off" :disabled="e.busy">
            <button class="btn pri sm" type="submit" :disabled="e.busy">擲骰</button>
          </form>
          <div class="ctx">
            <button type="button" class="btn" @click="g.advance(60); g.addLog({ prose: ['你找個地方坐下來喘口氣。'] })">休息</button>
            <button type="button" class="btn" @click="router.push('/subnet')">潛入</button>
            <button type="button" class="btn" @click="ui.openRoot('live')">直播</button>
          </div>
        </section>
      </div>

      <!-- 右欄 -->
      <div class="col right">
        <section class="panel cut pad here">
          <p class="h">這裡的人</p>
          <div v-if="!people.length" class="empty-note">這裡沒有認識的人。</div>
          <div v-for="n in people" :key="n.id" class="person">
            <div class="ava" aria-hidden="true" />
            <div>
              <b>{{ n.name }}</b> <span class="fac-tag">{{ n.district }}</span>
              <div class="r">{{ n.identity }}</div>
              <div class="heart">♥ {{ n.affinity }} {{ n.stage }}</div>
              <div class="acts">
                <button type="button" class="hot" @click="ui.openRoot('talk', { npcId: n.id })">談</button>
                <button type="button" @click="ui.openRoot('relations', { npcId: n.id })">關係</button>
              </div>
            </div>
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">地點<template v-if="g.facility">：{{ g.facility.name }}</template><template v-else-if="hereExit">：往{{ hereExit }}的出口</template><Hint>到了就列出能做的事，不會自動做。黃框、帶 E 的是預設：按 E 做它（出口是換街區）；點任何一個也可以。</Hint></p>
          <div v-if="!g.facility && !hereExit" class="empty-note">在街區圖上點一個設施走過去。</div>
          <template v-else>
            <HereOptions :options="hereOpts" data-here />
            <div v-if="g.facility && !hereOpts.length" class="empty-note">這個設施沒有可以用的服務。</div>
          </template>
          <p class="h" style="margin-top: 10px">出口<Hint>走到出口直接換街區；也可以點這裡，你會走過去。</Hint></p>
          <div class="exits"><button v-for="e in exits" :key="e.to" type="button" class="svc" :data-exit="e.to" @click="goExit(e)"><span>往{{ e.to }}</span><span aria-hidden="true">→</span></button></div>
        </section>
        <section class="panel cut pad">
          <p class="h">進行中</p>
          <button type="button" class="ong ongb" @click="router.push('/commission')"><span class="k2" style="background: var(--ap)">委託</span>藍鯨的帳本<small>{{ g.job.offer ? `第 ${g.job.stage + 1} 階段` : '還沒接・夢露手上' }}</small></button>
          <button type="button" class="ong ongb" @click="ui.openRoot('relations', { npcId: 'npc_xiaomai' })"><span class="k2" style="background: var(--ep)">人情</span>小麥欠你 1<small>小人情</small></button>
          <button type="button" class="ong ongb" @click="ui.openRoot('bills')"><span class="k2" style="background: var(--warn)">帳單</span>{{ g.billIn }} 天後收租<small>帳戶要付 {{ fmt(billDue.dueAcc) }}</small></button>
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
            <button type="button" class="tool cut-bg" @click="router.push('/subnet')"><Icon id="ic-net_hack" :size="22" fit />子網</button>
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
