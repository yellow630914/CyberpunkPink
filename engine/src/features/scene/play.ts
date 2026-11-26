// L6 功能 scene 的一步一步：場景裡的行動、連接、感載與高潮、NPC 的一步、每回合的結算。全部是純的：
// 拿現在的狀態做一份工作副本（Play），照規則改它，改完由 end.ts 與 index.ts 把差異寫成報告的變更。
// 規格：LEWD_SYSTEM 3.5 節（一～六點、第八點）；CORE_RULES 4.2 節；dev/work/M2-scene.md；M4-scene-seats（座位：Play 裡的人一律是角色的 id）。

import type { ActorId, Condition, GameState, Kernel, RollPart, SyncGear, SyncRule, TimelineBeat } from '../../core'
import { SYNC_GEARS, attrMod, checkParts, clone, deriveRng, isRecord, isSyncGear, makeCheck, syncBlocks, syncRuleOf } from '../../core'
import type { ActionId, BodyRec, CircleRec, Die, Dice, EndReason, LinkRec, PairNature, PairRec, PositionEntry, SceneDef, SceneRaw, SceneRules, Seat, SoloPose } from './model'
import {
  ACTION_NAME, BASE_PARTS, NO_DIE, POSITION_KIND, TALK_PARTS, beat, bodyOf, dieRange, gearCapOf, gearIndexOf, hasTendencyTag, isNoDie, knowOf, knownAll, knownPositions, knownSkills, normalizeSeats,
  openingFit, openingInit, parseDie, partName, poseHasPart, poseReaches, rollDie, sceneDefOf, sceneRules, sensitivityOf, sexRecordOf, soloPoses, startGear, statOr, tendencyTagIds, MAX_LINES,
} from './model'
import type { OnceEntry, OnceKind, PerRoundEntry, Resonance } from './night'
import { BIND_TAG, ONCE_SCOPE, resonanceOf, styleMatches, withRules } from './night'
import { watchedNow } from './watch'

// ---- 輸入 ----

export interface PartPick { my_part?: string; their_part?: string }

/**
 * 玩家（與 NPC 的一步）的輸入。end_turn 不是第十種行動：把回合交出去，沒用完的行動點留到下回合。
 * target 是對誰（角色的 id；一對一時沒給就是對方）。
 */
export type SceneInput =
  | { kind: 'dominate' | 'yield' | 'tease' | 'restrain' | 'stop' | 'end_turn' | 'faster' | 'slower'; target?: ActorId }
  | { kind: 'skill'; id: string; pick?: PartPick; target?: ActorId }
  | { kind: 'item'; id: string; pick?: PartPick; target?: ActorId }
  | { kind: 'talk'; text?: string; pick?: PartPick; target?: ActorId }
  | { kind: 'switch'; position: string; target?: ActorId }
  | { kind: 'gear'; gear: SyncGear; target?: ActorId }
  /** 換圈（2 行動點）：離開這一圈，加入別的圈；circle 是別的圈的 id */
  | { kind: 'move_circle'; circle: string }
  /** 把別圈的一個人叫過來（1 行動點）；who 是他的 id */
  | { kind: 'call'; who: ActorId }
  /** 共鳴給的特殊動作（M4-night-resonance；每場一次）：set_init 把你和他的主動權直接設成 value（70 或 30）、fit_floor 把你和他的契合拉到共鳴寫的那個數 */
  | { kind: 'once'; id: 'set_init' | 'fit_floor'; value?: number; target?: ActorId }
  /** 脫下或換上一件衣服（共鳴 free_dress 給的行動；第一次不花行動點，之後照 cost.dress；只花行動點、記一行，真正的穿脫由 gear 在場景外做） */
  | { kind: 'dress' }

const KINDS: readonly string[] = ['dominate', 'yield', 'tease', 'restrain', 'stop', 'end_turn', 'skill', 'item', 'talk', 'switch', 'gear', 'move_circle', 'call', 'faster', 'slower', 'once', 'dress']

/** 輸入的格式問題（一句）；沒有問題是 null。 */
export function inputProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || typeof (input as { kind?: unknown }).kind !== 'string') return '要給一個行動：{ kind: ... }。'
  const i = input as Record<string, unknown>
  if (!KINDS.includes(i.kind as string)) return `沒有「${String(i.kind)}」這種行動。`
  if ((i.kind === 'skill' || i.kind === 'item') && (typeof i.id !== 'string' || !i.id)) return `${ACTION_NAME[i.kind]}要指明是哪一個（id）。`
  if (i.kind === 'switch' && (typeof i.position !== 'string' || !i.position)) return '切換體位（單人是切換姿勢）要指明換成哪一個（position）。'
  if (i.kind === 'gear' && !isSyncGear(i.gear)) return `換檔要指明換到哪一檔（gear：${SYNC_GEARS.join('、')}）。`
  if (i.kind === 'move_circle' && (typeof i.circle !== 'string' || !i.circle)) return '換圈要指明換到哪一圈（circle）。'
  if (i.kind === 'call' && (typeof i.who !== 'string' || !i.who)) return '叫人過來要指明叫誰（who）。'
  if (i.kind === 'once' && (i.id !== 'set_init' && i.id !== 'fit_floor')) return '夜課的功夫要指明是哪一個（id：set_init、fit_floor）。'
  if (i.kind === 'once' && i.value !== undefined && typeof i.value !== 'number') return 'value 要是數字。'
  if (i.target !== undefined && (typeof i.target !== 'string' || !i.target)) return 'target 要是角色的 id。'
  if (i.pick !== undefined) {
    const p = i.pick as Record<string, unknown>
    if (typeof p !== 'object' || p === null || (p.my_part !== undefined && typeof p.my_part !== 'string') || (p.their_part !== undefined && typeof p.their_part !== 'string')) return 'pick 要是 { my_part?, their_part? }。'
  }
  return null
}

/** 行動花幾點（技能與道具照自己的 scene.ap；w 是做的人，共鳴的行動點花費與「第一次切換體位不花」看他；沒給就是原本的規則數字）。 */
export function costOf(p: Play, input: SceneInput, w?: ActorId): number {
  switch (input.kind) {
    case 'switch': return w !== undefined && p.freeSwitch(w) ? 0 : (w !== undefined ? p.rulesFor(w) : p.rules).cost.switch
    case 'tease': return w !== undefined && p.freeTease(w) ? 0 : (w !== undefined ? p.rulesFor(w) : p.rules).cost.tease
    case 'dress': return w !== undefined && p.freeDress(w) ? 0 : (w !== undefined ? p.rulesFor(w) : p.rules).cost.dress
    case 'once': return (w !== undefined ? p.onceOf(w, input.id) : null)?.ap ?? 0
    case 'dominate': case 'yield': case 'restrain': case 'talk': case 'move_circle': case 'call': case 'faster': case 'slower':
      return (w !== undefined ? p.rulesFor(w) : p.rules).cost[input.kind]
    case 'skill': return sceneDefOf(p.k, 'skill', input.id)?.def.ap ?? 0
    case 'item': return sceneDefOf(p.k, 'item', input.id)?.def.ap ?? 0
    default: return 0
  }
}

/** 單人時一件技能或道具能不能用（資料的 solo 欄位；沒寫：道具 ok、技能 no）。 */
export function soloGate(def: Pick<SceneDef, 'solo'>, kind: 'skill' | 'item'): 'ok' | 'audience' | 'no' {
  return def.solo ?? (kind === 'item' ? 'ok' : 'no')
}

// ---- 配對：用哪個部位接對方的哪個部位 ----

interface PairCand { mine: string[]; theirs: string[]; tag: string | null; asPart?: string; double?: boolean }
type Pair = { mine: string; theirs: string }
export type PairResult = Pair | { reasons: string[] }

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const sameEnd = (a: readonly string[], role: string, part: string): boolean => a[0] === role && a[1] === part

/** AI 給的一串行動最多收幾個（再多的當作不合規丟掉）。 */
export const MAX_MOVES = 12

/** scene_talk 給的契合的範圍（AI_TASKS 4.2 節）：−5～+10；目的的進度 0～+20。 */
const TALK_ENV_FIT = [-5, 10] as const

/** 這一步的外面來的東西（SceneEnv 的一部分）：說話的結果。 */
export interface TalkEnv { fit: number; goal?: number; agree?: boolean }
/** 每個人各一份說話的結果：鍵是說話的人（角色的 id）。 */
export type TalkEnvs = Record<ActorId, TalkEnv>

export class Play {
  readonly s: SceneRaw
  readonly rules: SceneRules
  /** 場景裡每一個人的 id（這一圈的座位加別的圈的人），感載、餘韻、敏感度等都為他們各記一份 */
  readonly everyone: ActorId[]
  readonly load: Record<ActorId, number>
  readonly glow: Record<ActorId, number>
  readonly loadMax: Record<ActorId, number>
  readonly glowMax: Record<ActorId, number>
  readonly apMax: Record<ActorId, number>
  /** 人的敏感度有效值；一個部位受到的再加上 body 的修正（partMod） */
  readonly sens: Record<ActorId, number>
  /** 掛點 scene.body 問來的：多出來的部位、敏感度的修正、部位的標籤 */
  readonly body: Record<ActorId, BodyRec>
  /** 同步原則的表（核心）與每個人現在開得到的最高一檔 */
  readonly sync: SyncRule
  readonly gearCap: Record<ActorId, SyncGear>
  /** 這一步開始時的感載與餘韻（寫變更時算差） */
  readonly was: { load: Record<ActorId, number>; glow: Record<ActorId, number> }
  ended: EndReason | null = null
  /** 這一步的每一拍（給報告的 timeline） */
  beats: TimelineBeat[] = []
  /** 說話的原文（報告的 input） */
  said: string | undefined
  /** 用掉的消耗品 */
  consumed: string | null = null
  /** 外面（AI 的 scene_talk）給的說話結果：有的話這一步的說話用它，不擲檢定 */
  /** 外面來的說話結果，每個人一份（鍵是說話的人；SceneEnv.talk） */
  talkEnv: TalkEnvs | undefined
  /** 單人的姿勢（內建的五個加資料的）；不是單人時是空的 */
  readonly poses: SoloPose[]
  /** 每個人這一場生效的共鳴（M4-nightclass；沒有夜課、沒有共鳴的資料時每個人都是空的） */
  readonly res: Record<ActorId, Resonance>
  private readonly ruleCache = new Map<ActorId, SceneRules>()

  constructor(readonly k: Kernel, readonly state: GameState, scene: SceneRaw, readonly dice: Dice) {
    this.s = clone(scene)
    this.rules = sceneRules(k)
    this.poses = this.s.kind === 'solo' ? soloPoses(k) : []
    this.everyone = [...new Set([...this.s.seats.map((x) => x.id), ...this.s.circles.flatMap((c) => [...c.people, ...(c.out ?? [])])])].filter((id) => !!state.actors[id])
    const per = <T>(f: (id: ActorId) => T): Record<ActorId, T> => Object.fromEntries(this.everyone.map((id) => [id, f(id)])) as Record<ActorId, T>
    const mod = (id: ActorId, attr: 'resolve' | 'reflex' | 'charm'): number => attrMod(k.stats.effectiveAttr(state, id, attr))
    this.res = per((id) => resonanceOf(k, state, id, this.s.kind === 'solo'))
    // 共鳴 load_cap：成人場景裡感載上限的加減（只在場景裡有效，所以不走衍生數值；NIGHT_LESSONS 身體 2 階）
    // 進行中的場景裡，衍生數值 load_cap 已經帶著共鳴那一筆（被動效果的來源 night）：先扣掉再加，才不會算兩次（場景還沒開、在別的狀態上試算時沒有那一筆，扣的是 0）
    const nightCap = (id: ActorId): number => k.passives.parts(state, id, 'stat', 'load_cap').filter((x) => x.source === 'night').reduce((n, x) => n + x.value, 0)
    this.loadMax = per((id) => Math.max(1, statOr(k, state, id, 'load_cap', 20 + mod(id, 'resolve') * 3) - nightCap(id) + (this.res[id]?.load_cap ?? 0)))
    this.glowMax = per((id) => statOr(k, state, id, 'afterglow_cap', 3))
    this.apMax = per((id) => Math.max(1, statOr(k, state, id, 'ap_max', 4 + Math.floor((mod(id, 'reflex') + mod(id, 'charm')) / 2))))
    this.sens = per((id) => sensitivityOf(k, state, id))
    this.body = per((id) => bodyOf(k, state, id, this.s.layer))
    this.sync = syncRuleOf(k.content)
    this.gearCap = per((id) => gearCapOf(k, state, id))
    normalizeSeats(this.s, this.gearCap)
    this.load = per((id) => clamp(state.actors[id]!.load, 0, this.loadMax[id]! - 1))
    this.glow = per((id) => state.actors[id]!.afterglow)
    this.was = { load: { ...this.load }, glow: { ...this.glow } }
  }

  // ---- 基本的讀 ----

