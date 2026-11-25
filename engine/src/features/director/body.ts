// L6 功能 director 的事件內文（M2-event-run）：格式、版本與分段的解開、結果的查找、登場角色代號的替換。純函式，不碰登錄表的登記。
// 規格：EVENTS 2.1、2.3、2.4、第 5 節；DATA 第 4、5 節（adult_scene 的物件、versions、stages、inherit、fallback）；dev/adr/0016 第四節。
//
// 事件內文的樣子（表頭的鍵由導演管：scope、triggers、where、when、requires、weight、weight_mods、category、blocking、repeat_days、tags、adult）：
//   一段的事件      { text, options }
//   多段的事件      { text?, stages: [{ text?, options } | { inherit, text?, options?, adult_scene? }] }
//   分版本的事件    { versions: { default, masc?, yuri? } }，每個版本自己是 { text, stages } 或 { text, options }
//   fallback        用到的標籤被關掉時改走哪一件（事件的 id）
//   cast            [{ role, npc? | known? | gen? }]，最多 2 位；role 是 $a、$b 的 a、b
//   選項            { id?, text, need?, show_locked?, check?: [基本功, 屬性?, 難度], outcomes: { critical?, success?, fail?, fumble?, any? }, adult_scene?, flags?, ends? }
//   難度            階梯的名字（easy、normal、hard、extreme、legendary、mythic）或一個整數的 DC（問話 10 ＋ 等級 × 2 這類）
//   結果的每一筆    效果 { kind, ... }（由 k.effects 管），或指示 { kind: 'fight', foes, cover?, faction? }、{ kind: 'chain', event }

import type { Condition, ContentEntry, Degree, GameState, Kernel } from '../../core'
import { ATTR_IDS, DC_TIERS, effectCtx, isRecord, isSafeInt } from '../../core'

export const VERSION_IDS = ['default', 'masc', 'yuri'] as const
export const OUTCOME_KEYS = ['critical', 'success', 'fail', 'fumble', 'any'] as const
export type OutcomeKey = (typeof OUTCOME_KEYS)[number]
export const SCENE_WHEN = ['always', 'success', 'fail'] as const
/** 事件的選項最多幾個（EVENTS 2.1）。「我要做別的」不算在內，它永遠多一個。 */
export const MAX_OPTIONS = 4
/** 登場角色最多幾位（EVENTS 2.1）。 */
export const MAX_CAST = 2
/** 數字 DC 的範圍。 */
export const DC_MIN = 1
export const DC_MAX = 40
/** 指示：不是效果，由執行器變成 launch。 */
export const DIRECTIVES = ['fight', 'chain'] as const
/** inherit 一路追下去最多幾層（防止互相指）。 */
const MAX_INHERIT = 8

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
/** 選項的 id：字母、數字、底線、冒號、點、減號（俘虜的「挑一個」用 pick:f1）。 */
const isOptionId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_:.-]{1,64}$/.test(v)

export interface SceneSpec {
  when: (typeof SCENE_WHEN)[number]
  /** 分圈的參與者；單人（solo: true）不寫 */
  circles?: string[][]
  /** 單人：一個人的場景（features/scene 的 setup.solo）；不帶 circles（M4-core-gaps 第 17 項） */
  solo?: boolean
  [field: string]: unknown
}

export interface OptionDef {
  id?: string
  text: string
  need?: Condition | Condition[]
  show_locked?: boolean | string
  check?: unknown[]
  outcomes?: Partial<Record<OutcomeKey, Array<Record<string, unknown>>>>
  adult_scene?: SceneSpec
  flags?: string[]
  ends?: boolean
}

export interface StageDef {
  text?: string
  options?: OptionDef[]
  inherit?: string
  adult_scene?: Record<string, unknown>
}

export interface VersionDef {
  text?: string
  options?: OptionDef[]
  stages?: StageDef[]
}

export interface CastSpec {
  role: string
  npc?: unknown
  known?: unknown
  gen?: unknown
}

/** 事件內文用到的欄位（表頭的欄位在 model.ts 的 EventEntry）。 */
export interface EventBodyFields extends ContentEntry {
  text?: string
  options?: OptionDef[]
  stages?: StageDef[]
  versions?: Partial<Record<(typeof VERSION_IDS)[number], VersionDef>>
  fallback?: string
  cast?: CastSpec[]
  blocking?: boolean
  tags?: string[]
  scope?: string
}

