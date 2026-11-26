// L1 純工具：年齡的底線。所有角色 18 歲以上（AI_TASKS 3.19 節；PROMPTS H5）。
// 狀態（提交、讀檔）與內容（載入、覆蓋、匯入）用同一條掃描：任何深度叫 age 的數字欄位低於 18 就是違規（B038）。

import { isRecord } from './sanitize'

/** 所有角色 18 歲以上。 */
export const MIN_AGE = 18

/** 任何深度的 age 欄位，低於 18 的位置（讀檔與匯入時整筆拒絕，不自動改成 18）。 */
export function underageAt(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => underageAt(x, `${path}[${i}]`))
  if (isRecord(v)) {
    const out: string[] = []
    for (const [k, x] of Object.entries(v)) {
      if (k === 'age' && typeof x === 'number' && x < MIN_AGE) out.push(path ? `${path}.age` : 'age')
      else out.push(...underageAt(x, path ? `${path}.${k}` : k))
    }
    return out
  }
  return []
}
