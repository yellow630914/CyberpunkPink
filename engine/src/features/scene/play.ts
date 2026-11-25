// L6 功能 scene 的一步一步：場景裡的行動、連接、感載與高潮、NPC 的一步、每回合的結算。全部是純的：
// 拿現在的狀態做一份工作副本（Play），照規則改它，改完由 end.ts 與 index.ts 把差異寫成報告的變更。
// 規格：LEWD_SYSTEM 3.5 節（一～六點、第八點）；CORE_RULES 4.2 節；dev/work/M2-scene.md；M4-scene-seats（座位：Play 裡的人一律是角色的 id）。

import type { ActorId, Condition, GameState, Kernel, RollPart, SyncGear, SyncRule, TimelineBeat } from '../../core'
import { SYNC_GEARS, attrMod, checkParts, clone, deriveRng, isSyncGear, makeCheck, syncBlocks, syncRuleOf } from '../../core'
import type { ActionId, BodyRec, Die, Dice, EndReason, LinkRec, PairRec, PositionEntry, SceneDef, SceneRaw, SceneRules, Seat } from './model'
import {
  ACTION_NAME, BASE_PARTS, PARTNER_GEAR_DOWN_AT, POSITION_KIND, TALK_PARTS, beat, bodyOf, dieRange, gearCapOf, gearIndexOf, hasTendencyTag, isNoDie, knowOf, knownPositions, knownSkills, normalizeSeats,
  parseDie, partName, rollDie, sceneDefOf, sceneRules, sensitivityOf, statOr, MAX_LINES,
} from './model'

// ---- 輸入 ----

export interface PartPick { my_part?: string; their_part?: string }

/**
 * 玩家（與 NPC 的一步）的輸入。end_turn 不是第十種行動：把回合交出去，沒用完的行動點留到下回合。
 * target 是對誰（角色的 id；一對一時沒給就是對方）。
 */
export type SceneInput =
  | { kind: 'dominate' | 'yield' | 'tease' | 'restrain' | 'stop' | 'end_turn'; target?: ActorId }
  | { kind: 'skill'; id: string; pick?: PartPick; target?: ActorId }
  | { kind: 'item'; id: string; pick?: PartPick; target?: ActorId }
  | { kind: 'talk'; text?: string; pick?: PartPick; target?: ActorId }
  | { kind: 'switch'; position: string; target?: ActorId }
  | { kind: 'gear'; gear: SyncGear; target?: ActorId }

const KINDS: readonly string[] = ['dominate', 'yield', 'tease', 'restrain', 'stop', 'end_turn', 'skill', 'item', 'talk', 'switch', 'gear']

/** 輸入的格式問題（一句）；沒有問題是 null。 */
export function inputProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || typeof (input as { kind?: unknown }).kind !== 'string') return '要給一個行動：{ kind: ... }。'
  const i = input as Record<string, unknown>
  if (!KINDS.includes(i.kind as string)) return `沒有「${String(i.kind)}」這種行動。`
  if ((i.kind === 'skill' || i.kind === 'item') && (typeof i.id !== 'string' || !i.id)) return `${ACTION_NAME[i.kind]}要指明是哪一個（id）。`
  if (i.kind === 'switch' && (typeof i.position !== 'string' || !i.position)) return '切換體位要指明換成哪個體位（position）。'
  if (i.kind === 'gear' && !isSyncGear(i.gear)) return `換檔要指明換到哪一檔（gear：${SYNC_GEARS.join('、')}）。`
  if (i.target !== undefined && (typeof i.target !== 'string' || !i.target)) return 'target 要是角色的 id。'
  if (i.pick !== undefined) {
    const p = i.pick as Record<string, unknown>
    if (typeof p !== 'object' || p === null || (p.my_part !== undefined && typeof p.my_part !== 'string') || (p.their_part !== undefined && typeof p.their_part !== 'string')) return 'pick 要是 { my_part?, their_part? }。'
  }
  return null
}

