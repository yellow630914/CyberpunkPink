// L6 功能 netrun：給畫面的 netrunView。畫面照這個顯示，不自己判斷（規則寫在引擎，不寫在元件）。
// 規格：UI 第 5 節（子網的右欄：追蹤度、層、這一格能做的事）；dev/adr/0018 N6（站在遭遇節點旁邊列出開戰與潛行繞過）、N13（登出算撤退）。

import type { GameState, GridUse, Kernel } from '../../core'
import { meterOf, sightOf } from '../../core'
import { layerName, runRegion } from './common'
import { controlsTaken, logoutBlock, logoutNote } from './close'
import type { LootEntry, NetRun } from './model'
import { TRACE, netExt, readRun } from './model'
import { nodePos } from './patrol'
import { netrunRules } from './rules'
import { setupOf } from './start'
import { freeUses, gateOpen, hereOf, nearFoes, nodeUses } from './uses'

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
  goal: { kind: string; text: string; done: boolean; progress: number | null; turns: number | null; got: boolean; at: { sheet: string; id: string; pos: [number, number] } | null }
  /** 站的這一格：標記與能做的事（遭遇節點站不上去，在 near） */
  here: { marker: NodeRef | null; uses: GridUse[] }
  /** 相鄰的遭遇節點各能做什麼（開戰、潛行繞過）與做不了的原因 */
  near: Array<NodeRef & { uses: GridUse[] }>
  /** 這一層的閘門開了沒有（守著它的遭遇處理過了，或連動讓它不用破解） */
  gate: { open: boolean; last: boolean }
  rested: boolean
  /** 不在哪一格都能做的事（探索中的管理行動：擦痕跡；沒有主控的隊伍沒有）與做不了的原因 */
  admin: GridUse[]
  /** 這一層的巡邏：站的節點與格子；visible 是現在看得到（在視野裡） */
  patrols: Array<{ id: string; node: string; at: [number, number]; visible: boolean; calm: boolean }>
  /** 這一趟拿到的東西、手上的憑證數、接管了哪些控制節點 */
  loot: LootEntry[]
  keys: number
  controls: Array<{ id: string; sheet: string; name?: string; node?: string }>
  /** 能不能登出與原因；note 是登出會怎樣的一句（委託的階段：會回到進副本之前） */
  logout: { block: string | null; note: string | null }
}

const GOAL_TEXT = (run: NetRun): string => {
  const g = run.goal
  switch (g.kind) {
    case 'pass': return '通過這一層的閘門。'
    case 'clear': return run.layers.length > 1 ? `走完 ${run.layers.length} 層，從最後的出口離開。` : '走到出口離開。'
    case 'download': return `下載：待在目標的檔案庫上，做滿 ${g.turns ?? 1} 次（離開那一格進度歸零；每回合追蹤度會漲）。`
    case 'plant': return `放東西：待在目標的節點上，上傳 ${g.turns ?? 1} 個回合。`
    case 'seize': return '接管目標的控制節點。'
    case 'find': return '找到目標的人：走到他那裡，交涉或快駭。'
    case 'defeat': return g.foe ? '打倒守著目標的那一場，指定的敵人就在裡面。' : '打倒守著目標的那一場。'
    case 'extract': return g.got ? '東西拿到了：走到出口或安全點，倒下的話這一件一定會丟。' : '拿到目標的東西，再走到出口或安全點。'
    default: return `目標：${g.kind}。`
  }
}

function patrolsView(state: GameState, run: NetRun, net: NonNullable<ReturnType<typeof netExt>>, sheetId: string): NetrunView['patrols'] {
  const at = state.maps.at
  const def = state.maps.instances[run.map]?.gen?.map.sheets.find((x) => x.id === sheetId)
  const radius = def ? sightOf(def) : 2
  return net.patrols.filter((p) => p.sheet === sheetId && !p.gone).flatMap((p) => {
    const pos = nodePos(net, sheetId, p.at)
    if (!pos) return []
    const visible = !!at && at.sheet === sheetId && Math.abs(pos[0] - at.x) + Math.abs(pos[1] - at.y) <= radius
    return [{ id: p.id, node: p.at, at: [pos[0], pos[1]] as [number, number], visible, calm: p.calm === true }]
  })
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
    goal: {
      kind: run.goal.kind, text: GOAL_TEXT(run), done: run.goal.done === true, progress: typeof run.goal.progress === 'number' ? run.goal.progress : null,
      turns: typeof run.goal.turns === 'number' ? run.goal.turns : null, got: run.goal.got === true, at: run.goal.at ? { ...run.goal.at, pos: [...run.goal.at.pos] } : null,
    },
    here: { marker: marker ? { id: marker.id, name: marker.name, mark: marker.mark } : null, uses: nodeUses(k, state) },
    near: nearFoes(k, state).map(({ marker: m, uses }) => ({ id: m.id, name: m.name, mark: m.mark, uses })),
    gate: { open: gateOpen(run, net, sheetId), last: run.layer >= run.layers.length - 1 },
    rested: net.rested.includes(sheetId),
    admin: freeUses(k, state),
    patrols: patrolsView(state, run, net, sheetId),
    loot: run.loot.map((l) => ({ ...l })),
    keys: net.keys.length,
    controls: controlsTaken(net),
    logout: { block: logoutBlock(state), note: logoutNote(run) },
  }
}
