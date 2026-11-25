// L6 功能 contract 的資料與純函式：規則（內建的預設加資料蓋掉）、契約與指令的格式、狀態怎麼讀寫、這個功能共用的名字。
// 規格：LEWD_SYSTEM 第 7 節（7.1～7.4、7.6、7.8）；LIFE 3.4 節；EVENTS 4.5 節；DOWNTIME 4.2 節；dev/adr/0019 第八節與 P27～P30；dev/work/M4-contract.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { ActorId, Change, ContentEntry, GameState, Kernel } from '../../core'
import { MINUTES_PER_DAY, clone, deriveRng, fromMinutes, isRecord, isSafeInt, meterOf, minutesToNextSegment, toMinutes } from '../../core'

export const OWNER = 'contract'
/** state.ext 的鍵。 */
export const EXT = 'contract'
export const RULE_KIND = 'contract_rule'
export const SCOPE_KIND = 'event_scope'
export const SCOPE_ID = 'contract'
/** 量表：滿意（不分對象：主角身上一次只有一份管理級的契約）。 */
export const SATISFACTION = 'satisfaction'
export const METER_KEY = '_'

/** 報告的 action。 */
export const SIGN_ACTION = 'contract.sign'
export const ORDER_ACTION = 'contract.order'
export const CHOOSE_ACTION = 'contract.choose'
export const ARRIVE_ACTION = 'contract.arrive'
export const DONE_ACTION = 'contract.done'
export const OVERDUE_ACTION = 'contract.overdue'
export const PAY_ACTION = 'contract.pay'
export const END_ACTION = 'contract.end'
export const RULE_ACTION = 'contract.rule'
export const PAUSE_ACTION = 'contract.pause'
export const COVER_ACTION = 'contract.cover'
// 主角是持約人那一面（M4-contract-holder）
export const HOLD_ACTION = 'contract.hold'
export const TRIGGER_ACTION = 'contract.trigger'
export const ADJUST_ACTION = 'contract.adjust'
export const RELEASE_ACTION = 'contract.release'
export const REFUSE_ACTION = 'contract.refuse'

/** 效果與條件的名字。 */
export const SIGN_EFFECT = 'contract_sign'
export const END_EFFECT = 'contract_end'
export const ORDER_EFFECT = 'order'
export const ORDER_DONE_EFFECT = 'order_done'
export const RIGHT_EFFECT = 'bridge_right'
export const HOLD_EFFECT = 'contract_hold'
export const RELEASE_EFFECT = 'contract_release'
export const CONTRACT_CONDITION = 'contract'
export const PENDING_CONDITION = 'order_pending'

/** 別的功能的名字（只認名字與格式，不 import）。 */
export const DOCILITY_STAT = 'bridge_docility'
/** 橋參數的四項（actor.ext.bridge 的鍵；只認格式）。 */
export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
export const LOAD_CAP_STAT = 'load_cap'
export const AT_HOME = 'at_home'
export const MARK_COVER_TAG = 'mark_cover'
export const COMMISSION = 'commission'
/** 量表（npcs、roster 定義；只用名字讀寫，查不到當 0、略過）。 */
export const AFFINITY = 'affinity'
export const LOYALTY = 'loyalty'
/** 有沒有住處（rest 定義的條件）。 */
export const HAS_HOME = 'has_home'
/** 報告的觸發點：持約人叫他做事（事件由導演從範圍 contract 挑）、解約之後他走不走。 */
export const HOLDER_POINT = 'holder_order'
export const RELEASED_POINT = 'released'

export const ORDER_KINDS = ['errand', 'modify', 'serve', 'work', 'report', 'lend'] as const
export type OrderKind = (typeof ORDER_KINDS)[number]
export const ORDER_NAME: Record<OrderKind, string> = { errand: '差事', modify: '改造', serve: '侍奉', work: '工作', report: '回報', lend: '出借' }
export const isOrderKind = (v: unknown): v is OrderKind => (ORDER_KINDS as readonly unknown[]).includes(v)

export const ORDER_STATES = ['sent', 'doing', 'resisted', 'forced', 'done', 'overdue'] as const
export type OrderState = (typeof ORDER_STATES)[number]
export const ORDER_STATE_NAME: Record<OrderState, string> = { sent: '送達', doing: '照做中', resisted: '抗拒成功', forced: '強制', done: '完成', overdue: '逾期' }
/** 還沒了結的狀態（佇列裡佔位子、有期限的）。 */
export const ACTIVE_STATES: readonly OrderState[] = ['sent', 'doing', 'forced']
export const isActive = (o: Pick<Order, 'state'>): boolean => ACTIVE_STATES.includes(o.state)

export const HOLDER_KINDS = ['eden', 'gang', 'corp', 'person'] as const
export type HolderKind = (typeof HOLDER_KINDS)[number]
export const isHolderKind = (v: unknown): v is HolderKind => (HOLDER_KINDS as readonly unknown[]).includes(v)

