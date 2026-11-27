// 日常技能的衍生數值（M5-abilities-opinion；dev/adr/0020 第七節、第十三節「衍生數值」表）。
// 技能資料的 daily 欄多兩個鍵（kind 與其餘照舊）：
//   stat      { 衍生數值 id: 加值 }   加值是數字，或 { amount?, per_tier?, min?, max? }（和技能的 stats 同一個算法：amount ＋ per_tier × 這棵樹的階，夾在 min～max）
//   tier_min  樹階到了這一階才算（沒寫就是裝著就算）
// 裝著（主角）或樹階以內（夥伴，只算隊伍裡的人）的技能，daily.stat 的每一項替那個人的衍生數值加值；「裝著」的判斷和條件 ability 同一份（holdingOf）。
// 能寫的衍生數值只有這十個：定義在 media、live、channel（以及這個功能的 flow_tier）；provider 在 ready 時才掛，沒有人定義的就不掛（不丟錯）。
// 例：聚光燈 { stat: { footage_quality: 1, footage_cap: { per_tier: 1, max: 2 } } }；樹階 3 以上剪片時看點或可信擇一 +1 是 { stat: { cut_pick: 1 }, tier_min: 3 }。

import type { ActorId, GameState, Kernel, RollPart } from '../../core'
import { isRec, onlyKeys } from './format'
import { abilityEntry } from './outside'
import { holdingOf, statValue, treeTierFor } from './stats'
import type { AbilityEntry, StatMod } from './types'
import { OWNER } from './types'

/** daily.stat 能寫的衍生數值。 */
export const DAILY_STATS = [
  'footage_quality', 'footage_cap', 'cut_pick', 'forge_bonus', 'forge_quality', 'forge_risk', 'live_goal_extra', 'live_record_quality', 'episode_bonus', 'flow_tier',
] as const

const inParty = (state: GameState, who: ActorId): boolean => !!state.actors[who] && (who === state.pc || state.party.includes(who))

/** daily 欄的 stat 與 tier_min 的格式問題（欄不是物件、沒寫這兩個鍵都不算問題；訊息不帶技能名）。 */
export function dailyStatProblems(daily: unknown): string[] {
  if (!isRec(daily)) return []
  const p: string[] = []
  if (daily.tier_min !== undefined && !(Number.isInteger(daily.tier_min) && (daily.tier_min as number) >= 1 && (daily.tier_min as number) <= 5)) p.push('daily.tier_min 要是 1～5 的整數（樹階）')
  if (daily.stat === undefined) return p
  if (!isRec(daily.stat)) return [...p, 'daily.stat 要是 { 衍生數值的 id: 加值 }']
  if (Object.keys(daily.stat).length === 0) p.push('daily.stat 至少要寫一項')
  p.push(...onlyKeys('daily.stat', daily.stat, DAILY_STATS))
  for (const [id, v] of Object.entries(daily.stat)) {
    if (!(DAILY_STATS as readonly string[]).includes(id)) continue
    if (typeof v === 'number') {
      if (!(Number.isFinite(v) && v !== 0)) p.push(`daily.stat.${id} 要是不為 0 的數字`)
    } else if (isRec(v)) {
      const at = `daily.stat.${id}`
      p.push(...onlyKeys(at, v, ['amount', 'per_tier', 'min', 'max']))
      for (const key of ['amount', 'per_tier', 'min', 'max']) if (v[key] !== undefined && !(typeof v[key] === 'number' && Number.isFinite(v[key]))) p.push(`${at}.${key} 要是數字`)
      if (v.amount === undefined && v.per_tier === undefined) p.push(`${at} 要寫 amount 或 per_tier（至少一個）`)
    } else p.push(`daily.stat.${id} 要是數字，或 { amount?, per_tier?, min?, max? }`)
  }
  return p
}

const specOf = (ab: AbilityEntry, id: string): StatMod | undefined => {
  const v = isRec(ab.daily) && isRec(ab.daily.stat) ? ab.daily.stat[id] : undefined
  if (typeof v === 'number') return { stat: id, amount: v }
  return isRec(v) ? ({ stat: id, ...v } as StatMod) : undefined
}

/** 這個人身上的日常技能給這個衍生數值的各筆加值。 */
export function dailyParts(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId, id: string): RollPart[] {
  if (!inParty(state, actor)) return []
  const out: RollPart[] = []
  for (const abId of holdingOf(k, state, actor).equipped) {
    const ab = abilityEntry(k, abId)
    const spec = ab ? specOf(ab, id) : undefined
    if (!ab || !spec) continue
    const tier = treeTierFor(state, actor, ab.path)
    const min = isRec(ab.daily) ? ab.daily.tier_min : undefined
    if (typeof min === 'number' && tier < min) continue
    const value = statValue(spec, tier)
    if (value !== 0) out.push({ label: ab.name, value, source: 'skill' })
  }
  return out
}

/** ready 時：每個有人定義的衍生數值掛一個 provider（沒有人定義的略過，之後也不會有人問）。 */
export function registerDailyStats(k: Kernel): void {
  for (const id of DAILY_STATS) {
    if (!k.stats.hasStat(id)) continue
    k.stats.addStatProvider(id, OWNER, (state, actor) => dailyParts(k, state, actor, id))
  }
}
