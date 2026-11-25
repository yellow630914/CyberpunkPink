// 白箱測試：features/deck（甲板、構裝、腳本、SKIN、租用）。
// 補主套件沒有走到的分支：內容的格式檢查（甲板、構裝、SKIN、規則表）、規則表寫壞的欄位退回預設、兩個效果（deck_script_use、deck_rental）的
// 檢查與「沒有事可做」的退路、換甲板時腳本照新上限整理、沒有這個角色的擋法、畫面的 SKIN 與腳本清單、查詢不改狀態。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, GameState } from '../../src'
import { ActionBlocked, clone, effectCtx } from '../../src'
import { deckOf, deckRules, deckView, equipBlock, equipDraft, installBlock, removeBlock, scriptsBlock, scriptsDraft, skinBlock, skinDraft } from '../../src/features/deck'
import { constructProblems, deckProblems, gradeBonus, readExt, ruleProblems, skinProblems, diceOf, DEFAULT_DECK_RULES } from '../../src/features/deck/model'
import { fitScripts } from '../../src/features/deck/state'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

const SKIN_PACK: ContentPack = {
  id: 'wb_skin',
  content: {
    skin: [{ id: 'sk_wb', name: '見習騎士', style: 'knight', style_value: 2, exposure: 1, cut: 'female' }],
    item: [{ id: 'sk_wb', name: '見習騎士', desc: 'SKIN。', category: 'misc', grade: 1, size: 0, legal: 'free' }],
    deck: [{ id: 'dk_wb_i', name: '一級甲板', desc: '測試用的 I 級甲板。', grade: 1, slots: 2, firewall: 8, legal: 'free' }],
  } as never,
}

/** 不開打的一局（主角有 II 級甲板、帶兩支腳本），背包多一套 SKIN 與一副 I 級甲板（D9）。 */
function game(): G {
  const { game: g } = makeNetBattleGame({ noBattle: true, content: [SKIN_PACK] as never })
  g.commit({
    kind: 'system', action: 'test.set', location: {}, party: [], timeline: [],
    changes: [{ op: 'item', id: 'sk_wb', qty: 1 }, { op: 'item', id: 'dk_wb_i', qty: 1, data: { uid: 'D9' } }] as never, outcome: { result: 'ok', summary: 't' },
  })
  return g
}