export const CONTRACT_TYPES = ['debt', 'work', 'private'] as const
export type ContractType = (typeof CONTRACT_TYPES)[number]
export const TYPE_NAME: Record<ContractType, string> = { debt: '債務契約', work: '工作契約', private: '私人契約' }
export const isContractType = (v: unknown): v is ContractType => (CONTRACT_TYPES as readonly unknown[]).includes(v)

export const RELATIONS = ['formal', 'partner', 'play', 'intense', 'lover'] as const
export type Relation = (typeof RELATIONS)[number]
export const RELATION_NAME: Record<Relation, string> = { formal: '名實相符', partner: '實為夥伴', play: '情趣', intense: '激烈', lover: '戀人' }
export const isRelation = (v: unknown): v is Relation => (RELATIONS as readonly unknown[]).includes(v)

/** 規矩的種類：禁區、宵禁、指定的服裝（LEWD_SYSTEM 7.5 節）。「能不能接別人的指令」那一種已經刪掉（使用者 2026-11-25），不再有 person */
export const RULE_TYPES = ['zone', 'curfew', 'dress'] as const
export type RuleType = (typeof RULE_TYPES)[number]
export const isRuleType = (v: unknown): v is RuleType => (RULE_TYPES as readonly unknown[]).includes(v)

export const RIGHT_LEVELS = ['read', 'limit'] as const
export type RightLevel = (typeof RIGHT_LEVELS)[number]

/** 身分（features/security 定義的格式 actor.ext.identity.class；這裡只認名字）。 */
export const IDENTITY_CLASSES = ['member', 'citizen', 'unregistered', 'bound'] as const
export const BOUND = 'bound'
export const DEFAULT_CLASS = 'citizen'

// ---- 格式 ----

export interface Place {
  district?: string
  block?: string
  facility?: string
}

export interface Holder {
  kind: HolderKind
  faction?: string
  npc?: string
  name: string
  place?: Place
  /** 個人持約人的每天下指令基本頻率（沒寫照範圍的資料） */
  freq?: number
}

export interface ContractRule {
  kind: RuleType
  value: string | number
}

export interface Order {
  id: string
  kind: OrderKind
  from: string
  place?: Place
  /** 送達的時間（總分鐘） */
  issued: number
  /** 期限（總分鐘） */
  deadline: number
  state: OrderState
  /** 主角主動要求的 */
  asked?: true
  /** 已經走到指定的地方（arriveDraft 記的） */
  arrived?: true
  /** 了結的時間（done、resisted、overdue 才有） */
  closed?: number
  /** sent、doing 過期作廢（不是被強制之後逾期） */
  lapsed?: true
}

export interface Contract {
  id: string
  holder: Holder
  type: ContractType
  /** 紙上勾的指令種類 */
  orders: OrderKind[]
  debt?: number
  /** 期滿的時間（總分鐘） */
  until?: number
  relation: Relation
  rules: ContractRule[]
  queue: Order[]
  mark: { covered: boolean }
  /** 簽之前的身分 */
  was_class: string
  complied: number
  /** 每週回報的那一天（0 是週一） */
  report_weekday?: number
  /** 債下一次加月息的時間（總分鐘；只有債務契約） */
  interest_at?: number
  signed: number
  /** 牆外的誓約（M6；現在只留位置） */
  oath?: unknown
}

/** 主角是持約人時，他住在哪：自己的住處、或主角的據點。 */
export const HOMES = ['own', 'base'] as const
export type Home = (typeof HOMES)[number]
export const HOME_NAME: Record<Home, string> = { own: '他自己的住處', base: '你的據點' }
export const isHome = (v: unknown): v is Home => (HOMES as readonly unknown[]).includes(v)

/** 持約人可以觸發的事（封閉的五種；前四種對到指令的種類，talk 只是談一談）。 */
export const HOLDER_EVENTS = ['errand', 'modify', 'serve', 'work', 'talk'] as const
export type HolderEventKind = (typeof HOLDER_EVENTS)[number]
export const HOLDER_EVENT_NAME: Record<HolderEventKind, string> = { errand: '派差事', modify: '送去改造', serve: '叫來侍奉', work: '安排工作', talk: '談一談' }
export const isHolderEvent = (v: unknown): v is HolderEventKind => (HOLDER_EVENTS as readonly unknown[]).includes(v)
/** 紙上對得到的指令種類（talk 沒有）。 */
export const PAPER_KIND: Record<HolderEventKind, OrderKind | null> = { errand: 'errand', modify: 'modify', serve: 'serve', work: 'work', talk: null }

/** 持約人那一面的契約：Contract 的欄位（holder 是主角；queue 不用、留空）加上他的住處、工作、分帳、出借與觸發的紀錄。 */
export interface Held extends Contract {
  home: Home
  /** 工作的安排：一句話或一份工作的 id（派工是 M5，這裡只記） */
  job?: string
  /** 收入他拿幾成（0～1） */
  split: number
  /** 借給別人：{ 借給誰（名字或 id）, 到哪個時間（總分鐘） } */
  lent?: { to: string; until: number }
  /** 每一種事上一次觸發是哪一天（總分鐘 ÷ 1440 取整） */
  triggered: Partial<Record<HolderEventKind, number>>
  /** 來歷的一句話 */
  origin: string
}

