<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type FogState, type MapToken } from '../components/GridMap.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import TrackBar from '../components/TrackBar.vue'
import ReasonButton from '../components/ReasonButton.vue'
import HereOptions from '../components/HereOptions.vue'
import Icon from '../components/Icon.vue'
import EndCard from '../components/EndCard.vue'
import MoneyTag from '../components/MoneyTag.vue'
import CurtainPanel from '../components/curtain/CurtainPanel.vue'
import FallPanel from '../components/curtain/FallPanel.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { curtainOptions } from '../lib/curtainView'
import { pressE } from '../lib/here'
import { LEGEND_ORDER, leaveSettlement, logoutFlow, NODE_INFO, STAGE_NAME, cellOf, fogOf, goalLine, hereOptions, mazeOptions, patrolTokens, ratioWidth, traceStages, watchRunEnd } from '../lib/netrunView'
import type { Point } from '../data/types'

/**
 * 子網地圖（UI.md 第 5 節、1.1 節規則 4；dev/work/M3-ui-subnet.md）：整頁讀引擎，畫面只編排。
 * 地圖是引擎的 gridView（看過的格子、站的位置），節點、巡邏、追蹤度、層、目標、能做的事與原因是 netrunView；
 * 走路、做節點上的事、往下一層、登出都是引擎的動作（走格子 gridMove、useNode、descend、logout）。這裡沒有任何規則。
 * 站在遭遇節點旁邊時，右欄列出它的開戰與潛行繞過（遭遇節點站不上去）；到了就看得到選單、按 E 才做。
 */
const e = useEngine()
const ui = useUi()
const router = useRouter()

const view = computed(() => e.net.view())
const grid = computed(() => (view.value ? e.net.grid() : null))
const sheet = computed(() => (view.value ? e.net.sheet() : null))
const party = computed(() => (view.value ? e.net.party() : []))

// ---- 這一趟結束了就離開這一頁：委託的那一段回副本頁，其餘回主畫面 ----
// 自己潛進去的一趟（自己去挖、迷宮館）離開時先停在結算：列帶走的東西、敵對值、迷宮館的評價與獎金，按鈕才離開（M3-ui-dive）
const ended = computed(() => e.dive.lastEnd())
const diving = computed(() => e.dive.view().diving)
watchRunEnd(view, path => { if (!ended.value) void router.replace(path) }, () => { if (!ended.value) ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '這一趟結束了。') })
/** 離開結算：還在潛入中就回到去處的清單，否則回主畫面 */
function leaveEnd() {
  return leaveSettlement({ clear: () => e.dive.clearEnd(), go: p => router.replace(p), diving: diving.value, openDive: () => ui.openRoot('dive') })
}

// ---- 自己去挖與迷宮館的抬頭 ----
const dig = computed(() => view.value?.dig ?? null)
const maze = computed(() => (view.value ? e.maze.view() : null))
const mazeLayerSub = computed(() => (maze.value?.layers ?? []).map(l => `${l.name} ${l.used}／${l.standard}`).join('　'))

// ---- 地圖 ----
const patrolAts = computed<Array<[number, number]>>(() => (view.value ? view.value.patrols.filter(p => p.visible).map(p => p.at) : []))
const goalId = computed(() => {
  const g = view.value?.goal
  return g?.at && grid.value && g.at.sheet === grid.value.sheet ? g.at.id : null
})
function cellView(x: number, y: number): CellView {
  return grid.value && sheet.value ? cellOf(x, y, grid.value, sheet.value.markers, goalId.value) : { kind: 'void' }
}
function fog(x: number, y: number): FogState {
  return grid.value && sheet.value ? fogOf(x, y, grid.value, sheet.value.visible, patrolAts.value) : 'hidden'
}
const tokens = computed<MapToken[]>(() => (view.value && grid.value ? [...patrolTokens(view.value), { id: 'me', x: grid.value.at[0], y: grid.value.at[1], label: '你', kind: 'me' as const, title: '你的化身' }] : []))

