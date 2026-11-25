// 驗收測試：dev/work/M4-cyber-deck.md（cpp-feature）。甲板是腦部的義體：features/deck 的來源換成掛點 deck.source，features/cyberware 回答。
// 規格：CYBERWARE 第 1 節（腦：甲板）、第 2 節（侵入：甲板）；CRAFTING 3.1 節；CYBERSPACE 4.2 節；dev/adr/0018 第三節；dev/adr/0019 第三節「甲板是腦部的義體」與 P50、P51。
// 內容一律用測試自帶的最小假資料：兩副 M3 格式的成品甲板、一張帶 deck 欄位的腦部設計圖與兩顆晶片、三個構裝；站上設施用真的 world（正規診所、無照診所）。
//
// 使用者裁決（2026-11-25）：不做舊存檔的甲板搬移（工單第 5 條與它的驗收條件）；示意世界包開局直接裝著入門甲板（ui/src/data/demo/net.ts）。所以沒有 save.loaded 的測試。
// 時間：測試從第 3 天 10:00 開始。成品甲板 dk_ii 的價錢 2500：正規診所手術費 1250、無照診所 750；沉溺成本預設 6（正規診所 −10% 四捨五入是 5，無照診所照 6）；
// 侵入度沒寫是 invasive，休養 1440 分鐘（規則表 cyber_rule.recovery_minutes）。

import { afterEach, describe, expect, it } from 'vitest'
import type { ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, attrMod, effectCtx, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import {
  DECK_FULL, DEFAULT_CYBER_RULES, brainDeck, cyberOf, cyberView, cyberwareFeature, deckSourceOf, installBlock as cyberInstallBlock, installDraft as cyberInstallDraft, installQuote,
  removeBlock as cyberRemoveBlock, removeDraft as cyberRemoveDraft, removeQuote,
} from '../../src/features/cyberware'
import { IMPLANT_ONLY, deckFeature, deckOf, deckView, equipBlock, equipDraft, installBlock, installDraft } from '../../src/features/deck'
import { hackFeature } from '../../src/features/hack'
import { arrive, worldFeature } from '../../src/features/world'
import { BATTLE_SETUPS, TEST_COMBAT, TEST_NET_COMBAT, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
} as never

const deck = (id: string, o: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, grade: 2, slots: 4, firewall: 12, legal: 'free', ...o })
const weapon = (id: string, o: Rec = {}): Rec => ({ id, class: 'weapon', name: id, grade: 1, legal: 'register', type: 'neural', ram: 1, ...o })
const guard = (id: string, g: number): Rec => ({ id, class: 'defense', name: id, grade: 1, legal: 'free', guard: g })
const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_clinic', name: '診所', clinic: { grade: 'clinic' } },
      { id: 'fac_unlic', name: '無照診所', clinic: { grade: 'unlicensed' } },
      { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '正規診所' }, F2: { type: 'fac_unlic', name: '無照診所' }, F3: { type: 'fac_black', name: '黑診所' } } }],
    skill: [
      { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' },
      { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
    ],
    weapon_class: [
      { id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' },
      { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
    ],
    deck: [
      deck('dk_ii', { name: '夜鶯入門甲板 II', ram: { max: 2, regen: 1 }, cooling: 1, brand: 'nightingale', price: 2500 }),
      deck('dk_i', { name: '小甲板 I', grade: 1, slots: 2, firewall: 10, price: 900 }),
      deck('dk_rent', { name: '館方的比賽甲板', grade: 1, slots: 2, firewall: 9, ram: { max: 1 } }),
      deck('dk_light', { name: '輕量甲板', grade: 1, slots: 3, firewall: 8, price: 1000, sink_cost: 3, invasiveness: 'light' }),
    ],
    construct: [
      weapon('cs_rifle_3', { name: '夜巡', grade: 3, archetype: 'rifle', ram: 1, slots: 1 }),
      weapon('cs_blade', { name: '光刃', archetype: 'melee', ram: 1 }),
      guard('cs_guard_2', 2),
      guard('cs_guard_4', 4),
      guard('cs_guard_3', 3),
    ],
    // 設計圖組的腦部甲板：設計圖 deck 的數字加零件 stats 的合計
    part: [
      part('pt_core', 'core', { price: 500 }),
      part('pt_ext', 'addon', { price: 200, stats: { slots: 1, ram_max: 1, ram_regen: 1, cooling: 1 } }),
      part('pt_wall', 'addon', { price: 200, stats: { firewall: 3, slots: 0 } }),
    ],
    blueprint: [{
      id: 'bp_deck', kind: 'cyberware', name: '訂製甲板', desc: '腦部的訂製甲板。', brand: 'hz', grade: 3, legal: 'register', price: 1000, require: [{ type: 'core' }], optional: [{ type: 'addon', count: 2 }],
      slot: 'brain', invasiveness: 'invasive', sink_cost: 7, deck: { slots: 3, firewall: 10, ram: { max: 1 }, cooling: 1 },
    }, {
      id: 'bp_chip', kind: 'cyberware', name: '反射加速器', desc: '腦部的另一件義體。', brand: 'hz', grade: 1, legal: 'free', price: 400, require: [], optional: [], slot: 'brain', invasiveness: 'light', sink_cost: 2,
    }],
  }
  patch(c)
  return { id: 'cyber_deck_test', content: c as unknown as ContentPack['content'] }
}

const HACK_PACK: ContentPack = {
  id: 'cyber_deck_hack',
  content: { quickhack: [{ id: 'qh_noise', name: '雜訊', desc: '雜訊。', class: 'neural', grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'test.noop' }] }] },
} as unknown as ContentPack

