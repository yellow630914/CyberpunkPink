// L6 功能 lure 給畫面與除錯用的唯讀資料（dev/work/M4-lure.md 第 4 點）。純函式，不改狀態、不擲骰。
//   lureView    每個找過主角的流竄 AI：順著幾次、拒絕幾次、問過幾次、揭開了哪幾格（含那一句）、有沒有線索、有沒有牠的吻；沒找過的不列
//   candidates  現在 lure_open 成立的每一個與牠的權重（LURE_EVENTS：3 ×（1 ＋ 那一軸的等級 × 0.2），標籤是「深」再 × 1.5）與這一次的版本；
//               只是給畫面與測試對照，實際的抽選是導演照事件的 weight 與 where

import type { GameState, Kernel } from '../../core'
import type { LoreSlot, Mode } from './model'
import { LORE_SLOTS, MALWARE_CONDITION, allEntries, axisLevel, clueFlag, isOpen, lureOf, lureRules, modeOf, tagState } from './model'

export interface LureViewRow {
  id: string
  name: string
  follow: number
  refused: number
  asked: number
  /** 揭開的格，照固定的順序（原名、想要什麼、處得來的人、群落） */
  lore: Array<{ slot: LoreSlot; text: string }>
  /** 四格都揭開了 */
  complete: boolean
  /** 給過指向粉牆的線索（旗標） */
  clue: boolean
  /** 主角身上現在有牠的吻（有人註冊惡意韌體的條件才查得到；沒有就是 false） */
  kiss: boolean
  last?: number
}

export function lureView(k: Kernel, state: GameState): LureViewRow[] {
  const rows = lureOf(state)
  const pc = state.pc
  const out: LureViewRow[] = []
  for (const e of allEntries(k)) {
    const row = rows[e.id]
    if (!row) continue
    const lore = LORE_SLOTS.filter((s) => row.lore.includes(s)).map((slot) => ({ slot, text: e.lore[slot] }))
    const kiss = e.kiss !== undefined && !!pc && k.conditions.kinds().includes(MALWARE_CONDITION)
      && k.conditions.test({ kind: MALWARE_CONDITION, id: e.kiss }, { state, stats: k.stats, timeRules: k.timeRules, actor: pc })
    out.push({
      id: e.id, name: e.name, follow: row.follow, refused: row.refused, asked: row.asked, lore, complete: lore.length === LORE_SLOTS.length,
      clue: state.flags[clueFlag(e.id)] === true, kiss, ...(row.last !== undefined ? { last: row.last } : {}),
    })
  }
  return out
}

export interface Candidate {
  id: string
  name: string
  weight: number
  mode: Mode
}

export function candidates(k: Kernel, state: GameState): Candidate[] {
  const pc = state.pc
  if (!pc || !state.actors[pc]) return []
  const rules = lureRules(k)
  const out: Candidate[] = []
  for (const e of allEntries(k)) {
    if (!isOpen(state, pc, e, rules)) continue
    const deep = e.tag !== undefined && tagState(state, pc, e.tag) === 'deep'
    const weight = rules.weight * (1 + axisLevel(state, pc, e.axis) * rules.axis_step) * (deep ? rules.deep_mult : 1)
    out.push({ id: e.id, name: e.name, weight, mode: modeOf(state, pc, e, rules) })
  }
  return out
}
