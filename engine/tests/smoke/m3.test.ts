// 冒煙測試的主幹，M3 加的那一段（dev/test-harness.md 第 6 節；dev/work/M3-smoke.md 第 3 點）。固定種子、AI 關閉。
// 每一條是一串有名字的步驟（testkit 的 flow）；任何一步斷了，錯誤訊息開頭寫出是哪一條、第幾步、叫什麼。
//
// 內容一律是 testkit 的 TEST_WORLD（最小的假世界，內海的幾筆在 src/testkit/worldNet.ts），功能是全部（allFeatures()）加主角的武器；走的是真正的功能與真正的提交。
// 內海戰鬥的我方化身由程式替玩家出手（playNetOut：有攻擊構裝就攻擊、破損了就換、RAM 不夠就回填）；要驗某一個行動的，照步驟自己下指令。
// 條目：
//   內海戰鬥  開打 → 換檔 → 攻擊到一隻過載（閃斷）→ 回填 → 管理行動造牆 → 釘住 → 打贏；另一條全員拔線
//   委託（內海）接案 → 出發 → 第一階段選內海、走子網、打一場、通過閘門 → 第二階段選現實 → 第三階段現實拿到開路的連動 → 第四階段內海下載（隔離區）→ 做完入帳；追蹤度整趟累計對得上
//   撤退      內海階段探索中登出 → 回到進副本之前、委託還在手上
//   戰敗      內海階段投降 → pinned 的戰敗事件 → 接受 → 委託失敗、回到進去之前；另一條選「回到這個階段開始時」，改選現實面走完
//   被定位    追蹤度推到 90、走三個探索回合 → 委託失敗
//   存檔讀檔  子網走到一半、內海戰鬥打到一半、下載到一半各存一次，最後的狀態和沒有中斷的一樣
//   第二波    潛艙店潛入 → 自己去挖走完一層登出 → 再進去是同一張圖 → 迷宮館報新手組走完三層結算 → 登出回到現實
//   整體      每一份報告的前綴都在 0016 第七節與 0018 第十三節的清單裡、不變式（observed）沒有違規；種子重播的固定檔在、步驟名對得上
//
// 每一個數字都是「這一局這樣算出來」的結果（骰面來自固定的種子），不是設計書的承諾；設計書的數字在各功能自己的測試裡。

import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { isNetMapKind, meterOf, toMinutes } from '../../src'
import { chooseBranch, chooseFace, commissionView, readRun } from '../../src/features/commission'
import { acceptDefeat, defeatOf } from '../../src/features/defeat'
import { deckOf } from '../../src/features/deck'
import { exit as diveExit, go as diveGo, diveOptions, readDive, sites } from '../../src/features/dive'
import { board, go, jobOf } from '../../src/features/fixer'
import { MAZE_EXT, mazeView, readMaze } from '../../src/features/maze'
import { logout, netExt, netrunView, readRun as readNetRun } from '../../src/features/netrun'
import type { Flow, Repro } from '../../src/testkit'
import {
  FIXER, M2_STEPS, M3_ACTION_PREFIXES, M3_STEPS, NET_FIXER, NET_COMMISSION, diveIn, flow, makeDiveGame, makeNetBattleGame, makeNetCommissionGame, mazeSignUp, netUse, netWalkRounds, observed,
  playMaze, playNetOut, playNetStage, playStage, prefixProblems, refitForRookie, stateHash, untilIdle,
} from '../../src/testkit'
import type { Game } from '../../src/shell/game'

// 整條委託有七八場真的戰鬥：平常四五秒，機器忙的時候（別的測試同時在跑）會慢好幾倍，預設的十秒不夠
vi.setConfig({ testTimeout: 60_000 })

const minutes = (g: Game): number => toMinutes(g.state.time)
const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')
const NOW = '2026-11-24T00:00:00Z'

/** 一條冒煙的結尾：每一份報告的 changes 套用之後等於狀態的變化（不變式第 2 條）。 */
async function guarded<T>(g: Game, fn: () => Promise<T>): Promise<T> {
  const { result, violations } = await observed(g, fn)
  expect(violations).toEqual([])
  return result
}

type Checkpoint = (label: string) => void
const noop: Checkpoint = () => undefined

/** 存檔再讀檔：讀得進來、狀態（含亂數與紀錄）一模一樣。 */
function roundTrip(g: Game, label: string): void {
  const before = stateHash(g.state)
  expect(g.load(g.save('manual', NOW, label)), label).toBeNull()
  expect(stateHash(g.state), label).toBe(before)
}

/** 在戰鬥裡下一道指令（我方的回合）；沒有成立丟錯並寫出原因。 */
function act(g: Game, input: { action: string; target?: unknown; pick?: Record<string, unknown> }): void {
  const r = g.battleAct(input as never)
  if (r.status !== 'applied') throw new Error(`${input.action} 沒有成立：${(r.reasons ?? []).join('；') || '沒有原因'}`)
}
const unitOf = (g: Game, id: string) => g.battle!.units[id]!
const lastLines = (g: Game): string => g.state.reports[g.state.reports.length - 1]!.timeline.map((b) => b.text).join(' / ')
const actorUnit = (g: Game, actor: string): string => Object.values(g.battle!.units).find((u) => u.actor === actor)!.id

/** 輪到我方的某個人（其他人的回合：我方結束回合，敵方讓 AI 走）。戰鬥分出結果了回傳 false。 */
function untilTurn(g: Game, unit: string): boolean {
  for (let i = 0; i < 60; i++) {
    const o = g.battleOptions()
    if (!o || o.waiting === 'over') return false
    if (o.current === unit && o.waiting === 'player') return true
    if (o.waiting === 'ai') g.battleNext()
    else act(g, { action: 'end_turn' })
  }
  throw new Error(`untilTurn：六十步還沒輪到 ${unit}`)
}

// ===================================================================================================================
// 內海戰鬥
// ===================================================================================================================

