// 驗收測試：dev/work/M3-fix-review.md（cpp-architect）。M3 引擎修正批：依據 dev/reviews/2026-11-24-M3.md、dev/status.md「M3 審查的使用者裁決」、dev/adr/0018「M3 修正批」補記。
// 每一項一個行為測試（帶著全部功能的假世界：testkit 的 makeDiveGame、makeNetBattleGame、makeNetCommissionGame）：
//   必修 1  網內放行成人場景（戰敗事件開場景走得完）      必修 2  迷宮館報名要在潛入中、要有橋
//   應修 1  預備的追蹤度起點整趟只加一次                  應修 2  連動「追蹤度上升減半」對探索與戰鬥都有效
//   應修 3  網內的檢定體格換成意志                        應修 4  迷宮館結算還原潛艙店租的甲板、沒有武器構裝報不了名
//   應修 5  委託內海階段沒有橋或甲板的人留在現實當輔助    應修 6  閃斷那一回合不能用花 RAM 的行動、可以回填
//   應修 7  迷宮館打輸：醒在回復室、不走戰敗事件、潛入還在    應修 8  netrun 不直接改寫 actor.ext.deck
//   新規則  內海的感載基礎消退是 0（net_load_decay：甲板散熱加上去）
//   B023、B024 在 B023-*.test.ts、B024-*.test.ts
//   建議 1～5、資料檢查的警告

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Change, ContentPack, Feature } from '../../src'
import { ActionBlocked, BattleRun, beginTurn, effectCtx, meterOf, modeAttr, modeOf } from '../../src'
import { FEATURES } from '../../src/features'
import { chooseBranch, chooseFace, commissionView, readRun } from '../../src/features/commission'
import { defeatOf } from '../../src/features/defeat'
import { acceptDefeat } from '../../src/features/defeat'
import { deckOf } from '../../src/features/deck'
import { exit as diveExit, go as diveGo, readDive } from '../../src/features/dive'
import { go, jobOf } from '../../src/features/fixer'
import { enterBlocks, readMaze } from '../../src/features/maze'
import { logout, netExt, readRun as readNetRun } from '../../src/features/netrun'
import { skillAttr, spendKey } from '../../src/features/netrun/checks'
import { decayChanges, traceDelta } from '../../src/features/netrun/common'
import { traceChanges } from '../../src/features/netrun/nodes'
import { sceneRawOf } from '../../src/features/scene'
import {
  NET_FACTION, NET_REGION, diveIn, fightOut, makeActor, makeDiveGame, makeNetBattleGame, makeNetCommissionGame, mazeSignUp, netMarkers, netUse, observed, playNetStage, playStage, refitForRookie,
  standBeside, untilIdle, unwearDeck,
} from '../../src/testkit'
import type { Game } from '../../src/shell/game'

vi.setConfig({ testTimeout: 90_000 })

const reportActions = (g: Game): string[] => g.state.reports.map((r) => r.action ?? '')
const traceNow = (g: Game): number => {
  const run = readNetRun(g.state)
  return run ? meterOf(g.k, g.state, 'trace', run.map) : 0
}
const sysDraft = (changes: Change[], action = 'netrun.test') => ({ kind: 'system' as const, action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })

// ===================================================================================================================
// 必修 1：網內放行成人場景
// ===================================================================================================================

/** 一件帶成人場景的戰敗事件（對照 world.ts 的 EV_SCENE）：開頭一個選項「跟他走」直接進場景。 */
const SCENE_DEFEAT = {
  id: 'df_tw_net_scene', name: '被拖進後巷', kind: 'generic', factions: [], fails_commission: false, adult: true,
  cast: [{ role: 'a', gen: { kind: 'citizen', name: '熟客' } }],
  versions: {
    default: {
      text: '你在網內倒下，意識被拖進一個不是你選的地方。',
      stages: [{ options: [{ id: 'go', text: '跟他走。', outcomes: { any: [] }, adult_scene: { when: 'always', gate: 'fixed', nature: 'mutual', role: 'none', goal: 'please', circles: [['$pc', '$a']] } }] }],
    },
  },
}
const SCENE_PACK = { id: 'fix_scene', content: { defeat_event: [SCENE_DEFEAT, { ...SCENE_DEFEAT, id: 'df_tw_net_scene_fail', fails_commission: true }] } } as unknown as ContentPack

