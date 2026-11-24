// 驗收測試：dev/work/M2-commission-gen.md（cpp-feature）。照類型的模板生成一件具體的委託（副本加簡報加未知清單），回答中間人「今天有哪些委託」（fixer.offers）。
// 規格：COMMISSIONS 第 7 節（類型表）、7.1 節（階段怎麼排）、7.2 節、第 9 節、2.3 節；FIXER 第 2 節「未知清單」、第 3 節；ENEMIES 第 13 節；SITES 12.3 節；AI_TASKS 3.17 節（第 1、3 步）；dev/adr/0016 第五節。
// 內容一律是測試自帶的最小假資料：兩種類型、兩張地圖（另有一張只給串起來那一條用的小房間）、兩個中間人、三個連動、兩個詞條。
// 補充（M2-fixer）：生成的委託寫 commission.block（中間人那一塊街區，go 會檢查）；回答 fixer.offers 時同一天回答一樣的東西。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ContentError, effectCtx, meterOf, repGrade, toMinutes } from '../../src'
import { commissionFeature, readRun, chooseBranch, chooseFace } from '../../src/features/commission'
import { defeatFeature } from '../../src/features/defeat'
import { enemiesFeature } from '../../src/features/enemies'
import { summonsFeature } from '../../src/features/summons'
import { exploreFeature } from '../../src/features/explore'
import {
  GEN_RETRIES, OFFERS_PER_DAY, accept, board, commissionIdOf, eligibleTypes, fixerFeature, generate, generateTrace, genProblems, genRules, genRuleProblems, go, jobOf, linkProblems, modifierProblems,
  offerProblems, offerSeed, offersFor, registeredFaces, scoutedOf, stagePlan, typeProblems,
} from '../../src/features/fixer'
import type { FixerEntry, Offer, TypeEntry } from '../../src/features/fixer'
import { TEST_COMBAT, makeGame, observed, playOut, stateHash, testWeapon } from '../../src/testkit'

type Rec = Record<string, unknown>
type G = ReturnType<typeof makeGame>['game']

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = [
  { id: 'firearms', attr: 'reflex' }, { id: 'brawl', attr: 'body' }, { id: 'composure', attr: 'resolve' }, { id: 'stealth', attr: 'reflex' }, { id: 'negotiate', attr: 'charm' },
  { id: 'seduce', attr: 'charm' }, { id: 'perform', attr: 'charm' }, { id: 'mechanics', attr: 'tech' }, { id: 'interface', attr: 'intellect' }, { id: 'athletics', attr: 'body' },
  { id: 'investigate', attr: 'intellect' }, { id: 'streetwise', attr: 'intellect' },
].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const FACTIONS = ['f_a', 'f_b', 'f_none'].map((id) => ({ id, name: `勢力${id}`, short: `${id}社`, class: 'corp' }))

/** 一碰就倒的假兵種：測試只關心「打贏」。f_a、f_b 三種位階都有；f_none 一個兵種也沒有（挑不到敵人）。 */
const enemy = (id: string, rank: string, faction: string, more: Rec = {}): Rec => ({
  id, name: `${faction}的${rank}`, desc: '測試用的敵人。', faction, rank, grades: [1, 5], kind: 'human', mods: { hp: 0.5, evade: -30, attack: -8 },
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...more,
})
const ENEMIES = [
  ...(['f_a', 'f_b'] as const).flatMap((f) => (['minion', 'elite', 'boss'] as const).map((r) => enemy(`en_${f}_${r}`, r, f))),
  // 網內的兵種（M3 修正批：中間人生成內海面時先問過網內的敵人挑得到；粉與黑各一）
  ...(['f_a', 'f_b'] as const).flatMap((f) => (['minion', 'elite', 'boss'] as const).flatMap((r) => (['pink', 'black'] as const).map((c) => enemy(`la_${f}_${r}_${c}`, r, f, {
    kind: 'lace', color: c, mode: undefined, weapons: undefined, constructs: [{ id: `cs_${f}_${r}_${c}`, class: 'pistol', type: 'neural', ram: 1 }],
  })))),
  // 獵犬：掛在格上的一台（enemy_pick 不會挑它）
  enemy('en_hound', 'minion', 'f_a', { name: '機械獵犬', kind: 'machine', position: { prefer: [2, 3], size: 'overlay' }, overlay: { kind: 'attack' } }),
]

/** DATA 9.3 節的小辦公室（和 M2-commission-run 的測試同一張）：三個入口、兩個保全崗、三個目標點。 */
const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '主管室的控制面板' },
    { id: '$1', at: [3, 5], mark: '$', name: '檔案間的小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [
    { id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] },
    { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] },
  ],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
/** 一間敞開的小房間（9×5，三個入口、一個保全崗、一個目標點、一個撤離點）：走得到每一格，串起來那一條用。 */
const room = (sheet: string, name: string): Rec => ({
  id: sheet, name, size: [9, 5],
  layout: ['####E####', '#..1.G..#', 'E...T...E', '#..2....#', '###X#####'],
  zones: ['####a####', '#aaaaaaa#', 'aaaaaaaaa', '#aaaaaaa#', '###a#####'],
  cells: [
    { id: 'E1', at: [4, 0], mark: 'E', kind: 'front', name: '北門' }, { id: 'E2', at: [0, 2], mark: 'E', kind: 'back', name: '西門' }, { id: 'E3', at: [8, 2], mark: 'E', kind: 'side', name: '東門' },
    { id: 'G1', at: [5, 1], mark: 'G', name: '守衛的位置' }, { id: 'T1', at: [4, 2], mark: 'T', name: '目標' }, { id: 'X1', at: [3, 4], mark: 'X', name: '撤離點' },
  ],
  spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [3, 3], cover: 'medium' }],
})
/** 兩張地圖：A 是小辦公室（兩種類型都能用；舊港的權重高），B 是小房間（只給 t_hit；玻璃岸的權重高）。 */
const MAP_A = { id: 'map_a', kind: 'office_small', size: [9, 9], fits: ['t_hit', 't_net'], district_weight: { glass_shore: 1, old_port: 3 }, sheets: [OFFICE] }
const MAP_B = { id: 'map_b', kind: 'room', size: [9, 5], fits: ['t_hit'], district_weight: { glass_shore: 3 }, sheets: [room('room_b', '玻璃岸的小房間')] }
/** 串起來那一條專用：平常的區都沒有它的權重（不會被抽到）；整個世界只有它的時候，退回「fits 含這個類型的都可以」。 */
const MAP_C = { id: 'map_c', kind: 'room', size: [9, 5], fits: ['t_hit'], district_weight: { chain_only: 1 }, sheets: [room('room_c', '密談的小房間')] }

