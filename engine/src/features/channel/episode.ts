// L6 功能 channel 的開一集（MEDIA 4.3、4.3a、4.4；dev/adr/0020 第二節、V12～V14、V17～V20、V55；dev/work/M5-channel-shows.md「要做的」1～5、8）。
//   showOptions     每一種節目現在開不開得出來、為什麼（一條一個原因），與三檔成人檔各自開不開得出來
//   episodePreview  算式的每一項、難度、四種評價的機率與各自的結果（觀看、訂閱、公信力、推薦權重、廣告、打賞、效果）
//   airEpisode      開一集：付製作費（payFromBudget）、料各扣一次（掛點 media.spend，how 'episode'）、擲一次、評價、結算、發觸發點 episode
// 一集的流程：① 選節目、成人檔、1～3 件料、誰上鏡、帶哪些編制、掛不掛業配 → ② 付製作費與時間 → ③ 擲 1d20 ＋ 上鏡者在節目兩項基本功裡較高的一項 ＋ 設備 ＋ 編制 ＋ 料的加成 ＋ episode_bonus ＋ 掛點的加值，
// 對 12 − 推薦權重（＋沒有媒體型路數 3） → ④ 評價（核心的四級：翻車、普通、好、爆）→ 結算。數字都在規則表 channel_rule（model.ts）與節目的資料（shows.ts）。
// 用一件料只走 media.spend（變更併進這一份報告）；別人的量表（人氣、豔名）與效果只經 k.effects（沒有人註冊就略過），自己的量表（訂閱、公信力、推薦權重）直接用 meter 變更；任何入口都不給街頭信譽（V54）。
// 掛點 channel.episode（這個功能宣告並問；idol、abilities 回答）：問這一集多的選項、檢定的加值、各評價多給的效果、多花幾個時段。

import type { ActorId, AttrId, Change, Condition, ContentEntry, Effect, GameState, Kernel, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { ATTR_IDS, ActionBlocked, checkParts, clone, computeDegree, dcFor, deriveRng, effectCtx, makeCheck, meterOf, tagsAllowed, toMinutes } from '../../core'
import type { CheckRoll } from '../../core'
import type { Paid } from './budget'
import { payFromBudget, poolName } from './budget'
import type { GearPart } from './gear'
import { atHome, gearBonus } from './gear'
import type { Grade, Role, TierId } from './model'
import { CREDIBILITY, GRADES, GRADE_NAME, RECO, ROLES, ROLE_NAME, SUBS, TIER_IDS, TIER_NAME, channelRules, isText, readChannel } from './model'
import type { ShowEntry } from './shows'
import { acceptedTypes, gearOf, showOf, showsOf, typeText } from './shows'
import { actorName, busyReason, mediaTier } from './staff'

export const EPISODE_ACTION = 'channel.episode'
/** 每一集結算時帶的觸發點（EVENTS 3.1 節要補的；範圍 channel） */
export const EPISODE_TRIGGER = 'episode'
const EPISODE_STAT = 'episode_bonus'

// ---- 掛點的格式（media 的兩個掛點照 dev/adr/0020 第十三節自己再宣告一次；不 import 別的功能）----

/** 一件料（media 回的 Material；這裡只認用得到的欄位）。 */
export interface EpisodeMaterial {
  ref: string
  kind: 'footage' | 'clip'
  title: string
  types: string[]
  quality: number
  draw: number
  trust: number
  risk: number
  uses: number
  forged: boolean
  tags: string[]
}

export type EpisodeSpend = { changes: Change[]; material: EpisodeMaterial } | { block: string }

/** 這一集多出來的一個選項（例：握手會）。block 有寫就是灰的，寫的是原因。 */
export interface EpisodeOption {
  id: string
  name: string
  block: string | null
}

export interface EpisodeAsk {
  state: GameState
  show: ShowEntry
  tier: TierId
  host: string
  /** 帶來的編制 */
  staff: Array<{ role: Role; who: string }>
  where: { home: boolean; stage: StageInfo | null }
  materials: EpisodeMaterial[]
  /** 玩家選了哪些加開的（選項的 id） */
  options: string[]
}

export interface EpisodeAnswer {
  owner: string
  /** 這一集可以加開的選項 */
  options?: EpisodeOption[]
  /** 檢定的加值（一項一個標籤） */
  bonus?: Array<{ label: string; value: number }>
  /** 各評價多給的效果（'$host' 換成上鏡的人）；只有選了才該給 */
  on_grade?: Partial<Record<Grade, Effect[]>>
  /** 多花幾個時段 */
  extra_slots?: number
  /** 打賞再乘（例：握手會 ×1.5） */
  tips_mult?: number
  /** 給預覽看的說明句 */
  lines?: string[]
}

declare module '../../core' {
  interface HookMap {
    /** 開一集：問這一集多的選項、檢定的加值、各評價多給的效果、多花的時段（channel 宣告；idol、abilities 回答）。 */
    'channel.episode': [EpisodeAsk, EpisodeAnswer | void]
  }
}

// media 的兩個掛點（media.materials、media.spend）是 media 宣告的型別：這裡不 import 別的功能，也不重複宣告（同名的型別對不上），所以用字串名字問。
type AnyHook = (name: string, payload: unknown) => Array<{ owner: string; result: unknown }>
const askHook = (k: Kernel, name: string, payload: unknown): Array<{ owner: string; result: unknown }> => (k.hooks.run as unknown as AnyHook).call(k.hooks, name, payload)
const hookOwners = (k: Kernel, name: string): string[] => (k.hooks.owners as unknown as (n: string) => string[]).call(k.hooks, name)

// ---- 輸入與舞台 ----

export interface EpisodeInput {
  show: string
  /** 成人檔：all 全年齡（預設）、edgy 擦邊、adult 成人 */
  tier?: TierId
  /** 誰上鏡（預設主角；要在隊伍裡） */
  host?: string
  /** 放進去的料（素材 ft… 或片 cl…） */
  materials?: string[]
  /** 帶哪些編制（預設：有製作就帶製作） */
  staff?: Role[]
  /** 掛哪一家金主的業配（勢力 id） */
  plug?: string
  /** 加開的選項（掛點 channel.episode 給的選項 id） */
  options?: string[]
}

export interface StageInfo {
  /** 設施種類的 id */
  type: string
  name: string
  /** 舞台的大小（stage.size；製作費照它訂價） */
  size: string
  /** 檔期的條件（stage.requires；沒寫就是自己訂得到） */
  requires?: Condition
}

const FACILITY_TYPE_KIND = 'facility_type'

const ctxOf = (k: Kernel, state: GameState, actor?: string) => ({ state, stats: k.stats, timeRules: k.timeRules, ...(actor ? { actor } : {}) })
const conditionOn = (k: Pick<Kernel, 'conditions'>, kind: string): boolean => k.conditions.kinds().includes(kind)
const money = (n: number): string => n.toLocaleString('en-US')

/** 資料寫的條件現在成不成立：這一局沒有人註冊那種條件（那個功能沒裝）或格式不對，一律當不成立（不丟例外）。 */
function conditionHolds(k: Kernel, cond: Condition, ctx: ReturnType<typeof ctxOf>): boolean {
  try { return k.conditions.test(cond, ctx) } catch { return false }
}

function conditionWhy(k: Kernel, cond: Condition, ctx: ReturnType<typeof ctxOf>): string | null {
  try { return k.conditions.explain(cond, ctx) } catch { return null }
}

/** 現在站的地方是不是舞台（設施種類帶 stage: { size }；V20）。 */
export function stageHere(k: Kernel, state: GameState): StageInfo | null {
  if (!conditionOn(k, 'at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  for (const t of k.content.list<ContentEntry & Record<string, unknown>>(FACILITY_TYPE_KIND)) {
    const st = t.stage
    if (typeof st !== 'object' || st === null || Array.isArray(st) || !isText((st as { size?: unknown }).size)) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctxOf(k, state))) continue
    const req = (st as { requires?: unknown }).requires
    return { type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, size: (st as { size: string }).size, ...(typeof req === 'object' && req !== null && isText((req as { kind?: unknown }).kind) ? { requires: req as Condition } : {}) }
  }
  return null
}

