import type { Rng } from '../combat/rng'
import {
  BASE_PARTS, POSITIONS, TECHNIQUES, SCENE_ITEMS, SYNC_MULT, NATURE_INIT,
  type Actor, type PartId, type Position, type SceneSetup, type SyncLevel, type Technique, type Who,
} from './data'

/**
 * 成人場景（LEWD_SYSTEM 3.5 節）的純邏輯：和戰鬥同一套骨架（行動點、感載、餘韻、同步檔位），沒有站位、命中與生命。
 * 過載就是高潮：感載歸零、疊一層餘韻，不失去回合。場景由玩家按「停下」結束；強制結束只有三種（3.5 節第六點）。
 * 每回合只有一句動作或台詞；完整的文字等結束之後一次寫（這裡只出戰報的數字）。
 */
export interface Link { id: number; from: Who; fromPart: PartId; to: Who; toPart: PartId; tech: string; label: string; per: { them: number; me: number; fit: number }; isNew?: boolean }
export interface SceneLine { round: number; who: Who; text: string }
export type Rating = '不合' | '普通' | '合拍' | '難忘'
export interface SceneEnd {
  reason: '停下' | '對方不玩了' | '你失神了' | '對方失神了' | '略過'
  fit: number; rating: Rating; relation: string; affinity: number; insight: number; insightNotes: string[]
  goal: number | null; afterMe: number; lines: number
}
export interface SceneOpts {
  /** 內容篩選（stores/settings）：拘束、公開場合、身體的私密描寫 */
  filters?: { filterRestraint?: boolean; filterPublic?: boolean; filterIntimateBody?: boolean }
  /** 以前已經用過的體位與碰過的標籤（第一次另加體悟） */
  seen?: { positions?: string[]; tags?: string[] }
}

export const AP_MAX = 5
export const AP_REGEN = 3
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const other = (w: Who): Who => (w === 'me' ? 'them' : 'me')

export function rate(fit: number): { rating: Rating; relation: string; affinity: number; insight: number } {
  if (fit >= 85) return { rating: '難忘', relation: '大幅上升；可能讓一個標籤從「有」變成「深」', affinity: 10, insight: 20 }
  if (fit >= 60) return { rating: '合拍', relation: '上升', affinity: 5, insight: 15 }
  if (fit >= 30) return { rating: '普通', relation: '小幅上升', affinity: 2, insight: 10 }
  return { rating: '不合', relation: '不變或下降', affinity: -1, insight: 5 }
}
/** 開場的主動權（3.5 節第二點）：50 ＋（對方的馴化 − 自己的馴化）÷ 4，再照性質調整 */
export function openingInit(s: SceneSetup): number {
  return clamp(Math.round(50 + (s.them.tame - s.me.tame) / 4 + NATURE_INIT[s.nature]), 0, 100)
}

export class AdultScene {
  me: Actor
  them: Actor
  round = 1
  turn: Who = 'me'
  ap: Record<Who, number> = { me: AP_REGEN, them: AP_REGEN }
  pos: Position
  /** 契合 0～100 */
  fit = 20
  /** 主動權 0～100：50 以上在你手上 */
  init: number
  goal: number | null
  sync: SyncLevel = '標準'
  syncChanged = false
  links: Link[] = []
  lines: SceneLine[] = []
  end: SceneEnd | null = null
  /** 挑逗：下一個行動多 1 顆骰 */
  teased: Record<Who, boolean> = { me: false, them: false }
  /** 克制：這回合連接的自動效果對自己減半 */
  restrained: Record<Who, boolean> = { me: false, them: false }
  lube = 0
  items: Record<string, number> = { lube: 1, calm: 1 }
  usedPositions = new Set<string>()
  touchedTags = new Set<string>()
  private seq = 1

  constructor(public setup: SceneSetup, public rng: Rng, public opts: SceneOpts = {}) {
    this.me = structuredClone(setup.me)
    this.them = structuredClone(setup.them)
    this.pos = POSITIONS.find(p => p.id === setup.pos) ?? POSITIONS[0]
    this.usedPositions.add(this.pos.id)
    this.init = openingInit(setup)
    this.goal = setup.goal ? 0 : null
  }
  actor(w: Who) { return w === 'me' ? this.me : this.them }
  get explicit() { return this.opts.filters?.filterIntimateBody !== false }
  get myLead() { return this.init >= 50 }
  d(n: number, sides: number) { let s = 0; for (let i = 0; i < Math.abs(n); i++) s += 1 + Math.floor(this.rng() * sides); return s }
  say(who: Who, text: string) { this.lines.push({ round: this.round, who, text }) }

