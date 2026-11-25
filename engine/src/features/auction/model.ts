// L6 auction 的資料與純函式：內容種類 auction_house／auction_lot／auction_bidder 的格式、規則表 auction_rule、狀態的形狀（state.ext.auction）、這個功能共用的名字。
// 規格：LEWD_SYSTEM 6.2 節；dev/adr/0019 第十八節與 P76、P77、P79、P81、P83、P84；dev/work/M4-auction.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { ContentEntry, GameState, Kernel, SegmentId } from '../../core'
import { SEGMENT_IDS, clone, contentAllowed, isRecord, isSafeInt } from '../../core'

export const OWNER = 'auction'
export const EXT = 'auction'
export const HOUSE_KIND = 'auction_house'
export const LOT_KIND = 'auction_lot'
export const BIDDER_KIND = 'auction_bidder'
export const RULE_KIND = 'auction_rule'
export const FACILITY_TYPE_KIND = 'facility_type'
export const BLOCK_KIND = 'block'
/** 變更：改 state.ext.auction（在套用的那一刻讀現在的狀態，同一份報告裡好幾個效果各改各的不會互相蓋掉）。 */
export const PATCH_OP = 'auction.patch'
/** 效果：直接給推薦、停權（內建的來源才收，ai: false）。 */
export const REF_EFFECT = 'auction_ref'
export const BAN_EFFECT = 'auction_ban'
/** 條件：是這一家的會員。 */
export const MEMBER_CONDITION = 'auction_member'
/** 報告 */
export const REF_ACTION = 'auction.ref'
export const INSPECT_ACTION = 'auction.inspect'
export const ENTER_ACTION = 'auction.enter'
export const BID_ACTION = 'auction.bid'
export const LEAVE_ACTION = 'auction.leave'
export const CLOSE_ACTION = 'auction.close'
/** 活動：一場拍賣（order 40）。 */
export const ACTIVITY = 'auction'
/** 觸發點：一場拍賣結束。 */
export const DONE_POINT = 'auction_done'
/** 寫推薦函花的時間（分鐘）。 */
export const REF_MINUTES = 10
/** 拍賣行資料的 member.faction 沒寫 favor_min 時的門檻（FACTIONS 5.1 節：好感 40 是友好）。 */
export const FRIENDLY_FAVOR = 40
export const DAY_MINUTES = 1440
/** 沒寫 cert 的拍品的鑑定書（P84：這一批不叫 AI）。 */
export const DEFAULT_CERT = '附鑑定書，來路乾淨。'

export const LOT_KINDS = ['part', 'cyberware', 'art', 'secret', 'contract'] as const
export type LotKind = (typeof LOT_KINDS)[number]
export const KIND_NAME: Record<LotKind, string> = { part: '零件', cyberware: '義體', art: '藝術品', secret: '機密', contract: '契約' }
/** 內容篩選的標籤：關掉時契約的種類名字顯示「債權」（LEWD_SYSTEM 第 9 節）。 */
export const CONTRACT_TAG = 'contract_dom'
/** 只有零件與義體會有仿品、可以看貨。 */
export const FAKEABLE: readonly LotKind[] = ['part', 'cyberware']
export const SIZES = ['small', 'mid', 'big'] as const
export type FavorSize = (typeof SIZES)[number]

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isLotKind = (v: unknown): v is LotKind => (LOT_KINDS as readonly unknown[]).includes(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const range = (v: unknown, lo: number): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isSafeInt) && (v[0] as number) >= lo && (v[0] as number) <= (v[1] as number)

/** 種類的名字：契約在內容篩選 contract_dom 關掉時叫「債權」，其餘不變。 */
export function kindName(kind: LotKind, state: Pick<GameState, 'rules'>): string {
  return kind === 'contract' && !contentAllowed(state.rules, CONTRACT_TAG) ? '債權' : KIND_NAME[kind]
}

// ---- 規則（LEWD_SYSTEM 6.2 節；dev/adr/0019 P76～P82） ----

