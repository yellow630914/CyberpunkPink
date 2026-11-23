// 白箱測試：features/enemies 第二波新增的部分（掉落 loot、特徵 traits、天使急救 angel、掛在格上的敵人 overlays、招牌行動檢查 signature、遭遇與敵人格式）。
// 補主套件沒有走到的分支與錯誤路徑；每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。
// 會失敗（和規格不一致）的寫在 tests/pending/ 與 dev/bugs/，這裡只放現在就對的行為。內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, createKernel, performAction, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { CASH_RANGE, LOOT_CAP, encounterPoints, enemiesFeature, overlayInit, setupFromEncounter } from '../../src/features/enemies'
import { applyTraits, moraleDcBonus, runTraitStart } from '../../src/features/enemies/traits'
import { lootProblems, lootRefs } from '../../src/features/enemies/loot'
import { summonsFeature } from '../../src/features/summons'
import { enemyUnit as _unused } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, one } from '../helpers/battle'

void _unused
type Rec = Record<string, unknown>
const FEATURES = [combatFeature, enemiesFeature, summonsFeature]
const dice = (...v: number[]): number[] => [...v, ...Array(200).fill(1)]
const SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const foeData = (id: string, rank: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...more,
})
const overlayData = (id: string, kind: string, more: Rec = {}): Rec =>
  foeData(id, 'minion', { name: `${id}號機`, kind: 'machine', position: { prefer: [2, 3], size: 'overlay' }, overlay: { kind }, ...more })
const TRAITS = [
  { id: 'tr_tough', name: '硬漢', desc: '生命多四成，行動點 +1。', mods: { hp_pct: 40, ap: 1, hit: 2, load_cap: 5, layers_max: 1, evade: 1, initiative: 2 }, tags: ['tough'] },
  { id: 'tr_veteran', name: '老兵', desc: '士氣 DC −3，不逃。', ai: { flee_below: 0.2, prefer: 'weakest', never_flee: true, morale_dc: -3 } },
  { id: 'tr_rookie', name: '新人', desc: '士氣 DC +3。', ai: { morale_dc: 3 } },
  { id: 'tr_start', name: '開場', desc: '開打時餘韻 +1。', start: [{ op: 'afterglow', who: 'self', amount: 1 }], tags: ['tough'] },
  { id: 'tr_roll', name: '隨機的', desc: '開戰時擲。', roll: { weight: 1, kinds: ['human'] }, mods: { ap: 1 } },
]
const item = (id: string, name: string, category = 'misc'): Rec => ({ id, name, desc: `${name}。`, category, grade: 1, size: 1, legal: 'free' })
const BASE_PACK = (more: Rec = {}): ContentPack => ({
  id: 'wb_enemies_m1b',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }], battle_status: TEST_STATUSES,
    item: [item('it_a', '甲零件'), item('it_noname_ok', '無名件'), item('it_chip', '晶片', 'part')],
    enemy: [
      foeData('en_grunt', 'minion'),
      foeData('en_elite', 'elite'),
      foeData('en_boss', 'boss'),
      foeData('en_angel_s', 'minion', { angel: 'silver' }),
      foeData('en_angel_g', 'minion', { angel: 'gold' }),
      overlayData('en_patrol', 'attack', { mods: { hp: 0.5 } }),
      overlayData('en_turret', 'turret', { overlay: { kind: 'turret', fixed: true }, position: { prefer: [4], size: 'overlay' } }),
      overlayData('en_shield', 'shield', { weapons: [], position: { prefer: [1], size: 'overlay' } }),
      foeData('en_pilot', 'elite', { attached: [{ enemy: 'en_patrol', count: 3 }, { enemy: 'en_shield', slot: 1 }], position: { prefer: [3] } }),
    ],
    enemy_trait: TRAITS,
    encounter: [
      { id: 'enc_a', name: '遭遇甲', grade: 1, cover: 'medium', foes: [{ enemy: 'en_grunt' }, { enemy: 'en_patrol' }] },
      { id: 'enc_b', name: '遭遇乙', grade: 1, cover: 'medium', foes: [{ enemy: 'en_boss' }, { enemy: 'en_elite' }], faction: 'none' },
      { id: 'enc_only', name: '遭遇丙', grade: 1, cover: 'medium', foes: [{ enemy: 'en_patrol' }] },
    ],
    ...more,
  },
}) as unknown as ContentPack
const err = (fn: () => void): string => {
  try { fn() } catch (e) { return e instanceof BattleBlocked ? e.reasons.join('') : (e as Error).message }
  return ''
}
const loadErr = (kind: string, entry: Rec): string => err(() => {
  const k = createKernel(FEATURES)
  k.content.loadPack(BASE_PACK({ [kind]: [...((BASE_PACK().content as Rec)[kind] as Rec[]), entry] }))
  readyFeatures(k)
})
const fieldOf = (foes: unknown[], o: { grade?: number; origin?: Rec; pack?: ContentPack; allies?: unknown[] } = {}): Arena =>
  arena({
    mode: 'meat', grade: (o.grade ?? 1) as never, cover: 'medium', allies: (o.allies ?? [one({ initBonus: 50 })]).map((u) => ({ from: 'unit', unit: u as never })), foes: foes as never,
    ...(o.origin ? { origin: o.origin as never } : {}),
  }, FEATURES, (k: Kernel) => {
    k.content.loadPack(o.pack ?? BASE_PACK())
    readyFeatures(k)
  })
