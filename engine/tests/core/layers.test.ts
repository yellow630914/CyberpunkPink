import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkLayers, importsOf, layerOf } from '../../src/testkit'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

function readTree(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) readTree(full, out)
    else if (name.endsWith('.ts')) out[relative(SRC, full).replace(/\\/g, '/')] = readFileSync(full, 'utf8')
  }
  return out
}

// 規格：CODESCAN 第 3 節；dev/invariants.md 第 5 條；dev/test-harness.md 第 5 節
describe('分層檢查', () => {
  it('engine/src 沒有違規的 import（下層不 import 上層、功能之間不互相 import、不 import vue 或任何套件、不碰瀏覽器 API）', () => {
    const files = readTree(SRC)
    expect(Object.keys(files).length).toBeGreaterThan(30)
    expect(checkLayers(files).map((v) => v.message)).toEqual([])
  })

  it('每個資料夾對到哪一層', () => {
    expect(layerOf('core/types/report.ts')?.layer).toBe(0)
    expect(layerOf('core/util/rng.ts')?.layer).toBe(1)
    expect(layerOf('core/content/registry.ts')?.layer).toBe(2)
    expect(layerOf('core/state/commit.ts')?.layer).toBe(3)
    expect(layerOf('core/rules/check.ts')?.layer).toBe(4)
    expect(layerOf('core/action/action.ts')?.layer).toBe(5)
    expect(layerOf('core/kernel.ts')?.layer).toBe(5)
    expect(layerOf('features/character/index.ts')).toEqual({ layer: 6, feature: 'character' })
    expect(layerOf('features/perks.ts')).toEqual({ layer: 6, feature: 'perks' })
    expect(layerOf('shell/game.ts')?.layer).toBe(7)
    expect(layerOf('features/index.ts')?.layer).toBe(7)
    expect(layerOf('somewhere/else.ts')).toBeNull()
  })

  it('抓得到各種 import 的寫法；註解裡的不算', () => {
    const src = `import a from './a'\nimport type { B } from "../b"\nexport * from './c'\nconst d = await import('./d')\nimport './e'\n// import x from './no'\n/* from './no2' */`
    expect(importsOf(src)).toEqual(['./a', '../b', './c', './d', './e'])
  })

  const rules = (files: Record<string, string>) => checkLayers(files).map((v) => v.rule)

  it('下層 import 上層：擋', () => {
    expect(rules({ 'core/util/x.ts': `import { commitReport } from '../state/commit'`, 'core/state/commit.ts': '' })).toEqual(['upward'])
    expect(rules({ 'core/types/x.ts': `import { clamp } from '../util/sanitize'`, 'core/util/sanitize.ts': '' })).toEqual(['upward'])
    expect(rules({ 'core/action/x.ts': `import { Game } from '../../shell/game'`, 'shell/game.ts': '' })).toEqual(['upward'])
    expect(rules({ 'features/perks/index.ts': `import { Game } from '../../shell/game'`, 'shell/game.ts': '' })).toEqual(['upward'])
    expect(rules({ 'core/state/x.ts': `import { x } from '../../features/perks'`, 'features/perks/index.ts': '' })).toEqual(['upward'])
    // 往下、同一層：可以
    expect(rules({ 'core/rules/x.ts': `import { a } from '../state/commit'\nimport { b } from './y'`, 'core/state/commit.ts': '', 'core/rules/y.ts': '' })).toEqual([])
  })

  it('L6 的功能之間直接 import：擋；同一個功能裡面可以', () => {
    expect(rules({ 'features/perks/index.ts': `import { maxHp } from '../character/stats'`, 'features/character/stats.ts': '' })).toEqual(['feature-to-feature'])
    // 功能的總表可以 import 每個功能；功能不可以反過來 import 它
    expect(rules({ 'features/index.ts': `import { a } from './perks'\nimport { b } from './character'`, 'features/perks/index.ts': '', 'features/character/index.ts': '' })).toEqual([])
    expect(rules({ 'features/perks/index.ts': `import { FEATURES } from '../index'`, 'features/index.ts': '' })).toEqual(['upward'])
    expect(rules({ 'features/perks/index.ts': `import { x } from './data'\nimport { k } from '../../core'`, 'features/perks/data.ts': '', 'core/index.ts': '' })).toEqual([])
  })

  it('import vue、pinia、node: 或任何套件：擋', () => {
    expect(rules({ 'shell/game.ts': `import { ref } from 'vue'` })).toEqual(['package'])
    expect(rules({ 'features/a/index.ts': `import { defineStore } from 'pinia'` })).toEqual(['package'])
    expect(rules({ 'core/util/x.ts': `import fs from 'node:fs'` })).toEqual(['package'])
    expect(rules({ 'shell/x.ts': `const m = await import('lodash')` })).toEqual(['package'])
  })

  it('碰瀏覽器的全域物件：擋；註解與字串裡的不算；state.location 這種欄位不算', () => {
    expect(rules({ 'shell/x.ts': `const v = localStorage.getItem('cpp-ai-v1')` })).toEqual(['browser'])
    expect(rules({ 'core/util/x.ts': `export const w = window.innerWidth` })).toEqual(['browser'])
    expect(rules({ 'features/a/index.ts': `document.title = 'x'` })).toEqual(['browser'])
    expect(rules({ 'shell/x.ts': `// 不碰 localStorage\nconst s = '用 window 的話會被擋'\nconst loc = state.location\nconst DC_WINDOW = 3\nconst o = { dc_window: 3 }.dc_window` })).toEqual([])
  })

  it('正式的程式 import 測試基礎建設或測試檔：擋；測試檔自己不檢查', () => {
    expect(rules({ 'shell/x.ts': `import { makeState } from '../testkit/factory'`, 'testkit/factory.ts': '' })).toEqual(['testkit'])
    expect(rules({ 'core/util/x.ts': `import { t } from './x.test'` })).toEqual(['testkit'])
    expect(rules({ 'core/util/x.test.ts': `import { describe } from 'vitest'\nimport { Game } from '../../shell/game'` })).toEqual([])
    expect(rules({ 'testkit/y.ts': `import { Game } from '../shell/game'`, 'shell/game.ts': '' })).toEqual([])
  })

  it('不在任何一層的檔案：擋', () => {
    expect(rules({ 'misc/helper.ts': '' })).toEqual(['unknown-layer'])
  })
})
