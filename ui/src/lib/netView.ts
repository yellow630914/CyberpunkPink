import type { BattleActionOption, BattleInput, BattleOptions, BattleState, BattleUnit } from '@engine/src'
import { FLASH } from '@engine/src'
import type { NetBattleView, NetUnitView } from '@engine/src/features/netcombat'
import { markOf } from '@engine/src/features/netcombat'
import type { Row } from './afterBattleView'
import { pickFlow } from './battlePicks'
import { disabledReason, type CellUnit } from './battleView'

/**
 * 內海戰鬥多出來的三塊（同步檔位、追蹤度條、管理行動）與卡片上的標記：把引擎給的整理成畫面要的樣子（純函式，不寫規則）。
 * 數字、能不能換、為什麼不能、還能做幾次，一律是引擎的 netBattleView 與 battleOptions；這裡只排版與接線。
 * 行動的 id 是引擎的約定：換檔 net_shift、七個管理行動 adm_ 開頭（features/netcombat）。
 */
export const NET_SHIFT = 'net_shift'
export const ADMIN_PREFIX = 'adm_'
export const isAdminAction = (id: string): boolean => id.startsWith(ADMIN_PREFIX)

/** 現在輪到的我方單位在 netBattleView 裡的那一份；不是我方、沒有同步檔位的人是 undefined */
export function netUnitOf(view: NetBattleView | null, options: BattleOptions | null): NetUnitView | undefined {
  return view && options?.current ? view.units.find((u) => u.unit === options.current) : undefined
}

// ---- 同步檔位 ----

export interface GearCell {
  gear: string
  name: string
  /** 這一檔的檢定加減（已經帶正負號） */
  check: string
  /** 受到的感載是原本的幾 % */
  loadPct: number
  current: boolean
  /** 換不到的原因（引擎的句子，一條一行）；現在這一檔與換得到的是 null */
  reason: string | null
}
export interface GearPanel {
  unit: string
  name: string
  cells: GearCell[]
  /** 整排灰掉的原因（不是你的回合、這一回合換過了……）；沒有是 null */
  locked: string | null
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)

/** 同步檔位的一排。shift 是輪到的人的換檔行動（battleOptions 裡的 net_shift）；沒有同步檔位的人是 null */
export function gearPanel(unit: NetUnitView | undefined, shift: BattleActionOption | undefined, myTurn: boolean): GearPanel | null {
  if (!unit) return null
  const locked = !myTurn ? '現在不是你的回合。' : shift && !shift.ok ? (disabledReason(shift) ?? '現在換不了檔。') : null
  return {
    unit: unit.unit, name: unit.name, locked,
    cells: unit.gears.map((g): GearCell => ({
      gear: g.gear, name: g.name, check: signed(g.check), loadPct: g.loadPct, current: g.current,
      reason: g.current || g.ok ? null : g.blocks.join('\n') || '現在換不到這一檔。',
    })),
  }
}

/** 點一檔送出去的輸入：照引擎宣告的 picks 組（pickFlow），不自己拼 */
export function shiftInput(shift: BattleActionOption, gear: string): BattleInput {
  return pickFlow(shift, { target: null, pick: { gear } }).input
}

// ---- 追蹤度 ----

export interface TraceBar {
  value: number
  /** 三個門檻（增援、增援、定位）：刻度 */
  marks: number[]
  /** 已經跨過幾個門檻 */
  zone: 0 | 1 | 2 | 3
  /** 定位的倒數：還剩幾輪；沒有在倒數是 null，已經被定位是 0 */
  located: number | null
}

/** 追蹤度條；這一場沒有追蹤度（引擎給 null）是 null */
export function traceBar(view: NetBattleView | null): TraceBar | null {
  if (!view || view.trace === null) return null
  const marks = [view.thresholds.t1, view.thresholds.t2, view.thresholds.t3]
  const zone = marks.filter((m) => (view.trace as number) >= m).length as 0 | 1 | 2 | 3
  return { value: view.trace, marks, zone, located: view.located }
}

/** 一拍紀錄要寫的字：追蹤度那一拍帶 data.halved（連動讓上升減半）時，引擎的句子沒提到就補上「連動讓上升減半」 */
export function beatText(b: { text: string; tag?: string; data?: Record<string, unknown> }): string {
  return b.tag === 'trace' && b.data?.halved === true && !b.text.includes('連動讓上升減半') ? `${b.text}（連動讓上升減半）` : b.text
}

/** 這一份報告裡追蹤度變了多少（那一拍的 trace 事件的 data.amount 合計）；沒有變是 0 */
export function traceDelta(reports: ReadonlyArray<{ timeline: ReadonlyArray<{ tag?: string; data?: Record<string, unknown> }> }>): number {
  let d = 0
  for (const r of reports) for (const b of r.timeline) if (b.tag === 'trace' && typeof b.data?.amount === 'number') d += b.data.amount
  return d
}