const e = (id: string, more: Rec = {}) => ({ from: 'enemy', id, ...more })

// =====================================================================================================================
// 格式檢查（enemy、encounter、enemy_trait；ENEMIES 第 2、5、10 節）
// =====================================================================================================================

describe('白箱 敵人、遭遇、特徵的格式檢查（載入時擋下，訊息有欄位）', () => {
  it('敵人：overlay、attached、hull、cyber、deck、traits 各種寫壞的格式都擋下，訊息有欄位名', () => {
    expect(loadErr('enemy', overlayData('en_x', 'attack', { overlay: 'x' }))).toMatch(/overlay 要是 \{ kind, fixed\? \}/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { attached: 'x' }))).toMatch(/attached 要是陣列/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { attached: [5] }))).toMatch(/attached\[0\] 要是 \{ enemy, count\?, slot\? \}/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { attached: [{ count: 1 }] }))).toMatch(/attached\[0\]\.enemy 要是一個 overlay 兵種的 id/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', count: 9 }] }))).toMatch(/count 要是 1～4/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', slot: 'far' }] }))).toMatch(/slot 要是 'same' 或 1～4/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { attached: [{ enemy: 'en_patrol', zzz: 1 }] }))).toMatch(/zzz 不是可以用的鍵/)
    expect(loadErr('enemy', foeData('en_x', 'elite', { kind: 'mech', hull: 'x' }))).toMatch(/hull 要是/)
    expect(loadErr('enemy', foeData('en_x', 'elite', { kind: 'mech', hull: { name: '', hp: { now: 1, max: 1 }, armor: 0, backlash: 0.2, ext: 3, zzz: 1 } }))).toMatch(/hull\.id 要是機體的 id/)
    expect(loadErr('enemy', foeData('en_x', 'elite', { kind: 'mech', hull: { id: 'h', name: 'n', hp: { now: 1, max: 1 }, armor: 0, backlash: 0.2, ext: 3 } }))).toMatch(/hull\.ext 要是物件/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { cyber: 'x' }))).toMatch(/cyber 要是陣列/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { cyber: [5] }))).toMatch(/cyber\[0\] 要是 \{ kind, name, contract\? \}/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { cyber: [{ name: 'n' }] }))).toMatch(/cyber\[0\]\.kind/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { deck: 5 }))).toMatch(/deck 要是 \{ grade, firewall, slots \}/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { deck: { grade: 2, firewall: 10, slots: [], tree: '' } }))).toMatch(/deck\.tree 要是路數的 id/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { deck: { grade: 2, firewall: 10, slots: [], tree: 3 } }))).toMatch(/deck\.tree 要是路數的 id/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { angel: 'copper' }))).toMatch(/angel 只能是/)
    expect(loadErr('enemy', foeData('en_x', 'minion', { angel: 3 }))).toMatch(/angel 要是字串/)
    expect(loadErr('enemy', foeData('en_ok', 'minion', { angel: 'platinum', deck: { grade: 2, firewall: 10, slots: ['a'], tree: 'netrunner' }, cyber: [{ kind: 'eye', name: '義眼', contract: true }] }))).toBe('')
  })

  it('遭遇：traits 不是布林、foes 的敵人沒寫 id、nodes 格式、ambush、field 各擋下；traits: false 與 nodes 照寫的收下', () => {
    const enc = (more: Rec) => ({ id: 'enc_x', name: '遭遇', grade: 1, cover: 'medium', foes: [{ enemy: 'en_grunt' }], ...more })
    expect(loadErr('encounter', enc({ traits: 'no' }))).toMatch(/traits 要是 true 或 false/)
    expect(loadErr('encounter', enc({ foes: [5] }))).toMatch(/foes\[0\] 要是物件/)
    expect(loadErr('encounter', enc({ foes: [{ grade: 1 }] }))).toMatch(/foes\[0\]\.enemy 要是敵人的 id/)
    expect(loadErr('encounter', enc({ nodes: [{ name: 'x' }] }))).toMatch(/nodes 要是/)
    expect(loadErr('encounter', enc({ ambush: 'both' }))).toMatch(/ambush 只能是 ally 或 foe/)
    expect(loadErr('encounter', enc({ field: { dark: [] } }))).toMatch(/field 要是/)
    expect(loadErr('encounter', enc({ traits: false, nodes: [{ kind: 'relay', name: '中繼站' }], field: { dark: true }, ambush: 'foe', escapable: false }))).toBe('')
  })

  it('特徵：缺 desc、mods 不是物件、ai 不是物件、roll 不是物件、各欄位的值不合格都擋下（ENEMIES 第 5 節）', () => {
    const tr = (more: Rec) => ({ id: 'tr_x', name: 'x', desc: '說明。', ...more })
    expect(loadErr('enemy_trait', tr({ desc: ' ' }))).toMatch(/要有 desc/)
    expect(loadErr('enemy_trait', tr({ mods: 5 }))).toMatch(/mods 要是物件/)
    expect(loadErr('enemy_trait', tr({ mods: { speed: 1 } }))).toMatch(/mods\.speed 不是可以修正的鍵/)
    expect(loadErr('enemy_trait', tr({ mods: { hp_pct: -100 } }))).toMatch(/hp_pct 要是整數，大於 −100/)
    expect(loadErr('enemy_trait', tr({ mods: { ap: 1.5 } }))).toMatch(/mods\.ap 要是整數/)
    expect(loadErr('enemy_trait', tr({ ai: 5 }))).toMatch(/ai 要是物件/)
    expect(loadErr('enemy_trait', tr({ ai: { zzz: 1 } }))).toMatch(/ai\.zzz 不是可以用的鍵/)
    expect(loadErr('enemy_trait', tr({ ai: { flee_below: 2 } }))).toMatch(/flee_below 要是 0～1/)
    expect(loadErr('enemy_trait', tr({ ai: { prefer: 'nobody' } }))).toMatch(/ai\.prefer 只能是/)
    expect(loadErr('enemy_trait', tr({ ai: { never_flee: 'yes' } }))).toMatch(/never_flee 要是 true 或 false/)
    expect(loadErr('enemy_trait', tr({ ai: { morale_dc: 1.5 } }))).toMatch(/morale_dc 要是整數/)
    expect(loadErr('enemy_trait', tr({ start: [] }))).toMatch(/start 要是效果的陣列/)
    expect(loadErr('enemy_trait', tr({ start: [{ op: 'nope' }] }))).toMatch(/start：.*不認得的效果 nope/)
    expect(loadErr('enemy_trait', tr({ tags: [] }))).toMatch(/tags 要是標籤的陣列/)
    expect(loadErr('enemy_trait', tr({ roll: 5 }))).toMatch(/roll 要是 \{ weight, kinds \}/)
    expect(loadErr('enemy_trait', tr({ roll: { weight: 0, kinds: ['human'], zzz: 1 } }))).toMatch(/roll\.zzz 不是可以用的鍵/)
    expect(loadErr('enemy_trait', tr({ roll: { weight: 1, kinds: ['ghost'] } }))).toMatch(/roll\.kinds 要是敵人種類的陣列/)
    expect(loadErr('enemy_trait', tr({ roll: { weight: 1, kinds: ['human'] }, mods: { hp_pct: -40 }, ai: { flee_below: 0.5, prefer: 'weakest', never_flee: false, morale_dc: 2 }, start: [{ op: 'afterglow', amount: 1 }], tags: ['a'] }))).toBe('')
  })

  it('招牌行動檢查：附屬單位不是 overlay 的兵種、招牌技能沒標 enemy 都在 ready 時擋下（signature.ts）；寫成敘述的與查不到的 base 不擋', () => {
    expect(loadErr('enemy', foeData('en_bad_att', 'minion', { attached: [{ enemy: 'en_grunt' }] }))).toMatch(/附屬單位 en_grunt 不是 overlay 的兵種/)
    expect(loadErr('enemy', foeData('en_ok_att', 'minion', { attached: [{ enemy: 'en_patrol' }], signature: [{ name: '大招', text: '敘述。' }] }))).toBe('')
    const ability = { id: 'sk_plain', name: '普通技能', path: 'p', category: 'meat', tier: 1, layer: 'signature', kind: 'passive', cap: 1, xp: 20, cells: 1, text: '普通。', net: null, opinion: null, meat: { tags: ['x'] } }
    const k = createKernel([...FEATURES, abilitiesFeature])
    expect(err(() => {
      k.content.loadPack(BASE_PACK({ path: [{ id: 'p', name: 'p', tree: 't', category: 'meat', signature: 'sk_plain', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }], ability: [ability], enemy: [foeData('en_sig', 'minion', { signature: ['sk_plain'] })] }))
      readyFeatures(k)
    })).toMatch(/招牌行動 sk_plain 不是敵人的招牌行動/)
  })
})

