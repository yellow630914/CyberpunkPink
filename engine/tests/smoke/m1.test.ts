// 冒煙測試的主幹，M1 加的那一段（dev/test-harness.md 第 6 節）。固定種子、AI 關閉。
//   M1 加：走進地圖 → 走到敵人那一格開打 → 一場現實戰鬥打完 → 戰敗 → 戰敗事件（略過版）→ 重來這場戰鬥
//
// 這一份只用核心：戰鬥的行動是測試用的那一組（testkit 的 TEST_COMBAT），戰敗事件是核心的替身
//（掛在 report.after 上：戰敗的 battle.end 之後接一份自動結算的報告）。現實戰鬥、敵人、戰敗這幾個 L6 功能做完之後，
// 用真正的功能走同一條主幹的版本在 tests/pending/M1-smoke-features.test.ts（那幾張工單完成後搬進這個資料夾）。

import { describe, expect, it } from 'vitest'
import type { Feature, ReportDraft, SpecialMapEntry } from '../../src'
import { Game } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, commitViolations, makeActor, playOut, stateHash } from '../../src/testkit'

const SEED = 20261122

const MAP: SpecialMapEntry = {
  id: 'map_smoke', kind: 'test', size: [6, 3],
  sheets: [{
    id: 'hall', name: '走廊', size: [6, 3], layout: ['######', 'E.12GX', '######'],
    cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '門口' }, { id: 'G1', at: [4, 1], mark: 'G', name: '走廊盡頭的崗哨' }, { id: 'X1', at: [5, 1], mark: 'X', name: '後門' }],
    spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [3, 1], cover: 'sparse' }],
  }],
}

/** 核心的替身：走進保全崗就開打；戰敗之後接一份「略過版」的戰敗事件（敘事加自動結算：扣一半的現金）。 */
const stand: Feature = {
  id: 'smoke_stand',
  install: (k) => {
    k.grid.onMark('G', 'smoke_stand', (ctx, m) => ({ line: `撞上了${m.name}。`, battle: { ...BATTLE_SETUPS[ctx.state.flags.hopeless ? 'hopeless' : 'encounter'](), origin: { escapable: false, place: m.name, faction: 'hizakura' } } }))
    k.hooks.on('report.after', 'smoke_stand', ({ state, report }) => {
      if (report.action !== 'battle.end' || report.outcome.result !== 'lose') return
      const loss = Math.floor(state.money.cash * Math.min(1, state.rules.defeatMoneyLoss) * 0.5)
      const draft: ReportDraft = {
        kind: 'event', action: 'defeat.skip', location: state.location, party: [], timeline: [],
        changes: [...(loss ? [{ op: 'cash', delta: -loss }] : []), { op: 'flag', key: 'defeated_by', value: 'hizakura' }],
        outcome: { result: 'defeat', summary: `你醒來的時候人在巷子裡，身上少了 ${loss} 元。` },
      }
      return [draft]
    })
  },
}

describe('冒煙 M1：走進地圖 → 開打 → 一場現實戰鬥打完 → 戰敗事件（略過版）→ 重來', () => {
  it('主幹跑得完，每一步的狀態都對', async () => {
    const game = new Game({ strict: true, ai: { ai: 0 }, features: [TEST_COMBAT, stand], content: [{ id: 'smoke', content: { special_map: [MAP] } }] })
    game.k.probe.start()
    game.newGame({ seed: SEED })
    const pc = makeActor({ id: 'pc', name: '露', age: 22 })
    game.commit({ kind: 'system', action: 'creation.commit', location: {}, party: [], timeline: [], changes: [{ op: 'actor.add', actor: pc }, { op: 'pc', id: 'pc' }, { op: 'cash', delta: 1500 }], outcome: { result: 'created', summary: '建角完成。' } })

    // 1. 走進地圖，一路走到保全崗：這一步提交之後接著開戰
    game.enterMap('map_smoke')
    const walk = game.gridMove([4, 1])
    expect(walk.status).toBe('applied')
    expect(walk.reports.map((r) => r.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.battle).toMatchObject({ mode: 'meat', round: 1, origin: { place: '走廊盡頭的崗哨', escapable: false } })
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['battle'])

    // 2. 一場現實戰鬥打完（雙方由程式選動作）：同級的一般遭遇打得贏
    const won = playOut(game)
    expect(won.outcome).toBe('win')
    const end = await game.finishBattle()
    expect(end.status).toBe('applied')
    expect(end.reports[0]).toMatchObject({ kind: 'combat', action: 'battle.end', outcome: { result: 'win' } })
    expect(game.battle).toBeNull()
    // 這場戰鬥的每一步收成一份報告
    expect(game.state.reports.filter((r) => r.action === 'battle.step')).toEqual([])
    expect(game.state.reports.filter((r) => r.action === 'battle.end')).toHaveLength(1)
    expect(game.state.money.cash).toBe(1500)

    // 3. 存檔再讀檔，狀態一模一樣
    const hash = stateHash(game.state)
    expect(game.load(game.save('manual', '2026-11-22T00:00:00Z'))).toBeNull()
    expect(stateHash(game.state)).toBe(hash)

    // 4. 再撞一次崗哨，這次打不贏：戰敗 → 戰敗事件（略過版：敘事加自動結算）
    game.commit({ kind: 'system', action: 'test.setup', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'hopeless', value: true }], outcome: { result: 'ok', summary: '換一場打不贏的。' } })
    expect(game.gridMove('west').status).toBe('applied')
    expect(game.gridMove('east').reports.map((r) => r.action)).toEqual(['grid.move', 'battle.start'])
    expect(playOut(game).outcome).toBe('lose')
    const lost = await game.finishBattle()
    expect(lost.reports.map((r) => r.action)).toEqual(['battle.end', 'defeat.skip'])
    expect(lost.reports[1]!.outcome.summary).toBe('你醒來的時候人在巷子裡，身上少了 750 元。')
    expect(game.state.money.cash).toBe(750)
    expect(game.state.flags.defeated_by).toBe('hizakura')
    expect(game.battle).toBeNull()

    // 5. 重來這場戰鬥：回到開打之前（錢回來了、旗標收回），紀錄留著，照同一份設定再開打
    expect(game.retryBattle()).toBeNull()
    expect(game.state.money.cash).toBe(1500)
    expect(game.state.flags.defeated_by).toBeUndefined()
    expect(game.battle).toMatchObject({ round: 1, origin: { place: '走廊盡頭的崗哨' } })
    expect(game.state.reports.filter((r) => r.retracted).map((r) => r.action)).toEqual(expect.arrayContaining(['battle.end', 'defeat.skip']))

    // 全程：每一份報告的 changes 套用之後等於狀態的變化
    expect(commitViolations(game.k, game.k.probe.stop())).toEqual([])
  })

  it('同一個種子跑兩次，戰鬥的每一顆骰都一樣', () => {
    const run = () => {
      const game = new Game({ strict: true, ai: { ai: 0 }, features: [TEST_COMBAT] })
      game.newGame({ seed: SEED })
      game.startBattle(BATTLE_SETUPS.encounter())
      playOut(game)
      return game.state.reports.flatMap((r) => r.timeline.map((b) => b.roll?.natural)).filter((n) => n !== undefined)
    }
    const a = run()
    expect(a.length).toBeGreaterThan(10)
    expect(run()).toEqual(a)
  })
})
