// 對手的回合（OPINION 4.4、5.2；dev/adr/0020 V39；DATA 6.3）：公關點 = 強度 × 2；行動表由上往下掃，條件成立、付得起、沒超過次數就做一次，
// 掃完還有點數再掃，一回合最多掃 sweeps 輪；然後佔領（權重 × （分數 ＋ 1）最高的格子）。亂數（mimic 開放哪幾種、下架丟哪張、同分挑哪格）都走這份報告的 rng。
// 收買與找上門是每場一次的（once），在對手的回合一開始看條件：這一張只做到停下來等回應（pending）。

import { capturable, cellBlock, cellScore, cellsOwnedBy, defenseOf, lockedCells, scoreOf } from './board'
import { cardOf } from './cards'
import { fireReactions } from './fx'
import type { OpTrigger } from './hooks'
import type { ActionId, Cell, OnceRule, PrActionEntry } from './model'
import { CELL_NAME, prActions } from './model'
import { modsOf } from './mods'
import type { Run } from './run'
import type { WhenVars } from './when'
import { whenHolds } from './when'

/** 對手每回合的公關點：強度 × 2，加難度的加減（BALANCE 7.2；最少 1），再加效果 foe_pr 與開場表留下的加減（最少 0）。 */
export function prPoints(run: Run): number {
  const dif = run.state.rules.difficulty
  const mod = run.rules.pr_by_difficulty[dif] ?? 0
  return Math.max(0, Math.max(1, run.w.foe.strength * 2 + mod) + (run.w.foe_state.pr_mod ?? 0))
}

export function whenVars(run: Run): WhenVars {
  const w = run.w
  return {
    round: w.round, wind: w.wind, voice: w.voice.foe, your_voice: w.voice.you, score_gap: scoreOf(w, 'foe') - scoreOf(w, 'you'),
    can_capture: capturable(w, 'foe', run.rules, run.env).length, hand: w.hand.length, cred: run.cred,
  }
}

const amountOf = (def: PrActionEntry, grade: number): number => (Array.isArray(def.amount) ? (def.amount[grade - 1] ?? 0) : (def.amount ?? 0))

/** 每場一次的行動：條件成立的第一個（收買要還沒用完；找上門每場一次，委託副本與自己發起的都有，V35）。 */
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
    if (rule.do === 'visit' && !w.foe_state.visited && whenHolds(rule.when, vars)) return { rule }
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
  run.note(`對手這回合能用的招：${open.map((id) => actionName(run, id as ActionId)).join('、')}。`, { tag: 'opinion.foe.open', data: { open } })
  return new Set(open)
}

const actionName = (run: Run, id: ActionId): string => prActions(run.k).find((a) => a.id === id)?.name ?? id

/** 下架丟得掉的手牌（內幕不能被下架）。 */
function discardable(run: Run): number[] {
  return run.w.hand.map((id, i) => ({ id, i })).filter((x) => cardOf(run.k, run.w, x.id)?.inside !== true).map((x) => x.i)
}

/** 對手搶一格：你的格子先問反應（foe.capture_last、foe.capture：negate 讓這一次佔領無效、對手不扣聲量），搶下來之後問 cell.lost（retake 搶回來）。forced 是不看聲量夠不夠（扣到 0 為止）。回傳有沒有把你的格子清空。 */
function foeTakes(run: Run, cell: Cell, forced: boolean): boolean {
  const w = run.w
  const was = w.cells[cell].owner
  const def = defenseOf(w, cell, 'foe', run.rules, run.env)
  if (was === 'you') {
    const last = cellsOwnedBy(w, 'you').length === 1
    const flags = last ? fireReactions(run, 'foe.capture_last', { cell }) : { negated: false }
    const flags2 = flags.negated ? flags : fireReactions(run, 'foe.capture', { cell })
    if (flags.negated || flags2.negated) {
      run.note(`對手要搶「${CELL_NAME[cell]}」，被擋下來了（它沒有花聲量）。`, { tag: 'opinion.foe.capture', data: { cell, def, blocked: true }, plain: '對手想搶一格，被擋了回去。' })
      return false
    }
  }
  w.voice.foe = forced ? Math.max(0, w.voice.foe - def) : w.voice.foe - def
  w.cells[cell] = { owner: 'foe' }
  run.note(`對手${was === 'you' ? '搶走你的' : '佔領'}「${CELL_NAME[cell]}」（花聲量 ${def}，${cellScore(w, cell)} 分）。`, { tag: 'opinion.foe.capture', data: { cell, def, score: cellScore(w, cell), from: was }, plain: was === 'you' ? '對手搶走了你的一格。' : '對手佔下了一格。' })
  if (was === 'you') fireReactions(run, 'cell.lost', { cell })
  if (cellsOwnedBy(w, 'you').length === 0) {
    run.finish('wipe')
    return true
  }
  return false
}

