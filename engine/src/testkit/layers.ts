// 測試基礎建設：分層檢查（dev/test-harness.md 第 5 節；CODESCAN 第 3 節）。掃描 engine/src 的 import，
// 違反分層就回報。純函式：吃「路徑 → 原始碼」的表，讀檔在測試那一邊（tests/core/layers.test.ts）。
//
// 規則：
//  1. 下層不 import 上層（L0 型別 → L1 純工具 → L2 內容 → L3 狀態核心 → L4 規則核心 → L5 行動核心 → L6 功能 → L7 外殼）。
//  2. L6 的功能之間不直接 import。
//  3. 引擎不 import vue、pinia 或任何套件，也不 import node: 的模組；不碰瀏覽器的全域物件。
//  4. 正式的程式不 import 測試基礎建設（testkit）與測試檔。

export interface LayerViolation {
  file: string
  rule: 'upward' | 'feature-to-feature' | 'package' | 'browser' | 'testkit' | 'unknown-layer'
  message: string
}

/** 一個檔案（相對於 engine/src 的路徑，用 / 分隔）在第幾層；功能另外回傳它的名字。 */
export function layerOf(path: string): { layer: number; feature?: string } | null {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (p.startsWith('core/types/')) return { layer: 0 }
  if (p.startsWith('core/util/')) return { layer: 1 }
  if (p.startsWith('core/content/')) return { layer: 2 }
  if (p.startsWith('core/state/')) return { layer: 3 }
  if (p.startsWith('core/rules/')) return { layer: 4 }
  if (p.startsWith('core/action/') || p === 'core/kernel.ts' || p === 'core/index.ts') return { layer: 5 }
  const f = /^features\/([^/]+)(\/|\.ts$)/.exec(p)
  if (f) return { layer: 6, feature: f[1]!.replace(/\.ts$/, '') }
  if (p.startsWith('shell/')) return { layer: 7 }
  if (p.startsWith('testkit/')) return { layer: 8 }
  if (p === 'index.ts') return { layer: 9 }
  return null
}

const LAYER_NAME = ['L0 型別', 'L1 純工具', 'L2 內容', 'L3 狀態核心', 'L4 規則核心', 'L5 行動核心', 'L6 功能', 'L7 外殼', '測試基礎建設', '公開介面']

/** 引擎裡不能出現的瀏覽器全域物件（引擎是純 TypeScript）。 */
const BROWSER_GLOBALS = ['localStorage', 'sessionStorage', 'indexedDB', 'window', 'document', 'navigator', 'location.href', 'XMLHttpRequest', 'HTMLElement']

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/** 原始碼裡所有 import 的目標（靜態、動態、re-export、declare module）。 */
export function importsOf(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[2]!)
  return out
}

function resolve(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * 檢查一棵 engine/src 的檔案。files 的鍵是相對於 engine/src 的路徑（例如 core/util/rng.ts）。
 * 測試檔（*.test.ts、*.spec.ts）不檢查分層，但不可以被正式的程式 import。
 */
export function checkLayers(files: Record<string, string>): LayerViolation[] {
  const out: LayerViolation[] = []
  const isTest = (p: string) => /\.(test|spec)\.ts$/.test(p) || p.includes('/__tests__/')
  for (const [file, src] of Object.entries(files)) {
    if (!file.endsWith('.ts') || isTest(file)) continue
    const me = layerOf(file)
    if (!me) {
      out.push({ file, rule: 'unknown-layer', message: `${file} 不在任何一層的資料夾裡（core/types、core/util、core/content、core/state、core/rules、core/action、features/<功能>、shell、testkit）` })
      continue
    }
    for (const spec of importsOf(src)) {
      if (!spec.startsWith('.')) {
        out.push({ file, rule: 'package', message: `${file} import 了 ${spec}：引擎是純 TypeScript，不 import vue、pinia、node: 或任何套件` })
        continue
      }
      const target = resolve(file, spec)
      if (isTest(`${target}.ts`) || /(^|\/)tests?\//.test(target)) {
        out.push({ file, rule: 'testkit', message: `${file} import 了測試檔 ${spec}` })
        continue
      }
      const candidates = [`${target}.ts`, `${target}/index.ts`, target]
      const hit = candidates.find((c) => c in files) ?? `${target}.ts`
      const other = layerOf(hit)
      if (!other) continue
      if (other.layer === 8 && me.layer !== 8) {
        out.push({ file, rule: 'testkit', message: `${file} import 了測試基礎建設 ${spec}：testkit 只給測試用` })
        continue
      }
      if (other.layer > me.layer) {
        out.push({ file, rule: 'upward', message: `${file}（${LAYER_NAME[me.layer]}）import 了上層的 ${hit}（${LAYER_NAME[other.layer]}）` })
      } else if (me.layer === 6 && other.layer === 6 && me.feature !== other.feature) {
        out.push({ file, rule: 'feature-to-feature', message: `功能 ${me.feature} 直接 import 了功能 ${other.feature}（${spec}）：L6 之間只能透過登錄表與掛鉤` })
      }
    }
    if (me.layer <= 7) {
      const code = stripComments(src).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
      for (const g of BROWSER_GLOBALS) {
        if (new RegExp(`(^|[^.\\w$])${g.replace('.', '\\.')}\\b`).test(code)) out.push({ file, rule: 'browser', message: `${file} 用了瀏覽器的 ${g}：引擎不碰瀏覽器 API，由 ui 的 store 把資料傳進來` })
      }
    }
  }
  return out
}
