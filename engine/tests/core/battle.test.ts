// 核心的戰鬥引擎（L5 core/battle）：現實與內海共用的那一套（MIGRATION 第 5 節；dev/adr/0010）。
// 規格：COMBAT_SYSTEM 第 1～7 節；CORE_RULES 4.1、4.2 節；ENEMIES 1.5、4.5 節；CYBERSPACE 6.1、6.2 節。
// 這裡釘死骰面，一條一條驗規則；整場的流程（每一步一份報告、結束、回退、重來）在 battle-flow.test.ts。

import { describe, expect, it } from 'vitest'
import type { BattleUnit } from '../../src'
import { COVER_LAYOUTS, DEFAULT_NUMBERS, GRADE_DICE, LOSE_TURN, createKernel, weaponFromClass, advance, afterglowFull, beginTurn, coverLevel, distance, isExposed, losingTurn, moveBlock, rangeMod, unitAt, unitsOf } from '../../src'
import { BATTLE_SETUPS, TEST_ACTIONS, TEST_COMBAT, enemyUnit, partyUnit, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one, raw } from '../helpers/battle'

const N = DEFAULT_NUMBERS
const lines = (run: { beats: Array<{ text: string }> }) => run.beats.map((b) => b.text).join('\n')
const tags = (run: { beats: Array<{ tag?: string }> }) => run.beats.map((b) => b.tag).filter(Boolean)

describe('站位、距離與遮蔽（COMBAT_SYSTEM 第 2 節）', () => {
  it('距離 = 我在第幾格 ＋ 對方在第幾格 − 1；雙方的第 1 格是近身', () => {
    expect(distance({ slot: 1 }, { slot: 1 })).toBe(1)
    expect(distance({ slot: 2 }, { slot: 3 })).toBe(4)
    expect(distance({ slot: 4 }, { slot: 4 })).toBe(7)
  })

  it('距離修正：適用距離內不扣，每超出一格 −2；長槍站在第 1 格再 −4', () => {
    const rifle = testWeapon('rifle', 0), pistol = testWeapon('pistol', 0), smg = testWeapon('smg', 0)
    expect(rangeMod(N, { slot: 3 }, { slot: 1 }, rifle)).toBe(0)
    expect(rangeMod(N, { slot: 2 }, { slot: 1 }, rifle)).toBe(-2)
    expect(rangeMod(N, { slot: 1 }, { slot: 1 }, rifle)).toBe(-4 - 4)
    expect(rangeMod(N, { slot: 1 }, { slot: 3 }, rifle)).toBe(-4)
    expect(rangeMod(N, { slot: 1 }, { slot: 1 }, pistol)).toBe(0)
    expect(rangeMod(N, { slot: 4 }, { slot: 2 }, pistol)).toBe(-2)
    expect(rangeMod(N, { slot: 1 }, { slot: 1 }, smg)).toBe(-2)
  })

  it('開打：照順序站位，超過四個的在後方排隊；遮蔽照配置，耐久照場景的等級', () => {
    const five = { ...BATTLE_SETUPS.encounter(), foes: [1, 2, 3, 4, 5].map(() => raw(foe())) }
    const a = arena(five)
    expect(unitsOf(a.battle, 'ally').map((u) => [u.id, u.slot])).toEqual([['a1', 1], ['a2', 2], ['a3', 3], ['a4', 4]])
    expect(unitsOf(a.battle, 'foe')).toHaveLength(4)
    expect(a.battle.reserve.foe).toEqual(['f5'])
    expect(a.foe(5).slot).toBe(0)
    expect(a.battle.order).not.toContain('f5')
    // 「中」：我方 4→1 是掩、半、半、暴；敵方 1→4 是暴、半、半、掩（SITES 12.2 節）
    expect(a.battle.cover.ally.map((c) => [c.level, c.hp])).toEqual([[0, 0], [1, 15], [1, 15], [2, 30]])
    expect(COVER_LAYOUTS.one_sided).toEqual({ ally: [0, 0, 0, 1], foe: [2, 2, 1, 1] })
    expect(COVER_LAYOUTS.dense).toEqual({ ally: [1, 1, 2, 2], foe: [1, 1, 2, 2] })
    expect(COVER_LAYOUTS.sparse).toEqual({ ally: [0, 0, 0, 1], foe: [0, 0, 0, 1] })
    // V 級：掩體 60、半掩體 30；III 級 40、20
    expect(arena(BATTLE_SETUPS.encounter(5)).battle.cover.foe.map((c) => c.hp)).toEqual([0, 30, 30, 60])
    expect(arena(BATTLE_SETUPS.encounter(3)).battle.cover.foe.map((c) => c.hp)).toEqual([0, 20, 20, 40])
    expect(N.coverHp).toEqual({ half: [15, 15, 20, 25, 30], full: [30, 30, 40, 50, 60] })
  })

  it('埋伏：埋伏的一方多一格掩體；被埋伏的一方遮蔽全部降一級、第一回合行動點從上限 − 2 開始', () => {
    const caught = arena({ ...BATTLE_SETUPS.encounter(), ambush: 'foe' })
    expect(caught.battle.cover.ally.map((c) => c.level)).toEqual([0, 0, 0, 1])
    expect(caught.battle.cover.foe.map((c) => c.level)).toEqual([2, 1, 1, 2])
    for (const u of unitsOf(caught.battle, 'ally')) expect(u.ap.now).toBe(u.ap.max - 2)
    for (const u of unitsOf(caught.battle, 'foe')) expect(u.ap.now).toBe(u.ap.max)
    expect(unitsOf(caught.battle, 'ally').map((u) => u.slot)).toEqual([1, 2, 3, 4])
    const lead = arena({ ...BATTLE_SETUPS.encounter(), ambush: 'ally' })
    expect(lead.battle.cover.ally.map((c) => c.level)).toEqual([2, 1, 1, 2])
    expect(lead.battle.cover.foe.map((c) => c.level)).toEqual([0, 0, 0, 1])
    for (const u of unitsOf(lead.battle, 'foe')) expect(u.ap.now).toBe(u.ap.max - 2)
  })

  it('換位：只能到相鄰的格；往後退到空格、讓原本那一格空著時，原本那一格要有遮蔽', () => {
    const a = arena(duel([one(), one({}, 2)], [foe()], { ally: [0, 1, 0, 0], foe: [0, 0, 0, 0] }))
    const front = a.ally(1), second = a.ally(2)
    expect(moveBlock(a.battle, front, 2, false)).toBeNull() // 和後面的隊友交換：隨時可以
    expect(moveBlock(a.battle, front, 3, false)).toMatch(/相鄰/)
    expect(moveBlock(a.battle, second, 3, false)).toBeNull() // 第 2 格有半掩體，退到空的第 3 格可以
    second.slot = 3
    expect(moveBlock(a.battle, front, 2, false)).toMatch(/遮蔽/) // 第 1 格沒有遮蔽，退了撐不住線
    expect(moveBlock(a.battle, front, 2, true)).toMatch(/壓制/)
    a.battle.cover.ally[0]!.soft = { kind: 'smoke' } // 煙霧也算遮蔽：可以靠煙霧後撤
    expect(moveBlock(a.battle, front, 2, false)).toBeNull()
    expect(moveBlock(a.battle, front, 0, false)).toMatch(/沒有這一格/)
  })

  it('補位：前面那一格沒有單位、也沒有遮蔽時，後排連人帶遮蔽往前推，最後面那一格變暴露；前面空了但遮蔽還在就留在原地', () => {
    const a = arena(duel([one()], [foe(), foe(), foe()], { ally: [0, 0, 0, 0], foe: [0, 2, 1, 0] }))
    const run = a.run()
    run.setOut(a.foe(1), 'down')
    expect([a.foe(2).slot, a.foe(3).slot]).toEqual([1, 2])
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([2, 1, 0, 0])
    expect(tags(run)).toContain('compact')
    // 第 1 格空了但還有掩體：後面的人留在原地
    run.setOut(a.foe(2), 'down')
    expect(a.foe(3).slot).toBe(2)
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([2, 1, 0, 0])
    // 把空格的遮蔽打掉，後排才被逼上前
    run.hurtCover('foe', 1, 100)
    expect(a.foe(3).slot).toBe(1)
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([1, 0, 0, 0])
  })

  it('遮蔽受損：打穿一級就降一級，多的傷害算到下一級；沒有人站的格子傷害加倍；煙霧打不破', () => {
    const a = arena(duel([one()], [foe(), foe()], { ally: [0, 0, 0, 0], foe: [2, 2, 0, 0] }))
    const run = a.run()
    run.hurtCover('foe', 1, 20)
    expect(a.battle.cover.foe[0]).toEqual({ level: 2, hp: 10 })
    run.hurtCover('foe', 1, 12)
    expect(a.battle.cover.foe[0]).toEqual({ level: 1, hp: 13 })
    // 沒人站的格子：傷害加倍
    a.foe(2).out = 'down'
    run.hurtCover('foe', 2, 10)
    expect(a.battle.cover.foe[1]).toEqual({ level: 2, hp: 10 })
    a.battle.cover.foe[0]!.soft = { kind: 'smoke', until: 3 }
    run.hurtCover('foe', 1, 999)
    expect(a.battle.cover.foe[0]!.level).toBe(1)
    expect(coverLevel({ level: 0, hp: 0, soft: { kind: 'smoke' } })).toBe(1)
    expect(coverLevel({ level: 2, hp: 30, soft: { kind: 'crowd' } })).toBe(2)
  })

  it('推與拉：往後推一格、拉近一格；目的格有人就兩個人交換；到底了不動', () => {
    const a = arena(duel([one()], [foe(), foe(), foe(), foe()], { ally: [0, 0, 0, 0], foe: [1, 1, 1, 1] }))
    const run = a.run()
    expect(run.shift(a.foe(1), +1)).toBe(true)
    expect([a.foe(1).slot, a.foe(2).slot]).toEqual([2, 1])
    expect(run.shift(a.foe(4), +1)).toBe(false)
    expect(run.place(a.foe(4), 1)).toBe(true) // 抓捕索：把後排的人拉到第 1 格
    expect([a.foe(4).slot, a.foe(2).slot]).toEqual([1, 4])
    expect(tags(run)).toEqual(['push', 'pull'])
  })
})

