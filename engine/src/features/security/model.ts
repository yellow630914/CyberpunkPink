// L6 功能 security 的資料與純函式：規則、分段、身分、假身分、掃到的東西。不碰登錄表（登記在 index.ts 與 scan.ts）。
// 規格：FACTIONS 第 5、6 節；LIFE 2.1～2.3 節；EQUIPMENT 6.3、6.4 節；dev/adr/0016 第三、四、七節與 G17；dev/work/M2-security.md。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { isRecord, meterOf } from '../../core'
import { PERSON_READS, isPersonRead, personRuleProblems } from './personRules'
import type { PersonRead } from './personRules'

export const OWNER = 'security'
/** state.ext 的鍵：每個勢力「這一週有沒有新的敵對值」的記號（消退用）。只有 report.before 與消退寫它。 */
export const EXT = 'security'
/** state.ext 的鍵：開著的掃橋（掃橋的事件開著時才有）。只有掃橋的開始與結束寫它。 */
export const SCAN_EXT = 'security_scan'
export const RULE_KIND = 'security_rule'

// ---- 規則 ----

export interface SecurityRules {
  /** 每週消退多少點（FACTIONS 6.3：5） */
  decay_weekly: number
  /** 那一週沒有新的敵對值時，這一週一共消退多少點（FACTIONS 6.3：10，也就是 5 加再 5） */
  decay_quiet: number
  /** 收買：每降 1 點的單價是這個數 ×（敵對值 ÷ bribe_step 進位）（FACTIONS 6.3：50） */
  bribe_per_point: number
  bribe_step: number
  /** 收買一次最多降幾點（FACTIONS 6.3：20） */
  bribe_max: number
  /** 掃到違禁的東西：沒收，那個勢力的敵對值加這麼多（EQUIPMENT 6.4；數字設計書沒寫） */
  found_banned: number
  /** 掃到許可類而沒有執照：同上 */
  found_permit: number
  /** 假身分被識破：那個勢力的敵對值加這麼多（設計書沒寫） */
  caught_hostility: number
  /** 假身分低一級要擲：難度 = 基底 + 強度 × 每級 （ADR G17：13 ＋ 強度 × 2）；記名以上再加 */
  fake_dc_base: number
  fake_dc_per_strength: number
  fake_recorded_bonus: number
  /** 敵對值六段的下限（FACTIONS 6.1） */
  hostility_bands: number[]
  /** 好感五段的下限（FACTIONS 5.1） */
  favor_bands: number[]
}

export const DEFAULT_SECURITY_RULES: SecurityRules = {
  decay_weekly: 5, decay_quiet: 10, bribe_per_point: 50, bribe_step: 20, bribe_max: 20,
  found_banned: 10, found_permit: 5, caught_hostility: 5,
  fake_dc_base: 13, fake_dc_per_strength: 2, fake_recorded_bonus: 2,
  hostility_bands: [0, 20, 40, 60, 80, 100], favor_bands: [0, 20, 40, 60, 80],
}

const int = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min
const bandsOk = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x, i) => int(x, 0) && x <= 100 && (i === 0 ? x === 0 : x > (v[i - 1] as number)))

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const nums: Array<[keyof SecurityRules, number]> = [
    ['decay_weekly', 0], ['decay_quiet', 0], ['bribe_per_point', 0], ['bribe_step', 1], ['bribe_max', 1], ['found_banned', 0], ['found_permit', 0],
    ['caught_hostility', 0], ['fake_dc_base', 1], ['fake_dc_per_strength', 0], ['fake_recorded_bonus', 0],
  ]
  for (const [key, min] of nums) if (e[key] !== undefined && !int(e[key], min)) p.push(`${key} 要是 ${min} 以上的整數`)
  if (e.hostility_bands !== undefined && !bandsOk(e.hostility_bands, 6)) p.push('hostility_bands 要是六個遞增的整數，第一個是 0、最後不超過 100')
  if (e.favor_bands !== undefined && !bandsOk(e.favor_bands, 5)) p.push('favor_bands 要是五個遞增的整數，第一個是 0、最後不超過 100')
  if (int(e.decay_weekly, 0) && int(e.decay_quiet, 0) && e.decay_quiet < e.decay_weekly) p.push('decay_quiet 不能比 decay_weekly 小（沒有新的敵對值只會消退得更多）')
  p.push(...personRuleProblems(e))
  return p
}

