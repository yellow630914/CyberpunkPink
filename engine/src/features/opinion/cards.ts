// 牌（OPINION 4.3）：目錄加這一場才有的牌、牌面的數字（料照戰役等級加、說法照公信力加減）、一張牌能不能出、出牌。
// 出一張牌是一份報告 opinion.play（kind broadcast）；一張牌由一個人付編輯點，不能合付（V40）。

import type { GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked } from '../../core'
import { cellsOwnedBy } from './board'
import type { Cell, CardEntry, OpinionRules, Seat, War } from './model'
import { CELL_NAME, CELLS, PLAY_ACTION, cardCatalog, isCell, opinionRules as opinionRulesOf, readWar } from './model'
import { Run, credOf } from './run'

export type ResolvedCard = Omit<CardEntry, 'basic'>

export function cardOf(k: Pick<Kernel, 'content'>, war: War, id: string): ResolvedCard | null {
  const c = war.custom?.[id]
  if (c) return c
  const e = cardCatalog(k).find((x) => x.id === id)
  return e ?? null
}

/** 料牌的聲量：牌面加上戰役等級的加成（III、IV +1，V +2）。 */
export function fuelVoice(rules: OpinionRules, war: War, c: ResolvedCard): number {
  const v = c.voice ?? 0
  return v > 0 ? v + (rules.grade_fuel[war.grade - 1] ?? 0) : v
}

/**
 * 說法牌的風向：牌面加上公信力的加減（60 以上 +1、低於 30 −1，最少 0）；對手的招牌「你的公信力低於 N 時你的說法減半」再減半（進位）。
 * 牌面是負的（把風向推向對手）不看公信力。
 */
export function lineWind(rules: OpinionRules, war: War, c: ResolvedCard, cred: number): number {
  const base = c.wind ?? 0
  if (base <= 0) return base
  let n = Math.max(0, base + (cred >= rules.line_cred.high ? 1 : cred < rules.line_cred.low ? -1 : 0))
  const weak = war.foe.signature?.effect.weak_line
  if (weak && cred < weak.cred_below) n = Math.ceil(n / 2)
  return n
}

