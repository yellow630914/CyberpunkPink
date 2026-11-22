// L6 功能：現實戰鬥的行動表（COMBAT_SYSTEM 1.3 節）。站位、命中、傷害、感載、過載、遮蔽、回合都在核心（L5）；
// 這個功能只註冊行動（射擊、近戰、換彈、換武器、道具、打遮蔽、監視、制伏、脫離、投降）、道具的五種效果、重創的掛點與戰後的結果。
// 不 import 別的功能：快取格、武器、護甲已經在單位身上。

import type { Feature } from '../../core'
import { ATTACK_ACTIONS } from './attack'
import { ITEM_ACTIONS, checkItems, registerItemOps } from './items'
import { TACTIC_ACTIONS } from './tactics'
import { registerWounds } from './wounds'

export const combatFeature: Feature = {
  id: 'combat',
  install(k) {
    for (const def of [...ATTACK_ACTIONS, ...ITEM_ACTIONS, ...TACTIC_ACTIONS]) k.battle.action(def)
    registerItemOps(k)
    registerWounds(k)
  },
  ready(k) {
    checkItems(k)
  },
}
