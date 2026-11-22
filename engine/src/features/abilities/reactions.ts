// 反應：條件成立時自動觸發（SKILLS 1.2 節）。規格：dev/work/M1b-skill-format.md 第四節。
// 兩種寫法並存：舊的 meat.trigger 字串（掩護射擊、小心後面！：隊友被攻擊、擲命中之前），和新的 { on, who, if? }。
// 觸發時：先扣消耗（行動點用反應的人手上剩的，不夠就不觸發）、記次數、記一拍，再做 react（改這一擊／這次檢定／這次退出）與 do（效果清單）。
// 帶 reaction 標籤的攻擊、以及反應自己的效果裡做出來的攻擊，都不再觸發反應。

import type { AttackOpts, AttackResult, BattleRun, BattleUnit, BattleWeapon, Kernel } from '../../core'
import { amount, LOSE_TURN, isWounded, onField, unitsOf } from '../../core'
import { heldGun, whenBlocks } from './conditions'
import { bumpUses, costOf, usageBlocks } from './use'
import type { AbilityEntry, ReactDef, TriggerDef } from './types'
import { OWNER } from './types'
import { equippedOf, isRec, tierIn } from './unitdata'

/** 正在做某個反應的效果：這段時間裡發生的攻擊不再觸發反應。 */
const reacting = new WeakSet<BattleRun>()
export const inReaction = (run: BattleRun): boolean => reacting.has(run)

interface Event {
  /** 遇到這件事的人：被打的、過載的、被擲檢定的、要退出的 */
  subject: BattleUnit
  /** 對他做這件事的人：攻擊的人、讓他過載的人、擲檢定的人、讓他退出的人 */
  by?: BattleUnit
  opts?: AttackOpts
  roll?: { wound: boolean }
  out?: { negate?: boolean; wound?: boolean; prevent?: boolean }
  how?: string
  tags?: string[]
  check?: { dc: number; bonus: number }
  result?: AttackResult
  weapon?: BattleWeapon
}

const sideMates = (run: BattleRun, a: BattleUnit): BattleUnit[] => unitsOf(run.battle, a.side)

/** 這個人的一台（沒被擊落的），掛在 subject 同一格或相鄰一格；同一格的優先。 */
function overlayFor(run: BattleRun, holder: BattleUnit, subject: BattleUnit) {
  const mine = run.battle.overlays.filter((o) => !o.down && o.owner === holder.id && o.side === holder.side && Math.abs(o.slot - subject.slot) <= 1)
  return mine.sort((a, b) => Math.abs(a.slot - subject.slot) - Math.abs(b.slot - subject.slot))[0]
}

function whoMatches(run: BattleRun, holder: BattleUnit, who: string, e: Event): boolean {
  const s = e.subject
  const mate = s.side === holder.side
  switch (who) {
    case 'self': return s === holder
    case 'adjacent': return mate && s !== holder && onField(s) && Math.abs(s.slot - holder.slot) === 1
    case 'ally': return mate && s !== holder
    case 'near': return mate && onField(s) && Math.abs(s.slot - holder.slot) <= 1
    case 'foe_by_self': return !mate && e.by === holder
    case 'own_overlay': {
      // 被打的是自己的無人機（替身），或是自己有一台掛在他同一格或相鄰一格的隊友
      if (run.isStandIn(s)) return run.overlayOfStandIn(s)?.owner === holder.id
      return mate && onField(s) && !!overlayFor(run, holder, s)
    }
    default: return false
  }
}

function ifHolds(cond: string | undefined, on: string, e: Event): boolean {
  if (cond === undefined) return true
  if (on === 'hit') return cond === 'wound' && !!e.roll?.wound
  if (on === 'after') {
    switch (cond) {
      case 'miss': return e.result?.hit === false
      case 'hit': return e.result?.hit === true
      case 'melee': return !!e.weapon?.traits.includes('melee')
      case 'bridged': return !!e.subject.load
    }
    return false
  }
  if (on === 'checked') return !!e.tags?.includes(cond)
  return true
}

