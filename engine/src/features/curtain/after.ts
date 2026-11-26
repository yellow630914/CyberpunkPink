// L6 功能 curtain 的「報告套用之後」（掛點 report.after）：結算完了發 curtain.result、往下一幕之後進化妝室、場熱跨過門檻的事（贊助人、加演、到 0）。
//
// 場熱的漲跌都寫成量表的 delta（加法），所以「跨過門檻」不在掛點裡算（同一份報告裡好幾個掛點讀到的都是舊的場熱），一律等報告套用完再看現在的場熱：
// 第一次到 sponsor 門檻（70）：贊助人現身，立旗標 curtain_sponsor（線頭是內容）；第一次到 encore 門檻（90）：記下可以加演；到 0：提早落幕。
// 這些都用 curtain.stage 記一次（每一個只記一次）；第一份 netrun 報告之後也用它記下這一趟的地圖實例。

import type { Change, GameState, Kernel, Report, ReportDraft } from '../../core'
import { ctxOf } from './ctx'
import type { Ctx } from './ctx'
import { heatOf, heatSet } from './heat'
import type { RunRecord } from './model'
import { FLAG_SPONSOR, STAGE_ACTION, readCurtain } from './model'
import { restDraft } from './nodes'
import { runPatch } from './patch'
import { fallDraft, replayReport } from './fall'
import { encoreStale, encoreVoidDraft, resultDraft } from './settle'
import { draftOf } from './util'

/** 場熱跨過門檻、剛開地圖的那一份記錄；沒有要記的是 null。 */
export function stageDraft(c: Ctx): ReportDraft | null {
  const { run, rules } = c
  const set: Partial<RunRecord> = {}
  const changes: Change[] = []
  const lines: string[] = []
  let heat = heatOf(c.k, c.state, c.map)
  if (run.map !== c.map) {
    set.map = c.map
    if (run.start_heat !== undefined) {
      changes.push(heatSet(c.map, run.start_heat))
      heat = run.start_heat
      lines.push(`加演開場，場熱接著上一趟的 ${heat}。`)
    } else lines.push(`簾後館的一晚開始了。場熱 ${heat}。`)
  }
  if (!run.sponsor && heat >= rules.heat.sponsor) {
    set.sponsor = true
    changes.push({ op: 'flag', key: FLAG_SPONSOR, value: true })
    lines.push(`場熱到了 ${rules.heat.sponsor}：贊助人現身了。`)
  }
  if (!run.encore_open && heat >= rules.heat.encore) {
    set.encore_open = true
    lines.push(`場熱到了 ${rules.heat.encore}：觀眾喊著安可，過了終幕可以加演。`)
  }
  if (!run.cut && heat <= 0) {
    set.cut = true
    lines.push('場熱掉到 0：觀眾散場了。這一趟提早落幕，不算戰敗：下一份報告就收場，已經拿到的票根照算，沒有打賞。')
  }
  if ((lines.length || changes.length) && heat > (run.peak ?? 0)) set.peak = heat
  const unset: Array<keyof RunRecord> = run.start_heat !== undefined && run.map !== c.map ? ['start_heat'] : []
  if (!Object.keys(set).length && !changes.length && !unset.length) return null
  return draftOf(c.state, STAGE_ACTION, 'stage', lines.join('') || '記下這一趟的進度。', [...changes, runPatch({ set, ...(unset.length ? { unset } : {}) })], { lines })
}

/** 掛點 report.after：結算完了發 curtain.result；往下一幕之後進化妝室；場熱跨過門檻的事。 */
export function afterReport(k: Kernel, state: GameState, report: Report): ReportDraft[] | undefined {
  if (report.rewind || report.action === 'rewind') return undefined
  const cur = readCurtain(state)
  const run = cur.run
  // 加演的邀請：離開簾口、或過了這一晚就收回（使用者 2026-11-26 裁決 4）
  if (!run && cur.encore && encoreStale(k, state, cur.encore)) return [encoreVoidDraft(state)]
  // 補演剛結束：發 curtain.replay（只發一次）
  if (!run && cur.fall?.replayed && !cur.fall.replayed.reported && !k.activity.active(state).some((a) => a.kind === 'scene')) {
    const d = replayReport(state)
    return d ? [d] : undefined
  }
  if (!run) return undefined
  if (run.over) return [resultDraft(state, run)]
  // 潛入（dive）是簾口放在潛入裡的網內街區時一趟的外框，不算打斷（B030、B031）；netrun 是這一趟自己
  const busy = k.activity.active(state).filter((a) => a.kind !== 'netrun' && a.kind !== 'dive')
  // 全隊倒下、戰敗也被接受了（netrun 收掉這一趟之後；潛入的外框還在不算）：落幕
  if (run.lost && !state.battle && k.activity.active(state).every((a) => a.kind === 'dive')) return [fallDraft(k, state, run)]
  // 戰鬥、場景、戰敗的選擇進行中不插報告（戰鬥結束與場景結束那一份套用之後才問）
  if (state.battle || busy.length) return undefined
  const c = ctxOf(k, state)
  if (!c) return undefined
  const out: ReportDraft[] = []
  if (report.action === 'netrun.descend') out.push(restDraft(c))
  const stage = stageDraft(c)
  if (stage) out.push(stage)
  return out.length ? out : undefined
}
