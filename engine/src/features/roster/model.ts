// L6 功能 roster 的資料與純函式：狀態的形狀、規則、容量、有沒有空、招募的 DC、出場費。不碰登錄表（登記在 index.ts）。
// 規格：FIXER 第 6 節；NPC_SYSTEM 第 10 節（10.0 隊伍、10.1 兩種、10.2 招募、10.4 忠誠、10.5 薪水與分紅、10.7 候選人）；
// COMMISSIONS 6.1 節；dev/adr/0016 第三、五節與 G4；dev/work/M2-roster.md。
//
// 成員一律是 state.actors 裡的角色（要進名冊的人由呼叫的人先變成角色）；這個功能不 import 別的功能：
// 親密度、信譽、忠誠只經由 meterOf；人身上的狀況只看核心共用的 actor.conditions；路數與階數只讀 actor.ext.paths（DATA 第 8 節）。

import type { ContentEntry, GameState, GameTime, Kernel } from '../../core'
import { attrMod, clone, hash32, isRecord, isSafeInt, meterOf, repTierOf, toMinutes } from '../../core'

export const OWNER = 'roster'
/** state.ext 的鍵 */
export const EXT = 'roster'
export const RULE_KIND = 'roster_rule'
export const RECRUIT_KIND = 'npc_recruit'

/** 核心共用的字彙（dev/adr/0016 第三節）：身上有這幾個狀態的人現在沒空。 */
export const BUSY_CONDITIONS = ['busy', 'injured', 'lying_low', 'arrested'] as const
export const BUSY_TEXT: Record<(typeof BUSY_CONDITIONS)[number], (name: string) => string> = {
  busy: (n) => `${n}正在忙別的事，現在沒空。`,
  injured: (n) => `${n}受傷了，現在沒空。`,
  lying_low: (n) => `${n}正在躲風頭，現在沒空。`,
  arrested: (n) => `${n}被抓了，現在沒空。`,
}

// ---- 狀態 ----

export type PayKind = 'fee' | 'share'
export const PAY_KINDS: readonly PayKind[] = ['fee', 'share']
/** 候選人的來源：救過的（忠誠起始 50）、介紹的（40）；沒寫就是一般的（30） */
export const SOURCES = ['rescued', 'introduced'] as const
export type CandidateSource = (typeof SOURCES)[number]

export interface Member {
  since: GameTime
  /** 可靠度 0～100：這個人的脾氣，生成時決定，幾乎不變（NPC_SYSTEM 10.4） */
  reliability: number
  /** 出場費（每件委託一筆）或分紅 */
  pay: PayKind
  /** 固定夥伴（拿分紅；連兩週沒召集不扣忠誠） */
  fixed?: true
  /** 最近一次被召集的時間（進名冊時是進來那一刻） */
  last_called: GameTime
  /** 每週薪水（現金；沒設就沒有）：給每週帳單接的（weeklyPay） */
  weekly?: number
}

export interface Candidate {
  who: string
  at: GameTime
  source?: CandidateSource
}

