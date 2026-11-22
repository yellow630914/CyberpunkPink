// enemies 功能的補充測試（驗收測試 M1-enemies.test.ts 沒走到的分支）：base 的展開與檢查、對決的其餘列、士氣的每個條件、遭遇的勢力與點數。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack } from '../../src'
import { ContentError, Game, createKernel } from '../../src'
import { encounterPoints, enemiesFeature, enemyStats, setupFromEncounter } from '../../src/features/enemies'
import { TEST_COMBAT, makeBattleGame, makeGame, playOut } from '../../src/testkit'

const SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 1, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'stun', name: '電擊', dice: 3, type: 'neural', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
]
const enemy = (id: string, rank: string, more: Record<string, unknown> = {}) => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [2, 3], kind: 'human',
  position: { prefer: [1] }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.3 }, ...more,
})
const PACK: ContentPack = {
  id: 'enemies_edge',
  content: {
    skill: SKILLS, weapon_class: WEAPONS,
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }],
    enemy: [
      enemy('en_mook', 'minion'), enemy('en_elite', 'elite', { ai: { prefer: 'weakest', focus: 1, flee_below: 0.5 } }), enemy('en_boss', 'boss', { faction: 'eden' }),
      enemy('en_cop', 'minion', { mode: 'capture', kind: 'unbridged', weapons: [{ class: 'pistol', pierce: 3, mag: 4, range: [2, 5] }, { class: 'stun' }], attrs: { reflex: 14 } }),
      // 只寫和 base 不同的欄位
      { id: 'en_named', base: 'en_elite', named: true, name: '具名的小隊長' },
    ],
    encounter: [
      { id: 'enc_mixed', name: '混編', grade: 2, kind: 'heavy', cover: 'dense', ambush: 'foe', field: { dark: true }, nodes: [{ kind: 'terminal' }], foes: [{ enemy: 'en_mook', slot: 2 }, { enemy: 'en_boss', strength: 1.1 }, { enemy: 'en_elite' }] },
      { id: 'enc_flag', name: '指定勢力', grade: 2, cover: 'sparse', faction: 'eden', escapable: false, foes: [{ enemy: 'en_mook' }] },
    ],
  },
}
const game = (more: Record<string, unknown> = {}) => makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK], ...more }).game
const ally = () => makeBattleGame().game.battle!.units.a1 as unknown as Record<string, unknown>

describe('內容的格式', () => {
  const load = (e: { id: string; [k: string]: unknown }) => { const k = createKernel([enemiesFeature]); k.content.loadPack({ ...PACK, content: { ...PACK.content, enemy: [e] } }) }
  const reject = (e: { id: string; [k: string]: unknown }, re: RegExp) => expect(() => load(e)).toThrow(re)
  it('每個欄位的底線', () => {
    expect(() => load(enemy('en_ok', 'minion'))).not.toThrow()
    reject({ ...enemy('en_x', 'minion'), grades: [3, 2] }, /grades/)
    reject({ ...enemy('en_x', 'minion'), kind: 'ghost' }, /kind/)
    reject({ ...enemy('en_x', 'minion'), position: { prefer: [] } }, /position\.prefer/)
    reject({ ...enemy('en_x', 'minion'), position: { prefer: [5] } }, /position\.prefer/)
    reject({ ...enemy('en_x', 'minion'), weapons: 'x' }, /weapons/)
    // 沒有武器、沒有 prefer、prefer 寫 bridged 都合格（ENEMY_ROSTER 有這幾種兵種）
    expect(() => load({ ...enemy('en_none', 'minion'), weapons: [] })).not.toThrow()
    expect(() => load({ ...enemy('en_noprefer', 'minion'), ai: { focus: 0.3, flee_below: 0 } })).not.toThrow()
    expect(() => load({ ...enemy('en_br', 'minion'), ai: { prefer: 'bridged', focus: 1, flee_below: 0.3 } })).not.toThrow()
    reject({ ...enemy('en_x', 'minion'), weapons: [{ class: 'pistol', type: 'fire' }] }, /weapons\[0\]\.type/)
    reject({ ...enemy('en_x', 'minion'), ai: { prefer: 'nobody', focus: 1, flee_below: 0.3 } }, /ai\.prefer/)
    reject({ ...enemy('en_x', 'minion'), ai: { prefer: 'weakest', focus: 1, flee_below: 2 } }, /ai\.flee_below/)
    reject({ ...enemy('en_x', 'minion'), mods: { hp: 2 } }, /mods\.hp/)
    reject({ ...enemy('en_x', 'minion'), mods: { armor: 1.5 } }, /mods\.armor/)
    reject({ ...enemy('en_x', 'minion'), mods: { hp_max: 5 } }, /mods\.hp_max/)
    reject({ ...enemy('en_x', 'minion'), quick: [{ item: 'it_zip_tie', qty: 0 }] }, /quick/)
    reject({ ...enemy('en_x', 'minion'), adult: 'x' }, /adult/)
    const { desc: _d, ...noDesc } = enemy('en_x', 'minion')
    reject(noDesc, /desc/)
  })
  it('有 base 的一筆：先拿 base 的整筆再蓋上自己寫的，之後才檢查必填；base 還沒載入時只檢查寫了的欄位', () => {
    const k = createKernel([enemiesFeature])
    k.content.loadPack(PACK)
    // base 已經載入：合併之後完整檢查，合併出來的資料是 base 加上自己寫的
    k.content.load('enemy', [{ id: 'en_named2', base: 'en_boss', name: '另一個', grades: [1, 2] }])
    expect(k.content.checkRefs()).toEqual([])
    expect(() => k.content.load('enemy', [{ id: 'en_bad_base', base: 'en_boss', rank: 'king' }])).toThrow(ContentError)
    // base 不存在：引用檢查抓得到
    k.content.load('enemy', [{ id: 'en_orphan', base: 'en_nope' }])
    expect(k.content.checkRefs()).toEqual(['enemy/en_orphan：引用了不存在的 enemy/en_nope'])
    expect(() => enemyStats(k, game().state, 'en_orphan', { grade: 2 })).toThrow(/沒有 en_nope 這個敵人/)
    // 繞圈
    k.content.load('enemy', [{ id: 'en_a', base: 'en_b' }, { id: 'en_b', base: 'en_a' }])
    expect(() => enemyStats(k, game().state, 'en_a', { grade: 2 })).toThrow(/繞圈/)
  })
})