describe('冒煙 M3：內海戰鬥', () => {
  it('開打 → 換檔 → 攻擊到一隻過載（閃斷）→ 回填 → 管理行動造牆 → 釘住 → 打贏', async () => {
    const f = flow('內海戰鬥・打贏')
    const { game: g } = makeNetBattleGame()
    await guarded(g, async () => {
      await f.step('開打：四個有甲板的化身對四隻粉蕾絲，戰場是內海', () => {
        const b = g.battle!
        expect(b.mode).toBe('net')
        const allies = Object.values(b.units).filter((u) => u.side === 'ally')
        const foes = Object.values(b.units).filter((u) => u.side === 'foe')
        expect(allies).toHaveLength(4)
        expect(foes).toHaveLength(4)
        // 內海的單位：RAM 與構裝、沒有生命與彈匣；蕾絲的顏色寫在標籤上
        for (const u of allies) {
          expect(u.pools.ram, u.name).toBeDefined()
          expect(u.hp, u.name).toBeUndefined()
          expect(u.weapons.every((w) => w.mag === undefined), u.name).toBe(true)
          expect(deckOf(g.k, g.state, u.actor!).has).toBe(true)
        }
        expect(unitOf(g, 'a1').weapons.map((w) => w.id)).toEqual(['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam'])
        expect(foes.every((u) => u.tags.includes('lace:pink'))).toBe(true)
        // 戰場分清楚：沒有現實才有的行動，也沒有追蹤度（這一場不是網內行程開的）
        const ids = g.battleOptions()!.actions.map((a) => a.id)
        expect(ids).toEqual(expect.arrayContaining(['net_attack', 'net_refill', 'net_shift', 'net_pin', 'net_jack_out', 'net_surrender', 'adm_wall']))
        expect(ids.some((id) => /^(shoot|melee|reload|subdue|flee)$/.test(id) || id.startsWith('test.'))).toBe(false)
        expect(b.field).not.toHaveProperty('trace')
        expect(g.battleOptions()).toMatchObject({ current: 'a1', waiting: 'player' })
      })
      await f.step('換檔：標準換到深檔（不花行動點、每回合一次）', () => {
        const ap = unitOf(g, 'a1').ap.now
        act(g, { action: 'net_shift', pick: { gear: 'deep' } })
        expect(unitOf(g, 'a1').ext.net).toMatchObject({ sync: 'deep' })
        expect(unitOf(g, 'a1').tags).toContain('sync:deep')
        expect(unitOf(g, 'a1').ap.now).toBe(ap)
        const again = g.battleAct({ action: 'net_shift', pick: { gear: 'full' } } as never)
        expect(again.status).not.toBe('applied')
        expect((again.reasons ?? []).join('')).toContain('已經換過檔')
      })
      await f.step('攻擊：打到一隻蕾絲過載，閃斷（RAM 歸零、餘韻一層、狀態 flash）', () => {
        for (let i = 0; i < 4 && !unitOf(g, 'f1').statuses.some((s) => s.id === 'flash'); i++) act(g, { action: 'net_attack', target: { unit: 'f1' } })
        const f1 = unitOf(g, 'f1')
        expect(f1.statuses.map((s) => s.id)).toContain('flash')
        expect(f1.pools.ram!.now).toBe(0)
        expect(f1.layers).toBe(f1.layersMax)
        expect(g.state.reports.flatMap((r) => r.timeline).some((b) => b.text.includes('閃斷'))).toBe(true)
      })
      await f.step('回填：RAM 補回來（最多補到上限）', () => {
        const before = unitOf(g, 'a1').pools.ram!.now
        act(g, { action: 'net_refill' })
        const after = unitOf(g, 'a1').pools.ram!
        expect(after.now).toBeGreaterThan(before)
        expect(after.now).toBeLessThanOrEqual(after.max)
      })
      await f.step('管理行動：造牆（花一次管理行動，我方第 1 格變成有防火牆）', () => {
        act(g, { action: 'adm_wall', target: { side: 'ally', slot: 1 } })
        expect(lastLines(g)).toContain('造了牆')
        expect(g.battle!.cover!.ally[0]!.level).toBeGreaterThanOrEqual(1)
        expect(unitOf(g, 'a1').uses['turn:admin']).toBe(1)
      })
      await f.step('釘住：餘韻疊滿又站在第 1 格的蕾絲被釘在線上（退出戰鬥、登不出去）', () => {
        act(g, { action: 'net_pin', target: { unit: 'f1' } })
        expect(unitOf(g, 'f1').out).toBe('pinned')
        expect(lastLines(g)).toContain('被釘住了')
      })
      await f.step('打贏：其餘的打完，結算；沒有人倒下', async () => {
        const r = playNetOut(g)
        expect(r.outcome).toBe('win')
        const done = await g.finishBattle()
        expect(actions(done.reports)).toEqual(['battle.end'])
        expect(done.reports[0]!.outcome.result).toBe('win')
        expect(g.battle).toBeNull()
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(Object.values(g.state.actors).every((a) => a.hp > 0)).toBe(true)
      })
    })
    expect(prefixProblems(g)).toEqual([])
  })

  it('全員拔線：每個人在自己的回合登出，戰鬥以 jack_out 結束，沒有代價', async () => {
    const f = flow('內海戰鬥・全員拔線')
    const { game: g } = makeNetBattleGame()
    await guarded(g, async () => {
      await f.step('四個人一個一個拔線（敵方讓 AI 走）', () => {
        for (let i = 0; i < 40 && g.battle && !g.battle.result; i++) {
          const o = g.battleOptions()!
          if (o.waiting === 'ai') g.battleNext()
          else act(g, { action: 'net_jack_out' })
        }
        expect(g.battle!.result).toMatchObject({ outcome: 'jack_out' })
        expect(Object.values(g.battle!.units).filter((u) => u.side === 'ally').every((u) => u.out === 'jacked_out')).toBe(true)
      })
      await f.step('結算：battle.end 寫 jack_out，沒有被釘住、沒有人倒下', async () => {
        const done = await g.finishBattle()
        expect(actions(done.reports)).toEqual(['battle.end'])
        expect(done.reports[0]!.outcome.result).toBe('jack_out')
        expect(g.pendingDefeat).toBeNull()
        expect(Object.values(g.state.actors).every((a) => a.hp > 0)).toBe(true)
      })
    })
  })
})

// ===================================================================================================================
// 委託（內海）
// ===================================================================================================================

const view = (g: Game) => commissionView(g.k, g.state)!
const traceNow = (g: Game): number => meterOf(g.k, g.state, 'trace', readNetRun(g.state)!.map)

/** 這一場的第一個敵人（站在旁邊的遭遇節點的 id）。 */
const foeBeside = (g: Game): string => {
  const near = netrunView(g.k, g.state)!.near
  if (near.length === 0) throw new Error('旁邊沒有遭遇節點')
  return near[0]!.id
}

/** 開戰，輪到主角時用一次管理行動（標記一個敵人：追蹤度 +1），再由程式打完並結算。 */
async function fightWithAdmin(g: Game, foe: string): Promise<{ reports: Report[]; marked: boolean }> {
  netUse(g, 'fight', foe)
  expect(g.battle).not.toBeNull()
  const pc = actorUnit(g, 'pc')
  let marked = false
  if (untilTurn(g, pc)) {
    const target = Object.values(g.battle!.units).find((u) => u.side === 'foe' && !u.out)!.id
    act(g, { action: 'adm_mark', target: { unit: target } })
    marked = true
  }
  return { reports: [], marked }
}

