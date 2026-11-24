// L6 功能 netrun：站在節點上（或站在遭遇節點旁邊）能做的事，與做它。
// 閘門（通過、往下一層、破解、憑證、後門鑰匙）、休息點（每一層一次）、遭遇節點（開戰、潛行繞過）；檔案庫、控制節點、人、安全點與擦痕跡在 nodes.ts。
// 規格：CYBERSPACE 8.1 節（節點表：閘門、休息點；「探索不算脫離戰鬥」）；dev/adr/0018 N5、N6、N23；dev/work/M3-netrun.md 要做的第 7、8 項、dev/work/M3-netrun-nodes.md。

import type { Change, GameState, GridCtx, GridUse, Kernel, MarkerDef, ReportDraft } from '../../core'
import { ActionBlocked, Sheet, clone, gridHere, instanceDef, sightOf } from '../../core'
import { draft, runRegion } from './common'
import { backdoorDraft, backdoorUse } from './dig'
import { fightDraft, foeNeighbours, foeNodeOf, sneakDraft } from './fight'
import type { NetExt, NetRun } from './model'
import { ACT_FACE, netExt, nodeAt, readRun, runChange } from './model'
import { doNodeUse, gateDraft, gateExtras, nodeUsesOf, wipeDraft, wipeUse } from './nodes'
import { advanceRound, newOut, patrolFight, workChanges, workOf } from './rounds'
import { netrunRules } from './rules'
import { partyOf, setupOf } from './start'

const BUSY = '正在戰鬥，先把這一場打完。'

/** 一份網內的地圖現在的位置（這個功能開的、而且人站在上面）。 */
export interface Here extends Pick<GridCtx, 'sheet' | 'at'> {
  run: NetRun
  net: NetExt
}

/** 現在站的位置；不在這一趟的地圖上是 null。 */
export function hereOf(k: Kernel, state: GameState): Here | null {
  const run = readRun(state)
  const g = gridHere(k, state)
  if (!run || !g || g.at.map !== run.map) return null
  const net = netExt(state, run.map)
  return net ? { sheet: g.sheet, at: g.at, run, net } : null
}

/** 這一層的閘門開了嗎：守著它的遭遇處理過了（打贏、繞過），或破解、憑證、後門鑰匙開了，或連動讓閘門不用破解。 */
export function gateOpen(run: NetRun, net: NetExt, sheetId: string): boolean {
  if (setupOf(run).fx.gate_open || net.opened.includes(sheetId)) return true
  return Object.values(net.foes[sheetId] ?? {}).every((f) => !f.gate || f.done === true)
}

const isLast = (run: NetRun): boolean => run.layer >= run.layers.length - 1

const GOAL_PHRASE: Record<string, string> = {
  download: '下載', seize: '接管控制節點', find: '找人', defeat: '打倒指定的敵人', plant: '放東西', extract: '把東西帶出來',
}

/** 閘門現在過不過得去，不能的原因（一句）。 */
export function gateBlock(state: GameState, run: NetRun, net: NetExt, sheetId: string): string | null {
  if (state.battle) return BUSY
  if (!gateOpen(run, net, sheetId)) return '閘門被守著：守著它的遭遇還沒處理（走到它旁邊，開戰或潛行繞過；有主控可以破解，也可以用憑證或後門鑰匙）。'
  if (isLast(run) && !['pass', 'clear'].includes(run.goal.kind)) {
    if (run.goal.kind === 'extract') return run.goal.got ? null : '這一趟要把東西帶出來，還沒拿到，不能就這樣離開。'
    return `這一趟的目標是「${GOAL_PHRASE[run.goal.kind] ?? run.goal.kind}」（${run.goal.kind}），還沒做到，不能就這樣離開。`
  }
  return null
}

/** 這張地圖的閘門 DC：地圖的 DC，追蹤度到過門檻（t1）之後加 gate_t1_dc（NETRUNNING 第 5 節；破解閘門的那一張讀它），再加詞條的 gate_dc（系統更新 −2）。 */
export const gateDc = (k: Kernel, net: NetExt): number => net.dc + (net.t30 ? netrunRules(k).gate_t1_dc : 0) + (net.dig?.fx.gate_dc ?? 0)

