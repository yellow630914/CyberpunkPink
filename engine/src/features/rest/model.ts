// L6 功能 rest 的資料與純函式：內容的型別與格式檢查、規則（內建的預設加資料蓋掉）、狀態的形狀（state.ext.rest）、住處與睡處的查詢。
// 規格：DOWNTIME 第 1、2 節（2.1 喘口氣、2.2 睡一覺、2.3 睡在哪裡）、7.1 節開頭與等級 0、1、7.2 節的表與「押金」；
// EVENTS 3.1 節（rest、sleep_out、home）；CORE_RULES 4.1、4.2 節；dev/adr/0016 第六節；dev/work/M2-rest-housing.md。
//
// 不碰登錄表（登記在 index.ts）。
//
// 內容種類：
//   residence   { id, name, district, block, facility?, level: 0|1|2|3, rent, cash_ok?: boolean | 'only', start?: boolean }
//               facility 是那一塊街區上設施的標記 id（沒寫就是整塊街區都算在家）；cash_ok：不寫是只收帳戶、true 帳戶與現金都收、'only' 只收現金；
//               start：開新局時主角就租著它（不收押金；有好幾間時用內容裡的第一間）
//   rest_rule   { id: 'default', ... }：蓋掉下面 DEFAULT_REST_RULES 的數字
//   facility_type 多讀的欄位（種類本身是 world 的）：sleep: { rate: 0～1 的回復率, cost: 一晚的價錢 }

import type { ContentEntry, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt, toMinutes } from '../../core'

export const OWNER = 'rest'
/** state.ext 的鍵 */
export const EXT = 'rest'
export const RESIDENCE_KIND = 'residence'
export const RULE_KIND = 'rest_rule'
export const BLOCK_KIND = 'block'
export const FACILITY_TYPE_KIND = 'facility_type'

export type Pool = 'cred' | 'cash'
export type Level = 0 | 1 | 2 | 3
export const LEVELS: readonly Level[] = [0, 1, 2, 3]
export const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }

export interface ResidenceEntry extends ContentEntry {
  name: string
  district: string
  block: string
  facility?: string
  level: Level
  /** 週租 */
  rent: number
  cash_ok?: boolean | 'only'
  start?: boolean
}

export interface SleepDef {
  /** 回復率：生命值上限的幾成（0～1） */
  rate: number
  /** 一晚的價錢 */
  cost: number
  /** 醫療床：睡在這裡算傷口處理過（診所的病床；旅館、潛艙店不寫）。沒寫是 false */
  treated?: boolean
}

// ---- 規則 ----

export interface RestRules {
  /** 喘口氣花幾分鐘（DOWNTIME 2.1：1 小時） */
  breath_minutes: number
  /** 喘口氣回的生命值是 breath_hp ＋ mod(體格)，最少 breath_hp_min */
  breath_hp: number
  breath_hp_min: number
  /** 兩次睡一覺之間，前幾次喘口氣回生命值 */
  breath_heals: number
  /** 睡一覺花幾分鐘（8 小時） */
  sleep_minutes: number
  /** 距上次睡一覺至少幾小時（存檔規則可改；先放在規則裡） */
  sleep_gap_hours: number
  /** 露宿的回復率 */
  wild_rate: number
  /** 自己的住處照等級的回復率 */
  home_rates: Record<string, number>
  /** 生命值低於這個比例而且沒有處理過：睡一覺最多回到這個比例（DOWNTIME 2.2 的「一半」） */
  hurt_ratio: number
  /** 租的時候先付幾週的房租當押金 */
  deposit_weeks: number
  /** 房租欠幾週門鎖被換掉 */
  lock_weeks: number
  /** 房租在每週帳單裡排第幾項（DOWNTIME 5.1：第 1 項） */
  rent_order: number
}

export const DEFAULT_REST_RULES: RestRules = {
  breath_minutes: 60, breath_hp: 2, breath_hp_min: 1, breath_heals: 2,
  sleep_minutes: 480, sleep_gap_hours: 16,
  wild_rate: 0.1, home_rates: { 0: 0.25, 1: 0.55, 2: 0.6, 3: 0.6 }, hurt_ratio: 0.5,
  deposit_weeks: 2, lock_weeks: 2, rent_order: 1,
}

const INT_FIELDS: Array<[keyof RestRules, number, number]> = [
  ['breath_minutes', 1, 1440], ['breath_hp', 0, 1000], ['breath_hp_min', 0, 1000], ['breath_heals', 0, 1000],
  ['sleep_minutes', 1, 1440], ['sleep_gap_hours', 0, 1000], ['deposit_weeks', 0, 52], ['lock_weeks', 1, 52], ['rent_order', 1, 10],
]
const RATIO_FIELDS: Array<keyof RestRules> = ['wild_rate', 'hurt_ratio']

