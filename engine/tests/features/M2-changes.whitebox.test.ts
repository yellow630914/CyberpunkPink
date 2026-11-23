// 白箱：M2 各功能註冊的變更（`k.changes.register` 的 validate／apply）。
// 規格：dev/invariants.md 第 1、2 條（狀態只會被變更改到；壞的變更整串不套、狀態不變）、第 4、6 條；dev/adr/0016（報告的 action 與變更的 op 一對一註冊）。
// 做法：把主幹與幾條補充路線（tests/helpers/m2-flows.ts：城市、委託、撤退、戰敗）跑一遍，把每一種 op 實際用過的變更連同「套用它之前的狀態」記下來；
// 再對每一筆樣本的每個欄位做「破壞」（刪掉、型別不對、負數、小數、NaN、無限大、超大整數、空容器），加上原始碼裡讀過的選填欄位。
// 性質：validate 一定回字串陣列、絕不丟例外；validate 放行的，apply 也不能丟例外，套完的狀態仍然過 validateState（壞的變更不准溜進狀態）。
// 已知的漏洞列在 KNOWN（見 dev/bugs）；修好之後清掉。

import { describe, expect, it } from 'vitest'
import type { Change, GameState } from '../../src'
import { makeCityGame, makeCommissionGame, doStep } from '../../src/testkit'
import type { Repro } from '../../src/testkit'
import { CITY_ROUTE, COMMISSION_ROUTES } from '../helpers/m2-flows'
import type { Step } from '../helpers/m2-flows'
import { validateState } from '../../src/shell/save'
import type { ChangeAt } from '../../src/core/state/changes'

interface Sample { op: string; pre: GameState; change: Change; at: ChangeAt }

const BAD: unknown[] = [undefined, null, 'x', '', -1, 0, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_993, [], {}, true, [1, 2], { a: 1 }]

/** 主幹跑一遍：每一種 op 最多記三筆（套用之前的狀態、那一筆變更、在那一串裡的位置）。 */
let recorded: Promise<Sample[]> | undefined
const record = (): Promise<Sample[]> => (recorded ??= doRecord())
async function doRecord(): Promise<Sample[]> {
  const samples: Sample[] = []
  const quota = new Map<string, number>()
  const run = async (t: ReturnType<typeof makeCityGame> | ReturnType<typeof makeCommissionGame>, steps: Repro['inputs']) => {
    const { game } = t
    const real = game.k.changes.applyAll.bind(game.k.changes)
    game.k.changes.applyAll = (state, changes) => {
      if (changes.some((c) => (quota.get(c.op) ?? 0) < 3)) {
        const sim = structuredClone(state)
        changes.forEach((c, i) => {
          const def = game.k.changes.get(c.op)
          const at = { index: i, count: changes.length }
          if ((quota.get(c.op) ?? 0) < 3) {
            quota.set(c.op, (quota.get(c.op) ?? 0) + 1)
            samples.push({ op: c.op, pre: structuredClone(sim), change: structuredClone(c), at })
          }
          try { def?.apply(sim, c, at) } catch { /* 這一串之後會在 real 裡丟，不是這裡的事 */ }
        })
      }
      real(state, changes)
    }
    // 工廠做情境時用掉的變更（接案、招募、租屋……）在包裝之前，從紀錄補：狀態用「套完之後」的（形狀才是重點，不求在原本那一刻合法）
    const logged = (): void => {
      const seen = new Map<string, number>()
      for (const c of samples) seen.set(c.op, (seen.get(c.op) ?? 0) + 1)
      const post = structuredClone(game.state)
      for (const r of game.state.reports) {
        r.changes.forEach((c, i) => {
          if ((seen.get(c.op) ?? 0) >= 3 || !game.k.changes.get(c.op)) return
          seen.set(c.op, (seen.get(c.op) ?? 0) + 1)
          samples.push({ op: c.op, pre: post, change: structuredClone(c), at: { index: i, count: r.changes.length } })
        })
      }
    }
    logged()
    for (const s of steps) {
      if (s.type === 'm2') {
        // 補的幾條路線有些步驟會被擋（沒有旗標、沒有東西可打）：記錄用的，擋下就算了
        try { await doStep(game, s.do, s) } catch { /* 被擋的步驟不是這裡要驗的 */ }
      } else if (s.type === 'save_load') {
        const err = game.load(game.save('manual', 'x'))
        if (err) throw new Error(err)
      }
    }
    logged()
  }
  // 城市與委託的補充路線（共用的 tests/helpers/m2-flows.ts）：街頭事件、帶場景的事件、買賣、打工、睡覺跨週一、長時間；撤退、戰敗被接受、戰敗回到階段開始
  const asInputs = (route: Step[]): Repro['inputs'] => route.map((x) => ({ type: 'm2' as const, ...x }))
  for (const seed of [7, 3, 11]) await run(makeCityGame({ seed }), asInputs(CITY_ROUTE))
  for (const seed of [7, 3]) for (const route of COMMISSION_ROUTES) await run(makeCommissionGame({ seed }), asInputs(route))
  return samples
}

function mutations(change: Change): Array<{ label: string; change: Change }> {
  const out: Array<{ label: string; change: Change }> = []
  for (const key of Object.keys(change)) {
    if (key === 'op') continue
    for (const bad of BAD) {
      const c = { ...change } as Record<string, unknown>
      if (bad === undefined) delete c[key]
      else c[key] = bad
      out.push({ label: `${key}←${JSON.stringify(bad)}`, change: c as Change })
    }
  }
  // 不是物件的欄位也壞掉一次：整份巢狀的值換成別的型別
  return out
}