/** 解開版本與 inherit 之後的內文：一段一段、每一段是正文與選項。 */
export interface ResolvedStage {
  text?: string
  options: Array<OptionDef & { id: string }>
}
export interface ResolvedBody {
  version: string
  /** 開頭的正文（只在第一段顯示） */
  text: string
  stages: ResolvedStage[]
}

/** 一個選項的檢定，整理成固定的樣子。 */
export interface CheckSpec {
  skill: string
  attr?: string
  dc: number | keyof typeof DC_TIERS
}

// ---- 檢定與難度 ----

export const isTier = (v: unknown): v is keyof typeof DC_TIERS => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DC_TIERS, v)
export const isNumericDc = (v: unknown): v is number => isSafeInt(v) && v >= DC_MIN && v <= DC_MAX

/** [基本功, 屬性?, 難度] 整理成物件；格式不對回傳 null。 */
export function normalCheck(raw: unknown): CheckSpec | null {
  if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 3)) return null
  const dc = raw[raw.length - 1]
  if (!isTier(dc) && !isNumericDc(dc)) return null
  if (!isText(raw[0])) return null
  if (raw.length === 3) return isText(raw[1]) ? { skill: raw[0], attr: raw[1], dc } : null
  return { skill: raw[0], dc }
}

// ---- 版本與分段的解開 ----

/** 這件事件有哪幾個版本（沒有分版本的只有 default）。 */
export function versionsOf(e: Pick<EventBodyFields, 'versions'>): string[] {
  return e.versions ? Object.keys(e.versions) : ['default']
}

/** 一個版本的原始分段（還沒解 inherit）；沒有分版本的就是事件自己。 */
function rawVersion(e: EventBodyFields, version: string): { text: string; stages: StageDef[] } | null {
  const v: VersionDef | undefined = e.versions ? e.versions[version as keyof NonNullable<EventBodyFields['versions']>] : e
  if (!v) return null
  const stages = Array.isArray(v.stages) ? v.stages : Array.isArray(v.options) ? [{ options: v.options } as StageDef] : []
  return { text: typeof v.text === 'string' ? v.text : '', stages }
}

const INHERIT_RE = /^(?:([a-z]+)\.)?stages\.(\d+)$/

/** 解一段的 inherit：回傳解開之後的一段，指不到回傳錯誤訊息（字串）。 */
function resolveStage(e: EventBodyFields, version: string, index: number, depth: number, seen: string[]): ResolvedStage | string {
  const here = rawVersion(e, version)
  const stage = here?.stages[index]
  if (!stage) return `沒有 ${version}.stages.${index} 這一段`
  const key = `${version}.${index}`
  if (!stage.inherit) return { ...(stage.text !== undefined ? { text: stage.text } : {}), options: normalOptions(stage.options ?? []) }
  if (depth >= MAX_INHERIT || seen.includes(key)) return `inherit 繞回了自己（${[...seen, key].join(' → ')}）`
  const m = INHERIT_RE.exec(stage.inherit)
  if (!m) return `inherit「${stage.inherit}」要寫成「版本.stages.第幾段」`
  const from = m[1] ?? version
  if (e.versions ? !e.versions[from as keyof NonNullable<EventBodyFields['versions']>] : from !== 'default' && from !== version) return `inherit「${stage.inherit}」指的版本 ${from} 不存在`
  const base = resolveStage(e, e.versions ? from : version, Number(m[2]), depth + 1, [...seen, key])
  if (typeof base === 'string') return base
  const options = stage.options ? normalOptions(stage.options) : base.options.map((o) => ({ ...o }))
  const text = stage.text ?? base.text
  // 這一段寫的 adult_scene 蓋在每個有 adult_scene 的選項上（只換掉寫出來的鍵）
  const scene = stage.adult_scene
  return {
    ...(text !== undefined ? { text } : {}),
    options: scene ? options.map((o) => (o.adult_scene ? { ...o, adult_scene: { ...o.adult_scene, ...scene } as SceneSpec } : o)) : options,
  }
}

function normalOptions(list: OptionDef[]): Array<OptionDef & { id: string }> {
  return list.map((o, i) => ({ ...o, id: o.id ?? `o${i + 1}` }))
}

