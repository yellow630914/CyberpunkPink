// 冒煙測試的主幹，M2 加的那一段（dev/test-harness.md 第 6 節；dev/work/M2-smoke.md 第 3 點）。固定種子、AI 關閉。
// 每一條是一串有名字的步驟（testkit 的 flow）；任何一步斷了，錯誤訊息開頭寫出是哪一條、第幾步、叫什麼。
//
// 內容一律是 testkit 的 TEST_WORLD（最小的假世界），功能是全部（allFeatures()）加主角的武器；走的是真正的功能與真正的提交。
// 條目：
//   城市   走到另一區 → 搭車 → 進店買東西 → 打工一班 → 睡一覺 → 跨過週一付帳單
//   事件   走路觸發一件街頭事件 → 選一個帶檢定的選項 → 效果生效
//   場景   一件帶場景的事件 → 進場景 → 說話、主導、停下 → 結算
//   委託   看委託 → 接案 → 踩點一次 → 召集 → 進副本 → 三個階段各選面與分支、走地圖、打贏 → 做完入帳
//   撤退   進副本走一個階段 → 撤退 → 時間與錢回到出發之前、紀錄留著
//   戰敗   在副本裡投降 → 戰敗事件選完 → 接受 → 委託失敗、回到進去之前；另一條選「回到這個階段開始時」
//   主幹   整條主幹中途存檔讀檔一次，結果和沒有中斷的一樣
//
// 每一個數字都是「這一局這樣算出來」的結果（骰面來自固定的種子），不是設計書的承諾；設計書的數字在各功能自己的測試裡。

import { describe, expect, it } from 'vitest'
import type { Report } from '../../src'
import { meterOf, toMinutes } from '../../src'
import { chooseOption, eventView } from '../../src/features/director'
import { chooseBranch, chooseFace, commissionView, readRun, retreat } from '../../src/features/commission'
import { defeatOf, acceptDefeat } from '../../src/features/defeat'
import { board, jobOf, latestJob, accept, go, scout } from '../../src/features/fixer'
import { join, muster, readRoster } from '../../src/features/roster'
import { homeOf, sleepDraft } from '../../src/features/rest'
import { sceneAct, sceneNext, sceneOf } from '../../src/features/scene'
import { checkout, planCheckout } from '../../src/features/trade'
import { shift } from '../../src/features/work'
import { readBills } from '../../src/features/bills'
import { worldOf } from '../../src/features/world'
import type { Flow, WorldGame } from '../../src/testkit'
import {
  FIXER, RUNNER, STRONG_PC, engage, flow, makeCityGame, makeCommissionGame, makeRunner, makeWorldGame, observed, passUntil, playStage, rideTo, stateHash, surrender, untilIdle, walkAcross, walkTo,
} from '../../src/testkit'
import type { Game } from '../../src/shell/game'
import { arrive } from '../../src/features/world'

const minutes = (g: Game): number => toMinutes(g.state.time)
const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')
const setFlag = (g: Game, key: string): void => {
  g.commit({ kind: 'system', action: 'test.flag', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key, value: true }], outcome: { result: 'ok', summary: '測試用的旗標。' } })
}

/** 一條冒煙的結尾：每一份報告的 changes 套用之後等於狀態的變化（不變式第 2 條）。 */
async function guarded<T>(g: Game, fn: () => Promise<T>): Promise<T> {
  const { result, violations } = await observed(g, fn)
  expect(violations).toEqual([])
  return result
}

// ===================================================================================================================
// 每一條的步驟（主幹把它們接起來時也用同一份）
// ===================================================================================================================

type Checkpoint = (label: string) => void
const noop: Checkpoint = () => undefined

