// 探針腳本：一場戰鬥（dev/test-harness.md 第 6 節「探針」）。建情境 → 開探針 → 執行 → 看事件串。
// 戰鬥的每一步是一份報告（dev/adr/0011），所以探針看到的就是「提交前 → 提交後」一對一對的事件；
// 戰鬥裡的掛點（battle:attack.before……）有人掛上去才會出現在事件串裡。

import { describe, expect, it } from 'vitest'
import type { Feature } from '../../src'
import { TEST_ACTIONS, TEST_COMBAT, makeBattleGame, observed, playOut, summarize } from '../../src/testkit'

describe('探針：戰鬥', () => {
  it('每一步：提交前、提交後各一個事件，戰鬥狀態的變化都在報告的 changes 裡', async () => {
    const { game } = makeBattleGame({ seed: 5 })
    const b = game.state.battle!
    b.turn = b.order.indexOf('a3')
    const { events, violations } = await observed(game, () => game.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'f2' } }))
    expect(violations).toEqual([])
    expect(summarize(events).map((l) => l.replace(/^\d+ /, ''))).toEqual(['core/state/commit report.before r3', 'core/state/commit report.after r3'])
    const after = events[1]!.data as { report: { changes: Array<{ op: string }>; timeline: Array<{ tag?: string }> } }
    expect(after.report.changes.map((c) => c.op)).toEqual(['battle'])
    expect(after.report.timeline.map((x) => x.tag)).toEqual(expect.arrayContaining(['cover.hit']))
  })

  it('登錄表註冊與戰鬥裡的掛點都看得到；整場打完沒有違反不變式', async () => {
    const spy: Feature = { id: 'spy', install: (k) => { k.battle.on('attack.before', 'spy', () => {}); k.battle.on('out', 'spy', () => {}) } }
    const { game } = makeBattleGame({ seed: 5, features: [TEST_COMBAT, spy] })
    const { events, violations } = await observed(game, () => playOut(game))
    expect(violations).toEqual([])
    const hooks = events.filter((e) => e.type === 'hook.call').map((e) => (e.data as { hook: string }).hook)
    expect(new Set(hooks)).toEqual(new Set(['battle:attack.before', 'battle:out']))
    expect(hooks.filter((h) => h === 'battle:out').length).toBeGreaterThanOrEqual(4)
  })
})
