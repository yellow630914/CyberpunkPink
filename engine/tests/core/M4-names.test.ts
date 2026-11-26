// 驗收測試：顯示用的名字表（core/rules/names.ts；M4 收尾修正批）。畫面的身體、組裝、零件問這裡，不自己維護對照表。

import { describe, expect, it } from 'vitest'
import { MOD_KINDS, MOD_NAMES, STAT_NAMES, modName, statName } from '../../src'
import { makeGame } from '../../src/testkit'
import { FEATURES } from '../../src/features'
import { NO_BRIDGE_ABILITY, NO_BRIDGE_NOTE } from '../../src/features'

describe('戰鬥修正與數值的名字表', () => {
  it('核心認得的每一種戰鬥修正（MOD_KINDS）都有名字，而且名字不是鍵本身', () => {
    const missing = MOD_KINDS.filter((m) => !MOD_NAMES[m])
    expect(missing).toEqual([])
    for (const m of MOD_KINDS) expect(modName(m)).not.toBe(m)
  })

  it('statName、modName：有名字的回名字，沒有的回鍵本身（功能自己認的修正、資料自己定的鍵）', () => {
    expect(modName('hit')).toBe('命中')
    expect(modName('instinct_points')).toBe('instinct_points')
    expect(statName('max_hp')).toBe('生命上限')
    expect(statName('damage')).toBe('傷害')
    expect(statName('not_a_stat')).toBe('not_a_stat')
  })

  it('完整的一局裡每一個衍生數值（k.stats）都有名字可查（STAT_NAMES 或登記時的 name）；表裡沒有的鍵是登記時才有名字的', () => {
    const { game: g } = makeGame({ features: Object.values(FEATURES) })
    const known = ['max_hp', 'armor', 'load_cap', 'ap_max', 'ram_max', 'afterglow_cap', 'carry_cap', 'bridge_sensitivity', 'net_load_decay', 'cyber_count', 'surgery_sink_pct', 'bridge_cap_meat', 'hp_blur']
    for (const id of known) {
      expect(g.k.stats.hasStat(id), id).toBe(true)
      expect(STAT_NAMES[id], id).toBeTruthy()
    }
  })

  it('建角畫面要的兩句說明從 features 總表匯出（不必深路徑 import）', () => {
    expect(NO_BRIDGE_NOTE).toMatch(/沒有橋/)
    expect(NO_BRIDGE_ABILITY).toMatch(/沒有橋/)
  })
})
