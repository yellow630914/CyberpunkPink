// 驗收測試：dev/work/M3-netcombat-out.md（cpp-feature）。features/netcombat 的第二張：釘住、拔線、投降、倒下與扣線的後果；戰鬥裡的追蹤度（每輪、門檻、增援、定位）。
// 規格：CYBERSPACE 6.3 節（釘住、拔線、投降三列）、6.7、6.8 節、6.10 節最後的表；NETRUNNING 第 3、5 節；COMBAT_SYSTEM 第 7 節、8.5 節；
// dev/adr/0018 第一節、第十節與 N12、N15、N17、N22、N32。
// 單位用 from: 'unit' 直接給；內容都是測試自帶的最小假資料。追蹤度的數字：從 20 起、第 2 輪起每輪 +3，第 5 輪開頭是 32（第 4 輪開頭是 29，工單寫的「第 4 輪」差一輪，回報有寫）。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOptions, BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel, TimelineBeat } from '../../src'
import { BattleBlocked, BattleRun, advance, battleAct, battleAuto, battleOptions, clone, createKernel, endBattle, isDefeat, pendingDefeat, performAction, readyFeatures, setupBattle, toMinutes } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import { DEFAULT_NETCOMBAT_RULES, netBattleView, netcombatFeature, netcombatRules } from '../../src/features/netcombat'
import { BATTLE_SETUPS, commitViolations, fixDice, laceUnit, makeActor, makeGame, makeState, netAvatar, netWeapon, stateHash } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 假資料 ----

const STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' },
  { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
  { id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' },
  { id: 'sync', name: '同步', attr: 'resolve', desc: '同步。' },
]
const WEAPON_CLASSES = [
  { id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' },
]
const PACK: ContentPack = { id: 'netcombat_out_test', content: { battle_status: STATUSES, skill: SKILLS, weapon_class: WEAPON_CLASSES } } as unknown as ContentPack

/** 測試自己的修正：標籤 t.trace 的人讓戰鬥每回合的追蹤度少 2。 */
const MODS: Feature = {
  id: 'netout_test_mods',
  install(k) {
    k.battle.modifier('netout_test_mods', (q) => (q.kind === 'trace_round' && q.unit.tags.includes('t.trace') ? [{ label: '測試', value: -2 }] : []))
  },
}
/** 測試的 out.before：標籤 t.shield 的人釘不住（技能「不讓你帶走」的樣子）。 */
const SHIELD: Feature = {
  id: 'netout_test_shield',
  install(k) {
    k.battle.on('out.before', 'netout_test_shield', ({ unit, how, out }) => {
      if (how === 'pinned' && unit.tags.includes('t.shield')) out.prevent = true
    })
  },
}

const FEATURES = [deckFeature, netcombatFeature, MODS, SHIELD]

// ---- 單位 ----

const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], ...o })
const DECK = { grade: 2, firewall: 12, slots: [] as string[], constructs: [] as unknown[] }
const gun = () => netWeapon(30, 4, { id: 'cs_rifle', name: '夜巡', class: 'rifle', traits: ['long'], range: [1, 7] })
const ally = (i: number, o: Rec = {}) => netAvatar(i, 1, { weapons: [gun()], ext: { net: NET(), deck: DECK }, ...o } as never)
/** 不會傷到任何人的化身與蕾絲（整場的測試用：回合照輪、沒有人倒下）。 */
const calm = (i: number, o: Rec = {}) => ally(i, { weapons: [], ...o })
const lace = (rank: 'minion' | 'elite' | 'boss' = 'minion', o: Rec = {}) => laceUnit(rank, 1, { ext: { net: NET(), deck: DECK }, ...o } as never)
const calmLace = (o: Rec = {}) => lace('minion', { weapons: [], ...o })
const raw = (u: unknown, slot?: number) => ({ from: 'unit', unit: u as Rec, ...(slot ? { slot } : {}) })
const setup = (allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup => ({ mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), ...more }) as BattleSetup
const withNet = (net: Rec, more: Partial<BattleSetup> = {}): Partial<BattleSetup> => ({ origin: { escapable: true, ext: { net } }, ...more }) as Partial<BattleSetup>

// ---- 不經過提交的戰鬥（直接動 BattleRun） ----

interface Arena {
  k: Kernel
  state: GameState
  battle: ReturnType<typeof setupBattle>['battle']
  run(dice?: number[]): BattleRun
  a(i: number): BattleUnit
  f(i: number): BattleUnit
}

function arena(s: BattleSetup, o: { features?: Feature[]; actors?: ReturnType<typeof makeActor>[] } = {}): Arena {
  const k = createKernel(o.features ?? [...FEATURES, combatFeature])
  k.content.loadPack(PACK)
  readyFeatures(k)
  const state = makeState(o.actors ? { actors: o.actors } : {})
  const battle = clone(setupBattle(k, state, s).battle)
  state.battle = battle
  return {
    k, state, battle,
    run: (dice) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)),
    a: (i) => battle.units[`a${i}`]!,
    f: (i) => battle.units[`f${i}`]!,
  }
}

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
const doAct = (a: Arena, who: string, input: BattleInput, dice?: number[]): BattleRun => {
  const run = a.run(dice)
  const u = run.unit(who)
  const def = a.k.battle.getAction(input.action)!
  performAction(run, u, def, input.target ?? null, input)
  run.settle()
  return run
}
/** 讓整場輪完這一輪（每個人都結束回合）：回傳這一輪的每一拍。 */
const nextRound = (a: Arena): TimelineBeat[] => {
  const run = a.run()
  const r0 = a.battle.round
  for (let i = 0; i < 200 && !a.battle.result && a.battle.round === r0; i++) advance(run)
  return run.beats
}
const rounds = (a: Arena, n: number): TimelineBeat[] => {
  const beats: TimelineBeat[] = []
  for (let i = 0; i < n && !a.battle.result; i++) beats.push(...nextRound(a))
  return beats
}
const traceOf = (a: Arena): unknown => a.battle.field.trace
const tagged = (beats: readonly TimelineBeat[], tag: string): TimelineBeat[] => beats.filter((b) => b.tag === tag)
const SRC = { kind: 'item', id: 'x', name: 'x' } as const

// ---- 一、釘住 ----

