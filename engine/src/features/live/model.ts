// L6 功能 live 的資料與純函式：狀態的形狀（state.ext.live）、規則（內建的預設加資料蓋掉）、模板與目標（內容種類）、事件的字彙、觀看數與換算、讀取。
// 規格：MEDIA 1.2 節、第 3 節「副本裡的直播不回退」、第 6 節；DATA 9.2 節（直播目標）、第 11 節（stream_template）；dev/adr/0020 第三節、V21～V26；dev/work/M5-live.md。
//
// 內容種類：
//   live_rule        { id: 'default', ... }  規則表（overridable）：每條目標的熱度、每點熱度的訂閱與打賞、觀看數的式子、級距、成人直播的上限、同意的親密度……（DEFAULT_LIVE_RULES）
//   stream_template  { id, name, scope, highlights, max_from?, goals, risk?, blocks?, start_heat? }  直播模板（overridable）：預設三筆（DEFAULT_TEMPLATES：st_combat、st_commission、st_adult）
//   stream_goal      { id, text, scope[], check: { event, count_min?, count_max? }, heat?, tip_per_grade?, channel? }  直播目標（內容，不匯入；DATA 9.2）
//
// 狀態 state.ext.live：{ session: Session | null, seq, log: Settled[] }。**只經由 live.open、live.add、live.close 三種變更寫**（ops.ts；回到快照時用整份 ext 換）。

import type { ContentEntry, GameState, Kernel, ReportLocation } from '../../core'
import { isRecord, isSafeInt, meterOf } from '../../core'
import type { SlotDirection, SlotKind, SlotRules } from './slotrules'
import { DEFAULT_SLOT, SLOT_DIRECTIONS, SLOT_KINDS, cloneSlot, readSlot, slotProblems } from './slotrules'

export const OWNER = 'live'
export const EXT = 'live'
export const RULE_KIND = 'live_rule'
export const TEMPLATE_KIND = 'stream_template'
export const GOAL_KIND = 'stream_goal'

export const GO_ACTION = 'live.go'
export const CUT_ACTION = 'live.cut'
/** 掛在 allowEverywhere 的前綴：開播與收播在任何一層活動裡都做得了 */
export const LIVE_PREFIX = 'commit:live.'

export const GOAL_EXTRA_STAT = 'live_goal_extra'
export const RECORD_QUALITY_STAT = 'live_record_quality'

/** 事件的名字（模板與目標的 event）：封閉清單，從報告的 action 與每一拍的標籤對出來（events.ts）。 */
export const EVENTS = ['crit', 'overload_foe', 'foe_down', 'ally_down', 'battle_won', 'battle_lost', 'stage_done', 'branch', 'scene_act', 'scene_end'] as const
export type LiveEvent = (typeof EVENTS)[number]
export const EVENT_NAME: Record<LiveEvent, string> = {
  crit: '打出要害', overload_foe: '敵人過載', foe_down: '打倒敵人', ally_down: '隊友倒下', battle_won: '戰鬥打贏', battle_lost: '戰鬥打輸',
  stage_done: '過了一個階段', branch: '做了一次分支的選擇', scene_act: '場景裡的一個行動', scene_end: '場景結束',
}

export const SCOPES = ['combat', 'commission', 'adult'] as const
export type Scope = (typeof SCOPES)[number]
export const HOST_KINDS = ['battle', 'scene', 'commission'] as const
export type HostKind = (typeof HOST_KINDS)[number]
export const MODES = ['activity', 'slot'] as const
export type Mode = (typeof MODES)[number]
/** 宿主的種類對到模板的範圍 */
export const SCOPE_OF_HOST: Record<HostKind, Scope> = { battle: 'combat', commission: 'commission', scene: 'adult' }
export const HOST_NAME: Record<HostKind, string> = { battle: '戰鬥', commission: '委託副本', scene: '成人場景' }
/** 每個範圍預設用哪一筆模板 */
export const DEFAULT_TEMPLATE_ID: Record<Scope, string> = { combat: 'st_combat', commission: 'st_commission', adult: 'st_adult' }
/** 宿主這樣收場算「輸」（紀錄標戰敗的畫面）：戰敗、投降、委託失敗、撤退 */
export const LOST_OUTCOMES: readonly string[] = ['lose', 'surrender', 'failed', 'retreat']

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const own = (o: object | undefined, key: string): boolean => !!o && Object.hasOwn(o, key)
const nat = (v: unknown): number => (isSafeInt(v) && v > 0 ? v : 0)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 規則 ----

