// L6 功能 netrun：探索回合的引擎（走上節點、下載、放東西、休息各算一個回合）與巡邏撞上、陷阱。
// 一段路好幾格時掛點每一格各呼叫一次、讀到的 state 都是這一段路開始之前的，所以回合、巡邏、陷阱的狀態都記在「工作用的一份」（Work：run 與 net 的拷貝），
// 每次有變就把整份 run 與 ext.net 寫進變更（後面的蓋掉前面的，最後一筆是這一段路走完的樣子）。
// 規格：CYBERSPACE 8.1 節（探索回合、巡邏、陷阱的感載）；dev/adr/0018 N5、N6、N8、N24。

import type { Change, GameState, GridPos, Kernel, Launch, ReportDraft, Sheet, TimelineBeat } from '../../core'
import { attrMod, clone, pointKey, rollCheck, sightOf } from '../../core'
import { checkBeat, passed, pickOf, rollPicked, skillAttr } from './checks'
import { decayChanges, draft, roundHook, runRegion, traceDelta } from './common'
import { battleLaunch } from './fight'
import type { NetExt, NetRun, Patrol, TrapState } from './model'
import { ACT_NET, DEFAULT_TRAP, TRACE, netExtChange, runChange } from './model'
import { moverChanges, nearPatrols, stepPatrols } from './patrol'
import { netrunRules } from './rules'
import { partyOf, setupOf } from './start'

/** 這一段的工作用的一份：run 與 ext.net 的拷貝，一路改下去。 */
export interface Work {
  run: NetRun
  net: NetExt
  /** 這一段已經有哪一部分改過（要寫進變更的） */
  runDirty: boolean
  netDirty: boolean
}

export const workOf = (run: NetRun, net: NetExt): Work => ({ run: clone(run), net: clone(net), runDirty: false, netDirty: false })

/** 把工作用的一份寫成變更（有改過的才寫）。 */
export function workChanges(state: GameState, w: Work): Change[] {
  const out: Change[] = []
  if (w.netDirty) out.push(netExtChange(state, w.run.map, w.net))
  if (w.runDirty) out.push(runChange(w.run))
  return out
}

export interface Out {
  changes: Change[]
  lines: string[]
  beats: TimelineBeat[]
  launch: Launch[]
  /** 接著要提交的報告（迴圈碎片把人送回入口） */
  followUps: ReportDraft[]
  /** 這一段路到這裡為止 */
  stop: boolean
}

export const newOut = (): Out => ({ changes: [], lines: [], beats: [], launch: [], followUps: [], stop: false })

/**
 * 過一個探索回合：回合數加一、定位的倒數少一、感載消退、問 netrun.round、每過 patrol_every 個回合這一層的巡邏走一步。
 * 回傳倒數到 0 了沒有（走路的人看它停下來；之後的收尾由 report.after）。
 */
export function advanceRound(k: Kernel, state: GameState, w: Work, out: Out): boolean {
  const rules = netrunRules(k)
  w.run.round += 1
  w.runDirty = true
  let located = false
  if (w.run.located !== undefined && w.run.located > 0) {
    w.run.located -= 1
    if (w.run.located === 0) {
      located = true
      out.lines.push('定位的倒數到了。')
    }
  }
  out.changes.push(...decayChanges(k, state), ...roundHook(k, state, w.run), ...roundTime(k, w.run, 1))
  if (w.run.round % rules.patrol_every === 0) {
    const sheet = w.run.layers[w.run.layer]!
    const moved = stepPatrols(w.net, sheet)
    if (moved.length) {
      w.netDirty = true
      out.changes.push(...moverChanges(w.run, w.net, moved))
    }
  }
  return located
}

/** 自己的那一趟每個探索回合過 round_minutes 分鐘（N35；委託的階段不算：里程碑的 120 分鐘已經含在裡面；戰鬥不另外算）。 */
export function roundTime(k: Kernel, run: Pick<NetRun, 'kind'>, rounds: number): Change[] {
  const minutes = netrunRules(k).round_minutes * rounds
  return run.kind === ACT_NET && minutes > 0 ? [{ op: 'time', minutes }] : []
}

// ---- 巡邏撞上 ----

/** 全隊潛行：各擲規則表 sneak_skills 裡加值最高的那一項，對 dc；都過才過。 */
export function teamStealth(k: Kernel, state: GameState, dc: number, purpose: string): { ok: boolean; beats: TimelineBeat[] } {
  const rules = netrunRules(k)
  const beats: TimelineBeat[] = []
  let ok = true
  for (const id of partyOf(state)) {
    let best: { roll: ReturnType<typeof rollCheck>; skill: string } | undefined
    for (const skill of rules.sneak_skills) {
      const roll = rollCheck(k.stats, state, { actor: id, attr: skillAttr(k, skill, 'reflex'), skill, dc, purpose: `${purpose}/${id}`, tags: ['netrun', 'sneak', 'infiltrate'] })
      if (!best || roll.total > best.roll.total) best = { roll, skill }
    }
    if (!passed(best!.roll)) ok = false
    beats.push(checkBeat(k, state, { id, attr: skillAttr(k, best!.skill, 'reflex'), skill: best!.skill, situation: [], mod: 0 }, best!.roll, '潛行'))
  }
  return { ok, beats }
}

