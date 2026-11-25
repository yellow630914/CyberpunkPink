// L6 功能 cyberware 的修理（DOWNTIME 3.1 節最後一條「機械義體壞了：修理費＝零件價的 20%，或在工作台自己修（義體學 DC 13）」；dev/work/M4-cyber-lock.md 第 9 條）。
// 壞掉的那一件（off.why 是 broken：破解大失敗、之後的事件）修好：
//   診所（正規、無照、黑診所都收同樣的修理費）：成品價 × repair_fee（兩成）；不擲骰、一定修好。
//   自己修：要在有工作台的住處（條件 at_home 帶 level_min：repair_home_level，預設 2）或診所；動手的人是主角或隊上的人；擲技術＋義體學對 repair_dc（13）：
//     成功與大成功修好；失敗與大失敗只花掉時間（東西還是壞的）。
// 修好把 off 拿掉；訂閱還欠著錢（lock.owed > 0）的修好之後仍然是鎖住的（不能靠修理繞過補繳）。報告 cyber.repair。

import type { ActorId, Change, CheckRoll, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, clone, dcFor, rollCheck } from '../../core'
import { BROKEN_OFF, LOCK_OFF, pieceName, piecePrice, readLock, writePieces } from './lock'
import type { CyberPiece, SurgeonKind } from './model'
import { SURGEON_NAME, cyberOf, cyberRules, isSurgeonKind } from './model'
import type { Pool } from './surgery'
import { SELF_ATTR, clinicHere, moneyProblem, nameOf, payPool } from './surgery'

export const REPAIR_ACTION = 'cyber.repair'

export interface RepairOpts {
  actor: ActorId
  /** 身上那一件的 uid */
  uid: string
  /** 診所（clinic、unlicensed、black）或自己修 */
  via: SurgeonKind
  /** 動手的人（只有自己修看它；預設被修的人自己） */
  by?: ActorId
  pay?: Pool
}

export interface RepairQuote {
  uid: string
  bp: string
  name: string
  via: SurgeonKind
  /** 成品價 */
  price: number
  /** 修理費（自己修是 0） */
  fee: number
  pay: Pool | null
  minutes: number
  /** 自己修的 DC 與加值 */
  self?: { by: ActorId; skill: string; dc: number; bonus: number }
}

interface RepairPlan {
  problems: string[]
  quote: RepairQuote | null
  piece?: CyberPiece
}

const inParty = (state: GameState, who: ActorId): boolean => !!state.actors[who] && (who === state.pc || state.party.includes(who))

/** 自己修的地方：診所，或有工作台的住處。 */
function selfPlaceBlock(k: Kernel, state: GameState, level: number): string | null {
  if (clinicHere(k, state)) return null
  if (k.conditions.kinds().includes('at_home') && k.conditions.test({ kind: 'at_home', level_min: level }, { state, stats: k.stats, timeRules: k.timeRules })) return null
  return '自己修要在有工作台的住處（二級以上）或診所。'
}

