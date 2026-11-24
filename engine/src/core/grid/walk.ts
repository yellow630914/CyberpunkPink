// L5 地圖：開一份地圖、走一步、看現在這一格。純函式：讀遊戲狀態，回傳變更或報告草稿；交給提交報告才會改狀態。
//
// - 同一個定義可以開好幾份實例（每件委託各一份），結束時清掉（CODESCAN 2.2 節：固定的特殊地圖「加實例」）。
// - 走到敵人那一格就開打、戰鬥是另一個畫面（COMBAT_SYSTEM 第 10 節）：核心只負責問登錄表，開打由功能回傳接著要提交的報告。
// - 探索不花遊戲裡的時間（副本沒有另外的時鐘；SERIES 第 6 節）：要花時間的由功能在 enter 裡加 time 變更。

import type { BattleSetup } from '../battle/setup'
import type { Change, GameState, GridPos, Launch, MapInstance, MarkerDef, ReportDraft, ReportTrigger, SheetDef, SheetState, SpecialMapEntry } from '../types'
import { clone } from '../util/clone'
import type { GridDir } from './model'
import { GRID_DIRS, Sheet, genMapProblems, pointKey, sightOf } from './model'
import type { GridCtx, GridEffect, GridKernel, GridUse } from './registry'

export class GridBlocked extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'GridBlocked'
  }
}

export function mapDef(k: GridKernel, id: string): SpecialMapEntry {
  const def = k.content.get<SpecialMapEntry>('special_map', id)
  if (!def) throw new Error(`沒有 ${id} 這張地圖`)
  return def
}

/**
 * 這份實例用的地圖定義：有 gen（生成的地圖）用它自己帶的，不查內容；沒有就照 def 查內容（special_map）。
 * 核心裡一切「照實例找定義」的地方都走這裡（dev/adr/0018 第五節），不要自己拿 instance.def 去查內容。
 */
export function instanceDef(k: GridKernel, instance: MapInstance): SpecialMapEntry {
  return instance.gen ? instance.gen.map : mapDef(k, instance.def)
}

function sheetDef(map: SpecialMapEntry, id: string): SheetDef {
  const s = map.sheets.find((x) => x.id === id)
  if (!s) throw new Error(`地圖 ${map.id} 沒有 ${id} 這一張圖`)
  return s
}

const blankSeen = (def: SheetDef): string[] => def.layout.map((row) => '0'.repeat([...row].length))

/** 從 from 看得到的格子併進 seen。 */
function reveal(sheet: Sheet, seen: string[], at: { x: number; y: number }): string[] {
  const rows = (seen.length === sheet.h ? seen : blankSeen(sheet.def)).map((r) => [...r])
  for (const key of sheet.visibleFrom(at, sightOf(sheet.def))) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (rows[y]?.[x] !== undefined) rows[y]![x] = '1'
  }
  return rows.map((r) => r.join(''))
}

export interface OpenMapOpts {
  /** 開它的東西（委託的 id）：結束時用 closeMap 一起清掉 */
  owner?: string
  /** 站到哪一張圖；沒寫是第一張 */
  sheet?: string
  /** 站到哪：標記的 id（E2），或座標。沒寫是那一張的第一個入口 */
  at?: string | [number, number]
  ext?: Record<string, unknown>
  /** 生成用的種子（def 是整筆定義時記進實例的 gen；沒寫是 0）。def 是 id 時不看 */
  seed?: number
  /** 誰生成的（功能或區的 id；def 是整筆定義時記進實例的 gen；沒寫是 'gen'）。def 是 id 時不看 */
  by?: string
}

/**
 * 開一份地圖的實例並站進去。回傳變更（map.open、map.sheet、map.at）與新實例的 id。
 * def 可以是內容裡的地圖 id，也可以是整筆定義（生成的地圖）：整筆的話定義整份存進實例（gen；dev/adr/0018 第五節），
 * 先過 specialMapProblems，不合格丟錯、訊息寫出問題；內容裡不必有它。
 */
export function openMap(k: GridKernel, state: GameState, def: string | SpecialMapEntry, o: OpenMapOpts = {}): { id: string; changes: Change[] } {
  const gen = typeof def === 'string' ? undefined : { map: clone(def), seed: o.seed ?? 0, by: o.by ?? 'gen' }
  if (gen) {
    const problems = genMapProblems(gen, gen.map.id)
    if (problems.length) throw new Error(`生成的地圖不合格：${problems.slice(0, 5).join('；')}`)
  }
  const map = gen ? gen.map : mapDef(k, def as string)
  const sheetDefn = sheetDef(map, o.sheet ?? map.sheets[0]!.id)
  const sheet = new Sheet(sheetDefn)
  const marker = typeof o.at === 'string' ? sheet.marker(o.at) : undefined
  if (typeof o.at === 'string' && !marker) throw new Error(`${sheetDefn.id} 沒有 ${o.at} 這個標記`)
  const entry = marker ?? (Array.isArray(o.at) ? undefined : (sheetDefn.cells ?? []).find((m) => m.mark === 'E'))
  const [x, y] = Array.isArray(o.at) ? o.at : (entry?.at ?? sheetDefn.links?.[0]?.at[0] ?? [-1, -1])
  if (!sheet.walkable(x, y)) throw new Error(`${sheetDefn.id} 的 ${x},${y} 站不上去`)
  const id = `m${state.maps.seq + 1}`
  const instance: MapInstance = { id, def: map.id, ...(o.owner ? { owner: o.owner } : {}), ...(gen ? { gen } : {}), sheets: {}, ...(o.ext ? { ext: clone(o.ext) } : {}) }
  return {
    id,
    changes: [
      { op: 'map.open', instance },
      { op: 'map.sheet', map: id, sheet: sheetDefn.id, seen: reveal(sheet, [], { x, y }) },
      { op: 'map.at', to: { map: id, sheet: sheetDefn.id, x, y } },
    ],
  }
}