/**
 * 隊伍站在節點 nodeId 上：同一個節點或相鄰的節點有巡邏，就先擲一次全隊的潛行（setup.stealth 的那一趟自動過，N24）；
 * 過了擦身而過（那一隊記 calm，拉開之前不再擲）；沒過就開戰（先攻在對方）。離得遠的把 calm 清掉。回傳要打的那一隊。
 */
export function meetPatrols(k: Kernel, state: GameState, w: Work, out: Out, nodeId: string): Patrol | null {
  const sheet = w.run.layers[w.run.layer]!
  const near = new Set(nearPatrols(w.net, sheet, nodeId).map((p) => p.id))
  for (const p of w.net.patrols) {
    if (p.sheet === sheet && !p.gone && !near.has(p.id) && p.calm) {
      delete p.calm
      w.netDirty = true
    }
  }
  for (const p of w.net.patrols) {
    if (!near.has(p.id) || p.calm) continue
    w.netDirty = true
    if (setupOf(w.run).stealth) {
      p.calm = true
      out.lines.push('巡邏的蕾絲從旁邊走過，沒有發現你們。')
      continue
    }
    const roll = teamStealth(k, state, w.net.dc, `netrun/${w.run.id}/patrol/${p.id}/${w.run.round}`)
    out.beats.push(...roll.beats)
    const detail = `（${roll.beats.map((b) => b.text).join('；')}）`
    if (roll.ok) {
      p.calm = true
      out.lines.push(`巡邏的蕾絲擦身而過，沒有發現你們${detail}。`)
      continue
    }
    out.lines.push(`巡邏的蕾絲發現了你們，先動手了${detail}。`)
    return p
  }
  return null
}

/** 這個節點上做完一個回合之後：巡邏撞上的話開戰（launch）。 */
export function patrolFight(k: Kernel, state: GameState, w: Work, out: Out, nodeId: string): void {
  const p = meetPatrols(k, state, w, out, nodeId)
  if (!p) return
  out.launch.push(battleLaunch(k, state, w.run, w.net, p.sheet, { id: p.id, name: '巡邏的蕾絲', foes: p.foes, ...(p.faction ? { faction: p.faction } : {}), patrol: true }, 'foe'))
  out.stop = true
}

// ---- 陷阱 ----

/** 看不看得到的陷阱：每一個進到視野的第一次，全隊最高的介面擲一次對 DC；過了就把那一格改成 net_alarm 或 net_loop（看得到、可以繞）。 */
export function revealTraps(k: Kernel, state: GameState, w: Work, out: Out, sheet: Sheet, at: GridPos): void {
  const sheetId = at.sheet
  const traps = w.net.traps[sheetId] ?? []
  const waiting = traps.filter((t) => !t.found && !t.checked && !t.used)
  if (!waiting.length) return
  const seen = sheet.visibleFrom({ x: at.x, y: at.y }, sightOf(sheet.def))
  for (const t of waiting) {
    if (!seen.has(pointKey(t.at[0], t.at[1]))) continue
    t.checked = true
    w.netDirty = true
    const pick = pickOf(k, state, partyOf(state), netrunRules(k).hack_skills)
    if (!pick) continue
    const roll = rollPicked(k, state, pick, w.net.dc, `netrun/${w.run.id}/trap/${sheetId}/${t.at[0]},${t.at[1]}`, ['netrun', 'detect'])
    if (!passed(roll)) continue
    t.found = true
    out.changes.push({ op: 'map.sheet', map: w.run.map, sheet: sheetId, cells: { [pointKey(t.at[0], t.at[1])]: { kind: t.kind } } })
    out.beats.push(checkBeat(k, state, pick, roll, '察覺了陷阱', 'netrun.detect'))
    out.lines.push(`${state.actors[pick.id]!.name}察覺了一個陷阱（${TRAP_NAME[t.kind]}）。`)
  }
}

const rngStep: Change = { op: 'rng', advance: 1 }

export const TRAP_NAME: Record<TrapState['kind'], string> = { net_alarm: '警報節點', net_loop: '迴圈碎片' }

