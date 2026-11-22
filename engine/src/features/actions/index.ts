// L6 功能：行動種類。把資料裡的每一筆 action_kind 註冊成核心的行動種類（AI_TASKS 3.1 節；CORE_RULES 第 3 節）。
// 內容載入之後才跑（ready）：先檢查格式與引用，再註冊。

import type { ActionHint, ActionInput, ActionKindDef, ActionKindEntry, Condition, Effect, Feature, GameState, Grade, HintCtx, Kernel } from '../../core'
import { blankState, clone } from '../../core'

const GRADES: Grade[] = [1, 2, 3, 4, 5]
/** 自由行動的鏈（AI_TASKS 3.1 節）：沒有寫 chain 的行動種類走這一條 */
const FREE_CHAIN = 'free_action'

function check(k: Kernel, e: ActionKindEntry): void {
  const fail = (why: string): never => {
    throw new Error(`行動 ${e.id}：${why}`)
  }
  if (e.skill && !k.content.has('skill', e.skill)) fail(`沒有 ${e.skill} 這項基本功`)
  if (e.requires !== undefined) {
    const problems = k.conditions.validate(e.requires, 'requires')
    if (problems.length > 0) fail(problems.join('；'))
  }
  const ctx = { state: blankState(0), actor: 'pc', grade: 1 as Grade, source: 'builtin', clampAsked: true, content: k.content } as Parameters<Kernel['effects']['validate']>[1]
  const tables: Array<[string, ActionHint | undefined]> = [['hint', e.hint], ...Object.entries(e.hint_by_grade ?? {}).map(([g, t]): [string, ActionHint] => [`hint_by_grade.${g}`, t])]
  for (const [name, table] of tables) {
    for (const [degree, list] of Object.entries(table ?? {})) {
      const problems = k.effects.validate(list, ctx, `${name}.${degree}`)
      if (problems.length > 0) fail(problems.join('；'))
    }
  }
}

/** 選表：從 grade 往下找第一個有表的等級（I 級是 hint，其他是 hint_by_grade 的鍵）。 */
function tableFor(e: ActionKindEntry, grade: Grade): ActionHint | undefined {
  for (let g = grade; g >= 1; g--) {
    const t = g === 1 ? e.hint : e.hint_by_grade?.[String(g)]
    if (t) return t
  }
  return undefined
}

function makeHint(e: ActionKindEntry): (ctx: HintCtx) => Effect[] {
  return (ctx) => {
    const table = tableFor(e, GRADES.includes(ctx.grade) ? ctx.grade : 1)
    if (!table) return []
    const list =
      ctx.degree === 'critical' ? table.critical
      : ctx.degree === 'success' ? (ctx.narrow ? (table.narrow ?? table.success) : table.success)
      : ctx.degree === 'fail' ? table.fail
      : table.fumble
    return list ? (clone(list) as unknown as Effect[]) : []
  }
}

function toDef(e: ActionKindEntry, k: Kernel): ActionKindDef {
  const def: ActionKindDef = {
    id: e.id, owner: 'actions', name: e.name, attr: e.attr, dc: e.dc,
    minutes: e.minutes, maxMinutes: e.max_minutes, reportKind: 'action',
    ...(e.skill ? { skill: e.skill } : {}),
    ...(e.tags ? { tags: [...e.tags] } : {}),
  }
  if (e.requires) {
    const cond = e.requires as unknown as Condition
    const text = e.blocked_text ?? null
    def.block = (state: GameState, _input: ActionInput) => (k.conditions.test(cond, { state, stats: k.stats, timeRules: k.timeRules }) ? null : text)
  }
  if (e.hint || e.hint_by_grade) def.hint = makeHint(e)
  return def
}

export const actionsFeature: Feature = {
  id: 'actions',
  install() {},
  ready(k) {
    const entries = k.content.list<ActionKindEntry>('action_kind')
    for (const e of entries) check(k, e)
    // 走別的任務鏈的種類（誘惑走 3.5 節的鏈……）先只是資料：那一條鏈搬進來之前不註冊成可以做的行動。
    // 資料裡的 free 取代核心內建的預設（核心的登錄表允許）
    for (const e of entries) if (e.chain === undefined || e.chain === FREE_CHAIN) k.actions.register(toDef(e, k))
  },
}
