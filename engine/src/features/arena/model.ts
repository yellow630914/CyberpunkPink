// L6 功能 arena 的資料與純函式：規則（內建的預設加資料蓋掉）、設施的欄位、狀態的形狀（state.ext.arena）、這裡能不能打。
// 規格：LEWD_SYSTEM 第 6 節（感官擂台：用戰鬥規則，只有神經傷害，比誰先過載，可以下注）；EVENTS 4.7 節（擂台的邀約）；CORE_RULES 4.2 節（過載）；
// dev/adr/0019 P62、第十四節；dev/work/M4-venues.md。
//
// 內容種類：
//   arena_rule  { id: 'default', weapon: { class, dice, type: 'neural' }, odds: { base, per_cap_diff, min, max }, fee }：蓋掉下面 DEFAULT_ARENA_RULES 的數字
//   facility_type 的欄位 arena: { grades: number[], stake_max?: number }（world 的設施種類；這個功能只讀這一欄）
//
// 狀態 state.ext.arena：{ wins, losses, announce }（形狀見 ArenaState；只經由報告裡的 ext 變更寫）。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'

export const OWNER = 'arena'
export const EXT = 'arena'
export const RULE_KIND = 'arena_rule'
export const FACILITY_TYPE_KIND = 'facility_type'
export const ENTER_ACTION = 'arena.enter'
export const RESULT_ACTION = 'arena.result'
/** 觸發點（EVENTS 4.7 節的擂台事件、輸的一方的後續）：where 帶 won */
export const RESULT_POINT = 'arena_result'
/** battle.field.arena 的值：這一場的輸贏（站在主角那一邊說） */
export const FIELD_KEY = 'arena'
export const WON = 'won'
export const LOST = 'lost'

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 規則 ----

export interface ArenaWeapon {
  /** 武器的類型（weapon_class 的 id） */
  class: string
  /** 傷害骰的顆數（蓋掉類型的） */
  dice: number
  type: 'neural'
}

export interface ArenaOdds {
  /** 雙方感載上限一樣高時的賠率（1 ＝ 一賠一） */
  base: number
  /** 對手的感載上限每比你高 1 點，賠率加多少（比你低就減） */
  per_cap_diff: number
  min: number
  max: number
}

export interface ArenaRules {
  weapon: ArenaWeapon
  odds: ArenaOdds
  /** 報名費 */
  fee: number
}

export const DEFAULT_ARENA_RULES: ArenaRules = {
  weapon: { class: 'neural_melee', dice: 3, type: 'neural' },
  odds: { base: 1, per_cap_diff: 0.02, min: 0.5, max: 3 },
  fee: 0,
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.weapon !== undefined) {
    const w = e.weapon
    if (!isRecord(w)) p.push('weapon 要是 { class, dice, type: neural }')
    else {
      if (w.class !== undefined && !isText(w.class)) p.push('weapon.class 要是武器類型的 id')
      if (w.dice !== undefined && !(isSafeInt(w.dice) && w.dice >= 1 && w.dice <= 20)) p.push('weapon.dice 要是 1～20 的整數')
      if (w.type !== undefined && w.type !== 'neural') p.push("weapon.type 只能是 'neural'（擂台只有神經傷害）")
    }
  }
  if (e.odds !== undefined) {
    const o = e.odds
    if (!isRecord(o)) p.push('odds 要是 { base, per_cap_diff, min, max }')
    else {
      for (const key of ['base', 'per_cap_diff', 'min', 'max'] as const) if (o[key] !== undefined && !(isNum(o[key]) && o[key] >= 0 && o[key] <= 100)) p.push(`odds.${key} 要是 0～100 的數字`)
      const min = isNum(o.min) ? o.min : DEFAULT_ARENA_RULES.odds.min
      const max = isNum(o.max) ? o.max : DEFAULT_ARENA_RULES.odds.max
      if (min > max) p.push('odds.min 不能大於 odds.max')
    }
  }
  if (e.fee !== undefined && !(isSafeInt(e.fee) && e.fee >= 0)) p.push('fee 要是 0 以上的整數')
  return p
}