describe('數字的其餘幾列', () => {
  const k = () => { const x = createKernel([enemiesFeature]); x.content.loadPack(PACK); return x }
  const st = (id: string, o: Record<string, number> = {}) => enemyStats(k(), game().state, id, o)
  it('沒寫等級：場景的等級夾進兵種的範圍（這個兵種 II～III 級）', () => {
    expect(enemyStats(k(), game().state, 'en_mook', { grade: 1 }).grade).toBe(1) // 明寫的等級照寫
    expect(st('en_mook').grade).toBe(2) // 沒寫：區的等級夾進 [2, 3]
  })
  it('具名的 base 展開：精英、具名 ×1.3；對決：精英一對一 ×0.8、兩人與三人不修正；雜兵一律 1', () => {
    expect(st('en_named', { grade: 2 })).toMatchObject({ hp: Math.round(130 * 1.3), dmgMult: { hp: 0.6 * 1.3 } })
    expect(st('en_named', { grade: 2, allies: 1 })).toMatchObject({ hp: Math.round(130 * 0.8), dmgMult: { hp: 0.6 * 0.8 } })
    expect(st('en_named', { grade: 2, allies: 2 })).toMatchObject({ hp: 130, dmgMult: { hp: 0.6 } })
    expect(st('en_mook', { grade: 2, strength: 2 })).toMatchObject({ hp: 55, dmgMult: { hp: 0.4 } })
    expect(st('en_mook', { grade: 2, allies: 1 })).toMatchObject({ hp: 55, dmgMult: { hp: 0.4 } })
  })
  it('單位：沒有橋的沒有感載、capture 預設帶兩條束帶、屬性補 10、武器照資料最後的值', () => {
    const g = game()
    g.startBattle({ grade: 2, allies: [{ from: 'unit', unit: ally() }], foes: [{ from: 'enemy', id: 'en_cop', name: '巡警甲' }] })
    const u: BattleUnit = g.battle!.units.f1!
    expect(u).toMatchObject({ name: '巡警甲', quick: [{ item: 'it_zip_tie', qty: 2 }], tags: ['unbridged'], attrs: { reflex: 14, body: 10 }, skills: { composure: 0 } })
    expect(u.load).toBeUndefined()
    // pierce 寫的是最後的值：類型 1，資料 3 → 3；range 與 mag 照寫；神經武器 4d6（+0 等級骰 − 基礎 3 骰 + 3）
    expect(u.weapons[0]).toMatchObject({ pierce: 3, range: [2, 5], mag: { now: 4, max: 4 }, dice: 3 })
    expect(u.weapons[1]).toMatchObject({ type: 'neural', dice: 4 })
  })
})

