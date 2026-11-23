// 白箱測試：ui/src/stores/game.ts 裡 M0-ui-engine 改過的那幾處（第五節第 3 步）：
// 時間、兩種錢、紀錄改成引擎的投影；advance、addLog、改錢都經過引擎的提交點；存檔不再放時間與紀錄。
// 規格：dev/work/M0-ui-engine.md 第五節；dev/invariants.md 第 1、2、3、7 條；SERIES 第 6 節（委託副本的快照）。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGame } from './game'
import { useEngine } from './engine'

const json = (v: unknown) => JSON.stringify(v)

beforeEach(() => setActivePinia(createPinia()))

describe('時間與錢是引擎的投影', () => {
  it('還沒開過新局時放一個示範的局：第 14 天週一 17:20、帳戶 4620、現金 3700；紀錄是空的', () => {
    const g = useGame()
    const e = useEngine()
    expect([g.day, g.timeLabel, g.weekday, g.billIn]).toEqual([14, '17:20', '週一', 7])
    expect({ ...g.money }).toEqual({ acc: 4620, cash: 3700, fav: 2 })
    expect(e.money).toEqual({ cred: 4620, cash: 3700 })
    expect(g.log).toEqual([])
  })

  it('引擎已經有一局時，useGame 不蓋掉它', () => {
    const e = useEngine()
    e.newGame({ seed: 3 })
    e.ledger([{ op: 'cash', delta: 50 }])
    const before = json(e.state)
    const g = useGame()
    expect(json(e.state)).toBe(before)
    expect(g.day).toBe(1)
    expect(g.money.cash).toBe(50)
  })

  it('不變式第 1、2 條：advance 經過提交點（一份 ui.time 報告），不進紀錄；跨過午夜換日', () => {
    const g = useGame()
    const e = useEngine()
    const n = e.state.reports.length
    g.advance(7 * 60)
    expect(e.state.reports).toHaveLength(n + 1)
    expect(e.state.reports.at(-1)).toMatchObject({ action: 'ui.time', changes: [{ op: 'time', minutes: 420 }] })
    expect([g.day, g.timeLabel, g.minutes]).toEqual([15, '00:20', 20])
    expect(g.log).toEqual([])
  })

  it('不變式第 7 條「時間只往前走」：advance(0) 與負數什麼都不做', () => {
    const g = useGame()
    const e = useEngine()
    const before = json(e.state)
    g.advance(0)
    g.advance(-30)
    expect(json(e.state)).toBe(before)
  })

  it('M0-ui-engine 第五節第 3 步：改 money.acc／money.cash 是一筆帳（cred／cash 的 delta），不進紀錄', () => {
    const g = useGame()
    const e = useEngine()
    g.money.acc -= 620
    g.money.cash += 300
    expect(e.money).toEqual({ cred: 4000, cash: 4000 })
    expect(e.state.reports.slice(-2).map((r) => [r.action, r.changes])).toEqual([
      ['ui.money', [{ op: 'cred', delta: -620 }]],
      ['ui.money', [{ op: 'cash', delta: 300 }]],
    ])
    expect(g.log).toEqual([])
  })

  it('寫一樣的值不提交', () => {
    const g = useGame()
    const e = useEngine()
    const n = e.state.reports.length
    g.money.acc = g.money.acc
    expect(e.state.reports).toHaveLength(n)
  })

  it('money.fav 還在舊系統，不碰引擎', () => {
    const g = useGame()
    const e = useEngine()
    const before = json(e.state)
    g.money.fav = 5
    expect(g.money.fav).toBe(5)
    expect(json(e.state)).toBe(before)
  })

  it('不變式第 3、7 條：花超過身上的錢整筆不套，兩種錢不變成負數', () => {
    const g = useGame()
    const e = useEngine()
    const before = json(e.state)
    expect(() => { g.money.cash -= 3701 }).not.toThrow() // E5：不丟錯，整筆不套
    expect(json(e.state)).toBe(before)
    expect(g.money.cash).toBe(3700)
  })
})

describe('addLog：舊系統寫一則紀錄，交給引擎提交成一份報告', () => {
  it('UI 第 3.2 節：正文、引言、網內的段落接成正文；變化的字照 +／− 標顏色；地點預設是現在的位置', () => {
    const g = useGame()
    const e = useEngine()
    g.addLog({ prose: ['第一段'], quotes: ['「引言」'], net: ['網內'], changes: [{ text: '好感 +1', kind: 'plus' }, { text: '現金 −5', kind: 'minus' }] })
    expect(e.state.reports.at(-1)).toMatchObject({ kind: 'system', action: 'ui.legacy', outcome: { summary: '第一段' } })
    expect(g.log).toHaveLength(1)
    expect(g.log[0]).toMatchObject({ prose: ['第一段', '「引言」', '網內'], place: g.placeLabel, time: '第 14 天 17:20' })
    expect(g.log[0]!.changes).toEqual([{ text: '好感 +1', kind: 'plus' }, { text: '現金 −5', kind: 'minus' }])
  })

  it('給了地點就用給的；沒有正文時摘要是空字串、正文也是空的', () => {
    const g = useGame()
    g.addLog({ prose: [], place: '別的地方' })
    expect(g.log[0]).toMatchObject({ place: '別的地方', prose: [''] })
  })
})

describe('存檔的形狀（M0-ui-engine 第五節第 3 步：引擎的那幾樣不再放進假存檔）', () => {
  it('serialize 不放時間與紀錄', () => {
    const s = useGame().serialize() as unknown as Record<string, unknown>
    expect('day' in s).toBe(false)
    expect('minutes' in s).toBe(false)
    expect('log' in s).toBe(false)
  })

  it('hydrate：給的錢和引擎一樣時不多一份帳', () => {
    const g = useGame()
    const e = useEngine()
    const n = e.state.reports.length
    g.hydrate(g.serialize())
    expect(e.state.reports).toHaveLength(n)
  })

  it('saveMeta 的時間從引擎來', () => {
    const g = useGame()
    g.advance(40)
    expect(g.saveMeta('自動')).toMatchObject({ day: 14, time: '18:00', kind: '自動' })
  })
})

describe('戰鬥開打前的快照（地下城、子網的舊戰場；委託副本的階段快照在引擎）', () => {
  it('回到戰鬥開打前：錢回到當時；紀錄保留並多一則說明', () => {
    const g = useGame()
    const s = g.takeSnapshot('戰鬥', '戰鬥開打前')
    g.money.cash -= 200
    g.addLog({ prose: ['打了一架'] })
    g.rollback(s.id)
    expect(g.money.cash).toBe(3700)
    expect(g.log.map((x) => x.prose[0])).toEqual([expect.stringContaining('這一段經歷被收回了'), '打了一架'])
  })

  it('找不到的快照什麼都不做', () => {
    const g = useGame()
    const e = useEngine()
    const before = json(e.state)
    g.rollback('nope')
    expect(json(e.state)).toBe(before)
  })
})
