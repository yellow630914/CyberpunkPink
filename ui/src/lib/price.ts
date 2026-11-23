/** 錢的顯示：千分位。價格的算法、拆解與收購價全在引擎的 features/trade（畫面看 stores/engine.ts 的 trade）。 */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
