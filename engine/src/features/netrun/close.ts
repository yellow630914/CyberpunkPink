// L6 功能 netrun：結束一趟（登出、通過、被定位、戰敗被接受）與追蹤度的門檻。
// 規格：CYBERSPACE 6.8、8.1 節（追蹤度、帶出去才算數）；NETRUNNING 第 5 節；dev/adr/0018 第六、七、十節與 N13、N15；dev/work/M3-netrun.md 要做的第 6、9、10、11 項。
// 離開的四種方式與交回的 outcome：done（目標達成）、left（探索中拔線登出，東西全部帶走）、retreat（委託副本裡全員拔線或探索中登出：等於撤退）、located（探索中被定位）。
// 戰鬥打輸不由這裡交回：戰敗被接受之後只把這一趟收掉（關地圖、清狀態），不另外發自己的 activity.end（副本已經從戰敗的 activity.end 知道結果，再發一次會把同一個階段處理兩遍）。
// 例外：熔斷的場地（battle.field.safe，迷宮館）打輸沒有戰敗事件：fight.ts 把這一趟標成 over: 'defeat'，這裡交回 defeat（迷宮館結算押金；人還在潛入中，醒在回復室）。

import type { ActivityEndReturn, Change, GameState, Kernel, Origin, Report, ReportDraft } from '../../core'
import { ActionBlocked, attachActivityEnd, clone, closeMap, endActivity, isRecord, meterOf, seedRand } from '../../core'
import { draft, layerName, runRegion } from './common'
import { digLeave } from './dig'
import type { CloseOutcome, HackedAnswer, LootEntry, NetExt, NetRun, Patrol } from './model'
import { ACT_FACE, ACT_NET, EXT, NET_MODE, TRACE, netExt, netExtChange, nodeAt, readRun, runChange } from './model'
import { lossOf } from './loss'
import { makePatrol, moverChanges, nextPatrolId } from './patrol'
import { countsOf, netrunRules } from './rules'
import { layerLabel, partyOf, setupOf } from './start'

type Ending = CloseOutcome

const SUMMARY: Record<Ending, string> = {
  done: '穿過了最後的閘門，這一趟做完了。',
  left: '你登出了：東西都帶走了。',
  retreat: '你們登出了：委託的這一段撤退，回到進去之前。',
  located: '被定位了：現實的增援趕到接入點，全隊被強制斷線。',
  defeat: '熔斷的場地沒有真的倒下：館方把你們送回了回復室。',
}

/** 這一趟現在的追蹤度（這一區沒有追蹤度是 0）。 */
export function traceOf(k: Kernel, state: GameState, run: NetRun): number {
  return runRegion(k, run).pressure === 'trace' ? meterOf(k, state, TRACE, run.map) : 0
}

/** 問 netrun.close：之後的區結算自己的東西（迷宮館的評價、押金）。lost 是這一趟丟掉的東西（帶出去才算數；沒有丟的是沒有這個欄位）。 */
function closeHooks(k: Kernel, state: GameState, run: NetRun, outcome: CloseOutcome, lost?: LootEntry[], hacked = false): { changes: Change[]; lines: string[]; read: Array<{ source: string; name: string; what?: string }> } {
  const out = { changes: [] as Change[], lines: [] as string[], read: [] as Array<{ source: string; name: string; what?: string }> }
  for (const h of k.hooks.run('netrun.close', { state, run: clone(run), outcome, ...(lost ? { lost: clone(lost) } : {}) })) {
    if (!isRecord(h.result)) continue
    if (Array.isArray(h.result.changes)) out.changes.push(...clone(h.result.changes))
    if (Array.isArray(h.result.lines)) out.lines.push(...(h.result.lines as string[]))
  }
  // 被駭了（被定位，或這一趟的戰鬥打輸被接受；熔斷的場地不算）：問 net.hacked，身上的東西（記憶庫）可能被對方讀走（M4-core-gaps 第 20 項）
  if (hacked) {
    for (const h of k.hooks.run('net.hacked', { state, run: clone(run), outcome: outcome === 'located' ? 'located' : 'defeat', party: partyOf(state) })) {
      const r = h.result as HackedAnswer
      if (!isRecord(r)) continue
      if (Array.isArray(r.changes)) out.changes.push(...clone(r.changes))
      if (Array.isArray(r.lines)) out.lines.push(...r.lines.filter((l): l is string => typeof l === 'string' && l.length > 0))
      if (Array.isArray(r.read)) out.read.push(...clone(r.read).filter((x) => isRecord(x) && typeof x.source === 'string' && typeof x.name === 'string'))
    }
  }
  return out
}

