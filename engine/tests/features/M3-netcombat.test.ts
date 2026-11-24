// 驗收測試：dev/work/M3-netcombat.md（cpp-feature）。features/netcombat：內海的行動表（攻擊、近戰、回填、換構裝、腳本、工具構裝、打牆、監視、換檔）、
// 同步檔位在戰鬥裡的效果、構裝的進階與終極、干擾與破損。
// 規格：CYBERSPACE 6.1～6.5 節、4.1 節；CORE_RULES 第 5 節；ITEMS 11.1、11.4 節；dev/adr/0018 第一、二節與 N4、N11、N25；dev/adr/0014（行動的宣告）。
// 單位用 from: 'unit' 直接給（unit.ext.deck.constructs 與武器寫在測試裡）；另一組和 deckFeature 一起裝，用角色進場。內容都是測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOptions, BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel } from '../../src'
import { BattleBlocked, BattleRun, END_TURN, MOVE, battleAct, battleOptions, beginTurn, clone, createKernel, endBattle, performAction, readyFeatures, setupBattle } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { characterFeature } from '../../src/features/character'
import { deckFeature, equipDraft, installDraft, scriptsDraft } from '../../src/features/deck'
import { DEFAULT_NETCOMBAT_RULES, netBattleView, netcombatFeature, netcombatRules } from '../../src/features/netcombat'
import { BATTLE_SETUPS, commitViolations, fixDice, laceUnit, makeGame, makeState, netAvatar, netWeapon, playOut, stateHash } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 假資料 ----

const STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' },
  { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
  { id: 'sync', name: '同步', attr: 'resolve', desc: '同步。' },
]
const WEAPON_CLASSES = [
  { id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' },
  { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]
const ITEM = (id: string, o: Rec = {}) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...o })
const cs = (id: string, cls: string, o: Rec = {}) => ({ id, class: cls, name: id, grade: 1, legal: 'free', ...o })
const SELF_RAM = (n: number) => ({ op: 'net.ram', amount: n, who: 'self' })

const PACK: ContentPack = {
  id: 'netcombat_test',
  content: {
    battle_status: STATUSES,
    skill: SKILLS,
    weapon_class: WEAPON_CLASSES,
    deck: [{ id: 'dk_ii', name: '二級甲板', desc: '二級甲板。', grade: 2, slots: 6, firewall: 12, legal: 'free', ram: { max: 2, regen: 1 } }],
    construct: [
      cs('cs_rifle_3', 'weapon', { name: '夜巡', grade: 3, archetype: 'rifle', type: 'neural', ram: 1, advanced: { mods: { hit: 2 } }, ultimate: { mods: { damage: 3 } } }),
      cs('cs_blade', 'weapon', { name: '光刃', archetype: 'melee', type: 'neural', ram: 1 }),
      cs('cs_jam', 'weapon', { name: '靜電', archetype: 'pistol', type: 'jam', ram: 1 }),
      cs('cs_guard_4', 'defense', { name: '客服窗', guard: 4 }),
      cs('cs_guard_2', 'defense', { name: '散熱罩', guard: 2 }),
      cs('cs_cooler', 'tool', { name: '冷卻扇', grade: 3, ap: 1, ram: 1, target: 'none', do: [SELF_RAM(2)], advanced: { do: [SELF_RAM(1)] }, ultimate: { do: [SELF_RAM(1)] } }),
      cs('cs_drain', 'tool', { name: '抽乾', ap: 2, ram: 2, target: 'foe', do: [{ op: 'net.ram', amount: -2, who: 'target' }] }),
      cs('cs_pass', 'tool', { name: '回填器', ap: 0, ram: 0, passive: true, mods: { evade: 2 } }),
    ],
    item: [ITEM('it_ramscript', { name: '回填包', tags: ['script'], use: { ap: 1, target: 'self', effects: [SELF_RAM(3)] } })],
  },
} as unknown as ContentPack

/** 測試自己的修正：標籤 t.refill 的人回填多 1、t.cap 的人檔位上限 +1、t.shifts 的人每回合可以換兩次。 */
const MODS: Feature = {
  id: 'netcombat_test_mods',
  install(k) {
    k.battle.modifier('netcombat_test_mods', (q) => {
      if (q.kind === 'refill' && q.unit.tags.includes('t.refill')) return [{ label: '測試', value: 1 }]
      if (q.kind === 'sync_cap' && q.unit.tags.includes('t.cap')) return [{ label: '測試', value: 1 }]
      if (q.kind === 'sync_shifts' && q.unit.tags.includes('t.shifts')) return [{ label: '測試', value: 1 }]
      return []
    })
  },
}

const FEATURES = [deckFeature, netcombatFeature, MODS]

// ---- 單位 ----

const DECK = (constructs: Array<{ id: string; class: string; grade?: number }> = []) => ({ grade: 2, firewall: 12, slots: [] as string[], constructs: constructs.map((c) => ({ grade: 1, ...c })) })
const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], ...o })
/** 構裝的武器：命中給得很高（不靠骰面），固定傷害 0。 */
const gun = (id = 'cs_rifle_3', o: Rec = {}) => netWeapon(30, 4, { id, name: id, class: 'rifle', traits: ['long'], range: [1, 7], ...o })
const blade = (id = 'cs_blade', o: Rec = {}) => netWeapon(30, 3, { id, name: id, class: 'melee', traits: ['melee'], range: [1, 1], coverMult: 0, ...o })
const ally = (i: number, o: Rec = {}) => netAvatar(i, 1, { weapons: [gun()], ext: { net: NET(), deck: DECK() }, ...o } as never)
const lace = (rank: 'minion' | 'elite' | 'boss' = 'minion', o: Rec = {}) => laceUnit(rank, 1, { ext: { net: NET(), deck: DECK() }, ...o } as never)
const raw = (u: unknown, slot?: number) => ({ from: 'unit', unit: u as Rec, ...(slot ? { slot } : {}) })
const setup = (allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup => ({ mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), ...more }) as BattleSetup

// ---- 不經過提交的戰鬥（直接動 BattleRun） ----

interface Arena {
  k: Kernel
  state: GameState
  battle: ReturnType<typeof setupBattle>['battle']
  run(dice?: number[]): BattleRun
  a(i: number): BattleUnit
  f(i: number): BattleUnit
}

function arena(s: BattleSetup, o: { features?: Feature[]; packs?: ContentPack[]; pc?: Rec } = {}): Arena {
  const k = createKernel(o.features ?? [...FEATURES, combatFeature])
  for (const p of o.packs ?? [PACK]) k.content.loadPack(p)
  readyFeatures(k)
  const state = makeState(o.pc ? { pc: o.pc as never } : {})
  const battle = clone(setupBattle(k, state, s).battle)
  state.battle = battle
  return {
    k, state, battle,
    run: (dice) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)),
    a: (i) => battle.units[`a${i}`]!,
    f: (i) => battle.units[`f${i}`]!,
  }
}

