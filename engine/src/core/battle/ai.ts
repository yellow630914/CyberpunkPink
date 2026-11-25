// L5 戰鬥：敵人 AI 的骨架（ENEMIES 第 4 節）。沿用 ElondiaRPG 的做法：仇恨加權挑目標、替每個行動打分數、分數平方加權抽一個，
// 加上站位與掩體兩個因子。骨架是核心的（現實與內海共用）；每個行動值幾分寫在行動自己的 aiScore，撤退、投降與士氣由功能掛在 ai.step。
//
//   輪到一個敵人時，最多做 6 步，每一步：
//     1. 功能要不要先做一件事（想走嗎、招牌行動、啟動機體）   → ai.step 掛點
//     2. 站得好嗎？算目前那一格與相鄰格的位置分；換過去高出 1.5 以上 → 花行動點換位
//        位置分多一項：站在那一格有「一定要站在這裡才做得到」的行動（制伏）→ 行動自己的 aiSlotScore
//     3. 打誰？每個可及的目標算權重，加權抽一個
//     4. 做什麼？每個能做的行動打分數，分數平方加權抽
//   行動點不夠就停；沒用完的留到下回合。

import type { BattleInput, BattleTarget, BattleUnit } from '../types'
import { BATTLE_SLOTS } from '../types'
import { coverAt, coverLevel, distance, hostiles, isWounded, losingTurn, moveBlock, otherSide, sameTarget, unitAt, unitsOf, wielded } from './field'
import type { BattleActionDef, BattleView } from './registry'
import { actionCost, flashBlock } from './registry'
import type { BattleRun } from './run'
import { performAction } from './act'

/** 換位花的行動點（COMBAT_SYSTEM 1.3 節）。 */
export const MOVE_AP = 1
/** 換過去的位置分要高出這麼多才換（ENEMIES 第 4 節）。 */
export const REPOSITION_MARGIN = 1.5

const COVER_SCORE = [0, 0.75, 1.5]
const COVER_TARGET_MOD = [1.3, 1, 0.7]
/** 偏好 bridged（ENEMIES 4.1 節「有義體的人依義體數 ×1～2」）：每一件 +0.2，五件以上 ×2（暫定，dev/adr/0013 C12）。 */
export const BRIDGED_PER_PIECE = 0.2

/** 這把武器從這一格打得到幾個目標（在適用距離內）。 */
function reachable(view: BattleView, u: BattleUnit, slot: number): number {
  const w = wielded(u)
  if (!w) return 0
  return unitsOf(view.battle, otherSide(u.side)).filter((t) => {
    const d = distance({ slot }, t)
    return d >= w.range[0] && d <= w.range[1]
  }).length
}

/**
 * 站在 slot 那一格，有沒有「一定要站在這裡才做得到」而且值得做的行動（制伏、內海的釘住）：問每個行動的 aiSlotScore，取最高的。
 * 只問這個單位有的、付得起的（要換過去的再加換位的 1 點）、行動自己的條件（blocks）都過的行動。
 */
function slotActionScore(view: BattleView, u: BattleUnit, slot: number): number {
  let best = 0
  for (const def of view.k.battle.actionsFor(view.battle.mode)) {
    if (!def.aiSlotScore || (def.has && !def.has(view, u))) continue
    const cost = actionCost(view, u, def)
    if (flashBlock(view, u, cost)) continue
    if (!view.canAfford(u, { ...cost, ap: cost.ap + (slot === u.slot ? 0 : MOVE_AP) })) continue
    if (def.blocks?.(view, u).length) continue
    best = Math.max(best, def.aiSlotScore(view, u, slot))
  }
  return best
}

