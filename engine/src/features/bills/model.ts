// L6 功能 bills 的資料與純函式：狀態的形狀（state.ext.bills）、規則、帳單項目的格式、收集項目、結算一週（planWeek）與預覽。
// 規格：FIXER 第 4 節；DOWNTIME 第 5 節（5.1 順序、5.2 付不出來、5.3 只做倍率）；EVENTS 2.2、2.4 節（bill、grace、帳單有沒有欠）；
// BALANCE 7.4 節；dev/adr/0016 第六、七節與 G3；dev/work/M2-bills.md。
//
// 不碰登錄表（登記在 index.ts）。planWeek 是純函式：給狀態與那一週，回傳每一項付了多少、要套的變更與下一份狀態；
// 預覽（billPreview）與真的結算用同一個 planWeek，所以數字一定一樣。
// 每一項本身是誰的就由誰算：這裡只收項目（掛點 bill.collect）、照順序扣款、記欠繳；房租、義體訂閱、抑制劑等是別的功能回答掛點。

import type { Change, ContentEntry, GameState, GameTime, Kernel } from '../../core'
import { clone, fromMinutes, isRecord, isSafeInt, toMinutes, weeklyRule } from '../../core'

export const OWNER = 'bills'
/** state.ext 的鍵 */
export const EXT = 'bills'
export const RULE_KIND = 'bill_rule'

export type PayWith = 'cred' | 'cash' | 'either'
export const PAY_WITH: readonly PayWith[] = ['cred', 'cash', 'either']
export type Pool = 'cred' | 'cash'

/** 掛點 bill.collect 回傳的一項（DOWNTIME 5.1 節的那張表）。 */
export interface BillLine {
  id: string
  /** 誰的項目（功能 id）：付不出來時的後果由它自己接（bill.settled） */
  owner: string
  name: string
  kind: 'income' | 'due'
  amount: number
  /** 1～10：照 DOWNTIME 5.1 節那張表的序號（收入不看它） */
  order: number
  /** cred 扣帳戶、cash 扣現金、either 預設帳戶（玩家可以設用現金） */
  pay: PayWith
}

/** 掛點 bill.settled 收到的一項：金額是乘過倍率之後的；paid 付了多少、unpaid 欠多少、skipped 是玩家停掉的（或寬限中的）。 */
export type SettledLine = BillLine & { paid: number; unpaid: number; skipped?: true; why?: SkipWhy }

// ---- 狀態 ----

export interface Debt {
  id: string
  /** 債主（勢力的 id） */
  to: string
  principal: number
  /** 週利率（0.05 就是每週 5%） */
  rate: number
  /** 利息付哪一種錢 */
  pay: Pool
}

/** 事件加的臨時項目：照週數出現幾週就沒了。 */
export interface ExtraItem {
  id: string
  name: string
  amount: number
  /** 還要出現幾週 */
  weeks: number
  pay: PayWith
}

export interface BillsState {
  /** 欠繳週數：有沒付的項目就 +1，付清歸零 */
  overdue: number
  /** 還沒併成債的欠款（沒付成的金額累計，第 3 週併成一筆債） */
  arrears: number
  /** 玩家設「用現金付」的項目 id（只對 either 有用） */
  cash: string[]
  /** 玩家設「這一項不付了」的項目 id：不付也不算欠 */
  stopped: string[]
  /** 事件加減的「這一週那一項」（結算後清空） */
  tweaks: Record<string, number>
  /** 寬限：項目 id → 到哪一刻為止（總分鐘） */
  grace: Record<string, number>
  extras: ExtraItem[]
  debts: Debt[]
  /** 到期還沒結的週一（總分鐘，照順序）：人在副本裡時先記在這裡（G3） */
  due: number[]
  /** 流水號：新項目、債的 id */
  seq: number
}

const own = (o: object, key: string): boolean => Object.hasOwn(o, key)
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isPool = (v: unknown): v is Pool => v === 'cred' || v === 'cash'

export const blankBills = (): BillsState => ({ overdue: 0, arrears: 0, cash: [], stopped: [], tweaks: {}, grace: {}, extras: [], debts: [], due: [], seq: 0 })