/** 走：一個方向或一個目的地交給引擎（碰到事情它會停）；被擋下把引擎的原因放提示列 */
function go(to: [number, number] | 'north' | 'south' | 'east' | 'west') {
  if (confirm.value) return
  const r = e.net.walk(to)
  if (!r.ok) ui.toast(r.reason ?? '現在走不了。', 'warn')
}
const onCell = (p: Point) => go([p.x, p.y])
const onStep = (d: Point) => go(d.x > 0 ? 'east' : d.x < 0 ? 'west' : d.y > 0 ? 'south' : 'north')

// ---- 節點上的事 ----
/** 做一件事（引擎列的 id；at 是旁邊的遭遇節點）。被擋下顯示引擎的原因 */
async function doUse(id: string, at?: string) {
  const r = await e.net.use(id, at)
  if (r.status !== 'applied' && r.reason) ui.toast(r.reason, 'warn')
}
/** 登出類的（安全點的「從這裡登出」）：先問，引擎給的那一句寫在確認框裡 */
function use(id: string, at?: string) {
  if (id === 'safe_logout' && view.value?.logout.note) { confirm.value = true; return }
  void doUse(id, at)
}
/** 迷宮館的寶箱與機關由 maze 處理（netrun 不列）：引擎的 mazeView.near；做不到顯示引擎的原因 */
async function doMaze(id: string, at: string) {
  const r = await e.maze.use(id, at)
  if (r.status !== 'applied' && r.reason) ui.toast(r.reason, 'warn')
}
/** 簾後館的點單、賞箱、條文、近道、獎品室與包場由 curtain 處理（netrun 不列）：引擎的 curtainView；遭遇的開戰與潛行繞過仍是 netrunView 的 */
async function doCurtain(id: string, at?: string) {
  const r = await e.curtain.use(id, at)
  if (r.status !== 'applied' && r.reason) ui.toast(r.reason, 'warn')
}
const curtain = computed(() => (view.value ? e.curtain.view() : null))
const fall = computed(() => e.curtain.fall())
const opts = computed(() => {
  if (!view.value) return []
  const m = maze.value
  const c = curtain.value
  if (c) return [...hereOptions(view.value, use), ...curtainOptions(c, doCurtain)]
  return m ? [...hereOptions(view.value, use).filter(o => o.id !== 'open' && !o.id.startsWith('solve')), ...mazeOptions(m, doMaze)] : hereOptions(view.value, use)
})
function onEnter() {
  if (confirm.value) return
  const msg = pressE(opts.value)
  if (msg) ui.toast(msg, 'warn')
}
const admin = computed(() => view.value?.admin ?? [])

// ---- 登出 ----
const flow = logoutFlow({ block: () => view.value?.logout.block ?? null, logout: () => e.net.logout(), toast: m => ui.toast(m, 'warn') })
const confirm = flow.confirm
const askLogout = flow.ask
const doLogout = flow.ok

// ---- 抬頭 ----
const layerTabs = computed(() => (view.value ? view.value.layer.names.map((n, i) => ({ id: String(i + 1), label: `${n}（${i + 1}／${view.value!.layer.total}）`, disabled: i + 1 !== view.value!.layer.index })) : []))
const stages = computed(() => (view.value ? traceStages(view.value.trace.marks) : []))
const traceColor = computed(() => (view.value?.trace.stage === 'located' || view.value?.trace.stage === 'alert' ? 'var(--hp)' : view.value?.trace.stage === 'suspect' ? 'var(--warn)' : 'var(--ram)'))
const log = computed(() => e.state.reports.filter(r => (r.action ?? '').startsWith('netrun.') || ((r.action ?? '').startsWith('grid.') && !!r.outcome.summary)).slice(-8).reverse())
const hereName = computed(() => view.value?.here.marker?.name ?? null)
</script>

