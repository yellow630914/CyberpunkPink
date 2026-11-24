// 開戰時做一次的技能效果（meat.on_start；黑市門路）：裝著的技能，在 battle.start 時由裝著的人做它的 on_start。
// 要「指定誰」的一律隨機（使用者 2026-11-23 定案）：效果清單裡先寫 { op: 'pick_random', key, from }（ops.ts），再用 who: 'pick:<key>' 落在他身上；沒有人可挑就跳過那一筆。

import type { BattleRun } from '../../core'
import { liveCols } from './column'
import { tierIn } from './unitdata'

/** 照戰場選欄（現實 meat、內海 net）：專屬構裝淺檔不算。 */
export function startOnStart(run: BattleRun): void {
  for (const u of Object.values(run.battle.units)) {
    if (u.out || u.slot < 1) continue
    for (const { ab, m } of liveCols(run, u)) {
      const list = m.on_start
      if (!list?.length) continue
      run.say(`${u.name}：${ab.name}（開戰）。`, 'skill', { unit: u.id, ability: ab.id, start: true }, u)
      run.effects(list, { user: u, target: null, source: { kind: 'ability', id: ab.id, name: ab.name }, n: { tier: tierIn(u, ab.path) } })
    }
  }
}