/** 現在生效的規則：資料 arena_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function arenaRules(k: Pick<Kernel, 'content'>): ArenaRules {
  const d = DEFAULT_ARENA_RULES
  const out: ArenaRules = { weapon: { ...d.weapon }, odds: { ...d.odds }, fee: d.fee }
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  if (isRecord(e.weapon)) {
    if (isText(e.weapon.class)) out.weapon.class = e.weapon.class
    if (isSafeInt(e.weapon.dice) && e.weapon.dice >= 1 && e.weapon.dice <= 20) out.weapon.dice = e.weapon.dice
  }
  if (isRecord(e.odds)) {
    for (const key of ['base', 'per_cap_diff', 'min', 'max'] as const) {
      const v = e.odds[key]
      if (isNum(v) && v >= 0 && v <= 100) out.odds[key] = v
    }
    if (out.odds.min > out.odds.max) out.odds = { ...d.odds }
  }
  if (isSafeInt(e.fee) && e.fee >= 0) out.fee = e.fee
  return out
}

// ---- 設施 ----

/** 設施種類的 arena 欄位。 */
export interface ArenaFacility {
  grades: number[]
  stake_max?: number
}

/** 設施種類的 arena 欄位格式（世界的 facility_type 不檢查它，這個功能 ready 時查）。 */
export function facilityFieldProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['arena 要是 { grades, stake_max? }']
  const p: string[] = []
  if (!(Array.isArray(raw.grades) && raw.grades.length > 0 && raw.grades.every((g) => isSafeInt(g) && g >= 1 && g <= 5))) p.push('arena.grades 要是 1～5 的整數陣列（至少一個）')
  if (raw.stake_max !== undefined && !(isSafeInt(raw.stake_max) && raw.stake_max >= 0)) p.push('arena.stake_max 要是 0 以上的整數')
  return p
}

type FacilityTypeEntry = ContentEntry & { name?: unknown; arena?: unknown }

/** 現在站的設施是不是擂台（用條件 at_facility 問；沒有人註冊就沒有擂台）。 */
export function arenaHere(k: Kernel, state: GameState): { type: string; name: string; facility: ArenaFacility } | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    if (t.arena === undefined || facilityFieldProblems(t.arena).length > 0) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) continue
    const a = t.arena as ArenaFacility
    return { type: t.id, name: isText(t.name) ? t.name : t.id, facility: { grades: [...a.grades], ...(a.stake_max !== undefined ? { stake_max: a.stake_max } : {}) } }
  }
  return null
}

// ---- 狀態 ----

/** 剛打完、還沒寫 arena.result 的那一場（報告掛鉤寫完就清掉）。 */
export interface Announce {
  /** 主角贏了嗎（沒打完的是 false） */
  won: boolean
  /** 沒有打完（脫離之類）：押的錢沒動，也沒有觸發點 */
  void: boolean
  stake: number
  odds: number
  /** 錢實際動了多少（贏是正的、輸是負的） */
  delta: number
  foe: string
  grade: number
}

export interface ArenaState {
  wins: number
  losses: number
  announce: Announce | null
}

export const blankArena = (): ArenaState => ({ wins: 0, losses: 0, announce: null })

/** 讀 state.ext.arena：沒有、或形狀不對的部分當成空的（回傳的是複製品）。 */
export function readArena(state: Pick<GameState, 'ext'>): ArenaState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const a = r.announce
  const announce = isRecord(a) && isSafeInt(a.stake) && isSafeInt(a.delta) && isNum(a.odds) && isText(a.foe) && isSafeInt(a.grade)
    ? { won: a.won === true, void: a.void === true, stake: a.stake, odds: a.odds, delta: a.delta, foe: a.foe, grade: a.grade }
    : null
  return { wins: isSafeInt(r.wins) && r.wins > 0 ? r.wins : 0, losses: isSafeInt(r.losses) && r.losses > 0 ? r.losses : 0, announce }
}
