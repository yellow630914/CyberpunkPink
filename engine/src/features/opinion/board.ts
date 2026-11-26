// 棋盤的純函式（OPINION 3.2、3.3）：分數、防守、鄰居、能不能佔。只讀 War，不改任何東西。

import type { OpinionRules, War, Who } from './model'
import { CELLS, CELL_NAME, DEFAULT_OPINION_RULES, cellsOfRow, neighbors, type Cell } from './model'

/** 一格的分數：議題給的加上這一場的加成（偶像的畢業公演）。 */
export const cellScore = (war: War, c: Cell): number => war.topic.scores[c] + (war.bonus[c] ?? 0)

/** 一方的分數：自己的格子的分數合計。 */
export function scoreOf(war: War, who: Who): number {
  return CELLS.reduce((s, c) => s + (war.cells[c].owner === who ? cellScore(war, c) : 0), 0)
}

export const cellsOwnedBy = (war: War, who: Who): Cell[] => CELLS.filter((c) => war.cells[c].owner === who)

/** 城市事件這一回合鎖住的格子。 */
export function lockedCells(war: War): Cell[] {
  const f = war.city_fx
  if (!f || f.kind !== 'lock') return []
  return [...new Set([...(f.cells ?? []), ...(f.row ? cellsOfRow(f.row) : [])])]
}

/** 城市事件給這一格加的防守（封街）。 */
export function cityDef(war: War, c: Cell): number {
  const f = war.city_fx
  return f && f.kind === 'def_row' && cellsOfRow(f.row).includes(c) ? f.amount : 0
}

/**
 * 防守（OPINION 3.3）：沒人的格子 2；你搶對手的 3 − 風向（最少 0）；對手搶你的 3 ＋ 風向（最少 0）；
 * 再加城市事件的加減；對手的招牌可以讓它搶某幾格時防守 −1。who 是搶的那一方。
 */
export function defenseOf(war: War, c: Cell, who: Who, rules: Pick<OpinionRules, 'empty_def' | 'foe_def_base'> = DEFAULT_OPINION_RULES): number {
  const owner = war.cells[c].owner
  let d: number
  if (owner === null) d = rules.empty_def
  else d = Math.max(0, rules.foe_def_base + (who === 'you' ? -war.wind : war.wind))
  d += cityDef(war, c)
  if (who === 'foe') {
    const m = war.foe.signature?.effect.def_minus
    if (m && m.cells.includes(c)) d -= m.amount ?? 1
  }
  return Math.max(0, d)
}

/** 這一方的格子旁邊、還不是它的格子。 */
export const frontier = (war: War, who: Who): Cell[] => CELLS.filter((c) => war.cells[c].owner !== who && neighbors(c).some((n) => war.cells[n].owner === who))

/**
 * 這一格現在能不能被這一方佔（不看聲量與這回合的次數）：回傳原因，可以回 null。
 * 對手的格子被你搶沒有設防的問題；你設防的格子對手那一回合搶不了。
 */
export function cellBlock(war: War, c: Cell, who: Who): string | null {
  const name = CELL_NAME[c]
  const owner = war.cells[c].owner
  const mine = who === 'you' ? '你' : '對手'
  if (owner === who) return `「${name}」已經是${mine}的了。`
  if (!neighbors(c).some((n) => war.cells[n].owner === who)) return `「${name}」和${mine}佔著的格子不相鄰（只算上下左右）。`
  if (lockedCells(war).includes(c)) return `「${name}」這一回合不能被佔（城市事件）。`
  if (who === 'foe' && owner === 'you') {
    const g = war.cells[c].guard
    if (g !== undefined && g >= war.round) return `「${name}」設了防，這一回合搶不了。`
  }
  return null
}

/** 加上聲量：搶的人聲量夠不夠。 */
export function captureBlock(war: War, c: Cell, who: Who, rules: Pick<OpinionRules, 'empty_def' | 'foe_def_base'> = DEFAULT_OPINION_RULES): string | null {
  const b = cellBlock(war, c, who)
  if (b) return b
  const need = defenseOf(war, c, who, rules)
  const have = war.voice[who]
  if (have < need) return `聲量不夠：搶「${CELL_NAME[c]}」要 ${need}，${who === 'you' ? '你' : '對手'}只有 ${have}。`
  return null
}

/** 這一方現在佔得下的格子（相鄰、沒鎖、聲量夠）。 */
export const capturable = (war: War, who: Who, rules: Pick<OpinionRules, 'empty_def' | 'foe_def_base'> = DEFAULT_OPINION_RULES): Cell[] =>
  frontier(war, who).filter((c) => captureBlock(war, c, who, rules) === null)