describe('回合與行動點（COMBAT_SYSTEM 1.2 節）', () => {
  it('先攻 = 1d20 ＋ 加值，由高到低；第一回合從上限開始，之後每回合回 3 點、不超過上限，沒用完的留著', () => {
    const a = arena()
    const ini = a.battle.order.map((id) => a.battle.units[id]!.initiative)
    expect([...ini].sort((x, y) => y - x)).toEqual(ini)
    for (const u of Object.values(a.battle.units)) {
      expect(u.initiative - u.initBonus).toBeGreaterThanOrEqual(1)
      expect(u.initiative - u.initBonus).toBeLessThanOrEqual(20)
      expect(u.ap.now).toBe(u.ap.max)
    }
    const run = a.run()
    const first = run.current()!
    expect(first.uses.turns).toBe(1)
    first.ap.now = 1
    for (let i = 0; i < a.battle.order.length; i++) advance(run)
    expect(a.battle.round).toBe(2)
    expect(run.current()!.id).toBe(first.id)
    expect(first.ap.now).toBe(Math.min(first.ap.max, 1 + 3))
    first.ap.now = first.ap.max - 1
    for (let i = 0; i < a.battle.order.length; i++) advance(run)
    expect(first.ap.now).toBe(first.ap.max)
    expect(N.apRegen).toBe(3)
  })

  it('感載每回合自然消退 2 ＋ mod(意志)（CORE_RULES 4.2 節），不低於 0', () => {
    const a = arena(duel([one({ attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 12, charm: 10 } })], [foe()]))
    const u = a.ally(1)
    u.load!.now = 10
    beginTurn(a.run(), u)
    expect(u.load!.now).toBe(10 - 3)
    u.load!.now = 2
    beginTurn(a.run(), u)
    expect(u.load!.now).toBe(0)
    // 意志很低的人不會因此往上加
    const weak = arena(duel([one({ attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 4, charm: 10 } })], [foe()])).ally(1)
    weak.load!.now = 5
    const b = arena(duel([one()], [foe()]))
    b.battle.units.a1 = weak
    beginTurn(b.run(), weak)
    expect(weak.load!.now).toBe(5)
  })
})

