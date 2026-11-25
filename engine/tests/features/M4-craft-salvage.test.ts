// 驗收測試：dev/work/M4-craft-salvage.md（cpp-feature）。規格：CRAFTING 第 10.1、10.3、10.4 節與第 11 節第一條；ENEMIES 第 7 節（掉落）；LIFE 第 9 節「拆死人的、拆活人的」；
// dev/adr/0019 第四節與 P16、第十七節（內嵌的零件）；dev/work/M4-followups.md「M4-craft 回報」（精工由玩家選）。
// 內容一律用測試自帶的最小假資料：沿用 M4-craft 測試的設計圖與零件（手槍、義臂、獸耳），另加一把三個零件的步槍；敵人用兩筆（一個人形帶一條義臂、一台機器帶一件單一零件的義體）。
// 站上設施用真的 world；住處的條件 at_home 用替身（旗標 home_level）；條件 ability 由測試的替身註冊（沒裝就沒有解剖與工坊）；量表 hostility 是測試的假量表。
// 骰子：用 vi.spyOn(Rng.prototype, 'next') 固定每一次 next() 的值（只包住「建草稿」那一步，提交不受影響）。
//
// 數字：主角技術 14（調整值 +2）、機械 2、義體學 2、醫療 1。拆解完好的機率 ＝ 0.7 ＋ 基本功 × 0.05 ＝ 0.8（機械與義體學都是 2 級）。
// 換零件的檢定加值是 +4；手槍 II 級 DC 13，換成別牌的槍管多一個牌子 +1 → 14：骰面 10 成功、6 失敗、1 大失敗。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ContentPack, Feature, ItemStack, ReportDraft } from '../../src'
import { ActionBlocked, Rng, UNREG_STACK_ID, partOf, productOf, stackPart, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import {
  DEFAULT_CRAFT_RULES, assembleDraft, assemblyPreview, craftFeature, craftOf, craftRules, isKnown, salvageBlock, salvageDraft, salvagePreview, swapBlock, swapDraft, swapPreview,
} from '../../src/features/craft'
import { characterFeature } from '../../src/features/character'
import { gearFeature } from '../../src/features/gear'
import { tradeFeature } from '../../src/features/trade'
import { DISSECT_ACTION, DISSECT_EXT, dissectBlock, dissectDraft, dissectOf, dissectOptions, enemiesFeature } from '../../src/features/enemies'
import { lootProblems, lootRefs } from '../../src/features/enemies/loot'
import { deckFeature } from '../../src/features/deck'
import { arrive, worldFeature } from '../../src/features/world'
import { BATTLE_SETUPS, TEST_COMBAT, TEST_NET_COMBAT, makeActor, makeBattleGame, makeGame, netAvatar, observed } from '../../src/testkit'
import { raw } from '../helpers/battle'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'mechanics', name: '機械', attr: 'tech', desc: '機械。' },
  { id: 'cyberware', name: '義體學', attr: 'tech', desc: '義體學。' }, { id: 'medicine', name: '醫療', attr: 'tech', desc: '醫療。' },
]
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: ['concealable'], attr: 'reflex', skill: 'firearms' }]

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS: Rec[] = [
  part('pt_barrel', 'barrel', { price: 200, stats: { hit: 1, damage: 2 } }),
  part('pt_barrel_ka', 'barrel', { price: 200, brand: 'ka', stats: { hit: 2 } }),
  part('pt_barrel_3h', 'barrel', { price: 600, grade: 3, stats: { hit: 3, damage: 3 } }),
  part('pt_action', 'action', { price: 200, stats: { damage: 1 } }),
  part('pt_scope', 'sensor', { price: 150, stats: { hit: 1 } }),
  part('pt_plate', 'plate', { price: 150, stats: { armor: 2 } }),
  part('pt_act', 'actuator', { price: 150 }),
  part('pt_neuron', 'neuron', { price: 300 }),
  part('pt_neuron_bio', 'neuron', { price: 300, material: 'bio' }),
  part('pt_skin_bio', 'skin', { price: 200, material: 'bio' }),
  part('pt_core', 'chip', { price: 250, stats: { armor: 1 } }),
]

const bp = (id: string, over: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, brand: 'hz', grade: 2, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...over })
const BLUEPRINTS: Rec[] = [
  bp('bp_pistol', { kind: 'weapon', name: '手槍', class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_barrel', action: 'pt_action' } }),
  bp('bp_rifle', { kind: 'weapon', name: '步槍', class: 'pistol', carry: 'main', require: [{ type: 'barrel' }, { type: 'action' }, { type: 'sensor' }] }),
  bp('bp_carbine', { kind: 'weapon', name: '卡賓槍', class: 'pistol', carry: 'main', require: [{ type: 'barrel' }, { type: 'action' }], optional: [{ type: 'sensor' }] }),
  bp('bp_arm', {
    kind: 'cyberware', name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6,
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }, { type: 'skin' }],
    stock: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron', skin: 'pt_skin_bio' },
  }),
  bp('bp_core', { kind: 'cyberware', name: '備用核心', slot: 'torso', invasiveness: 'light', sink_cost: 2, grade: 1, require: [{ type: 'chip' }], stock: { chip: 'pt_core' } }),
]
const QUIRKS: Rec[] = [{ id: 'qx_loose', name: '鬆動的準星', desc: '準星有點鬆。', kind: 'flaw', pool: ['flaw'], applies: ['weapon', 'armor'], stats: { hit: -1 } }]
const FACILITIES: Rec[] = [
  { id: 'fac_shop', name: '槍店', craft: { by: 'shop' } },
  { id: 'fac_doujin', name: '同人社團', craft: { by: 'doujin' } },
  { id: 'fac_plain', name: '雜貨店' },
]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    skill: structuredClone(SKILLS), weapon_class: structuredClone(WEAPONS), special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: structuredClone(FACILITIES),
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_shops'] }],
    block: [
      { id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '槍店' }, F2: { type: 'fac_doujin', name: '社團' }, F4: { type: 'fac_plain', name: '雜貨店' } } },
    ],
    blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS), quirk: structuredClone(QUIRKS),
  }
  patch(c)
  return { id: 'salvage_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：條件 at_home（旗標 home_level 是住處的等級）。 */
const HOME: Feature = {
  id: 'home_stub',
  install(k) {
    k.conditions.register<Condition & { level_min?: number }>({
      kind: 'at_home', owner: 'home_stub', validate: () => [],
      test: (c, { state }) => typeof state.flags.home_level === 'number' && state.flags.home_level >= (c.level_min ?? 0),
    })
  },
}
/** 測試的替身：條件 ability（abilities 註冊的那個）。旗標 workshop／dissect 在，那一種日常技能就成立。沒裝就沒有。 */
const ABILITY: Feature = {
  id: 'ability_stub',
  install(k) {
    k.conditions.register<Condition & { daily?: string }>({
      kind: 'ability', owner: 'ability_stub', validate: () => [],
      test: (c, { state }) => typeof c.daily === 'string' && state.flags[c.daily] === true,
    })
  },
}
/** 測試的假量表：敵對值（security 沒裝，量表與同名的效果由它定義）。 */
const HOSTILITY: Feature = {
  id: 'hostility_stub',
  install(k) {
    k.meters.define({ kind: 'hostility', owner: 'hostility_stub', name: '敵對值', min: 0, max: 100, start: 0, keyed: 'faction' })
  },
}

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

// ===================================================================================================================
// 拆解與換零件（craft）
// ===================================================================================================================

interface Opts {
  pack?: ContentPack
  pc?: Rec
  money?: { cred: number; cash: number }
  ability?: boolean
  actors?: ReturnType<typeof makeActor>[]
}
const make = (o: Opts = {}) => {
  const features: Feature[] = [characterFeature, worldFeature, HOME, ...(o.ability ? [ABILITY] : []), gearFeature, tradeFeature, craftFeature]
  const { game } = makeGame({
    features, content: [o.pack ?? pack()], seed: 7,
    pc: { hp: 40, attrs: { tech: 14 }, skills: { firearms: 2, mechanics: 2, cyberware: 2, medicine: 1 }, ...(o.pc ?? {}) },
    ...(o.actors ? { actors: o.actors } : {}),
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 5000, cash: 500 } },
  })
  return game
}
type G = ReturnType<typeof make>

