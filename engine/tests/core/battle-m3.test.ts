// 驗收測試：dev/work/M3-core-battle.md（戰場的缺口：屬性的代替、防護讀哪個數值、個人的脫離、閃斷、新的修正與事件、斷路、safe、testkit 的內海情境）。
// 規格：dev/adr/0018 第一節與 N3、N12；CYBERSPACE 4.1、6.1、6.2、6.4、6.7 節。
// 只用核心與測試用的行動表（TEST_COMBAT、TEST_NET_COMBAT）；內容用測試自帶的最小資料。
// 同步原則（core/rules/sync.ts）的驗收在 tests/core/sync.test.ts。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleState, BattleUnit, Feature, Game, Kernel } from '../../src'
import { BATTLE_EVENTS, BattleRun, DEFAULT_MODES, DEFAULT_STATUSES, FLASH, LOSE_TURN, MOD_KINDS, MOVE, advance, battleOptions, battleProblems, clone, createKernel, currentUnit, endBattle, losingTurn, modeOf, pendingDefeat, setupBattle, unitFromActor, unitsOf } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, TEST_NET_ACTIONS, TEST_NET_COMBAT, laceUnit, makeBattleGame, makeGame, makeKernel, makeState, netAvatar, observed, playOut, stateHash } from '../../src/testkit'
import { arena, duel, foe, one, raw } from '../helpers/battle'

// ---- 小工具 ----

/** 內海的小場地：化身對蕾絲，遮蔽（防火牆）逐格給（預設全部暴露）。 */
function netDuel(allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup {
  return { mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), ...more }
}
const netArena = (setup: BattleSetup, prepare: (k: Kernel) => void = () => {}) => arena(setup, [TEST_NET_COMBAT], prepare)

/** 一直輪下去，直到輪到某個人（測試用：不管輪到的是誰都往下輪）。 */
const runTo = (run: BattleRun, id: string): void => {
  for (let guard = 0; guard < 60 && currentUnit(run.battle)?.id !== id && !run.over; guard++) advance(run)
  expect(currentUnit(run.battle)?.id).toBe(id)
}
/** 一直輪下去，直到進入第 n 回合。 */
const toRound = (run: BattleRun, n: number): void => {
  for (let guard = 0; guard < 200 && run.battle.round < n && !run.over; guard++) advance(run)
}
const hasStatus = (u: BattleUnit, id: string): boolean => u.statuses.some((s) => s.id === id)
const tagged = (r: BattleRun, tag: string) => r.beats.filter((b) => b.tag === tag)

/** 一場內海戰鬥提交一步（直接把整份戰鬥狀態交上去，和 tests/core/activity.test.ts 的 decide 同一個做法）。 */
const commitStep = (g: Game, b: BattleState): void => {
  g.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: b.result?.outcome ?? 'step', summary: '一步。' } }, { attach: true, turn: false })
}

const defineStat = (k: Kernel, id: string, value: number): void => k.stats.defineStat({ id, owner: 'test', name: id, base: () => value })

// ---- 1. 防護讀哪個數值 ----

