// L6 功能 drugs 給畫面的總覽：這個人身上生效的藥、成癮與戒斷、抑制劑、背包裡的藥能不能吃、這裡能不能做戒斷療程。
// 每一項的 block 是現在做不了的原因（一句完整的話；能做是 null）；數字與原因都從各個入口來，畫面不自己算。

import type { ActorId, GameState, Kernel } from '../../core'
import { countItem } from '../../core'
import { detoxBlock, detoxHere, detoxQuote } from './detox'
import type { DetoxQuote } from './detox'
import { useBlock } from './dose'
import { DAY, drugDef, drugIds, drugRules, isLive, nowOf, readDrugs } from './model'

export interface ViewActive {
  id: string
  name: string
  /** 藥效到什麼時候（總分鐘）；被戰鬥接住的撐到喘口氣，until 只是原本的期限 */
  until: number
  /** 還有幾分鐘；被戰鬥接住的是 null */
  left: number | null
  battle: boolean
}
export interface ViewAddiction {
  id: string
  name: string
  value: number
  /** none 不到依賴、dependent 依賴、heavy 重度 */
  stage: 'none' | 'dependent' | 'heavy'
  last: number
  /** 依賴的人還要幾分鐘沒用就進入戒斷；已經在戒斷中或不到依賴是 null */
  until_withdrawal: number | null
  withdrawal: { until: number; heavy: boolean; left: number } | null
  detox: { quote: DetoxQuote | null; block: string | null }
}
export interface ViewUsable {
  item: string
  name: string
  qty: number
  block: string | null
}
export interface DrugView {
  actor: ActorId
  active: ViewActive[]
  /** 藥效過後還在持續的被動效果（頭痛、疲勞） */
  after: Array<{ id: string; name: string; until: number }>
  addiction: ViewAddiction[]
  suppressant: { weekly: boolean; active: boolean; until: number | null; rebound: boolean; rebound_until: number | null; price: number }
  usable: ViewUsable[]
  /** 腳下有沒有提供戒斷療程的地方 */
  detox_here: { name: string; free: boolean } | null
}

export function drugView(k: Kernel, state: GameState, actor: ActorId): DrugView | null {
  if (!state.actors[actor]) return null
  const now = nowOf(state)
  const d = readDrugs(state, actor)
  const rules = drugRules(k)
  const name = (id: string): string => drugDef(k, id)?.name ?? id
  const s = d.suppressant
  const ids = [...new Set([...Object.keys(d.addiction), ...Object.keys(d.withdrawal)])]
  return {
    actor,
    active: d.active.filter((a) => isLive(a, now)).map((a) => ({ id: a.id, name: name(a.id), until: a.until, left: a.battle ? null : a.until - now, battle: a.battle === true })),
    after: d.pending.filter((p) => p.kind === 'after' && p.at > now).map((p) => ({ id: p.drug, name: name(p.drug), until: p.at })),
    addiction: ids.map((id): ViewAddiction => {
      const row = d.addiction[id]
      const wd = d.withdrawal[id]
      const value = row?.value ?? 0
      const stage = value >= rules.heavy_at ? 'heavy' : value >= rules.depend_at ? 'dependent' : 'none'
      const start = row && !wd && stage !== 'none' ? row.last + (stage === 'heavy' ? rules.heavy_days : rules.depend_days) * DAY : null
      return {
        id, name: name(id), value, stage, last: row?.last ?? 0,
        until_withdrawal: start === null ? null : Math.max(0, start - now),
        withdrawal: wd && wd.until > now ? { until: wd.until, heavy: wd.heavy, left: wd.until - now } : null,
        detox: { quote: detoxQuote(k, state, { actor, drug: id }), block: detoxBlock(k, state, { actor, drug: id }) },
      }
    }),
    suppressant: {
      weekly: s?.weekly === true, active: s?.until !== undefined && s.until > now, until: s?.until ?? null,
      rebound: s?.rebound_until !== undefined && s.rebound_until > now, rebound_until: s?.rebound_until ?? null, price: rules.suppressant.price,
    },
    usable: drugIds(k).filter((id) => countItem(state.inventory, id) > 0).map((id) => ({ item: id, name: name(id), qty: countItem(state.inventory, id), block: useBlock(k, state, { actor, item: id }) })),
    detox_here: detoxHere(k, state),
  }
}
