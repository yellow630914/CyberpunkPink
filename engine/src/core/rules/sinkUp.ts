// L4 規則核心：往上加沉溺的共用函式（M4 收尾修正批 應修 5；CHARACTER 5.2 節特質的強度表「沉溺每次上升的量 −1（最少 1）」）。
// 手術失手、餘韻帶久了這類「往上加」的路，原本直接寫 actor.track，繞過了 sink 效果裡 sink_resist（調校）的減免。
// 有人註冊 sink 效果時一律走它（往上的也一樣；帶著 sink_resist 的人每一次少 1 點、最少 1），沒有人註冊（或效果落空）時才直接寫。
// NPC 的沉溺（features/npcs/life.ts）不走這裡。把沉溺抬到下限（sink_floor）不算「上升」，也不走這裡。

import type { ActorId, Change, GameState } from '../types'
import { effectCtx } from './grades'
import type { RulesKernel } from './kernel'

/**
 * 沉溺往上加 amount 點、一共 times 次（每一次各算一筆：sink_resist 是「每一次上升」少 1）。amount 不是正整數、times 不是正整數時沒有變更。
 * 回傳要接進報告的變更。
 */
export function sinkUpChanges(k: Pick<RulesKernel, 'effects' | 'content' | 'meters' | 'stats'> & Partial<RulesKernel>, state: GameState, actor: ActorId, amount: number, times = 1): Change[] {
  if (!(Number.isInteger(amount) && amount > 0 && Number.isInteger(times) && times > 0)) return []
  if (k.effects.has('sink')) {
    const fx = Array.from({ length: times }, () => ({ kind: 'sink', amount }))
    const ctx = effectCtx(k as RulesKernel, state, { source: 'builtin', actor })
    if (k.effects.validate(fx, ctx).length === 0) {
      const res = k.effects.resolve(fx, ctx)
      if (res.errors.length === 0) return res.changes
    }
  }
  return [{ op: 'actor.track', id: actor, track: 'sink', delta: amount * times }]
}
