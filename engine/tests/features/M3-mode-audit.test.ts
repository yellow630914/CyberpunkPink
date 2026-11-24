// 驗收測試：dev/work/M3-mode-audit.md（cpp-feature）。依據 dev/adr/0018 第一節最後一條與背景的「現在就會出錯的事」；
// CYBERSPACE 6.1 節（哪些相同、哪些換掉）、COMBAT_SYSTEM 第 6 節（重創，內海是破損）、第 7 節（制伏，內海是釘住）。
//
// 帶著全部功能（allFeatures()）開一場內海戰鬥，不會出現現實才有的東西：彈匣與換彈、重創的部位、束帶與制伏、脫離、士氣的生命比例、
// 天使急救、槍械與快取格的 loadout。內海的單位用 from: 'unit' 直接給（沒有生命那一條）；行動用測試自己註冊的最小兩個（花 RAM 的攻擊與回填）。
// 內海的行動表、構裝、破損是後面的工單（M3-netcombat 等），這裡不寫任何內海的規則。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleState, BattleUnit, ContentPack, Feature, GameState } from '../../src'
import { BattleRun, END_TURN, MOVE, clone, setupBattle, unitsOf, otherSide, wielded } from '../../src'
import { enemyUnit } from '../../src/features/enemies/stats'
import { equip } from '../../src/features/gear'
import type { WorldGame } from '../../src/testkit'
import { makeWorldGame, observed, playOut, testWeapon } from '../../src/testkit'
import { foe, one, raw } from '../helpers/battle'

// ---- 測試自己註冊的內海行動：花 RAM 的攻擊與回填（M3-netcombat 才有正式的行動表） ----

const NET_ATTACK = 'test.net_attack'
const NET_REFILL = 'test.net_refill'
const NET_TEST: Feature = {
  id: 'test_net_actions',
  install(k) {
    k.battle.action({
      id: NET_ATTACK, owner: 'test_net_actions', name: '內海攻擊', desc: '花 RAM 攻擊一個敵人。', group: 'attack', icon: 'shoot', tags: ['weapon_attack'], target: 'foe', order: 1, modes: ['net'],
      cost: () => ({ ap: 1, ram: 2 }),
      targets: (v, u) => unitsOf(v.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id }, blocks: [] })),
      run: (run, u, target) => {
        if (target && 'unit' in target) run.attack(u, run.unit(target.unit), { spend: 0 })
      },
      aiScore: (_v, u, t) => (t && (u.pools.ram?.now ?? 0) >= 2 ? 2 : null),
    })
    k.battle.action({
      id: NET_REFILL, owner: 'test_net_actions', name: '回填', desc: '回填 RAM。', group: 'supply', icon: 'reload', target: 'none', order: 1, modes: ['net'],
      cost: () => ({ ap: 1 }),
      blocks: (_v, u) => ((u.pools.ram?.now ?? 0) >= (u.pools.ram?.max ?? 0) ? ['RAM 是滿的。'] : []),
      run: (run, u) => {
        const ram = u.pools.ram!
        ram.now = Math.min(ram.max, ram.now + 2)
        run.say(`${u.name} 回填 RAM。`, 'refill', { unit: u.id }, u)
      },
      aiScore: (_v, u) => ((u.pools.ram?.now ?? 0) < 2 ? 3 : null),
    })
  },
}

// ---- 內容：一個只寫了現實的技能、一個要活的敵人、帶槍與護甲與快取格的裝備 ----

