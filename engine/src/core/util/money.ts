// L1 純工具：錢的格式。兩種錢都是整數（LIFE 1.1 節）；介面上數字前面不寫 C$，給 AI 與紀錄的文字才寫。

/** 1234 → "1,234" */
export function formatAmount(n: number): string {
  const v = Math.round(n)
  const sign = v < 0 ? '-' : ''
  return `${sign}${String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/** 1234 → "C$1,234"（設計書與正文的寫法）。 */
export function formatMoney(n: number): string {
  const v = Math.round(n)
  return `${v < 0 ? '-' : ''}C$${formatAmount(Math.abs(v))}`
}

export const MONEY_NAME = { cred: '帳戶', cash: '現金' } as const
