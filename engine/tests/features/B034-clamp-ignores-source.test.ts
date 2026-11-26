// B034（邊界，cpp-tester-boundary）：grace 與 bill 的加減一項不看來源，一律照上限夾。
// 規格：EVENTS 2.4 節開頭「上限只管 AI 自己生成的事件……內建的事件……不受這張表的上限限制」；AI_TASKS 2.5 節的表（設定關著、附 asked 而且對得上的只驗格式）。
// 重現：tests/pending/fixtures/B034-clamp-ignores-source.json。dev/bugs/B034-clamp-ignores-source.md。

import { describe, expect, it } from 'vitest'
import { toMinutes } from '../../src'
import { makeCityGame } from '../../src/testkit'
import { ctxOf, fixture } from './_b03x'
import type { Route } from './_b03x'

interface Case { route: Route; effects: unknown[]; expect: { op: string; days?: number; delta?: number; clamps: number }; control?: boolean }
const fx = fixture<{ cases: Case[] }>('B034-clamp-ignores-source')

describe('B034：內建的與「關著、asked 對得上」的 grace、bill（加減一項）照寫的算', () => {
  for (const c of fx.cases) {
    it(`${c.control ? '對照 ' : ''}${c.route}：${JSON.stringify(c.effects)}`, () => {
      const { game: g } = makeCityGame()
      const r = g.k.effects.resolve(c.effects, ctxOf(g, c.route, fx.player_input))
      expect(r.errors).toEqual([])
      expect(r.clamps).toHaveLength(c.expect.clamps)
      const ch = r.changes.find((x) => x.op === c.expect.op)!
      if (c.expect.days !== undefined) expect(ch.until).toBe(toMinutes(g.state.time) + c.expect.days * 1440)
      if (c.expect.delta !== undefined) expect(ch.delta).toBe(c.expect.delta)
    })
  }
})
