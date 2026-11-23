// L5 地圖：模型（MIGRATION E 的 grid、specialMaps；CODESCAN 2.2 節：把 ElondiaRPG 的 grid.ts 拆成地圖模型、生成器、移動尋路、踩格子後的結算四塊）。
// 這個檔是「地圖模型」與「尋路」：純函式，不碰遊戲狀態。版面的格式照 DATA 9.3 節與 COMMISSION_MAPS 第 1 節：
// 一格一個字元、圖例把字元對到格子的種類、區塊另外一張同樣大小的圖、標記一筆一筆列出來。
// 同一個模型給現實的固定版面（special_map）與內海的隨機生成（M3：生成器吐出同樣的 SheetDef）用。dev/adr/0012。

import type { CellKind, CellPatch, GridPoint } from '../types'
import type { ContentEntry } from '../content/registry'
import { isRecord } from '../util/sanitize'

/** 預設的圖例（COMMISSION_MAPS 1.1 節）：字元 → 格子的種類。 */
export const DEFAULT_LEGEND: Record<string, CellKind> = {
  '#': 'wall', '.': 'floor', ',': 'ground', '~': 'water', '+': 'door', '%': 'door_locked', '=': 'window', '^': 'vent',
  '<': 'stair_up', '>': 'stair_down', H: 'lift', O: 'cover', o: 'half_cover', '*': 'crowd', $: 'safe', '&': 'hostage',
  E: 'entry', T: 'target', D: 'data_port', C: 'control', G: 'guard', S: 'camera', K: 'credential', X: 'extract', F: 'facility',
  1: 'spot', 2: 'spot', 3: 'spot', 4: 'spot', 5: 'spot', 6: 'spot', 7: 'spot', 8: 'spot', 9: 'spot',
}

export interface CellTraits {
  /** 可以走上去 */
  walk: boolean
  /** 看得穿（不擋視線） */
  see: boolean
  /** 是標記：站上去會問登錄表「這裡能做什麼」。值是資料裡標記的字母（E、T、$、!……） */
  mark?: string
  /** 要條件才過得去（上鎖的門）：條件由功能註冊（機械檢定、憑證、接管控制區） */
  locked?: boolean
}

/**
 * 每一種格子的性質。資料的 legend 只能把字元對到這張表裡有的種類（查不到的整張圖不收）；要新的種類就加在這裡，和其他的標記格一樣是核心的小改動。
 * facility 是城市街區上的設施（商店、診所、住處……；DISTRICTS 的設施）：走得上去、看得穿，標記 F，設施的種類與名字在街區的資料裡，不在格子的種類上。
 */
export const CELL_TRAITS: Record<CellKind, CellTraits> = {
  wall: { walk: false, see: false },
  floor: { walk: true, see: true },
  ground: { walk: true, see: true },
  water: { walk: false, see: true },
  door: { walk: true, see: false },
  door_locked: { walk: false, see: false, locked: true },
  // （鍵加引號：分層檢查會把沒加引號的 window 當成瀏覽器的全域物件）
  'window': { walk: false, see: true },
  vent: { walk: true, see: false },
  stair_up: { walk: true, see: true },
  stair_down: { walk: true, see: true },
  lift: { walk: true, see: true },
  cover: { walk: false, see: false },
  half_cover: { walk: false, see: true },
  crowd: { walk: true, see: false },
  // 標記站的那一格可以走（窗上的 E 也是）
  safe: { walk: true, see: true, mark: '$' },
  hostage: { walk: true, see: true, mark: '&' },
  entry: { walk: true, see: true, mark: 'E' },
  target: { walk: true, see: true, mark: 'T' },
  data_port: { walk: true, see: true, mark: 'D' },
  control: { walk: true, see: true, mark: 'C' },
  guard: { walk: true, see: true, mark: 'G' },
  camera: { walk: true, see: true, mark: 'S' },
  credential: { walk: true, see: true, mark: 'K' },
  extract: { walk: true, see: true, mark: 'X' },
  facility: { walk: true, see: true, mark: 'F' },
  spot: { walk: true, see: true, mark: '!' },
}

