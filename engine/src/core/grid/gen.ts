// L5 地圖：生成器（M3-core-mapgen；dev/adr/0018 第五節與末尾的實作補記；CODESCAN 2.2 節：把 ElondiaRPG 的 grid.ts 拆成四塊，這是第二塊）。
// 一個純函式：照一份 spec 與一串亂數挖出一張圖、放好節點，回傳版面（SheetDef）、節點的圖、沒畫在版面上的東西與一條保證走得通的路。
// 不認得任何一區：要挖幾步、放哪些種類各幾個、各放在哪，都是 spec 給的；每一區的 spec 怎麼組是用它的功能的事（netrun 讀規則表）。
// 不讀內容、不讀遊戲狀態、不用遊戲的亂數游標：亂數只來自傳進來的 rand（要可重現就用 seedRand 導出）。
//
// 挖法（M3-core-mapgen 回報）：醉漢走路加修整。從一邊的入口往外挖，步數在 carve 裡抽；走的時候偏向往對面走、偶爾跳回挖過的格子另起一條支路，
// 不挖出 2×2 的空地（路永遠是一格寬）；挖完再打通幾處讓路成環（loops）。挖出來的格子照「路口、死路的盡頭、入口」切成節點，節點之間的走道是鏈路；
// 節點不夠放 spec 要的東西時，把最長的走道從中間切開加一個節點（房間）。選這個做法的理由：步數直接對到設計書的 carve_steps，
// 節點的多寡自然跟著步數走，單向與會斷的鏈路有環可以放，而且全部是整數運算，一張 11 × 9 的圖幾毫秒。
//
// 圖的慣例（用的人要知道）：
// - 節點是版面上的一格：入口、有標記的節點、沒標記的路口與死路（kind 是 'floor'）。鏈路 edges[].cells 是兩個節點之間的格子（不含兩端的節點），從 a 排到 b；
//   兩個節點緊貼著時 cells 是空的。放在鏈路上的標記（where: 'link'）與單向、會斷的那一格都在 cells 裡。
// - depth 是從入口走到那一格的步數（格數），不看單向（單向的鏈路當成雙向算）、遭遇與機關那種走不上去的格子當成走得過去；要看方向的最短路用 Sheet.findPath 加 valveAllows。
// - 沒有標記的節點 id 是 n1、n2……（照「由上到下、由左到右」數）。藏起來的東西（hidden）不畫在版面上，位置在 result.hidden；它佔的節點在圖上是沒標記的。
// - 單向的鏈路：那一段的中間有一格 net_valve，edges[].oneway 是 'ab'（只能從 a 走向 b）或 'ba'；從 cells 裡前一格（第一格就是節點 a 那一格）走進去的才算正向。
//   會斷的鏈路：中間一格 net_bridge，edges[].fragile 是 true。
// - 保證：每個節點從入口走得到、而且在「單向照方向、會斷的全斷掉」的最壞情況也走得到；從每個節點都走得到出口（單向只會把人往出口的方向推，不會把人鎖在死路裡）。

import type { CellKind, MarkerDef, SheetDef } from '../types'
import { Rng, hash32 } from '../util/rng'
import { CELL_TRAITS, DEFAULT_LEGEND, NET_LEGEND, Sheet, markersInLayout, sheetProblems } from './model'

// ---- 型別 ----

/** 放在哪裡：far_half 離入口最遠的那一半節點；dead_end 死路的盡頭（不夠時退到 far_half）；mid_path 保證的那條路上、一半左右的節點；link 鏈路上的格子；any 任何空的節點。 */
export type GenWhere = 'far_half' | 'dead_end' | 'mid_path' | 'link' | 'any'

export interface GenPlace {
  /** 放哪一種格子（要在 CELL_TRAITS 裡，而且有圖例的字元） */
  kind: CellKind
  /** 最少、最多 */
  count: [number, number]
  where: GenWhere
  /** 標記的名字；好幾個時後面加編號（「遭遇 1」「遭遇 2」，照由上到下、由左到右）；沒寫用 kind */
  name?: string
  /** 陷阱：不能佔住入口到出口那條保證的路。同一種格子不能一部分寫 trap、一部分不寫 */
  trap?: boolean
  /** 不畫在版面上（那一格是地板），位置回在 result.hidden */
  hidden?: boolean
  /** 和入口至少隔幾個節點（節點圖上的步數至少 apart + 1；1 就是不能緊貼著入口） */
  apart?: number
}

export interface GenSpec {
  id: string
  name: string
  /** [寬, 高]，含四周的邊框（邊框一律是牆） */
  size: [number, number]
  /** 挖幾步（決定節點的多寡） */
  carve: [number, number]
  /** 入口的名字；沒寫是「入口」 */
  entry?: { name: string }
  /** 放在照鏈路算離入口最遠的節點 */
  exit?: { kind: CellKind; name: string }
  /** 照順序放；先寫的先挑位置 */
  places: GenPlace[]
  /** 鏈路裡單向的、走過就斷的比例（0～1）；放得下幾個還看圖：每一個都要通過「入口到得了每個節點、每個節點到得了出口」的檢查才留下 */
  oneway?: number
  fragile?: number
  /** 挖完之後最多再打通幾處讓路成環（預設 1；會斷的鏈路與單向的鏈路要有環才放得多） */
  loops?: number
  /** 視野的半徑，寫進 SheetDef.sight */
  sight?: number
}

export interface GenNode {
  /** 那一格的標記 id；沒有標記的節點是 n1、n2…… */
  id: string
  at: [number, number]
  /** 版面上那一格的種類：入口是 'entry'，沒標記的節點（含藏起來的東西佔的）是 'floor' */
  kind: string
  /** 從入口走到這裡的步數（格數） */
  depth: number
  /** 這個節點上有陷阱（畫出來的或藏起來的） */
  trap?: boolean
}

