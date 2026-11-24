// 驗收測試：dev/work/M3-deck.md（cpp-feature）。features/deck：甲板（M3 先當成品）、構裝槽、構裝、SKIN、腳本；
// 算出 RAM、槽數、防火牆、防護；把武器構裝與腳本帶進內海戰鬥；把甲板的樣子放到兩個戰場的單位上。
// 規格：CYBERSPACE 4.1～4.3、6.1、6.3 節；NETRUNNING 第 1 節；ITEMS 11.1、11.9、5.2 節；DATA 7.3、7.4 節；dev/adr/0018 第三節與 N9、N29、N33。
// 內容都是測試自帶的假資料：一副 II 級甲板、三個武器構裝（步槍原型 III 級、近戰原型、干擾）、兩個防護、一個被動工具、一支腳本、一套 SKIN；
// weapon_class 用測試自己的三筆。不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, attrMod, effectCtx, toMinutes } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { characterFeature } from '../../src/features/character'
import { deckFeature, deckOf, deckView, equipDraft, installBlock, installDraft, removeDraft, scriptsBlock, scriptsDraft, skinBlock, skinDraft } from '../../src/features/deck'
import { hackFeature } from '../../src/features/hack'
import { BATTLE_SETUPS, TEST_COMBAT, TEST_NET_COMBAT, makeGame, playOut } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 假資料 ----

const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' },
  { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
  { id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' },
]
const WEAPON_CLASSES = [
  { id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' },
  { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]
const deck = (id: string, o: Rec = {}) => ({ id, name: id, desc: `${id}。`, grade: 2, slots: 4, firewall: 12, legal: 'free', ...o })
const weapon = (id: string, o: Rec = {}) => ({ id, class: 'weapon', name: id, grade: 1, legal: 'register', type: 'neural', ram: 1, ...o })
const guard = (id: string, g: number) => ({ id, class: 'defense', name: id, grade: 1, legal: 'free', guard: g })
const ITEM = (id: string, o: Rec = {}) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...o })

const PACK: ContentPack = {
  id: 'deck_test',
  content: {
    skill: SKILLS,
    weapon_class: WEAPON_CLASSES,
    deck: [
      deck('dk_ii', { ram: { max: 2, regen: 1 }, cooling: 1, brand: 'nightingale', price: 2500 }),
      deck('dk_i', { grade: 1, slots: 2, firewall: 10 }),
      deck('dk_rent', { grade: 1, slots: 2, firewall: 9, name: '館方的比賽甲板', ram: { max: 1 } }),
    ],
    construct: [
      weapon('cs_rifle_3', { name: '夜巡', grade: 3, archetype: 'rifle', ram: 1, slots: 1 }),
      weapon('cs_blade', { name: '光刃', archetype: 'melee', ram: 1 }),
      weapon('cs_jam', { name: '靜電', archetype: 'pistol', type: 'jam', ram: 2 }),
      guard('cs_guard_2', 2),
      guard('cs_guard_4', 4),
      { id: 'cs_passive', class: 'tool', name: '回填器', grade: 2, legal: 'free', ap: 0, ram: 0, passive: true, mods: { evade: 2, refill: 1 } },
      { id: 'cs_probe', class: 'tool', name: '探針', grade: 1, legal: 'free', ap: 1, ram: 1, target: 'foe', do: [{ op: 'test.noop' }], advanced: { do: [{ op: 'test.noop' }] }, ultimate: null },
      { id: 'cs_admin', class: 'hack', name: '破城槌', grade: 1, legal: 'banned', admin: { crack: 2 } },
      { id: 'cs_body', class: 'body', name: '守門人', grade: 1, legal: 'permit', slots: 2 },
    ],
    skin: [{ id: 'sk_maid', name: '家政課女僕服', style: 'maid', style_value: 3, exposure: 0, cut: 'female', adult: false, price: 900 }],
    item: [ITEM('it_script', { name: '退熱貼', tags: ['script'] }), ITEM('it_gel', { name: '急救凝膠' })],
  },
} as unknown as ContentPack

/** 快駭程式的內容：只有裝了 features/hack 的那幾局才載（沒有人定義 quickhack 這個種類時載不進去）。 */
const HACK_PACK: ContentPack = {
  id: 'deck_test_hack',
  content: { quickhack: [{ id: 'qh_noise', name: '雜訊', desc: '雜訊。', class: 'neural', grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'test.noop' }] }] },
} as unknown as ContentPack

const BAG = [
  { id: 'dk_ii', qty: 1, data: { uid: 'D1' } }, { id: 'dk_i', qty: 1, data: { uid: 'D2' } },
  { id: 'cs_rifle_3', qty: 1 }, { id: 'cs_blade', qty: 1 }, { id: 'cs_jam', qty: 1 }, { id: 'cs_guard_2', qty: 1 }, { id: 'cs_guard_4', qty: 1 },
  { id: 'cs_passive', qty: 1 }, { id: 'cs_probe', qty: 1 }, { id: 'cs_admin', qty: 1 }, { id: 'qh_noise', qty: 1 },
  { id: 'it_script', qty: 4 }, { id: 'it_gel', qty: 2 }, { id: 'sk_maid', qty: 1 }, { id: 'cs_body', qty: 1 },
]