// ---- 管理行動 ----

export interface AdminButton { id: string; name: string; ram: number; desc: string; reason: string | null }
export interface AdminPanel {
  /** 每回合幾次、這一回合用了幾次、還剩幾次（引擎的 netBattleView.units[].admin） */
  limit: number
  used: number
  left: number
  buttons: AdminButton[]
}

/** 管理行動的面板：只有輪到一個有 admin 的我方單位時才有（沒有就是 null） */
export function adminPanel(unit: NetUnitView | undefined, options: BattleOptions | null): AdminPanel | null {
  if (!unit?.admin || options?.waiting !== 'player') return null
  const buttons = options.actions.filter((a) => isAdminAction(a.id)).map((a): AdminButton => ({ id: a.id, name: a.name, ram: a.cost.ram ?? 0, desc: a.desc, reason: disabledReason(a) }))
  return { ...unit.admin, buttons }
}

// ---- 卡片上的標記 ----

export interface UnitMark {
  key: string
  text: string
  /** bad：閃斷、被釘住；warn：停用與破損；info：檔位、標記 */
  tone: 'bad' | 'warn' | 'info'
  title?: string
}
/** 構裝被干擾停用的三個狀態（規則表 battle_status）：名字查不到時的備用字 */
const JAM_FALLBACK: Record<string, string> = { jam_weapon: '武器構裝停用', jam_defense: '防護構裝停用', jam_tool: '工具構裝停用' }

/**
 * 一張卡片上的標記：閃斷（到那個狀態結束）、被停用的構裝、破損的槽、標記、重創、我方的檔位。
 * 被釘住的人退出了戰鬥、沒有卡片，標在先攻條上（outLabel）。
 */
export function unitMarks(cell: CellUnit, raw: BattleUnit | undefined, net: NetUnitView | undefined): UnitMark[] {
  const out: UnitMark[] = []
  if (net) {
    const g = net.gears.find((x) => x.current)
    if (g) out.push({ key: 'gear', text: `${g.name}檔`, tone: 'info', title: `同步檔位：${g.name}檔（檢定 ${signed(g.check)}，受到的感載 ${g.loadPct}%）` })
  }
  cell.statusIds.forEach((id, i) => {
    if (id === FLASH) out.push({ key: `st:${id}`, text: cell.statuses[i] === id ? '閃斷' : cell.statuses[i]!, tone: 'bad', title: '過載了：RAM 斷了，到這個狀態結束才回復。' })
    else if (id in JAM_FALLBACK) out.push({ key: `st:${id}`, text: cell.statuses[i] === id ? JAM_FALLBACK[id]! : cell.statuses[i]!, tone: 'warn' })
  })
  for (const b of net?.broken ?? []) out.push({ key: `broken:${b.id}`, text: `破損：${b.name}`, tone: 'warn' })
  if (net?.heavy) out.push({ key: 'heavy', text: '重創', tone: 'warn', title: '這一場被重創過，結束時會留下狀況。' })
  const mark = raw ? markOf(raw) : undefined
  if (mark) out.push({ key: 'mark', text: `標記 +${mark.bonus}`, tone: 'info', title: '被標記：打他命中加值，直到他過載。' })
  return out
}

/** 退出戰鬥的人（被釘住、拔線）：先攻條上寫的字；一般的倒下、投降、逃走沒有特別的標 */
export function outLabel(out: string | undefined): string | undefined {
  if (!out) return undefined
  if (out === 'pinned') return '被釘住'
  if (out === 'jacked_out') return '已拔線'
  return '已經退出'
}

/** 場上被釘住的人的名字（先攻條旁的提示用）；引擎的 battle 裡 out === 'pinned' */
export function pinnedNames(battle: BattleState): string[] {
  return Object.values(battle.units).filter((u) => u.out === 'pinned').map((u) => u.name)
}

// ---- 內海的戰敗 ----

/** 戰敗面板「這一次的後果」多的幾列：被定位、被扣線（引擎的 defeatView 的 located、tethered；現實的戰敗沒有） */
export function defeatNetRows(v: { net: boolean; tethered: boolean; located: boolean }): Row[] {
  if (!v.net) return []
  const rows: Row[] = []
  if (v.located) rows.push({ k: '線上', v: '被定位：現實的增援趕到接入點，全隊被強制斷線', tone: 'bad' })
  if (v.tethered) rows.push({ k: '線上', v: '被扣線：意識留在網內，要等人去找你的身體', tone: 'bad' })
  return rows
}
