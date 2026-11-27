// L6 功能 media 的剪與偽造（MEDIA 第 3 節；dev/adr/0020 第一節、V7、V8；dev/work/M5-media-cut.md）。
// 入口都是「回傳報告草稿」，不成立丟 ActionBlocked（原因寫成給玩家看的完整句子）。
//   cut      一到三段素材 + 一個角度 → 一支片：每段來源經 media.spend 扣 1、片的次數取來源剩最少的、三個數字照 MEDIA 第 3 節；
//            地點是自己的住處（條件 at_home）或帶 edit 欄位的設施，花一個時段（rules.cut.minutes）
//   recut    換角度（新角度仍要對得上來源的類型）、重算三個數字與 card；不動來源、不扣片的次數；每支片一次；要編制裡有製作（條件 channel_staff）
//   retitle  改片的標題與簡介（不花時間）：玩家寫的原樣存、不篩選不 trim，超過上限的照「字」截掉並在那一份報告提醒；不影響任何數字
//   forge    偽造一段素材：地點同剪片、花一個時段、擲介面（V7）
// 數字（看點、可信、風險）在剪的時候算好存在片上；標題與簡介只用在顯示、Material.title／intro 與上架那一份報告的 input。

import type { ActorId, CheckRoll, ClampNote, Condition, ContentEntry, GameState, Kernel, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { ActionBlocked, checkParts, checkPassChance, clamp, dcFor, isRecord, rollCheck } from '../../core'
import type { AngleEntry } from './angles'
import { angleOf, angleTakes, anglesOf } from './angles'
import { draftOf, spend } from './chain'
import type { CardInfo, Clip, Footage, Involves, MediaRules, MediaType } from './model'
import {
  CLIP_INTRO_MAX, CLIP_TITLE_MAX, CUT_ACTION, CUT_PICK_STAT, FORGE_ACTION, FORGE_BONUS_STAT, FORGE_QUALITY_STAT, RECUT_ACTION, RETITLE_ACTION, TYPES, TYPE_NAME,
  factionGrade, fameLevel, mediaRules, minutesNow, partyMax, readMedia,
} from './model'
import type { ClipInit } from './ops'
import type { Pov } from './pov'
import { povKey, povParts } from './pov'

const FACILITY_TYPE_KIND = 'facility_type'
const FORGE_ATTR = 'intellect'
const FORGE_SKILL = 'interface'
const FORGE_TYPES: MediaType[] = ['scandal', 'crime']

const len = (s: string): number => Array.from(s).length
const trunc = (s: string, max: number): string => (len(s) > max ? Array.from(s).slice(0, max).join('') : s)
const ctxOf = (k: Kernel, state: GameState) => ({ state, stats: k.stats, timeRules: k.timeRules })
const conditionOn = (k: Kernel, kind: string): boolean => k.conditions.kinds().includes(kind)

// ---- 地點 ----

export type EditPlace = { kind: 'home' } | { kind: 'facility'; type: string; name: string }

const hasEdit = (t: Record<string, unknown>): boolean => t.edit === true || isRecord(t.edit)

/** 現在站的地方能不能剪片、偽造：自己的住處（條件 at_home，不看等級），或帶 edit 欄位的設施（條件 at_facility）。 */
export function editPlace(k: Kernel, state: GameState): EditPlace | null {
  if (conditionOn(k, 'at_home') && k.conditions.test({ kind: 'at_home' } as Condition, ctxOf(k, state))) return { kind: 'home' }
  if (conditionOn(k, 'at_facility') && k.content.hasKind(FACILITY_TYPE_KIND)) {
    for (const t of k.content.list<ContentEntry & Record<string, unknown>>(FACILITY_TYPE_KIND)) {
      if (hasEdit(t) && k.conditions.test({ kind: 'at_facility', types: [t.id] } as Condition, ctxOf(k, state))) return { kind: 'facility', type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id }
    }
  }
  return null
}

const PLACE_TEXT = '剪片與偽造要在自己的住處，或有剪輯設備的地方（例如轉播站）。'

function envBlock(k: Kernel, state: GameState, action: string): string | null {
  return k.activity.blockOf(state, `commit:${action}`) ?? (editPlace(k, state) ? null : PLACE_TEXT)
}

// ---- 素材的選擇與角度 ----

/** 剪片的來源素材：一到三段、不重複、每一段還有至少 2 次（剪完不能是 0）。 */
export function partsOf(state: GameState, refs: string[]): { footage: Footage[]; why: string | null } {
  if (!Array.isArray(refs) || refs.length < 1) return { footage: [], why: '要先選一到三段素材。' }
  if (refs.length > 3) return { footage: [], why: '一支片最多用三段素材。' }
  if (new Set(refs).size !== refs.length) return { footage: [], why: '同一段素材不能選兩次。' }
  const m = readMedia(state)
  const footage: Footage[] = []
  for (const ref of refs) {
    const f = m.footage[ref]
    if (!f) return { footage: [], why: m.clips[ref] ? `「${m.clips[ref]!.title}」是一支片，不能再拿來剪。` : '素材庫裡沒有這件素材。' }
    if (f.uses <= 0) return { footage: [], why: `「${f.title}」已經用完了，只能留著當紀念。` }
    if (f.uses === 1) return { footage: [], why: `「${f.title}」只剩 1 次：剪完會是 0 次，片一出生就用完了，所以剪不了。` }
    footage.push(f)
  }
  return { footage, why: null }
}

const typeList = (a: AngleEntry): string => (a.types === 'any' ? '任何' : a.types.map((t) => TYPE_NAME[t]).join('、'))

/** 這個角度收不收這幾段（逐段對類型）；不收回完整的一句（寫出是哪一段、哪一型）。 */
function fitReason(a: AngleEntry, types: Array<{ title: string; type: MediaType }>): string | null {
  for (const p of types) if (!angleTakes(a, p.type)) return `「${p.title}」是${TYPE_NAME[p.type]}類的素材，${a.name}角度只收${typeList(a)}類，所以選不了。`
  return null
}

export interface AngleOption {
  id: string
  name: string
  group: AngleEntry['group']
  /** 進輿論戰時的樣子：line 說法、fuel 料、decoy 轉移焦點的燃料、null 不能當牌 */
  card: AngleEntry['card']
  can: boolean
  /** 選不了的原因（完整的一句）；選得了是 null */
  why: string | null
}

/** 這幾段素材現在七種角度各自選不選得了、為什麼（來源本身不能剪時，每一種的原因都是那一句）。 */
export function angleOptions(k: Kernel, state: GameState, parts: string[]): AngleOption[] {
  const got = partsOf(state, parts)
  return anglesOf(k).map((a) => {
    const why = got.why ?? fitReason(a, got.footage.map((f) => ({ title: f.title, type: f.type })))
    return { id: a.id, name: a.name, group: a.group, card: a.card, can: why === null, why }
  })
}

// ---- 三個數字 ----

export interface Part {
  label: string
  value: number
}

export interface Numbers {
  draw: number
  trust: number
  risk: number
  card: CardInfo | null
  parts: { draw: Part[]; trust: Part[]; risk: Part[] }
}

/** 勢力裡最高的等級（沒有涉及的勢力用 rules.risk.base；V8）。 */
export function topGrade(k: Kernel, factions: string[], rules: MediaRules): number {
  return factions.length > 0 ? Math.max(...factions.map((f) => factionGrade(k, f, rules))) : rules.risk.base
}

/** MEDIA 第 3 節的算式：看點、可信、風險（和每一項）。 */
export function clipNumbers(k: Kernel, state: GameState, o: { quality: number; angle: AngleEntry; types: MediaType[]; factions: string[]; celebrity: boolean; forged: boolean; pick?: 'draw' | 'trust' | null; pov?: { draw: Part[]; trust: Part[] } }, rules: MediaRules = mediaRules(k)): Numbers {
  const a = o.angle
  const sum = (ps: Part[]): number => ps.reduce((s, p) => s + p.value, 0)
  const add = (ps: Part[], label: string, value: number): void => { if (value !== 0) ps.push({ label, value }) }
  const draw: Part[] = [{ label: '品質', value: o.quality }]
  add(draw, `${a.name}角度`, a.draw)
  if (o.celebrity) add(draw, '涉及名人', rules.draw.celebrity)
  if (o.types.includes('intimate')) add(draw, '豔名', fameLevel(k, state, rules))
  // 視角的加成（某人的 POV、無人機、監視器）與多機位：一支片只要有一段來源符合就加一次（MEDIA 2.2、第 3 節）
  for (const p of o.pov?.draw ?? []) add(draw, p.label, p.value)
  if (o.pick === 'draw') add(draw, '剪輯的巧思', 1)
  const trust: Part[] = [{ label: '品質 × ' + rules.trust.mult, value: o.quality * rules.trust.mult }]
  add(trust, `${a.name}角度`, a.trust)
  if (o.forged) add(trust, '假料', -rules.trust.forged)
  for (const p of o.pov?.trust ?? []) add(trust, p.label, p.value)
  if (o.pick === 'trust') add(trust, '剪輯的巧思', 1)
  const risk: Part[] = [{ label: o.factions.length > 0 ? '涉及的勢力裡最高的等級' : '沒有涉及的勢力', value: topGrade(k, o.factions, rules) }]
  add(risk, `${a.name}角度`, a.risk)
  if (o.forged) add(risk, '假料', rules.risk.forged)
  const card: CardInfo | null = a.card === 'line' ? { kind: 'line', value: clamp(sum(trust), 0, rules.trust.max) } : a.card === 'fuel' ? { kind: 'fuel', value: Math.max(0, sum(draw)) } : a.card === 'decoy' ? { kind: 'decoy', value: 0 } : null
  return { draw: Math.max(0, sum(draw)), trust: clamp(sum(trust), 0, rules.trust.max), risk: Math.max(0, sum(risk)), card, parts: { draw, trust, risk } }
}

// ---- 剪 ----

export interface CutInput {
  /** 來源素材的 id（一到三段） */
  parts: string[]
  angle: string
  /** cut_pick 大於 0 才收：讓看點或可信 +1 */
  pick?: 'draw' | 'trust'
  /** 抹黑要指定：把責任導向的另一個勢力 */
  blame?: string
  /** 玩家自己取的標題與簡介：原樣存、不篩選不 trim；沒寫（空字串或不給）就用程式的模板 */
  title?: string
  intro?: string
}

export interface CutDetail {
  angle: string
  angle_name: string
  quality: number
  types: MediaType[]
  involves: Involves
  celebrity: boolean
  self: boolean
  adult: boolean
  forged: boolean
  exclusive: boolean
  /** 片的次數（來源扣完之後剩最少的那個） */
  uses: number
  draw: number
  trust: number
  risk: number
  card: CardInfo | null
  parts: Numbers['parts']
  pick: 'draw' | 'trust' | null
  /** 現在有沒有 cut_pick 可以選 */
  pick_can: boolean
  blame: string | null
  title: string
  intro: string
  /** 標題或簡介超過字數而被截掉的提醒 */
  notices: string[]
  clamps: ClampNote[]
  minutes: number
  sources: Array<{ ref: string; title: string; uses_after: number }>
}

export interface CutPreview {
  /** 現在剪得了嗎（地點、活動、來源、角度都過了） */
  ok: boolean
  /** 剪不了的原因（完整的一句）；剪得了是 null */
  block: string | null
  /** 三個數字與片的次數等；來源或角度本身就不成立時是 null（地點不對時照樣有） */
  detail: CutDetail | null
}

const nameOfFaction = (k: Kernel, id: string): string => {
  const n = k.content.hasKind('faction') ? k.content.get('faction', id)?.name : undefined
  return typeof n === 'string' && n ? n : id
}

function blameProblem(k: Kernel, a: AngleEntry, involved: string[], blame: string | undefined): string | null {
  if (a.id !== 'smear') return null
  if (typeof blame !== 'string' || blame === '') return '抹黑要指定把責任導向哪一個勢力。'
  if (k.content.hasKind('faction') && !k.content.has('faction', blame)) return '查不到你指定的那個勢力。'
  if (involved.includes(blame)) return `${nameOfFaction(k, blame)}就是片裡拍到的勢力，抹黑要把責任導向另一個勢力。`
  return null
}

const unionOf = <T>(lists: T[][]): T[] => [...new Set(lists.flat())]

/** 標題與簡介：玩家寫的原樣（超過上限的照「字」截掉並提醒），沒寫的用模板。 */
function textsOf(template: { title: string; intro: string }, o: { title?: unknown; intro?: unknown }): { title: string; intro: string; own_title: boolean; own_intro: boolean; notices: string[]; clamps: ClampNote[] } {
  const notices: string[] = []
  const clamps: ClampNote[] = []
  const field = (v: unknown, max: number, label: string, path: string, template: string): { text: string; own: boolean } => {
    if (typeof v !== 'string' || v === '') return { text: trunc(template, max), own: false }
    if (len(v) <= max) return { text: v, own: true }
    const notice = `${label}最多 ${max} 字，超過的部分沒有留下。`
    const kept = trunc(v, max)
    notices.push(notice)
    clamps.push({ path, from: v, to: kept, limit: max, notice })
    return { text: kept, own: true }
  }
  const t = field(o.title, CLIP_TITLE_MAX, '標題', 'clip.title', template.title)
  const i = field(o.intro, CLIP_INTRO_MAX, '簡介', 'clip.intro', template.intro)
  return { title: t.text, intro: i.text, own_title: t.own, own_intro: i.own, notices, clamps }
}

interface CutPlan {
  block: string | null
  detail: CutDetail | null
  footage: Footage[]
  init: ClipInit | null
}

function planCut(k: Kernel, state: GameState, o: CutInput): CutPlan {
  const env = envBlock(k, state, CUT_ACTION)
  const got = partsOf(state, o.parts)
  const angle = angleOf(k, o.angle)
  let structural: string | null = got.why
  if (!structural && !angle) structural = '沒有這種角度。'
  if (!structural && angle) structural = fitReason(angle, got.footage.map((f) => ({ title: f.title, type: f.type })))
  const involves: Involves = { factions: unionOf(got.footage.map((f) => f.involves.factions)), people: unionOf(got.footage.map((f) => f.involves.people)) }
  if (!structural && angle) structural = blameProblem(k, angle, involves.factions, o.blame)
  if (structural || !angle) return { block: env ?? structural, detail: null, footage: got.footage, init: null }

  const rules = mediaRules(k)
  const quality = clamp(Math.round(got.footage.reduce((s, f) => s + f.quality, 0) / got.footage.length), 1, 5)
  const types = TYPES.filter((t) => got.footage.some((f) => f.type === t))
  const forged = got.footage.some((f) => f.authentic === 'forged') || angle.id === 'smear'
  const celebrity = got.footage.some((f) => f.celebrity)
  const pickCan = partyMax(k, state, CUT_PICK_STAT) > 0
  const pick = pickCan && (o.pick === 'draw' || o.pick === 'trust') ? o.pick : null
  const pp = povParts(rules, got.footage.map((f) => ({ type: f.type, pov: f.pov, ...(f.event ? { event: f.event } : {}) })))
  const povs = got.footage.map((f) => f.pov).filter((p, i, all) => all.findIndex((q) => povKey(q) === povKey(p)) === i)
  const nums = clipNumbers(k, state, { quality, angle, types, factions: involves.factions, celebrity, forged, pick, pov: pp }, rules)
  const txt = textsOf({ title: `${angle.name}：${got.footage[0]!.title}`, intro: got.footage[0]!.text }, o)
  const uses = Math.min(...got.footage.map((f) => f.uses - 1))
  const tags = unionOf(got.footage.map((f) => f.tags ?? []))
  const detail: CutDetail = {
    angle: angle.id, angle_name: angle.name, quality, types, involves, celebrity, self: got.footage.some((f) => f.self), adult: got.footage.some((f) => f.adult), forged,
    exclusive: got.footage.every((f) => f.exclusive), uses, draw: nums.draw, trust: nums.trust, risk: nums.risk, card: nums.card, parts: nums.parts, pick, pick_can: pickCan,
    blame: angle.id === 'smear' ? (o.blame as string) : null, title: txt.title, intro: txt.intro, notices: txt.notices, clamps: txt.clamps, minutes: rules.cut.minutes,
    sources: got.footage.map((f) => ({ ref: f.id, title: f.title, uses_after: f.uses - 1 })),
  }
  const init: ClipInit = {
    from: got.footage.map((f) => f.id), angle: angle.id, title: txt.title, intro: txt.intro, ...(txt.own_title || txt.own_intro ? { titled: true as const } : {}),
    ...(txt.own_title ? { own_title: true as const } : {}), ...(txt.own_intro ? { own_intro: true as const } : {}),
    quality, types, involves, celebrity, self: detail.self, adult: detail.adult, forged, exclusive: detail.exclusive, draw: nums.draw, trust: nums.trust, risk: nums.risk, uses, card: nums.card,
    made_at: minutesNow(state), ...(pick ? { pick } : {}), ...(detail.blame ? { blame: detail.blame } : {}), ...(tags.length > 0 ? { tags } : {}),
    povs: povs as Pov[], pov_parts: pp,
  }
  return { block: env, detail, footage: got.footage, init }
}

/** 剪之前先看：三個數字、片的次數、標題與簡介；現在剪得了或剪不了的原因。 */
export function cutPreview(k: Kernel, state: GameState, o: CutInput): CutPreview {
  const p = planCut(k, state, o)
  return { ok: p.block === null && p.detail !== null, block: p.block, detail: p.detail }
}

export const cutBlock = (k: Kernel, state: GameState, o: CutInput): string | null => planCut(k, state, o).block

/** 剪：每段來源經 media.spend 扣 1、花一個時段、多一支片。 */
export function cut(k: Kernel, state: GameState, o: CutInput): ReportDraft {
  const p = planCut(k, state, o)
  if (p.block !== null || !p.detail || !p.init) throw new ActionBlocked(p.block ?? '現在剪不了片。')
  const d = p.detail
  const changes: ReportDraft['changes'] = [{ op: 'time', minutes: d.minutes }]
  for (const f of p.footage) {
    const sp = spend(k, state, { ref: f.id, how: 'cut' })
    if ('block' in sp) throw new ActionBlocked(sp.block)
    changes.push(...sp.changes)
  }
  changes.push({ op: 'media.clip', clip: p.init })
  const beat: TimelineBeat = {
    layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: `你把${p.footage.length}段素材剪成一支${d.angle_name}的片。`, tag: 'media.cut',
    data: { from: d.sources.map((s) => s.ref), angle: d.angle, quality: d.quality, uses: d.uses, draw: d.draw, trust: d.trust, risk: d.risk, forged: d.forged, titled: p.init.titled === true, parts: d.parts, ...(d.pick ? { pick: d.pick } : {}) },
  }
  const line = `你把${p.footage.length}段素材剪成了一支${d.angle_name}的片「${d.title}」。`
  return draftOf(state, CUT_ACTION, changes, 'cut', line, {
    timeline: [beat], narration: { results: [line, ...d.notices] }, ...(d.clamps.length > 0 ? { clamps: d.clamps } : {}), ...(p.init.titled ? { input: `${d.title}\n${d.intro}` } : {}),
  })
}

// ---- 重剪 ----

export interface RecutInput {
  ref: string
  angle: string
  blame?: string
}

/** 條件 channel_staff { role: 'producer' } 現在成立嗎（沒有人註冊這個條件就是不成立）。 */
function hasProducer(k: Kernel, state: GameState): boolean {
  return conditionOn(k, 'channel_staff') && k.conditions.test({ kind: 'channel_staff', role: 'producer' } as Condition, ctxOf(k, state))
}

interface RecutPlan {
  block: string | null
  patch: { angle: string; draw: number; trust: number; risk: number; card: CardInfo | null; forged: boolean; blame: string | null } | null
  clip: Clip | null
  angle: AngleEntry | null
}

/** 這支片現在能不能重剪（還沒選角度之前的條件）：活動、片在不在、用完沒有、重剪過沒有、有沒有製作。 */
export function recutReady(k: Kernel, state: GameState, ref: string): string | null {
  const act = k.activity.blockOf(state, `commit:${RECUT_ACTION}`)
  if (act) return act
  const clip = readMedia(state).clips[ref]
  if (!clip) return '素材庫裡沒有這支片。'
  if (clip.uses <= 0) return `「${clip.title}」已經用完了，只能留著當紀念。`
  if (clip.recut) return `「${clip.title}」已經重剪過了：每支片最多重剪一次。`
  if (!hasProducer(k, state)) return '要有製作才能重剪。'
  return null
}

function planRecut(k: Kernel, state: GameState, o: RecutInput): RecutPlan {
  const none = (block: string): RecutPlan => ({ block, patch: null, clip: null, angle: null })
  const ready = recutReady(k, state, o.ref)
  if (ready) return none(ready)
  const m = readMedia(state)
  const clip = m.clips[o.ref]!
  const angle = angleOf(k, o.angle)
  if (!angle) return none('沒有這種角度。')
  if (angle.id === clip.angle) return none(`「${clip.title}」本來就是${angle.name}的角度。`)
  const sources = clip.from.map((id) => m.footage[id]).filter((f): f is Footage => !!f)
  const fit = fitReason(angle, sources.length > 0 ? sources.map((f) => ({ title: f.title, type: f.type })) : clip.types.map((t) => ({ title: clip.title, type: t })))
  if (fit) return none(fit)
  const bp = blameProblem(k, angle, clip.involves.factions, o.blame)
  if (bp) return none(bp)
  const sourceForged = sources.length > 0 ? sources.some((f) => f.authentic === 'forged') : clip.forged && clip.angle !== 'smear'
  const forged = sourceForged || angle.id === 'smear'
  const nums = clipNumbers(k, state, { quality: clip.quality, angle, types: clip.types, factions: clip.involves.factions, celebrity: clip.celebrity, forged, pick: clip.pick ?? null, pov: clip.pov_parts ?? { draw: [], trust: [] } })
  return { block: null, patch: { angle: angle.id, draw: nums.draw, trust: nums.trust, risk: nums.risk, card: nums.card, forged, blame: angle.id === 'smear' ? (o.blame as string) : null }, clip, angle }
}

export const recutBlock = (k: Kernel, state: GameState, o: RecutInput): string | null => planRecut(k, state, o).block

/** 重剪：只改角度，重算三個數字與 card；不動來源、不扣片的次數、不花時間；每支片一次。 */
export function recut(k: Kernel, state: GameState, o: RecutInput): ReportDraft {
  const p = planRecut(k, state, o)
  if (p.block !== null || !p.patch || !p.clip || !p.angle) throw new ActionBlocked(p.block ?? '現在重剪不了。')
  const line = `你把「${p.clip.title}」重剪成${p.angle.name}的角度。`
  const beat: TimelineBeat = {
    layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: 'media.recut',
    data: { clip: p.clip.id, from_angle: p.clip.angle, angle: p.patch.angle, draw: p.patch.draw, trust: p.patch.trust, risk: p.patch.risk, forged: p.patch.forged },
  }
  return draftOf(state, RECUT_ACTION, [{ op: 'media.recut', ref: p.clip.id, ...p.patch }], 'recut', line, { timeline: [beat], narration: { results: [line] } })
}

// ---- 標題與簡介 ----

export const retitleBlock = (k: Kernel, state: GameState, ref: string, o: { title?: string; intro?: string }): string | null => {
  const act = k.activity.blockOf(state, `commit:${RETITLE_ACTION}`)
  if (act) return act
  if (!readMedia(state).clips[ref]) return '素材庫裡沒有這支片。'
  if (typeof o.title !== 'string' && typeof o.intro !== 'string') return '要寫標題或簡介其中一項。'
  return null
}

/**
 * 改片的標題與簡介（上架之前；不花時間）。給的欄位才改，給空字串是改回程式的模板，沒給的不動。
 * 玩家寫的原樣存（不篩選、不 trim、不改寫）；超過上限的照「字」截掉，並在這一份報告的 narration.results 與 clamps 提醒。
 */
export function retitle(k: Kernel, state: GameState, ref: string, o: { title?: string; intro?: string }): ReportDraft {
  const block = retitleBlock(k, state, ref, o)
  if (block) throw new ActionBlocked(block)
  const m = readMedia(state)
  const clip = m.clips[ref]!
  const first = m.footage[clip.from[0] ?? '']
  const t = textsOf({ title: `${angleOf(k, clip.angle)?.name ?? clip.angle}：${first?.title ?? clip.title}`, intro: first?.text ?? '' }, { title: o.title, intro: o.intro })
  const title = typeof o.title === 'string' ? t.title : clip.title
  const intro = typeof o.intro === 'string' ? t.intro : clip.intro
  const ownTitle = typeof o.title === 'string' ? t.own_title : clip.own_title === true
  const ownIntro = typeof o.intro === 'string' ? t.own_intro : clip.own_intro === true
  const notices = [...(typeof o.title === 'string' ? t.notices.filter((n) => n.startsWith('標題')) : []), ...(typeof o.intro === 'string' ? t.notices.filter((n) => n.startsWith('簡介')) : [])]
  const line = `你改了片「${title}」的標題與簡介。`
  return draftOf(state, RETITLE_ACTION, [{ op: 'media.retitle', ref, title, intro, own_title: ownTitle, own_intro: ownIntro }], 'retitled', line, {
    kind: 'system', narration: { results: [line, ...notices] }, ...(t.clamps.length > 0 ? { clamps: t.clamps } : {}), ...(ownTitle || ownIntro ? { input: `${title}\n${intro}` } : {}),
  })
}

// ---- 偽造 ----

export interface ForgeInput {
  /** 醜聞或罪證 */
  type: MediaType
  /** 涉及的勢力 */
  faction: string
}

export interface ForgeQuote {
  dc: number
  bonus: number
  chance: number
  minutes: number
  /** 成功、大成功、失敗各自的品質（已經加上 forge_quality） */
  quality: { ok: number; crit: number; fail: number }
}

export function forgeBlock(k: Kernel, state: GameState, o: ForgeInput): string | null {
  const env = envBlock(k, state, FORGE_ACTION)
  if (env) return env
  if (!state.pc || !state.actors[state.pc]) return '還沒有主角，沒有人可以偽造。'
  if (!FORGE_TYPES.includes(o.type)) return `偽造只做${FORGE_TYPES.map((t) => TYPE_NAME[t]).join('或')}類的素材。`
  if (typeof o.faction !== 'string' || o.faction === '') return '要指定這段畫面栽在哪一個勢力頭上。'
  if (k.content.hasKind('faction') && !k.content.has('faction', o.faction)) return '查不到你指定的那個勢力。'
  return null
}

/** 偽造的擲骰加值（屬性、基本功、被動的修正，加上 forge_bonus）。 */
function forgeParts(k: Kernel, state: GameState): RollPart[] {
  const bonus = partyMax(k, state, FORGE_BONUS_STAT)
  return [...checkParts(k.stats, state, state.pc as ActorId, { attr: FORGE_ATTR, skill: FORGE_SKILL, tags: ['forge'] }), ...(bonus !== 0 ? [{ label: '假料的手藝', value: bonus, source: 'situation' }] : [])]
}

/** 偽造的 DC、加值、成功率與三種結果的品質（畫面與草稿用同一份）；沒有主角是 null。 */
export function forgeQuote(k: Kernel, state: GameState): ForgeQuote | null {
  if (!state.pc || !state.actors[state.pc]) return null
  const rules = mediaRules(k)
  const dc = dcFor(rules.forge.dc, state.rules)
  const bonus = forgeParts(k, state).reduce((s, p) => s + p.value, 0)
  const fq = partyMax(k, state, FORGE_QUALITY_STAT)
  const q = (v: number): number => clamp(v + fq, 1, 5)
  return { dc, bonus, chance: checkPassChance(bonus, dc), minutes: rules.forge.minutes, quality: { ok: q(rules.forge.q_ok), crit: q(rules.forge.q_crit), fail: q(rules.forge.q_fail) } }
}

/** 偽造一段素材（V7）：在剪片的地方花一個時段，擲介面；產生一段 forged 的素材（醜聞或罪證，涉及指定的勢力，3 次）。 */
export function forge(k: Kernel, state: GameState, o: ForgeInput): ReportDraft {
  const block = forgeBlock(k, state, o)
  if (block) throw new ActionBlocked(block)
  const rules = mediaRules(k)
  const pc = state.pc as ActorId
  const m = readMedia(state)
  const dc = dcFor(rules.forge.dc, state.rules)
  const bonus = partyMax(k, state, FORGE_BONUS_STAT)
  const roll: CheckRoll = rollCheck(k.stats, state, {
    actor: pc, attr: FORGE_ATTR, skill: FORGE_SKILL, dc, purpose: `${FORGE_ACTION}/${m.seq}`, tags: ['forge'], ...(bonus !== 0 ? { situation: [{ label: '假料的手藝', value: bonus, source: 'situation' }] } : {}),
  })
  const base = roll.degree === 'critical' ? rules.forge.q_crit : roll.degree === 'success' ? rules.forge.q_ok : rules.forge.q_fail
  const quality = clamp(base + partyMax(k, state, FORGE_QUALITY_STAT), 1, 5)
  const name = nameOfFaction(k, o.faction)
  const title = `偽造的${name}${TYPE_NAME[o.type]}畫面`
  const footage = {
    title, text: `${title}。`, type: o.type, quality, authentic: 'forged' as const, exclusive: true, involves: { factions: [o.faction], people: [] as string[] }, uses: rules.uses,
    made_at: minutesNow(state), origin: 'own' as const, celebrity: false, self: false, adult: false,
  }
  const good = roll.degree === 'critical' || roll.degree === 'success'
  const line = good ? `你偽造了一段${name}的${TYPE_NAME[o.type]}畫面，做得很像真的。` : `你偽造了一段${name}的${TYPE_NAME[o.type]}畫面，只是做得粗糙。`
  const beat: TimelineBeat = {
    layer: 'meat', actor: pc, text: line, roll, tag: 'media.forge', data: { type: o.type, faction: o.faction, quality, degree: roll.degree, dc },
  }
  return draftOf(state, FORGE_ACTION, [{ op: 'time', minutes: rules.forge.minutes }, { op: 'rng', advance: 1 }, { op: 'media.make', footage }], roll.degree, line, { timeline: [beat], narration: { results: [line] } })
}

