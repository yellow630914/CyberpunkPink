// B020（cpp-tester-whitebox，M2 白箱）：special_map 的 validate 在 sheets[].cells／spots 的型別不對時丟 TypeError。
// 規格：GAME_DESIGN 第 3 節第 13 條（格式錯誤一律擋下）；內容登錄表的 validate 契約「回傳錯誤訊息（空的就是合格）」（core/content/registry.ts ContentKindDef.validate）。
// 現況：`sheetProblems`（core/grid/model.ts）直接 `(def.cells ?? []).map(...)`、`m.at[0]`，資料寫壞時是 TypeError，載入整個當機，訊息裡沒有寫是哪一張圖。
// 重現：tests/whitebox/fixtures/B020-special-map-malformed.json（一張合格的小街加八種壞法）。修好之後搬到 tests/whitebox/ 或 tests/features/。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeCityGame } from '../../src/testkit'

type Path = Array<string | number>
const FIX = JSON.parse(readFileSync(new URL('../whitebox/fixtures/B020-special-map-malformed.json', import.meta.url), 'utf8')) as { base: Record<string, unknown>; cases: Array<{ path: Path; value: unknown; why: string }> }

function mutate(base: Record<string, unknown>, path: Path, value: unknown): Record<string, unknown> {
  const copy = structuredClone(base) as Record<string, any>
  let cur: any = copy
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!]
  cur[path[path.length - 1]!] = value
  return copy
}

describe('B020：special_map 格式不對時 validate 回問題清單，不丟例外', () => {
  const { game } = makeCityGame({ seed: 7 })
  const content = game.k.content

  it('對照：合格的那一張驗得過', () => {
    expect(content.validate('special_map', [FIX.base])).toEqual([])
  })

  it.each(FIX.cases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    const bad = mutate(FIX.base, c.path, c.value)
    let problems: string[] = []
    expect(() => { problems = content.validate('special_map', [bad]) }).not.toThrow()
    expect(problems.length).toBeGreaterThan(0)
  })
})
