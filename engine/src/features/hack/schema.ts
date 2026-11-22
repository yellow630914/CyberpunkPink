// L6 功能 hack：效果與內容的格式檢查小工具（欄位的型別、不認得的欄位、公式）。

import { amountProblems, isRecord } from '../../core'

export type Check = (v: unknown) => string | null
export const F: Check = (v) => amountProblems(v)[0] ?? null
export const S: Check = (v) => (typeof v === 'string' && v.trim() ? null : '要是字串（不能是空的）')
export const B: Check = (v) => (typeof v === 'boolean' ? null : '要是 true 或 false')
export const oneOf = (list: readonly string[]): Check => (v) => (typeof v === 'string' && list.includes(v) ? null : `「${String(v)}」不在清單裡（可以寫：${list.join('、')}）`)
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 一個 op 的格式檢查：spec 是欄位的檢查，required 一定要寫。op、who、if 由核心查。 */
export function schema(spec: Record<string, Check>, required: string[] = []): (e: Record<string, unknown>) => string[] {
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
    return out
  }
}

export { isRecord }
