// 驗收測試：dev/work/M3-netadmin.md（cpp-feature）。features/netcombat 的第三張：潛網者的七種管理行動（造牆、拆牆、斷路、接管、破解、擦痕跡、標記）、
// 敵方潛網者用同一組、裝著的駭入程式改它們的數字、工具構裝「後門鑰匙」的 net.crack。
// 規格：CYBERSPACE 6.6 節；NETRUNNING 第 3 節；ITEMS 11.4 節（後門鑰匙）、11.5 節（駭入程式）、11.7 節（淺檔）；dev/adr/0018 第一節、N10、N31。
// 單位用 from: 'unit' 直接給（帶 admin 標籤與 unit.ext.net.admin）；骰面釘死：第一顆是檢定的 d20（20 一定過、1 一定沒過）。內容都是測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOptions, BattleOverlay, BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel, TimelineBeat } from '../../src'
import { BattleBlocked, BattleRun, advance, aiStep, battleAct, battleOptions, beginTurn, clone, coverHpFor, createKernel, pendingDefeat, performAction, readyFeatures, setupBattle } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import { hackFeature } from '../../src/features/hack'
import { ADMIN_NAMES, DEFAULT_NETCOMBAT_RULES, adminCalc, adminDc, adminLeft, markOf, netBattleView, netcombatFeature, netcombatRules, spendAdmin } from '../../src/features/netcombat'
import { fixDice, laceUnit, makeGame, makeState, netAvatar, netWeapon, testWeapon } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 假資料 ----

const STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' },
  { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
  { id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' },
  { id: 'sync', name: '同步', attr: 'resolve', desc: '同步。' },
]
const WEAPON_CLASSES = [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }]
const hackProgram = (id: string, name: string, admin: Rec) => ({ id, class: 'hack', name, grade: 1, legal: 'banned', admin })
const CONSTRUCTS = [
  // 後門鑰匙：工具構裝，戰鬥中等於破解（沒有主控也行）
  { id: 'cs_key', class: 'tool', name: '後門鑰匙', grade: 1, legal: 'banned', ap: 1, ram: 2, target: 'none', do: [{ op: 'net.crack' }] },
  hackProgram('cs_mop', '拖把', { wipe: { amount: 10 } }),
  hackProgram('cs_mason', '泥瓦匠', { wall: { ram: 1, amount: 50 } }),
  hackProgram('cs_lever', '拆遷隊', { breach: { levels: 2, fail_trace: 10 } }),
  hackProgram('cs_lever4', '拆遷隊 IV', { breach: { levels: 2, slots: 2, fail_trace: 10 } }),
  hackProgram('cs_breaker', '斷路器', { cut: { turns: 2, slots: 2 } }),
  hackProgram('cs_throne', '王座', { seize: { turns: 2, bonus: 2 } }),
  hackProgram('cs_ram', '破城槌', { crack: { bonus: [2, 3, 4, 6] } }),
  hackProgram('cs_redpoint', '紅點', { mark: { amount: 5, targets: 2 } }),
  hackProgram('cs_other', '別的駭入程式', { wipe: { amount: 7 } }),
]
const PACK: ContentPack = { id: 'netadmin_test', content: { battle_status: STATUSES, skill: SKILLS, weapon_class: WEAPON_CLASSES, construct: CONSTRUCTS } } as unknown as ContentPack

/** 測試自己的修正：標籤對應的人加減管理行動的次數與追蹤度。 */
const MODS: Feature = {
  id: 'netadmin_test_mods',
  install(k) {
    k.battle.modifier('netadmin_test_mods', (q) => {
      if (q.kind === 'admin_uses' && q.unit.tags.includes('t.plus')) return [{ label: '測試', value: 1 }]
      if (q.kind === 'trace_admin' && q.unit.tags.includes('t.quiet')) return [{ label: '測試', value: -5 }]
      if (q.kind === 'trace_admin' && q.unit.tags.includes('t.loud')) return [{ label: '測試', value: 1 }]
      return []
    })
  },
}

const FEATURES = [deckFeature, netcombatFeature, MODS]

// ---- 單位 ----

const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], admin: 2, ...o })
const DECK = (constructs: Array<{ id: string; grade?: number }> = []) => ({ grade: 2, firewall: 12, slots: [] as string[], constructs: constructs.map((c) => ({ class: 'hack', grade: 1, ...c })) })
/** 潛網者：有 admin 標籤、次數 2、不帶武器（不會傷到任何人）。 */
const runner = (i: number, o: Rec = {}) => netAvatar(i, 1, { weapons: [], tags: ['netrunner', 'admin'], pools: { ram: { now: 10, max: 10, regen: 2 } }, ext: { net: NET(), deck: DECK() }, ...o } as never)
/** 沒有主控的化身。 */
const plain = (i: number, o: Rec = {}) => runner(i, { tags: ['netrunner'], ...o })
const lace = (o: Rec = {}) => laceUnit('minion', 1, { weapons: [], ext: { net: { sync: 'standard', sync_max: 'full', broken: [] }, deck: DECK() }, ...o } as never)
const raw = (u: unknown, slot?: number) => ({ from: 'unit', unit: u as Rec, ...(slot ? { slot } : {}) })
const setup = (allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup =>
  ({ mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), field: { trace: 20 }, origin: { escapable: true }, ...more }) as BattleSetup

// ---- 不經過提交的戰鬥 ----

interface Arena {
  k: Kernel
  state: GameState
  battle: ReturnType<typeof setupBattle>['battle']
  run(dice?: number[]): BattleRun
  a(i: number): BattleUnit
  f(i: number): BattleUnit
}