/** 城市：從塔下走過閘門到鏽帶 → 搭地鐵回市場 → 進商行買東西 → 在碼頭打工一班 → 回家 → 睡一覺 → 跨過週一付帳單。 */
async function cityFlow(f: Flow, g: Game, checkpoint: Checkpoint = noop): Promise<void> {
  const { k } = g
  await f.step('走到另一區（塔下 → 閘門 → 鏽帶的院子）', () => {
    const t0 = minutes(g)
    walkTo(g, 'E2')
    expect(g.state.location).toEqual({ district: 'tw_hive', block: 'tw_gate' })
    walkTo(g, 'E2')
    expect(g.state.location).toEqual({ district: 'tw_rust', block: 'tw_yard' })
    expect(worldOf(g.state).visited).toEqual(['tw_tower', 'tw_gate', 'tw_yard'])
    expect(minutes(g) - t0).toBe(26) // 蜂巢走一格 1 分鐘，兩段各 13 格
  })
  await f.step('搭地鐵回市場（付帳戶、等車、坐兩站、下車）', () => {
    walkTo(g, 'F1')
    expect(g.state.location).toMatchObject({ block: 'tw_yard', facility: 'F1' })
    const cred = g.state.money.cred
    const reports = rideTo(g, 'tw_metro', 's_market')
    expect(actions(reports)).toEqual(['transit.board', 'transit.wait', 'transit.stop', 'transit.stop', 'transit.alight'])
    expect(g.state.location).toMatchObject({ district: 'tw_hive', block: 'tw_market', facility: 'F3' })
    expect(cred - g.state.money.cred).toBe(2 + 1 + 1) // 起跳 2 加兩站
    expect(g.k.activity.active(g.state)).toEqual([]) // 下了車，車的活動結束
  })
  checkpoint('city.metro')
  await f.step('進商行買東西（罐頭兩個、急救包一個，付現金）', () => {
    walkTo(g, 'F1')
    expect(g.state.location.facility).toBe('F1')
    const cart = { buy: [{ item: 'i_tw_ration', qty: 2 }, { item: 'i_tw_medkit', qty: 1 }], pay: 'cash' as const }
    const plan = planCheckout(k, g.state, 's_tw_stall', cart)
    expect(plan.problems).toEqual([])
    const cash = g.state.money.cash
    const reports = g.commit(checkout(k, g.state, 's_tw_stall', cart))
    expect(actions(reports)).toEqual(['trade.checkout'])
    expect(cash - g.state.money.cash).toBe(plan.net)
    expect(plan.net).toBeGreaterThan(0)
    expect(g.state.inventory).toEqual([{ id: 'i_tw_ration', qty: 2 }, { id: 'i_tw_medkit', qty: 1 }])
  })
  checkpoint('city.shop')
  await f.step('在碼頭打工一班（四小時）', () => {
    walkTo(g, 'F2')
    const cash = g.state.money.cash
    const t0 = minutes(g)
    const reports = g.commit(shift(k, g.state, 'j_tw_porter', 4))
    expect(actions(reports)).toEqual(['work.shift'])
    expect(minutes(g) - t0).toBe(240)
    expect(g.state.money.cash).toBeGreaterThan(cash - 1) // 沒有領到工錢的班（大失敗）才會是零，扣不成負的
    expect(reports[0]!.outcome.summary).toContain('搬貨')
  })
  await f.step('走回塔下的住處', () => {
    walkTo(g, 'E2')
    expect(g.state.location.block).toBe('tw_tower')
    walkTo(g, 'F1')
    expect(g.state.location).toMatchObject({ block: 'tw_tower', facility: 'F1' })
    expect(homeOf(k, g.state)?.residence.id).toBe('r_tw_unit')
  })
  checkpoint('city.home')
  await f.step('等到星期日晚上，睡前收到下週帳單的提醒', () => {
    const reports = passUntil(g, { day: 6, hour: 23 })
    expect(actions(reports)).toEqual(['test.wait', 'bill.notice'])
    expect(reports[1]!.outcome.summary).toContain('房租 100')
  })
  await f.step('睡一覺跨過週一 06:00：收房租、記一週的帳', () => {
    const cred = g.state.money.cred
    const reports = g.commit(sleepDraft(k, g.state))
    expect(actions(reports)).toEqual(['rest.sleep', 'bill.settle'])
    expect(g.state.time).toEqual({ day: 7, hour: 7, minute: 0 })
    expect(cred - g.state.money.cred).toBe(100)
    expect(readBills(g.state).overdue).toBe(0)
  })
}

