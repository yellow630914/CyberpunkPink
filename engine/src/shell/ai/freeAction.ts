// L7 外殼：自由行動的任務鏈（AI_TASKS 3.1 節）與它用到的任務（4.1 節）：judge、reward、narrate、polish。
//
//   擲骰 → 判定 → 參考範圍 →（新的人）→ 算回報（驗證、夾值）→（算關係）→ 寫正文（收 <results>、交 <covered>）→（潤色）→ 套用
//
// 判定與寫正文之間一定隔著程式；結果的步驟都在寫正文之前；寫正文之後的步驟不交出新的數值。
// 提示詞的內容在 PROMPTS，之後從 data/prompts/tasks.json 載入；這裡的請求只有結構：每一段一個標籤，
// 其中 <input> 是機器讀的 JSON（假的服務商與測試靠它）。

import type { Change, ClampNote, GameState } from '../../core/types'
import type { Kernel } from '../../core/kernel'
import type { ActionInput } from '../../core/action/kinds'
import type { ActionPending, Judgment } from '../../core/action/action'
import { actionPrelude, actionTailChanges, buildActionReport, fallbackJudgment, fallbackReward, kindFallback, prepareAction, rewardByRules, rewardHint, sanitizeJudgment } from '../../core/action/action'
import { DEGREE_NAME, VERDICT_NAME } from '../../core/rules/check'
import type { Effect, EffectCtx, ResolvedEffects } from '../../core/rules/effects'
import { effectCtx as makeEffectCtx } from '../../core/rules/grades'
import { isRecord } from '../../core/util/sanitize'
import type { ChainCtx, ChainDef, ChainTemplate } from './chain'
import type { TaskDef, TaskRegistry } from './tasks'