/** 一個標記現在能做的事（畫面走到上面立刻列出來，按了才做）。遭遇節點是站在旁邊才列。 */
export function usesOfMarker(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): GridUse[] {
  // 區的主人自己處理的標記（region.handled；例：迷宮館的寶箱與機關）：這裡不列
  if (runRegion(k, run).handled?.includes(marker.mark)) return []
  switch (marker.mark) {
    case 'g':
      return [
        isLast(run)
          ? { id: 'pass', name: '通過出口', block: gateBlock(state, run, net, sheetId) }
          : { id: 'descend', name: '往下一層', block: gateBlock(state, run, net, sheetId) },
        ...gateExtras(k, state, run, net, gateOpen(run, net, sheetId)),
      ]
    case 'r':
      return [{ id: 'rest', name: '短休', block: state.battle ? BUSY : net.rested.includes(sheetId) ? '這一層的休息點已經用過了。' : null }]
    case 'f': {
      const node = foeNodeOf(net, sheetId, marker.id)
      const block = state.battle ? BUSY : !node || node.done ? '這個節點上已經沒有東西守著了。' : null
      return [{ id: 'fight', name: '開戰', block }, { id: 'sneak', name: '潛行繞過', block }]
    }
    default:
      return nodeUsesOf(k, state, run, net, sheetId, marker) ?? []
  }
}

/** 不在哪一格都能做的事（探索中的管理行動：擦痕跡）；沒有主控的隊伍沒有。 */
export function freeUses(k: Kernel, state: GameState): GridUse[] {
  const h = hereOf(k, state)
  return h ? [wipeUse(k, state, h.run, h.net), backdoorUse(k, state, h.run, h.net)].filter((u): u is GridUse => !!u) : []
}

/** 現在站的這一格能做的事（站在遭遇節點旁邊的不在這裡，見 netrunView.near）。 */
export function nodeUses(k: Kernel, state: GameState): GridUse[] {
  const h = hereOf(k, state)
  const marker = h?.sheet.markerAt(h.at.x, h.at.y)
  return h && marker ? usesOfMarker(k, state, h.run, h.net, h.at.sheet, marker) : []
}

// ---- 做 ----

/**
 * 做一件事：id 是 fight、sneak、rest、pass、descend；at 是標記的 id（遭遇節點站在旁邊時要寫；沒寫就是現在站的這一格）。
 * 回傳報告草稿；不成立丟 ActionBlocked（原因是給玩家看的完整句子）。
 */
export function useNode(k: Kernel, state: GameState, id: string, at?: string): ReportDraft {
  const h = hereOf(k, state)
  if (!h) throw new ActionBlocked('現在不在網內的地圖上。')
  const { run, net } = h
  const sheetId = h.at.sheet
  // 擦痕跡：做在哪一格都可以
  if (id === 'wipe') return wipeDraft(k, state, run, net)
  // 留後門：自己去挖的子網，做在哪一格都可以
  if (id === 'backdoor') return backdoorDraft(k, state, run, net)
  const standing = h.sheet.markerAt(h.at.x, h.at.y)
  let marker = standing
  if (at !== undefined) {
    marker = h.sheet.marker(at)
    if (!marker) throw new ActionBlocked(`這一層沒有「${at}」這個節點。`)
    const adjacent = Math.abs(marker.at[0] - h.at.x) + Math.abs(marker.at[1] - h.at.y) === 1
    if (marker.id !== standing?.id && !adjacent) throw new ActionBlocked(`「${marker.name}」離這裡太遠了，要走到它旁邊（或站在上面）。`)
  }
  if (!marker) throw new ActionBlocked('這一格什麼都沒有，沒有可以做的事。')
  if (marker.mark === 'f' && at === undefined) throw new ActionBlocked(`「${marker.name}」站不上去，要走到它旁邊再選。`)
  const use = usesOfMarker(k, state, run, net, sheetId, marker).find((u) => u.id === id)
  if (!use) throw new ActionBlocked(`這裡沒有「${id}」可以做。`)
  if (use.block) throw new ActionBlocked(use.block)
  switch (id) {
    case 'fight': return fightDraft(k, state, run, net, sheetId, marker)
    case 'sneak': return sneakDraft(k, state, run, net, sheetId, marker)
    case 'rest': return restDraft(k, state, run, net, sheetId, marker)
    case 'descend': return descend(k, state)
    case 'pass': return passDraft(state, run)
    case 'crack':
    case 'cred':
    case 'crack_key':
      return gateDraft(k, state, run, net, sheetId, id, gateDc(k, net))
    default: {
      const made = doNodeUse(k, state, run, net, sheetId, marker, id)
      if (!made) throw new ActionBlocked(`這裡沒有「${id}」可以做。`)
      return made
    }
  }
}

/** 站在遭遇節點旁邊的清單（給 netrunView）。 */
export function nearFoes(k: Kernel, state: GameState): Array<{ marker: MarkerDef; uses: GridUse[] }> {
  const h = hereOf(k, state)
  if (!h) return []
  return foeNeighbours(h, h.net).map((marker) => ({ marker, uses: usesOfMarker(k, state, h.run, h.net, h.at.sheet, marker) }))
}

