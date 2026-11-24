// L5 戰鬥：做一個行動（玩家的一步、AI 選的一步、功能替單位做的一步都走這裡）。
// 單獨一個檔：step.ts（對外的函式）與 ai.ts（敵人 AI）都要用它，放在這裡兩邊才不會互相 import。

import type { BattleInput, BattleTarget, BattleUnit } from '../types'
import { wielded } from './field'
import type { BattleActionDef } from './registry'
import { actionCost, actionTags, flashBlock } from './registry'
import type { BattleRun } from './run'

/** 這一步做不成：原因一條一條列（給玩家看的句子）。狀態不變。 */
export class BattleBlocked extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join(' '))
    this.name = 'BattleBlocked'
  }
}

/**
 * 讓一個單位做一個行動：扣花費 → 行動本身 → 行動做完的掛點（action.done）。
 * 功能在掛點裡替單位做一個行動（招牌行動、劇本）也用它：花費的修正與「用掉幾次」才會和玩家自己做的一致。
 * 條件與目標合不合由呼叫的人先檢查；不夠付在這裡丟 BattleBlocked。收尾（監視、補位、結果：run.settle）由呼叫的人做。
 */
export function performAction(run: BattleRun, unit: BattleUnit, def: BattleActionDef, target: BattleTarget | null, input: BattleInput): void {
  // 花費可以看這一步選了什麼（替別人用道具比較貴）：照這一步實際的花費再檢查一次
  const cost = actionCost(run, unit, def, input)
  const flash = flashBlock(run, unit, cost)
  if (flash) throw new BattleBlocked([flash])
  if (!run.canAfford(unit, cost)) throw new BattleBlocked([`行動點不夠（要 ${cost.ap} 點，現在 ${unit.ap.now} 點）。`])
  const base = def.cost(run, unit, input)
  // 標籤帶上行動自己的 costTags（用的是哪一類道具：item:medical），和問花費時的標籤一致；要在 def.run 之前問：用掉道具之後快取格可能空了
  const tags = actionTags(unit, def, input, run)
  // 行動開始時手上那一把（換武器會把它換掉；掛點要的是「這一步用的那一把」）
  const weapon = wielded(unit)
  run.spend(unit, cost)
  def.run(run, unit, target, input)
  run.k.battle.emit('action.done', { run, unit, action: def.id, tags, target, input, cost, base, ...(weapon ? { weapon } : {}) })
}
