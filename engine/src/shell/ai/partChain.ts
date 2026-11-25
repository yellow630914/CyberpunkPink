// L7 外殼：任務鏈 part_unreg（未登錄零件交貨；AI_TASKS 3.20 節；dev/adr/0019 第十七節與 P71、P74；dev/work/M4-core-part-ai.md）。
//
//   讀框架 → 起名與怪癖（design_part）→ 組交貨的草稿（deliverDraft）→ 寫正文（narrate，短篇）→ 套用
//
// 3.20 節的六步：第 1 步（定框架）在零件加進「等著交貨」時就做完了，這條鏈只讀它（frameView）；第 2 步（訂做的檢定）目前沒有（P71）；
// 第 4 步（驗證）一半在 design_part 的 check（textProblems），一半在 deliverDraft（textProblems 與 frameProblems 再跑一次），所以「驗證」不另開一步。
// 交貨是明確的入口 Game.unregDeliver：外殼不在提交之後偷偷替玩家交貨（種子重播才對得上）。
// 套用之前什麼都不寫進存檔：框架是定好的，文字不論是 AI 交的或預設清單的，數字都一樣；AI 關著、失敗、被拒絕（softFail）時 design 那一步走退路（null），草稿不帶 text。

import type { ReportDraft } from '../../core/types'
import { ActionBlocked } from '../../core/action/action'
import { clone } from '../../core/util/clone'
import type { FrameView, UnregText } from '../../features/unreg'
import { deliverBlock, deliverDraft, frameView } from '../../features/unreg'
import { narrateInputOf } from '../narrated'
import type { ChainCtx, ChainDef, ChainTemplate } from './chain'
import type { NarrateOutput } from './freeAction'
import type { PartInput } from './partTask'
import { PART_TASK } from './partTask'
import { partAiOf } from './settings'

/** 這條鏈的 id。 */
export const PART_CHAIN = 'part_unreg'

/** 這條鏈的輸入：等著交貨的那一筆的 id（pending 的 id）。 */
export interface PartChainInput {
  id: string
}

export const PART_TEMPLATE: ChainTemplate = {
  chain: PART_CHAIN,
  steps: [
    { id: 'frame', kind: 'code', run: 'read_frame' },
    { id: 'design', kind: 'ai', task: PART_TASK, needs: ['frame'] },
    { id: 'deliver', kind: 'code', run: 'make_draft', needs: ['design'] },
    { id: 'text', kind: 'ai', task: 'narrate', needs: ['deliver'], mode: 'new' },
    { id: 'apply', kind: 'apply' },
  ],
}

const idOf = (ctx: ChainCtx): string => (ctx.input as PartChainInput).id

export function partChain(): ChainDef {
  return {
    template: PART_TEMPLATE,
    code: PART_CHAIN,
    hasText: true,
    codeSteps: {
      // 那一筆不在、或現在交不了（活動擋住、訂做的還沒到時候）：整條不成立，原因照給（ActionBlocked 讓 Game 回報 refused、狀態不動）
      read_frame: (ctx): FrameView => {
        const id = idOf(ctx)
        const block = deliverBlock(ctx.k, ctx.state, id)
        if (block) throw new ActionBlocked(block)
        const view = frameView(ctx.k, ctx.state, id)
        if (!view) throw new ActionBlocked('沒有這一件等著交貨的零件。')
        return view
      },
      // 文字是 null（走了退路）就不帶 text：交貨用預設清單的
      make_draft: (ctx): ReportDraft => {
        const text = ctx.draft.design as UnregText | null | undefined
        return deliverDraft(ctx.k, ctx.state, { id: idOf(ctx), ...(text ? { text } : {}) })
      },
    },
    // AI 開著的鏈才會走到這裡；單獨關掉 partAi 或寫正文時，那一步直接走退路
    aiEnabled: (step, ctx) => {
      if (step.task === PART_TASK) return partAiOf(ctx.settings)
      if (step.task === 'narrate') return ctx.settings.narrate
      if (step.task === 'polish') return ctx.settings.narrate && !!(ctx.draft.text as NarrateOutput | undefined)?.text
      return true
    },
    // 被服務商拒絕的 design_part 也直接走退路（交貨不能卡在一個名字上）
    softFail: (step) => step.task === PART_TASK,
    aiInput: (step, ctx) => {
      if (step.task === PART_TASK) return { state: ctx.state, view: ctx.draft.frame as FrameView } satisfies PartInput
      const draft = ctx.draft.deliver as ReportDraft
      if (step.task === 'narrate') return narrateInputOf(ctx.state, draft, step.mode ?? 'new')
      if (step.task === 'polish') return { ...narrateInputOf(ctx.state, draft, 'polish'), text: (ctx.draft.text as NarrateOutput).text ?? '' }
      throw new Error(`part_unreg 這條鏈不認得 ${String(step.task)} 這個任務`)
    },
    apply: (ctx) => {
      const out = clone(ctx.draft.deliver as ReportDraft)
      const text = (ctx.draft.polish as NarrateOutput | undefined) ?? (ctx.draft.text as NarrateOutput | undefined)
      if (text?.text) out.narration = { ...out.narration, text: text.text, ...(text.uncovered.length ? { uncovered: text.uncovered } : {}) }
      return out
    },
  }
}
