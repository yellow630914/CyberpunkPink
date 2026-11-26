// 白箱：建角的生命軌跡（第 5 步）與潛在性癖的輸入檢查（lifepath.ts 的 lifepathProblems／lifepathBlock）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：CHARACTER 5.5 節（生命軌跡：八張表、朋友與仇人各最多一位、內容篩選、別的出身的選項不能選）；LEWD_SYSTEM 1.1 節（潛在性癖：最多幾個、不能重複、被篩選關掉的不能選）；
// GAME_DESIGN 第 3 節（玩家與 AI 交的輸入先驗格式再寫入）；dev/work/M4-creation-lifepath.md。
// 一局：makeBodyGame（bodyWorld 的生命軌跡與傾向標籤）。

import { describe, expect, it } from 'vitest'
import type { CreationDraft } from '../../src/features/creation'
import { MAX_KINKS, lifepathBlock, lifepathProblems } from '../../src/features/creation'
import { ORIGIN, makeBodyGame } from '../../src/testkit'

const g = makeBodyGame().game
const k = g.k
const state = g.state
const probs = (d: Partial<CreationDraft>, st = state) => lifepathProblems(k, st, { origin: ORIGIN, ...d } as CreationDraft)
const has = (ps: string[], re: RegExp) => ps.some((p) => re.test(p))

describe('生命軌跡的輸入（CHARACTER 5.5 節）', () => {
  it('什麼都沒選、跳過（skip 與 undefined）都沒有問題', () => {
    expect(probs({})).toEqual([])
    expect(probs({ lifepath: {} })).toEqual([])
    expect(probs({ lifepath: { family: 'skip', incident: undefined } as never })).toEqual([])
  })
  it('lifepath 不是物件（字串、陣列以外的東西）：一句「格式不對」，不再往下查', () => {
    for (const bad of ['x', 3, true, null]) expect(probs({ lifepath: bad as never })).toEqual(['生命軌跡的格式不對。'])
  })
  it('沒有這張表、選項不是字串、查不到的選項、選的選項屬於別張表：各有一句說出是哪一張', () => {
    expect(has(probs({ lifepath: { nope: 'lp_tw_fam_gone' } as never }), /沒有「nope」這張生命軌跡的表/)).toBe(true)
    expect(has(probs({ lifepath: { family: 7 } as never }), /要選一個選項，或跳過/)).toBe(true)
    expect(has(probs({ lifepath: { family: 'lp_zzz' } as never }), /這張表沒有「lp_zzz」這個選項/)).toBe(true)
    expect(has(probs({ lifepath: { family: 'lp_tw_inc_cash' } as never }), /不是「.+」這張表的選項/)).toBe(true)
  })
  it('合格的選項沒有問題；朋友與仇人各最多一位（同一張表選一個，所以要兩張表都選到同一種角色才會超過；這裡只驗每張表一個時沒有問題）', () => {
    expect(probs({ lifepath: { family: 'lp_tw_fam_tower', incident: 'lp_tw_inc_cash', friend: 'lp_tw_fr_old', enemy: 'lp_tw_en_rival', ex: 'lp_tw_ex_gone', want: 'lp_tw_want_money', kink: 'lp_tw_kink_rope' } as never })).toEqual([])
  })
  it('被內容篩選關掉的選項選不了（sex 表的選項帶 lp_adult 標籤）', () => {
    const off = { ...state, rules: { ...state.rules, contentOff: [...state.rules.contentOff, 'lp_adult'] } }
    expect(has(probs({ lifepath: { sex: 'lp_tw_sex_some' } as never }, off), /被你的內容篩選關掉了，選不了/)).toBe(true)
    expect(probs({ lifepath: { sex: 'lp_tw_sex_some' } as never })).toEqual([])
  })
  it('lifepathBlock：有問題就回第一句，沒有是 null', () => {
    expect(lifepathBlock(k, state, { origin: ORIGIN } as CreationDraft)).toBeNull()
    expect(lifepathBlock(k, state, { origin: ORIGIN, lifepath: { family: 'lp_zzz' } } as never)).toMatchObject({ step: 'lifepath', reason: expect.stringMatching(/lp_zzz/) })
  })
})

describe('潛在性癖（LEWD_SYSTEM 1.1 節）', () => {
  it(`最多 ${MAX_KINKS} 個：剛好收、多一個擋；不是陣列擋；項目格式不對擋；標籤不存在擋；同一個標籤選兩次擋`, () => {
    const tag = (id: string) => ({ tag: id })
    expect(probs({ kinks: [] })).toEqual([])
    expect(probs({ kinks: [tag('tg_tw_dom')] })).toEqual([])
    expect(has(probs({ kinks: 'tg_tw_dom' as never }), /潛在性癖的格式不對/)).toBe(true)
    expect(has(probs({ kinks: [3 as never] }), /要寫成 \{ tag, latent\? \}/)).toBe(true)
    expect(has(probs({ kinks: [{ tag: '' }] }), /要寫成 \{ tag, latent\? \}/)).toBe(true)
    expect(has(probs({ kinks: [{ tag: 'tg_tw_dom', latent: 'yes' as never }] }), /要寫成 \{ tag, latent\? \}/)).toBe(true)
    expect(has(probs({ kinks: [tag('tg_zzz')] }), /不是傾向的標籤/)).toBe(true)
    expect(has(probs({ kinks: [tag('tg_tw_dom'), tag('tg_tw_dom')] }), /不能選兩次/)).toBe(true)
    const many = Array.from({ length: MAX_KINKS + 1 }, (_, i) => tag(`tg_x${i}`))
    expect(has(probs({ kinks: many }), new RegExp(`最多選 ${MAX_KINKS} 個`))).toBe(true)
  })
  it('被內容篩選關掉的標籤選不了', () => {
    const off = { ...state, rules: { ...state.rules, contentOff: [...state.rules.contentOff, 'tg_tw_sub'] } }
    expect(has(probs({ kinks: [{ tag: 'tg_tw_sub' }] }, off), /被你的內容篩選關掉了，選不了/)).toBe(true)
  })
})
