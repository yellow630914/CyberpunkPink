// L6 功能 channel 的資料與純函式：狀態的形狀（state.ext.channel）、規則（內建的預設加資料蓋掉）、讀取、頻道等級與導流階。
// 規格：MEDIA 第 4 節開頭、4.1、4.2、4.5（位子數）、4.8；dev/adr/0020 第二節、第十三節、V12～V16、V18、V19；dev/work/M5-channel.md。
//
// 內容種類：
//   channel_rule  { id: 'default', start_subs, name_max, churn: { active, idle }, reco_growth, over_step, quota_pct, level_at, seats, flow_cred, ai_subs: { pct, min }, max_catch_up, log_keep }
//                 蓋掉下面 DEFAULT_CHANNEL_RULES 的數字（規則表，overridable）。觸發點的機率不在這裡（那是 event_scope 的事）。
//
// 狀態 state.ext.channel（形狀見 ChannelState）。**只經由下面這幾種變更改**（ops.ts 註冊；一份報告可以疊好幾筆，不會互相蓋掉）：
//   channel.open { name, at }                       開頻道
//   channel.budget { pool, cred?, cash?, quota? }   預算的一格加減（自有 own 或某個勢力的公帳）
//   channel.sponsor { sponsor }                     帶來一份贊助（同一個勢力已經有的，換成新的）
//   channel.sponsor_set { faction, weeks_left_to_pay?, eps_since_plug? }
//   channel.sponsor_end { faction }                 終止贊助
//   channel.week { episodes?, lives?, adult_reco?, reset?, mark? }   這一週的計數
//   channel.log { entry }                           記一集（只留最近 log_keep 筆）

