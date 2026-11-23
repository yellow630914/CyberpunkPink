// L6 功能 work 的資料與純函式：內容的型別與格式檢查、規則（內建的預設加資料蓋掉）、狀態的形狀（state.ext.work）、階段與查詢。
// 規格：DOWNTIME 第 4 節（4.1 的表只看欄位、4.1a 階段、4.2 結算）；EVENTS 3.1 節（work）、3.3 節打工那一列；AI_TASKS 3.13 節（只看程式的步驟）；
// LEWD_SYSTEM 第 9 節；UI 3.12 節；dev/adr/0016 第六節與 G15；dev/work/M2-work.md。
//
// 不碰登錄表（登記在 index.ts）。
//
// 內容種類：
//   job       { id, name, facility, district?, employer?: npc, check?: { attr, skill?, dc }, wage, pay: 'cred' | 'cash',
//               days?: { weekday?: [0～6], time?: [時段] }, perks?: 效果[], stages: [{ name, mult, perks?, need?, adult?, tags? }] }
//             facility 寫設施的種類（facility_type 的 id），或寫某一間：「街區 id/標記 id」（例：b_hive/F2；所以種類的 id 不能有斜線）；
//             check 沒寫就是不擲（當成功）；dc 是整數或階梯的名字（easy、normal……）；
//             stages 兩個或三個，第一個沒有 need，其餘都要有 need: { shifts, affinity, extra?: 條件 }（shifts 是這份工作總共做滿幾班）；
//             adult 與 tags：這個階段用到的題材；tags 裡有被玩家關掉的，這一階不問、停在前一階
//   work_rule { id: 'default', hours, degree_mult, fumble_affinity }：蓋掉下面 DEFAULT_WORK_RULES 的數字
//
// 狀態 state.ext.work：{ jobs: { [工作 id]: { shifts, stage, asked, last } }, announce }（形狀見 WorkState）。

import type { Condition, ContentEntry, Degree, GameState, Kernel, SegmentId, Weekday } from '../../core'
import { ATTR_IDS, DC_TIERS, SEGMENT_IDS, isRecord, isSafeInt, segmentOf, segmentWeekdayOf, tagsAllowed } from '../../core'

export const OWNER = 'work'
/** state.ext 的鍵 */
export const EXT = 'work'
export const JOB_KIND = 'job'
export const RULE_KIND = 'work_rule'
export const BLOCK_KIND = 'block'
export const FACILITY_TYPE_KIND = 'facility_type'
/** 打工的行動前綴（報告的 action 是 work.shift 與 work.promote） */
export const SHIFT_ACTION = 'work.shift'
export const PROMOTE_ACTION = 'work.promote'
/** 觸發點（EVENTS 3.1 節） */
export const WORK_POINT = 'work'
/** 成功程度，由好到壞 */
export const DEGREES: readonly Degree[] = ['critical', 'success', 'fail', 'fumble']
export const MAX_STAGES = 3
export const POOL_NAME = { cred: '帳戶', cash: '現金' } as const
export type Pool = keyof typeof POOL_NAME

export const SEGMENT_TEXT: Record<SegmentId, string> = { dawn: '清晨', morning: '上午', noon: '中午', afternoon: '下午', prime: '黃金時段', late: '深夜' }
export const WEEKDAY_TEXT = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'] as const

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 內容的型別 ----

export interface StageNeed {
  /** 這份工作總共做滿幾班 */
  shifts: number
  /** 雇主的親密度到幾 */
  affinity: number
  /** 另外的條件（那一區的豔名、某個標籤、或一件事件做過） */
  extra?: Condition | Condition[]
}

export interface StageDef {
  name: string
  /** 時薪的倍率 */
  mult: number
  /** 這一階每班多的附帶效果 */
  perks?: Array<Record<string, unknown>>
  need?: StageNeed
  adult?: boolean
  tags?: string[]
}

export interface JobCheck {
  attr: (typeof ATTR_IDS)[number]
  skill?: string
  dc: number | keyof typeof DC_TIERS
}

export interface JobEntry extends ContentEntry {
  name: string
  facility: string
  district?: string
  employer?: string
  check?: JobCheck
  wage: number
  pay: Pool
  days?: { weekday?: Weekday[]; time?: SegmentId[] }
  perks?: Array<Record<string, unknown>>
  stages: StageDef[]
}

// ---- 規則 ----

export interface WorkRules {
  /** 一班可以選幾小時（DOWNTIME 4.2、EVENTS 3.3：2、4、8） */
  hours: number[]
  /** 成功程度的倍率（DOWNTIME 4.2） */
  degree_mult: Record<Degree, number>
  /** 大失敗時雇主親密度減多少（DOWNTIME 4.2：3） */
  fumble_affinity: number
}

