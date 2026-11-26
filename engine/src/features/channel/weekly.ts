// L6 功能 channel 的每週結算（MEDIA 4.8 節；dev/adr/0020 第二節、V12、V13、V15、V16；dev/work/M5-channel.md「要做的」第 5 項）。
// 週一 06:00（time.passed，順序 11：帳單 10 之後）：贊助撥款 → 流失 → 自然成長 → 推薦權重往 0 回一格 → 清掉這一週的計數 → 一份 channel.weekly，帶觸發點 channel_week。
// 它出自己的一份報告，不走 bill.collect：預算不是主角身上的錢（V15）。沒開頻道什麼都不做。
// 人在委託副本裡（k.activity.active 有 commission）時不結：出來之後的下一次 time.passed，把「上一次結算到現在」跨過的每一個週一一週一週補結
// （和帳單一樣只看 commission；潛入、簾後館、拍賣裡照常結）。「上一次結算到哪裡」記在 state.ext.channel.mark。
//
// 結算寫成一串步驟（WEEK_STEPS）：每一步看「前面的步驟都套上去之後」的狀態（ctx.now），把變更與給玩家看的句子推進去。
// 編制的薪水（wageStep）與線人帶回的素材（sourceStep）插在贊助撥款之後（MEDIA 4.8 節的順序：撥款、薪水、流失）：
// 薪水從預算扣（payFromBudget）；扣不到的記 unpaid_weeks，那一份報告的觸發點 where 帶 unpaid: true；沒領到薪水的線人那一週不帶素材。