export interface AuctionRules {
  /** 上拍的零件與義體的等級（V 級不上拍） */
  grades: number[]
  /** 底價是市價的幾成 */
  reserve_pct: number
  /** 加價的一階是底價的幾成 */
  step_pct: number
  /** 一階最少多少 */
  step_min: number
  /** 競標者預算倍率的範圍 */
  budget: [number, number]
  /** 仿品：零件與義體每件 chance 的機率；看貨擲 skills 裡最高的一項對 dc，花 minutes 分鐘 */
  fake: { chance: number; dc: number; skills: string[]; minutes: number }
  /** 預展：開槌前 days_before 天，from_hour～to_hour；目錄也在那一天 from_hour 公布 */
  preview: { days_before: number; from_hour: number; to_hour: number }
  /** 推薦函：換的是 favor 大小的人情，或對方的親密度到 affinity */
  ref: { favor: FavorSize; affinity: number }
  /** 停權幾天 */
  ban_days: number
  /** 競價（M4-auction-bid；P78）：一件最多幾回合、玩家一次最多加幾階 */
  rounds_max: number
  raise_max: number
  /** NPC 加價的機率：對這一種有興趣 yes、沒有 no；這一回合在他之前已經有人加過價（含玩家）再加 after_raise */
  interest: { yes: number; no: number; after_raise: number }
  /** 佣金：成交價的幾成（四捨五入） */
  fee_pct: number
  /** 從進場算起，這一場至少過幾分鐘 */
  min_minutes: number
  /** 用帳戶買違禁品或契約：factions 裡每個勢力的敵對值加 amount（清單預設空的，等內容；P82） */
  cred_dirty: { amount: number; factions: string[] }
}

export const DEFAULT_AUCTION_RULES: AuctionRules = {
  grades: [3, 4],
  reserve_pct: 0.5,
  step_pct: 0.1,
  step_min: 50,
  budget: [0.8, 1.6],
  fake: { chance: 0.15, dc: 16, skills: ['cyberware', 'investigate'], minutes: 10 },
  preview: { days_before: 1, from_hour: 8, to_hour: 18 },
  ref: { favor: 'small', affinity: 40 },
  ban_days: 28,
  rounds_max: 8,
  raise_max: 3,
  interest: { yes: 0.7, no: 0.15, after_raise: 0.1 },
  fee_pct: 0.1,
  min_minutes: 60,
  cred_dirty: { amount: 2, factions: [] },
}

const FIELD_CHECKS: Record<string, (v: unknown) => string[]> = {
  grades: (v) => (Array.isArray(v) && v.length > 0 && v.every((g) => isSafeInt(g) && g >= 1 && g <= 4) ? [] : ['grades 要是 1～4 的整數陣列（V 級不上拍）']),
  reserve_pct: (v) => (isNum(v) && v > 0 && v <= 2 ? [] : ['reserve_pct 要是大於 0、最多 2 的數字']),
  step_pct: (v) => (isNum(v) && v > 0 && v <= 1 ? [] : ['step_pct 要是大於 0、最多 1 的數字']),
  step_min: (v) => (isSafeInt(v) && v >= 1 ? [] : ['step_min 要是 1 以上的整數']),
  budget: (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => isNum(n) && n > 0) && (v[0] as number) <= (v[1] as number) ? [] : ['budget 要是 [最少倍率, 最多倍率]：兩個大於 0 的數字']),
  fake: (v) => {
    if (!isRecord(v)) return ['fake 要是 { chance, dc, skills, minutes }']
    const p: string[] = []
    if (v.chance !== undefined && !(isNum(v.chance) && v.chance >= 0 && v.chance <= 1)) p.push('fake.chance 要是 0～1 的數字')
    if (v.dc !== undefined && !(isSafeInt(v.dc) && v.dc >= 1 && v.dc <= 40)) p.push('fake.dc 要是 1～40 的整數')
    if (v.skills !== undefined && !(textList(v.skills) && v.skills.length > 0)) p.push('fake.skills 要是至少一項基本功 id 的陣列')
    if (v.minutes !== undefined && !(isSafeInt(v.minutes) && v.minutes >= 0)) p.push('fake.minutes 要是 0 以上的整數')
    return p
  },
  preview: (v) => {
    if (!isRecord(v)) return ['preview 要是 { days_before, from_hour, to_hour }']
    const p: string[] = []
    if (v.days_before !== undefined && !(isSafeInt(v.days_before) && v.days_before >= 0 && v.days_before <= 6)) p.push('preview.days_before 要是 0～6 的整數')
    if (v.from_hour !== undefined && !(isSafeInt(v.from_hour) && v.from_hour >= 0 && v.from_hour <= 23)) p.push('preview.from_hour 要是 0～23 的整數')
    if (v.to_hour !== undefined && !(isSafeInt(v.to_hour) && v.to_hour >= 1 && v.to_hour <= 24)) p.push('preview.to_hour 要是 1～24 的整數')
    if (p.length === 0 && isSafeInt(v.from_hour) && isSafeInt(v.to_hour) && v.from_hour >= v.to_hour) p.push('preview.from_hour 要早於 to_hour')
    return p
  },
  ref: (v) => {
    if (!isRecord(v)) return ['ref 要是 { favor, affinity }']
    const p: string[] = []
    if (v.favor !== undefined && !(SIZES as readonly unknown[]).includes(v.favor)) p.push(`ref.favor 只能是 ${SIZES.join('、')}`)
    if (v.affinity !== undefined && !(isSafeInt(v.affinity) && v.affinity >= -100 && v.affinity <= 100)) p.push('ref.affinity 要是 -100～100 的整數')
    return p
  },
  ban_days: (v) => (isSafeInt(v) && v >= 0 && v <= 3650 ? [] : ['ban_days 要是 0～3650 的整數']),
  rounds_max: (v) => (isSafeInt(v) && v >= 1 && v <= 100 ? [] : ['rounds_max 要是 1～100 的整數']),
  raise_max: (v) => (isSafeInt(v) && v >= 1 && v <= 10 ? [] : ['raise_max 要是 1～10 的整數']),
  interest: (v) => {
    if (!isRecord(v)) return ['interest 要是 { yes, no, after_raise }']
    const p: string[] = []
    for (const f of ['yes', 'no'] as const) if (v[f] !== undefined && !(isNum(v[f]) && v[f] >= 0 && v[f] <= 1)) p.push(`interest.${f} 要是 0～1 的數字`)
    if (v.after_raise !== undefined && !(isNum(v.after_raise) && v.after_raise >= 0 && v.after_raise <= 1)) p.push('interest.after_raise 要是 0～1 的數字')
    return p
  },
  fee_pct: (v) => (isNum(v) && v >= 0 && v <= 1 ? [] : ['fee_pct 要是 0～1 的數字']),
  min_minutes: (v) => (isSafeInt(v) && v >= 0 && v <= DAY_MINUTES ? [] : ['min_minutes 要是 0～1440 的整數']),
  cred_dirty: (v) => {
    if (!isRecord(v)) return ['cred_dirty 要是 { amount, factions }']
    const p: string[] = []
    if (v.amount !== undefined && !(isSafeInt(v.amount) && v.amount >= 0 && v.amount <= 100)) p.push('cred_dirty.amount 要是 0～100 的整數')
    if (v.factions !== undefined && !(Array.isArray(v.factions) && v.factions.every(isText))) p.push('cred_dirty.factions 要是勢力 id 的陣列（可以是空的）')
    return p
  },
}