export interface GenEdge {
  a: string
  b: string
  /** 兩端節點之間的格子，從 a 排到 b（不含兩端） */
  cells: Array<[number, number]>
  oneway?: 'ab' | 'ba'
  fragile?: boolean
}

export interface GenResult {
  sheet: SheetDef
  graph: { nodes: GenNode[]; edges: GenEdge[] }
  /** 沒畫在版面上的東西（版面上那一格是地板） */
  hidden: Array<{ kind: string; at: [number, number]; trap?: boolean }>
  /** 入口到出口、不經過任何陷阱的一條路（含兩端；沒有 exit 時走到離入口最遠的節點）。單向的鏈路照方向走得通 */
  safe_path: Array<[number, number]>
}

export type GenRand = () => number

/** 挖不成時最多重挖幾次（第一次加上重挖 20 次）。 */
export const GEN_MAX_RECARVE = 20

/** 從種子與用途導出一串亂數（和 deriveRng 同一個雜湊）：同一個種子、同一個用途，永遠是同一串。 */
export function seedRand(seed: number, purpose: string): GenRand {
  const rng = new Rng(hash32(seed, purpose))
  return () => rng.next()
}

// ---- spec 的檢查 ----

/** 沒有圖例字元、不能當成節點放的種類 */
const NOT_PLACEABLE: readonly string[] = ['entry', 'floor', 'wall', 'net_valve', 'net_bridge']

const CHARS: Record<string, CellKind> = { ...DEFAULT_LEGEND, ...NET_LEGEND }

/** 一種格子在版面上用哪個字元（先找網內的圖例；遭遇點 '1'～'9' 不算）。 */
function charOf(kind: CellKind): string | undefined {
  for (const [ch, k] of Object.entries(NET_LEGEND)) if (k === kind) return ch
  for (const [ch, k] of Object.entries(DEFAULT_LEGEND)) if (k === kind && CHARS[ch] === kind && !/\d/.test(ch)) return ch
  return undefined
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)
const isRange = (r: unknown, lo: number, hi: number): boolean => Array.isArray(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]) && r[0] >= lo && r[1] >= r[0] && r[1] <= hi

function placeableProblem(kind: unknown): string | null {
  if (typeof kind !== 'string' || !kind) return '要有 kind'
  const t = CELL_TRAITS[kind]
  if (!t) return `${kind} 不在 CELL_TRAITS 裡`
  if (NOT_PLACEABLE.includes(kind) || !(t.walk || t.locked)) return `${kind} 不能當成節點放（要走得上去或是要條件才過得去的格子）`
  if (!charOf(kind)) return `${kind} 沒有圖例的字元`
  return null
}

/** spec 本身合不合格（丟錯之前的檢查，給呼叫的人先問）。回傳問題的清單。 */
export function genSpecProblems(spec: GenSpec): string[] {
  const p: string[] = []
  if (!spec || typeof spec.id !== 'string' || !spec.id) return ['spec 要有 id']
  if (typeof spec.name !== 'string' || !spec.name.trim()) p.push('spec 要有 name')
  if (!Array.isArray(spec.size) || !isInt(spec.size[0]) || !isInt(spec.size[1]) || spec.size[0] < 5 || spec.size[1] < 5 || spec.size[0] > 41 || spec.size[1] > 41) p.push('size 要是 [寬, 高]，各 5～41 的整數')
  if (!isRange(spec.carve, 1, 500)) p.push('carve 要是 [最少, 最多]，1～500 的整數')
  if (spec.entry !== undefined && (typeof spec.entry?.name !== 'string' || !spec.entry.name.trim())) p.push('entry.name 要有字')
  if (spec.exit !== undefined) {
    const e = placeableProblem(spec.exit?.kind)
    if (e) p.push(`exit：${e}`)
    if (typeof spec.exit?.name !== 'string' || !spec.exit.name.trim()) p.push('exit.name 要有字')
  }
  for (const key of ['oneway', 'fragile'] as const) {
    const v = spec[key]
    if (v !== undefined && !(typeof v === 'number' && v >= 0 && v <= 1)) p.push(`${key} 要是 0～1 的數字`)
  }
  if (spec.loops !== undefined && !(isInt(spec.loops) && spec.loops >= 0 && spec.loops <= 6)) p.push('loops 要是 0～6 的整數')
  if (spec.sight !== undefined && !(isInt(spec.sight) && spec.sight >= 1 && spec.sight <= 9)) p.push('sight 要是 1～9 的整數')
  if (!Array.isArray(spec.places)) return [...p, 'places 要是陣列']
  const trapOf = new Map<string, boolean>()
  spec.places.forEach((pl, i) => {
    const at = `places[${i}]`
    const e = placeableProblem(pl?.kind)
    if (e) p.push(`${at}：${e}`)
    if (!isRange(pl?.count, 0, 99)) p.push(`${at}：count 要是 [最少, 最多]，0～99 的整數`)
    if (!['far_half', 'dead_end', 'mid_path', 'link', 'any'].includes(pl?.where)) p.push(`${at}：where 不認得（${String(pl?.where)}）`)
    if (pl?.name !== undefined && (typeof pl.name !== 'string' || !pl.name.trim())) p.push(`${at}：name 要有字`)
    if (pl?.apart !== undefined && !(isInt(pl.apart) && pl.apart >= 0)) p.push(`${at}：apart 要是 0 以上的整數`)
    if (pl?.trap && pl.where === 'mid_path') p.push(`${at}：陷阱不能放在保證的路上（trap 與 mid_path 衝突）`)
    if (typeof pl?.kind === 'string') {
      if (trapOf.has(pl.kind) && trapOf.get(pl.kind) !== !!pl.trap) p.push(`${at}：${pl.kind} 一部分寫 trap、一部分不寫（同一種格子要一致）`)
      trapOf.set(pl.kind, !!pl.trap)
    }
  })
  if (spec.exit && trapOf.get(spec.exit.kind)) p.push(`exit：${spec.exit.kind} 同時是陷阱的種類`)
  return p
}

