// L6 功能：委託副本本體（COMMISSIONS 2.3、第 3～6 節、第 11 節；SERIES 第 6 節；SITES 12.5 節；UI 7.4 節；dev/adr/0016；dev/work/M2-commission-run.md）。
//
// 一種活動 commission（order 90）：拿到一件具體的副本就能進去。每個階段選面、選分支、玩那一段（M2 只有現實面：探索加遭遇）、拿里程碑與連動；
// 警戒整趟累計；階段之間可以喘一口氣；撤退回到進去之前；最後一個階段做完發 activity.end 交回。進行中是封閉的：只放行副本裡的事（白名單）。
//
// 接上核心的地方：
//   內容  commission（一件具體的副本）、commission_rule（id: default，規則的數字）
//   活動  commission（setup: { def: id 或整筆, scouted?, alert_start?, aux?, terms? }；activity.end 的 result 見 run.ts 的 resultOf）
//   報告  commission.enter、.face（第一筆是 stage 快照）、.branch、.milestone、.breathe、.retreat（帶 rewind: entry）、.finish，
//         另有 .check（動手的檢定）、.scene（開場景）、.replay（地圖離開了再進去）
//   掛鉤  report.after（目標達成就接里程碑、做完接 finish、開了地圖問 map.arrive）、activity.end（戰鬥打贏、場景與別的面做完，記進目標的進度）
//   掛點  map.arrive（這個功能宣告、探索回答：剛進圖入口那一格有沒有被看到）；rest.done（kind: stage，喘口氣時發）
//   別的面  有人登記活動 face.net、face.opinion（M3、M5）才選得了；沒有的面列出來但選不了
// 對外：commissionView、chooseFace、chooseBranch、breathe、retreat、checkGoal、playScene、replay、milestone、finish。
// 輔助面每個階段的結算（M2-commission-aux）與做完之後的結算（M2-commission-close）聽 activity.end 與 commission.face，不在這裡。

import type { Feature, Kernel, ReportDraft } from '../../core'
import { ContentError } from '../../core'
import type { CommissionEntry, Run } from './model'
import { ACTIVITY, FACE_ACTIVITY, KIND, OWNER, RULE_KIND, commissionMapProblems, commissionProblems, readRun, ruleProblems, runChange } from './model'
import { achieved, enterDraft, finish, milestone } from './run'

export {
  ACTIVITY, BRANCH_KINDS, DEFAULT_COMMISSION_RULES, EXT, FACES, FACE_ACTIVITY, FACE_NAME, GOAL_KINDS, KIND, LINK_TYPES, OWNER, RULE_KIND, SCALE_STAGES,
  commissionMapProblems, commissionProblems, commissionRules, dcBaseOf, effectsFor, encounterAfter, gradeOf, readRun, stageName,
} from './model'
export type {
  BranchDef, BranchKind, CommissionEntry, CommissionRules, Face, FaceDef, GoalDef, LinkDef, LinkEffect, Need, Rank, RouteEntry, Run, RunLink, RunSetup, StageDef, StageEffects, Step,
} from './model'
export { achieved, branchViews, breathe, breatheBlock, checkGoal, chooseBranch, chooseFace, enterDraft, faceViews, finish, goalView, milestone, playScene, replay, retreat } from './run'
export type { BranchView, FaceView, GoalView } from './run'
export { REINFORCE_MARK, commissionView, stageEffects } from './view'
export type { CommissionView, LinkRow, TrackNode } from './view'

/** 進行中放行的 doing 前綴（工單 M2-commission-run 的驗收條件）。探索的 grid.、commit:grid. 由探索自己再登記一次（沒裝探索也一樣放行）。 */
export const COMMISSION_ALLOW: readonly string[] = [
  'commit:commission.', 'grid.', 'commit:grid.', 'battle.', 'commit:battle.', 'chain:battle_end', 'battle.retry',
  'event.start', 'commit:event.', 'scene.start', 'commit:scene.', 'commit:defeat.', 'commit:capture.', 'commit:gear.', 'chain:free_action', 'rewind:stage', 'rewind:entry',
]

