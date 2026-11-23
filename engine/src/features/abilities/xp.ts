// 歷練點的效果 xp（CORE_RULES 7.1 節）：委託副本的結算用這個名字發（{ kind: 'xp', amount }，amount 是一份的量）。
// 主角與每個一起出門的夥伴各拿一份（數量相同）；留在家的夥伴拿三成（四捨五入），免得沒帶出門的人越差越多。歷練點記在每個人自己的 actor.ext.abilities.xp
// （夥伴的歷練點由玩家替他花）。
//
// 誰是夥伴：不 import 名冊、也不讀它的 state.ext，只問核心的 party 與條件：
// - 一起出門：核心的 party（不含主角自己）裡的人；名冊的同行（條件 in_tagalong，名冊註冊了才算；還沒有就沒有同行的人）。
// - 留在家：條件 in_roster 成立（名冊上的人）、又不在上面的人。沒有人註冊 in_roster 就沒有留在家的夥伴。
// AI 給的一件事最多 10 點（CORE_RULES 7.1 節：事件 0～10）。

import type { ActorId, Change, Effect, GameState, Kernel } from '../../core'
import { isSafeInt } from '../../core'
import { abilitiesOf } from './learn'
import { abilityRules } from './loadout'
import { OWNER } from './types'

export const XP_EFFECT = 'xp'
/** AI 給的一件事最多幾點歷練點（CORE_RULES 7.1 節：事件 0～10）。 */
export const XP_AI_CAP = 10

export interface XpShare {
  id: ActorId
  share: number
  /** self 主角；along 一起出門的夥伴；home 留在家的夥伴 */
  who: 'self' | 'along' | 'home'
}

type XpKernel = Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules'>

/** 這一筆歷練點每個人拿多少：主角與一起出門的夥伴各 amount，留在家的夥伴 round(amount × xp_home_share)。 */
export function xpShares(k: XpKernel, state: GameState, who: ActorId, amount: number): XpShare[] {
  const out: XpShare[] = [{ id: who, share: amount, who: 'self' }]
  const kinds = new Set(k.conditions.kinds())
  const ctx = (actor: ActorId) => ({ state, actor, stats: k.stats, timeRules: k.timeRules })
  const home = Math.round(amount * abilityRules(k).xp_home_share)
  for (const id of Object.keys(state.actors)) {
    if (id === who) continue
    if (state.party.includes(id) || (kinds.has('in_tagalong') && k.conditions.test({ kind: 'in_tagalong', who: id }, ctx(id)))) out.push({ id, share: amount, who: 'along' })
    else if (kinds.has('in_roster') && k.conditions.test({ kind: 'in_roster', who: id }, ctx(id))) out.push({ id, share: home, who: 'home' })
  }
  return out
}

interface XpEffect extends Effect { amount: number }

export function registerXp(k: Kernel): void {
  k.effects.register<XpEffect>({
    kind: XP_EFFECT, owner: OWNER,
    validate: (raw) => (isSafeInt(raw.amount) && raw.amount >= 0 ? [] : ['amount 要是 0 以上的整數（一份歷練點）']),
    budget(e, ctx) {
      if (ctx.level !== 'cap' || e.amount === 0) return null
      return { group: 'xp', amount: e.amount, min: -Infinity, max: XP_AI_CAP, resize: (to) => ({ ...e, amount: to }), notice: () => `一件事最多給 ${XP_AI_CAP} 點歷練點，多的沒有算。` }
    },
    toChanges(e, ctx): Change[] {
      if (e.amount === 0) return []
      return xpShares(k, ctx.state, ctx.actor, e.amount)
        .filter((s) => s.share > 0 && ctx.state.actors[s.id])
        .map((s) => ({ op: 'actor.ext', id: s.id, key: 'abilities', value: { ...abilitiesOf(ctx.state, s.id), xp: abilitiesOf(ctx.state, s.id).xp + s.share } }))
    },
    describe(e, ctx) {
      const name = (id: ActorId): string => ctx.state.actors[id]?.name ?? id
      const rest = xpShares(k, ctx.state, ctx.actor, e.amount).filter((s) => s.who !== 'self' && s.share > 0 && ctx.state.actors[s.id])
      const tail = rest.map((s) => `${name(s.id)}${s.who === 'home' ? '（留在家）' : ''} +${s.share}`)
      return `歷練點 +${e.amount}${tail.length ? `；${tail.join('、')}` : ''}`
    },
  })
}
