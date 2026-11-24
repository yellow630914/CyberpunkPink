// 驗收測試：dev/work/M3-summons-net.md（cpp-feature）。features/summons 的內海面：守衛程式（無人機的網內版）。
// 規格：CYBERSPACE 6.9 節（叫出來的東西，表的第一列）；COMBAT_SYSTEM 9.1 節（無人機）；ENEMIES 第 10 節；dev/adr/0018 N27；dev/adr/0015 第三節。
// 測試自帶兩個型號：一個現實的無人機、一個 net: true 的守衛程式；內海的單位用 from: 'unit' 直接給。構裝體與群眾不在這一張。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOptions, BattleSetup, BattleUnit, Feature, GameState } from '../../src'
import { BattleBlocked, BattleRun, battleAct, battleOptions, clone, createKernel, readyFeatures, setupBattle } from '../../src'
import { summonsFeature } from '../../src/features/summons'
import { autoAct } from '../../src/features/summons/auto'
import { hang } from '../../src/features/summons/drones'
import { TEST_COMBAT, TEST_NET_COMBAT, fixDice, laceUnit, makeState, netAvatar, partyUnit } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 測試自己的修正：標籤 t.cap 的人同時連得住的上限 +1（機師的「編隊」之類的招牌最後會用 overlay_cap 做這件事） ----
const MODS: Feature = {
  id: 'summons_net_test_mods',
  install(k) {
    k.battle.modifier('summons_net_test_mods', (q) => (q.kind === 'overlay_cap' && q.unit.tags.includes('t.cap') ? [{ label: '測試', value: 1 }] : []))
  },
}
const FEATURES: Feature[] = [TEST_COMBAT, TEST_NET_COMBAT, summonsFeature, MODS]

// ---- 兩個型號：現實的無人機、內海的守衛程式 ----
const DRONE = { kind: 'attack', grade: 1, name: '測試無人機' }
const GUARD_ATK = { kind: 'attack', grade: 1, net: true, name: '看門犬' }
const GUARD_ATK_RAM = { kind: 'attack', grade: 1, net: true, ram: 1, name: '重型看門犬' }
const GUARD_SHIELD = { kind: 'shield', grade: 1, net: true, name: '鏡盾' }
const GUARD_MEDIC = { kind: 'medic', grade: 1, net: true, name: '修復程式' }

// ---- 單位 ----
const summons = (...drones: Rec[]) => ({ summons: { drones } })
const pilotNet = (drones: Rec[], o: Rec = {}) => netAvatar(0, 1, { skills: { piloting: 8, firearms: 2, sync: 0 }, ext: summons(...drones), ...o } as never)
const pilotMeat = (drones: Rec[], o: Rec = {}) => partyUnit(0, 1, { skills: { piloting: 8, firearms: 2, sync: 2 }, ext: summons(...drones), ...o } as never)
const raw = (u: unknown, slot?: number) => ({ from: 'unit', unit: u as Rec, ...(slot ? { slot } : {}) })
const setup = (mode: 'meat' | 'net', allies: unknown[], foes: unknown[]): BattleSetup =>
  ({ mode, grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)) }) as BattleSetup
/** 好打中的蕾絲：迴避 0（自然 1 以外都中）。 */
const lace = (o: Rec = {}) => laceUnit('minion', 1, { evade: 0, ...o } as never)

