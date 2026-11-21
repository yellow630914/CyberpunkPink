// 邊界測試找到、還沒修的 bug（cpp-tester-boundary，AI_TASKS 2.5 節）。修好之前照預期失敗。
// 跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts boundary-ai-tasks-2.5
// 修好之後：把 tests/fixtures/repro-pending/B001-*.json 搬到 tests/fixtures/repro/（主套件的種子重播會接手），
// 這個檔搬到 tests/boundary/。bug 報告：dev/bugs/2026-11-21-B001.md、dev/bugs/2026-11-21-B002.md。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createKernel, prepareAction, sanitizeJudgment } from '../../src'
import { FEATURES } from '../../src/features'
import type { Repro } from '../../src/testkit'
import { checkRepro, makeState } from '../../src/testkit'

const fixture = <T>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/repro-pending/${name}.json`, import.meta.url)), 'utf8')) as T

describe('B001：設定關、asked 對得上時，數值沒有上限，加總溢位成 Infinity，存檔讀不回來', () => {
  // 規格：AI_TASKS 2.5 節（關著時只驗格式，格式要照 DATA）；不變式 6（存檔再讀檔一模一樣）、7（錢與三條軌是 0 以上的整數）
  for (const id of ['B001-overflow-cash', 'B001-overflow-sink', 'B001-overflow-time']) {
    it(id, async () => {
      expect(await checkRepro(fixture<Repro>(id), FEATURES)).toEqual([])
    })
  }
})

describe('B002：判定的時間被夾住時，提醒的時數和實際的上限對不上', () => {
  // 規格：AI_TASKS 2.5 節「被夾值時提醒玩家：說出哪一樣被減少、實際拿到多少」；3.1 節的行動種類表（first_aid 10／30）
  const fx = fixture<{ cases: Array<{ maxMinutes: number; minutes: number; raw: Record<string, unknown>; expectMinutes: number }> }>('B002-minutes-notice')
  for (const c of fx.cases) {
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
