// 邊界測試：戰敗扣錢與無人機（M1）。cpp-tester-boundary 寫的。
//
// 規格：COMBAT_SYSTEM 8.3 節（戰敗扣多少錢：身上現金的 0～100%，可以另設金額的上限，事件寫明扣帳戶的不受影響）、
// BALANCE 7.4 節（存檔規則的範圍）、COMBAT_SYSTEM 9.1 節（無人機：同步 → 台數、生命與護甲照等級、迴避 13、每格最多一台、
// 被擊落時操作者感載 +5）、ENEMIES 第 3 節（無人機迴避 +3）。
//
// 邊界表（數值或條件｜範圍｜出處｜測的點）：
//   戰敗扣錢比例      0～1                         COMBAT_SYSTEM 8.3／BALANCE 7.4   0、1、−0.1、1.1、NaN；現金 0
//   戰敗扣錢上限      null（沒有）或 ≥ 0 的整數      同上                              0（一毛都不扣）、剛好、少 1、很大
//   扣的錢            min(事件寫的, ⌊現金 × 比例⌋, 上限)；只管現金                    帳戶與給錢的不動
//   同步              0～6                          COMBAT_SYSTEM 9.1               每一級的台數；−1、7、2.9
//   無人機的等級       I～IV（1～4）                  COMBAT_SYSTEM 9.1／ITEMS 3.2     生命 14／17／20／25、護甲 1～4；0、5、小數夾住
//   每格最多一台       4 格                          COMBAT_SYSTEM 9.1               放滿四格、第五台

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BattleUnit, ContentPack } from '../../src'
import { sanitizeRules } from '../../src'
import { allFeatures } from '../../src/features'
import { acceptDefeat, defeatFeature } from '../../src/features/defeat'
import { DRONE_CAP_BY_SYNC, DRONE_STATS } from '../../src/features/summons'
import { TEST_COMBAT, makeBattleGame, makeGame } from '../../src/testkit'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

// ---------------------------------------------------------------------------------------------
// 1. 戰敗扣錢（COMBAT_SYSTEM 8.3 節）

type Eff = { kind: 'cash' | 'cred'; amount: number }
const DEFEAT_PACK = (effects: Eff[]): ContentPack => ({
  id: 'defeat_boundary',
  content: {
    faction: [{ id: 'nora', name: '野良', short: '野良', class: 'street' }],
    defeat_event: [{ id: 'df_e', name: 'e', kind: 'generic', factions: ['nora'], fails_commission: false, versions: { default: { text: '被洗劫。', effects } } }],
  },
})

/** 一局等著接受戰敗的遊戲：現金 cash、帳戶 cred，存檔規則照 rules。回傳接受之後的錢。 */
function acceptWith(effects: Eff[], cash: number, cred: number, rules: Record<string, unknown>): { cash: number; cred: number; notes: string[] } {
  const g = makeGame({ features: [defeatFeature, TEST_COMBAT], content: [DEFEAT_PACK(effects)], patch: { money: { cred, cash }, rules: sanitizeRules(rules) } }).game
  g.state.ext.defeat = {
    event: 'df_e', version: 'default', faction: 'nora', outcome: 'lose', fails_commission: false, lines: [], choices: ['accept', 'retry', 'stage'], view: 'always', skipped: true, battle: 'b1',
  }
  const draft = acceptDefeat(g.k, g.state)
  g.commit(draft)
  return { cash: g.state.money.cash, cred: g.state.money.cred, notes: draft.narration?.results ?? [] }
}

