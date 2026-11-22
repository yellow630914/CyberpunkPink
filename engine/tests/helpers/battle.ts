// 戰鬥測試共用的小工具：建一場不經過提交的戰鬥、釘死骰面、拿單位。
import type { BattleSetup, BattleState, BattleUnit, Feature, GameState, Kernel } from '../../src'
import { BattleRun, clone, createKernel, setupBattle } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, enemyUnit, fixDice, makeState, partyUnit } from '../../src/testkit'

export const raw = (unit: unknown, slot?: number) => ({ from: 'unit', unit: unit as Record<string, unknown>, ...(slot ? { slot } : {}) })

export interface Arena {
  k: Kernel
  state: GameState
  battle: BattleState
  /** 一個新的 run，工作副本就是 arena.battle（測試直接看它的變化）；dice 是釘死的骰面 */
  run(dice?: number[]): BattleRun
  ally(i: number): BattleUnit
  foe(i: number): BattleUnit
}

/** 建一場戰鬥，不經過提交。features 預設只有測試用的那一組行動；prepare 可以先在 kernel 上註冊東西（狀態、掛點）。 */
export function arena(setup: BattleSetup = BATTLE_SETUPS.encounter(), features: Feature[] = [TEST_COMBAT], prepare: (k: Kernel) => void = () => {}): Arena {
  const k = createKernel(features)
  prepare(k)
  const state = makeState()
  const battle = clone(setupBattle(k, state, setup).battle)
  return {
    k, state, battle,
    run: (dice) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)),
    ally: (i) => battle.units[`a${i}`]!,
    foe: (i) => battle.units[`f${i}`]!,
  }
}

export const one = (o: Parameters<typeof partyUnit>[2] = {}, i = 1) => partyUnit(i, 1, o)
export const foe = (rank: Parameters<typeof enemyUnit>[0] = 'minion', o: Parameters<typeof enemyUnit>[2] = {}) => enemyUnit(rank, 1, o)

/** 幾對幾的小場地：遮蔽逐格給（預設全部暴露）。 */
export function duel(allies: unknown[], foes: unknown[], cover: { ally: number[]; foe: number[] } = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, more: Partial<BattleSetup> = {}): BattleSetup {
  return { mode: 'meat', grade: 1, cover, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), ...more }
}

/** 測試用的幾個狀態（正式的在 data/rules/battle_statuses.json，由資料的工單寫）。 */
export const TEST_STATUSES = [
  { id: 'suppressed', name: '壓制', desc: '被壓制：不能換位，攻擊 −2。', mods: { hit: -2 }, no_move: true, until: 'own_turn_end', turns: 1, kind: 'debuff' },
  { id: 'dazed', name: '暈眩', desc: '暈眩：下回合行動點 −2。', turn_start: { ap: -2 }, once: true, until: 'battle_end', kind: 'wound' },
  { id: 'bleeding', name: '流血', desc: '流血：每回合生命 −2，急救可停。', turn_start: { hp: -2 }, until: 'battle_end', kind: 'wound', cleansed_by: ['first_aid'] },
  { id: 'marked', name: '標記', desc: '被標記：全隊打他命中 +2。', mods: { hit_against: 2 }, until: 'source_turn_start', turns: 1, kind: 'mark' },
  { id: 'burning', name: '燃燒', desc: '燃燒：之後兩回合各 1d6。', turn_start: { hp_dice: 1 }, until: 'own_turn_start', turns: 2, kind: 'debuff' },
  { id: 'jammed', name: '失效', desc: '義體與智慧武器失效一回合。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
  { id: 'frozen', name: '癱瘓', desc: '被癱瘓：失去下一個回合。', lose_turn: true, until: 'own_turn_start', turns: 1, kind: 'control' },
]
