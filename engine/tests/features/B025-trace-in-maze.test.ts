// B025（邊界，2026-11-25）：迷宮館（樂園島的公開場館，區的 pressure 是 none、沒有追蹤度）裡，AI 給的追蹤度照收，記在迷宮館那張地圖上。
// 規格：EVENTS 2.4 節（`trace`：追蹤度在委託副本與企業的固定子網裡；±20）；CYBERSPACE 6.8 節（公開的地方——港灣、大街、樂園島——沒有追蹤度）；
//       AI_TASKS 2.5 節（不收的那一筆整筆拿掉並提醒）。
// 重現：dev/bugs/B025-trace-in-maze.md；engine/tests/boundary/fixtures/B025-trace-in-maze.json。
// 已修（M3 白箱修正批）：features/netrun 的追蹤度量表的 accepts 多看一條「這一趟的區 pressure 是 trace」，不是的回「這裡沒有追蹤度。」，AI 與玩家要的那一筆整筆拿掉並留提醒。
// 對照（自己去挖的子網照收、夾 ±20）在 tests/features/M3-net.boundary.test.ts「AI 給的追蹤度」。

import { describe, expect, it } from 'vitest'
import { clone, effectCtx, meterOf } from '../../src'
import { diveIn, makeDiveGame, mazeSignUp, refitForRookie } from '../../src/testkit'

describe('B025：沒有追蹤度的地方，AI 給的追蹤度整筆拿掉並提醒', () => {
  it('迷宮館裡（潛入、報名新手組、站在第一層），AI 給追蹤度 +5：不產生變更、留一行白話的提醒、量表沒有記這張圖', () => {
    const { game: g } = makeDiveGame({ seed: 4 })
    refitForRookie(g)
    diveIn(g)
    mazeSignUp(g)
    const map = g.state.maps.at!.map
    const r = g.k.effects.resolve([{ kind: 'trace', amount: 5 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([])
    expect(r.clamps.length).toBe(1)
    expect(r.clamps[0]!.notice).not.toMatch(/[A-Za-z_]{2,}/)
    if (r.changes.length) g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: 't' } })
    expect(g.state.meters.trace?.[map]).toBeUndefined()
    expect(meterOf(g.k, g.state, 'trace', map)).toBe(0)
  })
})
