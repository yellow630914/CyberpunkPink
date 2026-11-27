// L6 功能 media 的攝影機（ITEMS 第 6 節；MEDIA 2.2 節；dev/work/M5-media-pov.md 要做的 2、7）：架設、重架、放下。
//   手持攝影機  要有人拿著：隊友，或頻道編制的製作（條件 channel_staff { role: 'producer' }）。拿的人戰鬥中每回合少回 cam.hand_ap 點行動點（給鏡頭），放下就不錄
//   運動攝影機  別在身上，不佔手；戴的人是隊上的人（預設主角）
//   腳架攝影機  架在現在這個地點，花一個時段（cam.tripod_minutes）；換地方要重架，戰鬥中不能換；架好之前不錄
//   針孔攝影機  留在現場（品質最高 1），花 cam.pinhole_minutes 分鐘；視角是攝影機，架在這個地點
// 攝影機是背包裡的物品（物品寫 camera: hand｜worn｜tripod｜pinhole，等級用物品的 grade）；架設的狀態記在 state.ext.media.cams（變更 media.cam）。
// 背包裡沒有那一件了、拿的人離隊了、換了地方（腳架），那一台就不錄（lens.ts）。

import type { GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, countItem } from '../../core'
import { draftOf } from './chain'
import { camItem, hasProducer, lensesOf, placeNow } from './lens'
import type { Cam, CamKind } from './model'
import { CAM_ACTION, CAM_NAME, isText, mediaRules, partyOf, readMedia } from './model'

export interface CamInput {
  /** 背包裡的攝影機物品 id */
  item: string
  /** 手持：拿的人（隊友的角色 id，或 'producer'）、運動：戴的人（預設主角） */
  holder?: string
  /** 重架：換地方、換人拿（帶現有的那一台的 uid） */
  uid?: string
}

export interface CamPlan {
  block: string | null
  kind: CamKind | null
  minutes: number
}

/** 這一台現在架不架得起來：每一條擋住的原因是完整的一句。 */
export function camBlock(k: Kernel, state: GameState, o: CamInput): CamPlan {
  const none = (block: string): CamPlan => ({ block, kind: null, minutes: 0 })
  const act = k.activity.blockOf(state, `commit:${CAM_ACTION}`)
  if (act) return none(act)
  if (!state.pc || !state.actors[state.pc]) return none('還沒有主角，沒有人可以架攝影機。')
  const it = isText(o.item) ? camItem(k, o.item) : null
  if (!it) return none('那不是一台攝影機。')
  const m = readMedia(state)
  if (o.uid !== undefined && !m.cams.some((c) => c.uid === o.uid)) return none('沒有這一台架好的攝影機。')
  const claimed = m.cams.filter((c) => c.item === o.item && c.uid !== o.uid).length
  if (countItem(state.inventory, o.item) <= claimed) return none(`背包裡沒有多的${it.name}了。`)
  const party = partyOf(state)
  const rules = mediaRules(k)
  if (it.kind === 'hand') {
    if (o.holder === 'producer') {
      if (!hasProducer(k, state)) return none('頻道編制裡沒有製作，沒有人替你拿攝影機。')
    } else if (!isText(o.holder) || !party.includes(o.holder) || o.holder === state.pc) return none('手持攝影機要有人拿著：選一個隊友，或讓頻道編制的製作拿。')
  } else if (it.kind === 'worn') {
    const who = o.holder ?? state.pc
    if (!party.includes(who)) return none('運動攝影機要別在隊上的人身上。')
  }
  return { block: null, kind: it.kind, minutes: it.kind === 'tripod' ? rules.cam.tripod_minutes : it.kind === 'pinhole' ? rules.cam.pinhole_minutes : 0 }
}

/** 架設（或重架）一台攝影機：回傳報告草稿 media.cam；不成立丟 ActionBlocked。 */
export function setCamera(k: Kernel, state: GameState, o: CamInput): ReportDraft {
  const plan = camBlock(k, state, o)
  if (plan.block !== null || !plan.kind) throw new ActionBlocked(plan.block ?? '現在架不了攝影機。')
  const name = CAM_NAME[plan.kind]
  const holder = plan.kind === 'hand' ? o.holder : plan.kind === 'worn' ? o.holder ?? state.pc : undefined
  const fixed = plan.kind === 'tripod' || plan.kind === 'pinhole'
  const set: Cam & { uid?: string } = {
    uid: o.uid as string, item: o.item, kind: plan.kind, ...(holder ? { holder } : {}), ...(fixed ? { place: placeNow(state) } : {}),
  }
  if (o.uid === undefined) delete (set as { uid?: string }).uid
  const who = holder === 'producer' ? '製作' : holder ? state.actors[holder]?.name ?? holder : ''
  const text = fixed ? `你${o.uid !== undefined ? '重新架好了' : '架好了'}${name}：這裡的事它都錄得到。` : plan.kind === 'hand' ? `${who}拿起了${name}。` : `${who}把${name}別在身上。`
  const changes: ReportDraft['changes'] = [...(plan.minutes > 0 ? [{ op: 'time', minutes: plan.minutes } as const] : []), { op: 'media.cam', set }]
  return draftOf(state, CAM_ACTION, changes, 'cam_set', text, { narration: { results: [text] } })
}

/** 放下一台攝影機（放下就不錄）：回傳報告草稿 media.cam；不成立丟 ActionBlocked。 */
export function dropCamera(k: Kernel, state: GameState, uid: string): ReportDraft {
  const act = k.activity.blockOf(state, `commit:${CAM_ACTION}`)
  if (act) throw new ActionBlocked(act)
  const cam = readMedia(state).cams.find((c) => c.uid === uid)
  if (!cam) throw new ActionBlocked('沒有這一台架好的攝影機。')
  const text = `你把${CAM_NAME[cam.kind]}放下了：它不再錄。`
  return draftOf(state, CAM_ACTION, [{ op: 'media.cam', drop: uid }], 'cam_drop', text, { narration: { results: [text] } })
}

export interface CamRow {
  uid: string
  item: string
  kind: CamKind
  name: string
  holder: string | null
  holder_name: string | null
  /** 現在有沒有在錄（物品還在背包、有人拿著或戴著、腳架與針孔在這個地點） */
  recording: boolean
}

/** 架好的攝影機的清單（畫面用）。 */
export function camRows(k: Kernel, state: GameState): CamRow[] {
  const on = new Set(lensesOf(k, state).filter((l) => l.kind === 'camera').map((l) => l.id))
  return readMedia(state).cams.map((c) => ({
    uid: c.uid, item: c.item, kind: c.kind, name: camItem(k, c.item)?.name ?? CAM_NAME[c.kind], holder: c.holder ?? null,
    holder_name: c.holder === 'producer' ? '製作' : c.holder ? state.actors[c.holder]?.name ?? c.holder : null, recording: on.has(`cam:${c.uid}`),
  }))
}
