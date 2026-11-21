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

export interface Topic { id: string; n: string; s: number[]; kind: '引爆' | '滅火'; /** 牽涉的勢力與人、類型（4.3a 節：片要和議題有關才進得去） */ who: string[]; types: string[] }
export const TOPICS: Topic[] = [
  { id: 'scandal', n: '大眾議題：企業醜聞', s: [1, 1, 1, 2, 3, 1, 1, 1, 0], kind: '引爆', who: ['藍鯨物流', '緋櫻系的晶片', '緋櫻'], types: ['醜聞', '罪證'] },
  { id: 'doujin', n: '小眾議題：同人社團的糾紛', s: [3, 1, 2, 0, 0, 2, 1, 1, 1], kind: '引爆', who: [], types: ['日常'] },
  { id: 'street', n: '街頭的事：幫派的地盤', s: [0, 2, 0, 1, 0, 0, 2, 3, 2], kind: '引爆', who: ['野良', '孤星連', '鉻娘子'], types: ['戰鬥', '罪證'] },
  { id: 'idol', n: '偶像的醜聞', s: [2, 1, 3, 1, 2, 2, 1, 0, 0], kind: '引爆', who: ['緋櫻'], types: ['名人', '醜聞', '親密'] },
  { id: 'tape_leak', n: '滅火：流出的感官帶', s: [1, 3, 2, 1, 2, 2, 0, 1, 0], kind: '滅火', who: [], types: ['親密'] },
]

export interface Card { n: string; t: 1 | 2 | 3; c: number; d: string; v?: number; w?: number; ev?: number; risk?: number; back?: number; pick?: boolean; clip?: boolean }
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

export type FoeStyle = 'pr' | 'kaleido' | 'hizakura' | 'jess' | 'starbelle' | 'kunlun' | 'nightingale'
export interface Opponent {
  id: string; name: string; style: FoeStyle; st: 1 | 2 | 3; grade: number; note: string
  /** 收買（5.2 節，每場一次、不花點）：它落後幾分時開價；價錢；伊甸園可以兩次 */
  bribeAt?: number; bribe?: number; bribeTimes?: number
  /** 找上門（5.2 節、第 6 節）：它落後幾分、第幾回合起；擋不住時主播被抓（capture）或你下一回合不能行動（skip） */
  visitAt?: number; visitFrom?: number; visitFail?: 'capture' | 'skip'; visitWho?: string
  /** 招牌招式的一句話（ENEMY_ROSTER 第六節） */
  sig?: string
}
export const OPPONENTS: Opponent[] = [
  { id: 'pr_1', name: '小公司的公關', style: 'pr', st: 1, grade: 1, note: '強度 1，每回合 2 點公關點。' },
  { id: 'pr_2', name: '勢力的公關', style: 'pr', st: 2, grade: 2, note: '強度 2，每回合 4 點公關點。', bribeAt: 3, bribe: 1500 },
  { id: 'pr_3', name: '老練的公關', style: 'pr', st: 3, grade: 2, note: '強度 3，每回合 6 點公關點；會寄律師函，可以追擊。', bribeAt: 3, bribe: 2000, visitAt: 4, visitFrom: 3, visitFail: 'skip', visitWho: '一隊打手' },
  { id: 'pr_kaleido', name: '萬華鏡的公關', style: 'kaleido', st: 2, grade: 2, note: '守主流那一排，每回合降流。它固定從正中央的萬華鏡開場。' },
  { id: 'pr_hizakura', name: '緋櫻重工的公關', style: 'hizakura', st: 3, grade: 2, note: '前三回合只發稿存聲量，第四回合起連續追擊；反爆料只花 1 點。', sig: '反爆料只花 1 點公關點', bribeAt: 3, bribe: 3000, visitAt: 4, visitFrom: 4, visitFail: 'skip', visitWho: '家政課' },
  { id: 'pr_starbelle', name: '星旗防務的公關', style: 'starbelle', st: 3, grade: 2, note: '第一回合就寄律師函；你出了說法牌，下一回合再寄；落後 2 分就找上門。', sig: '律師函讓你下回合的編輯點 −2', visitAt: 2, visitFrom: 2, visitFail: 'capture', visitWho: '一隊傭兵' },
  { id: 'pr_kunlun', name: '崑崙智造的公關', style: 'kunlun', st: 2, grade: 2, note: '你手上三張以上就下架；你的聲量 4 以上就降流。', sig: '下架不是隨機的：挑走你手上數字最高的那一張料', bribeAt: 3, bribe: 2500, visitAt: 5, visitFrom: 2, visitFail: 'skip', visitWho: '劍靈使' },
  { id: 'pr_nightingale', name: '夜鶯系統的公關', style: 'nightingale', st: 2, grade: 2, note: '你的聲量 3 以上就降流；手牌超過三張就下架；會追擊地下轉播站。', sig: '它佔著夜鶯直播時，你搶那一格的防守 +1', visitAt: 4, visitFrom: 2, visitFail: 'skip', visitWho: '值班潛網者' },
  { id: 'pr_jess', name: '第一手的潔絲', style: 'jess', st: 3, grade: 3, note: '另一個主播（mimic）：每回合隨機開放三到四種行動；第一回合先搶萬華鏡。III 級：發稿 +3。' },
]

