// L6 裝備的被動效果（來源 gear；dev/adr/0019 第二節；使用者 2026-11-26：gear 把穿戴物的 effects 交給被動效果來源）。
// 身上穿著的每一件護甲與服裝（設計圖的 effects、裝著的零件的 effects）和戴著的飾品（物品的 effects）一直生效；
// 拿下來、不在身上的不算。超重的加減（weight.ts 的 weightPassives）同一個來源，登記時併在一起。
// 不給的：攜帶格的武器（不是穿戴物）、成品帶著的怪癖（怪癖在武器與護甲上沒有 effects 的讀法；載入時有警告）。
// 每回合回復（ap_regen、ram_regen）的內容只能寫戰鬥的修正 { mod }，來源 gear 在 TEMPO_SOURCES 裡，全身的正值合計最多 +1（載入時 passiveProblems 擋 { stat }）。
// 「隨身錄影機」這類東西（MEDIA 1.1）要不要開是 M5 的事；這裡只讓寫在裝備上的效果生效。

import type { ActorId, GameState, ItemEntry, Kernel, PassiveEffect } from '../../core'
import { isRecord } from '../../core'
import { gearOf, productOfStack, wornPieces } from './model'

const effectsOf = (raw: unknown, label: string): PassiveEffect[] =>
  Array.isArray(raw) ? raw.filter((e): e is PassiveEffect => isRecord(e)).map((e) => ({ label, ...e }) as PassiveEffect) : []

/** 身上穿著與戴著的東西給的被動效果（來源 gear）：穿著的護甲與服裝（設計圖＋零件）、戴著的飾品。 */
export function wornPassives(k: Kernel, state: GameState, actor: ActorId): PassiveEffect[] {
  if (!state.actors[actor]?.ext.gear) return []
  const gear = gearOf(state, actor)
  const out: PassiveEffect[] = []
  for (const p of wornPieces(k, state, gear)) {
    out.push(...effectsOf(p.bp.effects, p.bp.name))
    const info = productOfStack(k, p.stack)
    if (info) for (const { part } of info.parts) out.push(...effectsOf(part.effects, part.name))
  }
  for (const id of Object.values(gear.acc)) {
    const item = typeof id === 'string' ? k.content.get<ItemEntry>('item', id) : undefined
    if (item) out.push(...effectsOf(item.effects, item.name))
  }
  return out
}