<template>
  <div class="screen">
    <StatusBar back :title="view ? `${curtain ? `簾後館・${curtain.night.name}` : maze ? `迷宮館・${maze.name}` : `子網：${view.region.name}`}` : ended ? '離開結算' : fall ? '落幕' : '子網'" />
    <div v-if="!view && ended" class="empty panel cut pad" data-settle>
      <EndCard :end="ended">
        <div class="go left"><button type="button" class="btn pri" data-leave @click="leaveEnd">{{ diving ? '回到去處' : '回主畫面' }}</button></div>
      </EndCard>
    </div>
    <div v-else-if="!view && fall" class="empty panel cut pad" data-fall-page><FallPanel :fall="fall" /></div>
    <div v-else-if="!view" class="empty panel cut pad" data-empty>
      <p>現在沒有潛進任何子網。</p>
      <button type="button" class="btn pri" @click="router.push('/')">回主畫面</button>
    </div>
    <div v-else class="sub" data-subnet>
      <section class="panel cut pad mapp">
        <div class="mh">
          <Tabs :model-value="String(view.layer.index)" :tabs="layerTabs" @blocked="ui.toast('換層只能從閘門往下一層。', 'warn')" />
          <Hint title="子網地圖">點看得到或看過的格子，化身照最短的路走過去；沒探索的格子在迷霧裡。站上節點算一個探索回合。節點站上去，右欄「這裡」列出能做的事，不會自動做；黃框那一個按 E。遭遇站不上去，走到它旁邊再選開戰或潛行繞過。</Hint>
          <span class="rnd mono" data-round>探索回合 <b>{{ view.round }}</b></span>
        </div>
        <div v-if="dig" class="digh" data-dig>
          <span class="tag" data-dig-facility>{{ e.contentName('net_facility', dig.facility) ?? dig.facility }}</span>
          <span class="tag" data-dig-visits>第 {{ dig.visits }} 次進來</span>
          <span v-for="a in dig.affixes" :key="a.id" class="tag warn" data-dig-affix>{{ a.name }}</span>
          <span v-if="dig.backdoors.length" class="tag ok" data-dig-backdoors>後門：{{ dig.backdoors.join('、') }}</span>
        </div>
        <GridMap v-if="grid" :w="grid.size[0]" :h="grid.size[1]" :cell="cellView" :fog="fog" :tokens="tokens" :max-cell="64" :label="`${grid.name}的子網圖`" @cell="onCell" @step="onStep" @enter="onEnter" />
        <div class="legend">
          <span v-for="k in LEGEND_ORDER" :key="k"><Icon :id="NODE_INFO[k]!.icon" :size="14" fit />{{ NODE_INFO[k]!.name }}<Hint :text="NODE_INFO[k]!.hint" /></span>
          <span><b class="lk">單</b>單向鏈路</span><span><b class="lk">斷</b>走過就斷</span><span><b class="lk">★</b>目標</span><span><b class="lk">✓</b>處理過了</span><span><b class="lk tk">巡</b>巡邏</span>
        </div>
      </section>
      <aside class="side">
        <CurtainPanel v-if="curtain" :view="curtain" />
        <section v-else-if="maze" class="panel cut pad" data-maze-panel>
          <div class="trh"><b>迷宮館・{{ maze.name }}（{{ ['', 'I', 'II', 'III', 'IV', 'V'][maze.grade] }}）</b><span class="tag hot" data-maze-rating>預估 {{ maze.rating }}</span></div>
          <div class="kv"><span>回合</span><b data-maze-rounds>{{ maze.rounds }}／標準 {{ maze.standard }}</b></div>
          <div class="ratio" aria-hidden="true"><i :style="{ width: ratioWidth(maze.ratio) + '%' }" /></div>
          <p class="note" data-maze-layers>{{ mazeLayerSub }}</p>
          <div class="kv"><span>倒下</span><b data-maze-downs>{{ maze.downs }} 人次</b></div>
          <div class="kv"><span>籌碼</span><b data-maze-chips>{{ maze.chips }} 枚（每枚 <MoneyTag kind="cash" :amount="maze.chipValue" />）</b></div>
          <div class="kv"><span>押金</span><b><MoneyTag kind="cash" :amount="maze.deposit" /></b></div>
          <div class="kv"><span>獎金</span><b data-maze-prize><MoneyTag kind="cash" :amount="maze.prize" />（照預估的評價）</b></div>
        </section>
        <section v-else class="panel cut pad" data-trace-panel>
          <div class="trh"><b>追蹤度</b><span class="tv mono" data-trace-value>{{ view.trace.value ?? '—' }}</span><span v-if="view.trace.stage" class="tag warn" data-trace-stage>{{ STAGE_NAME[view.trace.stage] }}</span>
            <Hint title="追蹤度">一座子網一條，往下一層不歸零。管理行動與下載會往上加，擦痕跡往下降。<template v-for="s in stages" :key="s.at"><br>{{ s.at }}　{{ s.text }}</template></Hint></div>
          <template v-if="view.trace.value !== null">
            <TrackBar :value="Math.max(0, view.trace.value)" :max="100" :color="traceColor" :marks="view.trace.marks" :height="12" />
            <div class="marks"><span>0</span><span v-for="s in stages" :key="s.at" :title="s.text">{{ s.at }}<small>{{ s.name }}</small></span></div>
          </template>
          <p v-else class="note">這一區沒有追蹤度。</p>
          <div v-if="view.trace.located !== null" class="blocking" data-located>已被定位：還剩 {{ view.trace.located }} 個探索回合，歸零就全隊被強制斷線。</div>
        </section>
        <section class="panel cut pad">
          <p class="h">目標<Hint title="這一趟的目標">{{ view.goal.text }}</Hint></p>
          <p class="goal" data-goal>{{ view.goal.text }}</p>
          <div class="goalr"><span class="tag" :class="{ ok: view.goal.done }" data-goal-line>{{ goalLine(view) }}</span><span v-if="view.keys" class="tag">憑證 ×{{ view.keys }}</span></div>
          <div v-if="view.loot.length" class="loot" data-loot><span v-for="(l, i) in view.loot" :key="i" class="tag">{{ l.name }}<template v-if="l.qty > 1"> ×{{ l.qty }}</template></span></div>
          <p v-if="view.controls.length" class="note">接管了：{{ view.controls.map(c => c.name ?? c.id).join('、') }}</p>
        </section>
        <section class="panel cut pad" data-party>
          <p class="h">你們的化身<Hint>每個隊員自己的感載與餘韻；同步檔位的上限由同步技能與敏感度決定（內海戰鬥裡換檔）。</Hint></p>
          <div v-for="m in party" :key="m.id" class="mem" :data-member="m.id">
            <div class="mn"><b>{{ m.name }}</b><span v-if="m.me" class="tag">你</span><span class="tag" title="同步檔位的上限">同步上限：{{ m.syncCap }}</span><span v-if="m.afterglow" class="tag warn">餘韻 {{ m.afterglow }}</span></div>
            <TrackBar label="感載" :value="m.load[0]" :max="m.load[1]" color="var(--load)" striped />
          </div>
        </section>
        <section class="panel cut pad" data-here>
          <p class="h">這裡<template v-if="hereName">：{{ hereName }}</template></p>
          <div v-if="view.near.length" class="near" data-near>旁邊有遭遇：<b v-for="n in view.near" :key="n.id">{{ n.name }}</b></div>
          <HereOptions v-if="opts.length" class="node-acts" :options="opts" />
          <div v-else class="empty-note">站在鏈路上。走到節點上，或走到遭遇節點旁邊，才有事可做。</div>
          <p v-if="view.rested" class="note">這一層的休息點已經用過了。</p>
        </section>
        <section v-if="admin.length" class="panel cut pad" data-admin>
          <p class="h">管理行動<Hint>潛網者（主控）才有，哪一格都能做。每做一次追蹤度往上，檢定失敗更多。</Hint></p>
          <div class="adm"><ReasonButton v-for="a in admin" :key="a.id" sm :reason="a.block" :data-admin="a.id" @go="doUse(a.id)">{{ a.name }}</ReasonButton></div>
        </section>
        <section class="panel cut pad">
          <p class="h">登出</p>
          <p v-if="view.logout.note" class="note" data-logout-note>{{ view.logout.note }}</p>
          <div class="go left"><ReasonButton sm :reason="view.logout.block" data-logout @go="askLogout">登出</ReasonButton></div>
        </section>
        <section class="panel cut pad">
          <p class="h">紀錄</p>
          <p v-for="r in log" :key="r.id" class="ln">{{ r.outcome.summary }}</p>
          <p v-if="!log.length" class="note">還沒有紀錄。</p>
        </section>
      </aside>
    </div>
    <div v-if="confirm && view" class="gate" role="alertdialog" aria-modal="true" aria-label="登出確認" data-confirm>
      <div class="box panel cut pad">
        <h3>要登出嗎？</h3>
        <p data-confirm-note>{{ view.logout.note ?? '離開這座子網，回到現實。' }}</p>
        <div class="go">
          <button type="button" class="btn sm" data-cancel @click="flow.cancel">取消</button>
          <button type="button" class="btn sm pri" data-ok @click="doLogout">登出</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screen { min-height: 100vh; display: flex; flex-direction: column; }
