// 天使急救的會員（ENEMIES 第 5 節；dev/adr/0015 E11）：倒下時開始倒數（白銀 4、黃金 3、白金 2 回合；每一輪開頭數一次），
// 倒數到了記一拍、把他標成被帶走（unit.ext.enemies.taken = true）：不掉落、不能俘虜。小隊不進場。
// 「倒下」是被打倒、失去意識（down、burnout）；被制伏、投降、逃走的不算。倒數的時候他又回到場上（被救起來）就取消。

import type { BattleUnit, Kernel } from '../../core'
import { ANGEL_ROUNDS, OWNER } from './kinds'
import { enemyData, peekEnemy } from './unitdata'

const FELL = ['down', 'burnout']

export function registerAngel(k: Kernel): void {
  k.battle.on('out', OWNER, ({ run, unit, how }) => {
    // 天使急救只在現實
    if (run.mode.layer !== 'meat') return
    const n = ANGEL_ROUNDS[String(peekEnemy(unit).angel)]
    if (!n || !FELL.includes(how) || peekEnemy(unit).taken) return
    enemyData(unit).angelLeft = n
  })

  k.battle.on('round.start', OWNER, ({ run }) => {
    if (run.mode.layer !== 'meat') return
    for (const u of Object.values(run.battle.units)) {
      const d = peekEnemy(u)
      if (typeof d.angelLeft !== 'number') continue
      if (!u.out || !FELL.includes(u.out)) {
        delete enemyData(u).angelLeft
        continue
      }
      const left = d.angelLeft - 1
      if (left > 0) {
        enemyData(u).angelLeft = left
        continue
      }
      take(run, u)
    }
  })
}

function take(run: { say(text: string, tag?: string, data?: Record<string, unknown>, by?: BattleUnit): void }, u: BattleUnit): void {
  const d = enemyData(u)
  delete d.angelLeft
  d.taken = true
  run.say(`天使急救的小隊趕到，把${u.name}帶走了。`, 'angel', { unit: u.id, taken: true })
}