describe('必修 1：網內放行成人場景（scene.start、commit:scene.）', () => {
  it('潛入中、自己去的子網、委託的內海階段：三種活動都放行場景的開場與它自己的報告；現實的事照擋', () => {
    const { game: d } = makeDiveGame()
    diveIn(d)
    expect(d.blockOf('scene.start')).toBeNull()
    expect(d.blockOf('commit:scene.act')).toBeNull()
    expect(d.blockOf('commit:rest.sleep')).not.toBeNull()
    // 自己去的子網（netrun）：潛入的活動與網內的行程兩個都要放行
    d.commit(diveGo(d.k, d.state, 'ns_tw_guest'))
    expect(d.k.activity.active(d.state).map((a) => a.kind)).toEqual(['netrun', 'dive'])
    expect(d.blockOf('scene.start')).toBeNull()
    expect(d.blockOf('commit:scene.end')).toBeNull()
    expect(d.blockOf('commit:trade.checkout')).not.toBeNull()
    // 委託的內海階段（face.net 與委託副本）
    const { game: c, job } = makeNetCommissionGame()
    c.commit(go(c.k, c.state, job))
    c.commit(chooseFace(c.k, c.state, 'net'))
    c.commit(chooseBranch(c.k, c.state, 'assault'))
    expect(c.k.activity.active(c.state).map((a) => a.kind)).toEqual(expect.arrayContaining(['face.net', 'commission']))
    expect(c.blockOf('scene.start')).toBeNull()
    expect(c.blockOf('commit:scene.end')).toBeNull()
  })

  it('潛入中、自己去的子網裡內海打輸：戰敗事件的選項開成人場景，整步過得了放行；場景演完之後回到三選一，接受之後這一趟收掉（一般的子網：潛入照舊被強制斷線）', async () => {
    const { game: g } = makeDiveGame({ content: [SCENE_PACK] })
    diveIn(g)
    g.launch('netrun', { region: NET_REGION, grade: 1, faction: NET_FACTION, encounter: ['minion'], defeat_event: 'df_tw_net_scene' }, { by: 'core' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['netrun', 'dive'])
    const { violations } = await observed(g, async () => {
      await standBeside(g, netMarkers(g).find((m) => m.mark === 'f')!.id)
      netUse(g, 'fight', netMarkers(g).find((m) => m.mark === 'f')!.id)
      expect(g.battle).not.toBeNull()
      g.state.battle!.result = { outcome: 'lose', text: '全隊倒下。' }
      await g.finishBattle()
      expect(defeatOf(g.state)).toMatchObject({ event: 'df_tw_net_scene', tier: 'origin', net: true })
      // 事件視窗開起來、選第一個選項（進場景）、場景用「停下」收掉：整條路沒有被活動擋下
      const log = await untilIdle(g)
      expect(log.log.some((l) => l.startsWith('scene'))).toBe(true)
      expect(sceneRawOf(g.state)).toBeFalsy()
      expect(defeatOf(g.state)).toMatchObject({ stage: 'played' })
      g.commit(acceptDefeat(g.k, g.state))
    })
    expect(violations).toEqual([])
    // 一般的子網（不是熔斷的場地）打輸被接受：這一趟收掉，潛入的那一頭照舊被強制斷線、自動登出（不變）
    expect(readNetRun(g.state)).toBeNull()
    expect(readDive(g.state)).toBeNull()
    expect(reportActions(g)).toEqual(expect.arrayContaining(['scene.start', 'defeat.accept', 'dive.exit']))
  })

  it('委託的內海階段內海打輸（副本寫的 defeat_event 帶成人場景）：同一條路走得完，事件之後接受 = 委託失敗', async () => {
    const { game: g, job } = makeNetCommissionGame({ content: [SCENE_PACK] })
    // 副本自訂的戰敗事件：直接換成帶場景的那一件
    expect(jobOf(g.state, job)!.status).toBe('active')
    g.commit(go(g.k, g.state, job))
    g.commit(chooseFace(g.k, g.state, 'net'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    const run = readNetRun(g.state)!
    // 這一趟的設定帶 defeat_event：改寫進行中那一趟的設定（和副本的 def.defeat_event 同一個欄位）
    g.commit(sysDraft([{ op: 'ext', key: 'netrun', value: { ...(g.state.ext.netrun as Record<string, unknown>), setup: { ...run.setup, defeat_event: 'df_tw_net_scene_fail' } } }]))
    await playNetStage(g, { noFace: true, stopAt: 'foe' })
    netUse(g, 'fight', netMarkers(g).find((m) => m.mark === 'f')!.id)
    g.state.battle!.result = { outcome: 'lose', text: '全隊倒下。' }
    await g.finishBattle()
    const log = await untilIdle(g)
    expect(log.log.some((l) => l.startsWith('scene'))).toBe(true)
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_tw_net_scene_fail' })
    g.commit(acceptDefeat(g.k, g.state))
    expect(readRun(g.state)).toBeNull()
    expect(jobOf(g.state, job)!.status).toBe('failed')
  })
})

// ===================================================================================================================
// 必修 2：迷宮館報名要在潛入中、要有橋
// ===================================================================================================================

describe('必修 2：迷宮館報名要在潛入中、每個隊員都有橋', () => {
  it('沒有潛入：報不了名，原因是先潛入；狀態一點都沒動（沒付押金、沒租甲板、沒有 ext.dive）', () => {
    const { game: g } = makeDiveGame()
    refitForRookie(g)
    const cash = g.state.money.cash
    const blocks = enterBlocks(g.k, g.state, 'rookie')
    expect(blocks.join('')).toMatch(/要先從接入點潛入/)
    expect(() => mazeSignUp(g, 'rookie', 11)).toThrow(ActionBlocked)
    expect(g.state.money.cash).toBe(cash)
    expect(readMaze(g.state)).toBeNull()
    expect(readDive(g.state)).toBeNull()
  })

  it('潛入中、主角有橋：報得了名；隊上有人沒有橋就擋下，原因寫出是誰', () => {
    const { game: g } = makeDiveGame()
    refitForRookie(g)
    diveIn(g)
    expect(enterBlocks(g.k, g.state, 'rookie')).toEqual([])
    // 隊上多一個沒有橋的人
    g.commit(sysDraft([
      { op: 'actor.add', actor: makeActor({ id: 'mate_nb', name: '沒橋的人', role: 'companion' }) } as never,
      { op: 'party', id: 'mate_nb' },
    ]))
    const blocks = enterBlocks(g.k, g.state, 'rookie')
    expect(blocks.join('')).toMatch(/沒橋的人沒有橋/)
    expect(() => mazeSignUp(g, 'rookie', 11)).toThrow(/沒有橋/)
  })

  it('租甲板的人身上沒有任何構裝：潛入中報不了名，原因說要有能用的武器構裝', () => {
    const { game: g } = makeDiveGame({ noDeck: true })
    diveIn(g)
    expect(enterBlocks(g.k, g.state, 'rookie').join('')).toMatch(/要有能用的武器構裝/)
    expect(() => mazeSignUp(g, 'rookie', 11)).toThrow(ActionBlocked)
  })

  it('潛入中沒有能用的武器構裝：報不了名（潛入中不能換構裝，要先登出、裝好再來）；裝好再潛入就報得了', () => {
    const { game: g } = makeDiveGame()
    // 沒換成館方的比賽版：身上是街頭槍、不是比賽版（新手組不收）
    diveIn(g)
    expect(enterBlocks(g.k, g.state, 'rookie').join('')).toMatch(/比賽版/)
    g.commit(diveExit(g.k, g.state))
    refitForRookie(g)
    diveIn(g)
    expect(enterBlocks(g.k, g.state, 'rookie')).toEqual([])
    expect(mazeSignUp(g, 'rookie', 11).map((r) => r.action)).toEqual(['maze.enter', 'netrun.enter'])
  })
})

// ===================================================================================================================
// 應修 1：預備的追蹤度起點整趟只加一次
// ===================================================================================================================

describe('應修 1：預備（net_trace_start）整趟委託只在第一個內海階段加一次', () => {
  it('第一個內海階段從預備的值起算，後面的內海階段從上一段累計的值起算，不再扣一次', async () => {
    // 預備的替身：每個人 −5（兩個人合計 −10）；真的來源是技能的 prep.net.trace_start（abilities 的 net_trace_start）
    const PREP: Feature = { id: 'fix_prep', install: (k) => k.stats.addStatProvider('net_trace_start', 'fix_prep', () => [{ label: '預埋後門', value: -5, source: 'skill' }]) }
    const { game: g, job } = makeNetCommissionGame({ features: [PREP] })
    g.commit(go(g.k, g.state, job))
    g.commit(chooseFace(g.k, g.state, 'net'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    expect(traceNow(g)).toBe(-10)
    expect(readNetRun(g.state)!.setup).not.toHaveProperty('prep_done')
    await playNetStage(g, { noFace: true })
    const t1 = readRun(g.state)!.trace
    await playStage(g)
    await playStage(g)
    expect(readRun(g.state)).toMatchObject({ stage: 4, step: 'face' })
    // 第四階段（第二個內海階段）：起點就是副本帶著的整趟追蹤度，沒有再 −10
    g.commit(chooseFace(g.k, g.state, 'net'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    expect(readNetRun(g.state)!.setup).toMatchObject({ prep_done: true })
    expect(readRun(g.state)!.trace).toBe(t1)
    expect(traceNow(g)).toBe(t1)
  })
})

// ===================================================================================================================
// 應修 2：連動「追蹤度上升減半」對探索與戰鬥都有效
// ===================================================================================================================

describe('應修 2：連動 trace_half 減半的是所有追蹤度的上升（探索的、戰鬥的、效果的）', () => {
  it('探索：traceDelta 與 traceChanges（下載、警報節點、管理行動共用）正的量減半進位、減少的不動', () => {
    const { game: g } = makeDiveGame()
    diveIn(g)
    g.launch('netrun', { region: NET_REGION, grade: 1, faction: NET_FACTION, encounter: [], fx: { trace_half: true } }, { by: 'core' })
    const half = readNetRun(g.state)!
    expect(traceDelta(half, 2)).toBe(1)
    expect(traceDelta(half, 5)).toBe(3)
    expect(traceDelta(half, 10)).toBe(5)
    expect(traceDelta(half, -4)).toBe(-4)
    expect(traceChanges(g.k, g.state, half, 2)).toEqual([{ op: 'meter', kind: 'trace', key: half.map, delta: 1 }])
    expect(traceChanges(g.k, g.state, half, -3)).toEqual([{ op: 'meter', kind: 'trace', key: half.map, delta: -3 }])
    // 對照：沒有連動就照原量
    const { game: h } = makeDiveGame()
    diveIn(h)
    h.launch('netrun', { region: NET_REGION, grade: 1, faction: NET_FACTION, encounter: [] }, { by: 'core' })
    expect(traceChanges(h.k, h.state, readNetRun(h.state)!, 2)).toEqual([{ op: 'meter', kind: 'trace', key: readNetRun(h.state)!.map, delta: 2 }])
  })

  it('戰鬥：這一趟帶 trace_half，每輪 +3 變 +2（進位）；效果 net.trace +5 變 +3；沒有連動的一趟照原量', async () => {
    const play = async (half: boolean): Promise<{ trace: number; effect: number }> => {
      const { game: g } = makeNetBattleGame({ noBattle: true })
      g.startBattle({
        mode: 'net', grade: 1, cover: 'medium', field: { trace: 20 },
        allies: [{ from: 'actor', id: 'pc' }],
        foes: [{ from: 'enemy_pick', faction: NET_FACTION, grade: 1, rank: 'minion', color: 'pink', seed: 'half/0' }],
        origin: { escapable: true, place: '測試', faction: NET_FACTION, ext: { net: { reinforce: {}, ...(half ? { trace_half: true } : {}) } } },
      } as never)
      const run = new BattleRun(g.k, g.state, g.state.battle!)
      const before = g.state.battle!.field.trace as number
      run.effects([{ op: 'net.trace', amount: 5 }], { user: run.unit('a1'), source: { kind: 'field', id: 'half', name: 'half' } })
      const effect = (g.state.battle!.field.trace as number) - before
      // 兩輪：第 2 輪、第 3 輪開頭各加一次
      const start = g.state.battle!.field.trace as number
      for (let i = 0; i < 40 && g.battle && g.state.battle!.round < 3; i++) {
        const o = g.battleOptions()
        if (!o || o.waiting === 'over') break
        if (o.waiting === 'ai') g.battleNext()
        else g.battleAct({ action: 'end_turn' })
      }
      return { trace: (g.state.battle!.field.trace as number) - start, effect }
    }
    const full = await play(false)
    const halved = await play(true)
    expect(full.effect).toBe(5)
    expect(halved.effect).toBe(3)
    expect(full.trace).toBe(6)
    expect(halved.trace).toBe(4)
  })
})

// ===================================================================================================================
// 應修 3：網內的檢定體格換成意志
// ===================================================================================================================

describe('應修 3：網內戰鬥外的檢定也照戰場的 attr_as（體格由意志代替）', () => {
  it('modeAttr：內海 body→resolve、其他不變；現實不換；沒有這個戰場不換', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    expect(modeAttr(g.k.content, 'net', 'body')).toBe('resolve')
    expect(modeAttr(g.k.content, 'net', 'intellect')).toBe('intellect')
    expect(modeAttr(g.k.content, 'meat', 'body')).toBe('body')
    expect(modeAttr(g.k.content, 'nowhere', 'body')).toBe('body')
  })

  it('netrun 的檢定挑屬性（skillAttr）：基本功對的是體格的，在網內擲的是意志；智識、反應照舊', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    const attrOf = (skill: string): string | undefined => g.k.content.get('skill', skill)?.attr as string | undefined
    const bodySkills = g.k.content.list('skill').filter((s) => s.attr === 'body').map((s) => s.id)
    expect(bodySkills.length).toBeGreaterThan(0)
    for (const id of bodySkills) expect(skillAttr(g.k, id), id).toBe('resolve')
    expect(attrOf('stealth')).toBe('reflex')
    expect(skillAttr(g.k, 'stealth')).toBe('reflex')
    expect(skillAttr(g.k, 'interface')).toBe('intellect')
  })
})

// ===================================================================================================================
// 應修 4：迷宮館結算還原潛艙店租的甲板
// ===================================================================================================================

/** 租潛艙店的甲板的人（沒有自己的甲板）：先把兩件比賽版構裝放進身上的格子（甲板租下來才裝得上），潛入、報名、…… */
function rentalGame() {
  const t = makeDiveGame({ noDeck: true })
  t.game.commit(sysDraft([{ op: 'actor.ext', id: 'pc', key: 'deck', value: { slots: ['cs_tw_gun_rent', 'cs_tw_blade_rent'], scripts: [] } }]))
  return t
}
const rentalOf = (g: Game): unknown => (g.state.actors.pc!.ext.deck as { rental?: unknown } | undefined)?.rental

describe('應修 4：迷宮館結算把潛艙店租的甲板還原，不是收成沒有', () => {
  it('租甲板潛入 → 報新手組（館方蓋過那一副）→ 中途登出：潛艙店那一副還在、潛入照樣還在、登出時才收回與退押金', () => {
    const { game: g } = rentalGame()
    const cash0 = g.state.money.cash
    diveIn(g)
    expect(rentalOf(g)).toEqual({ deck: 'dk_tw_rent' })
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ has: true, source: 'rental' })
    mazeSignUp(g, 'rookie', 11)
    expect(readMaze(g.state)!.prior).toEqual({ pc: 'dk_tw_rent' })
    g.commit(logout(g.k, g.state))
    expect(readMaze(g.state)).toBeNull()
    expect(readDive(g.state)).not.toBeNull()
    expect(rentalOf(g)).toEqual({ deck: 'dk_tw_rent' })
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ has: true, source: 'rental' })
    g.commit(diveExit(g.k, g.state))
    expect(rentalOf(g)).toBeUndefined()
    // 費用 30 ＋ 迷宮館押金 50 沒收；潛艙店的押金 50 登出時退回
    expect(g.state.money.cash).toBe(cash0 - 30 - 50)
  })

  it('沒有租過的人（自己的甲板）：報名前沒有 rental，結算之後也沒有（不留下 prior）', () => {
    const { game: g } = makeDiveGame()
    refitForRookie(g)
    diveIn(g)
    mazeSignUp(g, 'rookie', 11)
    expect(readMaze(g.state)!.prior).toBeUndefined()
    g.commit(logout(g.k, g.state))
    expect(rentalOf(g)).toBeUndefined()
    // 全部功能的局裡自己的甲板是腦部的義體（M4-cyber-deck，testkit 的 wearDeck 放進腦部）：來源是 implant（M3 時是背包裡裝上的 own）
    expect(deckOf(g.k, g.state, 'pc').source).toBe('implant')
  })
})

// ===================================================================================================================
// 應修 5：委託內海階段，沒有橋或甲板的人留在現實當輔助
// ===================================================================================================================

describe('應修 5：委託的內海階段只收有橋、有甲板的人；其餘的人留在現實當輔助', () => {
  it('夥伴沒有橋：不進網內（網內的隊伍只有主角）、不上內海戰鬥；他算進現實面的輔助結算', async () => {
    const { game: g, job, runner } = makeNetCommissionGame()
    g.commit(sysDraft([{ op: 'actor.ext', id: runner, key: 'bridge', value: null }]))
    g.commit(go(g.k, g.state, job))
    expect(commissionView(g.k, g.state)!.faces.find((f) => f.face === 'net')!.block).toBeNull()
    const faceReports = g.commit(chooseFace(g.k, g.state, 'net'))
    // 這個階段現實面也開著：留在現實的夥伴擲輔助
    const aux = faceReports.flatMap((r) => r.timeline).filter((b) => b.tag === 'aux')
    expect(aux).toHaveLength(1)
    expect((aux[0]!.data as { face: string; people: string[] }).face).toBe('meat')
    expect((aux[0]!.data as { people: string[] }).people).toContain(runner)
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    expect(readNetRun(g.state)!.setup.party).toEqual(['pc'])
    await playNetStage(g, { noFace: true, stopAt: 'foe' })
    netUse(g, 'fight', netMarkers(g).find((m) => m.mark === 'f')!.id)
    const allies = Object.values(g.battle!.units).filter((u) => u.side === 'ally')
    expect(allies.map((u) => u.actor)).toEqual(['pc'])
    const r = await fightOut(g)
    expect(r!.outcome).toBe('win')
  })

  it('夥伴有橋但沒有甲板：同一件事（沒有甲板＝沒有構裝槽，不能戰鬥）；有橋有甲板的兩個人都進網內', () => {
    const both = makeNetCommissionGame()
    both.game.commit(go(both.game.k, both.game.state, both.job))
    both.game.commit(chooseFace(both.game.k, both.game.state, 'net'))
    both.game.commit(chooseBranch(both.game.k, both.game.state, 'assault'))
    expect(readNetRun(both.game.state)!.setup.party).toEqual(['pc', both.runner])
    const { game: g, job, runner } = makeNetCommissionGame()
    g.commit(unwearDeck(g.k, g.state, runner))
    g.commit(go(g.k, g.state, job))
    g.commit(chooseFace(g.k, g.state, 'net'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    expect(readNetRun(g.state)!.setup.party).toEqual(['pc'])
  })

  it('整隊都沒有橋或甲板：內海面選不了（原因寫出來），現實面照常', () => {
    const { game: g, job, runner } = makeNetCommissionGame()
    g.commit(sysDraft([{ op: 'actor.ext', id: runner, key: 'bridge', value: null }, { op: 'actor.ext', id: 'pc', key: 'bridge', value: null }]))
    g.commit(go(g.k, g.state, job))
    const faces = commissionView(g.k, g.state)!.faces
    expect(faces.find((f) => f.face === 'net')!.block).toMatch(/沒有人有橋與甲板/)
    expect(faces.find((f) => f.face === 'meat')!.block).toBeNull()
    expect(() => chooseFace(g.k, g.state, 'net')).toThrow(/沒有人有橋與甲板/)
  })
})

// ===================================================================================================================
// 應修 6：閃斷那一回合可以回填、不能用花 RAM 的行動
// ===================================================================================================================

describe('應修 6：閃斷的那一回合花 RAM 的行動都灰掉（回填、換構裝、腳本、換位照做）', () => {
  /** 讓輪到的我方單位閃斷：用核心的過載（RAM 歸零、給 flash 狀態）。 */
  function flashed() {
    const { game: g } = makeNetBattleGame()
    const o = g.battleOptions()!
    const me = g.state.battle!.units[o.current!]!
    new BattleRun(g.k, g.state, g.state.battle!).overload(me)
    return { g, id: me.id }
  }
  const opt = (g: Game, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)!

  it('閃斷中：攻擊、近戰、打牆、管理行動、工具（花 RAM）都灰掉並說「閃斷中」；回填、換構裝、腳本、換位、結束回合不灰', () => {
    const { g, id } = flashed()
    expect(g.state.battle!.units[id]!.statuses.map((s) => s.id)).toContain('flash')
    expect(g.state.battle!.units[id]!.pools.ram!.now).toBe(0)
    for (const a of ['net_attack', 'net_hit_wall']) {
      const x = opt(g, a)
      expect(x.ok, a).toBe(false)
      expect(x.blocks.join(''), a).toMatch(/閃斷中/)
    }
    // 回填：只花行動點，照做（RAM 補回來，留到下一個回合用）
    expect(opt(g, 'net_refill').ok).toBe(true)
    expect(opt(g, 'end_turn').ok).toBe(true)
    g.battleAct({ action: 'net_refill' })
    expect(g.state.battle!.units[id]!.pools.ram!.now).toBeGreaterThanOrEqual(2)
    // 補回 RAM 之後還是不能花：這個回合的攻擊還是灰的，直接下指令也被擋下
    const after = opt(g, 'net_attack')
    expect(after.ok).toBe(false)
    expect(after.blocks.join('')).toMatch(/閃斷中/)
    const tried = g.battleAct({ action: 'net_attack', target: { unit: Object.values(g.state.battle!.units).find((u) => u.side === 'foe')!.id } })
    expect(tried.status).not.toBe('applied')
    expect((tried.reasons ?? []).join('')).toMatch(/閃斷中/)
    // 管理行動也花 RAM
    const admin = g.battleOptions()!.actions.filter((a) => a.id.startsWith('adm_') && a.cost.ram)
    expect(admin.length).toBeGreaterThan(0)
    for (const a of admin) expect(a.ok, a.id).toBe(false)
  })

  it('AI 替閃斷的人出手也不會用花 RAM 的行動：回填之後照樣不攻擊；下一個回合起恢復', () => {
    const { g, id } = flashed()
    const foeLoad = (): number => Object.values(g.state.battle!.units).filter((u) => u.side === 'foe').reduce((n, u) => n + (u.load?.now ?? 0) + u.layers, 0)
    const before = foeLoad()
    for (let i = 0; i < 12 && g.battle && !g.battle.result && g.battleOptions()?.current === id; i++) g.battleNext({ anyone: true })
    expect(foeLoad()).toBe(before)
    // 下一個輪到他：flash 沒有了、RAM 有（回填的加上回合開頭的回復）、能攻擊
    for (let i = 0; i < 40 && !(g.battleOptions()?.current === id && g.battleOptions()?.waiting === 'player'); i++) {
      const o = g.battleOptions()!
      if (o.waiting === 'ai') g.battleNext()
      else g.battleAct({ action: 'end_turn' })
    }
    expect(g.state.battle!.units[id]!.statuses.map((s) => s.id)).not.toContain('flash')
    expect(opt(g, 'net_attack').ok).toBe(true)
  })
})

// ===================================================================================================================
// 應修 7：迷宮館打輸（熔斷）
// ===================================================================================================================

describe('應修 7：迷宮館打輸醒在回復室：不走戰敗事件、不強制登出、不沒收潛艙店押金；迷宮館的押金沒收', () => {
  it('租甲板潛入、報新手組、在館裡打輸：沒有等著三選一的戰敗；迷宮館結算押金沒收；潛入還在、沒有 over；登出時潛艙店的押金退回', async () => {
    const { game: g } = rentalGame()
    const cash0 = g.state.money.cash
    diveIn(g)
    mazeSignUp(g, 'rookie', 11)
    const foe = netMarkers(g).find((m) => m.mark === 'f')!
    await standBeside(g, foe.id)
    netUse(g, 'fight', foe.id)
    expect(g.battle!.field.safe).toBe(true)
    g.state.battle!.result = { outcome: 'lose', text: '全隊倒下。' }
    const reports = (await g.finishBattle()).reports
    expect(g.pendingDefeat).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
    expect(reportActions(g)).not.toContain('defeat.pending')
    expect(reports.map((r) => r.action)).toEqual(expect.arrayContaining(['battle.end', 'netrun.logout', 'maze.result']))
    const result = g.state.reports.find((r) => r.action === 'maze.result')!.timeline[0]!.data as { outcome: string; forfeited: number }
    expect(result).toMatchObject({ outcome: 'defeat', forfeited: 50 })
    expect(readMaze(g.state)).toBeNull()
    expect(readNetRun(g.state)).toBeNull()
    expect(readDive(g.state)).not.toBeNull()
    expect(readDive(g.state)!.over).toBeUndefined()
    expect(reportActions(g)).not.toContain('dive.exit')
    // 潛艙店租的甲板還在；登出時押金退回（只賠了費用 30 與迷宮館的 50）
    expect(rentalOf(g)).toEqual({ deck: 'dk_tw_rent' })
    g.commit(diveExit(g.k, g.state))
    expect(g.state.money.cash).toBe(cash0 - 30 - 50)
    const exitResult = g.state.reports.filter((r) => r.action === 'dive.exit').at(-1)!
    expect(exitResult.outcome.result).toBe('logout')
  })

  it('熔斷的場地投降也一樣；不是熔斷的場地（一般的子網）打輸照舊走戰敗事件', async () => {
    const { game: g } = rentalGame()
    diveIn(g)
    mazeSignUp(g, 'rookie', 11)
    const foe = netMarkers(g).find((m) => m.mark === 'f')!
    await standBeside(g, foe.id)
    netUse(g, 'fight', foe.id)
    g.battleAct({ action: 'net_surrender' })
    await g.finishBattle()
    expect(g.pendingDefeat).toBeNull()
    expect(readMaze(g.state)).toBeNull()
    expect(readDive(g.state)!.over).toBeUndefined()
    // 一般的子網
    const { game: h } = makeDiveGame()
    diveIn(h)
    h.commit(diveGo(h.k, h.state, 'ns_tw_dig'))
    const f2 = netMarkers(h).find((m) => m.mark === 'f')!
    await standBeside(h, f2.id)
    netUse(h, 'fight', f2.id)
    h.battleAct({ action: 'net_surrender' })
    await h.finishBattle()
    expect(defeatOf(h.state)).not.toBeNull()
  })
})

// ===================================================================================================================
// 應修 8：netrun 不直接改寫 actor.ext.deck
// ===================================================================================================================

describe('應修 8：用掉後門鑰匙時，帶著的腳本由 deck 的效果 deck_script_use 扣', () => {
  it('帶著的腳本比背包多：扣背包一件，帶著的腳本少一件（經 deck_script_use）；格式與上限由 deck 守著', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    const carried = (): number => (deckOf(g.k, g.state, 'pc').scripts.find((s) => s.item === 'it_tw_script')?.qty ?? 0)
    expect(carried()).toBe(2)
    // 背包 2 件、帶著 2 支：用掉一件之後背包剩 1，帶著的 2 比背包多 1，扣掉多的那 1
    const changes = spendKey(g.k, g.state, 'it_tw_script')
    expect(changes[0]).toEqual({ op: 'item', id: 'it_tw_script', qty: -1 })
    // netrun 自己不組 actor.ext 的變更：腳本的那一筆是效果算出來的，而且只動 scripts
    expect(changes).toHaveLength(2)
    g.commit(sysDraft(changes))
    expect(carried()).toBe(1)
    expect(g.state.inventory.find((s) => s.id === 'it_tw_script')!.qty).toBe(1)
  })

  it('背包夠用的時候不碰帶著的腳本；效果本身：帶著的裡沒有這一項不做事、不夠就扣到 0', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    g.commit(sysDraft([{ op: 'item', id: 'it_tw_script', qty: 1 }]))
    expect(spendKey(g.k, g.state, 'it_tw_script')).toEqual([{ op: 'item', id: 'it_tw_script', qty: -1 }])
    const res = (qty: number, item = 'it_tw_script') => g.k.effects.resolve([{ kind: 'deck_script_use', item, qty }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(res(1, 'it_tw_chip').changes).toEqual([])
    expect(res(1).errors).toEqual([])
    g.commit(sysDraft(res(5).changes))
    expect(deckOf(g.k, g.state, 'pc').scripts).toEqual([])
    // AI 與玩家要不到（只有內建的來源）
    expect(g.k.effects.resolve([{ kind: 'deck_script_use', item: 'it_tw_script' }], effectCtx(g.k, g.state, { source: 'ai' })).errors.length).toBeGreaterThan(0)
  })

  it('原始碼：features/netrun 沒有任何地方組 actor.ext 的 deck 變更（只讀它的共用格式）', () => {
    const dir = join(fileURLToPath(new URL('../../src/features/netrun', import.meta.url)))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8')
      expect(/op:\s*'actor\.ext'[^}]*key:\s*'deck'/.test(text), f).toBe(false)
    }
  })
})

// ===================================================================================================================
// 新規則：內海的感載基礎消退是 0
// ===================================================================================================================

describe('內海的感載不自然消退（基礎 0）：消退量只來自 net_load_decay（甲板散熱、技能、構裝、藥、狀態）與修正 decay', () => {
  it('戰場 net 的設定：decayStat 是 net_load_decay、基礎 0；現實不變（沒有 decayStat、基礎 2 ＋ mod(意志)）', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    const net = modeOf(g.k.content, 'net')!
    expect(net.decayStat).toBe('net_load_decay')
    expect(net.numbers.decayBase).toBe(0)
    const meat = modeOf(g.k.content, 'meat')!
    expect(meat.decayStat).toBeUndefined()
    expect(meat.numbers.decayBase).toBe(2)
  })

  it('戰鬥：回合開始時感載不消退（意志 18 也不消）；net_load_decay 有多少就消多少；敵方同樣不消', () => {
    const { game: g } = makeNetBattleGame()
    const b = g.state.battle!
    const pc = Object.values(b.units).find((u) => u.actor === 'pc')!
    const mate = Object.values(b.units).find((u) => u.actor === 'a_tw_n1')!
    const foe = Object.values(b.units).find((u) => u.side === 'foe')!
    // 甲板的散熱（入門甲板 cooling 1）成了單位的 decay；沒有甲板的敵人沒有
    expect(g.k.stats.stat(g.state, 'pc', 'net_load_decay')).toBe(1)
    expect(g.k.stats.stat(g.state, 'pc', 'deck_cooling')).toBe(1)
    expect(pc.decay).toBe(1)
    expect(foe.decay).toBeUndefined()
    for (const u of [pc, mate, foe]) u.load!.now = 10
    const run = new BattleRun(g.k, g.state, b)
    for (const u of [pc, mate, foe]) beginTurn(run, u)
    expect(pc.load!.now).toBe(9)
    expect(mate.load!.now).toBe(9)
    expect(foe.load!.now).toBe(10)
    // 修正 decay（技能、狀態）照加：搖籃曲那一類
    g.k.battle.modifier('fix_decay', (q) => (q.kind === 'decay' && q.unit.id === foe.id ? [{ label: '搖籃曲', value: 3, source: 'skill' }] : []))
    beginTurn(run, foe)
    expect(foe.load!.now).toBe(7)
  })

  it('探索：探索回合的消退 = 規則表 decay（0）＋ net_load_decay；沒有甲板散熱的人（net_load_decay 0）不消退', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    g.commit(sysDraft([{ op: 'actor.track', id: 'pc', track: 'load', delta: 8 }, { op: 'actor.track', id: 'a_tw_n1', track: 'load', delta: 8 }]))
    // 隊上兩個人都穿著入門甲板（散熱 1）：各消退 1
    const dec = decayChanges(g.k, g.state, true)
    expect(dec).toContainEqual({ op: 'actor.track', id: 'pc', track: 'load', delta: -1 })
    expect(dec).toContainEqual({ op: 'actor.track', id: 'a_tw_n1', track: 'load', delta: -1 })
    // 拿掉主角的甲板：他的消退是 0
    g.commit(unwearDeck(g.k, g.state, 'pc'))
    expect(g.k.stats.stat(g.state, 'pc', 'net_load_decay')).toBe(0)
    expect(decayChanges(g.k, g.state, true).some((c) => c.op === 'actor.track' && c.id === 'pc')).toBe(false)
  })

  it('其他來源：衍生數值 net_load_decay 加 provider（技能、藥、狀態）：戰鬥與探索都讀得到', () => {
    const BOOST: Feature = { id: 'fix_boost', install: (k) => k.stats.addStatProvider('net_load_decay', 'fix_boost', (_s, actor) => (actor === 'pc' ? [{ label: '冷卻藥', value: 2, source: 'item' }] : [])) }
    const { game: g } = makeNetBattleGame({ noBattle: true, features: [BOOST] })
    expect(g.k.stats.stat(g.state, 'pc', 'net_load_decay')).toBe(3)
    g.commit(sysDraft([{ op: 'actor.track', id: 'pc', track: 'load', delta: 10 }]))
    expect(decayChanges(g.k, g.state, true)).toContainEqual({ op: 'actor.track', id: 'pc', track: 'load', delta: -3 })
    g.startBattle({
      mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'enemy_pick', faction: NET_FACTION, grade: 1, rank: 'minion', color: 'pink', seed: 'd/0' }],
      origin: { escapable: true, place: '測試' },
    } as never)
    expect(g.state.battle!.units.a1!.decay).toBe(3)
  })

  it('現實的戰鬥不讀 net_load_decay（單位沒有 decay 這一欄）；內海戰鬥的單位另有欄位', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    g.startBattle({
      mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', seed: 'm/0' }],
      origin: { escapable: true, place: '測試' },
    } as never)
    expect(g.state.battle!.units.a1!.decay).toBeUndefined()
  })
})