/** data/ai/chains.json 的那一筆（AI_TASKS 2.7 節），原樣照抄。 */
export const FREE_ACTION_TEMPLATE: ChainTemplate = {
  chain: 'free_action',
  steps: [
    { id: 'roll', kind: 'code', run: 'roll_check' },
    { id: 'judge', kind: 'ai', task: 'judge', needs: ['roll'] },
    { id: 'hint', kind: 'code', run: 'reward_hint', needs: ['judge'] },
    { id: 'person', kind: 'ai', task: 'flavor_roster', needs: ['judge'], when: 'new_person' },
    { id: 'reward', kind: 'ai', task: 'reward', needs: ['judge', 'hint'] },
    { id: 'relate', kind: 'ai', task: 'relate', needs: ['judge', 'person'], when: 'cast_present' },
    { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge', 'person', 'reward', 'relate'], mode: 'new' },
    { id: 'apply', kind: 'apply' },
  ],
  hooks: ['after_text'],
}

export interface JudgeInput {
  state: GameState
  pending: ActionPending
}
export interface JudgeOutput {
  judgment: Judgment
  clamps: ClampNote[]
}
export interface RewardInput {
  /** 算回報驗證用的狀態：鏈開始時的狀態，先套上行動的起手變更（ActionKindDef.prelude） */
  state: GameState
  pending: ActionPending
  judgment: Judgment
  hint: Effect[]
}
/** 算關係（relate）收到的：在場有具名的人，與這一次結算的摘要。 */
export interface RelateInput {
  cast: Array<{ id: string; name: string }>
  report: Record<string, unknown>
}
/** 算關係交出的定案結果。M2 還沒有 AI 那一半，退路什麼都不記（AI_TASKS 4.1 節 relate 的退路：「一般的鏈不變」）。 */
export interface RelateOutput {
  changes: Change[]
  lines: string[]
}
export const NO_RELATION: RelateOutput = { changes: [], lines: [] }

/** 在場有具名的 NPC（自由行動看隊上與場上的角色；role 是 npc）。 */
export function castOf(state: GameState): RelateInput['cast'] {
  return Object.values(state.actors).filter((a) => a.role === 'npc').map((a) => ({ id: a.id, name: a.name }))
}

export interface NarrateInput {
  mode: string
  /** 報告的摘要（寫正文收到的報告）。自由行動是判定的結果；戰鬥是結果與 timeline；每一條鏈各自決定放什麼 */
  report: Record<string, unknown>
  /** 定案的結果，一行一筆；編號是 1 起算的行號 */
  results: string[]
}
export interface NarrateOutput {
  text?: string
  /** 正文漏寫的那幾行（<results> 的編號，1 起算） */
  uncovered: number[]
}

const json = (v: unknown) => JSON.stringify(v, null, 1)
const numbered = (lines: string[]) => (lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '（沒有）')

/** 取出正文結尾的 <covered>，拿掉它，回傳正文與寫到的編號。沒有交就是 null。 */
export function splitCovered(raw: string): { text: string; covered: number[] | null } {
  const m = /<covered>([\s\S]*?)<\/covered>\s*$/.exec(raw) ?? /<covered>([^\n<]*)\s*$/.exec(raw)
  if (!m) return { text: raw.replace(/<\/?covered>/g, '').trim(), covered: null }
  const covered = (m[1]!.match(/\d+/g) ?? []).map(Number)
  return { text: raw.slice(0, m.index).replace(/<\/?covered>/g, '').trim(), covered }
}

/**
 * 正文的硬規則（AI_TASKS 4.1 節「正文的硬規則」，PROMPTS H4、H10）。目的是沉浸：不寫戰報。只擋三類，一小組正規式，寧可漏擋也不誤殺：
 * 世界裡的數字（時間、人數、樓層、對白裡的錢）不擋。
 */
const STATUS_BAR = [
  /^\s{0,3}#{1,6}\s/m, // 標題
  /\b(?:HP|MP|AP|SP|XP|DC|LV)\s*[:：]?\s*[-−+]?\d/, // HP: 999/999、AP 3
  /(?:生命值?|感載|過載|護甲|行動點|餘韻|沉溺)\s*[:：]?\s*\d+\s*[/／]\s*\d+/, // 感載 0/52
]
const DICE_JARGON = [
  /(?:擲出|骰出|擲到|骰到|擲得)\s*\d/, // 擲出 17
  /\bDC\s*\d/, // DC 13
  /\b\d*d(?:4|6|8|10|12|20|100)\b/, // d20、2d6
  /\brolled\s+\d/i,
  /命中率/,
]
const MECHANIC_NUMBERS = [
  /\d[\d,]*\s*點\s*(?:的\s*)?(?:傷害|生命|血量|感載|護甲|行動點|HP)/, // 3 點傷害
  /(?:傷害|生命值?|血量|感載|護甲|行動點|HP)\s*[:：]?\s*[-−+＋－]\s*\d/, // 生命 −12
  /(?:造成|受到|承受|失去|損失)\s*\d[\d,]*\s*(?:傷害|生命|感載)/, // 造成 40 傷害
]
const anyOf = (list: RegExp[], text: string) => list.some((re) => re.test(text))

/** 寫正文與潤色共用的檢查：不能是空的；硬規則 H10（標題、狀態欄）與 H4（骰值、機制的數字）；對照 <covered>。 */
function checkProse(raw: unknown, results: string[]): { ok: true; value: NarrateOutput; marks: string[] } | { ok: false; errors: string[] } {
  if (typeof raw !== 'string') return { ok: false, errors: ['正文要是文字'] }
  const { text, covered } = splitCovered(raw)
  if (!text) return { ok: false, errors: ['正文是空的'] }
  if (anyOf(STATUS_BAR, text)) return { ok: false, errors: ['H10：正文不寫標題、狀態欄、系統訊息'] }
  if (anyOf(DICE_JARGON, text) || anyOf(MECHANIC_NUMBERS, text)) return { ok: false, errors: ['H4：擲骰、DC、傷害與生命、感載的數字不寫進文字，用描寫呈現'] }
  // 對照：少了哪一行，或沒有交 <covered>，標「沒寫到」。不算失敗、不改任何結果
  const uncovered = results.map((_, i) => i + 1).filter((n) => !covered?.includes(n))
  return { ok: true, value: { text, uncovered }, marks: uncovered.length ? ['uncovered'] : [] }
}

/** 把自由行動用到的任務註冊進去。 */
export function registerFreeActionTasks(k: Kernel, tasks: TaskRegistry): void {
  const judge: TaskDef<JudgeInput, JudgeOutput> = {
    id: 'judge', owner: 'shell', size: 'M', output: 'json', onExhausted: 'wait',
    schema: { name: 'submit_judgment', schema: { type: 'object', required: ['degree'], properties: { degree: { enum: ['critical', 'success', 'fail', 'fumble'] }, attr: { type: 'string' }, skill: { type: 'string' }, dc: { type: 'number' }, reason: { type: 'string' }, twist: { type: 'string' }, minutes: { type: 'number' }, new_person: { type: 'boolean' }, asked: { type: 'string' } } } },
    build: ({ state, pending }) => {
      const pc = state.actors[pending.actor]!
      const data = {
        action: { kind: pending.input.kind, text: pending.input.text ?? '' },
        roll: { natural: pending.roll.natural, total: pending.roll.total, parts: pending.roll.parts, degree: pending.roll.degree, attr: pending.attr, skill: pending.skill ?? null },
        ref_dc: pending.refDc, dc_window: 3, minutes: pending.minutes, max_minutes: pending.maxMinutes,
        actor: { name: pc.name, attrs: pc.attrs, skills: pc.skills, perks: pc.perks, afterglow: pc.afterglow },
      }
      return {
        system: '你是跑團的主持人。看骰值與情境，給出成功程度（是，而且／是／是，但是／不，但是／不，而且）與一句轉折，用 submit_judgment 的格式交出。',
        sections: [['action', pending.input.text ?? ''], ['degrees', Object.entries(DEGREE_NAME).map(([id, n]) => `${id}：${n}`).join('\n')], ['input', json(data)]],
      }
    },
    check: (raw, { state, pending }, ctx) => {
      const r = sanitizeJudgment(k, state, pending, raw, { clampAsked: ctx.settings.clamp_asked })
      return r.judgment ? { ok: true, value: { judgment: r.judgment, clamps: r.clamps }, clamps: r.clamps } : { ok: false, errors: r.errors }
    },
    fallback: ({ pending }) => ({ judgment: fallbackJudgment(pending), clamps: [] }),
  }

  // 這一批回報是一次行動的結算：判定已經花掉的時間算進總時間（合計後受行動種類的時間上限管），
  // 行動其餘的變更（時間、亂數的游標）當成 tail 一起驗，套用才不會失敗
  const effectCtx = (input: RewardInput, clampAsked: boolean, source: EffectCtx['source']): EffectCtx => makeEffectCtx(k, input.state, {
    source, clampAsked, actor: input.pending.actor, grade: input.pending.grade, playerInput: input.pending.input.text,
    action: { minutes: input.judgment.minutes, maxMinutes: input.pending.maxMinutes }, tail: actionTailChanges(input.judgment),
  })

  const reward: TaskDef<RewardInput, ResolvedEffects> = {
    id: 'reward', owner: 'shell', size: 'S', output: 'json', onExhausted: 'fallback',
    schema: { name: 'submit_reward', schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['kind', 'from'] } } } } },
    build: (input) => ({
      system: '照判定的結果與參考範圍，交出這次具體拿到的東西。每一筆都要有依據（from）：成功程度、判定裡的一段字、或玩家的原話。用 submit_reward 的格式交出。',
      sections: [
        ['judgment', `${DEGREE_NAME[input.judgment.degree]}。${input.judgment.reason}${input.judgment.twist ? ` 轉折：${input.judgment.twist}` : ''}`],
        ['player', input.pending.input.text ?? ''],
        ['input', json({ degree: input.judgment.degree, reason: input.judgment.reason, twist: input.judgment.twist, hint: input.hint, grade: input.pending.grade, kinds: k.effects.kinds(), player_text: input.pending.input.text ?? '' })],
      ],
    }),
    check: (raw, input, ctx) => {
      if (!isRecord(raw) || !Array.isArray(raw.items)) return { ok: false, errors: ['reward.items：要是一個陣列'] }
      const errors: string[] = []
      const effects: unknown[] = []
      raw.items.forEach((it, i) => {
        const at = `reward.items[${i}]`
        if (!isRecord(it)) return void errors.push(`${at}：要是一個物件`)
        const { from, ...effect } = it
        effects.push(effect)
        // H14：依據的那段字要真的出現在它說的來源裡（只照成功程度給的不用引用）
        if (!isRecord(from) || typeof from.source !== 'string') return void errors.push(`${at}.from：H14 每一筆都要有依據（source 與 quote）`)
        if (from.source === 'degree') return
        const quote = typeof from.quote === 'string' ? from.quote.trim() : ''
        const haystack = from.source === 'judgment' ? `${input.judgment.reason}\n${input.judgment.twist}` : from.source === 'player' ? (input.pending.input.text ?? '') : null
        if (haystack === null) errors.push(`${at}.from.source：只能是 degree、judgment、player`)
        else if (!quote || !haystack.includes(quote)) errors.push(`${at}.from.quote：H14 依據的那段字沒有出現在${from.source === 'judgment' ? '判定' : '玩家的輸入'}裡`)
      })
      if (errors.length) return { ok: false, errors }
      const resolved = k.effects.resolve(effects, effectCtx(input, ctx.settings.clamp_asked, 'player'), 'reward.items')
      return resolved.errors.length ? { ok: false, errors: resolved.errors } : { ok: true, value: resolved, clamps: resolved.clamps }
    },
    // 退路：行動種類自己給的（ActionKindDef.fallback：規則表，照內建的來源驗，不受 AI 的上限管）；沒有就照參考範圍的一半，物品給模板的標準品（當成 AI 的來源夾）。
    // 參考範圍與規則表都是資料與程式寫的，照理一定合格；萬一套不上去（例：付不出來），退成什麼都不給
    fallback: (input) => {
      const own = kindFallback(k, input.state, input.pending, input.judgment, input.hint)
      const source = own ? 'builtin' : 'ai'
      const r = k.effects.resolve(own ?? fallbackReward(input.hint), effectCtx(input, true, source), 'reward.items')
      return r.errors.length ? k.effects.resolve([], effectCtx(input, true, source), 'reward.items') : r
    },
  }

  // 算關係：自由行動與戰鬥結束的鏈在場上有具名的人時都會跑這一步。AI 那一半（submit_relationship）要等關係的記憶與描述有地方存（M2-npc-life 之後），
  // 所以現在鏈對這個任務固定走退路（relateEnabled 回 false）：什麼都不記，步驟的狀態是 fallback。build 與 check 先寫好格式，AI 那一半接上時只改 relateEnabled 與 check。
  const relate: TaskDef<RelateInput, RelateOutput> = {
    id: 'relate', owner: 'shell', size: 'S', output: 'json', onExhausted: 'fallback',
    schema: { name: 'submit_relationship', schema: { type: 'object', required: ['items'], properties: { items: { type: 'array' } } } },
    build: (input) => ({
      system: '你讀這一次的結果，判斷在場的具名 NPC 和主角的關係怎麼變。只算這一次真的有互動的人，每一筆要有依據；用 submit_relationship 的格式交出。',
      sections: [['report', json(input.report)], ['cast', input.cast.map((c) => `${c.id}：${c.name}`).join('\n') || '（沒有）'], ['input', json(input)]],
    }),
    check: () => ({ ok: false, errors: ['算關係的 AI 那一半還沒接上，只收退路的結果'] }),
    fallback: () => ({ changes: [], lines: [] }),
  }

  const narrate: TaskDef<NarrateInput, NarrateOutput> = {
    id: 'narrate', owner: 'shell', size: 'L', output: 'text', onExhausted: 'wait',
    build: (input) => ({
      system: '照報告與定案的結果寫這一段正文。<results> 的每一行都要寫到，不寫 <results> 以外的收穫；擲骰與數值不寫進文字。正文的最後一行寫 <covered>，列出寫到的 <results> 編號，用逗號隔開。',
      sections: [['mode', input.mode], ['report', json(input.report)], ['results', numbered(input.results)], ['input', json(input)]],
    }),
    check: (raw, input) => checkProse(raw, input.results),
    // 不寫正文，只顯示報告的摘要
    fallback: () => ({ uncovered: [] }),
  }

  const polish: TaskDef<NarrateInput & { text: string }, NarrateOutput> = {
    id: 'polish', owner: 'shell', size: 'L', output: 'text', onExhausted: 'fallback',
    build: (input) => ({
      system: '只改文字，不改任何結果。<results> 的每一行照樣要在；最後一行寫 <covered>。',
      sections: [['text', input.text], ['results', numbered(input.results)], ['input', json(input)]],
    }),
    check: (raw, input) => checkProse(raw, input.results),
    fallback: (input) => ({ text: input.text, uncovered: [] }),
  }

  tasks.register(judge)
  tasks.register(reward)
  tasks.register(narrate)
  tasks.register(polish)
  tasks.register(relate)
}

