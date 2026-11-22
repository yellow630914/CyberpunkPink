// 測試基礎建設：戰鬥的具名情境（dev/test-harness.md 第 1 節：一場一般遭遇、一場首領戰）與一組最小的行動。
//
// - 單位的數字照設計書的基準：敵人是 ENEMIES 1.5 節每一級的目標值，我方是 BALANCE 2.2 節同級的主力。
//   這是測試用的基準（不讀資料檔）；正式的敵人由資料加上敵人的功能組出來。
// - TEST_COMBAT 是一組最小的行動（攻擊、換彈、監視），只用核心的基本動作，讓核心的測試、冒煙、探針不必等現實戰鬥的功能。
//   正式的行動表（COMBAT_SYSTEM 1.3 節）在 features/combat；裝了它就不要再裝這一組（行動的 id 不同，可以並存，但 AI 會兩邊都用）。

import type { BattleUnit, BattleWeapon, Grade, UnitRank } from '../core/types'
import type { Feature } from '../core/kernel'
import { distance, otherSide, unitsOf, wielded } from '../core/battle/field'
import type { BattleUnitInit } from '../core/battle/registry'
import type { BattleSetup, UnitRef } from '../core/battle/setup'
import type { Game } from '../shell/game'
import type { GameSetup, TestGame } from './factory'
import { makeGame } from './factory'

type Five = [number, number, number, number, number]
/** ENEMIES 1.5 節「現實」那張表（BALANCE 2.4 節）：每一級的攻擊加值、迴避、護甲、生命、感載上限、槍管的等級骰。 */
export const ENEMY_TARGETS = {
  attack: [3, 4, 5, 6, 7] as Five,
  evade: [10, 12, 14, 16, 18] as Five,
  armor: [1, 2, 3, 4, 5] as Five,
  hp: { minion: [45, 55, 67, 82, 100] as Five, elite: [110, 130, 165, 205, 250] as Five, boss: [260, 300, 380, 470, 580] as Five },
  load: { minion: [22, 27, 33, 40, 49] as Five, elite: [37, 45, 55, 67, 82] as Five, boss: [52, 63, 77, 94, 115] as Five },
  layers: { minion: 1, elite: 2, boss: 4 },
  ap: { minion: 4, elite: 5, boss: 6 },
  gradeDice: [0, 0, 1, 2, 3] as Five,
  /** 位階的傷害倍率（只乘在現實的生命傷害上） */
  rankDamage: { minion: 0.4, elite: 0.6, boss: 1 },
  /** 遭遇的點數（ENEMIES 第 13 節） */
  points: { minion: 1, elite: 2.5, boss: 5 },
}
/** BALANCE 2.2 節：主角這一邊同級的主力。 */
export const PARTY_TARGETS = {
  attack: [4, 6, 8, 10, 12] as Five,
  evade: [12, 13, 14, 15, 16] as Five,
  hp: [46, 46, 50, 50, 55] as Five,
  armor: [2, 3, 4, 5, 6] as Five,
  load: [38, 38, 42, 42, 46] as Five,
  layers: [3, 3, 3, 3, 4] as Five,
  apMax: [5, 5, 5, 6, 6] as Five,
  /** 槍管的傷害（份量全押）加技能給的傷害（BALANCE 2.3 節） */
  flat: [1, 3, 5, 7, 10] as Five,
}

const ATTRS = { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }

/** COMBAT_SYSTEM 第 5 節的武器表（測試用的幾把）。hit 與等級骰由呼叫的人加。 */
export const TEST_WEAPONS: Record<string, Omit<BattleWeapon, 'id' | 'hit'>> = {
  pistol: { name: '手槍', class: 'pistol', dice: 3, flat: 0, type: 'physical', range: [1, 4], pierce: 0, attr: 'reflex', skill: 'firearms', mag: { now: 2, max: 2 }, coverMult: 0.25, traits: [] },
  smg: { name: '衝鋒槍', class: 'smg', dice: 3, flat: 0, type: 'physical', range: [2, 5], pierce: 0, attr: 'reflex', skill: 'firearms', mag: { now: 3, max: 3 }, coverMult: 0.5, traits: [] },
  shotgun: { name: '霰彈槍', class: 'shotgun', dice: 5, far: { beyond: 2, dice: 3 }, flat: 0, type: 'physical', range: [1, 3], pierce: 0, attr: 'reflex', skill: 'firearms', mag: { now: 2, max: 2 }, coverMult: 1.5, traits: ['push'] },
  rifle: { name: '步槍', class: 'rifle', dice: 4, flat: 0, type: 'physical', range: [3, 7], pierce: 2, attr: 'reflex', skill: 'firearms', mag: { now: 3, max: 3 }, coverMult: 0.5, traits: ['long'] },
  sniper: { name: '狙擊槍', class: 'sniper', dice: 6, flat: 0, type: 'physical', range: [5, 7], pierce: 4, attr: 'reflex', skill: 'firearms', mag: { now: 1, max: 1 }, coverMult: 0.25, traits: ['long', 'aimed'], ap: 3 },
  stun: { name: '感官彈槍', class: 'neural_gun', dice: 3, flat: 0, type: 'neural', range: [2, 5], pierce: 0, attr: 'reflex', skill: 'firearms', mag: { now: 2, max: 2 }, coverMult: 0, traits: [] },
  knife: { name: '刀', class: 'melee', dice: 3, flat: 0, type: 'physical', range: [1, 1], pierce: 1, attr: 'body', skill: 'brawl', coverMult: 0, traits: ['melee'] },
}

export function testWeapon(kind: keyof typeof TEST_WEAPONS | string, hit: number, extraDice = 0, flat = 0): BattleWeapon {
  const w = TEST_WEAPONS[kind]
  if (!w) throw new Error(`testWeapon：沒有 ${kind} 這把武器`)
  return { ...structuredClone(w), id: kind, hit, dice: w.dice + extraDice, flat: w.flat + flat, ...(w.far ? { far: { beyond: w.far.beyond, dice: w.far.dice + extraDice } } : {}) }
}

export interface UnitOverrides extends Partial<BattleUnitInit> {
  weapon?: string
}

/** 一個敵人：ENEMIES 1.5 節那一級、那個位階的目標值。capture 的敵人拿神經武器（雜兵 4d6、精英 6d6、首領 11d6）。 */
export function enemyUnit(rank: UnitRank, grade: Grade = 1, o: UnitOverrides & { name?: string; capture?: boolean } = {}): BattleUnitInit {
  const g = grade - 1
  const t = ENEMY_TARGETS
  const { weapon, capture, ...rest } = o
  const elitePlus = rank !== 'minion' && grade >= 4 ? 1 : 0
  const gun = capture
    ? { ...testWeapon('stun', t.attack[g]!), dice: ({ minion: 4, elite: 6, boss: 11 } as const)[rank] + t.gradeDice[g]! }
    : testWeapon(weapon ?? (rank === 'boss' ? 'smg' : 'pistol'), t.attack[g]!, t.gradeDice[g]!)
  return {
    name: o.name ?? ({ minion: '保全', elite: '小隊長', boss: '課長' } as const)[rank], control: 'ai', grade, rank,
    attrs: { ...ATTRS }, skills: { composure: rank === 'minion' ? 0 : 2 },
    hp: { now: t.hp[rank][g]!, max: t.hp[rank][g]! }, armor: t.armor[g]!,
    load: { now: 0, max: t.load[rank][g]! }, layers: 0, layersMax: t.layers[rank], sensitivity: 50, sink: 0,
    ap: { now: t.ap[rank] + elitePlus, max: t.ap[rank] + elitePlus, regen: 3 }, pools: {},
    weapons: [gun], wield: 0, evade: t.evade[g]!, initBonus: 0, statuses: [],
    dmgMult: { hp: t.rankDamage[rank], load: 1 }, tags: [], quick: [], uses: {}, wounds: {}, ext: {},
    ai: { focus: 1, floor: 1, mode: capture ? 'capture' : 'lethal', fleeBelow: 0, prefer_slots: rank === 'boss' ? [3] : [1, 2], coverUse: 0.5 },
    ...rest,
  }
}

