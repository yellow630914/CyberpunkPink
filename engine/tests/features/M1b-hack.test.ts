// 驗收測試：dev/work/M1b-hack.md（cpp-feature）。features/hack：甲板與 RAM、內容種類 quickhack 與它變成的行動、快駭的檢定、
// 持續型、接管與控制節點、引爆、當成快駭用的腳本、AI，以及用現有的技能格式把潛網者樹「現實」欄逐個寫出來。
// 規格：NETRUNNING 第 1、2 節；ITEMS 11.9 節、5.2 節腳本；DATA 7.5 節；COMBAT_SYSTEM 2.4 節最後一條、2.5 節；ENEMIES 4.3 節、第 10 節；
// SKILL_TREES「潛網者：主控」；dev/adr/0015 E5、E9。每支程式、每個技能都是測試自帶的假資料，不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOverlay, BattleTarget, ContentPack, Feature, Kernel } from '../../src'
import { BattleBlocked, BattleRun, actionCost, aiStep, beginTurn, performAction, pickApplies, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { hackFeature } from '../../src/features/hack'
import { summonsFeature } from '../../src/features/summons'
import { makeBattleGame, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
type Entry = Rec & { id: string }
/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(150).fill(1)]
const ITEM = (id: string, more: Rec = {}): Entry => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })

// ---- 假資料：快駭程式 ----