function arena(s: BattleSetup, o: { features?: Feature[]; pack?: ContentPack } = {}): Arena {
  const k = createKernel([...(o.features ?? FEATURES), combatFeature])
  k.content.loadPack(PACK)
  if (o.pack) k.content.loadPack(o.pack)
  readyFeatures(k)
  const state = makeState()
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
const opt = (a: Arena, id: string) => options(a).actions.find((x) => x.id === id)
const ring = (a: Arena): string[] => options(a).actions.map((x) => x.id)
const ADM = ADMIN_NAMES.map((n) => `adm_${n}`)
/** 做一個行動（走核心的 performAction：花費照核心的算法）；骰面釘死。回傳這一步的每一拍。 */
const doAct = (a: Arena, who: string, input: BattleInput, dice: number[] = [20]): TimelineBeat[] => {
  const run = a.run([...dice, ...Array(60).fill(10)])
  const def = a.k.battle.getAction(input.action)!
  performAction(run, run.unit(who), def, input.target ?? null, input)
  run.settle()
  return run.beats
}
const tagged = (beats: readonly TimelineBeat[], tag: string): TimelineBeat[] => beats.filter((b) => b.tag === tag)
const trace = (a: Arena): unknown => a.battle.field.trace
/** 走一輪（每個人都結束回合）。 */
const nextRound = (a: Arena): void => {
  const run = a.run()
  const r0 = a.battle.round
  for (let i = 0; i < 200 && !a.battle.result && a.battle.round === r0; i++) advance(run)
}
const reasons = (a: Arena, input: BattleInput): string[] => {
  try {
    battleAct(a.k, a.state, input)
    return []
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}
const OV = (o: Partial<BattleOverlay> = {}): Omit<BattleOverlay, 'id' | 'used' | 'down'> =>
  ({ side: 'foe', slot: 2, kind: 'turret', name: '守衛程式', hp: { now: 20, max: 20 }, armor: 1, evade: 5, weapon: testWeapon('pistol', 30), auto: true, autonomous: true, ...o }) as never

// ---- 一、圓環與次數 ----

describe('管理行動的圓環與次數（CYBERSPACE 6.6 節；dev/adr/0018 第一節）', () => {
  it('沒有 admin 標籤的人圓環上沒有這七個；有的人有，在技能那一圈，行動點是 0、RAM 照表（2、2、2、3、2、1、1）', () => {
    const a = arena(setup([runner(1), plain(2)], [lace()]))
    turnTo(a, 'a2')
    expect(ring(a).filter((id) => ADM.includes(id))).toEqual([])
    turnTo(a, 'a1')
    expect(ring(a).filter((id) => ADM.includes(id)).sort()).toEqual([...ADM].sort())
    const ram = [2, 2, 2, 3, 2, 1, 1]
    ADMIN_NAMES.forEach((n, i) => {
      const o = opt(a, `adm_${n}`)!
      expect(o.cost).toEqual({ ap: 0, ram: ram[i] })
      expect(o.group).toBe('skill')
      expect(o.icon).toBe('admin')
      expect(a.k.battle.getAction(`adm_${n}`)!.tags).toEqual(expect.arrayContaining(['admin', `admin:${n}`]))
      expect(a.k.battle.getAction(`adm_${n}`)!.modes).toEqual(['net'])
    })
  })

  it('一回合做兩次之後第三次灰掉，原因寫「2 次」；下一回合又可以', () => {
    const a = arena(setup([runner(1)], [lace()]))
    turnTo(a, 'a1')
    const slot = (n: number) => ({ target: { side: 'ally', slot: n } as const })
    doAct(a, 'a1', { action: 'adm_wall', ...slot(1) })
    doAct(a, 'a1', { action: 'adm_wall', ...slot(2) })
    expect(a.a(1).uses['turn:admin']).toBe(2)
    for (const id of ADM) {
      const why = opt(a, id)!.blocks
      expect(why[0]).toContain('2 次')
      if (['adm_wall', 'adm_cut', 'adm_crack', 'adm_mark'].includes(id)) expect(why).toHaveLength(1)
    }
    expect(reasons(a, { action: 'adm_wall', ...slot(3) }).join()).toContain('2 次')
    // 下一個自己的回合：核心清掉 turn: 開頭的記錄
    beginTurn(a.run(), a.a(1))
    expect(a.a(1).uses['turn:admin']).toBeUndefined()
    expect(opt(a, 'adm_wall')!.blocks).toEqual([])
  })

  it('admin_uses 修正 +1 是三次；全檔再 +1 是四次；沒有 ext.net.admin 基數的人只剩修正', () => {
    const a = arena(setup([runner(1, { tags: ['netrunner', 'admin', 't.plus'] }), runner(2, { tags: ['netrunner', 'admin', 't.plus'], ext: { net: NET({ sync: 'full' }), deck: DECK() } }), runner(3, { ext: { net: NET({ admin: undefined }), deck: DECK() } })], [lace()]))
    expect(adminLeft(a.run(), a.a(1))).toBe(3)
    expect(adminLeft(a.run(), a.a(2))).toBe(4)
    expect(adminLeft(a.run(), a.a(3))).toBe(0)
    turnTo(a, 'a3')
    expect(opt(a, 'adm_wipe')!.blocks[0]).toContain('0 次')
  })

  it('spendAdmin：技能替身花掉一次之後這一回合只剩一次；不夠就丟 BattleBlocked；效果 net.admin_spend 同一件事', () => {
    const a = arena(setup([runner(1)], [lace()]))
    expect(spendAdmin(a.run(), a.a(1), 1)).toBe(1)
    expect(adminLeft(a.run(), a.a(1))).toBe(1)
    expect(a.a(1).uses['turn:admin']).toBe(1)
    expect(() => spendAdmin(a.run(), a.a(1), 2)).toThrow(BattleBlocked)
    expect(adminLeft(a.run(), a.a(1))).toBe(1)
    // 效果：一次
    const last = a.run().effects([{ op: 'net.admin_spend' }], { user: a.a(1), source: { kind: 'ability', id: 'x', name: 'x' } })
    expect(last.ok).toBe(true)
    expect(adminLeft(a.run(), a.a(1))).toBe(0)
    expect(() => a.run().effects([{ op: 'net.admin_spend' }], { user: a.a(1), source: { kind: 'ability', id: 'x', name: 'x' } })).toThrow(/2 次/)
    // 格式
    expect(a.k.battle.effectProblems([{ op: 'net.admin_spend', n: 2 }, { op: 'net.crack' }])).toEqual([])
    expect(a.k.battle.effectProblems([{ op: 'net.admin_spend', n: -1 }]).join()).toContain('n 要是')
    expect(a.k.battle.effectProblems([{ op: 'net.crack', nope: 1 }]).join()).toContain('nope')
  })

  it('每個行動都寫齊 icon、desc、target 的種類；有選項要選的行動有 picks（拆牆、斷路、標記看駭入程式）', () => {
    const a = arena(setup([runner(1)], [lace()]))
    for (const id of ADM) {
      const def = a.k.battle.getAction(id)!
      expect(def.icon).toBe('admin')
      expect(def.desc.length).toBeGreaterThan(10)
      expect(def.blocks).toBeTypeOf('function')
    }
    expect(a.k.battle.getAction('adm_wall')!.target).toBe('ally_slot')
    expect(a.k.battle.getAction('adm_seize')!.target).toBe('overlay')
    expect(a.k.battle.getAction('adm_mark')!.target).toBe('foe')
    turnTo(a, 'a1')
    expect(opt(a, 'adm_mark')!.picks).toEqual([])
    const b = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_redpoint' }, { id: 'cs_breaker' }, { id: 'cs_lever4' }]) } })], [lace(), lace()]))
    turnTo(b, 'a1')
    expect(opt(b, 'adm_mark')!.picks.map((p) => p.key)).toEqual(['also_1'])
    expect(opt(b, 'adm_cut')!.picks.map((p) => p.key)).toEqual(['also'])
    expect(opt(b, 'adm_breach')!.picks.map((p) => p.key)).toEqual(['also'])
  })
})

// ---- 二、七種行動的效果 ----

describe('七種管理行動（釘死骰面成功）', () => {
  it('造牆：我方那一格高一級、耐久補滿（暴露→半掩體→掩體）；花 2 RAM、不花行動點；追蹤度 +1', () => {
    const a = arena(setup([runner(1)], [lace()], { cover: { ally: [0, 1, 0, 0], foe: [0, 0, 0, 0] } }))
    turnTo(a, 'a1')
    const ram = a.a(1).pools.ram!.now
    const ap = a.a(1).ap.now
    doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 1, hp: coverHpFor(a.run().n, 1, 1) })
    expect(a.a(1).pools.ram!.now).toBe(ram - 2)
    expect(a.a(1).ap.now).toBe(ap)
    expect(trace(a)).toBe(21)
    // 半掩體、打傷的牆：升成掩體、耐久補滿
    a.battle.cover.ally[1]!.hp = 3
    doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 2 } })
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 2, hp: coverHpFor(a.run().n, 2, 1) })
    // 已經是掩體而且耐久滿的：那一格灰掉，寫原因
    const slot2 = opt(a, 'adm_wall')!.targets.find((t) => 'slot' in t.target && t.target.slot === 2)!
    expect(slot2.blocks).toEqual(['這一格已經是掩體，耐久也是滿的。'])
  })

  it('造牆的 DC 與標籤：智識加介面，標籤 admin、admin:wall；走 save 修正的技能看得到', () => {
    const a = arena(setup([runner(1, { skills: { interface: 3 } })], [lace()]))
    turnTo(a, 'a1')
    const beats = doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
    const roll = beats.find((b) => b.roll)!.roll!
    expect(roll).toMatchObject({ attr: 'intellect', skill: 'interface', dc: 10 })
    expect(roll.parts.find((p) => p.label === '介面')?.value).toBe(3)
    // 修正拿得到標籤
    const seen: string[][] = []
    const spy: Feature = { id: 'netadmin_spy', install: (k) => k.battle.modifier('netadmin_spy', (q) => (q.kind === 'save' ? (seen.push(q.tags), []) : [])) }
    const b = arena(setup([runner(1)], [lace()]), { features: [...FEATURES, spy] })
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'adm_wipe' })
    expect(seen.some((t) => t.includes('admin') && t.includes('admin:wipe'))).toBe(true)
  })

  it('拆牆：敵方那一格低一級，不必過耐久；已經暴露的格子、打不破的遮蔽灰掉', () => {
    const a = arena(setup([runner(1)], [lace(), lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } }))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_breach', target: { side: 'foe', slot: 1 } })
    expect(a.battle.cover.foe[0]!.level).toBe(1)
    expect(trace(a)).toBe(21)
    const t = (slot: number) => opt(a, 'adm_breach')!.targets.find((x) => 'slot' in x.target && x.target.slot === slot)!
    expect(t(1).blocks).toEqual([])
    expect(t(2).blocks).toEqual(['那一格已經是暴露的，沒有牆可以拆。'])
    a.battle.cover.foe[2] = { level: 1, hp: 0, soft: { kind: 'smoke' } }
    expect(t(3).blocks).toEqual(['那一格的遮蔽是打不破的（煙霧、人群），拆不了。'])
  })

  it('斷路：那一格這一輪站在上面的人換不了位、後面的人補不進來；下一輪恢復', () => {
    const a = arena(setup([runner(1)], [lace(), lace(), lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_cut', target: { side: 'foe', slot: 1 } })
    expect(a.battle.field['cut:foe:1']).toBe(1)
    const f1 = a.f(1)
    const f2 = a.f(2)
    expect(a.run().move(f1, 2)).toBe(false)
    expect(a.run().move(f2, 1)).toBe(false)
    expect(f1.slot).toBe(1)
    expect(f2.slot).toBe(2)
    // 一輪結束：解除
    nextRound(a)
    expect(a.battle.field['cut:foe:1']).toBeUndefined()
    expect(a.run().move(a.f(1), 2)).toBe(true)
  })

  it('標記：我方打他命中 +2（敵方打他不加）；他過載之後標記沒了；已經標記的灰掉', () => {
    const a = arena(setup([runner(1, { weapons: [netWeapon(8, 4)] }), runner(2, { weapons: [netWeapon(8, 4)] })], [lace({ weapons: [netWeapon(8, 4)] }), lace()]))
    turnTo(a, 'a1')
    const before = a.run().hitChance(a.a(2), a.f(1))
    const foeBefore = a.run().hitChance(a.f(2), a.a(1))
    const beats = doAct(a, 'a1', { action: 'adm_mark', target: { unit: 'f1' } })
    expect(markOf(a.f(1))).toMatchObject({ by: 'a1', side: 'ally', bonus: 2 })
    expect(a.run().hitChance(a.a(2), a.f(1))).toBe(before + 10)
    expect(a.run().hitChance(a.a(1), a.f(1))).toBe(before + 10)
    expect(a.run().hitChance(a.f(2), a.a(1))).toBe(foeBefore)
    expect(tagged(beats, 'admin').some((b) => b.data?.admin === 'mark' && b.data.target === 'f1')).toBe(true)
    expect(opt(a, 'adm_mark')!.targets.find((t) => 'unit' in t.target && t.target.unit === 'f1')!.blocks[0]).toContain('已經被標記')
    // 過載：標記沒了
    const run = a.run()
    run.addLoad(a.f(1), 999, a.a(1), { exact: true })
    run.settle()
    expect(a.f(1).load!.now).toBeLessThanOrEqual(a.f(1).load!.max)
    expect(markOf(a.f(1))).toBeUndefined()
    expect(a.run().hitChance(a.a(2), a.f(1))).toBeLessThan(before + 10)
  })

  it('擦痕跡：追蹤度是原本 +1 −5；沒有追蹤度的場地灰掉（寫原因）、其餘的行動也不加', () => {
    const a = arena(setup([runner(1)], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_wipe' })
    expect(trace(a)).toBe(20 + 1 - 5)
    const b = arena(setup([runner(1)], [lace()], { field: {} }))
    turnTo(b, 'a1')
    expect(opt(b, 'adm_wipe')!.blocks).toEqual(['這個地方沒有追蹤度，沒有痕跡可以擦。'])
    expect(opt(b, 'adm_wall')!.blocks).toEqual([])
    doAct(b, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
    expect(trace(b)).toBeUndefined()
    expect(b.battle.field.trace).toBeUndefined()
  })

  it('追蹤度的修正 trace_admin（最少 0）：−5 之後不加也不減；+1 之後 +2', () => {
    const quiet = arena(setup([runner(1, { tags: ['netrunner', 'admin', 't.quiet'] })], [lace()]))
    turnTo(quiet, 'a1')
    doAct(quiet, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
    expect(trace(quiet)).toBe(20)
    const loud = arena(setup([runner(1, { tags: ['netrunner', 'admin', 't.loud'] })], [lace()]))
    turnTo(loud, 'a1')
    doAct(loud, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
    expect(trace(loud)).toBe(22)
  })

  it('檢定失敗：RAM 照花、沒有效果、追蹤度 +1 +5；每一種都一樣（沒有主控的人更不用說）', () => {
    const a = arena(setup([runner(1)], [lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 2, 2, 2] } }))
    turnTo(a, 'a1')
    const ram = a.a(1).pools.ram!.now
    const beats = doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } }, [1])
    expect(a.battle.cover.ally[0]!.level).toBe(0)
    expect(a.a(1).pools.ram!.now).toBe(ram - 2)
    expect(trace(a)).toBe(20 + 1 + 5)
    expect(tagged(beats, 'trace').map((b) => b.data?.amount)).toEqual([1, 5])
    expect(tagged(beats, 'admin')[0]!.data).toMatchObject({ admin: 'wall', ok: false })
    doAct(a, 'a1', { action: 'adm_breach', target: { side: 'foe', slot: 1 } }, [1])
    expect(a.battle.cover.foe[0]!.level).toBe(2)
    expect(trace(a)).toBe(32)
  })

  it('標記對目標的防火牆；失敗就沒有標記', () => {
    const a = arena(setup([runner(1)], [lace({ ext: { net: { sync: 'standard', sync_max: 'full', broken: [] }, deck: { ...DECK(), firewall: 15 } } })]))
    turnTo(a, 'a1')
    const beats = doAct(a, 'a1', { action: 'adm_mark', target: { unit: 'f1' } }, [1])
    expect(beats.find((b) => b.roll)!.roll).toMatchObject({ dc: 15, attr: 'intellect', skill: 'interface' })
    expect(markOf(a.f(1))).toBeUndefined()
    expect(trace(a)).toBe(26)
    // 精英 +2、首領 +4（核心 check 的寫法）
    const e = arena(setup([runner(1)], [laceUnit('elite', 1, { weapons: [], ext: { net: { sync: 'standard', sync_max: 'full', broken: [] }, deck: { ...DECK(), firewall: 15 } } } as never)]))
    turnTo(e, 'a1')
    expect(doAct(e, 'a1', { action: 'adm_mark', target: { unit: 'f1' } }).find((b) => b.roll)!.roll!.dc).toBe(17)
  })
})

// ---- 三、DC ----

describe('DC（dev/adr/0018 N10）', () => {
  const dcOf = (a: Arena, action: string, target?: BattleInput['target']): number => {
    turnTo(a, 'a1')
    return doAct(a, 'a1', { action, ...(target ? { target } : {}) }).find((b) => b.roll)!.roll!.dc
  }

  it('origin.ext.net.dc 是 16 時造牆對 16；沒寫、場景 III 級也是 16；五級是 10、13、16、19、22', () => {
    const wall = { side: 'ally', slot: 1 } as const
    expect(dcOf(arena(setup([runner(1)], [lace()], { origin: { escapable: true, ext: { net: { dc: 16 } } } } as never)), 'adm_wall', wall)).toBe(16)
    expect(dcOf(arena(setup([runner(1)], [lace()], { grade: 3 })), 'adm_wall', wall)).toBe(16)
    expect([1, 2, 3, 4, 5].map((g) => adminDc(arena(setup([runner(1)], [lace()], { grade: g as 1 })).run()))).toEqual([10, 13, 16, 19, 22])
    // 開戰的人給的優先（不管場景的等級）
    expect(dcOf(arena(setup([runner(1)], [lace()], { grade: 5, origin: { escapable: true, ext: { net: { dc: 12 } } } } as never)), 'adm_wipe')).toBe(12)
  })

  it('造牆、拆牆、斷路、破解、擦痕跡都用同一個地圖 DC', () => {
    const net = { origin: { escapable: true, ext: { net: { dc: 17 } } }, cover: { ally: [0, 0, 0, 0], foe: [1, 1, 1, 1] } } as never
    expect(dcOf(arena(setup([runner(1)], [lace()], net)), 'adm_breach', { side: 'foe', slot: 1 })).toBe(17)
    expect(dcOf(arena(setup([runner(1)], [lace()], net)), 'adm_cut', { side: 'foe', slot: 1 })).toBe(17)
    expect(dcOf(arena(setup([runner(1)], [lace()], net)), 'adm_crack')).toBe(17)
    expect(dcOf(arena(setup([runner(1)], [lace()], net)), 'adm_wipe')).toBe(17)
  })
})

// ---- 四、破解與後門鑰匙 ----

describe('破解（N31）與工具構裝「後門鑰匙」', () => {
  it('破解成功：結果 fled、那一拍的 data.cracked 是 true；追蹤度先 +1 再結束', () => {
    const a = arena(setup([runner(1), runner(2)], [lace(), lace()]))
    turnTo(a, 'a1')
    const beats = doAct(a, 'a1', { action: 'adm_crack' })
    expect(a.battle.result).toMatchObject({ outcome: 'fled' })
    const cracked = tagged(beats, 'admin').find((b) => b.data?.cracked === true)!
    expect(cracked.data).toMatchObject({ admin: 'crack', ok: true, cracked: true, outcome: 'fled', unit: 'a1' })
    expect(trace(a)).toBe(21)
    // 我方都還站著、敵人還在原地：沒有人倒下
    expect(Object.values(a.battle.units).every((u) => !u.out)).toBe(true)
  })

  it('破解失敗：戰鬥照舊，追蹤度 +1 +5', () => {
    const a = arena(setup([runner(1)], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_crack' }, [1])
    expect(a.battle.result).toBeUndefined()
    expect(trace(a)).toBe(26)
  })

  it('後門鑰匙：沒有 admin 標籤也做得到、不擲檢定、不加追蹤度，用完那一件從這一場消失', () => {
    const a = arena(setup([plain(1, { ext: { net: NET({ admin: undefined }), deck: DECK([{ id: 'cs_key' }]) } })], [lace()]))
    turnTo(a, 'a1')
    expect(ring(a)).toContain('net_tool:cs_key')
    expect(ring(a).filter((id) => ADM.includes(id))).toEqual([])
    const beats = doAct(a, 'a1', { action: 'net_tool:cs_key' }, [])
    expect(a.battle.result).toMatchObject({ outcome: 'fled' })
    expect(tagged(beats, 'admin').find((b) => b.data?.cracked === true)).toBeTruthy()
    expect(beats.some((b) => b.roll)).toBe(false)
    expect(trace(a)).toBe(20)
    expect((a.a(1).ext.deck as { constructs: Array<{ id: string }> }).constructs.map((c) => c.id)).not.toContain('cs_key')
    // 工具的花費照構裝寫的：1 行動點、2 RAM
    const b = arena(setup([plain(1, { ext: { net: NET({ admin: undefined }), deck: DECK([{ id: 'cs_key' }]) } })], [lace()]))
    expect(opt(turnTo(b, 'a1') && b, 'net_tool:cs_key')!.cost).toEqual({ ap: 1, ram: 2 })
  })

  it('破城槌（駭入程式）的檢定加值照構裝的等級挑（陣列 [2,3,4,6]）；寫成一個數字也行', () => {
    const roll = (grade: number) => {
      const a = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_ram', grade }]) } })], [lace()]))
      turnTo(a, 'a1')
      return doAct(a, 'a1', { action: 'adm_crack' }, [1]).find((b) => b.roll)!.roll!
    }
    expect(roll(1).parts.find((p) => p.label === '破城槌')?.value).toBe(2)
    expect(roll(3).parts.find((p) => p.label === '破城槌')?.value).toBe(4)
    expect(roll(4).parts.find((p) => p.label === '破城槌')?.value).toBe(6)
    expect(roll(9).parts.find((p) => p.label === '破城槌')?.value).toBe(6)
  })
})

// ---- 五、駭入程式 ----

describe('駭入程式改數字（ITEMS 11.5 節）', () => {
  const withProg = (ids: string[], o: Rec = {}) => arena(setup([runner(1, { ext: { net: NET(o), deck: DECK(ids.map((id) => ({ id }))) } })], [lace(), lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 2, 2, 2] } }))

  it('裝著「擦 −10」：擦痕跡是 −10；換到淺檔變回 −5（駭入程式跟著主控走）', () => {
    const a = withProg(['cs_mop'])
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_wipe' })
    expect(trace(a)).toBe(20 + 1 - 10)
    const b = withProg(['cs_mop'], { sync: 'shallow' })
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'adm_wipe' })
    expect(trace(b)).toBe(20 + 1 - 5)
    // 破損的構裝不算
    const c = withProg(['cs_mop'], { broken: ['cs_mop'] })
    turnTo(c, 'a1')
    doAct(c, 'a1', { action: 'adm_wipe' })
    expect(trace(c)).toBe(16)
    // 多件：擦得最多的算（不疊加）
    const d = withProg(['cs_mop', 'cs_other'])
    turnTo(d, 'a1')
    doAct(d, 'a1', { action: 'adm_wipe' })
    expect(trace(d)).toBe(11)
  })

  it('泥瓦匠：造牆 1 RAM，耐久 +50%', () => {
    const a = withProg(['cs_mason'])
    turnTo(a, 'a1')
    expect(opt(a, 'adm_wall')!.cost).toEqual({ ap: 0, ram: 1 })
    doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
    const base = coverHpFor(a.run().n, 1, 1)
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 1, hp: Math.round(base * 1.5) })
    expect(a.battle.cover.ally[0]!.max![0]).toBe(Math.round(base * 1.5))
  })

  it('拆遷隊：拆牆一次降兩級；檢定失敗時追蹤度 +10', () => {
    const a = withProg(['cs_lever'])
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_breach', target: { side: 'foe', slot: 1 } })
    expect(a.battle.cover.foe[0]!.level).toBe(0)
    expect(trace(a)).toBe(21)
    doAct(a, 'a1', { action: 'adm_breach', target: { side: 'foe', slot: 2 } }, [1])
    expect(a.battle.cover.foe[1]!.level).toBe(2)
    expect(trace(a)).toBe(21 + 1 + 10)
  })

  it('拆遷隊 IV：同時拆兩格（玩家選的另一格，沒選就補最近、有牆的那一格）', () => {
    const a = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_lever4' }]) } })], [lace(), lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 2, 1] } }))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_breach', target: { side: 'foe', slot: 1 } })
    // 第 2 格沒有牆，補最近有牆的第 3 格；各降兩級
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([0, 0, 0, 1])
    const b = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_lever4' }]) } })], [lace(), lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 2, 1] } }))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'adm_breach', target: { side: 'foe', slot: 1 }, pick: { also: 4 } })
    expect(b.battle.cover.foe.map((c) => c.level)).toEqual([0, 0, 2, 0])
  })

  it('斷路器：一次斷兩格（玩家選的另一格，沒選就補最近的）、持續到下一輪', () => {
    const a = withProg(['cs_breaker'])
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_cut', target: { side: 'foe', slot: 2 } })
    expect(a.battle.field['cut:foe:2']).toBe(2)
    expect(a.battle.field['cut:foe:1']).toBe(2)
    const b = withProg(['cs_breaker'])
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'adm_cut', target: { side: 'foe', slot: 1 }, pick: { also: 4 } })
    expect(Object.keys(b.battle.field).filter((k) => k.startsWith('cut:')).sort()).toEqual(['cut:foe:1', 'cut:foe:4'])
    nextRound(b)
    expect(b.battle.field['cut:foe:1']).toBe(2)
    nextRound(b)
    expect(Object.keys(b.battle.field).filter((k) => k.startsWith('cut:'))).toEqual([])
  })

  it('紅點：標記的加值 5，一次標兩個敵人（玩家選的優先，沒選就補下一個）', () => {
    const a = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_redpoint' }]) } })], [lace(), lace(), lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'adm_mark', target: { unit: 'f2' }, pick: { also_1: 'f3' } })
    expect([a.f(1), a.f(2), a.f(3)].map((u) => markOf(u)?.bonus)).toEqual([undefined, 5, 5])
    const b = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_redpoint' }]) } })], [lace(), lace(), lace()]))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'adm_mark', target: { unit: 'f2' } })
    expect([b.f(1), b.f(2), b.f(3)].map((u) => markOf(u)?.bonus)).toEqual([5, 5, undefined])
    // 淺檔：變回一個、+2
    const c = arena(setup([runner(1, { ext: { net: NET({ sync: 'shallow' }), deck: DECK([{ id: 'cs_redpoint' }]) } })], [lace(), lace()]))
    turnTo(c, 'a1')
    doAct(c, 'a1', { action: 'adm_mark', target: { unit: 'f2' } })
    expect([c.f(1), c.f(2)].map((u) => markOf(u)?.bonus)).toEqual([undefined, 2])
  })

  it('adminCalc：沒有駭入程式時照規則表；壞掉的 admin 資料（不是數字）被忽略', () => {
    const a = arena(setup([runner(1)], [lace()]))
    const n = adminCalc(a.run(), a.a(1), 'wipe')
    expect(n).toMatchObject({ ram: 1, amount: 5, failTrace: 5, bonus: [] })
    const bad: ContentPack = { id: 'bad', content: { construct: [hackProgram('cs_bad', '壞的', { wipe: { amount: 'lots', ram: null, bonus: {} }, wall: 7 })] } } as unknown as ContentPack
    const b = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_bad' }]) } })], [lace()]), { pack: bad })
    expect(adminCalc(b.run(), b.a(1), 'wipe')).toMatchObject({ ram: 1, amount: 5, bonus: [] })
    expect(adminCalc(b.run(), b.a(1), 'wall')).toMatchObject({ ram: 2 })
  })
})

