// L2 內容：M0 用到的內容種類與它們的格式（等於這幾種資料的 schema）。資料檔在 engine/data/rules/，由 cpp-data 從設計書轉寫。
// 之後的批次要新的內容種類：功能自己用 content.defineKind 註冊，或回報給 cpp-architect 加在這裡。
//
// | kind | 檔案 | 出處 |
// |---|---|---|
// | attribute | attributes.json | CORE_RULES 第 1 節；DATA 第 1 節（id） |
// | skill | skills.json | CORE_RULES 第 2 節 |
// | perk | perks.json | CHARACTER 第 4、5.2、5.3、6 節 |
// | origin | origins.json | CHARACTER 第 2、6 節 |
// | creation_rule | creation.json | CHARACTER 第 1、5 節 |
// | effect_cap | effect_caps.json | EVENTS 2.4 節 |
// | action_kind | actions.json | AI_TASKS 3.1 節；CORE_RULES 第 3 節 |

import { ATTR_IDS } from '../types/ids'
import { isId, isRecord } from '../util/sanitize'
import type { ContentEntry, ContentRegistry } from './registry'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isAttr = (v: unknown) => (ATTR_IDS as readonly unknown[]).includes(v)
const idList = (v: unknown) => Array.isArray(v) && v.every(isId)

/** 特質的分類（CHARACTER 4.2 節）；缺陷另外用 flaw 標。 */
export const PERK_CATEGORIES = ['street', 'social', 'body', 'bridge', 'craft', 'net', 'media', 'desire', 'origin'] as const
/** 起始的身分（CHARACTER 第 2 節；LIFE 第 2 節）。 */
export const ORIGIN_STATUSES = ['citizen', 'unregistered'] as const
/** DC 的檔位（CORE_RULES 第 3 節）。和 rules/check.ts 的 DC_TIERS 同一組鍵。 */
export const DC_TIER_IDS = ['easy', 'normal', 'hard', 'extreme', 'legendary', 'mythic'] as const
/** 成功程度，加上「成功但差距不到 3」的 narrow（參考範圍可以另外寫）。 */
export const HINT_KEYS = ['critical', 'success', 'narrow', 'fail', 'fumble'] as const

export interface AttributeEntry extends ContentEntry { name: string; desc: string }
export interface SkillEntry extends ContentEntry { name: string; attr: (typeof ATTR_IDS)[number]; desc: string }
export interface PerkEntry extends ContentEntry {
  name: string
  category: (typeof PERK_CATEGORIES)[number]
  /** 特質的價錢或缺陷退的點數，1～3（CHARACTER 5.3 節） */
  cost: number
  flaw: boolean
  desc: string
  /** 某一類檢定的加值：指定基本功，或指定情境的標籤（兩個都寫就是都要符合） */
  checks?: { skills?: string[]; tags?: string[]; bonus: number }
  /** 衍生數值的加減，鍵是數值的 id（max_hp、load_cap、ram_max……） */
  stats?: Record<string, number>
  /** 受內容篩選控制的成人特質 */
  adult?: boolean
  /** 設計書裡沒有、先借來讓遊戲能跑的示意資料 */
  provisional?: boolean
}
export interface OriginEntry extends ContentEntry {
  name: string
  line: string
  skill_bonus: Record<string, number>
  status: (typeof ORIGIN_STATUSES)[number]
  home: string
  favor: { choose_one: string[]; value: number }
  perk: string
  roster: string[]
  lifepath_extra?: string[]
}
export interface CreationRuleEntry extends ContentEntry {
  attr_array: number[]
  attr_free: number
  attr_max: number
  attr_min: number
  skill_points: number
  skill_max: number
  perk_points: number
  perk_max: number
  flaw_max: number
  min_age: number
  start_money: number
}
export type ActionHint = Partial<Record<(typeof HINT_KEYS)[number], Array<Record<string, unknown>>>>
export interface ActionKindEntry extends ContentEntry {
  name: string
  attr: (typeof ATTR_IDS)[number]
  skill?: string
  dc: (typeof DC_TIER_IDS)[number]
  minutes: number
  max_minutes: number
  tags?: string[]
  /** 能不能做的條件（規則核心的條件格式） */
  requires?: Record<string, unknown>
  /** 擋住時給玩家看的句子 */
  blocked_text?: string
  /** 參考範圍：每個成功程度平常給什麼效果。這是 I 級的區 */
  hint?: ActionHint
  /** 其他等級的區的參考範圍，鍵是 2～5；沒寫的等級用比它低、最近的那一級 */
  hint_by_grade?: Record<string, ActionHint>
}