/** 測試自己的功能：一個什麼都不做的戰鬥效果（工具構裝的 do 要過格式檢查）、兩個衍生數值的 provider（旗標開著才加）、三種活動的替身、給主角 quickhack 標籤。 */
const HELPER: Feature = {
  id: 'deck_test_helper',
  install(k) {
    k.battle.effect('test.noop', 'deck_test_helper', () => {})
    k.stats.addStatProvider('deck_slots', 'deck_test_helper', (s) => (s.flags['t.boost'] ? [{ label: '技能', value: 2, source: 'test' }] : []))
    k.stats.addStatProvider('deck_slots_reserved', 'deck_test_helper', (s) => (s.flags['t.boost'] ? [{ label: '專屬構裝', value: 1, source: 'test' }] : []))
    for (const kind of ['netrun', 'face.net', 'dive']) {
      k.activity.define({ kind, owner: 'deck_test_helper', order: 50, active: (s) => (s.flags[`t.${kind}`] ? { id: kind, label: kind } : null), allow: ['commit:test.'], reason: () => `${kind} 進行中。` })
    }
    k.battle.loadout('deck_test_helper', (state, actor) => (state.flags['t.hacker'] && actor === 'pc' ? { tags: ['quickhack'] } : undefined))
  },
}

interface Opts {
  bag?: Rec[]
  features?: Feature[]
  packs?: ContentPack[]
  ext?: Rec
  seed?: number
}
const setup = (o: Opts = {}) => {
  const t = makeGame({
    features: o.features ?? [characterFeature, deckFeature, HELPER, TEST_COMBAT, TEST_NET_COMBAT], content: [PACK, ...(o.packs ?? [])], seed: o.seed,
    pc: { attrs: { reflex: 14, body: 12, charm: 12, resolve: 13, intellect: 12 }, skills: { firearms: 2, brawl: 1 }, ...(o.ext ? { ext: o.ext } : {}) },
    patch: { inventory: structuredClone((o.bag ?? BAG) as never) },
  })
  return t.game
}
type G = ReturnType<typeof setup>

const put = (g: G, d: ReportDraft) => g.commit(d)
const flag = (g: G, key: string, value: boolean | null) => g.commit({ kind: 'system', action: 'test.flag', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key, value }], outcome: { result: 'ok', summary: '旗標。' } })
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const wear = (g: G, uid = 'D1') => put(g, equipDraft(g.k, g.state, 'pc', uid))
const install = (g: G, ...items: string[]) => items.forEach((i) => put(g, installDraft(g.k, g.state, 'pc', i)))
const info = (g: G) => deckOf(g.k, g.state, 'pc')
const ids = (g: G) => info(g).equipped.map((p) => p.id)
const minutes = (g: G) => toMinutes(g.state.time)
const stat = (g: G, id: string) => g.k.stats.stat(g.state, 'pc', id)
const raw = (g: G) => g.state.actors.pc!.ext.deck as Rec | undefined
const netBattle = (g: G, allies: unknown[] = [{ from: 'actor', id: 'pc' }]) => g.startBattle({ ...BATTLE_SETUPS.net(), allies } as never)
const meatBattle = (g: G) => g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] } as never)

// ---- 沒有甲板 ----

describe('沒有甲板', () => {
  it('deckOf 說沒有、槽數 0、沒有 RAM 以外的東西可以裝；裝構裝被擋，原因是完整的一句', () => {
    const g = setup()
    expect(info(g)).toMatchObject({ has: false, source: null, deck: null, grade: 0, firewall: 0, slotsTotal: 0, capacity: 0, used: 0, equipped: [], scripts: [], scriptLimit: 0 })
    expect(stat(g, 'deck_slots')).toBe(0)
    expect(installBlock(g.k, g.state, 'pc', 'cs_blade')).toBe('沒有甲板。')
    expect(reasonOf(() => installDraft(g.k, g.state, 'pc', 'cs_blade'))).toBe('沒有甲板。')
  })

  it('有人給了槽數的加成（技能）也沒有用：沒有甲板就沒有槽', () => {
    const g = setup()
    flag(g, 't.boost', true)
    expect(info(g).slotsTotal).toBe(0)
    expect(installBlock(g.k, g.state, 'pc', 'cs_blade')).toBe('沒有甲板。')
  })

  it('進內海戰鬥：沒有 pools.ram、沒有武器、沒有 unit.ext.deck；現實的戰鬥也沒有 RAM', () => {
    const g = setup()
    netBattle(g)
    const u = g.battle!.units.a1!
    expect(u.pools.ram).toBeUndefined()
    expect(u.weapons).toEqual([])
    expect(u.ext.deck).toBeUndefined()
    const m = setup()
    meatBattle(m)
    expect(m.battle!.units.a1!.pools.ram).toBeUndefined()
  })
})

// ---- 裝上甲板與衍生數值 ----

