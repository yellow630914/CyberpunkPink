// L5 行動核心：主動行動的三段式（做法照搬 ElondiaRPG 的 actions.ts，程式照新的分層重寫）。
//
//   第一段 prepareAction   擲骰並存起來（骰面從存檔的亂數狀態導出，不改狀態）
//   第二段 sanitizeJudgment AI（或退路）給判定；程式驗格式、夾在上限內
//   第三段 buildActionReport 把判定與驗過、夾過的效果組成報告草稿；由呼叫的人交給 commitReport
//
// 三段都是純函式，不改狀態。中間要不要問 AI、問哪個模型，是 L7 任務鏈的事。

import type { ActorId, AttrId, Change, CheckRoll, ClampNote, Degree, GameState, Grade, PartySnapshot, ReportDraft, SkillId } from '../types'
import { ATTR_IDS } from '../types'
import { clone } from '../util/clone'
import { clamp, isRecord, str } from '../util/sanitize'
import { formatAmount } from '../util/money'
import { deriveRng } from '../util/rng'
import type { RulesKernel } from '../rules/kernel'
import { DEGREE_NAME, checkParts, computeDegree, dcFor, makeCheck } from '../rules/check'
import type { Effect, ResolvedEffects } from '../rules/effects'
import { askedMatches } from '../rules/effects'
import type { ActionInput, ActionKindDef, ActionRegistry } from './kinds'

/** 判定的 DC 預設在參考值 ±3 之內（AI_TASKS 4.1 節）。 */
export const DC_WINDOW = 3
export const DEGREES: readonly Degree[] = ['critical', 'success', 'fail', 'fumble']

export interface ActionKernel extends RulesKernel {
  actions: ActionRegistry
}

/** 第一段的結果：擲好的骰與這次行動的條件。放在任務鏈的草稿裡，不進存檔。 */
export interface ActionPending {
  input: ActionInput
  actor: ActorId
  attr: AttrId
  skill?: SkillId
  /** 參考 DC（已經加上難度的偏移） */
  refDc: number
  /** 照參考 DC 算的檢定（AI 關閉時直接用它） */
  roll: CheckRoll
  /** 重擲過幾次 */
  reroll: number
  /** 每一次重擲之前的骰面 */
  history: number[]
  minutes: number
  maxMinutes: number
  /** 上限用的等級 */
  grade: Grade
}

/** 判定的結果（AI_TASKS 4.1 節的 submit_judgment）。 */
export interface Judgment {
  degree: Degree
  attr: AttrId
  skill?: SkillId
  dc: number
  /** 理由 */
  reason: string
  /** 轉折一句 */
  twist: string
  minutes: number
  /** 這次的結果會不會帶出一個新的人 */
  newPerson: boolean
  /** 玩家的原話：超出預設時才附 */
  asked?: string
  /** 照這份判定重算的檢定（屬性、基本功或 DC 換了，合計就不一樣） */
  roll: CheckRoll
}

export class ActionBlocked extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'ActionBlocked'
  }
}

/** 這一區的等級。區的資料還沒搬進來之前一律是 I 級；有 district 內容之後讀它的 grade。 */
export function areaGrade(k: RulesKernel, state: GameState): Grade {
  const g = state.location.district ? k.content.get('district', state.location.district)?.grade : undefined
  return (typeof g === 'number' && g >= 1 && g <= 5 ? g : 1) as Grade
}

const purposeOf = (state: GameState, input: ActionInput) => `action/${input.kind}/${state.seq.chain}`

/** 第一段：擲骰。reroll 是重擲的次數（0 是第一次）；history 是之前每一次的骰面。 */
export function prepareAction(k: ActionKernel, state: GameState, input: ActionInput, reroll = 0, history: number[] = []): ActionPending {
  const def = k.actions.get(input.kind)
  if (!def) throw new Error(`沒有 ${input.kind} 這種行動`)
  if (!state.pc || !state.actors[state.pc]) throw new ActionBlocked('還沒有主角。')
  const blocked = def.block?.(state, input)
  if (blocked) throw new ActionBlocked(blocked)
  const actor = state.pc
  const attr = input.attr ?? def.attr
  const skill = input.skill ?? def.skill
  const refDc = dcFor(typeof def.dc === 'function' ? def.dc(state, input) : def.dc, state.rules)
  const roll = rollFor(k, state, def, input, actor, attr, skill, refDc, reroll, history)
  return { input: clone(input), actor, attr, ...(skill ? { skill } : {}), refDc, roll, reroll, history: [...history], minutes: def.minutes, maxMinutes: def.maxMinutes, grade: areaGrade(k, state) }
}

function rollFor(k: ActionKernel, state: GameState, def: ActionKindDef, input: ActionInput, actor: ActorId, attr: AttrId, skill: SkillId | undefined, dc: number, reroll: number, history: number[]): CheckRoll {
  const natural = naturalOf(state, input, reroll)
  const parts = checkParts(k.stats, state, actor, { attr, skill, tags: def.tags ?? [], target: input.target }, input.situation)
  return { ...makeCheck({ natural, parts, dc, attr, skill }), ...(reroll ? { rerolls: reroll, history: [...history] } : {}) }
}

