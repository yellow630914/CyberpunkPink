/**
 * 難度的係數（BALANCE 7.2、7.3 節）。難度只調兩件事：敵人（生命、傷害、感載上限；輿論戰對手的公關點）與寫成檔位的 DC。
 * 自訂：先從一個預設的難度複製全部的數字，再逐格改。每格 0.25～5（步進 0.01）；公關點 −3～+3；DC 偏移 −4～+4。
 * 設定裡的難度名稱照 BALANCE 第 7 節：故事、簡單、普通、困難、傳奇，另加自訂（第四版起；原本第二版叫「輕鬆」「殘酷」）。
 */
export interface Coef { hp: number; dmg: number; load: number }
export interface DiffTable { boss: Coef; low12: Coef; low3: Coef; low45: Coef; pr: number; dc: number }
export type PresetName = '故事' | '簡單' | '普通' | '困難' | '傳奇'
const c = (hp: number, dmg: number, load: number): Coef => ({ hp, dmg, load })
const same = (boss: Coef, low: Coef, pr: number, dc: number): DiffTable => ({ boss, low12: { ...low }, low3: { ...low }, low45: { ...low }, pr, dc })
export const DIFF_PRESETS: Record<PresetName, DiffTable> = {
  故事: same(c(0.6, 0.5, 0.6), c(0.6, 0.4, 0.6), -1, -2),
  簡單: same(c(0.85, 0.8, 0.85), c(0.85, 0.75, 0.85), -1, -1),
  普通: same(c(1, 1, 1), c(1, 1, 1), 0, 0),
  困難: same(c(1.15, 1.35, 1.15), c(1.15, 1.35, 1.15), 1, 1),
  傳奇: same(c(1.3, 1.5, 1.3), c(1.3, 1.7, 1.3), 2, 2),
}
export const DIFF_GROUPS: Array<{ k: 'boss' | 'low12' | 'low3' | 'low45'; name: string }> = [
  { k: 'boss', name: '首領' },
  { k: 'low12', name: '雜兵與精英・I～II 級' },
  { k: 'low3', name: '雜兵與精英・III 級' },
  { k: 'low45', name: '雜兵與精英・IV～V 級' },
]
export const COEF_RANGE = { lo: 0.25, hi: 5, step: 0.01 }
export const PR_RANGE = { lo: -3, hi: 3 }
export const DC_RANGE = { lo: -4, hi: 4 }
export const copyPreset = (p: PresetName): DiffTable => structuredClone(DIFF_PRESETS[p])
export function clampCoef(v: number) { return Math.round(Math.max(COEF_RANGE.lo, Math.min(COEF_RANGE.hi, v)) * 100) / 100 }
export function clampInt(v: number, r: { lo: number; hi: number }) { return Math.max(r.lo, Math.min(r.hi, Math.round(v))) }
/** 現在的難度用哪一張表（自訂用自己的表） */
export function tableFor(name: string, custom: DiffTable | null): DiffTable {
  if (name === '自訂' && custom) return custom
  return DIFF_PRESETS[(name in DIFF_PRESETS ? name : '普通') as PresetName]
}
/** 一個敵人照難度乘：等級 1～5，位階 boss 用首領那一列 */
export function scaleEnemy(t: DiffTable, grade: number, boss: boolean, base: { hp: number; load: number }) {
  const row = boss ? t.boss : grade <= 2 ? t.low12 : grade === 3 ? t.low3 : t.low45
  return { hp: Math.round(base.hp * row.hp), load: Math.round(base.load * row.load), dmg: row.dmg }
}
/** 輿論戰對手每回合的公關點加減，最少 1 點 */
export const prPoints = (st: number, t: DiffTable) => Math.max(1, st * 2 + t.pr)
/** 寫成檔位的 DC 加偏移 */
export const dcWith = (dc: number, t: DiffTable) => dc + t.dc
/** 把一場遭遇的敵人照難度乘：生命、感載上限，傷害係數記在 dmg（戰鬥規則在敵人打我方時乘上去） */
export function applyDifficulty<T extends { lm: number; hp?: number; boss?: boolean; dmg?: number }>(foes: T[], t: DiffTable, grade = 1): T[] {
  return foes.map(f => {
    const r = scaleEnemy(t, grade, !!f.boss, { hp: f.hp ?? 0, load: f.lm })
    return { ...f, lm: Math.max(1, r.load), ...(f.hp != null ? { hp: Math.max(1, r.hp) } : {}), dmg: r.dmg }
  })
}
