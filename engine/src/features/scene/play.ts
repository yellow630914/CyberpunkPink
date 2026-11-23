// L6 功能 scene 的一步一步：場景裡的行動、連接、感載與高潮、對方的一步、每回合的結算。全部是純的：
// 拿現在的狀態做一份工作副本（Play），照規則改它，改完由 end.ts 與 index.ts 把差異寫成報告的變更。
// 規格：LEWD_SYSTEM 3.5 節（一～六點、第八點）；CORE_RULES 4.2 節；dev/work/M2-scene.md。

import type { ActorId, GameState, Kernel, TimelineBeat } from '../../core'
import { attrMod, checkParts, clone, deriveRng, makeCheck } from '../../core'
import type { ActionId, Die, Dice, EndReason, LinkRec, PositionEntry, SceneDef, SceneRules, SceneState, Who } from './model'
import {
  ACTION_NAME, POSITION_KIND, TALK_PARTS, beat, dieRange, hasTendencyTag, isNoDie, knowOf, knownPositions, knownSkills, other, parseDie, partName, partsOf, rollDie,
  sceneDefOf, sceneRules, sensitivityOf, statOr, MAX_LINES,
} from './model'

// ---- 輸入 ----

export interface PartPick { my_part?: string; their_part?: string }

/** 玩家（與對方的一步）的輸入。end_turn 不是第十種行動：把回合交出去，沒用完的行動點留到下回合。 */
export type SceneInput =
  | { kind: 'dominate' | 'yield' | 'tease' | 'restrain' | 'stop' | 'end_turn' }
  | { kind: 'skill'; id: string; pick?: PartPick }
  | { kind: 'item'; id: string; pick?: PartPick }
  | { kind: 'talk'; text?: string; pick?: PartPick }
  | { kind: 'switch'; position: string }

const KINDS: readonly string[] = ['dominate', 'yield', 'tease', 'restrain', 'stop', 'end_turn', 'skill', 'item', 'talk', 'switch']

/** 輸入的格式問題（一句）；沒有問題是 null。 */
export function inputProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || typeof (input as { kind?: unknown }).kind !== 'string') return '要給一個行動：{ kind: ... }。'
  const i = input as Record<string, unknown>
  if (!KINDS.includes(i.kind as string)) return `沒有「${String(i.kind)}」這種行動。`
  if ((i.kind === 'skill' || i.kind === 'item') && (typeof i.id !== 'string' || !i.id)) return `${ACTION_NAME[i.kind]}要指明是哪一個（id）。`
  if (i.kind === 'switch' && (typeof i.position !== 'string' || !i.position)) return '切換體位要指明換成哪個體位（position）。'
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

interface PairCand { mine: string[]; theirs: string[]; tag: string | null; asPart?: string }
type Pair = { mine: string; theirs: string }
export type PairResult = Pair | { reasons: string[] }

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const sameEnd = (a: readonly string[], role: string, part: string): boolean => a[0] === role && a[1] === part

export class Play {
  readonly s: SceneState
  readonly rules: SceneRules
  readonly load: Record<Who, number>
  readonly glow: Record<Who, number>
  readonly loadMax: Record<Who, number>
  readonly glowMax: Record<Who, number>
  readonly apMax: Record<Who, number>
  readonly sens: Record<Who, number>
  /** 這一步開始時的感載與餘韻（寫變更時算差） */
  readonly was: { load: Record<Who, number>; glow: Record<Who, number> }
  ended: EndReason | null = null
  /** 這一步的每一拍（給報告的 timeline） */
  beats: TimelineBeat[] = []
  /** 說話的原文（報告的 input） */
  said: string | undefined
  /** 用掉的消耗品 */
  consumed: string | null = null