  get pc(): ActorId { return this.s.pc }
  /** 單人的一場（沒有對象、沒有主動權；契合換成節奏）。 */
  get solo(): boolean { return this.s.kind === 'solo' }
  /** 單人現在的姿勢（不是單人時是 null；姿勢的 id 查不到時退到第一個）。 */
  get pose(): SoloPose | null { return this.solo ? this.poses.find((x) => x.id === this.s.position) ?? this.poses[0] ?? null : null }
  /** 現在的體位（單人是姿勢）的名字。 */
  positionName(): string { return this.solo ? this.pose?.name ?? '' : this.pos.name }
  /** 一個體位或姿勢 id 的名字（查不到就是 id）。 */
  posNameOf(id: string): string { return (this.k.content.get(POSITION_KIND, id)?.name as string | undefined) ?? this.poses.find((x) => x.id === id)?.name ?? id }
  /** 這一圈每個人的 id（座位的順序，第一個是主角；含失神退出的）。 */
  get ids(): ActorId[] { return this.s.seats.map((x) => x.id) }
  /** 這一圈現在還在的人（沒退出）。 */
  activeIds(): ActorId[] { return this.s.seats.filter((x) => !x.out).map((x) => x.id) }
  /** 這一圈現在還在的、不是這個人的人。 */
  activeOthers(id: ActorId): ActorId[] { return this.activeIds().filter((x) => x !== id) }
  /** 一對一的對方（第一個還在的非主角座位；都退出了是第二個座位；沒有別人是主角自己）。 */
  get partnerId(): ActorId { return this.activeOthers(this.s.pc)[0] ?? this.s.seats.find((x) => x.id !== this.s.pc)?.id ?? this.s.pc }
  /** 主角對這個對象的那一份契合與主動權（沒有時給一份用不到的預設，不寫回去）。 */
  get pair(): PairRec { return this.s.pairs[this.partnerId] ?? { fit: 0, init: 50, first: false } }
  seat(id: ActorId): Seat { return this.s.seats.find((x) => x.id === id)! }
  isPc(id: ActorId): boolean { return id === this.s.pc }
  /** 一對一時的對方；沒有別人（單人）是它自己。 */
  opp(id: ActorId): ActorId { return this.activeIds().find((x) => x !== id) ?? this.ids.find((x) => x !== id) ?? id }
  /** 這個人在這一圈裡嗎（沒退出）。 */
  inCircle(id: ActorId): boolean { return this.s.seats.some((x) => x.id === id && !x.out) }
  /** 這個人現在和哪些人連著（照連接建立的順序；只算還在這一圈的）。 */
  linkedWith(id: ActorId): ActorId[] {
    const out: ActorId[] = []
    for (const l of this.s.links) {
      const o = l.by === id ? l.to : l.to === id ? l.by : null
      if (o !== null && this.inCircle(o) && !out.includes(o)) out.push(o)
    }
    return out
  }
  /** 這一步在算的「主角的那一對」：另一端是誰（P33：只有主角對每個人記契合與主動權；NPC 對 NPC 沒有）。 */
  ctx: ActorId | null = null
  ctxOf(a: ActorId, b: ActorId): ActorId | null {
    const x = this.isPc(a) ? b : this.isPc(b) ? a : null
    return x !== null && this.s.pairs[x] !== undefined ? x : null
  }
  /** w 與 t 這一對的契合與主動權記在哪個人名下（主角對他）：主角與別人才有（P33）；沒有是 null。 */
  pairIdOf(w: ActorId, t: ActorId): ActorId | null {
    const x = this.isPc(w) ? t : this.isPc(t) ? w : null
    return x !== null && this.s.pairs[x] !== undefined ? x : null
  }
  private pairAt(x?: ActorId): { id: ActorId; rec: PairRec } | null {
    const id = x ?? this.ctx ?? (this.activeOthers(this.s.pc).length === 1 ? this.activeOthers(this.s.pc)[0]! : null)
    const rec = id !== null ? this.s.pairs[id] : undefined
    return id !== null && rec ? { id, rec } : null
  }
  actor(id: ActorId) { return this.state.actors[id]! }
  /** 文字裡的稱呼：主角是「你」，別人是他的名字。 */
  name(id: ActorId): string { return this.isPc(id) ? '你' : this.actor(id).name }
  /** 一對一的舊名字（'pc' 或 'partner'）：報告的舊鍵與畫面資料用。 */
  who(id: ActorId): 'pc' | 'partner' { return this.isPc(id) ? 'pc' : 'partner' }
  get pos(): PositionEntry { return this.k.content.require<PositionEntry>(POSITION_KIND, this.s.position) }
  /**
   * 體位由誰決定（P34）：主角對這一圈每個人的主動權都在 50 以上時是主角；否則是主角對他主動權最低的那一個（一對一就是主動權在誰手上）。
   */
  decider(): ActorId {
    let low: ActorId | null = null
    for (const x of this.activeOthers(this.s.pc)) if (low === null || (this.s.pairs[x]?.init ?? 50) < (this.s.pairs[low]?.init ?? 50)) low = x
    return low === null || (this.s.pairs[low]?.init ?? 50) >= 50 ? this.s.pc : low
  }
  /** 一對一時的舊名字：主動權在誰手上（同 decider）。 */
  holder(): ActorId { return this.decider() }
  resolveMod(id: ActorId): number { return attrMod(this.k.stats.effectiveAttr(this.state, id, 'resolve')) }
  mult(id: ActorId): number { return this.solo ? this.pose?.mult ?? 1 : this.pos.mult[this.s.roles[id] ?? ''] ?? 1 }
  isUpper(id: ActorId): boolean { return !this.solo && this.pos.roles.find((r) => r.id === this.s.roles[id])?.upper === true }
  tagName(tag: string): string { return (this.k.content.get('tendency_tag', tag)?.name as string | undefined) ?? tag }
  /** 這個人現在那一檔的規則（檢定加減、感載倍率、全檔的行動點與沉溺）。 */
  gearRule(id: ActorId): SyncRule['gears'][SyncGear] { return this.sync.gears[this.seat(id).gear] }
  /** 受到的感載乘這一檔的倍率（淺 ×0.5、標準 ×1、深 ×1.5、全 ×2.5）。 */
  gearMult(id: ActorId): number { return this.gearRule(id).loadPct / 100 }
  /** 自己擲的檢定加這一檔的加減（來源 sync）。 */
  gearParts(id: ActorId): RollPart[] {
    const r = this.gearRule(id)
    return r.check ? [{ label: `${r.name}檔`, value: r.check, source: 'sync' }] : []
  }
  /** 這個人開不了這一檔的原因，每個沒夠的條件一句（核心 syncBlocks；開得了是空的）。 */
  gearReasons(id: ActorId, gear: SyncGear): string[] { return syncBlocks(this.k, this.state, id, gear) }
  /** 自己造成的感載與契合：每一層餘韻 +10%。 */
  boost(src: ActorId): number { return 1 + this.rulesFor(src).glow_bonus * this.glow[src]! }

  /** 這個人用的規則數字：規則加上他生效的共鳴（rules；沒有共鳴就是原本那一份）。 */
  rulesFor(id: ActorId): SceneRules {
    let r = this.ruleCache.get(id)
    if (!r) {
      r = withRules(this.rules, this.res[id]?.rules ?? {})
      this.ruleCache.set(id, r)
    }
    return r
  }

  /** 這個人每回合的感載自然消退：現實 2 + mod(意志)（最少 0）；內海是 net_load_decay（沒有人定義這個數值是 0）。 */
  decayOf(id: ActorId): number {
    if (this.s.layer === 'net') return this.k.stats.hasStat('net_load_decay') ? Math.max(0, Math.floor(this.k.stats.stat(this.state, id, 'net_load_decay'))) : 0
    return Math.max(0, 2 + this.resolveMod(id))
  }

  /** 這個人現在切換體位不花行動點嗎（共鳴 free_switch：這一場前幾次；單人沒有）。 */
  freeSwitch(id: ActorId): boolean {
    const n = this.res[id]?.free_switch ?? 0
    return n > 0 && !this.solo && (this.s.seats.find((x) => x.id === id)?.free_used ?? 0) < n
  }

  /** 這個人有的某一種共鳴特殊動作（沒有是 null）。 */
  onceOf(id: ActorId, kind: OnceKind): OnceEntry | null { return this.res[id]?.once.find((x) => x.kind === kind) ?? null }
  /** 這個人這一場（或這一回合）已經用過這一種了嗎。 */
  usedOnce(id: ActorId, kind: OnceKind): boolean {
    const n = this.s.seats.find((x) => x.id === id)?.once?.[kind]
    return n !== undefined && (ONCE_SCOPE[kind] === 'scene' || n === this.s.round)
  }
  /** 有這一種而且還沒用掉。 */
  onceReady(id: ActorId, kind: OnceKind): boolean { return this.onceOf(id, kind) !== null && !this.usedOnce(id, kind) }
  private markOnce(id: ActorId, kind: OnceKind): void {
    const seat = this.seat(id)
    seat.once = { ...(seat.once ?? {}), [kind]: ONCE_SCOPE[kind] === 'scene' ? 1 : this.s.round }
  }
  /** 這個人現在挑逗不花行動點嗎（共鳴 free_tease：每回合第一次）。 */
  freeTease(id: ActorId): boolean { return !this.solo && this.onceReady(id, 'free_tease') }
  /** 這個人現在脫換衣服不花行動點嗎（共鳴 free_dress：每場第一次）。 */
  freeDress(id: ActorId): boolean { return this.onceReady(id, 'free_dress') }

  /** 這個人有哪些部位：基本的七個＋actor.ext.scene.parts＋掛點 scene.body 回答的。 */
  partsOf(id: ActorId): string[] { return [...new Set([...BASE_PARTS, ...knowOf(this.actor(id)).parts, ...(this.body[id]?.parts ?? [])])] }
  /** 這個人的某個部位對敏感度的修正（掛點 scene.body；沒有回答是 0）。 */
  partMod(id: ActorId, part: string | undefined): number { return part === undefined ? 0 : (this.body[id]?.sensitivity[part] ?? 0) }
  /** 受到感載時用的敏感度：人的有效值加被接的那個部位的修正（P64）。 */
  sensAt(id: ActorId, part?: string): number { return this.sens[id]! + this.partMod(id, part) }

  line(w: ActorId, text: string, tag?: string, data?: Record<string, unknown>): void {
    this.s.lines.push({ round: this.s.round, who: w, text })
    if (this.s.lines.length > MAX_LINES) this.s.lines.splice(0, this.s.lines.length - MAX_LINES)
    this.beats.push(beat(w, text, tag, data))
  }

  // ---- 感載、契合、主動權 ----

  /**
   * 受到的感載 = 原始值 ×（0.75 ＋ 敏感度 ÷ 200）× 體位的倍率 ×（1 ＋ 0.1 × 造成的人的餘韻）× 同步檔位的倍率。滿了就是高潮。回傳實際加了多少。
   * 敏感度是人的有效值加被接的部位的修正（part；沒有人回答 scene.body 時修正是 0）。
   */
  hurt(target: ActorId, raw: number, src: ActorId, part?: string): number {
    if (this.ended || raw <= 0) return 0
    const n = Math.round(raw * (this.rules.load_base + this.sensAt(target, part) / this.rules.load_div) * this.mult(target) * this.boost(src) * this.gearMult(target))
    this.load[target] = this.load[target]! + n
    this.seat(target).received += n
    while (!this.ended && this.load[target]! >= this.loadMax[target]!) this.climax(target, src)
    return n
  }

  /** 正的是受到，負的是減輕（藥、貼片）。 */
  applyLoad(target: ActorId, amount: number, src: ActorId, part?: string): number {
    if (amount >= 0) return this.hurt(target, amount, src, part)
    this.load[target] = Math.max(0, this.load[target]! + amount)
    return amount
  }

  /**
   * 契合 +n（主角對 x 那一份；x 沒給就是這一步在算的那一對）。沒有那一對（NPC 對 NPC）不算，回傳 0。
   * 單人：任何寫「契合」的地方都讀成節奏（LEWD_SYSTEM 3.5 節第九點）。
   */
  addFit(n: number, src: ActorId, x?: ActorId): number {
    if (this.ended) return 0
    if (this.solo) return this.addPace(n)
    const pr = this.pairAt(x)
    if (!pr) return 0
    const v = n > 0 ? Math.round(n * this.boost(src)) : n
    pr.rec.fit = clamp(pr.rec.fit + v, 0, 100)
    return v
  }

  /** 節奏 +n（單人；正的照餘韻加成，0～100）；拿素材的目的看節奏到過哪裡（goal_progress 記最高的那一次）。回傳實際的變化。 */
  addPace(n: number): number {
    const v = n > 0 ? Math.round(n * this.boost(this.s.pc)) : n
    this.setPace((this.s.pace ?? 0) + v)
    return v
  }

  private setPace(to: number): void {
    this.s.pace = clamp(to, 0, 100)
    if (this.s.goal_progress !== null) this.s.goal_progress = Math.max(this.s.goal_progress, this.s.pace)
  }

  /** 節奏掉了（單人；側躺掉一半）。回傳掉了多少。 */
  dropPace(n: number): number {
    const lose = this.pose?.drop_half ? Math.round(n / 2) : n
    const before = this.s.pace ?? 0
    this.setPace(before - lose)
    return before - (this.s.pace ?? 0)
  }

  /** n 是 w 這一邊的變化：主導 +10 就是 w 更有主動權（主角的主動權往上、對方的往下）。w 要是這一對裡的人（主角或 x）。 */
  addInit(n: number, w: ActorId, x?: ActorId): void {
    if (this.ended) return
    const pr = this.pairAt(x)
    if (!pr || (!this.isPc(w) && w !== pr.id)) return
    pr.rec.init = clamp(pr.rec.init + (this.isPc(w) ? n : -n), 0, 100)
  }

