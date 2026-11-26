// 驗收測試：顯示用的名字表（core/rules/names.ts；M4 收尾修正批）。畫面的身體、組裝、零件問這裡，不自己維護對照表。

import { describe, expect, it } from 'vitest'
import { CONTENT_TAGS, CONTENT_TAG_INFO, DIRECTION_MAX, INTERVIEW_SKILLS, MOD_KINDS, MOD_NAMES, STAT_NAMES, bridgeParamEffect, contentTagName, modName, paramStatId, statName, treeTierOf } from '../../src'
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

describe('內容篩選的名字表（CONTENT_TAG_INFO；M4-fix-2）', () => {
  it('CONTENT_TAGS 的每一個標籤都有名字與一句說明，表裡不多不少；名字不重複、不是標籤的 id；說明寫的是「關掉時會怎樣」', () => {
    expect(Object.keys(CONTENT_TAG_INFO).sort()).toEqual([...CONTENT_TAGS].sort())
    const names = CONTENT_TAGS.map((t) => CONTENT_TAG_INFO[t].name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of CONTENT_TAGS) {
      expect(CONTENT_TAG_INFO[t].name, t).not.toBe(t)
      expect(CONTENT_TAG_INFO[t].note, t).toMatch(/^關掉時/)
      expect(CONTENT_TAG_INFO[t].note.endsWith('。'), t).toBe(true)
    }
    expect(CONTENT_TAG_INFO.ntr.name).toBe('NTR')
    expect(CONTENT_TAG_INFO.intimate_body.name).toBe('身體的私密描寫')
  })

  it('contentTagName：認得的用名字表，其他（內容自己的標籤）用 fallback、再沒有就是標籤本身', () => {
    expect(contentTagName('pc_unwilling')).toBe('主角非自願')
    expect(contentTagName('restraint', '拘束')).toBe('拘束')
    expect(contentTagName('restraint')).toBe('restraint')
    expect(contentTagName('ntr', '別的名字')).toBe('NTR')
  })
})

describe('@engine/src（引擎的根）匯出畫面要的常數與換算（M4-fix-2：畫面不再深路徑 import 功能的內部檔）', () => {
  it('DIRECTION_MAX、INTERVIEW_SKILLS、paramStatId、treeTierOf、bridgeParamEffect、NO_BRIDGE_*', () => {
    expect(DIRECTION_MAX).toBe(200)
    expect([...INTERVIEW_SKILLS]).toEqual(['negotiate', 'perform'])
    expect(paramStatId('craving')).toBe('bridge_craving')
    expect([0, 39, 40, 119, 120, 239, 240, 399, 400, 9999].map(treeTierOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect(typeof bridgeParamEffect).toBe('function')
  })

  it('橋參數的效果說明句：四項各一句，數字照現在的規則（同步檔的敏感度門檻、耐受每幾點一層、慾求的門檻）；規則蓋掉之後句子跟著變', () => {
    const { game: g } = makeGame({ features: Object.values(FEATURES) })
    const lines = (['sensitivity', 'tolerance', 'craving', 'docility'] as const).map((p) => bridgeParamEffect(g.k, p))
    expect(new Set(lines).size).toBe(4)
    for (const l of lines) expect(l.endsWith('。'), l).toBe(true)
    expect(lines[0]).toContain('深檔要 40')
    expect(lines[0]).toContain('全檔要 70')
    expect(lines[1]).toContain('每 40 點承受層數')
    expect(lines[2]).toContain('高於 60')
    expect(lines[3]).toContain('抵抗控制類快駭')
    const { game: h } = makeGame({ features: Object.values(FEATURES), content: [{ id: 'rule', content: { lewd_rule: [{ id: 'default', tolerance_per_layer: 25, craving_threshold: 45 }] } } as never] })
    expect(bridgeParamEffect(h.k, 'tolerance')).toContain('每 25 點承受層數')
    expect(bridgeParamEffect(h.k, 'craving')).toContain('高於 45')
  })
})

