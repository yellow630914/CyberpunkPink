// 開場（OPINION 3.3、4.2、5.1；dev/adr/0020 V32、V34）：把 setup 變成一場戰役、放格子、洗牌、抽開場的牌、開第一回合。
// setup：{ topic: id 或整筆, foe: id 或整筆, strength?, grade?, desk?, your_start?, rounds?, mode? }
//   topic、foe 給 id 就是內容裡的那一筆；給整筆就照 DATA 的格式（會檢查）。desk 是坐編輯台的人（最多兩個）：字串，或 { actor, ep }（ep 是每回合的編輯點，沒寫是基礎值）；
//   沒給就是主角自己一個人。誰坐、編輯點怎麼算（路數、編制）在下一張（M5-opinion-desk）；這一張只認 setup 給的。
//   strength 蓋掉對手資料的強度；grade 是戰役的等級（1～5，沒給看議題的 grade，再沒有就是 1）。

import type { GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord, isSafeInt } from '../../core'
import { cellScore } from './board'
import { prPoints } from './foe'
import type { Cell, KindId, OpinionRules, Seat, TopicEntry, TopicKindEntry, War, WarFoe, WarTopic } from './model'
import {
  CELLS, CELL_NAME, MAIN, OPPONENT_KIND, STREET, START_ACTION, TOPIC_KIND, cardCatalog, isCell, cellKey, normalizeCellMap, opinionRules, opponentProblems, oppositeOf, readWar, topicKinds,
  topicProblems, type OpponentEntry,
} from './model'
import { Run } from './run'

export interface DeskSetup {
  actor: string
  ep?: number
}

export interface OpinionSetup {
  topic: string | Record<string, unknown>
  foe: string | Record<string, unknown>
  strength?: number
  grade?: number
  desk?: Array<string | DeskSetup>
  your_start?: string
  rounds?: number
  mode?: 'solo' | 'face'
}

const fail = (msg: string): never => {
  throw new ActionBlocked(msg)
}

function pickEntry<T>(k: Kernel, kind: string, raw: unknown, what: string, check: (e: Record<string, unknown>) => string[], fill?: (e: Record<string, unknown>) => Record<string, unknown>): T {
  if (typeof raw === 'string') {
    const e = k.content.hasKind(kind) ? k.content.get(kind, raw) : undefined
    if (!e) return fail(`找不到${what}「${raw}」。`)
    return e as unknown as T
  }
  if (!isRecord(raw)) return fail(`${what}要給 id 或整筆資料。`)
  const e = fill ? fill(raw) : raw
  const problems = check(e)
  if (problems.length) return fail(`${what}的資料不合格：${problems.join('；')}。`)
  return e as unknown as T
}

/** 整筆給的議題：id、名字、涉及的東西沒寫就補空的；分數沒寫（undefined）由開場時從預設的分數表挑一列。 */
const fillTopic = (e: Record<string, unknown>): Record<string, unknown> => ({
  id: 'inline', name: '臨時議題', involves: { factions: [], people: [], types: [] }, scores: {}, ...e,
})

function deskOf(state: GameState, rules: OpinionRules, raw: OpinionSetup['desk']): Seat[] {
  const list = raw && raw.length > 0 ? raw : [state.pc ?? 'you']
  if (list.length > 2) fail('編輯台最多坐兩個人。')
  const seen = new Set<string>()
  return list.map((x) => {
    const d: DeskSetup = typeof x === 'string' ? { actor: x } : x
    if (!isRecord(d) || typeof d.actor !== 'string' || d.actor === '') return fail('編輯台的座位要寫是誰（actor）。')
    if (seen.has(d.actor)) fail(`「${d.actor}」不能坐兩個位子。`)
    seen.add(d.actor)
    if (raw && raw.length > 0 && !state.actors[d.actor]) fail(`找不到要坐編輯台的人「${d.actor}」。`)
    const ep = d.ep === undefined ? rules.ep_base : d.ep
    if (!isSafeInt(ep) || ep < 0 || ep > 12) fail('編輯點要是 0～12 的整數。')
    return { actor: d.actor, ep, ep_max: ep }
  })
}