  /** 過載就是高潮：感載歸零，疊一層餘韻，不失去回合；自己高潮主動權 −15，讓對方高潮的人 +10。餘韻疊滿之後又高潮就失神。 */
  climax(target: ActorId, src: ActorId): void {
    const seat = this.seat(target)
    this.load[target] = 0
    // 全檔過載時沉溺加（資料的 sink_on_overload；結算時一次加，每場最多 sink_cap）
    const sink = this.gearRule(target).sinkOnOverload
    if (sink) seat.sink_gain += sink
    // 共鳴 no_glow：每場一次，這一次高潮不疊餘韻（也不會因為疊滿而失神）
    const spared = this.onceReady(target, 'no_glow')
    if (spared) this.markOnce(target, 'no_glow')
    if (!spared && this.glow[target]! >= this.glowMax[target]!) {
      this.line(target, this.isPc(target) ? '你失神了。' : `${this.name(target)}失神了。`, 'out')
      if (this.isPc(target)) this.ended = 'pc_out'
      else this.exit(target)
      return
    }
    if (!spared) this.glow[target] = this.glow[target]! + 1
    seat.climax += 1
    // 單人：自己高潮，節奏斷拍
    if (this.solo && this.isPc(target)) this.dropPace(this.rules.solo.climax_drop)
    this.addInit(this.rulesFor(target).climax_init_self, target)
    if (src !== target) this.addInit(this.rulesFor(src).climax_init_cause, src)
    if (!this.isPc(target) && this.s.goal === 'please' && this.s.goal_progress !== null) this.s.goal_progress = Math.min(100, this.s.goal_progress + this.rules.goal_please_per_climax)
    this.line(target, `${this.name(target)}達到了頂點（餘韻 ${this.glow[target]}／${this.glowMax[target]}${spared ? '；這一次沒有疊' : ''}）。`, 'climax', { glow: this.glow[target], ...(spared ? { spared: true } : {}) })
  }

  // ---- 部位與連接 ----

  occupiers(who: ActorId, part: string): LinkRec[] {
    return this.s.links.filter((l) => (l.by === who && l.mine === part) || (l.to === who && l.theirs === part))
  }

  /**
   * 建立這一條連接會中斷哪幾條：兩端被佔著的那幾條（一個部位同時只能有一條）。
   * double（觸手）：自己的那個部位有別的連接也不中斷，同一個部位最多兩條——已經兩條時換掉最早的一條；對方的那個部位照舊。
   */
  breakingLinks(w: ActorId, t: ActorId, pair: Pair, double: boolean): LinkRec[] {
    const mineOcc = this.occupiers(w, pair.mine)
    const mineBreak = double ? (mineOcc.length >= 2 ? [...mineOcc].sort((a, b) => a.id - b.id).slice(0, mineOcc.length - 1) : []) : mineOcc
    const out = new Map<number, LinkRec>()
    for (const l of [...mineBreak, ...this.occupiers(t, pair.theirs)]) out.set(l.id, l)
    return [...out.values()]
  }

  /** 體位碰不碰得到（兩個方向都算）。道具自己算一個部位：它碰得到的是「這個位置碰得到的任何部位」。 */
  reaches(w: ActorId, mine: string, theirs: string, asPart?: string, t: ActorId = this.opp(w)): boolean {
    if (this.solo) return !!this.pose && poseReaches(this.pose, mine, theirs, asPart)
    const a = this.s.roles[w]
    const b = this.s.roles[t]
    if (a === undefined || b === undefined) return false
    const links = this.pos.links
    if (asPart !== undefined && mine === asPart) return links.some((l) => (l.from[0] === a && sameEnd(l.to, b, theirs)) || (l.to[0] === a && sameEnd(l.from, b, theirs)))
    return links.some((l) => (sameEnd(l.from, a, mine) && sameEnd(l.to, b, theirs)) || (sameEnd(l.to, a, mine) && sameEnd(l.from, b, theirs)))
  }

  /** 這個位置上有沒有可以接的部位：畫面把部位分成「碰得到」與「碰不到」用。 */
  partReachable(w: ActorId, part: string): boolean {
    if (this.solo) return !!this.pose && poseHasPart(this.pose, part)
    const a = this.s.roles[w]
    return this.pos.links.some((l) => sameEnd(l.from, a ?? '', part) || sameEnd(l.to, a ?? '', part))
  }

  private tagged(w: ActorId, part: string, tag: string | null): boolean {
    return !!tag && (!!knowOf(this.actor(w)).part_tags[part]?.includes(tag) || !!this.body[w]?.tags[part]?.includes(tag))
  }

  /**
   * 用哪個部位接對方的哪個部位（LEWD_SYSTEM 3.5 節第四點、第八點）。玩家給了就照給的（要合規）；沒給：完整版擋下要玩家選，精簡版由程式挑——
   * 技能寫的部位裡空著的優先；有對應標籤的部位優先；都佔著就換掉最早建立的那一條。NPC 的一步永遠由程式挑。t 是對誰（沒給是一對一的對方）。
   */
  pairFor(w: ActorId, c: PairCand, given: PartPick | undefined, forceAuto = false, t: ActorId = this.opp(w)): PairResult {
    const myPick = given ? given.my_part : undefined
    const theirPick = given ? given.their_part : undefined
    const need = this.s.mode === 'full' && this.isPc(w) && !forceAuto
    const reasons: string[] = []
    // 單人：兩端都是自己的部位
    const them = this.solo ? '自己' : '對方'
    if (need && (myPick === undefined || theirPick === undefined)) {
      if (myPick === undefined) reasons.push('要選用你的哪個部位。')
      if (theirPick === undefined) reasons.push(`要選接${them}的哪個部位。`)
      return { reasons }
    }
    const mineOk = c.mine.filter((x) => (c.asPart !== undefined && x === c.asPart) || this.partsOf(w).includes(x))
    const theirsOk = c.theirs.filter((x) => this.partsOf(t).includes(x))
    if (myPick !== undefined && !c.mine.includes(myPick)) reasons.push(`這一個用不了你的「${partName(myPick)}」：只能用${c.mine.map(partName).join('、')}。`)
    if (theirPick !== undefined && !c.theirs.includes(theirPick)) reasons.push(`這一個接不到${them}的「${partName(theirPick)}」：只能接${c.theirs.map(partName).join('、')}。`)
    if (reasons.length > 0) return { reasons }
    if (myPick !== undefined && !mineOk.includes(myPick)) return { reasons: [`你沒有「${partName(myPick)}」這個部位。`] }
    if (theirPick !== undefined && !theirsOk.includes(theirPick)) return { reasons: [this.solo ? `你沒有「${partName(theirPick)}」這個部位。` : `${this.name(t)}沒有「${partName(theirPick)}」這個部位。`] }
    const mines = myPick !== undefined ? [myPick] : mineOk
    const theirs = theirPick !== undefined ? [theirPick] : theirsOk
    const cands: Pair[] = []
    for (const m of mines) for (const th of theirs) if (this.reaches(w, m, th, c.asPart, t)) cands.push({ mine: m, theirs: th })
    if (cands.length === 0) {
      if (mines.length === 0 || theirs.length === 0) return { reasons: [this.solo ? '你沒有這一項要用的部位。' : '你或對方沒有這一項要用的部位。'] }
      const m = mines[0]!
      const th = theirs[0]!
      return { reasons: [this.solo ? (myPick !== undefined && theirPick !== undefined ? `${this.positionName()}碰不到：你的${partName(m)}接不到自己的${partName(th)}，換一個姿勢。` : `${this.positionName()}碰不到這一項要用的部位：換一個姿勢。`) : myPick !== undefined && theirPick !== undefined ? `${this.pos.name}碰不到：你的${partName(m)}接不到對方的${partName(th)}，換一個體位。` : `${this.pos.name}碰不到這一項要用的部位：換一個體位。`] }
    }
    if (myPick !== undefined && theirPick !== undefined) return cands[0]!
    return this.autoPick(w, t, cands, c.tag, c.double === true)
  }

  private autoPick(w: ActorId, t: ActorId, cands: Pair[], tag: string | null, double: boolean): Pair {
    const occ = (c: Pair): LinkRec[] => this.breakingLinks(w, t, c, double)
    const score = (c: Pair): number => (this.tagged(w, c.mine, tag) ? 1 : 0) + (this.tagged(t, c.theirs, tag) ? 1 : 0)
    const free = cands.filter((c) => occ(c).length === 0)
    if (free.length > 0) return free.reduce((best, c) => (score(c) > score(best) ? c : best))
    const earliest = (c: Pair): number => Math.min(...occ(c).map((l) => l.id))
    return cands.reduce((best, c) => (earliest(c) < earliest(best) || (earliest(c) === earliest(best) && occ(c).length < occ(best).length) ? c : best))
  }

  /** 建立一條連接：兩端被佔著的那幾條中斷（一個部位同時只能有一條；double 的例外見 breakingLinks）。 */
  addLink(w: ActorId, t: ActorId, kind: LinkRec['kind'], source: string, name: string, pair: Pair, link: LinkRec['link'], double = false, rebuilt = false): LinkRec {
    const broken = new Set(this.breakingLinks(w, t, pair, double).map((l) => l.id))
    this.s.links = this.s.links.filter((l) => !broken.has(l.id))
    this.s.link_seq += 1
    const rec: LinkRec = { id: this.s.link_seq, by: w, to: t, kind, source, name, mine: pair.mine, theirs: pair.theirs, link: clone(link), round: this.s.round, ...(double ? { double: true as const } : {}) }
    // 共鳴 first_link_fit：這個人這一場建立的第一條有持續效果的連接（技能或道具；說話的連接沒有持續值），持續的契合多 n（精簡版切換體位重接時不再加）
    const bonus = kind === 'talk' || this.solo ? 0 : this.res[w]?.first_link_fit ?? 0
    const seat = this.s.seats.find((x) => x.id === w)
    if (bonus > 0 && seat && !seat.first_link) {
      seat.first_link = true
      rec.link.fit += bonus
    }
    // 共鳴 link_bonus：依連接用的部位加持續的契合（口、多出來的部位）；說話的連接沒有持續值；精簡版切換體位重接時 link 已經帶著加過的（rebuilt）不再加
    if (kind !== 'talk' && !rebuilt) {
      for (const b of this.res[w]?.link_bonus ?? []) if (b.extra ? !(BASE_PARTS as readonly string[]).includes(rec.mine) : rec.mine === b.part) rec.link.fit += b.fit
    }
    this.s.links.push(rec)
    return rec
  }

  /** 精簡版：切換體位之後，照新的體位把剛才那幾條能接的接回去（不花行動點、沒有用出去的那一下）。 */
  relink(old: LinkRec[]): void {
    for (const l of old) {
      const w = l.by
      const t = l.to
      let cand: PairCand | null = null
      if (l.kind === 'talk') cand = { mine: [...TALK_PARTS], theirs: this.partsOf(t), tag: null }
      else {
        const info = sceneDefOf(this.k, l.kind === 'skill' ? 'skill' : 'item', l.source)
        if (info) cand = candOf(info.def, info.tag)
      }
      if (!cand) continue
      const r = this.pairFor(w, cand, undefined, true, t)
      if (!('reasons' in r)) this.addLink(w, t, l.kind, l.source, l.name, r, l.link, cand.double === true, true)
    }
  }

  // ---- 行動前的檢查：現在能不能做與原因（一條一個條件） ----

  /** 一條條件現在判斷得了嗎：種類有人註冊（all／any／not 看裡面）。 */
  private judgeable(c: Condition, kinds: Set<string>): boolean {
    if (c.kind === 'all' || c.kind === 'any') return Array.isArray(c.of) && (c.of as Condition[]).every((x) => x && typeof x.kind === 'string' && this.judgeable(x, kinds))
    if (c.kind === 'not') return !!c.of && typeof (c.of as Condition).kind === 'string' && this.judgeable(c.of as Condition, kinds)
    return kinds.has(c.kind)
  }

  /** 條件不成立時給玩家看的一句：條件自己寫的 text、有物品就寫物品名、否則寫種類。 */
  private needText(c: Condition): string {
    if (typeof c.text === 'string' && c.text.trim()) return c.text
    if (c.kind === 'has_item' && typeof c.id === 'string') return `要帶著「${(this.k.content.get('item', c.id)?.name as string | undefined) ?? c.id}」才用得出來。`
    return `還沒有滿足需要的條件（${c.kind}）。`
  }