describe('裝上甲板', () => {
  it('deck_slots、deck_firewall、deck_grade、ram_max、ram_regen 等於資料；背包裡沒有的、已經裝著的被擋；裝上不花時間', () => {
    const g = setup()
    const t0 = minutes(g)
    expect(reasonOf(() => equipDraft(g.k, g.state, 'pc', 'nope'))).toBe('背包裡沒有那一副甲板。')
    wear(g)
    expect(minutes(g)).toBe(t0)
    expect(info(g)).toMatchObject({ has: true, source: 'own', deck: 'dk_ii', uid: 'D1', grade: 2, firewall: 12, slotsTotal: 4, reserved: 0, capacity: 4, used: 0, free: 4, scriptLimit: 3 })
    expect([stat(g, 'deck_slots'), stat(g, 'deck_firewall'), stat(g, 'deck_grade')]).toEqual([4, 12, 2])
    // 甲板的 ram 加在 RAM 上：基本 4 ＋ mod(智識 12) ＋ 2；每回合 2 ＋ 1
    expect(stat(g, 'ram_max')).toBe(4 + attrMod(12) + 2)
    expect(stat(g, 'ram_regen')).toBe(3)
    expect(reasonOf(() => equipDraft(g.k, g.state, 'pc', 'D1'))).toBe('這一副已經裝著了。')
  })

  it('卸下甲板：槽空了、沒有 RAM 的加值、腳本放下；甲板還在背包裡', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_blade')
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 2 }]))
    put(g, equipDraft(g.k, g.state, 'pc', null))
    expect(info(g)).toMatchObject({ has: false, capacity: 0, equipped: [], scripts: [] })
    expect(g.state.inventory.some((s) => s.id === 'dk_ii')).toBe(true)
    expect(stat(g, 'ram_max')).toBe(4 + attrMod(12))
    expect(reasonOf(() => equipDraft(g.k, g.state, 'pc', null))).toBe('現在沒有裝著自己的甲板。')
  })

  it('換成槽比較少的甲板：裝不下的構裝退回背包（還在背包裡，只是不在槽上），帶的腳本也照新的上限整理', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_2')
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 3 }]))
    const r = put(g, equipDraft(g.k, g.state, 'pc', 'D2'))
    expect(info(g)).toMatchObject({ deck: 'dk_i', grade: 1, slotsTotal: 2, scriptLimit: 2 })
    expect(ids(g)).toEqual(['cs_rifle_3', 'cs_blade'])
    expect(raw(g)!.slots).toEqual(['cs_rifle_3', 'cs_blade'])
    expect(info(g).scripts).toEqual([{ item: 'it_script', qty: 2 }])
    expect(g.state.inventory.some((s) => s.id === 'cs_jam')).toBe(true)
    expect(r[0]!.timeline.some((b) => b.text.includes('退回背包'))).toBe(true)
  })
})

// ---- 構裝槽 ----

describe('構裝槽', () => {
  it('四槽：裝滿之後第五件被擋；同一件不能裝兩次；背包裡沒有的被擋；不是構裝的被擋', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_2')
    expect(info(g)).toMatchObject({ used: 4, free: 0 })
    expect(installBlock(g.k, g.state, 'pc', 'cs_guard_4')).toBe('構裝槽滿了（能用的 4 槽都裝著東西）。')
    expect(installBlock(g.k, g.state, 'pc', 'cs_blade')).toBe('這一件已經裝在槽裡了。')
    expect(installBlock(g.k, g.state, 'pc', 'it_gel')).toBe('這一件不是構裝，也不是快駭程式。')
    const h = setup({ bag: BAG.filter((s) => s.id !== 'cs_passive') })
    wear(h)
    expect(installBlock(h.k, h.state, 'pc', 'cs_passive')).toBe('背包裡沒有這一件。')
  })

  it('每裝一件時間 +1 分鐘、卸一件也是；卸下之後槽空出來；卸的是沒裝的就被擋', () => {
    const g = setup()
    wear(g)
    const t0 = minutes(g)
    install(g, 'cs_rifle_3', 'cs_blade')
    expect(minutes(g)).toBe(t0 + 2)
    expect(reasonOf(() => removeDraft(g.k, g.state, 'pc', 'cs_jam'))).toBe('這一件沒有裝在槽裡。')
    put(g, removeDraft(g.k, g.state, 'pc', 'cs_rifle_3'))
    expect(minutes(g)).toBe(t0 + 3)
    expect(ids(g)).toEqual(['cs_blade'])
    expect(info(g).free).toBe(3)
    expect(g.state.inventory.some((s) => s.id === 'cs_rifle_3')).toBe(true)
  })

  it('構裝與快駭程式共用同一排；佔兩槽的件佔兩格；快駭程式只認內容種類 quickhack 的 id（沒有人定義那個種類時不收）', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_blade', 'cs_body')
    expect(info(g)).toMatchObject({ used: 3, free: 1 })
    // 剩一槽：構裝體要 2 槽，原因寫剩幾槽；騰出一槽就裝得下
    put(g, removeDraft(g.k, g.state, 'pc', 'cs_body'))
    install(g, 'cs_jam', 'cs_guard_2')
    expect(info(g)).toMatchObject({ used: 3, free: 1 })
    expect(installBlock(g.k, g.state, 'pc', 'cs_body')).toBe('構裝槽不夠（只剩 1 槽，守門人要 2 槽）。')
    put(g, removeDraft(g.k, g.state, 'pc', 'cs_blade'))
    expect(installBlock(g.k, g.state, 'pc', 'cs_body')).toBeNull()
    install(g, 'cs_body')
    expect(installBlock(g.k, g.state, 'pc', 'cs_probe')).toBe('構裝槽滿了（能用的 4 槽都裝著東西）。')
  })

  it('快駭程式與構裝共用同一排槽；沒有人定義 quickhack 這個種類時，快駭程式的 id 不收', () => {
    const none = setup()
    wear(none)
    expect(none.k.content.hasKind('quickhack')).toBe(false)
    expect(installBlock(none.k, none.state, 'pc', 'qh_noise')).toBe('這一件不是構裝，也不是快駭程式。')
    const g = setup({ features: [characterFeature, deckFeature, hackFeature, HELPER, TEST_COMBAT, TEST_NET_COMBAT], packs: [HACK_PACK] })
    wear(g)
    install(g, 'qh_noise', 'cs_blade')
    expect(info(g)).toMatchObject({ used: 2 })
    expect(info(g).equipped.map((p) => [p.id, p.kind])).toEqual([['qh_noise', 'quickhack'], ['cs_blade', 'construct']])
  })

  it('等級高過甲板的不擋；deckView 標出照哪一級算（預設構裝照自己的等級算，規則 cap_construct_grade 打開才照甲板）', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_rifle_3')
    const v = deckView(g.k, g.state, 'pc')
    expect(v.equipped[0]).toMatchObject({ over: true, note: null, piece: { id: 'cs_rifle_3', grade: 3, runsAt: 3 } })
    const capped = setup({ packs: [{ id: 'rule', content: { deck_rule: [{ id: 'default', cap_construct_grade: true }] } } as never] })
    wear(capped)
    install(capped, 'cs_rifle_3')
    expect(deckView(capped.k, capped.state, 'pc').equipped[0]).toMatchObject({ over: true, note: '等級比甲板高（3 級對 2 級），會照甲板的等級跑。', piece: { runsAt: 2 } })
  })

  it('專屬構裝佔掉的槽與槽數的加成：能用的槽是 資料 +2 −1；加成拿掉時超出的件不算進去，槽回來又算', () => {
    const g = setup()
    wear(g)
    flag(g, 't.boost', true)
    expect(info(g)).toMatchObject({ slotsTotal: 6, reserved: 1, capacity: 5 })
    install(g, 'cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_2', 'cs_guard_4')
    expect(info(g)).toMatchObject({ used: 5, free: 0 })
    expect(installBlock(g.k, g.state, 'pc', 'cs_probe')).toBe('構裝槽滿了（能用的 5 槽都裝著東西）。')
    flag(g, 't.boost', null)
    expect(ids(g)).toEqual(['cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_2'])
    expect(info(g).inactive).toEqual(['cs_guard_4'])
    flag(g, 't.boost', true)
    expect(ids(g)).toHaveLength(5)
  })

  it('戰鬥中裝構裝被擋；替身活動（netrun、face.net、dive）進行中也被擋，原因各一句', () => {
    const g = setup()
    wear(g)
    for (const [kind, why] of [['netrun', '人在網內，不能換構裝。'], ['face.net', '人在網內，不能換構裝。'], ['dive', '潛入中，不能換構裝。']] as const) {
      flag(g, `t.${kind}`, true)
      expect(installBlock(g.k, g.state, 'pc', 'cs_blade'), kind).toBe(why)
      expect(reasonOf(() => installDraft(g.k, g.state, 'pc', 'cs_blade'))).toBe(why)
      flag(g, `t.${kind}`, null)
    }
    expect(installBlock(g.k, g.state, 'pc', 'cs_blade')).toBeNull()
    install(g, 'cs_blade')
    netBattle(g)
    expect(installBlock(g.k, g.state, 'pc', 'cs_jam')).toBe('戰鬥中不能換構裝。')
    expect(reasonOf(() => removeDraft(g.k, g.state, 'pc', 'cs_blade'))).toBe('戰鬥中不能換構裝。')
    expect(reasonOf(() => equipDraft(g.k, g.state, 'pc', 'D2'))).toBe('戰鬥中不能換甲板。')
  })
})