export interface LiveRules {
  /** 達成一條目標加的熱度（目標沒寫 heat 時用這個） */
  goal_heat: number
  /** 每點熱度換幾個訂閱、幾塊打賞（V25） */
  heat_subs: number
  heat_tips: number
  /** 觀看數換成訂閱的零頭：觀看數 ÷ views_div 捨去 */
  views_div: number
  /** 觀看數的式子：基本盤 = 訂閱 × base_pct%（最少 base_min）；觀看數 = 基本盤 ×（1 ＋ per_heat × 熱度，熱度算到 heat_cap 為止） */
  viewers: { base_pct: number; base_min: number; per_heat: number; heat_cap: number }
  /** 級距：倍率 ≤ 第一個數字是冷清、≥ 第二個數字是爆，其餘是熱 */
  tiers: [number, number]
  /** 成人直播每場行動算進熱度的上限（模板的 max_from 沒寫時用它） */
  adult_cap: number
  /** 對象的親密度到這個數字算同意（V24） */
  consent: number
  /** 豔名每幾點算一級；曝露度每幾級起始熱度 +1 */
  fame_step: number
  exposure_step: number
  /** 亮點清單留最近幾筆（畫面用；上限另有 from 記著）、收播的結果留最近幾筆 */
  highlight_keep: number
  log_keep: number
  /** 時段直播的規則表（slotrules.ts；M5-live-slot） */
  slot: SlotRules
  /** 第一人稱直播（只用主角自己的錄影義體開播；MEDIA 第 6 節，待平衡）：一般內容收播的訂閱乘 subs_mult、成人的熱度加 adult_heat */
  first_person: { subs_mult: number; adult_heat: number }
}

export const DEFAULT_LIVE_RULES: LiveRules = {
  goal_heat: 3, heat_subs: 6, heat_tips: 8, views_div: 400,
  viewers: { base_pct: 5, base_min: 20, per_heat: 0.1, heat_cap: 20 },
  tiers: [1.5, 2.5], adult_cap: 10, consent: 60, fame_step: 30, exposure_step: 2, highlight_keep: 100, log_keep: 20,
  slot: DEFAULT_SLOT,
  first_person: { subs_mult: 0.8, adult_heat: 1 },
}

const RULE_SPECS: Array<[path: string, lo: number, hi: number, int: boolean]> = [
  ['goal_heat', 0, 100, true], ['heat_subs', 0, 1000, true], ['heat_tips', 0, 100000, true], ['views_div', 1, 1_000_000, true],
  ['viewers.base_pct', 0, 100, false], ['viewers.base_min', 0, 100000, true], ['viewers.per_heat', 0, 10, false], ['viewers.heat_cap', 1, 1000, true],
  ['first_person.subs_mult', 0, 1, false], ['first_person.adult_heat', 0, 10, true], ['adult_cap', 0, 1000, true], ['consent', -100, 100, true], ['fame_step', 1, 1000, true], ['exposure_step', 1, 100, true], ['highlight_keep', 1, 1000, true], ['log_keep', 1, 200, true],
]

