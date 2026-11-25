// 驗收測試：dev/work/M4-cyber-battle.md（cpp-feature）。規格：CYBERWARE 第 3、4 節；CRAFTING 5.5 節；COMBAT_SYSTEM 第 6 節；SKILL_TREES 改造師「戰地手術」；ITEMS 4.1 節；
// ENEMIES 4.1 節；dev/adr/0015 第三節與 E13；dev/adr/0019 第三節與 P9、P10、P46、P47。
// 內容一律用測試自帶的最小假資料：反射加速器（toggle、分檔）、熱驅動（scaling）、冷卻迴路（action：排 6 點）、藥泵、一條義臂、駭入接頭（vs）。
// 戰鬥用真的 combat 功能的效果（vent）與 cyberware；敵人不動（行動點 0），骰子靠種子。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, ContentPack, Feature, ReportDraft } from '../../src'
import { BattleRun, ContentError, clone, currentUnit, regenTotal, targetWeight, unitsOf } from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { cyberLive, cyberOf, cyberView, cyberwareFeature, loadPumpDraft, pumpBlock, pumpProblems, pumpView, removeDraft } from '../../src/features/cyberware'
import { enemyUnit, makeActor, makeGame, testWeapon } from '../../src/testkit'

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
/** 測試的替身：一種給 ap_regen +1 的藥（來源 drug）。 */
const DRUG_STUB: Feature = {
  id: 'drug_stub',
  install(k) {
    k.battle.modifier('drug_stub', (q) => (q.kind === 'ap_regen' && q.unit.actor === 'pc' ? [{ label: '興奮劑', value: 1, source: 'drug' }] : []))
  },
}

/** 測試的替身：人一直在住處（條件 at_home；自己動刀要在住處或診所）。 */
const HOME_STUB: Feature = {
  id: 'home_stub',
  install(k) {
    k.conditions.register({ kind: 'at_home', owner: 'home_stub', validate: () => [], test: () => true })
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
const ids = (g: G): string[] => g.battleOptions()!.actions.map((a) => a.id)
const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const win = async (g: G) => {
  g.state.battle!.result = { outcome: 'win', text: '贏了。' }
  await g.finishBattle()
}

// ===================================================================================================================

describe('進戰鬥：cyber_count 與 implants', () => {
  const two = [BRIDGE, piece('h1', 'bp_heat', 'torso'), piece('c1', 'bp_cooler', 'torso')]

  it('主角裝兩件義體加一座橋：cyber_count 是 2、現實戰鬥的單位 implants 兩筆、cyber 是 2（橋不算）', () => {
    const g = fight({ pieces: two })
    expect(g.k.stats.stat(g.state, 'pc', 'cyber_count')).toBe(2)
    const u = unit(g, 'a1')
    expect(u.cyber).toBe(2)
    expect(u.implants).toEqual([{ kind: 'torso', name: '熱驅動' }, { kind: 'torso', name: '冷卻迴路' }])
    // 沒有義體的隊友：沒有 implants、cyber 是 0
    expect(unit(g, 'a2').implants).toBeUndefined()
    expect(unit(g, 'a2').cyber).toBe(0)
  })

  it('內海戰鬥沒有 implants；內海的行動表裡也沒有義體的行動', () => {
    const g = make({ pieces: two })
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').implants).toHaveLength(2)
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'net').implants).toBeUndefined()
    expect(g.k.battle.actionsFor('net').map((a) => a.id)).not.toContain('cyber_cooler')
    expect(g.k.battle.actionsFor('meat').map((a) => a.id)).toContain('cyber_cooler')
  })

  it('失效與超頻的種類：implant_kind，沒寫用設計圖的部位；休養中與有 off 的不列、但 cyber_count 照算；授權鎖（契約）的標出來', () => {
    const pieces = [
      BRIDGE, piece('r1', 'bp_reflex', 'brain'), piece('a1', 'bp_arm', 'arm_l', { lock: { kind: 'contract' } }), piece('t1', 'bp_heat', 'torso', { ready_at: 99999 }), piece('c1', 'bp_cooler', 'torso', { off: { why: 'lock' } }),
    ]
    const g = make({ pieces })
    expect(g.k.stats.stat(g.state, 'pc', 'cyber_count')).toBe(4)
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').implants).toEqual([{ kind: 'reflex', name: '反射加速器' }, { kind: 'limb', name: '義臂', contract: true }])
  })
})

