// L6 功能 scene 的夜課三處（M4-nightclass；LEWD_SYSTEM 第 10 節；NIGHT_LESSONS 開頭、共鳴表；dev/adr/0019 第十節、P31、P32）：
//   一、共鳴（內容種類 night_resonance）：場景開始時每個參與者每個分支開到第幾階（衍生數值 night_tier_<分支>，nightclass 定義，沒有人註冊當 0），
//       那一支 tier 不超過它的每一筆共鳴生效：rules 加在這個人自己用的規則數字上、free_switch、first_link_fit、end_fit、reveal。單人的場景只有 rules 生效。
//   二、「深」：一個掛在標籤上的技能，用的人那個標籤是「深」而且資料有 deep，用 deep 寫的數字蓋掉 scene 裡對應的數字。
//   三、NPC 會哪些（P32）：對方的 actor.ext.scene 沒有寫 skills 時，每個分支他開到的每一階各抽一個他看得到的技能（種子是他的 id）；體位是基本的加上這些技能開放的。
// 不 import nightclass：開階只問衍生數值，技能的 branch、tier、tag、filters 只認 DATA 3.1 節的格式。

import type { Actor, ActorId, ContentEntry, GameState, Kernel } from '../../core'
import { clone, deriveRng, isRecord } from '../../core'
import type { KnowRec, SceneDef, SceneRules } from './model'
import { NO_DIE, SKILL_KIND, POSITION_KIND, DEFAULT_SCENE_RULES, knowOf, parseDie } from './model'

export const BRANCHES = ['common', 'relation', 'sense', 'body', 'costume'] as const
export type Branch = (typeof BRANCHES)[number]
export const isBranch = (v: unknown): v is Branch => (BRANCHES as readonly unknown[]).includes(v)
export const BRANCH_NAME: Record<Branch, string> = { common: '共通', relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
export const TIER_STAT = (branch: Branch): string => `night_tier_${branch}`

export const AXES = ['relation', 'sense', 'body', 'costume'] as const
export type Axis = (typeof AXES)[number]
export const AXIS_NAME: Record<Axis, string> = { relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
/** 「只掛軸」的技能：tag 寫軸的 id 或名字（不要求這個人有任何標籤）。 */
const AXIS_TAGS: readonly string[] = [...AXES, ...Object.values(AXIS_NAME), 'common', '共通']

export const RESONANCE_KIND = 'night_resonance'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

// ---- 夜課技能多讀的欄位（DATA 3.1 節）：格式 ----

export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
const BRIDGE_KEY = /^(sensitivity|tolerance|craving|docility)_(min|max)$/
const EXPERIENCE_KEYS = ['times', 'partners', 'service_times', 'favorite']

/**
 * night_skill 多讀的 insight、requires、filters、deep 的格式問題（scene 的格式檢查收；欄位都是選填）。
 * branch 與 tier 在這裡不查（M2 起就說「其餘欄位收下不看」，只裝 scene 的場景不該因為它們擋下載入）：nightclass 的 ready 查，沒有合格 branch 與 tier 的技能學習那邊不列。
 */
export function nightFieldProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.insight !== undefined && !(isInt(e.insight) && e.insight >= 1)) p.push('insight 要是 1 以上的整數（學習要花的體悟）')
  if (e.filters !== undefined && !textList(e.filters)) p.push('filters 要是標籤的陣列（ntr、target_unwilling 這類額外跟著的篩選）')
  if (e.requires !== undefined) {
    const r = e.requires
    if (!isRecord(r)) p.push('requires 要是 { bridge?, experience?, conditions? }')
    else {
      for (const key of Object.keys(r)) if (!['bridge', 'experience', 'conditions'].includes(key)) p.push(`requires.${key}：只能寫 bridge、experience、conditions`)
      if (r.bridge !== undefined) {
        if (!isRecord(r.bridge)) p.push('requires.bridge 要是 { <參數>_min | <參數>_max: 數字 }')
        else for (const [key, v] of Object.entries(r.bridge)) if (!BRIDGE_KEY.test(key) || typeof v !== 'number' || !Number.isFinite(v)) p.push(`requires.bridge.${key}：要寫成 ${BRIDGE_PARAMS.join('、')} 加 _min 或 _max，值是數字`)
      }
      if (r.experience !== undefined) {
        if (!isRecord(r.experience)) p.push('requires.experience 要是 { times?, partners?, service_times?, favorite? }')
        else {
          for (const [key, v] of Object.entries(r.experience)) {
            if (!EXPERIENCE_KEYS.includes(key)) p.push(`requires.experience.${key}：只能寫 ${EXPERIENCE_KEYS.join('、')}`)
            else if (key === 'favorite' ? v !== true : !(isInt(v) && v >= 0)) p.push(`requires.experience.${key} 要是${key === 'favorite' ? ' true' : '非負整數'}`)
          }
        }
      }
      if (r.conditions !== undefined && !(Array.isArray(r.conditions) && r.conditions.every((c) => isRecord(c) && isText(c.kind)))) p.push('requires.conditions 要是條件的陣列：{ kind, ... }')
    }
  }
  if (e.deep !== undefined) {
    const d = e.deep
    if (!isRecord(d)) p.push('deep 要是 { on_use?, link? }')
    else {
      for (const key of Object.keys(d)) if (key !== 'on_use' && key !== 'link') p.push(`deep.${key}：只能寫 on_use、link`)
      for (const [part, keys] of [['on_use', ['my_load', 'their_load', 'fit', 'initiative']], ['link', ['my_load', 'their_load', 'fit']]] as const) {
        const v = d[part]
        if (v === undefined) continue
        if (!isRecord(v)) p.push(`deep.${part} 要是物件`)
        else {
          for (const [key, x] of Object.entries(v)) {
            if (!(keys as readonly string[]).includes(key)) p.push(`deep.${part}.${key}：只能寫 ${keys.join('、')}`)
            else if (key === 'fit' || key === 'initiative') {
              if (!isInt(x)) p.push(`deep.${part}.${key} 要是整數`)
            } else if (parseDie(x) === null) p.push(`deep.${part}.${key} 要是骰（例：2d6、1d6、0）`)
          }
        }
      }
    }
  }
  return p
}