const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((cur, key) => (isRecord(cur) && own(cur, key) ? cur[key] : undefined), o)
const specOk = (v: unknown, [, lo, hi, int]: (typeof RULE_SPECS)[number]): v is number => finite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v))
const tiersOk = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => finite(n) && n >= 1 && n <= 100) && (v[0] as number) < (v[1] as number)

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.viewers !== undefined && !isRecord(e.viewers)) p.push('viewers 要是一組設定（物件）')
  if (e.first_person !== undefined && !isRecord(e.first_person)) p.push('first_person 要是一組設定（物件）')
  for (const spec of RULE_SPECS) {
    const v = getPath(e, spec[0])
    if (v !== undefined && !specOk(v, spec)) p.push(`${spec[0]} 要是 ${spec[1]}～${spec[2]} 的${spec[3] ? '整數' : '數字'}`)
  }
  if (e.tiers !== undefined && !tiersOk(e.tiers)) p.push('tiers 要是兩個由小到大、1 以上的數字（冷清與爆的界線）')
  if (e.slot !== undefined) p.push(...slotProblems(e.slot))
  return p
}

/** 現在生效的規則：資料 live_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function liveRules(k: Pick<Kernel, 'content'>): LiveRules {
  const d = DEFAULT_LIVE_RULES
  const out: LiveRules = { ...d, viewers: { ...d.viewers }, tiers: [...d.tiers], slot: cloneSlot(d.slot), first_person: { ...d.first_person } }
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  for (const spec of RULE_SPECS) {
    const v = getPath(e, spec[0])
    if (!specOk(v, spec)) continue
    const keys = spec[0].split('.')
    if (keys.length === 1) (out as unknown as Record<string, number>)[keys[0]!] = v
    else if (keys[0] === 'first_person') (out.first_person as unknown as Record<string, number>)[keys[1]!] = v
    else (out.viewers as unknown as Record<string, number>)[keys[1]!] = v
  }
  if (tiersOk(e.tiers)) out.tiers = [e.tiers[0], e.tiers[1]]
  if (e.slot !== undefined) out.slot = readSlot(e.slot)
  return out
}

// ---- 模板 ----

export interface TemplateEntry {
  id: string
  name: string
  scope: Scope
  highlights: Array<{ event: string; heat: number }>
  /** 每一種事件最多給幾點熱度（沒寫的不設上限；成人直播沒寫 scene_act 時用規則的 adult_cap） */
  max_from?: Record<string, number>
  /** pick：從 stream_goal 裡 scope 對得上的抽 [最少, 最多] 個；host：宿主自己列（副本的 stream_goals） */
  goals: { pick: [number, number] } | 'host'
  risk?: { hostility_mult?: number }
  /** 這種直播擋掉的玩法（例：副本直播擋潛行）；引擎只留著，宿主自己問條件 live_on */
  blocks?: string[]
  start_heat?: 'fame_tier'
}

/** MEDIA 1.2 的表：戰鬥直播、副本直播、成人直播。「有人只剩一口氣」現在的事件標籤對不出來，沒有列（回報裡有）。 */
export const DEFAULT_TEMPLATES: TemplateEntry[] = [
  {
    id: 'st_combat', name: '戰鬥直播', scope: 'combat',
    highlights: [{ event: 'crit', heat: 1 }, { event: 'overload_foe', heat: 1 }, { event: 'foe_down', heat: 1 }],
    goals: { pick: [1, 3] }, risk: { hostility_mult: 1.5 },
  },
  {
    id: 'st_commission', name: '副本直播', scope: 'commission',
    highlights: [{ event: 'stage_done', heat: 1 }, { event: 'branch', heat: 1 }, { event: 'battle_won', heat: 1 }, { event: 'battle_lost', heat: 1 }],
    goals: 'host', blocks: ['stealth_branch'],
  },
  {
    id: 'st_adult', name: '成人直播', scope: 'adult',
    highlights: [{ event: 'scene_act', heat: 1 }], max_from: { scene_act: DEFAULT_LIVE_RULES.adult_cap },
    goals: { pick: [1, 3] }, start_heat: 'fame_tier',
  },
]

const textList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 40 && v.every(isText)

