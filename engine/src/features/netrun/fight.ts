// L6 功能 netrun：遭遇節點的開戰、潛行繞過、戰鬥打完之後（dev/adr/0018 N6、N22、N24、N31；dev/work/M3-netrun.md 要做的第 4、5 項）。
// 遭遇節點走不上去：站在它旁邊時列出「開戰」與「潛行繞過」（uses.ts），選了才做。這個功能不知道行動表（netcombat）與敵人的內部：
// 追蹤度從量表抄進戰鬥的 field.trace、打完抄回來；敵人只經由單位來源 enemy_pick 的 UnitRef；戰鬥怎麼走看開戰的設定與 origin.ext.net。

import type { BattleSetup, BattleState, Change, GameState, GridCtx, Kernel, Launch, MarkerDef, ReportDraft, TimelineBeat, UnitRef } from '../../core'
import { ActionBlocked, clone, isRecord, meterOf, pointKey } from '../../core'
import { beatOf, decayChanges, draft, roundHook, runRegion } from './common'
import type { FoeNode, NetExt, NetRun } from './model'
import { ACT_FACE, NET_MODE, OWNER, TRACE, netExtChange, readRun, runChange, netExt } from './model'
import { moverChanges } from './patrol'
import { roundTime, teamStealth } from './rounds'
import { netrunRules } from './rules'
import { layerLabel, partyOf, setupOf } from './start'

/** 帶進戰鬥的、發起這一趟的人給的鍵：副本靠 commission 與 stage 認出「這一場是我的」，戰敗的流程讀 defeat_event 與 located_event。 */
const GIVEN_KEYS = ['commission', 'stage', 'face', 'defeat_event', 'located_event', 'employer'] as const

/** 增援（戰鬥裡追蹤度到 30、60 時叫人）：30 是一隻白蕾絲、60 是一個精英，都用 enemy_pick；挑不到的不給。 */
export function reinforceOf(k: Kernel, state: GameState, run: NetRun): Record<string, UnitRef> {
  const source = k.battle.getUnitSource('enemy_pick')
  if (!source) return {}
  const faction = run.faction ?? 'none'
  const refs: Record<string, UnitRef> = {
    t30: { from: 'enemy_pick', faction, grade: run.grade, rank: 'minion', color: 'white', seed: `${run.id}/t30` },
    t60: { from: 'enemy_pick', faction, grade: run.grade, rank: 'elite', seed: `${run.id}/t60` },
  }
  const out: Record<string, UnitRef> = {}
  for (const [key, ref] of Object.entries(refs)) {
    try {
      source(ref, { k, state, side: 'foe', mode: NET_MODE, grade: run.grade as never, allyCount: partyOf(state).length })
      out[key] = ref
    } catch {
      // 挑不到就不給
    }
  }
  return out
}

/** 一個遭遇節點處理過了（打贏、繞過）：那一格改成地板（也記 used，免得再站上去觸發標記）、這一場記成做完。 */
export function handledChanges(state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): Change[] {
  const next = clone(net)
  const node = next.foes[sheetId]?.[marker.id]
  if (node) node.done = true
  return [
    { op: 'map.sheet', map: run.map, sheet: sheetId, cells: { [pointKey(marker.at[0], marker.at[1])]: { kind: 'floor', used: true } } },
    netExtChange(state, run.map, next),
  ]
}

/** 這個遭遇節點放的那一場。 */
export const foeNodeOf = (net: NetExt, sheetId: string, markerId: string): FoeNode | undefined => net.foes[sheetId]?.[markerId]

/** 一場開戰的對象：遭遇節點（id 是標記的 id）或一隊巡邏（patrol: true，id 是巡邏的編號）。 */
export interface FightTarget {
  id: string
  name: string
  foes: UnitRef[]
  faction?: string
  patrol?: boolean
}

/** 遭遇節點開戰的對象。 */
const targetOf = (node: FoeNode, marker: Pick<MarkerDef, 'id' | 'name'>): FightTarget => ({ id: marker.id, name: marker.name, foes: node.foes, ...(node.faction ? { faction: node.faction } : {}) })

/**
 * 開戰：回傳一份要接著開的戰鬥（Launch）。我方是隊上的人、敵方是這個節點放的人、遮蔽照區的規則；
 * origin.ext 帶發起這一趟的人給的 commission、stage、face、defeat_event、employer，加 net（這個功能與戰鬥約定的鍵：netcombat 讀 dc、reinforce、locate_rounds）。
 * edge 是 'foe'：潛行沒過，對方有先攻的優勢。
 */