// ---- 素材庫 ----

/** 素材庫裡還能用的料；沒有人回答 media.materials（沒裝 media）是 null。 */
export function library(k: Kernel, state: GameState): EpisodeMaterial[] | null {
  if (hookOwners(k, 'media.materials').length === 0) return null
  return askHook(k, 'media.materials', { state }).flatMap((r) => (Array.isArray(r.result) ? (r.result as EpisodeMaterial[]) : [])).filter((m) => m.uses > 0)
}

const NO_LIBRARY = '沒有素材庫。'

/** 這件料放不放得進這個節目（成人檔另收的算進去）：放不進回完整的一句（寫出是哪一件、差什麼）。 */
export function fitReason(show: ShowEntry, adult: boolean, m: EpisodeMaterial, state: Pick<GameState, 'rules'>): string | null {
  const accepts = acceptedTypes(show, adult)
  if (accepts !== 'any' && !m.types.some((t) => accepts.includes(t))) {
    return `「${m.title}」是${typeText(m.types)}類的料，${show.name}${adult ? '（成人檔）' : ''}只收${typeText(accepts)}類，放不進去。`
  }
  if (m.quality < show.min_quality) return `「${m.title}」的品質只有 ${m.quality}，${show.name}要 ${show.min_quality} 以上，還差 ${show.min_quality - m.quality}。`
  if (!tagsAllowed(state.rules, m.tags)) return `「${m.title}」這段素材的題材被你在內容篩選關掉了，放不進去。`
  return null
}

const needText = (show: ShowEntry, adult: boolean): string => `${show.min_quality > 1 ? `品質 ${show.min_quality} 以上、` : ''}${typeText(acceptedTypes(show, adult))}類的料`

// ---- 技能與路數 ----

const SKILL_ATTR: Record<string, AttrId> = {
  brawl: 'body', athletics: 'body', heavy: 'body', firearms: 'reflex', piloting: 'reflex', stealth: 'reflex', mechanics: 'tech', cyberware: 'tech', medicine: 'tech',
  interface: 'intellect', investigate: 'intellect', streetwise: 'intellect', intimidate: 'resolve', composure: 'resolve', sync: 'resolve', negotiate: 'charm', seduce: 'charm', perform: 'charm',
}

