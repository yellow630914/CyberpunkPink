// L6 功能：探索（COMBAT_SYSTEM 第 10 節；COMMISSION_MAPS 1.3、1.5 節；SITES 12.5 節；dev/work/M1-explore.md、M2-explore.md）。
//
// 在格子地圖上走：走進有監視器的區塊警戒上升、被保全看到就開那個保全崗的遭遇（潛行時只加警戒）、巡邏的保全每一步往下一個區塊走、
// 上鎖的門要憑證或接管（撬鎖與破門另外動手）、站在標記上能做的事（拿、插上、接管、打開、帶走、離開）、警戒到 60 增援加進下一場。
// 保全崗放誰、潛行、DC、遭遇點、增援與帶進戰鬥的 origin 都由開地圖的功能寫在這份實例的 ext 上（見 ext.ts），
// 這個功能不知道委託是什麼，也不知道敵人的資料。
//
// 還沒做的（SITES 12.5 節）：黑暗時察覺陷阱 DC +3（沒有陷阱）、「巡邏減半」以外的連動效果。

import type { Feature, GameState, GridKernel, ReportDraft } from '../../core'
import { clone, pointKey } from '../../core'
import { unlock, useAt, usesAt } from './uses'
import { installWalk } from './walk'

export type { GuardPost } from './ext'
export { placeGuards } from './ext'
export { unlock }

const OWNER = 'explore'

export const exploreFeature: Feature & { useHere(k: GridKernel, state: GameState, id: string): ReportDraft } = {
  id: OWNER,
  install(k) {
    // 警戒：照地圖的實例記，0～100；AI 給的效果一件事合計最多 ±20（EVENTS 2.4）
    k.meters.define({ kind: 'alert', owner: OWNER, name: '警戒', min: 0, max: 100, start: 0, keyed: 'map', cap: { down: 20, up: 20 } })

    installWalk(k, OWNER)

    // 打贏了：那個保全崗清掉（站著的記成 used；巡邏的記成 gone）
    k.battle.onEnd(OWNER, ({ state, battle, outcome }) => {
      const ext = battle.origin.ext
      if (outcome !== 'win' || !ext || typeof ext.guard !== 'string') return
      const map = ext.map
      const sheet = ext.sheet
      if (typeof map !== 'string' || typeof sheet !== 'string' || !state.maps.instances[map]) return
      if (ext.patrol === true) {
        const cur = state.maps.instances[map]!.sheets[sheet]?.movers[ext.guard]
        const at = Array.isArray(ext.at) ? [Number(ext.at[0]), Number(ext.at[1])] : [0, 0]
        return { changes: [{ op: 'map.sheet', map, sheet, movers: { [ext.guard]: { at: cur ? clone(cur.at) : at, leg: cur?.leg ?? 0, gone: true } } }] }
      }
      const at = ext.at
      if (!Array.isArray(at)) return
      return { changes: [{ op: 'map.sheet', map, sheet, cells: { [pointKey(Number(at[0]), Number(at[1]))]: { used: true } } }] }
    })

    k.grid.usesOf(OWNER, (ctx, marker) => usesAt(k, ctx, marker))

    // 探索進行中的行動放行（副本是封閉的活動：白名單；dev/adr/0016 第一節）
    k.activity.allow('commission', 'grid.', OWNER)
    k.activity.allow('commission', 'commit:grid.', OWNER)
  },

  useHere(k, state, id) {
    return useAt(k, state, id)
  },
}