const TYPE_HIT = {
  id: 't_hit', name: '暗殺', main: 'meat', decisive: { kind: 'take', at: 'T' },
  stages: [
    { name: '找到他', faces: ['meat', 'net', 'opinion'] },
    { name: '靠近他', faces: ['meat', 'net'] },
    { name: '動手', faces: ['meat'] },
  ],
  extra: [{ name: '他的護衛', faces: ['meat', 'net'] }, { name: '最後一道門', faces: ['meat', 'opinion'] }],
  branches: { stealth: 'stealth', talk: 'negotiate' },
  brief: '替{fixer}處理{faction}在{district}的一個人，地點在{place}。',
  gives: { meat: ['lk_key'], net: ['lk_cam', 'lk_door'] },
}
/** 主面是內海的類型（竊密）：沒有人登記內海的玩法時抽不到（最後一個階段只有內海）。 */
const TYPE_NET = {
  id: 't_net', name: '竊密', main: 'net', decisive: { kind: 'fight' },
  stages: [
    { name: '拿到入口', faces: ['meat', 'net'] },
    { name: '往下一層', faces: ['net', 'meat'] },
    { name: '下載', faces: ['net'] },
  ],
  extra: [{ name: '多一層子網', faces: ['net'] }, { name: '中途出了狀況', faces: ['net', 'meat'] }],
  branches: { stealth: 'stealth' },
  brief: '{faction}的{place}裡有一份資料，{fixer}要它。',
  gives: {},
}
const LINKS = [
  { id: 'lk_cam', name: '關掉監視器', from: 'net', to: 'meat', type: 'skip', effect: { skip_explore: true } },
  { id: 'lk_key', name: '門禁卡', from: 'meat', to: 'meat', type: 'open' },
  { id: 'lk_door', name: '接管控制節點', from: 'net', to: 'meat', type: 'ease', effect: { encounter_half: true } },
]
const MODS = [
  { id: 'md_hounds', name: '機械獵犬', text: '每一場現實遭遇多兩隻機械獵犬。', effect: { attached: [{ enemy: 'en_hound', count: 2 }] } },
  { id: 'md_maint', name: '子網維護', text: '今晚第一階段的子網在維護，只能走現實。', effect: { lock_face: { stage: 1, face: 'meat' } } },
]

const FIXERS = [
  { id: 'fx_a', name: '玻璃岸的帳房', npc: 'npc_a', district: 'glass_shore', block: 'blk_shop', kinds: ['t_hit', 't_net'], cut: 0.1 },
  { id: 'fx_b', name: '舊港的帳房', npc: 'npc_b', district: 'old_port', kinds: ['t_hit'], cut: 0.1 },
  { id: 'fx_c', name: '小房間的中間人', npc: 'npc_c', district: 'glass_shore', block: 'blk_shop', kinds: ['t_hit'], cut: 0.1 },
  { id: 'fx_bad', name: '手上沒有敵人的人', npc: 'npc_d', district: 'bad_d', kinds: ['t_hit'], cut: 0.1 },
  { id: 'fx_half', name: '一半勢力沒有敵人的人', npc: 'npc_e', district: 'half_d', kinds: ['t_hit'], cut: 0.1 },
]
const DISTRICTS = [
  { id: 'glass_shore', name: '玻璃岸', grade: 3, blocks: [], factions: ['f_a', 'f_b'] },
  { id: 'old_port', name: '舊港', grade: 2, blocks: [], factions: ['f_a'] },
  { id: 'bad_d', name: '空區', grade: 1, blocks: [], factions: ['f_none'] },
  { id: 'half_d', name: '半空區', grade: 1, blocks: [], factions: ['f_a', 'f_none'] },
]

const DEFEAT = [
  { id: 'df_generic', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: false, default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [] } } },
]

const pack = (more: Record<string, unknown[]> = {}): ContentPack => ({
  id: 'm2_commission_gen',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, enemy: ENEMIES as never, special_map: [MAP_A, MAP_B, MAP_C] as never,
    district: DISTRICTS as never, npc: ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'].map((id) => ({ id, name: id })) as never, fixer: FIXERS as never, commission_type: [TYPE_HIT, TYPE_NET] as never, commission_link: LINKS as never, commission_modifier: MODS as never,
    defeat_event: DEFEAT as never, ...more,
  } as never,
})

/** 地區的種類（world 沒有裝時，由測試自己定義；fixer 的 ready 會查區在不在）。 */
const DISTRICT_KIND: Feature = {
  id: 'test_district',
  install(k) { k.content.defineKind({ kind: 'district', owner: 'test_district', validate: () => [] }) },
}
/** 條件 in_block 的替身（world 的功能不 import）。 */
const IN_BLOCK: Feature = {
  id: 'test_in_block',
  install(k: Kernel) {
    k.conditions.register<{ kind: string; blocks: string[] }>({
      kind: 'in_block', owner: 'test_in_block', validate: () => [],
      test: (c, { state }) => !!state.location.block && c.blocks.includes(state.location.block),
    })
  },
}
/** 別的面（內海）的玩法的替身：只是登記這種活動。 */
const FACE_NET: Feature = {
  id: 'test_face_net',
  install(k: Kernel) {
    k.activity.define({ kind: 'face.net', owner: 'test_face_net', order: 50, active: () => null, allow: [], reason: () => '替身活動。' })
  },
}
/** 主角要有武器；檢定強到不用擔心（串起來那一條只走強攻）。 */
const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5, 30)] })) } }
const STRONG = { attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 }, skills: { mechanics: 5, interface: 5, athletics: 5, stealth: 3, negotiate: 3 } }

interface Opts { seed?: number; features?: Feature[]; content?: ContentPack[]; rep?: number; noEnemies?: boolean; noCommission?: boolean }
function setup(o: Opts = {}): G {
  const base: Feature[] = [DISTRICT_KIND, exploreFeature, ...(o.noEnemies ? [] : [enemiesFeature]), summonsFeature, defeatFeature, TEST_COMBAT, GEAR as never, ...(o.noCommission ? [] : [commissionFeature]), fixerFeature, ...(o.features ?? [])]
  const g = makeGame({ seed: o.seed, features: base, content: o.content ?? [pack()], pc: STRONG as never }).game
  if (o.rep !== undefined) setRep(g, o.rep)
  return g
}