/** 通過（最後一層的閘門）：記成目標達成；這一份套用之後 report.after 接著收尾（交回 done）。 */
function passDraft(state: GameState, run: NetRun): ReportDraft {
  return draft(state, run, 'netrun.use', 'pass', '穿過了閘門。', [runChange({ ...clone(run), goal: { ...clone(run.goal), done: true } })])
}

/** 休息點：全隊感載歸零、餘韻全消（RAM 在戰鬥外不算）；這一層一次；算一個探索回合，這個回合追蹤度不漲。 */
function restDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): ReportDraft {
  const changes: Change[] = []
  for (const id of partyOf(state)) {
    const a = state.actors[id]!
    if (a.load > 0) changes.push({ op: 'actor.track', id, track: 'load', delta: -a.load })
    if (a.afterglow > 0) changes.push({ op: 'actor.track', id, track: 'afterglow', delta: -a.afterglow })
  }
  const w = workOf(run, net)
  const out = newOut()
  w.net.rested = [...w.net.rested, sheetId]
  w.netDirty = true
  advanceRound(k, state, w, out)
  const node = nodeAt(w.net, sheetId, marker.at)
  if (node) patrolFight(k, state, w, out, node.id)
  return draft(state, w.run, 'netrun.use', 'rest', ['在休息點歇了一口氣：感載歸零、餘韻全消。', ...out.lines].join(''), [...changes, ...out.changes, ...workChanges(state, w)], {
    ...(out.beats.length ? { timeline: out.beats } : {}), ...(out.launch.length ? { launch: out.launch } : {}),
  })
}

/**
 * 站在節點上做一件事也過一個探索回合（N5）：回合數加一、定位的倒數少一、問 netrun.round、這一層的巡邏照回合走。回傳的變更含這一趟的新狀態（最後一筆是 ext.netrun），
 * 要接在別的變更後面。這個函式不處理「巡邏撞上」（變更放不下一場戰鬥）；站在節點上做事的（下載、休息）由這個功能自己的報告處理。
 */
export function tickRun(k: Kernel, state: GameState, run: NetRun): Change[] {
  const net = netExt(state, run.map)
  const w = workOf(run, net ?? ({ patrols: [], graph: {} } as unknown as NetExt))
  const out = newOut()
  advanceRound(k, state, w, out)
  return [...out.changes, ...workChanges(state, w)]
}

/** 往下一層：站在已經打開的閘門上；人放到下一層的入口，追蹤度不歸零。 */
export function descend(k: Kernel, state: GameState): ReportDraft {
  const h = hereOf(k, state)
  if (!h) throw new ActionBlocked('現在不在網內的地圖上。')
  const { run, net } = h
  const marker = h.sheet.markerAt(h.at.x, h.at.y)
  if (!marker || marker.mark !== 'g') throw new ActionBlocked('要站在閘門上才能往下一層。')
  if (isLast(run)) throw new ActionBlocked('這已經是最後一層了，沒有下一層。')
  const block = gateBlock(state, run, net, h.at.sheet)
  if (block) throw new ActionBlocked(block)
  const nextId = run.layers[run.layer + 1]!
  const instance = state.maps.instances[run.map]!
  const def = instanceDef(k, instance).sheets.find((s) => s.id === nextId)
  const entry = def?.cells?.find((m) => m.mark === 'E')
  if (!def || !entry) throw new ActionBlocked('下一層的入口找不到，下不去。')
  // 到了就看得到周圍（和開地圖時一樣）
  const sheet = new Sheet(def, instance.sheets[nextId]?.cells ?? {})
  const rows = (instance.sheets[nextId]?.seen?.length === sheet.h ? instance.sheets[nextId]!.seen : def.layout.map((r) => '0'.repeat([...r].length))).map((r) => [...r])
  for (const key of sheet.visibleFrom({ x: entry.at[0], y: entry.at[1] }, sightOf(def))) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (rows[y]?.[x] !== undefined) rows[y]![x] = '1'
  }
  const changes: Change[] = [
    { op: 'map.sheet', map: run.map, sheet: nextId, seen: rows.map((r) => r.join('')) },
    { op: 'map.at', to: { map: run.map, sheet: nextId, x: entry.at[0], y: entry.at[1] } },
    runChange({ ...clone(run), layer: run.layer + 1 }),
  ]
  return draft(state, { ...run, layer: run.layer + 1 }, 'netrun.descend', 'descend', `穿過閘門，到了${def.name}。追蹤度沒有歸零。`, changes)
}

/** 這一趟要是被問「現在是委託的階段嗎」（畫面提醒登出會撤退）。 */
export const isFace = (run: NetRun): boolean => run.kind === ACT_FACE

