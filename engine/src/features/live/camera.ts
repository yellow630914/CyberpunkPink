// L6 功能 live 的鏡頭（MEDIA 第 6 節、1.2、1.3 節；dev/work/M5-media-pov.md 要做的 6）：開播時選用哪個鏡頭。
// 隊上有哪些鏡頭只問掛點 media.cameras（media 回答：錄影義體、錄影無人機、架好的攝影機各一筆；不 import media）。
//   沒有人回答這個掛點（沒裝 media）：不要求鏡頭，照舊開得了、沒有鏡頭可選。
//   有人回答、清單是空的：隊上沒有任何一種鏡頭來源，開不了播。
//   選用的那一個鏡頭的視角就是這場直播的視角，也是播完留下的紀錄的視角（settle.ts 交給 media.record 的 hint）。
//   第一人稱直播：選的是主角自己的錄影義體（first_person）。一般內容的直播收播時訂閱 ×rules.first_person.subs_mult；
//   成人的（成人時段直播、宿主是成人場景的活動直播）熱度 +rules.first_person.adult_heat（使用者 2026-11-27：活動直播也一樣）。

import type { GameState, Kernel } from '../../core'
import { isRecord } from '../../core'
import type { Session, SessionCamera } from './model'
import { isText } from './model'

type AnyHook = (name: string, payload: unknown) => Array<{ owner: string; result: unknown }>

export type CameraChoice = SessionCamera

const NONE = '隊上沒有任何一種鏡頭（錄影義體、錄影無人機或架好的攝影機），開不了直播。'

/** media 回答的鏡頭清單的一筆讀成選項（格式不對的略過）。 */
function readChoice(v: unknown): CameraChoice | null {
  if (!isRecord(v) || !isText(v.id) || !isText(v.by) || !isRecord(v.pov) || !isText(v.pov.kind)) return null
  return {
    id: v.id, label: typeof v.label === 'string' ? v.label : v.id, pov: { kind: v.pov.kind, ...(isText(v.pov.who) ? { who: v.pov.who } : {}) },
    pov_text: typeof v.pov_text === 'string' ? v.pov_text : v.pov.kind, by: v.by, grade: typeof v.grade === 'number' && Number.isFinite(v.grade) ? v.grade : 1, first_person: v.first_person === true,
  }
}

/** 隊上現在有哪些鏡頭：answered 是有沒有人回答（沒裝 media 就沒有）。 */
export function camerasOf(k: Kernel, state: GameState): { answered: boolean; list: CameraChoice[] } {
  const owners = (k.hooks.owners as unknown as (n: string) => string[]).call(k.hooks, 'media.cameras')
  if (owners.length === 0) return { answered: false, list: [] }
  const out: CameraChoice[] = []
  for (const a of (k.hooks.run as unknown as AnyHook).call(k.hooks, 'media.cameras', { state })) {
    if (!Array.isArray(a.result)) continue
    for (const v of a.result) { const c = readChoice(v); if (c && !out.some((x) => x.id === c.id)) out.push(c) }
  }
  return { answered: true, list: out }
}

export interface CameraPlan {
  answered: boolean
  list: CameraChoice[]
  /** 選用的那一個（沒有鏡頭可選是 null） */
  chosen: CameraChoice | null
  /** 擋下的原因（一條一句） */
  blocks: string[]
  first_person: boolean
}

/** 選鏡頭：沒指定時有第三人稱的用第一個第三人稱的，否則第一個；指定了清單裡沒有的擋下。 */
export function cameraPlan(k: Kernel, state: GameState, want: string | undefined): CameraPlan {
  const { answered, list } = camerasOf(k, state)
  const blocks: string[] = []
  if (answered && list.length === 0) blocks.push(NONE)
  let chosen: CameraChoice | null = null
  if (list.length > 0) {
    if (want !== undefined) {
      chosen = list.find((c) => c.id === want) ?? null
      if (!chosen) blocks.push('選的那個鏡頭現在用不了：換一個鏡頭。')
    } else chosen = list.find((c) => !c.first_person) ?? list[0]!
  }
  return { answered, list, chosen, blocks, first_person: chosen?.first_person === true }
}

/** 這一場是不是成人的內容（成人時段直播、宿主是成人場景的活動直播）：第一人稱的修正分成人與一般。 */
export const isAdultSession = (s: Pick<Session, 'mode' | 'kind' | 'host'>): boolean => (s.mode === 'slot' ? s.kind === 'adult' : s.host?.kind === 'scene')