/** 讀 state.ext.bills：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function readBills(state: Pick<GameState, 'ext'>): BillsState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const nat = (v: unknown): number => (isSafeInt(v) && v > 0 ? v : 0)
  const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText) : [])
  const nums = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {}
    if (isRecord(v)) for (const [key, n] of Object.entries(v)) if (isSafeInt(n)) out[key] = n
    return out
  }
  const extras: ExtraItem[] = Array.isArray(r.extras)
    ? r.extras.filter((x): x is Record<string, unknown> => isRecord(x) && isText(x.id) && isText(x.name) && isSafeInt(x.amount) && x.amount > 0 && isSafeInt(x.weeks) && x.weeks > 0 && (PAY_WITH as readonly unknown[]).includes(x.pay))
      .map((x) => ({ id: x.id as string, name: x.name as string, amount: x.amount as number, weeks: x.weeks as number, pay: x.pay as PayWith }))
    : []
  const debts: Debt[] = Array.isArray(r.debts)
    ? r.debts.filter((x): x is Record<string, unknown> => isRecord(x) && isText(x.id) && isText(x.to) && isSafeInt(x.principal) && x.principal > 0 && typeof x.rate === 'number' && Number.isFinite(x.rate) && x.rate >= 0 && isPool(x.pay))
      .map((x) => ({ id: x.id as string, to: x.to as string, principal: x.principal as number, rate: x.rate as number, pay: x.pay as Pool }))
    : []
  const due = Array.isArray(r.due) ? r.due.filter((n): n is number => isSafeInt(n) && n >= 0).sort((a, b) => a - b) : []
  return {
    overdue: nat(r.overdue), arrears: nat(r.arrears), cash: texts(r.cash), stopped: texts(r.stopped), tweaks: nums(r.tweaks), grace: nums(r.grace),
    extras, debts, due: [...new Set(due)], seq: nat(r.seq),
  }
}

/** 把整理好的狀態變成一筆 ext 變更。 */
export const writeBills = (b: BillsState): Change => ({ op: 'ext', key: EXT, value: clone(b) as unknown as Record<string, unknown> })

// ---- 規則（數字照設計書；內容種類 bill_rule，id: default 蓋掉）----

export interface BillRules {
  /** 第幾週欠繳時把欠款併成一筆債（FIXER 第 4 節、DOWNTIME 5.2：第 3 週） */
  debt_week: number
  /** 債主：勢力的 id（DOWNTIME 5.2：伊甸園）；債主的敵對值加 debt_hostility（+10） */
  debt_faction: string
  debt_hostility: number
  /** 週利率：設計書只說「利率照伊甸園」沒有數字，先 5%；debt_rates 可以照勢力蓋掉 */
  debt_rate: number
  debt_rates: Record<string, number>
  /** 債的利息從哪裡扣（DOWNTIME 5.1：胭脂堂收現金、伊甸園扣帳戶）；沒寫的勢力是 debt_pay_default */
  debt_pay: Record<string, Pool>
  debt_pay_default: Pool
  /** 債的利息是表上的第 5 項 */
  interest_order: number
  /** 事件加的新項目（保護費、分期）排第幾項：表上的第 7 項 */
  extra_order: number
  /** 寬限最多幾天（EVENTS 2.4 節：7） */
  grace_max_days: number
  /** 效果 bill 加減一項，最多是那一項金額的多少（EVENTS 2.4 節：一半） */
  tweak_ratio: number
  /** 一次時間往前走，最多補幾週的結算（一次睡好幾個月的保險） */
  max_catch_up: number
}

export const DEFAULT_BILL_RULES: BillRules = {
  // DOWNTIME 5.1：債的利息胭脂堂收現金，伊甸園（和沒寫的勢力）扣帳戶
  debt_week: 3, debt_faction: 'eden', debt_hostility: 10, debt_rate: 0.05, debt_rates: {}, debt_pay: { rouge: 'cash' }, debt_pay_default: 'cred',
  interest_order: 5, extra_order: 7, grace_max_days: 7, tweak_ratio: 0.5, max_catch_up: 52,
}

