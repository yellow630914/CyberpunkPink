// B019（cpp-tester-boundary）：忠誠只有名冊上的人有（NPC_SYSTEM 10.4 節：「忠誠（0～100）……只有名冊上的人有」）。
// AI 給不在名冊上的人忠誠，引擎照收（state.meters.loyalty 多一個鍵），結果的那一行寫「忠誠（街坊小周）：+5」，正文會照它寫。
// 重現的資料：tests/boundary/fixtures/B019-loyalty-non-member.json。修好之後搬到 tests/boundary/。

import { describe, expect, it } from 'vitest'
import { effectCtx, meterOf } from '../../src'
import { RUNNER, makeCommissionGame } from '../../src/testkit'

const SEED = 6

describe('B019：AI 給的忠誠只算名冊上的人', () => {
  it('不在名冊上的人（npc_tw_friend）：不記、不寫結果的那一行', () => {
    const { game: g } = makeCommissionGame({ seed: SEED })
    const r = g.k.effects.resolve([{ kind: 'loyalty', key: 'npc_tw_friend', amount: 5 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(r.changes).toEqual([])
    expect(r.lines).toEqual([])
    expect(g.state.meters.loyalty?.npc_tw_friend).toBeUndefined()
  })

  it('對照（現在會過）：名冊上的行者照收，30 → 35', () => {
    const { game: g } = makeCommissionGame({ seed: SEED })
    const r = g.k.effects.resolve([{ kind: 'loyalty', key: RUNNER, amount: 5 }], effectCtx(g.k, g.state, { source: 'ai' }))
    g.commit({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
    expect(meterOf(g.k, g.state, 'loyalty', RUNNER)).toBe(35)
  })
})
