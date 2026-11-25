// L6 功能 curtain 的資料：規則表（curtain_rule）、夜（curtain_night）、這一區的預設規則、狀態 state.ext.curtain 的形狀與讀寫、週與日的算法。
// 規格：CYBERSPACE 8.7 節（比較表與共通的規則）、8.8 節（怎麼進去、一趟的結構開頭到報名、檔期主題、能不能反覆去、篩選關掉時）；LEWD_SYSTEM 1.1 節；
// dev/adr/0018 第六、十三節；dev/adr/0019 第十二節與 P56、P57；dev/work/M4-curtain-entry.md。
//
// 狀態 state.ext.curtain（只有這個功能寫）：
//   invite?    { until }                                   邀請函（總分鐘；三天有效）
//   member?    { tier, since, paid_until, suspended?, clears }   會員證（tier 是 floor／box／vip；paid_until 是會費繳到哪，總分鐘；clears 是在這個席次破關幾次）
//   taste      string[]                                    口味單（傾向標籤的 id）
//   interview_at?  總分鐘                                 上一次面談失敗的時間
//   week?      { index, feature, tips, runs, drawn }       這一週（index 是週數）：主打、這一週的打賞、每一天（遊戲的日子）報了幾場、每一天抽過哪幾個夜
//   run?       這一趟（報名時寫；場熱的起點、結算由 M4-curtain-run 接手）
//   tab?、gig? 帳與檔期（M4-curtain-fall）
// 沒有這一格的鍵都當作沒有；形狀不對的部分當成沒有（讀的函式回傳複製品）。

import type { ActorId, Change, ContentEntry, GameState, Kernel } from '../../core'
import { clone, isRecord, toMinutes, weeklyRule } from '../../core'

export const OWNER = 'curtain'
/** state.ext 的鍵 */
export const EXT = 'curtain'
export const RULE_KIND = 'curtain_rule'
export const NIGHT_KIND = 'curtain_night'
/** 一趟網內的行程的活動名字（features/netrun 的）：只用名字，不 import。 */
export const ACT_NETRUN = 'netrun'
/** 開那一趟時 origin.by 寫這個，掛點收到的 run.origin.by 用它認得「這是簾後館開的」。 */
export const ORIGIN_BY = 'curtain'
/** 這一區的 id（DATA 第 10 節：region 的 curtain）。 */
export const REGION_ID = 'curtain'

export const INVITE_EFFECT = 'curtain_invite'
export const MEMBER_CONDITION = 'curtain_member'

export const INTERVIEW_ACTION = 'curtain.interview'
export const TASTE_ACTION = 'curtain.taste'
export const ENTER_ACTION = 'curtain.enter'

/** 帳單項目的 id（掛點 bill.collect）。 */
export const FEE_BILL_ID = 'curtain_fee'

export const DAY_MINUTES = 1440

export type TierId = 'floor' | 'box' | 'vip'
export const TIER_IDS: readonly TierId[] = ['floor', 'box', 'vip']
export type InterviewSkill = 'negotiate' | 'perform'
export const INTERVIEW_SKILLS: readonly InterviewSkill[] = ['negotiate', 'perform']

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 規則表 curtain_rule（id: default） ----

export interface TierDef {
  id: TierId
  name: string
  /** 等級（II～IV） */
  grade: 2 | 3 | 4
  /** 街頭信譽要到第幾階（REP_TIERS 的序號：2 有號、3 搶手、4 頂尖） */
  rep_min: number
  /** 保證金（報名才付） */
  deposit: number
  /** 每週會費 */
  fee_weekly: number
  /** 破關獎金（下一張用） */
  prize: number
  /** 面談的 DC */
  interview_dc: number
}

export interface RefuseRule {
  /** 沉溺到這麼多不收 */
  sink: number
  /** 勢力的敵對值到這麼多不收 */
  hostility: number
  /** 查敵對值的勢力（內容匯入前是空的） */
  factions: string[]
}

export interface CurtainRules {
  tiers: TierDef[]
  /** 邀請函有效幾天 */
  invite_days: number
  /** 面談失敗幾天後才能再談 */
  interview_retry_days: number
  /** 會費連續幾週沒付就停權 */
  fee_grace_weeks: number
  /** 一晚最多幾場 */
  runs_per_night: number
  /** 同伴券：每一位乘等級 */
  companion_fee: number
  refuse: RefuseRule
  /** 口味單裡開著的標籤少於這個數就開純舞台場次 */
  taste_min: number
  /** 主打的打賞倍率（下一張用） */
  feature_bonus: number
  /** 升一席要在目前的席次破關幾次 */
  upgrade_clears: number
  /** 一隊最多幾個人 */
  max_party: number
  /** 會費在帳單裡的順序（DOWNTIME 5.1 節：會費類排在天使急救會費那一格） */
  fee_order: number
  /** 四幕的名字（一幕一層；CYBERSPACE 8.8 節） */
  acts: string[]
  /** 這一區的生成規則（net_region 的欄位；預設加上資料蓋掉的）。開那一趟時整筆放在 setup.region，再加上 safe: true、pressure: 'none' */
  region: Record<string, unknown>
}