describe('防護讀哪個數值（mode.guardStat；CYBERSPACE 6.1 節）', () => {
  /** 一個角色在兩個戰場裡的防護。 */
  const guards = (k: Kernel): { meat: number; net: number } => {
    const state = makeState()
    return {
      meat: unitFromActor(k, state, 'pc', modeOf(k.content, 'meat')!, 1).armor,
      net: unitFromActor(k, state, 'pc', modeOf(k.content, 'net')!, 1).armor,
    }
  }

  it('核心的預設：現實讀 armor、內海讀 net_guard', () => {
    expect(DEFAULT_MODES.meat!.guardStat).toBe('armor')
    expect(DEFAULT_MODES.net!.guardStat).toBe('net_guard')
  })

  it('註冊一個回傳 4 的 armor：這個角色進內海防護是 0，現實是 4', () => {
    const k = makeKernel()
    defineStat(k, 'armor', 4)
    expect(guards(k)).toEqual({ meat: 4, net: 0 })
  })

  it('再註冊回傳 2 的 net_guard：內海是 2、現實仍是 4', () => {
    const k = makeKernel()
    defineStat(k, 'armor', 4)
    defineStat(k, 'net_guard', 2)
    expect(guards(k)).toEqual({ meat: 4, net: 2 })
  })

  it('什麼都沒註冊：兩邊都是 0；loadout 給的 armor 兩邊都照加（防護構裝的功能也能經 loadout 給）', () => {
    const k = makeKernel()
    expect(guards(k)).toEqual({ meat: 0, net: 0 })
    k.battle.loadout('test', () => ({ armor: 1 }))
    defineStat(k, 'armor', 4)
    defineStat(k, 'net_guard', 2)
    expect(guards(k)).toEqual({ meat: 5, net: 3 })
  })

  it('資料的 battle_mode 沒寫 guard_stat：照核心的預設（現實 armor、內海 net_guard）；寫了就讀它', () => {
    const k = makeKernel()
    defineStat(k, 'armor', 4)
    defineStat(k, 'net_guard', 2)
    defineStat(k, 'plate', 7)
    const MEAT = { id: 'meat', name: '現實', layer: 'meat', tracks: ['hp', 'load'], overload: 'lose_turn', afterglow: { roll: -1, load_dealt_pct: 10 }, cover_names: ['暴露', '半掩體', '掩體'], cover_word: '遮蔽' }
    const NET = { ...MEAT, id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', cover_word: '防火牆' }
    k.content.load('battle_mode', [MEAT, NET])
    expect(guards(k)).toEqual({ meat: 4, net: 2 })
    k.content.load('battle_mode', [{ ...MEAT, guard_stat: 'plate' }])
    expect(guards(k)).toEqual({ meat: 7, net: 2 })
    // 資料新增的戰場：層是 net 就讀 net_guard，其餘讀 armor
    k.content.load('battle_mode', [{ ...NET, id: 'arena_net', name: '網內競技場' }, { ...MEAT, id: 'arena', name: '競技場' }])
    expect(modeOf(k.content, 'arena_net')!.guardStat).toBe('net_guard')
    expect(modeOf(k.content, 'arena')!.guardStat).toBe('armor')
  })

  it('開戰時帶進去的就是這個數字：{ from: actor } 的化身防護是 net_guard', () => {
    const k = createKernel([TEST_NET_COMBAT])
    defineStat(k, 'armor', 4)
    defineStat(k, 'net_guard', 2)
    const state = makeState()
    const run = setupBattle(k, state, { mode: 'net', grade: 1, allies: [{ from: 'actor', id: 'pc' }], foes: [raw(laceUnit())] })
    expect(run.battle.units.a1!.armor).toBe(2)
  })
})

// ---- 2. 屬性的代替 ----

describe('屬性的代替（mode.attrAs；CYBERSPACE 4.1 節）', () => {
  const ATTRS = { body: 6, reflex: 10, tech: 10, intellect: 10, resolve: 16, charm: 10 }
  // 體格 6（調整值 −2）、意志 16（調整值 +3）

  it('內海：run.save(u, body, …) 用的是意志的調整值；其餘的屬性照舊', () => {
    const a = netArena(netDuel([netAvatar(0, 1, { attrs: ATTRS })], [laceUnit()]))
    const me = a.ally(1)
    const r = a.run([10, 10]).save(me, 'body', undefined, 15, '撐住')
    expect(r.roll.total).toBe(10 + 3)
    expect(r.roll.parts[0]).toMatchObject({ label: '意志', value: 3, source: 'attr' })
    expect(r.roll.attr).toBe('resolve')
    expect(r.ok).toBe(false)
    // 意志本來就是意志、反應照舊
    expect(a.run([10]).save(me, 'resolve', undefined, 15, '撐住').roll.total).toBe(13)
    expect(a.run([10]).save(me, 'reflex', undefined, 15, '閃').roll.total).toBe(10)
  })

  it('現實：run.save(u, body, …) 用體格的調整值，不變', () => {
    const a = arena(duel([one({ attrs: ATTRS })], [foe()]))
    const r = a.run([10]).save(a.ally(1), 'body', undefined, 15, '撐住')
    expect(r.roll.total).toBe(10 - 2)
    expect(r.roll.parts[0]).toMatchObject({ label: '體格', value: -2 })
    expect(r.roll.attr).toBe('body')
  })

  it('資料的 attr_as 蓋掉預設（寫 {} 是不換）；沒寫照核心的預設', () => {
    const k = makeKernel()
    const NET = { id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', afterglow: { roll: 1, load_dealt_pct: 10 }, cover_names: ['a', 'b', 'c'], cover_word: '防火牆' }
    k.content.load('battle_mode', [NET])
    expect(modeOf(k.content, 'net')!.attrAs).toEqual({ body: 'resolve' })
    k.content.load('battle_mode', [{ ...NET, attr_as: { charm: 'tech' } }])
    expect(modeOf(k.content, 'net')!.attrAs).toEqual({ charm: 'tech' })
    k.content.load('battle_mode', [{ ...NET, attr_as: {} }])
    expect(modeOf(k.content, 'net')!.attrAs).toBeUndefined()
  })
})

// ---- 3. 內海沒有空手 ----

describe('內海沒有空手：沒有生命那一條的戰場，沒給武器的角色手上是空的', () => {
  it('unitFromActor：內海沒有武器是 []；現實沒有武器的人照舊是空手；loadout 有給就照給', () => {
    const k = makeKernel()
    const state = makeState()
    expect(unitFromActor(k, state, 'pc', modeOf(k.content, 'net')!, 1).weapons).toEqual([])
    expect(unitFromActor(k, state, 'pc', modeOf(k.content, 'meat')!, 1).weapons).toMatchObject([{ id: 'unarmed', class: 'melee', traits: ['melee'] }])
    k.battle.loadout('test', () => ({ weapons: [{ ...netAvatar().weapons[0]!, id: 'gun' }] }))
    expect(unitFromActor(k, state, 'pc', modeOf(k.content, 'net')!, 1).weapons.map((w) => w.id)).toEqual(['gun'])
  })

  it('battleOptions 不丟錯：沒有武器的化身看得到攻擊但灰掉（原因一句），回填、換位、結束回合照常；現實的空手照舊能攻擊', () => {
    const netGame = makeBattleGame({ battle: { mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(laceUnit())], origin: { escapable: true } } })
    const b = netGame.game.state.battle!
    expect(b.units.a1!.weapons).toEqual([])
    b.turn = b.order.indexOf('a1')
    b.units.a1!.pools.ram!.now = 1
    const o = netGame.game.battleOptions()!
    expect(o).toMatchObject({ current: 'a1', waiting: 'player' })
    const attack = o.actions.find((x) => x.id === TEST_NET_ACTIONS.ATTACK)!
    expect(attack).toMatchObject({ ok: false, blocks: ['手上沒有攻擊構裝。'] })
    expect(o.actions.find((x) => x.id === TEST_NET_ACTIONS.REFILL)).toMatchObject({ ok: true })
    expect(o.actions.map((x) => x.id)).toEqual(expect.arrayContaining([MOVE, 'end_turn']))
    // 距離表也不丟錯
    expect(Object.keys(o.distances)).toEqual(['f1'])

    const meat = makeBattleGame({ battle: { mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())], origin: { escapable: true } } })
    const mb = meat.game.state.battle!
    expect(mb.units.a1!.weapons.map((w) => w.id)).toEqual(['unarmed'])
    mb.turn = mb.order.indexOf('a1')
    expect(meat.game.battleOptions()!.actions.find((x) => x.id === 'test.attack')).toMatchObject({ blocks: [] })
  })

  it('AI 代打：沒有武器的化身不丟錯（打不出去就結束回合）', () => {
    const { game } = makeBattleGame({ battle: { mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(laceUnit())], origin: { escapable: true } } })
    for (let i = 0; i < 12 && !game.battle!.result; i++) expect(game.battleNext({ anyone: true }).status).toBe('applied')
    expect(battleProblems(game.battle!)).toEqual([])
  })
})

// ---- 4. 閃斷（N3） ----