const NO_RAM = { ram: { now: 6, max: 6, regen: 2 } }
const PACK: ContentPack = {
  id: 'mode_audit',
  content: {
    path: [{ id: 'audit_tree', name: '測試路數', tree: '測試樹', category: 'meat', signature: 'sk_aud', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }],
    ability: [
      { id: 'sk_aud', name: '測試招牌', path: 'audit_tree', category: 'meat', tier: 1, layer: 'signature', kind: 'passive', cap: 1, xp: 20, cells: 1, text: '測試招牌。', net: null, opinion: null, meat: { tags: ['audit'] } },
      // 只寫了現實的主動技能：內海的圓環上不能出現
      { id: 'sk_shot', name: '現實的一擊', path: 'audit_tree', category: 'meat', tier: 1, layer: 'front', kind: 'active', cap: 1, xp: 20, cells: 1, after: 'sk_aud', text: '現實的一擊。', net: null, opinion: null,
        use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'load', amount: '1d6', type: 'neural' }] } },
    ],
    enemy: [{
      id: 'en_aud_catch', name: '要活的打手', desc: '測試用的敵人。', faction: 'f_gang', rank: 'minion', grades: [1, 5], kind: 'human',
      position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'capture', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.5 },
      // M3-lace 之後：放進內海要有 constructs（沒有的整步不成立）；現實照舊用 weapons
      constructs: [{ id: 'aud_c', class: 'pistol' }],
    }],
    blueprint: [
      { id: 'bp_aud_pistol', kind: 'weapon', name: '手槍', desc: '手槍。', brand: 'b', grade: 1, legal: 'free', price: 0, size: 1, weight: 1, require: [], optional: [], class: 'pistol', carry: 'side' },
      { id: 'bp_aud_vest', kind: 'armor', name: '背心', desc: '背心。', brand: 'b', grade: 1, legal: 'free', price: 0, size: 1, weight: 1, require: [], optional: [], armor: 1, covers: ['armor'], weight_class: 'medium', quick: 3 },
    ],
    item: [{ id: 'it_aud_gel', name: '急救凝膠', desc: '急救凝膠。', category: 'consumable', grade: 1, size: 1, legal: 'free', use: { ap: 1, target: 'self', modes: ['meat'], effects: [{ op: 'heal', amount: 5 }] } }],
  },
} as unknown as ContentPack

const world = (seed = 7, o: { inventory?: unknown[] } = {}): WorldGame =>
  makeWorldGame({ noGear: true, seed, features: [NET_TEST], content: [PACK], ...(o.inventory ? { patch: { inventory: o.inventory as never } } : {}) })

/** 內海的單位：沒有生命，一池 RAM；武器是神經類（打在感載上，內海只有這一條軌）。 */
const gun = () => ({ ...testWeapon('stun', 8, 3), range: [1, 5] as [number, number] })
// 沒有甲板就沒有 RAM（features/hack 在 unit.ready 拿掉）：測試的單位帶一個最小的甲板記號，正式的甲板是 M3-deck 的事
const DECK = { grade: 1, slots: [] as string[] }
const ext = (o: Record<string, unknown>): Record<string, unknown> => ({ deck: DECK, ...(o.ext as Record<string, unknown> | undefined) })
const netAlly = (o: Record<string, unknown> = {}, i = 1) => one({ hp: undefined, weapons: [gun()], pools: { ...NO_RAM }, ...o, ext: ext(o) }, i)
const netFoe = (rank: 'minion' | 'elite' | 'boss' = 'minion', o: Record<string, unknown> = {}) => foe(rank, { hp: undefined, weapons: [gun()], pools: { ...NO_RAM }, ...o, ext: ext(o) })
const netSetup = (allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup =>
  ({ mode: 'net', grade: 1, cover: 'medium', allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), ...more }) as BattleSetup

/** 把回合轉到某個人，行動點補滿（測試用：直接改狀態）。 */
const turnTo = (g: WorldGame, id: string): BattleUnit => {
  const b = g.game.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}

// ---- 一、行動表 ----