  constructor(readonly k: Kernel, readonly state: GameState, scene: SceneState, readonly dice: Dice) {
    this.s = clone(scene)
    this.rules = sceneRules(k)
    const both = <T>(f: (w: Who) => T): Record<Who, T> => ({ pc: f('pc'), partner: f('partner') })
    const mod = (w: Who, attr: 'resolve' | 'reflex' | 'charm'): number => attrMod(k.stats.effectiveAttr(state, this.id(w), attr))
    this.loadMax = both((w) => Math.max(1, statOr(k, state, this.id(w), 'load_cap', 20 + mod(w, 'resolve') * 3)))
    this.glowMax = both((w) => statOr(k, state, this.id(w), 'afterglow_cap', 3))
    this.apMax = both((w) => Math.max(1, statOr(k, state, this.id(w), 'ap_max', 4 + Math.floor((mod(w, 'reflex') + mod(w, 'charm')) / 2))))
    this.sens = both((w) => sensitivityOf(k, state, this.id(w)))
    this.load = both((w) => clamp(state.actors[this.id(w)]!.load, 0, this.loadMax[w] - 1))
    this.glow = both((w) => state.actors[this.id(w)]!.afterglow)
    this.was = { load: { ...this.load }, glow: { ...this.glow } }
  }

  // ---- 基本的讀 ----

  id(w: Who): ActorId { return w === 'pc' ? this.s.pc : this.s.partner }
  actor(w: Who) { return this.state.actors[this.id(w)]! }
  /** 文字裡的稱呼：主角是「你」，對方是他的名字。 */
  name(w: Who): string { return w === 'pc' ? '你' : this.actor(w).name }
  get pos(): PositionEntry { return this.k.content.require<PositionEntry>(POSITION_KIND, this.s.position) }
  holder(): Who { return this.s.init >= 50 ? 'pc' : 'partner' }
  resolveMod(w: Who): number { return attrMod(this.k.stats.effectiveAttr(this.state, this.id(w), 'resolve')) }
  mult(w: Who): number { return this.pos.mult[this.s.roles[w]] ?? 1 }
  isUpper(w: Who): boolean { return this.pos.roles.find((r) => r.id === this.s.roles[w])?.upper === true }
  tagName(tag: string): string { return (this.k.content.get('tendency_tag', tag)?.name as string | undefined) ?? tag }
  /** 自己造成的感載與契合：每一層餘韻 +10%。 */
  boost(src: Who): number { return 1 + this.rules.glow_bonus * this.glow[src] }

  line(w: Who, text: string, tag?: string, data?: Record<string, unknown>): void {
    this.s.lines.push({ round: this.s.round, who: w, text })
    if (this.s.lines.length > MAX_LINES) this.s.lines.splice(0, this.s.lines.length - MAX_LINES)
    this.beats.push(beat(this.id(w), text, tag, data))
  }

  // ---- 感載、契合、主動權 ----

  /** 受到的感載 = 原始值 ×（0.75 ＋ 敏感度 ÷ 200）× 體位的倍率 ×（1 ＋ 0.1 × 造成的人的餘韻）。滿了就是高潮。回傳實際加了多少。 */
  hurt(target: Who, raw: number, src: Who): number {
    if (this.ended || raw <= 0) return 0
    const n = Math.round(raw * (this.rules.load_base + this.sens[target] / this.rules.load_div) * this.mult(target) * this.boost(src))
    this.load[target] += n
    this.s.received[target] += n
    while (!this.ended && this.load[target] >= this.loadMax[target]) this.climax(target, src)
    return n
  }

  /** 正的是受到，負的是減輕（藥、貼片）。 */
  applyLoad(target: Who, amount: number, src: Who): number {
    if (amount >= 0) return this.hurt(target, amount, src)
    this.load[target] = Math.max(0, this.load[target] + amount)
    return amount
  }

  addFit(n: number, src: Who): number {
    if (this.ended) return 0
    const v = n > 0 ? Math.round(n * this.boost(src)) : n
    this.s.fit = clamp(this.s.fit + v, 0, 100)
    return v
  }

  /** n 是 w 這一邊的變化：主導 +10 就是 w 更有主動權（主角的主動權往上、對方的往下）。 */
  addInit(n: number, w: Who): void {
    if (this.ended) return
    this.s.init = clamp(this.s.init + (w === 'pc' ? n : -n), 0, 100)
  }

