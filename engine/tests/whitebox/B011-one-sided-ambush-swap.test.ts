// B011：「一邊倒」的遮蔽配置，我方埋伏時沒有對調（dev/bugs/B011-one-sided-not-swapped-on-ambush.md）。
// 規格：SITES 12.2 節表「一邊倒……守方（敵人）佔好位置的遭遇點；從後門進來或我方埋伏時對調」，「埋伏與被埋伏照 COMBAT_SYSTEM 2.1 節再調一級」；COMMISSION_MAPS 1.3 節同。
// 現況：setupBattle 不管誰埋伏，一律用 COVER_LAYOUTS.one_sided（我方 半 暴 暴 暴、敵方 掩 掩 半 半），只做埋伏的調整。已修好（2026-11-22），這一份是回歸測試。

import { describe, expect, it } from 'vitest'
import { createKernel, setupBattle } from '../../src'
import { TEST_COMBAT, makeState } from '../../src/testkit'
import { duel, foe, one } from '../helpers/battle'

const levels = (cover: Array<{ level: number }>) => cover.map((c) => c.level)
const open = (o: { ambush?: 'ally' | 'foe' }) => setupBattle(createKernel([TEST_COMBAT]), makeState(), { ...duel([one()], [foe()]), cover: 'one_sided', ...o }).battle

describe('B011：一邊倒的配置在我方埋伏時對調（SITES 12.2 節）', () => {
  it('我方埋伏：先對調（我方 掩 掩 半 半、敵方 半 暴 暴 暴 的反面），再照埋伏再調一級——我方第一個不是掩體的格升成掩體，敵方全部降一級', () => {
    const b = open({ ambush: 'ally' })
    // 對調之後：我方 [2,2,1,1]、敵方 [0,0,0,1]；埋伏：我方第 3 格 1 → 2，敵方降一級
    expect(levels(b.cover.ally)).toEqual([2, 2, 2, 1])
    expect(levels(b.cover.foe)).toEqual([0, 0, 0, 0])
  })

  it('對照：沒有人埋伏時，一邊倒照表（我方 半 暴 暴 暴｜敵方 掩 掩 半 半）；敵方埋伏時守方本來就是敵人，不對調（這兩條現在就是對的）', () => {
    const plain = open({})
    expect(levels(plain.cover.ally)).toEqual([0, 0, 0, 1])
    expect(levels(plain.cover.foe)).toEqual([2, 2, 1, 1])
    const caught = open({ ambush: 'foe' })
    expect(levels(caught.cover.foe)).toEqual([2, 2, 2, 1]) // 埋伏的一方（敵）第一個不是掩體的格升成掩體
    expect(levels(caught.cover.ally)).toEqual([0, 0, 0, 0])
  })
})