export function registerCoreKinds(content: ContentRegistry): void {
  content.defineKind<AttributeEntry>({
    kind: 'attribute', owner: 'core',
    validate: (e) => [...(isAttr(e.id) ? [] : [`id 只能是 ${ATTR_IDS.join('、')}`]), ...(isText(e.name) ? [] : ['要有 name']), ...(isText(e.desc) ? [] : ['要有 desc'])],
  })

  content.defineKind<SkillEntry>({
    kind: 'skill', owner: 'core',
    validate: (e) => [...(isText(e.name) ? [] : ['要有 name']), ...(isAttr(e.attr) ? [] : [`attr 只能是 ${ATTR_IDS.join('、')}`]), ...(isText(e.desc) ? [] : ['要有 desc'])],
  })

  content.defineKind<PerkEntry>({
    kind: 'perk', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name')
      if (!isText(e.desc)) p.push('要有 desc（完整的句子）')
      if (!(PERK_CATEGORIES as readonly unknown[]).includes(e.category)) p.push(`category 只能是 ${PERK_CATEGORIES.join('、')}`)
      if (!isInt(e.cost) || e.cost < 1 || e.cost > 3) p.push('cost 要是 1～3')
      if (typeof e.flaw !== 'boolean') p.push('flaw 要是布林值')
      if (e.checks !== undefined) {
        const c = e.checks
        if (!isRecord(c) || !isInt(c.bonus) || c.bonus === 0) p.push('checks.bonus 要是不為 0 的整數')
        else {
          if (c.skills !== undefined && !idList(c.skills)) p.push('checks.skills 要是基本功 id 的陣列')
          if (c.tags !== undefined && !(Array.isArray(c.tags) && c.tags.every(isText))) p.push('checks.tags 要是標籤的陣列')
          if (!c.skills && !c.tags) p.push('checks 要寫 skills 或 tags 其中一個')
          // 特質只有好處、缺陷只有壞處（CHARACTER 4.3 節）
          if (e.flaw === true && c.bonus > 0) p.push('缺陷的 checks.bonus 要是負的')
          if (e.flaw === false && c.bonus < 0) p.push('特質的 checks.bonus 要是正的')
        }
      }
      if (e.stats !== undefined && !(isRecord(e.stats) && Object.values(e.stats).every((v) => typeof v === 'number' && v !== 0))) p.push('stats 的值要是不為 0 的數字')
      return p
    },
    refs: (e) => (e.checks?.skills ?? []).map((s) => ['skill', s]),
  })

  content.defineKind<OriginEntry>({
    kind: 'origin', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      for (const f of ['name', 'line', 'home'] as const) if (!isText(e[f])) p.push(`要有 ${f}`)
      if (!isRecord(e.skill_bonus) || !Object.keys(e.skill_bonus).length || Object.values(e.skill_bonus).some((v) => !isInt(v) || v < 1)) p.push('skill_bonus 要是「基本功 id → 正整數」')
      if (!(ORIGIN_STATUSES as readonly unknown[]).includes(e.status)) p.push(`status 只能是 ${ORIGIN_STATUSES.join('、')}`)
      if (!isRecord(e.favor) || !Array.isArray(e.favor.choose_one) || !e.favor.choose_one.length || !e.favor.choose_one.every(isText) || !isInt(e.favor.value)) p.push('favor 要有 choose_one（勢力的陣列，至少一個）與 value')
      if (!isId(e.perk)) p.push('要有 perk（出身特質的 id）')
      // 勢力與 NPC 的 id 表設計書還沒有定，先收名字（dev/adr/0004）
      if (!(Array.isArray(e.roster) && e.roster.every(isText))) p.push('roster 要是陣列（開場就在名冊上的人）')
      if (e.lifepath_extra !== undefined && !idList(e.lifepath_extra)) p.push('lifepath_extra 要是 id 的陣列')
      return p
    },
    refs: (e) => [...Object.keys(e.skill_bonus).map((s) => ['skill', s] as [string, string]), ['perk', e.perk]],
  })

  const CREATION_INTS = ['attr_free', 'attr_max', 'attr_min', 'skill_points', 'skill_max', 'perk_points', 'perk_max', 'flaw_max', 'min_age', 'start_money'] as const
  content.defineKind<CreationRuleEntry>({
    kind: 'creation_rule', owner: 'core',
    validate: (e) => [
      ...(Array.isArray(e.attr_array) && e.attr_array.length === ATTR_IDS.length && e.attr_array.every(isInt) ? [] : [`attr_array 要是 ${ATTR_IDS.length} 個整數`]),
      ...CREATION_INTS.filter((f) => !isInt(e[f]) || (e[f] as number) < 0).map((f) => `${f} 要是 0 以上的整數`),
      ...(isInt(e.min_age) && e.min_age < 18 ? ['min_age 不能低於 18：所有角色都是成年人'] : []),
    ],
  })

  content.defineKind({
    kind: 'effect_cap', owner: 'core',
    validate: (e) => (isRecord(e.by_grade) && ['1', '2', '3', '4', '5'].every((g) => isInt((e.by_grade as Record<string, unknown>)[g])) ? [] : ['by_grade 要有 1～5 五個等級的整數']),
  })

  content.defineKind<ActionKindEntry>({
    kind: 'action_kind', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name')
      if (!isAttr(e.attr)) p.push(`attr 只能是 ${ATTR_IDS.join('、')}`)
      if (e.skill !== undefined && !isId(e.skill)) p.push('skill 要是基本功的 id')
      if (!(DC_TIER_IDS as readonly unknown[]).includes(e.dc)) p.push(`dc 只能是 ${DC_TIER_IDS.join('、')}`)
      if (!isInt(e.minutes) || e.minutes < 0 || !isInt(e.max_minutes) || e.max_minutes < (e.minutes as number)) p.push('minutes 與 max_minutes 要是整數，而且 max_minutes 不小於 minutes')
      if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(isText))) p.push('tags 要是標籤的陣列')
      if (e.requires !== undefined && !isRecord(e.requires)) p.push('requires 要是一個條件')
      if (e.requires !== undefined && !isText(e.blocked_text)) p.push('有 requires 就要寫 blocked_text（擋住時給玩家看的句子）')
      const hintProblems = (hint: unknown, at: string) => {
        if (!isRecord(hint)) return void p.push(`${at} 要是一個物件`)
        for (const [k, list] of Object.entries(hint)) {
          if (!(HINT_KEYS as readonly string[]).includes(k)) p.push(`${at}.${k}：只能是 ${HINT_KEYS.join('、')}`)
          else if (!Array.isArray(list) || list.some((x) => !isRecord(x) || typeof x.kind !== 'string')) p.push(`${at}.${k}：要是效果的陣列`)
        }
      }
      if (e.hint !== undefined) hintProblems(e.hint, 'hint')
      if (e.hint_by_grade !== undefined) {
        if (!isRecord(e.hint_by_grade)) p.push('hint_by_grade 要是一個物件')
        else for (const [g, hint] of Object.entries(e.hint_by_grade)) {
          if (!['2', '3', '4', '5'].includes(g)) p.push(`hint_by_grade.${g}：等級只能是 2～5`)
          else hintProblems(hint, `hint_by_grade.${g}`)
        }
      }
      return p
    },
    refs: (e) => (e.skill ? [['skill', e.skill]] : []),
  })
}
