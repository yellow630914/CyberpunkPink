// 驗收測試：dev/work/M4-enemies-m4.md（cpp-feature）。敵人在 M4 的三件事：雙形象（一個敵人兩份名字與外觀，一場戰鬥擲一次）、
// 成人地城的五種效果記號裡要補的（縛 bind、疊 overload_extra，加上解開束縛的行動 unbind）、沉溺高的敵人（承受層數、被推過線）。
// 規格：CYBERSPACE 8.7 節（記號表、雙形象的表與下面兩條）；ENEMIES 第 5 節、第 6 節、12.1 節；CYBERWARE 第 6 節「NPC 也會溺感」；
// CORE_RULES 4.2 節承受層數表最後一列、4.3 節；DATA 第 1 節；dev/adr/0019 第十二節與 P61。
// 內容一律是測試自帶的最小假資料（兩種有 forms 的敵人：一種 B 指向女性、偽娘、TS、扶他；一種兩個形象都指向會被關掉的類），不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel } from '../../src'
import { BattleBlocked, BattleRun, aiStep, beginTurn, clone, createKernel, deriveRng, performAction, readyFeatures, setupBattle } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import type { EnemyEntry } from '../../src/features/enemies/kinds'
import {
  BIND_STATUS, DEFAULT_FORM_B_CHANCE, FOE_SUNK_POINT, SINK_LAYER_STEPS, SUNK, SUNK_EXT, UNBIND, captureOf, dataSink, enemiesFeature, enemyStats, formFor, formKeyFor, genderOf, hasForms,
  isBound, pendingSunk, pickForm, sinkLayers, unitFormView, usableForms,
} from '../../src/features/enemies'
import { TEST_NET_COMBAT, fixDice, makeActor, makeBattleGame, makeGame, makeState, netAvatar, observed } from '../../src/testkit'
import { one, raw } from '../helpers/battle'

