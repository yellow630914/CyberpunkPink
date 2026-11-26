// 白箱：features/cyberware 的戰鬥（battle.ts：分檔開關、藥泵、戰地手術）在「行動跑起來的那一層」才擋得到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：CYBERWARE 第 4 節（反射加速器照同步原則的四檔）；CORE_RULES 第 5 節（同步的四檔）；ITEMS 4.1 節（藥泵）；SKILL_TREES 改造師「戰地手術」；COMBAT_SYSTEM 第 6 節；
// dev/adr/0014（灰掉的原因一條一句）；dev/adr/0019 P9、P10、P47。
// 內容與一局和 tests/features/M4-cyber-battle.test.ts 同一套最小假資料（反射加速器、藥泵、義臂……）；這裡只補那邊沒有走到的原因。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, ContentPack, Feature } from '../../src'
import { BattleRun, clone, currentUnit, unitsOf } from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { cyberwareFeature, loadPumpDraft } from '../../src/features/cyberware'
import { enemyUnit, makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS = [part('pt_chip', 'chip'), part('pt_chip_zz', 'chip', { brand: 'zz' })]
const bp = (id: string, slot: string, over: Rec = {}): Rec => ({
  id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 2, legal: 'register', price: 900, require: [], optional: [], slot, invasiveness: 'light', sink_cost: 3, ...over,
})
const UPKEEP = { shallow: 2, standard: 3, deep: 4, full: 6 }
const BLUEPRINTS = [
  bp('bp_bridge', 'bridge', { name: '橋', bridge: { tuning_slots: 2 } }),
  bp('bp_reflex', 'brain', {
    name: '反射加速器', implant_kind: 'reflex',
    battle: { toggle: { id: 'cyber_reflex', name: '反射加速器', icon: 'reflex', levels: true, upkeep_load: UPKEEP, mods: [{ mod: 'ap_regen', amount: 1 }] } },
  }),
  bp('bp_reflex_set', 'brain', {
    name: '反射加速器（回灌重）', implant_kind: 'reflex', require: [{ type: 'chip' }],
    battle: { toggle: { id: 'cyber_reflex_set', name: '反射加速器（回灌重）', icon: 'reflex', levels: true, upkeep_load: { ...UPKEEP, standard: 10 }, mods: [{ mod: 'ap_regen', amount: 1 }] } },
  }),
  bp('bp_heat', 'torso', { name: '熱驅動', battle: { scaling: [{ mod: 'damage', per_load: 10, amount: 1, tags: ['melee'] }] } }),
  bp('bp_cooler', 'torso', {
    name: '冷卻迴路',
    battle: { actions: [{ id: 'cyber_cooler', name: '冷卻迴路', icon: 'cooler', ap: 1, uses: { turn: 1 }, do: [{ op: 'vent', amount: 6 }] }] },
  }),
  bp('bp_pump', 'torso', { name: '藥泵', battle: { pump: true } }),
  bp('bp_kick', 'leg', { name: '推進腿', implant_kind: 'limb', battle: { toggle: { id: 'cyber_kick', name: '推進腿', icon: 'kick', upkeep_load: 2, mods: [{ mod: 'hit', amount: 1 }] } } }),
  bp('bp_eye', 'eye', { name: '義眼', implant_kind: 'eye', effects: [{ attr: 'reflex', amount: 1 }] }),
  bp('bp_arm', 'arm', {
    name: '義臂', implant_kind: 'limb', size: 1, grade: 1, effects: [{ mod: 'damage', amount: 2 }],
    battle: { actions: [{ id: 'cyber_arm_vent', name: '義臂排壓', icon: 'arm', ap: 1, do: [{ op: 'vent', amount: 4 }] }] },
  }),
  bp('bp_big', 'torso', { name: '大件義體', size: 3 }),
  bp('bp_port', 'arm', { name: '駭入接頭', implant_kind: 'limb', battle: { vs: [{ mod: 'load_taken_pct', amount: 50, other_tags: ['lace'] }] } }),
]
const STATUS = (id: string, name: string, over: Rec = {}): Rec => ({ id, name, desc: `${name}。`, until: 'own_turn_end', turns: 1, kind: 'debuff', ...over })
const STATUSES = [
  STATUS('limb_hurt', '肢體受創', { until: 'battle_end', kind: 'wound' }), STATUS('dazed', '暈眩', { until: 'battle_end', kind: 'wound' }), STATUS('bleeding', '流血', { until: 'battle_end', kind: 'wound' }),
  STATUS('off_reflex', '反射加速器失效'), STATUS('off_limb', '義肢失效'), STATUS('off_generic', '義體失效'),
]
const ITEMS = [
  { id: 'it_stim', name: '興奮劑', desc: '一劑藥。', category: 'drug', grade: 1, size: 0, legal: 'free', drug: { duration: { battle: true } }, use: { ap: 1, target: 'self', effects: [{ op: 'vent', amount: 5 }] } },
  { id: 'it_other', name: '另一種藥', desc: '另一劑藥。', category: 'drug', grade: 1, size: 0, legal: 'free', drug: { duration: { battle: true } }, use: { ap: 1, target: 'self', effects: [{ op: 'vent', amount: 2 }] } },
  { id: 'it_candy', name: '糖', desc: '不是藥。', category: 'consumable', grade: 1, size: 0, legal: 'free', use: { ap: 1, target: 'self', effects: [{ op: 'vent', amount: 1 }] } },
  { id: 'it_bandage', name: '繃帶', desc: '給別人用的。', category: 'drug', grade: 1, size: 0, legal: 'free', drug: {}, use: { ap: 1, target: 'ally', effects: [{ op: 'vent', amount: 1 }] } },
]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = { part: clone(PARTS), blueprint: clone(BLUEPRINTS), battle_status: clone(STATUSES), item: clone(ITEMS) }
  patch(c)
  return { id: 'cyber_battle_test', content: c as unknown as ContentPack['content'] }
}

