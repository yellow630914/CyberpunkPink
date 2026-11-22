// L6 功能 combat：重創的部位與輕重兩級（COMBAT_SYSTEM 第 6 節）、戰後的紀錄與「要活的」的條件（8.5 節、第 7 節）。

import type { BattleUnit, Change, Kernel } from '../../core'
import { unitTag } from '../../core'

const OWNER = 'combat'
type Part = 'limb' | 'head' | 'torso' | 'bridge'
const PART_NAME: Record<Part, string> = { limb: '肢體', head: '頭', torso: '軀幹', bridge: '橋' }
const LIGHT: Record<Exclude<Part, 'bridge'>, string> = { limb: 'limb_hurt', head: 'dazed', torso: 'bleeding' }
const isPart = (p: unknown): p is Part => typeof p === 'string' && p in PART_NAME

export function registerWounds(k: Kernel): void {
  k.battle.on('wound', OWNER, ({ run, attacker, target, part: asked }) => {
    // 部位：瞄準過的射擊由攻擊者選；沒有就擲（各佔四分之一）
    let part: Part
    if (isPart(asked)) part = asked
    else {
      const r = run.rand()
      part = r < 0.25 ? 'limb' : r < 0.5 ? 'head' : r < 0.75 ? 'torso' : 'bridge'
    }
    const before = target.wounds[part] ?? 0
    const level = before === 0 ? 1 : target.side === 'ally' && run.state.rules.heavyWounds ? 2 : Math.max(1, before)
    const worsened = before === 1 && level === 2
    target.wounds[part] = level

    // 輕的效果每次都給
    if (part === 'bridge') run.addLoad(target, 10, attacker, { exact: true, label: '橋受創' })
    else run.applyStatus(target, LIGHT[part])

    // 重的那一級：從 1 變成 2 的那一次再加
    if (worsened) {
      if (part === 'limb') run.applyStatus(target, 'limb_hurt', { data: { hit: -4 } })
      else if (part === 'torso') {
        target.armor = 0
        if (target.hp) {
          target.hp.max = Math.max(1, target.hp.max - 5)
          target.hp.now = Math.min(target.hp.now, target.hp.max)
        }
      } else if (part === 'bridge') target.layersMax = Math.max(1, target.layersMax - 1)
      // 頭：義眼與甲板的損壞要等義體（M4）
    }
    run.say(`${unitTag(target)} 的${PART_NAME[part]}${level === 2 ? '受了重創' : '受創'}。`, 'wound', { target: target.id, part, level }, attacker)
  })

  // 戰後：重的傷勢寫進結果，留下角色身上的狀態（橋的那一級只影響這一場，不留）。治療與戰鬥外的效果是 M4
  k.battle.onEnd(OWNER, ({ state, battle, outcome }) => {
    const changes: Change[] = []
    const lines: string[] = []
    for (const u of Object.values(battle.units) as BattleUnit[]) {
      if (u.side !== 'ally' || !u.actor || !state.actors[u.actor]) continue
      for (const part of ['limb', 'head', 'torso'] as const) {
        if (u.wounds[part] !== 2) continue
        lines.push(`重傷：${u.name}的${PART_NAME[part]}（要治療）`)
        changes.push({ op: 'actor.condition', id: u.actor, condition: `wound_${part}` })
      }
    }
    // 「要活的」：贏了才算
    const want = battle.origin.capture ?? []
    if (want.length && outcome === 'win') {
      const alive = (id: string) => ['subdued', 'surrendered'].includes(battle.units[id]?.out ?? '')
      if (want.every(alive)) lines.push('要活的：達成')
      else {
        const lost = want.filter((id) => !alive(id)).map((id) => battle.units[id]?.name ?? id)
        lines.push(`要活的：沒有達成（${lost.join('、')}被打倒了）`)
      }
    }
    return { changes, lines }
  })
}