describe('釘住（CYBERSPACE 6.7 節）', () => {
  it('餘韻沒疊滿的目標灰掉並說明現在幾層；不在近身（我方或對方不在第 1 格）也灰掉；兩個條件都缺就兩句', () => {
    const a = arena(setup([ally(1), ally(2)], [lace('elite', { layers: 1 }), lace('minion', { layers: 1 })]))
    turnTo(a, 'a1')
    const o = opt(a, 'net_pin')
    expect(o.cost).toEqual({ ap: 2, ram: 1 })
    expect(o.group).toBe('tactic')
    const t = (id: string) => o.targets.find((x) => 'unit' in x.target && x.target.unit === id)!
    // f1（精英）要兩層，只疊了一層
    expect(t('f1').blocks).toEqual(['餘韻要疊滿才釘得住（現在 1／2 層）。'])
    // f2 疊滿了、但站在第 2 格
    expect(t('f2').blocks).toEqual(['要在近身：雙方都站在第 1 格。'])
    // 我方站第 2 格的人也不行
    turnTo(a, 'a2')
    a.f(1).layers = 2
    expect(opt(a, 'net_pin').targets.find((x) => 'unit' in x.target && x.target.unit === 'f1')!.blocks).toEqual(['要在近身：雙方都站在第 1 格。'])
    // 兩個條件都缺
    a.f(1).layers = 0
    expect(opt(a, 'net_pin').targets.find((x) => 'unit' in x.target && x.target.unit === 'f1')!.blocks).toHaveLength(2)
    // 走動作也一樣不成立
    expect(act(a, { action: 'net_pin', target: { unit: 'f1' } })).toMatchObject({ reasons: expect.any(Array) })
  })

  it('DC：雜兵 10 ＋ 等級 × 2，精英再 +2、首領再 +4（目標的 hint.dc）', () => {
    const a = arena(setup([ally(1)], [lace('elite', { layers: 2 })]))
    turnTo(a, 'a1')
    const dcOf = (rank: 'minion' | 'elite' | 'boss', grade: 1 | 3) => {
      const x = arena(setup([ally(1)], [laceUnit(rank, grade, { layers: 9, ext: { net: NET(), deck: DECK } } as never)]))
      turnTo(x, 'a1')
      return (opt(x, 'net_pin').targets[0]!.hint as { dc: number }).dc
    }
    expect(dcOf('minion', 1)).toBe(12)
    expect(dcOf('elite', 1)).toBe(10 + 1 * 2 + 2)
    expect(dcOf('boss', 1)).toBe(10 + 1 * 2 + 4)
    expect(dcOf('elite', 3)).toBe(10 + 3 * 2 + 2)
  })

  it('釘死骰面（自然 20）：目標 out 是 pinned、紀錄有 pin（標籤 pin 的檢定）、花 2 行動點與 1 RAM；他不再算站著', () => {
    const a = arena(setup([ally(1)], [lace('elite', { layers: 2 }), lace('minion')]))
    turnTo(a, 'a1')
    const ap = a.a(1).ap.now
    const ram = a.a(1).pools.ram!.now
    const run = doAct(a, 'a1', { action: 'net_pin', target: { unit: 'f1' } }, [20])
    expect(a.f(1).out).toBe('pinned')
    expect(tagged(run.beats, 'pin')).toHaveLength(1)
    expect(tagged(run.beats, 'pin')[0]!.data).toMatchObject({ target: 'f1', by: 'a1' })
    expect(a.a(1).ap.now).toBe(ap - 2)
    expect(a.a(1).pools.ram!.now).toBe(ram - 1)
    expect(a.battle.result).toBeUndefined()
    // 釘住的檢定帶 DC：精英 14
    expect(run.beats.find((b) => b.roll)!.roll).toMatchObject({ dc: 14 })
  })

  it('自然 1 沒過：目標還在場上、花費照扣', () => {
    const a = arena(setup([ally(1)], [lace('minion', { layers: 1 }), lace('minion')]))
    turnTo(a, 'a1')
    const run = doAct(a, 'a1', { action: 'net_pin', target: { unit: 'f1' } }, [1])
    expect(a.f(1).out).toBeUndefined()
    expect(a.f(1).slot).toBe(1)
    expect(tagged(run.beats, 'pin')).toEqual([])
  })

  it('檢定取兩組裡加值高的：智識加介面，或意志加格鬥', () => {
    const rollOf = (u: Rec) => {
      const a = arena(setup([ally(1, u)], [lace('minion', { layers: 1 })]))
      turnTo(a, 'a1')
      return doAct(a, 'a1', { action: 'net_pin', target: { unit: 'f1' } }, [10]).beats.find((b) => b.roll)!.roll!
    }
    const base = netAvatar(1, 1).attrs
    const mind = rollOf({ attrs: { ...base, intellect: 16, resolve: 10 }, skills: { interface: 2 } })
    expect(mind).toMatchObject({ attr: 'intellect', skill: 'interface' })
    const will = rollOf({ attrs: { ...base, intellect: 10, resolve: 18 }, skills: { brawl: 2, interface: 0 } })
    expect(will).toMatchObject({ attr: 'resolve', skill: 'brawl' })
    // 一樣高用智識
    const tie = rollOf({ attrs: { ...base, intellect: 12, resolve: 12 }, skills: { interface: 1, brawl: 1 } })
    expect(tie).toMatchObject({ attr: 'intellect', skill: 'interface' })
  })

  it('out.before 擋下（技能「不讓你帶走」）：目標還在場上，不記 pin，說明被擋下', () => {
    const a = arena(setup([ally(1)], [lace('minion', { layers: 1, tags: ['lace', 't.shield'] }), lace('minion')]))
    turnTo(a, 'a1')
    const run = doAct(a, 'a1', { action: 'net_pin', target: { unit: 'f1' } }, [20])
    expect(a.f(1).out).toBeUndefined()
    expect(a.f(1).slot).toBe(1)
    expect(tagged(run.beats, 'pin')).toEqual([])
    expect(run.beats.some((b) => b.text.includes('擋下'))).toBe(true)
  })

  it('效果 net.pin：照同樣的規則做一次、不花費；條件不成立什麼都不做；格式只收 op、who、if', () => {
    const a = arena(setup([ally(1)], [lace('minion', { layers: 1 }), lace('minion', { layers: 0 })]))
    const ap = a.a(1).ap.now
    const ram = a.a(1).pools.ram!.now
    const last = { ...({} as Rec) } as never
    const run = a.run([20])
    const r = run.effects([{ op: 'net.pin', who: 'target' }], { user: a.a(1), target: { unit: 'f1' }, source: SRC, last })
    expect(r.ok).toBe(true)
    expect(a.f(1).out).toBe('pinned')
    expect(a.a(1).ap.now).toBe(ap)
    expect(a.a(1).pools.ram!.now).toBe(ram)
    // 餘韻沒疊滿的：不做、不擲骰（骰面是空的也不會丟錯）
    const b = arena(setup([ally(1)], [lace('minion', { layers: 0 })]))
    const r2 = b.run([]).effects([{ op: 'net.pin', who: 'target' }], { user: b.a(1), target: { unit: 'f1' }, source: SRC })
    expect(r2.ok).not.toBe(true)
    expect(b.f(1).out).toBeUndefined()
    // 格式：不認得的欄位被指出來
    expect(a.k.battle.effectProblems([{ op: 'net.pin', nope: 1 }]).join('')).toContain('nope')
    expect(a.k.battle.effectProblems([{ op: 'net.pin' }])).toEqual([])
    expect(a.k.battle.effectProblems([{ op: 'net.tether', who: 'target' }])).toEqual([])
  })

  it('打法是 capture 的敵人會靠過來釘人：我方第 1 格站著餘韻疊滿的人，它換到第 1 格並釘住他', () => {
    const grabber = lace('minion', {
      weapons: [], skills: { interface: 8 }, attrs: { ...laceUnit('minion', 1).attrs, intellect: 30 },
      ai: { focus: 1, floor: 1, mode: 'capture', fleeBelow: 0, prefer_slots: [1, 2], coverUse: 0.5 },
    })
    const a = arena(setup([ally(1, { layers: 3, weapons: [] }), ally(2, { weapons: [] })], [calmLace(), grabber]))
    expect(a.f(2).slot).toBe(2)
    // 站在第 1 格釘得到人的位置分（aiSlotScore）：第 1 格 4 分，第 2 格 0 分
    const pin = a.k.battle.getAction('net_pin')!
    expect(pin.aiSlotScore!(a.run(), a.f(2), 1)).toBe(4)
    expect(pin.aiSlotScore!(a.run(), a.f(2), 2)).toBe(0)
    // 不是 capture 的敵人沒有分數
    expect(pin.aiSlotScore!(a.run(), a.f(1), 1)).toBe(0)
    expect(pin.aiScore!(a.run(), a.f(1), a.a(1))).toBeNull()
    expect(pin.aiScore!(a.run(), a.f(2), a.a(1))).toBe(4)
    // 輪到它：自己換到第 1 格、然後釘住（固定種子）
    const b = a.battle
    b.turn = b.order.indexOf('f2')
    a.f(2).ap.now = a.f(2).ap.max
    for (let i = 0; i < 6 && a.battle.units.a1!.out === undefined && a.battle.order[a.battle.turn] === 'f2'; i++) {
      const draft = battleAuto(a.k, a.state)
      const change = draft.changes.find((c) => c.op === 'battle') as unknown as { state: Arena['battle'] }
      a.state.battle = change.state
      Object.assign(a, { battle: change.state })
    }
    expect(a.battle.units.f2!.slot).toBe(1)
    expect(a.battle.units.a1!.out).toBe('pinned')
  })
})

