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
//   channel.staff { role, staff }                   編制的一個位子坐上一個人（staff 是 null 就是請他離開）
//   channel.staff_set { role, unpaid_weeks }        那個人連續幾週沒領到薪水
//   channel.gear_add { gear }、channel.gear_remove { uid }   裝上、拆下一件設備

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
  /** 成人檔三段（MEDIA 4.3）：訂閱與打賞的倍率、廣告單價的倍率、豔名、公信力的加減（現場、專題用 cred_hard）、推薦權重、各段的內容篩選標籤 */
  tiers: Record<TierId, TierRule>
  /** 四種評價（MEDIA 4.4）：觀看 = 訂閱 × views、訂閱 ±subs %、公信力（只有 cred_affected 的節目） */
  grades: Record<Grade, GradeRule>
  /** 廣告：每個觀看 C$ unit × 公信力 ÷ cred_div（MEDIA 4.4） */
  ad: { unit: number; cred_div: number }
  /** 打賞 = 觀看 × tip_rate × 成人檔的倍率 */
  tip_rate: number
  /** 料的加成：看點合計 ÷ div（捨去）最多 cap；可信平均 trust_hi 以上公信力 +1、trust_lo 以下 −1（只有 cred_affected 的節目） */
  material: { div: number; cap: number; trust_hi: number; trust_lo: number }
  /** 設備（MEDIA 4.6）：消費、專業、企業級各加幾；便攜的專業級以上少 portable_cut；一集合計最多 cap；直播讀的 stream_gear_bonus 最多 stream_cap */
  gear: { bonus: number[]; portable_cut: number; cap: number; stream_cap: number }
  /** 檢定的 DC：base − 推薦權重，沒有媒體型路數再加 no_media */
  dc: { base: number; no_media: number }
  /** 帶著製作：檢定 +bonus；那個人的路數是主播或偶像 +media_bonus（MEDIA 4.5） */
  producer: { bonus: number; media_bonus: number }
  /** 編制的週薪（V15）：雇來的 hired；名冊上的人是他出場費的 1 ÷ roster_div */
  wage: { hired: number; roster_div: number }
  /** 掛一則業配的公信力（MEDIA 4.3） */
  plug_cred: number
  /** 假料被拆穿時的公信力（扣這麼多；MEDIA 4.4） */
  expose: number
  /** 線人每週帶回的素材：品質 q_min～q_max、類型從 types 固定亂數挑 */
  source: { q_min: number; q_max: number; types: string[] }
  /** 一個時段幾分鐘 */
  slot_minutes: number
  /** 媒體型的路數（actor.ext.paths 的 path id） */
  paths: { anchor: string; idol: string }
}

export const DEFAULT_CHANNEL_RULES: ChannelRules = {
  start_subs: 100, name_max: 20, churn: { active: 2, idle: 5 }, reco_growth: 1, over_step: 500, quota_pct: 20, level_at: [1000, 10000], seats: 2, flow_cred: 60,
  ai_subs: { pct: 2, min: 20 }, max_catch_up: 8, log_keep: 10,
  // MEDIA 4.3 的成人檔表：擦邊 ×1.3／×1.5、豔名 +1、公信力 −1（現場與專題 −2）；成人 ×1.6／×2.5、豔名 +2、公信力 −2（−4）、推薦權重 −1；廣告單價成人檔減半
  tiers: {
    all: { subs: 1, tips: 1, ad: 1, fame: 0, cred: 0, cred_hard: 0, reco: 0, tags: [] },
    edgy: { subs: 1.3, tips: 1.5, ad: 0.5, fame: 1, cred: -1, cred_hard: -2, reco: 0, tags: [] },
    adult: { subs: 1.6, tips: 2.5, ad: 0.5, fame: 2, cred: -2, cred_hard: -4, reco: -1, tags: [] },
  },
  // MEDIA 4.4 的評價表：翻車 觀看 ×0.2、訂閱 −2%、公信力 −2；普通 ×0.5、+1%、0；好 ×1、+3%、+1；爆 ×3、+10%、+2
  grades: {
    flop: { views: 0.2, subs: -2, cred: -2 },
    ok: { views: 0.5, subs: 1, cred: 0 },
    good: { views: 1, subs: 3, cred: 1 },
    hit: { views: 3, subs: 10, cred: 2 },
  },
  ad: { unit: 0.1, cred_div: 50 }, tip_rate: 0.02,
  material: { div: 4, cap: 3, trust_hi: 8, trust_lo: 3 },
  gear: { bonus: [1, 2, 3], portable_cut: 1, cap: 6, stream_cap: 3 },
  dc: { base: 12, no_media: 3 }, producer: { bonus: 2, media_bonus: 4 }, wage: { hired: 250, roster_div: 2 },
  plug_cred: -1, expose: 8, source: { q_min: 1, q_max: 2, types: ['scandal', 'crime', 'celebrity', 'daily', 'battle'] }, slot_minutes: 240,
  paths: { anchor: 'streamer', idol: 'idol' },
}

