// B022（cpp-tester-whitebox，M2 白箱的對抗性 AI 回應）：EVENTS 2.4 節「事件只能產生下表的效果……AI 自己生成的事件也只能用這些名稱」，
// 引擎的效果登錄表沒有「AI 可以用哪些」的清單：註冊了的效果（共 34 種）AI 都能直接給。其中兩種是內部結算用的、不在 2.4 的表裡：
//   `debt`（bills：併債的結果，本金與週利率都是 AI 說了算）、`bargain`（trade：殺價擲出來的結果，AI 不用擲就能指定「大成功」）；
//   `bill` 新增項目（2.4 節有這一列，但上限那一欄是空的）：金額與週數沒有任何夾值，AI 可以加一個九十億、520 週的帳單。
// 同一張表裡的錢（cred、cash）是照信譽階夾的（新手 120），所以這三個是漏洞：AI 回的結果在驗證與夾值之後照樣把玩家的帳弄壞。
// 重現：tests/whitebox/fixtures/B022-ai-effects-outside-closed-list.json。已修（M2-fix-bugs）：EffectDef.ai: false（debt、bargain），來源不是 builtin 時整批驗證不過；
// bill 新項目的總額（每週的金額 × 週數）一件事合計照 cred 的上限夾（features/bills）。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { effectCtx } from '../../src'
import { makeCityGame } from '../../src/testkit'

interface Case { label: string; effect: Record<string, unknown>; rule: 'closed_list' | 'bill_cap' }
const FIX = JSON.parse(readFileSync(new URL('../whitebox/fixtures/B022-ai-effects-outside-closed-list.json', import.meta.url), 'utf8')) as { seed: number; cases: Case[]; billCap: { amount: number } }

describe('B022：AI 的效果只能用 EVENTS 2.4 的封閉清單，錢的項目照上限夾', () => {
  const { game: g } = makeCityGame({ seed: FIX.seed })
  const resolve = (effect: Record<string, unknown>, source: 'ai' | 'builtin') => g.k.effects.resolve([effect], effectCtx(g.k, g.state, { source, clampAsked: true }))

  it.each(FIX.cases.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const r = resolve(c.effect, 'ai')
    if (c.rule === 'closed_list') {
      // 不在清單裡：整批驗證不過（有錯誤）、或整筆拿掉（沒有變更）
      expect(r.errors.length > 0 || r.changes.length === 0).toBe(true)
    } else {
      const given = r.changes.find((x) => x.op === 'bills.extra') as { amount?: number } | undefined
      expect(given === undefined || (given.amount ?? Infinity) <= FIX.billCap.amount).toBe(true)
    }
  })

  it('對照：內建的（事件資料、程式結算）照常可以用這三種', () => {
    for (const c of FIX.cases) {
      const r = resolve(c.effect, 'builtin')
      expect(r.errors, c.label).toEqual([])
      expect(r.changes.length, c.label).toBeGreaterThan(0)
    }
  })
})