/** 這一區的預設（CYBERSPACE 8.1 節密度表簾後館那一列）：9 × 7、挖 20～28 步、沒有追蹤度、每層 2～3 場遭遇。節點的細部（點單、賞箱、化妝室、後台巡邏）由 M4-curtain-run 補。 */
export const DEFAULT_REGION: Record<string, unknown> = {
  id: REGION_ID, name: '簾後館', map_kind: 'maze', size: [9, 7], carve: [20, 28], sight: 2, pressure: 'none', safe: true, cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { foe: [2, 3], patrol: [0, 0], archive: [1, 2], trap: [0, 1], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] },
}

export const DEFAULT_RULES: CurtainRules = {
  tiers: [
    { id: 'floor', name: '散座', grade: 2, rep_min: 2, deposit: 300, fee_weekly: 100, prize: 900, interview_dc: 13 },
    { id: 'box', name: '包廂', grade: 3, rep_min: 3, deposit: 1000, fee_weekly: 300, prize: 3000, interview_dc: 16 },
    { id: 'vip', name: '貴賓席', grade: 4, rep_min: 4, deposit: 3300, fee_weekly: 1000, prize: 9800, interview_dc: 19 },
  ],
  invite_days: 3,
  interview_retry_days: 7,
  fee_grace_weeks: 2,
  runs_per_night: 2,
  companion_fee: 100,
  refuse: { sink: 80, hostility: 40, factions: [] },
  taste_min: 3,
  feature_bonus: 1.2,
  upgrade_clears: 5,
  max_party: 4,
  fee_order: 6,
  acts: ['序幕・迎賓廳', '第一幕・舞台', '第二幕・後台', '終幕・貴賓席'],
  region: clone(DEFAULT_REGION),
}

// ---- 格式檢查 ----

function tierProblems(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 3) return ['tiers 要是三個席次（floor、box、vip，照順序）']
  const p: string[] = []
  raw.forEach((t, i) => {
    const at = `tiers[${i}]`
    if (!isRecord(t)) { p.push(`${at} 要是 { id, name, grade, rep_min, deposit, fee_weekly, prize, interview_dc }`); return }
    if (t.id !== TIER_IDS[i]) p.push(`${at}.id 要是 ${TIER_IDS[i]}（三個席次照 floor、box、vip 的順序）`)
    if (!isText(t.name)) p.push(`${at}.name 要有名字`)
    if (!(isInt(t.grade) && t.grade >= 2 && t.grade <= 4)) p.push(`${at}.grade 要是 2～4 的整數`)
    if (!(isInt(t.rep_min) && t.rep_min >= 0 && t.rep_min <= 5)) p.push(`${at}.rep_min 要是街頭信譽的階（0～5 的整數）`)
    for (const key of ['deposit', 'fee_weekly', 'prize'] as const) if (!(isInt(t[key]) && (t[key] as number) >= 0)) p.push(`${at}.${key} 要是 0 以上的整數`)
    if (!(isInt(t.interview_dc) && t.interview_dc >= 1 && t.interview_dc <= 40)) p.push(`${at}.interview_dc 要是 1～40 的整數`)
  })
  return p
}

