// L6 功能 media 的鏡頭來源（MEDIA 2.2 節；ITEMS 第 6 節；dev/work/M5-media-pov.md 要做的 2）：一件事結束時，在場的每一個鏡頭各記一則紀錄。
//   錄影義體  隊上每個 rec_grade 大於 0 的人。拍的人是主角：主角的 POV（self_pov）；是隊友：跟拍（follow）
//   無人機    隊上每個 drone_rec 大於 0 的人帶著的錄影無人機（感測器的等級）：視角 drone。戰鬥中被擊落的那一則標 cut_short
//   攝影機    state.ext.media.cams 裡架好的：手持要有人拿（隊友，或頻道編制的製作）、運動別在身上、腳架與針孔架在這個地點；背包裡要真的有那一件
//   監視器、別人的 POV  只定義種類；取得的入口由事件給（record.pov，見 record.ts）
// 這裡只有純函式，不改狀態。

import type { BattleState, Condition, GameState, ItemEntry, Kernel } from '../../core'
import { countItem } from '../../core'
import type { Cam, CamPlace, LensInfo } from './model'
import { DRONE_REC_STAT, REC_STAT, isText, partyOf, readMedia } from './model'
import type { Pov } from './pov'
import { povText } from './pov'

export interface Lens {
  /** 鏡頭的鍵：implant:<角色>、drone:<角色>、cam:<攝影機的 uid> */
  id: string
  kind: 'implant' | 'drone' | 'camera'
  label: string
  pov: Pov
  /** 持有的人（義體與無人機的主人、拿著或戴著攝影機的人、腳架與針孔的主人是主角） */
  by: string
  grade: number
  /** 攝影機的種類（kind 是 camera 才有） */
  cam?: Cam['kind']
  /** 有一個隊上的人手上拿著它（手持；頻道編制的製作拿著的不算）：戰鬥中他每回合少回行動點 */
  hand?: true
}

const statOf = (k: Kernel, state: GameState, actor: string, id: string): number => (k.stats.hasStat(id) && state.actors[actor] ? Math.max(0, Math.floor(k.stats.stat(state, actor, id))) : 0)
const nameOf = (state: GameState, id: string): string => state.actors[id]?.name ?? id

/** 現在站的地方（和架設時記下的比）。 */
export function placeNow(state: Pick<GameState, 'location'>): CamPlace {
  const l = state.location
  return { ...(isText(l.district) ? { district: l.district } : {}), ...(isText(l.block) ? { block: l.block } : {}), ...(isText(l.facility) ? { facility: l.facility } : {}) }
}
export const samePlace = (a: CamPlace, b: CamPlace): boolean => a.district === b.district && a.block === b.block && a.facility === b.facility

/** 條件 channel_staff { role: 'producer' } 現在成立嗎（沒有人註冊這個條件就是不成立）。 */
export function hasProducer(k: Kernel, state: GameState): boolean {
  return k.conditions.kinds().includes('channel_staff') && k.conditions.test({ kind: 'channel_staff', role: 'producer' } as Condition, { state, stats: k.stats, timeRules: k.timeRules })
}

/** 一件攝影機物品的種類與等級（物品寫 camera: hand｜worn｜tripod｜pinhole；等級用物品的 grade）；不是攝影機是 null。 */
export function camItem(k: Kernel, item: string): { kind: Cam['kind']; grade: number; name: string } | null {
  const e = k.content.hasKind('item') ? k.content.get<ItemEntry & Record<string, unknown>>('item', item) : undefined
  if (!e) return null
  const kind = e.camera
  if (kind !== 'hand' && kind !== 'worn' && kind !== 'tripod' && kind !== 'pinhole') return null
  return { kind, grade: Math.min(5, Math.max(1, Math.floor(Number(e.grade) || 1))), name: typeof e.name === 'string' && e.name ? e.name : item }
}

