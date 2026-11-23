// 白箱：委託副本的每一個動作在「不對的時候」做：順序亂、沒有的面與路、目標種類不對、撤退與喘口氣的時機。
// 規格：COMMISSIONS 2.3、第 3～5 節、6.2 節（階段之間才喘口氣、撤退）；dev/adr/0016 第五節；dev/invariants.md 第 1、4 條（被擋下的動作不改狀態）。
// 做法：副本走到每一步（選面、選分支、地圖上、做完），把會改狀態的八個動作（chooseFace、chooseBranch、milestone、checkGoal、playScene、replay、breathe、finish）
// 各用壞參數或不對的時機叫一遍：只能成立、或丟 ActionBlocked（原因是完整的一句話），絕不丟別的；被擋下的，狀態一個字都不變；撤退之後副本整個消失、不能再叫。

import { describe, expect, it } from 'vitest'
import { ActionBlocked } from '../../src'
import { breathe, breatheBlock, checkGoal, chooseBranch, chooseFace, finish, milestone, playScene, readRun, replay, retreat, commissionView } from '../../src/features/commission'
import { go, latestJob } from '../../src/features/fixer'
import { makeCommissionGame, playStage, stateHash } from '../../src/testkit'
import type { Game } from '../../src/shell/game'

type Call = [string, (g: Game) => unknown]
const CALLS: Call[] = [
  ['chooseFace(net)', (g) => chooseFace(g.k, g.state, 'net')],
  ['chooseFace(opinion)', (g) => chooseFace(g.k, g.state, 'opinion')],
  ['chooseFace(壞值)', (g) => chooseFace(g.k, g.state, 'x' as never)],
  ['chooseFace(null)', (g) => chooseFace(g.k, g.state, null as never)],
  ['chooseBranch(不存在)', (g) => chooseBranch(g.k, g.state, 'no_such_branch')],
  ['chooseBranch(空字串)', (g) => chooseBranch(g.k, g.state, '')],
  ['chooseBranch(__proto__)', (g) => chooseBranch(g.k, g.state, '__proto__')],
  ['milestone', (g) => milestone(g.k, g.state)],
  ['checkGoal', (g) => checkGoal(g.k, g.state)],
  ['playScene', (g) => playScene(g.k, g.state)],
  ['replay', (g) => replay(g.k, g.state)],
  ['breathe', (g) => breathe(g.k, g.state)],
  ['finish', (g) => finish(g.k, g.state)],
]

/** 每一個動作叫一遍：成立的回傳草稿（不改狀態）、不成立的丟 ActionBlocked 且原因不是空的；回傳哪幾個成立。 */
function probe(g: Game, where: string): string[] {
  const ok: string[] = []
  for (const [name, fn] of CALLS) {
    const before = stateHash(g.state)
    try {
      const d = fn(g) as { action?: string } | undefined
      expect(d, `${where} ${name}`).toBeDefined()
      ok.push(name)
    } catch (e) {
      expect(e, `${where} ${name}：${(e as Error).message}`).toBeInstanceOf(ActionBlocked)
      expect((e as ActionBlocked).reason.length, `${where} ${name} 原因是空的`).toBeGreaterThan(5)
    }
    expect(stateHash(g.state), `${where} ${name} 改了狀態`).toBe(before)
  }
  return ok
}

describe('白箱 副本的動作在不對的時候做', () => {
  it('每一步（選面、選分支、地圖上、做完一個階段）：不成立的都被擋、原因寫得出來、狀態不動；成立的只有該步該有的', async () => {
    const t = makeCommissionGame({ seed: 6 })
    const { game: g, job } = t
    g.commit(go(g.k, g.state, job))
    expect(readRun(g.state)?.step).toBe('face')
    const atFace = probe(g, '選面')
    expect(atFace).not.toContain('chooseBranch(不存在)')
    expect(atFace).not.toContain('milestone')
    expect(atFace).not.toContain('finish')
    expect(atFace).not.toContain('replay')
    expect(atFace).not.toContain('chooseFace(壞值)')
    expect(atFace).not.toContain('chooseFace(null)')

    g.commit(chooseFace(g.k, g.state, 'meat'))
    expect(readRun(g.state)?.step).toBe('branch')
    const atBranch = probe(g, '選分支')
    expect(atBranch).not.toContain('chooseFace(net)')
    expect(atBranch).not.toContain('chooseBranch(不存在)')
    expect(atBranch).not.toContain('chooseBranch(__proto__)')
    expect(atBranch).not.toContain('milestone')

    g.commit(chooseBranch(g.k, g.state, 'assault'))
    expect(readRun(g.state)?.step).toBe('play')
    const atPlay = probe(g, '地圖上')
    expect(atPlay).not.toContain('finish')
    expect(atPlay).not.toContain('chooseFace(net)')
    expect(atPlay).not.toContain('breathe')
    expect(atPlay).not.toContain('chooseBranch(不存在)')
    expect(commissionView(g.k, g.state)).not.toBeNull()
  })

  it('打完第一個階段之後（階段之間）：可以喘一口氣一次；喘過之後再喘被擋；喘氣不改選面的狀態；做完之前 finish 被擋', async () => {
    const t = makeCommissionGame({ seed: 6 })
    const { game: g, job } = t
    g.commit(go(g.k, g.state, job))
    await playStage(g)
    const run = readRun(g.state)!
    expect(run.stage).toBe(2)
    expect(run.step).toBe('face')
    expect(breatheBlock(g.state, run)).toBeNull()
    probe(g, '階段之間')
    g.commit(breathe(g.k, g.state))
    expect(breatheBlock(g.state, readRun(g.state)!)).toContain('喘過一口氣')
    expect(() => breathe(g.k, g.state)).toThrow('喘過一口氣')
    expect(() => finish(g.k, g.state)).toThrow(ActionBlocked)
  })

  it('撤退：沒有進行中的副本時被擋；撤退之後副本整個消失，所有動作都被擋；戰鬥中不能撤退', () => {
    const t = makeCommissionGame({ seed: 6 })
    const { game: g, job } = t
    expect(() => retreat(g.k, g.state)).toThrow(ActionBlocked)
    expect(() => chooseFace(g.k, g.state, 'meat')).toThrow(ActionBlocked)
    g.commit(go(g.k, g.state, job))
    g.commit(retreat(g.k, g.state))
    expect(readRun(g.state)).toBeNull()
    for (const [name, fn] of CALLS) expect(() => fn(g), name).toThrow(ActionBlocked)
    expect(latestJob(g.state)?.status).toBe('active')
  })
})