export const DEFAULT_WORK_RULES: WorkRules = {
  hours: [2, 4, 8],
  degree_mult: { critical: 1.5, success: 1, fail: 0.5, fumble: 0 },
  fumble_affinity: 3,
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.hours !== undefined) {
    const h = e.hours
    if (!(Array.isArray(h) && h.length > 0 && h.every((x) => isSafeInt(x) && x >= 1 && x <= 24) && new Set(h).size === h.length)) p.push('hours 要是 1～24 的整數陣列（不重複，至少一個）')
  }
  if (e.degree_mult !== undefined) {
    if (!isRecord(e.degree_mult)) p.push('degree_mult 要是 { critical, success, fail, fumble }')
    else {
      for (const [key, v] of Object.entries(e.degree_mult)) {
        if (!(DEGREES as readonly string[]).includes(key)) p.push(`degree_mult.${key}：成功程度只有 ${DEGREES.join('、')}`)
        else if (!(isNum(v) && v >= 0 && v <= 10)) p.push(`degree_mult.${key} 要是 0～10 的數字`)
      }
    }
  }
  if (e.fumble_affinity !== undefined && !(isSafeInt(e.fumble_affinity) && e.fumble_affinity >= 0 && e.fumble_affinity <= 100)) p.push('fumble_affinity 要是 0～100 的整數')
  return p
}

/** 現在生效的規則：資料 work_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function workRules(k: Pick<Kernel, 'content'>): WorkRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: WorkRules = { hours: [...DEFAULT_WORK_RULES.hours], degree_mult: { ...DEFAULT_WORK_RULES.degree_mult }, fumble_affinity: DEFAULT_WORK_RULES.fumble_affinity }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  if (e.hours !== undefined && !bad.has('hours')) out.hours = [...(e.hours as number[])].sort((a, b) => a - b)
  if (e.fumble_affinity !== undefined && !bad.has('fumble_affinity')) out.fumble_affinity = e.fumble_affinity as number
  if (isRecord(e.degree_mult)) {
    for (const d of DEGREES) {
      const v = (e.degree_mult as Record<string, unknown>)[d]
      if (isNum(v) && v >= 0 && v <= 10) out.degree_mult[d] = v
    }
  }
  return out
}

// ---- 內容的格式檢查（單筆；效果與條件的種類要有人註冊，等 ready 才查） ----

const isEffectList = (v: unknown): v is Array<Record<string, unknown>> => Array.isArray(v) && v.every((x) => isRecord(x) && isText(x.kind))

export function jobProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.facility)) p.push('要有 facility（設施的種類，或「街區 id/標記 id」）')
  if (e.district !== undefined && !isText(e.district)) p.push('district 要是區的 id')
  if (e.employer !== undefined && !isText(e.employer)) p.push('employer 要是 NPC 的 id')
  if (e.check !== undefined) {
    const c = e.check
    if (!isRecord(c)) p.push('check 要是 { attr, skill?, dc }（不擲就不要寫）')
    else {
      if (!(ATTR_IDS as readonly unknown[]).includes(c.attr)) p.push(`check.attr 要是 ${ATTR_IDS.join('、')} 其中一個`)
      if (c.skill !== undefined && !isText(c.skill)) p.push('check.skill 要是基本功的 id')
      const dcOk = (isSafeInt(c.dc) && c.dc >= 1 && c.dc <= 40) || (typeof c.dc === 'string' && Object.prototype.hasOwnProperty.call(DC_TIERS, c.dc))
      if (!dcOk) p.push(`check.dc 要是 1～40 的整數或階梯的名字（${Object.keys(DC_TIERS).join('、')}）`)
    }
  }
  if (!(isSafeInt(e.wage) && e.wage >= 0)) p.push('wage（時薪）要是 0 以上的整數')
  if (e.pay !== 'cred' && e.pay !== 'cash') p.push("pay 要是 'cred' 或 'cash'")
  if (e.days !== undefined) {
    const d = e.days
    if (!isRecord(d)) p.push('days 要是 { weekday?, time? }')
    else {
      if (d.weekday !== undefined && !(Array.isArray(d.weekday) && d.weekday.length > 0 && d.weekday.every((x) => isSafeInt(x) && x >= 0 && x <= 6))) p.push('days.weekday 要是 0～6 的陣列（0 是週一）')
      if (d.time !== undefined && !(Array.isArray(d.time) && d.time.length > 0 && d.time.every((x) => (SEGMENT_IDS as readonly unknown[]).includes(x)))) p.push(`days.time 要是時段 id 的陣列（${SEGMENT_IDS.join('、')}）`)
    }
  }
  if (e.perks !== undefined && !isEffectList(e.perks)) p.push('perks 要是效果（物件，要有 kind）的陣列')
  if (!Array.isArray(e.stages) || e.stages.length < 2 || e.stages.length > MAX_STAGES) {
    p.push(`stages 要有 2 或 ${MAX_STAGES} 個階段`)
    return p
  }
  e.stages.forEach((s, i) => {
    const at = `stages[${i}]`
    if (!isRecord(s)) return void p.push(`${at}：要是一個物件`)
    if (!isText(s.name)) p.push(`${at}：要有 name`)
    if (!(isNum(s.mult) && s.mult > 0 && s.mult <= 20)) p.push(`${at}.mult 要是大於 0 的數字（時薪的倍率）`)
    if (s.perks !== undefined && !isEffectList(s.perks)) p.push(`${at}.perks 要是效果（物件，要有 kind）的陣列`)
    if (s.adult !== undefined && typeof s.adult !== 'boolean') p.push(`${at}.adult 要是 true 或 false`)
    if (s.tags !== undefined && !(Array.isArray(s.tags) && s.tags.every(isText))) p.push(`${at}.tags 要是標籤的陣列`)
    if (i === 0) {
      if (s.need !== undefined) p.push(`${at}：第一個階段一開始就是，不能有 need`)
    } else if (!isRecord(s.need)) p.push(`${at}：要有 need: { shifts, affinity }（怎麼升上來）`)
    else {
      if (!(isSafeInt(s.need.shifts) && s.need.shifts >= 1)) p.push(`${at}.need.shifts 要是 1 以上的整數`)
      if (!(isSafeInt(s.need.affinity) && s.need.affinity >= -100 && s.need.affinity <= 100)) p.push(`${at}.need.affinity 要是 −100～100 的整數`)
      if (s.need.extra !== undefined && !(isRecord(s.need.extra) || (Array.isArray(s.need.extra) && s.need.extra.every(isRecord)))) p.push(`${at}.need.extra 要是條件（或條件的陣列）`)
    }
  })
  return p
}

// ---- 狀態 ----

export interface LastShift {
  hours: number
  /** 沒有檢定的工作是 null（當成功） */
  degree: Degree | null
  /** 實際領到的錢 */
  amount: number
  pay: Pool
  /** 做的時候是第幾階段（從 1 起算） */
  stage: number
  /** 做完的時間（總分鐘） */
  at: number
}