const PARTY_NAMES = ['奈奈', '你', '零', '喬']
const PARTY_GUNS = ['shotgun', 'smg', 'rifle', 'pistol']

/** 我方的一個人：BALANCE 2.2 節同級的主力。i 是第幾個（0 站第 1 格，拿霰彈；之後是衝鋒槍、步槍、手槍）。 */
export function partyUnit(i = 0, grade: Grade = 1, o: UnitOverrides = {}): BattleUnitInit {
  const g = grade - 1
  const t = PARTY_TARGETS
  const { weapon, ...rest } = o
  return {
    name: PARTY_NAMES[i % 4]!, control: 'player', grade, rank: 'elite',
    attrs: { ...ATTRS, reflex: 15, resolve: 12 }, skills: { firearms: 2, brawl: 2, composure: 1, athletics: 1 },
    hp: { now: t.hp[g]!, max: t.hp[g]! }, armor: t.armor[g]!,
    load: { now: 0, max: t.load[g]! }, layers: 0, layersMax: t.layers[g]!, sensitivity: 50, sink: 0,
    ap: { now: t.apMax[g]!, max: t.apMax[g]!, regen: 3 }, pools: { ram: { now: 4, max: 4, regen: 2 } },
    weapons: [testWeapon(weapon ?? PARTY_GUNS[i % 4]!, t.attack[g]!, ENEMY_TARGETS.gradeDice[g]!, t.flat[g]!)], wield: 0,
    evade: t.evade[g]!, initBonus: 2, statuses: [], dmgMult: { hp: 1, load: 1 }, tags: [], quick: [], uses: {}, wounds: {}, ext: {},
    // 由程式代打時（playOut）：集火最弱的那一個，站在原本那一格（和 tools/balance/sim.py 的打法一樣）
    ai: { focus: 1, floor: 1, prefer: 'weakest', mode: 'lethal', fleeBelow: 0, prefer_slots: [i % 4 + 1], coverUse: 0.5 },
    ...rest,
  }
}

const raw = (unit: BattleUnitInit, slot?: number): UnitRef => ({ from: 'unit', unit: unit as unknown as Record<string, unknown>, ...(slot ? { slot } : {}) })
const partyOf = (grade: Grade): UnitRef[] => [0, 1, 2, 3].map((i) => raw(partyUnit(i, grade)))