/** 事件：走路觸發一件街頭事件 → 選帶檢定的選項 → 效果生效。主角在街上。 */
async function eventFlow(f: Flow, g: Game): Promise<void> {
  const { k } = g
  await f.step('走一段路，導演擲到街頭事件，事件視窗開起來', () => {
    setFlag(g, 'tw_street_a')
    const reports = walkAcross(g)
    expect(actions(reports)).toContain('event.open')
    const v = eventView(k, g.state)!
    expect(v.event).toBe('ev_tw_street')
    expect(v.options.map((o) => o.id)).toEqual(['talk', 'leave', ...v.options.slice(2).map((o) => o.id)])
    expect(v.options[0]!.check).toMatchObject({ skill: 'negotiate', dc: 8 })
  })
  await f.step('事件開著時別的事被擋下（要先回應）', () => {
    expect(g.blockOf('commit:trade.checkout')).toMatch(/先回應/)
  })
  await f.step('選帶檢定的選項：照結果的等級給錢、旗標收回、事件關起來', () => {
    const cash = g.state.money.cash
    const reports = g.commit(chooseOption(k, g.state, 'talk'))
    const close = reports.find((r) => r.action === 'event.close')!
    const gain = { critical: 100, success: 50, fail: -5, fumble: -20 }[close.outcome.result as 'critical' | 'success' | 'fail' | 'fumble']
    expect(gain).toBeDefined()
    expect(g.state.money.cash - cash).toBe(gain)
    expect(g.state.flags.tw_street_a).toBe(false)
    expect(eventView(k, g.state)).toBeNull()
    expect(g.blockOf('commit:trade.checkout')).toBeNull()
    const roll = reports.flatMap((r) => r.timeline).find((b) => b.roll)?.roll
    expect(roll).toMatchObject({ skill: 'negotiate', attr: 'charm', dc: 8 })
  })
}

/** 場景：一件帶場景的事件 → 進場景 → 說話、主導、停下 → 結算。 */
async function sceneFlow(f: Flow, g: Game): Promise<void> {
  const { k } = g
  await f.step('進街區，導演擲到帶成人場景的事件', () => {
    setFlag(g, 'tw_street_b')
    walkAcross(g)
    const v = eventView(k, g.state)!
    expect(v.event).toBe('ev_tw_scene')
    expect(v.options.find((o) => o.id === 'go')!.scene).toBe(true)
    expect(v.cast).toHaveLength(1)
  })
  await f.step('選「跟他走」：事件收尾，場景開始（臨時的路人當對象）', () => {
    const reports = g.commit(chooseOption(k, g.state, 'go'))
    expect(actions(reports)).toEqual(['event.close', 'scene.start'])
    const s = sceneOf(g.state)!
    expect(s).toMatchObject({ pc: 'pc', nature: 'mutual', turn: 'pc', round: 1 })
    expect(g.state.actors[s.partner]!.name).toBe('熟客')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['scene'])
    expect(g.blockOf('commit:trade.checkout')).toMatch(/場景/)
  })
  await f.step('說話：接上一條連接；主導；把回合交出去，對方的幾步走完', () => {
    expect(sceneOf(g.state)!.links).toHaveLength(0)
    g.commit(sceneAct(k, g.state, { kind: 'talk', text: '你好。' }))
    expect(sceneOf(g.state)!.links).toHaveLength(1)
    const ap = sceneOf(g.state)!.ap.pc
    g.commit(sceneAct(k, g.state, { kind: 'dominate' }))
    expect(sceneOf(g.state)!.ap.pc).toBeLessThan(ap)
    g.commit(sceneAct(k, g.state, { kind: 'end_turn' }))
    for (let i = 0; i < 12 && sceneOf(g.state)?.turn === 'partner'; i++) g.commit(sceneNext(k, g.state))
    expect(sceneOf(g.state)).toMatchObject({ turn: 'pc', round: 2 })
  })
  await f.step('停下：場景結算（成人的報告、體悟、性經歷），活動結束', () => {
    const reports = g.commit(sceneAct(k, g.state, { kind: 'stop' }))
    expect(actions(reports)).toEqual(['scene.end'])
    expect(reports[0]!.adult).toBe(true)
    expect(reports[0]!.outcome.summary).toMatch(/契合 \d+/)
    expect(sceneOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(meterOf(k, g.state, 'insight')).toBeGreaterThan(0)
    expect(g.blockOf('commit:trade.checkout')).toBeNull()
  })
}

