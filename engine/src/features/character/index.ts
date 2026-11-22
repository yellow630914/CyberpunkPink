// L6 功能：角色。衍生數值（生命值、感載、行動點、RAM、承受層數）、重傷、三條軌與餘韻的效果與條件，註冊到核心的登錄表。
// 規格：CORE_RULES 第 1、3、4.1、4.2 節；COMBAT_SYSTEM 第 45 行；CYBERSPACE 第 278 行；EVENTS 2.4 節。
// 不在這裡：過載、餘韻的消退、沉溺的分段、感載的敏感度倍率（之後的批次）。

import type { Feature } from '../../core'
import { installConditions } from './conditions'
import { installEffects } from './effects'
import { installStats } from './stats'

export const characterFeature: Feature = {
  id: 'character',
  install(k) {
    installStats(k)
    installEffects(k)
    installConditions(k)
  },
}