describe('反射加速器：開關、分檔、回灌、節奏資源的上限（P9）', () => {
  const withReflex = { pieces: [BRIDGE, piece('r1', 'bp_reflex', 'brain')], skills: {} }

  it('開標準檔：不花行動點；下一回合多回 1 點行動點、回合開始感載 +3；同回合不能再切', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    const o = optionOf(g, 'cyber_reflex')!
    expect(o.cost.ap).toBe(0)
    expect(o.ok).toBe(true)
    const u = unit(g, 'a1')
    const ap = u.ap.now
    act(g, { action: 'cyber_reflex', pick: { gear: 'standard' } })
    expect(unit(g, 'a1').ap.now).toBe(ap)
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ on: { cyber_reflex: 'standard' } })
    expect(refused(g, { action: 'cyber_reflex', pick: { gear: 'shallow' } })[0]).toMatch(/這個回合已經切換過/)
    // 沒有用完的行動點留到下回合：清成 0，才看得出回復的量
    unit(g, 'a1').ap.now = 0
    const regen = unit(g, 'a1').ap.regen
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    expect(unit(g, 'a1').ap.now).toBe(regen + 1)
    expect(unit(g, 'a1').load!.now).toBe(3)
    // 每個自己的回合都加
    // 第二個回合開始：上一回合的 3 點先自然消退 2 點（2 ＋ mod(意志)），再加 3
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    expect(unit(g, 'a1').load!.now).toBe(3 - 2 + 3)
  })

  it('同時吃著一種給 ap_regen +1 的藥（來源 drug）：還是只多 1；沒有開關的時候藥自己也是 +1', () => {
    const g = fight({ ...withReflex, extra: [DRUG_STUB] })
    const total = (): number => regenTotal(run(g).mods('ap_regen', unit(g, 'a1')))
    expect(total()).toBe(1)
    toTurn(g, 'a1')
    act(g, { action: 'cyber_reflex', pick: { gear: 'standard' } })
    // 兩個來源各給 +1，合計夾在 +1
    const parts = run(g).mods('ap_regen', unit(g, 'a1'))
    expect(parts.map((p) => p.source).sort()).toEqual(['cyber', 'drug'])
    expect(parts.reduce((s, p) => s + p.value, 0)).toBe(2)
    expect(total()).toBe(1)
    unit(g, 'a1').ap.now = 0
    unit(g, 'a1').ap.max = 10
    const regen = unit(g, 'a1').ap.regen
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    expect(unit(g, 'a1').ap.now).toBe(regen + 1)
  })

  it('深檔在同步不到 3 級時灰掉並有原因；同步夠了才開得到', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    const options = optionOf(g, 'cyber_reflex')!.picks[0]!.options
    expect(options.map((x) => x.value)).toEqual(['shallow', 'standard', 'deep', 'full'])
    expect(options.find((x) => x.value === 'standard')!.blocks).toEqual([])
    expect(options.find((x) => x.value === 'deep')!.blocks.join('')).toMatch(/3 級/)
    expect(refused(g, { action: 'cyber_reflex', pick: { gear: 'deep' } }).join('')).toMatch(/3 級/)
    expect(unit(g, 'a1').ext.cyber).not.toHaveProperty('on')
    // 同步 3 級（敏感度 50 ≥ 40）就開得到深檔：回合開始加 4、每一檔的檢定加減也算（深 +2）
    const g2 = fight({ ...withReflex, skills: { sync: 3 } })
    toTurn(g2, 'a1')
    expect(optionOf(g2, 'cyber_reflex')!.picks[0]!.options.find((x) => x.value === 'deep')!.blocks).toEqual([])
    act(g2, { action: 'cyber_reflex', pick: { gear: 'deep' } })
    const hit = run(g2).mods('hit', unit(g2, 'a1')).filter((p) => p.source === 'sync')
    expect(hit).toEqual([{ label: '反射加速器（深檔）', value: 2, source: 'sync' }])
    toTurn(g2, 'a2')
    toTurn(g2, 'a1')
    expect(unit(g2, 'a1').load!.now).toBe(4)
  })

  it('再用一次不選檔就是關掉；開著時換檔；過載之後它是關的', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    act(g, { action: 'cyber_reflex', pick: { gear: 'standard' } })
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    // 換檔：已經是這一檔的灰掉
    expect(optionOf(g, 'cyber_reflex')!.picks[0]!.options.find((x) => x.value === 'standard')!.blocks.join('')).toMatch(/已經是/)
    act(g, { action: 'cyber_reflex' })
    expect(unit(g, 'a1').ext.cyber).not.toHaveProperty('on')
    expect(run(g).mods('ap_regen', unit(g, 'a1'))).toEqual([])
    // 重新開、拉到只差 1 就過載：下一個回合開始的 +3 把它打過載，開關自動關掉
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    act(g, { action: 'cyber_reflex', pick: { gear: 'standard' } })
    unit(g, 'a1').load!.now = unit(g, 'a1').load!.max - 1
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    expect(unit(g, 'a1').ext.cyber).not.toHaveProperty('on')
    expect(unit(g, 'a1').layers).toBe(1)
    expect(g.battle!.units.a1!.load!.now).toBe(0)
  })

  it('被 off_<種類> 打到（implant_kind 是 reflex）：修正馬上停、回合開始時開關跟著關', () => {
    const g = fight(withReflex)
    toTurn(g, 'a1')
    act(g, { action: 'cyber_reflex', pick: { gear: 'standard' } })
    const r = run(g)
    const u = r.unit('a1')
    expect(r.implantStatus(u, 'off', { kind: 'reflex' })).toMatchObject({ kind: 'reflex', name: '反射加速器' })
    expect(regenTotal(r.mods('ap_regen', u))).toBe(0)
    expect(r.mods('hit', u).filter((p) => p.source === 'sync')).toEqual([])
    r.k.battle.emit('turn.start', { run: r, unit: u })
    expect(u.ext.cyber).not.toHaveProperty('on')
    expect(u.load!.now).toBe(0)
  })

  it('沒有分檔的開關（推進腿）：開了每回合加那個數字、修正生效；關掉就沒有', () => {
    const g = fight({ pieces: [BRIDGE, piece('k1', 'bp_kick', 'leg_l')] })
    toTurn(g, 'a1')
    expect(optionOf(g, 'cyber_kick')!.picks).toEqual([])
    act(g, { action: 'cyber_kick' })
    expect(run(g).mods('hit', unit(g, 'a1')).filter((p) => p.source === 'cyber')).toEqual([{ label: '推進腿', value: 1, source: 'cyber' }])
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    expect(unit(g, 'a1').load!.now).toBe(2)
    act(g, { action: 'cyber_kick' })
    expect(run(g).mods('hit', unit(g, 'a1')).filter((p) => p.source === 'cyber')).toEqual([])
  })

  it('同步回灌的加減（帶 sync_backlash 標籤的 load_taken_pct）：原廠全套才有；混搭沒有；一般受到感載不吃它', () => {
    const rule = { set_bonus: { hz: [{ mod: 'load_taken_pct', amount: -10, tags: ['sync_backlash'] }] } }
    const upkeep = (parts: Rec): number => {
      const g = fight({ rule, pieces: [BRIDGE, piece('r1', 'bp_reflex_set', 'brain', { parts })] })
      toTurn(g, 'a1')
      act(g, { action: 'cyber_reflex_set', pick: { gear: 'standard' } })
      // 一般的感載（打在身上的）不吃回灌的加減
      expect(run(g).mods('load_taken_pct', unit(g, 'a1'))).toEqual([])
      toTurn(g, 'a2')
      toTurn(g, 'a1')
      return unit(g, 'a1').load!.now
    }
    expect(upkeep({ chip: 'pt_chip' })).toBe(9)
    expect(upkeep({ chip: 'pt_chip_zz' })).toBe(10)
  })
})