// ---- 防護 ----

describe('防護', () => {
  it('兩個防護構裝（2 與 4）：net_guard 是 4（只算最高的一件，不疊）；卸掉最高的變 2；沒有防護是 0', () => {
    const g = setup()
    expect(stat(g, 'net_guard')).toBe(0)
    wear(g)
    install(g, 'cs_guard_2')
    expect(stat(g, 'net_guard')).toBe(2)
    install(g, 'cs_guard_4')
    expect(stat(g, 'net_guard')).toBe(4)
    put(g, removeDraft(g.k, g.state, 'pc', 'cs_guard_4'))
    expect(stat(g, 'net_guard')).toBe(2)
  })

  it('進內海：單位的護甲是 net_guard（核心讀 guard_stat）', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_guard_2', 'cs_guard_4')
    netBattle(g)
    expect(g.battle!.units.a1!.armor).toBe(4)
  })
})

// ---- 帶進內海戰鬥 ----

describe('內海的 loadout', () => {
  const armed = (): G => {
    const g = setup()
    wear(g)
    install(g, 'cs_rifle_3', 'cs_blade', 'cs_jam')
    return g
  }

  it('III 級步槍原型：骰數是原型 +1、命中是 mod(反應) ＋ 槍械 ＋1、flat 是 mod(魅力)、pool.ram 是資料的、沒有 mag、類型神經', () => {
    const g = armed()
    netBattle(g)
    const w = g.battle!.units.a1!.weapons.find((x) => x.id === 'cs_rifle_3')!
    expect(w).toMatchObject({ name: '夜巡', class: 'rifle', dice: 4 + 1, hit: attrMod(14) + 2 + 1, flat: attrMod(12), type: 'neural', attr: 'reflex', skill: 'firearms', pool: { ram: 1 }, range: [3, 7], coverMult: 0.5 })
    expect(w.mag).toBeUndefined()
    expect(w.traits).toContain('long')
  })

  it('近戰原型的那一把命中用意志（體格由意志代替）；固定傷害一樣是魅力', () => {
    const g = armed()
    netBattle(g)
    const w = g.battle!.units.a1!.weapons.find((x) => x.id === 'cs_blade')!
    expect(w).toMatchObject({ class: 'melee', hit: attrMod(13) + 1, flat: attrMod(12), attr: 'resolve', dice: 3, pool: { ram: 1 } })
    expect(w.mag).toBeUndefined()
  })

  it('干擾的那一把帶 jam 特性，傷害類型是神經，花資料寫的 RAM', () => {
    const g = armed()
    netBattle(g)
    const w = g.battle!.units.a1!.weapons.find((x) => x.id === 'cs_jam')!
    expect(w).toMatchObject({ type: 'neural', pool: { ram: 2 }, dice: 3 })
    expect(w.traits).toContain('jam')
  })

  it('三把武器照槽的順序；RAM 的池是甲板給的（上限 4 ＋ mod(智識) ＋ 2、回復 3）', () => {
    const g = armed()
    netBattle(g)
    const u = g.battle!.units.a1!
    expect(u.weapons.map((w) => w.id)).toEqual(['cs_rifle_3', 'cs_blade', 'cs_jam'])
    expect(u.pools.ram).toEqual({ now: 4 + attrMod(12) + 2, max: 4 + attrMod(12) + 2, regen: 3 })
  })

  it('現實的 loadout 不含它們（武器、腳本都不帶進現實的戰鬥），但 unit.ext.deck 兩邊都有', () => {
    const g = armed()
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 2 }]))
    meatBattle(g)
    const u = g.battle!.units.a1!
    expect(u.weapons.map((w) => w.id)).toEqual(['unarmed'])
    expect(u.quick).toEqual([])
    expect(u.ext.deck).toEqual({ grade: 2, firewall: 12, slots: [], constructs: [{ id: 'cs_rifle_3', class: 'weapon', grade: 3 }, { id: 'cs_blade', class: 'weapon', grade: 1 }, { id: 'cs_jam', class: 'weapon', grade: 1 }] })
    expect(u.pools.ram).toBeDefined()
  })

  it('被動的工具的 mods 在內海生效（迴避 +2），不在現實；沒裝就沒有', () => {
    const g = setup()
    wear(g)
    netBattle(g)
    const bare = g.battle!.units.a1!.evade
    const h = setup()
    wear(h)
    install(h, 'cs_passive', 'cs_probe')
    netBattle(h)
    const run = (game: G, mode: string) => game.k.battle.modifiers({ kind: 'evade', unit: game.battle!.units.a1!, tags: [], view: { mode: { layer: mode }, k: game.k } as never })
    expect(run(h, 'net')).toEqual([{ label: '回填器', value: 2, source: 'construct' }])
    expect(run(h, 'meat')).toEqual([])
    expect(run(g, 'net')).toEqual([])
    expect(bare).toBe(g.battle!.units.a1!.evade)
  })

  it('unit.ext.deck 在內海也有；快駭程式列在 slots、構裝列在 constructs', () => {
    const g = setup({ features: [characterFeature, deckFeature, hackFeature, HELPER, TEST_COMBAT, TEST_NET_COMBAT], packs: [HACK_PACK] })
    wear(g)
    install(g, 'qh_noise', 'cs_blade', 'cs_guard_2')
    netBattle(g)
    expect(g.battle!.units.a1!.ext.deck).toEqual({ grade: 2, firewall: 12, slots: ['qh_noise'], constructs: [{ id: 'cs_blade', class: 'weapon', grade: 1 }, { id: 'cs_guard_2', class: 'defense', grade: 1 }] })
  })

  it('和 hackFeature 一起裝（deck 在前）：現實戰鬥主角有 RAM、圓環上有那支快駭程式', () => {
    const FEATS = [characterFeature, deckFeature, hackFeature, combatFeature, HELPER]
    const g = setup({ features: FEATS, packs: [HACK_PACK] })
    flag(g, 't.hacker', true)
    wear(g)
    install(g, 'qh_noise')
    meatBattle(g)
    const u = g.battle!.units.a1!
    expect(u.tags).toContain('quickhack')
    expect(u.pools.ram?.max).toBe(4 + attrMod(12) + 2)
    expect(u.ext.deck).toMatchObject({ grade: 2, firewall: 12, slots: ['qh_noise'] })
    const def = g.k.battle.getAction('hack.qh_noise')!
    expect(def).toBeDefined()
    expect(def.has?.({ k: g.k, state: g.state, battle: g.battle! } as never, u)).toBe(true)
    // 沒有裝進槽的人圓環上沒有它
    const h = setup({ features: FEATS, packs: [HACK_PACK] })
    flag(h, 't.hacker', true)
    wear(h)
    meatBattle(h)
    expect(h.k.battle.getAction('hack.qh_noise')!.has?.({ k: h.k, state: h.state, battle: h.battle! } as never, h.battle!.units.a1!)).toBe(false)
  })
})

