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
/** 「只掛軸」的技能：tag 寫軸的 id 或 common（不要求這個人有任何標籤；中文名不收，M4-night-resonance）。 */
const AXIS_TAGS: readonly string[] = [...AXES, 'common']

export const RESONANCE_KIND = 'night_resonance'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

// ---- 夜課技能多讀的欄位（DATA 3.1 節）：格式 ----

export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
const BRIDGE_KEY = /^(sensitivity|tolerance|craving|docility)_(min|max)$/
const EXPERIENCE_KEYS = ['times', 'partners', 'service_times', 'favorite', 'bodies', 'look_mismatch']

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
        if (!isRecord(r.experience)) p.push('requires.experience 要是 { times?, partners?, service_times?, favorite?, bodies?, look_mismatch? }')
        else {
          for (const [key, v] of Object.entries(r.experience)) {
            if (!EXPERIENCE_KEYS.includes(key)) p.push(`requires.experience.${key}：只能寫 ${EXPERIENCE_KEYS.join('、')}`)
            else if (key === 'favorite' || key === 'look_mismatch' ? v !== true : !(isInt(v) && v >= 0)) p.push(`requires.experience.${key} 要是${key === 'favorite' || key === 'look_mismatch' ? ' true' : '非負整數'}`)
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

// ---- 穿著與開場（共鳴的 if 用） ----

type StyleKernel = Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>

/** 這個人這一層現在穿著這個風格嗎（現實看條件 style、內海看化身的 skin_style；沒有人註冊那個條件當作沒穿）。 */
export function wearsStyle(k: StyleKernel, state: GameState, id: ActorId, layer: 'meat' | 'net', tag: string): boolean {
  const kind = layer === 'net' ? 'skin_style' : 'style'
  if (!state.actors[id] || !k.conditions.kinds().includes(kind)) return false
  return k.conditions.test({ kind, tag }, { state, actor: id, stats: k.stats, timeRules: k.timeRules })
}

/** 穿著自己「有」的風格（傾向標籤是有或深、而且現在穿著那個風格）。 */
export function wearsOwnStyle(k: StyleKernel, state: GameState, id: ActorId, layer: 'meat' | 'net'): boolean {
  const a = state.actors[id]
  return !!a && Object.keys(isRecord(a.ext.tendency) && isRecord(a.ext.tendency.tags) ? a.ext.tendency.tags : {}).some((t) => (tagStateOf(a, t) === 'has' || tagStateOf(a, t) === 'deep') && wearsStyle(k, state, id, layer, t))
}

/** 這個人身上的風格和對方的標籤一致嗎：對方有（或深）的任何一個標籤，正是自己現在穿著的風格。 */
export function styleMatches(k: StyleKernel, state: GameState, me: ActorId, other: ActorId, layer: 'meat' | 'net'): boolean {
  const o = state.actors[other]
  return !!o && Object.keys(isRecord(o.ext.tendency) && isRecord(o.ext.tendency.tags) ? o.ext.tendency.tags : {}).some((t) => (tagStateOf(o, t) === 'has' || tagStateOf(o, t) === 'deep') && wearsStyle(k, state, me, layer, t))
}

/**
 * 開場時共鳴給這個人的主動權與契合（opening）：adjusted 是這一場的性質或身分有沒有調整開場的主動權（if: nature 看它）、if: own_style 看穿著。
 * 主動權加在這個人那一邊；契合是這一對的（任何一邊的共鳴都加）。
 */
export function openingOf(k: Pick<Kernel, 'content' | 'stats'> & StyleKernel, state: GameState, id: ActorId, o: { adjusted: boolean; layer: 'meat' | 'net'; solo: boolean }): { init: number; fit: number } {
  let init = 0
  let fit = 0
  for (const e of resonanceOf(k, state, id, o.solo).opening) {
    if (e.if === 'nature' && !o.adjusted) continue
    if (e.if === 'own_style' && !wearsOwnStyle(k, state, id, o.layer)) continue
    init += e.init
    fit += e.fit
  }
  return { init, fit }
}

// ---- 一、共鳴 ----

/** 共鳴的 rules 能寫的規則數字：都是「這個人自己用」的那幾個（其餘的路徑格式檢查擋下，免得寫了沒效果）。 */
const RESONANCE_RULES: readonly string[] = [
  'climax_init_self', 'climax_init_cause', 'restrain_base', 'glow_bonus', 'match_bonus', 'position_tag_fit', 'upper_drift', 'ap_regen', 'multi_dice_minus',
  ...(['dominate', 'yield', 'tease'] as const).flatMap((x) => (['their', 'mine', 'fit', 'init'] as const).map((y) => `${x}.${y}`)),
  ...(['dominate', 'yield', 'tease', 'restrain', 'talk', 'switch', 'move_circle', 'call', 'faster', 'slower'] as const).map((x) => `cost.${x}`),
  ...(['critical', 'success', 'fail', 'fumble'] as const).flatMap((x) => [`talk_fit.${x}`, `talk_goal.${x}`]),
]
const RESONANCE_KEYS = ['rules', 'free_switch', 'first_link_fit', 'end_fit', 'reveal', 'per_round', 'link_bonus', 'keep_extra_links', 'once', 'opening', 'tease_flat', 'restrain_dice', 'load_cap', 'tease_exposure']

// ---- 共鳴多的幾種鍵（M4-night-resonance；NIGHT_LESSONS 二十五個共鳴）----
/** per_round 的 if：有束縛連接、有契約對象在場、主動權在極端（≥80 或 ≤20）、有人在看、對方的標籤和自己這身服裝的風格一致。 */
export const PER_ROUND_IFS = ['bind_link', 'contract_partner', 'init_extreme', 'watched', 'style_match'] as const
export type PerRoundIf = (typeof PER_ROUND_IFS)[number]
const isPerRoundIf = (v: unknown): v is PerRoundIf => (PER_ROUND_IFS as readonly unknown[]).includes(v)
/** bind_link 沒寫 tag 時，哪個標籤算束縛（資料可以在每一筆寫 tag 換掉）。 */
export const BIND_TAG = '束縛'
/** 每回合條件式的效果：fit、init 作用在每一個符合條件的對象上（主動權往這個人那一邊推）；load 的 other 落在每個符合條件的對象，self 每條一次。單人沒有對象：watched 的 other 落在自己。 */
export interface PerRoundEntry {
  if: PerRoundIf[]
  tag?: string
  effect: { fit: number; init: number; load_self: number; load_other: number }
}
export interface LinkBonusEntry { part?: string; extra: boolean; fit: number; solo: boolean }
/** 每場（scene）或每回合（round）一次的特殊動作：set_init（主動權直接設成 values 其中一個；行動）、fit_floor（契合不到 value 的拉到 value；行動）、free_tease（每回合第一次挑逗不花行動點）、no_glow（高潮不疊餘韻）、free_dress（脫換衣服的第一次不花行動點；dress 這個行動）。 */
export const ONCE_KINDS = ['set_init', 'fit_floor', 'free_tease', 'no_glow', 'free_dress'] as const
export type OnceKind = (typeof ONCE_KINDS)[number]
export const isOnceKind = (v: unknown): v is OnceKind => (ONCE_KINDS as readonly unknown[]).includes(v)
/** 每種 once 一場用一次，還是每回合用一次。 */
export const ONCE_SCOPE: Record<OnceKind, 'scene' | 'round'> = { set_init: 'scene', fit_floor: 'scene', free_tease: 'round', no_glow: 'scene', free_dress: 'scene' }
export interface OnceEntry { kind: OnceKind; values: number[]; value: number; ap: number }
/** 開場的數值：init 加在這個人那一邊的主動權、fit 加在契約合；if：nature（這一場的性質或身分有調整主動權時）、own_style（穿著自己「有」的風格時）。 */
export interface OpeningEntry { init: number; fit: number; if?: 'nature' | 'own_style' }
export const OPENING_IFS = ['nature', 'own_style'] as const

/** 骰字串（'1d3'）的格式：n 顆面數 s 的骰，不能是 0。 */
const dieText = (v: unknown): v is string => typeof v === 'string' && parseDie(v) !== null && parseDie(v)!.n > 0

function perRoundProblems(v: unknown): string[] {
  if (!Array.isArray(v)) return ['scene.per_round 要是 [{ if, effect }] 的陣列']
  const p: string[] = []
  v.forEach((e, i) => {
    const at = `scene.per_round[${i}]`
    if (!isRecord(e)) return void p.push(`${at} 要是 { if?, tag?, effect }`)
    for (const key of Object.keys(e)) if (!['if', 'tag', 'effect'].includes(key)) p.push(`${at}.${key}：只能寫 if、tag、effect`)
    const ifs = e.if === undefined ? [] : Array.isArray(e.if) ? e.if : [e.if]
    for (const x of ifs) if (!isPerRoundIf(x)) p.push(`${at}.if：${String(x)} 不是條件（${PER_ROUND_IFS.join('、')}）`)
    if (e.tag !== undefined && !isText(e.tag)) p.push(`${at}.tag 要是標籤的 id`)
    const f = e.effect
    if (!isRecord(f)) return void p.push(`${at}.effect 要是 { fit?, init?, load? }`)
    for (const key of Object.keys(f)) if (!['fit', 'init', 'load'].includes(key)) p.push(`${at}.effect.${key}：只能寫 fit、init、load`)
    for (const key of ['fit', 'init'] as const) if (f[key] !== undefined && !isInt(f[key])) p.push(`${at}.effect.${key} 要是整數`)
    if (f.load !== undefined) {
      if (!isRecord(f.load)) p.push(`${at}.effect.load 要是 { self?, other? }`)
      else for (const [key, n] of Object.entries(f.load)) if ((key !== 'self' && key !== 'other') || !isInt(n)) p.push(`${at}.effect.load.${key}：只能寫 self、other，值是整數`)
    }
    if (Object.keys(f).length === 0) p.push(`${at}.effect 是空的`)
  })
  return p
}

function onceProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['scene.once 要是 { kind, ... }']
  const p: string[] = []
  for (const key of Object.keys(v)) if (!['kind', 'values', 'value', 'ap'].includes(key)) p.push(`scene.once.${key}：只能寫 kind、values、value、ap`)
  if (!isOnceKind(v.kind)) return [...p, `scene.once.kind 要是 ${ONCE_KINDS.join('、')} 其中一個`]
  if (v.kind === 'set_init' && !(Array.isArray(v.values) && v.values.length > 0 && v.values.every((n) => isInt(n) && n >= 0 && n <= 100))) p.push('scene.once.values 要是 0～100 的整數陣列（主動權可以直接設成哪幾個數）')
  if (v.kind === 'fit_floor' && !(isInt(v.value) && v.value >= 1 && v.value <= 100)) p.push('scene.once.value 要是 1～100 的整數（契合拉到幾）')
  if (v.ap !== undefined && !(isInt(v.ap) && v.ap >= 0)) p.push('scene.once.ap 要是 0 以上的整數（行動點）')
  return p
}

function openingProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['scene.opening 要是 { init?, fit?, if? }']
  const p: string[] = []
  for (const key of Object.keys(v)) if (!['init', 'fit', 'if'].includes(key)) p.push(`scene.opening.${key}：只能寫 init、fit、if`)
  for (const key of ['init', 'fit'] as const) if (v[key] !== undefined && !isInt(v[key])) p.push(`scene.opening.${key} 要是整數`)
  if (v.init === undefined && v.fit === undefined) p.push('scene.opening 要寫 init 或 fit')
  if (v.if !== undefined && !(OPENING_IFS as readonly unknown[]).includes(v.if)) p.push(`scene.opening.if 要是 ${OPENING_IFS.join('、')} 其中一個`)
  return p
}

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
  if (s.per_round !== undefined) p.push(...perRoundProblems(s.per_round))
  if (s.link_bonus !== undefined) {
    if (!Array.isArray(s.link_bonus)) p.push('scene.link_bonus 要是 [{ part | extra_part, fit }] 的陣列')
    else s.link_bonus.forEach((b, i) => {
      const at = `scene.link_bonus[${i}]`
      if (!isRecord(b)) return void p.push(`${at} 要是 { part | extra_part, fit }`)
      for (const key of Object.keys(b)) if (!['part', 'extra_part', 'fit', 'solo'].includes(key)) p.push(`${at}.${key}：只能寫 part、extra_part、fit、solo`)
      if (b.solo !== undefined && b.solo !== true) p.push(`${at}.solo 要是 true（單人也生效；沒寫單人不生效）`)
      if ((b.part === undefined) === (b.extra_part === undefined)) p.push(`${at} 要寫 part 或 extra_part 其中一個`)
      if (b.part !== undefined && !isText(b.part)) p.push(`${at}.part 要是部位的 id`)
      if (b.extra_part !== undefined && b.extra_part !== true) p.push(`${at}.extra_part 要是 true`)
      if (!isInt(b.fit)) p.push(`${at}.fit 要是整數`)
    })
  }
  if (s.keep_extra_links !== undefined && s.keep_extra_links !== true) p.push('scene.keep_extra_links 要是 true')
  if (s.once !== undefined) p.push(...onceProblems(s.once))
  if (s.opening !== undefined) p.push(...openingProblems(s.opening))
  if (s.tease_flat !== undefined && !(isInt(s.tease_flat) && s.tease_flat > 0)) p.push('scene.tease_flat 要是 1 以上的整數（挑逗時對方的感載多幾點）')
  if (s.restrain_dice !== undefined && !dieText(s.restrain_dice)) p.push('scene.restrain_dice 要是骰（例：1d3；克制時自己的感載另外少這麼多）')
  if (s.load_cap !== undefined && !(isInt(s.load_cap) && s.load_cap !== 0)) p.push('scene.load_cap 要是整數（成人場景裡感載上限的加減）')
  if (s.tease_exposure !== undefined) {
    const t = s.tease_exposure
    if (!isRecord(t) || !isInt(t.per) || t.per < 1 || !isInt(t.max) || t.max < 1) p.push('scene.tease_exposure 要是 { per, max }（曝露度每高 1，挑逗時對方的感載多 per；最多 max）')
  }
  return p
}

