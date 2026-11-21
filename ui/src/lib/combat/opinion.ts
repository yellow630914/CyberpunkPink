import { d20, clamp, type Rng } from './rng'

/**
 * 輿論戰的戰役層（OPINION 第 3～5 節）。照 docs/mockups/opinion-demo.html 改寫成純邏輯，加上具名的對手：
 * 3 × 3 的棋盤（分數看議題）、聲量與風向、編輯點、牌（料、說法、手段）、佔領（相鄰、聲量 ≥ 防守）、六個時段、清空即結束。
 * 對手：一般的公關（強度 1～3）、萬華鏡（從中央開場、每回合降流）、緋櫻（前三回合只發稿，第四回合起連續追擊）、
 * 第一手的潔絲 `pr_jess`（強度 3、III 級、mimic：每回合隨機開放三到四種行動；第一回合先搶萬華鏡）。
 */
export const CELLS = ['同人圈', '帶子街', '應援圈', '緋櫻映畫', '萬華鏡', '夜鶯直播', '牆報', '街上的耳語', '地下轉播站'] as const
export const ROWS = ['圈子', '主流', '街頭'] as const
export const TIME_SLOTS = ['清晨', '上午', '中午', '下午', '黃金時段', '深夜'] as const
export const KALEIDO = 4

export interface Topic { id: string; n: string; s: number[]; kind: '引爆' | '滅火' }
export const TOPICS: Topic[] = [
  { id: 'scandal', n: '大眾議題：企業醜聞', s: [1, 1, 1, 2, 3, 1, 1, 1, 0], kind: '引爆' },
  { id: 'doujin', n: '小眾議題：同人社團的糾紛', s: [3, 1, 2, 0, 0, 2, 1, 1, 1], kind: '引爆' },
  { id: 'street', n: '街頭的事：幫派的地盤', s: [0, 2, 0, 1, 0, 0, 2, 3, 2], kind: '引爆' },
  { id: 'idol', n: '偶像的醜聞', s: [2, 1, 3, 1, 2, 2, 1, 0, 0], kind: '引爆' },
  { id: 'tape_leak', n: '滅火：流出的感官帶', s: [1, 3, 2, 1, 2, 2, 0, 1, 0], kind: '滅火' },
]

export interface Card { n: string; t: 1 | 2 | 3; c: number; d: string; v?: number; w?: number; ev?: number; risk?: number; back?: number; pick?: boolean }
/** 牌：1 料、2 說法、3 手段（OPINION 4.3 節） */
export const CARDS: Record<string, Card> = {
  clip: { n: '街頭影片', t: 1, c: 1, d: '聲量 +2', v: 2 },
  tape: { n: '感官帶', t: 1, c: 1, d: '聲量 +2', v: 2 },
  doc: { n: '內部文件', t: 1, c: 2, d: '聲量 +4', v: 4 },
  fake: { n: '假料', t: 1, c: 1, d: '聲量 +4。擲骰 6 以下被拆穿：風向 −2', v: 4, risk: 6, back: 2 },
  talk: { n: '當事人訪談', t: 2, c: 1, d: '風向 +1', w: 1 },
  fact: { n: '查證過的報導', t: 2, c: 2, d: '風向 +2', w: 2 },
  army: { n: '水軍', t: 3, c: 1, d: '聲量 +3。擲骰 5 以下被拆穿：風向 −1', v: 3, risk: 5, back: 1 },
  guard: { n: '設防', t: 3, c: 1, d: '你的一格到下回合前不能被搶', pick: true },
  mute: { n: '降流', t: 3, c: 1, d: '對手聲量 −2', ev: -2 },
  shift: { n: '轉移焦點', t: 3, c: 1, d: '雙方聲量各 −2', v: -2, ev: -2 },
}
export const CARD_KIND = { 1: '料', 2: '說法', 3: '手段' } as const
export const DECK = ['clip', 'clip', 'clip', 'tape', 'tape', 'doc', 'doc', 'fake', 'talk', 'talk', 'fact', 'fact', 'army', 'army', 'guard', 'guard', 'mute', 'shift']
/** 上下左右相鄰（斜的不算） */
export const adj = (i: number) => [i - 3, i + 3, i % 3 ? i - 1 : -1, i % 3 < 2 ? i + 1 : -1].filter(j => j >= 0 && j < 9)

