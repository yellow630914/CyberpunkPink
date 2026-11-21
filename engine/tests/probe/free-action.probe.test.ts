// 探針腳本的樣本（dev/test-harness.md 第 6 節「探針」）：建情境 → 開探針 → 執行 → 輸出事件串。
// 每支腳本對一個系統；這一支對自由行動的任務鏈。cpp-tester-probe 照這個樣子寫別的系統的，
// 事件串用 summarize() 排成一行一個，寫進 dev/probes/<系統>-<日期>.md。

import { describe, expect, it } from 'vitest'
import { makeGame, observed, summarize } from '../../src/testkit'

describe('探針：自由行動', () => {
  it('事件帶時間順序、來源模組與內容的快照', async () => {
    const { game } = makeGame({ fake: true })
    const { events, violations } = await observed(game, () => game.act({ kind: 'free', text: '我看看四周' }))
    expect(violations).toEqual([])
    const lines = summarize(events)
    // 順序：每一步的狀態 → AI 任務 → 效果的結算 → 提交前 → 提交後
    const first = (needle: string) => lines.findIndex((l) => l.includes(needle))
    expect(first('chain.step roll running')).toBe(0)
    expect(first('task.done judge')).toBeGreaterThan(first('chain.step judge running'))
    expect(first('effects.resolve')).toBeGreaterThan(first('chain.step reward running'))
    expect(first('chain.step text running')).toBeGreaterThan(first('chain.step reward done'))
    expect(first('core/state/commit report.before')).toBeGreaterThan(first('chain.step text done'))
    expect(first('core/state/commit report.after')).toBeGreaterThan(first('core/state/commit report.before'))
    expect(new Set(events.map((e) => e.source))).toEqual(new Set(['shell/ai/chain', 'shell/ai/tasks', 'core/rules/effects', 'core/state/commit']))
    // 快照是複製的：之後狀態再變也不影響
    const before = events.find((e) => e.type === 'report.before')!.data as { state: { money: { cash: number } } }
    game.commit({ kind: 'system', location: {}, party: [], timeline: [], changes: [{ op: 'cash', delta: 99 }], outcome: { result: 'x', summary: 'x' } })
    expect(before.state.money.cash).toBe(0)
  })

  it('沒有 start() 的時候不記任何東西，也不呼叫組資料的函式', () => {
    const { game } = makeGame()
    let called = 0
    game.k.probe.emit('test', 'x', () => { called++; return {} })
    expect(called).toBe(0)
    expect(game.k.probe.stop()).toEqual([])
  })
})
