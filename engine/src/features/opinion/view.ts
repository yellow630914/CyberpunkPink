// 給畫面看的整理（OPINION 第 10 節；UI 6.1）：九格（名字、分數、誰的、搶下來要多少聲量、能不能佔與原因）、雙方的分數與聲量與風向、編輯點、
// 手牌每一張能不能出與原因、回合、對手與它上一步、城市事件、結果。純函式、唯讀。

import type { GameState, Kernel } from '../../core'
import { cellScore, defenseOf, lockedCells, planCapture, scoreOf } from './board'
import { cardBlock, cardOf, cardText, costOf, guardable, warBlock } from './cards'
import { prPoints } from './foe'
import type { Reservable } from './fx'
import { reservables } from './fx'
import type { MoveView } from './moves'
import { movesView } from './moves'
import type { Cell, Outcome, Row, WarResult } from './model'
import { CELLS, CELL_NAME, ROW_NAME, SLOTS, cityCatalog, readWar, rowOf, topicKinds } from './model'
import { Run, cityText, outcomeName } from './run'

export interface CellView {
  id: Cell
  name: string
  row: Row
  row_name: string
  score: number
  owner: 'you' | 'foe' | null
  /** 設了防（對手這一回合搶不了） */
  guarded: boolean
  /** 城市事件讓它這回合不能被佔 */
  locked: boolean
  /** 嫁禍指定的那一格 */
  target: boolean
  /** 你搶下它要多少聲量（已經是你的是 null） */
  need: number | null
  can: boolean
  reason: string | null
}

export interface HandView {
  index: number
  id: string
  name: string
  kind: 'fuel' | 'line' | 'means'
  cost: number
  text: string
  can: boolean
  reason: string | null
  /** 要先選格子（設防）：可以選的格子 */
  pick: Cell[] | null
}

export type OpinionView =
  | { active: false; note: string }
  | {
    active: true
    id: string
    mode: 'solo' | 'face'
    topic: { id: string; name: string; kind: string; kind_name: string; side: 'attack' | 'defend'; target_cell: Cell | null; category: string | null }
    grade: number
    round: number
    rounds: number
    slot: string
    turn: 'you' | 'ended'
    cells: CellView[]
    score: { you: number; foe: number }
    voice: { you: number; foe: number }
    wind: number
    seats: Array<{ actor: string; ep: number; ep_max: number }>
    ep: number
    captured: number
    captures: number
    can_capture: boolean
    hand: HandView[]
    deck: number
    discard: number
    foe: {
      id: string; name: string; faction: string | null; strength: number; pr: number; signature: { id: string; text: string } | null
      /** 上一回合它做了什麼（新的一回合開始前留著給畫面看） */
      last: string[]; open: string[] | null; bribes: number
    }
    ep_penalty: number
    city: { id: string; name: string; text: string } | null
    pending: 'bribe' | 'visit' | 'lost' | null
    offer: number | null
    /** 現在能不能結束回合、能不能認輸、能不能結算（原因是 null 就是可以） */
    end_turn: string | null
    concede: string | null
    settle: string | null
    result: (WarResult & { outcome_name: string }) | null
    /** 這一招一招的清單（opinion.moves 問回來的）與格式不對略過的幾筆 */
    moves: MoveView[]
    moves_skipped: string[]
    /** 有 cost 的反應：結束回合時可以預留編輯點給它們（endTurn 的輸入 reserve） */
    reserve: Reservable[]
    /** 開戰時問回來的被動（名字與來源） */
    passives: Array<{ id: string; name: string; owner: string }>
    /** 帶進牌庫的料 */
    brought: Array<{ ref: string; name: string }>
    /** 這回合還能多佔幾格、能不能不相鄰 */
    extra_captures: number
  }

