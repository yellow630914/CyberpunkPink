// L6 auction 的「交貨」：拍品得標之後要跑的效果（契約的轉讓、機密的效果），以及「現在交不交得出去」的試跑（M4 收尾修正批 必修 2；LEWD_SYSTEM 6.2 節「交不出去」）。
//
// 契約拍品交給 contract_hold、機密的 effects 是資料寫的一串效果。這些效果有可能在現在的狀態下落空：已經持有那個人的契約（contract_hold 的 clamp 回 null）、
// 那個人還不是場上的角色、效果被夾值整筆拿掉、或效果格式根本不合格。目錄抽籤與落槌都先試跑一次（不寫入）：交不出去的不抽、得標了也不收錢。

import type { GameState, Kernel } from '../../core'
import { blankState, effectCtx } from '../../core'
import type { LotKind } from './model'

/** 交貨用得到的欄位（目錄的一件、場上的一件、內容的一筆都符合）。 */
export interface GiveSpec {
  kind: LotKind
  npc?: string
  contract?: Record<string, unknown> | undefined
  effects?: Array<Record<string, unknown>> | undefined
  item?: string | undefined
}

/** 得標時要跑的效果：契約是 contract_hold（origin 寫拍賣行的名字）；其餘是資料寫的 effects。沒有要跑的是空陣列。 */
export function giveEffects(spec: GiveSpec, houseName: string): Array<Record<string, unknown>> {
  if (spec.kind === 'contract') return [{ kind: 'contract_hold', ...structuredClone(spec.contract ?? {}), ...(spec.npc !== undefined ? { npc: spec.npc } : {}), origin: houseName }]
  return spec.effects?.length ? structuredClone(spec.effects) : []
}

/** 效果格式的問題（載入內容時用：不看狀態，只驗格式；沒有人註冊的效果種類另外報）。 */
export function giveProblems(k: Kernel, spec: GiveSpec, houseName: string): string[] {
  const fx = giveEffects(spec, houseName)
  if (fx.length === 0) return []
  // 沒有人登記 contract_hold 時契約不進目錄（catalog.ts），這裡不算內容的錯
  if (spec.kind === 'contract' && !k.effects.has('contract_hold')) return []
  const missing = fx.filter((e) => typeof e.kind !== 'string' || !k.effects.has(e.kind)).map((e) => `效果 ${String(e.kind)} 沒有人登記`)
  if (missing.length > 0) return missing
  const ctx = { state: blankState(0), actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as unknown as Parameters<Kernel['effects']['validate']>[1]
  return k.effects.validate(fx, ctx)
}

/**
 * 現在交得出去嗎：在這個狀態上試跑得標的效果（不寫入）。交得出去是 null；交不出去回傳一句話（給玩家看的原因）。
 *   契約：效果格式不合格、被夾值整筆拿掉（已經持有、人不在場上……）、沒有任何變更，都交不出去；沒有人註冊 contract_hold 也是。
 *   機密：有 effects 而沒有 item 時，效果全部落空（錯誤、整筆被夾掉、沒有變更）才交不出去；有 item 的至少拿得到物品。
 *   零件、義體、藝術品：只有物品，永遠交得出去。
 */
export function undeliverable(k: Kernel, state: GameState, spec: GiveSpec, houseName: string): string | null {
  const fx = giveEffects(spec, houseName)
  if (spec.kind === 'contract' && !k.effects.has('contract_hold')) return '館方現在處理不了契約的轉讓。'
  if (fx.length === 0) return null
  if (fx.some((e) => typeof e.kind !== 'string' || !k.effects.has(e.kind))) return spec.kind === 'contract' ? '館方現在處理不了契約的轉讓。' : '這一件的附帶的東西現在給不出去。'
  const ctx = effectCtx(k, state, { source: 'builtin' })
  const problems = k.effects.validate(fx, ctx)
  if (problems.length > 0) return spec.kind === 'contract' ? '這一份契約的文件有問題，轉讓辦不了。' : '這一件的附帶的東西現在給不出去。'
  const r = k.effects.resolve(fx, ctx)
  const failed = r.errors.length > 0 || r.changes.length === 0 || (spec.kind === 'contract' && r.clamps.length > 0)
  if (!failed) return null
  if (spec.kind === 'contract') return r.clamps[0]?.notice ?? '這一份契約現在轉讓不了。'
  return spec.item !== undefined ? null : '這一件的附帶的東西現在給不出去。'
}
