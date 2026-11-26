// 探針：契約人的一週（主角簽下債務契約，過一個星期：每天 08:00 的指令、照做、被獨佔活動打斷時期限暫停、走到指定的地方、週一回報）。
// 規格：LEWD_SYSTEM 7.1、7.4、7.6；EVENTS 4.5；DOWNTIME 4.2；dev/adr/0019 第八節與 P27～P30；dev/work/M4-contract.md。
// 追的東西：每一份報告（action、kind、結果、changes 的種類、滿意、觸發點）、掛鉤與登錄表（time.passed、report.before、report.after 誰處理；活動登錄表的放行）、
// 觸發點（contract.arrive 帶 order）、期限暫停的實際位移，然後拿規格一條一條對。
// 對不上的當場記進 mismatches，最後在 expect 裡擋下；規格沒寫清楚的寫進「記下的事」。
// 要輸出追蹤紀錄：PROBE_OUT=<檔案路徑> npx vitest run tests/probe/contract.probe.test.ts（沒設的時候只驗不寫檔）。
// 內容是 testkit 的 bodyWorld()；骰面由種子導出，每次跑都一樣。

import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Change, Report } from '../../src'
import { toMinutes, weekdayOf } from '../../src'
import { arriveDraft, boundView, chooseDraft, contractOf, contractRules } from '../../src/features/contract'
import type { Order } from '../../src/features/contract'
import { sceneRawOf } from '../../src/features/scene'
import { auctionRunOf, enterDraft as auctionEnter, leaveDraft as auctionLeave } from '../../src/features/auction'
import type { Game } from '../../src/shell/game'
import { AUCTION_HOUSE, BODY_BLOCKS, applyEffects, giveMoney, makeBodyGame, observed, openScene, passTime, passUntil, sceneCast, sceneRounds, standAt, stopScene } from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })
const OUT = process.env.PROBE_OUT
const DAY = 1440

const opsOf = (cs: readonly Change[]): string => {
  const n = new Map<string, number>()
  for (const c of cs) n.set(c.op, (n.get(c.op) ?? 0) + 1)
  return [...n].map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(' ')
}
const stamp = (g: Game): string => `第${g.state.time.day}天 ${String(g.state.time.hour).padStart(2, '0')}:${String(g.state.time.minute).padStart(2, '0')}（星期${'一二三四五六日'[weekdayOf(g.state.time)]}）`

