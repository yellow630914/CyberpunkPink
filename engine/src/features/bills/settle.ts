// L6 功能 bills 的入口：週一 06:00 的結算（time.passed）、週日 20:00 的提醒、玩家改設定。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
// 規格：DOWNTIME 第 5 節；dev/adr/0016 第六節與 G3；dev/work/M2-bills.md。

import type { Change, ContentEntry, GameState, GameTime, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, crossings, fromMinutes, toMinutes, weeklyCrossings, weeklyRule } from '../../core'
import type { BillLine, PlanLine, SettledLine, WeekPlan } from './model'
import { STEPS, STEP_TEXT, billPreview, billRules, currentLines, planWeek, readBills, writeBills } from './model'

// ---- 掛點（兩邊不互相 import：型別用 declare module 補在核心的掛點表上；別的功能直接 hooks.on 這兩個名字） ----

declare module '../../core' {
  interface HookMap {
    /** 每週結算時問：這一週要收要付什麼（房租、義體訂閱、抑制劑、小隊的薪水……）。回傳項目的陣列；沒有就不回傳。 */
    'bill.collect': [{ state: GameState; week: number }, BillLine[] | void]
    /** 結算完問：哪幾筆沒付成。每一項帶 paid、unpaid（付了多少、欠多少）、skipped（玩家停掉的或寬限中的）。回傳的變更併進結算的那一份報告。 */
    'bill.settled': [{ state: GameState; week: number; lines: Array<BillLine & { paid: number; unpaid: number; skipped?: true }> }, Change[] | void]
  }
}

const draftOf = (state: GameState, action: string, changes: Change[], result: string, summary: string, extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'downtime', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes, outcome: { result, summary }, ...extra,
})

/** 掛點收到的那一份：把只有這個功能自己用的欄位拿掉。 */
const settledOf = (l: PlanLine): SettledLine => ({
  id: l.id, owner: l.owner, name: l.name, kind: l.kind, amount: l.amount, order: l.order, pay: l.pay, paid: l.paid, unpaid: l.unpaid, ...(l.skipped ? { skipped: true as const } : {}),
})