/**
 * 位置分（ENEMIES 4.2 節）＝ 偏好格 2（每差一格 −1）＋ 遮蔽（掩體 1.5、半掩 0.75）× cover_use ×（受傷時 ×2）
 * ＋ 武器打得到的目標數 × 0.5 − 在第 1 格而不是近戰型 2
 * ＋ 站在那一格才做得到的行動（制伏：4；行動的 aiSlotScore）。
 * 遮蔽只看那一格本身的（預測換位之後；姿態給的 cover_level 要站到那一格才問得到，不算進預測）。
 * 最後一項是設計書沒有寫的（dev/adr/0014）：沒有它，要抓人的敵人拿著神經槍會先往後退，退開之後就不在近身、永遠輪不到制伏。
 */
export function positionScore(view: BattleView, u: BattleUnit, slot: number): number {
  const prefer = u.ai?.prefer_slots?.length ? u.ai.prefer_slots : [u.slot]
  const off = Math.min(...prefer.map((p) => Math.abs(p - slot)))
  const melee = !!wielded(u)?.traits.includes('melee')
  const cover = COVER_SCORE[coverLevel(coverAt(view.battle, u.side, slot))]! * (u.ai?.coverUse ?? 0.5) * (isWounded(u) ? 2 : 1)
  return 2 - off + cover + reachable(view, u, slot) * 0.5 - (slot === 1 && !melee ? 2 : 0) + slotActionScore(view, u, slot)
}

/**
 * 挑目標的權重（ENEMIES 4.1 節）＝（floor ＋ 仇恨 × focus）× 距離修正 × 遮蔽修正 × 偏好修正。
 * 仇恨是那個人這一場造成的傷害（每 10 點算 1）。最後乘上 ai_target_pct 的修正（候選人身上的加減百分點，−100 是不挑他）。
 */
export function targetWeight(view: BattleView, u: BattleUnit, t: BattleUnit, o: { ignorePct?: boolean } = {}): number {
  const ai = u.ai
  const w = wielded(u)
  const base = (ai?.floor ?? 1) + ((t.uses.threat ?? 0) / 10) * (ai?.focus ?? 1)
  let range = 1
  if (w) {
    const d = distance(u, t)
    const out = d < w.range[0] ? w.range[0] - d : d > w.range[1] ? d - w.range[1] : 0
    range = 0.6 ** out
  }
  const cover = COVER_TARGET_MOD[view.coverOf(t)]!
  let prefer = 1
  const byLoad = ai?.mode === 'neural' || ai?.mode === 'capture'
  if (ai?.prefer === 'weakest') {
    const m = byLoad && t.load ? 1 - (t.layers * t.load.max + t.load.now) / ((t.layersMax + 1) * t.load.max) : t.hp ? t.hp.now / t.hp.max : 1
    prefer = 1 + 2 * (1 - Math.max(0, Math.min(1, m)))
  } else if (ai?.prefer === 'overloaded') prefer = losingTurn(t) ? 3 : 1
  else if (ai?.prefer === 'leader') prefer = t.actor && t.actor === view.state.pc ? 2 : 1
  else if (ai?.prefer === 'nearest') prefer = unitsOf(view.battle, t.side).every((x) => distance(u, x) >= distance(u, t)) ? 2 : 1
  // 有義體的人依義體數 ×1～2（拆體客、改造師型）：沒有義體的是 ×1
  else if (ai?.prefer === 'bridged') prefer = 1 + Math.min(1, Math.max(0, t.cyber ?? 0) * BRIDGED_PER_PIECE)
  // ai_target_pct：候選人身上的加減（−100 就是不挑他）。ignorePct 是「當成沒有這個修正」（候選全部都是 0 的時候，見 aiStep）
  const pct = o.ignorePct ? 0 : view.mods('ai_target_pct', t, u).reduce((sum, p) => sum + p.value, 0)
  return Math.max(0, base * range * cover * prefer * Math.max(0, 1 + pct / 100))
}

