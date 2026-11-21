// 驗收測試：dev/work/M0-character.md（交給 cpp-feature）。
// 工單完成前這個檔會失敗（engine/src/features/character 還不存在）。跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-character
// 完成後：git mv engine/tests/pending/M0-character.test.ts engine/tests/features/M0-character.test.ts，主套件要全過。

import { describe, expect, it } from 'vitest'
import type { EffectCtx, Kernel } from '../../src'
import { clone, createKernel } from '../../src'
import { characterFeature } from '../../src/features/character'
import { makeState } from '../../src/testkit'

const kernel = (): Kernel => {
  const k = createKernel([characterFeature])
  k.strict = true
  return k
}
const ctxOf = (k: Kernel, state: ReturnType<typeof makeState>, source: EffectCtx['source']): EffectCtx => ({ state, actor: 'pc', grade: 1, source, clampAsked: true, content: k.content })
const apply = (k: Kernel, state: ReturnType<typeof makeState>, raw: unknown[], source: EffectCtx['source']) => {
  const r = k.effects.resolve(raw, ctxOf(k, state, source))
  const after = clone(state)
  k.changes.applyAll(after, r.changes)
  return { r, after }
}

describe('M0-character：衍生數值（CORE_RULES 第 1、4.1、4.2 節；COMBAT_SYSTEM 第 45 行；CYBERSPACE 第 278 行）', () => {
  it('功能的 id 是 character', () => {
    expect(characterFeature.id).toBe('character')
  })

  it('最大生命值 = 20 + 體格 × 2；讀有效屬性', () => {
    const k = kernel()
    expect(k.stats.stat(makeState({ pc: { attrs: { body: 10 } } }), 'pc', 'max_hp')).toBe(40)
    expect(k.stats.stat(makeState({ pc: { attrs: { body: 15 } } }), 'pc', 'max_hp')).toBe(50)
    expect(k.stats.stat(makeState({ pc: { attrs: { body: 4 } } }), 'pc', 'max_hp')).toBe(28)
    k.stats.addAttrProvider('test', (_s, _a, attr) => (attr === 'body' ? [{ label: '義體', value: 2 }] : []))
    expect(k.stats.stat(makeState({ pc: { attrs: { body: 15 } } }), 'pc', 'max_hp')).toBe(54)
  })

  it('感載上限 = 20 + 耐受 ÷ 2 + mod(意志) × 3；耐受讀 actor.ext.bridge.tolerance，沒有就是 0', () => {
    const k = kernel()
    expect(k.stats.stat(makeState({ pc: { attrs: { resolve: 10 } } }), 'pc', 'load_cap')).toBe(20)
    expect(k.stats.stat(makeState({ pc: { attrs: { resolve: 14 } } }), 'pc', 'load_cap')).toBe(26)
    expect(k.stats.stat(makeState({ pc: { attrs: { resolve: 8 } } }), 'pc', 'load_cap')).toBe(17)
    expect(k.stats.stat(makeState({ pc: { attrs: { resolve: 14 }, ext: { bridge: { tolerance: 30 } } } }), 'pc', 'load_cap')).toBe(41)
  })

  it('行動點上限 = 4 + floor((mod(反應) + mod(魅力)) / 2)', () => {
    const k = kernel()
    expect(k.stats.stat(makeState({ pc: { attrs: { reflex: 10, charm: 10 } } }), 'pc', 'ap_max')).toBe(4)
    expect(k.stats.stat(makeState({ pc: { attrs: { reflex: 14, charm: 13 } } }), 'pc', 'ap_max')).toBe(5)
    expect(k.stats.stat(makeState({ pc: { attrs: { reflex: 18, charm: 14 } } }), 'pc', 'ap_max')).toBe(7)
    expect(k.stats.stat(makeState({ pc: { attrs: { reflex: 8, charm: 10 } } }), 'pc', 'ap_max')).toBe(3)
  })

  it('RAM 上限 = 4 + mod(智識)，最少 4', () => {
    const k = kernel()
    expect(k.stats.stat(makeState({ pc: { attrs: { intellect: 16 } } }), 'pc', 'ram_max')).toBe(7)
    expect(k.stats.stat(makeState({ pc: { attrs: { intellect: 10 } } }), 'pc', 'ram_max')).toBe(4)
    expect(k.stats.stat(makeState({ pc: { attrs: { intellect: 6 } } }), 'pc', 'ram_max')).toBe(4)
  })

  it('主角的承受層數（能疊幾層餘韻）基礎是 3', () => {
    expect(kernel().stats.stat(makeState(), 'pc', 'afterglow_cap')).toBe(3)
  })

  it('報告的隊伍快照帶得出上限', () => {
    const k = kernel()
    const state = makeState({ pc: { attrs: { body: 12 }, hp: 30 } })
    expect(k.stats.hasStat('max_hp')).toBe(true)
    expect(k.stats.hasStat('load_cap')).toBe(true)
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(44)
  })
})