/** 內海那一場打到一半（存檔讀檔的檢查點）：回傳要不要繼續。 */
async function finishNet(g: Game): Promise<Report[]> {
  const r = playNetOut(g)
  expect(r.outcome).toBe('win')
  return (await g.finishBattle()).reports
}

/**
 * 委託（內海）：接案 → 出發 → 第一階段選內海、走子網、打一場、通過閘門 → 第二階段選現實 → 第三階段現實拿到開路的連動 → 第四階段內海下載（隔離區）→ 做完入帳。
 * checkpoint 在中途被叫到（net.walk 子網走到一半、net.battle 內海戰鬥打到一半、net.download 下載到一半；測試在那裡存檔讀檔）。
 */
async function netCommissionFlow(f: Flow, g: Game, job: string, checkpoint: Checkpoint = noop): Promise<{ ends: Array<{ kind: string; outcome: string; result: Record<string, unknown> }>; t1: number }> {
  const { k } = g
  const ends: Array<{ kind: string; outcome: string; result: Record<string, unknown> }> = []
  k.hooks.on('activity.end', `smoke${ends.length}`, ({ kind, outcome, result }) => { ends.push({ kind, outcome, result: structuredClone(result) }) })
  const rep0 = meterOf(k, g.state, 'rep')
  await f.step('接案之後：委託在手上（四階段、主面內海）、隊伍兩個人都有甲板', () => {
    const j = jobOf(g.state, job)!
    expect(j).toMatchObject({ status: 'active', fixer: NET_FIXER })
    expect(j.commission).toMatchObject({ id: NET_COMMISSION, main: 'net', scale: 'medium' })
    expect(j.commission.stages).toHaveLength(4)
    expect(g.state.party).toHaveLength(2)
    for (const id of g.state.party) expect(deckOf(k, g.state, id).equipped.length, id).toBeGreaterThan(0)
  })
  await f.step('出發：開活動、存入口的快照、別的事被擋下', () => {
    const reports = g.commit(go(k, g.state, job))
    expect(actions(reports)).toEqual(['fixer.go', 'commission.enter'])
    expect(readRun(g.state)).toMatchObject({ stage: 1, step: 'face' })
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
    expect(view(g).faces.filter((x) => x.open && x.block === null).map((x) => x.face)).toEqual(expect.arrayContaining(['meat', 'net']))
  })
  await f.step('第一階段：選內海面、選分支，子網開起來（生成的地圖、追蹤度從零起算、現實的事被擋下）', () => {
    g.commit(chooseFace(k, g.state, 'net'))
    const reports = g.commit(chooseBranch(k, g.state, 'assault'))
    expect(actions(reports)).toEqual(['commission.branch', 'netrun.enter'])
    const run = readNetRun(g.state)!
    expect(run).toMatchObject({ kind: 'face.net', region: 'tw_subnet', grade: 1, layer: 0 })
    const inst = g.state.maps.instances[run.map]!
    expect(isNetMapKind(inst.gen!.map.kind)).toBe(true)
    expect(inst.gen!.by).toBe('netrun')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(expect.arrayContaining(['face.net', 'commission']))
    expect(g.blockOf('commit:trade.checkout')).toMatch(/網內/)
    expect(traceNow(g)).toBe(0)
    expect(netrunView(k, g.state)).toMatchObject({ layer: { index: 1, total: 1 }, goal: { kind: 'pass', done: false }, logout: { block: null } })
  })
  await f.step('走子網：走到遭遇節點旁邊（站在旁邊列出開戰與潛行繞過）', async () => {
    await playNetStage(g, { noFace: true, stopAt: 'foe' })
    const near = netrunView(k, g.state)!.near
    expect(near).toHaveLength(1)
    expect(near[0]!.uses.map((u) => u.id)).toEqual(['fight', 'sneak'])
    expect(readNetRun(g.state)!.round).toBeGreaterThan(0)
  })
  checkpoint('net.walk')
  const t1 = await f.step('打一場：開戰、主角用一次管理行動（追蹤度 +1）、內海戰鬥打贏', async () => {
    const foe = foeBeside(g)
    const { marked } = await fightWithAdmin(g, foe)
    expect(marked).toBe(true)
    checkpoint('net.battle')
    const reports = await finishNet(g)
    expect(actions(reports)).toContain('battle.end')
    expect(reports.find((r) => r.action === 'battle.end')!.outcome.result).toBe('win')
    // 這一場的追蹤度寫回量表；打贏的節點變成地板
    const t = traceNow(g)
    expect(t).toBeGreaterThanOrEqual(1)
    expect(netrunView(k, g.state)!.near).toEqual([])
    return t
  })
  await f.step('通過閘門：整趟交回 done（result 帶追蹤度與探索回合），副本記下追蹤度、接上第二階段', async () => {
    const reports = await playNetStage(g, { noFace: true })
    expect(actions(reports)).toEqual(expect.arrayContaining(['netrun.use', 'netrun.end', 'commission.milestone']))
    const end = ends.find((e) => e.kind === 'face.net')!
    expect(end.outcome).toBe('done')
    expect(end.result).toMatchObject({ trace: t1, layers: 1, region: 'tw_subnet' })
    expect(end.result).not.toHaveProperty('located')
    expect(end.result.rounds as number).toBeGreaterThan(0)
    expect(readNetRun(g.state)).toBeNull()
    expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face', trace: t1 })
    expect(view(g).trace.value).toBe(t1)
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
  })
  await f.step('第二階段：改選現實面（強攻、走地圖、打贏）', async () => {
    const reports = await playStage(g)
    expect(actions(reports)).toEqual(expect.arrayContaining(['commission.face', 'commission.branch', 'battle.start', 'battle.end', 'commission.milestone']))
    expect(readRun(g.state)).toMatchObject({ stage: 3, step: 'face' })
    expect(readRun(g.state)!.route.map((r) => r.face)).toEqual(['net', 'meat'])
    // 現實的階段不動追蹤度
    expect(view(g).trace.value).toBe(t1)
  })
  await f.step('第三階段：現實，拿到目標，開路的連動（資料埠）記進手上', async () => {
    await playStage(g)
    expect(readRun(g.state)).toMatchObject({ stage: 4, step: 'face' })
    expect(readRun(g.state)!.links.map((l) => l.id)).toContain('tw_airgap')
    expect(view(g).links.some((l) => l.id === 'tw_airgap')).toBe(true)
  })
  await f.step('第四階段：隔離區的內海面（鑰匙在手所以選得了），追蹤度從上一段的累計起算；下載要待在目標上做滿', async () => {
    g.commit(chooseFace(k, g.state, 'net'))
    g.commit(chooseBranch(k, g.state, 'assault'))
    expect(readNetRun(g.state)).toMatchObject({ kind: 'face.net', layer: 0, goal: { kind: 'download', turns: 2 } })
    expect(traceNow(g)).toBe(t1)
    const reports = await playNetStage(g, { noFace: true, checkpoint: (label) => checkpoint(`net.${label}`) })
    expect(actions(reports)).toEqual(expect.arrayContaining(['netrun.use', 'netrun.end']))
    expect(reports.filter((r) => r.action === 'netrun.use' && r.outcome.result === 'download').length).toBe(2)
  })
  await f.step('做完入帳：副本結束、委託做完、報酬入帳；追蹤度整趟累計對得上（交回的、副本記的、量表的）', () => {
    const t4 = ends.filter((e) => e.kind === 'face.net').map((e) => e.result.trace as number)
    expect(t4).toHaveLength(2)
    expect(t4[0]).toBe(t1)
    // 下載每一次加追蹤度：第四階段結束時比開始時高
    expect(t4[1]!).toBeGreaterThan(t1)
    const done = ends.find((e) => e.kind === 'commission')!
    expect(done.outcome).toBe('done')
    expect(done.result.trace).toBe(t4[1])
    expect(readRun(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(g.state.snapshots).toEqual([])
    const j = jobOf(g.state, job)!
    expect(j.status).toBe('done')
    expect(j.payout).toMatchObject({ outcome: 'done', wallet: 'cash' })
    expect(j.payout!.reward - j.payout!.cut).toBe(j.payout!.pool)
    expect(j.payout!.pc_net).toBeGreaterThan(0)
    expect(g.state.reports.filter((r) => r.action === 'fixer.payout')).toHaveLength(1)
    expect(meterOf(k, g.state, 'rep')).toBeGreaterThan(rep0)
    // 內海的路線留下敵對值：目標勢力
    expect(meterOf(k, g.state, 'hostility', 'f_gang')).toBeGreaterThan(0)
    expect(g.blockOf('commit:trade.checkout')).toBeNull()
  })
  return { ends, t1 }
}

describe('冒煙 M3：委託（內海）', () => {
  it('接案 → 出發 → 第一階段內海（走子網、打一場、通過閘門）→ 第二階段現實 → 第三階段現實（開路的連動）→ 第四階段內海下載 → 做完入帳', async () => {
    const { game: g, job } = makeNetCommissionGame()
    await guarded(g, () => netCommissionFlow(flow('委託（內海）'), g, job))
    expect(prefixProblems(g)).toEqual([])
    // 掃得到東西：這一趟碰到了內海的前綴
    const seen = new Set(g.state.reports.map((r) => r.action!.split('.')[0]))
    for (const p of ['deck', 'netrun', 'commission', 'fixer', 'battle', 'grid', 'roster']) expect(seen, p).toContain(p)
  })
})

describe('冒煙 M3：中間人生成的內海委託', () => {
  it('掮客桌上照類型（竊密）生成的委託：接案 → 第一階段內海 → 第二階段現實（給資料埠）→ 第三階段內海（隔離區，鑰匙在手）→ 做完入帳', async () => {
    const f = flow('委託（內海）・生成的')
    const { game: g, job } = makeNetCommissionGame({ offer: 'generated' })
    const { k } = g
    await guarded(g, async () => {
      await f.step('接案：生成的委託，主面內海、三階段（現實或內海、現實、內海）；最後的內海面是隔離區（要資料埠的連動），資料埠由現實那個階段給', () => {
        const j = jobOf(g.state, job)!
        expect(j.id).not.toBe('of_tw_net')
        const def = j.commission as unknown as { main: string; scale: string; stages: Array<{ faces: Record<string, { gives?: string; locked_by?: string }> }> }
        expect(def).toMatchObject({ main: 'net', scale: 'small' })
        expect(def.stages.map((st) => Object.keys(st.faces).sort())).toEqual([['meat', 'net'], ['meat'], ['net']])
        expect(def.stages[2]!.faces.net!.locked_by).toBe('lk_tw_airgap')
        expect(def.stages[1]!.faces.meat!.gives).toBe('lk_tw_airgap')
      })
      await f.step('出發、第一階段選內海面、走完（子網的敵人是粉蕾絲）', async () => {
        g.commit(go(k, g.state, job))
        const reports = await playNetStage(g)
        expect(actions(reports)).toEqual(expect.arrayContaining(['commission.face', 'netrun.enter', 'netrun.end', 'commission.milestone']))
        expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face' })
      })
      await f.step('第二階段：現實面（強攻、走地圖、打贏），資料埠的連動記進手上', async () => {
        await playStage(g)
        expect(readRun(g.state)).toMatchObject({ stage: 3, step: 'face' })
        expect(readRun(g.state)!.links.map((l) => l.id)).toContain('lk_tw_airgap')
      })
      await f.step('第三階段：隔離區打開了，選內海面走完；做完入帳', async () => {
        expect(view(g).faces.find((x) => x.face === 'net')).toMatchObject({ open: true, block: null })
        await playNetStage(g)
        expect(readRun(g.state)).toBeNull()
        const j = jobOf(g.state, job)!
        expect(j.status).toBe('done')
        expect(j.payout).toMatchObject({ outcome: 'done' })
        expect(g.state.reports.filter((r) => r.action === 'fixer.payout')).toHaveLength(1)
        expect(prefixProblems(g)).toEqual([])
      })
    })
  })
})

// ===================================================================================================================
// 撤退、戰敗、被定位
// ===================================================================================================================

/** 出發、第一階段選內海面與分支（子網開起來）；回傳出發之前的樣子。 */
function startNet(g: Game, job: string): { time: Game['state']['time']; money: Game['state']['money']; inventory: Game['state']['inventory']; flags: Game['state']['flags'] } {
  const before = { time: { ...g.state.time }, money: { ...g.state.money }, inventory: structuredClone(g.state.inventory), flags: { ...g.state.flags } }
  g.commit(go(g.k, g.state, job))
  g.commit(chooseFace(g.k, g.state, 'net'))
  g.commit(chooseBranch(g.k, g.state, 'assault'))
  return before
}

describe('冒煙 M3：撤退', () => {
  it('內海階段探索中登出 → 回到進副本之前（時間、錢、背包、旗標都回去）、紀錄留著並標成被收回、委託還在手上可以再出發', async () => {
    const f = flow('撤退（內海）')
    const { game: g, job } = makeNetCommissionGame()
    await guarded(g, async () => {
      const before = await f.step('出發、選內海面、走到遭遇旁邊（時間過了一些）', async () => {
        const b = startNet(g, job)
        await playNetStage(g, { noFace: true, stopAt: 'foe' })
        expect(minutes(g)).toBeGreaterThan(toMinutes(b.time) - 1)
        expect(readNetRun(g.state)).not.toBeNull()
        return b
      })
      await f.step('登出：畫面先寫「登出算撤退：會回到進副本之前」，登出之後一份帶 rewind 的報告', () => {
        expect(netrunView(g.k, g.state)!.logout).toEqual({ block: null, note: '登出算撤退：會回到進副本之前。' })
        const reports = g.commit(logout(g.k, g.state))
        expect(actions(reports)).toEqual(['netrun.logout', 'rewind'])
        expect(reports[0]!.outcome.result).toBe('retreat')
      })
      await f.step('時間、錢、背包、旗標都回到出發之前；副本與網內的行程結束、快照用掉', () => {
        expect(g.state.time).toEqual(before.time)
        expect(g.state.money).toEqual(before.money)
        expect(g.state.inventory).toEqual(before.inventory)
        expect(g.state.flags).toEqual(before.flags)
        expect(readRun(g.state)).toBeNull()
        expect(readNetRun(g.state)).toBeNull()
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(g.state.snapshots.filter((s) => s.kind === 'entry' || s.kind === 'stage')).toEqual([])
        // 生成的地圖跟著回去了：那趟的地圖實例不在
        expect(Object.values(g.state.maps.instances).some((i) => i.gen?.by === 'netrun')).toBe(false)
      })
      await f.step('紀錄留著並標成被收回；委託還在手上、可以再出發', () => {
        const kept = g.state.reports.filter((r) => r.retracted).map((r) => r.action)
        expect(kept).toEqual(expect.arrayContaining(['commission.enter', 'netrun.enter', 'netrun.logout']))
        expect(jobOf(g.state, job)!.status).toBe('active')
        expect(() => g.commit(go(g.k, g.state, job))).not.toThrow()
        expect(readRun(g.state)).toMatchObject({ stage: 1, step: 'face' })
      })
    })
  })
})

/** 內海階段走到遭遇旁邊、開戰、輪到我方時投降並結算（等著選的戰敗）。 */
async function surrenderInNet(g: Game, job: string): Promise<Report[]> {
  startNet(g, job)
  await playNetStage(g, { noFace: true, stopAt: 'foe' })
  netUse(g, 'fight', foeBeside(g))
  for (let i = 0; i < 40 && g.battleOptions()?.waiting === 'ai'; i++) g.battleNext()
  act(g, { action: 'net_surrender' })
  return (await g.finishBattle()).reports
}

describe('冒煙 M3：戰敗', () => {
  it('內海階段投降 → pinned 的戰敗事件 → 接受 → 委託失敗、回到進去之前（網內的行程只收掉、不另外發 face.net 的結束）', async () => {
    const f = flow('戰敗・接受（內海）')
    const { game: g, job } = makeNetCommissionGame()
    const ends: string[] = []
    g.k.hooks.on('activity.end', 'smoke', ({ kind, outcome }) => { ends.push(`${kind}:${outcome}`) })
    const before = { time: { ...g.state.time }, money: { ...g.state.money } }
    await guarded(g, async () => {
      await f.step('第一階段內海打到一半投降：等著選的戰敗，事件是蕾絲寫的 pinned（內海、沒被扣線、沒被定位）', async () => {
        const reports = await surrenderInNet(g, job)
        expect(actions(reports)).toEqual(['battle.end', 'defeat.pending', 'event.open'])
        expect(g.pendingDefeat).not.toBeNull()
        expect(defeatOf(g.state)).toMatchObject({ event: 'df_tw_pinned', tier: 'enemy', outcome: 'surrender', fails_commission: true, net: true, located: false, tethered: false, choices: ['accept', 'retry', 'stage'], stage: 'playing' })
        expect(g.blockOf('commit:trade.checkout')).not.toBeNull()
      })
      await f.step('事件走完（第一個選項）', async () => {
        const log = await untilIdle(g)
        expect(log.log).toEqual(['event df_tw_pinned/wait'])
        expect(defeatOf(g.state)).toMatchObject({ stage: 'played' })
      })
      await f.step('接受：委託失敗、回到進去之前；只有 defeat 與 commission 發結束（網內的行程自己收掉、不另外發 face.net），時間與錢都回去', () => {
        ends.length = 0
        const reports = g.commit(acceptDefeat(g.k, g.state))
        expect(actions(reports)).toEqual(['defeat.accept', 'rewind', 'commission.failed', 'fixer.payout'])
        expect(ends).toEqual(['defeat:accept', 'commission:failed'])
        expect(g.state.time).toEqual(before.time)
        expect(g.state.money).toEqual(before.money)
        expect(readRun(g.state)).toBeNull()
        expect(readNetRun(g.state)).toBeNull()
        expect(g.pendingDefeat).toBeNull()
        expect(g.battle).toBeNull()
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(jobOf(g.state, job)!.status).toBe('failed')
        expect(g.state.reports.filter((r) => r.retracted).map((r) => r.action)).toEqual(expect.arrayContaining(['commission.enter', 'netrun.enter', 'battle.end']))
        expect(prefixProblems(g)).toEqual([])
      })
    })
  })

  it('內海階段投降 → 戰敗事件走完 → 選「回到這個階段開始時」：回到第一階段選面之前，委託還在進行；這一次改選現實面走完', async () => {
    const f = flow('戰敗・回到階段（內海）')
    const { game: g, job } = makeNetCommissionGame()
    await guarded(g, async () => {
      const stageStart = await f.step('出發，記下第一階段開始時的樣子', () => {
        g.commit(go(g.k, g.state, job))
        return { time: { ...g.state.time }, money: { ...g.state.money }, alert: readRun(g.state)!.alert }
      })
      await f.step('選內海、走到遭遇旁邊、開戰、投降；戰敗事件走完', async () => {
        g.commit(chooseFace(g.k, g.state, 'net'))
        g.commit(chooseBranch(g.k, g.state, 'assault'))
        await playNetStage(g, { noFace: true, stopAt: 'foe' })
        netUse(g, 'fight', foeBeside(g))
        for (let i = 0; i < 40 && g.battleOptions()?.waiting === 'ai'; i++) g.battleNext()
        act(g, { action: 'net_surrender' })
        await g.finishBattle()
        await untilIdle(g)
        expect(defeatOf(g.state)).toMatchObject({ event: 'df_tw_pinned', stage: 'played', net: true })
      })
      await f.step('選「回到這個階段開始時」：回到第一階段選面之前，網內的行程與地圖都沒了，委託還在進行', () => {
        expect(g.rewindToStage()).toBeNull()
        expect(readRun(g.state)).toMatchObject({ stage: 1, step: 'face' })
        expect(g.state.time).toEqual(stageStart.time)
        expect(g.state.money).toEqual(stageStart.money)
        expect(readNetRun(g.state)).toBeNull()
        expect(Object.values(g.state.maps.instances).some((i) => i.gen?.by === 'netrun')).toBe(false)
        expect(g.pendingDefeat).toBeNull()
        expect(g.battle).toBeNull()
        expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])
        expect(jobOf(g.state, job)!.status).toBe('active')
        expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
        expect(g.state.reports.some((r) => r.retracted && r.action === 'battle.end')).toBe(true)
      })
      await f.step('這一次改選現實面走完第一階段：接上第二階段，路線只有現實', async () => {
        await playStage(g)
        expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face' })
        expect(readRun(g.state)!.route.map((r) => r.face)).toEqual(['meat'])
        expect(view(g).trace.value).toBe(0)
      })
    })
  })
})