/** 委託：看委託 → 接案 → 踩點一次 → 召集 → 進副本 → 三個階段 → 做完入帳。主角站在市場，名冊還沒有人。 */
async function commissionFlow(f: Flow, g: Game, checkpoint: Checkpoint = noop): Promise<void> {
  const { k } = g
  const rep0 = meterOf(k, g.state, 'rep')
  const row = await f.step('看委託：中間人桌上今天有三件', () => {
    const view = board(k, g.state, FIXER)
    expect(view.open).toBe(true)
    expect(view.problems).toEqual([])
    expect(view.offers).toHaveLength(3)
    const r = view.offers[0]!
    expect(r.block).toBeNull()
    expect(r.brief.stages).toBe(3)
    return r
  })
  await f.step('接案（付現金）：委託進了手上', () => {
    const reports = g.commit(accept(k, g.state, { id: row.id, fixer: FIXER }, { pay: 'cash' }))
    expect(actions(reports)).toEqual(['fixer.accept'])
    expect(jobOf(g.state, row.id)).toMatchObject({ status: 'active', scouts: 0 })
  })
  await f.step('踩點一次：記下次數、花一個時段', () => {
    const t0 = minutes(g)
    const reports = g.commit(scout(k, g.state, row.id, 'survey'))
    expect(actions(reports)).toEqual(['fixer.scout'])
    expect(jobOf(g.state, row.id)!.scouts).toBe(1)
    expect(minutes(g) - t0).toBeGreaterThan(0)
  })
  checkpoint('commission.scouted')
  await f.step('召集：名冊上的行者進隊，隊伍兩個人', () => {
    g.commit(join(k, g.state, RUNNER, { pay: 'share' }))
    expect(Object.keys(readRoster(g.state).members)).toEqual([RUNNER])
    g.commit(muster(k, g.state, { party: [RUNNER], tagalong: [] }))
    expect(g.state.party).toEqual(['pc', RUNNER])
  })
  await f.step('進副本：開活動、存入口的快照、別的事被擋下', () => {
    const reports = g.commit(go(k, g.state, row.id))
    expect(actions(reports)).toEqual(['fixer.go', 'commission.enter'])
    expect(readRun(g.state)).toMatchObject({ stage: 1, step: 'face' })
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])
    expect(g.blockOf('commit:trade.checkout')).toMatch(/副本裡/)
    expect(g.blockOf('commit:rest.sleep')).toMatch(/副本裡/)
  })
  const t0 = minutes(g)
  for (const n of [1, 2, 3]) {
    await f.step(`第 ${n} 階段：選現實面、強攻、走地圖、打贏${n === 3 ? '、拿到目標、走到撤離點' : ''}`, async () => {
      const reports = await playStage(g)
      expect(actions(reports)).toEqual(expect.arrayContaining(['commission.face', 'commission.branch', 'battle.start', 'battle.end', 'commission.milestone']))
      expect(reports.filter((r) => r.action === 'battle.end').every((r) => r.outcome.result === 'win')).toBe(true)
      if (n < 3) expect(readRun(g.state)).toMatchObject({ stage: n + 1, step: 'face' })
      if (n < 3) expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    })
    if (n === 1) checkpoint('commission.stage1')
  }
  await f.step('做完入帳：副本結束、委託做完、報酬入帳、信譽增加', () => {
    expect(readRun(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(g.state.snapshots).toEqual([])
    expect(minutes(g) - t0).toBeGreaterThanOrEqual(360) // 三個階段各兩小時，加上踩點之後的等候以外不會再多於戰鬥之外的走路
    const job = jobOf(g.state, row.id)!
    expect(job.status).toBe('done')
    expect(job.payout).not.toBeNull()
    expect(g.state.reports.filter((r) => r.action === 'commission.finish')).toHaveLength(1)
    expect(g.state.reports.filter((r) => r.action === 'fixer.payout')).toHaveLength(1)
    expect(meterOf(k, g.state, 'rep')).toBeGreaterThan(rep0)
    expect(g.blockOf('commit:trade.checkout')).toBeNull()
  })
}

// ===================================================================================================================
// 城市
// ===================================================================================================================

describe('冒煙 M2：城市', () => {
  it('走到另一區 → 搭車 → 進店買東西 → 打工一班 → 睡一覺 → 跨過週一付帳單', async () => {
    const { game } = makeCityGame()
    expect(game.state.location).toMatchObject({ district: 'tw_hive', block: 'tw_tower' })
    expect(homeOf(game.k, game.state)?.home.id).toBe('r_tw_unit')
    await guarded(game, () => cityFlow(flow('城市'), game))
  })
})

// ===================================================================================================================
// 事件與場景
// ===================================================================================================================

describe('冒煙 M2：事件', () => {
  it('走路觸發一件街頭事件 → 選一個帶檢定的選項 → 效果生效', async () => {
    const { game } = makeCityGame()
    await guarded(game, () => eventFlow(flow('事件'), game))
  })

  it('沒有旗標就不會被事件打擾（主幹的其他條不受影響）', () => {
    const { game } = makeCityGame()
    const reports = walkAcross(game)
    expect(actions(reports)).not.toContain('event.open')
    expect(eventView(game.k, game.state)).toBeNull()
  })
})

describe('冒煙 M2：場景', () => {
  it('一件帶場景的事件 → 進場景 → 說話、主導、停下 → 結算', async () => {
    const { game } = makeCityGame()
    await guarded(game, () => sceneFlow(flow('場景'), game))
  })
})

// ===================================================================================================================
// 委託
// ===================================================================================================================

/** 委託的起點：強主角、站在市場、名冊裡的行者已經是角色（還沒進名冊）。 */
function commissionStart(): WorldGame {
  const t = makeWorldGame({ seed: 5, pc: STRONG_PC, actors: [makeRunner()], patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } } })
  t.game.commit(arrive(t.game.k, t.game.state, 'tw_market', 'E1'))
  return t
}