/** 具名的戰鬥情境（dev/test-harness.md 第 1 節）。每一個回傳一份開打的設定；等級預設 I。 */
export const BATTLE_SETUPS = {
  /** 一場一般遭遇：同級的四人隊伍對四個雜兵（4 點，ENEMIES 第 13 節），遮蔽是「中」 */
  encounter: (grade: Grade = 1): BattleSetup => ({
    mode: 'meat', grade, cover: 'medium', allies: partyOf(grade),
    foes: [raw(enemyUnit('minion', grade, { name: '打手', weapon: 'knife' })), raw(enemyUnit('minion', grade)), raw(enemyUnit('minion', grade, { weapon: 'smg' })), raw(enemyUnit('minion', grade))],
    origin: { escapable: true, place: '測試用的倉庫' },
  }),
  /** 一般遭遇的另一種組法：兩個雜兵加一個精英（4.5 點） */
  encounterElite: (grade: Grade = 1): BattleSetup => ({
    mode: 'meat', grade, cover: 'medium', allies: partyOf(grade),
    foes: [raw(enemyUnit('minion', grade)), raw(enemyUnit('minion', grade, { weapon: 'smg' })), raw(enemyUnit('elite', grade, { weapon: 'rifle' }))],
    origin: { escapable: true, place: '測試用的倉庫' },
  }),
  /** 一場首領戰：一個首領加三個雜兵（8 點），遮蔽是「中」；不能脫離 */
  boss: (grade: Grade = 1): BattleSetup => ({
    mode: 'meat', grade, cover: 'medium', allies: partyOf(grade),
    foes: [raw(enemyUnit('minion', grade)), raw(enemyUnit('minion', grade, { weapon: 'smg' })), raw(enemyUnit('boss', grade)), raw(enemyUnit('minion', grade))],
    origin: { escapable: false, place: '測試用的頂樓' },
  }),
  /** 打感載的遭遇：四個用神經武器的雜兵（capture） */
  capture: (grade: Grade = 1): BattleSetup => ({
    mode: 'meat', grade, cover: 'medium', allies: partyOf(grade),
    foes: [0, 1, 2, 3].map(() => raw(enemyUnit('minion', grade, { capture: true }))),
    origin: { escapable: true, place: '測試用的走廊' },
  }),
  /** 一定會輸的一場：主角一個人、只剩一口氣，對三個首領（戰敗的流程用） */
  hopeless: (grade: Grade = 1): BattleSetup => ({
    mode: 'meat', grade, cover: 'sparse',
    allies: [raw(partyUnit(1, grade, { hp: { now: 1, max: PARTY_TARGETS.hp[grade - 1]! }, evade: 0 }))],
    foes: [raw(enemyUnit('boss', grade)), raw(enemyUnit('boss', grade)), raw(enemyUnit('boss', grade))],
    origin: { escapable: false, place: '測試用的死巷' },
  }),
} satisfies Record<string, (grade?: Grade) => BattleSetup>
export type BattleScenarioId = keyof typeof BATTLE_SETUPS

const ATTACK = 'test.attack', RELOAD = 'test.reload', WATCH = 'test.watch'

/**
 * 一組最小的行動：攻擊（2 點，花彈匣 1 格；近戰只能打近身）、換彈（1 點）、監視（2 點）。
 * 只用核心的基本動作；AI 的分數照 ENEMIES 4.3 節的基準（攻擊 2、命中率低於 35% 時 1；換彈 3、只剩一格 1；監視 1.5）。
 */
export const TEST_COMBAT: Feature = {
  id: 'test_combat',
  install(k) {
    const loaded = (u: BattleUnit) => {
      const w = wielded(u)
      return !!w && (!w.mag || w.mag.now >= 1)
    }
    const inReach = (u: BattleUnit, t: BattleUnit) => !wielded(u)?.traits.includes('melee') || distance(u, t) === 1
    k.battle.action({
      id: ATTACK, owner: 'test_combat', name: '攻擊', desc: '用手上的武器攻擊一個敵人。', group: 'attack', target: 'foe', order: 1,
      cost: (_v, u) => ({ ap: wielded(u)?.ap ?? 2 }),
      blocks: (_v, u) => (loaded(u) ? [] : ['彈匣空了，要先換彈。']),
      targets: (v, u) => unitsOf(v.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id }, blocks: inReach(u, t) ? [] : ['近戰只能打近身（雙方的第 1 格）。'] })),
      run: (run, u, target) => {
        if (target && 'unit' in target) run.attack(u, run.unit(target.unit))
      },
      auto: (run, u, t) => {
        if (!loaded(u) || !inReach(u, t)) return false
        run.attack(u, t, { label: '監視射擊', tags: ['watch'] })
        return true
      },
      aiScore: (v, u, t) => (t ? (v.hitChance(u, t) < 35 ? 1 : 2) : null),
    })
    k.battle.action({
      id: RELOAD, owner: 'test_combat', name: '換彈', desc: '把彈匣補滿。', group: 'supply', target: 'none', order: 1,
      cost: () => ({ ap: 1 }),
      blocks: (_v, u) => {
        const w = wielded(u)
        return !w?.mag ? ['這把武器不用換彈。'] : w.mag.now >= w.mag.max ? ['彈匣是滿的。'] : []
      },
      run: (run, u) => {
        const w = wielded(u)!
        w.mag!.now = w.mag!.max
        run.say(`${u.name} 換彈。`, 'reload', { unit: u.id }, u)
      },
      aiScore: (_v, u) => {
        const w = wielded(u)
        return !w?.mag ? null : w.mag.now === 0 ? 3 : w.mag.now === 1 && w.mag.max > 1 ? 1 : null
      },
    })
    k.battle.action({
      id: WATCH, owner: 'test_combat', name: '監視', desc: '到你的下一回合開始前，第一次有敵人站上暴露的格子，就自動朝他攻擊一次。', group: 'tactic', target: 'none', order: 2,
      cost: () => ({ ap: 2 }),
      blocks: (_v, u) => (u.watch ? ['已經在監視了。'] : []),
      run: (run, u) => {
        u.watch = { action: ATTACK }
        run.say(`${u.name} 監視：敵人一站上暴露的格子就開槍。`, 'watch', { unit: u.id }, u)
      },
    })
  },
}