export function templateProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是模板的名字')
  if (!(SCOPES as readonly unknown[]).includes(e.scope)) p.push(`scope 要是 ${SCOPES.join('、')} 其中一個`)
  if (!Array.isArray(e.highlights)) p.push('highlights 要是亮點的陣列 [{ event, heat }]')
  else {
    e.highlights.forEach((h, i) => {
      if (!isRecord(h)) p.push(`highlights[${i}] 要是 { event, heat }`)
      else {
        if (!(EVENTS as readonly unknown[]).includes(h.event)) p.push(`highlights[${i}].event 要是 ${EVENTS.join('、')} 其中一個`)
        if (!isSafeInt(h.heat) || h.heat < 0 || h.heat > 100) p.push(`highlights[${i}].heat 要是 0～100 的整數`)
      }
    })
    const seen = new Set<unknown>()
    for (const h of e.highlights) if (isRecord(h)) { if (seen.has(h.event)) p.push(`highlights 的 ${String(h.event)} 重複了`); seen.add(h.event) }
  }
  if (e.max_from !== undefined) {
    if (!isRecord(e.max_from)) p.push('max_from 要是 { 事件: 上限 }')
    else for (const [ev, n] of Object.entries(e.max_from)) {
      if (!(EVENTS as readonly unknown[]).includes(ev)) p.push(`max_from 的 ${ev} 不是事件的名字`)
      if (!isSafeInt(n) || n < 0 || n > 10000) p.push(`max_from.${ev} 要是 0～10000 的整數`)
    }
  }
  const g = e.goals
  if (g === undefined) p.push("goals 要寫 { pick: [最少, 最多] } 或 'host'")
  else if (g !== 'host') {
    const pick = isRecord(g) ? g.pick : undefined
    if (!Array.isArray(pick) || pick.length !== 2 || !pick.every((n) => isSafeInt(n) && n >= 0 && n <= 10) || (pick[0] as number) > (pick[1] as number)) p.push("goals 要是 { pick: [最少, 最多] }（0～10 的整數）或 'host'")
  }
  if (e.risk !== undefined) {
    if (!isRecord(e.risk)) p.push('risk 要是 { hostility_mult? }')
    else if (e.risk.hostility_mult !== undefined && !(finite(e.risk.hostility_mult) && e.risk.hostility_mult >= 1 && e.risk.hostility_mult <= 10)) p.push('risk.hostility_mult 要是 1～10 的數字')
  }
  if (e.blocks !== undefined && !textList(e.blocks)) p.push('blocks 要是字串的陣列')
  if (e.start_heat !== undefined && e.start_heat !== 'fame_tier') p.push("start_heat 只能是 'fame_tier'")
  return p
}

const readTemplate = (e: Record<string, unknown>): TemplateEntry => ({
  id: String(e.id), name: String(e.name), scope: e.scope as Scope,
  highlights: (e.highlights as Array<{ event: string; heat: number }>).map((h) => ({ event: h.event, heat: h.heat })),
  ...(isRecord(e.max_from) ? { max_from: { ...(e.max_from as Record<string, number>) } } : {}),
  goals: e.goals === 'host' ? 'host' : { pick: [...(e.goals as { pick: [number, number] }).pick] as [number, number] },
  ...(isRecord(e.risk) ? { risk: { ...(e.risk as { hostility_mult?: number }) } } : {}),
  ...(Array.isArray(e.blocks) ? { blocks: [...(e.blocks as string[])] } : {}),
  ...(e.start_heat === 'fame_tier' ? { start_heat: 'fame_tier' as const } : {}),
})

/** 現在的每一筆模板：內建三筆，資料同 id 整筆蓋掉、新 id 加在後面、格式不對的忽略。 */
export function templatesOf(k: Pick<Kernel, 'content'>): TemplateEntry[] {
  const out = new Map<string, TemplateEntry>(DEFAULT_TEMPLATES.map((t) => [t.id, readTemplate(t as unknown as Record<string, unknown>)]))
  if (k.content.hasKind(TEMPLATE_KIND)) {
    for (const e of k.content.list(TEMPLATE_KIND)) if (templateProblems(e).length === 0) out.set(e.id, readTemplate(e))
  }
  return [...out.values()]
}

/** 這個範圍用哪一筆模板：預設那筆的 id（被資料蓋掉也算）優先，其次這個範圍的第一筆。 */
export function templateFor(k: Pick<Kernel, 'content'>, scope: Scope): TemplateEntry | null {
  const all = templatesOf(k)
  return all.find((t) => t.id === DEFAULT_TEMPLATE_ID[scope] && t.scope === scope) ?? all.find((t) => t.scope === scope) ?? null
}