/** spec 裡寫了 trap 的種類 */
const trapKindsOf = (spec: GenSpec): Set<string> => new Set(spec.places.filter((pl) => pl.trap).map((pl) => pl.kind))

// ---- 小工具 ----

type Pt = [number, number]
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const between = (rand: GenRand, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1))

function shuffle<T>(items: readonly T[], rand: GenRand): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function pickWeighted(weights: number[], rand: GenRand): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!
    if (r < 0) return i
  }
  return weights.length - 1
}

// ---- 挖結構 ----

interface Carved {
  open: Uint8Array
  entry: number
}

/** 打通之後會不會出現 2×2 的空地（路要一直是一格寬） */
function makesBlock(open: Uint8Array, w: number, x: number, y: number): boolean {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) if (open[y * w + x + sx] && open[(y + sy) * w + x] && open[(y + sy) * w + x + sx]) return true
  return false
}

function neighborsOf(open: Uint8Array, w: number, h: number, i: number): number[] {
  const x = i % w, y = (i - x) / w
  const out: number[] = []
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && open[ny * w + nx]) out.push(ny * w + nx)
  }
  return out
}

/** 從 from 走到每一格的步數（走不到是 -1）。 */
function distFrom(open: Uint8Array, w: number, h: number, from: number): Int32Array {
  const dist = new Int32Array(w * h).fill(-1)
  dist[from] = 0
  const queue = [from]
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!
    for (const n of neighborsOf(open, w, h, cur)) if (dist[n]! < 0) {
      dist[n] = dist[cur]! + 1
      queue.push(n)
    }
  }
  return dist
}

/** 醉漢走路：從一邊的入口往外挖；偏向往對面走、偶爾跳回挖過的格子另起一條支路。 */
function carve(spec: GenSpec, rand: GenRand): Carved {
  const [w, h] = spec.size
  const open = new Uint8Array(w * h)
  const side = Math.floor(rand() * 4)
  const lane = (n: number): number => 1 + Math.floor(rand() * (n - 2))
  // 入口在邊框裡面的第一格；inward 是往內的方向
  const [ex, ey, inward] = side === 0 ? [1, lane(h), 0] : side === 1 ? [w - 2, lane(h), 1] : side === 2 ? [lane(w), 1, 2] : [lane(w), h - 2, 3]
  const entry = ey * w + ex
  open[entry] = 1
  const cells = [entry]
  let cur = entry
  const steps = between(rand, spec.carve[0], spec.carve[1])
  const step = (): boolean => {
    const x = cur % w, y = (cur - x) / w
    const cand: number[] = []
    const weights: number[] = []
    DIRS.forEach(([dx, dy], d) => {
      const nx = x + dx, ny = y + dy
      if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) return
      const n = ny * w + nx
      const isOpen = open[n] === 1
      if (!isOpen && makesBlock(open, w, nx, ny)) return
      // 偏向往內：往內 3、橫向 2、往回 0.7；走回已經挖過的格子很少（0.3）
      const toward = d === (inward ^ 1) ? 0.7 : d === inward ? 3 : 2
      cand.push(n)
      weights.push(toward * (isOpen ? 0.3 : 1))
    })
    if (!cand.length) return false
    const n = cand[pickWeighted(weights, rand)]!
    if (!open[n]) {
      open[n] = 1
      cells.push(n)
    }
    cur = n
    return true
  }
  for (let s = 0; s < steps; s++) {
    if (rand() < 0.12) cur = cells[Math.floor(rand() * cells.length)]!
    if (!step()) {
      cur = cells[Math.floor(rand() * cells.length)]!
      step()
    }
  }
  // 打通幾處讓路成環：兩邊是路、另外兩邊是牆、繞過去至少 6 步的牆（兩邊的另外兩格是牆，所以不會挖出 2×2 的空地）
  let loops = spec.loops ?? 1
  if (loops > 0) {
    const shape = (i: number): [number, number] | null => {
      if (open[i]) return null
      if (open[i - 1] && open[i + 1] && !open[i - w] && !open[i + w]) return [i - 1, i + 1]
      if (open[i - w] && open[i + w] && !open[i - 1] && !open[i + 1]) return [i - w, i + w]
      return null
    }
    const walls: number[] = []
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (shape(y * w + x)) walls.push(y * w + x)
    for (const i of shuffle(walls, rand)) {
      if (loops <= 0) break
      const ab = shape(i)
      if (!ab || distFrom(open, w, h, ab[0])[ab[1]]! < 6) continue
      open[i] = 1
      loops--
    }
  }
  return { open, entry }
}

// ---- 節點與鏈路 ----

interface Chain {
  /** 兩端節點的格子 */
  a: number
  b: number
  /** 中間的格子，從 a 排到 b */
  cells: number[]
  kind?: 'valve' | 'bridge'
  dir?: 'ab' | 'ba'
  /** 單向或會斷的那一格 */
  at?: number
}

interface Struct {
  isNode: Uint8Array
  chains: Chain[]
}

/** 路口（三條路以上）、死路的盡頭與入口是節點；節點之間的走道是鏈路。 */
function analyze(open: Uint8Array, w: number, h: number, entry: number): Struct {
  const n = w * h
  const isNode = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (open[i] && (i === entry || neighborsOf(open, w, h, i).length !== 2)) isNode[i] = 1
  const chains: Chain[] = []
  const seen = new Set<number>()
  for (let a = 0; a < n; a++) {
    if (!isNode[a]) continue
    for (const m of neighborsOf(open, w, h, a)) {
      if (seen.has(a * n + m)) continue
      const cells: number[] = []
      let prev = a, cur = m
      while (!isNode[cur]) {
        cells.push(cur)
        const next = neighborsOf(open, w, h, cur).find((c) => c !== prev)!
        prev = cur
        cur = next
      }
      chains.push({ a, b: cur, cells })
      seen.add(a * n + m)
      seen.add(cur * n + (cells.length ? cells[cells.length - 1]! : a))
    }
  }
  return { isNode, chains }
}

