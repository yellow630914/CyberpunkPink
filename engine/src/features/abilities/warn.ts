// 容量變小時的提醒（工單 M4-abilities-m4；M4-cyber-bridge 回報）：換橋、裝拆義體之後，裝著的技能超過橋現在的容量，由這個功能自己提醒一句。
// 不自動卸（「學會的技能都還在，換橋只改變裝得下多少」，CYBERWARE 7.3 節）；超過的要自己整理，之後再裝或換配置時照新的容量擋。
// 只看這一份報告動過 actor.ext.cyber 的角色（義體的功能把身上的義體記在那個鍵；容量由衍生數值 bridge_cap_<類> 與 cap_discount、cap_flex 算，改變的來源都是義體）；
// 這個功能自己的報告（ability.*）不看。

import type { Kernel, ReportDraft } from '../../core'
import { clone } from '../../core'
import { abilitiesOf, capacityBlock, capacityOf } from './learn'
import { CATEGORIES, CATEGORY_NAME, OWNER } from './types'

export const CAPACITY_ACTION = 'ability.capacity'
/** 義體的功能記身上義體的 ext 鍵（資料慣例；這裡只看報告裡有沒有人動它，不讀它的內容） */
const CYBER_EXT = 'cyber'

export function registerCapacityWatch(k: Kernel): void {
  k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
    if (report.action?.startsWith('ability.')) return
    const touched = new Set<string>()
    for (const c of report.changes) {
      const t = c as { op: string; id?: unknown; key?: unknown }
      if (t.op === 'actor.ext' && t.key === CYBER_EXT && typeof t.id === 'string') touched.add(t.id)
    }
    const out: ReportDraft[] = []
    for (const id of touched) {
      const a = state.actors[id]
      if (!a || abilitiesOf(state, id).equipped.length === 0) continue
      const cap = capacityOf(k, state, id)
      if (capacityBlock(cap) === null) continue
      const parts = CATEGORIES.filter((c) => cap[c].used > cap[c].max).map((c) => `${CATEGORY_NAME[c]}要 ${cap[c].used} 點，橋只有 ${cap[c].max} 點`)
      const text = `${a.name}裝著的技能超過橋現在的容量（${parts.join('；')}）：不會自動卸下，超過的要自己整理。`
      out.push({
        kind: 'action', action: CAPACITY_ACTION, location: clone(state.location), actor: id, party: [], timeline: [{ layer: 'meat', actor: id, text, tag: CAPACITY_ACTION }],
        changes: [], outcome: { result: 'over_capacity', summary: text }, narration: { results: [text] },
      })
    }
    return out.length ? out : undefined
  })
}