const prog = (id: string, cls: string, more: Rec = {}): Entry => ({ id, name: id, desc: `${id}。`, class: cls, grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'load', amount: 4, type: 'neural' }], ...more })
const LOAD = (n: number): Rec => ({ op: 'load', amount: n, type: 'neural' })
const PROGRAMS: Entry[] = [
  // 神經類：每一級的數字不同（I 4、II 7、III 9、IV 12）
  prog('qh_noise', 'neural', { by_grade: { '2': { ram: 3, do: [LOAD(7)] }, '3': { ram: 3, do: [LOAD(9)], bonus: 1 }, '4': { ram: 4, do: [LOAD(12)] } } }),
  prog('qh_blind', 'cyberware', { do: [{ op: 'implant', mode: 'off', kind: 'eye', turns: 2 }], grades: [1, 2, 3] }),
  prog('qh_joint', 'cyberware', { do: [{ op: 'implant', mode: 'off', turns: 1 }] }),
  prog('qh_puppet', 'control', { ram: 4, grades: [2, 3, 4], do: [{ op: 'ap', amount: -1 }] }),
  prog('qh_mark', 'support', { ram: 1, do: [{ op: 'status', status: 'marked', until: 'source_turn_start' }] }),
  prog('qh_relay', 'device', { ram: 1, do: [{ op: 'status', status: 'jammed' }] }),
  prog('qh_loop', 'neural', { ram: 3, do: [{ op: 'hack.dot', amount: 3, turns: 3 }] }),
  prog('qh_loop2', 'neural', { ram: 3, do: [{ op: 'hack.dot', amount: 5, turns: 2 }] }),
  prog('qh_take', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', turns: 2 }] }),
  prog('qh_take_end', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', until: 'battle_end' }] }),
  prog('qh_rewrite', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', mode: 'rewrite' }] }),
  prog('qh_node', 'device', { ram: 2, target: 'node', do: [{ op: 'hack.node' }] }),
  prog('qh_boom', 'device', { ram: 2, do: [{ op: 'hack.detonate' }] }),
  // 只有 II 級以上：樹階或甲板不夠、或程式沒有那一級的幾個情況
  prog('qh_vent', 'support', { ram: 1, target: 'ally', do: [{ op: 'vent', amount: 5 }] }),
  prog('qh_self', 'support', { ram: 1, target: 'self', do: [{ op: 'vent', amount: 3 }] }),
  prog('qh_needs_bridge', 'device', { needs: { bridged: true } }),
  prog('qh_only_machine', 'device', { needs: { machine: true } }),
  prog('qh_gap', 'neural', { grades: [1, 3], by_grade: { '3': { do: [LOAD(9)] } } }),
]
const ALL_SLOTS = PROGRAMS.map((p) => p.id)

const PACK: ContentPack = {
  id: 'hack_test',
  content: {
    skill: [{ id: 'interface', name: '介面', attr: 'intellect', desc: '快駭與管理行動的介面。' }],
    battle_status: [
      ...TEST_STATUSES,
      { id: 'off_generic', name: '義體失效', desc: '義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'pinned', name: '定住', desc: '不能換位。', no_move: true, until: 'own_turn_end', turns: 1, kind: 'debuff' },
    ],
    item: [
      ITEM('it_nade', { name: '破片手雷', tags: ['explosive', 'throwable'] }),
      ITEM('it_gel', { name: '急救凝膠', tags: ['medical'], use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 1 }] } }),
      // 腳本：當成快駭用要有 quickhack 標籤（use.tag_required）；效果用同一批 op，檢定自己寫
      ITEM('it_script', { name: '干擾腳本', tags: ['script'], use: { ap: 1, target: 'foe', tag_required: 'quickhack', effects: [{ op: 'hack.check', class: 'neural', stop: true }, LOAD(5)] } }),
    ],
    quickhack: PROGRAMS,
  },
}

// ---- 場地 ----

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
const deckOf = (slots: string[], o: Rec = {}) => ({ grade: 3, firewall: 12, slots, ...o })
/** 潛網者：有 quickhack 標籤、甲板 III 級、主控 2 階、智識 14（+2）、介面 3、RAM 8。 */
const RICH = { ap: { now: 30, max: 30, regen: 3 }, pools: { ram: { now: 60, max: 60, regen: 2 } } }
const hacker = (slots: string[], o: Rec = {}, deck: Rec = {}) => one({
  tags: ['quickhack'], attrs: { body: 10, reflex: 15, tech: 10, intellect: 14, resolve: 12, charm: 10 }, skills: { interface: 3, firearms: 2, composure: 1 },
  ap: { now: 6, max: 6, regen: 3 }, pools: { ram: { now: 8, max: 8, regen: 2 } },
  ext: { deck: deckOf(slots, deck), abilities: { equipped: [], tiers: { netrunner: 2 } } }, ...o,
} as never)
const idle = (o: Rec = {}) => foe('minion', { ...quiet, ...o } as never)

interface WorldOpts {
  allies?: unknown[]
  foes?: unknown[]
  cover?: { ally: number[]; foe: number[] }
  more?: Rec
  features?: Feature[]
  packs?: ContentPack[]
  prep?: (k: Kernel) => void
}
const FEATURES = [combatFeature, hackFeature]
function world(o: WorldOpts = {}): Arena {
  return arena(duel(o.allies ?? [hacker(ALL_SLOTS), one({ weapon: 'pistol' }, 2)], o.foes ?? [idle(), idle()], o.cover, o.more as never), o.features ?? FEATURES, (k) => {
    k.content.loadPack(PACK)
    for (const p of o.packs ?? []) k.content.loadPack(p)
    o.prep?.(k)
    readyFeatures(k)
  })
}

/** 現在輪到 a1（反應、接管的「這一回合」看輪到誰）。 */
const myTurn = (a: Arena, id = 'a1'): void => {
  a.battle.turn = a.battle.order.indexOf(id)
}
const defOf = (a: Arena, id: string) => a.k.battle.getAction(id)!
/** 照現在的狀態，這個行動對這個人現在做不做得到：行動自己的原因、行動點與 RAM 不夠的原因。 */
const ring = (a: Arena, id = 'a1'): string[] => {
  const run = a.run()
  const u = run.unit(id)
  return a.k.battle.actionsFor('meat').filter((d) => !d.has || d.has(run, u)).map((d) => d.id)
}
const blocksOf = (a: Arena, action: string, id = 'a1'): string[] => {
  const run = a.run()
  return defOf(a, action).blocks?.(run, run.unit(id)) ?? []
}
const targetsOf = (a: Arena, action: string, id = 'a1') => {
  const run = a.run()
  return defOf(a, action).targets?.(run, run.unit(id)) ?? []
}
const blocksFor = (a: Arena, action: string, target: BattleTarget, id = 'a1'): string[] => targetsOf(a, action, id).find((t) => JSON.stringify(t.target) === JSON.stringify(target))?.blocks ?? ['不在目標清單上']
/** 讓一個人做一個行動（花費照核心的算法）；骰面釘死。 */
function cast(a: Arena, action: string, target: BattleTarget | null, o: { d?: number[]; user?: string; pick?: Rec } = {}): BattleRun {
  const run = a.run(o.d ?? dice(15))
  const def = defOf(a, action)
  const input: BattleInput = { action, ...(target ? { target } : {}), ...(o.pick ? { pick: o.pick } : {}) }
  performAction(run, run.unit(o.user ?? 'a1'), def, target, input)
  return run
}
const U = (id: string): BattleTarget => ({ unit: id })
const rollsOf = (run: BattleRun) => run.beats.filter((b) => b.roll).map((b) => b.roll!)
const labelOf = (r: { parts: Array<{ label: string; value: number }> }, label: string) => r.parts.find((p) => p.label === label)?.value
const overlay = (a: Arena, o: Partial<BattleOverlay> = {}): BattleOverlay =>
  a.run().addOverlay({ side: 'foe', slot: 2, kind: 'turret', name: '蜘蛛砲台', hp: { now: 20, max: 20 }, armor: 1, evade: 5, weapon: testWeapon('pistol', 30), auto: true, autonomous: true, ...o })

// =====================================================================================================================
describe('甲板與 RAM（NETRUNNING 第 1 節）', () => {
  it('沒有甲板的人沒有 RAM 池、圓環上沒有快駭；有甲板有 quickhack 標籤的人兩樣都有', () => {
    const a = world({ allies: [one({ tags: ['quickhack'], ext: { abilities: { equipped: [], tiers: { netrunner: 4 } } } } as never), hacker(ALL_SLOTS), one({}, 3)] })
    expect(a.ally(1).pools.ram).toBeUndefined()
    expect(ring(a, 'a1').filter((x) => x.startsWith('hack.'))).toEqual([])
    expect(a.ally(2).pools.ram).toMatchObject({ now: 8, max: 8 })
    expect(ring(a, 'a2').filter((x) => x.startsWith('hack.')).length).toBe(ALL_SLOTS.length)
    // 沒有甲板的第三個人（沒有標籤）：同樣沒有 RAM
    expect(a.ally(3).pools.ram).toBeUndefined()
  })

  it('有甲板、沒有 quickhack 標籤的人：圓環上沒有快駭（RAM 還在：甲板給的是網內的 RAM）', () => {
    const a = world({ allies: [hacker(ALL_SLOTS, { tags: [] }), one({}, 2)] })
    expect(a.ally(1).pools.ram).toMatchObject({ max: 8 })
    expect(ring(a, 'a1').filter((x) => x.startsWith('hack.'))).toEqual([])
  })

  it('只有裝在 deck.slots 裡的程式才是行動；程式是 group: skill、modes: meat、標籤 hack 與 hack:<類>、圖示 hack', () => {
    const a = world({ allies: [hacker(['qh_noise', 'qh_mark']), one({}, 2)] })
    expect(ring(a).filter((x) => x.startsWith('hack.')).sort()).toEqual(['hack.qh_mark', 'hack.qh_noise'])
    expect(defOf(a, 'hack.qh_noise')).toMatchObject({ group: 'skill', modes: ['meat'], tags: ['hack', 'hack:neural'], icon: 'hack', owner: 'hack' })
    expect(defOf(a, 'hack.qh_mark').tags).toEqual(['hack', 'hack:support'])
    // 戰鬥中不能換程式：甲板上的清單就是圓環
    expect(ring(a, 'a2').filter((x) => x.startsWith('hack.'))).toEqual([])
  })

  it('防火牆（E5）：有甲板用甲板的，沒有的用不含遮蔽與狀態的迴避；再加修正 firewall。核心的 check（vs: firewall）也是這樣算', () => {
    const seen: string[][] = []
    const a = world({
      allies: [hacker(ALL_SLOTS, RICH), one({}, 2)],
      foes: [idle(), idle({ ext: { deck: deckOf([], { firewall: 15 }) } }), idle({ statuses: [{ id: 'marked', until: { at: 'battle_end' } }] })],
      cover: { ally: [0, 0, 0, 0], foe: [2, 2, 2, 0] },
      prep: (k) => {
        k.battle.modifier('t', (q) => (q.kind === 'firewall' && q.unit.id === 'f3' ? [{ label: '防火牆加成', value: 2, source: 'test' }] : []))
        k.battle.on('check.before', 't', ({ tags }) => void seen.push(tags))
      },
    })
    const dc = (id: string) => rollsOf(cast(a, 'hack.qh_noise', U(id)))[0]!.dc
    // f1：沒有甲板，迴避 10（那一格有掩體也不算）
    expect(dc('f1')).toBe(10)
    // f2：甲板的防火牆 15
    expect(dc('f2')).toBe(15)
    // f3：沒有甲板，迴避 10，再加修正 2
    expect(dc('f3')).toBe(12)
    // 帶著標籤給 check.before：quickhack、hack、hack:<類>
    expect(seen[0]).toEqual(expect.arrayContaining(['hack', 'quickhack', 'hack:neural']))
    // 核心的 check 效果（vs: firewall）和它算出一樣的 DC（腳本與技能可以用）
    const run = a.run(dice(15))
    run.effects([{ op: 'check', attr: 'intellect', skill: 'interface', vs: 'firewall' }], { user: a.ally(1), target: U('f2'), source: { kind: 'ability', id: 'x', name: 'x' } })
    expect(rollsOf(run)[0]!.dc).toBe(15)
  })
})

describe('內容種類 quickhack 的格式', () => {
  const bad = (o: Rec) => (a: Arena) => a.k.content.validate('quickhack', [{ ...prog('qh_x', 'neural'), ...o }])
  const a = world()
  it('合格的程式沒有問題；trace、legal、price、script_twin、brand 收下不讀', () => {
    expect(a.k.content.validate('quickhack', [{ ...prog('qh_ok', 'neural'), trace: 5, legal: ['free', 'free'], price: [150, 500], script_twin: 'sc_x', brand: 'kaleido' }])).toEqual([])
  })
  it('寫壞的每一個欄位各一條訊息，訊息裡有欄位與那個字', () => {
    expect(bad({ class: 'magic' })(a).join()).toContain('class 只能是')
    expect(bad({ grades: [] })(a).join()).toContain('grades')
    expect(bad({ grades: [1, 1] })(a).join()).toContain('重複')
    expect(bad({ ram: -1 })(a).join()).toContain('ram')
    expect(bad({ target: 'moon' })(a).join()).toContain('target 只能是')
    expect(bad({ needs: { magic: true } })(a).join()).toContain('needs.magic')
    expect(bad({ needs: { marked: true }, target: 'self' })(a).join()).toContain('needs 只對目標是敵人')
    expect(bad({ do: [{ op: 'zap' }] })(a).join()).toContain('zap')
    expect(bad({ do: [{ op: 'load', amount: 'bogus' }] })(a).join()).toContain('amount')
    expect(bad({ by_grade: { '2': { ram: -1 } } })(a).join()).toContain('by_grade.2.ram')
    expect(bad({ by_grade: { '2': { name: 'x' } } })(a).join()).toContain('by_grade.2.name')
    expect(bad({ by_grade: { '4': { ram: 1 } }, grades: [1, 2] })(a).join()).toContain('這支程式沒有這一級')
    expect(bad({ typo: 1 })(a).join()).toContain('typo')
  })
  it('四個快駭的效果都註冊了、帶格式檢查；寫壞的欄位擋下', () => {
    for (const op of ['hack.check', 'hack.dot', 'hack.takeover', 'hack.node', 'hack.detonate']) expect(a.k.battle.getEffect(op), op).toMatchObject({ op, owner: 'hack' })
    expect(a.k.battle.effectProblems([{ op: 'hack.dot', amount: 3 }]).join()).toContain('turns')
    expect(a.k.battle.effectProblems([{ op: 'hack.takeover', mode: 'steal' }]).join()).toContain('mode')
    expect(a.k.battle.effectProblems([{ op: 'hack.takeover', until: 'forever' }]).join()).toContain('until')
  })
})

describe('神經類（一支假的白噪）', () => {
  it('RAM 與行動點扣對；檢定的明細有智識、介面、等級加值；過了就灌感載', () => {
    const a = world()
    // 主控 2 階、甲板 III 級 → 跑 II 級：RAM 3、感載 7
    const run = cast(a, 'hack.qh_noise', U('f1'))
    expect(a.ally(1).pools.ram!.now).toBe(8 - 3)
    expect(a.ally(1).ap.now).toBe(6 - 1)
    const roll = rollsOf(run)[0]!
    expect(labelOf(roll, '智識')).toBe(2)
    expect(labelOf(roll, '介面')).toBe(3)
    expect(labelOf(roll, '等級加值')).toBe(1)
    expect(roll.natural).toBe(15)
    expect(roll.total).toBe(15 + 2 + 3 + 1)
    expect(roll.dc).toBe(10)
    expect(a.foe(1).load!.now).toBe(7)
  })

  it('沒過：沒有感載，RAM 與行動點照扣，記一拍說沒有效果', () => {
    const a = world()
    const run = cast(a, 'hack.qh_noise', U('f1'), { d: dice(1) })
    expect(a.foe(1).load!.now).toBe(0)
    expect(a.ally(1).pools.ram!.now).toBe(5)
    expect(a.ally(1).ap.now).toBe(5)
    expect(run.beats.some((b) => b.text.includes('沒有效果') && b.text.includes('RAM'))).toBe(true)
    // 擲出來的總和不夠 DC 也一樣
    const b = world({ foes: [idle({ evade: 40 })] })
    cast(b, 'hack.qh_noise', U('f1'), { d: dice(10) })
    expect(b.foe(1).load!.now).toBe(0)
    expect(b.ally(1).pools.ram!.now).toBe(5)
  })

  it('對沒有橋的敵人灰掉，原因寫出來；有橋的不灰', () => {
    const a = world({ foes: [idle({ load: undefined }), idle()] })
    expect(blocksFor(a, 'hack.qh_noise', U('f1')).join()).toContain('沒有橋')
    expect(blocksFor(a, 'hack.qh_noise', U('f2'))).toEqual([])
  })

  it('RAM 不夠時做不成（跑 II 級要 3 點，只有 2 點）；RAM 夠了就行', () => {
    const a = world({ allies: [hacker(ALL_SLOTS, { pools: { ram: { now: 2, max: 8, regen: 2 } } }), one({}, 2)] })
    const run = a.run()
    expect(run.canAfford(a.ally(1), actionCost(run, a.ally(1), defOf(a, 'hack.qh_noise')))).toBe(false)
    expect(() => cast(a, 'hack.qh_noise', U('f1'))).toThrow(BattleBlocked)
    expect(a.ally(1).pools.ram!.now).toBe(2)
    // 支援類只要 1 點
    expect(() => cast(a, 'hack.qh_mark', U('f1'))).not.toThrow()
  })

  it('花費的修正 action_ram −1（最少 1）與 action_ap 吃得到：行動的標籤有 hack 與 hack:<類>', () => {
    const a = world({
      prep: (k) => {
        k.battle.modifier('t', (q) => (q.kind === 'action_ram' && q.tags.includes('hack') ? [{ label: '根權限', value: -1, source: 'skill' }] : []))
        k.battle.modifier('t', (q) => (q.kind === 'action_ap' && q.tags.includes('hack:neural') ? [{ label: '多工', value: -1, source: 'skill' }] : []))
      },
    })
    const run = a.run()
    expect(actionCost(run, a.ally(1), defOf(a, 'hack.qh_noise'))).toEqual({ ap: 0, ram: 2 })
    // 支援類本來就 0 點行動點，不會變成負的；RAM 1 的最少還是 1
    expect(actionCost(run, a.ally(1), defOf(a, 'hack.qh_mark'))).toEqual({ ap: 0, ram: 1 })
  })

  it('被駭的人那一邊的反應經由 check.before：掛點的 unit 是擲骰的人（丟程式的人）、other 是檢定對他擲的人（被駭的人）；反應改的 DC 算進去（dev/adr/0015 補記）', () => {
    const calls: Array<{ unit: string; other: string }> = []
    const a = world({
      prep: (k) => k.battle.on('check.before', 't', ({ unit, other, opts }) => {
        calls.push({ unit: unit.id, other: other.id })
        opts.dc += 3
        opts.bonus += 1
      }),
    })
    const run = cast(a, 'hack.qh_noise', U('f1'))
    expect(calls).toEqual([{ unit: 'a1', other: 'f1' }])
    const roll = rollsOf(run)[0]!
    expect(roll.dc).toBe(13)
    expect(labelOf(roll, '反應')).toBe(1)
    // 只發一次（核心 check 發的，hack.check 自己不再發）
    expect(rollsOf(run)).toHaveLength(1)
  })
})

describe('hack.check 是核心 check 效果的包裝（dev/adr/0015 補記）', () => {
  const marked = (o: Rec = {}) => idle({ statuses: [{ id: 'marked', until: { at: 'battle_end' } }], ...o })
  it('check.before 只發一次（核心 check 發的）：unit 是丟程式的人、other 是被駭的人、DC 已經含精英的加成；別的類不加精英的 2', () => {
    const calls: Array<{ unit: string; other: string; dc: number; tags: string[] }> = []
    const a = world({
      allies: [hacker(ALL_SLOTS, { ...RICH, ext: { deck: deckOf(ALL_SLOTS), abilities: { equipped: [], tiers: { netrunner: 3 } } } }), one({}, 2)],
      foes: [marked({ rank: 'elite', ext: { deck: deckOf([], { firewall: 14 }) } })],
      prep: (k) => k.battle.on('check.before', 't', ({ unit, other, opts, tags }) => void calls.push({ unit: unit.id, other: other.id, dc: opts.dc, tags })),
    })
    a.battle.units.f1!.rank = 'elite'
    const run = cast(a, 'hack.qh_puppet', U('f1'))
    expect(calls).toEqual([{ unit: 'a1', other: 'f1', dc: 16, tags: ['hack', 'quickhack', 'hack:control'] }])
    expect(rollsOf(run)[0]!.dc).toBe(16)
    // 別的類不加精英的 2
    calls.length = 0
    cast(a, 'hack.qh_noise', U('f1'))
    expect(calls.map((c) => c.dc)).toEqual([14])
  })

  it('掛著的東西（它的迴避）與控制節點（它自己的 ext.firewall）：照擲、不發 check.before；對自己、對一格不必檢定', () => {
    const calls: string[] = []
    const NODES = { nodes: [{ kind: 'light', name: '電閘' }] }
    const a = world({ features: [combatFeature, summonsFeature, hackFeature], more: NODES, prep: (k) => k.battle.on('check.before', 't', () => void calls.push('x')) })
    myTurn(a)
    const o = overlay(a, { evade: 9 })
    expect(rollsOf(cast(a, 'hack.qh_take', { overlay: o.id }))[0]!.dc).toBe(9)
    a.battle.nodes[0]!.ext = { firewall: 17 }
    expect(rollsOf(cast(a, 'hack.qh_node', { node: 'n1' }))[0]!.dc).toBe(17)
    expect(calls).toEqual([])
    // 沒有對象：效果自己做 ok、不擲
    const run = a.run(dice(15))
    const last = run.effects([{ op: 'hack.check', class: 'neural' }], { user: a.ally(1), target: U('a1'), source: { kind: 'hack', id: 'x', name: 'x' } })
    expect(last.ok).toBe(true)
    expect(rollsOf(run)).toEqual([])
  })

  it('等級加值與程式加值各一行（標籤不變）；沒過時那一句還在、stop 照樣停住後面的效果', () => {
    const a = world({ foes: [idle()] })
    const run = a.run(dice(1))
    const last = run.effects([{ op: 'hack.check', class: 'neural', grade: 4, bonus: '1+1', stop: true }, { op: 'heal', who: 'self', amount: 3 }], { user: a.ally(1), target: U('f1'), source: { kind: 'hack', id: 'qh_noise', name: '白噪' } })
    const roll = rollsOf(run)[0]!
    expect(labelOf(roll, '等級加值')).toBe(2)
    expect(labelOf(roll, '程式加值')).toBe(2)
    expect(last).toMatchObject({ ok: false, stop: true })
    expect(run.beats.some((b) => b.text.includes('白噪沒有效果'))).toBe(true)
  })
})

describe('跑幾級：主控的樹階對照與甲板的等級取低的', () => {
  const numbers = (tier: number | undefined, deckGrade: number, id = 'hack.qh_noise') => {
    const a = world({ allies: [hacker(ALL_SLOTS, { ext: { deck: deckOf(ALL_SLOTS, { grade: deckGrade }), abilities: { equipped: [], tiers: tier === undefined ? {} : { netrunner: tier } } } }), one({}, 2)] })
    const run = cast(a, id, U('f1'))
    return { load: a.foe(1).load!.now, ram: 8 - a.ally(1).pools.ram!.now, bonus: labelOf(rollsOf(run)[0]!, '等級加值') ?? 0 }
  }
  it('樹階 2、甲板 III 級、程式有 I～IV：跑 II 級的數字', () => {
    expect(numbers(2, 3)).toEqual({ load: 7, ram: 3, bonus: 1 })
  })
  it('樹階對照：1→I、2→II、3→III、4～5→IV；讀不到樹階當 1', () => {
    expect(numbers(1, 4)).toMatchObject({ load: 4, ram: 2 })
    expect(numbers(3, 4)).toMatchObject({ load: 9, ram: 3 })
    expect(numbers(4, 4)).toMatchObject({ load: 12, ram: 4 })
    expect(numbers(5, 4)).toMatchObject({ load: 12, ram: 4 })
    expect(numbers(undefined, 4)).toMatchObject({ load: 4, ram: 2 })
  })
  it('甲板的等級低時取甲板的：樹階 4、甲板 II 級跑 II 級', () => {
    expect(numbers(4, 2)).toMatchObject({ load: 7, ram: 3 })
    expect(numbers(4, 1)).toMatchObject({ load: 4, ram: 2 })
  })
  it('程式沒有那一級就用它有的最高一級（grades 是 [1, 3]、跑 II 級用 I 級；跑 IV 級用 III 級）', () => {
    const at = (tier: number) => {
      const a = world({ allies: [hacker(ALL_SLOTS, { ext: { deck: deckOf(ALL_SLOTS, { grade: 4 }), abilities: { equipped: [], tiers: { netrunner: tier } } } }), one({}, 2)] })
      cast(a, 'hack.qh_gap', U('f1'))
      return a.foe(1).load!.now
    }
    expect(at(2)).toBe(4)
    expect(at(3)).toBe(9)
    expect(at(4)).toBe(9)
  })
  it('樹階不到程式最低的那一級：灰掉並寫原因；甲板不到也一樣，兩種原因分開寫', () => {
    const lowTree = world({ allies: [hacker(ALL_SLOTS, { ext: { deck: deckOf(ALL_SLOTS, { grade: 4 }), abilities: { equipped: [], tiers: { netrunner: 1 } } } }), one({}, 2)] })
    const why = blocksOf(lowTree, 'hack.qh_puppet')
    expect(why.join()).toMatch(/最低要跑 II 級.*樹階只到 1 階/)
    expect(() => cast(lowTree, 'hack.qh_puppet', U('f1'))).toThrow(BattleBlocked)
    const lowDeck = world({ allies: [hacker(ALL_SLOTS, { ext: { deck: deckOf(ALL_SLOTS, { grade: 1 }), abilities: { equipped: [], tiers: { netrunner: 4 } } } }), one({}, 2)] })
    expect(blocksOf(lowDeck, 'hack.qh_puppet').join()).toMatch(/最低要跑 II 級.*甲板只有 I 級/)
    expect(blocksOf(world(), 'hack.qh_puppet')).toEqual([])
  })
})

describe('義體類', () => {
  const eye = { kind: 'eye', name: '義眼' }
  const arm = { kind: 'arm', name: '義肢' }
  it('目標的一件義體失效幾回合；RAM 與行動點照扣', () => {
    const a = world({ foes: [idle({ implants: [eye, arm], cyber: 2 })] })
    cast(a, 'hack.qh_blind', U('f1'))
    const st = a.foe(1).statuses.find((s) => s.id === 'off_generic')!
    expect(st).toBeTruthy()
    expect(st.until).toMatchObject({ at: 'turn_end', of: 'f1', turns: 2 })
    expect(a.ally(1).pools.ram!.now).toBe(8 - 2)
    // 沒寫哪一種的程式：第一件還沒失效的
    const b = world({ foes: [idle({ implants: [eye, arm], cyber: 2 })] })
    cast(b, 'hack.qh_joint', U('f1'))
    expect(b.foe(1).statuses.some((s) => s.id === 'off_generic')).toBe(true)
  })
  it('目標沒有義體灰掉；寫了哪一種義體的程式，目標沒有那一種也灰掉；原因都寫出來', () => {
    const a = world({ foes: [idle(), idle({ implants: [arm], cyber: 1 }), idle({ implants: [eye], cyber: 1 })] })
    expect(blocksFor(a, 'hack.qh_blind', U('f1')).join()).toContain('沒有義體')
    expect(blocksFor(a, 'hack.qh_blind', U('f2')).join()).toContain('沒有eye類的義體')
    expect(blocksFor(a, 'hack.qh_blind', U('f3'))).toEqual([])
    expect(blocksFor(a, 'hack.qh_joint', U('f1')).join()).toContain('沒有義體')
    expect(blocksFor(a, 'hack.qh_joint', U('f2'))).toEqual([])
  })
})

describe('控制類', () => {
  const marked = (o: Rec = {}) => idle({ statuses: [{ id: 'marked', until: { at: 'battle_end' } }], ...o })
  it('目標沒有標記灰掉並寫原因；有標記才打得到', () => {
    const a = world({ allies: [hacker(ALL_SLOTS, { ext: { deck: deckOf(ALL_SLOTS), abilities: { equipped: [], tiers: { netrunner: 3 } } } }), one({}, 2)], foes: [idle(), marked()] })
    expect(blocksFor(a, 'hack.qh_puppet', U('f1')).join()).toContain('還沒有標記')
    expect(blocksFor(a, 'hack.qh_puppet', U('f2'))).toEqual([])
    cast(a, 'hack.qh_puppet', U('f2'))
    expect(a.foe(2).ap.now).toBe(0)
  })
  it('控制類打精英 DC +2、打首領 +4；別的類不加', () => {
    const a = world({
      allies: [hacker(ALL_SLOTS, { ...RICH, ext: { deck: deckOf(ALL_SLOTS), abilities: { equipped: [], tiers: { netrunner: 3 } } } }), one({}, 2)],
      foes: [marked(), marked({ rank: 'elite' }), marked({ rank: 'boss' })],
    })
    // 三個人沒有甲板：防火牆 = 迴避（minion、elite、boss 在這個測試裡都是 10）
    for (const id of ['f1', 'f2', 'f3']) a.battle.units[id]!.evade = 10
    a.battle.units.f2!.rank = 'elite'
    a.battle.units.f3!.rank = 'boss'
    const dc = (id: string, action: string) => rollsOf(cast(a, action, U(id)))[0]!.dc
    expect([dc('f1', 'hack.qh_puppet'), dc('f2', 'hack.qh_puppet'), dc('f3', 'hack.qh_puppet')]).toEqual([10, 12, 14])
    expect([dc('f1', 'hack.qh_noise'), dc('f2', 'hack.qh_noise'), dc('f3', 'hack.qh_noise')]).toEqual([10, 10, 10])
  })
  it('needs.marked: false 是例外（不需要標記的控制類）', () => {
    const a = world({
      packs: [{ id: 'extra', content: { quickhack: [prog('qh_free', 'control', { needs: { marked: false }, do: [{ op: 'ap', amount: -1 }] })] } } as never],
      allies: [hacker([...ALL_SLOTS, 'qh_free']), one({}, 2)],
    })
    expect(blocksFor(a, 'hack.qh_free', U('f1'))).toEqual([])
  })
})

describe('支援類', () => {
  it('不花行動點、不必檢定；標記落在目標身上；一回合第二次灰掉（寫原因）', () => {
    const a = world()
    const run = cast(a, 'hack.qh_mark', U('f1'))
    expect(a.ally(1).ap.now).toBe(6)
    expect(a.ally(1).pools.ram!.now).toBe(7)
    expect(rollsOf(run)).toHaveLength(0)
    expect(a.foe(1).statuses.some((s) => s.id === 'marked')).toBe(true)
    expect(blocksOf(a, 'hack.qh_mark').join()).toContain('每回合只能用一次')
    // 下一個回合開始時核心清掉 turn: 的鍵：又可以用
    delete a.ally(1).uses['turn:hack.support']
    expect(blocksOf(a, 'hack.qh_mark')).toEqual([])
  })
  it('對沒有橋的敵人也標記得上（支援類不看橋）', () => {
    const a = world({ foes: [idle({ load: undefined })] })
    expect(blocksFor(a, 'hack.qh_mark', U('f1'))).toEqual([])
  })
})

describe('機器（無人機、砲塔、機器的單位）只吃裝置與控制類', () => {
  it('機器的單位：神經、義體、支援類灰掉並寫原因；裝置類打得到', () => {
    const a = world({ foes: [idle({ tags: ['machine'], load: undefined, implants: [{ kind: 'eye', name: '感測器' }], cyber: 1 })] })
    for (const id of ['hack.qh_noise', 'hack.qh_blind', 'hack.qh_mark']) expect(blocksFor(a, id, U('f1')).join(), id).toContain('是機器')
    expect(blocksFor(a, 'hack.qh_relay', U('f1'))).toEqual([])
  })
  it('掛著的無人機與砲塔：裝置類打得到；沒有 foe_overlay 目標的類型打不到它', () => {
    const a = world({
      packs: [{ id: 'extra', content: { quickhack: [prog('qh_jam', 'neural', { target: 'foe_overlay' }), prog('qh_ctl', 'control', { target: 'foe_overlay', needs: { marked: false } })] } } as never],
      allies: [hacker([...ALL_SLOTS, 'qh_jam', 'qh_ctl']), one({}, 2)],
    })
    const o = overlay(a)
    expect(blocksFor(a, 'hack.qh_take', { overlay: o.id })).toEqual([])
    expect(blocksFor(a, 'hack.qh_ctl', { overlay: o.id })).toEqual([])
    expect(blocksFor(a, 'hack.qh_jam', { overlay: o.id }).join()).toContain('只吃裝置與控制類')
  })
})

describe('對隊友、對自己用的程式與 needs 的明寫', () => {
  it('target: ally / self：不必檢定；ally 只列隊友（不含自己）；self 不用選目標', () => {
    const a = world({ allies: [hacker(ALL_SLOTS), one({ load: { now: 10, max: 30 } }, 2)] })
    expect(targetsOf(a, 'hack.qh_vent').map((t) => t.target)).toEqual([U('a2')])
    expect(defOf(a, 'hack.qh_self').target).toBe('none')
    const run = cast(a, 'hack.qh_vent', U('a2'))
    expect(rollsOf(run)).toHaveLength(0)
    expect(a.ally(2).load!.now).toBe(5)
    a.ally(1).load!.now = 8
    const self = cast(a, 'hack.qh_self', null)
    expect(rollsOf(self)).toHaveLength(0)
    expect(a.ally(1).load!.now).toBe(5)
    // 支援類用過了：自己的、隊友的共用每回合一次
    expect(blocksOf(a, 'hack.qh_vent').join()).toContain('每回合只能用一次')
  })
  it('needs 明寫：bridged（裝置類也可以要求有橋）、machine（只打機器）', () => {
    const a = world({ foes: [idle({ load: undefined }), idle(), idle({ tags: ['machine'], load: undefined })] })
    expect(blocksFor(a, 'hack.qh_needs_bridge', U('f1')).join()).toContain('沒有橋')
    expect(blocksFor(a, 'hack.qh_needs_bridge', U('f2'))).toEqual([])
    expect(blocksFor(a, 'hack.qh_only_machine', U('f2')).join()).toContain('不是機器')
    expect(blocksFor(a, 'hack.qh_only_machine', U('f3'))).toEqual([])
  })
})

describe('hack.dot：持續型', () => {
  it('三個回合各扣一次，第四個回合沒有；結束時記一拍', () => {
    const a = world()
    cast(a, 'hack.qh_loop', U('f1'))
    expect(a.foe(1).ext.hack).toMatchObject({ dot: { turns: 3, by: 'a1' } })
    const f1 = a.foe(1)
    const loads: number[] = []
    for (let i = 0; i < 4; i++) {
      const run = a.run(dice())
      a.k.battle.emit('turn.start', { run, unit: f1 })
      loads.push(f1.load!.now)
    }
    expect(loads).toEqual([3, 6, 9, 9])
    expect(f1.ext.hack).toEqual({})
  })
  it('真的回合開始（beginTurn）也扣：感載先自然消退、再受持續型的', () => {
    const a = world()
    cast(a, 'hack.qh_loop', U('f1'))
    const f1 = a.foe(1)
    f1.uses.turns = 1
    const run = a.run(dice())
    beginTurn(run, f1)
    expect(run.beats.some((b) => b.tag === 'load' && (b.data as { amount?: number }).amount === 3)).toBe(true)
    expect(f1.load!.now).toBe(3)
  })
  it('同一個目標同時只能掛一個：第二支持續型蓋掉第一支', () => {
    const a = world()
    cast(a, 'hack.qh_loop', U('f1'))
    const run = cast(a, 'hack.qh_loop2', U('f1'))
    expect(run.beats.some((b) => b.text.includes('蓋掉'))).toBe(true)
    expect(a.foe(1).ext.hack).toMatchObject({ dot: { turns: 2, amount: 5, name: 'qh_loop2' } })
    const f1 = a.foe(1)
    const loads: number[] = []
    for (let i = 0; i < 3; i++) {
      a.k.battle.emit('turn.start', { run: a.run(dice()), unit: f1 })
      loads.push(f1.load!.now)
    }
    // 兩個回合各 5（不是 3）、第三個回合沒有
    expect(loads).toEqual([5, 10, 10])
  })
  it('持續型讓目標過載時，過載算是丟程式的人讓他過載的（謝謝招待看得到）', () => {
    const seen: Array<string | undefined> = []
    const a = world({ foes: [idle({ load: { now: 20, max: 22 } })], prep: (k) => k.battle.on('overload', 't', ({ by }) => void seen.push(by?.id)) })
    cast(a, 'hack.qh_loop', U('f1'))
    a.k.battle.emit('turn.start', { run: a.run(dice()), unit: a.foe(1) })
    expect(seen).toEqual(['a1'])
  })
  it('沒有橋的目標掛不上（記一拍，感載對他無效）', () => {
    const a = world({ foes: [idle({ load: undefined })] })
    const run = a.run(dice(15))
    run.effects([{ op: 'hack.dot', amount: 3, turns: 3 }], { user: a.ally(1), target: U('f1'), source: { kind: 'hack', id: 'x', name: 'x' } })
    expect(a.foe(1).ext.hack).toBeUndefined()
    expect(run.beats.some((b) => b.text.includes('沒有橋'))).toBe(true)
  })
})

describe('hack.takeover：接管與改寫', () => {
  const setup = () => {
    const a = world({ foes: [idle(), idle()] })
    myTurn(a)
    return { a, o: overlay(a) }
  }
  const endTurn = (a: Arena, id = 'a1') => a.k.battle.emit('turn.end', { run: a.run(), unit: a.battle.units[id]! })

  it('成功：它變成我方的、操作者是做的人、不再自己動；檢定對它的迴避', () => {
    const { a, o } = setup()
    const run = cast(a, 'hack.qh_take', { overlay: o.id })
    expect(rollsOf(run)[0]!.dc).toBe(5)
    expect(o).toMatchObject({ side: 'ally', slot: 2, owner: 'a1' })
    expect(o.auto).toBeUndefined()
    expect(o.autonomous).toBeUndefined()
    expect(a.ally(1).pools.ram!.now).toBe(8 - 3)
  })
  it('沒過：它還是敵方的', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_take', { overlay: o.id }, { d: dice(1) })
    expect(o).toMatchObject({ side: 'foe', auto: true })
    expect(a.ally(1).pools.ram!.now).toBe(5)
  })
  it('兩回合裡那一台是我方的；做的人的兩個回合結束之後回到原本那一方、原本的設定也還回去', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_take', { overlay: o.id })
    endTurn(a) // 丟程式的這個回合的結束不算
    expect(o.side).toBe('ally')
    endTurn(a) // 第一個
    expect(o.side).toBe('ally')
    endTurn(a) // 第二個：到期
    expect(o).toMatchObject({ side: 'foe', auto: true, autonomous: true })
    expect(o.owner).toBeUndefined()
    expect((o.ext as Rec).hack).toEqual({})
  })
  it('接管來的東西在我方手上做得了動作：用它的武器打敵人（技能指揮它用 drone.act，見下一條）', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_take', { overlay: o.id })
    const before = a.foe(1).hp!.now
    const run = a.run(dice(15))
    const r = run.overlayAttack(o, a.foe(1))
    expect(r.hit).toBe(true)
    expect(a.foe(1).hp!.now).toBeLessThan(before)
    // 打它的人是我方：它的標籤、站在我方
    expect(run.standIn(o).side).toBe('ally')
  })
  it('接管來的那一台由做的人花 1 點行動點指揮它打敵人（技能的 drone.act：用它自己的武器、算動過、每回合一次）', () => {
    const cmd = {
      id: 'sk_cmd', name: '指揮接管機', path: 'cmd_tree', category: 'meat', tier: 1, layer: 'signature', kind: 'active', cap: 1, xp: 20, cells: 1, text: '指揮一台你的無人機或接管來的機器開火。', net: null, opinion: null,
      use: { ap: 1 }, meat: { target: 'own_overlay', picks: [{ key: 'at', label: '打誰', kind: 'foe', required: true }], do: [{ op: 'drone.act', which: 'target', at: 'pick:at' }] },
    }
    const pack: ContentPack = {
      id: 'hack_cmd_test',
      content: { path: [{ id: 'cmd_tree', name: '測試路數', tree: '測試樹', category: 'meat', signature: 'sk_cmd', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }], ability: [cmd] },
    } as unknown as ContentPack
    const a = world({
      features: [combatFeature, hackFeature, abilitiesFeature, summonsFeature], packs: [pack], foes: [idle(), idle()],
      allies: [hacker(ALL_SLOTS, { ext: { deck: deckOf(ALL_SLOTS), abilities: { equipped: ['sk_cmd'], tiers: {} } } }), one({ weapon: 'pistol' }, 2)],
    })
    myTurn(a)
    const o = overlay(a)
    cast(a, 'hack.qh_take', { overlay: o.id })
    expect(o).toMatchObject({ side: 'ally', owner: 'a1' })
    // 接管來的那一台列在技能的目標裡
    expect(targetsOf(a, 'sk_cmd').map((t) => t.target)).toEqual([{ overlay: o.id }])
    const ap = a.ally(1).ap.now
    const hp = a.foe(1).hp!.now
    const run = cast(a, 'sk_cmd', { overlay: o.id }, { pick: { at: 'f1' } })
    expect(a.ally(1).ap.now).toBe(ap - 1)
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
    expect(o.used).toBe(true)
    // 用它自己的武器（核心的替身），不是做的人的操縱
    expect(rollsOf(run)).toHaveLength(1)
    expect(rollsOf(run)[0]!.skill).not.toBe('piloting')
    // 每回合一次
    expect(() => cast(a, 'sk_cmd', { overlay: o.id }, { pick: { at: 'f1' } })).toThrow(BattleBlocked)
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
  })

  it('我方那一格已經掛著一台時接管不了（灰掉並寫原因）', () => {
    const { a, o } = setup()
    a.run().addOverlay({ side: 'ally', slot: 2, owner: 'a1', kind: 'attack', name: '我的無人機', hp: { now: 10, max: 10 }, armor: 0, evade: 0 })
    expect(blocksFor(a, 'hack.qh_take', { overlay: o.id }).join()).toContain('已經掛著一台')
    // 改寫不用把它放過來，不受影響
    expect(blocksFor(a, 'hack.qh_rewrite', { overlay: o.id })).toEqual([])
  })
  it('until: battle_end：不到期', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_take_end', { overlay: o.id })
    for (let i = 0; i < 6; i++) endTurn(a)
    expect(o.side).toBe('ally')
  })
  it('到期時原本那一格被別台佔了：挪到最近的空格；四格都佔滿就停機', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_take', { overlay: o.id })
    a.run().addOverlay({ side: 'foe', slot: 2, kind: 'turret', name: '新砲塔', hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    endTurn(a)
    endTurn(a)
    endTurn(a)
    expect(o).toMatchObject({ side: 'foe', slot: 1 })
    const b = setup()
    cast(b.a, 'hack.qh_take', { overlay: b.o.id })
    for (const slot of [1, 2, 3, 4]) b.a.run().addOverlay({ side: 'foe', slot, kind: 'turret', name: `砲塔${slot}`, hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    endTurn(b.a)
    endTurn(b.a)
    endTurn(b.a)
    expect(b.o.down).toBe(true)
  })
  it('做的人倒下：接管來的那一台由核心停機', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_take', { overlay: o.id })
    a.run().damage(a.ally(1), 999, 'physical', a.foe(1))
    expect(a.ally(1).out).toBe('down')
    expect(o.down).toBe(true)
  })
  it('只能接管敵方的東西；已經被接管的不能再接管', () => {
    const { a, o } = setup()
    const mine = a.run().addOverlay({ side: 'ally', slot: 3, owner: 'a1', kind: 'attack', name: '我的無人機', hp: { now: 10, max: 10 }, armor: 0, evade: 0 })
    expect(targetsOf(a, 'hack.qh_take').some((t) => 'overlay' in t.target && t.target.overlay === mine.id)).toBe(false)
    cast(a, 'hack.qh_take', { overlay: o.id })
    const run = a.run(dice())
    run.effects([{ op: 'hack.takeover' }], { user: a.ally(2), target: { overlay: o.id }, source: { kind: 'hack', id: 'x', name: 'x' } })
    expect(o.owner).toBe('a1')
  })

  it('改寫（rewrite）：它不換邊；到期之前每一輪自己打它原本那一方的人；到期之後不打了', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_rewrite', { overlay: o.id })
    expect(o).toMatchObject({ side: 'foe', slot: 2 })
    expect(o.auto).toBeUndefined()
    expect((o.ext as Rec).hack).toMatchObject({ taken: { mode: 'rewrite', left: 1, from: { side: 'foe', auto: true } } })
    const hp = () => a.foe(1).hp!.now + a.foe(2).hp!.now
    const before = hp()
    // 一輪開頭：抽目標（0 = 第一個）、擲命中
    const run = a.run(dice(0, 15))
    a.k.battle.emit('round.start', { run, round: 2 })
    expect(hp()).toBeLessThan(before)
    expect(run.beats.some((b) => b.text.includes('敵我名單被改寫'))).toBe(true)
    // 打的是它原本那一方的人，不是我方
    expect(a.ally(1).hp!.now).toBe(a.ally(1).hp!.max)
    expect(a.ally(2).hp!.now).toBe(a.ally(2).hp!.max)
    // 做的人的下一個回合結束：到期，還回去；之後的一輪不再打
    endTurn(a)
    endTurn(a)
    expect(o).toMatchObject({ side: 'foe', auto: true, autonomous: true })
    const mid = hp()
    a.k.battle.emit('round.start', { run: a.run(dice(0, 15)), round: 3 })
    expect(hp()).toBe(mid)
  })
  it('改寫的人倒下：還沒到期的改寫還回去', () => {
    const { a, o } = setup()
    cast(a, 'hack.qh_rewrite', { overlay: o.id })
    a.run().damage(a.ally(1), 999, 'physical', a.foe(1))
    expect((o.ext as Rec).hack).toEqual({})
    expect(o.auto).toBe(true)
  })
})

