// L7 外殼：成人場景的兩條任務鏈（AI_TASKS 3.5～3.8 節；dev/work/M4-core-scene-ai.md；dev/adr/0019 第十三節）。
//
// adult_action（3.5 節）：可能進成人場景的行動（誘惑、性交易、蜜罐的那一步）。
//   擲骰 → 判定 → 結算上限（參考範圍）→ scene_gate →（進）建立場景設定，報告帶 launch 把場景交給畫面 /（不進）算回報、算關係、寫正文 → 套用
//   玩家在 scene_gate 之後、場景還沒有任何行動時，可以選略過（Game.sceneFinish({ how: 'skip' })，走功能的 sceneSkip）。
//
// scene_round（3.6、3.7、3.8 節）：場景的一步。玩家的行動（或輪到對方、或停下、略過、被打斷）已經由畫面交進來。
//   scene_talk（玩家說話時）→ 同圈每個由程式控制的人依序各一次 scene_turn（用了說話再各一次 scene_talk）→ 把結果放進 SceneEnv 呼叫 sceneAct／sceneNext → 套用。別的圈不跑 AI。
//   這一步讓場景結束時，接著是收尾段：reward（有目的或交易）、sex_record、sink、tendency、relate 五個彼此不依賴、同時跑 → 把驗過的結果放進 SceneEnv.closing 再算一次結束 → 寫正文（成人路由）→ 套用。
//   沒有結束的那一步沒有收尾段、沒有正文（那幾步是 skipped）。
//
// 套用之前什麼都不寫進存檔：每一步的結果只放在這條鏈的草稿。草稿裡只放小的東西（AI 的結果、結算的摘要），
// 報告草稿本身由 apply 照功能的純函式重算一次（同一個種子、同一份狀態、同樣的 env，結果一定一樣）。

import type { ClampNote, GameState, Kernel, ReportDraft } from '../../core'
import type { ActionInput } from '../../core/action/kinds'
import type { ActionPending, Judgment } from '../../core/action/action'
import { actionTailChanges, buildActionReport, rewardByRules } from '../../core/action/action'
import { DEGREE_NAME } from '../../core/rules/check'
import { effectCtx as makeEffectCtx } from '../../core/rules/grades'
import type { ResolvedEffects } from '../../core/rules/effects'
import { contentAllowed, meterOf } from '../../core'
import type { Closing, Goal, Nature, SceneEnv, SceneInput, SceneRaw, SceneSetup, TalkEnv } from '../../features/scene'
import {
  GOALS, GOAL_NAME, NATURE_FILTER, NATURE_NAME, NOTE_LEN, knownPositions, knownSkills, sceneAct, sceneDefOf, sceneInterrupt, sceneNext, sceneRawOf, sceneSkip, startProblems, tendencyTagIds,
} from '../../features/scene'
import { narrateInputOf } from '../narrated'
import type { ChainCtx, ChainDef, ChainTemplate, StepTemplate } from './chain'
import type { JudgeOutput, NarrateOutput } from './freeAction'
import { castOf, freeActionChain, relateEnabled } from './freeAction'
import type { NpcPlan, Settled } from './sceneBrief'
import { afterNpcs, briefOf, digestOf, earlierLines, legalMoves, npcOrder, playOf, recentOf, settledOf, sinkInputOf, tendencyInputOf, turnPlayOf } from './sceneBrief'
import type { GateFixed, GateInput, GateOutput, SceneRelateInput, SceneRewardInput, SexRecordInput, SexRecordOutput, SinkOutput, TalkInput, TalkOutput, TendencyOutput, TurnInput, TurnOutput } from './sceneTasks'
import { GATE_NATURES, TALK_FIT, TALK_GOAL, talkEnvOf } from './sceneTasks'
import { sceneAiOf } from './settings'

export const ADULT_ACTION_CHAIN = 'adult_action'
export const SCENE_ROUND_CHAIN = 'scene_round'

/** 玩家寫的寫法指令最多幾字（LEWD_SYSTEM 3.1 節、COMBAT_SYSTEM 8.3 節）。 */
export const DIRECTION_MAX = 200


