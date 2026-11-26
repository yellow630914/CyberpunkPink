// 對手的回合（OPINION 4.4、5.2；dev/adr/0020 V39；DATA 6.3）：公關點 = 強度 × 2；行動表由上往下掃，條件成立、付得起、沒超過次數就做一次，
// 掃完還有點數再掃，一回合最多掃 sweeps 輪；然後佔領（權重 × （分數 ＋ 1）最高的格子）。亂數（mimic 開放哪幾種、下架丟哪張、同分挑哪格）都走這份報告的 rng。
// 收買與找上門是每場一次的（once），在對手的回合一開始看條件：這一張只做到停下來等回應（pending）。

import { capturable, cellScore, cellsOwnedBy, defenseOf, scoreOf } from './board'
import { cardOf } from './cards'
import type { ActionId, Cell, OnceRule, PrActionEntry } from './model'
import { CELL_NAME, prActions } from './model'
import type { Run } from './run'
import { credOf } from './run'
import type { WhenVars } from './when'
import { whenHolds } from './when'

/** 對手每回合的公關點：強度 × 2，加難度的加減（BALANCE 7.2；最少 1）。 */
export function prPoints(run: Run): number {
  const dif = run.state.rules.difficulty
  const mod = run.rules.pr_by_difficulty[dif] ?? 0
  return Math.max(1, run.w.foe.strength * 2 + mod)
}

export function whenVars(run: Run): WhenVars {
  const w = run.w
  return {
    round: w.round, wind: w.wind, voice: w.voice.foe, your_voice: w.voice.you, score_gap: scoreOf(w, 'foe') - scoreOf(w, 'you'),
    can_capture: capturable(w, 'foe', run.rules).length, hand: w.hand.length, cred: credOf(run.k, run.state),
  }
}

const amountOf = (def: PrActionEntry, grade: number): number => (Array.isArray(def.amount) ? (def.amount[grade - 1] ?? 0) : (def.amount ?? 0))

/** 每場一次的行動：條件成立的第一個（收買要還沒用完；找上門只有 face 模式才有，solo 當作沒有這個行動）。 */
export function checkOnce(run: Run): { rule: OnceRule; price?: number } | null {
  const w = run.w
  const vars = whenVars(run)
  for (const rule of w.foe.once) {
    if (rule.do === 'bribe') {
      const times = w.foe.signature?.effect.bribe_times ?? 1
      if (w.foe_state.bribes >= times || !whenHolds(rule.when, vars)) continue
      const base = (rule.offer_per_grade ?? 0) * w.grade
      return { rule, price: Math.round(w.foe_state.bribes >= 1 ? base * 1.5 : base) }
    }
    if (rule.do === 'visit' && w.mode === 'face' && !w.foe_state.visited && whenHolds(rule.when, vars)) return { rule }
  }
  return null
}

/** 每回合照固定亂數從行動表開放三到四種（mimic）。 */
function openSet(run: Run): Set<string> | null {
  const m = run.w.foe.mimic
  if (!m) return null
  const all = [...new Set(run.w.foe.actions.map((a) => a.do))]
  const n = Math.min(all.length, run.rng.int(m.open[0], m.open[1]))
  const open = run.shuffle(all).slice(0, n)
  run.w.foe_state.open = open
  run.say(`對手這回合能用的招：${open.map((id) => actionName(run, id as ActionId)).join('、')}。`, { tag: 'opinion.foe.open', data: { open } })
  return new Set(open)
}

const actionName = (run: Run, id: ActionId): string => prActions(run.k).find((a) => a.id === id)?.name ?? id

/** 下架丟得掉的手牌（內幕不能被下架）。 */
function discardable(run: Run): number[] {
  return run.w.hand.map((id, i) => ({ id, i })).filter((x) => cardOf(run.k, run.w, x.id)?.inside !== true).map((x) => x.i)
}