export function opinionView(k: Kernel, state: GameState): OpinionView {
  const w = readWar(state)
  if (!w) return { active: false, note: '現在沒有輿論戰。' }
  const run = new Run(k, state, w, 'view')
  const rules = run.rules
  const lock = lockedCells(w)
  const phase = warBlock(w)
  const capped = w.captured >= w.captures
  const cells: CellView[] = CELLS.map((c) => {
    const owner = w.cells[c].owner
    const plan = owner === 'you' ? null : planCapture(w, c, rules, run.env)
    const why = owner === 'you' ? `「${CELL_NAME[c]}」已經是你的了。` : (phase ?? (capped ? '這一回合已經佔領過了。' : plan && 'why' in plan ? plan.why : null))
    return {
      id: c, name: CELL_NAME[c], row: rowOf(c), row_name: ROW_NAME[rowOf(c)], score: cellScore(w, c), owner,
      guarded: owner === 'you' && (w.cells[c].guard ?? 0) >= w.round, locked: lock.includes(c), target: w.topic.target_cell === c,
      need: owner === 'you' ? null : defenseOf(w, c, 'you', rules, run.env), can: why === null, reason: why,
    }
  })
  const hand: HandView[] = w.hand.map((id, index) => {
    const c = cardOf(k, w, id)
    const why = phase ?? cardBlock(k, w, index, undefined, run.env)
    return {
      index, id, name: c?.name ?? id, kind: c?.kind ?? 'means', cost: c ? costOf(w, c, run.env) : 0, text: c ? cardText(k, state, w, c) : '（這張牌的資料找不到）',
      can: why === null, reason: why, pick: c?.kind === 'means' && c.means === 'guard' ? guardable(w) : null,
    }
  })
  const kind = topicKinds(k).find((e) => e.id === w.topic.kind)
  const city = w.city ? cityCatalog(k).find((c) => c.id === w.city) : undefined
  const sig = w.foe.signature
  const ep = w.desk.reduce((s, x) => s + x.ep, 0)
  const end = phase ?? null
  const mv = movesView(k, state)
  return {
    active: true, id: w.id, mode: w.mode,
    topic: { id: w.topic.id, name: w.topic.name, kind: w.topic.kind, kind_name: kind?.name ?? w.topic.kind, side: w.topic.side, target_cell: w.topic.target_cell ?? null, category: w.topic.category ?? null },
    grade: w.grade, round: w.round, rounds: w.rounds, slot: SLOTS[w.round - 1] ?? `第 ${w.round} 回合`, turn: w.turn, cells,
    score: { you: scoreOf(w, 'you'), foe: scoreOf(w, 'foe') }, voice: { ...w.voice }, wind: w.wind, seats: w.desk.map((s) => ({ ...s })), ep,
    captured: w.captured, captures: w.captures, can_capture: cells.some((c) => c.can), hand, deck: w.deck.length, discard: w.discard.length,
    foe: {
      id: w.foe.id, name: w.foe.name, faction: w.foe.faction ?? null, strength: w.foe.strength, pr: prPoints(run), signature: sig ? { id: sig.id, text: sig.text } : null,
      last: [...(w.foe_state.last ?? [])], open: w.foe_state.open ? [...w.foe_state.open] : null, bribes: w.foe_state.bribes,
    },
    ep_penalty: w.foe_state.ep_penalty ?? 0,
    city: w.city ? { id: w.city, name: city?.name ?? w.city, text: city ? (city.text ?? cityText(city.name, w.city_fx ?? city.effect)) : '' } : null,
    pending: w.pending ?? null, offer: w.offer ?? null,
    end_turn: end, concede: w.turn === 'ended' ? '這場輿論戰已經分出勝負了，先結算。' : null,
    settle: w.turn === 'ended' ? null : '這場輿論戰還沒分出勝負。',
    result: w.result ? { ...w.result, outcome_name: outcomeName(w.result.outcome as Outcome) } : null,
    moves: mv.moves, moves_skipped: mv.skipped, reserve: reservables(run), passives: w.passives.map((p) => ({ id: p.id, name: p.name, owner: p.owner })),
    brought: w.brought.map((b) => ({ ref: b.ref, name: run.cardName(b.card) })), extra_captures: w.xcap.length,
  }
}
