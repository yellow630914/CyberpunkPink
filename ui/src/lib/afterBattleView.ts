import type { Report } from '@engine/src'
import type { DefeatChoice, DefeatViewInfo } from '@engine/src/features/defeat'
import { fmt } from './price'

/**
 * 戰鬥之後的畫面要的整理（純函式，只整理引擎給的東西，不算機率、金額、DC，不判斷能不能做）：
 * 戰敗：抬頭的字、開頭的敘事、三選一與多出來的選項怎麼分組、後果兩格；打贏：戰鬥結束那一份報告的戰利品。
 * 「接受之後會怎樣」（委託失敗或繼續、最多被拿多少）全是 defeatView 的欄位，這裡只換成白話。
 */

/** 事件是怎麼選到的（引擎的 tier）：抬頭的標籤 */
export const TIER_NAME: Record<string, string> = { angel: '天使急救', origin: '這一場指定的', enemy: '敵人自己的', faction: '勢力的預設', generic: '通用' }
export const DEFEAT_NAME: Record<string, string> = { lose: '戰敗', surrender: '投降' }

/** 開頭的敘事：最後一份 defeat.pending 報告的摘要（引擎放的是選到那一版的開頭）；沒有是空字串 */
export function defeatStory(reports: readonly Report[]): string {
  for (let i = reports.length - 1; i >= 0; i--) {
    const r = reports[i]!
    if (r.action === 'defeat.pending' && !r.retracted) return r.outcome.summary
  }
  return ''
}

/** 三選一與多出來的選項分成三組：先問（看或不看）、別的辦法（被贖回……）、最後的三個（接受、重來、回到階段）。順序照引擎給的 */
export interface DefeatChoices { ask: DefeatChoice[]; extra: DefeatChoice[]; final: DefeatChoice[] }
const ASK = new Set(['watch', 'skip'])
const FINAL = new Set(['accept', 'retry', 'stage'])
export function choiceGroups(v: DefeatViewInfo): DefeatChoices {
  return {
    ask: v.choices.filter((c) => ASK.has(c.id)),
    extra: v.choices.filter((c) => !ASK.has(c.id) && !FINAL.has(c.id)),
    final: v.choices.filter((c) => FINAL.has(c.id)),
  }
}
/** 現在要不要顯示「先問」那一組：引擎說還在 ask 這一步 */
export const asking = (v: DefeatViewInfo): boolean => v.step === 'ask'

export interface Row { k: string; v: string; tone?: 'bad' | 'ok' }
export interface Cell { title: string; rows: Row[]; lines: string[] }

/**
 * 後果兩格。第一格是這一次接受的話會怎樣（引擎的 accept：委託失敗或繼續、錢最多被拿多少、裝備、同行的人、不演版的每一行結果）；
 * 第二格是回退（重來、回到階段、委託失敗）時留下的。inCommission 是引擎的 commissionView 有沒有（人在不在副本裡）。
 */
export function consequences(v: DefeatViewInfo, inCommission: { name: string } | null): { now: Cell; kept: Cell } {
  const a = v.accept
  const rows: Row[] = []
  if (inCommission) rows.push(a.fails_commission ? { k: '委託', v: `「${inCommission.name}」算失敗`, tone: 'bad' } : { k: '委託', v: `「${inCommission.name}」繼續`, tone: 'ok' })
  else rows.push({ k: '委託', v: a.fails_commission ? '不在委託裡（事件算失敗）' : '不在委託裡' })
  rows.push({ k: '現金', v: a.money_max > 0 ? `最多被拿 ${fmt(a.money_max)}` : '不會被拿' })
  rows.push({ k: '裝備與義體', v: a.gear_taken ? '可能被拿走' : '不會被拿走' })
  if (a.companions.length) rows.push({ k: '同行', v: `${a.companions.join('、')}一起被處置` })
  const kept: Cell = {
    title: '回退時留下的',
    rows: [
      { k: '紀錄', v: '留著，被收回的標成「已收回」' },
      ...(inCommission && a.fails_commission ? [{ k: '委託失敗', v: '回到進副本之前' } as Row] : []),
    ],
    lines: [],
  }
  return { now: { title: '這一次的後果', rows, lines: a.lines }, kept }
}

// ---- 打贏：戰利品 ----

export interface Spoils {
  /** 戰鬥結束那一份報告的 id 與結果 */
  report: string
  outcome: string
  /** 報告裡的結果，一行一筆（拿到什麼、現金、俘虜……）：原樣 */
  lines: string[]
  /** 拿到的東西（報告的 item 變更，數量為正的）與現金（cash 變更為正的合計） */
  items: Array<{ id: string; qty: number }>
  cash: number
}

/** 最近一份戰鬥結束的報告（battle.end）；沒有是 null */
export function spoilsOf(reports: readonly Report[]): Spoils | null {
  for (let i = reports.length - 1; i >= 0; i--) {
    const r = reports[i]!
    if (r.action !== 'battle.end' || r.retracted) continue
    const items: Spoils['items'] = []
    let cash = 0
    for (const c of r.changes as Array<{ op: string; id?: unknown; qty?: unknown; delta?: unknown }>) {
      if (c.op === 'item' && typeof c.id === 'string' && typeof c.qty === 'number' && c.qty > 0) items.push({ id: c.id, qty: c.qty })
      else if (c.op === 'cash' && typeof c.delta === 'number' && c.delta > 0) cash += c.delta
    }
    return { report: r.id, outcome: r.outcome.result, lines: [...(r.narration?.results ?? [])], items, cash }
  }
  return null
}

/** 東西的名字：照傳進來的查法（內容的 item、part、blueprint 都試），查不到用 id */
export function itemName(look: (kind: string, id: string) => string | undefined, id: string): string {
  for (const kind of ['item', 'part', 'blueprint']) {
    const n = look(kind, id)
    if (n) return n
  }
  return id
}
