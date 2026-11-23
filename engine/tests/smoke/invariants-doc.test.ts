// dev/invariants.md 自己的檢查（不變式第 114 條）：編號連續、每一條都有出處與驗的地方、驗的地方寫的測試檔真的存在。
// 文件是測試層引用的依據；路徑改了、檔案搬了而文件沒跟著改，這裡會紅。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const DOC = join(ENGINE, '..', 'dev', 'invariants.md')

interface Row { n: number; text: string; source: string; where: string }

function rowsOf(md: string): Row[] {
  return md.split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => {
    const cols = l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/ \| /).map((c) => c.trim())
    return { n: Number(cols[0]), text: cols[1] ?? '', source: cols[2] ?? '', where: cols.slice(3).join(' | ') }
  })
}

describe('dev/invariants.md', () => {
  const rows = rowsOf(readFileSync(DOC, 'utf8'))

  it('編號從 1 起連續、沒有重複（表裡的順序不限：同一個系統的幾條會放在一起）', () => {
    expect(rows.length).toBeGreaterThanOrEqual(114)
    const nums = rows.map((r) => r.n).sort((a, b) => a - b)
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1))
  })

  it('每一條都有不變式、出處與哪裡驗（三欄都不是空的）', () => {
    const empty = rows.filter((r) => !r.text || !r.source || !r.where).map((r) => r.n)
    expect(empty).toEqual([])
  })

  it('「哪裡驗」寫成 tests/… 或 src/… 的檔案路徑都存在（有 * 的不查）', () => {
    const missing: string[] = []
    for (const r of rows) {
      for (const m of r.where.matchAll(/`((?:tests|src)\/[^`\s*]+\.(?:ts|json))`/g)) {
        if (!existsSync(join(ENGINE, m[1]!))) missing.push(`第 ${r.n} 條：${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('寫「之後」的要寫原因（哪一批、為什麼還沒有）：之後（M4：……），不能只有兩個字', () => {
    const bare = rows.filter((r) => /^之後/.test(r.where.trim()) && !/^之後（.{4,}）/.test(r.where.trim())).map((r) => r.n)
    expect(bare).toEqual([])
  })
})
