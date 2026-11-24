// 敵人招牌行動的 AI（ENEMIES 4.3、4.5 節；dev/work/M1b-enemy-moves.md 第一節）：技能的 `ai` 段變成行動的 aiScore 與 aiTarget。
// aiScore：技能自己的條件（blocks、needs、when）不符回 null，否則回 ai.score（第一、二回合加 first_rounds；低血才解開的解開之後 +1）。
// 反應、被動不用分數（裝著就有）；姿態在 AI 的第一個回合自己開（registerAiStance）。
// 玩家的技能也可以寫 ai（之後 AI 操縱的夥伴用得到）：做法一樣。

import type { BattleActionDef, BattlePick, BattleTarget, BattleTargetOption, BattleUnit, BattleView, Kernel } from '../../core'
import { actionCost, otherSide, performAction, sameTarget, unitAt } from '../../core'
import { colIn } from './column'
import { whenBlocks } from './conditions'
import type { AbilityEntry, MeatDef } from './types'
import { OWNER } from './types'
import { equippedOf } from './unitdata'

/** 低血大招解開：生命 ≤ 40%，或餘韻疊到承受層數 − 1（承受層數只有 1 的雜兵沒有「− 1」可言，不算）。ENEMIES 4.5 節。 */
export function lowUnlocked(u: BattleUnit): boolean {
  if (u.hp && u.hp.now * 100 <= u.hp.max * 40) return true
  return u.layersMax >= 2 && u.layers >= u.layersMax - 1
}

/** battle.ts 的幾個函式（技能的目標、條件、要選的東西）：battle.ts 自己傳進來，這個檔不必 import 它。 */
export interface AiHelpers {
  meat(view: BattleView, u: BattleUnit): MeatDef
  blocks(view: BattleView, u: BattleUnit): string[]
  targets(view: BattleView, u: BattleUnit, m: MeatDef): BattleTargetOption[]
  picks(view: BattleView, u: BattleUnit, m: MeatDef): BattlePick[]
}

const ALLY_TARGETS = ['ally', 'ally_or_self', 'near', 'downed_near']

const ratio = (u: BattleUnit): number => (u.hp ? u.hp.now / u.hp.max : 1)

/** 一個目標指的是誰（人）。 */
function unitOf(view: BattleView, t: BattleTarget | null): BattleUnit | undefined {
  if (!t) return undefined
  if ('unit' in t) return view.battle.units[t.unit]
  if ('side' in t && 'slot' in t) return unitAt(view.battle, t.side, t.slot)
  return undefined
}

/**
 * AI 用這個技能時的目標：AI 挑的那個敵人（選得了的話）；選不了就換一個選得了的。目標是我方的（治療、增益）挑生命比例最低的；
 * 目標是格子、一台的，照 AI 挑的敵人所在的格、或第一個選得了的。沒有選得了的是 null。
 */
function aiTargetOf(view: BattleView, u: BattleUnit, m: MeatDef, enemy: BattleUnit | null, h: AiHelpers): BattleTarget | null {
  const open = h.targets(view, u, m).filter((o) => o.blocks.length === 0)
  if (!open.length) return null
  const has = (want: BattleTarget): boolean => open.some((o) => sameTarget(o.target, want))
  if (m.target === 'enemy' && enemy && has({ unit: enemy.id })) return { unit: enemy.id }
  if ((m.target === 'foe_slot' || m.target === 'enemy_slot') && enemy && has({ side: otherSide(u.side), slot: enemy.slot })) return { side: otherSide(u.side), slot: enemy.slot }
  if (ALLY_TARGETS.includes(m.target ?? '')) {
    const mates = open.map((o) => ({ o, unit: unitOf(view, o.target) })).sort((a, b) => ratio(a.unit ?? u) - ratio(b.unit ?? u))
    return mates[0]!.o.target
  }
  return open[0]!.target
}

/** 這個技能的 aiScore 與 aiTarget（沒寫 ai 的技能不給：AI 不用）。 */
export function aiDefsOf(ab: AbilityEntry, h: AiHelpers): Pick<BattleActionDef, 'aiScore' | 'aiTarget'> {
  const ai = ab.ai
  if (!ai) return {}
  const needsTarget = (m: MeatDef): boolean => m.target !== undefined && m.target !== 'self' && m.target !== 'none'
  return {
    aiTarget: (view, u, enemy) => aiTargetOf(view, u, h.meat(view, u), enemy, h),
    aiScore(view, u, enemy) {
      const m = h.meat(view, u)
      if (m.pending) return null
      if (ai.unlock === 'low' && !lowUnlocked(u)) return null
      // 技能自己的條件：次數、自己的 when、拿著的武器、彈匣
      if (h.blocks(view, u).length) return null
      // 要玩家選的東西（picks、choose）AI 填不出來：不列
      if (h.picks(view, u, m).some((p) => p.required && p.options.length > 0)) return null
      // 目標的條件（needs、range）：選得了的目標才列
      const target = needsTarget(m) ? aiTargetOf(view, u, m, enemy, h) : null
      if (needsTarget(m) && !target) return null
      const tu = unitOf(view, target)
      // AI 才看的條件
      const { target_hp_below: below, ...when } = ai.when ?? {}
      if (whenBlocks(view, u, when, tu).length) return null
      if (below !== undefined && !(tu?.hp && tu.hp.now / tu.hp.max < below)) return null
      return ai.score + (ai.first_rounds !== undefined && view.battle.round <= 2 ? ai.first_rounds : 0) + (ai.unlock === 'low' ? 1 : 0)
    },
  }
}

/**
 * 姿態不用分數：AI 操縱的敵人在自己的第一個回合把裝著的招牌姿態開起來（每場一次；開不了——行動點不夠、條件不符——下一步再試）。
 * 反應與被動裝著就有，不必做什麼。
 */
export function registerAiStance(k: Kernel): void {
  k.battle.on('ai.step', OWNER, ({ run, unit }) => {
    if (unit.control !== 'ai' || unit.out || unit.stance) return
    for (const ab of equippedOf(run, unit)) {
      // 這一層有欄、而且算數的姿態（照戰場選欄）
      if (ab.enemy !== true || ab.kind !== 'stance' || !colIn(run, unit, ab)) continue
      const key = `ai_stance:${ab.id}`
      if (unit.uses[key]) continue
      const def = run.k.battle.getAction(ab.id)
      if (!def || def.blocks?.(run, unit).length || !run.canAfford(unit, actionCost(run, unit, def))) continue
      unit.uses[key] = 1
      performAction(run, unit, def, null, { action: def.id })
      return true
    }
    return
  })
}
