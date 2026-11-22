// 開戰時做一次的技能效果（meat.on_start；黑市門路）：裝著的技能，在 battle.start 時由裝著的人做它的 on_start。
// 要指定誰（「你指定的一名隊友」）：開打前的指定放在 unit.ext.abilities.picks（來自角色的 actor.ext.abilities.preset.picks），
// 值是隊友的角色 id 或單位 id；效果裡寫 who: 'pick:<鍵>' 落在他身上，沒有指定就跳過那一筆。

import type { BattleRun, BattleUnit } from '../../core'
import { tierIn, equippedOf, isRec } from './unitdata'

/** 開打前的指定：鍵 → 單位 id（角色 id 換成他在這場戰鬥裡的單位）。 */
function picksOf(run: BattleRun, u: BattleUnit): Record<string, unknown> {
  const raw = isRec(u.ext.abilities) && isRec(u.ext.abilities.picks) ? u.ext.abilities.picks : {}
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue
    const mate = Object.values(run.battle.units).find((x) => x.side === u.side && (x.id === v || x.actor === v))
    if (mate) out[key] = mate.id
  }
  return out
}

export function startOnStart(run: BattleRun): void {
  if (run.battle.mode !== 'meat') return
  for (const u of Object.values(run.battle.units)) {
    if (u.out || u.slot < 1) continue
    for (const ab of equippedOf(run, u)) {
      const list = ab.meat?.on_start
      if (!ab.meat || ab.meat.pending || !list?.length) continue
      run.say(`${u.name}：${ab.name}（開戰）。`, 'skill', { unit: u.id, ability: ab.id, start: true }, u)
      run.effects(list, { user: u, target: null, source: { kind: 'ability', id: ab.id, name: ab.name }, pick: picksOf(run, u), n: { tier: tierIn(u, ab.path) } })
    }
  }
}
