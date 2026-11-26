import type { Report } from '@engine/src'
import type { AuctionView, BidOption, CatalogLotView, Hammer, Won } from '@engine/src/features/auction'
import type { HereOption } from './here'

/**
 * 拍賣行的檢視整理（M4-ui-auction；LEWD_SYSTEM 6.2 節）：把引擎的 sessionOf、catalogView、auctionView、bidOptions 與報告排成畫面要的樣子。
 * 只做整理與字樣：底價、一階、佣金、能不能加價、誰退出、誰得標、看貨的成功率與 DC 一律是引擎給的。
 * 這個檔不讀 state.ext.auction（仿品的記號與競標者的預算記在那裡，給引擎算用的）：畫面只經 catalogView、auctionView、bidOptions，與報告上寫給玩家看的句子。
 */

// ---- 階段 ----

export type StageId = 'unannounced' | 'preview' | 'waiting' | 'live' | 'ended'
export interface Stage { id: StageId; name: string; hint: string }
const STAGES: Record<StageId, Stage> = {
  unannounced: { id: 'unannounced', name: '還沒公布', hint: '目錄還沒有公布。預展開始的那一刻公布目錄。' },
  preview: { id: 'preview', name: '預展中', hint: '目錄公布了，可以在預展的時段看貨（零件與義體可以檢定看出是不是仿品）。' },
  waiting: { id: 'waiting', name: '等開槌', hint: '預展結束了，等開槌。會員可以在開槌的時段進場。' },
  live: { id: 'live', name: '開槌中', hint: '這一場正在拍：會員可以進場。' },
  ended: { id: 'ended', name: '這一場結束了', hint: '這一場已經結束（落槌完或離場）；下一場會有新的目錄。' },
}
export const stageById = (id: StageId): Stage => STAGES[id]

/** 這一場（引擎的 sessionOf）現在在哪個階段：照目錄公布、預展起訖、開槌起訖與現在的分鐘數分段。結束的那一場引擎不再回傳，結束頁自己用 'ended' */
export function stageOf(s: { catalog_at: number; preview: { from: number; to: number }; start: number; end: number }, now: number): Stage {
  if (now < s.catalog_at) return STAGES.unannounced
  if (now >= s.start && now < s.end) return STAGES.live
  if (now >= s.end) return STAGES.ended
  if (now >= s.preview.from && now < s.preview.to) return STAGES.preview
  return STAGES.waiting
}

/** 預展的時段裡零件與義體旁邊才有「看貨」（引擎 inspectOptions 的 blocks 才是準的；這裡只決定欄位有沒有） */
export const FAKEABLE_KINDS: readonly string[] = ['part', 'cyberware']

// ---- 錢 ----

/** 這一場用哪一種錢（進場時選；MoneyTag 的 kind） */
export const payKind = (pay: 'cash' | 'cred'): 'cash' | 'acc' => (pay === 'cash' ? 'cash' : 'acc')
export const PAY_CHOICES: Array<{ pay: 'cash' | 'cred'; name: string }> = [{ pay: 'cash', name: '現金晶片' }, { pay: 'cred', name: '帳戶' }]

// ---- 目錄 ----

/** 看貨結果的標示（引擎給的 looked.result）：沒有問題、仿品或瑕疵、看不出什麼 */
export const LOOK_BADGE: Record<string, { name: string; tone: 'ok' | 'bad' | 'mid' }> = {
  ok: { name: '沒有問題', tone: 'ok' }, fake: { name: '仿品或瑕疵', tone: 'bad' }, unknown: { name: '看不出什麼', tone: 'mid' },
}
export const lookBadge = (lot: Pick<CatalogLotView, 'looked'>): { name: string; tone: 'ok' | 'bad' | 'mid' } | null => (lot.looked ? LOOK_BADGE[lot.looked.result] ?? null : null)

// ---- 競價 ----

/** 加價按鈕的標籤：加幾階、加完的現價，與含佣金的總數（數字都是 bidOptions 的） */
export function raiseLabel(o: BidOption): string {
  return `加 ${o.steps} 階`
}