export const templateById = (k: Pick<Kernel, 'content'>, id: string): TemplateEntry | null => templatesOf(k).find((t) => t.id === id) ?? null

// ---- 直播目標 ----

export interface GoalCheck { event: string; count_min?: number; count_max?: number }

export interface GoalEntry {
  id: string
  text: string
  scope: Scope[]
  check: GoalCheck
  heat?: number
  tip_per_grade?: number
  channel?: string
}

export const GOAL_CHANNELS = ['adult', 'news', 'gossip', 'underground'] as const

export function goalProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.text)) p.push('text 要是目標的一句話')
  if (!Array.isArray(e.scope) || e.scope.length === 0 || !e.scope.every((s) => (SCOPES as readonly unknown[]).includes(s))) p.push(`scope 要是 ${SCOPES.join('、')} 的陣列（至少一個）`)
  const c = e.check
  if (!isRecord(c)) p.push('check 要是 { event, count_min?, count_max? }')
  else {
    if (!(EVENTS as readonly unknown[]).includes(c.event)) p.push(`check.event 要是 ${EVENTS.join('、')} 其中一個`)
    for (const f of ['count_min', 'count_max'] as const) if (c[f] !== undefined && !(isSafeInt(c[f]) && (c[f] as number) >= 0)) p.push(`check.${f} 要是 0 以上的整數`)
    if (c.count_min === undefined && c.count_max === undefined) p.push('check 要寫 count_min 或 count_max（至少一個）')
    if (isSafeInt(c.count_min) && isSafeInt(c.count_max) && c.count_min > c.count_max) p.push('check.count_min 不能大於 count_max')
  }
  if (e.heat !== undefined && !(isSafeInt(e.heat) && e.heat >= 0 && e.heat <= 100)) p.push('heat 要是 0～100 的整數')
  if (e.tip_per_grade !== undefined && !(isSafeInt(e.tip_per_grade) && e.tip_per_grade >= 0 && e.tip_per_grade <= 1_000_000)) p.push('tip_per_grade 要是 0 以上的整數')
  if (e.channel !== undefined && !(GOAL_CHANNELS as readonly unknown[]).includes(e.channel)) p.push(`channel 要是 ${GOAL_CHANNELS.join('、')} 其中一個`)
  return p
}

export function readGoal(e: ContentEntry): GoalEntry | null {
  if (goalProblems(e).length > 0) return null
  const c = e.check as Record<string, unknown>
  return {
    id: e.id, text: e.text as string, scope: [...(e.scope as Scope[])],
    check: { event: c.event as string, ...(c.count_min !== undefined ? { count_min: c.count_min as number } : {}), ...(c.count_max !== undefined ? { count_max: c.count_max as number } : {}) },
    ...(e.heat !== undefined ? { heat: e.heat as number } : {}), ...(e.tip_per_grade !== undefined ? { tip_per_grade: e.tip_per_grade as number } : {}),
    ...(typeof e.channel === 'string' ? { channel: e.channel } : {}),
  }
}

/** 一條目標在這些次數下達成了嗎。 */
export const goalMet = (check: GoalCheck, counts: Record<string, number>): boolean => {
  const n = own(counts, check.event) ? counts[check.event]! : 0
  return (check.count_min === undefined || n >= check.count_min) && (check.count_max === undefined || n <= check.count_max)
}

/** 只有「最多幾次」的目標（沒打完之前都還是可能成立，提早收播不算它達成）。 */
export const capOnly = (check: GoalCheck): boolean => check.count_min === undefined && check.count_max !== undefined

// ---- 狀態 ----

export interface GoalRow {
  id: string
  text: string
  /** 達成時加的熱度 */
  heat: number
  /** 達成時的打賞（tip_per_grade × 等級，開播時定好） */
  tip: number
  done: boolean
  check: GoalCheck
}

export interface Highlight { event: string; heat: number; report: string }