// ---- 節目與成人檔的固定字彙 ----

export const TIER_IDS = ['all', 'edgy', 'adult'] as const
export type TierId = (typeof TIER_IDS)[number]
export const TIER_NAME: Record<TierId, string> = { all: '全年齡', edgy: '擦邊', adult: '成人' }
export const GRADES = ['flop', 'ok', 'good', 'hit'] as const
export type Grade = (typeof GRADES)[number]
export const GRADE_NAME: Record<Grade, string> = { flop: '翻車', ok: '普通', good: '好', hit: '爆' }
export const ROLES = ['producer', 'source', 'pr'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_NAME: Record<Role, string> = { producer: '製作', source: '線人', pr: '公關' }
/** 設備五類（MEDIA 4.6）：鏡頭、收音、燈光、剪輯機、串流 */
export const GEAR_CLASSES = ['lens', 'mic', 'light', 'edit', 'stream'] as const
export type GearClass = (typeof GEAR_CLASSES)[number]
export const GEAR_NAME: Record<GearClass, string> = { lens: '鏡頭', mic: '收音', light: '燈光', edit: '剪輯機', stream: '串流' }

export interface TierRule {
  subs: number
  tips: number
  ad: number
  fame: number
  cred: number
  cred_hard: number
  reco: number
  /** 內容篩選的標籤（預設都沒有；被玩家關掉的標籤，那一檔開不出來） */
  tags: string[]
}

export interface GradeRule {
  views: number
  subs: number
  cred: number
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
  p.push(...episodeRuleProblems(e))
  return p
}

// ---- 開一集的規則（節目、成人檔、評價、設備、編制）：一格一格的數字用路徑寫表，驗證與讀取共用 ----

type NumSpec = [path: string, lo: number, hi: number, int?: true]

const NUM_SPECS: NumSpec[] = [
  ...TIER_IDS.flatMap((t): NumSpec[] => [
    [`tiers.${t}.subs`, 0, 100], [`tiers.${t}.tips`, 0, 100], [`tiers.${t}.ad`, 0, 100], [`tiers.${t}.fame`, 0, 10, true],
    [`tiers.${t}.cred`, -50, 50, true], [`tiers.${t}.cred_hard`, -50, 50, true], [`tiers.${t}.reco`, -3, 3, true],
  ]),
  ...GRADES.flatMap((g): NumSpec[] => [[`grades.${g}.views`, 0, 100], [`grades.${g}.subs`, -100, 1000], [`grades.${g}.cred`, -50, 50, true]]),
  ['ad.unit', 0, 1000], ['ad.cred_div', 1, 1000], ['tip_rate', 0, 100],
  ['material.div', 1, 1000, true], ['material.cap', 0, 20, true], ['material.trust_hi', 0, 20, true], ['material.trust_lo', 0, 20, true],
  ['gear.portable_cut', 0, 5, true], ['gear.cap', 0, 30, true], ['gear.stream_cap', 0, 30, true],
  ['dc.base', 0, 40, true], ['dc.no_media', 0, 20, true], ['producer.bonus', 0, 10, true], ['producer.media_bonus', 0, 20, true],
  ['wage.hired', 0, 1_000_000, true], ['wage.roster_div', 1, 100, true], ['plug_cred', -50, 50, true], ['expose', 0, 100, true],
  ['source.q_min', 1, 5, true], ['source.q_max', 1, 5, true], ['slot_minutes', 1, 1440, true],
]

const GROUP_KEYS = ['tiers', 'grades', 'ad', 'material', 'gear', 'dc', 'producer', 'wage', 'source', 'paths'] as const

const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((cur, key) => (isRecord(cur) && Object.hasOwn(cur, key) ? cur[key] : undefined), o)
function setPath(o: Record<string, unknown>, path: string, v: unknown): void {
  const keys = path.split('.')
  let cur = o
  for (const key of keys.slice(0, -1)) cur = cur[key] as Record<string, unknown>
  cur[keys[keys.length - 1]!] = v
}
const specOk = (v: unknown, [, lo, hi, int]: NumSpec): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v))
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 40 && v.every((x) => isText(x))
const gearBonusOk = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((n) => isSafeInt(n) && n >= 0 && n <= 10)

function episodeRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const g of GROUP_KEYS) if (e[g] !== undefined && !isRecord(e[g])) p.push(`${g} 要是一組設定（物件）`)
  for (const t of TIER_IDS) if (isRecord(e.tiers) && e.tiers[t] !== undefined && !isRecord(e.tiers[t])) p.push(`tiers.${t} 要是一組設定（物件）`)
  for (const g of GRADES) if (isRecord(e.grades) && e.grades[g] !== undefined && !isRecord(e.grades[g])) p.push(`grades.${g} 要是一組設定（物件）`)
  for (const spec of NUM_SPECS) {
    const v = getPath(e, spec[0])
    if (v !== undefined && !specOk(v, spec)) p.push(`${spec[0]} 要是 ${spec[1]}～${spec[2]} 的${spec[3] ? '整數' : '數字'}`)
  }
  for (const t of TIER_IDS) {
    const tags = getPath(e, `tiers.${t}.tags`)
    if (tags !== undefined && !textList(tags)) p.push(`tiers.${t}.tags 要是標籤的陣列`)
  }
  const bonus = getPath(e, 'gear.bonus')
  if (bonus !== undefined && !gearBonusOk(bonus)) p.push('gear.bonus 要是三個 0～10 的整數（消費、專業、企業級）')
  const types = getPath(e, 'source.types')
  if (types !== undefined && !(textList(types) && types.length > 0)) p.push('source.types 要是素材類型的陣列（至少一個）')
  for (const f of ['anchor', 'idol'] as const) {
    const v = getPath(e, `paths.${f}`)
    if (v !== undefined && !isText(v)) p.push(`paths.${f} 要是路數的 id`)
  }
  const qmin = getPath(e, 'source.q_min')
  const qmax = getPath(e, 'source.q_max')
  if (typeof qmin === 'number' && typeof qmax === 'number' && qmin > qmax) p.push('source.q_min 不能大於 source.q_max')
  return p
}

/** 把資料裡合格的欄位蓋到規則上（格式不對的欄位忽略）。 */
function readEpisodeRules(e: Record<string, unknown>, out: ChannelRules): void {
  for (const spec of NUM_SPECS) {
    const v = getPath(e, spec[0])
    if (specOk(v, spec)) setPath(out as unknown as Record<string, unknown>, spec[0], v)
  }
  for (const t of TIER_IDS) {
    const tags = getPath(e, `tiers.${t}.tags`)
    if (textList(tags)) out.tiers[t].tags = [...tags]
  }
  const bonus = getPath(e, 'gear.bonus')
  if (gearBonusOk(bonus)) out.gear.bonus = [...bonus]
  const types = getPath(e, 'source.types')
  if (textList(types) && types.length > 0) out.source.types = [...types]
  for (const f of ['anchor', 'idol'] as const) {
    const v = getPath(e, `paths.${f}`)
    if (isText(v)) out.paths[f] = v
  }
  if (out.source.q_min > out.source.q_max) out.source.q_min = out.source.q_max
}