describe('命中（COMBAT_SYSTEM 第 3 節）', () => {
  const setup = (cover = [0, 0, 0, 0], o: Parameters<typeof foe>[1] = {}) => arena(duel([one({ weapon: 'pistol' })], [foe('minion', o)], { ally: [0, 0, 0, 0], foe: cover }))

  it('攻擊 ≥ 迴避就命中；超過 5 以上是要害，傷害骰加一顆', () => {
    const a = setup()
    const me = a.ally(1), t = a.foe(1) // 攻擊 +4、迴避 10；手槍 3d6 ＋ 1，護甲 1
    const miss = a.run([5, 3, 3, 3]).attack(me, t)
    expect(miss).toMatchObject({ hit: false, total: 9, evade: 10, dealt: 0 })
    const hit = a.run([6, 3, 3, 3]).attack(me, t)
    expect(hit).toMatchObject({ hit: true, crit: false, total: 10, raw: 10, dealt: 9, track: 'hp' })
    const crit = a.run([11, 3, 3, 3, 3]).attack(me, t)
    expect(crit).toMatchObject({ hit: true, crit: true, raw: 13, dealt: 12 })
    expect(N.critMargin).toBe(5)
  })

  it('自然 20 一定命中，自然 1 一定失手', () => {
    const a = setup([0, 0, 0, 0], { evade: 60 })
    expect(a.run([20, 3, 3, 3, 3]).attack(a.ally(1), a.foe(1)).hit).toBe(true)
    const easy = setup([0, 0, 0, 0], { evade: -20 })
    const r = easy.run([1, 3, 3, 3])
    expect(r.attack(easy.ally(1), easy.foe(1)).hit).toBe(false)
    expect(lines(r)).toMatch(/自然 1/)
  })

  it('遮蔽給迴避：半掩體 +2、掩體 +4；剛好被遮蔽擋下的寫出來', () => {
    const half = setup([1, 0, 0, 0]), full = setup([2, 0, 0, 0])
    expect(half.run().evadeOf(half.foe(1)).total).toBe(12)
    expect(full.run().evadeOf(full.foe(1)).total).toBe(14)
    const r = full.run([8, 3, 3, 3]) // 12 對 14：沒有遮蔽的話打得中
    expect(r.attack(full.ally(1), full.foe(1)).hit).toBe(false)
    expect(lines(r)).toMatch(/被遮蔽擋下/)
    expect(N.coverBonus).toEqual([0, 2, 4])
  })

  it('黑暗：全場迴避 +2，有夜視的攻擊不受影響', () => {
    const a = arena(duel([one(), one({ tags: ['night_vision'] }, 2)], [foe()], undefined, { field: { dark: true } }))
    const run = a.run()
    expect(run.evadeOf(a.foe(1), a.ally(1)).total).toBe(12)
    expect(run.evadeOf(a.foe(1), a.ally(2)).total).toBe(10)
  })

  it('瞄準過的射擊命中 +3（武器帶 aimed 的每一槍都算，不重複加）；命中率夾在 5%～95%', () => {
    const a = arena(duel([one({ weapon: 'sniper' }), one({ weapon: 'pistol' }, 2)], [foe(), foe(), foe(), foe()]))
    const sniper = a.ally(1), pistol = a.ally(2), far = a.foe(4)
    const run = a.run()
    const sum = (u: BattleUnit, o = {}) => run.hitParts(u, far, u.weapons[0]!, o).reduce((s, p) => s + p.value, 0)
    // 狙擊槍在第 1 格：長槍 −4；到第 4 格距離 4，比適用距離 5 近一格 −2；瞄準 +3
    expect(sum(sniper)).toBe(4 - 4 - 2 + 3)
    expect(sum(sniper, { aimed: true })).toBe(4 - 4 - 2 + 3)
    expect(sum(pistol)).toBe(4 - 2) // 第 2 格到第 4 格距離 5，手槍 1～4
    expect(sum(pistol, { aimed: true })).toBe(4 - 2 + 3)
    expect(run.hitChance(pistol, far)).toBe((21 - (10 - 2)) * 5)
    far.evade = 60
    expect(run.hitChance(pistol, far)).toBe(5)
    far.evade = -60
    expect(run.hitChance(pistol, far)).toBe(95)
  })
})