// ---- 不經過提交的戰鬥 ----
interface Arena { k: ReturnType<typeof createKernel>; state: GameState; battle: ReturnType<typeof setupBattle>['battle']; run(dice?: number[]): BattleRun }
function arena(s: BattleSetup): Arena {
  const k = createKernel(FEATURES)
  readyFeatures(k)
  const state = makeState()
  const battle = clone(setupBattle(k, state, s).battle)
  state.battle = battle
  // run 永遠拿現在的戰鬥狀態（act 會換掉它）；改動直接寫在那一份上
  const a: Arena = { k, state, battle, run: (dice) => (dice ? fixDice(new BattleRun(k, state, state.battle!), dice) : new BattleRun(k, state, state.battle!)) }
  return a
}
const turnTo = (a: Arena, id: string): BattleUnit => {
  const b = a.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const unitOf = (a: Arena, id: string): BattleUnit => a.state.battle!.units[id]!
const options = (a: Arena): BattleOptions => battleOptions(a.k, a.state)!
const opt = (a: Arena, id: string) => options(a).actions.find((x) => x.id === id)!
/** 做一個行動（純算）：成立就把新的戰鬥狀態放回去；不成立回傳原因。 */
const act = (a: Arena, input: BattleInput): { reasons: string[] } | { ok: true } => {
  try {
    const draft = battleAct(a.k, a.state, input)
    const change = draft.changes.find((c) => c.op === 'battle') as unknown as { state: Arena['battle'] }
    a.state.battle = change.state
    a.battle = change.state
    return { ok: true }
  } catch (e) {
    if (e instanceof BattleBlocked) return { reasons: e.reasons }
    throw e
  }
}
const overlays = (a: Arena) => a.state.battle!.overlays
const NET_DEPLOY = 'net_guard_deploy'
const NET_COMMAND = 'net_guard_command'

/** 放出第 idx 個型號到第 slot 格。 */
const deploy = (a: Arena, idx: number, slot: number, action = NET_DEPLOY) => act(a, { action, target: { side: 'ally', slot }, pick: { drone: idx } })

describe('守衛程式：放出與數量（CYBERSPACE 6.9 節）', () => {
  it('內海：放出的選項只有帶 net: true 的型號；現實的行動 drone.* 與叫車都不在內海的圓環上', () => {
    const a = arena(setup('net', [pilotNet([DRONE, GUARD_ATK, GUARD_SHIELD])], [lace()]))
    turnTo(a, 'a1')
    const ids = options(a).actions.map((x) => x.id)
    for (const id of ['net_guard_deploy', 'net_guard_command', 'net_guard_move', 'net_guard_recall']) expect(ids, id).toContain(id)
    for (const id of ['drone.deploy', 'drone.command', 'drone.move', 'drone.recall', 'vehicle.call', 'node.use']) expect(ids, id).not.toContain(id)
    // 型號的索引照全部的型號（0 是現實的無人機）：內海只列 1、2
    const pick = opt(a, NET_DEPLOY).picks[0]!
    expect(pick.options.map((o) => ({ value: o.value, label: o.label }))).toEqual([{ value: 1, label: '看門犬' }, { value: 2, label: '鏡盾' }])
    // 名字與說明換成內海的
    expect(opt(a, NET_DEPLOY).desc).toContain('守衛程式')
    expect(opt(a, NET_DEPLOY).desc).not.toContain('無人機')
  })

  it('內海：現實的型號放不出來（就算用 pick 硬送）；放出的一個掛在那一格、不佔格', () => {
    const a = arena(setup('net', [pilotNet([DRONE, GUARD_ATK])], [lace()]))
    turnTo(a, 'a1')
    expect(deploy(a, 0, 1)).toEqual({ reasons: ['沒有這個守衛程式。'] })
    expect(deploy(a, 1, 2)).toEqual({ ok: true })
    expect(overlays(a)[0]).toMatchObject({ side: 'ally', slot: 2, owner: 'a1', kind: 'attack', name: '看門犬', hp: { now: 14, max: 14 }, armor: 1, down: false, autonomous: true })
    expect(Object.values(a.state.battle!.units).filter((u) => u.side === 'ally' && u.slot === 2)).toHaveLength(0)
    // 臨時放出（效果直接叫）時也看型號的戰場：現實的型號在內海被擋
    const run = a.run()
    expect(() => hang(run, run.unit('a1'), 3, { idx: 0 })).toThrow(BattleBlocked)
    expect(() => hang(run, run.unit('a1'), 3, { idx: 0 })).toThrow('這是現實的無人機，內海放不出來。')
  })

  it('內海：每個操作者同時只連得住 1 個（不看同步）；放第二個被擋並有原因；給 overlay_cap +1 的修正之後放得了，第三個又被擋', () => {
    // 同步開到 6 級也一樣只有 1 個
    const a = arena(setup('net', [pilotNet([GUARD_ATK, GUARD_SHIELD, GUARD_MEDIC], { skills: { piloting: 8, sync: 6 } })], [lace()]))
    turnTo(a, 'a1')
    expect(deploy(a, 0, 1)).toEqual({ ok: true })
    expect(deploy(a, 1, 2)).toEqual({ reasons: ['內海裡同時只連得住 1 個守衛程式。'] })
    const o = opt(a, NET_DEPLOY)
    expect(o.ok).toBe(false)
    expect(o.blocks).toEqual(['內海裡同時只連得住 1 個守衛程式。'])

    const b = arena(setup('net', [pilotNet([GUARD_ATK, GUARD_SHIELD, GUARD_MEDIC], { tags: ['netrunner', 't.cap'] })], [lace()]))
    turnTo(b, 'a1')
    expect(deploy(b, 0, 1)).toEqual({ ok: true })
    expect(deploy(b, 1, 2)).toEqual({ ok: true })
    expect(overlays(b).map((x) => x.kind)).toEqual(['attack', 'shield'])
    expect(deploy(b, 2, 3)).toEqual({ reasons: ['內海裡同時只連得住 2 個守衛程式。'] })
  })

  it('內海：同一格只掛一個；放出花 1 點行動點', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK, GUARD_SHIELD], { tags: ['netrunner', 't.cap'] })], [lace()]))
    const me = turnTo(a, 'a1')
    expect(opt(a, NET_DEPLOY).cost.ap).toBe(1)
    deploy(a, 0, 2)
    expect(unitOf(a, 'a1').ap.now).toBe(me.ap.max - 1)
    expect(deploy(a, 1, 2)).toEqual({ reasons: ['這一格已經掛著一台了。'] })
  })

  it('現實：選項只有沒帶 net 的無人機，數量照舊看同步（同步 2 連得住 2 台）', () => {
    const a = arena(setup('meat', [pilotMeat([DRONE, GUARD_ATK, { ...DRONE, kind: 'shield', name: '護盾機' }])], [partyUnit(1, 1)]))
    turnTo(a, 'a1')
    const ids = options(a).actions.map((x) => x.id)
    expect(ids).toContain('drone.deploy')
    expect(ids.some((id) => id.startsWith('net_guard_'))).toBe(false)
    expect(opt(a, 'drone.deploy').picks[0]!.options.map((o) => o.value)).toEqual([0, 2])
    expect(deploy(a, 1, 1, 'drone.deploy')).toEqual({ reasons: ['沒有這一台無人機。'] })
    expect(deploy(a, 0, 1, 'drone.deploy')).toEqual({ ok: true })
    expect(deploy(a, 2, 2, 'drone.deploy')).toEqual({ ok: true })
    expect(opt(a, 'drone.deploy').blocks).toEqual(['同步 2 級只連得住 2 台。', '沒有可以放的無人機了。'])
  })

  it('只帶內海型號的人在現實沒有放出、指揮、移動、收回；只帶現實型號的人在內海也沒有', () => {
    const a = arena(setup('meat', [pilotMeat([GUARD_ATK])], [partyUnit(1, 1)]))
    turnTo(a, 'a1')
    expect(options(a).actions.some((x) => x.id.startsWith('drone.') || x.id.startsWith('net_guard_'))).toBe(false)
    const b = arena(setup('net', [pilotNet([DRONE])], [lace()]))
    turnTo(b, 'a1')
    expect(options(b).actions.some((x) => x.id.startsWith('drone.') || x.id.startsWith('net_guard_'))).toBe(false)
  })
})