export const JOB_LEN = 60
export const ORIGIN_LEN = 60
export const LEND_TO_LEN = 40

export interface Right {
  holder: Holder
  level: RightLevel
  source: string
}

export interface Note {
  kind: 'sign' | 'order' | 'end' | 'hold' | 'release'
  text: string
  /** 指令的 id（kind 是 order 才有） */
  order?: string
  result?: string
  /** 那個契約人（hold、release 才有） */
  npc?: string
  /** release：解約之後他留在名冊 */
  stay?: boolean
  /** release：解約時的主僕關係（觸發點 released 的 where） */
  relation?: Relation
}

export interface ContractExt {
  mine: Contract | null
  /** 主角持有的，照契約人的 id */
  held: Record<string, Held>
  rights: Right[]
  seq: number
  /** 還沒寫成報告的通知（簽下、解約、事件塞進來的指令）；report.after 發出去再清掉 */
  notes: Note[]
}

// ---- 規則 ----

/** 期限的寫法：小時數、[最少, 最多] 小時、'segment'（到下一個時段結束）、'day_end'（到那一天結束）。 */
export type DeadlineSpec = number | [number, number] | 'segment' | 'day_end'

export interface ContractRules {
  /** 每種持約人下哪一種指令的權重（P27） */
  kind_weights: Record<HolderKind, Record<OrderKind, number>>
  /** 個人持約人照主僕關係（沒寫的關係用 kind_weights.person） */
  person_weights: Record<Relation, Record<OrderKind, number>>
  deadline_hours: Record<OrderKind, DeadlineSpec>
  /** 抗拒的 DC：base ＋ manage ＋ ⌊馴化 ÷ docility_div⌋ ＋ 沉溺的懲罰（sink：門檻 → 加幾）＋ relation（夥伴與戀人） */
  resist: { base: number; manage: number; docility_div: number; sink: Record<string, number>; relation: number }
  satisfaction: { start: number; comply: number; asked: number; resist: number; overdue: number; expire: number; rule: number }
  docility_every: number
  overdue: { lock: { weight: number; hours: number }; load: { weight: number; share: number }; expose: { weight: number; hostility: number } }
  income_keep: number
  debt_monthly: number
  buyout: { mult: number; talk_at: number; talk_dc: number; talk_mult: number }
  crossed_out_mult: number
  /** 佇列裡留幾條了結的紀錄 */
  keep_records: number
  /** 主角是持約人：他對主角的親密度低於 resist_below 才擲抗拒；抗命成功時主角的親密度 +refuse_affinity、他的忠誠 +refuse_loyalty（負數）；
   *  主僕關係要親密度 relation_min 以上才能選名實相符以外的，≤ relation_revert 時每天 08:00 退回；ntr 關掉時親密度 ntr_affinity 以上的人不借；default_split 分帳預設 */
  holder: { resist_below: number; refuse_affinity: number; refuse_loyalty: number; relation_min: number; relation_revert: number; ntr_affinity: number; default_split: number }
}

const W = (errand: number, modify: number, serve: number, work: number, report: number, lend: number): Record<OrderKind, number> => ({ errand, modify, serve, work, report, lend })

/** P27：伊甸園偏工作與回報、幫派偏差事、企業偏差事與回報、個人照主僕關係；P28、P29、P30 的數字。 */
export const DEFAULT_CONTRACT_RULES: ContractRules = {
  kind_weights: {
    eden: W(2, 1, 2, 5, 4, 1),
    gang: W(6, 1, 1, 2, 1, 2),
    corp: W(5, 2, 1, 2, 4, 1),
    person: W(4, 2, 3, 3, 3, 2),
  },
  person_weights: {
    formal: W(4, 2, 3, 3, 3, 2),
    partner: W(2, 1, 1, 2, 2, 1),
    play: W(2, 2, 5, 1, 2, 2),
    intense: W(2, 3, 5, 1, 2, 2),
    lover: W(2, 1, 4, 2, 3, 0),
  },
  deadline_hours: { errand: [24, 72], modify: 48, serve: [4, 12], work: 'segment', report: 'day_end', lend: 24 },
  resist: { base: 12, manage: 4, docility_div: 10, sink: { 60: 2, 80: 4 }, relation: -4 },
  satisfaction: { start: 50, comply: 5, asked: 8, resist: -5, overdue: -10, expire: -5, rule: -5 },
  docility_every: 3,
  overdue: { lock: { weight: 1, hours: 24 }, load: { weight: 1, share: 0.5 }, expose: { weight: 1, hostility: 10 } },
  income_keep: 0.1,
  debt_monthly: 0.02,
  buyout: { mult: 1.5, talk_at: 80, talk_dc: 16, talk_mult: 1.2 },
  crossed_out_mult: 0.5,
  keep_records: 10,
  holder: { resist_below: 20, refuse_affinity: -2, refuse_loyalty: -5, relation_min: 60, relation_revert: 40, ntr_affinity: 60, default_split: 0.1 },
}

