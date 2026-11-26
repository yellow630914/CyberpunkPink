// 外包（OPINION 第 7 節「沒有人」那一列；dev/adr/0020 第六節）：選了輿論面但不想自己打時，指定名冊上一個不在隊伍裡的人（NPC 記者）：
// 不開棋盤，d20 ＋ 他表演、調查、交涉裡最高的基本功 ＋ 分量修正（媒體型 +4、社交型 +2，照他的路數）對 DC（10 ＋ 強度 × 3）：
// 超過 gap（5）以上大勝、成功小勝、差不到 gap 平手、其餘敗。結果照一般的方式交回（活動 face.opinion 的 activity.end）：
//   不是決定性的、或決定性而且小勝以上：直接發 activity.end；
//   決定性而且平手或敗（V37）：不發，留著一份沒有棋盤的戰役（pending: 'lost'），等三選一（lost.ts）——「重來」等於再擲一次但骰子換了。
// 那個人要有空：沒有 busy、injured、lying_low、arrested、recovering（M4 手術後休養，暫定 V65），在名冊上（條件 in_roster，有人註冊才問），不在隊伍裡。

import type { GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, isRecord, toMinutes } from '../../core'
import type { FaceSetup } from './faceopen'
import { faceOpenSetup, snapshotChange } from './faceopen'
import { LOST_CHOICE_TEXT } from './cards'
import type { Outcome, WarResult } from './model'
import { OUTSOURCE_ACTION, opinionRules, pathsOf, readWar } from './model'
import { Run, outcomeName } from './run'
import { skeleton } from './start'
import { closeDraft } from './turn'

/** 請不動的狀況（和派工、召集同一組字彙；recovering 是手術後休養）。 */
const BUSY_CONDITIONS = ['busy', 'injured', 'lying_low', 'arrested', 'recovering'] as const
const BUSY_TEXT: Record<(typeof BUSY_CONDITIONS)[number], (name: string) => string> = {
  busy: (n) => `${n}現在有別的事在忙。`,
  injured: (n) => `${n}受傷了，這陣子請不動。`,
  lying_low: (n) => `${n}正在躲風頭。`,
  arrested: (n) => `${n}被關起來了。`,
  recovering: (n) => `${n}還在手術後的休養，這陣子請不動。`,
}

const hasCondition = (state: Pick<GameState, 'actors' | 'time'>, id: string, condition: string): boolean => {
  const a = Object.hasOwn(state.actors, id) ? state.actors[id] : undefined
  if (!a) return false
  const now = toMinutes(state.time)
  return a.conditions.some((c) => c.id === condition && (c.until === undefined || c.until > now))
}

export interface OutsourceOdds {
  actor: string
  strength: number
  dc: number
  /** 他的基本功：用哪一項、幾級（取最高） */
  skill: { id: string | null; level: number }
  /** 分量修正：媒體型 +4、社交型 +2（取他最高的一條路數；沒有是 0） */
  weight: number
  /** 擲骰加上去的合計（基本功 ＋ 分量） */
  bonus: number
  /** 四個結果各自的機率（百分比；加起來 100） */
  chance: Record<Outcome, number>
}

/** 他的能力：基本功與分量修正。 */
function abilityOf(state: GameState, actor: string, skills: string[], weights: Record<string, number>): { skill: { id: string | null; level: number }; weight: number } {
  const a = state.actors[actor]!
  let skill: { id: string | null; level: number } = { id: null, level: 0 }
  for (const s of skills) {
    const level = a.skills[s] ?? 0
    if (skill.id === null || level > skill.level) skill = { id: s, level }
  }
  let weight = 0
  let seen = false
  for (const p of pathsOf(state, actor)) {
    if (!Object.hasOwn(weights, p.path)) continue
    weight = seen ? Math.max(weight, weights[p.path]!) : weights[p.path]!
    seen = true
  }
  return { skill, weight }
}

/** 一顆骰子加上 bonus 對 dc 是哪一級。 */
export function outsourceOutcome(natural: number, bonus: number, dc: number, gap: number): Outcome {
  const margin = natural + bonus - dc
  return margin >= gap ? 'major' : margin >= 0 ? 'minor' : margin > -gap ? 'draw' : 'lost'
}

/** 對手的強度：給數字就是它；給副本的 setup 就照開場會用的那一套解（議題與對手的資料）。 */
function strengthOf(k: Kernel, state: GameState, from: number | FaceSetup): number {
  if (typeof from === 'number') return from
  const origin: Origin = { by: 'commission', ref: from.commission }
  return skeleton(k, state, { ...faceOpenSetup(k, from), bring: undefined, desk: undefined }, origin).war.foe.strength
}

/**
 * 這個人去打的勝算（純函式）：DC、他的基本功與分量修正、四個結果各自的機率。strength 給數字，或給副本的 setup。
 * 不檢查他有沒有空（outsourceBlock 管）；查不到這個人丟 ActionBlocked。
 */