const sysDraft = (changes: ReportDraft['changes'], action = 'test.setup'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
function setRep(g: G, n: number): void {
  const r = g.k.effects.resolve([{ kind: 'rep', amount: n - meterOf(g.k, g.state, 'rep'), final: true }], effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(r.errors).toEqual([])
  g.commit(sysDraft(r.changes))
}
const fixerOf = (g: G, id = 'fx_a'): FixerEntry => g.k.content.get('fixer', id) as unknown as FixerEntry
const gen = (g: G, seed: string, fixer = 'fx_a'): Offer => {
  const o = generate(g.k, g.state, { fixer: fixerOf(g, fixer), seed })
  expect(o, `seed ${seed} 生成不出來`).not.toBeNull()
  return o!
}
const many = (g: G, n = 100, fixer = 'fx_a', prefix = 's'): Offer[] => Array.from({ length: n }, (_, i) => gen(g, `${prefix}${i}`, fixer))
const stagesOf = (o: Offer): Array<{ name?: string; faces: Record<string, Rec> }> => o.commission.stages as never
const faceList = (o: Offer, i: number): string[] => Object.keys(stagesOf(o)[i]!.faces)
const gradeOf = (o: Offer): number => o.commission.grade as number
const mainOf = (o: Offer): string => o.commission.main as string
const sizeOf = (o: Offer): string => o.commission.scale as string

// ===================================================================================================================
// 模板與規則的格式
// ===================================================================================================================

describe('模板、詞條、連動、規則的格式', () => {
  it('好的資料沒有問題；genProblems 在載入之後查模板', () => {
    const g = setup()
    expect(genProblems(g.k)).toEqual([])
    expect(typeProblems(TYPE_HIT as never)).toEqual([])
    expect(typeProblems(TYPE_NET as never)).toEqual([])
    for (const m of MODS) expect(modifierProblems(m as never)).toEqual([])
    for (const l of LINKS) expect(linkProblems(l as never)).toEqual([])
  })

  it('最後一個階段只有主面、每個階段至少一個面、decisive 寫得出目標、brief 的空格要認得、至少一個階段可以選兩個面', () => {
    const bad = (patch: Rec) => typeProblems({ ...TYPE_HIT, ...patch } as never)
    expect(bad({ stages: [TYPE_HIT.stages[0], TYPE_HIT.stages[1], { name: '動手', faces: ['meat', 'net'] }] }).join('')).toMatch(/最後一個階段只有主面/)
    expect(bad({ stages: [TYPE_HIT.stages[0], TYPE_HIT.stages[1], { name: '動手', faces: ['net'] }] }).join('')).toMatch(/最後一個階段只有主面/)
    expect(bad({ stages: [TYPE_HIT.stages[0], { name: '靠近他', faces: [] }, TYPE_HIT.stages[2]] }).join('')).toMatch(/stages\[1\]\.faces 要是至少一個面/)
    expect(bad({ stages: [TYPE_HIT.stages[0], TYPE_HIT.stages[1]] }).join('')).toMatch(/剛好三個階段/)
    expect(bad({ decisive: { kind: 'take' } }).join('')).toMatch(/decisive\.at/)
    expect(bad({ decisive: { kind: 'check', at: 'T' } }).join('')).toMatch(/decisive\.basic/)
    expect(bad({ decisive: { kind: 'scene', goal: 'please' } }).join('')).toMatch(/decisive\.with/)
    expect(bad({ decisive: { kind: 'shoot' } }).join('')).toMatch(/decisive\.kind/)
    expect(bad({ brief: '去找{boss}。' }).join('')).toMatch(/\{boss\}/)
    expect(bad({ stages: [{ name: 'a', faces: ['meat'] }, { name: 'b', faces: ['meat'] }, { name: 'c', faces: ['meat'] }] }).join('')).toMatch(/至少要有一個可以選兩個以上的面/)
    expect(bad({ stages: [{ name: 'a', faces: ['meat'] }, { name: 'b', faces: ['meat'] }, { name: 'c', faces: ['meat'] }], extra: [], branches: {} })).toEqual([])
    // 主面不是現實的類型，決定性的一步不能是站上標記
    expect(typeProblems({ ...TYPE_NET, decisive: { kind: 'take', at: 'T' } } as never).join('')).toMatch(/主面不是現實/)
    // 沒有選擇的類型（網內打撈）不受「至少一個階段兩個面」限制
    expect(typeProblems({ ...TYPE_NET, stages: [{ name: 'a', faces: ['net'] }, { name: 'b', faces: ['net'] }, { name: 'c', faces: ['net'] }], extra: [] } as never)).toEqual([])
  })

  it('詞條與連動的格式', () => {
    expect(modifierProblems({ id: 'x', name: 'x', text: 'x', effect: { lock_face: { stage: 0, face: 'meat' } } } as never).join('')).toMatch(/lock_face/)
    expect(modifierProblems({ id: 'x', name: 'x', text: 'x', effect: { attached: [] } } as never).join('')).toMatch(/attached/)
    expect(modifierProblems({ id: 'x', name: 'x', text: 'x', effect: { foes_plus: 9 } } as never).join('')).toMatch(/foes_plus/)
    expect(modifierProblems({ id: 'x', name: 'x', text: 'x', effect: { magic: 1 } } as never).join('')).toMatch(/magic/)
    expect(modifierProblems({ id: 'x', name: 'x', text: 'x', effect: {} } as never)).toEqual([])
    expect(linkProblems({ id: 'x', name: 'x', from: 'sea', to: 'meat', type: 'open' } as never).join('')).toMatch(/from/)
    expect(linkProblems({ id: 'x', name: 'x', from: 'net', to: 'meat', type: 'zap' } as never).join('')).toMatch(/type/)
    expect(linkProblems({ id: 'x', name: 'x', from: 'net', to: 'meat', type: 'ease', effect: { half: true } } as never).join('')).toMatch(/half/)
  })

  it('載入的時候擋下：格式不對的模板整批不收；gives 寫了不存在的連動、詞條的敵人不存在，ready 報出來', () => {
    expect(() => setup({ content: [pack({ commission_type: [{ ...TYPE_HIT, stages: [] }] })] })).toThrow(ContentError)
    expect(() => setup({ content: [pack({ commission_type: [{ ...TYPE_HIT, gives: { meat: ['lk_missing'] } }] })] })).toThrow(/lk_missing/)
    expect(() => setup({ content: [pack({ commission_modifier: [{ id: 'md_x', name: 'x', text: 'x', effect: { attached: [{ enemy: 'en_ghost' }] } }] })] })).toThrow(/en_ghost/)
  })

  it('規則的那幾個欄位：格式不對會被指出來、載入時被 ready 擋下；寫對的蓋掉預設', () => {
    expect(genRuleProblems({ reward_range: { 9: [1, 2] } }).join('')).toMatch(/reward_range\.9/)
    expect(genRuleProblems({ reward_range: { 1: [5, 1] } }).join('')).toMatch(/reward_range\.1/)
    expect(genRuleProblems({ scales_by_tier: [['huge']] }).join('')).toMatch(/scales_by_tier\.0/)
    expect(genRuleProblems({ encounters: { 1: { normal: ['dragon'] } } }).join('')).toMatch(/encounters\.1\.normal/)
    expect(() => setup({ content: [pack({ commission_rule: [{ id: 'default', reward_range: { 1: [5, 1] } }] })] })).toThrow(/reward_range/)
    const g = setup({ content: [pack({ commission_rule: [{ id: 'default', reward_range: { 1: [1000, 1000], 2: [2000, 2000] }, scales_by_tier: { 0: ['small'] }, encounters: { 1: { normal: ['elite'], last: ['boss'] } } }] })] })
    const r = genRules(g.k)
    expect(r.reward_range[1]).toEqual([1000, 1000])
    expect(r.reward_range[3]).toEqual([2400, 7200]) // 沒寫的那一級用預設（COMMISSION_TEMPLATES 的表：III 級小 2,400、大 7,200）
    for (const o of many(g, 30)) {
      expect(o.reward).toBe(gradeOf(o) === 1 ? 1000 : 2000)
      if (gradeOf(o) === 1) {
        expect((stagesOf(o)[0]!.faces.meat!.encounter as string[])).toEqual(['elite'])
        expect((stagesOf(o).at(-1)!.faces.meat!.encounter as string[])).toEqual(['boss'])
      }
    }
  })
})

// ===================================================================================================================
// generate
// ===================================================================================================================

describe('generate：同一個 seed 一模一樣', () => {
  it('兩次的結果整筆相等（偏偏放在不同的狀態副本上也一樣）；不同 seed 不一樣；不改狀態', () => {
    const g = setup({ rep: 55 })
    const before = stateHash(g.state)
    const a = gen(g, 'x1')
    expect(gen(g, 'x1')).toEqual(a)
    expect(stateHash(g.state)).toBe(before)
    const strip = (o: Offer): unknown => JSON.stringify({ ...o, id: '', commission: { ...o.commission, id: '' } })
    expect(strip(gen(g, 'x2'))).not.toBe(strip(a))
    // 同一個存檔、重新建出來的遊戲也一樣
    const g2 = setup({ rep: 55 })
    expect(gen(g2, 'x1')).toEqual(a)
    // 亂數是 deriveRng(state.rng, 'commission_gen/<seed>')：存檔的亂數游標動了，生成就換一件
    g2.state.rng.cursor += 3
    expect(JSON.stringify(gen(g2, 'x1'))).not.toBe(JSON.stringify(a))
  })

  it('id 從 seed 來：同一個 seed 同一個 id、不同 seed 不同；偏偏不撞', () => {
    const g = setup()
    const ids = many(g, 100).flatMap((o) => [o.id, o.commission.id])
    expect(new Set(ids).size).toBe(200)
    expect(gen(g, 'fx_a/12/0').commission.id).toBe(commissionIdOf('fx_a/12/0'))
  })
})

describe('generate：一百件', () => {
  for (const rep of [0, 15, 35, 55, 90]) {
    it(`信譽 ${rep}：每一件通過 commission 的格式檢查；最後一個階段只有主面；每個面都有強攻；至少一個階段有兩個面；等級在 rep_grade ±1`, () => {
      const g = setup({ rep })
      const base = repGrade(g.k, g.state)
      const offers = many(g)
      expect(g.k.content.hasKind('commission')).toBe(true)
      for (const o of offers) {
        expect(offerProblems(o)).toEqual([])
        expect(g.k.content.validate('commission', [o.commission])).toEqual([])
        const st = stagesOf(o)
        expect(faceList(o, st.length - 1)).toEqual([mainOf(o)])
        for (const s of st) for (const f of Object.values(s.faces)) expect((f.branches as Rec[]).some((b) => b.kind === 'assault')).toBe(true)
        expect(st.some((s) => Object.keys(s.faces).length >= 2)).toBe(true)
        expect(Math.abs(gradeOf(o) - base)).toBeLessThanOrEqual(1)
        expect(gradeOf(o)).toBeGreaterThanOrEqual(1)
        expect(gradeOf(o)).toBeLessThanOrEqual(5)
      }
      // 三種等級（base − 1、base、base + 1）都抽得到（不超出 1～5）
      const seen = new Set(offers.map(gradeOf))
      for (const d of [-1, 0, 1]) if (base + d >= 1 && base + d <= 5) expect(seen.has(base + d)).toBe(true)
    })
  }

  it('每一個階段都有一個有人登記玩法的面；現實面的圖、入口、保全崗、目標都在圖上；報酬在那一級的範圍裡；簡報的空格都填了', () => {
    const g = setup({ rep: 55 })
    const rules = genRules(g.k)
    const reg = registeredFaces(g.k)
    expect(reg).toEqual(['meat'])
    for (const o of many(g)) {
      const c = o.commission
      for (const [i, s] of stagesOf(o).entries()) {
        expect(Object.keys(s.faces).some((f) => reg.includes(f as never))).toBe(true)
        const m = s.faces.meat
        if (!m) continue
        const map = g.k.content.get('special_map', m.map as string) as unknown as { fits: string[]; sheets: Array<{ id: string; cells: Array<{ id: string; mark: string }> }> }
        expect(map.fits).toContain(c.kind)
        const sheet = map.sheets.find((x) => x.id === m.sheet)!
        expect(sheet).toBeTruthy()
        const ids = new Set(sheet.cells.map((x) => x.id))
        for (const b of m.branches as Array<{ entry: string }>) expect(sheet.cells.find((x) => x.id === b.entry)?.mark).toBe('E')
        expect(sheet.cells.find((x) => x.id === m.post)?.mark).toBe('G')
        const goal = m.goal as { kind: string; at?: string } | undefined
        if (i === stagesOf(o).length - 1) {
          expect(goal?.kind).toBe('take')
          expect(sheet.cells.find((x) => x.id === goal!.at)?.mark).toBe('T')
        } else expect(goal).toBeUndefined()
        expect(ids.size).toBeGreaterThan(0)
      }
      const [lo, hi] = rules.reward_range[gradeOf(o)]!
      expect(o.reward).toBeGreaterThanOrEqual(lo)
      expect(o.reward).toBeLessThanOrEqual(hi)
      expect(o.brief).not.toMatch(/[{}]/)
      expect(o.brief).toContain(`${c.target_faction}社`)
      expect(o.brief).toContain(c.district === 'glass_shore' ? '玻璃岸' : '舊港')
      expect(c.client).toBe('fx_a')
      expect(c.district).toBe('glass_shore')
    }
  })

  it('目標勢力從中間人那一區的勢力裡抽；地圖從 fits 含這個類型的模板裡照區的權重抽（區沒有權重的地圖不抽）', () => {
    const g = setup({ rep: 35 })
    const a = many(g, 120, 'fx_a')
    expect(new Set(a.map((o) => o.commission.target_faction))).toEqual(new Set(['f_a', 'f_b']))
    const maps = (offers: Offer[]) => offers.flatMap((o) => stagesOf(o).map((s) => s.faces.meat?.map)).filter(Boolean)
    // 玻璃岸：B 的權重 3、A 的權重 1，而且 t_net 只能放在 A
    const hitMaps = a.filter((o) => o.commission.kind === 't_hit').map((o) => stagesOf(o)[0]!.faces.meat!.map)
    expect(hitMaps.filter((m) => m === 'map_b').length).toBeGreaterThan(hitMaps.filter((m) => m === 'map_a').length)
    expect(maps(a.filter((o) => o.commission.kind === 't_net'))).not.toContain('map_b')
    // 舊港只有 f_a；B 沒有舊港的權重（寫了權重而沒有這一區的不抽）
    const b = many(g, 60, 'fx_b')
    expect(new Set(b.map((o) => o.commission.target_faction))).toEqual(new Set(['f_a']))
    expect(new Set(maps(b))).toEqual(new Set(['map_a']))
  })
})

describe('generate：階段與面', () => {
  it('中型四個階段、大型五個；小型三個；階段照模板排（中型的 2a 在第二階段前面，大型 2a 在前、2b 在後）', () => {
    const g = setup({ rep: 55 })
    const offers = many(g, 150)
    const bySize = (s: string) => offers.filter((o) => sizeOf(o) === s)
    expect(bySize('small').length).toBeGreaterThan(0)
    expect(bySize('medium').length).toBeGreaterThan(0)
    expect(bySize('large').length).toBeGreaterThan(0)
    for (const o of bySize('small')) expect(stagesOf(o)).toHaveLength(3)
    for (const o of bySize('medium')) expect(stagesOf(o)).toHaveLength(4)
    for (const o of bySize('large')) expect(stagesOf(o)).toHaveLength(5)
    const hit = (s: string) => bySize(s).find((o) => o.commission.kind === 't_hit')!
    expect(stagesOf(hit('medium')).map((x) => x.name).slice(1)).toEqual(['他的護衛', '靠近他', '動手'])
    expect(stagesOf(hit('large')).map((x) => x.name).slice(1)).toEqual(['他的護衛', '靠近他', '最後一道門', '動手'])
    expect(stagePlan(TYPE_HIT as never, 'small')!.map((s) => s.name)).toEqual(['找到他', '靠近他', '動手'])
  })

  it('規模照信譽階：無名只有小型；有號（II）有小與中；搶手以上有大型', () => {
    const seen = (rep: number) => new Set(many(setup({ rep }), 80).map(sizeOf))
    expect(seen(0)).toEqual(new Set(['small']))
    expect(seen(35)).toEqual(new Set(['small', 'medium']))
    expect(seen(55).has('large')).toBe(true)
    expect(seen(90)).toEqual(new Set(['medium', 'large']))
  })

  it('分支：一定有強攻；模板寫了潛行、交涉的各加一條（need.basic 的級數是等級＋1，最多 5）；入口分到那張圖的 E', () => {
    const g = setup({ rep: 90 })
    for (const o of many(g, 80)) {
      const lvl = Math.min(5, gradeOf(o) + 1)
      for (const s of stagesOf(o)) {
        for (const f of Object.values(s.faces)) {
          const bs = f.branches as Array<{ id: string; kind: string; need?: Rec; entry?: string }>
          expect(bs[0]).toMatchObject({ id: 'assault', kind: 'assault' })
          expect(new Set(bs.map((b) => b.id)).size).toBe(bs.length)
          expect(bs.find((b) => b.kind === 'stealth')?.need).toEqual({ basic: 'stealth', level: lvl })
          if (o.commission.kind === 't_hit') expect(bs.find((b) => b.kind === 'talk')?.need).toEqual({ basic: 'negotiate', level: lvl })
          else expect(bs.some((b) => b.kind === 'talk')).toBe(false)
        }
      }
    }
  })

  it('決定性的一步四種寫法（fight、reach、take、check、scene）都生成得出來並通過檢查', () => {
    const decisives: Array<[string, Rec]> = [
      ['fight', { kind: 'fight' }], ['reach', { kind: 'reach', at: 'X' }], ['take', { kind: 'take', at: 'T' }],
      ['check', { kind: 'check', at: 'T', basic: 'mechanics' }], ['scene', { kind: 'scene', with: 'npc_target', goal: 'please', nature: 'honeypot' }],
    ]
    for (const [kind, decisive] of decisives) {
      const g = setup({ content: [pack({ commission_type: [{ ...TYPE_HIT, decisive }] })] })
      for (const o of many(g, 20)) {
        const goal = (stagesOf(o).at(-1)!.faces.meat!.goal) as Rec
        expect(goal.kind).toBe(kind)
        if (kind === 'reach') expect(goal.at).toBe('X1')
        if (kind === 'take' || kind === 'check') expect(String(goal.at)).toMatch(/^T\d$/)
        if (kind === 'check') expect(goal.basic).toBe('mechanics')
        if (kind === 'scene') expect(goal).toMatchObject({ with: 'npc_target', goal: 'please', nature: 'honeypot' })
        expect(g.k.content.validate('commission', [o.commission])).toEqual([])
      }
    }
  })

  it('沒有裝 commission 的時候跳過格式檢查（照樣生成）', () => {
    const g = setup({ noCommission: true, features: [] })
    expect(g.k.content.hasKind('commission')).toBe(false)
    const o = gen(g, 'no_cm')
    expect(offerProblems(o)).toEqual([])
  })
})

describe('registeredFaces：只有現實面登記時，主面是內海的類型不會出現；登記了內海就會', () => {
  it('抽不到 t_net；把內海登記成替身之後抽得到，而且生成的副本通過檢查', () => {
    const g = setup({ rep: 35 })
    expect(registeredFaces(g.k)).toEqual(['meat'])
    expect(eligibleTypes(g.k, fixerOf(g)).map((t) => t.id)).toEqual(['t_hit'])
    const before = many(g, 100)
    expect(before.every((o) => mainOf(o) === 'meat' && o.commission.kind === 't_hit')).toBe(true)

    const g2 = setup({ rep: 35, features: [FACE_NET] })
    expect(registeredFaces(g2.k)).toEqual(['meat', 'net'])
    expect(eligibleTypes(g2.k, fixerOf(g2)).map((t) => t.id).sort()).toEqual(['t_hit', 't_net'])
    const after = many(g2, 100)
    const nets = after.filter((o) => mainOf(o) === 'net')
    expect(nets.length).toBeGreaterThan(10)
    for (const o of nets) {
      expect(o.commission.kind).toBe('t_net')
      expect(g2.k.content.validate('commission', [o.commission])).toEqual([])
      expect(faceList(o, stagesOf(o).length - 1)).toEqual(['net'])
      expect(stagesOf(o).at(-1)!.faces.net!.goal).toEqual({ kind: 'fight' })
    }
  })
})

describe('generate：連動', () => {
  it('每件 2～4 個；need.link 的分支要的那個連動，前面一定有某個階段的某個面給它；連動的效果對到接上的那個階段', () => {
    const g = setup({ rep: 55, features: [FACE_NET] })
    let linked = 0
    for (const o of many(g, 150)) {
      const links = o.commission.links as Record<string, { type: string; effect?: { stage?: number } }>
      const ids = Object.keys(links)
      expect(ids.length).toBeGreaterThanOrEqual(2)
      expect(ids.length).toBeLessThanOrEqual(4)
      const st = stagesOf(o)
      // 每個連動剛好被一個面給
      for (const id of ids) {
        const givers = st.flatMap((s, i) => Object.entries(s.faces).filter(([, f]) => f.gives === id).map(([face]) => ({ stage: i + 1, face })))
        expect(givers, id).toHaveLength(1)
        const to = links[id]!.effect?.stage
        if (to !== undefined) {
          expect(to).toBeGreaterThan(givers[0]!.stage)
          expect(to).toBeLessThanOrEqual(st.length)
        }
      }
      for (const [j, s] of st.entries()) {
        for (const f of Object.values(s.faces)) {
          for (const b of f.branches as Array<{ kind: string; need?: { link?: string } }>) {
            if (b.kind !== 'linked') continue
            linked += 1
            const id = b.need!.link!
            expect(links[id]).toBeTruthy()
            expect(st.slice(0, j).some((p) => Object.values(p.faces).some((q) => q.gives === id))).toBe(true)
          }
        }
      }
      // 「開路」的連動至少開出一條要連動的分支
      if (ids.some((id) => links[id]!.type === 'open')) expect(st.some((s) => Object.values(s.faces).some((f) => (f.branches as Array<{ kind: string }>).some((b) => b.kind === 'linked')))).toBe(true)
    }
    expect(linked).toBeGreaterThan(50)
  })

  it('接得上的連動不夠（沒有連動可挑）：生成不出來，不丟錯', () => {
    const g = setup({ content: [pack({ commission_type: [{ ...TYPE_HIT, gives: {} }], commission_link: [{ ...LINKS[1]!, from: 'opinion', to: 'opinion' }] })] })
    const t = generateTrace(g.k, g.state, { fixer: fixerOf(g), seed: 'nolink' })
    expect(t.offer).toBeNull()
    expect(t.tries).toHaveLength(GEN_RETRIES + 1)
    expect(t.tries[0]).toMatch(/連動/)
  })
})

describe('generate：詞條', () => {
  it('每件 1～2 個，寫在副本的 modifiers 上', () => {
    const g = setup({ rep: 35 })
    const counts = new Set(many(g, 80).map((o) => ((o.commission.modifiers as string[] | undefined) ?? []).length))
    expect(counts).toEqual(new Set([1, 2]))
  })

  it('帶獵犬詞條的那一件：每一個現實面的遭遇上有 attached（兩隻獵犬）；沒有這個詞條的沒有', () => {
    const g = setup({ rep: 35 })
    const offers = many(g, 100)
    const hounds = offers.filter((o) => (o.commission.modifiers as string[]).includes('md_hounds'))
    const plain = offers.filter((o) => !(o.commission.modifiers as string[]).includes('md_hounds'))
    expect(hounds.length).toBeGreaterThan(10)
    expect(plain.length).toBeGreaterThan(10)
    for (const o of hounds) {
      for (const s of stagesOf(o)) expect(s.faces.meat!.attached).toEqual([{ enemy: 'en_hound', count: 2 }])
    }
    for (const o of plain) for (const s of stagesOf(o)) expect(s.faces.meat!.attached).toBeUndefined()
  })

  it('lock_face 把那個階段鎖成一個面；鎖了之後至少還有一個階段可以選兩個面；詞條的 stage 只加在那一個階段', () => {
    const g = setup({ rep: 35 })
    const locked = many(g, 100).filter((o) => (o.commission.modifiers as string[]).includes('md_maint'))
    expect(locked.length).toBeGreaterThan(10)
    for (const o of locked) {
      expect(faceList(o, 0)).toEqual(['meat'])
      expect(stagesOf(o).some((s) => Object.keys(s.faces).length >= 2)).toBe(true)
    }
    // 鎖到內海：內海沒有人登記時鎖不了（那個階段會沒有玩得了的面），所以詞條用不上
    const g2 = setup({ rep: 35, content: [pack({ commission_modifier: [{ id: 'md_net_only', name: '只准走網', text: '只准走內海。', effect: { lock_face: { stage: 1, face: 'net' } } }] })] })
    expect(generateTrace(g2.k, g2.state, { fixer: fixerOf(g2), seed: 'q' }).offer).toBeNull()
    // 能多幾個敵人、警戒起始值、只加在某一個階段
    const extra = { id: 'md_more', name: '加派人手', text: '第二階段多兩個人，警戒也比較高。', effect: { foes_plus: 2, alert_start: 10, stage: 2 } }
    const g3 = setup({ rep: 35, content: [pack({ commission_modifier: [extra] })] })
    for (const o of many(g3, 20)) {
      expect(o.commission.modifiers).toEqual(['md_more'])
      expect(o.commission.alert_start).toBe(10)
      const st = stagesOf(o)
      const normal = genRules(g3.k).encounters[gradeOf(o)]!.normal.length
      expect((st[1]!.faces.meat!.encounter as string[]).length).toBe(normal + 2)
      expect((st[0]!.faces.meat!.encounter as string[]).length).toBe(normal)
      expect(g3.k.content.validate('commission', [o.commission])).toEqual([])
    }
  })

  it('詞條的 alert_start：go 把它併進警戒的起始值（出發的 setup）', () => {
    const extra = { id: 'md_more', name: '加派人手', text: '警戒比較高。', effect: { alert_start: 10 } }
    const g = setup({ rep: 0, content: [pack({ commission_modifier: [extra] })] })
    const row = board(g.k, g.state, 'fx_c').offers[0]!
    g.commit(accept(g.k, g.state, { id: row.id, fixer: 'fx_c' }, { pay: 'cash' }))
    g.state.location.block = 'blk_shop'
    const setupOf = go(g.k, g.state, row.id).launch![0]!.setup as { alert_start: number }
    expect(setupOf.alert_start).toBe(10)
  })
})

describe('generate：未知清單', () => {
  it('4～8 項；每一項的 reveal 都指得到副本裡的東西；「路」類的那一項對到的分支是 scouted 的那一條', () => {
    const g = setup({ rep: 55 })
    const cats = new Set<string>()
    for (const o of many(g, 100)) {
      expect(o.unknowns.length).toBeGreaterThanOrEqual(4)
      expect(o.unknowns.length).toBeLessThanOrEqual(8)
      const st = stagesOf(o)
      const meatBranches = st.flatMap((s) => (s.faces.meat?.branches ?? []) as Array<{ id: string; kind: string; need?: { scouted?: string } }>)
      let paths = 0
      for (const u of o.unknowns) {
        cats.add(u.cat)
        const r = u.reveal as Rec
        if (u.cat === 'stage') {
          const n = r.stage as number
          expect(n).toBeGreaterThanOrEqual(1)
          expect(n).toBeLessThan(st.length)
          expect(u.text).toContain(`第 ${n} 階段`)
          for (const f of faceList(o, n - 1)) expect(u.text).toContain({ meat: '現實', net: '內海', opinion: '輿論' }[f]!)
        } else if (u.cat === 'path') {
          paths += 1
          const b = meatBranches.find((x) => x.kind === 'scouted' && x.need?.scouted === r.branch)
          expect(b, String(r.branch)).toBeTruthy()
        } else if (u.cat === 'guard') {
          const n = r.guards as number
          expect(st[n - 1]!.faces.meat).toBeTruthy()
          expect(u.text).toContain(`${(st[n - 1]!.faces.meat!.encounter as string[]).length} 個人`)
        } else if (u.cat === 'modifier') {
          expect(o.commission.modifiers).toContain(r.modifier)
        } else {
          expect(['target', 'employer']).toContain(u.cat)
          expect(typeof r.flag).toBe('string')
        }
      }
      expect(paths).toBeGreaterThanOrEqual(1)
      // 每一條踩點開出來的路（scouted 分支）都有一項未知對得到
      for (const b of meatBranches.filter((x) => x.kind === 'scouted')) expect(o.unknowns.some((u) => (u.reveal as Rec).branch === b.need!.scouted)).toBe(true)
      // 整份揭開之後，scoutedOf 給得出副本要的東西
      const all = scoutedOf({ unknowns: o.unknowns, revealed: o.unknowns.map((u) => u.id), alert_start: 0, trace_start: 0 }).scouted
      expect(all.branches.length).toBe(paths)
    }
    for (const c of ['stage', 'path', 'guard', 'modifier', 'target', 'employer']) expect(cats.has(c)).toBe(true)
  })
})

// ===================================================================================================================
// fixer.offers
// ===================================================================================================================

describe('fixer.offers：每個中間人每天三件', () => {
  it('每天三件，seed 是「中間人／日子／第幾件」；同一天問幾次、中間擲了幾次骰都一樣；隔天不一樣', () => {
    const g = setup({ rep: 35 })
    const day = g.state.time.day
    const a = board(g.k, g.state, 'fx_a')
    expect(a.open).toBe(true)
    expect(a.problems).toEqual([])
    expect(a.offers).toHaveLength(OFFERS_PER_DAY)
    expect(a.offers.map((r) => r.id)).toEqual([0, 1, 2].map((i) => `of_${`fx_a__${day}__${i}`}`))
    expect(a.offers.map((r) => r.offer.commission.id)).toEqual([0, 1, 2].map((i) => commissionIdOf(offerSeed('fx_a', day, i))))
    expect(a.offers.every((r) => r.offer.fixer === 'fx_a' && r.fixer === 'fx_a')).toBe(true)
    expect(board(g.k, g.state, 'fx_a')).toEqual(a)
    // 中間擲了骰（亂數游標動了）也不變
    g.state.rng.cursor += 17
    expect(board(g.k, g.state, 'fx_a')).toEqual(a)
    // 和直接生成的一樣（同一個 seed）
    for (const [i, r] of a.offers.entries()) {
      const pinned = { ...g.state, rng: { seed: g.state.rng.seed, cursor: 0 } } as GameState
      expect({ ...generate(g.k, pinned, { fixer: fixerOf(g), seed: offerSeed('fx_a', day, i) }), fixer: 'fx_a' }).toEqual(r.offer)
    }
    // 隔天
    g.state.time.day += 1
    const b = board(g.k, g.state, 'fx_a')
    expect(b.offers).toHaveLength(OFFERS_PER_DAY)
    const strip = (v: typeof a) => JSON.stringify(v.offers.map((r) => ({ ...r.offer, id: '', commission: { ...r.offer.commission, id: '' } })))
    expect(strip(b)).not.toBe(strip(a))
    expect(b.offers.map((r) => r.id)).not.toEqual(a.offers.map((r) => r.id))
    // 不同的中間人各給各的
    const other = board(g.k, g.state, 'fx_b').offers
    expect(other).toHaveLength(OFFERS_PER_DAY)
    expect(other.every((r) => r.offer.commission.district === 'old_port')).toBe(true)
  })

  it('接走的這一件不再列；信譽升一階之後出現高一級的委託（等級在 rep_grade ±1）', () => {
    const g = setup({ rep: 15 })
    const gradesOver = (days: number): number[] => {
      const out: number[] = []
      for (let d = 0; d < days; d++) {
        g.state.time.day += 1
        for (const r of board(g.k, g.state, 'fx_a').offers) out.push(gradeOf(r.offer as Offer))
      }
      return out
    }
    expect(repGrade(g.k, g.state)).toBe(1)
    const low = gradesOver(30)
    expect(Math.max(...low)).toBe(2)
    expect(Math.min(...low)).toBe(1)
    setRep(g, 35)
    expect(repGrade(g.k, g.state)).toBe(2)
    const high = gradesOver(30)
    expect(Math.max(...high)).toBe(3)
    expect(Math.min(...high)).toBe(1)
    setRep(g, 55)
    expect(Math.max(...gradesOver(30))).toBe(4)
    // 接走之後桌上少一件（同一天）
    const first = board(g.k, g.state, 'fx_a').offers[0]!
    g.commit(accept(g.k, g.state, { id: first.id, fixer: 'fx_a' }, { pay: 'cash' }))
    expect(board(g.k, g.state, 'fx_a').offers.map((r) => r.id)).not.toContain(first.id)
    expect(jobOf(g.state, first.id)).toMatchObject({ id: first.id, status: 'active' })
  })

  it('有人註冊 enemy_pick 時，挑不到敵人的組合重抽；最多重抽三次，還是不行就少給一件；沒有人註冊就不檢查', () => {
    const g = setup()
    // 整區都挑不到：一件也沒有
    expect(offersFor(g.k, g.state, fixerOf(g, 'fx_bad'), 5)).toEqual([])
    expect(board(g.k, g.state, 'fx_bad')).toMatchObject({ open: true, offers: [] })
    const t = generateTrace(g.k, g.state, { fixer: fixerOf(g, 'fx_bad'), seed: 'z' })
    expect(t.offer).toBeNull()
    expect(t.tries).toHaveLength(GEN_RETRIES + 1)
    expect(t.tries.every((x) => /挑不到敵人.*f_none/.test(x ?? ''))).toBe(true)
    // 一半的勢力挑不到：目標勢力永遠是挑得到的那一個；有些要重抽
    let retried = 0
    for (let i = 0; i < 60; i++) {
      const tr = generateTrace(g.k, g.state, { fixer: fixerOf(g, 'fx_half'), seed: `h${i}` })
      if (tr.offer) expect(tr.offer.commission.target_faction).toBe('f_a')
      if (tr.tries.length > 1) retried += 1
    }
    expect(retried).toBeGreaterThan(5)
    const fewer = Array.from({ length: 40 }, (_, d) => offersFor(g.k, g.state, fixerOf(g, 'fx_half'), d).length)
    expect(Math.max(...fewer)).toBeLessThanOrEqual(OFFERS_PER_DAY)
    expect(fewer.some((n) => n >= 1)).toBe(true)
    // 沒裝敵人的功能（沒有 enemy_pick）：不檢查，三件都給
    const noEnemyPack = pack()
    delete (noEnemyPack.content as Rec).enemy
    const g2 = setup({ noEnemies: true, content: [noEnemyPack] })
    expect(g2.k.battle.getUnitSource('enemy_pick')).toBeUndefined()
    expect(offersFor(g2.k, g2.state, fixerOf(g2, 'fx_bad'), 5)).toHaveLength(OFFERS_PER_DAY)
  })

  it('沒有人門路裡的類型（或模板用不上）：回答空的，中間人桌上沒有生成的委託', () => {
    const g = setup({ content: [pack({ commission_type: [] })] })
    expect(board(g.k, g.state, 'fx_a').offers).toEqual([])
  })
})

// ===================================================================================================================
// 補充（M2-fixer）：commission.block
// ===================================================================================================================

describe('生成的委託寫 commission.block（中間人那一塊街區）', () => {
  it('寫中間人的 block；中間人沒有 block 就不寫', () => {
    const g = setup()
    for (const o of many(g, 20, 'fx_a')) expect(o.commission.block).toBe('blk_shop')
    for (const o of many(g, 20, 'fx_b')) expect('block' in o.commission).toBe(false)
  })

  it('go 會檢查：不在那一塊街區出發被擋（有人註冊 in_block 的時候）；走到那裡就能出發', () => {
    const g = setup({ features: [IN_BLOCK] })
    const row = board(g.k, g.state, 'fx_a').offers[0]!
    g.commit(accept(g.k, g.state, { id: row.id, fixer: 'fx_a' }, { pay: 'cash' }))
    expect(() => go(g.k, g.state, row.id)).toThrow(/blk_shop/)
    g.state.location.block = 'blk_shop'
    const d = go(g.k, g.state, row.id)
    expect(d.launch![0]).toMatchObject({ kind: 'commission', origin: { by: 'fixer', ref: row.id } })
    expect((d.launch![0]!.setup as { def: { block: string } }).def.block).toBe('blk_shop')
    // 沒有人註冊 in_block：不檢查
    const g2 = setup()
    const r2 = board(g2.k, g2.state, 'fx_a').offers[0]!
    g2.commit(accept(g2.k, g2.state, { id: r2.id, fixer: 'fx_a' }, { pay: 'cash' }))
    expect(() => go(g2.k, g2.state, r2.id)).not.toThrow()
  })
})

// ===================================================================================================================
// 串起來：把生成的一件交給 commission 走完三個階段
// ===================================================================================================================

const roomSheet = room('room_c', '密談的小房間') as { cells: Array<{ id: string; at: [number, number] }> }
const at = (id: string): [number, number] => roomSheet.cells.find((c) => c.id === id)!.at

/** 戰鬥開著就打完（打贏）。 */
async function settle(g: G): Promise<void> {
  while (g.battle) {
    expect(playOut(g).outcome).toBe('win')
    await g.finishBattle()
  }
}

/** 走完一個階段：選現實面、強攻、走到守衛打贏；最後一個階段拿到目標再走到撤離點。 */
async function playStage(g: G, n: number): Promise<void> {
  g.commit(chooseFace(g.k, g.state, 'meat'))
  g.commit(chooseBranch(g.k, g.state, 'assault'))
  const run = readRun(g.state)!
  const face = run.def.stages[n - 1]!.faces.meat as unknown as { post: string; goal?: { kind: string; at: string } }
  if (!face.goal) {
    g.gridMove(at(face.post))
    await settle(g)
    return
  }
  g.gridMove(at(face.goal.at))
  await settle(g)
  if (readRun(g.state)?.step !== 'play') return
  g.gridMove(at(face.goal.at))
  g.commit(exploreFeature.useHere(g.k, g.state, 'take'))
  g.gridMove(at('X1'))
  await settle(g)
}

describe('串起來：生成的一件交給 M2-commission-run 走完三個階段', () => {
  it('從中間人那裡接案、出發、三個階段走完；副本做完之後手上那一件是做完的', async () => {
    const g = setup({ seed: 5, rep: 0, content: [pack({ special_map: [MAP_C] })] })
    // 無名：只有小型
    const offers = board(g.k, g.state, 'fx_c').offers
    expect(offers).toHaveLength(OFFERS_PER_DAY)
    const row = offers[0]!
    expect(sizeOf(row.offer as Offer)).toBe('small')
    g.commit(accept(g.k, g.state, { id: row.id, fixer: 'fx_c' }, { pay: 'cash' }))
    g.state.location.block = 'blk_shop'
    const t0 = toMinutes(g.state.time)
    const { violations } = await observed(g, async () => {
      g.commit(go(g.k, g.state, row.id))
      expect(readRun(g.state)).toMatchObject({ stage: 1, step: 'face' })
      expect(readRun(g.state)!.def.id).toBe(row.offer.commission.id)
      await playStage(g, 1)
      expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face' })
      await playStage(g, 2)
      expect(readRun(g.state)).toMatchObject({ stage: 3, step: 'face' })
      await playStage(g, 3)
    })
    expect(violations).toEqual([])
    expect(readRun(g.state)).toBeNull()
    expect(jobOf(g.state, row.id)?.status).toBe('done')
    expect(toMinutes(g.state.time)).toBe(t0 + 360)
  })
})

describe('串起來：詞條帶的附屬單位（獵犬）真的進戰鬥', () => {
  it('生成 → go → 開地圖 → 走到守衛開打：獵犬掛在第一個敵人身上，其餘的敵人沒有', async () => {
    const hounds = MODS.filter((m) => m.id === 'md_hounds')
    const g = setup({ seed: 5, rep: 0, content: [pack({ special_map: [MAP_C], commission_modifier: hounds })] })
    const row = board(g.k, g.state, 'fx_c').offers[0]!
    // 生成的那一面寫著 attached
    const stage1 = (row.offer.commission.stages as Array<{ faces: Record<string, Rec> }>)[0]!.faces.meat!
    expect(row.offer.commission.modifiers).toEqual(['md_hounds'])
    expect(stage1.attached).toEqual([{ enemy: 'en_hound', count: 2 }])
    expect((stage1.encounter as string[]).length).toBeGreaterThan(1)
    g.commit(accept(g.k, g.state, { id: row.id, fixer: 'fx_c' }, { pay: 'cash' }))
    g.state.location.block = 'blk_shop'
    g.commit(go(g.k, g.state, row.id))
    g.commit(chooseFace(g.k, g.state, 'meat'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    // 開地圖時：守衛的第一個敵人帶 attached，其他的沒有；增援沒有
    const guards = Object.values(g.state.maps.instances)[0] as { ext?: { guards?: Record<string, { foes: Array<Rec> }>; reinforce?: Array<Rec> } } | undefined
    const foes = Object.values(guards!.ext!.guards!)[0]!.foes
    expect(foes[0]!.attached).toEqual([{ enemy: 'en_hound', count: 2 }])
    for (const f of foes.slice(1)) expect(f.attached).toBeUndefined()
    for (const f of guards!.ext!.reinforce!) expect(f.attached).toBeUndefined()
    // 走到守衛：開打，獵犬在場
    const face = readRun(g.state)!.def.stages[0]!.faces.meat as unknown as { post: string }
    g.gridMove(at(face.post))
    expect(g.battle).not.toBeNull()
    const b = g.state.battle!
    expect(b.overlays.filter((o) => o.ext?.enemy === 'en_hound')).toHaveLength(2)
    const owners = new Set(b.overlays.map((o) => o.owner))
    expect(owners.size).toBe(1)
    expect(b.units[[...owners][0]!]?.side).toBe('foe')
    await settle(g)
  })
})

// ===================================================================================================================
// 補一條：整體的性質
// ===================================================================================================================

describe('性質', () => {
  it('一千個 seed：不丟錯；成功的都通過檢查；fixer.offers 是純的（問了不改狀態）', () => {
    const g = setup({ rep: 75, features: [FACE_NET] })
    const before = stateHash(g.state)
    let ok = 0
    for (let i = 0; i < 1000; i++) {
      const o = generate(g.k, g.state, { fixer: fixerOf(g), seed: `p${i}` })
      if (!o) continue
      ok += 1
      expect(g.k.content.validate('commission', [o.commission])).toEqual([])
      expect(offerProblems(o)).toEqual([])
    }
    expect(ok).toBe(1000)
    for (let d = 0; d < 20; d++) board(g.k, g.state, 'fx_a')
    expect(stateHash(g.state)).toBe(before)
  })

  it('TypeEntry 的型別可以直接用（給之後的內容編輯器）', () => {
    const t = TYPE_HIT as unknown as TypeEntry
    expect(stagePlan(t, 'large')!.map((s) => s.name)).toEqual(['找到他', '他的護衛', '靠近他', '最後一道門', '動手'])
    expect(stagePlan(t, 'medium')!.map((s) => s.name)).toEqual(['找到他', '他的護衛', '靠近他', '動手'])
    expect(stagePlan({ ...t, extra: [] }, 'medium')).toBeNull()
    expect(stagePlan({ ...t, extra: t.extra.slice(0, 1) }, 'large')).toBeNull()
  })
})