describe('護甲與傷害（COMBAT_SYSTEM 第 4、5 節；ENEMIES 1.5 節）', () => {
  it('實際傷害 = 傷害 − 護甲 ＋ 穿甲；穿甲只抵銷護甲，超過的不算（dev/adr/0013）', () => {
    const a = arena(duel([one()], [foe('minion', { armor: 3 })]))
    const t = a.foe(1)
    const run = a.run()
    expect(run.damage(t, 10, 'physical').dealt).toBe(7)
    expect(run.damage(t, 10, 'physical', undefined, { pierce: 2 }).dealt).toBe(9)
    expect(run.damage(t, 10, 'physical', undefined, { pierce: 5 }).dealt).toBe(10)
    expect(run.damage(t, 2, 'physical').dealt).toBe(0)
    expect(N.pierceOverflow).toBe(false)
  })

  it('位階的傷害倍率：敵人的生命傷害扣掉護甲之後乘（雜兵 ×0.4、精英 ×0.6、首領 ×1），四捨五入、最少 1；我方不打折', () => {
    const a = arena(duel([one({ armor: 2 })], [foe('minion'), foe('elite'), foe('boss')]))
    const me = a.ally(1)
    const run = a.run()
    expect(run.damage(me, 10, 'physical', a.foe(1)).dealt).toBe(Math.round(8 * 0.4))
    expect(run.damage(me, 10, 'physical', a.foe(2)).dealt).toBe(Math.round(8 * 0.6))
    expect(run.damage(me, 10, 'physical', a.foe(3)).dealt).toBe(8)
    expect(run.damage(me, 3, 'physical', a.foe(1)).dealt).toBe(1)
    expect(run.damage(me, 2, 'physical', a.foe(1)).dealt).toBe(0)
    expect(run.damage(a.foe(3), 10, 'physical', me).dealt).toBe(9)
    expect(N.rankDamage).toEqual({ minion: 0.4, elite: 0.6, boss: 1 })
  })

  it('五種傷害類型：熱能無視一半護甲；電磁不看護甲、對機器加倍；神經與快感打感載、不看護甲、對沒有橋的無效', () => {
    const a = arena(duel([one()], [foe('minion', { armor: 5 }), foe('minion', { armor: 5, tags: ['machine'] })]), undefined, (k) => k.content.load('battle_status', TEST_STATUSES))
    const man = a.foe(1), bot = a.foe(2)
    delete bot.load
    const run = a.run()
    expect(run.damage(man, 10, 'thermal').dealt).toBe(10 - 2)
    expect(man.statuses.map((s) => s.id)).toContain('burning')
    expect(run.damage(man, 10, 'em').dealt).toBe(10)
    expect(run.damage(bot, 10, 'em').dealt).toBe(20)
    expect(run.damage(man, 10, 'neural')).toEqual({ dealt: 10, track: 'load' })
    expect(man.load!.now).toBe(10)
    expect(run.damage(bot, 10, 'neural')).toEqual({ dealt: 0, track: 'none' })
    expect(lines(run)).toMatch(/沒有橋/)
    run.damage(man, 5, 'pleasure')
    expect(man.sink).toBe(1)
  })

  it('任何攻擊都會傷到目標那一格的遮蔽，不管有沒有打中：傷害骰 × 武器的遮蔽倍率；倍率 0 的不傷', () => {
    const a = arena(duel([one({ weapon: 'shotgun' }), one({ weapon: 'knife' }, 2)], [foe()], { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }))
    const t = a.foe(1)
    a.run([2, 4, 4, 4, 4, 4]).attack(a.ally(1), t) // 沒打中：5d6 = 20，×1.5 = 30 → 掩體剛好被打穿
    expect(a.battle.cover.foe[0]).toEqual({ level: 1, hp: 15 })
    a.run([19, 2, 2, 2, 2, 2, 2]).attack(a.ally(1), t) // 要害 6d6 = 12，×1.5 = 18 → 再降一級
    expect(a.battle.cover.foe[0]!.level).toBe(0)
    const b = arena(duel([one({ weapon: 'knife' })], [foe()], { ally: [0, 0, 0, 0], foe: [1, 0, 0, 0] }))
    b.run([9, 6, 6, 6]).attack(b.ally(1), b.foe(1)) // 近戰的遮蔽倍率是 0
    expect(b.battle.cover.foe[0]).toEqual({ level: 1, hp: 15 })
  })

  it('霰彈：距離 1～2 是 5d6、3 以上 3d6；命中把目標往後推一格', () => {
    const a = arena(duel([one({ weapon: 'shotgun' })], [foe('elite'), foe('elite'), foe('elite')]))
    const near = a.run([10, 1, 1, 1, 1, 1])
    expect(near.attack(a.ally(1), a.foe(1)).raw).toBe(5 + 1)
    expect(a.foe(1).slot).toBe(2)
    expect(a.foe(2).slot).toBe(1)
    expect(tags(near)).toContain('push')
    expect(a.run([10, 1, 1, 1]).attack(a.ally(1), a.foe(3)).raw).toBe(3 + 1)
  })

  it('生命歸零就倒下；一方全部倒下分出結果', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]))
    const t = a.foe(1)
    t.hp!.now = 3
    const run = a.run([6, 6, 6, 6])
    expect(run.attack(a.ally(1), t).downed).toBe(true)
    expect(t.out).toBe('down')
    expect(a.battle.result).toEqual({ outcome: 'win', text: expect.any(String) })
    expect(tags(run)).toEqual(expect.arrayContaining(['hit', 'damage', 'down', 'battle.end']))
    const b = arena(duel([one()], [foe()]))
    b.run().setOut(b.ally(1), 'down')
    expect(b.battle.result!.outcome).toBe('lose')
  })
})

describe('重創（COMBAT_SYSTEM 第 6 節）', () => {
  const woundSpy = () => {
    const seen: Array<{ target: string; aimed: boolean }> = []
    return { seen, prepare: (k: Parameters<NonNullable<Parameters<typeof arena>[2]>>[0]) => k.battle.on('wound', 'test', ({ target, aimed }) => { seen.push({ target: target.id, aimed }) }) }
  }

  it('自然 20 擲重創；雜兵不擲部位，直接多一顆傷害骰', () => {
    const spy = woundSpy()
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('minion'), foe('elite')]), undefined, spy.prepare)
    // 雜兵：自然 20 是要害（+1 顆）也是重創（再 +1 顆）：5d6
    const r = a.run([20, 1, 1, 1, 1, 1]).attack(a.ally(1), a.foe(1))
    expect(r).toMatchObject({ wound: true, raw: 5 + 1 })
    expect(spy.seen).toEqual([])
    // 精英：擲部位（交給功能），不多一顆
    const e = a.run([20, 1, 1, 1, 1]).attack(a.ally(1), a.foe(2))
    expect(e).toMatchObject({ wound: true, raw: 4 + 1 })
    expect(spy.seen).toEqual([{ target: 'f2', aimed: false }])
  })

  it('打出要害、而且是瞄準過的射擊才擲重創；沒瞄準的要害不擲', () => {
    const spy = woundSpy()
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('elite')]), undefined, spy.prepare)
    expect(a.run([12, 1, 1, 1, 1]).attack(a.ally(1), a.foe(1))).toMatchObject({ crit: true, wound: false })
    expect(a.run([12, 1, 1, 1, 1]).attack(a.ally(1), a.foe(1), { aimed: true })).toMatchObject({ crit: true, wound: true })
    expect(spy.seen).toEqual([{ target: 'f1', aimed: true }])
  })
})

