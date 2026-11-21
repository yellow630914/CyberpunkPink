// 驗收測試：dev/work/M0-perks.md（交給 cpp-feature）。
// 工單完成前這個檔會失敗（engine/src/features/perks 還不存在）。跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-perks
// 完成後：git mv engine/tests/pending/M0-perks.test.ts engine/tests/features/M0-perks.test.ts，主套件要全過。

import { describe, expect, it } from 'vitest'
import type { EffectCtx, Kernel } from '../../src'
import { clone, createKernel, readyFeatures, rollCheck } from '../../src'
import { perksFeature } from '../../src/features/perks'
import { makeState } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const kernel = (): Kernel => {
  const k = createKernel([perksFeature])
  k.strict = true
  k.content.loadPack(MINI_PACK)
  readyFeatures(k)
  return k
}
const ctxOf = (k: Kernel, state: ReturnType<typeof makeState>, source: EffectCtx['source'] = 'builtin'): EffectCtx => ({ state, actor: 'pc', grade: 1, source, clampAsked: true, content: k.content })

describe('M0-perks：特質是被動的修正（CHARACTER 4.1、5.2 節）', () => {
  it('功能的 id 是 perks', () => {
    expect(perksFeature.id).toBe('perks')
  })

  it('一類檢定的加值：指定的基本功才加；來源標 perk、標籤是特質的名字', () => {
    const k = kernel()
    const state = makeState({ pc: { perks: ['smooth_talker'] } })
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })).toEqual([{ label: '能言善道', value: 2, source: 'perk' }])
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', skill: 'perform', tags: [] })).toEqual([])
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', tags: [] })).toEqual([])
    expect(k.stats.checkModifiers(makeState(), 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })).toEqual([])
  })

  it('加值進到檢定的合計裡', () => {
    const k = kernel()
    const input = { actor: 'pc', attr: 'charm' as const, skill: 'negotiate', dc: 13, purpose: 't' }
    const without = rollCheck(k.stats, makeState(), input)
    const withPerk = rollCheck(k.stats, makeState({ pc: { perks: ['smooth_talker'] } }), input)
    expect(withPerk.natural).toBe(without.natural)
    expect(withPerk.total).toBe(without.total + 2)
  })

  it('寫了情境標籤的：標籤也要符合（基本功與標籤都寫就是都要）', () => {
    const k = kernel()
    const state = makeState({ pc: { perks: ['corp_reader', 'origin_hive'] } })
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', skill: 'negotiate', tags: ['vs:corp'] }).map((p) => p.label)).toEqual(['看得懂合約'])
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })).toEqual([])
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'intellect', skill: 'streetwise', tags: ['place:hive', 'social'] }).map((p) => p.value)).toEqual([2])
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'intellect', skill: 'streetwise', tags: ['place:oldport'] })).toEqual([])
  })

  it('缺陷是同一張表的反面；特質與缺陷一起算', () => {
    const k = kernel()
    const state = makeState({ pc: { perks: ['smooth_talker', 'loose_lips'] } })
    const parts = k.stats.checkModifiers(state, 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })
    expect(parts.map((p) => p.value).sort()).toEqual([-2, 2])
  })

  it('衍生數值的修正：有功能註冊了那個數值才生效（特質功能自己不定義 max_hp）', () => {
    const k = kernel()
    expect(k.stats.hasStat('max_hp')).toBe(false)
    k.stats.defineStat({ id: 'max_hp', owner: 'test', name: '生命值上限', base: () => 40 })
    k.stats.defineStat({ id: 'load_cap', owner: 'test', name: '感載上限', base: () => 20 })
    expect(k.stats.stat(makeState({ pc: { perks: ['tough'] } }), 'pc', 'max_hp')).toBe(45)
    expect(k.stats.stat(makeState({ pc: { perks: ['old_wound'] } }), 'pc', 'max_hp')).toBe(35)
    expect(k.stats.stat(makeState({ pc: { perks: ['tough', 'old_wound'] } }), 'pc', 'max_hp')).toBe(40)
    expect(k.stats.stat(makeState({ pc: { perks: ['tough'] } }), 'pc', 'load_cap')).toBe(20)
    expect(k.stats.statParts(makeState({ pc: { perks: ['tough'] } }), 'pc', 'max_hp')[1]).toMatchObject({ label: '耐打', value: 5, source: 'perk' })
  })

  it('角色身上有內容裡找不到的特質：略過，不丟錯', () => {
    const k = kernel()
    const state = makeState({ pc: { perks: ['removed_by_mod', 'smooth_talker'] } })
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })).toHaveLength(1)
  })

  it('沒有效果欄位的特質（收入類，之後的批次才用得到）不影響檢定', () => {
    const k = kernel()
    expect(k.stats.checkModifiers(makeState({ pc: { perks: ['black_market'] } }), 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })).toEqual([])
  })
})