// ---- 腳本 ----

describe('腳本', () => {
  it('II 級甲板最多帶 3 支，第 4 支被擋；不是腳本的、背包裡不夠的、沒有甲板的被擋', () => {
    const g = setup()
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_script', qty: 1 }])).toBe('沒有甲板，不能帶腳本。')
    wear(g)
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_script', qty: 3 }])).toBeNull()
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_script', qty: 4 }])).toBe('最多帶 3 支腳本（II 級甲板），現在要帶 4 支。')
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_script', qty: 2 }, { item: 'it_script', qty: 2 }])).toBe('最多帶 3 支腳本（II 級甲板），現在要帶 4 支。')
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_gel', qty: 1 }])).toBe('急救凝膠不是腳本。')
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_script', qty: 0 }])).toBe('腳本的數量要是 1 以上的整數。')
    const poor = setup({ bag: BAG.map((s) => (s.id === 'it_script' ? { ...s, qty: 1 } : s)) })
    wear(poor)
    expect(scriptsBlock(poor.k, poor.state, 'pc', [{ item: 'it_script', qty: 2 }])).toBe('背包裡的退熱貼不夠 2 個。')
  })

  it('帶上之後 deckOf 讀得到；整份換掉；放下；腳本不佔構裝槽', () => {
    const g = setup()
    wear(g)
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 3 }]))
    expect(info(g).scripts).toEqual([{ item: 'it_script', qty: 3 }])
    expect(info(g).used).toBe(0)
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 1 }]))
    expect(info(g).scripts).toEqual([{ item: 'it_script', qty: 1 }])
    put(g, scriptsDraft(g.k, g.state, 'pc', []))
    expect(info(g).scripts).toEqual([])
  })

  it('進內海戰鬥在 quick；戰鬥裡用掉一支，結束之後背包與 scripts 各少一支', async () => {
    const g = setup()
    wear(g)
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 3 }]))
    netBattle(g)
    const u = g.battle!.units.a1!
    expect(u.quick).toEqual([{ item: 'it_script', qty: 3 }])
    // 戰鬥裡用掉一支（這裡直接改單位的快取格；怎麼用是戰鬥行動的事）
    u.quick = [{ item: 'it_script', qty: 2 }]
    playOut(g)
    await g.finishBattle()
    expect(g.state.inventory.find((s) => s.id === 'it_script')!.qty).toBe(3)
    expect(info(g).scripts).toEqual([{ item: 'it_script', qty: 2 }])
    expect(raw(g)!.scripts).toEqual([{ item: 'it_script', qty: 2 }])
  })

  it('沒用掉就一支都不少；現實的戰鬥不動 scripts', async () => {
    const g = setup()
    wear(g)
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 2 }]))
    netBattle(g)
    playOut(g)
    await g.finishBattle()
    expect(g.state.inventory.find((s) => s.id === 'it_script')!.qty).toBe(4)
    expect(info(g).scripts).toEqual([{ item: 'it_script', qty: 2 }])
  })

  it('戰鬥中換腳本被擋', () => {
    const g = setup()
    wear(g)
    netBattle(g)
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_script', qty: 1 }])).toBe('戰鬥中不能換腳本。')
  })
})