/** 規則表 auction_rule 的格式檢查（每條一句；不認得的鍵不管：下一張的鍵先留著不讀）。 */
export function auctionRuleProblems(e: Record<string, unknown>): string[] {
  return Object.entries(FIELD_CHECKS).flatMap(([f, check]) => (e[f] !== undefined ? check(e[f]) : []))
}

/** 現在生效的規則：資料 auction_rule/default 蓋掉內建的預設（格式不對的欄位忽略；fake、preview、ref 逐項蓋）。 */
export function auctionRules(k: Pick<Kernel, 'content'>): AuctionRules {
  const out = clone(DEFAULT_AUCTION_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const ok = (f: string): boolean => e[f] !== undefined && (FIELD_CHECKS[f]?.(e[f]) ?? ['?']).length === 0
  if (ok('grades')) out.grades = [...(e.grades as number[])]
  for (const f of ['reserve_pct', 'step_pct', 'step_min', 'ban_days', 'rounds_max', 'raise_max', 'fee_pct', 'min_minutes'] as const) if (ok(f)) out[f] = e[f] as number
  if (ok('budget')) out.budget = [...(e.budget as [number, number])]
  if (ok('fake')) Object.assign(out.fake, clone(e.fake as Record<string, unknown>))
  if (ok('preview')) Object.assign(out.preview, clone(e.preview as Record<string, unknown>))
  if (ok('ref')) Object.assign(out.ref, clone(e.ref as Record<string, unknown>))
  if (ok('interest')) Object.assign(out.interest, clone(e.interest as Record<string, unknown>))
  if (ok('cred_dirty')) Object.assign(out.cred_dirty, clone(e.cred_dirty as Record<string, unknown>))
  return out
}

// ---- 內容種類 ----

export interface MemberDef {
  faction?: string
  favor_min?: number
  ref?: boolean
}

export interface HouseEntry extends ContentEntry {
  name: string
  weekday: number
  segment: SegmentId
  lots: [number, number]
  kinds: LotKind[]
  must?: LotKind[]
  bidders: [number, number]
  member: MemberDef
}

export interface LotEntry extends ContentEntry {
  kind: LotKind
  name?: string
  desc?: string
  cert?: string
  part?: string
  blueprint?: string
  item?: string
  npc?: string
  contract?: Record<string, unknown>
  effects?: Array<Record<string, unknown>>
  market?: number
  houses?: string[]
  weight?: number
  once?: boolean
  needs?: Array<Record<string, unknown>>
  tags?: string[]
}

export interface BidderEntry extends ContentEntry {
  name: string
  npc?: string
  interests: LotKind[]
  weight?: number
}

export function houseProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!(isSafeInt(e.weekday) && e.weekday >= 0 && e.weekday <= 6)) p.push('weekday 要是 0～6 的整數（0 是週一）')
  if (!(SEGMENT_IDS as readonly unknown[]).includes(e.segment)) p.push(`segment 只能是 ${SEGMENT_IDS.join('、')}`)
  if (!range(e.lots, 1)) p.push('lots 要是 [最少, 最多]：兩個整數，最少 1、不超過最多')
  if (!(Array.isArray(e.kinds) && e.kinds.length > 0 && e.kinds.every(isLotKind))) p.push(`kinds 要是至少一種的陣列，每一項是 ${LOT_KINDS.join('、')} 之一`)
  if (e.must !== undefined) {
    if (!(Array.isArray(e.must) && e.must.every(isLotKind))) p.push(`must 要是拍品種類的陣列（${LOT_KINDS.join('、')}）`)
    else if (Array.isArray(e.kinds) && e.must.some((m) => !(e.kinds as unknown[]).includes(m))) p.push('must 的每一種都要在 kinds 裡')
  }
  if (!range(e.bidders, 0)) p.push('bidders 要是 [最少, 最多]：兩個整數，最少 0、不超過最多')
  if (!isRecord(e.member)) p.push('member 要是 { faction?, favor_min?, ref? }')
  else {
    const m = e.member
    if (m.faction !== undefined && !isText(m.faction)) p.push('member.faction 要是勢力的 id')
    if (m.favor_min !== undefined && !(isSafeInt(m.favor_min) && m.favor_min >= 0 && m.favor_min <= 100)) p.push('member.favor_min 要是 0～100 的整數')
    if (m.favor_min !== undefined && m.faction === undefined) p.push('member.favor_min 要和 member.faction 一起寫')
    if (m.ref !== undefined && typeof m.ref !== 'boolean') p.push('member.ref 要是 true 或 false')
  }
  return p
}