export type FoeStyle = 'pr' | 'kaleido' | 'hizakura' | 'jess'
export interface Opponent { id: string; name: string; style: FoeStyle; st: 1 | 2 | 3; grade: number; note: string }
export const OPPONENTS: Opponent[] = [
  { id: 'pr_1', name: '小公司的公關', style: 'pr', st: 1, grade: 1, note: '強度 1，每回合 2 點公關點。' },
  { id: 'pr_2', name: '勢力的公關', style: 'pr', st: 2, grade: 2, note: '強度 2，每回合 4 點公關點。' },
  { id: 'pr_3', name: '老練的公關', style: 'pr', st: 3, grade: 2, note: '強度 3，每回合 6 點公關點；會寄律師函，可以追擊。' },
  { id: 'pr_kaleido', name: '萬華鏡的公關', style: 'kaleido', st: 2, grade: 2, note: '守主流那一排，每回合降流。它固定從正中央的萬華鏡開場。' },
  { id: 'pr_hizakura', name: '緋櫻重工的公關', style: 'hizakura', st: 3, grade: 2, note: '前三回合只發稿存聲量，第四回合起連續追擊；反爆料只花 1 點。' },
  { id: 'pr_jess', name: '第一手的潔絲', style: 'jess', st: 3, grade: 3, note: '另一個主播（mimic）：每回合隨機開放三到四種行動；第一回合先搶萬華鏡。III 級：發稿 +3。' },
]

export type Owner = 0 | 1 | 2
export interface OpinionSetup { topic: string; foe: string; rounds?: number; /** 難度：對手每回合的公關點加減（最少 1） */ pr?: number }
export interface OpLine { t: string; c?: 'h' | 'r' | 'g' }
export interface OpinionEnd { result: '大勝' | '小勝' | '平手' | '敗'; a: number; b: number; text: string }
/** 潔絲的行動表（比一般的公關長，多了玩家這邊的料、說法、手段） */
const JESS_POOL = ['publish', 'deny', 'mute', 'leak', 'lawyer', 'takedown', 'chase', 'fakeclip'] as const
const JESS_NAMES: Record<string, string> = { publish: '發稿', deny: '否認', mute: '降流', leak: '反爆料', lawyer: '律師函', takedown: '下架', chase: '追擊', fakeclip: '剪片爆料' }

export class OpinionWar {
  topic: Topic
  foe: Opponent
  own: Owner[] = Array(9).fill(0)
  /** 設防的格子：到下回合前不能被搶 */
  sh: boolean[] = Array(9).fill(false)
  round = 1
  rounds: number
  va = 2
  vb = 2
  w = 0
  ap = 4
  apMax = 4
  deck: string[]
  discard: string[] = []
  hand: string[] = []
  caps = 1
  s1 = false
  s2 = false
  /** 正在選格子：佔領，或設防（手上第幾張） */
  mode: { k: 'cap' } | { k: 'guard'; idx: number } | null = null
  lines: OpLine[] = []
  end: OpinionEnd | null = null
  /** 律師函：下回合編輯點 −1 */
  cut = 0
  /** 這一回合你剛搶下一格（潔絲會反爆料） */
  justCap = false
  // 對手這一回合的狀態
  pts = 0
  capsLeft = 0
  didCap = false
  muted = false
  cutUsed = false
  open: string[] = []
  foeActs = 0
  prDelta: number