  /**
   * 技能或道具的 needs（看的人是用的那個人）：不成立的每條一句；沒有人註冊的種類當作不成立（P31）。
   * 條件 { kind: 'target', of: 條件 }（M4-night-resonance）：「對方……」的需要，內層的條件看這個行動的對象 t 而不是用的人（對方有義體、有獸化……）；單人沒有對象，一律不成立。
   * 內層是 partnered（有固定的伴）時，「最喜歡的人不是你」的那個「你」是用的人。
   */
  needBlocks(w: ActorId, def: SceneDef, t?: ActorId): string[] {
    if (def.needs.length === 0) return []
    const kinds = new Set(this.k.conditions.kinds())
    const out: string[] = []
    for (const c of def.needs) {
      const who = c.kind === 'target' ? t : w
      const cond = c.kind === 'target' && isRecord(c.of) && typeof (c.of as Condition).kind === 'string' ? (c.of as Condition) : c
      if (c.kind === 'target' && (this.solo || who === undefined || who === w || cond === c)) {
        out.push(this.solo ? '這個要有對象。' : '這個條件現在還判斷不了。')
        continue
      }
      if (!this.judgeable(cond, kinds)) {
        out.push('這個條件現在還判斷不了。')
        continue
      }
      let ok = false
      try {
        const asked = c.kind === 'target' && cond.kind === 'partnered' && cond.not === undefined ? { ...cond, not: w } : cond
        ok = this.k.conditions.test(asked, { state: this.state, actor: who!, stats: this.k.stats, timeRules: this.k.timeRules })
      } catch {
        out.push('這個條件現在還判斷不了。')
        continue
      }
      if (!ok) out.push(c.kind === 'target' && !(typeof c.text === 'string' && c.text.trim()) && !(typeof cond.text === 'string' && cond.text.trim()) ? `對方還沒有滿足需要的條件（${cond.kind}）。` : this.needText(c.kind === 'target' ? { ...cond, ...(typeof c.text === 'string' ? { text: c.text } : {}) } : c))
    }
    return out
  }

  /** 對象要選誰的時候的預設：技能與道具先挑部位接得上的人，再挑契合最低的那一個（沒有契合可比的人當 50）；沒有別人是自己。 */
  autoTarget(w: ActorId, input: SceneInput): ActorId {
    const others = this.activeOthers(w)
    if (others.length <= 1) return others[0] ?? this.opp(w)
    let pool = others
    if (input.kind === 'skill' || input.kind === 'item') {
      const info = sceneDefOf(this.k, input.kind, input.id)
      const cand = info ? candOf(info.def, info.tag) : null
      if (cand) {
        const ok = others.filter((x) => !('reasons' in this.pairFor(w, cand, input.pick, true, x)))
        if (ok.length > 0) pool = ok
      }
    }
    const fitOf = (x: ActorId): number => (this.isPc(w) ? this.s.pairs[x]?.fit : this.isPc(x) ? this.s.pairs[w]?.fit : undefined) ?? 50
    return pool.reduce((best, x) => (fitOf(x) < fitOf(best) ? x : best))
  }

  /** 這個行動作用在誰身上：給了 target 就是他；沒給，這一圈只有一個別人就是他；好幾個人時完整版的玩家要自己選（probe 只問能不能時用預設）。 */
  private targetOf(w: ActorId, input: SceneInput, probe: boolean): { id: ActorId } | { reasons: string[] } {
    const given = 'target' in input ? input.target : undefined
    if (given !== undefined) return { id: given }
    const others = this.activeOthers(w)
    if (others.length > 1 && this.s.mode === 'full' && this.isPc(w) && !probe) return { reasons: ['要選對象：這一圈有好幾個人。'] }
    return { id: this.autoTarget(w, input) }
  }

  /** 要作用的對象（blocks 看過之後）。 */
  private target(w: ActorId, input: SceneInput): ActorId {
    const given = 'target' in input ? input.target : undefined
    return given ?? this.autoTarget(w, input)
  }

  /** 換進去這個人數的圈、全圈都會的第一個體位；沒有是 null。 */
  positionFor(ids: readonly ActorId[]): PositionEntry | null {
    return knownAll(this.k, this.state, ids)[0] ?? null
  }

  /** 還能去的別的圈：有人、加上主角不超過四個人。 */
  joinable(): CircleRec[] {
    return this.s.mode === 'full' ? this.s.circles.filter((c) => c.people.length >= 1 && c.people.length <= 3) : []
  }

  /** 換圈的原因：一條一句；空的就是換得了。 */
  circleBlocks(circle: string): string[] {
    if (this.s.mode !== 'full') return ['精簡版不分圈：要換圈請在設定裡切到完整版。']
    const c = this.s.circles.find((x) => x.id === circle)
    if (!c) return ['沒有這一圈。']
    if (c.people.length === 0) return ['那一圈沒有人了。']
    if (c.people.length + 1 > 4) return [`那一圈已經有 ${c.people.length} 個人，加上你超過四個人。`]
    if (!this.positionFor([this.s.pc, ...c.people])) return [`你和那一圈的人沒有共同會的 ${c.people.length + 1} 人體位：換不了圈。`]
    return []
  }

  /** 叫人過來的原因：一條一句；空的就是叫得了（成不成功另外擲）。 */
  callBlocks(who: ActorId): string[] {
    if (this.s.mode !== 'full') return ['精簡版不分圈：叫不了別圈的人，請在設定裡切到完整版。']
    const c = this.s.circles.find((x) => x.people.includes(who))
    if (!c) return ['別的圈裡沒有這個人。']
    const active = this.activeIds()
    if (active.length + 1 > 4) return ['這一圈已經滿了（一圈最多四個人）。']
    if (!this.positionFor([...active, who])) return [`這一圈加上${this.name(who)}沒有全圈都會的 ${active.length + 1} 人體位：叫不過來。`]
    return []
  }

  /** probe 是只問「能不能」：完整版沒給部位不算缺（畫面另外用 picks 讓玩家選）。 */
  blocks(w: ActorId, input: SceneInput, probe = false): string[] {
    const s = this.s
    const out: string[] = []
    const me = this.isPc(w) ? '你' : '對方'
    if (s.turn !== w) return [`還沒輪到${me}。`]
    if (input.kind === 'stop' || input.kind === 'end_turn') return this.isPc(w) ? [] : ['對方沒有這個行動。']
    // 單人沒有對象：沒有主導、迎合、挑逗，也沒有圈；加快與放慢只有單人才有
    if (this.solo) {
      if (input.kind === 'dominate' || input.kind === 'yield') return ['單人沒有主導與迎合：用加快與放慢。']
      if (input.kind === 'tease') return ['單人沒有對象可以挑逗。']
      if (input.kind === 'move_circle' || input.kind === 'call') return ['單人沒有別的圈。']
    } else if (input.kind === 'faster' || input.kind === 'slower') return ['只有單人的場景才有加快與放慢。']
    if (input.kind === 'move_circle' || input.kind === 'call') {
      if (!this.isPc(w)) return ['只有你能換圈與叫人。']
      const cost = costOf(this, input, w)
      if (this.seat(w).ap < cost) out.push(`行動點不夠：這個行動要 ${cost} 點，${me}只剩 ${this.seat(w).ap} 點。`)
      out.push(...(input.kind === 'move_circle' ? this.circleBlocks(input.circle) : this.callBlocks(input.who)))
      return out
    }
    const given = this.solo ? undefined : 'target' in input ? input.target : undefined
    if (given !== undefined && (given === w || !this.inCircle(given))) return ['這一圈裡沒有這個人。']
    const cost = costOf(this, input, w)
    if (this.seat(w).ap < cost) out.push(`行動點不夠：這個行動要 ${cost} 點，${me}只剩 ${this.seat(w).ap} 點。`)
    // 作用在單一對象的行動（技能、道具、說話）：沒給對象時一對一是對方，好幾個人時照 targetOf
    const single = input.kind === 'skill' || input.kind === 'item' || input.kind === 'talk' || (input.kind === 'once' && !this.solo)
    let t = w
    if (single && !this.solo) {
      const r = this.targetOf(w, input, probe)
      if ('reasons' in r) return [...out, ...r.reasons]
      t = r.id
      if (t === w) return ['這一圈裡沒有這個人。']
    }
    switch (input.kind) {
      case 'dress': {
        if (this.onceOf(w, 'free_dress') === null) out.push('這一場沒有脫換衣服的功夫。')
        break
      }
      case 'once': {
        const e = this.onceOf(w, input.id)
        if (this.solo || !this.isPc(w)) out.push('只有你和對象之間才用得出這個功夫。')
        else if (e === null) out.push('你還沒有這個夜課的功夫。')
        else if (this.usedOnce(w, input.id)) out.push('這一場已經用過了。')
        else {
          const x = this.pairIdOf(w, t)
          if (x === null) out.push('這一圈裡你和他沒有契合可以動。')
          else if (input.id === 'set_init') {
            if (input.value === undefined || !e.values.includes(input.value)) out.push(`要把主動權設成 ${e.values.join(' 或 ')}（value）。`)
          } else if (this.s.pairs[x]!.fit >= e.value) out.push(`你們的契合已經到 ${e.value} 了，不用拉。`)
        }
        break
      }
      case 'dominate': case 'yield': case 'tease': {
        const linked = this.linkedWith(w)
        if (linked.length === 0) out.push('還沒有連接：先用技能、道具或說話建立一條。')
        else if (given !== undefined && !linked.includes(given)) out.push(`和${this.name(given)}還沒有連接。`)
        break
      }
      case 'restrain': case 'faster': case 'slower':
        break
      case 'gear': {
        const g = input.gear
        const name = `${this.sync.gears[g].name}檔`
        if (this.seat(w).shifted) out.push('這個回合已經換過檔了。')
        if (g === this.seat(w).gear) out.push(`已經是${name}了。`)
        else out.push(...this.gearReasons(w, g))
        break
      }
      case 'talk': {
        // 單人：只有直播開著（有觀眾）才能說話，對觀眾說，不建立連接
        if (this.solo) {
          if (!watchedNow(this.k, this.state, this.s)) out.push('沒有人在聽。')
          break
        }
        const r = this.pairFor(w, { mine: [...TALK_PARTS], theirs: this.partsOf(t), tag: null }, input.pick, probe, t)
        if ('reasons' in r) out.push(...r.reasons)
        break
      }
      case 'switch': {
        // 單人：切換姿勢（1 點、不用主動權）
        if (this.solo) {
          const pose = this.poses.find((x) => x.id === input.position)
          if (!pose) out.push('沒有這個姿勢。')
          else if (pose.id === s.position) out.push('已經是這個姿勢了。')
          break
        }
        const n = this.activeIds().length
        const known = knownPositions(this.k, this.state, w, n)
        const target = this.k.content.get<PositionEntry>(POSITION_KIND, input.position)
        if (!target) out.push('沒有這個體位。')
        else if (target.people !== n) out.push(`「${target.name}」要 ${target.people} 個人，這一圈現在是 ${n} 個人。`)
        else if (target.id === s.position) out.push('已經是這個體位了。')
        else if (!known.some((p) => p.id === target.id)) out.push(`${me}還不會「${target.name}」：要先學會開放它的夜課技能。`)
        const decider = this.decider()
        if (decider !== w) out.push(`主動權不在${me}手上：換不換體位由${this.isPc(w) ? (n > 2 ? this.name(decider) : '對方') : decider === s.pc ? '你' : n > 2 ? this.name(decider) : '你'}決定。`)
        break
      }
      case 'skill': case 'item': {
        const info = sceneDefOf(this.k, input.kind, input.id)
        if (!info) {
          out.push(input.kind === 'skill' ? '沒有這個技能。' : '這件東西在場景裡用不出來。')
          break
        }
        if (input.kind === 'skill' && !knownSkills(this.k, this.state, w).includes(input.id)) out.push(`${me}還沒有學會「${info.name}」。`)
        if (input.kind === 'item' && !(this.isPc(w) && this.state.inventory.some((x) => x.id === input.id && x.qty > 0))) out.push(`你身上沒有「${info.name}」。`)
        // 單人：資料的 solo 欄位（沒寫：道具 ok、技能 no）；audience 要這一場有人在看
        if (this.solo) {
          const gate = soloGate(info.def, input.kind)
          if (gate === 'no') return [...out, '這個要有對象。']
          if (gate === 'audience' && !watchedNow(this.k, this.state, this.s)) return [...out, '這個要有人在看。']
        }
        if (info.def.positions && !info.def.positions.includes(s.position)) out.push(`「${info.name}」要在${info.def.positions.map((id) => this.posNameOf(id)).join('、')}才用得出來，現在是${this.positionName()}。`)
        if (info.tag && !hasTendencyTag(this.actor(w), info.tag)) out.push(`要有「${this.tagName(info.tag)}」的標籤（或對應的調校、道具、服裝）才用得出來。`)
        out.push(...this.needBlocks(w, info.def, t))
        const cand = candOf(info.def, info.tag)
        // 沒有部位的道具（藥）不建立連接
        if (cand) {
          const r = this.pairFor(w, cand, input.pick, probe, t)
          if ('reasons' in r) out.push(...r.reasons)
        }
        break
      }
    }
    return out
  }

  // ---- 行動的結算 ----

  private spend(w: ActorId, n: number): void { this.seat(w).ap -= n }

  /** 這個行動的骰子：挑逗留下的那一顆多的，只加在第一組有骰子的上面，用掉就沒了。 */
  private roller(w: ActorId): (d: Die) => number {
    const seat = this.seat(w)
    let extra = seat.teased ? 1 : 0
    return (d) => {
      const e = extra > 0 && d.n > 0 ? 1 : 0
      if (e) {
        extra = 0
        seat.teased = false
      }
      return rollDie(this.dice, d, e)
    }
  }

