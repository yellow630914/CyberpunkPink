// 驗收測試：M4 收尾修正批・引擎（dev/work/M4-fix-engine.md）的雜項：
//   登入        任何方式進入內海都發 login 觸發點（委託的內海面、自己去的一趟、簾後館一趟、潛入）；從潛入裡開的不重複（裁決 7）
//   斷線靜修    （見下面的 describe）
// 內容一律是 testkit 的假世界（bodyWorld、city）；功能是全部；走的是真的功能與真的提交。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { chooseBranch, chooseFace } from '../../src/features/commission'
import { go } from '../../src/features/fixer'
import {
  CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, makeNetCommissionGame, sceneCast,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const logins = (rs: readonly Report[]): Array<{ action: string; where: Record<string, string> }> =>
  rs.flatMap((r) => (r.triggers ?? []).filter((t) => t.point === 'login').map((t) => ({ action: r.action ?? '', where: t.where as Record<string, string> })))

describe('任何方式進入內海都算一次登入（使用者 2026-11-26；EVENTS 4.5 節）', () => {
  it('委託的內海面（face.net 開始）：netrun.enter 帶 login，where 是身體所在的區與街區', () => {
    const { game: g, job } = makeNetCommissionGame()
    g.commit(go(g.k, g.state, job))
    g.commit(chooseFace(g.k, g.state, 'net'))
    const reports = g.commit(chooseBranch(g.k, g.state, 'assault'))
    const l = logins(reports)
    expect(l).toHaveLength(1)
    expect(l[0]!.action).toBe('netrun.enter')
    expect(l[0]!.where).toMatchObject({ block: 'tw_market' })
  })

  it('簾後館的一趟（街上的簾口，沒有潛入）：curtain.enter 開的 netrun.enter 帶 login', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g)
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(logins(reports)).toEqual([expect.objectContaining({ action: 'netrun.enter', where: expect.objectContaining({ block: 'tw_hall', facility: 'F4' }) })])
  })

  it('潛入：dive.enter 發 login；從潛入裡開的一趟（簾後館、迷宮館）不再發第二次', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    const prelude = curtainPrelude(g, { dive: true })
    expect(logins(prelude).map((x) => x.action)).toEqual(['dive.enter'])
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(reports.map((r) => r.action)).toContain('netrun.enter')
    expect(logins(reports)).toEqual([])
  })

  it('潛入之後的 login 總共只有一次：潛入 → 選去處開一趟 → 整串報告裡只有 dive.enter 的那一個', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g, { dive: true })
    curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(logins(g.state.reports).map((x) => x.action)).toEqual(['dive.enter'])
  })
})