/** 範圍 contract 的資料（event_scope）沒寫時的預設（EVENTS 4.5 節）。 */
export const DEFAULT_DAILY_ROLL: Record<HolderKind, number | [number, number]> = { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }
export const DEFAULT_SATISFACTION_MULT: Array<[number, number]> = [[0, 1.5], [30, 1], [70, 0.6]]
export const DEFAULT_QUEUE_MAX = 3
/** 債務契約每隔幾天加一次月息。 */
export const DEBT_PERIOD_DAYS = 30

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const weightsProblems = (v: unknown, at: string): string[] => {
  if (!isRecord(v)) return [`${at} 要是 { 指令種類: 權重 }`]
  const p: string[] = []
  for (const [k, w] of Object.entries(v)) {
    if (!isOrderKind(k)) p.push(`${at}.${k}：沒有這種指令（${ORDER_KINDS.join('、')}）`)
    else if (!(isNum(w) && w >= 0 && w <= 1000)) p.push(`${at}.${k} 要是 0～1000 的數字`)
  }
  return p
}

const specProblems = (v: unknown, at: string): string[] => {
  if (isNum(v)) return v > 0 && v <= 24 * 365 ? [] : [`${at} 要是 0 到 8760 之間的小時數`]
  if (v === 'segment' || v === 'day_end') return []
  if (Array.isArray(v) && v.length === 2 && v.every((x) => isNum(x) && x > 0 && x <= 24 * 365) && (v[0] as number) <= (v[1] as number)) return []
  return [`${at} 要是小時數、[最少, 最多] 或 'segment'、'day_end'`]
}

const numbersIn = (v: unknown, at: string, fields: Record<string, [number, number]>): string[] => {
  if (!isRecord(v)) return [`${at} 要是物件`]
  const p: string[] = []
  for (const [k, x] of Object.entries(v)) {
    const range = fields[k]
    if (!range) p.push(`${at}.${k}：沒有這個欄位（${Object.keys(fields).join('、')}）`)
    else if (!(isNum(x) && x >= range[0] && x <= range[1])) p.push(`${at}.${k} 要是 ${range[0]}～${range[1]} 的數字`)
  }
  return p
}

const RULE_FIELDS = ['kind_weights', 'person_weights', 'deadline_hours', 'resist', 'satisfaction', 'docility_every', 'overdue', 'income_keep', 'debt_monthly', 'buyout', 'crossed_out_mult', 'keep_records', 'holder'] as const

