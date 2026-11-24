// L6 功能：探索的走路規則（SITES 12.5 節：監視器、被看到、巡邏、門鎖、用哪個遭遇點、增援）。
// 掛在 k.grid.onEnter（每走進一格）與 passRule('door_locked')；開戰的設定由這裡組出來，外殼照它開戰。
//
// 一段路好幾格時，掛點每一格各呼叫一次，而讀到的 state 都是這一段路開始之前的：所以這一段路累積的東西
// （警戒、巡邏的人走到哪、ext 的新值）記在 Walk 裡，每一格都回傳「到這一格為止」的完整值（後面的變更蓋過前面的）。
// 「被看到」的算法（SITES 12.5 節，照字面）：一步結束時有保全站在同一個區塊、中間沒有牆就算；每個保全只算一次（ext.seen_by）；
// 潛行時警戒 +5、不開打；走進保全站的那一格一定開打。剛進圖也算一步（arrive）。

import type { BattleSetup, Change, GameState, GridCtx, GridEffect, GridKernel, MarkerDef, ReportDraft, SpotDef, UnitRef } from '../../core'
import { clone, gridHere, isNetMapKind, meterOf, pointKey } from '../../core'
import type { Ext, GuardPost } from './ext'
import { extChange, extOf, guardOf, hasKey, isControlled, isRec, strList } from './ext'
import type { Mover, Patrol, Pt } from './sight'
import { patrolOf, samePt, sees, startMover, stepMover } from './sight'

export const SURVEILLANCE_ALERT = 2
export const SPOTTED_ALERT = 5
export const REINFORCE_AT = 60

const toPt = (m: unknown): Pt | undefined => (Array.isArray(m) && m.length === 2 && m.every((n) => Number.isInteger(n)) ? [m[0] as number, m[1] as number] : undefined)

/** 讀存檔裡一個保全的巡邏狀態；壞掉的當沒有。 */
function moverOf(raw: unknown): Mover | undefined {
  if (!isRec(raw)) return undefined
  const at = toPt(raw.at)
  if (!at || !Number.isInteger(raw.leg)) return undefined
  return { at, leg: raw.leg as number, ...(raw.gone === true ? { gone: true } : {}) }
}

/** 走路的距離；走不到是無限大。 */
function distance(sheet: GridCtx['sheet'], from: Pt, to: Pt): number {
  const path = sheet.findPath({ x: from[0], y: from[1] }, { x: to[0], y: to[1] })
  return path ? path.length : Infinity
}

/**
 * 用哪個遭遇點：ext.spot 指定的（整張地圖找得到的）先；沒有就同一區的、走路最近的（一樣近取前面的、走不到的排最後）；
 * 同一區沒有時用整張圖走路最近的；都沒有是 undefined。
 */
