// 一份報告裡的工作檯：複製一份戰役、一顆這份報告專用的亂數、累積時間線與變更；回合開始、抽牌、洗牌、城市事件、結束都在這裡。
// 亂數：用核心的 deriveRng（種子、游標、用途導出），用途帶戰役 id、動作、回合；這份報告擲過骰就多一筆 { op: 'rng', advance: 1 }
// （所以同一個種子、同樣的操作，整場逐份報告相同；讀檔再接著打也一樣）。

import type { Change, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { clamp, clone, deriveRng, meterOf, type Rng } from '../../core'
import { scoreOf, cellsOwnedBy } from './board'
import type { CityEffect, Outcome, OpinionRules, EndBy, War, WarResult } from './model'
import { CELLS, CELL_NAME, SLOTS, WAR_OP, cardCatalog, cityCatalog, opinionRules } from './model'
import type { Who } from './model'

export const credOf = (k: Pick<Kernel, 'meters'>, state: GameState): number => (k.meters.has('credibility') ? meterOf(k, state, 'credibility') : 50)

export class Run {
  readonly rules: OpinionRules
  readonly w: War
  readonly beats: TimelineBeat[] = []
  readonly changes: Change[] = []
  /** 給 AI 寫正文用的句子：不帶機制的數字（0017 第 12 項） */
  readonly plain: string[] = []
  readonly rng: Rng

  constructor(readonly k: Kernel, readonly state: GameState, war: War | null, purpose: string) {
    this.rules = opinionRules(k)
    if (!war) throw new Error('Run 要一場戰役')
    this.w = clone(war)
    this.rng = deriveRng(state.rng, `opinion/${this.w.id}/${purpose}/${this.w.round}`)
  }

  say(text: string, o: { tag?: string; data?: Record<string, unknown>; plain?: string; actor?: string } = {}): void {
    this.beats.push({ layer: 'meat', text, ...(o.actor ? { actor: o.actor } : {}), ...(o.tag ? { tag: o.tag } : {}), ...(o.data ? { data: o.data } : {}) })
    if (o.plain) this.plain.push(o.plain)
  }

  // ---- 兩個數字 ----

  addVoice(who: Who, n: number): void {
    this.w.voice[who] = clamp(this.w.voice[who] + n, 0, this.rules.voice_max)
  }

  /** 風向：正的偏你。 */
  addWind(n: number): void {
    this.w.wind = clamp(this.w.wind + n, -this.rules.wind_max, this.rules.wind_max)
  }

  // ---- 牌庫 ----

  shuffle<T>(list: T[]): T[] {
    const a = [...list]
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i)
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }

  /** 抽 n 張（手牌上限；牌庫抽完就把棄牌洗回去）。回傳抽到的牌 id。 */
  draw(n: number): string[] {
    const got: string[] = []
    for (let i = 0; i < n && this.w.hand.length < this.rules.hand_max; i++) {
      if (this.w.deck.length === 0) {
        if (this.w.discard.length === 0) break
        this.w.deck = this.shuffle(this.w.discard)
        this.w.discard = []
        this.say('牌庫抽完了：棄牌洗回去。', { tag: 'opinion.reshuffle', data: { deck: this.w.deck.length }, plain: '牌庫抽完了，棄牌洗了回去。' })
      }
      const id = this.w.deck.pop()!
      this.w.hand.push(id)
      got.push(id)
    }
    return got
  }

  cardName(id: string): string {
    return this.w.custom?.[id]?.name ?? cardCatalog(this.k).find((c) => c.id === id)?.name ?? id
  }

  // ---- 回合開始 ----

  /** 翻一張城市事件（只影響這一回合；偶像的畢業公演是整場）。 */
  flipCity(): void {
    delete this.w.city
    delete this.w.city_fx
    const list = cityCatalog(this.k)
    if (list.length === 0) return
    const card = this.rng.pick(list)
    const fx = clone(card.effect) as CityEffect
    this.w.city = card.id
    this.w.city_fx = fx
    const text = card.text ?? cityText(card.name, fx)
    if (fx.kind === 'voice') {
      this.addVoice('you', fx.you)
      this.addVoice('foe', fx.foe)
    } else if (fx.kind === 'score') this.w.bonus[fx.cell] = Math.max(this.w.bonus[fx.cell] ?? 0, fx.amount)
    this.say(`城市事件：${card.name}。${text}`, { tag: 'opinion.city', data: { id: card.id, effect: fx }, plain: `城市裡出了一件事：${card.name}。` })
  }

  /** 新的一回合：城市事件、編輯點補滿（律師函扣掉）、抽牌、這回合的佔領次數。 */
  startRound(): void {
    const w = this.w
    w.captured = 0
    w.captures = 1
    for (const key of Object.keys(w.used)) if (key.startsWith('turn:')) delete w.used[key]
    let pen = w.foe_state.ep_penalty ?? 0
    delete w.foe_state.ep_penalty
    for (const s of w.desk) {
      s.ep = s.ep_max
      const cut = Math.min(pen, s.ep)
      s.ep -= cut
      pen -= cut
    }
    const slot = SLOTS[w.round - 1] ?? `第 ${w.round} 回合`
    this.say(`—— 第 ${w.round} 回合・${slot} ——`, { tag: 'opinion.round', data: { round: w.round, rounds: w.rounds }, plain: `${slot}的時段開始了。` })
    this.flipCity()
    const got = this.draw(this.rules.draw)
    if (got.length > 0) this.say(`你抽了 ${got.length} 張牌：${got.map((id) => `「${this.cardName(id)}」`).join('、')}。`, { tag: 'opinion.draw', data: { cards: got } })
    const total = w.desk.reduce((s, x) => s + x.ep, 0)
    this.say(`編輯點 ${total}。`, { tag: 'opinion.ep', data: { ep: total } })
  }

  // ---- 結束 ----

  /** 戰役分出勝負：算結果、標成結束（還要 opinion.end 結算才交回活動；認輸與收買直接結算）。 */
  finish(by: EndBy, bribed?: number): WarResult {
    const w = this.w
    const you = scoreOf(w, 'you')
    const foe = scoreOf(w, 'foe')
    const target = w.topic.target_cell
    const held = target ? w.cells[target].owner === 'you' : null
    let outcome: Outcome
    if (by === 'concede' || by === 'bribe' || by === 'visit') outcome = 'lost'
    else if (cellsOwnedBy(w, 'you').length === 0) outcome = 'lost'
    else if (cellsOwnedBy(w, 'foe').length === 0) outcome = 'major'
    else outcome = you > foe ? (you - foe >= this.rules.big_gap ? 'major' : 'minor') : you < foe ? 'lost' : 'draw'
    // 嫁禍：分數高但沒佔著指定的那一格，算沒贏
    if (held === false && (outcome === 'major' || outcome === 'minor')) outcome = 'draw'
    const result: WarResult = { outcome, by, you, foe, target_held: held, ...(bribed !== undefined ? { bribed } : {}) }
    w.result = result
    w.turn = 'ended'
    delete w.pending
    delete w.offer
    this.say(resultText(result, w), { tag: 'opinion.result', data: { ...result }, plain: resultPlain(result) })
    return result
  }

  // ---- 草稿 ----

  draft(action: string, result: string, summary: string, o: { war?: War | null; extra?: Change[] } = {}): ReportDraft {
    const war = o.war === undefined ? this.w : o.war
    const changes: Change[] = [...this.changes, { op: WAR_OP, war: war === null ? null : clone(war) }, ...(o.extra ?? []), { op: 'rng', advance: 1 }]
    return {
      kind: 'broadcast', action, location: clone(this.state.location), ...(this.state.pc ? { actor: this.state.pc } : {}), party: [], timeline: this.beats, changes,
      outcome: { result, summary }, ...(this.plain.length > 0 ? { narration: { results: this.plain } } : {}),
    }
  }
}