describe('熱驅動（scaling）：照現在的感載給', () => {
  it('感載 0 沒有加成、25 時近戰傷害 +2；遠程武器不吃；感載 9 還不夠 10 點', () => {
    const g = fight({ pieces: [BRIDGE, piece('h1', 'bp_heat', 'torso')] })
    const u = unit(g, 'a1')
    const melee = u.weapons[0]!
    expect(melee.traits).toContain('melee')
    const gun = testWeapon('pistol', 0)
    const dmg = (weapon = melee): number => run(g).mods('damage', unit(g, 'a1'), unit(g, 'f1'), weapon, []).filter((p) => p.source === 'cyber').reduce((s, p) => s + p.value, 0)
    expect(dmg()).toBe(0)
    unit(g, 'a1').load!.now = 9
    expect(dmg()).toBe(0)
    unit(g, 'a1').load!.now = 25
    expect(dmg()).toBe(2)
    expect(dmg(gun)).toBe(0)
  })
})

describe('冷卻迴路（action）：1 行動點、感載 −6、一回合第二次被擋', () => {
  it('排掉 6 點感載、花 1 點行動點；同回合再用被擋，下一回合又可以', () => {
    const g = fight({ pieces: [BRIDGE, piece('c1', 'bp_cooler', 'torso')] })
    toTurn(g, 'a1')
    unit(g, 'a1').load!.now = 20
    const ap = unit(g, 'a1').ap.now
    expect(optionOf(g, 'cyber_cooler')).toMatchObject({ cost: { ap: 1 }, ok: true })
    act(g, { action: 'cyber_cooler' })
    expect(unit(g, 'a1').load!.now).toBe(14)
    expect(unit(g, 'a1').ap.now).toBe(ap - 1)
    expect(optionOf(g, 'cyber_cooler')!.ok).toBe(false)
    expect(refused(g, { action: 'cyber_cooler' })[0]).toMatch(/這個回合已經用過冷卻迴路/)
    toTurn(g, 'a2')
    toTurn(g, 'a1')
    expect(optionOf(g, 'cyber_cooler')!.ok).toBe(true)
  })

  it('沒有裝這一件的人（隊友）沒有這個行動', () => {
    const g = fight({ pieces: [BRIDGE, piece('c1', 'bp_cooler', 'torso')] })
    toTurn(g, 'a2')
    expect(ids(g)).not.toContain('cyber_cooler')
  })
})