/** 測試自己的功能：一個什麼都不做的戰鬥效果、三種活動的替身（旗標開著才算進行中）、給主角 quickhack 標籤。 */
const HELPER: Feature = {
  id: 'cyber_deck_helper',
  install(k) {
    k.battle.effect('test.noop', 'cyber_deck_helper', () => {})
    for (const kind of ['netrun', 'face.net', 'dive']) {
      k.activity.define({ kind, owner: 'cyber_deck_helper', order: 50, active: (s) => (s.flags[`t.${kind}`] ? { id: kind, label: kind } : null), allow: ['commit:test.'], reason: () => `${kind} 進行中。` })
    }
    k.battle.loadout('cyber_deck_helper', (state, actor) => (state.flags['t.hacker'] && actor === 'pc' ? { tags: ['quickhack'] } : undefined))
  },
}

const PARAMS = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const BAG = [
  { id: 'dk_ii', qty: 1, data: { uid: 'D1' } }, { id: 'dk_i', qty: 1, data: { uid: 'D2' } }, { id: 'dk_light', qty: 1, data: { uid: 'D3' } },
  { id: 'bp_deck', qty: 1, data: { uid: 'B1', parts: { core: 'pt_core', addon: ['pt_ext', 'pt_wall'] } } },
  { id: 'bp_deck', qty: 1, data: { uid: 'B2', parts: { core: 'pt_core' } } },
  { id: 'bp_chip', qty: 1, data: { uid: 'C1' } },
  { id: 'cs_rifle_3', qty: 1 }, { id: 'cs_blade', qty: 1 }, { id: 'cs_guard_2', qty: 1 }, { id: 'cs_guard_4', qty: 1 }, { id: 'cs_guard_3', qty: 1 }, { id: 'qh_noise', qty: 1 },
]