describe('感載、過載與餘韻（CORE_RULES 4.2 節；COMBAT_SYSTEM 第 7 節）', () => {
  it('受到的感載 = 原始值 ×（0.75 ＋ 敏感度 ÷ 200）', () => {
    const a = arena(duel([one()], [foe('boss', { sensitivity: 50 }), foe('boss', { sensitivity: 100 }), foe('boss', { sensitivity: 0 })]))
    const run = a.run()
    expect(run.addLoad(a.foe(1), 20)).toBe(20)
    expect(run.addLoad(a.foe(2), 20)).toBe(25)
    expect(run.addLoad(a.foe(3), 20)).toBe(15)
  })

  it('感載到達上限就過載：歸零（多的不留）、疊一層餘韻、失去下一個回合；疊滿之後再過載就倒下', () => {
    const a = arena(duel([one()], [foe('minion'), foe('minion')])) // 雜兵：上限 22、承受 1 層
    const t = a.foe(1)
    const run = a.run()
    run.addLoad(t, 30)
    expect(t.load!.now).toBe(0)
    expect(t.layers).toBe(1)
    expect(losingTurn(t)).toBe(true)
    expect(afterglowFull(t)).toBe(true)
    expect(tags(run)).toContain('overload')
    run.addLoad(t, 22)
    expect(t.out).toBe('burnout')
    expect(a.battle.result).toBeUndefined()
  })

  it('失去回合：輪到他時跳過；過了那一回合就不再動不了', () => {
    const a = arena(duel([one()], [foe()]))
    const t = a.foe(1)
    const run = a.run()
    run.applyStatus(t, LOSE_TURN, { force: true })
    expect(beginTurn(run, t)).toBe(false)
    expect(losingTurn(t)).toBe(false)
    expect(tags(run)).toContain('turn.skip')
    expect(beginTurn(run, t)).toBe(true)
  })

  it('餘韻每一層：現實是命中與迴避各 −1（全屬性 −2），自己造成的感載 +10%', () => {
    const a = arena(duel([one({ weapon: 'stun' })], [foe('boss')]))
    const me = a.ally(1), t = a.foe(1)
    const run = a.run()
    const hit = () => run.hitParts(me, t, me.weapons[0]!).reduce((s, p) => s + p.value, 0)
    const before = hit(), ev = run.evadeOf(me).total
    me.layers = 2
    expect(hit()).toBe(before - 2)
    expect(run.evadeOf(me).total).toBe(ev - 2)
    expect(run.damage(t, 20, 'neural', me).dealt).toBe(24)
  })

  it('重傷（生命低於一半）：所有檢定 −2', () => {
    const a = arena(duel([one()], [foe()]))
    const me = a.ally(1)
    const run = a.run()
    const hit = () => run.hitParts(me, a.foe(1), me.weapons[0]!).reduce((s, p) => s + p.value, 0)
    const before = hit()
    me.hp!.now = Math.floor(me.hp!.max / 2) - 1
    expect(hit()).toBe(before - 2)
    expect(run.mods('save', me).map((p) => p.label)).toContain('重傷')
  })

  it('內海是同一套引擎：只有感載一條、防護擋感載、過載不失去回合而是閃斷、餘韻每層 +1（CYBERSPACE 6.1、6.2 節）', () => {
    const avatar = (o = {}) => { const u = one({ weapon: 'stun', pools: { ram: { now: 4, max: 4, regen: 2 } }, ...o }); delete u.hp; return u }
    const lace = () => { const u = foe('minion'); delete u.hp; u.armor = 2; u.pools = { ram: { now: 4, max: 4, regen: 2 } }; return u }
    const a = arena({ ...duel([avatar()], [lace(), lace()]), mode: 'net' })
    const me = a.ally(1), t = a.foe(1)
    const run = a.run()
    expect(run.mode).toMatchObject({ id: 'net', layer: 'net', tracks: ['load'], overload: 'flash' })
    // 防護構裝直接減感載
    expect(run.damage(t, 10, 'neural').dealt).toBe(8)
    run.addLoad(t, 100)
    expect(t.layers).toBe(1)
    expect(losingTurn(t)).toBe(false)
    expect(t.pools.ram!.now).toBe(0)
    // 餘韻只有好處
    const before = run.hitParts(me, t, me.weapons[0]!).reduce((s, p) => s + p.value, 0)
    me.layers = 2
    expect(run.hitParts(me, t, me.weapons[0]!).reduce((s, p) => s + p.value, 0)).toBe(before + 2)
    // 全部灌倒就贏：沒有生命這一條
    run.addLoad(t, 100)
    run.setOut(a.foe(2), 'burnout')
    expect(a.battle.result!.outcome).toBe('win')
    expect(run.beats.every((b) => b.layer === 'net')).toBe(true)
  })
})

