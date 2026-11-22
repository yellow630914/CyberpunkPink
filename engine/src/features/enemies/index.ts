// L6 功能：敵人與遭遇。兩種內容（enemy、encounter）的格式；把一筆敵人資料照「等級與位階的目標表 × 兵種的修正 × 難度 × 強度係數」
// 變成戰鬥裡的單位（來源 enemy）；遭遇的點數與開打的設定；敵人的士氣（撤退與投降）。
// 招牌行動、掉落、特徵、天使急救、蕾絲與網內的敵人不在這裡：欄位先收下、照格式檢查，不做效果。
// 規格：ENEMIES 1.1、1.5、第 2 節、4.4 節、第 13 節；ENEMY_ROSTER 開頭；BALANCE 2.4、7.2；dev/adr/0013（B2、D4～D6）。

import type { BattleUnit, Feature } from '../../core'
import { enemyUnit } from './stats'
import { OWNER, registerKinds } from './kinds'

export { ENEMY_CURVE, ENCOUNTER_BUDGET } from './curve'
export { encounterPoints, enemyStats, setupFromEncounter } from './stats'
export type { EnemyStats } from './stats'
export type { EncounterEntry, EncounterFoe, EnemyEntry } from './kinds'

const MORALE_DC = { minion: 13, elite: 10 } as const

export const enemiesFeature: Feature = {
  id: OWNER,
  install(k) {
    registerKinds(k)
    k.battle.unitSource('enemy', OWNER, (ref, ctx) => enemyUnit(k, ctx.state, ref, ctx))

    // 士氣（ENEMIES 4.4 節）：輪到 AI 操縱的敵人，每一步之前。每場只檢定一次
    k.battle.on('ai.step', OWNER, ({ run, unit }) => {
      if (!unit.enemy || unit.control !== 'ai' || unit.out) return
      if (unit.rank === 'boss' || unit.ai?.neverFlee || unit.uses.morale !== undefined) return
      const units = Object.values(run.battle.units)
      const mine = units.filter((u) => u.side === unit.side)
      const theirs = units.filter((u) => u.side !== unit.side)
      const bossOut = mine.some((u) => u.rank === 'boss' && u.out)
      const low = !!unit.hp && !!unit.ai && unit.hp.now / unit.hp.max < unit.ai.fleeBelow
      const halfGone = mine.filter((u) => u.out).length * 2 >= mine.length
      const check = unit.rank === 'minion' ? bossOut || halfGone || low : bossOut || low
      if (!check) return
      unit.uses.morale = 1
      const { ok } = run.save(unit, 'resolve', 'composure', MORALE_DC[unit.rank], '士氣')
      if (ok) return
      // 對方還站著的人數是自己這一方的兩倍以上就投降，否則撤退（暫定，dev/adr/0013 D4）
      const standing = (list: BattleUnit[]) => list.filter((u) => !u.out).length
      run.setOut(unit, standing(theirs) >= 2 * standing(mine) ? 'surrendered' : 'fled')
      return true
    })
  },
}