/** 算關係這一步要不要問 AI：AI 那一半還沒做，固定不問（見 registerFreeActionTasks 的 relate）。 */
export const relateEnabled = false

function narrateInput(ctx: ChainCtx, mode: string): NarrateInput {
  const pending = ctx.draft.roll as ActionPending
  const { judgment } = ctx.draft.judge as JudgeOutput
  const reward = ctx.draft.reward as ResolvedEffects
  const def = ctx.k.actions.get(pending.input.kind)!
  return {
    mode,
    report: {
      kind: def.reportKind, action: def.name, actor: ctx.state.actors[pending.actor]!.name, ...(pending.input.text ? { input: pending.input.text } : {}),
      degree: DEGREE_NAME[judgment.degree], verdict: VERDICT_NAME[judgment.roll.verdict], reason: judgment.reason, twist: judgment.twist, minutes: judgment.minutes,
    },
    results: reward.lines,
  }
}

/** 自由行動的鏈。 */
export function freeActionChain(): ChainDef {
  return {
    template: FREE_ACTION_TEMPLATE,
    code: 'free',
    hasText: true,
    rerollable: ['roll'],
    codeSteps: {
      roll_check: (ctx) => {
        // 重擲時把之前每一次的骰面帶著走
        let pending = prepareAction(ctx.k, ctx.state, ctx.input as ActionInput)
        for (let i = 0; i < (ctx.rerolls.roll ?? 0); i++) pending = prepareAction(ctx.k, ctx.state, ctx.input as ActionInput, i + 1, [...pending.history, pending.roll.natural])
        return pending
      },
      reward_hint: (ctx) => rewardHint(ctx.k, ctx.state, ctx.draft.roll as ActionPending, (ctx.draft.judge as JudgeOutput).judgment),
    },
    whens: {
      // 新的人要等名冊與 NPC 的生成（M2）；在那之前即使判定說會帶出新的人也不跑
      new_person: (ctx) => !!(ctx.draft.judge as JudgeOutput | undefined)?.judgment.newPerson && ctx.k.features.includes('roster'),
      // 在場有具名的 NPC 才算關係；NPC 與場景在 M2
      cast_present: (ctx) => ctx.k.features.includes('npcs') && Object.values(ctx.state.actors).some((a) => a.role === 'npc'),
    },
    aiEnabled: (step, ctx) => {
      switch (step.task) {
        case 'judge': return ctx.settings.judge_free
        case 'narrate': return ctx.settings.narrate
        case 'polish': return ctx.settings.narrate && !!(ctx.draft.text as NarrateOutput | undefined)?.text
        // 這種行動算回報只照規則（ActionKindDef.rewardByRules）：不問 AI，直接走退路
        case 'reward': return !rewardByRules(ctx.k, (ctx.draft.roll as ActionPending).input.kind)
        case 'relate': return relateEnabled
        default: return true
      }
    },
    aiInput: (step, ctx) => {
      const pending = ctx.draft.roll as ActionPending
      if (step.task === 'judge') return { state: ctx.state, pending } satisfies JudgeInput
      if (step.task === 'relate') return { cast: castOf(ctx.state), report: { action: ctx.k.actions.get(pending.input.kind)?.name ?? pending.input.kind, input: pending.input.text ?? '' } } satisfies RelateInput
      const { judgment } = ctx.draft.judge as JudgeOutput
      // 算回報驗證用的狀態先套上行動的起手變更（ActionKindDef.prelude）
      if (step.task === 'reward') return { state: actionPrelude(ctx.k, ctx.state, pending.input).after, pending, judgment, hint: ctx.draft.hint as Effect[] } satisfies RewardInput
      if (step.task === 'narrate') return narrateInput(ctx, step.mode ?? 'new')
      if (step.task === 'polish') return { ...narrateInput(ctx, 'polish'), text: (ctx.draft.text as NarrateOutput).text ?? '' }
      throw new Error(`自由行動的鏈不認得 ${String(step.task)} 這個任務`)
    },
    apply: (ctx) => {
      const pending = ctx.draft.roll as ActionPending
      const judged = ctx.draft.judge as JudgeOutput
      const text = (ctx.draft.polish as NarrateOutput | undefined) ?? (ctx.draft.text as NarrateOutput | undefined)
      return buildActionReport(ctx.k, ctx.state, {
        pending, judgment: judged.judgment, reward: ctx.draft.reward as ResolvedEffects, judgeClamps: judged.clamps,
        ...(text?.text ? { text: text.text, uncovered: text.uncovered } : {}),
      })
    },
  }
}