const nodeCount = (st: Struct): number => st.isNode.reduce((a, b) => a + b, 0)
const nodeList = (st: Struct): number[] => {
  const out: number[] = []
  st.isNode.forEach((v, i) => { if (v) out.push(i) })
  return out
}

/** 把一段鏈路從第 k 格切開，那一格變成節點（房間）。 */
function promote(st: Struct, ci: number, k: number): void {
  const c = st.chains[ci]!
  const mid = c.cells[k]!
  st.isNode[mid] = 1
  st.chains.splice(ci, 1, { a: c.a, b: mid, cells: c.cells.slice(0, k) }, { a: mid, b: c.b, cells: c.cells.slice(k + 1) })
}

/** 兩端是同一個節點的鏈路（繞一圈回來）先從中間切開，圖才不會有自己連自己的邊。 */
function splitLoops(st: Struct): void {
  for (let i = 0; i < st.chains.length; i++) {
    const c = st.chains[i]!
    if (c.a === c.b && c.cells.length >= 3) {
      promote(st, i, Math.floor(c.cells.length / 2))
      i--
    }
  }
}

/** 節點不夠時，把最長的走道從中間切開（先切長度 3 以上的，切出來的兩段各至少一格；實在不夠才切長度 2 的）；回傳是否還有東西可切。 */
function promoteOne(st: Struct, rand: GenRand, only?: (c: Chain) => boolean): boolean {
  for (const minLen of [3, 2]) {
    let best = -1
    const ties: number[] = []
    st.chains.forEach((c, i) => {
      if (c.cells.length < minLen || (only && !only(c))) return
      if (c.cells.length > best) {
        best = c.cells.length
        ties.length = 0
      }
      if (c.cells.length === best) ties.push(i)
    })
    if (ties.length) {
      const ci = ties[Math.floor(rand() * ties.length)]!
      promote(st, ci, Math.floor(st.chains[ci]!.cells.length / 2))
      return true
    }
  }
  return false
}

/** 從 from 到 to 的最短路（格子的 index；含兩端）。 */
function shortestPath(open: Uint8Array, w: number, h: number, from: number, to: number): number[] {
  const prev = new Int32Array(w * h).fill(-1)
  const queue = [from]
  prev[from] = from
  for (let qi = 0; qi < queue.length && prev[to]! < 0; qi++) {
    const cur = queue[qi]!
    for (const n of neighborsOf(open, w, h, cur)) if (prev[n]! < 0) {
      prev[n] = cur
      queue.push(n)
    }
  }
  const path = [to]
  while (path[0] !== from) path.unshift(prev[path[0]!]!)
  return path
}

/** 這一段鏈路在不在那條路上：在的話，走的方向是 a 到 b（'ab'）還是反過來。 */
function dirOnPath(c: Chain, pathIdx: Map<number, number>): 'ab' | 'ba' | null {
  const seq = [c.a, ...c.cells, c.b]
  const first = pathIdx.get(seq[0]!)
  if (first === undefined) return null
  const second = pathIdx.get(seq[1]!)
  if (second === undefined || Math.abs(second - first) !== 1) return null
  const sign = second - first
  for (let i = 0; i < seq.length; i++) if (pathIdx.get(seq[i]!) !== first + sign * i) return null
  return sign > 0 ? 'ab' : 'ba'
}

// ---- 一次嘗試 ----

interface Occ {
  place: number
  hidden: boolean
}

const atOf = (i: number, w: number): Pt => [i % w, Math.floor(i / w)]

/** 入口走得到每個節點、每個節點走得到出口：單向照方向、會斷的全斷掉的最壞情況。 */
function reachOk(st: Struct, entry: number, goal: number): boolean {
  const nodes = nodeList(st)
  const fwd = new Map<number, number[]>(), back = new Map<number, number[]>()
  for (const n of nodes) { fwd.set(n, []); back.set(n, []) }
  for (const c of st.chains) {
    if (c.kind === 'bridge') continue
    if (c.dir !== 'ba') { fwd.get(c.a)!.push(c.b); back.get(c.b)!.push(c.a) }
    if (c.dir !== 'ab') { fwd.get(c.b)!.push(c.a); back.get(c.a)!.push(c.b) }
  }
  const reach = (from: number, adj: Map<number, number[]>): number => {
    const seen = new Set<number>([from])
    const queue = [from]
    for (let qi = 0; qi < queue.length; qi++) for (const n of adj.get(queue[qi]!)!) if (!seen.has(n)) { seen.add(n); queue.push(n) }
    return seen.size
  }
  return reach(entry, fwd) === nodes.length && reach(goal, back) === nodes.length
}

