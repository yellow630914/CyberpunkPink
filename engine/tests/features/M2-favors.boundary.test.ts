// 邊界：人情的大小、作價、挑哪一筆、備註的長度。
// 規格：FIXER 第 8 節（人情分小、中、大；大的不作價；用在請託上的規則）、TRADE 4.4 節（人情作價：小 300、中 1,500）、EVENTS 2.4 節（AI 一件事最多一個小或中人情；大的拿掉）；dev/invariants.md 第 7 條。
// 性質：任何一份人情清單與要求：挑出來的那一筆大小在「自己的、再往上一級」之內、先挑同樣大小的、同一級最早記下的先用；用掉恰好一筆、其餘不動；
// 大的人情當不了小的；作價 小 300、中 1,500、大 null；備註剛好 NOTE_MAX 字可以、多 1 字擋下；AI 一件事給兩個人情只收一個。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContentPack, ReportDraft } from '../../src'
import { ActionBlocked, effectCtx } from '../../src'
import { DEFAULT_FAVOR_RULES, call, favorPrice, favorRules, favorsFeature, favorsOf, spend, spendBlock } from '../../src/features/favors'
import { favorCount, usableFor } from '../../src/features/favors/model'
import { makeGame } from '../../src/testkit'

const PACK: ContentPack = { id: 'fav_b', content: { faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }], npc: [{ id: 'npc_a', name: '阿甲' }, { id: 'npc_b', name: '阿乙' }] } as never }
const make = (content: ContentPack[] = [PACK]) => makeGame({ features: [favorsFeature], content, seed: 7 }).game
const draft = (changes: ReportDraft['changes'], action = 'test.give'): ReportDraft => ({ kind: 'event', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const SIZES = ['small', 'mid', 'big'] as const

describe('邊界 TRADE 4.4：作價', () => {
  it('小 300、中 1,500、大的不作價（null）；存檔規則的資料蓋掉預設；只蓋一個時另一個用預設', () => {
    const g = make()
    expect([favorPrice(g.k, 'small'), favorPrice(g.k, 'mid'), favorPrice(g.k, 'big')]).toEqual([300, 1500, null])
    expect(DEFAULT_FAVOR_RULES.refuse_rep).toBe(-3)
    const custom = make([PACK, { id: 'fr', content: { favor_rule: [{ id: 'default', price: { small: 10 }, refuse_rep: -1 }] } as never }])
    expect([favorPrice(custom.k, 'small'), favorPrice(custom.k, 'mid')]).toEqual([10, 1500])
    expect(favorRules(custom.k).refuse_rep).toBe(-1)
  })

  it('規則的格式：大的不能作價、價錢不能是負的或小數、信譽變化不能是正的', () => {
    const g = make()
    const bad = (e: Record<string, unknown>) => g.k.content.validate('favor_rule', [{ id: 'default', ...e }])
    expect(bad({ price: { big: 1 } })).not.toEqual([])
    expect(bad({ price: { small: -1 } })).not.toEqual([])
    expect(bad({ price: { small: 1.5 } })).not.toEqual([])
    expect(bad({ refuse_rep: 1 })).not.toEqual([])
    expect(bad({ refuse_rep: 0 })).toEqual([])
    expect(bad({ price: { small: 0, mid: 0 } })).toEqual([])
  })
})

describe('邊界 FIXER 8：用掉哪一筆', () => {
  it('usableFor：小的可以用小或中、中的可以用中或大、大的只有大的', () => {
    expect(usableFor('small')).toEqual(['small', 'mid'])
    expect(usableFor('mid')).toEqual(['mid', 'big'])
    expect(usableFor('big')).toEqual(['big'])
  })

  it('性質：任意清單與要求：挑到的大小在 usableFor 之內；有同樣大小的就不挑往上的；同一級挑最早的；用掉恰好一筆；沒有可用的給原因而且狀態不動', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ who: fc.constantFrom('npc_a', 'npc_b', 'hizakura'), size: fc.constantFrom(...SIZES) }), { maxLength: 8 }),
        fc.constantFrom(...SIZES), fc.constantFrom('npc_a', 'npc_b', undefined),
        (list, size, who) => {
          const g = make()
          for (const f of list) g.commit(draft([{ op: 'favor.add', dir: 'owed_to_pc', who: f.who, size: f.size }]))
          const before = favorsOf(g.state).owed_to_pc
          const mine = who === undefined ? before : before.filter((f) => f.who === who)
          const wanted = usableFor(size)
          const first = wanted.map((s) => mine.find((f) => f.size === s)).find((f) => f !== undefined)
          const why = spendBlock(g.k, g.state, { size, ...(who ? { who } : {}) })
          if (!first) {
            expect(why).not.toBeNull()
            expect(() => spend(g.k, g.state, { size, ...(who ? { who } : {}) })).toThrow(ActionBlocked)
            expect(favorsOf(g.state).owed_to_pc).toEqual(before)
            return
          }
          expect(why).toBeNull()
          g.commit(spend(g.k, g.state, { size, ...(who ? { who } : {}) }))
          const after = favorsOf(g.state).owed_to_pc
          expect(after).toHaveLength(before.length - 1)
          expect(after.map((f) => f.id)).toEqual(before.filter((f) => f.id !== first.id).map((f) => f.id))
          expect(wanted).toContain(first.size)
          for (const s of SIZES) expect(favorCount(g.state, s, 'owed_to_pc')).toBe(after.filter((f) => f.size === s).length)
        },
      ),
      { numRuns: 120, seed: 81 },
    )
  })

  it('大的當不了小的：只有一個大人情，要一個小的 → 沒有；中的可以當小的、整筆用掉；指定 id 優先，不看大小與對象', () => {
    const g = make()
    g.commit(draft([{ op: 'favor.add', dir: 'owed_to_pc', who: 'npc_a', size: 'big' }]))
    expect(spendBlock(g.k, g.state, { size: 'small' })).toContain('沒有人欠你')
    expect(spendBlock(g.k, g.state, { size: 'small', who: 'npc_a' })).toContain('頂不了')
    expect(spendBlock(g.k, g.state, { size: 'mid' })).toBeNull() // 大的可以當中的
    expect(spendBlock(g.k, g.state, { size: 'big' })).toBeNull()
    g.commit(draft([{ op: 'favor.add', dir: 'owed_to_pc', who: 'npc_b', size: 'mid' }]))
    const d = spend(g.k, g.state, { size: 'small' })
    expect(d.narration?.results?.[0]).toContain('當小的用')
    const idPick = favorsOf(g.state).owed_to_pc[0]!.id
    expect(spend(g.k, g.state, { id: idPick, size: 'small', who: 'npc_b' }).changes).toEqual([{ op: 'favor.spend', dir: 'owed_to_pc', id: idPick }])
    expect(spendBlock(g.k, g.state, {})).toContain('多大')
    expect(spendBlock(g.k, g.state, { id: 'fv_999' })).toContain('沒有這一筆')
  })

  it('被討：答應就清掉；拒絕那一筆留著；不是自己欠的、已經還掉的被擋；回答不是 do 或 refuse 丟一般的錯（呼叫的人寫錯）', () => {
    const g = make()
    g.commit(draft([{ op: 'favor.add', dir: 'owed_by_pc', who: 'npc_a', size: 'small' }]))
    const id = favorsOf(g.state).owed_by_pc[0]!.id
    expect(() => call(g.k, g.state, 'fv_nope', 'do')).toThrow(ActionBlocked)
    expect(() => call(g.k, g.state, id, 'maybe' as never)).toThrow('do 或 refuse')
    const refuse = call(g.k, g.state, id, 'refuse')
    expect(refuse.changes.some((c) => c.op === 'favor.spend')).toBe(false)
    g.commit(refuse)
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(1)
    g.commit(call(g.k, g.state, id, 'do'))
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(0)
    expect(() => call(g.k, g.state, id, 'do')).toThrow(ActionBlocked)
  })
})