export function lotProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isLotKind(e.kind)) return [`kind 只能是 ${LOT_KINDS.join('、')}`]
  for (const f of ['name', 'desc', 'cert', 'part', 'blueprint', 'item', 'npc'] as const) if (e[f] !== undefined && !isText(e[f])) p.push(`${f} 要是非空的字串`)
  if (e.contract !== undefined && !isRecord(e.contract)) p.push('contract 要是 contract_hold 的參數（一個物件）')
  if (e.effects !== undefined && !(Array.isArray(e.effects) && e.effects.every((x) => isRecord(x) && isText(x.kind)))) p.push('effects 要是效果的陣列（每一筆有 kind）')
  if (e.market !== undefined && !(isSafeInt(e.market) && e.market > 0)) p.push('market 要是大於 0 的整數')
  if (e.houses !== undefined && !(textList(e.houses) && e.houses.length > 0)) p.push('houses 要是拍賣行 id 的陣列')
  if (e.weight !== undefined && !(isNum(e.weight) && e.weight > 0)) p.push('weight 要是大於 0 的數字')
  if (e.once !== undefined && typeof e.once !== 'boolean') p.push('once 要是 true 或 false')
  if (e.needs !== undefined && !(Array.isArray(e.needs) && e.needs.every(isRecord))) p.push('needs 要是條件的陣列')
  if (e.tags !== undefined && !textList(e.tags)) p.push('tags 要是字串的陣列')
  // kind 要的那一欄
  if (e.kind === 'part' && e.part === undefined) p.push('kind 是 part：要寫 part（零件的 id）')
  if (e.kind === 'cyberware' && e.blueprint === undefined) p.push('kind 是 cyberware：要寫 blueprint（義體設計圖的 id，拍的是它的原廠組合）')
  if (e.kind === 'art' && e.item === undefined) p.push('kind 是 art：要寫 item（那一件物品的 id）')
  if (e.kind === 'secret' && e.item === undefined && !(Array.isArray(e.effects) && e.effects.length > 0)) p.push('kind 是 secret：要寫 item（物品的 id）或 effects（得標時跑的效果）')
  if (e.kind === 'contract' && e.contract === undefined) p.push('kind 是 contract：要寫 contract（contract_hold 的參數）')
  // 零件與義體的市價從資料算，其餘一定要寫
  if ((e.kind === 'art' || e.kind === 'secret' || e.kind === 'contract') && e.market === undefined) p.push(`kind 是 ${String(e.kind)}：要寫 market（市價）`)
  return p
}

