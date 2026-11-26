// 驗收測試：dev/work/M4-creation-body.md（cpp-feature）。建角第 6、8、9 步的規則搬進引擎：掛點 creation.step、義體點數與裝備點數從選的東西算、沒有橋的建角、出身白給的、
// creationSummary（含 owned）、建角之後技能自動裝進橋。
// 規格：CHARACTER 第 1 節、2.1 節、5.4 節、5.6 節；CYBERWARE 7.5 節；LEWD_SYSTEM 第 1 節最後一條；SKILLS 1.3 節；dev/adr/0019 第十一節與 P52～P55。
// 內容一律用測試自帶的最小假資料：兩座橋（一座 creation_points: 3、一座沒寫、成品價 1,200）、一隻義眼、一條義臂、三個技能（一個有前置）、一把槍、一件防彈衣、一副甲板、兩個構裝。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Game } from '../../src'
import { ContentError, createKernel } from '../../src'
import { abilitiesFeature, abilitiesOf, capacityOf } from '../../src/features/abilities'
import { characterFeature } from '../../src/features/character'
import type { CreationDraft } from '../../src/features/creation'
import { buildCreationReport, creationBlocks, creationCatalog, creationFeature, creationLimits, creationLook, creationSummary, cyberStepBlock, gearStepBlock, startMoney, suggestedKit } from '../../src/features/creation'
import { bridgeCapacityOf, cyberOf, cyberwareFeature, hasBridge } from '../../src/features/cyberware'
import { deckFeature, deckOf } from '../../src/features/deck'
import { gearFeature } from '../../src/features/gear'
import { lewdFeature } from '../../src/features/lewd'
import { commitViolations, makeGame } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

type Rec = Record<string, any>

