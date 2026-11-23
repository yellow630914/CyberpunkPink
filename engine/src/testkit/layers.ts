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
  if (p.startsWith('core/action/') || p.startsWith('core/battle/') || p.startsWith('core/grid/') || p === 'core/kernel.ts' || p === 'core/index.ts') return { layer: 5 }
  // 功能的總表：把所有功能列在一起的那一個檔，算在外殼（它可以 import 每個功能；功能不可以 import 它）
  if (p === 'features/index.ts') return { layer: 7 }
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
      out.push({ file, rule: 'unknown-layer', message: `${file} 不在任何一層的資料夾裡（core/types、core/util、core/content、core/state、core/rules、core/action、core/battle、core/grid、features/<功能>、shell、testkit）` })
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

// ---- 功能不讀別的功能的 state.ext（dev/adr/0016 第三節；dev/work/M2-plan.md 第 4 條） ----

export interface ExtViolation {
  file: string
  /** 讀或寫的那個功能 */
  feature: string
  /** state.ext 的鍵 */
  key: string
  /** 這個鍵是哪個功能的 */
  owner: string
  message: string
}

/** 看起來是「整局的狀態」的接收者（state、s、st、work、next、fresh、snap、….state、….work）；actor.ext、unit.ext、instance.ext、origin.ext 不算。 */
const STATE_RECEIVER = /(?:^|[^\w.])(?:state|s|st|work|next|fresh|snap)$|\.(?:state|work)$/
const EXT_ACCESS = /([\w.]*?)\.ext(?:\.([A-Za-z_][\w]*)|\[\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w]*))\s*\])/g
const EXT_CHANGE = /op:\s*'ext'\s*,\s*key:\s*(?:'([^']+)'|([A-Za-z_][\w]*))/g
const KEY_CONST = /\bconst\s+([A-Za-z_]*EXT[A-Za-z_]*|[A-Za-z_]*_KEY)\s*=\s*'([a-z_][a-z0-9_]*)'/g

/** 每個功能自己定義的常數（功能 → 名字 → 值）、鍵 → 擁有的功能，與去掉註解的原始碼（只收功能的檔案）。 */
function scanFeatures(files: Record<string, string>): { consts: Map<string, Map<string, string>>; owners: Map<string, string>; code: Map<string, string> } {
  const consts = new Map<string, Map<string, string>>()
  const owners = new Map<string, string>()
  const code = new Map<string, string>()
  for (const [file, src] of Object.entries(files)) {
    const l = layerOf(file)
    const f = l?.layer === 6 ? (l.feature ?? null) : null
    if (!f || !file.endsWith('.ts') || /\.(test|spec)\.ts$/.test(file)) continue
    const text = stripComments(src)
    code.set(file, text)
    for (const m of text.matchAll(KEY_CONST)) {
      if (!consts.has(f)) consts.set(f, new Map())
      consts.get(f)!.set(m[1]!, m[2]!)
      // 名字帶 EXT 的才是 state.ext 的鍵；_KEY 只用來把常數解成字串（不當成擁有者）
      if (/EXT/.test(m[1]!) && !owners.has(m[2]!)) owners.set(m[2]!, f)
    }
  }
  return { consts, owners, code }
}

/** 每一個 state.ext 的鍵是哪個功能的（鍵 → 功能）。測試用它確認掃描真的看到了每個功能的鍵（不是掃了個空）。 */
export function extOwners(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(scanFeatures(files).owners)
}

/**
 * 掃 engine/src 的功能（features/<功能>/），找出「讀或寫別的功能的 state.ext.<鍵>」。純函式：吃「路徑 → 原始碼」的表（同 checkLayers）。
 *
 * 一個鍵是誰的：在某個功能的檔案裡寫了 `const EXT = '鍵'`（名字帶 EXT 或以 _KEY 結尾）的那個功能。
 * 抓三種寫法：state.ext.鍵、state.ext['鍵']、state.ext[常數]（常數在同一個功能裡找得到），以及報告的變更 { op: 'ext', key: '鍵' }。
 * 註解、字串裡的不算；actor.ext、unit.ext 這種不是整局狀態的不算（共用的資料慣例照 0016 第七節，只認格式）。
 * 功能的總表（features/index.ts）與測試基礎建設、外殼不檢查。
 */
export function checkExtReads(files: Record<string, string>): ExtViolation[] {
  const { consts, owners, code } = scanFeatures(files)
  const out: ExtViolation[] = []
  const flag = (file: string, f: string, key: string, how: string): void => {
    const owner = owners.get(key)
    if (owner && owner !== f) out.push({ file, feature: f, key, owner, message: `${file}：功能 ${f} ${how}了功能 ${owner} 的 state.ext.${key}（只經由 meterOf、k.stats、k.conditions、內容與核心的狀態讀，經由變更與效果寫）` })
  }
  for (const [file, text] of code) {
    const f = layerOf(file)!.feature!
    // 字串裡寫的不算（例：說明文字提到 state.ext.xxx）：比對的起點落在某個字串裡就略過；方括號寫法的鍵本身是字串，但「.ext[」在字串外面
    const strings = [...text.matchAll(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g)].map((m) => [m.index!, m.index! + m[0].length] as const)
    const inString = (at: number): boolean => strings.some(([a, b]) => at > a && at < b)
    for (const m of text.matchAll(EXT_ACCESS)) {
      if (inString(m.index!) || !STATE_RECEIVER.test(m[1]!)) continue
      const key = m[2] ?? m[3] ?? m[4] ?? consts.get(f)?.get(m[5] ?? '')
      if (key) flag(file, f, key, '讀寫')
    }
    for (const m of text.matchAll(EXT_CHANGE)) {
      if (inString(m.index!)) continue
      const key = m[1] ?? consts.get(f)?.get(m[2] ?? '')
      if (key) flag(file, f, key, '用變更寫')
    }
  }
  return out
}