// ---- 傾向（只認 DATA 第 8 節的格式） ----

/** 一個標籤現在的狀態（'latent' | 'has' | 'deep'）；沒有是 null。 */
export function tagStateOf(actor: Actor | undefined, tag: string): 'latent' | 'has' | 'deep' | null {
  const t = actor && isRecord(actor.ext.tendency) && isRecord(actor.ext.tendency.tags) ? actor.ext.tendency.tags[tag] : undefined
  return t === 'latent' || t === 'has' || t === 'deep' ? t : null
}

export const isDeepTag = (actor: Actor | undefined, tag: string | null): boolean => tag !== null && tagStateOf(actor, tag) === 'deep'

/** 一條軸的等級（0 以上的整數；沒有是 0）。 */
export function axisLevelOf(actor: Actor | undefined, axis: Axis): number {
  const v = actor && isRecord(actor.ext.tendency) && isRecord(actor.ext.tendency.axes) ? actor.ext.tendency.axes[axis] : undefined
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

// ---- 夜課技能：看得到哪些（NPC 會哪些用） ----

interface NightRaw extends ContentEntry { branch?: unknown; tier?: unknown; tag?: unknown; tags?: unknown; filters?: unknown }

/** 每一筆有合格 branch 與 tier 的夜課技能（照內容的順序）。 */
export function nightEntries(k: Pick<Kernel, 'content'>): Array<{ id: string; branch: Branch; tier: number; tag: string | null; filterTags: string[] }> {
  if (!k.content.hasKind(SKILL_KIND)) return []
  const out: Array<{ id: string; branch: Branch; tier: number; tag: string | null; filterTags: string[] }> = []
  for (const e of k.content.list<NightRaw>(SKILL_KIND)) {
    if (!isBranch(e.branch) || !isInt(e.tier) || e.tier < 1 || e.tier > 5) continue
    const tag = isText(e.tag) ? e.tag : null
    out.push({ id: e.id, branch: e.branch, tier: e.tier, tag, filterTags: [...(tag ? [tag] : []), ...(textList(e.tags) ? e.tags : []), ...(textList(e.filters) ? e.filters : [])] })
  }
  return out
}

/** 這個人看得到這一筆技能嗎：標籤（tag、tags、filters）被內容篩選關掉的整個不列；掛在一個標籤上（不是共通、不是只掛軸）而這個人沒有（有或深）的不列。 */
export function nightVisible(state: Pick<GameState, 'rules'>, actor: Actor | undefined, e: { branch: Branch; tag: string | null; filterTags: string[] }): boolean {
  if (e.filterTags.some((t) => state.rules.contentOff.includes(t))) return false
  if (e.branch === 'common' || e.tag === null || AXIS_TAGS.includes(e.tag)) return true
  const st = tagStateOf(actor, e.tag)
  return st === 'has' || st === 'deep'
}

/** 這個人這一支開到幾階（衍生數值 night_tier_<分支>；沒有人註冊是 0）。 */
export function tierOf(k: Pick<Kernel, 'stats'>, state: GameState, id: ActorId, branch: Branch): number {
  const stat = TIER_STAT(branch)
  return state.actors[id] && k.stats.hasStat(stat) ? k.stats.stat(state, id, stat) : 0
}

// ---- 三、NPC 會哪些夜課（P32） ----

/**
 * 對方沒寫 skills 時推出來的夜課（不存、每次由他的 id 當種子推，同一個人每次一樣）：每個分支、他開到的每一階，各抽一個他看得到的技能；
 * 體位是這些技能開放的（基本的由 knownPositions 自己算）。主角、寫了 skills 的人（固定 NPC 與學過的夥伴）、查不到角色的不推：回傳 null。
 */
export function npcKnow(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: ActorId): { skills: string[]; positions: string[] } | null {
  const a = state.actors[id]
  if (!a || id === state.pc) return null
  const raw = a.ext.scene
  if (isRecord(raw) && Array.isArray(raw.skills)) return null
  const all = nightEntries(k)
  if (all.length === 0) return null
  const rng = deriveRng({ seed: 0, cursor: 0 }, `night/npc/${id}`)
  const skills: string[] = []
  for (const branch of BRANCHES) {
    const tier = tierOf(k, state, id, branch)
    for (let t = 1; t <= tier; t++) {
      const cands = all.filter((e) => e.branch === branch && e.tier === t && nightVisible(state, a, e))
      if (cands.length > 0) skills.push(rng.pick(cands).id)
    }
  }
  if (skills.length === 0) return null
  const positions = k.content.hasKind(POSITION_KIND)
    ? k.content.list<{ id: string; unlocked_by?: unknown }>(POSITION_KIND).filter((p) => typeof p.unlocked_by === 'string' && skills.includes(p.unlocked_by)).map((p) => p.id)
    : []
  return { skills, positions }
}

/** 這個人會的（寫在 actor.ext.scene 的，加上沒寫 skills 的對方推出來的）。 */
export function knowFor(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: ActorId): KnowRec {
  const base = knowOf(state.actors[id])
  const d = npcKnow(k, state, id)
  return d ? { ...base, skills: d.skills, positions: [...new Set([...base.positions, ...d.positions])] } : base
}

// ---- 二、「深」 ----

/** 用的人那個標籤是「深」而且資料有 deep：用 deep 寫的數字蓋掉 scene 裡對應的數字（on_use 與 link 各鍵；沒有連接的技能不多出連接）。 */
export function applyDeep(def: SceneDef, deep: unknown): SceneDef {
  if (!isRecord(deep)) return def
  const out: SceneDef = { ...def, on_use: { ...def.on_use }, link: def.link ? { ...def.link } : null }
  const use = isRecord(deep.on_use) ? deep.on_use : {}
  const die = (v: unknown) => (v === undefined ? null : parseDie(v))
  const mu = die(use.my_load)
  const tu = die(use.their_load)
  if (mu) out.on_use.my_load = mu
  if (tu) out.on_use.their_load = tu
  if (isInt(use.fit)) out.on_use.fit = use.fit
  if (isInt(use.initiative)) out.on_use.init = use.initiative
  const link = isRecord(deep.link) ? deep.link : {}
  const hasLink = def.my_part.length > 0 || def.as_part !== undefined
  if (hasLink && Object.keys(link).length > 0) {
    const base = out.link ?? { my_load: NO_DIE, their_load: NO_DIE, fit: 0 }
    const ml = die(link.my_load)
    const tl = die(link.their_load)
    out.link = { my_load: ml ?? base.my_load, their_load: tl ?? base.their_load, fit: isInt(link.fit) ? link.fit : base.fit }
  }
  return out
}

// ---- 一、共鳴 ----

/** 共鳴的 rules 能寫的規則數字：都是「這個人自己用」的那幾個（其餘的路徑格式檢查擋下，免得寫了沒效果）。 */
const RESONANCE_RULES: readonly string[] = [
  'climax_init_self', 'climax_init_cause', 'restrain_base', 'glow_bonus', 'match_bonus', 'position_tag_fit', 'upper_drift', 'ap_regen', 'multi_dice_minus',
  ...(['dominate', 'yield', 'tease'] as const).flatMap((x) => (['their', 'mine', 'fit', 'init'] as const).map((y) => `${x}.${y}`)),
  ...(['dominate', 'yield', 'tease', 'restrain', 'talk', 'switch', 'move_circle', 'call', 'faster', 'slower'] as const).map((x) => `cost.${x}`),
  ...(['critical', 'success', 'fail', 'fumble'] as const).flatMap((x) => [`talk_fit.${x}`, `talk_goal.${x}`]),
]
const RESONANCE_KEYS = ['rules', 'free_switch', 'first_link_fit', 'end_fit', 'reveal']

/** 內容種類 night_resonance 的格式（NIGHT_LESSONS 共鳴表）。 */
export function resonanceProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isBranch(e.branch)) p.push(`branch 要是 ${BRANCHES.join('、')} 其中一個`)
  if (!(isInt(e.tier) && e.tier >= 1 && e.tier <= 5)) p.push('tier 要是 1～5 的整數')
  if (!isText(e.name)) p.push('要有 name')
  if (e.desc !== undefined && !isText(e.desc)) p.push('desc 要是一句話')
  const s = e.scene
  if (!isRecord(s)) return [...p, 'scene 要是 { rules?, free_switch?, first_link_fit?, end_fit?, reveal? }']
  for (const key of Object.keys(s)) if (!RESONANCE_KEYS.includes(key)) p.push(`scene.${key}：只能寫 ${RESONANCE_KEYS.join('、')}`)
  if (s.rules !== undefined) {
    if (!isRecord(s.rules)) p.push('scene.rules 要是 { 規則的路徑: 加減 }')
    else for (const [path, n] of Object.entries(s.rules)) {
      if (!RESONANCE_RULES.includes(path)) p.push(`scene.rules.${path}：不是這個人自己用的規則數字（可寫：${RESONANCE_RULES.join('、')}）`)
      else if (typeof n !== 'number' || !Number.isFinite(n)) p.push(`scene.rules.${path} 要是數字（加減）`)
    }
  }
  for (const key of ['free_switch', 'first_link_fit', 'end_fit'] as const) if (s[key] !== undefined && !(isInt(s[key]) && s[key] > 0)) p.push(`scene.${key} 要是 1 以上的整數`)
  if (s.reveal !== undefined && s.reveal !== 'axis' && s.reveal !== 'tag') p.push("scene.reveal 要是 'axis' 或 'tag'")
  return p
}