type Rec = Record<string, unknown>
type Entry = Rec & { id: string }

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : 'reflex', desc: `${id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const gun = { id: 'duster', class: 'pistol', type: 'neural', ram: 1 }

/** 測試自帶的狀態：縛的兩種、挑的「下一次命中 −1」（正式的由 M4-data-rules 放：battle_statuses.json）。 */
const STATUSES: Entry[] = [
  { id: BIND_STATUS.ap, name: '被縛・行動點', desc: '被綁住：每回合回復的行動點 −1，到綁他的敵人退出或隊友替他解開。', mods: { ap_regen: -1 }, until: 'battle_end', kind: 'debuff' },
  { id: BIND_STATUS.no_move, name: '被縛・不能換位', desc: '被綁住：不能換位，到綁他的敵人退出或隊友替他解開。', no_move: true, until: 'battle_end', kind: 'debuff' },
  { id: 'tease_hit', name: '分心', desc: '分心：下一次命中 −1。', mods: { hit: -1 }, until: 'own_turn_end', turns: 1, kind: 'debuff' },
]

const sig = (id: string, name: string, meat: Rec, more: Rec = {}): Entry => ({ id, name, text: `${name}。`, enemy: true, kind: 'active', use: { ap: 1 }, meat, ai: { score: 3 }, ...more })
const ABILITIES: Entry[] = [
  // 灌：多一顆骰的感載（這裡用固定的數字）；單點
  sig('ab_single', '原名一', { target: 'enemy', do: [{ op: 'load', amount: 4, type: 'pleasure' }] }),
  // 範：who 是敵方全體
  sig('ab_aoe', '原名二', { target: 'enemy', do: [{ op: 'load', amount: 3, type: 'pleasure', who: 'foes' }] }),
  // 縛：行動點 −1 / 不能換位
  sig('ab_bind', '原名三', { target: 'enemy', do: [{ op: 'load', amount: 3, type: 'pleasure' }, { op: 'bind', mode: 'ap', by: 'user' }] }),
  sig('ab_bind_move', '原名四', { target: 'enemy', do: [{ op: 'bind', mode: 'no_move' }] }),
  // 挑：少量的感載加一個分心
  sig('ab_tease', '原名五', { target: 'enemy', do: [{ op: 'load', amount: 2, type: 'pleasure' }, { op: 'status', status: 'tease_hit' }] }),
  // 疊：灌到過載就多疊一層
  sig('ab_extra', '原名六', { target: 'enemy', do: [{ op: 'load', amount: 9999, type: 'neural', exact: true }, { op: 'overload_extra' }] }),
]

const foeData = (id: string, more: Rec = {}): Entry => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'f_a', rank: 'elite', grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'neural', weapons: [], ai: { focus: 1, flee_below: 0 }, ...more,
})
const FEMALE_SIDE = ['female', 'femboy', 'trans_f', 'futa']
const forms = (sigId: string, a: Rec = {}, b: Rec = {}) => ({
  a: { name: '形象甲', look: '甲的外觀。', moves: { [sigId]: { name: '甲的招式', text: '甲的描寫。' } }, ...a },
  b: { name: '形象乙', look: '乙的外觀。', moves: { [sigId]: { name: '乙的招式', text: '乙的描寫。' } }, points_at: FEMALE_SIDE, ...b },
})

const ENEMIES: Entry[] = [
  foeData('en_plain', { signature: ['ab_single'] }),
  // 一種 B 的 points_at 是女性、偽娘、TS、扶他；A 沒有指向誰（或指向男性）
  foeData('en_single', { signature: ['ab_single'], forms: forms('ab_single'), neutral: { name: '一團光', look: '一團沒有輪廓的光。', moves: { ab_single: { name: '灌注' } } } }),
  foeData('en_aoe', { signature: ['ab_aoe'], forms: forms('ab_aoe') }),
  // 一種兩個形象都指向會被關掉的類（A 指向男性、B 指向女性側）：沒寫 neutral，用資料的 name 與 desc
  foeData('en_both', { name: '無臉的人影', desc: '一個沒有五官的人影。', signature: ['ab_single'], forms: forms('ab_single', { points_at: ['male'] }) }),
  // 縛、疊
  foeData('en_bind', { signature: ['ab_bind'], forms: forms('ab_bind') }),
  foeData('en_bind_move', { signature: ['ab_bind_move'] }),
  foeData('en_tease', { signature: ['ab_tease'] }),
  foeData('en_extra', { signature: ['ab_extra'] }),
  // 沉溺
  foeData('en_sink0', { rank: 'minion' }),
  foeData('en_sink59', { rank: 'minion', mods: { sink: 59 } }),
  foeData('en_sink60', { rank: 'minion', mods: { sink: 60 } }),
  foeData('en_sink65', { rank: 'minion', mods: { sink: 65 } }),
  foeData('en_sink79', { rank: 'minion', mods: { sink: 79 } }),
  foeData('en_sink85', { rank: 'minion', mods: { sink: 85 }, loot: [{ item: 'it_part', chance: 1 }] }),
  foeData('en_sink95', { rank: 'minion', mods: { sink: 95 } }),
  foeData('en_sink100', { rank: 'minion', mods: { sink: 100 } }),
  foeData('en_sink120', { rank: 'elite', mods: { sink: 120 } }),
  // 內海：有 constructs
  foeData('en_net65', { kind: 'lace', color: 'pink', rank: 'minion', constructs: [gun], mods: { sink: 65 } }),
  foeData('en_net0', { kind: 'lace', color: 'pink', rank: 'minion', constructs: [gun] }),
]
const item = (id: string, name: string) => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 1, legal: 'free' })
const pack = (more: Rec = {}): ContentPack => ({
  id: 'm4_enemies',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }], item: [item('it_part', '零件')],
    battle_status: STATUSES, ability: ABILITIES, enemy: ENEMIES, ...more,
  },
} as unknown as ContentPack)
/** 規則表：這一場擲到 b 的機率。 */
const withChance = (c: number): ContentPack => pack({ net_enemy_rule: [{ id: 'default', form_b_chance: c }] })
const ALWAYS_B = withChance(1)
const ALWAYS_A = withChance(0)

const FEATURES: Feature[] = [combatFeature, abilitiesFeature, enemiesFeature]
const NET_FEATURES: Feature[] = [combatFeature, abilitiesFeature, enemiesFeature, deckFeature, TEST_NET_COMBAT]

// ===================================================================================================================
// 小工具
// ===================================================================================================================

const kernelOf = (p: ContentPack = pack(), features: Feature[] = FEATURES): Kernel => {
  const k = createKernel(features)
  k.content.loadPack(p)
  readyFeatures(k)
  return k
}
const dice = (...v: number[]) => [...v, ...Array(150).fill(1)]
const open = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }

interface World {
  k: Kernel
  state: GameState
  run: BattleRun
  foe(i: number): BattleUnit
  pc: BattleUnit
  mate: BattleUnit
}
interface WorldOpts {
  pack?: ContentPack
  pc?: string
  mate?: string
  /** 內容篩選關掉的標籤 */
  off?: string[]
  /** 主角的化身的性別（deck.avatar.gender）；也可以放壞掉的值 */
  avatar?: unknown
  features?: Feature[]
}
/** 一場不經過提交的現實戰鬥：我方是主角（a1，站第 1 格）與一位隊友（a2）；敵方是給的敵人（來源 enemy，開戰時照規則擲雙形象）。 */
function world(foes: Array<string | Rec>, o: WorldOpts = {}): World {
  const k = kernelOf(o.pack ?? pack(), o.features ?? FEATURES)
  const pcActor = makeActor({ id: 'pc', name: '主角', gender: o.pc ?? 'female', ...(o.avatar !== undefined ? { ext: { deck: { avatar: { gender: o.avatar } } } } : {}) })
  const mateActor = makeActor({ id: 'mate', name: '隊友', role: 'companion', gender: o.mate ?? 'male' })
  const state = makeState({ pc: false, actors: [pcActor, mateActor] })
  state.pc = 'pc'
  state.party = ['pc', 'mate']
  state.rules.contentOff = [...(o.off ?? [])]
  const setup: BattleSetup = {
    mode: 'meat', grade: 1, cover: open,
    allies: [raw({ ...one({ weapon: 'pistol' }, 1), actor: 'pc', name: '主角' }), raw({ ...one({ weapon: 'pistol' }, 2), actor: 'mate', name: '隊友' })],
    foes: foes.map((f) => (typeof f === 'string' ? { from: 'enemy', id: f } : { from: 'enemy', ...f })) as never,
  }
  const run = setupBattle(k, state, setup)
  state.battle = clone(run.battle)
  const r = new BattleRun(k, state, state.battle)
  return { k, state, run: r, foe: (i) => state.battle!.units[`f${i}`]!, pc: state.battle!.units.a1!, mate: state.battle!.units.a2! }
}
const formOf = (u: BattleUnit): unknown => (u.ext.enemies as Rec | undefined)?.form
const textOf = (r: BattleRun): string => r.beats.map((b) => b.text).join('\n')
/** 敵人（f1）做一步：目標挑第一個（a1）或最後一個（a2）我方的人，行動只有一個招牌行動。 */
function foeStep(w: World, at: 'pc' | 'mate', f: BattleUnit = w.foe(1)): BattleRun {
  const r = fixDice(new BattleRun(w.k, w.state, w.state.battle!), dice(at === 'pc' ? 0 : 99, 0))
  f.uses['turn:ai_moved'] = 1
  expect(aiStep(r, f)).toBe(true)
  return r
}
/** 找一個種子，讓第 unitId 個單位在預設的 60% 下擲到 want。 */
function seedFor(want: 'a' | 'b', unitId = 'f1', battleId = 'b1'): number {
  for (let seed = 1; seed < 5000; seed++) if (pickForm(deriveRng({ seed, cursor: 0 }, `enemy_form/${battleId}/${unitId}`).next(), DEFAULT_FORM_B_CHANCE) === want) return seed
  throw new Error('找不到種子')
}

// ===================================================================================================================
// 一、雙形象：擲一次
// ===================================================================================================================

describe('雙形象：開戰時擲一次，整場固定（CYBERSPACE 8.7 節「擲一次」）', () => {
  it('沒有 forms 的敵人一切照舊：名字是資料的 name，ext.enemies 沒有 form，formFor 沒有東西', () => {
    const w = world(['en_plain'])
    expect(hasForms(w.k.content.require<EnemyEntry>('enemy', 'en_plain'))).toBe(false)
    expect(w.foe(1).name).toBe('測試en_plain')
    expect((w.foe(1).ext.enemies as Rec | undefined)?.form).toBeUndefined()
    expect(formFor(w.k, w.state, w.foe(1))).toBeUndefined()
    expect(unitFormView(w.k, w.state, w.foe(1))).toBeUndefined()
  })

  it('擲出來的數字 0.5 是 B、0.7 是 A（機率 0.6）；機率來自規則表 net_enemy_rule 的 form_b_chance，沒寫是 0.6', () => {
    expect(pickForm(0.5, DEFAULT_FORM_B_CHANCE)).toBe('b')
    expect(pickForm(0.7, DEFAULT_FORM_B_CHANCE)).toBe('a')
    expect(pickForm(0.6, 0.6)).toBe('a')
    expect(DEFAULT_FORM_B_CHANCE).toBe(0.6)
    expect(formOf(world(['en_single'], { pack: ALWAYS_B }).foe(1))).toBe('b')
    expect(formOf(world(['en_single'], { pack: ALWAYS_A }).foe(1))).toBe('a')
  })

  it('預設的 60%：幾百個種子擲出來大約六成是 B', () => {
    let b = 0
    const n = 600
    for (let seed = 1; seed <= n; seed++) {
      const k = kernelOf()
      const state = makeState({ seed })
      const run = setupBattle(k, state, { mode: 'meat', grade: 1, cover: open, allies: [raw(one({ weapon: 'pistol' }, 1))], foes: [{ from: 'enemy', id: 'en_single' }] as never })
      if (formOf(run.battle.units.f1!) === 'b') b += 1
    }
    expect(b / n).toBeGreaterThan(0.53)
    expect(b / n).toBeLessThan(0.67)
  })

  it('同一個狀態開兩次是同一個結果；同一場的單位存進狀態再讀回來還是同一個；不同的戰鬥 id 會重擲', () => {
    const [sa, sb] = [seedFor('a'), seedFor('b')]
    for (const [seed, want] of [[sa, 'a'], [sb, 'b']] as const) {
      const make = () => {
        const k = kernelOf()
        const state = makeState({ seed })
        const run = setupBattle(k, state, { mode: 'meat', grade: 1, cover: open, allies: [raw(one({ weapon: 'pistol' }, 1))], foes: [{ from: 'enemy', id: 'en_single' }] as never })
        return { run, k, state }
      }
      const one1 = make()
      expect(formOf(one1.run.battle.units.f1!)).toBe(want)
      expect(formOf(make().run.battle.units.f1!)).toBe(want)
      // 存檔讀回來：單位身上記著，不重擲
      const reread = clone(one1.run.battle)
      expect(formOf(reread.units.f1!)).toBe(want)
    }
    // 戰鬥的 id 不同（重來這場戰鬥會拿到新的 id）：兩個 id 擲到的不會永遠一樣
    const seen = new Set<string>()
    for (let i = 1; i <= 40; i++) seen.add(pickForm(deriveRng({ seed: 7, cursor: 0 }, `enemy_form/b${i}/f1`).next(), DEFAULT_FORM_B_CHANCE))
    expect(seen).toEqual(new Set(['a', 'b']))
  })

  it('「重來這場戰鬥」會重擲：新的戰鬥 id 重新擲，幾次之內兩種都出現', () => {
    const t = makeGame({ features: FEATURES, content: [pack()], seed: 5 })
    const setup: BattleSetup = { mode: 'meat', grade: 1, cover: open, allies: [raw(one({ weapon: 'pistol' }, 1))], foes: [{ from: 'enemy', id: 'en_single' }] as never }
    t.game.startBattle(setup)
    const forms = new Set<unknown>([formOf(t.game.battle!.units.f1!)])
    const ids = new Set<string>([t.game.battle!.id])
    for (let i = 0; i < 30 && forms.size < 2; i++) {
      expect(t.game.retryBattle()).toBeNull()
      forms.add(formOf(t.game.battle!.units.f1!))
      ids.add(t.game.battle!.id)
    }
    expect(forms).toEqual(new Set(['a', 'b']))
    expect(ids.size).toBeGreaterThan(1)
  })

  it('兩個形象的單位除了名字與 ext.enemies.form 以外逐欄相同', () => {
    const a = world(['en_single'], { pack: ALWAYS_A }).foe(1)
    const b = world(['en_single'], { pack: ALWAYS_B }).foe(1)
    expect(a.name).toBe('形象甲')
    expect(b.name).toBe('形象乙')
    const strip = (u: BattleUnit): Rec => {
      const c = clone(u) as unknown as Rec
      delete c.name
      const ext = c.ext as Rec
      const mine = { ...(ext.enemies as Rec) }
      delete mine.form
      ext.enemies = Object.keys(mine).length ? mine : undefined
      return c
    }
    expect(strip(a)).toEqual(strip(b))
  })

  it('招牌行動的效果與名字以外的資料兩個形象一樣：數值、狀態、標記換形象時都不變', () => {
    const a = world(['en_single'], { pack: ALWAYS_A }).foe(1)
    const b = world(['en_single'], { pack: ALWAYS_B }).foe(1)
    expect(a.ext.abilities).toEqual(b.ext.abilities)
    expect([a.hp, a.load, a.armor, a.evade, a.layersMax, a.ap, a.tags]).toEqual([b.hp, b.load, b.armor, b.evade, b.layersMax, b.ap, b.tags])
  })
})

// ===================================================================================================================
// 二、看誰
// ===================================================================================================================

describe('看誰：男性用 A，其餘用擲到的；範圍攻擊與沒鎖定固定看主角（CYBERSPACE 8.7 節「看誰」「畫面」）', () => {
  it('目標是 male 的隊友一律 A 的名字；目標是 female 的主角是擲到的那一個；沒給目標與敵方自己照主角', () => {
    const w = world(['en_single'], { pack: ALWAYS_B })
    const f = w.foe(1)
    expect(formFor(w.k, w.state, f, w.mate)!.name).toBe('形象甲')
    expect(formFor(w.k, w.state, f, w.pc)!.name).toBe('形象乙')
    expect(formFor(w.k, w.state, f)!.name).toBe('形象乙')
    // 目標不是這個敵人的對手（同一邊的人）：看主角
    expect(formFor(w.k, w.state, f, f)!.name).toBe('形象乙')
    // 單位的名字是對主角的那一個
    expect(f.name).toBe('形象乙')
    expect(formKeyFor(w.k, w.state, f, w.mate)).toBe('a')
    expect(formKeyFor(w.k, w.state, f, w.pc)).toBe('b')
  })

  it('五個性別：male 一律 A，其餘四個用擲到的；目標沒有性別的資料時看擲到的', () => {
    for (const g of ['female', 'femboy', 'trans_f', 'futa']) {
      const w = world(['en_single'], { pack: ALWAYS_B, mate: g })
      expect(formFor(w.k, w.state, w.foe(1), w.mate)!.name, g).toBe('形象乙')
    }
    const m = world(['en_single'], { pack: ALWAYS_B, mate: 'male' })
    expect(formFor(m.k, m.state, m.foe(1), m.mate)!.name).toBe('形象甲')
    // 男性主角：名牌是 A；對女性的隊友是擲到的 B
    const male = world(['en_single'], { pack: ALWAYS_B, pc: 'male', mate: 'female' })
    expect(male.foe(1).name).toBe('形象甲')
    expect(formFor(male.k, male.state, male.foe(1), male.pc)!.name).toBe('形象甲')
    expect(formFor(male.k, male.state, male.foe(1), male.mate)!.name).toBe('形象乙')
    // 擲到 A 的時候對誰都是 A
    const a = world(['en_single'], { pack: ALWAYS_A, mate: 'female' })
    expect(formFor(a.k, a.state, a.foe(1), a.mate)!.name).toBe('形象甲')
    expect(formFor(a.k, a.state, a.foe(1), a.pc)!.name).toBe('形象甲')
  })

  it('內海的戰場先讀化身的性別（只認格式），沒有或壞掉的才讀角色的；現實永遠讀角色的', () => {
    // 角色是 male、化身是 female
    const w = world(['en_single'], { pack: ALWAYS_B, pc: 'male', avatar: 'female' })
    const f = w.foe(1)
    expect(genderOf(w.state, 'pc', 'net')).toBe('female')
    expect(genderOf(w.state, 'pc', 'meat')).toBe('male')
    expect(formFor(w.k, w.state, f, w.pc, { layer: 'net' })!.name).toBe('形象乙')
    expect(formFor(w.k, w.state, f, w.pc, { layer: 'meat' })!.name).toBe('形象甲')
    // 化身壞掉（不是五個值）：照角色自己的
    const bad = world(['en_single'], { pack: ALWAYS_B, pc: 'male', avatar: 'robot' })
    expect(genderOf(bad.state, 'pc', 'net')).toBe('male')
    expect(formFor(bad.k, bad.state, bad.foe(1), bad.pc, { layer: 'net' })!.name).toBe('形象甲')
    // 反過來：角色是 female、化身是 male：內海對他是 A
    const rev = world(['en_single'], { pack: ALWAYS_B, pc: 'female', avatar: 'male' })
    expect(formFor(rev.k, rev.state, rev.foe(1), rev.pc, { layer: 'net' })!.name).toBe('形象甲')
    expect(formFor(rev.k, rev.state, rev.foe(1), rev.pc, { layer: 'meat' })!.name).toBe('形象乙')
  })

  it('內海的戰鬥裡 formFor 自己看戰場：現實或內海的 state.battle.mode', () => {
    const k = kernelOf(ALWAYS_B, NET_FEATURES)
    const pc = makeActor({ id: 'pc', name: '主角', gender: 'male', ext: { deck: { avatar: { gender: 'femboy' } } } })
    const state = makeState({ pc: false, actors: [pc] })
    state.pc = 'pc'
    const run = setupBattle(k, state, { mode: 'net', grade: 1, cover: open, allies: [raw({ ...netAvatar(0, 1), actor: 'pc', name: '主角' })], foes: [{ from: 'enemy', id: 'en_net0' }] as never })
    state.battle = clone(run.battle)
    // en_net0 沒有 forms：沒有東西；換一筆有 forms 的內海敵人另外驗
    expect(formFor(k, state, state.battle.units.f1!, state.battle.units.a1!)).toBeUndefined()
    const k2 = createKernel(NET_FEATURES)
    k2.content.loadPack(pack({
      net_enemy_rule: [{ id: 'default', form_b_chance: 1 }],
      enemy: [...ENEMIES, foeData('en_net_two', { kind: 'lace', color: 'pink', rank: 'minion', constructs: [gun], signature: [], forms: forms('x') })],
    }))
    // moves 的鍵要是招牌行動：這一筆故意不寫 moves 的對應
    expect(() => readyFeatures(k2)).toThrow(/moves 寫了 x/)
    const k3 = createKernel(NET_FEATURES)
    k3.content.loadPack(pack({
      net_enemy_rule: [{ id: 'default', form_b_chance: 1 }],
      enemy: [...ENEMIES, foeData('en_net_two', { kind: 'lace', color: 'pink', rank: 'minion', constructs: [gun], forms: { a: { name: '形象甲', look: '甲。' }, b: { name: '形象乙', look: '乙。', points_at: FEMALE_SIDE } } })],
    }))
    readyFeatures(k3)
    const s2 = makeState({ pc: false, actors: [pc] })
    s2.pc = 'pc'
    const r2 = setupBattle(k3, s2, { mode: 'net', grade: 1, cover: open, allies: [raw({ ...netAvatar(0, 1), actor: 'pc', name: '主角' })], foes: [{ from: 'enemy', id: 'en_net_two' }] as never })
    s2.battle = clone(r2.battle)
    // 角色是 male、化身是 femboy：內海的戰鬥對他是擲到的 B；單位的名字也是 B
    expect(s2.battle.units.f1!.name).toBe('形象乙')
    expect(formFor(k3, s2, s2.battle.units.f1!, s2.battle.units.a1!)!.name).toBe('形象乙')
    expect(formFor(k3, s2, s2.battle.units.f1!, s2.battle.units.a1!, { layer: 'meat' })!.name).toBe('形象甲')
  })

  it('unitFormView：給畫面的是現在顯示哪一個，加上兩種可能的樣子（對 male 與對其他）', () => {
    const w = world(['en_single'], { pack: ALWAYS_B })
    const f = w.foe(1)
    const v = unitFormView(w.k, w.state, f, w.mate)!
    expect(v.current).toMatchObject({ form: 'a', name: '形象甲', look: '甲的外觀。' })
    expect(v.for_male).toMatchObject({ form: 'a', name: '形象甲' })
    expect(v.for_other).toMatchObject({ form: 'b', name: '形象乙', look: '乙的外觀。' })
    expect(unitFormView(w.k, w.state, f)!.current.form).toBe('b')
    // 招牌行動的名字跟著形象
    expect(v.for_other.moves.ab_single!.name).toBe('乙的招式')
  })
})

// ===================================================================================================================
// 三、篩選
// ===================================================================================================================

describe('篩選：指向被關掉的類的形象不能用（CYBERSPACE 8.7 節「篩選關掉時」）', () => {
  it('female_partner 關掉而 B 指向它：擲到 B 也用 A（A 不指向被關掉的類）', () => {
    const w = world(['en_single'], { pack: ALWAYS_B, off: ['female_partner'] })
    expect(formOf(w.foe(1))).toBe('a')
    expect(w.foe(1).name).toBe('形象甲')
    expect(formFor(w.k, w.state, w.foe(1), w.pc)!.name).toBe('形象甲')
    // 篩選的標籤五個都認：femboy、trans、futa 任何一個關掉都排除 B；male_partner 關掉不影響 B
    for (const tag of ['femboy_partner', 'trans_partner', 'futa_partner']) expect(formOf(world(['en_single'], { pack: ALWAYS_B, off: [tag] }).foe(1)), tag).toBe('a')
    expect(formOf(world(['en_single'], { pack: ALWAYS_B, off: ['male_partner'] }).foe(1))).toBe('b')
    // 沒有被關掉的時候照擲
    expect(usableForms(world(['en_single']).state, world(['en_single']).k.content.require<EnemyEntry>('enemy', 'en_single'))).toEqual({ a: true, b: true })
  })

  it('擲到 A 而 A 指向被關掉的類：換 B', () => {
    const w = world(['en_both'], { pack: ALWAYS_A, off: ['male_partner'] })
    // en_both 的 A 指向男性（被關掉）、B 指向女性側（沒關）
    expect(formOf(w.foe(1))).toBe('b')
  })

  it('兩個都不能用是 neutral：有寫 neutral 用它的名字，沒寫用資料的 name 與 desc；機制不變', () => {
    const w = world(['en_both'], { pack: ALWAYS_B, off: ['male_partner', 'female_partner'] })
    expect(formOf(w.foe(1))).toBe('neutral')
    expect(w.foe(1).name).toBe('無臉的人影')
    expect(unitFormView(w.k, w.state, w.foe(1))!.current).toMatchObject({ form: 'neutral', name: '無臉的人影', look: '一個沒有五官的人影。' })
    // 寫了 neutral 的：en_single 的 A 沒指向誰、所以改成讓 A 也被排除：用 en_both 加 neutral 的版本
    const k = kernelOf(pack({ net_enemy_rule: [{ id: 'default', form_b_chance: 1 }], enemy: [...ENEMIES, foeData('en_both2', { signature: ['ab_single'], forms: forms('ab_single', { points_at: ['male'] }), neutral: { name: '一個面具', look: '一張沒有表情的面具。', moves: { ab_single: { name: '灌注' } } } })] }))
    const state = makeState({ pc: false, actors: [makeActor({ id: 'pc', gender: 'female' })] })
    state.pc = 'pc'
    state.rules.contentOff = ['male_partner', 'female_partner']
    const run = setupBattle(k, state, { mode: 'meat', grade: 1, cover: open, allies: [raw({ ...one({ weapon: 'pistol' }, 1), actor: 'pc' }), raw({ ...one({ weapon: 'pistol' }, 2), actor: 'pc' })], foes: [{ from: 'enemy', id: 'en_both2' }] as never })
    expect(run.battle.units.f1!.name).toBe('一個面具')
    expect(formOf(run.battle.units.f1!)).toBe('neutral')
    // 數值與招牌行動不變
    const plain = world(['en_both'], { pack: ALWAYS_B })
    expect(run.battle.units.f1!.hp).toEqual(plain.foe(1).hp)
    expect(run.battle.units.f1!.ext.abilities).toEqual(plain.foe(1).ext.abilities)
  })

  it('neutral: true 的形象不看 points_at；男性目標在 A 被排除時也用 neutral', () => {
    const k = kernelOf(pack({ net_enemy_rule: [{ id: 'default', form_b_chance: 0 }], enemy: [...ENEMIES, foeData('en_nb', { signature: ['ab_single'], forms: forms('ab_single', { points_at: ['male'], neutral: true }, { neutral: true, points_at: FEMALE_SIDE }) })] }))
    const state = makeState()
    state.rules.contentOff = ['male_partner', 'female_partner']
    expect(usableForms(state, k.content.require<EnemyEntry>('enemy', 'en_nb'))).toEqual({ a: true, b: true })
    // 男性目標、A 指向被關掉的男性：A 不能用，用 neutral
    const w = world(['en_both'], { pack: ALWAYS_A, off: ['male_partner'] })
    expect(formFor(w.k, w.state, w.foe(1), w.mate)!.form).toBe('neutral')
  })

  it('被關掉的類的字眼不出現在任何一拍的文字裡：把敵人的整個回合與兩個目標都掃一遍', () => {
    for (const [off, banned] of [[['female_partner'], ['形象乙', '乙的招式']], [['male_partner', 'female_partner'], ['形象甲', '形象乙', '甲的招式', '乙的招式']]] as const) {
      for (const at of ['pc', 'mate'] as const) {
        const w = world(['en_both'], { pack: ALWAYS_B, off: [...off] })
        const r = foeStep(w, at)
        const text = textOf(r)
        expect(text.length).toBeGreaterThan(0)
        for (const word of banned) expect(text, `${off.join('、')}：${word}`).not.toContain(word)
      }
    }
    // 只關 female_partner 時，en_single 全場只有 A 的字
    const w = world(['en_single'], { pack: ALWAYS_B, off: ['female_partner'] })
    const text = textOf(foeStep(w, 'pc'))
    expect(text).toContain('形象甲')
    expect(text).not.toContain('形象乙')
  })

  it('規則表的 form_b_chance 要是 0～1 的數字', () => {
    const k = createKernel(FEATURES)
    expect(() => k.content.loadPack({ id: 'bad', content: { net_enemy_rule: [{ id: 'default', form_b_chance: 1.5 }] } } as never)).toThrow(/form_b_chance/)
  })
})

// ===================================================================================================================
// 四、逐拍換字
// ===================================================================================================================

describe('紀錄逐拍換字：名字與招牌行動的名字用這一拍的目標對到的形象（範圍攻擊看主角）', () => {
  it('擲到 B、主角是 female：打主角那一拍是 B 的名字與招式名；打 male 隊友那一拍是 A 的', () => {
    const toPc = textOf(foeStep(world(['en_single'], { pack: ALWAYS_B }), 'pc'))
    expect(toPc).toContain('形象乙：乙的招式。')
    expect(toPc).not.toContain('形象甲')
    expect(toPc).not.toContain('原名一')
    const toMate = textOf(foeStep(world(['en_single'], { pack: ALWAYS_B }), 'mate'))
    expect(toMate).toContain('形象甲：甲的招式。')
    expect(toMate).not.toContain('形象乙')
    expect(toMate).not.toContain('乙的招式')
    // 感載照常加在被打的人身上；數字兩邊一樣
    const a = world(['en_single'], { pack: ALWAYS_B })
    foeStep(a, 'pc')
    const b = world(['en_single'], { pack: ALWAYS_B })
    foeStep(b, 'mate')
    expect(a.pc.load!.now).toBe(b.mate.load!.now)
    expect(a.pc.load!.now).toBeGreaterThan(0)
  })

  it('單位的名字不因為這一步而被改：名牌沒鎖定誰時照主角', () => {
    const w = world(['en_single'], { pack: ALWAYS_B })
    const before = w.foe(1).name
    foeStep(w, 'mate')
    expect(w.foe(1).name).toBe(before)
    expect(before).toBe('形象乙')
  })

  it('範圍攻擊那一拍固定看主角：就算這一步挑的目標是 male 隊友', () => {
    const w = world(['en_aoe'], { pack: ALWAYS_B })
    const r = foeStep(w, 'mate')
    const text = textOf(r)
    expect(text).toContain('形象乙：乙的招式。')
    expect(text).not.toContain('形象甲')
    // 兩個人各加了感載
    expect(w.pc.load!.now).toBeGreaterThan(0)
    expect(w.mate.load!.now).toBeGreaterThan(0)
  })

  it('男性主角：名牌是 A；對 female 的隊友那一拍換成擲到的 B；範圍攻擊看主角是 A', () => {
    const w = world(['en_single'], { pack: ALWAYS_B, pc: 'male', mate: 'female' })
    expect(w.foe(1).name).toBe('形象甲')
    const toMate = textOf(foeStep(w, 'mate'))
    expect(toMate).toContain('形象乙：乙的招式。')
    expect(toMate).not.toContain('形象甲')
    const aoe = world(['en_aoe'], { pack: ALWAYS_B, pc: 'male', mate: 'female' })
    const text = textOf(foeStep(aoe, 'mate'))
    expect(text).toContain('形象甲：甲的招式。')
    expect(text).not.toContain('形象乙')
  })

  it('沒有 forms 的敵人這一步的紀錄一個字都沒變（招牌行動照技能的名字）', () => {
    const w = world(['en_plain'])
    const text = textOf(foeStep(w, 'pc'))
    expect(text).toContain('測試en_plain：原名一。')
  })

  it('UnitRef 自己給了名字的敵人：不換名字（只換招牌行動的名字）', () => {
    const w = world([{ id: 'en_single', name: '自訂的名字' }], { pack: ALWAYS_B })
    expect(w.foe(1).name).toBe('自訂的名字')
    const text = textOf(foeStep(w, 'mate'))
    expect(text).toContain('自訂的名字：甲的招式。')
  })

  it('moves 的鍵不是這個敵人的招牌行動：載入後的檢查擋下；格式錯的也擋', () => {
    const bad = (more: Rec) => () => {
      const k = createKernel(FEATURES)
      k.content.loadPack(pack({ enemy: [foeData('en_bad', { signature: ['ab_single'], ...more })] }))
      readyFeatures(k)
    }
    expect(bad({ forms: forms('ab_aoe') })).toThrow(/forms\.a\.moves 寫了 ab_aoe/)
    expect(bad({ forms: { a: { name: '甲', look: '甲。' } } })).toThrow(/缺 b/)
    expect(bad({ forms: forms('ab_single', { points_at: ['robot'] }) })).toThrow(/points_at/)
    expect(bad({ forms: forms('ab_single', { name: '' }) })).toThrow(/forms\.a\.name/)
    expect(bad({ forms: { ...forms('ab_single'), c: {} } })).toThrow(/forms\.c/)
    expect(bad({ neutral: { name: '光' } })).toThrow(/neutral\.look/)
    expect(bad({ culture: '' })).toThrow(/culture/)
    expect(bad({ forms: forms('ab_single'), culture: '簾後' })).not.toThrow()
    expect(bad({ forms: forms('ab_single', { moves: { ab_single: { name: '' } } }) })).toThrow(/forms\.a\.moves/)
  })
})

// ===================================================================================================================
// 五、縛
// ===================================================================================================================

describe('縛 bind（P61）：行動點 −1 或不能換位；到綁他的敵人退出或隊友替他解開', () => {
  /** 敵人 f1（用 en_bind）打主角：挑目標 a1，花一個招牌行動。 */
  const bound = (id = 'en_bind') => {
    const w = world([id], { pack: ALWAYS_A })
    foeStep(w, 'pc')
    return w
  }

  it('ap 模式：主角帶著被縛・行動點（by 是那個敵人）；下一回合少回 1 點', () => {
    const w = bound()
    const st = w.pc.statuses.find((s) => s.id === BIND_STATUS.ap)
    expect(st).toMatchObject({ id: BIND_STATUS.ap, by: 'f1', until: { at: 'battle_end' } })
    expect(isBound(w.pc)).toBe(true)
    expect(isBound(w.mate)).toBe(false)
    // 回合開始：回復 3 點，被綁的少 1（regen 3 − 1）
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    w.pc.uses.turns = 1
    w.mate.uses.turns = 1
    w.pc.ap.now = 0
    w.mate.ap.now = 0
    beginTurn(r, w.pc)
    beginTurn(r, w.mate)
    expect(w.pc.ap.now).toBe(w.pc.ap.regen - 1)
    expect(w.mate.ap.now).toBe(w.mate.ap.regen)
  })

  it('綁他的敵人倒下（或退出）之後恢復；別的敵人綁的不受影響', () => {
    const w = bound()
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    expect(r.setOut(w.foe(1), 'down')).toBe(true)
    expect(isBound(w.pc)).toBe(false)
    w.pc.uses.turns = 1
    w.pc.ap.now = 0
    beginTurn(r, w.pc)
    expect(w.pc.ap.now).toBe(w.pc.ap.regen)
    // 兩個敵人各綁一個人：一個退出，只有他綁的恢復
    const two = world(['en_bind', 'en_bind'], { pack: ALWAYS_A })
    const a = two.foe(1)
    const b = two.foe(2)
    const run = new BattleRun(two.k, two.state, two.state.battle!)
    run.applyStatus(two.pc, BIND_STATUS.ap, { by: a, until: 'battle_end' })
    run.applyStatus(two.mate, BIND_STATUS.no_move, { by: b, until: 'battle_end' })
    run.setOut(a, 'fled')
    expect(isBound(two.pc)).toBe(false)
    expect(isBound(two.mate)).toBe(true)
  })

  it('隊友用 unbind 花 1 行動點解開；兩個戰場都能用；沒人被綁住的時候圓環上不列、也選不了', () => {
    const w = bound()
    const def = w.k.battle.getAction(UNBIND)!
    expect(def).toBeDefined()
    expect(def.modes).toEqual(['meat', 'net'])
    expect(def.owner).toBe('enemies')
    expect(typeof def.icon).toBe('string')
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    // 被綁的是主角：隊友（a2）看得到這個行動、主角自己看不到（隊友 = 別人，不含自己）
    expect(def.has!(r, w.mate)).toBe(true)
    expect(def.has!(r, w.pc)).toBe(false)
    expect(def.cost(r, w.mate)).toEqual({ ap: 1 })
    const targets = def.targets!(r, w.mate)
    expect(targets.find((t) => 'unit' in t.target && t.target.unit === 'a1')!.blocks).toEqual([])
    const before = w.mate.ap.now
    performAction(r, w.mate, def, { unit: 'a1' }, { action: UNBIND, target: { unit: 'a1' } })
    expect(w.mate.ap.now).toBe(before - 1)
    expect(isBound(w.pc)).toBe(false)
    expect(textOf(r)).toContain('解開了束縛')
    // 沒有人被綁住了：不列
    expect(def.has!(r, w.mate)).toBe(false)
    // 沒被綁住的人不能選；硬做丟 BattleBlocked
    expect(def.targets!(r, w.mate)[0]!.blocks.join('')).toContain('沒有被綁住')
    expect(() => performAction(r, w.mate, def, { unit: 'a1' }, { action: UNBIND, target: { unit: 'a1' } })).toThrow(BattleBlocked)
    // 敵人的 AI 不會用它（沒有 aiScore）
    expect(def.aiScore).toBeUndefined()
  })

  it('內海也能用 unbind；bind 在內海的單位身上照樣給狀態', () => {
    const k = kernelOf(pack(), NET_FEATURES)
    const state = makeState()
    const run = setupBattle(k, state, { mode: 'net', grade: 1, cover: open, allies: [raw(netAvatar(0, 1)), raw(netAvatar(1, 1))], foes: [{ from: 'enemy', id: 'en_net0' }] as never })
    state.battle = clone(run.battle)
    const r = new BattleRun(k, state, state.battle)
    const [a1, a2, f1] = [state.battle.units.a1!, state.battle.units.a2!, state.battle.units.f1!]
    r.effects([{ op: 'bind', mode: 'no_move' }], { user: f1, target: { unit: 'a1' }, source: { kind: 'ability', id: 'x', name: 'x' } })
    expect(isBound(a1)).toBe(true)
    expect(r.cannotMove(a1)).toBe(true)
    const def = k.battle.getAction(UNBIND)!
    expect(def.has!(r, a2)).toBe(true)
    performAction(r, a2, def, { unit: 'a1' }, { action: UNBIND, target: { unit: 'a1' } })
    expect(isBound(a1)).toBe(false)
    expect(r.cannotMove(a1)).toBe(false)
  })

  it('no_move 模式：被綁的人換位被擋並有原因；隊友照常能換；不是釘住：沒有失去回合、人還在場上', () => {
    const w = bound('en_bind_move')
    expect(isBound(w.pc)).toBe(true)
    expect(w.pc.statuses.map((s) => s.id)).toEqual([BIND_STATUS.no_move])
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    expect(r.cannotMove(w.pc)).toBe(true)
    expect(r.cannotMove(w.mate)).toBe(false)
    const move = w.k.battle.getAction('move')!
    const blocked = move.targets!(r, w.pc).map((t) => t.blocks)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((b) => b.length > 0)).toBe(true)
    expect(move.targets!(r, w.mate).some((t) => t.blocks.length === 0)).toBe(true)
    // 不是釘住：沒有退出、沒有失去回合
    expect(w.pc.out).toBeUndefined()
    expect(w.pc.statuses.some((s) => s.id === 'lose_turn')).toBe(false)
    // 解開後恢復
    const def = w.k.battle.getAction(UNBIND)!
    performAction(r, w.mate, def, { unit: 'a1' }, { action: UNBIND, target: { unit: 'a1' } })
    expect(r.cannotMove(w.pc)).toBe(false)
  })

  it('狀態資料沒有放時：這一筆不做事，功能的資料檢查警告列出來', () => {
    const noStatus = pack({ battle_status: [STATUSES[2]!] })
    const w = world(['en_bind'], { pack: noStatus })
    foeStep(w, 'pc')
    expect(isBound(w.pc)).toBe(false)
    expect(w.pc.load!.now).toBeGreaterThan(0)
    const k = kernelOf(noStatus)
    const warnings = enemiesFeature.warnings!(k)
    expect(warnings.some((m) => m.includes('ab_bind') && m.includes(BIND_STATUS.ap))).toBe(true)
    expect(enemiesFeature.warnings!(kernelOf())).toEqual([])
  })

  it('格式：mode 要寫、只能是 ap 或 no_move；by 只能是 user；不認得的欄位擋下', () => {
    const k = kernelOf()
    const p = (e: Rec) => k.battle.effectProblems([{ op: 'bind', ...e }])
    expect(p({ mode: 'ap' })).toEqual([])
    expect(p({ mode: 'no_move', by: 'user', who: 'target' })).toEqual([])
    expect(p({}).join('')).toContain('mode')
    expect(p({ mode: 'pin' }).join('')).toContain('mode')
    expect(p({ mode: 'ap', by: 'foe' }).join('')).toContain('by')
    expect(p({ mode: 'ap', turns: 2 }).join('')).toContain('turns')
  })

  it('挑：感載加一個「下一次命中 −1」的狀態（用現有的 load 與 status 效果寫）', () => {
    const w = world(['en_tease'], { pack: ALWAYS_A })
    foeStep(w, 'pc')
    expect(w.pc.load!.now).toBeGreaterThan(0)
    expect(w.pc.statuses.map((s) => s.id)).toContain('tease_hit')
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    expect(r.mods('hit', w.pc).some((m) => m.value === -1)).toBe(true)
  })
})

// ===================================================================================================================
// 六、疊
// ===================================================================================================================

describe('疊 overload_extra：這一擊把目標灌到過載時多疊一層餘韻（不超過承受層數）', () => {
  const user = (w: World) => w.foe(1)
  const src = { kind: 'ability' as const, id: 'ab_extra', name: '原名六' }

  it('同一擊造成過載時餘韻 +2 層（過載本身 1 層 ＋ 多疊 1 層）', () => {
    const w = world(['en_extra'])
    w.pc.layersMax = 4
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.effects([{ op: 'load', amount: 9999, type: 'neural', exact: true }, { op: 'overload_extra' }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.layers).toBe(2)
    expect(textOf(r)).toContain('餘韻再疊 1 層')
  })

  it('沒有過載的那一擊不加；if 寫 overloaded 也一樣', () => {
    const w = world(['en_extra'])
    w.pc.layersMax = 4
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.effects([{ op: 'load', amount: 1, type: 'neural', exact: true }, { op: 'overload_extra' }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.layers).toBe(0)
    r.effects([{ op: 'load', amount: 9999, type: 'neural', exact: true }, { op: 'overload_extra', if: 'overloaded' }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.layers).toBe(2)
  })

  it('layers 可以寫 2；不超過承受層數：差一層時只多疊到頂', () => {
    const w = world(['en_extra'])
    w.pc.layersMax = 3
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.effects([{ op: 'load', amount: 9999, type: 'neural', exact: true }, { op: 'overload_extra', layers: 2 }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.layers).toBe(3)
    expect(w.pc.out).toBeUndefined()
  })

  it('疊滿之後再過載照舊倒下（沒有「多疊」可言）', () => {
    const w = world(['en_extra'])
    w.pc.layersMax = 2
    w.pc.layers = 2
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.effects([{ op: 'load', amount: 9999, type: 'neural', exact: true }, { op: 'overload_extra' }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.out).toBe('burnout')
    expect(w.pc.layers).toBe(2)
  })

  it('放在攻擊的前面也行：記下來，這個行動裡由他造成的過載多疊；行動做完就清掉', () => {
    const w = world(['en_extra'])
    w.pc.layersMax = 4
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.effects([{ op: 'overload_extra' }, { op: 'load', amount: 9999, type: 'neural', exact: true }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.layers).toBe(2)
    // 行動做完（action.done）之後的過載不再多疊
    r.k.battle.emit('action.done', { run: r, unit: user(w), action: 'x', tags: [], target: null, input: { action: 'x' }, cost: { ap: 0 }, base: { ap: 0 } })
    w.pc.layers = 0
    r.effects([{ op: 'load', amount: 9999, type: 'neural', exact: true }], { user: user(w), target: { unit: 'a1' }, source: src })
    expect(w.pc.layers).toBe(1)
  })

  it('做出來的招牌行動（敵人的 AI 一步）：灌到過載的主角 +2 層', () => {
    const w = world(['en_extra'], { pack: ALWAYS_A })
    w.pc.layersMax = 4
    foeStep(w, 'pc')
    expect(w.pc.layers).toBe(2)
  })

  it('格式：layers 要是 1～3 的整數', () => {
    const k = kernelOf()
    const p = (e: Rec) => k.battle.effectProblems([{ op: 'overload_extra', ...e }])
    expect(p({})).toEqual([])
    expect(p({ layers: 2 })).toEqual([])
    expect(p({ layers: 0 }).join('')).toContain('layers')
    expect(p({ layers: 1.5 }).join('')).toContain('layers')
    expect(p({ amount: 1 }).join('')).toContain('amount')
  })
})

// ===================================================================================================================
// 七、沉溺高的敵人
// ===================================================================================================================

describe('沉溺高的敵人：承受層數 +1（60 以上）、再 +1（100 以上）（CORE_RULES 4.2 節）', () => {
  const layersOf = (id: string, grade = 1): number => world([{ id, grade }]).foe(1).layersMax

  it('沉溺 65 的敵人承受層數比資料多 1；沒寫、59 不加；60 起 +1；100 起 +2', () => {
    const base = layersOf('en_sink0')
    expect(base).toBe(1)
    expect(layersOf('en_sink59')).toBe(base)
    expect(layersOf('en_sink60')).toBe(base + 1)
    expect(layersOf('en_sink65')).toBe(base + 1)
    expect(layersOf('en_sink85')).toBe(base + 1)
    expect(layersOf('en_sink100')).toBe(base + 2)
    expect(layersOf('en_sink120')).toBe(2 + 2)
    expect(sinkLayers(undefined)).toBe(0)
    expect(sinkLayers(59)).toBe(0)
    expect(sinkLayers(60)).toBe(1)
    expect(sinkLayers(99)).toBe(1)
    expect(sinkLayers(100)).toBe(2)
    expect(SINK_LAYER_STEPS.map((s) => s.at)).toEqual([60, 100])
  })

  it('enemyStats 也一樣；內海的單位一樣（同一張表）', () => {
    const k = kernelOf()
    const state = makeState()
    expect(enemyStats(k, state, 'en_sink65').layers).toBe(enemyStats(k, state, 'en_sink0').layers + 1)
    const nk = kernelOf(pack(), NET_FEATURES)
    const ns = makeState()
    const run = setupBattle(nk, ns, { mode: 'net', grade: 1, cover: open, allies: [raw(netAvatar(0, 1))], foes: [{ from: 'enemy', id: 'en_net65' }, { from: 'enemy', id: 'en_net0' }] as never })
    expect(run.battle.units.f1!.layersMax).toBe(run.battle.units.f2!.layersMax + 1)
  })

  it('資料的沉溺沒有被改：記在 ext.enemies.sink；單位這一場的沉溺從 0 開始；溺感邊緣的標籤照舊', () => {
    const f = world(['en_sink85']).foe(1)
    expect(dataSink(f)).toBe(85)
    expect(f.sink).toBe(0)
    expect(f.tags).toContain('sink_edge')
  })
})

describe('把他推過線：沉溺 80 以上的敵人被灌倒，或被快感傷害推到 100；退出的方式是 sunk', () => {
  const gutter = (w: World, id = 1) => {
    const f = w.foe(id)
    f.layers = f.layersMax
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.addLoad(f, 99999, w.pc, { exact: true })
    return { f, r }
  }

  it('沉溺 85 被灌倒（餘韻疊滿再過載）：退出的方式是 sunk，不是 burnout；記一句', () => {
    const w = world(['en_sink85'])
    const { f, r } = gutter(w)
    expect(f.out).toBe(SUNK)
    expect(textOf(r)).toContain('沉溺過了線')
  })

  it('沉溺 80 剛好算；79 與沒有沉溺的照舊倒下（burnout）', () => {
    const edge = world([{ id: 'en_sink79' }])
    expect(gutter(edge).f.out).toBe('burnout')
    expect(gutter(world(['en_sink0'])).f.out).toBe('burnout')
    const k = kernelOf(pack({ enemy: [...ENEMIES, foeData('en_sink80', { rank: 'minion', mods: { sink: 80 } })] }))
    const w = world(['en_sink80'], { pack: pack({ enemy: [...ENEMIES, foeData('en_sink80', { rank: 'minion', mods: { sink: 80 } })] }) })
    void k
    expect(gutter(w).f.out).toBe(SUNK)
  })

  it('還沒疊滿餘韻的那一次過載不算：只失去回合', () => {
    const w = world(['en_sink85'])
    const f = w.foe(1)
    f.layers = 0
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.addLoad(f, 99999, w.pc, { exact: true })
    expect(f.out).toBeUndefined()
    expect(f.layers).toBe(1)
  })

  it('被別的功能擋下來的退出不被我們吃掉：out.before 有人先擋，就沒有推過線', () => {
    const w = world(['en_sink85'])
    w.k.battle.on('out.before', 'test', ({ how, out }) => { if (how === 'burnout') out.prevent = true }, 0)
    const { f } = gutter(w)
    expect(f.out).toBeUndefined()
  })

  it('被快感傷害加的沉溺推到 100：當場退出（sunk）；資料不到 80 的也算', () => {
    for (const [id, start] of [['en_sink95', 95], ['en_sink79', 79]] as const) {
      const w = world([id])
      const f = w.foe(1)
      const r = new BattleRun(w.k, w.state, w.state.battle!)
      // 一次快感的感載：每次命中加 1（快感的傷害類型自己帶的）
      f.sink = 100 - start - 1
      r.effects([{ op: 'load', amount: 1, type: 'pleasure' }], { user: w.pc, target: { unit: 'f1' }, source: { kind: 'ability', id: 'x', name: 'x' } })
      expect(f.sink).toBe(100 - start)
      // 這一步做完（action.done）才看，不在攻擊的中間退出
      expect(f.out).toBeUndefined()
      r.k.battle.emit('action.done', { run: r, unit: w.pc, action: 'x', tags: [], target: null, input: { action: 'x' }, cost: { ap: 0 }, base: { ap: 0 } })
      expect(f.out, id).toBe(SUNK)
    }
  })

  it('還差一點（99）不退出；資料本來就在 100 以上的不是「推過線」，不會一開打就退出', () => {
    const w = world(['en_sink95'])
    const f = w.foe(1)
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    f.sink = 4
    r.k.battle.emit('turn.end', { run: r, unit: w.pc })
    expect(f.out).toBeUndefined()
    const hi = world(['en_sink100', 'en_sink120'])
    const r2 = new BattleRun(hi.k, hi.state, hi.state.battle!)
    r2.k.battle.emit('round.start', { run: r2, round: 1 })
    r2.k.battle.emit('action.done', { run: r2, unit: hi.pc, action: 'x', tags: [], target: null, input: { action: 'x' }, cost: { ap: 0 }, base: { ap: 0 } })
    expect(hi.foe(1).out).toBeUndefined()
    expect(hi.foe(2).out).toBeUndefined()
  })

  it('沒有 forms 與沒有沉溺資料的敵人不受影響：沉溺 0 的敵人被快感打幾下也不退出', () => {
    const w = world(['en_sink0'])
    const f = w.foe(1)
    f.sink = 50
    const r = new BattleRun(w.k, w.state, w.state.battle!)
    r.k.battle.emit('action.done', { run: r, unit: w.pc, action: 'x', tags: [], target: null, input: { action: 'x' }, cost: { ap: 0 }, base: { ap: 0 } })
    expect(f.out).toBeUndefined()
  })
})

describe('被推過線之後的結算：不能俘虜、掉落照常、結束的報告多一句並帶觸發點 foe_sunk', () => {
  /** 一局：敵人 f1（沉溺 85）被灌倒（sunk）、其餘站著的也退出，主角方勝；回傳結算之後的報告。 */
  async function ended(how: 'sunk' | 'down' = 'sunk') {
    const t = makeBattleGame({
      features: FEATURES, content: [pack()], seed: 3,
      battle: { mode: 'meat', grade: 1, cover: 'medium', allies: [raw(one({ weapon: 'pistol' }, 1))], foes: [{ from: 'enemy', id: 'en_sink85' }] as never, origin: { escapable: true, place: '測試用的倉庫' } },
    })
    const game = t.game
    const b = game.state.battle!
    const run = new BattleRun(game.k, game.state, b)
    const f = b.units.f1!
    if (how === 'sunk') {
      f.layers = f.layersMax
      run.addLoad(f, 99999, b.units.a1!, { exact: true })
    } else run.setOut(f, 'down')
    expect(f.out).toBe(how === 'sunk' ? SUNK : 'down')
    b.result = { outcome: 'win', text: '打完了。' }
    const { result, violations } = await observed(game, () => game.finishBattle())
    expect(violations).toEqual([])
    return { game, reports: result.reports, end: result.reports.find((r) => r.action === 'battle.end')! }
  }

  it('結束的報告多一句；接著一份帶觸發點 foe_sunk 的報告；記著的東西送出之後清掉', async () => {
    const { game, reports, end } = await ended()
    expect(end.outcome.summary).toContain('沉溺過了線，成了溺感者')
    expect(end.narration?.results?.some((l) => l.includes('成了溺感者'))).toBe(true)
    const sunk = reports.find((r) => r.action === 'enemies.foe_sunk')!
    expect(sunk).toBeDefined()
    expect(sunk.triggers).toEqual([{ point: FOE_SUNK_POINT, where: expect.objectContaining({ enemy: 'en_sink85' }) }])
    expect(pendingSunk(game.state)).toBeNull()
    expect(game.state.ext[SUNK_EXT]).toBeUndefined()
  })

  it('不能俘虜：沒有俘虜的選項；掉落照常（打倒是怎麼掉的，被推過線就怎麼掉）', async () => {
    const sunk = await ended('sunk')
    const down = await ended('down')
    expect(captureOf(sunk.game.state)).toBeNull()
    const loot = (r: { changes: Array<Rec> }) => JSON.stringify(r.changes.filter((c) => c.op === 'item'))
    expect(loot(sunk.end)).toContain('it_part')
    expect(loot(sunk.end)).toBe(loot(down.end))
    // 一般的打倒沒有 foe_sunk
    expect(down.reports.some((r) => r.action === 'enemies.foe_sunk')).toBe(false)
    expect(down.end.outcome.summary).not.toContain('溺感者')
  })
})