export const TEST_ACTIONS = { ATTACK, RELOAD, WATCH }

export interface BattleGameSetup extends GameSetup {
  /** 具名的情境，或直接給開打的設定 */
  battle?: BattleScenarioId | BattleSetup
  grade?: Grade
}

/**
 * 一局已經開打的遊戲：狀態來自工廠，戰鬥來自具名的情境（預設是一般遭遇）。
 * 沒有給 features 時裝 TEST_COMBAT；給了 features 就照給的（現實戰鬥的功能做完之後，測試給 allFeatures()）。
 */
export function makeBattleGame(o: BattleGameSetup = {}): TestGame {
  const test = makeGame({ ...o, features: o.features ?? [TEST_COMBAT] })
  const setup = typeof o.battle === 'object' ? o.battle : BATTLE_SETUPS[o.battle ?? 'encounter'](o.grade ?? 1)
  test.game.startBattle(setup)
  return test
}

/**
 * 讓程式把這場戰鬥打完（雙方都由 AI 選動作），回傳結果與走了幾步。打不完（超過 maxSteps）丟錯。
 * 只打到分出結果；結束的結算（game.finishBattle）由呼叫的人做。
 */
export function playOut(game: Game, maxSteps = 2000): { outcome: string; steps: number; rounds: number } {
  let steps = 0
  while (game.battle && !game.battle.result) {
    if (++steps > maxSteps) throw new Error(`戰鬥打了 ${maxSteps} 步還沒分出結果`)
    const r = game.battleNext({ anyone: true })
    if (r.status !== 'applied') throw new Error(`自動戰鬥的一步沒有成立：${(r.reasons ?? []).join(' ')}`)
  }
  if (!game.battle?.result) throw new Error('現在沒有在戰鬥')
  return { outcome: game.battle.result.outcome, steps, rounds: game.battle.round }
}

/**
 * 讓一個 BattleRun 照給的順序出骰面（d20、d6 都從這一串拿；0～1 的亂數拿到的是「值 ÷ 100」）。用完就丟錯。
 * 規則的測試用它把每一顆骰釘死；整場戰鬥的測試用種子。
 */
export function fixDice<T extends { roll(count: number, sides: number): number[]; rand(): number }>(run: T, values: number[]): T {
  const queue = [...values]
  const take = (what: string): number => {
    if (!queue.length) throw new Error(`fixDice：骰面用完了（還要一顆 ${what}）`)
    return queue.shift()!
  }
  run.roll = (count, sides) => Array.from({ length: count }, () => take(`d${sides}`))
  run.rand = () => take('亂數') / 100
  return run
}
