// B008：打和人重疊的東西（無人機、砲塔）時，不照傷害類型的規則算（dev/bugs/B008-overlay-ignores-damage-type.md）。
// 規格：COMBAT_SYSTEM 第 5 節的傷害類型表（熱能「護甲：無視一半」；電磁「護甲：不看」、「對機器、無人機、機甲傷害加倍」）；9.1 節（無人機的生命與護甲照等級，敵人位階的傷害倍率照乘）。
// 現況：BattleRun.attackOverlay 一律用「物理」的算法（護甲全扣），電磁與熱能只少一顆骰。已修好（2026-11-22），這一份是回歸測試。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay } from '../../src'
import { testWeapon } from '../../src/testkit'
import { arena, duel, foe, one } from '../helpers/battle'

const dice = (...v: number[]) => [...v, ...Array(60).fill(1)]
const drone = (armor: number): BattleOverlay => ({ id: 'o1', side: 'foe', slot: 1, owner: 'f1', kind: 'attack', name: '敵方的無人機', hp: { now: 99, max: 99 }, armor, evade: 13, used: false, down: false })
const shoot = (type: 'em' | 'thermal' | 'physical', armor: number) => {
  const w = { ...testWeapon('pistol', 4), type, dice: 3 }
  const a = arena(duel([one({ weapons: [w], wield: 0 })], [foe()]))
  const d = drone(armor)
  a.battle.overlays.push(d)
  // 自然 20 命中；電磁與熱能少一顆骰，所以兩顆各 3 點（物理是三顆各 3 點）
  const res = a.run(dice(20, 3, 3, 3)).attackOverlay(a.ally(1), d)
  return { res, d }
}

describe('B008：打無人機照傷害類型算（COMBAT_SYSTEM 第 5 節）', () => {
  it('電磁：護甲不看，對無人機傷害加倍（骰面 2 顆各 3 = 6，護甲 4 不扣，×2 = 12）', () => {
    expect(shoot('em', 4).res.dealt).toBe(12)
  })

  it('熱能：無視一半護甲（骰面 2 顆各 3 = 6，護甲 4 只算 2，剩 4）', () => {
    expect(shoot('thermal', 4).res.dealt).toBe(4)
  })

  it('對照：物理照扣全部護甲（9 − 4 = 5；這一條現在就是對的）', () => {
    expect(shoot('physical', 4).res.dealt).toBe(5)
  })
})