const FACE_KINDS: readonly string[] = Object.values(FACE_ACTIVITY)

/** 這一件活動 end 是不是這個副本這一段發起的。 */
function mineOf(run: Run, origin: { ext?: Record<string, unknown> }): boolean {
  const ext = origin.ext
  // 看 ext 的 commission 與 stage（而不是 by）：探索進圖時開的戰鬥是 launch 出來的，by 會被換成 core，ext 的鍵還在
  return !!ext && ext.commission === run.def.id && ext.stage === run.stage
}

export const commissionFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind<CommissionEntry>({
      kind: KIND, owner: OWNER,
      validate: commissionProblems,
      refs: (e) => [
        ...(typeof e.target_faction === 'string' && e.target_faction !== 'none' ? [['faction', e.target_faction] as [string, string]] : []),
        ...(typeof e.employer === 'string' ? [['faction', e.employer] as [string, string]] : []),
        ...(Array.isArray(e.stages) ? e.stages.flatMap((s) => (typeof s?.faces?.meat?.map === 'string' ? [['special_map', s.faces.meat.map] as [string, string]] : [])) : []),
      ],
    })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })

    k.activity.define({
      kind: ACTIVITY, owner: OWNER, order: 90,
      active: (state) => {
        const run = readRun(state)
        return run ? { id: run.def.id, label: `委託副本：${run.def.name ?? run.def.id}` } : null
      },
      allow: [...COMMISSION_ALLOW],
      reason: (state) => {
        const run = readRun(state)
        return `${run?.def.name ? `「${run.def.name}」` : '委託的副本'}進行中，只能做副本裡的事（探索、戰鬥、副本裡的事件）；要離開只有做完、撤退或全員倒下。`
      },
      start: (k2, state, setup, origin) => enterDraft(k2 as Kernel, state, setup, origin),
    })

    // 目標的進度：這一段發起的戰鬥打贏了、場景做完了、別的面做完了
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, outcome, result }) => {
      const run = readRun(state)
      if (!run || run.step !== 'play' || !mineOf(run, origin)) return
      if (kind === 'battle') {
        if (outcome !== 'win' || run.face !== 'meat' || run.won) return
        return { changes: [runChange({ ...run, won: true })] }
      }
      if (kind === 'scene') {
        const ok = result.goal_done === true
        return { changes: [runChange({ ...run, scene: ok ? 'done' : 'failed' })], lines: [ok ? '這一場達成了目的。' : '這一場沒有達成目的。'] }
      }
      if (FACE_KINDS.includes(kind)) {
        const ok = outcome === 'done' || outcome === 'win'
        return { changes: [runChange({ ...run, done: ok })], lines: [ok ? '這一段完成了。' : '這一段沒有完成，可以再來一次。'] }
      }
    })

    // 一份報告套用之後：開了地圖（問有沒有被看到）、目標達成（接里程碑）、最後一個階段做完（接 finish）
    k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
      if (report.rewind) return
      const run = readRun(state)
      if (!run) return
      if (report.action === 'commission.branch' || report.action === 'commission.replay') {
        if (run.step !== 'play' || !run.map || !state.maps.instances[run.map]) return
        const out = k.hooks.run('map.arrive', { state, map: run.map }).map((h) => h.result)
        return out.length > 0 ? out : undefined
      }
      if (run.step === 'done') return report.action === 'commission.finish' ? undefined : [finish(k, state)]
      if (state.battle || run.step !== 'play') return
      return achieved(k, state, run) ? [milestone(k, state)] : undefined
    })
  },

  ready(k: Kernel) {
    const problems: string[] = []
    for (const def of k.content.list<CommissionEntry>(KIND)) {
      for (const p of commissionMapProblems(k, def)) problems.push(`${KIND}/${def.id}：${p}`)
      if (k.content.hasKind('district') && !k.content.has('district', def.district)) problems.push(`${KIND}/${def.id}：district ${def.district} 查不到`)
      if (def.defeat_event !== undefined && k.content.hasKind('defeat_event') && !k.content.has('defeat_event', def.defeat_event)) problems.push(`${KIND}/${def.id}：defeat_event ${def.defeat_event} 查不到`)
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