/** 一項基本功對應的屬性（內容 skill 有寫就用內容的，沒有就用內建的對照）。 */
function skillAttr(k: Pick<Kernel, 'content'>, skill: string): AttrId {
  const e = k.content.has('skill', skill) ? k.content.get<ContentEntry & { attr?: unknown }>('skill', skill) : undefined
  const a = e?.attr
  if (typeof a === 'string' && (ATTR_IDS as readonly string[]).includes(a)) return a as AttrId
  return SKILL_ATTR[skill] ?? 'charm'
}

// ---- 一集的規劃 ----

export interface RollInfo {
  /** 擲骰面以外的每一項加值 */
  parts: RollPart[]
  /** 這些加值的合計 */
  bonus: number
  dc: number
  dc_parts: Array<{ label: string; value: number }>
  /** 用的是節目兩項基本功裡較高的那一項 */
  skill: string
  attr: AttrId
}

interface Plan {
  input: EpisodeInput
  show: ShowEntry | null
  tier: TierId
  host: string | null
  blocks: string[]
  stage: StageInfo | null
  home: boolean
  materials: EpisodeMaterial[]
  brought: Array<{ role: Role; who: string }>
  cost: number | null
  paid: Paid[] | null
  pay: Change[]
  extra_slots: number
  minutes: number
  tips_mult: number
  answers: EpisodeAnswer[]
  options: Array<EpisodeOption & { owner: string; chosen: boolean }>
  bonus: Array<{ label: string; value: number }>
  gear: { total: number; raw: number; capped: boolean; parts: GearPart[] }
  roll: RollInfo | null
  on_grade: Partial<Record<Grade, Effect[]>>
  lines: string[]
  risk: { risk: number; chance: number } | null
  plug: { faction: string; pay: number } | null
  media_path: boolean
}

const tierOf = (v: unknown): TierId => ((TIER_IDS as readonly unknown[]).includes(v) ? (v as TierId) : 'all')

/** 這個節目這一集的製作費（公演照舞台的 size；寫不出來是 null）。 */
export function costOf(show: ShowEntry, stage: StageInfo | null): number | null {
  if (typeof show.cost === 'number') return show.cost
  if (!stage) return null
  const v = show.cost[stage.size]
  return typeof v === 'number' ? v : null
}

/** 節目與成人檔本身的限制（和料、編制無關）：頻道、活動、誰上鏡、條件、內容篩選、成人檔、舞台、製作費。一條一個原因。 */
function showBlocks(k: Kernel, state: GameState, show: ShowEntry, tier: TierId, host: string | null, stage: StageInfo | null, withCost: boolean): string[] {
  const out: string[] = []
  const rules = channelRules(k)
  const adult = tier !== 'all'
  if (!readChannel(state).open) return ['還沒有頻道，先開一個頻道。']
  const act = k.activity.blockOf(state, `commit:${EPISODE_ACTION}`)
  if (act) out.push(act)
  if (host === null) out.push('要先決定誰上鏡。')
  else {
    if (!Object.hasOwn(state.actors, host)) out.push(`查不到 ${host} 這個人，沒辦法上鏡。`)
    else if (!state.party.includes(host)) out.push(`${actorName(state, host)}不在你的隊伍裡，沒辦法上鏡。`)
    const busy = busyReason(state, host)
    if (busy) out.push(busy.replace('現在沒空', '現在沒空上鏡'))
    if (show.requires && Object.hasOwn(state.actors, host)) {
      const ctx = ctxOf(k, state, host)
      if (!conditionHolds(k, show.requires, ctx)) out.push(`「${show.name}」開不出來：${conditionWhy(k, show.requires, ctx) ?? '上鏡的人不符合條件'}。`)
    }
  }
  if (!tagsAllowed(state.rules, show.tags)) out.push(`「${show.name}」的題材被你在內容篩選關掉了。`)
  if (adult) {
    if (!tagsAllowed(state.rules, rules.tiers[tier].tags)) out.push(`${TIER_NAME[tier]}檔的題材被你在內容篩選關掉了。`)
    if (show.adult_needs_media && host !== null && Object.hasOwn(state.actors, host) && mediaTier(k, state, host) < 1) out.push(`沒有媒體型技能（主播、偶像的路數）的人，開不出「${show.name}」的${TIER_NAME[tier]}檔。`)
    if (show.adult_sizes && stage && !show.adult_sizes.includes(stage.size)) out.push(`「${show.name}」的${TIER_NAME[tier]}檔只開得出來在這幾種舞台：${show.adult_sizes.join('、')}（你在${stage.name}）。`)
  }
  if (show.venue === 'stage') {
    if (!stage) out.push(`「${show.name}」要站在舞台上（地下室、live house、劇場……），你現在不在舞台上。`)
    else if (stage.requires && !conditionHolds(k, stage.requires, ctxOf(k, state))) out.push(`${stage.name}的檔期要有門路：${conditionWhy(k, stage.requires, ctxOf(k, state)) ?? '現在訂不到'}。`)
  }
  if (withCost) {
    const cost = costOf(show, stage)
    if (cost === null) out.push(stage ? `${stage.name}（${stage.size}）沒有訂價，開不了「${show.name}」。` : `「${show.name}」要先站上舞台才知道製作費。`)
    else {
      const pay = payFromBudget(state, cost)
      if ('block' in pay) out.push(pay.block)
    }
  }
  return out
}