describe('冒煙 M3：被定位', () => {
  it('追蹤度推到 90、走三個探索回合 → 被定位（沒有三選一）→ 委託失敗、回到進去之前、目標勢力的敵對值加', async () => {
    const f = flow('被定位')
    const { game: g, job } = makeNetCommissionGame()
    const ends: Array<{ kind: string; outcome: string; result: Record<string, unknown> }> = []
    g.k.hooks.on('activity.end', 'smoke', ({ kind, outcome, result }) => { ends.push({ kind, outcome, result: structuredClone(result) }) })
    await guarded(g, async () => {
      const before = await f.step('出發、選內海、子網開起來', () => startNet(g, job))
      await f.step('把追蹤度推到 90：倒數開始（三個探索回合），畫面的階段是「被定位」', () => {
        const run = readNetRun(g.state)!
        g.commit({ kind: 'system', action: 'netrun.test', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'trace', key: run.map, set: 90 }], outcome: { result: 'ok', summary: '追蹤度推到 90。' } })
        expect(netrunView(g.k, g.state)!.trace).toMatchObject({ value: 90, stage: 'located', located: 3 })
        expect(g.state.reports.some((r) => r.action === 'netrun.pressure')).toBe(true)
      })
      await f.step('走三個探索回合：倒數到了，被定位', async () => {
        const reports = await netWalkRounds(g, 3)
        expect(actions(reports)).toContain('netrun.located')
        expect(g.battle).toBeNull()
        expect(g.pendingDefeat).toBeNull()
      })
      await f.step('委託失敗、回到進去之前；網內的行程交回 located、目標勢力的敵對值 +5', () => {
        expect(ends.find((e) => e.kind === 'face.net')).toMatchObject({ outcome: 'located', result: { located: true } })
        expect(ends.find((e) => e.kind === 'commission')!.outcome).toBe('failed')
        expect(g.state.time).toEqual(before.time)
        expect(g.state.money).toEqual(before.money)
        expect(readRun(g.state)).toBeNull()
        expect(readNetRun(g.state)).toBeNull()
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(jobOf(g.state, job)!.status).toBe('failed')
        expect(meterOf(g.k, g.state, 'hostility', 'f_gang')).toBe(5)
        expect(actions(g.state.reports.filter((r) => !r.retracted))).not.toContain('defeat.pending')
        expect(prefixProblems(g)).toEqual([])
      })
    })
  })
})