/** 對手的一整個回合（不含一開始的 once）。war 可能在中途分出勝負（你的格子被清空）。 */
export function foeTurn(run: Run): void {
  const w = run.w
  const start = run.beats.length
  const defs = new Map(prActions(run.k).map((d) => [d.id, d]))
  let pts = prPoints(run)
  delete w.foe_state.pr_mod
  run.note(`對手的回合：${pts} 點公關點。`, { tag: 'opinion.foe.start', data: { pts, strength: w.foe.strength } })
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
      if (a.do === 'chase' || a.do === 'host') extraCaps++
      pts -= cost
      used[a.do] = (used[a.do] ?? 0) + 1
      if (def.limit?.per === 'war') w.used[`war:${a.do}`] = (w.used[`war:${a.do}`] ?? 0) + 1
      did = true
    }
    if (!did) break
  }

  // 佔領：每回合一次的固定動作（追擊多一次）。capture_when 不成立的回合不佔（緋櫻前三回合只發稿存聲量）
  const hold = w.foe.capture_when !== undefined && !whenHolds(w.foe.capture_when, whenVars(run))
  if (hold) run.note('對手這一回合不佔領，聲量存著。', { tag: 'opinion.foe.capture', data: { cell: null, hold: true } })
  for (let i = 0; i < 1 + extraCaps && !hold && w.turn !== 'ended'; i++) {
    // 推薦位：第一回合的第一次佔領一定搶指定的那一格（any_adjacent：不看相鄰與設防；城市事件鎖住的格子除外）
    const fc = w.foe.first_capture
    if (fc && !w.foe_state.first_done && w.round === 1) {
      w.foe_state.first_done = true
      const owner = w.cells[fc.cell].owner
      if (owner !== 'foe' && !lockedCells(w).includes(fc.cell) && (fc.any_adjacent || cellBlock(w, fc.cell, 'foe') === null)) {
        if (foeTakes(run, fc.cell, true)) break
        continue
      }
    }
    const list = capturable(w, 'foe', run.rules, run.env)
    if (list.length === 0) {
      if (i === 0) run.note('對手這一回合搶不到格子。', { tag: 'opinion.foe.capture', data: { cell: null } })
      break
    }
    const weight = (c: Cell): number => (w.foe.cell_priority[c] ?? 1) * (cellScore(w, c) + 1)
    const best = Math.max(...list.map(weight))
    const top = list.filter((c) => weight(c) === best)
    const cell = top.length === 1 ? top[0]! : run.rng.pick(top)
    if (foeTakes(run, cell, false)) break
  }
  w.foe_state.last = run.beats.slice(start).filter((b) => b.tag?.startsWith('opinion.foe.') && b.tag !== 'opinion.foe.start' && b.tag !== 'opinion.foe.open').map((b) => b.text)
}

/** 抵銷：被動 shield 還有次數的，這一次對手的律師函、下架、降流無效（它花的公關點照扣）。 */
function shielded(run: Run, id: string): boolean {
  const entry = run.w.shield.find((x) => x.left > 0 && x.what.includes(id))
  if (!entry) return false
  entry.left--
  return true
}

const NAME: Record<string, string> = { lawyer: '律師函', takedown: '下架', mute: '降流' }

