/**
 * 組裝、拆解、染色畫面的整理：把引擎的預覽與成品整理成畫面要的列、名字與色塊。純函式，只整理與排版。
 * 不算難度、不算成功率、不判斷放不放得進槽、不算價錢：這些一律由 store 問引擎（stores/engine.ts 的 craft、dye）。
 * 這裡的表只有「名字」「色票」這類顯示用的對照。
 */
import type { ItemStack } from '@engine/src'

// ---- 名字 ----

export const QUALITY_NAME: Record<string, string> = { fine: '精工', standard: '標準', flawed: '有瑕疵' }
export const STATE_NAME: Record<string, string> = { new: '全新', used: '二手', doujin: '同人', living: '活的' }
export const MATERIAL_NAME: Record<string, string> = { mech: '機械', bio: '生體', any: '皆可' }
export const KIND_NAME: Record<string, string> = { weapon: '武器', armor: '護甲', cyberware: '義體' }
export const AFFINITY_NAME: Record<string, string> = { meat: '現實', net: '內海', social: '輿論', media: '媒體' }
export const POOL_NAME: Record<string, string> = { cred: '帳戶', cash: '現金' }
/** 成品的數值鍵的名字：引擎給（core/rules/names.ts） */
export { statName } from '@engine/src'
import { statName } from '@engine/src'
export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))
export const pct = (x: number): string => `${Math.round(x * 100)}%`
/** 幾分鐘寫成「2 小時」「30 分鐘」（顯示用） */
export function minutesText(m: number): string {
  if (m <= 0) return '不花時間'
  if (m % 60 === 0) return `${m / 60} 小時`
  return m > 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分鐘` : `${m} 分鐘`
}
/** 重量（一位小數；整數不寫小數） */
export const weightText = (w: number): string => (Number.isInteger(w) ? String(w) : w.toFixed(1))
/** 數值整理成 [名字, 值] 的列：合計是 0 的不列 */
export function statLines(stats: Record<string, number>): Array<{ key: string; name: string; value: number; text: string }> {
  return Object.entries(stats).filter(([, v]) => v !== 0).map(([key, value]) => ({ key, name: statName(key), value, text: signed(value) }))
}
/** 兩邊的數值對起來（換零件的前後）：每一個鍵一列，標出變多或變少 */
export function statDiff(before: Record<string, number>, after: Record<string, number>): Array<{ key: string; name: string; before: number; after: number; delta: number }> {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return keys.map((key) => ({ key, name: statName(key), before: before[key] ?? 0, after: after[key] ?? 0, delta: (after[key] ?? 0) - (before[key] ?? 0) })).filter((r) => r.before !== 0 || r.after !== 0)
}

// ---- 背包裡的零件與成品 ----

/** 背包裡一疊零件被指名的鍵：有 uid 的用 uid（二手、未登錄），其餘用零件的 id */
export const partKeyOf = (stack: ItemStack): string => (typeof stack.data?.uid === 'string' ? stack.data.uid : stack.id)
/** 這一疊的 stack.data 裡內嵌的零件（未登錄零件）；沒有是 undefined */
export const inlinePartOf = (stack: ItemStack): unknown => (stack.data && typeof stack.data.part === 'object' && stack.data.part !== null ? stack.data.part : undefined)
/** 放進槽的零件鍵整理成預覽要的格式：一個給字串、兩個以上給陣列，空的槽不寫 */
export function partsArg(picks: Record<string, string[]>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [type, keys] of Object.entries(picks)) {
    if (keys.length === 1) out[type] = keys[0]!
    else if (keys.length > 1) out[type] = [...keys]
  }
  return out
}
/** 放進一個槽：槽只有一個位置就換掉，多個位置就接在後面（滿了換掉最後一個）；已經在裡面的拿出來 */
export function togglePick(current: readonly string[], key: string, count: number): string[] {
  const at = current.indexOf(key)
  if (at >= 0 && count <= 1) return current.filter((_, i) => i !== at)
  if (count <= 1) return [key]
  // 同一種零件在背包裡有好幾個時可以重複放；已經放滿就換掉最後一個
  const next = [...current, key]
  return next.length > count ? [...current.slice(0, count - 1), key] : next
}
/** 把某個零件從槽裡拿出一個（最後放進去的那一個） */
export function removePick(current: readonly string[], key: string): string[] {
  const at = current.lastIndexOf(key)
  return at < 0 ? [...current] : current.filter((_, i) => i !== at)
}

// ---- 染色 ----

export interface Dye { primary: string; secondary: string }
export interface Swatch { id: string; name: string; hex: string }

/** 色票（引擎的顏色值是色票 id 或 #RRGGBB；這裡只決定畫出來的顏色與名字） */
export const PALETTE: Swatch[] = [
  { id: 'dye_black', name: '黑', hex: '#1A1520' },
  { id: 'dye_gray', name: '鐵灰', hex: '#6E6878' },
  { id: 'dye_white', name: '白', hex: '#F3EEF5' },
  { id: 'dye_chrome', name: '鉻銀', hex: '#C8CDD6' },
  { id: 'dye_pink', name: '霓虹粉', hex: '#F06AA0' },
  { id: 'dye_sakura', name: '櫻粉', hex: '#F7B6C8' },
  { id: 'dye_red', name: '正紅', hex: '#D8344A' },
  { id: 'dye_orange', name: '橘', hex: '#F08A3C' },
  { id: 'dye_gold', name: '金', hex: '#F2C14E' },
  { id: 'dye_khaki', name: '卡其', hex: '#B59B6A' },
  { id: 'dye_olive', name: '橄欖綠', hex: '#6B7A3A' },
  { id: 'dye_mint', name: '薄荷', hex: '#45D6C5' },
  { id: 'dye_blue', name: '霓虹藍', hex: '#3B8FD9' },
  { id: 'dye_navy', name: '深藍', hex: '#24315E' },
  { id: 'dye_violet', name: '紫', hex: '#8A6FE0' },
  { id: 'dye_wine', name: '酒紅', hex: '#6E2140' },
]
const BY_ID = new Map(PALETTE.map((s) => [s.id, s]))
const HEX = /^#[0-9a-fA-F]{6}$/
const FALLBACK: Dye = { primary: 'dye_gray', secondary: 'dye_black' }

/** 這個值畫得出來嗎：色票 id 或 #RRGGBB（只用來整理存檔與輸入，能不能染是引擎的 isColor） */
export const isColor = (v: unknown): v is string => typeof v === 'string' && (BY_ID.has(v) || HEX.test(v))
/** 顏色的 #RRGGBB（大寫）。不認得的值退回鐵灰 */
export const hexOf = (v: string): string => (BY_ID.get(v)?.hex ?? (HEX.test(v) ? v : '#6E6878')).toUpperCase()
const rgb = (h: string): number[] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
/** 最接近的色票（自訂顏色的名字用） */
export function nearest(hex: string): Swatch {
  const [r, g, b] = rgb(hex)
  let best = PALETTE[0]!
  let d = Infinity
  for (const s of PALETTE) {
    const [r2, g2, b2] = rgb(s.hex)
    const e = (r - r2!) ** 2 + (g - g2!) ** 2 + (b - b2!) ** 2
    if (e < d) { d = e; best = s }
  }
  return best
}
/** 顏色的名字：色票用色票的名字；自訂的寫「偏某某的自訂色」 */
export function colorName(v: string): string {
  const s = BY_ID.get(v)
  if (s) return s.name
  if (!HEX.test(v)) return '鐵灰'
  return `偏${nearest(v).name}的自訂色`
}
/** 引擎的成品染色（primary_color、secondary_color，可能只有一個）整理成畫面的一組；都沒有是 null */
export function dyeOfColors(c: { primary_color?: string; secondary_color?: string } | undefined | null): Dye | null {
  if (!c || (!c.primary_color && !c.secondary_color)) return null
  return { primary: c.primary_color ?? FALLBACK.primary, secondary: c.secondary_color ?? FALLBACK.secondary }
}
/** 存檔裡的染色表（舊的內海 SKIN 染色）：讀進來時丟掉格式不對的 */
export function sanitizeDyes(raw: unknown): Record<string, Dye> {
  const out: Record<string, Dye> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = v as Partial<Dye> | null
    if (/^(uid|slot|skin):/.test(k) && d && isColor(d.primary) && isColor(d.secondary)) out[k] = { primary: d.primary, secondary: d.secondary }
  }
  return out
}
export const DEFAULT_SKIN_DYE: Dye = { ...FALLBACK }

// ---- 結果與圖標 ----

/** 報告的結果（craft.assemble、craft.swap、craft.salvage、craft.learn、enemies.dissect）的標題字；結果的句子是引擎給的 narration，這裡只是標題 */
export const RESULT_NAME: Record<string, string> = {
  fine: '精工', standard: '照規格', flawed: '有瑕疵', burned: '燒掉了', doujin: '同人的手筆',
  swapped: '換好了', all: '全部完好', some: '部分完好', none: '沒有完好的', learned: '學會了', got: '拆到了', nothing: '什麼都沒拆到',
}
/** 結果的顏色類別：好、中、壞 */
export const RESULT_TONE: Record<string, 'good' | 'mid' | 'bad'> = {
  fine: 'good', standard: 'mid', flawed: 'bad', burned: 'bad', doujin: 'mid', swapped: 'mid', all: 'good', some: 'mid', none: 'bad', learned: 'good', got: 'good', nothing: 'bad',
}
const PART_ICONS = ['chip', 'neuron', 'software', 'plate', 'actuator', 'sensor', 'power', 'skin', 'barrel', 'blade', 'fiber']
/** 零件類型的通用圖標（空槽用）；機構叫 mech */
export const partIcon = (type: string): string => `ic-part_${type === 'action' ? 'mech' : PART_ICONS.includes(type) ? type : 'plate'}`
export const gradeOf = (n: unknown): 1 | 2 | 3 | 4 | 5 => (typeof n === 'number' && n >= 1 && n <= 5 ? (Math.floor(n) as 1 | 2 | 3 | 4 | 5) : 1)
/** 設計圖種類的通用圖標（設計圖清單用） */
export const bpIcon = (kind: string): string => (kind === 'weapon' ? 'ic-carry_side' : kind === 'armor' ? 'ic-slot_armor' : 'ic-part_chip')
/** 一次檢定四種結果的名字（引擎給的機率） */
export const DEGREE_LABEL: Array<{ id: 'critical' | 'success' | 'fail' | 'fumble'; name: string }> = [
  { id: 'critical', name: '大成功' }, { id: 'success', name: '成功' }, { id: 'fail', name: '失敗' }, { id: 'fumble', name: '大失敗' },
]