// ===================================================================================================================
// 存檔讀檔
// ===================================================================================================================

describe('冒煙 M3：子網走到一半、內海戰鬥打到一半、下載到一半各存一次，最後的狀態和沒有中斷的一樣', () => {
  const newGame = (): ReturnType<typeof makeNetCommissionGame> => makeNetCommissionGame()
  /** 不中斷的一遍只跑一次（中斷的那條和它比）。 */
  let straightRun: Promise<{ hash: string }> | null = null
  const straight = (): Promise<{ hash: string }> => {
    straightRun ??= (async () => {
      const t = newGame()
      await guarded(t.game, () => netCommissionFlow(flow('委託（內海）・不中斷'), t.game, t.job))
      return { hash: stateHash(t.game.state) }
    })()
    return straightRun
  }

  it('每一個檢查點讀完和讀之前一模一樣，讀完接著做；最後的狀態（雜湊）和不中斷的一遍一模一樣', async () => {
    const t = newGame()
    const g = t.game
    const loaded: string[] = []
    await guarded(g, () => netCommissionFlow(flow('委託（內海）・存檔'), g, t.job, (label) => {
      const before = stateHash(g.state)
      if (label === 'net.battle') expect(g.battle && !g.battle.result, '內海戰鬥還開著').toBeTruthy()
      if (label === 'net.walk') expect(readNetRun(g.state)).not.toBeNull()
      expect(g.load(g.save('manual', NOW, label)), label).toBeNull()
      expect(stateHash(g.state), label).toBe(before)
      if (label === 'net.battle') expect(g.battle).not.toBeNull()
      if (label === 'net.download') expect(netrunView(g.k, g.state)!.goal).toMatchObject({ kind: 'download', done: false })
      loaded.push(label)
    }))
    expect(loaded).toEqual(['net.walk', 'net.battle', 'net.download'])
    expect(stateHash(g.state)).toBe((await straight()).hash)
  })

  it('讀檔之後，戰敗的三選一照樣能選、被定位的倒數照樣走完（網內的活動與地圖都存得下）', async () => {
    const f = flow('存檔・戰敗與倒數')
    const { game: g, job } = makeNetCommissionGame()
    await guarded(g, async () => {
      await f.step('投降之後存檔：等著選的戰敗與事件視窗都還在；演完再存一次', async () => {
        await surrenderInNet(g, job)
        roundTrip(g, 'defeat-pending')
        expect(g.pendingDefeat).not.toBeNull()
        await untilIdle(g)
        roundTrip(g, 'defeat-played')
        expect(defeatOf(g.state)).toMatchObject({ stage: 'played', event: 'df_tw_pinned' })
      })
      await f.step('讀檔之後回到這個階段開始時，再存一次；再走一趟，推到 90 存檔，讀完倒數照走完', async () => {
        expect(g.rewindToStage()).toBeNull()
        roundTrip(g, 'after-rewind')
        g.commit(chooseFace(g.k, g.state, 'net'))
        g.commit(chooseBranch(g.k, g.state, 'assault'))
        const run = readNetRun(g.state)!
        g.commit({ kind: 'system', action: 'netrun.test', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'trace', key: run.map, set: 90 }], outcome: { result: 'ok', summary: '追蹤度推到 90。' } })
        roundTrip(g, 'located-countdown')
        expect(readNetRun(g.state)!.located).toBe(3)
        await netWalkRounds(g, 3)
        expect(jobOf(g.state, job)!.status).toBe('failed')
      })
    })
  })
})

