// L5 戰鬥：核心內建的兩個行動。每個戰場都一樣的才放這裡：結束回合，以及換位（站位是引擎的事；現實與內海都是 1 點行動點）。
// 其餘的行動（射擊、近戰、換彈、換武器、道具、打遮蔽、監視、制伏、脫離、投降、技能……）由功能註冊。

import { BATTLE_SLOTS } from '../types'
import { MOVE_AP } from './ai'
import { moveBlock } from './field'
import type { BattleRegistry } from './registry'
import { END_TURN } from './step'
import { advance } from './turn'

export const MOVE = 'move'

export function registerCoreBattleActions(reg: BattleRegistry): void {
  reg.action({
    id: END_TURN, owner: 'core', name: '結束回合', desc: '結束這個人的回合。沒用完的行動點留到下回合，不超過上限。',
    group: 'system', icon: 'end', target: 'none', order: 0,
    cost: () => ({ ap: 0 }),
    run: (run) => advance(run),
  })

  reg.action({
    id: MOVE, owner: 'core', name: '換位', desc: '和相鄰那一格的隊友交換，或移到相鄰的空格。次數不限。往後退、讓前面空著的時候，原本那一格要有遮蔽。',
    group: 'tactic', icon: 'move', target: 'ally_slot', order: 1,
    // 換位花的行動點可以被技能減免（每場第一次換位不花行動點）
    cost: (view, u) => ({ ap: Math.max(0, MOVE_AP + view.mods('move_ap', u).reduce((s, p) => s + p.value, 0)) }),
    targets: (view, u) => {
      const noMove = view.cannotMove(u)
      return [u.slot - 1, u.slot + 1].filter((s) => s >= 1 && s <= BATTLE_SLOTS).map((slot) => {
        const why = moveBlock(view.battle, u, slot, noMove)
        return { target: { side: u.side, slot }, blocks: why ? [why] : [] }
      })
    },
    run: (run, u, target) => {
      if (target && 'slot' in target) run.move(u, target.slot)
    },
  })
}
