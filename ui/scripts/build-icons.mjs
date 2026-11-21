// 從 docs/art/style/icons-l3-sprite.svg 抽出 src/data 用到的第 3 層圖標，攤平成 public/icons-items.svg。
// 為什麼要攤平：第 3 層的每個 symbol 裡面是 <use href="#sub-…">，瀏覽器不畫「外部 sprite 裡再 use 一次」的東西，
// 所以把 sub-… 的內容直接貼進每個 symbol。只抽用到的，檔案小。
// 用法：node scripts/build-icons.mjs（npm run build 會先跑它；找不到原檔時保留現有的輸出）。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '../../docs/art/style/icons-l3-sprite.svg')
const out = join(here, '../public/icons-items.svg')
const dataDir = join(here, '../src/data')

if (!existsSync(src)) {
  console.log(`build-icons：找不到 ${src}，保留現有的 ${out}`)
  process.exit(0)
}
const sprite = readFileSync(src, 'utf8')
const ids = new Set()
for (const f of readdirSync(dataDir)) {
  if (!f.endsWith('.ts')) continue
  for (const m of readFileSync(join(dataDir, f), 'utf8').matchAll(/\b(it_[0-9a-f]{6}|sk_[a-z]+_[0-9a-f]{6})\b/g)) ids.add(m[1])
}
const symbols = new Map()
for (const m of sprite.matchAll(/<symbol id="([^"]+)"([^>]*)>([\s\S]*?)<\/symbol>/g)) symbols.set(m[1], { attrs: m[2], body: m[3] })
const inline = (body, depth = 0) => body.replace(/<use href="#(sub-[0-9a-f]+)"([^>]*)\/>/g, (_, sub, rest) => {
  const s = symbols.get(sub)
  if (!s || depth > 3) return ''
  return `<g${rest}>${inline(s.body, depth + 1)}</g>`
})
const style = sprite.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? ''
// 原檔有少數標籤重複寫了同一個屬性（例：fill 兩次）。HTML 解析器會忽略後面那個，
// 但當成外部 SVG 讀時是 XML 錯誤，整份 sprite 從那裡以後都畫不出來。這裡照 HTML 的做法只留第一個。
const dedupeAttrs = svg => svg.replace(/<([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"]*")+)\s*(\/?)>/g, (all, tag, attrs, close) => {
  const seen = new Set()
  const kept = [...attrs.matchAll(/\s+([a-zA-Z:-]+)="([^"]*)"/g)].filter(([, k]) => !seen.has(k) && seen.add(k))
  return `<${tag}${kept.map(([, k, v]) => ` ${k}="${v}"`).join('')}${close ? '/' : ''}>`
})
let n = 0
const parts = []
for (const id of [...ids].sort()) {
  const s = symbols.get(id)
  if (!s) { console.warn(`build-icons：sprite 裡沒有 ${id}`); continue }
  parts.push(dedupeAttrs(`<symbol id="${id}" viewBox="0 0 200 200" overflow="visible">${inline(s.body)}</symbol>`))
  n++
}
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${style}\n${parts.join('\n')}\n</svg>\n`)
console.log(`build-icons：${n} 個圖標 → public/icons-items.svg`)
