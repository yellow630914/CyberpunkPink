// L6 功能：探索的走路規則（SITES 12.5 節：監視器、被看到、巡邏、門鎖、用哪個遭遇點、增援）。
// 掛在 k.grid.onEnter（每走進一格）與 passRule('door_locked')；開戰的設定由這裡組出來，外殼照它開戰。
//
// 一段路好幾格時，掛點每一格各呼叫一次，而讀到的 state 都是這一段路開始之前的：所以這一段路累積的東西
// （警戒、巡邏的人走到哪、ext 的新值）記在 Walk 裡，每一格都回傳「到這一格為止」的完整值（後面的變更蓋過前面的）。
// 「被看到」的算法：每個保全只算一次（ext.seen_by）。開打的規則下，從看不到變成看得到的那一步才算（人走進視線、或巡邏的保全走進視線），
// 一開始就在視線裡的記成「已經注意到你」、不開打；潛行的規則下一看到就算。走進保全站的那一格一定算。

import type { BattleSetup, Change, GameState, GridCtx, GridEffect, GridKernel, MarkerDef, SpotDef, UnitRef } from '../../core'
import { clone, meterOf, pointKey } from '../../core'
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
  /** 人上一格在哪 */
  prev: Pt
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

/** 安裝走路的規則。每個 kernel 一份狀態（這一段路的累積）。 */
export function installWalk(k: GridKernel, owner: string): void {
  let walk: Walk | null = null

  k.grid.onEnter(owner, (ctx): GridEffect | void => {
    const inst = ctx.state.maps.instances[ctx.at.map]
    if (!inst) return
    const sheetState = inst.sheets[ctx.at.sheet]
    if (ctx.step <= 1 || !walk || walk.state !== ctx.state || walk.map !== ctx.at.map || walk.sheet !== ctx.at.sheet) {
      const movers: Record<string, Mover> = {}
      for (const [id, raw] of Object.entries(sheetState?.movers ?? {})) {
        const m = moverOf(raw)
        if (m) movers[id] = m
      }
      const start = ctx.state.maps.at
      walk = {
        state: ctx.state, map: ctx.at.map, sheet: ctx.at.sheet, prev: start ? [start.x, start.y] : [ctx.at.x, ctx.at.y],
        ext: clone(extOf(ctx.state, ctx.at.map)), movers, base: meterOf(k, ctx.state, 'alert', ctx.at.map), gained: 0, watched: false,
      }
    }
    const w = walk
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
      w.prev = me
      const changes = flush()
      return changes.length || lines.length ? { ...(changes.length ? { changes } : {}), ...(lines.length ? { line: lines.join('') } : {}) } : undefined
    }

    // 站上上鎖的門（鑰匙或接管讓它放行）：門改成開的
    if (sheet.kindAt(me[0], me[1]) === 'door_locked') cells[pointKey(me[0], me[1])] = { kind: 'door' }

    // 1 監視器：走進有 S 的區塊，而那一區沒被接管，每走一格警戒 +2
    const zone = sheet.zoneAt(me[0], me[1])
    if (zone !== undefined && !isControlled(w.ext, ctx.at.sheet, zone) && (sheet.def.cells ?? []).some((m) => m.mark === 'S' && sheet.zoneAt(m.at[0], m.at[1]) === zone)) {
      addAlert(SURVEILLANCE_ALERT)
      if (!w.watched) lines.push('監視器拍到你了。')
      w.watched = true
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
      w.prev = me
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
    const before = new Map<string, Pt>()
    for (const g of guards) {
      if (!g.patrol) continue
      const cur = w.movers[g.marker.id] ?? startMover(sheet, g.marker.at, g.patrol)
      before.set(g.marker.id, cur.at)
      const next = stepMover(sheet, g.patrol, cur)
      w.movers[g.marker.id] = next
      movedNow[g.marker.id] = next
    }

    // 4 保全走到你這一格、或你走進（或他走進）他的視線。
    // 開打的規則下，這一步開始時就已經在他視線裡的不算被看到（記成他已經注意到你，不開打）：一進圖就在視線裡不會立刻被圍，
    // 也不會每離開再走回來就再打一次。潛行的規則下看到就算（每個保全只算一次）。
    for (const g of guards) {
      const at = posOf(g)
      let hit = samePt(at, me)
      if (!hit && sees(sheet, at, me) && !noticed(g)) {
        if (w.ext.stealth !== true && sees(sheet, before.get(g.marker.id) ?? at, w.prev)) markNoticed(g)
        else hit = true
      }
      if (!hit) continue
      const fight = spotted(g, at)
      if (fight) return fight
    }
    return done()
  })

  // 上鎖的門（%）：拿到憑證（K）或那一區被接管就放行（走過去時門改成開的）；否則擋下，原因寫出辦法
  k.grid.passRule('door_locked', owner, (ctx, x, y) => {
    const ext = extOf(ctx.state, ctx.at.map)
    if (hasKey(ext) || isControlled(ext, ctx.at.sheet, ctx.sheet.zoneAt(x, y))) return null
    return '門鎖著。兩種辦法：一是拿到憑證（找憑證點），或接管這一區的控制面板，門就會放行；二是動手，撬鎖（機械，失敗警戒 +5）或破門（運動，不論成敗警戒 +10）。'
  })
}