describe('內海戰鬥的行動表（0018 第一節；CYBERSPACE 6.1 節）', () => {
  it('每一個只寫了現實的行動都標了 modes: [meat]：內海的行動表只剩核心的兩個與測試的兩個', () => {
    const g = world()
    // net_ 與 adm_（管理行動）開頭的是 features/netcombat 的正式行動表（M3-netcombat；它自己的驗收測試守）：這裡只看沒有現實的行動混進來
    // hack.<程式 id> 是 features/hack 照內容裡的每一支快駭程式註冊的行動，兩個戰場都能用（modes: ['meat', 'net']，NETRUNNING 第 2 節）；假世界（M3 冒煙加了一支 qh_tw_zap）載進來就有一個
    const net = g.game.k.battle.actionsFor('net').map((a) => a.id).filter((id) => !id.startsWith('net_') && !id.startsWith('adm_') && !id.startsWith('hack.')).sort()
    expect(net).toEqual([END_TURN, MOVE, NET_ATTACK, NET_REFILL].sort())
    // 現實那一邊照舊：射擊、近戰、換彈、換武器、道具、打遮蔽、監視、制伏、脫離、投降都在
    const meat = g.game.k.battle.actionsFor('meat').map((a) => a.id)
    for (const id of ['shoot', 'melee', 'reload', 'swap', 'item', 'hit_cover', 'watch', 'subdue', 'flee', 'surrender', 'sk_shot', 'node.use', 'drone.deploy', 'vehicle.call']) expect(meat, id).toContain(id)
    for (const id of [NET_ATTACK, NET_REFILL]) expect(meat, id).not.toContain(id)
  })

  it('帶著技能與束帶的角色進內海：battleOptions 沒有射擊、近戰、換彈、換武器、打遮蔽、使用道具、制伏、脫離、叫車與現實的技能；有結束回合、換位與測試的兩個', () => {
    const g = world()
    const me = netAlly({ ext: { abilities: { equipped: ['sk_aud', 'sk_shot'], tiers: { audit_tree: 1 } } }, quick: [{ item: 'it_zip_tie', qty: 2 }, { item: 'it_aud_gel', qty: 1 }] })
    g.game.startBattle(netSetup([me], [netFoe()]))
    turnTo(g, 'a1')
    const ids = g.game.battleOptions()!.actions.map((a) => a.id).filter((id) => !id.startsWith('net_')).sort()
    expect(ids).toEqual([END_TURN, MOVE, NET_ATTACK, NET_REFILL].sort())
    for (const id of ['shoot', 'melee', 'reload', 'swap', 'hit_cover', 'item', 'subdue', 'flee', 'vehicle.call', 'sk_shot']) expect(ids, id).not.toContain(id)
  })

  it('同一個角色進現實戰鬥照舊有那些行動', () => {
    const g = world()
    const me = one({ ext: { abilities: { equipped: ['sk_aud', 'sk_shot'], tiers: { audit_tree: 1 } } }, quick: [{ item: 'it_zip_tie', qty: 2 }, { item: 'it_aud_gel', qty: 1 }] })
    g.game.startBattle({ mode: 'meat', grade: 1, cover: 'medium', allies: [raw(me)], foes: [raw(foe())] } as BattleSetup)
    turnTo(g, 'a1')
    const ids = g.game.battleOptions()!.actions.map((a) => a.id)
    for (const id of ['shoot', 'melee', 'reload', 'swap', 'hit_cover', 'item', 'subdue', 'flee', 'sk_shot']) expect(ids, id).toContain(id)
    for (const id of [NET_ATTACK, NET_REFILL]) expect(ids, id).not.toContain(id)
  })
})

// ---- 二、重創、卡彈、炸膛 ----

/** 一場直接開在 BattleRun 上的戰鬥（不經過提交）：骰子與亂數自己釘，數出亂數被叫了幾次。 */
function strike(g: WorldGame, setup: BattleSetup) {
  const battle = clone(setupBattle(g.game.k, g.game.state, setup).battle) as BattleState
  const run = new BattleRun(g.game.k, g.game.state, battle)
  let rands = 0
  run.roll = (count) => Array.from({ length: count }, () => 4)
  run.rand = () => { rands++; return 0.1 }
  const round = (): void => { g.game.k.battle.emit('round.start', { run, round: battle.round }) }
  return { run, battle, a: battle.units.a1!, f: battle.units.f1!, rands: () => rands, round }
}