function checkedEffects(k: Kernel, state: GameState, list: Effect[] | undefined, host: string): Effect[] {
  const out: Effect[] = []
  for (const e of list ?? []) {
    const fx: Effect = Object.fromEntries(Object.entries(e).map(([key, v]) => [key, v === '$host' ? host : v])) as Effect
    if (!k.effects.has(fx.kind)) continue
    if (k.effects.validate([fx], effectCtx(k, state, { source: 'builtin' })).length > 0) continue
    out.push(fx)
  }
  return out
}

function planEpisode(k: Kernel, state: GameState, input: EpisodeInput): Plan {
  const rules = channelRules(k)
  const ch = readChannel(state)
  const show = showOf(k, input.show) ?? null
  const tier = tierOf(input.tier)
  const adult = tier !== 'all'
  const hostId = input.host ?? state.pc ?? null
  const stage = stageHere(k, state)
  const home = atHome(k, state)
  const plan: Plan = {
    input, show, tier, host: hostId, blocks: [], stage, home, materials: [], brought: [], cost: null, paid: null, pay: [], extra_slots: 0, minutes: 0, tips_mult: 1,
    answers: [], options: [], bonus: [], gear: { total: 0, raw: 0, capped: false, parts: [] }, roll: null, on_grade: {}, lines: [], risk: null, plug: null, media_path: false,
  }
  if (input.tier !== undefined && !(TIER_IDS as readonly unknown[]).includes(input.tier)) plan.blocks.push('成人檔只有全年齡、擦邊、成人三種。')
  if (!show) { plan.blocks.push(ch.open ? `沒有「${input.show}」這種節目。` : '還沒有頻道，先開一個頻道。'); return plan }
  plan.minutes = show.slots * rules.slot_minutes
  plan.blocks.push(...showBlocks(k, state, show, tier, hostId, stage, false))
  if (!ch.open) return plan

  // 製作費
  plan.cost = costOf(show, stage)
  if (plan.cost !== null) {
    const pay = payFromBudget(state, plan.cost)
    if ('block' in pay) plan.blocks.push(pay.block)
    else { plan.pay = pay.changes; plan.paid = pay.paid }
  } else if (show.venue !== 'stage' || stage) plan.blocks.push(stage ? `${stage.name}（${stage.size}）沒有訂價，開不了「${show.name}」。` : `「${show.name}」沒有訂價。`)

  // 料
  const lib = library(k, state)
  const refs = input.materials ?? []
  const [min, max] = show.materials
  if (lib === null && (min >= 1 || refs.length > 0)) plan.blocks.push(NO_LIBRARY)
  else {
    if (new Set(refs).size !== refs.length) plan.blocks.push('同一件料不能放兩次。')
    if (refs.length < min) plan.blocks.push(min === max ? `「${show.name}」要放 ${min} 件料，現在放了 ${refs.length} 件。` : `「${show.name}」至少要放 ${min} 件料，現在放了 ${refs.length} 件。`)
    if (refs.length > max) plan.blocks.push(min === max ? `「${show.name}」只能放 ${max} 件料，現在放了 ${refs.length} 件。` : `「${show.name}」最多放 ${max} 件料，現在放了 ${refs.length} 件。`)
    for (const ref of [...new Set(refs)]) {
      const m = lib?.find((x) => x.ref === ref)
      if (!m) { plan.blocks.push(`素材庫裡沒有「${ref}」這件料，或它已經用完了。`); continue }
      const why = fitReason(show, adult, m, state)
      if (why) plan.blocks.push(why)
      plan.materials.push(m)
    }
  }

  // 業配
  if (input.plug !== undefined) {
    const sp = ch.sponsors.find((s) => s.faction === input.plug)
    if (!sp) plan.blocks.push('你沒有這個金主的贊助，掛不了它的業配。')
    else if ((sp.tiers_off ?? []).includes(tier)) plan.blocks.push(`${poolName(k, sp.faction)}的贊助不接${TIER_NAME[tier]}檔，這一集不能掛它的業配。`)
    else plan.plug = { faction: sp.faction, pay: sp.plug_pay ?? 0 }
  }

  // 編制
  const want: Role[] = input.staff ?? (ch.staff.producer && !busyReason(state, ch.staff.producer.who) ? ['producer'] : [])
  for (const role of want) {
    const s = (ROLES as readonly unknown[]).includes(role) ? ch.staff[role] : undefined
    if (!s) { plan.blocks.push(`「${ROLE_NAME[role] ?? role}」的位子沒有人，帶不了。`); continue }
    const busy = busyReason(state, s.who)
    if (busy) { plan.blocks.push(busy.replace('現在沒空', '現在沒空跟你開節目')); continue }
    if (!plan.brought.some((b) => b.role === role)) plan.brought.push({ role, who: s.who })
  }

  if (hostId === null || !Object.hasOwn(state.actors, hostId)) return plan
  plan.media_path = mediaTier(k, state, hostId) >= 1

  // 掛點：多的選項、加值、各評價多給的效果、多花的時段
  const ask: EpisodeAsk = { state, show, tier, host: hostId, staff: plan.brought.map((b) => ({ ...b })), where: { home, stage }, materials: plan.materials.map((m) => ({ ...m })), options: [...(input.options ?? [])] }
  plan.answers = k.hooks.run('channel.episode', ask).map((r) => ({ ...r.result, owner: r.result.owner ?? r.owner }))
  const offered = plan.answers.flatMap((a) => (a.options ?? []).map((o) => ({ ...o, owner: a.owner, chosen: (input.options ?? []).includes(o.id) })))
  plan.options = offered
  for (const id of input.options ?? []) {
    const o = offered.find((x) => x.id === id)
    if (!o) plan.blocks.push(`這一集沒有「${id}」這個加開的選項。`)
    else if (o.block) plan.blocks.push(o.block)
  }
  plan.bonus = plan.answers.flatMap((a) => (a.bonus ?? []).filter((b) => Number.isFinite(b.value) && b.value !== 0).map((b) => ({ label: b.label, value: Math.trunc(b.value) })))
  plan.extra_slots = Math.max(0, plan.answers.reduce((s, a) => s + (Number.isSafeInteger(a.extra_slots) ? a.extra_slots! : 0), 0))
  plan.tips_mult = plan.answers.reduce((m, a) => (typeof a.tips_mult === 'number' && Number.isFinite(a.tips_mult) && a.tips_mult >= 0 ? m * a.tips_mult : m), 1)
  plan.lines = plan.answers.flatMap((a) => a.lines ?? [])
  for (const g of GRADES) {
    const list = [...(show.on_grade?.[g] ?? []), ...plan.answers.flatMap((a) => a.on_grade?.[g] ?? [])]
    if (list.length > 0) plan.on_grade[g] = list
  }
  plan.minutes = (show.slots + plan.extra_slots) * rules.slot_minutes

  // 檢定
  plan.gear = gearBonus(k, state, gearOf(show), rules.gear.cap)
  const reco = meterOf(k, state, RECO)
  const skill = best(show.skills.map((s) => ({ s, attr: skillAttr(k, s), sum: checkParts(k.stats, state, hostId as ActorId, { attr: skillAttr(k, s), skill: s, tags: ['episode', show.id] }).reduce((a, p) => a + p.value, 0) })))
  const situation: RollPart[] = []
  if (plan.gear.total !== 0) situation.push({ label: '設備', value: plan.gear.total, source: 'situation' })
  const producer = plan.brought.find((b) => b.role === 'producer')
  if (producer) situation.push({ label: producer && mediaTier(k, state, producer.who) >= 1 ? '製作（主播或偶像）' : '製作', value: mediaTier(k, state, producer.who) >= 1 ? rules.producer.media_bonus : rules.producer.bonus, source: 'situation' })
  const mb = materialBonus(show, plan.materials, rules)
  if (mb !== 0) situation.push({ label: '料的加成', value: mb, source: 'situation' })
  const eb = k.stats.hasStat(EPISODE_STAT) ? k.stats.stat(state, hostId as ActorId, EPISODE_STAT) : 0
  if (eb !== 0) situation.push({ label: '節目的加值', value: eb, source: 'situation' })
  for (const b of plan.bonus) situation.push({ label: b.label, value: b.value, source: 'situation' })
  const parts = checkParts(k.stats, state, hostId as ActorId, { attr: skill.attr, skill: skill.s, tags: ['episode', show.id] }, situation)
  const dcParts = [{ label: '基礎難度', value: rules.dc.base }, { label: '推薦權重', value: -reco }, ...(plan.media_path ? [] : [{ label: '沒有媒體型技能', value: rules.dc.no_media }])]
  const raw = dcParts.reduce((s, p) => s + p.value, 0)
  const dc = dcFor(raw, state.rules)
  if (dc !== raw) dcParts.push({ label: '難度設定', value: dc - raw })
  plan.roll = { parts, bonus: parts.reduce((s, p) => s + p.value, 0), dc, dc_parts: dcParts.filter((p) => p.value !== 0), skill: skill.s, attr: skill.attr }

  // 假料的風險
  const forged = plan.materials.filter((m) => m.forged)
  if (forged.length > 0) {
    const risk = Math.max(...forged.map((m) => m.risk))
    plan.risk = { risk, chance: Math.min(20, Math.max(0, risk)) / 20 }
  }
  return plan
}

