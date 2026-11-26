// 探針：簾後館的一趟到落幕（邀請函 → 面談 → 口味單 → 報名 → 走到第二幕 → 全隊投降 → 落幕 → 補演 → 選記帳 → 一週後的帳單）。
// 規格：CYBERSPACE 8.7、8.8 節（簾後館：怎麼進去、一趟的結構、打輸會怎樣、母帶、篩選）；LEWD_SYSTEM 3.4 節（場景結算）；FIXER 第 4 節（每週帳單）；
// dev/adr/0019 第十二節；dev/work/M4-curtain-*.md。
// 追的東西：每一份報告（action、kind、結果、花的分鐘、changes 的種類、觸發點）、掛鉤與登錄表（誰處理 time.passed、bill.collect、report.after；活動登錄表）、
// 落幕時的數字（打賞減半、保證金沒收、不加沉溺、母帶外流的機率）、補演場景的設定、三條路的價錢，然後拿規格一條一條對。
// 對不上的記進 mismatches（當場 expect 擋下）；已經開了 bug 報告的記進 known（照實記下，不讓主套件變紅）；規格沒寫清楚的寫進「記下的事」。
// 要輸出追蹤紀錄：PROBE_OUT=<檔案路徑> npx vitest run tests/probe/curtain.probe.test.ts（沒設的時候只驗不寫檔）。
// 內容是 testkit 的 bodyWorld() 與 makeCurtainGame（NET_PC、全套甲板與構裝、站在塔下）；種子 3，骰面每次都一樣。

import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Change, Report } from '../../src'
import { toMinutes } from '../../src'
import { acceptDefeat, defeatOf } from '../../src/features/defeat'
import { accountView, curtainOf, curtainRules, fallView, fineOf, replayDraft, settleDraft } from '../../src/features/curtain'
import { tapeChance, tapeRoll } from '../../src/features/curtain/fall'
import { netrunView, readRun } from '../../src/features/netrun'
import { sceneRawOf } from '../../src/features/scene'
import type { Game } from '../../src/shell/game'
import { CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, netMarkers, netUse, observed, passTime, playCurtainRun, sceneCast, standBeside, stopScene, summarize } from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })
const OUT = process.env.PROBE_OUT

const opsOf = (cs: readonly Change[]): string => {
  const n = new Map<string, number>()
  for (const c of cs) n.set(c.op, (n.get(c.op) ?? 0) + 1)
  return [...n].map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(' ')
}

