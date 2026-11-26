// 開場（OPINION 3.3、4.2、4.3a、5.1、第 8 節；dev/adr/0020 V32～V34）：把 setup 變成一場戰役、問被動、放格子、洗牌（基本牌加帶進來的料）、開場的加成、抽開場的牌、開第一回合。
// setup：{ topic: id 或整筆 或 { kind, faction, people?, types? }, foe?: id 或整筆, strength?, grade?, desk?, bring?, your_start?, rounds?, mode?, links? }
//   topic、foe 給 id 就是內容裡的那一筆；給整筆就照 DATA 的格式（會檢查）。只給類型與勢力是自己發起（self.ts）：等級照勢力的 grade，沒給 foe 就找對得上勢力的對手、沒有用通用公關。
//   desk 是坐編輯台的人（最多兩個、要在隊伍裡）：字串，或 { actor, ep }（ep 蓋掉算出來的）；沒給就是主角自己一個人。編輯點的算式在 desk.ts。
//   bring 是要帶進牌庫的料（素材 ft… 或片 cl…，bring.ts）：每件扣 1 次使用次數，併進這一份報告。links 是副本前面階段拿到的連動（face.opinion 給）。
//   strength 蓋掉對手資料的強度；grade 是戰役的等級（1～5，沒給看議題的 grade，再沒有就是 1）。

import type { GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord, isSafeInt, meterOf } from '../../core'
import { cellScore } from './board'
import type { BringPlan } from './bring'
import { planBring } from './bring'
import { openHandBonus, seatsOf } from './desk'
import { beginTurn } from './fx'
import { prPoints } from './foe'
import type { OpOpen } from './hooks'
import { askOpen, askPassives } from './hooks'
import type { Cell, KindId, TopicEntry, TopicKindEntry, War, WarCard, WarFoe, WarTopic } from './model'
import {
  CELLS, CELL_NAME, MAIN, OPPONENT_KIND, STREET, START_ACTION, TOPIC_KIND, cardCatalog, isCell, cellKey, normalizeCellMap, opinionRules, opponentProblems, oppositeOf, readWar, topicKinds,
  topicProblems, type OpponentEntry,
} from './model'
import { passiveMods, modSum } from './mods'
import { Run } from './run'
import { foeFor, isSelfTopic, selfTopic } from './self'

export interface DeskSetup {
  actor: string
  ep?: number
}