interface Opts {
  /** 不裝義體功能（M3 的局） */
  noCyber?: boolean
  features?: Feature[]
  packs?: ContentPack[]
  bag?: Rec[]
  pc?: Rec
}
const make = (o: Opts = {}) => {
  const features: Feature[] = o.features ?? [characterFeature, worldFeature, ...(o.noCyber ? [] : [cyberwareFeature]), deckFeature, HELPER, TEST_COMBAT, TEST_NET_COMBAT]
  const { game } = makeGame({
    features, content: [pack(), ...(o.packs ?? [])], seed: 7,
    pc: { hp: 40, attrs: { reflex: 14, body: 12, charm: 12, resolve: 13, intellect: 12 }, skills: { firearms: 2, brawl: 1 }, ext: { bridge: PARAMS }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 20000, cash: 1000 }, inventory: structuredClone((o.bag ?? BAG) as never) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const put = (g: G, d: ReportDraft) => g.commit(d)
const flag = (g: G, key: string, value: boolean | null) => g.commit(draft([{ op: 'flag', key, value }], 'test.flag'))
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const info = (g: G) => deckOf(g.k, g.state, 'pc')
const stat = (g: G, id: string) => g.k.stats.stat(g.state, 'pc', id)
const pc = (g: G) => g.state.actors.pc!
const minutes = (g: G) => toMinutes(g.state.time)

/** 動手術裝上一件（預設在無照診所，沉溺照設計值；via: clinic 站一號）。 */
const surgery = (g: G, uid: string, via: 'clinic' | 'unlicensed' = 'unlicensed'): void => {
  stand(g, via === 'clinic' ? 'F1' : 'F2')
  put(g, cyberInstallDraft(g.k, g.state, { actor: 'pc', uid, via }))
}
/** 裝上去並等休養結束。 */
const implant = (g: G, uid: string, via: 'clinic' | 'unlicensed' = 'unlicensed', wait = 1440): void => {
  surgery(g, uid, via)
  advance(g, wait)
}
const wearM3 = (g: G, uid = 'D1') => put(g, equipDraft(g.k, g.state, 'pc', uid))
const installConstructs = (g: G, ...items: string[]) => items.forEach((i) => put(g, installDraft(g.k, g.state, 'pc', i)))

afterEach(() => { /* 每個測試自己建一局 */ })

// ---- 只裝 deck：行為和 M3 一樣 ----

describe('只裝 deck（沒有人掛 deck.source）：和 M3 一樣', () => {
  it('背包裡的甲板裝得上：數字等於資料、來源是 own；卸下之後沒有甲板；deckView 列出背包裡的甲板', () => {
    const g = make({ noCyber: true })
    expect(g.k.hooks.owners('deck.source')).toEqual([])
    expect(info(g).has).toBe(false)
    expect(deckView(g.k, g.state, 'pc').decks.map((d) => d.uid)).toEqual(['D1', 'D2', 'D3'])
    expect(equipBlock(g.k, g.state, 'pc', 'D1')).toBeNull()
    wearM3(g)
    expect(info(g)).toMatchObject({ has: true, source: 'own', deck: 'dk_ii', uid: 'D1', grade: 2, slotsTotal: 4, firewall: 12 })
    expect(stat(g, 'deck_grade')).toBe(2)
    expect(stat(g, 'ram_max')).toBe(4 + attrMod(12) + 2)
    put(g, equipDraft(g.k, g.state, 'pc', null))
    expect(info(g).has).toBe(false)
    expect(g.state.inventory.some((s) => s.data?.uid === 'D1')).toBe(true)
  })

  it('裝構裝、換成槽比較少的甲板：裝不下的退回背包；沒有甲板時裝構裝被擋', () => {
    const g = make({ noCyber: true })
    expect(installBlock(g.k, g.state, 'pc', 'cs_blade')).toBe('沒有甲板。')
    wearM3(g)
    installConstructs(g, 'cs_rifle_3', 'cs_blade', 'cs_guard_2')
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_rifle_3', 'cs_blade', 'cs_guard_2'])
    wearM3(g, 'D2')
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_rifle_3', 'cs_blade'])
    expect(g.state.inventory.some((s) => s.id === 'cs_guard_2')).toBe(true)
  })

  it('裝的是 deck 這種成品、租來的蓋過自己的；沒有人掛時沒有任何「腦部」的事', () => {
    const g = make({ noCyber: true })
    wearM3(g)
    const r = g.k.effects.resolve([{ kind: 'deck_rental', deck: 'dk_rent' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    g.commit(draft(r.changes, 'test.rent'))
    expect(info(g)).toMatchObject({ source: 'rental', deck: 'dk_rent', slotsTotal: 2 })
  })
})

// ---- 兩個都裝：甲板是腦部的義體 ----

describe('兩個都裝：背包裡的甲板不能直接裝上', () => {
  it('有人掛 deck.source（cyberware）：equipDraft 與 equipBlock 一律回那一句；deckView 不再列背包裡的甲板；沒有裝義體就沒有甲板', () => {
    const g = make()
    expect(g.k.hooks.owners('deck.source')).toEqual(['cyberware'])
    expect(equipBlock(g.k, g.state, 'pc', 'D1')).toBe('甲板是腦部的義體，要動手術才裝得上。')
    expect(equipBlock(g.k, g.state, 'pc', 'D1')).toBe(IMPLANT_ONLY)
    expect(reasonOf(() => equipDraft(g.k, g.state, 'pc', 'D1'))).toBe(IMPLANT_ONLY)
    expect(reasonOf(() => equipDraft(g.k, g.state, 'pc', null))).toBe(IMPLANT_ONLY)
    expect(deckView(g.k, g.state, 'pc').decks).toEqual([])
    expect(info(g)).toMatchObject({ has: false, source: null })
    // 舊的 ext.deck.uid 指著背包裡的甲板也沒有用（不做舊存檔搬移：使用者 2026-11-25）
    pc(g).ext.deck = { uid: 'D1', slots: [], scripts: [] }
    expect(info(g).has).toBe(false)
    expect(stat(g, 'deck_slots')).toBe(0)
  })
})

describe('經診所裝進腦部：數字等於資料、沉溺的下限、休養', () => {
  it('無照診所裝 dk_ii：腦部多一件（kind_of: deck）、背包少一疊；sink_floor 多 6、沉溺補到下限；手術費照成品的 price', () => {
    const g = make()
    stand(g, 'F2')
    const q = installQuote(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })!
    expect(q).toMatchObject({ uid: 'D1', bp: 'dk_ii', name: '夜鶯入門甲板 II', grade: 2, slot: 'brain', price: 2500, fee: 750, sink: 6, recovery_minutes: DEFAULT_CYBER_RULES.recovery_minutes.invasive })
    const before = stat(g, 'sink_floor')
    const cred = g.state.money.cred
    put(g, cyberInstallDraft(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' }))
    expect(cyberOf(g.state, 'pc')).toEqual([expect.objectContaining({ uid: 'D1', bp: 'dk_ii', kind_of: 'deck', slot: 'brain', sink: 6 })])
    expect(g.state.inventory.some((s) => s.data?.uid === 'D1')).toBe(false)
    expect(g.state.money.cred).toBe(cred - 750)
    expect(stat(g, 'sink_floor')).toBe(before + 6)
    expect(pc(g).sink).toBeGreaterThanOrEqual(6)
    expect(cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'brain')!.pieces[0]).toMatchObject({ uid: 'D1', name: '夜鶯入門甲板 II', grade: 2, deck: true, status: 'recovering' })
  })

  it('正規診所：成本照規則的 −10%（6 → 5）、費用五成；休養中 deckOf().has 是 false，好了之後是 true', () => {
    const g = make()
    stand(g, 'F1')
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'clinic' })).toMatchObject({ fee: 1250, sink: 5, registered: true })
    surgery(g, 'D1', 'clinic')
    expect(stat(g, 'sink_floor')).toBe(5)
    expect(info(g).has).toBe(false)
    expect(stat(g, 'deck_slots')).toBe(0)
    expect(stat(g, 'ram_max')).toBe(stat(make(), 'ram_max')) // 沒有甲板時只有基礎值，沒有甲板的 +2
    // 休養中，帶著的回答 ready 是 false
    expect(deckSourceOf(g.k, g.state, 'pc')).toMatchObject({ uid: 'D1', ready: false })
    advance(g, 1439)
    expect(info(g).has).toBe(false)
    advance(g, 1)
    expect(info(g)).toMatchObject({ has: true, source: 'implant', deck: 'dk_ii', uid: 'D1', name: '夜鶯入門甲板 II', grade: 2, slotsTotal: 4, firewall: 12 })
    expect(deckSourceOf(g.k, g.state, 'pc')).toMatchObject({ ready: true })
  })

  it('衍生數值都經 rawDeck：和 M3 的同一副甲板逐項相等（deck_grade、deck_slots、deck_firewall、deck_cooling、ram_max、ram_regen、net_load_decay、net_guard）', () => {
    const a = make()
    implant(a, 'D1')
    const b = make({ noCyber: true })
    wearM3(b)
    installConstructs(a, 'cs_guard_2')
    installConstructs(b, 'cs_guard_2')
    const ids = ['deck_grade', 'deck_slots', 'deck_firewall', 'deck_cooling', 'ram_max', 'ram_regen', 'net_load_decay', 'net_guard', 'deck_slots_reserved']
    for (const id of ids) expect(stat(a, id), id).toBe(stat(b, id))
    expect([stat(a, 'deck_grade'), stat(a, 'deck_slots'), stat(a, 'deck_firewall'), stat(a, 'deck_cooling')]).toEqual([2, 4, 12, 1])
    expect(stat(a, 'ram_max')).toBe(4 + attrMod(12) + 2)
    expect(stat(a, 'ram_regen')).toBe(2 + 1)
    expect(stat(a, 'net_load_decay')).toBe(1)
    expect(stat(a, 'net_guard')).toBe(2)
    expect(info(a)).toMatchObject({ has: true, used: 1, free: 3, capacity: 4 })
  })

  it('內容種類 deck 的 sink_cost 與 invasiveness：寫了照寫（3、輕量休養 240 分鐘）；規則表 deck_sink_default 可以被資料蓋掉', () => {
    const g = make()
    stand(g, 'F2')
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'D3', via: 'unlicensed' })).toMatchObject({ sink: 3, recovery_minutes: 240, fee: 300 })
    const h = make({ packs: [{ id: 'r', content: { cyber_rule: [{ id: 'default', deck_sink_default: 9 }] } } as unknown as ContentPack] })
    stand(h, 'F2')
    expect(installQuote(h.k, h.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })!.sink).toBe(9)
    expect(installQuote(h.k, h.state, { actor: 'pc', uid: 'D3', via: 'unlicensed' })!.sink).toBe(3)
    const bad = h.k.content.validate('cyber_rule', [{ id: 'default', deck_sink_default: -1 }])
    expect(bad.join()).toContain('deck_sink_default')
  })

  it('deck 的格式多兩欄：sink_cost、invasiveness 寫壞擋得下', () => {
    const g = make()
    const bad = (e: Rec) => g.k.content.validate('deck', [e])
    expect(bad(deck('ok', { sink_cost: 8, invasiveness: 'heavy' }))).toEqual([])
    expect(bad(deck('a', { sink_cost: -1 })).join()).toContain('sink_cost')
    expect(bad(deck('b', { sink_cost: 1.5 })).join()).toContain('sink_cost')
    expect(bad(deck('c', { invasiveness: 'deep' })).join()).toContain('invasiveness')
  })
})

