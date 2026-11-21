
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type FogState, type MapToken } from '../components/GridMap.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import TrackBar from '../components/TrackBar.vue'
import ReasonButton from '../components/ReasonButton.vue'
import Icon from '../components/Icon.vue'
import { useSubnet, TRACE_MARKS } from '../stores/subnet'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { BLUEWHALE, NODE_INFO } from '../data/subnet'
import { key } from '../lib/grid'
import { useWalk } from '../lib/useWalk'
import type { Point } from '../data/types'

/**
 * 子網地圖（UI 規則 4、UI.md 第 5 節）：同一個 GridMap，一層 11 × 9，節點是格子上的設施；
 * 迷霧（沒看過的不顯示、看過的變暗）、追蹤度、換層、化身與管理行動。整頁換成內海皮。
 */
const s = useSubnet()
const g = useGame()
const ui = useUi()
const router = useRouter()
const log = ref<string[]>(['你從藍鯨物流的前台接縫溜進員工層。'])
function note(t: string) { log.value.unshift(t); if (log.value.length > 8) log.value.pop() }

const fog = (x: number, y: number): FogState => (s.visible.has(key({ x, y })) ? 'visible' : s.isExplored({ x, y }) ? 'seen' : 'hidden')
function cellView(x: number, y: number): CellView {
  if (!s.walkable(x, y)) return { kind: 'void' }
  const n = s.nodeAt({ x, y })
  if (!n) return { kind: 'link' }
  const info = NODE_INFO[n.kind]
  const cleared = s.done.has(n.key)
  return { kind: 'node', icon: info.icon, tint: info.color, title: `${info.name}・${n.name}${cleared ? '（處理過了）' : ''}`, mark: cleared ? '✓' : undefined }
}
const tokens = computed<MapToken[]>(() => [{ id: 'me', x: s.pos.x, y: s.pos.y, label: '你', kind: 'me', title: '你的化身' }])

const { path, walkTo } = useWalk({
  grid: () => ({ w: s.w, h: s.h, passable: (x, y) => s.walkable(x, y) && (s.isExplored({ x, y }) || fog(x, y) === 'visible') }),
  pos: () => s.pos,
  step: p => { s.stepTo(p); enter(p) },
  ms: 140,
})
function onCell(p: Point) {
  if (s.located) { ui.toast('已經被定位了：只能拔線。', 'warn'); return }
  if (!s.walkable(p.x, p.y)) return
  if (fog(p.x, p.y) === 'hidden') { ui.toast('那裡還沒探索過。', 'warn'); return }
  if (!walkTo(p)) ui.toast('走不到那裡。', 'warn')
}
/** 鍵盤：方向鍵或 WASD 走一格（沒探索過的也能走，走了就看到）；E 把焦點移到這個節點的行動。 */
function onStep(d: { x: number; y: number }) {
  if (s.located) { ui.toast('已經被定位了：只能拔線。', 'warn'); return }
  const n = { x: s.pos.x + d.x, y: s.pos.y + d.y }
  if (!s.walkable(n.x, n.y)) return
  path.value = []
  s.stepTo(n); enter(n)
}
function onEnter() { (document.querySelector('.node-acts .btn') as HTMLElement | null)?.focus() ?? ui.toast('這一格沒有節點。') }
/** 走進一格時會發生的事：陷阱與遭遇。 */
function enter(p: Point) {
  const n = s.nodeAt(p)
  if (!n || s.done.has(n.key)) return
  if (n.kind === 'alarm') { s.addTrace(10); s.done.add(n.key); note('你踩到了警報節點：追蹤度 +10。'); ui.toast('警報！追蹤度 +10。', 'warn') }
  if (n.kind === 'loop') {
    const die = 1 + Math.floor(Math.random() * 20)
    if (die + 5 >= 12) { s.done.add(n.key); note(`迴圈碎片：介面 1d20(${die}) + 5 對 DC 12，成功，你穿過去了。`) }
    else {
      s.load = Math.min(s.loadMax, s.load + 8)
      note(`迴圈碎片：介面 1d20(${die}) + 5 對 DC 12，失敗。感載 +8，被送回入口。`)
      const start = s.floorIdx === 0 ? { x: 0, y: 0 } : { x: 5, y: 0 }
      setTimeout(() => { s.pos = start; s.reveal() }, 0)
      path.value = []
    }
  }
  if (n.kind === 'lace') note(`${n.name}擋在這裡。`)
}