/** 現在生效的規則：資料 channel_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function channelRules(k: Pick<Kernel, 'content'>): ChannelRules {
  const d = DEFAULT_CHANNEL_RULES
  const out: ChannelRules = {
    ...d, churn: { ...d.churn }, level_at: [...d.level_at], ai_subs: { ...d.ai_subs },
    tiers: Object.fromEntries(TIER_IDS.map((t) => [t, { ...d.tiers[t], tags: [...d.tiers[t].tags] }])) as Record<TierId, TierRule>,
    grades: Object.fromEntries(GRADES.map((g) => [g, { ...d.grades[g] }])) as Record<Grade, GradeRule>,
    ad: { ...d.ad }, material: { ...d.material }, gear: { ...d.gear, bonus: [...d.gear.bonus] }, dc: { ...d.dc }, producer: { ...d.producer }, wage: { ...d.wage },
    source: { ...d.source, types: [...d.source.types] }, paths: { ...d.paths },
  }
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
  readEpisodeRules(e, out)
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

/** 編制的一個位子上的人（MEDIA 4.5；V15）：who 是角色 id；hired 是雇來的（不在名冊上）；wage 是每週薪水（坐上去那一刻定下）；unpaid_weeks 是連續幾週沒領到。 */
export interface Staff {
  who: string
  hired: boolean
  wage: number
  unpaid_weeks: number
}

/** 裝進頻道的一件設備（V17）：從背包拿進來，可以拆回去。uid 是頻道自己發的流水號。 */
export interface GearRow {
  uid: string
  item: string
  cls: GearClass
  /** 1 消費級、2 專業級、3 企業級 */
  grade: number
  portable: boolean
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
  /** 編制三種位子（沒有人坐的沒有那一格） */
  staff: Partial<Record<Role, Staff>>
  /** 裝著的設備 */
  gear: GearRow[]
  /** 設備的流水號（發 uid 用，只增不減） */
  seq: number
}

export const blankChannel = (): ChannelState => ({
  open: false, name: '', since: 0, mark: 0, budget: { own: { cred: 0, cash: 0 }, pools: {} }, sponsors: [], week: { episodes: 0, lives: 0, adult_reco: false }, log: [],
  staff: {}, gear: [], seq: 0,
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

const isRole = (v: unknown): v is Role => (ROLES as readonly unknown[]).includes(v)
const isGearClass = (v: unknown): v is GearClass => (GEAR_CLASSES as readonly unknown[]).includes(v)

function readStaff(v: unknown): Staff | null {
  if (!isRecord(v) || !isText(v.who)) return null
  return { who: v.who, hired: v.hired === true, wage: nat(v.wage), unpaid_weeks: nat(v.unpaid_weeks) }
}

function readGear(v: unknown): GearRow | null {
  if (!isRecord(v) || !isText(v.uid) || !isText(v.item) || !isGearClass(v.cls) || !isSafeInt(v.grade) || v.grade < 1 || v.grade > 3) return null
  return { uid: v.uid, item: v.item, cls: v.cls, grade: v.grade, portable: v.portable === true }
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
    staff: readStaffMap(r.staff), gear: (Array.isArray(r.gear) ? r.gear : []).map(readGear).filter((g): g is GearRow => g !== null), seq: nat(r.seq),
  }
}

function readStaffMap(v: unknown): Partial<Record<Role, Staff>> {
  const out: Partial<Record<Role, Staff>> = {}
  if (!isRecord(v)) return out
  const seen = new Set<string>()
  for (const role of ROLES) {
    const st = isRole(role) && Object.hasOwn(v, role) ? readStaff(v[role]) : null
    if (st && !seen.has(st.who)) { out[role] = st; seen.add(st.who) }
  }
  return out
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
