// L5 戰鬥：回合（COMBAT_SYSTEM 1.2 節）。逐回合：輪到自己時連續行動直到行動點用完或結束回合，沒用完的留到下回合（不超過上限）。
// 每個人的回合開始時：回行動點與其他的池 → 感載自然消退 → 到期的狀態 → 每回合發作的狀態（流血、暈眩、燃燒）→ 失去回合就跳過。

import type { BattleStatus, BattleUnit } from '../types'
import { attrMod } from '../rules/check'
import { currentUnit, unitTag } from './field'
import { LOSE_TURN } from './rules'
import type { BattleRun } from './run'

const sum = (parts: Array<{ value: number }>): number => parts.reduce((s, p) => s + p.value, 0)

/** 把「到某個人的回合開始／結束」的狀態往前算一次；到期的拿掉。fresh 裡的是這一刻才剛給上去的，這一次不算。 */
function tickStatuses(run: BattleRun, at: 'turn_start' | 'turn_end', of: string, fresh?: (s: BattleStatus) => boolean): void {
  for (const u of Object.values(run.battle.units)) {
    for (const s of [...u.statuses]) {
      if (s.until.at !== at || s.until.of !== of || fresh?.(s)) continue
      s.until.turns -= 1
      if (s.until.turns <= 0) run.removeStatus(u, s.id, s.id === LOSE_TURN)
    }
  }
}

/** 一個回合（全員輪過一次）結束：到期的狀態與煙霧。 */
function endRound(run: BattleRun): void {
  const b = run.battle
  for (const u of Object.values(b.units)) for (const s of [...u.statuses]) if (s.until.at === 'round_end' && s.until.round <= b.round) run.removeStatus(u, s.id)
  for (const side of ['ally', 'foe'] as const) {
    b.cover[side].forEach((c, i) => {
      if (c.soft?.until === undefined || c.soft.until > b.round) return
      delete c.soft
      run.say(`${side === 'ally' ? '我方' : '敵方'}第 ${i + 1} 格的煙霧散了。`, 'field', { side, slot: i + 1, kind: 'clear' })
    })
  }
  b.round += 1
  run.say(`—— 第 ${b.round} 回合 ——`, 'round', { round: b.round })
  startRound(run)
}

/**
 * 一輪的開頭（第一輪也走這裡，由 setupBattle 呼叫）：發 round.start 掛點（還沒有人行動），再替處理函式收尾（補位、看結果）。
 * 沒有操作者、自己動的東西與倒數計時放在這個掛點上。
 */
export function startRound(run: BattleRun): void {
  run.k.battle.emit('round.start', { run, round: run.battle.round })
  run.settle()
}

/**
 * 這個人的回合開始。回傳他這一回合能不能動（false：失去回合、或在回合開始時倒下）。
 * 第一個自己的回合不回行動點（從上限開始；被埋伏的從上限 − 2，開打時已經設好）。
 */
