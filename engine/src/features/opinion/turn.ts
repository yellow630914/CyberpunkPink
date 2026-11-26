// 玩家的動作與回合的流程：佔領（opinion.capture）、結束回合（opinion.turn：對手的整個回合與下一回合的城市事件、抽牌都在這一份）、
// 回應收買（opinion.bribe）、認輸（opinion.concede）、結算（opinion.end；發 activity.end）。
// 一方的格子被清空、或最後一回合對手動完，戰役標成結束（turn: 'ended'，result 算好），要玩家按「結算」（opinion.end）才交回活動；
// 認輸與收下收買是玩家自己的決定，直接結算。

import type { GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, attachActivityEnd, endActivity } from '../../core'
import { applicableDefMods, cellsOwnedBy, planCapture } from './board'
import { warBlock } from './cards'
import { consequences } from './after'
import { beginTurn, reservables } from './fx'
import { checkOnce, foeTurn } from './foe'
import type { Cell } from './model'
import { ACTIVITY, BRIBE_ACTION, CAPTURE_ACTION, CELLS, CELL_NAME, CONCEDE_ACTION, END_ACTION, TURN_ACTION, isCell, opinionRules, readWar } from './model'
import { modsOf } from './mods'
import { Run, credOf, resultPlain, resultText } from './run'

// ---- 佔領 ----

export interface CaptureInput {
  cell: string
}

export function captureBlockOf(k: Kernel, state: GameState, input: CaptureInput): string | null {
  const war = readWar(state)
  const b = warBlock(war)
  if (b) return b
  const w = war!
  if (!isCell(input.cell)) return `「${input.cell}」不是格子的 id（${CELLS.join('、')}）。`
  const r = planCapture(w, input.cell, opinionRules(k), { cred: credOf(k, state) })
  return 'why' in r ? r.why : k.activity.blockOf(state, `commit:${CAPTURE_ACTION}`)
}

export function captureDraft(k: Kernel, state: GameState, input: CaptureInput): ReportDraft {
  const block = captureBlockOf(k, state, input)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), `capture/${input.cell}`)
  const w = run.w
  const cell = input.cell as Cell
  const was = w.cells[cell].owner
  const r = planCapture(w, cell, run.rules, run.env)
  if ('why' in r) throw new ActionBlocked(r.why)
  const def = r.plan.def
  // 用掉的次數與加減：下一次的 def_mod 拿掉、這一次佔的是原本那一次還是多佔的、每場第一次佔沒人的格子、某一格只算一次的加減
  const spent = applicableDefMods(w, cell).filter((i) => w.defmods[i]!.scope === 'next')
  w.defmods = w.defmods.filter((_, i) => !spent.includes(i))
  if (r.plan.slot === 'base') w.base_used = true
  else w.xcap.splice(r.plan.slot, 1)
  if (was === null && modsOf(w, 'def_first_empty', run.env).length > 0) w.moves_used['war:first_empty'] = (w.moves_used['war:first_empty'] ?? 0) + 1
  if (modsOf(w, 'def_cell', run.env).some((m) => m.cell === cell && m.once === true)) w.moves_used[`war:def_cell:${cell}`] = (w.moves_used[`war:def_cell:${cell}`] ?? 0) + 1
  w.voice.you -= def
  w.cells[cell] = { owner: 'you' }
  w.captured++
  run.note(`你${was === 'foe' ? '從對手手上搶下' : '佔領'}「${CELL_NAME[cell]}」（花聲量 ${def}，${w.topic.scores[cell] + (w.bonus[cell] ?? 0)} 分；聲量剩 ${w.voice.you}）。`, {
    tag: 'opinion.capture', data: { cell, def, from: was, voice: w.voice.you }, plain: was === 'foe' ? '你從對手手上搶下了一格。' : '你佔下了一格。',
  })
  let result = 'captured'
  if (cellsOwnedBy(w, 'foe').length === 0) {
    run.finish('wipe')
    result = 'ended'
  }
  return run.draft(CAPTURE_ACTION, result, run.beats.map((b) => b.text).join(''))
}

// ---- 結束回合 ----

export interface EndTurnInput {
  /** 預留給反應的編輯點（reservables 列出的 key）：有 cost 的反應從這回合沒用完的編輯點扣 */
  reserve?: string[]
}

