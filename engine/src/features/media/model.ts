// L6 功能 media 的資料與純函式：狀態的形狀（state.ext.media）、規則（內建的預設加資料蓋掉）、讀取與寫入的變更、算式。
// 規格：MEDIA 1.1 節、第 2 節、2.1 節；EVENTS 2.4 節的 footage；DATA 第 11 節；dev/adr/0020 第一節、第十三節、V1～V6、V54、V57；dev/work/M5-media-chain.md。
//
// 內容種類：
//   media_rule  { id: 'default', source_type, quality, draw, trust, risk, fame_step, old_days, fresh_days, uses }：蓋掉下面 DEFAULT_MEDIA_RULES 的數字（規則表，overridable）
//
// 狀態 state.ext.media（形狀見 MediaState）。**只經由下面這幾種變更改**（ops.ts 註冊；一份報告可以疊好幾筆，不會互相蓋掉）：
//   media.rec { on }              開關錄影
//   media.add { record }          記一則（id 套用時發）
//   media.stage { add?, clear? }  委託階段的暫存：累加、或清掉
//   media.make { footage, record? } 多一段素材（record 有寫就把那一則標成轉過了）
//   media.use { ref, take }       用掉一件的次數（take 是 1，或 'all' 扣光）
// 回到快照（rewind.keep）直接用 ext 變更整份換。

import type { Change, ContentEntry, GameState, Kernel } from '../../core'
import { clamp, isRecord, isSafeInt, meterOf, toMinutes } from '../../core'

export const OWNER = 'media'
export const EXT = 'media'
export const RULE_KIND = 'media_rule'

export const REC_STAT = 'rec_grade'
export const QUALITY_STAT = 'footage_quality'
export const CAP_STAT = 'footage_cap'

export const REC_ACTION = 'media.rec'
export const CONVERT_ACTION = 'media.convert'

/** 類型的 id（MEDIA 第 2 節）與給玩家看的名字。 */
export const TYPES = ['battle', 'scandal', 'crime', 'intimate', 'celebrity', 'daily'] as const
export type MediaType = (typeof TYPES)[number]
export const TYPE_NAME: Record<MediaType, string> = { battle: '戰鬥', scandal: '醜聞', crime: '罪證', intimate: '親密', celebrity: '名人', daily: '日常' }
/** 記號的字彙（RecordEntry.marks）：crit 要害、boss 首領倒下、celebrity 名人、hq 高品質、live 直播、lost 戰敗的畫面、adult 成人場景、self 畫面裡有你。 */
export const MARKS = ['crit', 'boss', 'celebrity', 'hq', 'live', 'lost', 'adult', 'self'] as const
export type Mark = (typeof MARKS)[number]
/** 素材的來歷。 */
export const ORIGINS = ['own', 'bought', 'stolen', 'given', 'staff', 'event'] as const
export type Origin = (typeof ORIGINS)[number]
export const AUTHENTIC = ['real', 'edited', 'forged'] as const
export type Authentic = (typeof AUTHENTIC)[number]
export const FRESH = ['new', 'ok', 'old'] as const
export type Fresh = (typeof FRESH)[number]
/** 為什麼沒錄到：off 錄影關著、none 隊伍裡沒有人錄得到、banned 那個地方不准錄。 */
export const MISSES = ['off', 'none', 'banned'] as const
export type Miss = (typeof MISSES)[number]

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isMark = (v: unknown): v is Mark => (MARKS as readonly unknown[]).includes(v)
export const isType = (v: unknown): v is MediaType => (TYPES as readonly unknown[]).includes(v)
export const isOrigin = (v: unknown): v is Origin => (ORIGINS as readonly unknown[]).includes(v)
const texts = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(isText))] : [])

// ---- 規則 ----