/** 現在生效的規則：資料 security_rule/default 蓋掉內建的預設。 */
export function securityRules(k: Pick<Kernel, 'content'>): SecurityRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: SecurityRules = { ...DEFAULT_SECURITY_RULES, hostility_bands: [...DEFAULT_SECURITY_RULES.hostility_bands], favor_bands: [...DEFAULT_SECURITY_RULES.favor_bands] }
  if (!e) return out
  for (const key of Object.keys(out) as Array<keyof SecurityRules>) {
    const v = e[key]
    if (key === 'hostility_bands') { if (bandsOk(v, 6)) out.hostility_bands = [...v] }
    else if (key === 'favor_bands') { if (bandsOk(v, 5)) out.favor_bands = [...v] }
    else if (int(v, 0)) (out[key] as number) = v
  }
  return out
}

// ---- 分段 ----

export interface TierView {
  id: string
  name: string
  /** 第幾段（0 起算） */
  index: number
  /** 這一段從幾點起 */
  min: number
}

/** 敵對值六段（FACTIONS 6.1）。 */
export const HOSTILITY_TIERS = [
  { id: 'unnoticed', name: '沒注意' }, { id: 'recorded', name: '記名' }, { id: 'trouble', name: '找麻煩' },
  { id: 'pursuit', name: '追捕' }, { id: 'bounty', name: '懸賞' }, { id: 'wanted', name: '通緝' },
] as const
/** 好感五段（FACTIONS 5.1）。 */
export const FAVOR_TIERS = [
  { id: 'stranger', name: '外人' }, { id: 'known', name: '認得' }, { id: 'friendly', name: '友好' },
  { id: 'trusted', name: '信任' }, { id: 'kin', name: '自己人' },
] as const

type TierDef = { id: string; name: string }

function tierOf(defs: readonly TierDef[], bands: readonly number[], value: number): TierView {
  let index = 0
  for (let i = 0; i < bands.length; i++) if (value >= (bands[i] as number)) index = i
  const d = defs[index]!
  return { id: d.id, name: d.name, index, min: bands[index]! }
}

/** 一個敵對值落在哪一段。 */
export const hostilityTierOf = (rules: Pick<SecurityRules, 'hostility_bands'>, value: number): TierView => tierOf(HOSTILITY_TIERS, rules.hostility_bands, value)
/** 一個好感落在哪一段。 */
export const favorTierOf = (rules: Pick<SecurityRules, 'favor_bands'>, value: number): TierView => tierOf(FAVOR_TIERS, rules.favor_bands, value)

/** 這個勢力現在的敵對值落在哪一段（六段的 id 與名字）。 */
export function hostilityTier(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, faction: string): TierView {
  return hostilityTierOf(securityRules(k), meterOf(k, state, 'hostility', faction))
}

/** 這個勢力現在的好感落在哪一段。 */
export function favorTier(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, faction: string): TierView {
  return favorTierOf(securityRules(k), meterOf(k, state, 'favor', faction))
}

/** 條件裡的「第幾段」：寫段的 id 或第幾段（0 起算）。看不懂回傳 null。 */
export function tierIndex(defs: readonly TierDef[], v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < defs.length ? v : null
  const i = defs.findIndex((d) => d.id === v)
  return i >= 0 ? i : null
}

// ---- 身分（LIFE 2.2 節） ----

export const IDENTITY_CLASSES = ['member', 'citizen', 'unregistered', 'bound'] as const
export type IdentityClass = (typeof IDENTITY_CLASSES)[number]
export const CLASS_NAME: Record<IdentityClass, string> = { member: '社員', citizen: '市民', unregistered: '無籍', bound: '契約人' }
/**
 * 進得去幾級的地方：社員最高，市民與契約人一樣（契約人的法律責任在持約人，這一張不做契約，先當市民），無籍最低。
 * 掃橋的點（強度 1 以上）至少要市民：無籍沒有橋 ID 可掃（LIFE 2.1 節）。
 */
const RANK: Record<IdentityClass, number> = { member: 3, citizen: 2, bound: 2, unregistered: 1 }
export const isIdentityClass = (v: unknown): v is IdentityClass => (IDENTITY_CLASSES as readonly unknown[]).includes(v)
export const rankOf = (c: IdentityClass): number => RANK[c]

/** 角色的身分：actor.ext.identity.class，沒寫或不認得就是市民。 */
export function identityOf(state: GameState, actor: string | null): IdentityClass {
  const raw = actor ? state.actors[actor]?.ext.identity : undefined
  return isRecord(raw) && isIdentityClass(raw.class) ? raw.class : 'citizen'
}

// ---- 假身分（LIFE 2.3 節；ADR G17） ----