export function endTurnBlock(k: Kernel, state: GameState, input: EndTurnInput = {}): string | null {
  const war = readWar(state)
  const b = warBlock(war)
  if (b) return b
  if (input.reserve !== undefined && input.reserve.length > 0) {
    const run = new Run(k, state, war, 'turn')
    const left = reservables(run)
    const seen = new Set<string>()
    for (const key of input.reserve) {
      const r = left.find((x) => x.key === key)
      if (!r) return `沒有這個可以預留的反應「${key}」。`
      if (seen.has(key)) return `「${r.name}」只能預留一次。`
      seen.add(key)
    }
    // 一個一個扣：兩個反應不能共用同一點編輯點
    const seats = run.w.desk.map((s) => ({ ...s }))
    for (const key of input.reserve) {
      const r = left.find((x) => x.key === key)!
      if (r.reason && !r.can) return r.reason
      const seat = seats.find((s) => s.actor === r.seat && s.ep >= r.cost) ?? seats.find((s) => s.ep >= r.cost)
      if (!seat) return `編輯點不夠：「${r.name}」要預留 ${r.cost} 點，剩下的不夠了。`
      seat.ep -= r.cost
    }
  }
  return k.activity.blockOf(state, `commit:${TURN_ACTION}`)
}

/** 對手的回合做完之後：最後一回合就結算，不然開下一回合。 */
function advance(run: Run): void {
  const w = run.w
  foeTurn(run)
  if (w.turn === 'ended') return
  if (w.round >= w.rounds) run.finish('rounds')
  else {
    w.round++
    beginTurn(run)
  }
}

export function endTurnDraft(k: Kernel, state: GameState, input: EndTurnInput = {}): ReportDraft {
  const block = endTurnBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), 'turn')
  const w = run.w
  run.note(`你結束了第 ${w.round} 回合。`, { tag: 'opinion.end_turn', data: { round: w.round } })
  // 預留編輯點給有 cost 的反應（從這回合沒用完的編輯點扣；預留了沒發動就白白浪費）
  for (const key of input.reserve ?? []) {
    const r = reservables(run).find((x) => x.key === key)!
    const seat = w.desk.find((s) => s.actor === r.seat && s.ep >= r.cost) ?? w.desk.find((s) => s.ep >= r.cost)!
    seat.ep -= r.cost
    w.reserved.push({ key, seat: seat.actor, cost: r.cost })
    run.note(`你替「${r.name}」預留了 ${r.cost} 點編輯點。`, { tag: 'opinion.reserve', data: { key, cost: r.cost, seat: seat.actor }, plain: `你替「${r.name}」留了一手。` })
  }
  const once = checkOnce(run)
  if (once && once.rule.do === 'bribe') {
    w.pending = 'bribe'
    w.offer = once.price!
    w.foe_state.bribes++
    run.note(`對手開價收買：C$${w.offer.toLocaleString('en-US')}，條件是你撤稿。收下，戰役就算你敗；回絕，照常打下去。`, {
      tag: 'opinion.foe.bribe', data: { price: w.offer, times: w.foe_state.bribes }, plain: '對手開出了價碼，要你收手。',
    })
    return run.draft(TURN_ACTION, 'bribe_offer', run.beats.map((b) => b.text).join(''))
  }
  if (once && once.rule.do === 'visit') {
    w.pending = 'visit'
    w.foe_state.visited = true
    run.note(`對手找上門了：${once.rule.squad ?? '一隊人'}往編輯台去。`, { tag: 'opinion.foe.visit', data: { squad: once.rule.squad ?? null }, plain: '對手的人找上門來了。' })
    return run.draft(TURN_ACTION, 'visit', run.beats.map((b) => b.text).join(''))
  }
  advance(run)
  return run.draft(TURN_ACTION, w.turn === 'ended' ? 'ended' : 'turn', run.beats.map((b) => b.text).join(''))
}

// ---- 收買的回應 ----

export interface BribeInput {
  accept: boolean
}

export function bribeBlock(k: Kernel, state: GameState): string | null {
  const w = readWar(state)
  if (!w) return '現在沒有輿論戰。'
  if (w.pending !== 'bribe') return '現在沒有人開價收買。'
  return k.activity.blockOf(state, `commit:${BRIBE_ACTION}`)
}

