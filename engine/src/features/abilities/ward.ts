// 守著一格（不准動喔；M1b-skill-gunner-broker）：效果 ward = { op: 'ward', slot: 'target', until, on: ['move', 'compact', 'attack'], do }。
// 守著敵方的一格：到期之前，站在那一格上的人第一次做 on 裡的事（自己換位、補位往前、攻擊）時，守著的人立刻做 do（通常是朝他射一槍：
// 不花行動點、照常花彈匣）；用過就沒了，一格只管第一次。守著的人退出、或是到期（預設到自己的下一回合開始）也失效。
// 記在守著的人身上（unit.ext.abilities.wards）。補位沒有自己的掛點：每次一個動作做完時看一遍，那一格原本的人還在場上、卻跑到比較前面的格，就是補位。

import type { BattleRun, BattleSide, BattleUnit, Kernel } from '../../core'
import { BattleBlocked, onField, unitAt } from '../../core'
import { heldGun } from './conditions'
import { OWNER } from './types'
import { dataOf, isRec } from './unitdata'

export const WARD_ON = ['move', 'compact', 'attack'] as const
export const WARD_UNTIL = ['own_turn_start', 'own_turn_end', 'battle_end'] as const
type WardOn = (typeof WARD_ON)[number]

export interface Ward {
  /** 同一個技能同一個人只守一格（再用一次是改守另一格） */
  id: string
  by: string
  side: BattleSide
  slot: number
  on: WardOn[]
  until: (typeof WARD_UNTIL)[number]
  do: Array<Record<string, unknown>>
  source: { kind: 'ability'; id: string; name: string }
  tier: number
  /** 現在站在那一格上的人（補位看他有沒有往前跑） */
  occ?: string
}

const wardsOf = (u: BattleUnit): Ward[] => {
  const d = u.ext.abilities
  return isRec(d) && Array.isArray(d.wards) ? (d.wards as Ward[]) : []
}
const setWards = (u: BattleUnit, list: Ward[]): void => {
  dataOf(u).wards = list
}

/** 場上每個人身上的守著（誰守的，哪一個）。 */
function allWards(run: BattleRun): Array<{ holder: BattleUnit; ward: Ward }> {
  return Object.values(run.battle.units).flatMap((holder) => wardsOf(holder).map((ward) => ({ holder, ward })))
}

const firing = new WeakSet<BattleRun>()

/** 觸發一個守著：先拿掉（一格只管第一次），守著的人做 do，目標是那個人。守著的人現在沒有可以開的槍就不算，繼續等。 */
function trigger(run: BattleRun, holder: BattleUnit, ward: Ward, victim: BattleUnit, how: WardOn): void {
  if (firing.has(run) || run.over || holder.out || !onField(holder) || victim.out) return
  if (ward.do.some((e) => e.op === 'attack' || e.op === 'strike')) {
    const gun = heldGun(holder)
    if (!gun || (gun.mag && gun.mag.now < 1)) return
  }
  setWards(holder, wardsOf(holder).filter((w) => w !== ward && w.id !== ward.id))
  const word = { move: '換位', compact: '補位', attack: '出手' }[how]
  run.say(`${holder.name}守著的第 ${ward.slot} 格：${victim.name}${word}了。`, 'skill', { unit: holder.id, ability: ward.source.id, target: victim.id, ward: how }, holder)
  firing.add(run)
  try {
    run.effects(ward.do, { user: holder, target: { unit: victim.id }, source: ward.source, n: { tier: ward.tier } })
  } finally {
    firing.delete(run)
  }
}

/** 補位：那一格原本的人還在場上，卻跑到比較前面的格去了。每次一個動作做完時看一遍；順便把「現在站在那一格的人」記新。 */
function scan(run: BattleRun): void {
  for (const { holder, ward } of allWards(run)) {
    if (run.over) return
    const now = unitAt(run.battle, ward.side, ward.slot)?.id
    const was = ward.occ !== undefined ? run.battle.units[ward.occ] : undefined
    const moved = was && was.id !== now && onField(was) && was.side === ward.side && was.slot < ward.slot
    ward.occ = now
    if (moved && ward.on.includes('compact')) trigger(run, holder, ward, was, 'compact')
  }
}