const best = <T extends { sum: number }>(list: T[]): T => list.reduce((a, b) => (b.sum > a.sum ? b : a))

/** 料的加成：節目有 material_bonus 的（公演）照放進去的花絮件數；其餘是看點合計 ÷ div 捨去、最多 cap。 */
function materialBonus(show: ShowEntry, mats: EpisodeMaterial[], rules: ReturnType<typeof channelRules>): number {
  if (show.material_bonus) {
    const n = mats.filter((m) => m.types.some((t) => show.material_bonus!.types.includes(t))).length
    return Math.min(show.material_bonus.max, n * show.material_bonus.each)
  }
  return Math.min(rules.material.cap, Math.floor(mats.reduce((s, m) => s + m.draw, 0) / rules.material.div))
}

// ---- 結果 ----

export interface EpisodeResult {
  grade: Grade
  name: string
  /** 觀看 */
  views: number
  /** 訂閱的增減（成人檔的倍率只乘漲的；V14） */
  subs: number
  /** 公信力的增減（不含假料被拆穿的那一筆） */
  cred: number
  cred_parts: Array<{ label: string; value: number }>
  reco: number
  /** 上鏡的是主角才有的豔名 */
  fame: number
  /** 廣告收入（進預算的自有帳戶） */
  ad: number
  /** 打賞（觀看 × 0.02 × 成人檔的倍率）：進上鏡者的口袋 */
  tips: number
  /** 其中進主角口袋的（主角上鏡全拿、夥伴上鏡對半；V18） */
  tips_pc: number
  /** 業配另外進那個金主公帳的錢 */
  plug_pay: number
  /** 節目、掛點的 on_grade 與豔名的效果（這一局有人註冊的、驗過格式的） */
  effects: Effect[]
}