// ---- 二、拔線與投降 ----

describe('拔線（CYBERSPACE 6.7 節）與投降', () => {
  it('拔線一個人：他退出（jacked_out）、紀錄有 jack_out、戰鬥繼續；花 1 行動點、不花 RAM、要長按', () => {
    const a = arena(setup([ally(1), ally(2)], [lace()]))
    turnTo(a, 'a1')
    const o = opt(a, 'net_jack_out')
    expect(o.cost).toEqual({ ap: 1 })
    expect(o.hold).toBe(true)
    expect(o.group).toBe('system')
    const ram = a.a(1).pools.ram!.now
    expect(act(a, { action: 'net_jack_out' })).toEqual({ ok: true })
    expect(a.battle.units.a1!.out).toBe('jacked_out')
    expect(a.battle.units.a1!.pools.ram!.now).toBe(ram)
    expect(a.battle.result).toBeUndefined()
    expect(a.state.battle!.units.a2!.out).toBeUndefined()
  })

  it('四個人都拔線：結果 jack_out（不是戰敗）、沒有等著選的戰敗', async () => {
    const t = makeGame({ features: [deckFeature, netcombatFeature], content: [PACK], seed: 5 })
    const g = t.game
    g.startBattle(setup([0, 1, 2, 3].map((i) => calm(i)), [calmLace()]))
    for (let i = 0; i < 40 && !g.battle!.result; i++) {
      const cur = g.battle!.units[g.battle!.order[g.battle!.turn]!]!
      const r = cur.side === 'ally' ? g.battleAct({ action: 'net_jack_out' }) : g.battleNext()
      expect(r.status).toBe('applied')
    }
    expect(g.battle!.result!.outcome).toBe('jack_out')
    expect(isDefeat('jack_out')).toBe(false)
    expect(Object.values(g.battle!.units).filter((u) => u.side === 'ally').every((u) => u.out === 'jacked_out')).toBe(true)
    await g.finishBattle()
    expect(g.battle).toBeNull()
    expect(pendingDefeat(g.state)).toBeNull()
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'net_burn')).toBe(false)
  })

  it('三個人拔線、一個人被釘住：戰敗（lose），不是撤退（N12）', () => {
    const a = arena(setup([0, 1, 2, 3].map((i) => ally(i)), [lace()]))
    a.run().setOut(a.a(4), 'pinned')
    for (const id of ['a1', 'a2', 'a3']) {
      turnTo(a, id)
      expect(act(a, { action: 'net_jack_out' })).toEqual({ ok: true })
    }
    expect(a.battle.result!.outcome).toBe('lose')
  })

  it('有人倒下、其餘的人拔線：也是戰敗', () => {
    const a = arena(setup([ally(1), ally(2)], [lace()]))
    a.run().setOut(a.a(2), 'down')
    turnTo(a, 'a1')
    act(a, { action: 'net_jack_out' })
    expect(a.battle.result!.outcome).toBe('lose')
  })

  it('投降：結果 surrender（算戰敗），不花行動點、行動點是 0 也能投降；還站著的人沒有 net_burn', () => {
    const a = arena(setup([netAvatar(0, 1, { actor: 'pc', weapons: [gun()], ext: { net: NET(), deck: DECK } } as never), netAvatar(1, 1, { actor: 'n2', weapons: [gun()], ext: { net: NET(), deck: DECK } } as never)], [lace()]), { actors: [makeActor({ id: 'n2', name: '夥伴', role: 'companion' })] })
    turnTo(a, 'a1')
    a.a(1).ap.now = 0
    const o = opt(a, 'net_surrender')
    expect(o.cost).toEqual({ ap: 0 })
    expect(o.hold).toBe(true)
    expect(o.ok).toBe(true)
    expect(act(a, { action: 'net_surrender' })).toEqual({ ok: true })
    expect(a.battle.result!.outcome).toBe('surrender')
    expect(isDefeat('surrender')).toBe(true)
    const end = endBattle(a.k, a.state)
    expect(end.changes.some((c) => c.op === 'actor.condition')).toBe(false)
    expect(end.outcome.result).toBe('surrender')
  })

  it('內海沒有「脫離」：委託副本裡（escapable: false、origin.ext.commission）也只有拔線與投降；畫面資料標出是在委託裡', () => {
    const a = arena(setup([ally(1)], [lace()], { origin: { escapable: false, ext: { commission: 'c1', stage: 1, face: 'net' } } } as never))
    turnTo(a, 'a1')
    const ids = options(a).actions.map((x) => x.id)
    expect(ids).not.toContain('flee')
    expect(ids).toContain('net_jack_out')
    expect(ids).toContain('net_surrender')
    expect(netBattleView(a.k, a.state)!.commission).toBe(true)
    const plain = arena(setup([ally(1)], [lace()]))
    expect(netBattleView(plain.k, plain.state)!.commission).toBe(false)
  })
})

