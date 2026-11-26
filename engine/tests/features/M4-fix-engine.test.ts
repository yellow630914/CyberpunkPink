// 驗收測試：M4 收尾修正批・引擎（dev/work/M4-fix-engine.md）的雜項：
//   登入        任何方式進入內海都發 login 觸發點（委託的內海面、自己去的一趟、簾後館一趟、潛入）；從潛入裡開的不重複（裁決 7）
//   斷線靜修    （見下面的 describe）
// 內容一律是 testkit 的假世界（bodyWorld、city）；功能是全部；走的是真的功能與真的提交。

import { describe, expect, it, vi } from 'vitest'
import type { ContentPack, Report } from '../../src'
import { characterFeature } from '../../src/features/character'
import { dyeBlock, dyeDraft, dyeOf, gearOf } from '../../src/features/gear'
import { productSellBase } from '../../src/features/trade'
import { cyberwareFeature } from '../../src/features/cyberware'
import { chooseBranch, chooseFace } from '../../src/features/commission'
import { go } from '../../src/features/fixer'
import {
  CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, makeGame, makeNetBattleGame, makeNetCommissionGame, sceneCast,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const logins = (rs: readonly Report[]): Array<{ action: string; where: Record<string, string> }> =>
  rs.flatMap((r) => (r.triggers ?? []).filter((t) => t.point === 'login').map((t) => ({ action: r.action ?? '', where: t.where as Record<string, string> })))

describe('任何方式進入內海都算一次登入（使用者 2026-11-26；EVENTS 4.5 節）', () => {
  it('委託的內海面（face.net 開始）：netrun.enter 帶 login，where 是身體所在的區與街區', () => {
    const { game: g, job } = makeNetCommissionGame()
    g.commit(go(g.k, g.state, job))
    g.commit(chooseFace(g.k, g.state, 'net'))
    const reports = g.commit(chooseBranch(g.k, g.state, 'assault'))
    const l = logins(reports)
    expect(l).toHaveLength(1)
    expect(l[0]!.action).toBe('netrun.enter')
    expect(l[0]!.where).toMatchObject({ block: 'tw_market' })
  })

  it('簾後館的一趟（街上的簾口，沒有潛入）：curtain.enter 開的 netrun.enter 帶 login', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g)
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(logins(reports)).toEqual([expect.objectContaining({ action: 'netrun.enter', where: expect.objectContaining({ block: 'tw_hall', facility: 'F4' }) })])
  })

  it('潛入：dive.enter 發 login；從潛入裡開的一趟（簾後館、迷宮館）不再發第二次', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    const prelude = curtainPrelude(g, { dive: true })
    expect(logins(prelude).map((x) => x.action)).toEqual(['dive.enter'])
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(reports.map((r) => r.action)).toContain('netrun.enter')
    expect(logins(reports)).toEqual([])
  })

  it('潛入之後的 login 總共只有一次：潛入 → 選去處開一趟 → 整串報告裡只有 dive.enter 的那一個', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g, { dive: true })
    curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(logins(g.state.reports).map((x) => x.action)).toEqual(['dive.enter'])
  })
})

describe('怪癖的 effects 掛在武器或護甲上不會生效：載入時警告（M4 收尾修正批 建議 2）', () => {
  const quirk = (id: string, over: Record<string, unknown>) => ({ id, name: `怪癖${id}`, desc: '一個怪癖。', kind: 'flaw', ...over })
  const warnings = (quirks: Array<Record<string, unknown>>): string[] => {
    const pack = { id: 'quirk_warn', content: { quirk: quirks } } as unknown as ContentPack
    return makeGame({ features: [characterFeature, cyberwareFeature], content: [pack] }).game.contentWarnings()
  }

  it('applies 沒寫或含 weapon、armor、而且寫了 effects 的怪癖：一句警告，寫出是哪一個、會掛在什麼上', () => {
    const w = warnings([
      quirk('q_any', { effects: [{ mod: 'hit', amount: 1 }] }),
      quirk('q_weapon', { applies: ['weapon'], effects: [{ mod: 'hit', amount: 1 }] }),
      quirk('q_both', { applies: ['cyberware', 'armor'], effects: [{ mod: 'hit', amount: 1 }] }),
    ])
    expect(w).toHaveLength(3)
    expect(w[0]).toMatch(/quirk\/q_any.*武器、護甲/)
    expect(w[1]).toMatch(/quirk\/q_weapon.*武器上/)
    expect(w[2]).toMatch(/quirk\/q_both.*護甲上/)
  })

  it('只掛在義體的、只有 stats 的、effects 是空的：沒有警告', () => {
    expect(warnings([
      quirk('q_cyber', { applies: ['cyberware'], effects: [{ mod: 'hit', amount: 1 }] }),
      quirk('q_stats', { stats: { armor: 1 } }),
      quirk('q_empty', { effects: [] }),
    ])).toEqual([])
  })
})

