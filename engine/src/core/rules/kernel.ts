// L4 規則核心：這一層的核心物件。

import type { StateKernel } from '../state/kernel'
import { createStateKernel } from '../state/kernel'
import { ConditionRegistry, registerCoreConditions } from './conditions'
import { registerCoreEffects } from './coreEffects'
import { EffectRegistry } from './effects'
import { StatRegistry } from './stats'

export interface RulesKernel extends StateKernel {
  stats: StatRegistry
  effects: EffectRegistry
  conditions: ConditionRegistry
}

export function createRulesKernel(): RulesKernel {
  const base = createStateKernel()
  const effects = new EffectRegistry(base.probe, base.changes)
  registerCoreEffects(effects)
  const conditions = new ConditionRegistry(base.probe)
  registerCoreConditions(conditions)
  return Object.assign(base, { stats: new StatRegistry(base.probe, base.content), effects, conditions })
}
