// L6 功能：探索的資料慣例（地圖實例的 ext；dev/work/M2-explore.md「新的格式與鍵」）。
//
// 開地圖的人填、這個功能讀：guards、reinforce、origin、stealth、dc_base、grade、spot、edge、patrol_half。
// 這個功能自己寫：keys（拿到的憑證點 id）、controlled（接管的區，寫成 "<圖的 id>:<區塊>"）、carry（帶著的人，& 的 id）、
// seen_by（已經看到你的保全崗 id，潛行時只算一次）、reinforced（增援已經加過了）。
// 讀的時候一律當作不可信的資料：壞掉的就當沒寫。

import type { Change, GameState, UnitRef } from '../../core'
import { clone } from '../../core'

export type Ext = Record<string, unknown>

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface GuardPost {
  foes: UnitRef[]
  /** 贏的那一方的勢力（戰敗事件用） */
  faction?: string
}

/** 把每個保全崗放誰寫在這份地圖的實例上。回傳變更（呼叫的人放進自己的報告）。鍵是標記的 id（G1、G2）。 */
export function placeGuards(state: GameState, mapInstanceId: string, guards: Record<string, GuardPost>): Change[] {
  const instance = state.maps.instances[mapInstanceId]
  if (!instance) throw new Error(`沒有 ${mapInstanceId} 這份地圖`)
  return [{ op: 'map.ext', map: mapInstanceId, value: { ...clone(instance.ext ?? {}), guards: clone(guards) } }]
}

export function extOf(state: GameState, mapId: string): Ext {
  const e = state.maps.instances[mapId]?.ext
  return isRec(e) ? e : {}
}

export function guardOf(ext: Ext | undefined, id: string): GuardPost | undefined {
  const g = isRec(ext?.guards) ? ext.guards[id] : undefined
  return isRec(g) && Array.isArray(g.foes) ? (g as unknown as GuardPost) : undefined
}

/** 字串的清單：不是陣列就是空的，裡面不是字串的丟掉。 */
export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }

/** 副本的等級（1～5）：寫數字或羅馬數字都收；沒寫或壞掉是 undefined。 */
export function gradeOf(ext: Ext): number | undefined {
  const g = ext.grade
  if (typeof g === 'number' && Number.isFinite(g)) return Math.max(1, Math.min(5, Math.round(g)))
  if (typeof g === 'string' && ROMAN[g]) return ROMAN[g]
  return undefined
}

/** DC 基準：ext.dc_base；沒寫是 10 ＋ 等級 × 2（SITES 12.5 節；等級沒寫算 I 級）。 */
export function dcBase(ext: Ext): number {
  const d = ext.dc_base
  if (typeof d === 'number' && Number.isFinite(d)) return Math.round(d)
  return 10 + (gradeOf(ext) ?? 1) * 2
}

/** 接管的區的寫法：圖的 id 加區塊（不同張圖的區塊字母會重複）。 */
export const zoneKey = (sheet: string, zone: string): string => `${sheet}:${zone}`

export function isControlled(ext: Ext, sheet: string, zone: string | undefined): boolean {
  return zone !== undefined && strList(ext.controlled).includes(zoneKey(sheet, zone))
}

/** 拿到了任何一把憑證。 */
export const hasKey = (ext: Ext): boolean => strList(ext.keys).length > 0

/** 把一份 ext 整份換成新的值的變更。 */
export const extChange = (map: string, value: Ext): Change => ({ op: 'map.ext', map, value: clone(value) })