export interface JobState {
  /** 這份工作做滿了幾班 */
  shifts: number
  /** 升到第幾階段（從 0 起算） */
  stage: number
  /** 這一階升階的事件問過了沒有（升了之後重新算） */
  asked: boolean
  last: LastShift | null
}

export interface WorkState {
  jobs: Record<string, JobState>
  /** 剛升階、還沒寫 work.promote 的那一份報告（報告掛鉤寫完就清掉） */
  announce: { job: string; from: number; to: number } | null
}

export const blankJob = (): JobState => ({ shifts: 0, stage: 0, asked: false, last: null })
export const blankWork = (): WorkState => ({ jobs: {}, announce: null })

function readLast(raw: unknown): LastShift | null {
  if (!isRecord(raw)) return null
  const degree = raw.degree === null ? null : (DEGREES as readonly unknown[]).includes(raw.degree) ? (raw.degree as Degree) : undefined
  if (degree === undefined || !isSafeInt(raw.hours) || !isSafeInt(raw.amount) || !isSafeInt(raw.stage) || !isSafeInt(raw.at)) return null
  if (raw.pay !== 'cred' && raw.pay !== 'cash') return null
  return { hours: raw.hours, degree, amount: raw.amount, pay: raw.pay, stage: raw.stage, at: raw.at }
}