describe('重創的部位只有現實才有（COMBAT_SYSTEM 第 6 節；0018 第一節）', () => {
  it('內海：釘死骰面打出自然 20，沒有擲身體的部位，目標身上沒有 limb_hurt、dazed、bleeding，wounds 是空的', () => {
    const g = world()
    const t = strike(g, netSetup([netAlly()], [netFoe('elite')]))
    const r = t.run.attack(t.a, t.f, { natural: 20, label: '內海的一擊' })
    // 真的打中了、打在感載上、這一擊本來就會重創：否則下面的「沒有」不算數
    expect(r).toMatchObject({ hit: true, natural: 20, wound: true, track: 'load' })
    expect(r.dealt).toBeGreaterThan(0)
    expect(t.rands()).toBe(0)
    expect(t.f.statuses.map((s) => s.id)).not.toContain('limb_hurt')
    expect(t.f.statuses.map((s) => s.id)).not.toContain('dazed')
    expect(t.f.statuses.map((s) => s.id)).not.toContain('bleeding')
    expect(t.f.wounds).toEqual({})
  })

  it('對照：同樣的一擊在現實會擲部位、留下狀態與 wounds', () => {
    const g = world()
    const t = strike(g, { mode: 'meat', grade: 1, cover: 'medium', allies: [raw(one({ weapon: 'pistol' }))], foes: [raw(foe('elite'))] } as BattleSetup)
    const r = t.run.attack(t.a, t.f, { natural: 20 })
    expect(r).toMatchObject({ hit: true, wound: true })
    expect(t.rands()).toBe(1)
    expect(t.f.wounds).toEqual({ limb: 1 })
    expect(t.f.statuses.map((s) => s.id)).toContain('limb_hurt')
  })

  it('內海：瞄準過的要害（要害加瞄準也是重創）一樣不擲部位；打在我方也一樣', () => {
    const g = world()
    const t = strike(g, netSetup([netAlly({}, 1)], [netFoe('elite')]))
    const r = t.run.attack(t.f, t.a, { natural: 20 })
    expect(r.wound).toBe(true)
    expect(t.rands()).toBe(0)
    expect(t.a.wounds).toEqual({})
    expect(t.a.statuses).toEqual([])
  })

  it('卡彈與炸膛只有現實才有：同一把帶 on_use 的武器，內海打出自然 1 不清彈匣、不標 jammed、不炸膛', () => {
    const fx = { on_use: { jam: 'natural1', backfire: { dice: 2 } } }
    const g = world()
    const gun = (u: Record<string, unknown>) => ({ ...u, weapons: [{ ...(u.weapons as Array<Record<string, unknown>>)[0], mag: { now: 2, max: 2 }, ext: { fx } }] })
    const net = strike(g, netSetup([gun(netAlly())], [netFoe('elite')]))
    const before = clone(net.a.ext)
    const r = net.run.attack(net.a, net.f, { natural: 1, spend: 0 })
    expect(r.hit).toBe(false)
    expect(net.a.weapons[0]!.mag).toEqual({ now: 2, max: 2 })
    expect(net.a.weapons[0]!.ext).toEqual({ fx })
    expect(net.a.ext).toEqual(before)
    expect(net.run.beats.some((b) => b.text.includes('炸膛') || b.text.includes('卡彈'))).toBe(false)
    // 對照：現實的同一把槍卡彈、炸膛
    const meat = strike(g, { mode: 'meat', grade: 1, cover: 'medium', allies: [raw(gun(one({ weapon: 'pistol' })))], foes: [raw(foe('elite'))] } as BattleSetup)
    meat.run.attack(meat.a, meat.f, { natural: 1 })
    expect(wielded(meat.a)!.mag!.now).toBe(0)
    expect(wielded(meat.a)!.ext).toMatchObject({ jammed: true })
    expect(meat.run.beats.some((b) => b.text.includes('炸膛'))).toBe(true)
  })
})

// ---- 三、帶進戰鬥的裝備 ----

const GEAR_INV = [
  { id: 'bp_aud_pistol', qty: 1, data: { uid: 'p1', parts: {} } },
  { id: 'bp_aud_vest', qty: 1, data: { uid: 'v1', parts: {} } },
  { id: 'it_aud_gel', qty: 2 },
]
const withGear = (g: WorldGame): void => {
  g.game.commit(equip(g.game.k, g.game.state, 'pc', 'p1'))
  g.game.commit(equip(g.game.k, g.game.state, 'pc', 'v1'))
  g.game.commit({ kind: 'system', action: 'gear.quick', location: {}, party: [], timeline: [], changes: [{ op: 'gear.quick', id: 'pc', items: [{ item: 'it_aud_gel', qty: 1 }] }], outcome: { result: 'ok', summary: '放進快取格。' } })
}