// ===================================================================================================================
// 第二波：潛入、自己去挖、迷宮館
// ===================================================================================================================

describe('冒煙 M3：潛入（第二波）', () => {
  it('潛艙店潛入 → 自己去挖走完一層登出 → 再進去是同一張圖 → 迷宮館報新手組走完三層結算 → 登出回到現實', async () => {
    const f = flow('潛入')
    const { game: g } = makeDiveGame()
    const { k } = g
    await guarded(g, async () => {
      const before = await f.step('站在潛艙店（塔下的 F3），換成館方的比賽版構裝（潛入中不能換）', () => {
        expect(g.state.location).toMatchObject({ block: 'tw_tower', facility: 'F3' })
        const o = diveOptions(k, g.state)
        expect(o).toMatchObject({ ok: true, deck: 'own', cost: 30 })
        refitForRookie(g)
        return { cash: g.state.money.cash, location: { ...g.state.location }, deck: structuredClone(g.state.actors.pc!.ext.deck) }
      })
      await f.step('潛入：付費用、意識進內海（活動 dive）、身體留在艙裡；現實的事被擋下', () => {
        const reports = diveIn(g)
        expect(actions(reports)).toEqual(['dive.enter'])
        expect(g.state.money.cash).toBe(before.cash - 30)
        expect(readDive(g.state)).toMatchObject({ body: { location: before.location }, access: { type: 'fac_tw_pod' }, deck: 'own' })
        expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['dive'])
        expect(g.blockOf('commit:rest.sleep')).toMatch(/身體躺在/)
        expect(sites(k, g.state).map((s) => [s.id, s.block])).toEqual([['ns_tw_dig', null], ['ns_tw_guest', null]])
      })
      const firstMap = await f.step('選去處「蜂巢的辦公樓」：自己去挖的子網開起來；走完第一層（打遭遇、過閘門）', async () => {
        const reports = g.commit(diveGo(k, g.state, 'ns_tw_dig'))
        expect(actions(reports)).toEqual(['dive.go', 'netrun.enter'])
        const run = readNetRun(g.state)!
        expect(run).toMatchObject({ kind: 'netrun', region: 'tw_subnet', layer: 0 })
        expect(netrunView(k, g.state)).toMatchObject({ layer: { index: 1, total: 2 }, dig: { site: 'tw_site_a', facility: 'nf_tw_office', visits: 1 } })
        const map = JSON.stringify(g.state.maps.instances[run.map]!.gen!.map)
        await playNetStage(g, { noFace: true, layers: 1 })
        expect(netrunView(k, g.state)).toMatchObject({ layer: { index: 2, total: 2 } })
        return map
      })
      await f.step('登出（網內的這一趟）：東西都帶走、還在潛入中（活動回到 dive）', () => {
        const reports = g.commit(logout(k, g.state))
        expect(actions(reports)).toEqual(['netrun.logout'])
        expect(reports[0]!.outcome.result).toBe('left')
        expect(readNetRun(g.state)).toBeNull()
        expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['dive'])
      })
      await f.step('再進去同一個去處：同一張圖（七天內留著）、進去第二次', () => {
        g.commit(diveGo(k, g.state, 'ns_tw_dig'))
        const run = readNetRun(g.state)!
        expect(JSON.stringify(g.state.maps.instances[run.map]!.gen!.map)).toBe(firstMap)
        expect(netrunView(k, g.state)!.dig).toMatchObject({ site: 'tw_site_a', visits: 2 })
        g.commit(logout(k, g.state))
      })
      const money = await f.step('迷宮館報名新手組：付押金、館方租比賽甲板、開三層', () => {
        const cash = g.state.money.cash
        const reports = mazeSignUp(g, 'rookie', 11)
        expect(actions(reports)).toEqual(['maze.enter', 'netrun.enter'])
        expect(g.state.money.cash).toBe(cash - 50)
        expect(readMaze(g.state)).toMatchObject({ bracket: 'rookie', grade: 1, deposit: 50, rented: ['pc'] })
        expect(netrunView(k, g.state)).toMatchObject({ region: { id: 'maze' }, layer: { index: 1, total: 3 } })
        expect(netExt(g.state, readNetRun(g.state)!.map)!.region).toBe('maze')
        expect(mazeView(k, g.state)!.layers.map((l) => l.name)).toEqual(['前庭', '迴廊', '館主廳'])
        return cash
      })
      await f.step('走完三層：每層解機關、開寶箱、打遭遇、過閘門；層與層之間休息；最後通過出口', async () => {
        const reports = await playMaze(g)
        const names = actions(reports)
        expect(names.filter((a) => a === 'maze.rest')).toHaveLength(2)
        expect(names.filter((a) => a === 'netrun.descend')).toHaveLength(2)
        expect(names).toEqual(expect.arrayContaining(['maze.use', 'netrun.use', 'netrun.end', 'maze.result']))
        expect(readNetRun(g.state)).toBeNull()
      })
      await f.step('結算：評價、獎金、押金退回、籌碼換現金；迷宮館的狀態清乾淨、租的甲板收回；人還在潛入中', () => {
        const result = g.state.reports.find((r) => r.action === 'maze.result')!
        const data = result.timeline[0]!.data as { outcome: string; rating: string; prize: number; refund: number; chips: number; chipCash: number; downs: number }
        expect(data).toMatchObject({ outcome: 'done', refund: 50, downs: 0 })
        expect(['S', 'A', 'B', 'C']).toContain(data.rating)
        expect(data.chips).toBeGreaterThan(0)
        expect(g.state.money.cash).toBe(money - 50 + data.prize + data.refund + data.chipCash)
        expect(readMaze(g.state)).toBeNull()
        expect(g.state.counters).not.toHaveProperty(`${MAZE_EXT}:z1:chips`)
        expect(deckOf(k, g.state, 'pc').source).toBe('own')
        expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['dive'])
      })
      await f.step('登出：意識回到身體、活動結束，現實的事又做得了', () => {
        const reports = g.commit(diveExit(k, g.state))
        expect(actions(reports)).toEqual(['dive.exit'])
        expect(readDive(g.state)).toBeNull()
        expect(g.state.location).toEqual(before.location)
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(g.blockOf('commit:rest.sleep')).toBeNull()
        expect(prefixProblems(g)).toEqual([])
        // 報告的前綴碰到了第二波的三個
        const seen = new Set(g.state.reports.map((r) => r.action!.split('.')[0]))
        for (const p of ['dive', 'maze', 'netrun', 'deck']) expect(seen, p).toContain(p)
      })
    })
  })
})

