// 棋盤的純函式（OPINION 3.2、3.3、4.3c）：分數、防守、鄰居、能不能佔。只讀 War，不改任何東西。
// 防守的加減有幾個來源，都存在戰役裡（防守是純函式，不再問任何人）：城市事件、對手的招牌（它搶你的格子 −N；你搶它的格子看你的公信力）、
// 被動的修正（def_own、def_first_empty、def_cell）、效果 def_mod 留下的加減、豔名（看臉三格）、效果 take 的 foe_def_zero。

import type { OpinionRules, War, Who } from './model'
import { CELLS, CELL_NAME, DEFAULT_OPINION_RULES, cellsOfRow, neighbors, type Cell } from './model'
import type { Env } from './mods'
import { DEFAULT_ENV, modSum, modsOf } from './mods'

/** 看臉的三個格子（OPINION 4.3c）：帶子街、應援圈、夜鶯直播。 */
export const FAME_CELLS: Cell[] = ['tape', 'fanclub', 'nightingale']

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

type DefRules = Pick<OpinionRules, 'empty_def' | 'foe_def_base'> & Partial<Pick<OpinionRules, 'fame'>>

/** 豔名的級數（OPINION 4.3c）：每 step 點一級，最多 max 級。 */
export const fameLevel = (war: War, rules: Partial<Pick<OpinionRules, 'fame'>>): number => {
  const f = rules.fame ?? DEFAULT_OPINION_RULES.fame
  return Math.min(f.max, Math.max(0, Math.floor(war.fame / f.step)))
}

/** 蜜腺這類招牌：你搶它的格子時，防守照你的公信力加減。 */
function credDef(war: War, env: Env): number {
  const steps = war.foe.signature?.effect.cred_def
  if (!steps) return 0
  return steps.reduce((s, t) => s + ((t.lt === undefined || env.cred < t.lt) && (t.gte === undefined || env.cred >= t.gte) ? t.amount : 0), 0)
}

/** 這一次搶（你搶）有哪幾個 def_mod 算得上。 */
export function applicableDefMods(war: War, c: Cell): number[] {
  const owner = war.cells[c].owner
  const out: number[] = []
  war.defmods.forEach((m, i) => {
    if (m.vs === 'empty' && owner !== null) return
    if (m.vs === 'foe' && owner !== 'foe') return
    if (m.cells && !m.cells.includes(c)) return
    if (m.first && war.captured > 0) return
    out.push(i)
  })
  return out
}

/**
 * 防守（OPINION 3.3）：沒人的格子 2；你搶對手的 3 − 風向（最少 0）；對手搶你的 3 ＋ 風向（最少 0）；再加上面那些來源的加減；最少 0。
 * who 是搶的那一方。env 是現在的公信力（修正的 when 與蜜腺的招牌要看；沒給當 50）。
 */