function attempt(spec: GenSpec, rand: GenRand): GenResult | { fail: string } {
  const [w, h] = spec.size
  const { open, entry } = carve(spec, rand)
  const st = analyze(open, w, h, entry)
  splitLoops(st)
  const places = spec.places
  // 節點不夠放就切開走道加節點：要放的節點的最大總數（加入口、出口、一個空的）
  const nodePlaces = places.filter((pl) => pl.where !== 'link')
  const needMax = 1 + (spec.exit ? 1 : 0) + nodePlaces.reduce((s, pl) => s + pl.count[1], 0) + 1
  // 離入口最遠的那一半才放得下 far_half 與 dead_end（死路不夠時退到那一半）：節點至少要有它們最少的數量（加出口）的兩倍
  const farMin = nodePlaces.filter((pl) => pl.where === 'far_half' || pl.where === 'dead_end').reduce((s, pl) => s + pl.count[0], 0)
  const needNodes = Math.max(needMax, 2 * (farMin + (spec.exit ? 1 : 0)))
  while (nodeCount(st) < needNodes && promoteOne(st, rand)) { /* 一個一個切 */ }
  const dist = distFrom(open, w, h, entry)
  // 出口：離入口最遠的節點（照鏈路算）；沒寫 exit 時也算出來，保證的路與單向的方向都以它為準
  const nodes0 = nodeList(st).filter((n) => n !== entry)
  const far = Math.max(...nodes0.map((n) => dist[n]!))
  const goals = nodes0.filter((n) => dist[n] === far)
  const goal = goals[Math.floor(rand() * goals.length)]!
  const path = shortestPath(open, w, h, entry, goal)
  const pathIdx = new Map(path.map((c, i) => [c, i]))
  // 保證的路上放得下 mid_path 的東西
  const midNeed = places.filter((pl) => pl.where === 'mid_path').reduce((s, pl) => s + pl.count[1], 0)
  const freeOnPath = (): number[] => nodeList(st).filter((n) => n !== entry && n !== goal && pathIdx.has(n))
  const midIdx = (path.length - 1) / 2
  if (midNeed > 0 && Math.min(...freeOnPath().map((n) => Math.abs(pathIdx.get(n)! - midIdx)), Infinity) > 1) {
    // 離一半最近的節點太遠：從正中間那一格切開加一個節點
    const midCell = path[Math.round(midIdx)]!
    const ci = st.chains.findIndex((c) => c.cells.includes(midCell))
    if (ci >= 0) promote(st, ci, st.chains[ci]!.cells.indexOf(midCell))
  }
  while (freeOnPath().length < midNeed && promoteOne(st, rand, (c) => dirOnPath(c, pathIdx) !== null)) { /* 一個一個切 */ }

  const nodes = nodeList(st)
  const depths = nodes.map((n) => dist[n]!).sort((a, b) => a - b)
  const median = depths[Math.floor(depths.length / 2)]!
  // 節點圖上離入口幾步（單向不算）
  const hops = new Map<number, number>([[entry, 0]])
  for (let guard = 0; guard <= nodes.length; guard++) for (const c of st.chains) {
    const ha = hops.get(c.a), hb = hops.get(c.b)
    if (ha !== undefined && (hb === undefined || hb > ha + 1)) hops.set(c.b, ha + 1)
    if (hb !== undefined && (hops.get(c.a) === undefined || hops.get(c.a)! > hb + 1)) hops.set(c.a, hb + 1)
  }
  const linkCells: number[] = []
  const linkHops = new Map<number, number>()
  for (const c of st.chains) for (const cell of c.cells) {
    linkCells.push(cell)
    linkHops.set(cell, Math.min(hops.get(c.a) ?? 99, hops.get(c.b) ?? 99) + 1)
  }
  linkCells.sort((a, b) => a - b)

  const occupied = new Map<number, Occ>()
  const names = new Map<number, string>([[entry, spec.entry?.name ?? '入口']])
  if (spec.exit) {
    occupied.set(goal, { place: -1, hidden: false })
    names.set(goal, spec.exit.name)
  }
  const placedBy: number[][] = places.map(() => [])
  const trapKinds = trapKindsOf(spec)

  for (const [pi, pl] of places.entries()) {
    const ok = (cell: number, nodeCell: boolean): boolean => {
      if (occupied.has(cell) || cell === entry) return false
      if (pl.trap && pathIdx.has(cell)) return false
      return (nodeCell ? hops.get(cell)! : linkHops.get(cell)!) >= (pl.apart ?? 0) + 1
    }
    const freeNodes = nodes.filter((n) => ok(n, true))
    const farHalf = shuffle(freeNodes.filter((n) => dist[n]! >= median), rand)
    let cand: number[]
    if (pl.where === 'link') cand = shuffle(linkCells.filter((c) => ok(c, false)), rand)
    else if (pl.where === 'any') cand = shuffle(freeNodes, rand)
    else if (pl.where === 'far_half') cand = farHalf
    else if (pl.where === 'dead_end') {
      const dead = shuffle(freeNodes.filter((n) => neighborsOf(open, w, h, n).length === 1), rand)
      cand = [...dead, ...farHalf.filter((n) => !dead.includes(n))]
    } else {
      // 保證的路上離一半最近的
      const mid = (path.length - 1) / 2
      cand = freeNodes.filter((n) => pathIdx.has(n)).map((n) => ({ n, k: Math.abs(pathIdx.get(n)! - mid) + rand() * 0.5 })).sort((x, y) => x.k - y.k).map((x) => x.n)
    }
    const drawn = between(rand, pl.count[0], pl.count[1])
    const n = cand.length < drawn ? pl.count[0] : drawn
    if (cand.length < n) return { fail: `放不下 ${pl.kind}（${pl.name ?? pl.kind}）：要至少 ${pl.count[0]} 個，${pl.where}${pl.apart ? `（離入口至少隔 ${pl.apart} 個節點）` : ''} 只找到 ${cand.length} 個位置` }
    for (const cell of cand.slice(0, n)) {
      occupied.set(cell, { place: pi, hidden: !!pl.hidden })
      placedBy[pi]!.push(cell)
    }
  }

  // 單向與會斷的鏈路：各挑一部分，在中間放一格；每一個都要通過檢查才留下
  const nodeCells = new Set(nodes)
  const freeCell = (c: Chain): number | null => {
    const mid = (c.cells.length - 1) / 2
    const free = c.cells.filter((x) => !occupied.has(x) && !nodeCells.has(x))
    if (!free.length) return null
    return free.map((x) => ({ x, k: Math.abs(c.cells.indexOf(x) - mid) + rand() * 0.1 })).sort((p, q) => p.k - q.k)[0]!.x
  }
  const eligible = shuffle(st.chains.map((_, i) => i).filter((i) => freeCell(st.chains[i]!) !== null), rand)
  const want = (ratio: number | undefined): number => Math.round((ratio ?? 0) * st.chains.length)
  const tryChain = (ci: number, kind: 'valve' | 'bridge'): void => {
    const c = st.chains[ci]!
    const forced = dirOnPath(c, pathIdx)
    const dirs: Array<'ab' | 'ba' | undefined> = kind === 'bridge' ? [undefined] : forced ? [forced] : shuffle<'ab' | 'ba'>(['ab', 'ba'], rand)
    c.at = freeCell(c)!
    for (const d of dirs) {
      c.kind = kind
      c.dir = d
      if (reachOk(st, entry, goal)) return
    }
    delete c.kind
    delete c.dir
    delete c.at
  }
  // 每一段隨機選單向或會斷（照各自剩下的名額），挑不過檢查的換另一種試一次
  const quota = { valve: want(spec.oneway), bridge: want(spec.fragile) }
  for (const ci of eligible) {
    if (quota.valve + quota.bridge <= 0) break
    const first = rand() * (quota.valve + quota.bridge) < quota.valve ? 'valve' : 'bridge'
    for (const k of [first, first === 'valve' ? 'bridge' : 'valve'] as const) {
      if (quota[k] <= 0) continue
      tryChain(ci, k)
      if (st.chains[ci]!.kind) {
        quota[k]--
        break
      }
    }
  }

  // 版面
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('#'))
  const put = (i: number, ch: string): void => { rows[Math.floor(i / w)]![i % w] = ch }
  open.forEach((v, i) => { if (v) put(i, '.') })
  put(entry, 'E')
  if (spec.exit) put(goal, charOf(spec.exit.kind)!)
  places.forEach((pl, pi) => {
    const cells = [...placedBy[pi]!].sort((a, b) => a - b)
    cells.forEach((cell, k) => {
      if (pl.hidden) return
      put(cell, charOf(pl.kind)!)
      names.set(cell, cells.length > 1 ? `${pl.name ?? pl.kind} ${k + 1}` : (pl.name ?? pl.kind))
    })
  })
  for (const c of st.chains) if (c.kind) put(c.at!, c.kind === 'valve' ? 'v' : 'x')
  const layout = rows.map((r) => r.join(''))
  const base: SheetDef = { id: spec.id, name: spec.name, size: [w, h], layout, legend: { ...NET_LEGEND } }
  const markers = markersInLayout(base)
  const cells: MarkerDef[] = markers.map((m) => ({ id: m.id, at: m.at, mark: m.mark, name: names.get(m.at[1] * w + m.at[0]) ?? m.id }))
  const sheet: SheetDef = { ...base, cells, ...(spec.sight !== undefined ? { sight: spec.sight } : {}) }

  // 圖
  const markerId = new Map(markers.map((m) => [m.at[1] * w + m.at[0], m.id]))
  let plain = 0
  const idOf = new Map<number, string>()
  for (const n of nodes) idOf.set(n, markerId.get(n) ?? `n${++plain}`)
  const kindAt = (i: number): string => {
    if (i === entry) return 'entry'
    const o = occupied.get(i)
    if (!o || o.hidden) return 'floor'
    return o.place < 0 ? spec.exit!.kind : places[o.place]!.kind
  }
  const graphNodes: GenNode[] = nodes.map((n) => {
    const o = occupied.get(n)
    const trap = o && o.place >= 0 && !!places[o.place]!.trap
    return { id: idOf.get(n)!, at: atOf(n, w), kind: kindAt(n), depth: dist[n]!, ...(trap ? { trap: true } : {}) }
  })
  const edges: GenEdge[] = st.chains.map((c) => ({
    a: idOf.get(c.a)!, b: idOf.get(c.b)!, cells: c.cells.map((x) => atOf(x, w)),
    ...(c.kind === 'valve' ? { oneway: c.dir! } : {}), ...(c.kind === 'bridge' ? { fragile: true } : {}),
  }))
  const hidden: GenResult['hidden'] = []
  for (const [cell, o] of [...occupied.entries()].sort((a, b) => a[0] - b[0])) {
    if (!o.hidden) continue
    const pl = places[o.place]!
    hidden.push({ kind: pl.kind, at: atOf(cell, w), ...(trapKinds.has(pl.kind) ? { trap: true } : {}) })
  }
  return { sheet, graph: { nodes: graphNodes, edges }, hidden, safe_path: path.map((i) => atOf(i, w)) }
}