describe('閃斷（CYBERSPACE 6.2 節；dev/adr/0018 N3）', () => {
  /** 一個化身（a1）對兩隻蕾絲（f1、f2），先攻的順序固定成 a1、f1、f2，現在是 f1 的回合；每個人都已經過了第一個回合（回復照常）。 */
  function flashArena(prepare: (k: Kernel) => void = () => {}) {
    const a = netArena(netDuel([netAvatar(0)], [laceUnit(), laceUnit()]), prepare)
    const b = a.battle
    b.order = ['a1', 'f1', 'f2']
    b.turn = 1
    b.acting = 'f1'
    for (const u of Object.values(b.units)) u.uses.turns = 1
    return a
  }

  it('核心內建狀態 flash：名字「閃斷」，到自己的回合結束、帶 noRegen: [ram]；DEFAULT_STATUSES 與 FLASH 一致', () => {
    expect(FLASH).toBe('flash')
    expect(DEFAULT_STATUSES.flash).toMatchObject({ id: 'flash', name: '閃斷', noRegen: ['ram'], until: 'own_turn_end', turns: 1 })
    expect(DEFAULT_STATUSES[LOSE_TURN]!.noRegen).toBeUndefined()
  })

  it('別人的回合被灌到過載：RAM 歸零、帶 flash；他的下一個回合開始時 RAM 還是 0，那個回合結束 flash 拿掉，再下一個回合照常回復', () => {
    const a = flashArena()
    const run = a.run()
    const me = a.ally(1)
    me.pools.ram!.now = 3
    run.addLoad(me, 999, a.foe(1))
    expect(me.pools.ram!.now).toBe(0)
    expect(me.layers).toBe(1)
    expect(hasStatus(me, FLASH)).toBe(true)
    expect(losingTurn(me)).toBe(false)
    expect(tagged(run, 'overload').map((b) => b.data)).toEqual([{ target: 'a1', layers: 1, flash: true }])
    // 他的下一個回合：沒有回復，flash 還在；行動點照常回復
    me.ap.now = 0
    runTo(run, 'a1')
    expect(me.pools.ram!.now).toBe(0)
    expect(me.ap.now).toBe(me.ap.regen)
    expect(hasStatus(me, FLASH)).toBe(true)
    // 這個回合結束：flash 拿掉
    advance(run)
    expect(hasStatus(me, FLASH)).toBe(false)
    // 再下一個回合：照常回復 2 點
    runTo(run, 'a1')
    expect(me.pools.ram!.now).toBe(2)
  })

  it('閃斷之後的那個回合不失去回合：輪得到他、回填照常（RAM +2）', () => {
    const a = flashArena()
    const run = a.run()
    const me = a.ally(1)
    run.addLoad(me, 999, a.foe(1))
    runTo(run, 'a1')
    expect(currentUnit(a.battle)!.id).toBe('a1')
    expect(tagged(run, 'turn.skip')).toEqual([])
    const refill = a.k.battle.getAction(TEST_NET_ACTIONS.REFILL)!
    expect(refill.blocks!(run, me)).toEqual([])
    refill.run(run, me, null, { action: refill.id })
    expect(me.pools.ram!.now).toBe(2)
  })

  it('overload 掛點拿到 flash.before（歸零之前有多少）與歸零的那一池', () => {
    const seen: unknown[] = []
    const a = flashArena((k) => k.battle.on('overload', 'probe', ({ unit, flash, by }) => { seen.push({ unit: unit.id, flash, by: by?.id }) }))
    const run = a.run()
    a.ally(1).pools.ram!.now = 3
    run.addLoad(a.ally(1), 999, a.foe(1))
    expect(seen).toEqual([{ unit: 'a1', flash: { pool: 'ram', before: 3 }, by: 'f1' }])
    // RAM 已經是 0 的人過載：before 是 0
    const b = flashArena((k) => k.battle.on('overload', 'probe', ({ flash }) => { seen.push(flash) }))
    b.ally(1).pools.ram!.now = 0
    b.run().addLoad(b.ally(1), 999)
    expect(seen.at(-1)).toEqual({ pool: 'ram', before: 0 })
  })

  it('處理函式把池補回去的，補的留著：下個回合開始時不再歸零、也不回復（flash 還在）', () => {
    const a = flashArena((k) => k.battle.on('overload', 'refill', ({ unit, flash }) => { if (flash) unit.pools[flash.pool]!.now = 3 }))
    const run = a.run()
    const me = a.ally(1)
    run.addLoad(me, 999, a.foe(1))
    expect(me.pools.ram!.now).toBe(3)
    runTo(run, 'a1')
    expect(me.pools.ram!.now).toBe(3)
    advance(run)
    runTo(run, 'a1')
    expect(me.pools.ram!.now).toBe(5)
  })

  it('處理函式把池補滿也一樣；也可以改 flash 的時間（持續兩回合）或拿掉它', () => {
    const lasting = flashArena((k) => k.battle.on('overload', 'longer', ({ unit }) => { unit.statuses.find((s) => s.id === FLASH)!.until = { at: 'turn_end', of: unit.id, turns: 2 } }))
    const run = lasting.run()
    const me = lasting.ally(1)
    run.addLoad(me, 999, lasting.foe(1))
    runTo(run, 'a1')
    advance(run)
    expect(hasStatus(me, FLASH)).toBe(true)
    runTo(run, 'a1')
    expect(me.pools.ram!.now).toBe(0)
    advance(run)
    expect(hasStatus(me, FLASH)).toBe(false)

    const removed = flashArena((k) => k.battle.on('overload', 'cancel', ({ run: r, unit }) => { r.removeStatus(unit, FLASH, true) }))
    const run2 = removed.run()
    run2.addLoad(removed.ally(1), 999, removed.foe(1))
    runTo(run2, 'a1')
    expect(removed.ally(1).pools.ram!.now).toBe(2)
  })

  it('自己的回合裡過載的（別人的反應、自己的代價、回合開始的結算），到這個回合結束就拿掉；下個回合照常回復', () => {
    for (const byHimself of [false, true]) {
      const a = flashArena()
      const b = a.battle
      b.turn = 0
      b.acting = 'a1'
      const run = a.run()
      const me = a.ally(1)
      run.addLoad(me, 999, byHimself ? me : a.foe(1))
      expect(hasStatus(me, FLASH)).toBe(true)
      expect(me.statuses.find((s) => s.id === FLASH)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
      advance(run)
      expect(hasStatus(me, FLASH), byHimself ? '自己給自己的' : '別人給的').toBe(false)
      runTo(run, 'a1')
      expect(me.pools.ram!.now).toBe(2)
    }
  })

  it('回合開始的結算（發作的感載）讓他過載：只影響這個回合', () => {
    const a = flashArena((k) => k.content.load('battle_status', [{ id: 'overheat', name: '過熱', desc: '每回合感載 +999。', turn_start: { load: 999 }, until: 'battle_end', kind: 'debuff' }]))
    const run = a.run()
    const me = a.ally(1)
    run.applyStatus(me, 'overheat', { quiet: true })
    runTo(run, 'a1')
    expect(hasStatus(me, FLASH)).toBe(true)
    expect(me.pools.ram!.now).toBe(0)
    advance(run)
    expect(hasStatus(me, FLASH)).toBe(false)
  })

  it('又過載一次：狀態還是一筆，時間從頭算；首領也一樣（閃斷不吃首領的控制保護）', () => {
    const a = netArena(netDuel([netAvatar(0), netAvatar(1)], [laceUnit('boss'), laceUnit()]))
    const run = a.run()
    const boss = a.foe(1)
    run.addLoad(boss, 999, a.ally(1))
    expect(hasStatus(boss, FLASH)).toBe(true)
    expect(boss.pools.ram!.now).toBe(0)
    boss.uses.control_immune = 99
    run.addLoad(boss, 999, a.ally(1))
    expect(boss.statuses.filter((s) => s.id === FLASH)).toHaveLength(1)
    expect(boss.layers).toBe(2)
  })

  it('沒有 RAM 池的人過載：照樣閃斷（掛點帶 pool 與 before 0），不丟錯', () => {
    const seen: unknown[] = []
    const lone = laceUnit()
    lone.pools = {}
    const a = netArena(netDuel([netAvatar(0)], [lone, laceUnit()]), (k) => k.battle.on('overload', 'probe', ({ flash }) => { seen.push(flash) }))
    a.run().addLoad(a.foe(1), 999)
    expect(hasStatus(a.foe(1), FLASH)).toBe(true)
    expect(seen).toEqual([{ pool: 'ram', before: 0 }])
  })

  it('現實戰鬥過載照舊失去回合：沒有 flash，掛點也沒有 flash', () => {
    const seen: unknown[] = []
    const a = arena(duel([one()], [foe(), foe()]), [TEST_COMBAT], (k) => k.battle.on('overload', 'probe', (p) => { seen.push('flash' in p) }))
    const run = a.run()
    run.addLoad(a.ally(1), 999, a.foe(1))
    expect(losingTurn(a.ally(1))).toBe(true)
    expect(hasStatus(a.ally(1), FLASH)).toBe(false)
    expect(seen).toEqual([false])
    expect(a.ally(1).pools.ram!.now).toBe(4)
  })

  it('餘韻疊滿再過載：昏過去，不是閃斷（沒有 flash，也不發 overload 掛點）', () => {
    const seen: unknown[] = []
    const a = netArena(netDuel([netAvatar(0), netAvatar(1)], [laceUnit(), laceUnit()]), (k) => k.battle.on('overload', 'probe', () => { seen.push(1) }))
    const run = a.run()
    const me = a.ally(1)
    me.layers = me.layersMax
    run.addLoad(me, 999, a.foe(1))
    expect(me.out).toBe('burnout')
    expect(hasStatus(me, FLASH)).toBe(false)
    expect(seen).toEqual([])
  })

  it('狀態的資料可以寫 no_regen（行動點也行）：帶著它的回合開始時那幾池不回復，其餘照常', () => {
    const a = flashArena((k) => k.content.load('battle_status', [{ id: 'choke', name: '窒息', desc: '行動點與 RAM 都不回復。', no_regen: ['ap', 'ram'], until: 'own_turn_end', kind: 'debuff' }]))
    const run = a.run()
    const me = a.ally(1)
    run.applyStatus(me, 'choke', { quiet: true })
    me.ap.now = 0
    me.pools.ram!.now = 1
    runTo(run, 'a1')
    expect(me.ap.now).toBe(0)
    expect(me.pools.ram!.now).toBe(1)
    advance(run)
    runTo(run, 'a1')
    expect(me.ap.now).toBeGreaterThan(0)
    expect(me.pools.ram!.now).toBe(3)
  })
})

// ---- 5. 個人的脫離（N12） ----

describe('個人的脫離：全員拔線是 jack_out，不是戰敗（CYBERSPACE 6.7 節；N12）', () => {
  const fourAvatars = () => netArena(netDuel([netAvatar(0), netAvatar(1), netAvatar(2), netAvatar(3)], [laceUnit(), laceUnit()]))

  it('核心的內海預設：leave = { out: jacked_out, outcome: jack_out }；現實沒有', () => {
    expect(DEFAULT_MODES.net!.leave).toEqual({ out: 'jacked_out', outcome: 'jack_out' })
    expect(DEFAULT_MODES.meat!.leave).toBeUndefined()
  })

  it('內海我方四個人都以 jacked_out 退出：結果是 jack_out，記一拍 jack_out 的事件；前三個人退出時還沒有結果', () => {
    const a = fourAvatars()
    const run = a.run()
    for (const i of [1, 2, 3]) {
      run.setOut(a.ally(i), 'jacked_out')
      expect(a.battle.result).toBeUndefined()
    }
    run.setOut(a.ally(4), 'jacked_out')
    expect(a.battle.result).toMatchObject({ outcome: 'jack_out' })
    expect(a.battle.result!.text).not.toMatch(/戰敗：/)
    expect(tagged(run, 'jack_out')).toHaveLength(4)
    expect(tagged(run, 'battle.end').map((b) => b.data)).toEqual([{ outcome: 'jack_out' }])
    expect(tagged(run, 'down')).toEqual([])
  })

  it('三個人拔線、一個人昏過去（餘韻疊滿再過載）：lose', () => {
    const a = fourAvatars()
    const run = a.run()
    for (const i of [1, 2, 3]) run.setOut(a.ally(i), 'jacked_out')
    run.setOut(a.ally(4), 'burnout')
    expect(a.battle.result).toMatchObject({ outcome: 'lose' })
  })

  it('三個人拔線、一個人被制伏或投降：lose；順序反過來（先倒下、後拔線）也一樣', () => {
    for (const how of ['subdued', 'surrendered', 'down']) {
      const a = fourAvatars()
      const run = a.run()
      run.setOut(a.ally(1), how)
      for (const i of [2, 3, 4]) run.setOut(a.ally(i), 'jacked_out')
      expect(a.battle.result, how).toMatchObject({ outcome: 'lose' })
    }
  })

  it('我方在後方排隊的人也要拔線：還有人在後方沒走，就還沒有結果', () => {
    const five = netArena(netDuel([netAvatar(0), netAvatar(1), netAvatar(2), netAvatar(3), netAvatar(0, 1, { name: '候補' })], [laceUnit(), laceUnit()]))
    const run = five.run()
    expect(five.battle.reserve.ally).toEqual(['a5'])
    for (const i of [1, 2, 3, 4]) run.setOut(five.ally(i), 'jacked_out')
    // 候補補上來了（有人退出就補位），還沒有結果
    expect(five.battle.result).toBeUndefined()
    run.settle()
    expect(unitsOf(five.battle, 'ally').map((u) => u.id)).toEqual(['a5'])
    run.setOut(five.ally(5), 'jacked_out')
    expect(five.battle.result).toMatchObject({ outcome: 'jack_out' })
  })

  it('現實戰鬥裡有人用同一個字退出不會變成 jack_out：全員 jacked_out 還是 lose', () => {
    const a = arena(duel([one({}, 1), one({}, 2)], [foe(), foe()]))
    const run = a.run()
    run.setOut(a.ally(1), 'jacked_out')
    run.setOut(a.ally(2), 'jacked_out')
    expect(a.battle.result).toMatchObject({ outcome: 'lose' })
  })

  it('敵人全員拔線：照舊是勝利（脫離只算我方）', () => {
    const a = fourAvatars()
    const run = a.run()
    run.setOut(a.foe(1), 'jacked_out')
    run.setOut(a.foe(2), 'jacked_out')
    expect(a.battle.result).toMatchObject({ outcome: 'win' })
  })

  it('資料的 leave 蓋掉預設（沒寫照預設）；格式不對的擋下', () => {
    const k = makeKernel()
    const NET = { id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', afterglow: { roll: 1, load_dealt_pct: 10 }, cover_names: ['a', 'b', 'c'], cover_word: '防火牆' }
    k.content.load('battle_mode', [NET])
    expect(modeOf(k.content, 'net')!.leave).toEqual({ out: 'jacked_out', outcome: 'jack_out' })
    k.content.load('battle_mode', [{ ...NET, leave: { out: 'unplugged', outcome: 'cut_off' } }])
    expect(modeOf(k.content, 'net')!.leave).toEqual({ out: 'unplugged', outcome: 'cut_off' })
    const bad = (leave: unknown) => k.content.validate('battle_mode', [{ ...NET, leave }])
    expect(bad({ out: 'unplugged', outcome: 'cut_off' })).toEqual([])
    expect(bad('x')[0]).toMatch(/leave 要是 \{ out, outcome \}/)
    expect(bad({ out: 'unplugged' })[0]).toMatch(/leave 要是/)
    expect(bad({ out: 'down', outcome: 'x' })[0]).toMatch(/leave\.out 不能是 down 或 burnout/)
    expect(bad({ out: 'x', outcome: 'lose' })[0]).toMatch(/leave\.outcome 不能是 win、lose、surrender/)
    expect(bad({ out: 'x', outcome: 'surrender' })[0]).toMatch(/leave\.outcome/)
  })

  it('用資料的 leave 打：全員以那個方式退出，結果是資料寫的', () => {
    const a = netArena(netDuel([netAvatar(0)], [laceUnit()]), (k) => {
      k.content.load('battle_mode', [{ id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', afterglow: { roll: 1, load_dealt_pct: 10 }, cover_names: ['a', 'b', 'c'], cover_word: '防火牆', leave: { out: 'unplugged', outcome: 'cut_off' } }])
    })
    const run = a.run()
    run.setOut(a.ally(1), 'jacked_out')
    expect(a.battle.result).toMatchObject({ outcome: 'lose' })
    const b = netArena(netDuel([netAvatar(0)], [laceUnit()]), (k) => {
      k.content.load('battle_mode', [{ id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', afterglow: { roll: 1, load_dealt_pct: 10 }, cover_names: ['a', 'b', 'c'], cover_word: '防火牆', leave: { out: 'unplugged', outcome: 'cut_off' } }])
    })
    b.run().setOut(b.ally(1), 'unplugged')
    expect(b.battle.result).toMatchObject({ outcome: 'cut_off' })
  })

  describe('結束的結算：待遇照 fled（不是戰敗，不留等著選的戰敗，activity.end 的 outcome 就是它）', () => {
    type End = { kind: string; outcome: string }
    const listen = (ends: End[]): Feature => ({ id: 'listener', install: (k) => k.hooks.on('activity.end', 'listener', (p) => { ends.push({ kind: p.kind, outcome: p.outcome }) }) })
    /** 開一場內海戰鬥，讓我方每個人照 hows 退出，把這一步交上去，回傳結算的報告草稿。 */
    const play = (hows: string[], ends: End[]) => {
      const t = makeGame({ features: [TEST_NET_COMBAT, listen(ends)] })
      t.game.startBattle(BATTLE_SETUPS.net())
      expect(t.game.state.snapshots.map((s) => s.kind)).toContain('battle')
      const b = clone(t.game.state.battle!)
      const run = new BattleRun(t.game.k, t.game.state, b)
      hows.forEach((how, i) => run.setOut(run.unit(`a${i + 1}`), how))
      commitStep(t.game, b)
      return { ...t, draft: endBattle(t.game.k, t.game.state) }
    }

    it('全員拔線：jack_out；開打前的快照丟掉（snapshot.drop），沒有 snapshot.mark；摘要寫「全員拔線」', () => {
      const ends: End[] = []
      const { draft, game } = play(['jacked_out', 'jacked_out', 'jacked_out', 'jacked_out'], ends)
      expect(draft.outcome.result).toBe('jack_out')
      expect(draft.kind).toBe('netrun')
      expect(draft.changes.some((c) => c.op === 'snapshot.mark')).toBe(false)
      expect(draft.changes.some((c) => c.op === 'snapshot.drop')).toBe(true)
      expect(draft.outcome.summary).toContain('全員拔線')
      expect(draft.outcome.summary).not.toContain('戰敗')
      expect(ends).toEqual([{ kind: 'battle', outcome: 'jack_out' }])
      // 沒有等著選的戰敗
      expect(pendingDefeat(game.state)).toBeNull()
    })

    it('三個人拔線、一個人昏過去：lose；開打前的快照留著，標成輸掉的那一場（等玩家三選一）', () => {
      const ends: End[] = []
      const { draft } = play(['jacked_out', 'jacked_out', 'jacked_out', 'burnout'], ends)
      expect(draft.outcome.result).toBe('lose')
      expect(draft.changes.find((c) => c.op === 'snapshot.mark')).toMatchObject({ kind: 'battle', data: { lost: { outcome: 'lose' } } })
      expect(ends).toEqual([{ kind: 'battle', outcome: 'lose' }])
    })

    it('整個流程：finishBattle 之後戰鬥結束、沒有等著選的戰敗', async () => {
      const ends: End[] = []
      const { game } = play(['jacked_out', 'jacked_out', 'jacked_out', 'jacked_out'], ends)
      const r = await game.finishBattle()
      expect(r.status).toBe('applied')
      expect(game.state.battle).toBeNull()
      expect(pendingDefeat(game.state)).toBeNull()
      expect(game.state.snapshots.some((s) => s.kind === 'battle')).toBe(false)
    })
  })
})

// ---- 6. 新的修正與事件的名字 ----

describe('六個新的修正種類與九個新的事件', () => {
  const NEW_MODS = ['admin_uses', 'refill', 'trace_round', 'trace_admin', 'sync_cap', 'sync_shifts']
  const NEW_EVENTS = ['shift', 'jam', 'break', 'pin', 'tether', 'jack_out', 'admin', 'trace', 'located']

  it('MOD_KINDS 與 BATTLE_EVENTS 多了這幾個，沒有重複', () => {
    for (const m of NEW_MODS) expect(MOD_KINDS, m).toContain(m)
    for (const e of NEW_EVENTS) expect(BATTLE_EVENTS, e).toContain(e)
    expect(new Set(MOD_KINDS).size).toBe(MOD_KINDS.length)
    expect(new Set(BATTLE_EVENTS).size).toBe(BATTLE_EVENTS.length)
  })

  it('六個新的修正寫在 battle_status 的 mods 裡載得進來、問得到；不認得的種類照舊被擋', () => {
    const k = makeKernel()
    k.content.load('battle_status', [{
      id: 'overclocked', name: '超頻', desc: '內海的各種加成。',
      mods: { admin_uses: 1, refill: 1, trace_round: -1, trace_admin: 2, sync_cap: 1, sync_shifts: 1 }, until: 'battle_end', kind: 'buff',
    }])
    expect(() => k.content.load('battle_status', [{ id: 'bogus', name: '怪', desc: '怪。', mods: { sync_gear: 1 }, until: 'battle_end', kind: 'buff' }])).toThrow(/mods\.sync_gear：只能是/)
    const a = netArena(netDuel([netAvatar(0)], [laceUnit()]), (kk) => kk.content.load('battle_status', [{
      id: 'overclocked', name: '超頻', desc: '內海的各種加成。',
      mods: { admin_uses: 1, refill: 1, trace_round: -1, trace_admin: 2, sync_cap: 1, sync_shifts: 1 }, until: 'battle_end', kind: 'buff',
    }]))
    const run = a.run()
    const me = a.ally(1)
    run.applyStatus(me, 'overclocked', { quiet: true })
    expect(Object.fromEntries(NEW_MODS.map((m) => [m, run.mods(m as (typeof MOD_KINDS)[number], me).reduce((s, p) => s + p.value, 0)]))).toEqual({ admin_uses: 1, refill: 1, trace_round: -1, trace_admin: 2, sync_cap: 1, sync_shifts: 1 })
    // 其他的修正不受影響
    expect(run.mods('hit', me)).toEqual([])
  })

  it('TEST_NET_COMBAT 的回填吃 refill 的修正', () => {
    const a = netArena(netDuel([netAvatar(0)], [laceUnit()]), (k) => k.content.load('battle_status', [{ id: 'quick_fill', name: '快填', desc: '回填多 1 點。', mods: { refill: 1 }, until: 'battle_end', kind: 'buff' }]))
    const run = a.run()
    const me = a.ally(1)
    me.pools.ram!.now = 0
    run.applyStatus(me, 'quick_fill', { quiet: true })
    const refill = a.k.battle.getAction(TEST_NET_ACTIONS.REFILL)!
    refill.run(run, me, null, { action: refill.id })
    expect(me.pools.ram!.now).toBe(3)
  })

  it('戰鬥裡每一拍的標籤都在 BATTLE_EVENTS 裡（內海的一整場）', () => {
    const { game } = makeBattleGame({ battle: 'net', seed: 3 })
    playOut(game)
    for (const r of game.state.reports) for (const b of r.timeline) if (b.tag) expect(BATTLE_EVENTS as readonly string[], b.tag).toContain(b.tag)
  })
})

// ---- 7. 斷路 ----

describe.each(['meat', 'net'] as const)('斷路（run.cutSlot；兩個戰場都能用）：%s', (mode) => {
  const kit = mode === 'meat'
    ? { feats: [TEST_COMBAT], ally: (i: number) => one({}, i), foe: () => foe() }
    : { feats: [TEST_NET_COMBAT], ally: (i: number) => netAvatar(i - 1), foe: () => laceUnit() }
  /** 我方站在 allySlots 指定的格子（每個人一格；多的 reserve 個在後方排隊），敵方兩個。遮蔽全部暴露。 */
  const field = (allySlots: number[], reserve = 0) => arena({
    mode, grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
    allies: [...allySlots.map((s, i) => raw(kit.ally(i + 1), s)), ...Array.from({ length: reserve }, (_, i) => raw(kit.ally(allySlots.length + i + 1)))],
    foes: [raw(kit.foe()), raw(kit.foe())],
  }, kit.feats)
  const slots = (a: ReturnType<typeof field>) => unitsOf(a.battle, 'ally').map((u) => [u.id, u.slot])

  it('記在 battle.field 的 cut:<方>:<格>（值是到第幾輪結束為止）；記一拍；兩方都行；已經被斷路的取比較晚的期限；已經過了的不理', () => {
    const a = field([1, 2, 3, 4])
    const run = a.run()
    run.cutSlot('ally', 2, a.battle.round)
    expect(a.battle.field['cut:ally:2']).toBe(1)
    expect(tagged(run, 'field').map((b) => b.data)).toEqual([{ side: 'ally', slot: 2, kind: 'cut', until: 1 }])
    run.cutSlot('foe', 1, 3)
    expect(a.battle.field['cut:foe:1']).toBe(3)
    run.cutSlot('foe', 1, 2)
    expect(a.battle.field['cut:foe:1']).toBe(3)
    run.cutSlot('foe', 1, 5)
    expect(a.battle.field['cut:foe:1']).toBe(5)
    a.battle.round = 4
    run.cutSlot('foe', 3, 3)
    expect(a.battle.field['cut:foe:3']).toBeUndefined()
    expect(() => run.cutSlot('ally', 5, 9)).toThrow(/第 1～4 格/)
    expect(() => run.cutSlot('ally', 0, 9)).toThrow()
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('被切的那一格上的人這一輪換不了位：moveBlock 的原因一句；run.move、shift、place 都擋；換位的行動灰掉', () => {
    const a = field([1, 2, 3, 4])
    const run = a.run()
    run.cutSlot('ally', 2, a.battle.round)
    const [a1, a2, a3, a4] = [a.ally(1), a.ally(2), a.ally(3), a.ally(4)]
    expect(moveBlockOf(a, a2, 1)).toMatch(/第 2 格被斷路了，這一輪站在這一格的人換不了位。/)
    expect(moveBlockOf(a, a2, 3)).toMatch(/斷路/)
    // 別人換不進去
    expect(moveBlockOf(a, a1, 2)).toMatch(/第 2 格被斷路了，這一輪換不進這一格。/)
    expect(moveBlockOf(a, a3, 2)).toMatch(/換不進這一格/)
    // 不牽涉到那一格的照舊
    expect(moveBlockOf(a, a3, 4)).toBeNull()
    expect(moveBlockOf(a, a4, 3)).toBeNull()
    // 換位的行動：目標灰掉，原因是同一句
    const targets = a.k.battle.getAction(MOVE)!.targets!(run, a2)
    expect(targets.map((t) => [(t.target as { slot: number }).slot, t.blocks.length])).toEqual([[1, 1], [3, 1]])
    expect(targets[0]!.blocks[0]).toBe(moveBlockOf(a, a2, 1))
    // 基本動作也擋
    const before = slots(a)
    const beats = run.beats.length
    expect(run.move(a2, 1)).toBe(false)
    expect(run.move(a1, 2)).toBe(false)
    expect(run.shift(a2, +1)).toBe(false)
    expect(run.shift(a3, -1)).toBe(false)
    expect(run.place(a1, 2)).toBe(false)
    expect(slots(a)).toEqual(before)
    expect(run.beats.slice(beats).every((b) => b.tag === 'field')).toBe(true)
    // 沒被切的格子之間照常換位
    expect(run.move(a3, 4)).toBe(true)
    expect(a3.slot).toBe(4)
    expect(a4.slot).toBe(3)
  })

  it('空著的那一格被切：誰也換不進去（往空格移）', () => {
    const a = field([1, 3, 4])
    const run = a.run()
    run.cutSlot('ally', 2, a.battle.round)
    expect(moveBlockOf(a, a.ally(1), 2)).toMatch(/換不進這一格/)
    expect(run.move(a.ally(1), 2)).toBe(false)
    expect(a.ally(1).slot).toBe(1)
  })

  it('後面的人補不進來：前面空著、那一排有一格被切時，這一次不補（那一格空著時也是）；那一輪結束解除之後補上', () => {
    const a = field([1, 3, 4])
    const run = a.run()
    run.cutSlot('ally', 2, a.battle.round)
    run.compact('ally')
    expect(slots(a)).toEqual([['a1', 1], ['a2', 3], ['a3', 4]])
    expect(tagged(run, 'compact')).toEqual([])
    // 下一輪照常：解除斷路，補位補回來（a2 退到第 2 格、a3 退到第 3 格）
    toRound(run, 2)
    expect(a.battle.field['cut:ally:2']).toBeUndefined()
    expect(tagged(run, 'field').map((b) => (b.data as { kind: string }).kind)).toEqual(['cut', 'uncut'])
    expect(slots(a)).toEqual([['a1', 1], ['a2', 2], ['a3', 3]])
    expect(tagged(run, 'compact').length).toBeGreaterThan(0)
  })

  it('站著人的那一格被切、前面有人倒下：後面的人也補不上來', () => {
    const a = field([1, 2, 3, 4])
    const run = a.run()
    run.cutSlot('ally', 3, a.battle.round)
    run.setOut(a.ally(1), 'down')
    expect(slots(a)).toEqual([['a2', 2], ['a3', 3], ['a4', 4]])
    toRound(run, 2)
    expect(slots(a)).toEqual([['a2', 1], ['a3', 2], ['a4', 3]])
  })

  it('增援補位跳過被切的格子：後方的人這一輪補不進去，下一輪才進場', () => {
    const a = field([1, 2, 3, 4], 1)
    const run = a.run()
    expect(a.battle.reserve.ally).toEqual(['a5'])
    run.cutSlot('ally', 4, a.battle.round)
    run.setOut(a.ally(4), 'down')
    run.settle()
    expect(a.ally(5).slot).toBe(0)
    expect(a.battle.reserve.ally).toEqual(['a5'])
    toRound(run, 2)
    expect(a.ally(5).slot).toBe(4)
    expect(a.battle.reserve.ally).toEqual([])
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('空格不只一個：增援補進沒被切的那一格', () => {
    const a = field([1, 2], 1)
    const run = a.run()
    run.cutSlot('ally', 4, a.battle.round)
    // 兩個空格 3、4：後方的人本來補第 4 格，4 被切就補第 3 格
    a.battle.reserve.ally = []
    const late = run.callIn('ally', raw(kit.ally(3)))!
    expect(late).not.toBeNull()
    toRound(run, 2)
    expect(late.slot).toBe(3)
  })

  it('叫來的人（admitCalled）也跳過被切的格子：沒有可進的格就留在後方，不再算叫來的', () => {
    const a = field([1, 2, 3])
    const run = a.run()
    const late = run.callIn('ally', raw(kit.ally(4)))!
    run.cutSlot('ally', 4, a.battle.round)
    toRound(run, 2)
    expect(late.slot).toBe(0)
    expect(a.battle.called).toBeUndefined()
    expect(a.battle.reserve.ally).toEqual([late.id])
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('那一輪結束時自動解除；到第 n 輪結束的，撐到第 n 輪；之後一切照常', () => {
    const a = field([1, 2, 3, 4])
    const run = a.run()
    run.cutSlot('ally', 2, 2)
    toRound(run, 2)
    expect(a.battle.field['cut:ally:2']).toBe(2)
    expect(moveBlockOf(a, a.ally(1), 2)).toMatch(/到第 2 回合結束.*換不進/)
    toRound(run, 3)
    expect(a.battle.field['cut:ally:2']).toBeUndefined()
    expect(moveBlockOf(a, a.ally(1), 2)).toBeNull()
    expect(run.move(a.ally(1), 2)).toBe(true)
  })

  it('過期了還沒被清掉的（舊值小於現在的輪）不算被斷路', () => {
    const a = field([1, 2, 3, 4])
    a.battle.field['cut:ally:2'] = 0
    expect(moveBlockOf(a, a.ally(1), 2)).toBeNull()
  })

  it('敵方的格子也能切：敵人 AI 不會往被切的格子移，battleAuto 打得完', () => {
    const a = field([1, 2, 3, 4])
    const run = a.run()
    run.cutSlot('foe', 1, 99)
    const f1 = a.foe(1)
    expect(moveBlockOf(a, f1, 2)).toMatch(/第 1 格被斷路了/)
    expect(run.move(f1, 2)).toBe(false)
  })

  it('存檔：帶著 cut 的戰鬥狀態合格式', () => {
    const a = field([1, 2, 3, 4])
    a.run().cutSlot('ally', 2, 3)
    expect(battleProblems(clone(a.battle))).toEqual([])
  })
})

function moveBlockOf(a: { battle: BattleState }, u: BattleUnit, to: number): string | null {
  return moveBlockCore(a.battle, u, to)
}
import { moveBlock as moveBlockCore } from '../../src'

// ---- 8. safe 的場地 ----

describe('battle.field.safe：這一場倒下不加沉溺（迷宮館的熔斷保護，CYBERSPACE 8.2 節）', () => {
  /** 一場打完的戰鬥：主角（有角色）餘韻疊滿再過載、昏了過去；回傳結算的變更裡沉溺加了多少。 */
  const sinkDelta = (field: Record<string, boolean>, selfSink = 0): number => {
    const k = createKernel([TEST_NET_COMBAT])
    const state = makeState()
    const run = setupBattle(k, state, { mode: 'net', grade: 1, allies: [{ from: 'actor', id: 'pc' }], foes: [raw(laceUnit())], field })
    const b = clone(run.battle)
    b.units.a1!.sink = selfSink
    b.units.a1!.out = 'burnout'
    b.result = { outcome: 'lose', text: '全隊倒下：戰敗。' }
    state.battle = b
    const draft = endBattle(k, state)
    const change = draft.changes.find((c) => c.op === 'actor.track' && (c as { track: string }).track === 'sink') as { delta: number } | undefined
    return change?.delta ?? 0
  }

  it('沒有 safe：餘韻疊滿再過載而昏過去，沉溺 +2；有 safe：沒有', () => {
    expect(sinkDelta({})).toBe(2)
    expect(sinkDelta({ safe: true })).toBe(0)
    expect(sinkDelta({ safe: false })).toBe(2)
  })

  it('safe 只免掉倒下的那 +2：戰鬥中自己累積的沉溺（快感傷害）照算', () => {
    expect(sinkDelta({}, 3)).toBe(5)
    expect(sinkDelta({ safe: true }, 3)).toBe(3)
  })

  it('現實戰鬥也認 safe；沒有昏過去的人兩邊都不加', () => {
    const k = createKernel([TEST_COMBAT])
    const state = makeState()
    const run = setupBattle(k, state, { mode: 'meat', grade: 1, allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())], field: { safe: true } })
    const b = clone(run.battle)
    b.units.a1!.out = 'burnout'
    b.result = { outcome: 'lose', text: '戰敗。' }
    state.battle = b
    expect(endBattle(k, state).changes.some((c) => c.op === 'actor.track' && (c as { track: string }).track === 'sink')).toBe(false)
  })
})

// ---- 9. testkit 的內海情境、存檔與冒煙 ----

describe('BATTLE_SETUPS.net 與 TEST_NET_COMBAT（dev/test-harness.md 第 1 節）', () => {
  it('四個化身對四個雜兵蕾絲：沒有生命、防護與感載上限照內海表、RAM 與每回合回 RAM 照表；化身沒有武器以外的差別', () => {
    const { game } = makeBattleGame({ battle: 'net' })
    const b = game.battle!
    expect(b.mode).toBe('net')
    expect(unitsOf(b, 'ally')).toHaveLength(4)
    expect(unitsOf(b, 'foe')).toHaveLength(4)
    for (const u of Object.values(b.units)) {
      expect(u.hp, u.id).toBeUndefined()
      expect(u.load, u.id).toBeDefined()
      expect(u.weapons[0]!.pool).toEqual({ ram: 1 })
      expect(u.weapons[0]!.mag).toBeUndefined()
      expect(u.weapons[0]!.type).toBe('neural')
    }
    expect(b.units.f1).toMatchObject({ name: '雜兵蕾絲', rank: 'minion', armor: 1, load: { max: 22 }, evade: 12, pools: { ram: { max: 4, regen: 2 } } })
    expect(b.units.a1).toMatchObject({ rank: 'elite', armor: 2, load: { max: 38 }, pools: { ram: { max: 5, regen: 2 } } })
    expect(b.cover.ally.map((c) => c.level)).toEqual([1, 1, 2, 2])
  })

  it('可以給等級：III 級的雜兵蕾絲防護 3、RAM 5、傷害骰 4＋1（等級骰）', () => {
    const { game } = makeBattleGame({ battle: 'net', grade: 3 })
    expect(game.battle!.grade).toBe(3)
    expect(game.battle!.units.f1).toMatchObject({ armor: 3, evade: 14, pools: { ram: { max: 5 } }, weapons: [{ dice: 5, hit: 5 }] })
    expect(game.battle!.units.a1).toMatchObject({ armor: 4, weapons: [{ dice: 5, hit: 8 }] })
  })

  it('TEST_NET_COMBAT 的行動：攻擊 2 行動點加 1 RAM、回填 1 行動點、RAM +2；只在內海', () => {
    const { game } = makeBattleGame({ battle: 'net' })
    const b = game.battle!
    b.turn = b.order.indexOf('a1')
    const me = b.units.a1!
    const o = game.battleOptions()!
    const attack = o.actions.find((x) => x.id === TEST_NET_ACTIONS.ATTACK)!
    expect(attack).toMatchObject({ ok: true, cost: { ap: 2, ram: 1 }, group: 'attack', target: 'foe' })
    expect(o.actions.find((x) => x.id === TEST_NET_ACTIONS.REFILL)).toMatchObject({ cost: { ap: 1 } })
    expect(o.actions.map((x) => x.id)).not.toContain('test.attack')
    const ram = me.pools.ram!.now
    const ap = me.ap.now
    const r = game.battleAct({ action: TEST_NET_ACTIONS.ATTACK, target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    expect(game.battle!.units.a1!.pools.ram!.now).toBe(ram - 1)
    expect(game.battle!.units.a1!.ap.now).toBe(ap - 2)
    // 現實的戰鬥看不到內海的行動
    const meat = makeBattleGame({ battle: 'encounter' })
    meat.game.battle!.turn = meat.game.battle!.order.indexOf('a1')
    expect(meat.game.battleOptions()!.actions.map((x) => x.id)).not.toContain(TEST_NET_ACTIONS.ATTACK)
  })

  it('用 TEST_NET_COMBAT 打得完（playOut）：幾個種子與等級都分得出結果、不變式沒有違規、狀態合格式、結算之後戰鬥結束', async () => {
    const outcomes = new Set<string>()
    for (const [seed, grade] of [[1, 1], [2, 1], [3, 1], [4, 2], [5, 3], [6, 5]] as const) {
      const { game } = makeBattleGame({ battle: 'net', seed, grade })
      const { result, violations } = await observed(game, () => playOut(game))
      expect(violations, `seed ${seed}`).toEqual([])
      expect(['win', 'lose'], `seed ${seed}`).toContain(result.outcome)
      expect(result.rounds, `seed ${seed}`).toBeGreaterThan(1)
      outcomes.add(result.outcome)
      expect(battleProblems(game.battle!)).toEqual([])
      for (const u of Object.values(game.battle!.units)) {
        expect(u.pools.ram!.now, `${u.id} 的 RAM`).toBeGreaterThanOrEqual(0)
        expect(u.pools.ram!.now, `${u.id} 的 RAM`).toBeLessThanOrEqual(u.pools.ram!.max)
        expect(u.hp).toBeUndefined()
      }
      const r = await game.finishBattle()
      expect(r.status).toBe('applied')
      expect(game.battle).toBeNull()
      expect(r.reports.at(-1)!.kind).toBe('netrun')
    }
    expect(outcomes.size).toBeGreaterThan(0)
  })

  it('打的過程中每一拍都是內海的（layer net）；過載是閃斷，從來沒有失去回合', () => {
    let flashes = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { game } = makeBattleGame({ battle: 'net', seed })
      playOut(game)
      const beats = game.state.reports.flatMap((r) => r.timeline)
      expect(beats.every((b) => b.layer === 'net')).toBe(true)
      expect(beats.some((b) => b.tag === 'turn.skip')).toBe(false)
      flashes += beats.filter((b) => b.tag === 'overload' && (b.data as { flash?: boolean }).flash).length
    }
    // 六場裡一定有人被灌到過載（不然這一組測試沒有走到閃斷）
    expect(flashes).toBeGreaterThan(0)
  })

  it('帶著 flash 的內海戰鬥存檔再讀，接著打的結果和沒有中斷的一樣；battleProblems 不把它當壞資料', () => {
    const play = (saveAt: number | null) => {
      const { game } = makeBattleGame({ battle: 'net', seed: 11 })
      // 讓第二個化身在開打時就被灌到過載（flash 在他身上）
      const b = clone(game.state.battle!)
      new BattleRun(game.k, game.state, b).addLoad(b.units.a2!, 999, b.units.f1!)
      expect(hasStatus(b.units.a2!, FLASH)).toBe(true)
      expect(battleProblems(b)).toEqual([])
      commitStep(game, b)
      for (let i = 0; i < 600 && !game.battle!.result; i++) {
        if (i === saveAt) {
          expect(game.load(game.save('manual', 't'))).toBeNull()
          if (i === 0) expect(hasStatus(game.battle!.units.a2!, FLASH) || game.battle!.units.a2!.statuses.length === 0).toBe(true)
          expect(battleProblems(game.battle!)).toEqual([])
        }
        game.battleNext({ anyone: true })
      }
      return stateHash(game.state)
    }
    const plain = play(null)
    expect(play(0)).toBe(plain)
    expect(play(7)).toBe(plain)
  })

  it('讀進來的存檔裡 flash 還在：存檔再讀之後狀態一模一樣', () => {
    const { game } = makeBattleGame({ battle: 'net', seed: 5 })
    const b = clone(game.state.battle!)
    new BattleRun(game.k, game.state, b).addLoad(b.units.a1!, 999, b.units.f1!)
    commitStep(game, b)
    expect(hasStatus(game.battle!.units.a1!, FLASH)).toBe(true)
    const before = stateHash(game.state)
    expect(game.load(game.save('manual', 't'))).toBeNull()
    expect(hasStatus(game.battle!.units.a1!, FLASH)).toBe(true)
    expect(stateHash(game.state)).toBe(before)
    expect(game.battle!.units.a1!.pools.ram!.now).toBe(0)
  })
})