describe('冒煙 M3：租用甲板的潛入（第二波）', () => {
  it('沒有自己的甲板：潛艙店租一副（費用加押金）→ 去訪客也進得去的子網 → 登出：退押金、收回租來的甲板', async () => {
    const f = flow('潛入（租甲板）')
    const { game: g } = makeDiveGame({ noDeck: true })
    const { k } = g
    await guarded(g, async () => {
      const cash = await f.step('站在潛艙店，沒有甲板：問得到租用的價錢（費用 30、押金 50）', () => {
        expect(deckOf(k, g.state, 'pc').has).toBe(false)
        expect(diveOptions(k, g.state)).toMatchObject({ ok: true, deck: 'rental', fee: 30, deposit: 50, cost: 80 })
        return g.state.money.cash
      })
      await f.step('潛入：付 80，用的是租來的甲板（館方的 I 級）', () => {
        diveIn(g)
      })
      await f.step('選訪客也進得去的去處：子網開起來；沒有構裝的人先登出（東西都帶走）', () => {
        expect(g.state.money.cash).toBe(cash - 80)
        expect(deckOf(k, g.state, 'pc')).toMatchObject({ source: 'rental', grade: 1 })
        g.commit(diveGo(k, g.state, 'ns_tw_guest'))
        expect(netrunView(k, g.state)).toMatchObject({ region: { id: 'tw_subnet' }, dig: { site: 'tw_site_b' } })
        g.commit(logout(k, g.state))
      })
      await f.step('登出回到現實：押金退回（現金少了費用 30），租來的甲板收回', () => {
        g.commit(diveExit(k, g.state))
        expect(g.state.money.cash).toBe(cash - 30)
        expect(deckOf(k, g.state, 'pc').has).toBe(false)
        expect(readDive(g.state)).toBeNull()
        expect(prefixProblems(g)).toEqual([])
      })
    })
  })
})