/** 對手的一整個回合（不含一開始的 once）。war 可能在中途分出勝負（你的格子被清空）。 */
export function foeTurn(run: Run): void {
  const w = run.w
  const start = run.beats.length
  const defs = new Map(prActions(run.k).map((d) => [d.id, d]))
  let pts = prPoints(run)
  run.say(`對手的回合：${pts} 點公關點。`, { tag: 'opinion.foe.start', data: { pts, strength: w.foe.strength } })
  const open = openSet(run)
  const used: Record<string, number> = {}
  let extraCaps = 0
  const sig = w.foe.signature?.effect

  for (let sweep = 0; sweep < run.rules.sweeps; sweep++) {
    let did = false
    for (const a of w.foe.actions) {
      if (open && !open.has(a.do)) continue
      const def = defs.get(a.do)
      if (!def) continue
      const cost = sig?.cost?.[a.do] ?? def.cost
      if (cost > pts || (def.min_strength !== undefined && w.foe.strength < def.min_strength)) continue
      if (def.limit?.per === 'turn' && (used[a.do] ?? 0) >= def.limit.n) continue
      if (def.limit?.per === 'war' && (w.used[`war:${a.do}`] ?? 0) >= def.limit.n) continue
      if (!whenHolds(a.when, whenVars(run))) continue
      if (!perform(run, a.do, def, cost)) continue
      if (a.do === 'chase') extraCaps++
      pts -= cost
      used[a.do] = (used[a.do] ?? 0) + 1
      if (def.limit?.per === 'war') w.used[`war:${a.do}`] = (w.used[`war:${a.do}`] ?? 0) + 1
      did = true
    }
    if (!did) break
  }

  // 佔領：每回合一次的固定動作（追擊多一次）
  for (let i = 0; i < 1 + extraCaps; i++) {
    const list = capturable(w, 'foe', run.rules)
    if (list.length === 0) {
      if (i === 0) run.say('對手這一回合搶不到格子。', { tag: 'opinion.foe.capture', data: { cell: null } })
      break
    }
    const weight = (c: Cell): number => (w.foe.cell_priority[c] ?? 1) * (cellScore(w, c) + 1)
    const best = Math.max(...list.map(weight))
    const top = list.filter((c) => weight(c) === best)
    const cell = top.length === 1 ? top[0]! : run.rng.pick(top)
    const was = w.cells[cell].owner
    const def = defenseOf(w, cell, 'foe', run.rules)
    w.voice.foe -= def
    w.cells[cell] = { owner: 'foe' }
    run.say(`對手${was === 'you' ? '搶走你的' : '佔領'}「${CELL_NAME[cell]}」（花聲量 ${def}，${cellScore(w, cell)} 分）。`, { tag: 'opinion.foe.capture', data: { cell, def, score: cellScore(w, cell), from: was }, plain: was === 'you' ? '對手搶走了你的一格。' : '對手佔下了一格。' })
    if (cellsOwnedBy(w, 'you').length === 0) {
      run.finish('wipe')
      break
    }
  }
  w.foe_state.last = run.beats.slice(start).filter((b) => b.tag?.startsWith('opinion.foe.') && b.tag !== 'opinion.foe.start' && b.tag !== 'opinion.foe.open').map((b) => b.text)
}

/** 做一個行動；不能做（沒有東西可丟、最後一回合寄律師函）回 false，不扣點。 */
function perform(run: Run, id: ActionId, def: PrActionEntry, cost: number): boolean {
  const w = run.w
  const n = amountOf(def, w.grade)
  const data = { do: id, cost }
  switch (id) {
    case 'release':
      run.addVoice('foe', n)
      run.say(`對手發稿：聲量 +${n}（對手現在 ${w.voice.foe}）。`, { tag: 'opinion.foe.release', data: { ...data, voice: n }, plain: '對手發了新聞稿。' })
      return true
    case 'deny':
      run.addWind(-n)
      run.say(`對手否認：風向往它那邊 ${n}。`, { tag: 'opinion.foe.deny', data: { ...data, wind: -n }, plain: '對手出面否認。' })
      return true
    case 'mute':
      run.addVoice('you', -n)
      run.say(`對手降流：你的聲量 −${n}（你現在 ${w.voice.you}）。`, { tag: 'opinion.foe.mute', data: { ...data, voice: -n }, plain: '對手壓低了你這邊的流量。' })
      return true
    case 'counter':
      run.addWind(-n)
      run.say(`對手反爆料：風向往它那邊 ${n}。`, { tag: 'opinion.foe.counter', data: { ...data, wind: -n }, plain: '對手丟出了反爆料。' })
      return true
    case 'lawyer': {
      if (w.round >= w.rounds) return false
      const cut = w.foe.signature?.effect.lawyer_ep ?? n
      w.foe_state.ep_penalty = (w.foe_state.ep_penalty ?? 0) + cut
      run.say(`對手寄律師函：你下一回合的編輯點 −${cut}。`, { tag: 'opinion.foe.lawyer', data: { ...data, ep: -cut }, plain: '對手寄來了律師函。' })
      return true
    }
    case 'takedown': {
      const pick = discardable(run)
      if (pick.length === 0) return false
      const i = pick[run.rng.int(0, pick.length - 1)]!
      const [card] = w.hand.splice(i, 1)
      w.discard.push(card!)
      run.say(`對手下架：你丟掉一張「${run.cardName(card!)}」。`, { tag: 'opinion.foe.takedown', data: { ...data, card }, plain: '對手檢舉下架了你的一張牌。' })
      return true
    }
    case 'chase':
      run.say('對手追擊：這一回合多佔一格。', { tag: 'opinion.foe.chase', data, plain: '對手加緊了攻勢。' })
      return true
    default:
      return false
  }
}

