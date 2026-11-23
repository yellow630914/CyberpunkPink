/**
 * 假系統（機甲整備、診所）還在用的成功率顯示：1d20 ＋ 加值 ≥ DC，自然 1 一定失敗。
 * 委託的成功率一律問引擎（auxChance、scoutView）；這一個只給還沒接引擎的兩個對話框，它們接上之後就刪。
 */
export function chance(bonus: number, dc: number): number {
  let n = 0
  for (let d = 2; d <= 20; d++) if (d + bonus >= dc) n++
  return n * 5
}