describe('遭遇', () => {
  const k = () => { const x = createKernel([enemiesFeature]); x.content.loadPack(PACK); return x }
  it('沒寫勢力：位階最高的那個敵人的；指定的照寫；其餘的欄位照搬、沒寫的不放', () => {
    const s = game().state
    const mixed = setupFromEncounter(k(), s, 'enc_mixed', { allies: [] })
    expect(mixed).toEqual({
      mode: 'meat', grade: 2, cover: 'dense', allies: [], ambush: 'foe', field: { dark: true }, nodes: [{ kind: 'terminal' }],
      foes: [{ from: 'enemy', id: 'en_mook', slot: 2 }, { from: 'enemy', id: 'en_boss', strength: 1.1 }, { from: 'enemy', id: 'en_elite' }],
      origin: { encounter: 'enc_mixed', escapable: true, place: '混編', faction: 'eden' },
    })
    expect(setupFromEncounter(k(), s, 'enc_flag', { allies: [] }).origin).toEqual({ encounter: 'enc_flag', escapable: false, place: '指定勢力', faction: 'eden' })
  })
  it('點數：遭遇指定的強度係數乘上去，雜兵不乘', () => {
    expect(encounterPoints(k(), [{ enemy: 'en_boss', strength: 1.1 }, { enemy: 'en_mook', strength: 2 }], 2)).toBe(5 * 1.1 + 1)
    expect(encounterPoints(k(), [{ enemy: 'en_elite', grade: 3 }], 2)).toBe(2.5 * 1.75)
  })
})

describe('沒有武器的單位', () => {
  it('手上沒有武器：不攻擊也不會丟錯，戰鬥打得完', () => {
    const g = makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [{ ...PACK, content: { ...PACK.content, enemy: [enemy('en_unarmed', 'minion', { weapons: [], ai: { focus: 0.3, flee_below: 0 } })], encounter: [] } }] }).game
    g.startBattle({ grade: 2, allies: [{ from: 'unit', unit: ally() }], foes: [{ from: 'enemy', id: 'en_unarmed' }] })
    expect(g.battle!.units.f1!.weapons).toEqual([])
    expect(() => playOut(g)).not.toThrow()
  })
})

