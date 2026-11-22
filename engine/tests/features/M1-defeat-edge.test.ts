// M1-defeat 的補充單元測試：戰敗扣錢的分配、內容格式、沒有事件可選的情況。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { acceptDefeat, defeatFeature, defeatOf } from '../../src/features/defeat'
import { TEST_COMBAT, makeBattleGame, makeGame, playOut } from '../../src/testkit'

const pack = (events: unknown[]): ContentPack => ({ id: 'df_edge', content: { faction: [{ id: 'nora', name: '野良', short: '野良', class: 'street' }], defeat_event: events as never } })
const FEATURES = [defeatFeature, TEST_COMBAT]
const ev = (over: Record<string, unknown>) => ({ id: 'df_e', name: 'e', kind: 'generic', factions: ['nora'], fails_commission: false, versions: { default: { text: '醒來。', effects: [] } }, ...over })

async function lost(events: unknown[], cash: number, rules: Record<string, unknown> = {}) {
  const { game } = makeBattleGame({ features: FEATURES, content: [pack(events)], battle: 'hopeless', seed: 3, patch: { money: { cred: 700, cash }, rules: rules as never } })
  game.state.battle!.origin.faction = 'nora'
  playOut(game)
  await game.finishBattle()
  return game
}

describe('戰敗扣錢的分配', () => {
  const multi = ev({ versions: { default: { text: '被洗劫。', effects: [{ kind: 'cash', amount: -1000 }, { kind: 'cred', amount: -400 }, { kind: 'cash', amount: -500 }, { kind: 'cash', amount: -700 }] } } })
  it('超過的從後面往回減，減到 0 的拿掉；帳戶不受影響', async () => {
    const game = await lost([multi], 5000, { defeatMoneyLoss: 1, defeatMoneyCap: 1300 })
    game.commit(acceptDefeat(game.k, game.state))
    expect(5000 - game.state.money.cash).toBe(1300) // 1000 + 300（第三筆 500 減成 300，第四筆 700 拿掉）
    expect(700 - game.state.money.cred).toBe(400)
  })
  it('只有 cash 的負數受影響；事件給錢不被調', async () => {
    const game = await lost([ev({ versions: { default: { text: '撿到。', effects: [{ kind: 'cash', amount: 50 }] } } })], 100, { defeatMoneyLoss: 0 })
    game.commit(acceptDefeat(game.k, game.state))
    expect(game.state.money.cash).toBe(150)
  })
})

describe('內容與選擇', () => {
  it('格式錯誤的訊息：versions 的鍵、text、effects', () => {
    const bad = (e: Record<string, unknown>) => () => makeGame({ features: FEATURES, content: [pack([ev(e)])] })
    expect(bad({ versions: { weird: { text: 'x', effects: [] } } })).toThrow(/versions/)
    expect(bad({ versions: { default: { text: '', effects: [] } } })).toThrow(/versions.default.text/)
    expect(bad({ versions: { default: { text: 'x', effects: 'no' } } })).toThrow(/versions.default.effects/)
    expect(bad({ fails_commission: 'yes' })).toThrow(/fails_commission/)
    expect(bad({ fallback: 'df_nowhere' })).toThrow(/df_nowhere/)
  })
  it('default: true 整份內容最多一筆', () => {
    const two = [ev({ id: 'df_a', default: true, factions: [] }), ev({ id: 'df_b', default: true, factions: [] })]
    expect(() => makeGame({ features: FEATURES, content: [pack(two)] })).toThrow(/default/)
  })
  it('沒有任何事件可選：不留等待中的戰敗（玩家仍可重來）', async () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [pack([])], battle: 'hopeless', seed: 3 })
    playOut(game)
    const r = await game.finishBattle()
    expect(r.reports.map((x) => x.action)).toEqual(['battle.end'])
    expect(defeatOf(game.state)).toBeNull()
    expect(game.retryBattle()).toBeNull()
  })
})
