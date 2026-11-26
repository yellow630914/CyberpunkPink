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
  /** 成人場景的 AI：off 只有整場的正文、closing 進場與收尾、full 每回合都問（引擎 sceneAi；沒給用預設 closing） */
  sceneAi: string
  /** 未登錄零件交貨走不走 AI（引擎 partAi；沒給是開）：關掉時名字、說明與怪癖那一句用預設清單的 */
  partAi: boolean
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
  if (s.partAi !== undefined) out.partAi = Boolean(s.partAi)
  if (s.combatProse !== undefined) out.combat_text = s.combatProse === '每回合一小段' ? 1 : 0
  if (s.polish !== undefined) out.polish = { free: bit(s.polish) }
  flag('agentMode', 'agent')
  flag('onlyQuery', 'query_only')
  if (s.sceneAi === 'off' || s.sceneAi === 'closing' || s.sceneAi === 'full') out.sceneAi = s.sceneAi
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
export function logEntryOf(report: Report, describe: (changes: Change[]) => string[] = plainDescribe, placeName?: (loc: Report['location']) => string): EngineLogEntry {
  const loc = report.location
  const place = placeName ? placeName(loc) : [loc.district, loc.block, loc.facility].filter((x): x is string => !!x).join(' · ')
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
  if (r.sceneAi === 'off' || r.sceneAi === 'closing' || r.sceneAi === 'full') out.sceneAi = r.sceneAi
  if (typeof r.partAi === 'number' || typeof r.partAi === 'boolean') out.partAi = Boolean(r.partAi)
  return out
}

/** 設定頁的存檔規則轉成引擎的存檔規則（難度、特質點、自訂難度的 DC 偏移、關掉的內容標籤、快速移動、名冊 NPC 會死；其他用預設）。 */
/** 內容篩選裡引擎認得的題材（設定的欄位 → 存檔規則 contentOff 的標籤）：每一項直接對到引擎的標籤（LEWD_SYSTEM 第 9 節、DATA 第 1 節 tags）。 */
export const FILTER_TAGS = {
  filterRestraint: ['restraint'], filterDollChip: ['doll_chip', 'puppet_amnesia'], filterPublic: ['public'], filterContract: ['contract'], filterIntimateBody: ['intimate_body'],
  filterPcUnwilling: ['pc_unwilling'], filterTargetUnwilling: ['target_unwilling'], filterContractDom: ['contract_dom'], filterNtr: ['ntr'], filterBlacktape: ['blacktape'],
  filterMale: ['male_partner'], filterFemale: ['female_partner'], filterFemboy: ['femboy_partner'], filterTrans: ['trans_partner'], filterFuta: ['futa_partner'],
} as const satisfies Record<string, readonly string[]>
export type FilterKey = keyof typeof FILTER_TAGS
/** 設定與建角的「內容篩選」列：每一項的名字與說明（開關關掉＝那個標籤進 contentOff）。 */
export const FILTER_ROWS: ReadonlyArray<{ k: FilterKey; name: string; hint: string }> = [
  { k: 'filterRestraint', name: '拘束', hint: '關掉時拘束類的事件與家具用途（遊戲間）不出現。' },
  { k: 'filterDollChip', name: '人偶晶片的失憶工作', hint: '關掉時人偶館只能開清醒的店，相關打工的階段不顯示。' },
  { k: 'filterPublic', name: '公開場合', hint: '關掉時發生在公開場合的成人事件不觸發。' },
  { k: 'filterContract', name: '契約', hint: '關掉時契約面板與契約人的事件不出現。' },
  { k: 'filterIntimateBody', name: '身體的私密描寫', hint: '關掉時建角不問私處的樣子，角色的成人分頁也不顯示；場景裡那幾個部位的名字收起來。' },
  { k: 'filterPcUnwilling', name: '主角非自願', hint: '關掉時「被迫」性質的場景開不起來，標了主角非自願的分支改走替代的版本。' },
  { k: 'filterTargetUnwilling', name: '對象非自願', hint: '關掉時「俘虜」性質的場景開不起來，對俘虜或被迫的對象用的夜課技能不出現。' },
  { k: 'filterContractDom', name: '契約支配', hint: '關掉時「契約」性質的場景開不起來，契約只剩經濟與法律層面的效果。' },
  { k: 'filterNtr', name: 'NTR', hint: '關掉時帶 NTR 標籤的場景開不起來，相關的夜課技能不出現。' },
  { k: 'filterBlacktape', name: '黑帶相關的任務', hint: '關掉時黑帶相關的任務與事件不出現。' },
  { k: 'filterMale', name: '男性對象', hint: '關掉時，對象是男性的成人場景開不起來（內海看化身的性別）。' },
  { k: 'filterFemale', name: '女性對象', hint: '關掉時，對象是女性的成人場景開不起來（內海看化身的性別）。' },
  { k: 'filterFemboy', name: '男娘與偽娘對象', hint: '關掉時，對象是這個性別的成人場景開不起來（內海看化身的性別）。' },
  { k: 'filterTrans', name: 'TS 對象', hint: '關掉時，對象是這個性別的成人場景開不起來（內海看化身的性別）。' },
  { k: 'filterFuta', name: '扶他對象', hint: '關掉時，對象是這個性別的成人場景開不起來（內海看化身的性別）。' },
]
export type UiFilterFlags = { [K in FilterKey]?: boolean }

