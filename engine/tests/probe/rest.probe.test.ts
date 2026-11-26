// 探針：休息與住處（喘口氣、睡一覺、睡在哪、房租與欠繳、退租）。
// 規格：DOWNTIME 2.1～2.3、5.1、5.2、7.1、7.2、8；EVENTS 3.1（rest、sleep_out、home 觸發點）；CORE_RULES 4.1、4.2；dev/adr/0016 第六節。
// 追的東西：每一份報告（action、kind、結果、花的分鐘、changes 的種類、hp 變化、觸發點）、探針的事件（掛鉤 hook.call 的實際回傳、提交前後）、
// 掛鉤與登錄表（rest 掛了哪些 hook、動作種類登錄、活動登錄表），然後拿規格一條一條對。
// 對不上的當場在 expect 裡擋下，擋不下（規格沒寫清楚）的寫進「記下的事」。
// 要輸出追蹤紀錄：PROBE_OUT=<檔案路徑> npx vitest run tests/probe/rest.probe.test.ts（沒設的時候只驗不寫檔）。
// 內容是 testkit 的假世界（makeCityGame）：四號塔的單位一級、週租 100，主角體格 12；骰面與時間固定，每個數字每次跑都一樣。

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Change, Report, ReportDraft } from '../../src'
import { ActionBlocked, attrMod, toMinutes } from '../../src'
import { readBills } from '../../src/features/bills'
import { breathDraft, homeOf, leaveDraft, readRest, rentDraft, sleepDraft, sleepOptions } from '../../src/features/rest'
import type { Game } from '../../src/shell/game'
import { arrive } from '../../src/features/world'
import { CITY_HOME, makeCityGame, observed, passTime, passUntil, summarize, walkTo } from '../../src/testkit'

const OUT = process.env.PROBE_OUT

interface Row {
  step: string
  action: string
  kind: string
  result: string
  summary: string
  minutes: number
  ops: string
  hp: string
  money: string
  triggers: string
  rest: string
  bills: string
}

const opsOf = (cs: readonly Change[]): string => {
  const n = new Map<string, number>()
  for (const c of cs) n.set(c.op, (n.get(c.op) ?? 0) + 1)
  return [...n].map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(' ')
}