// ---- 假資料 ----

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 1, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS = [
  part('pt_chip52', 'chip', { price: 1000, bridge: { capacity: 52 } }),
  part('pt_chip40', 'chip', { price: 600, bridge: { capacity: 40 } }),
  part('pt_neuron', 'neuron', { price: 300 }),
  part('pt_neuron_s', 'neuron', { price: 200 }),
  part('pt_sw_even', 'software', { price: 200, bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
  part('pt_eye', 'sensor', { price: 400 }),
  part('pt_arm', 'actuator', { price: 600 }),
  part('pt_board', 'board', { price: 1000 }),
  part('pt_barrel', 'barrel', { price: 100 }), part('pt_action', 'action', { price: 100 }),
  part('pt_barrel2', 'barrel', { price: 800, grade: 2 }), part('pt_action2', 'action', { price: 800, grade: 2 }),
  part('pt_barrel3', 'barrel', { price: 800, grade: 3 }), part('pt_action3', 'action', { price: 800, grade: 3 }),
  part('pt_fiber', 'fiber', { price: 400, stats: { armor: 1 } }), part('pt_plate', 'plate', { price: 400, stats: { armor: 2 } }),
]
const bp = (id: string, over: Rec = {}): Rec => ({ id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 1, legal: 'register', price: 900, require: [], optional: [], ...over })
const BRIDGE_REQ = [{ type: 'chip' }, { type: 'neuron' }, { type: 'software' }]
const BLUEPRINTS = [
  // 3 點的橋（寫了 creation_points）；成品價 1,800
  bp('bp_bridge_a', { name: '入門橋甲', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, require: BRIDGE_REQ, creation_points: 3, stock: { chip: 'pt_chip52', neuron: 'pt_neuron', software: 'pt_sw_even' } }),
  // 沒寫點數的橋：成品價 1,200 → 1,200 × 1.5 ÷ 500 = 3.6 進位 4 點；容量 40（四類各 10）
  bp('bp_bridge_b', { name: '入門橋乙', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, require: BRIDGE_REQ, stock: { chip: 'pt_chip40', neuron: 'pt_neuron_s', software: 'pt_sw_even' } }),
  // 企業限定的橋
  bp('bp_bridge_corp', { name: '企業橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 5, bridge: { tuning_slots: 2 }, require: BRIDGE_REQ, creation_points: 2, available: { origins: ['corp'], faction: 'hz' }, stock: { chip: 'pt_chip52', neuron: 'pt_neuron', software: 'pt_sw_even' } }),
  // 義眼：成品價 480 → 720 ÷ 500 = 1.44 進位 2 點；要橋
  bp('bp_eye', { name: '義眼', slot: 'eye', invasiveness: 'light', sink_cost: 3, require: [{ type: 'sensor' }], stock: { sensor: 'pt_eye' }, look: { at: '左眼' } }),
  // 獸耳（獸化零件）：看得見的部位在頭側，生體派；機械派的另外一件
  bp('bp_ears', { name: '獸耳', slot: 'eye', invasiveness: 'light', sink_cost: 2, creation_points: 1, require: [{ type: 'sensor' }], stock: { sensor: 'pt_eye' }, look: { at: '頭側', beast: { school: 'bio', part: 'ears' } } }),
  bp('bp_tail_mech', { name: '機械尾', brand: '織女', slot: 'leg', invasiveness: 'light', sink_cost: 2, creation_points: 1, needs_bridge: false, require: [{ type: 'actuator' }], stock: { actuator: 'pt_arm' }, look: { at: '尾椎', line: '尾根有一圈金屬的接縫', beast: { school: 'mech', part: 'tail' } } }),
  // 義臂：4 點、不用橋；一邊兩槽
  bp('bp_arm', { name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, needs_bridge: false, creation_points: 4, require: [{ type: 'actuator' }], stock: { actuator: 'pt_arm' } }),
  // 甲板（設計圖帶 deck 欄位）：成品價 1,200 → 裝備點數 5；腦部
  bp('bp_deck', { name: '入門甲板', slot: 'brain', invasiveness: 'invasive', sink_cost: 5, deck: { slots: 3, firewall: 10 }, require: [{ type: 'board' }], stock: { board: 'pt_board' }, creation_points: 9 }),
  bp('bp_junk', { name: '缺零件的義體', slot: 'eye', invasiveness: 'light', sink_cost: 1, require: [{ type: 'sensor' }] }),
  // 武器與護甲
  bp('bp_pistol', { kind: 'weapon', name: '手槍', class: 'pistol', carry: 'side', size: 1, weight: 1, require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_barrel', action: 'pt_action' } }),
  bp('bp_rifle2', { kind: 'weapon', name: '步槍', grade: 2, class: 'pistol', carry: 'main', size: 2, weight: 3, require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_barrel2', action: 'pt_action2' } }),
  bp('bp_pistol3', { kind: 'weapon', name: '軍用手槍', grade: 3, class: 'pistol', carry: 'side', size: 1, weight: 1, require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_barrel3', action: 'pt_action3' } }),
  bp('bp_vest', { kind: 'armor', name: '防彈衣', armor: 1, covers: ['armor'], weight_class: 'medium', size: 2, weight: 2, require: [{ type: 'fiber' }, { type: 'plate' }], stock: { fiber: 'pt_fiber', plate: 'pt_plate' } }),
]
const ITEMS = [
  { id: 'it_gel', name: '急救凝膠', desc: '一份急救凝膠。', category: 'consumable', grade: 1, size: 0, legal: 'free', price: 250 },
  { id: 'it_ammo', name: '彈匣', desc: '一個彈匣。', category: 'ammo', grade: 1, size: 0, legal: 'register', price: 100 },
  { id: 'it_stim', name: '興奮劑', desc: '一劑藥。', category: 'drug', grade: 1, size: 0, legal: 'permit', price: 250 },
  { id: 'it_toy', name: '成人玩具', desc: '一件成人道具。', category: 'tool', adult: true, grade: 1, size: 1, legal: 'free', price: 250 },
  { id: 'it_cargo', name: '貨箱', desc: '一個貨箱。', category: 'cargo', grade: 1, size: 3, legal: 'free', price: 250 },
  { id: 'it_corp_suit', name: '企業套裝', desc: '一套企業套裝。', category: 'clothing', grade: 2, size: 2, legal: 'free', price: 750, available: { origins: ['corp'], faction: 'hz' } },
  { id: 'it_coat', name: '舊外套', desc: '一件舊外套。', category: 'clothing', grade: 1, size: 2, legal: 'free', price: 0, style: { tag: '荒地', value: 1 } },
  { id: 'it_jacket', name: '街頭夾克', desc: '一件夾克。', category: 'clothing', grade: 1, size: 2, legal: 'free', price: 250, style: { tag: '街頭', value: 1 } },
  { id: 'it_idol', name: '打歌服', desc: '一套打歌服。', category: 'clothing', grade: 1, size: 2, legal: 'free', price: 250, style: { tag: '偶像', value: 2 } },
  { id: 'it_hidden', name: '不上架的東西', desc: '建角不賣。', category: 'tool', grade: 1, size: 0, legal: 'free', price: 250, creation: false },
]
const CONSTRUCTS = [
  { id: 'cs_lines', class: 'tool', name: '客服專線', grade: 1, legal: 'free', ap: 1, ram: 1, price: 500 },
  { id: 'cs_cheap', class: 'defense', name: '小盾', grade: 1, legal: 'free', guard: 1, price: 200 },
  { id: 'cs_grade3', class: 'defense', name: '大盾', grade: 3, legal: 'free', guard: 3, price: 500 },
]
const sk = (id: string, name: string, kind: string, cap: number, more: Rec) => ({
  id, name, path: 'gunner', category: 'meat', tier: 1, layer: 'front', kind, cap, xp: 20, cells: 1, text: `${name}。`, net: null, opinion: null, ...more,
})
const ABILITIES = [
  sk('sk_instinct', '戰鬥直覺', 'passive', 3, { layer: 'signature', meat: { instinct: true } }),
  sk('sk_aimed', '要害射擊', 'active', 5, { after: 'sk_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { aimed: true } } }),
  sk('sk_burst', '連射控制', 'active', 5, { after: 'sk_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { hit: 1 } } }),
]

const PACK: ContentPack = {
  id: 'creation_body_test',
  content: {
    skill: [{ id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }],
    weapon_class: [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }],
    faction: [{ id: 'hz', name: '緋櫻重工', short: '緋櫻', class: 'corp' }],
    origin: [
      { id: 'corp', name: '企業', line: '企業的孩子', skill_bonus: { streetwise: 1 }, status: 'citizen', home: '企業宿舍', favor: { choose_one: ['hz'], value: 25 }, perk: 'origin_hive', roster: ['npc_ray'] },
      // 出身白給的：兩份急救凝膠、一個構裝、一把槍、一支沒人認得的
      {
        id: 'nomad', name: '車族', line: '荒地上的人', skill_bonus: { stealth: 1 }, status: 'citizen', home: '車隊', favor: { choose_one: ['lonestar'], value: 25 }, perk: 'origin_oldport', roster: ['npc_ray'],
        kit_free: [{ id: 'it_gel', qty: 2 }, { id: 'cs_cheap' }, { id: 'bp_pistol' }, { id: 'it_coat' }, { id: 'no_such_thing' }],
        suggested: { bridge: 'bp_bridge_b', cyber: [{ blueprint: 'bp_eye' }, { blueprint: 'bp_arm', side: 'l' }], gear: [{ id: 'it_jacket' }, { id: 'bp_vest' }, { id: 'it_gel', qty: 3 }, { id: 'bp_rifle2' }] },
      },
    ],
    part: PARTS, blueprint: BLUEPRINTS, item: ITEMS,
  },
} as unknown as ContentPack
/** 功能才定義的內容種類（構裝、SKIN、甲板、路數與技能）：只裝 creation 的局沒有它們。 */
const FEATURE_PACK: ContentPack = {
  id: 'creation_body_feature_test',
  content: {
    construct: CONSTRUCTS,
    skin: [{ id: 'sk_plain', name: '預設化身' }],
    deck: [{ id: 'dk_small', name: '小甲板', desc: '一副小甲板。', grade: 1, slots: 2, firewall: 8, legal: 'free', price: 900, sink_cost: 3 }],
    path: [{ id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_instinct', domains: { meat: 'strong', net: 'weak', opinion: 'none' }, resonance: [] }],
    ability: ABILITIES,
  },
} as unknown as ContentPack

const ALL: Feature[] = [characterFeature, lewdFeature, abilitiesFeature, gearFeature, cyberwareFeature, deckFeature, creationFeature]

const setup = (features: Feature[] = ALL, extra: ContentPack[] = []): Game =>
  makeGame({ scenario: 'beforeCreation', features, content: [MINI_PACK, PACK, ...(features === ALL ? [FEATURE_PACK] : []), ...extra], seed: 11 }).game

const draft = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  name: '露', gender: 'female', age: 22,
  origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
  ...over,
})

const reasons = (g: Game, d: CreationDraft): Array<{ step: string; reason: string }> => creationBlocks(g.k, g.state, d)
const create = (g: Game, d: CreationDraft) => g.commit(buildCreationReport(g.k, g.state, d))
const pc = (g: Game) => g.state.actors.pc!
const caps = (g: Game) => {
  const c = bridgeCapacityOf(g.k, g.state, 'pc').split
  return [c.meat, c.net, c.social, c.media]
}

// ===================================================================================================================

describe('只裝 creation：沒有功能認得選的東西；舊的草稿行為不變', () => {
  it('draft.cyber、draft.abilities、draft.gear 有東西時，每一件都是一條「沒有功能認得這一件」', () => {
    const g = setup([characterFeature, creationFeature])
    const d = draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_eye' }], abilities: ['sk_instinct'], gear: [{ id: 'bp_pistol' }, { id: 'it_gel', qty: 2 }] })
    expect(reasons(g, d)).toEqual([
      { step: 'cyber', reason: '沒有功能認得這一件：bp_bridge_a。' },
      { step: 'abilities', reason: '沒有功能認得這一件：sk_instinct。' },
      { step: 'gear', reason: '沒有功能認得這一件：bp_pistol。' },
    ])
    const s = creationSummary(g.k, g.state, d)
    expect(s.blocks.cyber).toEqual(['沒有功能認得這一件：bp_bridge_a。', '沒有功能認得這一件：bp_eye。'])
    expect(s.blocks.gear).toEqual(['沒有功能認得這一件：bp_pistol。', '沒有功能認得這一件：it_gel。'])
    expect(() => buildCreationReport(g.k, g.state, d)).toThrow('沒有功能認得這一件：bp_bridge_a。')
  })

  it('沒給選的東西、只給 cyberSpent／gearSpent 的舊草稿：照舊（點數上限、換現金、沒有多餘的變更），其他功能都裝著也一樣', () => {
    for (const features of [[characterFeature, creationFeature], ALL]) {
      const g = setup(features)
      expect(reasons(g, draft({ cyberSpent: 10, gearSpent: 12 }))).toEqual([])
      expect(reasons(g, draft({ cyberSpent: 11 }))).toEqual([{ step: 'cyber', reason: '義體點數只有 10 點。' }])
      expect(reasons(g, draft({ gearSpent: 13 }))).toEqual([{ step: 'gear', reason: '裝備點數只有 12 點。' }])
      expect(startMoney(g.k, g.state, draft({ cyberSpent: 7, gearSpent: 11 }))).toEqual({ base: 1500, cyber: 1500, gear: 250, total: 3250 })
      const report = buildCreationReport(g.k, g.state, draft({ cyberSpent: 9 }))
      expect(report.changes.map((c) => c.op)).toEqual(['actor.add', 'pc', 'cash'])
    }
  })
})

describe('第 6 步：橋與義體的點數（P52、P53）', () => {
  it('選一座 3 點的橋加一隻義眼：義體點數是 3 加義眼算出來的（成品價 480 × 1.5 ÷ 500 進位 ＝ 2）；沒寫點數、成品價 1,200 的橋是 4 點', () => {
    const g = setup()
    const s = creationSummary(g.k, g.state, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_eye' }] }))
    expect(s.cyber).toEqual({ spent: 5, left: 5, total: 10, cash: 2500 })
    expect(s.blocks.cyber).toEqual([])
    expect(creationSummary(g.k, g.state, draft({ bridge: 'bp_bridge_b', cyber: [] })).cyber.spent).toBe(4)
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_eye' }] }))).toEqual([])
  })

  it('超過 10 點被擋，並寫出超過幾點', () => {
    const g = setup()
    // 3（橋）＋ 4 ＋ 4（兩條義臂）＋ 2（義眼）＝ 13
    const d = draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_arm', side: 'l' }, { blueprint: 'bp_arm', side: 'r' }, { blueprint: 'bp_eye' }] })
    expect(cyberStepBlock(g.k, g.state, d)).toEqual({ step: 'cyber', reason: '義體點數超過了 3 點（選了 13 點，只有 10 點）。' })
    // 剛好 10 點可以
    expect(cyberStepBlock(g.k, g.state, draft({ bridge: 'bp_bridge_b', cyber: [{ blueprint: 'bp_arm', side: 'l' }, { blueprint: 'bp_eye' }] }))).toBeNull()
    // 存檔規則可以調義體點數
    const g6 = makeGame({ scenario: 'beforeCreation', features: ALL, content: [MINI_PACK, PACK, FEATURE_PACK], patch: { rules: { startCyberPoints: 6 } as never } }).game
    expect(cyberStepBlock(g6.k, g6.state, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_eye' }, { blueprint: 'bp_arm', side: 'l' }] }))).toEqual({ step: 'cyber', reason: '義體點數超過了 3 點（選了 9 點，只有 6 點）。' })
  })

  it('一定要選橋或明寫沒有橋；橋最多一座；選了沒有橋又選橋也被擋', () => {
    const g = setup()
    expect(reasons(g, draft({ cyber: [{ blueprint: 'bp_eye' }] }))[0]).toEqual({ step: 'cyber', reason: '要選一座橋，或選「沒有橋」。' })
    expect(reasons(g, draft({ cyber: [] }))[0]).toEqual({ step: 'cyber', reason: '要選一座橋，或選「沒有橋」。' })
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_bridge_b' }] }))[0]).toEqual({ step: 'cyber', reason: '橋最多一座。' })
    expect(reasons(g, draft({ bridge: null, cyber: [{ blueprint: 'bp_bridge_b' }] }))[0]).toEqual({ step: 'cyber', reason: '選了「沒有橋」，就不能再選一座橋。' })
    expect(reasons(g, draft({ bridge: 'bp_eye' }))[0]).toEqual({ step: 'cyber', reason: '義眼不是橋。' })
  })

  it('企業限定的橋：蜂巢出身被擋；企業出身（而且選了那一家）才選得到', () => {
    const g = setup()
    expect(reasons(g, draft({ bridge: 'bp_bridge_corp', cyber: [] }))).toEqual([{ step: 'cyber', reason: '企業橋：企業出身、而且是緋櫻才選得到。' }])
    expect(reasons(g, draft({ origin: 'corp', originChoice: undefined, bridge: 'bp_bridge_corp', cyber: [] }))).toEqual([])
  })

  it('每個部位不超過槽數；arm 要給左右；缺原廠組合的設計圖不收；甲板不在這一步選', () => {
    const g = setup()
    const eyes = (n: number) => Array.from({ length: n }, () => ({ blueprint: 'bp_eye' }))
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: eyes(2) }))).toEqual([])
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: eyes(3) }))[0]!.reason).toBe('眼只有 2 槽，選了 3 件。')
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_arm' }] }))[0]!.reason).toBe('義臂要選左邊還是右邊。')
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_junk' }] }))[0]!.reason).toBe('缺零件的義體沒有完整的原廠組合，不能在建角時選。')
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_deck' }] }))[0]!.reason).toBe('入門甲板是甲板：甲板在第 9 步用裝備點數選。')
    expect(reasons(g, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'no_such_bp' }] }))[0]!.reason).toBe('沒有功能認得這一件：no_such_bp。')
  })

  it('橋的容量：照橋的零件算出來，summary 給四類', () => {
    const g = setup()
    expect(creationSummary(g.k, g.state, draft({ bridge: 'bp_bridge_a', cyber: [] })).capacity).toEqual({ meat: 13, net: 13, social: 13, media: 13 })
    expect(creationSummary(g.k, g.state, draft({ bridge: 'bp_bridge_b', cyber: [] })).capacity).toEqual({ meat: 10, net: 10, social: 10, media: 10 })
    expect(creationSummary(g.k, g.state, draft({ bridge: null, cyber: [] })).capacity).toEqual({ meat: 0, net: 0, social: 0, media: 0 })
  })
})

describe('沒有橋的建角（P53）', () => {
  it('bridge: null 過得了；選義眼（要橋）被擋、選 needs_bridge: false 的義臂可以、學技能被擋；summary 把後果寫成一則提醒', () => {
    const g = setup()
    expect(reasons(g, draft({ bridge: null, cyber: [] }))).toEqual([])
    expect(reasons(g, draft({ bridge: null, cyber: [{ blueprint: 'bp_eye' }] }))).toEqual([{ step: 'cyber', reason: '義眼要接在橋上，選了「沒有橋」就裝不了。' }])
    expect(reasons(g, draft({ bridge: null, cyber: [{ blueprint: 'bp_arm', side: 'l' }] }))).toEqual([])
    expect(reasons(g, draft({ bridge: null, cyber: [], abilities: ['sk_instinct'] }))).toEqual([{ step: 'abilities', reason: '沒有橋就裝不了技能。' }])
    const s = creationSummary(g.k, g.state, draft({ bridge: null, cyber: [] }))
    expect(s.notes.cyber).toEqual(['沒有橋：沒有感載、沒有技能、不能潛入，也不能再選要接在橋上的義體。'])
    expect(s.cyber).toMatchObject({ spent: 0, left: 10, cash: 5000 })
  })

  it('提交之後：主角的 ext.bridge 是 null、四類容量是 0、沒有橋那一件；義臂裝在身上', () => {
    const g = setup()
    create(g, draft({ bridge: null, cyber: [{ blueprint: 'bp_arm', side: 'r' }], abilities: [] }))
    expect(pc(g).ext.bridge).toBeNull()
    expect(hasBridge(g.state, 'pc')).toBe(false)
    expect(caps(g)).toEqual([0, 0, 0, 0])
    expect(cyberOf(g.state, 'pc').map((p) => [p.bp, p.slot])).toEqual([['bp_arm', 'arm_r']])
    expect(capacityOf(g.k, g.state, 'pc').meat.max).toBe(0)
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual([])
    expect(g.state.reports.map((r) => r.action)).not.toContain('ability.loadout')
  })
})

describe('提交：身上有選的義體、沉溺到下限、技能與裝備', () => {
  const FULL = (): CreationDraft => draft({
    bridge: 'bp_bridge_b',
    cyber: [{ blueprint: 'bp_eye' }, { blueprint: 'bp_arm', side: 'l' }],
    abilities: ['sk_instinct', 'sk_aimed', 'sk_burst'],
    gear: [{ id: 'bp_pistol' }, { id: 'bp_vest' }, { id: 'bp_deck' }, { id: 'cs_lines' }],
  })

  it('義體：每一件用 stock 的零件、沒有休養；沉溺等於下限（成本不打折）；橋的四類容量照零件算', () => {
    const g = setup()
    expect(reasons(g, FULL())).toEqual([])
    g.k.probe.start()
    create(g, FULL())
    const violations = commitViolations(g.k, g.k.probe.stop())
    const pieces = cyberOf(g.state, 'pc')
    expect(pieces.map((p) => [p.bp, p.slot])).toEqual([['bp_bridge_b', 'bridge'], ['bp_eye', 'eye'], ['bp_arm', 'arm_l'], ['bp_deck', 'brain']])
    expect(pieces[1]).toMatchObject({ parts: { sensor: 'pt_eye' }, sink: 3 })
    expect(pieces.every((p) => p.ready_at === undefined && p.off === undefined)).toBe(true)
    expect(pc(g).conditions.some((c) => c.id === 'recovering')).toBe(false)
    // 沉溺成本：橋 4、義眼 3、義臂 6、甲板 5（全部不打折）；沉溺等於下限
    expect(pieces.map((p) => p.sink)).toEqual([4, 3, 6, 5])
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(18)
    expect(pc(g).sink).toBe(18)
    expect(creationSummary(g.k, g.state, { ...FULL(), cyber: FULL().cyber }).sink).toBe(18)
    // 橋：晶片 40 ÷ 四類等分
    expect(caps(g)).toEqual([10, 10, 10, 10])
    expect(hasBridge(g.state, 'pc')).toBe(true)
    // 沒有 ext.bridge 的預設值被拿掉？沒有：lewd 照舊補四項參數
    expect(pc(g).ext.bridge).toMatchObject({ sensitivity: 30, tolerance: 30, craving: 30, docility: 30 })
    expect(violations).toEqual([])
  })

  it('甲板：直接裝進腦部（沉溺的下限照加），deck 讀得到它', () => {
    const g = setup()
    create(g, FULL())
    const info = deckOf(g.k, g.state, 'pc')
    expect(info).toMatchObject({ has: true, source: 'implant', slotsTotal: 3, firewall: 10 })
    expect(g.state.inventory.some((s) => s.id === 'bp_deck')).toBe(false)
  })

  it('技能：歷練點是 200 減花掉的；緊接著有一份 ability.loadout 照學的順序裝上，容量不夠的最後一個沒裝', () => {
    const g = setup()
    create(g, FULL())
    const a = abilitiesOf(g.state, 'pc')
    expect(a.learned).toEqual(['sk_instinct', 'sk_aimed', 'sk_burst'])
    expect(a.xp).toBe(140)
    expect(a.spent).toEqual({ gunner: 60 })
    // 現實只有 10 點：戰鬥直覺 3 ＋ 要害射擊 5 ＝ 8，連射控制 5 放不下
    expect(a.equipped).toEqual(['sk_instinct', 'sk_aimed'])
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 8, max: 10 })
    const reports = g.state.reports.map((r) => r.action)
    expect(reports.slice(-2)).toEqual(['creation.commit', 'ability.loadout'])
    const loadout = g.state.reports.at(-1)!
    expect(loadout.outcome.summary).toContain('容量放不下的沒有裝：連射控制')
    expect(loadout.changes.some((c) => c.op === 'time')).toBe(false)
  })

  it('技能學了但橋容量夠大時全部裝上；沒學技能（abilities: []）時歷練點還是 200、沒有 loadout', () => {
    const g = setup()
    create(g, { ...FULL(), bridge: 'bp_bridge_a' })
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['sk_instinct', 'sk_aimed', 'sk_burst'])
    const g2 = setup()
    create(g2, draft({ bridge: 'bp_bridge_a', cyber: [], abilities: [] }))
    expect(abilitiesOf(g2.state, 'pc')).toMatchObject({ xp: 200, learned: [], equipped: [] })
    expect(g2.state.reports.map((r) => r.action)).not.toContain('ability.loadout')
  })

  it('裝備：背包有槍（帶零件）、防彈衣、構裝；甲板不在背包', () => {
    const g = setup()
    create(g, FULL())
    const inv = g.state.inventory
    const gun = inv.find((s) => s.id === 'bp_pistol')!
    expect(gun.data).toMatchObject({ parts: { barrel: 'pt_barrel', action: 'pt_action' }, state: 'new' })
    expect(typeof gun.data!.uid).toBe('string')
    expect(inv.find((s) => s.id === 'bp_vest')!.data).toMatchObject({ parts: { fiber: 'pt_fiber', plate: 'pt_plate' } })
    expect(inv.find((s) => s.id === 'cs_lines')).toMatchObject({ qty: 1 })
    // 每件成品的編號不重複
    const uids = inv.flatMap((s) => (typeof s.data?.uid === 'string' ? [s.data.uid as string] : []))
    expect(new Set(uids).size).toBe(uids.length)
  })

  it('點數換現金：沒花完的義體點數每點 500、裝備點數每點 250；花完不換', () => {
    // FULL：義體 4 ＋ 2 ＋ 4 ＝ 10、裝備 1 ＋ 4 ＋ 5 ＋ 2 ＝ 12，都花完
    const full = setup()
    expect(creationSummary(full.k, full.state, FULL())).toMatchObject({ cyber: { spent: 10, left: 0, cash: 0 }, gear: { spent: 12, left: 0, cash: 0 }, money: { base: 1500, cyber: 0, gear: 0, total: 1500 } })
    create(full, FULL())
    expect(full.state.money).toEqual({ cred: 0, cash: 1500 })
    // 只選一座 3 點的橋與一把槍（1 點）：剩 7 點義體、11 點裝備
    const g = setup()
    const small = draft({ bridge: 'bp_bridge_a', cyber: [], abilities: [], gear: [{ id: 'bp_pistol' }] })
    expect(creationSummary(g.k, g.state, small)).toMatchObject({ cyber: { spent: 3, left: 7, cash: 3500 }, gear: { spent: 1, left: 11, cash: 2750 } })
    expect(startMoney(g.k, g.state, small).total).toBe(1500 + 3500 + 2750)
    create(g, small)
    expect(g.state.money).toEqual({ cred: 0, cash: 7750 })
    // 草稿只給了橋、沒給 gear：裝備的點數不算（沒給花了幾點就不換）
    const g2 = setup()
    create(g2, draft({ bridge: 'bp_bridge_a', cyber: [] }))
    expect(g2.state.money.cash).toBe(1500 + 3500)
  })

  it('creation.commit 的報告：actor.add、pc 接著是各功能的變更，最後是現金', () => {
    const g = setup()
    const ops = buildCreationReport(g.k, g.state, FULL()).changes.map((c) => c.op)
    expect(ops.slice(0, 2)).toEqual(['actor.add', 'pc'])
    expect(ops.at(-1)).toBe('cash')
    expect(ops.filter((o) => o === 'actor.ext').length).toBe(2) // abilities 與 cyber（第 6 步與第 9 步各寫一份身上的義體，合併成最後那一份）
  })
})

describe('第 8 步：技能', () => {
  it('前置沒學先學後面被擋；歷練點超過被擋；沒學過的 id 沒有功能認得；同一個技能學兩次被擋', () => {
    const g = setup()
    const base = { bridge: 'bp_bridge_a', cyber: [] }
    expect(reasons(g, draft({ ...base, abilities: ['sk_aimed', 'sk_instinct'] }))).toEqual([{ step: 'abilities', reason: '要害射擊：要先學會戰鬥直覺。' }])
    expect(reasons(g, draft({ ...base, abilities: ['sk_instinct', 'sk_aimed'] }))).toEqual([])
    expect(reasons(g, draft({ ...base, abilities: ['sk_instinct', 'sk_instinct'] }))).toEqual([{ step: 'abilities', reason: '戰鬥直覺：已經學會了。' }])
    expect(reasons(g, draft({ ...base, abilities: ['sk_nothing'] }))).toEqual([{ step: 'abilities', reason: '沒有功能認得這一件：sk_nothing。' }])
    // 歷練點是存檔規則的 startXp
    const poor = makeGame({ scenario: 'beforeCreation', features: ALL, content: [MINI_PACK, PACK, FEATURE_PACK], patch: { rules: { startXp: 30 } as never } }).game
    expect(reasons(poor, draft({ ...base, abilities: ['sk_instinct', 'sk_aimed'] }))).toEqual([{ step: 'abilities', reason: '要害射擊：歷練點不夠（要 20 點，現在 10 點）。' }])
    const s = creationSummary(g.k, g.state, draft({ ...base, abilities: ['sk_instinct', 'sk_aimed'] }))
    expect(s.xp).toEqual({ spent: 40, left: 160, total: 200 })
  })
})

describe('第 9 步：裝備點數與限制', () => {
  const base = { bridge: 'bp_bridge_a', cyber: [] as Array<{ blueprint: string }> }
  const gear = (...g: Array<{ id: string; qty?: number }>) => draft({ ...base, gear: g })

  it('點數：價錢 ÷ 250 進位、最少 1（物品、設計圖用成品價）；數量要乘；總數超過 12 被擋並寫出超過幾點', () => {
    const g = setup()
    const spent = (...x: Array<{ id: string; qty?: number }>) => creationSummary(g.k, g.state, gear(...x)).gear.spent
    expect(spent({ id: 'it_gel' })).toBe(1)
    expect(spent({ id: 'it_ammo' })).toBe(1) // 100 → 最少 1
    expect(spent({ id: 'it_coat' })).toBe(1) // 價錢 0 → 最少 1
    expect(spent({ id: 'it_gel', qty: 3 })).toBe(3)
    expect(spent({ id: 'bp_pistol' })).toBe(1) // 成品價 240 ÷ 250 進位 ＝ 1
    expect(spent({ id: 'bp_vest' })).toBe(4)
    expect(spent({ id: 'bp_rifle2' })).toBe(8)
    expect(spent({ id: 'cs_lines' })).toBe(2)
    expect(spent({ id: 'sk_plain' })).toBe(1)
    expect(spent({ id: 'dk_small' })).toBe(4) // 900 ÷ 250 進位
    // 12 點剛好可以；13 點被擋
    expect(gearStepBlock(g.k, g.state, gear({ id: 'bp_rifle2' }, { id: 'bp_vest' }))).toBeNull()
    expect(gearStepBlock(g.k, g.state, gear({ id: 'bp_rifle2' }, { id: 'bp_vest' }, { id: 'it_gel' }))).toEqual({ step: 'gear', reason: '裝備點數超過了 1 點（選了 13 點，只有 12 點）。' })
  })

  it('III 級的槍、藥、帶 adult 的物品、不在類別裡的東西被擋，原因各一句', () => {
    const g = setup()
    const why = (id: string) => gearStepBlock(g.k, g.state, gear({ id }))?.reason
    expect(why('bp_pistol3')).toBe('軍用手槍是 III 級，起始的裝備只能買 I～II 級。')
    expect(why('it_stim')).toBe('興奮劑是藥，不能用裝備點數買。')
    expect(why('it_toy')).toBe('成人玩具是成人道具，不能用裝備點數買。')
    expect(why('it_cargo')).toBe('貨箱這一類不能用裝備點數買。')
    expect(why('cs_grade3')).toBe('大盾是 III 級，起始的裝備只能買 I～II 級。')
    expect(why('bp_eye')).toBe('義眼是義體，要用義體點數在第 6 步選，不能用裝備點數買。')
    expect(why('no_such_thing')).toBe('沒有功能認得這一件：no_such_thing。')
    expect(gearStepBlock(g.k, g.state, gear({ id: 'it_gel', qty: 0 }))?.reason).toBe('急救凝膠的數量要是 1 以上的整數。')
    expect(gearStepBlock(g.k, g.state, gear({ id: 'it_gel', qty: 1.5 }))?.reason).toBe('急救凝膠的數量要是 1 以上的整數。')
  })

  it('等級上限與類別是規則（creation_rule 的 gear_grade_max、gear_kinds）', () => {
    const rules: ContentPack = { id: 'r', content: { creation_rule: [{ ...(MINI_PACK.content.creation_rule![0] as object), id: 'default', gear_grade_max: 3, gear_kinds: ['weapon', 'armor', 'consumable', 'cargo'] }] } } as unknown as ContentPack
    const g = setup(ALL, [rules])
    expect(creationLimits(g.k, g.state)).toMatchObject({ gearGradeMax: 3, gearKinds: ['weapon', 'armor', 'consumable', 'cargo'] })
    expect(gearStepBlock(g.k, g.state, gear({ id: 'bp_pistol3' }))).toBeNull()
    expect(gearStepBlock(g.k, g.state, gear({ id: 'it_cargo' }))).toBeNull()
    expect(gearStepBlock(g.k, g.state, gear({ id: 'cs_lines' }))?.reason).toBe('客服專線這一類不能用裝備點數買。')
  })

  it('出身限定：蜂巢買不到企業套裝；企業出身買得到（II 級的服裝）', () => {
    const g = setup()
    expect(gearStepBlock(g.k, g.state, gear({ id: 'it_corp_suit' }))?.reason).toBe('企業套裝：企業出身、而且是緋櫻才選得到。')
    expect(gearStepBlock(g.k, g.state, draft({ origin: 'corp', originChoice: undefined, ...base, gear: [{ id: 'it_corp_suit' }] }))).toBeNull()
  })

  it('構裝、SKIN、甲板（內容種類 deck）：要橋才裝得進腦部；沒有橋或沒選橋被擋；腦裡只能一副', () => {
    const g = setup()
    expect(gearStepBlock(g.k, g.state, gear({ id: 'dk_small' }))).toBeNull()
    expect(gearStepBlock(g.k, g.state, gear({ id: 'dk_small' }, { id: 'bp_deck' }))?.reason).toBe('腦裡只能裝一副甲板。')
    expect(gearStepBlock(g.k, g.state, gear({ id: 'dk_small', qty: 2 }))?.reason).toBe('小甲板一次只能裝一副。')
    expect(gearStepBlock(g.k, g.state, draft({ bridge: null, cyber: [], gear: [{ id: 'dk_small' }] }))?.reason).toBe('小甲板要接在橋上，選了「沒有橋」就裝不了。')
    expect(gearStepBlock(g.k, g.state, draft({ cyber: [], gear: [{ id: 'dk_small' }] }))?.reason).toBe('小甲板要接在橋上：要先在第 6 步選一座橋。')
    // 構裝與 SKIN 不要橋也買得到（沒有橋就沒有感載，之後再說）
    expect(gearStepBlock(g.k, g.state, draft({ bridge: null, cyber: [], gear: [{ id: 'cs_lines' }, { id: 'sk_plain' }] }))).toBeNull()
    // 腦部的槽：腦部義體占滿三槽就裝不下甲板（測試把腦部改成只有 1 槽）
    const one: ContentPack = { id: 'r1', content: { cyber_rule: [{ id: 'default', slots: { brain: 1 } }] } } as unknown as ContentPack
    const g1 = setup(ALL, [one])
    expect(gearStepBlock(g1.k, g1.state, gear({ id: 'dk_small' }))).toBeNull()
  })

  it('甲板（內容種類 deck）提交之後裝在腦部、成本照那一筆的 sink_cost；構裝與 SKIN 進背包', () => {
    const g = setup()
    create(g, draft({ bridge: 'bp_bridge_a', cyber: [], abilities: [], gear: [{ id: 'dk_small' }, { id: 'cs_lines' }, { id: 'sk_plain' }] }))
    expect(cyberOf(g.state, 'pc').map((p) => [p.bp, p.kind_of, p.slot, p.sink])).toEqual([['bp_bridge_a', 'blueprint', 'bridge', 4], ['dk_small', 'deck', 'brain', 3]])
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ has: true, source: 'implant', slotsTotal: 2 })
    expect(g.state.inventory.map((s) => s.id).sort()).toEqual(['cs_lines', 'sk_plain'])
    expect(pc(g).sink).toBe(7)
  })
})

