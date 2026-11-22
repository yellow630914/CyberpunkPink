// 審查 M1a 的兩條小問題（dev/reviews/2026-11-22-M1a.md）：
//   S1 叫人的支援射擊走一般的攻擊（自然 1／20、要害、傷到遮蔽、hit／miss／crit 的紀錄）：CORE_RULES 第 3 節、COMBAT_SYSTEM 第 2、4 節、SKILL_TREES 人面的叫人。
//   S6 軀幹的重創只讓「身上那件護甲」失效，頭盔不受影響：COMBAT_SYSTEM 第 4、6 節。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, ContentPack, ItemStack } from '../../src'
import { BattleRun, gradeDice, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { armorOf, bodyArmorOf, equip, gearFeature } from '../../src/features/gear'
import { characterFeature } from '../../src/features/character'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

// ---- S1：叫人的支援射擊 ----

const FIXER = { id: 'fixer', name: '掮客', tree: '人面', category: 'social', signature: 'sk_fixer_face', domains: { meat: 'strong_support', net: 'mid', opinion: 'mid' }, resonance: [] }
const FACE = {
  id: 'sk_fixer_face', name: '人面', path: 'fixer', category: 'social', tier: 1, layer: 'signature', kind: 'passive', cap: 3, xp: 20, cells: 1, text: '人面。', net: null, opinion: null,
  meat: { give_ap: { max: 'one_plus_half_tier' }, call: { options: ['shot', 'cover_up', 'cover_down'], per_fight: 'half_tier_up', ap: 1 } },
}
const PACK: ContentPack = { id: 'review_fix_s1', content: { path: [FIXER], ability: [FACE] } }
const caller = () => one({ weapon: 'pistol', ext: { abilities: { equipped: ['sk_fixer_face'], tiers: { fixer: 2 } } } })

/** 一場 grade 級的戰鬥：我方叫人的掮客，敵方第 1 格一個迴避 evade 的小隊長（遮蔽照 cover）。 */
const field = (grade: 1 | 3, evade: number, cover: number[] = [0, 0, 0, 0]) => {
  const a = arena(duel([caller()], [foe('elite', { evade })], { ally: [0, 0, 0, 0], foe: cover }, { grade } as Partial<BattleSetup>), [abilitiesFeature, TEST_COMBAT], (k) => {
    k.content.loadPack(PACK)
    readyFeatures(k)
  })
  const call = (dice: number[]) => {
    const run = a.run(dice)
    a.k.battle.getAction('sk_fixer_face.call')!.run(run, a.ally(1), null, { action: 'sk_fixer_face.call', target: { unit: 'f1' }, pick: { option: 'shot' } })
    return run
  }
  return { ...a, call }
}

describe('S1：叫人的支援射擊照一般的攻擊規則', () => {
  it('自然 1 一定失手：就算 d20 ＋ 加值（III 級 +10）夠打到迴避', () => {
    const f = field(3, 5)
    const hp = f.foe(1).hp!.now
    const run = f.call([1, 6, 6, 6, 6, 6])
    expect(f.foe(1).hp!.now).toBe(hp)
    const beat = run.beats.find((b) => b.tag === 'miss')!
    expect(beat.roll).toMatchObject({ natural: 1, total: 11, dc: 5, degree: 'fumble' })
    expect(run.beats.some((b) => b.tag === 'hit' || b.tag === 'crit')).toBe(false)
  })

  it('自然 20 一定命中：就算迴避高得打不到；打中的傷害是 3 ＋ 等級骰顆 d6 扣護甲', () => {
    const f = field(1, 60)
    const hp = f.foe(1).hp!.now
    const run = f.call([20, 6, 6, 6])
    const beat = run.beats.find((b) => b.tag === 'hit')!
    expect(beat.roll).toMatchObject({ natural: 20, total: 26, dc: 60 })
    expect(f.foe(1).hp!.now).toBe(hp - Math.max(0, 18 - f.foe(1).armor))
  })

  it('加值是 4 ＋ 場景的等級 × 2、傷害骰是 3 ＋ 等級骰顆 d6（III 級）', () => {
    const f = field(3, 12)
    const hp = f.foe(1).hp!.now
    const run = f.call([5, 3, 3, 3, 3, 3]) // 5 + 10 = 15，比迴避 12 高 3，不是要害
    const beat = run.beats.find((b) => b.roll)!
    expect(beat.roll!.total).toBe(5 + 4 + 3 * 2)
    expect(beat.roll!.parts.map((p) => p.value)).toContain(10)
    const dice = 3 + gradeDice(3)
    expect(f.foe(1).hp!.now).toBe(hp - Math.max(0, dice * 3 - f.foe(1).armor))
  })

  it('超過迴避 5 以上是要害：多一顆骰', () => {
    const f = field(1, 10)
    const hp = f.foe(1).hp!.now
    const run = f.call([15, 2, 2, 2, 2]) // 15 + 6 = 21，比迴避 10 高 11
    expect(run.beats.some((b) => b.tag === 'crit')).toBe(true)
    expect(f.foe(1).hp!.now).toBe(hp - Math.max(0, 4 * 2 - f.foe(1).armor))
  })

  it('打中或失手，都傷到目標那一格的遮蔽（II 級遮蔽）', () => {
    const f = field(1, 5, [2, 0, 0, 0])
    const before = f.battle.cover.foe[0]!.hp
    f.call([1, 6, 6, 6, 6])
    expect(f.battle.cover.foe[0]!.hp).toBeLessThan(before)
    const g = field(1, 5, [2, 0, 0, 0])
    g.call([15, 6, 6, 6, 6])
    expect(g.battle.cover.foe[0]!.hp).toBeLessThan(before)
  })

  it('紀錄：先有一筆叫人的 support，再有攻擊自己的 hit／miss，帶這一次的擲骰', () => {
    const f = field(1, 5)
    const run = f.call([15, 1, 1, 1, 1])
    const tags = run.beats.map((b) => b.tag)
    expect(tags.indexOf('support')).toBeLessThan(tags.findIndex((t) => t === 'hit' || t === 'crit'))
    expect(run.beats.find((b) => b.tag === 'support')!.data).toMatchObject({ unit: 'a1', option: 'shot', target: 'f1' })
  })
})

// ---- S6：軀幹重創只廢掉身上那件護甲 ----

const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const bp = (id: string, covers: string[], armor: number, require: unknown[]) => ({ id, kind: 'armor', name: id, desc: `${id}。`, brand: 'starbelle', grade: 1, legal: 'register', price: 100, size: 1, weight: 1, require, optional: [], armor, covers, weight_class: 'medium' })
const part = (id: string, type: string, grade: number, stats: Record<string, number> = {}) => ({ id, name: id, type, material: 'mech', brand: 'starbelle', grade, price: 100, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new' })
const GEAR: ContentPack = {
  id: 'review_fix_s6',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '那隻手或腳的檢定 −2，到戰鬥結束。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }],
    skill: [{ id: 'firearms', name: 'firearms', attr: 'reflex', desc: 'firearms。' }], weapon_class: WEAPONS,
    blueprint: [bp('bp_vest', ['armor'], 1, [{ type: 'fiber' }, { type: 'plate' }]), bp('bp_helmet', ['head'], 1, [{ type: 'plate' }])],
    part: [part('pt_plate_3', 'plate', 3, { armor: 3 }), part('pt_fiber_2', 'fiber', 2, { armor: 2 })],
  },
}
const made = (uid: string, blueprint: string, parts: Record<string, string | string[]>): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts } })
const INVENTORY: ItemStack[] = [made('v', 'bp_vest', { fiber: 'pt_fiber_2', plate: 'pt_plate_3' }), made('h', 'bp_helmet', { plate: 'pt_plate_3' })]