describe('白箱 deck：內容的格式檢查（ITEMS 11.1～11.4 節；DATA 7.3 節）', () => {
  it('deckProblems：name、desc、ram 的形狀與欄位、cooling、brand、price', () => {
    expect(deckProblems({ name: '', desc: '', grade: 1, slots: 1, firewall: 1, legal: 'free', ram: 3, cooling: -1, brand: 3, price: -1 })).toEqual([
      '要有 name', '要有 desc（完整的句子）', 'ram 要是 { max?, regen? }', 'cooling 要是 0 以上的整數', 'brand 要是字串', 'price 要是 0 以上的整數',
    ])
    expect(deckProblems({ name: 'x', desc: 'x', grade: 1, slots: 1, firewall: 1, legal: 'free', ram: { max: -1, regen: 1.5 } })).toEqual(['ram.max 要是 0 以上的整數', 'ram.regen 要是 0 以上的整數'])
  })

  it('constructProblems：共通欄位、武器（archetype、type、ram、dice、range、cover_mult、traits）、防護、工具、mods、進階與終極', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    const base = { name: 'x', grade: 1, legal: 'free' }
    expect(constructProblems(g.k, { ...base, class: 'nope', name: '', series: 3, grade: 9, slots: 5, brand: 3, legal: 'x', price: -1 })).toEqual([
      expect.stringMatching(/^class 只能是/), '要有 name', 'series 要是字串', 'grade 要是 1～5', 'slots（佔幾個構裝槽）要是 1～4', 'brand 要是字串', expect.stringMatching(/^legal 只能是/), 'price 要是 0 以上的整數',
    ])
    expect(constructProblems(g.k, { ...base, class: 'weapon', type: 'x', ram: -1, dice: '2d8', range: [0, 9], cover_mult: -1, traits: [3] })).toEqual([
      '武器要寫 archetype（weapon_class 的 id）', expect.stringMatching(/^type 只能是/), 'ram 要是 0 以上的整數（每次攻擊花幾點 RAM）', 'dice 要是 1 以上的整數，或「Nd6」',
      'range 要是 [近, 遠]，在 1～7 之間', 'cover_mult 要是 0 以上的數字', 'traits 要是特性的字串陣列',
    ])
    expect(constructProblems(g.k, { ...base, class: 'weapon', archetype: 'pistol', type: 'neural', ram: 1, dice: '3d6', range: [2, 1] })).toEqual(['range 要是 [近, 遠]，在 1～7 之間'])
    expect(constructProblems(g.k, { ...base, class: 'defense' })).toEqual(['防護要寫 guard（0 以上的整數）'])
    expect(constructProblems(g.k, { ...base, class: 'tool', ap: 5, ram: -1, passive: 1, target: 'sky' })).toEqual([
      '工具要寫 ap（0～4 的整數）', '工具要寫 ram（0 以上的整數）', 'passive 要是布林值', expect.stringMatching(/^target 只能是/),
    ])
    expect(constructProblems(g.k, { ...base, class: 'body', mods: 3 })).toEqual(['mods 要是 { 修正的種類: 數字 }'])
    expect(constructProblems(g.k, { ...base, class: 'body', mods: { nope: 1, hit: 0 } })).toEqual([expect.stringMatching(/^mods\.nope：只能是/), 'mods.hit 要是不為 0 的數字'])
    expect(constructProblems(g.k, { ...base, class: 'body', advanced: 3, ultimate: { zap: 1, mods: { hit: 1 } } })).toEqual(['advanced 要是 { do?, mods? }（或 null）', 'ultimate.zap 不是可以用的鍵（只有 do、mods）'])
    expect(constructProblems(g.k, { ...base, class: 'body', advanced: null })).toEqual([])
  })

  it('diceOf：整數或「Nd6」，其他是 undefined', () => {
    expect(diceOf(3)).toBe(3)
    expect(diceOf('4d6')).toBe(4)
    expect(diceOf('0d6')).toBeUndefined()
    expect(diceOf(0)).toBeUndefined()
    expect(diceOf('d6')).toBeUndefined()
  })

  it('skinProblems：每一個欄位寫壞各一句；exposure 可以寫 custom、price 可以是 null', () => {
    expect(skinProblems({ name: '', style: 3, style_value: 6, exposure: 4, cut: 'x', adult: 1, forms: [{ id: 'a' }], real_twin: [3], price: -1 })).toEqual([
      '要有 name', 'style 要是字串', 'style_value 要是 1～5', 'exposure 要是 0～3（空白 SKIN 寫 custom）', expect.stringMatching(/^cut 只能是/), 'adult 要是布林值',
      'forms 要是 { id, name } 的陣列', 'real_twin 要是字串的陣列', 'price 要是 0 以上的整數，或 null（不賣）',
    ])
    expect(skinProblems({ name: 'x', exposure: 'custom', price: null })).toEqual([])
  })

  it('deck_rule：grade_bonus 的形狀與等級、三個整數欄位、cap_construct_grade；寫壞的欄位退回預設（ITEMS 11.1 節）', () => {
    expect(ruleProblems({ grade_bonus: 3 })).toEqual(['grade_bonus 要是「等級 → { hit, dice }」'])
    expect(ruleProblems({ grade_bonus: { 6: { hit: 1, dice: 1 }, 2: { hit: 1, dice: -1 } } })).toEqual(['grade_bonus.2 要是 { hit: 整數, dice: 0 以上的整數 }', 'grade_bonus.6：等級只能是 1～5'])
    expect(ruleProblems({ script_extra: -1, swap_minutes: 1.5, ram_regen: 'x', cap_construct_grade: 1 })).toEqual([
      'script_extra 要是 0 以上的整數', 'swap_minutes 要是 0 以上的整數', 'ram_regen 要是 0 以上的整數', 'cap_construct_grade 要是布林值',
    ])
    // 讀規則：寫壞的欄位用預設，寫對的蓋掉
    const fake = { content: { get: () => ({ id: 'default', script_extra: -1, swap_minutes: 3, grade_bonus: { 9: {} } }) } } as never
    const rules = deckRules(fake)
    expect(rules.script_extra).toBe(DEFAULT_DECK_RULES.script_extra)
    expect(rules.swap_minutes).toBe(3)
    expect(rules.grade_bonus).toEqual(DEFAULT_DECK_RULES.grade_bonus)
  })

  it('gradeBonus：表上沒有那一級往下找；一級都沒有是 0', () => {
    expect(gradeBonus({ ...DEFAULT_DECK_RULES, grade_bonus: { 2: { hit: 1, dice: 1 } } }, 4)).toEqual({ hit: 1, dice: 1 })
    expect(gradeBonus({ ...DEFAULT_DECK_RULES, grade_bonus: {} }, 3)).toEqual({ hit: 0, dice: 0 })
  })

  it('readExt：壞掉的 slots、scripts 略過（不變式第 180 條：actor.ext.deck 的格式由 deck 守）', () => {
    expect(readExt(3)).toEqual({ slots: [], scripts: [] })
    expect(readExt({ slots: ['a', 3, ''], scripts: [{ item: 'x', qty: 0 }, { item: 'y', qty: 2 }, 3] }).scripts).toEqual([{ item: 'y', qty: 2 }])
  })
})