/** 一筆規則表的格式檢查（內容種類 curtain_rule）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.tiers !== undefined) p.push(...tierProblems(e.tiers))
  for (const [key, lo, hi] of [['invite_days', 1, 60], ['interview_retry_days', 0, 365], ['fee_grace_weeks', 1, 52], ['runs_per_night', 1, 10], ['companion_fee', 0, 100000], ['taste_min', 0, 100], ['upgrade_clears', 0, 100], ['max_party', 1, 8], ['fee_order', 1, 10]] as const) {
    if (e[key] !== undefined && !(isInt(e[key]) && (e[key] as number) >= lo && (e[key] as number) <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  }
  if (e.feature_bonus !== undefined && !(isNum(e.feature_bonus) && e.feature_bonus >= 0 && e.feature_bonus <= 10)) p.push('feature_bonus 要是 0～10 的數字')
  if (e.refuse !== undefined) {
    const r = e.refuse
    if (!isRecord(r)) p.push('refuse 要是 { sink, hostility, factions }')
    else {
      for (const key of ['sink', 'hostility'] as const) if (r[key] !== undefined && !(isInt(r[key]) && (r[key] as number) >= 0 && (r[key] as number) <= 200)) p.push(`refuse.${key} 要是 0～200 的整數`)
      if (r.factions !== undefined && !(Array.isArray(r.factions) && r.factions.every(isText))) p.push('refuse.factions 要是勢力 id 的陣列')
    }
  }
  if (e.acts !== undefined && !(Array.isArray(e.acts) && e.acts.length >= 1 && e.acts.length <= 8 && e.acts.every(isText))) p.push('acts 要是一到八個幕的名字')
  if (e.region !== undefined && !isRecord(e.region)) p.push('region 要是 net_region 的欄位（只寫要蓋掉的）')
  return p
}

/** 一個夜（內容種類 curtain_night）。 */
export interface NightEntry extends ContentEntry {
  name: string
  /** 包場的勢力 */
  faction: string
  /** 對到的傾向與風格標籤 */
  tags: string[]
  /** 要開著的篩選標籤（例：契約之夜要 contract_dom） */
  needs_filter?: string
  /** 主題獎品（內容；這一張不用） */
  prize?: string | Record<string, unknown>
  /** 這一夜的敵人文化 */
  culture: string
}

export function nightProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要有名字')
  if (!isText(e.faction)) p.push('faction 要是包場的勢力的 id')
  if (!(Array.isArray(e.tags) && e.tags.length >= 1 && e.tags.every(isText))) p.push('tags 要是至少一個傾向或風格標籤的 id')
  if (e.needs_filter !== undefined && !isText(e.needs_filter)) p.push('needs_filter 要是篩選標籤的 id')
  if (e.prize !== undefined && !(isText(e.prize) || isRecord(e.prize))) p.push('prize 要是主題獎品（id 或一筆資料）')
  if (!isText(e.culture)) p.push('culture 要是這一夜的敵人文化')
  return p
}

// ---- 讀規則 ----

type Cx = Pick<Kernel, 'content'>

/** 現在生效的規則：curtain_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。region 是預設加上資料蓋掉的（layer 各項個別蓋）。 */
export function curtainRules(k: Cx): CurtainRules {
  const out: CurtainRules = clone(DEFAULT_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get(RULE_KIND, 'default') as Record<string, unknown> | undefined
  if (!e) return out
  const bad = new Set<string>(ruleProblems(e).map((m) => m.split(/[ .[]/)[0]!))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('tiers')) out.tiers = clone(e.tiers as TierDef[])
  for (const key of ['invite_days', 'interview_retry_days', 'fee_grace_weeks', 'runs_per_night', 'companion_fee', 'taste_min', 'upgrade_clears', 'max_party', 'fee_order', 'feature_bonus'] as const) if (ok(key)) out[key] = e[key] as number
  if (ok('refuse')) out.refuse = { ...out.refuse, ...clone(e.refuse as Partial<RefuseRule>) }
  if (ok('acts')) out.acts = [...(e.acts as string[])]
  if (ok('region')) {
    const over = e.region as Record<string, unknown>
    const base = out.region
    out.region = { ...base, ...clone(over), id: REGION_ID }
    out.region.layer = { ...(base.layer as Record<string, unknown>), ...(isRecord(over.layer) ? clone(over.layer) : {}) }
  }
  return out
}

export const tierOf = (rules: CurtainRules, id: string): TierDef | undefined => rules.tiers.find((t) => t.id === id)
export const tierIndex = (id: string): number => TIER_IDS.indexOf(id as TierId)

/** 內容裡的夜，照 id 排。沒有這個種類是空的。 */
export function allNights(k: Cx): NightEntry[] {
  if (!k.content.hasKind(NIGHT_KIND)) return []
  return k.content.list<NightEntry>(NIGHT_KIND).slice().sort((a, b) => (a.id < b.id ? -1 : 1))
}

// ---- 狀態 ----

export interface MemberRecord {
  tier: TierId
  /** 入會的時間（總分鐘） */
  since: number
  /** 會費繳到哪（總分鐘；下一個週一 06:00 之前不用再付） */
  paid_until: number
  suspended?: boolean
  /** 在這個席次破關幾次 */
  clears: number
}

export interface WeekRecord {
  /** 週數（照週一 06:00 算，和帳單的週數同一個算法） */
  index: number
  /** 主打的夜 */
  feature: string
  /** 這一週的打賞 */
  tips: number
  /** 遊戲的日子（深夜算前一天）→ 這一天報了幾場 */
  runs: Record<string, number>
  /** 遊戲的日子 → 這一天跑過哪幾個夜（同一個夜一天之內擲到兩次就重擲） */
  drawn: Record<string, string[]>
}

export interface RunRecord {
  /** 這一趟的編號 */
  id: string
  night: string
  tier: TierId
  grade: number
  /** 付的保證金 */
  deposit: number
  feature: boolean
  pure_stage: boolean
  /** 隊伍（含會員本人） */
  party: ActorId[]
  /** 付了同伴券的人（沒有打賞） */
  companions: ActorId[]
  /** 報名的時間（總分鐘） */
  at: number
  /** 從誰那裡報的名（遊戲的日子） */
  day: number
}

export interface CurtainState {
  invite?: { until: number }
  member?: MemberRecord
  taste: string[]
  interview_at?: number
  week?: WeekRecord
  run?: RunRecord
  /** 帳與檔期（M4-curtain-fall）：這一張原樣保留 */
  tab?: unknown
  gig?: unknown
}

const nat = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0)

