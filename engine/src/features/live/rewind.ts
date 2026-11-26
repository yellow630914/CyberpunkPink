// L6 功能 live 的「直播不回退」（MEDIA 第 3 節；dev/adr/0020 第三節；dev/work/M5-live.md 要做的 7）。
// 掛鉤 rewind.keep（撤退、委託失敗、戰敗後的回退、重來這場戰鬥）：current 是回去之前、restored 是快照那一刻。
//   - 回去之前的 log 裡有、快照那一刻沒有的每一筆：把訂閱與打賞補回去（各一次），並把 activity.end（種類 live）原樣再發一次——頻道的這一週算開過、記一筆，
//     也是這樣補回來的（channel 的 week.lives 與 log 跟著狀態回去了，不會自己補）。那一則紀錄不用補：media 的 rewind.keep 本來就保留回去之前的紀錄，並把直播的那一則標成戰敗的畫面。
//   - 回去之前還在播的那一場：當場照收播的算法收掉（標 lost），訂閱、打賞、紀錄、頻道的記錄一起補。
//   - 之後的 state.ext.live：沒有進行中的直播、log 是回去之前的（加上剛收掉的）、seq 取較大的（下一場的 id 不會和 log 裡的撞）。
// 補的變更接在 media 的 rewind.keep 後面（FEATURES 的順序）：media 先用整份 ext 換，這裡的 media.add 才接得上。

import type { Change, GameState, Kernel } from '../../core'
import { endActivity } from '../../core'
import type { Settled } from './model'
import { EXT, OWNER, liveRules, liveValue, readLive } from './model'
import { settleSession } from './settle'

/** 一筆以前收掉的結果，在回去之後的狀態上要補的變更：訂閱、打賞、再發一次 activity.end。 */
function replay(k: Kernel, restored: GameState, e: Settled): Change[] {
  const out: Change[] = []
  if (e.subs !== 0) out.push({ op: 'meter', kind: 'subs', key: '_', delta: e.subs })
  if (e.tips > 0) out.push({ op: 'cred', delta: e.tips })
  const end = endActivity(k, {
    state: restored, kind: 'live', id: e.id, origin: { by: OWNER }, outcome: e.lost ? 'lost' : 'done',
    result: {
      mode: e.mode, template: e.template, heat: e.heat, viewers: e.viewers ?? 0, subs: e.subs, tips: e.tips, goals_done: e.goals_done, to_channel: e.off_channel !== true,
      ...(e.tier ? { tier: e.tier } : {}), ...(e.grade !== undefined ? { grade: e.grade } : {}), ...(e.lost ? { lost: true } : {}), replayed: true,
    },
  })
  out.push(...end.changes)
  return out
}

/** 掛鉤 rewind.keep。 */
export function onRewind(k: Kernel, current: GameState, restored: GameState): Change[] | undefined {
  if (current.ext?.[EXT] === undefined) return undefined
  const cur = readLive(current)
  const rst = readLive(restored)
  const seen = new Set(rst.log.map((e) => e.id))
  const changes: Change[] = []
  const log = [...cur.log]
  for (const e of cur.log) if (!seen.has(e.id)) changes.push(...replay(k, restored, e))
  // 回去之前還在播的：當場收（標 lost）；數字用回去之前的狀態（那時候的訂閱與時間），紀錄與頻道的記錄套在回去之後的狀態上
  if (cur.session) {
    const st = settleSession(k, restored, cur.session, { outcome: 'rewind', early: false, lost: true, numbers: current })
    changes.push(...st.changes)
    log.push(st.entry)
  }
  const next = liveValue({ session: null, seq: Math.max(cur.seq, rst.seq), log: log.slice(-liveRules(k).log_keep) })
  if (JSON.stringify(next) !== JSON.stringify(liveValue(rst))) changes.push({ op: 'ext', key: EXT, value: next })
  return changes.length > 0 ? changes : undefined
}