import type { Change, GameState, GameTime, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { clone, deriveRng, effectCtx, fromMinutes, meterOf, toMinutes, weeklyCrossings } from '../../core'
import type { ChannelRules, ChannelState, Role } from './model'
import { CREDIBILITY, RECO, ROLES, ROLE_NAME, SUBS, WEEKLY_ACTION, WEEK_TRIGGER, channelRules, readChannel } from './model'
import { payFromBudget, poolName } from './budget'
import { actorName } from './staff'
import { MEDIA_TYPE_NAME } from './shows'

const money = (n: number): string => n.toLocaleString('en-US')

export interface WeekCtx {
  k: Kernel
  rules: ChannelRules
  /** 這一個週一（總分鐘） */
  at: number
  /** 這一週開始時的頻道（唯讀） */
  start: ChannelState
  /** 前面的步驟都套上去之後的狀態（複製；不是真的狀態） */
  now: GameState
  changes: Change[]
  lines: string[]
  beats: TimelineBeat[]
  /** 步驟留給報告用的數字（放進那一份報告的觸發點與 data） */
  data: Record<string, number>
  /** 這一週領到薪水的位子（沒有薪水的位子也算領到） */
  paid: Set<Role>
  /** 把一步的變更推進來：同時套在 now 上，下一步看得到 */
  push(changes: Change[], line?: string, tag?: string): void
}

export type WeekStep = (c: WeekCtx) => void

const subsNow = (c: WeekCtx): number => meterOf(c.k, c.now, SUBS)

/** 贊助撥款：每個金主倒數一週，到 0 就撥款進那個勢力的公帳、額度加撥款的 quota_pct %，倒數重設（MEDIA 4.2、4.8）。 */
export const sponsorStep: WeekStep = (c) => {
  for (const s of c.start.sponsors) {
    const left = s.weeks_left_to_pay - 1
    if (left > 0) {
      c.push([{ op: 'channel.sponsor_set', faction: s.faction, weeks_left_to_pay: left }])
      continue
    }
    const quota = Math.floor((s.amount * c.rules.quota_pct) / 100)
    c.push(
      [{ op: 'channel.budget', pool: s.faction, cred: s.amount, quota }, { op: 'channel.sponsor_set', faction: s.faction, weeks_left_to_pay: s.every_weeks }],
      `${poolName(c.k, s.faction)}的贊助撥來 ${money(s.amount)}，進了它的公帳，可支領額度 +${money(quota)}。`, 'channel.sponsor',
    )
    c.data.sponsored = (c.data.sponsored ?? 0) + s.amount
  }
}

/**
 * 編制的薪水（V15）：三個位子依序從預算扣（先公帳、再自有；payFromBudget）。扣不到的那一個記 unpaid_weeks +1、報告的觸發點帶 unpaid: true；
 * 領到了的，欠的週數歸零。
 */
export const wageStep: WeekStep = (c) => {
  for (const role of ROLES) {
    const s = readChannel(c.now).staff[role]
    if (!s) continue
    const name = actorName(c.now, s.who)
    const pay = payFromBudget(c.now, s.wage)
    if ('block' in pay) {
      c.push([{ op: 'channel.staff_set', role, unpaid_weeks: s.unpaid_weeks + 1 }], `預算不夠，付不出${name}（${ROLE_NAME[role]}）這一週的薪水。`, 'channel.unpaid')
      c.data.unpaid = (c.data.unpaid ?? 0) + 1
      continue
    }
    c.paid.add(role)
    c.push([...pay.changes, ...(s.unpaid_weeks > 0 ? [{ op: 'channel.staff_set', role, unpaid_weeks: 0 }] : [])], s.wage > 0 ? `付了${name}（${ROLE_NAME[role]}）這一週的薪水 ${money(s.wage)}。` : undefined, 'channel.wage')
    c.data.wages = (c.data.wages ?? 0) + s.wage
  }
}

/**
 * 線人每週帶回一段素材（MEDIA 4.5）：效果 footage，品質 q_min～q_max、類型從 source.types 照固定亂數挑（用這個週一的時間當用途，同一個狀態同一個結果）。
 * 沒有素材庫（沒有人註冊 footage）、或這一週沒領到薪水就不帶。
 */
export const sourceStep: WeekStep = (c) => {
  const s = readChannel(c.now).staff.source
  if (!s || !c.paid.has('source') || !c.k.effects.has('footage')) return
  const rng = deriveRng(c.now.rng, `channel.source/${c.at}`)
  const type = rng.pick(c.rules.source.types)
  const quality = rng.int(c.rules.source.q_min, c.rules.source.q_max)
  const fx = { kind: 'footage', type, quality, title: `線人帶回來的${MEDIA_TYPE_NAME[type] ?? type}畫面`, origin: 'staff' }
  const ctx = effectCtx(c.k, c.now, { source: 'builtin' })
  if (c.k.effects.validate([fx], ctx).length > 0) return
  const res = c.k.effects.resolve([fx], ctx)
  if (res.errors.length > 0) return
  c.data.source_quality = quality
  c.push(res.changes, `${actorName(c.now, s.who)}（線人）帶回來一段素材：${fx.title}。`, 'channel.source')
}

/**
 * 流失與自然成長（V12、V13）：這一週開過節目或直播（episodes + lives 大於 0）流失 churn.active %，否則 churn.idle %；
 * 另外加 訂閱 × 推薦權重 × reco_growth %（負的就是多流失）。兩個都照這一週開始時的訂閱算，各自往 0 的方向取整數（所以推薦權重 +2 剛好多 2%）。
 */
export const subsStep: WeekStep = (c) => {
  const subs = subsNow(c)
  const reco = meterOf(c.k, c.now, RECO)
  const active = c.start.week.episodes + c.start.week.lives > 0
  const rate = active ? c.rules.churn.active : c.rules.churn.idle
  const loss = Math.floor((subs * rate) / 100)
  const growth = Math.trunc((subs * reco * c.rules.reco_growth) / 100)
  c.data.loss = loss
  c.data.growth = growth
  c.push(loss > 0 ? [{ op: 'meter', kind: SUBS, key: '_', delta: -loss }] : [], loss > 0 ? `${active ? '這一週有開過節目或直播' : '這一週一集都沒開'}，流失了 ${money(loss)} 位訂閱。` : undefined, 'channel.loss')
  c.push(growth !== 0 ? [{ op: 'meter', kind: SUBS, key: '_', delta: growth }] : [], growth > 0 ? `平台的推薦帶來 ${money(growth)} 位新訂閱。` : growth < 0 ? `平台不推你，多流失了 ${money(-growth)} 位訂閱。` : undefined, 'channel.growth')
}

/** 推薦權重往 0 回一格（平台的記性一週；V13）。 */
export const recoStep: WeekStep = (c) => {
  const reco = meterOf(c.k, c.now, RECO)
  if (reco === 0) return
  const next = reco - Math.sign(reco)
  c.push([{ op: 'meter', kind: RECO, key: '_', delta: next - reco }], `平台對你的推薦權重往回收了一格（${reco > 0 ? '+' : ''}${reco} → ${next > 0 ? '+' : ''}${next}）。`, 'channel.reco')
}

/** 清掉這一週的計數、記下結算到這個週一。 */
export const clearStep: WeekStep = (c) => {
  c.push([{ op: 'channel.week', reset: true, mark: c.at }])
}

/** 結算的順序（MEDIA 4.8 節：贊助撥款、薪水、流失、事件）。 */
export const WEEK_STEPS: WeekStep[] = [sponsorStep, wageStep, sourceStep, subsStep, recoStep, clearStep]

/** 一個週一的結算：回報告草稿；state 要是上一週都套完之後的狀態。 */
export function settleWeek(k: Kernel, state: GameState, at: number): ReportDraft {
  const start = readChannel(state)
  const now = clone(state)
  const c: WeekCtx = {
    k, rules: channelRules(k), at, start, now, changes: [], lines: [], beats: [], data: {}, paid: new Set<Role>(),
    push(changes, line, tag) {
      if (changes.length > 0) {
        k.changes.applyAll(now, changes)
        c.changes.push(...changes)
      }
      if (line) {
        c.lines.push(line)
        c.beats.push({ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: tag ?? 'channel.weekly' })
      }
    },
  }
  for (const step of WEEK_STEPS) step(c)
  const subsBefore = meterOf(k, state, SUBS)
  const subsAfter = meterOf(k, now, SUBS)
  const credibility = meterOf(k, now, CREDIBILITY)
  const episodes = start.week.episodes
  const lives = start.week.lives
  const summary = `「${start.name}」的每週結算：${episodes + lives > 0 ? `這一週開了 ${episodes} 集節目、${lives} 場直播，` : '這一週一集都沒開，'}訂閱 ${money(subsBefore)} → ${money(subsAfter)}。`
  return {
    kind: 'downtime', action: WEEKLY_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: c.beats, changes: c.changes,
    outcome: { result: 'weekly', summary }, narration: { results: c.lines },
    triggers: [{ point: WEEK_TRIGGER, where: { episodes, lives, subs: subsAfter, credibility, ...((c.data.unpaid ?? 0) > 0 ? { unpaid: true } : {}) } }],
  }
}

const inCommission = (k: Pick<Kernel, 'activity'>, state: GameState): boolean => k.activity.active(state).some((a) => a.kind === 'commission')

/**
 * time.passed（順序 11）：從上一次結算到現在跨過的每一個週一各結一次（每週一份報告，最多補 max_catch_up 週）。
 * 人在副本裡什麼都不做（不記到期：mark 留著，出來之後的下一次再補）。沒開頻道什麼都不做。
 */
export function weeklyDrafts(k: Kernel, state: GameState, _from: GameTime, to: GameTime): ReportDraft[] {
  const ch = readChannel(state)
  if (!ch.open || inCommission(k, state)) return []
  const rules = channelRules(k)
  const marks = weeklyCrossings(fromMinutes(ch.mark), to, k.timeRules).map(toMinutes)
  if (marks.length === 0) return []
  const run = marks.slice(-rules.max_catch_up)
  const out: ReportDraft[] = []
  let sim = state
  run.forEach((m, i) => {
    const draft = settleWeek(k, sim, m)
    out.push(draft)
    if (i < run.length - 1) {
      sim = clone(sim)
      k.changes.applyAll(sim, draft.changes)
    }
  })
  return out
}
