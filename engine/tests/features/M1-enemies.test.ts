// 驗收測試：dev/work/M1-enemies.md（cpp-feature）。工單做完之前照預期失敗（features/enemies 還不存在）。
// 規格：ENEMIES 1.1、1.5、第 2 節（資料格式）、4.4 節（士氣）、第 13 節（遭遇的點數、強度係數、對決的修正）；BALANCE 2.4、7.2 節。
// 這份只用測試自己帶的幾筆資料；整份名冊的轉寫是另一張工單（dev/work/M1-data-enemies.md）。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack } from '../../src'
import { Game, createKernel } from '../../src'
import { ENEMY_CURVE, encounterPoints, enemiesFeature, enemyStats, setupFromEncounter } from '../../src/features/enemies'
import { ENEMY_TARGETS, TEST_COMBAT, makeBattleGame, makeGame, playOut } from '../../src/testkit'

const SKILLS = ['firearms', 'brawl', 'heavy', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
  { id: 'neural_gun', name: '感官彈槍', dice: 3, type: 'neural', range: [2, 5], mag: 2, cover_mult: 0, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]
const enemy = (id: string, rank: string, more: Record<string, unknown> = {}) => ({
  id, name: `測試${rank}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.3 }, ...more,
})
const PACK: ContentPack = {
  id: 'enemies_test',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }],
    enemy: [
      enemy('en_t_mook', 'minion'), enemy('en_t_elite', 'elite'), enemy('en_t_boss', 'boss', { ai: { prefer: 'leader', focus: 1, flee_below: 0, never_flee: true } }),
      // 兵種只寫相對於目標表的修正（ENEMY_ROSTER 開頭）：生命 ×1.1、護甲 +2、迴避 −1、敏感度 40
      enemy('en_t_riot', 'minion', { mods: { hp: 1.1, armor: 2, evade: -1, sensitivity: 40 }, weapons: [{ class: 'melee', name: '電擊鞭', type: 'neural', traits: ['pull'] }], mode: 'capture', position: { prefer: [1], cover_use: 0.2 } }),
      enemy('en_t_cop', 'minion', { mode: 'capture', weapons: [{ class: 'neural_gun' }] }),
      enemy('en_t_bot', 'minion', { kind: 'machine' }),
      enemy('en_t_named', 'boss', { named: true, base: 'en_t_boss', name: '課長・柊' }),
    ],
    encounter: [
      { id: 'enc_t_patrol', name: '巡邏', grade: 1, cover: 'medium', foes: [{ enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }] },
      { id: 'enc_t_boss', name: '課長室', grade: 3, cover: 'one_sided', escapable: false, foes: [{ enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_boss' }] },
    ],
  },
}
const kernel = () => { const k = createKernel([enemiesFeature]); k.content.loadPack(PACK); return k }
const state = (rules: Record<string, unknown> = {}) => makeGame({ features: [enemiesFeature], content: [PACK], patch: { rules: rules as never } }).game.state
const unit = (id: string, grade: number, o: Record<string, unknown> = {}, rules = {}): BattleUnit => {
  const g = makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK], patch: { rules: rules as never } }).game
  g.startBattle({ grade: grade as 1, allies: [1, 2, 3, 4].slice(0, (o.allies as number) ?? 4).map(() => ({ from: 'unit', unit: { ...ally() } })), foes: [{ from: 'enemy', id, ...o }] })
  return g.battle!.units.f1!
}
const ally = () => makeBattleGame().game.battle!.units.a1 as unknown as Record<string, unknown>

describe('每一級的目標值（ENEMIES 1.5 節「現實」那張表；BALANCE 2.4 節）', () => {
  it('曲線的表和設計書一樣（和測試基礎建設用的那一份也一樣）', () => {
    expect(ENEMY_CURVE.attack).toEqual([3, 4, 5, 6, 7])
    expect(ENEMY_CURVE.evade).toEqual([10, 12, 14, 16, 18])
    expect(ENEMY_CURVE.armor).toEqual([1, 2, 3, 4, 5])
    expect(ENEMY_CURVE.hp).toEqual({ minion: [45, 55, 67, 82, 100], elite: [110, 130, 165, 205, 250], boss: [260, 300, 380, 470, 580] })
    expect(ENEMY_CURVE.load).toEqual({ minion: [22, 27, 33, 40, 49], elite: [37, 45, 55, 67, 82], boss: [52, 63, 77, 94, 115] })
    expect(ENEMY_CURVE.layers).toEqual({ minion: 1, elite: 2, boss: 4 })
    expect(ENEMY_CURVE.ap).toEqual({ minion: 4, elite: 5, boss: 6 })
    // capture 與 neural 的神經武器：雜兵 4d6、精英 6d6、首領 11d6（再加等級骰）
    expect(ENEMY_CURVE.captureDice).toEqual({ minion: 4, elite: 6, boss: 11 })
    expect(ENEMY_CURVE.points).toEqual({ minion: 1, elite: 2.5, boss: 5 })
    expect(ENEMY_TARGETS.hp).toEqual(ENEMY_CURVE.hp)
  })

  it('照表的兵種：每一級、每個位階的單位剛好是目標表；行動點 IV 級以上的精英與首領 +1；每回合回 3', () => {
    for (const grade of [1, 2, 3, 4, 5] as const) {
      for (const [id, rank] of [['en_t_mook', 'minion'], ['en_t_elite', 'elite'], ['en_t_boss', 'boss']] as const) {
        const u = unit(id, grade)
        const g = grade - 1
        expect(u, `${id} ${grade}`).toMatchObject({
          enemy: id, control: 'ai', grade, rank, hp: { now: ENEMY_CURVE.hp[rank][g], max: ENEMY_CURVE.hp[rank][g] }, armor: ENEMY_CURVE.armor[g],
          load: { now: 0, max: ENEMY_CURVE.load[rank][g] }, layers: 0, layersMax: ENEMY_CURVE.layers[rank], sensitivity: 50, evade: ENEMY_CURVE.evade[g],
          ap: { max: ENEMY_CURVE.ap[rank] + (rank !== 'minion' && grade >= 4 ? 1 : 0), regen: 3 },
          dmgMult: { hp: { minion: 0.4, elite: 0.6, boss: 1 }[rank], load: 1 },
        })
        // 武器：類型的基礎骰加槍管的等級骰（III +1、IV +2、V +3）；命中是那一級的攻擊加值
        expect(u.weapons[0]).toMatchObject({ class: 'pistol', dice: 3 + [0, 0, 1, 2, 3][g]!, hit: ENEMY_CURVE.attack[g], mag: { now: 2, max: 2 } })
      }
    }
  })

  it('兵種的修正乘（或加）在目標表上；沒有橋的（機器）沒有感載這一條', () => {
    const riot = unit('en_t_riot', 3)
    expect(riot).toMatchObject({ hp: { max: Math.round(67 * 1.1) }, armor: 3 + 2, evade: 14 - 1, sensitivity: 40 })
    expect(riot.weapons[0]).toMatchObject({ name: '電擊鞭', type: 'neural', traits: expect.arrayContaining(['melee', 'pull']) })
    expect(riot.ai).toMatchObject({ mode: 'capture', prefer: 'weakest', fleeBelow: 0.3, prefer_slots: [1], coverUse: 0.2 })
    const bot = unit('en_t_bot', 1)
    expect(bot.load).toBeUndefined()
    expect(bot.tags).toEqual(expect.arrayContaining(['machine', 'unbridged']))
    // capture 的敵人手上的神經武器：雜兵 4d6，III 級再加一顆等級骰；不吃位階的傷害倍率
    expect(unit('en_t_cop', 1).weapons[0]).toMatchObject({ type: 'neural', dice: 4 })
    expect(unit('en_t_cop', 3).weapons[0]).toMatchObject({ dice: 5 })
    // 兵種不出現的等級：照最近的那一級，不擋（任務可以照兵種的等級寫）
    expect(() => unit('en_t_nope', 1)).toThrow(/沒有 en_t_nope 這個敵人/)
  })

  it('難度的係數（BALANCE 7.2 節）乘在生命、傷害、感載上限上；傷害乘在位階的倍率之後，感載的傷害也算', () => {
    const hard = unit('en_t_mook', 1, {}, { difficulty: 'hard' })
    expect(hard).toMatchObject({ hp: { max: Math.round(45 * 1.15) }, load: { max: Math.round(22 * 1.15) }, dmgMult: { hp: 0.4 * 1.35, load: 1.35 } })
    const story = unit('en_t_boss', 1, {}, { difficulty: 'story' })
    expect(story).toMatchObject({ hp: { max: 156 }, load: { max: Math.round(52 * 0.6) }, dmgMult: { hp: 0.5, load: 0.5 } })
    expect(enemyStats(kernel(), state({ difficulty: 'legend' }), 'en_t_elite', { grade: 2 })).toMatchObject({ hp: Math.round(130 * 1.3), dmgMult: { hp: 0.6 * 1.7, load: 1.7 } })
  })

  it('強度係數（ENEMIES 第 13 節）：具名的精英與首領 ×1.3（生命與傷害一起乘）；少於四個人的對決改用對決的修正', () => {
    const named = unit('en_t_named', 2)
    expect(named).toMatchObject({ name: '課長・柊', rank: 'boss', hp: { max: Math.round(300 * 1.3) }, dmgMult: { hp: 1.3 } })
    // 一個人打首領：不乘具名的 ×1.3，改乘生命 ×0.35、傷害 ×0.5；兩個人打首領 ×0.8；三個人不修正
    expect(unit('en_t_named', 2, { allies: 1 })).toMatchObject({ hp: { max: Math.round(300 * 0.35) }, dmgMult: { hp: 0.5 } })
    expect(unit('en_t_named', 2, { allies: 2 })).toMatchObject({ hp: { max: Math.round(300 * 0.8) }, dmgMult: { hp: 0.8 } })
    expect(unit('en_t_named', 2, { allies: 3 })).toMatchObject({ hp: { max: 300 }, dmgMult: { hp: 1 } })
    expect(unit('en_t_elite', 2, { allies: 1 })).toMatchObject({ hp: { max: Math.round(130 * 0.8) }, dmgMult: { hp: 0.6 * 0.8 } })
    // 遭遇可以自己指定係數（關鍵節點 ×1.1～1.2）
    expect(unit('en_t_boss', 2, { strength: 1.2 })).toMatchObject({ hp: { max: Math.round(300 * 1.2) }, dmgMult: { hp: 1.2 } })
  })
})

describe('遭遇（ENEMIES 第 13 節）', () => {
  it('點數：雜兵 1、精英 2.5、首領 5；高一級的敵人 ×1.75；具名的照強度係數乘', () => {
    const k = kernel()
    expect(encounterPoints(k, [{ enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_elite' }], 1)).toBe(4.5)
    expect(encounterPoints(k, [{ enemy: 'en_t_boss' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }, { enemy: 'en_t_mook' }], 1)).toBe(8)
    expect(encounterPoints(k, [{ enemy: 'en_t_mook', grade: 2 }, { enemy: 'en_t_mook', grade: 2 }, { enemy: 'en_t_mook' }], 1)).toBe(4.5)
    expect(encounterPoints(k, [{ enemy: 'en_t_named' }], 2)).toBe(6.5)
  })

  it('照遭遇的資料組出開打的設定：敵人、等級、遮蔽的配置、能不能脫離、贏的那一方的勢力', () => {
    const k = kernel()
    const s = state()
    const setup = setupFromEncounter(k, s, 'enc_t_boss', { allies: [{ from: 'unit', unit: ally() }] })
    expect(setup).toMatchObject({ mode: 'meat', grade: 3, cover: 'one_sided', origin: { encounter: 'enc_t_boss', escapable: false, faction: 'hizakura', place: '課長室' } })
    expect(setup.foes).toEqual([{ from: 'enemy', id: 'en_t_mook' }, { from: 'enemy', id: 'en_t_mook' }, { from: 'enemy', id: 'en_t_mook' }, { from: 'enemy', id: 'en_t_boss' }])
    expect(() => setupFromEncounter(k, s, 'enc_nope', { allies: [] })).toThrow(/沒有 enc_nope 這個遭遇/)
    // 內容的引用檢查：遭遇引用不存在的敵人、敵人引用不存在的武器類型或勢力，都擋下
    const bad = createKernel([enemiesFeature])
    bad.content.loadPack({ ...PACK, content: { ...PACK.content, encounter: [{ id: 'enc_bad', name: '壞的', grade: 1, cover: 'medium', foes: [{ enemy: 'en_ghost' }] }] } })
    expect(bad.content.checkRefs()).toEqual(['encounter/enc_bad：引用了不存在的 enemy/en_ghost'])
    expect(() => new Game({ features: [enemiesFeature], content: [{ id: 'x', content: { enemy: [enemy('en_x', 'chief')] } }] })).toThrow(/rank/)
  })
})

describe('士氣（ENEMIES 4.4 節）與整場', () => {
  it('首領倒下、或同伴倒了一半：雜兵擲意志 ＋ 定力對 DC 13，失敗就撤退（退出戰鬥）；首領不撤退', () => {
    const { game } = makeBattleGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK], seed: 4, battle: { grade: 1, cover: 'medium', allies: [{ from: 'unit', unit: ally() }], foes: [{ from: 'enemy', id: 'en_t_mook' }, { from: 'enemy', id: 'en_t_mook' }, { from: 'enemy', id: 'en_t_mook' }, { from: 'enemy', id: 'en_t_boss' }] } })
    const b = game.state.battle!
    // 定力很差的雜兵：首領倒下之後輪到他，一定撤退（除非擲出自然 20）
    for (const id of ['f1', 'f2', 'f3']) b.units[id]!.skills.composure = -40
    b.units.f4!.out = 'down'
    b.turn = b.order.indexOf('f1')
    const r = game.battleNext()
    const roll = r.reports[0]!.timeline.find((x) => x.roll)!.roll!
    expect(roll).toMatchObject({ dc: 13, skill: 'composure' })
    if (roll.natural !== 20) {
      expect(game.battle!.units.f1!.out).toBe('fled')
      expect(r.reports[0]!.timeline.map((x) => x.tag)).toContain('flee')
    }
    // 檢定只擲一次：過了的人這一場不再擲
    expect(game.battle!.units.f1!.uses.morale).toBe(1)
  })

  it('用敵人的資料組的一般遭遇打得完（測試用的行動表、雙方由程式選動作）', () => {
    const g = makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK], seed: 9 }).game
    g.startBattle(setupFromEncounter(g.k, g.state, 'enc_t_patrol', { allies: [1, 2, 3, 4].map(() => ({ from: 'unit', unit: ally() })) }))
    expect(Object.values(g.battle!.units).filter((u) => u.side === 'foe').map((u) => u.enemy)).toEqual(['en_t_mook', 'en_t_mook', 'en_t_mook', 'en_t_mook'])
    expect(['win', 'lose']).toContain(playOut(g).outcome)
  })
})
