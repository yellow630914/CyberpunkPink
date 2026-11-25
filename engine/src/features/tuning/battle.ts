// L6 功能 tuning 的戰鬥（dev/work/M4-tuning.md 第 3 點 no_load_decay）。
// 開關 no_load_decay（渴求的反面：感載不自然消退）：只在現實的戰場，一個戰鬥修正 decay 把自然消退的基礎（decayBase ＋ mod(意志)，最少 0）整個抵掉；
// 其他來源給的消退（靜水的 +2、藥）照舊加在後面。內海的戰場本來就不自然消退（基礎 0），net_load_decay 不動。
// 戰鬥外的消退是休息的事（features/rest、features/character），不在這裡。

import type { Kernel } from '../../core'
import { attrMod } from '../../core'
import { OWNER, FLAG_NAME } from './model'
import { activeFlags } from './passive'

export function installBattle(k: Kernel): void {
  k.battle.modifier(OWNER, (q) => {
    if (q.kind !== 'decay' || q.view.mode.decayStat || !q.unit.actor) return []
    const state = q.view.state
    if (!state.actors[q.unit.actor] || !activeFlags(k, state, q.unit.actor).has('no_load_decay')) return []
    const natural = q.view.n.decayBase + attrMod(q.unit.attrs.resolve ?? 10)
    return natural > 0 ? [{ label: FLAG_NAME.no_load_decay, value: -natural, source: 'tuning' }] : []
  })
}