/** 把回合轉到某個人，行動點補滿（直接改狀態）。 */
const turnTo = (a: Arena, id: string): BattleUnit => {
  const b = a.battle
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const options = (a: Arena): BattleOptions => battleOptions(a.k, a.state)!
const opt = (a: Arena, id: string) => options(a).actions.find((x) => x.id === id)!
/** 做一個行動（純算）：成立就把新的戰鬥狀態放回去，回傳新的單位；不成立回傳原因。 */
const act = (a: Arena, input: BattleInput): { reasons: string[] } | { ok: true } => {
  try {
    const draft = battleAct(a.k, a.state, input)
    const change = draft.changes.find((c) => c.op === 'battle') as unknown as { state: Arena['battle'] }
    a.state.battle = change.state
    Object.assign(a, { battle: change.state })
    return { ok: true }
  } catch (e) {
    if (e instanceof BattleBlocked) return { reasons: e.reasons }
    throw e
  }
}
const unitOf = (a: Arena, id: string): BattleUnit => a.state.battle!.units[id]!
/** 用 run 直接做一個行動（骰面釘死；花費照核心扣）。 */
const doAct = (a: Arena, who: string, input: BattleInput, dice?: number[]): BattleRun => {
  const run = a.run(dice)
  const u = run.unit(who)
  const def = a.k.battle.getAction(input.action)!
  performAction(run, u, def, input.target ?? null, input)
  run.settle()
  return run
}
const defOf = (a: Arena, id: string) => a.k.battle.getAction(id)!
const sumOf = (parts: Array<{ value: number }>): number => parts.reduce((s, p) => s + p.value, 0)

// ---- 一、行動表 ----

describe('內海的行動表（CYBERSPACE 6.3 節）', () => {
  it('內海戰鬥的圓環有表上的九種（工具照裝著的數量），沒有任何現實的行動；現實戰鬥沒有它們', () => {
    const a = arena(setup([ally(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_cooler', class: 'tool' }, { id: 'cs_drain', class: 'tool' }, { id: 'cs_pass', class: 'tool' }]) } })], [lace()]))
    turnTo(a, 'a1')
    const ids = options(a).actions.map((x) => x.id).sort()
    expect(ids).toEqual([END_TURN, MOVE, 'net_attack', 'net_melee', 'net_refill', 'net_swap', 'net_script', 'net_tool:cs_cooler', 'net_tool:cs_drain', 'net_hit_wall', 'net_watch', 'net_shift'].sort())
    // 被動的工具構裝不是行動；沒裝著的工具沒有行動
    expect(ids).not.toContain('net_tool:cs_pass')
    const bare = arena(setup([ally(1)], [lace()]))
    turnTo(bare, 'a1')
    expect(options(bare).actions.some((x) => x.id.startsWith('net_tool:'))).toBe(false)
    // 現實的行動一個都沒有
    for (const id of ['shoot', 'melee', 'reload', 'swap', 'item', 'hit_cover', 'watch', 'subdue', 'flee', 'surrender']) expect(ids, id).not.toContain(id)
    for (const d of bare.k.battle.actionsFor('net')) expect([END_TURN, MOVE].includes(d.id) || d.id.startsWith('net_'), d.id).toBe(true)
    // 現實戰鬥沒有 net_ 開頭的行動
    expect(bare.k.battle.actionsFor('meat').filter((d) => d.id.startsWith('net_'))).toEqual([])
  })

  it('每個行動都寫了圖示；九種各在自己的圈', () => {
    const a = arena(setup([ally(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_cooler', class: 'tool' }]) } })], [lace()]))
    turnTo(a, 'a1')
    const by = Object.fromEntries(options(a).actions.map((x) => [x.id, x]))
    expect(Object.fromEntries(Object.entries(by).map(([id, x]) => [id, x.group]))).toMatchObject({
      net_attack: 'attack', net_melee: 'attack', net_refill: 'supply', net_swap: 'supply', net_script: 'supply', 'net_tool:cs_cooler': 'skill', net_hit_wall: 'tactic', net_watch: 'tactic', net_shift: 'system',
    })
    for (const x of Object.values(by)) expect(x.icon, x.id).toBeTruthy()
    expect(by.net_attack!.icon).toBe('shoot')
    expect(by.net_melee!.icon).toBe('melee')
  })

  it('攻擊花 2 行動點與武器寫的 RAM；重型 2 點 RAM；狙擊型的那一把花 3 點行動點', () => {
    const a = arena(setup([ally(1, { weapons: [gun('g1'), gun('heavy', { pool: { ram: 2 } }), gun('sniper', { ap: 3 })] })], [lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'net_attack').cost).toEqual({ ap: 2, ram: 1 })
    a.a(1).wield = 1
    expect(opt(a, 'net_attack').cost).toEqual({ ap: 2, ram: 2 })
    a.a(1).wield = 2
    expect(opt(a, 'net_attack').cost).toEqual({ ap: 3, ram: 1 })
    // 照規則表：資料可以改基本的行動點
    expect(netcombatRules(a.k).ap).toEqual(DEFAULT_NETCOMBAT_RULES.ap)
  })

  it('攻擊：打出去的是感載（沒有生命）、RAM 與行動點照扣；RAM 不夠時灰掉並有原因', () => {
    const a = arena(setup([ally(1)], [lace()]))
    turnTo(a, 'a1')
    const ram = a.a(1).pools.ram!.now
    const ap = a.a(1).ap.now
    const r = act(a, { action: 'net_attack', target: { unit: 'f1' } })
    expect(r).toEqual({ ok: true })
    expect(unitOf(a, 'a1').pools.ram!.now).toBe(ram - 1)
    expect(unitOf(a, 'a1').ap.now).toBe(ap - 2)
    unitOf(a, 'a1').pools.ram!.now = 0
    const o = opt(a, 'net_attack')
    expect(o.ok).toBe(false)
    expect(o.blocks.join('')).toContain('RAM 不夠')
  })

  it('沒有武器構裝的人兩個攻擊行動都做不了（原因一句）；手上是近戰時攻擊做不了、近戰只能打近身', () => {
    const none = arena(setup([ally(1, { weapons: [] })], [lace()]))
    turnTo(none, 'a1')
    for (const id of ['net_attack', 'net_melee', 'net_hit_wall']) {
      const o = opt(none, id)
      expect(o.ok, id).toBe(false)
      expect(o.blocks[0], id).toBe('手上沒有武器構裝。')
    }
    expect(opt(none, 'net_attack').blocks).toEqual(['手上沒有武器構裝。'])
    expect(opt(none, 'net_melee').blocks).toEqual(['手上沒有武器構裝。'])
    const m = arena(setup([ally(1, { weapons: [blade()] })], [lace('minion'), lace('minion'), lace('minion')]))
    turnTo(m, 'a1')
    expect(opt(m, 'net_attack').ok).toBe(false)
    expect(opt(m, 'net_attack').blocks[0]).toContain('近戰')
    const melee = opt(m, 'net_melee')
    expect(melee.ok).toBe(true)
    expect(melee.cost).toEqual({ ap: 2, ram: 1 })
    expect(melee.targets.map((t) => [(t.target as { unit: string }).unit, t.blocks.length])).toEqual([['f1', 0], ['f2', 1], ['f3', 1]])
    expect(melee.targets[1]!.blocks[0]).toContain('近身')
    // 遠程的那一把做不了近戰
    const far = arena(setup([ally(1)], [lace()]))
    turnTo(far, 'a1')
    expect(opt(far, 'net_melee').ok).toBe(false)
    // 標籤：兩個攻擊行動都是用手上的武器攻擊一次
    expect(defOf(far, 'net_attack').tags).toContain('weapon_attack')
    expect(defOf(far, 'net_melee').tags).toContain('weapon_attack')
  })

  it('回填 +2；有 refill +1 的修正時 +3；不超過上限；滿的時候做不了', () => {
    const a = arena(setup([ally(1), ally(2, { tags: ['netrunner', 't.refill'] })], [lace()]))
    for (const id of ['a1', 'a2']) a.battle.units[id]!.pools.ram!.now = 1
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'net_refill' })
    expect(a.a(1).pools.ram!.now).toBe(3)
    doAct(a, 'a2', { action: 'net_refill' })
    expect(a.a(2).pools.ram!.now).toBe(4)
    a.a(2).pools.ram!.now = a.a(2).pools.ram!.max - 1
    doAct(a, 'a2', { action: 'net_refill' })
    expect(a.a(2).pools.ram!.now).toBe(a.a(2).pools.ram!.max)
    turnTo(a, 'a2')
    const o = opt(a, 'net_refill')
    expect(o.ok).toBe(false)
    expect(o.blocks).toEqual(['RAM 是滿的。'])
    expect(o.cost).toEqual({ ap: 1 })
  })

  it('換構裝：列出每一把並標出現在拿著的；不指定換到下一把', () => {
    const a = arena(setup([ally(1, { weapons: [gun('g1'), blade('g2'), gun('g3')] })], [lace()]))
    turnTo(a, 'a1')
    const o = opt(a, 'net_swap')
    expect(o.cost).toEqual({ ap: 1 })
    expect(o.picks[0]!.options.map((x) => [x.value, x.blocks.length])).toEqual([[0, 1], [1, 0], [2, 0]])
    expect(act(a, { action: 'net_swap', pick: { weapon: 2 } })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').wield).toBe(2)
    expect(act(a, { action: 'net_swap' })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').wield).toBe(0)
    const one = arena(setup([ally(1)], [lace()]))
    turnTo(one, 'a1')
    expect(opt(one, 'net_swap').blocks).toEqual(['只有一個武器構裝。'])
  })

  it('腳本：用快取格裡的一支，行動點 1、不花 RAM，用掉就沒了；沒有腳本時灰掉', () => {
    const none = arena(setup([ally(1)], [lace()]))
    turnTo(none, 'a1')
    expect(opt(none, 'net_script').ok).toBe(false)
    expect(opt(none, 'net_script').blocks[0]).toContain('腳本')
    const a = arena(setup([ally(1, { quick: [{ item: 'it_ramscript', qty: 2 }] })], [lace()]))
    turnTo(a, 'a1')
    a.a(1).pools.ram!.now = 1
    const o = opt(a, 'net_script')
    expect(o.ok).toBe(true)
    expect(o.cost).toEqual({ ap: 1 })
    expect(o.targets.map((t) => t.target)).toEqual([{ unit: 'a1' }])
    expect(act(a, { action: 'net_script', target: { unit: 'a1' } })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').pools.ram!.now).toBe(4)
    expect(unitOf(a, 'a1').quick).toEqual([{ item: 'it_ramscript', qty: 1 }])
  })

  it('工具構裝：每個裝著、不是被動的各一個行動，行動點與 RAM 照構裝寫的，效果是構裝的 do；對一個敵人用的列出目標', () => {
    const a = arena(setup([ally(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_cooler', class: 'tool' }, { id: 'cs_drain', class: 'tool' }]) } })], [lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'net_tool:cs_cooler').cost).toEqual({ ap: 1, ram: 1 })
    expect(opt(a, 'net_tool:cs_drain').cost).toEqual({ ap: 2, ram: 2 })
    expect(opt(a, 'net_tool:cs_drain').target).toBe('foe')
    expect(opt(a, 'net_tool:cs_drain').targets.map((t) => t.target)).toEqual([{ unit: 'f1' }])
    a.a(1).pools.ram!.now = 2
    expect(act(a, { action: 'net_tool:cs_cooler' })).toEqual({ ok: true })
    // 標準檔：花 1 點 RAM，do 回 2 點
    expect(unitOf(a, 'a1').pools.ram!.now).toBe(2 - 1 + 2)
    const f = unitOf(a, 'f1').pools.ram!.now
    expect(act(a, { action: 'net_tool:cs_drain', target: { unit: 'f1' } })).toEqual({ ok: true })
    expect(unitOf(a, 'f1').pools.ram!.now).toBe(f - 2)
  })

  it('打牆：2 行動點加武器的 RAM，打敵方一格的防火牆；沒有防火牆的格子不能選；干擾的武器倍率再 ×2', () => {
    const cover = { ally: [0, 0, 0, 0], foe: [2, 1, 0, 0] }
    const a = arena(setup([ally(1)], [lace(), lace()], { cover }))
    turnTo(a, 'a1')
    const o = opt(a, 'net_hit_wall')
    expect(o.cost).toEqual({ ap: 2, ram: 1 })
    expect(o.targets.map((t) => t.target)).toEqual([{ side: 'foe', slot: 1 }, { side: 'foe', slot: 2 }])
    // 骰面釘死：4 顆 d6 都是 3（12），遮蔽倍率 max(1, 0.5 × 2) = 1
    const hp1 = a.battle.cover.foe[0]!.hp
    doAct(a, 'a1', { action: 'net_hit_wall', target: { side: 'foe', slot: 1 } }, [3, 3, 3, 3])
    expect(a.battle.cover.foe[0]!.hp).toBe(hp1 - 12)
    // 干擾的武器：×2
    const j = arena(setup([ally(1, { weapons: [gun('cs_jam', { traits: ['jam'] })] })], [lace(), lace()], { cover }))
    const hp2 = j.battle.cover.foe[0]!.hp
    doAct(j, 'a1', { action: 'net_hit_wall', target: { side: 'foe', slot: 1 } }, [3, 3, 3, 3])
    expect(j.battle.cover.foe[0]!.hp).toBe(hp2 - 24)
    // 近戰的構裝打不了牆
    const m = arena(setup([ally(1, { weapons: [blade()] })], [lace()], { cover }))
    turnTo(m, 'a1')
    expect(opt(m, 'net_hit_wall').ok).toBe(false)
  })

  it('每個行動的 blocks 是一條一個條件、是完整的句子', () => {
    const a = arena(setup([ally(1, { weapons: [blade()], pools: { ram: { now: 0, max: 5, regen: 2 } } })], [lace()]))
    turnTo(a, 'a1')
    a.a(1).watch = { action: 'net_melee' }
    for (const x of options(a).actions) for (const why of x.blocks) expect(why, x.id).toMatch(/[。）]$/)
    expect(opt(a, 'net_watch').blocks).toEqual(['已經在監視了。'])
  })

  it('AI 的打分：攻擊照現實的攻擊（基準 2、命中率低於 35% 時 1）；RAM 不夠攻擊時回填 3 分、夠的時候不列', () => {
    const a = arena(setup([ally(1)], [lace()]))
    const run = a.run()
    const t = run.unit('f1')
    const me = run.unit('a1')
    expect(defOf(a, 'net_attack').aiScore!(run, me, t)).toBe(run.hitChance(me, t) < 35 ? 1 : 2)
    expect(defOf(a, 'net_refill').aiScore!(run, me, null)).toBeNull()
    me.pools.ram!.now = 0
    expect(defOf(a, 'net_refill').aiScore!(run, me, null)).toBe(3)
    // 命中率很低時分數 1
    me.weapons[0]!.hit = -30
    expect(defOf(a, 'net_attack').aiScore!(run, me, t)).toBe(1)
  })
})

// ---- 二、同步檔位 ----

describe('同步檔位（CYBERSPACE 6.4 節；CORE_RULES 第 5 節；N4）', () => {
  const withGear = (gear: string, o: Rec = {}) => ally(1, { ext: { net: NET({ sync: gear }), deck: DECK() }, tags: ['netrunner', `sync:${gear}`], ...o })

  it('單位組好時有 ext.net 與 sync:<檔> 標籤：標準檔起始；敵人已經帶著的不蓋', () => {
    const a = arena(setup([ally(1, { ext: { deck: DECK() }, tags: ['netrunner'] })], [lace('elite', { ext: { net: { sync: 'deep', sync_max: 'deep', broken: [], admin: 2 }, deck: DECK() } })]))
    expect(a.a(1).ext.net).toEqual({ sync: 'standard', sync_max: 'standard', broken: [] })
    expect(a.a(1).tags).toContain('sync:standard')
    expect(a.f(1).ext.net).toEqual({ sync: 'deep', sync_max: 'deep', broken: [], admin: 2 })
    expect(a.f(1).tags.filter((t) => t.startsWith('sync:'))).toEqual(['sync:deep'])
    // 技能的功能先寫了 admin：合併，不蓋掉
    const b = arena(setup([ally(1, { ext: { net: { admin: 3 }, deck: DECK() } })], [lace()]))
    expect(b.a(1).ext.net).toEqual({ admin: 3, sync: 'standard', sync_max: 'standard', broken: [] })
  })

  it('命中的合計：淺、標準、深、全差 −2、0、+2、+4（迴避不加減）', () => {
    const totals: number[] = []
    const evades: number[] = []
    for (const gear of ['shallow', 'standard', 'deep', 'full']) {
      const a = arena(setup([withGear(gear)], [lace()]))
      const run = a.run()
      totals.push(sumOf(run.hitParts(a.a(1), a.f(1), a.a(1).weapons[0]!)))
      evades.push(run.evadeOf(a.a(1)).total)
      // 同一個骰面：自然 10 的那一擊，總和照樣差那麼多
      const r = a.run().attack(a.a(1), a.f(1), { natural: 10, spend: 0 })
      expect(r.total - totals[totals.length - 1]!).toBe(10)
    }
    expect(totals.map((t) => t - totals[1]!)).toEqual([-2, 0, 2, 4])
    expect(new Set(evades).size).toBe(1)
  })

  it('自己擲的檢定（豁免）也照那一檔加減；別人對他擲的不看他的檔位', () => {
    const checks: number[] = []
    for (const gear of ['shallow', 'standard', 'deep', 'full']) {
      const a = arena(setup([withGear(gear)], [lace()]))
      checks.push(sumOf(a.run().mods('save', a.a(1))))
    }
    expect(checks).toEqual([-2, 0, 2, 4])
  })

  it('同一份原始感載（先扣防護再乘）：受到的是 ×0.5、×1、×1.5、×2.5', () => {
    const got: number[] = []
    for (const gear of ['shallow', 'standard', 'deep', 'full']) {
      const a = arena(setup([withGear(gear, { armor: 2, load: { now: 0, max: 200 } })], [lace()]))
      const run = a.run()
      run.damage(a.a(1), 20, 'neural', a.f(1))
      got.push(a.a(1).load!.now)
    }
    // (20 − 防護 2) = 18，再乘檔位
    expect(got).toEqual([9, 18, 27, 45])
  })

  it('全檔的人每回合多回 1 點行動點；過載時沉溺 +2（其他檔不加）', () => {
    const ap: number[] = []
    const sink: number[] = []
    for (const gear of ['shallow', 'standard', 'deep', 'full']) {
      const a = arena(setup([withGear(gear)], [lace()]))
      const u = a.a(1)
      u.uses.turns = 1
      u.ap.now = 0
      beginTurn(a.run(), u)
      ap.push(u.ap.now)
      a.run().addLoad(u, 9999, a.f(1))
      expect(u.layers).toBe(1)
      sink.push(u.sink)
    }
    expect(ap).toEqual([3, 3, 3, 4])
    expect(sink).toEqual([0, 0, 0, 2])
  })

  it('全檔的管理行動次數 +1（修正 admin_uses）', () => {
    for (const [gear, want] of [['standard', 0], ['full', 1]] as const) {
      const a = arena(setup([withGear(gear)], [lace()]))
      expect(sumOf(a.run().mods('admin_uses', a.a(1)))).toBe(want)
    }
  })

  it('同步 3 級、敏感度 40 的角色最高到深：全檔那一項灰掉、原因寫出缺的條件；一回合只能換一次；換了之後標籤跟著換', () => {
    const pc = { skills: { sync: 3 }, ext: { bridge: { sensitivity: 40 } } }
    const a = arena(setup([netAvatar(0, 1, { actor: 'pc', ext: { deck: DECK() } } as never)], [lace()]), { pc })
    const u = turnTo(a, 'a1')
    expect(u.ext.net).toMatchObject({ sync: 'standard', sync_max: 'deep' })
    const shift = opt(a, 'net_shift')
    expect(shift.cost).toEqual({ ap: 0 })
    expect(shift.group).toBe('system')
    const gears = shift.picks[0]!
    expect(gears.key).toBe('gear')
    expect(gears.options.map((x) => [x.value, x.blocks.length])).toEqual([['shallow', 0], ['standard', 1], ['deep', 0], ['full', 2]])
    const why = gears.options.find((x) => x.value === 'full')!.blocks
    expect(why[0]).toContain('同步要 5 級')
    expect(why[0]).toContain('現在 3 級')
    expect(why[1]).toContain('敏感度要 70')
    expect(why[1]).toContain('現在 40')
    // 開不了的那一檔：做不成，原因照樣
    expect(act(a, { action: 'net_shift', pick: { gear: 'full' } })).toEqual({ reasons: why })
    // 換到深檔：標籤從 sync:standard 換成 sync:deep；同一回合不能再換
    expect(act(a, { action: 'net_shift', pick: { gear: 'deep' } })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').ext.net).toMatchObject({ sync: 'deep' })
    expect(unitOf(a, 'a1').tags).toContain('sync:deep')
    expect(unitOf(a, 'a1').tags).not.toContain('sync:standard')
    expect(opt(a, 'net_shift').blocks).toEqual(['這個回合已經換過檔了。'])
    expect(act(a, { action: 'net_shift', pick: { gear: 'shallow' } })).toMatchObject({ reasons: ['這個回合已經換過檔了。'] })
    // 畫面的資料
    const view = netBattleView(a.k, a.state)!
    expect(view.units[0]).toMatchObject({ unit: 'a1', gear: 'deep', max: 'deep', shifted: true, shiftsLeft: 0 })
    expect(view.units[0]!.gears.map((g) => [g.gear, g.ok])).toEqual([['shallow', true], ['standard', true], ['deep', false], ['full', false]])
  })

  it('sync_cap +1 的修正讓他開得了全檔；sync_shifts +1 讓一回合能換兩次', () => {
    const pc = { skills: { sync: 3 }, ext: { bridge: { sensitivity: 40 } } }
    const a = arena(setup([netAvatar(0, 1, { actor: 'pc', tags: ['netrunner', 't.cap', 't.shifts'], ext: { deck: DECK() } } as never)], [lace()]), { pc })
    turnTo(a, 'a1')
    const full = opt(a, 'net_shift').picks[0]!.options.find((x) => x.value === 'full')!
    expect(full.blocks).toEqual([])
    expect(act(a, { action: 'net_shift', pick: { gear: 'full' } })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').ext.net).toMatchObject({ sync: 'full', sync_max: 'deep' })
    // 第二次（兩次的那一個）
    expect(act(a, { action: 'net_shift', pick: { gear: 'standard' } })).toEqual({ ok: true })
    expect(act(a, { action: 'net_shift', pick: { gear: 'deep' } })).toMatchObject({ reasons: ['這個回合已經換過檔了。'] })
  })

  it('沒有角色的單位：上限是它現在的檔位（超過的灰掉、寫一句）', () => {
    const a = arena(setup([ally(1, { ext: { net: { sync: 'standard' }, deck: DECK() } })], [lace()]))
    turnTo(a, 'a1')
    const gears = opt(a, 'net_shift').picks[0]!.options
    expect(gears.find((x) => x.value === 'deep')!.blocks[0]).toContain('現在開不了')
    expect(gears.find((x) => x.value === 'shallow')!.blocks).toEqual([])
  })

  it('shift 的敵人：感載到上限六成以上的那個回合開始時是淺檔，否則是深檔（N25）', () => {
    const run: string[] = []
    for (const load of [10, 30]) {
      const f = lace('elite', { ext: { net: { shift: true, sync: 'deep', sync_max: 'full', broken: [] }, deck: DECK() }, load: { now: load, max: 40 } })
      const a = arena(setup([ally(1)], [f]))
      const u = a.f(1)
      // 回合開始時感載先自然消退幾點（10 → 低於 6 成、30 → 還在 6 成以上），再看要換哪一檔
      beginTurn(a.run(), u)
      expect(u.load!.now < 24).toBe(load === 10)
      run.push(`${(u.ext.net as { sync: string }).sync}:${u.tags.filter((t) => t.startsWith('sync:')).join()}`)
    }
    expect(run).toEqual(['deep:sync:deep', 'shallow:sync:shallow'])
    // 敵人資料寫 sync: 'shift'：先開深檔、記成會換檔
    const b = arena(setup([ally(1)], [lace('boss', { ext: { net: { sync: 'shift', sync_max: 'full' }, deck: DECK() } })]))
    expect(b.f(1).ext.net).toMatchObject({ sync: 'deep', shift: true })
  })

  it('net.sync 效果：把落在的人的檔位改成某一檔，不看上限；格式不對的 to 載入時就被擋', () => {
    const a = arena(setup([ally(1)], [lace()]))
    const run = a.run()
    run.effects([{ op: 'net.sync', to: 'full', who: 'target' }], { user: a.a(1), target: { unit: 'f1' }, source: { kind: 'item', id: 'x', name: 'x' } })
    expect(a.f(1).ext.net).toMatchObject({ sync: 'full' })
    expect(a.f(1).tags).toContain('sync:full')
    expect(a.k.battle.effectProblems([{ op: 'net.sync', to: 'huge' }])[0]).toContain('to 要是檔位')
  })
})

// ---- 三、構裝的進階與終極 ----

describe('構裝的進階與終極效果（ITEMS 11.1 節）', () => {
  const rifle = (gear: string) => arena(setup([ally(1, { ext: { net: NET({ sync: gear }), deck: DECK([{ id: 'cs_rifle_3', class: 'weapon', grade: 3 }]) }, tags: ['netrunner', `sync:${gear}`] })], [lace()]))

  it('同一把 III 級構裝在標準檔沒有它的 advanced.mods，換到深檔就有；ultimate 只在全檔', () => {
    const hit = (gear: string) => rifle(gear).run().mods('hit', rifle(gear).a(1)).filter((p) => p.label.includes('夜巡')).map((p) => `${p.label}:${p.value}`)
    expect(hit('shallow')).toEqual([])
    expect(hit('standard')).toEqual([])
    expect(hit('deep')).toEqual(['夜巡（進階）:2'])
    expect(hit('full')).toEqual(['夜巡（進階）:2'])
    const dmg = (gear: string) => rifle(gear).run().mods('damage', rifle(gear).a(1)).filter((p) => p.label.includes('夜巡')).map((p) => p.value)
    expect(dmg('deep')).toEqual([])
    expect(dmg('full')).toEqual([3])
  })

  it('實際的命中合計也差那麼多（深檔：同步 +2、進階 +2）', () => {
    const total = (gear: string) => {
      const a = rifle(gear)
      return sumOf(a.run().hitParts(a.a(1), a.f(1), a.a(1).weapons[0]!))
    }
    expect(total('deep') - total('standard')).toBe(2 + 2)
  })

  it('工具構裝的 do 接上深檔的進階、全檔的終極', () => {
    const ram = (gear: string) => {
      const a = arena(setup([ally(1, { ext: { net: NET({ sync: gear }), deck: DECK([{ id: 'cs_cooler', class: 'tool', grade: 3 }]) }, tags: ['netrunner', `sync:${gear}`], pools: { ram: { now: 1, max: 20, regen: 2 } } })], [lace()]))
      doAct(a, 'a1', { action: 'net_tool:cs_cooler' })
      return a.a(1).pools.ram!.now
    }
    // 花 1 點 RAM，do 回 2；深檔再 +1、全檔再 +1
    expect([ram('standard'), ram('deep'), ram('full')]).toEqual([1 - 1 + 2, 1 - 1 + 2 + 1, 1 - 1 + 2 + 1 + 1])
  })

  it('破損的構裝不給進階的加成', () => {
    const a = rifle('deep')
    ;(a.a(1).ext.net as { broken: string[] }).broken = ['cs_rifle_3']
    expect(a.run().mods('hit', a.a(1)).some((p) => p.label.includes('夜巡'))).toBe(false)
  })
})

// ---- 四、干擾 ----

describe('干擾（CYBERSPACE 6.5 節）', () => {
  const jammer = (o: Rec = {}) => ally(1, { weapons: [gun('cs_jam', { traits: ['jam'], range: [1, 7] })], ...o })

  it('命中之後目標的感載沒有變、帶著選的那一類的停用狀態；AI 沒選就是武器', () => {
    for (const [pick, status] of [['weapon', 'jam_weapon'], ['defense', 'jam_defense'], ['tool', 'jam_tool'], [undefined, 'jam_weapon']] as const) {
      const a = arena(setup([jammer()], [lace('minion', { ext: { net: NET(), deck: DECK() } })]))
      const run = doAct(a, 'a1', { action: 'net_attack', target: { unit: 'f1' }, ...(pick ? { pick: { jam: pick } } : {}) })
      expect(a.f(1).load!.now, String(pick)).toBe(0)
      expect(a.f(1).statuses.map((s) => s.id), String(pick)).toEqual([status])
      // 一回合：到他自己的回合結束
      expect(a.f(1).statuses[0]!.until).toMatchObject({ at: 'turn_end', of: 'f1', turns: 1 })
      expect(run.beats.some((b) => b.tag === 'jam')).toBe(true)
    }
  })

  it('攻擊行動宣告了 pick.jam（武器、防護、工具）；沒有干擾的武器就不用選', () => {
    const a = arena(setup([jammer()], [lace()]))
    turnTo(a, 'a1')
    const p = opt(a, 'net_attack').picks
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ key: 'jam', kind: 'choice' })
    expect(p[0]!.options.map((x) => x.value)).toEqual(['weapon', 'defense', 'tool'])
    expect(act(a, { action: 'net_attack', target: { unit: 'f1' }, pick: { jam: 'bogus' } })).toMatchObject({ reasons: [expect.stringContaining('沒有「bogus」')] })
    const plain = arena(setup([ally(1)], [lace()]))
    turnTo(plain, 'a1')
    expect(opt(plain, 'net_attack').picks).toEqual([])
  })

  it('武器被停用的人兩個攻擊行動與打牆都灰掉（寫出原因）；工具被停用不能用工具構裝與腳本；換構裝不受影響', () => {
    const a = arena(setup([ally(1, { weapons: [gun('g1'), blade('g2')], quick: [{ item: 'it_ramscript', qty: 1 }], ext: { net: NET(), deck: DECK([{ id: 'cs_cooler', class: 'tool' }]) } })], [lace()], { cover: { ally: [0, 0, 0, 0], foe: [1, 0, 0, 0] } }))
    turnTo(a, 'a1')
    a.run().applyStatus(a.a(1), 'jam_weapon')
    for (const id of ['net_attack', 'net_melee', 'net_hit_wall']) {
      expect(opt(a, id).ok, id).toBe(false)
      expect(opt(a, id).blocks.join(''), id).toContain('干擾')
    }
    expect(opt(a, 'net_swap').ok).toBe(true)
    expect(opt(a, 'net_tool:cs_cooler').ok).toBe(true)
    a.a(1).statuses = []
    a.run().applyStatus(a.a(1), 'jam_tool')
    expect(opt(a, 'net_attack').ok).toBe(true)
    for (const id of ['net_tool:cs_cooler', 'net_script']) {
      expect(opt(a, id).ok, id).toBe(false)
      expect(opt(a, id).blocks.join(''), id).toContain('干擾')
    }
  })

  it('防護被停用的人受到的感載不扣防護', () => {
    const load = (jam: boolean) => {
      const a = arena(setup([ally(1, { armor: 3, load: { now: 0, max: 200 } })], [lace()]))
      if (jam) a.run().applyStatus(a.a(1), 'jam_defense')
      a.run().damage(a.a(1), 20, 'neural', a.f(1))
      return a.a(1).load!.now
    }
    expect(load(false)).toBe(17)
    expect(load(true)).toBe(20)
  })

  it('net.jam 效果：slot 沒寫看 pick.jam，再沒有是武器；turns 可以寫；少了狀態的資料載入時就說清楚', () => {
    const a = arena(setup([ally(1)], [lace()]))
    a.run().effects([{ op: 'net.jam', slot: 'tool', turns: 2, who: 'target' }], { user: a.a(1), target: { unit: 'f1' }, source: { kind: 'item', id: 'x', name: 'x' } })
    expect(a.f(1).statuses[0]).toMatchObject({ id: 'jam_tool', until: { turns: 2 } })
    a.run().effects([{ op: 'net.jam', who: 'target' }], { user: a.a(1), target: { unit: 'f1' }, source: { kind: 'item', id: 'x', name: 'x' }, pick: { jam: 'defense' } })
    expect(a.f(1).statuses.map((s) => s.id)).toEqual(['jam_tool', 'jam_defense'])
    expect(a.k.battle.effectProblems([{ op: 'net.jam', slot: 'wall' }])[0]).toContain('slot 只能是')
    // 資料沒有 jam_* 的狀態
    const bad = createKernel(FEATURES)
    expect(() => {
      bad.content.loadPack({ id: 'x', content: { skill: SKILLS, weapon_class: WEAPON_CLASSES, construct: [cs('cs_jam', 'weapon', { archetype: 'pistol', type: 'jam', ram: 1 })] } } as unknown as ContentPack)
      readyFeatures(bad)
    }).toThrow(/jam_weapon/)
  })
})

// ---- 五、破損 ----

describe('破損（內海的重創；CYBERSPACE 6.5 節）', () => {
  const equipped = () => DECK([{ id: 'cs_rifle_3', class: 'weapon' }, { id: 'cs_guard_4', class: 'defense' }, { id: 'cs_cooler', class: 'tool' }])

  it('自然 20 打精英：照武器、工具、防護的順序破損一件，那一件的行動灰掉；再中一次是第二件（重）', () => {
    const a = arena(setup([ally(1)], [lace('elite', { weapons: [gun('cs_rifle_3')], ext: { net: NET(), deck: equipped() } })]))
    const run = a.run()
    run.attack(a.a(1), a.f(1), { natural: 20, spend: 0 })
    expect(a.f(1).ext.net).toMatchObject({ broken: ['cs_rifle_3'] })
    expect(a.f(1).ext.net).not.toHaveProperty('heavy')
    expect(run.beats.some((b) => b.tag === 'break')).toBe(true)
    // 那一件的行動灰掉：武器構裝破損，攻擊做不了
    expect(defOf(a, 'net_attack').blocks!(run, a.f(1)).join('')).toContain('破損')
    run.attack(a.a(1), a.f(1), { natural: 20, spend: 0 })
    expect(a.f(1).ext.net).toMatchObject({ broken: ['cs_rifle_3', 'cs_cooler'], heavy: true })
    run.attack(a.a(1), a.f(1), { natural: 20, spend: 0 })
    expect((a.f(1).ext.net as { broken: string[] }).broken).toEqual(['cs_rifle_3', 'cs_cooler', 'cs_guard_4'])
  })

  it('破損的工具構裝的行動灰掉；破損的防護構裝不算防護；破損的武器換掉之後可以用別把', () => {
    const a = arena(setup([ally(1, { weapons: [gun('cs_rifle_3'), gun('g2')], armor: 4, ext: { net: NET({ broken: ['cs_cooler', 'cs_rifle_3'] }), deck: equipped() } })], [lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'net_tool:cs_cooler').ok).toBe(false)
    expect(opt(a, 'net_tool:cs_cooler').blocks[0]).toContain('破損')
    expect(opt(a, 'net_attack').ok).toBe(false)
    // 換到另一把就能打
    expect(act(a, { action: 'net_swap' })).toEqual({ ok: true })
    expect(opt(a, 'net_attack').ok).toBe(true)
    // 防護：最高的那一件（客服窗 4）沒破損，防護照舊；破損了，剩下的最高（沒有）就是 0
    const b = arena(setup([ally(1, { armor: 4, load: { now: 0, max: 200 }, ext: { net: NET({ broken: ['cs_guard_4'] }), deck: equipped() } })], [lace()]))
    b.run().damage(b.a(1), 20, 'neural', b.f(1))
    expect(b.a(1).load!.now).toBe(20)
    const c = arena(setup([ally(1, { armor: 4, load: { now: 0, max: 200 }, ext: { net: NET({ broken: ['cs_guard_4'] }), deck: DECK([{ id: 'cs_guard_4', class: 'defense' }, { id: 'cs_guard_2', class: 'defense' }]) } })], [lace()]))
    c.run().damage(c.a(1), 20, 'neural', c.f(1))
    expect(c.a(1).load!.now).toBe(20 - 2)
  })

  it('破損的被動工具不給加成（features/deck 給的 mods 在這裡扣回來）', () => {
    const ok = arena(setup([ally(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_pass', class: 'tool' }]) } })], [lace()]))
    const broken = arena(setup([ally(1, { ext: { net: NET({ broken: ['cs_pass'] }), deck: DECK([{ id: 'cs_pass', class: 'tool' }]) } })], [lace()]))
    expect(sumOf(ok.run().mods('evade', ok.a(1)))).toBe(2)
    expect(sumOf(broken.run().mods('evade', broken.a(1)))).toBe(0)
  })

  it('打雜兵沒有破損（核心改成多 1 顆骰）', () => {
    const a = arena(setup([ally(1)], [lace('minion', { ext: { net: NET(), deck: equipped() } })]))
    const run = a.run()
    for (let i = 0; i < 3; i++) run.attack(a.a(1), a.f(1), { natural: 20, spend: 0 })
    expect(a.f(1).ext.net).toMatchObject({ broken: [] })
    expect(run.beats.some((b) => b.tag === 'break')).toBe(false)
  })

  it('沒有甲板資料的敵人：這一場傷害骰少 1 顆（再中一次少 2 顆）；現實的重創不經過這裡', () => {
    const a = arena(setup([ally(1)], [lace('elite', { weapons: [gun('g')], ext: { net: NET() } })]))
    const run = a.run()
    const dice = () => sumOf(run.mods('dice', a.f(1)))
    expect(dice()).toBe(0)
    run.attack(a.a(1), a.f(1), { natural: 20, spend: 0 })
    expect(dice()).toBe(-1)
    run.attack(a.a(1), a.f(1), { natural: 20, spend: 0 })
    expect(dice()).toBe(-2)
    expect(a.f(1).ext.net).toMatchObject({ heavy: true })
  })

  it('再中一次（重）：戰鬥結束的報告裡有角色的狀況 net_broken；輕的不留；net.fix 全修好之後不留', () => {
    const mk = () => arena(setup([netAvatar(0, 1, { actor: 'pc', weapons: [gun()], ext: { net: NET(), deck: equipped() } } as never)], [lace('elite')]), {})
    const hit = (a: Arena, n: number) => {
      const run = a.run()
      for (let i = 0; i < n; i++) run.attack(a.f(1), a.a(1), { natural: 20, spend: 0 })
    }
    const finish = (a: Arena) => {
      a.state.battle!.result = { outcome: 'win', text: '測試。' }
      return endBattle(a.k, a.state)
    }
    const light = mk()
    hit(light, 1)
    expect(finish(light).changes.some((c) => c.op === 'actor.condition')).toBe(false)
    const heavy = mk()
    hit(heavy, 2)
    const end = finish(heavy)
    expect(end.changes).toContainEqual({ op: 'actor.condition', id: 'pc', condition: 'net_broken' })
    expect(end.narration?.results?.some((l) => l.includes('重創'))).toBe(true)
    // 當場修好：全部修好之後就不是重創了
    const fixed = mk()
    hit(fixed, 2)
    fixed.run().effects([{ op: 'net.fix', who: 'self' }, { op: 'net.fix', who: 'self' }], { user: fixed.a(1), source: { kind: 'item', id: 'x', name: 'x' } })
    expect(fixed.a(1).ext.net).toMatchObject({ broken: [] })
    expect(fixed.a(1).ext.net).not.toHaveProperty('heavy')
    expect(finish(fixed).changes.some((c) => c.op === 'actor.condition')).toBe(false)
  })

  it('net.break 效果：指定一件或照順序；已經破損或沒裝著的指定不做', () => {
    const a = arena(setup([ally(1, { ext: { net: NET(), deck: equipped() } })], [lace()]))
    const run = a.run()
    const src = { kind: 'item' as const, id: 'x', name: 'x' }
    const on = { user: a.f(1), target: { unit: 'a1' }, source: src }
    run.effects([{ op: 'net.break', slot: 'cs_guard_4' }], on)
    expect((a.a(1).ext.net as { broken: string[] }).broken).toEqual(['cs_guard_4'])
    run.effects([{ op: 'net.break', slot: 'cs_guard_4' }, { op: 'net.break', slot: 'nope' }], on)
    expect((a.a(1).ext.net as { broken: string[] }).broken).toEqual(['cs_guard_4'])
    run.effects([{ op: 'net.break' }], on)
    expect((a.a(1).ext.net as { broken: string[] }).broken).toEqual(['cs_guard_4', 'cs_rifle_3'])
  })
})

// ---- 六、監視 ----

describe('監視（CYBERSPACE 6.3 節）', () => {
  /** f1 站在有防火牆的第 1 格、第 2 格是空的暴露格：把它退到第 2 格就站上暴露的格子。 */
  const watching = (o: Rec = {}) => {
    const a = arena(setup([ally(1, o)], [lace('elite')], { cover: { ally: [0, 0, 0, 0], foe: [1, 0, 0, 0] } }))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'net_watch' })
    return a
  }

  it('敵人站上暴露的格子時自動攻擊一次、RAM 少了，不花行動點；監視用掉了', () => {
    const a = watching()
    const ram = a.a(1).pools.ram!.now
    const ap = a.a(1).ap.now
    expect(a.a(1).watch).toEqual({ action: 'net_attack' })
    const run = a.run()
    run.move(a.f(1), 2)
    run.settle()
    expect(run.beats.some((b) => b.tag === 'watch.fire')).toBe(true)
    expect(a.a(1).pools.ram!.now).toBe(ram - 1)
    expect(a.a(1).ap.now).toBe(ap)
    expect(a.a(1).watch).toBeUndefined()
    expect(a.f(1).load!.now).toBeGreaterThan(0)
  })

  it('RAM 是 0 時不攻擊，監視還在', () => {
    const a = watching()
    a.a(1).pools.ram!.now = 0
    const run = a.run()
    run.move(a.f(1), 2)
    run.settle()
    expect(a.f(1).load!.now).toBe(0)
    expect(a.a(1).watch).toEqual({ action: 'net_attack' })
    expect(run.beats.some((b) => b.tag === 'watch.fire')).toBe(false)
  })

  it('手上是近戰構裝的監視只在對方站在近身時才打；武器被停用時也不打', () => {
    const m = watching({ weapons: [blade()] })
    expect(m.a(1).watch).toEqual({ action: 'net_melee' })
    const run = m.run()
    run.move(m.f(1), 2)
    run.settle()
    // 第 2 格：距離 2，近戰打不到
    expect(m.f(1).load!.now).toBe(0)
    expect(m.a(1).watch).toBeDefined()
    const j = watching()
    j.run().applyStatus(j.a(1), 'jam_weapon')
    const run2 = j.run()
    run2.move(j.f(1), 2)
    run2.settle()
    expect(j.f(1).load!.now).toBe(0)
    expect(j.a(1).watch).toBeDefined()
  })

  it('沒有武器構裝的人不能監視', () => {
    const a = arena(setup([ally(1, { weapons: [] })], [lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'net_watch').ok).toBe(false)
  })
})

// ---- 七、規則表 ----

describe('規則表 netcombat_rule', () => {
  it('資料可以蓋掉基本的行動點與回填（沒寫的照預設）；格式壞的整筆被擋', () => {
    const k = createKernel(FEATURES)
    k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', refill: 3, ap: { attack: 3 }, jam_wall_mult: 3 }] } } as unknown as ContentPack)
    expect(netcombatRules(k)).toMatchObject({ refill: 3, jam_wall_mult: 3, sync_shifts: 1, ap: { ...DEFAULT_NETCOMBAT_RULES.ap, attack: 3 } })
    const bad = createKernel(FEATURES)
    expect(() => bad.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', refill: -1, ap: { nope: 1 } }] } } as unknown as ContentPack)).toThrow()
    expect(DEFAULT_NETCOMBAT_RULES.refill).toBe(2)
  })

  it('改了規則：攻擊的行動點、回填的量跟著變', () => {
    const rules: ContentPack = { id: 'rules', content: { netcombat_rule: [{ id: 'default', refill: 4, ap: { attack: 1, refill: 2 } }] } } as unknown as ContentPack
    const a = arena(setup([ally(1)], [lace()]), { packs: [PACK, rules] })
    turnTo(a, 'a1')
    expect(opt(a, 'net_attack').cost).toEqual({ ap: 1, ram: 1 })
    expect(opt(a, 'net_refill').cost).toEqual({ ap: 2 })
    a.a(1).pools.ram!.now = 0
    doAct(a, 'a1', { action: 'net_refill' })
    expect(a.a(1).pools.ram!.now).toBe(4)
  })
})

// ---- 八、和甲板一起：用角色進場 ----

describe('和 features/deck 一起裝：角色進場', () => {
  const BAG = [
    { id: 'dk_ii', qty: 1, data: { uid: 'D1' } },
    { id: 'cs_rifle_3', qty: 1 }, { id: 'cs_blade', qty: 1 }, { id: 'cs_jam', qty: 1 }, { id: 'cs_guard_4', qty: 1 }, { id: 'cs_cooler', qty: 1 }, { id: 'cs_pass', qty: 1 },
    { id: 'it_ramscript', qty: 2 },
  ]
  const world = () => {
    const t = makeGame({
      features: [characterFeature, ...FEATURES], content: [PACK], seed: 11,
      pc: { attrs: { reflex: 14, body: 12, charm: 12, resolve: 13, intellect: 12 }, skills: { firearms: 2, brawl: 1, sync: 3 }, ext: { bridge: { sensitivity: 40 } } },
      patch: { inventory: structuredClone(BAG) as never },
    })
    const g = t.game
    g.commit(equipDraft(g.k, g.state, 'pc', 'D1'))
    for (const item of ['cs_rifle_3', 'cs_blade', 'cs_jam', 'cs_guard_4', 'cs_cooler', 'cs_pass']) g.commit(installDraft(g.k, g.state, 'pc', item))
    g.commit(scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_ramscript', qty: 1 }]))
    return g
  }
  const start = () => {
    const g = world()
    g.startBattle({ ...BATTLE_SETUPS.net(), allies: [{ from: 'actor', id: 'pc' }], foes: [raw(laceUnit('minion', 1, { ext: { net: NET(), deck: DECK() } } as never))] } as never)
    return g
  }

  it('裝著的構裝變成行動：三把武器在換構裝裡、工具有自己的行動（被動的沒有）、腳本在腳本裡；同步上限由角色的同步與敏感度來', () => {
    const g = start()
    const u = g.battle!.units.a1!
    expect(u.ext.net).toEqual({ sync: 'standard', sync_max: 'deep', broken: [] })
    expect(u.tags).toContain('sync:standard')
    const b = g.battle!
    b.turn = b.order.indexOf('a1')
    u.ap.now = u.ap.max
    const ids = g.battleOptions()!.actions.map((x) => x.id).sort()
    expect(ids).toEqual([END_TURN, MOVE, 'net_attack', 'net_melee', 'net_refill', 'net_swap', 'net_script', 'net_tool:cs_cooler', 'net_hit_wall', 'net_watch', 'net_shift'].sort())
    const o = (id: string) => g.battleOptions()!.actions.find((x) => x.id === id)!
    expect(o('net_attack').ok).toBe(true)
    expect(o('net_attack').cost).toEqual({ ap: 2, ram: 1 })
    expect(o('net_swap').picks[0]!.options.map((x) => x.label)).toEqual(['夜巡', '光刃', '靜電'])
    expect(o('net_script').ok).toBe(true)
    expect(o('net_shift').picks[0]!.options.find((x) => x.value === 'full')!.blocks).toHaveLength(2)
    // 被動的工具構裝的 mods 照常（features/deck），進階 mods 要深檔
    expect(g.battle!.units.a1!.weapons.map((w) => w.id)).toEqual(['cs_rifle_3', 'cs_blade', 'cs_jam'])
  })

  it('網內走一步：換深檔、用攻擊（RAM 與行動點照扣）、跑腳本（用掉的在戰後從背包扣）', () => {
    const g = start()
    const b = g.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = b.units.a1!.ap.max
    expect(g.battleAct({ action: 'net_shift', pick: { gear: 'deep' } }).status).toBe('applied')
    expect(g.battle!.units.a1!.ext.net).toMatchObject({ sync: 'deep' })
    const ram = g.battle!.units.a1!.pools.ram!.now
    expect(g.battleAct({ action: 'net_attack', target: { unit: 'f1' } }).status).toBe('applied')
    expect(g.battle!.units.a1!.pools.ram!.now).toBe(ram - 1)
    expect(g.battleAct({ action: 'net_script', target: { unit: 'a1' } }).status).toBe('applied')
    expect(g.battle!.units.a1!.quick).toEqual([])
  })

  it('破損：自然 20 兩次之後寫回角色的 net_broken（同一個角色進場，從甲板來的構裝）', () => {
    const g = start()
    const b = g.battle!
    const run = new BattleRun(g.k, g.state, b)
    // 敵人換成精英來打（直接改單位：同一組戰場）
    b.units.f1!.rank = 'elite'
    run.attack(b.units.f1!, b.units.a1!, { natural: 20, spend: 0 })
    run.attack(b.units.f1!, b.units.a1!, { natural: 20, spend: 0 })
    expect(b.units.a1!.ext.net).toMatchObject({ heavy: true })
    expect((b.units.a1!.ext.net as { broken: string[] }).broken.length).toBe(2)
    b.result = { outcome: 'win', text: '測試。' }
    const end = endBattle(g.k, g.state)
    expect(end.changes).toContainEqual({ op: 'actor.condition', id: 'pc', condition: 'net_broken' })
  })

  it('現實戰鬥沒有 net_ 的行動；同一個角色進現實戰鬥照舊', () => {
    const g = world()
    g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] } as never)
    const b = g.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = b.units.a1!.ap.max
    expect(g.battleOptions()!.actions.some((x) => x.id.startsWith('net_'))).toBe(false)
    expect(b.units.a1!.ext.net).toBeUndefined()
    expect(b.units.a1!.tags.some((t) => t.startsWith('sync:'))).toBe(false)
  })
})

// ---- 九、整場 ----

describe('隨機打完二十場；打到一半存檔再讀', () => {
  const start = (seed: number) => {
    const t = makeGame({ features: [deckFeature, netcombatFeature], content: [PACK], seed })
    t.game.startBattle(BATTLE_SETUPS.net((1 + (seed % 3)) as 1 | 2 | 3))
    return t.game
  }

  it('最小的蕾絲對四個化身，二十個種子：不丟錯、不變式沒有違規', async () => {
    const outcomes: string[] = []
    for (let seed = 1; seed <= 20; seed++) {
      const g = start(seed)
      g.k.probe.start()
      const r = playOut(g)
      expect(['win', 'lose']).toContain(r.outcome)
      outcomes.push(r.outcome)
      await g.finishBattle()
      expect(commitViolations(g.k, g.k.probe.stop()), `seed ${seed}`).toEqual([])
    }
    expect(outcomes.length).toBe(20)
  }, 120_000)

  it('打到一半存檔再讀，結果一樣', () => {
    for (const seed of [3, 8, 13]) {
      const whole = start(seed)
      const r1 = playOut(whole)
      const part = start(seed)
      for (let i = 0; i < 9; i++) expect(part.battleNext({ anyone: true }).status).toBe('applied')
      expect(part.load(part.save('manual', '2026-11-24T00:00:00Z'))).toBeNull()
      const r2 = playOut(part)
      expect(r2.outcome).toBe(r1.outcome)
      expect(r2.rounds).toBe(r1.rounds)
      expect(stateHash(part.state)).toBe(stateHash(whole.state))
    }
  })
})

// ---- 十、宣告 ----

describe('行動的宣告', () => {
  it('掃原始碼：run 會讀的每一個 input.pick 的鍵都有宣告（key）', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(__dirname, '../../src/features/netcombat')
    const missing: string[] = []
    let seen = 0
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(dir, name), 'utf-8')
      for (const m of text.matchAll(/pick\?\.([A-Za-z_]+)/g)) {
        seen += 1
        if (!new RegExp(`key: '${m[1]}'`).test(text)) missing.push(`${name}：pick.${m[1]}`)
      }
    }
    expect(seen).toBeGreaterThan(3)
    expect(missing).toEqual([])
  })

  it('每個行動有圖示與說明，名字不重複；picks 的每個選項都有 label 與 blocks', () => {
    const a = arena(setup([ally(1, { weapons: [gun('g1'), gun('cs_jam', { traits: ['jam'] })], quick: [{ item: 'it_ramscript', qty: 1 }], ext: { net: NET(), deck: DECK([{ id: 'cs_cooler', class: 'tool' }, { id: 'cs_drain', class: 'tool' }]) } })], [lace()]))
    turnTo(a, 'a1')
    for (const x of options(a).actions) {
      expect(x.icon, x.id).toBeTruthy()
      expect(x.desc, x.id).toMatch(/[。）]$/)
      for (const p of x.picks) for (const op of p.options) {
        expect(op.label, `${x.id}.${p.key}`).toBeTruthy()
        expect(Array.isArray(op.blocks), `${x.id}.${p.key}`).toBe(true)
      }
    }
  })
})