.empty { margin: var(--space-5); display: grid; gap: var(--space-4); justify-items: start; }
.sub { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--space-4); padding: var(--space-4); align-items: start; }
.mapp { min-width: 0; }
.digh { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-3); }
.ratio { height: 6px; background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); margin: var(--space-2) 0; }
.ratio i { display: block; height: 100%; background: var(--ap); }
.mh { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); min-width: 0; }
.rnd { margin-left: auto; flex: none; font-size: var(--fs-sm); color: var(--ink-2); }
.legend { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-3); font-size: var(--fs-fine); color: var(--ink-2); font-weight: 700; }
.legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.lk { display: inline-grid; place-items: center; min-width: 16px; height: 16px; border-radius: 4px; background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); font: 900 var(--fs-micro) var(--mono); color: var(--ink-2); }
.lk.tk { background: var(--hp); color: #fff; border-radius: 50%; }
.side { display: grid; gap: var(--space-4); min-width: 0; }
.trh { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); flex-wrap: wrap; }
.tv { font: 900 var(--fs-page) var(--mono); }
.marks { display: flex; justify-content: space-between; font: 700 var(--fs-tiny) var(--mono); color: var(--ink-3); margin-top: var(--space-2); }
.marks small { margin-left: 3px; font-family: var(--font); }
.note { margin: var(--space-2) 0 0; color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.6; }
.goal { margin: 0 0 var(--space-3); color: var(--ink-2); line-height: 1.6; font-size: var(--fs-sm); }
.goalr, .loot { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
.mem { display: grid; gap: var(--space-2); margin-bottom: var(--space-3); }
.mn { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.near { margin-bottom: var(--space-3); font-size: var(--fs-sm); color: var(--ink-2); display: flex; gap: var(--space-3); flex-wrap: wrap; }
.near b { color: var(--a); }
.adm { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.go.left { justify-content: flex-start; }
.ln { margin: 0 0 var(--space-3); font: var(--fs-fine)/1.6 var(--mono); color: var(--ink-2); }
.gate { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: var(--z-sheet); padding: var(--space-4); }
.box { width: min(420px, 100%); display: grid; gap: var(--space-3); background: var(--bg-1); }
.box h3 { margin: 0; }
.box p { margin: 0; color: var(--ink-2); line-height: 1.7; }
@media (max-width: 1100px) { .sub { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) { .sub { padding: var(--space-3); gap: var(--space-3); } .empty { margin: var(--space-3); } }
</style>