describe('冒煙 M2：委託', () => {
  it('看委託 → 接案 → 踩點一次 → 召集 → 進副本 → 三個階段各選面與分支、走地圖、打贏 → 做完入帳', async () => {
    const { game } = commissionStart()
    await guarded(game, () => commissionFlow(flow('委託'), game))
  })
})

describe('冒煙 M2：撤退', () => {
  it('進副本走一個階段 → 撤退 → 時間與錢回到出發之前、紀錄留著', async () => {
    const f = flow('撤退')
    const t = makeCommissionGame()
    const { game: g, job } = t
    const { k } = g
    await guarded(g, async () => {
      const before = await f.step('出發前的樣子', () => ({ time: { ...g.state.time }, money: { ...g.state.money }, inventory: structuredClone(g.state.inventory), flags: { ...g.state.flags } }))
      await f.step('出發、走完第一階段（錢與時間都動了）', async () => {
        g.commit(go(k, g.state, job))
        await playStage(g)
        expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face' })
        expect(minutes(g)).toBeGreaterThan(toMinutes(before.time))
        expect(g.state.money.cash).toBeGreaterThan(before.money.cash) // 戰利品
      })
      await f.step('第二階段選了面之後撤退：一份帶 rewind 的報告', () => {
        expect(commissionView(k, g.state)!.retreat.can).toBe(true)
        const reports = g.commit(retreat(k, g.state))
        expect(reports.map((r) => r.action)).toContain('commission.retreat')
        expect(reports[reports.length - 1]!.action).toBe('rewind')
      })
      await f.step('時間、錢、背包、旗標都回到出發之前；副本結束、快照用掉', () => {
        expect(g.state.time).toEqual(before.time)
        expect(g.state.money).toEqual(before.money)
        expect(g.state.inventory).toEqual(before.inventory)
        expect(g.state.flags).toEqual(before.flags)
        expect(readRun(g.state)).toBeNull()
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(g.state.snapshots.filter((s) => s.kind === 'entry' || s.kind === 'stage')).toEqual([])
      })
      await f.step('紀錄留著並標成被收回；委託還在手上、可以再出發', () => {
        const kept = g.state.reports.filter((r) => r.retracted).map((r) => r.action)
        expect(kept).toEqual(expect.arrayContaining(['commission.enter', 'commission.milestone', 'battle.end', 'commission.retreat']))
        expect(jobOf(g.state, job)!.status).toBe('active')
        expect(() => g.commit(go(k, g.state, job))).not.toThrow()
        expect(readRun(g.state)).toMatchObject({ stage: 1, step: 'face' })
      })
    })
  })
})