const scaleTrunc = (n: number): number => Math.sign(n) * Math.floor(Math.abs(n) + 1e-9)

function resultOf(k: Kernel, state: GameState, plan: Plan, grade: Grade): EpisodeResult {
  const rules = channelRules(k)
  const show = plan.show!
  const tier = rules.tiers[plan.tier]
  const g = rules.grades[grade]
  const host = plan.host!
  const subsNow = meterOf(k, state, SUBS)
  const credNow = meterOf(k, state, CREDIBILITY)
  const views = Math.floor(subsNow * g.views + 1e-9)
  const subs = scaleTrunc((subsNow * g.subs / 100) * (g.subs > 0 ? tier.subs : 1))
  const credParts: Array<{ label: string; value: number }> = []
  if (show.cred_affected) credParts.push({ label: `評價（${GRADE_NAME[grade]}）`, value: g.cred })
  if (plan.tier !== 'all') credParts.push({ label: `${TIER_NAME[plan.tier]}檔`, value: show.cred_affected ? tier.cred_hard : tier.cred })
  if (show.cred_affected && plan.materials.length > 0) {
    const avg = plan.materials.reduce((s, m) => s + m.trust, 0) / plan.materials.length
    if (avg >= rules.material.trust_hi) credParts.push({ label: '料很可信', value: 1 })
    else if (avg <= rules.material.trust_lo) credParts.push({ label: '料不太可信', value: -1 })
  }
  if (plan.plug) credParts.push({ label: '業配', value: rules.plug_cred })
  const cred = credParts.reduce((s, p) => s + p.value, 0)
  const reco = tier.reco !== 0 && !readChannel(state).week.adult_reco ? tier.reco : 0
  const ad = Math.floor(views * rules.ad.unit * (credNow / rules.ad.cred_div) * tier.ad + 1e-9)
  const tips = Math.floor(views * rules.tip_rate * tier.tips * plan.tips_mult + 1e-9)
  const tipsPc = host === state.pc ? tips : Math.floor(tips / 2)
  const fx: Effect[] = [...(plan.on_grade[grade] ?? [])]
  if (host === state.pc && tier.fame > 0) fx.push({ kind: 'fame', amount: tier.fame })
  return {
    grade, name: GRADE_NAME[grade], views, subs, cred, cred_parts: credParts.filter((p) => p.value !== 0), reco, fame: host === state.pc ? tier.fame : 0, ad, tips, tips_pc: tipsPc,
    plug_pay: plan.plug?.pay ?? 0, effects: checkedEffects(k, state, fx, host),
  }
}

const GRADE_OF: Record<string, Grade> = { fumble: 'flop', fail: 'ok', success: 'good', critical: 'hit' }

/** 四種評價各自的機率（百分比整數，加起來 100）：1d20 的每一面 5%，和實際擲出來的是同一套 computeDegree。 */
export function gradeChances(bonus: number, dc: number): Record<Grade, number> {
  const out: Record<Grade, number> = { flop: 0, ok: 0, good: 0, hit: 0 }
  for (let natural = 1; natural <= 20; natural++) out[GRADE_OF[computeDegree(natural, natural + bonus, dc)]!] += 5
  return out
}

// ---- 預覽 ----

export interface EpisodePreview {
  ok: boolean
  /** 第一條擋下的原因 */
  block: string | null
  /** 每一條原因（一條一個條件） */
  blocks: string[]
  show: { id: string; name: string } | null
  tier: TierId
  host: string | null
  where: { home: boolean; stage: StageInfo | null }
  cost: number | null
  paid: Paid[] | null
  /** 這一集花幾分鐘 */
  minutes: number
  materials: Array<{ ref: string; title: string; types: string[]; quality: number; draw: number; trust: number; forged: boolean }>
  brought: Array<{ role: Role; who: string; name: string }>
  roll: RollInfo | null
  gear: { total: number; raw: number; capped: boolean; parts: GearPart[] }
  /** 四種評價的機率（百分比，加起來 100）；沒有算式（節目或上鏡的人有問題）是 null */
  chance: Record<Grade, number> | null
  /** 四種評價各自的結果 */
  results: Record<Grade, EpisodeResult> | null
  options: Array<EpisodeOption & { owner: string; chosen: boolean }>
  /** 放了假料：擲 d20 小於等於風險就被拆穿（公信力 −expose） */
  risk: { risk: number; chance: number } | null
  /** 掛點回的說明句 */
  lines: string[]
  /** 播完可以直接開輿論戰（獨家） */
  scoop: boolean
}