describe('hack.node：控制節點', () => {
  const NODES = { nodes: [{ kind: 'light', name: '電閘' }, { kind: 'door', name: '防爆門' }] }
  const base = (): Arena => world({ features: [combatFeature, summonsFeature, hackFeature], more: NODES })

  it('拿下節點：taken 變 true；檢定對節點的防火牆（預設 10，節點自己的 ext.firewall 蓋掉）；沒過就沒拿下', () => {
    const a = base()
    const run = cast(a, 'hack.qh_node', { node: 'n1' })
    expect(a.battle.nodes[0]!.taken).toBe(true)
    expect(rollsOf(run)[0]!.dc).toBe(10)
    expect(a.ally(1).pools.ram!.now).toBe(6)
    const b = base()
    b.battle.nodes[1]!.ext = { firewall: 30 }
    cast(b, 'hack.qh_node', { node: 'n2' })
    expect(b.battle.nodes[1]!.taken).toBe(false)
    expect(b.ally(1).pools.ram!.now).toBe(6)
  })
  it('已經拿下的節點灰掉', () => {
    const a = base()
    cast(a, 'hack.qh_node', { node: 'n1' })
    expect(blocksFor(a, 'hack.qh_node', { node: 'n1' }).join()).toContain('已經拿下')
    expect(blocksFor(a, 'hack.qh_node', { node: 'n2' })).toEqual([])
  })
  it('拿下之後，控制節點的行動（關燈、防爆門）用得了；拿下之前不行', () => {
    const a = base()
    const nodeUse = defOf(a, 'node.use')
    const run0 = a.run()
    expect(nodeUse.blocks!(run0, a.ally(1)).join()).toContain('還沒有拿下')
    expect(nodeUse.targets!(run0, a.ally(1)).find((t) => 'node' in t.target && t.target.node === 'n1')!.blocks.join()).toContain('還沒有拿下')
    cast(a, 'hack.qh_node', { node: 'n1' })
    cast(a, 'hack.qh_node', { node: 'n2' })
    const run1 = a.run()
    expect(nodeUse.blocks!(run1, a.ally(1))).toEqual([])
    cast(a, 'node.use', { node: 'n1' })
    expect(a.battle.field.dark).toBe(true)
    cast(a, 'node.use', { node: 'n2' }, { pick: { slot: 3 } })
    expect(a.battle.cover.ally[2]!.level).toBe(2)
  })
})

