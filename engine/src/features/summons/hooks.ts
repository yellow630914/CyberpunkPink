// L6 功能 summons：被動的修正與掛點。
//   修正  evade：護盾型讓同一格的人 +2；護航編隊（姿態）讓和無人機同一格的隊友加迴避（最多幾格受惠）
//         see_dark：和偵察型同一格的同一方的人，攻擊時不吃黑暗
//   掛點  attack.before：守著（drone.guard）的那一台替同一格的人擋下一次攻擊（opts.redirect）
//         turn.start：到操作者的下一個回合開始，守著結束
//         round.start：臨時放出來、有時限的（蜂群）到期自己收回
//         overlay.down：被擊落：這一場不能再放，操作者感載 +5（overlay_backlash 的修正加減；臨時機不灌）
// COMBAT_SYSTEM 9.1、2.5 節；dev/work/M1b-skill-pilot.md。

import type { BattleOverlay, BattleUnit, BattleView, Kernel } from '../../core'
import { onField } from '../../core'
import { BACKLASH, OWNER, heldBy, isDrone } from './drones'

/** 這個人（護航編隊開著的操作者）的哪幾格受惠：他的無人機掛的格，從前面數起最多 max 格。 */
function escortSlots(view: BattleView, holder: BattleUnit): number[] {
  const max = holder.uses['escort.max'] ?? 0
  if (!(holder.uses['escort.evade']! > 0) || holder.out) return []
  return heldBy(view, holder).filter(isDrone).map((o) => o.slot).slice(0, max)
}

/** 守著：同一方、同一格、守著還沒用掉的一台（沒被擊落）。 */
const guardian = (view: BattleView, target: BattleUnit): BattleOverlay | undefined =>
  view.battle.overlays.find((o) => !o.down && o.ext?.guard !== undefined && o.side === target.side && o.slot === target.slot)

export function registerHooks(k: Kernel): void {
  k.battle.modifier(OWNER, (q) => {
    if ((q.kind !== 'evade' && q.kind !== 'see_dark') || q.unit.slot < 1 || q.view.battle.units[q.unit.id] !== q.unit) return []
    const b = q.view.battle
    if (q.kind === 'see_dark') {
      // 偵察型：和它同一格的同一方的人
      const seen = b.overlays.some((o) => o.kind === 'scout' && !o.down && o.side === q.unit.side && o.slot === q.unit.slot)
      return seen ? [{ label: '偵察無人機', value: 1, source: 'overlay' }] : []
    }
    const out = []
    // 護盾型：同一格的人迴避 +2（COMBAT_SYSTEM 9.1 節）
    if (b.overlays.some((o) => o.kind === 'shield' && !o.down && o.side === q.unit.side && o.slot === q.unit.slot)) out.push({ label: '護盾無人機', value: 2, source: 'overlay' })
    // 護航編隊：每一台和隊友同一格的無人機讓那個隊友迴避加成，最多兩格
    for (const holder of Object.values(b.units)) {
      if (holder.side !== q.unit.side || !onField(holder)) continue
      const v = holder.uses['escort.evade'] ?? 0
      if (v && escortSlots(q.view, holder).includes(q.unit.slot)) out.push({ label: '護航編隊', value: v, source: 'overlay' })
    }
    return out
  })

  // 守著：下一次以同一格的人為目標的敵方攻擊改打那一台（打人的攻擊才算；掛著的東西被打、隊友誤傷不算）。已經有人設了 redirect 就不搶
  k.battle.on('attack.before', OWNER, ({ run, attacker, target, opts }) => {
    if (run.isStandIn(target) || target.slot < 1 || attacker.side === target.side || opts.redirect) return
    const o = guardian(run, target)
    if (o) opts.redirect = { overlay: o.id }
  })
  // 擋下之後守著就用掉了（不管是守著自己擋的，還是別的反應挑了它擋：這一台已經挨了一擊）。被取消的攻擊（卡彈）不發這個掛點，守著留著
  k.battle.on('attack.redirected', OWNER, ({ run, overlay, attacker, target }) => {
    if (overlay.ext?.guard === undefined) return
    const ext = { ...overlay.ext }
    delete ext.guard
    overlay.ext = ext
    run.say(`${overlay.name}替${target.name}擋下了這一擊。`, 'overlay', { overlay: overlay.id, kind: overlay.kind, slot: overlay.slot, guard: true, target: target.id }, attacker)
  })
  // 守著到操作者的下一個回合開始
  k.battle.on('turn.start', OWNER, ({ unit, run }) => {
    for (const o of run.battle.overlays) {
      if (o.owner === unit.id && o.ext?.guard === 'own_turn_start') {
        const ext = { ...o.ext }
        delete ext.guard
        o.ext = ext
      }
    }
  })

  // 臨時機到期：自己收回（不是被擊落：不發 overlay.down，操作者不受灌）；單位上的第 N 台回到手上
  k.battle.on('round.start', OWNER, ({ run, round }) => {
    for (const o of [...run.battle.overlays]) {
      const until = o.ext?.until
      if (typeof until !== 'number' || round <= until || o.down) continue
      run.battle.overlays = run.battle.overlays.filter((x) => x.id !== o.id)
      const owner = o.owner ? run.battle.units[o.owner] : undefined
      if (owner && typeof o.ext?.drone === 'number' && o.ext.drone >= 0) delete owner.uses[`drone:${o.ext.drone}`]
      run.say(`${o.name}的時限到了，自己收回。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, expired: true })
    }
  })

  // 被擊落：操作者感載 +5（加上 overlay_backlash 的修正，最少 0），這一場不能再放。沒有操作者的（敵方的、自律之後的）沒有人受灌
  k.battle.on('overlay.down', OWNER, ({ run, overlay, by }) => {
    if (!isDrone(overlay) || !overlay.owner) return
    const owner = run.battle.units[overlay.owner]
    if (!owner) return
    const idx = overlay.ext!.drone as number
    if (idx >= 0) owner.uses[`drone:${idx}`] = 2
    if (overlay.ext?.noBacklash) return
    const backlash = Math.max(0, BACKLASH + run.mods('overlay_backlash', owner, undefined, undefined, [overlay.kind]).reduce((n, p) => n + p.value, 0))
    if (!owner.out && owner.slot > 0 && backlash > 0) run.addLoad(owner, backlash, by, { exact: true, label: '無人機被擊落' })
  })
}