describe('士氣', () => {
  /** 開一場：我方 allies 人，敵方照 foes；敵方的定力壓到最低（一定失敗，除非自然 20）。 */
  const fight = (foes: string[], allies = 1, seed = 4) => {
    const g = game({ seed })
    g.startBattle({ grade: 2, cover: 'medium', allies: Array.from({ length: allies }, () => ({ from: 'unit', unit: ally() })), foes: foes.map((id) => ({ from: 'enemy', id })) })
    for (const u of Object.values(g.state.battle!.units)) if (u.side === 'foe') u.skills.composure = -40
    return g
  }
  /** 現在的戰鬥狀態（每一步提交之後狀態都是新的，不能留著舊的參照）。 */
  const now = (g: Game) => g.state.battle!
  /** 讓指定的人輪到、走一步。 */
  const stepAs = (g: Game, id: string) => { now(g).turn = now(g).order.indexOf(id); return g.battleNext() }
  const natural = (r: ReturnType<Game['battleNext']>) => r.reports[0]!.timeline.find((x) => x.roll)?.roll?.natural

  it('沒有任何條件：不檢定、不留 morale', () => {
    const g = fight(['en_mook', 'en_mook', 'en_boss'], 4)
    stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBeUndefined()
  })
  it('同伴倒了一半（開場人數的一半）才檢定；倒一個（四個裡）還不用', () => {
    const g = fight(['en_mook', 'en_mook', 'en_mook', 'en_mook'], 4)
    now(g).units.f2!.out = 'down'
    stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBeUndefined()
    now(g).units.f3!.out = 'down'
    const r = stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBe(1)
    expect(r.reports[0]!.timeline.find((x) => x.roll)!.roll).toMatchObject({ dc: 13 })
    if (natural(r) !== 20) expect(now(g).units.f1!.out).toBe('surrendered') // 我方 4 人站著、敵方剩 2 人
  })
  it('對方站著的人數是自己這一方的兩倍以上：投降；否則撤退', () => {
    // 敵方剩 3 個雜兵（首領倒下），我方 1 人：對方 1 人 < 2 × 3 → 撤退
    const a = fight(['en_mook', 'en_mook', 'en_mook', 'en_boss'], 1)
    now(a).units.f4!.out = 'down'
    const ra = stepAs(a, 'f1')
    if (natural(ra) !== 20) expect(now(a).units.f1!.out).toBe('fled')
    // 敵方剩 2 個雜兵（首領倒下），我方 4 人：對方 4 人 ≥ 2 × 2 → 投降
    const s = fight(['en_mook', 'en_mook', 'en_boss'], 4)
    now(s).units.f3!.out = 'down'
    const rs = stepAs(s, 'f1')
    if (natural(rs) !== 20) expect(now(s).units.f1!.out).toBe('surrendered')
  })
  it('精英：首領倒下或自己的生命比例低於 flee_below 才檢定，DC 10；雜兵同伴倒了一半對精英不算', () => {
    const g = fight(['en_elite', 'en_mook', 'en_mook', 'en_mook'], 4)
    now(g).units.f2!.out = 'down'
    now(g).units.f3!.out = 'down'
    stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBeUndefined()
    const u = now(g).units.f1!
    u.hp!.now = Math.floor(u.hp!.max * 0.4) // flee_below 0.5
    const r = stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBe(1)
    expect(r.reports[0]!.timeline.find((x) => x.roll)!.roll).toMatchObject({ dc: 10, skill: 'composure' })
  })
  it('「同伴倒了一半」的分母是開打時記下的人數：之後才進來的增援不會把它墊高（ENEMIES 4.4 節）', () => {
    const g = fight(['en_mook', 'en_mook', 'en_mook', 'en_mook'], 4)
    expect(now(g).origin.headcount).toEqual({ ally: 4, foe: 4 })
    now(g).units.f2!.out = 'down'
    now(g).units.f3!.out = 'down'
    // 中途叫來兩個增援（M2 的呼叫增援會這樣做）：場上的人變多了，但開場是四個人、已經倒了兩個
    for (const id of ['f5', 'f6']) now(g).units[id] = { ...structuredClone(now(g).units.f4!), id, slot: 0 }
    now(g).reserve.foe.push('f5', 'f6')
    stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBe(1)
    // 沒有記人數的舊戰鬥（存檔）：退回用現在場上的人數算，六個人倒兩個還不到一半
    const old = fight(['en_mook', 'en_mook', 'en_mook', 'en_mook'], 4)
    delete now(old).origin.headcount
    now(old).units.f2!.out = 'down'
    now(old).units.f3!.out = 'down'
    for (const id of ['f5', 'f6']) now(old).units[id] = { ...structuredClone(now(old).units.f4!), id, slot: 0 }
    now(old).reserve.foe.push('f5', 'f6')
    stepAs(old, 'f1')
    expect(now(old).units.f1!.uses.morale).toBeUndefined()
  })
  it('契約人不能投降也不能撤退：帶 contract 標籤的單位不檢定士氣（ENEMIES 4.4 節）；資料的 traits 會變成單位的標籤', () => {
    const g = makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [{ ...PACK, content: { ...PACK.content, enemy: [...PACK.content.enemy!, enemy('en_contract', 'minion', { traits: ['contract'] })] } }], seed: 4 }).game
    g.startBattle({ grade: 2, cover: 'medium', allies: Array.from({ length: 4 }, () => ({ from: 'unit', unit: ally() })), foes: ['en_contract', 'en_mook', 'en_mook', 'en_mook'].map((id) => ({ from: 'enemy', id })) })
    for (const u of Object.values(now(g).units)) if (u.side === 'foe') u.skills.composure = -40
    expect(now(g).units.f1!.tags).toContain('contract')
    // 同伴倒了一半、自己也只剩一口氣：一般的雜兵會擲士氣，契約人不擲、不走
    now(g).units.f3!.out = 'down'
    now(g).units.f4!.out = 'down'
    now(g).units.f1!.hp!.now = 1
    const r = stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBeUndefined()
    expect(now(g).units.f1!.out).toBeUndefined()
    expect(r.reports[0]!.timeline.some((x) => /士氣/.test(x.text))).toBe(false)
    // 同一場裡沒有契約的那個照常擲
    stepAs(g, 'f2')
    expect(now(g).units.f2!.uses.morale).toBe(1)
  })
  it('首領不檢定；檢定過的人（morale 已經有值）這一場不再擲', () => {
    const g = fight(['en_boss', 'en_mook', 'en_mook', 'en_mook'], 4)
    now(g).units.f1!.hp!.now = 1
    now(g).units.f2!.out = 'down'
    now(g).units.f3!.out = 'down'
    stepAs(g, 'f1')
    expect(now(g).units.f1!.uses.morale).toBeUndefined()
    now(g).units.f1!.out = 'down'
    now(g).units.f4!.uses.morale = 1
    stepAs(g, 'f4')
    expect(now(g).units.f4!.out).toBeUndefined()
  })
})