/** 把 setup 變成還沒開場的戰役（亂數的部分——分數表、洗牌、城市事件——在 openWar 做）。 */
export function skeleton(k: Kernel, state: GameState, setup: OpinionSetup, origin: Origin): { war: War; needPreset: boolean; kindEntry: TopicKindEntry; yourStart: string | undefined } {
  if (!isRecord(setup)) return fail('輿論戰要給 setup：{ topic, foe }。')
  if (readWar(state)) fail('已經有一場輿論戰在進行了。')
  const rules = opinionRules(k)
  const topic = pickEntry<TopicEntry>(k, TOPIC_KIND, setup.topic, '議題', topicProblems, fillTopic)
  const foe = pickEntry<OpponentEntry>(k, OPPONENT_KIND, setup.foe, '對手', opponentProblems)
  const kindEntry = topicKinds(k).find((e) => e.id === topic.kind && e.layout !== undefined)
  if (!kindEntry) return fail(`沒有「${topic.kind}」這種議題類型。`)
  if (kindEntry.layout === 'main_two' && foe.start === 'center') fail('萬華鏡是平台，不會當滅火的對手。')
  const needPreset = isRecord(topic.scores) && Object.keys(topic.scores).length === 0
  const scores = Object.fromEntries(CELLS.map((c) => [c, 0])) as Record<Cell, number>
  for (const [c, n] of Object.entries(normalizeCellMap<number>(topic.scores))) scores[c as Cell] = n as number
  const strength = setup.strength ?? foe.strength
  if (!isSafeInt(strength) || strength < 1 || strength > 3) fail('強度要是 1～3 的整數。')
  const grade = setup.grade ?? topic.grade ?? 1
  if (!isSafeInt(grade) || grade < 1 || grade > 5) fail('戰役的等級要是 1～5 的整數。')
  const rounds = setup.rounds ?? topic.rounds ?? rules.rounds
  if (!isSafeInt(rounds) || rounds < 1 || rounds > 12) fail('回合數要是 1～12 的整數。')
  if (setup.mode !== undefined && setup.mode !== 'solo' && setup.mode !== 'face') fail('mode 要是 solo 或 face。')
  const target = topic.target_cell === undefined ? undefined : (cellKey(topic.target_cell) as Cell)
  const wTopic: WarTopic = {
    id: topic.id, name: topic.name, kind: topic.kind as KindId, side: kindEntry.side ?? 'attack', scores,
    involves: clone(topic.involves), ...(target ? { target_cell: target } : {}), ...(topic.category ? { category: topic.category } : {}),
  }
  const priority = Object.fromEntries(CELLS.map((c) => [c, 1])) as Record<Cell, number>
  for (const [c, n] of Object.entries(normalizeCellMap<number>(foe.cell_priority))) priority[c as Cell] = n as number
  const wFoe: WarFoe = {
    id: foe.id, name: foe.name, ...(foe.faction ? { faction: foe.faction } : {}), strength, start: foe.start, cell_priority: priority,
    actions: clone(foe.actions), ...(foe.signature ? { signature: clone(foe.signature) } : {}), once: clone(foe.once ?? []),
    ...(foe.mimic ? { mimic: clone(foe.mimic) } : {}), ...(foe.capture !== undefined ? { capture: foe.capture } : {}),
  }
  const war: War = {
    id: `o${state.seq.uid + 1}`, mode: setup.mode ?? 'solo', topic: wTopic, foe: wFoe, grade, round: 1, rounds, turn: 'you',
    cells: Object.fromEntries(CELLS.map((c) => [c, { owner: null }])) as War['cells'], voice: { you: 0, foe: 0 }, wind: kindEntry.wind ?? 0,
    desk: deskOf(state, rules, setup.desk), deck: [], hand: [], discard: [], captured: 0, captures: 1, used: {}, bonus: {},
    foe_state: { bribes: 0, visited: false }, origin: clone(origin),
  }
  return { war, needPreset, kindEntry, yourStart: setup.your_start ?? topic.your_start }
}