export interface MediaRules {
  /** 來源對類型的預設（V4）：鍵是來源的種類（battle、scene、event、live、stage），stage 另有 stage:<面>（stage:net 是罪證）；沒寫的來源是 daily */
  source_type: Record<string, MediaType>
  quality: {
    /** 起點 */
    base: number
    /** 錄影義體的等級夠高的加成：[等級, 加多少]，取符合的最大那一筆（I～II +0、III～IV +1、V +2） */
    rec_steps: Array<[number, number]>
    /** 那一則有 crit、boss、celebrity 任一個 */
    highlight: number
    /** 基本功（隊伍裡 skills 裡最高的一項）的加成：[等級, 加多少] */
    skill_steps: Array<[number, number]>
    skills: string[]
    /** 高品質記號 hq */
    hq: number
    /** 紀錄超過 old_days 天才轉 */
    old: number
    /** 戰敗的畫面（記號 lost） */
    lost: number
    /** 撤退收回的那一則（使用者 2026-11-24 第 2、3 題：失敗收回的不扣） */
    retreat: number
    /** 上限 = cap_base + footage_cap，最高 cap_max */
    cap_base: number
    cap_max: number
  }
  /** 看點：涉及名人 +celebrity；親密類加主角各區豔名最高那一區的級數 */
  draw: { celebrity: number }
  /** 可信 = 品質 × mult，偽造 −forged，夾 0～max */
  trust: { mult: number; forged: number; max: number }
  /** 風險 = base ＋ 偽造 forged */
  risk: { base: number; forged: number }
  /** 豔名每幾點算一級（MEDIA 第 2 節；LEWD 的 fame_step 也是 30） */
  fame_step: number
  /** 紀錄超過幾天才轉算舊 */
  old_days: number
  /** 新鮮度：幾天內「新」、幾天內「尚可」，之後「舊貨」 */
  fresh_days: { new: number; ok: number }
  /** 一段素材的使用次數 */
  uses: number
}

export const DEFAULT_MEDIA_RULES: MediaRules = {
  source_type: { battle: 'battle', scene: 'intimate', event: 'daily', stage: 'battle', 'stage:net': 'crime', live: 'daily' },
  quality: {
    base: 1, rec_steps: [[3, 1], [5, 2]], highlight: 1, skill_steps: [[3, 1], [5, 2]], skills: ['perform', 'investigate'], hq: 1, old: -1, lost: -1, retreat: -1, cap_base: 3, cap_max: 5,
  },
  draw: { celebrity: 1 },
  trust: { mult: 2, forged: 3, max: 10 },
  risk: { base: 2, forged: 5 },
  fame_step: 30,
  old_days: 7,
  fresh_days: { new: 3, ok: 7 },
  uses: 3,
}

