// L6 功能 scene 的舊名字外觀：sceneOf 回傳的東西。
//
// 存在狀態裡的場景是第二版（model.ts 的 SceneRaw：座位、配對、角色的 id）。M2、M3 的測試與介面的測試直接讀寫「一對一」的舊形狀
//（s.ap.pc、s.turn === 'partner'、s.links[0].by、s.roles、s.fit……），所以 sceneOf 包一層外觀：第二版的欄位全部都在（seats、pairs、kind、layer、v……），
// 一對一的舊名字另外讀得到、寫得進去（寫的會落在座位與配對上）。舊名字裡的人是 'pc'（第一個座位）與 'partner'（第二個座位）。
// 衝突的四個欄位（turn、roles、links 的 by／to、lines 的 who）在外觀裡是舊的樣子；要拿第二版的原樣（角色的 id）讀 state.ext.scene，或用 sceneRawOf。
// 引擎內部（Play、報告、畫面資料）一律用第二版，不經過這一層。

import type { ActorId, GameState, SyncGear } from '../../core'
import type { LinkRec, SceneLine, SceneRaw, Seat, Who } from './model'
import { sceneRawOf } from './model'

/** 一對一的舊名字：第二個座位叫 partner。 */
export interface LegacyView {
  partner: ActorId
  fit: number
  init: number
  first_person: boolean
  ap: Record<Who, number>
  gear: Record<Who, SyncGear>
  max_gear: Record<Who, SyncGear>
  shifted: Record<Who, boolean>
  sink_gain: Record<Who, number>
  climax: Record<Who, number>
  received: Record<Who, number>
  teased: Record<Who, boolean>
  restrained: Record<Who, boolean>
}

/** sceneOf 回傳的樣子：第二版加舊名字。turn、roles、links、lines 裡的人在一對一時是 'pc' 或 'partner'。 */
export type SceneState = SceneRaw & LegacyView

const WHO: readonly Who[] = ['pc', 'partner']
const isWho = (v: unknown): v is Who => v === 'pc' || v === 'partner'
const SEAT_KEYS = ['ap', 'gear', 'max_gear', 'shifted', 'sink_gain', 'climax', 'received', 'teased', 'restrained'] as const satisfies readonly (keyof Seat)[]
type SeatKey = (typeof SEAT_KEYS)[number]
const isSeatKey = (v: unknown): v is SeatKey => (SEAT_KEYS as readonly unknown[]).includes(v)
/** 外觀多出來的鍵（第二版沒有的）；ownKeys 要把它們列出來，clone、JSON 才看得到 */
const ALIASES = ['partner', 'fit', 'init', 'first_person', ...SEAT_KEYS] as const

/** 一個座位欄位的 { pc, partner } 外觀：讀寫都落在座位上。 */
function seatRecord(raw: SceneRaw, key: SeatKey): Record<Who, unknown> {
  const seatOf = (w: Who): Seat | undefined => raw.seats[w === 'pc' ? 0 : 1]
  return new Proxy({} as Record<Who, unknown>, {
    get: (_t, w) => (isWho(w) ? seatOf(w)?.[key] : undefined),
    set: (_t, w, v) => {
      const seat = isWho(w) ? seatOf(w) : undefined
      if (!seat) return false
      ;(seat as unknown as Record<string, unknown>)[key] = v
      return true
    },
    has: (_t, w) => isWho(w) && !!seatOf(w),
    deleteProperty: (_t, w) => {
      const seat = isWho(w) ? seatOf(w) : undefined
      if (seat) delete (seat as unknown as Record<string, unknown>)[key]
      return true
    },
    ownKeys: () => WHO.filter((w) => !!seatOf(w)),
    getOwnPropertyDescriptor: (_t, w) => (isWho(w) && seatOf(w) ? { value: seatOf(w)![key], enumerable: true, configurable: true, writable: true } : undefined),
  })
}