describe('白箱 M2 變更：validate 不丟例外；放行的 apply 也不丟例外、狀態仍合法', () => {
  it('主幹用過的每一種 op 都有樣本；樣本原樣 validate 通過（記下來的就是提交成功的）', async () => {
    const samples = await record()
    const ops = new Set(samples.map((s) => s.op))
    expect(ops.size).toBeGreaterThan(40)
    for (const prefix of ['npcs.', 'fixer.', 'roster.', 'transit.', 'world.', 'meter', 'ext']) {
      expect([...ops].some((o) => o.startsWith(prefix)), prefix).toBe(true)
    }
  }, 60_000)

  it('每一筆樣本的每個欄位 × 壞值：validate 回字串陣列；放行的 apply 不丟例外、套完仍過 validateState', async () => {
    const samples = await record()
    const { game } = makeCityGame({ seed: 7 })
    const k = game.k
    let calls = 0
    let passed = 0
    const throws = new Set<string>()
    const badState = new Set<string>()
    for (const s of samples) {
      const def = k.changes.get(s.op)!
      for (const m of mutations(s.change)) {
        let problems: string[]
        try {
          problems = def.validate(s.pre, m.change, s.at)
        } catch (e) {
          throws.add(`${s.op} ${m.label}：${(e as Error).message.slice(0, 60)}`)
          continue
        }
        calls++
        expect(Array.isArray(problems), `${s.op} ${m.label}`).toBe(true)
        if (problems.length > 0) continue
        passed++
        const work = structuredClone(s.pre)
        try {
          def.apply(work, m.change, s.at)
        } catch (e) {
          throws.add(`${s.op} ${m.label}（validate 放行、apply 丟）：${(e as Error).message.slice(0, 60)}`)
          continue
        }
        const v = validateState(JSON.parse(JSON.stringify(work)))
        if (v.length > 0) badState.add(`${s.op} ${m.label}：${v[0]}`)
      }
    }
    expect(passed).toBeGreaterThan(100)
    expect(calls).toBeGreaterThan(4000)
    expect([...throws]).toEqual([])
    expect([...badState]).toEqual([])
  }, 120_000)

  it('每一個 op（包含情境用不到的）：欄位值從「這一局狀態裡的字串、其他 op 樣本裡的欄位值、壞值」亂抽，validate 也只能回字串陣列、不丟例外；放行的 apply 不丟例外', async () => {
    const samples = await record()
    const t = makeCommissionGame({ seed: 7 })
    const game = t.game
    const k = game.k
    const state = game.state
    // 狀態裡的 id 與字串（委託、角色、街區、勢力……）和所有樣本的欄位值
    const strings = new Set<string>(['pc', 'small', 'mid', 'big', 'owed_to_pc', 'owed_by_pc', 'done', 'failed', 'cash', 'cred', 'meat', 'net', 'hire', 'pay', 'share', 'fee'])
    const walk = (v: unknown, depth = 0): void => {
      if (depth > 6 || strings.size > 600) return
      if (typeof v === 'string' && v.length < 40) strings.add(v)
      else if (Array.isArray(v)) v.slice(0, 20).forEach((x) => walk(x, depth + 1))
      else if (v && typeof v === 'object') for (const [key, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) { if (key.length < 40) strings.add(key); walk(x, depth + 1) }
    }
    walk(state.ext)
    walk(Object.keys(state.actors))
    const fieldValues: unknown[] = []
    for (const s of samples) for (const [key, v] of Object.entries(s.change)) if (key !== 'op' && fieldValues.length < 400) fieldValues.push(structuredClone(v))
    const pool: unknown[] = [...BAD.filter((b) => b !== undefined), ...strings, ...fieldValues, 1, 2, 3, 40, 100, { day: 1, hour: 2, minute: 3 }, ['pc'], { id: 'x' }]
    let seed = 12345
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    let calls = 0
    let passed = 0
    const throws = new Set<string>()
    for (const op of k.changes.ops()) {
      const def = k.changes.get(op)!
      const src = `${def.validate.toString()}\n${def.apply.toString()}`
      const param = /^[^(]*\(\s*\w+\s*,\s*(\w+)/.exec(def.validate.toString())?.[1]
      const names = new Set<string>(['id', 'key', 'npc', 'value', 'delta', 'who', 'actor', 'job'])
      if (param) for (const m of src.matchAll(new RegExp(`\\b${param}\\.(\\w+)`, 'g'))) names.add(m[1]!)
      const list = [...names]
      for (let n = 0; n < 300; n++) {
        const c: Record<string, unknown> = { op }
        for (const f of list) if (rnd(4) > 0) c[f] = pool[rnd(pool.length)]
        try {
          const problems = def.validate(state, c as Change, { index: 0, count: 1 })
          calls++
          expect(Array.isArray(problems), op).toBe(true)
          if (problems.length === 0) {
            passed++
            def.apply(structuredClone(state), c as Change, { index: 0, count: 1 })
          }
        } catch (e) {
          throws.add(`${op} ${JSON.stringify(c).slice(0, 100)}：${(e as Error).message.slice(0, 60)}`)
        }
      }
    }
    expect(calls).toBeGreaterThan(15000)
    expect([...throws]).toEqual([])
    void passed
  }, 60_000)
})