  // ---- 部位與連接 ----
  parts(w: Who): PartId[] { return [...BASE_PARTS, ...(this.actor(w).extraParts ?? [])] }
  /** 這個體位碰得到：[a 的部位, b 的部位] 在清單裡（兩個方向都算） */
  reaches(aPart: PartId, bPart: PartId): boolean { return this.pos.reach.some(([x, y]) => (x === aPart && y === bPart) || (x === bPart && y === aPart)) }
  linkAt(w: Who, part: PartId) { return this.links.find(l => (l.from === w && l.fromPart === part) || (l.to === w && l.toPart === part)) ?? null }
  /** 可以用的技能：內容篩選關掉的不出現；有標籤的要自己有那個標籤 */
  techniques(w: Who = 'me'): Technique[] {
    const f = this.opts.filters ?? {}
    return TECHNIQUES.filter(t => !(t.filter && f[t.filter] === false)).filter(t => !t.tag || this.actor(w).tags.includes(t.tag) || w === 'them')
  }
  /** 用 tech、自己的 fp、對方的 tp 建立連接：做不到的原因 */
  techReason(t: Technique, fp: PartId, tp: PartId, w: Who = 'me'): string | null {
    if (this.end) return '場景結束了。'
    if (this.ap[w] < t.ap) return `行動點不夠：要 ${t.ap}。`
    if (t.tag && !this.actor(w).tags.includes(t.tag)) return `要有「${t.tag}」的標籤（或對應的調校、道具、服裝）。`
    if (!this.parts(w).includes(fp)) return `你沒有「${fp}」這個部位。`
    if (!this.parts(other(w)).includes(tp)) return `${this.actor(other(w)).name}沒有「${tp}」這個部位。`
    if (!t.from.includes(fp) || !t.to.includes(tp)) return `「${t.name}」是用${t.from.join('、')}接${t.to.join('、')}。`
    if (!this.reaches(fp, tp)) return `${this.pos.name}碰不到：換一個體位。`
    return null
  }
  private addLink(l: Omit<Link, 'id'>) {
    // 一個部位同時只能有一條連接：兩端任一端被佔的那一條中斷（3.5 節第四點）
    this.links = this.links.filter(x => !(x.from === l.from && x.fromPart === l.fromPart) && !(x.to === l.from && x.toPart === l.fromPart)
      && !(x.from === l.to && x.fromPart === l.toPart) && !(x.to === l.to && x.toPart === l.toPart))
    for (const x of this.links) x.isNew = false
    this.links.push({ ...l, id: this.seq++, isNew: true })
  }

  // ---- 數字 ----
  /** 受到的感載＝原始值 ×（0.75 ＋ 敏感度 ÷ 200）× 體位的倍率 × 同步（只有你換檔）×（1 ＋ 0.1 × 造成的一方的餘韻） */
  hurt(target: Who, raw: number, src: Who) {
    if (raw <= 0 || this.end) return 0
    const a = this.actor(target)
    const n = Math.round(raw * (0.75 + a.sens / 200) * this.pos.mult[target] * (target === 'me' ? SYNC_MULT[this.sync] : 1) * (1 + 0.1 * this.actor(src).after))
    a.load += n
    while (!this.end && a.load >= a.loadMax) this.climax(target)
    return n
  }
  addFit(n: number, src: Who) {
    const v = n > 0 ? Math.round(n * (1 + 0.1 * this.actor(src).after)) : n
    this.fit = clamp(this.fit + v, 0, 100)
  }
  addInit(n: number) { this.init = clamp(this.init + n, 0, 100) }
  /** 過載就是高潮：感載歸零，疊一層餘韻，不失去回合；自己高潮主動權 −15，讓對方高潮 +10 */
  climax(w: Who) {
    const a = this.actor(w)
    a.load = 0
    if (a.after >= a.layers) { this.say(w, w === 'me' ? '你眼前一白，失神了。' : `${a.name}失神了。`); this.finish(w === 'me' ? '你失神了' : '對方失神了'); return }
    a.after++
    this.addInit(w === 'me' ? -15 : 10)
    this.say(w, w === 'me' ? `你到了（餘韻 ${a.after}／${a.layers}）。` : `${a.name}到了（餘韻 ${a.after}／${a.layers}）。`)
  }
  private spend(w: Who, n: number) { this.ap[w] -= n }
  private dice(w: Who, base: number) { const n = base + (this.teased[w] ? 1 : 0); this.teased[w] = false; return n }