const INT_FIELDS: Array<[keyof BillRules, number, number]> = [
  ['debt_week', 1, 52], ['debt_hostility', 0, 100], ['interest_order', 1, 10], ['extra_order', 1, 10], ['grace_max_days', 0, 365], ['max_catch_up', 1, 520],
]

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of INT_FIELDS) if (e[key] !== undefined && !(isSafeInt(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  const ratio = (key: string, hi: number, v: unknown): void => {
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= hi)) p.push(`${key} 要是 0～${hi} 的數字`)
  }
  if (e.debt_rate !== undefined) ratio('debt_rate', 1, e.debt_rate)
  if (e.tweak_ratio !== undefined) ratio('tweak_ratio', 1, e.tweak_ratio)
  if (e.debt_faction !== undefined && !isText(e.debt_faction)) p.push('debt_faction 要是勢力的 id')
  if (e.debt_pay_default !== undefined && !isPool(e.debt_pay_default)) p.push('debt_pay_default 只能是 cred 或 cash')
  if (e.debt_rates !== undefined) {
    if (!isRecord(e.debt_rates)) p.push('debt_rates 要是 { 勢力: 週利率 }')
    else for (const [key, v] of Object.entries(e.debt_rates)) if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) p.push(`debt_rates.${key} 要是 0～1 的數字`)
  }
  if (e.debt_pay !== undefined) {
    if (!isRecord(e.debt_pay)) p.push('debt_pay 要是 { 勢力: cred 或 cash }')
    else for (const [key, v] of Object.entries(e.debt_pay)) if (!isPool(v)) p.push(`debt_pay.${key} 只能是 cred 或 cash`)
  }
  return p
}

/** 現在生效的規則：資料 bill_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function billRules(k: Pick<Kernel, 'content'>): BillRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: BillRules = { ...DEFAULT_BILL_RULES, debt_rates: {}, debt_pay: { ...DEFAULT_BILL_RULES.debt_pay } }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .]/)[0]))
  for (const key of Object.keys(out) as Array<keyof BillRules>) {
    if (e[key] === undefined || bad.has(key)) continue
    ;(out[key] as unknown) = isRecord(e[key]) ? { ...(e[key] as object) } : e[key]
  }
  return out
}

const rateOf = (rules: BillRules, to: string): number => (own(rules.debt_rates, to) ? rules.debt_rates[to]! : rules.debt_rate)
export const debtPayOf = (rules: BillRules, to: string): Pool => (own(rules.debt_pay, to) ? rules.debt_pay[to]! : rules.debt_pay_default)
export const debtRateOf = rateOf

// ---- 週 ----

/** 這一刻是第幾週（第一個週一 06:00 是第 1 週）。 */
export function weekOf(k: Pick<Kernel, 'timeRules'>, at: GameTime | number): number {
  const rule = weeklyRule(k.timeRules)
  const m = typeof at === 'number' ? at : toMinutes(at)
  return Math.floor((m - rule.offset) / rule.every) + 1
}

/** 現在之後的下一個週一 06:00（總分鐘；剛好站在點上的算下一個）。 */
export function nextMondayMinutes(k: Pick<Kernel, 'timeRules'>, state: Pick<GameState, 'time'>): number {
  const rule = weeklyRule(k.timeRules)
  return (Math.floor((toMinutes(state.time) - rule.offset) / rule.every) + 1) * rule.every + rule.offset
}

// ---- 收集項目 ----

const LINE_KINDS = ['income', 'due']

/** 檢查一筆回傳的項目；不合格丟錯，訊息寫出是誰回傳的（格式不對是那個功能的錯，不吞掉）。 */
function checkLine(raw: unknown, owner: string, index: number): BillLine {
  const where = `bill.collect：${owner} 回傳的第 ${index + 1} 筆`
  if (!isRecord(raw)) throw new Error(`${where}不是物件`)
  const problems: string[] = []
  if (!isText(raw.id)) problems.push('id 要是文字')
  if (!isText(raw.name)) problems.push('name 要是文字')
  if (!LINE_KINDS.includes(raw.kind as string)) problems.push('kind 只能是 income 或 due')
  if (!(isSafeInt(raw.amount) && raw.amount >= 0)) problems.push('amount 要是 0 以上的整數')
  if (!(isSafeInt(raw.order) && raw.order >= 1 && raw.order <= 10)) problems.push('order 要是 1～10 的整數')
  if (!(PAY_WITH as readonly unknown[]).includes(raw.pay)) problems.push('pay 只能是 cred、cash 或 either')
  if (problems.length > 0) throw new Error(`${where}格式不對：${problems.join('；')}`)
  return { id: raw.id as string, owner, name: raw.name as string, kind: raw.kind as BillLine['kind'], amount: raw.amount as number, order: raw.order as number, pay: raw.pay as PayWith }
}