export type Owner = 0 | 1 | 2
export interface OpinionSetup {
  topic: string; foe: string; rounds?: number
  /** 難度：對手每回合的公關點加減（最少 1） */
  pr?: number
  /** 你每回合的編輯點（OPINION 4.3b 節；用 editPoints() 算）。沒給就是任何人的 2 */
  edit?: number
  /** 主角在各區豔名裡最高的那一個（OPINION 4.3c 節）：每 30 點一級，最多 2 級 */
  fame?: number
  /** 第四版：城市事件（5.3 節，每回合翻一張）；關掉給測試用 */
  events?: boolean
  /** 剪好的片（4.3a 節：一支片變成一張牌） */
  clips?: ClipInput[]
  /** 找上門時留守的隊友：擋人的檢定加值 */
  guard?: number
  /** 編輯台在直播：擋住了找上門，整個過程變成一張最好的料 */
  live?: boolean
  /** 委託前面的階段換成的開場（4.5 節）：開場聲量、開場佔的格子、多一張「內幕」 */
  start?: { va?: number; cells?: number[]; inside?: boolean }
}
/** 一支剪好的片：角度、看點、可信，拍到的勢力與人、類型 */
export interface ClipInput { id: string; name: string; angle: '揭弊' | '英雄' | '煽情' | '抹黑'; looks: number; cred: number; who: string[]; types: string[] }
/**
 * 片怎麼變成牌（OPINION 4.3a 節）：揭弊與英雄是說法（風向，數字用可信），煽情與抹黑是料（聲量，數字用看點）；
 * 拍到當事人或目標勢力是全額、只有類型相同減半、完全無關只能當轉移焦點的燃料。
 */