// ---- SKIN ----

describe('SKIN', () => {
  it('背包裡有才穿得上；穿上、換掉、脫下；不佔構裝槽、不用甲板；戰鬥中不能換', () => {
    const g = setup()
    expect(skinBlock(g.k, g.state, 'pc', 'sk_nope')).toBe('這不是一套 SKIN。')
    const poor = setup({ bag: BAG.filter((s) => s.id !== 'sk_maid') })
    expect(skinBlock(poor.k, poor.state, 'pc', 'sk_maid')).toBe('背包裡沒有這一套 SKIN。')
    put(g, skinDraft(g.k, g.state, 'pc', 'sk_maid'))
    expect(info(g).skin).toBeNull() // 沒有甲板時 deckOf 只說沒有；穿著的記在 ext
    expect(raw(g)!.skin).toBe('sk_maid')
    expect(skinBlock(g.k, g.state, 'pc', 'sk_maid')).toBe('已經穿著這一套了。')
    wear(g)
    expect(info(g)).toMatchObject({ skin: 'sk_maid', used: 0 })
    put(g, skinDraft(g.k, g.state, 'pc', null))
    expect(raw(g)!.skin).toBeUndefined()
    expect(skinBlock(g.k, g.state, 'pc', null)).toBe('現在沒有穿著 SKIN。')
    netBattle(g)
    expect(skinBlock(g.k, g.state, 'pc', 'sk_maid')).toBe('戰鬥中不能換 SKIN。')
  })

  it('網內的行程進行中 SKIN 照樣可以換（這一條只擋戰鬥中）', () => {
    const g = setup()
    flag(g, 't.netrun', true)
    expect(skinBlock(g.k, g.state, 'pc', 'sk_maid')).toBe('netrun 進行中。')
  })
})

// ---- 租來的甲板 ----

describe('效果 deck_rental', () => {
  const give = (g: G, effect: Rec, source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve([effect], effectCtx(g.k, g.state, { source }))
  const rent = (g: G, deckId: string | null) => {
    const r = give(g, { kind: 'deck_rental', deck: deckId })
    expect(r.errors).toEqual([])
    if (r.changes.length) g.commit({ kind: 'action', action: 'test.rent', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '租。' } })
    return r
  }

  it('給一副 2 槽的甲板：deckOf 用它的數字，四件裝著的只算前兩件；收回之後回到自己的', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_2')
    rent(g, 'dk_rent')
    expect(info(g)).toMatchObject({ source: 'rental', deck: 'dk_rent', grade: 1, firewall: 9, slotsTotal: 2, capacity: 2, used: 2 })
    expect(ids(g)).toEqual(['cs_rifle_3', 'cs_blade'])
    expect(info(g).inactive).toEqual(['cs_jam', 'cs_guard_2'])
    expect(stat(g, 'ram_max')).toBe(4 + attrMod(12) + 1)
    expect(stat(g, 'net_guard')).toBe(0)
    expect(raw(g)!.slots).toEqual(['cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_2'])
    const r = rent(g, null)
    expect(r.lines).toEqual(['收回了租來的甲板'])
    expect(info(g)).toMatchObject({ source: 'own', deck: 'dk_ii', grade: 2, slotsTotal: 4, used: 4 })
    expect(stat(g, 'net_guard')).toBe(2)
  })

  it('沒有自己的甲板也能租；租來的蓋過自己的；沒有租就收回是不做事', () => {
    const g = setup()
    expect(rent(g, null).changes).toEqual([])
    rent(g, 'dk_rent')
    expect(info(g)).toMatchObject({ has: true, source: 'rental' })
    expect(info(g).uid).toBeUndefined()
    install(g, 'cs_blade')
    expect(ids(g)).toEqual(['cs_blade'])
    rent(g, null)
    expect(info(g).has).toBe(false)
  })

  it('who 指定給誰；內容裡沒有的甲板、不存在的角色、多餘的欄位被擋', () => {
    const g = setup()
    expect(give(g, { kind: 'deck_rental', deck: 'dk_nope' }).errors).toHaveLength(1)
    expect(give(g, { kind: 'deck_rental', deck: 'dk_rent', who: 'nobody' }).errors).toHaveLength(1)
    expect(give(g, { kind: 'deck_rental', deck: 'dk_rent', extra: 1 }).errors).toHaveLength(1)
    expect(give(g, { kind: 'deck_rental' }).errors).toHaveLength(1)
    expect(give(g, { kind: 'deck_rental', deck: 'dk_rent', who: 'pc' }).errors).toEqual([])
  })

  it('AI 與玩家要的這個效果被擋（只有內建的來源能給）', () => {
    const g = setup()
    expect(give(g, { kind: 'deck_rental', deck: 'dk_rent' }, 'ai').errors).not.toEqual([])
    expect(give(g, { kind: 'deck_rental', deck: 'dk_rent' }, 'player').errors).not.toEqual([])
  })
})

