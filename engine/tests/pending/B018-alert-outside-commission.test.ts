// B018（cpp-tester-boundary）：AI 給的警戒只在委託副本裡（EVENTS 2.4 節：「alert、trace | 警戒只在委託副本裡……；±20」）；
// 引用的 id 要存在（AI_TASKS 2.5 節：「引用的 id 要存在」，設定關著也照擋）。
// 引擎（core/rules/meters.ts 的量表效果；features/explore 定義的 alert）在城市的街區地圖上照收，key 寫一張不存在的地圖實例也照收。
// 重現的資料：tests/boundary/fixtures/B018-alert-outside-commission.json。修好之後搬到 tests/boundary/。

import { describe, expect, it } from 'vitest'
import { clone, effectCtx, meterOf } from '../../src'
import { chooseBranch, chooseFace, readRun } from '../../src/features/commission'
import { go } from '../../src/features/fixer'
import { makeCityGame, makeCommissionGame } from '../../src/testkit'

const SEED = 6
const resolve = (g: ReturnType<typeof makeCityGame>['game'], effects: unknown[]) => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source: 'ai' }))

function inStage() {
  const t = makeCommissionGame({ seed: SEED })
  const g = t.game
  g.commit(go(g.k, g.state, t.job))
  g.commit(chooseFace(g.k, g.state, 'meat'))
  g.commit(chooseBranch(g.k, g.state, 'assault'))
  return { g, map: readRun(g.state)!.map! }
}

describe('B018：AI 給的警戒只在委託副本裡；不存在的地圖實例不收', () => {
  it('城市的街區地圖上（不在副本裡）：AI 給警戒 +5，警戒不變', () => {
    const { game: g } = makeCityGame({ seed: SEED })
    expect(g.state.maps.at).toBeTruthy()
    const before = clone(g.state.meters.alert ?? {})
    const r = resolve(g, [{ kind: 'alert', amount: 5 }])
    if (r.errors.length === 0 && r.changes.length) g.commit({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
    expect(g.state.meters.alert ?? {}).toEqual(before)
  })

  it('key 寫一張不存在的地圖實例（m999）：驗證不過（城市裡、副本裡都一樣）', () => {
    const { game: g } = makeCityGame({ seed: SEED })
    expect(g.state.maps.instances.m999).toBeUndefined()
    expect(resolve(g, [{ kind: 'alert', key: 'm999', amount: 1 }]).errors.length).toBeGreaterThan(0)
    const { g: h } = inStage()
    expect(h.state.maps.instances.m999).toBeUndefined()
    expect(resolve(h, [{ kind: 'alert', key: 'm999', amount: 1 }]).errors.length).toBeGreaterThan(0)
  })

  it('對照（現在會過）：副本裡照收，警戒 +5；+21 夾在 +20（只解析、不提交：強攻一開就在戰鬥裡）', () => {
    const { g, map } = inStage()
    const a = resolve(g, [{ kind: 'alert', amount: 5 }])
    expect(a.errors).toEqual([])
    expect(a.changes).toEqual([{ op: 'meter', kind: 'alert', key: map, delta: 5 }])
    const before = meterOf(g.k, g.state, 'alert', map)
    const b = resolve(g, [{ kind: 'alert', amount: 21 }])
    expect(b.changes).toEqual([{ op: 'meter', kind: 'alert', key: map, delta: Math.min(20, 100 - before) }])
    expect(b.clamps[0]).toMatchObject({ from: 21, to: 20 })
  })
})
