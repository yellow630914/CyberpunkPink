// L1 純工具：字串的排序。會影響「誰先、抽到誰」的排序一律用這裡的，不用 String.prototype.localeCompare：
// 它不帶語系時用執行環境的語系（捷克、斯洛伐克語系把 ch 排在 h 後面……），同一份存檔在兩台機器上抽到的人不一樣；
// 測試在 node 的預設語系下看不到（EVENTS 3.2 節：所有亂數用存檔種子，回退之後重來要得到同樣的結果；不變式第 5 條）。

/** 依字元碼（UTF-16 碼元）比大小：和語系無關。給 Array.sort 用。 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 「自然排序」：數字的部分照數字大小比（u2 排在 u10 前面），其餘照字元碼。和語系無關。
 * 數字一樣大而寫法不同（u01、u1）時，位數少的排前面，免得兩個不同的 id 比出 0。
 */
export function compareNatural(a: string, b: string): number {
  const ta = a.match(/\d+|\D+/g) ?? []
  const tb = b.match(/\d+|\D+/g) ?? []
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i]!, y = tb[i]!
    if (x === y) continue
    const dx = /^\d/.test(x), dy = /^\d/.test(y)
    if (dx && dy) {
      const nx = x.replace(/^0+(?=\d)/, ''), ny = y.replace(/^0+(?=\d)/, '')
      if (nx.length !== ny.length) return nx.length < ny.length ? -1 : 1
      if (nx !== ny) return nx < ny ? -1 : 1
      return x.length < y.length ? -1 : 1
    }
    return compareText(x, y)
  }
  return ta.length === tb.length ? 0 : ta.length < tb.length ? -1 : 1
}