/** 一個人這一場生效的共鳴合起來。 */
export interface Resonance {
  rules: Record<string, number>
  /** 每回合條件式的效果 */
  per_round: PerRoundEntry[]
  /** 依連接的部位加的持續契合 */
  link_bonus: LinkBonusEntry[]
  /** 切換體位（姿勢）時，這個人用多出來的部位建立的連接不重置 */
  keep_extra_links: boolean
  /** 每場或每回合一次的特殊動作與免費 */
  once: OnceEntry[]
  /** 開場的主動權與契合 */
  opening: OpeningEntry[]
  /** 挑逗時對方的感載多幾點（原始值，還沒乘敏感度與倍率） */
  tease_flat: number
  /** 克制時自己的感載另外少這些骰 */
  restrain_dice: string[]
  /** 成人場景裡感載上限的加減 */
  load_cap: number
  /** 曝露度每高 per，挑逗時對方的感載多 per，最多 max（沒有就是 null） */
  tease_exposure: { per: number; max: number } | null
  /** 這一場第一次切換體位不花行動點的次數 */
  free_switch: number
  first_link_fit: number
  end_fit: number
  reveal: Array<'axis' | 'tag'>
  /** 生效的共鳴的 id */
  ids: string[]
}

const blankResonance = (): Resonance => ({
  rules: {}, per_round: [], link_bonus: [], keep_extra_links: false, once: [], opening: [], tease_flat: 0, restrain_dice: [], load_cap: 0, tease_exposure: null,
  free_switch: 0, first_link_fit: 0, end_fit: 0, reveal: [], ids: [],
})
/** 單人也生效的 once：高潮不疊餘韻、脫換衣服（單人只有自己）。 */
const SOLO_ONCE: readonly OnceKind[] = ['no_glow', 'free_dress']

