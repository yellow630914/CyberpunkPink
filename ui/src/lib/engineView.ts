import type { Change, Report } from '@engine/src'
import type { GenderId } from '@engine/src'
import { DEGREE_NAME, GENDER_IDS, blankState, createKernel, formatTime } from '@engine/src'

/**
 * 把引擎的東西轉成畫面要的樣子（純函式，不寫規則）：
 * 介面的 AI 設定 → 引擎的 AI 設定；一份報告 → 紀錄的一則。
 */

/** 介面設定（stores/settings.ts 的 Settings）裡 AI 相關的欄位。全部選用：沒給的欄位引擎用預設值。 */
export interface UiAiFields {
  useAi: boolean
  judgeFree: boolean
  judgeShift: boolean
  judgeEvent: boolean
  clampRequested: boolean
  narrate: boolean
  tradeProse: boolean
  combatProse: string
  polish: boolean
  agentMode: boolean
  onlyQuery: boolean
  hooks: Record<string, boolean>
  hookLimits: { hook?: number; event?: number; other?: number }
  retries: number
  chainRow: string
  taskSource: Record<string, string>
}

const bit = (b: boolean): 0 | 1 => (b ? 1 : 0)

const CHAIN_ROW: Record<string, number> = { 出錯時展開: 0, 一直展開: 1, 隱藏: 2 }
const HOOK_KEYS: Array<[string, string]> = [
  ['agent_hook', 'hook_text'], ['agent_event', 'hook_block'], ['agent_night', 'hook_night'], ['agent_commission', 'hook_comm'], ['agent_flavor', 'hook_shop'],
]

/** 介面的設定轉成引擎的 AI 設定（cpp-ai-v1 的形狀，開關是 0／1）。左邊沒給的欄位不輸出，引擎用預設值。 */
export function aiSettingsFromUi(s: Partial<UiAiFields>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const flag = (from: keyof UiAiFields, to: string): void => { if (s[from] !== undefined) out[to] = bit(Boolean(s[from])) }
  flag('useAi', 'ai')
  flag('judgeFree', 'judge_free')
  flag('judgeShift', 'judge_work')
  flag('judgeEvent', 'judge_other')
  flag('clampRequested', 'clamp_asked')
  flag('narrate', 'narrate')
  flag('tradeProse', 'trade_text')
  if (s.combatProse !== undefined) out.combat_text = s.combatProse === '每回合一小段' ? 1 : 0
  if (s.polish !== undefined) out.polish = { free: bit(s.polish) }
  flag('agentMode', 'agent')
  flag('onlyQuery', 'query_only')
  for (const [from, to] of HOOK_KEYS) if (s.hooks?.[from] !== undefined) out[to] = bit(s.hooks[from]!)
  if (s.hookLimits) {
    const l = s.hookLimits
    if (l.hook !== undefined) out.lim_hook = l.hook
    if (l.event !== undefined) out.lim_event = l.event
    if (l.other !== undefined) for (const k of ['lim_visit', 'lim_night', 'lim_comm', 'lim_shop']) out[k] = l.other
  }
  if (s.retries !== undefined) out.retry = { '*': s.retries }
  if (s.chainRow !== undefined && CHAIN_ROW[s.chainRow] !== undefined) out.chainbar = CHAIN_ROW[s.chainRow]
  if (s.taskSource !== undefined) out.src = s.taskSource
  return out
}

export interface EngineLogEntry {
  id: string
  time: string
  place: string
  prose: string[]
  roll?: { skill: string; die: number; mod: number; dc: number; result: '大成功' | '成功' | '失敗' | '大失敗'; twist?: string; rerolls?: number }
  /** LogView 與舊的紀錄共用的欄位；引擎的報告沒有這兩種，永遠不放 */
  quotes?: string[]
  net?: string[]
  changes: Array<{ text: string; kind?: 'plus' | 'minus' }>
  notices: string[]
  /** 報告的種類（action、combat、event……） */
  kind: string
  /** 被撤退收回的經歷：內容照留，畫面標出來（SERIES 第 6 節） */
  retracted?: boolean
}

let plain: ReturnType<typeof createKernel> | null = null
function plainDescribe(changes: Change[]): string[] {
  plain ??= createKernel()
  return plain.changes.describe(blankState(0), changes)
}

/** 舊系統（action 以 ui. 開頭）寫的紀錄，變化的字就放在 narration.results：引擎的變更描述不出東西時用它。 */
function legacyOr(report: Report, lines: string[]): string[] {
  return lines.length === 0 && report.action?.startsWith('ui.') ? report.narration?.results ?? [] : lines
}

