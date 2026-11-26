// L6 功能 medical 的資料與純函式：規則（內建的預設加資料蓋掉）、角色身上的狀況怎麼讀、這一個功能共用的名字。
// 規格：DOWNTIME 2.2 節（重傷限制）、3.1 節（治療的表）；COMBAT_SYSTEM 第 6 節（重創）；TRADE 3.4 節；dev/adr/0019 第五節與 P46；dev/work/M4-medical.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { ActorId, Condition, ContentEntry, GameState, Kernel, PassiveEffect } from '../../core'
import { clone, isRecord, isSafeInt, toMinutes } from '../../core'

export const OWNER = 'medical'
export const RULE_KIND = 'medical_rule'
export const FACILITY_TYPE_KIND = 'facility_type'

/** 角色身上的共用狀況（dev/adr/0019 第十四節）：傷口處理過（rest 在讀）、這一次受傷已經急救過、重創手術後休養中。 */
export const TREATED = 'treated'
export const AIDED = 'aided'
export const WOUND_RECOVERING = 'wound_recovering'

/** 戰鬥結束時 combat 給的重的重創：wound_limb、wound_head、wound_torso（橋的重創只影響那一場）。 */
export const WOUND_PARTS = ['limb', 'head', 'torso'] as const
export type WoundPart = (typeof WOUND_PARTS)[number]
export const isWoundPart = (v: unknown): v is WoundPart => typeof v === 'string' && (WOUND_PARTS as readonly string[]).includes(v)
export const woundCondition = (part: WoundPart): `wound_${WoundPart}` => `wound_${part}`
export const WOUND_NAME: Record<WoundPart, string> = { limb: '肢體', head: '頭', torso: '軀幹' }

/** 診所的三種（和 cyberware 讀同一欄 facility_type.clinic.grade）。 */
export const CLINIC_GRADES = ['clinic', 'unlicensed', 'black'] as const
export type ClinicGrade = (typeof CLINIC_GRADES)[number]
export const CLINIC_NAME: Record<ClinicGrade, string> = { clinic: '正規診所', unlicensed: '無照診所', black: '黑診所' }

/** 檢定用的屬性與基本功（DOWNTIME 3.1 節：技術＋醫療）。 */
export const AID_ATTR = 'tech'
export const AID_SKILL = 'medicine'

/** 體格與反應的檢定：重創與休養的檢定減值掛在檢定用的屬性上（被動效果 check.attrs；M4-core-gaps 第 7 項，以前借基本功的清單）。 */
export const PHYSICAL_ATTRS: Array<'body' | 'reflex'> = ['body', 'reflex']

export interface AidRule {
  /** 急救花幾分鐘 */
  minutes: number
  dc: number
  /** 背包裡有帶 kit_tag 標籤的物品時檢定 + 多少（不消耗） */
  kit_bonus: number
  kit_tag: string
}

export interface MedicalRules {
  aid: AidRule
  /** 診所治療每點生命值多少錢（照診所的種類） */
  heal_price: Record<ClinicGrade, number>
  /** 診所治療的價錢乘這一區的物價倍率（district.price_mult；M4 收尾修正批，TRADE 第 3 節）。預設乘 */
  district_price: boolean
  /** 診所治療每 10 點花幾分鐘（不滿 10 點也算一次） */
  heal_minutes_per_10: number
  /** 重創的手術費（三種都一樣，P46） */
  wound_price: number
  /** 手術之後休養多久（分鐘） */
  wound_recovery_minutes: number
  /** 重的重創在戰鬥外的被動效果（來源 wound），一種狀況一組 */
  wound_effects: Record<`wound_${WoundPart}`, PassiveEffect[]>
  /** 手術之後休養中的被動效果 */
  recovery_effects: PassiveEffect[]
  /** treated 掛多久（分鐘）；暫定一天 */
  treated_minutes: number
  /** 診所動刀花幾分鐘 */
  surgery_minutes: number
  /** 自己或隊友動刀花幾分鐘（一個時段） */
  self_minutes: number
  /** 自己動刀的人要通過的條件；沒有人註冊其中的條件種類就沒有自己動刀 */
  self_requires: Condition[]
}

const physical = (amount: number, label: string): PassiveEffect => ({ check: { attrs: [...PHYSICAL_ATTRS] }, amount, label })

