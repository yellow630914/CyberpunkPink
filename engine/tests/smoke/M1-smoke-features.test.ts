// 冒煙主幹的 M1 那一段，用真正的功能走一次（dev/test-harness.md 第 6 節）。固定種子、AI 關閉。
// M1 的功能工單（M1-data-rules、M1-combat、M1-enemies、M1-data-enemies、M1-gear、M1-explore、M1-defeat）都做完之後，
// 把這份搬到 tests/smoke/，它就進主套件。做完之前照預期失敗（功能的總表裡還沒有這幾個功能，資料裡還沒有遭遇）。
//
//   開新遊戲 → 建角 → 帶上武器 → 走進地圖 → 走到保全崗開打 → 一場現實戰鬥打完 → 存讀檔 → 打一場打不贏的 → 戰敗事件（略過版）→ 重來

import { describe, expect, it } from 'vitest'
import { BATTLE_EVENTS, Game } from '../../src'
import { FEATURES, allFeatures } from '../../src/features'
import { CORE_PACK } from '../../data'
import { commitViolations, playOut, stateHash } from '../../src/testkit'

const SEED = 20261122

describe('冒煙 M1（功能版）：一場現實戰鬥打完、戰敗事件（略過版）', () => {
  it('功能的總表有 M1 的功能；資料裡有戰場、傷害類型、狀態、武器的類型、敵人、遭遇、地圖、戰敗事件', () => {
    for (const id of ['combat', 'enemies', 'gear', 'explore', 'defeat']) expect(Object.keys(FEATURES), id).toContain(id)
    const game = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
    for (const kind of ['battle_mode', 'damage_type', 'battle_status', 'weapon_class', 'item', 'special_map', 'enemy', 'encounter', 'defeat_event']) expect(game.k.content.list(kind).length, kind).toBeGreaterThan(0)
    expect(game.k.content.checkRefs()).toEqual([])
  })

  it('主幹跑得完，每一步的狀態都對', async () => {
    const game = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true, ai: { ai: 0 } })
    game.k.probe.start()
    game.newGame({ seed: SEED })
    const { buildCreationReport } = await import('../../src/features/creation')
    game.commit(buildCreationReport(game.k, game.state, {
      name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
      attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }, attrBonus: { reflex: 1, body: 1 },
      skills: { firearms: 3, streetwise: 3, athletics: 2, composure: 2 }, perks: [],
    } as never))
    expect(game.state.pc).toBe('pc')

    // 一場一般遭遇：資料裡第一個 I 級的遭遇，主角一個人上（敵人照對決的修正）
    const { setupFromEncounter } = await import('../../src/features/enemies')
    const enc = game.k.content.list<{ id: string; grade: number }>('encounter').find((e) => e.grade === 1)!
    game.startBattle(setupFromEncounter(game.k, game.state, enc.id, { allies: [{ from: 'actor', id: 'pc' }] }))
    expect(game.battle).toMatchObject({ mode: 'meat', round: 1 })
    const first = playOut(game)
    expect(['win', 'lose']).toContain(first.outcome)
    const end = await game.finishBattle()
    expect(end.reports[0]).toMatchObject({ kind: 'combat', action: 'battle.end' })
    expect(game.battle).toBeNull()
    // 戰鬥的每一拍的標籤都在封閉清單裡（不變式第 54 條）；掃原始碼的版本在 tests/core/battle-m1b-review-core.test.ts
    const seen = new Set(game.state.reports.filter((r) => r.kind === 'combat').flatMap((r) => r.timeline.map((b) => b.tag)).filter(Boolean))
    expect(seen.size).toBeGreaterThan(3)
    for (const tag of seen) expect(BATTLE_EVENTS as readonly string[], String(tag)).toContain(tag)

    // 存檔再讀檔，狀態一模一樣
    const hash = stateHash(game.state)
    expect(game.load(game.save('manual', '2026-11-22T00:00:00Z'))).toBeNull()
    expect(stateHash(game.state)).toBe(hash)

    // 打輸了就有戰敗事件等著選：存檔規則預設「一律看」，事件視窗（M2-event-run）接著開起來，所以三選一的「接受」要等事件做完（M2-defeat）；重來這場戰鬥回到開打之前
    const { defeatOf } = await import('../../src/features/defeat')
    if (first.outcome === 'lose') {
      expect(end.reports.map((r) => r.action)).toEqual(['battle.end', 'defeat.pending', 'event.open'])
      expect(defeatOf(game.state)).toMatchObject({ skipped: false, stage: 'playing', choices: ['accept', 'retry', 'stage'] })
      expect(game.retryBattle()).toBeNull()
      expect(game.battle).toMatchObject({ round: 1 })
      expect(defeatOf(game.state)).toBeNull()
    } else expect(defeatOf(game.state)).toBeNull()

    expect(commitViolations(game.k, game.k.probe.stop())).toEqual([])
  })
})
