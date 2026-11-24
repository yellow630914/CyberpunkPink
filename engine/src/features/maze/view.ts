// L6 功能 maze 給畫面的：這一趟的回合數與標準、籌碼、預估的評價、旁邊能做的事。
// 規格：CYBERSPACE 8.2 節（時間與評價）；dev/work/M3-maze.md。

import type { GameState, GridUse, Kernel, MarkerDef } from '../../core'
import type { MazeResult } from './model'
import { mazeRules, rate, readMaze, tallyOf } from './model'
import { isMazeInstance, layerIndexOf, nearUses } from './ops'

export interface MazeView {
  id: string
  bracket: string
  /** 組別的名字 */
  name: string
  grade: number
  deposit: number
  /** 現在在第幾層（從 1 起算）與一共幾層；不在迷宮的地圖上是 null */
  layer: { index: number; total: number; name: string } | null
  /** 每一層：名字、標準回合數、已經用了幾個（探索加戰鬥）、是不是現在這一層 */
  layers: Array<{ name: string; standard: number; used: number; current: boolean }>
  rounds: number
  standard: number
  /** 回合數對標準的比例（標準是 0 時是 0） */
  ratio: number
  downs: number
  chips: number
  /** 一枚籌碼換多少現金 */
  chipValue: number
  /** 照現在的回合數與倒下的人數，破關會是什麼評價、獎金倍率、獎金（還沒算獎品與籌碼） */
  rating: string
  mult: number
  prize: number
  /** 站在旁邊的機關與腳下的寶箱 */
  near: Array<{ marker: Pick<MarkerDef, 'id' | 'name' | 'mark'>; kind: 'puzzle' | 'chest'; uses: GridUse[] }>
  /** 結算完、等著發結果的（維持到 maze.result 之後清掉；一般看不到） */
  over?: MazeResult
}

/** 這一趟迷宮館的樣子；沒有在迷宮館裡是 null。 */
export function mazeView(k: Kernel, state: GameState): MazeView | null {
  const m = readMaze(state)
  if (!m) return null
  const rules = mazeRules(k)
  const tally = tallyOf(state, m, rules.layers.length)
  const rounds = tally.rounds.reduce((s, n) => s + n, 0)
  const standard = rules.layers.reduce((s, l) => s + l.standard, 0)
  const at = state.maps.at
  const here = at && isMazeInstance(state, at.map) ? layerIndexOf(state, at.map, at.sheet) : -1
  const row = rate(rules, rounds, standard, tally.downs)
  const bracket = rules.brackets[m.bracket]
  const g = bracket?.grades.find((x) => x.grade === m.grade)
  return {
    id: m.id, bracket: m.bracket, name: bracket?.name ?? m.bracket, grade: m.grade, deposit: m.deposit,
    layer: here >= 0 ? { index: here + 1, total: rules.layers.length, name: rules.layers[here]?.name ?? `第 ${here + 1} 層` } : null,
    layers: rules.layers.map((l, i) => ({ name: l.name, standard: l.standard, used: tally.rounds[i] ?? 0, current: i === here })),
    rounds, standard, ratio: standard > 0 ? rounds / standard : 0, downs: tally.downs, chips: tally.chips, chipValue: rules.chip,
    rating: row.rating, mult: row.mult, prize: Math.round((g?.prize ?? 0) * row.mult),
    near: nearUses(k, state).map((n) => ({ marker: { id: n.marker.id, name: n.marker.name, mark: n.marker.mark }, kind: n.kind, uses: n.uses })),
    ...(m.over ? { over: m.over } : {}),
  }
}
