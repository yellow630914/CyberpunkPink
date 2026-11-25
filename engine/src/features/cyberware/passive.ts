// L6 功能 cyberware 的被動效果與場景的身體（dev/adr/0019 第二、三節）。
// 義體是「身上有某樣東西時一直生效的一串加減」：登記成被動效果的來源 cyber 與 quirk（k.passives.register），不自己往 k.stats 或 k.battle 掛 provider。
//   cyber   每一件都給 { stat: 'sink_floor', amount: sink }（休養中、不生效的也給：成本照算）；
//           好了而且沒有 off 的再給設計圖的 effects、每個零件的 effects、板材 stats.armor 的合計（一筆 { stat: 'armor' }）。
//   quirk   身上這些義體帶著的怪癖（併發症、殘響……）的 effects，一樣只在好了、沒有 off 時給。
// 掛點 scene.body（features/scene 宣告）：只在現實（meat）回答，內海用的是化身。回答每一件生效的義體的 scene_parts。

import type { ActorId, GameState, Kernel, PassiveEffect } from '../../core'
import { isRecord, partOf, productOf } from '../../core'
import type { CyberPiece } from './model'
import { blueprintEntry, cyberOf, isActive, nowOf } from './model'

/** 場景的基本部位（features/scene 的 BASE_PARTS；功能之間不互相 import，這裡認同一份名字）：scene_parts 的 sensitivity 寫 all 時展開到這些加上義體多出來的。 */
export const BASE_SCENE_PARTS = ['mouth', 'hand_l', 'hand_r', 'chest', 'front', 'back', 'legs'] as const

const effectsOf = (raw: unknown, label: string): PassiveEffect[] =>
  Array.isArray(raw) ? raw.filter((e): e is PassiveEffect => isRecord(e)).map((e) => ({ label, ...e }) as PassiveEffect) : []

/** 身上這個人現在給的（來源 cyber）：沉溺的下限與生效的義體的效果。 */
export function cyberPassives(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): PassiveEffect[] {
  const pieces = cyberOf(state, actor)
  if (pieces.length === 0) return []
  const now = nowOf(state)
  const out: PassiveEffect[] = []
  for (const piece of pieces) {
    const bp = blueprintEntry(k, piece.bp)
    const name = bp?.name ?? piece.bp
    if (piece.sink > 0) out.push({ stat: 'sink_floor', amount: piece.sink, label: name })
    if (!isActive(piece, now) || !bp) continue
    out.push(...effectsOf(bp.effects, name))
    const info = productOf(k.content, piece.bp, piece)
    if (!info) continue
    for (const { part } of info.parts) out.push(...effectsOf(part.effects, part.name))
    const armor = info.stats.armor
    if (typeof armor === 'number' && Number.isFinite(armor) && armor !== 0) out.push({ stat: 'armor', amount: armor, label: name })
  }
  return out
}

/** 身上這些義體帶著的怪癖的 effects（來源 quirk）：好了、沒有 off 的那幾件。 */
export function quirkPassives(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): PassiveEffect[] {
  const pieces = cyberOf(state, actor)
  if (pieces.length === 0) return []
  const now = nowOf(state)
  const out: PassiveEffect[] = []
  for (const piece of pieces) {
    if (!isActive(piece, now)) continue
    const info = productOf(k.content, piece.bp, piece)
    if (!info) continue
    for (const q of info.quirks) out.push(...effectsOf(q.effects, q.name))
  }
  return out
}

/** 這個人好了的義體（生效的）。 */
export const activePieces = (state: GameState, actor: ActorId): CyberPiece[] => {
  const now = nowOf(state)
  return cyberOf(state, actor).filter((p) => isActive(p, now))
}

/** 場景問身體的回答：每一件生效的義體的 scene_parts。沒有就是 undefined。 */
export interface SceneBodyAnswer {
  parts?: string[]
  sensitivity?: Record<string, number>
}

export function sceneBody(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, layer: string): SceneBodyAnswer | undefined {
  if (layer !== 'meat') return undefined
  const found: Array<{ adds: string[]; sensitivity: Record<string, number> }> = []
  for (const piece of activePieces(state, actor)) {
    const sp = blueprintEntry(k, piece.bp)?.scene_parts
    if (!isRecord(sp)) continue
    const adds = Array.isArray(sp.adds) ? sp.adds.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const sens: Record<string, number> = {}
    if (isRecord(sp.sensitivity)) for (const [part, n] of Object.entries(sp.sensitivity)) if (typeof n === 'number' && Number.isFinite(n) && n !== 0) sens[part] = n
    if (adds.length > 0 || Object.keys(sens).length > 0) found.push({ adds, sensitivity: sens })
  }
  if (found.length === 0) return undefined
  const parts = [...new Set(found.flatMap((f) => f.adds))]
  const everyPart = [...new Set<string>([...BASE_SCENE_PARTS, ...parts])]
  const sensitivity: Record<string, number> = {}
  for (const f of found) {
    for (const [part, n] of Object.entries(f.sensitivity)) {
      for (const target of part === 'all' ? everyPart : [part]) sensitivity[target] = (sensitivity[target] ?? 0) + n
    }
  }
  const out: SceneBodyAnswer = {}
  if (parts.length > 0) out.parts = parts
  const nonZero = Object.fromEntries(Object.entries(sensitivity).filter(([, n]) => n !== 0))
  if (Object.keys(nonZero).length > 0) out.sensitivity = nonZero
  return out.parts || out.sensitivity ? out : undefined
}

/** 這個人身上義體的怪癖（含設計圖上寫死的以外，成品與內嵌零件帶的）：用在畫面。partOf 先查過，零件查不到的略過。 */
export const quirkIdsOf = (k: Pick<Kernel, 'content'>, piece: CyberPiece): string[] => {
  const ids = new Set<string>(piece.quirks ?? [])
  for (const refs of Object.values(piece.parts)) {
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const q = partOf(k.content, ref)?.quirk
      if (typeof q === 'string') ids.add(q)
    }
  }
  return [...ids]
}