// ---- 節點上的行動 ----
const here = computed(() => s.here)
const hereInfo = computed(() => (here.value ? NODE_INFO[here.value.kind] : null))
const downloading = ref(0)
function spend(ram: number, reason: string): boolean {
  if (s.ram < ram) { ui.toast(`RAM 不夠：要 ${ram}。`, 'warn'); return false }
  if (s.actionsLeft <= 0) { ui.toast('這一回合的管理行動用完了。', 'warn'); return false }
  s.ram -= ram; s.actionsLeft--; s.addTrace(1); note(reason)
  setTimeout(() => { s.actionsLeft = 1 }, 0)
  return true
}
function download(turns: number, what: string) {
  const n = here.value!
  s.addTrace(2 * turns)
  s.done.add(n.key)
  s.loot.push(what)
  note(`你在${n.name}待了 ${turns} 個回合，拿到${what}：追蹤度 +${2 * turns}。`)
  downloading.value = 0
}
function takeover() { if (spend(3, `你接管了${here.value!.name}。後面的現實階段可以用它。`)) s.done.add(here.value!.key) }
function crack() {
  if (!spend(2, '你破解了閘門，往核心的路開了。')) return
  s.done.add(here.value!.key)
  s.unlocked = 2
  s.setFloor(1)
}
// 委託副本（SERIES 第 6 節）：進入入口的那一刻與這個階段開始時各存一個快照；每場戰鬥開打前再存一個
if (!g.inRun) { g.inRun = true; g.takeSnapshot('入口', '進入入口的那一刻'); g.takeSnapshot('階段', '階段 ② 開始時') }
function fight() {
  g.takeSnapshot('戰鬥', `戰鬥開打前・${here.value!.name}`)
  s.addTrace(9); s.done.add(here.value!.key)
  note(`你和${here.value!.name}打了三個回合：追蹤度 +9。`)
  router.push('/demo/net')
}
function sneak() {
  const die = 1 + Math.floor(Math.random() * 20)
  if (die + 6 >= 14) { s.done.add(here.value!.key); note(`潛行 1d20(${die}) + 6 對 DC 14：成功，你從它旁邊擦過去。`) }
  else { s.addTrace(5); note(`潛行 1d20(${die}) + 6 對 DC 14：失敗，追蹤度 +5，它發現你了。`) }
}
function logout(reason: string) {
  g.inRun = false
  g.snapshots = []
  g.addLog({ prose: [reason], net: [`子網・藍鯨物流：追蹤度 ${s.trace}${s.loot.length ? `；帶出來的：${s.loot.join('、')}` : ''}。`] })
  router.push('/')
}
const ADMIN = [
  { name: '接管', ram: 3, where: 'control' }, { name: '破解', ram: 2, where: 'gate' }, { name: '擦痕跡', ram: 1, where: null }, { name: '斷路', ram: 2, where: null },
  { name: '造牆', ram: 2, where: null }, { name: '拆牆', ram: 2, where: null }, { name: '標記', ram: 1, where: null },
]
function admin(a: typeof ADMIN[number]) {
  if (a.name === '擦痕跡') { if (spend(1, '你擦掉了一段痕跡：追蹤度 −5。')) s.addTrace(-5); return }
  if (a.where && here.value?.kind !== a.where) { ui.toast(`要站在${NODE_INFO[a.where as 'control'].name}上。`, 'warn'); return }
  if (a.name === '接管') return takeover()
  if (a.name === '破解') return crack()
  ui.toast(`「${a.name}」要在戰鬥裡用；內海戰鬥先看 Demo。`)
}
const floorTabs = computed(() => s.floors.map((f, i) => ({ id: String(i), label: `${f.name}（${i + 1}／${s.floors.length}）`, disabled: i >= s.unlocked })))
const floorModel = computed({ get: () => String(s.floorIdx), set: v => s.setFloor(Number(v)) })
const traceStage = computed(() => [...TRACE_MARKS].reverse().find(m => s.trace >= m.at))
</script>

