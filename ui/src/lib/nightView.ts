import type { BranchView, LearnView } from '@engine/src/features/nightclass'

/**
 * 夜課分支的顯示整理（UI 8.4 節「看得到什麼」）：只決定哪些技能顯示名字、哪些寫「…」；
 * 開階條件、有沒有開、掛在沒有的標籤上的個數、標籤是不是「深」全是引擎 nightList 給的。這裡沒有規則，只有排版。
 */
export interface NightRow { kind: 'skill'; skill: LearnView }
export interface NightMasked { kind: 'masked'; tier: number; count: number }
export type NightEntry = NightRow | NightMasked

/**
 * 還沒開的階：下一階整階顯示；再往後只顯示掛在你有的標籤上的技能，其餘（沒掛標籤的）同一階合成一個「…」。
 * 已經開了的階一律照引擎給的顯示（引擎已經把掛在你沒有的標籤上的、被內容篩選關掉的拿掉）。
 */
export function nightEntries(b: Pick<BranchView, 'tier' | 'skills'>): NightEntry[] {
  const out: NightEntry[] = []
  for (const s of b.skills) {
    const far = s.tier > b.tier + 1
    if (far && s.tag === null) {
      const last = out[out.length - 1]
      if (last && last.kind === 'masked' && last.tier === s.tier) last.count += 1
      else out.push({ kind: 'masked', tier: s.tier, count: 1 })
    } else out.push({ kind: 'skill', skill: s })
  }
  return out
}

/** 「N 個掛在你沒有的標籤上」；0 不寫。 */
export const hiddenLine = (n: number): string => (n > 0 ? `${n} 個掛在你沒有的標籤上` : '')
