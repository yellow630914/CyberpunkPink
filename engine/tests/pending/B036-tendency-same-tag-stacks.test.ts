// B036（邊界，cpp-tester-boundary）：AI 一件事對同一個傾向標籤給幾筆就長幾點。
// 規格：EVENTS 2.4 節的表 tendency「一個標籤一點」；表上方「每件是一件事加起來……拆成幾筆給也一樣」。
// 重現：tests/pending/fixtures/B036-tendency-same-tag-stacks.json。dev/bugs/B036-tendency-same-tag-stacks.md。

import { describe, expect, it } from 'vitest'
import { clone } from '../../src'
import { makeCityGame } from '../../src/testkit'
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
})
