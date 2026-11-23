// L5 行動核心：把資料裡的一筆行動種類（action_kind）轉成核心的行動種類定義（ActionKindDef）。
//
// 本來是 features/actions 私有的 toDef；寫了 owner 的那一筆由那個功能自己註冊（dev/adr/0016、M2-core-activity 第 6 點），
// 它們要加照對象算的 DC、每天的次數，但「資料轉定義」的部分（條件、擋住時的句子、參考範圍）不該各寫一份，所以搬到核心共用。

import type { Grade, GameState } from '../types'
import { clone } from '../util/clone'
import type { ActionHint, ActionKindEntry } from '../content/kinds'
import type { Condition } from '../rules/conditions'
import type { Effect } from '../rules/effects'
import type { ActionKernel } from './action'
import type { ActionInput, ActionKindDef, HintCtx } from './kinds'

const GRADES: readonly Grade[] = [1, 2, 3, 4, 5]

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

/**
 * 一筆行動種類的資料 → 核心的定義：`requires` 與 `blocked_text` 變成 `block`（條件不成立時回傳那一句）、
 * `hint` 與 `hint_by_grade` 變成 `hint`（照等級往下找表）。
 * owner 是註冊它的功能的 id（預設 `actions`，也就是 features/actions）；寫了 `owner` 的資料由那個功能自己用這個函式註冊，
 * 再在回傳的定義上加它自己的東西（照對象算的 DC、每天的次數的 `block`……）。
 * 不檢查格式（引用的基本功、條件、效果存不存在）：載入內容之後由呼叫的功能先檢查。
 */
export function actionKindToDef(e: ActionKindEntry, k: ActionKernel, owner = 'actions'): ActionKindDef {
  const def: ActionKindDef = {
    id: e.id, owner, name: e.name, attr: e.attr, dc: e.dc,
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
