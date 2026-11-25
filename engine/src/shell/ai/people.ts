// L7 外殼：給 AI 的人物資料裡「玩家自己寫的稱呼與外觀」（M4-followups-2 第 2 項）。
//   稱呼（NPC_SYSTEM 7.0 節）：npc 的人物狀態 call_them（你怎麼叫他）、call_me（他怎麼叫你），最多 12 字；正文與對話都照用。
//   化身描述（CYBERSPACE 4 節）：化身 avatar.text，最多 200 字；內海的正文照它寫，現實不帶。
// 玩家寫的文字原樣交給 AI：這一端不篩選、不改寫、不提示，不合規的由服務商擋（使用者 2026-11-25）。這裡只負責「讀出來、放進輸入」，不改任何東西。
// 兩個功能沒裝（沒有 npcs 或 deck）時讀不到東西，照樣回空的。

import type { ActorId, GameState, Kernel } from '../../core'
import { avatarOf } from '../../features/deck'
import { callNamesOf } from '../../features/npcs'
import { NET_ACTIVITIES } from '../../features/scene'

/** 稱呼：寫了才有這一欄。call_them 是主角怎麼叫他，call_me 是他怎麼叫主角（只有 NPC 有）。 */
export interface CallNames {
  call_them?: string
  call_me?: string
}

/** 這個人現在的稱呼（沒填的不出現）。 */
export const callsFor = (state: GameState, id: ActorId): CallNames => callNamesOf(state, id)

/** 化身的外觀描述（沒寫是 undefined）。 */
export function avatarTextFor(state: GameState, id: ActorId): string | undefined {
  const t = state.actors[id] ? avatarOf(state, id).text : undefined
  return t && t.length > 0 ? t : undefined
}

/** 主角現在在內海嗎（進行中的活動是潛入、竄網或面對面的內海戰）：化身的描述只在這時候進輸入。 */
export const inNetNow = (k: Pick<Kernel, 'activity'>, state: GameState): boolean => k.activity.active(state).some((a) => (NET_ACTIVITIES as readonly string[]).includes(a.kind))

/** { id, name } 加上稱呼：給 AI 的「出場的人」。 */
export const personFor = (state: GameState, id: ActorId): { id: ActorId; name: string } & CallNames => ({ id, name: state.actors[id]?.name ?? id, ...callsFor(state, id) })