export const EMPTY_RESONANCE: Resonance = blankResonance()

interface ResonanceRaw extends ContentEntry { branch?: unknown; tier?: unknown; scene?: unknown }

/**
 * 這個人這一場生效的共鳴：每個分支開到第幾階（night_tier_*），那一支 tier 不超過它的每一筆。
 * 單人的場景只有 rules 生效（free_switch、first_link_fit、end_fit、reveal 都跟對象有關）。
 */
export function resonanceOf(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: ActorId, solo: boolean): Resonance {
  if (!k.content.hasKind(RESONANCE_KIND)) return EMPTY_RESONANCE
  const out: Resonance = blankResonance()
  const tiers = new Map<Branch, number>()
  for (const e of k.content.list<ResonanceRaw>(RESONANCE_KIND)) {
    if (!isBranch(e.branch) || !isInt(e.tier) || !isRecord(e.scene)) continue
    let have = tiers.get(e.branch)
    if (have === undefined) tiers.set(e.branch, (have = tierOf(k, state, id, e.branch)))
    if (e.tier > have) continue
    out.ids.push(e.id)
    const s = e.scene
    if (isRecord(s.rules)) for (const [path, n] of Object.entries(s.rules)) if (RESONANCE_RULES.includes(path) && typeof n === 'number') out.rules[path] = (out.rules[path] ?? 0) + n
    // 單人也生效的：只落在自己身上的（感載上限、克制、多出來的部位的連接、脫換衣服、高潮不疊餘韻）與看觀眾的（watched）；其餘看對象
    if (isInt(s.load_cap)) out.load_cap += s.load_cap
    if (isText(s.restrain_dice)) out.restrain_dice.push(s.restrain_dice)
    if (s.keep_extra_links === true) out.keep_extra_links = true
    if (Array.isArray(s.link_bonus)) for (const b of s.link_bonus) if (isRecord(b) && isInt(b.fit) && (!solo || b.solo === true)) out.link_bonus.push({ ...(isText(b.part) ? { part: b.part } : {}), extra: b.extra_part === true, fit: b.fit, solo: b.solo === true })
    if (isRecord(s.once) && isOnceKind(s.once.kind) && (!solo || SOLO_ONCE.includes(s.once.kind))) {
      out.once.push({ kind: s.once.kind, values: Array.isArray(s.once.values) ? s.once.values.filter(isInt) : [], value: isInt(s.once.value) ? s.once.value : 0, ap: isInt(s.once.ap) ? s.once.ap : 0 })
    }
    if (isRecord(s.opening) && (!solo || s.opening.if === 'own_style')) {
      out.opening.push({ init: isInt(s.opening.init) ? s.opening.init : 0, fit: isInt(s.opening.fit) ? s.opening.fit : 0, ...(s.opening.if === 'nature' || s.opening.if === 'own_style' ? { if: s.opening.if } : {}) })
    }
    if (Array.isArray(s.per_round)) {
      for (const e of s.per_round) {
        if (!isRecord(e) || !isRecord(e.effect)) continue
        const ifs = (e.if === undefined ? [] : Array.isArray(e.if) ? e.if : [e.if]).filter(isPerRoundIf)
        if (solo && !ifs.every((x) => x === 'watched')) continue
        if (solo && ifs.length === 0) continue
        const f = e.effect
        const load = isRecord(f.load) ? f.load : {}
        out.per_round.push({ if: ifs, ...(isText(e.tag) ? { tag: e.tag } : {}), effect: { fit: isInt(f.fit) ? f.fit : 0, init: isInt(f.init) ? f.init : 0, load_self: isInt(load.self) ? load.self : 0, load_other: isInt(load.other) ? load.other : 0 } })
      }
    }
    if (!solo && isRecord(s.tease_exposure) && isInt(s.tease_exposure.per) && isInt(s.tease_exposure.max)) {
      out.tease_exposure = { per: Math.max(out.tease_exposure?.per ?? 0, s.tease_exposure.per), max: (out.tease_exposure?.max ?? 0) + s.tease_exposure.max }
    }
    if (!solo && isInt(s.tease_flat)) out.tease_flat += s.tease_flat
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

