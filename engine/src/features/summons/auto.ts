// L6 功能 summons：沒有操作者的一台每一輪自己動（敵方的巡邏無人機與砲塔、操作者倒下之後自律的）。
// 在 round.start 由 hooks.ts 對每一台 auto、沒被擊落、沒被停住、沒被接管的叫一次。ENEMIES 第 10 節、COMBAT_SYSTEM 9.1 節；dev/work/M1b-enemy-units.md 第二節。
//
// 有武器的（敵方的、砲塔；操作者倒下之後自律的攻擊與干擾型照操作者的操縱算出一把）：用 run.overlayAttack 打一個敵人，目標用核心的 targetWeight 挑，
// 以它的替身當挑的人（距離、遮蔽、ai_target_pct 的修正都照核心）；自律（ext.orphan）的命中 −2 由 hooks.ts 的修正加上，不移動（這裡本來就沒有移動）。
// 沒有武器的照種類：偵察型標記一個敵人、醫療型急救同一格的人、護盾型守著同一格的人。

import type { BattleOverlay, BattleRun, BattleUnit, BattleWeapon } from '../../core'
import { otherSide, targetWeight, unitAt, unitsOf } from '../../core'
import { droneWeapon, guard, layerOf, shotType } from './drones'

/** 自律之後的攻擊、干擾型沒有自己的武器：照記在 ext.operator 的那位（已經倒下的）操作者的操縱算出一把。 */
function weaponOf(run: BattleRun, o: BattleOverlay): BattleWeapon | undefined {
  if (o.weapon) return o.weapon
  if (o.kind !== 'attack' && o.kind !== 'jammer') return undefined
  const operator = typeof o.ext?.operator === 'string' ? run.battle.units[o.ext.operator] : undefined
  return operator ? droneWeapon(operator, o, shotType(layerOf(run), o.kind)) : undefined
}

/** 挑一個敵人：核心的權重，用這一台的替身當挑的人（有 ai_target_pct 排除了所有人時當成沒有這個修正）。 */
function pickFoe(run: BattleRun, o: BattleOverlay, weapon: BattleWeapon | undefined): BattleUnit | undefined {
  const me = run.standIn(o)
  if (weapon && !me.weapons.length) me.weapons = [weapon]
  const foes = unitsOf(run.battle, otherSide(o.side))
  return run.pick(foes, (t) => targetWeight(run, me, t)) ?? run.pick(foes, (t) => targetWeight(run, me, t, { ignorePct: true })) ?? foes[0]
}

/** 這一台這一輪的動作；沒有事可做（沒有目標、同一格的人沒受傷）就什麼都不做。 */
export function autoAct(run: BattleRun, o: BattleOverlay): void {
  const weapon = weaponOf(run, o)
  const ids = { overlay: o.id, kind: o.kind, slot: o.slot }
  if (weapon) {
    const foe = pickFoe(run, o, weapon)
    if (foe) run.overlayAttack(o, foe, { weapon, spend: 0, label: '射擊', tags: ['drone'] })
  } else if (o.kind === 'scout') {
    const foe = pickFoe(run, o, undefined)
    if (!foe) return
    run.say(`${o.name}標記了${foe.name}。`, 'overlay', { ...ids, target: foe.id })
    run.applyStatus(foe, 'marked', { until: 'own_turn_end' })
  } else if (o.kind === 'medic') {
    const mate = unitAt(run.battle, o.side, o.slot)
    if (layerOf(run) === 'net') {
      // 內海的人沒有生命這一條：同樣的 2d6 排在感載上
      if (!mate?.load || mate.load.now <= 0) return
      run.say(`${o.name}替${mate.name}排掉感載。`, 'overlay', { ...ids, target: mate.id })
      run.vent(mate, run.d6(2))
    } else {
      if (!mate?.hp || mate.hp.now >= mate.hp.max) return
      run.say(`${o.name}替${mate.name}急救。`, 'overlay', { ...ids, target: mate.id })
      run.heal(mate, run.d6(2))
    }
    run.cleanse(mate, 'first_aid')
  } else if (o.kind === 'shield') {
    if (o.ext?.guard === undefined) guard(run, o, 'battle_end')
  } else return
  o.used = true
}

/** 這一輪被電磁打到停著：跳過、把停機拿掉，記一拍。回傳是不是停著。 */
export function skipIfStunned(run: BattleRun, o: BattleOverlay): boolean {
  if (o.ext?.stun === undefined) return false
  const ext = { ...o.ext }
  delete ext.stun
  o.ext = ext
  run.say(`${o.name}被電磁打到，這一輪停機，沒有動作。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, stunned: true })
  return true
}