export function clipCard(c: ClipInput, t: Topic): Card & { rel: '全額' | '減半' | '無關' } {
  const rel = c.who.some(w => t.who.includes(w)) ? '全額' : c.types.some(x => t.types.includes(x)) ? '減半' : '無關'
  if (rel === '無關') return { n: `片：${c.name}`, t: 3, c: 1, d: '和議題無關：只能當轉移焦點。雙方聲量各 −2', v: -2, ev: -2, rel, clip: true }
  const half = (n: number) => (rel === '減半' ? Math.ceil(n / 2) : n)
  if (c.angle === '揭弊' || c.angle === '英雄') { const w = Math.max(1, Math.min(2, half(Math.round(c.cred / 2)))); return { n: `片：${c.name}`, t: 2, c: w, d: `${c.angle}・風向 +${w}${rel === '減半' ? '（減半）' : ''}`, w, rel, clip: true } }
  const v = Math.max(1, Math.min(4, half(c.looks)))
  return { n: `片：${c.name}`, t: 1, c: v >= 3 ? 2 : 1, d: `${c.angle}・聲量 +${v}${rel === '減半' ? '（減半）' : ''}`, v, rel, clip: true }
}
/** 城市事件（OPINION 5.3 節）：每回合開始翻一張，只影響這一回合（偶像的畢業公演影響整場） */
export interface CityEvent { id: string; n: string; d: string }
export const CITY_EVENTS: CityEvent[] = [
  { id: 'scandal2', n: '另一樁醜聞爆出來', d: '雙方聲量各 −2。' },
  { id: 'festival', n: '祭典組封街', d: '街頭那一排的防守這回合 +1。' },
  { id: 'algo', n: '萬華鏡換了演算法', d: '萬華鏡這回合不能被佔。' },
  { id: 'idolgrad', n: '偶像的畢業公演', d: '應援圈的分數這一場 +1。' },
  { id: 'blackout', n: '停電', d: '主流那一排這回合不能被佔。' },
  { id: 'quiet', n: '平靜的一個時段', d: '沒有別的事。' },
]
/**
 * 每回合的編輯點（OPINION 4.3b 節，唯一的來源）：任何人 2；主播、偶像加那棵樹的階數的一半（進位），
 * 名媛、掮客加一半（捨去）；編制有製作 +1。好幾條路數取最高的那一條。
 */