// ---- 資料壞掉 ----

describe('actor.ext.deck 被改壞', () => {
  it('slots 不是陣列、uid 指到不存在的那一疊：讀成沒有甲板或空的槽，不丟錯', () => {
    const g = setup()
    for (const bad of [{ slots: 'x', uid: 'nope' }, { uid: 'D1', slots: 7 }, { uid: 5, slots: ['cs_blade', 'cs_blade', 5, null, 'cs_nope'], scripts: 'x', skin: 9 }, 'abc', 42, [1, 2], { rental: { deck: 'dk_nope' }, uid: 'D1', slots: {} }]) {
      g.state.actors.pc!.ext.deck = bad as never
      const i = info(g)
      expect(() => deckView(g.k, g.state, 'pc')).not.toThrow()
      expect(i.equipped.length).toBeLessThanOrEqual(i.capacity)
      expect(i.scripts).toEqual([])
    }
    g.state.actors.pc!.ext.deck = { slots: 'x', uid: 'nope' } as never
    expect(info(g).has).toBe(false)
    g.state.actors.pc!.ext.deck = { uid: 'D1', slots: 7 } as never
    expect(info(g)).toMatchObject({ has: true, equipped: [] })
    g.state.actors.pc!.ext.deck = { uid: 'D1', slots: ['cs_blade', 'cs_blade', 'cs_guard_2'] } as never
    expect(ids(g)).toEqual(['cs_blade', 'cs_guard_2'])
    // 壞掉的資料進戰鬥也不丟錯
    g.state.actors.pc!.ext.deck = { slots: 'x', uid: 'nope' } as never
    expect(() => netBattle(g)).not.toThrow()
  })

  it('背包裡已經沒有的構裝不算（賣掉了），槽騰出來', () => {
    const g = setup()
    wear(g)
    install(g, 'cs_blade', 'cs_jam')
    g.commit({ kind: 'action', action: 'test.sell', location: {}, party: [], timeline: [], changes: [{ op: 'item', id: 'cs_blade', qty: -1 }], outcome: { result: 'ok', summary: '賣掉。' } })
    expect(ids(g)).toEqual(['cs_jam'])
    expect(info(g)).toMatchObject({ used: 1, inactive: ['cs_blade'] })
  })
})

// ---- 內容的格式 ----

describe('內容種類的格式檢查', () => {
  const g = setup()
  const bad = (kind: string, e: Rec) => g.k.content.validate(kind, [e])
  const ok = (kind: string, e: Rec) => expect(bad(kind, e)).toEqual([])

  it('deck 擋得下三種寫壞的資料', () => {
    ok('deck', deck('dk_ok'))
    expect(bad('deck', deck('dk_a', { grade: 5 })).join()).toContain('grade 要是 1～4')
    expect(bad('deck', deck('dk_b', { slots: -1, firewall: 'x' })).join()).toContain('slots')
    expect(bad('deck', deck('dk_c', { legal: 'nope', ram: { max: -1 } })).join()).toContain('legal 只能是')
    expect(bad('deck', deck('dk_c', { ram: { max: -1 } })).join()).toContain('ram.max')
  })

  it('construct 擋得下三種寫壞的資料；do 用了沒有人註冊的效果被擋', () => {
    ok('construct', weapon('cs_ok', { archetype: 'rifle' }))
    ok('construct', { id: 'cs_ok2', class: 'tool', name: '探針', grade: 1, legal: 'free', ap: 1, ram: 1, do: [{ op: 'test.noop' }] })
    expect(bad('construct', { id: 'cs_a', class: 'gun', name: 'x', grade: 1, legal: 'free' }).join()).toContain('class 只能是')
    expect(bad('construct', weapon('cs_b', { archetype: 'rifle', type: 'physical', ram: -1 })).join()).toMatch(/type 只能是.*ram/)
    expect(bad('construct', { id: 'cs_c', class: 'defense', name: 'x', grade: 9, legal: 'free' }).join()).toMatch(/grade.*guard/)
    expect(bad('construct', { id: 'cs_d', class: 'tool', name: 'x', grade: 1, legal: 'free', ap: 1, ram: 1, do: [{ op: 'no.such.op' }] }).join()).toContain('不認得的效果 no.such.op')
    expect(bad('construct', { id: 'cs_e', class: 'tool', name: 'x', grade: 1, legal: 'free', ap: 1, ram: 1, mods: { nonsense: 1 } }).join()).toContain('mods.nonsense')
    expect(bad('construct', { id: 'cs_f', class: 'tool', name: 'x', grade: 1, legal: 'free', ap: 1, ram: 1, ultimate: { do: [{ op: 'no.such.op' }] } }).join()).toContain('ultimate.do')
  })

  it('construct 的武器要查得到原型（引用檢查）', () => {
    expect(() => setup({ packs: [{ id: 'dangling', content: { construct: [weapon('cs_dangling', { archetype: 'cannon' })] } } as never] })).toThrow(/weapon_class\/cannon/)
  })

  it('skin 擋得下三種寫壞的資料', () => {
    ok('skin', { id: 'sk_ok', name: '女僕服', style: 'maid', style_value: 3, exposure: 0, cut: 'female' })
    expect(bad('skin', { id: 'sk_a' }).join()).toContain('要有 name')
    expect(bad('skin', { id: 'sk_b', name: 'x', style_value: 9, exposure: 7 }).join()).toMatch(/style_value.*exposure/)
    expect(bad('skin', { id: 'sk_c', name: 'x', cut: 'robot', adult: 'yes', forms: [1] }).join()).toMatch(/cut.*adult.*forms/)
  })

  it('deck_rule 是規則表：後載入的取代；寫壞的擋下', () => {
    expect(bad('deck_rule', { id: 'default', script_extra: -1 }).join()).toContain('script_extra')
    expect(bad('deck_rule', { id: 'default', grade_bonus: { 9: { hit: 1, dice: 0 } } }).join()).toContain('grade_bonus.9')
    expect(g.k.content.isOverridable('deck_rule')).toBe(true)
  })
})