/** 清掉一份實例（人還站在裡面的話先離開格子地圖）。 */
export function closeMap(state: GameState, id: string): Change[] {
  return [...(state.maps.at?.map === id ? [{ op: 'map.at', to: null }] : []), { op: 'map.close', id }]
}

/** 現在這一張圖（套上這份實例改過的格子）與位置。不在格子地圖上回傳 null。 */
export function gridHere(k: GridKernel, state: GameState): (GridCtx & { instance: MapInstance; sheetState: SheetState }) | null {
  const at = state.maps.at
  if (!at) return null
  const instance = state.maps.instances[at.map]
  if (!instance) return null
  const map = instanceDef(k, instance)
  const sheetState = instance.sheets[at.sheet] ?? { seen: [], cells: {}, movers: {} }
  return { k, state, map, sheet: new Sheet(sheetDef(map, at.sheet), sheetState.cells), at, step: 0, last: true, instance, sheetState }
}

export interface GridView {
  map: string
  sheet: string
  name: string
  size: [number, number]
  at: [number, number]
  /** 每一格：看過的給種類，沒看過的是 null */
  cells: Array<Array<string | null>>
  /** 站的這一格的標記與現在能做的事（走到了就列出來，按了才做） */
  here: { marker: MarkerDef | null; uses: GridUse[]; zone?: string }
  /** 四個方向走不走得過去；走不過去的寫原因 */
  moves: Record<GridDir, string | null>
}

/**
 * 從 ctx.at（現在站的那一格）走進 (x, y) 過不過得去；過得去是 null，否則是原因。
 * 要條件的格子（locked）：問登錄表的放行規則（規則拿到的 ctx.at 就是現在站的那一格，單向的鏈路靠它判斷從哪一邊來），
 * 有一條放行就過；沒有人註冊、或註冊的都不放行又沒說原因時，用那種格子預設的原因（CellTraits.lockedReason，沒寫是「門鎖著。」）。
 */
function passBlock(ctx: GridCtx, x: number, y: number): string | null {
  const { sheet } = ctx
  if (!sheet.inBounds(x, y)) return '那邊沒有路。'
  const traits = sheet.traitsAt(x, y)
  if (traits.walk) return null
  if (!traits.locked) return '那邊走不過去。'
  const fallback = traits.lockedReason ?? '門鎖著。'
  const rules = ctx.k.grid.passRules(sheet.kindAt(x, y))
  if (!rules.length) return fallback
  const reasons = rules.map((fn) => fn(ctx, x, y))
  return reasons.some((r) => r === null) ? null : (reasons.find((r) => r) ?? fallback)
}

/** 給畫面的：現在這一張圖看過的格子、站的位置、這一格能做的事、四個方向能不能走。 */
export function gridView(k: GridKernel, state: GameState): GridView | null {
  const here = gridHere(k, state)
  if (!here) return null
  const { sheet, at, sheetState } = here
  const marker = sheet.markerAt(at.x, at.y) ?? null
  const cells = Array.from({ length: sheet.h }, (_, y) => Array.from({ length: sheet.w }, (_, x) => (sheetState.seen[y]?.[x] === '1' ? sheet.kindAt(x, y) : null)))
  const zone = sheet.zoneAt(at.x, at.y)
  return {
    map: at.map, sheet: at.sheet, name: sheet.def.name, size: [sheet.w, sheet.h], at: [at.x, at.y], cells,
    here: { marker, uses: marker ? k.grid.listUses(here, marker) : [], ...(zone ? { zone } : {}) },
    moves: Object.fromEntries(Object.entries(GRID_DIRS).map(([dir, [dx, dy]]) => [dir, passBlock(here, at.x + dx, at.y + dy)])) as Record<GridDir, string | null>,
  }
}

/**
 * 走一段路：一個方向（走一格），或一個目的地（照最短路一格一格走）。走不過去丟 GridBlocked，附原因。
 * 每走進一格：記下看過的格子 → 進格的掛點（監視器、巡邏）→ 連接格換圖 → 這一格的標記。有東西要停（開打、事件）就停在那一格。
 * 回傳一份報告草稿與接著要提交的報告（由呼叫的人照順序提交）。
 */