describe('M0-perks：取得與放掉（CHARACTER 4.4、5.3 節）', () => {
  const apply = (k: Kernel, state: ReturnType<typeof makeState>, raw: unknown[]) => {
    const r = k.effects.resolve(raw, ctxOf(k, state))
    const after = clone(state)
    if (!r.errors.length) k.changes.applyAll(after, r.changes)
    return { r, after }
  }

  it('效果 perk：給一個特質、拿掉一個特質', () => {
    const k = kernel()
    expect(k.effects.kinds()).toContain('perk')
    const got = apply(k, makeState(), [{ kind: 'perk', id: 'smooth_talker' }])
    expect(got.r.errors).toEqual([])
    expect(got.after.actors.pc!.perks).toEqual(['smooth_talker'])
    expect(got.r.lines[0]).toContain('能言善道')
    const lost = apply(k, makeState({ pc: { perks: ['smooth_talker'] } }), [{ kind: 'perk', id: 'smooth_talker', remove: true }])
    expect(lost.after.actors.pc!.perks).toEqual([])
  })

  it('格式錯誤：不存在的特質、已經有了、要拿掉的沒有', () => {
    const k = kernel()
    expect(apply(k, makeState(), [{ kind: 'perk', id: 'no_such_perk' }]).r.errors[0]).toMatch(/不存在/)
    expect(apply(k, makeState({ pc: { perks: ['tough'] } }), [{ kind: 'perk', id: 'tough' }]).r.errors).toHaveLength(1)
    expect(apply(k, makeState(), [{ kind: 'perk', id: 'tough', remove: true }]).r.errors).toHaveLength(1)
    expect(apply(k, makeState(), [{ kind: 'perk' }]).r.errors).toHaveLength(1)
  })

  it('特質總數的上限是 8 個，不含出身特質與缺陷；滿了要先放掉一個', () => {
    const k = kernel()
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `filler_${i}`, name: `填充 ${i}`, category: 'street', cost: 1, flaw: false, desc: '測試用的特質。' }))
    k.content.load('perk', eight)
    const full = makeState({ pc: { perks: [...eight.map((p) => p.id), 'origin_hive', 'loose_lips'] } })
    expect(apply(k, full, [{ kind: 'perk', id: 'smooth_talker' }]).r.errors[0]).toMatch(/8/)
    // 缺陷與出身特質不佔名額
    expect(apply(k, full, [{ kind: 'perk', id: 'old_wound' }]).r.errors).toEqual([])
    const seven = makeState({ pc: { perks: [...eight.slice(0, 7).map((p) => p.id), 'origin_hive', 'loose_lips'] } })
    expect(apply(k, seven, [{ kind: 'perk', id: 'smooth_talker' }]).r.errors).toEqual([])
    // 放掉一個再拿（分兩次：同一批效果是對同一個狀態驗的）
    const dropped = apply(k, full, [{ kind: 'perk', id: 'filler_0', remove: true }]).after
    expect(apply(k, dropped, [{ kind: 'perk', id: 'smooth_talker' }]).r.errors).toEqual([])
  })

  it('條件 has_perk', () => {
    const k = kernel()
    const test = (state: ReturnType<typeof makeState>, cond: Record<string, unknown>) => k.conditions.test(cond as never, { state, stats: k.stats, timeRules: k.timeRules })
    expect(k.conditions.validate({ kind: 'has_perk', perk: 'tough' })).toEqual([])
    expect(k.conditions.validate({ kind: 'has_perk' })).toHaveLength(1)
    expect(test(makeState({ pc: { perks: ['tough'] } }), { kind: 'has_perk', perk: 'tough' })).toBe(true)
    expect(test(makeState(), { kind: 'has_perk', perk: 'tough' })).toBe(false)
  })
})