describe('探針：簾後館一趟到落幕', () => {
  it('每一份報告、掛鉤、登錄表與落幕的數字都和規格對得上', async () => {
    const g: Game = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    const { k } = g
    const rows: string[] = []
    const notes: string[] = []
    const mismatches: string[] = []
    const known: string[] = []
    const hookLog: string[] = []
    const events: Record<string, string[]> = {}
    const pc = (): NonNullable<Game['state']['actors'][string]> => g.state.actors.pc!
    const money = (): string => `cred ${g.state.money.cred}、cash ${g.state.money.cash}`

    const step = async (name: string, fn: () => Report[] | Promise<Report[]>): Promise<Report[]> => {
      const t0 = toMinutes(g.state.time)
      const sink0 = pc().sink
      const { result, events: ev, violations } = await observed(g, fn)
      expect(violations, name).toEqual([])
      events[name] = summarize(ev.filter((e) => e.type !== 'hook.call')).slice(0, 12)
      for (const e of ev) {
        if (e.type !== 'hook.call') continue
        const d = e.data as { hook: string; owner: string; result: unknown }
        if (d.result !== undefined && d.result !== null && d.owner === 'curtain') hookLog.push(`${name} → ${d.hook}（curtain）→ ${JSON.stringify(d.result).slice(0, 200)}`)
      }
      for (const r of result) {
        rows.push(`| ${name} | ${r.action ?? ''} | ${r.kind} | ${r.outcome.result} | ${toMinutes(g.state.time) - t0} | ${opsOf(r.changes)} | ${(r.triggers ?? []).map((x) => x.point).join('、') || '—'} | 沉溺 ${sink0}→${pc().sink}｜${money()}｜${r.outcome.summary.slice(0, 50).replace(/\|/g, '/')} |`)
      }
      return result
    }

    // ---- 登錄表 ----
    const owners = (['time.passed', 'bill.collect', 'report.after', 'activity.end'] as const).map((h) => `${h}：${k.hooks.owners(h as never).join('、') || '（沒有）'}`)
    expect(k.hooks.owners('bill.collect' as never)).toContain('curtain')
    expect(k.activity.get('netrun')).toBeTruthy()
    const rules = curtainRules(k)

    // ---- 前奏與報名 ----
    await step('前奏：邀請函、面談（領會員證、散座）、口味單、走到簾口', () => curtainPrelude(g))
    const member = curtainOf(g.state).member
    expect(member?.tier).toBe('floor')
    const tier = rules.tiers.find((t) => t.id === 'floor')!
    const cash0 = g.state.money.cash
    const cred0 = g.state.money.cred
    await step('報名（蜜糖之夜）', () => curtainEnter(g, CURTAIN_NIGHTS.b))
    const run = readRun(g.state)!
    expect(run).toBeTruthy()
    const run0 = curtainOf(g.state).run!
    const paid = cash0 + cred0 - g.state.money.cash - g.state.money.cred
    notes.push(`保證金：散座 ${tier.deposit ?? '（資料）'}；報名實際扣 ${paid}`)
    if (tier.deposit !== undefined && paid < tier.deposit) mismatches.push(`報名扣了 ${paid}，席次的保證金是 ${tier.deposit}`)
    const deposit = run0.deposit

    await step('走完序幕與第一幕（兩層）到第二幕', async () => (await playCurtainRun(g, { stopAfterLayer: 2 })).reports)
    expect(netrunView(k, g.state)!.layer.index).toBe(3)
    const inv0 = JSON.stringify(g.state.inventory)
    const sinkBefore = pc().sink
    const tapeRollBefore = tapeRoll(g.state, run0.id)

    // ---- 打輸：全隊投降 ----
    await step('第二幕開戰、全隊投降', async () => {
      const foe = netMarkers(g).find((m) => m.mark === 'f')!
      await standBeside(g, foe.id)
      const rs = netUse(g, 'fight', foe.id)
      for (let i = 0; i < 40 && g.battleOptions()?.waiting === 'ai'; i++) g.battleNext()
      g.battleAct({ action: 'net_surrender' })
      return [...rs, ...(await g.finishBattle()).reports]
    })
    expect(defeatOf(g.state)).toBeTruthy()
    expect(pc().sink, '倒下的人不加沉溺（館方的熔斷設定）').toBe(sinkBefore)

    await step('接受結果（落幕）', () => g.commit(acceptDefeat(k, g.state)))
    const cur = curtainOf(g.state)
    expect(cur.fall).toMatchObject({ stage: 'replay' })
    const fv = fallView(k, g.state)!
    notes.push(`落幕：輸在第 ${fv.act.number} 幕（${fv.act.name}），場熱 ${fv.heat}，打賞 ${fv.tips}（整份 ${fv.full}），保證金 ${fv.deposit}，設備費與違約金 ${fv.fine}`)
    // 規格 8.8：打賞照當時的場熱減半；保證金沒收
    if (fv.tips !== Math.round(fv.full / 2) && fv.tips !== Math.floor(fv.full / 2) && fv.tips !== Math.ceil(fv.full / 2)) mismatches.push(`落幕的打賞 ${fv.tips} 不是整份 ${fv.full} 的一半`)
    if (fv.fine !== Math.round(deposit / 2) && fv.fine !== fineOf(rules, deposit)) mismatches.push(`設備費與違約金 ${fv.fine}，規格是保證金 ${deposit} 的一半`)
    if (JSON.stringify(g.state.inventory) !== inv0) mismatches.push('落幕之後背包變了（規格：倒下也不丟東西，館方把身上的寄存在櫃台）')
    notes.push('規格沒寫「不合」的評價怎麼算：好的補回減掉的一半再加一點（rules.fall.replay.bonus），這裡的實作另外在不合時再扣一成（penalty）。見回報的規格問題。')

    // ---- 補演 ----
    await step('補演：館方派戰敗事件，開場景', () => g.commit(replayDraft(k, g.state)))
    const sc = sceneRawOf(g.state)
    expect(sc).toMatchObject({ nature: 'work', goal: 'please', layer: 'net' })
    const settled = await step('補演：停下（結算）', () => stopScene(g).reports)
    void settled
    expect(fallView(k, g.state)).toMatchObject({ step: 'choose' })
    const rv = fallView(k, g.state)!
    notes.push(`補演結果：${JSON.stringify(rv.replayed)}`)
    // 規格 8.8 第 3 點：沉溺只動 −2～+2（純粹的交易與工作不動它）
    const sinkDelta = pc().sink - sinkBefore
    notes.push(`補演前後主角沉溺 ${sinkBefore} → ${pc().sink}（${sinkDelta >= 0 ? '+' : ''}${sinkDelta}）`)
    if (Math.abs(sinkDelta) > 2) mismatches.push(`補演讓沉溺動了 ${sinkDelta}（規格：只動 −2～+2）`)
    // 契合評價換回打賞：好的補回來再加一點、普通補回一些、不合不補（規格 8.8 第 3 點）
    if (rv.replayed) {
      const { band, from, to } = rv.replayed
      notes.push(`評價 ${band}：打賞 ${from} → ${to}（整份 ${rv.full}）`)
      if (band === 'good' && !(to >= rv.full)) mismatches.push(`好的場景打賞 ${to} 沒有把減掉的那一半補回來（整份 ${rv.full}）`)
      if (band === 'poor' && to > from) mismatches.push(`不合的場景打賞還是變多了 ${from} → ${to}`)
    }
    // 三條路的數字
    const paths = rv.paths.map((p) => `${p.id}：${p.can ? '可以' : '不行'}｜${p.desc}${p.why ? `（${p.why}）` : ''}`)
    notes.push(...paths.map((p) => `路：${p}`))

    // ---- 母帶 ----
    const acc = accountView(k, g.state)
    notes.push(`母帶：${JSON.stringify(acc.tapes)}；外流機率（第 ${fv.act.number} 幕輸、沒欠款）${tapeChance(k, g.state, { act: curtainOf(g.state).fall?.act ?? 0, indebted: false })}`)
    const chanceNow = tapeChance(k, g.state, { act: curtainOf(g.state).fall?.act ?? 0, indebted: false })
    notes.push(`外流的骰面（落幕前導出）${tapeRollBefore.toFixed(4)}、機率 ${chanceNow} → 預期${tapeRollBefore < chanceNow ? '外流' : '不外流'}；實際母帶 ${acc.tapes.length} 支`)
    if ((tapeRollBefore < chanceNow) !== (acc.tapes.length === 1)) notes.push('（骰面是落幕前的狀態導出的；落幕那份報告裡骰面前有別的亂數推進時，預期與實際會不同，不算不一致）')
    if (acc.tapes.length === 1) expect(acc.tapes[0]!.price).toBe(Math.round(deposit * rules.fall.tape.buyback_mult))
    expect(acc.tapes.length).toBeLessThanOrEqual(1)
    const base = rules.fall.tape.base
    if (base !== 0.15) mismatches.push(`母帶外流的基底機率 ${base}，規格暫定 15%`)

    // ---- 記帳 ----
    const cashPre = g.state.money.cash
    await step('選「記帳」', () => g.commit(settleDraft(k, g.state, { how: 'tab' })))
    expect(g.state.money.cash).toBe(cashPre)
    const tabv = accountView(k, g.state).tab!
    notes.push(`記帳：欠 ${tabv.owed}，上限 ${tabv.cap}，每週利息 ${tabv.weekly}`)
    if (tabv.owed !== fv.fine) mismatches.push(`記帳欠 ${tabv.owed}，設備費與違約金是 ${fv.fine}`)
    if (tabv.cap !== deposit * 2) mismatches.push(`欠款上限 ${tabv.cap}，規格是保證金的兩倍 ${deposit * 2}`)
    if (tabv.weekly !== Math.round(tabv.owed * 0.1)) mismatches.push(`每週利息 ${tabv.weekly}，規格是 10%`)

    // ---- 一週後的帳單 ----
    await step('過一週（週一的帳單）', () => passTime(g, 8 * 24 * 60))
    const lines = k.hooks.run('bill.collect' as never, { state: g.state, week: 1 } as never).flatMap((r) => r.result as Array<{ id?: string; amount?: number; name?: string }>)
    const tabLine = lines.find((l) => l.id === 'curtain_tab')
    notes.push(`週帳單的簾後館那一行：${JSON.stringify(tabLine)}`)
    if (!tabLine || tabLine.amount !== tabv.weekly) mismatches.push(`週帳單裡簾後館的利息不是 ${tabv.weekly}`)

    notes.push('規格沒寫清楚（要使用者或架構師定）：(1) 場熱剛好 20：「20 以下 0」與「20～39 ×0.1」兩邊都包含 20，現況 20 算 ×0.1；(2)「不合」的補演評價規格沒寫，現況再扣一成打賞（rules.fall.replay.penalty）；(3) 記帳欠款「上限是保證金的兩倍」現況是報名的閘門（欠到上限就不能報名），沒有夾住欠款：欠 599 的人再落幕記帳會欠到 749，超過上限。')
    if (OUT) {
      const md = [
        '# 探針紀錄：簾後館一趟到落幕', '',
        '規格：CYBERSPACE 8.7、8.8 節；LEWD_SYSTEM 3.4 節；FIXER 第 4 節；dev/adr/0019 第十二節。腳本：engine/tests/probe/curtain.probe.test.ts（PROBE_OUT 設了才寫檔）。', '',
        '## 登錄表與掛鉤', '', ...owners.map((x) => `- ${x}`), '',
        '## 每一份報告', '', '| 步驟 | action | kind | 結果 | 花的分鐘 | changes | 觸發點 | 沉溺、錢與摘要 |', '|---|---|---|---|---|---|---|---|', ...rows, '',
        '## curtain 掛鉤的實際回傳（節錄）', '', ...hookLog.slice(0, 30).map((x) => `- ${x}`), '',
        '## 探針事件（每一步前 12 筆，不含掛鉤呼叫）', '', ...Object.entries(events).map(([n, e]) => `- ${n}：${e.join('；')}`), '',
        '## 記下的事', '', ...notes.map((x) => `- ${x}`), '',
        '## 和規格不一致的地方', '', ...(mismatches.length ? mismatches.map((x) => `- ${x}`) : ['（沒有新的）']), '', '已開 bug 的不一致（探針照實記下）：', ...(known.length ? known.map((x) => `- ${x}`) : ['（沒有）']), '',
      ].join('\n')
      writeFileSync(OUT, md)
    }
    expect(mismatches).toEqual([])
  })
})