// ---- 三、打輸、打贏的後果 ----

describe('扣線、拆釘子、net_burn', () => {
  const downAll = (a: Arena, how = 'down'): BattleRun => {
    const run = a.run()
    for (const u of Object.values(a.battle.units).filter((x) => x.side === 'ally' && !x.out)) run.setOut(u, how)
    run.settle()
    return run
  }

  it('打輸而對面有 tether 標籤：沒逃掉的人都被扣線，紀錄 data.tethered 是 true（逃掉的不算）；對面沒有：沒有這個欄位', () => {
    const a = arena(setup([0, 1, 2, 3].map((i) => ally(i)), [lace('elite', { tags: ['lace', 'lace:pink', 'tether'] })]))
    const run = a.run()
    run.setOut(a.a(4), 'jacked_out')
    for (const id of ['a1', 'a2', 'a3']) run.setOut(a.battle.units[id]!, 'down')
    expect(a.battle.result!.outcome).toBe('lose')
    const beats = tagged(run.beats, 'tether')
    expect(beats).toHaveLength(1)
    expect(beats[0]!.data).toMatchObject({ tethered: true, units: ['a1', 'a2', 'a3'] })
    expect(a.a(1).ext.net).toMatchObject({ tethered: true })
    expect(a.a(4).ext.net).not.toHaveProperty('tethered')
    // 對面沒有 tether
    const b = arena(setup([ally(1), ally(2)], [lace('elite', { tags: ['lace', 'lace:white'] })]))
    const beatsB = downAll(b).beats
    expect(b.battle.result!.outcome).toBe('lose')
    expect(beatsB.some((x) => x.data && 'tethered' in x.data)).toBe(false)
    expect(b.a(1).ext.net).not.toHaveProperty('tethered')
  })

  it('打輸而對面有 tether，但場地是 safe（迷宮館的熔斷）、或贏的人全是野生（標籤 wild）：不扣線；還是會有 net_burn（M3-maze）', () => {
    const lose = (s: BattleSetup) => {
      const a = arena(s)
      const run = a.run()
      for (const u of Object.values(a.battle.units).filter((x) => x.side === 'ally')) run.setOut(u, 'down')
      expect(a.battle.result!.outcome).toBe('lose')
      return { a, run }
    }
    const tethers = (r: { a: Arena; run: BattleRun }) => r.run.beats.some((x) => x.data && x.data.tethered === true) || !!(r.a.a(1).ext.net as Rec | undefined)?.tethered
    const pink = (tags: string[]) => lace('elite', { tags: ['lace', 'lace:pink', 'tether', ...tags] })
    // 對照：沒有 safe 就扣線
    expect(tethers(lose(setup([ally(1), ally(2)], [pink([])])))).toBe(true)
    // 場地 safe：不扣線
    const safe = lose(setup([ally(1), ally(2)], [pink([])], { field: { safe: true } }))
    expect(tethers(safe)).toBe(false)
    expect(tagged(safe.run.beats, 'tether')).toHaveLength(0)
    // net.tether 標上的人也一樣不扣
    const marked = arena(setup([ally(1), ally(2)], [lace()], { field: { safe: true } }))
    const mr = marked.run()
    mr.effects([{ op: 'net.tether', who: 'target' }], { user: marked.f(1), target: { unit: 'a1' }, source: SRC })
    for (const u of Object.values(marked.battle.units).filter((x) => x.side === 'ally')) mr.setOut(u, 'down')
    expect(tagged(mr.beats, 'tether').some((b) => b.data?.tethered === true)).toBe(false)
    // 贏的人全是野生的：不扣線；只要有一個不是野生的就照扣
    expect(tethers(lose(setup([ally(1), ally(2)], [pink(['wild'])])))).toBe(false)
    expect(tethers(lose(setup([ally(1), ally(2)], [pink(['wild']), pink([])])))).toBe(true)
  })

  it('net.tether：這一場倒下的人不能斷線；打輸時就算對面沒有 tether，被標上的人也被扣線（其他人不算）；打贏時不留下什麼', () => {
    const a = arena(setup([ally(1), ally(2)], [lace()]))
    const run = a.run()
    run.effects([{ op: 'net.tether', who: 'target' }], { user: a.f(1), target: { unit: 'a1' }, source: SRC })
    expect(a.a(1).ext.net).toMatchObject({ tethered: true })
    expect(tagged(run.beats, 'tether')).toHaveLength(1)
    run.setOut(a.a(1), 'down')
    run.setOut(a.a(2), 'down')
    const t = tagged(run.beats, 'tether').find((b) => b.data?.tethered === true)!
    expect(t.data).toMatchObject({ units: ['a1'] })
    expect(a.a(2).ext.net).not.toHaveProperty('tethered')
    const w = arena(setup([ally(1), ally(2)], [lace()]))
    const rw = w.run()
    rw.effects([{ op: 'net.tether', who: 'target' }], { user: w.f(1), target: { unit: 'a1' }, source: SRC })
    rw.setOut(w.a(1), 'down')
    rw.setOut(w.f(1), 'down')
    expect(w.battle.result!.outcome).toBe('win')
    expect(rw.beats.some((x) => x.data && x.data.tethered === true)).toBe(false)
  })

  it('打贏而我方有人被釘住：data.unpinned 有他、他沒有被扣線、仍有 net_burn；沒有人被釘住就沒有這個欄位', () => {
    const a = arena(setup([netAvatar(0, 1, { actor: 'pc', weapons: [gun()], ext: { net: NET(), deck: DECK } } as never), ally(1)], [lace()]))
    const run = a.run()
    run.setOut(a.a(1), 'pinned')
    run.setOut(a.f(1), 'down')
    expect(a.battle.result!.outcome).toBe('win')
    const beat = tagged(run.beats, 'pin').find((b) => b.data && 'unpinned' in b.data)!
    expect(beat.data).toMatchObject({ unpinned: ['a1'] })
    expect(a.a(1).ext.net).not.toHaveProperty('tethered')
    expect(run.beats.some((x) => x.data && x.data.tethered === true)).toBe(false)
    const end = endBattle(a.k, a.state)
    expect(end.changes).toContainEqual(expect.objectContaining({ op: 'actor.condition', id: 'pc', condition: 'net_burn' }))
    expect(end.narration?.results?.some((l) => l.includes('被釘住'))).toBe(true)
    // 沒有人被釘住
    const b = arena(setup([ally(1)], [lace()]))
    const rb = b.run()
    rb.setOut(b.f(1), 'down')
    expect(rb.beats.some((x) => x.data && 'unpinned' in x.data)).toBe(false)
  })

  it('昏過去（burnout）、被釘住、倒下的角色結束之後各有 net_burn（一小時後到期）；拔線、投降、一直站著的沒有；safe 的場地照給', () => {
    const actors = ['n2', 'n3', 'n4'].map((id) => makeActor({ id, name: id, role: 'companion' }))
    const mk = (extra: Partial<BattleSetup> = {}) => arena(setup(
      ['pc', 'n2', 'n3', 'n4'].map((id, i) => netAvatar(i, 1, { actor: id, weapons: [gun()], ext: { net: NET(), deck: DECK } } as never)),
      [lace()], extra,
    ), { actors })
    const a = mk()
    const run = a.run()
    run.setOut(a.a(1), 'burnout')
    run.setOut(a.a(2), 'pinned')
    run.setOut(a.a(3), 'jacked_out')
    a.battle.result = { outcome: 'win', text: '測試。' }
    const end = endBattle(a.k, a.state)
    const burns = end.changes.filter((c) => c.op === 'actor.condition' && c.condition === 'net_burn') as unknown as Array<{ id: string; until: number }>
    expect(burns.map((c) => c.id).sort()).toEqual(['n2', 'pc'])
    const now = toMinutes(a.state.time)
    expect(burns.every((c) => c.until === now + 60)).toBe(true)
    // 套用之後：一小時內帶著、之後到期（核心看 until：過了就不算）
    a.k.changes.applyAll(a.state, end.changes)
    const cond = () => a.state.actors.pc!.conditions.find((c) => c.id === 'net_burn')
    expect(cond()!.until! > toMinutes(a.state.time)).toBe(true)
    a.k.changes.applyAll(a.state, [{ op: 'time', minutes: 59 }])
    expect(cond()!.until! > toMinutes(a.state.time)).toBe(true)
    a.k.changes.applyAll(a.state, [{ op: 'time', minutes: 1 }])
    expect(cond()!.until! > toMinutes(a.state.time)).toBe(false)
    // 場地 safe：核心不加沉溺，這裡照給
    const s = mk({ field: { safe: true } })
    s.run().setOut(s.a(1), 'burnout')
    s.battle.result = { outcome: 'win', text: '測試。' }
    const e2 = endBattle(s.k, s.state)
    expect(e2.changes.some((c) => c.op === 'actor.condition' && c.condition === 'net_burn')).toBe(true)
    expect(e2.changes.some((c) => c.op === 'actor.track' && c.track === 'sink')).toBe(false)
  })

  it('規則表 burn_minutes 可以改；已經有更久的 net_burn 不縮短', () => {
    const k = createKernel([...FEATURES, combatFeature])
    k.content.loadPack(PACK)
    k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', burn_minutes: 30 }] } } as unknown as ContentPack)
    readyFeatures(k)
    expect(netcombatRules(k).burn_minutes).toBe(30)
    const state = makeState()
    state.actors.pc!.conditions.push({ id: 'net_burn', until: toMinutes(state.time) + 500 })
    const battle = clone(setupBattle(k, state, setup([netAvatar(0, 1, { actor: 'pc', weapons: [gun()], ext: { net: NET(), deck: DECK } } as never)], [lace()])).battle)
    state.battle = battle
    new BattleRun(k, state, battle).setOut(battle.units.a1!, 'burnout')
    battle.result = { outcome: 'lose', text: '測試。' }
    const end = endBattle(k, state)
    expect(end.changes).toContainEqual(expect.objectContaining({ op: 'actor.condition', id: 'pc', condition: 'net_burn', until: toMinutes(state.time) + 500 }))
  })
})