describe('藥泵：戰鬥外裝藥、戰鬥中 0 行動點、打完寫回', () => {
  const pump = [BRIDGE, piece('u1', 'bp_pump', 'torso')]
  const inv = [{ id: 'it_stim', qty: 3 }, { id: 'it_other', qty: 2 }, { id: 'it_candy', qty: 1 }, { id: 'it_bandage', qty: 1 }]

  it('戰鬥外裝兩劑：背包少兩劑、那一件記著預裝的藥；畫面看得到容量與剩的', () => {
    const g = make({ pieces: pump, inventory: inv })
    expect(pumpView(g.k, g.state, 'pc')).toEqual([{ uid: 'u1', bp: 'bp_pump', name: '藥泵', capacity: 3, loaded: null }])
    const d = loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', qty: 2 })
    expect(d.action).toBe('cyber.pump')
    g.commit(d)
    expect(g.state.inventory.find((s) => s.id === 'it_stim')!.qty).toBe(1)
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toEqual({ item: 'it_stim', qty: 2 })
    expect(pumpView(g.k, g.state, 'pc')[0]!.loaded).toEqual({ item: 'it_stim', name: '興奮劑', qty: 2 })
    // 不寫劑數就裝到滿（同一種補上去）
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim' }))
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toEqual({ item: 'it_stim', qty: 3 })
    expect(g.state.inventory.find((s) => s.id === 'it_stim')).toBeUndefined()
    // 換一種藥：原本的退回背包；取出：全部回背包
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_other', qty: 1 }))
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toEqual({ item: 'it_other', qty: 1 })
    expect(g.state.inventory.find((s) => s.id === 'it_stim')!.qty).toBe(3)
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: null }))
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toBeUndefined()
    expect(g.state.inventory.find((s) => s.id === 'it_other')!.qty).toBe(2)
  })

  it('裝不進去的原因一條一句：不是藥、不是用在自己身上的、超過容量、背包不夠、不是藥泵、戰鬥中', () => {
    const g = make({ pieces: [...pump, piece('c1', 'bp_cooler', 'torso')], inventory: inv })
    const why = (o: Rec): string[] => pumpProblems(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', ...o } as never)
    expect(why({ item: 'it_candy' })).toEqual(['糖不是藥，藥泵只放藥。'])
    expect(why({ item: 'it_bandage' })).toEqual(['繃帶不是用在自己身上的，藥泵放不了。'])
    expect(why({ qty: 4 })[0]).toMatch(/最多放 3 劑/)
    expect(why({ item: 'it_other', qty: 3 })[0]).toMatch(/只有 2 劑，不夠 3 劑/)
    expect(why({ qty: 3 })).toEqual([])
    expect(why({ uid: 'c1' })).toEqual(['冷卻迴路不是藥泵。'])
    expect(why({ uid: 'nope' })).toEqual(['身上沒有這一件義體。'])
    expect(pumpBlock(g.k, g.state, { actor: 'pc', uid: 'u1', item: null })).toBe('藥泵本來就是空的。')
    expect(() => loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_candy' })).toThrow(/不是藥/)
    g.startBattle(setup())
    expect(why({})[0]).toBe('戰鬥中不能替藥泵裝藥。')
  })

  it('戰鬥中用一次：不花行動點、劑數少一、效果照那個物品的 use.effects；打完狀態裡剩一劑；一劑都沒了就灰掉', async () => {
    const g = make({ pieces: pump, inventory: inv })
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', qty: 2 }))
    g.startBattle(setup())
    toTurn(g, 'a1')
    unit(g, 'a1').load!.now = 12
    const ap = unit(g, 'a1').ap.now
    expect(optionOf(g, 'cyber_pump')).toMatchObject({ cost: { ap: 0 }, ok: true })
    act(g, { action: 'cyber_pump' })
    expect(unit(g, 'a1').ap.now).toBe(ap)
    expect(unit(g, 'a1').load!.now).toBe(7)
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ pump: { u1: { item: 'it_stim', qty: 1 } } })
    // 戰鬥中不碰角色的狀態：藥泵裡還是兩劑，背包也沒動
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded!.qty).toBe(2)
    await win(g)
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toEqual({ item: 'it_stim', qty: 1 })
  })

  it('用完最後一劑：戰鬥結束時那一件沒有預裝了；藥泵這個行動空了就灰掉；隊友沒有藥泵就沒有這個行動', async () => {
    const g = make({ pieces: pump, inventory: inv })
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', qty: 1 }))
    g.startBattle(setup())
    toTurn(g, 'a1')
    act(g, { action: 'cyber_pump' })
    expect(optionOf(g, 'cyber_pump')!.ok).toBe(false)
    expect(optionOf(g, 'cyber_pump')!.blocks).toEqual(['藥泵裡沒有藥了。'])
    expect(refused(g, { action: 'cyber_pump' })).toEqual(['藥泵裡沒有藥了。'])
    toTurn(g, 'a2')
    expect(ids(g)).not.toContain('cyber_pump')
    await win(g)
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toBeUndefined()
  })

  it('重來這場戰鬥：用掉的劑數不算（沒有東西被寫進角色）', () => {
    const g = make({ pieces: pump, inventory: inv })
    g.commit(loadPumpDraft(g.k, g.state, { actor: 'pc', uid: 'u1', item: 'it_stim', qty: 2 }))
    g.startBattle(setup())
    toTurn(g, 'a1')
    act(g, { action: 'cyber_pump' })
    expect(g.retryBattle()).toBeNull()
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'u1')!.loaded).toEqual({ item: 'it_stim', qty: 2 })
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ pump: { u1: { qty: 2 } } })
  })

  it('拆下藥泵：預裝的藥一起回到背包（自己動刀；測試的替身讓人在住處）', () => {
    const g = make({
      pieces: [BRIDGE, piece('u1', 'bp_pump', 'torso', { loaded: { item: 'it_stim', qty: 2 } })], inventory: [{ id: 'it_stim', qty: 1 }], extra: [HOME_STUB], skills: { cyberware: 3 },
      rule: { self_requires: [] },
    })
    const d = removeDraft(g.k, g.state, { actor: 'pc', uid: 'u1', via: 'self' })
    g.commit(d)
    expect(cyberOf(g.state, 'pc').map((p) => p.uid)).toEqual(['b1'])
    expect(g.state.inventory.find((s) => s.id === 'it_stim')!.qty).toBe(3)
    // 拆下來的成品（有的話）不帶預裝的欄位
    for (const s of g.state.inventory.filter((x) => x.id === 'bp_pump')) expect(s.data).not.toHaveProperty('loaded')
  })
})

