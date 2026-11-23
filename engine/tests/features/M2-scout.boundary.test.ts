// 邊界：踩點的次數、難度與時間、買情報的價錢。
// 規格：FIXER 第 2 節②「踩點的規則」（一次花一個時段 4 小時；最多踩階段數那麼多次；DC = 10 + 等級 × 2，第 4 次起 +1；超過 DC 5 以上揭開兩項、成功一項、失敗沒有、大失敗驚動目標：警戒起始 +15）、買情報（等級 × 300 現金，或一個人情；不花時間、不算踩點的次數）。
// 性質：任何種子，每一次踩點的 DC 照公式、時間剛好 4 小時、揭開的項目不重複而且屬於這件委託、揭開的數量由成功程度決定（大成功最多 2、成功 1、失敗與大失敗 0）、
// 警戒起始只在大失敗時 +15 而且不超過 100 的量表範圍之外記帳（Job 的 alert_start 是累加的整數）；踩滿之後再踩被擋；買情報剛好付得起可以、少 1 塊擋下。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked, toMinutes } from '../../src'
import { buyIntel, intelOptions, jobOf, scout, scoutBlock, scoutDc, fixerRules, gradeOf, methodOf, SCOUT_METHODS } from '../../src/features/fixer'
import { makeCommissionGame } from '../../src/testkit'

describe('邊界 FIXER 2②：踩點', () => {
  it('DC：等級 1～5 與第 1～5 次：10 + 等級 × 2，第 4 次起 +1（第 3 次不加、第 4 次加）', () => {
    const t = makeCommissionGame({ seed: 6 })
    const rules = fixerRules(t.game.k)
    for (let grade = 1; grade <= 5; grade++) {
      for (let n = 1; n <= 5; n++) expect(scoutDc(rules, grade, n)).toBe(10 + grade * 2 + (n >= 4 ? 1 : 0))
    }
    expect(scoutDc(rules, 3, 3)).toBe(16)
    expect(scoutDc(rules, 3, 4)).toBe(17)
  })

  it('性質：任何種子、任何手段：踩點的紀錄照規格；揭開的不重複、不超過兩項；大失敗才記驚動；時間剛好 240 分鐘；次數 +1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: SCOUT_METHODS.length - 1 }), (seed, mi) => {
        const t = makeCommissionGame({ seed })
        const { game, job: id } = t
        const k = game.k
        const job = jobOf(game.state, id)!
        const method = SCOUT_METHODS[mi]!
        const block = scoutBlock(job, method)
        if (block) {
          expect(() => scout(k, game.state, id, method.id)).toThrow(ActionBlocked)
          return
        }
        const t0 = toMinutes(game.state.time)
        const hiddenBefore = job.unknowns.filter((u) => !job.revealed.includes(u.id)).map((u) => u.id)
        const draft = scout(k, game.state, id, method.id)
        game.commit(draft)
        const after = jobOf(game.state, id)!
        const entry = after.log[after.log.length - 1]!
        expect(entry.n).toBe(1)
        expect(entry.dc).toBe(10 + gradeOf(job.commission) * 2)
        expect(after.scouts).toBe(1)
        expect(toMinutes(game.state.time) - t0).toBe(fixerRules(k).scout_minutes)
        expect(new Set(entry.revealed).size).toBe(entry.revealed.length)
        for (const r of entry.revealed) expect(hiddenBefore).toContain(r)
        const max = entry.degree === 'critical' ? 2 : entry.degree === 'success' ? 1 : 0
        expect(entry.revealed.length).toBeLessThanOrEqual(max)
        if (entry.degree === 'critical' || entry.degree === 'success') expect(entry.revealed.length).toBeGreaterThan(0)
        const alerted = entry.alert !== undefined || entry.trace !== undefined
        expect(alerted).toBe(entry.degree === 'fumble')
        if (entry.degree === 'fumble') expect(entry.alert ?? entry.trace).toBe(fixerRules(k).scout_alert)
        expect(after.alert_start + after.trace_start).toBe(entry.degree === 'fumble' ? fixerRules(k).scout_alert : 0)
        expect(new Set(after.revealed).size).toBe(after.revealed.length)
      }),
      { numRuns: 80, seed: 31 },
    )
  })

  it('次數上限 = 階段數：踩滿之後再踩被擋（寫出上限）；每次踩點都不重複揭開；鎖著的手段被擋、沒有的手段被擋', () => {
    const t = makeCommissionGame({ seed: 6 })
    const { game, job: id } = t
    const k = game.k
    const stages = jobOf(game.state, id)!.commission.stages.length
    let done = 0
    for (let i = 0; i < stages + 2; i++) {
      const job = jobOf(game.state, id)!
      const usable = SCOUT_METHODS.find((m) => !scoutBlock(job, m))
      if (!usable) break
      if (job.scouts >= stages) {
        expect(() => scout(k, game.state, id, usable.id)).toThrow(`最多踩 ${stages} 次點`)
        break
      }
      game.commit(scout(k, game.state, id, usable.id))
      done++
      expect(jobOf(game.state, id)!.scouts).toBe(done)
    }
    expect(done).toBeGreaterThan(0)
    expect(done).toBeLessThanOrEqual(stages)
    expect(() => scout(k, game.state, id, 'no_such_method')).toThrow(ActionBlocked)
    expect(methodOf('no_such_method')).toBeUndefined()
    expect(() => scout(k, game.state, 'no_such_job', 'survey')).toThrow('手上沒有')
  })
})

describe('邊界 FIXER 2：買情報', () => {
  it('價錢 = 等級 × 300 現金：剛好付得起可以、少 1 塊擋下；買了不花時間、不算踩點的次數、同一項不能買兩次', () => {
    const t = makeCommissionGame({ seed: 6 })
    const { game, job: id } = t
    const k = game.k
    const job = jobOf(game.state, id)!
    const price = gradeOf(job.commission) * fixerRules(k).intel_per_grade
    const hidden = job.unknowns.find((u) => !job.revealed.includes(u.id))!
    game.state.money.cash = price - 1
    expect(intelOptions(k, game.state, job).find((o) => o.id === 'cash')!.price).toBe(price)
    expect(() => buyIntel(k, game.state, id, hidden.id, 'cash')).toThrow(ActionBlocked)
    game.state.money.cash = price
    const t0 = toMinutes(game.state.time)
    game.commit(buyIntel(k, game.state, id, hidden.id, 'cash'))
    expect(game.state.money.cash).toBe(0)
    expect(toMinutes(game.state.time)).toBe(t0)
    const after = jobOf(game.state, id)!
    expect(after.scouts).toBe(job.scouts)
    expect(after.revealed).toContain(hidden.id)
    game.state.money.cash = price
    expect(() => buyIntel(k, game.state, id, hidden.id, 'cash')).toThrow('已經知道')
    expect(() => buyIntel(k, game.state, id, 'no_such_unknown', 'cash')).toThrow(ActionBlocked)
  })
})