/** 感載上限（核心的算法：衍生數值 load_cap，沒有就 20 ＋ 耐受的一半 ＋ 意志調整值 × 3）；探索中最多加到上限少一（過載是戰鬥裡的事）。 */
function loadRoom(k: Kernel, state: GameState, id: string): number {
  const a = state.actors[id]!
  const bridge = a.ext.bridge as { tolerance?: unknown } | undefined
  const tolerance = typeof bridge?.tolerance === 'number' ? bridge.tolerance : 0
  const cap = k.stats.hasStat('load_cap') ? k.stats.stat(state, id, 'load_cap') : 20 + Math.floor(tolerance / 2) + attrMod(k.stats.effectiveAttr(state, id, 'resolve')) * 3
  return Math.max(0, Math.max(1, cap) - 1 - a.load)
}

/** 踩上一個陷阱（沒看到的、看到了還是踩上去的都一樣；踩過的失效）。 */
export function springTrap(k: Kernel, state: GameState, w: Work, out: Out, at: GridPos): void {
  const sheetId = at.sheet
  const t = (w.net.traps[sheetId] ?? []).find((x) => x.at[0] === at.x && x.at[1] === at.y && !x.used)
  if (!t) return
  t.used = true
  w.netDirty = true
  const region = runRegion(k, w.run)
  const trap = region.trap ?? DEFAULT_TRAP
  // 看得到的那一格改回一般的鏈路（踩過的失效）
  out.changes.push({ op: 'map.sheet', map: w.run.map, sheet: sheetId, cells: { [pointKey(at.x, at.y)]: { kind: 'floor' } } })
  out.stop = true
  if (t.kind === 'net_alarm') {
    const up = traceDelta(w.run, trap.alarm)
    out.changes.push({ op: 'meter', kind: TRACE, key: w.run.map, delta: up })
    out.lines.push(`踩到了警報節點：追蹤度 +${up}。`)
    return
  }
  // 迴圈碎片：每個人擲介面或意志（取加值高的那一項）對 DC，失敗的人感載 +trap.loop_load（照等級乘）；有人失敗全隊被送回這一層的入口
  const rules = netrunRules(k)
  const add = Math.round(trap.loop_load * (rules.load_mult[w.run.grade - 1] ?? 1))
  const beats: TimelineBeat[] = []
  const changes: Change[] = []
  const failed: string[] = []
  for (const id of partyOf(state)) {
    const viaInterface = pickOf(k, state, [id], rules.hack_skills)
    const viaResolve = { id, attr: 'resolve' as const, situation: [], mod: attrMod(k.stats.effectiveAttr(state, id, 'resolve')) }
    const pick = viaInterface && viaInterface.mod >= viaResolve.mod ? viaInterface : viaResolve
    const roll = rollPicked(k, state, pick, w.net.dc, `netrun/${w.run.id}/loop/${sheetId}/${at.x},${at.y}/${id}`, ['netrun', 'trap'])
    beats.push(checkBeat(k, state, pick, roll, '擋迴圈碎片', 'netrun.trap'))
    if (passed(roll)) continue
    failed.push(id)
    const room = Math.min(add, loadRoom(k, state, id))
    if (room > 0) changes.push({ op: 'actor.track', id, track: 'load', delta: room })
  }
  const entry = sheetEntry(state, w.run, sheetId)
  const names = failed.map((id) => state.actors[id]!.name).join('、')
  if (!failed.length) {
    out.lines.push('踩到了迴圈碎片，全隊都擋住了。')
    out.followUps.push(draft(state, w.run, 'netrun.trap', 'loop_held', '迴圈碎片沒能困住你們：全隊都擋住了。', [rngStep], { timeline: beats }))
    return
  }
  out.lines.push(`踩到了迴圈碎片：${names}被灌了 ${add} 點感載，全隊被送回這一層的入口。`)
  const back: Change[] = [...changes, rngStep]
  if (entry) back.push({ op: 'map.at', to: { map: w.run.map, sheet: sheetId, x: entry[0], y: entry[1] } })
  out.followUps.push(draft(state, w.run, 'netrun.trap', 'loop', `迴圈碎片把全隊送回了這一層的入口，${names}的感載上升了。`, back, { timeline: beats }))
}

/** 這一層入口的格子。 */
export function sheetEntry(state: GameState, run: NetRun, sheetId: string): [number, number] | null {
  const m = state.maps.instances[run.map]?.gen?.map.sheets.find((s) => s.id === sheetId)?.cells?.find((c) => c.mark === 'E')
  return m ? [m.at[0], m.at[1]] : null
}

/** 現在站的格子是不是目標的那一格（下載與放東西的進度只在那一格算）。 */
export function onGoalCell(run: NetRun, at: Pick<GridPos, 'sheet' | 'x' | 'y'>): boolean {
  const g = run.goal.at
  return !!g && g.sheet === at.sheet && g.pos[0] === at.x && g.pos[1] === at.y
}