export interface OpinionSetup {
  topic: string | Record<string, unknown>
  foe?: string | Record<string, unknown>
  strength?: number
  grade?: number
  desk?: Array<string | DeskSetup>
  /** 要帶進牌庫的料（素材 ft… 或片 cl…） */
  bring?: string[]
  your_start?: string
  rounds?: number
  mode?: 'solo' | 'face'
  /** 副本前面階段拿到的連動（M5-opinion-face 給；效果 link_voice 看） */
  links?: string[]
  /** 委託副本的輿論面（face.ts 給）：哪件委託、第幾個階段、是不是決定性的、委託人 */
  commission?: string
  stage?: number
  decisive?: boolean
  employer?: string
  /** 開場表（face.ts 照 opinion_setup 的 base、from_links 與分支的 open 算好的）：排在 opinion.open 掛點的回答前面 */
  opens?: OpOpen[]
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

export interface Skeleton {
  war: War
  needPreset: boolean
  kindEntry: TopicKindEntry
  yourStart: string | undefined
  /** 被動與開場問回來、格式不對而略過的幾筆（開場時進紀錄提醒） */
  skipped: string[]
  /** 帶進牌庫的料：變成的牌與要併進報告的變更 */
  bring: BringPlan
}

/** 主角的豔名：各區裡最高的那一個（沒有豔名量表是 0）。 */
function fameOf(k: Kernel, state: GameState): number {
  if (!k.meters.has('fame')) return 0
  const keys = isRecord(state.meters.fame) ? Object.keys(state.meters.fame) : []
  return Math.max(0, ...keys.map((key) => meterOf(k, state, 'fame', key)))
}

/** 把 setup 變成還沒開場的戰役（亂數的部分——分數表、洗牌、城市事件——在 openWar 做）。問被動、算編輯台、把要帶的料變成牌也在這裡。 */
export function skeleton(k: Kernel, state: GameState, setup: OpinionSetup, origin: Origin): Skeleton {
  if (!isRecord(setup)) return fail('輿論戰要給 setup：{ topic, foe }。')
  if (readWar(state)) fail('已經有一場輿論戰在進行了。')
  const rules = opinionRules(k)
  const topic = isSelfTopic(setup.topic) ? selfTopic(k, setup.topic) : pickEntry<TopicEntry>(k, TOPIC_KIND, setup.topic, '議題', topicProblems, fillTopic)
  const grade = setup.grade ?? topic.grade ?? 1
  if (!isSafeInt(grade) || grade < 1 || grade > 5) fail('戰役的等級要是 1～5 的整數。')
  const kindEntry = topicKinds(k).find((e) => e.id === topic.kind && e.layout !== undefined)
  if (!kindEntry) return fail(`沒有「${topic.kind}」這種議題類型。`)
  // 沒給對手：攻方的議題找目標勢力的公關；守方的議題（滅火、洗白）勢力是被保護的那一方，對手是別人，用通用公關
  const foe = setup.foe === undefined ? foeFor(k, kindEntry.side === 'defend' ? undefined : topic.involves.factions[0], grade) : pickEntry<OpponentEntry>(k, OPPONENT_KIND, setup.foe, '對手', opponentProblems)
  if (kindEntry.layout === 'main_two' && foe.start === 'center') fail('萬華鏡是平台，不會當滅火的對手。')
  const needPreset = isRecord(topic.scores) && Object.keys(topic.scores).length === 0
  const scores = Object.fromEntries(CELLS.map((c) => [c, 0])) as Record<Cell, number>
  for (const [c, n] of Object.entries(normalizeCellMap<number>(topic.scores))) scores[c as Cell] = n as number
  const strength = setup.strength ?? foe.strength
  if (!isSafeInt(strength) || strength < 1 || strength > 3) fail('強度要是 1～3 的整數。')
  const rounds = setup.rounds ?? topic.rounds ?? rules.rounds
  if (!isSafeInt(rounds) || rounds < 1 || rounds > 12) fail('回合數要是 1～12 的整數。')
  if (setup.mode !== undefined && setup.mode !== 'solo' && setup.mode !== 'face') fail('mode 要是 solo 或 face。')
  if (setup.links !== undefined && !(Array.isArray(setup.links) && setup.links.every((l) => typeof l === 'string'))) fail('links 要是連動的 id 的陣列。')
  if (setup.opens !== undefined && !(Array.isArray(setup.opens) && setup.opens.every((o) => isRecord(o) && typeof o.line === 'string' && typeof o.owner === 'string'))) fail('opens 要是開場表的陣列（每一筆有 owner 與 line）。')
  const target = topic.target_cell === undefined ? undefined : (cellKey(topic.target_cell) as Cell)
  const wTopic: WarTopic = {
    id: topic.id, name: topic.name, kind: topic.kind as KindId, side: kindEntry.side ?? 'attack', scores,
    involves: clone(topic.involves), ...(target ? { target_cell: target } : {}), ...(topic.category ? { category: topic.category } : {}), ...(topic.on_end ? { on_end: clone(topic.on_end) } : {}),
  }
  const priority = Object.fromEntries(CELLS.map((c) => [c, 1])) as Record<Cell, number>
  for (const [c, n] of Object.entries(normalizeCellMap<number>(foe.cell_priority))) priority[c as Cell] = n as number
  const wFoe: WarFoe = {
    id: foe.id, name: foe.name, ...(foe.faction ? { faction: foe.faction } : {}), strength, start: foe.start, cell_priority: priority,
    actions: clone(foe.actions), ...(foe.signature ? { signature: clone(foe.signature) } : {}), once: clone(foe.once ?? []),
    ...(foe.mimic ? { mimic: clone(foe.mimic) } : {}), ...(foe.capture !== undefined ? { capture: foe.capture } : {}),
    ...(foe.capture_when !== undefined ? { capture_when: foe.capture_when } : {}),
    ...(foe.first_capture ? { first_capture: { cell: cellKey(foe.first_capture.cell) as Cell, any_adjacent: foe.first_capture.any_adjacent === true } } : {}),
  }
  const mode = setup.mode ?? 'solo'
  const war: War = {
    id: `o${state.seq.uid + 1}`, mode, topic: wTopic, foe: wFoe, grade, round: 1, rounds, turn: 'you',
    cells: Object.fromEntries(CELLS.map((c) => [c, { owner: null }])) as War['cells'], voice: { you: 0, foe: 0 }, wind: kindEntry.wind ?? 0,
    desk: seatsOf(k, state, setup.desk, []), deck: [], hand: [], discard: [], captured: 0, captures: 1, used: {}, bonus: {},
    foe_state: { bribes: 0, visited: false }, origin: clone(origin),
    passives: [], moves_used: {}, marks: {}, out: [], brought: [], fame: fameOf(k, state), links: [...(setup.links ?? [])],
    // 自己發起：不是委託副本、也不是事件（導演）開的
    self: mode !== 'face' && origin.by !== 'director' && origin.by !== 'commission',
    ...(mode === 'face' ? { face: { commission: setup.commission ?? '', stage: setup.stage ?? 0, decisive: setup.decisive === true, ...(setup.employer !== undefined ? { employer: setup.employer } : {}) } } : {}),
    xcap: [], free_adj: false, defmods: [], cardmods: [], zero_def: [], shield: [], reserved: [],
  }
  // 被動只在開戰時問一次（戰役中途不再問，免得中途換裝備改變規則）；編輯點要算進被動的 ep
  const asked = askPassives(k, state, war, war.desk.map((s) => s.actor))
  war.passives = asked.items
  war.desk = seatsOf(k, state, setup.desk, asked.items)
  war.shield = passiveMods(asked.items, 'shield', null).map((m) => ({ what: ([] as unknown[]).concat(m.what).map(String), left: m.n ?? 1 }))
  const bring = planBring(k, state, wTopic, setup.bring, asked.items)
  if (bring.cards.length > 0) {
    war.custom = Object.fromEntries(bring.cards.map((b) => [b.card.id, b.card])) as Record<string, WarCard>
    war.brought = bring.cards.map((b) => ({ ref: b.ref, card: b.card.id }))
  }
  return { war, needPreset, kindEntry, yourStart: setup.your_start ?? topic.your_start, skipped: asked.skipped, bring }
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

/** 開場：問開場的加成、放格子、洗牌（基本牌加帶進來的料）、抽牌、第一回合。回傳 opinion.start 的報告草稿。 */
export function startDraft(k: Kernel, state: GameState, setup: OpinionSetup, origin: Origin): ReportDraft {
  const { war, needPreset, kindEntry, yourStart, skipped, bring } = skeleton(k, state, setup, origin)
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

  // 牌庫：目錄裡每一種基本牌放 basic 張，加上帶進來的料與開場多給的牌，洗牌
  const deskIds = w.desk.map((s) => s.actor)
  const asked = askOpen(k, state, w.topic, w.foe, deskIds)
  // 開場表：副本給的（底子、拿到的連動、分支的加減）排在前面，最後才是 opinion.open 掛點的回答
  const opens = { ...asked, items: [...(setup.opens ?? []), ...asked.items] }
  const basics = cardCatalog(k).flatMap((c) => Array.from({ length: c.basic ?? 0 }, () => c.id))
  const extra: string[] = []
  const notes: string[] = [...skipped, ...opens.skipped]
  for (const o of opens.items) {
    for (const id of o.cards ?? []) {
      if (cardCatalog(k).some((c) => c.id === id)) extra.push(id)
      else notes.push(`開場（${o.owner}）要加的牌「${id}」不在牌庫的目錄裡（這一張略過了）。`)
    }
  }
  // 自己發起、訂閱夠多：採訪的聲量 +1（V34）
  if (w.self && k.meters.has('subs') && meterOf(k, state, 'subs') >= rules.self.subs_at && rules.self.interview_plus > 0) {
    const card = cardCatalog(k).find((c) => c.id === 'card_interview')
    if (card?.voice !== undefined) w.custom = { ...(w.custom ?? {}), [card.id]: { id: card.id, name: card.name, kind: card.kind, cost: card.cost, voice: card.voice + rules.self.interview_plus } }
  }
  w.deck = run.shuffle([...basics, ...w.brought.map((b) => b.card), ...extra])
  run.changes.push(...bring.changes)
  const kindName = kindEntry.name ?? kindEntry.id
  const pr = prPoints(run)
  run.note(`輿論戰開始：議題「${w.topic.name}」（${kindName}），${w.rounds} 回合。對手「${w.foe.name}」，強度 ${w.foe.strength}，每回合 ${pr} 點公關點。`, {
    tag: 'opinion.start', data: { topic: w.topic.id, kind: w.topic.kind, foe: w.foe.id, strength: w.foe.strength, pr, grade: w.grade, rounds: w.rounds, mode: w.mode, desk: deskIds, brought: w.brought.map((b) => b.ref) },
    plain: `一場輿論戰開打了，議題是「${w.topic.name}」，對手是「${w.foe.name}」。`,
  })
  for (const text of notes) run.note(text, { tag: 'opinion.notice' })
  run.note(`你從${pos.you.map((c) => `「${CELL_NAME[c]}」`).join('、')}開場；對手從${pos.foe.map((c) => `「${CELL_NAME[c]}」`).join('、')}開場。${w.wind !== 0 ? `風向 ${w.wind}。` : ''}`, {
    tag: 'opinion.layout', data: { you: pos.you, foe: pos.foe, wind: w.wind, scores: w.topic.scores },
  })
  if (w.brought.length > 0) {
    run.note(`你帶了 ${w.brought.length} 件料進牌庫：${w.brought.map((b) => `「${run.cardName(b.card)}」`).join('、')}（每件用掉 1 次）。`, {
      tag: 'opinion.bring', data: { brought: w.brought }, plain: '你把手上的料放進了牌庫。',
    })
  }

  // 開場的加成：被動的 open_*、開場表（opinion.open）；格子要是沒人的才佔
  let hand = rules.open_hand + modSum(w, 'open_hand', run.env) + openHandBonus(k, state, deskIds)
  const fx = { voice: modSum(w, 'open_voice', run.env), wind: modSum(w, 'open_wind', run.env) }
  if (fx.voice !== 0 || fx.wind !== 0 || modSum(w, 'open_hand', run.env) !== 0) {
    run.note(`開場的加成：${fx.voice !== 0 ? `聲量 ${fx.voice >= 0 ? '+' : '−'}${Math.abs(fx.voice)}。` : ''}${fx.wind !== 0 ? `風向 ${fx.wind >= 0 ? '+' : '−'}${Math.abs(fx.wind)}。` : ''}${modSum(w, 'open_hand', run.env) !== 0 ? `手牌 ${modSum(w, 'open_hand', run.env) >= 0 ? '+' : '−'}${Math.abs(modSum(w, 'open_hand', run.env))}。` : ''}`, { tag: 'opinion.open', data: { owner: 'passives', ...fx } })
  }
  run.addVoice('you', fx.voice)
  run.addWind(fx.wind)
  for (const o of opens.items) {
    const taken: Cell[] = []
    for (const raw of o.cells ?? []) {
      const c = cellKey(raw)
      if (isCell(c) && w.cells[c].owner === null) {
        w.cells[c] = { owner: 'you' }
        taken.push(c)
      }
    }
    run.addVoice('you', o.voice ?? 0)
    run.addWind(o.wind ?? 0)
    hand += o.hand ?? 0
    if (o.foe_pr_first) w.foe_state.pr_mod = (w.foe_state.pr_mod ?? 0) - o.foe_pr_first
    run.note(`${o.line}。`.replace(/。+$/, '。'), { tag: 'opinion.open', data: { owner: o.owner, ...(o.voice ? { voice: o.voice } : {}), ...(o.wind ? { wind: o.wind } : {}), ...(taken.length > 0 ? { cells: taken } : {}), ...(o.foe_pr_first ? { foe_pr_first: o.foe_pr_first } : {}) } })
  }
  const dealt = run.draw(Math.max(0, hand))
  run.note(`開場的手牌：${dealt.map((id) => `「${run.cardName(id)}」`).join('、') || '（沒有牌）'}。`, { tag: 'opinion.draw', data: { cards: dealt } })
  beginTurn(run)
  return run.draft(START_ACTION, 'started', run.beats.map((b) => b.text).join(''), { extra: [{ op: 'uid', advance: 1 }] })
}