const isRatio = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of INT_FIELDS) if (e[key] !== undefined && !(isSafeInt(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  for (const key of RATIO_FIELDS) if (e[key] !== undefined && !isRatio(e[key])) p.push(`${key} 要是 0～1 的數字`)
  if (e.home_rates !== undefined) {
    if (!isRecord(e.home_rates)) p.push('home_rates 要是 { 等級: 回復率 }（等級 0～3）')
    else {
      for (const [key, v] of Object.entries(e.home_rates)) {
        if (!(LEVELS as readonly number[]).includes(Number(key))) p.push(`home_rates.${key}：等級只有 0～3`)
        else if (!isRatio(v)) p.push(`home_rates.${key} 要是 0～1 的數字`)
      }
    }
  }
  return p
}

/** 現在生效的規則：資料 rest_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function restRules(k: Pick<Kernel, 'content'>): RestRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: RestRules = { ...DEFAULT_REST_RULES, home_rates: { ...DEFAULT_REST_RULES.home_rates } }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  for (const key of Object.keys(out) as Array<keyof RestRules>) {
    if (e[key] === undefined || bad.has(key)) continue
    if (key === 'home_rates') {
      for (const [lv, v] of Object.entries(e.home_rates as Record<string, unknown>)) if ((LEVELS as readonly number[]).includes(Number(lv)) && isRatio(v)) out.home_rates[lv] = v
    } else (out[key] as unknown) = e[key]
  }
  return out
}

// ---- 內容的格式檢查 ----

export function residenceProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.district)) p.push('要有 district（區的 id）')
  if (!isText(e.block)) p.push('要有 block（街區的 id）')
  if (e.facility !== undefined && !isText(e.facility)) p.push('facility 要是設施的標記 id')
  if (!(LEVELS as readonly unknown[]).includes(e.level)) p.push('level 要是 0、1、2、3')
  if (!(isSafeInt(e.rent) && e.rent >= 0)) p.push('rent（週租）要是 0 以上的整數')
  if (e.cash_ok !== undefined && e.cash_ok !== true && e.cash_ok !== false && e.cash_ok !== 'only') p.push("cash_ok 要是 true、false 或 'only'")
  if (e.start !== undefined && typeof e.start !== 'boolean') p.push('start 要是布林值')
  return p
}

export function sleepProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['sleep 要是 { rate, cost }']
  const p: string[] = []
  if (!isRatio(v.rate)) p.push('sleep.rate 要是 0～1 的數字（生命值上限的幾成）')
  if (!(isSafeInt(v.cost) && v.cost >= 0)) p.push('sleep.cost 要是 0 以上的整數')
  if (v.treated !== undefined && typeof v.treated !== 'boolean') p.push('sleep.treated 要是 true 或 false（醫療床：睡在這裡算傷口處理過）')
  return p
}

// ---- 狀態 ----

export interface HomeState {
  /** 住處（residence）的 id */
  id: string
  /** 付了多少押金（開新局的起點是 0） */
  deposit: number
  /** 押金是用哪一種錢付的，退租時退回去 */
  pool: Pool
  /** 房租連續欠了幾週 */
  arrears: number
  /** 門鎖被換掉了：不能在那裡睡，付清才開 */
  locked: boolean
}

export interface RestState {
  /** 上次睡一覺做完的時間（總分鐘）；沒睡過是 null */
  lastSleep: number | null
  /** 上次睡一覺之後喘過幾次氣 */
  breaths: number
  home: HomeState | null
}

export const blankRest = (): RestState => ({ lastSleep: null, breaths: 0, home: null })

/** 讀 state.ext.rest：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function readRest(state: Pick<GameState, 'ext'>): RestState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const h = isRecord(r.home) ? r.home : null
  const home: HomeState | null = h && isText(h.id)
    ? { id: h.id, deposit: isSafeInt(h.deposit) && h.deposit > 0 ? h.deposit : 0, pool: h.pool === 'cash' ? 'cash' : 'cred', arrears: isSafeInt(h.arrears) && h.arrears > 0 ? h.arrears : 0, locked: h.locked === true }
    : null
  return { lastSleep: isSafeInt(r.lastSleep) && r.lastSleep >= 0 ? r.lastSleep : null, breaths: isSafeInt(r.breaths) && r.breaths > 0 ? r.breaths : 0, home }
}

// ---- 查詢 ----

type Cx = Pick<Kernel, 'content'>

export const residenceEntry = (k: Cx, id: string | undefined): ResidenceEntry | undefined => (id ? k.content.get<ResidenceEntry>(RESIDENCE_KIND, id) : undefined)

/** 現在租著的住處（狀態裡有、內容裡也查得到才算）。 */
export function homeOf(k: Cx, state: Pick<GameState, 'ext'>): { home: HomeState; residence: ResidenceEntry } | null {
  const home = readRest(state).home
  const residence = home ? residenceEntry(k, home.id) : undefined
  return home && residence ? { home, residence } : null
}

/** 站在住處上：同一塊街區，而且（住處寫了設施的話）站在那一間設施上。 */
export function standingAt(state: Pick<GameState, 'location'>, r: ResidenceEntry): boolean {
  const loc = state.location
  if (!loc.block || loc.block !== r.block) return false
  return r.facility === undefined || loc.facility === r.facility
}

/** 現在站的設施有沒有 sleep（潛艙店的隔間、膠囊旅館）：回傳設施的名字與 sleep；不在設施上、或那種設施沒寫 sleep 回傳 null。 */
export function sleepFacilityAt(k: Cx, state: Pick<GameState, 'location'>): { name: string; type: string; sleep: SleepDef } | null {
  const { block, facility } = state.location
  if (!block || !facility) return null
  const b = k.content.get<ContentEntry & { facilities?: Record<string, { type?: unknown; name?: unknown }> }>(BLOCK_KIND, block)
  const f = b && isRecord(b.facilities) ? b.facilities[facility] : undefined
  if (!f || !isText(f.type)) return null
  const type = k.content.get<ContentEntry & { sleep?: unknown }>(FACILITY_TYPE_KIND, f.type)
  if (!type || type.sleep === undefined || sleepProblems(type.sleep).length > 0) return null
  const sleep = type.sleep as SleepDef
  return { name: isText(f.name) ? f.name : f.type, type: f.type, sleep: { rate: sleep.rate, cost: sleep.cost, ...(sleep.treated === true ? { treated: true } : {}) } }
}

/** 付一筆錢用哪一種：指定的就用指定的（不夠回 null）；沒指定先帳戶、不夠再現金。 */
export function payFor(money: GameState['money'], cost: number, want?: Pool, allowed: Pool[] = ['cred', 'cash']): Pool | null {
  if (cost <= 0) return want ?? allowed[0] ?? 'cred'
  const pools = want ? [want] : allowed
  return pools.find((p) => allowed.includes(p) && money[p] >= cost) ?? null
}

/** 住處收哪幾種錢（cash_ok：沒寫是只收帳戶、true 都收、'only' 只收現金）。 */
export function residencePools(r: Pick<ResidenceEntry, 'cash_ok'>): Pool[] {
  return r.cash_ok === 'only' ? ['cash'] : r.cash_ok === true ? ['cred', 'cash'] : ['cred']
}

/** 租這個住處要付的押金（週租 × deposit_weeks 週；規則表 rest_rule 管幾週）。畫面與租的流程用同一份。 */
export const depositOf = (k: Cx, r: Pick<ResidenceEntry, 'rent'>): number => r.rent * restRules(k).deposit_weeks

/** 帳單裡房租這一項從哪裡扣（掛點 bill.collect 的 pay）。 */
export const rentPayOf = (r: Pick<ResidenceEntry, 'cash_ok'>): 'cred' | 'cash' | 'either' => (r.cash_ok === 'only' ? 'cash' : r.cash_ok === true ? 'either' : 'cred')

/** 生命值上限：有 max_hp 就用它；沒有人註冊時（只有核心的測試）照 CORE_RULES 4.1 節的 20 ＋ 體格 × 2。 */
export function maxHpOf(k: Pick<Kernel, 'stats'>, state: GameState, id: string): number {
  return k.stats.hasStat('max_hp') ? k.stats.stat(state, id, 'max_hp') : 20 + k.stats.effectiveAttr(state, id, 'body') * 2
}

/** 有沒有一個還沒到期的狀況（處理過 treated 之類）。 */
export function hasCondition(state: GameState, id: string, condition: string): boolean {
  const now = toMinutes(state.time)
  return !!state.actors[id]?.conditions.some((c) => c.id === condition && (c.until === undefined || c.until > now))
}

/** 把分鐘寫成「6 小時」「5 小時 30 分」「45 分」。 */
export function spanText(minutes: number): string {
  const m = Math.max(0, Math.ceil(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r} 分`
  return r === 0 ? `${h} 小時` : `${h} 小時 ${r} 分`
}
