// L6 功能 tuning 的被動效果與場景的身體（來源 tuning；dev/adr/0019 第二節與 P65；dev/work/M4-tuning.md 第 3、4 點）。
// 裝著的每一個調校給 effects 的每一筆（label 預設是調校的名字）。requires 不成立（裝不穩）的：正的那幾筆不算、負的照算。
// flags 各自接到現有的地方：
//   no_full_sync   一筆 { stat: 'sync_cap_max', amount: -1 }（核心的衍生數值「最高檔」：最高到深檔，不再借 sync_cap_bonus 的 −1；負的，裝不穩也算；M4-core-gaps 第 10 項）
//   no_load_decay  戰鬥的修正 decay（battle.ts，只在現實的戰場）
//   sink_weekly    每週一沉溺 +1（weekly.ts）
//   sink_resist、afterglow_double   各給一筆 { unit_tag }（核心的標籤 SINK_RESIST、AFTERGLOW_DOUBLE：戰鬥與 sink 效果讀；正的，裝不穩不算；M4-core-gaps 第 8、13 項）
//   hp_to_load     戰鬥的掛點 damage.hp（battle.ts：兩成生命傷害換成感載；M4-core-gaps 第 11 項）
// 只讀 actor.ext.tuning、調校的內容與條件（has_bridge、tendency_axis、tendency_tag），不讀任何衍生數值。
// 沒有橋的人什麼都不給（調校槽在橋上）。

import type { ActorId, GameState, Kernel, PassiveEffect } from '../../core'
import { AFTERGLOW_DOUBLE, SINK_RESIST, SYNC_CAP_MAX_STAT, isRecord } from '../../core'
import type { TuningEntry, TuningFlag } from './model'
import { NEGATIVE_FLAGS, entryOf, hasBridge, installedIds, isPositiveEffect, readExt, stableOf, tuningRules } from './model'

/** 這個人現在裝著、而且查得到內容的調校（槽的順序），附上裝得穩不穩。沒有橋是空的。 */
export function installedEntries(k: Kernel, state: GameState, actor: ActorId): Array<{ entry: TuningEntry; stable: boolean }> {
  if (!hasBridge(k, state, actor)) return []
  const out: Array<{ entry: TuningEntry; stable: boolean }> = []
  for (const id of installedIds(readExt(state, actor, tuningRules(k).slots))) {
    const entry = entryOf(k, id)
    if (entry) out.push({ entry, stable: stableOf(k, state, actor, entry) })
  }
  return out
}

/** 現在生效的開關：負的永遠算，正的要裝得穩才算。 */
export function activeFlags(k: Kernel, state: GameState, actor: ActorId): Set<TuningFlag> {
  const out = new Set<TuningFlag>()
  for (const { entry, stable } of installedEntries(k, state, actor)) {
    for (const f of entry.flags ?? []) if (stable || NEGATIVE_FLAGS.includes(f)) out.add(f)
  }
  return out
}

export function tuningPassives(k: Kernel, state: GameState, actor: ActorId): PassiveEffect[] {
  const out: PassiveEffect[] = []
  for (const { entry, stable } of installedEntries(k, state, actor)) {
    for (const e of entry.effects ?? []) {
      if (!isRecord(e)) continue
      if (!stable && isPositiveEffect(e as PassiveEffect)) continue
      out.push({ label: entry.name, ...(e as PassiveEffect) })
    }
    if (entry.flags?.includes('no_full_sync')) out.push({ stat: SYNC_CAP_MAX_STAT, amount: -1, label: entry.name })
    // 正面的開關：裝得穩才給（和 activeFlags 同一個規矩）
    if (stable && entry.flags?.includes('sink_resist')) out.push({ unit_tag: SINK_RESIST, label: entry.name })
    if (stable && entry.flags?.includes('afterglow_double')) out.push({ unit_tag: AFTERGLOW_DOUBLE, label: entry.name })
  }
  return out
}

/** 場景問身體的回答：裝著的調校的 scene.sensitivity（只在現實層；內海用的是化身）。 */
export function tuningBody(k: Kernel, state: GameState, actor: ActorId, layer: string): { sensitivity: Record<string, number> } | undefined {
  if (layer !== 'meat') return undefined
  const sens: Record<string, number> = {}
  for (const { entry } of installedEntries(k, state, actor)) {
    const s = entry.scene?.sensitivity
    if (!isRecord(s)) continue
    for (const [part, n] of Object.entries(s)) if (typeof n === 'number' && Number.isFinite(n) && n !== 0) sens[part] = (sens[part] ?? 0) + n
  }
  return Object.keys(sens).length > 0 ? { sensitivity: sens } : undefined
}
