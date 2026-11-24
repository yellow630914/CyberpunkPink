// 驗收測試：dev/work/M3-lace.md（cpp-feature）。features/enemies 的內海面：照內海表把敵人資料組成內海的單位、照層挑兵種、AI 的參數、解剖才拿得到的掉落。
// 規格：ENEMIES 1.2、1.5（內海表）、第 2 節（mods.guard、mods.ram）、第 9 節、第 15 節最後一個樣本；DATA 6.2；CYBERSPACE 6.2（感載基準、攻擊骰）、6.4 最後一條；
// dev/adr/0018 第四節與 N18（傷害骰）、N19（防火牆）、N20（不掉現金）、N25（會換檔的敵人）。
// 內容是測試自帶的最小假資料：六筆兵種（白、粉雜兵、粉精英、黑、閘門守衛、企業潛網者）加三筆備用（沒有網內兵種的勢力退到 none 用的、現實的兵種、掛 constructs 的現實兵種）、
// 三個 weapon_class、幾件構裝與一件憑證物品。不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel } from '../../src'
import { BattleRun, DIFFICULTY_ENEMY_COEF, beginTurn, clone, createKernel, enemyCoefFor, gradeDice, readyFeatures, setupBattle } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import {
  DEEP_SYNC_PCT, DEFAULT_SYNC, ENEMY_CURVE, NET_CURVE, WHITE_LEAVES_AT, credentialItem, encounterPoints, enemiesFeature, pickCandidates, pickEnemy, pickProblems, setupFromEncounter,
} from '../../src/features/enemies'
import { lootProblems, lootRefs } from '../../src/features/enemies/loot'
import { netcombatFeature } from '../../src/features/netcombat'
import { NET_TARGETS, ENEMY_TARGETS, TEST_NET_COMBAT, makeBattleGame, makeState, netAvatar, observed, playOut } from '../../src/testkit'
import { raw } from '../helpers/battle'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'sync'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPON_CLASSES = [
  { id: 'smg', name: '衝鋒槍', dice: 3, type: 'physical', range: [2, 5], mag: 3, cover_mult: 0.5, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' },
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]
const STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const item = (id: string, name: string) => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 1, legal: 'free' })
const construct = (id: string, o: Rec = {}) => ({ id, class: 'weapon', name: id, grade: 1, legal: 'free', archetype: 'smg', type: 'neural', ram: 1, ...o })

const base = (id: string, rank: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的網內敵人。', faction: 'f_a', rank, grades: [1, 5], kind: 'lace',
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...more,
})
const gun = (id = 'duster', more: Rec = {}) => ({ id, class: 'smg', type: 'neural', ram: 1, ...more })

const ENEMIES: Rec[] = [
  // 白：沒有構裝（不攻擊）、站第 4 格
  base('en_white', 'minion', { color: 'white', position: { prefer: [4] }, ai: { prefer: 'netrunner', focus: 1, flee_below: 0 }, mods: { evade: 1 }, grades: [1, 5] }),
  // 粉雜兵：樣本（ENEMIES 第 15 節的粉蕾絲・女僕型）
  base('en_pink_m', 'minion', {
    color: 'pink', grades: [2, 4], mods: { load: 0.9, guard: 1 }, constructs: [gun()], mode: 'capture',
    ai: { prefer: 'overloaded', focus: 1, flee_below: 0, prefer_deep_sync: true }, defeat: 'pinned',
    loot: [{ construct: 'random', chance: 0.4, needs: 'dissect' }],
  }),
  base('en_pink_e', 'elite', { color: 'pink', grades: [3, 5], constructs: [gun('stream', { ram: 2 }), gun('lash', { class: 'rifle', type: 'pleasure', range: [2, 6], traits: ['x'] })], ai: { prefer: 'overloaded', focus: 1, flee_below: 0, prefer_deep_sync: true } }),
  // 黑：首領，同一個勢力（只有 color 能把它挑出來）
  base('en_black', 'boss', { color: 'black', grades: [4, 5], mods: { evade: 3 }, constructs: [gun('burn')], ai: { prefer: 'weakest', focus: 1, flee_below: 0 } }),
  // 閘門守衛：程式、首領，預設會換檔（shift）
  base('en_gate', 'boss', { kind: 'program', grades: [2, 5], mods: { evade: 2 }, constructs: [gun('gate', { class: 'rifle' })], ai: { focus: 1, flee_below: 0, never_flee: true } }),
  // 企業潛網者：人，寫了 constructs 與 admin（沒有 color）；沒寫 mode 與 weapons
  base('en_runner', 'elite', {
    kind: 'human', faction: 'f_c', grades: [3, 5], admin: 2, persona: true, constructs: [gun('rush')], sync: 'full',
    deck: { grade: 3, firewall: 15, slots: ['qh_a'], tree: 'tr_x' }, ai: { prefer: 'netrunner', focus: 1, flee_below: 0.3 },
  }),
  // 勢力乙沒有網內的兵種時挑到的（沒有勢力的野生粉蕾絲、精英）
  base('en_wild', 'elite', { faction: 'none', color: 'pink', grades: [1, 5], constructs: [gun('wild')] }),
  // 現實的兵種：不能放進內海
  { id: 'en_street', name: '街頭打手', desc: '測試用的敵人。', faction: 'f_a', rank: 'elite', grades: [1, 5], kind: 'human', position: { prefer: [1, 2] }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.2 } },
  // 現實的兵種寫了 constructs：兩邊都進得去
  { id: 'en_both', name: '兩棲潛網者', desc: '測試用的敵人。', faction: 'f_b', rank: 'minion', grades: [1, 5], kind: 'human', position: { prefer: [1, 2] }, mode: 'lethal', weapons: [{ class: 'pistol' }], constructs: [gun('both')], ai: { prefer: 'weakest', focus: 1, flee_below: 0 } },
  // 一般的雜兵：每個勢力都有，驗現實的 enemy_pick 不會挑到蕾絲
  { id: 'en_grunt', name: '雜兵', desc: '測試用的敵人。', faction: 'f_a', rank: 'minion', grades: [1, 5], kind: 'human', position: { prefer: [1, 2] }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 } },
  // 掉落：兩種項目都帶解剖
  base('en_loot', 'minion', {
    faction: 'f_c', color: 'pink', constructs: [gun('lt')], cash: true,
    loot: [{ construct: 'cs_w1', chance: 1, needs: 'dissect' }, { credential: true, chance: 1, needs: 'dissect' }, { item: 'it_part', chance: 1 }],
  }),
  base('en_loot_free', 'minion', { faction: 'f_c', color: 'pink', constructs: [gun('lf')], loot: [{ construct: 'cs_w1', chance: 1 }] }),
  base('en_loot_coin', 'minion', { faction: 'f_c', color: 'pink', constructs: [gun('lc')], loot: [{ construct: 'cs_w1', chance: 0.5, needs: 'dissect' }] }),
  base('en_loot_rand', 'minion', { faction: 'f_c', color: 'pink', constructs: [gun('lr')], loot: [{ construct: 'random', chance: 1, needs: 'dissect' }] }),
  base('en_loot_elite', 'elite', { faction: 'f_c', color: 'pink', constructs: [gun('le')], loot: [{ construct: 'cs_w1', chance: 0.00001, needs: 'dissect' }] }),
  // 現實的人帶憑證與零件：現實照擲
  { id: 'en_corp', name: '企業的人', desc: '測試用的敵人。', faction: 'f_c', rank: 'elite', grades: [1, 5], kind: 'human', position: { prefer: [1, 2] }, mode: 'lethal', weapons: [{ class: 'pistol' }], cash: false, ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, loot: [{ credential: true, chance: 1 }, { item: 'it_part', chance: 1 }] },
]

