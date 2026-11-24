// L6 功能 netrun：巡邏（CYBERSPACE 8.1 節「節點」表的巡邏、「巡邏可以躲」；dev/adr/0018 N6、N24；工單 M3-netrun-nodes 第 6 項）。
// 生成之後從節點的圖挑一條 3～5 個節點的路線（簡單路徑、來回走），放一隊（一個精英或兩個雜兵，規則表 patrol）。
// 每過 patrol_every（3）個探索回合沿路線走一個節點。和隊伍在同一個節點或相鄰的節點時：全隊潛行對 DC（setup.stealth 的那一趟自動過），沒過就開戰；
// 過了擦身而過（calm：兩邊拉開之前不再擲）。打贏就沒有了。追蹤度第一次到 t1，每一層（現在這一層與更深的）多一隊。
// 巡邏是會動的東西，不是格子：位置記在 ext.net.patrols（節點 id 加步數），也同步寫進 SheetState.movers（畫面讀）。

import type { Change, GenRand, GenResult, UnitRef } from '../../core'
import { encounterAfter } from './model'
import type { Fx, NetExt, NetRun, NetrunRules, Patrol, Rank } from './model'

type Graph = GenResult['graph']

/** 來回走：第 step 步在路線的哪個位置（0、1、……、len-1、len-2、……、0、……）。 */
export function pingpong(step: number, len: number): number {
  if (len <= 1) return 0
  const period = 2 * (len - 1)
  const m = ((step % period) + period) % period
  return m < len ? m : period - m
}

/** 節點圖的鄰居表（鏈路不分單向：巡邏兩邊都走得過去）。 */
export function adjacency(graph: Graph): Map<string, string[]> {
  const out = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]))
  for (const e of graph.edges) {
    if (!out.get(e.a)?.includes(e.b)) out.get(e.a)?.push(e.b)
    if (!out.get(e.b)?.includes(e.a)) out.get(e.b)?.push(e.a)
  }
  return out
}

/** 從 from 出發，每個節點離它幾步（節點圖上）。 */
export function hopsFrom(graph: Graph, from: string): Map<string, number> {
  const adj = adjacency(graph)
  const dist = new Map<string, number>([[from, 0]])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const n of adj.get(cur) ?? []) {
      if (dist.has(n)) continue
      dist.set(n, dist.get(cur)! + 1)
      queue.push(n)
    }
  }
  return dist
}

/**
 * 從節點圖挑一條路線：簡單路徑（不重複）、不經過入口、起點離入口至少 2 步（巡邏不是一開場就貼在入口旁邊）。
 * 長度在 len 之內；挑不出夠長的退而求其次（最短 2 個節點）；圖太小是 null。from 是隊伍現在的節點：給了就挑起點離它最遠的（追蹤度到 30 時多出來的那一隊）。
 */
export function pickRoute(graph: Graph, rand: GenRand, len: [number, number], from?: string): string[] | null {
  const adj = adjacency(graph)
  const entry = graph.nodes.find((n) => n.kind === 'entry')?.id
  const fromEntry = entry ? hopsFrom(graph, entry) : new Map<string, number>()
  const away = from ? hopsFrom(graph, from) : null
  const ok = (id: string): boolean => id !== entry
  const starts = graph.nodes.map((n) => n.id).filter((id) => ok(id) && (fromEntry.get(id) ?? 99) >= 2)
  const pool = starts.length ? starts : graph.nodes.map((n) => n.id).filter(ok)
  if (!pool.length) return null
  let best: string[] | null = null
  for (let attempt = 0; attempt < 40; attempt++) {
    let start = pool[Math.floor(rand() * pool.length)]!
    if (away) {
      const far = [...pool].sort((a, b) => (away.get(b) ?? 0) - (away.get(a) ?? 0) || (a < b ? -1 : 1))
      start = far[Math.min(far.length - 1, Math.floor(rand() * Math.min(3, far.length)))]!
    }
    const want = len[0] + Math.floor(rand() * (len[1] - len[0] + 1))
    const path = [start]
    while (path.length < want) {
      const next = (adj.get(path[path.length - 1]!) ?? []).filter((n) => ok(n) && !path.includes(n))
      if (!next.length) break
      path.push(next[Math.floor(rand() * next.length)]!)
    }
    if (path.length >= len[0]) return path
    if (path.length >= 2 && (!best || path.length > best.length)) best = path
  }
  return best
}