export function gridWalk(k: GridKernel, state: GameState, to: GridDir | [number, number]): { draft: ReportDraft; followUps: ReportDraft[]; battle?: BattleSetup } {
  const start = gridHere(k, state)
  if (!start) throw new GridBlocked('現在不在格子地圖上。')
  if (state.battle) throw new GridBlocked('正在戰鬥，先把這一場打完。')
  let { sheet } = start
  const { map, instance } = start
  let pos: GridPos = { ...start.at }
  let path: Array<{ x: number; y: number }>
  if (Array.isArray(to)) {
    // 放行規則拿到的 at 是「從哪一格往那一格走」：尋路時每一格都用它的前一格問（單向的鏈路才認得出從哪一邊來）
    const pass = (x: number, y: number, from?: { x: number; y: number }) => passBlock({ ...start, sheet, at: from ? { ...pos, x: from.x, y: from.y } : pos }, x, y) === null
    const found = sheet.findPath({ x: pos.x, y: pos.y }, { x: to[0], y: to[1] }, pass)
    if (!found) throw new GridBlocked('走不到那裡。')
    path = found.slice(1)
  } else {
    const [dx, dy] = GRID_DIRS[to]
    const why = passBlock(start, pos.x + dx, pos.y + dy)
    if (why) throw new GridBlocked(why)
    path = [{ x: pos.x + dx, y: pos.y + dy }]
  }
  const changes: Change[] = []
  const followUps: ReportDraft[] = []
  const lines: string[] = []
  const launch: Launch[] = []
  const triggers: ReportTrigger[] = []
  let battle: BattleSetup | undefined
  const seen = new Map<string, string[]>([[pos.sheet, [...(start.sheetState.seen)]]])
  const apply = (e: GridEffect | void): boolean => {
    if (!e) return false
    changes.push(...(e.changes ?? []))
    followUps.push(...(e.followUps ?? []))
    launch.push(...(e.launch ?? []))
    triggers.push(...(e.triggers ?? []))
    if (e.line) lines.push(e.line)
    if (e.battle && !battle) battle = e.battle
    return !!e.stop || !!e.followUps?.length || !!e.launch?.length || !!e.battle
  }
  let steps = 0
  for (const cell of path) {
    pos = { ...pos, x: cell.x, y: cell.y }
    steps += 1
    let stop = false
    // step 是這一段路的第幾格；last 是計畫裡的最後一格（路過的格子是 false，走到終點才是 true）
    const ctx = (): GridCtx => ({ k, state, map, sheet, at: pos, step: steps, last: steps === path.length })
    seen.set(pos.sheet, reveal(sheet, seen.get(pos.sheet) ?? instance.sheets[pos.sheet]?.seen ?? [], pos))
    for (const fn of k.grid.enterHooks()) stop = apply(fn(ctx())) || stop
    // 連接格：換到另一張圖（樓梯、電梯、相通的門），站在那一張接回這一張的格子
    const link = sheet.linkAt(pos.x, pos.y)
    if (link && !stop) {
      const next = sheetDef(map, link.to)
      const back = (next.links ?? []).find((l) => l.to === pos.sheet)
      const [lx, ly] = link.land ?? back?.at[0] ?? [-1, -1]
      const nextSheet = new Sheet(next, instance.sheets[next.id]?.cells ?? {})
      if (!nextSheet.walkable(lx, ly)) throw new Error(`地圖 ${map.id}：${pos.sheet} 接到 ${link.to} 的連接格站不上去`)
      lines.push(`到了${next.name}。`)
      sheet = nextSheet
      pos = { map: pos.map, sheet: next.id, x: lx, y: ly }
      seen.set(pos.sheet, reveal(sheet, instance.sheets[pos.sheet]?.seen ?? [], pos))
      stop = true
    }
    const marker = sheet.markerAt(pos.x, pos.y) ?? (sheet.spotAt(pos.x, pos.y) ? { id: sheet.spotAt(pos.x, pos.y)!.id, at: [pos.x, pos.y] as [number, number], mark: '!', name: '遭遇點' } : undefined)
    if (marker && !instance.sheets[pos.sheet]?.cells[pointKey(pos.x, pos.y)]?.used) for (const fn of k.grid.markTriggers(marker.mark)) stop = apply(fn(ctx(), marker)) || stop
    if (stop) break
  }
  for (const [id, rows] of seen) changes.unshift({ op: 'map.sheet', map: pos.map, sheet: id, seen: rows })
  changes.push({ op: 'map.at', to: pos })
  const summary = `走了 ${steps} 格。${lines.join('')}`
  return {
    draft: {
      kind: 'action', action: 'grid.move', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes, outcome: { result: 'moved', summary },
      ...(launch.length ? { launch: clone(launch) } : {}), ...(triggers.length ? { triggers: clone(triggers) } : {}),
    },
    followUps,
    ...(battle ? { battle } : {}),
  }
}