// ---- 六、接管 ----

describe('接管（需要快駭功能的 hack.takeover）', () => {
  it('沒有裝快駭功能：那個行動灰掉，原因是完整的句子；其他六個不受影響', () => {
    const a = arena(setup([runner(1)], [lace()]))
    a.run().addOverlay(OV())
    turnTo(a, 'a1')
    expect(opt(a, 'adm_seize')!.blocks).toEqual(['沒有裝快駭的功能，接管不了敵方掛著的東西。'])
    expect(opt(a, 'adm_wall')!.blocks).toEqual([])
    expect(reasons(a, { action: 'adm_seize', target: { overlay: 'o1' } })[0]).toContain('快駭')
  })

  it('裝了快駭功能、但敵方沒有掛著的東西：灰掉，寫原因', () => {
    const a = arena(setup([runner(1)], [lace()]), { features: [...FEATURES, hackFeature] })
    turnTo(a, 'a1')
    expect(opt(a, 'adm_seize')!.blocks).toContain('敵方沒有掛著的守衛程式可以接管。')
  })

  it('接管成功：敵方掛著的一台一回合聽我方的（掛在我方同一格）；對它的防火牆（它的迴避）；追蹤度 +1；3 RAM', () => {
    const a = arena(setup([runner(1)], [lace()]), { features: [...FEATURES, hackFeature] })
    const o = a.run().addOverlay(OV({ evade: 9 }))
    turnTo(a, 'a1')
    const ram = a.a(1).pools.ram!.now
    expect(opt(a, 'adm_seize')!.targets).toEqual([expect.objectContaining({ target: { overlay: o.id }, blocks: [] })])
    const beats = doAct(a, 'a1', { action: 'adm_seize', target: { overlay: o.id } })
    expect(beats.find((b) => b.roll)!.roll!.dc).toBe(9)
    expect(a.battle.overlays[0]).toMatchObject({ side: 'ally', slot: 2, owner: 'a1' })
    expect((a.battle.overlays[0]!.ext!.hack as { taken: { left: number } }).taken.left).toBe(1)
    expect(a.a(1).pools.ram!.now).toBe(ram - 3)
    expect(trace(a)).toBe(21)
  })

  it('王座：接管兩回合、檢定 +2；檢定失敗它還是敵方的、追蹤度 +1 +5', () => {
    const a = arena(setup([runner(1, { ext: { net: NET(), deck: DECK([{ id: 'cs_throne' }]) } })], [lace()]), { features: [...FEATURES, hackFeature] })
    const o = a.run().addOverlay(OV())
    turnTo(a, 'a1')
    const beats = doAct(a, 'a1', { action: 'adm_seize', target: { overlay: o.id } })
    expect(beats.find((b) => b.roll)!.roll!.parts.find((p) => p.label === '王座')?.value).toBe(2)
    expect((a.battle.overlays[0]!.ext!.hack as { taken: { left: number } }).taken.left).toBe(2)
    const b = arena(setup([runner(1)], [lace()]), { features: [...FEATURES, hackFeature] })
    const o2 = b.run().addOverlay(OV())
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'adm_seize', target: { overlay: o2.id } }, [1])
    expect(b.battle.overlays[0]!.side).toBe('foe')
    expect(trace(b)).toBe(26)
  })

  it('我方那一格已經掛著一台：那個目標灰掉，說清楚是第幾格', () => {
    const a = arena(setup([runner(1)], [lace()]), { features: [...FEATURES, hackFeature] })
    a.run().addOverlay(OV({ side: 'ally', slot: 2, name: '我方的無人機' }))
    const o = a.run().addOverlay(OV())
    turnTo(a, 'a1')
    expect(opt(a, 'adm_seize')!.targets.find((t) => 'overlay' in t.target && t.target.overlay === o.id)!.blocks[0]).toContain('第 2 格已經掛著一台')
  })
})

