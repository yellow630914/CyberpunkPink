import { d20, type Rng } from './combat/rng'

/**
 * 委託的四拍（FIXER 第 2 節、COMMISSIONS 第 2～6 節、UI.md 第 7 節）：接案（談判、怎麼付）→ 踩點 → 召集（分帳、輔助面）→ 副本（階段、面、分支、連動）。
 * 純函式；假資料在 data/commission.ts。
 */
export type Face = 'm' | 'n' | 'o'
export const FACE_NAME: Record<Face, string> = { m: '現實', n: '內海', o: '輿論' }

/** 怎麼付（FIXER 第 2 節①）：現金晶片全額；匯進帳戶 85% 並讓目標勢力敵對值 +2；三成換人情 70% ＋ 一個小人情（換成人情的部分不抽成） */
export type PayMode = 'cash' | 'acc' | 'fav'
export function payOptions(reward: number) {
  return [
    { id: 'cash' as PayMode, name: '現金晶片', get: reward, cost: '查不到。付房租前要先洗。' },
    { id: 'acc' as PayMode, name: '匯進帳戶', get: Math.round(reward * 0.85), cost: '雇主替你洗，−15%；目標勢力敵對值 +2。' },
    { id: 'fav' as PayMode, name: '三成換人情', get: Math.round(reward * 0.7), cost: '中間人欠你一個小人情；這部分她不抽成。' },
  ]
}

/** 談判：一輪交涉可以把報酬往上推，超過底線中間人會不高興（交涉對 DC 13，成功 +5%、大成功 +10%，最多到底線 ×1.15） */
export function negotiate(cur: number, floor: number, roll: number, mod: number) {
  const tot = roll + mod
  if (roll === 1) return { value: cur, text: `交涉 1d20(${roll}) + ${mod}：自然 1，她不想再談了。`, done: true }
  if (tot >= 18) return { value: Math.min(Math.round(floor * 1.15), Math.round(cur * 1.1)), text: `交涉 1d20(${roll}) + ${mod} = ${tot} 對 13：大成功，報酬 +10%。`, done: false }
  if (tot >= 13) return { value: Math.min(Math.round(floor * 1.15), Math.round(cur * 1.05)), text: `交涉 1d20(${roll}) + ${mod} = ${tot} 對 13：成功，報酬 +5%。`, done: false }
  return { value: cur, text: `交涉 1d20(${roll}) + ${mod} = ${tot} 對 13：她不讓步。`, done: false }
}

/** 分帳（UI 7.3 節）：先扣中間人抽成（換人情的部分不抽）與出場費；剩下在場的人均分，你多拿一份當老闆 */
export function split(o: { reward: number; cut: number; pay: PayMode; fees: number; members: number }) {
  const base = payOptions(o.reward).find(p => p.id === o.pay)!.get
  const cut = o.pay === 'fav' ? 0 : Math.round(base * o.cut)
  const rest = Math.max(0, base - cut - o.fees)
  const shares = o.members + 1
  const mine = Math.round((rest / shares) * 2)
  return { base, cut, fees: o.fees, rest, mine, each: Math.round(rest / shares) }
}

/** 踩點（FIXER 第 2 節②）：擲 d20 ＋ 手段的加值 對 10 ＋ 等級 × 2；第 4 次起每次 +1。超過 5 以上揭開兩項；自然 1 驚動目標 */
export function scoutDc(grade: number, nth: number) { return 10 + grade * 2 + Math.max(0, nth - 3) }
export function scoutRoll(rng: Rng, bonus: number, dc: number) {
  const die = d20(rng), tot = die + bonus
  return { die, tot, dc, reveal: die === 1 ? 0 : tot >= dc + 5 ? 2 : tot >= dc ? 1 : 0, alarm: die === 1 }
}
/** 成功率（%）：1d20 ＋ 加值 ≥ DC，自然 1 一定失敗 */
export function chance(bonus: number, dc: number) {
  let n = 0
  for (let d = 2; d <= 20; d++) if (d + bonus >= dc) n++
  return n * 5
}

/** 輔助面的結算（COMMISSIONS 6.4 節）：1d20 ＋ 基本功 ＋ 分量修正（強 +4、中 +2、弱 0）對 10 ＋ 等級 × 2 */
export const WEIGHT = { 強: 4, 中: 2, 弱: 0 } as const
export function supportRoll(rng: Rng, skill: number, weight: keyof typeof WEIGHT, grade: number) {
  const die = d20(rng), dc = 10 + grade * 2, tot = die + skill + WEIGHT[weight]
  const result: '大成功' | '成功' | '失敗' | '出事' = die === 1 ? '出事' : tot >= dc + 5 ? '大成功' : tot >= dc ? '成功' : '失敗'
  return { die, tot, dc, result }
}
