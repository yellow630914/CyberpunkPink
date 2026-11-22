// 邊界測試找到、已經修好的 bug 的回歸測試（cpp-tester-boundary 找到；bug 報告：dev/bugs/2026-11-21-B001.md ～ B007.md）。
//
// - Repro 格式的重現（B001 三份、B005 兩份、B007 兩份）在 tests/fixtures/repro/，由種子重播（tests/repro/replay.test.ts）每次重播。
// - 這裡是不是 Repro 格式的兩個：B002（行動種類的時間上限，要註冊行動種類）、B006（模板的格式檢查）。
// - B003、B004、B005 的直接斷言在 undo-retry.boundary.test.ts；B006、B007 的在 chain-pipeline.boundary.test.ts。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ChainTemplate } from '../../src'
import { createKernel, prepareAction, sanitizeJudgment, validateTemplate } from '../../src'
import { makeState } from '../../src/testkit'

const fixture = <T>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8')) as T

describe('B002：判定的時間被夾住時，提醒的時數照實寫', () => {
  // 規格：AI_TASKS 2.5 節「被夾值時提醒玩家：說出哪一樣被減少、實際拿到多少」；3.1 節的行動種類表（first_aid 10／30）
  const fx = fixture<{ cases: Array<{ maxMinutes: number; minutes: number; raw: Record<string, unknown>; expectMinutes: number }> }>('B002-minutes-notice')
  const cases = [...fx.cases, ...[60, 120, 240, 480].map((maxMinutes) => ({ maxMinutes, minutes: 10, raw: { degree: 'success', minutes: 999 }, expectMinutes: maxMinutes }))]
  for (const c of cases) {
    it(`上限 ${c.maxMinutes} 分鐘`, () => {
      const k = createKernel([{ id: 't', install: (kk) => kk.actions.register({ id: 'act', owner: 't', name: '測試', attr: 'tech', dc: 'normal', minutes: c.minutes, maxMinutes: c.maxMinutes, reportKind: 'action' }) }])
      const state = makeState()
      const p = prepareAction(k, state, { kind: 'act' })
      const r = sanitizeJudgment(k, state, p, { ...c.raw, degree: p.roll.degree }, { clampAsked: true })
      expect(r.judgment!.minutes).toBe(c.expectMinutes)
      const notice = r.clamps.find((x) => x.path === 'judgment.minutes')!.notice
      // 提醒裡寫的時間要等於實際的上限：N 小時 M 分鐘、N 小時、N 分鐘、半小時都算
      const text = notice.replace(/半小時/, '0.5 小時')
      const hours = /(\d+(?:\.\d+)?)\s*(?:個)?小時/.exec(text)?.[1]
      const mins = /(\d+)\s*分(?:鐘)?/.exec(text)?.[1]
      const said = Math.round(Number(hours ?? 0) * 60) + Number(mins ?? 0)
      expect(said, notice).toBe(c.expectMinutes)
    })
  }
})

describe('B006：模板的格式檢查擋「判定與寫正文之間沒有程式」', () => {
  it('B006-template-judge-narrate', () => {
    expect(() => validateTemplate(fixture<{ template: ChainTemplate }>('B006-template-judge-narrate').template)).toThrow(/隔著程式/)
  })
})