/**
 * 問掛點 bill.collect 這一週要收要付什麼，加上這個功能自己的：事件加的臨時項目、債的利息。
 * 回傳照收集的順序（掛點的順序，之後是臨時項目、債）；id 重複丟錯。state 是這一週結算時看到的狀態，唯讀。
 */
export function collectLines(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, week: number): BillLine[] {
  const out: BillLine[] = []
  const seen = new Set<string>()
  const add = (line: BillLine): void => {
    if (seen.has(line.id)) throw new Error(`bill.collect：帳單項目 id 重複：${line.id}（${line.owner}）`)
    seen.add(line.id)
    out.push(line)
  }
  for (const { owner, result } of k.hooks.run('bill.collect', { state, week })) {
    const list = result as unknown
    if (!Array.isArray(list)) throw new Error(`bill.collect：${owner} 回傳的不是項目的陣列`)
    list.forEach((raw, i) => add(checkLine(raw, owner, i)))
  }
  const bills = readBills(state)
  const rules = billRules(k)
  for (const x of bills.extras) add({ id: x.id, owner: OWNER, name: x.name, kind: 'due', amount: x.amount, order: rules.extra_order, pay: x.pay })
  for (const d of bills.debts) {
    const interest = d.rate > 0 ? Math.max(1, Math.round(d.principal * d.rate)) : 0
    const name = k.content.get<ContentEntry & { name?: string }>('faction', d.to)?.name ?? d.to
    add({ id: `debt:${d.id}`, owner: OWNER, name: `${name}的債息`, kind: 'due', amount: interest, order: rules.interest_order, pay: d.pay })
  }
  return out
}

// ---- 結算一週 ----

export type SkipWhy = 'stopped' | 'grace'

/** skipped 的原因（SettledLine 的 why）：stopped 是玩家停掉的、grace 是寬限中的；義體的訂閱讀它（停掉就鎖住，寬限不動）。 */
export interface PlanLine extends SettledLine {
  /** 這一項從哪一種錢扣（收入是存進哪一種） */
  pool: Pool
  /** 沒收的原因：玩家停掉的、寬限中的 */
  why?: SkipWhy
  /** 項目自己回報的金額（還沒加減、沒乘倍率） */
  raw: number
  /** 加減之後、乘倍率之前的金額 */
  base: number
}

export interface WeekPlan {
  week: number
  at: GameTime
  lines: PlanLine[]
  /** 收入合計、帳戶與現金各要付多少（只算付得成的）、各缺多少（沒付成的合計） */
  income: Record<Pool, number>
  paid: Record<Pool, number>
  unpaid: Record<Pool, number>
  /** 沒付成的第一項（會停在哪一項）；都付了是 null */
  stopsAt: string | null
  /** 這一週有沒有沒付的項目（不含停掉的、寬限的） */
  short: boolean
  /** 結算之後的欠繳週數 */
  overdue: number
  /** 結算之後的狀態 */
  next: BillsState
  /** 套用的變更（收入入帳、扣款；併債、敵對值、旗標），不含 bill.settled 回傳的 */
  changes: Change[]
  /** 這一週新併出來的債 */
  merged: Debt | null
}

const poolOf = (line: BillLine, bills: BillsState): Pool => (line.pay === 'either' ? (bills.cash.includes(line.id) ? 'cash' : 'cred') : line.pay)

/** 倍率與加減之後的金額（收入不乘倍率、也不加減）。 */
function amountOf(line: BillLine, bills: BillsState, mult: number): { base: number; amount: number } {
  if (line.kind === 'income') return { base: line.amount, amount: line.amount }
  const base = Math.max(0, line.amount + (bills.tweaks[line.id] ?? 0))
  return { base, amount: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(base * mult))) }
}

/** 把還沒併成債的欠款併成一筆（照規則的債主與利率）：加進 next.debts、欠款歸零。 */
function mergeArrears(next: BillsState, rules: BillRules): Debt {
  const debt: Debt = { id: `d${next.seq + 1}`, to: rules.debt_faction, principal: next.arrears, rate: rateOf(rules, rules.debt_faction), pay: debtPayOf(rules, rules.debt_faction) }
  next.seq += 1
  next.debts.push(debt)
  next.arrears = 0
  return debt
}