export const DEFAULT_MEDICAL_RULES: MedicalRules = {
  aid: { minutes: 10, dc: 13, kit_bonus: 2, kit_tag: 'medkit' },
  heal_price: { clinic: 8, unlicensed: 4, black: 5 },
  district_price: true,
  heal_minutes_per_10: 60,
  wound_price: 1200,
  wound_recovery_minutes: 4320,
  // P46：肢體 體格與反應的檢定 −4；軀幹 max_hp −5、身上那件護甲失效；頭沒有數字（眼或腦的義體失效是 cyberware 讀狀況做的）
  wound_effects: {
    wound_limb: [physical(-4, '肢體重創')],
    wound_torso: [{ stat: 'max_hp', amount: -5, label: '軀幹重創' }, { stat: 'armor_body', amount: -99, label: '軀幹重創' }],
    wound_head: [],
  },
  recovery_effects: [physical(-2, '手術後休養')],
  treated_minutes: 1440,
  surgery_minutes: 60,
  self_minutes: 240,
  self_requires: [{ kind: 'ability', daily: 'surgery' }],
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isMinutes = (v: unknown): v is number => isSafeInt(v) && v >= 0 && v <= 525_600
const isMoney = (v: unknown): v is number => isSafeInt(v) && v >= 0 && v <= 1_000_000

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.aid !== undefined) {
    const a = e.aid
    if (!isRecord(a)) p.push('aid 要是 { minutes, dc, kit_bonus, kit_tag }')
    else {
      if (a.minutes !== undefined && !(isSafeInt(a.minutes) && a.minutes >= 0 && a.minutes <= 1440)) p.push('aid.minutes 要是 0～1440 的整數')
      if (a.dc !== undefined && !(isSafeInt(a.dc) && a.dc >= 1 && a.dc <= 40)) p.push('aid.dc 要是 1～40 的整數')
      if (a.kit_bonus !== undefined && !(isSafeInt(a.kit_bonus) && a.kit_bonus >= 0 && a.kit_bonus <= 20)) p.push('aid.kit_bonus 要是 0～20 的整數')
      if (a.kit_tag !== undefined && !isText(a.kit_tag)) p.push('aid.kit_tag 要是物品標籤')
    }
  }
  if (e.heal_price !== undefined) {
    if (!isRecord(e.heal_price)) p.push('heal_price 要是 { clinic, unlicensed, black }（每點生命值的價錢）')
    else for (const [g, n] of Object.entries(e.heal_price)) {
      if (!(CLINIC_GRADES as readonly string[]).includes(g)) p.push(`heal_price.${g}：診所只有 ${CLINIC_GRADES.join('、')}`)
      else if (!isMoney(n)) p.push(`heal_price.${g} 要是 0～1000000 的整數`)
    }
  }
  if (e.district_price !== undefined && typeof e.district_price !== 'boolean') p.push('district_price 要是 true 或 false（診所治療的價錢乘不乘這一區的物價倍率）')
  if (e.heal_minutes_per_10 !== undefined && !isMinutes(e.heal_minutes_per_10)) p.push('heal_minutes_per_10 要是 0～525600 的整數（分鐘）')
  if (e.wound_price !== undefined && !isMoney(e.wound_price)) p.push('wound_price 要是 0～1000000 的整數')
  if (e.wound_recovery_minutes !== undefined && !isMinutes(e.wound_recovery_minutes)) p.push('wound_recovery_minutes 要是 0～525600 的整數（分鐘）')
  if (e.wound_effects !== undefined) {
    if (!isRecord(e.wound_effects)) p.push('wound_effects 要是 { wound_limb、wound_torso、wound_head: 被動效果的陣列 }')
    else for (const [id, list] of Object.entries(e.wound_effects)) {
      if (!WOUND_PARTS.some((part) => woundCondition(part) === id)) p.push(`wound_effects.${id}：狀況只有 ${WOUND_PARTS.map(woundCondition).join('、')}`)
      else if (!Array.isArray(list) || !list.every(isRecord)) p.push(`wound_effects.${id} 要是被動效果的陣列`)
    }
  }
  if (e.recovery_effects !== undefined && !(Array.isArray(e.recovery_effects) && e.recovery_effects.every(isRecord))) p.push('recovery_effects 要是被動效果的陣列')
  if (e.treated_minutes !== undefined && !isMinutes(e.treated_minutes)) p.push('treated_minutes 要是 0～525600 的整數（分鐘）')
  if (e.surgery_minutes !== undefined && !(isSafeInt(e.surgery_minutes) && e.surgery_minutes >= 0 && e.surgery_minutes <= 1440)) p.push('surgery_minutes 要是 0～1440 的整數')
  if (e.self_minutes !== undefined && !(isSafeInt(e.self_minutes) && e.self_minutes >= 0 && e.self_minutes <= 1440)) p.push('self_minutes 要是 0～1440 的整數')
  if (e.self_requires !== undefined && !(Array.isArray(e.self_requires) && e.self_requires.every((c) => isRecord(c) && isText(c.kind)))) p.push('self_requires 要是條件的陣列')
  return p
}

