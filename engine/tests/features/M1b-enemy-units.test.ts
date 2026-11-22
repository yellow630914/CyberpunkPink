// 驗收測試：dev/work/M1b-enemy-units.md（cpp-feature）。敵方的無人機與砲塔（position.size: 'overlay'，和人重疊、掛在格上）、跟著主人的附屬單位（attached）、
// 會指揮的敵人（enemy.command）；沒有操作者的一台每一輪自己動（features/summons 的 round.start）、砲塔、被電磁打到停一回合、自律（兩邊統一，命中 −2）；機甲只收格式（hull）。
// 補充：沒有操作者的一台每輪清 used；被 hack 接管的不動；替身用 run.standIn；hack 的 treeTier 對敵人退回單位的等級；基準遭遇的 traits: false 寫在資料裡（不再看 id 的前綴）。
// 規格：ENEMIES 第 10 節（無人機與砲塔）、第 3 節站位表、第 2 節 position、11.4 節第一段、第 13 節（小型無人機 0.5 點）；COMBAT_SYSTEM 9.1 節；dev/adr/0015 第三節、E6。
// 內容一律是測試自帶的假資料，不讀 engine/data（只有最後一條看 engine/data/world/encounters.json 的 traits 欄位）。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BattleOverlay, BattleSetup, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, BattleRun, aiStep, battleProblems, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { ENEMY_CURVE, encounterPoints, enemiesFeature, setupFromEncounter } from '../../src/features/enemies'
import { DEFAULT_TREE, treeTier } from '../../src/features/hack'
import { summonsFeature } from '../../src/features/summons'
import { makeBattleGame, makeGame, stateHash, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, one, raw } from '../helpers/battle'

type Rec = Record<string, unknown>
type Entry = Rec & { id: string }
const FEATURES = [combatFeature, enemiesFeature, summonsFeature]
/** 骰面：給的先出，之後都是 1（0～1 的亂數拿到的是「值 ÷ 100」）。 */
const dice = (...v: number[]) => [...v, ...Array(200).fill(1)]

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'emgun', name: '電磁槍', dice: 3, type: 'em', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]
const foeData = (id: string, rank: string, more: Rec = {}): Entry => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...more,
})
/** 掛在格上的一台：機器、雜兵、position.size 'overlay'。 */
const overlayData = (id: string, kind: string, more: Rec = {}): Entry =>
  foeData(id, 'minion', { name: `${id}號機`, kind: 'machine', position: { prefer: [2, 3], size: 'overlay' }, overlay: { kind }, ...more })

const ENEMIES: Entry[] = [
  foeData('en_grunt', 'minion'),
  foeData('en_bot', 'minion', { kind: 'machine' }),
  // 巡邏無人機：生命 ×0.5、護甲 +1、迴避 −1（目標表的迴避 + 3 + 修正）
  overlayData('en_patrol', 'attack', { mods: { hp: 0.5, armor: 1, evade: -1 } }),
  overlayData('en_patrol2', 'attack', { mods: { hp: 0.5 }, position: { prefer: [2, 3], size: 'overlay' } }),
  overlayData('en_turret', 'turret', { overlay: { kind: 'turret', fixed: true }, position: { prefer: [4], size: 'overlay' } }),
  overlayData('en_shield', 'shield', { weapons: [], position: { prefer: [1], size: 'overlay' } }),
  overlayData('en_medic', 'medic', { weapons: [], position: { prefer: [1], size: 'overlay' } }),
  overlayData('en_scout', 'scout', { weapons: [], position: { prefer: [3], size: 'overlay' } }),
  overlayData('en_jammer', 'jammer', { weapons: [{ class: 'emgun' }] }),
  // 會指揮的敵人：帶兩台巡邏無人機（同一格；第二台挪到最近的空格）
  foeData('en_pilot', 'elite', { attached: [{ enemy: 'en_patrol', count: 2 }], position: { prefer: [3] } }),
  foeData('en_pilot_slot', 'minion', { attached: [{ enemy: 'en_shield', slot: 4 }, { enemy: 'en_scout', slot: 'same' }], position: { prefer: [2] } }),
  // 機甲：只收格式
  foeData('en_mech', 'elite', { kind: 'mech', hull: { id: 'hull_valkyrie', name: '女武神', hp: { now: 49, max: 49 }, armor: 7, backlash: 0.2, turns: 6 } }),
]
const enc = (id: string, foes: Rec[], more: Rec = {}): Entry => ({ id, name: `遭遇${id}`, grade: 1, cover: 'medium', foes, ...more })
const PACK: ContentPack = {
  id: 'enemy_units_test',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }], battle_status: TEST_STATUSES, enemy: ENEMIES,
    encounter: [
      // 兩個人加一台巡邏無人機（掛在第 2 格）
      enc('enc_patrol', [{ enemy: 'en_grunt' }, { enemy: 'en_grunt' }, { enemy: 'en_patrol', slot: 2 }]),
      // 沒寫格：照 position.prefer 的第一個空的；第二台同一種已經有人了，換下一個
      enc('enc_prefer', [{ enemy: 'en_grunt' }, { enemy: 'en_patrol' }, { enemy: 'en_patrol2' }, { enemy: 'en_turret' }]),
      enc('enc_turret', [{ enemy: 'en_grunt' }, { enemy: 'en_turret' }]),
      enc('enc_support', [{ enemy: 'en_grunt' }, { enemy: 'en_grunt' }, { enemy: 'en_shield', slot: 1 }, { enemy: 'en_medic', slot: 2 }, { enemy: 'en_scout' }]),
      enc('enc_pilot', [{ enemy: 'en_pilot' }, { enemy: 'en_grunt' }]),
      enc('enc_pilot_slot', [{ enemy: 'en_pilot_slot' }, { enemy: 'en_grunt' }]),
      enc('enc_mech', [{ enemy: 'en_mech' }, { enemy: 'en_grunt' }]),
      enc('enc_only', [{ enemy: 'en_patrol' }]),
      enc('enc_mix', [{ enemy: 'en_grunt' }, { enemy: 'en_pilot' }, { enemy: 'en_patrol', slot: 1 }, { enemy: 'en_turret' }]),
      enc('enc_base_g1_normal', [{ enemy: 'en_grunt' }]),
    ],
  },
}
const withEnemies = (more: Entry[]): ContentPack => ({ ...PACK, content: { ...PACK.content, enemy: [...ENEMIES, ...more] } }) as ContentPack
/** 載入這批內容：格式不對會丟錯（載入時與 ready 時）。 */
const loads = (more: Entry[]) => () => makeGame({ features: FEATURES, content: [withEnemies(more)] })

// ---- 場地 ----

