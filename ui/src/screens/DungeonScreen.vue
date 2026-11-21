
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type FogState, type MapToken } from '../components/GridMap.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import TrackBar from '../components/TrackBar.vue'
import Icon from '../components/Icon.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { TRASH_CHUTE, FEATURE_OF, FEATURE_INFO } from '../data/dungeon'
import { parseRows, visibleFrom, key } from '../lib/grid'
import { refreshFloor } from '../lib/dungeon'
import { useWalk } from '../lib/useWalk'
import type { Point } from '../data/types'
import HereOptions from '../components/HereOptions.vue'
import { pressE, type HereOption } from '../lib/here'

/**
 * 地下城（SITES 第 11 節）：蜂巢的垃圾滑道。和家園、子網同一個 GridMap；黑暗：沒有光時只看得到身邊一格，開頭燈三格。
 */
const g = useGame()
const ui = useUi()
const router = useRouter()
// 離開後重新擺放遭遇與藏貨（版面不變）：第一次下來照原本的擺法，之後每一次換一個種子
const floors = TRASH_CHUTE.floors.map((f, i) => { const r = g.dungeonSeed > 1 ? refreshFloor(f, g.dungeonSeed * 10 + i) : f; return { ...f, rows: r.rows, names: r.names, cells: parseRows(r.rows) } })
const fi = ref(0)
const reached = ref(1)
const starts: Point[] = [{ x: 5, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 }]
const pos = ref<Point>({ ...starts[0] })
const seen = reactive(floors.map(() => new Set<string>()))
const done = reactive(new Set<string>())
const hasLamp = computed(() => g.inventory.some(s => s.def === 'it_5e3de4'))
const lampOn = ref(true)
const radius = computed(() => (hasLamp.value && lampOn.value ? 3 : 1))
const log = ref<string[]>(['你從四號塔七樓的投口滑下來，落在一堆軟爛的紙箱上。'])
const note = (t: string) => { log.value.unshift(t); if (log.value.length > 8) log.value.pop() }
const floor = computed(() => floors[fi.value])
const W = 11, H = 9
const walkable = (x: number, y: number) => { const c = floor.value.cells[y]?.[x]; return c !== undefined && c !== '#' }
const grid = computed(() => ({ w: W, h: H, passable: walkable }))
const visible = computed(() => visibleFrom(grid.value, pos.value, radius.value))
function reveal() { for (const k of visible.value) seen[fi.value].add(k) }
reveal()
const fog = (x: number, y: number): FogState => (visible.value.has(key({ x, y })) ? 'visible' : seen[fi.value].has(key({ x, y })) ? 'seen' : 'hidden')
const featAt = (p: Point) => { const ch = floor.value.cells[p.y]?.[p.x]; const f = ch ? FEATURE_OF[ch] : undefined; return f ? { f, k: `${fi.value}:${p.x},${p.y}`, name: floor.value.names[`${p.x},${p.y}`] ?? FEATURE_INFO[f].name } : null }
function cellView(x: number, y: number): CellView {
  if (!walkable(x, y)) return { kind: 'wall' }
  const ft = featAt({ x, y })
  if (!ft) return { kind: 'floor' }
  const cleared = done.has(ft.k)
  return { kind: ft.f === 'trap' ? 'trap' : 'node', icon: FEATURE_INFO[ft.f].icon, title: ft.name, mark: cleared ? '✓' : undefined, tint: ft.f === 'enemy' && !cleared ? 'var(--hp)' : undefined }
}
const tokens = computed<MapToken[]>(() => [{ id: 'me', x: pos.value.x, y: pos.value.y, label: '你', kind: 'me' }])
const { path, walkTo } = useWalk({
  grid: () => ({ w: W, h: H, passable: (x, y) => walkable(x, y) && fog(x, y) !== 'hidden' }),
  pos: () => pos.value,
  step: p => { pos.value = p; reveal(); g.advance(1); enter(p) },
  ms: 150,
})
function onCell(p: Point) {
  if (!walkable(p.x, p.y)) return
  if (fog(p.x, p.y) === 'hidden') { ui.toast('那裡黑得什麼都看不到。', 'warn'); return }
  if (!walkTo(p)) ui.toast('走不到那裡。', 'warn')
}
/** 鍵盤：方向鍵或 WASD 走一格；E 做這一格的預設選項（App.vue 的全域快捷鍵）。 */
function onStep(d: Point) {
  const n = { x: pos.value.x + d.x, y: pos.value.y + d.y }
  if (!walkable(n.x, n.y)) return
  path.value = []
  pos.value = n; reveal(); g.advance(1); enter(n)
}
/** 到了就看得到選單、按 E 才做（UI.md 1.1 節，第四版）：「這裡」列出這一格能做的事；樓梯與投口是換地圖的出口，E 換地圖。 */
function onEnter() { const msg = pressE(hereOpts.value); if (msg) ui.toast(here.value ? msg : '這裡沒有可以做的事。', 'warn') }
const hereOpts = computed<HereOption[]>(() => {
  const ft = here.value
  if (!ft) return []
  const dn = done.has(ft.k)
  switch (ft.f) {
    case 'loot': return [{ id: 'loot', name: '翻找', reason: dn ? '已經翻過了。' : null, run: loot }]
    case 'enemy': return [{ id: 'fight', name: '開戰（現實戰鬥）', reason: dn ? '已經處理過了。' : null, run: fight }]
    case 'down': return [{ id: 'down', name: '往下', exit: true, run: () => changeFloor(1) }]
    case 'up': return fi.value > 0 ? [{ id: 'up', name: '往上', exit: true, run: () => changeFloor(-1) }] : []
    case 'rest': return [{ id: 'rest', name: '短休', sub: '30 分鐘', run: () => { g.advance(30); note('你在這裡短休了半小時。') } }]
    case 'start': return [{ id: 'leave', name: '爬回四號塔', exit: true, run: leave }]
    default: return []
  }
})
function enter(p: Point) {
  const ft = featAt(p)
  if (!ft || done.has(ft.k) || ft.f !== 'trap') return
  const dc = 13 + (radius.value < 3 ? 3 : 0)
  const die = 1 + Math.floor(Math.random() * 20)
  done.add(ft.k)
  if (die + 3 >= dc) note(`察覺 1d20(${die}) + 3 對 DC ${dc}：你看到了${ft.name}，繞過去。`)
  else { g.character.hp[0] = Math.max(1, g.character.hp[0] - 4); note(`察覺 1d20(${die}) + 3 對 DC ${dc}：失敗，${ft.name}讓你生命 −4。`) }
}
const here = computed(() => featAt(pos.value))
function loot() {
  const ft = here.value!
  const got = ft.name.includes('晶片') ? 'it_7f887b' : ft.name.includes('工具') ? 'it_2c5068' : 'it_b86505'
  g.addItem(got, 1, '二手')
  done.add(ft.k)
  note(`你從${ft.name}裡翻出一件${g.itemName(got)}，放進背包。`)
}
function changeFloor(d: number) {
  fi.value += d
  reached.value = Math.max(reached.value, fi.value + 1)
  const target = d > 0 ? starts[fi.value] : (() => { const r = floor.value.rows.findIndex(row => row.includes('D')); return { x: floor.value.rows[r].indexOf('D'), y: r } })()
  pos.value = { ...target }
  path.value = []
  reveal()
  note(d > 0 ? `你沿著滑道往下，到了${floor.value.name}。` : `你爬回${floor.value.name}。`)
}
function fight() { done.add(here.value!.k); g.takeSnapshot('戰鬥', `戰鬥開打前・${here.value!.name}`); note(`你和${here.value!.name}打了起來。`); router.push({ path: '/combat', query: { enc: 'chute', from: '/dungeon' } }) }
function leave() {
  g.dungeonSeed++
  g.addLog({ prose: ['你從垃圾滑道爬回四號塔，身上全是灰。下次下來，遭遇與藏貨會換地方。'] })
  router.push('/')
}
const floorTabs = computed(() => floors.map((f, i) => ({ id: String(i), label: f.name, disabled: i >= reached.value })))
const floorModel = computed({ get: () => String(fi.value), set: v => { const n = Number(v); if (n !== fi.value) { fi.value = n; pos.value = { ...starts[n] }; reveal() } } })
</script>

