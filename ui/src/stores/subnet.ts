import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { BLUEWHALE, nodeKindOf, type NodeKind } from '../data/subnet'
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
  function stepTo(p: Point) {
    pos.value = p
    steps.value++
    if (steps.value % 3 === 0) ram.value = Math.min(ramMax, ram.value + 1)
    reveal()
  }
  function isExplored(p: Point) { return explored[floorIdx.value].has(key(p)) }
  function reset() {
    floorIdx.value = 0; unlocked.value = 1; pos.value = { x: 0, y: 0 }; posByFloor.splice(0, 2, { x: 0, y: 0 }, { x: 5, y: 0 })
    explored.forEach(s => s.clear()); trace.value = 34; load.value = 14; ram.value = 4; done.clear(); steps.value = 0; actionsLeft.value = 1; loot.value = []
    reveal()
  }
  reveal()
  return { floors, floorIdx, unlocked, pos, explored, trace, load, loadMax, ram, ramMax, sync, done, steps, actionsLeft, loot, floor, w, h, walkable, grid, visible, nodeAt, here, located, reveal, setFloor, addTrace, stepTo, isExplored, reset }
})
