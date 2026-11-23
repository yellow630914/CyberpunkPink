// L6 功能 commission 給畫面的一份快照：階段軌、每個面開不開與原因、每條分支與原因、拿到的連動、警戒、能不能喘口氣與撤退（UI 7.4 節）。
// 純函式、唯讀。

import type { GameState, Kernel } from '../../core'
import { meterOf } from '../../core'
import type { Face, LinkEffect, RouteEntry, Step } from './model'
import { commissionRules, effectsFor, gradeOf, readRun, stageName, stagesOf } from './model'
import type { BranchView, FaceView, GoalView } from './run'
import { branchViews, breatheBlock, faceViews, goalView } from './run'

/** 警戒到這麼多增援加進下一場遭遇（COMMISSIONS 2.3 節；畫面的刻度）。 */
export const REINFORCE_MARK = 60

export interface TrackNode {
  index: number
  name: string
  state: 'done' | 'current' | 'ahead'
  /** 揭開了嗎：做完的、現在的、最後一個（主面）、踩點揭開的；其餘畫面寫「？」 */
  known: boolean
  decisive: boolean
  /** 揭開時：這個階段可選的面 */
  faces?: Face[]
  /** 做完或進行中的階段：選了什麼 */
  chose?: { face: Face; branch?: string }
}

export interface LinkRow {
  id: string
  name: string
  type: string
  /** 在第幾階段、哪一面拿到的 */
  from: number
  face: Face
  /** 對第幾階段生效 */
  stage: number
  effect: LinkEffect
  /** 已經用在哪個階段了（生效的那個階段已經開始） */
  used: boolean
}

export interface CommissionView {
  id: string
  name: string
  kind: string
  main: Face
  scale: string
  grade: number
  target_faction: string
  district: string
  conditions: string[]
  stages: number
  /** 現在第幾階段（1 起算）；全部做完的那一刻是階段數 + 1 */
  stage: number
  stageName: string
  step: Step
  /** 這一段開始以來城裡過了多久不在這裡算；每個階段 120 分鐘 */
  stageMinutes: number
  track: TrackNode[]
  /** 現在這個階段的三個面（沒有開的也列出來） */
  faces: FaceView[]
  /** 玩家選好的那一面的分支（沒選面時是空的） */
  branches: BranchView[]
  /** 這一段的目標與做到哪（開始玩這一段之後才有） */
  goal?: GoalView
  links: LinkRow[]
  route: RouteEntry[]
  alert: { value: number; reinforce: number; hard: number; peak: number }
  breathe: { can: boolean; reason: string | null }
  retreat: { can: boolean; reason: string | null }
}

/** 現在這件副本的樣子；沒有在副本裡回傳 null。 */
export function commissionView(k: Kernel, state: GameState): CommissionView | null {
  const run = readRun(state)
  if (!run) return null
  const rules = commissionRules(k)
  const total = stagesOf(run)
  const done = run.step === 'done'
  const stage = run.stage
  const track: TrackNode[] = run.def.stages.map((s, i): TrackNode => {
    const n = i + 1
    const st = n < stage || done ? 'done' : n === stage ? 'current' : 'ahead'
    const scouted = (run.setup.scouted?.stages ?? []).includes(n)
    const known = st !== 'ahead' || n === total || scouted
    const route = run.route.find((r) => r.stage === n)
    return {
      index: n, name: stageName(run.def, n), state: st, known, decisive: n === total,
      ...(known ? { faces: Object.keys(s.faces) as Face[] } : {}),
      ...(route ? { chose: { face: route.face, branch: route.branch } } : n === stage && run.face ? { chose: { face: run.face } } : {}),
    }
  })
  const alertNow = run.step === 'play' && run.face === 'meat' && run.map && state.maps.instances[run.map] ? meterOf(k, state, 'alert', run.map) : run.alert
  const links: LinkRow[] = run.links.map((l) => {
    const def = run.def.links[l.id]
    const target = def?.effect?.stage ?? l.from + 1
    return { id: l.id, name: def?.name ?? l.id, type: def?.type ?? 'open', from: l.from, face: l.face, stage: target, effect: def?.effect ? { ...def.effect } : {}, used: target < stage || (target === stage && run.step !== 'face' && !done) }
  })
  const breatheWhy = breatheBlock(state, run) ?? k.activity.blockOf(state, 'commit:commission.breathe')
  const retreatWhy = k.activity.blockOf(state, 'commit:commission.retreat')
  const play = run.step === 'play'
  return {
    id: run.def.id, name: run.def.name ?? run.def.id, kind: run.def.kind, main: run.def.main, scale: run.def.scale, grade: gradeOf(run.def.grade) ?? 1,
    target_faction: run.def.target_faction, district: run.def.district, conditions: run.def.conditions ? [...run.def.conditions] : [],
    stages: total, stage, stageName: done ? '全部做完了' : stageName(run.def, stage), step: run.step, stageMinutes: rules.stage_minutes,
    track,
    faces: done ? [] : faceViews(k, run),
    branches: run.step === 'branch' || play ? branchViews(k, state, run) : [],
    ...(play ? { goal: goalView(k, state, run) } : {}),
    links, route: run.route.map((r) => ({ ...r })),
    alert: { value: alertNow, reinforce: REINFORCE_MARK, hard: rules.hard_alert, peak: Math.max(run.peak, alertNow) },
    breathe: { can: breatheWhy === null, reason: breatheWhy },
    retreat: { can: retreatWhy === null, reason: retreatWhy },
  }
}

/** 現在這個階段有哪些連動會生效（畫面的「這一段會有什麼不一樣」）；不在副本裡是空的。 */
export function stageEffects(state: GameState): ReturnType<typeof effectsFor> | null {
  const run = readRun(state)
  return run ? effectsFor(run, run.stage) : null
}