/** 開一集之前先看：算式的每一項、難度、四種評價的機率與各自的結果、擋下的原因。 */
export function episodePreview(k: Kernel, state: GameState, input: EpisodeInput): EpisodePreview {
  const plan = planEpisode(k, state, input)
  const rollOk = plan.roll !== null && plan.show !== null && plan.host !== null
  return {
    ok: plan.blocks.length === 0, block: plan.blocks[0] ?? null, blocks: [...plan.blocks], show: plan.show ? { id: plan.show.id, name: plan.show.name } : null, tier: plan.tier, host: plan.host,
    where: { home: plan.home, stage: plan.stage }, cost: plan.cost, paid: plan.paid, minutes: plan.minutes,
    materials: plan.materials.map((m) => ({ ref: m.ref, title: m.title, types: [...m.types], quality: m.quality, draw: m.draw, trust: m.trust, forged: m.forged })),
    brought: plan.brought.map((b) => ({ ...b, name: actorName(state, b.who) })), roll: plan.roll, gear: plan.gear,
    chance: rollOk ? gradeChances(plan.roll!.bonus, plan.roll!.dc) : null,
    results: rollOk ? (Object.fromEntries(GRADES.map((g) => [g, resultOf(k, state, plan, g)])) as Record<Grade, EpisodeResult>) : null,
    options: plan.options, risk: plan.risk, lines: plan.lines, scoop: plan.show?.scoop === true && plan.materials.length > 0,
  }
}

// ---- 開一集 ----

const GRADE_LINE: Record<Grade, string> = { flop: '這一集翻車了，留言一片倒。', ok: '這一集的反應平平。', good: '這一集的反應很好。', hit: '這一集爆紅了。' }

/** 開一集的入口擋下的原因（成立是 null）。 */
export function airBlock(k: Kernel, state: GameState, input: EpisodeInput): string | null {
  return planEpisode(k, state, input).blocks[0] ?? null
}

/**
 * 開一集：付製作費、每件料經 media.spend 扣一次（變更併進這一份報告）、擲一次、評價、結算、發觸發點 episode。
 * 報告 kind broadcast、action channel.episode；結果的 data 帶評價、觀看、訂閱、公信力、廣告、打賞；獨家另帶 scoop（那一件的 ref）。
 */
export function airEpisode(k: Kernel, state: GameState, input: EpisodeInput): ReportDraft {
  const plan = planEpisode(k, state, input)
  if (plan.blocks.length > 0 || !plan.show || !plan.roll || plan.host === null) throw new ActionBlocked(plan.blocks[0] ?? '現在開不了這一集。')
  const rules = channelRules(k)
  const show = plan.show
  const host = plan.host
  const roll: CheckRoll = makeCheck({ natural: deriveRng(state.rng, `${EPISODE_ACTION}/${show.id}`).int(1, 20), parts: plan.roll.parts, dc: plan.roll.dc, attr: plan.roll.attr, skill: plan.roll.skill })
  const grade = GRADE_OF[roll.degree]!
  const res = resultOf(k, state, plan, grade)

  // 每件料扣一次（只走 media.spend）
  const spent: Change[] = []
  for (const m of plan.materials) {
    const answers = askHook(k, 'media.spend', { state, ref: m.ref, how: 'episode' })
    const a = answers[0]?.result as EpisodeSpend | undefined
    if (!a) throw new ActionBlocked(NO_LIBRARY)
    if ('block' in a) throw new ActionBlocked(a.block)
    spent.push(...a.changes)
  }

  // 假料的風險
  const die = plan.risk ? deriveRng(state.rng, `${EPISODE_ACTION}/risk`).int(1, 20) : null
  const exposed = plan.risk !== null && die !== null && die <= plan.risk.risk

  const effects = res.effects.length > 0 ? k.effects.resolve(res.effects, effectCtx(k, state, { source: 'builtin' })) : null
  const credTotal = res.cred - (exposed ? rules.expose : 0)
  const now = toMinutes(state.time)
  const ch = readChannel(state)
  const changes: Change[] = [{ op: 'time', minutes: plan.minutes }, ...plan.pay, ...spent, { op: 'rng', advance: 1 }]
  if (res.subs !== 0) changes.push({ op: 'meter', kind: SUBS, key: '_', delta: res.subs })
  if (credTotal !== 0) changes.push({ op: 'meter', kind: CREDIBILITY, key: '_', delta: credTotal })
  if (res.reco !== 0) changes.push({ op: 'meter', kind: RECO, key: '_', delta: res.reco })
  if (res.tips_pc > 0) changes.push({ op: 'cred', delta: res.tips_pc })
  if (res.ad > 0) changes.push({ op: 'channel.budget', pool: 'own', cred: res.ad })
  if (plan.plug && res.plug_pay > 0) changes.push({ op: 'channel.budget', pool: plan.plug.faction, cred: res.plug_pay, quota: Math.floor((res.plug_pay * rules.quota_pct) / 100) })
  changes.push({ op: 'channel.week', episodes: 1, ...(res.reco !== 0 ? { adult_reco: true } : {}) })
  for (const sp of ch.sponsors) changes.push({ op: 'channel.sponsor_set', faction: sp.faction, eps_since_plug: plan.plug?.faction === sp.faction ? 0 : sp.eps_since_plug + 1 })
  changes.push({
    op: 'channel.log',
    entry: { at: now, kind: 'show', show: show.id, tier: plan.tier, grade, subs: res.subs, tips: res.tips, note: `${show.name}：${GRADE_NAME[grade]}。` },
  })
  if (effects) changes.push(...effects.changes)

  const hostName = actorName(state, host)
  const lines: string[] = [`你開了一集「${show.name}」${plan.tier !== 'all' ? `（${TIER_NAME[plan.tier]}檔）` : ''}，由${hostName}上鏡。`, GRADE_LINE[grade]]
  if (res.ad > 0 || res.tips > 0) lines.push(`${res.ad > 0 ? '廣告帶來了一筆收入' : ''}${res.ad > 0 && res.tips > 0 ? '，' : ''}${res.tips > 0 ? '觀眾打賞了一些' : ''}。`)
  if (plan.plug) lines.push('你順便替金主掛了一則業配。')
  if (exposed) lines.push('藏在裡頭的假料被人拆穿了。')
  lines.push(...plan.lines)
  const scoop = show.scoop === true ? plan.materials[0]?.ref : undefined
  const data: Record<string, unknown> = {
    show: show.id, tier: plan.tier, host, grade, views: res.views, subs: res.subs, cred: credTotal, cred_parts: res.cred_parts, reco: res.reco, fame: res.fame, ad: res.ad, tips: res.tips, tips_pc: res.tips_pc,
    plug: plan.plug?.faction ?? null, plug_pay: res.plug_pay, cost: plan.cost, minutes: plan.minutes, materials: plan.materials.map((m) => m.ref), staff: plan.brought.map((b) => b.role),
    options: [...(input.options ?? [])], effect_lines: effects?.lines ?? [], exposed, ...(die !== null ? { risk_die: die } : {}), ...(scoop !== undefined ? { scoop } : {}),
  }
  const beat: TimelineBeat = { layer: 'meat', actor: host, text: lines[0]!, roll, tag: EPISODE_ACTION, data }
  const summary = `「${show.name}」${plan.tier !== 'all' ? `（${TIER_NAME[plan.tier]}檔）` : ''}：${GRADE_NAME[grade]}。觀看 ${money(res.views)}，訂閱 ${res.subs >= 0 ? '+' : '−'}${money(Math.abs(res.subs))}，廣告 ${money(res.ad)}，打賞 ${money(res.tips)}。`
  return {
    kind: 'broadcast', action: EPISODE_ACTION, location: clone(state.location), actor: host, party: [], timeline: [beat], changes,
    outcome: { result: grade, summary }, narration: { results: lines.slice(1) },
    ...(effects && effects.clamps.length > 0 ? { clamps: effects.clamps } : {}),
    triggers: [{ point: EPISODE_TRIGGER, where: { show: show.id, adult: plan.tier, grade, host } }],
  }
}

