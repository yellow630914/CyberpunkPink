// 白箱測試找到、還沒修的 bug（M1-ui-combat-picks；dev/bugs/2026-11-22-ui-*.md）。照預期失敗，所以放在 pending，不在 npm test 裡。
// 跑法：在 ui/ 跑 npx vitest run --config vitest.pending.config.ts M1-ui-combat-picks-bugs
// 修好之後：把 tests/fixtures/repro-pending/ 裡對應的 json 搬到 tests/fixtures/repro/（src/stores/repro.test.ts 會每次重播），這個檔裡的那一條刪掉。

import { afterEach, describe, expect, it } from 'vitest'
import { at, runUiRepro, type UiRepro } from '../helpers/uiRepro'

const files = import.meta.glob<UiRepro>('../fixtures/repro-pending/*.json', { eager: true, import: 'default' })
const fixtures: UiRepro[] = Object.keys(files).sort().map((k) => files[k]!)

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('ui 的 bug 重現（還沒修）', () => {
  it.each(fixtures.map((f) => ({ name: `${f.id}：${f.note}`, fx: f })))('$name', async ({ fx }) => {
    const view = await runUiRepro(fx)
    for (const [path, want] of Object.entries(fx.expect)) expect(at(view, path), path).toEqual(want)
  })
})