describe('賣成品照零件的實際狀態算（trade 的 productSellBase；M4 收尾修正批）', () => {
  const part = (id: string, type: string, price: number, over: Record<string, unknown> = {}) => ({ id, name: id, type, material: 'mech', brand: 'hz', grade: 1, price, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over })
  const content = {
    part: [part('pt_a', 'plate', 1000), part('pt_b', 'fiber', 1000), part('pt_b_used', 'fiber', 1000, { state: 'used' })],
    blueprint: [{ id: 'bp_vest', kind: 'armor', name: '防彈衣', desc: '一件防彈衣。', brand: 'hz', grade: 1, legal: 'free', price: 100, size: 2, weight: 2, armor: 1, covers: ['armor'], weight_class: 'medium', require: [{ type: 'plate' }, { type: 'fiber' }], optional: [], stock: { plate: 'pt_a', fiber: 'pt_b' } }],
  }
  const k = makeGame({ features: [characterFeature], content: [{ id: 'sell_base', content } as unknown as ContentPack] }).game.k

  it('全新的成品：零件目錄價的合計（不乘 1.2 與型係數）；其中一個零件是二手（part_states 或零件自己的 state）：那一個 ×0.5', () => {
    expect(productSellBase(k, 'bp_vest', { uid: 'u1', parts: { plate: 'pt_a', fiber: 'pt_b' } })).toBe(2000)
    expect(productSellBase(k, 'bp_vest', { uid: 'u2', parts: { plate: 'pt_a', fiber: 'pt_b' }, part_states: { fiber: ['used'] } })).toBe(1500)
    expect(productSellBase(k, 'bp_vest', { uid: 'u3', parts: { plate: 'pt_a', fiber: 'pt_b_used' } })).toBe(1500)
  })

  it('整件是二手：每個零件不重複折，整件 ×0.5；品質照係數；帶二手零件的整件二手也只折一次', () => {
    expect(productSellBase(k, 'bp_vest', { uid: 'u4', parts: { plate: 'pt_a', fiber: 'pt_b' }, state: 'used' })).toBe(1000)
    expect(productSellBase(k, 'bp_vest', { uid: 'u5', parts: { plate: 'pt_a', fiber: 'pt_b_used' }, state: 'used' })).toBe(1000)
    expect(productSellBase(k, 'bp_vest', { uid: 'u6', parts: { plate: 'pt_a', fiber: 'pt_b' }, quality: 'flawed' })).toBe(1600)
  })
})

