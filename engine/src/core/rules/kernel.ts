// L4 規則核心：這一層的核心物件。

import type { StateKernel } from '../state/kernel'
import { createStateKernel } from '../state/kernel'
import { ConditionRegistry, registerCoreConditions } from './conditions'
import { registerCoreEffects } from './coreEffects'
import { EffectRegistry } from './effects'
import { registerMeterRules } from './meters'
import { PassiveRegistry } from './passive'
import { StatRegistry } from './stats'
import { registerSyncRuleKind } from './sync'

export interface RulesKernel extends StateKernel {
  stats: StatRegistry
  effects: EffectRegistry
  conditions: ConditionRegistry
  /** 被動效果的來源（義體、藥、調校、怪癖……）：功能登記「這個人身上有哪幾筆」，核心替它接到屬性、衍生數值、檢定修正（戰鬥的修正與單位標籤在 createKernel）。dev/adr/0019 第二節 */
  passives: PassiveRegistry
}

export function createRulesKernel(): RulesKernel {
  const base = createStateKernel()
  // 同步原則的表（CORE_RULES 第 5 節；規則表，資料 sync_rule/default 蓋得掉預設）
  registerSyncRuleKind(base.content)
  const effects = new EffectRegistry(base.probe, base.changes)
  registerCoreEffects(effects)
  const conditions = new ConditionRegistry(base.probe)
  registerCoreConditions(conditions)
  // 每定義一種量表（k.meters.define）就自動有同名的效果與條件（dev/adr/0016 第三節）
  base.meters.onDefine((def) => registerMeterRules(def, base.meters, effects, conditions))
  const stats = new StatRegistry(base.probe, base.content)
  // 被動效果：屬性、衍生數值（每一個 id 都問）、檢定修正各掛一次，功能不必自己掛
  const passives = new PassiveRegistry(base.probe, stats, conditions, base)
  stats.addAttrProvider('passives', (state, actor, attr) => passives.parts(state, actor, 'attr', attr))
  stats.addStatProvider('*', 'passives', (state, actor, stat) => passives.parts(state, actor, 'stat', stat))
  stats.addCheckModifier('passives', (state, actor, ctx) => passives.checkParts(state, actor, ctx))
  return Object.assign(base, { stats, effects, conditions, passives })
}