/** 一個標記（DATA 9.3 節的 cells）。 */
export interface MarkerDef {
  /** 照「由上到下、由左到右」編號：E1、T2、$1、&1 */
  id: string
  at: [number, number]
  mark: string
  name: string
  /** 入口的種類與條件（COMMISSION_TEMPLATES 的 entries[].need）；其他標記沒有 */
  kind?: string
  need?: Record<string, unknown>
}

/** 遭遇點：在這裡開打時，戰場的八格遮蔽照它的配置。 */
export interface SpotDef {
  /** 模板的編號：!1、!2 */
  id: string
  at: [number, number]
  /** dense、medium、sparse、one_sided，或八格逐格寫 */
  cover: string | { ally: number[]; foe: number[] }
  /** 場地效果：dark、crowd…… */
  field?: string[]
}

export interface ControlDef {
  id: string
  at: [number, number]
  zones: string[]
  /** 子網裡對應的控制節點 id（cn_ 開頭） */
  node: string
  devices: string[]
}

export interface LinkDef {
  /** 這一張圖上的一格或幾格（樓梯、電梯、相通的門） */
  at: Array<[number, number]>
  /** 接到哪一張圖 */
  to: string
  /** 到了那一張站在哪；沒寫就站在那一張接回這一張的連接格 */
  land?: [number, number]
}

export interface PatrolDef {
  guard: string
  /** 照順序走過的區塊 */
  route: string[]
}

/** 一張圖（DATA 9.3 節的 sheets[]）。 */
export interface SheetDef {
  id: string
  name: string
  size: [number, number]
  layout: string[]
  legend?: Record<string, CellKind>
  zones?: string[]
  zone_names?: Record<string, string>
  cells?: MarkerDef[]
  spots?: SpotDef[]
  controls?: ControlDef[]
  patrols?: PatrolDef[]
  links?: LinkDef[]
  scout?: Array<{ reveal: string; at: string }>
  /** 整張沒有燈（排水道、隧道）：視野只剩腳下（SITES 第 11 節） */
  dark?: boolean
}

/** 一個地圖的定義（DATA 9.3 節；一個模板一筆，裡面一到幾張圖）。內容種類 special_map。 */
export interface SpecialMapEntry extends ContentEntry {
  /** 模板的種類（office_small、club……） */
  kind: string
  size: [number, number]
  max_maps?: number
  district_weight?: Record<string, number>
  fits?: string[]
  sheets: SheetDef[]
}

export const pointKey = (x: number, y: number): string => `${x},${y}`
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
export const GRID_DIRS = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] } as const
export type GridDir = keyof typeof GRID_DIRS

/** 一張讀好的圖：每一格的種類，加上查詢。patch 是這一份實例上被改過的格子（門開了）。 */
export class Sheet {
  readonly w: number
  readonly h: number
  private kinds: CellKind[][]
  private markers = new Map<string, MarkerDef>()

  constructor(readonly def: SheetDef, patch: Record<string, CellPatch> = {}) {
    this.w = def.size[0]
    this.h = def.size[1]
    const legend = { ...DEFAULT_LEGEND, ...(def.legend ?? {}) }
    this.kinds = def.layout.map((row, y) => [...row].map((ch, x) => patch[pointKey(x, y)]?.kind ?? legend[ch] ?? 'wall'))
    for (const m of def.cells ?? []) this.markers.set(pointKey(m.at[0], m.at[1]), m)
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  kindAt(x: number, y: number): CellKind {
    return this.inBounds(x, y) ? (this.kinds[y]?.[x] ?? 'wall') : 'wall'
  }

  traitsAt(x: number, y: number): CellTraits {
    return CELL_TRAITS[this.kindAt(x, y)] ?? CELL_TRAITS.wall!
  }

  /** 走得上去（上鎖的門不算；過不過得去另外問登錄表）。 */
  walkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.traitsAt(x, y).walk
  }

  zoneAt(x: number, y: number): string | undefined {
    const z = this.def.zones?.[y]?.[x]
    return z && /[a-z]/.test(z) ? z : undefined
  }

  markerAt(x: number, y: number): MarkerDef | undefined {
    return this.markers.get(pointKey(x, y))
  }