describe('染 SKIN（gear 的 dyeDraft 收內海化身的 SKIN；M4 收尾修正批；dev/work/M4-closing-notes.md）', () => {
  const SKIN_PACK: ContentPack = {
    id: 'dye_skin',
    content: {
      skin: [
        { id: 'sk_a', name: '見習騎士', style: 'knight', style_value: 2, exposure: 1, cut: 'female', primary_color: 'dye_pink' },
        { id: 'sk_b', name: '女僕服', style: 'maid', style_value: 3, exposure: 0, cut: 'female' },
      ],
      item: [
        { id: 'sk_a', name: '見習騎士', desc: 'SKIN。', category: 'misc', grade: 1, size: 0, legal: 'free' },
        { id: 'sk_b', name: '女僕服', desc: 'SKIN。', category: 'misc', grade: 1, size: 0, legal: 'free' },
        { id: 'sk_c', name: '沒有登記的一套', desc: '背包裡有、內容種類 skin 沒有。', category: 'misc', grade: 1, size: 0, legal: 'free' },
      ],
    } as never,
  }
  const game = () => {
    const { game: g } = makeNetBattleGame({ noBattle: true, content: [SKIN_PACK] as never })
    g.commit({
      kind: 'system', action: 'test.set', location: {}, party: [], timeline: [],
      changes: [{ op: 'item', id: 'sk_a', qty: 1 }, { op: 'item', id: 'sk_c', qty: 1 }] as never, outcome: { result: 'ok', summary: 't' },
    })
    return g
  }

  it('SKIN 的 id 當 uid：不要錢、不花時間、哪裡都行；顏色記在那個人身上，dyeOf 讀得到；沒染的照 SKIN 內容的預設色', () => {
    const g = game()
    expect(dyeOf(g.k, g.state, 'sk_a')).toEqual({ primary_color: 'dye_pink' })
    const cash = g.state.money.cash
    const t0 = g.state.time
    expect(dyeBlock(g.k, g.state, { uid: 'sk_a', by: 'self', primary_color: 'dye_black' } as never)).toBeNull()
    g.commit(dyeDraft(g.k, g.state, { uid: 'sk_a', primary_color: 'dye_black', secondary_color: '#1A1520' } as never))
    expect(g.state.money.cash).toBe(cash)
    expect(g.state.time).toEqual(t0)
    expect(dyeOf(g.k, g.state, 'sk_a')).toEqual({ primary_color: 'dye_black', secondary_color: '#1A1520' })
    expect(gearOf(g.state, 'pc').skin_dye).toEqual({ sk_a: { primary_color: 'dye_black', secondary_color: '#1A1520' } })
    const r = g.state.reports.at(-1)!
    expect(r).toMatchObject({ action: 'gear.dye', actor: 'pc' })
    expect(r.narration?.results?.join('')).toBe('見習騎士染好了。')
  })

  it('換回預設（給 null）拿掉那一筆；沒染過就換回預設不算變，被擋；只改一個顏色不動另一個', () => {
    const g = game()
    expect(() => dyeDraft(g.k, g.state, { uid: 'sk_a', primary_color: null } as never)).toThrow(/沒有變/)
    g.commit(dyeDraft(g.k, g.state, { uid: 'sk_a', primary_color: 'dye_black', secondary_color: 'dye_olive' } as never))
    g.commit(dyeDraft(g.k, g.state, { uid: 'sk_a', secondary_color: 'dye_white' } as never))
    expect(dyeOf(g.k, g.state, 'sk_a')).toEqual({ primary_color: 'dye_black', secondary_color: 'dye_white' })
    g.commit(dyeDraft(g.k, g.state, { uid: 'sk_a', primary_color: null, secondary_color: null } as never))
    expect(gearOf(g.state, 'pc').skin_dye).toBeUndefined()
    expect(dyeOf(g.k, g.state, 'sk_a')).toEqual({ primary_color: 'dye_pink' })
  })

  it('亂寫的顏色被擋；背包裡沒有的 SKIN、內容種類 skin 沒登記的物品、一般飾品都不是 SKIN（照原來的擋法）', () => {
    const g = game()
    expect(() => dyeDraft(g.k, g.state, { uid: 'sk_a', primary_color: 'pink' } as never)).toThrow(/主色調的顏色不對/)
    expect(() => dyeDraft(g.k, g.state, { uid: 'sk_b', primary_color: 'dye_black' } as never)).toThrow(/背包裡沒有這一件/)
    expect(() => dyeDraft(g.k, g.state, { uid: 'sk_c', primary_color: 'dye_black', by: 'self' } as never)).toThrow(/現成的單件/)
    expect(gearOf(g.state, 'pc').skin_dye).toBeUndefined()
  })

  it('染過的顏色不受穿脫、別的穿著格的變更影響（ext.gear 重整時 skin_dye 留著）', () => {
    const g = game()
    g.commit(dyeDraft(g.k, g.state, { uid: 'sk_a', primary_color: 'dye_black' } as never))
    g.commit({ kind: 'system', action: 'test.coat', location: {}, party: [], timeline: [], changes: [{ op: 'gear.coat', id: 'pc', coat: 'closed' }] as never, outcome: { result: 'ok', summary: 't' } })
    expect(dyeOf(g.k, g.state, 'sk_a')).toEqual({ primary_color: 'dye_black' })
  })
})
