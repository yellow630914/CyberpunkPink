// L6 功能 netrun：在網內的地圖上走（只在網內的地圖上作用；現實的探索 features/explore 看到網內的地圖一律不作用）。
// 隊伍每站上一個節點格算一個探索回合（N5；處理過的也算，走在鏈路上不算）：感載消退、回合數加一、定位的倒數少一、問 netrun.round。
// 自己去的那一趟（活動 netrun）進每一層的第一步帶觸發點 enter_floor（EVENTS 4.3 的「子網與內海」範圍）；委託的階段不帶（它屬於委託副本的範圍，EVENTS 4.4）。
// 走過一次就斷的鏈路（net_bridge）走過之後改成牆；單向的鏈路（net_valve）從對的那一邊才過得去；遭遇節點（net_foe）走不上去。

import type { GameState, GridCtx, GridEffect, Kernel, ReportTrigger } from '../../core'
import { clone, isNetMapKind, pointKey, valveAllows } from '../../core'
import { layerName } from './common'
import type { NetRun } from './model'
import { ACT_NET, netExt, nodeAt, readRun } from './model'
import { advanceRound, newOut, onGoalCell, patrolFight, revealTraps, springTrap, workChanges, workOf } from './rounds'
import type { Work } from './rounds'
import { usesOfMarker } from './uses'

interface Walk {
  state: GameState
  map: string
  /** 這一段路的工作用的一份（run 與 ext.net 的拷貝，一格一格改下去） */
  w: Work
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
    if (ctx.step <= 1 || !walk || walk.state !== ctx.state || walk.map !== ctx.at.map) walk = { state: ctx.state, map: ctx.at.map, w: workOf(run, net) }
    const w = walk.w
    const out = newOut()
    const triggers: ReportTrigger[] = []
    // 自己去的那一趟：進每一層的第一步發一次 enter_floor
    if (run.kind === ACT_NET && !w.run.entered.includes(ctx.at.sheet)) {
      w.run.entered.push(ctx.at.sheet)
      w.runDirty = true
      triggers.push({ point: 'enter_floor', where: { ...(typeof run.setup.where === 'object' && run.setup.where ? (clone(run.setup.where) as Record<string, unknown>) : { face: 'net', region: run.region }), layer: layerName({ ...run, layer: run.layers.indexOf(ctx.at.sheet) }) } })
    }
    // 走過一次就斷的鏈路：走過之後改成牆
    if (ctx.sheet.kindAt(ctx.at.x, ctx.at.y) === 'net_bridge') {
      out.changes.push({ op: 'map.sheet', map: ctx.at.map, sheet: ctx.at.sheet, cells: { [pointKey(ctx.at.x, ctx.at.y)]: { kind: 'wall' } } })
      out.lines.push('身後的鏈路斷了。')
    }
    // 離開目標的那一格：下載與放東西的進度歸零（N7）
    if ((w.run.goal.progress ?? 0) > 0 && w.run.goal.done !== true && !onGoalCell(w.run, ctx.at)) {
      w.run.goal = { ...w.run.goal, progress: 0 }
      w.runDirty = true
      out.lines.push('離開了目標的節點，進度歸零了。')
    }
    // 陷阱：進到視野的察覺一次；踩上去就觸發
    revealTraps(k, ctx.state, w, out, ctx.sheet, ctx.at)
    springTrap(k, ctx.state, w, out, ctx.at)
    // 站上一個節點：一個探索回合；巡邏照回合走，撞上了先擲潛行
    const node = nodeAt(w.net, ctx.at.sheet, ctx.at)
    if (node) {
      if (advanceRound(k, ctx.state, w, out)) out.stop = true
      patrolFight(k, ctx.state, w, out, node.id)
    }
    const changes = [...out.changes, ...workChanges(ctx.state, w)]
    if (!changes.length && !triggers.length && !out.lines.length && !out.beats.length) return undefined
    return {
      changes, ...(triggers.length ? { triggers } : {}), ...(out.stop ? { stop: true } : {}), ...(out.lines.length ? { line: out.lines.join('') } : {}),
      ...(out.launch.length ? { launch: out.launch } : {}), ...(out.followUps.length ? { followUps: out.followUps } : {}),
    }
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
    return run && net ? usesOfMarker(ctx.k as Kernel, ctx.state, run, net, ctx.at.sheet, marker) : []
  })
}