describe('守衛程式：指揮與 RAM', () => {
  it('指揮攻擊型的守衛程式開火一次：操作者少 1 點行動點、目標的感載上升（神經傷害）；沒寫 ram 不花 RAM；命中用操縱', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK])], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 1)
    const ap = unitOf(a, 'a1').ap.now
    const ram = unitOf(a, 'a1').pools.ram!.now
    const id = overlays(a)[0]!.id
    expect(opt(a, NET_COMMAND).cost).toEqual({ ap: 1 })
    // 內海的攻擊是神經傷害打在感載上（迴避 0，自然 1 以外都打中；戰鬥的骰面由開戰時的狀態決定，同一份測試每次一樣）
    const before = unitOf(a, 'f1').load!.now
    expect(act(a, { action: NET_COMMAND, target: { overlay: id }, pick: { at: 'f1' } })).toEqual({ ok: true })
    expect(unitOf(a, 'f1').load!.now).toBeGreaterThan(before)
    expect(unitOf(a, 'a1').pools.ram!.now).toBe(ram)
    expect(unitOf(a, 'a1').ap.now).toBe(ap - 1)
    expect(overlays(a)[0]!.used).toBe(true)
    // 動過的那一個灰掉
    expect(opt(a, NET_COMMAND).targets.map((x) => x.blocks)).toEqual([['這個守衛程式這一回合動過了。']])
  })

  it('指揮：每個每回合一次，原因是內海的句子', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK])], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 1)
    const id = overlays(a)[0]!.id
    expect(act(a, { action: NET_COMMAND, target: { overlay: id }, pick: { at: 'f1' } })).toEqual({ ok: true })
    expect(act(a, { action: NET_COMMAND, target: { overlay: id }, pick: { at: 'f1' } })).toEqual({ reasons: ['這個守衛程式這一回合動過了。'] })
  })

  it('型號寫 ram: 1：開火時操作者的 RAM 少 1（並照常花 1 點行動點）', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK_RAM])], [lace()]))
    const me = turnTo(a, 'a1')
    deploy(a, 0, 1)
    const o = overlays(a)[0]!
    expect(o.ext).toMatchObject({ ram: 1 })
    const ram = unitOf(a, 'a1').pools.ram!.now
    const ap = unitOf(a, 'a1').ap.now
    // 沒選哪一台時圓環上的花費只有行動點；選了才知道要花 RAM
    expect(opt(a, NET_COMMAND).cost).toEqual({ ap: 1 })
    expect(act(a, { action: NET_COMMAND, target: { overlay: o.id }, pick: { at: 'f1' } })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').pools.ram!.now).toBe(ram - 1)
    expect(unitOf(a, 'a1').ap.now).toBe(ap - 1)
    expect(me.ap.max).toBeGreaterThan(0)
  })

  it('RAM 不夠時那一個灰掉並寫出原因，送出去也被擋；RAM 夠了的別個照樣能用', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK_RAM, GUARD_ATK], { tags: ['netrunner', 't.cap'] })], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 1)
    deploy(a, 1, 2)
    unitOf(a, 'a1').pools.ram!.now = 0
    const o = opt(a, NET_COMMAND)
    const [heavy, light] = overlays(a)
    expect(o.targets.find((x) => 'overlay' in x.target && x.target.overlay === heavy!.id)!.blocks).toEqual(['RAM 不夠（要 1，現在 0）。'])
    expect(o.targets.find((x) => 'overlay' in x.target && x.target.overlay === light!.id)!.blocks).toEqual([])
    expect(o.ok).toBe(true)
    expect(act(a, { action: NET_COMMAND, target: { overlay: heavy!.id }, pick: { at: 'f1' } })).toEqual({ reasons: ['RAM 不夠（要 1，現在 0）。'] })
    expect(act(a, { action: NET_COMMAND, target: { overlay: light!.id }, pick: { at: 'f1' } })).toEqual({ ok: true })
    // 兩個都要 RAM、又都沒有：整個行動灰掉
    const b = arena(setup('net', [pilotNet([GUARD_ATK_RAM])], [lace()]))
    turnTo(b, 'a1')
    deploy(b, 0, 1)
    unitOf(b, 'a1').pools.ram!.now = 0
    expect(opt(b, NET_COMMAND).ok).toBe(false)
  })

  it('修復型：內海的人沒有生命，2d6 排在感載上；護盾型：替同一格的人擋下一次攻擊', () => {
    const a = arena(setup('net', [pilotNet([GUARD_MEDIC, GUARD_SHIELD], { tags: ['netrunner', 't.cap'] })], [lace()]))
    turnTo(a, 'a1')
    unitOf(a, 'a1').load!.now = 20
    deploy(a, 0, 1)
    deploy(a, 1, 2)
    const [medic, shield] = overlays(a)
    expect(act(a, { action: NET_COMMAND, target: { overlay: medic!.id } })).toEqual({ ok: true })
    expect(unitOf(a, 'a1').load!.now).toBeLessThan(20)
    expect(act(a, { action: NET_COMMAND, target: { overlay: shield!.id } })).toEqual({ ok: true })
    expect(overlays(a)[1]!.ext).toMatchObject({ guard: 'own_turn_start' })
  })

  it('移動與收回：同現實的規則（相鄰、不能換到掛著別個的格；收回之後可以再放）', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK, GUARD_SHIELD], { tags: ['netrunner', 't.cap'] })], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 2)
    deploy(a, 1, 3)
    const [atk] = overlays(a)
    expect(act(a, { action: 'net_guard_move', target: { overlay: atk!.id }, pick: { slot: 3 } })).toEqual({ reasons: ['只能換到相鄰、沒有掛著別台的格。'] })
    expect(act(a, { action: 'net_guard_move', target: { overlay: atk!.id }, pick: { slot: 1 } })).toEqual({ ok: true })
    expect(overlays(a)[0]!.slot).toBe(1)
    expect(act(a, { action: 'net_guard_recall', target: { overlay: atk!.id } })).toEqual({ ok: true })
    expect(overlays(a).map((x) => x.kind)).toEqual(['shield'])
    expect(unitOf(a, 'a1').uses['drone:0']).toBeUndefined()
    expect(deploy(a, 0, 1)).toEqual({ ok: true })
  })
})