  marker(id: string): MarkerDef | undefined {
    return (this.def.cells ?? []).find((m) => m.id === id)
  }

  spotAt(x: number, y: number): SpotDef | undefined {
    return (this.def.spots ?? []).find((s) => s.at[0] === x && s.at[1] === y)
  }

  linkAt(x: number, y: number): LinkDef | undefined {
    return (this.def.links ?? []).find((l) => l.at.some(([lx, ly]) => lx === x && ly === y))
  }

  /** 四方向的最短路（BFS）。回傳含起點與終點的路；走不到回傳 null。pass 可以多放行幾種格子（已經打開的鎖）。 */
  findPath(from: GridPoint, to: GridPoint, pass: (x: number, y: number) => boolean = (x, y) => this.walkable(x, y)): GridPoint[] | null {
    if (!this.inBounds(to.x, to.y) || !pass(to.x, to.y)) return null
    if (from.x === to.x && from.y === to.y) return [from]
    const prev = new Map<string, GridPoint>()
    const seen = new Set<string>([pointKey(from.x, from.y)])
    const queue: GridPoint[] = [from]
    while (queue.length) {
      const cur = queue.shift()!
      for (const [dx, dy] of DIRS) {
        const n = { x: cur.x + dx, y: cur.y + dy }
        const key = pointKey(n.x, n.y)
        if (seen.has(key) || !this.inBounds(n.x, n.y) || !pass(n.x, n.y)) continue
        seen.add(key)
        prev.set(key, cur)
        if (n.x === to.x && n.y === to.y) {
          const path: GridPoint[] = [n]
          let p: GridPoint | undefined = cur
          while (p) {
            path.unshift(p)
            p = prev.get(pointKey(p.x, p.y))
          }
          return path
        }
        queue.push(n)
      }
    }
    return null
  }

  /** 從起點走得到的所有格子（'x,y'）。 */
  reachable(from: GridPoint, pass: (x: number, y: number) => boolean = (x, y) => this.walkable(x, y)): Set<string> {
    const seen = new Set<string>([pointKey(from.x, from.y)])
    const queue: GridPoint[] = [from]
    while (queue.length) {
      const cur = queue.shift()!
      for (const [dx, dy] of DIRS) {
        const x = cur.x + dx, y = cur.y + dy
        const key = pointKey(x, y)
        if (seen.has(key) || !this.inBounds(x, y) || !pass(x, y)) continue
        seen.add(key)
        queue.push({ x, y })
      }
    }
    return seen
  }

  /** 視野：距離 r 以內、而且沿著看得穿的格子連得到。擋視線的那一格本身看得到（牆的這一面）。 */
  visibleFrom(from: GridPoint, r: number): Set<string> {
    const out = new Set<string>([pointKey(from.x, from.y)])
    const dist = new Map<string, number>([[pointKey(from.x, from.y), 0]])
    const queue: GridPoint[] = [from]
    while (queue.length) {
      const cur = queue.shift()!
      const d = dist.get(pointKey(cur.x, cur.y))!
      if (d >= r) continue
      for (const [dx, dy] of DIRS) {
        const x = cur.x + dx, y = cur.y + dy
        const key = pointKey(x, y)
        if (!this.inBounds(x, y) || dist.has(key)) continue
        dist.set(key, d + 1)
        out.add(key)
        if (this.traitsAt(x, y).see) queue.push({ x, y })
      }
    }
    return out
  }
}

/** 版面的標記照「由上到下、由左到右」數出來的 id（COMMISSION_MAPS 1.2 節）：E1、E2、T1、$1……遭遇點是 !<數字>。 */
export function markersInLayout(def: SheetDef): Array<{ id: string; at: [number, number]; mark: string }> {
  const legend = { ...DEFAULT_LEGEND, ...(def.legend ?? {}) }
  const count = new Map<string, number>()
  const out: Array<{ id: string; at: [number, number]; mark: string }> = []
  def.layout.forEach((row, y) => [...row].forEach((ch, x) => {
    const mark = CELL_TRAITS[legend[ch] ?? 'wall']?.mark
    if (!mark) return
    if (mark === '!') return void out.push({ id: `!${ch}`, at: [x, y], mark })
    const n = (count.get(mark) ?? 0) + 1
    count.set(mark, n)
    out.push({ id: `${mark}${n}`, at: [x, y], mark })
  }))
  return out
}