/** 一台架設的攝影機現在有沒有在錄：物品還在背包、種類對得上、有人拿著（或戴著）、或架在這個地點。回傳那個鏡頭，沒在錄是 null。 */
function camLens(k: Kernel, state: GameState, cam: Cam, party: string[], seen: Map<string, number>): Lens | null {
  const it = camItem(k, cam.item)
  if (!it || it.kind !== cam.kind) return null
  // 背包裡要真的有那一件：同一件東西架了幾台，背包裡就要有幾件
  const used = (seen.get(cam.item) ?? 0) + 1
  seen.set(cam.item, used)
  if (countItem(state.inventory, cam.item) < used) return null
  const pc = state.pc
  if (!pc) return null
  let by: string
  if (cam.kind === 'hand') {
    if (cam.holder === 'producer') { if (!hasProducer(k, state)) return null; by = pc }
    else if (isText(cam.holder) && party.includes(cam.holder) && cam.holder !== pc) by = cam.holder
    else return null
  } else if (cam.kind === 'worn') {
    if (!isText(cam.holder) || !party.includes(cam.holder)) return null
    by = cam.holder
  } else {
    if (!cam.place || !samePlace(cam.place, placeNow(state))) return null
    by = pc
  }
  return { id: `cam:${cam.uid}`, kind: 'camera', label: it.name, pov: { kind: 'camera' }, by, grade: it.grade, cam: cam.kind, ...(cam.kind === 'hand' && cam.holder !== 'producer' ? { hand: true as const } : {}) }
}

/**
 * 現在在場的每一個鏡頭（錄影的開關與「不准錄」不在這裡看，由 record.ts 看）：義體、無人機、攝影機，照這個順序。
 * 同一個人的義體與無人機各是一個鏡頭。
 */
export function lensesOf(k: Kernel, state: GameState): Lens[] {
  const out: Lens[] = []
  const party = partyOf(state)
  for (const id of party) {
    const g = statOf(k, state, id, REC_STAT)
    if (g > 0) out.push({ id: `implant:${id}`, kind: 'implant', label: `${nameOf(state, id)}的錄影義體`, pov: id === state.pc ? { kind: 'self_pov', who: id } : { kind: 'follow' }, by: id, grade: Math.min(5, g) })
  }
  for (const id of party) {
    const g = statOf(k, state, id, DRONE_REC_STAT)
    if (g > 0) out.push({ id: `drone:${id}`, kind: 'drone', label: `${nameOf(state, id)}的錄影無人機`, pov: { kind: 'drone' }, by: id, grade: Math.min(5, g) })
  }
  const seen = new Map<string, number>()
  for (const cam of readMedia(state).cams) {
    const l = camLens(k, state, cam, party, seen)
    if (l) out.push(l)
  }
  return out
}

/** 這場戰鬥裡被擊落的無人機的主人：鏡頭的鍵 drone:<角色>（一台自己放出去的無人機被擊落，操作者倒下之後也記著他是誰）。 */
export function downedDrones(battle: Pick<BattleState, 'overlays' | 'units'>): string[] {
  const out = new Set<string>()
  for (const o of battle.overlays) {
    if (!o.down || typeof o.ext?.drone !== 'number') continue
    const unit = battle.units[String(o.ext.operator ?? o.owner ?? '')]
    if (unit?.actor && unit.side === 'ally') out.add(`drone:${unit.actor}`)
  }
  return [...out]
}

/** 給畫面與掛點 media.cameras 的鏡頭清單。 */
export function lensInfos(k: Kernel, state: GameState): LensInfo[] {
  return lensesOf(k, state).map((l) => ({
    id: l.id, label: l.label, pov: { ...l.pov }, pov_text: povText(state, l.pov), by: l.by, grade: l.grade, first_person: l.pov.kind === 'self_pov' && l.pov.who === state.pc,
  }))
}

/** 這些鏡頭的預設選用：有第三人稱的鏡頭時用第一個第三人稱的，否則第一個。 */
export const defaultLens = <T extends { first_person: boolean }>(list: readonly T[]): T | undefined => list.find((l) => !l.first_person) ?? list[0]

