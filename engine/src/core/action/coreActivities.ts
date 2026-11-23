// L5 行動核心：核心自己登記的兩種活動（dev/adr/0016 第一節；規則與句子照原本的 Game.blockOf，一字不動）：
//   battle（order 0）  戰鬥進行中：只能做戰鬥的事
//   defeat（order 10） 打輸之後等玩家三選一：只能三選一（dev/adr/0014「等著選的戰敗由核心擋」）
// 戰鬥以外的活動（事件、成人場景、委託副本）由功能登記，不在核心。

import type { GameState, Origin } from '../types'
import type { BattleSetup } from '../battle/setup'
import { pendingDefeat, startBattle } from '../battle/step'
import { clone } from '../util/clone'
import { isRecord } from '../util/sanitize'
import { ActionBlocked } from './action'
import type { ActivityDef, ActivityRegistry } from './activity'

/**
 * 開戰設定加上是誰發起的：origin 的 by、ref 與 ext 併進 setup.origin.ext。
 * 先放設定自己寫的，再放 origin.ext，最後放 by 與 ref（頂層的欄位不會被 ext 裡同名的鍵蓋掉）。回傳新的設定，不改傳進來的。
 */
export function battleSetupWithOrigin(setup: BattleSetup, origin: Origin): BattleSetup {
  const out = clone(setup)
  const ext: Record<string, unknown> = { ...(out.origin?.ext ?? {}), ...clone(origin.ext ?? {}), by: origin.by, ...(origin.ref !== undefined ? { ref: origin.ref } : {}) }
  out.origin = { ...(out.origin ?? {}), ext }
  return out
}

const battleActivity: ActivityDef = {
  kind: 'battle', owner: 'core', order: 0,
  active: (s: GameState) => (s.battle ? { id: s.battle.id, label: '戰鬥' } : null),
  // 戰鬥的每一步與結束的結算（battle_end 這條鏈）、重來
  allow: ['battle.', 'commit:battle.'],
  allows: (_s, doing) => doing === 'chain:battle_end',
  reason: () => '正在戰鬥，先把這一場打完。',
  start(k, state, setup, origin) {
    if (!isRecord(setup)) throw new ActionBlocked('這場戰鬥開不起來（開戰的設定要寫雙方上場的人）。')
    try {
      return [startBattle(k, state, battleSetupWithOrigin(setup as unknown as BattleSetup, origin))]
    } catch (e) {
      // 已經有一場在打、沒有人上場、遭遇點寫了不存在的敵人……：開不成，整步不成立（和走到遭遇點開不了戰同一條，不變式第 61 條）
      if (e instanceof ActionBlocked) throw e
      throw new ActionBlocked(`這場戰鬥開不起來（${(e as Error).message}）。`)
    }
  },
}

const defeatActivity: ActivityDef = {
  kind: 'defeat', owner: 'core', order: 10,
  active: (s: GameState) => {
    const p = pendingDefeat(s)
    return p ? { id: p.snapshot, label: '戰敗的三個選擇' } : null
  },
  // 重來；或提交一份把開打前的快照丟掉的報告（接受結果）
  allow: [],
  allows: (_s, doing, draft) => doing === 'battle.retry' || !!draft?.changes.some((c) => c.op === 'snapshot.drop' && c.kind === 'battle'),
  reason: () => '先在戰敗的三個選擇裡選一個：接受結果、重來這場戰鬥，或回到這個階段開始時。',
}

/** createKernel 呼叫：登記核心自己的兩種活動。 */
export function registerCoreActivities(reg: ActivityRegistry): void {
  reg.define(battleActivity)
  reg.define(defeatActivity)
}