/** 做一個行動；不能做（沒有東西可丟、最後一回合寄律師函）回 false，不扣點。 */
function perform(run: Run, id: ActionId, def: PrActionEntry, cost: number): boolean {
  const w = run.w
  const n = amountOf(def, w.grade)
  const data = { do: id, cost }
  const react = (on: OpTrigger, amount?: number) => fireReactions(run, on, amount !== undefined ? { amount } : {})
  // 被抵銷或被反應擋下來：公關點照扣，這一步沒有效果
  const blocked = (what: string, why: string): true => {
    run.note(`對手${what}，${why}。`, { tag: `opinion.foe.${id}`, data: { ...data, blocked: true }, plain: `對手出了手，被擋了下來。` })
    return true
  }
  switch (id) {
    case 'release': {
      if (react('foe.release', n).negated) return blocked('發稿', '被擋了下來')
      const cut = modsOf(w, 'foe_release', run.env)
      const voice = cut.length > 0 ? Math.min(n, ...cut.map((m) => m.amount ?? n)) : n
      run.addVoice('foe', voice)
      run.note(`對手發稿：聲量 +${voice}（對手現在 ${w.voice.foe}）。`, { tag: 'opinion.foe.release', data: { ...data, voice }, plain: '對手發了新聞稿。' })
      return true
    }
    case 'deny': {
      const f = react('foe.deny', n)
      if (f.negated) return blocked('否認', '被擋了下來')
      if (f.reversed) {
        run.addWind(n)
        run.note(`對手否認：風向反過來往你這邊 ${n}。`, { tag: 'opinion.foe.deny', data: { ...data, wind: n, reversed: true }, plain: '對手的否認反而幫了你。' })
        return true
      }
      run.addWind(-n)
      run.note(`對手否認：風向往它那邊 ${n}。`, { tag: 'opinion.foe.deny', data: { ...data, wind: -n }, plain: '對手出面否認。' })
      return true
    }
    case 'mute': {
      if (shielded(run, 'mute')) return blocked(NAME.mute!, '被抵銷了')
      if (react('foe.mute', n).negated) return blocked(NAME.mute!, '被擋了下來')
      run.addVoice('you', -n)
      run.note(`對手降流：你的聲量 −${n}（你現在 ${w.voice.you}）。`, { tag: 'opinion.foe.mute', data: { ...data, voice: -n }, plain: '對手壓低了你這邊的流量。' })
      return true
    }
    case 'counter': {
      // 豔名高的人被拍過的東西太多：反爆料多推一格（OPINION 4.3c）
      const extra = w.fame >= run.rules.fame.counter_at ? run.rules.fame.counter_plus : 0
      const push = n + extra
      const f = react('foe.counter', push)
      if (f.negated) return blocked('反爆料', '被擋了下來')
      if (f.reversed) {
        run.addWind(push)
        run.note(`對手反爆料：風向反過來往你這邊 ${push}。`, { tag: 'opinion.foe.counter', data: { ...data, wind: push, reversed: true }, plain: '對手的反爆料反而幫了你。' })
        return true
      }
      run.addWind(-push)
      run.note(`對手反爆料：風向往它那邊 ${push}${extra > 0 ? '（你被拍過的東西太多，多推了一格）' : ''}。`, { tag: 'opinion.foe.counter', data: { ...data, wind: -push, ...(extra > 0 ? { fame: extra } : {}) }, plain: '對手丟出了反爆料。' })
      return true
    }
    case 'lawyer': {
      if (w.round >= w.rounds) return false
      if (shielded(run, 'lawyer')) return blocked(NAME.lawyer!, '被抵銷了')
      if (react('foe.lawyer', n).negated) return blocked(NAME.lawyer!, '被擋了下來')
      const cut = w.foe.signature?.effect.lawyer_ep ?? n
      w.foe_state.ep_penalty = (w.foe_state.ep_penalty ?? 0) + cut
      run.note(`對手寄律師函：你下一回合的編輯點 −${cut}。`, { tag: 'opinion.foe.lawyer', data: { ...data, ep: -cut }, plain: '對手寄來了律師函。' })
      return true
    }
    case 'takedown': {
      const pick = discardable(run)
      if (pick.length === 0) return false
      const i = pick[run.rng.int(0, pick.length - 1)]!
      const card = w.hand[i]!
      if (shielded(run, 'takedown')) return blocked(NAME.takedown!, '被抵銷了')
      if (react('foe.takedown').negated) return blocked(NAME.takedown!, '被擋了下來')
      const at = w.hand.indexOf(card)
      if (at >= 0) {
        w.hand.splice(at, 1)
        w.discard.push(card)
      }
      run.note(`對手下架：你丟掉一張「${run.cardName(card)}」。`, { tag: 'opinion.foe.takedown', data: { ...data, card }, plain: '對手檢舉下架了你的一張牌。' })
      return true
    }
    case 'chase':
      run.note('對手追擊：這一回合多佔一格。', { tag: 'opinion.foe.chase', data, plain: '對手加緊了攻勢。' })
      return true
    // ---- 鏡像對手（mimic）多出來的：玩家那邊的料、說法、手段、主播的技能 ----
    case 'fuel':
      run.addVoice('foe', n)
      run.note(`對手打出一張料：聲量 +${n}（對手現在 ${w.voice.foe}）。`, { tag: 'opinion.foe.fuel', data: { ...data, voice: n }, plain: '對手亮出了一張料。' })
      return true
    case 'line':
      run.addWind(-n)
      run.note(`對手打出一張說法：風向往它那邊 ${n}。`, { tag: 'opinion.foe.line', data: { ...data, wind: -n }, plain: '對手放出了一個說法。' })
      return true
    case 'guard':
      w.foe_state.guard = w.round + 1
      run.note(`對手設防：你下一回合搶它的格子，防守 +${n}。`, { tag: 'opinion.foe.guard', data: { ...data, def: n }, plain: '對手替自己的格子設了防。' })
      return true
    case 'shift':
      run.addVoice('you', -n)
      run.addVoice('foe', -n)
      run.note(`對手轉移焦點：雙方的聲量各 −${n}（你 ${w.voice.you}、對手 ${w.voice.foe}）。`, { tag: 'opinion.foe.shift', data: { ...data, voice: -n }, plain: '對手把目光引到別處。' })
      return true
    case 'army': {
      run.addVoice('foe', n)
      const roll = run.rng.int(1, 20)
      const bust = roll <= run.rules.army.risk
      if (bust) run.addWind(run.rules.army.wind)
      run.note(`對手放水軍：聲量 +${n}，擲 d20：${roll}${bust ? `，被拆穿了：風向往你這邊 ${run.rules.army.wind}` : ''}。`, { tag: 'opinion.foe.army', data: { ...data, voice: n, roll, bust }, plain: '對手放出了水軍。' })
      return true
    }
    case 'host':
      run.addVoice('foe', n)
      run.note(`對手上場造勢：聲量 +${n}，這一回合多佔一格。`, { tag: 'opinion.foe.host', data: { ...data, voice: n }, plain: '對手的主播親自上場了。' })
      return true
    default:
      return false
  }
}