export function bidderProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (e.npc !== undefined && !isText(e.npc)) p.push('npc 要是認識的人的 id')
  if (!(Array.isArray(e.interests) && e.interests.length > 0 && e.interests.every(isLotKind))) p.push(`interests 要是至少一種的陣列（${LOT_KINDS.join('、')}）`)
  if (e.weight !== undefined && !(isNum(e.weight) && e.weight > 0)) p.push('weight 要是大於 0 的數字')
  return p
}

/** NPC 資料的選填欄位 auction_ref：true（每一家都寫得出推薦函）或拍賣行 id 的陣列。 */
export function npcRefProblems(v: unknown): string[] {
  if (v === true) return []
  return textList(v) && v.length > 0 ? [] : ['auction_ref 要是 true，或拍賣行 id 的陣列']
}

/** 設施種類的選填欄位 auction：{ house }。 */
export function facilityProblems(v: unknown): string[] {
  return isRecord(v) && isText(v.house) ? [] : ['auction 要是 { house: 拍賣行的 id }']
}

// ---- 狀態 state.ext.auction ----

export type LookResult = 'ok' | 'fake' | 'unknown'
export const LOOK_RESULTS: readonly LookResult[] = ['ok', 'fake', 'unknown']
export interface MemberRecord {
  by?: string
  at: number
}

export interface AuctionState {
  /** 推薦函：拍賣行 → 誰寫的、什麼時候拿到 */
  member: Record<string, MemberRecord>
  /** 停權：拍賣行 → 到什麼時候（分鐘）為止 */
  banned: Record<string, number>
  /** 看過的貨：`<拍賣行>:<場次>:<第幾件>` → 結果 */
  looked: Record<string, LookResult>
  /** 賣掉了的拍品（once 的不再出現）：拍品的 id */
  sold: string[]
  /** 去過的場次：拍賣行 → 那一場開槌日的天數 */
  done: Record<string, number>
  /** 一場拍賣進行中的狀態（M4-auction-bid；形狀見 bid.ts 的 Run） */
  run?: Record<string, unknown>
}

export const emptyAuction = (): AuctionState => ({ member: {}, banned: {}, looked: {}, sold: [], done: {} })

/** 讀 state.ext.auction：壞掉的整理掉，不丟錯。回傳的是複本。 */
export function auctionOf(state: Pick<GameState, 'ext'>): AuctionState {
  const raw = state.ext[EXT]
  const out = emptyAuction()
  if (!isRecord(raw)) return out
  if (isRecord(raw.member)) {
    for (const [h, m] of Object.entries(raw.member)) if (isRecord(m) && isSafeInt(m.at)) out.member[h] = { at: m.at, ...(isText(m.by) ? { by: m.by } : {}) }
  }
  if (isRecord(raw.banned)) for (const [h, n] of Object.entries(raw.banned)) if (isSafeInt(n)) out.banned[h] = n
  if (isRecord(raw.looked)) for (const [key, r] of Object.entries(raw.looked)) if ((LOOK_RESULTS as readonly unknown[]).includes(r)) out.looked[key] = r as LookResult
  if (Array.isArray(raw.sold)) for (const id of raw.sold) if (isText(id) && !out.sold.includes(id)) out.sold.push(id)
  if (isRecord(raw.done)) for (const [h, n] of Object.entries(raw.done)) if (isSafeInt(n)) out.done[h] = n
  if (isRecord(raw.run)) out.run = clone(raw.run)
  return out
}

export function writeAuction(state: Pick<GameState, 'ext'>, a: AuctionState): void {
  state.ext[EXT] = clone(a)
}

/** 一個拍品的鍵（記看貨的結果用）：拍賣行、場次（開槌日的天數）、第幾件（0 起算）。 */
export const lotKey = (house: string, day: number, index: number): string => `${house}:${day}:${index}`

/** 名字：先讀 npc 的內容，查不到用 id。 */
export function npcName(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, id: string): string {
  const n = state.actors[id]?.name ?? k.content.get('npc', id)?.name
  return isText(n) ? n : id
}

export function factionName(k: Pick<Kernel, 'content'>, id: string): string {
  if (!k.content.hasKind('faction')) return id
  const f = k.content.get('faction', id)
  const n = f?.short ?? f?.name
  return isText(n) ? n : id
}

export function houseOf(k: Pick<Kernel, 'content'>, id: string): HouseEntry | undefined {
  return k.content.hasKind(HOUSE_KIND) ? k.content.get<HouseEntry>(HOUSE_KIND, id) : undefined
}