// ===================================================================================================================
// 戰敗
// ===================================================================================================================

describe('冒煙 M2：戰敗', () => {
  it('在副本裡投降 → 戰敗事件（兩段）選完 → 接受 → 委託失敗、回到進去之前', async () => {
    const f = flow('戰敗・接受')
    const { game: g } = makeWorldGame({ seed: 5, pc: STRONG_PC, patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } } })
    const { k } = g
    const ends: string[] = []
    k.hooks.on('activity.end', 'smoke', ({ kind, outcome }) => { ends.push(`${kind}:${outcome}`) })
    g.commit(arrive(k, g.state, 'tw_market', 'E1'))
    const before = { time: { ...g.state.time }, money: { ...g.state.money } }
    await guarded(g, async () => {
      await f.step('進辦公室的副本（自訂的戰敗事件算失敗），打完第一階段', async () => {
        g.launch('commission', { def: 'cm_tw_office' }, { by: 'smoke', ref: 'cm_tw_office' })
        await playStage(g)
        expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face' })
      })
      await f.step('第二階段開打之後投降：進入等著選的戰敗，戰敗事件（兩段）開起來', async () => {
        g.commit(chooseFace(k, g.state, 'meat'))
        g.commit(chooseBranch(k, g.state, 'assault'))
        engage(g)
        expect(g.battle).not.toBeNull()
        const reports = await surrender(g)
        expect(actions(reports)).toEqual(['battle.end', 'defeat.pending', 'event.open'])
        expect(g.pendingDefeat).not.toBeNull()
        expect(defeatOf(g.state)).toMatchObject({ event: 'df_tw_pow', stage: 'playing', choices: ['accept', 'retry', 'stage'] })
        expect(g.blockOf('commit:trade.checkout')).not.toBeNull()
      })
      await f.step('事件的兩段都用第一個選項走完', async () => {
        const log = await untilIdle(g)
        expect(log.log).toEqual(['event df_tw_pow/wait', 'event df_tw_pow/out'])
        expect(defeatOf(g.state)).toMatchObject({ stage: 'played' })
      })
      await f.step('接受：委託失敗、回到進去之前；時間與錢都回去，紀錄留著', () => {
        ends.length = 0
        const reports = g.commit(acceptDefeat(k, g.state))
        expect(actions(reports)).toEqual(expect.arrayContaining(['defeat.accept', 'rewind']))
        expect(ends).toEqual(['defeat:accept', 'commission:failed'])
        expect(g.state.time).toEqual(before.time)
        expect(g.state.money).toEqual(before.money)
        expect(readRun(g.state)).toBeNull()
        expect(g.pendingDefeat).toBeNull()
        expect(g.battle).toBeNull()
        expect(g.k.activity.active(g.state)).toEqual([])
        expect(g.state.reports.filter((r) => r.retracted).map((r) => r.action)).toEqual(expect.arrayContaining(['commission.enter', 'battle.end']))
      })
    })
  })

  it('在副本裡投降 → 戰敗事件選完 → 選「回到這個階段開始時」：回到第二階段選面之前，委託還在進行', async () => {
    const f = flow('戰敗・回到階段')
    const { game: g, job } = makeCommissionGame()
    const { k } = g
    await guarded(g, async () => {
      const stageStart = await f.step('出發、打完第一階段，記下第二階段開始時的樣子', async () => {
        g.commit(go(k, g.state, job))
        await playStage(g)
        return { time: { ...g.state.time }, money: { ...g.state.money }, alert: readRun(g.state)!.alert }
      })
      await f.step('第二階段選面、強攻、開打之後投降：等著選的戰敗', async () => {
        g.commit(chooseFace(k, g.state, 'meat'))
        g.commit(chooseBranch(k, g.state, 'assault'))
        engage(g)
        const reports = await surrender(g)
        expect(actions(reports)[0]).toBe('battle.end')
        expect(g.pendingDefeat).not.toBeNull()
      })
      await f.step('通用的戰敗事件走完（不算失敗）', async () => {
        await untilIdle(g)
        expect(defeatOf(g.state)).toMatchObject({ event: 'df_tw_generic', stage: 'played' })
      })
      await f.step('選「回到這個階段開始時」：回到第二階段剛開始，委託還在進行', () => {
        expect(g.rewindToStage()).toBeNull()
        expect(readRun(g.state)).toMatchObject({ stage: 2, step: 'face' })
        expect(g.state.time).toEqual(stageStart.time)
        expect(g.state.money).toEqual(stageStart.money)
        expect(readRun(g.state)!.alert).toBe(stageStart.alert)
        expect(g.pendingDefeat).toBeNull()
        expect(g.battle).toBeNull()
        expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])
        expect(jobOf(g.state, job)!.status).toBe('active')
        expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry']) // 階段的快照用掉了，重新選面時再存一份
        expect(g.state.reports.some((r) => r.retracted && r.action === 'battle.end')).toBe(true)
      })
      await f.step('接著把這個階段與最後一個階段走完，委託做完', async () => {
        await playStage(g)
        await playStage(g)
        expect(readRun(g.state)).toBeNull()
        expect(jobOf(g.state, job)!.status).toBe('done')
      })
    })
  })
})