/** 一個人這一場生效的共鳴合起來。 */
export interface Resonance {
  rules: Record<string, number>
  /** 這一場第一次切換體位不花行動點的次數 */
  free_switch: number
  first_link_fit: number
  end_fit: number
  reveal: Array<'axis' | 'tag'>
  /** 生效的共鳴的 id */
  ids: string[]
}

export const EMPTY_RESONANCE: Resonance = { rules: {}, free_switch: 0, first_link_fit: 0, end_fit: 0, reveal: [], ids: [] }

interface ResonanceRaw extends ContentEntry { branch?: unknown; tier?: unknown; scene?: unknown }

/**
 * 這個人這一場生效的共鳴：每個分支開到第幾階（night_tier_*），那一支 tier 不超過它的每一筆。
 * 單人的場景只有 rules 生效（free_switch、first_link_fit、end_fit、reveal 都跟對象有關）。
 */
export function resonanceOf(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: ActorId, solo: boolean): Resonance {
  if (!k.content.hasKind(RESONANCE_KIND)) return EMPTY_RESONANCE
  const out: Resonance = { rules: {}, free_switch: 0, first_link_fit: 0, end_fit: 0, reveal: [], ids: [] }
  const tiers = new Map<Branch, number>()
  for (const e of k.content.list<ResonanceRaw>(RESONANCE_KIND)) {
    if (!isBranch(e.branch) || !isInt(e.tier) || !isRecord(e.scene)) continue
    let have = tiers.get(e.branch)
    if (have === undefined) tiers.set(e.branch, (have = tierOf(k, state, id, e.branch)))
    if (e.tier > have) continue
    out.ids.push(e.id)
    const s = e.scene
    if (isRecord(s.rules)) for (const [path, n] of Object.entries(s.rules)) if (RESONANCE_RULES.includes(path) && typeof n === 'number') out.rules[path] = (out.rules[path] ?? 0) + n
    if (solo) continue
    if (isInt(s.free_switch)) out.free_switch += s.free_switch
    if (isInt(s.first_link_fit)) out.first_link_fit += s.first_link_fit
    if (isInt(s.end_fit)) out.end_fit += s.end_fit
    if ((s.reveal === 'axis' || s.reveal === 'tag') && !out.reveal.includes(s.reveal)) out.reveal.push(s.reveal)
  }
  return out.ids.length > 0 ? out : EMPTY_RESONANCE
}