export function editPoints(trees: string[], production = false): number {
  let best = 0
  for (const t of trees) {
    const m = /^(\S+)\s+(\d+)$/.exec(t.trim())
    if (!m) continue
    const tier = Number(m[2])
    const add = m[1] === '主播' || m[1] === '偶像' ? Math.ceil(tier / 2) : m[1] === '名媛' || m[1] === '掮客' ? Math.floor(tier / 2) : 0
    best = Math.max(best, add)
  }
  return 2 + best + (production ? 1 : 0)
}
/** 豔名的級數（OPINION 4.3c 節）：每 30 點一級，最多 2 級 */
export const fameLevel = (fame: number) => Math.min(2, Math.floor(Math.max(0, fame) / 30))
/** 看臉的三格：帶子街、應援圈、夜鶯直播 */
export const FACE_CELLS = [1, 2, 5]
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
  ap = 2
  apMax = 2
  /** 豔名的級數：你去佔看臉的三格時防守 −1／級 */
  fameLv = 0
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
  // ---- 第四版 ----
  /** 這一場額外的牌（片、找上門的直播） */
  extra: Record<string, Card> = {}
  event: CityEvent | null = null
  locked: number[] = []
  defPlus: number[] = Array(9).fill(0)
  bonus: number[] = Array(9).fill(0)
  /** 收買：對手開的價（等你決定）；還能開幾次 */
  offer: { price: number } | null = null
  bribeLeft = 0
  bribed = 0
  visited = false
  skipNext = false
  captured = false
  /** 你上一回合出過說法牌（星旗會再寄律師函） */
  playedClaim = false
  claimLast = false
  useEvents: boolean
  guard: number
  live: boolean

  constructor(setup: OpinionSetup, public rng: Rng) {
    this.prDelta = setup.pr ?? 0
    this.apMax = this.ap = setup.edit ?? 2
    this.fameLv = fameLevel(setup.fame ?? 0)
    this.useEvents = setup.events !== false
    this.guard = setup.guard ?? 4
    this.live = !!setup.live
    this.topic = TOPICS.find(t => t.id === setup.topic) ?? TOPICS[0]
    this.foe = OPPONENTS.find(o => o.id === setup.foe) ?? OPPONENTS[1]
    this.rounds = setup.rounds ?? 6
    this.deck = DECK.slice()
    this.bribeLeft = this.foe.bribeTimes ?? (this.foe.bribeAt != null ? 1 : 0)
    // 片進牌庫（4.3a 節）：一支片一張牌
    for (const c of setup.clips ?? []) { const k = `clip:${c.id}`; this.extra[k] = clipCard(c, this.topic); this.deck.push(k) }
    for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]] }
    if (this.topic.kind === '滅火') {
      // 你是公關：佔著主流那一排的兩格，對手從街頭的一格打上來
      this.own[3] = 1; this.own[5] = 1; this.own[6 + Math.floor(rng() * 3)] = 2
    } else {
      const st = 6 + Math.floor(rng() * 3)
      this.own[st] = 1
      this.own[this.foe.style === 'kaleido' ? KALEIDO : 8 - st] = 2
    }
    if (setup.start) {
      const st0 = setup.start
      if (st0.va) { this.va = clamp(this.va + st0.va, 0, 10); this.log(`前面的階段：開場聲量 +${st0.va}。`, 'g') }
      for (const c of st0.cells ?? []) if (this.own[c] === 0) { this.own[c] = 1; this.log(`前面的階段：開場就佔著「${CELLS[c]}」。`, 'g') }
      if (st0.inside) { this.extra['inside'] = { n: '內幕', t: 1, c: 1, d: '聲量 +4；對手不能下架', v: 4 }; this.deck.push('inside'); this.log('前面的階段：牌庫多一張「內幕」。', 'g') }
    }
    this.log(`議題：${this.topic.n}。對手：${this.foe.name}（強度 ${this.foe.st}，每回合 ${this.foe.st * 2} 點公關點）。`, 'h')
    this.draw(3)
    this.startRound()
  }
  log(t: string, c?: OpLine['c']) { this.lines.push({ t, c }) }
  card(k: string): Card { return this.extra[k] ?? CARDS[k] }
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
    this.claimLast = this.playedClaim; this.playedClaim = false
    this.draw(2)
    this.log(`—— 第 ${this.round} 回合・${TIME_SLOTS[this.round - 1]} ——`, 'h')
    if (this.skipNext) { this.skipNext = false; this.ap = 0; this.caps = 0; this.log('找上門的人還在編輯台：你這一回合不能行動。', 'r') }
    this.flipEvent()
  }
  /** 城市事件（5.3 節）：每回合翻一張 */
  flipEvent() {
    this.locked = []; this.defPlus = Array(9).fill(0); this.event = null
    if (!this.useEvents) return
    const e = CITY_EVENTS[Math.floor(this.rng() * CITY_EVENTS.length)]
    this.event = e
    if (e.id === 'scandal2') { this.va = clamp(this.va - 2, 0, 10); this.vb = clamp(this.vb - 2, 0, 10) }
    if (e.id === 'festival') [6, 7, 8].forEach(i => { this.defPlus[i] = 1 })
    if (e.id === 'algo') this.locked = [KALEIDO]
    if (e.id === 'blackout') this.locked = [3, 4, 5]
    if (e.id === 'idolgrad' && !this.bonus[2]) this.bonus[2] = 1
    this.log(`城市事件：${e.n}。${e.d}`, 'h')
  }
  /** 收買：接受就拿錢、戰役算敗、公信力掉（5.2 節）；拒絕照打 */
  acceptBribe() {
    if (!this.offer || this.end) return
    this.bribed = this.offer.price
    this.offer = null
    this.end = { result: '敗', a: this.score(1), b: this.score(2), text: `你收下了 C$${this.bribed.toLocaleString('en-US')}：戰役算敗，公信力掉了。這件事被壓下去了。` }
    this.log(`你收下了${this.foe.name}的錢。`, 'r')
  }
  declineBribe() { if (this.offer) { this.log(`你回絕了 C$${this.offer.price.toLocaleString('en-US')}。`, 'g'); this.offer = null } }
  /** 對手落後時開價或找上門（每場一次、不花點；找上門用數值結算，留守的隊友對上那一隊人） */
  private foeSpecials() {
    const f = this.foe, behind = this.score(1) - this.score(2)
    if (f.bribeAt != null && this.bribeLeft > 0 && !this.offer && this.round >= 2 && behind >= f.bribeAt) {
      const n = (f.bribeTimes ?? 1) - this.bribeLeft
      this.bribeLeft--
      this.offer = { price: (f.bribe ?? 1500) * (n + 1) }
      this.log(`${f.name}開價收買：C$${this.offer.price.toLocaleString('en-US')}，條件是你撤稿。`, 'r')
    }
    if (f.visitAt != null && !this.visited && this.round >= (f.visitFrom ?? 1) && behind >= f.visitAt) {
      this.visited = true
      const r = d20(this.rng) + this.guard, dc = 12 + f.st
      this.log(`${f.name}找上門：${f.visitWho ?? '一隊人'}往編輯台去。留守的隊友 ${r} 對 ${dc}。`, 'r')
      if (r >= dc) {
        this.log('擋住了。', 'g')
        if (this.live) { this.extra['visit'] = { n: '找上門的直播', t: 1, c: 1, d: '擋住找上門的整段直播：聲量 +4', v: 4 }; if (this.hand.length < 5) this.hand.push('visit'); else this.deck.push('visit'); this.log('整個過程都在直播上：多了一張「找上門的直播」。', 'g') }
      } else if (f.visitFail === 'capture') {
        this.captured = true
        this.end = { result: '敗', a: this.score(1), b: this.score(2), text: `擋不住：${f.visitWho ?? '那一隊人'}把你從編輯台帶走了。這一場算敗，接下來是戰敗事件。` }
        this.log('你被帶走了。', 'r')
      } else { this.skipNext = true; this.log('擋不住：你下一回合不能行動。', 'r') }
    }
  }
  /**
   * 防守（OPINION 3.3 節）：沒人的 2；搶對手的格子 3 − 風向；對手搶你的 3 ＋ 風向；最少 0。
   * 你去佔看臉的三格時，豔名每一級再 −1（4.3c 節），最少 0。
   */
  def(i: number, who: 1 | 2) {
    const base = this.own[i] === 0 ? 2 : who === 1 ? 3 - this.w : 3 + this.w
    const fame = who === 1 && FACE_CELLS.includes(i) ? this.fameLv : 0
    // 夜鶯的招牌：它佔著夜鶯直播時，你搶那一格的防守 +1
    const sig = who === 1 && i === 5 && this.own[5] === 2 && this.foe.style === 'nightingale' ? 1 : 0
    return Math.max(0, base - fame + this.defPlus[i] + sig)
  }
  canCap(i: number, who: 1 | 2) {
    if (this.own[i] === who) return false
    if (who === 2 && this.sh[i]) return false
    if (this.locked.includes(i)) return false
    if (!adj(i).some(j => this.own[j] === who)) return false
    return (who === 1 ? this.va : this.vb) >= this.def(i, who)
  }
  score(who: 1 | 2) { return this.own.reduce<number>((a, o, i) => a + (o === who ? this.topic.s[i] + this.bonus[i] : 0), 0) }
  cellScore(i: number) { return this.topic.s[i] + this.bonus[i] }
  /** 料牌的聲量照戰役的等級加：III、IV 級 +1（OPINION 4.3 節） */
  cardV(c: Card) { return c.v && c.v > 0 && c.t === 1 && this.foe.grade >= 3 ? c.v + 1 : c.v ?? 0 }
  cardReason(idx: number): string | null {
    if (this.end) return '戰役已經結束'
    const k = this.hand[idx]
    if (!k) return '沒有這張牌'
    if (this.ap < this.card(k).c) return '編輯點不夠'
    if (this.card(k).pick && !this.own.some((o, i) => o === 1 && !this.sh[i])) return '沒有可以設防的格子'
    return null
  }
  play(idx: number): boolean {
    if (this.cardReason(idx)) return false
    const k = this.hand[idx], c = this.card(k)
    if (c.pick) { this.mode = this.mode && this.mode.k === 'guard' && this.mode.idx === idx ? null : { k: 'guard', idx }; return true }
    this.ap -= c.c
    this.hand.splice(idx, 1)
    this.discard.push(k)
    this.mode = null
    let m = `你打出「${c.n}」：`
    const v = this.cardV(c)
    if (v) { this.va = clamp(this.va + v, 0, 10); m += `聲量 ${v > 0 ? '+' : ''}${v}。` }
    if (c.w) { this.w = clamp(this.w + c.w, -5, 5); m += `風向 +${c.w}。`; this.playedClaim = true }
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
    this.ap -= this.card('guard').c
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
    this.foeSpecials()
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
    return [...Array(9).keys()].filter(i => this.own[i] !== 2 && !this.sh[i] && !this.locked.includes(i) && adj(i).some(j => this.own[j] === 2)).sort((a, b) => weight(b) - weight(a) || a - b)
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
      if (has('takedown') && this.pts >= 2 && this.hand.length >= 3) { this.pts -= 2; const i = Math.floor(this.rng() * this.hand.length); const k = this.hand.splice(i, 1)[0]; this.discard.push(k); this.log(`潔絲檢舉下架：你丟掉一張「${this.card(k).n}」。`, 'r'); return true }
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
    // ---- 具名的對手（ENEMY_ROSTER 第六節）：行動的優先順序與招牌招式 ----
    if (style === 'starbelle' || style === 'kunlun' || style === 'nightingale') {
      const lawyer = (n: number) => { this.pts -= 2; this.cutUsed = true; this.cut = n; this.log(`對手寄律師函：你下回合的編輯點 −${n}。`, 'r') }
      if (style === 'starbelle') {
        if ((this.round === 1 || this.claimLast) && !this.cutUsed && this.pts >= 2 && this.round < this.rounds) { lawyer(2); return true }
        if (this.w >= 2 && this.pts >= 2) { this.pts -= 2; this.w = clamp(this.w - 2, -5, 5); this.log('對手反爆料：風向往它那邊 2。', 'r'); return true }
      }
      if (style === 'kunlun' && this.hand.length >= 3 && this.pts >= 2) {
        // 招牌：挑走你手上數字最高的那一張料
        let best = -1
        this.hand.forEach((k, i) => { const c = this.card(k); if (c.t === 1 && k !== 'inside' && (best < 0 || (c.v ?? 0) > (this.card(this.hand[best]).v ?? 0))) best = i })
        if (best >= 0) { this.pts -= 2; const k = this.hand.splice(best, 1)[0]; this.discard.push(k); this.log(`對手下架了你手上的「${this.card(k).n}」（它看得到你的手牌）。`, 'r'); return true }
      }
      if (style === 'nightingale' && this.hand.length > 3 && this.pts >= 2) { this.pts -= 2; const i = Math.floor(this.rng() * this.hand.length); const k = this.hand.splice(i, 1)[0]; this.discard.push(k); this.log(`對手下架：你丟掉一張「${this.card(k).n}」。`, 'r'); return true }
      const muteAt = style === 'nightingale' ? 3 : style === 'kunlun' ? 4 : 99
      if (!this.muted && this.va >= muteAt && this.pts >= 1) { this.pts--; this.muted = true; this.va = clamp(this.va - 2, 0, 10); this.log('對手降流：你的聲量 −2。', 'r'); return true }
      if (this.pts >= 1 && this.vb < need && this.vb < 10) { this.publish(); return true }
      if (this.w > 0 && this.pts >= 1 && style !== 'starbelle') { this.pts--; this.w = clamp(this.w - 1, -5, 5); this.log('對手否認：風向往它那邊 1。', 'r'); return true }
      if (this.capsLeft > 0) {
        this.capsLeft--
        if (!this.foeCap(style === 'nightingale' ? 8 : undefined) && !this.didCap) this.log('對手這回合搶不到格子。')
        this.didCap = true
        if (!this.own.includes(1)) { this.finish(2); return false }
        if (this.pts >= 2 && st >= 2 && style === 'nightingale' && this.foeTargets().includes(8) && this.vb >= this.def(8, 2)) { this.pts -= 2; this.capsLeft++; this.log('對手追擊地下轉播站。', 'r') }
        return true
      }
      if (this.pts > 0 && this.vb < 10) { this.publish(); return true }
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
