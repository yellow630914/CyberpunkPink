// B009：電磁武器打機體耐久沒有加倍（dev/bugs/B009-hull-ignores-em-bonus.md）。
// 規格：COMBAT_SYSTEM 9.3 節「對付機甲：打機體耐久（電磁加倍，第 5 節）」；第 5 節傷害類型表「電磁……對機器、無人機、機甲傷害加倍」。
// 現況：BattleRun.damage 只看「目標單位」的標籤（machine）決定 vs 倍率；穿機甲的是人（機師），沒有 machine 標籤，機體的耐久被當成一般的生命。
// 核心只留了機體的接口（機甲在 M6），但接口的傷害結算現在就和規格不一樣。工單做完之前照預期失敗。

import { describe, expect, it } from 'vitest'
import { arena, duel, foe, one } from '../helpers/battle'

describe('B009：電磁打機體耐久加倍（COMBAT_SYSTEM 9.3 節）', () => {
  const pilot = () => {
    const a = arena(duel([one()], [foe('elite', { armor: 0, dmgMult: { hp: 1, load: 1 } })]))
    const t = a.foe(1)
    t.hull = { id: 'h', name: '機甲', hp: { now: 100, max: 100 }, armor: 0, backlash: 0 }
    return { a, t }
  }

  it('電磁 10 點打在機體上：機體耐久少 20', () => {
    const { a, t } = pilot()
    a.run().damage(t, 10, 'em')
    expect(100 - t.hull!.hp.now).toBe(20)
  })

  it('對照：物理 10 點打在機體上：機體耐久少 10（這一條現在就是對的）', () => {
    const { a, t } = pilot()
    a.run().damage(t, 10, 'physical')
    expect(100 - t.hull!.hp.now).toBe(10)
  })
})
