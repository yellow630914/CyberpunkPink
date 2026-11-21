// 從文件抽出介面要用的內容，寫成 src/data/content.generated.ts（有型別的常數）。
// - docs/content/SKILL_TREES.md：八棵樹的共鳴與 216 個技能
// - docs/content/NIGHT_LESSONS.md：夜課五個分支的開階條件、共鳴與技能
// - docs/art/icons/skills.csv：每個技能的第 3 層圖標 id（sk_…）
// - docs/content/GUIDES.md：已經寫好的指南內文；docs/art/UI.md 3.6 節：五十五張指南的清單
// 用法：node scripts/build-content.mjs（npm run build 會先跑它；找不到文件時保留現有的輸出）。
// 解析不了的列印出警告並略過，不讓建置失敗：平衡的工作階段改表格時，介面照樣建得起來。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const docs = join(here, '../../docs')
const out = join(here, '../src/data/content.generated.ts')
const need = ['content/SKILL_TREES.md', 'content/NIGHT_LESSONS.md', 'art/icons/skills.csv', 'content/GUIDES.md', 'art/UI.md'].map(p => join(docs, p))
if (need.some(p => !existsSync(p))) {
  console.log('build-content：找不到文件，保留現有的 content.generated.ts')
  process.exit(0)
}
const read = p => readFileSync(join(docs, p), 'utf8').replace(/\r/g, '')
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
const strip = s => s.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
let warnings = 0
const warn = m => { warnings++; console.warn(`build-content：${m}`) }

// ---- 圖標 ----
const iconOf = new Map()
for (const line of read('art/icons/skills.csv').split('\n').slice(1)) {
  const [id, name, cat] = line.replace(/^﻿/, '').split(',')
  if (id?.startsWith('sk_')) iconOf.set(`${cat}|${name}`, id)
}

