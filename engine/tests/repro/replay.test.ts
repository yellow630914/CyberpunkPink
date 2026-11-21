// 種子重播（dev/test-harness.md 第 4 節）：engine/tests/fixtures/repro/ 裡的每一份都重播一次，變成回歸測試。
// 測試層找到 bug 時用 saveRepro() 把種子、初始狀態的建構方式與輸入序列存成一份；修好之後它就留在這裡。

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FEATURES } from '../../src/features'
import type { Repro } from '../../src/testkit'
import { checkRepro } from '../../src/testkit'

export const REPRO_DIR = fileURLToPath(new URL('../fixtures/repro', import.meta.url))

/** 把一份 repro 存進資料夾（測試失敗時呼叫）。 */
export function saveRepro(repro: Repro): string {
  const path = join(REPRO_DIR, `${repro.id}.json`)
  writeFileSync(path, `${JSON.stringify(repro, null, 2)}\n`)
  return path
}

const files = readdirSync(REPRO_DIR).filter((f) => f.endsWith('.json')).sort()

describe('種子重播', () => {
  it('資料夾裡有東西可以重播', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s', async (file) => {
    const repro = JSON.parse(readFileSync(join(REPRO_DIR, file), 'utf8')) as Repro
    expect(`${repro.id}.json`).toBe(file)
    expect(await checkRepro(repro, FEATURES)).toEqual([])
  })
})
