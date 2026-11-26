import type { CurtainView, FallView, MemberView, PathView, TierView } from '@engine/src/features/curtain'
import type { HereOption } from './here'

/**
 * 簾後館的檢視整理（M4-ui-curtain；CYBERSPACE 8.8 節）：把引擎的 memberView、curtainView、fallView 排成畫面要的樣子。
 * 只做整理與排序：場熱、打賞、保證金、會費、DC、能不能報名、三條路的數字與選不了的原因，一律是引擎給的；這裡沒有規則，只有字樣。
 * 遭遇的開戰與潛行繞過不在這裡：讀 netrunView（lib/netrunView.ts 的 hereOptions），curtainView.near 不列遭遇。
 */

/** 面談可以擲的兩項基本功（引擎的 INTERVIEW_SKILLS） */
export const INTERVIEW_SKILLS: Array<{ id: 'negotiate' | 'perform'; name: string }> = [{ id: 'negotiate', name: '交涉' }, { id: 'perform', name: '表演' }]
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
export const roman = (n: number): string => ROMAN[n] ?? String(n)

// ---- 場熱 ----

export interface HeatMark { at: number; name: string; text: string }
/** 場熱的三個刻度（0、贊助人、安可）：位置是引擎給的（heat.sponsor_at、encore_at），說明照 CYBERSPACE 8.8 節 */
export function heatMarks(v: Pick<CurtainView, 'heat'>): HeatMark[] {
  return [
    { at: 0, name: '散場', text: '場熱掉到 0：觀眾散場，這一趟提早落幕，不算戰敗；沒有打賞，票根照算。' },
    { at: v.heat.sponsor_at, name: '贊助人', text: '贊助人現身：化妝室多一個「包場」的選擇。' },
    { at: v.heat.encore_at, name: '安可', text: '觀眾喊安可：走完終幕之後可以加演。' },
  ]
}
/** 打賞比例的段（現在在哪一段標起來）：下限與比例都是引擎給的 */
export const bandLine = (b: CurtainView['heat']['bands'][number]): string => `${b.from} 起 ×${b.ratio}`

// ---- 一趟裡 ----

/** 「第 2／4 幕・第一幕・舞台」：幕的名字是引擎的 */
export const actLine = (v: Pick<CurtainView, 'act' | 'encore'>): string => `${v.encore ? '加演・' : ''}第 ${v.act.number}／${v.act.total} 幕・${v.act.name}`
/** 這一幕用了幾回合對標準回合數；超過標準的罰是引擎在化妝室算（restDraft） */
export const turnsLine = (v: Pick<CurtainView, 'act'>): string => `回合 ${v.act.used}／標準 ${v.act.standard}`
/** 這一幕用掉的回合對標準回合數的比例條（夾在 0～100%） */
export const turnsWidth = (v: Pick<CurtainView, 'act'>): number => Math.max(0, Math.min(100, Math.round((v.act.used / Math.max(1, v.act.standard)) * 100)))

export const ORDER_STATE: Record<string, string> = { open: '進行中', done: '完成', refused: '拒絕' }

/**
 * 「這裡」與按 E 用的選項：站的這一格與旁邊的節點能做的事（點單、賞箱、條文、近道、獎品室；名字前面寫是哪個節點），再加上不在哪一格都能做的（包場）。
 * 順序是引擎給的；做不到的原因是引擎的 block。遭遇不在裡面（由 netrunView 列開戰與潛行繞過）。
 */
export function curtainOptions(v: CurtainView, use: (id: string, at?: string) => void): HereOption[] {
  return [
    ...v.near.flatMap((n) => n.uses.map((u): HereOption => ({ id: `${u.id}@${n.marker.id}`, name: `${u.name}：${n.marker.name}`, reason: u.block, run: () => use(u.id, n.marker.id) }))),
    ...v.free.map((u): HereOption => ({ id: u.id, name: u.name, reason: u.block, run: () => use(u.id) })),
  ]
}

// ---- 入會與面談 ----

/** 席次的一行說明（等級、街頭信譽、保證金、會費、獎金都是引擎給的；金額在元件裡用 MoneyTag） */
export const tierRep = (t: TierView): string => `${roman(t.grade)} 級・街頭信譽「${t.rep_name}」以上・面談 DC ${t.interview_dc}`

