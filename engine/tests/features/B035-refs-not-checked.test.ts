// B035（邊界，cpp-tester-boundary）：效果引用的 id 不存在照收（grace.item、roster_add.who、memory.who）；grace 那一行寫 id 不寫名字。
// 規格：AI_TASKS 2.5 節（不論開關：「引用的 id 要存在」）；EVENTS 2.4 節（不合的整筆拿掉並提醒也算不收）；effects.ts 的 describe「不寫欄位名稱」。
// 重現：tests/pending/fixtures/B035-refs-not-checked.json。dev/bugs/B035-refs-not-checked.md。

import { describe, expect, it } from 'vitest'
import { makeCityGame } from '../../src/testkit'
import { ctxOf, fixture } from './_b03x'
import type { Route } from './_b03x'

interface Case { routes: Route[]; effects: unknown[]; ghost: string }
const fx = fixture<{ cases: Case[]; line_case: { route: Route; effects: unknown[]; expect_line_not_contains: string } }>('B035-refs-not-checked')

describe('B035：引用不存在的 id 不收', () => {
  for (const c of fx.cases) {
    for (const route of c.routes) {
      it(`${route}：${JSON.stringify(c.effects)} 沒有一筆變更帶著 ${c.ghost}`, () => {
        const { game: g } = makeCityGame()
        const r = g.k.effects.resolve(c.effects, ctxOf(g, route, fx.player_input))
        expect(r.changes.filter((x) => JSON.stringify(x).includes(c.ghost))).toEqual([])
        // 不收的方式二選一：格式錯誤，或整筆拿掉並提醒
        expect(r.errors.length + r.clamps.length).toBeGreaterThan(0)
      })
    }
  }
  it('grace 的定案結果那一行寫帳單項目的名字，不寫 id', () => {
    const { game: g } = makeCityGame()
    const r = g.k.effects.resolve(fx.line_case.effects, ctxOf(g, fx.line_case.route))
    expect(r.errors).toEqual([])
    expect(r.lines.join('')).not.toContain(fx.line_case.expect_line_not_contains)
  })
})
