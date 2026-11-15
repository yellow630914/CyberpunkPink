// 把設計書的 HTML 轉成 PDF，並截兩張預覽圖檢查版面。
// 用法：node tools/book/pdf.mjs
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')
const dir = resolve(import.meta.dirname, '../../docs/book')
const html = join(dir, 'CyberpunkPink-設計書.html')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(pathToFileURL(html).href)
if (process.argv.includes('--shots')) {
  const out = process.argv[process.argv.indexOf('--shots') + 1]
  await page.screenshot({ path: join(out, 'book-cover.png') })
  await page.evaluate(() => document.getElementById('doc-core_rules').scrollIntoView())
  await page.screenshot({ path: join(out, 'book-rules.png') })
  await page.evaluate(() => document.getElementById('doc-districts').scrollIntoView())
  await page.screenshot({ path: join(out, 'book-districts.png') })
}
await page.pdf({ path: join(dir, 'CyberpunkPink-設計書.pdf'), format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' }, printBackground: true })
console.log('→ docs/book/CyberpunkPink-設計書.pdf')
await browser.close()