// ---- 四、追蹤度 ----

describe('戰鬥裡的追蹤度（CYBERSPACE 6.8 節）', () => {
  const WHITE = (o: Rec = {}) => ({ from: 'unit', unit: lace('minion', { name: '白蕾絲', weapons: [], tags: ['lace', 'lace:white'], ...o }) })
  const mk = (trace: number, net: Rec = {}, allies: unknown[] = [calm(1)], foes: unknown[] = [calmLace()]) =>
    arena(setup(allies, foes, { field: { trace }, ...withNet(net) } as never))

  it('從 20 起，第 2 輪起每輪 +3（第 1 輪不加）；每次變動記一拍 trace（帶新的值與加了多少）', () => {
    const a = mk(20)
    expect(traceOf(a)).toBe(20)
    const beats = rounds(a, 3)
    expect(a.battle.round).toBe(4)
    expect(traceOf(a)).toBe(29)
    const t = tagged(beats, 'trace')
    expect(t.map((b) => b.data)).toEqual([{ value: 23, amount: 3 }, { value: 26, amount: 3 }, { value: 29, amount: 3 }])
    expect(a.battle.field.t30).toBeUndefined()
  })

  it('跨過 30：reinforce.t30 的人下一輪進場，只叫一次；牠帶 lace:white，之後每輪 +8；牠不是第一次就在場', () => {
    const a = mk(20, { reinforce: { t30: [WHITE()] } })
    rounds(a, 3)
    expect(traceOf(a)).toBe(29)
    // 第 5 輪開頭：32，跨過 30，叫人（還在後方，下一輪才進場）
    const beats = rounds(a, 1)
    expect(a.battle.round).toBe(5)
    expect(traceOf(a)).toBe(32)
    expect(a.battle.field.t30).toBe(true)
    expect(tagged(beats, 'call_in')).toHaveLength(1)
    const white = Object.values(a.battle.units).find((u) => u.name === '白蕾絲')!
    expect(white.slot).toBe(0)
    expect(a.battle.called).toContain(white.id)
    // 下一輪開頭：牠補進場，這一輪 +3 ＋ 5
    const b2 = rounds(a, 1)
    expect(a.battle.round).toBe(6)
    expect(white.slot).toBeGreaterThan(0)
    expect(traceOf(a)).toBe(40)
    expect(tagged(b2, 'trace').at(-1)!.data).toMatchObject({ value: 40, amount: 8 })
    // 之後每輪 +8；不會再叫（只叫一次）
    const before = Object.keys(a.battle.units).length
    rounds(a, 2)
    expect(traceOf(a)).toBe(56)
    expect(Object.keys(a.battle.units)).toHaveLength(before)
    // 場上有兩隻白蕾絲也只加一次（N32）
    a.battle.units.f9 = { ...clone(white), id: 'f9', slot: 4 }
    a.battle.order.push('f9')
    rounds(a, 1)
    expect(traceOf(a)).toBe(64)
  })

  it('60 的增援同理：reinforce.t60 的人在跨過 60 的那一輪叫、各只叫一次；兩個門檻同一輪都跨過就都叫', () => {
    const elite = { from: 'unit', unit: lace('elite', { name: '精英蕾絲', weapons: [] }) }
    const a = mk(58, { reinforce: { t30: [WHITE()], t60: [elite] } })
    // 第 2 輪 +3：61，一口氣跨過 30 與 60
    const beats = rounds(a, 1)
    expect(traceOf(a)).toBe(61)
    expect(a.battle.field.t30).toBe(true)
    expect(a.battle.field.t60).toBe(true)
    expect(tagged(beats, 'call_in')).toHaveLength(2)
    rounds(a, 3)
    expect(Object.values(a.battle.units).filter((u) => u.name === '精英蕾絲')).toHaveLength(1)
    expect(Object.values(a.battle.units).filter((u) => u.name === '白蕾絲')).toHaveLength(1)
  })

  it('reinforce 可以是單一一筆來源；沒寫的門檻也記成跨過、不丟錯', () => {
    const a = mk(28, { reinforce: { t30: WHITE() } })
    rounds(a, 1)
    expect(Object.values(a.battle.units).filter((u) => u.name === '白蕾絲')).toHaveLength(1)
    const b = mk(28)
    rounds(b, 1)
    expect(b.battle.field.t30).toBe(true)
    expect(Object.keys(b.battle.units)).toHaveLength(2)
  })

  it('我方有 trace_round −2 的修正：每輪 +1（最少 0）；兩個這樣的人合計 −4，每輪 0（沒有變動就沒有 trace 那一拍）', () => {
    const a = mk(20, {}, [calm(1, { tags: ['netrunner', 't.trace'] })])
    const beats = rounds(a, 3)
    expect(traceOf(a)).toBe(23)
    expect(tagged(beats, 'trace')).toHaveLength(3)
    const b = mk(20, {}, [calm(1, { tags: ['t.trace'] }), calm(2, { tags: ['t.trace'] })])
    const bb = rounds(b, 3)
    expect(traceOf(b)).toBe(20)
    expect(tagged(bb, 'trace')).toEqual([])
  })

  it('夾在 −30～100：到 100 不再往上；net.trace 降到 −30 為止', () => {
    const a = mk(99)
    rounds(a, 1)
    expect(traceOf(a)).toBe(100)
    const t = tagged(a.run().beats, 'trace')
    expect(t).toEqual([])
    const b = mk(-25)
    b.run().effects([{ op: 'net.trace', amount: -20 }], { user: b.a(1), source: SRC })
    expect(traceOf(b)).toBe(-30)
    b.run().effects([{ op: 'net.trace', amount: -20 }], { user: b.a(1), source: SRC })
    expect(traceOf(b)).toBe(-30)
  })

  it('到 90 開始倒數（規則的 3 輪）：每輪開頭少 1，第三輪開頭結果是 lose、field.located 是 true、記一拍 located', () => {
    const a = mk(81)
    const beats: TimelineBeat[] = []
    beats.push(...rounds(a, 3))
    expect(traceOf(a)).toBe(90)
    expect(a.battle.field.located).toBe(3)
    expect(a.battle.result).toBeUndefined()
    beats.push(...rounds(a, 1))
    expect(a.battle.field.located).toBe(2)
    beats.push(...rounds(a, 1))
    expect(a.battle.field.located).toBe(1)
    expect(a.battle.result).toBeUndefined()
    beats.push(...rounds(a, 1))
    expect(a.battle.result).toMatchObject({ outcome: 'lose' })
    expect(a.battle.field.located).toBe(true)
    expect(a.battle.round).toBe(7)
    expect(tagged(beats, 'located').length).toBe(4)
    expect(tagged(beats, 'located').at(-1)!.data).toEqual({ located: true })
    // 這一場是戰敗：走一般的戰敗流程
    expect(isDefeat(a.battle.result!.outcome)).toBe(true)
  })

  it('開戰的人可以改倒數的輪數（origin.ext.net.locate_rounds）；規則表 trace.locate_rounds 也可以改', () => {
    const a = mk(87, { locate_rounds: 1 })
    rounds(a, 1)
    expect(a.battle.field.located).toBe(1)
    rounds(a, 1)
    expect(a.battle.result).toMatchObject({ outcome: 'lose' })
    const k = createKernel([...FEATURES, combatFeature])
    k.content.loadPack(PACK)
    k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', trace: { locate_rounds: 5, round: 4 } }] } } as unknown as ContentPack)
    readyFeatures(k)
    expect(netcombatRules(k).trace).toEqual({ ...DEFAULT_NETCOMBAT_RULES.trace, locate_rounds: 5, round: 4 })
  })

  it('倒數中用 net.trace 降到 85：倒數取消（field.located 拿掉）；之後再爬到 90 重新倒數', () => {
    const a = mk(84)
    rounds(a, 1)
    expect(traceOf(a)).toBe(87)
    rounds(a, 1)
    expect(traceOf(a)).toBe(90)
    expect(a.battle.field.located).toBe(3)
    const run = a.run()
    run.effects([{ op: 'net.trace', amount: -5 }], { user: a.a(1), source: SRC })
    expect(traceOf(a)).toBe(85)
    expect(a.battle.field.located).toBeUndefined()
    expect(tagged(run.beats, 'trace').at(-1)!.data).toMatchObject({ value: 85, amount: -5 })
    expect(tagged(run.beats, 'located').at(-1)!.data).toMatchObject({ cancelled: true })
    // 下一輪 88：沒有倒數、戰鬥沒結束；再下一輪 91：重新倒數三輪
    rounds(a, 1)
    expect(traceOf(a)).toBe(88)
    expect(a.battle.field.located).toBeUndefined()
    rounds(a, 1)
    expect(traceOf(a)).toBe(91)
    expect(a.battle.field.located).toBe(3)
    expect(a.battle.result).toBeUndefined()
  })

  it('效果 net.trace 加的也會跨過門檻（叫增援）；格式：amount 要寫', () => {
    const a = mk(25, { reinforce: { t30: [WHITE()] } })
    const run = a.run()
    run.effects([{ op: 'net.trace', amount: 6 }], { user: a.a(1), source: SRC })
    expect(traceOf(a)).toBe(31)
    expect(a.battle.field.t30).toBe(true)
    expect(tagged(run.beats, 'call_in')).toHaveLength(1)
    expect(a.k.battle.effectProblems([{ op: 'net.trace' }]).join('')).toContain('amount')
    expect(a.k.battle.effectProblems([{ op: 'net.trace', amount: -5 }])).toEqual([])
  })

  it('沒有 battle.field.trace 的戰鬥打十輪：紀錄裡沒有任何 trace 或 located 那一拍；net.trace 什麼都不做', () => {
    const a = arena(setup([calm(1)], [calmLace()], withNet({ reinforce: { t30: [WHITE()] } })))
    const beats = rounds(a, 10)
    expect(a.battle.round).toBe(11)
    expect(tagged(beats, 'trace')).toEqual([])
    expect(tagged(beats, 'located')).toEqual([])
    expect(a.battle.field.trace).toBeUndefined()
    const run = a.run()
    run.effects([{ op: 'net.trace', amount: 50 }], { user: a.a(1), source: SRC })
    expect(a.battle.field.trace).toBeUndefined()
    expect(run.beats).toEqual([])
    expect(netBattleView(a.k, a.state)).toMatchObject({ trace: null, located: null })
  })

  it('現實的戰鬥完全不受影響（沒有 trace、沒有這個功能的行動）', () => {
    const k = createKernel([...FEATURES, combatFeature])
    k.content.loadPack(PACK)
    readyFeatures(k)
    expect(k.battle.actionsFor('meat').some((d) => d.id.startsWith('net_'))).toBe(false)
  })

  it('四對四：叫增援沒有空格——不丟錯、留著；有人倒下之後的下一輪開頭補進後方，再下一輪進場', () => {
    const a = arena(setup([0, 1, 2, 3].map((i) => calm(i)), [0, 1, 2, 3].map(() => calmLace()), { field: { trace: 28 }, ...withNet({ reinforce: { t30: [WHITE()] } }) } as never))
    expect(() => rounds(a, 1)).not.toThrow()
    expect(traceOf(a)).toBe(31)
    expect(a.battle.field.t30).toBe(true)
    expect(a.battle.field.t30_n).toBe(0)
    expect(Object.values(a.battle.units).filter((u) => u.side === 'foe')).toHaveLength(4)
    // 還是滿的：再一輪也沒有
    rounds(a, 1)
    expect(Object.values(a.battle.units).filter((u) => u.side === 'foe')).toHaveLength(4)
    // 一個倒下：下一輪開頭叫進來（排在後方），再下一輪補上場；只叫這一次
    a.run().setOut(a.f(1), 'down')
    rounds(a, 1)
    const white = Object.values(a.battle.units).find((u) => u.name === '白蕾絲')!
    expect(white).toBeDefined()
    expect(a.battle.field.t30_n).toBe(1)
    expect(white.slot).toBe(0)
    rounds(a, 1)
    expect(white.slot).toBeGreaterThan(0)
    expect(Object.values(a.battle.units).filter((u) => u.name === '白蕾絲')).toHaveLength(1)
  })

  it('畫面資料 netBattleView：追蹤度、三個門檻、定位的倒數', () => {
    const a = mk(87)
    expect(netBattleView(a.k, a.state)).toMatchObject({ trace: 87, thresholds: { t1: 30, t2: 60, t3: 90 }, located: null })
    rounds(a, 1)
    expect(netBattleView(a.k, a.state)).toMatchObject({ trace: 90, located: 3 })
  })
})