function lineText(l: PlanLine): string {
  if (l.kind === 'income') return `${l.name}：入帳 ${l.paid}。`
  if (l.skipped) return l.why === 'grace' ? `${l.name}：寬限中，這週不收。` : `${l.name}：你停掉了，不付也不算欠。`
  if (l.unpaid > 0) return `${l.name}：沒付成，欠 ${l.unpaid}。`
  return `${l.name}：付了 ${l.paid}。`
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/** 一週的結算變成一份 downtime 報告（bill.settle）：每一項付了多少、欠多少；bill.settled 回傳的變更接在後面。 */
export function settleDraft(k: Kernel, state: GameState, plan: WeekPlan): ReportDraft {
  const changes: Change[] = [...plan.changes]
  for (const { owner, result } of k.hooks.run('bill.settled', { state, week: plan.week, lines: plan.lines.map(settledOf) })) {
    const list = result as unknown
    if (!Array.isArray(list) || list.some((c) => typeof c !== 'object' || c === null || typeof (c as Change).op !== 'string')) throw new Error(`bill.settled：${owner} 回傳的不是變更的陣列（每一筆要有 op）`)
    changes.push(...(clone(list) as Change[]))
  }
  const dues = plan.lines.filter((l) => l.kind === 'due')
  const incomeTotal = sum(plan.lines.filter((l) => l.kind === 'income').map((l) => l.paid))
  const lines = plan.lines.map(lineText)
  const parts = [`第 ${plan.week} 週帳單：`]
  if (incomeTotal > 0) parts.push(`收入 ${incomeTotal}，`)
  parts.push(`付了 ${sum(dues.map((l) => l.paid))}`)
  if (plan.short) {
    const names = dues.filter((l) => l.unpaid > 0).map((l) => l.name)
    parts.push(`，${names.join('、')}沒付成（欠 ${sum(dues.map((l) => l.unpaid))}）。欠繳 ${plan.overdue} 週：${STEP_TEXT[STEPS[Math.min(plan.overdue, STEPS.length) - 1]!]}。`)
  } else {
    parts.push('。')
  }
  if (plan.merged) {
    const name = k.content.get<ContentEntry & { name?: string }>('faction', plan.merged.to)?.name ?? plan.merged.to
    const text = `你的欠款併成了一筆 ${plan.merged.principal} 的債，債主是${name}。`
    parts.push(text)
    lines.push(text)
  }
  const timeline: TimelineBeat[] = plan.lines.map((l, i) => ({
    layer: 'meat', text: lines[i]!, tag: 'bill.line',
    data: { id: l.id, owner: l.owner, name: l.name, kind: l.kind, amount: l.amount, order: l.order, pay: l.pay, paid: l.paid, unpaid: l.unpaid, ...(l.skipped ? { skipped: true } : {}) },
  }))
  return draftOf(state, 'bill.settle', changes, plan.short ? 'short' : 'paid', parts.join(''), {
    timeline, narration: { results: lines }, triggers: [{ point: 'weekly', where: { overdue: plan.overdue } }],
  })
}

const inCommission = (k: Pick<Kernel, 'activity'>, state: GameState): boolean => k.activity.active(state).some((a) => a.kind === 'commission')

/** 人在副本裡跨過週一：只記成到期（G3），出來之後的下一次 time.passed 才結。 */
const dueDraft = (state: GameState, due: number[], weeks: number): ReportDraft => {
  const b = readBills(state)
  b.due = due
  return draftOf(state, 'bill.due', [writeBills(b)], 'deferred', `人在副本裡，${weeks} 週的帳單先記著，出來之後再結。`)
}

/**
 * time.passed（順序 10）：每跨過一個週一 06:00 結一次，一次跨好幾週就一週一週結（每週一份報告）。
 * 人在副本裡（有 commission 這種活動在進行）時不結，記成到期；出來之後的下一次時間往前走才結。
 * 沒有項目、也沒有欠繳要清的週不出報告。週日 20:00 出一份提醒（bill.notice），一次睡過去就不出。
 */
export function weeklyDrafts(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const bills = readBills(state)
  const crossed = weeklyCrossings(from, to, k.timeRules).map(toMinutes)
  const queue = [...new Set([...bills.due, ...crossed])].sort((a, b) => a - b)
  const out: ReportDraft[] = []
  if (queue.length > 0) {
    if (inCommission(k, state)) {
      if (crossed.length > 0) out.push(dueDraft(state, queue, queue.length))
      return out
    }
    const rules = billRules(k)
    const run = queue.slice(-rules.max_catch_up)
    let sim = state
    run.forEach((m, i) => {
      const simBills = readBills(sim)
      const plan = planWeek(k, sim, fromMinutes(m))
      if (plan.lines.length === 0 && simBills.due.length === 0 && simBills.overdue === 0) return
      const draft = settleDraft(k, sim, plan)
      out.push(draft)
      if (i < run.length - 1) {
        sim = clone(sim)
        k.changes.applyAll(sim, draft.changes)
      }
    })
    return out
  }
  const notice = noticeDraft(k, state, from, to)
  return notice ? [notice] : []
}

// ---- 週日晚上的提醒 ----

const NOTICE_BEFORE = 10 * 60

/** 週日 20:00（週一 06:00 的前 10 小時）走過、而週一還沒到：出一份提醒「明天要付多少、帳戶夠不夠」。沒有要付的就不出。 */
function noticeDraft(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft | null {
  const rule = weeklyRule(k.timeRules)
  const marks = crossings(from, to, { every: rule.every, offset: rule.offset - NOTICE_BEFORE })
  const last = marks[marks.length - 1]
  if (!last || toMinutes(to) >= toMinutes(last) + NOTICE_BEFORE) return null
  const p = billPreview(k, state)
  const dues = p.lines.filter((l) => l.kind === 'due' && !l.skipped && l.amount > 0)
  if (dues.length === 0) return null
  const parts: string[] = [`明天（第 ${p.week} 週）要付：${dues.map((l) => `${l.name} ${l.amount}`).join('、')}，`]
  const need = (pool: 'cred' | 'cash', label: string): string | null => {
    const m = p.money[pool]
    if (m.due === 0) return null
    return m.enough ? `${label}有 ${m.have}${m.income > 0 ? `（收入 ${m.income} 入帳後）` : ''}，付得起` : `${label}不夠，差 ${m.short}`
  }
  parts.push([need('cred', '帳戶'), need('cash', '現金')].filter((x): x is string => x !== null).join('；'))
  if (p.stopsAt !== null) parts.push(`。會停在「${p.lines.find((l) => l.id === p.stopsAt)!.name}」`)
  parts.push('。')
  return draftOf(state, 'bill.notice', [], p.stopsAt === null ? 'enough' : 'short', parts.join(''))
}

// ---- 玩家改設定 ----

export interface BillSetting {
  /** 用現金付（只有收現金的項目：pay 是 either） */
  cash?: boolean
  /** 這一項不付了：不付也不算欠 */
  stopped?: boolean
}

/** 玩家設一個項目：用現金付、或這一項不付了。查不到這一項、收入、不收現金的項目丟 ActionBlocked。 */
export function setBill(k: Pick<Kernel, 'hooks' | 'content' | 'meters' | 'timeRules'>, state: GameState, item: string, patch: BillSetting): ReportDraft {
  const line = currentLines(k, state).find((l) => l.id === item)
  if (!line) throw new ActionBlocked(`這一週沒有「${item}」這一項帳單。`)
  if (line.kind === 'income') throw new ActionBlocked(`${line.name}是收入，沒有什麼好設的。`)
  if (patch.cash === true && line.pay !== 'either') throw new ActionBlocked(`${line.name}不收現金，只能${line.pay === 'cash' ? '付現金' : '扣帳戶'}。`)
  const b = readBills(state)
  const texts: string[] = []
  if (patch.cash !== undefined) {
    b.cash = b.cash.filter((x) => x !== item)
    if (patch.cash) b.cash.push(item)
    texts.push(patch.cash ? `${line.name}改用現金付。` : `${line.name}改回扣帳戶。`)
  }
  if (patch.stopped !== undefined) {
    b.stopped = b.stopped.filter((x) => x !== item)
    if (patch.stopped) b.stopped.push(item)
    texts.push(patch.stopped ? `${line.name}不付了（不算欠款）。` : `${line.name}照常付。`)
  }
  if (texts.length === 0) throw new ActionBlocked('要設用現金付，或這一項不付了。')
  return draftOf(state, 'bill.set', [writeBills(b)], 'set', texts.join(''))
}