const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_shops', at)) }
const now = (g: G) => toMinutes(g.state.time)
const last = (g: G) => g.state.reports[g.state.reports.length - 1]!
const give = (g: G, id: string, qty = 1) => { g.state.inventory.push({ id, qty }) }
const count = (g: G, id: string) => g.state.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
const product = (g: G, id: string): ItemStack | undefined => g.state.inventory.find((s) => s.id === id && s.data?.uid)
const used = (g: G): ItemStack[] => g.state.inventory.filter((s) => s.data?.state === 'used')
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

/** 把每一次 next() 固定成 v（或依序給一串，最後一個一直用），只包住 fn。 */
function withDice<T>(v: number | number[], fn: () => T): T {
  const spy = vi.spyOn(Rng.prototype, 'next')
  if (Array.isArray(v)) {
    for (const x of v.slice(0, -1)) spy.mockReturnValueOnce(x)
    spy.mockReturnValue(v[v.length - 1]!)
  } else spy.mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
afterEach(() => { vi.restoreAllMocks() })

// 檢定的骰面：自然骰 = 1 + floor(next × 20)
const NAT20 = 0.99
const NAT10 = 0.45
const NAT6 = 0.25
const NAT1 = 0

/** 背包裡放一件成品（uid 預設 pr1）。 */
const giveProduct = (g: G, id: string, parts: Rec, extra: Rec = {}, uid = 'pr1') => {
  g.state.inventory.push({ id, qty: 1, data: { uid, parts, quality: 'standard', state: 'new', ...extra } })
}
const RIFLE = { barrel: 'pt_barrel', action: 'pt_action', sensor: 'pt_scope' }
const ARM = { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' }
const PISTOL = { barrel: 'pt_barrel', action: 'pt_action' }
const atHome = (g: G) => { g.state.flags.home_level = 2 }
const know = (g: G) => { g.state.ext.craft = { known: ['bp_pistol'] } }

const INLINE = {
  name: '無名的槍管', type: 'barrel', material: 'mech', brand: 'hz', grade: 2, price: 300, legal: 'free', cells: 2, stats: { hit: 3, damage: 2 }, weight: 1, size: 1, state: 'new',
  unreg: true, uid: 'u1', desc: '一根不在任何目錄上的槍管。',
}

describe('拆解：每個零件各擲一次完好', () => {
  it('完好的機率照規則表：0.7 ＋ 基本功 × 0.05，最多 0.95；預覽列出每個零件', () => {
    expect(DEFAULT_CRAFT_RULES).toMatchObject({ salvage_base: 0.7, salvage_per_skill: 0.05, salvage_max: 0.95, salvage_minutes: 60 })
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    const pv = salvagePreview(g.k, g.state, { uid: 'pr1' })
    expect(pv.problems).toEqual([])
    expect(pv).toMatchObject({ skill: 'mechanics', level: 2, minutes: 60, teaches: true, blueprint: { id: 'bp_rifle' } })
    expect(pv.parts.map((p) => [p.type, p.fate])).toEqual([['barrel', 'roll'], ['action', 'roll'], ['sensor', 'roll']])
    for (const p of pv.parts) expect(p.chance).toBeCloseTo(0.8, 9)
    // 技能 6 級：0.7 + 0.3 = 1 → 夾在 0.95
    const hi = make({ pc: { skills: { mechanics: 6 } } })
    atHome(hi)
    giveProduct(hi, 'bp_rifle', RIFLE)
    expect(salvagePreview(hi.k, hi.state, { uid: 'pr1' }).parts[0]!.chance).toBe(0.95)
    // 義體用義體學、其餘用機械
    const mix = make({ pc: { skills: { mechanics: 2, cyberware: 4 } } })
    atHome(mix)
    giveProduct(mix, 'bp_arm', ARM)
    const arm = salvagePreview(mix.k, mix.state, { uid: 'pr1' })
    expect(arm.skill).toBe('cyberware')
    expect(arm.parts.find((p) => p.type === 'plate')!.chance).toBeCloseTo(0.9, 9)
  })

  it('規則表可以蓋掉四個數字', () => {
    const g = make({ pack: pack((c) => { c.craft_rule = [{ id: 'default', salvage_base: 0.5, salvage_per_skill: 0.1, salvage_max: 0.7, salvage_minutes: 90 }] }) })
    expect(craftRules(g.k)).toMatchObject({ salvage_base: 0.5, salvage_per_skill: 0.1, salvage_max: 0.7, salvage_minutes: 90 })
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    const pv = salvagePreview(g.k, g.state, { uid: 'pr1' })
    expect(pv.minutes).toBe(90)
    expect(pv.parts[0]!.chance).toBeCloseTo(0.7, 9)
    expect(() => make({ pack: pack((c) => { c.craft_rule = [{ id: 'default', salvage_base: 2 }] }) })).toThrow()
  })

  it('一把三個零件的槍、骰子固定成全過：多三疊 used 的零件、成品沒有了、學會設計圖、時間 +60、報告寫明', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    const t0 = now(g)
    const seq0 = g.state.seq.uid
    g.commit(withDice(0, () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    const got = used(g)
    expect(got.map((s) => s.id).sort()).toEqual(['pt_action', 'pt_barrel', 'pt_scope'])
    for (const s of got) expect(s).toMatchObject({ qty: 1, data: { state: 'used' } })
    // 每一疊有自己的編號，才指得出是哪一件
    expect(new Set(got.map((s) => s.data!.uid)).size).toBe(3)
    expect(g.state.seq.uid).toBe(seq0 + 3)
    expect(product(g, 'bp_rifle')).toBeUndefined()
    expect(isKnown(g.state, 'bp_rifle')).toBe(true)
    expect(now(g) - t0).toBe(60)
    expect(last(g)).toMatchObject({ kind: 'action', action: 'craft.salvage', outcome: { result: 'all' } })
    const lines = last(g).narration!.results!
    expect(lines[0]).toContain('完好')
    expect(lines.join('')).toContain('學會了步槍')
    // 二手零件用 stackPart 讀回來是二手
    expect(stackPart(g.k.content, got.find((s) => s.id === 'pt_barrel')!)).toMatchObject({ id: 'pt_barrel', state: 'used' })
    // 和全新的分開放：全新的零件不會併進去
    give(g, 'pt_barrel')
    expect(g.state.inventory.filter((s) => s.id === 'pt_barrel')).toHaveLength(2)
  })

  it('骰子固定成一個沒過：少一疊、報廢的不回來、沒有學會設計圖；結果是 some', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    g.commit(withDice([0, 0.99, 0], () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    expect(used(g).map((s) => s.id).sort()).toEqual(['pt_barrel', 'pt_scope'])
    expect(product(g, 'bp_rifle')).toBeUndefined()
    expect(isKnown(g.state, 'bp_rifle')).toBe(false)
    expect(last(g).outcome.result).toBe('some')
    expect(last(g).narration!.results![0]).toContain('pt_action')
    expect(last(g).narration!.results!.join('')).not.toContain('學會')
  })

  it('機率的邊界：0.8 的機率，骰 0.79 過、0.81 不過；全沒過是 none、成品照樣沒有', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    g.commit(withDice([0.79, 0.81, 0.79], () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    expect(used(g).map((s) => s.id).sort()).toEqual(['pt_barrel', 'pt_scope'])
    const none = make()
    atHome(none)
    giveProduct(none, 'bp_rifle', RIFLE)
    none.commit(withDice(0.99, () => salvageDraft(none.k, none.state, { uid: 'pr1' })))
    expect(used(none)).toEqual([])
    expect(product(none, 'bp_rifle')).toBeUndefined()
    expect(last(none).outcome.result).toBe('none')
  })

  it('同樣的狀態重擲一次結果一樣（骰子從狀態導出）；擲過骰的報告多一筆 rng', () => {
    const a = make()
    const b = make()
    for (const g of [a, b]) {
      atHome(g)
      giveProduct(g, 'bp_rifle', RIFLE)
    }
    const da = salvageDraft(a.k, a.state, { uid: 'pr1' })
    const db = salvageDraft(b.k, b.state, { uid: 'pr1' })
    expect(da.changes).toEqual(db.changes)
    expect(da.changes.filter((c) => c.op === 'rng')).toEqual([{ op: 'rng', advance: 1 }])
  })

  it('帶生體零件的那一件：生體的零件一律報廢、不擲，機械的照擲；生體的拆了就死', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_arm', ARM)
    const pv = salvagePreview(g.k, g.state, { uid: 'pr1' })
    expect(pv.parts.map((p) => [p.type, p.fate, p.chance > 0])).toEqual([['plate', 'roll', true], ['actuator', 'roll', true], ['neuron', 'bio', false], ['skin', 'bio', false]])
    expect(pv.teaches).toBe(false)
    g.commit(withDice(0, () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    expect(used(g).map((s) => s.id).sort()).toEqual(['pt_act', 'pt_plate'])
    expect(count(g, 'pt_neuron_bio') + count(g, 'pt_skin_bio')).toBe(0)
    expect(isKnown(g.state, 'bp_arm')).toBe(false)
    expect(last(g).outcome.result).toBe('some')
    expect(last(g).narration!.results!.join('')).toContain('生體')
  })

  it('已經會做的設計圖不重複記；原廠組合（資料沒有 parts）用設計圖的 stock', () => {
    const g = make()
    atHome(g)
    g.state.ext.craft = { known: ['bp_pistol'] }
    giveProduct(g, 'bp_pistol', {})
    const pv = salvagePreview(g.k, g.state, { uid: 'pr1' })
    expect(pv.teaches).toBe(false)
    expect(pv.parts.map((p) => p.id)).toEqual(['pt_barrel', 'pt_action'])
    g.commit(withDice(0, () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    expect(craftOf(g.state).known).toEqual(['bp_pistol'])
    expect(used(g)).toHaveLength(2)
  })

  it('有授權鎖的被擋、穿戴中的被擋、不在有工作台的地方被擋、背包裡沒有或不是成品被擋；擋下來什麼都沒變', () => {
    const g = make()
    giveProduct(g, 'bp_rifle', RIFLE, { lock: { kind: 'subscription' } })
    atHome(g)
    expect(salvageBlock(g.k, g.state, { uid: 'pr1' })).toBe('有授權鎖的東西要先解鎖。')
    expect(reasonOf(() => salvageDraft(g.k, g.state, { uid: 'pr1' }))).toBe('有授權鎖的東西要先解鎖。')
    expect(product(g, 'bp_rifle')).toBeDefined()
    // 穿戴中
    const w = make()
    atHome(w)
    giveProduct(w, 'bp_rifle', RIFLE)
    w.state.actors.pc!.ext.gear = { worn: {}, acc: {}, carry: { main: 'pr1' } }
    expect(salvageBlock(w.k, w.state, { uid: 'pr1' })).toBe('穿戴中的東西要先脫下來。')
    // 地方：沒有住處、也不在有工作台的店面
    const nowhere = make()
    giveProduct(nowhere, 'bp_rifle', RIFLE)
    expect(salvageBlock(nowhere.k, nowhere.state, { uid: 'pr1' })).toContain('有工作台')
    nowhere.state.flags.home_level = 1
    expect(salvageBlock(nowhere.k, nowhere.state, { uid: 'pr1' })).toContain('有工作台')
    stand(nowhere, 'F1')
    expect(salvageBlock(nowhere.k, nowhere.state, { uid: 'pr1' })).toBeNull()
    // 不是成品、背包裡沒有、動手的人不對
    give(nowhere, 'pt_barrel')
    expect(salvageBlock(nowhere.k, nowhere.state, { uid: 'nope' })).toBe('背包裡沒有這一件成品。')
    nowhere.state.inventory.push({ id: 'pt_barrel', qty: 1, data: { uid: 'us9', state: 'used' } })
    expect(salvageBlock(nowhere.k, nowhere.state, { uid: 'us9' })).toBe('背包裡沒有這一件成品。')
    expect(salvageBlock(nowhere.k, nowhere.state, { uid: 'pr1', by: 'ghost' })).toContain('找不到動手的人')
    const mate = make({ actors: [makeActor({ id: 'x', name: '路人' })] })
    atHome(mate)
    giveProduct(mate, 'bp_rifle', RIFLE)
    expect(salvageBlock(mate.k, mate.state, { uid: 'pr1', by: 'x' })).toBe('動手的人要是主角或隊上的人。')
  })

  it('內嵌的零件（未登錄零件）：完好時回背包是整筆的一疊，stackPart 讀回來逐欄相同；沒過就沒有', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', { ...RIFLE, barrel: structuredClone(INLINE) })
    const pv = salvagePreview(g.k, g.state, { uid: 'pr1' })
    expect(pv.parts[0]).toMatchObject({ id: 'unreg:u1', name: '無名的槍管', unreg: true, fate: 'roll' })
    g.commit(withDice(0, () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    const stack = g.state.inventory.find((s) => s.id === UNREG_STACK_ID)!
    expect(stack).toMatchObject({ qty: 1, data: { uid: 'u1' } })
    expect(stack.data!.part).toEqual(INLINE)
    expect(stackPart(g.k.content, stack)).toEqual(partOf(g.k.content, INLINE))
    // 內嵌的零件不帶二手的標記（內容不改）
    expect(stack.data!.state).toBeUndefined()
    expect(isKnown(g.state, 'bp_rifle')).toBe(true)
    // 沒過：整筆沒有
    const lost = make()
    atHome(lost)
    giveProduct(lost, 'bp_rifle', { ...RIFLE, barrel: structuredClone(INLINE) })
    lost.commit(withDice([0.99, 0, 0], () => salvageDraft(lost.k, lost.state, { uid: 'pr1' })))
    expect(lost.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
  })

  it('拆下來的二手零件拿得去組裝：用 uid 指名；學會的設計圖也馬上能做', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    g.commit(withDice(0, () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    const uidOf = (id: string) => used(g).find((s) => s.id === id)!.data!.uid as string
    const parts = { barrel: uidOf('pt_barrel'), action: uidOf('pt_action'), sensor: uidOf('pt_scope') }
    const pv = assemblyPreview(g.k, g.state, { blueprint: 'bp_rifle', parts, maker: 'self' })
    expect(pv.problems).toEqual([])
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, { blueprint: 'bp_rifle', parts, maker: 'self' })))
    expect(product(g, 'bp_rifle')).toBeDefined()
    expect(used(g)).toEqual([])
  })

  it('存檔往返：拆完讀回來狀態相同', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_rifle', RIFLE)
    g.commit(withDice(0, () => salvageDraft(g.k, g.state, { uid: 'pr1' })))
    const again = make()
    again.load(g.save())
    expect(again.state.inventory).toEqual(g.state.inventory)
    expect(craftOf(again.state).known).toEqual(['bp_rifle'])
  })
})

describe('換零件：背包裡的成品換掉一個零件', () => {
  const swap = (_g: G, o: Rec = {}) => ({ uid: 'pr1', type: 'barrel', part: 'pt_barrel_ka', ...o })
  const setup = (o: Opts = {}) => {
    const g = make(o)
    atHome(g)
    giveProduct(g, 'bp_pistol', PISTOL)
    give(g, 'pt_barrel_ka')
    return g
  }
  const statsOf = (g: G) => productOf(g.k.content, 'bp_pistol', product(g, 'bp_pistol')!.data)!.stats

  it('預覽：換之前與換之後的數字、難度（牌子 +1）、成功率；不改狀態', () => {
    const g = setup()
    const before = structuredClone(g.state.inventory)
    const pv = swapPreview(g.k, g.state, swap(g))
    expect(pv.problems).toEqual([])
    expect(pv.old).toMatchObject({ id: 'pt_barrel' })
    expect(pv.next).toMatchObject({ id: 'pt_barrel_ka', overspec: false })
    expect(pv.before!.stats).toEqual({ hit: 1, damage: 3 })
    expect(pv.after!.stats).toEqual({ hit: 2, damage: 1 })
    expect(pv.after!.brands).toEqual(['hz', 'ka'])
    expect(pv.difficulty).toMatchObject({ base: 13, brands: 1, total: 14 })
    expect(pv.check).toMatchObject({ skill: 'mechanics', bonus: 4, dc: 14 })
    expect(pv.minutes).toBe(60)
    expect(pv.fee).toBe(0)
    expect(g.state.inventory).toEqual(before)
  })

  it('成功：productOf 的 stats 變了、舊零件在背包（二手）、新的那一疊沒了、uid 不變、時間 +60', () => {
    const g = setup()
    const t0 = now(g)
    g.commit(withDice(NAT10, () => swapDraft(g.k, g.state, swap(g))))
    expect(statsOf(g)).toEqual({ hit: 2, damage: 1 })
    const made = product(g, 'bp_pistol')!
    expect(made.data).toMatchObject({ uid: 'pr1', parts: { barrel: 'pt_barrel_ka', action: 'pt_action' }, quality: 'standard' })
    expect(count(g, 'pt_barrel_ka')).toBe(0)
    expect(used(g).map((s) => s.id)).toEqual(['pt_barrel'])
    expect(used(g)[0]!.data!.uid).toMatch(/^us/)
    expect(now(g) - t0).toBe(60)
    expect(last(g)).toMatchObject({ action: 'craft.swap', outcome: { result: 'swapped' } })
    expect(last(g).narration!.results!.join('')).toContain('換下了')
  })

  it('同樣的槽可以再換回來：換下來的二手零件用 uid 指名', () => {
    const g = setup()
    g.commit(withDice(NAT20, () => swapDraft(g.k, g.state, swap(g))))
    const oldUid = used(g)[0]!.data!.uid as string
    g.commit(withDice(NAT20, () => swapDraft(g.k, g.state, swap(g, { part: oldUid }))))
    expect(product(g, 'bp_pistol')!.data!.parts).toEqual({ barrel: 'pt_barrel', action: 'pt_action' })
    expect(used(g).map((s) => s.id)).toEqual(['pt_barrel_ka'])
  })

  it('類型不對被擋（原因是核心的 slotProblems 那一句）；沒有這個槽、背包裡沒有那個零件、不是零件也被擋；擋下來什麼都沒變', () => {
    const g = setup()
    give(g, 'pt_action')
    expect(swapBlock(g.k, g.state, swap(g, { part: 'pt_action' }))).toContain('這個槽要的是槍管，不是機構')
    expect(reasonOf(() => swapDraft(g.k, g.state, swap(g, { part: 'pt_action' })))).toContain('槍管')
    expect(swapBlock(g.k, g.state, swap(g, { type: 'blade' }))).toContain('沒有刃的槽')
    expect(swapBlock(g.k, g.state, swap(g, { part: 'pt_nope' }))).toContain('背包裡沒有可以拿來換的零件')
    give(g, 'it_junk')
    expect(swapBlock(g.k, g.state, swap(g, { part: 'it_junk' }))).toContain('不是能組裝的零件')
    expect(swapBlock(g.k, g.state, swap(g, { part: 'pr1' }))).toContain('不是能組裝的零件')
    expect(swapBlock(g.k, g.state, swap(g, { uid: 'nope' }))).toBe('背包裡沒有這一件成品。')
    expect(product(g, 'bp_pistol')!.data!.parts).toEqual(PISTOL)
    expect(count(g, 'pt_barrel_ka')).toBe(1)
  })

  it('大失敗：新零件燒掉、舊的留在原位、成品沒變；失敗：照換但多一筆瑕疵', () => {
    const g = setup()
    g.commit(withDice(NAT1, () => swapDraft(g.k, g.state, swap(g))))
    expect(count(g, 'pt_barrel_ka')).toBe(0)
    expect(used(g)).toEqual([])
    expect(product(g, 'bp_pistol')!.data).toEqual({ uid: 'pr1', parts: PISTOL, quality: 'standard', state: 'new' })
    expect(last(g)).toMatchObject({ outcome: { result: 'burned' } })

    const f = setup()
    f.commit(withDice(NAT6, () => swapDraft(f.k, f.state, swap(f))))
    const made = product(f, 'bp_pistol')!
    expect(made.data).toMatchObject({ parts: { barrel: 'pt_barrel_ka', action: 'pt_action' }, quirks: ['qx_loose'] })
    // 瑕疵（準星鬆動 hit −1）算進 stats：2 − 1
    expect(statsOf(f)).toEqual({ hit: 1, damage: 1 })
    expect(used(f).map((s) => s.id)).toEqual(['pt_barrel'])
    expect(last(f)).toMatchObject({ outcome: { result: 'flawed' } })
  })

  it('難度照換完之後的那一件：超規的零件 +3、同樣的函式（difficultyOf）算出來的和組裝一樣', () => {
    const g = setup()
    give(g, 'pt_barrel_3h')
    const pv = swapPreview(g.k, g.state, swap(g, { part: 'pt_barrel_3h' }))
    expect(pv.next!.overspec).toBe(true)
    expect(pv.difficulty).toMatchObject({ base: 13, overspec: 3, total: 16 })
    // 同樣一組零件拿去組裝預覽，難度一樣
    know(g)
    give(g, 'pt_action')
    expect(assemblyPreview(g.k, g.state, { blueprint: 'bp_pistol', parts: { barrel: 'pt_barrel_3h', action: 'pt_action' } }).difficulty!.total).toBe(pv.difficulty!.total)
    // 工坊：超規的修正減半
    const w = setup({ ability: true })
    w.state.flags.workshop = true
    give(w, 'pt_barrel_3h')
    expect(swapPreview(w.k, w.state, swap(w, { part: 'pt_barrel_3h' })).difficulty).toMatchObject({ overspec: 2, total: 15 })
    expect(swapPreview(w.k, w.state, swap(w, { part: 'pt_barrel_3h' })).check).toMatchObject({ workshop: true, bonus: 6 })
  })

  it('在空的選配槽裡多裝一個；位置超過槽的個數被擋', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_carbine', PISTOL)
    give(g, 'pt_scope')
    const pv = swapPreview(g.k, g.state, { uid: 'pr1', type: 'sensor', part: 'pt_scope' })
    expect(pv.problems).toEqual([])
    expect(pv.old).toBeNull()
    g.commit(withDice(NAT10, () => swapDraft(g.k, g.state, { uid: 'pr1', type: 'sensor', part: 'pt_scope' })))
    expect(product(g, 'bp_carbine')!.data!.parts).toEqual({ ...PISTOL, sensor: 'pt_scope' })
    expect(used(g)).toEqual([])
    give(g, 'pt_scope')
    expect(swapBlock(g.k, g.state, { uid: 'pr1', type: 'sensor', part: 'pt_scope', index: 1 })).toContain('沒有第 2 個位置')
  })

  it('原廠組合（資料沒有 parts）換一個零件：其餘的零件用 stock 補齊', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_pistol', {})
    give(g, 'pt_barrel_ka')
    g.commit(withDice(NAT10, () => swapDraft(g.k, g.state, swap(g))))
    expect(product(g, 'bp_pistol')!.data!.parts).toEqual({ barrel: 'pt_barrel_ka', action: 'pt_action' })
  })

  it('換下來的生體零件報廢（拆了就死）；換成機械的之後接面少一個', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_arm', ARM)
    give(g, 'pt_neuron')
    const pv = swapPreview(g.k, g.state, { uid: 'pr1', type: 'neuron', part: 'pt_neuron' })
    expect(pv.problems).toEqual([])
    expect(pv.before!.seams).toBe(2)
    expect(pv.after!.seams).toBe(1)
    expect(pv.check!.skill).toBe('cyberware')
    g.commit(withDice(NAT10, () => swapDraft(g.k, g.state, { uid: 'pr1', type: 'neuron', part: 'pt_neuron' })))
    expect(count(g, 'pt_neuron_bio')).toBe(0)
    expect(used(g)).toEqual([])
    expect(last(g).narration!.results!.join('')).toContain('報廢')
  })

  it('有授權鎖、穿戴中、不在有工作台的地方都被擋；動手的人不對被擋', () => {
    const locked = make()
    atHome(locked)
    giveProduct(locked, 'bp_pistol', PISTOL, { lock: { kind: 'contract' } })
    give(locked, 'pt_barrel_ka')
    expect(swapBlock(locked.k, locked.state, swap(locked))).toBe('有授權鎖的東西要先解鎖。')
    const worn = setup()
    worn.state.actors.pc!.ext.gear = { worn: {}, acc: {}, carry: { side: 'pr1' } }
    expect(swapBlock(worn.k, worn.state, swap(worn))).toBe('穿戴中的東西要先脫下來。')
    const away = setup()
    away.state.flags.home_level = 1
    expect(swapBlock(away.k, away.state, swap(away))).toContain('有工作台')
    const s = setup()
    expect(swapBlock(s.k, s.state, swap(s, { by: 'ghost' }))).toContain('找不到動手的人')
    expect(swapBlock(s.k, s.state, swap(s, { maker: 'doujin' as never }))).toBe('換零件只有自己動手或請店家。')
  })

  it('店家換：一定成功、不擲骰、工錢是設計圖等級 × 100 的一半；不做超規；不在店裡被擋', () => {
    const g = make()
    giveProduct(g, 'bp_pistol', PISTOL)
    give(g, 'pt_barrel_ka'); give(g, 'pt_barrel_3h')
    expect(swapBlock(g.k, g.state, swap(g, { maker: 'shop' }))).toBe('這裡沒有店家代工。')
    stand(g, 'F1')
    const pv = swapPreview(g.k, g.state, swap(g, { maker: 'shop' }))
    expect(pv).toMatchObject({ problems: [], fee: 100, pay: 'cred', check: null })
    // 骰面壞到不行也照換
    const cred = g.state.money.cred
    const d = withDice(NAT1, () => swapDraft(g.k, g.state, swap(g, { maker: 'shop' })))
    expect(d.changes.some((c) => c.op === 'rng')).toBe(false)
    g.commit(d)
    expect(g.state.money.cred).toBe(cred - 100)
    expect(product(g, 'bp_pistol')!.data!.parts).toMatchObject({ barrel: 'pt_barrel_ka' })
    expect(used(g).map((s) => s.id)).toEqual(['pt_barrel'])
    expect(last(g)).toMatchObject({ outcome: { result: 'swapped' } })
    // 超規不做
    expect(swapBlock(g.k, g.state, swap(g, { maker: 'shop', part: 'pt_barrel_3h' }))).toContain('不做超規')
    // 付不起
    const poor = make({ money: { cred: 50, cash: 20 } })
    giveProduct(poor, 'bp_pistol', PISTOL)
    give(poor, 'pt_barrel_ka')
    stand(poor, 'F1')
    expect(swapBlock(poor.k, poor.state, swap(poor, { maker: 'shop' }))).toContain('錢不夠')
    // 同人社團不做換零件
    stand(poor, 'F2')
    expect(swapBlock(poor.k, poor.state, swap(poor, { maker: 'shop' }))).toBe('這裡沒有店家代工。')
  })

  it('內嵌的零件：換下來整筆回背包、逐欄相同；拿背包裡一疊內嵌的換上去，成品的 parts 裡是那一整筆', () => {
    const g = make()
    atHome(g)
    giveProduct(g, 'bp_pistol', { ...PISTOL, barrel: structuredClone(INLINE) })
    give(g, 'pt_barrel_ka')
    g.commit(withDice(NAT10, () => swapDraft(g.k, g.state, swap(g))))
    const stack = g.state.inventory.find((s) => s.id === UNREG_STACK_ID)!
    expect(stack.data!.part).toEqual(INLINE)
    expect(stackPart(g.k.content, stack)).toEqual(partOf(g.k.content, INLINE))
    // 再換回去：用內嵌那一疊的 uid
    g.commit(withDice(NAT20, () => swapDraft(g.k, g.state, swap(g, { part: 'u1' }))))
    expect(product(g, 'bp_pistol')!.data!.parts).toEqual({ barrel: INLINE, action: 'pt_action' })
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
    expect(productOf(g.k.content, 'bp_pistol', product(g, 'bp_pistol')!.data)!.stats.hit).toBe(3)
  })

  it('存檔往返；擲過骰的報告多一筆 rng，重擲一次結果一樣', () => {
    const g = setup()
    const d1 = withDice(NAT10, () => swapDraft(g.k, g.state, swap(g)))
    const d2 = withDice(NAT10, () => swapDraft(g.k, g.state, swap(g)))
    expect(d1.changes).toEqual(d2.changes)
    expect(d1.changes.filter((c) => c.op === 'rng')).toEqual([{ op: 'rng', advance: 1 }])
    g.commit(d1)
    const again = make()
    again.load(g.save())
    expect(again.state.inventory).toEqual(g.state.inventory)
  })
})

describe('精工由做的人選（assembleDraft 的 polish）', () => {
  const opts = (o: Rec = {}) => ({ blueprint: 'bp_pistol', parts: PISTOL, maker: 'self' as const, ...o })
  const ready = (o: Opts = {}) => {
    const g = make(o)
    atHome(g)
    know(g)
    give(g, 'pt_barrel'); give(g, 'pt_action')
    return g
  }

  it('沒給 polish 照舊自動加在 stats 合計最高的鍵；給了就加在那一個', () => {
    const auto = ready()
    auto.commit(withDice(NAT20, () => assembleDraft(auto.k, auto.state, opts())))
    expect(product(auto, 'bp_pistol')!.data).toMatchObject({ quality: 'fine', bonus: { damage: 1 } })
    const pick = ready()
    pick.commit(withDice(NAT20, () => assembleDraft(pick.k, pick.state, opts({ polish: 'hit' }))))
    expect(product(pick, 'bp_pistol')!.data).toMatchObject({ quality: 'fine', bonus: { hit: 1 } })
    expect(productOf(pick.k.content, 'bp_pistol', product(pick, 'bp_pistol')!.data)!.stats).toEqual({ hit: 2, damage: 3 })
  })

  it('預覽列出可以選的鍵；成功但不是大成功時 polish 沒有作用；不合格的 polish 被擋', () => {
    const g = ready()
    expect(assemblyPreview(g.k, g.state, opts()).result!.polishable).toEqual(['hit', 'damage'])
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, opts({ polish: 'hit' }))))
    expect(product(g, 'bp_pistol')!.data).toMatchObject({ quality: 'standard' })
    expect(product(g, 'bp_pistol')!.data!.bonus).toBeUndefined()
    const bad = ready()
    expect(assemblyPreview(bad.k, bad.state, opts({ polish: 'armor' })).problems.join('')).toContain('沒有「armor」')
    expect(() => assembleDraft(bad.k, bad.state, opts({ polish: 'armor' }))).toThrow(ActionBlocked)
  })

  it('義體的精工是沉溺成本 −1，不能選項目；店家與同人社團做不出精工、不用選', () => {
    const g = make()
    atHome(g)
    g.state.ext.craft = { known: ['bp_core'] }
    give(g, 'pt_core')
    const cy = assemblyPreview(g.k, g.state, { blueprint: 'bp_core', parts: { chip: 'pt_core' }, maker: 'self', polish: 'armor' })
    expect(cy.problems.join('')).toContain('沉溺成本')
    expect(cy.result!.polishable).toEqual([])
    const noPolish = make()
    stand(noPolish, 'F1')
    give(noPolish, 'pt_barrel'); give(noPolish, 'pt_action')
    expect(assemblyPreview(noPolish.k, noPolish.state, { blueprint: 'bp_pistol', parts: PISTOL, maker: 'shop', polish: 'hit' }).problems.join('')).toContain('做不出精工')
  })
})

// ===================================================================================================================
// 戰後的解剖（enemies）
// ===================================================================================================================

const BATTLE_SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const foe = (id: string, rank: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, cash: false, ...more,
})
const ARM_DROP = { blueprint: 'bp_arm', parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron', skin: 'pt_skin_bio' }, chance: 1, needs: 'dissect' }
const DPACK: ContentPack = {
  id: 'dissect_test',
  content: {
    skill: BATTLE_SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'f_none', name: '無名', short: '無', class: 'street' }],
    blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS),
    enemy: [
      // 一個人形帶一條義臂（第二筆機率 0：擲不到）
      foe('en_d_human', 'elite', { loot: [ARM_DROP, { blueprint: 'bp_core', chance: 0, needs: 'dissect' }] }),
      // 一台機器帶一件單一零件的義體；沒有勢力
      foe('en_d_machine', 'minion', { kind: 'machine', faction: 'none', loot: [{ blueprint: 'bp_core', chance: 1, needs: 'dissect' }] }),
      foe('en_d_plain', 'minion', { loot: [{ blueprint: 'bp_core', chance: 1, needs: 'dissect' }, { text: '外皮' }] }),
      // 沒有義體掉落的人
      foe('en_d_none', 'minion', {}),
    ],
  },
} as unknown as ContentPack