/** 解開一個版本：沒有這個版本就走 default；解不開回傳錯誤訊息。 */
export function resolveBody(e: EventBodyFields, version = 'default'): ResolvedBody | string {
  const v = rawVersion(e, version) ? version : 'default'
  const raw = rawVersion(e, v)
  if (!raw) return `沒有 ${version} 這個版本，也沒有 default`
  const stages: ResolvedStage[] = []
  for (let i = 0; i < raw.stages.length; i++) {
    const s = resolveStage(e, v, i, 0, [])
    if (typeof s === 'string') return s
    stages.push(s)
  }
  if (stages.length === 0) return `${v} 沒有任何一段（要有 options 或 stages）`
  return { version: v, text: raw.text, stages }
}

// ---- 結果 ----

/** 這一個成功程度走哪一組效果：缺的往旁邊找（大成功用成功的、大失敗用失敗的），最後是 any。沒有檢定的 degree 給 null，只看 any。 */
export function outcomeList(o: Pick<OptionDef, 'outcomes'>, degree: Degree | null): Array<Record<string, unknown>> {
  const table = o.outcomes ?? {}
  const order: OutcomeKey[] = degree === null ? ['any'] : degree === 'critical' ? ['critical', 'success', 'any'] : degree === 'fumble' ? ['fumble', 'fail', 'any'] : [degree, 'any']
  for (const key of order) if (table[key] !== undefined) return table[key]!
  return []
}

export const isDirective = (e: unknown): e is { kind: (typeof DIRECTIVES)[number]; [k: string]: unknown } => isRecord(e) && (DIRECTIVES as readonly unknown[]).includes(e.kind)

/** 成人場景的 when 對上這一次的成功程度（沒有檢定的選項：always 與 success 都算，fail 不算）。 */
export function sceneWhenMatches(when: unknown, degree: Degree | null): boolean {
  if (when === 'always') return true
  if (when === 'success') return degree === null || degree === 'success' || degree === 'critical'
  if (when === 'fail') return degree === 'fail' || degree === 'fumble'
  return false
}

// ---- 登場角色的代號 ----

/** 把字串值剛好是 $a、$b、$pc 的換成登場角色的 id（整份結構往下找）；對不上的 $ 字串原樣留著。回傳新的，不改傳進來的。 */
export function substitute<T>(value: T, ids: Record<string, string>): T {
  if (typeof value === 'string') return (value.startsWith('$') && ids[value.slice(1)] !== undefined ? ids[value.slice(1)] : value) as T
  if (Array.isArray(value)) return value.map((v) => substitute(v, ids)) as unknown as T
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, ids)])) as T
  return value
}

const hasToken = (v: unknown): boolean => (typeof v === 'string' ? v.startsWith('$') : Array.isArray(v) ? v.some(hasToken) : isRecord(v) ? Object.values(v).some(hasToken) : false)

// ---- 格式檢查 ----

export type BodyPhase = 'load' | 'ready' | 'inline'

type Cx = Pick<Kernel, 'conditions' | 'effects' | 'content' | 'activity'>

function conditionProblems(k: Pick<Kernel, 'conditions'>, raw: unknown, path: string): string[] {
  if (Array.isArray(raw)) return raw.flatMap((c, i) => k.conditions.validate(c, `${path}[${i}]`))
  return k.conditions.validate(raw, path)
}

function sceneProblems(raw: unknown, path: string): string[] {
  if (!isRecord(raw)) return [`${path}：要是 { when, gate, nature, role, goal, circles }`]
  const p: string[] = []
  if (!(SCENE_WHEN as readonly unknown[]).includes(raw.when)) p.push(`${path}.when 只能是 ${SCENE_WHEN.join('、')}`)
  // 單人（solo: true）一個人的場景：不寫 circles；其餘一定要有 circles
  if (raw.solo !== undefined && typeof raw.solo !== 'boolean') p.push(`${path}.solo 要是 true 或 false`)
  if (raw.solo === true) {
    if (raw.circles !== undefined) p.push(`${path}：單人的場景（solo）沒有對象，不能寫 circles`)
  } else if (!(Array.isArray(raw.circles) && raw.circles.length > 0 && raw.circles.every((c) => isTextList(c) && c.length > 0))) p.push(`${path}.circles 要是 [[參與的人]]（$pc 是主角，$a、$b 是登場角色）；一個人的場景寫 solo: true`)
  for (const key of ['gate', 'nature', 'role', 'goal', 'start_position']) if (raw[key] !== undefined && !isText(raw[key])) p.push(`${path}.${key} 要是字串`)
  return p
}