// ===================================================================================================================
// 建議 1～5、資料檢查的警告
// ===================================================================================================================

describe('建議 1：FEATURES 的順序：maze 在 dive 後面（dive 的 afterReport 不冪等）', () => {
  it('順序寫死在測試裡守著', () => {
    const ids = Object.keys(FEATURES)
    expect(ids.indexOf('dive')).toBeGreaterThan(-1)
    expect(ids.indexOf('maze')).toBeGreaterThan(ids.indexOf('dive'))
  })
})

describe('建議 2：追蹤度量表只收這一趟自己的地圖', () => {
  it('效果指定別座還留著的地圖：沒有算（量表不動）；沒指定或指定這一趟的：照算', () => {
    const { game: g } = makeDiveGame()
    diveIn(g)
    g.commit(diveGo(g.k, g.state, 'ns_tw_guest'))
    const run = readNetRun(g.state)!
    const ctx = effectCtx(g.k, g.state, { source: 'ai' })
    const other = g.k.effects.resolve([{ kind: 'trace', amount: 5, key: 'net_other_map' }], ctx)
    expect(other.changes).toEqual([])
    const mine = g.k.effects.resolve([{ kind: 'trace', amount: 5, key: run.map }], ctx)
    expect(mine.changes).toEqual([{ op: 'meter', kind: 'trace', key: run.map, delta: 5 }])
    expect(netExt(g.state, run.map)).toBeTruthy()
  })
})