const ally = (i = 1, o: Rec = {}) => raw(one({ weapon: 'pistol', hp: { now: 200, max: 200 }, ...o } as never, i))
const open = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }
const emW = (n = 6) => ({ ...testWeapon('pistol', 30), type: 'em' as const, dice: n, pierce: 5 })
/** 用 k（已載入內容）組出遭遇的開打設定。 */
const setupOf = (enc: string, allies: unknown[] = [ally(1), ally(2)], more: Partial<BattleSetup> = {}): BattleSetup => {
  const g = makeGame({ features: FEATURES, content: [PACK] }).game
  return { ...setupFromEncounter(g.k, g.state, enc, { allies: allies as never }), cover: open, ...more }
}
/** 不經過提交的戰鬥：開打時用的就是真的敵人來源（from: 'enemy'）與 setupFromEncounter。 */
function world(enc: string, o: { allies?: unknown[]; more?: Partial<BattleSetup> } = {}): Arena {
  return arena(setupOf(enc, o.allies, o.more), FEATURES, (k: Kernel) => {
    k.content.loadPack(PACK)
    readyFeatures(k)
  })
}
const overlays = (a: Arena): BattleOverlay[] => a.battle.overlays
const startRound = (a: Arena, run: BattleRun, round = 2) => a.k.battle.emit('round.start', { run, round })
/** 這一個 run 裡，這一台（id）打出去的每一拍（命中、失手、要害）。 */
const shots = (run: BattleRun, id: string) => run.beats.filter((b) => ['hit', 'miss', 'crit'].includes(b.tag ?? '') && (b.data as Rec | undefined)?.attacker === id)
const textOf = (run: BattleRun): string => run.beats.map((b) => b.text).join('\n')
const part = (b: { roll?: { parts: Array<{ label: string; value: number }> } }, label: string): number | undefined => b.roll?.parts.find((p) => p.label === label)?.value
/** 讓這個人不要先換位。 */
const settle = (u: BattleUnit) => { u.uses['turn:ai_moved'] = 1 }

// ===================================================================================================================