describe('hack.detonate：引爆', () => {
  const nade = { item: 'it_nade', qty: 2 }
  const foes = (): unknown[] => [idle({ quick: [{ ...nade }, { item: 'it_gel', qty: 1 }] }), idle()]
  it('敵人快取格少一件爆裂物、那一格的人受傷、遮蔽降一級', () => {
    const a = world({ foes: foes(), cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const hp = a.foe(1).hp!.now
    // 檢定 15，之後的傷害骰都是 6（2d6 = 12）
    const run = cast(a, 'hack.qh_boom', U('f1'), { d: dice(15, 6, 6) })
    expect(a.foe(1).quick).toEqual([{ item: 'it_nade', qty: 1 }, { item: 'it_gel', qty: 1 }])
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
    expect(a.battle.cover.foe[0]!.level).toBe(1)
    expect(run.beats.some((b) => b.text.includes('引爆') && b.text.includes('破片手雷'))).toBe(true)
    // 隔壁那一格的人沒事
    expect(a.foe(2).hp!.now).toBe(a.foe(2).hp!.max)
  })
  it('最後一件用掉就從快取格拿掉；打穿遮蔽（暴露）之後不再降', () => {
    const a = world({ foes: [idle({ quick: [{ item: 'it_nade', qty: 1 }] }), idle()] })
    cast(a, 'hack.qh_boom', U('f1'), { d: dice(15, 6, 6) })
    expect(a.foe(1).quick).toEqual([])
    expect(a.battle.cover.foe[0]!.level).toBe(0)
  })
  it('目標身上沒有爆裂物就灰掉，原因寫出來；沒過檢定時什麼都不炸（RAM 照扣）', () => {
    const a = world({ foes: foes() })
    expect(blocksFor(a, 'hack.qh_boom', U('f2')).join()).toContain('沒有爆裂物')
    expect(blocksFor(a, 'hack.qh_boom', U('f1'))).toEqual([])
    cast(a, 'hack.qh_boom', U('f1'), { d: dice(1) })
    expect(a.foe(1).quick[0]).toEqual({ item: 'it_nade', qty: 2 })
    expect(a.ally(1).pools.ram!.now).toBe(6)
  })
  it('那一格掛著的無人機也一起受傷', () => {
    const a = world({ foes: foes() })
    const o = overlay(a, { slot: 1, hp: { now: 20, max: 20 }, armor: 0 })
    cast(a, 'hack.qh_boom', U('f1'), { d: dice(15, 6, 6) })
    expect(o.hp.now).toBeLessThan(20)
  })
})

describe('腳本當成快駭用（use.tag_required）', () => {
  const withScript = (me: Rec = {}) => world({ allies: [hacker([], { quick: [{ item: 'it_script', qty: 2 }], ...me }), one({}, 2)] })
  it('沒有主控（沒有 quickhack 標籤）的人：這件道具灰掉並寫原因；硬用也做不成', () => {
    const a = withScript({ tags: [] })
    const run = a.run()
    const item = defOf(a, 'item')
    expect(item.blocks!(run, a.ally(1)).join()).toContain('quickhack')
    const opt = item.picks!(run, a.ally(1))[0]!.options[0]!
    expect(opt.blocks.join()).toContain('干擾腳本要有「quickhack」才用得了')
    expect(() => cast(a, 'item', U('f1'), { pick: { item: 'it_script' } })).toThrow(BattleBlocked)
    expect(a.ally(1).quick[0]!.qty).toBe(2)
  })
  it('有主控的人：用得了；腳本自己寫檢定，用同一批 op，沒過不灌感載、道具照用掉', () => {
    const a = withScript()
    expect(defOf(a, 'item').blocks!(a.run(), a.ally(1))).toEqual([])
    expect(defOf(a, 'item').picks!(a.run(), a.ally(1))[0]!.options[0]!.blocks).toEqual([])
    const run = cast(a, 'item', U('f1'), { pick: { item: 'it_script' } })
    expect(labelOf(rollsOf(run)[0]!, '智識')).toBe(2)
    expect(a.foe(1).load!.now).toBe(5)
    expect(a.ally(1).quick[0]!.qty).toBe(1)
    cast(a, 'item', U('f1'), { pick: { item: 'it_script' }, d: dice(1) })
    expect(a.foe(1).load!.now).toBe(5)
    expect(a.ally(1).quick).toEqual([])
  })
  it('沒有 tag_required 的道具不受影響；tag_required 寫壞了在載入時擋下', () => {
    const a = world({ allies: [one({ quick: [{ item: 'it_gel', qty: 1 }] }), one({}, 2)] })
    expect(defOf(a, 'item').blocks!(a.run(), a.ally(1))).toEqual([])
    expect(() => world({ packs: [{ id: 'bad', content: { item: [ITEM('it_bad', { use: { ap: 1, target: 'self', tag_required: 5, effects: [{ op: 'heal', amount: 1 }] } })] } } as never] })).toThrow(/tag_required/)
  })
})

describe('AI：敵方的潛網者會用快駭', () => {
  const enemyHacker = (o: Rec = {}) => idle({ tags: ['quickhack'], skills: { interface: 3, composure: 1 }, pools: { ram: { now: 6, max: 6, regen: 2 } }, ap: { now: 5, max: 5, regen: 3 }, ext: { deck: deckOf(['qh_noise'], { grade: 2 }) }, ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0, prefer_slots: [2], coverUse: 0.5 }, ...o })
  it('固定骰面下選得到它：分數 2.4 ＋ 目標的義體數 × 0.3，比基本攻擊（2）高', () => {
    const a = world({ allies: [one({ weapon: 'pistol', implants: [{ kind: 'eye', name: '眼' }, { kind: 'arm', name: '臂' }], cyber: 2 }), one({}, 2)], foes: [idle(), enemyHacker()] })
    const run = a.run()
    const def = defOf(a, 'hack.qh_noise')
    expect(def.aiScore!(run, a.foe(2), a.ally(1))).toBeCloseTo(3.0, 5)
    expect(def.aiScore!(run, a.foe(2), a.ally(2))).toBeCloseTo(2.4, 5)
    expect(def.aiScore!(run, a.foe(2), null)).toBeNull()
    const r = a.run(dice(0, 0, 15))
    expect(aiStep(r, a.foe(2))).toBe(true)
    expect(r.beats.some((b) => b.tag === 'skill' && (b.data as Rec | undefined)?.hack === 'qh_noise')).toBe(true)
    expect(a.foe(2).pools.ram!.now).toBeLessThan(6)
  })
  it('沒有 RAM 的時候不選它（改做別的）', () => {
    const a = world({ foes: [idle(), enemyHacker({ pools: { ram: { now: 0, max: 6, regen: 2 } } })] })
    const r = a.run(dice(0, 0, 15))
    aiStep(r, a.foe(2))
    expect(r.beats.some((b) => b.tag === 'skill')).toBe(false)
  })
  it('沒有 quickhack 標籤的敵人有甲板也不會用', () => {
    const a = world({ foes: [idle(), enemyHacker({ tags: [] })] })
    const r = a.run(dice(0, 0, 15))
    aiStep(r, a.foe(2))
    expect(r.beats.some((b) => b.tag === 'skill')).toBe(false)
  })
})

describe('經過 Game：圓環、花費、原因、一回合一次', () => {
  it('圓環上有快駭；行動點與 RAM 照扣；支援類第二次被擋', () => {
    const { game } = makeBattleGame({
      features: FEATURES, content: [PACK], seed: 7,
      battle: duel([hacker(['qh_mark', 'qh_noise']), one({}, 2)], [idle(), idle()]),
    })
    const b = game.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.control = 'player'
    const opts = game.battleOptions()!
    const mark = opts.actions.find((x) => x.id === 'hack.qh_mark')!
    expect(mark).toMatchObject({ group: 'skill', icon: 'hack', cost: { ap: 0, ram: 1 }, ok: true })
    expect(opts.actions.find((x) => x.id === 'hack.qh_noise')).toMatchObject({ cost: { ap: 1, ram: 3 } })
    const r = game.battleAct({ action: 'hack.qh_mark', target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    const u = game.state.battle!.units
    expect(u.a1!.pools.ram!.now).toBe(7)
    expect(u.a1!.ap.now).toBe(u.a1!.ap.max)
    expect(u.f1!.statuses.some((s) => s.id === 'marked')).toBe(true)
    const again = game.battleAct({ action: 'hack.qh_mark', target: { unit: 'f2' } })
    expect(again.status).not.toBe('applied')
    expect((again.reasons ?? []).join()).toContain('每回合只能用一次')
    // 神經類：行動點與 RAM 都扣，感載在目標身上（打得進去就是 II 級的 7）
    const noise = game.battleAct({ action: 'hack.qh_noise', target: { unit: 'f2' } })
    expect(noise.status).toBe('applied')
    expect(game.state.battle!.units.a1!.pools.ram!.now).toBe(4)
    expect(game.state.battle!.units.a1!.ap.now).toBe(game.state.battle!.units.a1!.ap.max - 1)
  })
  it('已經開打的戰鬥存檔再讀回來：持續型與接管的狀態都在戰鬥狀態裡（不靠模組裡的暫存）', () => {
    const a = world()
    myTurn(a)
    const o = overlay(a)
    cast(a, 'hack.qh_loop', U('f1'))
    cast(a, 'hack.qh_take', { overlay: o.id })
    const copy = JSON.parse(JSON.stringify(a.battle)) as typeof a.battle
    expect(copy.units.f1!.ext.hack).toMatchObject({ dot: { turns: 3 } })
    expect(copy.overlays[0]!.ext).toMatchObject({ hack: { taken: { by: 'a1', mode: 'takeover', left: 2 } } })
  })
})


// =====================================================================================================================
// 潛網者樹「現實」欄：不是「—」的每個技能，用現有的技能格式各寫一筆、跑得起來（SKILL_TREES「潛網者：主控」）。
// 技能是測試自帶的假資料（路數 id 用 netrunner，和 features/hack 預設讀樹階的那一棵一樣）；數字照樹上寫的。
// 寫不出來或只能寫成近似的地方，在每一條的註解與回報的對照表裡。

const NET_TREE = {
  id: 'netrunner', name: '潛網者', tree: '主控的樹', category: 'net', signature: 'sk_ctrl', domains: { meat: 'mid', net: 'strong', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '介面檢定 +2（快駭與管理行動都用介面）。', effect: { mods: [{ kind: 'save', value: 2, tags: ['hack'] }] } },
    // 3 階「RAM 上限 +1」、4 階「感載上限 +4」：共鳴的 effect.pool 與 effect.load_max（M1b-core-fix2）
    { tier: 3, cells: 1, text: 'RAM 上限 +1。', effect: { pool: { ram: { max: 1 } } } },
    { tier: 4, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } },
  ],
}
const nab = (id: string, name: string, kind: string, tier: number, meat: Rec | null, more: Rec = {}): Rec => ({
  id, name, path: 'netrunner', category: 'net', tier, layer: 'front', kind, cap: 1, xp: tier * 20, cells: 1, after: 'sk_ctrl', text: `${name}。`, net: null, opinion: null, meat, ...more,
})
const CHECK = (cls: string): Rec => ({ op: 'hack.check', class: cls, stop: true })
const WAY = { key: 'way', label: '用法', kind: 'choice', required: true }
const NET_ABILITIES: Rec[] = [
  nab('sk_ctrl', '主控', 'passive', 1, { tags: ['quickhack'], pool: { ram: { max: 3, regen: 1 } }, mods: [{ kind: 'save', value: { by_tier: [1, 2, 2, 3, 4] }, tags: ['hack'] }] }, { layer: 'signature', after: undefined }),
  nab('sk_ice', '破冰', 'active', 1, { target: 'enemy', do: [CHECK('device'), { op: 'buff', id: 'icebreak', name: '破冰', turns: 1, until: 'source_turn_end', mods: [{ kind: 'firewall', value: -2 }] }] }, { use: { ap: 1, ram: 2 } }),
  // 「你或一名隊友被快駭」：trigger.who 的 self_or_ally（M1b-core-fix2）
  nab('sk_peek', '偷看是不行的喔', 'reaction', 1, { trigger: { on: 'checked', who: 'self_or_ally', if: 'hack' }, react: { dc: 2 } }, { use: { ram: 1, per_turn: 1 } }),
  nab('sk_take', '接管', 'active', 1, { target: 'foe_overlay', picks: [WAY], choose: [{ key: 'take', label: '接管', do: [CHECK('device'), { op: 'hack.takeover', turns: 2 }] }, { key: 'rewrite', label: '改寫敵我名單', do: [CHECK('device'), { op: 'hack.takeover', mode: 'rewrite' }] }] }, { use: { ap: 1, ram: 3 } }),
  nab('sk_loop', '迴圈', 'active', 1, { target: 'enemy', needs: { bridged: true }, do: [CHECK('neural'), { op: 'hack.dot', amount: '1d6+1', turns: 3 }] }, { use: { ap: 1, ram: 3 }, layer: 'back', after: 'sk_ice' }),
  // 樹上還有「構裝槽 +1」：槽在甲板上（deck.slots），技能格式沒有改甲板的鍵，寫不出來
  nab('sk_band', '頻寬', 'passive', 1, { pool: { ram: { max: 1 } } }, { layer: 'back', after: 'sk_take', cap: 2 }),
  nab('sk_heat', '過熱', 'active', 2, { target: 'enemy', needs: { bridged: true }, do: [CHECK('neural'), { op: 'load', amount: '2d6', type: 'neural' }, { op: 'implant', mode: 'off', turns: 1 }] }, { use: { ap: 1, ram: 3 }, after: 'sk_loop' }),
  // 樹上還有「快駭追蹤各少 1」：追蹤度是 E9（M2、M3），這一波不做
  nab('sk_silent', '靜默', 'stance', 2, { mods: [{ kind: 'evade', value: 1 }] }, { use: { ap: 1 } }),
  // 補一級遮蔽要落在「我方一格」、放防爆門要選一格：choose 的每個用法吃同一個目標，所以補在自己那一格；
  // 引爆的灰掉原因用 needs.cache_tag（M1b-core-fix2：目標的快取格裡要有爆裂物）
  nab('sk_rewrite', '改寫地形', 'active', 2, {
    target: 'enemy', picks: [WAY],
    choose: [
      { key: 'boom', label: '引爆爆裂物', needs: { cache_tag: 'explosive' }, do: [CHECK('device'), { op: 'hack.detonate' }] },
      { key: 'strip', label: '撤掉敵方一格的掩體', when: { node_taken: true }, do: [CHECK('device'), { op: 'cover', levels: -1 }] },
      { key: 'door', label: '放下防爆門', when: { node_taken: 'door' }, do: [{ op: 'cover', levels: 1, who: 'self' }] },
    ],
  }, { use: { ap: 1, ram: 2 }, after: 'sk_take' }),
  nab('sk_focus', '盯～', 'passive', 2, { mods: [{ kind: 'save', value: 1, tags: ['hack:neural'] }] }, { layer: 'back', after: 'sk_heat', cap: 3 }),
  nab('sk_backflow', '逆流', 'reaction', 2, { trigger: { on: 'overload', who: 'self' }, do: [{ op: 'pool', pool: 'ram', amount: 'full', who: 'self' }] }, { use: { ap: 0, per_fight: 1 }, layer: 'back', after: 'sk_silent' }),
  // 快感版的「定力檢定成功可以擋掉其中 1 點」寫不出來（sink 的 save 是成功就整筆擋掉）
  nab('sk_inflow', '灌頂', 'active', 3, {
    target: 'enemy', needs: { bridged: true }, picks: [WAY],
    choose: [{ key: 'neural', label: '神經版', do: [CHECK('neural'), { op: 'load', amount: '2d6+2', type: 'neural' }] }, { key: 'pleasure', label: '快感版', do: [CHECK('neural'), { op: 'load', amount: '2d6', type: 'pleasure' }, { op: 'sink', amount: 2 }] }],
  }, { use: { ap: 1, ram: 4 }, cap: 2, after: 'sk_heat' }),
  nab('sk_backdoor', '後門', 'prep', 3, null, { use: { slot: 1 }, cap: 2, after: 'sk_silent', prep: { slot: 1, scope: 'commission', meat: { mods: [{ kind: 'action_ap', value: -9, tags: ['hack'], when: { first_round: true }, per_fight: 1 }] } } }),
  // 「另外」（有節點時再多放一道防爆門）：不能依節點自動加做，寫成兩種用法讓玩家挑
  nab('sk_lockdown', '封鎖', 'active', 3, {
    target: 'none', picks: [WAY],
    choose: [{ key: 'dark', label: '關燈', do: [{ op: 'field', key: 'dark' }] }, { key: 'door', label: '關燈並放下防爆門', when: { node_taken: 'door' }, do: [{ op: 'field', key: 'dark' }, { op: 'cover', levels: 1, who: 'self' }] }],
  }, { use: { ap: 1, ram: 4, per_fight: 1 }, cap: 2, after: 'sk_rewrite' }),
  // 「你的神經快駭讓目標過載」：overload 的反應分不出是不是神經快駭，任何你讓敵人過載的都算
  nab('sk_thanks', '謝謝招待', 'reaction', 3, { trigger: { on: 'overload', who: 'foe_by_self' }, do: [{ op: 'pool', pool: 'ram', amount: 1, who: 'self' }] }, { use: { ap: 0, per_turn: 1 }, layer: 'back', cap: 4, after: 'sk_inflow' }),
  nab('sk_mutex', '值機', 'stance', 3, { mods: [{ kind: 'save', value: 2, tags: ['hack:device'] }] }, { use: { ap: 1 }, layer: 'back', cap: 2, after: 'sk_lockdown' }),
  nab('sk_puppet', '傀儡', 'active', 4, {
    target: 'enemy', needs: { status: 'marked' }, picks: [WAY],
    choose: [{ key: 'jerk', label: '動一下', do: [CHECK('control'), { op: 'ap', amount: -1 }, { op: 'shift', dir: 'push' }] }, { key: 'pin', label: '定住', do: [CHECK('control'), { op: 'status', status: 'pinned' }] }],
  }, { use: { ap: 1, ram: 5 }, cap: 2, after: 'sk_inflow' }),
  nab('sk_mirror', '看錯人囉', 'active', 4, { target: 'ally_or_self', do: [{ op: 'buff', id: 'mirror', name: '看錯人囉', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 2 }] }] }, { use: { ap: 1, ram: 3 }, cap: 2, after: 'sk_backdoor' }),
  // 樹上還有「構裝槽 +1」：同頻寬，寫不出來
  nab('sk_multi', '多工', 'passive', 4, { mods: [{ kind: 'action_ap', value: -1, tags: ['hack'], per_turn: 1 }] }, { layer: 'back', cap: 5, after: 'sk_mutex' }),
  nab('sk_cast', '群播', 'active', 4, { target: 'none', do: [{ op: 'ap', amount: -1, who: 'foes_bridged' }] }, { use: { ap: 1, ram: 6, per_fight: 1 }, layer: 'back', cap: 2, after: 'sk_puppet' }),
  nab('sk_noleave', '不讓你帶走', 'reaction', 4, { trigger: { on: 'out_before', who: 'ally' }, react: { prevent: { how: ['subdued'] } } }, { use: { ap: 0, ram: 1, per_fight: 1 }, layer: 'back', cap: 2, after: 'sk_mirror' }),
  nab('sk_black', '黑冰', 'active', 5, { target: 'enemy', needs: { bridged: true }, do: [CHECK('neural'), { op: 'load', amount: 'spentd6', type: 'neural' }] }, { use: { ap: 1, ram_all_min: 5, per_fight: 1 }, cap: 3, after: 'sk_puppet' }),
  nab('sk_backup', '備份', 'active', 5, { target: 'none', do: [{ op: 'buff', id: 'backup', name: '備份', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 1 }], who: 'allies' }, { op: 'unstatus', kinds: ['debuff', 'mark'], count: 1, who: 'allies' }] }, { use: { ap: 1, ram: 6, per_fight: 1 }, cap: 3, after: 'sk_noleave' }),
  // 不用先選一台：關燈與降遮蔽照做，接管落在敵方的每一台（who: foe_overlays，M1b-core-fix2；樹上寫「一台」，場上有幾台就接管幾台——
  // 我方那一格已經掛著一台的接管不了，所以實際上最多接到空格的數量）
  nab('sk_admin', '管理員', 'active', 5, { target: 'none', when: { node_taken: true }, do: [{ op: 'field', key: 'dark' }, { op: 'cover', levels: -1, who: 'foes' }, { op: 'hack.takeover', until: 'battle_end', who: 'foe_overlays' }] }, { use: { ap: 1, ram: 6, per_fight: 1 }, cap: 3, after: 'sk_multi' }),
  nab('sk_root', '根權限', 'passive', 5, { mods: [{ kind: 'action_ram', value: -1, tags: ['hack'], per_turn: 1 }] }, { layer: 'back', cap: 6, after: 'sk_admin' }),
]
const NET_PACK: ContentPack = { id: 'net_tree', content: { path: [NET_TREE], ability: NET_ABILITIES } } as unknown as ContentPack
const NET_FEATURES = [combatFeature, abilitiesFeature, summonsFeature, hackFeature]
const SLOTS = ['qh_noise', 'qh_mark', 'qh_relay']
/** 樹階 3 以上的潛網者開打時的 RAM 上限：假潛網者本來 8、主控 +3、共鳴 3 階 +1（effect.pool）。2 階以下是 11。 */
const RAM3 = 8 + 3 + 1