describe('重的重創（P46）：頭與肢體讓一件義體失效，讀的時候算、治好就回來', () => {
  const eyes = [BRIDGE, piece('e1', 'bp_eye', 'eye'), piece('e2', 'bp_eye', 'eye')]
  const reflex = (g: G): number => g.k.stats.effectiveAttr(g.state, 'pc', 'reflex')

  it('wound_head：第一件義眼不生效（effects 沒有、implants 裡沒有它）；狀況拿掉之後回來', () => {
    const g = make({ pieces: eyes, conditions: ['wound_head'] })
    expect(reflex(g)).toBe(11)
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').implants).toEqual([{ kind: 'eye', name: '義眼' }])
    // 身上有什麼不變（件數、沉溺成本照算）；不寫進狀態
    expect(cyberOf(g.state, 'pc').filter((p) => p.off)).toEqual([])
    expect(cyberLive(g.state, 'pc').filter((p) => p.off).map((p) => [p.uid, p.off!.why])).toEqual([['e1', 'wound']])
    expect(g.k.stats.stat(g.state, 'pc', 'cyber_count')).toBe(2)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(4 + 3 + 3)
    const v = cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'eye')!.pieces
    expect(v.map((x) => x!.status)).toEqual(['off', 'ready'])
    g.commit(draft([{ op: 'actor.condition', id: 'pc', condition: 'wound_head', remove: true }]))
    expect(reflex(g)).toBe(12)
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').implants).toHaveLength(2)
  })

  it('進戰鬥的單位也是照這個算；眼之外頭的重創打壞腦裡的義體；沒有眼與腦就沒事', () => {
    const g = fight({ pieces: eyes, conditions: ['wound_head'] })
    expect(unit(g, 'a1').implants).toHaveLength(1)
    const brain = make({ pieces: [BRIDGE, piece('r1', 'bp_reflex', 'brain')], conditions: ['wound_head'] })
    expect(brain.k.battle.loadoutOf(brain.state, 'pc', 'meat').implants).toBeUndefined()
    const none = make({ pieces: [BRIDGE, piece('h1', 'bp_heat', 'torso')], conditions: ['wound_head', 'wound_limb'] })
    expect(none.k.battle.loadoutOf(none.state, 'pc', 'meat').implants).toEqual([{ kind: 'torso', name: '熱驅動' }])
  })

  it('wound_limb：第一件手臂或腿的義體失效；失效的開關也開不了', () => {
    const limbs = [BRIDGE, piece('l1', 'bp_arm', 'arm_r'), piece('k1', 'bp_kick', 'leg_l')]
    const g = make({ pieces: limbs, conditions: ['wound_limb'] })
    // 順序：左臂、右臂、左腿、右腿（沒有左臂就是右臂）
    expect(cyberLive(g.state, 'pc').filter((p) => p.off).map((p) => p.uid)).toEqual(['l1'])
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').implants).toEqual([{ kind: 'limb', name: '推進腿' }])
    const fighting = fight({ pieces: limbs, conditions: ['wound_limb'] })
    toTurn(fighting, 'a1')
    expect(ids(fighting)).not.toContain('cyber_arm_vent')
    expect(ids(fighting)).toContain('cyber_kick')
    // 有效期限的狀況：到期之後不算
    const timed = make({ pieces: eyes })
    timed.commit(draft([{ op: 'actor.condition', id: 'pc', condition: 'wound_head', until: 100000 }]))
    expect(reflex(timed)).toBe(11)
    timed.commit(draft([{ op: 'time', minutes: 200000 }]))
    expect(reflex(timed)).toBe(12)
  })
})

