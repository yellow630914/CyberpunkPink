// L6 功能 medical 的急救（戰鬥外；DOWNTIME 3.1 節；dev/work/M4-medical.md 第 1、2 點）。
// 改狀態的入口是匯出一個純函式、回傳報告草稿：aidDraft 不成立時丟 ActionBlocked（原因一條一句）；aidBlock 回傳第一條原因（能做是 null）。
//
// 不在戰鬥中、對象生命不到上限、身上沒有 aided。做的人擲技術＋醫療對 DC（預設 13），背包裡有帶 medkit 標籤的物品 +2（不消耗）。
// 成功回 1d6＋醫療等級並掛 treated 與 aided；大成功回兩倍；失敗只掛 aided；大失敗 −1d4（最少剩 1）也掛 aided。時間 +10 分鐘。
// aided 在對象再受傷（生命往下）的時候由 index.ts 的 report.after 拿掉。骰子一律用 deriveRng（用途帶對象）：重新讀檔重擲、結果不變。

import type { ActorId, Change, CheckRoll, ContentEntry, GameState, Kernel, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, checkPassChance, dcFor, deriveRng, formatDuration, rollCheck, roll as rollDice } from '../../core'
import { outOfBattleBlock, reportOf } from './common'
import { AIDED, AID_ATTR, AID_SKILL, TREATED, maxHpOf, medicalRules, nameOf, nowOf, hasCond } from './model'

export const AID_ACTION = 'medical.aid'
const KIT_LABEL = '醫療包'

export interface AidOpts {
  /** 動手的人（主角或隊友） */
  by: ActorId
  /** 被急救的人 */
  target: ActorId
}

/** 一次急救的報價（畫面與草稿用同一份）。 */
export interface AidQuote {
  by: ActorId
  target: ActorId
  minutes: number
  dc: number
  /** 擲骰面以外的加值合計（屬性、醫療、醫療包、別的修正） */
  bonus: number
  /** 急救成功（成功或大成功）的機率，0～1 */
  chance: number
  /** 每一筆加值（畫面列「這個數字是哪些加起來的」） */
  parts: RollPart[]
  /** 用到的醫療包是哪一種物品；沒有是 null */
  kit: string | null
  /** 醫療等級（成功時加在 1d6 上） */
  medicine: number
}

interface AidPlan {
  problems: string[]
  quote: AidQuote | null
}

/** 背包裡第一件帶急救包標籤的物品（不消耗）。 */
function kitIn(k: Kernel, state: GameState, tag: string): string | null {
  for (const s of state.inventory) {
    if (s.qty <= 0) continue
    const tags = k.content.get<ContentEntry & { tags?: unknown }>('item', s.id)?.tags
    if (Array.isArray(tags) && tags.includes(tag)) return s.id
  }
  return null
}

function planAid(k: Kernel, state: GameState, o: AidOpts): AidPlan {
  const rules = medicalRules(k)
  if (!state.actors[o.by]) return { problems: ['找不到動手的人。'], quote: null }
  if (!state.actors[o.target]) return { problems: ['找不到被急救的人。'], quote: null }
  const problems: string[] = []
  const out = outOfBattleBlock(k, state, AID_ACTION)
  if (out) problems.push(out)
  if (!state.party.includes(o.by)) problems.push('動手的人不在隊上。')
  if (!state.party.includes(o.target)) problems.push('被急救的人不在隊上。')
  const t = state.actors[o.target]!
  const max = maxHpOf(k, state, o.target)
  if (t.hp >= max) problems.push(`${t.name}的生命值已經是滿的。`)
  if (hasCond(state, o.target, AIDED)) problems.push(`${t.name}這一次受的傷已經急救過了，再受傷之前不能再急救。`)

  const kit = kitIn(k, state, rules.aid.kit_tag)
  const situation: RollPart[] = kit && rules.aid.kit_bonus !== 0 ? [{ label: KIT_LABEL, value: rules.aid.kit_bonus, source: 'situation' }] : []
  const parts = checkParts(k.stats, state, o.by, { attr: AID_ATTR, skill: AID_SKILL, tags: ['medical', 'first_aid'], target: o.target }, situation).filter((p) => p.value !== 0)
  const bonus = parts.reduce((s, p) => s + p.value, 0)
  const dc = dcFor(rules.aid.dc, state.rules)
  const quote: AidQuote = {
    by: o.by, target: o.target, minutes: rules.aid.minutes, dc, parts, bonus, chance: checkPassChance(bonus, dc), kit,
    medicine: state.actors[o.by]!.skills[AID_SKILL] ?? 0,
  }
  return { problems, quote }
}