const PACK: ContentPack = {
  id: 'lace_test',
  content: {
    skill: SKILLS, weapon_class: WEAPON_CLASSES, battle_status: STATUSES,
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }, { id: 'f_b', name: '乙幫', short: '乙', class: 'street' }, { id: 'f_c', name: '丙企業', short: '丙', class: 'corp' }],
    item: [item('it_cred', '員工憑證'), item('it_part', '零件')],
    construct: [
      construct('cs_w1'), construct('cs_w3', { grade: 3 }), construct('cs_def2', { class: 'defense', guard: 2, grade: 2, archetype: undefined, type: undefined, ram: undefined }),
      construct('cs_tool1', { class: 'tool', ap: 1, ram: 1, target: 'foe', archetype: undefined, type: undefined }),
      construct('cs_hack', { class: 'hack', admin: { crack: 1 }, archetype: undefined, type: undefined, ram: undefined }),
    ],
    net_enemy_rule: [{ id: 'default', credential_item: 'it_cred' }],
    enemy: ENEMIES,
  },
} as unknown as ContentPack
/** 沒有憑證物品與構裝的內容：掉落要略過。 */
const { construct: _construct, net_enemy_rule: _rule, ...REST } = PACK.content as Record<string, unknown>
const BARE: ContentPack = { id: 'lace_bare', content: { ...REST, item: [item('it_part', '零件')] } } as unknown as ContentPack
void _construct
void _rule

// ===================================================================================================================
// 小工具
// ===================================================================================================================

const FEATURES: Feature[] = [enemiesFeature, deckFeature, TEST_NET_COMBAT]
/** 正式的內海行動表：netcombat 的管理行動要用 combat 註冊的效果（check）。 */
const NETCOMBAT: Feature[] = [combatFeature, enemiesFeature, deckFeature, netcombatFeature]
const kernelOf = (pack: ContentPack = PACK, features: Feature[] = FEATURES): Kernel => {
  const k = createKernel(features)
  k.content.loadPack(pack)
  readyFeatures(k)
  return k
}
const foeRef = (id: string, more: Rec = {}) => ({ from: 'enemy', id, ...more })
const pickRef = (spec: Rec) => ({ from: 'enemy_pick', ...spec })
const allies = (grade = 1) => [0, 1, 2, 3].map((i) => raw(netAvatar(i, grade as 1)))
const netSetup = (foes: Rec[], grade = 3, more: Partial<BattleSetup> = {}): BattleSetup =>
  ({ mode: 'net', grade, cover: 'medium', allies: allies(grade), foes, origin: { escapable: true, place: '測試用的子網' }, ...more }) as BattleSetup
const meatSetup = (foes: Rec[], grade = 3): BattleSetup => ({ mode: 'meat', grade: grade as 3, cover: 'medium', allies: [raw(netAvatar(0, grade as 3))], foes } as unknown as BattleSetup)

interface Built {
  k: Kernel
  state: GameState
  run: BattleRun
  foe(i: number): BattleUnit
}
/** 開一場（不經過提交）：回傳 run 與敵方的第 i 個單位（從 1 起）。 */
function build(setup: BattleSetup, o: { pack?: ContentPack; features?: Feature[]; state?: GameState } = {}): Built {
  const k = kernelOf(o.pack, o.features)
  const state = o.state ?? makeState()
  const run = setupBattle(k, state, setup)
  state.battle = clone(run.battle)
  return { k, state, run, foe: (i) => run.battle.units[`f${i}`]! }
}
const one = (id: string, grade = 3, more: Rec = {}, state?: GameState): BattleUnit => build(netSetup([foeRef(id, more)], grade), state ? { state } : {}).foe(1)

// ===================================================================================================================
// 一、目標表與單位
// ===================================================================================================================

describe('內海的目標表（ENEMIES 1.5 節；放 curve.ts，和 testkit 的 NET_TARGETS 同一張）', () => {
  it('攻擊、防護、RAM、每回合回 RAM、傷害骰、防火牆與 testkit 的 NET_TARGETS 一致', () => {
    expect(NET_CURVE.attack).toEqual(NET_TARGETS.attack)
    expect(NET_CURVE.guard).toEqual(NET_TARGETS.guard)
    expect(NET_CURVE.ram).toEqual(NET_TARGETS.ram)
    expect(NET_CURVE.ramRegen).toEqual(NET_TARGETS.ramRegen)
    expect(NET_CURVE.dice).toEqual(NET_TARGETS.dice)
    // 防火牆 11 ＋ 等級（N19）：testkit 的 laceUnit 寫 11 + grade
    expect(NET_CURVE.firewall).toBe(11)
  })

  it('感載上限、層數、行動點與現實同一欄（和 testkit 的 ENEMY_TARGETS 一致）', () => {
    expect(ENEMY_CURVE.load).toEqual(ENEMY_TARGETS.load)
    expect(ENEMY_CURVE.layers).toEqual(ENEMY_TARGETS.layers)
    expect(ENEMY_CURVE.ap).toEqual(ENEMY_TARGETS.ap)
  })

  it('每一級每一個位階：單位的數字照表（沒有修正的白蕾絲、精英與首領換算）', () => {
    for (const grade of [1, 2, 3, 4, 5] as const) {
      const g = grade - 1
      for (const [rank, id] of [['elite', 'en_pink_e'], ['boss', 'en_gate']] as const) {
        const u = one(id, grade, { grade })
        expect(u.hp, `${id} ${grade}`).toBeUndefined()
        expect(u.load!.max).toBe(ENEMY_TARGETS.load[rank][g])
        expect(u.armor).toBe(NET_TARGETS.guard[g])
        expect(u.pools.ram).toEqual({ now: NET_TARGETS.ram[rank][g]!, max: NET_TARGETS.ram[rank][g]!, regen: NET_TARGETS.ramRegen[g] })
        expect(u.evade).toBe(11 + grade + (id === 'en_gate' ? 2 : 0))
        expect(u.weapons[0]!.hit).toBe(NET_TARGETS.attack[g])
      }
    }
  })
})