/**
 * 城市的街區地圖（world 的街區與橋接區）：special_map 的 kind 是這幾種之一，就不要求每張圖有 2 個遭遇點
 * （遭遇點是副本的模板才有的東西；街區上沒有人登記遭遇點的觸發，要放也可以）。
 */
export const STREET_MAP_KINDS: readonly string[] = ['block', 'bridge']

/** 這個種類的地圖是不是城市的街區地圖（不要求遭遇點）。 */
export const isStreetMapKind = (kind: unknown): boolean => typeof kind === 'string' && STREET_MAP_KINDS.includes(kind)

export interface SheetCheckOpts {
  /** 每一張至少要有幾個遭遇點；預設 2（COMMISSION_MAPS 第 1 節），街區地圖是 0 */
  minSpots?: number
}

const isGridPoint = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n))

/** cells、spots、links 的形狀：每一個要是物件、id 與位置合格。回傳問題的清單（空的就是可以往下檢查內容）。 */
function sheetShapeProblems(def: SheetDef, at: string): string[] {
  const p: string[] = []
  const raw = def as unknown as Record<string, unknown>
  const rows = (key: 'cells' | 'spots' | 'links'): unknown[] => {
    const v = raw[key]
    if (v === undefined) return []
    if (!Array.isArray(v)) {
      p.push(`${at}：${key} 要是陣列`)
      return []
    }
    return v
  }
  rows('cells').forEach((m, i) => {
    if (!isRecord(m)) return void p.push(`${at}：cells[${i}] 要是物件`)
    if (typeof m.id !== 'string' || !m.id) p.push(`${at}：cells[${i}] 要有 id`)
    if (typeof m.mark !== 'string' || !m.mark) p.push(`${at}：cells[${i}]（${String(m.id)}）要有 mark`)
    if (!isGridPoint(m.at)) p.push(`${at}：cells[${i}]（${String(m.id)}）的 at 要是 [x, y] 兩個整數`)
  })
  rows('spots').forEach((s, i) => {
    if (!isRecord(s)) return void p.push(`${at}：spots[${i}] 要是物件`)
    if (typeof s.id !== 'string' || !s.id) p.push(`${at}：spots[${i}] 要有 id`)
    if (!isGridPoint(s.at)) p.push(`${at}：spots[${i}]（${String(s.id)}）的 at 要是 [x, y] 兩個整數`)
  })
  rows('links').forEach((l, i) => {
    if (!isRecord(l)) return void p.push(`${at}：links[${i}] 要是物件`)
    if (typeof l.to !== 'string' || !l.to) p.push(`${at}：links[${i}] 要有 to（接到的圖）`)
    if (!Array.isArray(l.at) || !l.at.every(isGridPoint)) p.push(`${at}：links[${i}] 的 at 要是 [x, y] 的陣列`)
  })
  return p
}