function naturalOf(state: GameState, input: ActionInput, reroll: number): number {
  return deriveRng(state.rng, purposeOf(state, input), reroll).int(1, 20)
}

/** 重擲：換一顆骰子，舊的骰面記進 history（玩家不能藏起來）。 */
export function rerollAction(k: ActionKernel, state: GameState, pending: ActionPending): ActionPending {
  return prepareAction(k, state, pending.input, pending.reroll + 1, [...pending.history, pending.roll.natural])
}

/** 退路的判定：照骰值與參考 DC，轉折留空（AI_TASKS 4.1 節）。 */
export function fallbackJudgment(pending: ActionPending): Judgment {
  return {
    degree: pending.roll.degree, attr: pending.attr, ...(pending.skill ? { skill: pending.skill } : {}), dc: pending.refDc,
    reason: '', twist: '', minutes: pending.minutes, newPerson: false, roll: clone(pending.roll),
  }
}

export interface JudgeOpts {
  /** 設定「玩家要求的結果也夾值」 */
  clampAsked: boolean
}

export interface SanitizedJudgment {
  judgment: Judgment | null
  /** 格式錯誤：有任何一筆，這一步算失敗（重試或走退路） */
  errors: string[]
  clamps: ClampNote[]
}

/**
 * 第二段：把 AI 交出的判定清乾淨。格式與封閉清單不合是錯誤；超出預設的三條（DC 在參考值 ±3、時間在上限內、
 * 成功程度照骰值）被夾住，不算錯誤。設定關著、asked 又對得上玩家輸入時，這三條不夾。
 */
export function sanitizeJudgment(k: ActionKernel, state: GameState, pending: ActionPending, raw: unknown, opts: JudgeOpts): SanitizedJudgment {
  const def = k.actions.get(pending.input.kind)!
  const errors: string[] = []
  const clamps: ClampNote[] = []
  if (!isRecord(raw)) return { judgment: null, errors: ['judgment：要是一個物件'], clamps }

  if (!DEGREES.includes(raw.degree as Degree)) errors.push(`judgment.degree：只能是 ${DEGREES.join('、')}（拿到 ${JSON.stringify(raw.degree)}）`)
  const attr = raw.attr === undefined ? pending.attr : (raw.attr as AttrId)
  if (!(ATTR_IDS as readonly unknown[]).includes(attr)) errors.push(`judgment.attr：只能是 ${ATTR_IDS.join('、')}（拿到 ${JSON.stringify(raw.attr)}）`)
  const skill = raw.skill === undefined ? pending.skill : raw.skill === null || raw.skill === '' ? undefined : (raw.skill as SkillId)
  if (skill !== undefined && (typeof skill !== 'string' || (k.content.list('skill').length > 0 && !k.content.has('skill', skill)))) errors.push(`judgment.skill：沒有 ${JSON.stringify(raw.skill)} 這項基本功`)
  if (raw.dc !== undefined && !(typeof raw.dc === 'number' && Number.isFinite(raw.dc))) errors.push('judgment.dc：要是數字')
  if (raw.minutes !== undefined && !(typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) && raw.minutes >= 0)) errors.push('judgment.minutes：要是 0 以上的數字')
  for (const f of ['reason', 'twist'] as const) if (raw[f] !== undefined && typeof raw[f] !== 'string') errors.push(`judgment.${f}：要是字串`)
  if (raw.asked !== undefined && typeof raw.asked !== 'string') errors.push('judgment.asked：要是玩家輸入裡的一段字')
  if (errors.length) return { judgment: null, errors, clamps }

  // 玩家明說要的（附 asked 而且對得上輸入），設定關著時不受三條限制
  const free = !opts.clampAsked && askedMatches(raw.asked, pending.input.text)

  let dc = raw.dc === undefined ? pending.refDc : Math.round(raw.dc as number)
  if (!free && Math.abs(dc - pending.refDc) > DC_WINDOW) {
    const to = clamp(dc, pending.refDc - DC_WINDOW, pending.refDc + DC_WINDOW)
    clamps.push({ path: 'judgment.dc', from: dc, to, limit: `${pending.refDc}±${DC_WINDOW}`, notice: '這件事的難度被拉回平常的範圍。' })
    dc = to
  }

  let minutes = raw.minutes === undefined ? pending.minutes : Math.round(raw.minutes as number)
  if (!free && minutes > pending.maxMinutes) {
    clamps.push({ path: 'judgment.minutes', from: minutes, to: pending.maxMinutes, limit: pending.maxMinutes, notice: `這件事最多花 ${formatAmount(Math.round(pending.maxMinutes / 60))} 小時。` })
    minutes = pending.maxMinutes
  }

  // 屬性、基本功或 DC 換了：用同一顆骰重算
  const parts = checkParts(k.stats, state, pending.actor, { attr, skill, tags: def.tags ?? [], target: pending.input.target }, pending.input.situation)
  const check = makeCheck({ natural: pending.roll.natural, parts, dc, attr, skill })
  let degree = raw.degree as Degree
  const byDie = computeDegree(check.natural, check.total, dc)
  if (!free && degree !== byDie) {
    clamps.push({ path: 'judgment.degree', from: degree, to: byDie, notice: `結果照骰子算：${DEGREE_NAME[byDie]}。` })
    degree = byDie
  }
  const roll: CheckRoll = { ...check, degree, ...(pending.reroll ? { rerolls: pending.reroll, history: [...pending.history] } : {}) }
  const asked = str(raw.asked, 400)
  return {
    judgment: {
      degree, attr, ...(skill ? { skill } : {}), dc, reason: str(raw.reason, 600), twist: str(raw.twist, 300), minutes,
      newPerson: raw.new_person === true || raw.newPerson === true, ...(asked ? { asked } : {}), roll,
    },
    errors, clamps,
  }
}