function readMember(raw: unknown): MemberRecord | undefined {
  if (!isRecord(raw) || !(TIER_IDS as readonly unknown[]).includes(raw.tier) || !isInt(raw.since) || !isInt(raw.paid_until)) return undefined
  return { tier: raw.tier as TierId, since: raw.since, paid_until: raw.paid_until, ...(raw.suspended === true ? { suspended: true } : {}), clears: nat(raw.clears) }
}

function readWeek(raw: unknown): WeekRecord | undefined {
  if (!isRecord(raw) || !isInt(raw.index) || !isText(raw.feature)) return undefined
  const runs: Record<string, number> = {}
  if (isRecord(raw.runs)) for (const [d, n] of Object.entries(raw.runs)) if (isInt(n) && n > 0) runs[d] = n
  const drawn: Record<string, string[]> = {}
  if (isRecord(raw.drawn)) for (const [d, list] of Object.entries(raw.drawn)) if (Array.isArray(list)) drawn[d] = list.filter(isText)
  return { index: raw.index, feature: raw.feature, tips: nat(raw.tips), runs, drawn }
}

function readRun(raw: unknown): RunRecord | undefined {
  if (!isRecord(raw) || !isText(raw.id) || !isText(raw.night) || !(TIER_IDS as readonly unknown[]).includes(raw.tier) || !isInt(raw.grade)) return undefined
  return {
    id: raw.id, night: raw.night, tier: raw.tier as TierId, grade: raw.grade, deposit: nat(raw.deposit), feature: raw.feature === true, pure_stage: raw.pure_stage === true,
    party: Array.isArray(raw.party) ? raw.party.filter(isText) : [], companions: Array.isArray(raw.companions) ? raw.companions.filter(isText) : [], at: nat(raw.at), day: nat(raw.day),
  }
}

/** 讀 state.ext.curtain：沒有、或形狀不對的部分當成沒有（回傳的是複製品，改它不會動到狀態）。 */
export function readCurtain(state: Pick<GameState, 'ext'>): CurtainState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const member = readMember(r.member)
  const week = readWeek(r.week)
  const run = readRun(r.run)
  return {
    ...(isRecord(r.invite) && isInt(r.invite.until) ? { invite: { until: r.invite.until } } : {}),
    ...(member ? { member } : {}),
    taste: Array.isArray(r.taste) ? [...new Set(r.taste.filter(isText))] : [],
    ...(isInt(r.interview_at) ? { interview_at: r.interview_at } : {}),
    ...(week ? { week } : {}),
    ...(run ? { run } : {}),
    ...(r.tab !== undefined ? { tab: clone(r.tab) } : {}),
    ...(r.gig !== undefined ? { gig: clone(r.gig) } : {}),
  }
}

/** 寫狀態的變更（整筆換掉）。 */
export const curtainChange = (c: CurtainState): Change => ({ op: 'ext', key: EXT, value: clone(c) as unknown as Record<string, unknown> })

// ---- 時間與週 ----

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)

/** 現在是第幾週（照週一 06:00 算；和 features/bills 的週數同一個算法）。 */
export function weekIndexOf(k: Pick<Kernel, 'timeRules'>, minutes: number): number {
  const rule = weeklyRule(k.timeRules)
  return Math.floor((minutes - rule.offset) / rule.every) + 1
}

/** 第幾週的週一 06:00（總分鐘）。 */
export function mondayOf(k: Pick<Kernel, 'timeRules'>, week: number): number {
  const rule = weeklyRule(k.timeRules)
  return rule.offset + (week - 1) * rule.every
}

export const weekMinutes = (k: Pick<Kernel, 'timeRules'>): number => weeklyRule(k.timeRules).every

export const nameOfActor = (state: Pick<GameState, 'actors'>, id: ActorId): string => state.actors[id]?.name ?? id
