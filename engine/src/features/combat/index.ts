// L6 功能：現實戰鬥的行動表（COMBAT_SYSTEM 1.3 節）。站位、命中、傷害、感載、過載、遮蔽、回合都在核心（L5）；
// 這個功能註冊行動（射擊、近戰、換彈、換武器、道具、打遮蔽、監視、制伏、脫離、投降）、通用的效果（ops.ts：攻擊、感載、回復、狀態、推拉、遮蔽、行動點、義體、救回來、重創……）、重創的掛點與戰後的結果。
// 不 import 別的功能：快取格、武器、護甲已經在單位身上。

import type { Feature } from '../../core'
import { ATTACK_ACTIONS } from './attack'
import { ITEM_ACTIONS, checkItems } from './items'
import { registerOps } from './ops'
import { TACTIC_ACTIONS } from './tactics'
import { registerWounds } from './wounds'

export const combatFeature: Feature = {
  id: 'combat',
  install(k) {
    for (const def of [...ATTACK_ACTIONS, ...ITEM_ACTIONS, ...TACTIC_ACTIONS]) k.battle.action(def)
    registerOps(k)
    registerWounds(k)
  },
  ready(k) {
    checkItems(k)
  },
}