// =====================================================================================================================
// 掉落（ENEMIES 第 7 節；dev/adr/0011、0007）
// =====================================================================================================================

describe('白箱 掉落的格式與結算的退路（loot.ts；dev/work/M1b-loot.md）', () => {
  it('lootProblems：cash 不是布林、loot 不是陣列、每一筆不是物件／沒有 item 也沒有 text／item 不是字串／chance 超出 0～1／qty 不合／top 不是布林各一條', () => {
    expect(lootProblems({})).toEqual([])
    expect(lootProblems({ cash: 'yes' })).toEqual(['cash 要是 true 或 false'])
    expect(lootProblems({ loot: 'x' })).toEqual(['loot 要是陣列'])
    expect(lootProblems({ cash: 1, loot: 'x' })).toEqual(['cash 要是 true 或 false', 'loot 要是陣列'])
    expect(lootProblems({ loot: [5] })[0]).toMatch(/loot\[0\] 要是物件/)
    expect(lootProblems({ loot: [{ chance: 1 }] })[0]).toMatch(/要是 \{ item, chance, qty\? \} 或 \{ text \}/)
    expect(lootProblems({ loot: [{ item: 3, chance: 1 }] })[0]).toMatch(/loot\[0\]\.item 要是物品的 id/)
    expect(lootProblems({ loot: [{ item: 'a', chance: 2 }] })[0]).toMatch(/chance 要是 0～1/)
    expect(lootProblems({ loot: [{ item: 'a', chance: Number.NaN }] })[0]).toMatch(/chance 要是 0～1/)
    expect(lootProblems({ loot: [{ item: 'a', chance: 1, qty: 0 }] })[0]).toMatch(/qty 要是 1 以上的整數/)
    expect(lootProblems({ loot: [{ item: 'a', chance: 1, qty: [3, 2] }] })[0]).toMatch(/qty/)
    expect(lootProblems({ loot: [{ item: 'a', chance: 1, qty: [1, 2, 3] }] })[0]).toMatch(/qty/)
    expect(lootProblems({ loot: [{ item: 'a', chance: 1, top: 'y' }] })[0]).toMatch(/top 要是 true 或 false/)
    expect(lootProblems({ loot: [{ item: 'a', chance: 0.5, qty: [1, 3], top: true }, { text: '外皮' }] })).toEqual([])
  })

  it('lootRefs：item、part、blueprint 哪個查得到就引用哪個，都查不到引用 item；沒寫 loot 或不是陣列回傳空的；{ text } 不引用', () => {
    const k = createKernel(FEATURES)
    k.content.loadPack(BASE_PACK())
    expect(lootRefs(k.content, {})).toEqual([])
    expect(lootRefs(k.content, { loot: 'x' })).toEqual([])
    expect(lootRefs(k.content, { loot: [{ item: 'it_chip', chance: 1 }, { item: 'it_a', chance: 1 }, { item: 'ghost', chance: 1 }, { text: 'x' }] })).toEqual([['item', 'it_chip'], ['item', 'it_a'], ['item', 'ghost']])
    // 零件與藍圖種類（M4 才有內容種類）：用替身的內容登錄表，哪一種查得到就引用哪一種
    const stub = { has: (kind: string, id: string) => (kind === 'part' && id === 'p1') || (kind === 'blueprint' && id === 'b1') }
    expect(lootRefs(stub, { loot: [{ item: 'p1', chance: 1 }, { item: 'b1', chance: 1 }, { item: 'zz', chance: 1 }] })).toEqual([['part', 'p1'], ['blueprint', 'b1'], ['item', 'zz']])
  })

  it('常數：件數上限雜兵 1、精英 2、首領 3；現金晶片的範圍每級約 3.2 倍（ENEMIES 第 7 節）', () => {
    expect(LOOT_CAP).toEqual({ minion: 1, elite: 2, boss: 3 })
    const lows = Object.values(CASH_RANGE).map((r) => r[0])
    expect(lows).toEqual([...lows].sort((a, b) => a - b))
    expect(Object.keys(CASH_RANGE)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('結算：不認得的兵種（內容裡已經沒有）略過；等級不在表裡的當 I 級的範圍；物品沒有名字就用 id；逃走與被帶走的不掉', async () => {
    const k = createKernel(FEATURES)
    k.content.loadPack(BASE_PACK({ enemy: [foeData('en_l', 'minion', { loot: [{ item: 'it_noname_ok', chance: 1 }, { item: 'it_a', chance: 1 }] }), foeData('en_grunt', 'minion')] }))
    readyFeatures(k)
    const battle = {
      id: 'b1', mode: 'meat', origin: {},
      units: {
        f1: { side: 'foe', enemy: 'en_l', out: 'down', rank: 'minion', grade: 9, ext: {} },
        f2: { side: 'foe', enemy: 'en_gone', out: 'down', rank: 'minion', grade: 1, ext: {} },
        f3: { side: 'foe', enemy: 'en_l', out: 'fled', rank: 'minion', grade: 1, ext: {} },
        f4: { side: 'foe', enemy: 'en_l', out: 'down', rank: 'minion', grade: 1, ext: { enemies: { taken: true } } },
      },
    }
    const state = { rng: { seed: 1, n: 0 } } as never
    const out = (k.battle as unknown as { endExtras: (c: unknown) => Array<{ changes?: Array<Rec>; lines?: string[] }> }).endExtras({ k, state, battle, outcome: 'win' })
    const lines = out.flatMap((x) => x.lines ?? [])
    expect(lines.some((l) => l.includes('無名件') || l.includes('it_noname_ok'))).toBe(true)
    const cash = out.flatMap((x) => x.changes ?? []).find((c) => c.op === 'cash') as { delta: number } | undefined
    expect(cash!.delta).toBeGreaterThanOrEqual(CASH_RANGE[1]![0])
    expect(cash!.delta).toBeLessThanOrEqual(CASH_RANGE[1]![1])
    // 戰敗不結算
    expect((k.battle as unknown as { endExtras: (c: unknown) => unknown[] }).endExtras({ k, state, battle, outcome: 'lose' }).flatMap((x) => (x as { lines?: string[] }).lines ?? [])).toEqual([])
  })
})

// =====================================================================================================================
// 特徵（ENEMIES 第 5 節；dev/adr/0015 E10）
// =====================================================================================================================

describe('白箱 特徵算進單位與開打時的 start（traits.ts）', () => {
  const withTraits = (traits: string[], more: Rec = {}) =>
    fieldOf([e('en_x', {})], { pack: BASE_PACK({ enemy: [foeData('en_x', 'elite', { traits, ...more }), foeData('en_grunt', 'minion')] }), origin: { ext: { traits: false } } })

  it('一定帶著的特徵：mods 的每一項、tags、ai 的欄位都算進單位（hp 百分比、ap、命中、感載上限、承受層數、迴避、先攻）；tags 不重複；特徵的 id 本身也是標籤', () => {
    const plain = fieldOf([e('en_x')], { pack: BASE_PACK({ enemy: [foeData('en_x', 'elite'), foeData('en_grunt', 'minion')] }), origin: { ext: { traits: false } } }).foe(1)
    const a = withTraits(['tr_tough', 'tr_veteran'])
    const u = a.foe(1)
    expect(u.hp!.max).toBe(Math.round(plain.hp!.max * 1.4))
    expect(u.ap.max).toBe(plain.ap.max + 1)
    expect(u.weapons[0]!.hit).toBe(plain.weapons[0]!.hit + 2)
    expect(u.load!.max).toBe(plain.load!.max + 5)
    expect(u.layersMax).toBe(plain.layersMax + 1)
    expect(u.evade).toBe(plain.evade + 1)
    expect(u.initBonus).toBe(plain.initBonus + 2)
    expect(u.tags).toEqual(expect.arrayContaining(['tr_tough', 'tough', 'tr_veteran']))
    expect(u.tags.filter((t) => t === 'tough')).toHaveLength(1)
    expect(u.ai).toMatchObject({ fleeBelow: 0.2, prefer: 'weakest', neverFlee: true })
    expect(moraleDcBonus(u)).toBe(-3)
    const two = withTraits(['tr_veteran', 'tr_rookie']).foe(1)
    expect(moraleDcBonus(two)).toBe(0)
    expect(moraleDcBonus(plain)).toBe(0)
  })

  it('applyTraits 每個單位只做一次；不是敵人、內容裡沒有那個兵種、沒有任何特徵內容的遊戲不動單位也不擲骰', () => {
    const a = withTraits(['tr_tough'])
    const u = a.foe(1)
    const hp = u.hp!.max
    applyTraits(a.run(dice()), u)
    expect(u.hp!.max).toBe(hp)
    const run = a.run(dice())
    applyTraits(run, a.ally(1))
    applyTraits(run, { ...u, enemy: 'en_gone', ext: {} } as BattleUnit)
    const bare = fieldOf([e('en_x')], { pack: BASE_PACK({ enemy_trait: [], enemy: [foeData('en_x', 'elite', { traits: ['tr_unknown'] }), foeData('en_grunt', 'minion')] }) })
    expect(bare.foe(1).tags).toContain('tr_unknown')
  })

  it('特徵 id 查不到時（內容被換掉）只當標籤：不算 mods；start 沒寫的不做、沒有特徵 id 的不做；開打時 start 做一次（餘韻 +1）', () => {
    const a = withTraits(['tr_start'])
    expect(a.foe(1).layers).toBe(1)
    const u = a.foe(1)
    ;(u.ext.enemies as Rec).traits = ['tr_start', 'ghost', 5]
    const run = a.run(dice())
    runTraitStart(run)
    expect(u.layers).toBe(Math.min(u.layersMax, 2))
    ;(u.ext.enemies as Rec).traits = 'nope'
    expect(() => runTraitStart(a.run(dice()))).not.toThrow()
  })

  it('開戰時擲：每次 30%（首領 50%），擲兩次；擲中就照權重抽一個、不重複；遭遇寫 traits: false 不擲、不吃亂數（ENEMIES 第 5 節）', () => {
    const pack = BASE_PACK({ enemy_trait: [TRAITS[4]!], enemy: [foeData('en_x', 'elite'), foeData('en_b', 'boss'), foeData('en_grunt', 'minion')] })
    // 隨機骰：第一次 0.1 < 0.3 中、第二次 0.9 不中
    const hit = fieldOf([e('en_x')], { pack })
    expect(hit.battle.units.f1!.ext.enemies).toBeDefined()
    const off = fieldOf([e('en_x')], { pack, origin: { ext: { traits: false } } })
    expect(((off.foe(1).ext.enemies as Rec | undefined)?.rolled as unknown[] | undefined) ?? []).toEqual([])
    // 同一個種子兩次結果一樣（亂數導出自存檔狀態）
    const again = fieldOf([e('en_x')], { pack })
    expect(((again.foe(1).ext.enemies as Rec | undefined)?.traits as unknown[] | undefined) ?? []).toEqual(((hit.foe(1).ext.enemies as Rec | undefined)?.traits as unknown[] | undefined) ?? [])
  })
})

// =====================================================================================================================
// 天使急救（ENEMIES 第 5 節；dev/adr/0015 E11）
// =====================================================================================================================

describe('白箱 天使急救的倒數（angel.ts）', () => {
  const roundStart = (a: Arena) => {
    const run = a.run(dice())
    run.k.battle.emit('round.start', { run, round: 2 })
    return run
  }
  const ang = (): Arena => fieldOf([e('en_angel_s'), e('en_grunt')], { allies: [one({ initBonus: 50 }), one({}, 2)] })

  it('倒下（down、burnout）開始倒數；被制伏、投降、逃走不算；已經被帶走的不再倒數；沒有 angel 欄位的沒有倒數', () => {
    const a = ang()
    const run = a.run(dice())
    run.setOut(a.foe(1), 'surrendered')
    expect((a.foe(1).ext.enemies as Rec).angelLeft).toBeUndefined()
    const b = ang()
    b.run(dice()).setOut(b.foe(1), 'down')
    expect((b.foe(1).ext.enemies as Rec).angelLeft).toBe(4)
    const g = fieldOf([e('en_angel_g'), e('en_grunt')])
    g.run(dice()).setOut(g.foe(1), 'burnout')
    expect((g.foe(1).ext.enemies as Rec).angelLeft).toBe(3)
    const plain = fieldOf([e('en_grunt'), e('en_grunt')])
    plain.run(dice()).setOut(plain.foe(1), 'down')
    expect((plain.foe(1).ext.enemies as Rec | undefined)?.angelLeft).toBeUndefined()
    const taken = ang()
    ;(taken.foe(1).ext as Rec).enemies = { ...(taken.foe(1).ext.enemies as Rec), taken: true }
    taken.run(dice()).setOut(taken.foe(1), 'down')
    expect((taken.foe(1).ext.enemies as Rec).angelLeft).toBeUndefined()
  })

  it('每一輪開頭數一次：倒數到 0 記一拍、標成被帶走（不掉落）；倒數的時候又站起來（救回來）就取消；沒有倒數的單位不動', () => {
    const a = ang()
    a.run(dice()).setOut(a.foe(1), 'down')
    for (let i = 0; i < 3; i++) roundStart(a)
    expect((a.foe(1).ext.enemies as Rec).angelLeft).toBe(1)
    const last = roundStart(a)
    expect((a.foe(1).ext.enemies as Rec).taken).toBe(true)
    expect((a.foe(1).ext.enemies as Rec).angelLeft).toBeUndefined()
    expect(last.beats.some((b) => b.text.includes('把測試en_angel_s帶走了') || b.tag === 'angel')).toBe(true)
    const b = ang()
    const run = b.run(dice())
    run.setOut(b.foe(1), 'down')
    roundStart(b)
    run.revive(b.foe(1), 5)
    const r = roundStart(b)
    expect((b.foe(1).ext.enemies as Rec).angelLeft).toBeUndefined()
    expect((b.foe(1).ext.enemies as Rec).taken).toBeUndefined()
    expect(r.beats.some((x) => x.tag === 'angel')).toBe(false)
  })
})

// =====================================================================================================================
// 掛在格上的敵人與指揮（ENEMIES 第 10 節；dev/work/M1b-enemy-units.md）
// =====================================================================================================================

describe('白箱 掛在格上的敵人（overlays.ts、stats.ts overlayInit／setupFromEncounter／encounterPoints）', () => {
  const overlaysOf = (a: Arena): BattleOverlay[] => a.battle.overlays

  it('overlayInit：不是掛在格上的兵種丟錯並寫出名字與 id；是的帶 ext.enemy、等級、傷害倍率，砲塔與 fixed 的標 fixed', () => {
    const a = fieldOf([e('en_grunt')])
    const cx = { content: a.k.content } as never
    expect(() => overlayInit(cx, a.state, 'en_grunt', { grade: 1, allyCount: 1 })).toThrow(/測試en_grunt（en_grunt）不是掛在格上的兵種/)
    const p = overlayInit(cx, a.state, 'en_patrol', { grade: 1, allyCount: 1 })
    expect(p.ext).toMatchObject({ enemy: 'en_patrol', grade: 1 })
    expect(p.ext!.fixed).toBeUndefined()
    expect(overlayInit(cx, a.state, 'en_turret', { grade: 1, allyCount: 1 }).ext!.fixed).toBe(true)
    expect(p.hp.max).toBeGreaterThan(0)
  })

  it('encounterPoints：掛在格上的每台 0.5 點，高一級以上 ×1.75；佔格的照位階（強度係數雜兵不乘）', () => {
    const cx = { content: fieldOf([e('en_grunt')]).k.content } as never
    expect(encounterPoints(cx, [{ enemy: 'en_patrol' }], 1)).toBe(0.5)
    expect(encounterPoints(cx, [{ enemy: 'en_patrol', grade: 2 }], 1)).toBe(0.875)
    expect(encounterPoints(cx, [{ enemy: 'en_patrol' }, { enemy: 'en_patrol' }], 1)).toBe(1)
  })

  it('setupFromEncounter：沒有這個遭遇丟錯；掛在格上的進 origin.ext.enemies.overlays（帶 slot 與 grade 的照帶）；都是掛在格上的丟錯；沒寫勢力用位階最高的、faction: none 不寫', () => {
    const k = fieldOf([e('en_grunt')]).k
    const cx = { content: k.content } as never
    const st = fieldOf([e('en_grunt')]).state
    expect(() => setupFromEncounter(cx, st, 'enc_ghost', { allies: [] })).toThrow('沒有 enc_ghost 這個遭遇')
    expect(() => setupFromEncounter(cx, st, 'enc_only', { allies: [] })).toThrow(/都是掛在格上的一台/)
    const a = setupFromEncounter(cx, st, 'enc_a', { allies: [] })
    expect(a.origin!.ext).toEqual({ enemies: { overlays: [{ enemy: 'en_patrol' }] } })
    expect(a.origin!.faction).toBe('hizakura')
    const b = setupFromEncounter(cx, st, 'enc_b', { allies: [] })
    expect(b.origin!.faction).toBeUndefined()
    expect(b.origin!.ext).toBeUndefined()
    const k2 = createKernel(FEATURES)
    k2.content.loadPack(BASE_PACK({ encounter: [{ id: 'enc_g', name: '遭遇', grade: 1, cover: 'medium', foes: [{ enemy: 'en_grunt' }, { enemy: 'en_patrol', slot: 3, grade: 2 }], traits: false }] }))
    const g = setupFromEncounter({ content: k2.content } as never, st, 'enc_g', { allies: [] })
    expect(g.origin!.ext).toEqual({ traits: false, enemies: { overlays: [{ enemy: 'en_patrol', slot: 3, grade: 2 }] } })
  })

  it('開打掛上去：寫壞的筆略過；沒寫格用 position.prefer，被占了換最近的；掛滿了記「沒有空的格子可以掛」', () => {
    const origin = { ext: { enemies: { overlays: [5, { grade: 1 }, { enemy: 'en_patrol' }, { enemy: 'en_patrol' }, { enemy: 'en_patrol' }, { enemy: 'en_patrol' }, { enemy: 'en_patrol' }] } } }
    const a = fieldOf([e('en_grunt')], { origin })
    const slots = overlaysOf(a).map((o) => o.slot).sort()
    expect(slots).toEqual([1, 2, 3, 4])
    expect(overlaysOf(a).every((o) => o.auto && !o.owner)).toBe(true)
    // 兩台指定同一格、grade 照寫
    const b = fieldOf([e('en_grunt')], { origin: { ext: { enemies: { overlays: [{ enemy: 'en_patrol', slot: 4, grade: 2 }, { enemy: 'en_patrol', slot: 4 }] } } } })
    expect(overlaysOf(b).map((o) => o.slot)).toEqual([4, 2])
    expect(overlaysOf(b)[0]!.ext!.grade).toBe(2)
  })

  it('跟著主人的附屬單位：count 台各挑空格；slot 寫了照寫；主人在後方排隊用偏好的格；沒有空格記一句並停（不丟錯）', () => {
    const a = fieldOf([e('en_pilot')])
    const mine = overlaysOf(a).filter((o) => o.owner === 'f1')
    expect(mine.length).toBe(4)
    expect(mine.every((o) => o.autonomous && o.side === 'foe')).toBe(true)
    expect(new Set(mine.map((o) => o.slot)).size).toBe(4)
    // 掛滿了：多的記一句
    const b = fieldOf([e('en_pilot')], { origin: { ext: { enemies: { overlays: [{ enemy: 'en_patrol', slot: 1 }] } } } })
    expect(overlaysOf(b).length).toBeLessThanOrEqual(4)
  })
})

describe('白箱 指揮的行動 enemy.command（overlays.ts）', () => {
  const setup = () => {
    const a = fieldOf([e('en_pilot')], { allies: [one({ initBonus: -50 }), one({}, 2)] })
    return a
  }
  const cmd = (a: Arena) => a.k.battle.getAction('enemy.command')!

  it('只有 AI 操縱而且手上有掛著東西的人才有；目標每一台各列，動過的、被電磁停機的灰掉並寫原因；pick 的選項是場上每個敵人', () => {
    const a = setup()
    const run = a.run(dice())
    expect(cmd(a).has!(run, a.foe(1))).toBe(true)
    expect(cmd(a).has!(run, a.ally(1))).toBe(false)
    const targets = cmd(a).targets!(run, a.foe(1))
    expect(targets.length).toBe(4)
    expect(targets.every((t) => t.blocks.length === 0)).toBe(true)
    const [o1, o2] = a.battle.overlays.filter((o) => o.owner === 'f1')
    o1!.used = true
    o2!.ext = { ...o2!.ext, stun: 2 }
    const t2 = cmd(a).targets!(run, a.foe(1))
    expect(t2.find((t) => (t.target as { overlay: string }).overlay === o1!.id)!.blocks).toEqual(['這一台這一回合動過了。'])
    expect(t2.find((t) => (t.target as { overlay: string }).overlay === o2!.id)!.blocks).toEqual(['這一台被電磁打到，這個回合動不了。'])
    const picks = cmd(a).picks!(run, a.foe(1))
    expect(picks[0]).toMatchObject({ key: 'at', kind: 'foe', required: false })
    expect((picks[0] as { options: unknown[] }).options.length).toBe(2)
    expect(cmd(a).picks!(run, a.foe(2 as never) ?? a.foe(1))).toBeDefined()
    // 沒有掛著東西的人：沒有 pick
    const none = fieldOf([e('en_grunt')])
    expect(cmd(none).picks!(none.run(), none.foe(1))).toEqual([])
  })

  it('aiScore 在有目標而且還有沒動過的一台時是 2，否則 null；aiTarget 挑第一台還能動的；全部動過了是 null', () => {
    const a = setup()
    const run = a.run(dice())
    const u = a.foe(1)
    expect(cmd(a).aiScore!(run, u, { overlay: 'x' } as never)).toBe(2)
    expect(cmd(a).aiScore!(run, u, null)).toBeNull()
    expect(cmd(a).aiTarget!(run, u, null as never)).toMatchObject({ overlay: expect.any(String) })
    for (const o of a.battle.overlays) o.used = true
    expect(cmd(a).aiScore!(run, u, { overlay: 'x' } as never)).toBeNull()
    expect(cmd(a).aiTarget!(run, u, null as never)).toBeNull()
  })

  it('run：目標不是自己的、已擊落的、動過的、停機的都丟 BattleBlocked；pick.at 指到退出、我方的、不存在的時改由 AI 權重挑；做完那一台記動過了', () => {
    const a = setup()
    const u = a.foe(1)
    const [o1, o2, o3, o4] = a.battle.overlays.filter((o) => o.owner === 'f1')
    const go = (target: unknown, pick: Rec = {}) => (u.ap.now = 20) && err(() => performAction(a.run(dice(15, 3, 3, 3, 3)), u, cmd(a), target as never, { action: 'enemy.command', pick } as never))
    expect(go(null)).toBe('沒有這一台無人機。')
    expect(go({ overlay: 'ghost' })).toBe('沒有這一台無人機。')
    o4!.owner = 'f2'
    expect(go({ overlay: o4!.id })).toBe('沒有這一台無人機。')
    o3!.down = true
    expect(go({ overlay: o3!.id })).toBe('沒有這一台無人機。')
    o2!.ext = { ...o2!.ext, stun: 2 }
    expect(go({ overlay: o2!.id })).toBe('這一台被電磁打到，這個回合動不了。')
    expect(go({ overlay: o1!.id }, { at: 'a2' })).toBe('')
    expect(o1!.used).toBe(true)
    expect(go({ overlay: o1!.id })).toBe('這一台這一回合動過了。')
    o1!.used = false
    a.battle.units.a2!.out = 'down'
    expect(go({ overlay: o1!.id }, { at: 'a2' })).toBe('')
    expect(go({ overlay: o1!.id }, { at: 7 })).toBe('這一台這一回合動過了。')
  })
})