  /** 過載就是高潮：感載歸零，疊一層餘韻，不失去回合；自己高潮主動權 −15，讓對方高潮的人 +10。餘韻疊滿之後又高潮就失神。 */
  climax(target: Who, src: Who): void {
    this.load[target] = 0
    if (this.glow[target] >= this.glowMax[target]) {
      this.line(target, target === 'pc' ? '你失神了。' : `${this.name(target)}失神了。`, 'out')
      this.ended = target === 'pc' ? 'pc_out' : 'partner_out'
      return
    }
    this.glow[target] += 1
    this.s.climax[target] += 1
    this.addInit(this.rules.climax_init_self, target)
    if (src !== target) this.addInit(this.rules.climax_init_cause, src)
    if (target === 'partner' && this.s.goal === 'please' && this.s.goal_progress !== null) this.s.goal_progress = Math.min(100, this.s.goal_progress + this.rules.goal_please_per_climax)
    this.line(target, `${this.name(target)}達到了頂點（餘韻 ${this.glow[target]}／${this.glowMax[target]}）。`, 'climax', { glow: this.glow[target] })
  }

  // ---- 部位與連接 ----

  occupiers(who: Who, part: string): LinkRec[] {
    return this.s.links.filter((l) => (l.by === who && l.mine === part) || (other(l.by) === who && l.theirs === part))
  }

  /** 體位碰不碰得到（兩個方向都算）。道具自己算一個部位：它碰得到的是「這個位置碰得到的任何部位」。 */
  reaches(w: Who, mine: string, theirs: string, asPart?: string): boolean {
    const a = this.s.roles[w]
    const b = this.s.roles[other(w)]
    const links = this.pos.links
    if (asPart !== undefined && mine === asPart) return links.some((l) => (l.from[0] === a && sameEnd(l.to, b, theirs)) || (l.to[0] === a && sameEnd(l.from, b, theirs)))
    return links.some((l) => (sameEnd(l.from, a, mine) && sameEnd(l.to, b, theirs)) || (sameEnd(l.to, a, mine) && sameEnd(l.from, b, theirs)))
  }

  /** 這個位置上有沒有可以接的部位：畫面把部位分成「碰得到」與「碰不到」用。 */
  partReachable(w: Who, part: string): boolean {
    const a = this.s.roles[w]
    return this.pos.links.some((l) => sameEnd(l.from, a, part) || sameEnd(l.to, a, part))
  }

  private tagged(w: Who, part: string, tag: string | null): boolean {
    return !!tag && !!knowOf(this.actor(w)).part_tags[part]?.includes(tag)
  }

  /**
   * 用哪個部位接對方的哪個部位（LEWD_SYSTEM 3.5 節第四點、第八點）。玩家給了就照給的（要合規）；沒給：完整版擋下要玩家選，精簡版由程式挑——
   * 技能寫的部位裡空著的優先；有對應標籤的部位優先；都佔著就換掉最早建立的那一條。對方的一步永遠由程式挑。
   */
  pairFor(w: Who, c: PairCand, given: PartPick | undefined, forceAuto = false): PairResult {
    const o = other(w)
    const myPick = given ? given.my_part : undefined
    const theirPick = given ? given.their_part : undefined
    const need = this.s.mode === 'full' && w === 'pc' && !forceAuto
    const reasons: string[] = []
    if (need && (myPick === undefined || theirPick === undefined)) {
      if (myPick === undefined) reasons.push('要選用你的哪個部位。')
      if (theirPick === undefined) reasons.push('要選接對方的哪個部位。')
      return { reasons }
    }
    const mineOk = c.mine.filter((x) => (c.asPart !== undefined && x === c.asPart) || partsOf(this.actor(w)).includes(x))
    const theirsOk = c.theirs.filter((x) => partsOf(this.actor(o)).includes(x))
    if (myPick !== undefined && !c.mine.includes(myPick)) reasons.push(`這一個用不了你的「${partName(myPick)}」：只能用${c.mine.map(partName).join('、')}。`)
    if (theirPick !== undefined && !c.theirs.includes(theirPick)) reasons.push(`這一個接不到對方的「${partName(theirPick)}」：只能接${c.theirs.map(partName).join('、')}。`)
    if (reasons.length > 0) return { reasons }
    if (myPick !== undefined && !mineOk.includes(myPick)) return { reasons: [`你沒有「${partName(myPick)}」這個部位。`] }
    if (theirPick !== undefined && !theirsOk.includes(theirPick)) return { reasons: [`${this.name(o)}沒有「${partName(theirPick)}」這個部位。`] }
    const mines = myPick !== undefined ? [myPick] : mineOk
    const theirs = theirPick !== undefined ? [theirPick] : theirsOk
    const cands: Pair[] = []
    for (const m of mines) for (const t of theirs) if (this.reaches(w, m, t, c.asPart)) cands.push({ mine: m, theirs: t })
    if (cands.length === 0) {
      if (mines.length === 0 || theirs.length === 0) return { reasons: ['你或對方沒有這一項要用的部位。'] }
      const m = mines[0]!
      const t = theirs[0]!
      return { reasons: [myPick !== undefined && theirPick !== undefined ? `${this.pos.name}碰不到：你的${partName(m)}接不到對方的${partName(t)}，換一個體位。` : `${this.pos.name}碰不到這一項要用的部位：換一個體位。`] }
    }
    if (myPick !== undefined && theirPick !== undefined) return cands[0]!
    return this.autoPick(w, cands, c.tag)
  }