/** 接管了的控制節點（result.controls；副本拿去給連動）：node 是對到現實的哪個控制節點（沒有對應的沒有這一項）。 */
export function controlsTaken(net: NetExt | null): Array<{ id: string; sheet: string; name?: string; node?: string }> {
  const out: Array<{ id: string; sheet: string; name?: string; node?: string }> = []
  for (const [sheet, list] of Object.entries(net?.controls ?? {})) {
    for (const [id, c] of Object.entries(list)) if (c.taken) out.push({ id, sheet, ...(c.name ? { name: c.name } : {}), ...(c.node ? { node: c.node } : {}) })
  }
  return out
}

/**
 * 結束這一趟：問 netrun.close、發 activity.end（kind 是開的那一種）、把量表的值收進 result、關地圖、清狀態。
 * action 是 netrun.end（通過）、netrun.logout（登出與全員拔線）、netrun.located（被定位）。
 */
export function closeDraft(k: Kernel, state: GameState, run: NetRun, outcome: Ending, action: 'netrun.end' | 'netrun.logout' | 'netrun.located'): ReportDraft {
  const trace = traceOf(k, state, run)
  // 帶出去才算數：自己去的那一趟被定位（沒有回到快照）時，拿到的東西每一件擲一次；委託的階段被定位是委託失敗、回到進去之前，不用丟
  const loss = outcome === 'located' && run.kind === ACT_NET ? lossOf(k, state, run) : null
  const result: Record<string, unknown> = {
    trace, peak: Math.max(run.peak, trace), rounds: run.round, loot: clone(run.loot), layer: run.layer + 1, layers: run.layers.length, region: run.region,
    goal: run.goal.done === true, controls: controlsTaken(netExt(state, run.map)),
    ...(outcome === 'located' ? { located: true } : {}), ...(loss ? { lost: clone(loss.lost) } : {}),
  }
  // 自己去挖的子網：地圖留著（七天）、記下離開時的樣子、那家企業的敵對值照追蹤度加
  const kept = digLeave(k, state, run, trace, outcome === 'located')
  if (kept) Object.assign(result, kept.result)
  const closed = closeHooks(k, state, run, outcome, loss?.lost, outcome === 'located')
  if (closed.read.length > 0) result.read = clone(closed.read)
  const end = endActivity(k, { state, kind: run.kind, id: run.id, origin: run.origin, outcome, result })
  const lines = [...closed.lines, ...(loss?.lines ?? []), ...(kept?.lines ?? []), ...end.lines]
  const changes: Change[] = [...closed.changes, ...(loss?.changes ?? []), ...(kept?.changes ?? []), ...end.changes, runChange(null), ...(kept ? [] : closeMap(state, run.map))]
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
export function onDefeatAccepted(k: Kernel, state: GameState, origin: Origin, result: Record<string, unknown> = {}): ActivityEndReturn | undefined {
  const run = readRun(state)
  const net = isRecord(origin.ext) ? origin.ext.net : undefined
  if (!run || !isRecord(net) || net.run !== run.id) return undefined
  // 帶出去才算數：沒有回到快照的才丟（自己的那一趟；不算委託失敗的戰敗）。算委託失敗的回到進副本之前，東西本來就不在
  const loss = run.kind === ACT_NET || result.fails_commission !== true ? lossOf(k, state, run) : null
  const closed = closeHooks(k, state, run, 'defeat', loss?.lost, true)
  // 自己去挖的子網戰敗被接受：一樣留著（被定位的戰敗另外加敵對值、清後門）
  const kept = digLeave(k, state, run, traceOf(k, state, run), result.located === true)
  const lines = [...closed.lines, ...(loss?.lines ?? []), ...(kept?.lines ?? [])]
  return { changes: [...closed.changes, ...(loss?.changes ?? []), ...(kept?.changes ?? []), runChange(null), ...(kept ? [] : closeMap(state, run.map))], ...(lines.length ? { lines } : {}) }
}

// ---- 追蹤度的門檻（探索中；每一個只觸發一次） ----

/**
 * 追蹤度第一次到 t1：現在這一層與更深的每一層多 patrol_t1 隊巡邏（CYBERSPACE 8.3 節「剩下的每一層巡邏 +1」；這一區沒有巡邏的不加）。現在這一層的新一隊從離隊伍最遠的地方出發。
 * 挑不到敵人的（單位來源挑不出那一組）不放。回傳新放的（已經加進 net）。
 */
function morePatrols(k: Kernel, state: GameState, run: NetRun, net: NetExt): Patrol[] {
  const rules = netrunRules(k)
  // 這一區沒有巡邏的（密度表寫 0、寂靜）追蹤度再高也不會多出來
  if (countsOf(runRegion(k, run), run.kind).patrol[1] <= 0 || net.dig?.fx.no_patrol) return []
  const seed = state.maps.instances[run.map]?.gen?.seed ?? 0
  const parsed = setupOf(run)
  const source = k.battle.getUnitSource('enemy_pick')
  const at = state.maps.at
  const added: Patrol[] = []
  for (let i = run.layer; i < run.layers.length; i++) {
    const sheet = run.layers[i]!
    const graph = net.graph[sheet]
    if (!graph) continue
    const here = i === run.layer && at ? nodeAt(net, sheet, at)?.id : undefined
    const name = parsed.layers[i]
    for (let n = 0; n < rules.patrol_t1; n++) {
      const id = nextPatrolId(net)
      const patrol = makePatrol({
        id, sheet, graph, rand: seedRand(seed, `${run.map}/t30/${sheet}/${n}`), grade: run.grade, ...(run.faction ? { faction: run.faction } : {}), fx: parsed.fx,
        ...(parsed.color ? { color: parsed.color } : {}), layerName: typeof name === 'string' && name ? name : layerLabel(name, i), rules, seed: `${seed}/${i}/${id}/t30`, ...(here ? { from: here } : {}),
      })
      if (!patrol || !source) continue
      try {
        for (const ref of patrol.foes) source(ref, { k, state, side: 'foe', mode: NET_MODE, grade: run.grade as never, allyCount: partyOf(state).length })
      } catch {
        continue
      }
      net.patrols.push(patrol)
      added.push(patrol)
    }
  }
  return added
}

/**
 * 追蹤度升高的那一步順便記 peak（到過的最高）：掛 report.before，把這份報告自己的 meter 變更算出來的追蹤度和 run.peak 比，
 * 更高就在這份報告的變更後面補一筆換掉這一趟（run 的值照這份報告自己寫的最後一筆算起，不蓋掉它的變更）。
 * 這樣沒跨門檻的上升不用再為了 peak 多發一份只有「追蹤度 N。」的 netrun.trace 報告（M3 白箱修正批；使用者 2026-11-25）。
 */
export function peakChange(k: Kernel, state: GameState, draft: ReportDraft): Change[] | undefined {
  const def = k.meters.get(TRACE)
  if (!def) return undefined
  // 這份報告套用之後的那一趟：報告自己寫了（最後一筆 ext）就用它（開始、收掉都算），沒寫就是現在的
  let base: NetRun | null = readRun(state)
  for (const c of draft.changes) {
    if (c.op === 'ext' && c.key === EXT) base = isRecord(c.value) && typeof c.value.id === 'string' && typeof c.value.map === 'string' ? (c.value as unknown as NetRun) : null
  }
  if (!base || runRegion(k, base).pressure !== 'trace') return undefined
  let v = meterOf(k, state, TRACE, base.map)
  let moved = false
  for (const c of draft.changes) {
    if (c.op !== 'meter' || c.kind !== TRACE || c.key !== base.map) continue
    const target = typeof c.set === 'number' ? c.set : v + (typeof c.delta === 'number' ? c.delta : 0)
    v = Math.max(def.min, Math.min(def.max, target))
    moved = true
  }
  return moved && v > base.peak ? [runChange({ ...clone(base), peak: v })] : undefined
}

/**
 * 追蹤度跨過門檻的事（NETRUNNING 第 5 節；CYBERSPACE 8.3 節）：到 30 記 t30（閘門的 DC +2）；到 60 接一份 netrun.pressure，帶 pressure 觸發點；
 * 到 90 開始倒數（規則的探索回合數），降回 90 以下取消。peak 平常由 peakChange 併進升高的那一步（這裡只留一道保險：有人漏了才補）。沒有要記的回傳 undefined。
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
  const moved: Change[] = []
  if (v >= rules.t1 && !nextNet.t30) {
    nextNet.t30 = true
    // 追蹤度到過 30 之後多出來的巡邏只放一次（七天內再進去又跨過 30 不再多放）
    const added = nextNet.t30_patrols ? [] : morePatrols(k, state, next, nextNet)
    nextNet.t30_patrols = true
    if (added.length) moved.push(...moverChanges(next, nextNet, added))
    lines.push(`追蹤度到了 ${rules.t1}：系統起疑了，閘門的 DC +${rules.gate_t1_dc}${added.length ? `，剩下的每一層多了 ${rules.patrol_t1} 隊巡邏` : ''}。`)
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
  const changes: Change[] = [...moved]
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