describe('戰地手術 implant_install（P47、E13）', () => {
  const inv = [{ id: 'bp_arm', qty: 1, data: { uid: 'arm1', parts: {} } }]
  const opts = (o: Opts = {}): Opts => ({ extra: [FIELD_STUB], inventory: inv, skills: { cyberware: 2 }, ...o })

  it('裝上之後這一場：他的 implants 多一筆、用得了那條義臂的行動、那一件 effects 裡 mod 類的生效', () => {
    const g = fight(opts())
    toTurn(g, 'a1')
    expect(unit(g, 'a2').cyber).toBe(0)
    act(g, { action: 'test.field', target: { unit: 'a2' } })
    expect(unit(g, 'a2').implants).toEqual([{ kind: 'limb', name: '義臂' }])
    expect(unit(g, 'a2').cyber).toBe(1)
    expect(run(g).mods('damage', unit(g, 'a2')).filter((p) => p.source === 'cyber')).toEqual([{ label: '義臂', value: 2, source: 'cyber' }])
    // 還沒回到角色身上：背包還在、身上沒有
    expect(g.state.inventory.some((s) => s.data?.uid === 'arm1')).toBe(true)
    expect(cyberOf(g.state, 'mate').map((p) => p.uid)).toEqual(['b1'])
    toTurn(g, 'a2')
    unit(g, 'a2').load!.now = 9
    expect(ids(g)).toContain('cyber_arm_vent')
    act(g, { action: 'cyber_arm_vent' })
    expect(unit(g, 'a2').load!.now).toBe(5)
  })

  it('打贏之後：角色身上多一件（部位 arm_l、不休養）、背包少一疊、沉溺成本照自己動刀算而下限上升', async () => {
    const g = fight(opts())
    toTurn(g, 'a1')
    act(g, { action: 'test.field', target: { unit: 'a2' } })
    const floorBefore = g.k.stats.stat(g.state, 'mate', 'sink_floor')
    await win(g)
    const mine = cyberOf(g.state, 'mate').find((p) => p.uid === 'arm1')!
    expect(mine).toMatchObject({ bp: 'bp_arm', slot: 'arm_l', kind_of: 'blueprint', registered: false })
    expect(mine.ready_at).toBeUndefined()
    expect(g.state.inventory.some((s) => s.data?.uid === 'arm1')).toBe(false)
    // 沉溺成本 3（設計圖），大成功 −1；下限上升到至少那一件的成本，沉溺補到下限
    expect([2, 3]).toContain(mine.sink)
    expect(g.k.stats.stat(g.state, 'mate', 'sink_floor')).toBe(floorBefore + mine.sink)
    expect(g.state.actors.mate!.sink).toBeGreaterThanOrEqual(mine.sink + 4)
    // 休養的狀況沒有掛
    expect(g.state.actors.mate!.conditions.some((c) => c.id === 'recovering')).toBe(false)
    // 擲過一次義體學：報告多一筆 rng 推進
    const rngs = (game: G): number => game.state.reports.find((r) => r.action === 'battle.end')!.changes.filter((c) => c.op === 'rng').length
    const plain = fight(opts())
    await win(plain)
    expect(rngs(g)).toBe(rngs(plain) + 1)
  })

  it('失敗的那一次多一筆併發症（pool 含 complication 的怪癖）；沒有可抽的就只是不乾淨', async () => {
    const quirk = { id: 'cx_scar', name: '疤痕組織', desc: '縫合的地方留了疤。', kind: 'complication', pool: ['complication'], effects: [{ attr: 'reflex', amount: -1 }] }
    const results = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const g = make({ ...opts({ content: pack((c) => { c.quirk = [quirk] }) }) })
      g.state.rng.seed = seed
      g.startBattle(setup())
      toTurn(g, 'a1')
      act(g, { action: 'test.field', target: { unit: 'a2' } })
      await win(g)
      const mine = cyberOf(g.state, 'mate').find((p) => p.uid === 'arm1')!
      results.add(mine.quirks?.includes('cx_scar') ? 'complication' : 'clean')
      // 擲骰是從狀態導出的：同一個種子、同一串動作，結果一樣（存在的件數只有一件）
      expect(cyberOf(g.state, 'mate').filter((p) => p.uid === 'arm1')).toHaveLength(1)
    }
    expect(results).toEqual(new Set(['clean', 'complication']))
  })

  it('「重來這場戰鬥」之後背包那一疊還在、身上沒有；這一場被撤退也是（沒有結算就沒有寫進去）', () => {
    const g = fight(opts())
    toTurn(g, 'a1')
    act(g, { action: 'test.field', target: { unit: 'a2' } })
    expect(g.retryBattle()).toBeNull()
    expect(g.state.inventory.some((s) => s.data?.uid === 'arm1')).toBe(true)
    expect(cyberOf(g.state, 'mate').map((p) => p.uid)).toEqual(['b1'])
    expect(unit(g, 'a2').implants).toBeUndefined()
  })

  it('裝不上去的原因：不是相鄰、替自己、沒有橋、沒有空槽、快取格沒有義體、大小超過 2', () => {
    // 不相鄰：隊友站第 3 格
    const far = fight(opts(), { ...setup(), allies: [{ from: 'actor', id: 'pc', slot: 1 }, { from: 'actor', id: 'mate', slot: 3 }] })
    toTurn(far, 'a1')
    expect(refused(far, { action: 'test.field', target: { unit: 'a2' } })).toEqual(['要替相鄰一格的隊友動刀。'])
    expect(refused(far, { action: 'test.field', target: { unit: 'a1' } })).toEqual(['要替相鄰的隊友動刀，不能替自己。'])
    // 沒有橋
    const noBridge = fight(opts({ mate: [], mateBridge: null }))
    toTurn(noBridge, 'a1')
    expect(refused(noBridge, { action: 'test.field', target: { unit: 'a2' } })[0]).toMatch(/還沒有橋/)
    // 兩條手臂的槽都滿了（每條 2 槽，各放兩件）
    const full = fight(opts({ mate: [BRIDGE, piece('x1', 'bp_arm', 'arm_l'), piece('x2', 'bp_arm', 'arm_l'), piece('x3', 'bp_arm', 'arm_r'), piece('x4', 'bp_arm', 'arm_r')] }))
    toTurn(full, 'a1')
    expect(refused(full, { action: 'test.field', target: { unit: 'a2' } })[0]).toMatch(/沒有空槽/)
    // 左臂滿了就裝右臂
    const right = fight(opts({ mate: [BRIDGE, piece('x1', 'bp_arm', 'arm_l'), piece('x2', 'bp_arm', 'arm_l')] }))
    toTurn(right, 'a1')
    act(right, { action: 'test.field', target: { unit: 'a2' } })
    expect((unit(right, 'a2').ext.cyber as Rec).field[0].slot).toBe('arm_r')
    // 背包裡那一疊不見了／快取格沒有義體
    const empty = fight(opts({ inventory: [] }))
    toTurn(empty, 'a1')
    expect(refused(empty, { action: 'test.field', target: { unit: 'a2' } })[0]).toMatch(/沒有可以裝的義體/)
    // 同一件只能裝一次（快取格只有一格）
    const twice = fight(opts())
    toTurn(twice, 'a1')
    act(twice, { action: 'test.field', target: { unit: 'a2' } })
    unit(twice, 'a1').ap.now = 10
    expect(refused(twice, { action: 'test.field', target: { unit: 'a2' } })[0]).toMatch(/沒有可以裝的義體/)
  })

  it('大小超過 2 的義體不能戰地手術裝：不列為可裝', () => {
    const g = fight(opts({ inventory: [{ id: 'bp_big', qty: 1, data: { uid: 'big1', parts: {} } }] }))
    g.state.battle!.units.a1!.quick = [{ item: 'bp_big', qty: 1 }]
    toTurn(g, 'a1')
    expect(refused(g, { action: 'test.field', target: { unit: 'a2' } })[0]).toMatch(/沒有可以裝的義體/)
  })

  it('只有技能能用：道具用 implant_install 不成立', () => {
    const g = fight(opts())
    toTurn(g, 'a1')
    const r = new BattleRun(g.k, g.state, clone(g.battle!))
    expect(() => r.effects([{ op: 'implant_install' }], { user: r.unit('a1'), target: { unit: 'a2' }, source: { kind: 'item', id: 'x', name: 'x' } })).toThrow(/技能/)
  })
})