// ---- 七、敵方的潛網者 ----

describe('敵方的潛網者', () => {
  const boss = (o: Rec = {}) => lace({ tags: ['lace', 'admin'], pools: { ram: { now: 6, max: 6, regen: 2 } }, ext: { net: { sync: 'standard', sync_max: 'full', broken: [], admin: 1 }, deck: DECK() }, ...o })
  const marked = (u: Rec) => ({ ...u, ext: { ...(u.ext as Rec), net: { ...((u.ext as Rec).net as Rec), marked: { by: 'f1', side: 'foe', bonus: 2 } } } })

  it('admin: 1：自己那一格是暴露時會造牆，一回合不超過一次，追蹤度不因此增加', () => {
    const a = arena(setup([marked(runner(1)), marked(runner(2))].map((u) => u as never), [boss()]))
    const f = turnTo(a, 'f1')
    f.control = 'ai'
    const run = a.run(Array(80).fill(20))
    for (let i = 0; i < 6; i++) if (!aiStep(run, f)) break
    expect(a.battle.cover.foe[0]!.level).toBe(1)
    expect(run.beats.filter((b) => b.tag === 'admin' && b.data?.admin === 'wall')).toHaveLength(1)
    expect(f.uses['turn:admin']).toBe(1)
    expect(trace(a)).toBe(20)
    expect(f.pools.ram!.now).toBe(4)
  })

  it('目標站在遮蔽後面時拆牆（對我方那一格）；自己已經有遮蔽就不造牆', () => {
    const a = arena(setup([marked(runner(1))].map((u) => u as never), [boss()], { cover: { ally: [2, 0, 0, 0], foe: [2, 0, 0, 0] } }))
    const f = turnTo(a, 'f1')
    f.control = 'ai'
    const run = a.run(Array(80).fill(20))
    for (let i = 0; i < 6; i++) if (!aiStep(run, f)) break
    expect(a.battle.cover.ally[0]!.level).toBe(1)
    expect(a.battle.cover.foe[0]!.level).toBe(2)
    expect(trace(a)).toBe(20)
  })

  it('其餘標記正在被集火的人（被打得最重的那一個）', () => {
    const a = arena(setup([runner(1), runner(2)], [boss()], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } }))
    a.a(2).load!.now = 10
    const f = turnTo(a, 'f1')
    f.control = 'ai'
    const run = a.run(Array(80).fill(20))
    for (let i = 0; i < 6; i++) if (!aiStep(run, f)) break
    expect(markOf(a.a(2))).toMatchObject({ by: 'f1', side: 'foe', bonus: 2 })
    expect(markOf(a.a(1))).toBeUndefined()
    expect(f.uses['turn:admin']).toBe(1)
    expect(trace(a)).toBe(20)
  })

  it('沒有 admin 標籤的敵人不會用；admin 基數 0 也不會', () => {
    const a = arena(setup([runner(1)], [lace()]))
    const f = turnTo(a, 'f1')
    f.control = 'ai'
    const run = a.run(Array(40).fill(20))
    for (let i = 0; i < 4; i++) if (!aiStep(run, f)) break
    expect(run.beats.filter((b) => b.tag === 'admin')).toEqual([])
  })
})

