// B029（白箱，2026-11-25）：餘韻在戰鬥外不隨時間消退。內海打完硬仗之後餘韻跟回現實（CYBERSPACE 4.1 節），CORE_RULES 4.3 節寫「餘韻怎麼消：脫離戰鬥後每十分鐘消一層；短休全消；冷卻劑立刻消一層」，
// 引擎只做了短休全消（features/rest/ops.ts）；時間過去（10 分鐘、一天）餘韻一層都不少。
// 重現：dev/bugs/B029-afterglow-never-decays.md；engine/tests/whitebox/fixtures/B029-afterglow-never-decays.json。
// 已修（M3 白箱修正批；使用者 2026-11-25）：features/character 的 afterglow.ts：餘韻增加的那份報告記計時起點（actor.ext.glow_at），time.passed 每滿十分鐘消一層。完整的情境在 tests/features/M3-fix-whitebox.test.ts。

import { describe, expect, it } from 'vitest'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']
const sys = (g: G, action: string, changes: unknown[]) => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })

describe('B029：餘韻脫離戰鬥後每十分鐘消一層（CORE_RULES 4.3 節）', () => {
  it('在內海疊了兩層餘韻、戰鬥結束：過 9 分鐘還是兩層；過 10 分鐘剩一層；過 20 分鐘剩零層', () => {
    const at = (minutes: number): number => {
      const { game } = makeNetBattleGame({ noBattle: true })
      sys(game, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 2 }])
      expect(game.state.actors.pc!.afterglow).toBe(2)
      sys(game, 'test.time', [{ op: 'time', minutes }])
      return game.state.actors.pc!.afterglow
    }
    expect(at(9)).toBe(2)
    expect(at(10)).toBe(1)
    expect(at(20)).toBe(0)
  })

  it('一天之後：餘韻已經全消（現在是兩層）', () => {
    const { game } = makeNetBattleGame({ noBattle: true })
    sys(game, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 3 }])
    sys(game, 'test.time', [{ op: 'time', minutes: 24 * 60 }])
    expect(game.state.actors.pc!.afterglow).toBe(0)
  })
})
