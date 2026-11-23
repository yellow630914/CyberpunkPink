// L3 狀態核心：掛點 rest.done 的共用函式（dev/adr/0016 第六節）。
//
// 休息做完（喘口氣、睡一覺、副本裡階段之間的喘口氣）發 rest.done，「每次休息回滿」的東西聽它、回傳變更。
// 核心只給型別與這個「跑掛點、收變更」的小函式；發的人是功能（休息的功能 rest、副本的階段），組休息的那一份報告時呼叫它，
// 把回傳的變更接在自己的變更後面。

import type { Change, GameState } from '../types'
import { clone } from '../util/clone'
import { isRecord } from '../util/sanitize'
import { guardHooks } from './commit'
import type { RestKind } from './hooks'
import type { StateKernel } from './kernel'

/** 休息的種類，和掛點 rest.done 的 RestKind 同一份。 */
export const REST_KINDS: readonly RestKind[] = ['breath', 'sleep', 'stage']

/**
 * 發 rest.done，把每個處理函式回傳的變更照順序接起來（沒有人聽就是空的）。state 是休息做完之前的狀態，唯讀
 * （嚴格模式會抓處理函式偷改）。回傳的變更格式不對（不是 { op } 的陣列）丟錯，訊息寫出是誰回傳的。
 */
export function restDone(k: StateKernel, state: GameState, kind: RestKind): Change[] {
  if (!REST_KINDS.includes(kind)) throw new Error(`rest.done：休息的種類只能是 ${REST_KINDS.join('、')}（拿到 ${String(kind)}）`)
  const results = guardHooks(k, state, 'rest.done', () => k.hooks.run('rest.done', { state, kind }))
  const out: Change[] = []
  for (const { owner, result } of results) {
    const list = result as unknown
    if (!Array.isArray(list) || list.some((c) => !isRecord(c) || typeof c.op !== 'string' || !c.op)) throw new Error(`rest.done（${kind}）：${owner} 回傳的不是變更的陣列（每一筆要有 op）`)
    out.push(...(clone(list) as Change[]))
  }
  return out
}