// ===================================================================================================================
// 種子重播的固定檔
// ===================================================================================================================

describe('冒煙 M3：種子重播的固定檔（engine/tests/fixtures/repro/）', () => {
  const dir = fileURLToPath(new URL('../fixtures/repro', import.meta.url))
  const load = (id: string): Repro => JSON.parse(readFileSync(joinPath(dir, `${id}.json`), 'utf8')) as Repro
  const stepsOf = (r: Repro): string[] => r.inputs.map((i) => (i.type === 'm2' || i.type === 'm3' ? i.do : i.type))

  it.each([['m3-net-commission', 'net_commission'], ['m3-dive', 'dive']])('%s：在、步驟都是 M3_STEPS 裡有的、寫了期望（重播與「跑兩次一樣」由 tests/repro/replay.test.ts 做）', (id, named) => {
    const r = load(id)
    expect(r.id).toBe(id)
    expect(r.setup.named).toBe(named)
    const steps = r.inputs.filter((i) => i.type === 'm3').map((i) => (i as { do: string }).do)
    expect(steps.length).toBeGreaterThan(3)
    for (const s of steps) expect(Object.keys(M3_STEPS), s).toContain(s)
    expect(Object.keys(r.expect.paths ?? {})).toEqual(expect.arrayContaining(['time', 'money', 'rng.cursor']))
  })

  it('兩份固定檔涵蓋冒煙的內海委託與潛入兩條：委託有出發、四個階段（兩個內海、兩個現實）、下載到一半存讀檔；潛入有潛入、自己去挖兩次、迷宮館、登出', () => {
    const net = stepsOf(load('m3-net-commission'))
    expect(net.filter((s) => s === 'net_stage')).toHaveLength(4)
    expect(net.filter((s) => s === 'stage')).toHaveLength(2)
    for (const s of ['go', 'net_walk', 'net_use', 'save_load', 'until_idle']) expect(net, s).toContain(s)
    const dive = stepsOf(load('m3-dive'))
    expect(dive.filter((s) => s === 'dive')).toHaveLength(4)
    expect(dive.filter((s) => s === 'net_logout')).toHaveLength(2)
    for (const s of ['maze', 'net_stage', 'save_load']) expect(dive, s).toContain(s)
  })
})

// ===================================================================================================================
// 整體
// ===================================================================================================================

describe('冒煙 M3：整體', () => {
  it('報告的前綴清單：M2 的加上 deck、netrun、dive、maze（0018 第十三節）；清單裡每個前綴都是「小寫英文」、沒有重複', () => {
    expect(M3_ACTION_PREFIXES).toEqual(expect.arrayContaining(['deck', 'netrun', 'dive', 'maze', 'commission', 'battle']))
    expect(M3_ACTION_PREFIXES.every((p) => /^[a-z_]+$/.test(p))).toBe(true)
    expect(new Set(M3_ACTION_PREFIXES).size).toBe(M3_ACTION_PREFIXES.length)
    // 反例：沒有前綴的動詞、別人的前綴、大小寫都抓得到
    const g = makeNetBattleGame({ noBattle: true }).game
    expect(prefixProblems(g)).toEqual([])
    g.commit({ kind: 'system', action: 'netrun.test', location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試' } })
    g.commit({ kind: 'system', action: 'test.ok', location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試' } })
    expect(prefixProblems(g)).toEqual([])
    g.state.reports[g.state.reports.length - 1]!.action = 'wait'
    g.state.reports[g.state.reports.length - 2]!.action = 'mystery.go'
    expect(prefixProblems(g)).toEqual(['mystery.go', 'wait'])
  })

  it('步驟表：M2 的步驟都在，加上 net_stage、net_walk、net_use、net_logout、dive、maze；種子重播的步驟名對得上', () => {
    expect(Object.keys(M3_STEPS)).toEqual(expect.arrayContaining([...Object.keys(M2_STEPS), 'net_stage', 'net_walk', 'net_use', 'net_logout', 'dive', 'maze']))
    expect(Object.keys(M3_STEPS)).toHaveLength(Object.keys(M2_STEPS).length + 6)
  })

  it('接了那件委託之後，掮客桌上只剩生成的幾件、現實的中間人桌面不受影響（三件、都是現實的）', () => {
    const { game: g, job } = makeNetCommissionGame()
    expect(job).toBe('of_tw_net')
    expect(g.state.party).toEqual(['pc', 'a_tw_runner'])
    const net = board(g.k, g.state, NET_FIXER)
    expect(net.offers.map((o) => o.id)).not.toContain('of_tw_net')
    expect(net.offers.length).toBeGreaterThan(0)
    // 現實的中間人：市場那一位，三件、類型都是暗殺
    const market = board(g.k, g.state, FIXER)
    expect(market.offers).toHaveLength(3)
    expect(market.offers.every((o) => (o.offer.commission as { main?: string }).main === 'meat')).toBe(true)
  })
})
