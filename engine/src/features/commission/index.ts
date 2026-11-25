// L6 功能：委託副本本體（COMMISSIONS 2.3、第 3～6 節、第 11 節；SERIES 第 6 節；SITES 12.5 節；UI 7.4 節；dev/adr/0016；dev/work/M2-commission-run.md）。
//
// 一種活動 commission（order 90）：拿到一件具體的副本就能進去。每個階段選面、選分支、玩那一段（M2 只有現實面：探索加遭遇）、拿里程碑與連動；
// 警戒整趟累計；階段之間可以喘一口氣；撤退回到進去之前；最後一個階段做完發 activity.end 交回。進行中是封閉的：只放行副本裡的事（白名單）。
//
// 接上核心的地方：
//   內容  commission（一件具體的副本）、commission_rule（id: default，規則的數字）
//   活動  commission（setup: { def: id 或整筆, scouted?, alert_start?, aux?, terms? }；activity.end 的 result 見 run.ts 的 resultOf）
//   報告  commission.enter、.face（第一筆是 stage 快照）、.branch、.milestone、.breathe、.retreat（帶 rewind: entry）、.finish，
//         另有 .check（動手的檢定）、.scene（開場景）、.replay（地圖離開了再進去）、.pressure（警戒漲過門檻，帶 pressure 觸發點給導演）
//   掛鉤  report.after（目標達成就接里程碑、做完接 finish、開了地圖問 map.arrive）、activity.end（戰鬥打贏、場景與別的面做完，記進目標的進度）
//   掛點  map.arrive（這個功能宣告、探索回答：剛進圖入口那一格有沒有被看到）；rest.done（kind: stage，喘口氣時發）
//   別的面  有人登記活動 face.net、face.opinion（M3、M5）才選得了；沒有的面列出來但選不了
//   內海面（M3-commission-net）：face.net 交回 done（Run.trace、net_peak 記下來；第一次到過 60 警戒 +10；寫了 controls 而沒有接管就不給 gives）、
//     retreat（和 retreat 一樣：發 commission 的 retreat 再回到進去之前）、located（照戰敗被接受而且算失敗：留記號、回到進去之前，被定位另外加敵對值）；
//     隔離區（locked_by）、連動多六種（trace_start、trace_half、lace_down、gate_open、near_core、controls）、commissionView().trace
// 對外：commissionView、chooseFace、chooseBranch、breathe、retreat、checkGoal、playScene、replay、milestone、finish。
// 輔助面每個階段的結算（aux.ts，M2-commission-aux）寫在 commission.face 那一份報告裡（每個擲了的面一拍，標籤 aux）；
// 做完之後的結算（M2-commission-close）聽 activity.end（result.aux_log 有每一次輔助結算）。
// 做完與做不完的結算（close.ts，M2-commission-close）：finish 算評價、路線的後果（目標勢力的敵對值）、歷練點，交給 activity.end（outcome done；result 多 rating、xp、hostility）；
//   聽戰敗被接受（activity.end kind defeat，那一場是這件委託的）：fails_commission 是 true → 留失敗的記號（state.ext.commission_failed）並回到入口（rewind entry），
//   回去之後那份 rewind 報告套用之後接一份 commission.failed 發 activity.end（outcome failed）；是 false → 不回退，留在這個階段、回到選分支之前。
// 輔助面（aux.ts）：setup.aux 是 { meat?, net?, opinion?, borrowed? }；規則 commission_rule 多 aux_skills、aux_bonus、aux_pressure、aux_rest、aux_injured_days；
//   對外 auxChance（還沒進副本也能問成功率）、commissionView().aux。

import type { Feature, Kernel, ReportDraft } from '../../core'
import { ContentError } from '../../core'
import type { CommissionEntry } from './model'
import { ACTIVITY, FACE_ACTIVITY, KIND, OWNER, RULE_KIND, commissionMapProblems, commissionProblems, readRun, ruleProblems, runChange } from './model'
import { failedDraft, keepFailed, mineOf, netEnd, onDefeatAccepted } from './close'
import { achieved, enterDraft, finish, milestone, pressureDraft } from './run'