describe('S6：軀幹的重創只讓身上那件護甲失效（COMBAT_SYSTEM 第 6 節）', () => {
  const game = (wear: string[]) => {
    const g = makeGame({ features: [characterFeature, gearFeature, combatFeature], content: [GEAR], pc: { attrs: { reflex: 14, body: 12 }, skills: { firearms: 2 } }, patch: { inventory: structuredClone(INVENTORY) } }).game
    for (const uid of wear) g.commit(equip(g.k, g.state, 'pc', uid))
    g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    return g
  }
  const wound = (g: ReturnType<typeof game>, part: string) => g.k.battle.emit('wound', { run: new BattleRun(g.k, g.state, g.state.battle!), attacker: g.state.battle!.units.f1!, target: g.state.battle!.units.a1!, aimed: true, part })

  it('身上那件（防彈衣 1＋2＋3 ＝ 6）加頭盔（+1）：全身 7，身上那件的份 6', () => {
    const g = game(['v', 'h'])
    expect([armorOf(g.k, g.state, 'pc'), bodyArmorOf(g.k, g.state, 'pc'), g.k.stats.stat(g.state, 'pc', 'armor_body')]).toEqual([7, 6, 6])
    expect(g.battle!.units.a1!.armor).toBe(7)
  })

  it('第一次軀幹受創（輕）不動護甲；第二次（重）扣掉身上那件，頭盔的 1 點還在；再中不再扣', () => {
    const g = game(['v', 'h'])
    const me = g.state.battle!.units.a1!
    wound(g, 'torso')
    expect(me.armor).toBe(7)
    wound(g, 'torso')
    expect(me.wounds).toEqual({ torso: 2 })
    expect(me.armor).toBe(1)
    wound(g, 'torso')
    expect(me.armor).toBe(1)
  })

  it('只穿防彈衣：護甲歸零；只戴頭盔：身上沒有那一件，護甲不變', () => {
    const vest = game(['v'])
    wound(vest, 'torso')
    wound(vest, 'torso')
    expect(vest.state.battle!.units.a1!.armor).toBe(0)
    const helmet = game(['h'])
    wound(helmet, 'torso')
    wound(helmet, 'torso')
    expect(helmet.state.battle!.units.a1!.armor).toBe(1)
  })

  it('其他部位的重創不動護甲', () => {
    const g = game(['v', 'h'])
    for (const part of ['limb', 'head', 'bridge']) {
      wound(g, part)
      wound(g, part)
    }
    expect(g.state.battle!.units.a1!.armor).toBe(7)
  })
})