// ---- 一局 ----

const PARAMS = { sensitivity: 50, tolerance: 30, craving: 30, docility: 30 }
const piece = (uid: string, bpId: string, slot: string, over: Rec = {}): Rec => ({ uid, bp: bpId, slot, parts: {}, sink: 3, at: 0, ...over })
const BRIDGE = piece('b1', 'bp_bridge', 'bridge', { sink: 4 })

/** 測試的替身：主角的快取格裡放一件義臂；一個假的技能行動「戰地手術」只跑效果 implant_install。 */
const FIELD_STUB: Feature = {
  id: 'field_stub',
  install(k) {
    k.battle.loadout('field_stub', (_state, actor, mode) => (actor === 'pc' && mode === 'meat' ? { quick: [{ item: 'bp_arm', qty: 1 }] } : undefined))
    k.battle.action({
      id: 'test.field', owner: 'field_stub', name: '戰地手術', desc: '替相鄰的隊友裝上快取格裡的一件義體。', group: 'skill', target: 'ally', modes: ['meat'],
      cost: () => ({ ap: 3 }),
      targets: (view, u) => unitsOf(view.battle, u.side).map((t) => ({ target: { unit: t.id }, blocks: [] })),
      run: (run, u, target) => {
        run.effects([{ op: 'implant_install' }], { user: u, target, source: { kind: 'ability', id: 'test.field', name: '戰地手術' } })
      },
    })
  },
}


interface Opts {
  pieces?: Rec[]
  mate?: Rec[]
  conditions?: string[]
  inventory?: Rec[]
  extra?: Feature[]
  content?: ContentPack
  skills?: Record<string, number>
  rule?: Rec
  /** 隊友沒有橋（ext.bridge 是 null） */
  mateBridge?: null
}
const make = (o: Opts = {}) => {
  const content = o.content ?? pack((c) => { if (o.rule) c.cyber_rule = [{ id: 'default', ...o.rule }] })
  const mate = makeActor({ id: 'mate', role: 'companion', name: '夥伴', ext: { bridge: o.mateBridge === null ? null : PARAMS, cyber: { pieces: o.mate ?? [BRIDGE] } } })
  const { game } = makeGame({
    features: [characterFeature, combatFeature, cyberwareFeature, ...(o.extra ?? [])], content: [content], seed: 7,
    pc: { hp: 40, skills: o.skills ?? {}, conditions: (o.conditions ?? []).map((id) => ({ id })), ext: { bridge: PARAMS, cyber: { pieces: o.pieces ?? [BRIDGE] } } },
    actors: [mate], patch: { inventory: (o.inventory ?? []) as never },
  })
  return game
}
type G = ReturnType<typeof make>