describe('設計圖的 battle 欄位：載入時的檢查', () => {
  const bad = (battle: Rec, id = 'bp_bad'): ContentPack => pack((c) => { c.blueprint!.push(bp(id, 'torso', { battle })) })
  const action = (over: Rec = {}) => ({ id: 'cyber_bad', name: '壞掉的', icon: 'bad', ap: 1, do: [{ op: 'vent', amount: 1 }], ...over })

  it('用了沒有人註冊的效果：載入時被擋下並指出是哪一張設計圖', () => {
    let error: unknown
    try {
      make({ content: bad({ actions: [action({ do: [{ op: 'no_such_op' }] })] }) })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ContentError)
    expect((error as Error).message).toMatch(/blueprint\/bp_bad：.*battle\.actions\[0\]\.do.*no_such_op/)
  })

  it('格式問題一條一條列：不認得的欄位、行動點、檔位表、scaling、vs、pump', () => {
    const message = (battle: Rec): string => {
      try {
        make({ content: bad(battle) })
      } catch (e) {
        return (e as Error).message
      }
      return ''
    }
    expect(message({ nope: 1 })).toMatch(/battle\.nope：沒有這個欄位/)
    expect(message({ actions: [action({ ap: 99 })] })).toMatch(/ap 要是 0～10/)
    expect(message({ actions: [action({ uses: { turn: 0 } })] })).toMatch(/uses\.turn 要是 1 以上/)
    expect(message({ toggle: { id: 't', name: 't', icon: 't', levels: true, upkeep_load: { standard: 3 }, mods: [] } })).toMatch(/levels 是 true，四檔都要寫/)
    expect(message({ toggle: { id: 't', name: 't', icon: 't', upkeep_load: 2, mods: [{ mod: 'not_a_mod', amount: 1 }] } })).toMatch(/不是戰鬥修正的種類/)
    expect(message({ toggle: { id: 't', name: 't', icon: 't', upkeep_load: 2, mods: [{ stat: 'armor', amount: 1 }] } })).toMatch(/要是戰鬥的修正/)
    expect(message({ scaling: [{ mod: 'damage', per_load: 0, amount: 1 }] })).toMatch(/per_load 要是 1 以上/)
    expect(message({ vs: [{ mod: 'load_taken_pct', amount: 50 }] })).toMatch(/other_tags/)
    expect(message({ pump: 0 })).toMatch(/battle\.pump/)
  })

  it('行動的 id 不能和別的設計圖或已經有的行動重複', () => {
    const dup = pack((c) => {
      c.blueprint!.push(bp('bp_x1', 'torso', { battle: { actions: [action({ id: 'cyber_same' })] } }), bp('bp_x2', 'torso', { battle: { actions: [action({ id: 'cyber_same' })] } }))
    })
    expect(() => make({ content: dup })).toThrow(/blueprint\/bp_x2：行動 cyber_same 已經有人用了（設計圖 bp_x1）/)
    expect(() => make({ content: bad({ actions: [action({ id: 'end_turn' })] }) })).toThrow(/行動 end_turn 已經有人用了/)
  })

  it('套裝加成的規則寫壞：載入時被擋下', () => {
    expect(() => make({ rule: { set_bonus: { hz: [{ mod: 'not_a_mod', amount: 1 }] } } })).toThrow(/cyber_rule\/default：set_bonus\.hz/)
  })
})