  // ---- 行動（3.5 節第五點） ----
  linkedTo(w: Who) { return this.links.some(l => l.from === w || l.to === w) }
  reason(k: 'lead' | 'yield' | 'tease' | 'restrain' | 'talk' | 'switch' | 'item', w: Who = 'me'): string | null {
    if (this.end) return '場景結束了。'
    if (this.turn !== w) return '還沒輪到你。'
    const cost = { lead: 2, yield: 2, tease: 1, restrain: 1, talk: 1, switch: 1, item: 1 }[k]
    if (this.ap[w] < cost) return `行動點不夠：要 ${cost}。`
    if ((k === 'lead' || k === 'yield' || k === 'tease') && !this.linkedTo(w)) return '還沒有連接：先用技能或說話建立一條。'
    if (k === 'switch' && (w === 'me' ? !this.myLead : this.myLead)) return '主動權不在你手上：換不換由對方決定。'
    return null
  }
  lead(w: Who = 'me') {
    if (this.reason('lead', w)) return
    this.spend(w, 2)
    const o = other(w)
    const a = this.hurt(o, this.d(this.dice(w, 2), 6), w), b = this.hurt(w, this.d(1, 6), w)
    this.addFit(2, w); this.addInit(w === 'me' ? 10 : -10)
    this.say(w, w === 'me' ? `你帶著${this.them.name}的節奏（她 +${a}、你 +${b}）。` : `${this.them.name}壓著你的節奏走（你 +${a}、她 +${b}）。`)
  }
  yield(w: Who = 'me') {
    if (this.reason('yield', w)) return
    this.spend(w, 2)
    const o = other(w)
    const a = this.hurt(o, this.d(this.dice(w, 1), 6), w), b = this.hurt(w, this.d(2, 6), w)
    this.addFit(8, w); this.addInit(w === 'me' ? -10 : 10)
    this.say(w, w === 'me' ? `你順著${this.them.name}，迎上去（她 +${a}、你 +${b}）。` : `${this.them.name}順著你迎上來（你 +${a}、她 +${b}）。`)
  }
  tease(w: Who = 'me') {
    if (this.reason('tease', w)) return
    this.spend(w, 1)
    const a = this.hurt(other(w), this.d(this.dice(w, 1), 6), w), b = this.hurt(w, this.d(1, 6), w)
    this.addFit(4, w); this.addInit(w === 'me' ? 5 : -5)
    this.teased[w] = true
    this.say(w, w === 'me' ? `你故意停在半路，讓她等（她 +${a}、你 +${b}）。` : `${this.them.name}咬著嘴唇吊你的胃口（你 +${a}、她 +${b}）。`)
  }
  restrain(w: Who = 'me') {
    if (this.reason('restrain', w)) return
    this.spend(w, 1)
    const a = this.actor(w), n = Math.max(0, 2 + a.will)
    a.load = Math.max(0, a.load - n)
    this.restrained[w] = true
    this.say(w, w === 'me' ? `你深吸一口氣，把自己壓住（感載 −${n}）。` : `${this.them.name}閉上眼，慢下來。`)
  }
  technique(id: string, fp: PartId, tp: PartId, w: Who = 'me') {
    const t = TECHNIQUES.find(x => x.id === id)
    if (!t || this.turn !== w || this.techReason(t, fp, tp, w)) return
    this.spend(w, t.ap)
    const o = other(w)
    const a = this.hurt(o, this.d(this.dice(w, t.now.them), 3), w), b = this.hurt(w, this.d(t.now.me, 3), w)
    let fit = t.now.fit
    if (t.tag && this.actor(o).tags.includes(t.tag)) { fit += 12; this.touchedTags.add(t.tag) }
    this.addFit(fit, w)
    const label = `${t.verb}・${t.per.them ? `對方 +${t.per.them}d3` : ''}${t.per.me ? `${t.per.them ? '、' : ''}自己 +${t.per.me}d3` : ''}・契合 +${t.per.fit}`
    this.addLink({ from: w, fromPart: fp, to: o, toPart: tp, tech: t.id, label, per: t.per })
    const name = w === 'me' ? '你' : this.them.name, tn = w === 'me' ? this.them.name : '你'
    this.say(w, `${name}用${fp}${this.explicit ? t.verb : '碰著'}${tn}的${tp}（+${a}${b ? `、自己 +${b}` : ''}）。`)
  }
  /** 說話：AI 判定（關著時用骰子代替），契合 −5～+10；有目的時推進目的，一次最多 +20 */
  talk(text: string, part: PartId = '口', w: Who = 'me') {
    if (this.reason('talk', w)) return
    this.spend(w, 1)
    const fit = -5 + Math.floor(this.rng() * 16) + (this.fit >= 50 ? 2 : 0)
    this.addFit(Math.min(10, fit), w)
    let g = 0
    if (this.goal !== null && w === 'me') { g = Math.min(20, 5 + Math.floor(this.rng() * 11) + (this.fit >= 60 ? 5 : 0)); this.goal = clamp(this.goal + g, 0, 100) }
    this.addLink({ from: w, fromPart: part, to: other(w), toPart: '口', tech: 'talk', label: `說話・${text.slice(0, 14)}${g ? `・目的 +${g}` : ''}`, per: { them: 0, me: 0, fit: 0 } })
    this.say(w, `${w === 'me' ? '你' : this.them.name}：「${text}」（契合 ${fit >= 0 ? '+' : ''}${Math.min(10, fit)}${g ? `、目的 +${g}` : ''}）`)
  }
  useItem(id: string, w: Who = 'me') {
    const it = SCENE_ITEMS.find(x => x.id === id)
    if (!it || this.reason('item', w) || !this.items[id]) return
    this.spend(w, it.ap); this.items[id]--
    if (id === 'lube') { this.lube = 1; this.say(w, '你拿出潤滑凝膠：之後每條連接都更順。') }
    if (id === 'calm') { const n = this.d(1, 6); this.me.load = Math.max(0, this.me.load - n); this.addFit(-1, w); this.say(w, `你貼上冷靜貼片（感載 −${n}）。`) }
  }
  posReason(id: string, w: Who = 'me'): string | null {
    const r = this.reason('switch', w)
    if (r) return r
    const p = POSITIONS.find(x => x.id === id)
    if (!p) return '沒有這個體位。'
    if (p.id === this.pos.id) return '已經是這個體位了。'
    if (!this.actor(w).knows.includes(p.id)) return `還不會：要學「${p.lesson ?? p.name}」。`
    return null
  }
  /** 切換體位：要有主動權；所有連接重置 */
  switchPos(id: string, w: Who = 'me') {
    if (this.posReason(id, w)) return
    this.spend(w, 1)
    this.pos = POSITIONS.find(x => x.id === id)!
    this.usedPositions.add(id)
    if (this.pos.tag && this.actor(other(w)).tags.includes(this.pos.tag)) { this.addFit(4, w); this.touchedTags.add(this.pos.tag) }
    this.links = []
    this.say(w, `${w === 'me' ? '你' : this.them.name}換成${this.pos.name}。連接全部重來。`)
  }
  /** 換檔：每回合一次，不花行動點 */
  setSync(v: SyncLevel): string | null {
    if (this.syncChanged) return '這一回合換過檔了。'
    if (v === '全') return '「全」要敏感度 70。'
    this.sync = v; this.syncChanged = true
    return null
  }
  stop() { if (!this.end) this.finish('停下') }

