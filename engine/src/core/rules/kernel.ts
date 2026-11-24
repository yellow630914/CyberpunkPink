// L4 規則核心：這一層的核心物件。

import type { StateKernel } from '../state/kernel'
import { createStateKernel } from '../state/kernel'
import { ConditionRegistry, registerCoreConditions } from './conditions'
import { registerCoreEffects } from './coreEffects'
import { EffectRegistry } from './effects'
import { registerMeterRules } from './meters'
import { StatRegistry } from './stats'
import { registerSyncRuleKind } from './sync'

export interface RulesKernel extends StateKernel {
  stats: StatRegistry
  effects: EffectRegistry
  conditions: ConditionRegistry
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
  return Object.assign(base, { stats: new StatRegistry(base.probe, base.content), effects, conditions })
}