describe('建議 3：追蹤度增援只在這一場裡跨過門檻才叫', () => {
  const REINFORCE = {
    t30: { from: 'enemy_pick', faction: NET_FACTION, grade: 1, rank: 'minion', color: 'white', seed: 'w/30' },
    t60: { from: 'enemy_pick', faction: NET_FACTION, grade: 1, rank: 'minion', color: 'pink', seed: 'e/60' },
  }
  const start = (trace: number) => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    g.startBattle({
      mode: 'net', grade: 1, cover: 'medium', field: { trace },
      allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'enemy_pick', faction: NET_FACTION, grade: 1, rank: 'minion', color: 'pink', seed: 'cross/0' }],
      origin: { escapable: true, place: '測試', faction: NET_FACTION, ext: { net: { reinforce: REINFORCE } } },
    } as never)
    return g
  }
  const rounds = (g: Game, n: number): void => {
    const to = g.state.battle!.round + n
    for (let i = 0; i < 60 && g.battle && !g.battle.result && g.state.battle!.round < to; i++) {
      const o = g.battleOptions()
      if (!o || o.waiting === 'over') break
      if (o.waiting === 'ai') g.battleNext()
      else g.battleAct({ action: 'end_turn' })
    }
  }
  const callIns = (g: Game): number => (g.state.battle!.called ?? []).length

  it('開戰時追蹤度已經在 35：這一場裡 30 不再叫人（記成已經到過），過了 60 才叫 t60 的那一個', () => {
    const g = start(35)
    expect(g.state.battle!.field.t30).toBe(true)
    expect(g.state.battle!.field.t60).toBeUndefined()
    rounds(g, 2)
    expect(callIns(g)).toBe(0)
    expect(Object.values(g.state.battle!.units).some((u) => u.tags.includes('lace:white'))).toBe(false)
    // 這一場裡跨過 60：只叫 t60 的，不補叫 t30 的
    const run = new BattleRun(g.k, g.state, g.state.battle!)
    run.effects([{ op: 'net.trace', amount: 40 }], { user: run.unit('a1'), source: { kind: 'field', id: 'x', name: 'x' } })
    expect(g.state.battle!.field.t60).toBe(true)
    expect(callIns(g)).toBe(1)
    expect(Object.values(g.state.battle!.units).some((u) => u.tags.includes('lace:white'))).toBe(false)
  })

  it('開戰時追蹤度 65（兩個門檻都到過）：整場都沒有增援；對照：從 20 起算，這一場裡跨過 30 就叫', () => {
    const g = start(65)
    rounds(g, 3)
    expect(callIns(g)).toBe(0)
    const h = start(28)
    expect(h.state.battle!.field.t30).toBeUndefined()
    rounds(h, 1)
    expect(h.state.battle!.field.t30).toBe(true)
    expect(callIns(h)).toBe(1)
  })
})