  constructor(setup: OpinionSetup, public rng: Rng) {
    this.prDelta = setup.pr ?? 0
    this.topic = TOPICS.find(t => t.id === setup.topic) ?? TOPICS[0]
    this.foe = OPPONENTS.find(o => o.id === setup.foe) ?? OPPONENTS[1]
    this.rounds = setup.rounds ?? 6
    this.deck = DECK.slice()
    for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]] }
    if (this.topic.kind === '滅火') {
      // 你是公關：佔著主流那一排的兩格，對手從街頭的一格打上來
      this.own[3] = 1; this.own[5] = 1; this.own[6 + Math.floor(rng() * 3)] = 2
    } else {
      const st = 6 + Math.floor(rng() * 3)
      this.own[st] = 1
      this.own[this.foe.style === 'kaleido' ? KALEIDO : 8 - st] = 2
    }
    this.log(`議題：${this.topic.n}。對手：${this.foe.name}（強度 ${this.foe.st}，每回合 ${this.foe.st * 2} 點公關點）。`, 'h')
    this.draw(3)
    this.startRound()
  }
  log(t: string, c?: OpLine['c']) { this.lines.push({ t, c }) }
  draw(n: number) {
    for (let i = 0; i < n && this.hand.length < 5; i++) {
      if (!this.deck.length && this.discard.length) { this.deck = this.discard.splice(0); for (let k = this.deck.length - 1; k > 0; k--) { const j = Math.floor(this.rng() * (k + 1)); [this.deck[k], this.deck[j]] = [this.deck[j], this.deck[k]] } this.log('牌庫抽完了：棄牌洗回去。') }
      if (!this.deck.length) break
      this.hand.push(this.deck.pop()!)
    }
  }
  /** 回合開始：編輯點補滿（律師函扣 1）、抽 2 張 */
  startRound() {
    this.ap = Math.max(0, this.apMax - this.cut)
    if (this.cut) this.log(`律師函：這回合編輯點 −${this.cut}。`, 'r')
    this.cut = 0; this.caps = 1; this.s1 = this.s2 = false; this.mode = null; this.justCap = false
    this.draw(2)
    this.log(`—— 第 ${this.round} 回合・${TIME_SLOTS[this.round - 1]} ——`, 'h')
  }
  /** 防守：沒人的 2；搶對手的格子 3 − 風向（最少 1）；對手搶你的 3 ＋ 風向 */
  def(i: number, who: 1 | 2) { return this.own[i] === 0 ? 2 : Math.max(1, who === 1 ? 3 - this.w : 3 + this.w) }
  canCap(i: number, who: 1 | 2) {
    if (this.own[i] === who) return false
    if (who === 2 && this.sh[i]) return false
    if (!adj(i).some(j => this.own[j] === who)) return false
    return (who === 1 ? this.va : this.vb) >= this.def(i, who)
  }
  score(who: 1 | 2) { return this.own.reduce<number>((a, o, i) => a + (o === who ? this.topic.s[i] : 0), 0) }
  /** 料牌的聲量照戰役的等級加：III、IV 級 +1（OPINION 4.3 節） */
  cardV(c: Card) { return c.v && c.v > 0 && c.t === 1 && this.foe.grade >= 3 ? c.v + 1 : c.v ?? 0 }
  cardReason(idx: number): string | null {
    if (this.end) return '戰役已經結束'
    const k = this.hand[idx]
    if (!k) return '沒有這張牌'
    if (this.ap < CARDS[k].c) return '編輯點不夠'
    if (CARDS[k].pick && !this.own.some((o, i) => o === 1 && !this.sh[i])) return '沒有可以設防的格子'
    return null
  }
  play(idx: number): boolean {
    if (this.cardReason(idx)) return false
    const k = this.hand[idx], c = CARDS[k]
    if (c.pick) { this.mode = this.mode && this.mode.k === 'guard' && this.mode.idx === idx ? null : { k: 'guard', idx }; return true }
    this.ap -= c.c
    this.hand.splice(idx, 1)
    this.discard.push(k)
    this.mode = null
    let m = `你打出「${c.n}」：`
    const v = this.cardV(c)
    if (v) { this.va = clamp(this.va + v, 0, 10); m += `聲量 ${v > 0 ? '+' : ''}${v}。` }
    if (c.w) { this.w = clamp(this.w + c.w, -5, 5); m += `風向 +${c.w}。` }
    if (c.ev) { this.vb = clamp(this.vb + c.ev, 0, 10); m += `對手聲量 ${c.ev}。` }
    this.log(m, 'g')
    if (c.risk) {
      const r = d20(this.rng)
      if (r <= c.risk) { this.w = clamp(this.w - (c.back ?? 0), -5, 5); this.log(`被拆穿了（擲出 ${r}）：風向 −${c.back}。`, 'r') }
      else this.log(`沒被拆穿（擲出 ${r}）。`)
    }
    return true
  }
  skillReason(k: 's1' | 's2'): string | null {
    if (this.end) return '戰役已經結束'
    if (this[k]) return '這一回合已經用過'
    if (this.ap < (k === 's1' ? 1 : 2)) return '編輯點不夠'
    return null
  }
  /** 帶風向（1 點，風向 +1）；追擊（2 點，這回合多佔一格） */
  skill(k: 's1' | 's2'): boolean {
    if (this.skillReason(k)) return false
    if (k === 's1') { this.ap--; this.s1 = true; this.w = clamp(this.w + 1, -5, 5); this.log('你帶風向：風向 +1。', 'g') }
    else { this.ap -= 2; this.s2 = true; this.caps++; this.log('你追擊：這回合可以多佔一格。', 'g') }
    return true
  }
  capReason(): string | null {
    if (this.end) return '戰役已經結束'
    if (this.caps < 1) return '這一回合已經佔過了'
    if (![...Array(9).keys()].some(i => this.canCap(i, 1))) return '沒有相鄰、而且聲量夠的格子'
    return null
  }
  toggleCap(): boolean { if (this.capReason()) return false; this.mode = this.mode?.k === 'cap' ? null : { k: 'cap' }; return true }
  /** 正在選格子時可以選的格子 */
  targets(): number[] {
    if (!this.mode || this.end) return []
    if (this.mode.k === 'cap') return [...Array(9).keys()].filter(i => this.canCap(i, 1))
    return [...Array(9).keys()].filter(i => this.own[i] === 1 && !this.sh[i])
  }
  pickCell(i: number): boolean {
    if (!this.mode || !this.targets().includes(i)) return false
    if (this.mode.k === 'cap') return this.capture(i)
    const idx = this.mode.idx
    this.ap -= CARDS.guard.c
    this.discard.push(...this.hand.splice(idx, 1))
    this.sh[i] = true
    this.mode = null
    this.log(`你替「${CELLS[i]}」設防：到下回合前不能被搶。`, 'g')
    return true
  }
  capture(i: number): boolean {
    if (!this.canCap(i, 1) || this.caps < 1) return false
    const d = this.def(i, 1), was = this.own[i]
    this.va -= d; this.own[i] = 1; this.caps--; this.mode = null; this.justCap = true
    this.log(`你${was ? '從對手手上搶下' : '佔領'}「${CELLS[i]}」（花聲量 ${d}，${this.topic.s[i]} 分）。`, 'g')
    if (!this.own.includes(2)) this.finish(1)
    return true
  }

  // ---- 對手的回合 ----
  /** 結束你的回合，對手開始（之後畫面一步一步呼叫 foeStep） */
  endTurn() {
    if (this.end) return
    this.mode = null
    this.pts = Math.max(1, this.foe.st * 2 + this.prDelta)
    this.capsLeft = 1
    this.didCap = false
    this.foeActs = 0
    if (this.foe.style === 'jess') {
      const pool = JESS_POOL.slice()
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
      this.open = pool.slice(0, 3 + Math.floor(this.rng() * 2))
      if (!this.open.includes('publish') && this.rng() < 0.5) this.open[0] = 'publish'
      this.log(`潔絲這回合開放：${this.open.map(k => JESS_NAMES[k]).join('、')}。`)
    } else this.open = []
  }
  foeTargets() {
    const row = (i: number) => Math.floor(i / 3)
    const weight = (i: number) => this.topic.s[i] * (this.own[i] === 1 ? 2 : 1) + (this.foe.style === 'kaleido' && row(i) === 1 ? 3 : 0)
    return [...Array(9).keys()].filter(i => this.own[i] !== 2 && !this.sh[i] && adj(i).some(j => this.own[j] === 2)).sort((a, b) => weight(b) - weight(a) || a - b)
  }
  private foeCap(prefer?: number): boolean {
    const list = this.foeTargets().filter(i => this.vb >= this.def(i, 2))
    const c = prefer != null && list.includes(prefer) ? prefer : list[0]
    if (c == null) return false
    const d = this.def(c, 2), was = this.own[c]
    this.vb -= d; this.own[c] = 2
    this.log(`對手${was ? '搶走你的' : '佔領'}「${CELLS[c]}」（${this.topic.s[c]} 分）。`, 'r')
    return true
  }
  private publish() { const n = this.foe.grade >= 3 ? 3 : 2; this.pts--; this.vb = clamp(this.vb + n, 0, 10); this.log(`對手發稿：聲量 +${n}。`, 'r') }
  /** 對手做一個動作；這一回合做完了回傳 false（畫面接著開你的下一回合，或結算） */
  foeStep(): boolean {
    if (this.end) return false
    if (this.foeActs++ > 20) return this.closeRound()
    const st = this.foe.st, style = this.foe.style
    const targets = this.foeTargets(), t = targets[0], need = t == null ? 99 : this.def(t, 2)
    // ---- 潔絲：mimic ----
    if (style === 'jess') {
      if (this.round === 1 && this.own[KALEIDO] !== 2 && !this.didCap && this.vb >= this.def(KALEIDO, 2)) {
        // 招牌「推薦位」：第一回合的第一個行動一定是搶萬華鏡，不看相鄰
        const was = this.own[KALEIDO]; this.vb -= this.def(KALEIDO, 2); this.own[KALEIDO] = 2; this.didCap = true; this.capsLeft = 0
        this.log(`潔絲用推薦位${was ? '搶走你的' : '佔領'}「萬華鏡」。`, 'r')
        if (!this.own.includes(1)) { this.finish(2); return false }
        return true
      }
      const has = (k: string) => this.open.includes(k)
      if (this.justCap && has('leak') && this.pts >= 2 && this.w > -5) { this.pts -= 2; this.justCap = false; this.w = clamp(this.w - 2, -5, 5); this.log('潔絲反爆料：風向往她那邊 2。', 'r'); return true }
      if (this.w >= 2 && has('deny') && this.pts >= 1) { this.pts--; this.w = clamp(this.w - 1, -5, 5); this.log('潔絲否認：風向往她那邊 1。', 'r'); return true }
      if (has('mute') && this.pts >= 1 && this.va >= 4 && !this.muted) { this.pts--; this.muted = true; this.va = clamp(this.va - 2, 0, 10); this.log('潔絲降流：你的聲量 −2。', 'r'); return true }
      if (has('takedown') && this.pts >= 2 && this.hand.length >= 3) { this.pts -= 2; const i = Math.floor(this.rng() * this.hand.length); const k = this.hand.splice(i, 1)[0]; this.discard.push(k); this.log(`潔絲檢舉下架：你丟掉一張「${CARDS[k].n}」。`, 'r'); return true }
      if (has('lawyer') && this.pts >= 2 && !this.cutUsed && this.round < this.rounds) { this.pts -= 2; this.cutUsed = true; this.cut = 1; this.log('潔絲寄律師函：你下回合的編輯點 −1。', 'r'); return true }
      if (has('fakeclip') && this.pts >= 1 && this.vb < need && this.vb < 10) { this.pts--; this.vb = clamp(this.vb + 4, 0, 10); this.log('潔絲剪了一支爆料片：聲量 +4。', 'r'); if (d20(this.rng) <= 6) { this.w = clamp(this.w + 2, -5, 5); this.log('她的片被拆穿了：風向往你這邊 2。', 'g') } return true }
      if (has('publish') && this.pts >= 1 && this.vb < need && this.vb < 10) { this.publish(); return true }
      if (this.capsLeft > 0) {
        this.capsLeft--
        const got = this.foeCap(this.own[KALEIDO] !== 2 ? KALEIDO : undefined)
        if (!got && !this.didCap) this.log('潔絲這回合搶不到格子。')
        this.didCap = true
        if (!this.own.includes(1)) { this.finish(2); return false }
        if (has('chase') && this.pts >= 2 && this.foeTargets().some(i => this.vb >= this.def(i, 2))) { this.pts -= 2; this.capsLeft++; this.log('潔絲追擊。', 'r') }
        return true
      }
      if (this.pts > 0 && has('publish') && this.vb < 10) { this.publish(); return true }
      return this.closeRound()
    }
    // ---- 一般的公關、萬華鏡、緋櫻（照 Demo 的順序） ----
    const keep = st >= 2 && targets.length > 1 ? 2 : 0
    const hzHold = style === 'hizakura' && this.round <= 3
    const chaseCan = st >= 3 && (style !== 'hizakura' || this.round >= 4)
    const leakCost = style === 'hizakura' ? 1 : 2
    if (hzHold) {
      // 緋櫻：前三回合只發稿，存聲量
      if (this.pts > 0 && this.vb < 10) { this.publish(); return true }
      return this.closeRound()
    }
    if (this.pts > keep && !this.muted && (style === 'kaleido' ? this.va >= 2 : this.va >= 5)) { this.pts--; this.muted = true; this.va = clamp(this.va - 2, 0, 10); this.log('對手降流：你的聲量 −2。', 'r'); return true }
    if (this.pts > keep && this.vb < need && this.vb < 10) { this.publish(); return true }
    if (this.pts >= keep + 2 && st === 3 && !this.cutUsed && this.round < this.rounds && style === 'pr') { this.pts -= 2; this.cutUsed = true; this.cut = 1; this.log('對手寄律師函：你下回合的編輯點 −1。', 'r'); return true }
    if (this.pts >= keep + leakCost && this.w > 0) { this.pts -= leakCost; this.w = clamp(this.w - 2, -5, 5); this.log('對手反爆料：風向往它那邊 2。', 'r'); return true }
    if (this.pts > keep && this.w > -3) { this.pts--; this.w = clamp(this.w - 1, -5, 5); this.log('對手否認：風向往它那邊 1。', 'r'); return true }
    if (this.capsLeft > 0) {
      this.capsLeft--
      if (!this.foeCap() && !this.didCap) this.log('對手這回合搶不到格子。')
      this.didCap = true
      if (!this.own.includes(1)) { this.finish(2); return false }
      if (this.pts >= 2 && chaseCan && this.foeTargets().some(i => this.vb >= this.def(i, 2))) { this.pts -= 2; this.capsLeft++; this.log('對手追擊。', 'r') }
      else if (this.pts > 0 && this.vb < 10) { this.vb = clamp(this.vb + 2 * this.pts, 0, 10); this.log(`對手把剩下的 ${this.pts} 點拿去發稿。`, 'r'); this.pts = 0 }
      return true
    }
    return this.closeRound()
  }
  /** 對手的回合結束：設防失效；第六回合結束就結算，不然開下一回合 */
  private closeRound(): boolean {
    this.sh.fill(false)
    this.muted = false
    if (this.foe.style !== 'jess') this.cutUsed = false
    if (this.round >= this.rounds) { this.finish(); return false }
    this.round++
    this.startRound()
    return false
  }
  finish(wipe?: 1 | 2) {
    if (this.end) return
    const a = this.score(1), b = this.score(2)
    if (wipe) {
      this.end = wipe === 1
        ? { result: '大勝', a, b, text: `大勝：對手的格子被清空，戰役提前結束（${a} 分對 ${b} 分）。` }
        : { result: '敗', a, b, text: '敗：你的格子被清空，戰役提前結束。這件事被壓下去了。' }
      this.log(wipe === 1 ? '對手被清空。' : '你被清空。', 'h')
      return
    }
    const result = a > b ? (a - b >= 4 ? '大勝' : '小勝') : a < b ? '敗' : '平手'
    const tail = result === '大勝' ? '大勝：在正式的遊戲裡，目標勢力的名聲會重挫。' : result === '小勝' ? '小勝：事情傳開了，但對方還撐得住。' : result === '敗' ? '這件事被壓下去了。' : '各說各話。'
    this.end = { result, a, b, text: `${a > b ? '你贏了' : a < b ? '對手贏了' : '平手'}：${a} 分對 ${b} 分。${tail}` }
    this.log(`結算：${a} 對 ${b}。`, 'h')
  }
}
