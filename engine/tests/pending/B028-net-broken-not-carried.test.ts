// B028（白箱，2026-11-25）：重的破損（net_broken）寫回角色之後，下一場內海戰鬥沒有人讀它：構裝槽在戰後立刻「修好」。
// 規格：CYBERSPACE 6.5 節「破損」——重（對方本來就有破損時再中一次）：到登出之後修好為止。
// 重現：dev/bugs/B028-net-broken-not-carried.md；engine/tests/whitebox/fixtures/B028-net-broken-not-carried.json。
// 對照的那一條（戰鬥結束時確實寫了 net_broken）在 tests/features/M3-netcombat.test.ts「再中一次（重）」，會過。

import { describe, expect, it } from 'vitest'
import { brokenOf } from '../../src/features/netcombat/model'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']

const sys = (g: G, changes: unknown[]) => g.commit({ kind: 'system', action: 'test.set', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })

function nextBattle(g: G): void {
  g.startBattle({
    mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
    foes: [{ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', color: 'pink', seed: 'w016' }],
    origin: { escapable: true, place: 'B028', faction: 'f_gang' },
  } as never)
}

describe('B028：重的破損到登出之後修好為止（CYBERSPACE 6.5 節）', () => {
  it('帶著 net_broken（上一場重創留下的）進下一場內海戰鬥：開打時就有一個構裝槽破損（或照雜兵的做法少 1 顆傷害骰）', () => {
    const { game } = makeNetBattleGame({ noBattle: true })
    // 上一場的結束報告寫的那一筆（features/netcombat/jam.ts 的 battle.onEnd）
    sys(game, [{ op: 'actor.condition', id: 'pc', condition: 'net_broken' }])
    expect(game.state.actors.pc!.conditions.map((c) => c.id)).toContain('net_broken')
    nextBattle(game)
    const u = Object.values(game.state.battle!.units).find((x) => x.actor === 'pc')!
    const net = u.ext.net as { dice_loss?: number }
    // 現在：broken 是空的、沒有 dice_loss——重創在戰後就沒有任何作用
    expect(brokenOf(u).length + (net.dice_loss ?? 0)).toBeGreaterThan(0)
  })

  it('沒有 net_broken 的對照：開打時沒有破損', () => {
    const { game } = makeNetBattleGame({ noBattle: true })
    nextBattle(game)
    const u = Object.values(game.state.battle!.units).find((x) => x.actor === 'pc')!
    expect(brokenOf(u)).toEqual([])
  })
})