  // ---- 回合 ----
  /** 你結束回合：對方行動，然後新的一回合（連接自動生效、消退、上位推主動權、檢查強制結束） */
  endTurn() {
    if (this.end || this.turn !== 'me') return
    this.turn = 'them'
    this.ap.them = Math.min(AP_MAX, this.ap.them + (this.round === 1 ? 0 : AP_REGEN))
    this.foeTurn()
    if (this.end) return
    this.turn = 'me'
    this.round++
    this.ap.me = Math.min(AP_MAX, this.ap.me + AP_REGEN)
    this.syncChanged = false
    this.tick()
    this.restrained = { me: false, them: false }
  }
  /** 新回合開始：每條連接自動生效一次；上位每回合 +3 主動權；自然消退；強制結束的檢查 */
  tick() {
    for (const l of [...this.links]) {
      if (this.end) return
      const half = (w: Who) => (this.restrained[w] ? 0.5 : 1)
      if (l.per.them) this.hurt(l.to, Math.round((this.d(l.per.them, 3) + this.lube) * half(l.to)), l.from)
      if (l.per.me) this.hurt(l.from, Math.round((this.d(l.per.me, 3) + this.lube) * half(l.from)), l.from)
      if (l.per.fit) this.addFit(l.per.fit, l.from)
      l.isNew = false
    }
    if (this.pos.top) this.addInit(this.pos.top === 'me' ? 3 : -3)
    for (const w of ['me', 'them'] as Who[]) { const a = this.actor(w); a.load = Math.max(0, a.load - Math.max(0, 2 + a.will)) }
    if (this.round > 3 && this.fit < 10) { this.say('them', `${this.them.name}把衣服拉好，說今天就到這裡。`); this.finish('對方不玩了') }
  }
  /** 對方：照性格（標籤）走；主動權在她手上時，可能換成她喜歡的體位 */
  foeTurn() {
    const t = this.them
    let guard = 0
    while (!this.end && this.ap.them > 0 && guard++ < 6) {
      if (!this.myLead && this.rng() < 0.5) {
        const pref = POSITIONS.find(p => p.id !== this.pos.id && t.knows.includes(p.id) && p.tag && t.tags.includes(p.tag))
        if (pref && !this.posReason(pref.id, 'them')) { this.switchPos(pref.id, 'them'); continue }
      }
      if (!this.linkedTo('them') || (this.links.filter(l => l.from === 'them').length === 0 && this.rng() < 0.6)) {
        const opts: Array<[Technique, PartId, PartId]> = []
        for (const tech of this.techniques('them')) for (const fp of tech.from) for (const tp of tech.to) if (!this.techReason(tech, fp, tp, 'them') && !this.linkAt('them', fp)) opts.push([tech, fp, tp])
        if (opts.length) { const [tech, fp, tp] = opts[Math.floor(this.rng() * opts.length)]; this.technique(tech.id, fp, tp, 'them'); continue }
      }
      const lead = t.tags.includes('御姐') || t.tags.includes('主導') ? this.rng() < 0.6 : this.rng() < 0.3
      if (this.ap.them >= 2 && this.linkedTo('them')) { if (lead) this.lead('them'); else this.yield('them'); continue }
      if (this.ap.them >= 1 && this.linkedTo('them')) { this.tease('them'); continue }
      break
    }
    this.ap.them = 0
  }