export function battleLaunch(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, target: FightTarget, edge?: 'foe'): Launch {
  if (!target.foes.length) throw new ActionBlocked('這個節點上沒有東西守著。')
  const region = runRegion(k, run)
  const rules = netrunRules(k)
  const given = isRecord(run.origin.ext) ? run.origin.ext : {}
  const ext: Record<string, unknown> = {}
  for (const key of GIVEN_KEYS) {
    const v = given[key] ?? run.setup[key]
    if (v !== undefined && v !== null) ext[key] = clone(v)
  }
  // 寂靜（詞條 first_ambush）：第一場遭遇我方先手（潛行沒過的先攻在對方，優先；巡邏不算）
  const ambush = edge === undefined && !target.patrol && net.dig?.fx.first_ambush === true && run.ambush_used !== true
  ext.net = {
    run: run.id, map: run.map, sheet: sheetId, node: target.id, region: run.region, dc: net.dc,
    reinforce: reinforceOf(k, state, run), locate_rounds: rules.locate_rounds, ...(target.patrol ? { patrol: true } : {}), ...(ambush ? { ambush: true } : {}),
  }
  const field: Record<string, boolean | number> = {}
  if (region.pressure === 'trace' && k.meters.has(TRACE)) field.trace = meterOf(k, state, TRACE, run.map)
  if (region.safe) field.safe = true
  const setup: BattleSetup = {
    mode: NET_MODE, grade: run.grade as never, cover: clone(region.cover), field,
    allies: partyOf(state).map((id) => ({ from: 'actor', id })), foes: clone(target.foes),
    ...(edge ? { edge } : ambush ? { edge: 'ally' as const } : {}),
    origin: { escapable: true, place: `${layerLabel(setupOf(run).layers[run.layer], run.layer)}・${target.name}`, ...(target.faction ? { faction: target.faction } : {}) },
  }
  return { kind: 'battle', setup, origin: { by: OWNER, ref: run.id, ext } }
}

/** 開戰（選了「開戰」）。 */
export function fightDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): ReportDraft {
  const node = foeNodeOf(net, sheetId, marker.id)
  if (!node || node.done) throw new ActionBlocked('這個節點上沒有東西守著。')
  const launch = battleLaunch(k, state, run, net, sheetId, targetOf(node, marker))
  return draft(state, run, 'netrun.use', 'fight', `你對「${marker.name}」開戰。`, [], { launch: [launch] })
}

/**
 * 潛行繞過：全隊各擲一次潛行對地圖的 DC，都過才過；setup.stealth 是 true 時第一次自動成功（N24）。
 * 過了：節點變地板、這一場記成處理過。沒過：開戰，而且對方有先攻的優勢（edge: 'foe'）。
 */
export function sneakDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt, sheetId: string, marker: MarkerDef): ReportDraft {
  const node = foeNodeOf(net, sheetId, marker.id)
  if (!node || node.done) throw new ActionBlocked('這個節點上沒有東西守著。')
  const free = setupOf(run).stealth && run.stealth_used !== true
  const beats: TimelineBeat[] = []
  const changes: Change[] = [{ op: 'rng', advance: 1 }]
  let ok = true
  if (free) {
    beats.push(beatOf(undefined, '這一趟是悄悄潛進來的：第一次繞過不必擲。', { tag: 'netrun.sneak', data: { free: true } }))
    changes.push(runChange({ ...clone(run), stealth_used: true }))
  } else {
    const rolled = teamStealth(k, state, net.dc, `netrun/${run.id}/sneak/${sheetId}/${marker.id}`)
    ok = rolled.ok
    beats.push(...rolled.beats)
  }
  if (ok) {
    changes.push(...handledChanges(state, run, net, sheetId, marker))
    return draft(state, run, 'netrun.use', 'sneak', `你們悄悄繞過了「${marker.name}」。`, changes, { timeline: beats })
  }
  const launch = battleLaunch(k, state, run, net, sheetId, targetOf(node, marker), 'foe')
  return draft(state, run, 'netrun.use', 'sneak_fail', `潛行沒過，「${marker.name}」發現了你們，先動手了。`, changes, { timeline: beats, launch: [launch] })
}