export interface MakeOpts {
  id: string
  sheet: string
  graph: Graph
  rand: GenRand
  grade: number
  faction?: string
  fx: Fx
  color?: string
  layerName: string
  rules: NetrunRules
  /** 敵人的種子（每一隊不同） */
  seed: string
  from?: string
}

/** 挑一組位階（規則表 patrol 裡隨機一種），照連動減少與降級。 */
export function patrolRanks(rules: NetrunRules, rand: GenRand, fx: Fx): Rank[] {
  const group = rules.patrol[Math.floor(rand() * rules.patrol.length)] ?? ['minion', 'minion']
  return encounterAfter(group, fx)
}

/** 生成一隊巡邏：路線挑不出來是 null。敵人是單位來源 enemy_pick 的 UnitRef（開始之前問過挑不挑得到）。 */
export function makePatrol(o: MakeOpts): Patrol | null {
  const route = pickRoute(o.graph, o.rand, o.rules.patrol_route, o.from)
  if (!route) return null
  const foes: UnitRef[] = patrolRanks(o.rules, o.rand, o.fx).map((rank, n) => ({
    from: 'enemy_pick', faction: o.faction ?? 'none', grade: o.grade, rank, seed: `${o.seed}/${n}`, ...(o.color ? { color: o.color } : {}), layer: o.layerName,
  }))
  return { id: o.id, sheet: o.sheet, route, foes, ...(o.faction ? { faction: o.faction } : {}), at: route[0]!, step: 0 }
}

/** 巡邏現在在哪個節點（路線與步數導出）。 */
export const patrolAt = (p: Pick<Patrol, 'route' | 'step'>): string => p.route[pingpong(p.step, p.route.length)]!

/** 這一層的巡邏往路線上走一步（每一隊各走一步）；回傳有動的。 */
export function stepPatrols(net: NetExt, sheet: string): Patrol[] {
  const moved: Patrol[] = []
  for (const p of net.patrols) {
    if (p.sheet !== sheet || p.gone) continue
    p.step += 1
    p.at = patrolAt(p)
    delete p.calm
    moved.push(p)
  }
  return moved
}

/** 節點 id 在圖上的格子。 */
export function nodePos(net: NetExt, sheet: string, id: string): [number, number] | undefined {
  return net.graph[sheet]?.nodes.find((n) => n.id === id)?.at
}

/** 把巡邏的位置寫進圖的狀態（SheetState.movers：畫面讀）；打贏了的（gone）記成拿掉。 */
export function moverChanges(run: Pick<NetRun, 'map'>, net: NetExt, patrols: readonly Patrol[]): Change[] {
  const bySheet = new Map<string, Record<string, { at: [number, number]; leg: number; gone?: boolean } | null>>()
  const put = (sheet: string, id: string, v: { at: [number, number]; leg: number; gone?: boolean }): void => {
    const cur = bySheet.get(sheet) ?? {}
    cur[id] = v
    bySheet.set(sheet, cur)
  }
  for (const p of patrols) {
    const at = nodePos(net, p.sheet, p.at)
    if (at) put(p.sheet, p.id, { at: [at[0], at[1]], leg: p.step, ...(p.gone ? { gone: true } : {}) })
  }
  return [...bySheet].map(([sheet, movers]) => ({ op: 'map.sheet', map: run.map, sheet, movers }) as Change)
}

/** 隊伍站在這個節點時，哪一隊巡邏在同一個節點或相鄰的節點（還沒擦身而過的、還活著的）。 */
export function nearPatrols(net: NetExt, sheet: string, node: string): Patrol[] {
  const graph = net.graph[sheet]
  if (!graph) return []
  const adj = adjacency(graph)
  return net.patrols.filter((p) => p.sheet === sheet && !p.gone && (p.at === node || (adj.get(node) ?? []).includes(p.at)))
}

/** 新一隊的編號：p1、p2……（打贏了的也留在清單裡，編號不重複）。 */
export const nextPatrolId = (net: NetExt): string => `p${net.patrols.length + 1}`

