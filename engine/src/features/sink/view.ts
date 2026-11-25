// L6 功能 sink 給畫面的讀法：sinkView。畫面不自己算分段、下限的組成、別人看到的沉溺。

import type { ActorId, GameState, Kernel, PassiveEntry, RollPart } from '../../core'
import { bandOf, liveMods, nextBandOf, nowOf, readExt, sinkRules, sleepKey, weekOf, SHOWN_STAT, SUNK_AT } from './model'
import type { FloorMod } from './model'

export interface BandView {
  id: string
  name: string
  min: number
}

export interface SinkView {
  actor: ActorId
  /** 真正的沉溺 */
  value: number
  /** 現在的下限，與它是怎麼組成的（義體的成本、暫時的加減……） */
  floor: number
  floorParts: RollPart[]
  /** 沒過期的下限加減 */
  floorMods: FloorMod[]
  /** 真正落在哪一段，與下一段（沒有更高的是 null） */
  band: BandView
  next: BandView | null
  /** 這一段與前面每一段給的得失（來源 sink，不含下限的加減） */
  effects: PassiveEntry[]
  /** 別人看到的沉溺與它落在哪一段（藥、調校、面具讓它比真正的低） */
  shown: number
  shownBand: BandView
  /** 是不是溺感者（沉溺 100 以上） */
  sunk: boolean
  /** 這一週睡了幾次、第幾週、下個週一要睡滿幾次才會自然下降；下個週一會不會降（沉溺不到 100 而且睡夠了） */
  week: number
  sleeps: number
  sleepsNeeded: number
  decaysNextMonday: boolean
  /** 心理治療這一週做了幾次、每週最多幾次 */
  counselUsed: number
  counselPerWeek: number
  /** 餘韻一直帶著的起點（總分鐘）；沒有是 null */
  carryFrom: number | null
}

const bandView = (b: { id: string; name: string; min: number }): BandView => ({ id: b.id, name: b.name, min: b.min })

/** 一個人的沉溺現在是什麼樣；角色不存在是 null。 */
export function sinkView(k: Kernel, state: GameState, actor: ActorId): SinkView | null {
  const a = state.actors[actor]
  if (!a) return null
  const rules = sinkRules(k)
  const ext = readExt(state, actor)
  const now = nowOf(state)
  const week = weekOf(k, now)
  const sleeps = state.counters[sleepKey(week)] ?? 0
  const hasFloor = k.stats.hasStat('sink_floor')
  const shown = k.stats.hasStat(SHOWN_STAT) ? k.stats.stat(state, actor, SHOWN_STAT) : a.sink
  return {
    actor, value: a.sink,
    floor: hasFloor ? k.stats.stat(state, actor, 'sink_floor') : 0,
    floorParts: hasFloor ? k.stats.statParts(state, actor, 'sink_floor') : [],
    floorMods: liveMods(ext, now),
    band: bandView(bandOf(rules, a.sink)), next: ((n) => (n ? bandView(n) : null))(nextBandOf(rules, a.sink)),
    effects: k.passives.of(state, actor).filter((e) => e.source === 'sink' && !('stat' in e && e.stat === 'sink_floor')),
    shown, shownBand: bandView(bandOf(rules, shown)),
    sunk: a.sink >= SUNK_AT,
    week, sleeps, sleepsNeeded: rules.decay.sleeps,
    decaysNextMonday: a.sink < SUNK_AT && sleeps >= rules.decay.sleeps && rules.decay.amount > 0,
    counselUsed: ext.therapy_week === week ? ext.therapy_n ?? 1 : 0, counselPerWeek: rules.therapy.counsel.per_week,
    carryFrom: ext.carry_from ?? null,
  }
}