/**
 * 生成一張圖。同一份 spec、同一串亂數，結果逐字一樣。放不下就重挖（最多 GEN_MAX_RECARVE 次），還是不行丟錯，訊息寫出是哪一種放不下。
 * 回傳之前自己跑一次 genProblems，不合格也當成放不下。spec 不合格（genSpecProblems）直接丟錯。
 */
export function generateSheet(spec: GenSpec, rand: GenRand): GenResult {
  const bad = genSpecProblems(spec)
  if (bad.length) throw new Error(`生成地圖的 spec 不合格：${bad.join('；')}`)
  let last = ''
  for (let tries = 0; tries <= GEN_MAX_RECARVE; tries++) {
    const r = attempt(spec, rand)
    if ('fail' in r) {
      last = r.fail
      console.error('PLACE-FAIL', tries, r.fail.slice(0, 60))
      continue
    }
    const problems = genProblems(spec, r)
    if (!problems.length) return r
    last = `結果沒有通過檢查：${problems[0]}`
    console.error('SELFCHECK-FAIL', problems[0])
  }
  throw new Error(`生成「${spec.id}」失敗（重挖 ${GEN_MAX_RECARVE} 次）：${last}`)
}

// ---- 檢查 ----

/** 站在單向的鏈路（net_valve）上的 valve 那一格：從 from 那一格走進去過不過得去。圖上沒有這一格的鏈路時回傳 true（不是這個生成器放的單向）。 */
export function valveAllows(graph: GenResult['graph'], valve: Pt, from: Pt): boolean {
  const same = (p: Pt, q: Pt): boolean => p[0] === q[0] && p[1] === q[1]
  for (const e of graph.edges) {
    const k = e.cells.findIndex((c) => same(c, valve))
    if (k < 0 || !e.oneway) continue
    const side = e.oneway === 'ab' ? (k === 0 ? graph.nodes.find((n) => n.id === e.a)!.at : e.cells[k - 1]!) : (k === e.cells.length - 1 ? graph.nodes.find((n) => n.id === e.b)!.at : e.cells[k + 1]!)
    return same(side, from)
  }
  return true
}

