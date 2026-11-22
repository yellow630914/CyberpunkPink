// 驗收測試：dev/work/M1-defeat.md（cpp-feature）。工單做完之前照預期失敗（features/defeat 還不存在）。
// 規格：COMBAT_SYSTEM 8.3、8.4、8.5 節；ENEMIES 第 6 節（照性別分版本、內容篩選的分支；二十九種的分法留到 M2）；
// DATA 第 5 節（戰敗事件的格式；M1 只用到 versions 的 text 與 effects）；AI_TASKS 3.14 節（M1 是略過版：敘事加自動結算）。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { acceptDefeat, defeatFeature, defeatOf, pickDefeat } from '../../src/features/defeat'
import { TEST_COMBAT, makeBattleGame, makeGame, observed, playOut } from '../../src/testkit'

const version = (text: string, cash = -3000) => ({ text, effects: [{ kind: 'cash', amount: cash }, { kind: 'time', hours: 6 }] })
const PACK: ContentPack = {
  id: 'defeat_test',
  content: {
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'nora', name: '野良', short: '野良', class: 'street' }],
    defeat_event: [
      { id: 'df_t_arrest', name: '被捕審訊', kind: 'arrest', factions: ['hizakura'], fails_commission: true, tags: ['pc_unwilling'], adult: true, fallback: 'df_t_arrest_plain',
        versions: { default: version('你在一間白色的房間裡醒來。'), masc: version('兩位女性警備員低頭看著你。'), yuri: version('她把你的下巴抬起來。') } },
      { id: 'df_t_arrest_plain', name: '被捕審訊（不含非自願）', kind: 'arrest', factions: [], fails_commission: true, versions: { default: version('你被關了一晚，罰了一筆錢。', -500) } },
      { id: 'df_t_robbed', name: '被扒', kind: 'robbed', factions: ['nora'], fails_commission: false, versions: { default: { text: '你醒來的時候口袋是空的，人沒事。', effects: [{ kind: 'cash', amount: -99999 }] } } },
      // 沒有勢力對得上的時候用的那一個
      { id: 'df_generic', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: true, default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [] } } },
    ],
  },
}
const FEATURES = [defeatFeature, TEST_COMBAT]
/** 一場一定會輸的戰鬥打完並結算。 */
async function lose(o: { faction?: string; gender?: string; rules?: Record<string, unknown>; cash?: number; seed?: number; surrender?: boolean } = {}) {
  const { game } = makeBattleGame({ features: FEATURES, content: [PACK], battle: 'hopeless', seed: o.seed ?? 2, pc: { gender: o.gender ?? 'female' }, patch: { money: { cred: 0, cash: o.cash ?? 2000 }, rules: (o.rules ?? {}) as never } })
  if (o.faction) game.state.battle!.origin.faction = o.faction
  if (o.surrender) game.state.battle!.result = { outcome: 'surrender', text: '投降。' }
  else playOut(game)
  const { result, violations } = await observed(game, () => game.finishBattle())
  expect(violations).toEqual([])
  return { game, reports: result.reports }
}

describe('戰敗之後：先列出結果，再選要不要接受（COMBAT_SYSTEM 8.3、8.4 節）', () => {
  it('全隊倒下：戰鬥結束的報告之後接一份戰敗的報告（略過版：一段敘事加上會發生什麼）；結果還沒有套用', async () => {
    const { game, reports } = await lose({ faction: 'hizakura' })
    expect(reports.map((r) => r.action)).toEqual(['battle.end', 'defeat.pending'])
    expect(reports[1]).toMatchObject({ kind: 'event', outcome: { result: 'defeat' } })
    const d = defeatOf(game.state)!
    expect(d).toMatchObject({ event: 'df_t_arrest', faction: 'hizakura', outcome: 'lose', fails_commission: true })
    expect(['default', 'yuri']).toContain(d.version)
    // 會發生什麼列在結果裡（白話，不寫欄位名）；錢還沒扣、時間還沒過
    expect(d.lines).toEqual(['失去：現金 2,000', '時間：過了 6 小時'])
    expect(reports[1]!.narration!.results).toEqual(d.lines)
    expect(reports[1]!.outcome.summary).toMatch(/醒來|下巴/)
    expect(game.state.money.cash).toBe(2000)
    // 三個選擇一律開著：接受結果、重來這場戰鬥、回到這個階段開始時（副本以外等於重來）
    expect(d.choices).toEqual(['accept', 'retry', 'stage'])
    // 戰鬥開打前的快照留著，等玩家選
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['battle'])
  })

  it('投降也算戰敗，走同一個戰敗事件', async () => {
    const { game, reports } = await lose({ faction: 'hizakura', surrender: true })
    expect(reports.map((r) => r.action)).toEqual(['battle.end', 'defeat.pending'])
    expect(defeatOf(game.state)).toMatchObject({ outcome: 'surrender', event: 'df_t_arrest' })
  })

  it('打贏了、脫離了都沒有戰敗事件', async () => {
    const { game } = makeBattleGame({ features: FEATURES, content: [PACK], seed: 7 })
    expect(playOut(game).outcome).toBe('win')
    const r = await game.finishBattle()
    expect(r.reports.map((x) => x.action)).toEqual(['battle.end'])
    expect(defeatOf(game.state)).toBeNull()
  })

  it('接受結果：照那一版的效果結算（內建的事件照寫的算），清掉等待中的戰敗與戰鬥的快照', async () => {
    const { game } = await lose({ faction: 'hizakura', cash: 5000 })
    const time = game.state.time
    const [r] = game.commit(acceptDefeat(game.k, game.state))
    expect(r).toMatchObject({ kind: 'event', action: 'defeat.accept', outcome: { result: 'accepted' } })
    expect(game.state.money.cash).toBe(2000)
    expect(game.state.time.hour).toBe((time.hour + 6) % 24)
    expect(defeatOf(game.state)).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.state.flags.commission_failed).toBeUndefined() // 委託失敗是委託的旗標（M2）；這裡只把 fails_commission 寫在報告上
    expect(r!.outcome.summary).toMatch(/委託/)
    expect(() => acceptDefeat(game.k, game.state)).toThrow(/沒有等待中的戰敗/)
  })

  it('重來這場戰鬥：回到開打之前，等待中的戰敗跟著收回', async () => {
    const { game } = await lose({ faction: 'hizakura' })
    expect(game.retryBattle()).toBeNull()
    expect(defeatOf(game.state)).toBeNull()
    expect(game.battle).toMatchObject({ round: 1 })
    expect(game.state.money.cash).toBe(2000)
  })
})