export function beginTurn(run: BattleRun, u: BattleUnit): boolean {
  const b = run.battle
  b.aiSteps = 0
  const first = !u.uses.turns
  u.uses.turns = (u.uses.turns ?? 0) + 1
  if (!first) {
    // 沒用完的留到下回合，不超過上限
    u.ap.now = Math.min(u.ap.max, u.ap.now + Math.max(0, u.ap.regen + sum(run.mods('ap_regen', u))))
    for (const p of Object.values(u.pools)) p.now = Math.min(p.max, p.now + p.regen)
  }
  // 感載每回合自然消退 = 2 ＋ mod(意志)（CORE_RULES 4.2 節）
  if (u.load && u.load.now > 0) {
    const decay = Math.max(0, run.n.decayBase + attrMod(u.attrs.resolve ?? 10) + sum(run.mods('decay', u)))
    u.load.now = Math.max(0, u.load.now - decay)
  }
  // 這一回合用過的東西清掉；監視到自己的下一回合開始前為止
  for (const key of Object.keys(u.uses)) if (key.startsWith('turn:')) delete u.uses[key]
  delete u.watch
  for (const o of b.overlays) if (o.owner === u.id) o.used = false
  const lost = u.statuses.some((s) => run.statusRule(s.id).loseTurn)
  // 回合開始前就帶著的狀態：等一下只有這些算一次到期。發作的時候才剛給上去的（發作的感載造成過載 → 失去下一個回合）
  // 不能在同一個回合開始就被算掉，不然過載了卻一個回合都沒失去
  const carried = new Set(Object.values(b.units).flatMap((x) => x.statuses))
  // 每回合發作的狀態：流血、暈眩、燃燒（先發作，再算到期：「之後兩回合各 1d6」兩回合都要燒到）
  for (const s of [...u.statuses]) {
    const rule = run.statusRule(s.id)
    const t = rule.turnStart
    if (!t) continue
    if (t.ap) u.ap.now = Math.max(0, Math.min(u.ap.max, u.ap.now + t.ap))
    if (t.load) run.addLoad(u, t.load, undefined, { exact: true, label: rule.name })
    const hp = (t.hp ?? 0) - (t.hpDice ? run.d6(t.hpDice) : 0)
    if (hp < 0 && u.hp && !u.out) {
      u.hp.now = Math.max(0, u.hp.now + hp)
      const at = run.beats.length
      run.say(`${unitTag(u)} ${rule.name}：生命 ${hp}。`, 'damage', { target: u.id, amount: -hp, status: s.id, left: u.hp.now })
      // 被擋下的（out.before）生命拉回 1，這一拍記的剩餘生命跟著改
      if (u.hp.now <= 0 && !run.setOut(u, 'down') && !u.out && run.beats[at]?.data) run.beats[at]!.data!.left = u.hp.now
    } else if (hp > 0) run.heal(u, hp)
    if (rule.once) run.removeStatus(u, s.id, true)
    if (u.out) break
  }
  tickStatuses(run, 'turn_start', u.id, (st) => !carried.has(st))
  // 機體的時間（機甲持續「2 ＋ 同步」回合）：時間到正常解除
  if (u.hull?.turns !== undefined && !u.out) {
    u.hull.turns -= 1
    if (u.hull.turns <= 0) {
      run.say(`${unitTag(u)} 的${u.hull.name}時間到，解除了。`, 'hull', { target: u.id, end: 'time' })
      delete u.hull
    }
  }
  if (u.out || run.over) return false
  if (lost) {
    // 這一回合用掉的是回合開始前就帶著的那一個；發作時才剛過載的，失去的是下一個回合，留著
    for (const s of [...u.statuses]) if (carried.has(s) && run.statusRule(s.id).loseTurn) run.removeStatus(u, s.id, true)
    run.say(`${unitTag(u)} 還動不了，失去這一回合。`, 'turn.skip', { unit: u.id })
    return false
  }
  run.say(`輪到 ${unitTag(u)}。`, 'turn', { unit: u.id, round: b.round })
  run.k.battle.emit('turn.start', { run, unit: u })
  return !u.out && !run.over
}

/** 結束現在這個人的回合，往下輪到下一個能動的人。戰鬥分出結果就停。 */
export function advance(run: BattleRun): void {
  const b = run.battle
  for (let guard = 0; guard < 64 && !run.over; guard++) {
    const cur = currentUnit(b)
    if (cur) {
      if (!cur.out) run.k.battle.emit('turn.end', { run, unit: cur })
      tickStatuses(run, 'turn_end', cur.id)
    }
    run.settle()
    if (run.over) return
    b.turn += 1
    if (b.turn >= b.order.length) {
      b.turn = 0
      endRound(run)
      // 一輪開頭的掛點裡分出了結果（巡邏的東西打倒了最後一個人）：不再往下輪
      if (run.over) return
    }
    const next = currentUnit(b)
    if (!next || next.out || next.slot < 1) continue
    if (beginTurn(run, next)) {
      run.settle()
      return
    }
    run.settle()
  }
}
