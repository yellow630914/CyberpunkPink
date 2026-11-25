// 探針：一整條內海委託（接案 → 出發 → 第一階段內海：走子網、打一場、過閘門 → 第二階段現實 → 第三階段現實 → 第四階段內海：下載 → 入帳）。
// 追的東西：每一份報告（action、kind、結果、時間、changes 的種類）、追蹤度與敵對值的量表、活動登錄表（誰在進行）、掛鉤（activity.end、探針事件的種類）；
// 然後拿規格的規則一條一條對（CYBERSPACE 6.8、8.3；NETRUNNING 3、5；COMMISSIONS 5、6.4、8；FIXER 的入帳；dev/adr/0018 N16、N34、N35）。
// 對不上的當場在 expect 裡擋下；擋不下（規格沒寫清楚、只能記下）的寫進「記下的事」。
// 要輸出追蹤紀錄：PROBE_OUT=<檔案路徑> npx vitest run tests/probe/net-commission.probe.test.ts（沒設的時候只驗不寫檔）。
//
// 內容是 testkit 的假世界與寫好的四階段內海副本（cm_tw_net）；骰面來自固定的種子（makeNetCommissionGame 預設 6），所以每一個數字每次跑都一樣。

import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Change, Report } from '../../src'
import { meterOf, toMinutes } from '../../src'
import { chooseBranch, chooseFace, readRun } from '../../src/features/commission'
import { go, jobOf } from '../../src/features/fixer'
import { netrunView, readRun as readNetRun } from '../../src/features/netrun'
import type { Game } from '../../src/shell/game'
import { M3_ACTION_PREFIXES, diveIn, makeDiveGame, makeNetCommissionGame, netUse, observed, playNetOut, playNetStage, playStage, prefixProblems, summarize } from '../../src/testkit'

vi.setConfig({ testTimeout: 90_000 })

const OUT = process.env.PROBE_OUT

/** 人在網內時要問的幾件事（doing 的名字；Game.blockOf 回答擋的原因，放行是 null）。 */
const DOINGS = [
  'commit:trade.checkout', 'commit:rest.sleep', 'commit:transit.taxi', 'commit:work.start', 'commit:fixer.accept', 'commit:roster.hire', 'commit:deck.equip', 'commit:deck.install',
  'commit:deck.remove', 'commit:deck.scripts', 'commit:deck.skin', 'commit:abilities.learn', 'commit:scene.start', 'commit:grid.move', 'commit:netrun.use', 'commit:dive.exit', 'commit:maze.enter',
]

interface Row {
  step: string
  action: string
  kind: string
  result: string
  summary: string
  minutes: number
  /** changes 的種類（op:次數） */
  ops: string
  /** 這份報告改了哪一座網的追蹤度（meter trace 的 key → 加了多少或設成多少） */
  trace: string
  active: string
  retracted: boolean
}

const opsOf = (cs: readonly Change[]): string => {
  const n = new Map<string, number>()
  for (const c of cs) n.set(c.op, (n.get(c.op) ?? 0) + 1)
  return [...n].map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(' ')
}
const traceOf = (cs: readonly Change[]): string => cs.filter((c) => c.op === 'meter' && (c as unknown as { kind: string }).kind === 'trace').map((c) => {
  const m = c as unknown as { key: string; delta?: number; set?: number }
  return `${m.key}:${m.delta !== undefined ? (m.delta >= 0 ? '+' : '') + m.delta : '=' + String(m.set)}`
}).join(' ')

