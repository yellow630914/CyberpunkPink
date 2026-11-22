// 白箱測試：core/battle/rules.ts（戰場、傷害類型、狀態、武器類型的資料格式與查詢）。
// 補主套件沒有走到的分支：格式檢查的每一條錯誤、資料蓋掉核心預設的查詢、等級對照的夾值。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import {
  COVER_LAYOUTS, DEFAULT_MODES, DEFAULT_NUMBERS, DEFAULT_STATUSES, LOSE_TURN, coverHpFor, createKernel, damageTypeOf, modeOf, statusMod, statusRuleOf,
} from '../../src'

const k = () => createKernel()
const problems = (kind: string, entry: Record<string, unknown>): string => k().content.validate(kind, [entry]).join('\n')

const MODE = { id: 'meat', name: '現實', layer: 'meat', tracks: ['hp', 'load'], overload: 'lose_turn', afterglow: { roll: -1, load_dealt_pct: 10 }, cover_names: ['暴露', '半掩體', '掩體'], cover_word: '遮蔽' }
const DTYPE = { id: 'thermal', name: '熱能', track: 'hp', armor: 0.5, on_hit: [{ status: 'burning', turns: 2 }], dice: -1 }
const STATUS = { id: 'dazed', name: '暈眩', desc: '下回合行動點 −2。', turn_start: { ap: -2 }, once: true, until: 'battle_end', kind: 'wound' }
const WCLASS = { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }

/** 在合格的樣本上改一個欄位（undefined 是刪掉），回傳格式檢查的問題。 */
const edit = (kind: string, base: Record<string, unknown>, field: string, value: unknown): string => {
  const e = { ...base, [field]: value }
  if (value === undefined) delete e[field]
  return problems(kind, e)
}