/** 一張圖的格式檢查（DATA 9.3 節的資料檢查）。回傳問題的清單。 */
export function sheetProblems(def: SheetDef, siblings: string[] = [], opts: SheetCheckOpts = {}): string[] {
  const p: string[] = []
  const at = `sheets/${String(def?.id)}`
  if (!def || typeof def.id !== 'string' || !def.id) return ['每一張圖要有 id']
  if (typeof def.name !== 'string' || !def.name.trim()) p.push(`${at}：要有 name`)
  if (!Array.isArray(def.size) || def.size.length !== 2 || !def.size.every((n) => Number.isInteger(n) && n > 0)) return [...p, `${at}：size 要是 [寬, 高]`]
  const [w, h] = def.size
  if (!Array.isArray(def.layout) || def.layout.length !== h) return [...p, `${at}：layout 要有 ${h} 列（拿到 ${Array.isArray(def.layout) ? def.layout.length : '不是陣列'}）`]
  const legend = { ...DEFAULT_LEGEND, ...(def.legend ?? {}) }
  def.layout.forEach((row, y) => {
    if (typeof row !== 'string' || [...row].length !== w) p.push(`${at}：layout 第 ${y} 列的長度要是 ${w}`)
    else for (const ch of row) if (!legend[ch] || !CELL_TRAITS[legend[ch]!]) p.push(`${at}：layout 第 ${y} 列有圖例沒有的字元 ${JSON.stringify(ch)}`)
  })
  if (def.zones !== undefined && !(Array.isArray(def.zones) && def.zones.length === h && def.zones.every((row) => typeof row === 'string' && [...row].length === w))) p.push(`${at}：zones 要和 layout 一樣大`)
  if (p.length) return p
  // cells、spots、links 的形狀：資料寫壞時回問題清單，不丟例外（GAME_DESIGN 第 3 節第 13 條；B020）
  const shape = sheetShapeProblems(def, at)
  if (shape.length) return shape
  const sheet = new Sheet(def)
  // 標記：資料裡列的要和版面上的字元一一對應（id、位置、種類）
  const drawn = markersInLayout(def)
  const listed = [...(def.cells ?? []).map((m) => ({ id: m.id, at: m.at, mark: m.mark })), ...(def.spots ?? []).map((s) => ({ id: s.id, at: s.at, mark: '!' }))]
  for (const d of drawn) {
    const m = listed.find((x) => x.id === d.id)
    if (!m) p.push(`${at}：版面上的 ${d.id}（${d.at.join(',')}）沒有列在 ${d.mark === '!' ? 'spots' : 'cells'} 裡`)
    else if (m.at[0] !== d.at[0] || m.at[1] !== d.at[1] || m.mark !== d.mark) p.push(`${at}：${d.id} 寫的位置或種類和版面不一樣（版面在 ${d.at.join(',')}）`)
  }
  for (const m of listed) if (!drawn.some((d) => d.id === m.id)) p.push(`${at}：${m.id} 列在資料裡，版面上卻沒有`)
  for (const m of def.cells ?? []) if (typeof m.name !== 'string' || !m.name.trim()) p.push(`${at}：${m.id} 要有 name`)
  const minSpots = opts.minSpots ?? 2
  if ((def.spots ?? []).length < minSpots) p.push(`${at}：每一張至少要有 ${minSpots} 個遭遇點`)
  for (const l of def.links ?? []) {
    if (!siblings.includes(l.to)) p.push(`${at}：links 接到不存在的圖 ${l.to}`)
    for (const [x, y] of l.at ?? []) if (!sheet.walkable(x, y)) p.push(`${at}：連接格 ${x},${y} 走不上去`)
  }
  // 每個標記與地板都要從入口或連接格走得到（上鎖的門當成過得去）
  const starts: GridPoint[] = [...(def.cells ?? []).filter((m) => m.mark === 'E').map((m) => ({ x: m.at[0], y: m.at[1] })), ...(def.links ?? []).flatMap((l) => l.at.map(([x, y]) => ({ x, y })))]
  if (!starts.length) p.push(`${at}：沒有入口也沒有連接格，走不進來`)
  else {
    const pass = (x: number, y: number) => sheet.walkable(x, y) || !!sheet.traitsAt(x, y).locked
    const ok = new Set<string>()
    for (const s of starts) for (const key of sheet.reachable(s, pass)) ok.add(key)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sheet.walkable(x, y) && !ok.has(pointKey(x, y))) p.push(`${at}：${x},${y}（${sheet.kindAt(x, y)}）從入口走不到`)
  }
  return p
}

/** 一個地圖定義的格式檢查。 */
export function specialMapProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (typeof e.kind !== 'string' || !e.kind) p.push('要有 kind（模板的種類）')
  if (!Array.isArray(e.sheets) || !e.sheets.length) return [...p, 'sheets 要有至少一張圖']
  const sheets = e.sheets as SheetDef[]
  const ids = sheets.map((s) => s?.id)
  if (new Set(ids).size !== ids.length) p.push('sheets 的 id 不能重複')
  const opts: SheetCheckOpts = isStreetMapKind(e.kind) ? { minSpots: 0 } : {}
  for (const s of sheets) p.push(...sheetProblems(s, ids as string[], opts))
  return p
}