<template>
  <div class="screen">
    <StatusBar back title="地下城：垃圾滑道" />
    <div class="dg">
      <section class="panel cut pad">
        <div class="mh">
          <Tabs v-model="floorModel" :tabs="floorTabs" @blocked="ui.toast('還沒走到這一層。', 'warn')" />
          <span class="k">第 {{ g.dungeonSeed }} 次下來</span>
          <Hint title="垃圾滑道">蜂巢的地下城式區域：3 層、黑、離開後重新擺放遭遇與藏貨（版面不變）。方向鍵或 WASD 走一格（手機上用地圖下面的方向鈕）；走到東西上，「這裡」列出能做的事，不會自動做；黃框、帶 E 的是預設，按 E 做它（樓梯與投口是換地圖）。每層 11 × 9，往下要找到通道。點看得到或看過的格子走過去。</Hint>
        </div>
        <GridMap :w="W" :h="H" :cell="cellView" :fog="fog" :tokens="tokens" :path="path" :max-cell="64" :label="`${floor.name}的地圖`" @cell="onCell" @step="onStep" @enter="onEnter" />
        <div class="legend"><span v-for="(info, k) in FEATURE_INFO" :key="k"><Icon :id="info.icon" :size="14" fit />{{ info.name }}<Hint :text="info.hint" /></span></div>
      </section>
      <aside class="side">
        <section class="panel cut pad">
          <p class="h">光線<Hint title="光線">黑暗又沒有光時，視野只剩身邊一格、命中 −2、察覺陷阱 DC +3。開頭燈看得到三格。</Hint></p>
          <div class="seg">
            <button type="button" :class="{ on: lampOn && hasLamp }" :aria-disabled="!hasLamp || undefined" @click="hasLamp ? (lampOn = true, reveal()) : ui.toast('背包裡沒有頭燈。', 'warn')">開頭燈</button>
            <button type="button" :class="{ on: !lampOn || !hasLamp }" @click="lampOn = false">關燈</button>
          </div>
          <div class="kv"><span>視野</span><b>{{ radius }} 格</b></div>
          <TrackBar label="生命" :value="g.character.hp[0]" :max="g.character.hp[1]" color="var(--hp)" />
        </section>
        <section class="panel cut pad">
          <p class="h">這裡<template v-if="here">：{{ FEATURE_INFO[here.f].name }}</template></p>
          <template v-if="here">
            <div class="nodeh"><Icon :id="FEATURE_INFO[here.f].icon" :size="26" fit /><b>{{ here.name }}</b><span v-if="done.has(here.k)" class="tag">處理過了</span></div>
            <HereOptions class="here-acts" :options="hereOpts" />
          </template>
          <div v-else class="empty-note">四周只有濕掉的紙箱與水聲。</div>
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
.dg { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; padding: 12px; align-items: start; }
.mh { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; font-size: var(--fs-fine); color: var(--ink-2); font-weight: 700; }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.side { display: grid; gap: 12px; min-width: 0; }
.seg { display: inline-flex; gap: 4px; margin-bottom: 6px; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 12px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; }
.seg button.on { background: var(--a); color: #fff; }
.nodeh { display: flex; align-items: center; gap: 8px; }
.go.left { justify-content: flex-start; }
.ln { margin: 0 0 6px; font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
@media (max-width: 1000px) { .dg { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .dg { padding: 8px; } }
</style>
