/**
 * 過日子的四塊（商店、每週帳單、打工、休息與住處；M2-ui-life）：把引擎給的整理成畫面要的列。純函式，只整理與排序。
 * 價錢與拆解、帳單的順序與哪一項沒付成、報酬與成功率、回復量與能不能做的原因，一律是引擎的（stores/engine.ts 的 trade、bills、work、rest）；
 * 這裡不留任何一條算式：看得到的數字都是引擎回的，這裡只換成顯示用的字。
 */
import type { GameTime, Report } from '@engine/src'
import type { Cart, CartLine, QuoteStep } from '@engine/src/features/trade'
import type { BillPreview, PlanLine } from '@engine/src/features/bills'
import { STEPS, STEP_TEXT } from '@engine/src/features/bills'
import type { NeedProgress } from '@engine/src/features/work'
import type { Degree } from '@engine/src'
import type { Grade } from '../data/types'
import type { SlotItem } from './gearView'
import { legalName } from './gearView'
import { fmt } from './price'

export type Pool = 'cred' | 'cash'
/** MoneyTag 的種類：引擎的 cred 是帳戶（acc）、cash 是現金晶片 */
export const moneyKind = (p: Pool): 'acc' | 'cash' => (p === 'cred' ? 'acc' : 'cash')
export const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金晶片' }

/**
 * 送出一個動作之後，沒做成時要跟玩家說的話；做成了是 null。
 * refused／busy 的原因是引擎（或 store）給的；paused 是任務鏈跑到寫正文那一步失敗了、狀態還沒有改，要到任務鏈列重試或改用規則。
 */
export function failText(r: { status: string; reason?: string }, fallback: string): string | null {
  if (r.status === 'applied') return null
  if (r.status === 'paused') return '任務鏈停在寫正文的那一步，狀態還沒有改：到任務鏈列重試，或改用規則的結果。'
  return r.reason ?? fallback
}

// ---- 從設施打開哪一個畫面 ----

export interface LifeDialog { name: 'shop' | 'work' | 'rest' | 'dive' | 'repair'; props: Record<string, unknown> }
/** 引擎在格子上列的項目（grid.here.uses 的 id）要打開的過日子畫面；不是這四塊的是 null */
export function lifeDialogOf(useId: string): LifeDialog | null {
  if (useId.startsWith('trade.shop:')) return { name: 'shop', props: { shopId: useId.slice('trade.shop:'.length) } }
  if (useId === 'work.shift') return { name: 'work', props: {} }
  if (useId === 'rest.sleep' || useId === 'rest.breath') return { name: 'rest', props: {} }
  if (useId === 'netcombat.repair') return { name: 'repair', props: {} }
  if (useId === 'dive.enter' || useId === 'dive.exit') return { name: 'dive', props: {} }
  return null
}

// ---- 購物車（買與賣同一台）----

export interface CartRow { mode: 'buy' | 'sell'; item: string; qty: number; /** 賣帶記號的那一件時指名是哪一件 */ uid?: string }
export const rowKey = (r: Pick<CartRow, 'mode' | 'item' | 'uid'>): string => `${r.mode}:${r.item}:${r.uid ?? ''}`

/** 放一件進車：同一列就加個數（要不要超過今天剩的，由引擎的 buyBlock 在結帳前說） */
export function addRow(rows: CartRow[], mode: CartRow['mode'], item: string, qty = 1, uid?: string): CartRow[] {
  const row: CartRow = { mode, item, qty, ...(uid !== undefined ? { uid } : {}) }
  const key = rowKey(row)
  const old = rows.find((r) => rowKey(r) === key)
  if (!old) return [...rows, row]
  return rows.map((r) => (r === old ? { ...r, qty: r.qty + qty } : r))
}
export const removeRow = (rows: CartRow[], key: string): CartRow[] => rows.filter((r) => rowKey(r) !== key)
export const setQty = (rows: CartRow[], key: string, qty: number): CartRow[] => (qty < 1 ? removeRow(rows, key) : rows.map((r) => (rowKey(r) === key ? { ...r, qty } : r)))

/** 車裡的東西換成引擎收的購物車（買與賣各一串，用哪一種錢付） */
export function toCart(rows: CartRow[], pay: Pool): Cart {
  const line = (r: CartRow): CartLine => ({ item: r.item, qty: r.qty, ...(r.uid !== undefined ? { uid: r.uid } : {}) })
  const buy = rows.filter((r) => r.mode === 'buy').map(line)
  const sell = rows.filter((r) => r.mode === 'sell').map(line)
  return { ...(buy.length ? { buy } : {}), ...(sell.length ? { sell } : {}), pay }
}

// ---- 價格拆解 ----

