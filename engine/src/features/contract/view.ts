// L6 功能 contract 給畫面與別人讀的：契約人這一面的面板（boundView）、掃橋讀到的契約（scanAnswer）。都是唯讀的純函式。

import type { ActorId, GameState, Kernel } from '../../core'
import { contentAllowed } from '../../core'
import { resistPlan } from './draft'
import type { Contract, ContractRule, Holder, OrderKind, OrderState, Place, Relation, Right } from './model'
import {
  DOCILITY_STAT, ORDER_KINDS, ORDER_NAME, ORDER_STATE_NAME, RELATION_NAME, TYPE_NAME, activeCount, dailyChance, extOf, forceable, isActive, meterNow, nowOf, pcOf, placeMatches, placeName, scopeData,
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
  /** 了結的時間（總分鐘；done、resisted、overdue 才有） */
  closed?: number
  /** 逾期了結的那一條的處置：result 是 lapsed／overdue／overdue_lock／overdue_load／overdue_expose，text 是給玩家看的那一句（不用比對報告的正文） */
  outcome?: { result: string; text: string }
  place?: Place
  place_name?: string
  /**
   * 走過去（畫面設目的地用）：還沒了結、還沒到過、有指定地方的指令。district、block 是世界的移動要的目的地；here 是人已經站在那裡（可以直接回報走到了）。
   * 不指定地方的指令沒有這一項。
   */
  goto?: { district?: string; block?: string; facility?: string; name: string; here: boolean }
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
      minutes_left: live ? o.deadline - now : null, ...(o.closed !== undefined ? { closed: o.closed } : {}), ...(o.outcome ? { outcome: { ...o.outcome } } : {}), ...(o.place ? { place: o.place, place_name: placeName(k, o.place) } : {}),
      ...(o.place && live && o.arrived !== true ? { goto: { ...(o.place.district ? { district: o.place.district } : {}), ...(o.place.block ? { block: o.place.block } : {}), ...(o.place.facility ? { facility: o.place.facility } : {}), name: placeName(k, o.place), here: placeMatches(k, state, o.place) } } : {}),
      arrived: o.arrived === true,
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

export interface ScanAnswer {
  contract: {
    rights: ScanContract[]
    marked: boolean
    covered: boolean
    /** 身上有管理級契約時才有：身分是契約人、持約人是誰、哪一級 */
    class?: 'bound'
    holder?: string
    level?: 'manage'
  }
}

/**
 * 掃橋讀到的契約：被掃的是主角時，主角身上的管理級契約（契約人）加上記著的讀取與限制級；被掃的是主角持有的人（NPC）時，他的（他是契約人，持約人是主角）。
 * 後頸的光紋 marked 是「看得到」（遮著的不算，別人細看要另外過檢定）。身上有管理級契約的多 class、holder（持約人的名字）、level。沒有任何一筆是 undefined。
 */
export function scanAnswer(state: GameState, actor: ActorId): ScanAnswer | undefined {
  const ext = extOf(state)
  if (actor !== state.pc) {
    const held = Object.hasOwn(ext.held, actor) ? ext.held[actor] : undefined
    if (!held) return undefined
    return { contract: { rights: [{ level: 'manage', holder: held.holder, type: held.type }], marked: !held.mark.covered, covered: held.mark.covered, class: 'bound', holder: held.holder.name, level: 'manage' } }
  }
  const rights: ScanContract[] = []
  if (ext.mine) rights.push({ level: 'manage', holder: ext.mine.holder, type: ext.mine.type })
  for (const r of ext.rights) rights.push({ level: r.level, holder: r.holder, source: r.source })
  if (rights.length === 0) return undefined
  const covered = ext.mine?.mark.covered === true
  return {
    contract: {
      rights, marked: !!ext.mine && !covered, covered,
      ...(ext.mine ? { class: 'bound' as const, holder: ext.mine.holder.name, level: 'manage' as const } : {}),
    },
  }
}

/** 掛點 scan.person 的回答（M4-security-m4 的 PersonAnswer）：contract 是管理級（契約人）那一筆，rights 是讀取與限制級的清單。 */
export interface PersonContractAnswer {
  contract?: { class: 'bound'; holder: string; level: 'manage'; covered: boolean }
  rights?: Array<{ holder: string; level: 'limit' | 'read' }>
}

export function scanPerson(state: GameState, actor: ActorId): PersonContractAnswer | undefined {
  const a = scanAnswer(state, actor)?.contract
  if (!a) return undefined
  const out: PersonContractAnswer = {}
  if (a.class === 'bound') out.contract = { class: 'bound', holder: a.holder!, level: 'manage', covered: a.covered }
  const rights = a.rights.filter((r): r is ScanContract & { level: 'limit' | 'read' } => r.level !== 'manage').map((r) => ({ holder: r.holder.name, level: r.level }))
  if (rights.length > 0) out.rights = rights
  return out.contract || out.rights ? out : undefined
}