/** 內場、迷宮館的參數（第三波才有人給）：觀看數的倍率、打賞的倍率、進不進頻道。 */
export interface House { views_mult: number; tips_mult: number; to_channel: boolean }

/** 開播時選用的鏡頭（掛點 media.cameras 回的一筆）：視角就是這場直播的視角 */
export interface SessionCamera {
  id: string
  label: string
  pov: { kind: string; who?: string }
  pov_text: string
  by: string
  grade: number
  /** 主角自己的錄影義體：第一人稱直播 */
  first_person: boolean
}

export interface Session {
  id: string
  mode: Mode
  template: string
  host?: { kind: HostKind; id: string }
  by: string
  where: ReportLocation
  heat: number
  goals: GoalRow[]
  highlights: Highlight[]
  counts: Record<string, number>
  /** 每一種事件已經給了多少熱度（max_from 的上限用它算；亮點清單會被截短，不能拿來加） */
  from: Record<string, number>
  /** 目前為止的打賞（= 熱度 × 每點熱度的打賞；達成的目標另外在收播時加） */
  tips: number
  secret?: true
  house?: House
  faction?: string
  grade?: number
  /** 選用的鏡頭（沒裝 media 就沒有） */
  camera?: SessionCamera
  // 以下只有時段直播（mode: 'slot'）有（M5-live-slot）
  /** 種類與時長（小時） */
  kind?: SlotKind
  hours?: number
  /** 玩家選的標籤（最多兩個）與表演的方向；沒給就是空的、沒有方向 */
  plan?: SlotPlan
  /** 開播那一擲：骰面、合計、難度、成功程度、檢定換的熱度 */
  roll?: SlotRoll
  /** 這一場熱度的上限（12；穩著播是 6） */
  cap?: number
  /** 前一半的時間已經過了（開播那一份推進一半、收播推進另一半） */
  half_done?: boolean
}

export interface SlotPlan { tags: string[]; direction?: SlotDirection }
export interface SlotRoll { natural: number; total: number; dc: number; degree: string; gain: number }

export interface Settled {
  id: string
  at: number
  mode: Mode
  template: string
  heat: number
  subs: number
  tips: number
  goals_done: number
  /** 留下了一則紀錄 */
  record?: true
  lost?: true
  // 以下是補回去（回到快照）時要原樣再發一次 activity.end 用的
  viewers?: number
  tier?: string
  grade?: number
  off_channel?: true
}

export interface LiveState {
  session: Session | null
  seq: number
  log: Settled[]
}

export const blankLive = (): LiveState => ({ session: null, seq: 0, log: [] })

const numRecord = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (isRecord(v)) for (const [key, n] of Object.entries(v)) if (own(v, key) && key !== '__proto__' && isSafeInt(n) && n >= 0) out[key] = n
  return out
}

const readCheck = (v: unknown): GoalCheck | null => {
  if (!isRecord(v) || !isText(v.event)) return null
  return { event: v.event, ...(isSafeInt(v.count_min) ? { count_min: v.count_min } : {}), ...(isSafeInt(v.count_max) ? { count_max: v.count_max } : {}) }
}

const readGoalRow = (v: unknown): GoalRow | null => {
  if (!isRecord(v) || !isText(v.id)) return null
  const check = readCheck(v.check)
  if (!check) return null
  return { id: v.id, text: typeof v.text === 'string' ? v.text : v.id, heat: nat(v.heat), tip: nat(v.tip), done: v.done === true, check }
}

function readHouse(v: unknown): House | undefined {
  if (!isRecord(v)) return undefined
  const m = (x: unknown): number => (finite(x) && x >= 0 && x <= 100 ? x : 1)
  return { views_mult: m(v.views_mult), tips_mult: m(v.tips_mult), to_channel: v.to_channel !== false }
}