/** 站在這一格旁邊的遭遇節點（還沒處理的）。 */
export function foeNeighbours(here: Pick<GridCtx, 'sheet' | 'at'>, net: NetExt): MarkerDef[] {
  const out: MarkerDef[] = []
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const m = here.sheet.markerAt(here.at.x + dx, here.at.y + dy)
    if (m && here.sheet.kindAt(m.at[0], m.at[1]) === 'net_foe' && net.foes[here.at.sheet]?.[m.id] && !net.foes[here.at.sheet]![m.id]!.done) out.push(m)
  }
  return out
}

/** 戰鬥打完（k.battle.onEnd）：只認 origin.ext.net.run 是這一趟的。 */
export function onBattleEnd(k: Kernel, state: GameState, battle: BattleState, outcome: string): { changes: Change[]; lines: string[] } | undefined {
  const link = battle.origin.ext?.net
  const run = readRun(state)
  if (!run || !isRecord(link) || link.run !== run.id || link.map !== run.map) return undefined
  const net = netExt(state, run.map)
  if (!net) return undefined
  const changes: Change[] = []
  const lines: string[] = []
  let next: NetRun = clone(run)
  if (link.ambush === true) next.ambush_used = true
  // 追蹤度寫回量表（戰鬥裡的追蹤度是場地上的一個數字；沒有這個欄位就是沒有追蹤度的地方）
  const trace = battle.field.trace
  if (typeof trace === 'number' && Number.isFinite(trace) && k.meters.has(TRACE)) {
    changes.push({ op: 'meter', kind: TRACE, key: run.map, set: Math.round(trace) })
    next.peak = Math.max(next.peak, Math.round(trace))
  }
  const sheetId = typeof link.sheet === 'string' ? link.sheet : run.layers[run.layer]!
  const patrolId = link.patrol === true && typeof link.node === 'string' ? link.node : undefined
  const marker = typeof link.node === 'string' && !patrolId ? findMarker(state, run, sheetId, link.node) : undefined
  // 巡邏：打贏就沒有了；全隊脫身（破解）算擦身而過
  if (patrolId && (outcome === 'win' || outcome === 'fled')) {
    const nextNet = clone(net)
    const p = nextNet.patrols.find((x) => x.id === patrolId)
    if (p) {
      if (outcome === 'win') p.gone = true
      else p.calm = true
      changes.push(netExtChange(state, run.map, nextNet), ...moverChanges(run, nextNet, [p]))
      lines.push(outcome === 'win' ? '巡邏的蕾絲處理掉了。' : '從巡邏的蕾絲身邊溜走了。')
    }
  }
  // 贏了（或破解成功全隊脫身：N31，算過了，只是拿不到掉落）：節點變地板
  if ((outcome === 'win' || outcome === 'fled') && marker) {
    changes.push(...handledChanges(state, run, net, sheetId, marker))
    lines.push(outcome === 'fled' ? `從「${marker.name}」身邊溜過去了。` : `「${marker.name}」處理掉了。`)
    // 打倒：那一場打贏、指定的敵人在場
    const g = next.goal
    if (outcome === 'win' && g.kind === 'defeat' && g.at?.sheet === sheetId && g.at.id === marker.id && (typeof g.foe !== 'string' || Object.values(battle.units).some((u) => u.enemy === g.foe))) {
      next.goal = { ...g, done: true }
      lines.push('要打倒的那一個倒下了。')
    }
  }
  // 贏了之後被釘住的隊友自動拆釘子，算一個探索回合（N22）
  const unpinned = outcome === 'win' && Object.values(battle.units).some((u) => u.side === 'ally' && isRecord(u.ext.net) && u.ext.net.unpinned === true)
  if (unpinned) {
    for (let i = 0; i < netrunRules(k).unpinned_rounds; i++) {
      next = { ...next, round: next.round + 1, ...(next.located !== undefined ? { located: Math.max(0, next.located - 1) } : {}) }
      changes.push(...decayChanges(k, state, true), ...roundHook(k, state, next), ...roundTime(k, next, 1))
    }
    lines.push('釘子拆掉花了一點時間。')
  }
  // 全員拔線：委託的階段是撤退（N13），自己去的那一趟是離開；這一份報告套用之後 report.after 接著收尾
  if (outcome === 'jack_out') next.over = run.kind === ACT_FACE ? 'retreat' : 'left'
  changes.push(runChange(next))
  return { changes, lines }
}

/** 地圖上的那個標記（遭遇節點的 id 在版面上）。 */
function findMarker(state: GameState, run: NetRun, sheetId: string, id: string): MarkerDef | undefined {
  const def = state.maps.instances[run.map]?.gen?.map.sheets.find((s) => s.id === sheetId)
  return def?.cells?.find((m) => m.id === id)
}