const isStep = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isSafeInt(v[0]) && v[0] >= 1 && isSafeInt(v[1]) && v[1] >= -5 && v[1] <= 5
const steps = (v: unknown): Array<[number, number]> => (Array.isArray(v) ? v.filter(isStep).map((s) => [s[0], s[1]] as [number, number]) : [])
const smallInt = (v: unknown, min: number, max: number): v is number => isSafeInt(v) && v >= min && v <= max

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.source_type !== undefined) {
    if (!isRecord(e.source_type)) p.push('source_type 要是 { 來源: 類型 }')
    else for (const [k, v] of Object.entries(e.source_type)) if (!isType(v)) p.push(`source_type.${k} 要是 ${TYPES.join('、')} 其中一個`)
  }
  if (e.quality !== undefined) {
    const q = e.quality
    if (!isRecord(q)) p.push('quality 要是物件')
    else {
      for (const key of ['base', 'highlight', 'hq', 'old', 'lost', 'retreat'] as const) if (q[key] !== undefined && !smallInt(q[key], -5, 5)) p.push(`quality.${key} 要是 −5～5 的整數`)
      for (const key of ['cap_base', 'cap_max'] as const) if (q[key] !== undefined && !smallInt(q[key], 1, 5)) p.push(`quality.${key} 要是 1～5 的整數`)
      for (const key of ['rec_steps', 'skill_steps'] as const) if (q[key] !== undefined && !(Array.isArray(q[key]) && (q[key] as unknown[]).every(isStep))) p.push(`quality.${key} 要是 [等級, 加成] 的陣列`)
      if (q.skills !== undefined && !(Array.isArray(q.skills) && q.skills.every(isText))) p.push('quality.skills 要是基本功 id 的陣列')
    }
  }
  for (const [key, fields] of [['draw', ['celebrity']], ['trust', ['mult', 'forged', 'max']], ['risk', ['base', 'forged']], ['fresh_days', ['new', 'ok']]] as const) {
    const v = e[key]
    if (v === undefined) continue
    if (!isRecord(v)) p.push(`${key} 要是物件`)
    else for (const f of fields) if (v[f] !== undefined && !smallInt(v[f], 0, 1000)) p.push(`${key}.${f} 要是 0～1000 的整數`)
  }
  for (const [key, lo, hi] of [['fame_step', 1, 1000], ['old_days', 1, 3650], ['uses', 1, 20]] as const) if (e[key] !== undefined && !smallInt(e[key], lo, hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  if (isRecord(e.fresh_days) && smallInt(e.fresh_days.new, 0, 1000) && smallInt(e.fresh_days.ok, 0, 1000) && e.fresh_days.new > e.fresh_days.ok) p.push('fresh_days.new 不能大於 fresh_days.ok')
  return p
}

/** 現在生效的規則：資料 media_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function mediaRules(k: Pick<Kernel, 'content'>): MediaRules {
  const d = DEFAULT_MEDIA_RULES
  const out: MediaRules = {
    source_type: { ...d.source_type }, quality: { ...d.quality, rec_steps: d.quality.rec_steps.map((s) => [...s] as [number, number]), skill_steps: d.quality.skill_steps.map((s) => [...s] as [number, number]), skills: [...d.quality.skills] },
    draw: { ...d.draw }, trust: { ...d.trust }, risk: { ...d.risk }, fame_step: d.fame_step, old_days: d.old_days, fresh_days: { ...d.fresh_days }, uses: d.uses,
  }
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  if (isRecord(e.source_type)) for (const [key, v] of Object.entries(e.source_type)) if (isType(v)) out.source_type[key] = v
  if (isRecord(e.quality)) {
    const q = e.quality
    for (const key of ['base', 'highlight', 'hq', 'old', 'lost', 'retreat'] as const) if (smallInt(q[key], -5, 5)) out.quality[key] = q[key]
    for (const key of ['cap_base', 'cap_max'] as const) if (smallInt(q[key], 1, 5)) out.quality[key] = q[key]
    for (const key of ['rec_steps', 'skill_steps'] as const) if (Array.isArray(q[key]) && (q[key] as unknown[]).every(isStep)) out.quality[key] = steps(q[key])
    if (Array.isArray(q.skills) && q.skills.every(isText)) out.quality.skills = [...q.skills]
  }
  for (const [key, fields] of [['draw', ['celebrity']], ['trust', ['mult', 'forged', 'max']], ['risk', ['base', 'forged']], ['fresh_days', ['new', 'ok']]] as const) {
    const v = e[key]
    if (!isRecord(v)) continue
    const dst = out[key] as Record<string, number>
    for (const f of fields) if (smallInt(v[f], 0, 1000)) dst[f] = v[f]
  }
  if (out.fresh_days.new > out.fresh_days.ok) out.fresh_days = { ...d.fresh_days }
  for (const [key, lo, hi] of [['fame_step', 1, 1000], ['old_days', 1, 3650], ['uses', 1, 20]] as const) if (smallInt(e[key], lo, hi)) out[key] = e[key]
  if (out.quality.cap_base > out.quality.cap_max) out.quality.cap_max = out.quality.cap_base
  return out
}

// ---- 狀態 ----

export interface Involves {
  factions: string[]
  people: string[]
}

export interface RecordSource {
  /** battle、stage、event、scene、live，或別的功能自己的種類 */
  kind: string
  ref?: string
  report?: string
}

export interface RecordEntry {
  id: string
  /** 記下來的時間（總分鐘） */
  at: number
  source: RecordSource
  label: string
  /** 拍的人（那一刻隊伍裡 rec_grade 最高的）；沒錄到是 null */
  by: string | null
  /** 那一刻的錄影等級（0～5；沒錄到是 0） */
  grade: number
  type: MediaType
  involves: Involves
  marks: Mark[]
  exclusive: boolean
  /** 沒錄到的原因（by 是 null 才有） */
  miss?: Miss
  /** 回到快照時被收回（使用者 2026-11-24：不限制轉成素材） */
  retracted?: true
  /** 被收回的方式是撤退（轉成素材時品質另外 −1） */
  retreat?: true
  /** 內容標籤（成人場景碰過的題材）：轉成素材時帶過去，內容篩選認它 */
  tags?: string[]
  /** 轉成了哪一段素材 */
  made?: string
}

