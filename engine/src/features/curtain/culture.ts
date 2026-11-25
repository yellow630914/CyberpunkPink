// L6 功能 curtain 的敵人的文化（CYBERSPACE 8.8 節「敵人的文化」開頭三條；dev/adr/0019 P58）。
//
// 每場遭遇擲一次文化：這一夜的文化 culture_own（60%），其餘平均分給別的夜的文化；一場遭遇的敵人全來自擲到的那一種。館主（守閘門的那一場）不擲，永遠是這一夜的。
// 敵人從資料裡挑：enemies 的單位來源 enemy_pick 收 culture（enemy 的 culture 標籤、位階、等級範圍含這一級，沒有就最近的）；沒有那種文化的敵人資料時用這一夜的（P58）。
// 遭遇是 netrun 放的（開戰與潛行繞過都是它的）：生成的時候問掛點 netrun.foe_ref，這個功能回答這一場的文化與等級（foeRefExtra）。

import type { GameState, Kernel, Origin, UnitRef } from '../../core'
import { deriveRng, isRecord } from '../../core'
import type { CurtainRules, NightEntry, TierDef } from './model'
import { NIGHT_KIND, ORIGIN_BY, allNights, curtainRules, isInt, isText, tierOf } from './model'
import { nightOff } from './nights'

type Cx = Pick<Kernel, 'content'>

/** 擲得到的文化（沒被內容篩選整個擋掉的夜的文化，去重、照夜的 id 排）。 */
export function cultures(k: Cx, state: GameState): string[] {
  return [...new Set(allNights(k).filter((n) => !nightOff(state, n)).map((n) => n.culture))]
}

/**
 * 用一個 0～1 的數字決定這一場遭遇的文化：小於 culture_own 是這一夜的；其餘平均分給別的文化（沒有別的文化就是這一夜的）。
 * 純函式，測試可以直接給 roll 把機率固定住。
 */
export function cultureFor(k: Cx, state: GameState, night: Pick<NightEntry, 'culture'>, roll: number): string {
  const own = curtainRules(k).culture_own
  const others = cultures(k, state).filter((c) => c !== night.culture)
  if (roll < own || !others.length) return night.culture
  const span = 1 - own
  const at = span > 0 ? Math.floor(((roll - own) / span) * others.length) : 0
  return others[Math.min(others.length - 1, Math.max(0, at))]!
}

/** 一場遭遇的文化：館主固定這一夜的；其餘擲一次（骰面由狀態的亂數、這一趟、這個節點導出）。 */
export function encounterCulture(k: Cx, state: GameState, night: NightEntry, o: { run: string; sheet: string; node: string; guard: boolean }): string {
  if (o.guard) return night.culture
  return cultureFor(k, state, night, deriveRng(state.rng, `curtain/culture/${o.run}/${o.sheet}/${o.node}`).next())
}

// ---- 生成時：每場遭遇的文化與等級（掛點 netrun.foe_ref） ----

/** 這一幕的敵人的等級：席次的等級；加演的幕高一、兩級（最高 V）。act 是整趟的第幾幕（加演的從基本的幕數之後算）。 */
export function foeGradeOf(rules: Pick<CurtainRules, 'encore' | 'act_defs'>, tier: Pick<TierDef, 'grade'>, encore: boolean, act: number): number {
  const extra = encore ? (rules.encore.grades[act - rules.act_defs.length] ?? rules.encore.grades[rules.encore.grades.length - 1] ?? 0) : 0
  return Math.min(5, tier.grade + extra)
}

/** 這一組（文化、等級、每個位階）挑得到敵人嗎：問 enemy_pick 的單位來源（挑不到會丟錯）。沒有這個來源當作挑不到。 */
function pickable(k: Kernel, state: GameState, culture: string, grade: number, ranks: readonly string[], allies: number): boolean {
  const source = k.battle.getUnitSource('enemy_pick')
  if (!source) return false
  try {
    for (const rank of new Set(ranks)) source({ from: 'enemy_pick', faction: 'none', grade, rank, culture, seed: 'probe' }, { k, state, side: 'foe', mode: 'net', grade: grade as never, allyCount: allies })
    return true
  } catch {
    return false
  }
}

export interface FoeRefInfo {
  layer: number
  sheet: string
  node: string
  guard: boolean
  ranks: readonly string[]
}

/**
 * 掛點 netrun.foe_ref 的回答（只認自己開的一趟：origin.by 是 curtain）：這一場遭遇的敵人用 enemy_pick、這一夜擲到的文化（館主不擲）、這一幕的等級。
 * 擲到的文化挑不到敵人（沒有那種文化的敵人資料）時用這一夜的（P58）；這一夜的也挑不到就照寫，由 netrun 開始之前的檢查擋下（訊息寫出文化）。
 */
export function foeRefExtra(k: Kernel, state: GameState, origin: Origin, setup: Record<string, unknown>, info: FoeRefInfo): Partial<UnitRef> | undefined {
  if (origin.by !== ORIGIN_BY) return undefined
  const ext = isRecord(origin.ext) && isRecord(origin.ext.curtain) ? origin.ext.curtain : undefined
  if (!ext || !isText(ext.night) || !isText(ext.tier)) return undefined
  const night = k.content.get<NightEntry>(NIGHT_KIND, ext.night)
  const rules = curtainRules(k)
  const tier = tierOf(rules, ext.tier)
  if (!night || !tier) return undefined
  const encore = isInt(ext.encore) && ext.encore > 0
  const act = (encore ? rules.act_defs.length : 0) + info.layer
  const grade = foeGradeOf(rules, tier, encore, act)
  const allies = Math.max(1, Array.isArray(setup.party) ? setup.party.length : 1)
  const runId = isText(ext.run) ? ext.run : ext.night
  let culture = encounterCulture(k, state, night, { run: runId, sheet: info.sheet, node: info.node, guard: info.guard })
  if (culture !== night.culture && !pickable(k, state, culture, grade, info.ranks, allies)) culture = night.culture
  return { from: 'enemy_pick', culture, grade, faction: 'none' }
}