export {
  ACTIVITY, BRANCH_KINDS, DEFAULT_COMMISSION_RULES, DEFAULT_NET_RULES, EXT, FACES, FAILED_EXT, FACE_ACTIVITY, FACE_NAME, GOAL_KINDS, KIND, LINK_TYPES, NET_LACES, NET_LAYERS, NET_OBJECTIVES, OWNER, RULE_KIND, SCALE_STAGES, TRACE_MIN,
  commissionMapProblems, commissionProblems, commissionRules, dcBaseOf, effectsFor, encounterAfter, gradeOf, netFx, netRules, readRun, ruleProblems, stageName,
} from './model'
export type {
  AuxOutcome, AuxResult, AuxState, BranchDef, BranchKind, CommissionEntry, CommissionRules, NetRules, Face, FaceDef, GoalDef, LinkDef, LinkEffect, Need, Rank, RouteEntry, Run, RunLink, RunSetup, StageDef, StageEffects, Step,
} from './model'
export { RATINGS, XP_EFFECT, HOSTILITY_EFFECT, RETREAT_REWIND, failedOf, fallout, forecast, netEnd, rate, retreatEnd, xpFor } from './close'
export type { CloseForecast, FailedMark, Fallout, Rating, RatingParts } from './close'
export { AIRGAP_TEXT, achieved, branchViews, breathe, breatheBlock, checkGoal, chooseBranch, chooseFace, enterDraft, faceViews, finish, goalView, milestone, playScene, replay, retreat } from './run'
export type { BranchView, FaceView, GoalView } from './run'
export { REINFORCE_MARK, TRACE_MARKS, commissionView, stageEffects } from './view'
export type { AuxFaceView, CommissionView, LinkRow, TrackNode } from './view'
export { auxChance, auxPeople, auxSum, classify as classifyAux, pathBonus, settleAux } from './aux'
export type { AuxChance, AuxPeople, AuxSettlement, AuxSum } from './aux'

/**
 * 進行中放行的 doing 前綴（工單 M2-commission-run 的驗收條件）。探索的 grid.、commit:grid. 由探索自己再登記一次（沒裝探索也一樣放行）。
 * 不放行 rewind:stage、rewind:entry（dev/adr/0017 M2 修正批 2）：回到階段開始只在戰敗的三選一裡（Game.rewindToStage，等著選的戰敗才成立）；
 * 回到入口只走 commission.retreat 這份報告（帶 rewind，退出請來的人與付出去的錢）；兩個都不是「隨時可用」的回退。
 */
export const COMMISSION_ALLOW: readonly string[] = [
  'commit:commission.', 'grid.', 'commit:grid.', 'battle.', 'commit:battle.', 'chain:battle_end', 'battle.retry',
  'event.start', 'commit:event.', 'scene.start', 'commit:scene.', 'commit:defeat.', 'commit:capture.', 'commit:gear.', 'chain:free_action',
  // 副本進行中、戰鬥外可以吃藥與急救（M4-followups：drugs 的 drug.、medical 的 medical.）
  'commit:drug.', 'commit:medical.',
]

const FACE_KINDS: readonly string[] = Object.values(FACE_ACTIVITY)

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
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

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
      // 戰敗被接受（M2-commission-close）：算失敗就留記號、回到進去之前；不算失敗就留在這個階段、回到選分支之前
      if (kind === 'defeat' && outcome === 'accept') return onDefeatAccepted(k, state, origin, result)
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
      if (kind === FACE_ACTIVITY.net) return netEnd(k, state, run, outcome, result)
      if (FACE_KINDS.includes(kind)) {
        const ok = outcome === 'done' || outcome === 'win'
        return { changes: [runChange({ ...run, done: ok })], lines: [ok ? '這一段完成了。' : '這一段沒有完成，可以再來一次。'] }
      }
    })

    // 回到快照：還沒發的失敗記號帶到回去之後的狀態（紀錄由核心留；其餘的都回去）
    k.hooks.on('rewind.keep', OWNER, ({ current }) => keepFailed(current))

    // 一份報告套用之後：開了地圖（問有沒有被看到）、目標達成（接里程碑）、最後一個階段做完（接 finish）
    k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
      if (report.rewind) return
      // 回去之後的那一份報告（action rewind）：有還沒發的失敗記號，接著提交 commission.failed，在那一份裡發 activity.end（outcome failed）
      if (report.action === 'rewind') {
        const failed = failedDraft(k, state)
        return failed ? [failed] : undefined
      }
      const run = readRun(state)
      if (!run) return
      if (report.action === 'commission.branch' || report.action === 'commission.replay') {
        if (run.step !== 'play' || !run.map || !state.maps.instances[run.map]) return
        const out = k.hooks.run('map.arrive', { state, map: run.map }).map((h) => h.result)
        return out.length > 0 ? out : undefined
      }
      if (run.step === 'done') return report.action === 'commission.finish' ? undefined : [finish(k, state)]
      if (state.battle || run.step !== 'play') return
      // 警戒漲過門檻：接一份帶 pressure 觸發點的報告，導演多擲一次副本內事件（EVENTS 3.1 節）。
      // 先問它，再問目標有沒有達成：讓目標達成的那一份報告（打贏的那一場、走到撤離點那一步被監視器拍到）同時讓警戒跨過門檻時，
      // 這一擲不能被里程碑吃掉（W014）。只回 pressure 這一份：它自己提交之後 report.after 會再看到目標達成，那時接 milestone；
      // 一起回兩份的話，pressure 底下的那一輪已經接過 milestone，後面那一份會再結算一次同一個階段
      const pressure = pressureDraft(k, state, run)
      if (pressure) return [pressure]
      if (achieved(k, state, run)) return [milestone(k, state)]
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
