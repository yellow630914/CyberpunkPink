import type { Grade } from '../data/types'

/** 等級的羅馬數字（ART_STYLE 4.1 節：I 白、II 綠、III 藍、IV 金、V 橘）。 */
export const GRADE_LABEL: Record<Grade, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' }
export const GRADE_COLOR_NAME: Record<Grade, string> = { 1: '白', 2: '綠', 3: '藍', 4: '金', 5: '橘' }

export function isGrade(n: unknown): n is Grade {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5
}

/** 等級 → CSS 變數。獨特物品照它的等級上色，另外加紫色小標，所以這裡不管 unique。 */
export function gradeColorVar(grade: Grade | null | undefined): string {
  return isGrade(grade) ? `var(--g${grade})` : 'var(--line-2)'
}

/** 等級 → class（.g1～.g5），給 --gc 用；空格子回傳空字串。 */
export function gradeClass(grade: Grade | null | undefined): string {
  return isGrade(grade) ? `g${grade}` : ''
}

/** 「III」「iv」「3」都轉成 3；看不懂回傳 null。 */
export function parseGrade(s: string | number): Grade | null {
  if (typeof s === 'number') return isGrade(s) ? s : null
  const t = s.trim().toUpperCase()
  const roman: Record<string, Grade> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }
  if (t in roman) return roman[t]
  const n = Number(t)
  return isGrade(n) ? n : null
}