/** 參考範圍：這種行動、這個成功程度、這一區的等級，平常會拿到什麼。種類沒有定義就是空的。 */
export function rewardHint(k: ActionKernel, state: GameState, pending: ActionPending, judgment: Judgment): Effect[] {
  const def = k.actions.get(pending.input.kind)!
  return def.hint?.({ state, input: pending.input, actor: pending.actor, degree: judgment.degree, narrow: judgment.degree === 'success' && judgment.roll.margin < 3, grade: pending.grade }) ?? []
}

/** 算回報的退路：照參考範圍的一半，物品給模板的標準品（AI_TASKS 4.1 節）。數量類的欄位（amount）減半，其他原樣。 */
export function fallbackReward(hint: Effect[]): Effect[] {
  return hint
    .map((e) => (typeof e.amount === 'number' ? { ...e, amount: Math.trunc(e.amount / 2) } : { ...e }))
    .filter((e) => e.amount !== 0)
}

/** 隊伍的快照：每個人的 hp、load、sink 各一組 [前, 後, 上限]。上限的衍生數值還沒有功能註冊時記 0。 */
export function partySnapshot(k: RulesKernel, before: GameState, after: GameState): PartySnapshot[] {
  const cap = (s: GameState, id: ActorId, stat: string) => (k.stats.hasStat(stat) ? k.stats.stat(s, id, stat) : 0)
  return after.party.filter((id) => after.actors[id]).map((id) => {
    const b = before.actors[id] ?? after.actors[id]!, a = after.actors[id]!
    return {
      id, name: a.name,
      hp: [b.hp, a.hp, cap(after, id, 'max_hp')], load: [b.load, a.load, cap(after, id, 'load_cap')], sink: [b.sink, a.sink, cap(after, id, 'sink_cap')],
      afterglow: a.afterglow,
    }
  })
}

export interface ActionResult {
  pending: ActionPending
  judgment: Judgment
  /** 驗過、夾過的回報 */
  reward: ResolvedEffects
  /** 判定被夾的那幾筆 */
  judgeClamps?: ClampNote[]
  /** AI 的正文（沒有就只有摘要） */
  text?: string
  /** 正文漏寫的那幾行定案的結果 */
  uncovered?: number[]
  /** 其他步驟要一起套用的變更（算關係、新的人……） */
  extraChanges?: Change[]
  /** 其他步驟的定案結果（接在回報後面） */
  extraLines?: string[]
  chain?: string
}

/** 第三段：組出報告草稿。交給 commitReport 才會改狀態。 */
export function buildActionReport(k: ActionKernel, state: GameState, r: ActionResult): ReportDraft {
  const def = k.actions.get(r.pending.input.kind)!
  const actor = state.actors[r.pending.actor]!
  const j = r.judgment
  const changes: Change[] = [...r.reward.changes, ...(r.extraChanges ?? []), ...(j.minutes > 0 ? [{ op: 'time', minutes: j.minutes }] : []), { op: 'rng', advance: 1 }]
  const after = clone(state)
  k.changes.applyAll(after, changes)
  const lines = [...r.reward.lines, ...(r.extraLines ?? [])]
  const rollLine = `骰 ${j.roll.natural}，合計 ${j.roll.total}，對 DC ${j.roll.dc}`
  const summary = [`${actor.name}：${def.name}，${DEGREE_NAME[j.degree]}（${rollLine}）。`, j.twist, ...lines.map((l) => `${l}。`)].filter(Boolean).join('')
  const clamps = [...(r.judgeClamps ?? []), ...r.reward.clamps]
  return {
    kind: def.reportKind, action: def.id, location: clone(state.location), actor: r.pending.actor,
    ...(r.pending.input.text ? { input: r.pending.input.text } : {}),
    party: partySnapshot(k, state, after),
    timeline: [{ layer: 'meat', actor: r.pending.actor, text: j.reason || def.name, roll: j.roll }],
    changes,
    outcome: { result: j.degree, summary },
    ...(clamps.length ? { clamps } : {}),
    narration: { results: lines, ...(r.text ? { text: r.text } : {}), ...(r.uncovered?.length ? { uncovered: r.uncovered } : {}) },
    ...(r.chain ? { chain: r.chain } : {}),
  }
}