  private autoPick(w: Who, cands: Pair[], tag: string | null): Pair {
    const o = other(w)
    const occ = (c: Pair): LinkRec[] => [...new Set([...this.occupiers(w, c.mine), ...this.occupiers(o, c.theirs)])]
    const score = (c: Pair): number => (this.tagged(w, c.mine, tag) ? 1 : 0) + (this.tagged(o, c.theirs, tag) ? 1 : 0)
    const free = cands.filter((c) => occ(c).length === 0)
    if (free.length > 0) return free.reduce((best, c) => (score(c) > score(best) ? c : best))
    const earliest = (c: Pair): number => Math.min(...occ(c).map((l) => l.id))
    return cands.reduce((best, c) => (earliest(c) < earliest(best) || (earliest(c) === earliest(best) && occ(c).length < occ(best).length) ? c : best))
  }

  /** 建立一條連接：兩端被佔著的那幾條中斷（一個部位同時只能有一條）。 */
  addLink(w: Who, kind: LinkRec['kind'], source: string, name: string, pair: Pair, link: LinkRec['link']): LinkRec {
    const o = other(w)
    const broken = new Set([...this.occupiers(w, pair.mine), ...this.occupiers(o, pair.theirs)].map((l) => l.id))
    this.s.links = this.s.links.filter((l) => !broken.has(l.id))
    this.s.link_seq += 1
    const rec: LinkRec = { id: this.s.link_seq, by: w, kind, source, name, mine: pair.mine, theirs: pair.theirs, link: clone(link), round: this.s.round }
    this.s.links.push(rec)
    return rec
  }

  /** 精簡版：切換體位之後，照新的體位把剛才那幾條能接的接回去（不花行動點、沒有用出去的那一下）。 */
  relink(old: LinkRec[]): void {
    for (const l of old) {
      const w = l.by
      let cand: PairCand | null = null
      if (l.kind === 'talk') cand = { mine: [...TALK_PARTS], theirs: partsOf(this.actor(other(w))), tag: null }
      else {
        const info = sceneDefOf(this.k, l.kind === 'skill' ? 'skill' : 'item', l.source)
        if (info) cand = candOf(info.def, info.tag)
      }
      if (!cand) continue
      const r = this.pairFor(w, cand, undefined, true)
      if (!('reasons' in r)) this.addLink(w, l.kind, l.source, l.name, r, l.link)
    }
  }

  // ---- 行動前的檢查：現在能不能做與原因（一條一個條件） ----