function readSession(v: unknown): Session | null {
  if (!isRecord(v) || !isText(v.id) || !(MODES as readonly unknown[]).includes(v.mode) || !isText(v.template) || !isText(v.by)) return null
  const host = isRecord(v.host) && (HOST_KINDS as readonly unknown[]).includes(v.host.kind) && isText(v.host.id) ? { kind: v.host.kind as HostKind, id: v.host.id } : undefined
  const house = readHouse(v.house)
  return {
    id: v.id, mode: v.mode as Mode, template: v.template, ...(host ? { host } : {}), by: v.by, where: isRecord(v.where) ? (JSON.parse(JSON.stringify(v.where)) as ReportLocation) : {},
    heat: nat(v.heat), goals: (Array.isArray(v.goals) ? v.goals : []).map(readGoalRow).filter((g): g is GoalRow => g !== null),
    highlights: (Array.isArray(v.highlights) ? v.highlights : []).flatMap((h): Highlight[] => (isRecord(h) && isText(h.event) && isSafeInt(h.heat) ? [{ event: h.event, heat: h.heat, report: typeof h.report === 'string' ? h.report : '' }] : [])),
    counts: numRecord(v.counts), from: numRecord(v.from), tips: nat(v.tips),
    ...(v.secret === true ? { secret: true as const } : {}), ...(house ? { house } : {}),
    ...(isText(v.faction) ? { faction: v.faction } : {}), ...(isSafeInt(v.grade) && v.grade >= 1 ? { grade: v.grade } : {}),
    ...readCamera(v.camera),
    ...readSlotFields(v),
  }
}

function readCamera(v: unknown): { camera?: SessionCamera } {
  if (!isRecord(v) || !isText(v.id) || !isText(v.by) || !isRecord(v.pov) || !isText(v.pov.kind)) return {}
  return {
    camera: {
      id: v.id, label: typeof v.label === 'string' ? v.label : v.id, pov: { kind: v.pov.kind, ...(isText(v.pov.who) ? { who: v.pov.who } : {}) },
      pov_text: typeof v.pov_text === 'string' ? v.pov_text : v.pov.kind, by: v.by, grade: finite(v.grade) ? v.grade : 1, first_person: v.first_person === true,
    },
  }
}

/** 時段直播的欄位（種類、時長、plan、擲骰、上限、前一半）：形狀不對的欄位當沒有。 */
function readSlotFields(v: Record<string, unknown>): Partial<Session> {
  const out: Partial<Session> = {}
  if ((SLOT_KINDS as readonly unknown[]).includes(v.kind)) out.kind = v.kind as SlotKind
  if (isSafeInt(v.hours) && v.hours >= 1 && v.hours <= 9) out.hours = v.hours
  if (isRecord(v.plan)) {
    const dir = (SLOT_DIRECTIONS as readonly unknown[]).includes(v.plan.direction) ? (v.plan.direction as SlotDirection) : undefined
    out.plan = { tags: Array.isArray(v.plan.tags) ? v.plan.tags.filter(isText) : [], ...(dir ? { direction: dir } : {}) }
  }
  if (isRecord(v.roll) && finite(v.roll.natural) && finite(v.roll.total) && finite(v.roll.dc) && isText(v.roll.degree)) {
    out.roll = { natural: v.roll.natural, total: v.roll.total, dc: v.roll.dc, degree: v.roll.degree, gain: finite(v.roll.gain) ? v.roll.gain : 0 }
  }
  if (isSafeInt(v.cap) && v.cap >= 0) out.cap = v.cap
  if (typeof v.half_done === 'boolean') out.half_done = v.half_done
  return out
}

function readSettled(v: unknown): Settled | null {
  if (!isRecord(v) || !isText(v.id) || !isSafeInt(v.at) || !(MODES as readonly unknown[]).includes(v.mode) || !isText(v.template)) return null
  return {
    id: v.id, at: v.at, mode: v.mode as Mode, template: v.template, heat: nat(v.heat), subs: isSafeInt(v.subs) ? v.subs : 0, tips: nat(v.tips), goals_done: nat(v.goals_done),
    ...(v.record === true ? { record: true as const } : {}), ...(v.lost === true ? { lost: true as const } : {}),
    ...(isSafeInt(v.viewers) && v.viewers >= 0 ? { viewers: v.viewers } : {}), ...(isText(v.tier) ? { tier: v.tier } : {}), ...(isSafeInt(v.grade) && v.grade >= 1 ? { grade: v.grade } : {}),
    ...(v.off_channel === true ? { off_channel: true as const } : {}),
  }
}