export interface RosterState {
  members: Record<string, Member>
  tagalong: string[]
  candidates: Candidate[]
  /** 招募時「再想想」的人：睡一覺之後才能再問 */
  thinking: string[]
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTime = (v: unknown): v is GameTime => isRecord(v) && isSafeInt(v.day) && isSafeInt(v.hour) && isSafeInt(v.minute)
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

/** 讀 state.ext.roster：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function readRoster(state: Pick<GameState, 'ext'>): RosterState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const members: Record<string, Member> = {}
  if (isRecord(r.members)) {
    for (const [id, m] of Object.entries(r.members)) {
      if (!isRecord(m) || !isTime(m.since) || !isTime(m.last_called) || !(PAY_KINDS as readonly unknown[]).includes(m.pay)) continue
      members[id] = {
        since: clone(m.since), last_called: clone(m.last_called), pay: m.pay as PayKind,
        reliability: typeof m.reliability === 'number' && Number.isFinite(m.reliability) ? m.reliability : 50,
        ...(m.fixed === true ? { fixed: true as const } : {}),
        ...(isSafeInt(m.weekly) && m.weekly > 0 ? { weekly: m.weekly } : {}),
      }
    }
  }
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText) : [])
  const candidates = Array.isArray(r.candidates)
    ? r.candidates.filter((c): c is Record<string, unknown> => isRecord(c) && isText(c.who) && isTime(c.at)).map((c) => ({
      who: c.who as string, at: clone(c.at as GameTime), ...((SOURCES as readonly unknown[]).includes(c.source) ? { source: c.source as CandidateSource } : {}),
    }))
    : []
  return { members, tagalong: ids(r.tagalong), candidates, thinking: ids(r.thinking) }
}

/** 變更用：把整理好的狀態放回 state.ext。 */
export function writeRoster(state: Pick<GameState, 'ext'>, r: RosterState): void {
  state.ext[EXT] = clone(r)
}

export const isMember = (state: Pick<GameState, 'ext'>, id: string): boolean => own(readRoster(state).members, id)
export const nameOf = (state: Pick<GameState, 'actors'>, id: string): string => (own(state.actors, id) ? state.actors[id]!.name : id)

// ---- 規則（數字照設計書；內容種類 roster_rule，id: default 蓋掉）----

export interface RosterRules {
  /** 名冊容量 = cap_base ＋ mod(魅力) ＋ 人面階數 × cap_per_face（FIXER 第 6 節：3、2） */
  cap_base: number
  cap_per_face: number
  /** 人面那一棵樹：路數的 id，或路數內容的 tree 欄位（DATA 第 2 節：fixer／人面） */
  face_path: string
  face_tree: string
  /** 隊伍含主角最多幾人、同行最多幾位（NPC_SYSTEM 10.0：4、2） */
  party_max: number
  tagalong_max: number
  /** 招募的 DC = recruit_base − ⌊親密度 ÷ recruit_affinity_step⌋ ＋ recruit_per_tier × max(0, 他的主職階數 − 你的信譽階序)（10.2：16、10、2） */
  recruit_base: number
  recruit_affinity_step: number
  recruit_per_tier: number
  /** 差一點：失敗而差距小於這個數就是「再想想」（設計書寫「部分成功」，工單寫「差一點的」；暫定 3，和「是，但是」的邊界同一個數） */
  recruit_think_margin: number
  /** 進名冊時的忠誠：一般、救過的、介紹的（10.7：30、50、40） */
  loyalty_start: number
  loyalty_rescued: number
  loyalty_introduced: number
  /** 連續 idle_weeks 週沒召集，忠誠加 idle_delta（10.4：2 週、−2）；戰鬥裡倒下 down_delta（−3）；週薪沒付成 unpaid_delta（−8，DOWNTIME 5.1 節第 8 項） */
  idle_weeks: number
  idle_delta: number
  down_delta: number
  unpaid_delta: number
  /** 每週結帳時，忠誠 leave_at 以下的人有 leave_chance 的機會離開（10.4：20、30%） */
  leave_at: number
  leave_chance: number
  /** 出場費 = 主職階數² × fee_base ×（1 ± fee_spread，照人固定）（10.5：200、25%）；信譽階序比他低 +fee_low_rep；忠誠在 low_loyalty_min～max +fee_low_loyalty（10.4：20～39、25%） */
  fee_base: number
  fee_spread: number
  fee_low_rep: number
  fee_low_loyalty: number
  low_loyalty_min: number
  low_loyalty_max: number
  /** 可靠度生成的範圍（10.4 只說「生成時決定、幾乎不變」，範圍設計書沒寫） */
  reliability_min: number
  reliability_max: number
}

export const DEFAULT_ROSTER_RULES: RosterRules = {
  cap_base: 3, cap_per_face: 2, face_path: 'fixer', face_tree: '人面',
  party_max: 4, tagalong_max: 2,
  recruit_base: 16, recruit_affinity_step: 10, recruit_per_tier: 2, recruit_think_margin: 3,
  loyalty_start: 30, loyalty_rescued: 50, loyalty_introduced: 40,
  idle_weeks: 2, idle_delta: -2, down_delta: -3, unpaid_delta: -8,
  leave_at: 20, leave_chance: 0.3,
  fee_base: 200, fee_spread: 0.25, fee_low_rep: 0.2, fee_low_loyalty: 0.25, low_loyalty_min: 20, low_loyalty_max: 39,
  reliability_min: 30, reliability_max: 80,
}

const NUM_FIELDS: Array<[keyof RosterRules, number, number]> = [
  ['cap_base', 0, 100], ['cap_per_face', 0, 20], ['party_max', 1, 4], ['tagalong_max', 0, 10],
  ['recruit_base', 1, 60], ['recruit_affinity_step', 1, 100], ['recruit_per_tier', 0, 20], ['recruit_think_margin', 0, 20],
  ['loyalty_start', 0, 100], ['loyalty_rescued', 0, 100], ['loyalty_introduced', 0, 100],
  ['idle_weeks', 1, 52], ['leave_at', 0, 100], ['low_loyalty_min', 0, 100], ['low_loyalty_max', 0, 100],
  ['fee_base', 0, 100000], ['reliability_min', 0, 100], ['reliability_max', 0, 100],
]
const RATIO_FIELDS: Array<[keyof RosterRules, number, number]> = [['leave_chance', 0, 1], ['fee_spread', 0, 1], ['fee_low_rep', 0, 5], ['fee_low_loyalty', 0, 5]]
const NEG_FIELDS: Array<keyof RosterRules> = ['idle_delta', 'down_delta', 'unpaid_delta']
const TEXT_FIELDS: Array<keyof RosterRules> = ['face_path', 'face_tree']

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of NUM_FIELDS) if (e[key] !== undefined && !(isSafeInt(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  for (const [key, lo, hi] of RATIO_FIELDS) if (e[key] !== undefined && !(typeof e[key] === 'number' && Number.isFinite(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的數字`)
  for (const key of NEG_FIELDS) if (e[key] !== undefined && !(isSafeInt(e[key]) && e[key] <= 0)) p.push(`${key} 要是 0 或負整數（忠誠的減少）`)
  for (const key of TEXT_FIELDS) if (e[key] !== undefined && !isText(e[key])) p.push(`${key} 要是文字`)
  if (e.reliability_min !== undefined && e.reliability_max !== undefined && isSafeInt(e.reliability_min) && isSafeInt(e.reliability_max) && e.reliability_min > e.reliability_max) p.push('reliability_min 不能比 reliability_max 大')
  if (e.low_loyalty_min !== undefined && e.low_loyalty_max !== undefined && isSafeInt(e.low_loyalty_min) && isSafeInt(e.low_loyalty_max) && e.low_loyalty_min > e.low_loyalty_max) p.push('low_loyalty_min 不能比 low_loyalty_max 大')
  return p
}

/** 現在生效的規則：資料 roster_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function rosterRules(k: Pick<Kernel, 'content'>): RosterRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: RosterRules = { ...DEFAULT_ROSTER_RULES }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(' ')[0]))
  for (const key of Object.keys(out) as Array<keyof RosterRules>) {
    if (e[key] === undefined || bad.has(key)) continue
    ;(out[key] as unknown) = e[key]
  }
  return out
}

// ---- 路數與階數（actor.ext.paths；DATA 第 8 節）----

export interface PathRow {
  path: string
  slot: string
  tier: number
}

export function pathsOf(state: Pick<GameState, 'actors'>, id: string): PathRow[] {
  const raw = own(state.actors, id) ? state.actors[id]!.ext.paths : undefined
  return Array.isArray(raw) ? raw.filter((r): r is PathRow => isRecord(r) && isText(r.path) && isSafeInt(r.tier)).map((r) => ({ path: r.path, slot: String(r.slot ?? ''), tier: r.tier })) : []
}

/** 是不是行者：有路數（成員的角色帶 ext.paths）。街坊與職員沒有。 */
export const isRunner = (state: Pick<GameState, 'actors'>, id: string): boolean => pathsOf(state, id).length > 0

/** 主職階數：slot 是 main 的那一列；沒有 main 取最高的一列；沒有路數是 0。 */
export function mainTier(state: Pick<GameState, 'actors'>, id: string): number {
  const rows = pathsOf(state, id)
  const main = rows.find((r) => r.slot === 'main')
  return main ? main.tier : Math.max(0, ...rows.map((r) => r.tier))
}

/** 人面階數：這個人的路數裡屬於人面那棵樹的最高階；技能的衍生數值 face_tier 有人註冊就也算（取大的）；讀不到是 0。 */
export function faceTier(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: string): number {
  const rules = rosterRules(k)
  let tier = 0
  for (const r of pathsOf(state, id)) {
    if (r.path === rules.face_path || k.content.get<ContentEntry & { tree?: unknown }>('path', r.path)?.tree === rules.face_tree) tier = Math.max(tier, r.tier)
  }
  if (own(state.actors, id) && k.stats.hasStat('face_tier')) tier = Math.max(tier, k.stats.stat(state, id, 'face_tier'))
  return Math.max(0, tier)
}

// ---- 容量 ----

/** 名冊容量：3 ＋ mod(魅力) ＋ 人面階數 × 2。沒有這個角色是 0。 */
export function rosterCap(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: string | null = state.pc): number {
  if (id === null || !own(state.actors, id)) return 0
  const rules = rosterRules(k)
  return Math.max(0, rules.cap_base + attrMod(k.stats.effectiveAttr(state, id, 'charm')) + faceTier(k, state, id) * rules.cap_per_face)
}

/** 名冊現在有幾個人。 */
export const rosterSize = (state: Pick<GameState, 'ext'>): number => Object.keys(readRoster(state).members).length

// ---- 有空沒有 ----

/** 這個人身上有沒有這個狀態（到期的不算；沒寫到期的一直算）。 */
export function hasCondition(state: Pick<GameState, 'actors' | 'time'>, id: string, condition: string): boolean {
  const a = own(state.actors, id) ? state.actors[id] : undefined
  if (!a) return false
  const now = toMinutes(state.time)
  return a.conditions.some((c) => c.id === condition && (c.until === undefined || c.until > now))
}

/** 現在沒空的原因，一條一個狀態（給玩家看的完整句子）；有空是空的。 */
export function busyReasons(state: Pick<GameState, 'actors' | 'time'>, id: string): string[] {
  const name = nameOf(state, id)
  return BUSY_CONDITIONS.filter((c) => hasCondition(state, id, c)).map((c) => BUSY_TEXT[c](name))
}

// ---- 招募 ----

export interface DcMod {
  label: string
  value: number
}

/** 招募的 DC 與每一條來源（合計就是 dc，還沒加存檔的難度偏移）。親密度與信譽沒有人定義時當 0。 */
export function recruitDc(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, id: string): { dc: number; mods: DcMod[] } {
  const rules = rosterRules(k)
  const mods: DcMod[] = [{ label: '招募的底', value: rules.recruit_base }]
  const affinity = meterOf(k, state, 'affinity', id)
  const step = Math.floor(affinity / rules.recruit_affinity_step)
  if (step !== 0) mods.push({ label: `親密度 ${affinity}`, value: -step })
  const tier = mainTier(state, id)
  const rep = repTierOf(meterOf(k, state, 'rep'))
  const gap = Math.max(0, tier - rep)
  if (gap > 0) mods.push({ label: `他的主職 ${tier} 階，你的信譽階序是 ${rep}`, value: rules.recruit_per_tier * gap })
  return { dc: mods.reduce((s, m) => s + m.value, 0), mods }
}

/** 現在能不能招募他：回傳擋住的原因（給玩家看的完整句子），可以就是 null。 */
export function recruitBlock(k: Pick<Kernel, 'content' | 'stats' | 'meters'>, state: GameState, id: string | undefined): string | null {
  if (id === undefined || id === '') return '要先指定對象。'
  if (id === state.pc) return '你不用招募自己。'
  if (!own(state.actors, id)) return `查不到 ${id} 這個人：要先認識他。`
  const name = state.actors[id]!.name
  const r = readRoster(state)
  if (own(r.members, id)) return `${name}已經在你的名冊上了。`
  if (!isRunner(state, id)) return `${name}不是行者，沒辦法招募（街坊與職員只能同行）。`
  if (r.thinking.includes(id)) return `${name}說要再想想：睡一覺之後才能再問。`
  const cap = rosterCap(k, state)
  const size = Object.keys(r.members).length
  if (size >= cap) return `名冊滿了（${size}／${cap}）：要先騰出位子才能再招募。`
  return null
}

// ---- 出場費與薪水 ----

/** 他拿的是出場費還是分紅；不在名冊上是 null。 */
export function payOf(state: Pick<GameState, 'ext'>, id: string): PayKind | null {
  return readRoster(state).members[id]?.pay ?? null
}

/** 照人固定的浮動（−fee_spread～+fee_spread）：同一個人、同一局永遠一樣。 */
function spreadOf(state: Pick<GameState, 'rng'>, rules: RosterRules, id: string): number {
  return rules.fee_spread * ((((hash32('roster_fee', state.rng.seed, id) >>> 0) % 2001) / 1000) - 1)
}

/**
 * 他一件委託的出場費：主職階數² × 200 ×（1 ± 25%，照人固定）；信譽階序比他低再 +20%；忠誠 20～39 再 +25%。
 * 拿分紅的、不在名冊上的人是 0。同一個人每次問數字都一樣（浮動只看種子與他的 id）。
 */
export function feeOf(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, id: string): number {
  if (payOf(state, id) !== 'fee' || !own(state.actors, id)) return 0
  const rules = rosterRules(k)
  const tier = Math.max(1, mainTier(state, id))
  let fee = tier * tier * rules.fee_base * (1 + spreadOf(state, rules, id))
  if (repTierOf(meterOf(k, state, 'rep')) < tier) fee *= 1 + rules.fee_low_rep
  const loyalty = meterOf(k, state, 'loyalty', id)
  if (loyalty >= rules.low_loyalty_min && loyalty <= rules.low_loyalty_max) fee *= 1 + rules.fee_low_loyalty
  return Math.round(fee)
}

/** 這一週要付的薪水：只有設了週薪的成員（拿分紅的不在這裡）；照角色 id 排。給每週帳單接（order 8、付現金）。 */
export function weeklyPay(state: Pick<GameState, 'ext' | 'actors'>): Array<{ who: string; name: string; amount: number }> {
  const r = readRoster(state)
  return Object.keys(r.members).sort()
    .filter((id) => r.members[id]!.pay === 'fee' && r.members[id]!.weekly !== undefined)
    .map((id) => ({ who: id, name: nameOf(state, id), amount: r.members[id]!.weekly! }))
}

// ---- 進名冊要用的幾個數字 ----

/** 這個來源的忠誠起始值。 */
export function startLoyalty(rules: RosterRules, source: CandidateSource | undefined): number {
  return source === 'rescued' ? rules.loyalty_rescued : source === 'introduced' ? rules.loyalty_introduced : rules.loyalty_start
}

/** 可靠度：生成時決定、照人固定（同一局同一個人永遠一樣），落在規則的範圍裡。 */
export function reliabilityOf(state: Pick<GameState, 'rng'>, rules: RosterRules, id: string): number {
  const span = rules.reliability_max - rules.reliability_min
  return rules.reliability_min + ((hash32('roster_reliability', state.rng.seed, id) >>> 0) % (span + 1))
}
