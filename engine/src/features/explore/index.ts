// L6 功能：探索（COMBAT_SYSTEM 第 10 節「探索用格子，走到敵人那一格就開打」；COMMISSION_MAPS 1.3、1.5 節；SITES 12.5 節「用哪個遭遇點」；dev/work/M1-explore.md）。
//
// 在格子地圖上走到保全崗（標記 G）那一格就開打：用保全崗所在那一區的遭遇點決定遮蔽與場地效果；打贏了那個保全崗清掉；
// 站在撤離點（X）可以離開。保全崗放誰由發起的功能用 placeGuards 寫在這份實例上，這個功能不知道敵人的資料。
// 監視器、巡邏、門鎖、資料埠、憑證、警戒是 M2。

import type { BattleSetup, Change, Feature, GameState, GridKernel, MarkerDef, ReportDraft, Sheet, SpotDef, UnitRef } from '../../core'
import { clone, closeMap, gridHere, pointKey } from '../../core'

const OWNER = 'explore'

export interface GuardPost {
  foes: UnitRef[]
  /** 贏的那一方的勢力（戰敗事件用） */
  faction?: string
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 把每個保全崗放誰寫在這份地圖的實例上。回傳變更（呼叫的人放進自己的報告）。鍵是標記的 id（G1、G2）。 */
export function placeGuards(state: GameState, mapInstanceId: string, guards: Record<string, GuardPost>): Change[] {
  const instance = state.maps.instances[mapInstanceId]
  if (!instance) throw new Error(`沒有 ${mapInstanceId} 這份地圖`)
  return [{ op: 'map.ext', map: mapInstanceId, value: { ...clone(instance.ext ?? {}), guards: clone(guards) } }]
}

function guardOf(ext: Record<string, unknown> | undefined, id: string): GuardPost | undefined {
  const g = isRec(ext?.guards) ? ext.guards[id] : undefined
  return isRec(g) && Array.isArray(g.foes) ? (g as unknown as GuardPost) : undefined
}

/** 走路的距離；走不到是無限大。 */
function distance(sheet: Sheet, from: [number, number], to: [number, number]): number {
  const path = sheet.findPath({ x: from[0], y: from[1] }, { x: to[0], y: to[1] })
  return path ? path.length : Infinity
}

/** 用哪個遭遇點：同一區的，走路最近的（一樣近取前面的、走不到的排最後）；同一區沒有時用整張圖走路最近的；都沒有是 undefined。 */
function pickSpot(sheet: Sheet, post: [number, number]): SpotDef | undefined {
  const spots = sheet.def.spots ?? []
  const zone = sheet.zoneAt(post[0], post[1])
  const nearest = (list: SpotDef[]): SpotDef | undefined => {
    let best: SpotDef | undefined
    let bestD = Infinity
    for (const s of list) {
      const d = distance(sheet, post, s.at)
      if (!best || d < bestD) { best = s; bestD = d }
    }
    return best
  }
  const same = zone === undefined ? [] : spots.filter((s) => sheet.zoneAt(s.at[0], s.at[1]) === zone)
  return nearest(same.length ? same : spots)
}

function enterGuard(ctx: Parameters<Parameters<GridKernel['grid']['onMark']>[2]>[0], marker: MarkerDef) {
  const here = gridHere(ctx.k, ctx.state)
  const instance = ctx.state.maps.instances[ctx.at.map]
  const guard = guardOf(instance?.ext, marker.id)
  if (!guard) return
  const used = (instance?.sheets[ctx.at.sheet]?.cells[pointKey(ctx.at.x, ctx.at.y)] ?? here?.sheetState.cells[pointKey(ctx.at.x, ctx.at.y)])?.used
  if (used) return
  const spot = pickSpot(ctx.sheet, [ctx.at.x, ctx.at.y])
  const battle: BattleSetup = {
    mode: 'meat',
    allies: ctx.state.party.map((id) => ({ from: 'actor', id })),
    foes: clone(guard.foes),
    cover: clone(spot?.cover ?? 'medium'),
    field: Object.fromEntries((spot?.field ?? []).map((f) => [f, true])),
    origin: {
      escapable: true,
      place: marker.name,
      ...(guard.faction !== undefined ? { faction: guard.faction } : {}),
      ext: { map: ctx.at.map, sheet: ctx.at.sheet, guard: marker.id, ...(spot ? { spot: spot.id } : {}), at: [ctx.at.x, ctx.at.y] },
    },
  }
  return { stop: true, battle }
}

/** 這一格能做的事的 id。 */
const LEAVE = 'leave'

export const exploreFeature: Feature & { useHere(k: GridKernel, state: GameState, id: string): ReportDraft } = {
  id: OWNER,
  install(k) {
    k.grid.onMark('G', OWNER, enterGuard)

    k.battle.onEnd(OWNER, ({ state, battle, outcome }) => {
      const ext = battle.origin.ext
      if (outcome !== 'win' || !ext || typeof ext.guard !== 'string') return
      const map = ext.map
      const sheet = ext.sheet
      const at = ext.at
      if (typeof map !== 'string' || typeof sheet !== 'string' || !Array.isArray(at)) return
      if (!state.maps.instances[map]) return
      return { changes: [{ op: 'map.sheet', map, sheet, cells: { [pointKey(Number(at[0]), Number(at[1]))]: { used: true } } }] }
    })

    k.grid.usesOf(OWNER, (_ctx, marker) => (marker.mark === 'X' ? [{ id: LEAVE, name: '離開', block: null }] : []))
  },

  useHere(k, state, id) {
    if (id !== LEAVE) throw new Error(`這一格沒有「${id}」可以做。`)
    const here = gridHere(k, state)
    const marker = here?.sheet.markerAt(here.at.x, here.at.y)
    if (!here || !marker || marker.mark !== 'X') throw new Error('這一格不是撤離點，不能離開。')
    return {
      kind: 'action', action: 'grid.leave', location: clone(state.location), party: [], timeline: [],
      changes: closeMap(state, here.instance.id),
      outcome: { result: 'left', summary: `你從${marker.name}離開。` },
    }
  },
}