describe('狀態（資料驅動；ENEMIES 4.5 節的控制保護）', () => {
  const withStatuses = (setup = duel([one()], [foe(), foe('boss')])) => arena(setup, undefined, (k) => k.content.load('battle_status', TEST_STATUSES))

  it('壓制：到他的下一回合結束前不能換位、攻擊 −2', () => {
    const a = withStatuses()
    const t = a.foe(1)
    const run = a.run()
    run.applyStatus(t, 'suppressed', { by: a.ally(1) })
    expect(run.cannotMove(t)).toBe(true)
    expect(run.mods('hit', t).map((p) => [p.label, p.value])).toContainEqual(['壓制', -2])
    // 輪到他、他的回合結束：壓制才結束
    a.battle.turn = a.battle.order.indexOf(t.id)
    advance(run)
    expect(run.cannotMove(t)).toBe(false)
  })

  it('標記：到標記的人的下一回合開始前，全隊打他命中 +2', () => {
    const a = withStatuses(duel([one(), one({}, 2)], [foe()]))
    const me = a.ally(1), mate = a.ally(2), t = a.foe(1)
    const run = a.run()
    run.applyStatus(t, 'marked', { by: me })
    const bonus = (u: BattleUnit) => run.hitParts(u, t, u.weapons[0]!).find((p) => p.label === '標記')?.value
    expect([bonus(me), bonus(mate)]).toEqual([2, 2])
    beginTurn(run, mate)
    expect(bonus(mate)).toBe(2)
    beginTurn(run, me)
    expect(bonus(mate)).toBeUndefined()
  })

  it('流血每回合 −2，急救可停；暈眩下回合行動點 −2，只一次；燃燒兩回合各 1d6', () => {
    const a = withStatuses()
    const t = a.foe(1)
    t.uses.turns = 1
    const run = a.run([4, 5])
    run.applyStatus(t, 'bleeding')
    run.applyStatus(t, 'dazed')
    t.ap.now = 0
    const hp = t.hp!.now
    beginTurn(run, t)
    expect(t.hp!.now).toBe(hp - 2)
    expect(t.ap.now).toBe(3 - 2)
    expect(t.statuses.map((s) => s.id)).toEqual(['bleeding'])
    expect(run.cleanse(t, 'first_aid')).toEqual(['bleeding'])
    run.applyStatus(t, 'burning')
    beginTurn(run, t)
    expect(t.hp!.now).toBe(hp - 2 - 4)
    beginTurn(run, t)
    expect(t.hp!.now).toBe(hp - 2 - 4 - 5)
    expect(t.statuses).toEqual([])
  })

  it('首領的控制保護：控制效果最多 1 回合，之後免疫控制 1 回合；過載的失去回合不受這一條限制', () => {
    const a = withStatuses()
    const boss = a.foe(2), mook = a.foe(1)
    const run = a.run()
    expect(run.applyStatus(boss, 'frozen', { turns: 3 })).toBe(true)
    expect(boss.statuses[0]!.until).toMatchObject({ turns: 1 })
    run.removeStatus(boss, 'frozen')
    expect(run.applyStatus(boss, 'frozen')).toBe(false)
    a.battle.round += 2
    expect(run.applyStatus(boss, 'frozen')).toBe(true)
    // 雜兵沒有保護
    expect(run.applyStatus(mook, 'frozen', { turns: 2 })).toBe(true)
    expect(run.applyStatus(mook, 'frozen', { turns: 2 })).toBe(true)
    // 過載照常讓首領失去回合
    run.removeStatus(boss, 'frozen')
    run.addLoad(boss, 999)
    expect(losingTurn(boss)).toBe(true)
  })

  it('沒有這個狀態就丟錯（狀態是封閉清單：資料裡有才給得了）', () => {
    const a = arena(duel([one()], [foe()]))
    expect(() => a.run().applyStatus(a.foe(1), 'suppressed')).toThrow(/沒有 suppressed 這個狀態/)
  })
})

describe('監視（COMBAT_SYSTEM 1.3 節）', () => {
  const watching = (cover: number[]) => {
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe(), foe()], { ally: [1, 1, 0, 0], foe: cover }))
    a.ally(1).watch = { action: TEST_ACTIONS.ATTACK }
    return a
  }

  it('敵人換位站上暴露的格子：自動朝他攻擊一次，不花行動點，彈匣照扣；觸發之後就不再監視', () => {
    const a = watching([1, 1, 0, 0])
    const me = a.ally(1), t = a.foe(2)
    const run = a.run([10, 3, 3, 3])
    const ap = me.ap.now
    run.move(t, 3)
    run.settle()
    expect(tags(run)).toEqual(expect.arrayContaining(['move', 'watch.fire', 'hit']))
    expect(me.ap.now).toBe(ap)
    expect(me.weapons[0]!.mag!.now).toBe(1)
    expect(me.watch).toBeUndefined()
  })

  it('遮蔽被打成暴露、被推進暴露的格子、補位，都算站上去；宣告時已經站在暴露格的不算', () => {
    const a = watching([1, 0, 0, 0])
    const run = a.run([10, 3, 3, 3])
    run.settle() // f2 本來就站在暴露的第 2 格：不算
    expect(tags(run)).not.toContain('watch.fire')
    run.hurtCover('foe', 1, 15)
    run.settle()
    expect(tags(run)).toContain('watch.fire')
    const b = watching([1, 1, 0, 0])
    const r2 = b.run([10, 3, 3, 3])
    r2.shift(b.foe(2), +1)
    r2.settle()
    expect(tags(r2)).toContain('watch.fire')
  })

  it('每一個監視的人各自觸發；觸發的那一刻攻擊不了（彈匣空了）就不算，繼續等', () => {
    const a = watching([1, 1, 0, 0])
    const me = a.ally(1), mate = a.ally(2)
    mate.watch = { action: TEST_ACTIONS.ATTACK }
    me.weapons[0]!.mag!.now = 0
    const run = a.run([10, 3, 3, 3])
    run.move(a.foe(2), 3)
    run.settle()
    expect(me.watch).toEqual({ action: TEST_ACTIONS.ATTACK })
    expect(mate.watch).toBeUndefined()
    expect(run.beats.filter((b) => b.tag === 'watch.fire')).toHaveLength(1)
    // 兩個人都打得到時各打一次
    const b = watching([1, 1, 0, 0])
    b.ally(2).watch = { action: TEST_ACTIONS.ATTACK }
    const r2 = b.run([10, 1, 1, 1, 10, 1, 1, 1])
    r2.move(b.foe(2), 3)
    r2.settle()
    expect(r2.beats.filter((x) => x.tag === 'watch.fire')).toHaveLength(2)
  })

  it('監視到自己的下一回合開始前為止', () => {
    const a = watching([1, 1, 0, 0])
    beginTurn(a.run(), a.ally(1))
    expect(a.ally(1).watch).toBeUndefined()
  })
})