describe('邊界 EVENTS 2.4：AI 給人情', () => {
  it('一件事最多收一個小或中人情：給兩個小的只收第一個、提醒；大的整筆拿掉；內建的照寫的算（兩個都收、大的也收）；備註剛好 NOTE_MAX 字可以、多 1 字格式錯', () => {
    const g = make()
    const resolve = (effects: Array<Record<string, unknown>>, source: 'ai' | 'builtin') => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source, clampAsked: true }))
    const two = resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'small' }, { kind: 'owed_to_pc', who: 'npc_b', size: 'mid' }], 'ai')
    expect(two.errors).toEqual([])
    expect(two.changes.filter((c) => c.op === 'favor.add')).toHaveLength(1)
    expect(two.clamps.length).toBeGreaterThan(0)
    expect(resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'big' }], 'ai').changes).toEqual([])
    const builtin = resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'small' }, { kind: 'owed_to_pc', who: 'npc_b', size: 'big' }], 'builtin')
    expect(builtin.changes.filter((c) => c.op === 'favor.add')).toHaveLength(2)
    const longest = (n: number) => resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'small', note: '字'.repeat(n) }], 'builtin').errors
    const max = [...Array(200).keys()].find((n) => longest(n + 1).length > 0)!
    expect(max).toBeGreaterThan(5)
    expect(longest(max)).toEqual([])
    expect(longest(max + 1)).not.toEqual([])
    expect(resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'huge' }], 'builtin').errors).not.toEqual([])
    expect(resolve([{ kind: 'owed_to_pc', who: 'nobody_here', size: 'small' }], 'builtin').errors).not.toEqual([])
    expect(resolve([{ kind: 'owed_to_pc', who: 'pc', size: 'small' }], 'builtin').errors).not.toEqual([])
  })
})
