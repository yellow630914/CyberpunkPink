// L6 功能 cyberware 回答別的功能問的三件事（M4-core-gaps 第 4、20 項；CYBERWARE 第 3 節「雙面效應」、第 2 節橋的機能「回報後門」）：
//   hack.trace_mod     快駭的追蹤度（features/hack 宣告）：駭入接頭直接插進裝置、不經無線，追蹤度不漲（mult 0）；回報後門每用一次 +1（add 1）
//   netrun.trace_mod   網內探索的追蹤度（features/netrun 宣告）：回報後門在那一家的子網裡起跳 +5（start）、之後每一次上升多 +1（rise）
//   net.hacked         隊伍在網內被駭了（features/netrun 宣告）：記憶庫被對方讀走（readable）
// 資料在設計圖：
//   trace_mod: [{ faction?, start?, rise?, mult? }]   生效中的那一件才算；faction 沒寫是任何勢力的子網，寫了只在那一家的（hack 與 netrun 都看這一場的勢力）。
//                                                     start 只用在網內探索的起跳；rise 是每次追蹤度上升多加（快駭每用一次、網內每一次上升）；mult 乘在上升的量上（0 就是不漲）
//   readable: { what? }                               被駭時會被讀走的東西（記憶庫）；what 是一個字眼（memory），給畫面與事件用
// 掛點是別的功能宣告的：這裡只認名字與格式，不 import（照 features/maze 掛 netrun.round 的做法）。

import type { ActorId, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import { activePieces } from './passive'
import { pieceBlueprint } from './deck'

export interface TraceModEntry {
  faction?: string
  start?: number
  rise?: number
  mult?: number
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 一件義體上寫的 trace_mod（格式不對的項略過；載入時 traceProblems 已經擋過）。 */
export function readTraceMods(raw: unknown): TraceModEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => (isRecord(e) ? [{
    ...(isText(e.faction) ? { faction: e.faction } : {}), ...(isNum(e.start) ? { start: e.start } : {}), ...(isNum(e.rise) ? { rise: e.rise } : {}), ...(isNum(e.mult) ? { mult: e.mult } : {}),
  }] : []))
}

/** 設計圖的 trace_mod 與 readable 格式問題（每一條寫出是哪一筆、哪個欄位）；空的就是合格。 */
export function traceProblems(raw: { trace_mod?: unknown; readable?: unknown }): string[] {
  const p: string[] = []
  if (raw.trace_mod !== undefined) {
    if (!Array.isArray(raw.trace_mod)) p.push('trace_mod 要是 [{ faction?, start?, rise?, mult? }]')
    else raw.trace_mod.forEach((e, i) => {
      const at = `trace_mod[${i}]`
      if (!isRecord(e)) { p.push(`${at} 要是 { faction?, start?, rise?, mult? }`); return }
      for (const key of Object.keys(e)) if (!['faction', 'start', 'rise', 'mult'].includes(key)) p.push(`${at}.${key}：沒有這個欄位（可以寫：faction、start、rise、mult）`)
      if (e.faction !== undefined && !isText(e.faction)) p.push(`${at}.faction 要是勢力的 id`)
      for (const key of ['start', 'rise'] as const) if (e[key] !== undefined && !(isSafeInt(e[key]) && Math.abs(e[key] as number) <= 100)) p.push(`${at}.${key} 要是整數（絕對值不超過 100）`)
      if (e.mult !== undefined && !(isNum(e.mult) && e.mult >= 0 && e.mult <= 10)) p.push(`${at}.mult 要是 0～10 的數字（0 是不漲）`)
      if (e.start === undefined && e.rise === undefined && e.mult === undefined) p.push(`${at}：start、rise、mult 至少寫一個`)
    })
  }
  if (raw.readable !== undefined) {
    if (!isRecord(raw.readable)) p.push('readable 要是 { what? }')
    else {
      for (const key of Object.keys(raw.readable)) if (key !== 'what') p.push(`readable.${key}：沒有這個欄位（只有 what）`)
      if (raw.readable.what !== undefined && !isText(raw.readable.what)) p.push('readable.what 要是一個字眼')
    }
  }
  return p
}

/** 這個人身上生效中的義體帶的 trace_mod（勢力對得上的）。 */
function modsOf(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, faction: string | undefined): TraceModEntry[] {
  if (!state.actors[actor]) return []
  const out: TraceModEntry[] = []
  for (const piece of activePieces(state, actor)) {
    const bp = pieceBlueprint(k, piece) as ({ trace_mod?: unknown } | undefined)
    for (const e of readTraceMods(bp?.trace_mod)) if (e.faction === undefined || e.faction === faction) out.push(e)
  }
  return out
}

interface Answer { add?: number; mult?: number }

/** 掛點 hack.trace_mod：這個人的義體對快駭追蹤度的 add（每個 rise 加起來）與 mult（相乘）。沒有就是 undefined。 */
export function hackTraceAnswer(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, faction: string | undefined): Answer | undefined {
  const mods = modsOf(k, state, actor, faction)
  const add = mods.reduce((s, e) => s + (e.rise ?? 0), 0)
  const mult = mods.reduce((s, e) => s * (e.mult ?? 1), 1)
  return add !== 0 || mult !== 1 ? { ...(add !== 0 ? { add } : {}), ...(mult !== 1 ? { mult } : {}) } : undefined
}

/** 掛點 netrun.trace_mod：隊上每個人的義體合起來。start 只回 add；rise 回 add 與 mult。 */
export function netTraceAnswer(k: Pick<Kernel, 'content'>, state: GameState, party: ActorId[], faction: string | undefined, when: 'start' | 'rise'): Answer | undefined {
  const mods = party.flatMap((a) => modsOf(k, state, a, faction))
  if (when === 'start') {
    const add = mods.reduce((s, e) => s + (e.start ?? 0), 0)
    return add !== 0 ? { add } : undefined
  }
  const add = mods.reduce((s, e) => s + (e.rise ?? 0), 0)
  const mult = mods.reduce((s, e) => s * (e.mult ?? 1), 1)
  return add !== 0 || mult !== 1 ? { ...(add !== 0 ? { add } : {}), ...(mult !== 1 ? { mult } : {}) } : undefined
}

/** 掛點 net.hacked：隊上每個人生效中的 readable 義體（記憶庫）被讀走。沒有就是 undefined。 */
export function hackedAnswer(k: Pick<Kernel, 'content'>, state: GameState, party: ActorId[]): { read: Array<{ source: string; name: string; what?: string }>; lines: string[] } | undefined {
  const read: Array<{ source: string; name: string; what?: string }> = []
  const lines: string[] = []
  for (const actor of party) {
    if (!state.actors[actor]) continue
    for (const piece of activePieces(state, actor)) {
      const bp = pieceBlueprint(k, piece) as ({ name?: string; readable?: unknown } | undefined)
      if (!bp || !isRecord(bp.readable)) continue
      const what = isText(bp.readable.what) ? bp.readable.what : undefined
      const name = bp.name ?? piece.bp
      read.push({ source: 'cyber', name, ...(what ? { what } : {}) })
      lines.push(`${state.actors[actor]!.name}的${name}被對方讀走了。`)
    }
  }
  return read.length > 0 ? { read, lines } : undefined
}