export interface Footage {
  id: string
  from_record?: string
  title: string
  text: string
  type: MediaType
  quality: number
  authentic: Authentic
  exclusive: boolean
  involves: Involves
  uses: number
  made_at: number
  origin: Origin
  celebrity: boolean
  self: boolean
  adult: boolean
  tags?: string[]
}

/** 委託階段的暫存：這個階段裡的戰鬥與事件各自不出紀錄，累加在這裡，里程碑一到才出一則。 */
export interface StagePending {
  commission: string
  marks: Mark[]
  people: string[]
  factions: string[]
}

export interface MediaState {
  rec: boolean
  seq: number
  records: Record<string, RecordEntry>
  footage: Record<string, Footage>
  /** 片（下一張工單 M5-media-cut 才有；這一張只留位置） */
  clips: Record<string, unknown>
  stage: StagePending | null
}

export const blankMedia = (): MediaState => ({ rec: true, seq: 0, records: {}, footage: {}, clips: {}, stage: null })

const own = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

function involvesOf(v: unknown): Involves {
  const r = isRecord(v) ? v : {}
  return { factions: texts(r.factions), people: texts(r.people) }
}

function readRecord(id: string, v: unknown): RecordEntry | null {
  if (!isRecord(v) || !isSafeInt(v.at) || !isText(v.label) || !isRecord(v.source) || !isText(v.source.kind)) return null
  const grade = isSafeInt(v.grade) ? clamp(v.grade, 0, 5) : 0
  const by = isText(v.by) ? v.by : null
  const tags = texts(v.tags)
  return {
    id, at: v.at, label: v.label,
    source: { kind: v.source.kind, ...(isText(v.source.ref) ? { ref: v.source.ref } : {}), ...(isText(v.source.report) ? { report: v.source.report } : {}) },
    by, grade: by === null ? 0 : grade, type: isType(v.type) ? v.type : 'daily', involves: involvesOf(v.involves),
    marks: [...new Set((Array.isArray(v.marks) ? v.marks : []).filter(isMark))], exclusive: v.exclusive !== false,
    ...((MISSES as readonly unknown[]).includes(v.miss) ? { miss: v.miss as Miss } : {}),
    ...(v.retracted === true ? { retracted: true as const } : {}), ...(v.retreat === true ? { retreat: true as const } : {}),
    ...(tags.length > 0 ? { tags } : {}), ...(isText(v.made) ? { made: v.made } : {}),
  }
}

function readFootage(id: string, v: unknown): Footage | null {
  if (!isRecord(v) || !isText(v.title) || !isSafeInt(v.made_at)) return null
  const tags = texts(v.tags)
  return {
    id, ...(isText(v.from_record) ? { from_record: v.from_record } : {}), title: v.title, text: typeof v.text === 'string' ? v.text : '',
    type: isType(v.type) ? v.type : 'daily', quality: isSafeInt(v.quality) ? clamp(v.quality, 1, 5) : 1,
    authentic: (AUTHENTIC as readonly unknown[]).includes(v.authentic) ? (v.authentic as Authentic) : 'real', exclusive: v.exclusive !== false, involves: involvesOf(v.involves),
    uses: isSafeInt(v.uses) ? clamp(v.uses, 0, 20) : 0, made_at: v.made_at, origin: isOrigin(v.origin) ? v.origin : 'own',
    celebrity: v.celebrity === true, self: v.self === true, adult: v.adult === true, ...(tags.length > 0 ? { tags } : {}),
  }
}

function readStage(v: unknown): StagePending | null {
  if (!isRecord(v) || !isText(v.commission)) return null
  return { commission: v.commission, marks: [...new Set((Array.isArray(v.marks) ? v.marks : []).filter(isMark))], people: texts(v.people), factions: texts(v.factions) }
}

