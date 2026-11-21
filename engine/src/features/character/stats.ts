// L6 角色：衍生數值與重傷（CORE_RULES 第 1、4.1、4.2 節；COMBAT_SYSTEM 第 45 行；CYBERSPACE 第 278 行）。

import type { ActorId, GameState, Kernel, StatRegistry } from '../../core'
import { attrMod } from '../../core'

export const OWNER = 'character'

/** 耐受是橋參數，橋的系統還沒搬進來：讀 ext.bridge.tolerance，不是數字就當 0。 */
function tolerance(state: GameState, actor: ActorId): number {
  const bridge = state.actors[actor]?.ext.bridge as { tolerance?: unknown } | undefined
  const t = bridge?.tolerance
  return typeof t === 'number' && Number.isFinite(t) ? t : 0
}

/** 重傷：生命值低於上限的一半（剛好一半不算）。檢定的 −2 與 wounded 條件共用這一個判斷。 */
export function isWounded(stats: StatRegistry, state: GameState, actor: ActorId): boolean {
  const a = state.actors[actor]
  return !!a && a.hp * 2 < stats.stat(state, actor, 'max_hp')
}

export function installStats(k: Kernel): void {
  const s = k.stats
  const mod = (state: GameState, actor: ActorId, attr: Parameters<StatRegistry['effectiveAttr']>[2]) => attrMod(s.effectiveAttr(state, actor, attr))

  s.defineStat({ id: 'max_hp', owner: OWNER, name: '生命值上限', base: (st, a) => 20 + s.effectiveAttr(st, a, 'body') * 2 })
  s.defineStat({ id: 'load_cap', owner: OWNER, name: '感載上限', base: (st, a) => 20 + Math.floor(tolerance(st, a) / 2) + mod(st, a, 'resolve') * 3 })
  s.defineStat({ id: 'ap_max', owner: OWNER, name: '行動點上限', base: (st, a) => 4 + Math.floor((mod(st, a, 'reflex') + mod(st, a, 'charm')) / 2) })
  s.defineStat({ id: 'ram_max', owner: OWNER, name: 'RAM 上限', min: 4, base: (st, a) => 4 + mod(st, a, 'intellect') })
  // 現在每個人都是 3；敵人的層數照位階，是 M1 的事
  s.defineStat({ id: 'afterglow_cap', owner: OWNER, name: '承受層數', base: () => 3 })

  s.addCheckModifier(OWNER, (st, a) => (isWounded(s, st, a) ? [{ label: '重傷', value: -2, source: 'condition' }] : []))
}
