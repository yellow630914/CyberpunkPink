// L6 功能 deck：效果 deck_rental（{ deck: 甲板的 id | null, who? }）：給一副租來的甲板，或收回（deck 寫 null）。
// 潛艙店附的、迷宮館的比賽甲板用（M3-dive、M3-maze）。租來的蓋過自己的（state.ts 的 rawDeck）；只有內建的來源能給（ai: false）。

import type { Change, Effect, Kernel } from '../../core'

import type { DeckEntry } from './model'
import { DECK_KIND, OWNER, extOf, extValue, isText } from './model'

interface RentalEffect extends Effect {
  kind: 'deck_rental'
  deck: string | null
  who?: string
}

export function installEffects(k: Kernel): void {
  k.effects.register<RentalEffect>({
    kind: 'deck_rental', owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p: string[] = []
      if (raw.deck !== null && !(isText(raw.deck) && ctx.content.has(DECK_KIND, raw.deck))) p.push(`deck 要是甲板的 id（查得到的 ${DECK_KIND}），或 null（收回）`)
      if (raw.who !== undefined && !(isText(raw.who) && ctx.state.actors[raw.who])) p.push('who 要是現有角色的 id')
      if (raw.who === undefined && !ctx.state.actors[ctx.actor]) p.push(`沒有 ${ctx.actor} 這個角色`)
      for (const key of Object.keys(raw)) if (!['kind', 'deck', 'who', 'asked'].includes(key)) p.push(`${key} 不是這個效果的欄位`)
      return p
    },
    toChanges(e, ctx): Change[] {
      const actor = e.who ?? ctx.actor
      // 沒有租的東西可以收：不做事
      if (e.deck === null && !extOf(ctx.state, actor).rental) return []
      return [{ op: 'actor.ext', id: actor, key: 'deck', value: extValue(ctx.state, actor, { rental: e.deck === null ? null : { deck: e.deck } }) }]
    },
    describe(e, ctx) {
      return e.deck === null ? '收回了租來的甲板' : `租用甲板：${(ctx.content.get<DeckEntry>(DECK_KIND, e.deck) ?? { name: e.deck }).name}`
    },
  })
}