describe('白箱 battle_mode 的格式（COMBAT_SYSTEM 1.2；CYBERSPACE 6.1；不變式第 11 條）', () => {
  it('合格的樣本收得進來；內海的樣本（flash 加 flash_pool）也收', () => {
    expect(problems('battle_mode', MODE)).toBe('')
    expect(problems('battle_mode', { ...MODE, id: 'net', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', armor_on_load: true })).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['layer', 'sky', /layer 只能是 meat、net/],
    ['tracks', [], /tracks 要是 hp、load 的陣列/],
    ['tracks', ['hp', 'mana'], /tracks 要是 hp、load 的陣列/],
    ['tracks', 'hp', /tracks 要是 hp、load 的陣列/],
    ['overload', 'die', /overload 只能是 lose_turn、flash/],
    ['afterglow', null, /afterglow 要有 roll 與 load_dealt_pct/],
    ['afterglow', { roll: 'x', load_dealt_pct: 1 }, /afterglow 要有 roll 與 load_dealt_pct/],
    ['afterglow', { roll: 1, load_dealt_pct: Number.NaN }, /afterglow 要有 roll 與 load_dealt_pct/],
    ['cover_names', ['a', 'b'], /cover_names 要是三個名字/],
    ['cover_names', ['a', 'b', ' '], /cover_names 要是三個名字/],
    ['cover_word', '', /要有 cover_word/],
    ['numbers', 'x', /numbers 要是一個物件/],
    ['numbers', { bogus: 1 }, /numbers\.bogus：沒有這個數字/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('battle_mode', MODE, field, value as unknown)).toMatch(re)
  })

  it('overload 是 flash 卻沒寫 flash_pool 擋下；numbers 只能寫 BattleNumbers 有的鍵', () => {
    expect(problems('battle_mode', { ...MODE, overload: 'flash' })).toMatch(/flash 時要寫 flash_pool/)
    expect(problems('battle_mode', { ...MODE, numbers: { apRegen: 4, aiMaxSteps: 8 } })).toBe('')
  })
})

describe('白箱 damage_type 的格式（COMBAT_SYSTEM 第 5 節）', () => {
  it('合格的樣本收得進來', () => {
    expect(problems('damage_type', DTYPE)).toBe('')
    expect(problems('damage_type', { id: 'neural', name: '神經', track: 'load', armor: 0, needs_bridge: true, vs: { machine: 0 }, sink: 0 })).toBe('')
  })

  it.each([
    ['id', 'poison', /id 只能是 physical、thermal、em、neural、pleasure/],
    ['name', '', /要有 name/],
    ['track', 'mp', /track 只能是 hp、load/],
    ['armor', 2, /armor 要是 0～1/],
    ['armor', -0.1, /armor 要是 0～1/],
    ['armor', 'x', /armor 要是 0～1/],
    ['vs', { machine: 'x' }, /vs 要是「標籤 → 倍率」/],
    ['vs', 'machine', /vs 要是「標籤 → 倍率」/],
    ['on_hit', [{ status: 'burning', turns: 0 }], /on_hit 要是 \{ status, turns \} 的陣列/],
    ['on_hit', [{ status: '', turns: 1 }], /on_hit 要是/],
    ['on_hit', 'burning', /on_hit 要是/],
    ['sink', 1.5, /sink 要是整數/],
    ['dice', 0.5, /dice 要是整數/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('damage_type', DTYPE, field, value as unknown)).toMatch(re)
  })

  it('on_hit 引用不存在的狀態：載入後的引用檢查找得到（不變式第 11 條）', () => {
    const kernel = k()
    kernel.content.load('damage_type', [DTYPE])
    expect(kernel.content.checkRefs()).toContain('damage_type/thermal：引用了不存在的 battle_status/burning')
  })
})

describe('白箱 battle_status 的格式（COMBAT_SYSTEM 第 6、7 節）', () => {
  it('合格的樣本收得進來；mods、turn_start、turns 都可以省', () => {
    expect(problems('battle_status', STATUS)).toBe('')
    expect(problems('battle_status', { id: 'sup', name: '壓制', desc: '攻擊 −2。', mods: { hit: -2 }, no_move: true, until: 'own_turn_end', turns: 1, kind: 'debuff', cleansed_by: ['first_aid'] })).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['desc', '', /要有 desc/],
    ['mods', 'x', /mods 要是一個物件/],
    ['mods', { speed: 1 }, /mods\.speed：只能是/],
    ['mods', { hit: 0 }, /mods\.hit 要是不為 0 的數字/],
    ['mods', { hit: 'x' }, /mods\.hit 要是不為 0 的數字/],
    ['turn_start', { mana: 1 }, /turn_start 只能寫 ap、hp、hp_dice、load/],
    ['turn_start', { ap: 1.5 }, /turn_start 只能寫/],
    ['turn_start', 'x', /turn_start 只能寫/],
    ['until', 'never', /until 只能是/],
    ['turns', 0, /turns 要是 1 以上的整數/],
    ['turns', 1.5, /turns 要是 1 以上的整數/],
    ['kind', 'weird', /kind 只能是 control、debuff、buff、wound、mark/],
    ['no_move', 'yes', /no_move 要是布林值/],
    ['lose_turn', 1, /lose_turn 要是布林值/],
    ['once', 'x', /once 要是布林值/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('battle_status', STATUS, field, value as unknown)).toMatch(re)
  })
})

describe('白箱 weapon_class 的格式（COMBAT_SYSTEM 第 5 節的表）', () => {
  it('合格的樣本收得進來（霰彈有 far；沒有彈匣的近戰也行）', () => {
    expect(problems('weapon_class', WCLASS)).toBe('')
    expect(problems('weapon_class', { ...WCLASS, id: 'shotgun', dice: 5, far: { beyond: 2, dice: 3 }, ap: 3, traits: ['push'] })).toBe('')
    const melee = { ...WCLASS, id: 'melee', range: [1, 1], traits: ['melee'], attr: 'body', skill: 'brawl', cover_mult: 0 }
    delete (melee as Record<string, unknown>).mag
    expect(problems('weapon_class', melee)).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['dice', 0, /dice 要是 1 以上的整數/],
    ['dice', 2.5, /dice 要是 1 以上的整數/],
    ['far', { beyond: 2 }, /far 要有 beyond 與 dice/],
    ['far', 3, /far 要有 beyond 與 dice/],
    ['type', 'acid', /type 只能是/],
    ['range', [0, 3], /range 要是 \[近, 遠\]/],
    ['range', [3, 2], /range 要是 \[近, 遠\]/],
    ['range', [1, 8], /range 要是 \[近, 遠\]/],
    ['range', [1], /range 要是 \[近, 遠\]/],
    ['mag', 0, /mag 要是 1～4/],
    ['mag', 5, /mag 要是 1～4/],
    ['cover_mult', -1, /cover_mult 要是 0 以上的數字/],
    ['pierce', -1, /pierce 要是 0 以上的整數/],
    ['pierce', 1.5, /pierce 要是 0 以上的整數/],
    ['traits', 'melee', /traits 要是特性的陣列/],
    ['traits', [1], /traits 要是特性的陣列/],
    ['attr', 'luck', /attr 要是屬性的 id/],
    ['skill', '', /要有 skill/],
    ['ap', 0, /ap 要是 1～4/],
    ['ap', 5, /ap 要是 1～4/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('weapon_class', WCLASS, field, value as unknown)).toMatch(re)
  })

  it('weapon_class 引用不存在的基本功：引用檢查找得到', () => {
    const kernel = k()
    kernel.content.load('weapon_class', [WCLASS])
    expect(kernel.content.checkRefs()).toContain('weapon_class/pistol：引用了不存在的 skill/firearms')
  })
})

describe('白箱 資料蓋掉核心預設的查詢（battle.ts rules 的 modeOf、damageTypeOf、statusRuleOf）', () => {
  it('modeOf：沒有資料就用核心的預設；兩個戰場都有；沒有這個戰場回傳 undefined', () => {
    const c = k().content
    expect(modeOf(c, 'meat')).toBe(DEFAULT_MODES.meat)
    expect(modeOf(c, 'net')).toBe(DEFAULT_MODES.net)
    expect(modeOf(c, 'void')).toBeUndefined()
  })

  it('modeOf：資料有寫就以資料為準，numbers 只蓋寫了的鍵、其餘照這個戰場的預設（內海的位階倍率是 1）', () => {
    const c = k().content
    c.load('battle_mode', [
      { ...MODE, numbers: { apRegen: 4 }, armor_on_load: true },
      { ...MODE, id: 'net', name: '網', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', cover_names: ['a', 'b', 'c'], cover_word: '牆' },
      { ...MODE, id: 'arena', name: '競技場', numbers: { aiMaxSteps: 3 } },
    ])
    const meat = modeOf(c, 'meat')!
    expect(meat.numbers.apRegen).toBe(4)
    expect(meat.numbers.aiMaxSteps).toBe(DEFAULT_NUMBERS.aiMaxSteps)
    expect(meat.armorOnLoad).toBe(true)
    expect(meat.flashPool).toBeUndefined()
    const net = modeOf(c, 'net')!
    expect(net).toMatchObject({ flashPool: 'ram', armorOnLoad: false, coverWord: '牆', afterglow: { roll: -1, loadDealtPct: 10 } })
    expect(net.numbers.rankDamage).toEqual({ minion: 1, elite: 1, boss: 1 })
    // 沒有預設的戰場（資料新增的）：基底是核心的預設數字
    expect(modeOf(c, 'arena')!.numbers).toEqual({ ...DEFAULT_NUMBERS, aiMaxSteps: 3 })
  })

  it('damageTypeOf：資料的欄位轉成規則（needs_bridge、vs、on_hit、sink、dice）；dice 是 0 不帶；沒資料用預設', () => {
    const c = k().content
    expect(damageTypeOf(c, 'em')).toMatchObject({ dice: -1, vs: { machine: 2 } })
    c.load('damage_type', [
      { id: 'pleasure', name: '快感', track: 'load', armor: 0, needs_bridge: true, sink: 2, vs: { machine: 0 }, on_hit: [{ status: 'jammed', turns: 1 }] },
      { id: 'physical', name: '物理', track: 'hp', armor: 1, dice: 0 },
    ])
    const p = damageTypeOf(c, 'pleasure')
    expect(p).toMatchObject({ needsBridge: true, sink: 2, vs: { machine: 0 }, onHit: [{ status: 'jammed', turns: 1 }] })
    expect('dice' in damageTypeOf(c, 'physical')).toBe(false)
    expect(damageTypeOf(c, 'thermal')).toMatchObject({ dice: -1 })
  })

  it('statusRuleOf：失去回合是核心一定有的；資料的欄位（turn_start、once、cleansed_by）轉成規則；沒寫 turns 是 1', () => {
    const c = k().content
    expect(statusRuleOf(c, LOSE_TURN)).toBe(DEFAULT_STATUSES[LOSE_TURN])
    expect(statusRuleOf(c, 'nope')).toBeUndefined()
    c.load('battle_status', [
      STATUS,
      { id: 'burning', name: '燃燒', desc: '燃燒。', turn_start: { hp_dice: 1, hp: -1, load: 3 }, until: 'own_turn_start', turns: 2, kind: 'debuff', cleansed_by: ['water'] },
      { id: 'frozen', name: '癱瘓', desc: '動不了。', lose_turn: true, no_move: true, until: 'own_turn_start', kind: 'control' },
    ])
    expect(statusRuleOf(c, 'dazed')).toMatchObject({ turnStart: { ap: -2 }, once: true, turns: 1, kind: 'wound' })
    expect(statusRuleOf(c, 'burning')).toMatchObject({ turnStart: { hpDice: 1, hp: -1, load: 3 }, turns: 2, cleansedBy: ['water'] })
    expect(statusRuleOf(c, 'frozen')).toMatchObject({ loseTurn: true, noMove: true })
    expect(statusRuleOf(c, 'frozen')!.turnStart).toBeUndefined()
  })

  it('statusMod：這一筆自己的數字蓋掉資料的預設；都沒有是 0（沒有規則也是 0）', () => {
    const rule = { ...DEFAULT_STATUSES[LOSE_TURN]!, mods: { hit: -2 } }
    expect(statusMod(rule, { id: 'x', until: { at: 'battle_end' } }, 'hit')).toBe(-2)
    expect(statusMod(rule, { id: 'x', until: { at: 'battle_end' }, data: { hit: -4 } }, 'hit')).toBe(-4)
    expect(statusMod(rule, { id: 'x', until: { at: 'battle_end' } }, 'evade')).toBe(0)
    expect(statusMod(undefined, { id: 'x', until: { at: 'battle_end' } }, 'hit')).toBe(0)
  })
})

describe('白箱 遮蔽耐久與配置（COMBAT_SYSTEM 2.1 節；SITES 12.2 節）', () => {
  it('coverHpFor：照場景的等級；等級超出 1～5 夾進去（0 當 I、9 當 V）', () => {
    const n = DEFAULT_NUMBERS
    expect([1, 2, 3, 4, 5].map((g) => coverHpFor(n, 1, g as 1))).toEqual([15, 15, 20, 25, 30])
    expect([1, 2, 3, 4, 5].map((g) => coverHpFor(n, 2, g as 1))).toEqual([30, 30, 40, 50, 60])
    expect(coverHpFor(n, 2, 0 as 1)).toBe(30)
    expect(coverHpFor(n, 2, 9 as 1)).toBe(60)
  })

  it('四種配置都是每一方四格、值在 0～2；一邊倒是兩邊對調的', () => {
    for (const [name, l] of Object.entries(COVER_LAYOUTS)) {
      expect(l.ally, name).toHaveLength(4)
      expect(l.foe, name).toHaveLength(4)
      for (const v of [...l.ally, ...l.foe]) expect([0, 1, 2]).toContain(v)
    }
    expect(Object.keys(COVER_LAYOUTS).sort()).toEqual(['dense', 'medium', 'one_sided', 'sparse'])
  })
})