/** 一份報告轉成紀錄的一則（LogView 吃的樣子）。describe 沒給時用一個只有核心變更的核心來描述。 */
export function logEntryOf(report: Report, describe: (changes: Change[]) => string[] = plainDescribe): EngineLogEntry {
  const loc = report.location
  const place = [loc.district, loc.block, loc.facility].filter((x): x is string => !!x).join(' · ')
  const prose = report.narration?.text
    ? report.narration.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    : [report.outcome.summary]
  const entry: EngineLogEntry = {
    id: report.id,
    kind: report.kind,
    time: formatTime(report.time.start),
    place,
    prose,
    changes: legacyOr(report, describe(report.changes)).map((text) => {
      const kind = text.includes('+') ? 'plus' : text.includes('−') ? 'minus' : undefined
      return kind ? { text, kind } : { text }
    }),
    notices: (report.clamps ?? []).map((c) => c.notice),
  }
  const beat = report.timeline.find((b) => b.roll)
  if (beat?.roll) {
    const r = beat.roll
    const label = (r.parts.find((p) => p.source === 'skill') ?? r.parts.find((p) => p.source === 'attr'))?.label ?? ''
    entry.roll = {
      skill: label, die: r.natural, mod: r.parts.reduce((s, p) => s + p.value, 0), dc: r.dc,
      result: DEGREE_NAME[r.degree] as '大成功' | '成功' | '失敗' | '大失敗',
      // 重擲過幾次不能藏（UI 3.2 節）：有才帶
      ...(r.rerolls ? { rerolls: r.rerolls } : {}),
      ...(beat.twist ? { twist: beat.twist } : {}),
    }
  }
  if (report.retracted) entry.retracted = true
  return entry
}

/** aiSettingsFromUi 的反向：讀 cpp-ai-v1（引擎的形狀）還原成介面的欄位。缺的、型別不對的欄位不輸出。 */
export function uiFromAiSettings(raw: unknown): Partial<UiAiFields> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<UiAiFields> = {}
  const flag = (from: string, to: 'useAi' | 'judgeFree' | 'judgeShift' | 'judgeEvent' | 'clampRequested' | 'narrate' | 'tradeProse' | 'agentMode' | 'onlyQuery'): void => {
    if (typeof r[from] === 'number' || typeof r[from] === 'boolean') out[to] = Boolean(r[from])
  }
  flag('ai', 'useAi'); flag('judge_free', 'judgeFree'); flag('judge_work', 'judgeShift'); flag('judge_other', 'judgeEvent')
  flag('clamp_asked', 'clampRequested'); flag('narrate', 'narrate'); flag('trade_text', 'tradeProse'); flag('agent', 'agentMode'); flag('query_only', 'onlyQuery')
  if (typeof r.combat_text === 'number') out.combatProse = r.combat_text ? '每回合一小段' : '結束時整場寫一次'
  const polish = r.polish as Record<string, unknown> | undefined
  if (polish && typeof polish === 'object' && polish.free !== undefined) out.polish = Boolean(polish.free)
  const hooks: Record<string, boolean> = {}
  for (const [ui, eng] of HOOK_KEYS) if (r[eng] !== undefined) hooks[ui] = Boolean(r[eng])
  if (Object.keys(hooks).length) out.hooks = hooks
  const limits: { hook?: number; event?: number; other?: number } = {}
  if (typeof r.lim_hook === 'number') limits.hook = r.lim_hook
  if (typeof r.lim_event === 'number') limits.event = r.lim_event
  if (typeof r.lim_visit === 'number') limits.other = r.lim_visit
  if (Object.keys(limits).length) out.hookLimits = limits
  const retry = r.retry as Record<string, unknown> | undefined
  if (retry && typeof retry['*'] === 'number') out.retries = retry['*']
  if (typeof r.chainbar === 'number') out.chainRow = (['出錯時展開', '一直展開', '隱藏'] as const)[r.chainbar] ?? '出錯時展開'
  if (r.src && typeof r.src === 'object') out.taskSource = r.src as Record<string, string>
  return out
}

/** 設定頁的存檔規則轉成引擎的存檔規則（難度、特質點、自訂難度的 DC 偏移、關掉的內容標籤；其他用預設）。 */
export function rulesFromUi(s: { difficulty?: string; traitPoints?: number; customDiff?: { dc: number }; filterIntimateBody?: boolean }): Record<string, unknown> {
  const D: Record<string, string> = { 故事: 'story', 簡單: 'easy', 普通: 'normal', 困難: 'hard', 傳奇: 'legend', 自訂: 'custom' }
  const out: Record<string, unknown> = {}
  if (s.difficulty && D[s.difficulty]) out.difficulty = D[s.difficulty]
  if (s.traitPoints !== undefined) out.startPerkPoints = s.traitPoints
  if (s.difficulty === '自訂' && s.customDiff) out.dcOffset = s.customDiff.dc
  if (s.filterIntimateBody === false) out.contentOff = ['intimate_body']
  return out
}

/** 建角畫面的性別選項（DATA 第 1 節的五個值；id 就是引擎的值，順序照引擎）。TS 只有男跨女一種（trans_f）。名字是介面定的。 */
const GENDER_NAME: Record<GenderId, string> = { female: '女', male: '男', femboy: '偽娘（含男娘）', trans_f: 'TS', futa: '扶他' }
export const GENDER_OPTIONS: ReadonlyArray<{ id: GenderId; name: string }> = GENDER_IDS.map((id) => ({ id, name: GENDER_NAME[id] }))

/** 特質的分類（引擎給英文代號）顯示用的中文。 */
export const PERK_CATEGORY_NAME: Record<string, string> = { social: '社交', street: '街頭', body: '身體', bridge: '橋', craft: '工藝', net: '內海', media: '媒體', desire: '慾望', origin: '出身' }