<template>
  <div class="screen">
    <StatusBar back :title="`子網：${BLUEWHALE.name}`" />
    <div class="sub">
      <section class="panel cut pad mapp">
        <div class="mh">
          <Tabs v-model="floorModel" :tabs="floorTabs" @blocked="ui.toast('先打開這一層的閘門。', 'warn')" />
          <Hint title="子網地圖">一層 11 × 9。點看得到或看過的格子，化身照最短的路走過去；沒探索的格子在迷霧裡。節點是格子上的設施：走到上面，右欄出現能做的事。警報節點與迴圈碎片是陷阱。鍵盤：方向鍵或 WASD 走一格，E 跳到這一格的行動。</Hint>
        </div>
        <GridMap :w="s.w" :h="s.h" :cell="cellView" :fog="fog" :tokens="tokens" :path="path" :max-cell="64" :label="`${s.floor.name}的子網圖`" @cell="onCell" @step="onStep" @enter="onEnter" />
        <div class="legend">
          <span v-for="(info, k) in NODE_INFO" :key="k"><Icon :id="info.icon" :size="14" fit />{{ info.name }}<Hint :text="info.hint" /></span>
        </div>
      </section>
      <aside class="side">
        <section class="panel cut pad">
          <div class="trh"><b>追蹤度</b><span class="tv">{{ s.trace }}</span><span v-if="traceStage" class="tag warn">{{ traceStage.name }}</span>
            <Hint title="追蹤度">一座子網一條，往下一層不歸零。踩到警報節點 +10；下載每回合 +2；管理行動 +1，失敗 +5；戰鬥每回合 +3。30 起疑、60 確認入侵、90 定位（強制斷線）。</Hint></div>
          <TrackBar :value="s.trace" :max="100" color="var(--hp)" :marks="[30, 60, 90]" :height="12" />
          <div class="marks"><span>0</span><span>30</span><span>60</span><span>90</span></div>
          <div v-if="s.located" class="blocking">定位：強制斷線，現實的增援出發。</div>
        </section>
        <section class="panel cut pad">
          <p class="h">同步檔位<Hint>每回合換一次。檔位越深，傷害與感載都越重。「全」要敏感度 70。</Hint></p>
          <div class="seg"><button v-for="v in ['淺', '標準', '深', '全'] as const" :key="v" type="button" :class="{ on: s.sync === v }" :aria-disabled="v === '全' || undefined" @click="v === '全' ? ui.toast('「全」要敏感度 70。', 'warn') : (s.sync = v)">{{ v }}</button></div>
        </section>
        <section class="panel cut pad">
          <p class="h">你的化身</p>
          <TrackBar label="感載" :value="s.load" :max="s.loadMax" color="var(--load)" striped />
          <div class="ramrow"><span class="k">RAM</span><i v-for="n in s.ramMax" :key="n" class="pip" :class="{ on: n <= s.ram }" /><span class="mono">{{ s.ram }}／{{ s.ramMax }}</span><Hint>RAM 上限 4 ＋ 智識的調整值 2。探索時每走 3 格回 1 點。</Hint></div>
          <div class="chips"><span class="tag">構裝：破冰</span><span class="tag">護盾</span><span class="tag">SKIN：霓虹雨衣</span></div>
        </section>
        <section class="panel cut pad">
          <p class="h">這裡<template v-if="here">：{{ hereInfo!.name }}</template></p>
          <template v-if="here && hereInfo">
            <div class="nodeh"><Icon :id="hereInfo.icon" :size="28" fit /><b>{{ here.name }}</b><span v-if="s.done.has(here.key)" class="tag">處理過了</span><Hint :text="hereInfo.hint" /></div>
            <div class="go left node-acts">
              <template v-if="here.kind === 'archive'"><ReasonButton sm pri :reason="s.done.has(here.key) ? '已經下載過了。' : null" @go="download(2, '提貨單 ×1')">下載（2 回合）</ReasonButton></template>
              <template v-else-if="here.kind === 'target'"><ReasonButton sm pri :reason="s.done.has(here.key) ? '帳本已經在你手上。' : null" @go="download(3, '藍鯨的帳本')">下載帳本（3 回合）</ReasonButton></template>
              <template v-else-if="here.kind === 'control'"><ReasonButton sm pri :reason="s.done.has(here.key) ? '已經接管了。' : null" @go="takeover">接管（RAM 3）</ReasonButton></template>
              <template v-else-if="here.kind === 'gate'">
                <ReasonButton v-if="s.unlocked < 2" sm pri @go="crack">破解（RAM 2）</ReasonButton>
                <button v-else type="button" class="btn sm pri" @click="s.setFloor(1)">往下一層</button>
              </template>
              <template v-else-if="here.kind === 'lace'">
                <ReasonButton sm pri :reason="s.done.has(here.key) ? '已經過去了。' : null" @go="fight">開戰（內海戰鬥）</ReasonButton>
                <ReasonButton sm :reason="s.done.has(here.key) ? '已經過去了。' : null" @go="sneak">潛行繞過</ReasonButton>
              </template>
              <template v-else-if="here.kind === 'person'"><ReasonButton sm @go="spend(1, `你快駭了${here!.name}，拿到他的門禁卡號。`) && s.done.add(here!.key)">快駭（RAM 1）</ReasonButton><ReasonButton sm reason="網內的對話在第三版做。">談</ReasonButton></template>
              <template v-else-if="here.kind === 'backdoor'"><button type="button" class="btn sm pri" @click="logout('你從預埋的後門登出，拔線回到現實。')">從這裡登出</button><button type="button" class="btn sm" @click="s.load = Math.max(0, s.load - 5); note('你在後門短休：感載 −5。')">短休</button></template>
              <template v-else-if="here.kind === 'entrance' && s.floorIdx > 0"><button type="button" class="btn sm" @click="s.setFloor(0)">回員工層</button></template>
            </div>
          </template>
          <div v-else class="empty-note">站在鏈路上。走到節點上才有事可做。</div>
        </section>
        <section class="panel cut pad">
          <p class="h">管理行動・這回合還能 {{ s.actionsLeft }} 次<Hint>潛網者才有，一共七種。數字是 RAM；次數等於主控的階數。</Hint></p>
          <div class="admin"><button v-for="a in ADMIN" :key="a.name" type="button" class="ad" @click="admin(a)">{{ a.name }}<small>{{ a.ram }}</small></button></div>
          <div class="go left">
            <button type="button" class="btn sm" @click="logout('你強行拔線，從子網裡退出來。')">拔線</button>
            <button type="button" class="btn sm" @click="s.reset(); log = ['你重新從前台的接縫溜進員工層。']">重來</button>
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">紀錄</p>
          <p v-for="(l, i) in log" :key="i" class="ln">{{ l }}</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.screen { min-height: 100vh; display: flex; flex-direction: column; }
