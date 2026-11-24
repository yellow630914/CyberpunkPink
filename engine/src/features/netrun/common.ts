// L6 功能 netrun 的共用小工具：報告草稿、這一趟用的區、探索回合（感載消退、倒數、問 netrun.round）。

import type { Change, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { attrMod, clone } from '../../core'
import type { NetRegion, NetRun } from './model'
import { DEFAULT_REGIONS } from './model'
import { netrunRules, regionOf } from './rules'
import { layerLabel, partyOf, setupOf } from './start'

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
 * 隊上每個人感載消退 decay ＋ mod(意志) ＋ 甲板的冷卻（CYBERSPACE 8.1 節「探索不算脫離戰鬥」；餘韻不動）。
 * 預設只替感載還大於 0 的人產生變更；force 是不看現在的感載（一段路好幾格、或戰鬥結算之前讀到的是舊的感載時）。
 */
export function decayChanges(k: Kernel, state: GameState, force = false): Change[] {
  const rules = netrunRules(k)
  const out: Change[] = []
  for (const id of partyOf(state)) {
    if (!force && state.actors[id]!.load <= 0) continue
    // 甲板的冷卻（deck_cooling：deck 的衍生數值，沒有人定義就是 0）多消退幾點
    const cooling = k.stats.hasStat('deck_cooling') ? Math.max(0, k.stats.stat(state, id, 'deck_cooling')) : 0
    const dec = Math.max(0, rules.decay + attrMod(k.stats.effectiveAttr(state, id, 'resolve')) + cooling)
    if (dec > 0) out.push({ op: 'actor.track', id, track: 'load', delta: -dec })
  }
  return out
}

/** 問一次 netrun.round（之後的區回答），變更接起來。run 帶這一回合算進去之後的回合數。 */
export function roundHook(k: Kernel, state: GameState, run: NetRun): Change[] {
  return k.hooks.run('netrun.round', { state, run: clone(run) }).flatMap((h) => (Array.isArray(h.result) ? clone(h.result) : []))
}