  /** 主導、迎合、挑逗：作用在連著的每個人（或指定的那一個）；連著不只一個人時每個人的骰數少 multi_dice_minus 顆（最少 1 顆）。 */
  private basic(w: ActorId, targets: ActorId[], kind: 'dominate' | 'yield' | 'tease'): void {
    const mine = this.rulesFor(w)
    const r = mine[kind]
    // 共鳴 free_tease：每回合第一次挑逗不花行動點
    if (kind === 'tease' && this.freeTease(w)) this.markOnce(w, 'free_tease')
    else this.spend(w, mine.cost[kind])
    const roll = this.roller(w)
    const minus = targets.length > 1 ? mine.multi_dice_minus : 0
    // 共鳴 tease_flat、tease_exposure：挑逗時對方的感載多幾點（原始值）
    const flat = kind === 'tease' ? this.teaseExtra(w) : 0
    const dice = (n: number, plus = 0): Die => ({ sign: 1, n: Math.max(1, n - minus), sides: 6, flat: plus })
    let a = 0
    let b = 0
    let f = 0
    const per: Record<string, { target_load: number; my_load: number; fit: number }> = {}
    for (const t of targets) {
      if (this.ended) break
      if (!this.inCircle(t) || !this.inCircle(w)) continue
      this.ctx = this.ctxOf(w, t)
      const their = roll(dice(r.their, flat))
      const mine = roll(dice(r.mine))
      const x = this.hurt(t, their, w)
      const y = this.hurt(w, mine, w)
      const z = this.addFit(r.fit, w, this.ctx ?? undefined)
      this.addInit(r.init, w, this.ctx ?? undefined)
      per[t] = { target_load: x, my_load: y, fit: z }
      a += x
      b += y
      f += z
    }
    if (kind === 'tease') this.seat(w).teased = true
    const names = targets.map((t) => this.name(t)).join('、')
    const text = {
      dominate: this.isPc(w) ? `你掌握了節奏。` : `${this.name(w)}掌握了節奏。`,
      yield: this.isPc(w) ? `你順著${names}的節奏迎上去。` : `${this.name(w)}順著${targets.length === 1 && this.isPc(targets[0]!) ? '你' : names}的節奏迎上來。`,
      tease: this.isPc(w) ? `你放慢下來，吊著${names}。` : `${this.name(w)}放慢下來，吊著${targets.length === 1 && this.isPc(targets[0]!) ? '你' : names}。`,
    }[kind]
    this.line(w, text, kind, { target_load: a, my_load: b, fit: f, init: r.init, ...(targets.length > 1 ? { targets: per } : {}) })
  }

  private restrain(w: ActorId): void {
    this.spend(w, this.rulesFor(w).cost.restrain)
    // 共鳴 restrain_dice：克制時自己的感載另外少這些骰
    const extra = (this.res[w]?.restrain_dice ?? []).reduce((sum, d) => sum + rollDie(this.dice, parseDie(d) ?? NO_DIE), 0)
    const n = Math.max(0, this.rulesFor(w).restrain_base + this.resolveMod(w)) + extra
    const before = this.load[w]!
    this.load[w] = Math.max(0, before - n)
    this.seat(w).restrained = true
    this.line(w, this.isPc(w) ? '你深吸一口氣，把自己壓住。' : `${this.name(w)}閉上眼，慢了下來。`, 'restrain', { my_load: before - this.load[w]! })
  }

  /** 挑逗時對方的感載多幾點：共鳴 tease_flat 加上曝露度加成（tease_exposure：每高 1 多 per、最多 max；內海看化身的曝露度）。 */
  teaseExtra(w: ActorId): number {
    const r = this.res[w]
    if (!r) return 0
    let n = r.tease_flat
    if (r.tease_exposure) {
      const stat = this.s.layer === 'net' ? 'skin_exposure' : 'exposure'
      const level = this.k.stats.hasStat(stat) ? Math.max(0, Math.floor(this.k.stats.stat(this.state, w, stat))) : 0
      n += Math.min(r.tease_exposure.max, level * r.tease_exposure.per)
    }
    return n
  }

  /** 脫下或換上一件衣服（共鳴 free_dress 給的行動）：第一次不花行動點，之後照 cost.dress；只記一行，真正的穿脫在場景外。 */
  private dress(w: ActorId): void {
    if (this.freeDress(w)) this.markOnce(w, 'free_dress')
    else this.spend(w, this.rulesFor(w).cost.dress)
    this.line(w, this.isPc(w) ? '你脫下了一件衣服，換了一身樣子。' : `${this.name(w)}換了一身樣子。`, 'dress')
  }

  /** 共鳴的特殊動作（每場一次）：主動權直接設成 value，或把契合拉到共鳴寫的那個數。 */
  private once(w: ActorId, t: ActorId, input: Extract<SceneInput, { kind: 'once' }>): void {
    const e = this.onceOf(w, input.id)!
    this.spend(w, e.ap)
    this.markOnce(w, input.id)
    const x = this.pairIdOf(w, t)!
    const pair = this.s.pairs[x]!
    if (input.id === 'set_init') {
      const before = pair.init
      pair.init = clamp(input.value ?? before, 0, 100)
      this.line(w, `你把和${this.name(t)}之間的節奏直接定了下來。`, 'once', { id: input.id, init: pair.init - before })
    } else {
      const before = pair.fit
      pair.fit = Math.max(before, e.value)
      this.line(w, `你換了一個樣子，和${this.name(t)}又對上了拍。`, 'once', { id: input.id, fit: pair.fit - before })
    }
  }

  /** 技能與道具：花行動點，用出去的那一下，再建立連接（有部位的話）。 */
  private use(w: ActorId, t: ActorId, kind: 'skill' | 'item', id: string, pick: PartPick | undefined): void {
    if (this.solo) return this.useSolo(w, kind, id, pick)
    const info = sceneDefOf(this.k, kind, id, this.actor(w))!
    const def = info.def
    this.ctx = this.ctxOf(w, t)
    this.spend(w, def.ap)
    const roll = this.roller(w)
    const their = roll(def.on_use.their_load)
    const mine = roll(def.on_use.my_load)
    // 先挑部位（不擲骰、不改狀態）：用出去的這一下，受到的感載看接的是哪個部位（P64）
    const cand = candOf(def, info.tag)
    const r = cand ? this.pairFor(w, cand, pick, false, t) : null
    const linked = r && !('reasons' in r) ? r : null
    const a = this.applyLoad(t, their, w, linked?.theirs)
    const b = this.applyLoad(w, mine, w, linked?.mine)
    let fit = def.on_use.fit
    const match = !!info.tag && hasTendencyTag(this.actor(t), info.tag)
    if (match) fit += def.match_bonus ?? this.rulesFor(w).match_bonus
    const f = this.addFit(fit, w, this.ctx ?? undefined)
    this.addInit(def.on_use.init, w, this.ctx ?? undefined)
    if (info.tag && !this.s.touched.includes(info.tag)) this.s.touched.push(info.tag)
    if (kind === 'item' && info.consumable) this.consumed = id
    // 用出去的這一下讓對方（或自己）失神退出了：接不上，連接不建立
    const keep = linked !== null && !this.ended && this.inCircle(t) && this.inCircle(w)
    if (linked && keep) this.addLink(w, t, kind, id, info.name, linked, def.link ? { my_load: dieSpec(def.link.my_load), their_load: dieSpec(def.link.their_load), fit: def.link.fit } : { my_load: 0, their_load: 0, fit: 0 }, def.double)
    const verb = kind === 'skill' ? '施展' : '用上'
    const text = linked && keep
      ? `${this.name(w)}用${partName(linked.mine)}${verb}「${info.name}」，接上${this.name(t)}的${partName(linked.theirs)}。`
      : `${this.name(w)}${verb}「${info.name}」。`
    this.line(w, text, kind, { id, target_load: a, my_load: b, fit: f, init: def.on_use.init, ...(linked && keep ? { my_part: linked.mine, their_part: linked.theirs } : {}), ...(match ? { match: info.tag } : {}) })
  }

  /**
   * 單人的技能與道具（LEWD_SYSTEM 3.5 節第九點）：連接是「自己的部位接自己的部位」。原本給對方的感載（their_load）算在自己身上，原本給自己的那一份（my_load）不算，
   * 契合算成節奏，主動權不算，對方也有標籤的契合加成沒有（沒有對方）。沒有部位的道具（藥）沒有「對方」，兩份感載都算在自己身上（先 their 再 my）。
   */
  private useSolo(w: ActorId, kind: 'skill' | 'item', id: string, pick: PartPick | undefined): void {
    const info = sceneDefOf(this.k, kind, id, this.actor(w))!
    const def = info.def
    const cand = candOf(def, info.tag)
    this.spend(w, def.ap)
    const roll = this.roller(w)
    const their = roll(def.on_use.their_load)
    const mine = cand ? 0 : roll(def.on_use.my_load)
    // 先挑部位（不擲骰、不改狀態）：受到的感載看接的是哪個部位（P64）
    const r = cand ? this.pairFor(w, cand, pick, false, w) : null
    const linked = r && !('reasons' in r) ? r : null
    const a = this.applyLoad(w, their, w, linked?.theirs)
    const b = cand ? 0 : this.applyLoad(w, mine, w)
    const pace = this.addFit(def.on_use.fit, w)
    if (info.tag && !this.s.touched.includes(info.tag)) this.s.touched.push(info.tag)
    if (kind === 'item' && info.consumable) this.consumed = id
    const keep = linked !== null && !this.ended
    if (linked && keep) this.addLink(w, w, kind, id, info.name, linked, def.link ? { my_load: 0, their_load: dieSpec(def.link.their_load), fit: def.link.fit } : { my_load: 0, their_load: 0, fit: 0 }, def.double)
    const verb = kind === 'skill' ? '施展' : '用上'
    const text = linked && keep ? `你用${partName(linked.mine)}${verb}「${info.name}」，接上自己的${partName(linked.theirs)}。` : `你${verb}「${info.name}」。`
    this.line(w, text, kind, { id, my_load: a + b, pace, ...(linked && keep ? { my_part: linked.mine, their_part: linked.theirs } : {}) })
  }

  /** 加快、放慢（單人；LEWD_SYSTEM 3.5 節第九點）：自己的感載與節奏。側躺：加快的感載減 1d6 的一半、放慢的節奏多 +1。 */
  private tempo(w: ActorId, kind: 'faster' | 'slower'): void {
    const r = this.rules.solo[kind]
    const pose = this.pose
    this.spend(w, this.rulesFor(w).cost[kind])
    const amount = rollDie(this.dice, parseDie(r.load) ?? NO_DIE)
    const cut = kind === 'faster' && pose?.faster_cut ? Math.floor(rollDie(this.dice, parseDie(pose.faster_cut) ?? NO_DIE) / 2) : 0
    const load = this.applyLoad(w, kind === 'faster' ? Math.max(0, amount - cut) : amount, w)
    const pace = this.addFit(r.pace + (kind === 'slower' ? pose?.slower_pace ?? 0 : 0), w)
    this.line(w, kind === 'faster' ? '你加快了節奏。' : '你放慢下來，細細地磨。', kind, { my_load: load, pace })
  }

  /** 說話的檢定（魅力加交涉或誘惑對說話的難度）：說話與叫人過來共用。 */
  private talkCheck(w: ActorId): ReturnType<typeof makeCheck> {
    const a = this.actor(w)
    const skill = (a.skills.seduce ?? 0) >= (a.skills.negotiate ?? 0) ? 'seduce' : 'negotiate'
    // M2 用骰子代替判定：魅力加交涉或誘惑對 13
    return makeCheck({
      natural: this.dice.int(1, 20), parts: checkParts(this.k.stats, this.state, w, { attr: 'charm', skill, tags: ['social', 'scene'] }, this.gearParts(w)), dc: this.rules.talk_dc, attr: 'charm', skill,
    })
  }

