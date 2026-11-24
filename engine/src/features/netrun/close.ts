// L6 功能 netrun：結束一趟（登出、通過、被定位、戰敗被接受）與追蹤度的門檻。
// 規格：CYBERSPACE 6.8、8.1 節（追蹤度、帶出去才算數）；NETRUNNING 第 5 節；dev/adr/0018 第六、七、十節與 N13、N15；dev/work/M3-netrun.md 要做的第 6、9、10、11 項。
// 離開的四種方式與交回的 outcome：done（目標達成）、left（探索中拔線登出，東西全部帶走）、retreat（委託副本裡全員拔線或探索中登出：等於撤退）、located（探索中被定位）。
// 戰鬥打輸不由這裡交回：戰敗被接受之後只把這一趟收掉（關地圖、清狀態），不另外發自己的 activity.end（副本已經從戰敗的 activity.end 知道結果，再發一次會把同一個階段處理兩遍）。

import type { ActivityEndReturn, Change, GameState, Kernel, Origin, Report, ReportDraft } from '../../core'
import { ActionBlocked, attachActivityEnd, clone, closeMap, endActivity, isRecord, meterOf } from '../../core'
import { draft, layerName, runRegion } from './common'
import type { CloseOutcome, NetRun } from './model'
import { ACT_FACE, TRACE, netExt, netExtChange, readRun, runChange } from './model'
import { netrunRules } from './rules'
import { setupOf } from './start'

type Ending = Exclude<CloseOutcome, 'defeat'>

const SUMMARY: Record<Ending, string> = {
  done: '穿過了最後的閘門，這一趟做完了。',
  left: '你登出了：東西都帶走了。',
  retreat: '你們登出了：委託的這一段撤退，回到進去之前。',
  located: '被定位了：現實的增援趕到接入點，全隊被強制斷線。',
}

/** 這一趟現在的追蹤度（這一區沒有追蹤度是 0）。 */
export function traceOf(k: Kernel, state: GameState, run: NetRun): number {
  return runRegion(k, run).pressure === 'trace' ? meterOf(k, state, TRACE, run.map) : 0
}

/** 問 netrun.close：之後的區結算自己的東西（迷宮館的評價、押金）。 */
function closeHooks(k: Kernel, state: GameState, run: NetRun, outcome: CloseOutcome): { changes: Change[]; lines: string[] } {
  const out = { changes: [] as Change[], lines: [] as string[] }
  for (const h of k.hooks.run('netrun.close', { state, run: clone(run), outcome })) {
    if (!isRecord(h.result)) continue
    if (Array.isArray(h.result.changes)) out.changes.push(...clone(h.result.changes))
    if (Array.isArray(h.result.lines)) out.lines.push(...(h.result.lines as string[]))
  }
  return out
}

/**
 * 結束這一趟：問 netrun.close、發 activity.end（kind 是開的那一種）、把量表的值收進 result、關地圖、清狀態。
 * action 是 netrun.end（通過）、netrun.logout（登出與全員拔線）、netrun.located（被定位）。
 */
export function closeDraft(k: Kernel, state: GameState, run: NetRun, outcome: Ending, action: 'netrun.end' | 'netrun.logout' | 'netrun.located'): ReportDraft {
  const trace = traceOf(k, state, run)
  const result: Record<string, unknown> = {
    trace, peak: Math.max(run.peak, trace), rounds: run.round, loot: clone(run.loot), layer: run.layer + 1, layers: run.layers.length, region: run.region,
    ...(outcome === 'located' ? { located: true } : {}),
  }
  const closed = closeHooks(k, state, run, outcome)
  const end = endActivity(k, { state, kind: run.kind, id: run.id, origin: run.origin, outcome, result })
  const lines = [...closed.lines, ...end.lines]
  const changes: Change[] = [...closed.changes, ...end.changes, runChange(null), ...closeMap(state, run.map)]
  const d = draft(state, run, action, outcome, `${SUMMARY[outcome]}${lines.join('')}`, changes, lines.length ? { narration: { results: lines } } : {})
  return attachActivityEnd(d, end)
}

/** 登出現在行不行（戰鬥外隨時可以）。 */
export function logoutBlock(state: GameState): string | null {
  if (!readRun(state)) return '現在沒有在網內的行程裡。'
  if (state.battle) return '正在戰鬥：戰鬥裡要用「拔線」離開。'
  return null
}

/** 登出：委託的階段交回 retreat（N13，畫面先確認「會回到進副本之前」），自己去的那一趟交回 left。 */
export function logout(k: Kernel, state: GameState): ReportDraft {
  const run = readRun(state)
  const block = logoutBlock(state)
  if (!run || block) throw new ActionBlocked(block ?? '現在沒有在網內的行程裡。')
  return closeDraft(k, state, run, run.kind === ACT_FACE ? 'retreat' : 'left', 'netrun.logout')
}

