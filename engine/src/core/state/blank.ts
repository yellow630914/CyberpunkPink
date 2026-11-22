// L3 狀態核心：空白的狀態骨架與存檔規則的預設值。開新遊戲、狀態工廠、讀檔補欄位都從這裡拿。

import type { GameState, SaveRules } from '../types'
import { STATE_VERSION } from '../types'

/** 存檔規則的預設值（BALANCE 第 7 節：普通；CHARACTER 5.6 節的數字）。 */
export const DEFAULT_RULES: SaveRules = {
  difficulty: 'normal',
  dcOffset: 0,
  fastTravel: true,
  billMult: 1,
  defeatView: 'always',
  defeatTakeGear: true,
  defeatMoneyLoss: 0,
  rosterDeath: false,
  xpMult: 1,
  startXp: 200,
  startSkillPoints: 10,
  startSkillMax: 3,
  startPerkPoints: 4,
  startCyberPoints: 10,
  startMoney: 1500,
  contentOff: [],
}

/** 一份空白的狀態：第 1 天 08:00、沒有主角、沒有錢。 */
export function blankState(seed: number): GameState {
  return {
    version: STATE_VERSION,
    rng: { seed: seed | 0, cursor: 0 },
    time: { day: 1, hour: 8, minute: 0 },
    money: { cred: 0, cash: 0 },
    location: {},
    pc: null,
    actors: {},
    party: [],
    inventory: [],
    flags: {},
    counters: {},
    rules: { ...DEFAULT_RULES, contentOff: [] },
    reports: [],
    chains: [],
    seq: { report: 0, chain: 0, uid: 0, floor: 0 },
    ext: {},
  }
}