describe('邊界 COMBAT_SYSTEM 8.3：戰敗扣多少錢', () => {
  const effArb: fc.Arbitrary<Eff> = fc.record({ kind: fc.constantFrom<'cash' | 'cred'>('cash', 'cred'), // 內建事件給的錢照區的等級夾（I 級一件事最多 120，EVENTS 2.4 節）：給的少一點、合計不超過上限，這裡要測的是扣的
    amount: fc.oneof(fc.integer({ min: -3000, max: -1 }), fc.integer({ min: 1, max: 20 })) })

  it('性質：現金實際少的 = min(事件寫的現金合計, ⌊現金 × 比例⌋, 上限)；帳戶的扣照事件寫的（不受設定影響，但扣不到比手上多）；給錢的照給', () => {
    fc.assert(fc.property(
      fc.array(effArb, { maxLength: 6 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 100 }), fc.option(fc.integer({ min: 0, max: 4000 }), { nil: null }),
      (effects, cash, cred, pct, cap) => {
        const loss = pct / 100
        const r = acceptWith(effects, cash, cred, { defeatMoneyLoss: loss, defeatMoneyCap: cap })
        // 規格：現金的扣合計最多 min(⌊現金 × 比例⌋, 上限)，超過的從最後一筆往回減；帳戶與給錢的照事件寫的；
        // 一筆一筆套，扣的不會超過那時手上有的（錢不會是負的）
        const limit = Math.min(Math.floor(cash * loss), cap ?? Infinity)
        let excess = -effects.filter((e) => e.kind === 'cash' && e.amount < 0).reduce((n, e) => n + e.amount, 0) - limit
        const adjusted = effects.map((e) => ({ ...e }))
        for (let i = adjusted.length - 1; i >= 0 && excess > 0; i--) {
          const e = adjusted[i]!
          if (e.kind !== 'cash' || e.amount >= 0) continue
          const cut = Math.min(-e.amount, excess)
          e.amount += cut
          excess -= cut
        }
        const held = { cash, cred }
        for (const e of adjusted) held[e.kind] = e.amount >= 0 ? held[e.kind] + e.amount : held[e.kind] - Math.min(-e.amount, held[e.kind])
        expect(r.cash).toBe(held.cash)
        expect(r.cred).toBe(held.cred)
        // 帳戶不受設定影響：扣的合計照事件寫的（受手上有多少限制）
        const credLosses = effects.filter((e) => e.kind === 'cred' && e.amount < 0).length
        if (credLosses === 0) expect(r.cred).toBe(cred + effects.filter((e) => e.kind === 'cred').reduce((n, e) => n + e.amount, 0))
      }), { numRuns: 300 })
  })

  it('一筆扣現金的邊：比例 0 不扣、1 扣到事件寫的（現金夠的話）、上限 0 不扣、上限剛好、上限少 1；現金 0 沒有可扣', () => {
    const lose = (cash: number, rules: Record<string, unknown>, amount = 1000) => cash - acceptWith([{ kind: 'cash', amount: -amount }], cash, 0, rules).cash
    expect(lose(5000, { defeatMoneyLoss: 0 })).toBe(0)
    expect(lose(5000, { defeatMoneyLoss: 1 })).toBe(1000)
    expect(lose(5000, { defeatMoneyLoss: 1, defeatMoneyCap: 0 })).toBe(0)
    expect(lose(5000, { defeatMoneyLoss: 1, defeatMoneyCap: 1000 })).toBe(1000)
    expect(lose(5000, { defeatMoneyLoss: 1, defeatMoneyCap: 999 })).toBe(999)
    expect(lose(5000, { defeatMoneyLoss: 1, defeatMoneyCap: 1001 })).toBe(1000)
    expect(lose(0, { defeatMoneyLoss: 1 })).toBe(0)
    // 比例的邊：現金 1000，50% = 500；現金 1001，50% = ⌊500.5⌋ = 500；比例 0.001 = 1
    expect(lose(1000, { defeatMoneyLoss: 0.5 })).toBe(500)
    expect(lose(1001, { defeatMoneyLoss: 0.5 })).toBe(500)
    expect(lose(1000, { defeatMoneyLoss: 0.001 })).toBe(1)
    expect(lose(999, { defeatMoneyLoss: 0.001 })).toBe(0)
  })

  it('存檔規則的範圍：比例 −0.1 與 1.1 夾成 0 與 1；上限負的夾成 0；NaN 的比例用預設；沒有上限（null、沒寫）是不限', () => {
    expect(sanitizeRules({ defeatMoneyLoss: -0.1 }).defeatMoneyLoss).toBe(0)
    expect(sanitizeRules({ defeatMoneyLoss: 1.1 }).defeatMoneyLoss).toBe(1)
    expect(sanitizeRules({ defeatMoneyLoss: 0 }).defeatMoneyLoss).toBe(0)
    expect(sanitizeRules({ defeatMoneyLoss: 1 }).defeatMoneyLoss).toBe(1)
    expect(sanitizeRules({ defeatMoneyLoss: Number.NaN }).defeatMoneyLoss).toBe(sanitizeRules({}).defeatMoneyLoss)
    expect(sanitizeRules({ defeatMoneyCap: -5 }).defeatMoneyCap).toBe(0)
    expect(sanitizeRules({ defeatMoneyCap: null }).defeatMoneyCap).toBeNull()
    expect(sanitizeRules({}).defeatMoneyCap).toBeNull()
    expect(sanitizeRules({ defeatMoneyCap: 0 }).defeatMoneyCap).toBe(0)
    expect(sanitizeRules({}).defeatMoneyLoss).toBe(1) // 預設：照事件，最多身上現金的 100%
  })

  it('帳戶不受影響：事件寫明扣帳戶，比例 0、上限 0 也照扣（扣不到比手上多）；事件給的錢不被調', () => {
    const r = acceptWith([{ kind: 'cred', amount: -400 }, { kind: 'cash', amount: 50 }, { kind: 'cred', amount: -9999 }], 100, 700, { defeatMoneyLoss: 0, defeatMoneyCap: 0 })
    expect(r.cred).toBe(0)
    expect(r.cash).toBe(150)
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 無人機

const PACK: ContentPack = { id: 'summons_boundary', content: { battle_status: TEST_STATUSES } }
const SIX = Array.from({ length: 6 }, (_, i) => ({ kind: i % 2 ? 'shield' : 'scout', grade: 1 }))
const pilot = (sync: number, drones: unknown[] = SIX) => one({ weapon: 'pistol', skills: { sync, piloting: 3, firearms: 2 }, ap: { now: 20, max: 20, regen: 3 }, ext: { summons: { drones } } })
const game = (allies: unknown[], seed = 7) => makeBattleGame({ features: allFeatures(), content: [PACK], battle: duel(allies, [foe('elite'), foe('elite')], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), seed }).game
type G = ReturnType<typeof game>
const turnTo = (g: G, id: string): BattleUnit => { const b = g.state.battle!; b.turn = b.order.indexOf(id); const u = b.units[id]!; u.ap.now = u.ap.max; u.control = 'player'; return u }

describe('邊界 COMBAT_SYSTEM 9.1：無人機的台數、等級與位置', () => {
  it('同步 0～6 的台數表（1、1、2、2、3、3、4）；放出去的台數到了上限就擋下並寫出原因；每格最多一台', () => {
    expect(DRONE_CAP_BY_SYNC).toEqual([1, 1, 2, 2, 3, 3, 4])
    for (const sync of [0, 1, 2, 3, 4, 5, 6]) {
      const cap = DRONE_CAP_BY_SYNC[sync]!
      const g = game([pilot(sync), one({}, 2)])
      turnTo(g, 'a1')
      let done = 0
      for (let slot = 1; slot <= 4; slot++) {
        const r = g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot }, pick: { drone: done } })
        if (done < cap) { expect(r.status, `同步 ${sync} 第 ${done + 1} 台`).toBe('applied'); done++ } else {
          expect(r.status, `同步 ${sync} 第 ${done + 1} 台`).toBe('refused')
          expect(r.reasons).toEqual([`同步 ${sync} 級只連得住 ${cap} 台。`])
        }
      }
      expect(g.battle!.overlays.filter((o) => !o.down)).toHaveLength(cap)
      // 每格最多一台
      expect(new Set(g.battle!.overlays.map((o) => o.slot)).size).toBe(cap)
    }
  })

  it('同步的邊：−1、小數（2.9 無條件捨去）、7 與很大的數夾在 0～6', () => {
    const run = (sync: number) => {
      const g = game([pilot(sync), one({}, 2)])
      turnTo(g, 'a1')
      let n = 0
      for (let i = 0; i < 6; i++) {
        const slot = (i % 4) + 1
        if (g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot }, pick: { drone: n } }).status === 'applied') n++
      }
      return n
    }
    expect([-1, -100, 0, 1.9, 2, 2.9, 3, 5.99, 6, 7, 99].map(run)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 4, 4, 4])
  })

  it('每一等級的生命與護甲：I 14／1、II 17／2、III 20／3、IV 25／4；迴避 13；等級 0、5、小數夾在 I～IV（四捨五入）', () => {
    expect(DRONE_STATS).toEqual([{ hp: 14, armor: 1 }, { hp: 17, armor: 2 }, { hp: 20, armor: 3 }, { hp: 25, armor: 4 }])
    const stats = (grade: unknown) => {
      const g = game([pilot(2, [{ kind: 'shield', grade }]), one({}, 2)])
      turnTo(g, 'a1')
      expect(g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 1 }, pick: { drone: 0 } }).status).toBe('applied')
      const o = g.battle!.overlays[0]!
      return { hp: o.hp.max, now: o.hp.now, armor: o.armor, evade: o.evade }
    }
    for (const [grade, hp, armor] of [[1, 14, 1], [2, 17, 2], [3, 20, 3], [4, 25, 4], [0, 14, 1], [-3, 14, 1], [5, 25, 4], [99, 25, 4], [1.4, 14, 1], [1.5, 17, 2], [3.5, 25, 4], ['x', 14, 1], [undefined, 14, 1]] as const) {
      expect(stats(grade), `等級 ${String(grade)}`).toEqual({ hp, now: hp, armor, evade: 13 })
    }
  })

  it('性質：任何放出、收回、移動的順序之後，場上沒被擊落的無人機不超過同步的台數、每格最多一台、都在第 1～4 格', () => {
    const acts = fc.array(fc.record({ kind: fc.constantFrom('deploy', 'move', 'recall'), a: fc.integer({ min: 0, max: 5 }), slot: fc.integer({ min: 0, max: 5 }) }), { maxLength: 25 })
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), acts, (sync, list) => {
      const g = game([pilot(sync), one({}, 2)])
      for (const x of list) {
        const u = turnTo(g, 'a1')
        u.ap.now = u.ap.max
        const live = g.battle!.overlays.filter((o) => !o.down)
        if (x.kind === 'deploy') g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: x.slot }, pick: { drone: x.a } })
        else if (live.length) {
          const o = live[x.a % live.length]!
          if (x.kind === 'move') g.battleAct({ action: 'drone.move', target: { overlay: o.id }, pick: { slot: x.slot } })
          else g.battleAct({ action: 'drone.recall', target: { overlay: o.id } })
        }
        const now = g.battle!.overlays.filter((o) => !o.down)
        expect(now.length).toBeLessThanOrEqual(DRONE_CAP_BY_SYNC[sync]!)
        expect(new Set(now.map((o) => o.slot)).size).toBe(now.length)
        for (const o of now) { expect(o.slot).toBeGreaterThanOrEqual(1); expect(o.slot).toBeLessThanOrEqual(4) }
        expect(g.battle!.units.a1!.ap.now).toBeGreaterThanOrEqual(0)
      }
    }), { numRuns: 80 })
  })
})