export function registerWard(k: Kernel): void {
  k.battle.effect('ward', OWNER, (ctx, e) => {
    const t = ctx.target
    if (!t || !('side' in t) || !('slot' in t)) throw new BattleBlocked(['要選敵方的一格。'])
    const on = (Array.isArray(e.on) ? e.on : [...WARD_ON]).filter((x): x is WardOn => (WARD_ON as readonly unknown[]).includes(x))
    const occ = unitAt(ctx.run.battle, t.side, t.slot)?.id
    const ward: Ward = {
      id: ctx.source.id, by: ctx.user.id, side: t.side, slot: t.slot, on,
      until: (typeof e.until === 'string' ? e.until : 'own_turn_start') as Ward['until'],
      do: structuredClone((e.do ?? []) as Array<Record<string, unknown>>), source: { kind: 'ability', id: ctx.source.id, name: ctx.source.name }, tier: ctx.n.tier ?? 1,
      ...(occ ? { occ } : {}),
    }
    setWards(ctx.user, [...wardsOf(ctx.user).filter((w) => w.id !== ward.id), ward])
    ctx.run.say(`${ctx.user.name}：守著${t.side === 'foe' ? '敵方' : '我方'}第 ${t.slot} 格。`, 'skill', { unit: ctx.user.id, ability: ctx.source.id, side: t.side, slot: t.slot }, ctx.user)
  }, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'slot', 'until', 'on', 'do'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：slot、until、on、do）`)
      if (e.slot !== 'target') p.push("slot：只能是 'target'（守著玩家選的那一格）")
      if (e.until !== undefined && !(WARD_UNTIL as readonly unknown[]).includes(e.until)) p.push(`until：「${String(e.until)}」不在清單裡（可以寫：${WARD_UNTIL.join('、')}）`)
      if (e.on !== undefined) {
        if (!Array.isArray(e.on) || e.on.length === 0) p.push(`on：要是至少一個，只能用 ${WARD_ON.join('、')}`)
        else for (const x of e.on) if (!(WARD_ON as readonly unknown[]).includes(x)) p.push(`on：「${String(x)}」不在清單裡（可以寫：${WARD_ON.join('、')}）`)
      }
      if (!Array.isArray(e.do) || e.do.length === 0) p.push('do：要是守著的人做的效果清單（例如 [{ op: "attack" }]）')
      else p.push(...k.battle.effectProblems(e.do).map((m) => `do：${m}`))
      return p
    },
  })

  // 自己換位：從守著的那一格離開
  k.battle.on('moved', OWNER, ({ run, unit, from, by }) => {
    if (run.isStandIn(unit)) return
    for (const { holder, ward } of allWards(run)) {
      if (ward.side === unit.side && ward.slot === from && by === 'action' && ward.on.includes('move')) trigger(run, holder, ward, unit, 'move')
      // 被推拉、被換位的人變了：記新（補位只看沒被動過的）
      else ward.occ = unitAt(run.battle, ward.side, ward.slot)?.id
    }
  })

  // 攻擊：站在守著那一格上的人出手之前
  k.battle.on('attack.before', OWNER, ({ run, attacker }) => {
    if (run.isStandIn(attacker) || !onField(attacker)) return
    for (const { holder, ward } of allWards(run)) {
      if (ward.side === attacker.side && ward.slot === attacker.slot && ward.on.includes('attack')) trigger(run, holder, ward, attacker, 'attack')
    }
  })

  // 到期；補位
  k.battle.on('turn.start', OWNER, ({ run, unit }) => {
    for (const { holder, ward } of allWards(run)) if (holder === unit && ward.until === 'own_turn_start') setWards(holder, wardsOf(holder).filter((w) => w !== ward))
    scan(run)
  })
  k.battle.on('turn.end', OWNER, ({ run, unit }) => {
    for (const { holder, ward } of allWards(run)) if (holder === unit && ward.until === 'own_turn_end') setWards(holder, wardsOf(holder).filter((w) => w !== ward))
    scan(run)
  })
  // 守著的人退出：他守的都失效
  k.battle.on('out', OWNER, ({ unit }) => {
    if (wardsOf(unit).length) setWards(unit, [])
  })
  k.battle.on('attack.after', OWNER, ({ run }) => scan(run))
  k.battle.on('action.done', OWNER, ({ run }) => scan(run))
  k.battle.on('round.start', OWNER, ({ run }) => scan(run))
}
