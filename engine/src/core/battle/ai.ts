// L5 戰鬥：敵人 AI 的骨架（ENEMIES 第 4 節）。沿用 ElondiaRPG 的做法：仇恨加權挑目標、替每個行動打分數、分數平方加權抽一個，
// 加上站位與掩體兩個因子。骨架是核心的（現實與內海共用）；每個行動值幾分寫在行動自己的 aiScore，撤退、投降與士氣由功能掛在 ai.step。
//
//   輪到一個敵人時，最多做 6 步，每一步：
//     1. 功能要不要先做一件事（想走嗎、招牌行動、啟動機體）   → ai.step 掛點
//     2. 站得好嗎？算目前那一格與相鄰格的位置分；換過去高出 1.5 以上 → 花行動點換位
//     3. 打誰？每個可及的目標算權重，加權抽一個
//     4. 做什麼？每個能做的行動打分數，分數平方加權抽
//   行動點不夠就停；沒用完的留到下回合。

import type { BattleTarget, BattleUnit } from '../types'
import { BATTLE_SLOTS } from '../types'
import { coverAt, coverLevel, distance, isWounded, losingTurn, moveBlock, otherSide, sameTarget, unitAt, unitsOf, wielded } from './field'
import type { BattleActionDef, BattleView } from './registry'
import type { BattleRun } from './run'

/** 換位花的行動點（COMBAT_SYSTEM 1.3 節）。 */
export const MOVE_AP = 1
/** 換過去的位置分要高出這麼多才換（ENEMIES 第 4 節）。 */
export const REPOSITION_MARGIN = 1.5

const COVER_SCORE = [0, 0.75, 1.5]
const COVER_TARGET_MOD = [1.3, 1, 0.7]

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
 * 位置分（ENEMIES 4.2 節）＝ 偏好格 2（每差一格 −1）＋ 遮蔽（掩體 1.5、半掩 0.75）× cover_use ×（受傷時 ×2）
 * ＋ 武器打得到的目標數 × 0.5 − 在第 1 格而不是近戰型 2。
 */
export function positionScore(view: BattleView, u: BattleUnit, slot: number): number {
  const prefer = u.ai?.prefer_slots?.length ? u.ai.prefer_slots : [u.slot]
  const off = Math.min(...prefer.map((p) => Math.abs(p - slot)))
  const melee = !!wielded(u)?.traits.includes('melee')
  const cover = COVER_SCORE[coverLevel(coverAt(view.battle, u.side, slot))]! * (u.ai?.coverUse ?? 0.5) * (isWounded(u) ? 2 : 1)
  return 2 - off + cover + reachable(view, u, slot) * 0.5 - (slot === 1 && !melee ? 2 : 0)
}

/**
 * 挑目標的權重（ENEMIES 4.1 節）＝（floor ＋ 仇恨 × focus）× 距離修正 × 遮蔽修正 × 偏好修正。
 * 仇恨是那個人這一場造成的傷害（每 10 點算 1）。
 */
export function targetWeight(view: BattleView, u: BattleUnit, t: BattleUnit): number {
  const ai = u.ai
  const w = wielded(u)
  const base = (ai?.floor ?? 1) + ((t.uses.threat ?? 0) / 10) * (ai?.focus ?? 1)
  let range = 1
  if (w) {
    const d = distance(u, t)
    const out = d < w.range[0] ? w.range[0] - d : d > w.range[1] ? d - w.range[1] : 0
    range = 0.6 ** out
  }
  const cover = COVER_TARGET_MOD[t.hull ? 0 : coverLevel(coverAt(view.battle, t.side, t.slot))]!
  let prefer = 1
  const byLoad = ai?.mode === 'neural' || ai?.mode === 'capture'
  if (ai?.prefer === 'weakest') {
    const m = byLoad && t.load ? 1 - (t.layers * t.load.max + t.load.now) / ((t.layersMax + 1) * t.load.max) : t.hp ? t.hp.now / t.hp.max : 1
    prefer = 1 + 2 * (1 - Math.max(0, Math.min(1, m)))
  } else if (ai?.prefer === 'overloaded') prefer = losingTurn(t) ? 3 : 1
  else if (ai?.prefer === 'leader') prefer = t.actor && t.actor === view.state.pc ? 2 : 1
  else if (ai?.prefer === 'nearest') prefer = unitsOf(view.battle, t.side).every((x) => distance(u, x) >= distance(u, t)) ? 2 : 1
  return Math.max(0, base * range * cover * prefer)
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
  if (!run.canAfford(u, def.cost(run, u))) return null
  if (def.blocks?.(run, u).length) return null
  if (def.target === 'none') return { target: null }
  const want = def.aiTarget ? def.aiTarget(run, u, enemy) : enemy ? { unit: enemy.id } : null
  if (!want) return null
  const ok = (def.targets?.(run, u) ?? []).find((o) => sameTarget(o.target, want))
  return ok && ok.blocks.length === 0 ? { target: want } : null
}

/**
 * AI 做一步。回傳有沒有做事；沒有（沒事可做、行動點不夠、已經做滿六步）就由呼叫的人結束他的回合。
 * 花費與行動的結算都在這裡；收尾（監視、補位、結果）由呼叫的人做。
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
  const foes = unitsOf(b, otherSide(u.side))
  const enemy = foes.length ? (run.pick(foes, (t) => targetWeight(run, u, t)) ?? foes[0]!) : null
  // 4. 做什麼：分數平方加權抽
  const options: Array<{ def: BattleActionDef; target: BattleTarget | null; score: number }> = []
  for (const def of run.k.battle.actionsFor(b.mode)) {
    if (!def.aiScore) continue
    const use = usable(run, u, def, enemy)
    if (!use) continue
    const score = def.aiScore(run, u, enemy)
    if (score !== null && score > 0) options.push({ def, target: use.target, score })
  }
  const choice = run.pick(options, (o) => o.score * o.score)
  if (!choice) return false
  const input = { action: choice.def.id, ...(choice.target ? { target: choice.target } : {}) }
  run.spend(u, choice.def.cost(run, u, input))
  choice.def.run(run, u, choice.target, input)
  return true
}