describe('白箱 deck：兩個效果（dev/adr/0018 第十三節；不變式第 180 條）', () => {
  it('deck_script_use：item、qty、who、多的欄位；沒帶這一項不做事；帶的不夠扣到 0', () => {
    const g = game()
    const ctx = effectCtx(g.k, g.state, { source: 'builtin' })
    const res = g.k.effects.resolve([{ kind: 'deck_script_use', item: '', qty: 0, who: 'nobody', zz: 1 }] as never, ctx)
    expect(res.errors.join('')).toContain('item 要是物品的 id')
    expect(res.errors.join('')).toContain('qty 要是 1 以上的整數')
    expect(res.errors.join('')).toContain('who 要是現有角色的 id')
    expect(res.errors.join('')).toContain('zz 不是這個效果的欄位')
    expect(g.k.effects.resolve([{ kind: 'deck_script_use', item: 'it_none' }] as never, ctx).changes).toEqual([])
    const all = g.k.effects.resolve([{ kind: 'deck_script_use', item: 'it_tw_script', qty: 5, who: 'pc' }] as never, ctx)
    expect(all.errors).toEqual([])
    expect((all.changes[0] as unknown as { value: { scripts: unknown[] } }).value.scripts).toEqual([])
  })

  it('deck_rental：deck 不存在、who、多的欄位；沒有租的收回不做事', () => {
    const g = game()
    const ctx = effectCtx(g.k, g.state, { source: 'builtin' })
    const res = g.k.effects.resolve([{ kind: 'deck_rental', deck: 'dk_none', who: 'nobody', zz: 1 }] as never, ctx)
    expect(res.errors.join('')).toContain('deck 要是甲板的 id')
    expect(res.errors.join('')).toContain('who 要是現有角色的 id')
    expect(res.errors.join('')).toContain('zz 不是這個效果的欄位')
    expect(g.k.effects.resolve([{ kind: 'deck_rental', deck: null }] as never, ctx).changes).toEqual([])
    const rent = g.k.effects.resolve([{ kind: 'deck_rental', deck: 'dk_tw_rent' }] as never, ctx)
    expect(rent.lines.join('')).toContain('館方的比賽甲板')
  })
})

