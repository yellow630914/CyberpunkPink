// L6 功能 combat：重創的部位與輕重兩級（COMBAT_SYSTEM 第 6 節）、戰後的紀錄與「要活的」的條件（8.5 節、第 7 節）。

import type { BattleUnit, Change, Kernel } from '../../core'
import { clamp, unitTag } from '../../core'

const OWNER = 'combat'
export type Part = 'limb' | 'head' | 'torso' | 'bridge'
export const PART_NAME: Record<Part, string> = { limb: '肢體', head: '頭', torso: '軀幹', bridge: '橋' }
/** 輕的那一級是哪個狀態（橋的輕傷是感載 +10，沒有狀態） */
export const LIGHT: Record<Exclude<Part, 'bridge'>, string> = { limb: 'limb_hurt', head: 'dazed', torso: 'bleeding' }
export const isPart = (p: unknown): p is Part => typeof p === 'string' && p in PART_NAME
/** 軀幹的重創讓生命值上限少多少（COMBAT_SYSTEM 第 6 節）；治療時加回來 */
export const TORSO_HP_LOSS = 5

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
    const heavyOk = target.side === 'ally' && run.state.rules.heavyWounds
    let level = before === 0 ? 1 : heavyOk ? 2 : Math.max(1, before)
    // 重創的級數加減（修正 wound_grade，問的是被打的人）：−1 把重的改成輕的；不能比輕的更輕，沒有重的那一級（敵人、存檔規則關掉）時不能更重
    level = clamp(level + run.mods('wound_grade', target, attacker).reduce((s, p) => s + p.value, 0), 1, heavyOk ? 2 : 1)
    const worsened = level === 2 && before < 2
    target.wounds[part] = level

    // 輕的效果每次都給
    if (part === 'bridge') run.addLoad(target, 10, attacker, { exact: true, label: '橋受創' })
    else run.applyStatus(target, LIGHT[part])

    // 重的那一級：從 1 變成 2 的那一次再加
    if (worsened) {
      if (part === 'limb') run.applyStatus(target, 'limb_hurt', { data: { hit: -4 } })
      else if (part === 'torso') {
        // 身上那件護甲失效（COMBAT_SYSTEM 第 6 節）：頭盔與義體的板材不受影響。裝備的功能給 armor_body（身上那一件的份）；
        // 沒有角色或沒有人註冊它的單位（沒有分來源的資料），整個護甲都當成身上那一件
        const body = target.actor && run.state.actors[target.actor] && run.k.stats.hasStat('armor_body') ? run.k.stats.stat(run.state, target.actor, 'armor_body') : target.armor
        target.armor = Math.max(0, target.armor - body)
        if (target.hp) {
          target.hp.max = Math.max(1, target.hp.max - TORSO_HP_LOSS)
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
