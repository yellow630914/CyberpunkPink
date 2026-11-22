// L6 功能 hack：內容種類 quickhack（快駭程式；DATA 7.5 節、ITEMS 11.9 節）。
// 欄位：id、name、desc、class、grades（有哪幾級）、ram、ap、target、needs（目標的條件）、do（效果清單）、by_grade（各級蓋掉的欄位與檢定的加值）、bonus（檢定的額外加值）。
// trace、legal、price、script_twin（還有 brand）收下不讀（追蹤度、合法與價格是 M2 以後的事）。

import type { ContentEntry, Kernel } from '../../core'
import { OWNER, HACK_CLASSES } from './deck'
import type { HackClass } from './deck'
import { F, isInt, isRecord } from './schema'

export const HACK_TARGETS = ['foe', 'ally', 'self', 'foe_overlay', 'node'] as const
export type HackTarget = (typeof HACK_TARGETS)[number]
export const NEEDS_KEYS = ['bridged', 'cyber', 'marked', 'machine', 'explosive'] as const

/** 各級蓋掉的欄位。 */
export interface GradeOverride {
  ram?: number
  ap?: number
  do?: Array<Record<string, unknown>>
  /** 這一級的檢定額外加值（和等級加值疊加） */
  bonus?: number | string
}

export interface QuickhackEntry extends ContentEntry {
  name: string
  desc: string
  class: HackClass
  grades: number[]
  ram: number
  ap?: number
  target: HackTarget
  /** 目標的條件。神經類預設要有橋、義體類要有義體、控制類要有標記；寫 false 是例外（不需要標記）；machine：目標要是機器；explosive：目標的快取格裡要有爆裂物 */
  needs?: Partial<Record<(typeof NEEDS_KEYS)[number], boolean>>
  do: Array<Record<string, unknown>>
  by_grade?: Record<string, GradeOverride>
  bonus?: number | string
}

const KEYS = ['name', 'desc', 'class', 'grades', 'ram', 'ap', 'target', 'needs', 'do', 'by_grade', 'bonus', 'trace', 'legal', 'price', 'script_twin', 'brand']
const OVERRIDE_KEYS = ['ram', 'ap', 'do', 'bonus']
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function problemsOf(e: Record<string, unknown>, k: Pick<Kernel, 'battle'>): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (key !== 'id' && !KEYS.includes(key)) p.push(`${key} 不是可以用的鍵（只有 ${KEYS.join('、')}）`)
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.desc)) p.push('要有 desc（給玩家看的完整說明）')
  if (!(HACK_CLASSES as readonly unknown[]).includes(e.class)) p.push(`class 只能是 ${HACK_CLASSES.join('、')}`)
  if (!(Array.isArray(e.grades) && e.grades.length > 0 && e.grades.every((g) => isInt(g) && g >= 1 && g <= 4))) p.push('grades 要是一到四個 1～4 的整數（有哪幾級）')
  else if (new Set(e.grades).size !== e.grades.length) p.push('grades 不能有重複的級')
  if (!(isInt(e.ram) && e.ram >= 0)) p.push('ram 要是 0 以上的整數')
  if (e.ap !== undefined && !(isInt(e.ap) && e.ap >= 0 && e.ap <= 3)) p.push('ap 要是 0～3 的整數（支援類一律 0 點，不看這個欄位）')
  if (!(HACK_TARGETS as readonly unknown[]).includes(e.target)) p.push(`target 只能是 ${HACK_TARGETS.join('、')}`)
  if (e.needs !== undefined) {
    if (!isRecord(e.needs)) p.push('needs 要是物件')
    else {
      for (const key of Object.keys(e.needs)) {
        if (!(NEEDS_KEYS as readonly string[]).includes(key)) p.push(`needs.${key} 不是可以用的鍵（只有 ${NEEDS_KEYS.join('、')}）`)
        else if (typeof e.needs[key] !== 'boolean') p.push(`needs.${key} 要是 true 或 false`)
      }
      if (e.target !== undefined && !['foe', 'foe_overlay'].includes(e.target as string)) p.push('needs 只對目標是敵人或敵方掛著的東西（target 是 foe、foe_overlay）有意思')
    }
  }
  if (!Array.isArray(e.do) || e.do.length === 0) p.push('do 要是效果的陣列（每一筆 { op, ... }）')
  else p.push(...k.battle.effectProblems(e.do).map((m) => `do：${m}`))
  if (e.bonus !== undefined && F(e.bonus)) p.push(`bonus：${F(e.bonus)}`)
  if (e.by_grade !== undefined) {
    const g = e.by_grade
    if (!isRecord(g)) p.push('by_grade 要是 { "<級>": { ram?, ap?, do?, bonus? } }')
    else {
      for (const [level, o] of Object.entries(g)) {
        const at = `by_grade.${level}`
        if (!(['1', '2', '3', '4'].includes(level))) p.push(`${at}：級只能是 1～4`)
        else if (Array.isArray(e.grades) && !(e.grades as number[]).includes(Number(level))) p.push(`${at}：這支程式沒有這一級（grades 是 ${(e.grades as number[]).join('、')}）`)
        if (!isRecord(o)) {
          p.push(`${at} 要是物件`)
          continue
        }
        for (const key of Object.keys(o)) if (!OVERRIDE_KEYS.includes(key)) p.push(`${at}.${key} 不是可以蓋掉的欄位（只有 ${OVERRIDE_KEYS.join('、')}）`)
        if (o.ram !== undefined && !(isInt(o.ram) && o.ram >= 0)) p.push(`${at}.ram 要是 0 以上的整數`)
        if (o.ap !== undefined && !(isInt(o.ap) && o.ap >= 0 && o.ap <= 3)) p.push(`${at}.ap 要是 0～3 的整數`)
        if (o.bonus !== undefined && F(o.bonus)) p.push(`${at}.bonus：${F(o.bonus)}`)
        if (o.do !== undefined) {
          if (!Array.isArray(o.do) || o.do.length === 0) p.push(`${at}.do 要是效果的陣列`)
          else p.push(...k.battle.effectProblems(o.do).map((m) => `${at}.do：${m}`))
        }
      }
    }
  }
  return p
}

export function registerKinds(k: Kernel): void {
  k.content.defineKind<QuickhackEntry>({ kind: 'quickhack', owner: OWNER, validate: (e) => problemsOf(e, k) })
}