describe('設計圖組的甲板（設計圖有 deck 欄位）', () => {
  it('槽數、防火牆、RAM、散熱是設計圖的 deck 加上零件 stats 的合計；等級是設計圖的等級', () => {
    const g = make()
    implant(g, 'B1')
    // slots 3 + 1、firewall 10 + 3、ram.max 1 + 1、ram.regen 0 + 1、cooling 1 + 1
    expect(deckSourceOf(g.k, g.state, 'pc')).toEqual({ uid: 'B1', id: 'bp_deck', name: '訂製甲板', grade: 3, slots: 4, firewall: 13, ram: { max: 2, regen: 1 }, cooling: 2, ready: true })
    expect(info(g)).toMatchObject({ has: true, source: 'implant', deck: 'bp_deck', name: '訂製甲板', grade: 3, slotsTotal: 4, firewall: 13 })
    expect(stat(g, 'ram_max')).toBe(4 + attrMod(12) + 2)
    expect(stat(g, 'ram_regen')).toBe(2 + 1)
    expect(stat(g, 'deck_cooling')).toBe(2)
    expect(stat(g, 'net_load_decay')).toBe(2)
    // 沉溺成本：設計圖 sink_cost 7（零件沒有 sink）
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ kind_of: 'blueprint', sink: 7 })
  })

  it('沒有裝零件的那一件只有設計圖的數字', () => {
    const g = make()
    implant(g, 'B2')
    expect(deckSourceOf(g.k, g.state, 'pc')).toEqual({ uid: 'B2', id: 'bp_deck', name: '訂製甲板', grade: 3, slots: 3, firewall: 10, ram: { max: 1 }, cooling: 1, ready: true })
  })
})