/** 把共鳴加的數字落在規則的一份複製上（只加 RESONANCE_RULES 裡的、已經存在的數字路徑；行動點花費最少 0）。沒有要加的回傳原本那一份。 */
export function withRules(base: SceneRules, add: Record<string, number>): SceneRules {
  const paths = Object.keys(add)
  if (paths.length === 0) return base
  const out = clone(base) as unknown as Record<string, unknown>
  for (const path of paths) {
    const parts = path.split('.')
    let o: unknown = out
    for (const part of parts.slice(0, -1)) o = isRecord(o) ? o[part] : undefined
    const key = parts[parts.length - 1]!
    if (isRecord(o) && typeof o[key] === 'number') o[key] = (o[key] as number) + add[path]!
  }
  const cost = (out.cost as Record<string, number>)
  for (const key of Object.keys(cost)) cost[key] = Math.max(0, cost[key]!)
  return out as unknown as SceneRules
}

/** 共鳴的 rules 路徑真的存在於規則（預設值）：給測試與格式檢查確認用。 */
export const resonanceRulePaths = (): string[] => RESONANCE_RULES.filter((path) => {
  let o: unknown = DEFAULT_SCENE_RULES
  for (const part of path.split('.')) o = isRecord(o) ? o[part] : undefined
  return typeof o === 'number'
})