describe('後方的增援、機體的接口、結果', () => {
  it('敵人超過四個時多的在後方等著，有空格才補上來：先攻當場擲，從最後面的空格進場', () => {
    const a = arena({ ...duel([one()], [1, 2, 3, 4, 5].map(() => foe()), { ally: [0, 0, 0, 0], foe: [1, 1, 1, 1] }) })
    const run = a.run([10])
    run.setOut(a.foe(4), 'down')
    run.settle()
    expect(a.foe(5).slot).toBe(4)
    expect(a.battle.reserve.foe).toEqual([])
    expect(a.battle.order).toContain('f5')
    expect(a.foe(5).initiative).toBe(10)
    expect(tags(run)).toContain('reinforce')
    // 後方還有人就不算全滅
    const b = arena({ ...duel([one()], [1, 2, 3, 4, 5].map(() => foe())) })
    const r2 = b.run()
    for (const i of [1, 2, 3, 4]) b.foe(i).out = 'down'
    r2.checkResult()
    expect(b.battle.result).toBeUndefined()
  })

  it('機體（機甲的接口；M6 才做機甲）：傷害先扣機體、一部分回灌成機師的感載、多的打到本人；歸零時通知功能；開著機體用不了遮蔽', () => {
    let broke = 0
    const a = arena(duel([one()], [foe('elite')], { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }), undefined, (k) => k.battle.on('hull.break', 'test', ({ unit }) => { broke += 1; delete unit.hull }))
    const pilot = a.foe(1)
    pilot.hull = { id: 'mf_test', name: '野馬', hp: { now: 33, max: 33 }, armor: 4, backlash: 0.2 }
    const run = a.run()
    expect(run.evadeOf(pilot).cover).toBe(0)
    // 護甲 1 ＋ 機體 4：20 − 5 = 15 打在機體上，回灌 3
    expect(run.damage(pilot, 20, 'physical')).toEqual({ dealt: 15, track: 'hull' })
    expect(pilot.hull!.hp.now).toBe(18)
    expect(pilot.load!.now).toBe(3)
    expect(pilot.hp!.now).toBe(pilot.hp!.max)
    // 打穿：機體吃掉 18，剩下的 7 打到機師
    expect(run.damage(pilot, 30, 'physical').track).toBe('hp')
    expect(broke).toBe(1)
    expect(pilot.hp!.now).toBe(pilot.hp!.max - 7)
    expect(tags(run)).toContain('hull')
  })

  it('功能可以自己分出結果（脫離、投降）：之後不再有人行動', () => {
    const a = arena()
    const run = a.run()
    run.finish('fled', '脫離成功。')
    run.finish('win', '不會蓋掉')
    expect(a.battle.result).toEqual({ outcome: 'fled', text: '脫離成功。' })
    expect(run.over).toBe(true)
    expect(isExposed(a.battle, a.ally(1))).toBe(true)
    expect(unitAt(a.battle, 'ally', 1)!.id).toBe('a1')
    expect(partyUnit(0).rank).toBe('elite')
    expect(enemyUnit('boss', 4).ap.max).toBe(7)
  })
})

describe('和人重疊的東西可以被單獨瞄準（COMBAT_SYSTEM 9.1 節）', () => {
  const drone = () => ({ id: 'o1', side: 'ally' as const, slot: 2, owner: 'a1', kind: 'shield', name: '護盾無人機', hp: { now: 14, max: 14 }, armor: 1, evade: 13, used: false, down: false })

  it('永遠暴露：命中對它自己的迴避，不看那一格的遮蔽；傷害扣它的護甲、乘攻擊者的傷害倍率；不傷遮蔽', () => {
    const downs: string[] = []
    const a = arena(duel([one(), one({}, 2)], [foe()], { ally: [2, 2, 2, 2], foe: [0, 0, 0, 0] }), [TEST_COMBAT], (k) => k.battle.on('overlay.down', 'test', ({ overlay, by }) => { downs.push(`${overlay.id}:${by?.id}`) }))
    a.battle.overlays.push(drone())
    const o = a.battle.overlays[0]!
    // 雜兵的手槍：命中 +3、3d6、傷害倍率 ×0.4。15 + 3 = 18 對 13：命中；(4+4+4 − 1) × 0.4 = 4.4 → 4
    const hit = a.run([15, 4, 4, 4]).attackOverlay(a.foe(1), o)
    expect(hit).toMatchObject({ hit: true, evade: 13, raw: 12, dealt: 4, track: 'hp', downed: false })
    expect(o.hp.now).toBe(10)
    expect(a.foe(1).weapons[0]!.mag!.now).toBe(1)
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 2, hp: 30 })
    // 沒打中：2 + 3 = 5
    const run = a.run([2])
    expect(run.attackOverlay(a.foe(1), o)).toMatchObject({ hit: false, dealt: 0 })
    expect(run.beats[0]).toMatchObject({ tag: 'miss', roll: { dc: 13, skill: 'firearms', attr: 'reflex' } })
    // 耐久歸零：被擊落，掛點收到是誰打的；已經被擊落的不能再打
    o.hp.now = 3
    a.foe(1).weapons[0]!.mag!.now = 2
    const last = a.run([15, 4, 4, 4])
    expect(last.attackOverlay(a.foe(1), o)).toMatchObject({ hit: true, downed: true })
    expect(o).toMatchObject({ down: true, hp: { now: 0 } })
    expect(downs).toEqual(['o1:f1'])
    expect(tags(last)).toEqual(expect.arrayContaining(['hit', 'overlay.down']))
    expect(a.run([]).attackOverlay(a.foe(1), o)).toMatchObject({ aborted: true })
  })

  it('一般的攻擊也記下用的是哪個屬性與基本功（武器的）', () => {
    const a = arena(duel([one({ weapon: 'knife' })], [foe()]))
    const run = a.run([10, 3, 3, 3])
    run.attack(a.ally(1), a.foe(1))
    expect(run.beats.find((b) => b.roll)!.roll).toMatchObject({ attr: 'body', skill: 'brawl' })
  })
})