export function cityText(name: string, fx: CityEffect): string {
  switch (fx.kind) {
    case 'voice': return `雙方的聲量${fx.you === fx.foe ? `各 ${fx.you >= 0 ? '+' : '−'}${Math.abs(fx.you)}` : `：你 ${fx.you >= 0 ? '+' : '−'}${Math.abs(fx.you)}、對手 ${fx.foe >= 0 ? '+' : '−'}${Math.abs(fx.foe)}`}。`
    case 'def_row': return `${fx.row === 'street' ? '街頭' : fx.row === 'main' ? '主流' : '圈子'}那一排的防守這回合 ${fx.amount >= 0 ? '+' : '−'}${Math.abs(fx.amount)}。`
    case 'lock': return `${[...(fx.cells ?? []).map((c) => CELL_NAME[c]), ...(fx.row ? [`${fx.row === 'street' ? '街頭' : fx.row === 'main' ? '主流' : '圈子'}那一排`] : [])].join('、')}這回合不能被佔。`
    case 'score': return `${CELL_NAME[fx.cell]}的分數這一場 +${fx.amount}。`
    default: return name.length > 0 ? '沒有別的事。' : ''
  }
}

const OUTCOME_NAME: Record<Outcome, string> = { major: '大勝', minor: '小勝', draw: '平手', lost: '敗' }
export const outcomeName = (o: Outcome): string => OUTCOME_NAME[o]

export function resultText(r: WarResult, w: War): string {
  const score = `${r.you} 分對 ${r.foe} 分`
  const head = `${OUTCOME_NAME[r.outcome]}：`
  const target = r.target_held === false ? `沒有佔著指定的「${CELL_NAME[w.topic.target_cell!]}」，贏不算數。` : ''
  switch (r.by) {
    case 'concede': return `${head}你認輸了（${score}）。`
    case 'bribe': return `${head}你收下了對手開的價，戰役結束（${score}）。`
    case 'visit': return `${head}對手的人找上門了，戰役結束（${score}）。`
    case 'wipe': return `${head}${r.outcome === 'major' ? '對手的格子被清空' : '你的格子被清空'}，戰役提前結束（${score}）。${target}`
    default: return `${head}打完了，${score}。${target}`
  }
}

export function resultPlain(r: WarResult): string {
  return r.outcome === 'major' ? '你贏得漂亮，對手被壓得抬不起頭。' : r.outcome === 'minor' ? '你贏了，事情傳開了，但對方還撐得住。' : r.outcome === 'draw' ? '各說各話，沒有人佔到上風。' : '這件事被壓下去了。'
}

export { CELLS }