const allies = () => BATTLE_SETUPS.encounter(1).allies
const refs = (...ids: string[]) => ids.map((id) => ({ from: 'enemy', id }))

interface Fight {
  outs?: Array<string | undefined>
  outcome?: string
  features?: Feature[]
  flags?: Rec
  taken?: number[]
}
/** 一場我方對給的敵人（現實）：照 outs 把每個敵人設成退出的方式、分出結果、結算。 */
async function fight(ids: string[], o: Fight = {}) {
  const test = makeBattleGame({
    features: o.features ?? [characterFeature, enemiesFeature, TEST_COMBAT, HOSTILITY, ABILITY], content: [DPACK], seed: 3,
    battle: { mode: 'meat', grade: 1, cover: 'medium', allies: allies(), foes: refs(...ids) as never, origin: { escapable: true, place: '測試用的倉庫' } },
  })
  const game = test.game
  const foes = Object.values(game.state.battle!.units).filter((u) => u.side === 'foe')
  foes.forEach((u, i) => {
    const out = o.outs ? o.outs[i] : 'down'
    if (out) u.out = out
    if (o.taken?.includes(i)) u.ext.enemies = { taken: true }
  })
  game.state.battle!.result = { outcome: o.outcome ?? 'win', text: '打完了。' }
  const { result, violations } = await observed(game, () => game.finishBattle())
  expect(violations).toEqual([])
  Object.assign(game.state.flags, { dissect: true }, o.flags ?? {})
  return { game, k: game.k, report: result.reports.find((r) => r.action === 'battle.end')! }
}
const dcount = (game: { state: { inventory: ItemStack[] } }, id: string) => game.state.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
const hostilityOf = (game: ReturnType<typeof makeBattleGame>['game'], faction: string) => game.k.meters.get('hostility') && (game.state.meters.hostility?.[faction] ?? 0)

