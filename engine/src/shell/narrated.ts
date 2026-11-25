// L7 外殼：「結算之後寫正文」的通用任務鏈 narrated（dev/adr/0016 第二節；工單 M2-core-shell）。
//
//   給定的草稿（功能用純函式算好的結算）→ 寫正文（narrate；草稿帶 adult 時走成人路由）→（潤色）→ 套用
//
// 功能只交報告草稿，不各開一條鏈：M2 的移動、交易、休息、事件、打工、副本的階段、場景的結束都走 Game.commitNarrated。
// 草稿原樣套用，只多一段正文（narration.text）；AI 關著、或設定關掉寫正文時沒有正文，其餘完全一樣。
// 要 judge 的（NPC 互動、事件的「我要做別的」）不走這條，走自己的鏈（free_action）。

import type { GameState, ReportDraft } from '../core/types'
import { clone } from '../core/util/clone'
import { clipBeats } from './battle'
import type { ChainCtx, ChainDef, ChainTemplate } from './ai/chain'
import type { NarrateInput, NarrateOutput } from './ai/freeAction'

/** 這條鏈的 id。 */
export const NARRATED_CHAIN = 'narrated'

export const NARRATED_TEMPLATE: ChainTemplate = {
  chain: NARRATED_CHAIN,
  steps: [
    { id: 'text', kind: 'ai', task: 'narrate' },
    { id: 'apply', kind: 'apply' },
  ],
}

/** 這條鏈的輸入。mode 是寫正文的模式（new、continue、rewrite……，AI_TASKS 3.1 節），由呼叫的功能決定。 */
export interface NarratedInput {
  draft: ReportDraft
  mode: string
  /** 玩家寫的寫法指令（戰敗事件的正文；最多 200 字）：原樣放進寫正文的 <direction>，不篩選、不改寫、不提示（使用者 2026-11-25） */
  direction?: string
}

/** 寫正文收到的輸入：報告的摘要（成人的報告帶 adult）、定案的結果、玩家的寫法指令（有才有）。戰鬥結束與場景結束的鏈也用它。 */
export function narrateInputOf(state: GameState, draft: ReportDraft, mode: string, direction?: string): NarrateInput {
  const actor = draft.actor ? state.actors[draft.actor]?.name : undefined
  return {
    mode,
    report: {
      kind: draft.kind, ...(draft.action ? { action: draft.action } : {}), ...(actor ? { actor } : {}),
      outcome: draft.outcome.result, summary: draft.outcome.summary, party: draft.party, timeline: clipBeats(draft.timeline.map((b) => b.text)),
      ...(draft.adult ? { adult: true } : {}),
    },
    // 定案的結果：功能自己寫在草稿上的（narration.results）；沒有就是沒有，正文只照報告的摘要與經過寫
    results: draft.narration?.results ?? [],
    ...(direction ? { direction } : {}),
  }
}

function narrateInput(ctx: ChainCtx, mode: string): NarrateInput {
  const { draft, direction } = ctx.input as NarratedInput
  return narrateInputOf(ctx.state, draft, mode, direction)
}

export function narratedChain(): ChainDef {
  return {
    template: NARRATED_TEMPLATE,
    code: NARRATED_CHAIN,
    hasText: true,
    codeSteps: {},
    aiEnabled: (step, ctx) => (step.task === 'narrate' ? ctx.settings.narrate : step.task === 'polish' ? ctx.settings.narrate && !!(ctx.draft.text as NarrateOutput | undefined)?.text : true),
    // 草稿帶 adult：寫正文走成人路由（請求帶 adult 記號）；其餘規則不因它而不同
    adult: (ctx) => !!(ctx.input as NarratedInput).draft.adult,
    aiInput: (step, ctx) => {
      const { mode } = ctx.input as NarratedInput
      if (step.task === 'narrate') return narrateInput(ctx, step.mode ?? mode)
      if (step.task === 'polish') return { ...narrateInput(ctx, 'polish'), text: (ctx.draft.text as NarrateOutput).text ?? '' }
      throw new Error(`narrated 這條鏈不認得 ${String(step.task)} 這個任務`)
    },
    apply: (ctx) => {
      const { draft } = ctx.input as NarratedInput
      const text = (ctx.draft.polish as NarrateOutput | undefined) ?? (ctx.draft.text as NarrateOutput | undefined)
      const out = clone(draft)
      if (text?.text) out.narration = { ...out.narration, text: text.text, ...(text.uncovered.length ? { uncovered: text.uncovered } : {}) }
      return out
    },
  }
}