const foe = (o: Rec = {}) => ({ from: 'unit', unit: enemyUnit('minion', 1, { weapon: 'pistol', ap: { now: 0, max: 0, regen: 0 }, ...o }) as unknown as Rec })
const setup = (o: { allies?: string[]; foes?: unknown[] } = {}): BattleSetup => ({
  mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
  allies: (o.allies ?? ['pc', 'mate']).map((id) => ({ from: 'actor', id })), foes: (o.foes ?? [foe()]) as never, origin: { escapable: true, place: '測試的巷子' },
})
const fight = (o: Opts = {}, s: BattleSetup = setup()): G => {
  const g = make(o)
  g.startBattle(s)
  return g
}
const unit = (g: G, id: string) => g.battle!.units[id]!
const run = (g: G): BattleRun => new BattleRun(g.k, g.state, clone(g.battle!))
const act = (g: G, input: Parameters<G['battleAct']>[0]) => {
  const r = g.battleAct(input)
  expect(r.reasons ?? []).toEqual([])
  expect(r.status).toBe('applied')
  return r
}
const refused = (g: G, input: Parameters<G['battleAct']>[0]): string[] => {
  const r = g.battleAct(input)
  expect(r.status).toBe('refused')
  return r.reasons ?? []
}
/** 一直往下輪，輪到這個單位為止（玩家的人結束回合、其他的由程式代打）。 */
function toTurn(g: G, id: string): void {
  for (let i = 0; i < 80; i++) {
    const cur = currentUnit(g.battle!)
    if (!cur) throw new Error('戰鬥已經沒有輪到的人')
    if (cur.id === id) return
    const r = cur.control === 'player' ? g.battleAct({ action: 'end_turn' }) : g.battleNext({ anyone: true })
    expect(r.status).toBe('applied')
  }
  throw new Error(`輪不到 ${id}`)
}
const optionOf = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)

// ===================================================================================================================

describe('分檔開關的輸入（CYBERWARE 第 4 節、CORE_RULES 第 5 節：淺、標準、深、全四檔）', () => {
  const withReflex = { pieces: [BRIDGE, piece('r1', 'bp_reflex', 'brain')] }

  it('還沒開又不選檔：不成立（要選開哪一檔）；選一個不存在的檔：不成立；兩次都沒有花掉這回合的切換', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    expect(refused(g, { action: 'cyber_reflex' }).join('')).toMatch(/開哪一檔/)
    expect(refused(g, { action: 'cyber_reflex', pick: { gear: 'turbo' } }).length).toBeGreaterThan(0)
    expect(unit(g, 'a1').ext.cyber ?? {}).not.toHaveProperty('on')
    act(g, { action: 'cyber_reflex', pick: { gear: 'shallow' } })
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ on: { cyber_reflex: 'shallow' } })
  })

  it('直接跑行動（不經過畫面的檢查）：不存在的檔丟「要選淺、標準、深、全其中一檔。」、沒開又不選檔丟「要選開哪一檔。」', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    const r = run(g)
    const def = g.k.battle.actionsFor('meat').find((a) => a.id === 'cyber_reflex')!
    expect(() => def.run(r, r.unit('a1'), undefined as never, { action: 'cyber_reflex', pick: { gear: 'turbo' } } as never)).toThrow(/要選淺、標準、深、全其中一檔/)
    expect(() => def.run(r, r.unit('a1'), undefined as never, { action: 'cyber_reflex' } as never)).toThrow(/要選開哪一檔/)
  })

  it('開著之後換到同一檔：原因「已經是…了」；行動那一層也擋', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    act(g, { action: 'cyber_reflex', pick: { gear: 'standard' } })
    const r = run(g)
    const u = r.unit('a1')
    u.uses = {}
    const def = g.k.battle.actionsFor('meat').find((a) => a.id === 'cyber_reflex')!
    expect(() => def.run(r, u, undefined as never, { action: 'cyber_reflex', pick: { gear: 'standard' } } as never)).toThrow(/已經是/)
  })
})