describe('腦裡只有一副甲板；拆甲板', () => {
  it('腦裡已經有一副甲板時，再裝成品甲板或設計圖組的都被擋；別的腦部義體照裝', () => {
    const g = make()
    implant(g, 'D1')
    stand(g, 'F2')
    const why = '腦裡已經有一副甲板，要先拆掉。'
    expect(DECK_FULL).toBe(why)
    expect(cyberInstallBlock(g.k, g.state, { actor: 'pc', uid: 'D2', via: 'unlicensed' })).toBe(why)
    expect(cyberInstallBlock(g.k, g.state, { actor: 'pc', uid: 'B1', via: 'unlicensed' })).toBe(why)
    expect(reasonOf(() => cyberInstallDraft(g.k, g.state, { actor: 'pc', uid: 'D2', via: 'unlicensed' }))).toBe(why)
    expect(cyberInstallBlock(g.k, g.state, { actor: 'pc', uid: 'C1', via: 'unlicensed' })).toBeNull()
    expect(brainDeck(g.k, g.state, 'pc')?.uid).toBe('D1')
    // 反過來：先裝了設計圖組的，成品甲板也裝不上
    const h = make()
    implant(h, 'B1')
    stand(h, 'F2')
    expect(cyberInstallBlock(h.k, h.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })).toBe(why)
  })

  it('沒有橋裝不上甲板（和別的義體一樣）', () => {
    const g = make({ pc: { ext: { bridge: null } } })
    stand(g, 'F2')
    expect(cyberInstallBlock(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })).toBe('這件義體要接在橋上，你還沒有橋。')
  })

  it('拆下來：成品甲板整副回到背包（只帶編號，M3 的樣子）；費用是安裝費的一半；槽裡的構裝還記著，再裝一副就回來', () => {
    const g = make()
    implant(g, 'D1')
    installConstructs(g, 'cs_rifle_3', 'cs_guard_2')
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_rifle_3', 'cs_guard_2'])
    stand(g, 'F2')
    expect(removeQuote(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })).toMatchObject({ bp: 'dk_ii', name: '夜鶯入門甲板 II', fee: 375, vanishes: false })
    const cred = g.state.money.cred
    put(g, cyberRemoveDraft(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' }))
    expect(g.state.money.cred).toBe(cred - 375)
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(g.state.inventory.find((s) => s.data?.uid === 'D1')).toEqual({ id: 'dk_ii', qty: 1, data: { uid: 'D1' } })
    expect(stat(g, 'sink_floor')).toBe(0)
    // 沒有甲板：deckOf 讀成沒有、全部不生效；記著的構裝還在 ext.deck.slots
    expect(info(g)).toMatchObject({ has: false, equipped: [], inactive: ['cs_rifle_3', 'cs_guard_2'] })
    expect((pc(g).ext.deck as Rec).slots).toEqual(['cs_rifle_3', 'cs_guard_2'])
    // 再裝一副（另一副也行）：構裝回來
    implant(g, 'D1')
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_rifle_3', 'cs_guard_2'])
    // 背包裡的甲板在腦裡沒有甲板時也不能直接裝
    expect(equipBlock(g.k, g.state, 'pc', 'D2')).toBe(IMPLANT_ONLY)
  })

  it('設計圖組的拆下來照一般義體走（二手、零件回到背包的那一疊）', () => {
    const g = make()
    implant(g, 'B1')
    stand(g, 'F2')
    put(g, cyberRemoveDraft(g.k, g.state, { actor: 'pc', uid: 'B1', via: 'unlicensed' }))
    expect(g.state.inventory.find((s) => s.data?.uid === 'B1')).toMatchObject({ id: 'bp_deck', data: { uid: 'B1', state: 'used' } })
    expect(info(g).has).toBe(false)
  })

  it('在 netrun、face.net、dive 進行中拆甲板被擋，原因各一句；裝甲板也一樣；別的義體不受影響', () => {
    const g = make()
    implant(g, 'D1')
    stand(g, 'F2')
    for (const [kind, why] of [['netrun', '人在網內，不能拆甲板。'], ['face.net', '人在網內，不能拆甲板。'], ['dive', '潛入中，不能拆甲板。']] as const) {
      flag(g, `t.${kind}`, true)
      expect(cyberRemoveBlock(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' }), kind).toBe(why)
      expect(reasonOf(() => cyberRemoveDraft(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' }))).toBe(why)
      flag(g, `t.${kind}`, null)
    }
    expect(cyberRemoveBlock(g.k, g.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })).toBeNull()
    // 沒有裝甲板的人在網內裝甲板：也擋
    const h = make()
    stand(h, 'F2')
    flag(h, 't.netrun', true)
    expect(cyberInstallBlock(h.k, h.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })).toBe('人在網內，不能換甲板。')
    flag(h, 't.netrun', null)
    expect(cyberInstallBlock(h.k, h.state, { actor: 'pc', uid: 'D1', via: 'unlicensed' })).toBeNull()
  })
})

describe('租來的甲板蓋過腦裡的', () => {
  it('租來的甲板用它的數字；收回之後回到腦裡的；腦裡還在休養時租的也照樣有', () => {
    const g = make()
    surgery(g, 'D1')
    const rent = (deckId: string | null) => {
      const r = g.k.effects.resolve([{ kind: 'deck_rental', deck: deckId }], effectCtx(g.k, g.state, { source: 'builtin' }))
      expect(r.errors).toEqual([])
      if (r.changes.length) g.commit(draft(r.changes, 'test.rent'))
    }
    // 腦裡還在休養：沒有甲板；租一副就有
    expect(info(g).has).toBe(false)
    rent('dk_rent')
    expect(info(g)).toMatchObject({ has: true, source: 'rental', deck: 'dk_rent', grade: 1, slotsTotal: 2, firewall: 9 })
    advance(g, 1440)
    expect(info(g)).toMatchObject({ source: 'rental', deck: 'dk_rent' })
    expect(stat(g, 'ram_max')).toBe(4 + attrMod(12) + 1)
    rent(null)
    expect(info(g)).toMatchObject({ has: true, source: 'implant', deck: 'dk_ii', grade: 2, slotsTotal: 4 })
  })
})

describe('網內的事：進內海戰鬥、unit.ext.deck', () => {
  const netBattle = (g: G) => g.startBattle({ ...BATTLE_SETUPS.net(), allies: [{ from: 'actor', id: 'pc' }] } as never)
  const meatBattle = (g: G) => g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] } as never)

  it('武器構裝照樣帶進內海戰鬥、unit.ext.deck 照樣有、RAM 的池是甲板給的；和 M3 的同一副甲板一模一樣', () => {
    const a = make()
    implant(a, 'D1')
    installConstructs(a, 'cs_rifle_3', 'cs_blade', 'cs_guard_2')
    netBattle(a)
    const u = a.battle!.units.a1!
    expect(u.weapons.map((w) => w.id)).toEqual(['cs_rifle_3', 'cs_blade'])
    expect(u.ext.deck).toEqual({ grade: 2, firewall: 12, slots: [], constructs: [{ id: 'cs_rifle_3', class: 'weapon', grade: 2 }, { id: 'cs_blade', class: 'weapon', grade: 1 }, { id: 'cs_guard_2', class: 'defense', grade: 1 }] })
    expect(u.pools.ram?.max).toBe(4 + attrMod(12) + 2)
    const b = make({ noCyber: true })
    wearM3(b)
    installConstructs(b, 'cs_rifle_3', 'cs_blade', 'cs_guard_2')
    netBattle(b)
    const m3 = b.battle!.units.a1!
    expect(u.ext.deck).toEqual(m3.ext.deck)
    expect(u.weapons).toEqual(m3.weapons)
    expect(u.pools.ram).toEqual(m3.pools.ram)
    expect(u.evade).toBe(m3.evade)
  })

  it('休養中進內海戰鬥：沒有 RAM、沒有武器、沒有 unit.ext.deck；現實的戰鬥也沒有 RAM', () => {
    const g = make()
    surgery(g, 'D1')
    netBattle(g)
    const u = g.battle!.units.a1!
    expect(u.pools.ram).toBeUndefined()
    expect(u.weapons.find((w) => w.id === 'cs_rifle_3')).toBeUndefined()
    expect(u.ext.deck).toBeUndefined()
  })

  it('和 hackFeature 一起裝：現實戰鬥主角有 RAM、圓環上有那支快駭程式；沒裝進槽的人沒有', () => {
    const FEATS = [characterFeature, worldFeature, cyberwareFeature, deckFeature, hackFeature, HELPER, TEST_COMBAT, TEST_NET_COMBAT]
    const g = make({ features: FEATS, packs: [HACK_PACK] })
    flag(g, 't.hacker', true)
    implant(g, 'D1')
    installConstructs(g, 'qh_noise')
    meatBattle(g)
    const u = g.battle!.units.a1!
    expect(u.tags).toContain('quickhack')
    expect(u.pools.ram?.max).toBe(4 + attrMod(12) + 2)
    expect(u.ext.deck).toMatchObject({ grade: 2, firewall: 12, slots: ['qh_noise'] })
    const def = g.k.battle.getAction('hack.qh_noise')!
    expect(def.has?.({ k: g.k, state: g.state, battle: g.battle! } as never, u)).toBe(true)
  })
})

