// 白箱：M2 各功能的內容格式檢查（`defineKind` 的 `validate`，以及功能 `ready` 裡的第二段檢查）。
// 規格：GAME_DESIGN 第 3 節第 13 條（格式錯誤一律擋下，壞資料不准進到引擎）；dev/adr/0017（規則表後載入的取代前面的）；dev/adr/0016 第八節（規則表欄位）。
// 做法：拿一局完整世界（假世界加資料的規則表）載好的每一筆內容，逐一對每一個欄位做「破壞」：
// 刪掉、換成別的型別、負數、小數、NaN、無限大、超大整數、空容器、多一個不認得的鍵，再交給檢查。
// 性質：檢查一定回傳字串陣列（或丟 ContentError），絕不丟 TypeError／RangeError（壞資料要寫成問題清單，不能把載入搞當機）。
// 已知的漏洞（B020：special_map 的 cells／spots 型別不對時 TypeError）列在 KNOWN_CRASH，重現在 tests/pending/B020-*；修好後把白名單清空。

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allFeatures } from '../../src/features'
import { makeWorldGame } from '../../src/testkit'

type Json = unknown
type Path = Array<string | number>

const BAD: Json[] = [null, 'x', '', -1, 0, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_993, [], {}, true, [1, 2], { a: 1 }]

function leaves(v: Json, at: Path = [], out: Array<{ path: Path; value: Json }> = [], depth = 0) {
  out.push({ path: at, value: v })
  if (depth >= 5) return out
  if (Array.isArray(v)) v.slice(0, 4).forEach((x, i) => leaves(x, [...at, i], out, depth + 1))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, Json>).slice(0, 40)) leaves(x, [...at, k], out, depth + 1)
  return out
}

function setAt(root: Record<string, Json>, path: Path, value: Json | undefined): Record<string, Json> {
  const copy = structuredClone(root)
  let cur: any = copy
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!]
  const last = path[path.length - 1]!
  if (value === undefined) {
    if (Array.isArray(cur)) cur.splice(last as number, 1)
    else delete cur[last]
  } else cur[last] = value
  return copy
}

const label = (kind: string, path: Path) => `${kind}:${path.map((x) => (typeof x === 'number' ? '#' : x)).join('.')}`
/** B020：special_map 的 sheets[].cells／spots 型別不對時 validate 丟 TypeError，而不是回問題清單。 */
const KNOWN_CRASH = (key: string) => /^special_map:sheets\.#\.(cells|spots)(\.|$)/.test(key)