/** 讀 state.ext.work：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function readWork(state: Pick<GameState, 'ext'>): WorkState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const jobs: Record<string, JobState> = {}
  if (isRecord(r.jobs)) {
    for (const [id, j] of Object.entries(r.jobs)) {
      if (!isRecord(j)) continue
      jobs[id] = {
        shifts: isSafeInt(j.shifts) && j.shifts > 0 ? j.shifts : 0,
        stage: isSafeInt(j.stage) && j.stage > 0 ? j.stage : 0,
        asked: j.asked === true,
        last: readLast(j.last),
      }
    }
  }
  const a = r.announce
  const announce = isRecord(a) && isText(a.job) && isSafeInt(a.from) && isSafeInt(a.to) ? { job: a.job, from: a.from, to: a.to } : null
  return { jobs, announce }
}

export const jobStateOf = (state: Pick<GameState, 'ext'>, id: string): JobState => readWork(state).jobs[id] ?? blankJob()

// ---- 查詢 ----

type Cx = Pick<Kernel, 'content'>

export const jobEntry = (k: Cx, id: string | undefined): JobEntry | undefined => (id ? k.content.get<JobEntry>(JOB_KIND, id) : undefined)

/**
 * 現在實際在第幾階段（從 0 起算）：記下來的階段，往上數到第一個用到被玩家關掉的題材（tags）的階段為止（那一階和後面的都不算）。
 * 第一個階段永遠算。
 */
export function effectiveStage(rules: Pick<GameState['rules'], 'contentOff'>, job: JobEntry, stored: number): number {
  let at = 0
  while (at < stored && at + 1 < job.stages.length && tagsAllowed(rules, job.stages[at + 1]!.tags)) at += 1
  return at
}

/** 那一階（從 0 起算）有沒有因為內容篩選被關掉（它或前面的階段用到被關掉的題材）。 */
export function stageHidden(rules: Pick<GameState['rules'], 'contentOff'>, job: JobEntry, index: number): boolean {
  for (let i = 1; i <= index; i++) if (!tagsAllowed(rules, job.stages[i]?.tags)) return true
  return false
}

const facilityTypeName = (k: Cx, type: string): string => k.content.get<ContentEntry & { name?: string }>(FACILITY_TYPE_KIND, type)?.name ?? type

/** 工作的 facility 寫成給玩家看的名字（種類的名字，或那一間設施的名字）。 */
export function facilityLabel(k: Cx, facility: string): string {
  const slash = facility.indexOf('/')
  if (slash < 0) return facilityTypeName(k, facility)
  const b = k.content.get<ContentEntry & { facilities?: Record<string, { name?: unknown }> }>(BLOCK_KIND, facility.slice(0, slash))
  const f = b && isRecord(b.facilities) ? b.facilities[facility.slice(slash + 1)] : undefined
  return f && isText(f.name) ? f.name : facility
}

/** 現在站的設施：街區、標記、種類（讀 world 的 block 內容；沒有世界或不在設施上是 null）。 */
export function facilityHere(k: Cx, state: Pick<GameState, 'location'>): { block: string; marker: string; type: string; name: string } | null {
  const { block, facility } = state.location
  if (!block || !facility) return null
  const b = k.content.get<ContentEntry & { facilities?: Record<string, { type?: unknown; name?: unknown }> }>(BLOCK_KIND, block)
  const f = b && isRecord(b.facilities) ? b.facilities[facility] : undefined
  if (!f || !isText(f.type)) return null
  return { block, marker: facility, type: f.type, name: isText(f.name) ? f.name : f.type }
}

/** 現在站的就是這份工作的設施嗎（種類對上，或「街區/標記」對上那一間）。 */
export function jobAtFacility(k: Cx, state: Pick<GameState, 'location'>, job: Pick<JobEntry, 'facility'>): boolean {
  const here = facilityHere(k, state)
  if (!here) return false
  return job.facility.includes('/') ? job.facility === `${here.block}/${here.marker}` : job.facility === here.type
}

/** 這個位置能做的工作：設施對上，而且（工作寫了區的話）在那一區。 */
export function jobsAt(k: Cx, state: Pick<GameState, 'location'>): JobEntry[] {
  return k.content.list<JobEntry>(JOB_KIND).filter((j) => jobAtFacility(k, state, j) && (j.district === undefined || j.district === state.location.district))
}

/** 日子與時段對不對：回傳不對的原因（給玩家看的完整句子），對是 null。 */
export function daysBlock(k: Pick<Kernel, 'timeRules'>, state: Pick<GameState, 'time'>, job: JobEntry): string | null {
  const d = job.days
  if (!d) return null
  const weekdayOk = !d.weekday || d.weekday.includes(segmentWeekdayOf(state.time, k.timeRules))
  const timeOk = !d.time || d.time.includes(segmentOf(state.time, k.timeRules))
  if (weekdayOk && timeOk) return null
  const when = `${d.weekday ? d.weekday.map((w) => WEEKDAY_TEXT[w]).join('、') : ''}${d.time ? d.time.map((s) => SEGMENT_TEXT[s]).join('、') : ''}`
  return `${job.name}只在${when}才開，現在沒開。`
}