describe('III 級的粉雜兵（ENEMIES 第 15 節的樣本：感載 ×0.9、防護 +1）', () => {
  const u = one('en_pink_m', 3)

  it('沒有生命；感載上限是 33 × 0.9 四捨五入；防護 4；RAM 5、每回合回 2；迴避（防火牆）14', () => {
    expect(u.hp).toBeUndefined()
    expect(u.load).toEqual({ now: 0, max: Math.round(33 * 0.9) })
    expect(u.armor).toBe(4)
    expect(u.pools.ram).toEqual({ now: 5, max: 5, regen: 2 })
    expect(u.evade).toBe(14)
    expect(u.layersMax).toBe(1)
    expect(u.ap.max).toBe(4)
  })

  it('武器是構裝：id 是構裝的 id、骰數 4 ＋ 1（等級骰）、花 1 點 RAM、沒有彈匣、神經、命中是 +5、距離與遮蔽倍率照原型', () => {
    expect(u.weapons).toHaveLength(1)
    const w = u.weapons[0]!
    expect(w.id).toBe('duster')
    expect(w.dice).toBe(NET_CURVE.dice.minion + gradeDice(3))
    expect(w.dice).toBe(5)
    expect(w.mag).toBeUndefined()
    expect(w.pool).toEqual({ ram: 1 })
    expect(w.type).toBe('neural')
    expect(w.hit).toBe(5)
    expect(w.range).toEqual([2, 5])
    expect(w.coverMult).toBe(0.5)
    expect(u.wield).toBe(0)
  })

  it('單位上的資料：ext.deck 讓破損與駭入程式的讀法和角色一樣；打法 capture 照資料', () => {
    expect(u.ext.deck).toEqual({ grade: 3, firewall: 14, slots: [], constructs: [{ id: 'duster', class: 'weapon', grade: 3 }] })
    expect(u.ai!.mode).toBe('capture')
    expect(u.control).toBe('ai')
    expect(u.enemy).toBe('en_pink_m')
  })

  it('沒有束帶（內海是釘住）；默認神經的 type：資料沒寫 type 時是 neural，寫了 pleasure 就是 pleasure（粉精英的第二把）', () => {
    expect(u.quick).toEqual([])
    const e = one('en_pink_e', 4)
    expect(e.weapons.map((w) => [w.id, w.type, w.pool, w.dice, w.range])).toEqual([
      ['stream', 'neural', { ram: 2 }, 5 + 2, [2, 5]],
      ['lash', 'pleasure', { ram: 1 }, 5 + 2, [2, 6]],
    ])
    expect(e.weapons[1]!.traits).toContain('x')
    expect(e.weapons[1]!.traits).toContain('long')
  })

  it('每一級的傷害骰：位階定顆數（雜兵 4、精英 5、首領 6），III 級起再加等級骰', () => {
    for (const grade of [1, 2, 3, 4, 5] as const) {
      const eg = Math.min(5, Math.max(3, grade))
      expect(one('en_pink_e', grade).weapons[0]!.dice, `精英 ${grade}`).toBe(5 + gradeDice(eg))
      const bg = Math.min(5, Math.max(4, grade))
      expect(one('en_black', grade).weapons[0]!.dice, `首領 ${grade}`).toBe(6 + gradeDice(bg))
      const gg = Math.min(5, Math.max(2, grade))
      expect(one('en_gate', grade).weapons[0]!.dice, `守衛 ${grade}`).toBe(6 + gradeDice(gg))
    }
  })

  it('迴避是防火牆：11 ＋ 等級 ＋ mods.evade（白 +1、閘門守衛 +2、黑 +3）', () => {
    expect(one('en_white', 2).evade).toBe(11 + 2 + 1)
    expect(one('en_gate', 4).evade).toBe(11 + 4 + 2)
    expect(one('en_black', 5).evade).toBe(11 + 5 + 3)
    expect(one('en_pink_e', 4).evade).toBe(11 + 4)
  })

  it('mods.ram 與 mods.guard 是加減；防護最少 0、RAM 最少 1', () => {
    const k = kernelOf()
    const ent = (mods: Rec) => ({ ...base('en_tmp', 'minion', { constructs: [gun()], mods }), id: 'en_tmp' }) as Rec
    const pack = (mods: Rec): ContentPack => ({ id: 'tmp', content: { ...PACK.content, enemy: [...ENEMIES, ent(mods)] } }) as unknown as ContentPack
    const a = build(netSetup([foeRef('en_tmp')], 1), { pack: pack({ guard: -5, ram: -9 }) }).foe(1)
    expect(a.armor).toBe(0)
    expect(a.pools.ram!.max).toBe(1)
    const b = build(netSetup([foeRef('en_tmp')], 1), { pack: pack({ guard: 2, ram: 3 }) }).foe(1)
    expect(b.armor).toBe(NET_TARGETS.guard[0]! + 2)
    expect(b.pools.ram!.max).toBe(NET_TARGETS.ram.minion[0]! + 3)
    expect(k).toBeTruthy()
  })
})

describe('同步檔位：沒寫是雜兵標準、精英深、首領 shift；資料寫了照資料', () => {
  it('預設值表', () => {
    expect(DEFAULT_SYNC).toEqual({ minion: 'standard', elite: 'deep', boss: 'shift' })
  })

  it('白蕾絲（雜兵）標準檔、粉精英深檔、閘門守衛（首領）shift：先開深檔、記 ext.net.shift', () => {
    const w = one('en_white')
    expect(w.ext.net).toMatchObject({ sync: 'standard', sync_max: 'standard' })
    expect((w.ext.net as Rec).shift).toBeUndefined()
    expect(w.tags).toContain('sync:standard')
    const e = one('en_pink_e')
    expect(e.ext.net).toMatchObject({ sync: 'deep', sync_max: 'deep' })
    expect(e.tags).toContain('sync:deep')
    const b = one('en_gate')
    expect(b.ext.net).toMatchObject({ sync: 'deep', sync_max: 'deep', shift: true })
    expect(b.tags).toContain('sync:deep')
  })

  it('資料寫的 sync 照資料：企業潛網者 full；寫 shift 的雜兵也會換', () => {
    const r = one('en_runner')
    expect(r.ext.net).toMatchObject({ sync: 'full', sync_max: 'full', admin: 2 })
    expect(r.tags).toContain('sync:full')
    const pack = (sync: string): ContentPack => ({ id: 'tmp', content: { ...PACK.content, enemy: [...ENEMIES, { ...base('en_tmp', 'minion', { constructs: [gun()], sync }) }] } }) as unknown as ContentPack
    const s = build(netSetup([foeRef('en_tmp')]), { pack: pack('shift') }).foe(1)
    expect(s.ext.net).toMatchObject({ sync: 'deep', shift: true })
    const sh = build(netSetup([foeRef('en_tmp')]), { pack: pack('shallow') }).foe(1)
    expect(sh.ext.net).toMatchObject({ sync: 'shallow', sync_max: 'shallow' })
    expect(sh.tags).toContain('sync:shallow')
  })

  it('裝了 netcombat：會換檔的首領在自己的回合開始時照感載換（不動它寫的 ext.net）', () => {
    const b = build(netSetup([foeRef('en_gate')]), { features: NETCOMBAT })
    const u = b.foe(1)
    expect(u.ext.net).toMatchObject({ sync: 'deep', sync_max: 'deep', shift: true, broken: [] })
    u.load!.now = Math.ceil(u.load!.max * 0.7)
    b.run.battle.turn = b.run.battle.order.indexOf(u.id)
    beginTurn(b.run, u)
    expect((u.ext.net as Rec).sync).toBe('shallow')
    expect(u.tags).toContain('sync:shallow')
  })
})

