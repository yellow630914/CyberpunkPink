import type { DiveOptions, DiveView, SiteRow } from '@engine/src/features/dive'
import type { BracketRow } from '@engine/src/features/maze'
import type { EndRecord } from '../stores/engine'

/**
 * 潛入與登出的檢視整理（M3-ui-dive）：只整理與排序引擎給的（接入點、費用、去處與原因、迷宮館的組別、離開的結算）。
 * 費用、押金、能不能去、評價、獎金、退不退押金全是引擎的；這裡沒有規則，只有字樣。
 */

export const DECK_NAME: Record<DiveOptions['deck'], string> = { own: '自己的甲板', rental: '租用的甲板', none: '訪客（沒有甲板）' }
export const OVER_NAME: Record<'located' | 'defeat', string> = { located: '被定位，強制斷線', defeat: '戰敗，強制斷線' }
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
export const roman = (n: number): string => ROMAN[n] ?? String(n)

/** 這個接入點用什麼甲板的一句話（租的寫甲板名字） */
export function deckLine(o: Pick<DiveOptions, 'deck' | 'here'>): string {
  if (o.deck === 'rental' && o.here?.rental) return `${DECK_NAME.rental}：${o.here.rental.name}`
  return DECK_NAME[o.deck]
}

/** 費用的拆解：費用、押金（只有租了才有）。數字是引擎算好的，這裡只決定寫哪幾行 */
export function costParts(o: Pick<DiveOptions, 'fee' | 'deposit' | 'cost'>): Array<{ label: string; amount: number }> {
  const out: Array<{ label: string; amount: number }> = []
  if (o.fee > 0) out.push({ label: '費用（不退）', amount: o.fee })
  if (o.deposit > 0) out.push({ label: '押金（登出時退，被強制斷線沒收）', amount: o.deposit })
  return out
}

/** 去處的順序：去得了的在前，其餘照引擎給的順序 */
export const sortSites = (rows: SiteRow[]): SiteRow[] => [...rows].sort((a, b) => Number(a.block !== null) - Number(b.block !== null))

/** 留著的子網離開了幾天的一句 */
export const keptLine = (k: { daysAgo: number; located: boolean }): string => `上次離開：${k.daysAgo <= 0 ? '今天' : `${k.daysAgo} 天前`}${k.located ? '（被定位）' : ''}。`

/** 迷宮館的組別列的 key（無差別組有兩個等級，id 一樣） */
export const bracketKey = (r: Pick<BracketRow, 'id' | 'grade'>): string => `${r.id}:${r.grade}`

/** 這一組的構裝規則（給畫面的字樣：數字來自引擎的 own、maxGrade、deck） */
export function bracketRule(r: BracketRow): string {
  if (!r.own) return '只能用館方發的比賽版構裝與比賽甲板。'
  return `比賽版，或自己 ${roman(r.maxGrade)} 級以下的構裝。`
}

/** 迷宮館結算的資料（maze.result 報告 timeline 的 data；引擎的 MazeResult） */
export interface MazeResultView {
  done: boolean
  rating: string | null
  mult: number | null
  rounds: number
  standard: number
  downs: number
  chips: number
  chipCash: number
  prize: number
  refund: number
  forfeited: number
  lines: string[]
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
export function mazeResultOf(data: Record<string, unknown>): MazeResultView {
  return {
    done: data.outcome === 'done', rating: typeof data.rating === 'string' ? data.rating : null, mult: typeof data.mult === 'number' ? data.mult : null,
    rounds: num(data.rounds), standard: num(data.standard), downs: num(data.downs), chips: num(data.chips), chipCash: num(data.chipCash),
    prize: num(data.prize), refund: num(data.refund), forfeited: num(data.forfeited),
    lines: Array.isArray(data.lines) ? data.lines.filter((l): l is string => typeof l === 'string') : [],
  }
}

/** 離開的結算：標題與句子（引擎的報告句子原樣；拿到的東西另外列） */
export function endTitle(e: EndRecord): string {
  if (e.maze) return '迷宮館結算'
  return e.action === 'netrun.located' ? '被定位了' : '離開了子網'
}

/** 潛入中的一句狀態，給主畫面的提示條 */
export function diveBanner(v: DiveView): string {
  if (!v.dive) return ''
  return `潛入中：${v.dive.name}（${DECK_NAME[v.dive.deck]}）${v.dive.over ? `，${OVER_NAME[v.dive.over]}` : ''}`
}

/**
 * 離開那份報告的句子拆成「開頭那一句」與「引擎寫的每一行」（敵對值、後門、丟掉的東西、迷宮館的結算句）：報告的 summary 就是開頭加上所有行接起來，
 * 這裡只是把它們分開排版，沒有改字。
 */
export function endParts(e: Pick<EndRecord, 'summary' | 'lines'>): { head: string; lines: string[] } {
  const joined = e.lines.join('')
  const head = joined && e.summary.endsWith(joined) ? e.summary.slice(0, e.summary.length - joined.length) : e.summary
  return { head, lines: e.lines }
}
