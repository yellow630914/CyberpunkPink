// L6 unreg 的四個來源裡的三個入口（M4-part-sources；CRAFTING 11.1 節「四個來源」；FIXER 第 2 節①、第 8 節；FACTIONS 5.1 節；dev/adr/0019 P69～P73）：
//   委託的報酬：回答 fixer 宣告的掛點 fixer.reward（answerReward；unreg 不 import fixer，只認名字與格式）。
//   訂做：站在帶 unreg_desk 的設施上付現金晶片（orderOptions、orderBlock、orderDraft）；取貨走 deliverDraft（pending.ts 的 deliverBlock 多一條人要在委託台）。
//   勢力的固定窗口：好感滿、用掉一個大人情（windowOptions、windowBlock、windowDraft）。
//   口頭要到是效果 part_unreg 的 source: 'ask'（index.ts），不在這裡。
// 讀別人的：條件 has_favor、變更 favor.spend（features/favors；沒有人註冊時窗口整個不列）、量表 favor（features/security；meterOf 讀，查不到當 0）、條件 at_facility、
// 內容 commission_type（part_types）、faction（brand、leader）、npc（首領的名字）。

import type { Change, ContentEntry, GameState, Kernel, QuirkEntry, ReportDraft } from '../../core'
import { ActionBlocked, Rng, clone, deriveRng, formatAmount, hash32, isSafeInt, meterOf, toMinutes } from '../../core'
import { deskHere, weekdaysText } from './desk'
import type { DeskHere } from './desk'
import { quirkCandidates, specProblems } from './frame'
import type { Material, UnregOption, UnregRules } from './model'
import { MATERIALS, ONCE_OP, PENDING_OP, REQUEST_MAX, ROMAN, orderRule, rewardRule, typeName, unregOf, unregRules, windowRule } from './model'
import type { PendingSpec } from './pending'

const DAY = 1440
/** 訂做花的時間（分鐘）：站在櫃台談一下、付錢。 */
export const ORDER_MINUTES = 10
export const ORDER_ACTION = 'unreg.order'
export const WINDOW_ACTION = 'unreg.window'
const DEFAULT_BRAND = 'doujin'
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

type Cx = Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules' | 'meters'>

// ---------------------------------------------------------------------------------------------------------------------
// 共用：類型與方向的選項（給訂做與窗口的畫面）
// ---------------------------------------------------------------------------------------------------------------------

/** 一個可以指定的方向（選項的 id、名字與 tags；want 寫 id 或 tags 都對得上）。 */
export interface DirectionChoice {
  id: string
  name: string
  tags: string[]
  grade_min?: number
  material?: Material
}

export interface TypeChoice {
  id: string
  name: string
  /** 有沒有生體版（槍管、機構沒有） */
  bio: boolean
  directions: DirectionChoice[]
}

const directionOf = (o: UnregOption): DirectionChoice => ({ id: o.id, name: o.name, tags: [...(o.tags ?? [])], ...(o.grade_min !== undefined ? { grade_min: o.grade_min } : {}), ...(o.material !== undefined ? { material: o.material } : {}) })

/** 十二種（規則表 types）每一種可以指定的方向。 */
export function typeChoices(rules: UnregRules): TypeChoice[] {
  return Object.entries(rules.types).map(([id, t]) => ({ id, name: t.name, bio: t.bio !== false, directions: (rules.options[id] ?? []).map(directionOf) }))
}