describe('標籤與 ext.net', () => {
  it('粉的有 lace、lace:pink、tether；黑的有 lace:black、沒有 tether；白的有 lace:white、沒有武器', () => {
    const p = one('en_pink_m')
    expect(p.tags).toEqual(expect.arrayContaining(['lace', 'lace:pink', 'tether']))
    const b = one('en_black')
    expect(b.tags).toEqual(expect.arrayContaining(['lace', 'lace:black']))
    expect(b.tags).not.toContain('tether')
    const w = one('en_white')
    expect(w.tags).toEqual(expect.arrayContaining(['lace', 'lace:white']))
    expect(w.tags).not.toContain('tether')
    expect(w.weapons).toEqual([])
    expect(w.pools.ram).toBeDefined()
    expect((w.ext.deck as Rec).constructs).toEqual([])
  })

  it('程式有 program 標籤；沒有 color 的不帶 lace:<色>', () => {
    const g = one('en_gate')
    expect(g.tags).toContain('program')
    expect(g.tags.some((t) => t.startsWith('lace:'))).toBe(false)
    expect(g.tags).not.toContain('lace')
  })

  it('企業潛網者（admin: 2）：admin、netrunner、tether、persona；ext.net.admin 是 2；沒有 lace 標籤；ext.deck 用資料寫的（槽與路數）加構裝', () => {
    const r = one('en_runner')
    expect(r.tags).toEqual(expect.arrayContaining(['admin', 'netrunner', 'tether', 'persona', 'human']))
    expect(r.tags).not.toContain('lace')
    expect((r.ext.net as Rec).admin).toBe(2)
    expect(r.ext.deck).toEqual({ grade: 3, firewall: 15, slots: ['qh_a'], tree: 'tr_x', constructs: [{ id: 'rush', class: 'weapon', grade: 3 }] })
    // 打法：資料沒寫 mode 也沒寫 ai.mode 的網內兵種是 neural
    expect(r.ai!.mode).toBe('neural')
  })

  it('沒有 admin 的人沒有 admin 與 netrunner 標籤，ext.net 沒有 admin', () => {
    const p = one('en_pink_e')
    expect(p.tags).not.toContain('admin')
    expect(p.tags).not.toContain('netrunner')
    expect((p.ext.net as Rec).admin).toBeUndefined()
    expect(p.tags).not.toContain('persona')
  })

  it('ai.mode 寫在 ai 裡的（ENEMIES 第 15 節的寫法）也認；lethal 的現實兵種進內海改看感載', () => {
    const both = build(netSetup([foeRef('en_both')])).foe(1)
    expect(both.ai!.mode).toBe('neural')
    const pack = (e: Rec): ContentPack => ({ id: 'tmp', content: { ...PACK.content, enemy: [...ENEMIES, e] } }) as unknown as ContentPack
    const u = build(netSetup([foeRef('en_tmp')]), { pack: pack(base('en_tmp', 'minion', { constructs: [gun()], ai: { focus: 1, flee_below: 0, mode: 'capture' } })) }).foe(1)
    expect(u.ai!.mode).toBe('capture')
  })

  it('UnitRef 的 color、layer 原樣放到 ext.enemies，不影響數字', () => {
    const plain = one('en_pink_e', 4)
    const marked = one('en_pink_e', 4, { color: 'pink', layer: 2 })
    expect((marked.ext.enemies as Rec).color).toBe('pink')
    expect((marked.ext.enemies as Rec).layer).toBe(2)
    expect({ ...marked, ext: undefined }).toEqual({ ...plain, ext: undefined })
  })

  it('ai.prefer_deep_sync 記在單位的 ai.ext', () => {
    expect(one('en_pink_m').ai!.ext).toEqual({ preferDeepSync: true })
    expect(one('en_black').ai!.ext).toBeUndefined()
  })
})

// ===================================================================================================================
// 二、放錯戰場
// ===================================================================================================================

describe('放錯戰場的兵種整步不成立（訊息寫出兵種與戰場）', () => {
  it('現實的兵種（沒有 constructs 的人）放進內海：開不起來，原因寫出是哪一個兵種', () => {
    const k = kernelOf()
    expect(() => setupBattle(k, makeState(), netSetup([foeRef('en_street')]))).toThrow(/街頭打手.*en_street.*內海/)
  })

  it('蕾絲與程式放進現實：開不起來，寫出兵種與戰場', () => {
    const k = kernelOf()
    expect(() => setupBattle(k, makeState(), meatSetup([foeRef('en_pink_m', { grade: 3 })]))).toThrow(/en_pink_m.*lace.*現實/)
    expect(() => setupBattle(k, makeState(), meatSetup([foeRef('en_gate')]))).toThrow(/en_gate.*program.*現實/)
    expect(() => setupBattle(k, makeState(), meatSetup([foeRef('en_white')]))).toThrow(/en_white/)
  })

  it('寫了 constructs 的現實兵種兩邊都進得去；現實那邊照舊（有生命、用 weapons、有束帶）', () => {
    const net = build(netSetup([foeRef('en_both')])).foe(1)
    expect(net.hp).toBeUndefined()
    expect(net.weapons.map((w) => w.id)).toEqual(['both'])
    const meat = build(meatSetup([foeRef('en_both')])).foe(1)
    expect(meat.hp).toBeDefined()
    expect(meat.weapons[0]!.class).toBe('pistol')
    expect(meat.tags).not.toContain('lace')
    expect(meat.pools).toEqual({})
  })

  it('沒給戰場的來源（ctx.mode 沒寫）是現實', () => {
    const k = kernelOf()
    const state = makeState()
    const src = k.battle.getUnitSource('enemy')!
    const ctx = { k, state, side: 'foe' as const, mode: undefined as unknown as string, grade: 2, allyCount: 4 }
    expect(() => src({ id: 'en_pink_m' }, ctx)).toThrow(/現實/)
    expect(src({ id: 'en_street' }, ctx).hp).toBeDefined()
  })
})

// ===================================================================================================================
// 三、enemy_pick
// ===================================================================================================================

describe('enemy_pick 照戰場與勢力挑兵種', () => {
  const k = kernelOf()
  const state = makeState()

  it('內海、勢力甲、精英 → 挑到勢力甲的粉精英', () => {
    const b = build(netSetup([pickRef({ faction: 'f_a', grade: 3, rank: 'elite' })]))
    expect(b.foe(1).enemy).toBe('en_pink_e')
    expect(b.foe(1).tags).toContain('lace:pink')
  })

  it('color: black 只挑黑的（首領）；挑到的單位帶 ext.enemies.color', () => {
    const b = build(netSetup([pickRef({ faction: 'f_a', grade: 4, rank: 'boss', color: 'black' })], 4))
    expect(b.foe(1).enemy).toBe('en_black')
    expect((b.foe(1).ext.enemies as Rec).color).toBe('black')
  })

  it('不寫 color：同勢力同位階所有網內的兵種都是候選（黑與閘門守衛）；寫了的只留那個顏色', () => {
    expect(pickCandidates(k, { faction: 'f_a', grade: 4, rank: 'boss', field: 'net' })).toEqual(['en_black', 'en_gate'])
    expect(pickCandidates(k, { faction: 'f_a', grade: 4, rank: 'boss', field: 'net', color: 'black' })).toEqual(['en_black'])
    expect(pickCandidates(k, { faction: 'f_a', grade: 1, rank: 'minion', field: 'net', color: 'white' })).toEqual(['en_white'])
    // 白蕾絲的顏色沒有首領
    expect(pickCandidates(k, { faction: 'f_a', grade: 4, rank: 'boss', field: 'net', color: 'white' })).toEqual([])
  })

  it('勢力乙沒有網內的兵種 → 挑到 none 的（乙有現實的兵種與一個兩棲的雜兵，位階精英時只剩 none 的野生粉蕾絲）', () => {
    const b = build(netSetup([pickRef({ faction: 'f_b', grade: 3, rank: 'elite' })]))
    expect(b.foe(1).enemy).toBe('en_wild')
    expect(pickCandidates(k, { faction: 'f_b', grade: 3, rank: 'elite', field: 'net' })).toEqual(['en_wild'])
  })

  it('寫了 constructs 的人也是候選（乙的雜兵 en_both）；勢力有就不退到 none', () => {
    expect(pickCandidates(k, { faction: 'f_b', grade: 1, rank: 'minion', field: 'net' })).toEqual(['en_both'])
  })

  it('都沒有丟錯，訊息寫出勢力、等級、位階與內海；pickProblems 先問得到', () => {
    const spec = { faction: 'f_b', grade: 3, rank: 'boss', field: 'net' } as const
    expect(() => pickEnemy(k, state, spec)).toThrow(/f_b.*等級 3.*首領.*內海/)
    expect(pickProblems(k, spec)[0]).toMatch(/挑不到敵人/)
    expect(pickProblems(k, { faction: 'f_a', grade: 3, rank: 'elite', field: 'net' })).toEqual([])
    // 顏色格式不對
    expect(pickProblems(k, { faction: 'f_a', grade: 3, rank: 'elite', field: 'net', color: 'red' as never })[0]).toMatch(/color/)
  })

  it('等級照現實的規則：範圍含這一級；都不含時挑範圍最近的（粉雜兵 2～4 級，放在 I 級與 V 級）', () => {
    const spec = { faction: 'f_a', grade: 1, rank: 'minion', field: 'net', color: 'pink' } as const
    expect(pickCandidates(k, spec)).toEqual(['en_pink_m'])
    expect(pickCandidates(k, { ...spec, grade: 5 })).toEqual(['en_pink_m'])
    // 粉雜兵的等級夾在它自己的範圍裡（2～4）：放在 I 級的場景，數值照 II 級；放在 V 級照 IV 級
    expect(build(netSetup([pickRef({ faction: 'f_a', grade: 1, rank: 'minion', color: 'pink' })], 1)).foe(1).grade).toBe(2)
    expect(build(netSetup([pickRef({ faction: 'f_a', grade: 5, rank: 'minion', color: 'pink' })], 5)).foe(1).grade).toBe(4)
  })

  it('現實的 enemy_pick 永遠挑不到蕾絲與程式（內海那邊有 en_white 等，現實那邊只有一般的雜兵）', () => {
    for (let i = 0; i < 12; i++) {
      const id = pickEnemy(k, state, { faction: 'f_a', grade: 3, rank: 'minion' }, `s${i}`)
      expect(id).toBe('en_grunt')
    }
    expect(pickCandidates(k, { faction: 'f_a', grade: 3, rank: 'boss' })).toEqual([])
    expect(pickCandidates(k, { faction: 'f_a', grade: 3, rank: 'elite' })).toEqual(['en_street'])
  })

  it('現實的戰鬥裡 enemy_pick 照舊：戰場是 meat 時挑一般的兵種', () => {
    const b = build(meatSetup([pickRef({ faction: 'f_a', grade: 3, rank: 'minion' })]))
    expect(b.foe(1).enemy).toBe('en_grunt')
    expect(b.foe(1).hp).toBeDefined()
  })

  it('同一個狀態、同一個 seed 挑到同一個', () => {
    const a = pickEnemy(k, state, { faction: 'f_a', grade: 2, rank: 'minion', field: 'net' }, 'z')
    const b = pickEnemy(k, state, { faction: 'f_a', grade: 2, rank: 'minion', field: 'net' }, 'z')
    expect(a).toBe(b)
  })
})

