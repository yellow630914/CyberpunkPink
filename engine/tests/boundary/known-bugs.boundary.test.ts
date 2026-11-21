// 邊界測試找到、還沒修的 bug 的重現（cpp-tester-boundary）。每一份都用 it.fails：現在照預期失敗，所以主套件是綠的；
// 修好之後這裡會變紅，提醒把 it.fails 拿掉。Repro 格式的 fixture 修好之後搬到 tests/fixtures/repro/，主套件的種子重播會接手。
// bug 報告：dev/bugs/2026-11-21-B001.md ～ B007.md。
// B003～B006 另外在 undo-retry.boundary.test.ts、chain-pipeline.boundary.test.ts 有直接的斷言。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ChainTemplate } from '../../src'
import { createKernel, prepareAction, sanitizeJudgment, validateTemplate } from '../../src'
import { FEATURES } from '../../src/features'
import type { Repro } from '../../src/testkit'
import { checkRepro, makeState } from '../../src/testkit'

const read = <T>(url: URL): T => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T
/** B003～B007 的 fixture 在 tests/boundary/fixtures/；B001、B002 的在 tests/fixtures/repro-pending/（上一輪放的，tests/pending/ 也讀它們） */
const fixture = <T>(name: string): T => read<T>(new URL(/^B00[12]-/.test(name) ? `../fixtures/repro-pending/${name}.json` : `./fixtures/${name}.json`, import.meta.url))

describe('B001：設定關、asked 對得上時，數值沒有上限，加總溢位成 Infinity，存檔讀不回來', () => {
  // 規格：AI_TASKS 2.5 節（關著時只驗格式，格式要照 DATA）；不變式 6（存檔再讀檔一模一樣）、7（錢與三條軌是 0 以上的整數）
  for (const id of ['B001-overflow-cash', 'B001-overflow-sink', 'B001-overflow-time']) {
    it.fails(id, async () => {
      expect(await checkRepro(fixture<Repro>(id), FEATURES)).toEqual([])
    })
  }
})

describe('B002：判定的時間被夾住時，提醒的時數和實際的上限對不上', () => {
  // 規格：AI_TASKS 2.5 節「被夾值時提醒玩家：說出哪一樣被減少、實際拿到多少」；3.1 節的行動種類表（first_aid 10／30）
  const fx = fixture<{ cases: Array<{ maxMinutes: number; minutes: number; raw: Record<string, unknown>; expectMinutes: number }> }>('B002-minutes-notice')
  for (const c of fx.cases) {
    const check = () => {
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
    }
    // 上限剛好是整數小時的沒有問題（60、120、240、480），只有不是整數小時的會錯
    if (c.maxMinutes % 60 === 0) it(`上限 ${c.maxMinutes} 分鐘（整數小時，現在就對）`, check)
    else it.fails(`上限 ${c.maxMinutes} 分鐘`, check)
  }
})

describe('B005：不合法的重試請求先把最新一樓回退掉，丟錯之後那一次行動不見了', () => {
  for (const id of ['B005-retry-apply-erases-action', 'B005-reroll-judge-erases-action']) {
    it.fails(id, async () => {
      expect(await checkRepro(fixture<Repro>(id), FEATURES)).toEqual([])
    })
  }
})

describe('B006：模板的格式檢查沒有擋「判定與寫正文之間沒有程式」', () => {
  it.fails('B006-template-judge-narrate', () => {
    expect(() => validateTemplate(fixture<{ template: ChainTemplate }>('B006-template-judge-narrate').template)).toThrow()
  })
})

describe('B007：設定開著，AI 交的 time 換算之後不是安全整數，效果的驗證照收', () => {
  for (const id of ['B007-time-effect-overflow', 'B007-time-effect-precision']) {
    it.fails(id, async () => {
      expect(await checkRepro(fixture<Repro>(id), FEATURES)).toEqual([])
    })
  }
})