// ---- 八棵樹 ----
const TREE_IDS = { 槍手: 'gun', 機師: 'pilot', 改造師: 'surgeon', 潛網者: 'runner', 名媛: 'actor', 掮客: 'broker', 主播: 'streamer', 偶像: 'idol' }
const CATEGORY = { gun: '現實', pilot: '現實', surgeon: '現實', runner: '內海', actor: '社交', broker: '社交', streamer: '媒體', idol: '媒體' }
const KIND_ID = { 主動: 'active', 被動: 'passive', 反應: 'reaction', 姿態: 'stance', 預備: 'prep', 日常: 'daily' }
const trees = []
{
  const lines = read('content/SKILL_TREES.md').split('\n')
  let tree = null, tier = 0, mode = ''
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const h2 = l.match(/^## (\S+)：(\S+)/)
    if (h2 && TREE_IDS[h2[1]]) {
      tree = { id: TREE_IDS[h2[1]], name: h2[1], signature: h2[2], category: CATEGORY[TREE_IDS[h2[1]]], intro: '', resonance: [], skills: [], strength: { real: '', net: '', opinion: '' } }
      trees.push(tree); tier = 0; mode = 'intro'
      continue
    }
    if (/^## /.test(l)) { tree = null; continue }
    if (!tree) continue
    if (mode === 'intro' && l.trim() && !l.startsWith('**') && !l.startsWith('|')) { tree.intro = strip(l).split('。')[0] + '。'; mode = '' }
    if (/^\*\*共鳴\*\*/.test(l)) { mode = 'res'; continue }
    const h3 = l.match(/^### (\d) 階/)
    if (h3) { tier = Number(h3[1]); mode = 'skills'; continue }
    if (!l.startsWith('|') || /^\|[-| ]+\|$/.test(l.trim())) continue
    const c = cells(l)
    if (mode === 'res' && /^\d$/.test(c[0])) { tree.resonance.push({ tier: Number(c[0]), effect: strip(c[1]) }); continue }
    if (mode === 'skills') {
      if (c[0] === '技能') {
        // 表頭：現實（強）內海（弱）輿論（無）
        const m = c.slice(7).map(h => h.match(/（(強|中|弱|無)/)?.[1] ?? '')
        tree.strength = { real: m[0], net: m[1], opinion: m[2] }
        continue
      }
      if (c.length < 10) { warn(`${tree.name} ${tier} 階有一列欄位不夠：${c[0]}`); continue }
      const name = strip(c[0])
      const layer = c[1] === '招牌' ? 'sig' : c[1] === '前' ? 'front' : 'back'
      const kindName = c[2].replace(/（.*$/, '')
      if (!KIND_ID[kindName]) { warn(`${tree.name}「${name}」的種類不認得：${kindName}`); continue }
      tree.skills.push({
        id: `${tree.id}:${name}`, tree: tree.id, name, tier, layer, kind: KIND_ID[kindName], kindName,
        cap: Number(c[3]) || 0, pre: c[4] === '—' ? null : strip(c[4]), cost: c[5] === '—' ? '' : strip(c[5]), weight: strip(c[6]),
        real: strip(c[7]), net: strip(c[8]), opinion: strip(c[9]),
        icon: iconOf.get(`${tree.name} ${tier} 階|${name}`) ?? null,
      })
    }
  }
  // 照前置推出三條線：招牌之下 1 階的三個前層各是一條線的起點
  for (const t of trees) {
    const byName = new Map(t.skills.map(s => [s.name, s]))
    const starts = t.skills.filter(s => s.tier === 1 && s.layer === 'front').map(s => s.name)
    const lineOf = s => {
      if (s.layer === 'sig') return -1
      if (s.tier === 1 && s.layer === 'front') return starts.indexOf(s.name)
      const p = s.pre && byName.get(s.pre)
      return p ? lineOf(p) : 0
    }
    for (const s of t.skills) {
      s.line = lineOf(s)
      if (s.pre && !byName.has(s.pre)) warn(`${t.name}「${s.name}」的前置「${s.pre}」不在這棵樹裡`)
      // 預備與日常的效果寫在表格下方
      if (!s.real && !s.net && !s.opinion) s.real = '效果寫在這棵樹的「預備與日常」。'
    }
  }
}

// ---- 夜課 ----
const BRANCH_IDS = { 共通: 'common', 關係: 'relation', 感官: 'sense', 身體: 'body', 扮相: 'look' }
const branches = []
{
  const lines = read('content/NIGHT_LESSONS.md').split('\n')
  let br = null, tier = 0, mode = '', head = []
  for (const l of lines) {
    const h2 = l.match(/^## (\S+)$/)
    if (h2) {
      br = BRANCH_IDS[h2[1]] ? { id: BRANCH_IDS[h2[1]], name: h2[1], intro: '', gates: [], resonance: [], skills: [] } : null
      if (br) branches.push(br)
      tier = 0; mode = 'intro'; continue
    }
    if (!br) continue
    if (mode === 'intro' && l.trim() && !l.startsWith('|') && !l.startsWith('**')) { br.intro = strip(l).split('。')[0] + '。'; mode = '' }
    if (/^\*\*共鳴\*\*/.test(l)) { mode = 'res'; continue }
    const h3 = l.match(/^\*\*(\d) 階\*\*/)
    if (h3) { tier = Number(h3[1]); mode = 'skills'; continue }
    if (!l.startsWith('|') || /^\|[-| ]+\|$/.test(l.trim())) continue
    const c = cells(l)
    if (c[0] === '階' && /開階/.test(c[1] ?? '')) { mode = 'gate'; continue }
    if (mode === 'gate' && /^\d$/.test(c[0])) { br.gates.push({ tier: Number(c[0]), need: strip(c[1]) }); continue }
    if (mode === 'res' && /^\d$/.test(c[0])) { br.resonance.push({ tier: Number(c[0]), effect: strip(c[1]) }); continue }
    if (mode === 'skills') {
      if (c[0] === '技能') { head = c; continue }
      const col = k => c[head.indexOf(k)] ?? ''
      const name = strip(col('技能'))
      const use = strip(col('用法'))
      const kind = /^體位/.test(use) ? 'pose' : /被動/.test(use) ? 'passive' : /反應/.test(use) ? 'reaction' : /姿態/.test(use) ? 'stance' : 'active'
      br.skills.push({
        id: `night:${br.id}:${name}`, branch: br.id, name, tier, how: strip(col('怎麼做')), tag: strip(col('掛在')), need: col('學習條件') === '—' ? '' : strip(col('學習條件')),
        use, kind, parts: col('部位（我的 → 對方的）') === '—' ? '' : strip(col('部位（我的 → 對方的）')), effect: strip(col('效果')), deep: head.includes('深') ? strip(col('深')) : '',
        extends: /延伸/.test(name), icon: iconOf.get(`夜課・${br.name} ${tier} 階|${name}`) ?? null,
      })
    }
  }
}

// ---- 指南 ----
const guideList = []
{
  const ui = read('art/UI.md')
  const sec = ui.slice(ui.indexOf('**盤點：五十五張**'), ui.indexOf('### 3.7'))
  for (const l of sec.split('\n')) {
    if (!l.startsWith('| ') || l.includes('---') || l.startsWith('| 類')) continue
    const c = cells(l)
    if (c.length < 5) continue
    guideList.push({ id: c[1].replace(/`/g, ''), category: c[0], title: c[2], trigger: c[3], source: strip(c[4]) })
  }
}
const guidePages = {}
{
  const g = read('content/GUIDES.md')
  for (const block of g.split(/\n---\n/)) {
    const m = block.match(/^## (.+)（`(g_\w+)`）/m)
    if (!m) continue
    const pages = []
    for (const p of block.matchAll(/\*\*(\d)／(\d)\*\*\n圖：(.+)\n\n> (.+)/g)) pages.push({ image: strip(p[3]), text: strip(p[4]) })
    if (pages.length) guidePages[m[2]] = pages
  }
}

const header = `// 由 scripts/build-content.mjs 從 docs/ 產生，不要手改。重新產生：npm run content
// 來源：docs/content/SKILL_TREES.md、NIGHT_LESSONS.md、GUIDES.md、docs/art/UI.md 3.6 節、docs/art/icons/skills.csv
/* eslint-disable */
import type { SkillTreeDef, NightBranchDef, GuideMeta, GuidePage } from './skillTypes'
`
const body = [
  `export const SKILL_TREES: SkillTreeDef[] = ${JSON.stringify(trees, null, 1)}`,
  `export const NIGHT_BRANCHES: NightBranchDef[] = ${JSON.stringify(branches, null, 1)}`,
  `export const GUIDE_LIST: GuideMeta[] = ${JSON.stringify(guideList, null, 1)}`,
  `export const GUIDE_PAGES: Record<string, GuidePage[]> = ${JSON.stringify(guidePages, null, 1)}`,
].join('\n\n')
writeFileSync(out, `${header}\n${body}\n`)
const nSkills = trees.reduce((s, t) => s + t.skills.length, 0)
const nNight = branches.reduce((s, b) => s + b.skills.length, 0)
console.log(`build-content：${trees.length} 棵樹 ${nSkills} 個技能、夜課 ${branches.length} 個分支 ${nNight} 個技能、指南 ${guideList.length} 張（內文 ${Object.keys(guidePages).length} 張）${warnings ? `，警告 ${warnings}` : ''}`)