/** 急救現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const aidProblems = (k: Kernel, state: GameState, o: AidOpts): string[] => planAid(k, state, o).problems
/** 急救現在行不行：第一條原因；行是 null。 */
export const aidBlock = (k: Kernel, state: GameState, o: AidOpts): string | null => planAid(k, state, o).problems[0] ?? null
/** 這一次急救的報價（DC、每一筆加值、醫療包）；人不存在是 null。 */
export const aidQuote = (k: Kernel, state: GameState, o: AidOpts): AidQuote | null => planAid(k, state, o).quote

/**
 * 急救一次。不成立丟 ActionBlocked（aidProblems 的第一條）。
 * 寫進狀態：時間加 minutes、對象的生命值（往上補不超過上限；大失敗往下扣但最少剩 1）、掛 aided（一定）與 treated（成功與大成功，until 是處理完之後 treated_minutes）、亂數游標往前。報告 medical.aid。
 */
export function aidDraft(k: Kernel, state: GameState, o: AidOpts): ReportDraft {
  const plan = planAid(k, state, o)
  if (plan.problems.length > 0 || !plan.quote) throw new ActionBlocked(plan.problems[0] ?? '現在急救不了。')
  const q = plan.quote
  const rules = medicalRules(k)
  const patient = state.actors[o.target]!
  const max = maxHpOf(k, state, o.target)

  const check: CheckRoll = rollCheck(k.stats, state, {
    actor: o.by, attr: AID_ATTR, skill: AID_SKILL, dc: q.dc, purpose: `${AID_ACTION}/${o.target}`, tags: ['medical', 'first_aid'], target: o.target,
    situation: q.kit && rules.aid.kit_bonus !== 0 ? [{ label: KIT_LABEL, value: rules.aid.kit_bonus, source: 'situation' }] : [],
  })
  const who = o.by === o.target ? `${nameOf(state, o.by)}替自己急救` : `${nameOf(state, o.by)}替${patient.name}急救`
  const changes: Change[] = [{ op: 'time', minutes: q.minutes }]
  const lines: string[] = []
  let delta = 0
  let treated = false
  if (check.degree === 'success' || check.degree === 'critical') {
    const d6 = rollDice(deriveRng(state.rng, `${AID_ACTION}/${o.target}/heal`), '1d6').total
    const base = d6 + q.medicine
    const heal = check.degree === 'critical' ? base * 2 : base
    delta = Math.max(0, Math.min(heal, max - patient.hp))
    treated = true
    lines.push(`${who}，${check.degree === 'critical' ? '手法漂亮，' : ''}傷口處理好了，生命值回了 ${delta} 點。`)
  } else if (check.degree === 'fumble') {
    const d4 = rollDice(deriveRng(state.rng, `${AID_ACTION}/${o.target}/hurt`), '1d4').total
    delta = -Math.min(d4, Math.max(0, patient.hp - 1))
    lines.push(`${who}，手一抖，反而讓傷口更痛了${delta < 0 ? `，生命值少了 ${-delta} 點` : ''}。`)
  } else {
    lines.push(`${who}，但是沒有處理好，傷口還在滲。`)
  }
  if (delta !== 0) changes.push({ op: 'actor.track', id: o.target, track: 'hp', delta })
  if (treated) changes.push({ op: 'actor.condition', id: o.target, condition: TREATED, until: nowOf(state) + q.minutes + rules.treated_minutes })
  changes.push({ op: 'actor.condition', id: o.target, condition: AIDED }, { op: 'rng', advance: 1 })
  if (treated) lines.push('傷口算處理過了。')
  lines.push('這一次受的傷只能急救一次。')

  const data = { by: o.by, target: o.target, degree: check.degree, hp: delta, minutes: q.minutes, kit: q.kit }
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: o.by, text: `${DEGREE_NAME[check.degree]}（骰 ${check.natural}，合計 ${check.total}，對 DC ${check.dc}）`, roll: check, tag: 'medical.roll', data: { degree: check.degree } }]
  const draft = reportOf(state, AID_ACTION, o.by, o.target, changes, lines, check.degree, data, beats)
  draft.outcome.summary = `${lines.join('')}（花了 ${formatDuration(q.minutes)}）`
  return draft
}