/** 數字或公式（不擲骰）。 */
function num(run: BattleRun, holder: BattleUnit, ab: AbilityEntry, v: number | string | undefined): number {
  if (v === undefined) return 0
  return typeof v === 'number' ? v : Math.round(amount({ run, user: holder, n: { tier: tierIn(holder, ab.path) } }, v))
}

/** 一個反應成立之後的事（改這一擊、這次檢定、這次退出）。 */
function applyReact(run: BattleRun, holder: BattleUnit, ab: AbilityEntry, on: string, r: ReactDef | undefined, e: Event): void {
  if (!r) return
  if (on === 'attacked' && e.opts) {
    if (r.evade !== undefined) e.opts.evade = (e.opts.evade ?? 0) + num(run, holder, ab, r.evade)
    if (r.hit !== undefined) e.opts.hit = (e.opts.hit ?? 0) + num(run, holder, ab, r.hit)
    if (r.no_wound) e.opts.noWound = true
    if (r.redirect === 'overlay') {
      const o = overlayFor(run, holder, e.subject)
      if (o) e.opts.redirect = { overlay: o.id }
    }
  } else if (on === 'hit' && e.out) {
    if (r.negate) e.out.negate = true
    if (r.no_wound) e.out.wound = false
  } else if (on === 'overload') {
    if (r.keep_turn) run.removeStatus(e.subject, LOSE_TURN, true)
  } else if (on === 'checked' && e.check) {
    if (r.dc !== undefined) e.check.dc += num(run, holder, ab, r.dc)
  } else if (on === 'out_before' && e.out && r.prevent) e.out.prevent = true
}

/** 這個反應現在有沒有東西可做（沒有就不觸發、不扣消耗）。 */
function hasWork(run: BattleRun, holder: BattleUnit, on: string, r: ReactDef | undefined, e: Event): boolean {
  if (!r) return true
  if (r.redirect === 'overlay' && !overlayFor(run, holder, e.subject)) return false
  if (r.prevent && !(e.how && r.prevent.how.includes(e.how))) return false
  if (on === 'out_before' && e.out?.prevent) return false
  return true
}

/** 對一件事，每個裝著對應反應的人各問一次。 */
function fire(run: BattleRun, on: TriggerDef['on'], e: Event): void {
  if (reacting.has(run) || run.over) return
  if (e.opts?.tags?.includes('reaction')) return
  // 攻擊類的事只對敵人的攻擊（隊友誤傷不算）
  if ((on === 'attacked' || on === 'hit' || on === 'after') && e.by && e.by.side === e.subject.side) return
  for (const holder of [...unitsOf(run.battle, 'ally'), ...unitsOf(run.battle, 'foe')]) {
    if (!onField(holder)) continue
    for (const ab of equippedOf(run, holder)) {
      const m = ab.meat
      const t = m?.trigger
      if (!m || m.pending || !isRec(t) || (t as TriggerDef).on !== on) continue
      const trig = t as TriggerDef
      if (!whoMatches(run, holder, trig.who, e) || !ifHolds(trig.if, on, e)) continue
      if (whenBlocks(run, holder, m.when).length) continue
      if (!hasWork(run, holder, on, m.react, e)) continue
      if (usageBlocks(run, holder, ab).length) continue
      const cost = costOf(run, holder, ab)
      if (!run.canAfford(holder, cost)) continue
      run.spend(holder, cost)
      bumpUses(holder, ab)
      run.say(`${holder.name}：${ab.name}。`, 'skill', { unit: holder.id, ability: ab.id, ally: e.subject.id }, holder)
      applyReact(run, holder, ab, on, m.react, e)
      if (m.do?.length) {
        reacting.add(run)
        try {
          const standIn = run.isStandIn(e.subject)
          run.effects(m.do, {
            user: holder, target: standIn ? { overlay: e.subject.id } : { unit: e.subject.id }, source: { kind: 'ability', id: ab.id, name: ab.name },
            n: { tier: tierIn(holder, ab.path) }, ...(e.by ? { attacker: e.by } : {}), victim: e.subject,
          })
        } finally {
          reacting.delete(run)
        }
      }
      if (run.over || e.by?.out || e.subject.out) return
    }
  }
}

