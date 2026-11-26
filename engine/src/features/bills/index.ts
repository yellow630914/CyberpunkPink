// L6 功能：每週帳單（FIXER 第 4 節；DOWNTIME 第 5 節；EVENTS 2.2、2.4 節；BALANCE 7.4 節；UI 3.10 節；dev/adr/0016 第六、七節與 G3；dev/work/M2-bills.md）。
//
// 每週一 06:00 收入先入帳、再照順序扣款；付不出來的累計欠繳週數、走下坡；別的功能用兩個掛點把自己的項目接進來。
// 每一個項目本身是誰的就由誰算：房租（M2-rest-housing）、義體訂閱與抑制劑（M4）、小隊的薪水（roster）回答掛點 bill.collect，
// 沒付成的後果由它們自己聽 bill.settled 接。這個功能只管收集、順序、扣款、欠繳與債。
//
// 接上核心的地方：
//   內容  bill_rule（id: default，蓋掉內建的規則數字；格式見 model.ts 的 BillRules）
//   掛點  bill.collect、bill.settled（這個功能宣告，型別在 settle.ts；別的功能直接 hooks.on，不 import 這裡）
//   掛鉤  time.passed（順序 10）：週一 06:00 的結算、週日 20:00 的提醒；人在副本裡（commission 活動進行中）先記成到期，出來之後的下一次才結（G3）
//   變更  bills.tweak、bills.extra、bills.grace、bills.debt（效果用；其餘的狀態改動走 ext）
//   效果  bill：{ item, amount }（這一週那一項加減，不超過那一項的一半）或 { name, amount, weeks, pay }（加一個新的項目）；
//         grace：{ item, days }（寬限，最多 7 天）；debt：{ to, amount, rate }（一筆債，利息是表上第 5 項）
//   條件  bill_overdue { min }：欠繳週數不少於 min（預設 1）
//   狀態  state.ext.bills（形狀見 model.ts 的 BillsState）；旗標 bill_overdue（欠繳週數）、bill_step（下坡走到哪一步）給事件與之後的功能接
// 報告：bill.settle（downtime；每一項付了多少、欠多少，帶觸發點 weekly { overdue }）、bill.notice（週日晚上的提醒，不擋）、bill.set（玩家改設定）、bill.due（人在副本裡先記著）。
// 對外：billPreview、setBill、settleDraft、weeklyDrafts、planWeek、currentLines、readBills、billRules、overdueWeeks。
//
// 付不出來的後果（M4-followups；settle.ts 的 stepEffects）：欠繳第 1 週發效果 cyber_lock { on: true, why: 'debt' }（不給選擇器）、補繳之後 { on: false, why: 'debt' }、
//   第 4 週起發 contract_sign { holder: 規則表 debt_faction（預設 eden）, type: 'debt', debt: 欠的總額 }；效果沒人註冊就照舊只留旗標（bill_step）與觸發點。bill.settled 的行多 why（stopped、grace）。
//
// 不在這裡（DOWNTIME 第 5 節）：四個快捷的檔位（只有倍率）、換門鎖的後果（只留旗標與觸發點）、
// 帳戶被凍結、洗錢補差額、債的還款。

import type { Change, Condition, Effect, EffectCtx, EffectStepCtx, Feature, GameState, Kernel } from '../../core'
import { clone, effectLevel, formatAmount, isSafeInt, moneyCap, toMinutes } from '../../core'
import type { Debt, ExtraItem, PayWith, Pool } from './model'
import { EXT, OWNER, PAY_WITH, RULE_KIND, billRules, currentLines, debtPayOf, isText, readBills, ruleProblems } from './model'
import { weeklyDrafts } from './settle'

export { DEFAULT_BILL_RULES, STEPS, STEP_TEXT, billPreview, billRules, blankBills, collectLines, currentLines, nextMondayMinutes, planWeek, readBills, weekOf } from './model'
export type { BillLine, BillPreview, BillRules, BillsState, Debt, ExtraItem, PayWith, PlanLine, SettledLine, WeekPlan } from './model'
export { setBill, settleDraft, weeklyDrafts } from './settle'
export type { BillSetting } from './settle'