describe('探針：內海委託整條（接案 → 子網 → 戰鬥 → 下載 → 入帳）', () => {
  it('每一份報告的 changes、追蹤度、活動登錄表、掛鉤都和規格對得上', async () => {
    const { game: g, job } = makeNetCommissionGame()
    const { k } = g
    const rows: Row[] = []
    const notes: string[] = []
    const matrix: Record<string, string | null> = {}
    const ends: Array<{ kind: string; outcome: string; result: Record<string, unknown>; at: number }> = []
    k.hooks.on('activity.end', 'probe', ({ kind, outcome, result }) => { ends.push({ kind, outcome, result: structuredClone(result), at: g.state.reports.length }) })

    let seen = g.state.reports.length
    const snap = (step: string): Row[] => {
      const fresh = g.state.reports.slice(seen)
      seen = g.state.reports.length
      const out = fresh.map((r: Report): Row => ({
        step, action: r.action ?? '', kind: r.kind, result: r.outcome.result, summary: r.outcome.summary.replace(/\s+/g, ' ').slice(0, 60),
        minutes: toMinutes(r.time.end) - toMinutes(r.time.start), ops: opsOf(r.changes), trace: traceOf(r.changes),
        active: k.activity.active(g.state).map((a) => a.kind).join('+'), retracted: !!r.retracted,
      }))
      rows.push(...out)
      return out
    }
    const traceNow = (): number | null => {
      const run = readNetRun(g.state)
      return run ? meterOf(k, g.state, 'trace', run.map) : null
    }
    const hostility = (): number => meterOf(k, g.state, 'hostility', 'f_gang')

    const { violations, events } = await observed(g, async () => {
      // ---- 接案之後、出發 ----
      expect(k.activity.active(g.state)).toEqual([])
      const money0 = { ...g.state.money }
      const rep0 = meterOf(k, g.state, 'rep')
      expect(hostility()).toBe(0)
      g.commit(go(k, g.state, job))
      const r0 = snap('出發')
      expect(r0.map((r) => r.action)).toEqual(['fixer.go', 'commission.enter'])
      expect(k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])

      // ---- 第一階段：內海 ----
      g.commit(chooseFace(k, g.state, 'net'))
      g.commit(chooseBranch(k, g.state, 'assault'))
      const r1 = snap('第一階段選面與分支')
      expect(r1.map((r) => r.action)).toEqual(['commission.face', 'commission.branch', 'netrun.enter'].filter((a) => r1.some((r) => r.action === a)))
      expect(r1.map((r) => r.action)).toContain('netrun.enter')
      expect(new Set(k.activity.active(g.state).map((a) => a.kind))).toEqual(new Set(['commission', 'face.net']))
      // CYBERSPACE 8.3／NETRUNNING 5：目標勢力敵對值 0 → 追蹤度從 0 起算；探索中追蹤度不會自己漲
      expect(traceNow()).toBe(0)
      // 活動登錄表：人在網內（face.net 進行中）時，各種現實的事誰擋、誰放行（NETRUNNING 3：身體留在現實、不能動）
      for (const doing of DOINGS) matrix[doing] = g.blockOf(doing)
      const t0 = toMinutes(g.state.time)
      await playNetStage(g, { noFace: true, stopAt: 'foe' })
      snap('第一階段走到遭遇旁邊')
      expect(traceNow()).toBe(0)
      // NETRUNNING 3 的「回合」與 N35：委託的內海階段不另外算時間（里程碑的 120 分鐘），所以走格子不花分鐘數
      const walkMinutes = rows.filter((r) => r.step === '第一階段走到遭遇旁邊').reduce((s, r) => s + r.minutes, 0)
      if (walkMinutes !== 0) notes.push(`委託的內海階段走到遭遇旁邊花了 ${walkMinutes} 分鐘（N35：委託的內海階段不另外算時間）`)
      expect(toMinutes(g.state.time) - t0).toBe(walkMinutes)
      const view = netrunView(k, g.state)!
      expect(view.near[0]!.uses.map((u) => u.id)).toEqual(['fight', 'sneak'])

      // 打一場：開戰、打完
      const foe = view.near[0]!.id
      netUse(g, 'fight', foe)
      expect(g.battle).not.toBeNull()
      expect(new Set(k.activity.active(g.state).map((a) => a.kind))).toEqual(new Set(['commission', 'face.net', 'battle']))
      expect(g.battle!.field.trace).toBe(0)
      // 輪到主角時用一次管理行動（標記：CYBERSPACE 6.6「每做一次追蹤度 +1」），讓追蹤度不是 0（整趟累計才驗得到東西）
      const pcUnit = Object.values(g.battle!.units).find((u) => u.actor === 'pc')!.id
      let marked = false
      for (let i = 0; i < 40 && g.battle; i++) {
        const o = g.battleOptions()
        if (!o || o.waiting === 'over') break
        if (o.waiting === 'ai') { g.battleNext(); continue }
        if (o.current === pcUnit) {
          const target = Object.values(g.battle!.units).find((u) => u.side === 'foe' && !u.out)!.id
          marked = g.battleAct({ action: 'adm_mark', target: { unit: target } } as never).status === 'applied'
          break
        }
        g.battleAct({ action: 'end_turn' } as never)
      }
      expect(marked).toBe(true)
      const fight = playNetOut(g)
      const roundsFought = fight.rounds
      const fin = await g.finishBattle()
      snap('第一階段的戰鬥')
      expect(fin.reports.map((r) => r.action)).toContain('battle.end')
      // CYBERSPACE 6.8：戰鬥每過一回合 +3、管理行動 +1；寫回量表的追蹤度 = 3 × 過的回合數 + 1
      const tAfterFight = traceNow()!
      const expectTrace = [3 * (roundsFought - 1) + 1, 3 * roundsFought + 1]
      if (!expectTrace.includes(tAfterFight)) notes.push(`第一階段那場打了 ${roundsFought} 輪、一次管理行動，追蹤度是 ${tAfterFight}（每輪 +3、管理行動 +1，應該是 ${expectTrace.join(' 或 ')}）`)
      expect(expectTrace).toContain(tAfterFight)
      expect(tAfterFight).toBeGreaterThanOrEqual(1)
      expect(g.state.battle).toBeFalsy()
      expect(new Set(k.activity.active(g.state).map((a) => a.kind))).toEqual(new Set(['commission', 'face.net']))

      // 過閘門（最後一層是出口）：整趟交回
      await playNetStage(g, { noFace: true })
      snap('第一階段過閘門')
      const end1 = ends.find((e) => e.kind === 'face.net')!
      expect(end1.outcome).toBe('done')
      expect(end1.result.trace).toBe(tAfterFight)
      expect(readNetRun(g.state)).toBeNull()
      expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face', trace: tAfterFight })
      expect(k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])
      // 內海階段結束時不立刻動敵對值（COMMISSIONS 第 8 節：做完時才算）
      expect(hostility()).toBe(0)

      // ---- 第二、三階段：現實 ----
      await playStage(g)
      snap('第二階段（現實）')
      expect(readRun(g.state)).toMatchObject({ stage: 3, step: 'face' })
      // NETRUNNING 5：追蹤度只存在於子網裡：現實的階段不動
      expect(readRun(g.state)!.trace).toBe(tAfterFight)
      await playStage(g)
      snap('第三階段（現實）')
      expect(readRun(g.state)).toMatchObject({ stage: 4, step: 'face' })
      expect(readRun(g.state)!.links.map((l) => l.id)).toContain('tw_airgap')

      // ---- 第四階段：內海，下載兩次 ----
      g.commit(chooseFace(k, g.state, 'net'))
      g.commit(chooseBranch(k, g.state, 'assault'))
      snap('第四階段選面與分支')
      // COMMISSIONS 6：整趟累計：第四階段的起點 = 前面階段帶來的
      expect(traceNow()).toBe(tAfterFight)
      const downloadsBefore = g.state.reports.length
      const stage4 = await playNetStage(g, { noFace: true })
      const r4 = snap('第四階段下載')
      const dl = stage4.filter((r) => r.action === 'netrun.use' && r.outcome.result === 'download')
      expect(dl).toHaveLength(2)
      // CYBERSPACE 8.3：下載每回合 +2
      for (const r of dl) {
        const d = r.changes.filter((c) => c.op === 'meter' && (c as unknown as { kind: string }).kind === 'trace').map((c) => (c as unknown as { delta?: number }).delta)
        if (d.length && d.some((x) => x !== 2)) notes.push(`下載那一份報告的追蹤度變化是 ${d.join(',')}（規格：每回合 +2）`)
      }
      expect(r4.some((r) => r.action === 'netrun.end')).toBe(true)
      void downloadsBefore

      // ---- 入帳 ----
      const done = ends.find((e) => e.kind === 'commission')!
      expect(done.outcome).toBe('done')
      const t4 = ends.filter((e) => e.kind === 'face.net')
      expect(t4).toHaveLength(2)
      expect(t4[1]!.result.trace as number).toBeGreaterThanOrEqual(tAfterFight + 4)
      expect(done.result.trace).toBe(t4[1]!.result.trace)
      const j = jobOf(g.state, job)!
      expect(j.status).toBe('done')
      expect(j.payout).toMatchObject({ outcome: 'done' })
      expect(j.payout!.reward - j.payout!.cut).toBe(j.payout!.pool)
      expect(g.state.reports.filter((r) => r.action === 'fixer.payout')).toHaveLength(1)
      expect(g.state.money.cash).toBeGreaterThan(money0.cash - 1)
      expect(meterOf(k, g.state, 'rep')).toBeGreaterThan(rep0)
      // N34：做完時每 20 點追蹤度，目標勢力的敵對值 +1（進位、最多 5）；現實面的那份另外算
      const finalTrace = t4[1]!.result.trace as number
      const netHostility = Math.min(5, Math.ceil(Math.max(0, finalTrace) / 20))
      expect(hostility()).toBeGreaterThanOrEqual(netHostility)
      // 追蹤度每升一次（沒跨門檻）就多一份 netrun.trace 報告（只記 peak）：數一數
      const traceReports = rows.filter((r) => r.action === 'netrun.trace').length
      notes.push(`整條共 ${rows.length} 份報告，其中 ${traceReports} 份是 netrun.trace（追蹤度升了、沒跨門檻，只更新 peak，內容只有「追蹤度 N。」）；狀態裡一共有 ${g.state.reports.length} 份報告（含接案、加入隊友之前的）`)
      notes.push(`整趟的最後追蹤度 ${finalTrace}；目標勢力的敵對值 ${hostility()}（內海那一份 ${netHostility}，其餘是現實面的強攻）`)
      // 活動登錄表：整條做完沒有留下進行中的活動、沒有留著的快照
      expect(k.activity.active(g.state)).toEqual([])
      expect(g.state.snapshots).toEqual([])
      expect(g.state.battle).toBeFalsy()
    })

    // 對照：潛入中（dive）同一批事誰擋、誰放行；deck 自己的檢查（scriptsBlock、skinBlock）只擋戰鬥，兩個一樣
    const dive = makeDiveGame()
    diveIn(dive.game)
    const diveMatrix = Object.fromEntries(['commit:deck.skin', 'commit:deck.scripts', 'commit:deck.install', 'commit:deck.equip'].map((d) => [d, dive.game.blockOf(d)]))
    if (diveMatrix['commit:deck.skin'] === null && diveMatrix['commit:deck.scripts'] !== null) {
      notes.push('潛入中（dive）放行換 SKIN（commit:deck.skin）、不放行換腳本（commit:deck.scripts）；但 deck 自己的 skinBlock 與 scriptsBlock 寫法一樣（只擋戰鬥中，註解寫「接入點的限制是 M3-dive 的事」）。規格（ITEMS 11.9：「戰鬥中與潛入中都不能換」寫的是程式與構裝；腳本沒寫）沒有明說潛入中能不能換腳本，待確認');
    }
    notes.push('委託的 netR.net_watchers（夜鶯與貞網局那一份敵對值）在規則表是空的（ADR 0018 N34：勢力資料匯入之前是空的），所以 NETRUNNING 5 與 COMMISSIONS 8 寫的「夜鶯與貞網局的敵對值上升」現在不會發生；這是已知的，不是新問題');

    // ---- 全程的檢查 ----
    // 網內放行與擋下：現實的買賣、睡覺、搭車、打工、接案、雇人與換甲板構裝都擋；網內自己的行動與成人場景放行（不變式第 171 條）
    for (const doing of ['commit:trade.checkout', 'commit:rest.sleep', 'commit:transit.taxi', 'commit:work.start', 'commit:fixer.accept', 'commit:roster.hire', 'commit:deck.equip', 'commit:deck.install', 'commit:deck.remove']) {
      expect(matrix[doing], doing).not.toBeNull()
    }
    for (const doing of ['commit:grid.move', 'commit:netrun.use', 'commit:scene.start']) expect(matrix[doing], doing).toBeNull()
    expect(violations).toEqual([])
    expect(prefixProblems(g)).toEqual([])
    expect(rows.some((r) => r.retracted)).toBe(false)
    // 每個動作的前綴都在清單裡
    for (const r of rows) expect(M3_ACTION_PREFIXES.concat(['fixer', 'commission', 'battle', 'grid', 'roster']), r.action).toContain(r.action.split('.')[0])
    // 活動 begin 與 end 成對：face.net 開了兩次、結束兩次；commission 一次
    const endKinds = ends.map((e) => e.kind)
    expect(endKinds.filter((x) => x === 'face.net')).toHaveLength(2)
    expect(endKinds.filter((x) => x === 'commission')).toHaveLength(1)
    expect(endKinds.filter((x) => x === 'battle').length).toBeGreaterThanOrEqual(1)
    // 探針事件：提交前後成對
    const before = events.filter((e) => e.type === 'report.before').length
    const after = events.filter((e) => e.type === 'report.after').length
    expect(before).toBe(after)
    expect(before).toBeGreaterThanOrEqual(rows.length)

    if (OUT) {
      const byType = new Map<string, number>()
      for (const e of events) byType.set(`${e.source} ${e.type}`, (byType.get(`${e.source} ${e.type}`) ?? 0) + 1)
      const lines: string[] = []
      lines.push('# 探針紀錄：內海委託整條（2026-11-25）', '')
      lines.push('腳本：`engine/tests/probe/net-commission.probe.test.ts`；情境：`makeNetCommissionGame()`（種子 6、寫好的四階段內海副本 cm_tw_net、隊伍主角加一位行者）；AI 關閉。', '')
      lines.push('## 報告表（每一份提交的報告）', '', '| # | 步驟 | action | kind | 結果 | 分鐘 | changes | 追蹤度 | 步驟結束時進行中的活動 |', '|---|---|---|---|---|---|---|---|---|')
      rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.step} | ${r.action} | ${r.kind} | ${r.result} | ${r.minutes} | ${r.ops} | ${r.trace || '—'} | ${r.active || '—'} |`))
      lines.push('', '## 人在網內（face.net 進行中）時，各種事被擋或放行（Game.blockOf）', '', '| doing | 結果 |', '|---|---|')
      for (const [d, v] of Object.entries(matrix)) lines.push(`| ${d} | ${v === null ? '放行' : '擋：' + v} |`)
      lines.push('', '## 活動結束的掛鉤（activity.end，依序）', '')
      for (const e of ends) lines.push(`- ${e.kind} → ${e.outcome}${typeof e.result.trace === 'number' ? `（trace ${String(e.result.trace)}）` : ''}`)
      lines.push('', '## 探針事件的種類與次數', '', '| 來源 type | 次數 |', '|---|---|')
      for (const [kk, n] of [...byType].sort((a, b) => b[1] - a[1])) lines.push(`| ${kk} | ${n} |`)
      lines.push('', '## 前 30 個探針事件', '', '```', ...summarize(events).slice(0, 30), '```')
      lines.push('', '## 對規格的檢查', '')
      lines.push('全部通過的檢查（腳本裡的 expect）：出發的報告序列；活動登錄表在每一步的組合（commission／face.net／battle）；追蹤度起點 0 且探索中不漲；戰鬥寫回量表的追蹤度 = 3 × 過的回合數 + 管理行動 1（CYBERSPACE 6.8）；內海階段交回的 result.trace 對上量表；現實階段不動追蹤度；第四階段起點等於前面累計；下載兩次；入帳一次、報酬扣掉抽成等於可分的錢；整條做完沒有進行中的活動與快照；沒有被收回的報告；不變式沒有違規；報告前綴在清單裡。')
      lines.push('', '## 記下的事（和規格不完全一致，或規格沒寫清楚）', '')
      for (const n of notes) lines.push(`- ${n}`)
      if (!notes.length) lines.push('- （沒有）')
      writeFileSync(OUT, lines.join('\n') + '\n')
    }
  })
})

void (null as unknown as Game)
