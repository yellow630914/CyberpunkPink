// L6 功能 combat：效果格式檢查的小工具（欄位的型別、不認得的欄位、公式）與數量的算法。ops.ts、fx.ts、throw.ts 共用。
// 檢查函式回傳一句給資料作者看的話（合格是 null）；schema 把一個 op 的欄位表變成 problems。

import type { BattleEffectCtx } from '../../core'
import { ATTR_IDS, BATTLE_SLOTS, BattleBlocked, DAMAGE_TYPES, STATUS_UNTILS, amount, amountProblems, isRecord } from '../../core'

type Eff = Record<string, unknown>
type Ctx = BattleEffectCtx


export type Check = (v: unknown) => string | null
/** 數字或公式 */
export const F: Check = (v) => amountProblems(v)[0] ?? null
export const B: Check = (v) => (typeof v === 'boolean' ? null : '要是 true 或 false')
export const S: Check = (v) => (typeof v === 'string' && v.trim() ? null : '要是字串（不能是空的）')
export const oneOf = (list: readonly string[]): Check => (v) => (typeof v === 'string' && list.includes(v) ? null : `「${String(v)}」不在清單裡（可以寫：${list.join('、')}）`)
/** 數字或公式，或是這幾個字之一（'all'、'full'） */
export const orWord = (...words: string[]): Check => (v) => (typeof v === 'string' && words.includes(v) ? null : F(v))
export const num = (min?: number): Check => (v) => (typeof v === 'number' && Number.isFinite(v) && (min === undefined || v >= min) ? null : `要是${min === undefined ? '' : ` ${min} 以上的`}數字`)
export const list = (item: Check): Check => (v) => {
  if (!Array.isArray(v)) return '要是陣列'
  for (const x of v) {
    const why = item(x)
    if (why) return why
  }
  return null
}
export const pair: Check = (v) => (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x)) ? null : '要是兩個整數 [a, b]')
/** 物件：欄位各自檢查，不認得的欄位擋下；required 一定要有 */
export const shape = (spec: Record<string, Check>, required: string[] = []): Check => (v) => {
  if (!isRecord(v)) return `要是物件（欄位：${Object.keys(spec).join('、')}）`
  for (const key of Object.keys(v)) {
    const c = spec[key]
    if (!c) return `不認得的欄位 ${key}（可以寫：${Object.keys(spec).join('、')}）`
    const why = c(v[key])
    if (why) return `${key}：${why}`
  }
  for (const key of required) if (v[key] === undefined) return `${key}：一定要寫`
  return null
}
export const ATTR: Check = oneOf(ATTR_IDS)
export const TYPE: Check = oneOf(DAMAGE_TYPES)
export const UNTIL: Check = oneOf(STATUS_UNTILS)
export const STATUS_KINDS = ['control', 'debuff', 'buff', 'wound', 'mark'] as const

/** 一個 op 的格式檢查：spec 是欄位的檢查，required 一定要寫，anyOf 每一組至少寫一個。op、who、if 由核心查。 */
export function schema(spec: Record<string, Check>, required: string[] = [], anyOf: string[][] = []): (e: Eff) => string[] {
  return (e) => {
    const out: string[] = []
    for (const key of Object.keys(e)) {
      if (key === 'op' || key === 'who' || key === 'if') continue
      const check = spec[key]
      if (!check) {
        out.push(`不認得的欄位 ${key}（可以寫：${Object.keys(spec).join('、')}）`)
        continue
      }
      if (e[key] === undefined) continue
      const why = check(e[key])
      if (why) out.push(`${key}：${why}`)
    }
    for (const key of required) if (e[key] === undefined) out.push(`${key}：一定要寫`)
    for (const group of anyOf) if (group.every((key) => e[key] === undefined)) out.push(`${group.join('、')}：至少要寫一個`)
    return out
  }
}

/**
 * 數量：數字照原樣，字串照公式（可以多帶一個 spent）。沒寫用預設。寫壞的（公式不合格、不是有限的數字）當預設：
 * 載入時 problems 已經擋過；這裡是舊的道具效果一向的寬容（壞掉的數量當 0），執行時不丟錯。
 */
export function qty(ctx: Pick<Ctx, 'run' | 'user' | 'n'>, v: unknown, fallback: number): number {
  if (v === undefined) return fallback
  try {
    const n = Math.round(amount(ctx, v as number | string))
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/**
 * 打兩格的東西（投擲物、煙霧彈 III）：玩家選的相鄰那一格（pick.also）。沒選時，目標在第 1 或第 4 格只有一個相鄰的格就用它；
 * 在中間（兩邊都能選）又沒選，或選的不緊鄰目標，都擋下。
 */
export function adjacentPick(also: unknown, slot: number): number {
  if (also === undefined) {
    if (slot === 1) return 2
    if (slot === BATTLE_SLOTS) return BATTLE_SLOTS - 1
    throw new BattleBlocked(['要選相鄰的一格。'])
  }
  if (typeof also !== 'number' || !Number.isInteger(also) || also < 1 || also > BATTLE_SLOTS || Math.abs(also - slot) !== 1) throw new BattleBlocked(['要選緊鄰目標的一格。'])
  return also
}