function directiveProblems(e: Record<string, unknown>, path: string): string[] {
  if (e.kind === 'fight') {
    const p: string[] = []
    if (!(Array.isArray(e.foes) && e.foes.length > 0 && e.foes.every((f) => isRecord(f) && isText(f.from)))) p.push(`${path}.foes 要是敵人的陣列（每一筆 { from, ... }）`)
    if (e.cover !== undefined && !isText(e.cover) && !isRecord(e.cover)) p.push(`${path}.cover 要是遮蔽配置的名字或逐格的寫法`)
    if (e.faction !== undefined && !isText(e.faction)) p.push(`${path}.faction 要是勢力的 id`)
    return p
  }
  return isText(e.event) ? [] : [`${path}.event 要是事件的 id`]
}

/** 效果驗格式的情境（載入時沒有真的狀態：照導演檢查通知效果的做法）。 */
function fakeCtx(k: Pick<Kernel, 'content'>): Parameters<Kernel['effects']['validate']>[1] {
  return { state: { time: { day: 1, hour: 0, minute: 0 } }, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as unknown as Parameters<Kernel['effects']['validate']>[1]
}

function outcomesProblems(k: Cx, o: OptionDef, path: string, phase: BodyPhase, state: GameState | undefined): string[] {
  const p: string[] = []
  const table = o.outcomes
  if (table === undefined) return p
  if (!isRecord(table)) return [`${path}.outcomes：要是 { critical?, success?, fail?, fumble?, any? }`]
  for (const key of Object.keys(table)) if (!(OUTCOME_KEYS as readonly string[]).includes(key)) p.push(`${path}.outcomes.${key}：只有 ${OUTCOME_KEYS.join('、')}`)
  if (o.check === undefined && Object.keys(table).some((key) => key !== 'any')) p.push(`${path}：沒有 check 的選項只寫 any（結果只有一組）`)
  const ctx = state ? effectCtx(k as Kernel, state, { source: 'builtin' }) : fakeCtx(k)
  let directives = 0
  for (const key of OUTCOME_KEYS) {
    const list = table[key]
    if (list === undefined) continue
    const at = `${path}.outcomes.${key}`
    if (!Array.isArray(list) || !list.every(isRecord)) {
      p.push(`${at}：要是效果（物件）的陣列`)
      continue
    }
    const ds = list.filter(isDirective)
    if (ds.length > 1) p.push(`${at}：指示（fight、chain）一組最多一個（同一時間只開一段活動）`)
    directives += ds.length
    list.forEach((item, i) => {
      const here = `${at}[${i}]`
      if (isDirective(item)) return void p.push(...directiveProblems(item, here))
      if (typeof item.kind !== 'string') return void p.push(`${here}.kind：要寫效果的種類`)
      if (phase === 'load') return
      if (hasToken(item)) {
        // 含 $a、$b 的效果要等登場角色定了才驗得完整；先確認種類有人註冊
        if (!k.effects.has(item.kind)) p.push(`${here}.kind：${JSON.stringify(item.kind)} 不在封閉清單裡（可以用的：${k.effects.kinds().join('、')}）`)
        return
      }
      p.push(...k.effects.validate([item], ctx, here).map((m) => m.replace(`${here}[0]`, here)))
    })
  }
  if (directives > 0 && o.adult_scene !== undefined) p.push(`${path}：指示（fight、chain）與 adult_scene 不能放在同一個選項（同一時間只開一段活動）`)
  return p
}

function optionProblems(k: Cx, o: unknown, path: string, phase: BodyPhase, state: GameState | undefined): string[] {
  if (!isRecord(o)) return [`${path}：要是選項（物件）`]
  const p: string[] = []
  if (!isText(o.text)) p.push(`${path}.text 要是選項的一句話`)
  if (o.id !== undefined && !isOptionId(o.id)) p.push(`${path}.id 要是字母、數字、底線、冒號組成的字串`)
  if (o.need !== undefined) p.push(...conditionProblems(k, o.need, `${path}.need`))
  if (o.show_locked !== undefined && typeof o.show_locked !== 'boolean' && !isText(o.show_locked)) p.push(`${path}.show_locked 要是 true 或不能選的原因（一句話）`)
  if (o.check !== undefined) {
    const c = normalCheck(o.check)
    if (!c) p.push(`${path}.check 要寫成 [基本功, 屬性, 難度]（難度是 ${Object.keys(DC_TIERS).join('、')} 或 ${DC_MIN}～${DC_MAX} 的整數）`)
    else {
      if (c.attr !== undefined && !(ATTR_IDS as readonly string[]).includes(c.attr)) p.push(`${path}.check：屬性 ${c.attr} 不存在（${ATTR_IDS.join('、')}）`)
      if (phase !== 'load' && k.content.list('skill').length > 0 && !k.content.has('skill', c.skill)) p.push(`${path}.check：沒有 ${c.skill} 這項基本功`)
      if (phase !== 'load' && c.attr === undefined && k.content.list('skill').length > 0 && !isText(k.content.get('skill', c.skill)?.attr)) p.push(`${path}.check：${c.skill} 沒有預設的屬性，要寫 [基本功, 屬性, 難度]`)
    }
  }
  p.push(...outcomesProblems(k, o as unknown as OptionDef, path, phase, state))
  if (o.adult_scene !== undefined) p.push(...sceneProblems(o.adult_scene, `${path}.adult_scene`))
  if (o.flags !== undefined && !isTextList(o.flags)) p.push(`${path}.flags 要是字串的陣列`)
  if (o.ends !== undefined && typeof o.ends !== 'boolean') p.push(`${path}.ends 要是 true 或 false`)
  return p
}

function optionListProblems(k: Cx, list: unknown, path: string, phase: BodyPhase, state: GameState | undefined): string[] {
  if (!Array.isArray(list) || list.length === 0) return [`${path} 要是選項的陣列（至少一個）`]
  const p: string[] = []
  if (list.length > MAX_OPTIONS) p.push(`${path}：最多 ${MAX_OPTIONS} 個選項（「我要做別的」另外多一個，不用寫）`)
  const ids = new Set<string>()
  list.forEach((o, i) => {
    p.push(...optionProblems(k, o, `${path}[${i}]`, phase, state))
    const id = isRecord(o) ? (typeof o.id === 'string' ? o.id : `o${i + 1}`) : ''
    if (ids.has(id)) p.push(`${path}[${i}]：選項的 id ${id} 重複`)
    ids.add(id)
  })
  return p
}

function stageProblems(k: Cx, s: unknown, path: string, phase: BodyPhase, state: GameState | undefined): string[] {
  if (!isRecord(s)) return [`${path}：要是一段（物件）`]
  const p: string[] = []
  for (const key of Object.keys(s)) if (!['text', 'options', 'inherit', 'adult_scene'].includes(key)) p.push(`${path}.${key}：一段只有 text、options、inherit、adult_scene`)
  if (s.text !== undefined && !isText(s.text)) p.push(`${path}.text 要是一句話`)
  if (s.inherit !== undefined) {
    if (!isText(s.inherit)) p.push(`${path}.inherit 要是「版本.stages.第幾段」`)
    if (s.options !== undefined) p.push(...optionListProblems(k, s.options, `${path}.options`, phase, state))
    if (s.adult_scene !== undefined && !isRecord(s.adult_scene)) p.push(`${path}.adult_scene 要是物件（蓋在被繼承的選項的 adult_scene 上）`)
  } else {
    if (s.text === undefined && s.options === undefined) p.push(`${path}：要有 text 或 options`)
    p.push(...optionListProblems(k, s.options, `${path}.options`, phase, state))
    if (s.adult_scene !== undefined) p.push(`${path}.adult_scene 只能和 inherit 一起寫（一般的選項把 adult_scene 寫在選項上）`)
  }
  return p
}

function castProblems(list: unknown): string[] {
  if (list === undefined) return []
  if (!Array.isArray(list) || list.length > MAX_CAST) return [`cast 要是登場角色的陣列（0～${MAX_CAST} 位）`]
  const p: string[] = []
  const roles = new Set<string>()
  list.forEach((c, i) => {
    if (!isRecord(c)) return void p.push(`cast[${i}]：要是 { role, npc? | known? | gen? }`)
    if (typeof c.role !== 'string' || !/^[a-z][a-z0-9_]*$/.test(c.role) || c.role === 'pc') p.push(`cast[${i}].role 要是代號（小寫英文，例：a、b；pc 是主角，不能用）`)
    else if (roles.has(c.role)) p.push(`cast[${i}].role：代號 ${c.role} 重複`)
    else roles.add(c.role)
    if ([c.npc, c.known, c.gen].filter((x) => x !== undefined).length > 1) p.push(`cast[${i}]：npc、known、gen 只能寫一個`)
  })
  return p
}

/** 這件事件裡每個選項的每一組結果（解開版本與 inherit 之後的）。 */
function everyOption(e: EventBodyFields): OptionDef[] {
  const out: OptionDef[] = []
  for (const v of versionsOf(e)) {
    const r = resolveBody(e, v)
    if (typeof r !== 'string') for (const s of r.stages) out.push(...s.options)
  }
  return out
}

const chainsOf = (o: OptionDef): string[] => Object.values(o.outcomes ?? {}).flatMap((list) => (list ?? []).filter((x) => isDirective(x) && x.kind === 'chain').map((x) => String(x.event)))

/** 這件事件有沒有 chain 指示。 */
export const hasChain = (e: EventBodyFields): boolean => everyOption(e).some((o) => chainsOf(o).length > 0)

/**
 * 事件內文的格式檢查（addEventBodyCheck 與內嵌事件共用）。回傳錯誤訊息（空的就是沒問題）。
 * load：只看這一筆的格式（欄位、選項數、檢定、條件、inherit、版本）；ready：所有內容載入之後，再查效果的種類與引用、chain 的對象；
 * inline：內嵌的事件，兩樣都查（state 給了就用真的狀態驗效果）。通知（blocking: false）的內文由導演檢查，這裡不看。
 */
export function eventBodyProblems(k: Cx, e: EventBodyFields, phase: BodyPhase, state?: GameState): string[] {
  if (e.blocking === false) return []
  const p: string[] = []
  p.push(...castProblems(e.cast))
  if (e.fallback !== undefined && !isText(e.fallback)) p.push('fallback 要是事件的 id')
  const shapes = [e.options !== undefined, e.stages !== undefined, e.versions !== undefined].filter(Boolean).length
  if (shapes !== 1) return [...p, '內文要剛好寫 options、stages、versions 其中一種']
  if (e.versions !== undefined) {
    if (!isRecord(e.versions)) return [...p, 'versions 要是 { default, masc?, yuri? }']
    if (!isRecord(e.versions.default)) p.push('versions 至少要有 default')
    for (const [vid, v] of Object.entries(e.versions)) {
      if (!(VERSION_IDS as readonly string[]).includes(vid)) p.push(`versions.${vid}：版本只有 ${VERSION_IDS.join('、')}`)
      if (!isRecord(v)) {
        p.push(`versions.${vid}：要是 { text, stages }`)
        continue
      }
      if (!isText(v.text)) p.push(`versions.${vid}.text 要是這個版本開頭的一句話`)
      if ((v.stages === undefined) === (v.options === undefined)) p.push(`versions.${vid}：要剛好寫 stages 或 options 其中一種`)
      else if (v.stages !== undefined) {
        if (!Array.isArray(v.stages) || v.stages.length === 0) p.push(`versions.${vid}.stages 要是一段一段的陣列`)
        else v.stages.forEach((s, i) => p.push(...stageProblems(k, s, `versions.${vid}.stages[${i}]`, phase, state)))
      } else p.push(...optionListProblems(k, v.options, `versions.${vid}.options`, phase, state))
    }
  } else {
    if (!isText(e.text)) p.push('text 要是事件開頭的一句話')
    if (e.stages !== undefined) {
      if (!Array.isArray(e.stages) || e.stages.length === 0) p.push('stages 要是一段一段的陣列')
      else e.stages.forEach((s, i) => p.push(...stageProblems(k, s, `stages[${i}]`, phase, state)))
    } else p.push(...optionListProblems(k, e.options, 'options', phase, state))
  }
  if (p.length > 0) return p
  // inherit 要指得到：每個版本都解一遍
  for (const v of versionsOf(e)) {
    const r = resolveBody(e, v)
    if (typeof r === 'string') p.push(`${v}：${r}`)
  }
  if (p.length > 0 || phase === 'load') return p
  // chain：對象要存在，而且被帶出來的那一件不能再帶（只連一層；EVENTS 第 5 節）
  for (const target of new Set(everyOption(e).flatMap(chainsOf))) {
    const t = k.content.get<EventBodyFields>('event', target)
    if (!t) p.push(`chain 指到的事件 ${target} 查不到`)
    else if (t.blocking !== false && hasChain(t)) p.push(`chain 指到的事件 ${target} 自己也有 chain：事件只能連一層（被帶出來的那件不能再帶；更長的鏈用特殊任務寫）`)
  }
  return p
}