// ===================================================================================================================
// 主幹
// ===================================================================================================================

/** 整條主幹：城市 → 街頭事件 → 場景 → 委託。checkpoint 在每一條的中途被叫到（測試在那裡存檔讀檔）。 */
async function trunk(g: Game, checkpoint: Checkpoint): Promise<void> {
  const f = flow('主幹')
  await cityFlow(f, g, checkpoint)
  await eventFlow(f, g)
  await sceneFlow(f, g)
  await f.step('搭地鐵回市場，站到中間人那一塊街區', () => {
    walkTo(g, 'F1')
    rideTo(g, 'tw_metro', 's_market')
    expect(g.state.location.block).toBe('tw_market')
  })
  await commissionFlow(f, g, checkpoint)
}

describe('冒煙 M2：整條主幹中途存檔讀檔一次，結果和沒有中斷的一樣', () => {
  const newTrunkGame = (): Game => makeCityGame({ pc: STRONG_PC, actors: [makeRunner()] }).game
  /** 不中斷的一遍只跑一次（兩條中斷的和它比）。 */
  let straightRun: Promise<{ hash: string; game: Game }> | null = null
  const straight = (): Promise<{ hash: string; game: Game }> => {
    straightRun ??= (async () => {
      const game = newTrunkGame()
      await guarded(game, () => trunk(game, noop))
      return { hash: stateHash(game.state), game }
    })()
    return straightRun
  }

  it('不中斷的一遍：城市 → 事件 → 場景 → 委託都走得完', async () => {
    const { game } = await straight()
    expect(latestJob(game.state)).toBeNull()
    expect(game.state.reports.some((r) => r.action === 'fixer.payout')).toBe(true)
  })

  // 一條在城市做完的時候（睡前：記著帳單、車票、買的東西），一條在副本第一階段做完的時候（副本的狀態、階段的快照、警戒、連動）
  it.each(['city.home', 'commission.stage1'])('在 %s 存檔再讀檔：最後的狀態和沒有中斷的一模一樣', async (point) => {
    const g = newTrunkGame()
    let loaded = 0
    await trunk(g, (label) => {
      if (label !== point) return
      const before = stateHash(g.state)
      expect(g.load(g.save('manual', '2026-11-23T00:00:00Z', 'smoke'))).toBeNull()
      expect(stateHash(g.state)).toBe(before)
      loaded += 1
    })
    expect(loaded).toBe(1)
    expect(stateHash(g.state)).toBe((await straight()).hash)
  })
})