export function bribeDraft(k: Kernel, state: GameState, input: BribeInput): ReportDraft {
  const block = bribeBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), 'bribe')
  const w = run.w
  const price = w.offer ?? 0
  if (input.accept) {
    run.note(`你收下了 C$${price.toLocaleString('en-US')}。`, { tag: 'opinion.bribe', data: { accept: true, price }, plain: '你收下了對手的錢。' })
    run.finish('bribe', price)
    return closeDraft(run, BRIBE_ACTION)
  }
  delete w.pending
  delete w.offer
  run.note(`你回絕了 C$${price.toLocaleString('en-US')}。`, { tag: 'opinion.bribe', data: { accept: false, price }, plain: '你回絕了對手的價碼。' })
  advance(run)
  return run.draft(BRIBE_ACTION, w.turn === 'ended' ? 'ended' : 'declined', run.beats.map((b) => b.text).join(''))
}

// ---- 認輸、結算 ----

export function concedeBlock(k: Kernel, state: GameState): string | null {
  const w = readWar(state)
  if (!w) return '現在沒有輿論戰。'
  if (w.turn === 'ended') return '這場輿論戰已經分出勝負了，先結算。'
  return k.activity.blockOf(state, `commit:${CONCEDE_ACTION}`)
}

export function concedeDraft(k: Kernel, state: GameState): ReportDraft {
  const block = concedeBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), 'concede')
  run.note('你認輸了。', { tag: 'opinion.concede', plain: '你認輸了。' })
  run.finish('concede')
  return closeDraft(run, CONCEDE_ACTION)
}

export function settleBlock(k: Kernel, state: GameState): string | null {
  const w = readWar(state)
  if (!w) return '現在沒有輿論戰。'
  if (w.turn !== 'ended') return '這場輿論戰還沒分出勝負。'
  return k.activity.blockOf(state, `commit:${END_ACTION}`)
}

export function settleDraft(k: Kernel, state: GameState): ReportDraft {
  const block = settleBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), 'end')
  return closeDraft(run, END_ACTION)
}

/** 結算：發 activity.end（kind opinion；face 模式是 face.opinion），後果由聽的人加；戰役清掉。 */
export function closeDraft(run: Run, action: string): ReportDraft {
  const w = run.w
  const r = w.result!
  const cells = Object.fromEntries(CELLS.map((c) => [c, w.cells[c].owner]))
  const payload = {
    topic: w.topic.id, kind: w.topic.kind, side: w.topic.side, you: r.you, foe: r.foe, cells, rounds: w.round, grade: w.grade, faction: w.foe.faction ?? null,
    by: r.by, mode: w.mode, foe_id: w.foe.id, strength: w.foe.strength, target_held: r.target_held, ...(r.bribed !== undefined ? { bribed: r.bribed } : {}),
    brought: w.brought.map((b) => b.ref), desk: w.desk.map((s) => s.actor),
  }
  const end = endActivity(run.k, { state: run.state, kind: w.mode === 'face' ? 'face.opinion' : ACTIVITY, id: w.id, origin: w.origin, outcome: r.outcome, result: payload })
  run.changes.push(...end.changes)
  for (const line of end.lines) run.note(line.replace(/。?$/, '。'), { plain: line })
  // 結算的後果：目標勢力的聲望與敵對值、訂閱與公信力、佔著的格子的加成、議題的 on_end、戰役外的效果（一次交給 k.effects）
  const after = consequences(run)
  run.changes.push(...after.changes)
  if (after.lines.length > 0 || after.effects.length > 0) {
    run.note(`後果：${after.lines.map((l) => l.replace(/。+$/, '')).join('；')}。`, { tag: 'opinion.after', data: { effects: after.effects, ...(after.skipped.length > 0 ? { skipped: after.skipped } : {}) }, plain: '這場輿論戰的餘波傳開了。' })
  }
  if (action === END_ACTION) run.note(resultText(r, w), { tag: 'opinion.end', data: { outcome: r.outcome }, plain: resultPlain(r) })
  const d = run.draft(action, r.outcome, run.beats.map((b) => b.text).join(''), { war: null })
  return attachActivityEnd(d, end)
}
