// L6 功能 drugs 的抑制劑帳單（DOWNTIME 3.4、5.1 節；CYBERWARE 第 2 節；dev/adr/0019 P20；dev/work/M4-drugs.md 第 7 點）。
// 主角 suppressant.weekly 開著，每週帳單多一行（bill.collect，第 3 項、帳戶、價錢 drug_rule.suppressant.price）。
// 付了（bill.settled：這一項沒有欠、沒有被停掉）：suppressant.until 設到下一個週一（這個週一 ＋ 一週）。
// 沒付：如果上一週有吃（until 還蓋到這個週一），rebound_until 設到這個週一 ＋ rebound_days 天。反彈期間再付：下限 −10 照給，反彈照跑完。
// 吃一劑 suppressant: true 的物品等於付了這一週（dose.ts）。生效中與反彈中的數字在 passive.ts。
// 掛點 bill.collect、bill.settled 是 features/bills 宣告的：這裡只認名字與格式，不 import。

import type { ActorId, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, formatAmount, weeklyRule } from '../../core'
import type { SuppressantRow } from './model'
import { OWNER, SUPPRESSANT_ACTION, SUPPRESSANT_BILL_ID, SUPPRESSANT_BILL_ORDER, DAY, drugRules, mondayOf, readDrugs, writeDrugs } from './model'

type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

interface SettledLine {
  id: string
  owner: string
  kind: string
  paid: number
  unpaid: number
  skipped?: true
}

/** 抑制劑歸誰：帳單是主角的。 */
const subject = (state: GameState): ActorId | null => (state.pc && state.actors[state.pc] ? state.pc : null)

export function installBills(k: Kernel): void {
  const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
  on('bill.collect', OWNER, (({ state }: { state: GameState }) => {
    const pc = subject(state)
    if (!pc || readDrugs(state, pc).suppressant?.weekly !== true) return undefined
    return [{ id: SUPPRESSANT_BILL_ID, owner: OWNER, name: '抑制劑', kind: 'due', amount: drugRules(k).suppressant.price, order: SUPPRESSANT_BILL_ORDER, pay: 'cred' }]
  }) as never)
  on('bill.settled', OWNER, (({ state, week, lines }: { state: GameState; week: number; lines: SettledLine[] }) => {
    const line = lines.find((l) => l.owner === OWNER && l.id === SUPPRESSANT_BILL_ID && l.kind === 'due')
    const pc = subject(state)
    if (!line || !pc) return undefined
    const d = readDrugs(state, pc)
    const monday = mondayOf(k, week)
    const paid = line.unpaid <= 0 && line.skipped !== true
    const s: SuppressantRow = { ...(d.suppressant ?? {}) }
    if (paid) s.until = Math.max(s.until ?? 0, monday + weeklyRule(k.timeRules).every)
    else if (s.until !== undefined && s.until >= monday) s.rebound_until = Math.max(s.rebound_until ?? 0, monday + drugRules(k).suppressant.rebound_days * DAY)
    else return undefined
    d.suppressant = s
    return [writeDrugs(pc, d)] as Change[]
  }) as never)
}

export interface SuppressantOpts {
  /** 誰的帳單（預設主角；帳單只收主角的） */
  actor?: ActorId
  /** 開（每週帳單付抑制劑）或關 */
  weekly: boolean
}

/** 現在能不能改這個開關：回傳原因（一句）；行是 null。 */
export function suppressantBlock(k: Kernel, state: GameState, o: SuppressantOpts): string | null {
  const actor = o.actor ?? state.pc
  if (!actor || !state.actors[actor]) return '找不到這個角色。'
  if (state.battle) return '戰鬥中不能改帳單的設定。'
  const act = k.activity.blockOf(state, `commit:${SUPPRESSANT_ACTION}`)
  if (act) return act
  if (actor !== state.pc) return '每週帳單只收主角的抑制劑。'
  return null
}

/** 開關「每週帳單付抑制劑」。不成立丟 ActionBlocked。報告 drug.suppressant。 */
export function suppressantDraft(k: Kernel, state: GameState, o: SuppressantOpts): ReportDraft {
  const why = suppressantBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const actor = o.actor ?? state.pc!
  const d = readDrugs(state, actor)
  d.suppressant = { ...(d.suppressant ?? {}) }
  if (o.weekly) d.suppressant.weekly = true
  else delete d.suppressant.weekly
  const price = drugRules(k).suppressant.price
  const text = o.weekly ? `每週帳單開始付抑制劑（一週 ${formatAmount(price)}）。` : '每週帳單不再付抑制劑；停藥之後會有反彈。'
  return {
    kind: 'action', action: SUPPRESSANT_ACTION, location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text, tag: SUPPRESSANT_ACTION, data: { weekly: o.weekly, price } }],
    changes: [writeDrugs(actor, d)], outcome: { result: o.weekly ? 'on' : 'off', summary: text }, narration: { results: [text] },
  }
}
