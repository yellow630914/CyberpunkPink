// 邊界測試（對抗性的 AI 回應）：AI 給 net.* 的效果、給 M3 新效果（deck_rental、deck_script_use）、給網內才有意義的追蹤度與警戒，放在錯的地方或越界。
// 規格：AI_TASKS 2.5 節（只收封閉清單裡的效果、驗證不過整筆拿掉重試、最後走退路）、EVENTS 2.4 節（效果表與上限）、dev/invariants.md 第 7、19、22 條（AI 的效果只收封閉的清單）、
// 第 180 條（別的功能不直接改寫 actor.ext.deck）、第 133 條 B022（AI 效果封閉清單）。
// 邊界表：
//   效果的種類   net.trace／net.ram／net.sync／net.jam／net.pin／net.tether（戰鬥的效果，不是事件的效果）、deck_rental、deck_script_use（ai: false）、alert（只在委託副本裡）
//   來源         AI（拒絕）與內建（照做）各一次，對照
//   整條鏈       reward 任務給上面每一種：自由行動照樣成立（applied）、狀態裡追蹤度與 actor.ext.deck 一字不動、reward 那一步走退路

import { describe, expect, it } from 'vitest'
import type { EffectCtx } from '../../src'
import { clone, effectCtx, meterOf } from '../../src'
import { go as diveGo } from '../../src/features/dive'
import { readRun } from '../../src/features/netrun'
import { diveIn, makeDiveGame, observed } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']
type Rec = Record<string, unknown>

const TEXT = '我躲進資料流裡，想把身後的追蹤弄亂'

function inDig(o: Parameters<typeof makeDiveGame>[0] = {}) {
  const t = makeDiveGame(o)
  diveIn(t.game)
  t.game.commit(diveGo(t.game.k, t.game.state, 'ns_tw_dig'))
  return t
}
const ctx = (g: G, source: EffectCtx['source']): EffectCtx => effectCtx(g.k, g.state, { source, clampAsked: true, playerInput: TEXT })
const traceNow = (g: G): number => meterOf(g.k, g.state, 'trace', readRun(g.state)!.map)
const reward = (items: Rec[]) => ({ json: { items } })

/** 戰鬥的效果與 M3 新的、只給內建來源的效果：AI 給了都不收。 */
const FORBIDDEN: Rec[] = [
  { kind: 'net.trace', amount: 10 }, { kind: 'net.ram', amount: 99 }, { kind: 'net.sync', to: 'full' }, { kind: 'net.jam', slot: 'weapon' }, { kind: 'net.pin' }, { kind: 'net.tether' },
  { kind: 'net.break' }, { kind: 'net.fix' }, { kind: 'net.admin_spend', n: 1 },
  { kind: 'deck_rental', deck: 'dk_tw_ii', who: 'pc' }, { kind: 'deck_script_use', item: 'it_tw_script', qty: 1, who: 'pc' },
  { kind: 'netrun.trace', amount: 5 }, { kind: 'maze.chips', amount: 100 }, { kind: 'dive.exit' },
]

describe('邊界 AI_TASKS 2.5／不變式 133（B022）：AI 給戰鬥的效果與只給內建的效果', () => {
  it('每一種都被擋下（errors 一條說明、changes 是空的）；來源是內建的 deck_rental 與 deck_script_use 照做（對照）', () => {
    const { game: g } = inDig()
    for (const e of FORBIDDEN) {
      const r = g.k.effects.resolve([e], ctx(g, 'ai'))
      expect(r.changes, JSON.stringify(e)).toEqual([])
      expect(r.errors.length, JSON.stringify(e)).toBeGreaterThan(0)
    }
    // 對照：內建的來源能租甲板（deck_rental）
    const ok = g.k.effects.resolve([{ kind: 'deck_rental', deck: 'dk_tw_rent', who: 'pc' }], ctx(g, 'builtin'))
    expect(ok.errors).toEqual([])
    expect(ok.changes.length).toBeGreaterThan(0)
  })

  it('混在合法的效果裡：合法的那筆也不收（整批驗證不過，AI_TASKS 2.5：不收的那一筆整筆拿掉；這裡是整批的 errors，不留半套）', () => {
    const { game: g } = inDig()
    const r = g.k.effects.resolve([{ kind: 'trace', amount: 5 }, { kind: 'net.trace', amount: 99 }], ctx(g, 'ai'))
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.changes).toEqual([])
  })

  it('AI 給追蹤度以外的壓力：alert（只在委託副本裡有）在自己去挖的子網裡不收；警戒量表不動', () => {
    const { game: g } = inDig()
    const before = clone(g.state.meters)
    const r = g.k.effects.resolve([{ kind: 'alert', amount: 5 }], ctx(g, 'ai'))
    expect(r.changes).toEqual([])
    expect(g.state.meters).toEqual(before)
  })
})

describe('邊界：整條自由行動鏈，人在網內，reward 給戰鬥的效果與 deck 的內建效果', () => {
  for (const e of FORBIDDEN.slice(0, 11)) {
    it(`reward 給 ${String(e.kind)}：自由行動成立（applied）、追蹤度與 actor.ext.deck 一字不動、reward 走退路、不變式成立`, async () => {
      const { game: g } = inDig({ ai: { ai: 1 }, idleTimeoutMs: 30, fake: { byTask: { reward: [reward([{ ...e, from: { source: 'degree' } }])] } } } as never)
      g.state.meters.trace = { ...g.state.meters.trace, [readRun(g.state)!.map]: 50 }
      const deck0 = clone(g.state.actors.pc!.ext.deck)
      const { result, violations } = await observed(g, () => g.act({ kind: 'free', text: TEXT }, { autoRules: true }))
      expect(violations).toEqual([])
      expect(result.status).toBe('applied')
      expect(traceNow(g)).toBe(50)
      expect(g.state.actors.pc!.ext.deck).toEqual(deck0)
      const step = result.run.step('reward')
      expect(['fallback', 'done']).toContain(step.status)
      // 不收的效果沒有出現在結果裡：寫正文拿到的 results 沒有它的種類
      expect(JSON.stringify(g.state.reports.at(-1)!.changes)).not.toContain(String(e.kind))
    }, 30_000)
  }
})
