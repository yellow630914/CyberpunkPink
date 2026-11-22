// 保釋（SKILL_TREES 掮客：人面）的「被贖回」：裝著保釋（meat.ransom）的人在隊上，全隊倒下（輸，不是投降）時，戰敗事件多一個選項：
// 付 meat.ransom.cash（等級×1,000 C$）、跳過事件的內容。戰敗的功能（features/defeat）開了一個掛點 defeat.options；這裡掛上去，兩邊不互相 import。
// 贖金在戰鬥結束時就算好（那時候才有這一場的等級與隊伍的資料），記在 state.ext.ransom；選項出現時看這一筆（要是同一場戰鬥）。

import type { BattleRun, BattleState, Change, GameState, Kernel } from '../../core'
import { amount } from '../../core'
import { OWNER } from './types'
import { equippedOf, isRec, tierIn } from './unitdata'

const EXT = 'ransom'

interface RansomState {
  battle: string
  cost: number
  /** 叫人來贖的是誰（隊上裝著保釋的人；有好幾個就是最便宜的那一個） */
  by: string
}

/** 戰鬥結束時：輸了而且隊上有人裝著保釋，記下贖金；其他情況把舊的記錄清掉。 */
export function ransomChanges(k: Pick<Kernel, 'content'>, state: GameState, battle: BattleState, outcome: string): Change[] {
  let best: RansomState | undefined
  if (outcome === 'lose') {
    for (const u of Object.values(battle.units)) {
      if (u.side !== 'ally' || !u.actor) continue
      for (const ab of equippedOf({ k }, u)) {
        const r = ab.meat?.ransom
        if (!r || ab.meat?.pending) continue
        // 公式只看場景的等級（不擲骰：載入時擋了）；amount 要一個戰鬥的樣子，這裡只用得到 battle.grade
        const cost = Math.max(0, Math.round(amount({ run: { battle } as unknown as BattleRun, user: u, n: { tier: tierIn(u, ab.path), grade: battle.grade } }, r.cash)))
        if (!best || cost < best.cost) best = { battle: battle.id, cost, by: u.name }
      }
    }
  }
  if (best) return [{ op: 'ext', key: EXT, value: best }]
  return isRec(state.ext[EXT]) ? [{ op: 'ext', key: EXT, value: null }] : []
}

export function registerRansom(k: Kernel): void {
  // 戰敗在等玩家選的時候：多一個「被贖回」
  k.hooks.on('defeat.options', OWNER, ({ state, pending }) => {
    const r = state.ext[EXT]
    if (pending.outcome !== 'lose' || !isRec(r) || r.battle !== pending.battle || typeof r.cost !== 'number') return
    const cost = r.cost
    const by = typeof r.by === 'string' ? r.by : '隊上的人'
    const cash = state.money.cash
    return [{
      id: 'ransom', name: '被贖回',
      desc: `付 ${cost} C$，${by}叫來的人把你們贖回來，跳過戰敗事件的內容；這件委託照戰敗處理。`,
      blocks: cash >= cost ? [] : [`現金不夠（要 ${cost}，現在 ${cash}）。`],
      changes: [...(cost > 0 ? [{ op: 'cash', delta: -cost } as Change] : []), { op: 'ext', key: EXT, value: null }],
      lines: [`${by}叫來的人付了贖金，你們被贖回來了（付 ${cost} C$）。`],
      summary: `你們被贖回來了，付了 ${cost} C$，沒有經歷戰敗事件。${pending.fails_commission ? '這一趟的委託算失敗。' : '這一趟的委託還在。'}`,
    }]
  })
}
