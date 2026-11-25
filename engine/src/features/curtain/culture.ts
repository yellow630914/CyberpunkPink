// L6 功能 curtain 的敵人的文化（CYBERSPACE 8.8 節「敵人的文化」開頭三條；dev/adr/0019 P58）。
//
// 每場遭遇擲一次文化：這一夜的文化 culture_own（60%），其餘平均分給別的夜的文化；一場遭遇的敵人全來自擲到的那一種。館主（守閘門的那一場）不擲，永遠是這一夜的。
// 敵人從資料裡挑：enemy 的 culture 標籤、位階、等級範圍含這一級（沒有就最近的）；沒有那種文化的敵人資料時用這一夜的（P58）。
// 挑法是 enemies 的 enemy_pick 加一個標籤的篩選，這個功能自己登記成單位來源 curtain_pick（不 import enemies），挑到之後交給 enemy 來源做出單位。

import type { BattleUnitInit, GameState, Kernel } from '../../core'
import { deriveRng, isRecord } from '../../core'
import type { NightEntry } from './model'
import { PICK_SOURCE, allNights, curtainRules, isInt, isText } from './model'
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

// ---- 挑兵種 ----

/** 這一筆敵人資料能不能進內海的戰鬥（蕾絲、網內的程式，或寫了 constructs 的；和 enemies 的 netCapable 同一個判斷）。 */
const netCapable = (e: Record<string, unknown>): boolean => e.kind === 'lace' || e.kind === 'program' || (Array.isArray(e.constructs) && e.constructs.length > 0)

const gradesOf = (e: Record<string, unknown>): [number, number] => (Array.isArray(e.grades) && isInt(e.grades[0]) && isInt(e.grades[1]) ? [e.grades[0], e.grades[1]] : [1, 5])

/** 這個文化、位階、等級挑得到的敵人 id（照 id 排；範圍含這一級，沒有就範圍離這一級最近的那幾個）。 */
export function pickCandidates(k: Cx, spec: { culture: string; rank: string; grade: number }): string[] {
  const pool: Array<{ id: string; gap: number }> = []
  for (const e of k.content.list('enemy') as Array<Record<string, unknown> & { id: string }>) {
    if (e.culture !== spec.culture || e.rank !== spec.rank || e.named === true || !netCapable(e)) continue
    if (isRecord(e.position) && e.position.size === 'overlay') continue
    const [lo, hi] = gradesOf(e)
    pool.push({ id: e.id, gap: spec.grade < lo ? lo - spec.grade : spec.grade > hi ? spec.grade - hi : 0 })
  }
  if (!pool.length) return []
  const best = Math.min(...pool.map((x) => x.gap))
  return pool.filter((x) => x.gap === best).map((x) => x.id).sort()
}

/** 這一場遭遇挑得到嗎：挑不到的位階一條一句（空的就是挑得到）。沒有那種文化的敵人時改用這一夜的文化（P58）；那也沒有才算挑不到。 */
export function pickProblems(k: Cx, o: { culture: string; own: string; grade: number; ranks: readonly string[] }): { culture: string; problems: string[] } {
  const ok = (culture: string): boolean => o.ranks.every((rank) => pickCandidates(k, { culture, rank, grade: o.grade }).length > 0)
  if (ok(o.culture)) return { culture: o.culture, problems: [] }
  if (o.culture !== o.own && ok(o.own)) return { culture: o.own, problems: [] }
  const missing = [...new Set(o.ranks.filter((rank) => pickCandidates(k, { culture: o.own, rank, grade: o.grade }).length === 0))]
  return { culture: o.own, problems: missing.map((rank) => `挑不到敵人：文化「${o.own}」、等級 ${o.grade}、位階 ${rank} 沒有符合的兵種。`) }
}

/** 單位來源 curtain_pick：{ culture, grade, rank, seed?, layer?, color? } → 先挑兵種，再交給 enemy 來源做出單位。 */
export function pickUnit(k: Kernel, state: GameState, ref: Record<string, unknown>, ctx: Parameters<NonNullable<ReturnType<Kernel['battle']['getUnitSource']>>>[1]): BattleUnitInit {
  const culture = ref.culture
  const rank = ref.rank
  const grade = ref.grade
  if (!isText(culture) || !isText(rank) || !isInt(grade)) throw new Error('curtain_pick 要寫 culture（文化）、rank（位階）、grade（等級，整數）')
  const seed = ref.seed === undefined ? '' : typeof ref.seed === 'string' || typeof ref.seed === 'number' ? String(ref.seed) : undefined
  if (seed === undefined) throw new Error('curtain_pick 的 seed 要是字串或數字')
  const ids = pickCandidates(k, { culture, rank, grade })
  if (!ids.length) throw new Error(`挑不到敵人：文化「${culture}」、等級 ${grade}、位階 ${rank} 沒有符合的兵種。`)
  const id = deriveRng(state.rng, `curtain_pick/${seed}`).pick(ids)
  const entry = k.content.get('enemy', id) as Record<string, unknown>
  const [lo, hi] = gradesOf(entry)
  const enemy = k.battle.getUnitSource('enemy')
  if (!enemy) throw new Error('敵人的功能沒有裝，做不出單位。')
  const { culture: _c, rank: _r, seed: _s, from: _from, ...rest } = ref
  return enemy({ ...rest, id, grade: Math.min(hi, Math.max(lo, grade)) }, ctx)
}

export { PICK_SOURCE }