/**
 * 算一週的結算（不改狀態）：收入先入帳 → 照 order 扣款，哪一種錢不夠就停在那一項（那一種錢後面的項目都算沒付）→ 記欠繳、第 3 週併成債。
 * 玩家停掉的項目、寬限中的項目：不付也不算欠，也不擋後面的。倍率 0 時應付的都是 0，只有收入入帳。
 */
export function planWeek(k: Pick<Kernel, 'hooks' | 'content' | 'meters' | 'timeRules'>, state: GameState, at: GameTime): WeekPlan {
  const week = weekOf(k, at)
  const bills = readBills(state)
  const rules = billRules(k)
  const mult = state.rules.billMult
  const now = toMinutes(at)
  const collected = collectLines(k, state, week)

  const balance: Record<Pool, number> = { cred: state.money.cred, cash: state.money.cash }
  const changes: Change[] = []
  const lines: PlanLine[] = []
  const income: Record<Pool, number> = { cred: 0, cash: 0 }
  const paid: Record<Pool, number> = { cred: 0, cash: 0 }
  const unpaid: Record<Pool, number> = { cred: 0, cash: 0 }

  // 收入先入帳
  for (const line of collected.filter((l) => l.kind === 'income')) {
    const pool = poolOf(line, bills)
    income[pool] += line.amount
    balance[pool] += line.amount
    if (line.amount > 0) changes.push({ op: pool, delta: line.amount })
    lines.push({ ...line, pool, raw: line.amount, base: line.amount, paid: line.amount, unpaid: 0 })
  }
  // 照 order 扣款（同一個 order 照收集的順序）
  const dues = collected.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'due').sort((a, b) => a.l.order - b.l.order || a.i - b.i).map((x) => x.l)
  const halted: Record<Pool, boolean> = { cred: false, cash: false }
  let stopsAt: string | null = null
  for (const line of dues) {
    const pool = poolOf(line, bills)
    const { base, amount } = amountOf(line, bills, mult)
    const row: PlanLine = { ...line, amount, pool, raw: line.amount, base, paid: 0, unpaid: 0 }
    const graceUntil = bills.grace[line.id]
    if (bills.stopped.includes(line.id)) {
      row.skipped = true
      row.why = 'stopped'
    } else if (graceUntil !== undefined && graceUntil >= now) {
      row.skipped = true
      row.why = 'grace'
    } else if (amount > 0) {
      if (!halted[pool] && balance[pool] >= amount) {
        balance[pool] -= amount
        row.paid = amount
        paid[pool] += amount
        changes.push({ op: pool, delta: -amount })
      } else {
        halted[pool] = true
        row.unpaid = amount
        unpaid[pool] += amount
        stopsAt ??= line.id
      }
    }
    lines.push(row)
  }

  // 欠繳週數、欠款、債（金額累加不超過安全整數：B037）
  const safe = (n: number): number => Math.min(Number.MAX_SAFE_INTEGER, n)
  unpaid.cred = safe(unpaid.cred)
  unpaid.cash = safe(unpaid.cash)
  const short = lines.some((l) => l.unpaid > 0)
  const next: BillsState = clone(bills)
  next.tweaks = {}
  next.due = []
  for (const [id, until] of Object.entries(next.grace)) if (until < now) delete next.grace[id]
  next.extras = next.extras.map((x) => ({ ...x, weeks: x.weeks - 1 })).filter((x) => x.weeks > 0)
  let merged: Debt | null = null
  if (short) {
    next.overdue = bills.overdue + 1
    next.arrears = safe(bills.arrears + unpaid.cred + unpaid.cash)
    if (next.overdue === rules.debt_week && next.arrears > 0) merged = mergeArrears(next, rules)
  } else {
    // 這一週付清了，可是之前累積的欠款沒補：不一筆勾銷，轉成債（B039；使用者 2026-11-26），欠繳歸零、鎖住的東西解開
    if (bills.arrears > 0) merged = mergeArrears(next, rules)
    next.overdue = 0
    next.arrears = 0
  }
  changes.push(writeBills(next))
  // 欠繳的旗標：給事件與之後的功能接（第 1、2、4 週只留旗標與觸發點）
  const flagNow = state.flags.bill_overdue
  if (next.overdue > 0) {
    if (flagNow !== next.overdue) changes.push({ op: 'flag', key: 'bill_overdue', value: next.overdue })
    const step = STEPS[Math.min(next.overdue, STEPS.length) - 1]!
    if (state.flags.bill_step !== step) changes.push({ op: 'flag', key: 'bill_step', value: step })
  } else {
    if (flagNow !== undefined) changes.push({ op: 'flag', key: 'bill_overdue', value: null })
    if (state.flags.bill_step !== undefined) changes.push({ op: 'flag', key: 'bill_step', value: null })
  }
  if (merged && rules.debt_hostility !== 0 && k.meters.has('hostility') && k.content.has('faction', merged.to)) {
    changes.push({ op: 'meter', kind: 'hostility', key: merged.to, delta: rules.debt_hostility })
  }
  return { week, at, lines, income, paid, unpaid, stopsAt, short, overdue: next.overdue, next, changes, merged }
}

