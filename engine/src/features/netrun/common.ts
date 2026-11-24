// L6 功能 netrun 的共用小工具：報告草稿、這一趟用的區、探索回合（感載消退、倒數、問 netrun.round）。

import type { Change, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { clone, modeOf } from '../../core'
import type { NetRegion, NetRun } from './model'
import { DEFAULT_REGIONS, NET_MODE } from './model'
import { netrunRules, regionOf } from './rules'
import { layerLabel, partyOf, setupOf } from './start'

/**
 * 追蹤度加減的量照連動：這一段的 fx.trace_half 讓「上升」減半（進位；M3 審查應修 2）。減少的不動。
 * 所有自己寫的追蹤度變更（下載、警報節點、探索中的管理行動）都要經過這裡；從效果進來的量由量表的 adjust 減半，戰鬥裡的由 netcombat 的 addTrace 看 origin.ext.net.trace_half。
 */
export function traceDelta(run: NetRun, delta: number): number {
  return delta > 0 && setupOf(run).fx.trace_half ? Math.ceil(delta / 2) : delta
}

/** 一份網內的報告草稿（kind netrun；location 帶子網的 id 與第幾層）。 */
export function draft(state: GameState, run: NetRun | null, action: string, result: string, summary: string, changes: Change[], extra: Partial<ReportDraft> = {}): ReportDraft {
  return {
    kind: 'netrun', action, location: { ...clone(state.location), ...(run ? { subnet: { id: run.region, layer: run.layer + 1 } } : {}) }, ...(state.pc ? { actor: state.pc } : {}),
    party: [], timeline: [], changes, outcome: { result, summary }, ...extra,
  }
}

/** 這一趟用的區：開始時整筆給的（run.setup.region 是物件）用它自己的，否則照 id 找資料與內建的（找不到退回內建的 subnet）。 */
export function runRegion(k: Pick<Kernel, 'content'>, run: NetRun): NetRegion {
  const found = regionOf(k, run.setup.region !== undefined && typeof run.setup.region === 'object' ? run.setup.region : run.region)
  return 'region' in found ? found.region : clone(DEFAULT_REGIONS.subnet!)
}

/** 現在這一層的名字。 */
export function layerName(run: NetRun): string {
  return layerLabel(setupOf(run).layers[run.layer], run.layer)
}

export const beatOf = (actor: string | undefined, text: string, extra: Partial<TimelineBeat> = {}): TimelineBeat => ({ layer: 'net', ...(actor ? { actor } : {}), text, ...extra })

/**
 * 隊上每個人感載消退（CYBERSPACE 8.1 節「探索不算脫離戰鬥」；餘韻不動）。使用者 2026-11-24：內海裡基礎消退是 0，不再有「2 ＋ mod(意志)」；
 * 消退量 = 規則表的 decay（預設 0）＋ 這個戰場讀的那個衍生數值（內海 net_load_decay：甲板的散熱 deck_cooling、技能、構裝、藥、狀態都可以加；沒有人定義是 0）。戰鬥裡的消退是同一個數值（核心的 turn.ts）。
 * 預設只替感載還大於 0 的人產生變更；force 是不看現在的感載（一段路好幾格、或戰鬥結算之前讀到的是舊的感載時）。
 */
export function decayChanges(k: Kernel, state: GameState, force = false): Change[] {
  const rules = netrunRules(k)
  const stat = modeOf(k.content, NET_MODE)?.decayStat ?? 'net_load_decay'
  const out: Change[] = []
  for (const id of partyOf(state)) {
    if (!force && state.actors[id]!.load <= 0) continue
    const extra = k.stats.hasStat(stat) ? Math.floor(k.stats.stat(state, id, stat)) : 0
    const dec = Math.max(0, rules.decay + extra)
    if (dec > 0) out.push({ op: 'actor.track', id, track: 'load', delta: -dec })
  }
  return out
}

/** 問一次 netrun.round（之後的區回答），變更接起來。run 帶這一回合算進去之後的回合數。 */
export function roundHook(k: Kernel, state: GameState, run: NetRun): Change[] {
  return k.hooks.run('netrun.round', { state, run: clone(run) }).flatMap((h) => (Array.isArray(h.result) ? clone(h.result) : []))
}