describe('敵人 AI 的 bridged 偏好、駭入接頭的條件式規則、套裝加成', () => {
  it('bridged 偏好對裝了義體的主角生效：挑他的權重比沒裝的隊友高（每件 +0.2）', () => {
    const g = fight({ pieces: [BRIDGE, piece('h1', 'bp_heat', 'torso'), piece('c1', 'bp_cooler', 'torso')] }, setup({ foes: [foe({ ai: { focus: 1, floor: 1, prefer: 'bridged', mode: 'lethal', fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 } })] }))
    const r = run(g)
    const wPc = targetWeight(r, r.unit('f1'), r.unit('a1'))
    const wMate = targetWeight(r, r.unit('f1'), r.unit('a2'))
    expect(unit(g, 'a1').cyber).toBe(2)
    expect(wPc).toBeGreaterThan(wMate)
    expect(wPc / wMate).toBeCloseTo(1.4)
    // 沒有義體的主角：兩個人一樣
    const plain = fight({}, setup({ foes: [foe({ ai: { focus: 1, floor: 1, prefer: 'bridged', mode: 'lethal', fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 } })] }))
    const p = run(plain)
    expect(targetWeight(p, p.unit('f1'), p.unit('a1'))).toBeCloseTo(targetWeight(p, p.unit('f1'), p.unit('a2')))
  })

  it('駭入接頭（battle.vs）：對手帶 lace 標籤時受到的感載 ×1.5（+50%），其他對手沒有', () => {
    const g = fight({ pieces: [BRIDGE, piece('p1', 'bp_port', 'arm_l')] }, setup({ foes: [foe({ tags: ['lace'] }), foe()] }))
    const r = run(g)
    const pct = (other: string): number => r.mods('load_taken_pct', r.unit('a1'), r.unit(other)).filter((p) => p.source === 'cyber').reduce((s, p) => s + p.value, 0)
    expect(pct('f1')).toBe(50)
    expect(pct('f2')).toBe(0)
    expect(r.mods('load_taken_pct', r.unit('a1')).filter((p) => p.source === 'cyber')).toEqual([])
    // 加感載時真的吃它：同樣的原始值，對 lace 多受 50%
    const before = r.unit('a1').load!.now
    r.addLoad(r.unit('a1'), 10, r.unit('f2'))
    const plainGot = r.unit('a1').load!.now - before
    const r2 = run(g)
    r2.addLoad(r2.unit('a1'), 10, r2.unit('f1'))
    expect(r2.unit('a1').load!.now).toBe(Math.round(10 * 1.5))
    expect(plainGot).toBe(10)
  })

  it('套裝加成：原廠全套（設計圖與零件同一個牌子）的那一件才給；混搭沒有；被動效果的來源是 cyber', () => {
    // 用沉溺的下限當記號（義體本身的成本 4 ＋ 3 ＝ 7）
    const rule = { set_bonus: { hz: [{ stat: 'sink_floor', amount: 2 }] } }
    const floor = (parts: Rec, over: Rec = {}): number => {
      const g = make({ rule, pieces: [BRIDGE, piece('r1', 'bp_reflex_set', 'brain', { parts, ...over })] })
      return g.k.stats.stat(g.state, 'pc', 'sink_floor')
    }
    expect(floor({ chip: 'pt_chip' })).toBe(9)
    expect(floor({ chip: 'pt_chip_zz' })).toBe(7)
    // 休養中（還沒好）的不給加成，成本照算
    expect(floor({ chip: 'pt_chip' }, { ready_at: 99999 })).toBe(7)
  })
})