/** 規則表 contract_rule 的格式（缺的欄位用預設；寫了就要合格）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.kind_weights !== undefined) {
    if (!isRecord(e.kind_weights)) p.push('kind_weights 要是 { 持約人種類: { 指令種類: 權重 } }')
    else for (const [h, w] of Object.entries(e.kind_weights)) p.push(...(isHolderKind(h) ? weightsProblems(w, `kind_weights.${h}`) : [`kind_weights.${h}：沒有這種持約人（${HOLDER_KINDS.join('、')}）`]))
  }
  if (e.person_weights !== undefined) {
    if (!isRecord(e.person_weights)) p.push('person_weights 要是 { 主僕關係: { 指令種類: 權重 } }')
    else for (const [r, w] of Object.entries(e.person_weights)) p.push(...(isRelation(r) ? weightsProblems(w, `person_weights.${r}`) : [`person_weights.${r}：沒有這種主僕關係（${RELATIONS.join('、')}）`]))
  }
  if (e.deadline_hours !== undefined) {
    if (!isRecord(e.deadline_hours)) p.push('deadline_hours 要是 { 指令種類: 期限 }')
    else for (const [k, v] of Object.entries(e.deadline_hours)) p.push(...(isOrderKind(k) ? specProblems(v, `deadline_hours.${k}`) : [`deadline_hours.${k}：沒有這種指令`]))
  }
  if (e.resist !== undefined) {
    if (!isRecord(e.resist)) p.push('resist 要是物件')
    else {
      const { sink, ...rest } = e.resist
      p.push(...numbersIn(rest, 'resist', { base: [0, 40], manage: [0, 40], docility_div: [1, 1000], relation: [-40, 40] }))
      if (sink !== undefined) {
        if (!isRecord(sink)) p.push('resist.sink 要是 { 沉溺門檻: 加幾 }')
        else for (const [at, v] of Object.entries(sink)) if (!(Number.isInteger(Number(at)) && Number(at) >= 0 && isSafeInt(v) && v >= -40 && v <= 40)) p.push(`resist.sink.${at} 要是 { 沉溺門檻（整數）: 加幾（整數）}`)
      }
    }
  }
  if (e.satisfaction !== undefined) p.push(...numbersIn(e.satisfaction, 'satisfaction', { start: [0, 100], comply: [-100, 100], asked: [-100, 100], resist: [-100, 100], overdue: [-100, 100], expire: [-100, 100], rule: [-100, 100] }))
  if (e.docility_every !== undefined && !(isSafeInt(e.docility_every) && e.docility_every >= 1 && e.docility_every <= 1000)) p.push('docility_every 要是 1 以上的整數')
  if (e.overdue !== undefined) {
    if (!isRecord(e.overdue)) p.push('overdue 要是 { lock, load, expose }')
    else {
      const sub: Record<string, Record<string, [number, number]>> = { lock: { weight: [0, 1000], hours: [0, 8760] }, load: { weight: [0, 1000], share: [0, 1] }, expose: { weight: [0, 1000], hostility: [0, 100] } }
      for (const [k, v] of Object.entries(e.overdue)) p.push(...(sub[k] ? numbersIn(v, `overdue.${k}`, sub[k]!) : [`overdue.${k}：沒有這種處置（lock、load、expose）`]))
    }
  }
  if (e.income_keep !== undefined && !(isNum(e.income_keep) && e.income_keep >= 0 && e.income_keep <= 1)) p.push('income_keep 要是 0～1 的數字')
  if (e.debt_monthly !== undefined && !(isNum(e.debt_monthly) && e.debt_monthly >= 0 && e.debt_monthly <= 1)) p.push('debt_monthly 要是 0～1 的數字')
  if (e.buyout !== undefined) p.push(...numbersIn(e.buyout, 'buyout', { mult: [0, 100], talk_at: [0, 100], talk_dc: [1, 40], talk_mult: [0, 100] }))
  if (e.crossed_out_mult !== undefined && !(isNum(e.crossed_out_mult) && e.crossed_out_mult >= 0 && e.crossed_out_mult <= 1)) p.push('crossed_out_mult 要是 0～1 的數字')
  if (e.keep_records !== undefined && !(isSafeInt(e.keep_records) && e.keep_records >= 0 && e.keep_records <= 1000)) p.push('keep_records 要是 0 以上的整數')
  if (e.holder !== undefined) {
    p.push(...numbersIn(e.holder, 'holder', {
      resist_below: [-100, 100], refuse_affinity: [-100, 100], refuse_loyalty: [-100, 100], relation_min: [-100, 100], relation_revert: [-100, 100], ntr_affinity: [-100, 100], default_split: [0, 1],
    }))
  }
  for (const f of Object.keys(e)) if (f !== 'id' && !(RULE_FIELDS as readonly string[]).includes(f)) p.push(`沒有 ${f} 這個欄位（${RULE_FIELDS.join('、')}）`)
  return p
}

/** 把資料的欄位蓋在預設上面（物件一層一層合併、陣列與數字整個換掉）。 */
function merge<T>(base: T, over: unknown): T {
  if (!isRecord(base) || !isRecord(over)) return (over === undefined ? base : over) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : clone(v)
  return out as T
}

/** 現在生效的規則：資料 contract_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function contractRules(k: Pick<Kernel, 'content'>): ContractRules {
  const out = clone(DEFAULT_CONTRACT_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  let rules: ContractRules = out
  for (const key of RULE_FIELDS) if (e[key] !== undefined && !bad.has(key)) rules = { ...rules, [key]: merge(rules[key], e[key]) }
  return rules
}

// ---- 範圍 contract 的資料（導演定義的 event_scope；這裡只讀三個欄位） ----

export interface ScopeData {
  daily_roll: Record<HolderKind, number | [number, number]>
  satisfaction_mult: Array<[number, number]>
  queue_max: number
}

export function scopeData(k: Pick<Kernel, 'content'>): ScopeData {
  const raw = k.content.hasKind(SCOPE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(SCOPE_KIND, SCOPE_ID) : undefined
  const roll = { ...DEFAULT_DAILY_ROLL }
  if (raw && isRecord(raw.daily_roll)) {
    for (const h of HOLDER_KINDS) {
      const v = raw.daily_roll[h]
      if (isNum(v) && v >= 0) roll[h] = v
      else if (Array.isArray(v) && v.length === 2 && v.every((x) => isNum(x) && x >= 0)) roll[h] = [v[0] as number, v[1] as number]
    }
  }
  let mult = DEFAULT_SATISFACTION_MULT
  if (raw && Array.isArray(raw.satisfaction_mult) && raw.satisfaction_mult.length > 0 && raw.satisfaction_mult.every((r) => Array.isArray(r) && r.length === 2 && isNum(r[0]) && isNum(r[1]) && r[1] >= 0)) {
    mult = (raw.satisfaction_mult as Array<[number, number]>).map((r) => [r[0], r[1]] as [number, number]).sort((a, b) => a[0] - b[0])
  }
  const qm = raw?.queue_max
  return { daily_roll: roll, satisfaction_mult: mult, queue_max: isSafeInt(qm) && qm >= 1 ? qm : DEFAULT_QUEUE_MAX }
}

/** 滿意對應的倍率：滿意在哪一段（門檻由小到大，取最後一個不超過它的）。 */
export function satisfactionMult(table: ReadonlyArray<[number, number]>, sat: number): number {
  let m = table[0]?.[1] ?? 1
  for (const [min, mult] of table) if (sat >= min) m = mult
  return m
}