describe('槍械、護甲與快取格只帶進現實（EQUIPMENT 4.1 節；0018 第一節）', () => {
  it('角色帶著槍、護甲與快取格進內海：武器不含那把槍、quick 是空的；同一個角色進現實戰鬥照舊都有', () => {
    const g = world(7, { inventory: GEAR_INV })
    withGear(g)
    const m = world(7, { inventory: GEAR_INV })
    withGear(m)
    m.game.startBattle({ mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())] } as BattleSetup)
    const meat = m.game.state.battle!.units.a1!
    expect(meat.weapons.map((w) => w.id)).toEqual(['p1'])
    expect(meat.quick).toEqual([{ item: 'it_aud_gel', qty: 1 }])
    expect(meat.armor).toBeGreaterThan(0)

    g.game.startBattle({ mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(netFoe())] } as BattleSetup)
    const net = g.game.state.battle!.units.a1!
    expect(net.weapons.map((w) => w.id)).not.toContain('p1')
    expect(net.quick).toEqual([])
    expect(net.hp).toBeUndefined()
  })

  it('內海的戰鬥結束：不結算快取格（單位沒帶，拿來比會當成全部用掉）；現實用掉的照舊結算', () => {
    const g = world(7, { inventory: GEAR_INV })
    withGear(g)
    g.game.startBattle({ mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(netFoe())] } as BattleSetup)
    const state = structuredClone(g.game.state) as GameState
    state.battle!.result = { outcome: 'win', text: 'x' }
    const extras = g.game.k.battle.endExtras({ k: g.game.k, state, battle: state.battle!, outcome: 'win' })
    expect(extras.flatMap((e) => e.changes ?? []).filter((c) => c.op === 'item' || c.op === 'gear.quick')).toEqual([])
    expect(extras.flatMap((e) => e.lines ?? []).filter((l) => l.startsWith('用掉'))).toEqual([])

    const m = world(7, { inventory: GEAR_INV })
    withGear(m)
    m.game.startBattle({ mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())] } as BattleSetup)
    const ms = structuredClone(m.game.state) as GameState
    ms.battle!.units.a1!.quick = []
    ms.battle!.result = { outcome: 'win', text: 'x' }
    const used = m.game.k.battle.endExtras({ k: m.game.k, state: ms, battle: ms.battle!, outcome: 'win' })
    expect(used.flatMap((e) => e.lines ?? [])).toContain('用掉：急救凝膠 ×1')
  })
})

// ---- 四、敵人：士氣、天使急救、束帶 ----