/** 欠繳週數對到下坡路的哪一格（FIXER 第 4 節的四步）：1 鎖義體、2 討債人上門、3 債權賣給伊甸園、4 以後要求簽契約。 */
export const STEPS = ['lock', 'collector', 'debt', 'contract'] as const
export const STEP_TEXT: Record<(typeof STEPS)[number], string> = {
  lock: '鎖義體：訂閱的件都鎖住，房東寄來警告', collector: '討債人上門', debt: '債權賣給債主，所有欠款變成一筆債', contract: '被要求簽契約',
}

// ---- 預覽 ----

export interface BillPreview {
  week: number
  /** 下一次要結的那個週一 06:00 */
  at: GameTime
  /** 是不是已經到期、還沒結的那一週（人在副本裡時記下的） */
  deferred: boolean
  mult: number
  lines: PlanLine[]
  /**
   * 兩種錢各自的：現有多少、這一週的收入、這一種錢的項目一共要付多少（due）、帳戶加收入還差多少才付得起全部（short）、
   * 實際會沒付成的合計（unpaid：錢不夠就停在那一項，後面的都算沒付，所以可能比 short 多）、夠不夠（enough：全部付得起）
   */
  money: Record<Pool, { have: number; income: number; due: number; short: number; unpaid: number; enough: boolean }>
  /** 會停在哪一項（第一項沒付成的）；都付得起是 null */
  stopsAt: string | null
  /** 現在的欠繳週數、對到下坡路的哪一格（0 是沒欠；1～4） */
  overdue: number
  slope: number
  /** 這一週沒付清的話會走到哪一格；付得清是 null */
  slopeIfShort: number | null
  /** 沒付清的話，哪一步會發生 */
  step: (typeof STEPS)[number] | null
}

/** 下一次要付的每一項、帳戶夠不夠、差多少、會停在哪一項、現在在下坡的哪一格。數字和真的結算（planWeek）一樣。 */
export function billPreview(k: Pick<Kernel, 'hooks' | 'content' | 'meters' | 'timeRules'>, state: GameState): BillPreview {
  const bills = readBills(state)
  const atMinutes = bills.due[0] ?? nextMondayMinutes(k, state)
  const plan = planWeek(k, state, fromMinutes(atMinutes))
  const money = (pool: Pool) => ({
    have: state.money[pool], income: plan.income[pool], due: plan.paid[pool] + plan.unpaid[pool],
    short: Math.max(0, plan.paid[pool] + plan.unpaid[pool] - state.money[pool] - plan.income[pool]), unpaid: plan.unpaid[pool], enough: plan.unpaid[pool] === 0,
  })
  const slope = Math.min(bills.overdue, STEPS.length)
  const nextOverdue = Math.min(bills.overdue + 1, STEPS.length)
  return {
    week: plan.week, at: plan.at, deferred: bills.due.length > 0, mult: state.rules.billMult, lines: plan.lines,
    money: { cred: money('cred'), cash: money('cash') }, stopsAt: plan.stopsAt,
    overdue: bills.overdue, slope, slopeIfShort: plan.short ? nextOverdue : null, step: plan.short ? STEPS[nextOverdue - 1]! : null,
  }
}

/** 現在所有的項目（照結算的順序，含收入）：給效果與玩家設定查「有沒有這一項」。 */
export function currentLines(k: Pick<Kernel, 'hooks' | 'content' | 'meters' | 'timeRules'>, state: GameState): PlanLine[] {
  const bills = readBills(state)
  return planWeek(k, state, fromMinutes(bills.due[0] ?? nextMondayMinutes(k, state))).lines
}