// ===================================================================================================================
// 四、難度與位階倍率
// ===================================================================================================================

describe('難度的係數乘在感載上限與造成的感載上；位階的傷害倍率在內海是 1', () => {
  const stateOf = (difficulty: 'hard' | 'story' | 'legend'): GameState => {
    const s = makeState()
    s.rules.difficulty = difficulty
    s.rules.enemyCoef = clone(DIFFICULTY_ENEMY_COEF[difficulty])
    return s
  }

  it('困難：粉雜兵（III 級）感載上限 × 係數、dmgMult.load 是係數；hp 是 1（內海沒有生命）', () => {
    const s = stateOf('hard')
    const c = enemyCoefFor(s.rules, 3, false)
    expect(c.load).toBeGreaterThan(1)
    const u = one('en_pink_m', 3, {}, s)
    expect(u.load!.max).toBe(Math.round(33 * 0.9 * c.load))
    expect(u.dmgMult).toEqual({ hp: 1, load: c.dmg })
  })

  it('首領照首領那一組係數；三種難度各不同', () => {
    for (const d of ['story', 'hard', 'legend'] as const) {
      const s = stateOf(d)
      const c = enemyCoefFor(s.rules, 4, true)
      const u = one('en_gate', 4, {}, s)
      expect(u.load!.max, d).toBe(Math.round(94 * c.load))
      expect(u.dmgMult.load, d).toBe(c.dmg)
    }
  })

  it('位階（雜兵、精英、首領）不改變 dmgMult：普通難度下每一位階的 load 倍率都是 1、hp 倍率都是 1', () => {
    for (const id of ['en_white', 'en_pink_e', 'en_gate']) expect(one(id).dmgMult, id).toEqual({ hp: 1, load: 1 })
  })

  it('強度係數（strength）乘在造成的感載上，不乘感載上限（精英，我方 4 人以上）', () => {
    const u = one('en_pink_e', 3, { strength: 1.5 })
    expect(u.dmgMult.load).toBe(1.5)
    expect(u.load!.max).toBe(55)
  })
})

// ===================================================================================================================
// 五、AI 的參數
// ===================================================================================================================

describe('AI：偏好深檔的人（ai.prefer_deep_sync）', () => {
  /** 兩個我方的化身站在不同的檔位上：問 ai_target_pct。 */
  function pct(foeId: string, gear: string, battle = 'a1'): number {
    const b = build(netSetup([foeRef(foeId)]))
    const target = b.run.battle.units[battle]!
    target.tags = [...target.tags.filter((t) => !t.startsWith('sync:')), `sync:${gear}`]
    return b.run.mods('ai_target_pct', target, b.foe(1)).reduce((s, p) => s + p.value, 0)
  }

  it('深檔 +50、全檔 +100，淺與標準不加', () => {
    expect(DEEP_SYNC_PCT).toEqual({ deep: 50, full: 100 })
    expect(pct('en_pink_m', 'deep')).toBe(50)
    expect(pct('en_pink_m', 'full')).toBe(100)
    expect(pct('en_pink_m', 'standard')).toBe(0)
    expect(pct('en_pink_m', 'shallow')).toBe(0)
  })

  it('沒寫 prefer_deep_sync 的敵人不看檔位（黑蕾絲）', () => {
    expect(pct('en_black', 'full')).toBe(0)
  })

  it('現實的戰場不看檔位', () => {
    const b = build(meatSetup([foeRef('en_both')]))
    const t = b.run.battle.units.a1!
    t.tags = [...t.tags, 'sync:full']
    expect(b.run.mods('ai_target_pct', t, b.foe(1)).reduce((s, p) => s + p.value, 0)).toBe(0)
  })

  it('AI 真的比較常挑深檔的人：開同樣的場，深檔那一個被挑的次數明顯比較多', () => {
    const b = build(netSetup([foeRef('en_pink_m')], 3))
    const [x, y] = [b.run.battle.units.a1!, b.run.battle.units.a2!]
    y.tags = [...y.tags.filter((t) => !t.startsWith('sync:')), 'sync:full']
    const wx = b.run.mods('ai_target_pct', x, b.foe(1)).reduce((s, p) => s + p.value, 0)
    const wy = b.run.mods('ai_target_pct', y, b.foe(1)).reduce((s, p) => s + p.value, 0)
    expect(wy - wx).toBe(100)
  })
})

describe('白蕾絲：追蹤度到 60 以上，自己的回合開始就撤走', () => {
  function whiteAt(trace: number | undefined): { out: string | undefined; u: BattleUnit } {
    const b = build(netSetup([foeRef('en_white'), foeRef('en_pink_e')], 3))
    if (trace !== undefined) b.run.battle.field.trace = trace
    const w = b.foe(1)
    b.run.battle.turn = b.run.battle.order.indexOf(w.id)
    beginTurn(b.run, w)
    return { out: w.out, u: w }
  }

  it('常數是 60', () => {
    expect(WHITE_LEAVES_AT).toBe(60)
  })

  it('追蹤度 60：撤走（fled）；59：不撤；沒有追蹤度的戰鬥：不撤', () => {
    expect(whiteAt(60).out).toBe('fled')
    expect(whiteAt(75).out).toBe('fled')
    expect(whiteAt(59).out).toBeUndefined()
    expect(whiteAt(undefined).out).toBeUndefined()
  })

  it('別的蕾絲不撤（粉精英在追蹤度 100 的時候照樣留下）', () => {
    const b = build(netSetup([foeRef('en_white'), foeRef('en_pink_e')], 3))
    b.run.battle.field.trace = 100
    const p = b.foe(2)
    b.run.battle.turn = b.run.battle.order.indexOf(p.id)
    beginTurn(b.run, p)
    expect(p.out).toBeUndefined()
  })

  it('撤走留一拍紀錄，白蕾絲退出（fled）後不算掉落', () => {
    const b = build(netSetup([foeRef('en_white')], 3))
    b.run.battle.field.trace = 80
    const w = b.foe(1)
    b.run.battle.turn = b.run.battle.order.indexOf(w.id)
    beginTurn(b.run, w)
    expect(b.run.beats.some((x) => x.tag === 'flee')).toBe(true)
  })
})