// ---- 規則的數字 ----

describe('規則表 deck_rule', () => {
  const RULE = { id: 'deck_rule_pack', content: { deck_rule: [{ id: 'default', swap_minutes: 3, script_extra: 2, ram_regen: 3, grade_bonus: { 2: { hit: 5, dice: 1 } } }] } } as never

  it('換一件幾分鐘、腳本的上限、RAM 回復的基本值、等級的加值都讀資料', () => {
    const g = setup({ packs: [RULE] })
    wear(g)
    const t0 = minutes(g)
    install(g, 'cs_blade')
    expect(minutes(g) - t0).toBe(3)
    expect(info(g).scriptLimit).toBe(4)
    expect(stat(g, 'ram_regen')).toBe(3 + 1)
    put(g, scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_script', qty: 4 }]))
    // II 級的加值改成命中 +5、多 1 顆
    install(g, 'cs_jam')
    put(g, removeDraft(g.k, g.state, 'pc', 'cs_jam'))
    const h = setup({ packs: [RULE, { id: 'extra', content: { construct: [weapon('cs_two', { grade: 2, archetype: 'pistol' })] } } as never], bag: [...BAG, { id: 'cs_two', qty: 1 }] })
    wear(h)
    install(h, 'cs_two')
    netBattle(h)
    expect(h.battle!.units.a1!.weapons[0]).toMatchObject({ hit: attrMod(14) + 2 + 5, dice: 3 + 1 })
  })
})

// ---- deckView ----

describe('deckView（給畫面）', () => {
  it('每一格、背包裡裝得上的與為什麼裝不上、背包裡的甲板、SKIN、腳本', () => {
    const g = setup()
    wear(g)
    flag(g, 't.boost', true)
    install(g, 'cs_blade', 'cs_guard_2')
    const v = deckView(g.k, g.state, 'pc')
    expect(v.cells.map((c) => c.piece?.id ?? (c.reserved ? 'reserved' : null))).toEqual(['cs_blade', 'cs_guard_2', null, null, null, 'reserved'])
    expect(v.equipped.map((e) => e.removeBlock)).toEqual([null, null])
    const cand = Object.fromEntries(v.candidates.map((c) => [c.item, c.block]))
    expect(cand.cs_rifle_3).toBeNull()
    expect(cand.cs_blade).toBeUndefined()
    expect(v.decks.map((d) => [d.uid, d.current])).toEqual([['D1', true], ['D2', false]])
    expect(v.skins).toEqual([{ item: 'sk_maid', name: '家政課女僕服', worn: false, block: null }])
    expect(v.scripts).toMatchObject({ limit: 3, carried: [], available: [{ item: 'it_script', name: '退熱貼', have: 4 }], block: null })
    // 裝不上的原因：戰鬥中
    netBattle(g)
    const during = deckView(g.k, g.state, 'pc')
    expect(during.candidates.every((c) => c.block === '戰鬥中不能換構裝。')).toBe(true)
    expect(during.decks.every((d) => d.block === '戰鬥中不能換甲板。')).toBe(true)
  })

  it('沒有甲板時：沒有格子、每一件都是「沒有甲板。」', () => {
    const g = setup()
    const v = deckView(g.k, g.state, 'pc')
    expect(v.cells).toEqual([])
    expect(v.candidates.length).toBeGreaterThan(0)
    expect(v.candidates.every((c) => c.block === '沒有甲板。')).toBe(true)
  })
})

// ---- 存檔 ----

describe('存檔', () => {
  it('存檔再讀，甲板與槽一樣；之後的結果一樣', () => {
    const a = setup()
    wear(a)
    install(a, 'cs_rifle_3', 'cs_guard_4')
    put(a, scriptsDraft(a.k, a.state, 'pc', [{ item: 'it_script', qty: 2 }]))
    put(a, skinDraft(a.k, a.state, 'pc', 'sk_maid'))
    const saved = a.save()
    const b = setup()
    expect(b.load(saved)).toBeNull()
    expect(raw(b)).toEqual(raw(a))
    expect(JSON.stringify(info(b))).toBe(JSON.stringify(info(a)))
    expect(stat(b, 'net_guard')).toBe(4)
    put(a, installDraft(a.k, a.state, 'pc', 'cs_blade'))
    put(b, installDraft(b.k, b.state, 'pc', 'cs_blade'))
    expect(JSON.stringify(info(b))).toBe(JSON.stringify(info(a)))
  })
})

// ---- 其他功能一起裝 ----

describe('和全部功能一起裝', () => {
  it('allFeatures 裝得起來（deck 在 hack 前面）', async () => {
    const { FEATURES } = await import('../../src/features')
    const order = Object.keys(FEATURES)
    expect(order.indexOf('deck')).toBeGreaterThan(-1)
    expect(order.indexOf('deck')).toBeLessThan(order.indexOf('hack'))
  })
})