import type { GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { ContentEntry } from '../../core'

export const OWNER = 'channel'
export const EXT = 'channel'
export const RULE_KIND = 'channel_rule'

export const SUBS = 'subs'
export const CREDIBILITY = 'credibility'
export const RECO = 'reco'
export const FLOW_TIER_STAT = 'flow_tier'

export const OPEN_ACTION = 'channel.open'
export const FUND_ACTION = 'channel.fund'
export const WITHDRAW_ACTION = 'channel.withdraw'
export const SPONSOR_END_ACTION = 'channel.sponsor_end'
export const WEEKLY_ACTION = 'channel.weekly'
/** 每週結算帶的觸發點（EVENTS 3.1 節要補的；範圍 channel） */
export const WEEK_TRIGGER = 'channel_week'
/** 自有資金那一格在 pool 欄位的名字 */
export const OWN = 'own'

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const own = (o: object | undefined, key: string): boolean => !!o && Object.hasOwn(o, key)
const nat = (v: unknown): number => (isSafeInt(v) && v > 0 ? v : 0)

// ---- 規則 ----

export interface ChannelRules {
  /** 新頻道的訂閱（MEDIA 4.4：從 100 起算） */
  start_subs: number
  /** 頻道名字最多幾個字（玩家打的字原樣存，超過的由引擎照字截斷） */
  name_max: number
  /** 每週流失的百分比：那一週開過節目或直播（active），或一集都沒開（idle）（V12） */
  churn: { active: number; idle: number }
  /** 推薦權重每一點每週帶來的訂閱百分比（V13；負的就是多流失） */
  reco_growth: number
  /** 超領公帳：每超過這麼多，那個勢力好感 −1、敵對值 +1（MEDIA 4.2） */
  over_step: number
  /** 每一次撥款進來，額度增加撥款的幾 % */
  quota_pct: number
  /** 頻道等級的門檻：訂閱到這個數升一級（MEDIA 4.5：1,000、10,000） */
  level_at: number[]
  /** 1 級的位子數（每升一級多一格） */
  seats: number
  /** 公信力到這個數，導流階 +1（MEDIA 4.1） */
  flow_cred: number
  /** AI 一件事能動的訂閱：現值的 pct %，最少 min（0020 第十三節） */
  ai_subs: { pct: number; min: number }
  /** 一次時間跳過很多週時最多補結幾週 */
  max_catch_up: number
  /** 最近的集數記幾筆 */
  log_keep: number
}

export const DEFAULT_CHANNEL_RULES: ChannelRules = {
  start_subs: 100, name_max: 20, churn: { active: 2, idle: 5 }, reco_growth: 1, over_step: 500, quota_pct: 20, level_at: [1000, 10000], seats: 2, flow_cred: 60,
  ai_subs: { pct: 2, min: 20 }, max_catch_up: 8, log_keep: 10,
}

const pct = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
const smallInt = (v: unknown, min: number, max: number): v is number => isSafeInt(v) && v >= min && v <= max
const levelList = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every((n) => isSafeInt(n) && n >= 1) && v.every((n, i) => i === 0 || n > (v as number[])[i - 1]!)

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of [['start_subs', 0, 1_000_000], ['name_max', 1, 100], ['over_step', 1, 1_000_000], ['seats', 1, 6], ['flow_cred', 0, 100], ['max_catch_up', 1, 520], ['log_keep', 1, 100]] as const) {
    if (e[key] !== undefined && !smallInt(e[key], lo, hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  }
  if (e.reco_growth !== undefined && !pct(e.reco_growth)) p.push('reco_growth 要是 0～100 的數字（百分比）')
  if (e.quota_pct !== undefined && !pct(e.quota_pct)) p.push('quota_pct 要是 0～100 的數字（百分比）')
  if (e.churn !== undefined) {
    if (!isRecord(e.churn)) p.push('churn 要是 { active, idle }')
    else for (const f of ['active', 'idle']) if (e.churn[f] !== undefined && !pct(e.churn[f])) p.push(`churn.${f} 要是 0～100 的數字（百分比）`)
  }
  if (e.level_at !== undefined && !levelList(e.level_at)) p.push('level_at 要是由小到大、1 以上的整數陣列（最多 8 個）')
  if (e.ai_subs !== undefined) {
    if (!isRecord(e.ai_subs)) p.push('ai_subs 要是 { pct, min }')
    else {
      if (e.ai_subs.pct !== undefined && !pct(e.ai_subs.pct)) p.push('ai_subs.pct 要是 0～100 的數字（百分比）')
      if (e.ai_subs.min !== undefined && !smallInt(e.ai_subs.min, 0, 1_000_000)) p.push('ai_subs.min 要是 0～1000000 的整數')
    }
  }
  return p
}

/** 現在生效的規則：資料 channel_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function channelRules(k: Pick<Kernel, 'content'>): ChannelRules {
  const d = DEFAULT_CHANNEL_RULES
  const out: ChannelRules = { ...d, churn: { ...d.churn }, level_at: [...d.level_at], ai_subs: { ...d.ai_subs } }
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  for (const [key, lo, hi] of [['start_subs', 0, 1_000_000], ['name_max', 1, 100], ['over_step', 1, 1_000_000], ['seats', 1, 6], ['flow_cred', 0, 100], ['max_catch_up', 1, 520], ['log_keep', 1, 100]] as const) {
    if (smallInt(e[key], lo, hi)) out[key] = e[key]
  }
  if (pct(e.reco_growth)) out.reco_growth = e.reco_growth
  if (pct(e.quota_pct)) out.quota_pct = e.quota_pct
  if (isRecord(e.churn)) for (const f of ['active', 'idle'] as const) if (pct(e.churn[f])) out.churn[f] = e.churn[f] as number
  if (levelList(e.level_at)) out.level_at = [...e.level_at]
  if (isRecord(e.ai_subs)) {
    if (pct(e.ai_subs.pct)) out.ai_subs.pct = e.ai_subs.pct
    if (smallInt(e.ai_subs.min, 0, 1_000_000)) out.ai_subs.min = e.ai_subs.min
  }
  return out
}

// ---- 狀態 ----

export interface Purse {
  cred: number
  cash: number
}

export interface Pool {
  cred: number
  quota: number
}

/** 一份贊助（MEDIA 4.2；V19）。 */
export interface Sponsor {
  faction: string
  /** 每幾週撥一次 */
  every_weeks: number
  /** 每次撥多少 */
  amount: number
  /** 每幾集要掛一次它的業配（沒寫就不要求） */
  plug_every?: number
  /** 掛一次業配另外拿多少（下一張用） */
  plug_pay?: number
  /** 不能報的對象 */
  no_report?: { faction?: string; npc?: string }
  /** 不准開的節目等級或種類（下一張用） */
  tiers_off?: string[]
  /** 開始的時間（總分鐘） */
  since: number
  /** 還有幾週撥下一次（每週一減 1，到 0 撥款並重設成 every_weeks） */
  weeks_left_to_pay: number
  /** 離上次掛業配過了幾集（下一張在每一集加） */
  eps_since_plug: number
}

export interface Episode {
  at: number
  kind: 'live' | 'show'
  show?: string
  tier?: string | number
  grade?: string | number
  heat?: number
  subs: number
  tips: number
  note: string
}

export interface ChannelWeek {
  /** 這一週開過幾集節目 */
  episodes: number
  /** 這一週收播過幾場直播 */
  lives: number
  /** 成人檔的推薦權重 −1 這一週已經用過了（V13：每週最多一次） */
  adult_reco: boolean
}

export interface ChannelState {
  open: boolean
  name: string
  /** 開頻道的時間（總分鐘） */
  since: number
  /** 每週結算做到哪一個週一（總分鐘；開頻道時是那一刻）。出了副本之後，從這裡到現在跨過的週一一次補結 */
  mark: number
  budget: { own: Purse; pools: Record<string, Pool> }
  sponsors: Sponsor[]
  week: ChannelWeek
  /** 最近的集數（舊的在前） */
  log: Episode[]
}

export const blankChannel = (): ChannelState => ({
  open: false, name: '', since: 0, mark: 0, budget: { own: { cred: 0, cash: 0 }, pools: {} }, sponsors: [], week: { episodes: 0, lives: 0, adult_reco: false }, log: [],
})

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function readSponsor(v: unknown): Sponsor | null {
  if (!isRecord(v) || !isText(v.faction) || !isSafeInt(v.every_weeks) || v.every_weeks < 1 || !isSafeInt(v.amount) || v.amount < 0) return null
  const nr = isRecord(v.no_report) ? { ...(isText(v.no_report.faction) ? { faction: v.no_report.faction } : {}), ...(isText(v.no_report.npc) ? { npc: v.no_report.npc } : {}) } : null
  return {
    faction: v.faction, every_weeks: v.every_weeks, amount: v.amount,
    ...(isSafeInt(v.plug_every) && v.plug_every >= 1 ? { plug_every: v.plug_every } : {}),
    ...(isSafeInt(v.plug_pay) && v.plug_pay >= 0 ? { plug_pay: v.plug_pay } : {}),
    ...(nr && Object.keys(nr).length > 0 ? { no_report: nr } : {}),
    ...(Array.isArray(v.tiers_off) ? { tiers_off: v.tiers_off.filter(isText) } : {}),
    since: isSafeInt(v.since) ? v.since : 0,
    weeks_left_to_pay: isSafeInt(v.weeks_left_to_pay) && v.weeks_left_to_pay >= 0 ? v.weeks_left_to_pay : v.every_weeks,
    eps_since_plug: nat(v.eps_since_plug),
  }
}

function readEpisode(v: unknown): Episode | null {
  if (!isRecord(v) || (v.kind !== 'live' && v.kind !== 'show') || !isSafeInt(v.at)) return null
  return {
    at: v.at, kind: v.kind, ...(isText(v.show) ? { show: v.show } : {}),
    ...(typeof v.tier === 'string' || finite(v.tier) ? { tier: v.tier } : {}), ...(typeof v.grade === 'string' || finite(v.grade) ? { grade: v.grade } : {}),
    ...(finite(v.heat) ? { heat: v.heat } : {}), subs: finite(v.subs) ? v.subs : 0, tips: finite(v.tips) ? v.tips : 0, note: typeof v.note === 'string' ? v.note : '',
  }
}

/** 讀 state.ext.channel：沒有、或形狀不對的部分當成空的（回傳的是新物件，改它不會動到狀態）。 */
export function readChannel(state: Pick<GameState, 'ext'>): ChannelState {
  const raw = state.ext?.[EXT]
  const r = isRecord(raw) ? raw : {}
  const b = isRecord(r.budget) ? r.budget : {}
  const o = isRecord(b.own) ? b.own : {}
  const pools: Record<string, Pool> = {}
  if (isRecord(b.pools)) for (const [id, v] of Object.entries(b.pools)) if (own(b.pools, id) && id !== '__proto__' && isRecord(v)) pools[id] = { cred: nat(v.cred), quota: nat(v.quota) }
  const sponsors = (Array.isArray(r.sponsors) ? r.sponsors : []).map(readSponsor).filter((s): s is Sponsor => s !== null)
  const w = isRecord(r.week) ? r.week : {}
  return {
    open: r.open === true, name: typeof r.name === 'string' ? r.name : '', since: isSafeInt(r.since) ? r.since : 0, mark: isSafeInt(r.mark) ? r.mark : 0,
    budget: { own: { cred: nat(o.cred), cash: nat(o.cash) }, pools },
    sponsors, week: { episodes: nat(w.episodes), lives: nat(w.lives), adult_reco: w.adult_reco === true },
    log: (Array.isArray(r.log) ? r.log : []).map(readEpisode).filter((e): e is Episode => e !== null),
  }
}

/** 寫回的值（ext 變更用）。 */
export const channelValue = (c: ChannelState): ChannelState => JSON.parse(JSON.stringify(c)) as ChannelState

export const channelOpen = (state: Pick<GameState, 'ext'>): boolean => readChannel(state).open

// ---- 等級與導流階 ----

/** 頻道等級：沒有頻道是 0；其餘從 1 起，訂閱到一個門檻升一級。 */
export function levelOf(rules: ChannelRules, subs: number): number {
  return 1 + rules.level_at.filter((t) => subs >= t).length
}

/** 位子數：1 級 seats 格（預設 2），每升一級多一格（MEDIA 4.5）。 */
export const seatsOf = (rules: ChannelRules, level: number): number => (level < 1 ? 0 : rules.seats + level - 1)

/** 導流階（MEDIA 4.1）：訂閱的位數 −3（一千 1、一萬 2、十萬 3、百萬 4；不到一千是 0），公信力 flow_cred 以上再 +1。沒開頻道是 0。 */
export function flowTierOf(rules: ChannelRules, open: boolean, subs: number, credibility: number): number {
  if (!open) return 0
  const digits = String(Math.max(0, Math.trunc(subs))).length
  return Math.max(0, digits - 3) + (credibility >= rules.flow_cred ? 1 : 0)
}
