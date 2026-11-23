// 邊界：副本做完之後的分帳（出場費、分紅、抽成、評價加成、付法）。
// 規格：FIXER 第 2 節④、第 8 節；NPC_SYSTEM 10.4、10.5 節（出場費與分紅、報酬不夠時從主角身上補、人情不分）；LIFE 1.1 節（兩種錢不能是負數）；dev/invariants.md 第 7 條。
// 性質：不管報酬是 0 還是很大、抽成是負的還是超過 100%、主角身上有沒有錢、隊上有幾個人拿出場費，
//   ① 每一段都不是負的（欠的另外記，不是負的）；② 抽成 + 付掉的出場費 + 分紅 + 主角的份 = 到手的報酬（一塊錢都不憑空多或少）；
//   ③ 主角補的出場費不超過他身上同一種錢；④ 入帳的那一份報告套得上去（兩種錢都不會變成負數）；⑤ 預覽（splitPreview）與入帳是同一組數字。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Rating } from '../../src/features/fixer'
import { payoutDraft, splitOf, splitPreview } from '../../src/features/fixer'
import { makeActor, makeCommissionGame } from '../../src/testkit'

const RATINGS: Rating[] = ['S', 'A', 'B', 'C']

describe('邊界 FIXER 8、NPC_SYSTEM 10.5：分帳', () => {
  const t = makeCommissionGame({ seed: 6 })
  const { game } = t
  const k = game.k
  const baseState = game.state

  /** 每一次跑拿一份乾淨的複製：改隊伍、錢、這一件的條件。 */
  function scene(o: { reward: number; cut: number; pay: 'cash' | 'cred' | 'favor'; cash: number; cred: number; feeFolks: number; shareFolks: number }) {
    const state = structuredClone(baseState)
    state.money.cash = o.cash
    state.money.cred = o.cred
    const job = (state.ext.fixer as { jobs: Array<{ id: string; terms: { reward: number; pay: string; cut: number } }> }).jobs.find((j) => j.id === t.job)!
    job.terms = { reward: o.reward, pay: o.pay, cut: o.cut }
    const roster = state.ext.roster as { members: Record<string, { pay: string; since: unknown; last_called: unknown; reliability: number }> }
    const party: string[] = [state.pc!]
    const add = (id: string, pay: 'fee' | 'share') => {
      state.actors[id] = makeActor({ id, name: id, role: 'npc', ext: { paths: [{ path: 'p_gun', slot: 'main', tier: 2 }] } })
      roster.members[id] = { pay, since: { ...state.time }, last_called: { ...state.time }, reliability: 50 }
      party.push(id)
    }
    for (let i = 0; i < o.feeFolks; i++) add(`fee_${i}`, 'fee')
    for (let i = 0; i < o.shareFolks; i++) add(`share_${i}`, 'share')
    state.party = party
    return { state, job: job as never }
  }

  const arb = fc.record({
    reward: fc.oneof(fc.constant(0), fc.constant(1), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 100_000 })),
    cut: fc.oneof(fc.constant(-1), fc.constant(0), fc.constant(1), fc.constant(2), fc.double({ min: -0.5, max: 1.5, noNaN: true })),
    pay: fc.constantFrom('cash', 'cred', 'favor') as fc.Arbitrary<'cash' | 'cred' | 'favor'>,
    cash: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3000 })),
    cred: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3000 })),
    feeFolks: fc.integer({ min: 0, max: 3 }),
    shareFolks: fc.integer({ min: 0, max: 3 }),
    rating: fc.constantFrom(...RATINGS),
  })

  it('性質：每一段不是負的；抽成 + 付掉的出場費 + 分紅 + 主角的份 = 到手的報酬；補的錢不超過主角的錢；欠的 + 補的 + 付掉的 = 出場費', () => {
    fc.assert(
      fc.property(arb, (o) => {
        const { state, job } = scene(o)
        const s = splitOf(k, state, job, o.rating)
        for (const seg of s.segments) {
          expect(seg.amount, `${seg.kind}/${seg.who}`).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(seg.amount)).toBe(true)
        }
        expect(s.gross).toBeGreaterThanOrEqual(0)
        expect(s.cut).toBeGreaterThanOrEqual(0)
        expect(s.cut).toBeLessThanOrEqual(s.gross)
        expect(s.pool).toBeGreaterThanOrEqual(0)
        const fees = s.segments.filter((x) => x.kind === 'fee')
        const shares = s.segments.filter((x) => x.kind === 'share')
        const boss = s.segments.find((x) => x.kind === 'boss')!
        const paid = fees.reduce((a, x) => a + (x.paid ?? 0), 0)
        expect(s.cut + paid + shares.reduce((a, x) => a + x.amount, 0) + boss.amount).toBe(s.gross)
        for (const f of fees) expect((f.paid ?? 0) + (f.covered ?? 0) + (f.debt ?? 0)).toBe(f.amount)
        expect(s.covered).toBe(fees.reduce((a, x) => a + (x.covered ?? 0), 0))
        expect(s.debt).toBe(fees.reduce((a, x) => a + (x.debt ?? 0), 0))
        expect(s.covered).toBeLessThanOrEqual(state.money[s.wallet])
        expect(s.pc_net).toBe(boss.amount - s.covered)
        expect(s.pc_net).toBeGreaterThanOrEqual(-state.money[s.wallet])
        // 主角至少拿到一份（boss_shares），沒有人拿分紅時整個剩下的都是他的
        if (o.shareFolks === 0) expect(boss.amount).toBe(s.pool)
        // 預覽與入帳是同一組數字
        expect(splitPreview(k, state, job, o.rating)).toEqual(s)
      }),
      { numRuns: 300, seed: 20261123 },
    )
  })

  it('性質：入帳的報告套得上去（錢不會變成負的），主角實際的變化 = pc_net；失敗只扣信譽、沒有錢的變化', () => {
    fc.assert(
      fc.property(arb, (o) => {
        const { state, job } = scene(o)
        const done = payoutDraft(k, state, { job: t.job, outcome: 'done', rating: o.rating })
        const after = structuredClone(state)
        k.changes.applyAll(after, done.changes)
        const s = splitOf(k, state, job, o.rating)
        expect(after.money.cash).toBeGreaterThanOrEqual(0)
        expect(after.money.cred).toBeGreaterThanOrEqual(0)
        expect(after.money[s.wallet] - state.money[s.wallet]).toBe(s.pc_net)
        const other = s.wallet === 'cash' ? 'cred' : 'cash'
        expect(after.money[other]).toBe(state.money[other])
        const failed = payoutDraft(k, state, { job: t.job, outcome: 'failed' })
        const lost = structuredClone(state)
        k.changes.applyAll(lost, failed.changes)
        expect(lost.money).toEqual(state.money)
      }),
      { numRuns: 120, seed: 20261124 },
    )
  })

  it('邊界的幾個點：報酬 0；抽成 100%（主角與同伴只剩 0）；抽成負的與超過 100% 夾回 0～100%；出場費大過報酬時主角補，補不出來記成欠', () => {
    const zero = scene({ reward: 0, cut: 0.2, pay: 'cash', cash: 0, cred: 0, feeFolks: 0, shareFolks: 1 })
    const z = splitOf(k, zero.state, zero.job, 'B')
    expect(z.gross).toBe(0)
    expect(z.segments.every((x) => x.amount === 0)).toBe(true)

    const all = scene({ reward: 1000, cut: 1, pay: 'cash', cash: 0, cred: 0, feeFolks: 0, shareFolks: 1 })
    const a = splitOf(k, all.state, all.job, 'B')
    expect(a.cut).toBe(a.gross)
    expect(a.pool).toBe(0)
    expect(a.pc_net).toBe(0)

    const neg = splitOf(k, scene({ reward: 1000, cut: -0.5, pay: 'cash', cash: 0, cred: 0, feeFolks: 0, shareFolks: 0 }).state, scene({ reward: 1000, cut: -0.5, pay: 'cash', cash: 0, cred: 0, feeFolks: 0, shareFolks: 0 }).job, 'B')
    expect(neg.cut_rate).toBe(0)
    expect(neg.cut).toBe(0)
    const over = scene({ reward: 1000, cut: 3, pay: 'cash', cash: 0, cred: 0, feeFolks: 0, shareFolks: 0 })
    expect(splitOf(k, over.state, over.job, 'B').cut_rate).toBe(1)

    // 一個拿出場費的人，報酬 1 塊、主角身上沒有錢：出場費全記成欠
    const broke = scene({ reward: 1, cut: 0, pay: 'cash', cash: 0, cred: 0, feeFolks: 1, shareFolks: 0 })
    const b = splitOf(k, broke.state, broke.job, 'B')
    const fee = b.segments.find((x) => x.kind === 'fee')!
    expect(fee.amount).toBeGreaterThan(1)
    expect(fee.paid).toBeLessThanOrEqual(1)
    expect(fee.covered).toBe(0)
    expect(fee.debt).toBe(fee.amount - (fee.paid ?? 0))
    expect(b.debt).toBe(fee.debt)
    expect(b.pc_net).toBe(0)
    // 主角身上有錢：補得起就補（剛好補得起、少 1 元）
    const need = fee.amount - 1
    const exact = scene({ reward: 1, cut: 0, pay: 'cash', cash: need, cred: 0, feeFolks: 1, shareFolks: 0 })
    const e = splitOf(k, exact.state, exact.job, 'B')
    expect(e.debt).toBe(0)
    expect(e.covered).toBe(need)
    expect(e.pc_net).toBe(-need)
    const short = scene({ reward: 1, cut: 0, pay: 'cash', cash: need - 1, cred: 0, feeFolks: 1, shareFolks: 0 })
    const sh = splitOf(k, short.state, short.job, 'B')
    expect(sh.debt).toBe(1)
    expect(sh.covered).toBe(need - 1)
  })

  it('付法：帳戶只收 85%、人情只收 70% 現金（再加一個人情）；評價的加成照表（S 最多、C 最少），拿到手的不是負的', () => {
    const rating = (r: Rating, pay: 'cash' | 'cred' | 'favor') => {
      const sc = scene({ reward: 1000, cut: 0, pay, cash: 0, cred: 0, feeFolks: 0, shareFolks: 0 })
      return splitOf(k, sc.state, sc.job, r)
    }
    for (const r of RATINGS) {
      const cash = rating(r, 'cash')
      expect(rating(r, 'cred').gross).toBe(Math.round(cash.reward * 0.85))
      expect(rating(r, 'favor').gross).toBe(Math.round(cash.reward * 0.7))
      expect(rating(r, 'favor').favor).not.toBeNull()
      expect(cash.favor).toBeNull()
    }
    const rewards = RATINGS.map((r) => rating(r, 'cash').reward)
    expect(rewards).toEqual([...rewards].sort((a, b) => b - a))
    expect(Math.min(...rewards)).toBeGreaterThanOrEqual(0)
  })
})
