// 白箱測試：features/enemies（敵人與遭遇的資料、單位的數字、遭遇的點數與開打設定、士氣的守門條件）。
// 補主套件沒有走到的分支：內容格式的每一個欄位、base 的展開錯誤、強度係數與對決的各列、武器的各種覆寫、遭遇的各個欄位。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, GameState, UnitRef } from '../../src'
import { createKernel } from '../../src'
import { ENCOUNTER_BUDGET, ENEMY_CURVE, encounterPoints, enemiesFeature, enemyStats, setupFromEncounter } from '../../src/features/enemies'
import { enemyUnit } from '../../src/features/enemies/stats'
import { mergeBase, resolveEnemy } from '../../src/features/enemies/kinds'
import { TEST_COMBAT, makeBattleGame, makeState } from '../../src/testkit'
import { arena, duel, one } from '../helpers/battle'

const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 1, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'stun', name: '電擊', dice: 3, type: 'neural', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
  { id: 'shotgun', name: '霰彈槍', dice: 5, far: { beyond: 2, dice: 3 }, type: 'physical', range: [1, 3], mag: 2, cover_mult: 1.5, pierce: 0, traits: ['push'], attr: 'reflex', skill: 'firearms' },
]
const ENEMY = {
  id: 'en_ok', name: '測試兵', desc: '測試用的敵人。', faction: 'none', rank: 'minion', grades: [1, 3], kind: 'human',
  position: { prefer: [1] }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.3 },
}
const ENC = { id: 'enc_ok', name: '測試遭遇', grade: 2, cover: 'medium', foes: [{ enemy: 'en_mook' }] }
const mk = (id: string, rank: string, more: Record<string, unknown> = {}) => ({ ...ENEMY, id, rank, ...more })
const PACK: ContentPack = {
  id: 'e', content: {
    skill: ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` })),
    faction: [{ id: 'hz', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'ed', name: '伊甸園', short: '伊甸', class: 'corp' }],
    item: [{ id: 'x', name: 'x', desc: 'x。', category: 'consumable', grade: 1, size: 1, legal: 'free' }],
    weapon_class: WEAPONS,
    enemy: [
      mk('en_mook', 'minion'), mk('en_elite', 'elite', { faction: 'hz', grades: [2, 4] }), mk('en_boss', 'boss', { faction: 'ed', grades: [3, 5] }),
      mk('en_cap', 'minion', { mode: 'capture', weapons: [{ class: 'stun' }] }),
      mk('en_neural', 'elite', { mode: 'neural', weapons: [{ class: 'stun', type: 'pleasure' }] }),
      mk('en_robot', 'minion', { kind: 'machine', mods: { hp: 0.5, armor: 2, evade: -1, attack: 1, ap: 1, layers: -9, sensitivity: 80 } }),
      mk('en_gunless', 'minion', { weapons: [] }),
      mk('en_tuned', 'minion', { weapons: [{ class: 'shotgun', name: '改裝霰彈', type: 'thermal', traits: ['melee', 'push'], pierce: 4, range: [2, 6], mag: 4 }], skills: { composure: 3 }, attrs: { reflex: 14 }, traits: ['contract', 'night_vision'], quick: [{ item: 'x', qty: 2 }] }),
      mk('en_named', 'elite', { named: true, grades: [1, 5] }),
      mk('en_cheap', 'elite', { strength: 0.5, grades: [1, 5] }),
    ],
    encounter: [
      ENC,
      { id: 'enc_tie', name: '同位階', grade: 2, cover: 'dense', foes: [{ enemy: 'en_elite' }, { enemy: 'en_cheap' }, { enemy: 'en_mook' }] },
      { id: 'enc_boss', name: '有首領', grade: 3, cover: 'sparse', escapable: false, ambush: 'ally', field: { dark: true }, nodes: [{ kind: 'light' }], foes: [{ enemy: 'en_mook', slot: 3 }, { enemy: 'en_boss', grade: 4, strength: 1.2 }] },
      { id: 'enc_none', name: '沒有勢力', grade: 1, cover: 'one_sided', foes: [{ enemy: 'en_mook' }] },
    ],
  },
}
const kernel = (...packs: ContentPack[]) => {
  const k = createKernel([enemiesFeature, TEST_COMBAT])
  k.content.loadPack(PACK)
  for (const p of packs) k.content.loadPack(p)
  return k
}
const problems = (kind: 'enemy' | 'encounter', e: Record<string, unknown>): string => createKernel([enemiesFeature]).content.validate(kind, [e]).join('\n')
const edit = (kind: 'enemy' | 'encounter', base: Record<string, unknown>, field: string, value: unknown): string => {
  const e = { ...base, [field]: value }
  if (value === undefined) delete e[field]
  return problems(kind, e)
}

describe('白箱 enemy 的格式（ENEMIES 第 2 節；dev/work/M1-enemies.md 第三節）', () => {
  it('合格的樣本收得進來（沒有武器、沒有 prefer 也行）', () => {
    expect(problems('enemy', ENEMY)).toBe('')
    expect(problems('enemy', { ...ENEMY, weapons: [], ai: { focus: 0, flee_below: 0 } })).toBe('')
  })

  it.each([
    ['name', undefined, /要有 name/],
    ['name', '', /name 要是名字/],
    ['desc', undefined, /要有 desc/],
    ['faction', undefined, /要有 faction/],
    ['branch', 3, /branch 要是字串/],
    ['rank', 'god', /rank 只能是/],
    ['grades', [0, 3], /grades 要是/],
    ['grades', [1, 6], /grades 要是/],
    ['grades', [2, 1], /grades 要是/],
    ['grades', [1], /grades 要是/],
    ['kind', 'ghost', /kind 只能是/],
    ['mode', 'peaceful', /mode 只能是 lethal、neural、capture/],
    ['position', undefined, /要有 position/],
    ['position', { prefer: [1], cover_use: 2 }, /position\.cover_use 要是 0～1 的數字/],
    ['position', { prefer: [0] }, /position\.prefer 要是至少一個 1～4 的整數/],
    ['weapons', undefined, /要有 weapons/],
    ['weapons', ['x'], /weapons\[0\] 要是物件/],
    ['weapons', [{ class: '' }], /weapons\[0\]\.class 要是武器類型的 id/],
    ['weapons', [{ class: 'pistol', name: '' }], /weapons\[0\]\.name 要是名字/],
    ['weapons', [{ class: 'pistol', type: 'acid' }], /weapons\[0\]\.type 只能是/],
    ['weapons', [{ class: 'pistol', traits: 'x' }], /weapons\[0\]\.traits 要是字串的陣列/],
    ['weapons', [{ class: 'pistol', pierce: -1 }], /weapons\[0\]\.pierce 要是 0 以上的整數/],
    ['weapons', [{ class: 'pistol', range: [4, 1] }], /weapons\[0\]\.range 要是 \[近, 遠\]/],
    ['weapons', [{ class: 'pistol', range: [1, 8] }], /weapons\[0\]\.range 要是 \[近, 遠\]/],
    ['weapons', [{ class: 'pistol', mag: 5 }], /weapons\[0\]\.mag 要是 1～4/],
    ['ai', undefined, /要有 ai/],
    ['ai', { focus: 'x', flee_below: 0.3 }, /ai\.focus 要是數字/],
    ['ai', { focus: 1, flee_below: 2 }, /ai\.flee_below 要是 0～1 的數字/],
    ['ai', { focus: 1, flee_below: 0.3, prefer: 'random' }, /ai\.prefer 只能是/],
    ['ai', { focus: 1, flee_below: 0.3, floor: 'x' }, /ai\.floor 要是數字/],
    ['ai', { focus: 1, flee_below: 0.3, never_flee: 'yes' }, /ai\.never_flee 要是 true 或 false/],
    ['mods', 'x', /mods 要是物件/],
    ['mods', { hp: 3 }, /mods\.hp 要是 0\.5～1\.5 的倍數/],
    ['mods', { load: 0.1 }, /mods\.load 要是 0\.5～1\.5 的倍數/],
    ['mods', { armor: 1.5 }, /mods\.armor 要是整數/],
    ['mods', { layers: 'x' }, /mods\.layers 要是整數/],
    ['mods', { sensitivity: 101 }, /mods\.sensitivity 要是 0～100/],
    ['mods', { luck: 1 }, /mods\.luck 不是可以修正的鍵/],
    ['attrs', 'x', /attrs 要是物件/],
    ['attrs', { luck: 10 }, /attrs\.luck 不是屬性的 id/],
    ['attrs', { body: 'x' }, /attrs\.body 要是數字/],
    ['skills', { composure: 'x' }, /skills\.composure 要是數字/],
    ['quick', [{ item: 'x', qty: 0 }], /quick 要是 \[\{ item, qty \}\]/],
    ['quick', 'x', /quick 要是/],
    ['named', 'yes', /named 要是 true 或 false/],
    ['base', '', /base 要是制式兵種的 id/],
    ['strength', 0, /強度係數）要是 0 到 2 之間的數字/],
    ['strength', 3.5, /強度係數）要是 0 到 2 之間的數字/],
    ['defeat', 3, /defeat 要是字串/],
    ['adult', 'x', /adult 要是字串的陣列或 null/],
    ['signature', 'x', /signature 要是陣列/],
    ['loot', 'x', /loot 要是陣列/],
    ['traits', [3], /traits 要是字串的陣列/],
    ['angel', 3, /angel 要是字串/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('enemy', ENEMY, field, value as unknown)).toMatch(re)
  })

  it('合格的選填欄位：adult 可以是 null、traits 與 loot 可以有東西、strength 在 0～2', () => {
    expect(problems('enemy', { ...ENEMY, adult: null, traits: ['contract'], loot: [], signature: [], strength: 2, angel: 'gold', named: true, branch: 'b', defeat: 'd' })).toBe('')
  })

  it('refs：勢力（none 不算）、武器類型、base、快取格的道具；載入後的引用檢查找得到', () => {
    const k = createKernel([enemiesFeature])
    k.content.load('enemy', [{ ...ENEMY, faction: 'ghost_faction', weapons: [{ class: 'ghost_gun' }], quick: [{ item: 'ghost_item', qty: 1 }] }, { id: 'en_b', base: 'ghost_base' }])
    const refs = k.content.checkRefs().join('\n')
    expect(refs).toMatch(/enemy\/en_ok：引用了不存在的 faction\/ghost_faction/)
    expect(refs).toMatch(/weapon_class\/ghost_gun/)
    expect(refs).toMatch(/item\/ghost_item/)
    expect(refs).toMatch(/enemy\/ghost_base/)
    const ok = createKernel([enemiesFeature])
    ok.content.load('enemy', [{ ...ENEMY, weapons: [] }])
    expect(ok.content.checkRefs().filter((r) => r.includes('faction'))).toEqual([])
  })
})

describe('白箱 base 的展開（ENEMIES 2.1 節）', () => {
  it('mergeBase：自己寫的蓋掉 base 的（淺的合併）', () => {
    expect(mergeBase({ a: 1, b: { x: 1 } }, { b: { y: 2 }, c: 3 })).toEqual({ a: 1, b: { y: 2 }, c: 3 })
  })

  it('resolveEnemy：找不到丟錯；一層一層展開；繞圈丟錯並寫出路徑；超過 8 層也丟錯', () => {
    const k = createKernel([enemiesFeature])
    k.content.load('enemy', [
      ENEMY, { id: 'en_a', base: 'en_ok', name: '甲' }, { id: 'en_b', base: 'en_a', desc: '乙的描述。' },
    ])
    expect(() => resolveEnemy(k.content, 'nope')).toThrow(/沒有 nope 這個敵人/)
    expect(resolveEnemy(k.content, 'en_b')).toMatchObject({ name: '甲', desc: '乙的描述。', rank: 'minion' })
    expect(resolveEnemy(k.content, 'en_ok')).toMatchObject({ id: 'en_ok' })
    const loop = createKernel([enemiesFeature])
    loop.content.load('enemy', [{ id: 'en_x', base: 'en_y' }, { id: 'en_y', base: 'en_x' }])
    expect(() => resolveEnemy(loop.content, 'en_x')).toThrow(/base 繞圈了：en_x → en_y → en_x/)
    const deep = createKernel([enemiesFeature])
    deep.content.load('enemy', [...Array.from({ length: 12 }, (_, i) => ({ id: `en_d${i}`, base: `en_d${i + 1}` })), { ...ENEMY, id: 'en_d12' }])
    expect(() => resolveEnemy(deep.content, 'en_d0')).toThrow(/base 繞圈了/)
  })

  it('有 base 的一筆：base 載入了就合併後完整檢查（缺的必填要補在自己這一筆）；base 沒載入只檢查寫了的欄位', () => {
    const k = createKernel([enemiesFeature])
    k.content.load('enemy', [ENEMY])
    expect(k.content.validate('enemy', [{ id: 'en_ok2', base: 'en_ok', name: '' }]).join()).toMatch(/name 要是名字/)
    expect(k.content.validate('enemy', [{ id: 'en_ok2', base: 'en_ok' }])).toEqual([])
    const lone = createKernel([enemiesFeature])
    expect(lone.content.validate('enemy', [{ id: 'en_o', base: 'en_nowhere' }])).toEqual([])
    expect(lone.content.validate('enemy', [{ id: 'en_o', base: 'en_nowhere', rank: 'god' }]).join()).toMatch(/rank 只能是/)
    // base 繞圈時當成 base 找不到（只檢查寫了的欄位），載入後用的時候才丟錯
    const cyc = createKernel([enemiesFeature])
    cyc.content.load('enemy', [{ id: 'en_x', base: 'en_y' }, { id: 'en_y', base: 'en_x' }])
    expect(cyc.content.validate('enemy', [{ id: 'en_z', base: 'en_x' }])).toEqual([])
  })
})

describe('白箱 encounter 的格式（ENEMIES 第 13 節）', () => {
  it('合格的樣本收得進來', () => {
    expect(problems('encounter', ENC)).toBe('')
    expect(problems('encounter', { ...ENC, kind: 'boss', escapable: false, faction: 'x', ambush: 'foe', field: { dark: true, n: 1, s: 'x' }, nodes: [{ kind: 'light', name: '燈' }], foes: [{ enemy: 'a', grade: 5, slot: 4, strength: 2 }] })).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['grade', 0, /grade 要是 1～5 的整數/],
    ['grade', 2.5, /grade 要是 1～5 的整數/],
    ['kind', 'epic', /kind 只能是 light、normal、heavy、boss/],
    ['cover', 'swamp', /cover 只能是 dense、medium、sparse、one_sided/],
    ['foes', [], /foes 要有至少一筆/],
    ['foes', 'x', /foes 要有至少一筆/],
    ['foes', ['x'], /foes\[0\] 要是物件/],
    ['foes', [{ enemy: '' }], /foes\[0\]\.enemy 要是敵人的 id/],
    ['foes', [{ enemy: 'a', grade: 6 }], /foes\[0\]\.grade 要是 1～5 的整數/],
    ['foes', [{ enemy: 'a', slot: 5 }], /foes\[0\]\.slot 要是 1～4 的整數/],
    ['foes', [{ enemy: 'a', strength: 0 }], /foes\[0\]\.strength 要是 0 到 2 之間的數字/],
    ['escapable', 'no', /escapable 要是 true 或 false/],
    ['faction', '', /faction 要是勢力的 id/],
    ['ambush', 'both', /ambush 只能是 ally 或 foe/],
    ['field', 'dark', /field 要是/],
    ['field', { dark: [] }, /field 要是/],
    ['nodes', 'x', /nodes 要是 \[\{ kind, name\? \}\]/],
    ['nodes', [{ kind: '' }], /nodes 要是/],
    ['nodes', [{ kind: 'light', name: '' }], /nodes 要是/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('encounter', ENC, field, value as unknown)).toMatch(re)
  })

  it('refs：每個敵人、勢力（none 不算）；載入後找不到的列出來', () => {
    const k = createKernel([enemiesFeature])
    k.content.load('encounter', [{ ...ENC, faction: 'ghost', foes: [{ enemy: 'en_ghost' }] }, { ...ENC, id: 'enc_n', faction: 'none' }])
    const refs = k.content.checkRefs().join('\n')
    expect(refs).toMatch(/encounter\/enc_ok：引用了不存在的 enemy\/en_ghost/)
    expect(refs).toMatch(/faction\/ghost/)
    expect(refs).not.toMatch(/faction\/none/)
  })
})

describe('白箱 單位的數字（ENEMIES 1.5 節；BALANCE 7.2 節）', () => {
  const st = (id: string, o: Parameters<typeof enemyStats>[3] = {}, state: GameState = makeState()) => enemyStats(kernel(), state, id, o)

  it('等級夾進 1～5（0 當 I、9 當 V、小數捨去）；沒寫等級時用場景的區等級夾進兵種的範圍；區等級查不到時當 I 級', () => {
    expect(st('en_named', { grade: 0 }).grade).toBe(1)
    expect(st('en_named', { grade: 9 }).grade).toBe(5)
    expect(st('en_named', { grade: 3.9 }).grade).toBe(3)
    expect(st('en_elite').grade).toBe(2) // 範圍 II～IV，場景 I 級 → II
    const state = makeState()
    state.location.district = 'ghost_district'
    expect(st('en_boss', {}, state).grade).toBe(3)
  })

  it('沒有橋的種類（machine）沒有感載；兵種的修正：生命倍率、護甲、迴避、攻擊、行動點加減；承受層數最少 1；敏感度照寫', () => {
    const r = st('en_robot', { grade: 2 })
    expect(r.load).toBeUndefined()
    expect(r.hp).toBe(Math.round(ENEMY_CURVE.hp.minion[1]! * 0.5))
    expect(r).toMatchObject({ armor: 2 + 2, evade: 12 - 1, attack: 4 + 1, ap: 4 + 1, layers: 1, sensitivity: 80 })
    const h = st('en_mook', { grade: 2 })
    expect(h.load).toBe(ENEMY_CURVE.load.minion[1])
    expect(h.sensitivity).toBe(50)
  })

  it('行動點：精英與首領 IV 級以上再 +1，雜兵不加（ENEMIES 1.5 節）', () => {
    expect(st('en_named', { grade: 3 }).ap).toBe(5)
    expect(st('en_named', { grade: 4 }).ap).toBe(6)
    expect(st('en_mook', { grade: 5 }).ap).toBe(4)
    expect(st('en_boss', { grade: 5 }).ap).toBe(7)
  })

  it('強度係數：我方 4 人以上，遭遇指定的蓋掉資料的、具名的預設 1.3、沒寫是 1；雜兵一律 1', () => {
    const hp = (id: string, o: Parameters<typeof enemyStats>[3] = {}) => st(id, { grade: 1, allies: 4, ...o }).hp
    expect(hp('en_named')).toBe(Math.round(110 * 1.3))
    expect(hp('en_named', { strength: 2 })).toBe(220)
    expect(hp('en_cheap')).toBe(55)
    expect(hp('en_cheap', { strength: 1 })).toBe(110)
    expect(hp('en_mook', { strength: 3 })).toBe(45)
    expect(st('en_named', { grade: 1, allies: 4, strength: 2 }).dmgMult.hp).toBeCloseTo(0.6 * 2)
  })

  it('對決（少於 4 人）：精英一對一 ×0.8、二三人不修正；首領一對一生命 ×0.35 傷害 ×0.5、兩人 ×0.8、三人不修正；不看具名與遭遇指定的', () => {
    const duelHp = (id: string, allies: number, strength?: number) => st(id, { grade: 1, allies, ...(strength !== undefined ? { strength } : {}) })
    expect(duelHp('en_named', 1, 3).hp).toBe(Math.round(110 * 0.8))
    expect(duelHp('en_named', 2).hp).toBe(110)
    expect(duelHp('en_named', 3).hp).toBe(110)
    expect(duelHp('en_boss', 1)).toMatchObject({ hp: Math.round(260 * 0.35) })
    expect(duelHp('en_boss', 1).dmgMult.hp).toBeCloseTo(1 * 0.5)
    expect(duelHp('en_boss', 2).hp).toBe(Math.round(260 * 0.8))
    expect(duelHp('en_boss', 3).hp).toBe(260)
    expect(duelHp('en_boss', 0).hp).toBe(Math.round(260 * 0.35))
  })

  it('難度係數乘在生命、傷害、感載上；首領與雜兵用各自那一組（BALANCE 7.2 節）', () => {
    const state = makeState()
    state.rules.enemyCoef = { boss: { hp: 2, dmg: 3, load: 4 }, minions: [{ hp: 0.5, dmg: 0.5, load: 0.5 }, { hp: 1, dmg: 1, load: 1 }, { hp: 1.5, dmg: 2, load: 2 }] }
    const boss = st('en_boss', { grade: 3 }, state)
    expect(boss.hp).toBe(Math.round(380 * 2))
    expect(boss.load).toBe(Math.round(77 * 4))
    expect(boss.dmgMult.load).toBe(3)
    expect(st('en_mook', { grade: 1 }, state).hp).toBe(Math.round(45 * 0.5))
    expect(st('en_mook', { grade: 5 }, state).dmgMult).toEqual({ hp: 0.4 * 2, load: 2 })
    expect(() => st('ghost')).toThrow(/沒有 ghost 這個敵人/)
  })
})

describe('白箱 enemyUnit 與武器（ENEMIES 1.5 節；COMBAT_SYSTEM 第 5 節）', () => {
  const unit = (ref: Record<string, unknown>, ctx = { grade: 1, allyCount: 4 }) => enemyUnit(kernel(), makeState(), ref, ctx)

  it('沒寫 id：丟「沒有  這個敵人」；名字可以蓋掉；等級可以指定；定力預設雜兵 0、其餘 2；自己寫的技能照寫', () => {
    expect(() => unit({ from: 'enemy' })).toThrow(/沒有 {2}這個敵人/)
    expect(unit({ from: 'enemy', id: 'en_mook', name: '看門的' }).name).toBe('看門的')
    expect(unit({ from: 'enemy', id: 'en_elite', grade: 4 }).grade).toBe(4)
    expect(unit({ from: 'enemy', id: 'en_mook' }).skills).toEqual({ composure: 0 })
    expect(unit({ from: 'enemy', id: 'en_elite' }).skills).toEqual({ composure: 2 })
    expect(unit({ from: 'enemy', id: 'en_tuned' }).skills).toEqual({ composure: 3 })
    expect(unit({ from: 'enemy', id: 'en_tuned' }).attrs.reflex).toBe(14)
    expect(unit({ from: 'enemy', id: 'en_tuned' }).initBonus).toBe(2)
  })

  it('標籤：種類、沒有橋的加 unbridged、資料的 traits（去重）；快取格：資料的複製、capture 預設兩條束帶、其餘空的', () => {
    const t = unit({ from: 'enemy', id: 'en_tuned' })
    expect(t.tags).toEqual(['human', 'contract', 'night_vision'])
    expect(t.quick).toEqual([{ item: 'x', qty: 2 }])
    expect(unit({ from: 'enemy', id: 'en_robot' }).tags).toEqual(['machine', 'unbridged'])
    expect(unit({ from: 'enemy', id: 'en_cap' }).quick).toEqual([{ item: 'it_zip_tie', qty: 2 }])
    expect(unit({ from: 'enemy', id: 'en_mook' }).quick).toEqual([])
    expect(unit({ from: 'enemy', id: 'en_robot' }).load).toBeUndefined()
  })

  it('AI 的欄位：prefer、floor、never_flee 有寫才帶；cover_use 沒寫是 0.5；偏好的格照資料', () => {
    const k = kernel({ id: 'x', content: { enemy: [mk('en_ai', 'elite', { ai: { prefer: 'leader', focus: 2, flee_below: 0.2, floor: 3, never_flee: true }, position: { prefer: [3, 4], cover_use: 0.9 } })] } })
    const u = enemyUnit(k, makeState(), { from: 'enemy', id: 'en_ai' }, { grade: 2, allyCount: 4 })
    expect(u.ai).toEqual({ focus: 2, floor: 3, prefer: 'leader', mode: 'lethal', fleeBelow: 0.2, neverFlee: true, prefer_slots: [3, 4], coverUse: 0.9 })
    const plain = unit({ from: 'enemy', id: 'en_mook' })
    expect(plain.ai).toEqual({ focus: 1, floor: 1, prefer: 'weakest', mode: 'lethal', fleeBelow: 0.3, prefer_slots: [1], coverUse: 0.5 })
    expect(plain.ai).not.toHaveProperty('neverFlee')
  })

  it('武器：手上沒有武器就沒有武器；等級骰照場景；霰彈的遠距骰也加等級骰', () => {
    expect(unit({ from: 'enemy', id: 'en_gunless' }).weapons).toEqual([])
    const g5 = unit({ from: 'enemy', id: 'en_mook', grade: 3 })
    expect(g5.weapons[0]).toMatchObject({ id: 'pistol', dice: 3 + 1, hit: 5 })
  })

  it('資料覆寫：名字、類型（熱能）、特性（合併去重）、穿甲是「最後的值」、射程、彈匣；沒覆寫的照武器類型', () => {
    const w = unit({ from: 'enemy', id: 'en_tuned' }).weapons[0]!
    expect(w).toMatchObject({ name: '改裝霰彈', type: 'thermal', pierce: 4, range: [2, 6], mag: { now: 4, max: 4 }, class: 'shotgun' })
    expect([...w.traits].sort()).toEqual(['melee', 'push'])
    const plain = unit({ from: 'enemy', id: 'en_mook' }).weapons[0]!
    expect(plain).toMatchObject({ name: '手槍', type: 'physical', pierce: 1, range: [1, 4], mag: { now: 2, max: 2 } })
  })

  it('打感載的神經武器：capture 與 neural 的敵人，雜兵 4d6、精英 6d6、首領 11d6 再加等級骰；打生命的 lethal 照一般的骰', () => {
    expect(unit({ from: 'enemy', id: 'en_cap', grade: 1 }).weapons[0]!.dice).toBe(4)
    expect(unit({ from: 'enemy', id: 'en_cap', grade: 3 }).weapons[0]!.dice).toBe(4 + 1)
    expect(unit({ from: 'enemy', id: 'en_neural', grade: 2 }).weapons[0]).toMatchObject({ dice: 6, type: 'pleasure' })
    const lethalStun = kernel({ id: 'y', content: { enemy: [mk('en_lstun', 'minion', { weapons: [{ class: 'stun' }] })] } })
    expect(enemyUnit(lethalStun, makeState(), { from: 'enemy', id: 'en_lstun' }, { grade: 1, allyCount: 4 }).weapons[0]!.dice).toBe(3)
  })

  it('武器類型不存在：丟「沒有 x 這種武器的類型」（載入時引用檢查擋得到，這裡是最後一道）', () => {
    const k = createKernel([enemiesFeature])
    k.content.load('enemy', [{ ...ENEMY, weapons: [{ class: 'ghost_gun' }] }])
    expect(() => enemyUnit(k, makeState(), { from: 'enemy', id: 'en_ok' }, { grade: 1, allyCount: 4 })).toThrow(/沒有 ghost_gun 這種武器的類型/)
  })

  it('用 enemy 來源開打：我方人數是對決的依據（allyCount 來自上場的人數），名冊上的人從來源註冊進來', () => {
    const k = createKernel([enemiesFeature, TEST_COMBAT])
    k.content.loadPack(PACK)
    const a = arena({ ...duel([one()], []), foes: [{ from: 'enemy', id: 'en_boss', grade: 3 } as UnitRef] }, [enemiesFeature, TEST_COMBAT], (kk) => kk.content.loadPack(PACK))
    expect(a.foe(1).hp!.max).toBe(Math.round(380 * 0.35))
    const four = arena({ ...duel([one(), one({}, 2), one({}, 3), one({}, 4)], []), foes: [{ from: 'enemy', id: 'en_boss', grade: 3 } as UnitRef] }, [enemiesFeature, TEST_COMBAT], (kk) => kk.content.loadPack(PACK))
    expect(four.foe(1).hp!.max).toBe(380)
  })
})

describe('白箱 遭遇（ENEMIES 第 13 節）', () => {
  const k = kernel()
  const foes = (...f: Array<[string, Record<string, unknown>?]>) => f.map(([enemy, more]) => ({ enemy, ...(more ?? {}) }))

  it('點數：雜兵 1、精英 2.5、首領 5；高一級（含以上）的 ×1.75；具名與指定的強度係數乘上去（雜兵不乘）', () => {
    expect(ENEMY_CURVE.points).toEqual({ minion: 1, elite: 2.5, boss: 5 })
    expect(encounterPoints(k, foes(['en_mook']), 1)).toBe(1)
    expect(encounterPoints(k, foes(['en_mook', { grade: 2 }]), 1)).toBeCloseTo(1.75)
    expect(encounterPoints(k, foes(['en_mook', { grade: 3 }]), 1)).toBeCloseTo(1.75)
    expect(encounterPoints(k, foes(['en_mook', { grade: 1 }]), 1)).toBe(1)
    expect(encounterPoints(k, foes(['en_named']), 1)).toBeCloseTo(2.5 * 1.3)
    expect(encounterPoints(k, foes(['en_cheap']), 1)).toBeCloseTo(2.5 * 0.5)
    expect(encounterPoints(k, foes(['en_cheap', { strength: 2 }]), 1)).toBeCloseTo(5)
    expect(encounterPoints(k, foes(['en_mook', { strength: 3 }]), 1)).toBe(1)
    expect(encounterPoints(k, foes(['en_boss'], ['en_elite']), 1)).toBeCloseTo(5 * 1.75 + 2.5 * 1.75) // 首領範圍 III～V、精英 II～IV：場景 I 級時各夾到 III、II，都比場景高一級以上
    expect(ENCOUNTER_BUDGET).toEqual({ light: 2, normal: 4, heavy: 5.5, boss: 8 })
  })

  it('setupFromEncounter：找不到丟錯；遮蔽、能不能脫離（預設可以）、地點、場地、節點、埋伏照遭遇的資料', () => {
    expect(() => setupFromEncounter(k, makeState(), 'enc_ghost', { allies: [] })).toThrow(/沒有 enc_ghost 這個遭遇/)
    const ally: UnitRef[] = [{ from: 'actor', id: 'pc' }]
    const s = setupFromEncounter(k, makeState(), 'enc_boss', { allies: ally })
    expect(s).toMatchObject({ mode: 'meat', grade: 3, cover: 'sparse', allies: ally, ambush: 'ally', field: { dark: true }, nodes: [{ kind: 'light' }] })
    expect(s.origin).toMatchObject({ encounter: 'enc_boss', escapable: false, place: '有首領', faction: 'ed' })
    expect(s.foes).toEqual([{ from: 'enemy', id: 'en_mook', slot: 3 }, { from: 'enemy', id: 'en_boss', grade: 4, strength: 1.2 }])
    const plain = setupFromEncounter(k, makeState(), 'enc_ok', { allies: ally })
    expect(plain.origin!.escapable).toBe(true)
    expect(plain).not.toHaveProperty('ambush')
    expect(plain).not.toHaveProperty('field')
    expect(plain).not.toHaveProperty('nodes')
  })

  it('勢力：沒寫時用位階最高的那個敵人的（一樣高取前面的）；是 none 就不寫；遭遇自己寫了就照寫', () => {
    const f = (id: string) => setupFromEncounter(k, makeState(), id, { allies: [] }).origin!.faction
    expect(f('enc_boss')).toBe('ed')
    expect(f('enc_tie')).toBe('hz') // 精英 hz 在前，另一個精英 none 排後面
    expect(f('enc_none')).toBeUndefined()
    const explicit = createKernel([enemiesFeature])
    explicit.content.loadPack(PACK)
    explicit.content.load('encounter', [{ ...ENC, id: 'enc_f', faction: 'zz' }])
    expect(setupFromEncounter(explicit, makeState(), 'enc_f', { allies: [] }).origin!.faction).toBe('zz')
  })

  it('開得起來：照遭遇組出來的設定交給戰鬥，敵人數與位階對得上', () => {
    const { game } = makeBattleGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK], battle: { ...setupFromEncounter(kernel(), makeState(), 'enc_tie', { allies: [{ from: 'actor', id: 'pc' }] }) } })
    expect(Object.values(game.battle!.units).filter((u) => u.side === 'foe').map((u) => u.rank).sort()).toEqual(['elite', 'elite', 'minion'])
  })
})

describe('白箱 士氣的守門條件（ENEMIES 4.4 節）', () => {
  const field = (foeOver: Record<string, unknown> = {}, rankFoe = 'en_mook') => {
    const a = arena({ ...duel([one(), one({}, 2)], []), foes: [{ from: 'enemy', id: rankFoe, grade: 1 } as UnitRef, { from: 'enemy', id: 'en_mook', grade: 1 } as UnitRef] }, [enemiesFeature, TEST_COMBAT], (kk) => kk.content.loadPack(PACK))
    Object.assign(a.foe(1), foeOver)
    return a
  }

  it('不是 enemy 來源的單位、玩家操縱的、已經退出的：不檢定', () => {
    const a = field()
    a.foe(2).out = 'down'
    a.foe(1).hp!.now = 1
    const handled = (u: ReturnType<typeof a.foe>) => a.k.battle.emit('ai.step', { run: a.run([5]), unit: u })
    expect(handled(a.foe(1))).toBe(true) // 生命比例低於 flee_below、擲 5 沒過 → 撤退
    const b = field({ enemy: undefined })
    b.foe(1).hp!.now = 1
    expect(b.k.battle.emit('ai.step', { run: b.run([5]), unit: b.foe(1) })).toBe(false)
    const c = field({ control: 'player' })
    c.foe(1).hp!.now = 1
    expect(c.k.battle.emit('ai.step', { run: c.run([5]), unit: c.foe(1) })).toBe(false)
    const d = field({ out: 'down' })
    d.foe(1).hp!.now = 1
    expect(d.k.battle.emit('ai.step', { run: d.run([5]), unit: d.foe(1) })).toBe(false)
  })

  it('檢定過了（擲高）就不撤退，之後這一場不再擲（uses.morale）；沒有生命這一條的單位不看生命比例', () => {
    const a = field()
    a.foe(1).hp!.now = 1
    const run = a.run([20, ...Array(40).fill(1)])
    expect(a.k.battle.emit('ai.step', { run, unit: a.foe(1) })).toBe(false)
    expect(a.foe(1).uses.morale).toBe(1)
    expect(a.k.battle.emit('ai.step', { run, unit: a.foe(1) })).toBe(false)
    const b = field({ hp: undefined })
    expect(b.k.battle.emit('ai.step', { run: b.run([1]), unit: b.foe(1) })).toBe(false)
    expect(b.foe(1).uses.morale).toBeUndefined()
  })

  it('精英：首領倒下才檢定（DC 10），同伴倒了一半不算', () => {
    const a = field({}, 'en_elite')
    a.foe(1).hp!.now = a.foe(1).hp!.max
    a.foe(2).out = 'down'
    expect(a.k.battle.emit('ai.step', { run: a.run([1]), unit: a.foe(1) })).toBe(false)
    expect(a.foe(1).uses.morale).toBeUndefined()
  })
})