/** 這一份契約每天下指令的機率：持約人的基本頻率（個人的範圍取中間值；holder.freq 優先）× 滿意的倍率，夾在 0～1。 */
export function dailyChance(k: Pick<Kernel, 'content'>, c: Contract, sat: number): number {
  const data = scopeData(k)
  const v = data.daily_roll[c.holder.kind]
  const base = c.holder.freq !== undefined ? c.holder.freq : Array.isArray(v) ? (v[0] + v[1]) / 2 : v
  return Math.min(1, Math.max(0, base * satisfactionMult(data.satisfaction_mult, sat)))
}

// ---- 狀態 ----

export const emptyExt = (): ContractExt => ({ mine: null, held: {}, rights: [], seq: 0, notes: [] })

const readPlace = (v: unknown): Place | undefined => {
  if (!isRecord(v)) return undefined
  const out: Place = {}
  for (const f of ['district', 'block', 'facility'] as const) if (isText(v[f])) out[f] = v[f] as string
  return Object.keys(out).length > 0 ? out : undefined
}

export function readHolder(v: unknown): Holder | undefined {
  if (!isRecord(v) || !isHolderKind(v.kind) || !isText(v.name)) return undefined
  const out: Holder = { kind: v.kind, name: v.name }
  if (isText(v.faction)) out.faction = v.faction
  if (isText(v.npc)) out.npc = v.npc
  const place = readPlace(v.place)
  if (place) out.place = place
  if (isNum(v.freq) && v.freq >= 0) out.freq = v.freq
  return out
}

function readOrder(v: unknown): Order | undefined {
  if (!isRecord(v) || !isText(v.id) || !isOrderKind(v.kind) || !isText(v.from) || !isSafeInt(v.issued) || !isSafeInt(v.deadline) || !(ORDER_STATES as readonly unknown[]).includes(v.state)) return undefined
  const out: Order = { id: v.id, kind: v.kind, from: v.from, issued: v.issued, deadline: v.deadline, state: v.state as OrderState }
  const place = readPlace(v.place)
  if (place) out.place = place
  if (v.asked === true) out.asked = true
  if (v.arrived === true) out.arrived = true
  if (isSafeInt(v.closed)) out.closed = v.closed
  if (v.lapsed === true) out.lapsed = true
  return out
}

const readRule = (v: unknown): ContractRule | undefined => (isRecord(v) && isRuleType(v.kind) && (isText(v.value) || isNum(v.value)) ? { kind: v.kind, value: v.value as string | number } : undefined)

export function readContract(v: unknown): Contract | null {
  if (!isRecord(v) || !isText(v.id) || !isContractType(v.type) || !isSafeInt(v.signed)) return null
  const holder = readHolder(v.holder)
  if (!holder) return null
  const out: Contract = {
    id: v.id, holder, type: v.type,
    orders: Array.isArray(v.orders) ? v.orders.filter(isOrderKind) : [...ORDER_KINDS],
    relation: isRelation(v.relation) ? v.relation : 'formal',
    rules: Array.isArray(v.rules) ? v.rules.map(readRule).filter((r): r is ContractRule => !!r) : [],
    queue: Array.isArray(v.queue) ? v.queue.map(readOrder).filter((o): o is Order => !!o) : [],
    mark: { covered: isRecord(v.mark) && v.mark.covered === true },
    was_class: isText(v.was_class) ? v.was_class : DEFAULT_CLASS,
    complied: isSafeInt(v.complied) && v.complied >= 0 ? v.complied : 0,
    signed: v.signed,
  }
  if (isSafeInt(v.debt) && v.debt >= 0) out.debt = v.debt
  if (isSafeInt(v.until)) out.until = v.until
  if (isSafeInt(v.report_weekday) && v.report_weekday >= 0 && v.report_weekday <= 6) out.report_weekday = v.report_weekday
  if (isSafeInt(v.interest_at)) out.interest_at = v.interest_at
  if (v.oath !== undefined) out.oath = clone(v.oath)
  return out
}

const HELD_DAY_MAX = 36500 * 1440

/** 讀一份持約人那一面的契約（壞掉的欄位用預設；讀不出契約本身就是 null）。 */
export function readHeld(v: unknown): Held | null {
  const c = readContract(v)
  if (!c || !isRecord(v)) return null
  const triggered: Held['triggered'] = {}
  if (isRecord(v.triggered)) for (const [kind, day] of Object.entries(v.triggered)) if (isHolderEvent(kind) && isSafeInt(day) && day >= 0 && day <= HELD_DAY_MAX) triggered[kind] = day
  const out: Held = {
    ...c, home: isHome(v.home) ? v.home : 'own', split: isNum(v.split) && v.split >= 0 && v.split <= 1 ? v.split : DEFAULT_CONTRACT_RULES.holder.default_split, triggered,
    origin: typeof v.origin === 'string' ? v.origin.slice(0, ORIGIN_LEN) : '',
  }
  if (isText(v.job)) out.job = v.job.slice(0, JOB_LEN)
  if (isRecord(v.lent) && isText(v.lent.to) && isSafeInt(v.lent.until)) out.lent = { to: v.lent.to.slice(0, LEND_TO_LEN), until: v.lent.until }
  return out
}

