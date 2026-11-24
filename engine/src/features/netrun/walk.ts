// L6 功能 netrun：在網內的地圖上走（只在網內的地圖上作用；現實的探索 features/explore 看到網內的地圖一律不作用）。
// 隊伍每站上一個節點格算一個探索回合（N5；處理過的也算，走在鏈路上不算）：感載消退、回合數加一、定位的倒數少一、問 netrun.round。
// 自己去的那一趟（活動 netrun）進每一層的第一步帶觸發點 enter_floor（EVENTS 4.3 的「子網與內海」範圍）；委託的階段不帶（它屬於委託副本的範圍，EVENTS 4.4）。
// 走過一次就斷的鏈路（net_bridge）走過之後改成牆；單向的鏈路（net_valve）從對的那一邊才過得去；遭遇節點（net_foe）走不上去。

import type { Change, GameState, GridCtx, GridEffect, Kernel, ReportTrigger } from '../../core'
import { clone, isNetMapKind, pointKey, valveAllows } from '../../core'
import { decayChanges, layerName, roundHook } from './common'
import type { NetRun } from './model'
import { ACT_NET, netExt, nodeAt, readRun, runChange } from './model'
import { usesOfMarker } from './uses'

interface Walk {
  state: GameState
  map: string
  /** 這一段路已經過了幾個探索回合 */
  rounds: number
  located: number | undefined
  entered: string[]
}

const inRun = (ctx: Pick<GridCtx, 'map' | 'state' | 'at'>): NetRun | null => {
  if (!isNetMapKind(ctx.map.kind)) return null
  const run = readRun(ctx.state)
  return run && run.map === ctx.at.map ? run : null
}

/** 安裝走路的規則。每個 kernel 一份狀態（這一段路的累積；一段路好幾格時掛點每一格各呼叫一次，讀到的 state 都是這一段路開始之前的）。 */
export function installWalk(k: Kernel, owner: string): void {
  let walk: Walk | null = null

  k.grid.onEnter(owner, (ctx): GridEffect | void => {
    const run = inRun(ctx)
    const net = run ? netExt(ctx.state, run.map) : null
    if (!run || !net) return
    if (ctx.step <= 1 || !walk || walk.state !== ctx.state || walk.map !== ctx.at.map) walk = { state: ctx.state, map: ctx.at.map, rounds: 0, located: run.located, entered: [...run.entered] }
    const w = walk
    const changes: Change[] = []
    const triggers: ReportTrigger[] = []
    const lines: string[] = []
    let stop = false
    // 自己去的那一趟：進每一層的第一步發一次 enter_floor
    let dirty = false
    if (run.kind === ACT_NET && !w.entered.includes(ctx.at.sheet)) {
      w.entered.push(ctx.at.sheet)
      dirty = true
      triggers.push({ point: 'enter_floor', where: { ...(typeof run.setup.where === 'object' && run.setup.where ? (clone(run.setup.where) as Record<string, unknown>) : { face: 'net', region: run.region }), layer: layerName({ ...run, layer: run.layers.indexOf(ctx.at.sheet) }) } })
    }
    // 走過一次就斷的鏈路：走過之後改成牆
    if (ctx.sheet.kindAt(ctx.at.x, ctx.at.y) === 'net_bridge') {
      changes.push({ op: 'map.sheet', map: ctx.at.map, sheet: ctx.at.sheet, cells: { [pointKey(ctx.at.x, ctx.at.y)]: { kind: 'wall' } } })
      lines.push('身後的鏈路斷了。')
    }
    // 站上一個節點：一個探索回合
    if (nodeAt(net, ctx.at.sheet, ctx.at)) {
      w.rounds += 1
      dirty = true
      if (w.located !== undefined && w.located > 0) {
        w.located -= 1
        if (w.located === 0) {
          stop = true
          lines.push('定位的倒數到了。')
        }
      }
      changes.push(...decayChanges(k, ctx.state), ...roundHook(k, ctx.state, { ...run, round: run.round + w.rounds, ...(w.located !== undefined ? { located: w.located } : {}) }))
    }
    if (dirty) {
      const next: NetRun = { ...clone(run), round: run.round + w.rounds, entered: [...w.entered] }
      if (w.located !== undefined) next.located = w.located
      changes.push(runChange(next))
    }
    if (!changes.length && !triggers.length && !lines.length) return undefined
    return { changes, ...(triggers.length ? { triggers } : {}), ...(stop ? { stop: true } : {}), ...(lines.length ? { line: lines.join('') } : {}) }
  })

  // 遭遇節點：走不上去。站到它旁邊，選開戰或潛行繞過
  k.grid.passRule('net_foe', owner, (ctx, x, y) => `有東西守在「${ctx.sheet.markerAt(x, y)?.name ?? '這個節點'}」上，走不上去：站到它旁邊，選開戰或潛行繞過。`)

  // 單向的鏈路：從對的那一邊才過得去（拿到的 ctx.at 是現在站的那一格）
  k.grid.passRule('net_valve', owner, (ctx, x, y) => {
    const graph = netExt(ctx.state, ctx.at.map)?.graph[ctx.at.sheet]
    return graph && valveAllows(graph, [x, y], [ctx.at.x, ctx.at.y]) ? null : '這條鏈路是單向的，從這一邊過不去。'
  })

  // 站在標記上能做的事
  k.grid.usesOf(owner, (ctx, marker) => {
    const run = inRun(ctx)
    const net = run ? netExt(ctx.state, run.map) : null
    return run && net ? usesOfMarker(ctx.state, run, net, ctx.at.sheet, marker) : []
  })
}