// ---- 開場的摘要多給的（reveal） ----

export interface RevealView {
  id: string
  name: string
  /** 他最高的那一條軸（等級 0 的不給） */
  axis?: { id: Axis; name: string; level: number }
  /** 他有的一個標籤 */
  tag?: { id: string; name: string }
}

/** 場景開始時主角看得到的：每個對象最高的那一條軸（reveal: axis）或他有的一個標籤（reveal: tag）。沒有共鳴給這個、沒有對象時回傳 null。 */
export function revealFor(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, pc: ActorId, others: readonly ActorId[]): RevealView[] | null {
  const kinds = resonanceOf(k, state, pc, false).reveal
  if (kinds.length === 0 || others.length === 0) return null
  const out: RevealView[] = []
  for (const id of others) {
    const a = state.actors[id]
    if (!a) continue
    const v: RevealView = { id, name: a.name }
    if (kinds.includes('axis')) {
      let best: Axis | null = null
      for (const ax of AXES) if (axisLevelOf(a, ax) > (best ? axisLevelOf(a, best) : 0)) best = ax
      if (best) v.axis = { id: best, name: AXIS_NAME[best], level: axisLevelOf(a, best) }
    }
    if (kinds.includes('tag') && isRecord(a.ext.tendency) && isRecord(a.ext.tendency.tags)) {
      const tag = Object.keys(a.ext.tendency.tags).sort().find((t) => tagStateOf(a, t) === 'has' || tagStateOf(a, t) === 'deep')
      if (tag) v.tag = { id: tag, name: (k.content.get('tendency_tag', tag)?.name as string | undefined) ?? tag }
    }
    out.push(v)
  }
  return out
}