/** 現在去面談的席次：新入會是散座、升席是下一席（引擎的 canInterview）；都不能的時候回第一個，讓畫面照樣列出原因 */
export function interviewTier(m: MemberView): TierView | null {
  return m.tiers.find((t) => t.canInterview) ?? m.tiers.find((t) => !t.current) ?? m.tiers[0] ?? null
}

/** 會員證的狀態一句話：停權、逾期幾週、繳到哪（時間是總分鐘，這裡換成「第幾天」字樣由元件的 dayOf 做） */
export function memberLine(m: NonNullable<MemberView['member']>): string {
  if (m.suspended) return '停權中：會費逾期，要重新面談（邀請函也要重來）。'
  return m.overdue > 0 ? `會費逾期 ${m.overdue} 週。` : '會費繳到現在。'
}

/** 口味單按軸分組（引擎給的標籤；軸的順序照引擎排好的） */
export function tasteGroups<T extends { axis: string; axisName: string }>(opts: T[]): Array<{ axis: string; name: string; items: T[] }> {
  const out: Array<{ axis: string; name: string; items: T[] }> = []
  for (const o of opts) {
    const g = out.find((x) => x.axis === o.axis)
    if (g) g.items.push(o)
    else out.push({ axis: o.axis, name: o.axisName, items: [o] })
  }
  return out
}
/** 口味單：加減一個標籤之後的整張單子（送出時是整張） */
export const toggleTag = (tags: string[], id: string): string[] => (tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id])

// ---- 報名 ----

/** 隊伍的選擇：加進去或拿掉；會員本人（pc）一定在 */
export function toggleParty(party: string[], id: string, pc: string): string[] {
  if (id === pc) return party
  return party.includes(id) ? party.filter((p) => p !== id) : [...party, id]
}

// ---- 結算 ----

/** 結算的資料（curtain.result 報告 timeline 的 data；引擎的 SettleResult） */
export interface CurtainResultView {
  outcome: string
  early: boolean
  heat: number
  act: number
  prize: number
  tips: number
  tipsRatio: number
  refund: number
  forfeited: number
  stubs: number
  encore: boolean
  lines: string[]
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
export function curtainResultOf(data: Record<string, unknown>): CurtainResultView {
  return {
    outcome: typeof data.outcome === 'string' ? data.outcome : '', early: data.early === true, heat: num(data.heat), act: num(data.act),
    prize: num(data.prize), tips: num(data.tips), tipsRatio: num(data.tips_ratio), refund: num(data.refund), forfeited: num(data.forfeited), stubs: num(data.stubs),
    encore: typeof data.encore === 'number', lines: Array.isArray(data.lines) ? data.lines.filter((l): l is string => typeof l === 'string') : [],
  }
}
/** 結算的標題 */
export function resultTitle(r: CurtainResultView): string {
  return r.early ? '提早落幕' : r.outcome === 'done' ? '一晚演完了' : '中途離場'
}

// ---- 落幕之後 ----

/** 補演的評價（引擎的 band） */
export const BAND_NAME: Record<string, string> = { good: '合拍', fair: '普通', poor: '不合' }
/** 三條路各自的名字與一句說明（引擎的 PathView.name、desc 為準；這裡只決定順序與圖示字） */
export const PATH_ORDER: Array<PathView['id']> = ['pay', 'tab', 'gig']
export const sortPaths = (paths: PathView[]): PathView[] => [...paths].sort((a, b) => PATH_ORDER.indexOf(a.id) - PATH_ORDER.indexOf(b.id))

/** 落幕之後現在要處理的是哪一步（補演的確認或三條路）：給標題與步驟條 */
export const fallStepName = (f: Pick<FallView, 'step'>): string => (f.step === 'replay' ? '補演' : '選一條路')

/** 母帶的一行：外流、館方保管、已經買回；價錢是引擎給的 */
export function tapeLine(t: FallView['tapes'][number]): string {
  if (t.bought) return '已經買回來了。'
  return t.leaked ? '已經外流了，買回之後下架（傳出去的名聲收不回來）。' : '館方保管著，只能買回。'
}
