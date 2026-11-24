// B016（cpp-tester-boundary）：AI 給的體悟一件事最多 5 點（EVENTS 2.4 節的上限表：「insight | 體悟，一件最多 5 點」）。
// 已修（M2-fix-bugs）：量表的 cap 改成 ±5；使用者 2026-11-24 裁決往下不行，改成 { down: 0, up: 5 }（AI 只能加不能扣；dev/adr/0017 最後一批的補記）。
// 重現的資料：tests/boundary/fixtures/B016-insight-ai-cap.json（種子＋輸入＋期望）。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EffectCtx } from '../../src'
import { effectCtx, meterOf } from '../../src'
import { makeCityGame } from '../../src/testkit'

interface Case { effects: unknown[]; source: EffectCtx['source']; clampAsked?: boolean; playerInput?: string; expectDelta: number; expectClamped: boolean }
const FIX = JSON.parse(readFileSync(new URL('../boundary/fixtures/B016-insight-ai-cap.json', import.meta.url), 'utf8')) as { seed: number; cases: Case[] }

describe('B016：AI 給的體悟一件事最多 5 點（EVENTS 2.4）', () => {
  it.each(FIX.cases.map((c, i) => [i, c] as const))('第 %i 筆', (_i, c) => {
    const { game: g } = makeCityGame({ seed: FIX.seed })
    const before = meterOf(g.k, g.state, 'insight')
    const r = g.k.effects.resolve(c.effects, effectCtx(g.k, g.state, { source: c.source, clampAsked: c.clampAsked ?? true, ...(c.playerInput ? { playerInput: c.playerInput } : {}) }))
    expect(r.errors).toEqual([])
    if (r.changes.length) g.commit({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
    expect(meterOf(g.k, g.state, 'insight') - before).toBe(c.expectDelta)
    expect(r.clamps.length > 0).toBe(c.expectClamped)
  })

  it('量表的定義：AI 往上最多 5、往下 0（只能加不能扣）', () => {
    const { game: g } = makeCityGame({ seed: FIX.seed })
    expect(g.k.meters.get('insight')!.cap!.up).toBe(5)
    expect(g.k.meters.get('insight')!.cap!.down).toBe(0)
  })
})
