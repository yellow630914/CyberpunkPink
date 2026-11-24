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

interface ScriptUseEffect extends Effect {
  kind: 'deck_script_use'
  item: string
  qty?: number
  who?: string
}

export function installEffects(k: Kernel): void {
  // 帶著的腳本少了幾支（M3 審查應修 8：別的功能不直接改寫 actor.ext.deck；背包的那一份由用的人自己扣）。
  // 例：後門鑰匙在內海探索中用掉了，背包扣一件，帶著的腳本從這裡扣，格式與上限由 deck 自己守
  k.effects.register<ScriptUseEffect>({
    kind: 'deck_script_use', owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p: string[] = []
      if (!isText(raw.item)) p.push('item 要是物品的 id')
      if (raw.qty !== undefined && !(Number.isInteger(raw.qty) && (raw.qty as number) >= 1)) p.push('qty 要是 1 以上的整數')
      if (raw.who !== undefined && !(isText(raw.who) && ctx.state.actors[raw.who])) p.push('who 要是現有角色的 id')
      if (raw.who === undefined && !ctx.state.actors[ctx.actor]) p.push(`沒有 ${ctx.actor} 這個角色`)
      for (const key of Object.keys(raw)) if (!['kind', 'item', 'qty', 'who', 'asked'].includes(key)) p.push(`${key} 不是這個效果的欄位`)
      return p
    },
    toChanges(e, ctx): Change[] {
      const actor = e.who ?? ctx.actor
      let left = e.qty ?? 1
      const scripts = extOf(ctx.state, actor).scripts.map((s) => ({ ...s }))
      for (const s of scripts) {
        if (s.item !== e.item || left <= 0) continue
        const cut = Math.min(left, s.qty)
        s.qty -= cut
        left -= cut
      }
      // 帶著的裡沒有這一項、或本來就不夠：不做事
      if (left === (e.qty ?? 1)) return []
      return [{ op: 'actor.ext', id: actor, key: 'deck', value: extValue(ctx.state, actor, { scripts: scripts.filter((s) => s.qty > 0) }) }]
    },
    describe: (e) => `用掉帶著的腳本：${e.item} ×${e.qty ?? 1}`,
  })

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