export interface StepText { name: string; mult: string; arrow: '▲' | '▼' | ''; pct: string; value: number }
/** 一步的顯示：名字、乘多少、▲▼ 與百分比（照引擎回的倍率換成字）、到這一步為止的數字（引擎的） */
export function stepText(s: QuoteStep): StepText {
  const arrow = s.mult > 1 ? '▲' : s.mult < 1 ? '▼' : ''
  const diff = Math.round((s.mult - 1) * 100)
  return { name: s.name, mult: `×${s.mult.toFixed(2)}`, arrow, pct: diff === 0 ? '' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}%`, value: s.value }
}

/** 一步一行：名字、乘多少、▲▼ 與百分比、到這一步為止的數字（目錄價那一步沒有乘數） */
export function stepLine(s: QuoteStep): string {
  const t = stepText(s)
  const mid = s.id === 'catalog' ? '' : ` ${[t.mult, t.arrow, t.pct].filter(Boolean).join(' ')}`
  return `${t.name}${mid} → ${fmt(t.value)}`
}

// ---- 每週帳單 ----

export interface BillRow {
  id: string
  name: string
  order: number
  /** 從哪一種錢扣（收入是存進哪一種） */
  pool: Pool
  /** 玩家可以改成用現金付：這一項收現金（引擎給 pay: either） */
  cashOk: boolean
  amount: number
  paid: number
  unpaid: number
  /** paid 付了、short 這一項沒付成（會停在這裡）、after 停在前面所以沒付、skipped 你停掉的、grace 寬限中 */
  state: 'paid' | 'short' | 'after' | 'skipped' | 'grace'
}
const rowOf = (l: PlanLine, stopsAt: string | null): BillRow => ({
  id: l.id, name: l.name, order: l.order, pool: l.pool, cashOk: l.pay === 'either', amount: l.amount, paid: l.paid, unpaid: l.unpaid,
  state: l.skipped ? (l.why === 'grace' ? 'grace' : 'skipped') : l.unpaid > 0 ? (l.id === stopsAt ? 'short' : 'after') : 'paid',
})
/** 預覽的項目分成支出與收入（支出照引擎排好的順序） */
export function billRows(p: BillPreview): { dues: BillRow[]; incomes: BillRow[] } {
  return { dues: p.lines.filter((l) => l.kind === 'due').map((l) => rowOf(l, p.stopsAt)), incomes: p.lines.filter((l) => l.kind === 'income').map((l) => rowOf(l, p.stopsAt)) }
}

export interface SlopeCell { n: number; id: string; text: string; /** 現在在這一格 */ now: boolean; /** 這一週付不清就會走到這一格 */ next: boolean }
/** 下坡路的四格：現在在哪一格（引擎的 slope）、付不清會走到哪一格（slopeIfShort） */
export function slopeCells(p: Pick<BillPreview, 'slope' | 'slopeIfShort'>): SlopeCell[] {
  return STEPS.map((id, i) => ({ n: i + 1, id, text: STEP_TEXT[id], now: p.slope === i + 1, next: p.slopeIfShort === i + 1 }))
}

export interface SettledRow { id: string; name: string; kind: 'income' | 'due'; amount: number; paid: number; unpaid: number; skipped: boolean }
/** 結算報告（bill.settle）的每一項：timeline 的 bill.line 那幾拍帶著引擎記下的 id、金額、付了多少、欠多少 */
export function settledRows(r: Pick<Report, 'timeline'> | null): SettledRow[] {
  if (!r) return []
  return r.timeline.filter((b) => b.tag === 'bill.line' && b.data).map((b) => {
    const d = b.data as Record<string, unknown>
    return { id: String(d.id), name: String(d.name), kind: d.kind === 'income' ? 'income' : 'due', amount: Number(d.amount), paid: Number(d.paid), unpaid: Number(d.unpaid), skipped: d.skipped === true }
  })
}

export const timeText = (t: GameTime): string => `第 ${t.day} 天 ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`

// ---- 打工 ----

export const DEGREE_NAME: Record<Degree, string> = { critical: '大成功', success: '成功', fail: '失敗', fumble: '大失敗' }
export const pctText = (p: number): string => `${Math.round(p * 100)}%`

export interface NeedRow { label: string; have: number; need: number; ok: boolean }
/** 升階的條件（累計做滿幾小時、雇主的親密度、另外的條件）每一項的進度；達到了標 ok（不看班數：DOWNTIME 4.1a） */
export function needRows(n: NeedProgress | null): NeedRow[] {
  if (!n) return []
  return [
    { label: '累計做滿的小時數', have: n.hours.have, need: n.hours.need, ok: n.hours.ok },
    { label: '雇主的親密度', have: n.affinity.have, need: n.affinity.need, ok: n.affinity.ok },
  ]
}
/** 還差什麼（一句話；條件都到了是空字串）：照引擎回的各項進度寫 */
export function needLack(n: NeedProgress | null): string {
  if (!n || n.met) return ''
  const parts = needRows(n).filter((r) => !r.ok).map((r) => `${r.label}還差 ${r.need - r.have}`)
  if (n.extra === false) parts.push('另外的條件還沒達成')
  return parts.join('、')
}

// ---- 休息 ----

/** 回復率的顯示（生命值上限的幾成） */
export const ratePct = pctText

// ---- 物品格 ----

/** 沒有第 3 層圖標的東西退回第 2 層：只是顯示用的對照（不是規則） */
const CATEGORY_ICON: Record<string, string> = {
  weapon: 'ic-carry_main', armor: 'ic-slot_armor', clothing: 'ic-slot_top', accessory: 'ic-acc_neck', consumable: 'ic-consumable', ammo: 'ic-consumable', tool: 'ic-tool', part: 'ic-cargo',
  blueprint: 'ic-tool', cargo: 'ic-cargo', misc: 'ic-fac_furniture',
}
const clampGrade = (n: number): Grade => (n >= 1 && n <= 5 ? (Math.floor(n) as Grade) : 1)
/** 引擎的貨架列或收購列換成物品格要的樣子 */
export function slotItemOf(row: { item: string; name: string; grade?: number; category?: string; legal?: string }): SlotItem {
  return { id: row.item, name: row.name, grade: clampGrade(row.grade ?? 1), l2: CATEGORY_ICON[row.category ?? ''] ?? 'ic-unknown', ...(row.legal ? { legality: legalName(row.legal) } : {}) }
}