/** 裝著主控與這幾個技能的潛網者（a1）；甲板 III 級、樹階 tier。 */
const netrunner = (ids: string[], tier = 3, o: Rec = {}) => hacker(SLOTS, { ext: { deck: deckOf(SLOTS), abilities: { equipped: ['sk_ctrl', ...ids], tiers: { netrunner: tier } } }, ...o })
interface NetOpts { tier?: number; me?: Rec; mates?: unknown[]; foes?: unknown[]; cover?: { ally: number[]; foe: number[] }; more?: Rec }
const net = (ids: string[], o: NetOpts = {}): Arena =>
  world({ features: NET_FEATURES, packs: [NET_PACK], allies: [netrunner(ids, o.tier ?? 3, o.me), ...(o.mates ?? [one({}, 2)])], foes: o.foes ?? [idle(), idle()], ...(o.cover ? { cover: o.cover } : {}), ...(o.more ? { more: o.more } : {}) })
const mods = (a: Arena, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = []) => a.run().mods(kind, a.battle.units[id]!, undefined, undefined, tags)
const ACTIVE = NET_ABILITIES.filter((x) => x.kind === 'active' || x.kind === 'stance').map((x) => x.id as string)

describe('潛網者樹「現實」欄：整棵樹寫得進現有的格式', () => {
  it('二十五個技能（樹上二十七個，現實欄是「—」的我不在家喔、深潛不用寫）載入都合格；每個主動技能與姿態都變成圓環上的行動', () => {
    const a = net(NET_ABILITIES.map((x) => x.id as string))
    expect(NET_ABILITIES).toHaveLength(25)
    const ids = ring(a)
    for (const id of ACTIVE) expect(ids, id).toContain(id)
    // 快駭程式照樣在圓環上（主控的標籤與甲板）
    expect(ids).toEqual(expect.arrayContaining(['hack.qh_noise', 'hack.qh_mark', 'hack.qh_relay']))
  })

  it('主控：裝著就有 quickhack 標籤；RAM 上限 +3、回復 +1（pool）；快駭檢定 +⌈樹階×⅔⌉（mods：by_tier）；共鳴 1 階再 +2', () => {
    const a = net([], { tier: 2 })
    expect(a.ally(1).tags).toContain('quickhack')
    expect(a.ally(1).pools.ram).toMatchObject({ max: 11, regen: 3 })
    const roll = rollsOf(cast(a, 'hack.qh_noise', U('f1')))[0]!
    expect(labelOf(roll, '主控')).toBe(2)
    expect(labelOf(roll, '主控的樹')).toBe(2)
    for (const [tier, plus] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 4]] as const) {
      const b = net([], { tier })
      expect(labelOf(rollsOf(cast(b, 'hack.qh_noise', U('f1')))[0]!, '主控'), `tier ${tier}`).toBe(plus)
    }
    // 沒有甲板時這一欄沒有效果：標籤給了，RAM 也被拿掉
    const c = net([], { me: { ext: { abilities: { equipped: ['sk_ctrl'], tiers: { netrunner: 3 } } } } })
    expect(c.ally(1).pools.ram).toBeUndefined()
    expect(ring(c).filter((x) => x.startsWith('hack.'))).toEqual([])
  })

  it('破冰：丟一個目標，到你的下一回合結束前全隊對他的快駭檢定 +2（buff 在目標身上掛 firewall −2）', () => {
    const a = net(['sk_ice'])
    const before = rollsOf(cast(a, 'hack.qh_noise', U('f1')))[0]!.dc
    cast(a, 'sk_ice', U('f1'))
    expect(a.ally(1).ap.now).toBe(6 - 1 - 1)
    // 破冰自己要 2 點 RAM
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 3 - 2)
    expect(mods(a, 'firewall', 'f1')).toEqual([expect.objectContaining({ label: '破冰', value: -2 })])
    // 隊友（a2）丟的快駭也吃到：我方整隊對他的 DC 少 2
    const mate = hacker(SLOTS)
    const b = net(['sk_ice'], { mates: [mate] })
    cast(b, 'sk_ice', U('f1'))
    expect(rollsOf(cast(b, 'hack.qh_noise', U('f1'), { user: 'a2' }))[0]!.dc).toBe(before - 2)
  })

  it('偷看是不行的喔：隊友被快駭時，這一次那個人的防火牆 +2（checked 的反應）；一回合一次、花 1 RAM', () => {
    const enemy = idle({ tags: ['quickhack'], skills: { interface: 3 }, pools: { ram: { now: 20, max: 20, regen: 2 } }, ap: { now: 9, max: 9, regen: 3 }, ext: { deck: deckOf(['qh_noise'], { grade: 2 }) } })
    const a = net(['sk_peek'], { foes: [enemy, idle()] })
    const dc = (u = 'a2') => rollsOf(cast(a, 'hack.qh_noise', U(u), { user: 'f1' }))[0]!.dc
    const base = a.ally(2).evade
    expect(dc()).toBe(base + 2)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 1)
    // 一回合一次
    expect(dc()).toBe(base)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 1)
    // 沒有裝這個技能：不加
    const b = net([], { foes: [enemy, idle()] })
    expect(rollsOf(cast(b, 'hack.qh_noise', U('a2'), { user: 'f1' }))[0]!.dc).toBe(base)
    // 丟程式的人自己的反應不會被自己的快駭觸發：我方的潛網者對敵人快駭時不會扣自己的 RAM
    const c = net(['sk_peek'])
    cast(c, 'hack.qh_noise', U('f1'))
    expect(c.ally(1).pools.ram!.now).toBe(RAM3 - 3)
  })

  it('偷看是不行的喔：你自己被快駭也算（trigger.who 的 self_or_ally）；一回合一次，隊友與自己合起來算', () => {
    const enemy = idle({ tags: ['quickhack'], skills: { interface: 3 }, pools: { ram: { now: 20, max: 20, regen: 2 } }, ap: { now: 9, max: 9, regen: 3 }, ext: { deck: deckOf(['qh_noise'], { grade: 2 }) } })
    const a = net(['sk_peek'], { foes: [enemy, idle()] })
    const dc = (u: string) => rollsOf(cast(a, 'hack.qh_noise', U(u), { user: 'f1' }))[0]!.dc
    // 我（a1）有甲板，防火牆是甲板的 12
    expect(dc('a1')).toBe(12 + 2)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 1)
    // 同一回合隊友被駭：已經用過了
    expect(dc('a2')).toBe(a.ally(2).evade)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 1)
    // 敵人被我方快駭：不觸發（敵方的人不是我的隊友）
    const b = net(['sk_peek'])
    cast(b, 'hack.qh_noise', U('f1'))
    expect(b.ally(1).pools.ram!.now).toBe(RAM3 - 3)
  })

  it('共鳴 3 階 RAM 上限 +1（effect.pool）、4 階感載上限 +4（effect.load_max）：照樹階；2 階以下都沒有', () => {
    const at = (tier: number) => {
      const a = net([], { tier })
      return { ram: a.ally(1).pools.ram!.max, now: a.ally(1).pools.ram!.now, load: a.ally(1).load!.max - a.ally(2).load!.max }
    }
    expect(at(2)).toEqual({ ram: 11, now: 11, load: 0 })
    expect(at(3)).toEqual({ ram: 12, now: 12, load: 0 })
    expect(at(4)).toEqual({ ram: 12, now: 12, load: 4 })
    expect(at(5)).toEqual({ ram: 12, now: 12, load: 4 })
    // 沒有甲板：RAM 整個沒有（共鳴的池也一樣被拿掉），感載上限照樣加
    const c = net([], { tier: 4, me: { ext: { abilities: { equipped: ['sk_ctrl'], tiers: { netrunner: 4 } } } } })
    expect(c.ally(1).pools.ram).toBeUndefined()
    expect(c.ally(1).load!.max - c.ally(2).load!.max).toBe(4)
  })

  it('接管：選接管（2 回合是我方的）或改寫敵我名單（不接管、它打自己人）；沒選不行', () => {
    const a = net(['sk_take'])
    const o = overlay(a)
    myTurn(a)
    const opt = defOf(a, 'sk_take').picks!(a.run(), a.ally(1))[0]!
    expect(opt.options.map((x) => x.value)).toEqual(['take', 'rewrite'])
    cast(a, 'sk_take', { overlay: o.id }, { pick: { way: 'take' } })
    expect(o).toMatchObject({ side: 'ally', owner: 'a1' })
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 3)
    const b = net(['sk_take'])
    const p = overlay(b)
    cast(b, 'sk_take', { overlay: p.id }, { pick: { way: 'rewrite' } })
    expect(p.side).toBe('foe')
    expect((p.ext as Rec).hack).toMatchObject({ taken: { mode: 'rewrite' } })
    expect(() => cast(b, 'sk_take', { overlay: p.id })).toThrow(BattleBlocked)
  })

  it('迴圈：神經快駭，持續型，每回合開始受 1d6＋1 感載，共 3 回合（hack.dot，公式在每次發作時擲）', () => {
    const a = net(['sk_loop'])
    cast(a, 'sk_loop', U('f1'))
    const f1 = a.foe(1)
    const loads: number[] = []
    for (const d of [3, 5, 1, 6]) {
      a.k.battle.emit('turn.start', { run: a.run(dice(d)), unit: f1 })
      loads.push(f1.load!.now)
    }
    expect(loads).toEqual([4, 10, 12, 12])
    // 對沒有橋的人灰掉（needs.bridged）
    const b = net(['sk_loop'], { foes: [idle({ load: undefined })] })
    expect(blocksFor(b, 'sk_loop', U('f1')).join()).toContain('要有橋')
  })

  it('頻寬：RAM 上限 +1（pool）', () => {
    const a = net(['sk_band'])
    expect(a.ally(1).pools.ram!.max).toBe(RAM3 + 1)
  })

  it('過熱：神經快駭 2d6 感載，另外他一件義體失效到他下一回合結束', () => {
    const a = net(['sk_heat'], { foes: [idle({ implants: [{ kind: 'eye', name: '義眼' }], cyber: 1 }), idle()] })
    cast(a, 'sk_heat', U('f1'), { d: dice(15, 3, 4) })
    expect(a.foe(1).load!.now).toBe(7)
    expect(a.foe(1).statuses.find((s) => s.id === 'off_generic')!.until).toMatchObject({ turns: 1 })
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 3)
  })

  it('靜默：姿態，開著時迴避 +1；開關各花 1 行動點', () => {
    const a = net(['sk_silent'])
    expect(mods(a, 'evade', 'a1')).toEqual([])
    cast(a, 'sk_silent', null)
    expect(a.ally(1).stance).toBe('sk_silent')
    expect(mods(a, 'evade', 'a1')).toEqual([expect.objectContaining({ value: 1 })])
    expect(a.ally(1).ap.now).toBe(5)
    cast(a, 'sk_silent', null)
    expect(a.ally(1).stance).toBeUndefined()
  })

  it('改寫地形：引爆視線內一件爆裂物（hack.detonate）；有控制節點時撤掉敵方一格的掩體、放下防爆門（when.node_taken）', () => {
    const NODES = { nodes: [{ kind: 'light', name: '電閘' }, { kind: 'door', name: '防爆門' }] }
    const a = net(['sk_rewrite'], { foes: [idle({ quick: [{ item: 'it_nade', qty: 1 }] }), idle()], cover: { ally: [0, 0, 0, 0], foe: [2, 2, 0, 0] }, more: NODES })
    cast(a, 'sk_rewrite', U('f1'), { pick: { way: 'boom' }, d: dice(15, 6, 6) })
    expect(a.foe(1).quick).toEqual([])
    expect(a.battle.cover.foe[0]!.level).toBe(1)
    // 撤掩體與放防爆門：節點還沒拿下時灰掉
    const pickOpts = () => defOf(a, 'sk_rewrite').picks!(a.run(), a.ally(1))[0]!.options
    expect(pickOpts().find((x) => x.value === 'strip')!.blocks.join()).toContain('控制節點')
    expect(pickOpts().find((x) => x.value === 'door')!.blocks.join()).toContain('控制節點')
    a.battle.nodes[0]!.taken = true
    a.battle.nodes[1]!.taken = true
    expect(pickOpts().every((x) => x.blocks.length === 0)).toBe(true)
    cast(a, 'sk_rewrite', U('f2'), { pick: { way: 'strip' } })
    expect(a.battle.cover.foe[1]!.level).toBe(1)
    cast(a, 'sk_rewrite', U('f2'), { pick: { way: 'door' } })
    expect(a.battle.cover.ally[0]!.level).toBe(1)
  })

  it('改寫地形：引爆的用法只對快取格裡有爆裂物的目標（needs.cache_tag）；沒有爆裂物的目標選不了、硬選被擋下；引爆掉之後那個目標也不適用了', () => {
    const a = net(['sk_rewrite'], { foes: [idle({ quick: [{ item: 'it_nade', qty: 1 }] }), idle({ quick: [{ item: 'it_gel', qty: 2 }] })] })
    const boom = () => defOf(a, 'sk_rewrite').picks!(a.run(), a.ally(1))[0]!.options.find((x) => x.value === 'boom')!
    expect(pickApplies(boom(), U('f1'))).toBe(true)
    // 凝膠不是爆裂物
    expect(pickApplies(boom(), U('f2'))).toBe(false)
    expect(() => cast(a, 'sk_rewrite', U('f2'), { pick: { way: 'boom' } })).toThrow(BattleBlocked)
    cast(a, 'sk_rewrite', U('f1'), { pick: { way: 'boom' }, d: dice(15, 6, 6) })
    expect(a.foe(1).quick).toEqual([])
    expect(pickApplies(boom(), U('f1'))).toBe(false)
  })

  it('盯～：神經快駭的檢定 +1（只有神經類）', () => {
    const a = net(['sk_focus'])
    expect(labelOf(rollsOf(cast(a, 'hack.qh_noise', U('f1')))[0]!, '盯～')).toBe(1)
    expect(labelOf(rollsOf(cast(a, 'hack.qh_relay', U('f1')))[0]!, '盯～')).toBeUndefined()
  })

  it('逆流：你過載時 RAM 回滿（pool 效果），下一回合照樣失去；每場一次', () => {
    const a = net(['sk_backflow'])
    a.ally(1).pools.ram!.now = 2
    a.run().addLoad(a.ally(1), 999, a.foe(1), { exact: true })
    expect(a.ally(1).pools.ram!.now).toBe(RAM3)
    expect(a.ally(1).statuses.some((s) => s.id === 'lose_turn')).toBe(true)
    a.ally(1).pools.ram!.now = 2
    a.run().addLoad(a.ally(1), 999, a.foe(1), { exact: true })
    expect(a.ally(1).pools.ram!.now).toBe(2)
  })

  it('灌頂：神經版 2d6＋2 感載；快感版 2d6 快感感載、沉溺 +2', () => {
    const a = net(['sk_inflow'])
    cast(a, 'sk_inflow', U('f1'), { pick: { way: 'neural' }, d: dice(15, 3, 4) })
    expect(a.foe(1).load!.now).toBe(9)
    const b = net(['sk_inflow'])
    cast(b, 'sk_inflow', U('f1'), { pick: { way: 'pleasure' }, d: dice(15, 3, 4) })
    expect(b.foe(1).load!.now).toBe(7)
    expect(b.foe(1).sink).toBeGreaterThanOrEqual(2)
    expect(() => cast(b, 'sk_inflow', U('f1'))).toThrow(BattleBlocked)
  })

  it('後門：預備，這件委託的下一場現實戰鬥你第一回合的第一個快駭不花行動點（action_ap，每場一次、只在第一回合）', () => {
    const a = net([], { me: { ext: { deck: deckOf(SLOTS), abilities: { equipped: ['sk_ctrl', 'sk_backdoor'], tiers: { netrunner: 3 }, brought: ['sk_backdoor'] } } } })
    const cost = (round = 1) => {
      a.battle.round = round
      const run = a.run()
      return actionCost(run, a.ally(1), defOf(a, 'hack.qh_noise')).ap
    }
    expect(cost()).toBe(0)
    expect(cost(2)).toBe(1)
    a.battle.round = 1
    cast(a, 'hack.qh_noise', U('f1'))
    expect(a.ally(1).ap.now).toBe(6)
    expect(cost(1)).toBe(1)
  })

  it('封鎖：關燈（全場黑暗）；控制節點在我方手上時另外放下一道防爆門、我方一格補一級遮蔽；每場一次', () => {
    const a = net(['sk_lockdown'], { more: { nodes: [{ kind: 'door', name: '防爆門' }] } })
    const pickOpts = () => defOf(a, 'sk_lockdown').picks!(a.run(), a.ally(1))[0]!.options
    expect(pickOpts().find((x) => x.value === 'door')!.blocks.join()).toContain('控制節點')
    cast(a, 'sk_lockdown', null, { pick: { way: 'dark' } })
    expect(a.battle.field.dark).toBe(true)
    expect(blocksOf(a, 'sk_lockdown').join()).toContain('這一場已經用過了')
    const b = net(['sk_lockdown'], { more: { nodes: [{ kind: 'door', name: '防爆門' }] } })
    b.battle.nodes[0]!.taken = true
    cast(b, 'sk_lockdown', null, { pick: { way: 'door' } })
    expect(b.battle.field.dark).toBe(true)
    expect(b.battle.cover.ally[0]!.level).toBe(1)
  })

  it('謝謝招待：你讓目標過載時回 1 RAM，每回合一次', () => {
    const a = net(['sk_thanks'], { foes: [idle({ load: { now: 20, max: 22 } }), idle({ load: { now: 20, max: 22 } })] })
    cast(a, 'hack.qh_noise', U('f1'))
    expect(a.foe(1).layers).toBe(1)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 3 + 1)
    cast(a, 'hack.qh_noise', U('f2'))
    expect(a.foe(2).layers).toBe(1)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 3 + 1 - 3)
  })

  it('值機：姿態，開著時裝置類快駭的檢定 +2（只有裝置類）', () => {
    const a = net(['sk_mutex'])
    expect(labelOf(rollsOf(cast(a, 'hack.qh_relay', U('f1')))[0]!, '值機')).toBeUndefined()
    cast(a, 'sk_mutex', null)
    expect(labelOf(rollsOf(cast(a, 'hack.qh_relay', U('f1')))[0]!, '值機')).toBe(2)
    expect(labelOf(rollsOf(cast(a, 'hack.qh_noise', U('f1')))[0]!, '值機')).toBeUndefined()
  })

  it('傀儡：有標記的目標，少 1 點行動點並被推一格；或定住他；沒有標記灰掉；打首領 DC +4', () => {
    const marked = { id: 'marked', until: { at: 'battle_end' } }
    const mk = (o: Rec = {}) => idle({ statuses: [marked], ap: { now: 3, max: 3, regen: 0 }, ...o })
    const a = net(['sk_puppet'], { tier: 4, foes: [mk(), idle()] })
    expect(blocksFor(a, 'sk_puppet', U('f2')).join()).toContain('標記')
    cast(a, 'sk_puppet', U('f1'), { pick: { way: 'jerk' } })
    expect(a.foe(1).ap.now).toBe(2)
    expect(a.foe(1).slot).toBe(2)
    const b = net(['sk_puppet'], { tier: 4, foes: [mk()] })
    cast(b, 'sk_puppet', U('f1'), { pick: { way: 'pin' } })
    expect(b.foe(1).statuses.some((s) => s.id === 'pinned')).toBe(true)
    expect(b.run().cannotMove(b.foe(1))).toBe(true)
    const c = net(['sk_puppet'], { tier: 4, foes: [mk({ rank: 'boss' })] })
    c.foe(1).rank = 'boss'
    expect(rollsOf(cast(c, 'sk_puppet', U('f1'), { pick: { way: 'pin' } }))[0]!.dc).toBe(c.foe(1).evade + 4)
  })

  it('看錯人囉：一名隊友（含自己）的迴避 +2，到你的下一回合開始（buff）', () => {
    const a = net(['sk_mirror'], { tier: 4 })
    cast(a, 'sk_mirror', U('a2'))
    expect(mods(a, 'evade', 'a2')).toEqual([expect.objectContaining({ label: '看錯人囉', value: 2 })])
    expect(mods(a, 'evade', 'a1')).toEqual([])
    cast(a, 'sk_mirror', U('a1'))
    expect(mods(a, 'evade', 'a1')).toEqual([expect.objectContaining({ value: 2 })])
  })

  it('多工：每回合你的第一個快駭不花行動點（action_ap，per_turn）', () => {
    const a = net(['sk_multi'], { tier: 4 })
    cast(a, 'hack.qh_noise', U('f1'))
    expect(a.ally(1).ap.now).toBe(6)
    cast(a, 'hack.qh_noise', U('f1'))
    expect(a.ally(1).ap.now).toBe(5)
  })

  it('群播：敵方整排有橋的人，下一回合各少 1 點行動點；沒有橋的不受影響；每場一次', () => {
    const three = [idle({ ap: { now: 3, max: 3, regen: 0 } }), idle({ ap: { now: 3, max: 3, regen: 0 }, load: undefined }), idle({ ap: { now: 3, max: 3, regen: 0 } })]
    const a = net(['sk_cast'], { tier: 4, foes: three })
    cast(a, 'sk_cast', null)
    expect([a.foe(1).ap.now, a.foe(2).ap.now, a.foe(3).ap.now]).toEqual([2, 3, 2])
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 6)
    expect(blocksOf(a, 'sk_cast').join()).toContain('這一場已經用過了')
  })

  it('不讓你帶走：任何一格的隊友即將被制伏時，這次制伏自動失敗（out_before 的 prevent）；1 RAM、每場一次', () => {
    const a = net(['sk_noleave'], { tier: 4 })
    const run = a.run()
    expect(run.setOut(a.ally(2), 'subdued', a.foe(1))).toBe(false)
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 1)
    expect(run.setOut(a.ally(2), 'subdued', a.foe(1))).toBe(true)
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 1)
    // 倒下不在它擋的範圍裡
    const b = net(['sk_noleave'], { tier: 4 })
    expect(b.run().setOut(b.ally(2), 'down', b.foe(1))).toBe(true)
    expect(b.ally(1).pools.ram!.now).toBe(RAM3)
  })

  it('黑冰：手上全部 RAM（至少 5）、每花 1 點 RAM 擲一顆 d6 感載（ram_all_min、spentd6）；每場一次', () => {
    const a = net(['sk_black'], { tier: 5, foes: [foe('elite', quiet as never), idle()] })
    a.ally(1).pools.ram!.now = 6
    cast(a, 'sk_black', U('f1'), { d: dice(15, 3, 3, 3, 3, 3, 3) })
    expect(a.ally(1).pools.ram!.now).toBe(0)
    expect(a.foe(1).load!.now).toBe(18)
    const b = net(['sk_black'], { tier: 5 })
    b.ally(1).pools.ram!.now = 4
    expect(blocksOf(b, 'sk_black').join()).toContain('5 點以上的 RAM')
    expect(blocksOf(a, 'sk_black').join()).toContain('已經用過')
  })

  it('備份：我方整排的迴避 +1 到你的下一回合開始，並且每個人解除一個狀態（壓制、干擾或標記）', () => {
    const a = net(['sk_backup'], { tier: 5, mates: [one({ statuses: [{ id: 'suppressed', until: { at: 'battle_end' } }, { id: 'jammed', until: { at: 'battle_end' } }] }, 2)] })
    cast(a, 'sk_backup', null)
    expect(mods(a, 'evade', 'a1')).toEqual([expect.objectContaining({ value: 1 })])
    expect(mods(a, 'evade', 'a2')).toEqual([expect.objectContaining({ value: 1 })])
    expect(a.ally(2).statuses.map((s) => s.id)).toEqual(['jammed'])
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 6)
  })

  it('管理員：控制節點在我方手上時，關燈、敵方整排的遮蔽降一級、敵方每一台砲塔或無人機到戰鬥結束都是我方的（who: foe_overlays）；沒有節點灰掉；不必先選一台', () => {
    const a = net(['sk_admin'], { tier: 5, cover: { ally: [0, 0, 0, 0], foe: [1, 1, 0, 0] }, more: { nodes: [{ kind: 'light' }] } })
    const o = overlay(a)
    expect(blocksOf(a, 'sk_admin').join()).toContain('控制節點')
    a.battle.nodes[0]!.taken = true
    expect(blocksOf(a, 'sk_admin')).toEqual([])
    cast(a, 'sk_admin', null)
    expect(a.battle.field.dark).toBe(true)
    expect(a.battle.cover.foe.slice(0, 2).map((c) => c.level)).toEqual([0, 0])
    expect(o).toMatchObject({ side: 'ally', owner: 'a1' })
    expect(((o.ext as Rec).hack as { taken: { left: unknown } }).taken.left).toBeNull()
  })

  it('管理員：場上沒有敵方的東西也用得了（關燈、降遮蔽照做）；有兩台就兩台都接管（我方那一格掛著的接管不了）', () => {
    const none = net(['sk_admin'], { tier: 5, cover: { ally: [0, 0, 0, 0], foe: [1, 1, 0, 0] }, more: { nodes: [{ kind: 'light' }] } })
    none.battle.nodes[0]!.taken = true
    cast(none, 'sk_admin', null)
    expect(none.battle.field.dark).toBe(true)
    expect(none.battle.cover.foe.slice(0, 2).map((c) => c.level)).toEqual([0, 0])
    const two = net(['sk_admin'], { tier: 5, more: { nodes: [{ kind: 'light' }] } })
    two.battle.nodes[0]!.taken = true
    const [o1, o2] = [overlay(two, { slot: 1 }), overlay(two, { slot: 2 })]
    two.run().addOverlay({ side: 'ally', slot: 2, owner: 'a1', kind: 'attack', name: '我的無人機', hp: { now: 10, max: 10 }, armor: 0, evade: 0 })
    cast(two, 'sk_admin', null)
    expect(o1).toMatchObject({ side: 'ally', owner: 'a1' })
    expect(o2.side).toBe('foe')
  })

  it('根權限：每回合你的第一個快駭 RAM −1（最低 1；action_ram，per_turn）', () => {
    const a = net(['sk_root'], { tier: 5 })
    // 樹階 5、甲板 III：跑 III 級，白噪 3 點 RAM → 2 點；第二個照原價
    expect(actionCost(a.run(), a.ally(1), defOf(a, 'hack.qh_noise')).ram).toBe(2)
    cast(a, 'hack.qh_noise', U('f1'))
    expect(a.ally(1).pools.ram!.now).toBe(RAM3 - 2)
    expect(actionCost(a.run(), a.ally(1), defOf(a, 'hack.qh_noise')).ram).toBe(3)
    // 支援類本來只花 1 點：最少還是 1
    expect(actionCost(net(['sk_root']).run(), net(['sk_root']).ally(1), defOf(net(['sk_root']), 'hack.qh_mark')).ram).toBe(1)
  })
})
