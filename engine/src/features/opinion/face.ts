// 活動 face.opinion：委託副本的輿論面（OPINION 4.5、第 6 節；dev/adr/0020 第六節、V35～V38；dev/work/M5-opinion-face.md）。
// 和 opinion 是同一個功能、同一份狀態（戰役的狀態（model.ts 的 readWar），mode 是 face），order 都是 50；差別只有開場（照副本給的 setup 與開場表）、
// 決定性的一步沒贏時的三選一（lost.ts）、收買與找上門的完整結算（turn.ts、bribe.ts、visit.ts）、外包（outsource.ts）、交回的 result（closeDraft）。
// 開戰那一份的第一筆變更是 snapshot.take（種類 opinion、replace、owner 是委託的 id；data 帶原本的 setup 與 origin，介面重來時照它再開一次）。

import type { GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, isRecord } from '../../core'
import type { FaceSetup } from './faceopen'
import { faceOpenSetup, snapshotChange } from './faceopen'
import { outsourceDraft } from './outsource'
import { startDraft } from './start'

/** 開這一段：副本給的 setup 照開場表變成一場戰役；setup.outsource 有人就不開棋盤，直接交給外包（outsource.ts）。 */
export function faceStartDraft(k: Kernel, state: GameState, raw: unknown, origin: Origin): ReportDraft {
  if (!isRecord(raw)) throw new ActionBlocked('輿論面的 setup 要是一個物件。')
  const setup = raw as FaceSetup
  if (setup.outsource !== undefined) {
    if (typeof setup.outsource !== 'string' || setup.outsource === '') throw new ActionBlocked('外包要寫是名冊上的誰（outsource 要是角色的 id）。')
    return outsourceDraft(k, state, setup, setup.outsource, origin)
  }
  const d = startDraft(k, state, faceOpenSetup(k, setup), origin)
  d.changes.unshift(snapshotChange(setup, origin))
  return d
}