// ---- 每一種節目開不開得出來 ----

export interface ShowOption {
  id: string
  name: string
  can: boolean
  /** 第一條原因 */
  why: string | null
  /** 每一條原因（一條一個條件） */
  reasons: string[]
  /** 全年齡的製作費（公演站上舞台才知道；null） */
  cost: number | null
  minutes: number
  /** 要放幾件料：[最少, 最多] */
  materials: [number, number]
  /** 收什麼料（給玩家看的一句） */
  accepts: string
  /** 素材庫裡現在放得進這個節目的料有幾件 */
  fits: number
  venue: 'stage' | null
  /** 三檔成人檔各自開不開得出來 */
  tiers: Array<{ id: TierId; name: string; can: boolean; why: string | null }>
}

/**
 * 每一種節目現在開不開得出來與為什麼（上鏡的人預設主角、全年齡）：頻道、活動、條件、內容篩選、舞台、製作費、素材庫裡有沒有放得進去的料；
 * 灰的寫的是還差什麼（例：獨家還差一件品質 3 以上的罪證或醜聞）。題材被玩家關掉的節目與成人檔不列。
 */
export function showOptions(k: Kernel, state: GameState, o: { host?: string } = {}): ShowOption[] {
  const host = o.host ?? state.pc ?? null
  const stage = stageHere(k, state)
  const lib = library(k, state)
  const rules = channelRules(k)
  // 題材被玩家在內容篩選關掉的節目與那一檔不列（airEpisode 照樣擋，並寫原因）
  return showsOf(k).filter((show) => tagsAllowed(state.rules, show.tags)).map((show): ShowOption => {
    const reasons = showBlocks(k, state, show, 'all', host, stage, true)
    const fits = lib === null ? 0 : lib.filter((m) => fitReason(show, false, m, state) === null).length
    if (readChannel(state).open && show.materials[0] >= 1) {
      if (lib === null) reasons.push(NO_LIBRARY)
      else if (fits < show.materials[0]) reasons.push(`素材庫裡${fits === 0 ? '還沒有' : '只有 ' + fits + ' 件'}放得進「${show.name}」的料：要${needText(show, false)}，還差 ${show.materials[0] - fits} 件。`)
    }
    const tiers = TIER_IDS.filter((t) => tagsAllowed(state.rules, rules.tiers[t].tags)).map((t) => {
      const why = t === 'all' ? null : showBlocks(k, state, show, t, host, stage, false).filter((r) => !reasons.includes(r))[0] ?? null
      return { id: t, name: TIER_NAME[t], can: reasons.length === 0 && why === null, why: reasons[0] ?? why }
    })
    return {
      id: show.id, name: show.name, can: reasons.length === 0, why: reasons[0] ?? null, reasons, cost: costOf(show, stage), minutes: show.slots * rules.slot_minutes, materials: [...show.materials],
      accepts: `${typeText(acceptedTypes(show, false))}類、品質 ${show.min_quality} 以上`, fits, venue: show.venue ?? null, tiers,
    }
  })
}

