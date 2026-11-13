// 把 docs/art/ 與 docs/mockups/ 的 SVG、HTML 轉成 PNG 預覽圖。
// 用法：node tools/art/render.mjs [檔案 ...]   （不給檔案時轉全部）
// 輸出：docs/art/preview/<檔名>.png
import { createRequire } from 'node:module'
import { readdirSync, mkdirSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// 用 require 載入，全域安裝的 playwright 也找得到（ESM 的 import 不看 NODE_PATH）。
const { chromium } = createRequire(import.meta.url)('playwright')

const root = resolve(import.meta.dirname, '../..')
const out = join(root, 'docs/art/preview')
mkdirSync(out, { recursive: true })

const dirs = ['docs/art', 'docs/mockups']
const all = dirs.flatMap(d => {
  try { return readdirSync(join(root, d)).filter(f => /\.(svg|html)$/.test(f)).map(f => join(root, d, f)) }
  catch { return [] }
})
const files = process.argv.slice(2).map(f => resolve(f))
const targets = files.length ? files : all

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } })
for (const file of targets) {
  await page.goto(pathToFileURL(file).href)
  await page.waitForTimeout(150)
  const name = basename(file, extname(file)) + '.png'
  if (file.endsWith('.svg')) {
    await page.locator('svg').first().screenshot({ path: join(out, name) })
  } else {
    await page.screenshot({ path: join(out, name), fullPage: true })
  }
  console.log('→', join('docs/art/preview', name))
}
await browser.close()
