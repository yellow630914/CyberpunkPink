// L6 功能 media 的視角（MEDIA 2.2 節；dev/work/M5-media-pov.md）：每一則紀錄與每一段素材都帶一個視角——這一段是從哪個鏡頭看出去的。
//   self_pov  某人的 POV（那個人的錄影義體；帶 who）。拍的人自己不在畫面裡
//   follow    跟拍（隊友的錄影義體拍著主角）
//   drone     無人機（感測器帶內建錄影）
//   camera    攝影機（手持、運動、腳架、針孔）
//   cctv      監視器（場地的固定鏡頭；取得它的入口由事件給）
//   other_pov 別人的 POV（駭進敵人的義眼拿到的；帶 who；取得它的入口由事件給）
// 這個檔只有格式與純函式（顯示的文字、畫面裡有沒有你、看點與可信的視角修正、多機位）；不碰登錄表與狀態。

import type { GameState } from '../../core'
import { isRecord } from '../../core'
import type { MediaRules, MediaType } from './model'

export const POV_KINDS = ['self_pov', 'follow', 'drone', 'camera', 'cctv', 'other_pov'] as const
export type PovKind = (typeof POV_KINDS)[number]

export interface Pov {
  kind: PovKind
  /** self_pov、other_pov：那一個人（角色 id 或名字） */
  who?: string
}

export const isPovKind = (v: unknown): v is PovKind => (POV_KINDS as readonly unknown[]).includes(v)

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 把不知道形狀的東西讀成視角（不是視角回 null）。 */
export function readPov(v: unknown): Pov | null {
  if (!isRecord(v) || !isPovKind(v.kind)) return null
  return { kind: v.kind, ...(isText(v.who) && (v.kind === 'self_pov' || v.kind === 'other_pov') ? { who: v.who } : {}) }
}

/**
 * 舊存檔沒有視角的紀錄與素材（和不指定視角的入口：事件給的素材、偽造的）：當成「某人的 POV」，不帶那個人（不知道是誰）。
 * 視角的看點加成只給帶著 who 的 POV（povParts），所以舊資料的數字不變。
 */
export const legacyPov = (): Pov => ({ kind: 'self_pov' })

/** 兩個視角是不是同一種視角（多機位用：種類與那個人都一樣才算同一個）。 */
export const povKey = (p: Pov): string => `${p.kind}:${p.who ?? ''}`

/** 給玩家看的一句話（「〇〇的 POV」「跟拍」「無人機跟拍」……）；也進 AI 的素材描述。 */
export function povText(state: Pick<GameState, 'actors'>, p: Pov): string {
  const name = isText(p.who) ? state.actors[p.who]?.name ?? p.who : null
  switch (p.kind) {
    case 'self_pov': return `${name ?? '某人'}的 POV`
    case 'follow': return '跟拍'
    case 'drone': return '無人機跟拍'
    case 'camera': return '攝影機'
    case 'cctv': return '監視器'
    case 'other_pov': return `${name ?? '別人'}的 POV（駭來的）`
  }
}

/**
 * 畫面裡有沒有你（MEDIA 2.2 節）：主角自己的 POV 不算；跟拍、無人機、攝影機在主角入鏡時算（鏡頭拍著主角，一律算）；
 * 監視器與別人的 POV 看那一件事的資料（hint.self），沒寫就是沒有。
 */
export function povSelf(p: Pov, hintSelf?: boolean): boolean {
  if (p.kind === 'self_pov') return false
  if (p.kind === 'cctv' || p.kind === 'other_pov') return hintSelf === true
  return hintSelf !== false
}

export interface PovSource { type: MediaType; pov: Pov; event?: string }
export interface PovPart { label: string; value: number }

/**
 * 視角給看點與可信的修正（MEDIA 2.2、第 3 節）：一支片（或一段素材）只要有一段來源符合就加，不重複加；
 *   看點：某人的 POV 且親密或戰鬥類 +pov_draw、無人機且戰鬥類 +drone_draw、監視器 cctv_draw（負的）、多機位（兩段以上同一件事、視角不同）+multi_draw
 *   可信：監視器 +cctv_trust、別人的 POV +other_trust
 * 數字在規則表 media_rule.pov。
 */
export function povParts(rules: MediaRules, sources: PovSource[]): { draw: PovPart[]; trust: PovPart[] } {
  const r = rules.pov
  const draw: PovPart[] = []
  const trust: PovPart[] = []
  if (sources.some((s) => s.pov.kind === 'self_pov' && isText(s.pov.who) && (s.type === 'intimate' || s.type === 'battle')) && r.pov_draw !== 0) draw.push({ label: '某人的 POV', value: r.pov_draw })
  if (sources.some((s) => s.pov.kind === 'drone' && s.type === 'battle') && r.drone_draw !== 0) draw.push({ label: '無人機', value: r.drone_draw })
  if (sources.some((s) => s.pov.kind === 'cctv') && r.cctv_draw !== 0) draw.push({ label: '監視器', value: r.cctv_draw })
  if (multiAngle(sources) && r.multi_draw !== 0) draw.push({ label: '多機位', value: r.multi_draw })
  if (sources.some((s) => s.pov.kind === 'cctv') && r.cctv_trust !== 0) trust.push({ label: '監視器', value: r.cctv_trust })
  if (sources.some((s) => s.pov.kind === 'other_pov') && r.other_trust !== 0) trust.push({ label: '別人的 POV', value: r.other_trust })
  return { draw, trust }
}

/** 多機位：兩段以上來自同一件事（event 相同）、視角不同。不同的事拼在一起不算，同一件事只有一個視角也不算。 */
export function multiAngle(sources: PovSource[]): boolean {
  const byEvent = new Map<string, Set<string>>()
  for (const s of sources) {
    if (!isText(s.event)) continue
    const set = byEvent.get(s.event) ?? new Set<string>()
    set.add(povKey(s.pov))
    byEvent.set(s.event, set)
  }
  for (const set of byEvent.values()) if (set.size >= 2) return true
  return false
}