/** 讀 state.ext.media：沒有、或形狀不對的部分當成空的（回傳的是新物件，改它不會動到狀態）。 */
export function readMedia(state: Pick<GameState, 'ext'>): MediaState {
  const raw = state.ext?.[EXT]
  const r = isRecord(raw) ? raw : {}
  const records: Record<string, RecordEntry> = {}
  if (isRecord(r.records)) for (const [id, v] of Object.entries(r.records)) if (own(r.records, id) && id !== '__proto__') { const e = readRecord(id, v); if (e) records[id] = e }
  const footage: Record<string, Footage> = {}
  if (isRecord(r.footage)) for (const [id, v] of Object.entries(r.footage)) if (own(r.footage, id) && id !== '__proto__') { const e = readFootage(id, v); if (e) footage[id] = e }
  return {
    rec: r.rec !== false, seq: isSafeInt(r.seq) && r.seq > 0 ? r.seq : 0, records, footage,
    clips: isRecord(r.clips) ? { ...r.clips } : {}, stage: readStage(r.stage),
  }
}

/** 寫回的值（ext 變更用）。 */
export const mediaValue = (m: MediaState): MediaState => JSON.parse(JSON.stringify(m)) as MediaState

// ---- 算式 ----

export const minutesNow = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)
export const DAY = 1440

/** 隊伍裡每個人的衍生數值；有人沒有這個數值（被拿掉的功能）當 0。 */
function statOf(k: Kernel, state: GameState, actor: string, id: string): number {
  return k.stats.hasStat(id) && state.actors[actor] ? k.stats.stat(state, actor, id) : 0
}

/** 隊伍（含主角，沒有隊伍就是主角）。 */
export function partyOf(state: GameState): string[] {
  const ids = state.party.length > 0 ? state.party : state.pc ? [state.pc] : []
  return ids.filter((id) => !!state.actors[id])
}

/** 隊伍裡 rec_grade 最高的人（同分取隊伍排得前面的）；大於 0 才算。 */
export function recorderOf(k: Kernel, state: GameState): { id: string; grade: number } | null {
  let best: { id: string; grade: number } | null = null
  for (const id of partyOf(state)) {
    const g = statOf(k, state, id, REC_STAT)
    if (g > 0 && (!best || g > best.grade)) best = { id, grade: g }
  }
  return best
}

/** 隊伍裡某個衍生數值最高的那個值。 */
export function partyMax(k: Kernel, state: GameState, stat: string): number {
  return partyOf(state).reduce((m, id) => Math.max(m, statOf(k, state, id, stat)), 0)
}

/** 主角各區豔名最高的那一區的級數（每 fame_step 點一級；沒有豔名量表是 0）。 */
export function fameLevel(k: Kernel, state: GameState, rules: MediaRules): number {
  if (!k.meters.has('fame')) return 0
  let top = 0
  if (k.content.hasKind('district')) for (const d of k.content.list('district')) top = Math.max(top, meterOf(k, state, 'fame', d.id))
  else top = meterOf(k, state, 'fame')
  return Math.floor(top / rules.fame_step)
}

/** 一張 [門檻, 加成] 的表：取門檻不超過 n 的最高那一格的加成。 */
function stepBonus(table: Array<[number, number]>, n: number): number {
  let out = 0
  let at = -Infinity
  for (const [t, v] of table) if (n >= t && t > at) { at = t; out = v }
  return out
}

/** 一則紀錄現在轉成素材的品質與每一項（V5）。 */
export function qualityParts(k: Kernel, state: GameState, rec: RecordEntry, rules: MediaRules = mediaRules(k)): { value: number; cap: number; parts: Array<{ label: string; value: number }> } {
  const q = rules.quality
  const parts: Array<{ label: string; value: number }> = [{ label: '基本', value: q.base }]
  const add = (label: string, value: number): void => { if (value !== 0) parts.push({ label, value }) }
  add('錄影義體', stepBonus(q.rec_steps, rec.grade))
  if (rec.marks.some((m) => m === 'crit' || m === 'boss' || m === 'celebrity')) add('有亮點', q.highlight)
  const skill = partyOf(state).reduce((m, id) => Math.max(m, ...q.skills.map((s) => state.actors[id]?.skills[s] ?? 0)), 0)
  add('基本功', stepBonus(q.skill_steps, skill))
  if (rec.marks.includes('hq')) add('高品質', q.hq)
  add('剪輯的功夫', partyMax(k, state, QUALITY_STAT))
  if (minutesNow(state) - rec.at > rules.old_days * DAY) add('紀錄放太久', q.old)
  if (rec.marks.includes('lost')) add('戰敗的畫面', q.lost)
  if (rec.retreat) add('撤退收回的', q.retreat)
  const cap = clamp(q.cap_base + partyMax(k, state, CAP_STAT), 1, q.cap_max)
  const sum = parts.reduce((s, p) => s + p.value, 0)
  return { value: clamp(sum, 1, cap), cap, parts }
}

