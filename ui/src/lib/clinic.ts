import type { ItemDef } from '../data/types'

/**
 * 診所的義體手術與調校（CYBERWARE 第 2 節、CRAFTING 10.2 節、LEWD_SYSTEM 第 4 節）。純函式。
 * - 誰來做：正規診所（穩定成功、會登記、手術費 = 售價 × 10%、沉溺成本 −10%）、黑診所（便宜：× 5%、一成五的機會留下併發症）、
 *   自己或夥伴（不收錢；義體學對 10 ＋ 等級 × 2，失敗能用但帶一個瑕疵）。改造師的手術刀每階 −5%，這裡沒算。
 * - 休養照侵入度：表層 0、一般 4 小時、侵入 1 天、重度 2 天、極限 4 天。
 * - 拆下：手術費的一半，沉溺成本拿回來；有授權鎖的要先解鎖。
 * - 調校：裝 300、拆 150（調校診所）；每人 2 槽。
 */
export type Surgeon = 'clinic' | 'black' | 'self'
export const SURGEONS: Array<{ id: Surgeon; name: string; note: string }> = [
  { id: 'clinic', name: '正規診所', note: '穩定成功；會登記；沉溺成本 −10%' },
  { id: 'black', name: '黑診所', note: '便宜；15% 的機會留下併發症' },
  { id: 'self', name: '自己動手', note: '不收錢；義體學檢定，失敗帶一個瑕疵' },
]
export const RECOVERY_H: Record<string, number> = { 表層: 0, 一般: 4, 侵入: 24, 重度: 48, 極限: 96 }

export function installQuote(item: ItemDef, who: Surgeon) {
  const cy = item.cyber!
  const fee = who === 'clinic' ? Math.round(item.price * 0.1) : who === 'black' ? Math.round(item.price * 0.05) : 0
  const sink = who === 'clinic' ? Math.round(cy.sink * 0.9) : cy.sink
  return { fee, sink, hours: RECOVERY_H[cy.invasive] ?? 24, dc: who === 'self' ? 10 + item.grade * 2 : null, complication: who === 'black' ? 15 : 0 }
}
export function removeQuote(item: ItemDef) {
  return { fee: Math.round(item.price * 0.05), sink: item.cyber?.sink ?? 0, reason: item.cyber?.license ? `有授權鎖（${item.cyber.license.split('・')[0]}）：要先解鎖才能拆。` : null }
}
export const TUNE_FEE = { install: 300, remove: 150 }
/** 這個部位還有沒有空槽（橋的第 2、3 格是調校槽，不給一般義體用） */
export function freeSlot(slots: Array<string | null>, part: string): number {
  const end = part === 'bridge' ? 1 : slots.length
  for (let i = 0; i < end; i++) if (!slots[i]) return i
  return -1
}