/** 現在欠繳幾週（沒裝這個功能、沒欠是 0）。 */
export const overdueWeeks = (state: Pick<GameState, 'ext'>): number => readBills(state).overdue

const store = (state: GameState, b: ReturnType<typeof readBills>): void => {
  state.ext[EXT] = clone(b) as unknown as Record<string, unknown>
}

interface BillEffect extends Effect { item?: string; amount: number; name?: string; weeks?: number; pay?: PayWith }
interface GraceEffect extends Effect { item: string; days: number }
interface DebtEffect extends Effect { to: string; amount: number; rate: number }

const sign = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

export const billsFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // ---- 變更（效果的結果；結算與玩家的設定整份寫 ext） ----
    k.changes.register<Change & { item: string; delta: number }>({
      op: 'bills.tweak', owner: OWNER,
      validate: (_s, c) => [...(isText(c.item) ? [] : ['item 要是帳單項目的 id']), ...(isSafeInt(c.delta) ? [] : ['delta 要是整數'])],
      apply(state, c) {
        const b = readBills(state)
        b.tweaks[c.item] = (b.tweaks[c.item] ?? 0) + c.delta
        store(state, b)
      },
      describe: (c) => `帳單：${c.item} 這一週 ${sign(c.delta)}`,
    })
    k.changes.register<Change & Omit<ExtraItem, 'id'>>({
      op: 'bills.extra', owner: OWNER,
      validate: (_s, c) => [
        ...(isText(c.name) ? [] : ['name 要是文字']), ...(isSafeInt(c.amount) && c.amount > 0 ? [] : ['amount 要是大於 0 的整數']),
        ...(isSafeInt(c.weeks) && c.weeks > 0 && c.weeks <= 520 ? [] : ['weeks 要是 1～520 的整數']), ...((PAY_WITH as readonly unknown[]).includes(c.pay) ? [] : ['pay 只能是 cred、cash 或 either']),
      ],
      apply(state, c) {
        const b = readBills(state)
        b.seq += 1
        b.extras.push({ id: `x${b.seq}`, name: c.name, amount: c.amount, weeks: c.weeks, pay: c.pay })
        store(state, b)
      },
      describe: (c) => `新的帳單項目：${c.name} ${c.amount}，${c.weeks} 週`,
    })
    k.changes.register<Change & { item: string; until: number }>({
      op: 'bills.grace', owner: OWNER,
      validate: (_s, c) => [...(isText(c.item) ? [] : ['item 要是帳單項目的 id']), ...(isSafeInt(c.until) && c.until >= 0 ? [] : ['until 要是 0 以上的整數（總分鐘）'])],
      apply(state, c) {
        const b = readBills(state)
        b.grace[c.item] = Math.max(b.grace[c.item] ?? 0, c.until)
        store(state, b)
      },
      describe: (c) => `帳單寬限：${c.item}`,
    })
    k.changes.register<Change & Omit<Debt, 'id'>>({
      op: 'bills.debt', owner: OWNER,
      validate: (_s, c) => [
        ...(isText(c.to) ? [] : ['to 要是勢力的 id']), ...(isSafeInt(c.principal) && c.principal > 0 ? [] : ['principal 要是大於 0 的整數']),
        ...(typeof c.rate === 'number' && Number.isFinite(c.rate) && c.rate >= 0 && c.rate <= 1 ? [] : ['rate 要是 0～1 的數字']), ...(c.pay === 'cred' || c.pay === 'cash' ? [] : ['pay 只能是 cred 或 cash']),
      ],
      apply(state, c) {
        const b = readBills(state)
        b.seq += 1
        b.debts.push({ id: `d${b.seq}`, to: c.to, principal: c.principal, rate: c.rate, pay: c.pay })
        store(state, b)
      },
      describe: (c) => `一筆新的債：${c.principal}（${c.to}）`,
    })

    // ---- 效果 ----
    k.effects.register<BillEffect>({
      kind: 'bill', owner: OWNER,
      validate(raw, ctx: EffectCtx) {
        const p: string[] = []
        if (!isSafeInt(raw.amount)) p.push('amount 要是整數')
        if (raw.item !== undefined) {
          if (!isText(raw.item)) p.push('item 要是帳單項目的 id')
          if (raw.name !== undefined || raw.weeks !== undefined || raw.pay !== undefined) p.push('加減一項（item）和新增一項（name、weeks、pay）只能寫一種')
          return p
        }
        if (!isText(raw.name)) p.push('新的項目要有 name')
        if (isSafeInt(raw.amount) && raw.amount <= 0) p.push('新的項目的 amount 要大於 0')
        if (!(isSafeInt(raw.weeks) && raw.weeks >= 1 && raw.weeks <= 520)) p.push('新的項目的 weeks 要是 1～520 的整數')
        if (!(PAY_WITH as readonly unknown[]).includes(raw.pay)) p.push('新的項目的 pay 只能是 cred、cash 或 either')
        // 格式的底線（B037）：金額乘週數也要是安全整數，不然之後累進欠款會溢位。AI 與開著時玩家要的那條路由 budget 把金額縮成上限，所以不在這裡擋
        if (isSafeInt(raw.amount) && isSafeInt(raw.weeks) && !Number.isSafeInteger(raw.amount * raw.weeks) && effectLevel({ ...raw, kind: 'bill' }, ctx) !== 'cap') p.push('新的項目的 amount 乘上 weeks 太大了，要是安全整數')
        return p
      },
      // AI 與設定開著時玩家要的新項目（EVENTS 2.4 節沒寫上限，照 cred 那一格：dev/adr/0017 第 17 項）：一件事裡新項目的總額（每週的金額 × 週數）合計
      // 不超過信譽那一階的錢的上限；超過的把期數縮短（金額不變），一期都付不起的把金額縮成上限、只收一期。內建的照寫的算
      budget(e, ctx) {
        if (e.item !== undefined || ctx.level !== 'cap') return null
        const cap = moneyCap({ content: ctx.content, grade: ctx.repGrade ?? 1 })
        // 金額乘週數可能大到不是安全整數（B037）：合計照最大的安全整數算，縮減才不失真
        const total = e.amount * (e.weeks ?? 1)
        return {
          group: 'bill_new', amount: Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER, min: -Infinity, max: cap,
          resize: (to) => (to < e.amount ? { ...e, amount: to, weeks: 1 } : { ...e, weeks: Math.floor(to / e.amount) }),
          notice: (to) => (to === 0 ? `新的帳單項目一次最多加起來 ${formatAmount(cap)}（每週的金額乘上週數），這一筆沒有算。` : `新的帳單項目一次最多加起來 ${formatAmount(cap)}（每週的金額乘上週數），這一筆縮短了。`),
        }
      },
      // 這一週沒有那一項整筆拿掉（引用的 id 要存在，四條路都一樣）；
      // 加減不超過那一項金額的一半（連同這一週已經加減的合計）只管 AI 與開著時玩家要的（ctx.level 是 cap）：內建的與關著且 asked 對得上的照寫的算（B034）
      clamp(e, ctx: EffectStepCtx) {
        if (e.item === undefined) return { effect: e }
        const line = currentLines(k, ctx.state).find((l) => l.id === e.item && l.kind === 'due')
        if (!line) return { effect: null, note: { from: e.amount, to: 0, notice: `這一週沒有「${e.item}」這一項帳單，沒有算。` } }
        if (ctx.level !== 'cap') return { effect: e }
        const half = Math.floor(line.raw * billRules(k).tweak_ratio)
        const current = readBills(ctx.state).tweaks[e.item] ?? 0
        const target = Math.max(-half, Math.min(half, current + e.amount))
        const amount = target - current
        if (amount === e.amount) return { effect: e }
        const notice = `${line.name}這一週最多只能加減原本金額的一半（${half}），多的沒有算。`
        return { effect: amount === 0 ? null : { ...e, amount }, note: { from: e.amount, to: amount, limit: half, notice } }
      },
      toChanges: (e) => (e.item !== undefined
        ? [{ op: 'bills.tweak', item: e.item, delta: e.amount }]
        : [{ op: 'bills.extra', name: e.name, amount: e.amount, weeks: e.weeks, pay: e.pay }]),
      describe(e, ctx) {
        if (e.item === undefined) return `帳單：新增${e.name}（${e.amount}，${e.weeks} 週）`
        const name = currentLines(k, ctx.state).find((l) => l.id === e.item)?.name ?? e.item
        return `帳單：${name} 這一週 ${sign(e.amount)}`
      },
    })

    k.effects.register<GraceEffect>({
      kind: 'grace', owner: OWNER,
      validate: (raw) => [...(isText(raw.item) ? [] : ['item 要是帳單項目的 id']), ...(isSafeInt(raw.days) && raw.days >= 1 ? [] : ['days 要是大於 0 的整數'])],
      // 這一週沒有那一項整筆拿掉（B035，四條路都一樣）；寬限最多幾天只管 AI 與開著時玩家要的（ctx.level 是 cap；B034）
      clamp(e, ctx: EffectStepCtx) {
        if (!currentLines(k, ctx.state).some((l) => l.id === e.item && l.kind === 'due')) return { effect: null, note: { from: e.days, to: 0, notice: `這一週沒有「${e.item}」這一項帳單，沒有算。` } }
        if (ctx.level !== 'cap') return { effect: e }
        const max = billRules(k).grace_max_days
        return e.days > max ? { effect: { ...e, days: max }, note: { from: e.days, to: max, limit: max, notice: `寬限最多 ${max} 天。` } } : { effect: e }
      },
      toChanges: (e, ctx) => [{ op: 'bills.grace', item: e.item, until: toMinutes(ctx.state.time) + e.days * 1440 }],
      describe: (e, ctx) => `帳單：${currentLines(k, ctx.state).find((l) => l.id === e.item)?.name ?? e.item} 寬限 ${e.days} 天`,
    })

    // debt 是併債與事件資料用的內部效果，不在 EVENTS 2.4 的清單裡：AI 與玩家要的結果不能用（ai: false）
    k.effects.register<DebtEffect>({
      kind: 'debt', owner: OWNER, ai: false,
      validate(raw, ctx: EffectCtx) {
        const p: string[] = []
        if (!isText(raw.to)) p.push('to 要是勢力的 id')
        else if (!ctx.content.has('faction', raw.to)) p.push(`to：查不到勢力 ${raw.to}`)
        if (!(isSafeInt(raw.amount) && raw.amount > 0)) p.push('amount 要是大於 0 的整數')
        if (!(typeof raw.rate === 'number' && Number.isFinite(raw.rate) && raw.rate >= 0 && raw.rate <= 1)) p.push('rate（週利率）要是 0～1 的數字')
        return p
      },
      toChanges(e) {
        const rules = billRules(k)
        return [{ op: 'bills.debt', to: e.to, principal: e.amount, rate: e.rate, pay: debtPayOf(rules, e.to) as Pool }]
      },
      describe: (e) => `一筆新的債：${e.amount}（週利率 ${Math.round(e.rate * 1000) / 10}%）`,
    })

    // ---- 條件：帳單有沒有欠（EVENTS 2.2 節） ----
    k.conditions.register<Condition & { min?: number }>({
      kind: 'bill_overdue', owner: OWNER,
      validate: (raw) => (raw.min === undefined || (isSafeInt(raw.min) && raw.min >= 1) ? [] : ['min 要是大於 0 的整數']),
      test: (c, ctx) => readBills(ctx.state).overdue >= (c.min ?? 1),
    })

    // ---- 結算（順序 10：帳單 10、敵對值的消退 12、名冊的每週 14、NPC 自己的日子 16、導演 20） ----
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = weeklyDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    }, 10)
  },
}

export { EXT as BILLS_EXT, OWNER as BILLS_OWNER, RULE_KIND as BILL_RULE_KIND }