describe('探針：休息與住處', () => {
  it('每一份報告的 changes、掛鉤與登錄表都和規格對得上', async () => {
    const { game: g } = makeCityGame()
    const { k } = g
    walkTo(g, 'F1') // 站上自己住處的設施（makeCityGame 預設站在塔下的西口）
    const pc = g.state.pc!
    const rows: Row[] = []
    const notes: string[] = []
    const mismatches: string[] = []
    const hookLog: string[] = []
    const eventSummary: Record<string, string[]> = {}

    // ---- 登錄表與掛鉤（探針開之前就裝好了，直接問登錄表） ----
    const hookOwners = (['bill.collect', 'bill.settled', 'game.new', 'rest.done', 'turn.end'] as const).map((h) => `${h}：${k.hooks.owners(h).join('、') || '（沒有人）'}`)
    expect(k.hooks.owners('bill.collect')).toContain('rest')
    expect(k.hooks.owners('bill.settled')).toContain('rest')
    expect(k.hooks.owners('game.new')).toContain('rest')

    const maxHp = (): number => k.stats.stat(g.state, pc, 'max_hp')
    const hpNow = (): number => g.state.actors[pc]!.hp
    const setHp = (hp: number): void => {
      const d: ReportDraft = { kind: 'system', action: 'test.hp', location: { ...g.state.location }, party: [], timeline: [], changes: [{ op: 'actor.track', id: pc, track: 'hp', delta: hp - hpNow() }], outcome: { result: 'ok', summary: 'hp' } }
      g.commit(d)
    }
    const setLoad = (n: number): void => {
      g.commit({ kind: 'system', action: 'test.load', location: { ...g.state.location }, party: [], timeline: [], changes: [{ op: 'actor.track', id: pc, track: 'load', delta: n }, { op: 'actor.track', id: pc, track: 'afterglow', delta: n }], outcome: { result: 'ok', summary: 'load' } })
    }

    const billsText = (): string => { const b = readBills(g.state); return `overdue ${b.overdue}、arrears ${b.arrears}、debts ${JSON.stringify(b.debts.map((d) => ({ to: d.to, principal: d.principal })))}` }

    /** 跑一步（開探針）：回傳報告、記一列、把這一步的掛鉤與提交事件記下來。 */
    async function step(name: string, fn: () => ReportDraft | Report[]): Promise<Report[]> {
      const hp0 = hpNow()
      const m0 = { ...g.state.money }
      const t0 = toMinutes(g.state.time)
      const { result, events, violations } = await observed(g, () => {
        const r = fn()
        return Array.isArray(r) ? r : g.commit(r)
      })
      expect(violations).toEqual([])
      const quiet = events.filter((e) => e.type === 'hook.call' && ((e.data as { result: unknown }).result === undefined || (e.data as { result: unknown }).result === null))
      const shown = events.filter((e) => !quiet.includes(e))
      eventSummary[name] = [...summarize(shown), `（另有 ${quiet.length} 次掛鉤呼叫回傳 undefined，已略）`]
      for (const e of events) {
        if (e.type === 'hook.call') {
          const d = e.data as { hook: string; owner: string; result: unknown }
          if (d.result !== undefined && d.result !== null) hookLog.push(`${name} → ${d.hook}（${d.owner}）→ ${JSON.stringify(d.result).slice(0, 400)}`)
        }
      }
      for (const r of result) {
        rows.push({
          step: name, action: r.action ?? "", kind: r.kind, result: r.outcome.result, summary: r.outcome.summary,
          minutes: toMinutes(g.state.time) - t0, ops: opsOf(r.changes),
          hp: `${hp0}→${hpNow()}/${maxHp()}`, money: `cred ${m0.cred}→${g.state.money.cred}、cash ${m0.cash}→${g.state.money.cash}`,
          triggers: (r.triggers ?? []).map((t) => t.point).join('、') || '—',
          rest: JSON.stringify(readRest(g.state)), bills: billsText(),
        })
      }
      return result
    }
    const blocked = (name: string, fn: () => unknown): string => {
      try {
        fn()
      } catch (e) {
        if (e instanceof ActionBlocked) {
          rows.push({ step: name, action: '（被擋）', kind: '—', result: 'blocked', summary: e.message, minutes: 0, ops: '—', hp: `${hpNow()}/${maxHp()}`, money: '—', triggers: '—', rest: JSON.stringify(readRest(g.state)), bills: billsText() })
          return e.message
        }
        throw e
      }
      throw new Error(`${name}：應該被擋下，卻成功了`)
    }

    // ---- 0. 起點：租了住處，押金 = 兩週房租（DOWNTIME 7.2「押金：租的時候先付兩週房租」） ----
    const home0 = homeOf(k, g.state)!
    expect(home0.home.deposit).toBe(home0.residence.rent * 2)
    expect(g.state.money.cred).toBe(500 - 200)
    const max = maxHp()
    const mod = attrMod(k.stats.effectiveAttr(g.state, pc, 'body'))
    expect(max).toBe(20 + 12 * 2) // CORE_RULES 4.1：20 + 體格 × 2

    // ---- 1. 喘口氣：生命 2 + mod(體格)，最少 1；兩次睡一覺之間只有前兩次回生命；感載與餘韻歸零 ----
    setHp(10)
    setLoad(3)
    const want = Math.max(1, 2 + mod)
    const b1 = await step('1a 喘口氣 #1', () => breathDraft(k, g.state))
    expect(hpNow()).toBe(10 + want)
    expect(g.state.actors[pc]!.load).toBe(0)
    expect(g.state.actors[pc]!.afterglow).toBe(0)
    expect(b1[0]!.kind).toBe('downtime') // DOWNTIME 8
    await step('1b 喘口氣 #2', () => breathDraft(k, g.state))
    expect(hpNow()).toBe(10 + 2 * want)
    const b3 = await step('1c 喘口氣 #3（第三次不回生命）', () => breathDraft(k, g.state))
    expect(hpNow()).toBe(10 + 2 * want)
    expect(b3[0]!.outcome.result).toBe('no_heal')
    expect(b3[0]!.triggers?.[0]?.point).toBe('rest') // EVENTS 3.1

    // ---- 2. 睡一覺（住處一級 55%；重傷限制）：生命低於一半、傷口沒處理過，最多回到一半 ----
    setHp(10)
    setLoad(2)
    const opts0 = sleepOptions(k, g.state)
    expect(opts0.find((o) => o.id === 'home')!.rate).toBe(0.55) // DOWNTIME 2.3：一級 55%
    expect(opts0.find((o) => o.id === 'wild')!.rate).toBe(0.1) // 露宿 10%
    const s1 = await step('2a 睡在住處（生命 10/44，傷口沒處理過）', () => sleepDraft(k, g.state))
    expect(s1[0]!.outcome.result).toBe('home')
    expect(hpNow()).toBe(Math.ceil(max / 2)) // 最多回到一半
    expect(g.state.actors[pc]!.load).toBe(0)
    expect(s1[0]!.triggers?.map((t) => t.point)).toEqual(['rest', 'home'])
    expect(s1[0]!.changes.some((c) => c.op === 'counter' && String((c as unknown as { key: string }).key).startsWith('sleeps:'))).toBe(true)
    const sleepMinutes = rows.at(-1)!.minutes
    expect(sleepMinutes).toBe(480)

    // ---- 3. 距上次不到 16 小時：擋；不到 6 小時「算喘口氣」 ----
    const gapMsg = blocked('3a 睡完馬上再睡', () => sleepDraft(k, g.state))
    expect(gapMsg).toContain('16 小時')
    passTime(g, 6 * 60)
    blocked('3b 睡完 6 小時再睡', () => sleepDraft(k, g.state))
    notes.push('DOWNTIME 2.2「少於 6 小時算喘口氣」：實作裡睡一覺不到 16 小時一律被擋（原因是「至少要隔 16 小時，累了先喘口氣」），沒有「少於 6 小時自動變成喘口氣」的轉換。規格這句可以讀成「睡不到 6 小時的休息就是喘口氣」（敘述），也可以讀成行為；規格沒有寫明，記下，不算違反。')

    // ---- 4. 第 16 小時整：能睡；hp 滿的時候睡一覺沒有東西可回 ----
    passTime(g, 16 * 60 - (toMinutes(g.state.time) - readRest(g.state).lastSleep!))
    setHp(30) // 低於一半以上：30/44 不低於一半，不受限制
    const s2 = await step('4 睡在住處（滿 16 小時；生命 30/44）', () => sleepDraft(k, g.state))
    expect(hpNow()).toBe(Math.min(max, 30 + Math.floor(max * 0.55)))
    void s2

    // ---- 5. 露宿：走到沒有設施的街區（市場 E1），睡露宿，觸發點 sleep_out ----
    passTime(g, 16 * 60)
    g.commit(arrive(k, g.state, 'tw_market', 'E1')) // 到沒有設施的地方
    setHp(25)
    const wildOpts = sleepOptions(k, g.state)
    expect(wildOpts.find((o) => o.current)!.id).toBe('wild')
    const w = await step('5b 露宿（生命 25/44）', () => sleepDraft(k, g.state))
    expect(w[0]!.outcome.result).toBe('wild')
    expect(hpNow()).toBe(25 + Math.floor(max * 0.1)) // 露宿 10%
    expect(w[0]!.triggers?.map((t) => t.point)).toEqual(['rest', 'sleep_out']) // EVENTS 3.1

    // ---- 6. 每週帳單：週一 06:00 結算，房租第 1 項；付不出來：欠繳 +1，兩週門鎖換掉，付清才開 ----
    // 回到住處，錢清成 0，走到第 7 天 06:00（週一）
    g.commit(arrive(k, g.state, 'tw_tower', 'F1'))
    const wk0 = await step('6-0 先過第一個週一（帳戶還有錢，付得起）', () => {
      let day = g.state.time.day
      while (day % 7 !== 0 || (day === g.state.time.day && g.state.time.hour >= 6)) day += 1
      return passUntil(g, { day, hour: 6 })
    })
    void wk0
    g.commit({ kind: 'system', action: 'test.money', location: { ...g.state.location }, party: [], timeline: [], changes: [{ op: 'cred', delta: -g.state.money.cred }, { op: 'cash', delta: -g.state.money.cash }], outcome: { result: 'ok', summary: 'broke' } })
    const wk1 = await step('6a 下一個週一 06:00（帳戶 0、現金 0）', () => {
      let day = g.state.time.day
      while (day % 7 !== 0 || (day === g.state.time.day && g.state.time.hour >= 6)) day += 1
      return passUntil(g, { day, hour: 6 })
    })
    const settle1 = wk1.find((r) => r.action === 'bill.settle')
    expect(settle1, '週一 06:00 一定有一份 bill.settle').toBeTruthy()
    expect(readRest(g.state).home!.arrears).toBe(1)
    expect(readRest(g.state).home!.locked).toBe(false) // 第 1 週：還沒鎖門
    const wk2 = await step('6b 再過一週（仍然沒錢）', () => passTime(g, 7 * 1440))
    expect(wk2.some((r) => r.action === 'bill.settle')).toBe(true)
    expect(readRest(g.state).home!.arrears).toBe(2)
    expect(readRest(g.state).home!.locked).toBe(true) // 第 2 週：門鎖換掉（DOWNTIME 5.2）
    const lockMsg = blocked('6c 門鎖換掉後在住處睡覺', () => sleepDraft(k, g.state))
    expect(lockMsg).toContain('門鎖')
    // 第 3、4 週：債權賣給伊甸園、要求簽契約（DOWNTIME 5.2）；房租的欠款去哪了
    const wk3u = await step('6c2 第三個欠繳的週一', () => passTime(g, 7 * 1440))
    const wk4u = await step('6c3 第四個欠繳的週一', () => passTime(g, 7 * 1440))
    void wk3u
    void wk4u
    // 付清：給錢，下一個週一結算付成，門鎖開
    g.commit({ kind: 'system', action: 'test.money', location: { ...g.state.location }, party: [], timeline: [], changes: [{ op: 'cred', delta: 1000 }], outcome: { result: 'ok', summary: 'rich' } })
    const lockedStillBeforeMonday = readRest(g.state).home!.locked
    expect(lockedStillBeforeMonday).toBe(true)
    notes.push('DOWNTIME 5.2「房租欠了兩週：門鎖換掉，付清才開」：實作在欠兩週的那個週一鎖門，之後「付清」要等到下一個週一結算才開；中間手上有錢也不能主動補繳（沒有「補繳欠租」的行動，只有每週結算）。規格說「付清才開」沒有說要等下一個週一，記下。')
    const wk3 = await step('6d 下一個週一（有錢）', () => passTime(g, 7 * 1440))
    const settle3 = wk3.find((r) => r.action === 'bill.settle')
    expect(settle3).toBeTruthy()
    const rest3 = readRest(g.state).home!
    expect({ arrears: rest3.arrears, locked: rest3.locked }).toEqual({ arrears: 0, locked: false })
    notes.push(`第 3 個週一付的是：${settle3!.outcome.summary}（欠繳的兩週房租有沒有補，要看這一行；DOWNTIME 5.2：付清歸零）`)

    // ---- 7. 退租：押金退回去（用什麼錢付的就退什麼錢）；同時只有一個家；重租要再付押金 ----
    const credBefore = g.state.money.cred
    const leave = await step('7a 退租', () => leaveDraft(k, g.state))
    expect(leave[0]!.outcome.result).toBe('left')
    expect(g.state.money.cred).toBe(credBefore + 200)
    expect(homeOf(k, g.state)).toBeNull()
    blocked('7b 沒有家時再退租', () => leaveDraft(k, g.state))
    await step('7c 重租', () => rentDraft(k, g.state, CITY_HOME))
    expect(g.state.money.cred).toBe(credBefore) // 押金又付了 200
    blocked('7d 已經租著再租', () => rentDraft(k, g.state, CITY_HOME))

    // ---- 7.5 另一局：欠兩週（兩筆各 100）之後，有錢的那一個週一只付當週的 100：欠的 200 去哪了？ ----
    {
      const t2 = makeCityGame()
      const g2 = t2.game
      walkTo(g2, 'F1')
      const bills2 = (): { overdue: number; arrears: number; debts: number } => { const b = readBills(g2.state); return { overdue: b.overdue, arrears: b.arrears, debts: b.debts.reduce((a, d) => a + d.principal, 0) } }
      const broke = (): void => { g2.commit({ kind: 'system', action: 'test.money', location: { ...g2.state.location }, party: [], timeline: [], changes: [{ op: 'cred', delta: -g2.state.money.cred }, { op: 'cash', delta: -g2.state.money.cash }], outcome: { result: 'ok', summary: 'broke' } }) }
      const monday = (): void => { let day = g2.state.time.day; while (day % 7 !== 0 || (day === g2.state.time.day && g2.state.time.hour >= 6)) day += 1; passUntil(g2, { day, hour: 6 }) }
      broke()
      monday()
      monday()
      const owed = bills2()
      expect(readRest(g2.state).home!.locked).toBe(true)
      g2.commit({ kind: 'system', action: 'test.money', location: { ...g2.state.location }, party: [], timeline: [], changes: [{ op: 'cred', delta: 1000 }], outcome: { result: 'ok', summary: 'rich' } })
      monday()
      const after = bills2()
      const paid = 1000 - g2.state.money.cred
      rows.push({ step: '7.5 欠兩週後有錢的週一', action: 'bill.settle', kind: 'downtime', result: 'paid', summary: `欠 ${owed.arrears}（overdue ${owed.overdue}、門鎖 ${String(true)}）→ 這個週一實際付了 ${paid}；之後 overdue ${after.overdue}、arrears ${after.arrears}、門鎖 ${String(readRest(g2.state).home!.locked)}`, minutes: 0, ops: '—', hp: '—', money: `付了 ${paid}`, triggers: '—', rest: JSON.stringify(readRest(g2.state)), bills: `overdue ${after.overdue}、arrears ${after.arrears}、debts ${after.debts}` })
      if (owed.arrears === 200 && paid === 100 && after.arrears === 0 && !readRest(g2.state).home!.locked) {
        mismatches.push('**M1（待決定）欠的房租沒補收、門鎖卻開了**（DOWNTIME 5.2「房租欠了兩週：門鎖換掉，東西扣在裡面，付清才開」；5.1「付清歸零」）：欠兩週（欠款 200，門鎖換掉）之後，有錢的那個週一只收當週的 100，`bills.arrears` 的 200 直接歸零（`features/bills/model.ts` 的 `else { next.overdue = 0; next.arrears = 0 }`），`rest` 的 `rentSettled` 看到「這一週沒有欠」就把門鎖打開。欠的 200 不會再被收，也沒有變成債；「付清才開」實際上是「付當週的就開」。同樣的情形欠第 4 週之後付當週，累積的欠款（本局 115）也一筆勾銷。見 dev/bugs/B039。規格沒有明說「付清」是補清全部欠款還是當週，所以記為待決定。')
      }
    }

    // ---- 8. 規格對不上的地方（能從實際行為看出來的，逐條列出） ----
    // 8.1 DOWNTIME 2.1「每次休息可以用 N 次的技能與道具回滿」：rest.done 掛鉤要有人聽。M2 沒有技能的次數資源，這個核對在別的系統做。
    const restDoneOwners = k.hooks.owners('rest.done')
    notes.push(`rest.done 掛鉤的處理者：${restDoneOwners.join('、') || '（沒有人）'}；休息報告 changes 裡的種類：${rows.filter((r) => r.action.startsWith('rest.')).map((r) => r.ops).filter((v, i, a) => a.indexOf(v) === i).join(' ／ ')}`)

    // ---- 輸出 ----
    if (OUT) {
      const lines: string[] = []
      lines.push(`# 探針紀錄：休息與住處（${new Date().toISOString().slice(0, 10)}）`, '')
      lines.push('腳本：`engine/tests/probe/rest.probe.test.ts`。情境：`makeCityGame()`（四號塔的單位，一級，週租 100，押金 200；體格 12，生命上限 44；星期日 10:00，帳戶 500、現金 300）。')
      lines.push('規格：DOWNTIME 2.1～2.3、5.1、5.2、7.1、7.2、8；EVENTS 3.1；CORE_RULES 4.1、4.2。', '')
      lines.push('## 掛鉤與登錄表（探針開之前的實際內容）', '', ...hookOwners.map((h) => `- ${h}`), '')
      lines.push('## 每一步的報告', '', '| 步驟 | action | kind | result | 分鐘 | changes | 生命 | 錢 | 觸發點 |', '|---|---|---|---|---|---|---|---|---|')
      for (const r of rows) lines.push(`| ${r.step} | ${r.action} | ${r.kind} | ${r.result} | ${r.minutes} | ${r.ops} | ${r.hp} | ${r.money} | ${r.triggers} | ${r.bills} |`)
      lines.push('', '### 敘述與 state.ext.rest', '')
      for (const r of rows) lines.push(`- ${r.step}：${r.summary}\n  - rest：\`${r.rest}\``)
      lines.push('', '## 掛鉤實際被呼叫的紀錄', '', ...hookLog.map((h) => `- ${h}`), '')
      lines.push('## 事件的順序（每一步的探針事件，一行一個）', '')
      for (const [name, evs] of Object.entries(eventSummary)) lines.push(`### ${name}`, '', '```', ...evs, '```', '')
      lines.push('## 記下的事（規格沒寫清楚、不算違反）', '', ...(notes.length ? notes.map((n) => `- ${n}`) : ['- （沒有）']))
      lines.push('', '## 和規格不一致的地方', '', ...(mismatches.length ? mismatches.map((n) => `- ${n}`) : ['- （這一輪沒有）']))
      writeFileSync(OUT, lines.join('\n') + '\n')
    }
  })
})

void (null as unknown as Game)