describe('藥泵兩座以上（ITEMS 4.1 節：從藥泵注射一劑預裝的藥）', () => {
  const pumps = [BRIDGE, piece('u1', 'bp_pump', 'torso'), piece('u2', 'bp_pump', 'torso')]
  const inv = [{ id: 'it_stim', qty: 3 }, { id: 'it_other', qty: 2 }]

  it('兩座都裝了藥：選項兩個、要選；不選、選一座不存在的：不成立；選了就從那一座扣', () => {
    const g = make({ pieces: pumps, inventory: inv })
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', qty: 1 }))
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u2', item: 'it_other', qty: 2 }))
    g.startBattle(setup())
    toTurn(g, 'a1')
    const o = optionOf(g, 'cyber_pump')!
    expect(o.picks[0]!.required).toBe(true)
    expect(o.picks[0]!.options.map((x) => x.value)).toEqual(['u1', 'u2'])
    expect(refused(g, { action: 'cyber_pump' }).length).toBeGreaterThan(0)
    expect(refused(g, { action: 'cyber_pump', pick: { pump: 'u9' } }).length).toBeGreaterThan(0)
    act(g, { action: 'cyber_pump', pick: { pump: 'u2' } })
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ pump: { u1: { qty: 1 }, u2: { qty: 1 } } })
  })

  it('行動那一層：不選丟「要選哪一座藥泵。」、選不存在的或空的丟「沒有這座藥泵，或裡面已經空了。」', () => {
    const g = make({ pieces: pumps, inventory: inv })
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', qty: 1 }))
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u2', item: 'it_other', qty: 1 }))
    g.startBattle(setup())
    toTurn(g, 'a1')
    const r = run(g)
    const def = g.k.battle.actionsFor('meat').find((a) => a.id === 'cyber_pump')!
    expect(() => def.run(r, r.unit('a1'), undefined as never, { action: 'cyber_pump' } as never)).toThrow(/要選哪一座藥泵/)
    expect(() => def.run(r, r.unit('a1'), undefined as never, { action: 'cyber_pump', pick: { pump: 'u9' } } as never)).toThrow(/沒有這座藥泵，或裡面已經空了/)
  })

  it('只剩一座有藥：不用選，直接從那一座扣', () => {
    const g = make({ pieces: pumps, inventory: inv })
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u2', item: 'it_stim', qty: 2 }))
    g.startBattle(setup())
    toTurn(g, 'a1')
    expect(optionOf(g, 'cyber_pump')!.picks[0]!.required).toBe(false)
    act(g, { action: 'cyber_pump' })
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ pump: { u2: { qty: 1 } } })
  })
})

describe('戰地手術的其餘原因（SKILL_TREES 改造師「戰地手術」；P47）', () => {
  const opts = (o: Opts = {}): Opts => ({ extra: [FIELD_STUB], skills: { cyberware: 2 }, ...o })

  it('快取格裡那一件缺零件（設計圖要晶片，成品沒有）：「…缺零件，裝不上去。」', () => {
    const g = fight(opts({ inventory: [{ id: 'bp_reflex_set', qty: 1, data: { uid: 'rs1', parts: {} } }] }))
    g.state.battle!.units.a1!.quick = [{ item: 'bp_reflex_set', qty: 1 }]
    toTurn(g, 'a1')
    expect(refused(g, { action: 'test.field', target: { unit: 'a2' } })).toEqual(['反射加速器（回灌重）缺零件，裝不上去。'])
  })

  it('目標是沒有角色的單位（敵方陣營之外的替身不算；這裡用同一側、不是角色的單位）：「…不是能裝義體的人。」', () => {
    const g = fight(opts({ inventory: [{ id: 'bp_arm', qty: 1, data: { uid: 'arm1', parts: {} } }] }))
    toTurn(g, 'a1')
    const r = run(g)
    const t = r.unit('a2')
    delete (t as { actor?: string }).actor
    expect(() => r.effects([{ op: 'implant_install' }], { user: r.unit('a1'), target: { unit: 'a2' }, source: { kind: 'ability', id: 'test.field', name: '戰地手術' } })).toThrow(/不是能裝義體的人/)
  })

  it('那一件已經裝在他身上（同一個 uid）：「…已經裝在他身上了。」', () => {
    const g = fight(opts({ inventory: [{ id: 'bp_arm', qty: 1, data: { uid: 'x1', parts: {} } }], mate: [BRIDGE, piece('x1', 'bp_arm', 'arm_l')] }))
    toTurn(g, 'a1')
    expect(refused(g, { action: 'test.field', target: { unit: 'a2' } })).toEqual(['義臂已經裝在他身上了。'])
  })
})
