import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FEATURES } from '../../src/features'
import { checkExtReads, checkLayers, extOwners, importsOf, layerOf } from '../../src/testkit'

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

// 規格：dev/adr/0016 第三節（功能讀別人的數字只經由 meterOf、k.stats、k.conditions、內容與核心的狀態；不讀別的功能的 state.ext）；
// dev/work/M2-plan.md「每一張都適用的規定」第 4 條；dev/invariants.md 第 107 條
describe('功能不讀別的功能的 state.ext', () => {
  it('engine/src/features 沒有一處讀或寫別的功能的 state.ext.<鍵>', () => {
    const files = readTree(SRC)
    expect(checkExtReads(files).map((v) => v.message)).toEqual([])
  })

  it('掃描真的看到了每個功能的鍵（不是掃了個空）：十幾個鍵、每個鍵都在自己功能的資料夾裡定義', () => {
    const owners = extOwners(readTree(SRC))
    expect(Object.keys(owners).length).toBeGreaterThanOrEqual(15)
    for (const [key, feature] of Object.entries({
      world: 'world', transit: 'transit', trade: 'trade', work: 'work', rest: 'rest', bills: 'bills', director: 'director', scene: 'scene', npcs: 'npcs', roster: 'roster',
      fixer: 'fixer', commission: 'commission', commission_failed: 'commission', defeat: 'defeat', favors: 'favors', security: 'security', security_scan: 'security', security_floors: 'security',
      capture: 'enemies', // 俘虜的鍵（常數 CAPTURE_EXT；以前叫 CAPTURE_KEY，掃描認不得，M2 修正批 11 改名）
    })) expect(owners[key], key).toBe(feature)
  })

  const ext = (file: string, src: string, more: Record<string, string> = {}): string[] => checkExtReads({
    'features/a/model.ts': "export const EXT = 'a_state'\nexport const OTHER_KEY = 'a_other'",
    'features/b/model.ts': "export const EXT = 'b_state'",
    [file]: src, ...more,
  }).map((v) => `${v.feature}→${v.owner}:${v.key}`)

  it('故意寫的反例：讀別的功能的鍵（點、方括號、常數）、寫它（賦值、報告的 ext 變更）都抓得到', () => {
    expect(ext('features/b/x.ts', 'const v = state.ext.a_state')).toEqual(['b→a:a_state'])
    expect(ext('features/b/x.ts', "const v = state.ext['a_state']")).toEqual(['b→a:a_state'])
    expect(ext('features/b/x.ts', 'const v = g.state.ext.a_state')).toEqual(['b→a:a_state'])
    expect(ext('features/b/x.ts', "const EXT_A = 'a_state'\nconst v = state.ext[EXT_A]")).toEqual(['b→a:a_state'])
    expect(ext('features/b/x.ts', 'state.ext.a_state = null')).toEqual(['b→a:a_state'])
    expect(ext('features/b/x.ts', "const c = { op: 'ext', key: 'a_state', value: null }")).toEqual(['b→a:a_state'])
    expect(ext('features/b/x.ts', "const A_KEY = 'a_state'\nconst c = { op: 'ext', key: A_KEY, value: 1 }")).toEqual(['b→a:a_state'])
    expect(ext('features/b/deep/y.ts', 'const v = s.ext.a_state')).toEqual(['b→a:a_state'])
  })

  it('不算的：讀自己的鍵、註解與字串裡寫的、角色與單位與地圖實例的 ext（共用的資料慣例只認格式）、別人的檔案不是功能', () => {
    expect(ext('features/a/x.ts', 'const v = state.ext.a_state\nconst w = state.ext[EXT]')).toEqual([])
    expect(ext('features/b/x.ts', '// 不讀 state.ext.a_state\n/* state.ext.a_state */\nconst t = "state.ext.a_state"')).toEqual([])
    expect(ext('features/b/x.ts', 'const v = actor.ext.a_state\nconst w = unit.ext.a_state\nconst o = origin.ext.a_state\nconst i = inst.ext.a_state')).toEqual([])
    expect(ext('features/b/x.ts', 'const v = state.ext.not_anyones')).toEqual([])
    expect(ext('shell/x.ts', 'const v = state.ext.a_state')).toEqual([])
    expect(ext('features/b/x.test.ts', 'const v = state.ext.a_state')).toEqual([])
  })

  it('在真的原始碼上加一個違規的檔案：抓得到，而且寫出是誰讀了誰的', () => {
    const files = { ...readTree(SRC), 'features/world/spy.ts': "import type { GameState } from '../../core'\nexport const peek = (state: GameState) => state.ext.fixer" }
    const found = checkExtReads(files)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ file: 'features/world/spy.ts', feature: 'world', owner: 'fixer', key: 'fixer' })
    expect(found[0]!.message).toContain('world')
    expect(found[0]!.message).toContain('fixer')
  })
})

// 規格：dev/work/M2-plan.md「每一張都適用的規定」第 2、3 條（能用測試守的）
describe('M2 每一張都適用的規定', () => {
  const TESTS = fileURLToPath(new URL('..', import.meta.url))

  it('第 3 條：engine/src/features 底下每一個功能的資料夾都在總表 FEATURES 裡（做完忘了加那一行就紅），總表裡每一個功能都有資料夾', () => {
    const dirs = readdirSync(join(SRC, 'features')).filter((n) => statSync(join(SRC, 'features', n)).isDirectory()).sort()
    const ids = Object.keys(FEATURES)
    for (const d of dirs) expect(ids, `features/${d} 沒有出現在 FEATURES`).toContain(d)
    // director 資料夾裡有兩個功能（導演與事件視窗）；其餘一個資料夾一個功能
    const extra = ids.filter((id) => !dirs.includes(id))
    expect(extra).toEqual(['event_run'])
    for (const [key, f] of Object.entries(FEATURES)) expect(f.id, key).toBe(key)
  })

  it('第 2 條：各功能的驗收測試（tests/features/M2-<功能>.test.ts）用測試自帶的最小假資料，不 import engine/data（資料的測試在 tests/data、收尾那張 M2-closeout 要對照資料的預設值，除外）', () => {
    const files = readdirSync(join(TESTS, 'features')).filter((n) => /^M2-.*\.test\.ts$/.test(n) && n !== 'M2-closeout.test.ts')
    expect(files.length).toBeGreaterThan(25)
    const bad = files.filter((n) => /from\s+['"](?:\.\.\/)+data(?:\/[^'"]*)?['"]/.test(readFileSync(join(TESTS, 'features', n), 'utf8')))
    expect(bad).toEqual([])
  })

  it('第 2 條的反面：假世界（testkit）不放進 engine/data——engine/data 裡找不到 TEST_WORLD 的任何 id', () => {
    const ids = ['tw_market', 'tw_metro', 'fx_tw_broker', 'cm_tw_office', 'ev_tw_street', 'npc_tw_vendor', 'j_tw_porter', 'r_tw_unit', 'df_tw_pow']
    const data = join(SRC, '..', 'data')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
    const text = walk(data).map((f) => readFileSync(f, 'utf8')).join('\n')
    for (const id of ids) expect(text, id).not.toContain(id)
  })
})