function readRight(v: unknown): Right | undefined {
  const holder = isRecord(v) ? readHolder(v.holder) : undefined
  return holder && isRecord(v) && (RIGHT_LEVELS as readonly unknown[]).includes(v.level) && isText(v.source) ? { holder, level: v.level as RightLevel, source: v.source } : undefined
}

function readNote(v: unknown): Note | undefined {
  if (!isRecord(v) || !(v.kind === 'sign' || v.kind === 'order' || v.kind === 'end' || v.kind === 'hold' || v.kind === 'release') || typeof v.text !== 'string') return undefined
  return {
    kind: v.kind, text: v.text, ...(isText(v.order) ? { order: v.order } : {}), ...(isText(v.result) ? { result: v.result } : {}), ...(isText(v.npc) ? { npc: v.npc } : {}),
    ...(typeof v.stay === 'boolean' ? { stay: v.stay } : {}), ...(isRelation(v.relation) ? { relation: v.relation } : {}),
  }
}

function readHeldMap(raw: unknown): Record<string, Held> {
  const out: Record<string, Held> = {}
  if (isRecord(raw)) for (const [id, v] of Object.entries(raw)) { const h = readHeld(v); if (h) out[id] = h }
  return out
}

/** 讀 state.ext.contract（壞掉的欄位當沒有）。回傳的是複製：呼叫的人可以直接改，再用 extChange 寫回去。 */
export function readExt(raw: unknown): ContractExt {
  if (!isRecord(raw)) return emptyExt()
  return {
    mine: readContract(raw.mine),
    held: readHeldMap(raw.held),
    rights: Array.isArray(raw.rights) ? raw.rights.map(readRight).filter((r): r is Right => !!r) : [],
    seq: isSafeInt(raw.seq) && raw.seq >= 0 ? raw.seq : 0,
    notes: Array.isArray(raw.notes) ? raw.notes.map(readNote).filter((n): n is Note => !!n) : [],
  }
}

export const extOf = (state: GameState): ContractExt => readExt(state.ext[EXT])

/** 主角身上的管理級契約；沒有是 null。 */
export const contractOf = (state: GameState): Contract | null => extOf(state).mine

export const extChange = (ext: ContractExt): Change => ({ op: 'ext', key: EXT, value: clone(ext) })

/** 這份報告自己已經寫了 state.ext.contract 的話，後面的變更要接在它上面（不然會蓋掉）。 */
export function extAfter(state: GameState, changes: readonly Change[]): ContractExt {
  const written = [...changes].reverse().find((c) => c.op === 'ext' && c.key === EXT)
  return written ? readExt((written as { value?: unknown }).value) : extOf(state)
}

export const nowOf = (state: GameState): number => toMinutes(state.time)
/** 今天是第幾天（總分鐘 ÷ 1440 取整）。 */
export const dayOf = (state: GameState): number => Math.floor(toMinutes(state.time) / MINUTES_PER_DAY)
export const pcOf = (state: GameState): ActorId | null => (state.pc && state.actors[state.pc] ? state.pc : null)
export const holderId = (h: Holder): string => h.faction ?? h.npc ?? h.name

/** 這條指令的名字（給玩家看）。 */
export const orderName = (o: Pick<Order, 'kind'>): string => ORDER_NAME[o.kind]

// ---- 身分 ----

/** 主角現在的身分（actor.ext.identity.class；沒寫或不認得就是市民）。 */
export function classOf(state: GameState, actor: ActorId): string {
  const raw = state.actors[actor]?.ext.identity
  return isRecord(raw) && (IDENTITY_CLASSES as readonly unknown[]).includes(raw.class) ? (raw.class as string) : DEFAULT_CLASS
}

/** 把身分改成 cls（保留 identity 裡別人放的鍵）。 */
export function identityChange(state: GameState, actor: ActorId, cls: string): Change {
  const raw = state.actors[actor]?.ext.identity
  return { op: 'actor.ext', id: actor, key: 'identity', value: { ...(isRecord(raw) ? clone(raw) : {}), class: cls } }
}

// ---- 地點 ----

/** 腳下的設施種類（內容 block 的 facilities 寫的 type）；查不到是 undefined。 */
export function facilityTypeAt(k: Pick<Kernel, 'content'>, state: GameState): string | undefined {
  const { block, facility } = state.location
  if (!block || !facility || !k.content.hasKind('block')) return undefined
  const b = k.content.get<ContentEntry & { facilities?: unknown }>('block', block)
  const f = isRecord(b?.facilities) ? b!.facilities[facility] : undefined
  return isRecord(f) && isText(f.type) ? f.type : undefined
}