/** 讀 state.ext.live：沒有、或形狀不對的部分當成空的（回傳的是新物件，改它不會動到狀態）。 */
export function readLive(state: Pick<GameState, 'ext'>): LiveState {
  const raw = state.ext?.[EXT]
  const r = isRecord(raw) ? raw : {}
  return {
    session: readSession(r.session), seq: nat(r.seq),
    log: (Array.isArray(r.log) ? r.log : []).map(readSettled).filter((e): e is Settled => e !== null),
  }
}

/** 寫回的值（ext 變更用）。 */
export const liveValue = (l: LiveState): LiveState => JSON.parse(JSON.stringify(l)) as LiveState

export const liveSession = (state: Pick<GameState, 'ext'>): Session | null => readLive(state).session

// ---- 觀看數與換算 ----

export const VIEWER_TIERS = ['cold', 'hot', 'blast'] as const
export type ViewerTier = (typeof VIEWER_TIERS)[number]
export const VIEWER_TIER_NAME: Record<ViewerTier, string> = { cold: '冷清', hot: '熱', blast: '爆' }

export interface Viewers {
  /** 基本盤：訂閱 × base_pct%，最少 base_min */
  base: number
  /** 熱度帶來的倍率（1 ＋ per_heat × 熱度；熱度算到 heat_cap 為止） */
  mult: number
  viewers: number
  tier: ViewerTier
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** 觀看數的式子（MEDIA 1.2）：純函式，吃訂閱與熱度。viewsMult 是內場、迷宮館的倍率（只乘觀看數，不改級距）。 */
export function viewersFrom(rules: LiveRules, subs: number, heat: number, viewsMult = 1): Viewers {
  const v = rules.viewers
  const base = Math.max(v.base_min, Math.floor((Math.max(0, subs) * v.base_pct) / 100 + 1e-9))
  const mult = round6(1 + v.per_heat * Math.min(Math.max(0, heat), v.heat_cap))
  const tier: ViewerTier = mult <= rules.tiers[0] ? 'cold' : mult >= rules.tiers[1] ? 'blast' : 'hot'
  return { base, mult, viewers: Math.floor(base * mult * viewsMult + 1e-9), tier }
}

/** 現在的觀看數：訂閱讀量表 subs（沒有人定義是 0）；heat 沒給用這一場的熱度（沒在直播是 0）。 */
export function viewersOf(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, heat?: number): Viewers {
  const s = liveSession(state)
  return viewersFrom(liveRules(k), meterOf(k, state, 'subs'), heat ?? s?.heat ?? 0, s?.house?.views_mult ?? 1)
}

/** 熱度換成訂閱：熱度 × heat_subs ＋ 觀看數 ÷ views_div（捨去）。 */
export const subsOfHeat = (rules: LiveRules, heat: number, viewers: number): number => heat * rules.heat_subs + Math.floor(viewers / rules.views_div)

// ---- 小工具 ----

/** 隊伍裡這個衍生數值最高的那個人的值（沒有人定義是 0）。 */
export function partyMax(k: Pick<Kernel, 'stats'>, state: GameState, stat: string): number {
  if (!k.stats.hasStat(stat)) return 0
  let top = 0
  for (const id of state.party) if (state.actors[id]) top = Math.max(top, k.stats.stat(state, id, stat))
  return Math.max(0, Math.floor(top))
}

/** 主角各區豔名最高那一區的級數（每 fame_step 點一級；沒有豔名量表是 0）。 */
export function fameLevel(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, rules: LiveRules): number {
  if (!k.meters.has('fame')) return 0
  let top = 0
  if (k.content.hasKind('district')) for (const d of k.content.list('district')) top = Math.max(top, meterOf(k, state, 'fame', d.id))
  else top = meterOf(k, state, 'fame')
  return Math.floor(top / rules.fame_step)
}
