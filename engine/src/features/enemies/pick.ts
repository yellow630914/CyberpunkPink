// 照勢力、等級、位階挑一個兵種（來源 enemy_pick；dev/work/M2-enemy-encounter.md 第一、二項）。
// 別的功能（委託的副本、生成委託）只說「這個勢力、這一級、這個位階」就拿得到一個敵人：
//   { from: 'enemy_pick', faction, grade, rank, seed?, attached? }
// - 候選：這個勢力、這個位階、等級範圍含這一級的制式兵種（不含具名、不含掛在格上的一台、不含蕾絲／程式／機甲）。
//   沒有任何一個範圍含這一級時，照最近的一級（ENEMIES 1.6 節、dev/adr/0013 D5）：範圍離這一級最近的那幾個兵種。
// - 亂數是 deriveRng(state.rng, 'enemy_pick/<seed>')：同一個狀態、同一個 seed 永遠挑到同一個（候選照 id 排好再抽）。
//   沒寫 seed 時是空字串；同一場要挑好幾個時每一個給不同的 seed（委託的副本用「委託、階段、第幾個」）。
// - 挑到之後的單位就是 enemy 來源做出來的（數值、站位、附屬單位 attached 都一樣）；等級夾在這個兵種的範圍裡（照最近的那一級算數值）。
// - 挑不到丟錯，訊息寫出勢力、等級、位階三個條件；pickProblems 讓生成委託的功能在生成時先問，免得開打才發現挑不到。
// 規格：ENEMIES 1.6 節、第 13 節；dev/adr/0013 D5。

import type { BattleUnitInit, GameState, Kernel } from '../../core'
import { UNIT_RANKS, deriveRng } from '../../core'
import type { EnemyEntry } from './kinds'
import { resolveEnemy } from './kinds'
import { enemyUnit, isOverlay } from './stats'

type Cx = Pick<Kernel, 'content'>

export interface PickSpec {
  faction: string
  grade: number
  rank: (typeof UNIT_RANKS)[number]
}

/** 位階的名字（訊息用）。 */
const RANK_NAME: Record<string, string> = { minion: '雜兵', elite: '精英', boss: '首領' }
/** 不是現實戰鬥裡的單位：蕾絲與網內的程式（內海）、機甲（M6）。 */
const NOT_FIELD_KINDS: readonly string[] = ['lace', 'program', 'mech']

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 三個條件的寫法（訊息用）。 */
const describe = (s: PickSpec): string => `勢力 ${s.faction}、等級 ${s.grade}、位階 ${RANK_NAME[s.rank] ?? s.rank}（${s.rank}）`

/** 這一級離兵種的範圍有多遠：在範圍裡是 0。 */
const distance = (e: EnemyEntry, grade: number): number => (grade < e.grades[0] ? e.grades[0] - grade : grade > e.grades[1] ? grade - e.grades[1] : 0)

/** 格式不對的條件（空的就是三個條件都合格）。 */
function specProblems(s: Partial<PickSpec>): string[] {
  const p: string[] = []
  if (typeof s.faction !== 'string' || !s.faction.trim()) p.push('faction 要是勢力的 id（沒有勢力寫 none）')
  if (!(isInt(s.grade) && s.grade >= 1 && s.grade <= 5)) p.push('grade 要是 1～5 的整數')
  if (!(UNIT_RANKS as readonly unknown[]).includes(s.rank)) p.push(`rank 只能是 ${UNIT_RANKS.join('、')}`)
  return p
}

/**
 * 挑得到的兵種 id（照 id 排好）：範圍含這一級的；沒有就是範圍離這一級最近的那幾個。條件格式不對丟錯。
 * 載入之後才查得到（內容種類 enemy 要已經載入）。
 */
export function pickCandidates(k: Cx, spec: PickSpec): string[] {
  const bad = specProblems(spec)
  if (bad.length) throw new Error(`enemy_pick 的條件不對：${bad.join('；')}`)
  const pool: Array<{ id: string; gap: number }> = []
  for (const raw of k.content.list<EnemyEntry>('enemy')) {
    const e = resolveEnemy(k.content, raw.id)
    if (e.faction !== spec.faction || e.rank !== spec.rank) continue
    if (e.named || isOverlay(e) || NOT_FIELD_KINDS.includes(e.kind)) continue
    pool.push({ id: raw.id, gap: distance(e, spec.grade) })
  }
  if (!pool.length) return []
  const best = Math.min(...pool.map((x) => x.gap))
  return pool.filter((x) => x.gap === best).map((x) => x.id).sort()
}

/**
 * 這三個條件挑得到兵種嗎：回傳給人看的問題，空的就是挑得到。生成委託的功能在生成時先問。
 * 格式不對（等級不是 1～5、位階不認得）也在裡面，一條一句。
 */
export function pickProblems(k: Cx, spec: PickSpec): string[] {
  const bad = specProblems(spec)
  if (bad.length) return bad.map((x) => `enemy_pick 的條件不對：${x}。`)
  return pickCandidates(k, spec).length ? [] : [`挑不到敵人：${describe(spec)} 沒有符合的兵種（要是這個勢力的制式兵種、位階對、等級範圍含這一級或最接近）。`]
}

/** 挑一個兵種的 id。同一個狀態、同一個 seed 永遠同一個；挑不到丟錯（訊息寫出勢力、等級、位階）。 */
export function pickEnemy(k: Cx, state: GameState, spec: PickSpec, seed = ''): string {
  const ids = pickCandidates(k, spec)
  if (!ids.length) throw new Error(pickProblems(k, spec)[0])
  return deriveRng(state.rng, `enemy_pick/${seed}`).pick(ids)
}

/** 「誰上場」的 enemy_pick 來源：先挑兵種，再交給 enemy 來源做出單位（strength、name、attached 照 enemy 的寫法）。 */
export function enemyPickUnit(k: Cx, state: GameState, ref: Record<string, unknown>, ctx: { grade: number; allyCount: number }): BattleUnitInit {
  const seed = ref.seed === undefined ? '' : typeof ref.seed === 'string' || typeof ref.seed === 'number' ? String(ref.seed) : undefined
  if (seed === undefined) throw new Error('enemy_pick 的 seed 要是字串或數字')
  const spec = { faction: ref.faction, grade: ref.grade, rank: ref.rank } as PickSpec
  const id = pickEnemy(k, state, spec, seed)
  const e = resolveEnemy(k.content, id)
  // 等級夾在這個兵種的範圍裡：範圍以外照最近的那一級算數值（D5）
  const grade = Math.min(e.grades[1], Math.max(e.grades[0], spec.grade))
  const { faction: _f, rank: _r, seed: _s, from: _from, ...rest } = ref
  return enemyUnit(k, state, { ...rest, id, grade }, ctx)
}
