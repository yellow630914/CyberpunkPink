import type { PartEntry } from '@engine/src'
import { AFFINITY_NAME, STATE_NAME, MATERIAL_NAME, signed, statName } from './craftView'
import type { HereOption } from './here'

/**
 * 未登錄零件的畫面整理（M4-ui-parts；CRAFTING 11.1 節）：把引擎的零件與等著交貨的資料排成畫面要的樣子。
 * 只做字樣與排序：價錢、等級上限、能不能訂、能不能換、怪癖的候選、擋住的原因一律是引擎給的（stores/engine.ts 的 unreg），這裡沒有規則。
 */

export interface PartStatRow { key: string; name: string; text: string }

/** 一件零件的每一條屬性（stats 與 affinity；0 的不列）。數字原樣是引擎那一筆零件的 */
export function partStatRows(part: Pick<PartEntry, 'stats' | 'affinity'>): PartStatRow[] {
  const stats = Object.entries(part.stats ?? {}).filter(([, v]) => v !== 0).map(([key, v]) => ({ key, name: statName(key), text: signed(v) }))
  const affinity = Object.entries(part.affinity ?? {}).filter(([, v]) => typeof v === 'number' && v !== 0).map(([key, v]) => ({ key: `affinity.${key}`, name: `${AFFINITY_NAME[key] ?? key}親和`, text: signed(v as number) }))
  return [...stats, ...affinity]
}

/** 一件零件的標記：材質、狀態（全新、二手、同人、活的）、未登錄 */
export function partTags(part: Pick<PartEntry, 'material' | 'state' | 'unreg'>): string[] {
  const out = [MATERIAL_NAME[part.material] ?? part.material]
  if (part.state === 'used') out.push(STATE_NAME.used!)
  if (part.unreg) out.push('未登錄')
  return out
}

/** 怪癖的一行：種類的名字加寫出來的那一句 */
export const quirkLine = (name: string, text?: string): string => (text ? `${name}：${text}` : name)

const DAY = 1440
/** 訂做還要幾天（照分鐘進位；和引擎 deliverBlock 的「還要等 N 天」同一個算法，只是給畫面分開寫） */
export const daysLeft = (readyAt: number, now: number): number => Math.max(0, Math.ceil((readyAt - now) / DAY))

/** 勾想要的方向：勾的順序就是排的順序（先勾的排前面）。再按一次拿掉 */
export const toggleWant = (want: readonly string[], id: string): string[] => (want.includes(id) ? want.filter((x) => x !== id) : [...want, id])
/** 把一個方向往前或往後挪一格 */
export function moveWant(want: readonly string[], id: string, delta: -1 | 1): string[] {
  const i = want.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= want.length) return [...want]
  const out = [...want]
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}

/** 「這裡」多一項：站在委託台上開訂做的對話框（站在哪是引擎的 deskHere；被活動擋住的原因是引擎的 blockOf） */
export function deskOption(desk: { name: string }, open: () => void, reason: string | null): HereOption {
  return { id: 'unreg.desk', name: `訂做零件（${desk.name}）`, sub: '同人社團的委託台', run: open, reason }
}