function planRepair(k: Kernel, state: GameState, o: RepairOpts): RepairPlan {
  const problems: string[] = []
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isSurgeonKind(o.via)) return { problems: ['要說是誰修。'], quote: null }
  const act = k.activity.blockOf(state, `commit:${REPAIR_ACTION}`)
  if (act) problems.push(act)
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  if (!piece) return { problems: [...problems, '身上沒有這一件義體。'], quote: null }
  const name = pieceName(k, piece)
  if (piece.off?.why !== BROKEN_OFF) problems.push(`${name}沒有壞。`)

  if (o.via === 'self') {
    if (!state.actors[by]) problems.push('找不到動手的人。')
    else if (!inParty(state, by)) problems.push('動手的人要是主角或隊上的人。')
    const place = selfPlaceBlock(k, state, rules.repair_home_level)
    if (place) problems.push(place)
  } else if (clinicHere(k, state)?.grade !== o.via) problems.push(`這裡沒有${SURGEON_NAME[o.via]}。`)

  const price = piecePrice(k, piece)
  const fee = o.via === 'self' ? 0 : Math.round(price * rules.repair_fee + 1e-9)
  const mp = moneyProblem(state, fee, o.pay, '修理費')
  if (mp) problems.push(mp)
  const quote: RepairQuote = { uid: o.uid, bp: piece.bp, name, via: o.via, price, fee, pay: payPool(state.money, fee, o.pay), minutes: rules.surgery_minutes }
  if (o.via === 'self' && state.actors[by]) {
    const parts = checkParts(k.stats, state, by, { attr: SELF_ATTR, skill: rules.self_skill, tags: ['repair'] })
    quote.self = { by, skill: rules.self_skill, dc: dcFor(rules.repair_dc, state.rules), bonus: parts.reduce((s, p) => s + p.value, 0) }
  }
  return { problems, quote, piece }
}

export const repairProblems = (k: Kernel, state: GameState, o: RepairOpts): string[] => planRepair(k, state, o).problems
export const repairBlock = (k: Kernel, state: GameState, o: RepairOpts): string | null => planRepair(k, state, o).problems[0] ?? null
export const repairQuote = (k: Kernel, state: GameState, o: RepairOpts): RepairQuote | null => planRepair(k, state, o).quote

/** 修一件壞掉的義體。不成立丟 ActionBlocked（repairProblems 的第一條）。報告 cyber.repair：outcome.result 是 repaired 或 failed（自己修沒修成，時間照過）。 */
export function repairDraft(k: Kernel, state: GameState, o: RepairOpts): ReportDraft {
  const plan = planRepair(k, state, o)
  if (plan.problems.length > 0 || !plan.quote || !plan.piece) throw new ActionBlocked(plan.problems[0] ?? '現在修不了。')
  const q = plan.quote
  const piece = plan.piece
  const by = o.by ?? o.actor
  const rules = cyberRules(k)
  const patient = nameOf(state, o.actor)
  const changes: Change[] = []
  let roll: CheckRoll | undefined
  let fixed = true
  if (q.self) {
    roll = rollCheck(k.stats, state, { actor: by, attr: SELF_ATTR, skill: rules.self_skill, dc: q.self.dc, purpose: `${REPAIR_ACTION}/${q.uid}`, tags: ['repair'] })
    fixed = roll.degree === 'critical' || roll.degree === 'success'
    changes.push({ op: 'rng', advance: 1 })
  }
  changes.push({ op: 'time', minutes: q.minutes })
  if (q.fee > 0) changes.push({ op: q.pay!, delta: -q.fee })
  const who = q.via === 'self' ? (by !== o.actor ? `${nameOf(state, by)}替${patient}修` : `${patient}自己修`) : `${patient}在${SURGEON_NAME[q.via]}修`
  const lines: string[] = []
  if (fixed) {
    const stillOwed = (readLock(piece.lock)?.owed ?? 0) > 0
    changes.push(writePieces(state, o.actor, cyberOf(state, o.actor).map((p) => {
      if (p.uid !== piece.uid) return p
      const { off: _off, ...rest } = p
      void _off
      return (stillOwed ? { ...rest, off: { why: LOCK_OFF } } : rest) as CyberPiece
    })))
    lines.push(`${who}${q.name}，修好了。`)
    if (stillOwed) lines.push('訂閱還欠著錢，授權鎖還在。')
  } else lines.push(`${who}${q.name}，折騰了半天沒有修好，時間白花了。`)
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: by, text: lines[0]!, tag: REPAIR_ACTION, data: { uid: q.uid, bp: q.bp, via: q.via, fee: q.fee, fixed } }]
  if (roll) beats.push({ layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'cyber.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: REPAIR_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: fixed ? 'repaired' : 'failed', summary: lines.join('') }, narration: { results: lines },
  }
}