describe('戰後的解剖：記下對象', () => {
  it('打贏之後 dissectOptions 列出兩個對象（人形與機器）；沒有義體掉落的人與被帶走的不列', async () => {
    const r = await fight(['en_d_human', 'en_d_machine', 'en_d_none'])
    const st = dissectOf(r.game.state)!
    expect(st.targets.map((t) => [t.name, t.human, t.faction ?? null])).toEqual([['測試en_d_human', true, 'hizakura'], ['測試en_d_machine', false, null]])
    expect(st.until).toBe(toMinutes(r.game.state.time) + 60)
    expect(st.targets[0]!.loot.map((l) => l.blueprint)).toEqual(['bp_arm', 'bp_core'])
    const opts = dissectOptions(r.k, r.game.state)
    expect(opts.map((o) => [o.key, o.human, o.sink, o.hostility])).toEqual([
      [st.targets[0]!.key, true, 1, { faction: 'hizakura', amount: 5 }],
      [st.targets[1]!.key, false, 0, null],
    ])
    expect(opts[0]!.items).toEqual([{ blueprint: 'bp_arm', name: '義臂' }, { blueprint: 'bp_core', name: '備用核心' }])
    expect(opts.every((o) => o.block === null)).toBe(true)
    // 被帶走的人不列
    const taken = await fight(['en_d_human', 'en_d_machine'], { taken: [0] })
    expect(dissectOptions(taken.k, taken.game.state).map((o) => o.name)).toEqual(['測試en_d_machine'])
  })

  it('打輸的那一場沒有對象；逃走與投降的不算；上一場的對象被新的一場蓋掉', async () => {
    const lost = await fight(['en_d_human'], { outcome: 'lose' })
    expect(dissectOf(lost.game.state)).toBeNull()
    expect(dissectOptions(lost.k, lost.game.state)).toEqual([])
    expect(lost.game.state.ext[DISSECT_EXT]).toBeUndefined()
    const left = await fight(['en_d_human', 'en_d_machine'], { outs: ['fled', 'surrendered'] })
    expect(dissectOptions(left.k, left.game.state)).toEqual([])
    const sub = await fight(['en_d_human', 'en_d_machine'], { outs: ['subdued', 'burnout'] })
    expect(dissectOptions(sub.k, sub.game.state)).toHaveLength(2)
    // 蓋掉：同一局先留下一場，再打一場沒有對象的
    const first = await fight(['en_d_human'])
    expect(first.game.state.ext[DISSECT_EXT]).toBeDefined()
    first.game.startBattle({ mode: 'meat', grade: 1, cover: 'medium', allies: allies(), foes: refs('en_d_none') as never, origin: { escapable: true } } as never)
    for (const u of Object.values(first.game.state.battle!.units)) if (u.side === 'foe') u.out = 'down'
    first.game.state.battle!.result = { outcome: 'win', text: '打完了。' }
    await first.game.finishBattle()
    expect(first.game.state.ext[DISSECT_EXT]).toBeUndefined()
  })

  it('戰鬥結束時不自動擲：義體不在這一場的報告裡、背包沒有多東西', async () => {
    const r = await fight(['en_d_human', 'en_d_machine'])
    const changes = r.report.changes as Array<{ op: string; id?: string }>
    expect(changes.filter((c) => c.op === 'item')).toEqual([])
    expect(r.game.state.inventory.some((s) => s.data?.state === 'used')).toBe(false)
  })
})