// ======================================================================
// adult_action：可能進成人場景的行動
// ======================================================================

/**
 * 這條鏈的輸入：玩家的行動，加上引擎判斷「可能進場景」時要給 scene_gate 的東西。
 * 沒有 with 的時候對方是 action.target；兩個都沒有就不問 scene_gate（沒有人可以進場景）。
 */
export interface AdultActionInput {
  action: ActionInput
  /** 在場的人（多人時每一個）；沒寫是 action.target */
  with?: string[]
  /** 行動或事件明寫的場景設定（性交易、場所的工作、寫好的事件）：AI 關著、交不出合格的結果時照它進 */
  scene?: GateFixed
  /** 情境本來就是被迫的（戰敗、契約的抗拒失敗、事件寫明的）：scene_gate 才可以選「被迫」 */
  forced?: boolean
  /** 引擎判斷「這一次不可能」（對方不在、親密度太低……）：不問 scene_gate，直接當作不進 */
  maybe?: boolean
  place?: string
}

export const ADULT_ACTION_TEMPLATE: ChainTemplate = {
  chain: ADULT_ACTION_CHAIN,
  steps: [
    { id: 'roll', kind: 'code', run: 'roll_check' },
    { id: 'judge', kind: 'ai', task: 'judge', needs: ['roll'] },
    { id: 'hint', kind: 'code', run: 'reward_hint', needs: ['judge'] },
    { id: 'gate', kind: 'ai', task: 'scene_gate', needs: ['judge', 'hint'], when: 'gate_possible' },
    { id: 'setup', kind: 'code', run: 'scene_setup', needs: ['gate'] },
    { id: 'reward', kind: 'ai', task: 'reward', needs: ['judge', 'hint', 'setup'], when: 'stays_out' },
    { id: 'relate', kind: 'ai', task: 'relate', needs: ['judge', 'setup'], when: 'stays_out_cast' },
    { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge', 'hint', 'setup', 'reward', 'relate'], mode: 'new', when: 'stays_out' },
    { id: 'apply', kind: 'apply' },
  ],
}

/** setup 那一步的結果：進不進、進的話場景的設定。 */
export interface SceneSetupResult {
  enter: boolean
  setup?: SceneSetup
  reason: string
  /** 想進而進不了的原因（startProblems 的句子） */
  blocked?: string[]
}

const asFree = (ctx: ChainCtx): ChainCtx => ({ ...ctx, input: (ctx.input as AdultActionInput).action })

function castIds(ctx: ChainCtx): string[] {
  const inp = ctx.input as AdultActionInput
  return (inp.with ?? (inp.action.target ? [inp.action.target] : [])).filter((id) => !!ctx.state.actors[id] && id !== ctx.state.pc)
}

function gateInputOf(ctx: ChainCtx): GateInput {
  const inp = ctx.input as AdultActionInput
  const free = ctx.draft.roll as ActionPending
  const { judgment } = ctx.draft.judge as JudgeOutput
  const def = ctx.k.actions.get(free.input.kind)
  const state = ctx.state
  return {
    pc: { id: state.pc!, name: state.actors[state.pc!]!.name },
    cast: castIds(ctx).map((id) => ({
      id, name: state.actors[id]!.name, affinity: meterOf(ctx.k, state, 'affinity', id),
      tags: tendencyTagIds(state.actors[id]).filter((t) => contentAllowed(state.rules, t)).map((t) => (ctx.k.content.get('tendency_tag', t)?.name as string | undefined) ?? t),
    })),
    trigger: { action: def?.name ?? free.input.kind, degree: DEGREE_NAME[judgment.degree], summary: [judgment.reason, judgment.twist].filter(Boolean).join(' ') || free.input.text || '', ...((inp.place ?? inp.scene?.place) ? { place: inp.place ?? inp.scene?.place } : {}) },
    // 清單已經依內容篩選刪過：被關掉的性質根本不在裡面
    natures: GATE_NATURES.filter((n) => { const f = NATURE_FILTER[n]; return !f || contentAllowed(state.rules, f.tag) }).map((n) => ({ id: n, name: NATURE_NAME[n] })),
    goals: GOALS.map((g) => ({ id: g, name: GOAL_NAME[g] })),
    forced: inp.forced === true,
    ...(inp.scene ? { fixed: inp.scene } : {}),
  }
}

/** 場景的設定：scene_gate（或明寫的設定）給的性質與目的，加上行動帶的對象、身分、地點。 */
function setupOf(ctx: ChainCtx, gate: GateOutput): SceneSetup {
  const inp = ctx.input as AdultActionInput
  const fixed = inp.scene
  const nature = gate.nature as Nature
  const same = fixed?.nature === nature
  const goal: Goal | undefined = gate.goal ?? (same ? fixed?.goal : undefined)
  const circles = gate.circles ?? fixed?.circles
  const place = inp.place ?? fixed?.place
  return {
    nature,
    ...(circles ? { circles } : { with: fixed?.with ?? castIds(ctx) }),
    ...(goal ? { goal } : {}),
    ...(same && fixed?.role ? { role: fixed.role } : {}),
    ...(place ? { place } : {}),
    ...(fixed?.tags ? { tags: fixed.tags } : {}),
  }
}

export function adultActionChain(): ChainDef {
  const free = freeActionChain()
  const emptyReward = (k: Kernel, state: GameState, pending: ActionPending, judgment: Judgment): ResolvedEffects =>
    k.effects.resolve([], makeEffectCtx(k, state, { source: 'builtin', actor: pending.actor, grade: pending.grade, action: { minutes: judgment.minutes, maxMinutes: pending.maxMinutes }, tail: actionTailChanges(judgment) }), 'reward.items')
  return {
    template: ADULT_ACTION_TEMPLATE,
    code: 'adult',
    hasText: true,
    rerollable: ['roll'],
    codeSteps: {
      roll_check: (ctx, step) => free.codeSteps.roll_check!(asFree(ctx), step),
      reward_hint: (ctx, step) => free.codeSteps.reward_hint!(asFree(ctx), step),
      scene_setup: (ctx): SceneSetupResult => {
        const gate = ctx.draft.gate as GateOutput | undefined
        if (!gate || !gate.enter || !gate.nature) return { enter: false, reason: gate?.reason ?? '' }
        const setup = setupOf(ctx, gate)
        const r = startProblems(ctx.k, ctx.state, setup)
        if (r.problems.length > 0) return { enter: false, reason: gate.reason, blocked: r.problems }
        return { enter: true, setup, reason: gate.reason }
      },
    },
    whens: {
      // 引擎判斷「可能」：判定成功（是，而且／是）、有對象、引擎沒有說不可能；內容篩選把性質全關掉（連兩情相悅都沒有）也不問
      gate_possible: (ctx) => {
        const inp = ctx.input as AdultActionInput
        const degree = (ctx.draft.judge as JudgeOutput | undefined)?.judgment.degree
        return inp.maybe !== false && (degree === 'success' || degree === 'critical') && castIds(ctx).length > 0
      },
      stays_out: (ctx) => (ctx.draft.setup as SceneSetupResult | undefined)?.enter !== true,
      stays_out_cast: (ctx) => (ctx.draft.setup as SceneSetupResult | undefined)?.enter !== true && ctx.k.features.includes('npcs') && castOf(ctx.state).length > 0,
    },
    aiEnabled: (step, ctx) => {
      switch (step.task) {
        case 'scene_gate': return sceneAiOf(ctx.settings) !== 'off'
        case 'judge': return ctx.settings.judge_free
        case 'narrate': return ctx.settings.narrate
        case 'reward': return !rewardByRules(ctx.k, (ctx.draft.roll as ActionPending).input.kind)
        case 'relate': return relateEnabled
        default: return true
      }
    },
    // 進不進場景：失敗（含被服務商拒絕）走退路（照明寫的設定進、沒有就不進），不停下來等玩家
    softFail: (step) => step.task === 'scene_gate',
    aiInput: (step, ctx) => (step.task === 'scene_gate' ? gateInputOf(ctx) : free.aiInput(step, asFree(ctx))),
    apply: (ctx) => {
      const setup = ctx.draft.setup as SceneSetupResult
      if (!setup.enter) return free.apply(asFree(ctx))
      // 進場景：這一次行動自己的結算（時間、判定的轉折）先套，場景由報告帶的 launch 在同一次提交裡開起來；報酬在場景結束的收尾段才算
      const pending = ctx.draft.roll as ActionPending
      const judged = ctx.draft.judge as JudgeOutput
      const d = buildActionReport(ctx.k, ctx.state, { pending, judgment: judged.judgment, reward: emptyReward(ctx.k, ctx.state, pending, judged.judgment), judgeClamps: judged.clamps })
      return { ...d, launch: [{ kind: 'scene', setup: setup.setup, origin: { by: ADULT_ACTION_CHAIN, ref: ctx.chainId } }] }
    },
  }
}

// ======================================================================
// scene_round：場景的一步，結束時接收尾段
// ======================================================================

/** 場景這一步的種類：玩家的行動（pc）、對方的一步（npc）、玩家按停下、略過、被外面打斷。 */
export type SceneRoundMode = 'pc' | 'npc' | 'stop' | 'skip' | 'interrupt'

export interface SceneRoundInput {
  mode: SceneRoundMode
  /** mode 是 pc：玩家的行動 */
  input?: SceneInput
  /** 玩家寫的寫法指令（略過的場景；已經截到 200 字）：寫正文照它寫，算性經歷與算傾向把它當參考；不改任何數字 */
  direction?: string
}

/** 同圈最多三個由程式控制的人（一圈最多四人，扣掉主角）：每個人一組 scene_turn 與 scene_talk 的步驟。 */
const NPC_SLOTS = 3

const turnSteps = (): StepTemplate[] => {
  const out: StepTemplate[] = []
  for (let i = 1; i <= NPC_SLOTS; i++) {
    out.push({ id: `t${i}`, kind: 'ai', task: 'scene_turn', ...(i > 1 ? { needs: [`k${i - 1}`] } : {}), when: `npc_turn_${i}` })
    out.push({ id: `k${i}`, kind: 'ai', task: 'scene_talk', needs: [`t${i}`], when: `npc_talk_${i}` })
  }
  return out
}

export const SCENE_ROUND_TEMPLATE: ChainTemplate = {
  chain: SCENE_ROUND_CHAIN,
  steps: [
    { id: 'talk', kind: 'ai', task: 'scene_talk', when: 'pc_talk' },
    { id: 'pc', kind: 'code', run: 'pc_step', needs: ['talk'], when: 'is_pc' },
    ...turnSteps(),
    { id: 'npc', kind: 'code', run: 'npc_step', needs: ['t1', 'k1', 't2', 'k2', 't3', 'k3'], when: 'is_npc' },
    { id: 'fin', kind: 'code', run: 'finish_step', when: 'is_finish' },
    { id: 'settle', kind: 'code', run: 'settle', needs: ['pc', 'npc', 'fin'] },
    { id: 'reward', kind: 'ai', task: 'reward', needs: ['settle'], when: 'close_reward' },
    { id: 'sex', kind: 'ai', task: 'sex_record', needs: ['settle'], when: 'close' },
    { id: 'sink', kind: 'ai', task: 'sink', needs: ['settle'], when: 'close' },
    { id: 'tend', kind: 'ai', task: 'tendency', needs: ['settle'], when: 'close' },
    { id: 'relate', kind: 'ai', task: 'relate', needs: ['settle'], when: 'close_relate' },
    { id: 'final', kind: 'code', run: 'final', needs: ['settle', 'reward', 'sex', 'sink', 'tend', 'relate'] },
    { id: 'text', kind: 'ai', task: 'narrate', needs: ['final'], mode: 'new', when: 'close' },
    { id: 'apply', kind: 'apply' },
  ],
}

const sceneOf = (ctx: ChainCtx): SceneRaw => {
  const s = sceneRawOf(ctx.state)
  if (!s) throw new Error('現在沒有進行中的成人場景。')
  return s
}
const inputOf = (ctx: ChainCtx): SceneRoundInput => ctx.input as SceneRoundInput

/** 這一輪對方要不要問 AI：多人每一輪都問；一對一只有這個人這一回合的第一步（turn_began 還沒有）才問，剩下的行動點照規則走。 */
export function aiTurnNeeded(scene: SceneRaw): boolean {
  return npcOrder(scene).length > 0 && (scene.kind === 'group' || !scene.turn_began)
}

/** 前 upTo 個人的行動（scene_turn 給的）與說話的判定（scene_talk 給的；每個說話的人一份：SceneEnv.talk）。 */
function planOf(ctx: ChainCtx, upTo: number): NpcPlan {
  const order = npcOrder(sceneOf(ctx))
  const moves: Record<string, SceneInput[]> = {}
  const talk: Record<string, TalkEnv> = {}
  for (let i = 0; i < Math.min(upTo, order.length); i++) {
    const t = ctx.draft[`t${i + 1}`] as TurnOutput | undefined
    if (t && t.moves.length > 0) moves[order[i]!] = t.moves
    const env = talkEnvOf(ctx.draft[`k${i + 1}`] as TalkOutput | null | undefined)
    if (env) talk[order[i]!] = env
  }
  return { moves, ...(Object.keys(talk).length > 0 ? { talk } : {}) }
}

/** 這一步功能的草稿（可以帶 env.closing）。 */
function roundDraft(ctx: ChainCtx, closing?: Closing): ReportDraft {
  const inp = inputOf(ctx)
  const scene = sceneOf(ctx)
  const base: SceneEnv = closing ? { closing } : {}
  switch (inp.mode) {
    case 'pc': {
      const talk = talkEnvOf(ctx.draft.talk as TalkOutput | null | undefined)
      return sceneAct(ctx.k, ctx.state, inp.input as SceneInput, { ...base, ...(talk ? { talk: { [scene.pc]: talk } } : {}) })
    }
    case 'npc': {
      const order = npcOrder(scene)
      const plan = planOf(ctx, order.length)
      // AI 給的一句動作或台詞（scene_turn 的 line）：功能收（SceneEnv.lines），放進這一步的紀錄與整場的紀錄
      const lines = order.flatMap((who, i) => {
        const line = (ctx.draft[`t${i + 1}`] as TurnOutput | undefined)?.line ?? ''
        return line ? [{ who, text: line }] : []
      })
      return sceneNext(ctx.k, ctx.state, {
        ...base, ...(Object.keys(plan.moves).length > 0 ? { moves: plan.moves } : {}), ...(plan.talk ? { talk: plan.talk } : {}), ...(lines.length > 0 ? { lines } : {}),
      })
    }
    case 'stop': return sceneAct(ctx.k, ctx.state, { kind: 'stop' }, base)
    case 'skip': return sceneSkip(ctx.k, ctx.state, base)
    case 'interrupt': return sceneInterrupt(ctx.k, ctx.state, base)
  }
}

/** 這一場碰到的標籤（含最後這一步）：結束的那一步多做的事也算。stop、略過、被打斷沒有多做的事；玩家與對方的那一步用 Play 照做一遍看。 */
function touchedOf(ctx: ChainCtx): string[] {
  const inp = inputOf(ctx)
  const scene = sceneOf(ctx)
  if (inp.mode === 'pc') {
    const p = playOf(ctx.k, ctx.state, scene)
    const talk = talkEnvOf(ctx.draft.talk as TalkOutput | null | undefined)
    p.talkEnv = talk ? { [scene.pc]: talk } : undefined
    if (p.blocks(scene.pc, inp.input as SceneInput).length === 0) p.perform(scene.pc, inp.input as SceneInput)
    return [...p.s.touched]
  }
  if (inp.mode === 'npc') {
    const order = npcOrder(scene)
    const plan = planOf(ctx, order.length)
    return [...afterNpcs(ctx.k, ctx.state, scene, plan, order.length).s.touched]
  }
  return [...scene.touched]
}

const settledOfCtx = (ctx: ChainCtx): Settled | undefined => {
  const s = ctx.draft.settle as Settled | { ended: false } | undefined
  return s && s.ended ? s : undefined
}

/** 一句說話的判定要的輸入。 */
function talkInputOf(ctx: ChainCtx, speaker: string, text: string, target?: string): TalkInput {
  const scene = sceneOf(ctx)
  const p = playOf(ctx.k, ctx.state, scene)
  const brief = briefOf(p)
  const tid = target ?? p.activeOthers(speaker)[0]
  const name = (id: string): string => ctx.state.actors[id]?.name ?? id
  return {
    talk: { text, speaker: { id: speaker, name: name(speaker) }, target: tid ? { id: tid, name: name(tid) } : null },
    scene: { round: brief.round, nature: brief.nature, nature_name: brief.nature_name, role_name: brief.role_name, goal: brief.goal, pairs: brief.pairs },
    affinity: tid ? meterOf(ctx.k, ctx.state, 'affinity', speaker === scene.pc ? tid : speaker) : null,
    limits: { fit: [TALK_FIT[0], TALK_FIT[1]], goal: [TALK_GOAL[0], TALK_GOAL[1]] },
  }
}

function turnInputOf(ctx: ChainCtx, index: number): TurnInput {
  const scene = sceneOf(ctx)
  const plan = planOf(ctx, index)
  const at = turnPlayOf(ctx.k, ctx.state, scene, plan, index)
  if (!at) throw new Error('沒有這一位要問 AI 的人。')
  const { p, who } = at
  const actor = ctx.state.actors[who]!
  return {
    actor: {
      id: who, name: actor.name, ap: p.s.seats.find((x) => x.id === who)?.ap ?? 0,
      tags: tendencyTagIds(actor).filter((t) => contentAllowed(ctx.state.rules, t)).map((t) => (ctx.k.content.get('tendency_tag', t)?.name as string | undefined) ?? t),
      // 這個人會的技能與體位：內容篩選關掉的本來就不在 knownSkills、knownPositions 裡
      skills: knownSkills(ctx.k, ctx.state, who).map((id) => ({ id, name: sceneDefOf(ctx.k, 'skill', id)?.name ?? id })),
      positions: p.solo ? [] : knownPositions(ctx.k, ctx.state, who, p.activeIds().length).map((x) => ({ id: x.id, name: x.name })),
    },
    scene: briefOf(p), legal: legalMoves(p, who), recent: recentOf(ctx.state, scene), max_moves: 12, earlier: earlierLines(ctx.state, scene, plan, index),
  }
}

/** 收尾的結果放進 SceneEnv.closing：只收「AI 真的交出、驗過」的（status 是 done）；走了退路的不放，功能就照自己的規則算（AI 失敗時結果和 AI 關著一樣）。 */
function closingOf(ctx: ChainCtx): Closing {
  const done = (id: string): boolean => ctx.records[id]?.status === 'done'
  const out: Closing = {}
  const sink = ctx.draft.sink as SinkOutput | null | undefined
  if (done('sink') && sink) out.sink = { kind: sink.kind, amount: sink.amount }
  const tend = ctx.draft.tend as TendencyOutput | undefined
  if (done('tend') && tend) out.tendency = tend.tags
  const sex = ctx.draft.sex as SexRecordOutput | undefined
  if (done('sex') && sex) out.sex_record = sex.records.map((r) => ({ with: r.with, note: r.note, ...(r.kind ? { kind: r.kind } : {}) }))
  const rel = ctx.draft.relate as { affinity?: Record<string, number> } | undefined
  if (done('relate') && rel?.affinity) out.relate = rel.affinity
  return out
}

/** 最後算的草稿：結束的那一步帶 env.closing；再把算回報的結果、AI 的一句話、性經歷的一句話、提醒併進去。 */
function finalDraft(ctx: ChainCtx): ReportDraft {
  const st = settledOfCtx(ctx)
  const inp = inputOf(ctx)
  const d = roundDraft(ctx, st ? closingOf(ctx) : undefined)
  const scene = sceneOf(ctx)
  const results = d.narration?.results ? [...d.narration.results] : []
  const clamps: ClampNote[] = [...(d.clamps ?? [])]
  if (st) {
    // 算回報：驗過的效果落進這一份報告（沒有東西可以給時是空的）
    const reward = ctx.draft.reward as ResolvedEffects | undefined
    if (reward && ctx.records.reward?.status === 'done') {
      d.changes = [...d.changes, ...reward.changes]
      results.push(...reward.lines)
      clamps.push(...reward.clamps)
    }
    // 性經歷的一句話：收尾的正文與之後寫這個人時都讀它（照功能收下的樣子：最多 NOTE_LEN 字）
    if (ctx.records.sex?.status === 'done') {
      const seen = new Set<string>()
      for (const r of [...((ctx.draft.sex as SexRecordOutput).records)].reverse()) {
        if (seen.has(r.with) || !r.note.trim()) continue
        seen.add(r.with)
        results.push(`${ctx.state.actors[r.with]?.name ?? r.with}：${r.note.trim().slice(0, NOTE_LEN)}`)
      }
    }
    // 每一步的 clamps（AI 的夾值提醒）也放進報告，任務鏈列與報告都看得到
    for (const id of ['reward', 'sex', 'sink', 'tend', 'relate']) clamps.push(...(ctx.records[id]?.clamps ?? []))
  }
  if (inp.mode === 'npc') {
    const order = npcOrder(scene)
    for (let i = 1; i <= order.length; i++) clamps.push(...(ctx.records[`t${i}`]?.clamps ?? []), ...(ctx.records[`k${i}`]?.clamps ?? []))
  }
  if (inp.mode === 'pc') clamps.push(...(ctx.records.talk?.clamps ?? []))
  d.narration = { ...(d.narration ?? {}), results }
  if (clamps.length > 0) d.clamps = clamps
  return d
}

export function sceneRoundChain(): ChainDef {
  const turnWhen = (i: number) => (ctx: ChainCtx): boolean => {
    const inp = inputOf(ctx)
    if (inp.mode !== 'npc' || sceneAiOf(ctx.settings) !== 'full') return false
    const scene = sceneRawOf(ctx.state)
    return !!scene && aiTurnNeeded(scene) && npcOrder(scene).length >= i
  }
  const talkWhen = (i: number) => (ctx: ChainCtx): boolean => {
    const t = ctx.draft[`t${i}`] as TurnOutput | undefined
    return !!t && t.moves.some((m) => m.kind === 'talk')
  }
  return {
    template: SCENE_ROUND_TEMPLATE,
    code: 'scene',
    hasText: (ctx) => !!settledOfCtx(ctx),
    codeSteps: {
      // 玩家的一步、對方的一步、結束：算一次看看（不帶 env.closing）。出錯（行動不成立）丟 ActionBlocked，整條鏈不成立
      pc_step: (ctx) => ({ action: roundDraft(ctx).action }),
      npc_step: (ctx) => ({ action: roundDraft(ctx).action }),
      finish_step: (ctx) => ({ action: roundDraft(ctx).action }),
      settle: (ctx) => {
        const scene = sceneOf(ctx)
        const d = roundDraft(ctx)
        if (d.action !== 'scene.end') return { ended: false }
        return settledOf(ctx.k, ctx.state, scene, d, touchedOf(ctx))
      },
      // 收尾的五個結果都在了：把它們放進 SceneEnv.closing，再算一次結束；結果小（closing 與一份摘要），報告草稿由 apply 重算
      final: (ctx) => {
        const st = settledOfCtx(ctx)
        if (!st) return { ended: false }
        const d = finalDraft(ctx)
        return { ended: true, closing: closingOf(ctx), results: d.narration?.results ?? [] }
      },
    },
    whens: {
      pc_talk: (ctx) => inputOf(ctx).mode === 'pc' && inputOf(ctx).input?.kind === 'talk' && sceneAiOf(ctx.settings) === 'full',
      is_pc: (ctx) => inputOf(ctx).mode === 'pc',
      is_npc: (ctx) => inputOf(ctx).mode === 'npc',
      is_finish: (ctx) => inputOf(ctx).mode !== 'pc' && inputOf(ctx).mode !== 'npc',
      npc_turn_1: turnWhen(1), npc_turn_2: turnWhen(2), npc_turn_3: turnWhen(3),
      npc_talk_1: talkWhen(1), npc_talk_2: talkWhen(2), npc_talk_3: talkWhen(3),
      close: (ctx) => !!settledOfCtx(ctx),
      // 算回報：有目的或交易（交易與工作）的場景才跑
      close_reward: (ctx) => {
        const st = settledOfCtx(ctx)
        return !!st && (st.goal !== null || st.nature === 'trade' || st.nature === 'work')
      },
      // 算關係：主角對這一圈或別的圈有對象（單人沒有）
      close_relate: (ctx) => (settledOfCtx(ctx)?.pairs.length ?? 0) > 0,
    },
    aiEnabled: (step, ctx) => {
      switch (step.task) {
        case 'scene_turn': case 'scene_talk': return sceneAiOf(ctx.settings) === 'full'
        case 'sex_record': return ctx.settings.sexrec
        case 'narrate': return ctx.settings.narrate
        case 'polish': return ctx.settings.narrate && !!(ctx.draft.text as NarrateOutput | undefined)?.text
        default: return true
      }
    },
    // 場景的 AI 任務（每回合的兩個、收尾的五個）失敗都走退路，不擋住這一步與場景的結束；寫正文照一般的處理（被拒絕停下來等玩家）
    softFail: (step) => step.task !== 'narrate' && step.task !== 'polish',
    // 只有寫正文走成人路由（reward、relate 讀的是摘要版，一般路由；新的六個任務自己就是成人）
    adult: (_ctx, step) => step?.task === 'narrate' || step?.task === 'polish',
    aiInput: (step, ctx) => {
      const inp = inputOf(ctx)
      const scene = sceneOf(ctx)
      switch (step.id) {
        case 'talk': {
          const m = inp.input as Extract<SceneInput, { kind: 'talk' }>
          return talkInputOf(ctx, scene.pc, m.text ?? '', m.target)
        }
        case 't1': case 't2': case 't3': return { ...turnInputOf(ctx, Number(step.id.slice(1)) - 1) }
        case 'k1': case 'k2': case 'k3': {
          const i = Number(step.id.slice(1)) - 1
          const who = npcOrder(scene)[i]!
          const m = (ctx.draft[`t${i + 1}`] as TurnOutput).moves.find((x) => x.kind === 'talk') as Extract<SceneInput, { kind: 'talk' }>
          return talkInputOf(ctx, who, m.text ?? '', m.target)
        }
      }
      const st = settledOfCtx(ctx)
      if (step.task === 'narrate' || step.task === 'polish') {
        const d = finalDraft(ctx)
        const input = narrateInputOf(ctx.state, d, step.mode ?? 'new', inp.direction)
        return step.task === 'polish' ? { ...input, mode: 'polish', text: (ctx.draft.text as NarrateOutput | undefined)?.text ?? '' } : input
      }
      if (!st) throw new Error(`場景的一步還沒有結束，不該問 ${String(step.task)}`)
      switch (step.task) {
        case 'reward': return { scene: digestOf(scene, st), state: ctx.state, hint: [] } satisfies SceneRewardInput
        case 'relate': return { scene: digestOf(scene, st), cast: st.pairs.map((p) => ({ id: p.id, name: p.name, fit: p.fit, rating: p.band, range: p.range })) } satisfies SceneRelateInput
        case 'sex_record': return { nature: st.nature, people: st.present.filter((x) => x.id !== scene.pc), log: st.log, firsts: st.firsts, types: [st.nature], ...(inp.direction ? { direction: inp.direction } : {}) } satisfies SexRecordInput
        case 'sink': return sinkInputOf(st)
        case 'tendency': return tendencyInputOf(st, inp.direction)
      }
      throw new Error(`場景的鏈不認得 ${String(step.task)} 這個任務`)
    },
    apply: (ctx) => {
      const d = finalDraft(ctx)
      const text = (ctx.draft.polish as NarrateOutput | undefined) ?? (ctx.draft.text as NarrateOutput | undefined)
      if (text?.text) d.narration = { ...d.narration, text: text.text, ...(text.uncovered.length ? { uncovered: text.uncovered } : {}) }
      return d
    },
  }
}