/** 登出會怎樣（給畫面的一句；自己去的那一趟沒有要提醒的是 null）。 */
export const logoutNote = (run: NetRun): string | null => (run.kind === ACT_FACE ? '登出算撤退：會回到進副本之前。' : null)

/** 這一場戰敗被接受之後（掛點 activity.end，kind defeat、outcome accept、那一場是這一趟的）：把這一趟收掉，不發自己的 activity.end。 */
export function onDefeatAccepted(k: Kernel, state: GameState, origin: Origin): ActivityEndReturn | undefined {
  const run = readRun(state)
  const net = isRecord(origin.ext) ? origin.ext.net : undefined
  if (!run || !isRecord(net) || net.run !== run.id) return undefined
  const closed = closeHooks(k, state, run, 'defeat')
  return { changes: [...closed.changes, runChange(null), ...closeMap(state, run.map)], ...(closed.lines.length ? { lines: closed.lines } : {}) }
}

// ---- 追蹤度的門檻（探索中；每一個只觸發一次） ----

/**
 * 追蹤度跨過門檻的事（NETRUNNING 第 5 節；CYBERSPACE 8.3 節）：到 30 記 t30（閘門的 DC +2）；到 60 接一份 netrun.pressure，帶 pressure 觸發點；
 * 到 90 開始倒數（規則的探索回合數），降回 90 以下取消。peak 也在這裡跟著記。沒有要記的回傳 undefined。
 */
function thresholdDraft(k: Kernel, state: GameState, run: NetRun): ReportDraft | undefined {
  const net = netExt(state, run.map)
  if (!net || runRegion(k, run).pressure !== 'trace' || !k.meters.has(TRACE)) return undefined
  const rules = netrunRules(k)
  const v = meterOf(k, state, TRACE, run.map)
  const next = clone(run)
  const nextNet = clone(net)
  const lines: string[] = []
  let pressure = false
  if (v > next.peak) next.peak = v
  if (v >= rules.t1 && !nextNet.t30) {
    nextNet.t30 = true
    lines.push(`追蹤度到了 ${rules.t1}：系統起疑了，閘門的 DC +${rules.gate_t1_dc}。`)
  }
  if (v >= rules.t2 && !nextNet.t60) {
    nextNet.t60 = true
    pressure = true
    lines.push(`追蹤度到了 ${rules.t2}：確認有人入侵，現實的保全進入警戒。`)
  }
  if (v >= rules.t3 && next.located === undefined) {
    next.located = rules.locate_rounds
    lines.push(`追蹤度到了 ${rules.t3}：被定位了。${rules.locate_rounds} 個探索回合之後全隊會被強制斷線，想辦法把追蹤度壓下去。`)
  } else if (v < rules.t3 && next.located !== undefined) {
    delete next.located
    lines.push('追蹤度降下來了：定位被甩開了，強制斷線取消。')
  }
  const runChanged = JSON.stringify(next) !== JSON.stringify(run)
  const netChanged = JSON.stringify(nextNet) !== JSON.stringify(net)
  if (!runChanged && !netChanged) return undefined
  const changes: Change[] = []
  if (runChanged) changes.push(runChange(next))
  if (netChanged) changes.push(netExtChange(state, run.map, nextNet))
  const where = setupOf(run).where ?? { face: 'net', region: run.region, layer: layerName(run) }
  return draft(state, run, pressure ? 'netrun.pressure' : 'netrun.trace', pressure ? 'pressure' : 'trace', lines.join('') || `追蹤度 ${v}。`, changes, {
    ...(lines.length ? { narration: { results: lines } } : {}), ...(pressure ? { triggers: [{ point: 'pressure', where: clone(where) }] } : {}),
  })
}

/**
 * 一份報告套用之後（掛點 report.after）：戰鬥裡全員拔線的收尾、通過之後的收尾、倒數到了的被定位、追蹤度的門檻。
 * 戰鬥中不問（戰鬥裡的追蹤度是場地上的數字，打完寫回量表之後才問）、等著選的戰敗也不問。
 */
export function afterReport(k: Kernel, state: GameState, report: Report): ReportDraft[] | undefined {
  if (report.rewind || report.action === 'rewind') return undefined
  const run = readRun(state)
  if (!run || state.battle || k.activity.active(state).some((a) => a.kind === 'defeat')) return undefined
  if (run.over) return [closeDraft(k, state, run, run.over, 'netrun.logout')]
  if (run.goal.done === true) return [closeDraft(k, state, run, 'done', 'netrun.end')]
  if (run.located === 0) return [closeDraft(k, state, run, 'located', 'netrun.located')]
  const t = thresholdDraft(k, state, run)
  return t ? [t] : undefined
}