describe('戰後的解剖：動手', () => {
  it('沒有人註冊 ability 時被擋（沒有人會解剖）', async () => {
    const r = await fight(['en_d_human'], { features: [characterFeature, enemiesFeature, TEST_COMBAT, HOSTILITY] })
    const key = dissectOf(r.game.state)!.targets[0]!.key
    expect(dissectBlock(r.k, r.game.state, { target: key })).toContain('不會解剖')
    expect(() => dissectDraft(r.k, r.game.state, { target: key })).toThrow(ActionBlocked)
    expect(dissectOptions(r.k, r.game.state)[0]!.block).toContain('不會解剖')
    // 裝了條件但這個人不會：一樣被擋
    const no = await fight(['en_d_human'], { flags: { dissect: false } })
    expect(dissectBlock(no.k, no.game.state, { target: key })).toContain('不會解剖')
  })

  it('拆人形：背包多一條 used 的義臂、沉溺 +1、敵對值 +5、時間 +60；義臂是 ProductData，零件是指定的', async () => {
    const r = await fight(['en_d_human', 'en_d_machine'])
    const g = r.game
    const st = dissectOf(g.state)!
    const key = st.targets[0]!.key
    const t0 = toMinutes(g.state.time)
    const sink0 = g.state.actors.pc!.sink
    expect(dissectBlock(r.k, g.state, { target: key })).toBeNull()
    g.commit(dissectDraft(r.k, g.state, { target: key }))
    const arm = g.state.inventory.find((s) => s.id === 'bp_arm')!
    expect(arm).toMatchObject({ qty: 1, data: { state: 'used', parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron', skin: 'pt_skin_bio' } } })
    expect(arm.data!.uid).toMatch(/^pr/)
    expect(dcount(g, 'bp_core')).toBe(0)
    expect(g.state.actors.pc!.sink).toBe(sink0 + 1)
    expect(hostilityOf(g, 'hizakura')).toBe(5)
    expect(toMinutes(g.state.time) - t0).toBe(60)
    expect(last(g)).toMatchObject({ kind: 'action', action: DISSECT_ACTION, outcome: { result: 'got' } })
    expect(last(g).narration!.results![0]).toContain('義臂')
    // 拆下來的成品是真的：productOf 讀得到、拆解也讀得到
    expect(productOf(r.k.content, 'bp_arm', arm.data)!.parts).toHaveLength(4)
    expect(dissectOf(g.state)!.done).toBe(true)
  })

  it('同一場第二次被擋（換一個對象也一樣）；過了一小時被擋；選項在做過之後是空的', async () => {
    const r = await fight(['en_d_human', 'en_d_machine'])
    const [a, b] = dissectOf(r.game.state)!.targets
    r.game.commit(dissectDraft(r.k, r.game.state, { target: a!.key }))
    expect(dissectBlock(r.k, r.game.state, { target: b!.key })).toBe('這一場已經解剖過了。')
    expect(reasonOf(() => dissectDraft(r.k, r.game.state, { target: a!.key }))).toBe('這一場已經解剖過了。')
    expect(dissectOptions(r.k, r.game.state)).toEqual([])
    // 過了一小時
    const late = await fight(['en_d_human'])
    const key = dissectOf(late.game.state)!.targets[0]!.key
    late.game.commit(draft([{ op: 'time', minutes: 59 }]))
    expect(dissectBlock(late.k, late.game.state, { target: key })).toBeNull()
    late.game.commit(draft([{ op: 'time', minutes: 2 }]))
    expect(dissectBlock(late.k, late.game.state, { target: key })).toContain('過了一小時')
    expect(dissectOptions(late.k, late.game.state)).toEqual([])
    expect(dcount(late.game, 'bp_arm')).toBe(0)
  })

  it('拆機器的不加沉溺也不加敵對值；機械零件的義體照給；沒有勢力的不加', async () => {
    const r = await fight(['en_d_human', 'en_d_machine'])
    const key = dissectOf(r.game.state)!.targets[1]!.key
    const sink0 = r.game.state.actors.pc!.sink
    r.game.commit(dissectDraft(r.k, r.game.state, { target: key }))
    expect(r.game.state.actors.pc!.sink).toBe(sink0)
    expect(hostilityOf(r.game, 'hizakura')).toBe(0)
    const core = r.game.state.inventory.find((s) => s.id === 'bp_core')!
    expect(core).toMatchObject({ qty: 1, data: { state: 'used', parts: { chip: 'pt_core' } } })
    // 資料沒寫 parts：用設計圖的 stock
    expect(last(r.game).outcome.result).toBe('got')
  })

  it('沒有量表 hostility 時只加沉溺（略過敵對值）；對象不存在被擋；動手的人不在隊上被擋', async () => {
    const r = await fight(['en_d_human'], { features: [characterFeature, enemiesFeature, TEST_COMBAT, ABILITY] })
    const key = dissectOf(r.game.state)!.targets[0]!.key
    expect(dissectBlock(r.k, r.game.state, { target: 'nope' })).toBe('找不到這個對象。')
    expect(dissectBlock(r.k, r.game.state, { target: key, by: 'ghost' })).toBe('找不到動手的人。')
    const sink0 = r.game.state.actors.pc!.sink
    r.game.commit(dissectDraft(r.k, r.game.state, { target: key }))
    expect(r.game.state.actors.pc!.sink).toBe(sink0 + 1)
    expect(r.game.state.meters.hostility).toBeUndefined()
  })

  it('一件都沒擲到：結果是 nothing，但時間照過、代價照付、這一場算做過', async () => {
    const pack = structuredClone(DPACK) as unknown as { content: { enemy: Rec[] } }
    pack.content.enemy = [foe('en_d_dud', 'elite', { loot: [{ blueprint: 'bp_arm', chance: 0, needs: 'dissect' }] }), foe('en_d_plain', 'minion', {})]
    const test = makeBattleGame({
      features: [characterFeature, enemiesFeature, TEST_COMBAT, HOSTILITY, ABILITY], content: [pack as unknown as ContentPack], seed: 3,
      battle: { mode: 'meat', grade: 1, cover: 'medium', allies: allies(), foes: refs('en_d_dud') as never, origin: { escapable: true } },
    })
    const g = test.game
    for (const u of Object.values(g.state.battle!.units)) if (u.side === 'foe') u.out = 'down'
    g.state.battle!.result = { outcome: 'win', text: '打完了。' }
    await g.finishBattle()
    g.state.flags.dissect = true
    const key = dissectOf(g.state)!.targets[0]!.key
    const sink0 = g.state.actors.pc!.sink
    g.commit(dissectDraft(g.k, g.state, { target: key }))
    expect(last(g).outcome.result).toBe('nothing')
    expect(g.state.actors.pc!.sink).toBe(sink0 + 1)
    expect(dissectOf(g.state)!.done).toBe(true)
    expect(g.state.inventory.some((s) => s.data?.state === 'used')).toBe(false)
  })

  it('存檔往返：記下的對象與做過的標記讀回來一樣；壞掉的 ext 讀成沒有', async () => {
    const r = await fight(['en_d_human'])
    const key = dissectOf(r.game.state)!.targets[0]!.key
    r.game.commit(dissectDraft(r.k, r.game.state, { target: key }))
    const again = makeBattleGame({ features: [characterFeature, enemiesFeature, TEST_COMBAT, HOSTILITY, ABILITY], content: [DPACK], seed: 3 }).game
    again.load(r.game.save())
    expect(dissectOf(again.state)).toEqual(dissectOf(r.game.state))
    again.state.ext[DISSECT_EXT] = { battle: 1, until: 'x' }
    expect(dissectOf(again.state)).toBeNull()
    again.state.ext[DISSECT_EXT] = 'garbage'
    expect(dissectOptions(again.k, again.state)).toEqual([])
  })
})

describe('掉落的格式：義體的項目', () => {
  it('{ blueprint, parts?, chance, needs: dissect } 合格；needs 一定要寫；parts 要是 { 類型: id }；不寫 qty 與 top；一筆只能是一種', () => {
    expect(lootProblems({ loot: [ARM_DROP, { blueprint: 'bp_core', chance: 0.5, needs: 'dissect' }] })).toEqual([])
    expect(lootProblems({ loot: [{ blueprint: 'bp_core', chance: 1 }] }).join('')).toContain("needs: 'dissect'")
    expect(lootProblems({ loot: [{ blueprint: 'bp_core', chance: 1, needs: 'dissect', parts: { chip: 3 } }] }).join('')).toContain('parts')
    expect(lootProblems({ loot: [{ blueprint: 'bp_core', chance: 1, needs: 'dissect', qty: 2 }] }).join('')).toContain('qty')
    expect(lootProblems({ loot: [{ blueprint: 'bp_core', item: 'x', chance: 1, needs: 'dissect' }] }).join('')).toContain('只能寫')
    expect(lootProblems({ loot: [{ blueprint: '', chance: 1, needs: 'dissect' }] }).join('')).toContain('blueprint')
    expect(lootProblems({ loot: [{ blueprint: 'bp_core', chance: 2, needs: 'dissect' }] }).join('')).toContain('chance')
    expect(lootProblems({ loot: [{ item: 'x', chance: 1, parts: { a: 'b' } }] }).join('')).toContain('parts')
  })

  it('設計圖與指名的零件要查得到（引用檢查）；查不到的在載入時擋下', () => {
    expect(lootRefs({ has: () => true }, { loot: [ARM_DROP] })).toEqual([['blueprint', 'bp_arm'], ['part', 'pt_plate'], ['part', 'pt_act'], ['part', 'pt_neuron'], ['part', 'pt_skin_bio']])
    const bad = structuredClone(DPACK) as unknown as { content: { enemy: Rec[] } }
    bad.content.enemy = [foe('en_d_bad', 'minion', { loot: [{ blueprint: 'bp_nope', chance: 1, needs: 'dissect' }] })]
    expect(() => makeBattleGame({ features: [enemiesFeature, TEST_COMBAT], content: [bad as unknown as ContentPack], battle: { mode: 'meat', grade: 1, cover: 'medium', allies: allies(), foes: refs('en_d_bad') as never } })).toThrow('bp_nope')
  })
})

describe('內海那一邊不動：兩邊的 needs: dissect 不會互相誤觸', () => {
  const SKILLS_NET = ['firearms', 'brawl', 'composure', 'interface', 'sync'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
  const NET_PACK = {
    id: 'lace_dissect',
    content: {
      skill: SKILLS_NET, weapon_class: [...structuredClone(WEAPONS), { id: 'smg', name: '衝鋒槍', dice: 3, type: 'physical', range: [2, 5], mag: 3, cover_mult: 0.5, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }],
      battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' })),
      faction: [{ id: 'f_c', name: '丙企業', short: '丙', class: 'corp' }],
      item: [{ id: 'it_cred', name: '員工憑證', desc: '憑證。', category: 'misc', grade: 1, size: 1, legal: 'free' }],
      construct: [{ id: 'cs_w1', class: 'weapon', name: 'cs_w1', grade: 1, legal: 'free', archetype: 'smg', type: 'neural', ram: 1 }],
      net_enemy_rule: [{ id: 'default', credential_item: 'it_cred' }],
      blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS),
      enemy: [{
        id: 'en_n', name: '測試蕾絲', desc: '測試用的網內敵人。', faction: 'f_c', rank: 'minion', grades: [1, 5], kind: 'lace', color: 'pink',
        position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, constructs: [{ id: 'lt', class: 'smg', type: 'neural', ram: 1 }],
        loot: [{ construct: 'cs_w1', chance: 1, needs: 'dissect' }, { blueprint: 'bp_core', chance: 1, needs: 'dissect' }],
      }],
    },
  } as unknown as ContentPack

  it('內海打贏照舊自動擲（構裝掉下來）；義體的項目不擲、也不記進解剖的狀態；現實留下來的解剖對象不被動到', async () => {
    const setup = { mode: 'net', grade: 3, cover: 'medium', allies: [0, 1, 2, 3].map((i) => raw(netAvatar(i, 3 as never, { tags: ['netrunner', ...(i === 1 ? ['dissect'] : [])] }))), foes: [{ from: 'enemy', id: 'en_n' }], origin: { escapable: true, place: '測試用的子網' } }
    const test = makeBattleGame({ features: [characterFeature, enemiesFeature, deckFeature, TEST_NET_COMBAT, HOSTILITY, ABILITY], content: [NET_PACK], seed: 5, battle: setup as never })
    const game = test.game
    const leftover = { battle: 'b_old', until: toMinutes(game.state.time) + 30, targets: [{ key: 'f1', name: '留下來的人', human: true, loot: [{ blueprint: 'bp_core', chance: 1, needs: 'dissect' }] }] }
    game.state.ext[DISSECT_EXT] = structuredClone(leftover)
    for (const u of Object.values(game.state.battle!.units)) if (u.side === 'foe') u.out = 'down'
    game.state.battle!.result = { outcome: 'win', text: '打完了。' }
    const { result, violations } = await observed(game, () => game.finishBattle())
    expect(violations).toEqual([])
    const changes = result.reports.find((r) => r.action === 'battle.end')!.changes as Array<{ op: string; id?: string }>
    expect(changes.filter((c) => c.op === 'item').map((c) => c.id)).toEqual(['cs_w1'])
    expect(game.state.ext[DISSECT_EXT]).toEqual(leftover)
    expect(game.state.inventory.some((s) => s.id === 'bp_core')).toBe(false)
  })
})