// ---- 八、規則表與畫面 ----

describe('規則表 netcombat_rule.admin 與畫面資料', () => {
  it('預設值照 CYBERSPACE 6.6 節；資料可以蓋，壞的整批擋下', () => {
    expect(DEFAULT_NETCOMBAT_RULES.admin).toMatchObject({ wall: { ram: 2 }, breach: { ram: 2 }, cut: { ram: 2 }, seize: { ram: 3 }, crack: { ram: 2 }, wipe: { ram: 1, amount: 5 }, mark: { ram: 1, amount: 2 }, trace: 1, fail_trace: 5 })
    const bad = (admin: unknown) => {
      const k = createKernel([...FEATURES, combatFeature])
      expect(() => k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', admin }] } } as unknown as ContentPack)).toThrow()
    }
    bad({ nope: {} })
    bad({ wall: { ram: 9 } })
    bad({ wall: { nope: 1 } })
    bad({ wipe: 5 })
    bad({ trace: -1 })
    bad(7)
    const k = createKernel([...FEATURES, combatFeature])
    k.content.loadPack({ id: 'r', content: { netcombat_rule: [{ id: 'default', admin: { wall: { ram: 1 }, wipe: { amount: 8 }, trace: 2, fail_trace: 3 } }] } } as unknown as ContentPack)
    expect(netcombatRules(k).admin).toMatchObject({ wall: { ram: 1, levels: 1 }, wipe: { ram: 1, amount: 8 }, mark: { ram: 1, amount: 2 }, trace: 2, fail_trace: 3 })
    // 預設值沒有被蓋掉
    expect(DEFAULT_NETCOMBAT_RULES.admin.wall.ram).toBe(2)
  })

  it('資料改了規則：造牆 1 RAM、追蹤度每次 +2、失敗 +3', () => {
    const rule: ContentPack = { id: 'r', content: { netcombat_rule: [{ id: 'default', admin: { wall: { ram: 1 }, trace: 2, fail_trace: 3 } }] } } as unknown as ContentPack
    const a = arena(setup([runner(1)], [lace()]), { pack: rule })
    turnTo(a, 'a1')
    expect(opt(a, 'adm_wall')!.cost).toEqual({ ap: 0, ram: 1 })
    doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } }, [1])
    expect(trace(a)).toBe(25)
  })

  it('netBattleView：有 admin 標籤的人帶管理行動的次數；沒有的是 null', () => {
    const a = arena(setup([runner(1), plain(2)], [lace()]))
    turnTo(a, 'a1')
    expect(netBattleView(a.k, a.state)!.units.map((u) => u.admin)).toEqual([{ limit: 2, used: 0, left: 2 }, null])
    doAct(a, 'a1', { action: 'adm_wipe' })
    a.state.battle = a.battle
    expect(netBattleView(a.k, a.state)!.units[0]!.admin).toEqual({ limit: 2, used: 1, left: 1 })
  })
})

// ---- 九、走完整的提交（Game） ----

describe('走完整的提交', () => {
  it('破解：玩家一步送出、結果 fled、結束的報告的紀錄有 data.cracked；不算戰敗', async () => {
    let done = false
    for (let seed = 1; seed <= 12 && !done; seed++) {
      const t = makeGame({ features: [deckFeature, netcombatFeature], content: [PACK], seed })
      const g = t.game
      const hero = runner(0, { actor: 'pc', attrs: { ...netAvatar(0, 1).attrs, intellect: 30 }, skills: { interface: 10 } })
      g.startBattle(setup([hero], [lace()]))
      for (let i = 0; i < 10 && g.battle!.order[g.battle!.turn] !== 'a1'; i++) expect(g.battleNext({ anyone: true }).status).toBe('applied')
      expect(g.battleAct({ action: 'adm_crack' }).status).toBe('applied')
      if (g.battle!.result?.outcome !== 'fled') continue
      done = true
      const res = await g.finishBattle()
      const timeline = res.reports.flatMap((r) => r.timeline)
      expect(timeline.find((b) => b.data?.cracked === true)!.tag).toBe('admin')
      expect(pendingDefeat(g.state)).toBeNull()
    }
    expect(done).toBe(true)
  })
})