export function rulesFromUi(s: { difficulty?: string; traitPoints?: number; customDiff?: { dc: number }; fastTravel?: boolean; rosterDeath?: boolean } & UiFilterFlags): Record<string, unknown> {
  const D: Record<string, string> = { 故事: 'story', 簡單: 'easy', 普通: 'normal', 困難: 'hard', 傳奇: 'legend', 自訂: 'custom' }
  const out: Record<string, unknown> = {}
  if (s.difficulty && D[s.difficulty]) out.difficulty = D[s.difficulty]
  if (s.traitPoints !== undefined) out.startPerkPoints = s.traitPoints
  if (s.difficulty === '自訂' && s.customDiff) out.dcOffset = s.customDiff.dc
  // 內容篩選：關掉的題材是引擎存檔規則的 contentOff（題材的 id：條目與傾向標籤的 tags 對得上它就不出現）
  const off = (Object.keys(FILTER_TAGS) as FilterKey[]).filter((k) => s[k] === false).flatMap((k) => [...FILTER_TAGS[k]])
  if (off.length) out.contentOff = off
  if (s.fastTravel !== undefined) out.fastTravel = s.fastTravel
  if (s.rosterDeath !== undefined) out.rosterDeath = s.rosterDeath
  return out
}

/** 建角畫面的性別選項（DATA 第 1 節的五個值；id 就是引擎的值，順序照引擎）。TS 只有男跨女一種（trans_f）。名字是介面定的。 */
const GENDER_NAME: Record<GenderId, string> = { female: '女', male: '男', femboy: '偽娘（含男娘）', trans_f: 'TS', futa: '扶他' }
export const GENDER_OPTIONS: ReadonlyArray<{ id: GenderId; name: string }> = GENDER_IDS.map((id) => ({ id, name: GENDER_NAME[id] }))

/** 特質的分類（引擎給英文代號）顯示用的中文。 */
export const PERK_CATEGORY_NAME: Record<string, string> = { social: '社交', street: '街頭', body: '身體', bridge: '橋', craft: '工藝', net: '內海', media: '媒體', desire: '慾望', origin: '出身' }

/**
 * 這一步提交新產生的報告要引出什麼（App 用）：跨過週一的結算（bill.settle）打開帳單，週日晚上的提醒（bill.notice）顯示成通知；
 * 契約的指令送達（contract.order，每天的或每週回報的，不含主動要的）也是一則通知。
 * 只看傳進來的報告，不看紀錄的歷史：讀檔、回退帶進來的舊報告不算。
 */
export function freshEffects(reports: ReadonlyArray<{ action?: string; outcome: { summary: string; result?: string } }>): { openBills: boolean; toasts: string[] } {
  return { openBills: reports.some((r) => r.action === 'bill.settle'), toasts: reports.filter((r) => r.action === 'bill.notice' || (r.action === 'contract.order' && (r.outcome.result === 'sent' || r.outcome.result === 'weekly'))).map((r) => r.outcome.summary) }
}
