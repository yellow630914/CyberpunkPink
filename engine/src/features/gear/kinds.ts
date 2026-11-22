// L6 裝備：內容種類 blueprint（設計圖）與 part（零件）的格式（DATA 7.1、7.2 節；EQUIPMENT 第 2、4、6 節）。
// 設計書另外寫的欄位（style、exposure、primary_color、affinity、drawback……）是之後的批次（組裝、染色）用的，這裡不擋。

import type { Kernel } from '../../core'
import { LEGALITIES, isRecord } from '../../core'
import type { BlueprintEntry } from './model'
import { BLUEPRINT_KINDS, CARRY_SLOTS, OWNER, WEAR_SLOTS, WEIGHT_CLASSES } from './model'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 零件的狀態（DATA 7.2 節）。 */
export const PART_STATES = ['new', 'used', 'doujin', 'living'] as const
export const PART_MATERIALS = ['mech', 'bio'] as const

function needList(v: unknown, at: string, p: string[]): void {
  if (!Array.isArray(v)) return void p.push(`${at} 要是 { type } 的陣列`)
  v.forEach((x, i) => {
    if (!isRecord(x) || !isText(x.type)) p.push(`${at}[${i}] 要有 type（零件的類型）`)
    else if (x.grade_min !== undefined && !(isInt(x.grade_min) && x.grade_min >= 1 && x.grade_min <= 5)) p.push(`${at}[${i}].grade_min 要是 1～5`)
  })
}

function blueprintProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!(BLUEPRINT_KINDS as readonly unknown[]).includes(e.kind)) p.push(`kind 只能是 ${BLUEPRINT_KINDS.join('、')}`)
  for (const f of ['name', 'desc', 'brand'] as const) if (!isText(e[f])) p.push(`要有 ${f}${f === 'desc' ? '（完整的句子）' : ''}`)
  if (!isInt(e.grade) || e.grade < 1 || e.grade > 5) p.push('grade 要是 1～5')
  if (!(LEGALITIES as readonly unknown[]).includes(e.legal)) p.push(`legal 只能是 ${LEGALITIES.join('、')}`)
  if (!isInt(e.price) || e.price < 0) p.push('price 要是 0 以上的整數')
  if (!isInt(e.size) || e.size < 0 || e.size > 4) p.push('size 要是 0～4')
  if (!isNum(e.weight) || e.weight < 0) p.push('weight 要是 0 以上的數字')
  needList(e.require, 'require', p)
  needList(e.optional, 'optional', p)
  if (e.kind === 'weapon') {
    if (!isText(e.class)) p.push('武器要寫 class（weapon_class 的 id）')
    if (!(CARRY_SLOTS as readonly unknown[]).includes(e.carry)) p.push(`carry 只能是 ${CARRY_SLOTS.join('、')}`)
  }
  if (e.kind === 'armor') {
    if (e.armor !== 0 && e.armor !== 1) p.push('armor（設計圖的基礎護甲）要是 0 或 1')
    if (!Array.isArray(e.covers) || !e.covers.length || !e.covers.every((s) => (WEAR_SLOTS as readonly unknown[]).includes(s)) || new Set(e.covers).size !== e.covers.length) p.push(`covers 要是至少一個、不重複的穿著格（${WEAR_SLOTS.join('、')}）`)
    if (!(WEIGHT_CLASSES as readonly unknown[]).includes(e.weight_class)) p.push(`weight_class 只能是 ${WEIGHT_CLASSES.join('、')}`)
    if (e.conceal !== undefined && !(isInt(e.conceal) && e.conceal >= 0)) p.push('conceal（藏匿量）要是 0 以上的整數')
    if (e.conceal_add !== undefined && !(isInt(e.conceal_add) && e.conceal_add >= 0)) p.push('conceal_add（內藏槽加的藏匿量）要是 0 以上的整數')
    if (e.quick !== undefined && !(isInt(e.quick) && e.quick >= 0)) p.push('quick（多給的快取格）要是 0 以上的整數')
  }
  return p
}

function partProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const f of ['name', 'type', 'brand'] as const) if (!isText(e[f])) p.push(`要有 ${f}`)
  if (!(PART_MATERIALS as readonly unknown[]).includes(e.material)) p.push(`material 只能是 ${PART_MATERIALS.join('、')}`)
  if (!isInt(e.grade) || e.grade < 1 || e.grade > 5) p.push('grade 要是 1～5')
  if (!isInt(e.price) || e.price < 0) p.push('price 要是 0 以上的整數')
  if (!(LEGALITIES as readonly unknown[]).includes(e.legal)) p.push(`legal 只能是 ${LEGALITIES.join('、')}`)
  if (!isInt(e.cells) || e.cells < 0) p.push('cells（份量）要是 0 以上的整數')
  if (!isRecord(e.stats) || !Object.values(e.stats).every(isNum)) p.push('stats 要是「數字的名字 → 數字」')
  if (!isNum(e.weight) || e.weight < 0) p.push('weight 要是 0 以上的數字')
  if (!isInt(e.size) || e.size < 0 || e.size > 4) p.push('size 要是 0～4')
  if (!(PART_STATES as readonly unknown[]).includes(e.state)) p.push(`state 只能是 ${PART_STATES.join('、')}`)
  if (e.traits !== undefined && !(Array.isArray(e.traits) && e.traits.every(isText))) p.push('traits 要是字串的陣列')
  return p
}

export function installKinds(k: Kernel): void {
  k.content.defineKind<BlueprintEntry>({
    kind: 'blueprint', owner: OWNER,
    validate: blueprintProblems,
    refs: (e) => (e.kind === 'weapon' && e.class ? [['weapon_class', e.class]] : []),
  })
  k.content.defineKind({ kind: 'part', owner: OWNER, validate: partProblems })
}