describe('白箱 deck：裝備與腳本的退路（ITEMS 11.1 節「腳本最多帶甲板等級＋1 支」；CYBERSPACE 2.3 節）', () => {
  it('沒有這個角色：每一個 block 都回「沒有 X 這個角色」', () => {
    const g = game()
    for (const f of [() => equipBlock(g.k, g.state, 'nobody', 'D1'), () => installBlock(g.k, g.state, 'nobody', 'cs_tw_gun'), () => removeBlock(g.k, g.state, 'nobody', 'cs_tw_gun'),
      () => scriptsBlock(g.k, g.state, 'nobody', []), () => skinBlock(g.k, g.state, 'nobody', null)]) expect(f()).toBe('沒有 nobody 這個角色。')
  })

  it('換成 I 級甲板：帶著的兩支腳本照新上限整理（I 級＋1＝2）、槽放不下的構裝退回背包並寫一拍', () => {
    const g = game()
    const before = deckOf(g.k, g.state, 'pc')
    expect(before.scripts).toEqual([{ item: 'it_tw_script', qty: 2 }])
    const d = equipDraft(g.k, g.state, 'pc', 'D9')
    const ext = (d.changes.find((c) => c.op === 'actor.ext') as unknown as { value: { slots: string[]; scripts: unknown[] } }).value
    expect(ext.slots.length).toBeLessThan(before.equipped.length)
    expect(ext.scripts).toEqual(fitScripts(g.k, g.state, [{ item: 'it_tw_script', qty: 2 }], 1 + DEFAULT_DECK_RULES.script_extra))
    expect(d.timeline.some((b) => b.text.includes('退回背包'))).toBe(true)
  })

  it('fitScripts：不是腳本的略過、背包不夠的取背包的量、同一種合併、到上限為止', () => {
    const g = game()
    expect(fitScripts(g.k, g.state, [{ item: 'cs_tw_gun', qty: 1 }, { item: 'it_tw_script', qty: 1 }, { item: 'it_tw_script', qty: 5 }], 9)).toEqual([{ item: 'it_tw_script', qty: 2 }])
    expect(fitScripts(g.k, g.state, [{ item: 'it_tw_script', qty: 5 }], 1)).toEqual([{ item: 'it_tw_script', qty: 1 }])
    expect(fitScripts(g.k, g.state, [{ item: 'it_tw_script', qty: 1 }], 0)).toEqual([])
  })

  it('scriptsBlock：數量壞掉、不是腳本、超過上限、背包不夠；沒有甲板不能帶', () => {
    const g = game()
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_tw_script', qty: 0 }])).toBe('腳本的數量要是 1 以上的整數。')
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'cs_tw_gun', qty: 1 }])).toMatch(/不是腳本。$/)
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_tw_script', qty: 9 }])).toMatch(/^最多帶 \d+ 支腳本/)
    const st = clone(g.state)
    st.inventory = st.inventory.map((s) => (s.id === 'it_tw_script' ? { ...s, qty: 1 } : s))
    expect(scriptsBlock(g.k, st, 'pc', [{ item: 'it_tw_script', qty: 2 }])).toBe('背包裡的回填包不夠 2 個。')
    st.actors.pc!.ext.deck = {}
    expect(scriptsBlock(g.k, st, 'pc', [{ item: 'it_tw_script', qty: 1 }])).toBe('沒有甲板，不能帶腳本。')
    expect(scriptsDraft(g.k, g.state, 'pc', []).outcome.summary).toBe('放下了帶著的腳本。')
  })

  it('SKIN：沒穿著要脫、不是 SKIN、背包沒有、已經穿著；穿上與脫下的摘要（CYBERSPACE 4.3 節）', () => {
    const g = game()
    expect(skinBlock(g.k, g.state, 'pc', null)).toBe('現在沒有穿著 SKIN。')
    expect(skinBlock(g.k, g.state, 'pc', 'cs_tw_gun')).toBe('這不是一套 SKIN。')
    const st = clone(g.state)
    st.inventory = st.inventory.filter((s) => s.id !== 'sk_wb')
    expect(skinBlock(g.k, st, 'pc', 'sk_wb')).toBe('背包裡沒有這一套 SKIN。')
    const on = skinDraft(g.k, g.state, 'pc', 'sk_wb')
    expect(on.outcome.summary).toBe('換上 SKIN「見習騎士」。')
    g.commit(on)
    expect(skinBlock(g.k, g.state, 'pc', 'sk_wb')).toBe('已經穿著這一套了。')
    expect(skinDraft(g.k, g.state, 'pc', null).outcome.summary).toBe('脫下了 SKIN。')
    expect(() => skinDraft(g.k, g.state, 'pc', 'cs_tw_gun')).toThrow(ActionBlocked)
  })

  it('equipBlock：卸下時沒有自己的甲板、背包裡沒有那一副、已經裝著', () => {
    const g = game()
    expect(equipBlock(g.k, g.state, 'pc', 'D1')).toBe('這一副已經裝著了。')
    expect(equipBlock(g.k, g.state, 'pc', 'D77')).toBe('背包裡沒有那一副甲板。')
    const st = clone(g.state)
    st.actors.pc!.ext.deck = {}
    expect(equipBlock(g.k, st, 'pc', null)).toBe('現在沒有裝著自己的甲板。')
  })
})

describe('白箱 deck：畫面（dev/work/M3-deck.md「deckView」；不變式第 1 條）', () => {
  it('deckView：SKIN 列出背包裡的（穿著的標 worn）、腳本列出帶著的與背包裡有的、別的甲板列出來', () => {
    const g = game()
    g.commit(skinDraft(g.k, g.state, 'pc', 'sk_wb'))
    const v = deckView(g.k, g.state, 'pc')
    expect(v.skins).toEqual([{ item: 'sk_wb', name: '見習騎士', worn: true, block: '已經穿著這一套了。' }])
    expect(v.scripts.carried).toEqual([{ item: 'it_tw_script', name: '回填包', qty: 2 }])
    expect(v.scripts.available).toEqual([{ item: 'it_tw_script', name: '回填包', have: 2 }])
    expect(v.decks.map((d) => [d.uid, d.current])).toEqual(expect.arrayContaining([['D1', true], ['D9', false]]))
    expect(v.cells.length).toBe(v.deck.slotsTotal)
  })

  it('deckView、deckOf 在凍結的狀態上照常', () => {
    const g = game()
    const st: GameState = deepFreeze(clone(g.state))
    expect(() => { deckView(g.k, st, 'pc'); deckOf(g.k, st, 'pc'); equipDraft(g.k, st, 'pc', 'D9') }).not.toThrow()
  })
})