describe('守衛程式：被擊落與自律', () => {
  it('被擊落（耐久歸零）：操作者受回灌的感載（5 點，同現實的數字）、這一場不能再放、那一格空出來可以再掛別的', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK, GUARD_SHIELD], { tags: ['netrunner', 't.cap'] })], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 2)
    const o = overlays(a)[0]!
    const run = a.run()
    const load = run.unit('a1').load!.now
    // 內海的守衛程式沒有生命這一條以外的軌：直接的物理傷害（耐久這條軌）打掉它
    expect(run.damageOverlay(run.battle.overlays[0]!, 99, 'physical', run.unit('f1')).downed).toBe(true)
    expect(run.unit('a1').load!.now).toBe(load + 5)
    expect(run.unit('a1').uses['drone:0']).toBe(2)
    expect(run.battle.overlays[0]!.id).toBe(o.id)
    expect(run.battle.overlays[0]!.down).toBe(true)
    // 那一格空出來：同一格可以再放別的；被擊落的這個這一場不能再放
    a.state.battle = run.battle
    expect(opt(a, NET_DEPLOY).picks[0]!.options.find((x) => x.value === 0)!.blocks).toEqual(['這個守衛程式被擊落了，這一場不能再放。'])
    expect(deploy(a, 1, 2)).toEqual({ ok: true })
    expect(a.state.battle!.overlays.filter((x) => !x.down).map((x) => x.slot)).toEqual([2])
  })

  it('被擊落的回灌吃 overlay_backlash 的修正，最少 0；資料寫了 no_backlash 的臨時機不灌', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK])], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 1)
    const run = a.run()
    const hurt = run.unit('a1').load!.now
    run.dropOverlay(run.battle.overlays[0]!, run.unit('f1'))
    expect(run.unit('a1').load!.now - hurt).toBe(5)
    // 臨時機（沒有型號）標了 noBacklash
    hang(run, run.unit('a1'), 3, { kind: 'attack', limits: { noBacklash: true } })
    const before = run.unit('a1').load!.now
    run.dropOverlay(run.battle.overlays[1]!)
    expect(run.unit('a1').load!.now).toBe(before)
  })

  // 規格：「在內海受到的傷害照內海的規則（神經與快感打得到它）」。核心的 overlayHurt 與 damageOverlay 在內海（mode.layer === 'net'）讓感載類的傷害
  // 打在守衛程式的耐久上（護甲照那一種傷害的 armor 比例，神經與快感無視護甲）；現實維持無效（M3-core-fix-a；tests/core/M3-core-fix-a.test.ts）。
  it('守衛程式被神經傷害打掉：操作者受回灌的感載、那一格空出來', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK])], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 1)
    const run = a.run()
    const load = run.unit('a1').load!.now
    const r = run.damageOverlay(run.battle.overlays[0]!, 99, 'neural', run.unit('f1'))
    expect(r.downed).toBe(true)
    expect(run.unit('a1').load!.now).toBe(load + 5)
    expect(run.battle.overlays[0]!.down).toBe(true)
  })

  it('操作者昏過去：守衛程式進入自律（沒有操作者、自己動、不移動、命中 −2），和現實一樣；沒有被擊落的後果', () => {
    const a = arena(setup('net', [pilotNet([GUARD_ATK, GUARD_SHIELD], { tags: ['netrunner', 't.cap'] }), netAvatar(1, 1, {})], [lace()]))
    turnTo(a, 'a1')
    deploy(a, 0, 1)
    deploy(a, 1, 2)
    const run = a.run()
    const load = run.unit('a1').load!.now
    run.setOut(run.unit('a1'), 'burnout')
    // 操作者退出時核心會把他那一格上的東西往後方收（slot 由核心管）；這裡只看自律的記號
    expect(run.battle.overlays.map((o) => ({ owner: o.owner, auto: o.auto, orphan: o.ext!.orphan, down: o.down }))).toEqual([
      { owner: undefined, auto: true, orphan: true, down: false },
      { owner: undefined, auto: true, orphan: true, down: false },
    ])
    const slots = run.battle.overlays.map((o) => o.slot)
    expect(run.unit('a1').load!.now).toBe(load)
    expect(run.unit('a1').uses['drone:0']).toBe(1)
    // 命中 −2（替身是攻擊者）
    const stand = run.standIn(run.battle.overlays[0]!)
    expect(run.mods('hit', stand).find((p) => p.label === '自律')).toMatchObject({ value: -2 })
    // 每一輪自己動：照操作者的操縱算出一把神經武器，打敵人的感載；不移動
    const foeLoad = run.unit('f1').load!.now
    for (let i = 0; i < 12 && run.unit('f1').load!.now === foeLoad; i += 1) {
      run.battle.overlays[0]!.used = false
      autoAct(run, run.battle.overlays[0]!)
    }
    expect(run.unit('f1').load!.now).toBeGreaterThan(foeLoad)
    expect(run.battle.overlays.map((o) => o.slot)).toEqual(slots)
  })
})