/** 照議題類型放格子（V32）。 */
function layOut(war: War, kind: TopicKindEntry, want: string | undefined): { you: Cell[]; foe: Cell[] } {
  const byScore = (cells: Cell[]): Cell[] => [...cells].sort((a, b) => cellScore(war, b) - cellScore(war, a) || CELLS.indexOf(a) - CELLS.indexOf(b))
  const centerFoe = war.foe.start === 'center'
  if (kind.layout === 'main_two') {
    const ranked = byScore(MAIN)
    const mine = ranked.slice(0, 2)
    const left = ranked[2]!
    return { you: mine, foe: [CELLS[CELLS.indexOf(left) + 3]!] }
  }
  if (kind.layout === 'whitewash') {
    // 對手已經佔了分數最高的三格（從中央開場的一定包含萬華鏡）；你只有一格
    const pool = centerFoe ? CELLS.filter((c) => c !== 'kaleido') : [...CELLS]
    const foeCells = byScore(pool).slice(0, centerFoe ? 2 : 3)
    if (centerFoe) foeCells.unshift('kaleido')
    const free = CELLS.filter((c) => !foeCells.includes(c))
    if (want !== undefined) {
      const c = cellKey(want)
      if (!isCell(c) || foeCells.includes(c)) fail(`「${isCell(c) ? CELL_NAME[c] : want}」已經是對手的格子，起始格要換一格。`)
      return { you: [c as Cell], foe: foeCells }
    }
    const opp = oppositeOf(byScore(foeCells)[0]!)
    const pick = free.includes(opp) ? opp : ([...STREET, ...free].find((c) => free.includes(c)) as Cell)
    return { you: [pick], foe: foeCells }
  }
  // street：你在街頭一格（預設街上的耳語），對手在你的對面（萬華鏡當對手從中央）
  const mine = want === undefined ? 'whisper' : cellKey(want)
  if (!isCell(mine) || !STREET.includes(mine)) return fail(`起始格要在街頭那一排（${STREET.map((c) => CELL_NAME[c]).join('、')}）。`)
  return { you: [mine], foe: [centerFoe ? 'kaleido' : oppositeOf(mine)] }
}

/** 開場：放格子、洗牌、抽牌、第一回合。回傳 opinion.start 的報告草稿。 */
export function startDraft(k: Kernel, state: GameState, setup: OpinionSetup, origin: Origin): ReportDraft {
  const { war, needPreset, kindEntry, yourStart } = skeleton(k, state, setup, origin)
  const run = new Run(k, state, war, 'start')
  const w = run.w
  const rules = run.rules
  if (needPreset) {
    const presets = topicKinds(k).filter((e) => e.scores !== undefined)
    if (presets.length > 0) {
      const p = run.rng.pick(presets)
      for (const [c, n] of Object.entries(normalizeCellMap<number>(p.scores))) w.topic.scores[c as Cell] = n as number
    }
  }
  const pos = layOut(w, kindEntry, yourStart)
  for (const c of pos.you) w.cells[c] = { owner: 'you' }
  for (const c of pos.foe) w.cells[c] = { owner: 'foe' }

  // 牌庫：目錄裡每一種基本牌放 basic 張，洗牌；開場抽 open_hand 張
  const basics = cardCatalog(k).flatMap((c) => Array.from({ length: c.basic ?? 0 }, () => c.id))
  w.deck = run.shuffle(basics)
  const kindName = kindEntry.name ?? kindEntry.id
  const pr = prPoints(run)
  run.say(`輿論戰開始：議題「${w.topic.name}」（${kindName}），${w.rounds} 回合。對手「${w.foe.name}」，強度 ${w.foe.strength}，每回合 ${pr} 點公關點。`, {
    tag: 'opinion.start', data: { topic: w.topic.id, kind: w.topic.kind, foe: w.foe.id, strength: w.foe.strength, pr, grade: w.grade, rounds: w.rounds, mode: w.mode },
    plain: `一場輿論戰開打了，議題是「${w.topic.name}」，對手是「${w.foe.name}」。`,
  })
  run.say(`你從${pos.you.map((c) => `「${CELL_NAME[c]}」`).join('、')}開場；對手從${pos.foe.map((c) => `「${CELL_NAME[c]}」`).join('、')}開場。${w.wind !== 0 ? `風向 ${w.wind}。` : ''}`, {
    tag: 'opinion.layout', data: { you: pos.you, foe: pos.foe, wind: w.wind, scores: w.topic.scores },
  })
  const open = run.draw(rules.open_hand)
  run.say(`開場的手牌：${open.map((id) => `「${run.cardName(id)}」`).join('、') || '（沒有牌）'}。`, { tag: 'opinion.draw', data: { cards: open } })
  run.startRound()
  return run.draft(START_ACTION, 'started', run.beats.map((b) => b.text).join(''), { extra: [{ op: 'uid', advance: 1 }] })
}