describe('探針：契約人的一週', () => {
  it('每一份報告、掛鉤、登錄表與期限的暫停都和規格對得上', async () => {
    const t = makeBodyGame({ actors: sceneCast('ann'), at: { block: 'tw_tower', marker: 'E1' } })
    const g = t.game
    const { k } = g
    const rows: string[] = []
    const notes: string[] = []
    const mismatches: string[] = []
    /** 已經開了 bug 報告的不一致（探針照實記下，不讓主套件變紅；bug 修好之後要改成真的 expect） */
    const known: string[] = []
    const hookLog: string[] = []
    const row = (step: string, rs: Report[]): void => {
      const b = boundView(k, g.state)
      for (const r of rs) {
        rows.push(`| ${step} | ${stamp(g)} | ${r.action ?? ''} | ${r.kind} | ${r.outcome.result} | ${opsOf(r.changes)} | ${(r.triggers ?? []).map((x) => x.point).join('、') || '—'} | 滿意 ${b?.satisfaction ?? '—'}｜${r.outcome.summary.slice(0, 60).replace(/\|/g, '/')} |`)
      }
      if (rs.length === 0) rows.push(`| ${step} | ${stamp(g)} | （沒有報告） | | | | | 滿意 ${b?.satisfaction ?? '—'} |`)
    }
    const step = async (name: string, fn: () => Report[]): Promise<Report[]> => {
      const { result, events, violations } = await observed(g, fn)
      expect(violations, name).toEqual([])
      for (const e of events) {
        if (e.type !== 'hook.call') continue
        const d = e.data as { hook: string; owner: string; result: unknown }
        if (d.result !== undefined && d.result !== null && d.owner === 'contract') hookLog.push(`${name} → ${d.hook}（contract）→ ${JSON.stringify(d.result).slice(0, 220)}`)
      }
      row(name, result)
      return result
    }
    const cx = (): NonNullable<ReturnType<typeof contractOf>> => contractOf(g.state)!
    const rules = contractRules(k)
    const leftH = (o: Order): number => (o.deadline - toMinutes(g.state.time)) / 60

    // ---- 登錄表 ----
    const owners = (['time.passed', 'report.before', 'report.after'] as const).map((h) => `${h}：${k.hooks.owners(h).join('、')}`)
    expect(k.hooks.owners('time.passed')).toContain('contract')
    expect(k.hooks.owners('report.before')).toContain('contract')
    expect(k.hooks.owners('report.after')).toContain('contract')
    const acts = k.activity.list().map((a) => `${a.kind}：${a.allow.includes('commit:contract.choose') ? '放行 contract.choose' : '不放行 contract.choose'}`)
    for (const a of k.activity.list()) {
      if (a.kind === 'battle' || a.kind === 'defeat') expect(a.allow, a.kind).not.toContain('commit:contract.choose')
      else expect(a.allow, a.kind).toContain('commit:contract.choose')
    }

    // ---- 簽下 ----
    const signed = await step('簽下債務契約（C$24,000、差事／工作／回報／侍奉、每週一回報）', () => applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 24000, orders: ['errand', 'work', 'report', 'serve'], report_weekday: 0, holder: { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }, rules: [] }]).reports)
    expect(signed.map((r) => r.action)).toContain('contract.sign')
    expect(cx().type).toBe('debt')
    expect(boundView(k, g.state)!.satisfaction).toBe(rules.satisfaction.start)
    if (cx().queue.length !== 0) mismatches.push('簽下的當下佇列不是空的')

    // ---- 每天 08:00 擲一次：最多走八天，擲到一條就停 ----
    let first: Order | undefined
    for (let d = 0; d < 8 && !first; d++) {
      const nowM = toMinutes(g.state.time)
      const next8 = (Math.floor((nowM - 8 * 60) / DAY) + 1) * DAY + 8 * 60
      await step(`走到 08:00（第 ${d + 1} 段）`, () => passTime(g, next8 - nowM))
      expect(toMinutes(g.state.time)).toBe(next8)
      first = cx().queue.find((x) => x.state === 'sent')
      if (first) notes.push(`${first.id} ${first.kind} 在${stamp(g)}送達，期限 ${leftH(first).toFixed(1)} 小時後`)
    }
    if (!first) throw new Error('八天都沒有指令')

    // 規格 7.4 期限：差事 24～72 小時、改造 48、侍奉 4～12、出借 24
    const spec: Record<string, [number, number]> = { errand: [24, 72], modify: [48, 48], serve: [4, 12], lend: [24, 24] }
    const range = spec[first.kind]
    if (range && !(leftH(first) >= range[0] - 0.01 && leftH(first) <= range[1] + 0.01)) mismatches.push(`${first.kind} 的期限是 ${leftH(first).toFixed(1)} 小時，規格 ${range[0]}～${range[1]}`)

    // ---- 照做 ----
    const sat0 = boundView(k, g.state)!.satisfaction
    const picked = await step(`選「照做」：${first.kind}`, () => g.commit(chooseDraft(k, g.state, { order: first!.id, how: 'comply' })))
    expect(picked.map((r) => r.action)).toContain('contract.choose')
    expect(cx().queue.find((x) => x.id === first!.id)!.state).toBe('doing')
    if (boundView(k, g.state)!.satisfaction !== sat0) mismatches.push(`照做的當下滿意從 ${sat0} 變成 ${boundView(k, g.state)!.satisfaction}（規格 7.4：做完才上升）`)

    // ---- 期限暫停：成人場景（獨佔活動）進行一段時間，指令的期限往後挪 ----
    const dl0 = cx().queue.find((x) => x.id === first!.id)!.deadline
    const tScene0 = toMinutes(g.state.time)
    await step('開成人場景（獨佔活動）', () => openScene(g, { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' }))
    expect(sceneRawOf(g.state)).not.toBeNull()
    expect(g.k.activity.blockOf(g.state, 'commit:contract.choose')).toBeNull()
    await step('場景裡過三個回合', () => sceneRounds(g, 3))
    if (sceneRawOf(g.state)) await step('停下場景（結算）', () => stopScene(g).reports)
    const elapsed = toMinutes(g.state.time) - tScene0
    const dl1 = cx().queue.find((x) => x.id === first!.id)?.deadline
    notes.push(`場景一共 ${elapsed} 分鐘；指令期限 ${dl0} → ${String(dl1)}（位移 ${dl1 === undefined ? '（指令不在了）' : dl1 - dl0} 分鐘）`)
    if (dl1 !== undefined && dl1 - dl0 !== elapsed) mismatches.push(`場景進行了 ${elapsed} 分鐘，指令期限只往後挪了 ${dl1 - dl0} 分鐘（規格 7.4：獨佔活動時所有指令的期限暫停）`)

    // ---- 走到指定的地方、事件做完 ----
    const cur = cx().queue.find((x) => x.id === first!.id)
    if (cur && cur.state === 'doing' && cur.place?.block) {
      standAt(g, cur.place.block, 'E1')
      const ar = await step('走到指定的地方', () => g.commit(arriveDraft(k, g.state, { order: first!.id })))
      expect(ar.some((r) => (r.triggers ?? []).some((x) => x.point === 'order'))).toBe(true)
    } else notes.push(`這一條（${first.kind}）沒有指定的地方（${cur?.state ?? '不在了'}），跳過走到。`)

    // ---- 期限暫停：拍賣（離場把時間推到時段結束，一份報告走了 3 小時 50 分）----
    {
      // 一條新的、期限夠長的差事照做（前一條不一定還在）
      applyEffects(g, [{ kind: 'order', order_kind: 'errand', place: { district: 'tw_hive', block: 'tw_tower' }, hours: 200 }])
      const o = cx().queue.filter((x) => x.kind === 'errand' && x.state === 'sent').at(-1)!
      g.commit(chooseDraft(k, g.state, { order: o.id, how: 'comply' }))
      g.commit({ kind: 'system', action: 'test.give', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 } as unknown as Change], outcome: { result: 'ok', summary: '測試給的好感。' } })
      standAt(g, BODY_BLOCKS.hall, 'F1')
      const fri = (Math.floor(g.state.time.day / 7) + 1) * 7 + 4
      passUntil(g, { day: fri, hour: 19, minute: 10 })
      giveMoney(g, 0, 10000)
      const dl = (): number => cx().queue.find((x) => x.id === o.id)!.deadline
      await step('拍賣：進場', () => g.commit(auctionEnter(k, g.state, { house: AUCTION_HOUSE, pay: 'cash' })))
      expect(auctionRunOf(g.state)).not.toBeNull()
      const dIn = dl()
      const tIn = toMinutes(g.state.time)
      await step('拍賣：離場（時間推到時段結束）', () => g.commit(auctionLeave(k, g.state)))
      const spent = toMinutes(g.state.time) - tIn
      notes.push(`拍賣：進場 → 離場經過 ${spent} 分鐘；指令期限 ${dIn} → ${dl()}（位移 ${dl() - dIn} 分鐘）`)
      if (dl() - dIn !== spent) known.push(`B040：拍賣經過 ${spent} 分鐘，指令期限位移 ${dl() - dIn} 分鐘（規格 EVENTS 4.5：拍賣是獨佔的活動，期限暫停）；離場那份報告推進時間時活動已經結束，time.passed 看到的是離場之後的狀態`)
      // B040 已修（M4-fix-2）：結束活動的同一份報告推進的時間，也算在活動裡（time.passed 的 before）
      expect(dl() - dIn, '離場那一段時間要算暫停（期限往後挪經過的分鐘）').toBe(spent)
    }

    // ---- 把剩下的時間走到下一個週一（回報日）以後 ----
    const nextMonday = (Math.floor(g.state.time.day / 7) + 1) * 7
    for (let i = 0; i < 14 && g.state.time.day <= nextMonday; i++) await step('走一天', () => passTime(g, DAY))
    const reportOrders = cx().queue.filter((x) => x.kind === 'report')
    notes.push(`週一回報的指令：${reportOrders.length} 條（${reportOrders.map((x) => `${x.id}:${x.state}`).join('、')}）`)
    if (reportOrders.length === 0) mismatches.push('走過了週一，佇列裡沒有回報的指令（規格：每週回報那一天排一條 report）')

    notes.push('記下的事：(1) testkit 的 BODY_START 註解寫「第 3 天是週三」，照星期 = 天數 % 7（第 7 天週一）第 3 天是週四；(2) 契約簽的 orders 只是「契約紙上寫的種類」，沒寫的種類權重減半仍然抽得到（EVENTS 4.5 節「劃掉的種類仍然下得了，但權重減半」，符合）；(3) 回報（report）同時出現在每天的隨機抽（權重）與週一的固定排一條，同一個星期一可能有兩條回報；(4) 成人場景不花遊戲分鐘（探針 0 分鐘），所以場景這一路的期限暫停測不到差別，拍賣才有時間；(5) 指令的逾期只在下一次時間經過時才結算（一次 passTime 跨一天，逾期與新一條指令在同一刻結算）。')
    if (OUT) {
      const md = [
        '# 探針紀錄：契約人的一週', '',
        '規格：LEWD_SYSTEM 7.1、7.4、7.6；EVENTS 4.5；DOWNTIME 4.2；dev/adr/0019 第八節與 P27～P30。腳本：engine/tests/probe/contract.probe.test.ts（PROBE_OUT 設了才寫檔）。', '',
        '## 登錄表與掛鉤', '', ...owners.map((x) => `- ${x}`), '', '活動登錄表對 contract.choose 的放行：', ...acts.map((x) => `- ${x}`), '',
        '## 每一份報告', '', '| 步驟 | 時間 | action | kind | 結果 | changes | 觸發點 | 滿意與摘要 |', '|---|---|---|---|---|---|---|---|', ...rows, '',
        '## contract 掛鉤的實際回傳（節錄）', '', ...hookLog.slice(0, 30).map((x) => `- ${x}`), '',
        '## 記下的事', '', ...notes.map((x) => `- ${x}`), '', '## 和規格不一致的地方', '', ...(mismatches.length ? mismatches.map((x) => `- ${x}`) : ['（沒有新的）']), '', '已開 bug 的不一致（探針照實記下）：', ...(known.length ? known.map((x) => `- ${x}`) : ['（沒有）']), '',
      ].join('\n')
      writeFileSync(OUT, md)
    }
    expect(mismatches).toEqual([])
  })
})