/** 現在生效的規則：資料 medical_rule/default 蓋掉內建的預設（格式不對的欄位忽略；aid、heal_price、wound_effects 逐項蓋）。 */
export function medicalRules(k: Pick<Kernel, 'content'>): MedicalRules {
  const out = clone(DEFAULT_MEDICAL_RULES)
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('aid')) {
    const a = e.aid as Record<string, unknown>
    if (a.minutes !== undefined) out.aid.minutes = a.minutes as number
    if (a.dc !== undefined) out.aid.dc = a.dc as number
    if (a.kit_bonus !== undefined) out.aid.kit_bonus = a.kit_bonus as number
    if (a.kit_tag !== undefined) out.aid.kit_tag = a.kit_tag as string
  }
  if (ok('heal_price')) for (const [g, n] of Object.entries(e.heal_price as Record<string, unknown>)) out.heal_price[g as ClinicGrade] = n as number
  if (ok('district_price')) out.district_price = e.district_price as boolean
  if (ok('heal_minutes_per_10')) out.heal_minutes_per_10 = e.heal_minutes_per_10 as number
  if (ok('wound_price')) out.wound_price = e.wound_price as number
  if (ok('wound_recovery_minutes')) out.wound_recovery_minutes = e.wound_recovery_minutes as number
  if (ok('wound_effects')) for (const [id, list] of Object.entries(e.wound_effects as Record<string, unknown>)) out.wound_effects[id as `wound_${WoundPart}`] = clone(list as PassiveEffect[])
  if (ok('recovery_effects')) out.recovery_effects = clone(e.recovery_effects as PassiveEffect[])
  if (ok('treated_minutes')) out.treated_minutes = e.treated_minutes as number
  if (ok('surgery_minutes')) out.surgery_minutes = e.surgery_minutes as number
  if (ok('self_minutes')) out.self_minutes = e.self_minutes as number
  if (ok('self_requires')) out.self_requires = clone(e.self_requires as Condition[])
  return out
}

// ---- 角色身上的狀況 ----

export const nowOf = (state: GameState): number => toMinutes(state.time)

/** 有沒有一個還沒到期的狀況（沒寫 until 的不會到期）。 */
export function hasCond(state: GameState, actor: ActorId, id: string): boolean {
  const now = nowOf(state)
  return !!state.actors[actor]?.conditions.some((c) => c.id === id && (c.until === undefined || c.until > now))
}

/** 那個人身上有哪幾種重的重創（照 limb、head、torso 的順序）。 */
export function woundsOf(state: GameState, actor: ActorId): WoundPart[] {
  return WOUND_PARTS.filter((part) => hasCond(state, actor, woundCondition(part)))
}

/** 生命值上限：有 max_hp 就用它；沒有人註冊時照 CORE_RULES 4.1 節的 20 ＋ 體格 × 2。 */
export function maxHpOf(k: Pick<Kernel, 'stats'>, state: GameState, actor: ActorId): number {
  return k.stats.hasStat('max_hp') ? k.stats.stat(state, actor, 'max_hp') : 20 + k.stats.effectiveAttr(state, actor, 'body') * 2
}

export const nameOf = (state: GameState, id: ActorId): string => state.actors[id]?.name ?? id

/** 一種錢的名字。 */
export type Pool = 'cred' | 'cash'
export const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }
