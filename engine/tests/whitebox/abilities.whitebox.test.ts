// 白箱測試：features/abilities（技能：內容格式、學與裝、戰鬥裡的技能）。
// 補主套件沒有走到的分支：內容檢查的每一個鍵、單位上資料的容錯、花費減免的挑法、各種技能目標與用量的條件、反應的各種不觸發。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack, Feature } from '../../src'
import { createKernel, readyFeatures } from '../../src'
import { abilitiesFeature, abilitiesOf, capacityOf, learnBlock, treeTier, unitAbilities } from '../../src/features/abilities'
import { TEST_COMBAT, makeBattleGame, makeState, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one, raw } from '../helpers/battle'

const sk = (id: string, name: string, path: string, tier: number, kind: string, cap: number, more: Record<string, unknown> = {}) => ({
  id, name, path, category: path === 'gunner' ? 'meat' : 'social', tier, layer: 'front', kind, cap, xp: tier * 20, cells: 1, text: `${name}。`, net: null, opinion: null, meat: null, ...more,
})
const PATH = { id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_instinct', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [{ tier: 1, cells: 1, text: '先攻 +3。', effect: { initiative: 3 } }] }
const FIXER = { id: 'fixer', name: '掮客', tree: '人面', category: 'social', signature: 'sk_face', domains: { meat: 'strong_support', net: 'mid', opinion: 'mid' }, resonance: [{ tier: 2, cells: 1, text: '每場第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } }] }
const ABILITIES = [
  sk('sk_instinct', '戰鬥直覺', 'gunner', 1, 'passive', 3, { layer: 'signature', meat: { instinct: true } }),
  sk('sk_burst', '連射', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } } }),
  sk('sk_aim', '要害射擊', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { aimed: true } } }),
  sk('sk_face', '人面', 'fixer', 1, 'passive', 3, { layer: 'signature', meat: { give_ap: { max: 'one_plus_half_tier' }, call: { options: ['shot', 'cover_up', 'cover_down'], per_fight: 'half_tier_up', ap: 1 } } }),
]
const BASE: ContentPack = { id: 'ab', content: { battle_status: TEST_STATUSES, path: [PATH, FIXER], ability: ABILITIES } }
const FEATURES: Feature[] = [abilitiesFeature, TEST_COMBAT]

const problems = (kind: 'path' | 'ability', entry: Record<string, unknown>): string => createKernel([abilitiesFeature]).content.validate(kind, [entry]).join('\n')
const edit = (kind: 'path' | 'ability', base: Record<string, unknown>, field: string, value: unknown): string => {
  const e = { ...base, [field]: value }
  if (value === undefined) delete e[field]
  return problems(kind, e)
}
const meatEdit = (meat: unknown, more: Record<string, unknown> = {}): string => problems('ability', { ...ABILITIES[1]!, ...more, meat })

describe('白箱 path 的格式（dev/work/M1-abilities.md 第二節；DATA 第 2 節）', () => {
  it('合格的樣本收得進來', () => {
    expect(problems('path', PATH)).toBe('')
    expect(problems('path', FIXER)).toBe('')
  })

  it.each([
    ['name', '', /要有 name（路數的名字/],
    ['tree', ' ', /要有 tree/],
    ['category', 'sports', /category 只能是 meat、net、social、media/],
    ['signature', '', /要有 signature/],
    ['domains', undefined, /要有 domains/],
    ['domains', 'x', /要有 domains/],
    ['domains', { meat: 'strong', net: 'huge', opinion: 'none' }, /domains\.net 只能是/],
    ['domains', { meat: 'strong', net: 'none', opinion: 'none', luck: 'strong' }, /domains\.luck 不是可以用的鍵/],
    ['resonance', undefined, /resonance 要是陣列/],
    ['resonance', ['x'], /resonance\[0\] 要是 \{ tier, cells, text, effect\? \}/],
    ['resonance', [{ tier: 6, cells: 1, text: 'x' }], /tier 要是 1～5 的整數/],
    ['resonance', [{ tier: 1, cells: 'x', text: 'x' }], /cells 要是數字/],
    ['resonance', [{ tier: 1, cells: 1, text: '' }], /text 要是完整的句子/],
    ['resonance', [{ tier: 1, cells: 1, text: 'x', effect: 5 }], /effect 要是物件/],
    ['resonance', [{ tier: 1, cells: 1, text: 'x', effect: { speed: 1 } }], /effect\.speed 不是可以用的鍵/],
    ['resonance', [{ tier: 1, cells: 1, text: 'x', effect: { initiative: 'x' } }], /effect\.initiative 要是數字/],
    ['resonance', [{ tier: 1, cells: 1, text: 'x', effect: { free_move: { per_fight: 0 } } }], /effect\.free_move 要是 \{ per_fight: 1 以上的整數 \}/],
    ['resonance', [{ tier: 1, cells: 1, text: 'x', effect: { free_move: 1 } }], /effect\.free_move 要是/],
    ['resonance', [{ tier: 1, cells: 1, text: 'x', effect: { pending: false } }], /effect\.pending 只能是 true/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('path', PATH, field, value as unknown)).toMatch(re)
  })
})

describe('白箱 ability 的格式（dev/work/M1-abilities.md 第二節）', () => {
  const A = ABILITIES[1]!

  it('合格的樣本收得進來（主動、被動、反應、招牌不用 after）', () => {
    for (const a of ABILITIES) expect(problems('ability', a), a.id).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['text', '', /要有 text/],
    ['path', '', /要有 path/],
    ['category', 'x', /category 只能是/],
    ['tier', 0, /tier 要是 1～5 的整數/],
    ['tier', 6, /tier 要是 1～5 的整數/],
    ['layer', 'x', /layer 只能是 signature、front、back/],
    ['kind', 'x', /kind 只能是/],
    ['cap', 0, /cap 要是 1～6 的整數/],
    ['cap', 7, /cap 要是 1～6 的整數/],
    ['xp', 'x', /xp 要是整數（階 × 20）/],
    ['xp', 21, /xp 一定是 tier × 20（tier 1 是 20，拿到 21）/],
    ['cells', 'x', /cells 要是數字/],
    ['after', undefined, /招牌以外的技能要有 after/],
    ['after', 5, /招牌以外的技能要有 after/],
    ['net', undefined, /要有 net（沒有效果就寫 null）/],
    ['opinion', 3, /opinion 要是物件或 null/],
    ['prep', 3, /prep 要是物件或 null/],
    ['daily', 'x', /daily 要是物件或 null/],
    ['use', 'x', /use 要是 \{ ap\?/],
    ['use', { ap: -1 }, /use\.ap 要是 0 以上的整數/],
    ['use', { per_turn: 0 }, /use\.per_turn 要是 1 以上的整數/],
    ['use', { per_fight: 0 }, /use\.per_fight 要是 1 以上的整數/],
    ['use', { first_round: 'yes' }, /use\.first_round 要是 true 或 false/],
    ['use', { note: 3 }, /use\.note 要是字串/],
    ['use', { speed: 3 }, /use\.speed 不是可以用的鍵/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('ability', A, field, value as unknown)).toMatch(re)
  })

  it('招牌以外的技能 after 不是字串、招牌寫了不是字串的 after：各一條訊息', () => {
    expect(problems('ability', { ...ABILITIES[0]!, after: 7 })).toMatch(/after 要是前置技能的 id/)
    expect(problems('ability', { ...ABILITIES[0]! })).toBe('')
  })
})

describe('白箱 meat 欄的格式（工單第四節：封閉清單）', () => {
  it.each([
    [{ gun: 1 }, /meat\.gun 不是可以用的鍵/],
    [{ target: 'moon' }, /meat\.target 只能是/],
    [{ attack: 5 }, /meat\.attack 要是物件/],
    [{ attack: { speed: 1 } }, /meat\.attack\.speed 不是可以用的鍵/],
    [{ attack: { aimed: 'yes' } }, /meat\.attack\.aimed 要是 true 或 false/],
    [{ attack: { hit: 'x' } }, /meat\.attack\.hit 要是數字/],
    [{ attack: { spend: 0 } }, /meat\.attack\.spend 只能是 'all'/],
    [{ attack: { min_mag: 0 } }, /meat\.attack\.min_mag 要是 1 以上的整數/],
    [{ attack: { dice: 'x' } }, /meat\.attack\.dice 只能是 'spent_minus_1'/],
    [{ attack: { at: 'target' } }, /meat\.attack\.at 只能是 'attacker'/],
    [{ attack: { suppress: 3 } }, /meat\.attack\.suppress 要是 \{ dc, skill \}/],
    [{ attack: { suppress: { dc: 0, skill: 'composure' } } }, /suppress\.dc 要是 'spent' 或正數/],
    [{ attack: { suppress: { dc: 'spent', skill: '' } } }, /suppress\.skill 要是基本功的 id/],
    [{ attack: { suppress: { dc: 12, skill: 'x', mood: 1 } } }, /suppress\.mood 不是可以用的鍵/],
    [{ apply: 'x' }, /meat\.apply 要是 \[\{ status, until\? \}\]/],
    [{ apply: [3] }, /meat\.apply\[0\] 要是 \{ status, until\? \}/],
    [{ apply: [{ status: '' }] }, /meat\.apply\[0\] 要是/],
    [{ apply: [{ status: 'x', until: 'never' }] }, /meat\.apply\[0\]\.until 只能是/],
    [{ apply: [{ status: 'x', mood: 1 }] }, /meat\.apply\[0\]\.mood 不是可以用的鍵/],
    [{ free_move: 'x' }, /meat\.free_move 要是/],
    [{ free_move: { swap_adjacent_pair: 'yes' } }, /swap_adjacent_pair 要是 true 或 false/],
    [{ free_move: { teleport: true } }, /meat\.free_move\.teleport 不是可以用的鍵/],
    [{ cost: 'x' }, /meat\.cost 要是 \{ ability, ap, per_turn\? \}/],
    [{ cost: { ability: 'a', ap: -1 } }, /meat\.cost 要是/],
    [{ cost: { ability: 'a', ap: 1, per_turn: 0 } }, /meat\.cost\.per_turn 要是 1 以上的整數/],
    [{ cost: { ability: 'a', ap: 1, mood: 1 } }, /meat\.cost\.mood 不是可以用的鍵/],
    [{ weapon_cost: { trait: '', ap: 1 } }, /meat\.weapon_cost 要是 \{ trait, ap, per_turn\? \}/],
    [{ weapon_cost: { trait: 'aimed', ap: 1, per_turn: 0 } }, /weapon_cost\.per_turn 要是 1 以上的整數/],
    [{ weapon_cost: { trait: 'aimed', ap: 1, mood: 1 } }, /meat\.weapon_cost\.mood 不是可以用的鍵/],
    [{ cost: { ability: 'a', ap: 1, per_turn: 1 }, weapon_cost: { trait: 'aimed', ap: 1, per_turn: 2 } }, /共用同一個回合計數，兩邊要寫一樣的數字/],
    [{ trigger: 'ally_died' }, /meat\.trigger 只能是 ally_attacked、ally_attacked_adjacent/],
    [{ evade: 'x' }, /meat\.evade 要是數字/],
    [{ on_hit: 3 }, /meat\.on_hit 要是 \{ hit_against_ally \}/],
    [{ on_hit: { hit_against_ally: 'x' } }, /hit_against_ally 要是數字/],
    [{ on_hit: { mood: 1 } }, /meat\.on_hit\.mood 不是可以用的鍵/],
    [{ give_ap: { max: 'all' } }, /meat\.give_ap 要是 \{ max: 'one_plus_half_tier' \}/],
    [{ give_ap: { max: 'one_plus_half_tier', more: 1 } }, /meat\.give_ap\.more 不是可以用的鍵/],
    [{ call: 3 }, /meat\.call 要是 \{ options, per_fight, ap \}/],
    [{ call: { options: [], per_fight: 'half_tier_up', ap: 1 } }, /meat\.call\.options 要是至少一個/],
    [{ call: { options: ['nuke'], per_fight: 'half_tier_up', ap: 1 } }, /meat\.call\.options 要是至少一個/],
    [{ call: { options: ['shot'], per_fight: 'always', ap: 1 } }, /meat\.call\.per_fight 只能是 'half_tier_up'/],
    [{ call: { options: ['shot'], per_fight: 'half_tier_up', ap: -1 } }, /meat\.call\.ap 要是 0 以上的整數/],
    [{ call: { options: ['shot'], per_fight: 'half_tier_up', ap: 1, mood: 1 } }, /meat\.call\.mood 不是可以用的鍵/],
    [{ instinct: false }, /meat\.instinct 只能是 true/],
    [{ pending: false }, /meat\.pending 只能是 true/],
  ] as const)('meat 寫成 %j 擋下', (meat, re) => {
    expect(meatEdit(meat)).toMatch(re)
  })

  it('meat 寫成 null 或沒有 meat 的技能不檢查 meat 的子鍵', () => {
    expect(meatEdit(null)).toBe('')
    expect(meatEdit([])).toMatch(/meat 要是物件或 null/)
  })
})

describe('白箱 內容載入之後跨筆的檢查（ready；dev/work/M1-abilities.md）', () => {
  const kernelWith = (path: unknown[], ability: unknown[]) => {
    const k = createKernel([abilitiesFeature])
    k.content.loadPack({ id: 'x', content: { battle_status: TEST_STATUSES, path, ability } } as ContentPack)
    return k
  }
  const ready = (path: unknown[], ability: unknown[]) => () => readyFeatures(kernelWith(path, ability))

  it('招牌技能不存在、不在這棵樹、技能所屬的樹不存在：各一條', () => {
    expect(ready([{ ...PATH, signature: 'sk_none' }], [])).toThrow(/gunner：招牌技能 sk_none 不存在/)
    expect(ready([PATH, FIXER], [{ ...ABILITIES[3]!, id: 'sk_instinct' }])).toThrow(/招牌技能 sk_instinct 不在這棵樹（它屬於 fixer）/)
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, path: 'ghost' }])).toThrow(/sk_burst：沒有 ghost 這棵樹/)
  })

  it('category 和樹不同、前置不存在、前置不在同一棵樹', () => {
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, category: 'social' }])).toThrow(/category（social）要和戰鬥直覺的 category（meat）一樣/)
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, after: 'sk_ghost' }])).toThrow(/前置 sk_ghost 不存在/)
    expect(ready([PATH, FIXER], [ABILITIES[0], ABILITIES[3], { ...ABILITIES[1]!, after: 'sk_face' }])).toThrow(/前置 sk_face 不在同一棵樹/)
  })

  it('樹在某一欄寫 none，技能那一欄就要是 null；cost.ability 不存在；cost.per_turn 對到的不是主動技能', () => {
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, net: { x: 1 } }])).toThrow(/戰鬥直覺在內海沒有效果（domains\.net 是 none），net 要是 null/)
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, opinion: { x: 1 } }])).toThrow(/在輿論沒有效果/)
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, meat: { cost: { ability: 'sk_ghost', ap: 1 } } }])).toThrow(/meat\.cost\.ability 的 sk_ghost 不存在/)
    expect(ready([PATH], [ABILITIES[0], { ...ABILITIES[1]!, meat: { cost: { ability: 'sk_instinct', ap: 1, per_turn: 1 } } }])).toThrow(/sk_instinct 不是主動技能/)
    expect(ready([PATH], [ABILITIES[0], ABILITIES[1]])).not.toThrow()
  })

  it('引用檢查：path 的招牌、ability 的路數在載入後找得到（refs）', () => {
    const k = createKernel([abilitiesFeature])
    k.content.load('path', [PATH])
    expect(k.content.checkRefs()).toContain('path/gunner：引用了不存在的 ability/sk_instinct')
    k.content.load('ability', [{ ...ABILITIES[1]!, path: 'ghost' }])
    expect(k.content.checkRefs().join()).toMatch(/引用了不存在的 path\/ghost/)
  })
})

describe('白箱 單位上的資料與學裝（SKILLS 1.3、1.4；CORE_RULES 6.4）', () => {
  const unit = (ext: unknown): BattleUnit => ({ ext: { abilities: ext } }) as unknown as BattleUnit

  it('unitAbilities：沒有資料、不是物件、欄位型別不對都容錯；tiers 只留數字、equipped 只留字串', () => {
    expect(unitAbilities(unit(undefined))).toEqual({ equipped: [], tiers: {} })
    expect(unitAbilities(unit('x'))).toEqual({ equipped: [], tiers: {} })
    expect(unitAbilities(unit([1]))).toEqual({ equipped: [], tiers: {} })
    expect(unitAbilities(unit({ equipped: 'a', tiers: 'b' }))).toEqual({ equipped: [], tiers: {} })
    expect(unitAbilities(unit({ equipped: ['a', 5, null], tiers: { gunner: 3, fixer: 'x' } }))).toEqual({ equipped: ['a'], tiers: { gunner: 3 } })
  })

  it('abilitiesOf：壞掉的資料（NaN、型別不對）一律當成 0 或空的；回傳的是複製', () => {
    const state = makeState()
    state.actors.pc!.ext.abilities = { xp: Number.NaN, learned: ['a', 3], equipped: 'x', spent: { gunner: Number.POSITIVE_INFINITY, fixer: 40, bad: 'x' } }
    expect(abilitiesOf(state, 'pc')).toEqual({ xp: 0, learned: ['a'], equipped: [], spent: { fixer: 40 } })
    expect(abilitiesOf(state, 'ghost')).toEqual({ xp: 0, learned: [], equipped: [], spent: {} })
    state.actors.pc!.ext.abilities = 'oops'
    expect(abilitiesOf(state, 'pc').xp).toBe(0)
  })

  it('treeTier：累計花費對到 1～5 階的邊界（39/40/119/120/239/240/399/400）', () => {
    const k = createKernel([abilitiesFeature])
    const state = makeState()
    const tier = (spent: number) => { state.actors.pc!.ext.abilities = { spent: { gunner: spent } }; return treeTier(k, state, 'pc', 'gunner') }
    expect([0, 39, 40, 119, 120, 239, 240, 399, 400, 9999].map(tier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  })

  it('learnBlock：樹的名字不存在就用 id；前置技能不存在就用 id', () => {
    const k = createKernel([abilitiesFeature])
    k.content.load('path', [PATH])
    k.content.load('ability', [{ ...ABILITIES[1]!, tier: 2, xp: 40 }, { ...ABILITIES[0]!, id: 'sk_x', path: 'nowhere', after: 'sk_nope', tier: 1 }])
    const state = makeState()
    expect(learnBlock(k, state, 'pc', 'sk_burst')).toMatch(/槍手這棵樹還沒開到 2 階（要在這棵樹累計花 40 點，現在 0 點）/)
    expect(learnBlock(k, state, 'pc', 'sk_x')).toBe('要先學會sk_nope。')
    const k2 = createKernel([abilitiesFeature])
    k2.content.load('ability', [{ ...ABILITIES[1]!, tier: 2, xp: 40, path: 'nowhere' }])
    expect(learnBlock(k2, state, 'pc', 'sk_burst')).toMatch(/^nowhere這棵樹/)
  })

  it('capacityOf：技能被拿掉的內容、類別不在清單裡的略過；有橋的每類最低 8、壞掉的數字當 8；橋不是物件當沒有橋（0）', () => {
    const k = createKernel([abilitiesFeature])
    k.content.loadPack(BASE)
    const state = makeState()
    state.actors.pc!.ext.abilities = { equipped: ['sk_instinct', 'sk_ghost'] }
    state.actors.pc!.ext.bridge = { capacity: { meat: 12, net: 'x' } }
    expect(capacityOf(k, state, 'pc')).toEqual({ meat: { used: 3, max: 12 }, net: { used: 0, max: 8 }, social: { used: 0, max: 8 }, media: { used: 0, max: 8 } })
    state.actors.pc!.ext.bridge = 'x'
    expect(capacityOf(k, state, 'pc').meat.max).toBe(0)
  })
})

describe('白箱 戰鬥裡的技能：次數與條件（SKILL_TREES；dev/adr/0014）', () => {
  const equipped = (...ids: string[]) => ({ ext: { abilities: { equipped: ids, tiers: { gunner: 2, fixer: 4 } } } })
  const field = (allies: unknown[], foes: unknown[] = [foe('minion', { evade: 10 })], more: Parameters<typeof duel>[3] = {}, extra: ContentPack[] = []) =>
    arena(duel(allies, foes, undefined, more), FEATURES, (k) => { k.content.loadPack(BASE); for (const p of extra) k.content.loadPack(p); readyFeatures(k) })

  it('用量：每場、第一回合、每回合各一條原因（「這一場已經用過了」「只能在第一回合用」「這一回合已經用過了」）', () => {
    const pack: ContentPack = { id: 'use', content: { ability: [
      sk('sk_once', '每場一次', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1, per_fight: 1 }, meat: { target: 'self', apply: [{ status: 'suppressed' }] } }),
      sk('sk_first', '開場', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1, first_round: true }, meat: { target: 'self', apply: [{ status: 'marked' }] } }),
      sk('sk_turn', '每回合', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1, per_turn: 2 }, meat: { target: 'self', apply: [{ status: 'dazed' }] } }),
    ] } }
    const a = field([one({ weapon: 'pistol', ...equipped('sk_once', 'sk_first', 'sk_turn') })], undefined, undefined, [pack])
    const me = a.ally(1)
    const view = (id: string) => a.k.battle.getAction(id)!
    const run = a.run()
    expect(view('sk_once').blocks!(run, me)).toEqual([])
    view('sk_once').run(run, me, null, { action: 'sk_once' })
    expect(view('sk_once').blocks!(run, me)).toEqual(['這一場已經用過了。'])
    expect(view('sk_first').blocks!(run, me)).toEqual([])
    a.battle.round = 2
    expect(view('sk_first').blocks!(run, me)).toEqual(['只能在第一回合用。'])
    view('sk_turn').run(run, me, null, { action: 'sk_turn' })
    expect(view('sk_turn').blocks!(run, me)).toEqual([])
    view('sk_turn').run(run, me, null, { action: 'sk_turn' })
    expect(view('sk_turn').blocks!(run, me)).toEqual(['這一回合已經用過了。'])
    expect(me.statuses.map((s) => s.id)).toEqual(expect.arrayContaining(['suppressed', 'dazed']))
  })

  it('目標是我方的一格或敵方的一格：沒有人的格子灰掉（「那一格沒有人」）；run 對到沒有人的格子丟錯', () => {
    const pack: ContentPack = { id: 'slot', content: { ability: [
      sk('sk_ally_slot', '點名我方', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1 }, meat: { target: 'ally_slot', apply: [{ status: 'marked' }] } }),
      sk('sk_foe_slot', '點名敵方', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1 }, meat: { target: 'enemy_slot', apply: [{ status: 'marked' }] } }),
      sk('sk_ally', '點名隊友', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1 }, meat: { target: 'ally', apply: [{ status: 'marked' }] } }),
      sk('sk_none', '不挑目標', 'gunner', 1, 'active', 1, { after: 'sk_instinct', use: { ap: 1 }, meat: { target: 'none' } }),
    ] } }
    const a = field([one({ weapon: 'pistol', ...equipped('sk_ally_slot', 'sk_foe_slot', 'sk_ally', 'sk_none') }), one({}, 2)], [foe('minion')], undefined, [pack])
    const me = a.ally(1)
    const run = a.run()
    const targets = (id: string) => a.k.battle.getAction(id)!.targets!(run, me)
    expect(targets('sk_ally_slot').map((t) => t.blocks)).toEqual([[], [], ['那一格沒有人。'], ['那一格沒有人。']])
    expect(targets('sk_ally_slot')[0]!.target).toEqual({ side: 'ally', slot: 1 })
    expect(targets('sk_foe_slot').map((t) => t.blocks.length)).toEqual([0, 1, 1, 1])
    expect(targets('sk_foe_slot')[0]!.target).toEqual({ side: 'foe', slot: 1 })
    expect(targets('sk_ally').map((t) => t.target)).toEqual([{ unit: 'a2' }])
    expect(targets('sk_none')).toEqual([])
    const def = a.k.battle.getAction('sk_ally_slot')!
    expect(() => def.run(run, me, { side: 'ally', slot: 4 }, { action: 'sk_ally_slot' })).toThrow(/那一格沒有人/)
    expect(() => def.run(run, me, null, { action: 'sk_ally_slot' })).toThrow(/那一格沒有人/)
    def.run(run, me, { side: 'ally', slot: 2 }, { action: 'sk_ally_slot' })
    expect(a.ally(2).statuses.map((s) => s.id)).toEqual(['marked'])
    expect(() => a.k.battle.getAction('sk_none')!.run(run, me, null, { action: 'sk_none' })).not.toThrow()
    expect(() => def.run(run, me, { overlay: 'o1' }, { action: 'sk_ally_slot' })).toThrow(/那一格沒有人/)
  })

  it('攻擊型技能：沒有槍（空手或近戰）要拿著槍；彈匣不夠 min_mag；沒有 min_mag 時空彈匣；目標的命中率寫在 hint', () => {
    const a = field([one({ weapon: 'smg', ...equipped('sk_burst', 'sk_aim') })])
    const me = a.ally(1)
    const burst = a.k.battle.getAction('sk_burst')!
    const aim = a.k.battle.getAction('sk_aim')!
    const run = a.run()
    expect(burst.blocks!(run, me)).toEqual([])
    expect(burst.targets!(run, me)[0]).toMatchObject({ target: { unit: 'f1' }, hint: { hit: expect.any(Number) } })
    me.weapons[0]!.mag!.now = 1
    expect(burst.blocks!(run, me)).toEqual(['彈匣裡要有 2 格以上才能連射。'])
    me.weapons[0]!.mag!.now = 0
    expect(aim.blocks!(run, me)).toEqual(['彈匣空了，要先換彈。'])
    me.wield = 0
    me.weapons[0]!.traits = ['melee']
    expect(burst.blocks!(run, me)).toEqual(['要拿著槍才能用。'])
    const unarmed = field([one({ weapons: [], ...equipped('sk_aim') })])
    expect(unarmed.k.battle.getAction('sk_aim')!.blocks!(unarmed.run(), unarmed.ally(1))).toEqual(['要拿著槍才能用。'])
    expect(unarmed.k.battle.getAction('sk_aim')!.targets!(unarmed.run(), unarmed.ally(1))[0]).not.toHaveProperty('hint')
    // 沒有彈匣的槍（能量武器）不要求彈匣
    const noMag = field([one({ weapons: [{ ...testWeapon('pistol', 4), mag: undefined }], wield: 0, ...equipped('sk_aim') })])
    expect(noMag.k.battle.getAction('sk_aim')!.blocks!(noMag.run(), noMag.ally(1))).toEqual([])
  })

  it('連射：spend all 把彈匣剩下的花光；沒有 mag 的槍當 1 格；目標被打倒之後不擲壓制', () => {
    const a = field([one({ weapon: 'smg', ...equipped('sk_burst') })], [foe('minion', { evade: 10, hp: { now: 1, max: 1 } })])
    const me = a.ally(1)
    const run = a.run([15, 6, 6, 6, 1, 1, 1, 1, 1, 1, 1, 1])
    a.k.battle.getAction('sk_burst')!.run(run, me, { unit: 'f1' }, { action: 'sk_burst' })
    expect(me.weapons[0]!.mag!.now).toBe(0)
    expect(a.foe(1).out).toBe('down')
    expect(run.beats.some((b) => b.text.includes('定力'))).toBe(false)
  })

  it('指揮：讓出去的上限是 1 ＋ 階數的一半（階 4 是 3 點）；對方行動點滿了灰掉；自己不是目標；目標不是單位時什麼都不做', () => {
    const a = field([one({ weapon: 'pistol', ...equipped('sk_face') }), one({}, 2)])
    const me = a.ally(1)
    a.ally(2).ap.now = 1
    const def = a.k.battle.getAction('sk_face.give_ap')!
    const run = a.run()
    expect(def.targets!(run, me).map((t) => t.target)).toEqual([{ unit: 'a2' }])
    for (let i = 0; i < 3; i++) def.run(run, me, { unit: 'a2' }, { action: def.id })
    expect(a.ally(2).ap.now).toBe(4)
    expect(def.blocks!(run, me)).toEqual(['這一回合已經讓了 3 點，不能再讓。'])
    a.ally(2).ap.now = a.ally(2).ap.max
    expect(def.targets!(run, me)[0]!.blocks).toEqual(['他的行動點已經滿了。'])
    const before = JSON.stringify(a.battle)
    def.run(run, me, { side: 'ally', slot: 2 }, { action: def.id })
    def.run(run, me, null, { action: def.id })
    expect(JSON.stringify(a.battle)).toBe(before)
  })

  it('叫人：選項只列技能寫了的；用量是階數的一半進位；每一種壞目標、壞選項都擋下（審查 S8）', () => {
    const only: ContentPack = { id: 'only', content: { ability: [sk('sk_call2', '只能支援射擊', 'fixer', 1, 'passive', 1, { after: 'sk_face', meat: { call: { options: ['shot'], per_fight: 'half_tier_up', ap: 2 } } })] } }
    const a = field([one({ weapon: 'pistol', ...equipped('sk_face', 'sk_call2') })], [foe('minion', { evade: 10 }), foe('minion')], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } }, [only])
    const me = a.ally(1)
    const call = a.k.battle.getAction('sk_face.call')!
    const run = a.run()
    const ts = call.targets!(run, me)
    expect(ts.filter((t) => 'side' in t.target && t.target.side === 'ally')).toHaveLength(4)
    expect(ts.filter((t) => 'side' in t.target && t.target.side === 'foe').map((t) => t.blocks)).toEqual([[], ['這一格沒有遮蔽可以拆。'], ['這一格沒有遮蔽可以拆。'], ['這一格沒有遮蔽可以拆。']])
    expect(ts.filter((t) => 'unit' in t.target)).toHaveLength(2)
    const opts = call.picks!(run, me)[0]!.options
    expect(opts.map((o) => o.value)).toEqual(['shot', 'cover_up', 'cover_down'])
    expect(opts[2]!.for).toEqual([{ side: 'foe', slot: 1 }])
    const bad = (input: Record<string, unknown>) => () => call.run(run, me, null, { action: call.id, ...input } as never)
    expect(bad({})).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'nuke' }, target: { unit: 'f1' } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'shot' } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'cover_up' }, target: { unit: 'f1' } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'cover_up' }, target: { side: 'foe', slot: 1 } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'cover_up' }, target: { side: 'ally', slot: 9 } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'cover_down' }, target: { side: 'ally', slot: 1 } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'cover_down' }, target: { side: 'foe', slot: 3 } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'cover_down' }, target: { unit: 'f1' } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'shot' }, target: { side: 'foe', slot: 1 } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'shot' }, target: { unit: 'a1' } })).toThrow(/叫人要選一件事/)
    expect(bad({ pick: { option: 'shot' }, target: { unit: 'zz' } })).toThrow(/叫人要選一件事/)
    a.foe(2).out = 'down'
    expect(bad({ pick: { option: 'shot' }, target: { unit: 'f2' } })).toThrow(/叫人要選一件事/)
    expect(me.uses['sk_face.call']).toBeUndefined()
    // 階 4 → 2 次；兩種技能的叫人各自記次數
    for (let i = 0; i < 2; i++) call.run(run, me, null, { action: call.id, pick: { option: 'cover_up' }, target: { side: 'ally', slot: 2 } })
    expect(call.blocks!(run, me)).toEqual(['這一場叫人的次數用完了（2 次）。'])
    expect(a.battle.cover.ally[1]!.level).toBe(2)
  })

  it('換個位子嘛：選的人不能是自己、不能是同一個人、要在我方場上且相鄰；run 的每一種壞選擇都擋下', () => {
    const pack: ContentPack = { id: 'swap', content: { ability: [sk('sk_swap', '換個位子嘛', 'fixer', 1, 'active', 1, { after: 'sk_face', use: { ap: 1 }, meat: { target: 'ally', free_move: { swap_adjacent_pair: true } } })] } }
    const a = field([one({ weapon: 'pistol', ...equipped('sk_face', 'sk_swap') }), one({}, 2), one({}, 3)], undefined, undefined, [pack])
    const me = a.ally(1)
    const def = a.k.battle.getAction('sk_swap')!
    const run = a.run()
    const picks = def.picks!(run, me)
    expect(picks.map((p) => p.key)).toEqual(['with'])
    expect(picks[0]!.options.map((o) => [o.value, o.for])).toEqual([['a2', [{ unit: 'a3' }]], ['a3', [{ unit: 'a2' }]]])
    const bad = (target: unknown, w: unknown) => () => def.run(run, me, target as never, { action: def.id, pick: { with: w } })
    expect(bad({ unit: 'a2' }, undefined)).toThrow(/要選兩名相鄰的隊友/)
    expect(bad({ unit: 'a2' }, 'a1')).toThrow(/要選兩名相鄰的隊友/)
    expect(bad({ unit: 'a2' }, 'a2')).toThrow(/要選兩名相鄰的隊友/)
    expect(bad({ unit: 'a2' }, 'f1')).toThrow(/要選兩名相鄰的隊友/)
    expect(bad({ unit: 'a2' }, 'zz')).toThrow(/要選兩名相鄰的隊友/)
    a.ally(3).out = 'down'
    expect(bad({ unit: 'a2' }, 'a3')).toThrow(/要選兩名相鄰的隊友/)
    a.ally(3).out = undefined
    expect(bad(null, 'a3')).toThrow(/那一格沒有人/)
    expect(bad({ unit: 'a3' }, 'a2')).not.toThrow()
  })

  it('pending 的技能與沒有 target 的主動技能不註冊行動；被動技能不註冊（招牌的指揮與叫人例外）', () => {
    const pack: ContentPack = { id: 'pend', content: { ability: [
      sk('sk_pend', '還沒做', 'gunner', 1, 'active', 1, { after: 'sk_instinct', meat: { pending: true, target: 'enemy' } }),
      sk('sk_notarget', '沒目標', 'gunner', 1, 'active', 1, { after: 'sk_instinct', meat: { attack: { aimed: true } } }),
      sk('sk_pass', '被動', 'gunner', 1, 'passive', 1, { after: 'sk_instinct', meat: { target: 'enemy' } }),
      sk('sk_nomeat', '沒有效果', 'gunner', 1, 'active', 1, { after: 'sk_instinct' }),
    ] } }
    const a = field([one()], undefined, undefined, [pack])
    for (const id of ['sk_pend', 'sk_notarget', 'sk_pass', 'sk_nomeat']) expect(a.k.battle.getAction(id), id).toBeUndefined()
    expect(a.k.battle.getAction('sk_burst')).toBeDefined()
  })
})

describe('白箱 花費的減免與反應（SKILLS 1.8；dev/adr/0014；不變式第 60 條）', () => {
  const equipped = (...ids: string[]) => ({ ext: { abilities: { equipped: ids, tiers: { gunner: 2, fixer: 4 } } } })
  const withCosts = (cost: unknown, extra: unknown[] = []) => ({
    id: 'cost', content: {
      ability: [
        sk('sk_discount', '省', 'gunner', 1, 'passive', 1, { after: 'sk_instinct', meat: cost }),
        ...extra,
      ],
    },
  }) as ContentPack
  const field = (allies: unknown[], pack: ContentPack, foes: unknown[] = [foe('minion', { evade: 10 })]) =>
    arena(duel(allies, foes), FEATURES, (k) => { k.content.loadPack(BASE); k.content.loadPack(pack); readyFeatures(k) })
  const costOf = (a: ReturnType<typeof field>, u: BattleUnit, id: string) => a.k.battle.getAction(id)!.cost(a.run(), u)

  it('回傳的是「差幾點」：原價沒有被改；沒有 base（不是問 action_ap）的修正不給；沒裝的技能不給', () => {
    const a = field([one({ weapon: 'pistol', ...equipped('sk_discount') })], withCosts({ cost: { ability: 'sk_aim', ap: 1 } }))
    const me = a.ally(1)
    const run = a.run()
    expect(run.mods('action_ap', me, undefined, me.weapons[0], ['sk_aim'], 3).map((p) => p.value)).toEqual([-2])
    expect(run.mods('action_ap', me, undefined, me.weapons[0], ['sk_aim']).map((p) => p.value)).toEqual([])
    expect(run.mods('action_ap', me, undefined, me.weapons[0], ['sk_burst'], 3)).toEqual([])
    const plain = field([one({ weapon: 'pistol' })], withCosts({ cost: { ability: 'sk_aim', ap: 1 } }))
    expect(plain.run().mods('action_ap', plain.ally(1), undefined, undefined, ['sk_aim'], 3)).toEqual([])
    expect(costOf(a, me, 'sk_aim')).toEqual({ ap: 3 })
  })

  it('每回合型的減免：用完次數、或減免之後不比原價便宜就不算；多筆取最便宜的一筆', () => {
    const extra = [sk('sk_discount2', '更省', 'gunner', 1, 'passive', 1, { after: 'sk_instinct', meat: { cost: { ability: 'sk_aim', ap: 0, per_turn: 1 } } })]
    const a = field([one({ weapon: 'pistol', ...equipped('sk_discount', 'sk_discount2') })], withCosts({ cost: { ability: 'sk_aim', ap: 2 } }, extra))
    const me = a.ally(1)
    const ap = (base: number) => a.run().mods('action_ap', me, undefined, me.weapons[0], ['sk_aim'], base).reduce((s, p) => s + p.value, 0)
    expect(ap(3)).toBe(-3) // 更省：3 → 0
    me.uses['turn:sk_discount2.discount'] = 1
    expect(ap(3)).toBe(-1) // 次數用完：剩 2
    const b = field([one({ weapon: 'pistol', ...equipped('sk_discount') })], withCosts({ cost: { ability: 'sk_aim', ap: 3, per_turn: 1 } }))
    expect(b.run().mods('action_ap', b.ally(1), undefined, b.ally(1).weapons[0], ['sk_aim'], 3)).toEqual([]) // 不比原價便宜
  })

  it('weapon_cost：要是用手上的武器攻擊（weapon_attack 標籤）而且武器帶那個特性才算', () => {
    const a = field([one({ weapons: [{ ...testWeapon('pistol', 4), traits: ['aimed'] }, testWeapon('smg', 4)], wield: 0, ...equipped('sk_discount') })], withCosts({ weapon_cost: { trait: 'aimed', ap: 2 } }))
    const me = a.ally(1)
    const q = (tags: string[], w: (typeof me.weapons)[number] | null = me.weapons[0]!) => a.run().mods('action_ap', me, undefined, w ?? undefined, tags, 3).reduce((s, p) => s + p.value, 0)
    expect(q(['test.attack', 'weapon_attack'])).toBe(-1)
    expect(q(['test.attack'])).toBe(0)
    expect(q(['test.attack', 'weapon_attack'], me.weapons[1])).toBe(0)
    expect(q(['x', 'weapon_attack'], null)).toBe(0)
  })

  it('共鳴：先攻只算階數到了的；free_move 每場有次數才減免（自己換位用掉一次），別人替他換位不算', () => {
    const a = field([one({ weapon: 'pistol', ext: { abilities: { equipped: ['sk_instinct', 'sk_face'], tiers: { gunner: 1, fixer: 2 } } } })], withCosts({}))
    const me = a.ally(1)
    const run = a.run()
    expect(run.mods('initiative', me).map((p) => p.value)).toEqual([3])
    me.ext.abilities = { equipped: ['sk_instinct', 'sk_face'], tiers: { gunner: 1, fixer: 1 } }
    expect(run.mods('move_ap', me)).toEqual([])
    me.ext.abilities = { equipped: ['sk_face'], tiers: { fixer: 2 } }
    expect(run.mods('move_ap', me).map((p) => p.value)).toEqual([-1])
    expect(run.mods('initiative', me)).toEqual([])
    expect(run.mods('hit', me).filter((p) => p.source === 'skill')).toEqual([])
    me.uses.free_move = 1
    expect(run.mods('move_ap', me)).toEqual([])
    me.ext.abilities = { equipped: [], tiers: {} }
    expect(run.mods('move_ap', me)).toEqual([])
  })

  it('moved 掛點：只有輪到自己的時候自己換位才算用掉；被推拉（forced）不算', () => {
    const a = field([one({ weapon: 'pistol' }), one({}, 2)], withCosts({}))
    const run = a.run()
    const cur = a.battle.units[a.battle.order[a.battle.turn]!]!
    const other = Object.values(a.battle.units).find((u) => u.id !== cur.id && u.side === cur.side && u.slot > 0)!
    const to = other.slot
    run.move(cur, to)
    expect(cur.uses.free_move).toBe(1)
    run.place(other, cur.slot, undefined)
    expect(other.uses.free_move).toBeUndefined()
  })

  it('反應：攻擊自己人（同一邊）、反應的那一槍不再觸發別人的反應；不在場、行動點不夠、沒槍、沒彈匣、用量用完的隊友不觸發', () => {
    const pack: ContentPack = { id: 'react', content: { ability: [
      sk('sk_cover', '掩護射擊', 'gunner', 1, 'reaction', 1, { after: 'sk_instinct', use: { ap: 2, per_fight: 1 }, meat: { trigger: 'ally_attacked', attack: { at: 'attacker' }, on_hit: { hit_against_ally: -2 } } }),
      sk('sk_watch', '小心後面', 'fixer', 1, 'reaction', 1, { after: 'sk_face', use: { ap: 1 }, meat: { trigger: 'ally_attacked', evade: 3 } }),
    ] } }
    const a = arena(duel([one({ weapon: 'pistol', ...equipped('sk_cover') }), one({}, 2)], [foe('minion', { weapon: 'pistol' })]), FEATURES, (k) => { k.content.loadPack(BASE); k.content.loadPack(pack); readyFeatures(k) })
    const [a1, a2] = [a.ally(1), a.ally(2)]
    const f = a.foe(1)
    const trigger = (): number => { const run = a.run([10, 3, 3, 3, 12, 2, 2, 2, ...Array(40).fill(1)]); run.attack(f, a2); return run.beats.filter((b) => b.tag === 'skill').length }
    expect(trigger()).toBe(1)
    expect(trigger()).toBe(0) // 每場一次用完了
    delete a1.uses['sk_cover']
    a1.ap.now = 1
    expect(trigger()).toBe(0) // 行動點不夠
    a1.ap.now = 5
    a1.weapons[0]!.mag!.now = 0
    expect(trigger()).toBe(0) // 沒彈匣
    a1.weapons[0]!.mag!.now = 2
    a1.weapons[0]!.traits = ['melee']
    expect(trigger()).toBe(0) // 近戰
    a1.weapons[0]!.traits = []
    a1.out = 'down'
    a1.slot = 0
    expect(trigger()).toBe(0) // 不在場
    a1.out = undefined
    a1.slot = 1
    // 打自己人的人（同一邊）不觸發；帶 reaction 標籤的攻擊不觸發
    const run = a.run(Array(60).fill(10))
    run.attack(a1, a2)
    expect(run.beats.filter((b) => b.tag === 'skill')).toHaveLength(0)
    const run2 = a.run(Array(60).fill(10))
    run2.attack(f, a2, { tags: ['reaction'] })
    expect(run2.beats.filter((b) => b.tag === 'skill')).toHaveLength(0)
  })

  it('反應之後攻擊的人或被打的人已經退出：後面的隊友不再反應', () => {
    const pack: ContentPack = { id: 'react2', content: { ability: [
      sk('sk_watch', '小心後面', 'fixer', 1, 'reaction', 1, { after: 'sk_face', use: { ap: 1 }, meat: { trigger: 'ally_attacked', evade: 3 } }),
    ] } }
    const a = arena(duel([one({ weapon: 'pistol', ...equipped('sk_watch') }), one({}, 2), one({ weapon: 'pistol', ...equipped('sk_watch') }, 3)], [foe('minion')]), FEATURES, (k) => { k.content.loadPack(BASE); k.content.loadPack(pack); readyFeatures(k) })
    const run = a.run(Array(60).fill(10))
    a.ally(2).out = 'down'
    run.attack(a.foe(1), a.ally(2))
    expect(run.beats.filter((b) => b.tag === 'skill')).toHaveLength(0)
  })

  it('unit.ready：有角色的單位照開打那一刻填 equipped 與每棵樹的階；已經有資料的單位不動；沒有角色的單位不填', () => {
    const { game } = makeBattleGame({
      features: FEATURES, content: [BASE],
      pc: { ext: { abilities: { equipped: ['sk_instinct', 7], spent: { gunner: 130, fixer: 'x' } } } },
      battle: { ...duel([], []), allies: [{ from: 'actor', id: 'pc' }, raw(one({ ext: { abilities: { equipped: ['keep'], tiers: {} } } }, 2)), raw(one({}, 3))], foes: [raw(foe())], cover: 'medium' },
    })
    const b = game.battle!
    expect(b.units.a1!.ext.abilities).toEqual({ equipped: ['sk_instinct'], tiers: { gunner: 3 } })
    expect(b.units.a2!.ext.abilities).toEqual({ equipped: ['keep'], tiers: {} })
    expect(b.units.a3!.ext.abilities).toBeUndefined()
    const bare = makeBattleGame({ features: FEATURES, content: [BASE], pc: { ext: { abilities: 'oops' } }, battle: { ...duel([], []), allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())], cover: 'medium' } })
    expect(bare.game.battle!.units.a1!.ext.abilities).toEqual({ equipped: [], tiers: {} })
  })
})