/** 人在不在那個地方（寫了的欄位都要對上；設施可以寫標記的 id 或設施的種類）。沒寫 place 在哪都算。 */
export function placeMatches(k: Pick<Kernel, 'content'>, state: GameState, place: Place | undefined): boolean {
  if (!place) return true
  const loc = state.location
  if (place.district !== undefined && loc.district !== place.district) return false
  if (place.block !== undefined && loc.block !== place.block) return false
  if (place.facility !== undefined && !(loc.facility === place.facility || (loc.facility !== undefined && facilityTypeAt(k, state) === place.facility))) return false
  return true
}

/** 一個地方的名字（給玩家看）：設施、街區、區的名字，查不到就寫「那裡」。 */
export function placeName(k: Pick<Kernel, 'content'>, place: Place | undefined): string {
  if (!place) return '指定的地方'
  const name = (kind: string, id: string | undefined): string | undefined => (id && k.content.hasKind(kind) ? k.content.get<ContentEntry & { name?: string }>(kind, id)?.name : undefined)
  return name('block', place.block) ?? name('district', place.district) ?? '指定的地方'
}

// ---- 篩選與限制 ----

/** 現在這份契約下得了的指令種類：契約支配關掉時只剩差事、工作、回報；戀人不抽出借。 */
export function allowedKinds(state: GameState, c: Pick<Contract, 'relation'>, dom: boolean): OrderKind[] {
  void state
  return ORDER_KINDS.filter((kind) => (dom || kind === 'errand' || kind === 'work' || kind === 'report') && !(c.relation === 'lover' && kind === 'lend'))
}

/** 抗拒失敗時被強制的種類：主角非自願關掉時只有差事與工作，其餘種類失敗時當成功。 */
export const forceable = (kind: OrderKind, unwilling: boolean): boolean => unwilling || kind === 'errand' || kind === 'work'

// ---- 期限與抽種類 ----

/** 這一種指令從 now 起算的期限（分鐘）。範圍的用 deriveRng（用途帶 id），同一個狀態結果一樣。 */
export function deadlineMinutes(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState, kind: OrderKind, now: number, id: string, hours?: number): number {
  if (hours !== undefined) return Math.max(1, Math.round(hours * 60))
  const spec = contractRules(k).deadline_hours[kind]
  if (spec === 'segment') return minutesToNextSegment(fromMinutes(now), k.timeRules) + 4 * 60
  if (spec === 'day_end') return MINUTES_PER_DAY - (now % MINUTES_PER_DAY)
  if (Array.isArray(spec)) return deriveRng(state.rng, `contract/deadline/${id}`).int(spec[0], spec[1]) * 60
  return Math.round(spec * 60)
}

/** 這一份契約抽哪一種指令的權重（0 的不會抽到）。 */
export function kindWeights(k: Pick<Kernel, 'content'>, state: GameState, c: Contract): Array<[OrderKind, number]> {
  const rules = contractRules(k)
  const table = c.holder.kind === 'person' ? (rules.person_weights[c.relation] ?? rules.kind_weights.person) : rules.kind_weights[c.holder.kind]
  const allowed = allowedKinds(state, c, !state.rules.contentOff.includes('contract_dom'))
  return allowed.map((kind): [OrderKind, number] => [kind, (table[kind] ?? 0) * (c.orders.includes(kind) ? 1 : rules.crossed_out_mult)]).filter(([, w]) => w > 0)
}

/** 佇列裡佔位子的條數。 */
export const activeCount = (c: Contract): number => c.queue.filter(isActive).length

/** 了結的紀錄只留最近 keep 條（照了結的時間），沒了結的全留。 */
export function trimRecords(c: Contract, keep: number): void {
  const finished = c.queue.filter((o) => !isActive(o)).sort((a, b) => (a.closed ?? 0) - (b.closed ?? 0))
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - keep)).map((o) => o.id))
  if (drop.size > 0) c.queue = c.queue.filter((o) => !drop.has(o.id))
}

/** 抗拒時沉溺的 DC 加成：門檻由大到小，取第一個不超過沉溺的。 */
export function sinkPenalty(table: Record<string, number>, sink: number): number {
  const keys = Object.keys(table).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => b - a)
  const hit = keys.find((n) => sink >= n)
  return hit === undefined ? 0 : (table[String(hit)] ?? 0)
}

/** 簽的時候沒寫 report_weekday 的預設：從亂數狀態導出（同一個狀態結果一樣），0～6。 */
export const deriveWeekday = (state: GameState): number => deriveRng(state.rng, `contract/weekday/${extOf(state).seq + 1}`).int(0, 6)

/** 現在的滿意（沒有契約是 0）。 */
export const meterNow = (k: Pick<Kernel, 'meters'>, state: GameState): number => meterOf(k, state, SATISFACTION, METER_KEY)