/** 一次生成的結果合不合格：版面格式、每個節點走得到、保證的路、數量、藏起來的東西、圖與版面對得上。回傳問題的清單（空的就是合格）。 */
export function genProblems(spec: GenSpec, result: GenResult): string[] {
  const { sheet, graph, hidden, safe_path } = result
  const p = sheetProblems(sheet, [sheet.id], { minSpots: 0 })
  if (p.length) return p
  const [w, h] = spec.size
  if (sheet.size[0] !== w || sheet.size[1] !== h) p.push(`版面是 ${sheet.size.join('×')}，spec 要 ${w}×${h}`)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && sheet.layout[y]![x] !== '#') p.push(`邊框 ${x},${y} 不是牆`)
  if (p.length) return p
  const sh = new Sheet(sheet)
  const key = (q: Pt): string => `${q[0]},${q[1]}`
  const through = (x: number, y: number): boolean => sh.walkable(x, y) || !!sh.traitsAt(x, y).locked
  const entries = (sheet.cells ?? []).filter((m) => m.mark === 'E')
  if (entries.length !== 1) return [`入口要剛好一個（有 ${entries.length} 個）`]
  const entry = entries[0]!.at
  // 節點
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  if (byId.size !== graph.nodes.length) p.push('節點的 id 有重複')
  const nodeAt = new Set(graph.nodes.map((n) => key(n.at)))
  for (const n of graph.nodes) {
    if (!through(n.at[0], n.at[1])) p.push(`節點 ${n.id} 在走不到的格子上`)
    const kind = sh.kindAt(n.at[0], n.at[1])
    if (n.kind !== kind) p.push(`節點 ${n.id} 的種類 ${n.kind} 和版面的 ${kind} 不一樣`)
    const m = sh.markerAt(n.at[0], n.at[1])
    if (m && m.id !== n.id) p.push(`節點 ${n.id} 的 id 和那一格的標記 ${m.id} 不一樣`)
    if (!m && !/^n\d+$/.test(n.id)) p.push(`沒有標記的節點 ${n.id} 的 id 要是 n<編號>`)
  }
  const entryNode = graph.nodes.find((n) => key(n.at) === key(entry))
  if (!entryNode || entryNode.depth !== 0 || entryNode.kind !== 'entry') p.push('入口要是 depth 0 的節點')
  // depth：從入口走到那一格的步數（單向不算、上鎖的格子當成過得去）
  const pass = (x: number, y: number): boolean => through(x, y)
  for (const n of graph.nodes) {
    const path = sh.findPath({ x: entry[0], y: entry[1] }, { x: n.at[0], y: n.at[1] }, pass)
    if (!path) p.push(`節點 ${n.id} 從入口走不到`)
    else if (path.length - 1 !== n.depth) p.push(`節點 ${n.id} 的 depth 是 ${n.depth}，實際走 ${path.length - 1} 步`)
  }
  if (p.length) return p
  // 鏈路
  const valveCells = new Set<string>(), bridgeCells = new Set<string>()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (sh.kindAt(x, y) === 'net_valve') valveCells.add(`${x},${y}`)
    if (sh.kindAt(x, y) === 'net_bridge') bridgeCells.add(`${x},${y}`)
  }
  const linkSeen = new Set<string>()
  graph.edges.forEach((e, i) => {
    const a = byId.get(e.a), b = byId.get(e.b)
    if (!a || !b) return void p.push(`edges[${i}] 的兩端不是節點`)
    const seq = [a.at, ...e.cells, b.at]
    for (let k = 1; k < seq.length; k++) if (Math.abs(seq[k]![0] - seq[k - 1]![0]) + Math.abs(seq[k]![1] - seq[k - 1]![1]) !== 1) p.push(`edges[${i}] 的格子不連續（${key(seq[k - 1]!)} 到 ${key(seq[k]!)}）`)
    for (const c of e.cells) {
      if (nodeAt.has(key(c))) p.push(`edges[${i}] 的 ${key(c)} 是節點`)
      if (!through(c[0], c[1])) p.push(`edges[${i}] 的 ${key(c)} 走不上去`)
      if (linkSeen.has(key(c))) p.push(`${key(c)} 同時在兩段鏈路裡`)
      linkSeen.add(key(c))
    }
    const valves = e.cells.filter((c) => valveCells.has(key(c))).length, bridges = e.cells.filter((c) => bridgeCells.has(key(c))).length
    if (valves !== (e.oneway ? 1 : 0)) p.push(`edges[${i}] 有 ${valves} 格 net_valve，oneway 是 ${String(e.oneway)}`)
    if (bridges !== (e.fragile ? 1 : 0)) p.push(`edges[${i}] 有 ${bridges} 格 net_bridge，fragile 是 ${String(e.fragile)}`)
    if (e.oneway && e.fragile) p.push(`edges[${i}] 同時單向與會斷`)
  })
  if (valveCells.size + bridgeCells.size !== graph.edges.filter((e) => e.oneway || e.fragile).length) p.push('版面上有不屬於任何一段鏈路的 net_valve 或 net_bridge')
  if (p.length) return p
  // 走得到：照方向走，會斷的當成還在（版面上） / 全斷掉（圖上，最壞的情況）；每個節點走得到出口
  const directed = (x: number, y: number, from?: { x: number; y: number }): boolean => (sh.kindAt(x, y) === 'net_valve' ? !!from && valveAllows(graph, [x, y], [from.x, from.y]) : through(x, y))
  const reachable = sh.reachable({ x: entry[0], y: entry[1] }, directed)
  for (const n of graph.nodes) if (!reachable.has(key(n.at))) p.push(`節點 ${n.id} 照單向的方向從入口走不到`)
  const nodes = graph.nodes.map((n) => n.id)
  const fwd = new Map<string, string[]>(), back = new Map<string, string[]>()
  for (const id of nodes) { fwd.set(id, []); back.set(id, []) }
  for (const e of graph.edges) {
    if (e.fragile) continue
    if (e.oneway !== 'ba') { fwd.get(e.a)!.push(e.b); back.get(e.b)!.push(e.a) }
    if (e.oneway !== 'ab') { fwd.get(e.b)!.push(e.a); back.get(e.a)!.push(e.b) }
  }
  const reach = (from: string, adj: Map<string, string[]>): number => {
    const seen = new Set([from])
    const queue = [from]
    for (let qi = 0; qi < queue.length; qi++) for (const n of adj.get(queue[qi]!)!) if (!seen.has(n)) { seen.add(n); queue.push(n) }
    return seen.size
  }
  const maxDepth = Math.max(...graph.nodes.map((n) => n.depth))
  // 沒寫 exit 時，保證的路走到的那一格要是離入口最遠的節點之一
  let goal = (safe_path.length ? graph.nodes.find((n) => key(n.at) === key(safe_path[safe_path.length - 1]!)) : undefined) ?? graph.nodes.find((n) => n.depth === maxDepth)!
  if (!spec.exit && goal.depth !== maxDepth) p.push(`safe_path 要走到離入口最遠的節點（depth ${maxDepth}），它走到 depth ${goal.depth}`)
  if (spec.exit) {
    const exits = graph.nodes.filter((n) => n.kind === spec.exit!.kind && sh.markerAt(n.at[0], n.at[1])?.name === spec.exit!.name)
    if (exits.length !== 1) p.push(`出口要剛好一個（有 ${exits.length} 個）`)
    else {
      goal = exits[0]!
      if (goal.depth !== maxDepth) p.push(`出口的 depth 是 ${goal.depth}，最大的是 ${maxDepth}`)
    }
  }
  if (reach(entryNode!.id, fwd) !== nodes.length) p.push('單向照方向、會斷的全斷掉，入口走不到每個節點')
  if (reach(goal.id, back) !== nodes.length) p.push('單向照方向、會斷的全斷掉，有節點走不到出口')
  // 保證的路
  const trapKinds = trapKindsOf(spec)
  const hiddenTraps = new Set(hidden.filter((x) => x.trap).map((x) => key(x.at)))
  if (!safe_path.length || key(safe_path[0]!) !== key(entry)) p.push('safe_path 要從入口開始')
  else if (key(safe_path[safe_path.length - 1]!) !== key(goal.at)) p.push('safe_path 要走到出口')
  safe_path.forEach((c, i) => {
    if (i > 0 && Math.abs(c[0] - safe_path[i - 1]![0]) + Math.abs(c[1] - safe_path[i - 1]![1]) !== 1) p.push(`safe_path 第 ${i} 格不連續`)
    if (!through(c[0], c[1])) p.push(`safe_path 的 ${key(c)} 走不上去`)
    if (trapKinds.has(sh.kindAt(c[0], c[1]))) p.push(`safe_path 經過陷阱 ${key(c)}`)
    if (hiddenTraps.has(key(c))) p.push(`safe_path 經過藏起來的陷阱 ${key(c)}`)
    if (i > 0 && sh.kindAt(c[0], c[1]) === 'net_valve' && !valveAllows(graph, c, safe_path[i - 1]!)) p.push(`safe_path 在 ${key(c)} 逆著單向的方向走`)
  })
  // 藏起來的東西
  const hiddenSeen = new Set<string>()
  for (const x of hidden) {
    if (hiddenSeen.has(key(x.at))) p.push(`藏起來的東西重疊在 ${key(x.at)}`)
    hiddenSeen.add(key(x.at))
    if (sh.kindAt(x.at[0], x.at[1]) !== 'floor') p.push(`藏起來的 ${x.kind} 在 ${key(x.at)}，那一格不是地板（是 ${sh.kindAt(x.at[0], x.at[1])}）`)
    if (!!x.trap !== trapKinds.has(x.kind)) p.push(`藏起來的 ${x.kind} 的 trap 和 spec 不一樣`)
  }
  // 數量：同一種格子（畫出來的、藏起來的各算）的總數要在各個 place 的範圍加起來之內
  const bounds = new Map<string, [number, number]>()
  const addBound = (kind: string, hid: boolean, lo: number, hi: number): void => {
    const k = `${hid ? 'hidden' : 'shown'}:${kind}`
    const old = bounds.get(k) ?? [0, 0]
    bounds.set(k, [old[0] + lo, old[1] + hi])
  }
  for (const pl of spec.places) addBound(pl.kind, !!pl.hidden, pl.count[0], pl.count[1])
  if (spec.exit) addBound(spec.exit.kind, false, 1, 1)
  const actual = new Map<string, number>()
  const bump = (k: string): void => void actual.set(k, (actual.get(k) ?? 0) + 1)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const kind = sh.kindAt(x, y)
    if (['wall', 'floor', 'entry', 'net_valve', 'net_bridge'].includes(kind)) continue
    bump(`shown:${kind}`)
  }
  for (const x of hidden) bump(`hidden:${x.kind}`)
  for (const [k, n] of actual) if (!bounds.has(k)) p.push(`版面上有 spec 沒寫的 ${k.replace(':', ' ')}（${n} 個）`)
  for (const [k, [lo, hi]] of bounds) {
    const n = actual.get(k) ?? 0
    if (n < lo || n > hi) p.push(`${k.replace(':', ' ')} 有 ${n} 個，spec 要 ${lo}～${hi} 個`)
  }
  return p
}