describe('出身白給的（P55）與 owned', () => {
  it('kit_free 進了背包、不算點數；認不得的 id 略過；summary 的 owned 把白給的與這次選的一起列出來', () => {
    const g = setup()
    const d = draft({ origin: 'nomad', originChoice: undefined, bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_eye' }], abilities: [], gear: [{ id: 'it_ammo' }] })
    const s = creationSummary(g.k, g.state, d)
    expect(s.gear).toMatchObject({ spent: 1, left: 11 })
    expect(s.blocks.gear).toEqual([])
    expect(s.owned.map((o) => [o.id, o.category, o.from, o.qty])).toEqual([
      ['bp_bridge_a', 'cyberware', 'pick', 1], ['bp_eye', 'cyberware', 'pick', 1],
      ['it_ammo', 'ammo', 'pick', 1], ['it_gel', 'consumable', 'kit', 2], ['bp_pistol', 'weapon', 'kit', 1], ['it_coat', 'clothing', 'kit', 1],
      ['cs_cheap', 'construct', 'kit', 1],
    ])
    create(g, d)
    const inv = Object.fromEntries(g.state.inventory.map((st) => [st.id, st.qty]))
    expect(inv).toMatchObject({ it_gel: 2, cs_cheap: 1, bp_pistol: 1, it_ammo: 1, it_coat: 1 })
    expect(g.state.inventory.find((st) => st.id === 'bp_pistol')!.data).toMatchObject({ parts: { barrel: 'pt_barrel' } })
    // 白給的不算進花了幾點：12 點裡只花了 it_ammo 的 1 點，剩 11 點換現金
    expect(g.state.money.cash).toBe(1500 + 5 * 500 + 11 * 250)
  })

  it('身上已經有的：義體寫部位、武器與護甲寫穿戴的位置', () => {
    const g = setup()
    const s = creationSummary(g.k, g.state, draft({ bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_arm', side: 'l' }], gear: [{ id: 'bp_pistol' }, { id: 'bp_vest' }, { id: 'dk_small' }] }))
    const by = Object.fromEntries(s.owned.map((o) => [o.id, o]))
    expect(by.bp_arm).toMatchObject({ category: 'cyberware', slots: ['arm_l'], name: '義臂' })
    expect(by.bp_pistol).toMatchObject({ category: 'weapon', slots: ['side'], name: '手槍' })
    expect(by.bp_vest).toMatchObject({ category: 'armor', slots: ['armor'], name: '防彈衣' })
    expect(by.dk_small).toMatchObject({ category: 'deck', slots: ['brain'], name: '小甲板' })
  })
})

describe('規則的數字（creation_rule）', () => {
  it('creationLimits 多回傳新規則的數字；gear_point_cash 預設是 250（使用者 2026-11-25）', () => {
    const g = setup()
    expect(creationLimits(g.k, g.state)).toMatchObject({
      cyberPoints: 10, gearPoints: 12, cyberPointCash: 500, gearPointCash: 250,
      cyberPointPrice: 500, cyberInstallMult: 1.5, gearPointPrice: 250, gearGradeMax: 2,
    })
    expect(creationLimits(g.k, g.state).gearKinds).toEqual(['weapon', 'armor', 'clothing', 'tool', 'consumable', 'ammo', 'construct', 'skin', 'deck'])
  })

  it('cyber_point_price 與 cyber_install_mult 是規則：1,200 的橋照 ×1 ÷ 400 ＝ 3 點', () => {
    const rules: ContentPack = { id: 'r', content: { creation_rule: [{ ...(MINI_PACK.content.creation_rule![0] as object), id: 'default', cyber_point_price: 400, cyber_install_mult: 1 }] } } as unknown as ContentPack
    const g = setup(ALL, [rules])
    expect(creationSummary(g.k, g.state, draft({ bridge: 'bp_bridge_b', cyber: [] })).cyber.spent).toBe(3)
  })

  it('新欄位的格式不對在載入時擋下（核心的內容檢查 creation_rule；M4-core-gaps 第 9 項）', () => {
    for (const bad of [{ gear_point_price: 0 }, { gear_grade_max: 'II' }, { cyber_install_mult: -1 }, { gear_kinds: 'weapon' }, { gear_kinds: [1] }]) {
      const rules: ContentPack = { id: 'r', content: { creation_rule: [{ ...(MINI_PACK.content.creation_rule![0] as object), id: 'default', ...bad }] } } as unknown as ContentPack
      const k = createKernel([creationFeature])
      k.content.loadPack(MINI_PACK)
      expect(() => k.content.loadPack(rules)).toThrow(ContentError)
    }
  })
})

describe('性質：點數與現金', () => {
  it('隨機選義體與裝備：照 summary 說的花了幾點，提交之後現金＝起始的錢 ＋ 義體剩的 × 500 ＋ 裝備剩的 × 250；過不了的草稿不能提交', () => {
    const options = [{ blueprint: 'bp_eye' }, { blueprint: 'bp_arm', side: 'l' as const }, { blueprint: 'bp_arm', side: 'r' as const }, { blueprint: 'bp_eye' }]
    const gears = [{ id: 'it_gel' }, { id: 'bp_pistol' }, { id: 'bp_vest' }, { id: 'cs_lines' }, { id: 'it_ammo', qty: 2 }]
    for (let mask = 0; mask < 16; mask++) {
      for (let gm = 0; gm < 8; gm++) {
        const g = setup()
        const d = draft({
          bridge: mask % 2 === 0 ? 'bp_bridge_a' : 'bp_bridge_b',
          cyber: options.filter((_, i) => (mask >> (i % 4)) & 1),
          abilities: [],
          gear: gears.filter((_, i) => (gm >> (i % 3)) & 1),
        })
        const s = creationSummary(g.k, g.state, d)
        const ok = reasons(g, d).length === 0
        if (!ok) {
          expect(() => buildCreationReport(g.k, g.state, d)).toThrow()
          continue
        }
        create(g, d)
        expect(g.state.money.cash).toBe(1500 + s.cyber.left * 500 + s.gear.left * 250)
      }
    }
  })
})

// ===================================================================================================================
// M4 收尾修正批（使用者 2026-11-26 裁決 11）：建角的目錄、出身的建議組合、外觀的推導搬進引擎
// ===================================================================================================================

describe('建角的目錄（creationCatalog；掛點 creation.catalog）', () => {
  it('第 6 步的橋與其他義體：每一件有名字、等級、價錢、點數、部位；缺零件的、甲板不列；依等級與價錢排', () => {
    const g = setup()
    const c = creationCatalog(g.k, g.state, draft({ origin: 'nomad', originChoice: { favor: 'lonestar' } }))
    expect(c.bridges.map((r) => r.id)).toEqual(['bp_bridge_b', 'bp_bridge_corp', 'bp_bridge_a'].sort((a, b) => c.bridges.findIndex((r) => r.id === a) - c.bridges.findIndex((r) => r.id === b)))
    expect(c.bridges.find((r) => r.id === 'bp_bridge_a')).toMatchObject({ name: '入門橋甲', points: 3, category: 'cyberware', slots: ['bridge'], block: null })
    expect(c.bridges.find((r) => r.id === 'bp_bridge_b')).toMatchObject({ points: 4 })
    expect(c.cyber.map((r) => r.id)).toEqual(expect.arrayContaining(['bp_eye', 'bp_arm', 'bp_ears']))
    expect(c.cyber.map((r) => r.id)).not.toContain('bp_junk')
    expect(c.cyber.map((r) => r.id)).not.toContain('bp_deck')
    expect(c.cyber.find((r) => r.id === 'bp_eye')).toMatchObject({ points: 2, slots: ['eye'] })
    // 排序：等級再價錢
    const keys = c.cyber.map((r) => [r.grade, r.price])
    expect(keys).toEqual([...keys].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!))
  })

  it('出身限定的：這個出身買不到的 block 寫原因，買得到的是 null', () => {
    const g = setup()
    const nomad = creationCatalog(g.k, g.state, draft({ origin: 'nomad', originChoice: { favor: 'lonestar' } }))
    expect(nomad.bridges.find((r) => r.id === 'bp_bridge_corp')!.block).toBe('企業出身、而且是緋櫻才選得到。')
    const corp = creationCatalog(g.k, g.state, draft({ origin: 'corp', originChoice: { favor: 'hz' } }))
    expect(corp.bridges.find((r) => r.id === 'bp_bridge_corp')!.block).toBeNull()
  })

  it('第 9 步的裝備照四組（武器、護甲與服裝、工具與消耗品、甲板構裝與 SKIN）；藥、成人道具、creation: false、超過等級上限的不列；點數是價錢 ÷ 250 進位', () => {
    const g = setup()
    const c = creationCatalog(g.k, g.state, draft({ origin: 'nomad', originChoice: { favor: 'lonestar' } }))
    expect(c.gear.map((x) => x.group)).toEqual(['武器', '護甲與服裝', '工具與消耗品', '甲板、構裝與 SKIN'])
    const all = c.gear.flatMap((x) => x.rows)
    expect(all.map((r) => r.id)).not.toContain('it_stim')
    expect(all.map((r) => r.id)).not.toContain('it_toy')
    expect(all.map((r) => r.id)).not.toContain('it_hidden')
    expect(all.map((r) => r.id)).not.toContain('bp_pistol3')
    expect(all.map((r) => r.id)).not.toContain('cs_grade3')
    expect(all.find((r) => r.id === 'it_gel')).toMatchObject({ name: '急救凝膠', points: 1, category: 'consumable', block: null })
    expect(all.find((r) => r.id === 'bp_pistol')).toMatchObject({ category: 'weapon', slots: ['side'] })
    expect(all.find((r) => r.id === 'bp_vest')).toMatchObject({ category: 'armor', slots: ['armor'] })
    expect(all.find((r) => r.id === 'it_corp_suit')!.block).toBe('企業出身、而且是緋櫻才選得到。')
    // 甲板（內容種類 deck 的成品與設計圖帶 deck）在最後一組
    const decks = c.gear.find((x) => x.group === '甲板、構裝與 SKIN')!.rows
    expect(decks.map((r) => r.id)).toEqual(expect.arrayContaining(['dk_small']))
    expect(decks.find((r) => r.id === 'dk_small')).toMatchObject({ category: 'deck', slots: ['brain'] })
  })

  it('沒有人回答的類別是空的（只裝 creation）', () => {
    const g = setup([characterFeature, creationFeature])
    expect(creationCatalog(g.k, g.state, draft())).toEqual({ bridges: [], cyber: [], gear: [] })
  })

  it('目錄上選得到的每一件，拿去問第 6、9 步都不擋（目錄與規則是同一套）', () => {
    const g = setup()
    const base = draft({ origin: 'corp', originChoice: { favor: 'hz' } })
    const c = creationCatalog(g.k, g.state, base)
    for (const r of c.bridges.filter((x) => x.block === null)) expect(cyberStepBlock(g.k, g.state, { ...base, bridge: r.id, cyber: [] }), r.id).toBeNull()
    for (const r of c.gear.flatMap((x) => x.rows).filter((x) => x.block === null && x.points <= 12)) {
      if (r.category === 'deck') continue
      expect(gearStepBlock(g.k, g.state, { ...base, bridge: 'bp_bridge_a', gear: [{ id: r.id }] }), r.id).toBeNull()
    }
  })
})

describe('出身的建議組合（origin.suggested；suggestedKit）', () => {
  it('沒寫建議的出身：has 是 false', () => {
    const g = setup()
    expect(suggestedKit(g.k, g.state, draft({ origin: 'corp', originChoice: { favor: 'hz' } }))).toMatchObject({ has: false, gear: [], cyber: [], trimmed: [] })
  })

  it('超過點數的照順序從後面裁掉（先裁裝備再裁義體）：這個建議的裝備 1 + 2 + 1×3 + 步槍，點數 12 放不下的先裁', () => {
    const g = setup()
    const kit = suggestedKit(g.k, g.state, draft({ origin: 'nomad', originChoice: { favor: 'lonestar' } }))
    expect(kit.has).toBe(true)
    expect(kit.bridge).toBe('bp_bridge_b')
    expect(kit.cyber).toEqual([{ blueprint: 'bp_eye' }, { blueprint: 'bp_arm', side: 'l' }])
    // 裁完的草稿第 6、9 步都不擋
    const d = draft({ origin: 'nomad', originChoice: { favor: 'lonestar' }, bridge: kit.bridge, cyber: kit.cyber, gear: kit.gear })
    expect(cyberStepBlock(g.k, g.state, d)).toBeNull()
    expect(gearStepBlock(g.k, g.state, d)).toBeNull()
    expect(kit.gear.map((x) => x.id)).toEqual(expect.arrayContaining(['it_jacket']))
  })

  it('點數很少時一直裁：先裁完裝備再裁義體；trimmed 是裁掉的 id（照裁掉的順序）；裁到放得下為止', () => {
    const g = makeGame({ scenario: 'beforeCreation', features: ALL, content: [MINI_PACK, PACK, FEATURE_PACK], seed: 11, patch: { rules: { startCyberPoints: 4 } as never } }).game
    const kit = suggestedKit(g.k, g.state, draft({ origin: 'nomad', originChoice: { favor: 'lonestar' } }))
    expect(kit.cyber).toEqual([])
    expect(kit.trimmed.slice(0, kit.trimmed.length)).toEqual(expect.arrayContaining(['bp_arm', 'bp_eye']))
    const d = draft({ origin: 'nomad', originChoice: { favor: 'lonestar' }, bridge: kit.bridge, cyber: kit.cyber, gear: kit.gear })
    expect(cyberStepBlock(g.k, g.state, d)).toBeNull()
    expect(gearStepBlock(g.k, g.state, d)).toBeNull()
  })

  // M4-fix-2：草稿還沒選橋、建議也沒寫橋時，第 6 步一定有「要選一座橋，或選沒有橋」這一條，和建議的東西無關：以前這條讓裝備與義體被裁得一件都不剩
  describe('草稿還沒選橋、建議沒寫橋：不把裝備與義體全裁掉（M4-fix-2）', () => {
    const NOBRIDGE = (suggested: Rec): ContentPack => ({ id: 'nobridge_origin', content: { origin: [{ ...(PACK.content as Rec).origin[1], id: 'drifter', name: '流浪', suggested }] } } as unknown as ContentPack)
    const kitOf = (suggested: Rec, d: Partial<CreationDraft> = {}) => {
      const g = setup(ALL, [NOBRIDGE(suggested)])
      return { g, kit: suggestedKit(g.k, g.state, draft({ origin: 'drifter', originChoice: { favor: 'lonestar' }, ...d })) }
    }

    it('沒選橋、建議沒寫橋：義體與裝備原樣留著，沒有裁掉任何一件；選橋的那一條照樣在（那是玩家要做的事，不是這份建議的錯）', () => {
      const { g, kit } = kitOf({ cyber: [{ blueprint: 'bp_eye' }], gear: [{ id: 'it_jacket' }, { id: 'it_gel', qty: 2 }] })
      expect(kit).toMatchObject({ has: true, bridge: undefined, trimmed: [] })
      expect(kit.cyber).toEqual([{ blueprint: 'bp_eye' }])
      expect(kit.gear).toEqual([{ id: 'it_jacket' }, { id: 'it_gel', qty: 2 }])
      const d = draft({ origin: 'drifter', originChoice: { favor: 'lonestar' }, cyber: kit.cyber, gear: kit.gear })
      expect(cyberStepBlock(g.k, g.state, d)?.reason).toBe('要選一座橋，或選「沒有橋」。')
      expect(gearStepBlock(g.k, g.state, d)).toBeNull()
    })

    it('真的超過點數的照樣裁（先裁裝備、再裁義體）：裝備點數只有 12，放不下的從後面裁，留下的第 9 步不擋', () => {
      const { g, kit } = kitOf({ gear: [{ id: 'it_jacket' }, { id: 'bp_vest' }, { id: 'it_gel', qty: 3 }, { id: 'bp_rifle2' }, { id: 'bp_rifle2' }, { id: 'bp_rifle2' }] })
      expect(kit.trimmed.length).toBeGreaterThan(0)
      expect(kit.gear.length).toBeGreaterThan(0)
      expect(kit.gear.length).toBeLessThan(6)
      const d = draft({ origin: 'drifter', originChoice: { favor: 'lonestar' }, gear: kit.gear })
      expect(gearStepBlock(g.k, g.state, d)).toBeNull()
    })

    it('要接在橋上的裝備（甲板）沒橋的時候照樣被擋：只有它被裁，同組的別的裝備留著', () => {
      const { kit } = kitOf({ gear: [{ id: 'it_jacket' }, { id: 'bp_deck' }] })
      expect(kit.trimmed).toContain('bp_deck')
      expect(kit.gear.map((x) => x.id)).toContain('it_jacket')
    })

    it('草稿已經選了橋：不受影響，和以前一樣', () => {
      const { kit } = kitOf({ cyber: [{ blueprint: 'bp_eye' }], gear: [{ id: 'it_jacket' }] }, { bridge: 'bp_bridge_a' })
      expect(kit.trimmed).toEqual([])
      expect(kit.cyber).toEqual([{ blueprint: 'bp_eye' }])
      expect(kit.gear).toEqual([{ id: 'it_jacket' }])
    })
  })

  it('suggested 的格式不對在載入時擋下', () => {
    for (const bad of [{ bridge: 7 }, { cyber: 'x' }, { cyber: [{ blueprint: 'bp_eye', side: 'up' }] }, { gear: [{ id: 'it_gel', qty: 0 }] }, 'x']) {
      const pack = { id: 'bad_suggested', content: { origin: [{ ...(PACK.content as Rec).origin[0], id: 'bad', suggested: bad }] } } as unknown as ContentPack
      expect(() => setup(ALL, [pack]), JSON.stringify(bad)).toThrow(ContentError)
    }
  })
})

describe('外觀裡推出來的三樣（creationLook；掛點 creation.look）', () => {
  it('外露的義體：設計圖有 look.at 的列一句「<他>的<部位>是<牌子的名字>，<外殼的描寫>。」；橋寫成橋接口；牌子的描寫在 creation_rule 的預設加資料蓋掉', () => {
    const g = setup()
    const look = creationLook(g.k, g.state, draft({ pronoun: '她', bridge: 'bp_bridge_a', cyber: [{ blueprint: 'bp_eye' }] }))
    expect(look.cyber).toEqual(['她的左眼是hz的義眼，外殼沒有什麼特別。'])
    // 牌子的描寫（織女）與設計圖自己的 line
    const g2 = setup(ALL, [{ id: 'look_rule', content: { creation_rule: [{ ...(MINI_PACK.content as Rec).creation_rule[0], look: { brand_lines: { hz: '一圈很淡的刻痕' } } }] } } as unknown as ContentPack])
    expect(creationLook(g2.k, g2.state, draft({ pronoun: '她', cyber: [{ blueprint: 'bp_eye' }], bridge: null })).cyber[0]).toBe('她的左眼是hz的義眼，一圈很淡的刻痕。')
  })

  it('二手與同人另外認；沒有 look 的義體不出現；自訂的人稱用「你」', () => {
    const g = setup()
    const look = creationLook(g.k, g.state, draft({ pronoun: '自訂', bridge: null, cyber: [{ blueprint: 'bp_arm', side: 'l' }, { blueprint: 'bp_eye' }] }))
    expect(look.cyber).toHaveLength(1)
    expect(look.cyber[0]).toContain('你的左眼')
  })

  it('獸化：設計圖 look.beast；系由草稿的 beastLine（沒寫是貓）；機械派與生體派的句子不同；耳與尾各一句', () => {
    const g = setup()
    const cat = creationLook(g.k, g.state, draft({ pronoun: '她', bridge: null, cyber: [{ blueprint: 'bp_ears' }, { blueprint: 'bp_tail_mech', side: 'l' }] }))
    expect(cat.beast).toEqual([
      '她的頭上有一對貓耳，毛是真的，摸得到底下的軟骨，她不高興的時候耳朵會往後貼平。',
      '她的身後拖著一條貓尾，外殼是霧面的黑色，尾根有一圈金屬的接縫。',
    ])
    const fox = creationLook(g.k, g.state, draft({ pronoun: '她', beastLine: '狐', bridge: null, cyber: [{ blueprint: 'bp_ears' }] }))
    expect(fox.beast[0]).toBe('她的頭上有一對狐耳，毛是真的，摸得到底下的軟骨，她在想事情的時候耳朵會慢慢轉向一邊。')
    // 機械尾：外觀的 line 與外殼的描寫（設計圖寫了 line）
    expect(cat.cyber.some((l) => l.includes('機械尾') || l.includes('織女的機械尾'))).toBe(true)
  })

  it('穿著的風格：出身白給的衣服加上這一次選的衣服、護甲、飾品的風格合計；最高的是 main；句子寫出白給那一套與外加的衣服', () => {
    const g = setup()
    const look = creationLook(g.k, g.state, draft({ pronoun: '她', origin: 'nomad', originChoice: { favor: 'lonestar' }, bridge: null, cyber: [], gear: [{ id: 'it_jacket' }, { id: 'it_idol' }, { id: 'it_gel' }] }))
    expect(look.style.tags).toEqual([['偶像', 2], ['荒地', 1], ['街頭', 1]].sort((a, b) => (b[1] as number) - (a[1] as number)))
    expect(look.style.main).toBe('偶像')
    expect(look.style.line).toBe('她今天穿著出身那一區的荒地日常服裝，外面加上街頭夾克、打歌服。')
  })

  it('沒選衣服：只有白給的那一套；什麼都沒有（沒有白給、沒有選）：沒有風格、main 是 null', () => {
    const g = setup()
    const only = creationLook(g.k, g.state, draft({ pronoun: '她', origin: 'nomad', originChoice: { favor: 'lonestar' }, bridge: null, cyber: [], gear: [] }))
    expect(only.style.tags).toEqual([['荒地', 1]])
    expect(only.style.line).toBe('她今天穿著出身那一區的荒地日常服裝。')
    const none = creationLook(g.k, g.state, draft({ pronoun: '她', bridge: null, cyber: [], gear: [] }))
    expect(none.style).toEqual({ tags: [], main: null, line: '' })
    expect(none.cyber).toEqual([])
    expect(none.beast).toEqual([])
  })

  it('look 的格式不對（設計圖與 creation_rule）在載入時擋下', () => {
    expect(() => setup(ALL, [{ id: 'bad_look', content: { creation_rule: [{ ...(MINI_PACK.content as Rec).creation_rule[0], look: { brand_lines: { x: 5 } } }] } } as unknown as ContentPack])).toThrow(ContentError)
    const bad = { id: 'bad_bp_look', content: { blueprint: [bp('bp_badlook', { slot: 'eye', invasiveness: 'light', sink_cost: 1, require: [{ type: 'sensor' }], stock: { sensor: 'pt_eye' }, look: { at: '左眼', beast: { school: 'x', part: 'ears' } } })] } } as unknown as ContentPack
    expect(() => setup(ALL, [bad])).toThrow(ContentError)
  })
})

