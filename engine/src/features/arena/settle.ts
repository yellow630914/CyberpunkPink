// L6 功能 arena 的勝負與結算（LEWD_SYSTEM 第 6 節；EVENTS 4.7 節；dev/adr/0019 P62；dev/work/M4-venues.md 第 6、7 點）。
//
// 勝負：任何一方第一次過載（戰鬥的掛點 overload）這一場就結束：對方過載是贏、主角過載是輸。
//   結束用戰鬥自己的結果（贏 win、輸 lose），輸贏另外記在 battle.field.arena（'won' 或 'lost'，站在主角那一邊說）。
//   不走戰敗的三選一：開戰時帶 field.safe（defeat 認它：不留等著選的戰敗，只把開打前的快照丟掉），這裡在戰鬥結束時再丟一次（battle.onEnd），
//   所以 defeat 沒裝時也一樣乾淨；餘韻那一層照規則留著（過載的人身上多一層）。
//   餘韻疊滿再過載是「昏過去」（沒有 overload 這個掛點）：走戰鬥自己分出的結果，同一條路。
// 結算（掛點 activity.end，kind 是 battle、origin.by 是 arena）：贏了拿押的 × 賠率，輸了押的沒了（錢不夠押就扣到 0）；
//   沒有打完（不是 win、lose、surrender）押的錢不動；這一區的豔名 +1（有量表才加）；寫一筆 announce，報告掛鉤（report.after）發 arena.result。

import type { ActivityEndReturn, BattleRun, Change, GameState, Kernel, Origin, ReportDraft, TimelineBeat } from '../../core'
import { clone, effectCtx, formatAmount, isRecord, isSafeInt } from '../../core'
import type { Announce } from './model'
import { EXT, FIELD_KEY, LOST, OWNER, RESULT_ACTION, RESULT_POINT, WON, readArena } from './model'

const FAME = 'fame'

const isArenaBattle = (run: Pick<BattleRun, 'battle'>): boolean => run.battle.origin.ext?.by === OWNER

/** 主角這一邊的那個人（擂台只有一個）。 */
const arenaOf = (battle: { origin: { ext?: Record<string, unknown> } }): { stake: number; odds: number; grade: number; foe: string } | null => {
  const a = battle.origin.ext?.arena
  if (!isRecord(a) || !isSafeInt(a.stake) || typeof a.odds !== 'number') return null
  return { stake: a.stake, odds: a.odds, grade: isSafeInt(a.grade) ? a.grade : 1, foe: typeof a.foe === 'string' ? a.foe : '對手' }
}

/** 掛上戰鬥裡的兩個掛點：第一次過載就分出勝負；自然分出的結果（昏過去）也記下輸贏。 */
export function installBattle(k: Kernel): void {
  k.battle.on('overload', OWNER, ({ run, unit }) => {
    if (!isArenaBattle(run) || run.battle.result) return
    const mine = unit.side === 'ally'
    run.battle.field[FIELD_KEY] = mine ? LOST : WON
    run.say(mine ? `${unit.name}先過載了：這一場輸了。` : `${unit.name}先過載了：這一場贏了。`, undefined, { arena: mine ? LOST : WON, unit: unit.id }, unit)
    run.finish(mine ? 'lose' : 'win', mine ? '擂台：你先過載，輸了。' : '擂台：對手先過載，你贏了。')
  })
  k.battle.on('battle.result', OWNER, ({ run, outcome }) => {
    if (!isArenaBattle(run) || run.battle.field[FIELD_KEY] !== undefined) return
    run.battle.field[FIELD_KEY] = outcome === 'win' ? WON : LOST
  })
  // 這一場輸了也不留等著三選一的戰敗（defeat 沒裝、或不認 field.safe 時也一樣）
  k.battle.onEnd(OWNER, ({ battle }) => (battle.origin.ext?.by === OWNER ? { changes: [{ op: 'snapshot.drop', kind: 'battle' }] } : undefined))
}

/** 戰鬥結束的結算（activity.end）：錢、豔名，記下 announce 讓報告掛鉤發 arena.result。 */
export function onBattleEnd(k: Kernel, state: GameState, origin: Origin, outcome: string): ActivityEndReturn | void {
  if (origin.by !== OWNER) return
  const a = arenaOf({ origin: { ext: { arena: origin.ext?.arena } } })
  if (!a) return
  const done = outcome === 'win' || outcome === 'lose' || outcome === 'surrender'
  const won = outcome === 'win'
  const delta = !done ? 0 : won ? Math.floor(a.stake * a.odds) : -Math.min(a.stake, state.money.cash)
  const changes: Change[] = []
  const lines: string[] = []
  if (delta !== 0) changes.push({ op: 'cash', delta })
  // 這一區的豔名 +1（有量表才加）
  if (done && k.effects.has(FAME)) {
    const res = k.effects.resolve([{ kind: FAME, amount: 1 }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length === 0) {
      changes.push(...res.changes)
      lines.push(...res.lines)
    }
  }
  const rec = readArena(state)
  const announce: Announce = { won: done && won, void: !done, stake: a.stake, odds: a.odds, delta, foe: a.foe, grade: a.grade }
  changes.push({
    op: 'ext', key: EXT,
    value: { wins: rec.wins + (done && won ? 1 : 0), losses: rec.losses + (done && !won ? 1 : 0), announce } as unknown as Record<string, unknown>,
  })
  if (delta > 0) lines.push(`押的錢贏了 ${formatAmount(delta)}`)
  else if (delta < 0) lines.push(`押的錢輸掉了 ${formatAmount(-delta)}`)
  return { changes, lines }
}

/** 剛打完一場：發 arena.result（觸發點 arena_result，where.won；沒有打完的只記一筆、沒有觸發點）；沒有要寫的是 null。 */
export function announceDraft(state: GameState): ReportDraft | null {
  const rec = readArena(state)
  const a = rec.announce
  if (!a) return null
  const pc = state.pc
  const text = a.void
    ? `你和${a.foe}的擂台沒有打完，押的錢沒有動。`
    : a.won
      ? `你在擂台上贏了${a.foe}${a.delta > 0 ? `，拿到 ${formatAmount(a.delta)}` : ''}。`
      : `你在擂台上輸給了${a.foe}${a.delta < 0 ? `，押的 ${formatAmount(-a.delta)} 沒了` : ''}。`
  const beats: TimelineBeat[] = [{ layer: 'meat', ...(pc ? { actor: pc } : {}), text, tag: RESULT_ACTION, data: { won: a.won, stake: a.stake, odds: a.odds, delta: a.delta, foe: a.foe } }]
  return {
    kind: 'combat', action: RESULT_ACTION, location: clone(state.location), ...(pc ? { actor: pc } : {}), party: [],
    timeline: beats,
    changes: [{ op: 'ext', key: EXT, value: { wins: rec.wins, losses: rec.losses, announce: null } as unknown as Record<string, unknown> }],
    outcome: { result: a.void ? 'void' : a.won ? 'won' : 'lost', summary: text }, narration: { results: [text] },
    ...(a.void ? {} : { triggers: [{ point: RESULT_POINT, where: { won: a.won ? 'true' : 'false', ...(state.location.district ? { district: state.location.district } : {}) } }] }),
  }
}