describe('敵人的士氣、天使急救與束帶（ENEMIES 4.4 節、第 5 節；COMBAT_SYSTEM 第 7 節）', () => {
  const aiFoe = (o: Record<string, unknown> = {}) => netFoe('minion', { enemy: 'en_tw_mook', ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0.5, prefer_slots: [1], coverUse: 0.5 }, ...o })

  it('內海的敵人（fleeBelow 是 0.5、沒有生命）被打到快倒：士氣的掛點不丟錯、不檢定；沒有天使急救的倒數', () => {
    const g = world()
    const f = aiFoe({ load: { now: 21, max: 22 }, layers: 0, layersMax: 1, ext: { enemies: { angel: 'gold' } } })
    g.game.startBattle(netSetup([netAlly()], [f]))
    const b = g.game.state.battle!
    b.units.f1!.load!.now = 21
    // 讓 AI 打完這一場：敵人每一步之前都過一次士氣的掛點
    const out = playOut(g.game)
    expect(out.steps).toBeGreaterThan(0)
    const u = g.game.state.battle!.units.f1!
    expect(u.uses.morale).toBeUndefined()
    expect(u.ext.enemies).toEqual({ angel: 'gold' })
    // 內海的感載不自然消退（M3 修正批）：打到分出結果的是哪一方不一定；只要這一場打得完、士氣的掛點沒有出事
    expect(g.game.state.battle!.result).toBeDefined()
  })

  it('內海：敵人倒下之後 round.start 不數天使急救（沒有 angelLeft，也不會被帶走）', () => {
    const g = world()
    const t = strike(g, netSetup([netAlly()], [aiFoe({ ext: { enemies: { angel: 'gold' } } })]))
    t.run.setOut(t.f, 'down')
    expect(t.f.ext.enemies).toEqual({ angel: 'gold' })
    for (let i = 0; i < 4; i++) t.round()
    expect(t.f.ext.enemies).toEqual({ angel: 'gold' })
    expect(t.run.beats.some((x) => x.tag === 'angel')).toBe(false)
  })

  it('對照：同一個敵人在現實倒下，開始倒數、數到了被帶走', () => {
    const g = world()
    const t = strike(g, { mode: 'meat', grade: 1, cover: 'medium', allies: [raw(one())], foes: [raw(foe('minion', { enemy: 'en_tw_mook', ext: { enemies: { angel: 'gold' } } }))] } as BattleSetup)
    t.run.setOut(t.f, 'down')
    expect(t.f.ext.enemies).toMatchObject({ angelLeft: 3 })
    for (let i = 0; i < 3; i++) t.round()
    expect(t.f.ext.enemies).toMatchObject({ taken: true })
  })

  it('內海：就算單位帶著生命（資料的錯），士氣也不看生命比例；現實照舊看', () => {
    const g = world()
    const mk = (mode: 'net' | 'meat') => {
      const f = foe('minion', { enemy: 'en_tw_mook', hp: { now: 1, max: 100 }, ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0.5, prefer_slots: [1], coverUse: 0.5 }, ...(mode === 'net' ? { weapons: [gun()], pools: { ...NO_RAM } } : {}) })
      const a = mode === 'net' ? netAlly({ hp: { now: 40, max: 40 } }) : one({ weapon: 'pistol' })
      g.game.startBattle({ mode, grade: 1, cover: 'medium', allies: [raw(a)], foes: [raw(f)] } as BattleSetup)
      const b = g.game.state.battle!
      b.units.f1!.control = 'ai'
      b.turn = b.order.indexOf('f1')
      b.units.f1!.ap.now = b.units.f1!.ap.max
      g.game.battleNext({ anyone: true })
      return g.game.state.battle!.units.f1!.uses.morale
    }
    expect(mk('net')).toBeUndefined()
    const meatMorale = (() => {
      const g2 = world()
      const f = foe('minion', { enemy: 'en_tw_mook', hp: { now: 1, max: 100 }, ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0.5, prefer_slots: [1], coverUse: 0.5 } })
      g2.game.startBattle({ mode: 'meat', grade: 1, cover: 'medium', allies: [raw(one({ weapon: 'pistol' }))], foes: [raw(f)] } as BattleSetup)
      const b = g2.game.state.battle!
      b.turn = b.order.indexOf('f1')
      b.units.f1!.ap.now = b.units.f1!.ap.max
      g2.game.battleNext({ anyone: true })
      return g2.game.state.battle!.units.f1!.uses.morale
    })()
    expect(meatMorale).toBe(1)
  })

  it('要活的敵人白給的兩條束帶只在現實：內海的單位 quick 是空的；資料明寫的 quick 照給', () => {
    const g = world()
    const mkUnit = (mode: string) => enemyUnit(g.game.k, g.game.state, { id: 'en_aud_catch' }, { grade: 1, allyCount: 1, mode })
    expect(mkUnit('meat').quick).toEqual([{ item: 'it_zip_tie', qty: 2 }])
    expect(mkUnit('net').quick).toEqual([])
    // 經由開戰：來源 enemy 在內海組內海的單位（M3-lace；寫了 constructs 的兵種才進得來），不帶束帶
    g.game.startBattle({ mode: 'net', grade: 1, cover: 'medium', allies: [raw(netAlly())], foes: [{ from: 'enemy', id: 'en_aud_catch' }] } as BattleSetup)
    expect(g.game.state.battle!.units.f1!.quick).toEqual([])
  })
})

// ---- 五、隨機打完 ----

describe('隨機打完十場內海戰鬥', () => {
  it('十個種子：帶著全部功能不丟錯，不變式沒有違規，沒有現實才有的東西留下來', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = world(seed)
      const me = netAlly({ ext: { abilities: { equipped: ['sk_aud', 'sk_shot'], tiers: { audit_tree: 1 } } } })
      const mate = netAlly({}, 2)
      const foes = [aiFoe2(), aiFoe2('elite')]
      g.game.startBattle(netSetup([me, mate], foes))
      const { result, violations } = await observed(g.game, () => playOut(g.game))
      expect(violations, `種子 ${seed}`).toEqual([])
      expect(result.steps).toBeGreaterThan(0)
      for (const u of Object.values(g.game.state.battle!.units)) {
        expect(u.wounds, `種子 ${seed} ${u.id}`).toEqual({})
        expect(u.statuses.map((s) => s.id).filter((id) => ['limb_hurt', 'dazed', 'bleeding'].includes(id)), `種子 ${seed} ${u.id}`).toEqual([])
      }
    }
  })
})
const aiFoe2 = (rank: 'minion' | 'elite' = 'minion') => netFoe(rank, { enemy: rank === 'elite' ? 'en_tw_elite' : 'en_tw_mook', ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0.5, prefer_slots: [1, 2], coverUse: 0.5 } })
