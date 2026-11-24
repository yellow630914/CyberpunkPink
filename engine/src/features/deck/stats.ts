// L6 功能 deck：衍生數值。deck_grade、deck_slots、deck_firewall、deck_cooling 讀那一副甲板的資料（沒有甲板是 0）；deck_slots_reserved 基本 0
// （招牌能力的專屬構裝佔槽，由技能的功能加 provider，N33）；net_guard 是裝著的防護構裝裡最高的一件（N9）；
// ram_regen 基本 2；ram_max 與 ram_regen 再加甲板的 ram。技能的「主控 +2」「頻寬 +1」都是別的功能對這幾個數值加 provider。

import type { Kernel } from '../../core'
import type { ConstructEntry } from './model'
import { CONSTRUCT_KIND, OWNER, deckRules } from './model'
import { deckOf, rawDeck } from './state'

export function installStats(k: Kernel): void {
  const fromDeck = (key: 'grade' | 'slots' | 'firewall') => (state: Parameters<typeof rawDeck>[1], actor: string): number => rawDeck(k, state, actor)?.entry[key] ?? 0
  k.stats.defineStat({ id: 'deck_grade', owner: OWNER, name: '甲板等級', base: (state, actor) => fromDeck('grade')(state, actor) })
  k.stats.defineStat({ id: 'deck_slots', owner: OWNER, name: '構裝槽', base: (state, actor) => fromDeck('slots')(state, actor) })
  k.stats.defineStat({ id: 'deck_firewall', owner: OWNER, name: '防火牆', base: (state, actor) => fromDeck('firewall')(state, actor) })
  // 冷卻：潛入時每個探索回合感載多消退幾點（甲板的 cooling；netrun 的探索回合讀它，不 import deck）
  k.stats.defineStat({ id: 'deck_cooling', owner: OWNER, name: '甲板的冷卻', base: (state, actor) => rawDeck(k, state, actor)?.entry.cooling ?? 0 })
  k.stats.defineStat({ id: 'deck_slots_reserved', owner: OWNER, name: '被專屬構裝佔掉的槽', base: () => 0 })
  k.stats.defineStat({
    id: 'net_guard', owner: OWNER, name: '防護（內海）',
    base(state, actor) {
      let best = 0
      for (const p of deckOf(k, state, actor).equipped) {
        if (p.kind === 'construct' && p.class === 'defense') best = Math.max(best, k.content.get<ConstructEntry>(CONSTRUCT_KIND, p.id)?.guard ?? 0)
      }
      return best
    },
  })
  k.stats.defineStat({ id: 'ram_regen', owner: OWNER, name: 'RAM 每回合回復', base: () => deckRules(k).ram_regen })

  // 甲板的 RAM 加值（NETRUNNING 第 1 節）：沒有甲板時沒有 RAM（戰鬥的單位在 unit.ready 拿掉那一池）
  for (const key of ['max', 'regen'] as const) {
    k.stats.addStatProvider(key === 'max' ? 'ram_max' : 'ram_regen', OWNER, (state, actor) => {
      const raw = rawDeck(k, state, actor)
      const v = raw?.entry.ram?.[key]
      return raw && typeof v === 'number' && v !== 0 ? [{ label: raw.entry.name, value: v, source: 'deck' }] : []
    })
  }
}
