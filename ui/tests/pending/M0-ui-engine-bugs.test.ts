// 白箱測試找到的 bug（M0-ui-engine，2026-11-21，cpp-tester-whitebox）。
// 每一份重現資料在 ui/tests/fixtures/repro/，bug 報告在 dev/bugs/2026-11-21-ui-*.md。
// 修好之前照預期失敗，所以放在 pending（不在 npm test 裡）。跑法：在 ui/ 跑
//   npx vitest run --config vitest.pending.config.ts M0-ui-engine-bugs
// 全部修好之後把這個檔搬到 src/stores/repro.test.ts（import 的路徑跟著改），它就成為回歸測試。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { at, runUiRepro, type UiRepro } from '../helpers/uiRepro'

const DIR = fileURLToPath(new URL('../fixtures/repro', import.meta.url))
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as UiRepro)

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('M0-ui-engine 的 bug 重現（ui/tests/fixtures/repro/）', () => {
  it.each(fixtures.map((f) => [`${f.id}：${f.note}`, f] as const))('%s', async (_name, fx) => {
    const view = await runUiRepro(fx)
    for (const [path, want] of Object.entries(fx.expect)) expect(at(view, path), path).toEqual(want)
  })

  it('同一份重現跑兩次，結果一樣（不變式第 5 條；重現資料本身是確定的）', async () => {
    for (const fx of fixtures.filter((f) => !f.steps.some((s) => s.type === 'actTwice'))) {
      expect(await runUiRepro(fx)).toEqual(await runUiRepro(fx))
    }
  })
})