.sub { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; padding: 14px; align-items: start; }
.mh { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; font-size: var(--fs-fine); color: var(--ink-2); font-weight: 700; }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.side { display: grid; gap: 12px; min-width: 0; }
.trh { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.tv { font: 900 var(--fs-page) var(--mono); }
.marks { display: flex; justify-content: space-between; font: 700 var(--fs-tiny) var(--mono); color: var(--ink-3); margin-top: 3px; }
.seg { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 12px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; box-shadow: inset 0 0 0 2px var(--o); }
.seg button.on { background: var(--a); color: #fff; }
.seg button[aria-disabled="true"] { opacity: .45; }
.ramrow { display: flex; align-items: center; gap: 5px; margin: 8px 0; }
.pip { width: 13px; height: 13px; transform: rotate(45deg); border-radius: 3px; background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--o); }
.pip.on { background: var(--ram); }
.nodeh { display: flex; align-items: center; gap: 8px; }
.go.left { justify-content: flex-start; }
.admin { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
.ad { display: grid; justify-items: center; padding: 6px 2px; background: var(--bg-2); border: 0; box-shadow: inset 0 0 0 2px var(--o); font-weight: 800; font-size: var(--fs-sm); cursor: pointer; color: var(--ink); }
.ad small { font: 800 var(--fs-tiny) var(--mono); color: var(--ram); }
.ln { margin: 0 0 6px; font: 12.5px/1.6 var(--mono); color: var(--ink-2); }
@media (max-width: 1100px) { .sub { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .sub { padding: 8px; } }
</style>
