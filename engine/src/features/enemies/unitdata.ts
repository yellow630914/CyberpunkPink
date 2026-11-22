// 單位身上敵人這一邊的資料（unit.ext.enemies）：
//   traits    帶著的每一個特徵的 id（一定帶著的加上開戰時擲到的）；rolled 是其中開戰時擲到的
//   sink      沉溺（資料的 mods.sink；80 以上另外標 sink_edge，這一張不做別的效果）
//   moraleDc  特徵加在士氣 DC 上的數字
//   angel     天使急救的會員等級（silver、gold、platinum）；angelLeft 是倒下之後還要數幾次 round.start
//   taken     被天使急救的小隊帶走了（dev/adr/0015 E11）：不掉落、不能俘虜（掉落的結算在 loot.ts 讀它）

import type { BattleUnit } from '../../core'

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 要寫的時候用：沒有就補一份空的。 */
export function enemyData(u: BattleUnit): Record<string, unknown> {
  if (!isRec(u.ext.enemies)) u.ext.enemies = {}
  return u.ext.enemies as Record<string, unknown>
}

/** 只讀：沒有就是空的（不動單位）。 */
export const peekEnemy = (u: BattleUnit): Record<string, unknown> => (isRec(u.ext.enemies) ? u.ext.enemies : {})
