// L6 功能 sink 的被動效果（來源 sink；dev/adr/0019 第二、六節；CORE_RULES 4.3 節）。
//   分段  真正的沉溺落在哪幾段，每一段的 effects 都給（往上累加，不是只給最高的那一段）；
//         所在的那一段寫了 double（80～99：溺感邊緣）時，前面每一段裡「檢定類」的加減再給一份（P18：只加倍檢定的加減；承受層數、同步上限不加倍）。
//   過百  超過 100 之後每滿 over_step 點，承受層數（afterglow_cap）再 +1。
//   下限  floor_mods 裡沒過期的每一筆給 { stat: 'sink_floor', amount }。
// 「別人看到的沉溺」不影響這裡：分段永遠照真正的沉溺算（NPCS 8.3 節「真正的數值不變，分段的加成與懲罰照真正的數值算」）。

import type { ActorId, GameState, PassiveEffect } from '../../core'
import { AFTERGLOW_DOUBLE } from '../../core'
import type { SinkRules } from './model'
import { SUNK_AT, liveMods, nowOf, readExt } from './model'
import { bandOf } from './model'

const named = (e: PassiveEffect, label: string): PassiveEffect => ({ ...e, label: e.label ?? label })

/** 這個人現在身上屬於「沉溺」這個來源的每一筆。 */
export function sinkPassives(rules: SinkRules, state: GameState, actor: ActorId): PassiveEffect[] {
  const a = state.actors[actor]
  if (!a) return []
  const value = a.sink
  const out: PassiveEffect[] = []

  const here = bandOf(rules, value)
  for (const band of rules.bands) {
    if (band.min > value) break
    for (const e of band.effects) out.push(named(e, band.name))
  }
  if (here.double) {
    for (const band of rules.bands) {
      if (band.min >= here.min) break
      for (const e of band.effects) if ('check' in e) out.push(named(e, `${band.name}（${here.name}：加倍）`))
    }
    // 餘韻的正面效果加倍（CORE_RULES 4.3 節 80～99；M4-core-gaps 第 8 項）：核心的標籤，戰鬥裡每層餘韻的正面數字讀它
    out.push({ unit_tag: AFTERGLOW_DOUBLE, label: `${here.name}：餘韻的正面效果加倍` })
  }
  if (value > SUNK_AT && rules.over_step > 0) {
    const extra = Math.floor((value - SUNK_AT) / rules.over_step)
    if (extra > 0) out.push({ stat: 'afterglow_cap', amount: extra, label: '沉得更深' })
  }

  const now = nowOf(state)
  for (const m of liveMods(readExt(state, actor), now)) out.push({ stat: 'sink_floor', amount: m.amount, label: m.why ?? (m.until === undefined ? '沉溺的下限' : '暫時的下限') })
  return out
}