describe('內海的士氣：沒有生命比例的觸發（flee_below 不用），失敗一律撤退（fled），沒有投降', () => {
  it('企業潛網者（flee_below 0.3）感載快滿了也不因此檢定', () => {
    const b = build(netSetup([foeRef('en_runner')], 3))
    const u = b.foe(1)
    u.load!.now = Math.ceil(u.load!.max * 0.95)
    b.run.roll = (n) => Array.from({ length: n }, () => 1)
    b.k.battle.emit('ai.step', { run: b.run, unit: u })
    expect(u.out).toBeUndefined()
    expect(u.uses.morale).toBeUndefined()
  })

  it('同伴倒了一半（雜兵）：檢定失敗是 fled，不是 surrendered，也不看第 4 格與人數', () => {
    const b = build(netSetup([foeRef('en_pink_m'), foeRef('en_pink_m')], 3))
    const [a, c] = [b.foe(1), b.foe(2)]
    b.run.setOut(a, 'down')
    // 對方站著的人數是自己這一方的兩倍以上、站在第 4 格：現實會投降，內海一律撤退
    c.slot = 4
    b.run.roll = (n) => Array.from({ length: n }, () => 1)
    b.k.battle.emit('ai.step', { run: b.run, unit: c })
    expect(c.uses.morale).toBe(1)
    expect(c.out).toBe('fled')
  })

  it('首領（never_flee）不檢定', () => {
    const b = build(netSetup([foeRef('en_gate'), foeRef('en_pink_m')], 3))
    b.run.setOut(b.foe(2), 'down')
    b.k.battle.emit('ai.step', { run: b.run, unit: b.foe(1) })
    expect(b.foe(1).out).toBeUndefined()
  })
})

// ===================================================================================================================
// 六、掉落（N20）
// ===================================================================================================================

interface Fight {
  seed?: number
  grade?: number
  /** 我方第幾個帶 dissect 標籤（預設都沒有） */
  dissect?: number[]
  /** 我方第幾個沒有倒下之外退出（預設都還站著） */
  outs?: Record<number, string>
  outcome?: string
  pack?: ContentPack
  foeOut?: string
}

/** 一場內海：我方四個化身對給的敵人，照設定把敵人設成倒下、分出結果、結算。回傳 battle.end 報告的變更。 */
async function fight(ids: string[], o: Fight = {}) {
  const grade = o.grade ?? 3
  const setup = netSetup(ids.map((id) => foeRef(id)), grade)
  setup.allies = [0, 1, 2, 3].map((i) => raw(netAvatar(i, grade as 3, { tags: ['netrunner', ...(o.dissect?.includes(i) ? ['dissect'] : [])] })))
  const test = makeBattleGame({ features: FEATURES, content: [o.pack ?? PACK], seed: o.seed ?? 5, battle: setup })
  const game = test.game
  const units = Object.values(game.state.battle!.units)
  for (const u of units) {
    if (u.side === 'foe') u.out = o.foeOut ?? 'down'
  }
  for (const [i, how] of Object.entries(o.outs ?? {})) game.state.battle!.units[`a${Number(i) + 1}`]!.out = how
  game.state.battle!.result = { outcome: o.outcome ?? 'win', text: '打完了。' }
  const { result, violations } = await observed(game, () => game.finishBattle())
  expect(violations).toEqual([])
  const report = result.reports.find((r) => r.action === 'battle.end')!
  const changes = report.changes as Array<{ op: string; id?: string; qty?: number; delta?: number }>
  return {
    game, items: changes.filter((c) => c.op === 'item').map((c) => [c.id, c.qty] as [string, number]),
    cash: changes.filter((c) => c.op === 'cash').map((c) => c.delta as number), lines: report.narration?.results ?? [],
  }
}