/** 新鮮度：從轉成素材那天算起（3 天內新、7 天內尚可，之後舊貨）。 */
export function freshOf(made: number, now: number, rules: MediaRules): Fresh {
  const age = now - made
  return age <= rules.fresh_days.new * DAY ? 'new' : age <= rules.fresh_days.ok * DAY ? 'ok' : 'old'
}

// ---- 給別的功能的格式（掛點 media.materials、media.spend、media.record；格式照 dev/adr/0020 第十三節，多一欄 tags） ----

export interface Material {
  /** 'ft…' 素材、'cl…' 片 */
  ref: string
  kind: 'footage' | 'clip'
  title: string
  types: string[]
  quality: number
  /** 看點、可信、風險（親密類的看點已經加上豔名的級數） */
  draw: number
  trust: number
  risk: number
  angle?: string
  uses: number
  fresh: Fresh
  exclusive: boolean
  forged: boolean
  celebrity: boolean
  self: boolean
  adult: boolean
  involves: Involves
  /** 進輿論戰牌庫時的樣子（DATA 第 11 節） */
  card: { kind: 'fuel' | 'line' | 'decoy'; value: number } | null
  /** 內容標籤（片取來源的聯集）：內容篩選與館的授權讀它 */
  tags: string[]
  /** 片的簡介（M5-media-cut） */
  intro?: string
}

/** 一段素材算成「沒有角度的單段片」（MEDIA 第 2 節）。 */
export function materialOfFootage(k: Kernel, state: GameState, f: Footage, rules: MediaRules = mediaRules(k)): Material {
  const forged = f.authentic === 'forged'
  const draw = f.quality + (f.celebrity ? rules.draw.celebrity : 0) + (f.type === 'intimate' ? fameLevel(k, state, rules) : 0)
  return {
    ref: f.id, kind: 'footage', title: f.title, types: [f.type], quality: f.quality, draw,
    trust: clamp(f.quality * rules.trust.mult - (forged ? rules.trust.forged : 0), 0, rules.trust.max), risk: rules.risk.base + (forged ? rules.risk.forged : 0),
    uses: f.uses, fresh: freshOf(f.made_at, minutesNow(state), rules), exclusive: f.exclusive, forged, celebrity: f.celebrity, self: f.self, adult: f.adult,
    involves: { factions: [...f.involves.factions], people: [...f.involves.people] }, card: { kind: 'fuel', value: draw }, tags: [...(f.tags ?? [])],
  }
}

export interface RecordHint {
  type?: string
  involves?: { factions?: string[]; people?: string[] }
  celebrity?: boolean
  hq?: boolean
  live?: boolean
  lost?: boolean
  adult?: boolean
  self?: boolean
  exclusive?: boolean
  /** 這個地方不准錄 */
  no_rec?: boolean
  tags?: string[]
}

export type SpendAnswer = { changes: Change[]; material: Material } | { block: string }

declare module '../../core' {
  interface HookMap {
    /** 問素材庫裡有哪些料（media 回答）：只列使用次數大於 0 的；kinds 沒給是素材與片都要。 */
    'media.materials': [{ state: GameState; kinds?: Array<'footage' | 'clip'> }, Material[] | void]
    /** 用掉一件（media 回答）：how 是 post、episode、deck、sing……；all 是扣光。回傳的變更由問的人併進自己的報告；不能用回 { block }（一句完整的原因）。 */
    'media.spend': [{ state: GameState; ref: string; how: string; all?: boolean }, SpendAnswer | void]
    /** 這裡有一件事留下紀錄（media 回答；直播的收播之類）：回傳要併進報告的變更。 */
    'media.record': [{ state: GameState; source: RecordSource; label: string; hint?: RecordHint }, Change[] | void]
  }
}