// ---- 五、整場 ----

describe('整場：存檔、結束的報告', () => {
  const start = (seed: number, trace: number) => {
    const t = makeGame({ features: [deckFeature, netcombatFeature], content: [PACK], seed })
    t.game.startBattle(setup([calm(0), calm(1)], [calmLace()], { field: { trace }, ...withNet({}) } as never))
    return t.game
  }
  const untilRound = (g: ReturnType<typeof start>, n: number) => {
    for (let i = 0; i < 200 && !g.battle!.result && g.battle!.round < n; i++) expect(g.battleNext({ anyone: true }).status).toBe('applied')
  }
  const finish = (g: ReturnType<typeof start>) => {
    for (let i = 0; i < 400 && !g.battle!.result; i++) expect(g.battleNext({ anyone: true }).status).toBe('applied')
    return g.battle!.result!.outcome
  }

  it('打到一半（倒數中）存檔再讀，結果一樣：同樣的輪數被定位、同一個狀態', async () => {
    for (const seed of [3, 9]) {
      const whole = start(seed, 84)
      expect(finish(whole)).toBe('lose')
      expect(whole.battle!.field.located).toBe(true)
      const part = start(seed, 84)
      untilRound(part, 4)
      expect(typeof part.battle!.field.located).toBe('number')
      expect(part.load(part.save('manual', '2026-11-24T00:00:00Z'))).toBeNull()
      expect(part.battle!.field.located).toBeDefined()
      expect(finish(part)).toBe('lose')
      expect(part.battle!.round).toBe(whole.battle!.round)
      expect(stateHash(part.state)).toBe(stateHash(whole.state))
    }
  })

  it('被定位的戰敗：結束的報告有 located 那一拍；沒有扣線、沒有人 net_burn；不變式沒有違規', async () => {
    const g = start(4, 84)
    g.k.probe.start()
    finish(g)
    const res = await g.finishBattle()
    expect(res.reports.length).toBeGreaterThan(0)
    const timeline = res.reports.flatMap((r) => r.timeline)
    expect(timeline.some((b) => b.tag === 'located' && b.data?.located === true)).toBe(true)
    expect(timeline.some((b) => b.data && 'tethered' in b.data)).toBe(false)
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'net_burn')).toBe(false)
    expect(commitViolations(g.k, g.k.probe.stop())).toEqual([])
    // 戰敗等著三選一（走一般的戰敗流程）
    expect(pendingDefeat(g.state)).not.toBeNull()
  })

  it('打輸而對面有 tether：結束的報告（整場的紀錄）有 data.tethered；倒下的角色有 net_burn、被扣線不是放人', async () => {
    const t = makeGame({ features: [deckFeature, netcombatFeature], content: [PACK], seed: 6 })
    const g = t.game
    const victim = netAvatar(0, 1, { actor: 'pc', weapons: [], layers: 3, load: { now: 37, max: 38 }, ext: { net: NET(), deck: DECK } } as never)
    const hunter = lace('elite', { weapons: [netWeapon(40, 12, { id: 'cs_h', name: '追獵', class: 'rifle', range: [1, 7] })], tags: ['lace', 'lace:pink', 'tether'] })
    g.startBattle(setup([victim], [hunter]))
    for (let i = 0; i < 200 && !g.battle!.result; i++) expect(g.battleNext({ anyone: true }).status).toBe('applied')
    expect(g.battle!.result!.outcome).toBe('lose')
    const res = await g.finishBattle()
    const timeline = res.reports.flatMap((r) => r.timeline)
    const tether = timeline.find((b) => b.data?.tethered === true)
    expect(tether).toBeDefined()
    expect(tether!.tag).toBe('tether')
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'net_burn')).toBe(true)
  })

  it('打贏而有人被釘住：整場的紀錄有 data.unpinned', async () => {
    const t = makeGame({ features: [deckFeature, netcombatFeature], content: [PACK], seed: 8 })
    const g = t.game
    // 一個站著的人，一個被釘住的人（直接用核心的退出），敵人在最後一擊倒下
    g.startBattle(setup([netAvatar(0, 1, { weapons: [netWeapon(60, 30, { id: 'cs_big', name: '大砲', class: 'rifle', range: [1, 7] })], ext: { net: NET(), deck: DECK } } as never), calm(1, { actor: 'pc' })], [lace('minion', { load: { now: 0, max: 1 }, layers: 1 })]))
    // 輪到 a1 之前，把 a2 釘住（直接用核心的退出）；之後由程式代打到分出結果：a1 的大砲讓敵人過載、餘韻已滿，再過載就倒下
    for (let i = 0; i < 10 && g.battle!.order[g.battle!.turn] !== 'a1'; i++) expect(g.battleNext({ anyone: true }).status).toBe('applied')
    expect(g.battle!.order[g.battle!.turn]).toBe('a1')
    new BattleRun(g.k, g.state, g.battle!).setOut(g.battle!.units.a2!, 'pinned')
    for (let i = 0; i < 200 && !g.battle!.result; i++) expect(g.battleNext({ anyone: true }).status).toBe('applied')
    expect(g.battle!.result!.outcome).toBe('win')
    const res = await g.finishBattle()
    const timeline = res.reports.flatMap((r) => r.timeline)
    expect(timeline.find((b) => b.data && 'unpinned' in b.data)!.data).toMatchObject({ unpinned: ['a2'] })
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'net_burn')).toBe(true)
  })
})