describe('內海打贏之後的掉落：不掉現金與零件，只有解剖拿得到的構裝與憑證', () => {
  it('寫了現金（cash: true）的兵種在內海沒有掉現金；item 的項目（零件）不擲', async () => {
    const r = await fight(['en_loot'], { dissect: [0] })
    expect(r.cash).toEqual([])
    expect(r.items.map(([id]) => id)).not.toContain('it_part')
  })

  it('needs: dissect 的構裝與憑證：隊上沒有人帶 dissect 標籤時不掉', async () => {
    const r = await fight(['en_loot'])
    expect(r.items).toEqual([])
    expect(r.lines).toEqual([])
  })

  it('有人帶 dissect 而且沒倒下：掉指名的構裝與憑證（憑證是規則表指的那件物品）', async () => {
    const r = await fight(['en_loot'], { dissect: [1] })
    // 雜兵上限 1 件：項目順序是構裝、憑證，第一個擲中的先收
    expect(r.items).toEqual([['cs_w1', 1]])
    const two = await fight(['en_loot', 'en_loot'], { dissect: [1] })
    expect(two.items).toEqual([['cs_w1', 2]])
  })

  it('帶 dissect 的人倒下、被釘住或拔線離開了：不算有人會解剖', async () => {
    for (const how of ['down', 'pinned', 'burnout', 'jacked_out']) {
      const r = await fight(['en_loot'], { dissect: [0], outs: { 0: how } })
      expect(r.items, how).toEqual([])
    }
    // 另一個人帶著、還站著：照掉
    const ok = await fight(['en_loot'], { dissect: [0, 2], outs: { 0: 'down' } })
    expect(ok.items).toEqual([['cs_w1', 1]])
  })

  it('沒寫 needs 的構裝：不用解剖也掉', async () => {
    const r = await fight(['en_loot_free'])
    expect(r.items).toEqual([['cs_w1', 1]])
    expect(r.cash).toEqual([])
  })

  it('憑證：精英可以掉兩件，拿到的是規則表指的物品；沒有規則表或內容裡沒有那個物品時略過', async () => {
    const pack: ContentPack = { id: 'tmp', content: { ...PACK.content, enemy: [...ENEMIES, base('en_cred', 'elite', { color: 'pink', constructs: [gun('cr')], loot: [{ credential: true, chance: 1, needs: 'dissect' }, { construct: 'cs_w1', chance: 1 }] })] } } as unknown as ContentPack
    const r = await fight(['en_cred'], { dissect: [0], pack })
    expect(r.items).toEqual([['it_cred', 1], ['cs_w1', 1]])
    const bare: ContentPack = { ...BARE, content: { ...BARE.content, enemy: [base('en_cred', 'elite', { color: 'pink', constructs: [gun('cr')], loot: [{ credential: true, chance: 1, needs: 'dissect' }] })] } } as unknown as ContentPack
    const none = await fight(['en_cred'], { dissect: [0], pack: bare })
    expect(none.items).toEqual([])
  })

  it('構裝: random：從內容的構裝挑等級不超過這個敵人、類別是武器、防護或工具的一件；駭入程式不掉', async () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const r = await fight(['en_loot_rand'], { dissect: [0], grade: 1, seed })
      expect(r.items).toHaveLength(1)
      seen.add(r.items[0]![0])
    }
    expect([...seen].sort()).toEqual(['cs_tool1', 'cs_w1'])
    const high = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) high.add((await fight(['en_loot_rand'], { dissect: [0], grade: 3, seed })).items[0]![0])
    expect([...high].sort()).toEqual(['cs_def2', 'cs_tool1', 'cs_w1', 'cs_w3'])
  })

  it('構裝: random 在沒有人定義 construct 的遊戲裡略過（不丟錯）', async () => {
    const pack: ContentPack = { id: 'tmp', content: { skill: SKILLS, weapon_class: WEAPON_CLASSES, item: [item('it_part', '零件')], enemy: [base('en_loot_rand', 'minion', { faction: 'none', color: 'pink', constructs: [gun('lr')], loot: [{ construct: 'random', chance: 1, needs: 'dissect' }] })] } } as unknown as ContentPack
    const test = makeBattleGame({ features: [enemiesFeature, TEST_NET_COMBAT], content: [pack], battle: { ...netSetup([foeRef('en_loot_rand')]), allies: [raw(netAvatar(0, 3, { tags: ['dissect'] }))] } })
    const g = test.game
    for (const u of Object.values(g.state.battle!.units)) if (u.side === 'foe') u.out = 'down'
    g.state.battle!.result = { outcome: 'win', text: '' }
    const res = await g.finishBattle()
    expect(res.reports.find((r) => r.action === 'battle.end')!.changes.filter((c) => c.op === 'item')).toEqual([])
  })

  it('照機率（固定種子）：同一個種子結果一樣；有解剖時 0.5 的構裝有時掉有時不掉，沒有解剖一律不掉', async () => {
    const a = await fight(['en_loot_coin'], { dissect: [0], seed: 11 })
    const b = await fight(['en_loot_coin'], { dissect: [0], seed: 11 })
    expect(a.items).toEqual(b.items)
    let hit = 0
    let none = 0
    for (let seed = 1; seed <= 40; seed++) {
      if ((await fight(['en_loot_coin'], { dissect: [0], seed })).items.length) hit++
      none += (await fight(['en_loot_coin'], { seed })).items.length
    }
    expect(hit).toBeGreaterThan(8)
    expect(hit).toBeLessThan(32)
    expect(none).toBe(0)
  })

  it('內海沒有件數的下限：精英沒擲中就沒有（現實的精英至少 1 件）', async () => {
    const r = await fight(['en_loot_elite'], { dissect: [0] })
    expect(r.items).toEqual([])
  })

  it('白蕾絲撤走（fled）、輸了、投降的我方：沒有掉落（只有打贏、而且是被打倒的才算）', async () => {
    const fled = await fight(['en_loot_free'], { foeOut: 'fled' })
    expect(fled.items).toEqual([])
    const lost = await fight(['en_loot_free'], { outcome: 'lose' })
    expect(lost.items).toEqual([])
  })

  it('現實的戰鬥：憑證與零件、現金照舊（企業的人身上有憑證）；內海那一側的規則不影響現實', async () => {
    const test = makeBattleGame({ features: [enemiesFeature, TEST_NET_COMBAT, deckFeature], content: [PACK], battle: { mode: 'meat', grade: 3, cover: 'medium', allies: [raw(netAvatar(0, 3))], foes: [foeRef('en_corp')] } as BattleSetup })
    const g = test.game
    for (const u of Object.values(g.state.battle!.units)) if (u.side === 'foe') u.out = 'down'
    g.state.battle!.result = { outcome: 'win', text: '' }
    const res = await g.finishBattle()
    const items = res.reports.find((r) => r.action === 'battle.end')!.changes.filter((c) => c.op === 'item') as unknown as Array<{ id: string; qty: number }>
    expect(items.map((c) => c.id).sort()).toEqual(['it_cred', 'it_part'])
  })
})

describe('掉落的格式（loot）', () => {
  it('新的兩種項目合格；needs 只收 dissect；兩種項目不寫 qty 與 top；一筆只能是一種', () => {
    expect(lootProblems({ loot: [{ construct: 'random', chance: 0.4, needs: 'dissect' }, { construct: 'cs_a', chance: 1 }, { credential: true, chance: 0.2, needs: 'dissect' }, { item: 'a', chance: 1, needs: 'dissect' }] })).toEqual([])
    expect(lootProblems({ loot: [{ construct: 'x', chance: 1, needs: 'cut' }] })[0]).toMatch(/needs 只能是 'dissect'/)
    expect(lootProblems({ loot: [{ credential: false, chance: 1 }] })[0]).toMatch(/credential 只能寫 true/)
    expect(lootProblems({ loot: [{ construct: 'x', chance: 2 }] })[0]).toMatch(/chance/)
    expect(lootProblems({ loot: [{ construct: 'x', chance: 1, qty: 2 }] })[0]).toMatch(/qty/)
    expect(lootProblems({ loot: [{ construct: 'x', item: 'y', chance: 1 }] })[0]).toMatch(/只能寫/)
    expect(lootProblems({ loot: [{ chance: 1 }] })[0]).toMatch(/item/)
  })

  it('引用：指名的構裝要查得到（沒有人定義 construct 這個種類時不查）；random 與憑證不查', () => {
    const e = { loot: [{ construct: 'cs_a', chance: 1 }, { construct: 'random', chance: 1 }, { credential: true, chance: 1 }, { item: 'x', chance: 1 }] }
    expect(lootRefs({ has: () => false, hasKind: () => true }, e)).toEqual([['item', 'x'], ['construct', 'cs_a']])
    expect(lootRefs({ has: () => false, hasKind: () => false }, e)).toEqual([['item', 'x']])
  })

  it('載入時：指名的構裝不存在擋下；內容裡有就過', () => {
    const k = createKernel(FEATURES)
    const bad = { ...PACK, content: { ...PACK.content, enemy: [base('en_bad', 'minion', { constructs: [gun()], loot: [{ construct: 'cs_nope', chance: 1 }] })] } } as unknown as ContentPack
    k.content.loadPack(bad)
    expect(k.content.checkRefs().join('\n')).toContain('construct/cs_nope')
    const k2 = createKernel(FEATURES)
    k2.content.loadPack(PACK)
    expect(k2.content.checkRefs()).toEqual([])
  })

  it('規則表 credential_item：載得進來、取代、物品不存在被擋；credentialItem 內容裡沒有時是 undefined', () => {
    const k = kernelOf()
    expect(credentialItem(k.content)).toBe('it_cred')
    const k2 = kernelOf(BARE)
    expect(credentialItem(k2.content)).toBeUndefined()
    const k3 = createKernel(FEATURES)
    k3.content.loadPack({ id: 'tmp', content: { ...PACK.content, net_enemy_rule: [{ id: 'default', credential_item: 'it_missing' }] } } as unknown as ContentPack)
    expect(k3.content.checkRefs().join('\n')).toContain('it_missing')
    expect(k.content.validate('net_enemy_rule', [{ id: 'default', foo: 1 }])[0]).toMatch(/foo/)
  })
})

// ===================================================================================================================
// 七、資料格式
// ===================================================================================================================