/** 一句話說這張牌做什麼（給畫面）。 */
export function cardText(k: Kernel, state: GameState, war: War, c: ResolvedCard): string {
  const rules = opinionRulesOf(k)
  const sign = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`
  if (c.kind === 'fuel') return `聲量 ${sign(fuelVoice(rules, war, c))}${c.inside ? '（不能被下架）' : ''}${c.fake ? `。擲 d20，${rules.fake.risk} 以下被拆穿` : ''}`
  if (c.kind === 'line') return `風向 ${sign(lineWind(rules, war, c, credOf(k, state)))}`
  switch (c.means) {
    case 'guard': return '你的一格到對手那一回合不能被搶'
    case 'mute': return `對手聲量 −${rules.mute}`
    case 'army': return `聲量 +${rules.army.voice}。擲 d20，${rules.army.risk} 以下被拆穿：風向 −${rules.army.wind}`
    default: return `雙方聲量各 −${rules.shift}`
  }
}

// ---- 能不能出 ----

/** 戰役現在能不能動作：沒有戰役、已經分出勝負、等著回應。 */
export function warBlock(war: War | null): string | null {
  if (!war) return '現在沒有輿論戰。'
  if (war.turn === 'ended') return '這場輿論戰已經分出勝負了，先結算。'
  if (war.pending === 'bribe') return `對手開了價（C$${(war.offer ?? 0).toLocaleString('en-US')}），先決定收不收。`
  if (war.pending !== undefined) return '還有事情等你回應。'
  return null
}

export interface PlayInput {
  /** 手牌的第幾張（從 0 起） */
  index: number
  /** 設防要選的格子（自己的一格） */
  cell?: string
  /** 誰付編輯點（兩個人坐編輯台時；沒寫就找第一個付得起的） */
  actor?: string
}

/** 這張牌誰付得起。 */
function payer(war: War, cost: number, actor?: string): Seat | null {
  if (actor !== undefined) {
    const s = war.desk.find((x) => x.actor === actor)
    return s && s.ep >= cost ? s : null
  }
  return war.desk.find((x) => x.ep >= cost) ?? null
}

/** 設防選得了的格子：自己的、還沒設防的。 */
export function guardable(war: War): Cell[] {
  return cellsOwnedBy(war, 'you').filter((c) => !((war.cells[c].guard ?? 0) >= war.round))
}

/** 一張手牌現在能不能出（不看要選的格子）：回傳原因，可以回 null。 */
export function cardBlock(k: Kernel, war: War, index: number, actor?: string): string | null {
  const id = war.hand[index]
  if (id === undefined) return '手上沒有這張牌。'
  const c = cardOf(k, war, id)
  if (!c) return `牌「${id}」不在牌庫的目錄裡，出不了。`
  if (actor !== undefined && !war.desk.some((s) => s.actor === actor)) return '這個人沒有坐在編輯台。'
  if (!payer(war, c.cost, actor)) {
    const have = actor === undefined ? Math.max(0, ...war.desk.map((s) => s.ep)) : (war.desk.find((s) => s.actor === actor)?.ep ?? 0)
    return `編輯點不夠：「${c.name}」要 ${c.cost} 點，${actor === undefined && war.desk.length > 1 ? '每個人' : '你'}最多只有 ${have} 點（一張牌由一個人付）。`
  }
  if (c.kind === 'means' && c.means === 'guard' && guardable(war).length === 0) return '沒有可以設防的格子。'
  return null
}

export function playBlock(k: Kernel, state: GameState, input: PlayInput): string | null {
  const war = readWar(state)
  const b = warBlock(war)
  if (b) return b
  const w = war!
  const hand = cardBlock(k, w, input.index, input.actor)
  if (hand) return hand
  const c = cardOf(k, w, w.hand[input.index]!)!
  if (c.kind === 'means' && c.means === 'guard') {
    if (input.cell === undefined) return '要選一格來設防。'
    if (!isCell(input.cell)) return `「${input.cell}」不是格子的 id（${CELLS.join('、')}）。`
    if (!guardable(w).includes(input.cell)) return `「${CELL_NAME[input.cell]}」不是你的格子，或這回合已經設了防。`
  }
  return k.activity.blockOf(state, `commit:${PLAY_ACTION}`)
}

// ---- 出牌 ----

export function playDraft(k: Kernel, state: GameState, input: PlayInput): ReportDraft {
  const block = playBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), `play/${input.index}`)
  const w = run.w
  const rules = run.rules
  const id = w.hand[input.index]!
  const c = cardOf(k, w, id)!
  const seat = payer(w, c.cost, input.actor)!
  seat.ep -= c.cost
  w.hand.splice(input.index, 1)
  w.discard.push(id)
  const who = seat.actor || undefined
  const head = `你打出「${c.name}」`
  const data: Record<string, unknown> = { card: id, cost: c.cost, seat: seat.actor }
  let busted = false

  if (c.kind === 'fuel') {
    const n = fuelVoice(rules, w, c)
    run.addVoice('you', n)
    run.say(`${head}：聲量 +${n}（你現在 ${w.voice.you}）。`, { tag: 'opinion.play', data: { ...data, voice: n }, plain: `你打出「${c.name}」，聲勢起來了。`, ...(who ? { actor: who } : {}) })
  } else if (c.kind === 'line') {
    const n = lineWind(rules, w, c, credOf(k, state))
    run.addWind(n)
    run.say(`${head}：風向 ${n >= 0 ? '+' : '−'}${Math.abs(n)}（風向現在 ${w.wind >= 0 ? '+' : ''}${w.wind}）。`, { tag: 'opinion.play', data: { ...data, wind: n }, plain: `你打出「${c.name}」，風向偏了過來。`, ...(who ? { actor: who } : {}) })
  } else if (c.means === 'guard') {
    const cell = input.cell as Cell
    w.cells[cell].guard = w.round
    run.say(`${head}：替「${CELL_NAME[cell]}」設防，這一回合對手搶不了。`, { tag: 'opinion.play', data: { ...data, cell }, plain: `你替一格設了防。`, ...(who ? { actor: who } : {}) })
  } else if (c.means === 'mute') {
    run.addVoice('foe', -rules.mute)
    run.say(`${head}：對手的聲量 −${rules.mute}（對手現在 ${w.voice.foe}）。`, { tag: 'opinion.play', data: { ...data, foe_voice: -rules.mute }, plain: `你壓住了對手的流量。`, ...(who ? { actor: who } : {}) })
  } else if (c.means === 'shift') {
    run.addVoice('you', -rules.shift)
    run.addVoice('foe', -rules.shift)
    run.say(`${head}：雙方的聲量各 −${rules.shift}（你 ${w.voice.you}、對手 ${w.voice.foe}）。`, { tag: 'opinion.play', data: { ...data, you_voice: -rules.shift, foe_voice: -rules.shift }, plain: `你把大家的目光引到別處。`, ...(who ? { actor: who } : {}) })
  } else {
    // 水軍：聲量 +3，擲一次 d20，5 以下被拆穿（風向 −1、公信力 −3）
    run.addVoice('you', rules.army.voice)
    const roll = run.rng.int(1, 20)
    run.say(`${head}：聲量 +${rules.army.voice}。擲 d20：${roll}。`, { tag: 'opinion.play', data: { ...data, voice: rules.army.voice, roll, risk: rules.army.risk }, plain: `你放出了水軍。`, ...(who ? { actor: who } : {}) })
    if (roll <= rules.army.risk) {
      busted = true
      bust(run, `水軍被拆穿了`, rules.army.wind, rules.army.cred)
    }
  }

  // 假料：牌面照打，擲 d20，被拆穿這張牌無效（聲量收回）、風向與公信力反噬
  if (c.fake && c.kind === 'fuel') {
    const roll = run.rng.int(1, 20)
    run.say(`假料的真假：擲 d20：${roll}。`, { tag: 'opinion.roll', data: { card: id, roll, risk: rules.fake.risk } })
    if (roll <= rules.fake.risk) {
      busted = true
      run.addVoice('you', -fuelVoice(rules, w, c))
      bust(run, `「${c.name}」被拆穿了：這張牌無效`, rules.fake.wind, rules.fake.cred)
    }
  }

  const summary = run.beats.map((b) => b.text).join('')
  return run.draft(PLAY_ACTION, busted ? 'busted' : 'played', summary)
}

/** 被拆穿的反噬：風向往對手那邊、公信力（有人定義這個量表才扣）。 */
function bust(run: Run, what: string, wind: number, cred: number): void {
  run.addWind(-wind)
  const has = run.k.meters.has('credibility')
  if (has) run.changes.push({ op: 'meter', kind: 'credibility', key: '_', delta: -cred })
  run.say(`${what}：風向 −${wind}${has ? `、公信力 −${cred}` : ''}。`, { tag: 'opinion.bust', data: { wind: -wind, ...(has ? { cred: -cred } : {}) }, plain: `${what}，風向跟著轉了。` })
}