describe('資料的格式（ENEMIES 第 2 節 position、第 10 節）', () => {
  it('掛在格上的兵種載得進來：position.size 是 overlay、一定要寫 overlay.kind（attack、shield、scout、medic、jammer、turret）；size 1 也收', () => {
    expect(loads([])).not.toThrow()
    expect(loads([foeData('en_big', 'minion', { position: { prefer: [1], size: 1 } })])).not.toThrow()
    for (const kind of ['attack', 'shield', 'scout', 'medic', 'jammer', 'turret']) expect(loads([overlayData(`en_k_${kind}`, kind, { weapons: [{ class: 'pistol' }] })]), kind).not.toThrow()
  })

  it('格式不對在載入時擋下，訊息裡有欄位：size、overlay 的 kind 與欄位、沒有武器的攻擊型、沒有 size 的 overlay', () => {
    expect(loads([foeData('en_x', 'minion', { position: { prefer: [1], size: 2 } })])).toThrow(/enemy\/en_x：.*position\.size/)
    expect(loads([foeData('en_x', 'minion', { position: { prefer: [1], size: 'overlay' } })])).toThrow(/enemy\/en_x：.*要寫 overlay/)
    expect(loads([overlayData('en_x', 'nuke')])).toThrow(/enemy\/en_x：.*overlay\.kind 只能是/)
    expect(loads([overlayData('en_x', 'attack', { overlay: { kind: 'attack', fixed: 1 } })])).toThrow(/enemy\/en_x：.*overlay\.fixed/)
    expect(loads([overlayData('en_x', 'attack', { overlay: { kind: 'attack', spin: true } })])).toThrow(/enemy\/en_x：.*overlay\.spin/)
    expect(loads([overlayData('en_x', 'attack', { weapons: [] })])).toThrow(/enemy\/en_x：.*要有武器/)
    expect(loads([overlayData('en_x', 'turret', { weapons: [] })])).toThrow(/enemy\/en_x：.*要有武器/)
    expect(loads([foeData('en_x', 'minion', { overlay: { kind: 'attack' } })])).toThrow(/enemy\/en_x：.*position\.size 要是 'overlay'/)
    // 生命的修正可以低到 ×0.5（一般的下限是 ×0.7），再低不收
    expect(loads([overlayData('en_x', 'attack', { mods: { hp: 0.4 } })])).toThrow(/enemy\/en_x：.*mods\.hp/)
  })

  it('附屬單位 attached：count 1～4、slot 是 same 或 1～4、不認得的鍵擋下；掛在格上的一台自己不能再帶附屬單位', () => {
    expect(loads([foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', count: 5 }] })])).toThrow(/enemy\/en_x：.*attached\[0\]\.count/)
    expect(loads([foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', slot: 9 }] })])).toThrow(/enemy\/en_x：.*attached\[0\]\.slot/)
    expect(loads([foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', spin: 1 }] })])).toThrow(/enemy\/en_x：.*attached\[0\]\.spin/)
    expect(loads([foeData('en_x', 'minion', { attached: 'en_patrol' })])).toThrow(/enemy\/en_x：.*attached/)
    expect(loads([overlayData('en_x', 'attack', { attached: [{ enemy: 'en_patrol' }] })])).toThrow(/enemy\/en_x：.*不能再帶附屬單位/)
  })

  it('附屬單位指的兵種要查得到、而且要是 overlay 的兵種', () => {
    expect(loads([foeData('en_x', 'minion', { attached: [{ enemy: 'en_nowhere' }] })])).toThrow(/en_nowhere/)
    expect(loads([foeData('en_x', 'minion', { attached: [{ enemy: 'en_grunt' }] })])).toThrow(/附屬單位 en_grunt 不是 overlay 的兵種/)
    expect(loads([foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', count: 2, slot: 'same' }] })])).not.toThrow()
  })

  it("kind: 'mech' 多收一段 hull（照核心的 BattleHull）：欄位不對擋下；只有 mech 可以寫", () => {
    const hull = { id: 'h', name: '機體', hp: { now: 10, max: 10 }, armor: 3, backlash: 0.2 }
    const mech = (h: unknown) => foeData('en_x', 'elite', { kind: 'mech', hull: h })
    expect(loads([mech(hull)])).not.toThrow()
    expect(loads([mech({ ...hull, turns: 6, ext: { sync: 4 } })])).not.toThrow()
    expect(loads([mech({ ...hull, hp: { now: 11, max: 10 } })])).toThrow(/enemy\/en_x：.*hull\.hp/)
    expect(loads([mech({ ...hull, backlash: 2 })])).toThrow(/enemy\/en_x：.*hull\.backlash/)
    expect(loads([mech({ ...hull, armor: -1 })])).toThrow(/enemy\/en_x：.*hull\.armor/)
    expect(loads([mech({ ...hull, turns: 0 })])).toThrow(/enemy\/en_x：.*hull\.turns/)
    expect(loads([mech({ ...hull, name: '' })])).toThrow(/enemy\/en_x：.*hull\.name/)
    expect(loads([mech({ ...hull, spin: 1 })])).toThrow(/enemy\/en_x：.*hull\.spin/)
    expect(loads([mech('hull')])).toThrow(/enemy\/en_x：.*hull/)
    expect(loads([foeData('en_x', 'minion', { hull })])).toThrow(/enemy\/en_x：.*hull.*mech/)
  })
})

describe('遭遇：掛在格上的兵種不是一個單位', () => {
  it('setupFromEncounter 把它們放進 origin.ext.enemies.overlays（enemy、slot），foes 裡只剩佔格的；沒有 overlay 的遭遇 origin 不多東西', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    const s = setupFromEncounter(g.k, g.state, 'enc_patrol', { allies: [] })
    expect(s.foes).toEqual([{ from: 'enemy', id: 'en_grunt' }, { from: 'enemy', id: 'en_grunt' }])
    expect(s.origin?.ext).toEqual({ enemies: { overlays: [{ enemy: 'en_patrol', slot: 2 }] } })
    expect(setupFromEncounter(g.k, g.state, 'enc_prefer', { allies: [] }).origin?.ext).toEqual({ enemies: { overlays: [{ enemy: 'en_patrol' }, { enemy: 'en_patrol2' }, { enemy: 'en_turret' }] } })
    expect(setupFromEncounter(g.k, g.state, 'enc_pilot', { allies: [] }).origin?.ext).toBeUndefined()
  })

  it('全部都是掛在格上的一台：開不了戰，訊息說要有佔格的敵人', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(() => setupFromEncounter(g.k, g.state, 'enc_only', { allies: [] })).toThrow(/要有至少一個佔格的敵人/)
  })

  it('直接把 overlay 的兵種放進 foes（from: enemy）：說清楚它不是一個單位', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(() => g.startBattle({ mode: 'meat', grade: 1, cover: open, allies: [ally(1)] as never, foes: [{ from: 'enemy', id: 'en_patrol' }] })).toThrow(/掛在格上的一台，不是一個單位/)
  })

  it('點數：小型無人機每一台 0.5，兩個雜兵加一台是 2.5；附屬的不另外算（精英 2.5 ＋ 雜兵 1 ＋ 兩台附屬 ＝ 3.5）', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    const points = (id: string) => encounterPoints(g.k, g.k.content.get<{ id: string; foes: never[] }>('encounter', id)!.foes, 1)
    expect(points('enc_patrol')).toBe(2.5)
    expect(points('enc_pilot')).toBe(ENEMY_CURVE.points.elite + ENEMY_CURVE.points.minion)
    expect(points('enc_support')).toBe(2 + 3 * 0.5)
  })

  it('基準遭遇不再靠 id 的前綴：id 叫 enc_base_ 的遭遇沒寫 traits: false 就沒有 ext', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(setupFromEncounter(g.k, g.state, 'enc_base_g1_normal', { allies: [] }).origin?.ext).toBeUndefined()
  })
})

describe('開打：掛在指定的格上、不佔格、不在先攻的順序裡', () => {
  it('兩個人加一台巡邏無人機：掛在第 2 格，沒有操作者、auto；敵方只有兩個單位，先攻的順序裡沒有它', () => {
    const a = world('enc_patrol')
    expect(overlays(a)).toHaveLength(1)
    const o = overlays(a)[0]!
    // 第一輪開頭的 round.start 已經發過了（它已經打過一次）
    expect(o).toMatchObject({ side: 'foe', slot: 2, kind: 'attack', auto: true, used: true, down: false })
    expect('owner' in o).toBe(false)
    expect(o.autonomous).toBeUndefined()
    expect(Object.values(a.battle.units).filter((u) => u.side === 'foe')).toHaveLength(2)
    expect(a.battle.order).not.toContain(o.id)
    // 不佔格：第 2 格的敵人照樣站著
    expect(Object.values(a.battle.units).filter((u) => u.side === 'foe' && u.slot === 2)).toHaveLength(1)
    expect(a.battle.origin.headcount).toEqual({ ally: 2, foe: 2 })
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('開打時記一拍「…掛在敵方第 2 格」', () => {
    const g = makeBattleGame({ features: FEATURES, content: [PACK], battle: setupOf('enc_patrol'), seed: 3 }).game
    const text = g.state.reports.flatMap((r) => r.timeline).map((b) => b.text).join('\n')
    expect(text).toMatch(/巡邏機|en_patrol號機掛在敵方第 2 格/)
  })

  it('沒寫格：照 position.prefer 的第一個空的；那一格有了就換下一個，prefer 都滿了就挑最近的空格', () => {
    const a = world('enc_prefer')
    // en_patrol prefer [2, 3] → 2；en_patrol2 prefer [2, 3] → 3；en_turret prefer [4] → 4
    expect(overlays(a).map((o) => [o.name, o.slot])).toEqual([['en_patrol號機', 2], ['en_patrol2號機', 3], ['en_turret號機', 4]])
    // prefer 都被佔了：遭遇的 foes 再多一台 prefer [2, 3] 的，掛在離 2 最近的空格 1
    const b = world('enc_mix')
    expect(overlays(b).map((o) => [o.kind, o.slot])).toContainEqual(['attack', 1])
  })

  it('資料指定的格被佔了：退回 prefer 的第一個空格（不丟錯）', () => {
    const a = arena(setupOf('enc_patrol', undefined, { origin: { ext: { enemies: { overlays: [{ enemy: 'en_patrol', slot: 2 }, { enemy: 'en_patrol', slot: 2 }] } } } }), FEATURES, (k) => { k.content.loadPack(PACK); readyFeatures(k) })
    expect(overlays(a).map((o) => o.slot)).toEqual([2, 3])
  })
})

describe('它的數字（ENEMIES 第 10 節、1.5 節目標表）', () => {
  it('耐久 = 目標表的生命 × 修正、護甲與迴避 = 目標表 + 修正（迴避再 + 3）；武器是第一把、命中照目標表；傷害倍率照位階', () => {
    const o = overlays(world('enc_patrol'))[0]!
    // I 級雜兵：生命 45 × 0.5、護甲 1 + 1、迴避 10 − 1 + 3、命中 +3
    expect(o.hp).toEqual({ now: Math.round(ENEMY_CURVE.hp.minion[0] * 0.5), max: Math.round(ENEMY_CURVE.hp.minion[0] * 0.5) })
    expect(o.hp.max).toBe(23)
    expect(o.armor).toBe(ENEMY_CURVE.armor[0] + 1)
    expect(o.evade).toBe(ENEMY_CURVE.evade[0] - 1 + 3)
    expect(o.weapon).toMatchObject({ class: 'pistol', hit: ENEMY_CURVE.attack[0] })
    expect(o.ext).toMatchObject({ enemy: 'en_patrol', grade: 1, dmgMult: { hp: ENEMY_CURVE.rankDamage.minion, load: 1 } })
    // 沒有修正的一台：迴避就是目標表 + 3
    expect(overlays(world('enc_prefer'))[1]!.evade).toBe(ENEMY_CURVE.evade[0] + 3)
  })

  it('照遭遇的等級：III 級的數字', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    const s = { ...setupFromEncounter(g.k, g.state, 'enc_patrol', { allies: [ally(1)] as never }), cover: open, grade: 3 as const }
    const o = arena(s, FEATURES, (k) => { k.content.loadPack(PACK); readyFeatures(k) }).battle.overlays[0]!
    expect(o.hp.max).toBe(Math.round(ENEMY_CURVE.hp.minion[2] * 0.5))
    expect(o.evade).toBe(ENEMY_CURVE.evade[2] - 1 + 3)
    expect(o.weapon!.hit).toBe(ENEMY_CURVE.attack[2])
  })

  it('傷害有乘位階的倍率：同一擊乘 ×0.4 的傷害，比不乘的少（最少 1）', () => {
    const hitOnce = (mult: number): number => {
      const a = world('enc_patrol')
      const o = overlays(a)[0]!
      o.ext = { ...o.ext, dmgMult: { hp: mult, load: 1 } }
      const run = a.run(dice(15, 6, 6, 6, 6, 6, 6, 6))
      const r = run.overlayAttack(o, a.ally(1), { spend: 0 })
      expect(r.hit).toBe(true)
      return r.dealt
    }
    const full = hitOnce(1)
    const scaled = hitOnce(ENEMY_CURVE.rankDamage.minion)
    expect(full).toBeGreaterThan(scaled)
    expect(scaled).toBe(Math.max(1, Math.round(full * ENEMY_CURVE.rankDamage.minion)))
  })
})

describe('每一輪自己動（features/summons 的 round.start）', () => {
  it('每一輪開頭自己打我方一個人一次：用它自己的武器、替身是攻擊者、花的是自己的彈匣以外的東西（不花彈）', () => {
    const a = world('enc_patrol')
    const o = overlays(a)[0]!
    const before = a.ally(1).hp!.now + a.ally(2).hp!.now
    const run = a.run(dice(0, 15, 6, 6, 6, 6, 6, 6))
    startRound(a, run)
    expect(shots(run, o.id)).toHaveLength(1)
    expect(a.ally(1).hp!.now + a.ally(2).hp!.now).toBeLessThan(before)
    expect(o.used).toBe(true)
    // 攻擊者是替身，不在單位清單裡
    expect(Object.keys(a.battle.units)).not.toContain(o.id)
    expect(run.beats.find((b) => b.roll)!.roll!.attr).toBe('reflex')
  })

  it('目標用核心的 targetWeight 挑（用替身當挑的人）：亂數 0 打第一個、亂數壓到最後打第二個', () => {
    const first = world('enc_patrol')
    const r1 = first.run(dice(0, 15))
    startRound(first, r1)
    const second = world('enc_patrol')
    const r2 = second.run(dice(99, 15))
    startRound(second, r2)
    const target = (r: BattleRun) => (shots(r, overlays(first)[0]!.id)[0]!.data as Rec).target
    expect(target(r1)).toBe('a1')
    expect(target(r2)).toBe('a2')
  })

  it('每一輪各打一次：連著兩輪、每一輪一次', () => {
    const a = world('enc_patrol')
    const o = overlays(a)[0]!
    for (let round = 2; round <= 4; round++) {
      const run = a.run(dice(0, 15))
      startRound(a, run, round)
      expect(shots(run, o.id), `第 ${round} 輪`).toHaveLength(1)
    }
  })

  it('被打下來之後不再動：被擊落的不打、也不記一拍', () => {
    const a = world('enc_patrol')
    const o = overlays(a)[0]!
    // 玩家射擊把它打下來（掛著的東西可以單獨瞄準）
    o.hp.now = 1
    const down = a.run(dice(15, 6, 6, 6, 6, 6))
    const shoot = a.k.battle.getAction('shoot')!
    expect(shoot.targets!(down, a.ally(1)).some((t) => 'overlay' in t.target && t.target.overlay === o.id && t.blocks.length === 0)).toBe(true)
    shoot.run(down, a.ally(1), { overlay: o.id }, { action: 'shoot' })
    expect(o.down).toBe(true)
    const run = a.run(dice(0, 15))
    const hp = a.ally(1).hp!.now
    startRound(a, run)
    expect(shots(run, o.id)).toEqual([])
    expect(a.ally(1).hp!.now).toBe(hp)
  })

  it('每一輪清 used：沒有操作者的一台，沒有事可做時也清掉上一輪留下的 used（醫療型：同一格的人沒受傷）', () => {
    const a = world('enc_support')
    const medic = overlays(a).find((o) => o.kind === 'medic')!
    medic.used = true
    startRound(a, a.run(dice(0, 15)))
    expect(medic.used).toBe(false)
  })

  it('被 hack 接管（ext.hack.taken）期間不動它：不自己打、used 也不清', () => {
    const a = world('enc_patrol')
    const o = overlays(a)[0]!
    o.used = true
    o.ext = { ...o.ext, hack: { taken: { by: 'a1', mode: 'rewrite', left: 1, fresh: false, from: { side: 'foe', auto: true } } } }
    const run = a.run(dice(0, 15))
    startRound(a, run)
    expect(shots(run, o.id)).toEqual([])
    expect(o.used).toBe(true)
  })

  it('有操作者的不自己動（操作者用指揮叫它）：owner 還在的不在 round.start 打', () => {
    const a = world('enc_pilot')
    const run = a.run(dice(0, 15))
    startRound(a, run)
    expect(run.beats.filter((b) => b.roll)).toEqual([])
  })

  it('其他種類：護盾型守著同一格的人、醫療型急救同一格受傷的人、偵察型標記我方一個人', () => {
    const a = world('enc_support')
    const [shield, medic, scout] = ['shield', 'medic', 'scout'].map((kind) => overlays(a).find((o) => o.kind === kind)!)
    const mate = Object.values(a.battle.units).find((u) => u.side === 'foe' && u.slot === 2)!
    mate.hp!.now -= 20
    const run = a.run(dice(0, 15, 3, 3))
    startRound(a, run)
    expect(shield!.ext?.guard).toBe('battle_end')
    expect(mate.hp!.now).toBeGreaterThan(mate.hp!.max - 20)
    expect(Object.values(a.battle.units).some((u) => u.side === 'ally' && u.statuses.some((s) => s.id === 'marked'))).toBe(true)
    expect([shield!, medic!, scout!].every((o) => o.used)).toBe(true)
    // 護盾守著：打第 1 格的人，這一擊改打護盾無人機
    const f = Object.values(a.battle.units).find((u) => u.side === 'foe' && u.slot === 1)!
    const hit = a.run(dice(15, 6, 6, 6, 6, 6)).attack(a.ally(1), f, { spend: 0 })
    expect(hit.redirected).toBe(true)
    expect(f.hp!.now).toBe(f.hp!.max)
    // 護盾型：同一格的人迴避 +2（敵方也一樣）
    expect(a.run().mods('evade', f).some((p) => p.label === '護盾無人機' && p.value === 2)).toBe(true)
  })

  it('沒有目標可打（我方全倒）不丟錯', () => {
    const a = world('enc_patrol')
    for (const id of ['a1', 'a2']) a.battle.units[id]!.slot = 0
    expect(() => startRound(a, a.run(dice(0, 15)))).not.toThrow()
  })
})

describe('玩家可以選它當射擊的目標；範圍的投擲物打到它那一格時一起打到', () => {
  it('射擊的目標清單裡有敵方每一台沒被擊落的；打中就扣它的耐久，不傷那一格的遮蔽', () => {
    const a = world('enc_patrol', { more: { cover: { ally: [0, 0, 0, 0], foe: [0, 2, 0, 0] } } })
    const o = overlays(a)[0]!
    const run = a.run(dice(15, 6, 6, 6, 6, 6))
    const cover = a.battle.cover.foe[1]!.hp
    const targets = a.k.battle.getAction('shoot')!.targets!(run, a.ally(1))
    expect(targets.filter((t) => 'overlay' in t.target)).toEqual([{ target: { overlay: o.id }, blocks: [] }])
    a.k.battle.getAction('shoot')!.run(run, a.ally(1), { overlay: o.id }, { action: 'shoot' })
    expect(o.hp.now).toBeLessThan(o.hp.max)
    expect(a.battle.cover.foe[1]!.hp).toBe(cover)
  })

  it('投擲物（手雷）：丟在敵方第 2 格，那一格的人與掛在那一格的無人機各自吃到', () => {
    const a = world('enc_patrol')
    const o = overlays(a)[0]!
    const mate = Object.values(a.battle.units).find((u) => u.side === 'foe' && u.slot === 2)!
    const run = a.run(dice(15, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6))
    run.effects([{ op: 'throw', dice: 4 }], { user: a.ally(1), target: { side: 'foe', slot: 2 }, source: { kind: 'item', id: 'it_nade', name: '手雷' }, pick: { also: 1 }, n: {} })
    expect(o.hp.now).toBeLessThan(o.hp.max)
    expect(mate.hp!.now).toBeLessThan(mate.hp!.max)
  })
})

describe('砲塔：不能被移動；被電磁打到下一輪不開火、再下一輪照常', () => {
  it('砲塔掛在 position.prefer 的格上、有武器、記著 fixed；它不能被移動（照種類與 fixed 擋下，被接管成我方的也一樣）', () => {
    const a = world('enc_turret')
    const t = overlays(a)[0]!
    expect(t).toMatchObject({ kind: 'turret', slot: 4, auto: true })
    expect(t.ext?.fixed).toBe(true)
    expect(t.weapon).toBeDefined()
    // 接管成我方的（owner 是 a1）之後叫它換格：擋下
    t.side = 'ally'
    t.owner = 'a1'
    const run = a.run()
    expect(() => run.effects([{ op: 'drone.move', to: 'to', any: true }], { user: a.ally(1), target: { overlay: t.id }, pick: { to: 3 }, source: { kind: 'ability', id: 'x', name: 'x' }, n: {} })).toThrow(BattleBlocked)
    expect(t.slot).toBe(4)
  })

  it('資料寫 fixed 的一台（不是砲塔種類）也不會移動', () => {
    const a = world('enc_pilot')
    const d = overlays(a)[0]!
    d.ext = { ...d.ext, fixed: true }
    const run = a.run()
    expect(() => run.effects([{ op: 'drone.move', to: 'to', any: true }], { user: a.foe(1), target: { overlay: d.id }, pick: { to: 1 }, source: { kind: 'ability', id: 'x', name: 'x' }, n: {} })).toThrow(/不能移動/)
  })

  it('砲塔自己開火（每輪一次）；被電磁打到沒被擊落：下一輪不開火（記一拍），再下一輪照常', () => {
    const a = world('enc_turret')
    const t = overlays(a)[0]!
    const emHit = a.run(dice(15, 1, 1, 1, 1, 1, 1))
    emHit.attack(a.ally(1), emHit.standIn(t), { weapon: emW(), spend: 0 })
    expect(t.down).toBe(false)
    expect(t.ext?.stun).toBe(1)
    expect(textOf(emHit)).toMatch(/被電磁打中，停機一回合/)
    // 下一輪：停著，不開火
    const r2 = a.run(dice(0, 15))
    startRound(a, r2, 2)
    expect(shots(r2, t.id)).toEqual([])
    expect(textOf(r2)).toMatch(/這一輪停機/)
    expect(t.ext?.stun).toBeUndefined()
    // 再下一輪：照常
    const r3 = a.run(dice(0, 15))
    startRound(a, r3, 3)
    expect(shots(r3, t.id)).toHaveLength(1)
  })

  it('不算被電磁打到的：非電磁的傷害、打空、被擊落的', () => {
    const miss = world('enc_turret')
    const m = overlays(miss)[0]!
    const r1 = miss.run(dice(1))
    r1.attack(miss.ally(1), r1.standIn(m), { weapon: emW(), spend: 0 })
    expect(m.ext?.stun).toBeUndefined()
    const phys = world('enc_turret')
    const p = overlays(phys)[0]!
    const r2 = phys.run(dice(15, 3, 3, 3))
    r2.attack(phys.ally(1), r2.standIn(p), { weapon: { ...testWeapon('pistol', 30), pierce: 5 }, spend: 0 })
    expect(p.hp.now).toBeLessThan(p.hp.max)
    expect(p.ext?.stun).toBeUndefined()
    const kill = world('enc_turret')
    const k = overlays(kill)[0]!
    k.hp.now = 1
    const r3 = kill.run(dice(15, 6, 6, 6, 6, 6))
    r3.attack(kill.ally(1), r3.standIn(k), { weapon: emW(), spend: 0 })
    expect(k.down).toBe(true)
    expect(k.ext?.stun).toBeUndefined()
  })

  it('已經停著的再被打到不延長；打在護盾無人機的守著上（改打）也算被打到', () => {
    const a = world('enc_turret')
    const t = overlays(a)[0]!
    for (const n of [15, 15]) {
      const r = a.run(dice(n, 1, 1, 1, 1, 1))
      r.attack(a.ally(1), r.standIn(t), { weapon: emW(), spend: 0 })
    }
    expect(t.ext?.stun).toBe(1)
    const s = world('enc_support')
    const shield = overlays(s).find((o) => o.kind === 'shield')!
    shield.ext = { ...shield.ext, guard: 'battle_end' }
    const f = Object.values(s.battle.units).find((u) => u.side === 'foe' && u.slot === 1)!
    const r = s.run(dice(15, 1, 1, 1, 1, 1))
    expect(r.attack(s.ally(1), f, { weapon: emW(), spend: 0 }).redirected).toBe(true)
    expect(shield.ext?.stun).toBe(1)
  })

  it('機器的單位（佔一格的）被電磁打到失去下一個回合；人不會', () => {
    const a = arena(
      { mode: 'meat', grade: 1, cover: open, allies: [ally(1)] as never, foes: [{ from: 'enemy', id: 'en_bot' }, { from: 'enemy', id: 'en_grunt' }] },
      FEATURES, (k) => { k.content.loadPack(PACK); readyFeatures(k) },
    )
    const [bot, grunt] = [a.foe(1), a.foe(2)]
    expect(bot.tags).toContain('machine')
    const r = a.run(dice(15, 1, 1, 1, 1, 1, 15, 1, 1, 1, 1, 1))
    r.attack(a.ally(1), bot, { weapon: emW(), spend: 0 })
    r.attack(a.ally(1), grunt, { weapon: emW(), spend: 0 })
    expect(bot.statuses.map((s) => s.id)).toContain('lose_turn')
    expect(grunt.statuses.map((s) => s.id)).not.toContain('lose_turn')
    expect(textOf(r)).toMatch(/失去下一個回合/)
  })
})

describe('附屬單位：主人帶著的兩台', () => {
  it('開打時掛上去：owner 是主人、autonomous、沒有 auto；第一台和主人同一格，第二台挪到最近的空格；耐久照目標表', () => {
    const a = world('enc_pilot')
    const master = a.foe(1)
    expect(master.slot).toBe(1)
    expect(overlays(a)).toHaveLength(2)
    // 主人 prefer 第 3 格，但開打時照遭遇的順序站第 1 格；附屬單位跟著主人
    expect(overlays(a).map((o) => ({ owner: o.owner, side: o.side, autonomous: o.autonomous, auto: o.auto, slot: o.slot }))).toEqual([
      { owner: master.id, side: 'foe', autonomous: true, auto: undefined, slot: master.slot },
      { owner: master.id, side: 'foe', autonomous: true, auto: undefined, slot: master.slot + 1 },
    ])
    expect(overlays(a)[0]!.hp.max).toBe(23)
    expect(a.battle.order).not.toContain(overlays(a)[0]!.id)
  })

  it('slot 寫第幾格或 same：指定的格；同一格已經有了就挪到最近的', () => {
    const a = world('enc_pilot_slot')
    expect(overlays(a).map((o) => [o.kind, o.slot])).toEqual([['shield', 4], ['scout', a.foe(1).slot]])
    expect(overlays(a).every((o) => o.owner === 'f1' && o.autonomous)).toBe(true)
  })

  it('主人帶兩台：主人有 enemy.command（只有他有），一點行動點、目標是他自己還沒動過的一台', () => {
    const a = world('enc_pilot')
    const cmd = a.k.battle.getAction('enemy.command')!
    const master = a.foe(1)
    const run = a.run()
    expect(cmd.cost(run, master)).toEqual({ ap: 1 })
    expect(cmd.has!(run, master)).toBe(true)
    expect(cmd.has!(run, a.foe(2))).toBe(false)
    expect(cmd.has!(run, a.ally(1))).toBe(false)
    expect(cmd.targets!(run, master)).toEqual(overlays(a).map((o) => ({ target: { overlay: o.id }, blocks: [] })))
    expect(cmd.aiScore!(run, master, a.ally(1))).toBe(2)
  })

  it('主人的回合會用 enemy.command：固定骰面下選得到，只花 1 點行動點、用那一台自己的武器打我方的人；每台一回合一次', () => {
    const a = world('enc_pilot')
    const master = a.foe(1)
    // 主人自己的槍沒子彈了：不能射擊；其餘的行動（換彈）和指揮同分，亂數 0 抽到排在最前面的指揮
    master.weapons[0]!.mag!.now = 0
    const run = a.run(dice(...Array(60).fill(0).flatMap(() => [0, 0, 15])))
    const ap = master.ap.now
    settle(master)
    expect(aiStep(run, master)).toBe(true)
    expect(master.ap.now).toBe(ap - 1)
    expect(overlays(a).filter((o) => o.used)).toHaveLength(1)
    const first = overlays(a).find((o) => o.used)!
    expect(shots(run, first.id)).toHaveLength(1)
    expect(a.ally(1).statuses.length + a.ally(2).statuses.length).toBe(0)
    // 接著再指揮：另一台；兩台都動過之後，主人的行動裡不再有指揮
    for (let i = 0; i < 6; i++) {
      settle(master)
      if (!aiStep(run, master)) break
    }
    expect(overlays(a).every((o) => o.used)).toBe(true)
    for (const o of overlays(a)) expect(shots(run, o.id), o.id).toHaveLength(1)
    const cmd = a.k.battle.getAction('enemy.command')!
    expect(cmd.targets!(run, master).every((t) => t.blocks.includes('這一台這一回合動過了。'))).toBe(true)
    expect(cmd.aiTarget!(run, master, null)).toBeNull()
    expect(cmd.aiScore!(run, master, a.ally(1))).toBeNull()
    // 打的是我方的人
    expect(run.beats.filter((b) => b.roll && overlays(a).some((o) => o.id === (b.data as Rec).attacker)).every((b) => ['a1', 'a2'].includes((b.data as Rec).target as string))).toBe(true)
  })

  it('指揮一台已經動過的：擋下（原因是完整的句子）；pick.at 指定打誰就打誰', () => {
    const a = world('enc_pilot')
    const master = a.foe(1)
    const cmd = a.k.battle.getAction('enemy.command')!
    const [first, second] = overlays(a)
    const run = a.run(dice(15, 15, 15, 15, 15, 15, 15))
    cmd.run(run, master, { overlay: first!.id }, { action: 'enemy.command', target: { overlay: first!.id }, pick: { at: 'a2' } })
    expect(shots(run, first!.id).map((b) => (b.data as Rec).target)).toEqual(['a2'])
    expect(first!.used).toBe(true)
    expect(() => cmd.run(run, master, { overlay: first!.id }, { action: 'enemy.command' })).toThrow(/這一台這一回合動過了/)
    expect(() => cmd.run(run, master, { overlay: 'o99' }, { action: 'enemy.command' })).toThrow(BattleBlocked)
    cmd.run(run, master, { overlay: second!.id }, { action: 'enemy.command', pick: { at: 'a1' } })
    expect(shots(run, second!.id).map((b) => (b.data as Rec).target)).toEqual(['a1'])
  })

  it('主人在的時候命中沒有自律的 −2；砲塔、無人機被電磁打到的那一回合，指揮灰掉', () => {
    const a = world('enc_pilot')
    const master = a.foe(1)
    const cmd = a.k.battle.getAction('enemy.command')!
    const o = overlays(a)[0]!
    const run = a.run(dice(0, 15, 15, 15))
    cmd.run(run, master, { overlay: o.id }, { action: 'enemy.command', target: { overlay: o.id } })
    expect(part(shots(run, o.id)[0]!, '自律')).toBeUndefined()
    // 被電磁打到：到主人的下一個回合開始變成「這個回合動不了」，回合結束拿掉
    o.used = false
    const em = a.run(dice(15, 1, 1, 1, 1, 1))
    em.attack(a.ally(1), em.standIn(o), { weapon: emW(), spend: 0 })
    expect(o.ext?.stun).toBe(1)
    a.k.battle.emit('turn.start', { run: a.run(), unit: master })
    expect(o.ext?.stun).toBe(2)
    expect(cmd.targets!(a.run(), master).find((t) => 'overlay' in t.target && t.target.overlay === o.id)!.blocks).toEqual(['這一台被電磁打到，這個回合動不了。'])
    expect(() => cmd.run(a.run(dice(0, 15)), master, { overlay: o.id }, { action: 'enemy.command' })).toThrow(/被電磁打到/)
    a.k.battle.emit('turn.end', { run: a.run(), unit: master })
    expect(o.ext?.stun).toBeUndefined()
  })

  it('主人倒下之後：兩台還在、沒有主人、自己動（auto）；每一輪各打我方一個人一次，命中的明細多一項 −2', () => {
    const a = world('enc_pilot')
    const master = a.foe(1)
    a.run(dice(...Array(20).fill(1))).setOut(master, 'down')
    expect(overlays(a).map((o) => ({ down: o.down, auto: o.auto, owner: o.owner, orphan: o.ext?.orphan, autonomous: o.autonomous }))).toEqual([
      { down: false, auto: true, owner: undefined, orphan: true, autonomous: true },
      { down: false, auto: true, owner: undefined, orphan: true, autonomous: true },
    ])
    expect(a.run().k.battle.getAction('enemy.command')!.has!(a.run(), master)).toBe(false)
    const slots = overlays(a).map((o) => o.slot)
    const run = a.run(dice(0, 15, 0, 15))
    startRound(a, run)
    for (const o of overlays(a)) {
      const shot = shots(run, o.id)
      expect(shot, o.id).toHaveLength(1)
      expect(part(shot[0]!, '自律')).toBe(-2)
    }
    // 不移動：這一輪沒有換格
    expect(overlays(a).map((o) => o.slot)).toEqual(slots)
  })

  it('主人倒下之後被打下來的那一台不再動；另一台照打', () => {
    const a = world('enc_pilot')
    a.run(dice(...Array(20).fill(1))).setOut(a.foe(1), 'down')
    overlays(a)[0]!.down = true
    const run = a.run(dice(0, 15))
    startRound(a, run)
    expect(shots(run, overlays(a)[0]!.id)).toEqual([])
    expect(shots(run, overlays(a)[1]!.id)).toHaveLength(1)
  })

  it('沒有操作者的那一台：自律的 used 每輪清掉', () => {
    const a = world('enc_pilot')
    a.run(dice(...Array(20).fill(1))).setOut(a.foe(1), 'down')
    const o = overlays(a)[0]!
    o.used = true
    o.ext = { ...o.ext, stun: 1 }
    startRound(a, a.run(dice(0, 15)))
    expect(o.used).toBe(false)
  })
})

describe('我方的無人機也自律（COMBAT_SYSTEM 9.1 節、dev/adr/0015 E6：兩邊統一）', () => {
  const pilot = (): Rec => one({ weapon: 'pistol', skills: { sync: 2, piloting: 3, firearms: 2 }, hp: { now: 200, max: 200 }, ext: { summons: { drones: [{ kind: 'attack', grade: 1 }, { kind: 'shield', grade: 1 }] } } } as never) as Rec
  const mine = (): Arena => arena(
    { mode: 'meat', grade: 1, cover: open, allies: [raw(pilot()), raw(one({ weapon: 'pistol', hp: { now: 200, max: 200 } } as never, 2))], foes: [{ from: 'enemy', id: 'en_grunt' }, { from: 'enemy', id: 'en_grunt' }] },
    FEATURES, (k) => { k.content.loadPack(PACK); readyFeatures(k) },
  )
  const deploy = (a: Arena, drone: number, slot: number) => a.k.battle.getAction('drone.deploy')!.run(a.run(), a.ally(1), { side: 'ally', slot }, { action: 'drone.deploy', pick: { drone } })

  it('放出的無人機帶 autonomous: true、記著操作者；放出的數字和以前一樣', () => {
    const a = mine()
    deploy(a, 0, 1)
    expect(overlays(a)[0]).toMatchObject({ owner: 'a1', autonomous: true, kind: 'attack', hp: { now: 14, max: 14 }, ext: { drone: 0, operator: 'a1' } })
  })

  it('操作者倒下：不停機、沒有操作者、auto、命中 −2、不移動；每一輪自己打一個敵人（命中照操作者的操縱）', () => {
    const a = mine()
    deploy(a, 0, 2)
    deploy(a, 1, 1)
    a.run(dice(...Array(20).fill(1))).setOut(a.ally(1), 'down')
    const [attack, shield] = overlays(a)
    expect([attack!.down, attack!.auto, attack!.owner, attack!.ext?.orphan]).toEqual([false, true, undefined, true])
    const slot = attack!.slot
    const run = a.run(dice(0, 15))
    startRound(a, run)
    const shot = shots(run, attack!.id)
    expect(shot).toHaveLength(1)
    expect(part(shot[0]!, '自律')).toBe(-2)
    expect(shot[0]!.roll!.skill).toBe('piloting')
    expect(attack!.slot).toBe(slot)
    // 護盾型自律：守著同一格的人
    expect(shield!.ext?.guard).toBe('battle_end')
    // 沒有被擊落的後果：操作者沒有被灌感載、這一場那一台還是「放出去了」
    expect(a.ally(1).load!.now).toBe(0)
    expect(a.ally(1).uses['drone:0']).toBe(1)
  })

  it('操作者還在的時候：round.start 不替它動，命中沒有 −2（用操作者的操縱）', () => {
    const a = mine()
    deploy(a, 0, 2)
    const run = a.run(dice(0, 15))
    startRound(a, run)
    expect(run.beats.filter((b) => b.roll)).toEqual([])
    expect(overlays(a)[0]!.used).toBe(false)
  })

  it('我方的無人機被電磁打到：到操作者的下一個回合動不了（指揮灰掉、做不成），回合結束拿掉', () => {
    const a = mine()
    deploy(a, 0, 2)
    const o = overlays(a)[0]!
    const em = a.run(dice(15, 1, 1, 1, 1, 1))
    em.attack(a.foe(1), em.standIn(o), { weapon: emW(), spend: 0 })
    expect(o.ext?.stun).toBe(1)
    const cmd = a.k.battle.getAction('drone.command')!
    // 還沒輪到操作者：這一輪的指揮照常（停機從「下一個回合」開始算）
    expect(cmd.targets!(a.run(), a.ally(1))[0]!.blocks).toEqual([])
    a.k.battle.emit('turn.start', { run: a.run(), unit: a.ally(1) })
    expect(cmd.targets!(a.run(), a.ally(1))[0]!.blocks).toEqual(['這一台被電磁打到，這個回合動不了。'])
    expect(() => cmd.run(a.run(dice(15, 15)), a.ally(1), { overlay: o.id }, { action: 'drone.command', pick: { at: 'f1' } })).toThrow(/被電磁打到/)
    a.k.battle.emit('turn.end', { run: a.run(), unit: a.ally(1) })
    expect(cmd.targets!(a.run(), a.ally(1))[0]!.blocks).toEqual([])
  })
})

describe('機甲只收格式：載得進來、開打時沒有機體', () => {
  it('kind: mech 帶 hull 的敵人開打：單位身上沒有 hull（不啟動），其他照常', () => {
    const a = world('enc_mech')
    const mech = a.foe(1)
    expect(mech.enemy).toBe('en_mech')
    expect(mech.hull).toBeUndefined()
    expect(mech.hp!.max).toBeGreaterThan(0)
    expect(overlays(a)).toEqual([])
    expect(battleProblems(a.battle)).toEqual([])
  })
})

describe('存檔往返：帶著敵方無人機的戰鬥存了再讀，接著打的結果一樣', () => {
  const start = () => makeBattleGame({ features: FEATURES, content: [PACK], battle: setupOf('enc_mix', [ally(1), ally(2, { hp: { now: 90, max: 90 } })]), seed: 11 }).game

  it('開打時的樣子：砲塔、巡邏機（沒有操作者）與主人帶的兩台（owner）都在，狀態合法', () => {
    const g = start()
    const list = g.battle!.overlays
    expect(list.map((o) => [o.kind, 'owner' in o, o.auto === true])).toEqual([['attack', false, true], ['turret', false, true], ['attack', true, false], ['attack', true, false]])
    expect(battleProblems(g.battle)).toEqual([])
  })

  it('每一步存檔再讀都和沒有中斷的一樣（砲塔與無人機打過人）', () => {
    const owners = (g: ReturnType<typeof start>) => g.battle!.overlays.map((o) => o.owner ?? null)
    const play = (saveAt: number | null) => {
      const g = start()
      for (let i = 0; i < 120 && !g.battle!.result; i++) {
        if (i === saveAt) {
          const before = stateHash(g.state)
          const was = owners(g)
          expect(g.load(g.save('manual', 'x'))).toBeNull()
          expect(stateHash(g.state)).toBe(before)
          expect(owners(g)).toEqual(was)
        }
        g.battleNext({ anyone: true })
      }
      return g
    }
    const plain = play(null)
    const text = plain.state.reports.flatMap((r) => r.timeline).map((b) => b.text).join('\n')
    expect(text).toMatch(/en_turret號機 用.*射擊/)
    expect(text).toMatch(/en_patrol號機 用.*射擊/)
    expect(plain.battle!.round).toBeGreaterThanOrEqual(2)
    for (const at of [1, 4, 11, 30]) expect(stateHash(play(at).state), `第 ${at} 步存檔`).toBe(stateHash(plain.state))
  })
})

describe('hack 的 treeTier：敵人讀不到樹階時用單位的等級', () => {
  const unit = (o: Rec): BattleUnit => ({ ext: {}, grade: 1, tags: [], ...o }) as unknown as BattleUnit

  it('敵人（敵方潛網者）沒有技能樹：樹階就是自己的等級，夾在 1～5', () => {
    expect(treeTier(unit({ enemy: 'en_x', grade: 3 }))).toBe(3)
    expect(treeTier(unit({ enemy: 'en_x', grade: 5 }))).toBe(5)
    expect(treeTier(unit({ enemy: 'en_x', grade: 9 }))).toBe(5)
    expect(treeTier(unit({ enemy: 'en_x', grade: 0 }))).toBe(1)
  })

  it('有寫樹階的照樣用寫的（敵人也一樣）；其他單位讀不到還是 1，不看等級', () => {
    expect(treeTier(unit({ enemy: 'en_x', grade: 4, ext: { abilities: { tiers: { [DEFAULT_TREE]: 2 } } } }))).toBe(2)
    expect(treeTier(unit({ enemy: 'en_x', grade: 4, ext: { deck: { grade: 2, firewall: 10, slots: [], tree: 'other' }, abilities: { tiers: { other: 3, [DEFAULT_TREE]: 1 } } } }))).toBe(3)
    expect(treeTier(unit({ grade: 4 }))).toBe(1)
    expect(treeTier(unit({ grade: 4, ext: { abilities: { tiers: {} } } }))).toBe(1)
  })
})

describe('資料：基準遭遇自己寫 traits: false（機制欄位）', () => {
  it('engine/data/world/encounters.json 的基準遭遇每一筆都寫了 traits: false', () => {
    const list = JSON.parse(readFileSync(new URL('../../data/world/encounters.json', import.meta.url), 'utf8')) as Array<{ id: string; traits?: unknown }>
    const base = list.filter((e) => e.id.startsWith('enc_base_'))
    expect(base.length).toBeGreaterThanOrEqual(10)
    expect(base.filter((e) => e.traits !== false).map((e) => e.id)).toEqual([])
  })
})
