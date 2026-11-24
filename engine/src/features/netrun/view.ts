// L6 功能 netrun：給畫面的 netrunView。畫面照這個顯示，不自己判斷（規則寫在引擎，不寫在元件）。
// 規格：UI 第 5 節（子網的右欄：追蹤度、層、這一格能做的事）；dev/adr/0018 N6（站在遭遇節點旁邊列出開戰與潛行繞過）、N13（登出算撤退）。

import type { GameState, GridUse, Kernel } from '../../core'
import { meterOf } from '../../core'
import { layerName, runRegion } from './common'
import { logoutBlock, logoutNote } from './close'
import type { NetRun } from './model'
import { TRACE, netExt, readRun } from './model'
import { netrunRules } from './rules'
import { setupOf } from './start'
import { gateOpen, hereOf, nearFoes, nodeUses } from './uses'

export interface NodeRef {
  id: string
  name: string
  /** 標記的字母（g 閘門、r 休息點、f 遭遇……） */
  mark: string
}

export interface NetrunView {
  id: string
  kind: string
  region: { id: string; name: string }
  grade: number
  layer: { index: number; total: number; name: string; names: string[] }
  /** 追蹤度：這一區沒有追蹤度時 value 是 null */
  trace: { value: number | null; peak: number; marks: [number, number, number]; stage: 'quiet' | 'suspect' | 'alert' | 'located' | null; located: number | null }
  /** 探索回合數 */
  round: number
  goal: { kind: string; text: string; done: boolean }
  /** 站的這一格：標記與能做的事（遭遇節點站不上去，在 near） */
  here: { marker: NodeRef | null; uses: GridUse[] }
  /** 相鄰的遭遇節點各能做什麼（開戰、潛行繞過）與做不了的原因 */
  near: Array<NodeRef & { uses: GridUse[] }>
  /** 這一層的閘門開了沒有（守著它的遭遇處理過了，或連動讓它不用破解） */
  gate: { open: boolean; last: boolean }
  rested: boolean
  /** 能不能登出與原因；note 是登出會怎樣的一句（委託的階段：會回到進副本之前） */
  logout: { block: string | null; note: string | null }
}

const GOAL_TEXT = (run: NetRun): string => {
  if (run.goal.kind === 'pass') return '通過這一層的閘門。'
  if (run.goal.kind === 'clear') return run.layers.length > 1 ? `走完 ${run.layers.length} 層，從最後的出口離開。` : '走到出口離開。'
  return `目標：${run.goal.kind}（這一版還沒有做法）。`
}

/** 現在這一趟的畫面資料；沒有在網內的行程是 null。 */
export function netrunView(k: Kernel, state: GameState): NetrunView | null {
  const run = readRun(state)
  const net = run ? netExt(state, run.map) : null
  if (!run || !net) return null
  const region = runRegion(k, run)
  const rules = netrunRules(k)
  const sheetId = run.layers[run.layer]!
  const here = hereOf(k, state)
  const marker = here?.sheet.markerAt(here.at.x, here.at.y)
  const hasTrace = region.pressure === 'trace' && k.meters.has(TRACE)
  const v = hasTrace ? meterOf(k, state, TRACE, run.map) : null
  const stage = v === null ? null : run.located !== undefined ? 'located' : v >= rules.t2 ? 'alert' : v >= rules.t1 ? 'suspect' : 'quiet'
  const names = setupOf(run).layers
  return {
    id: run.id, kind: run.kind, region: { id: run.region, name: region.name }, grade: run.grade,
    layer: { index: run.layer + 1, total: run.layers.length, name: layerName(run), names: names.map((_, i) => layerName({ ...run, layer: i })) },
    trace: { value: v, peak: Math.max(run.peak, v ?? 0), marks: [rules.t1, rules.t2, rules.t3], stage, located: run.located ?? null },
    round: run.round,
    goal: { kind: run.goal.kind, text: GOAL_TEXT(run), done: run.goal.done === true },
    here: { marker: marker ? { id: marker.id, name: marker.name, mark: marker.mark } : null, uses: nodeUses(k, state) },
    near: nearFoes(k, state).map(({ marker: m, uses }) => ({ id: m.id, name: m.name, mark: m.mark, uses })),
    gate: { open: gateOpen(run, net, sheetId), last: run.layer >= run.layers.length - 1 },
    rested: net.rested.includes(sheetId),
    logout: { block: logoutBlock(state), note: logoutNote(run) },
  }
}