/** 輸入的 type、material、want、request 的共同檢查（每條一句）。 */
function specInputProblems(k: Pick<Kernel, 'content'>, rules: UnregRules, input: { type?: unknown; material?: unknown; want?: unknown; request?: unknown }): string[] {
  const p: string[] = []
  if (!isText(input.type)) p.push('要指定零件的類型。')
  else p.push(...specProblems(k, { type: input.type, ...(input.material !== undefined ? { material: input.material as string } : {}) }, rules))
  if (input.type === undefined || isText(input.type)) {
    if (input.material !== undefined && !(MATERIALS as readonly unknown[]).includes(input.material)) p.push('材質只有機械與生體兩種。')
  }
  if (input.want !== undefined && !(Array.isArray(input.want) && input.want.length <= 12 && input.want.every(isText))) p.push('想要的方向要是字串的陣列（最多 12 個）。')
  if (input.request !== undefined && !(typeof input.request === 'string' && [...input.request].length <= REQUEST_MAX)) p.push(`備註要是 ${REQUEST_MAX} 字以內的文字。`)
  return [...new Set(p)]
}

/** 勢力的短名，查不到用 id。 */
function factionLabel(k: Pick<Kernel, 'content'>, id: string): string {
  const f = k.content.hasKind('faction') ? k.content.get('faction', id) : undefined
  return f ? String(f.short ?? f.name ?? id) : id
}

// ---------------------------------------------------------------------------------------------------------------------
// 委託的報酬（掛點 fixer.reward）
// ---------------------------------------------------------------------------------------------------------------------

/** 掛點 fixer.reward 的收到的東西（fixer 宣告；這裡只認名字與格式）。 */
export interface RewardAsk {
  state: GameState
  phase: 'offer' | 'payout'
  fixer: string
  commission: { id: string; kind?: string; grade: number; employer?: string }
  seed: string
  rating?: string
}

/** 回答 fixer.reward 的格式（fixer 的 RewardExtra；這裡自己寫一份型別，不 import）。 */
export interface RewardAnswer {
  by: string
  label: string
  cash_pct?: number
  effects: Array<Record<string, unknown> & { kind: string }>
}

/** 這一件委託可能給哪幾種零件：委託類型資料的 part_types（認得的），沒寫從規則的 types，再沒有從全部的類型。 */
function rewardTypes(k: Pick<Kernel, 'content'>, rules: UnregRules, kind: string | undefined): string[] {
  const known = (list: unknown): string[] => (Array.isArray(list) ? list.filter((t): t is string => isText(t) && !!rules.types[t]) : [])
  const entry = kind !== undefined && k.content.hasKind('commission_type') ? k.content.get<ContentEntry & { part_types?: unknown }>('commission_type', kind) : undefined
  const own = known(entry?.part_types)
  if (own.length > 0) return own
  const ruled = known(rewardRule(rules).types)
  if (ruled.length > 0) return ruled
  return Object.keys(rules.types)
}

/** 委託人的牌子：勢力資料的 brand，沒有就是 doujin。 */
function employerBrand(k: Pick<Kernel, 'content'>, employer: string | undefined): string {
  if (employer === undefined || !k.content.hasKind('faction')) return DEFAULT_BRAND
  const b = k.content.get<ContentEntry & { brand?: unknown }>('faction', employer)?.brand
  return isText(b) ? b : DEFAULT_BRAND
}

