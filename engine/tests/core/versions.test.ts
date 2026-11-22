// 內容篩選與「照主角的性別分版本」（ENEMIES 第 6 節；DATA 第 1、5 節；LEWD_SYSTEM 第 9 節）。
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { CONTENT_TAGS, GENDER_IDS, REP_TIERS, REP_TIER_GRADE, REP_TIER_NAME, VERSIONS, gradeOfRepTier, pickVersion, repTierOf, resolveFiltered, tagsAllowed } from '../../src'

describe('照主角的性別分版本', () => {
  it('男一律走 masc；女七成 default、三成 yuri；偽娘、TS、扶他三個都會抽到', () => {
    for (const roll of [0, 0.3, 0.69, 0.999]) expect(pickVersion('male', roll)).toBe('masc')
    expect(pickVersion('female', 0)).toBe('default')
    expect(pickVersion('female', 0.699)).toBe('default')
    expect(pickVersion('female', 0.7)).toBe('yuri')
    expect(pickVersion('female', 0.999)).toBe('yuri')
    for (const g of ['femboy', 'trans_f', 'futa']) {
      expect([0.1, 0.5, 0.9].map((r) => pickVersion(g, r))).toEqual(['default', 'masc', 'yuri'])
    }
    expect([...GENDER_IDS]).toEqual(['female', 'male', 'femboy', 'trans_f', 'futa'])
  })

  it('贏的那一方沒有女性時 yuri 不成立，走 default；抽到沒寫的版本退回 default；可以手動指定與調比例', () => {
    expect(pickVersion('female', 0.9, { hasWomen: false })).toBe('default')
    expect(pickVersion('female', 0.9, { available: ['default', 'masc'] })).toBe('default')
    expect(pickVersion('male', 0.5, { available: ['default'] })).toBe('default')
    expect(pickVersion('female', 0.1, { forced: 'yuri' })).toBe('yuri')
    expect(pickVersion('female', 0.1, { forced: 'yuri', hasWomen: false })).toBe('default')
    expect(pickVersion('female', 0.5, { weights: { default: 0, yuri: 1 } })).toBe('yuri')
    expect(pickVersion(undefined, 0.1)).toBe('default')
    fc.assert(fc.property(fc.constantFrom(...GENDER_IDS, 'unknown'), fc.double({ min: 0, max: 1, noNaN: true }), fc.subarray([...VERSIONS], { minLength: 1 }), fc.boolean(), (g, roll, available, hasWomen) => {
      const v = pickVersion(g, roll, { available, hasWomen })
      return available.includes(v)
    }))
  })
})

describe('內容篩選', () => {
  it('玩家關掉的標籤，帶著它的內容不出現，改走 fallback 指的那個不含它的版本', () => {
    const entries = [
      { id: 'df_contract_eden', tags: ['contract_dom', 'pc_unwilling'], fallback: 'df_contract_eden_plain' },
      { id: 'df_contract_eden_plain', tags: ['pc_unwilling'], fallback: 'df_contract_eden_mild' },
      { id: 'df_contract_eden_mild' },
      { id: 'df_loop', tags: ['ntr'], fallback: 'df_loop' },
    ]
    const get = (id: string) => entries.find((e) => e.id === id)
    expect(tagsAllowed({ contentOff: [] }, ['ntr'])).toBe(true)
    expect(tagsAllowed({ contentOff: ['ntr'] }, ['ntr', 'blacktape'])).toBe(false)
    expect(tagsAllowed({ contentOff: ['ntr'] }, undefined)).toBe(true)
    expect(resolveFiltered({ contentOff: [] }, entries[0], get)!.id).toBe('df_contract_eden')
    expect(resolveFiltered({ contentOff: ['contract_dom'] }, entries[0], get)!.id).toBe('df_contract_eden_plain')
    expect(resolveFiltered({ contentOff: ['contract_dom', 'pc_unwilling'] }, entries[0], get)!.id).toBe('df_contract_eden_mild')
    expect(resolveFiltered({ contentOff: ['ntr'] }, entries[3], get)).toBeUndefined()
    expect(resolveFiltered({ contentOff: [] }, undefined, get)).toBeUndefined()
    expect(CONTENT_TAGS).toContain('intimate_body')
    expect(CONTENT_TAGS).toContain('trans_partner')
  })
})

describe('街頭信譽六階對 I～V 級（LIFE 1.3 節，2026-11-22 定案）', () => {
  it('最低兩階（無名、熟面孔）都是 I 級，之後每升一階升一級', () => {
    expect(REP_TIERS.map((t) => REP_TIER_NAME[t])).toEqual(['無名', '熟面孔', '有號', '搶手', '頂尖', '傳說'])
    expect([...REP_TIER_GRADE]).toEqual([1, 1, 2, 3, 4, 5])
    expect([0, 14, 15, 34, 35, 55, 75, 89, 90, 999].map(repTierOf)).toEqual([0, 0, 1, 1, 2, 3, 4, 4, 5, 5])
    expect([-1, 0, 1, 2, 3, 4, 5, 9].map(gradeOfRepTier)).toEqual([1, 1, 1, 2, 3, 4, 5, 5])
  })
})