// ---- 舊的寫法：掩護射擊、小心後面！ ----

/** 隊友被攻擊、擲命中之前（SKILL_TREES：掩護射擊、小心後面！）。 */
function legacy(run: BattleRun, attacker: BattleUnit, target: BattleUnit, opts: AttackOpts): void {
  if (opts.tags?.includes('reaction') || attacker.side === target.side || reacting.has(run)) return
  for (const mate of sideMates(run, target)) {
    if (mate.id === target.id) continue
    for (const ab of equippedOf(run, mate)) {
      const m = ab.meat
      if (typeof m?.trigger !== 'string') continue
      if (attacker.out || target.out || run.over) return
      if (m.trigger === 'ally_attacked_adjacent' && Math.abs(mate.slot - target.slot) !== 1) continue
      if (usageBlocks(run, mate, ab).length) continue
      const cost = costOf(run, mate, ab)
      if (!run.canAfford(mate, cost)) continue
      if (m.attack) {
        const w = heldGun(mate)
        if (!w || (w.mag && w.mag.now < 1)) continue
      }
      run.spend(mate, cost)
      bumpUses(mate, ab)
      run.say(`${mate.name}：${ab.name}。`, 'skill', { unit: mate.id, ability: ab.id, ally: target.id }, mate)
      if (m.evade) opts.evade = (opts.evade ?? 0) + m.evade
      if (m.attack) {
        const r = run.attack(mate, attacker, { label: ab.name, tags: ['reaction'] })
        if (r.hit && m.on_hit?.hit_against_ally) opts.hit = (opts.hit ?? 0) + m.on_hit.hit_against_ally
      }
    }
  }
}

// ---- 第一次低於一半生命 ----

/** 看一遍：還沒標過、而且生命低於一半的人，標上「已經低於一半過」，再問 hp_half 的反應。 */
function scanHalf(run: BattleRun): void {
  for (const u of Object.values(run.battle.units)) {
    if (!u.hp || u.out || !onField(u) || u.uses.hp_half || !isWounded(u)) continue
    u.uses.hp_half = 1
    fire(run, 'hp_half', { subject: u })
  }
}

export function registerReactions(k: Kernel): void {
  k.battle.on('attack.before', OWNER, ({ run, attacker, target, opts }) => {
    legacy(run, attacker, target, opts)
    fire(run, 'attacked', { subject: target, by: attacker, opts })
  })
  k.battle.on('attack.hit', OWNER, ({ run, attacker, target, opts, roll, out }) => fire(run, 'hit', { subject: target, by: attacker, opts, roll, out }))
  k.battle.on('attack.after', OWNER, ({ run, attacker, target, weapon, opts, result }) => {
    fire(run, 'after', { subject: target, by: attacker, opts, result, weapon })
    scanHalf(run)
  })
  k.battle.on('overload', OWNER, ({ run, unit, by }) => fire(run, 'overload', { subject: unit, ...(by ? { by } : {}) }))
  k.battle.on('check.before', OWNER, ({ run, unit, other, tags, opts }) => fire(run, 'checked', { subject: unit, by: other, tags, check: opts }))
  k.battle.on('out.before', OWNER, ({ run, unit, how, by, out }) => fire(run, 'out_before', { subject: unit, ...(by ? { by } : {}), how, out }))
  // 低於一半生命沒有自己的掛點（流血、燃燒、效果都會扣）：在這幾個地方看一遍
  k.battle.on('action.done', OWNER, ({ run }) => scanHalf(run))
  k.battle.on('turn.start', OWNER, ({ run }) => scanHalf(run))
  k.battle.on('turn.end', OWNER, ({ run }) => scanHalf(run))
  k.battle.on('round.start', OWNER, ({ run }) => scanHalf(run))
}