describe('白箱 M2 內容格式檢查：每一個欄位被破壞都只會變成問題清單，不會丟例外', () => {
  const { game } = makeWorldGame()
  const content = game.k.content
  const kinds = content.kindIds().filter((k) => content.list(k).length > 0)

  it('有東西可以破壞：很多種類、很多筆；原樣的每一筆都合格', () => {
    expect(kinds.length).toBeGreaterThan(30)
    expect(kinds.reduce((n, k) => n + content.list(k).length, 0)).toBeGreaterThan(100)
    for (const kind of kinds) for (const e of content.list(kind)) expect(content.validate(kind, [e]), `${kind}/${e.id}`).toEqual([])
  })

  it('validate：每一筆的每一個欄位 × 十五種壞值，回傳字串陣列、不丟例外（已知的 special_map 除外）', () => {
    let calls = 0
    let rejected = 0
    const crashes = new Set<string>()
    for (const kind of kinds) {
      for (const entry of content.list(kind)) {
        const base = entry as Record<string, Json>
        for (const leaf of leaves(base)) {
          if (leaf.path.length === 0 || (leaf.path.length === 1 && leaf.path[0] === 'id')) continue
          for (const bad of [undefined, ...BAD]) {
            const mutated = setAt(base, leaf.path, bad)
            try {
              const problems = content.validate(kind, [mutated])
              expect(Array.isArray(problems)).toBe(true)
              expect(problems.every((p) => typeof p === 'string')).toBe(true)
              calls++
              if (problems.length > 0) rejected++
            } catch (e) {
              crashes.add(label(kind, leaf.path))
            }
          }
        }
      }
    }
    expect(calls).toBeGreaterThan(8000)
    expect(rejected / calls).toBeGreaterThan(0.3)
    expect([...crashes].filter((c) => !KNOWN_CRASH(c))).toEqual([])
  })

  it('validate：在每個物件節點加上「程式碼裡讀的選填欄位」（從原始碼找出來的欄位名）× 壞值：還是只回問題清單、不丟例外', () => {
    // 假資料沒有用到的選填欄位（例：副本的 events、店的 stock 的細節）：把原始碼裡 `x.欄位 !== undefined` 的欄位名全部拿來塞進去
    const src = join(__dirname, '..', '..', 'src', 'features')
    const names = new Set<string>()
    for (const d of readdirSync(src, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      for (const f of readdirSync(join(src, d.name))) {
        if (!f.endsWith('.ts')) continue
        for (const m of readFileSync(join(src, d.name, f), 'utf8').matchAll(/\b\w+\.(\w+) (?:!==|===) undefined/g)) names.add(m[1]!)
      }
    }
    expect(names.size).toBeGreaterThan(200)
    const crashes = new Set<string>()
    let calls = 0
    let rejected = 0
    for (const kind of kinds) {
      for (const entry of content.list(kind).slice(0, 1)) {
        const base = entry as Record<string, Json>
        const nodes = leaves(base).filter((l) => l.value && typeof l.value === 'object' && !Array.isArray(l.value)).slice(0, 6)
        for (const node of nodes) {
          for (const name of names) {
            for (const bad of ['x', -1, {}]) {
              const mutated = node.path.length === 0 ? { ...structuredClone(base), [name]: bad } : setAt(base, [...node.path, name], bad)
              try {
                const problems = content.validate(kind, [mutated])
                calls++
                if (problems.length > 0) rejected++
              } catch {
                crashes.add(label(kind, [...node.path, name]))
              }
            }
          }
        }
      }
    }
    expect(calls).toBeGreaterThan(30000)
    expect(rejected).toBeGreaterThan(1000)
    expect([...crashes].filter((c) => !KNOWN_CRASH(c))).toEqual([])
  })

  it('整份不是陣列、元素不是物件、id 格式不對、id 重複：每一個種類都在載入前就擋', () => {
    for (const kind of kinds) {
      expect(content.validate(kind, {} as never), kind).not.toEqual([])
      expect(content.validate(kind, [null] as never), kind).not.toEqual([])
      expect(content.validate(kind, [{ id: 'Bad Id' }]), kind).not.toEqual([])
      const first = content.list(kind)[0]!
      expect(content.validate(kind, [first, first]).some((p) => p.includes('重複')), kind).toBe(true)
    }
  })

  it('ready（第二段，跨內容的檢查）：被破壞又通過 validate 的內容，每個功能的 ready 只能回 ContentError，不能 TypeError／RangeError；改完還原', () => {
    const k = game.k
    const readys = allFeatures().filter((f) => f.ready)
    expect(readys.length).toBeGreaterThan(10)
    const crashes = new Map<string, string>()
    let accepted = 0
    let rejected = 0
    for (const kind of kinds) {
      for (const entry of content.list(kind)) {
        const base = entry as Record<string, Json>
        for (const leaf of leaves(base)) {
          if (leaf.path.length === 0 || (leaf.path.length === 1 && leaf.path[0] === 'id')) continue
          for (const bad of [undefined, 'x', null, -1, 1.5, [], {}]) {
            const mutated = setAt(base, leaf.path, bad)
            let ok = false
            try { ok = content.validate(kind, [mutated]).length === 0 } catch { ok = false }
            if (!ok) continue
            accepted++
            content.load(kind, [mutated], { replace: true })
            try {
              for (const f of readys) {
                try {
                  f.ready!(k)
                } catch (e) {
                  if ((e as Error).name === 'ContentError') rejected++
                  else if (e instanceof TypeError || e instanceof RangeError) crashes.set(`${label(kind, leaf.path)} ← ${JSON.stringify(bad)}`, `${f.id}：${(e as Error).message.slice(0, 80)}`)
                }
              }
            } finally {
              content.load(kind, [base], { replace: true })
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(3000)
    expect(rejected).toBeGreaterThan(100)
    expect([...crashes]).toEqual([])
    // 還原乾淨：每一筆照樣合格
    for (const kind of kinds) for (const e of content.list(kind)) expect(content.validate(kind, [e]), `${kind}/${e.id}`).toEqual([])
  })
})
