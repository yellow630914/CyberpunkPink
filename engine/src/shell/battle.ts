// L7 外殼：戰鬥結束的任務鏈（AI_TASKS 3.9 節「戰鬥結束」）。
//
//   戰鬥的結算（程式）→ 算關係（在場有具名的人才跑；M2）→ 寫正文（combat：照 timeline 寫）→ 套用
//
// 戰鬥中的每一步不經過任務鏈：玩家與 AI 的行動由程式結算，直接提交（Game.battleAct、Game.battleNext）；
// 寫正文預設不跑，戰鬥結束時整場寫一次。AI 關閉時只顯示戰報（報告的摘要）。

import type { ReportDraft } from '../core/types'
import { OUTCOME_NAME, endBattle } from '../core/battle/step'
import type { ChainDef, ChainTemplate } from './ai/chain'
import type { NarrateInput, NarrateOutput, RelateInput } from './ai/freeAction'
import { castOf, relateEnabled } from './ai/freeAction'

export const BATTLE_END_TEMPLATE: ChainTemplate = {
  chain: 'battle_end',
  steps: [
    { id: 'settle', kind: 'code', run: 'battle_settle' },
    { id: 'relate', kind: 'ai', task: 'relate', needs: ['settle'], when: 'cast_present' },
    { id: 'text', kind: 'ai', task: 'narrate', needs: ['settle', 'relate'], mode: 'combat' },
    { id: 'apply', kind: 'apply' },
  ],
}

/** 寫正文收到的 timeline 最多幾拍（太長時保留頭尾；AI_TASKS 3.9 節）。 */
export const NARRATE_BEATS = { head: 20, tail: 40 }

/** 寫正文收到的 timeline：太長時保留頭尾，中間寫「略過幾拍」（NARRATE_BEATS）。 */
export function clipBeats(beats: string[]): string[] {
  const { head, tail } = NARRATE_BEATS
  return beats.length <= head + tail ? beats : [...beats.slice(0, head), `（中間略過 ${beats.length - head - tail} 拍）`, ...beats.slice(-tail)]
}

export function battleEndChain(): ChainDef {
  return {
    template: BATTLE_END_TEMPLATE,
    code: 'combat',
    hasText: true,
    codeSteps: {
      battle_settle: (ctx) => endBattle(ctx.k, ctx.state),
    },
    whens: {
      // 算關係要等 NPC 與關係的系統（M2）
      cast_present: (ctx) => ctx.k.features.includes('npcs') && Object.values(ctx.state.battle?.units ?? {}).some((u) => !!u.actor && ctx.state.actors[u.actor]?.role === 'npc'),
    },
    aiEnabled: (step, ctx) => (step.task === 'narrate' ? ctx.settings.narrate : step.task === 'relate' ? relateEnabled : true),
    aiInput: (step, ctx) => {
      if (step.task === 'relate') {
        const draft = ctx.draft.settle as ReportDraft
        const fighters = new Set(Object.values(ctx.state.battle?.units ?? {}).flatMap((u) => (u.actor ? [u.actor] : [])))
        return { cast: castOf(ctx.state).filter((c) => fighters.has(c.id)), report: { action: '戰鬥', summary: draft.outcome.summary } } satisfies RelateInput
      }
      if (step.task !== 'narrate') throw new Error(`戰鬥結束的鏈不認得 ${String(step.task)} 這個任務`)
      const draft = ctx.draft.settle as ReportDraft
      const timeline = clipBeats(draft.timeline.map((b) => b.text))
      return {
        mode: step.mode ?? 'combat',
        // result 是結果給人看的名字（勝利、戰敗、脫離、投降）；outcome 是它的 id
        report: { kind: draft.kind, action: '戰鬥', outcome: draft.outcome.result, result: OUTCOME_NAME[draft.outcome.result] ?? draft.outcome.result, summary: draft.outcome.summary, party: draft.party, timeline },
        results: draft.narration?.results ?? [],
      } satisfies NarrateInput
    },
    apply: (ctx) => {
      const draft = ctx.draft.settle as ReportDraft
      const text = (ctx.draft.polish as NarrateOutput | undefined) ?? (ctx.draft.text as NarrateOutput | undefined)
      return {
        ...draft,
        narration: { ...draft.narration, ...(text?.text ? { text: text.text, ...(text.uncovered.length ? { uncovered: text.uncovered } : {}) } : {}) },
      }
    },
  }
}