describe('建議 5：自己去挖的追蹤度起點，來源取最高再加連動與預備的加減（和委託同一個寫法）', () => {
  it('traceStartOf：取最高的來源、加減相加', async () => {
    const { traceStartOf } = await import('../../src/features/netrun/dig')
    expect(traceStartOf([15, 0, 10], 0)).toBe(15)
    expect(traceStartOf([0, 10], -5)).toBe(5)
    expect(traceStartOf([], -10)).toBe(-10)
    expect(traceStartOf([30, 15], 5)).toBe(35)
  })
})

describe('資料檢查的警告（Feature.warnings）：網內的程式或蕾絲（白蕾絲除外）沒有 constructs', () => {
  it('Game.contentWarnings：粉蕾絲、黑蕾絲、程式沒有構裝要警告；白蕾絲、有構裝的、現實的兵種不警告；有 base 的先展開', async () => {
    const { makeGame } = await import('../../src/testkit')
    const { enemiesFeature } = await import('../../src/features/enemies')
    const e = (id: string, o: Record<string, unknown>): Record<string, unknown> => ({ id, name: id, desc: '測試。', faction: 'f_a', rank: 'minion', grades: [1, 5], position: { prefer: [1, 2], cover_use: 0.5 }, ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...o })
    const pack = {
      id: 'warn_enemies',
      content: {
        faction: [{ id: 'f_a', name: 'A', short: 'A', class: 'corp' }],
        skill: [{ id: 'firearms', name: 'firearms', desc: '槍。', attr: 'reflex' }],
        weapon_class: [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }],
        enemy: [
          e('en_pink_bare', { kind: 'lace', color: 'pink' }),
          e('en_black_bare', { kind: 'lace', color: 'black' }),
          e('en_prog_bare', { kind: 'program' }),
          e('en_white', { kind: 'lace', color: 'white' }),
          e('en_pink_ok', { kind: 'lace', color: 'pink', constructs: [{ id: 'cs_x', class: 'pistol', type: 'neural', ram: 1 }] }),
          e('en_human', { kind: 'human', mode: 'lethal', weapons: [{ class: 'pistol' }] }),
          e('en_pink_child', { base: 'en_pink_bare' }),
        ],
      },
    } as unknown as ContentPack
    const g = makeGame({ features: [enemiesFeature], content: [pack] }).game
    const w = g.contentWarnings()
    const ids = w.map((x) => /敵人 (\S+)（/.exec(x)?.[1])
    expect(ids.sort()).toEqual(['en_black_bare', 'en_pink_bare', 'en_pink_child', 'en_prog_bare'])
    expect(w.every((x) => x.includes('constructs'))).toBe(true)
    // 沒有警告的內容：空陣列
    const clean = makeGame({ features: [enemiesFeature], content: [{ id: 'c', content: { faction: pack.content.faction, enemy: [e('en_white', { kind: 'lace', color: 'white' })] } } as unknown as ContentPack] }).game
    expect(clean.contentWarnings()).toEqual([])
  })
})
