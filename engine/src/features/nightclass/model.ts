// L6 功能 nightclass 的資料與純函式：夜課的規則（night_rule）、技能的讀法、誰學會了什麼、性經歷與傾向的讀法。不碰登錄表（登錄在 index.ts）。
// 規格：LEWD_SYSTEM 第 10 節；NIGHT_LESSONS 開頭的「寫法的約定」與共通的開階表；DATA 3.1、3.2 節；dev/adr/0019 第十節、P31、P32。
// 不 import scene、lewd、abilities：night_skill 與 position 的格式、actor.ext.scene、actor.ext.sex_record、actor.ext.tendency 只認 DATA 的樣子。

import type { Actor, Condition, ContentEntry, Kernel } from '../../core'
import { clone, isRecord, isSafeInt } from '../../core'

export const OWNER = 'nightclass'
export const RULE_KIND = 'night_rule'
/** 內容種類（scene 定義；這個功能只讀） */
export const SKILL_KIND = 'night_skill'
export const POSITION_KIND = 'position'
/** 體悟：量表 insight（scene 定義；單一、不分對象，鍵固定是 _） */
export const INSIGHT_METER = 'insight'
export const INSIGHT_KEY = '_'

export const BRANCHES = ['common', 'relation', 'sense', 'body', 'costume'] as const
export type Branch = (typeof BRANCHES)[number]
export const isBranch = (v: unknown): v is Branch => (BRANCHES as readonly unknown[]).includes(v)
export const BRANCH_NAME: Record<Branch, string> = { common: '共通', relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
export const TIER_STAT = (branch: Branch): string => `night_tier_${branch}`
export const TIER_MAX = 5

export const AXES = ['relation', 'sense', 'body', 'costume'] as const
export type Axis = (typeof AXES)[number]
export const AXIS_NAME: Record<Axis, string> = { relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
const isAxis = (v: unknown): v is Axis => (AXES as readonly unknown[]).includes(v)
/** 「只掛軸」的技能：tag 寫軸的 id 或名字（不要求這個人有任何標籤） */
const AXIS_TAGS: readonly string[] = [...AXES, ...Object.values(AXIS_NAME), 'common', '共通']

export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
export type BridgeParam = (typeof BRIDGE_PARAMS)[number]
export const PARAM_NAME: Record<BridgeParam, string> = { sensitivity: '敏感度', tolerance: '耐受', craving: '慾求', docility: '馴化' }

export const LEARN_ACTION = 'nightclass.learn'
export const LEARN_OP = 'nightclass.learn'

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

// ---- 規則（night_rule，id: default，overridable） ----

export interface NightRules {
  /** 共通每一階要的性經歷：[次數, 對象的人數]，擇一達到就開（陣列的第 i 個是第 i + 1 階） */
  common_gates: Array<[number, number]>
  /** 沒寫 insight 的技能，學習花「階 × 這個數」點體悟 */
  insight_per_tier: number
  /** 其餘四個分支看哪一條軸的等級 */
  axis_of: Record<Exclude<Branch, 'common'>, Axis>
}

export const DEFAULT_NIGHT_RULES: NightRules = {
  common_gates: [[0, 0], [8, 5], [20, 8], [40, 12], [80, 20]],
  insight_per_tier: 10,
  axis_of: { relation: 'relation', sense: 'sense', body: 'body', costume: 'costume' },
}

const RULE_KEYS = ['common_gates', 'insight_per_tier', 'axis_of']

/** 規則資料的格式問題（只收和內建同一個形狀的鍵；每個鍵寫就整個換掉）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (key !== 'id' && !RULE_KEYS.includes(key)) p.push(`${key}：沒有這個規則`)
  const g = e.common_gates
  if (g !== undefined) {
    if (!Array.isArray(g) || g.length !== TIER_MAX) p.push(`common_gates 要有 ${TIER_MAX} 組：[次數, 對象的人數]，第 i 組是第 i 階的門檻`)
    else if (!g.every((x) => Array.isArray(x) && x.length === 2 && isInt(x[0]) && isInt(x[1]) && x[0] >= 0 && x[1] >= 0)) p.push('common_gates 的每一組要是兩個 0 以上的整數：[次數, 對象的人數]')
    else for (let i = 1; i < g.length; i++) if ((g[i] as number[])[0]! < (g[i - 1] as number[])[0]! || (g[i] as number[])[1]! < (g[i - 1] as number[])[1]!) p.push('common_gates 的門檻要一階比一階高（次數與人數都不能比前一階低）')
  }
  if (e.insight_per_tier !== undefined && !(isInt(e.insight_per_tier) && e.insight_per_tier >= 1)) p.push('insight_per_tier 要是 1 以上的整數')
  if (e.axis_of !== undefined) {
    const a = e.axis_of
    if (!isRecord(a)) p.push('axis_of 要是物件：分支 → 軸')
    else for (const [b, ax] of Object.entries(a)) {
      if (!isBranch(b) || b === 'common') p.push(`axis_of.${b}：只有 relation、sense、body、costume 這四個分支看軸`)
      else if (!isAxis(ax)) p.push(`axis_of.${b} 要是 ${AXES.join('、')} 其中一個`)
    }
  }
  return p
}

/** 現在生效的規則：資料 night_rule/default 蓋掉內建的。 */
export function nightRules(k: Pick<Kernel, 'content'>): NightRules {
  const out = clone(DEFAULT_NIGHT_RULES)
  const e = k.content.get(RULE_KIND, 'default') as (ContentEntry & Partial<NightRules>) | undefined
  if (!e || ruleProblems(e as unknown as Record<string, unknown>).length > 0) return out
  if (e.common_gates) out.common_gates = clone(e.common_gates)
  if (e.insight_per_tier !== undefined) out.insight_per_tier = e.insight_per_tier
  if (e.axis_of) out.axis_of = { ...out.axis_of, ...e.axis_of }
  return out
}

// ---- 讀角色身上的資料 ----

export interface Experience { times: number; partners: number; service_times: number; favorite: boolean }

/** 性經歷（actor.ext.sex_record；單人的次數另記 solo_times，不在 times 裡，所以不算）。 */
export function experienceOf(actor: Actor | undefined): Experience {
  const r = actor?.ext.sex_record
  const o = isRecord(r) ? r : {}
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
  const people = isRecord(o.people) ? Object.keys(o.people).length : 0
  return { times: num(o.times), partners: Math.max(num(o.partners), people), service_times: num(o.service_times), favorite: isText(o.favorite) }
}

/** 一條軸的等級（actor.ext.tendency.axes；沒有是 0）。 */
export function axisLevel(actor: Actor | undefined, axis: Axis): number {
  const v = actor && isRecord(actor.ext.tendency) && isRecord(actor.ext.tendency.axes) ? actor.ext.tendency.axes[axis] : undefined
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

/** 這個人有沒有這個傾向標籤（有或深；潛在不算）。 */
export function hasTag(actor: Actor | undefined, tag: string): boolean {
  const t = actor && isRecord(actor.ext.tendency) && isRecord(actor.ext.tendency.tags) ? actor.ext.tendency.tags[tag] : undefined
  return t === 'has' || t === 'deep'
}

/** 一個分支開到幾階（0～5；任何角色都算得出來）：共通看性經歷（次數或對象的人數擇一），其餘看那一條軸的等級。 */
export function computeTier(rules: NightRules, actor: Actor | undefined, branch: Branch): number {
  if (!actor) return 0
  if (branch === 'common') {
    const x = experienceOf(actor)
    let tier = 0
    rules.common_gates.forEach(([times, partners], i) => { if (x.times >= times || x.partners >= partners) tier = i + 1 })
    return tier
  }
  return Math.min(TIER_MAX, axisLevel(actor, rules.axis_of[branch]))
}

/** 這個人學會的夜課（actor.ext.scene.skills）與會的體位（actor.ext.scene.positions）。 */
export function learnedOf(actor: Actor | undefined): string[] {
  const r = actor?.ext.scene
  return isRecord(r) && textList(r.skills) ? r.skills : []
}
export function positionsOf(actor: Actor | undefined): string[] {
  const r = actor?.ext.scene
  return isRecord(r) && textList(r.positions) ? r.positions : []
}

// ---- 夜課技能的內容 ----

export interface NightRequires {
  bridge: Array<{ param: BridgeParam; bound: 'min' | 'max'; value: number }>
  experience: { times?: number; partners?: number; service_times?: number; favorite?: true }
  conditions: Condition[]
}

export interface NightSkill {
  id: string
  name: string
  branch: Branch
  tier: number
  /** 掛的標籤（tag）；沒寫是 null */
  tag: string | null
  /** 被內容篩選看的標籤：tag、tags、filters 合起來 */
  filterTags: string[]
  /** 資料寫的體悟；沒寫是 null（階 × insight_per_tier） */
  insight: number | null
  requires: NightRequires
}

interface Raw extends ContentEntry { name?: unknown; branch?: unknown; tier?: unknown; tag?: unknown; tags?: unknown; filters?: unknown; insight?: unknown; requires?: unknown }

function readRequires(raw: unknown): NightRequires {
  const out: NightRequires = { bridge: [], experience: {}, conditions: [] }
  if (!isRecord(raw)) return out
  if (isRecord(raw.bridge)) {
    for (const [key, v] of Object.entries(raw.bridge)) {
      const m = /^(sensitivity|tolerance|craving|docility)_(min|max)$/.exec(key)
      if (m && typeof v === 'number' && Number.isFinite(v)) out.bridge.push({ param: m[1] as BridgeParam, bound: m[2] as 'min' | 'max', value: v })
    }
  }
  if (isRecord(raw.experience)) {
    const x = raw.experience
    for (const key of ['times', 'partners', 'service_times'] as const) if (isInt(x[key]) && x[key] >= 0) out.experience[key] = x[key]
    if (x.favorite === true) out.experience.favorite = true
  }
  if (Array.isArray(raw.conditions)) out.conditions = raw.conditions.filter((c): c is Condition => isRecord(c) && isText(c.kind)).map((c) => clone(c))
  return out
}

function readSkill(e: Raw): NightSkill | null {
  if (!isBranch(e.branch) || !isSafeInt(e.tier) || e.tier < 1 || e.tier > TIER_MAX) return null
  const tag = isText(e.tag) ? e.tag : null
  return {
    id: e.id, name: isText(e.name) ? e.name : e.id, branch: e.branch, tier: e.tier, tag,
    filterTags: [...(tag ? [tag] : []), ...(textList(e.tags) ? e.tags : []), ...(textList(e.filters) ? e.filters : [])],
    insight: isInt(e.insight) && e.insight >= 1 ? e.insight : null, requires: readRequires(e.requires),
  }
}

/** 每一筆有合格 branch 與 tier 的夜課技能（照內容的順序）。 */
export function skillsOf(k: Pick<Kernel, 'content'>): NightSkill[] {
  return k.content.list<Raw>(SKILL_KIND).flatMap((e) => { const s = readSkill(e); return s ? [s] : [] })
}

export function skillOf(k: Pick<Kernel, 'content'>, id: string): NightSkill | null {
  const e = k.content.get<Raw>(SKILL_KIND, id)
  return e ? readSkill(e) : null
}

/** 學這一招要花的體悟。 */
export const costOf = (rules: NightRules, s: NightSkill): number => s.insight ?? s.tier * rules.insight_per_tier

/** 載入完之後的格式問題：branch 與 tier 要合格（沒寫的技能不會被列出來，這裡不算錯；寫了卻不合格的才算）。 */
export function readyProblems(k: Pick<Kernel, 'content'>): string[] {
  const p: string[] = []
  for (const e of k.content.list<Raw>(SKILL_KIND)) {
    if (e.branch !== undefined && !isBranch(e.branch)) p.push(`${SKILL_KIND}/${e.id}：branch 要是 ${BRANCHES.join('、')} 其中一個`)
    if (e.tier !== undefined && !(isSafeInt(e.tier) && e.tier >= 1 && e.tier <= TIER_MAX)) p.push(`${SKILL_KIND}/${e.id}：tier 要是 1～${TIER_MAX} 的整數`)
  }
  return p
}

/** 這個人看得到這個技能嗎：標籤被內容篩選關掉的整個不列；掛在一個標籤上（不是共通、不是只掛軸）而這個人沒有的不列。回傳看不到的原因（看得到是 null）。 */
export function hiddenReason(rulesOff: readonly string[], actor: Actor | undefined, s: NightSkill): string | null {
  const off = s.filterTags.find((t) => rulesOff.includes(t))
  if (off !== undefined) return '這個技能被你的內容篩選關掉了。'
  if (s.branch === 'common' || s.tag === null || AXIS_TAGS.includes(s.tag)) return null
  return hasTag(actor, s.tag) ? null : '你還沒有這個技能掛的傾向標籤。'
}

/** 技能開放的體位（內容種類 position 裡 unlocked_by 是它的每一筆）。 */
export function unlockedPositions(k: Pick<Kernel, 'content'>, skillId: string): string[] {
  return k.content.list<ContentEntry & { unlocked_by?: unknown }>(POSITION_KIND).filter((p) => p.unlocked_by === skillId).map((p) => p.id)
}