describe('現實與內海互不影響', () => {
  it('現實的無人機被擊落：還是 5 點回灌、句子與標籤照舊（現實測試原樣：M1-summons*）', () => {
    const a = arena(setup('meat', [pilotMeat([DRONE])], [partyUnit(1, 1)]))
    turnTo(a, 'a1')
    expect(deploy(a, 0, 1, 'drone.deploy')).toEqual({ ok: true })
    const run = a.run()
    run.dropOverlay(run.battle.overlays[0]!, run.unit('f1'))
    expect(run.unit('a1').load!.now).toBe(5)
    expect(run.beats.some((b) => b.text.includes('無人機被擊落') || b.text.includes('被擊落'))).toBe(true)
  })

  it('叫車只有現實：現實的圓環有、內海沒有（內海的 vehicle.call 一律不成立）', () => {
    const m = arena(setup('meat', [pilotMeat([DRONE], { ext: { summons: { drones: [DRONE], vehicle: { name: '小貨車', hp: [30, 60] } } } })], [partyUnit(1, 1)]))
    turnTo(m, 'a1')
    expect(options(m).actions.map((x) => x.id)).toContain('vehicle.call')
    const n = arena(setup('net', [pilotNet([GUARD_ATK], { ext: { summons: { drones: [GUARD_ATK], vehicle: { name: '小貨車', hp: [30, 60] } } } })], [lace()]))
    turnTo(n, 'a1')
    expect(options(n).actions.map((x) => x.id)).not.toContain('vehicle.call')
    expect(act(n, { action: 'vehicle.call', target: { side: 'ally', slot: 1 } })).toEqual({ reasons: ['a1 沒有這個行動。'.replace('a1', unitOf(n, 'a1').name)] })
  })
})
