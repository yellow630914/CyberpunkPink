// B027（邊界，2026-11-25）：RAM 上限的「最少 4」套在加總（含甲板、技能的加值）上，智識低於 10 的人，甲板的加值被吃掉一部分或全部。
// 規格：CYBERSPACE 6.3 節「RAM 上限 = 4 + mod(智識)（最少 4）……甲板、構裝與技能可以再加」；NETRUNNING 第 1 節（甲板加 RAM）。
//       讀法：最少 4 是公式那一行的，加值加在它上面。智識 8（標準陣列裡的一個值，mod −1）裝入門甲板（+2）應該是 6，現在是 5。
//       已修（M3 白箱修正批；使用者 2026-11-25 裁決照這個讀法）：features/character 的 ram_max 的 base 是 max(4, 4 + mod(智識))，不再設 min。
// 重現：dev/bugs/B027-ram-floor-eats-deck-bonus.md；engine/tests/boundary/fixtures/B027-ram-floor-eats-deck-bonus.json。

import { describe, expect, it } from 'vitest'
import { attrMod, createKernel, readyFeatures } from '../../src'
import { characterFeature } from '../../src/features/character'
import { makeState } from '../../src/testkit'

function ramMax(intellect: number, bonus: number): number {
  const k = createKernel([characterFeature])
  if (bonus) k.stats.addStatProvider('ram_max', 'test_deck', () => [{ label: '入門甲板', value: bonus, source: 'deck' }])
  readyFeatures(k)
  return k.stats.stat(makeState({ pc: { attrs: { intellect } } as never }), 'pc', 'ram_max')
}

describe('B027：RAM 上限 = max(4, 4 + mod(智識)) ＋ 甲板與技能的加值', () => {
  it('智識 8（mod −1）＋甲板 2 = 6；智識 1（mod −5）＋甲板 2 = 6；智識 1 ＋主控 3 ＋甲板 2 = 9', () => {
    expect(ramMax(8, 2)).toBe(6)
    expect(ramMax(1, 2)).toBe(6)
    expect(ramMax(1, 5)).toBe(9)
  })

  it('每一個智識（1～24）、加值 0～5：等於 max(4, 4 + mod) + 加值', () => {
    for (let int = 1; int <= 24; int++) for (let b = 0; b <= 5; b++) expect(ramMax(int, b), `智識 ${int}、加值 ${b}`).toBe(Math.max(4, 4 + attrMod(int)) + b)
  })
})