export function sceneFacade(raw: SceneRaw): SceneState {
  const partnerId = (): ActorId => raw.seats[1]?.id ?? ''
  const pairOf = (): SceneRaw['pairs'][string] | undefined => raw.pairs[partnerId()]
  const tokenOf = (id: ActorId): Who => (id === raw.pc ? 'pc' : 'partner')
  const idOf = (v: unknown): ActorId => (v === 'pc' ? raw.pc : v === 'partner' ? partnerId() : typeof v === 'string' ? v : '')
  const rolesView = (): Record<string, string> => ({ pc: raw.roles[raw.pc] ?? '', partner: raw.roles[partnerId()] ?? '' })
  const linkView = (l: LinkRec): LinkRec => new Proxy(l, {
    get: (t, p) => (p === 'by' ? tokenOf(t.by) : p === 'to' ? tokenOf(t.to) : (t as unknown as Record<string | symbol, unknown>)[p]),
    set: (t, p, v) => {
      ;(t as unknown as Record<string | symbol, unknown>)[p] = p === 'by' || p === 'to' ? idOf(v) : v
      return true
    },
  })
  const linesView = (): SceneLine[] => raw.lines.map((l) => ({ ...l, who: tokenOf(l.who) }))
  const get = (p: string | symbol): unknown => {
    switch (p) {
      case 'turn': return tokenOf(raw.turn)
      case 'roles': return rolesView()
      case 'links': return raw.links.map(linkView)
      case 'lines': return linesView()
      case 'partner': return partnerId()
      case 'fit': return pairOf()?.fit
      case 'init': return pairOf()?.init
      case 'first_person': return pairOf()?.first === true
      default:
        if (isSeatKey(p)) return seatRecord(raw, p)
        return (raw as unknown as Record<string | symbol, unknown>)[p]
    }
  }
  return new Proxy(raw, {
    get: (_t, p) => get(p),
    set: (t, p, v) => {
      if (p === 'turn') t.turn = idOf(v)
      else if (p === 'roles') {
        const r = (v ?? {}) as Record<string, string>
        t.roles = { [t.pc]: r.pc ?? '', [partnerId()]: r.partner ?? '' }
      } else if (p === 'fit' || p === 'init') {
        const pair = pairOf()
        if (pair) pair[p] = v as number
      } else if (p === 'first_person') {
        const pair = pairOf()
        if (pair) pair.first = v === true
      } else if (isSeatKey(p)) {
        for (const w of WHO) {
          const seat = t.seats[w === 'pc' ? 0 : 1]
          if (seat && v && typeof v === 'object') (seat as unknown as Record<string, unknown>)[p] = (v as Record<string, unknown>)[w]
        }
      } else if (p === 'partner') {
        /* 對象是第二個座位，不能改 */
      } else (t as unknown as Record<string | symbol, unknown>)[p] = v
      return true
    },
    deleteProperty: (t, p) => {
      if (isSeatKey(p)) for (const seat of t.seats) delete (seat as unknown as Record<string, unknown>)[p]
      else delete (t as unknown as Record<string | symbol, unknown>)[p]
      return true
    },
    has: (t, p) => (typeof p === 'string' && (ALIASES as readonly string[]).includes(p)) || p in t,
    ownKeys: (t) => [...new Set([...Reflect.ownKeys(t), ...ALIASES])],
    getOwnPropertyDescriptor: (t, p) => {
      if (typeof p === 'string' && (ALIASES as readonly string[]).includes(p)) return { value: get(p), enumerable: true, configurable: true, writable: true }
      const d = Reflect.getOwnPropertyDescriptor(t, p)
      return d ? { ...d, value: get(p) } : d
    },
  }) as SceneState
}

/** 進行中的場景（舊名字外觀；沒有場景是 null）。引擎內部用 sceneRawOf（第二版的原樣）。 */
export function sceneOf(state: Pick<GameState, 'ext'>): SceneState | null {
  const raw = sceneRawOf(state)
  return raw ? sceneFacade(raw) : null
}