  private talk(w: ActorId, t: ActorId, input: Extract<SceneInput, { kind: 'talk' }>): void {
    const mine = this.rulesFor(w)
    this.spend(w, mine.cost.talk)
    this.ctx = this.ctxOf(w, t)
    const x = this.ctx ?? undefined
    const env = this.talkEnv?.[w]
    let fit: number
    let goal = 0
    let extra: Record<string, unknown>
    let check: ReturnType<typeof makeCheck> | null = null
    if (env) {
      // 外面（scene_talk）給的結果：契合夾在 −5～+10、目的的進度夾在 0～+20，不擲檢定
      const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0)
      fit = this.addFit(clamp(n(env.fit), TALK_ENV_FIT[0], TALK_ENV_FIT[1]), w, x)
      if (!this.solo && this.isPc(w) && this.s.goal !== null && this.s.goal_progress !== null) {
        goal = clamp(n(env.goal), 0, 20)
        this.s.goal_progress = Math.min(100, this.s.goal_progress + goal)
      }
      extra = { source: 'env', ...(typeof env.agree === 'boolean' ? { agree: env.agree } : {}) }
    } else {
      check = this.talkCheck(w)
      fit = this.addFit(mine.talk_fit[check.degree], w, x)
      if (!this.solo && this.isPc(w) && this.s.goal !== null && this.s.goal_progress !== null) {
        goal = Math.min(20, mine.talk_goal[check.degree])
        this.s.goal_progress = Math.min(100, this.s.goal_progress + goal)
      }
      extra = { degree: check.degree }
    }
    if (!this.solo) {
      const r = this.pairFor(w, { mine: [...TALK_PARTS], theirs: this.partsOf(t), tag: null }, input.pick, false, t)
      if (!('reasons' in r) && !this.ended && this.inCircle(t) && this.inCircle(w)) this.addLink(w, t, 'talk', 'talk', '說話', r, { my_load: 0, their_load: 0, fit: 0 })
    }
    if (this.isPc(w) && input.text) this.said = input.text.slice(0, 200)
    // 單人：對看著的人說，契合的變化就是節奏的變化（報告的 data 用 pace）
    this.line(w, this.solo ? '你對看著的人說了幾句話。' : this.isPc(w) ? `你對${this.name(t)}說了幾句話。` : `${this.name(w)}開口說了幾句話。`, 'talk', this.solo ? { pace: fit, ...extra } : { fit, goal, ...extra })
    if (check) this.beats[this.beats.length - 1]!.roll = check
  }

  /**
   * 身為起手的人拿到上位（體位沒有上位時，第一個位置）；其餘的位置照座位的順序分給其他還在的人。
   * 兩個人時就是起手的人上位、另一個人下位；三、四人時位置照 roles 的順序分。
   */
  assignRoles(pos: PositionEntry, w: ActorId): Record<ActorId, string> {
    const upper = pos.roles.find((r) => r.upper) ?? pos.roles[0]!
    const rest = pos.roles.filter((r) => r.id !== upper.id)
    const out: Record<ActorId, string> = { [w]: upper.id }
    this.activeIds().filter((id) => id !== w).forEach((id, i) => {
      out[id] = rest[i]?.id ?? rest[rest.length - 1]?.id ?? upper.id
    })
    return out
  }

  /** 換進一個體位（開場也走這裡，不花行動點）：位置、標籤的契合、用過的體位。連接由呼叫的人處理。 */
  enter(position: PositionEntry, w: ActorId): void {
    this.s.position = position.id
    this.s.roles = this.assignRoles(position, w)
    if (!this.s.used_positions.includes(position.id)) this.s.used_positions.push(position.id)
    if (position.tag) {
      let any = false
      for (const who of this.activeIds()) {
        if (hasTendencyTag(this.actor(who), position.tag)) {
          any = true
          // 有標籤的主角讓他和每個人的契合都加；有標籤的別人讓他和主角的那一份加
          if (this.isPc(who)) for (const x of this.activeOthers(who)) this.addFit(this.rulesFor(who).position_tag_fit, who, x)
          else this.addFit(this.rulesFor(who).position_tag_fit, who, who)
        }
      }
      if (any && !this.s.touched.includes(position.tag)) this.s.touched.push(position.tag)
    }
  }

  /** 單人換進一個姿勢（開場也走這裡，不花行動點）：姿勢、用過的姿勢。連接由呼叫的人處理。 */
  enterPose(pose: SoloPose): void {
    this.s.position = pose.id
    this.s.roles = {}
    if (!this.s.used_positions.includes(pose.id)) this.s.used_positions.push(pose.id)
  }

  private switchTo(w: ActorId, id: string): void {
    // 共鳴：這一場前幾次切換體位不花行動點（M4-nightclass）
    if (this.freeSwitch(w)) {
      const seat = this.seat(w)
      seat.free_used = (seat.free_used ?? 0) + 1
    } else this.spend(w, this.rulesFor(w).cost.switch)
    // 共鳴 keep_extra_links：切換時，有這個共鳴的人用多出來的部位（尾、觸手、加裝）建立的連接不重置
    const kept = this.s.links.filter((l) => this.res[l.by]?.keep_extra_links === true && !(BASE_PARTS as readonly string[]).includes(l.mine))
    if (this.solo) {
      const pose = this.poses.find((x) => x.id === id)!
      const old = this.s.links.filter((l) => !kept.includes(l))
      this.s.links = [...kept]
      this.enterPose(pose)
      this.line(w, kept.length > 0 ? `換成${pose.name}。連接全部重來，多出來的部位那幾條還連著。` : `換成${pose.name}。連接全部重來。`, 'switch', { position: id, ...(kept.length > 0 ? { kept: kept.length } : {}) })
      if (this.s.mode === 'simple') this.relink(old)
      return
    }
    const next = this.k.content.require<PositionEntry>(POSITION_KIND, id)
    const old = this.s.links.filter((l) => !kept.includes(l))
    this.s.links = [...kept]
    this.enter(next, w)
    this.line(w, kept.length > 0 ? `換成${next.name}。連接全部重來，多出來的部位那幾條還連著。` : `換成${next.name}。連接全部重來。`, 'switch', { position: id, ...(kept.length > 0 ? { kept: kept.length } : {}) })
    if (this.s.mode === 'simple') this.relink(old)
  }

  // ---- 多人：失神退出、人數變了自動換體位、換圈、叫人 ----

  /**
   * 人數變了、現在的體位對不上時自動換到一個對得上的（不花行動點、連接重置）：全圈都會的優先，其次決定的人會的，再其次任何一個這個人數的。
   * 這一圈只剩一個人（主角）時什麼都不做。
   */
  reposition(): void {
    const ids = this.activeIds()
    if (ids.length < 2) return
    const n = ids.length
    const w = this.decider()
    const next = this.positionFor(ids) ?? knownPositions(this.k, this.state, w, n)[0] ?? this.k.content.list<PositionEntry>(POSITION_KIND).find((x) => x.people === n)
    this.s.links = []
    if (next) this.enter(next, w)
    else this.s.roles = {}
  }

  /** 一個人失神退出這一圈：他的連接斷掉、位置空出來；剩下的人繼續。一個別人都不剩而且沒地方去時，場景結束。 */
  exit(id: ActorId): void {
    const seat = this.seat(id)
    seat.out = true
    this.s.links = this.s.links.filter((l) => l.by !== id && l.to !== id)
    delete this.s.roles[id]
    if (this.activeOthers(this.s.pc).length === 0) {
      if (this.joinable().length === 0) this.ended = 'partner_out'
      return
    }
    this.reposition()
  }

  /** 新的一圈（不展開）的 id。 */
  private newCircleId(): string {
    let n = this.s.circles.length + 1
    while (this.s.circles.some((c) => c.id === `c${n}`)) n += 1
    return `c${n}`
  }

  /** 一個新的座位（行動點滿、檔位照他的上限）。 */
  private newSeat(id: ActorId, climax: number): Seat {
    const gear = startGear(this.gearCap[id]!)
    return { id, ap: this.apMax[id]!, gear, max_gear: gear, shifted: false, sink_gain: 0, climax, received: 0, teased: false, restrained: false }
  }

  /** 主角對一個人從頭開始：契合 fit_start、主動權照開場的公式；「第一次」的記號照舊的（沒有舊的看性經歷）。 */
  private freshPair(x: ActorId): PairRec {
    const old = this.s.pairs[x]
    return {
      fit: openingFit(this.k, this.state, { pc: this.s.pc, partner: x, nature: this.s.nature, role: this.s.role, layer: this.s.layer }),
      init: openingInit(this.k, this.state, { pc: this.s.pc, partner: x, nature: this.s.nature, role: this.s.role, layer: this.s.layer }),
      first: old ? old.first : sexRecordOf(this.actor(this.s.pc)).people[x] === undefined,
    }
  }

  /** 換圈（P36）：原本這一圈收成不展開的圈（契合取他們對主角契合的平均），目標的圈展開，連接全部重置。 */
  private moveCircle(circle: string): void {
    const s = this.s
    this.spend(s.pc, this.rulesFor(s.pc).cost.move_circle)
    const target = s.circles.find((c) => c.id === circle)!
    const members = [...target.people]
    const left = this.activeOthers(s.pc)
    const outs = s.seats.filter((x) => x.out).map((x) => x.id)
    const leftNames = left.map((id) => this.name(id))
    if (left.length + outs.length > 0) {
      const fits = left.map((id) => s.pairs[id]?.fit ?? this.rules.other_circle.fit_start)
      s.circles.push({
        id: this.newCircleId(), people: left,
        fit: fits.length > 0 ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : this.rules.other_circle.fit_start,
        climax: Object.fromEntries(left.map((id) => [id, this.seat(id).climax])), line: '', ...(outs.length > 0 ? { out: outs } : {}),
      })
    }
    s.circles = s.circles.filter((c) => c.id !== circle)
    const pcSeat = this.seat(s.pc)
    s.seats = [pcSeat, ...members.map((id) => this.newSeat(id, target.climax[id] ?? 0))]
    for (const id of members) s.pairs[id] = this.freshPair(id)
    s.links = []
    this.line(s.pc, `你離開${leftNames.length > 0 ? leftNames.join('、') : '這一圈'}，走向${members.map((id) => this.name(id)).join('、')}。連接全部重來。`, 'move_circle', { circle, people: members })
    this.reposition()
  }

  /** 叫人過來：主角對這一圈每個人的主動權都在 50 以上直接成功，否則擲一次說話的檢定（有 scene_talk 的結果就看它的 agree）。成功的話他離開他的圈、加入這一圈。 */
  private call(who: ActorId): void {
    const s = this.s
    this.spend(s.pc, this.rulesFor(s.pc).cost.call)
    const circle = s.circles.find((c) => c.people.includes(who))!
    const sure = this.activeOthers(s.pc).every((x) => (s.pairs[x]?.init ?? 50) >= 50)
    let ok: boolean
    let degree: string | undefined
    let check: ReturnType<typeof makeCheck> | null = null
    if (sure) ok = true
    else if (typeof this.talkEnv?.[s.pc]?.agree === 'boolean') ok = this.talkEnv[s.pc]!.agree!
    else {
      check = this.talkCheck(s.pc)
      degree = check.degree
      ok = check.degree === 'success' || check.degree === 'critical'
    }
    if (!ok) {
      this.line(s.pc, `你想把${this.name(who)}叫過來，他沒有理你。`, 'call', { who, ok: false, ...(degree ? { degree } : {}) })
      if (check) this.beats[this.beats.length - 1]!.roll = check
      return
    }
    circle.people = circle.people.filter((x) => x !== who)
    const climax = circle.climax[who] ?? 0
    delete circle.climax[who]
    s.seats.push(this.newSeat(who, climax))
    s.pairs[who] = this.freshPair(who)
    s.links = []
    this.line(s.pc, `你把${this.name(who)}叫了過來。連接全部重來。`, 'call', { who, ok: true, ...(degree ? { degree } : {}) })
    if (check) this.beats[this.beats.length - 1]!.roll = check
    this.reposition()
  }

  /** 換檔：0 點、每回合一次、只能在自己的回合（blocks 管）。 */
  private shiftTo(w: ActorId, gear: SyncGear): void {
    const seat = this.seat(w)
    const from = seat.gear
    seat.gear = gear
    seat.shifted = true
    if (gearIndexOf(gear) > gearIndexOf(seat.max_gear)) seat.max_gear = gear
    const name = `${this.sync.gears[gear].name}檔`
    this.line(w, this.isPc(w) ? `你換到${name}。` : `${this.name(w)}換到${name}。`, 'gear', { from, to: gear })
  }

  /** 這個人的回合交出去：主角交給第一個還在的別人；別人交回主角。沒有別人可以交（這一圈只剩主角）就直接做這一回合的結算。 */
  passTurn(w: ActorId): void {
    if (!this.isPc(w)) {
      this.s.turn = this.s.pc
      return
    }
    const first = this.activeOthers(this.s.pc)[0]
    if (first !== undefined) this.s.turn = first
    else this.settleRound()
  }

  /** 做一個行動（blocks 已經看過）。stop 與 end_turn 只改狀態。 */
  perform(w: ActorId, input: SceneInput): void {
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease': {
        // 結算要看主導與迎合各用了幾次（橋參數落在哪一項）
        if (input.kind !== 'tease') {
          const seat = this.s.seats.find((x) => x.id === w)
          if (seat) seat[input.kind === 'dominate' ? 'dom_used' : 'yield_used'] = (seat[input.kind === 'dominate' ? 'dom_used' : 'yield_used'] ?? 0) + 1
        }
        return this.basic(w, input.target !== undefined ? [input.target] : this.linkedWith(w), input.kind)
      }
      case 'restrain': return this.restrain(w)
      case 'dress': return this.dress(w)
      case 'once': return this.once(w, this.target(w, input), input)
      case 'faster': case 'slower': return this.tempo(w, input.kind)
      case 'skill': case 'item': return this.use(w, this.solo ? w : this.target(w, input), input.kind, input.id, input.pick)
      case 'talk': return this.talk(w, this.solo ? w : this.target(w, input), input)
      case 'switch': return this.switchTo(w, input.position)
      case 'gear': return this.shiftTo(w, input.gear)
      case 'move_circle': return this.moveCircle(input.circle)
      case 'call': return this.call(input.who)
      case 'stop':
        this.line(w, '你停了下來。', 'stop')
        this.ended = 'stop'
        return
      case 'end_turn':
        this.line(w, this.isPc(w) ? '你等著對方。' : `${this.name(w)}等著。`, 'end_turn')
        this.passTurn(w)
        return
    }
  }

  // ---- NPC 的一步（LEWD_SYSTEM 3.5 節；工單第 6 點） ----

  /** 這個位置對他有利的程度：自己受到的倍率越低越好、在上位、有他喜歡的標籤。 */
  private posScore(w: ActorId, pos: PositionEntry, role: string): number {
    const r = pos.roles.find((x) => x.id === role)
    return -(pos.mult[role] ?? 1) + (r?.upper ? 0.5 : 0) + (pos.tag && hasTendencyTag(this.actor(w), pos.tag) ? 0.5 : 0)
  }

  private weighted<T>(items: T[], weight: (x: T) => number): T {
    const ws = items.map((x) => Math.max(0, weight(x)))
    const total = ws.reduce((a, b) => a + b, 0)
    if (total <= 0) return items[0]!
    let r = this.dice.int(1, total)
    for (let i = 0; i < items.length; i++) {
      r -= ws[i]!
      if (r <= 0) return items[i]!
    }
    return items[items.length - 1]!
  }

  /**
   * NPC 的回合開頭（每回合第一次）：換不換檔走規則、不呼叫 AI——感載到上限的七成以上退一檔，否則維持。
   * want 是外面（scene_turn 的 AI）建議的檔位：照樣要過 blocks（上限、每回合一次），不合規就當沒給。
   */
  npcTurnStart(w: ActorId, want?: SyncGear): void {
    const s = this.s
    if (s.turn_began) return
    s.turn_began = true
    const seat = this.seat(w)
    let to: SyncGear = seat.gear
    if (want !== undefined && isSyncGear(want)) to = want
    else if (this.load[w]! >= this.rules.partner_gear_down_at * this.loadMax[w]!) to = SYNC_GEARS[Math.max(0, gearIndexOf(seat.gear) - 1)]!
    if (to !== seat.gear && this.blocks(w, { kind: 'gear', gear: to }).length === 0) this.perform(w, { kind: 'gear', gear: to })
  }

  /**
   * 這個人這一步做什麼（照規則挑）：主動權在他手上而且有更有利的體位就換；自己的感載高就克制（每回合一次）；
   * 還沒有連接就用自己的技能或說話建立一條；否則照性質在主導、迎合、挑逗裡加權抽。沒有可做的（行動點用完）是 null：他的回合結束。
   */
  choiceFor(w: ActorId): SceneInput | null {
    const s = this.s
    const ok = (i: SceneInput): boolean => this.blocks(w, i).length === 0
    if (this.decider() === w && this.seat(w).ap >= costOf(this, { kind: 'switch', position: s.position }, w)) {
      const now = this.posScore(w, this.pos, s.roles[w] ?? '')
      let best: { id: string; score: number } | null = null
      for (const p of knownPositions(this.k, this.state, w, this.activeIds().length)) {
        if (p.id === s.position) continue
        const sc = this.posScore(w, p, this.assignRoles(p, w)[w] ?? '')
        if (sc > now + 1e-9 && (!best || sc > best.score + 1e-9) && ok({ kind: 'switch', position: p.id })) best = { id: p.id, score: sc }
      }
      if (best) return { kind: 'switch', position: best.id }
    }
    if (this.load[w]! >= this.rules.partner_restrain_at * this.loadMax[w]! && !this.seat(w).restrained && ok({ kind: 'restrain' })) return { kind: 'restrain' }
    if (this.linkedWith(w).length === 0) {
      const skills = knownSkills(this.k, this.state, w).filter((id) => ok({ kind: 'skill', id }))
      if (skills.length > 0) return { kind: 'skill', id: skills[this.dice.int(0, skills.length - 1)]! }
      return ok({ kind: 'talk' }) ? { kind: 'talk' } : null
    }
    const cands = (['dominate', 'yield', 'tease'] as const).filter((kind) => ok({ kind }))
    if (cands.length === 0) return null
    const weights = this.rules.partner_weights[s.nature as PairNature] ?? this.rules.partner_weights.mutual
    return { kind: this.weighted(cands, (kind) => weights[kind]) }
  }

  /**
   * 外面（scene_turn 的 AI）給這個人的一串行動：照順序一個一個驗（行動點夠、有主動權才能切換體位、部位空著或照連接的規則中斷、標籤技能要有標籤、體位要會、needs），
   * 合規的就做；第一個不合規的連同後面的全部丟掉（不能是 stop）。回傳做了幾個、丟了幾個與第一個不合規的原因。
   */
  performMoves(w: ActorId, moves: readonly unknown[]): { done: number; dropped: number; reason: string | null } {
    let done = 0
    let dropped = 0
    let reason: string | null = null
    const list = moves.slice(0, MAX_MOVES)
    for (let i = 0; i < list.length; i++) {
      if (this.ended) break
      const m = list[i]
      let bad: string[] = []
      const fmt = inputProblem(m)
      if (fmt) bad = [fmt]
      else if ((m as SceneInput).kind === 'stop') bad = ['不能選「停下」：場景由玩家結束。']
      else bad = this.blocks(w, m as SceneInput)
      if (bad.length > 0) {
        dropped = moves.length - i
        reason = bad.join('')
        break
      }
      this.perform(w, m as SceneInput)
      done += 1
    }
    if (reason === null && !this.ended && moves.length > MAX_MOVES) {
      dropped = moves.length - MAX_MOVES
      reason = `一步最多收 ${MAX_MOVES} 個行動。`
    }
    return { done, dropped, reason }
  }

  // ---- 每回合的結算 ----

  /**
   * NPC 的回合做完：每條連接自動生效一次（克制的那一方減半）→ 上位的人推主動權 → 感載自然消退 → 目的（拖住）→ 強制結束的檢查 →
   * 新的一回合：每個人回行動點、克制解除、輪到主角。
   */
  settleRound(): void {
    const s = this.s
    const half = (w: ActorId, n: number): number => (n > 0 && this.seat(w).restrained ? Math.round(n * 0.5) : n)
    // 單人：這一回合有沒有任何連接（姿勢自己帶的那一條也算）；沒有，節奏就掉
    const hadLink = s.links.length > 0 || this.pose?.upkeep?.link === true
    for (const l of [...s.links]) {
      if (this.ended) return
      // 這一條在這一輪裡已經因為有人失神退出而斷掉了
      if (!s.links.some((x) => x.id === l.id)) continue
      this.ctx = this.ctxOf(l.by, l.to)
      const their = rollDie(this.dice, parseDie(l.link.their_load)!)
      const mine = rollDie(this.dice, parseDie(l.link.my_load)!)
      this.applyLoad(l.to, half(l.to, their), l.by, l.theirs)
      this.applyLoad(l.by, half(l.by, mine), l.by, l.mine)
      if (l.link.fit) this.addFit(l.link.fit, l.by, this.ctx ?? undefined)
    }
    this.ctx = null
    if (this.ended) return
    this.perRound()
    if (this.ended) return
    if (this.solo) {
      this.soloRound(hadLink)
      if (this.ended) return
    }
    // 體位本身推主動權：有上位（或體位寫了 drift）的位置每回合推一次，主角的推他對每個人那一份、別人的推他對主角那一份
    for (const id of this.activeIds()) {
      const role = s.roles[id]
      const d = role === undefined ? 0 : this.pos.drift?.[role] ?? (this.isUpper(id) ? this.pos.initiative_drift ?? this.rulesFor(id).upper_drift : 0)
      if (d === 0) continue
      if (this.isPc(id)) for (const x of this.activeOthers(id)) this.addInit(d, id, x)
      else this.addInit(d, id, id)
    }
    // 感載自然消退：現實是 2 + mod(意志)；內海的基礎是 0、沒有意志的加成，只有衍生數值 net_load_decay（甲板的散熱、技能、藥、調校）才消（CORE_RULES 4.2 節、CYBERSPACE 6.2 節）
    for (const id of this.activeIds()) this.load[id] = Math.max(0, this.load[id]! - this.decayOf(id))
    if (s.goal === 'stall' && s.goal_progress !== null) s.goal_progress = Math.min(100, s.goal_progress + this.rules.goal_stall_per_round)
    this.otherCircles()
    this.beats.push(beat(undefined, `第 ${s.round} 回合結束。`, 'round', { round: s.round }))
    // 單人：節奏掉到 quit_pace 以下而且過了 quit_rounds 回合，自己沒了興致
    if (this.solo && s.round >= this.rules.solo.quit_rounds && (s.pace ?? 0) <= this.rules.solo.quit_pace) {
      this.line(s.pc, '你沒了興致，停了下來。', 'quit')
      this.ended = 'bored'
      return
    }
    const others = this.activeOthers(s.pc)
    if (s.round >= this.rules.quit_rounds && others.length > 0 && others.every((x) => (s.pairs[x]?.fit ?? 100) <= this.rules.quit_fit)) {
      this.line(others[0]!, `${this.name(others[0]!)}說今天就到這裡。`, 'quit')
      this.ended = 'partner_quit'
      return
    }
    // 限回合的場景（setup.max_rounds）：回合數到了就走打斷的流程
    if (s.max_rounds !== undefined && s.round >= s.max_rounds) {
      this.line(s.pc, '被外面的事打斷了。', 'interrupt')
      this.ended = 'interrupted'
      return
    }
    s.round += 1
    for (const seat of s.seats) seat.ap = Math.min(this.apMax[seat.id]!, seat.ap + this.rulesFor(seat.id).ap_regen + (this.gearRule(seat.id).apRegen ?? 0))
    for (const seat of s.seats) {
      seat.restrained = false
      seat.shifted = false
    }
    s.turn_began = false
    s.turn = s.pc
  }

  // ---- 共鳴每回合的條件式效果（per_round） ----

  /** 一條 if 現在對 w 與 x 這一對成立嗎（x 是對象；單人沒有對象：只有 watched 問得出來）。 */
  private perRoundHolds(w: ActorId, x: ActorId | null, cond: PerRoundEntry['if'][number], tag?: string): boolean {
    const s = this.s
    switch (cond) {
      case 'watched': return watchedNow(this.k, this.state, s) || (!this.solo && this.activeIds().length >= 3)
      case 'bind_link': {
        const want = tag ?? BIND_TAG
        return x !== null && s.links.some((l) => ((l.by === w && l.to === x) || (l.by === x && l.to === w)) && l.kind !== 'talk' && sceneDefOf(this.k, l.kind === 'skill' ? 'skill' : 'item', l.source)?.tag === want)
      }
      case 'init_extreme': {
        const id = x !== null ? this.pairIdOf(w, x) : null
        const v = id !== null ? s.pairs[id]?.init : undefined
        return v !== undefined && (v >= 80 || v <= 20)
      }
      case 'contract_partner': {
        // 契約：主角是持約人時看條件 contract（side: holder、npc 是對象）；主角是契約人時條件沒有寫對象，問不出是誰，所以只認前者
        if (x === null || !this.k.conditions.kinds().includes('contract')) return false
        const holder = this.isPc(w) ? x : this.isPc(x) ? w : null
        return holder !== null && this.k.conditions.test({ kind: 'contract', side: 'holder', npc: holder }, { state: this.state, actor: this.s.pc, stats: this.k.stats, timeRules: this.k.timeRules })
      }
      case 'style_match': return x !== null && styleMatches(this.k, this.state, w, x, s.layer)
    }
  }

  /**
   * 每回合結算：每個人的共鳴 per_round——條件對每一個對象各算一次，成立的對象各吃一次效果：fit 與 init 落在主角那一對上（主動權往這個人那一邊推），
   * load 的 other 落在那個對象、self 每一條只算一次。單人沒有對象：watched 的條件成立時，other 也落在自己身上，契合是節奏。
   */
  private perRound(): void {
    for (const w of this.activeIds()) {
      const res = this.res[w]
      if (!res || res.per_round.length === 0) continue
      for (const e of res.per_round) {
        if (this.ended) return
        const targets: Array<ActorId | null> = this.solo ? [null] : this.activeOthers(w)
        const hit = targets.filter((x) => e.if.every((c) => this.perRoundHolds(w, x, c, e.tag)))
        if (hit.length === 0) continue
        const f = e.effect
        for (const x of hit) {
          if (this.ended) return
          const pairId = x === null ? null : this.pairIdOf(w, x)
          if (f.fit !== 0 && (this.solo || pairId !== null)) this.addFit(f.fit, w, pairId ?? undefined)
          if (f.init !== 0 && pairId !== null) this.addInit(f.init, w, pairId)
          if (f.load_other !== 0) this.hurt(x ?? w, f.load_other, w)
        }
        if (f.load_self !== 0) this.hurt(w, f.load_self, w)
        this.beats.push(beat(w, this.isPc(w) ? '（夜課的功夫起了作用。）' : `（${this.name(w)}的夜課功夫起了作用。）`, 'resonance', { per_round: e.if, fit: f.fit, init: f.init, load_self: f.load_self, load_other: f.load_other }))
      }
    }
  }

  /**
   * 單人每回合的節奏（姿勢的每回合固定值、連著的部位的節奏加成、沒有連接就掉）。連接自己的自動效果已經先算過。
   * 姿勢的 upkeep.load 是自己的感載（可能就高潮了）。
   */
  private soloRound(hadLink: boolean): void {
    const pose = this.pose
    const pc = this.s.pc
    if (pose?.upkeep?.load !== undefined) this.hurt(pc, rollDie(this.dice, parseDie(pose.upkeep.load) ?? NO_DIE), pc)
    if (this.ended) return
    // 跪姿：前後兩條連接都在（姿勢的 both_links.parts 每一個部位都有連接）時，自己的感載另外加一顆骰（LEWD 3.5 節第九點）
    const both = pose?.both_links
    if (both && both.parts.every((part) => this.s.links.some((l) => l.mine === part || l.theirs === part))) {
      const n = rollDie(this.dice, parseDie(both.load) ?? NO_DIE)
      this.hurt(pc, n, pc)
      this.beats.push(beat(pc, `前後兩處都被連著，這一回合自己的感載多了 ${n} 點。`, 'solo.both_links', { load: n, pose: pose!.id }))
      if (this.ended) return
    }
    if (pose?.upkeep?.pace) this.addFit(pose.upkeep.pace, pc)
    for (const [part, n] of Object.entries(pose?.link_pace ?? {})) {
      if (this.s.links.some((l) => l.mine === part || l.theirs === part)) this.addFit(n, pc)
    }
    if (!hadLink) {
      const lost = this.dropPace(this.rules.solo.idle_drop)
      this.beats.push(beat(pc, '這一回合沒有任何連接，節奏掉了。', 'pace', { pace: this.s.pace, lost }))
    }
  }

  /** 別的圈（P35）：每圈每回合契合 + fit_die（圈裡的人有共同的標籤再 + tag_bonus）、每個人感載 + load_die（照他的敏感度與餘韻）、高潮照算（失神的退出）；每圈一行字。 */
  private otherCircles(): void {
    const oc = this.rules.other_circle
    const fitDie = parseDie(oc.fit_die) ?? NO_DIE
    const loadDie = parseDie(oc.load_die) ?? NO_DIE
    for (const c of this.s.circles) {
      if (c.people.length < 2) {
        c.line = ''
        continue
      }
      const tags = tendencyTagIds(this.actor(c.people[0]!)).filter((t) => c.people.every((id) => hasTendencyTag(this.actor(id), t)))
      c.fit = clamp(c.fit + rollDie(this.dice, fitDie) + (tags.length > 0 ? oc.tag_bonus : 0), 0, 100)
      for (const id of [...c.people]) {
        const raw = rollDie(this.dice, loadDie)
        this.load[id] = this.load[id]! + Math.round(raw * (this.rules.load_base + this.sens[id]! / this.rules.load_div) * (1 + this.rulesFor(id).glow_bonus * this.glow[id]!))
        while (this.load[id]! >= this.loadMax[id]! && c.people.includes(id)) {
          this.load[id] = 0
          if (this.glow[id]! >= this.glowMax[id]!) {
            c.people = c.people.filter((x) => x !== id)
            c.out = [...(c.out ?? []), id]
          } else {
            this.glow[id] = this.glow[id]! + 1
            c.climax[id] = (c.climax[id] ?? 0) + 1
          }
        }
      }
      const names = c.people.map((id) => this.name(id))
      const who = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join('、')}和${names[names.length - 1]}`
      c.line = names.length < 2 ? '' : c.fit < 30 ? `${who}那一邊還在慢慢熟悉。` : c.fit < 60 ? `${who}那一邊越來越熱絡。` : `${who}那一邊已經難分難捨。`
      if (c.line) this.beats.push(beat(undefined, c.line, 'circle', { circle: c.id, fit: c.fit, people: [...c.people] }))
    }
  }

  // ---- 預覽 ----

  /**
   * 單人的預覽：沒有對方，target_load 一律是 null；my_load 是自己受到的（技能與道具：原本給對方的那一份），fit 是節奏的變化，init 是 0。
   */
  private previewSolo(w: ActorId, input: SceneInput): Preview {
    const seat = this.seat(w)
    const load = (d: Die, part?: string): PreviewLoad | null => {
      if (isNoDie(d)) return null
      const extra = seat.teased && d.n > 0 ? 1 : 0
      const r = dieRange(d, extra)
      const m = d.sign > 0 ? (this.rules.load_base + this.sensAt(w, part) / this.rules.load_div) * this.mult(w) * this.boost(w) * this.gearMult(w) : 1
      return { dice: dieTextOf(d, extra), mult: round2(m), min: Math.round(r.min * m), max: Math.round(r.max * m), avg: round1(r.avg * m) }
    }
    const none: Preview = { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false }
    const pace = (n: number): number => (n > 0 ? Math.round(n * this.boost(w)) : n)
    switch (input.kind) {
      case 'faster': case 'slower': {
        const r = this.rules.solo[input.kind]
        const bonus = input.kind === 'slower' ? this.pose?.slower_pace ?? 0 : 0
        return { ...none, ap: this.rulesFor(w).cost[input.kind], my_load: load(parseDie(r.load) ?? NO_DIE), fit: pace(r.pace + bonus) }
      }
      case 'restrain': {
        const n = Math.max(0, this.rulesFor(w).restrain_base + this.resolveMod(w))
        return { ...none, ap: this.rulesFor(w).cost.restrain, my_load: this.restrainLoad(w, n) }
      }
      case 'dress': return { ...none, ap: costOf(this, input, w) }
      case 'talk': return { ...none, ap: this.rulesFor(w).cost.talk, fit: this.rulesFor(w).talk_fit.fumble, fit_max: this.rulesFor(w).talk_fit.critical }
      case 'switch': return { ...none, ap: costOf(this, input, w) }
      case 'gear': {
        const g = this.sync.gears[input.gear]
        return { ...none, gear: { id: input.gear, name: `${g.name}檔`, check: g.check, load_pct: g.loadPct, ap_regen: g.apRegen ?? 0, sink_on_overload: g.sinkOnOverload ?? 0 } }
      }
      case 'skill': case 'item': {
        const info = sceneDefOf(this.k, input.kind, input.id, this.actor(w))
        if (!info) return none
        const d = info.def
        const cand = candOf(d, info.tag)
        const pick = input.pick
        const theirPart = pick ? pick.their_part : undefined
        const first = [d.on_use.their_load, ...(cand ? [] : [d.on_use.my_load])].find((x) => !isNoDie(x)) ?? NO_DIE
        return {
          ap: d.ap, target_load: null, my_load: load(first, cand ? theirPart : undefined), fit: pace(d.on_use.fit), init: 0, link: cand !== null,
          ...(d.link ? { per_round: { target_load: null, my_load: load(d.link.their_load, theirPart), fit: d.link.fit } } : {}),
        }
      }
      default: return none
    }
  }

  /** 克制的預覽：基本的 n 點加共鳴 restrain_dice 的範圍。 */
  private restrainLoad(w: ActorId, n: number): PreviewLoad {
    const dice = (this.res[w]?.restrain_dice ?? []).map((d) => parseDie(d) ?? NO_DIE)
    const lo = dice.reduce((a, d) => a + dieRange(d, 0).min, n)
    const hi = dice.reduce((a, d) => a + dieRange(d, 0).max, n)
    const avg = dice.reduce((a, d) => a + dieRange(d, 0).avg, n)
    return { dice: `−${n}${dice.map((d) => `−${dieTextOf(d, 0)}`).join('')}`, mult: 1, min: -hi, max: -lo, avg: -round1(avg) }
  }

  /** 一個行動的預覽（畫面要的）：雙方的感載（骰、倍率、範圍）、契合、主動權、花的行動點。數字都是引擎算的。 */
  preview(w: ActorId, input: SceneInput): Preview {
    if (this.solo) return this.previewSolo(w, input)
    const single = input.kind === 'skill' || input.kind === 'item' || input.kind === 'talk'
    const given = 'target' in input ? input.target : undefined
    const o = given ?? (single ? this.autoTarget(w, input) : this.linkedWith(w)[0] ?? this.autoTarget(w, input))
    const seat = this.seat(w)
    const dice = (d: Die, target: ActorId, part?: string): PreviewLoad | null => {
      if (isNoDie(d)) return null
      const extra = seat.teased && d.n > 0 ? 1 : 0
      const r = dieRange(d, extra)
      const m = d.sign > 0 ? (this.rules.load_base + this.sensAt(target, part) / this.rules.load_div) * this.mult(target) * this.boost(w) * this.gearMult(target) : 1
      return { dice: dieTextOf(d, extra), mult: round2(m), min: Math.round(r.min * m), max: Math.round(r.max * m), avg: round1(r.avg * m) }
    }
    const basic = (kind: 'dominate' | 'yield' | 'tease'): Preview => {
      const r = this.rulesFor(w)[kind]
      // 連著不只一個人時每個人的骰數少 multi_dice_minus 顆（最少 1 顆）
      const minus = given === undefined && this.linkedWith(w).length > 1 ? this.rulesFor(w).multi_dice_minus : 0
      return {
        ap: costOf(this, { kind }, w), target_load: dice({ sign: 1, n: Math.max(1, r.their - minus), sides: 6, flat: kind === 'tease' ? this.teaseExtra(w) : 0 }, o), my_load: dice({ sign: 1, n: Math.max(1, r.mine - minus), sides: 6, flat: 0 }, w),
        fit: r.fit > 0 ? Math.round(r.fit * this.boost(w)) : r.fit, init: r.init, link: false,
      }
    }
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease': return basic(input.kind)
      case 'restrain': {
        const n = Math.max(0, this.rulesFor(w).restrain_base + this.resolveMod(w))
        return { ap: this.rulesFor(w).cost.restrain, target_load: null, my_load: this.restrainLoad(w, n), fit: 0, init: 0, link: false }
      }
      case 'dress': case 'once': return { ap: costOf(this, input, w), target_load: null, my_load: null, fit: 0, init: 0, link: false }
      case 'talk': return { ap: this.rulesFor(w).cost.talk, target_load: null, my_load: null, fit: this.rulesFor(w).talk_fit.fumble, fit_max: this.rulesFor(w).talk_fit.critical, init: 0, link: true }
      case 'switch': return { ap: costOf(this, input, w), target_load: null, my_load: null, fit: 0, init: 0, link: false }
      case 'move_circle': case 'call': return { ap: this.rulesFor(w).cost[input.kind], target_load: null, my_load: null, fit: 0, init: 0, link: false }
      case 'gear': {
        const g = this.sync.gears[input.gear]
        return { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false, gear: { id: input.gear, name: `${g.name}檔`, check: g.check, load_pct: g.loadPct, ap_regen: g.apRegen ?? 0, sink_on_overload: g.sinkOnOverload ?? 0 } }
      }
      case 'skill': case 'item': {
        const info = sceneDefOf(this.k, input.kind, input.id, this.actor(w))
        if (!info) return { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false }
        const d = info.def
        const match = !!info.tag && hasTendencyTag(this.actor(o), info.tag)
        const fit = d.on_use.fit + (match ? d.match_bonus ?? this.rulesFor(w).match_bonus : 0)
        // 玩家選好了部位，倍率就算那個部位的修正（沒選或沒有人回答 scene.body 時是 0）
        const given = input.pick
        const myPart = given ? given.my_part : undefined
        const theirPart = given ? given.their_part : undefined
        return {
          ap: d.ap, target_load: dice(d.on_use.their_load, o, theirPart), my_load: dice(d.on_use.my_load, w, myPart), fit: fit > 0 ? Math.round(fit * this.boost(w)) : fit, init: d.on_use.init, link: candOf(d, info.tag) !== null,
          ...(d.link ? { per_round: { target_load: dice(d.link.their_load, o, theirPart), my_load: dice(d.link.my_load, w, myPart), fit: d.link.fit } } : {}),
        }
      }
      default: return { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false }
    }
  }
}

export interface PreviewLoad { dice: string; mult: number; min: number; max: number; avg: number }
export interface Preview {
  ap: number
  target_load: PreviewLoad | null
  my_load: PreviewLoad | null
  fit: number
  /** 說話的契合是一段範圍（−5～+10）：fit 是最低、fit_max 是最高 */
  fit_max?: number
  init: number
  /** 會不會建立連接 */
  link: boolean
  /** 換檔：那一檔的樣子（自己的檢定加減、受到的感載是原本的幾 %、每回合多回的行動點、過載時加的沉溺） */
  gear?: { id: SyncGear; name: string; check: number; load_pct: number; ap_regen: number; sink_on_overload: number }
  /** 之後每回合自動生效的數值（技能與道具） */
  per_round?: { target_load: PreviewLoad | null; my_load: PreviewLoad | null; fit: number }
}

const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100
const dieTextOf = (d: Die, extra: number): string => (d.n > 0 ? `${d.sign < 0 ? '−' : ''}${d.n + extra}d${d.sides}${d.flat ? `+${d.flat}` : ''}` : String(d.sign * d.flat))

/** 連接持續的數值寫回骰的原樣（字串或 0），存進狀態。 */
export function dieSpec(d: Die): string | number {
  if (isNoDie(d)) return 0
  if (d.n === 0) return d.sign * d.flat
  return `${d.sign < 0 ? '-' : ''}${d.n}d${d.sides}`
}

/** 一件技能或道具要用的部位；沒有部位（藥）是 null。 */
export function candOf(def: SceneDef, tag: string | null): PairCand | null {
  const mine = def.as_part !== undefined ? [def.as_part] : def.my_part
  if (mine.length === 0) return null
  return { mine, theirs: def.their_part, tag, ...(def.as_part !== undefined ? { asPart: def.as_part } : {}), ...(def.double ? { double: true } : {}) }
}

/** 一步用的骰子：用途是 scene/<場景 id>/<第幾步>，同一個種子與同樣的行動序列一定一樣。 */
export function diceOf(state: GameState, scene: Pick<SceneRaw, 'id' | 'step'>): Dice {
  return deriveRng(state.rng, `scene/${scene.id}/${scene.step}`)
}

export type { ActionId }
