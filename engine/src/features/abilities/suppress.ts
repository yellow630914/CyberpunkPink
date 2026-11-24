// 壓制（COMBAT_SYSTEM 第 5 節；M1b-skill-gunner-broker）：
// 技能自己的壓制（連射控制、火力牆：attack.suppress { dc, skill, area?, dc_bonus? }）——被打的人過定力檢定，失敗就被壓制；
// area: adjacent 讓目標相鄰一格上的人也各自檢定，row 是敵方整排（火力牆）；dc_bonus 加在每一個人的 DC 上。
// 姿態的壓制（壓制姿態：attack.suppress { auto, per_turn }）——開著時每回合前幾次射擊命中的目標直接被壓制，不必檢定。

import type { BattleRun, BattleUnit, SkillId } from '../../core'
import { onField, unitsOf } from '../../core'
import { colIn } from './column'
import type { AbilityEntry, SuppressDef } from './types'
import { OWNER } from './types'
import type { Kernel } from '../../core'

/** 被這一次壓制打到的人（目標在最前面，其餘照站位）。 */
function reach(run: BattleRun, target: BattleUnit, area: SuppressDef['area']): BattleUnit[] {
  const mates = unitsOf(run.battle, target.side).filter((t) => t.id !== target.id)
  const near = area === 'row' ? mates : area === 'adjacent' ? mates.filter((t) => Math.abs(t.slot - target.slot) === 1) : []
  return [target, ...near]
}

/**
 * 打完之後的壓制：每一個被打到的人各自過一次定力檢定（帶 resist:suppressed 標籤），失敗就被壓制。
 * 目標自己要還在場上才檢定（被這一擊打倒的不必）；範圍裡的其他人不看目標的死活。spent 是花掉的格數（DC 照它算）。
 */
export function suppressAfter(run: BattleRun, u: BattleUnit, target: BattleUnit, sup: SuppressDef, spent: number): void {
  const dc = (sup.dc === 'spent' ? 10 + spent * 2 : (sup.dc ?? 10)) + (sup.dc_bonus ?? 0)
  for (const t of reach(run, target, sup.area)) {
    if (t.out || !onField(t)) continue
    // 壓制的檢定帶 resist:suppressed 標籤：只對抵抗壓制加值的修正認得出它（dev/adr/0015 第二節）
    if (!run.save(t, 'resolve', (sup.skill ?? 'composure') as SkillId, dc, '定力', [], ['resist:suppressed']).ok) run.applyStatus(t, 'suppressed', { by: u })
  }
}

const autoKey = (ab: AbilityEntry): string => `turn:auto_suppress:${ab.id}`

export function registerSuppress(k: Kernel): void {
  // 壓制姿態：開著時，這個人每回合前幾次射擊命中的目標直接被壓制
  k.battle.on('attack.after', OWNER, ({ run, attacker, target, weapon, result }) => {
    if (!result.hit || run.isStandIn(attacker) || run.isStandIn(target) || target.out || !onField(target) || !attacker.stance) return
    if (weapon.traits.includes('melee')) return
    const ab = run.k.content.get<AbilityEntry>('ability', attacker.stance)
    const sup = (ab ? colIn(run, attacker, ab) : null)?.attack?.suppress
    if (!ab || !sup?.auto) return
    if (sup.first_round && run.battle.round !== 1) return
    if (sup.per_turn !== undefined && (attacker.uses[autoKey(ab)] ?? 0) >= sup.per_turn) return
    attacker.uses[autoKey(ab)] = (attacker.uses[autoKey(ab)] ?? 0) + 1
    run.say(`${attacker.name}：${ab.name}，${target.name}直接被壓制。`, 'skill', { unit: attacker.id, ability: ab.id, target: target.id }, attacker)
    run.applyStatus(target, 'suppressed', { by: attacker })
  })
}