  /** probe 是只問「能不能」：完整版沒給部位不算缺（畫面另外用 picks 讓玩家選）。 */
  blocks(w: Who, input: SceneInput, probe = false): string[] {
    const s = this.s
    const out: string[] = []
    const me = w === 'pc' ? '你' : '對方'
    if (s.turn !== w) return [`還沒輪到${me}。`]
    if (input.kind === 'stop' || input.kind === 'end_turn') return w === 'pc' ? [] : ['對方沒有這個行動。']
    const cost = costOf(this, input)
    if (s.ap[w] < cost) out.push(`行動點不夠：這個行動要 ${cost} 點，${w === 'pc' ? '你' : '對方'}只剩 ${s.ap[w]} 點。`)
    const linked = s.links.length > 0
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease':
        if (!linked) out.push('還沒有連接：先用技能、道具或說話建立一條。')
        break
      case 'restrain':
        break
      case 'talk': {
        const r = this.pairFor(w, { mine: [...TALK_PARTS], theirs: partsOf(this.actor(other(w))), tag: null }, input.pick, probe)
        if ('reasons' in r) out.push(...r.reasons)
        break
      }
      case 'switch': {
        const known = knownPositions(this.k, this.state, this.id(w))
        const target = this.k.content.get<PositionEntry>(POSITION_KIND, input.position)
        if (!target || target.people !== 2) out.push('沒有這個體位。')
        else if (target.id === s.position) out.push('已經是這個體位了。')
        else if (!known.some((p) => p.id === target.id)) out.push(`${w === 'pc' ? '你' : '對方'}還不會「${target.name}」：要先學會開放它的夜課技能。`)
        if (this.holder() !== w) out.push(`主動權不在${w === 'pc' ? '你' : '對方'}手上：換不換體位由${w === 'pc' ? '對方' : '你'}決定。`)
        break
      }
      case 'skill': case 'item': {
        const info = sceneDefOf(this.k, input.kind, input.id)
        if (!info) {
          out.push(input.kind === 'skill' ? '沒有這個技能。' : '這件東西在場景裡用不出來。')
          break
        }
        if (input.kind === 'skill' && !knownSkills(this.k, this.state, this.id(w)).includes(input.id)) out.push(`${w === 'pc' ? '你' : '對方'}還沒有學會「${info.name}」。`)
        if (input.kind === 'item' && !(w === 'pc' && this.state.inventory.some((x) => x.id === input.id && x.qty > 0))) out.push(`你身上沒有「${info.name}」。`)
        if (info.def.positions && !info.def.positions.includes(s.position)) out.push(`「${info.name}」要在${info.def.positions.map((id) => this.k.content.get(POSITION_KIND, id)?.name ?? id).join('、')}才用得出來，現在是${this.pos.name}。`)
        if (info.tag && !hasTendencyTag(this.actor(w), info.tag)) out.push(`要有「${this.tagName(info.tag)}」的標籤（或對應的調校、道具、服裝）才用得出來。`)
        const cand = candOf(info.def, info.tag)
        // 沒有部位的道具（藥）不建立連接
        if (cand) {
          const r = this.pairFor(w, cand, input.pick, probe)
          if ('reasons' in r) out.push(...r.reasons)
        }
        break
      }
    }
    return out
  }

  // ---- 行動的結算 ----

  private spend(w: Who, n: number): void { this.s.ap[w] -= n }

  /** 這個行動的骰子：挑逗留下的那一顆多的，只加在第一組有骰子的上面，用掉就沒了。 */
  private roller(w: Who): (d: Die) => number {
    let extra = this.s.teased[w] ? 1 : 0
    return (d) => {
      const e = extra > 0 && d.n > 0 ? 1 : 0
      if (e) {
        extra = 0
        this.s.teased[w] = false
      }
      return rollDie(this.dice, d, e)
    }
  }

  private basic(w: Who, kind: 'dominate' | 'yield' | 'tease'): void {
    const r = this.rules[kind]
    this.spend(w, this.rules.cost[kind])
    const roll = this.roller(w)
    const their = roll({ sign: 1, n: r.their, sides: 6, flat: 0 })
    const mine = roll({ sign: 1, n: r.mine, sides: 6, flat: 0 })
    const a = this.hurt(other(w), their, w)
    const b = this.hurt(w, mine, w)
    const f = this.addFit(r.fit, w)
    this.addInit(r.init, w)
    if (kind === 'tease') this.s.teased[w] = true
    const text = {
      dominate: w === 'pc' ? `你掌握了節奏。` : `${this.name(w)}掌握了節奏。`,
      yield: w === 'pc' ? `你順著${this.name(other(w))}的節奏迎上去。` : `${this.name(w)}順著你的節奏迎上來。`,
      tease: w === 'pc' ? `你放慢下來，吊著${this.name(other(w))}。` : `${this.name(w)}放慢下來，吊著你。`,
    }[kind]
    this.line(w, text, kind, { target_load: a, my_load: b, fit: f, init: r.init })
  }

  private restrain(w: Who): void {
    this.spend(w, this.rules.cost.restrain)
    const n = Math.max(0, this.rules.restrain_base + this.resolveMod(w))
    const before = this.load[w]
    this.load[w] = Math.max(0, before - n)
    this.s.restrained[w] = true
    this.line(w, w === 'pc' ? '你深吸一口氣，把自己壓住。' : `${this.name(w)}閉上眼，慢了下來。`, 'restrain', { my_load: before - this.load[w] })
  }

  /** 技能與道具：花行動點，用出去的那一下，再建立連接（有部位的話）。 */
  private use(w: Who, kind: 'skill' | 'item', id: string, pick: PartPick | undefined): void {
    const info = sceneDefOf(this.k, kind, id)!
    const def = info.def
    const o = other(w)
    this.spend(w, def.ap)
    const roll = this.roller(w)
    const their = roll(def.on_use.their_load)
    const mine = roll(def.on_use.my_load)
    const a = this.applyLoad(o, their, w)
    const b = this.applyLoad(w, mine, w)
    let fit = def.on_use.fit
    const match = !!info.tag && hasTendencyTag(this.actor(o), info.tag)
    if (match) fit += def.match_bonus ?? this.rules.match_bonus
    const f = this.addFit(fit, w)
    this.addInit(def.on_use.init, w)
    if (info.tag && !this.s.touched.includes(info.tag)) this.s.touched.push(info.tag)
    if (kind === 'item' && info.consumable) this.consumed = id
    const cand = candOf(def, info.tag)
    let linked: { mine: string; theirs: string } | null = null
    if (cand) {
      const r = this.pairFor(w, cand, pick)
      if (!('reasons' in r)) {
        this.addLink(w, kind, id, info.name, r, def.link ? { my_load: dieSpec(def.link.my_load), their_load: dieSpec(def.link.their_load), fit: def.link.fit } : { my_load: 0, their_load: 0, fit: 0 })
        linked = r
      }
    }
    const verb = kind === 'skill' ? '施展' : '用上'
    const text = linked
      ? `${this.name(w)}用${partName(linked.mine)}${verb}「${info.name}」，接上${this.name(o)}的${partName(linked.theirs)}。`
      : `${this.name(w)}${verb}「${info.name}」。`
    this.line(w, text, kind, { id, target_load: a, my_load: b, fit: f, init: def.on_use.init, ...(linked ? { my_part: linked.mine, their_part: linked.theirs } : {}), ...(match ? { match: info.tag } : {}) })
  }

  private talk(w: Who, input: Extract<SceneInput, { kind: 'talk' }>): void {
    const o = other(w)
    this.spend(w, this.rules.cost.talk)
    const a = this.actor(w)
    const skill = (a.skills.seduce ?? 0) >= (a.skills.negotiate ?? 0) ? 'seduce' : 'negotiate'
    // M2 用骰子代替判定：魅力加交涉或誘惑對 13
    const check = makeCheck({
      natural: this.dice.int(1, 20), parts: checkParts(this.k.stats, this.state, this.id(w), { attr: 'charm', skill, tags: ['social', 'scene'] }), dc: this.rules.talk_dc, attr: 'charm', skill,
    })
    const fit = this.addFit(this.rules.talk_fit[check.degree], w)
    let goal = 0
    if (w === 'pc' && this.s.goal !== null && this.s.goal_progress !== null) {
      goal = Math.min(20, this.rules.talk_goal[check.degree])
      this.s.goal_progress = Math.min(100, this.s.goal_progress + goal)
    }
    const r = this.pairFor(w, { mine: [...TALK_PARTS], theirs: partsOf(this.actor(o)), tag: null }, input.pick)
    if (!('reasons' in r)) this.addLink(w, 'talk', 'talk', '說話', r, { my_load: 0, their_load: 0, fit: 0 })
    if (w === 'pc' && input.text) this.said = input.text.slice(0, 200)
    this.line(w, w === 'pc' ? `你對${this.name(o)}說了幾句話。` : `${this.name(w)}開口說了幾句話。`, 'talk', { fit, goal, degree: check.degree })
    this.beats[this.beats.length - 1]!.roll = check
  }

  /** 身為起手的人拿到上位（體位沒有上位時，第一個位置）。 */
  assignRoles(pos: PositionEntry, w: Who): Record<Who, string> {
    const upper = pos.roles.find((r) => r.upper) ?? pos.roles[0]!
    const lower = pos.roles.find((r) => r.id !== upper.id)!
    return { [w]: upper.id, [other(w)]: lower.id } as Record<Who, string>
  }

  /** 換進一個體位（開場也走這裡，不花行動點）：位置、標籤的契合、用過的體位。連接由呼叫的人處理。 */
  enter(position: PositionEntry, w: Who): void {
    this.s.position = position.id
    this.s.roles = this.assignRoles(position, w)
    if (!this.s.used_positions.includes(position.id)) this.s.used_positions.push(position.id)
    if (position.tag) {
      let any = false
      for (const who of ['pc', 'partner'] as const) {
        if (hasTendencyTag(this.actor(who), position.tag)) {
          any = true
          this.addFit(this.rules.position_tag_fit, who)
        }
      }
      if (any && !this.s.touched.includes(position.tag)) this.s.touched.push(position.tag)
    }
  }

  private switchTo(w: Who, id: string): void {
    this.spend(w, this.rules.cost.switch)
    const next = this.k.content.require<PositionEntry>(POSITION_KIND, id)
    const old = this.s.links
    this.s.links = []
    this.enter(next, w)
    this.line(w, `換成${next.name}。連接全部重來。`, 'switch', { position: id })
    if (this.s.mode === 'simple') this.relink(old)
  }

  /** 做一個行動（blocks 已經看過）。stop 與 end_turn 只改狀態。 */
  perform(w: Who, input: SceneInput): void {
    switch (input.kind) {
      case 'dominate': case 'yield': case 'tease': return this.basic(w, input.kind)
      case 'restrain': return this.restrain(w)
      case 'skill': case 'item': return this.use(w, input.kind, input.id, input.pick)
      case 'talk': return this.talk(w, input)
      case 'switch': return this.switchTo(w, input.position)
      case 'stop':
        this.line(w, '你停了下來。', 'stop')
        this.ended = 'stop'
        return
      case 'end_turn':
        this.line(w, w === 'pc' ? '你等著對方。' : `${this.name(w)}等著。`, 'end_turn')
        this.s.turn = other(w)
        return
    }
  }

  // ---- 對方的一步（LEWD_SYSTEM 3.5 節；工單第 6 點） ----

  /** 這個位置對他有利的程度：自己受到的倍率越低越好、在上位、有他喜歡的標籤。 */
  private posScore(pos: PositionEntry, role: string): number {
    const r = pos.roles.find((x) => x.id === role)
    return -(pos.mult[role] ?? 1) + (r?.upper ? 0.5 : 0) + (pos.tag && hasTendencyTag(this.actor('partner'), pos.tag) ? 0.5 : 0)
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
   * 對方這一步做什麼（照規則挑）：主動權在他手上而且有更有利的體位就換；自己的感載高就克制（每回合一次）；
   * 還沒有連接就用自己的技能或說話建立一條；否則照性質在主導、迎合、挑逗裡加權抽。沒有可做的（行動點用完）是 null：他的回合結束。
   */
  partnerChoice(): SceneInput | null {
    const w: Who = 'partner'
    const s = this.s
    const ok = (i: SceneInput): boolean => this.blocks(w, i).length === 0
    if (this.holder() === w && s.ap.partner >= this.rules.cost.switch) {
      const now = this.posScore(this.pos, s.roles.partner)
      let best: { id: string; score: number } | null = null
      for (const p of knownPositions(this.k, this.state, this.id(w))) {
        if (p.id === s.position) continue
        const sc = this.posScore(p, this.assignRoles(p, w).partner)
        if (sc > now + 1e-9 && (!best || sc > best.score + 1e-9) && ok({ kind: 'switch', position: p.id })) best = { id: p.id, score: sc }
      }
      if (best) return { kind: 'switch', position: best.id }
    }
    if (this.load.partner >= this.rules.partner_restrain_at * this.loadMax.partner && !s.restrained.partner && ok({ kind: 'restrain' })) return { kind: 'restrain' }
    if (s.links.length === 0) {
      const skills = knownSkills(this.k, this.state, this.id(w)).filter((id) => ok({ kind: 'skill', id }))
      if (skills.length > 0) return { kind: 'skill', id: skills[this.dice.int(0, skills.length - 1)]! }
      return ok({ kind: 'talk' }) ? { kind: 'talk' } : null
    }
    const cands = (['dominate', 'yield', 'tease'] as const).filter((kind) => ok({ kind }))
    if (cands.length === 0) return null
    const weights = this.rules.partner_weights[s.nature]
    return { kind: this.weighted(cands, (kind) => weights[kind]) }
  }

  // ---- 每回合的結算 ----

  /**
   * 對方的回合做完：每條連接自動生效一次（克制的那一方減半）→ 上位的人推主動權 → 感載自然消退 → 目的（拖住）→ 強制結束的檢查 →
   * 新的一回合：雙方回行動點、克制解除、輪到主角。
   */
  settleRound(): void {
    const s = this.s
    const half = (w: Who, n: number): number => (n > 0 && s.restrained[w] ? Math.round(n * 0.5) : n)
    for (const l of [...s.links]) {
      if (this.ended) return
      const t = other(l.by)
      const their = rollDie(this.dice, parseDie(l.link.their_load)!)
      const mine = rollDie(this.dice, parseDie(l.link.my_load)!)
      this.applyLoad(t, half(t, their), l.by)
      this.applyLoad(l.by, half(l.by, mine), l.by)
      if (l.link.fit) this.addFit(l.link.fit, l.by)
    }
    if (this.ended) return
    const drift = this.pos.initiative_drift ?? this.rules.upper_drift
    for (const w of ['pc', 'partner'] as const) if (this.isUpper(w)) this.addInit(drift, w)
    for (const w of ['pc', 'partner'] as const) this.load[w] = Math.max(0, this.load[w] - Math.max(0, 2 + this.resolveMod(w)))
    if (s.goal === 'stall' && s.goal_progress !== null) s.goal_progress = Math.min(100, s.goal_progress + this.rules.goal_stall_per_round)
    this.beats.push(beat(undefined, `第 ${s.round} 回合結束。`, 'round', { round: s.round }))
    if (s.round >= this.rules.quit_rounds && s.fit <= this.rules.quit_fit) {
      this.line('partner', `${this.name('partner')}說今天就到這裡。`, 'quit')
      this.ended = 'partner_quit'
      return
    }
    s.round += 1
    for (const w of ['pc', 'partner'] as const) s.ap[w] = Math.min(this.apMax[w], s.ap[w] + this.rules.ap_regen)
    s.restrained = { pc: false, partner: false }
    s.turn = 'pc'
  }

  // ---- 預覽 ----

  /** 一個行動的預覽（畫面要的）：雙方的感載（骰、倍率、範圍）、契合、主動權、花的行動點。數字都是引擎算的。 */
  preview(w: Who, input: SceneInput): Preview {
    const o = other(w)
    const dice = (d: Die, target: Who): PreviewLoad | null => {
      if (isNoDie(d)) return null
      const extra = this.s.teased[w] && d.n > 0 ? 1 : 0
      const r = dieRange(d, extra)
      const m = d.sign > 0 ? (this.rules.load_base + this.sens[target] / this.rules.load_div) * this.mult(target) * this.boost(w) : 1
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
      case 'skill': case 'item': {
        const info = sceneDefOf(this.k, input.kind, input.id)
        if (!info) return { ap: 0, target_load: null, my_load: null, fit: 0, init: 0, link: false }
        const d = info.def
        const match = !!info.tag && hasTendencyTag(this.actor(o), info.tag)
        const fit = d.on_use.fit + (match ? d.match_bonus ?? this.rules.match_bonus : 0)
        return {
          ap: d.ap, target_load: dice(d.on_use.their_load, o), my_load: dice(d.on_use.my_load, w), fit: fit > 0 ? Math.round(fit * this.boost(w)) : fit, init: d.on_use.init, link: candOf(d, info.tag) !== null,
          ...(d.link ? { per_round: { target_load: dice(d.link.their_load, o), my_load: dice(d.link.my_load, w), fit: d.link.fit } } : {}),
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
  return { mine, theirs: def.their_part, tag, ...(def.as_part !== undefined ? { asPart: def.as_part } : {}) }
}

/** 一步用的骰子：用途是 scene/<場景 id>/<第幾步>，同一個種子與同樣的行動序列一定一樣。 */
export function diceOf(state: GameState, scene: Pick<SceneState, 'id' | 'step'>): Dice {
  return deriveRng(state.rng, `scene/${scene.id}/${scene.step}`)
}

export type { ActionId }
