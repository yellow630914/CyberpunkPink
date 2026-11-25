// L6 功能 cyberware 給畫面的視圖：每個部位的每一槽、每一件的名字、等級、成本、狀態、效果的清單（角色詳情的人形圖用）。
// 規格：CYBERWARE 第 1 節；dev/work/M4-cyberware.md。只讀，不改狀態。

import type { ActorId, GameState, Kernel, PassiveEffect } from '../../core'
import { productOf } from '../../core'
import type { CyberOff, PartId } from './model'
import { deckContentOf, isDeckPiece, pieceBlueprint } from './deck'
import { PART_IDS, PART_NAME, cyberOf, cyberRules, isReady, nowOf } from './model'
import { quirkIdsOf } from './passive'

/** 一件的狀態：ready 生效中、recovering 休養中、off 不生效（授權鎖、壞了……）。 */
export type PieceStatus = 'ready' | 'recovering' | 'off'

export interface ViewPiece {
  uid: string
  bp: string
  name: string
  grade: number
  slot: PartId
  /** 裝上時算定的沉溺成本 */
  sink: number
  status: PieceStatus
  /** 休養到什麼時候（總分鐘）；已經好了沒有 */
  ready_at?: number
  off?: CyberOff
  registered: boolean
  /** 這一件是甲板（設計圖帶 deck 欄位，或內容種類 deck 的成品） */
  deck?: boolean
  /** 全生體 */
  bio: boolean
  quality?: string
  /** 帶著的怪癖（併發症、殘響……） */
  quirks: Array<{ id: string; name: string }>
  /** 這一件好了之後給的效果（設計圖與零件的 effects；板材的護甲合計是一筆 { stat: 'armor' }）。休養中也列，畫面自己灰掉 */
  effects: PassiveEffect[]
}

export interface ViewPart {
  id: PartId
  name: string
  /** 這個部位有幾槽 */
  slots: number
  used: number
  free: number
  /** 每一槽裡是什麼（長度是槽數；空的是 null；比槽數多的件照樣列出來） */
  pieces: Array<ViewPiece | null>
}

export interface CyberView {
  actor: ActorId
  parts: ViewPart[]
  /** 沉溺的下限（有 sink_floor 這個衍生數值時；沒有就是身上義體成本的合計） */
  sink_floor: number
  sink: number
  /** 身上最晚的休養結束時間；沒有在休養是 undefined */
  recovering_until?: number
  /** 有沒有橋 */
  bridge: boolean
}

export function viewPiece(k: Kernel, state: GameState, actor: ActorId, uid: string): ViewPiece | undefined {
  const piece = cyberOf(state, actor).find((p) => p.uid === uid)
  if (!piece) return undefined
  const bp = pieceBlueprint(k, piece)
  const dk = piece.kind_of === 'deck' ? deckContentOf(k, piece.bp) : undefined
  const info = piece.kind_of === 'deck' ? undefined : productOf(k.content, piece.bp, piece)
  const effects: PassiveEffect[] = []
  if (bp && Array.isArray(bp.effects)) effects.push(...(bp.effects as unknown as PassiveEffect[]).map((e) => ({ ...e })))
  for (const { part } of info?.parts ?? []) if (Array.isArray(part.effects)) effects.push(...(part.effects as unknown as PassiveEffect[]).map((e) => ({ ...e })))
  const armor = info?.stats.armor
  if (typeof armor === 'number' && Number.isFinite(armor) && armor !== 0) effects.push({ stat: 'armor', amount: armor })
  const ready = isReady(piece, nowOf(state))
  const quirks = quirkIdsOf(k, piece).flatMap((id) => {
    const q = k.content.hasKind('quirk') ? k.content.get<{ id: string; name?: string }>('quirk', id) : undefined
    return q ? [{ id, name: q.name ?? id }] : []
  })
  return {
    uid: piece.uid, bp: piece.bp, name: bp?.name ?? dk?.name ?? piece.bp, grade: bp?.grade ?? dk?.grade ?? 1, slot: piece.slot, sink: piece.sink,
    status: piece.off ? 'off' : ready ? 'ready' : 'recovering',
    ...(piece.ready_at !== undefined && !ready ? { ready_at: piece.ready_at } : {}), ...(piece.off ? { off: { ...piece.off } } : {}),
    registered: piece.registered === true, ...(isDeckPiece(k, piece) ? { deck: true } : {}), bio: info?.allBio === true, ...(piece.quality ? { quality: piece.quality } : {}), quirks, effects,
  }
}

/** 這個人身上的義體：每個部位的每一槽。 */
export function cyberView(k: Kernel, state: GameState, actor: ActorId): CyberView {
  const rules = cyberRules(k)
  const pieces = cyberOf(state, actor)
  const views = new Map(pieces.flatMap((p) => { const v = viewPiece(k, state, actor, p.uid); return v ? [[p.uid, v] as const] : [] }))
  const parts: ViewPart[] = PART_IDS.map((id) => {
    const here = pieces.filter((p) => p.slot === id).map((p) => views.get(p.uid)!)
    const slots = rules.slots[id]
    const list: Array<ViewPiece | null> = [...here]
    while (list.length < slots) list.push(null)
    return { id, name: PART_NAME[id], slots, used: here.length, free: Math.max(0, slots - here.length), pieces: list }
  })
  const now = nowOf(state)
  const waiting = pieces.filter((p) => !isReady(p, now))
  return {
    actor, parts,
    sink_floor: k.stats.hasStat('sink_floor') && state.actors[actor] ? k.stats.stat(state, actor, 'sink_floor') : pieces.reduce((n, p) => n + p.sink, 0),
    sink: state.actors[actor]?.sink ?? 0,
    ...(waiting.length > 0 ? { recovering_until: Math.max(...waiting.map((p) => p.ready_at!)) } : {}),
    bridge: pieces.some((p) => p.slot === 'bridge') || (state.actors[actor] ? state.actors[actor]!.ext.bridge !== null : false),
  }
}
