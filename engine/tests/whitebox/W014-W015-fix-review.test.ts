// 白箱找到的兩個問題（M2 引擎修正批之後；cpp-tester-whitebox 2026-11-23）。已修（M2-fix-bugs）。
// W014：dev/bugs/2026-11-23-W014.md，重現 tests/whitebox/fixtures/W014-pressure-lost-when-crossing-starts-fight.json
// W015：dev/bugs/2026-11-23-W015.md，重現 tests/whitebox/fixtures/W015-weekly-rolled-twice.json
// W014：警戒讓目標達成的那份報告同時跨過門檻時，先發 pressure 再接 milestone；W015：跨過週一時 turn.end 不再收 bill.settle 帶的 weekly（time.passed 已經擲過）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature } from '../../src'
import { STRONG_PC, makeCityGame, makeWorldGame, passUntil, playStage } from '../../src/testkit'
import { readRun } from '../../src/features/commission'
import { arrive } from '../../src/features/world'

type Fx = Record<string, unknown>

describe('W014（EVENTS 3.1 節 stage「壓力條跨過 60」、3.3 節「壓力條 15%」）：警戒在開打的那一步跨過門檻，這一擲不見了', () => {
  /** 被保全發現的那一步（開打的那一份報告）同時把警戒推到 70：例如這一格有監視器（+2）。 */
  const BUMP: Feature = {
    id: 'w014_bump',
    install(k) {
      k.hooks.on('report.before', 'w014_bump', ({ state, draft }) => {
        const run = readRun(state)
        if (!run || run.step !== 'play' || !run.map || run.stage !== 1) return
        const startsFight = draft.changes.some((c) => c.op === 'snapshot.add' && (c as { slot?: { kind?: string } }).slot?.kind === 'battle')
        return startsFight ? [{ op: 'meter', kind: 'alert', key: run.map, set: 70 }] : undefined
      })
    },
  }
  // 階段開始不擲（0），壓力條必中（1），好數
  const SCOPE: Fx = { id: 'commission', triggers: { stage: 0, pressure: 1 }, events_as: { pressure: 'stage' }, priority: 1, in_commission: true, unique_in_commission: true, lost: 'drop' }
  const PACK: ContentPack = {
    id: 'w014', content: { event_scope: [SCOPE], event: [{ id: 'ev_w014', scope: 'commission', triggers: ['stage'], blocking: false, text: '警戒升高了。', effects: [] }] } as unknown as ContentPack['content'],
  }

  it('第一個階段（目標是打贏）在開打的那一步跨過 60：這個階段要有一份 commission.pressure，導演放行事件；下一個階段一開地圖已經在 60 以上，不會再補', async () => {
    const { game: g } = makeWorldGame({ seed: 5, pc: STRONG_PC, features: [BUMP], content: [PACK], patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } } })
    g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'w014', ref: 'cm_tw_office' })
    const first = await playStage(g)
    const actions = first.map((r) => r.action)
    expect(actions).toContain('battle.start') // 前提：真的是在開打的那一步跨過
    expect(readRun(g.state)).toMatchObject({ stage: 2, alert: 70 }) // 前提：警戒帶到下一個階段
    // 實際：commission.face commission.branch grid.move battle.start battle.end commission.milestone（沒有 commission.pressure）
    expect(actions).toContain('commission.pressure')
    expect(g.state.reports.filter((r) => r.action === 'event.notice')).toHaveLength(1)
  })
})

describe('W015（EVENTS 3.1 節 weekly「每週一的帳單結算之後」、3.3 節家園的 weekly）：跨過一個週一，weekly 擲了兩次', () => {
  const PACK: ContentPack = {
    id: 'w015', content: {
      // 必中、沒有冷卻與不重複天數：擲幾次就出幾則，看得出來擲了幾次（真的家園範圍是 6 小時冷卻：第一擲沒中時第二擲再給一次機會，機率變成 1 − (1 − p)²）
      event_scope: [{ id: 'wk_test', triggers: { weekly: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
      event: [{ id: 'ev_w015', scope: 'wk_test', triggers: ['weekly'], blocking: false, text: '一週又過了。', effects: [] }],
    } as unknown as ContentPack['content'],
  }
  const notices = (without: string[]): number => {
    const t = makeCityGame({ content: [PACK], ...(without.length > 0 ? { without } : {}) })
    passUntil(t.game, { day: t.game.state.time.day + 1, hour: 9 }) // 星期日 10:00 → 星期一 09:00：跨過一次週一 06:00
    return t.game.state.reports.filter((r) => r.action === 'event.notice').length
  }

  it('對照：沒有帳單的功能，跨過週一只擲一次（導演自己 time.passed 的那一擲）', () => {
    expect(notices(['bills'])).toBe(1)
  })

  it('有帳單的功能：還是只擲一次（實際 2 次：bill.settle 帶的 weekly 觸發點在 turn.end 又被收了一次）', () => {
    expect(notices([])).toBe(1)
  })
})