/** 掛點 fixer.reward 的回答（P69、P70；生成時 chance、結算時 s_chance 兩段擲）。 */
export function answerReward(k: Pick<Kernel, 'content'>, ask: RewardAsk): RewardAnswer | undefined {
  const rules = unregRules(k)
  const r = rewardRule(rules)
  const grade = Math.floor(ask.commission.grade)
  if (!Number.isFinite(grade) || grade < 1) return undefined
  const offer = ask.phase === 'offer'
  if (offer && grade < r.grade_min) return undefined
  if (!offer && ask.rating !== r.top_rating) return undefined
  const rng = deriveRng(ask.state.rng, `unreg/reward/${ask.seed}${offer ? '' : '/payout'}`)
  if (!rng.chance(offer ? r.chance : r.s_chance)) return undefined
  const type = rng.pick(rewardTypes(k, rules, ask.commission.kind))
  const g = Math.max(1, Math.min(grade, r.grade_cap))
  return {
    by: 'unreg', label: `一件未登錄零件（${typeName(rules, type)}，${ROMAN[g]}級）`, ...(offer ? { cash_pct: r.cash_pct } : {}),
    effects: [{ kind: 'part_unreg', source: 'reward', type, grade: g, brand: employerBrand(k, ask.commission.employer), from: '委託的報酬' }],
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 訂做
// ---------------------------------------------------------------------------------------------------------------------

export interface OrderQuirk {
  id: string
  name: string
  desc: string
}

export interface OrderType extends TypeChoice {
  /** 同人眾好感到 quirk_pick_favor 時給玩家挑的兩筆怪癖（種子是設施、類型與今天是第幾天，同一天問幾次都一樣）；沒有就是空的 */
  quirks: OrderQuirk[]
}

export interface OrderGradeRow {
  grade: number
  roman: string
  /** 表價 × price_mult（現金晶片） */
  price: number
  /** 要等幾天 */
  days: number
  /** 這一級現在訂不了的原因（現金不夠等）；訂得了是 null */
  block: string | null
}

export interface OrderView {
  /** 腳下的委託台；不在是 null */
  desk: Pick<DeskHere, 'type' | 'name' | 'brand' | 'open'> & { faction?: string } | null
  /** 現在整個訂不了的原因（不在委託台、今天沒開、已經有訂單在等），一條一個條件 */
  blocks: string[]
  /** 進行中的訂單數、同時最多幾張、等幾天 */
  open: number
  max_open: number
  days: number
  cash: number
  /** 這個委託台的勢力的好感（沒有勢力是 null）、可以挑怪癖嗎 */
  favor: number | null
  quirk_pick: boolean
  grades: OrderGradeRow[]
  types: OrderType[]
}

/** 進行中的訂單（hold: 'order' 的等著交貨）。 */
export const openOrders = (state: GameState) => unregOf(state).pending.filter((p) => p.hold === 'order')

const priceOf = (rules: UnregRules, grade: number): number => Math.round((rules.price[grade] ?? 0) * orderRule(rules).price_mult)

/** 訂做那個類型時能挑的兩筆怪癖：好感不夠、不在委託台、候選不到兩筆都是空的。同一天、同一個設施、同一個類型每次一樣。 */
export function orderQuirks(k: Cx, state: GameState, type: string, desk: DeskHere | null = deskHere(k, state)): OrderQuirk[] {
  if (!desk || !desk.faction) return []
  const rules = unregRules(k)
  const rule = orderRule(rules)
  if (meterOf(k, state, 'favor', desk.faction) < rule.quirk_pick_favor) return []
  const pool = quirkCandidates(k, state, rules, type)
  if (pool.length < 2) return []
  const rng = new Rng(hash32(state.rng.seed, 'unreg/order/quirk', `${state.location.block ?? ''}/${state.location.facility ?? ''}`, type, state.time.day))
  const a = rng.int(0, pool.length - 1)
  const b = rng.int(0, pool.length - 2)
  return [pool[a]!, pool[b >= a ? b + 1 : b]!].map((q: QuirkEntry) => ({ id: q.id, name: q.name, desc: q.desc }))
}

/** 整個訂不了的原因（和選了什麼無關）：一條一個條件。 */
function orderBlocks(k: Kernel, state: GameState, desk: DeskHere | null, rules: UnregRules): string[] {
  const p: string[] = []
  const act = k.activity.blockOf(state, `commit:${ORDER_ACTION}`)
  if (act) p.push(act)
  if (!state.pc) p.push('還沒有主角。')
  if (!desk) p.push('要在同人社團的委託台才能訂做。')
  else if (!desk.open) p.push(`${desk.name}今天沒有開（開在${desk.weekdays ? weekdaysText(desk.weekdays) : '特定的日子'}）。`)
  const rule = orderRule(rules)
  const n = openOrders(state).length
  if (n >= rule.max_open) p.push(`你已經有 ${n} 張訂單在等了，同時最多 ${rule.max_open} 張。`)
  return p
}

/** 訂做的選項：腳下的委託台、類型與材質、每一級的價錢與天數、每個類型能指定的方向、怪癖的候選、擋住的原因。不在委託台也照列（原因寫在 blocks）。 */
export function orderOptions(k: Kernel, state: GameState): OrderView {
  const rules = unregRules(k)
  const rule = orderRule(rules)
  const desk = deskHere(k, state)
  const cash = state.money.cash
  const favor = desk?.faction ? meterOf(k, state, 'favor', desk.faction) : null
  const grades: OrderGradeRow[] = []
  for (let g = 1; g <= rule.grade_cap; g++) {
    const price = priceOf(rules, g)
    grades.push({ grade: g, roman: ROMAN[g] ?? String(g), price, days: rule.days, block: cash < price ? `現金晶片不夠：要 ${formatAmount(price)}，你有 ${formatAmount(cash)}。` : null })
  }
  return {
    desk: desk ? { type: desk.type, name: desk.name, brand: desk.brand, open: desk.open, ...(desk.faction ? { faction: desk.faction } : {}) } : null,
    blocks: orderBlocks(k, state, desk, rules), open: openOrders(state).length, max_open: rule.max_open, days: rule.days, cash, favor,
    quirk_pick: favor !== null && favor >= rule.quirk_pick_favor,
    grades, types: typeChoices(rules).map((t) => ({ ...t, quirks: orderQuirks(k, state, t.id, desk) })),
  }
}

export interface OrderInput {
  type?: string
  material?: string
  grade?: number
  want?: string[]
  quirk?: string
  request?: string
}

/** 訂做現在成立嗎：原因（一條一個條件）；成立是空的。 */
export function orderProblems(k: Kernel, state: GameState, input: OrderInput): string[] {
  const rules = unregRules(k)
  const rule = orderRule(rules)
  const desk = deskHere(k, state)
  const p = orderBlocks(k, state, desk, rules)
  p.push(...specInputProblems(k, rules, input))
  const g = input.grade
  if (!(isSafeInt(g) && g >= 1 && g <= rule.grade_cap)) p.push(`訂做的等級要是 I～${ROMAN[rule.grade_cap]}。`)
  else if (state.money.cash < priceOf(rules, g)) p.push(`現金晶片不夠：要 ${formatAmount(priceOf(rules, g))}，你有 ${formatAmount(state.money.cash)}。`)
  if (input.quirk !== undefined) {
    if (!isText(input.type) || !rules.types[input.type]) p.push('要先指定零件的類型，才挑得了怪癖。')
    else {
      const cands = orderQuirks(k, state, input.type, desk)
      if (cands.length === 0) p.push(desk?.faction ? `${factionLabel(k, desk.faction)}的好感要到 ${rule.quirk_pick_favor}，才挑得了怪癖。` : '這個委託台給不了怪癖的選擇。')
      else if (!cands.some((q) => q.id === input.quirk)) p.push('那個怪癖不在這一次的候選裡。')
    }
  }
  return [...new Set(p)]
}

/** 現在訂不了的原因（接起來的一句）；成立是 null。 */
export function orderBlock(k: Kernel, state: GameState, input: OrderInput): string | null {
  const p = orderProblems(k, state, input)
  return p.length > 0 ? p.join('') : null
}

/**
 * 訂做：付現金晶片（表價 × price_mult，不乘區倍率）、不擲檢定，多一筆等著交貨的訂單（hold: 'order'、ready_at 是現在加 days 天），花 10 分鐘。
 * 變更：cash、time、unreg.pending。報告 unreg.order。取貨走 deliverDraft（滿了天數、人在委託台）。
 */
export function orderDraft(k: Kernel, state: GameState, input: OrderInput): ReportDraft {
  const block = orderBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const rules = unregRules(k)
  const rule = orderRule(rules)
  const desk = deskHere(k, state)!
  const grade = input.grade as number
  const type = input.type as string
  const price = priceOf(rules, grade)
  const spec: PendingSpec = {
    source: 'order', type, grade, brand: desk.brand,
    ...(input.material === 'bio' ? { material: 'bio' } : {}),
    ...(input.want && input.want.length > 0 ? { want: [...input.want] } : {}),
    ...(input.quirk !== undefined ? { quirk: input.quirk } : {}),
    ...(typeof input.request === 'string' && input.request !== '' ? { request: input.request } : {}),
    from: `${desk.name}的訂做`, hold: 'order', ready_at: toMinutes(state.time) + rule.days * DAY,
  }
  const changes: Change[] = [{ op: 'cash', delta: -price }, { op: 'time', minutes: ORDER_MINUTES }, { op: PENDING_OP, add: spec }]
  const line = `在${desk.name}訂了一件${input.material === 'bio' ? '生體' : '機械'}的${typeName(rules, type)}（${ROMAN[grade]} 級），付了 ${formatAmount(price)} 現金，${rule.days} 天後回來取貨。`
  return {
    kind: 'action', action: ORDER_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: ORDER_ACTION, data: { type, grade, price, days: rule.days, desk: desk.type } }],
    changes, outcome: { result: 'ordered', summary: line }, narration: { results: [line] },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 勢力的固定窗口
// ---------------------------------------------------------------------------------------------------------------------

export interface WindowOption {
  faction: string
  name: string
  /** 給出來的零件的牌子：勢力資料的 brand，沒有就是勢力的 id */
  brand: string
  /** 勢力的首領（勢力資料的 leader；大人情記在它名下也算） */
  leader?: string
  favor: number
  favor_need: number
  /** 給的零件的等級（grade_cap） */
  grade: number
  /** 已經換過了（once 裡有 window:<勢力>） */
  used: boolean
  /** 現在換不了的原因，一條一個條件；換得了是空的 */
  blocks: string[]
  types: TypeChoice[]
}

const windowKey = (faction: string): string => `window:${faction}`

interface FactionLike extends ContentEntry { name?: unknown; short?: unknown; brand?: unknown; leader?: unknown }

/** 窗口能不能用：favor.spend 與 has_favor 都有人註冊才有。 */
const windowAvailable = (k: Pick<Kernel, 'conditions' | 'changes'>): boolean => k.conditions.kinds().includes('has_favor') && !!k.changes.get('favor.spend')

/** 這個勢力有沒有人欠你一個（size 的）人情：記在勢力名下或首領名下都算，回傳記在誰名下（先勢力、再首領）。 */
function favorHolder(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, f: FactionLike, size: string): string | null {
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  const who = [f.id, ...(isText(f.leader) ? [f.leader] : [])]
  return who.find((w) => k.conditions.test({ kind: 'has_favor', dir: 'owed_to_pc', size, who: w } as never, ctx)) ?? null
}

function windowBlocksOf(k: Kernel, state: GameState, f: FactionLike, rules: UnregRules): string[] {
  const rule = windowRule(rules)
  const name = factionLabel(k, f.id)
  const p: string[] = []
  const act = k.activity.blockOf(state, `commit:${WINDOW_ACTION}`)
  if (act) p.push(act)
  if (!state.pc) p.push('還沒有主角。')
  const favor = meterOf(k, state, 'favor', f.id)
  if (favor < rule.favor) p.push(`${name}的好感要到 ${rule.favor}（你現在 ${favor}）。`)
  if (state.pc && !favorHolder(k, state, f, rule.size)) {
    const leader = isText(f.leader) ? (state.actors[f.leader]?.name ?? k.content.get('npc', f.leader)?.name ?? f.leader) : null
    p.push(`要有一個${leader ? `${name}或${String(leader)}` : name}欠你的${{ small: '小', mid: '中', big: '大' }[rule.size]}人情。`)
  }
  if (unregOf(state).once.includes(windowKey(f.id))) p.push(`${name}的窗口你已經用過了。`)
  return p
}

/** 每個勢力的窗口能不能換與原因。沒有人註冊條件 has_favor（或變更 favor.spend）時是空的。 */
export function windowOptions(k: Kernel, state: GameState): WindowOption[] {
  if (!windowAvailable(k) || !k.content.hasKind('faction')) return []
  const rules = unregRules(k)
  const rule = windowRule(rules)
  const types = typeChoices(rules)
  return k.content.list<FactionLike>('faction').slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((f) => ({
    faction: f.id, name: factionLabel(k, f.id), brand: isText(f.brand) ? f.brand : f.id, ...(isText(f.leader) ? { leader: f.leader } : {}),
    favor: meterOf(k, state, 'favor', f.id), favor_need: rule.favor, grade: rule.grade_cap, used: unregOf(state).once.includes(windowKey(f.id)),
    blocks: windowBlocksOf(k, state, f, rules), types,
  }))
}

export interface WindowInput {
  faction?: string
  type?: string
  material?: string
  want?: string[]
}

/** 這一次換不成的原因（一條一個條件）；成立是空的。 */
export function windowProblems(k: Kernel, state: GameState, input: WindowInput): string[] {
  if (!windowAvailable(k)) return ['現在沒有勢力的窗口可以用。']
  const rules = unregRules(k)
  const f = isText(input.faction) && k.content.hasKind('faction') ? k.content.get<FactionLike>('faction', input.faction) : undefined
  if (!f) return ['要指定哪一個勢力的窗口。']
  return [...new Set([...windowBlocksOf(k, state, f, rules), ...specInputProblems(k, rules, input)])]
}

/** 現在換不了的原因（接起來的一句）；成立是 null。 */
export function windowBlock(k: Kernel, state: GameState, input: WindowInput): string | null {
  const p = windowProblems(k, state, input)
  return p.length > 0 ? p.join('') : null
}

/**
 * 用掉一個大人情換一件：變更 favor.spend（記在勢力或首領名下的那一筆）、unreg.pending（等級是 grade_cap、牌子是勢力的、類型與方向照玩家給的）、unreg.once（window:<勢力>）。
 * 不看人在哪裡、不花時間。報告 unreg.window。
 */
export function windowDraft(k: Kernel, state: GameState, input: WindowInput): ReportDraft {
  const block = windowBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const rules = unregRules(k)
  const rule = windowRule(rules)
  const f = k.content.get<FactionLike>('faction', input.faction as string)!
  const who = favorHolder(k, state, f, rule.size)!
  const name = factionLabel(k, f.id)
  const type = input.type as string
  const spec: PendingSpec = {
    source: 'window', type, grade: rule.grade_cap, brand: isText(f.brand) ? f.brand : f.id,
    ...(input.material === 'bio' ? { material: 'bio' } : {}),
    ...(input.want && input.want.length > 0 ? { want: [...input.want] } : {}),
    from: `${name}的固定窗口`,
  }
  const changes: Change[] = [{ op: 'favor.spend', dir: 'owed_to_pc', size: rule.size, who }, { op: PENDING_OP, add: spec }, { op: ONCE_OP, id: windowKey(f.id) }]
  const line = `用掉一個${{ small: '小', mid: '中', big: '大' }[rule.size]}人情，向${name}的窗口換了一件${input.material === 'bio' ? '生體' : '機械'}的${typeName(rules, type)}（${ROMAN[rule.grade_cap]} 級）。`
  return {
    kind: 'action', action: WINDOW_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: WINDOW_ACTION, data: { faction: f.id, type, grade: rule.grade_cap, who } }],
    changes, outcome: { result: 'exchanged', summary: line }, narration: { results: [line] },
  }
}
