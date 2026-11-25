// L6 功能 netrun：義體對追蹤度的修正（掛點 netrun.trace_mod；M4-core-gaps 第 4 項）。獨立一個檔：start.ts 與 common.ts 都要用，放在這裡兩邊才不會互相 import。

import type { ActorId, GameState, Kernel } from '../../core'
import { isRecord } from '../../core'
import type { TraceModAnswer } from './model'

/**
 * 問 netrun.trace_mod（M4-core-gaps 第 4 項）：start 回傳起跳要加的數字（可以是負的）；rise 回傳 amount 照回答加、乘之後的量（最少 0）。
 * 沒有人回答就是 0（start）或 amount 本身（rise）。
 */
export function traceMod(k: Pick<Kernel, 'hooks'>, state: GameState, party: ActorId[], faction: string | undefined, when: 'start' | 'rise', amount: number): number {
  let add = 0
  let mult = 1
  for (const h of k.hooks.run('netrun.trace_mod', { state, party: [...party], ...(faction ? { faction } : {}), when, amount })) {
    const r = h.result as TraceModAnswer
    if (!isRecord(r)) continue
    if (typeof r.add === 'number' && Number.isFinite(r.add)) add += r.add
    if (when === 'rise' && typeof r.mult === 'number' && Number.isFinite(r.mult)) mult *= r.mult
  }
  return when === 'start' ? Math.floor(add) : Math.max(0, Math.floor((amount + add) * mult))
}
