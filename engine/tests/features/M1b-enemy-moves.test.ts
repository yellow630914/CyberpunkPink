// 驗收測試：dev/work/M1b-enemy-moves.md（cpp-feature）。敵人的招牌行動（標了 enemy 的技能：和技能同一套格式）、低血大招、AI 的分數；
// 敵人資料多收的欄位（signature、traits、cyber、deck、mods.sink、angel、defeat）、特徵（內容種類 enemy_trait，一定帶著的與開戰時擲的）、天使急救。
// 規格：ENEMIES 第 2 節、4.3 節、4.5 節、第 5 節、12.1 節（溺感邊緣）；ENEMY_ROSTER 開頭；dev/adr/0015 E10、E11。
// 補充（M1b-ordnance 回報）：buildWeapons 把 weapons[].fx 複製到 BattleWeapon.ext.fx。
// 每個招牌行動、每個特徵、每個敵人都是測試自帶的假資料，不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleRun, aiStep, readyFeatures } from '../../src'
import { abilitiesFeature, equipAbilities, learnBlock } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { fxOf } from '../../src/features/combat/fx'
import { enemiesFeature, setupFromEncounter } from '../../src/features/enemies'
import { makeBattleGame, makeGame } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, one, raw } from '../helpers/battle'

type Rec = Record<string, unknown>
type Entry = Rec & { id: string }
const FEATURES = [combatFeature, abilitiesFeature, enemiesFeature]
/** 骰面：給的先出，之後都是 1（0～1 的亂數拿到的是「值 ÷ 100」）。 */
const dice = (...v: number[]) => [...v, ...Array(150).fill(1)]

// ---- 假資料 ----

const SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
]
const foeData = (id: string, rank: string, more: Rec = {}): Entry => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.3 }, ...more,
})
/** 敵人的招牌行動：不寫 path、tier、layer、cap、xp、after、category。 */
const sig = (id: string, kind: string, more: Rec = {}): Entry => ({ id, name: `招牌${id}`, text: `${id}。`, enemy: true, kind, ...more })

const ABILITIES: Entry[] = [
  // 主動、花 2 點、命中 +1、ai.score 3
  sig('ab_strike', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 1, label: '重擊' }] }, ai: { score: 3 } }),
  // 條件：自己要是重傷才列
  sig('ab_wounded', 'active', { use: { ap: 2 }, meat: { target: 'enemy', when: { wounded: true }, do: [{ op: 'attack', hit: 1 }] }, ai: { score: 3 } }),
  // 條件：目標要帶標記才列
  sig('ab_needs', 'active', { use: { ap: 2 }, meat: { target: 'enemy', needs: { status: 'marked' }, do: [{ op: 'attack', hit: 1 }] }, ai: { score: 3 } }),
  // 第一、二回合 +1.5
  sig('ab_opener', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 1 }] }, ai: { score: 3, first_rounds: 1.5 } }),
  // 低血才解開的大招
  sig('ab_ult', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 3, label: '大招' }] }, ai: { score: 3, unlock: 'low' } }),
  // 反應：相鄰的友軍被攻擊時，那一擊的命中 −2
  sig('ab_guard', 'reaction', { use: { ap: 1 }, meat: { trigger: { on: 'attacked', who: 'adjacent' }, react: { hit: -2 } } }),
  // 姿態：開著迴避 +2
  sig('ab_stance', 'stance', { use: { ap: 1 }, meat: { mods: [{ kind: 'evade', value: 2 }] } }),
  // 治療：目標低於六成才列
  sig('ab_mend', 'active', { use: { ap: 1 }, meat: { target: 'ally', do: [{ op: 'heal', amount: 5 }] }, ai: { score: 3, when: { target_hp_below: 0.6 } } }),
  // 要玩家選的東西：AI 填不出來，不列
  sig('ab_picky', 'active', { use: { ap: 1 }, meat: { target: 'enemy', picks: [{ key: 'foe2', label: '另一個敵人', kind: 'foe' }], do: [{ op: 'attack', hit: 1 }] }, ai: { score: 3 } }),
  // 沒有 ai：AI 不用
  sig('ab_quiet', 'active', { use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 1 }] } }),
  // 被動
  sig('ab_tough', 'passive', { meat: { mods: [{ kind: 'armor', value: 2 }] } }),
  // 玩家的技能（一般的格式）：不受影響
  { id: 'sk_root', name: '根', text: '根。', path: 'tree', category: 'meat', tier: 1, layer: 'signature', kind: 'passive', cap: 1, xp: 20, cells: 1, net: null, opinion: null, meat: null },
]
const TREE = { id: 'tree', name: '測試路數', tree: '測試樹', category: 'meat', signature: 'sk_root', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }

const TRAITS: Entry[] = [
  { id: 'tr_hurt', name: '受傷', desc: '生命只剩六成；命中 −1；撤退的門檻 0.3。', mods: { hp_pct: -40, hit: -1 }, ai: { flee_below: 0.3 } },
  { id: 'tr_veteran', name: '老兵', desc: '命中 +1；士氣 DC −3。', mods: { hit: 1 }, ai: { morale_dc: -3 } },
  { id: 'tr_rookie', name: '新人', desc: '命中 −1；士氣 DC +3。', mods: { hit: -1 }, ai: { morale_dc: 3 } },
  { id: 'tr_high', name: '嗑了藥', desc: '行動點 +1；感載上限 −4。', mods: { ap: 1, load_cap: -4 } },
  { id: 'tr_glow', name: '帶著餘韻', desc: '開戰就帶 1 層餘韻。', start: [{ op: 'afterglow', amount: 1 }] },
  { id: 'tr_edge', name: '溺感邊緣', desc: '承受層數 +1。', mods: { layers_max: 1 } },
  { id: 'tr_contract', name: '契約人', desc: '不投降、不撤退。', tags: ['contract'] },
  { id: 'tr_cat', name: '貓系獸化', desc: '先攻 +3。', mods: { initiative: 3, evade: 1 } },
  { id: 'tr_dog', name: '犬系獸化', desc: '偏好最近的目標。', ai: { prefer: 'nearest', never_flee: true } },
]
const ROLLS: Entry[] = [
  { id: 'tr_r1', name: '可擲一', desc: '擲得到。', tags: ['r1'], roll: { weight: 1, kinds: ['human'] } },
  { id: 'tr_r2', name: '可擲二', desc: '擲得到。', tags: ['r2'], roll: { weight: 1, kinds: ['human'] } },
  { id: 'tr_r3', name: '可擲三', desc: '擲得到。', tags: ['r3'], roll: { weight: 2, kinds: ['human'] } },
  { id: 'tr_m1', name: '機器才擲', desc: '只有機器擲得到。', tags: ['m1'], roll: { weight: 5, kinds: ['machine'] } },
]

const ENEMIES: Entry[] = [
  foeData('en_plain', 'minion'),
  foeData('en_elite', 'elite', { signature: ['ab_strike'] }),
  foeData('en_wounded', 'elite', { signature: ['ab_wounded'] }),
  foeData('en_needs', 'elite', { signature: ['ab_needs'] }),
  foeData('en_opener', 'elite', { signature: ['ab_opener'] }),
  foeData('en_boss', 'boss', { signature: ['ab_ult'], ai: { prefer: 'leader', focus: 1, flee_below: 0, never_flee: true } }),
  foeData('en_guard', 'elite', { signature: ['ab_guard'] }),
  foeData('en_stance', 'elite', { signature: ['ab_stance', 'ab_tough'] }),
  foeData('en_mender', 'elite', { signature: ['ab_mend'] }),
  foeData('en_picky', 'elite', { signature: ['ab_picky', 'ab_quiet'] }),
  foeData('en_text', 'elite', { signature: [{ name: '掃橋', text: '選一個目標，他的迴避 −1，到他下一回合結束。花 1 點行動點，每場一次。份量 1 格。' }, { name: '侍立', text: '相鄰的友軍被攻擊時，那一擊的命中 −2。反應，花 1 點行動點。份量 3 格。' }] }),
  foeData('en_mixed', 'elite', { signature: ['ab_tough', { name: '敘述', text: '還沒轉的敘述。' }] }),
  foeData('en_named', 'boss', { named: true, base: 'en_elite', name: '具名者' }),
  foeData('en_cyber', 'elite', { cyber: [{ kind: 'eye', name: '義眼' }, { kind: 'arm', name: '義臂', contract: true }], deck: { grade: 2, firewall: 12, slots: ['qh_a', 'qh_b'] } }),
  foeData('en_sink85', 'minion', { mods: { sink: 85 } }),
  foeData('en_sink79', 'minion', { mods: { sink: 79 } }),
  foeData('en_defeat', 'minion', { defeat: ['df_a', 'df_b'] }),
  foeData('en_gold', 'elite', { angel: 'gold' }),
  foeData('en_silver', 'elite', { angel: 'silver' }),
  foeData('en_plat', 'elite', { angel: 'platinum' }),
  foeData('en_noangel', 'elite', { angel: 'none' }),
  foeData('en_fx', 'elite', { weapons: [{ class: 'pistol', fx: { hit: 2, pierce: 1 } }, { class: 'melee' }] }),
  foeData('en_hurt', 'elite', { traits: ['tr_hurt'] }),
  foeData('en_all', 'elite', { traits: ['tr_veteran', 'tr_high', 'tr_glow', 'tr_edge', 'tr_cat', 'tr_dog', 'tr_ghost'] }),
  foeData('en_contract', 'minion', { traits: ['tr_contract'] }),
  foeData('en_rookie', 'minion', { traits: ['tr_rookie'] }),
  foeData('en_vet', 'minion', { traits: ['tr_veteran'] }),
  foeData('en_bot', 'minion', { kind: 'machine' }),
  foeData('en_rboss', 'boss', {}),
]
const PACK: ContentPack = {
  id: 'enemy_moves_test',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }],
    battle_status: TEST_STATUSES, path: [TREE], ability: ABILITIES, enemy_trait: TRAITS, enemy: ENEMIES,
    encounter: [
      { id: 'enc_t_plain', name: '一般', grade: 1, cover: 'medium', foes: [{ enemy: 'en_plain' }] },
      { id: 'enc_t_off', name: '不擲', grade: 1, cover: 'medium', foes: [{ enemy: 'en_plain' }], traits: false },
      { id: 'enc_base_g1_normal', name: '基準遭遇', grade: 1, cover: 'medium', foes: [{ enemy: 'en_plain' }] },
    ],
  },
}
const withRolls = (pack: ContentPack = PACK): ContentPack => ({ ...pack, content: { ...pack.content, enemy_trait: [...TRAITS, ...ROLLS] } })

// ---- 場地 ----

const ally = (i = 1, o: Rec = {}) => raw(one({ weapon: 'pistol', ...o } as never, i))
const enemy = (id: string, o: Rec = {}) => ({ from: 'enemy', id, ...o })
const open = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }
const setup = (foes: unknown[], allies: unknown[] = [ally(1), ally(2)], more: Partial<BattleSetup> = {}): BattleSetup => ({ mode: 'meat', grade: 1, cover: open, allies: allies as never, foes: foes as never, ...more })

/** 不經過提交的戰鬥：開打時用的就是真的敵人來源（from: 'enemy'）。 */
function world(foes: unknown[], o: { allies?: unknown[]; pack?: ContentPack; more?: Partial<BattleSetup> } = {}): Arena {
  return arena(setup(foes, o.allies, o.more), FEATURES, (k: Kernel) => {
    k.content.loadPack(o.pack ?? PACK)
    readyFeatures(k)
  })
}
const defOf = (a: Arena, id: string) => a.k.battle.getAction(id)!
const beatsOf = (r: BattleRun, tag: string) => r.beats.filter((b) => b.tag === tag)
/** 讓這個敵人不要先換位（這一步只看它做的行動）。 */
const settle = (u: BattleUnit) => { u.uses['turn:ai_moved'] = 1 }

describe('招牌行動：標了 enemy 的技能（和技能同一套格式）', () => {
  it('敵人資料寫的技能 id 放進 unit.ext.abilities.equipped；公式的 tier 代單位的等級', () => {
    const a = world([enemy('en_elite', { grade: 3 })])
    expect(a.foe(1).ext.abilities).toEqual({ equipped: ['ab_strike'], tiers: {} })
    expect(defOf(a, 'ab_strike').has!(a.run(), a.foe(1))).toBe(true)
    expect(defOf(a, 'ab_strike').has!(a.run(), a.ally(1))).toBe(false)
  })

  it('不必寫 path、tier、layer、cap、xp、after、category、net、opinion；kind、use、meat、text 照一般的技能', () => {
    const k = createK()
    expect(() => k.content.loadPack({ id: 'x', content: { ability: [sig('ab_x', 'active', { use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 1 }] } })] } } as never)).not.toThrow()
  })

  it('一筆假的招牌行動（主動、花 2 點、命中 +1、ai.score 3）：AI 的敵人在固定骰面下會用它，行動點照扣', () => {
    const a = world([enemy('en_elite')])
    const f = a.foe(1)
    settle(f)
    expect(defOf(a, 'ab_strike').aiScore!(a.run(), f, a.ally(1))).toBe(3)
    // 骰面：挑目標用 0（第一個我方），挑行動用 0（分數平方加權抽：行動照內容的順序排，招牌在武器攻擊前面），再來是命中的 d20
    const r = a.run(dice(0, 0, 15))
    expect(aiStep(r, f)).toBe(true)
    expect(beatsOf(r, 'skill').some((b) => (b.data as Rec | undefined)?.ability === 'ab_strike')).toBe(true)
    expect(f.ap.now).toBe(f.ap.max - 2)
  })

  it('照分數平方加權抽：招牌 3 分 = 9，武器攻擊 2 分 = 4（挑行動的亂數落在後 4/13 是武器攻擊）', () => {
    const a = world([enemy('en_elite')])
    const f = a.foe(1)
    settle(f)
    const r = a.run(dice(0, 99, 15))
    expect(aiStep(r, f)).toBe(true)
    expect(beatsOf(r, 'skill').some((b) => (b.data as Rec | undefined)?.ability === 'ab_strike')).toBe(false)
    expect(r.beats.length).toBeGreaterThan(0)
  })

  it('條件不符時不在候選裡：自己的 when（重傷）、目標的 needs（標記）、行動點不夠', () => {
    const a = world([enemy('en_wounded'), enemy('en_needs'), enemy('en_elite')])
    const [w, n, s] = [a.foe(1), a.foe(2), a.foe(3)]
    const run = a.run()
    expect(defOf(a, 'ab_wounded').aiScore!(run, w, a.ally(1))).toBeNull()
    w.hp!.now = Math.floor(w.hp!.max * 0.4)
    expect(defOf(a, 'ab_wounded').aiScore!(run, w, a.ally(1))).toBe(3)
    expect(defOf(a, 'ab_needs').aiScore!(run, n, a.ally(1))).toBeNull()
    a.ally(1).statuses.push({ id: 'marked', name: '標記', by: n.id, turns: 1, until: 'source_turn_start' } as never)
    expect(defOf(a, 'ab_needs').aiScore!(run, n, a.ally(1))).toBe(3)
    // 行動點不夠：核心不把它列進候選（aiStep 不會用它）
    s.ap.now = 1
    settle(s)
    const r = a.run(dice(0, 99, 15))
    aiStep(r, s)
    expect(beatsOf(r, 'skill')).toEqual([])
  })

  it('目標選不了時換一個選得了的：第一個我方帶著標記就選他，不是 AI 挑到的那一個', () => {
    const a = world([enemy('en_needs')])
    const n = a.foe(1)
    a.ally(2).statuses.push({ id: 'marked', name: '標記', by: n.id, turns: 1, until: 'source_turn_start' } as never)
    const run = a.run()
    expect(defOf(a, 'ab_needs').aiTarget!(run, n, a.ally(1))).toEqual({ unit: 'a2' })
    expect(defOf(a, 'ab_needs').aiScore!(run, n, a.ally(1))).toBe(3)
  })

  it('第一、二回合多加 first_rounds 分；第三回合起回到基準', () => {
    const a = world([enemy('en_opener')])
    const f = a.foe(1)
    const def = defOf(a, 'ab_opener')
    expect(def.aiScore!(a.run(), f, a.ally(1))).toBe(4.5)
    a.battle.round = 2
    expect(def.aiScore!(a.run(), f, a.ally(1))).toBe(4.5)
    a.battle.round = 3
    expect(def.aiScore!(a.run(), f, a.ally(1))).toBe(3)
  })

  it('沒有 ai 的技能 AI 不用；要玩家選的東西（picks）AI 填不出來，也不列；被動、反應沒有分數', () => {
    const a = world([enemy('en_picky'), enemy('en_stance'), enemy('en_guard')])
    expect(defOf(a, 'ab_quiet').aiScore).toBeUndefined()
    expect(defOf(a, 'ab_picky').aiScore!(a.run(), a.foe(1), a.ally(1))).toBeNull()
    expect(a.k.battle.getAction('ab_tough')).toBeUndefined()
    expect(a.k.battle.getAction('ab_guard')).toBeUndefined()
    // 沒有 ai 的招牌行動玩家（被操縱時）照樣有行動，只是 AI 不挑它
    const r = a.run(dice(0, 0, 15, 0, 0, 15))
    settle(a.foe(1))
    aiStep(r, a.foe(1))
    expect(beatsOf(r, 'skill').some((b) => (b.data as Rec | undefined)?.ability === 'ab_quiet')).toBe(false)
  })

  it('目標是我方的（治療）：只列生命比例低於 target_hp_below 的，挑最低的那個', () => {
    const a = world([enemy('en_mender'), enemy('en_plain')])
    const [m, hurt] = [a.foe(1), a.foe(2)]
    const def = defOf(a, 'ab_mend')
    expect(def.aiScore!(a.run(), m, a.ally(1))).toBeNull()
    hurt.hp!.now = Math.floor(hurt.hp!.max * 0.5)
    expect(def.aiScore!(a.run(), m, a.ally(1))).toBe(3)
    expect(def.aiTarget!(a.run(), m, a.ally(1))).toEqual({ unit: 'f2' })
    // 六成剛好不列（低於才列）
    hurt.hp!.now = Math.ceil(hurt.hp!.max * 0.6)
    expect(def.aiScore!(a.run(), m, a.ally(1))).toBeNull()
  })

  it('姿態在 AI 的第一個回合自己開（每場一次）；開著才有修正', () => {
    const a = world([enemy('en_stance')])
    const f = a.foe(1)
    settle(f)
    const before = a.run().mods('evade', f, undefined, undefined, []).reduce((s, p) => s + p.value, 0)
    const r = a.run(dice(0, 0, 15))
    expect(aiStep(r, f)).toBe(true)
    expect(f.stance).toBe('ab_stance')
    expect(f.ap.now).toBe(f.ap.max - 1)
    expect(a.run().mods('evade', f, undefined, undefined, []).reduce((s, p) => s + p.value, 0)).toBe(before + 2)
    // 開著之後不再開（也不會關掉）
    aiStep(a.run(dice(0, 0, 15)), f)
    expect(f.stance).toBe('ab_stance')
  })

  it('被動的招牌行動裝著就有（護甲 +2）', () => {
    const a = world([enemy('en_stance'), enemy('en_plain')])
    const sum = (u: BattleUnit) => a.run().mods('armor', u).reduce((s, p) => s + p.value, 0)
    expect(sum(a.foe(1)) - sum(a.foe(2))).toBe(2)
  })
})

describe('低血大招：生命 ≤ 40%（或餘韻疊到承受層數 − 1）才解開，每場一次，解開之後 +1', () => {
  const ult = () => {
    const a = world([enemy('en_boss')])
    const b = a.foe(1)
    b.hp!.max = 100
    b.hp!.now = 100
    return { a, b, def: defOf(a, 'ab_ult') }
  }
  it('生命 41% 時不在候選裡，40% 時在、分數多 1', () => {
    const { a, b, def } = ult()
    b.hp!.now = 41
    expect(def.aiScore!(a.run(), b, a.ally(1))).toBeNull()
    b.hp!.now = 40
    expect(def.aiScore!(a.run(), b, a.ally(1))).toBe(4)
    b.hp!.now = 1
    expect(def.aiScore!(a.run(), b, a.ally(1))).toBe(4)
  })
  it('餘韻疊到承受層數 − 1 也解開（首領的承受層數 4：3 層）', () => {
    const { a, b, def } = ult()
    expect(b.layersMax).toBe(4)
    b.layers = 2
    expect(def.aiScore!(a.run(), b, a.ally(1))).toBeNull()
    b.layers = 3
    expect(def.aiScore!(a.run(), b, a.ally(1))).toBe(4)
  })
  it('承受層數只有 1 的雜兵沒有「− 1」可言：0 層不會解開', () => {
    const a = world([enemy('en_plain')])
    const u = a.foe(1)
    u.ext.abilities = { equipped: ['ab_ult'], tiers: {} }
    u.hp!.max = 100
    u.hp!.now = 100
    expect(u.layersMax).toBe(1)
    expect(defOf(a, 'ab_ult').aiScore!(a.run(), u, a.ally(1))).toBeNull()
  })
  it('用過之後不再出現（每場一次）：AI 真的用了一次，之後 aiScore 是 null、也不再被挑', () => {
    const { a, b, def } = ult()
    b.hp!.now = 30
    settle(b)
    const r = a.run(dice(0, 0, 15))
    expect(aiStep(r, b)).toBe(true)
    expect(beatsOf(r, 'skill').some((x) => (x.data as Rec | undefined)?.ability === 'ab_ult')).toBe(true)
    expect(b.uses.ab_ult).toBe(1)
    expect(def.aiScore!(a.run(), b, a.ally(1))).toBeNull()
    // 解開的狀態還在，只是已經用過
    expect(def.blocks!(a.run(), b)).toEqual(['這一場已經用過了。'])
  })
})

describe('招牌是反應：相鄰的友軍被攻擊時命中 −2', () => {
  it('玩家打他旁邊的人時觸發、扣他的行動點，那一擊的命中少 2', () => {
    // 守衛站第 2 格，被打的是第 1 格的人
    const a = world([enemy('en_plain', { slot: 1 }), enemy('en_guard', { slot: 2 })])
    const [target, guard] = [a.foe(1), a.foe(2)]
    const ap = guard.ap.now
    const r1 = a.run(dice(12, ...Array(10).fill(3)))
    const hit = r1.attack(a.ally(1), target, {})
    expect(guard.ap.now).toBe(ap - 1)
    expect(beatsOf(r1, 'skill').some((b) => (b.data as Rec | undefined)?.ability === 'ab_guard')).toBe(true)
    // 沒有守衛時同樣的骰面，合計高 2
    const b = world([enemy('en_plain', { slot: 1 }), enemy('en_plain', { slot: 2 })])
    const r2 = b.run(dice(12, ...Array(10).fill(3)))
    const base = r2.attack(b.ally(1), b.foe(1), {})
    expect(base.total - hit.total).toBe(2)
  })
  it('行動點不夠時不觸發；打的不是相鄰的人（自己、不相鄰的）也不觸發', () => {
    const a = world([enemy('en_plain', { slot: 1 }), enemy('en_guard', { slot: 2 }), enemy('en_plain', { slot: 4 })])
    const guard = a.foe(2)
    guard.ap.now = 0
    const r = a.run(dice(12, ...Array(10).fill(3)))
    r.attack(a.ally(1), a.foe(1), {})
    expect(beatsOf(r, 'skill')).toEqual([])
    guard.ap.now = 3
    const r2 = a.run(dice(12, ...Array(10).fill(3)))
    r2.attack(a.ally(1), a.foe(3), {})
    expect(guard.ap.now).toBe(3)
    r2.attack(a.ally(1), guard, {})
    expect(guard.ap.now).toBe(3)
  })
})

describe('不能學、不能裝進橋', () => {
  const g = () => makeGame({ features: [combatFeature, abilitiesFeature], content: [{ id: 'abilities_only', content: { battle_status: TEST_STATUSES, path: [TREE], ability: ABILITIES } } as ContentPack] }).game
  it('learnBlock 對標了 enemy 的技能回「這不是學得到的技能。」；一般的技能照舊', () => {
    const game = g()
    expect(learnBlock(game.k, game.state, game.state.pc!, 'ab_strike')).toBe('這不是學得到的技能。')
    expect(learnBlock(game.k, game.state, game.state.pc!, 'sk_root')).not.toBe('這不是學得到的技能。')
    expect(learnBlock(game.k, game.state, game.state.pc!, 'ab_nope')).toBe('沒有這個技能。')
  })
  it('主角裝不上（就算角色的 learned 清單裡硬塞了）', () => {
    const game = g()
    const pc = game.state.pc!
    game.state.actors[pc]!.ext.abilities = { xp: 0, learned: ['ab_strike'], equipped: [], spent: {} }
    expect(() => equipAbilities(game.k, game.state, pc, ['ab_strike'])).toThrow('這不是學得到的技能。')
  })
})

describe('敵人資料：signature', () => {
  it('寫成 { name, text } 的敘述收得進來、開得了戰（不做效果）；混著寫的只放字串的', () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [PACK], seed: 5, battle: setup([enemy('en_text'), enemy('en_mixed')]) })
    const [t, m] = [game.state.battle!.units.f1!, game.state.battle!.units.f2!]
    expect(t.ext.abilities).toBeUndefined()
    expect(m.ext.abilities).toEqual({ equipped: ['ab_tough'], tiers: {} })
  })
  it('寫了查不到的 id 時載入被擋，訊息裡有那個 id', () => {
    const bad = { ...PACK, content: { ...PACK.content, encounter: [], enemy: [foeData('en_bad', 'minion', { signature: ['ab_ghost'] })] } }
    expect(() => makeGame({ features: FEATURES, content: [bad] })).toThrow(/ab_ghost/)
  })
  it('查得到、但不是標了 enemy 的技能：擋下，訊息裡有那個 id', () => {
    const bad = { ...PACK, content: { ...PACK.content, encounter: [], enemy: [foeData('en_bad2', 'minion', { signature: ['sk_root'] })] } }
    expect(() => makeGame({ features: FEATURES, content: [bad] })).toThrow(/sk_root/)
  })
  it('格式：不是字串、不是 { name, text } 的擋下；有 base 的具名敵人繼承招牌行動', () => {
    const k = createK()
    const load = (signature: unknown) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { enemy: [foeData(`en_s${Math.floor(Math.random() * 1e9)}`, 'minion', { signature })] } } as never)
    expect(load([3])).toThrow(/signature\[0\]/)
    expect(load([{ name: '只有名字' }])).toThrow(/signature\[0\]/)
    expect(load([{ name: 'a', text: 'b', extra: 1 }])).toThrow(/signature\[0\]/)
    const a = world([enemy('en_named')])
    expect(a.foe(1).ext.abilities).toEqual({ equipped: ['ab_strike'], tiers: {} })
  })
})

describe('敵人資料：cyber、deck、mods.sink、defeat', () => {
  it('cyber 兩件 → 單位有兩件 implants、cyber 是 2；契約的標了 contract；deck 原樣放到 ext.deck', () => {
    const a = world([enemy('en_cyber')])
    const u = a.foe(1)
    expect(u.implants).toEqual([{ kind: 'eye', name: '義眼' }, { kind: 'arm', name: '義臂', contract: true }])
    expect(u.cyber).toBe(2)
    expect(u.ext.deck).toEqual({ grade: 2, firewall: 12, slots: ['qh_a', 'qh_b'] })
    // 是複製：改單位不動內容
    ;(u.ext.deck as Rec).firewall = 99
    expect(PACK.content.enemy).toBeDefined()
    expect((a.k.content.get('enemy', 'en_cyber') as Rec).deck).toEqual({ grade: 2, firewall: 12, slots: ['qh_a', 'qh_b'] })
  })
  it('沒寫 cyber、deck 的敵人沒有 implants 與 ext.deck', () => {
    const u = world([enemy('en_plain')]).foe(1)
    expect(u.implants).toBeUndefined()
    expect(u.ext.deck).toBeUndefined()
  })
  it('格式：cyber 與 deck 寫錯在載入時擋下，訊息裡有欄位', () => {
    const k = createK()
    const bad = (more: Rec) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { enemy: [foeData(`en_c${Math.floor(Math.random() * 1e9)}`, 'minion', more)] } } as never)
    expect(bad({ cyber: 'x' })).toThrow(/cyber 要是陣列/)
    expect(bad({ cyber: [{ kind: 'eye' }] })).toThrow(/cyber\[0\]\.name/)
    expect(bad({ cyber: [{ kind: 'eye', name: 'a', contract: 'yes' }] })).toThrow(/cyber\[0\]\.contract/)
    expect(bad({ cyber: [{ kind: 'eye', name: 'a', power: 1 }] })).toThrow(/cyber\[0\]\.power/)
    expect(bad({ deck: { grade: 5, firewall: 10, slots: [] } })).toThrow(/deck\.grade/)
    expect(bad({ deck: { grade: 1, firewall: 'x', slots: [] } })).toThrow(/deck\.firewall/)
    expect(bad({ deck: { grade: 1, firewall: 10, slots: [3] } })).toThrow(/deck\.slots/)
    expect(bad({ deck: { grade: 1, firewall: 10, slots: [], rank: 1 } })).toThrow(/deck\.rank/)
  })
  it('mods.sink 記在 ext.enemies.sink；80 以上多標籤 sink_edge；不動單位這一場的沉溺', () => {
    const [hi, lo] = [world([enemy('en_sink85')]).foe(1), world([enemy('en_sink79')]).foe(1)]
    expect(hi.ext.enemies).toMatchObject({ sink: 85 })
    expect(hi.tags).toContain('sink_edge')
    expect(hi.sink).toBe(0)
    expect(lo.ext.enemies).toMatchObject({ sink: 79 })
    expect(lo.tags).not.toContain('sink_edge')
    const k = createK()
    const bad = (sink: unknown) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { enemy: [foeData(`en_k${Math.floor(Math.random() * 1e9)}`, 'minion', { mods: { sink } })] } } as never)
    expect(bad(121)).toThrow(/mods\.sink 要是 0～120/)
    expect(bad(-1)).toThrow(/mods\.sink/)
    expect(bad(120)).not.toThrow()
  })
  it('defeat 可以是字串或字串的陣列（只放寬格式）', () => {
    const k = createK()
    const ok = (defeat: unknown) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { enemy: [foeData(`en_d${Math.floor(Math.random() * 1e9)}`, 'minion', { defeat })] } } as never)
    expect(ok('df_a')).not.toThrow()
    expect(ok(['df_a', 'df_b'])).not.toThrow()
    expect(ok(3)).toThrow(/defeat 要是字串/)
    expect(ok([3])).toThrow(/defeat 要是字串/)
    expect(world([enemy('en_defeat')]).foe(1).enemy).toBe('en_defeat')
  })
})

describe('補充：武器的 fx 複製到 BattleWeapon.ext.fx（敵人的武器附帶效果才會生效）', () => {
  it('weapons[].fx 複製進去；沒寫 fx 的武器沒有 ext.fx；fxOf 讀得到', () => {
    const a = world([enemy('en_fx'), enemy('en_plain')])
    const f = a.foe(1)
    expect(f.weapons[0]!.ext).toEqual({ fx: { hit: 2, pierce: 1 } })
    expect(f.weapons[1]!.ext?.fx).toBeUndefined()
    expect(a.foe(2).weapons[0]!.ext?.fx).toBeUndefined()
    expect(fxOf(a.k, f.weapons[0]!)).toMatchObject({ hit: 2, pierce: 1 })
    // 是複製：改單位上的不動內容
    ;((f.weapons[0]!.ext as Rec).fx as Rec).hit = 9
    expect(((a.k.content.get('enemy', 'en_fx') as Rec).weapons as Rec[])[0]!.fx).toEqual({ hit: 2, pierce: 1 })
  })
  it('fx 的每一擊加值真的算進命中（武器的命中 +2）', () => {
    const a = world([enemy('en_fx'), enemy('en_plain')])
    const total = (u: BattleUnit) => a.run(dice(12, ...Array(10).fill(3))).attack(u, a.ally(1), {}).total
    // 兩個敵人同一級、武器同一把：fx 的 +2 是差距（精英的命中沒有位階的差別）
    expect(total(a.foe(1)) - total(a.foe(2))).toBe(2)
  })
  it('敵人的 fx 寫錯在載入時擋下（格式由 features/combat 查）', () => {
    const bad = { ...PACK, content: { ...PACK.content, encounter: [], enemy: [foeData('en_badfx', 'minion', { weapons: [{ class: 'pistol', fx: { type: 'laser' } }] })] } }
    expect(() => makeGame({ features: FEATURES, content: [bad] })).toThrow(/enemy\/en_badfx：weapons\[0\]\.fx/)
    expect(() => createK().content.loadPack({ id: 'x', content: { enemy: [foeData('en_fxstr', 'minion', { weapons: [{ class: 'pistol', fx: 'x' }] })] } } as never)).toThrow(/weapons\[0\]\.fx 要是物件/)
  })
})

describe('特徵：一定帶著的（enemy_trait 是規則表）', () => {
  it('每場都有：標籤、紀錄；查不到的特徵 id 當成純標籤', () => {
    for (const seed of [1, 2, 3]) {
      const { game } = makeBattleGame({ features: FEATURES, content: [PACK], seed, battle: setup([enemy('en_hurt'), enemy('en_all')]) })
      const [h, all] = [game.state.battle!.units.f1!, game.state.battle!.units.f2!]
      expect(h.tags).toContain('tr_hurt')
      expect((h.ext.enemies as Rec).traits).toEqual(['tr_hurt'])
      expect(all.tags).toEqual(expect.arrayContaining(['tr_veteran', 'tr_ghost']))
      expect((all.ext.enemies as Rec).traits).toEqual(['tr_veteran', 'tr_high', 'tr_glow', 'tr_edge', 'tr_cat', 'tr_dog', 'tr_ghost'])
    }
  })
  it('mods.hp_pct: -40 的生命只剩六成（最大值與現在都是）；命中 −1', () => {
    const a = world([enemy('en_hurt'), enemy('en_elite')])
    const [h, base] = [a.foe(1), a.foe(2)]
    expect(h.hp!.max).toBe(Math.round(base.hp!.max * 0.6))
    expect(h.hp!.now).toBe(h.hp!.max)
    expect(h.weapons[0]!.hit).toBe(base.weapons[0]!.hit - 1)
    expect(h.ai!.fleeBelow).toBe(0.3)
  })
  it('mods 的每一個鍵：命中、行動點、感載上限、承受層數、迴避、先攻；ai 的 prefer 與 never_flee', () => {
    const a = world([enemy('en_all'), enemy('en_elite')])
    const [t, base] = [a.foe(1), a.foe(2)]
    expect(t.weapons[0]!.hit).toBe(base.weapons[0]!.hit + 1)
    expect(t.ap.max).toBe(base.ap.max + 1)
    expect(t.ap.now).toBe(base.ap.now + 1)
    expect(t.load!.max).toBe(base.load!.max - 4)
    expect(t.layersMax).toBe(base.layersMax + 1)
    expect(t.evade).toBe(base.evade + 1)
    expect(t.initBonus).toBe(base.initBonus + 3)
    expect(t.ai).toMatchObject({ prefer: 'nearest', neverFlee: true })
  })
  it('start 的餘韻：開打就帶 1 層（第一個回合之前）；沒有這個特徵的沒有', () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [PACK], seed: 4, battle: setup([enemy('en_all'), enemy('en_elite')]) })
    expect(game.state.battle!.units.f1!.layers).toBe(1)
    expect(game.state.battle!.units.f2!.layers).toBe(0)
  })
  it('契約人特徵的人加上 contract 標籤', () => {
    expect(world([enemy('en_contract')]).foe(1).tags).toContain('contract')
  })
  it('一定帶著的不會被「開戰時擲」重複擲到', () => {
    const rolls = withRolls({ ...PACK, content: { ...PACK.content, enemy_trait: [] } })
    const pack = { ...rolls, content: { ...rolls.content, enemy: [...ENEMIES, foeData('en_carry', 'minion', { traits: ['tr_r1'] })] } } as ContentPack
    for (let seed = 1; seed <= 20; seed++) {
      const { game } = makeBattleGame({ features: FEATURES, content: [pack], seed, battle: setup([enemy('en_carry')]) })
      const list = (game.state.battle!.units.f1!.ext.enemies as Rec).traits as string[]
      expect(list.filter((x) => x === 'tr_r1')).toHaveLength(1)
    }
  })
})

describe('特徵：士氣與契約人', () => {
  /** 首領倒下之後，一個雜兵輪到的第一步：檢定士氣了沒有。 */
  const afterBossDown = (id: string) => {
    const a = world([enemy('en_boss', { slot: 1 }), enemy(id, { slot: 2 })])
    a.foe(1).out = 'down'
    const m = a.foe(2)
    settle(m)
    const r = a.run(dice(...Array(20).fill(15)))
    aiStep(r, m)
    return { m, r }
  }
  it('契約人特徵的人不檢定士氣（現有的規則認 contract 標籤）；一般的雜兵會', () => {
    expect(afterBossDown('en_contract').m.uses.morale).toBeUndefined()
    expect(afterBossDown('en_plain').m.uses.morale).toBe(1)
  })
  it('ai.morale_dc 加在士氣的 DC 上：老兵 −3、新人 +3（DC 13）', () => {
    const dcOf = (id: string) => (afterBossDown(id).r.beats.find((b) => b.roll)?.roll as { dc: number }).dc
    expect(dcOf('en_plain')).toBe(13)
    expect(dcOf('en_vet')).toBe(10)
    expect(dcOf('en_rookie')).toBe(16)
  })
})

describe('特徵：開戰時擲（dev/adr/0015 E10）', () => {
  /** 沒有特徵內容時組好的戰鬥，再把特徵內容放進去、對指定的單位重擲（骰面釘死）。 */
  function rolled(id: string, values: number[], pack: ContentPack = withRolls()): string[] {
    const a = world([enemy(id)], { pack: { ...pack, content: { ...pack.content, enemy_trait: [] } } })
    a.k.content.loadPack({ id: 'late', content: { enemy_trait: [...TRAITS, ...ROLLS] } } as never)
    const u = a.foe(1)
    a.k.battle.emit('unit.ready', { run: a.run(dice(...values)), unit: u })
    return ((u.ext.enemies as Rec | undefined)?.traits as string[] | undefined) ?? []
  }
  it('每個符合 kinds 的敵人擲兩次、各 30%：兩次都沒中 → 沒有；一次中 → 一個；兩次都中 → 兩個（不重複）', () => {
    expect(rolled('en_plain', [50, 50])).toEqual([])
    // 第一次 10（<30 擲中）→ 抽（0 → 第一個）；第二次 90（沒中）
    expect(rolled('en_plain', [10, 0, 90])).toEqual(['tr_r1'])
    // 第一次沒中、第二次擲中 → 抽（99 → 最後一個，權重 2 的 tr_r3）
    expect(rolled('en_plain', [90, 20, 99])).toEqual(['tr_r3'])
    // 兩次都中：第一次抽 0 → tr_r1；第二次從剩下的（tr_r2 權重 1、tr_r3 權重 2）抽，0 → tr_r2
    expect(rolled('en_plain', [10, 0, 10, 0])).toEqual(['tr_r1', 'tr_r2'])
    // 抽的權重：剩下的總權重 3，抽到 70 / 100 × 3 = 2.1 → 落在 tr_r3
    expect(rolled('en_plain', [10, 0, 10, 70])).toEqual(['tr_r1', 'tr_r3'])
  })
  it('門檻剛好：29 擲中、30 沒中', () => {
    expect(rolled('en_plain', [29, 0, 99])).toEqual(['tr_r1'])
    expect(rolled('en_plain', [30, 99])).toEqual([])
  })
  it('首領各 50%：40 對雜兵沒中、對首領擲中；49 擲中、50 沒中', () => {
    expect(rolled('en_plain', [40, 99])).toEqual([])
    expect(rolled('en_rboss', [40, 0, 99])).toEqual(['tr_r1'])
    expect(rolled('en_rboss', [49, 0, 99])).toEqual(['tr_r1'])
    expect(rolled('en_rboss', [50, 99])).toEqual([])
  })
  it('只擲 kinds 符合的特徵：機器擲得到機器的，人擲不到', () => {
    expect(rolled('en_bot', [10, 0, 99])).toEqual(['tr_m1'])
    expect(rolled('en_plain', [10, 99, 99])).not.toContain('tr_m1')
  })
  it('擲到的特徵照樣算進單位（標籤、mods）', () => {
    const a = world([enemy('en_plain')], { pack: { ...PACK, content: { ...PACK.content, enemy_trait: [] } } })
    a.k.content.loadPack({ id: 'late', content: { enemy_trait: [{ id: 'tr_x', name: '強壯', desc: '行動點 +1。', mods: { ap: 1 }, roll: { weight: 1, kinds: ['human'] } }] } } as never)
    const u = a.foe(1)
    const ap = u.ap.max
    a.k.battle.emit('unit.ready', { run: a.run(dice(10, 0, 99)), unit: u })
    expect(u.ap.max).toBe(ap + 1)
    expect(u.tags).toContain('tr_x')
    expect((u.ext.enemies as Rec).rolled).toEqual(['tr_x'])
  })
  it('沒有任何能擲的特徵時不動亂數（骰面的順序和沒有這個功能的時候一樣）', () => {
    const a = world([enemy('en_plain')])
    // 這個鏡像沒有 roll 的特徵：run 的骰面只有 0 顆，擲亂數就會丟錯
    expect(() => a.k.battle.emit('unit.ready', { run: a.run([]), unit: a.foe(1) })).not.toThrow()
  })
  it('遭遇寫 traits: false 就不擲：setupFromEncounter 把它帶進 origin.ext；沒寫的不帶', () => {
    const k = createK(PACK)
    const origin = (id: string) => setupFromEncounter(k, makeGame().game.state, id, { allies: [] }).origin?.ext
    expect(origin('enc_t_off')).toEqual({ traits: false })
    expect(origin('enc_t_plain') ?? null).toBeNull()
    // 基準遭遇不再靠 id 的前綴：engine/data 的基準遭遇自己寫 traits: false；沒寫的就是沒寫（id 叫 enc_base_ 也一樣）
    expect(origin('enc_base_g1_normal') ?? null).toBeNull()
  })
  it('traits: false 的遭遇沒有人擲到；沒寫的遭遇照樣擲（整批種子裡有人擲到）', () => {
    const pack = withRolls()
    let off = 0
    let on = 0
    for (let seed = 1; seed <= 40; seed++) {
      for (const [enc, count] of [['enc_t_off', 'off'], ['enc_t_plain', 'on']] as const) {
        const t = makeGame({ features: FEATURES, content: [pack], seed })
        const s = setupFromEncounter(t.game.k, t.game.state, enc, { allies: [ally(1), ally(2)] as never })
        t.game.startBattle({ ...s, cover: open })
        const traits = (t.game.state.battle!.units.f1!.ext.enemies as Rec | undefined)?.traits as string[] | undefined
        if (traits?.length) (count === 'off' ? (off += 1) : (on += 1))
      }
    }
    expect(off).toBe(0)
    expect(on).toBeGreaterThan(0)
  })
  it('同一個種子兩次開打擲到的一樣；不同的種子會不一樣', () => {
    const pack = withRolls()
    const roll = (seed: number) => {
      const { game } = makeBattleGame({ features: FEATURES, content: [pack], seed, battle: setup([enemy('en_plain'), enemy('en_plain'), enemy('en_elite'), enemy('en_rboss')]) })
      return Object.values(game.state.battle!.units).filter((u) => u.side === 'foe').map((u) => ((u.ext.enemies as Rec | undefined)?.traits ?? []) as string[])
    }
    const seen = new Set<string>()
    for (let seed = 1; seed <= 30; seed++) {
      expect(roll(seed)).toEqual(roll(seed))
      seen.add(JSON.stringify(roll(seed)))
      for (const list of roll(seed)) {
        expect(list.length).toBeLessThanOrEqual(2)
        expect(new Set(list).size).toBe(list.length)
      }
    }
    expect(seen.size).toBeGreaterThan(5)
  })
})

describe('特徵：格式（enemy_trait）', () => {
  const load = (e: Rec) => () => createK().content.loadPack({ id: `p${Math.random()}`, content: { enemy_trait: [{ id: 'tr_t', name: '特徵', desc: '一句話。', ...e }] } } as never)
  it('合格的寫法收得進來', () => {
    expect(load({ mods: { hp_pct: -40, hit: -1, ap: 1, load_cap: -4, layers_max: 1, evade: 1, initiative: 3 }, ai: { flee_below: 0.3, prefer: 'nearest', never_flee: true, morale_dc: -3 }, start: [{ op: 'afterglow', amount: 1 }], tags: ['contract'], roll: { weight: 2, kinds: ['human'] } })).not.toThrow()
  })
  it.each([
    [{ mods: { luck: 1 } }, /mods\.luck 不是可以修正的鍵/],
    [{ mods: { hp_pct: -100 } }, /mods\.hp_pct/],
    [{ mods: { hp_pct: 0.5 } }, /mods\.hp_pct/],
    [{ mods: { hit: 'x' } }, /mods\.hit 要是整數/],
    [{ mods: 'x' }, /mods 要是物件/],
    [{ ai: { flee_below: 2 } }, /ai\.flee_below 要是 0～1/],
    [{ ai: { prefer: 'random' } }, /ai\.prefer 只能是/],
    [{ ai: { never_flee: 'yes' } }, /ai\.never_flee/],
    [{ ai: { morale_dc: 1.5 } }, /ai\.morale_dc 要是整數/],
    [{ ai: { rage: 1 } }, /ai\.rage 不是可以用的鍵/],
    [{ start: [] }, /start 要是效果的陣列/],
    [{ start: [{ op: 'explode' }] }, /start：.*explode/],
    [{ tags: [] }, /tags 要是標籤的陣列/],
    [{ roll: { weight: 0, kinds: ['human'] } }, /roll\.weight/],
    [{ roll: { weight: 1, kinds: ['ghost'] } }, /roll\.kinds/],
    [{ roll: { weight: 1, kinds: [] } }, /roll\.kinds/],
    [{ roll: { weight: 1, kinds: ['human'], extra: 1 } }, /roll\.extra/],
    [{ name: '' }, /要有 name/],
  ] as Array<[Rec, RegExp]>)('寫錯的擋下：%j', (e, re) => {
    expect(load(e)).toThrow(re)
  })
})

describe('天使急救的會員（E11）', () => {
  /** 兩個敵人（會員與一個雜兵），讓戰鬥不因為敵人倒光而結束。 */
  const club = (id: string) => {
    const a = world([enemy(id, { slot: 1 }), enemy('en_plain', { slot: 2 })])
    return { a, u: a.foe(1) }
  }
  const roundStart = (a: Arena, round: number) => a.k.battle.emit('round.start', { run: a.run(), round })
  it('angel: gold 的敵人倒下三回合後有一拍、被標成被帶走', () => {
    const { a, u } = club('en_gold')
    expect(u.ext.enemies).toMatchObject({ angel: 'gold' })
    const run = a.run()
    run.setOut(u, 'down')
    roundStart(a, 2)
    roundStart(a, 3)
    expect((u.ext.enemies as Rec).taken).toBeUndefined()
    const r = a.run()
    a.k.battle.emit('round.start', { run: r, round: 4 })
    expect((u.ext.enemies as Rec).taken).toBe(true)
    expect(beatsOf(r, 'angel')).toHaveLength(1)
    expect(beatsOf(r, 'angel')[0]!.text).toContain(u.name)
    // 之後不再記
    const r2 = a.run()
    a.k.battle.emit('round.start', { run: r2, round: 5 })
    expect(beatsOf(r2, 'angel')).toEqual([])
  })
  it('白銀 4 回合、白金 2 回合；沒有天使急救的（none 或沒寫）不倒數', () => {
    for (const [id, n] of [['en_silver', 4], ['en_plat', 2]] as const) {
      const { a, u } = club(id)
      a.run().setOut(u, 'down')
      for (let i = 1; i < n; i++) roundStart(a, i + 1)
      expect((u.ext.enemies as Rec).taken).toBeUndefined()
      roundStart(a, n + 1)
      expect((u.ext.enemies as Rec).taken).toBe(true)
    }
    for (const id of ['en_noangel', 'en_plain']) {
      const { a, u } = club(id)
      a.run().setOut(u, 'down')
      for (let i = 2; i < 12; i++) roundStart(a, i)
      expect(u.ext.enemies === undefined || (u.ext.enemies as Rec).taken === undefined).toBe(true)
    }
  })
  it('被制伏、投降、逃走的不算倒下，不倒數；昏過去（burnout）算', () => {
    for (const how of ['subdued', 'surrendered', 'fled']) {
      const { a, u } = club('en_plat')
      a.run().setOut(u, how)
      for (let i = 2; i < 6; i++) roundStart(a, i)
      expect((u.ext.enemies as Rec).taken).toBeUndefined()
    }
    const { a, u } = club('en_plat')
    a.run().setOut(u, 'burnout')
    roundStart(a, 2)
    roundStart(a, 3)
    expect((u.ext.enemies as Rec).taken).toBe(true)
  })
  it('倒數的時候又回到場上（被救起來）就取消', () => {
    const { a, u } = club('en_gold')
    const run = a.run()
    run.setOut(u, 'down')
    roundStart(a, 2)
    expect(run.revive(u, 5)).toBe(true)
    for (let i = 3; i < 9; i++) roundStart(a, i)
    expect((u.ext.enemies as Rec).taken).toBeUndefined()
    expect((u.ext.enemies as Rec).angelLeft).toBeUndefined()
  })
  it('angel 只能是 none、silver、gold、platinum', () => {
    const k = createK()
    const bad = (angel: unknown) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { enemy: [foeData(`en_a${Math.floor(Math.random() * 1e9)}`, 'minion', { angel })] } } as never)
    expect(bad('bronze')).toThrow(/angel 只能是 none、silver、gold、platinum/)
    expect(bad(3)).toThrow(/angel 要是字串/)
    expect(bad('gold')).not.toThrow()
  })
  it('被帶走的人整場打完之後不掉東西（掉落的結算認 ext.enemies.taken）', async () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [PACK], seed: 3, battle: setup([enemy('en_gold')], [ally(1), ally(2)]) })
    const u = game.state.battle!.units.f1!
    u.out = 'down'
    ;(u.ext.enemies as Rec).taken = true
    game.state.battle!.result = { outcome: 'win', text: '打完了。' }
    const { reports } = await game.finishBattle()
    expect(JSON.stringify(reports)).not.toMatch(/"op":"item"/)
  })
})

describe('既有的格式不受影響', () => {
  it('一般的技能（有 path 等欄位）照舊；敵人的技能混在同一批內容裡', () => {
    const k = createK()
    expect(() => k.content.loadPack({ id: 'mix', content: { path: [TREE], ability: ABILITIES } } as never)).not.toThrow()
    readyFeatures(k)
  })
  it('一般技能缺的欄位仍然擋下：沒有 enemy 的技能還是要寫 path、tier', () => {
    const k = createK()
    expect(() => k.content.loadPack({ id: 'bad', content: { ability: [{ id: 'ab_p', name: 'x', text: 'x。', kind: 'active', meat: null }] } } as never)).toThrow(/path|tier/)
  })
  it('enemy 只能是 true；敵人的招牌行動 kind 只能是 active、passive、reaction、stance；要有 meat', () => {
    const k = createK()
    const load = (more: Rec) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { ability: [{ id: `ab_${Math.floor(Math.random() * 1e9)}`, name: 'x', text: 'x。', enemy: true, kind: 'active', meat: { target: 'enemy', do: [{ op: 'attack', hit: 1 }] }, ...more }] } } as never)
    expect(load({ enemy: 'yes' })).toThrow(/enemy 只能是 true/)
    expect(load({ kind: 'prep' })).toThrow(/kind 只能是 active、passive、reaction、stance/)
    expect(load({ kind: 'daily' })).toThrow(/kind 只能是/)
    expect(load({ meat: null })).toThrow(/要有 meat/)
    expect(load({ meat: { target: 'enemy', do: [{ op: 'explode' }] } })).toThrow(/explode/)
    expect(load({ name: '' })).toThrow(/要有 name/)
    expect(load({ cells: 'many' })).toThrow(/cells 要是數字/)
  })
  it('ai 的格式：score 要是正數；不認得的鍵、unlock、when 寫錯都擋下，訊息裡有那個字', () => {
    const k = createK()
    const load = (ai: unknown) => () => k.content.loadPack({ id: `p${Math.random()}`, content: { ability: [sig(`ab_${Math.floor(Math.random() * 1e9)}`, 'active', { meat: { target: 'enemy', do: [{ op: 'attack', hit: 1 }] }, ai })] } } as never)
    expect(load({ score: 3, first_rounds: 1, unlock: 'low', when: { first_round: true, target_hp_below: 0.5 } })).not.toThrow()
    expect(load({})).toThrow(/ai\.score/)
    expect(load({ score: 0 })).toThrow(/ai\.score/)
    expect(load({ score: 3, mood: 'angry' })).toThrow(/ai\.mood/)
    expect(load({ score: 3, unlock: 'high' })).toThrow(/ai\.unlock 只能是 low（拿到 high）/)
    expect(load({ score: 3, first_rounds: 'x' })).toThrow(/ai\.first_rounds/)
    expect(load({ score: 3, when: { target_hp_below: 2 } })).toThrow(/ai\.when\.target_hp_below/)
    expect(load({ score: 3, when: { magic: true } })).toThrow(/ai\.when\.magic/)
    expect(load('x')).toThrow(/ai 要是/)
  })
  it('玩家的技能也可以寫 ai（格式同一套）', () => {
    const k = createK()
    const mate = { ...ABILITIES[ABILITIES.length - 1]!, id: 'sk_mate', after: 'sk_root', layer: 'front', meat: { target: 'enemy', do: [{ op: 'attack', hit: 1 }] }, kind: 'active', ai: { score: 2.5 } }
    expect(() => k.content.loadPack({ id: 'mate', content: { path: [TREE], ability: [ABILITIES[ABILITIES.length - 1], mate] } } as never)).not.toThrow()
    expect(() => k.content.loadPack({ id: 'mate2', content: { ability: [{ ...mate, id: 'sk_mate2', ai: { score: -1 } }] } } as never)).toThrow(/ai\.score/)
  })
})

/** 一個空的 kernel（功能都裝好）；pack 給了就先載入。 */
function createK(pack?: ContentPack): Kernel {
  const k = makeGame({ features: FEATURES, ...(pack ? { content: [pack] } : {}) }).game.k
  return k
}