export function defenseOf(war: War, c: Cell, who: Who, rules: DefRules = DEFAULT_OPINION_RULES, env: Env = DEFAULT_ENV): number {
  const owner = war.cells[c].owner
  let d: number
  if (owner === null) {
    d = rules.empty_def
    // 每場第一次佔沒人的格子，防守當作 n
    const first = modsOf(war, 'def_first_empty', env)[0]
    if (who === 'you' && first && (war.moves_used['war:first_empty'] ?? 0) === 0) d = first.amount ?? d
  } else d = Math.max(0, rules.foe_def_base + (who === 'you' ? -war.wind : war.wind))
  d += cityDef(war, c)
  if (who === 'you') {
    for (const m of modsOf(war, 'def_cell', env)) if (m.cell === c && (m.once !== true || (war.moves_used[`war:def_cell:${c}`] ?? 0) === 0)) d += m.amount ?? 0
    for (const i of applicableDefMods(war, c)) d += war.defmods[i]!.amount
    if (FAME_CELLS.includes(c)) d -= fameLevel(war, rules)
    if (owner === 'foe') {
      d += credDef(war, env)
      if (war.foe_state.guard === war.round) d += 1
      if (war.zero_def.includes(c)) d = 0
    }
  } else {
    const m = war.foe.signature?.effect.def_minus
    if (m && m.cells.includes(c)) d -= m.amount ?? 1
    if (owner === 'you') d += modSum(war, 'def_own', env)
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
  if (!neighbors(c).some((n) => war.cells[n].owner === who) && !(who === 'you' && war.free_adj)) return `「${name}」和${mine}佔著的格子不相鄰（只算上下左右）。`
  if (lockedCells(war).includes(c)) return `「${name}」這一回合不能被佔（城市事件）。`
  if (who === 'foe' && owner === 'you') {
    const g = war.cells[c].guard
    if (g !== undefined && g >= war.round) return `「${name}」設了防，這一回合搶不了。`
  }
  return null
}

/** 加上聲量：搶的人聲量夠不夠。 */
export function captureBlock(war: War, c: Cell, who: Who, rules: DefRules = DEFAULT_OPINION_RULES, env: Env = DEFAULT_ENV): string | null {
  const b = cellBlock(war, c, who)
  if (b) return b
  const need = defenseOf(war, c, who, rules, env)
  const have = war.voice[who]
  if (have < need) return `聲量不夠：搶「${CELL_NAME[c]}」要 ${need}，${who === 'you' ? '你' : '對手'}只有 ${have}。`
  return null
}

/** 這一方現在佔得下的格子（相鄰、沒鎖、聲量夠）。 */
export const capturable = (war: War, who: Who, rules: DefRules = DEFAULT_OPINION_RULES, env: Env = DEFAULT_ENV): Cell[] =>
  frontier(war, who).filter((c) => captureBlock(war, c, who, rules, env) === null)

// ---- 你佔一格：用哪一次、花多少 ----

/** 原本那一次佔領用掉了沒有：這回合佔過幾次，扣掉多佔的用掉了幾次（多佔的次數 − 還剩的）。 */
export const baseUsed = (war: War): boolean => war.captured - (war.captures - 1 - war.xcap.length) >= 1

export interface CapturePlan {
  /** base 是原本那一次，數字是 xcap 的第幾次（多佔的） */
  slot: 'base' | number
  def: number
}

/**
 * 你要佔這一格：這一回合還有沒有次數、選哪一次（原本那一次要相鄰；多佔的看自己的 any）、要花多少聲量。
 * 回傳 { plan } 或 { why }（一句完整的原因）。
 */
export function planCapture(war: War, c: Cell, rules: DefRules = DEFAULT_OPINION_RULES, env: Env = DEFAULT_ENV): { plan: CapturePlan } | { why: string } {
  const name = CELL_NAME[c]
  if (war.stun) return { why: '對手的人把你的人手牽制住了，這一回合不能佔領。' }
  if (war.captured >= war.captures) return { why: '這一回合已經佔領過了。' }
  if (war.cells[c].owner === 'you') return { why: `「${name}」已經是你的了。` }
  const adj = war.free_adj || neighbors(c).some((n) => war.cells[n].owner === 'you')
  let slot: 'base' | number | null = !baseUsed(war) && adj ? 'base' : null
  if (slot === null) {
    const i = war.xcap.findIndex((x) => x.any || adj)
    if (i >= 0) slot = i
  }
  if (slot === null) return { why: adj ? '這一回合已經佔領過了。' : `「${name}」和你佔著的格子不相鄰（只算上下左右）。` }
  if (lockedCells(war).includes(c)) return { why: `「${name}」這一回合不能被佔（城市事件）。` }
  const def = Math.max(0, defenseOf(war, c, 'you', rules, env) + (slot === 'base' ? 0 : war.xcap[slot]!.def))
  if (war.voice.you < def) return { why: `聲量不夠：搶「${name}」要 ${def}，你只有 ${war.voice.you}。` }
  return { plan: { slot, def } }
}