function tryReposition(run: BattleRun, u: BattleUnit): boolean {
  if (u.uses['turn:ai_moved'] || u.ap.now < MOVE_AP) return false
  const here = positionScore(run, u, u.slot)
  const options = [u.slot - 1, u.slot + 1]
    .filter((s) => s >= 1 && s <= BATTLE_SLOTS && !moveBlock(run.battle, u, s, run.cannotMove(u)))
    // 不把隊友擠出他比較好的位置：只換到空格，或和隊友交換之後他不會變差
    .filter((s) => {
      const mate = unitAt(run.battle, u.side, s)
      return !mate || positionScore(run, mate, u.slot) >= positionScore(run, mate, s)
    })
    .map((s) => ({ s, score: positionScore(run, u, s) }))
    .sort((a, b) => b.score - a.score)
  const best = options[0]
  if (!best || best.score - here < REPOSITION_MARGIN) return false
  run.spend(u, { ap: MOVE_AP })
  u.uses['turn:ai_moved'] = 1
  run.move(u, best.s)
  return true
}

/** 這個行動現在對這個目標做不做得到；做得到就回傳要用的目標。 */
function usable(run: BattleRun, u: BattleUnit, def: BattleActionDef, enemy: BattleUnit | null): { target: BattleTarget | null } | null {
  if (def.has && !def.has(run, u)) return null
  const cost = actionCost(run, u, def)
  if (!run.canAfford(u, cost) || flashBlock(run, u, cost)) return null
  if (def.blocks?.(run, u).length) return null
  if (def.target === 'none') return { target: null }
  const want = def.aiTarget ? def.aiTarget(run, u, enemy) : enemy ? { unit: enemy.id } : null
  if (!want) return null
  const ok = (def.targets?.(run, u) ?? []).find((o) => sameTarget(o.target, want))
  return ok && ok.blocks.length === 0 ? { target: want } : null
}

/**
 * AI 做一步。回傳有沒有做事；沒有（沒事可做、行動點不夠、已經做滿六步）就由呼叫的人結束他的回合。
 * 花費與行動的結算都在這裡（performAction：和玩家的一步同一條路，花費的修正與 action.done 掛點都一樣）；收尾（監視、補位、結果）由呼叫的人做。
 */
export function aiStep(run: BattleRun, u: BattleUnit): boolean {
  const b = run.battle
  if (run.over || u.out || b.aiSteps >= run.n.aiMaxSteps) return false
  b.aiSteps += 1
  // 1. 功能先做：撤退、投降、士氣、招牌行動、啟動機體
  if (run.k.battle.emit('ai.step', { run, unit: u })) return true
  if (u.out || run.over || u.ap.now <= 0) return false
  // 2. 站得好嗎
  if (tryReposition(run, u)) return true
  // 3. 打誰
  // 被遠端操控的回合（u.puppet）：目標挑自己這一方的別人（hostiles）
  const foes = hostiles(b, u)
  // 每個候選的權重都是 0（ai_target_pct 把場上的人全部排除了）時當成沒有這個修正：除非他是唯一打得到的目標，否則不挑他
  const pickFoe = (ignorePct: boolean) => run.pick(foes, (t) => targetWeight(run, u, t, { ignorePct }))
  const enemy = foes.length ? (pickFoe(false) ?? pickFoe(true) ?? foes[0]!) : null
  // 4. 做什麼：分數平方加權抽
  const options: Array<{ def: BattleActionDef; target: BattleTarget | null; input: BattleInput; score: number }> = []
  for (const def of run.k.battle.actionsFor(b.mode)) {
    if (!def.aiScore) continue
    const use = usable(run, u, def, enemy)
    if (!use) continue
    // 花費可以看這一步的目標（替別人做比較貴）：照實際要送的這一步再確認付得起
    const input: BattleInput = { action: def.id, ...(use.target ? { target: use.target } : {}) }
    if (!run.canAfford(u, actionCost(run, u, def, input))) continue
    const score = def.aiScore(run, u, enemy)
    if (score !== null && score > 0) options.push({ def, target: use.target, input, score })
  }
  const choice = run.pick(options, (o) => o.score * o.score)
  if (!choice) return false
  performAction(run, u, choice.def, choice.target, choice.input)
  return true
}
