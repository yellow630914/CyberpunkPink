// L6 功能 cyberware 的「每 N 天要回去重刻」（CYBERWARE 7.5 節「刻經」：每七天要回聖堂讓人重刻一次，沒有的話內海的容量每週 −2，最低 8；M4-followups-2 第 3 項）。
// 資料在橋的設計圖：bridge.recall = { days, at, cat, per }
//   days  每幾天要去一次
//   at    去哪裡：設施種類的 id（條件 at_facility 的 types，站在其中一種就算回去了）
//   cat   超過期限之後扣哪一類容量（meat、net、social、media）
//   per   每超過一個期限（days 天）扣幾點；扣到那一類只剩 cap_min（規則表，預設 8）為止，不再往下
// 最後一次重刻的時間記在那一件橋上（CyberPiece.inscribed，總分鐘；沒寫用裝好的時間）。
// 容量的扣減是被動效果（來源 cyber，{ stat: bridge_cap_<cat>, amount: −N }），由 passive.ts 的 cyberPassives 給；站在設施上時，turn.end 把 inscribed 更新成現在（至少隔一天才算一次，不洗版）。
// 沒有「去的設施」也不會壞：條件 at_facility 沒人註冊，就永遠沒有人重刻，容量照時間往下扣。

import type { ActorId, ContentEntry, GameState, Kernel, PassiveEffect, ReportDraft } from '../../core'
import { clone, isRecord, isSafeInt } from '../../core'
import { BRIDGE_CATS, bridgeCapacityOf } from './bridge'
import type { BridgeCat } from './bridge'
import type { CyberPiece } from './model'
import { cyberOf, cyberRules, isBridge, nowOf } from './model'
import { pieceBlueprint } from './deck'
import { writePieces } from './lock'

export const RECALL_ACTION = 'cyber.recall'
const DAY = 1440

export interface Recall {
  days: number
  at: string[]
  cat: BridgeCat
  per: number
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 讀設計圖的 bridge.recall（寬鬆；載入時 recallProblems 已經擋過）。 */
export function readRecall(bp: unknown): Recall | undefined {
  const bridge = isRecord(bp) ? bp.bridge : undefined
  const r = isRecord(bridge) ? bridge.recall : undefined
  if (!isRecord(r) || !isSafeInt(r.days) || (r.days as number) < 1 || !Array.isArray(r.at) || !r.at.every(isText) || r.at.length === 0) return undefined
  if (!(BRIDGE_CATS as readonly unknown[]).includes(r.cat) || !isSafeInt(r.per) || (r.per as number) < 1) return undefined
  return { days: r.days as number, at: [...(r.at as string[])], cat: r.cat as BridgeCat, per: r.per as number }
}

/** 載入時的格式檢查：bridge.recall 是 { days, at, cat, per }；空的就是合格。 */
export function recallProblems(e: ContentEntry & { bridge?: unknown }): string[] {
  const bridge = e.bridge
  if (!isRecord(bridge) || bridge.recall === undefined) return []
  const r = bridge.recall
  if (!isRecord(r)) return ['bridge.recall 要是 { days, at, cat, per }']
  const p: string[] = []
  for (const f of Object.keys(r)) if (!['days', 'at', 'cat', 'per'].includes(f)) p.push(`bridge.recall.${f}：沒有這個欄位（只有 days、at、cat、per）`)
  if (!isSafeInt(r.days) || (r.days as number) < 1 || (r.days as number) > 365) p.push('bridge.recall.days 要是 1～365 的整數（每幾天要去一次）')
  if (!Array.isArray(r.at) || r.at.length === 0 || !r.at.every(isText)) p.push('bridge.recall.at 要是設施種類 id 的非空陣列')
  if (!(BRIDGE_CATS as readonly unknown[]).includes(r.cat)) p.push(`bridge.recall.cat 要是 ${BRIDGE_CATS.join('、')} 其中一個`)
  if (!isSafeInt(r.per) || (r.per as number) < 1 || (r.per as number) > 64) p.push('bridge.recall.per 要是 1～64 的整數（每個期限扣幾點）')
  return p
}

/** 最後一次重刻的時間（沒寫是裝好的時間）。 */
export const inscribedAt = (piece: Pick<CyberPiece, 'inscribed' | 'at'>): number => piece.inscribed ?? piece.at

/** 超過幾個期限了（沒到一個期限是 0）。 */
export const overdueTerms = (piece: Pick<CyberPiece, 'inscribed' | 'at'>, recall: Recall, now: number): number => Math.max(0, Math.floor((now - inscribedAt(piece)) / (recall.days * DAY)))

/** 這一件橋現在被扣的容量（正數；不超過那一類現有的容量減 cap_min）。 */
export function recallPenalty(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, piece: CyberPiece): { cat: BridgeCat; amount: number; terms: number } | null {
  if (!isBridge(piece)) return null
  const recall = readRecall(pieceBlueprint(k, piece))
  if (!recall) return null
  const terms = overdueTerms(piece, recall, nowOf(state))
  if (terms === 0) return null
  const raw = bridgeCapacityOf(k, state, actor).split[recall.cat]
  const amount = Math.min(recall.per * terms, Math.max(0, raw - cyberRules(k).cap_min))
  return amount > 0 ? { cat: recall.cat, amount, terms } : null
}

/** 被動效果（來源 cyber）：沒有按時回去重刻的那一類容量往下扣。 */
export function recallPassives(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): PassiveEffect[] {
  const out: PassiveEffect[] = []
  for (const piece of cyberOf(state, actor)) {
    const pen = recallPenalty(k, state, actor, piece)
    if (pen) out.push({ stat: `bridge_cap_${pen.cat}`, amount: -pen.amount, label: '沒有按時回去重刻' })
  }
  return out
}

/** 主角現在站在這一件的重刻地點嗎。 */
function atPlace(k: Kernel, state: GameState, recall: Recall): boolean {
  if (!k.conditions.kinds().includes('at_facility')) return false
  return k.conditions.test({ kind: 'at_facility', types: recall.at }, { state, stats: k.stats, timeRules: k.timeRules })
}

/**
 * turn.end：主角站在重刻的地點，而且離上次重刻隔了一天以上，就重刻一次（把 inscribed 更新成現在）。沒有要重刻的橋、不在地點、剛刻過都沒有東西。
 * 報告 cyber.recall：不花時間（人本來就在那裡），只留一句話與記號。
 */
export function recallDrafts(k: Kernel, state: GameState): ReportDraft[] {
  const pc = state.pc
  if (!pc || !state.actors[pc]) return []
  const now = nowOf(state)
  const pieces = cyberOf(state, pc)
  const names: string[] = []
  const next = pieces.map((piece): CyberPiece => {
    if (!isBridge(piece)) return piece
    const recall = readRecall(pieceBlueprint(k, piece))
    if (!recall || now - inscribedAt(piece) < DAY || !atPlace(k, state, recall)) return piece
    names.push(pieceBlueprint(k, piece)?.name ?? piece.bp)
    return { ...piece, inscribed: now }
  })
  if (names.length === 0) return []
  const text = `在這裡讓人重刻了${names.join('、')}的晶片，下一次要在期限之內再回來。`
  return [{
    kind: 'action', action: RECALL_ACTION, location: clone(state.location), actor: pc, party: [],
    timeline: [{ layer: 'meat', actor: pc, text, tag: RECALL_ACTION }],
    changes: [writePieces(state, pc, next)],
    outcome: { result: 'inscribed', summary: text }, narration: { results: [text] },
  }]
}