  // ---- 結束與結算（3.4 節；3.5 節第六點） ----
  finish(reason: SceneEnd['reason'], insightMult = 1) {
    const r = rate(this.fit)
    const notes: string[] = [`契合 ${this.fit}：${r.rating}，體悟 ${r.insight}`]
    let insight = r.insight
    if (this.setup.first) { insight += 5; notes.push('第一次和這個人 +5') }
    const seenP = this.opts.seen?.positions ?? [], seenT = this.opts.seen?.tags ?? []
    for (const p of this.usedPositions) if (!seenP.includes(p)) { insight += 5; notes.push(`第一次用「${POSITIONS.find(x => x.id === p)!.name}」+5`) }
    for (const tg of this.touchedTags) if (!seenT.includes(tg)) { insight += 5; notes.push(`第一次碰「${tg}」+5`) }
    if (insightMult !== 1) { insight = Math.round(insight * insightMult); notes.push('略過：打七折') }
    this.end = { reason, fit: this.fit, rating: r.rating, relation: r.relation, affinity: r.affinity, insight, insightNotes: notes, goal: this.goal, afterMe: this.me.after, lines: this.lines.length }
  }
  /** 略過（3.1 節）：照雙方的數值直接算出契合，體悟打七折 */
  skip() {
    const shared = this.me.tags.filter(x => this.them.tags.includes(x)).length
    this.fit = clamp(35 + shared * 15 + Math.round((this.them.sens - 50) / 2) + Math.floor(this.rng() * 21), 0, 100)
    if (this.goal !== null) this.goal = clamp(20 + Math.floor(this.fit / 2), 0, 100)
    this.say('me', '這一場略過了：寫成一段敘事，自動結算。')
    this.finish('略過', 0.7)
  }
}