/** 這一回合每個人的動作：照報告的 timeline 的順序，一句一行（句子是引擎寫的）；tag 讓畫面上色 */
export interface RoundLine { text: string; tag: string }
const ROUND_TAGS = ['auction.enter', 'auction.bid', 'auction.leave', 'auction.close']
export const isAuctionReport = (r: Report): boolean => !r.retracted && (r.action === 'auction.enter' || r.action === 'auction.bid' || r.action === 'auction.leave' || r.action === 'auction.close')

/** 最近一份拍賣回合的報告（進場、加價、離場、結束）；沒有是 null */
export function lastRound(reports: readonly Report[]): Report | null {
  for (let i = reports.length - 1; i >= 0; i--) {
    const r = reports[i]!
    if (!r.retracted && r.action && ROUND_TAGS.includes(r.action)) return r
  }
  return null
}
export const roundLines = (r: Report | null): RoundLine[] => (r ? r.timeline.filter((b) => !!b.text).map((b) => ({ text: b.text, tag: b.tag ?? '' })) : [])

// ---- 結算 ----

export interface SettleRow { lot: number; name: string; result: 'sold' | 'passed'; winner: string | null; winnerName: string | null; price: number; won: boolean; fee: number }
export interface Settlement {
  house: string
  rows: SettleRow[]
  won: Won[]
  spent: number
  /** 這一場用哪種錢付（進場那一份報告記的） */
  pay: 'cash' | 'cred'
  left: boolean
  /** 玩家得標拿到什麼：引擎寫的那幾句（仿品的那一句也在裡面） */
  gets: string[]
  /** 結束那一份報告的結尾句（引擎寫的，含「時間到了第 N 天 HH:MM」）與結束時的時間 */
  tail: string
  end: Report['time']['end']
  lines: string[]
}

/**
 * 最近一場結束了的拍賣（auction.close 或 auction.leave）：從那一場的進場（auction.enter）起，逐份報告收落槌的結果（outcome.hammers）；
 * 玩家得標的是 outcome.won（拍品、價錢、佣金）。不是進行中、也沒有結束的報告時是 null。這一頁的數字全是報告上的。
 */
export function settlementOf(reports: readonly Report[]): Settlement | null {
  let close = -1
  for (let i = reports.length - 1; i >= 0; i--) {
    const r = reports[i]!
    if (r.retracted) continue
    if (r.action === 'auction.enter') return null // 最近一件拍賣的事是進場：還在進行中
    if (r.action === 'auction.close' || r.action === 'auction.leave') { close = i; break }
  }
  if (close < 0) return null
  const last = reports[close]!
  const out = last.outcome as unknown as { won?: Won[]; spent?: number; house?: string }
  const hammers: Hammer[] = []
  const gets: string[] = []
  let pay: 'cash' | 'cred' = 'cash'
  for (let i = close; i >= 0; i--) {
    const r = reports[i]!
    if (r.retracted) continue
    if (r.action === 'auction.enter') {
      const p = r.timeline[0]?.data?.pay
      if (p === 'cash' || p === 'cred') pay = p
      break
    }
    if (r.action === 'auction.bid' || r.action === 'auction.leave' || r.action === 'auction.close') {
      hammers.unshift(...((r.outcome as unknown as { hammers?: Hammer[] }).hammers ?? []))
      gets.unshift(...r.timeline.filter((b) => b.tag === 'auction.settle').map((b) => b.text))
    }
  }
  const won = out.won ?? []
  return {
    house: out.house ?? '', won, spent: out.spent ?? 0, pay, gets, left: last.action === 'auction.leave',
    rows: hammers.map((h) => { const w = won.find((x) => x.lot === h.lot); return { lot: h.lot, name: h.name, result: h.result, winner: h.winner, winnerName: h.winner_name, price: h.price, won: h.winner === 'pc', fee: w?.fee ?? 0 } }),
    tail: last.timeline.find((b) => b.tag === 'auction.close')?.text ?? last.outcome.summary, end: last.time.end,
    lines: last.narration?.results ?? [],
  }
}

// ---- 這裡 ----

/** 「這裡」多一項：站在拍賣行的設施上開拍賣的對話框（站在哪是引擎的 housesHere） */
export function auctionOption(house: { id: string; name: string }, open: () => void, sub?: string): HereOption {
  return { id: `auction:${house.id}`, name: `進${house.name}`, ...(sub ? { sub } : {}), run: open }
}

export type { AuctionView }