describe('敵人資料的格式：內海的欄位', () => {
  const check = (e: Rec) => kernelOf().content.validate('enemy', [{ ...base('en_chk', 'minion', { constructs: [gun()] }), ...e }])
  const bad = (e: Rec, re: RegExp) => expect(check(e).join('\n')).toMatch(re)

  it('第 15 節的樣本（constructs 與 ai.mode、沒有 weapons 與頂層 mode）合格', () => {
    expect(check({})).toEqual([])
    expect(check({ ai: { focus: 1, prefer: 'overloaded', mode: 'capture', flee_below: 0, prefer_deep_sync: true } })).toEqual([])
  })

  it('constructs 的每個欄位：id、class、type、ram、range、traits、不認得的鍵、重複的 id', () => {
    bad({ constructs: 'x' }, /constructs 要是陣列/)
    bad({ constructs: [{ class: 'smg' }] }, /constructs\[0\]\.id/)
    bad({ constructs: [{ id: 'a' }] }, /constructs\[0\]\.class/)
    bad({ constructs: [{ id: 'a', class: 'smg', type: 'sonic' }] }, /type 只能是/)
    bad({ constructs: [{ id: 'a', class: 'smg', ram: 0 }] }, /ram 要是 1～6/)
    bad({ constructs: [{ id: 'a', class: 'smg', range: [3, 1] }] }, /range/)
    bad({ constructs: [{ id: 'a', class: 'smg', traits: [1] }] }, /traits/)
    bad({ constructs: [{ id: 'a', class: 'smg', dice: 4 }] }, /dice 不是可以用的鍵/)
    bad({ constructs: [gun('a'), gun('a')] }, /重複/)
    // class 查不到武器類型：引用檢查擋（不在格式檢查裡）
    const k = createKernel(FEATURES)
    k.content.loadPack({ id: 'tmp', content: { skill: SKILLS, weapon_class: WEAPON_CLASSES, enemy: [base('en_chk', 'minion', { constructs: [{ id: 'a', class: 'nope' }] })] } } as unknown as ContentPack)
    expect(k.content.checkRefs().join('\n')).toContain('weapon_class/nope')
  })

  it('sync、color、admin、persona、mods.guard、mods.ram、ai.prefer_deep_sync', () => {
    bad({ sync: 'turbo' }, /sync 只能是/)
    expect(check({ sync: 'shift' })).toEqual([])
    bad({ color: 'red' }, /color 只能是/)
    bad({ kind: 'human', color: 'pink' }, /color 只有 kind 是 'lace'/)
    bad({ admin: 0 }, /admin 要是 1～6/)
    bad({ persona: 'yes' }, /persona/)
    bad({ mods: { guard: 1.5 } }, /mods\.guard 要是整數/)
    bad({ mods: { ram: 'a' } }, /mods\.ram/)
    bad({ mods: { shield: 1 } }, /不是可以修正的鍵/)
    expect(check({ mods: { guard: -1, ram: 2 } })).toEqual([])
    bad({ ai: { focus: 1, flee_below: 0, prefer_deep_sync: 'yes' } }, /prefer_deep_sync/)
    bad({ ai: { focus: 1, flee_below: 0, mode: 'sonic' } }, /ai\.mode/)
  })

  it('現實的兵種照舊要有 weapons 與 mode；沒有 constructs 的蕾絲也可以沒有 weapons（白蕾絲）', () => {
    const k = kernelOf()
    const meat = { id: 'en_x', name: 'x', desc: 'x。', faction: 'f_a', rank: 'minion', grades: [1, 5], kind: 'human', position: { prefer: [1] }, ai: { focus: 1, flee_below: 0 } }
    expect(k.content.validate('enemy', [meat]).join('\n')).toMatch(/要有 mode/)
    expect(k.content.validate('enemy', [meat]).join('\n')).toMatch(/要有 weapons/)
    const white = base('en_x', 'minion', { color: 'white' })
    expect(k.content.validate('enemy', [white])).toEqual([])
  })
})

// ===================================================================================================================
// 八、遭遇
// ===================================================================================================================

describe('遭遇', () => {
  const pack: ContentPack = {
    id: 'tmp',
    content: { ...PACK.content, encounter: [{ id: 'enc_net', name: '子網的一層', grade: 3, cover: 'medium', foes: [{ enemy: 'en_white' }, { enemy: 'en_pink_m' }, { enemy: 'en_pink_e' }, { enemy: 'en_gate' }] }] },
  } as unknown as ContentPack
  it('setupFromEncounter 可以指定內海的戰場；組出來的設定開得起來', () => {
    const k = kernelOf(pack)
    const state = makeState()
    const setup = setupFromEncounter(k, state, 'enc_net', { allies: allies(3), mode: 'net' })
    expect(setup.mode).toBe('net')
    const run = setupBattle(k, state, setup)
    expect(Object.values(run.battle.units).filter((u) => u.side === 'foe').map((u) => u.enemy)).toEqual(['en_white', 'en_pink_m', 'en_pink_e', 'en_gate'])
    // 不指定還是現實：蕾絲放不進去
    expect(() => setupBattle(k, makeState(), setupFromEncounter(k, state, 'enc_net', { allies: [raw(netAvatar(0, 3))] }))).toThrow(/現實/)
  })

  it('遭遇的點數內海照同一套：蕾絲照位階算點（雜兵 1、精英 2.5、首領 5）', () => {
    const k = kernelOf(pack)
    expect(encounterPoints(k, [{ enemy: 'en_white' }, { enemy: 'en_pink_m' }, { enemy: 'en_pink_e' }, { enemy: 'en_gate' }], 3)).toBe(1 + 1 + 2.5 + 5)
    // 高一級以上 ×1.75
    expect(encounterPoints(k, [{ enemy: 'en_pink_e', grade: 4 }], 3)).toBe(2.5 * 1.75)
  })
})

// ===================================================================================================================
// 九、整場
// ===================================================================================================================

describe('四個化身對這六種各打完一場：不丟錯、不變式沒有違規', () => {
  const SIX = ['en_white', 'en_pink_m', 'en_pink_e', 'en_black', 'en_gate', 'en_runner']

  for (const [label, features] of [['TEST_NET_COMBAT', FEATURES], ['features/netcombat', NETCOMBAT]] as Array<[string, Feature[]]>) {
    for (const id of SIX) {
      it(`${label}：${id}（最低與最高一級）`, async () => {
        // 兵種出現的最低與最高一級各打一場（我方的化身同級）
        const range = (ENEMIES.find((e) => e.id === id) as Rec).grades as [number, number]
        for (const grade of range) {
          const setup = netSetup([foeRef(id)], grade)
          const test = makeBattleGame({ features, content: [PACK], seed: 9 + grade, battle: setup })
          const { result, violations } = await observed(test.game, () => {
            const out = playOut(test.game, 3000)
            return out
          })
          expect(violations).toEqual([])
          expect(['win', 'lose', 'jack_out', 'fled']).toContain(result.outcome)
          const end = await observed(test.game, () => test.game.finishBattle())
          expect(end.violations).toEqual([])
        }
      }, 120_000)
    }
  }

  it('混編（六種一起）也打得完', async () => {
    const setup = netSetup(SIX.slice(0, 4).map((id) => foeRef(id)), 4)
    const test = makeBattleGame({ features: NETCOMBAT, content: [PACK], seed: 21, battle: setup })
    const { violations } = await observed(test.game, () => playOut(test.game, 3000))
    expect(violations).toEqual([])
  })
})

// ===================================================================================================================
// 十、現實的敵人原樣
// ===================================================================================================================

describe('現實的單位怎麼組一行都沒動', () => {
  it('現實的 III 級雜兵：生命、護甲、迴避、骰數、傷害倍率照現實的表', () => {
    const u = build(meatSetup([foeRef('en_grunt')], 3)).foe(1)
    expect(u.hp).toEqual({ now: 67, max: 67 })
    expect(u.armor).toBe(3)
    expect(u.evade).toBe(14)
    expect(u.load!.max).toBe(33)
    expect(u.weapons[0]!.dice).toBe(3 + 1)
    expect(u.dmgMult).toEqual({ hp: 0.4, load: 1 })
    expect(u.pools).toEqual({})
  })
})
