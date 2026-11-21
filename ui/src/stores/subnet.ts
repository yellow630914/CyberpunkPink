import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { BLUEWHALE, PATROLS, nodeKindOf, type NodeKind } from '../data/subnet'
import { parseRows, visibleFrom, key } from '../lib/grid'
import type { Point } from '../data/types'

/**
 * 子網的狀態（CYBERSPACE 第 8 節、NETRUNNING 第 5 節）：一座子網一條追蹤度，往下一層不歸零；
 * 探索中追蹤度不會自己漲，漲的是警報節點、下載、管理行動、戰鬥。迷霧：看過的格子留著，視野 2 格。
 */
export const TRACE_MARKS = [
  { at: 30, name: '起疑', effect: '剩下的每一層巡邏 +1，閘門 DC +2' },
  { at: 60, name: '確認入侵', effect: '現實的保全進入警戒' },
  { at: 90, name: '定位', effect: '強制斷線，現實的增援出發' },
]

export const useSubnet = defineStore('subnet', () => {
  const floors = BLUEWHALE.floors.map(f => ({ ...f, cells: parseRows(f.rows) }))
  const floorIdx = ref(0)
  const unlocked = ref(1)
  const pos = ref<Point>({ x: 0, y: 0 })
  const posByFloor: Point[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }]
  const explored = reactive<Array<Set<string>>>(floors.map(() => new Set<string>()))
  const trace = ref(34)
  const load = ref(14)
  const loadMax = 38
  const ram = ref(4)
  const ramMax = 6
  const sync = ref<'淺' | '標準' | '深' | '全'>('標準')
  const done = reactive(new Set<string>())
  const steps = ref(0)
  const actionsLeft = ref(1)
  const loot = ref<string[]>([])
  /** 巡邏：在路線上的第幾格、往哪個方向、被斷路卡住幾步、被打倒或甩掉了沒 */
  const patrols = reactive(PATROLS.map(p => ({ id: p.id, i: 0, dir: 1, frozen: 0, gone: false })))
  /** 正在遭遇的巡邏 */
  const meeting = ref<string | null>(null)

  const floor = computed(() => floors[floorIdx.value])
  const w = 11, h = 9
  const walkable = (x: number, y: number) => { const c = floor.value.cells[y]?.[x]; return c !== undefined && c !== '#' }
  const grid = computed(() => ({ w, h, passable: walkable }))
  const visible = computed(() => visibleFrom(grid.value, pos.value, 2))
  const nodeAt = (p: Point): { kind: NodeKind; name: string; key: string } | null => {
    const ch = floor.value.cells[p.y]?.[p.x]
    const kind = ch ? nodeKindOf(ch) : null
    if (!kind) return null
    const k = `${floor.value.id}:${p.x},${p.y}`
    return { kind, name: floor.value.names[`${p.x},${p.y}`] ?? kind, key: k }
  }
  const here = computed(() => nodeAt(pos.value))
  const located = computed(() => trace.value >= 90)

  function reveal() { for (const k of visible.value) explored[floorIdx.value].add(k) }
  function setFloor(i: number) {
    posByFloor[floorIdx.value] = pos.value
    floorIdx.value = i
    pos.value = posByFloor[i]
    reveal()
  }
  function addTrace(n: number) { trace.value = Math.max(0, Math.min(100, trace.value + n)) }
  function patrolPos(id: string): Point | null {
    const d = PATROLS.find(x => x.id === id)!, st = patrols.find(x => x.id === id)!
    const [x, y] = d.route[st.i]
    return { x, y }
  }
  /** 這一層現在在動的巡邏（起疑之後多一隊） */
  const activePatrols = computed(() => PATROLS.filter(d => d.floor === floorIdx.value && (!d.extra || trace.value >= 30)).filter(d => !patrols.find(x => x.id === d.id)!.gone))
  /** 你走一步，巡邏走一步（來回）；被斷路卡住的不動 */
  function movePatrols() {
    for (const d of activePatrols.value) {
      const st = patrols.find(x => x.id === d.id)!
      if (st.frozen > 0) { st.frozen--; continue }
      if (d.route.length < 2) continue
      if (st.i + st.dir < 0 || st.i + st.dir >= d.route.length) st.dir = -st.dir
      st.i += st.dir
    }
  }
  /** 在你旁邊（上下左右一格，或同一格）而且沒被卡住的巡邏 */
  function patrolNear(p: Point = pos.value) {
    return activePatrols.value.find(d => { const q = patrolPos(d.id)!; return Math.abs(q.x - p.x) + Math.abs(q.y - p.y) <= 1 && patrols.find(x => x.id === d.id)!.frozen === 0 }) ?? null
  }
  function stepTo(p: Point) {
    pos.value = p
    steps.value++
    if (steps.value % 3 === 0) ram.value = Math.min(ramMax, ram.value + 1)
    reveal()
    movePatrols()
    if (!meeting.value) meeting.value = patrolNear()?.id ?? null
  }
  function isExplored(p: Point) { return explored[floorIdx.value].has(key(p)) }
  function reset() {
    floorIdx.value = 0; unlocked.value = 1; pos.value = { x: 0, y: 0 }; posByFloor.splice(0, 2, { x: 0, y: 0 }, { x: 5, y: 0 })
    explored.forEach(s => s.clear()); trace.value = 34; load.value = 14; ram.value = 4; done.clear(); steps.value = 0; actionsLeft.value = 1; loot.value = []
    patrols.forEach(p => Object.assign(p, { i: 0, dir: 1, frozen: 0, gone: false })); meeting.value = null
    reveal()
  }
  // ---- 存檔（第 3 版起子網跟著存檔與快照走） ----
  function serialize() {
    return JSON.parse(JSON.stringify({ floorIdx: floorIdx.value, unlocked: unlocked.value, pos: pos.value, posByFloor, explored: explored.map(x => [...x]), trace: trace.value, load: load.value, ram: ram.value, sync: sync.value, done: [...done], steps: steps.value, loot: loot.value, patrols, meeting: meeting.value }))
  }
  function hydrate(d: Record<string, unknown> | null | undefined) {
    if (!d || typeof d !== 'object') return
    const v = d as ReturnType<typeof serialize>
    if (typeof v.floorIdx === 'number') floorIdx.value = v.floorIdx
    if (typeof v.unlocked === 'number') unlocked.value = v.unlocked
    if (v.pos) pos.value = { ...v.pos }
    if (Array.isArray(v.posByFloor)) posByFloor.splice(0, posByFloor.length, ...v.posByFloor)
    if (Array.isArray(v.explored)) v.explored.forEach((list: string[], i: number) => { if (explored[i]) { explored[i].clear(); list.forEach(k => explored[i].add(k)) } })
    for (const k of ['trace', 'load', 'ram', 'steps'] as const) if (typeof v[k] === 'number') ({ trace, load, ram, steps })[k].value = v[k]
    if (v.sync) sync.value = v.sync
    if (Array.isArray(v.done)) { done.clear(); v.done.forEach((k: string) => done.add(k)) }
    if (Array.isArray(v.loot)) loot.value = [...v.loot]
    if (Array.isArray(v.patrols)) v.patrols.forEach((p: { id: string }) => { const t = patrols.find(x => x.id === p.id); if (t) Object.assign(t, p) })
    meeting.value = typeof v.meeting === 'string' ? v.meeting : null
  }
  reveal()
  return { floors, floorIdx, unlocked, pos, explored, trace, load, loadMax, ram, ramMax, sync, done, steps, actionsLeft, loot, floor, w, h, walkable, grid, visible, nodeAt, here, located, reveal, setFloor, addTrace, stepTo, isExplored, reset, patrols, meeting, activePatrols, patrolPos, patrolNear, movePatrols, serialize, hydrate }
})