describe('存檔規則的三個設定（COMBAT_SYSTEM 8.3 節）', () => {
  it('戰敗扣多少錢：最多身上現金的某個比例，另外可以設金額的上限；事件寫的超過上限時只拿到上限為止', async () => {
    const run = async (rules: Record<string, unknown>, cash: number) => {
      const { game } = await lose({ faction: 'hizakura', cash, rules })
      game.commit(acceptDefeat(game.k, game.state))
      return cash - game.state.money.cash
    }
    expect(await run({}, 5000)).toBe(3000) // 預設：照事件，最多 100%
    expect(await run({}, 1000)).toBe(1000)
    expect(await run({ defeatMoneyLoss: 0.5 }, 5000)).toBe(2500)
    expect(await run({ defeatMoneyLoss: 0 }, 5000)).toBe(0)
    expect(await run({ defeatMoneyCap: 800 }, 5000)).toBe(800)
    expect(await run({ defeatMoneyLoss: 0.5, defeatMoneyCap: 800 }, 1000)).toBe(500)
  })

  it('戰敗事件要不要看：M1 還沒有可以演的內容，三種設定都是略過版；設定記在等待中的戰敗上，之後的批次照它分流', async () => {
    for (const view of ['always', 'skippable', 'never'] as const) {
      const { game } = await lose({ faction: 'hizakura', rules: { defeatView: view } })
      expect(defeatOf(game.state)).toMatchObject({ view, skipped: true })
    }
  })
})

describe('選哪一個戰敗事件、哪一個版本（ENEMIES 第 6 節）', () => {
  it('照贏的那一方的勢力；沒有對得上的用通用的；內容篩選關掉的題材改走 fallback', () => {
    const { game } = makeGame({ features: FEATURES, content: [PACK] })
    const pick = (faction: string | undefined, off: string[] = [], gender = 'female', roll = 0.1) => {
      game.state.rules.contentOff = off
      game.state.actors.pc!.gender = gender
      return pickDefeat(game.k, game.state, { faction, roll })
    }
    expect(pick('hizakura')).toMatchObject({ event: 'df_t_arrest', version: 'default' })
    expect(pick('nora')).toMatchObject({ event: 'df_t_robbed', fails_commission: false })
    expect(pick('unknown')).toMatchObject({ event: 'df_generic' })
    expect(pick(undefined)).toMatchObject({ event: 'df_generic' })
    expect(pick('hizakura', ['pc_unwilling'])).toMatchObject({ event: 'df_t_arrest_plain', version: 'default' })
    // 男一律 masc；女七成 default、三成 yuri；只寫了 default 的事件一律 default
    expect(pick('hizakura', [], 'male', 0.9).version).toBe('masc')
    expect(pick('hizakura', [], 'female', 0.9).version).toBe('yuri')
    expect(pick('hizakura', [], 'futa', 0.5).version).toBe('masc')
    expect(pick('nora', [], 'male', 0.5).version).toBe('default')
  })

  it('同一個狀態選到同一個版本（骰子是導出來的）；內容的格式錯誤擋下', async () => {
    const a = await lose({ faction: 'hizakura', seed: 5 }), b = await lose({ faction: 'hizakura', seed: 5 })
    expect(defeatOf(a.game.state)!.version).toBe(defeatOf(b.game.state)!.version)
    expect(() => makeGame({ features: FEATURES, content: [{ id: 'bad', content: { defeat_event: [{ id: 'df_bad', name: '壞的', kind: 'x', factions: ['ghost'], fails_commission: true, versions: {} }] } }] })).toThrow(/versions|ghost/)
  })
})