describe('資料壞掉：deck.source 的回答不可信', () => {
  it('腦裡的甲板內容不存在了（換了內容包）：當成沒有甲板，不丟錯；拆得掉（回到背包）', () => {
    const g = make()
    implant(g, 'D1')
    pc(g).ext.cyber = { pieces: [{ ...cyberOf(g.state, 'pc')[0]!, bp: 'dk_gone' }] }
    expect(deckSourceOf(g.k, g.state, 'pc')).toBeUndefined()
    expect(info(g).has).toBe(false)
    expect(stat(g, 'deck_slots')).toBe(0)
  })

  it('被鎖或壞掉（off）的甲板不回答；休養好了而且沒有 off 才回答', () => {
    const g = make()
    implant(g, 'D1')
    const piece = cyberOf(g.state, 'pc')[0]!
    pc(g).ext.cyber = { pieces: [{ ...piece, off: { why: 'lock' } }] }
    expect(deckSourceOf(g.k, g.state, 'pc')).toBeUndefined()
    expect(info(g).has).toBe(false)
    pc(g).ext.cyber = { pieces: [piece] }
    expect(info(g).has).toBe(true)
    // 沒有 off 的第一件才算：只有一副甲板的人不會被別的義體擋住
    expect(minutes(g)).toBeGreaterThan(piece.at)
  })
})