export function pickSpot(ctx: GridCtx, post: Pt, wanted?: string): SpotDef | undefined {
  if (wanted !== undefined) {
    const spec = ctx.map.sheets.flatMap((s) => s.spots ?? []).find((s) => s.id === wanted)
    if (spec) return spec
  }
  const { sheet } = ctx
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

interface Guard {
  marker: MarkerDef
  post: GuardPost
  patrol: Patrol | null
}

interface Walk {
  state: GameState
  map: string
  sheet: string
  ext: Ext
  movers: Record<string, Mover>
  /** 這一段路開始時的警戒 */
  base: number
  /** 這一段路累積加的警戒（還沒套用） */
  gained: number
  /** 監視器的那一句已經寫過了（一段路只寫一次） */
  watched: boolean
}

const alertKey = (map: string) => ({ kind: 'alert', key: map })

/** 這一張圖上放了人、還在的保全崗。 */
function guardsOf(ctx: GridCtx, ext: Ext, movers: Record<string, Mover>): Guard[] {
  const used = ctx.state.maps.instances[ctx.at.map]?.sheets[ctx.at.sheet]?.cells ?? {}
  const out: Guard[] = []
  for (const marker of ctx.sheet.def.cells ?? []) {
    if (marker.mark !== 'G') continue
    const post = guardOf(ext, marker.id)
    if (!post) continue
    const patrol = patrolOf(ctx.sheet, marker.id, marker.at, ext.patrol_half === true)
    if (patrol ? movers[marker.id]?.gone : used[pointKey(marker.at[0], marker.at[1])]?.used) continue
    out.push({ marker, post, patrol })
  }
  return out
}

/** 組開戰的設定：遭遇點、增援、發起的人給的 origin 與 edge。回傳設定；增援用掉了會改 w.ext。 */
function battleFor(ctx: GridCtx, w: Walk, g: Guard, at: Pt, alertNow: number): { battle: BattleSetup; extChanged: boolean } {
  const spot = pickSpot(ctx, at, typeof w.ext.spot === 'string' ? w.ext.spot : undefined)
  const foes: UnitRef[] = clone(g.post.foes)
  let extChanged = false
  const reinforce = Array.isArray(w.ext.reinforce) ? (w.ext.reinforce.filter(isRec) as unknown as UnitRef[]) : []
  if (alertNow >= REINFORCE_AT && w.ext.reinforced !== true && reinforce.length) {
    foes.push(...clone(reinforce))
    w.ext = { ...w.ext, reinforced: true }
    extChanged = true
  }
  const given = isRec(w.ext.origin) ? clone(w.ext.origin) : {}
  const pre = { ...(isRec(given.pre) ? given.pre : {}), spotted: true }
  const battle: BattleSetup = {
    mode: 'meat',
    allies: ctx.state.party.map((id) => ({ from: 'actor', id })),
    foes,
    cover: clone(spot?.cover ?? 'medium'),
    field: Object.fromEntries((spot?.field ?? []).map((f) => [f, true])),
    ...(w.ext.edge === 'ally' || w.ext.edge === 'foe' ? { edge: w.ext.edge } : {}),
    origin: {
      escapable: true,
      place: g.marker.name,
      ...(g.post.faction !== undefined ? { faction: g.post.faction } : {}),
      // 發起的人給的先放，這個功能的鍵（onEnd 清保全崗要用）蓋在上面
      ext: { ...given, map: ctx.at.map, sheet: ctx.at.sheet, guard: g.marker.id, ...(spot ? { spot: spot.id } : {}), at: [at[0], at[1]], ...(g.patrol ? { patrol: true } : {}), pre },
    },
  }
  return { battle, extChanged }
}

function newWalk(k: GridKernel, ctx: GridCtx): Walk {
  const movers: Record<string, Mover> = {}
  for (const [id, raw] of Object.entries(ctx.state.maps.instances[ctx.at.map]?.sheets[ctx.at.sheet]?.movers ?? {})) {
    const m = moverOf(raw)
    if (m) movers[id] = m
  }
  return { state: ctx.state, map: ctx.at.map, sheet: ctx.at.sheet, ext: clone(extOf(ctx.state, ctx.at.map)), movers, base: meterOf(k, ctx.state, 'alert', ctx.at.map), gained: 0, watched: false }
}

/**
 * 一步（或剛到地圖）的結算。arrival 是剛進圖：只看保全看不看得到你（不算監視器、不巡邏、不開門）。
 * 被看到的規則（SITES 12.5 節，照字面）：這一步結束時有保全站在同一個區塊、中間沒有牆，就開他的遭遇；每個保全只算一次（ext.seen_by）；
 * 潛行時改成警戒 +5、不開打；走到保全現在站的那一格一定開打（潛行除外）。
 */
function evaluate(k: GridKernel, ctx: GridCtx, w: Walk, arrival: boolean): GridEffect | void {
  void k
  const me: Pt = [ctx.at.x, ctx.at.y]
  const { sheet } = ctx
  let extDirty = false
  let gainedNow = 0
  const movedNow: Record<string, Mover> = {}
  const cells: Record<string, { kind: string }> = {}
  const lines: string[] = []

  // 這一步的變更（每一種都是「到這一步為止的完整值」或加量，後面的蓋過前面的）
  const flush = (): Change[] => [
    ...(Object.keys(cells).length ? [{ op: 'map.sheet', map: ctx.at.map, sheet: ctx.at.sheet, cells } as Change] : []),
    ...(Object.keys(movedNow).length ? [{ op: 'map.sheet', map: ctx.at.map, sheet: ctx.at.sheet, movers: clone(movedNow) } as Change] : []),
    ...(gainedNow ? [{ op: 'meter', ...alertKey(ctx.at.map), delta: gainedNow } as Change] : []),
    ...(extDirty ? [extChange(ctx.at.map, w.ext)] : []),
  ]
  const addAlert = (n: number): void => { gainedNow += n; w.gained += n }
  const done = (): GridEffect | void => {
    const changes = flush()
    return changes.length || lines.length ? { ...(changes.length ? { changes } : {}), ...(lines.length ? { line: lines.join('') } : {}) } : undefined
  }

  if (!arrival) {
    // 站上上鎖的門（鑰匙或接管讓它放行）：門改成開的
    if (sheet.kindAt(me[0], me[1]) === 'door_locked') cells[pointKey(me[0], me[1])] = { kind: 'door' }

    // 1 監視器：走進有 S 的區塊，而那一區沒被接管，每走一格警戒 +2
    const zone = sheet.zoneAt(me[0], me[1])
    if (zone !== undefined && !isControlled(w.ext, ctx.at.sheet, zone) && (sheet.def.cells ?? []).some((m) => m.mark === 'S' && sheet.zoneAt(m.at[0], m.at[1]) === zone)) {
      addAlert(SURVEILLANCE_ALERT)
      if (!w.watched) lines.push('監視器拍到你了。')
      w.watched = true
    }
  }

  const guards = guardsOf(ctx, w.ext, w.movers)
  const posOf = (g: Guard): Pt => w.movers[g.marker.id]?.at ?? g.marker.at
  const noticed = (g: Guard): boolean => strList(w.ext.seen_by).includes(g.marker.id)
  const markNoticed = (g: Guard): void => {
    w.ext = { ...w.ext, seen_by: [...strList(w.ext.seen_by), g.marker.id] }
    extDirty = true
  }

  /** 被這個保全看到：潛行時警戒 +5（同一個保全只算一次）、不開打；否則開他的遭遇。 */
  const spotted = (g: Guard, at: Pt): GridEffect | undefined => {
    if (w.ext.stealth === true) {
      if (!noticed(g)) {
        markNoticed(g)
        addAlert(SPOTTED_ALERT)
        lines.push(`${g.marker.name}的保全看到你了，警戒上升。`)
      }
      return undefined
    }
    if (!noticed(g)) markNoticed(g)
    const { battle, extChanged } = battleFor(ctx, w, g, at, Math.min(100, w.base + w.gained))
    if (extChanged) extDirty = true
    const changes = flush()
    return { ...(changes.length ? { changes } : {}), battle, stop: true, line: `${lines.join('')}${g.marker.name}的保全發現了你。` }
  }

  // 2 走進保全現在站的那一格
  for (const g of guards) {
    const at = posOf(g)
    if (samePt(at, me)) {
      const fight = spotted(g, at)
      if (fight) return fight
    }
  }

  // 3 巡邏：每走一格，有路線的保全往下一個區塊走一格
  if (!arrival) {
    for (const g of guards) {
      if (!g.patrol) continue
      const next = stepMover(sheet, g.patrol, w.movers[g.marker.id] ?? startMover(sheet, g.marker.at, g.patrol))
      w.movers[g.marker.id] = next
      movedNow[g.marker.id] = next
    }
  }

  // 4 保全走到你這一格，或這一步結束時他看得到你
  for (const g of guards) {
    const at = posOf(g)
    if (!samePt(at, me) && !(sees(sheet, at, me) && !noticed(g))) continue
    const fight = spotted(g, at)
    if (fight) return fight
  }
  return done()
}

/**
 * 剛進圖也算一步：進圖的人（開地圖的功能）在 enterMap 之後問這個，入口那一格已經被保全看到就回傳一份報告
 * （潛行時是警戒 +5；否則帶 launch 開他的遭遇），沒事回傳 null。core 的 openMap 不呼叫掛點，所以要開地圖的人自己呼叫並提交。
 */
export function arrive(k: GridKernel, state: GameState): ReportDraft | null {
  const here = gridHere(k, state)
  if (!here || isNetMapKind(here.map.kind)) return null
  const effect = evaluate(k, here, newWalk(k, here), true)
  if (!effect) return null
  const launch = effect.battle ? [{ kind: 'battle', setup: effect.battle }] : []
  if (!effect.changes?.length && !launch.length) return null
  return {
    kind: 'action', action: 'grid.arrive', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [],
    changes: effect.changes ?? [], outcome: { result: launch.length ? 'spotted' : 'seen', summary: effect.line ?? '' },
    ...(launch.length ? { launch } : {}),
  }
}

/** 安裝走路的規則。每個 kernel 一份狀態（這一段路的累積）。 */
export function installWalk(k: GridKernel, owner: string): void {
  let walk: Walk | null = null

  k.grid.onEnter(owner, (ctx): GridEffect | void => {
    if (isNetMapKind(ctx.map.kind)) return
    if (!ctx.state.maps.instances[ctx.at.map]) return
    if (ctx.step <= 1 || !walk || walk.state !== ctx.state || walk.map !== ctx.at.map || walk.sheet !== ctx.at.sheet) walk = newWalk(k, ctx)
    return evaluate(k, ctx, walk, false)
  })

  // 上鎖的門（%）：拿到憑證（K）或那一區被接管就放行（走過去時門改成開的）；否則擋下，原因寫出辦法
  k.grid.passRule('door_locked', owner, (ctx, x, y) => {
    if (isNetMapKind(ctx.map.kind)) return '這裡不是現實的門。'
    const ext = extOf(ctx.state, ctx.at.map)
    if (hasKey(ext) || isControlled(ext, ctx.at.sheet, ctx.sheet.zoneAt(x, y))) return null
    return '門鎖著。兩種辦法：一是拿到憑證（找憑證點），或接管這一區的控制面板，門就會放行；二是動手，撬鎖（機械，失敗警戒 +5）或破門（運動，不論成敗警戒 +10）。'
  })
}