describe('單位剛組好的掛點（unit.ready）：在擲先攻之前，功能把自己的資料掛到單位上', () => {
  it('上場與在後方等的人各呼叫一次；掛上去的東西先攻的修正讀得到', () => {
    const seen: string[] = []
    const a = arena(duel([one(), one({}, 2)], [1, 2, 3, 4, 5].map(() => foe())), [TEST_COMBAT], (k) => {
      k.battle.on('unit.ready', 'test', ({ unit }) => {
        seen.push(unit.id)
        if (unit.id === 'a2') unit.ext.fast = true
      })
      k.battle.modifier('test', (q) => (q.kind === 'initiative' && q.unit.ext.fast ? [{ label: '測試', value: 100, source: 'skill' }] : []))
    })
    expect(seen).toEqual(['a1', 'a2', 'f1', 'f2', 'f3', 'f4', 'f5'])
    // a2 的先攻多了 100：一定排第一個
    expect(a.battle.order[0]).toBe('a2')
    expect(a.ally(2).initiative).toBeGreaterThan(100)
  })
})

describe('道具效果的登錄表：功能各自註冊自己的 op，檢查內容時看得到有哪些', () => {
  it('註冊、查詢、重複註冊丟錯', () => {
    const k = createKernel()
    expect(k.battle.itemOpIds()).toEqual([])
    const calls: unknown[] = []
    k.battle.itemOp('heal', 'combat', (ctx, effect) => { calls.push([ctx.item, effect.amount]) })
    k.battle.itemOp('vent', 'combat', () => {})
    expect(k.battle.itemOpIds()).toEqual(['heal', 'vent'])
    k.battle.getItemOp('heal')!({ run: null as never, user: null as never, target: { unit: 'a1' }, item: 'it_medgel_1' }, { op: 'heal', amount: 8 })
    expect(calls).toEqual([['it_medgel_1', 8]])
    expect(k.battle.getItemOp('nope')).toBeUndefined()
    expect(() => k.battle.itemOp('heal', 'drugs', () => {})).toThrow(/道具效果重複註冊：heal（已經由 combat 註冊）/)
  })
})

describe('武器的類型（COMBAT_SYSTEM 第 5 節的表）：設計圖與敵人的武器都從這裡起算', () => {
  const SHOTGUN = { id: 'shotgun', name: '霰彈槍', dice: 5, far: { beyond: 2, dice: 3 }, type: 'physical', range: [1, 3], mag: 2, cover_mult: 1.5, pierce: 0, traits: ['push'], attr: 'reflex', skill: 'firearms' }
  const SNIPER = { id: 'sniper', name: '狙擊槍', dice: 6, type: 'physical', range: [5, 7], mag: 1, cover_mult: 0.25, pierce: 4, traits: ['long', 'aimed'], attr: 'reflex', skill: 'firearms', ap: 3 }
  const kernel = () => { const k = createKernel(); k.content.load('skill', [{ id: 'firearms', name: '槍械', attr: 'reflex', desc: '手槍到步槍的命中。' }]); return k }

  it('從類型組出一把武器：骰、距離、彈匣、遮蔽倍率、特性照表；槍管的等級骰加在近與遠兩種骰上', () => {
    const k = kernel()
    k.content.load('weapon_class', [SHOTGUN, SNIPER])
    expect(k.content.checkRefs()).toEqual([])
    expect(weaponFromClass(k.content, 'shotgun', { hit: 4 })).toEqual({
      id: 'shotgun', name: '霰彈槍', class: 'shotgun', dice: 5, far: { beyond: 2, dice: 3 }, flat: 0, type: 'physical', range: [1, 3], pierce: 0, hit: 4,
      attr: 'reflex', skill: 'firearms', mag: { now: 2, max: 2 }, coverMult: 1.5, traits: ['push'],
    })
    const iv = weaponFromClass(k.content, 'shotgun', { hit: 10, extraDice: GRADE_DICE[3], flat: 4, name: 'M4 霰彈槍', id: 'w1' })
    expect(iv).toMatchObject({ id: 'w1', name: 'M4 霰彈槍', dice: 7, far: { beyond: 2, dice: 5 }, flat: 4 })
    expect(weaponFromClass(k.content, 'sniper', { hit: 5, pierce: 1, traits: ['silent'] })).toMatchObject({ ap: 3, pierce: 5, traits: ['long', 'aimed', 'silent'] })
    expect([...GRADE_DICE]).toEqual([0, 0, 1, 2, 3])
    expect(() => weaponFromClass(k.content, 'bazooka', { hit: 0 })).toThrow(/沒有 bazooka 這種武器的類型/)
  })

  it('格式錯誤擋下：骰、距離、彈匣、傷害類型、基本功', () => {
    const k = kernel()
    const bad = (over: Record<string, unknown>) => { try { k.content.validate('weapon_class', [{ ...SHOTGUN, ...over }]); return k.content.validate('weapon_class', [{ ...SHOTGUN, ...over }]).join('\n') } catch (e) { return String(e) } }
    expect(bad({ dice: 0 })).toMatch(/dice/)
    expect(bad({ range: [3, 1] })).toMatch(/range/)
    expect(bad({ mag: 5 })).toMatch(/mag/)
    expect(bad({ type: 'chemical' })).toMatch(/type/)
    k.content.load('weapon_class', [{ ...SHOTGUN, skill: 'juggling' }])
    expect(k.content.checkRefs()).toEqual(['weapon_class/shotgun：引用了不存在的 skill/juggling'])
  })
})
