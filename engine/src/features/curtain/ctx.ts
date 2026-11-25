// L6 功能 curtain 的「現在站在哪」：這一趟、這一幕、地圖實例的 ext.net（只讀格式）、節點的角色。
// 節點的角色（netrun 的密度是整區一份，每一幕放的標記一樣；這個功能照那一幕的 ActDef 決定它們各是什麼）：
//   f 遭遇（含守閘門的那一場）  p 點單（沒有點單的幕：獎品室或什麼都沒有）  a 賞箱  c 契約的條文  b 後台的近道（只有寫了 shortcut 的幕；別的幕什麼都沒有）

import type { GameState, GridCtx, Kernel, MarkerDef, Sheet, UnitRef } from '../../core'
import { gridHere, isRecord, pointKey } from '../../core'
import type { ActDef, CurtainRules, CurtainState, NightEntry, RunRecord, TierDef } from './model'
import { NIGHT_KIND, REGION_ID, curtainRules, isInt, readCurtain, tierOf } from './model'

/** 地圖實例的 ext.net 裡這個功能讀的那幾塊（netrun 寫、只讀格式）。 */
export interface NetView {
  region: string
  grade: number
  dc: number
  graph: Record<string, unknown>
  foes: Record<string, Record<string, { foes: UnitRef[]; gate?: boolean; done?: boolean }>>
}

/** 這份地圖實例是簾後館開的（ext.net.region 是 curtain）。 */
export function netOf(state: GameState, map: string): NetView | null {
  const net = state.maps.instances[map]?.ext?.net
  if (!isRecord(net) || net.region !== REGION_ID || !isRecord(net.graph) || !isRecord(net.foes)) return null
  return { region: net.region, grade: isInt(net.grade) ? net.grade : 1, dc: typeof net.dc === 'number' ? net.dc : 10, graph: net.graph, foes: net.foes as NetView['foes'] }
}

export type NodeRole = 'fight' | 'order' | 'prize_room' | 'chest' | 'clause' | 'shortcut' | 'none'

/** 一幕的定義：資料的 act_defs（含加演的幕）；加演的幕資料沒寫就照一般的一幕（2 場遭遇、1 個點單、賞箱 1～2）。 */
export function defOf(rules: CurtainRules, act: number): ActDef {
  const base = rules.act_defs[act]
  if (base) return base
  const encore = act - rules.act_defs.length
  const last = encore >= rules.encore.names.length - 1
  return { id: `encore${encore + 1}`, name: rules.encore.names[encore] ?? `加演・第 ${act + 1} 幕`, encounters: [2, 2], orders: [1, 1], chests: [1, 2], turns: 15, boss: last ? 'host' : 'director' }
}

/** 加演的幕在整趟裡是第幾幕：基本的四幕之後。 */
export const encoreBase = (rules: CurtainRules): number => rules.act_defs.length

/** 一個標記在這一幕裡的角色。 */
export function roleOf(def: ActDef, marker: Pick<MarkerDef, 'mark'>): NodeRole {
  switch (marker.mark) {
    case 'f': return 'fight'
    case 'a': return 'chest'
    case 'c': return 'clause'
    case 'p': return def.orders[1] > 0 ? 'order' : def.prize_room ? 'prize_room' : 'none'
    case 'b': return def.shortcut ? 'shortcut' : 'none'
    default: return 'none'
  }
}

export interface Ctx {
  k: Kernel
  state: GameState
  cur: CurtainState
  run: RunRecord
  rules: CurtainRules
  tier: TierDef
  night: NightEntry
  g: NonNullable<ReturnType<typeof gridHere>> & GridCtx
  map: string
  sheetId: string
  net: NetView
  /** 這一趟裡的第幾層（從 0 起算） */
  layer: number
  /** 整趟的第幾幕（加演的一趟從基本的幾幕之後算起） */
  act: number
  def: ActDef
}

/** 現在站的位置：這一趟進行中（沒有結算完）、人站在簾後館的地圖上；不是是 null。 */
export function ctxOf(k: Kernel, state: GameState): Ctx | null {
  const cur = readCurtain(state)
  const run = cur.run
  if (!run || run.over) return null
  const g = gridHere(k, state)
  if (!g) return null
  const net = netOf(state, g.at.map)
  if (!net) return null
  const rules = curtainRules(k)
  const tier = tierOf(rules, run.tier)
  const night = k.content.get<NightEntry>(NIGHT_KIND, run.night)
  if (!tier || !night) return null
  const layer = Math.max(0, Object.keys(net.graph).indexOf(g.at.sheet))
  const act = (run.encore ? encoreBase(rules) : 0) + layer
  return { k, state, cur, run, rules, tier, night, g: g as Ctx['g'], map: g.at.map, sheetId: g.at.sheet, net, layer, act, def: defOf(rules, act) }
}

/** 這一格處理過了（打開過、做過、解決了）。 */
export const usedAt = (c: Pick<Ctx, 'g'>, marker: Pick<MarkerDef, 'at'>): boolean => c.g.sheetState.cells[pointKey(marker.at[0], marker.at[1])]?.used === true

/** 地圖上的標記（這一層）。 */
export const markersOf = (sheet: Sheet): MarkerDef[] => sheet.def.cells ?? []

/** 離這一格一步的標記（上下左右）。 */
export function neighbours(c: Pick<Ctx, 'g'>): MarkerDef[] {
  const out: MarkerDef[] = []
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const m = c.g.sheet.markerAt(c.g.at.x + dx, c.g.at.y + dy)
    if (m) out.push(m)
  }
  return out
}

/** 站在這一格上的標記。 */
export const standingOn = (c: Pick<Ctx, 'g'>): MarkerDef | undefined => c.g.sheet.markerAt(c.g.at.x, c.g.at.y)

/** 把這一格記成處理過（打開過、做過）。 */
export const usedCell = (c: Pick<Ctx, 'map' | 'sheetId'>, marker: Pick<MarkerDef, 'at'>, floor = false): { op: string; map: string; sheet: string; cells: Record<string, unknown> } => ({
  op: 'map.sheet', map: c.map, sheet: c.sheetId, cells: { [pointKey(marker.at[0], marker.at[1])]: { ...(floor ? { kind: 'floor' } : {}), used: true } },
})
