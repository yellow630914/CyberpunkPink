// L6 功能 contract 給畫面與別人讀的：契約人這一面的面板（boundView）、掃橋讀到的契約（scanAnswer）。都是唯讀的純函式。

import type { ActorId, GameState, Kernel } from '../../core'
import { contentAllowed } from '../../core'
import { resistPlan } from './draft'
import type { Contract, ContractRule, Holder, OrderKind, OrderState, Place, Relation, Right } from './model'
import {
  DOCILITY_STAT, ORDER_KINDS, ORDER_NAME, ORDER_STATE_NAME, RELATION_NAME, TYPE_NAME, activeCount, dailyChance, extOf, forceable, isActive, meterNow, nowOf, pcOf, placeName, scopeData,
} from './model'
import { payoffQuote } from './play'
import type { PayoffQuote } from './play'
import { overdueOptions } from './time'

export interface OrderView {
  id: string
  kind: OrderKind
  name: string
  state: OrderState
  state_name: string
  asked: boolean
  issued: number
  deadline: number
  /** 離期限還有幾分鐘（過了是負的；已經了結的沒有） */
  minutes_left: number | null
  place?: Place
  place_name?: string
  arrived: boolean
  /** 逾期會怎樣（只有還沒了結的）：強制的列現在抽得到的處置，送達與照做中的是作廢 */
  on_overdue?: string[]
  /** 抗拒的 DC 與成功率（只有 sent 的） */
  resist?: { dc: number; breakdown: Array<{ label: string; value: number }>; chance: number; forceable: boolean }
}

export interface BoundView {
  id: string
  holder: Holder
  type: Contract['type']
  type_name: string
  /** 紙上七格（六種指令；規矩不進佇列）有沒有勾 */
  orders: Array<{ kind: OrderKind; name: string; ticked: boolean }>
  relation: Relation
  relation_name: string
  rules: ContractRule[]
  satisfaction: number
  /** 馴化的有效值 */
  docility: number
  complied: number
  debt?: number
  until?: number
  report_weekday?: number
  mark: { covered: boolean }
  queue: OrderView[]
  queue_max: number
  /** 每天 08:00 下新指令的機率（0～1；佇列滿了不擲） */
  daily_chance: number
  payoff: PayoffQuote | null
  rights: Right[]
}

/** 契約人這一面的面板；沒有契約是 null。 */
export function boundView(k: Kernel, state: GameState): BoundView | null {
  const pc = pcOf(state)
  const ext = extOf(state)
  const c = ext.mine
  if (!pc || !c) return null
  const unwilling = contentAllowed(state.rules, 'pc_unwilling')
  const options = overdueOptions(k, state, pc, c).filter((o) => o.available).map((o) => o.name)
  const now = nowOf(state)
  const queue = c.queue.map((o): OrderView => {
    const live = isActive(o)
    const plan = o.state === 'sent' ? resistPlan(k, state, pc, c) : undefined
    return {
      id: o.id, kind: o.kind, name: ORDER_NAME[o.kind], state: o.state, state_name: ORDER_STATE_NAME[o.state], asked: o.asked === true, issued: o.issued, deadline: o.deadline,
      minutes_left: live ? o.deadline - now : null, ...(o.place ? { place: o.place, place_name: placeName(k, o.place) } : {}), arrived: o.arrived === true,
      ...(live ? { on_overdue: o.state === 'forced' ? (options.length > 0 ? options : ['滿意下降']) : ['作廢，滿意下降'] } : {}),
      ...(plan ? { resist: { dc: plan.dc, breakdown: plan.breakdown, chance: plan.chance, forceable: forceable(o.kind, unwilling) } } : {}),
    }
  })
  return {
    id: c.id, holder: c.holder, type: c.type, type_name: TYPE_NAME[c.type],
    orders: ORDER_KINDS.map((kind) => ({ kind, name: ORDER_NAME[kind], ticked: c.orders.includes(kind) })),
    relation: c.relation, relation_name: RELATION_NAME[c.relation], rules: c.rules, satisfaction: meterNow(k, state), docility: k.stats.hasStat(DOCILITY_STAT) ? k.stats.stat(state, pc, DOCILITY_STAT) : 0,
    complied: c.complied, ...(c.debt !== undefined ? { debt: c.debt } : {}), ...(c.until !== undefined ? { until: c.until } : {}), ...(c.report_weekday !== undefined ? { report_weekday: c.report_weekday } : {}),
    mark: c.mark, queue, queue_max: scopeData(k).queue_max, daily_chance: activeCount(c) >= scopeData(k).queue_max ? 0 : dailyChance(k, c, meterNow(k, state)),
    payoff: payoffQuote(k, state), rights: ext.rights,
  }
}

export interface ScanContract {
  /** 管理級（契約）、限制級、讀取級 */
  level: 'manage' | 'limit' | 'read'
  holder: Holder
  type?: Contract['type']
  source?: string
}

/**
 * 掃橋讀到的契約（掛點 scan.person 的 contract；M4-security-m4 把它接上）：主角身上的管理級契約，加上記著的讀取與限制級；
 * 後頸的光紋 marked 是「看得到」（遮著的不算，別人細看要另外過檢定）。別人（NPC）的契約這一張不管。沒有任何一筆是 undefined。
 */
export function scanAnswer(state: GameState, actor: ActorId): { contract: { rights: ScanContract[]; marked: boolean; covered: boolean } } | undefined {
  if (actor !== state.pc) return undefined
  const ext = extOf(state)
  const rights: ScanContract[] = []
  if (ext.mine) rights.push({ level: 'manage', holder: ext.mine.holder, type: ext.mine.type })
  for (const r of ext.rights) rights.push({ level: r.level, holder: r.holder, source: r.source })
  if (rights.length === 0) return undefined
  const covered = ext.mine?.mark.covered === true
  return { contract: { rights, marked: !!ext.mine && !covered, covered } }
}

