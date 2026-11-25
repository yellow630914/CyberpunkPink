// L6 功能：行動種類。把資料裡的每一筆 action_kind 註冊成核心的行動種類（AI_TASKS 3.1 節；CORE_RULES 第 3 節）。
// 內容載入之後才跑（ready）：先檢查格式與引用，再註冊。

import type { ActionHint, ActionKindEntry, Feature, Grade, Kernel } from '../../core'
import { actionKindToDef, blankState } from '../../core'

/** 自由行動的鏈（AI_TASKS 3.1 節）：沒有寫 chain 的行動種類走這一條 */
const FREE_CHAIN = 'free_action'
/** 可能進成人場景的行動的鏈（AI_TASKS 3.5 節）：誘惑 flirt。外殼的 Game.act 看 ActionKindDef.chain 轉過去（M4-followups-2 第 7 項） */
const ADULT_CHAIN = 'adult_action'

function check(k: Kernel, e: ActionKindEntry): void {
  const fail = (why: string): never => {
    throw new Error(`行動 ${e.id}：${why}`)
  }
  if (e.skill && !k.content.has('skill', e.skill)) fail(`沒有 ${e.skill} 這項基本功`)
  if (e.requires !== undefined) {
    const problems = k.conditions.validate(e.requires, 'requires')
    if (problems.length > 0) fail(problems.join('；'))
  }
  // 寫了 owner 的那一筆，參考範圍由那個功能自己檢查（它可以寫 '$target' 這類執行時才換的占位，這裡照字面驗會誤判）；基本功與條件照樣在這裡驗
  if (e.owner !== undefined) return
  const ctx = { state: blankState(0), actor: 'pc', grade: 1 as Grade, source: 'builtin', clampAsked: true, content: k.content } as Parameters<Kernel['effects']['validate']>[1]
  const tables: Array<[string, ActionHint | undefined]> = [['hint', e.hint], ...Object.entries(e.hint_by_grade ?? {}).map(([g, t]): [string, ActionHint] => [`hint_by_grade.${g}`, t])]
  for (const [name, table] of tables) {
    for (const [degree, list] of Object.entries(table ?? {})) {
      const problems = k.effects.validate(list, ctx, `${name}.${degree}`)
      if (problems.length > 0) fail(problems.join('；'))
    }
  }
}

export const actionsFeature: Feature = {
  id: 'actions',
  install() {},
  ready(k) {
    const entries = k.content.list<ActionKindEntry>('action_kind')
    for (const e of entries) check(k, e)
    // 走 adult_action 的種類（誘惑）現在註冊成可以做的行動（M4-followups-2 第 7 項：那條鏈在 M4 搬進來了）；走其他沒聽過的鏈的種類先只是資料。
    // 寫了 owner 的那一筆留給那個功能自己註冊（它要加照對象算的 DC、每天的次數）：這裡不註冊。
    // 那個功能用核心的 actionKindToDef(e, k, 自己的 id) 把資料轉成定義，再加上自己的東西。
    // 資料裡的 free 取代核心內建的預設（核心的登錄表允許）
    for (const e of entries) if (e.owner === undefined && (e.chain === undefined || e.chain === FREE_CHAIN || e.chain === ADULT_CHAIN)) k.actions.register(actionKindToDef(e, k))
  },
}