/** 行動花幾點（技能與道具照自己的 scene.ap）。 */
export function costOf(p: Play, input: SceneInput): number {
  switch (input.kind) {
    case 'dominate': case 'yield': case 'tease': case 'restrain': case 'talk': case 'switch':
      return p.rules.cost[input.kind]
    case 'skill': return sceneDefOf(p.k, 'skill', input.id)?.def.ap ?? 0
    case 'item': return sceneDefOf(p.k, 'item', input.id)?.def.ap ?? 0
    default: return 0
  }
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

export class Play {
  readonly s: SceneRaw
  readonly rules: SceneRules
  /** 這一圈每個人的 id（座位的順序，第一個是主角） */
  readonly ids: ActorId[]
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
  talkEnv: TalkEnv | undefined

  constructor(readonly k: Kernel, readonly state: GameState, scene: SceneRaw, readonly dice: Dice) {
    this.s = clone(scene)
    this.rules = sceneRules(k)
    this.ids = this.s.seats.map((x) => x.id)
    const per = <T>(f: (id: ActorId) => T): Record<ActorId, T> => Object.fromEntries(this.ids.map((id) => [id, f(id)])) as Record<ActorId, T>
    const mod = (id: ActorId, attr: 'resolve' | 'reflex' | 'charm'): number => attrMod(k.stats.effectiveAttr(state, id, attr))
    this.loadMax = per((id) => Math.max(1, statOr(k, state, id, 'load_cap', 20 + mod(id, 'resolve') * 3)))
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
  /** 一對一的對方（第二個座位）。 */
  get partnerId(): ActorId { return this.s.seats[1]!.id }
  /** 主角對對方的那一份契合與主動權。 */
  get pair(): PairRec { return this.s.pairs[this.partnerId]! }
  seat(id: ActorId): Seat { return this.s.seats.find((x) => x.id === id)! }
  isPc(id: ActorId): boolean { return id === this.s.pc }
  /** 一對一時的對方；沒有別人（單人）是它自己。 */
  opp(id: ActorId): ActorId { return this.ids.find((x) => x !== id) ?? id }
  /** 這個人在這一圈裡嗎（沒退出）。 */
  inCircle(id: ActorId): boolean { return this.s.seats.some((x) => x.id === id && !x.out) }
  actor(id: ActorId) { return this.state.actors[id]! }
  /** 文字裡的稱呼：主角是「你」，別人是他的名字。 */
  name(id: ActorId): string { return this.isPc(id) ? '你' : this.actor(id).name }
  /** 一對一的舊名字（'pc' 或 'partner'）：報告的舊鍵與畫面資料用。 */
  who(id: ActorId): 'pc' | 'partner' { return this.isPc(id) ? 'pc' : 'partner' }
  get pos(): PositionEntry { return this.k.content.require<PositionEntry>(POSITION_KIND, this.s.position) }
  /** 主動權在誰手上：50 以上在主角手上，否則在對方。 */
  holder(): ActorId { return this.pair.init >= 50 ? this.s.pc : this.partnerId }
  resolveMod(id: ActorId): number { return attrMod(this.k.stats.effectiveAttr(this.state, id, 'resolve')) }
  mult(id: ActorId): number { return this.pos.mult[this.s.roles[id] ?? ''] ?? 1 }
  isUpper(id: ActorId): boolean { return this.pos.roles.find((r) => r.id === this.s.roles[id])?.upper === true }
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
  boost(src: ActorId): number { return 1 + this.rules.glow_bonus * this.glow[src]! }

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

  addFit(n: number, src: ActorId): number {
    if (this.ended) return 0
    const v = n > 0 ? Math.round(n * this.boost(src)) : n
    this.pair.fit = clamp(this.pair.fit + v, 0, 100)
    return v
  }

  /** n 是 w 這一邊的變化：主導 +10 就是 w 更有主動權（主角的主動權往上、對方的往下）。 */
  addInit(n: number, w: ActorId): void {
    if (this.ended) return
    this.pair.init = clamp(this.pair.init + (this.isPc(w) ? n : -n), 0, 100)
  }

  /** 過載就是高潮：感載歸零，疊一層餘韻，不失去回合；自己高潮主動權 −15，讓對方高潮的人 +10。餘韻疊滿之後又高潮就失神。 */
  climax(target: ActorId, src: ActorId): void {
    const seat = this.seat(target)
    this.load[target] = 0
    // 全檔過載時沉溺加（資料的 sink_on_overload；結算時一次加，每場最多 sink_cap）
    const sink = this.gearRule(target).sinkOnOverload
    if (sink) seat.sink_gain += sink
    if (this.glow[target]! >= this.glowMax[target]!) {
      this.line(target, this.isPc(target) ? '你失神了。' : `${this.name(target)}失神了。`, 'out')
      this.ended = this.isPc(target) ? 'pc_out' : 'partner_out'
      return
    }
    this.glow[target] = this.glow[target]! + 1
    seat.climax += 1
    this.addInit(this.rules.climax_init_self, target)
    if (src !== target) this.addInit(this.rules.climax_init_cause, src)
    if (!this.isPc(target) && this.s.goal === 'please' && this.s.goal_progress !== null) this.s.goal_progress = Math.min(100, this.s.goal_progress + this.rules.goal_please_per_climax)
    this.line(target, `${this.name(target)}達到了頂點（餘韻 ${this.glow[target]}／${this.glowMax[target]}）。`, 'climax', { glow: this.glow[target] })
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
    const a = this.s.roles[w]
    const b = this.s.roles[t]
    if (a === undefined || b === undefined) return false
    const links = this.pos.links
    if (asPart !== undefined && mine === asPart) return links.some((l) => (l.from[0] === a && sameEnd(l.to, b, theirs)) || (l.to[0] === a && sameEnd(l.from, b, theirs)))
    return links.some((l) => (sameEnd(l.from, a, mine) && sameEnd(l.to, b, theirs)) || (sameEnd(l.to, a, mine) && sameEnd(l.from, b, theirs)))
  }

  /** 這個位置上有沒有可以接的部位：畫面把部位分成「碰得到」與「碰不到」用。 */
  partReachable(w: ActorId, part: string): boolean {
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
    if (need && (myPick === undefined || theirPick === undefined)) {
      if (myPick === undefined) reasons.push('要選用你的哪個部位。')
      if (theirPick === undefined) reasons.push('要選接對方的哪個部位。')
      return { reasons }
    }
    const mineOk = c.mine.filter((x) => (c.asPart !== undefined && x === c.asPart) || this.partsOf(w).includes(x))
    const theirsOk = c.theirs.filter((x) => this.partsOf(t).includes(x))
    if (myPick !== undefined && !c.mine.includes(myPick)) reasons.push(`這一個用不了你的「${partName(myPick)}」：只能用${c.mine.map(partName).join('、')}。`)
    if (theirPick !== undefined && !c.theirs.includes(theirPick)) reasons.push(`這一個接不到對方的「${partName(theirPick)}」：只能接${c.theirs.map(partName).join('、')}。`)
    if (reasons.length > 0) return { reasons }
    if (myPick !== undefined && !mineOk.includes(myPick)) return { reasons: [`你沒有「${partName(myPick)}」這個部位。`] }
    if (theirPick !== undefined && !theirsOk.includes(theirPick)) return { reasons: [`${this.name(t)}沒有「${partName(theirPick)}」這個部位。`] }
    const mines = myPick !== undefined ? [myPick] : mineOk
    const theirs = theirPick !== undefined ? [theirPick] : theirsOk
    const cands: Pair[] = []
    for (const m of mines) for (const th of theirs) if (this.reaches(w, m, th, c.asPart, t)) cands.push({ mine: m, theirs: th })
    if (cands.length === 0) {
      if (mines.length === 0 || theirs.length === 0) return { reasons: ['你或對方沒有這一項要用的部位。'] }
      const m = mines[0]!
      const th = theirs[0]!
      return { reasons: [myPick !== undefined && theirPick !== undefined ? `${this.pos.name}碰不到：你的${partName(m)}接不到對方的${partName(th)}，換一個體位。` : `${this.pos.name}碰不到這一項要用的部位：換一個體位。`] }
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
  addLink(w: ActorId, t: ActorId, kind: LinkRec['kind'], source: string, name: string, pair: Pair, link: LinkRec['link'], double = false): LinkRec {
    const broken = new Set(this.breakingLinks(w, t, pair, double).map((l) => l.id))
    this.s.links = this.s.links.filter((l) => !broken.has(l.id))
    this.s.link_seq += 1
    const rec: LinkRec = { id: this.s.link_seq, by: w, to: t, kind, source, name, mine: pair.mine, theirs: pair.theirs, link: clone(link), round: this.s.round, ...(double ? { double: true as const } : {}) }
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
      if (!('reasons' in r)) this.addLink(w, t, l.kind, l.source, l.name, r, l.link, cand.double === true)
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

  /** 技能或道具的 needs（看的人是用的那個人）：不成立的每條一句；沒有人註冊的種類當作不成立（P31）。 */
  needBlocks(w: ActorId, def: SceneDef): string[] {
    if (def.needs.length === 0) return []
    const kinds = new Set(this.k.conditions.kinds())
    const out: string[] = []
    for (const c of def.needs) {
      if (!this.judgeable(c, kinds)) {
        out.push('這個條件現在還判斷不了。')
        continue
      }
      let ok = false
      try {
        ok = this.k.conditions.test(c, { state: this.state, actor: w, stats: this.k.stats, timeRules: this.k.timeRules })
      } catch {
        out.push('這個條件現在還判斷不了。')
        continue
      }
      if (!ok) out.push(this.needText(c))
    }
    return out
  }

  /** probe 是只問「能不能」：完整版沒給部位不算缺（畫面另外用 picks 讓玩家選）。 */
  blocks(w: ActorId, input: SceneInput, probe = false): string[] {
    const s = this.s
    const out: string[] = []
    const me = this.isPc(w) ? '你' : '對方'
    if (s.turn !== w) return [`還沒輪到${me}。`]
    if (input.kind === 'stop' || input.kind === 'end_turn') return this.isPc(w) ? [] : ['對方沒有這個行動。']
    const t = input.target ?? this.opp(w)
    if (t === w || !this.inCircle(t) || t !== this.opp(w)) return ['這一圈裡沒有這個人。']
    const cost = costOf(this, input)
    if (this.seat(w).ap < cost) out.push(`行動點不夠：這個行動要 ${cost} 點，${me}只剩 ${this.seat(w).ap} 點。`)
    const linked = s.links.length > 0
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease':
        if (!linked) out.push('還沒有連接：先用技能、道具或說話建立一條。')
        break
      case 'restrain':
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
        const r = this.pairFor(w, { mine: [...TALK_PARTS], theirs: this.partsOf(t), tag: null }, input.pick, probe, t)
        if ('reasons' in r) out.push(...r.reasons)
        break
      }
      case 'switch': {
        const known = knownPositions(this.k, this.state, w)
        const target = this.k.content.get<PositionEntry>(POSITION_KIND, input.position)
        if (!target || target.people !== 2) out.push('沒有這個體位。')
        else if (target.id === s.position) out.push('已經是這個體位了。')
        else if (!known.some((p) => p.id === target.id)) out.push(`${me}還不會「${target.name}」：要先學會開放它的夜課技能。`)
        if (this.holder() !== w) out.push(`主動權不在${me}手上：換不換體位由${this.isPc(w) ? '對方' : '你'}決定。`)
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
        if (info.def.positions && !info.def.positions.includes(s.position)) out.push(`「${info.name}」要在${info.def.positions.map((id) => this.k.content.get(POSITION_KIND, id)?.name ?? id).join('、')}才用得出來，現在是${this.pos.name}。`)
        if (info.tag && !hasTendencyTag(this.actor(w), info.tag)) out.push(`要有「${this.tagName(info.tag)}」的標籤（或對應的調校、道具、服裝）才用得出來。`)
        out.push(...this.needBlocks(w, info.def))
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

  private basic(w: ActorId, t: ActorId, kind: 'dominate' | 'yield' | 'tease'): void {
    const r = this.rules[kind]
    this.spend(w, this.rules.cost[kind])
    const roll = this.roller(w)
    const their = roll({ sign: 1, n: r.their, sides: 6, flat: 0 })
    const mine = roll({ sign: 1, n: r.mine, sides: 6, flat: 0 })
    const a = this.hurt(t, their, w)
    const b = this.hurt(w, mine, w)
    const f = this.addFit(r.fit, w)
    this.addInit(r.init, w)
    if (kind === 'tease') this.seat(w).teased = true
    const text = {
      dominate: this.isPc(w) ? `你掌握了節奏。` : `${this.name(w)}掌握了節奏。`,
      yield: this.isPc(w) ? `你順著${this.name(t)}的節奏迎上去。` : `${this.name(w)}順著你的節奏迎上來。`,
      tease: this.isPc(w) ? `你放慢下來，吊著${this.name(t)}。` : `${this.name(w)}放慢下來，吊著你。`,
    }[kind]
    this.line(w, text, kind, { target_load: a, my_load: b, fit: f, init: r.init })
  }

  private restrain(w: ActorId): void {
    this.spend(w, this.rules.cost.restrain)
    const n = Math.max(0, this.rules.restrain_base + this.resolveMod(w))
    const before = this.load[w]!
    this.load[w] = Math.max(0, before - n)
    this.seat(w).restrained = true
    this.line(w, this.isPc(w) ? '你深吸一口氣，把自己壓住。' : `${this.name(w)}閉上眼，慢了下來。`, 'restrain', { my_load: before - this.load[w]! })
  }

  /** 技能與道具：花行動點，用出去的那一下，再建立連接（有部位的話）。 */
  private use(w: ActorId, t: ActorId, kind: 'skill' | 'item', id: string, pick: PartPick | undefined): void {
    const info = sceneDefOf(this.k, kind, id)!
    const def = info.def
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
    if (match) fit += def.match_bonus ?? this.rules.match_bonus
    const f = this.addFit(fit, w)
    this.addInit(def.on_use.init, w)
    if (info.tag && !this.s.touched.includes(info.tag)) this.s.touched.push(info.tag)
    if (kind === 'item' && info.consumable) this.consumed = id
    if (linked) this.addLink(w, t, kind, id, info.name, linked, def.link ? { my_load: dieSpec(def.link.my_load), their_load: dieSpec(def.link.their_load), fit: def.link.fit } : { my_load: 0, their_load: 0, fit: 0 }, def.double)
    const verb = kind === 'skill' ? '施展' : '用上'
    const text = linked
      ? `${this.name(w)}用${partName(linked.mine)}${verb}「${info.name}」，接上${this.name(t)}的${partName(linked.theirs)}。`
      : `${this.name(w)}${verb}「${info.name}」。`
    this.line(w, text, kind, { id, target_load: a, my_load: b, fit: f, init: def.on_use.init, ...(linked ? { my_part: linked.mine, their_part: linked.theirs } : {}), ...(match ? { match: info.tag } : {}) })
  }

  private talk(w: ActorId, t: ActorId, input: Extract<SceneInput, { kind: 'talk' }>): void {
    this.spend(w, this.rules.cost.talk)
    const a = this.actor(w)
    const env = this.talkEnv
    let fit: number
    let goal = 0
    let extra: Record<string, unknown>
    let check: ReturnType<typeof makeCheck> | null = null
    if (env) {
      // 外面（scene_talk）給的結果：契合夾在 −5～+10、目的的進度夾在 0～+20，不擲檢定
      const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0)
      fit = this.addFit(clamp(n(env.fit), TALK_ENV_FIT[0], TALK_ENV_FIT[1]), w)
      if (this.isPc(w) && this.s.goal !== null && this.s.goal_progress !== null) {
        goal = clamp(n(env.goal), 0, 20)
        this.s.goal_progress = Math.min(100, this.s.goal_progress + goal)
      }
      extra = { source: 'env', ...(typeof env.agree === 'boolean' ? { agree: env.agree } : {}) }
    } else {
      const skill = (a.skills.seduce ?? 0) >= (a.skills.negotiate ?? 0) ? 'seduce' : 'negotiate'
      // M2 用骰子代替判定：魅力加交涉或誘惑對 13
      check = makeCheck({
        natural: this.dice.int(1, 20), parts: checkParts(this.k.stats, this.state, w, { attr: 'charm', skill, tags: ['social', 'scene'] }, this.gearParts(w)), dc: this.rules.talk_dc, attr: 'charm', skill,
      })
      fit = this.addFit(this.rules.talk_fit[check.degree], w)
      if (this.isPc(w) && this.s.goal !== null && this.s.goal_progress !== null) {
        goal = Math.min(20, this.rules.talk_goal[check.degree])
        this.s.goal_progress = Math.min(100, this.s.goal_progress + goal)
      }
      extra = { degree: check.degree }
    }
    const r = this.pairFor(w, { mine: [...TALK_PARTS], theirs: this.partsOf(t), tag: null }, input.pick, false, t)
    if (!('reasons' in r)) this.addLink(w, t, 'talk', 'talk', '說話', r, { my_load: 0, their_load: 0, fit: 0 })
    if (this.isPc(w) && input.text) this.said = input.text.slice(0, 200)
    this.line(w, this.isPc(w) ? `你對${this.name(t)}說了幾句話。` : `${this.name(w)}開口說了幾句話。`, 'talk', { fit, goal, ...extra })
    if (check) this.beats[this.beats.length - 1]!.roll = check
  }

  /** 身為起手的人拿到上位（體位沒有上位時，第一個位置）。 */
  assignRoles(pos: PositionEntry, w: ActorId): Record<ActorId, string> {
    const upper = pos.roles.find((r) => r.upper) ?? pos.roles[0]!
    const lower = pos.roles.find((r) => r.id !== upper.id)!
    return { [w]: upper.id, [this.opp(w)]: lower.id }
  }

  /** 換進一個體位（開場也走這裡，不花行動點）：位置、標籤的契合、用過的體位。連接由呼叫的人處理。 */
  enter(position: PositionEntry, w: ActorId): void {
    this.s.position = position.id
    this.s.roles = this.assignRoles(position, w)
    if (!this.s.used_positions.includes(position.id)) this.s.used_positions.push(position.id)
    if (position.tag) {
      let any = false
      for (const who of this.ids) {
        if (hasTendencyTag(this.actor(who), position.tag)) {
          any = true
          this.addFit(this.rules.position_tag_fit, who)
        }
      }
      if (any && !this.s.touched.includes(position.tag)) this.s.touched.push(position.tag)
    }
  }

  private switchTo(w: ActorId, id: string): void {
    this.spend(w, this.rules.cost.switch)
    const next = this.k.content.require<PositionEntry>(POSITION_KIND, id)
    const old = this.s.links
    this.s.links = []
    this.enter(next, w)
    this.line(w, `換成${next.name}。連接全部重來。`, 'switch', { position: id })
    if (this.s.mode === 'simple') this.relink(old)
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

  /** 做一個行動（blocks 已經看過）。stop 與 end_turn 只改狀態。 */
  perform(w: ActorId, input: SceneInput): void {
    const t = input.target ?? this.opp(w)
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease': return this.basic(w, t, input.kind)
      case 'restrain': return this.restrain(w)
      case 'skill': case 'item': return this.use(w, t, input.kind, input.id, input.pick)
      case 'talk': return this.talk(w, t, input)
      case 'switch': return this.switchTo(w, input.position)
      case 'gear': return this.shiftTo(w, input.gear)
      case 'stop':
        this.line(w, '你停了下來。', 'stop')
        this.ended = 'stop'
        return
      case 'end_turn':
        this.line(w, this.isPc(w) ? '你等著對方。' : `${this.name(w)}等著。`, 'end_turn')
        this.s.turn = this.opp(w)
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
    else if (this.load[w]! >= PARTNER_GEAR_DOWN_AT * this.loadMax[w]!) to = SYNC_GEARS[Math.max(0, gearIndexOf(seat.gear) - 1)]!
    if (to !== seat.gear && this.blocks(w, { kind: 'gear', gear: to }).length === 0) this.perform(w, { kind: 'gear', gear: to })
  }

  /**
   * 這個人這一步做什麼（照規則挑）：主動權在他手上而且有更有利的體位就換；自己的感載高就克制（每回合一次）；
   * 還沒有連接就用自己的技能或說話建立一條；否則照性質在主導、迎合、挑逗裡加權抽。沒有可做的（行動點用完）是 null：他的回合結束。
   */
  choiceFor(w: ActorId): SceneInput | null {
    const s = this.s
    const ok = (i: SceneInput): boolean => this.blocks(w, i).length === 0
    if (this.holder() === w && this.seat(w).ap >= this.rules.cost.switch) {
      const now = this.posScore(w, this.pos, s.roles[w] ?? '')
      let best: { id: string; score: number } | null = null
      for (const p of knownPositions(this.k, this.state, w)) {
        if (p.id === s.position) continue
        const sc = this.posScore(w, p, this.assignRoles(p, w)[w] ?? '')
        if (sc > now + 1e-9 && (!best || sc > best.score + 1e-9) && ok({ kind: 'switch', position: p.id })) best = { id: p.id, score: sc }
      }
      if (best) return { kind: 'switch', position: best.id }
    }
    if (this.load[w]! >= this.rules.partner_restrain_at * this.loadMax[w]! && !this.seat(w).restrained && ok({ kind: 'restrain' })) return { kind: 'restrain' }
    if (s.links.length === 0) {
      const skills = knownSkills(this.k, this.state, w).filter((id) => ok({ kind: 'skill', id }))
      if (skills.length > 0) return { kind: 'skill', id: skills[this.dice.int(0, skills.length - 1)]! }
      return ok({ kind: 'talk' }) ? { kind: 'talk' } : null
    }
    const cands = (['dominate', 'yield', 'tease'] as const).filter((kind) => ok({ kind }))
    if (cands.length === 0) return null
    const weights = this.rules.partner_weights[s.nature]
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
    for (const l of [...s.links]) {
      if (this.ended) return
      const their = rollDie(this.dice, parseDie(l.link.their_load)!)
      const mine = rollDie(this.dice, parseDie(l.link.my_load)!)
      this.applyLoad(l.to, half(l.to, their), l.by, l.theirs)
      this.applyLoad(l.by, half(l.by, mine), l.by, l.mine)
      if (l.link.fit) this.addFit(l.link.fit, l.by)
    }
    if (this.ended) return
    const drift = this.pos.initiative_drift ?? this.rules.upper_drift
    for (const id of this.ids) if (this.isUpper(id)) this.addInit(drift, id)
    for (const id of this.ids) this.load[id] = Math.max(0, this.load[id]! - Math.max(0, 2 + this.resolveMod(id)))
    if (s.goal === 'stall' && s.goal_progress !== null) s.goal_progress = Math.min(100, s.goal_progress + this.rules.goal_stall_per_round)
    this.beats.push(beat(undefined, `第 ${s.round} 回合結束。`, 'round', { round: s.round }))
    if (s.round >= this.rules.quit_rounds && this.pair.fit <= this.rules.quit_fit) {
      this.line(this.partnerId, `${this.name(this.partnerId)}說今天就到這裡。`, 'quit')
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
    for (const seat of s.seats) seat.ap = Math.min(this.apMax[seat.id]!, seat.ap + this.rules.ap_regen + (this.gearRule(seat.id).apRegen ?? 0))
    for (const seat of s.seats) {
      seat.restrained = false
      seat.shifted = false
    }
    s.turn_began = false
    s.turn = s.pc
  }

  // ---- 預覽 ----

  /** 一個行動的預覽（畫面要的）：雙方的感載（骰、倍率、範圍）、契合、主動權、花的行動點。數字都是引擎算的。 */
  preview(w: ActorId, input: SceneInput): Preview {
    const o = input.target ?? this.opp(w)
    const seat = this.seat(w)
    const dice = (d: Die, target: ActorId, part?: string): PreviewLoad | null => {
      if (isNoDie(d)) return null
      const extra = seat.teased && d.n > 0 ? 1 : 0
      const r = dieRange(d, extra)
      const m = d.sign > 0 ? (this.rules.load_base + this.sensAt(target, part) / this.rules.load_div) * this.mult(target) * this.boost(w) * this.gearMult(target) : 1
      return { dice: dieTextOf(d, extra), mult: round2(m), min: Math.round(r.min * m), max: Math.round(r.max * m), avg: round1(r.avg * m) }
    }
    const basic = (kind: 'dominate' | 'yield' | 'tease'): Preview => {
      const r = this.rules[kind]
      return {
        ap: this.rules.cost[kind], target_load: dice({ sign: 1, n: r.their, sides: 6, flat: 0 }, o), my_load: dice({ sign: 1, n: r.mine, sides: 6, flat: 0 }, w),
        fit: r.fit > 0 ? Math.round(r.fit * this.boost(w)) : r.fit, init: r.init, link: false,
      }
    }
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease': return basic(input.kind)
      case 'restrain': {
        const n = Math.max(0, this.rules.restrain_base + this.resolveMod(w))
        return { ap: this.rules.cost.restrain, target_load: null, my_load: { dice: `−${n}`, mult: 1, min: -n, max: -n, avg: -n }, fit: 0, init: 0, link: false }
      }
      case 'talk': return { ap: this.rules.cost.talk, target_load: null, my_load: null, fit: this.rules.talk_fit.fumble, fit_max: this.rules.talk_fit.critical, init: 0, link: true }
      case 'switch': return { ap: this.rules.cost.switch, target_load: null, my_load: null, fit: 0, init: 0, link: false }
      case 'gear': {
        const g = this.sync.gears[input.gear]
        return { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false, gear: { id: input.gear, name: `${g.name}檔`, check: g.check, load_pct: g.loadPct, ap_regen: g.apRegen ?? 0, sink_on_overload: g.sinkOnOverload ?? 0 } }
      }
      case 'skill': case 'item': {
        const info = sceneDefOf(this.k, input.kind, input.id)
        if (!info) return { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false }
        const d = info.def
        const match = !!info.tag && hasTendencyTag(this.actor(o), info.tag)
        const fit = d.on_use.fit + (match ? d.match_bonus ?? this.rules.match_bonus : 0)
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