// ---- 六、規則表 ----

describe('規則表 netcombat_rule：trace、burn_minutes', () => {
  it('預設：trace { round 3, white 5, t1 30, t2 60, t3 90, locate_rounds 3 }、burn_minutes 60；資料可以蓋，壞的整批擋下', () => {
    expect(DEFAULT_NETCOMBAT_RULES.trace).toEqual({ round: 3, white: 5, t1: 30, t2: 60, t3: 90, locate_rounds: 3 })
    expect(DEFAULT_NETCOMBAT_RULES.burn_minutes).toBe(60)
    const bad = (rule: Rec) => {
      const k = createKernel([...FEATURES, combatFeature])
      expect(() => k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', ...rule }] } } as unknown as ContentPack)).toThrow()
    }
    bad({ trace: { t1: 70 } })
    bad({ trace: { nope: 1 } })
    bad({ trace: { locate_rounds: 0 } })
    bad({ trace: { round: -1 } })
    bad({ trace: { t3: 200 } })
    bad({ trace: 5 })
    bad({ burn_minutes: -5 })
    const k = createKernel([...FEATURES, combatFeature])
    k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', trace: { t1: 20, t2: 50, t3: 80 }, burn_minutes: 120 }] } } as unknown as ContentPack)
    expect(netcombatRules(k)).toMatchObject({ trace: { t1: 20, t2: 50, t3: 80, round: 3 }, burn_minutes: 120 })
  })
})

// ---- 七、行動的宣告 ----

describe('三個新行動的宣告', () => {
  it('釘住、拔線、投降都寫了圖示與說明、只在內海；現實戰場沒有', () => {
    const k = createKernel([...FEATURES, combatFeature])
    k.content.loadPack(PACK)
    readyFeatures(k)
    for (const id of ['net_pin', 'net_jack_out', 'net_surrender']) {
      const d = k.battle.getAction(id)!
      expect(d.icon, id).toBeTruthy()
      expect(d.desc, id).toMatch(/[。）]$/)
      expect(d.modes, id).toEqual(['net'])
    }
    expect(k.battle.actionsFor('meat').map((d) => d.id)).not.toContain('net_pin')
  })

  it('內海的行動表只有這個功能與核心的：行動 id 都是 net_ 開頭（管理行動是 adm_），或換位、結束回合', () => {
    const a = arena(BATTLE_SETUPS.net())
    for (const d of a.k.battle.actionsFor('net')) expect(['end_turn', 'move'].includes(d.id) || d.id.startsWith('net_') || d.id.startsWith('adm_'), d.id).toBe(true)
  })
})