export function outsourceChance(k: Kernel, state: GameState, from: number | FaceSetup, actor: string): OutsourceOdds {
  if (!Object.hasOwn(state.actors, actor)) throw new ActionBlocked('查不到這個人。')
  const rule = opinionRules(k).outsource
  const strength = strengthOf(k, state, from)
  const dc = rule.dc_base + rule.dc_per_strength * strength
  const ab = abilityOf(state, actor, rule.skills, rule.weight)
  const bonus = ab.skill.level + ab.weight
  const count: Record<Outcome, number> = { major: 0, minor: 0, draw: 0, lost: 0 }
  for (let n = 1; n <= 20; n++) count[outsourceOutcome(n, bonus, dc, rule.gap)]++
  const chance = Object.fromEntries((Object.keys(count) as Outcome[]).map((o) => [o, count[o] * 5])) as Record<Outcome, number>
  return { actor, strength, dc, skill: ab.skill, weight: ab.weight, bonus, chance }
}

/** 現在能不能把這一場外包給他：不成立的第一個原因（一句完整的話，一條一個條件）；可以是 null。 */
export function outsourceBlock(k: Kernel, state: GameState, setup: FaceSetup, actor: string): string | null {
  if (readWar(state)) return '已經有一場輿論戰在進行了。'
  if (typeof actor !== 'string' || !Object.hasOwn(state.actors, actor)) return '查不到這個人。'
  const a = state.actors[actor]!
  if (actor === state.pc) return '主角自己要打就自己坐編輯台，不用外包。'
  if (state.party.includes(actor)) return `${a.name}在你的隊上，隊上的人直接坐編輯台就好，不用外包。`
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  if (k.conditions.kinds().includes('in_roster') && !k.conditions.test({ kind: 'in_roster', who: actor } as never, ctx)) return `${a.name}不在你的名冊上。`
  for (const c of BUSY_CONDITIONS) if (hasCondition(state, actor, c)) return BUSY_TEXT[c](a.name)
  try {
    strengthOf(k, state, setup)
  } catch (e) {
    if (e instanceof ActionBlocked) return e.message
    throw e
  }
  return k.activity.blockOf(state, `commit:${OUTSOURCE_ACTION}`)
}

/**
 * 外包的結算（opinion.outsource）：回傳報告草稿。決定性而且沒贏：留一份沒有棋盤的戰役等三選一（第一筆變更是 snapshot.take）；其餘直接發 activity.end。
 * 活動 face.opinion 的 start 在 setup.outsource 有人時也走這裡。
 */
export function outsourceDraft(k: Kernel, state: GameState, setup: FaceSetup, actor: string, origin: Origin = { by: 'commission', ref: setup?.commission }): ReportDraft {
  if (!isRecord(setup)) throw new ActionBlocked('輿論面的 setup 要是一個物件。')
  const block = outsourceBlock(k, state, setup, actor)
  if (block) throw new ActionBlocked(block)
  // 沒有棋盤：用開場會用的議題與對手做一份空的戰役殼（交回的 result 與棋盤打的一樣），座位是主角
  const open = { ...faceOpenSetup(k, setup), bring: undefined, desk: undefined }
  const { war } = skeleton(k, state, open, origin)
  const run = new Run(k, state, war, 'outsource')
  const w = run.w
  const rule = run.rules.outsource
  const odds = outsourceChance(k, state, w.foe.strength, actor)
  const natural = run.rng.int(1, 20)
  const outcome = outsourceOutcome(natural, odds.bonus, odds.dc, rule.gap)
  const total = natural + odds.bonus
  const name = state.actors[actor]!.name
  const result: WarResult = {
    outcome, by: 'outsource', you: 0, foe: 0, target_held: null,
    outsourced: { actor, roll: natural, total, dc: odds.dc, skill: odds.skill.level, weight: odds.weight },
  }
  w.result = result
  w.turn = 'ended'
  if (w.face) w.face.outsourced = true
  run.note(`你把這一場外包給${name}，沒有開棋盤：骰 ${natural}，加上他的基本功 ${odds.skill.level}、分量 ${odds.weight}，合計 ${total}，對 DC ${odds.dc}，結果是${outcomeName(outcome)}。`, {
    tag: 'opinion.outsource', actor, data: { actor, roll: natural, total, dc: odds.dc, skill: odds.skill, weight: odds.weight, outcome },
    plain: `${name}替你上場打了這一仗。`,
  })
  const decisive = setup.decisive === true
  if (decisive && (outcome === 'draw' || outcome === 'lost')) {
    w.pending = 'lost'
    run.note(LOST_CHOICE_TEXT, { tag: 'opinion.lost' })
    return run.draft(OUTSOURCE_ACTION, 'lost_choice', run.beats.map((b) => b.text).join(''), { first: [snapshotChange(setup, origin)], extra: [{ op: 'uid', advance: 1 }] })
  }
  const d = closeDraft(run, OUTSOURCE_ACTION)
  d.changes.push({ op: 'uid', advance: 1 })
  return d
}
