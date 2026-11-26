// B036（邊界，cpp-tester-boundary）：AI 一件事對同一個傾向標籤給幾筆就長幾點。
// 規格：EVENTS 2.4 節的表 tendency「一個標籤一點」；表上方「每件是一件事加起來……拆成幾筆給也一樣」。
// 重現：tests/pending/fixtures/B036-tendency-same-tag-stacks.json。dev/bugs/B036-tendency-same-tag-stacks.md。

import { describe, expect, it } from 'vitest'
import { clone, effectCtx } from '../../src'
import { makeBodyGame, makeCityGame } from '../../src/testkit'
import { ctxOf, fixture } from './_b03x'
import type { Route } from './_b03x'

interface Case { route: Route; effects: unknown[]; expect_points: Record<string, number> }
const fx = fixture<{ cases: Case[] }>('B036-tendency-same-tag-stacks')
const TEXT = '我說我想學一點新東西'

describe('B036：同一個傾向標籤，一件事最多一點（AI 的與開著時玩家要的）', () => {
  for (const c of fx.cases) {
    it(`${c.route}：${c.effects.length} 筆同一個標籤 → 那一軸 +1`, () => {
      const { game: g } = makeCityGame()
      const r = g.k.effects.resolve(c.effects, ctxOf(g, c.route, TEXT))
      expect(r.errors).toEqual([])
      g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
      const points = (g.state.actors.pc!.ext.tendency as { points: Record<string, number> }).points
      for (const [axis, want] of Object.entries(c.expect_points)) expect(points[axis], axis).toBe(want)
      expect(r.clamps.length).toBeGreaterThan(0)
    })
  }

  // 規格要問的那一點（dev/bugs/B036）照「每個標籤各最多一點」讀：一件事給三個不同的標籤，三個都長（各一點）；同一個標籤的第二筆以後被夾
  it('不同的標籤各長一點：支配、服從各一筆再加一筆支配，那一軸是 2 點，只有第二筆支配被夾；內建的照寫的算（三筆都長）', () => {
    const g = makeBodyGame().game
    const effects = [{ kind: 'tendency', tag: 'tg_tw_dom' }, { kind: 'tendency', tag: 'tg_tw_sub' }, { kind: 'tendency', tag: 'tg_tw_dom' }]
    const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source: 'ai' }))
    expect(r.errors).toEqual([])
    expect(r.clamps).toHaveLength(1)
    expect(r.clamps[0]!.notice).toContain('支配')
    g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
    expect((g.state.actors.pc!.ext.tendency as { points: Record<string, number> }).points.relation).toBe(2)
    const h = makeBodyGame().game
    const free = h.k.effects.resolve(effects, effectCtx(h.k, h.state, { source: 'builtin' }))
    expect(free.clamps).toEqual([])
    h.commit({ kind: 'event', action: 'event.test', location: clone(h.state.location), party: [], timeline: [], changes: free.changes, outcome: { result: 'ok', summary: '測試' } })
    expect((h.state.actors.pc!.ext.tendency as { points: Record<string, number> }).points.relation).toBe(3)
  })
})