describe('M0-character：重傷（CORE_RULES 4.1 節）', () => {
  it('生命值低於一半：所有檢定 −2；剛好一半不算', () => {
    const k = kernel()
    const wounded = makeState({ pc: { attrs: { body: 10 }, hp: 19 } })
    const half = makeState({ pc: { attrs: { body: 10 }, hp: 20 } })
    const parts = k.stats.checkModifiers(wounded, 'pc', { attr: 'charm', skill: 'negotiate', tags: [] })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ value: -2, label: '重傷' })
    expect(k.stats.checkModifiers(wounded, 'pc', { attr: 'body', tags: ['combat'] })[0]!.value).toBe(-2)
    expect(k.stats.checkModifiers(half, 'pc', { attr: 'charm', tags: [] })).toEqual([])
  })

  it('條件 wounded 與 track', () => {
    const k = kernel()
    const test = (state: ReturnType<typeof makeState>, cond: Record<string, unknown>) => {
      expect(k.conditions.validate(cond)).toEqual([])
      return k.conditions.test(cond as never, { state, stats: k.stats, timeRules: k.timeRules })
    }
    expect(test(makeState({ pc: { hp: 5 } }), { kind: 'wounded' })).toBe(true)
    expect(test(makeState({ pc: { hp: 40 } }), { kind: 'wounded' })).toBe(false)
    expect(test(makeState({ pc: { sink: 30 } }), { kind: 'track', track: 'sink', min: 20, max: 40 })).toBe(true)
    expect(test(makeState({ pc: { sink: 30 } }), { kind: 'track', track: 'sink', min: 31 })).toBe(false)
    expect(test(makeState({ pc: { afterglow: 2 } }), { kind: 'track', track: 'afterglow', min: 1 })).toBe(true)
    expect(k.conditions.validate({ kind: 'track', track: 'mana' })).toHaveLength(1)
  })
})

describe('M0-character：三條軌的效果（EVENTS 2.4 節）', () => {
  it('註冊 hp、load、sink 三種效果', () => {
    expect(kernel().effects.kinds()).toEqual(expect.arrayContaining(['hp', 'load', 'sink']))
  })

  it('格式：amount 要是不為 0 的整數', () => {
    const k = kernel()
    const state = makeState()
    for (const kind of ['hp', 'load', 'sink']) {
      expect(k.effects.resolve([{ kind, amount: 'lots' }], ctxOf(k, state, 'builtin')).errors).toHaveLength(1)
      expect(k.effects.resolve([{ kind, amount: 0 }], ctxOf(k, state, 'builtin')).errors).toHaveLength(1)
      expect(k.effects.resolve([{ kind, amount: 1.5 }], ctxOf(k, state, 'builtin')).errors).toHaveLength(1)
    }
  })

  it('hp：AI 自己給的不會讓人倒下（最低留 1）；內建的事件寫多少是多少；補血不超過上限', () => {
    const k = kernel()
    const state = makeState({ pc: { attrs: { body: 10 }, hp: 5 } })
    const ai = apply(k, state, [{ kind: 'hp', amount: -50 }], 'ai')
    expect(ai.after.actors.pc!.hp).toBe(1)
    expect(ai.r.clamps).toHaveLength(1)
    expect(apply(k, state, [{ kind: 'hp', amount: -3 }], 'ai').r.clamps).toEqual([])
    expect(apply(k, state, [{ kind: 'hp', amount: -50 }], 'builtin').after.actors.pc!.hp).toBe(0)
    expect(apply(k, state, [{ kind: 'hp', amount: 999 }], 'builtin').after.actors.pc!.hp).toBe(40)
    expect(apply(k, state, [{ kind: 'hp', amount: 999 }], 'ai').after.actors.pc!.hp).toBe(40)
  })

  it('load：AI 自己給的不會讓人過載（最多到上限 − 1）；退感載最低到 0', () => {
    const k = kernel()
    const state = makeState({ pc: { attrs: { resolve: 10 }, load: 15 } })
    const ai = apply(k, state, [{ kind: 'load', amount: 50 }], 'ai')
    expect(ai.after.actors.pc!.load).toBe(19)
    expect(ai.r.clamps).toHaveLength(1)
    expect(apply(k, state, [{ kind: 'load', amount: 50 }], 'builtin').after.actors.pc!.load).toBe(65)
    expect(apply(k, state, [{ kind: 'load', amount: -99 }], 'ai').after.actors.pc!.load).toBe(0)
  })

  it('sink：AI 自己給的 ±3；內建的不夾', () => {
    const k = kernel()
    const state = makeState({ pc: { sink: 10 } })
    expect(apply(k, state, [{ kind: 'sink', amount: 9 }], 'ai').after.actors.pc!.sink).toBe(13)
    expect(apply(k, state, [{ kind: 'sink', amount: -9 }], 'ai').after.actors.pc!.sink).toBe(7)
    expect(apply(k, state, [{ kind: 'sink', amount: 2 }], 'ai').r.clamps).toEqual([])
    expect(apply(k, state, [{ kind: 'sink', amount: 9 }], 'builtin').after.actors.pc!.sink).toBe(19)
  })

  it('定案的結果是白話，不出現欄位名稱；被夾的提醒也是', () => {
    const k = kernel()
    const state = makeState({ pc: { hp: 5, sink: 10 } })
    const r = k.effects.resolve([{ kind: 'hp', amount: -50 }, { kind: 'load', amount: 3 }, { kind: 'sink', amount: 9 }], ctxOf(k, state, 'ai'))
    expect(r.lines).toHaveLength(3)
    for (const line of [...r.lines, ...r.clamps.map((c) => c.notice)]) {
      expect(line.length).toBeGreaterThan(2)
      expect(line).not.toMatch(/amount|hp|load|sink|effects/)
    }
  })
})