export const FAKE_TAG = 'fake_id'
/** 假身分低一級時擲的基本功。 */
export const FAKE_SKILL = 'perform'
export const FAKE_ATTR = 'charm'
/** 執照：帶這個標籤的物品，或 license:<許可類物品的 id>。 */
export const LICENSE_TAG = 'license'

export interface FakeId {
  item: string
  name: string
  /** 1 一次性、2 淺層、3 深層 */
  grade: number
}

type ItemLike = { name?: string; grade?: number; tags?: string[] }
const itemOf = (k: Pick<Kernel, 'content'>, id: string): ItemLike | undefined => k.content.get<ContentEntry & ItemLike & Record<string, unknown>>('item', id)

/** 身上帶的假身分（每種一筆，等級由低到高，一樣高的照 id）。 */
export function fakeIdsOf(k: Pick<Kernel, 'content'>, state: GameState): FakeId[] {
  const seen = new Map<string, FakeId>()
  for (const s of state.inventory) {
    if (s.qty < 1 || seen.has(s.id)) continue
    const e = itemOf(k, s.id)
    if (!e?.tags?.includes(FAKE_TAG)) continue
    seen.set(s.id, { item: s.id, name: e.name ?? s.id, grade: Math.max(1, Math.min(3, Math.floor(e.grade ?? 1))) })
  }
  return [...seen.values()].sort((a, b) => a.grade - b.grade || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
}

/** 身上有沒有這個許可類東西的執照。 */
export function hasLicense(k: Pick<Kernel, 'content'>, state: GameState, item: string): boolean {
  return state.inventory.some((s) => {
    if (s.qty < 1) return false
    const tags = itemOf(k, s.id)?.tags
    return !!tags && (tags.includes(LICENSE_TAG) || tags.includes(`${LICENSE_TAG}:${item}`))
  })
}

// ---- 掃橋點的設定 ----

export const MAX_STRENGTH = 3

export interface ScanSetup {
  /** 這個點的 id（地圖上的閘門、檢查哨） */
  point: string
  /** 給玩家看的名字 */
  name: string
  /** 掃描強度 0～3（EQUIPMENT 6.3 節） */
  strength: number
  /** 掃的是哪個勢力的（沒寫就沒有人認你） */
  faction?: string
  /** 這個點要什麼身分才進得去 */
  need_class?: IdentityClass
  /** 這個點讀這個人的哪幾樣（義體、沉溺、契約）；沒寫就照規則表 readers 查那個點的勢力，再沒有就只讀義體（M4-security-m4） */
  reads?: PersonRead[]
}

/** 讀 setup：格式不對回傳一句話（給玩家看的完整句子）。faction 要在內容裡查得到。 */
export function readScanSetup(k: Pick<Kernel, 'content'>, raw: unknown): ScanSetup | string {
  if (!isRecord(raw)) return '掃橋要有一個點：{ point, name, strength }。'
  if (typeof raw.point !== 'string' || !raw.point) return '掃橋的點要有 id（point）。'
  if (typeof raw.name !== 'string' || !raw.name.trim()) return '掃橋的點要有名字（name）。'
  if (typeof raw.strength !== 'number' || !Number.isInteger(raw.strength) || raw.strength < 0 || raw.strength > MAX_STRENGTH) return `掃描強度要是 0～${MAX_STRENGTH} 的整數。`
  if (raw.faction !== undefined && (typeof raw.faction !== 'string' || !k.content.has('faction', raw.faction))) return `掃橋的點寫的勢力 ${String(raw.faction)} 查不到。`
  if (raw.need_class !== undefined && !isIdentityClass(raw.need_class)) return `need_class 只能是 ${IDENTITY_CLASSES.join('、')}。`
  if (raw.reads !== undefined && !(Array.isArray(raw.reads) && raw.reads.every(isPersonRead))) return `reads 只能寫 ${PERSON_READS.join('、')} 的陣列。`
  return {
    point: raw.point, name: raw.name, strength: raw.strength,
    ...(raw.reads !== undefined ? { reads: [...new Set(raw.reads as PersonRead[])] } : {}),
    ...(raw.faction !== undefined ? { faction: raw.faction as string } : {}),
    ...(raw.need_class !== undefined ? { need_class: raw.need_class as IdentityClass } : {}),
  }
}

/** 這一級掃什麼（EQUIPMENT 6.3 節）。 */
export const STRENGTH_NOTE = [
  '這裡不掃。',
  '只掃大小 2 以上的武器。',
  '掃所有武器與違禁的義體。',
  '掃所有武器與義體，還要讀橋 ID。',
] as const
