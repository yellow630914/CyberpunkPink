/**
 * 契約面板（UI 第 11 節）與掃橋多出來的幾行：只整理引擎給的資料成畫面要的字樣。
 * 沒有任何規則：DC、成功率、能不能做、逾期會怎樣、價錢全是引擎的（features/contract、security）；這裡只排版。
 */
import type { BoundView, ContractRule, HolderAdjustItem, HolderContractView, HolderEvent, OrderView, PayoffQuote } from '@engine/src/features/contract'
import type { PersonView } from '@engine/src/features/security'

/** 規矩的種類（引擎的 zone、curfew、dress）的名字。 */
export const RULE_NAME: Record<ContractRule['kind'], string> = { zone: '禁區', curfew: '宵禁', dress: '指定服裝' }
export const RULE_KINDS = ['zone', 'curfew', 'dress'] as const

/** 規矩一行字。 */
export const ruleText = (r: ContractRule): string => `${RULE_NAME[r.kind]}：${r.value}`

/** 離期限還有多久：分鐘 → 「9 小時」「2 天」「已經過期」。 */
export function leftText(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes < 0) {
    const over = -minutes
    return `已經過期 ${over >= 1440 ? `${Math.round(over / 1440)} 天` : over >= 60 ? `${Math.round(over / 60)} 小時` : `${over} 分鐘`}`
  }
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小時`
  if (minutes >= 60) return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`
  return `${minutes} 分鐘`
}

export interface OrderRow {
  id: string
  name: string
  stateName: string
  /** 還沒了結（可以照做、抗拒、做完） */
  live: boolean
  overdue: boolean
  /** 倒數的字樣；了結的沒有 */
  left: string
  /** 逾期會怎樣：沒了結的才有 */
  penalty: string
  place: string
  /** 走過去：引擎給的目的地（還沒了結、還沒到過、有指定地方的才有）；here 是人已經站在那裡 */
  goto: { name: string; here: boolean; block?: string } | null
  asked: boolean
  arrived: boolean
  /** 還沒回應：可以選照做或抗拒 */
  sent: boolean
  /** 抗拒的 DC 與成功率（只有 sent 的） */
  resistText: string
  resistTitle: string
  forceable: boolean
}

const pct = (c: number): string => `${Math.round(c * 100)}%`

export function orderRows(view: BoundView): OrderRow[] {
  return view.queue.map((o: OrderView): OrderRow => {
    const live = o.state === 'sent' || o.state === 'doing' || o.state === 'forced'
    return {
      id: o.id, name: o.name, stateName: o.state_name, live, overdue: o.state === 'overdue' || (live && o.minutes_left !== null && o.minutes_left < 0), left: live ? leftText(o.minutes_left) : '',
      penalty: o.state === 'overdue' || o.outcome ? o.outcome?.text ?? '' : (o.on_overdue ?? []).join('、'), place: o.place_name ?? '', goto: o.goto ? { name: o.goto.name, here: o.goto.here, ...(o.goto.block ? { block: o.goto.block } : {}) } : null, asked: o.asked, arrived: o.arrived, sent: o.state === 'sent',
      resistText: o.resist ? `DC ${o.resist.dc}・成功率 ${pct(o.resist.chance)}` : '',
      resistTitle: o.resist ? o.resist.breakdown.map((b) => `${b.label} ${b.value >= 0 ? '+' : ''}${b.value}`).join('；') : '', forceable: o.resist?.forceable ?? true,
    }
  })
}

/** 債或期限那一行。 */
export function termText(v: { debt?: number; until?: number }, fmt: (n: number) => string): string {
  if (v.debt !== undefined) return `還欠 C$${fmt(v.debt)}`
  if (v.until !== undefined) return `第 ${Math.floor(v.until / 1440) + 1} 天 ${String(Math.floor((v.until % 1440) / 60)).padStart(2, '0')}:${String(v.until % 60).padStart(2, '0')} 期滿`
  return '沒有期限'
}

export interface PayoffRow { label: string; value: string }
export function payoffRows(q: PayoffQuote, fmt: (n: number) => string): PayoffRow[] {
  return [
    { label: '還欠', value: `C$${fmt(q.debt)}` },
    { label: '還清的價錢', value: `C$${fmt(q.price)}` },
    ...(q.talk_price !== null ? [{ label: '談成的價錢', value: `C$${fmt(q.talk_price)}（DC ${q.talk_dc}・成功率 ${pct(q.talk_chance)}）` }] : []),
  ]
}

export interface EventRow {
  kind: string
  name: string
  available: boolean
  reason: string
  crossed: boolean
  /** 他會先擲抗命時的字樣 */
  resistText: string
}
export function eventRows(list: HolderEvent[]): EventRow[] {
  return list.map((e) => ({
    kind: e.kind, name: e.name, available: e.available, reason: e.reason ?? '', crossed: e.crossed_out,
    resistText: e.resist ? `他可能抗命：DC ${e.resist.dc}・抗命成功率 ${pct(e.resist.chance)}` : '',
  }))
}

/** 契約頁能調的那幾項，照 key 取。 */
export const adjustOf = (v: HolderContractView, key: HolderAdjustItem['key']): HolderAdjustItem | undefined => v.adjust.find((a) => a.key === key)

/** 橋參數（持約人那一面）的名字順序。 */
export const PARAM_ORDER = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
export const PARAM_LABEL: Record<(typeof PARAM_ORDER)[number], string> = { sensitivity: '敏感度', tolerance: '耐受', craving: '慾求', docility: '馴化' }

/** 掃橋讀到的人（scanView.person）整理成一列一列。沒有東西讀到是空的。 */
export interface PersonRow { key: string; label: string; value: string; tone: 'ok' | 'warn' | 'plain' }
export function personRows(p: PersonView | undefined): PersonRow[] {
  if (!p) return []
  const rows: PersonRow[] = []
  if (p.cyber) {
    rows.push({ key: 'cyber', label: '義體', value: `讀到 ${p.cyber.count} 件`, tone: 'plain' })
    if (p.cyber.detailed) for (const i of p.cyber.items) rows.push({ key: `cyber:${i.name}`, label: i.name, value: i.note, tone: i.verdict === 'ok' ? 'ok' : 'warn' })
  }
  if (p.no_breaker) rows.push({ key: 'breaker', label: '熔斷器', value: '橋上沒有熔斷器，只剩掉頭', tone: 'warn' })
  if (p.sink) {
    rows.push({ key: 'sink', label: '沉溺', value: `讀到 ${p.sink.read}${p.sink.saw_through ? '（藏的被看穿了）' : ''}${p.sink.stop ? '・過了線' : p.sink.notice ? '・會被記上一筆' : ''}`, tone: p.sink.stop || p.sink.notice ? 'warn' : 'plain' })
  }
  if (p.contract) rows.push({ key: 'contract', label: '契約', value: `契約人，持約人是${p.contract.holder}（管理級）${p.contract.covered ? '・光紋遮著' : ''}`, tone: 'warn' })
  if (p.rights) for (const r of p.rights) rows.push({ key: `right:${r.holder}:${r.level}`, label: '橋權', value: `${r.holder}・${r.level === 'limit' ? '限制級' : r.level === 'read' ? '讀取級' : r.level}`, tone: 'plain' })
  return rows
}

/** 流竄 AI「牠的事」的四格（引擎 lureView 的 lore.slot）：順序與名字。 */
export const LORE_SLOTS = ['origin', 'want', 'ties', 'home'] as const
export const LORE_SLOT_NAME: Record<(typeof LORE_SLOTS)[number], string> = { origin: '原名', want: '想要什麼', ties: '處得來的人', home: '群落' }
