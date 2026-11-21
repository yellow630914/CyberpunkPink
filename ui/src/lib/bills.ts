/**
 * 每週帳單的結算（DOWNTIME 第 5 節、FIXER 第 4 節）。純函式，引擎可以直接搬。
 * - 收入先入帳，再照順序扣款；錢不夠就停在那一項，後面的都不付。
 * - 金額乘上存檔規則的帳單倍率（×0～2）；四個快捷的檔位一次設好倍率與下坡的節奏。
 * - 每一項可以事先設「用現金付」（收現金的才行）或「這一項不付了」（主動停掉的不算欠款）。
 */
export type BillPreset = '關閉' | '寬鬆' | '標準' | '嚴苛'
export const PRESET_MULT: Record<BillPreset, number> = { 關閉: 0, 寬鬆: 0.5, 標準: 1, 嚴苛: 1.5 }
/** 下坡路每一步的間隔（天）與最多走到第幾步。 */
export const PRESET_PACE: Record<BillPreset, { days: number; maxStage: number }> = {
  關閉: { days: 0, maxStage: 0 }, 寬鬆: { days: 7, maxStage: 1 }, 標準: { days: 7, maxStage: 4 }, 嚴苛: { days: 4, maxStage: 4 },
}
export const DOWNHILL = ['鎖義體', '討債人上門', '債權賣給伊甸園', '要求簽契約'] as const

export type PayFrom = '帳戶' | '現金'
export interface BillItem {
  id: string
  /** DOWNTIME 5.1 節的順序（1 房租 … 10 其他訂閱） */
  order: number
  name: string
  note: string
  base: number
  from: PayFrom
  /** 這一項也收現金 */
  cashOk?: boolean
  /** 玩家設了「這一項不付了」 */
  skipped?: boolean
  /** 沒付的後果（一句） */
  ifUnpaid: string
}
export interface Income { id: string; name: string; amount: number; to: PayFrom }

export interface BillLine extends BillItem { amount: number; paid: number; short: number; state: 'paid' | 'short' | 'unpaid' | 'skipped' }
export interface BillResult {
  lines: BillLine[]
  income: number
  dueAcc: number
  dueCash: number
  accAfter: number
  cashAfter: number
  /** 第一項付不足的 */
  firstShort: BillLine | null
  /** 有沒付的（主動停掉的不算） */
  owing: boolean
}

export function billMultiplier(preset: BillPreset | null, mult: number): number {
  const m = preset === '關閉' ? 0 : mult
  return Math.max(0, Math.min(2, m))
}

export function settleBills(items: BillItem[], incomes: Income[], wallet: { acc: number; cash: number }, mult: number): BillResult {
  let acc = wallet.acc, cash = wallet.cash
  let income = 0
  for (const i of incomes) { income += i.amount; if (i.to === '帳戶') acc += i.amount; else cash += i.amount }
  const lines: BillLine[] = []
  let stopped = false
  let dueAcc = 0, dueCash = 0
  for (const it of [...items].sort((a, b) => a.order - b.order)) {
    const amount = Math.round(it.base * mult)
    if (it.skipped) { lines.push({ ...it, amount, paid: 0, short: 0, state: 'skipped' }); continue }
    if (it.from === '帳戶') dueAcc += amount; else dueCash += amount
    if (stopped || amount === 0) { lines.push({ ...it, amount, paid: 0, short: amount, state: amount === 0 ? 'paid' : 'unpaid' }); continue }
    const have = it.from === '帳戶' ? acc : cash
    if (have >= amount) {
      if (it.from === '帳戶') acc -= amount; else cash -= amount
      lines.push({ ...it, amount, paid: amount, short: 0, state: 'paid' })
    } else {
      // 錢不夠就停在這一項：這一項付不足，後面的都不付
      lines.push({ ...it, amount, paid: 0, short: amount, state: 'short' })
      stopped = true
    }
  }
  const firstShort = lines.find(l => l.state === 'short') ?? null
  return { lines, income, dueAcc, dueCash, accAfter: acc, cashAfter: cash, firstShort, owing: lines.some(l => l.state === 'short' || l.state === 'unpaid') }
}

/** 欠繳的話這週會走到下坡路的哪一步（1～4，0 是沒事）；寬鬆最多到第 1 步。 */
export function downhillStage(owing: boolean, overdueWeeks: number, preset: BillPreset | null): number {
  if (!owing) return 0
  const cap = preset ? PRESET_PACE[preset].maxStage : 4
  if (cap === 0) return 0
  return Math.min(cap, overdueWeeks + 1, 4)
}

/** 補上差額：洗多少現金才夠（洗錢攤抽 rate）。 */
export function launderNeeded(short: number, rate: number): number {
  return short <= 0 ? 0 : Math.ceil(short / (1 - rate))
}
