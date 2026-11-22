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
  it('沒有任何事件可選：不留等待中的戰敗；沒有後果可以接受，這一場就這樣定案（開打前的快照丟掉，不卡在三選一）', async () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [pack([])], battle: 'hopeless', seed: 3 })
    playOut(game)
    const r = await game.finishBattle()
    expect(r.reports.map((x) => x.action)).toEqual(['battle.end'])
    expect(defeatOf(game.state)).toBeNull()
    expect(game.pendingDefeat).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
    // 沒有在等三選一：之後的事照常做得成
    expect(game.blockOf('chain:free_action')).toBeNull()
  })
})

describe('E1：等著選的戰敗擋住別的事；接受了才算數（COMBAT_SYSTEM 8.3、8.4 節）', () => {
  const pending = async () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [pack([ev({ id: 'df_generic', default: true, factions: [] })])], battle: 'hopeless', seed: 3, patch: { money: { cred: 0, cash: 2000 } } })
    playOut(game)
    await game.finishBattle()
    return game
  }
  const why = '先在戰敗的三個選擇裡選一個：接受結果、重來這場戰鬥，或回到這個階段開始時。'

  it('戰敗還沒選：自由行動、開另一場都被擋下，原因寫出來；戰敗的後果還沒發生', async () => {
    const game = await pending()
    expect(defeatOf(game.state)).not.toBeNull()
    expect(game.pendingDefeat).toMatchObject({ outcome: 'lose' })
    expect(await game.act({ kind: 'free', text: '回家睡覺' })).toMatchObject({ status: 'refused', reason: why })
    expect(() => game.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'actor', id: 'pc' }] })).toThrow(why)
    expect(defeatOf(game.state)).not.toBeNull()
  })

  it('接受結果：這份報告把開打前的快照丟掉，所以收得進去；之後不再擋，也不能再重來', async () => {
    const game = await pending()
    const reports = game.commit(acceptDefeat(game.k, game.state))
    expect(reports[0]).toMatchObject({ action: 'defeat.accept' })
    expect(defeatOf(game.state)).toBeNull()
    expect(game.pendingDefeat).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.blockOf('chain:free_action')).toBeNull()
    expect(game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
  })

  it('重來：戰敗跟著快照回去，沒有東西在等', async () => {
    const game = await pending()
    expect(game.retryBattle()).toBeNull()
    expect(defeatOf(game.state)).toBeNull()
    expect(game.pendingDefeat).toBeNull()
    expect(game.battle).toMatchObject({ round: 1 })
  })
})
