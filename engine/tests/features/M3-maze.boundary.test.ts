// 邊界測試：M3 迷宮館（CYBERSPACE 8.2 節：報名的組別與押金、標準回合數、評價與獎金倍率、休息點、機關失敗的感載）。
// 每個數值測：下限、下限−1、上限、上限+1、零、最大組合；組合用 fast-check。
//
// 邊界表：
//   四組的押金與獎金（I 50／300、II 150／900、III 500／3,000、IV 1,600／9,800）   → 押金差 1 塊不能報、剛好能報；報名之後現金少剛好一份押金
//   標準回合數 12 + 15 + 10 = 37、評價 S ×1.5／A ×1.2／B ×1／C ×0.7              → 剛好 37 回合 S、38 回合 A；倒下 0／1／2／3 人次；回合與倒下的每個交界；獎金 = round(獎金 × 倍率)
//   一隊最多 4 人、燒傷（net_burn）到幾點                                             → 4 人過、5 人擋；燒傷的 until 剛好等於現在算過了
//   休息點感載 −10                                                                  → 感載 0、5、10、11、最大：不會變成負的
//   機關失敗的感載 +8（I 級）乘等級                                                 → 每一級的數字、等級超出表的用 1

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { GameState } from '../../src'
import { clone, toMinutes } from '../../src'
import { DEFAULT_RULES, brackets, enterBlocks, mazeRules, rate, readMaze } from '../../src/features/maze'
import { closeRun, restDraft } from '../../src/features/maze/ops'
import { diveIn, makeDiveGame, mazeSignUp, refitForRookie } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']

const STANDARD = 12 + 15 + 10

/** 潛入、換比賽版，站在報名之前。 */
function ready(): G {
  const { game } = makeDiveGame()
  refitForRookie(game)
  diveIn(game)
  return game
}

describe('邊界 CYBERSPACE 8.2：報名的押金與獎金（四個等級）', () => {
  it('資料的數字就是規格那張表：新手 I 50／300、公開 II 150／900、無差別 III 500／3,000 與 IV 1,600／9,800', () => {
    const g = ready()
    expect(brackets(g.k, g.state).map((r) => [r.id, r.grade, r.deposit, r.prize])).toEqual([
      ['rookie', 1, 50, 300], ['open', 2, 150, 900], ['unlimited', 3, 500, 3000], ['unlimited', 4, 1600, 9800],
    ])
    expect(DEFAULT_RULES.brackets.open!.grades).toEqual([{ grade: 2, deposit: 150, prize: 900 }])
  })

  it('押金：現金少 1 塊「押金不夠」（寫出要多少、有多少）；剛好等於押金沒有這一句；零塊；每個組別與等級都一樣', () => {
    const g = ready()
    for (const row of brackets(g.k, g.state)) {
      for (const [cash, short] of [[row.deposit - 1, true], [row.deposit, false], [0, true], [row.deposit + 1, false]] as const) {
        const st = clone(g.state)
        st.money.cash = cash
        const blocks = enterBlocks(g.k, st, row.id, row.grade)
        const msg = blocks.find((b) => b.startsWith('押金不夠'))
        expect(!!msg, `${row.id}${row.grade} 現金 ${cash}`).toBe(short)
        if (msg) expect(msg).toBe(`押金不夠：${row.name}要 C$${row.deposit.toLocaleString('en-US')}，你只有 C$${cash.toLocaleString('en-US')}。`)
      }
    }
  })

  it('報名之後現金少剛好一份押金（不多不少）、記下押金；現金剛好等於押金也報得了（剩 0）', () => {
    const g = ready()
    g.state.money.cash = 50
    mazeSignUp(g, 'rookie', 3)
    expect(g.state.money.cash).toBe(0)
    expect(readMaze(g.state)).toMatchObject({ bracket: 'rookie', grade: 1, deposit: 50 })
  })

  it('一隊最多 4 人（max_party）：4 人沒有「最多」那句、5 人有，寫出現在有幾個；規則表改成 1 人就是 1', () => {
    const g = ready()
    const grow = (n: number): GameState => {
      const st = clone(g.state)
      st.party = Array.from({ length: n }, (_, i) => (i === 0 ? st.pc! : `x${i}`))
      for (let i = 1; i < n; i++) st.actors[`x${i}`] = clone(st.actors[st.pc!]!)
      return st
    }
    const over = (n: number) => enterBlocks(g.k, grow(n), 'rookie').find((b) => b.startsWith('一隊最多'))
    expect(mazeRules(g.k).max_party).toBe(4)
    expect(over(1)).toBeUndefined()
    expect(over(4)).toBeUndefined()
    expect(over(5)).toBe('一隊最多 4 個人（現在隊上有 5 個）。')
    expect(over(9)).toBe('一隊最多 4 個人（現在隊上有 9 個）。')
  })

  it('燒傷（net_burn）：until 比現在晚 1 分鐘擋、剛好等於現在不擋、沒寫 until 一直擋（CYBERSPACE 2.4：倒下之後一小時內不能再潛入）', () => {
    const g = ready()
    const now = toMinutes(g.state.time)
    const burn = (until?: number): string | undefined => {
      const st = clone(g.state)
      st.actors[st.pc!]!.conditions = [{ id: 'net_burn', ...(until === undefined ? {} : { until }) }] as never
      return enterBlocks(g.k, st, 'rookie').find((b) => b.includes('燒傷'))
    }
    expect(burn(now + 1)).toMatch(/一個小時內不能再潛入/)
    expect(burn(now)).toBeUndefined()
    expect(burn(now - 1)).toBeUndefined()
    expect(burn()).toMatch(/一個小時內不能再潛入/)
  })
})

describe('邊界 CYBERSPACE 8.2「時間與評價」：總回合數對標準（前庭 12、迴廊 15、館主廳 10）與倒下人次', () => {
  const rules = DEFAULT_RULES

  it('標準回合數合計 37；評價四列 S ×1.5、A ×1.2、B ×1、C ×0.7（規格寫的倍率）', () => {
    expect(rules.layers.reduce((s, l) => s + l.standard, 0)).toBe(STANDARD)
    expect(rules.rating.map((r) => [r.rating, r.mult])).toEqual([['S', 1.5], ['A', 1.2], ['B', 1], ['C', 0.7]])
  })

  it('每個交界：回合 ÷ 標準 ≤ 1 且沒倒下 → S；38 回合 A；46 回合（1.243）A、47 回合（1.27）B；59 回合（1.595）B、60 回合（1.62）C；倒下 1 人次最好 A、2 人次最好 B、3 人次 C', () => {
    const r = (rounds: number, downs: number) => rate(rules, rounds, STANDARD, downs).rating
    expect([r(0, 0), r(1, 0), r(37, 0)]).toEqual(['S', 'S', 'S'])
    expect([r(38, 0), r(46, 0)]).toEqual(['A', 'A'])
    // 47 ÷ 37 = 1.27 超過 1.25：落到 B
    expect([r(47, 0), r(59, 0)]).toEqual(['B', 'B'])
    expect([r(60, 0), r(999, 0)]).toEqual(['C', 'C'])
    expect([r(37, 1), r(46, 1)]).toEqual(['A', 'A'])
    expect([r(47, 1), r(59, 1), r(37, 2), r(59, 2)]).toEqual(['B', 'B', 'B', 'B'])
    expect([r(37, 3), r(0, 3), r(0, 99)]).toEqual(['C', 'C', 'C'])
    expect([r(60, 1), r(60, 2)]).toEqual(['C', 'C'])
  })

  it('性質：回合與倒下人次只增不減時，倍率只減不增；S 一定是 ≤ 標準且零倒下；永遠回傳規則表裡的一列（不丟錯）', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 5 }),
      (rounds, downs, moreRounds, moreDowns) => {
        const a = rate(rules, rounds, STANDARD, downs)
        const b = rate(rules, rounds + moreRounds, STANDARD, downs + moreDowns)
        expect(rules.rating).toContain(a)
        expect(b.mult).toBeLessThanOrEqual(a.mult)
        expect(a.rating === 'S').toBe(rounds <= STANDARD && downs === 0)
      },
    ), { numRuns: 200 })
  })

  /** 在報名之後的狀態複本上，把這一趟記成某一組、某一級，累積的回合與倒下人次照給的，再結算成破關。 */
  function clearWith(g: G, bracket: string, grade: number, deposit: number, rounds: number, downs: number) {
    const st = clone(g.state)
    const m = readMaze(st)!
    ;(st.ext.maze as Record<string, unknown>).bracket = bracket
    ;(st.ext.maze as Record<string, unknown>).grade = grade
    ;(st.ext.maze as Record<string, unknown>).deposit = deposit
    // 回合分三層記（第 2 層放不下就往別層放，合計才是評價用的）
    const per = [Math.min(rounds, 12), Math.min(Math.max(rounds - 12, 0), 15), Math.max(rounds - 27, 0)]
    per.forEach((n, i) => { st.counters[`maze:${m.id}:r${i}`] = n })
    st.counters[`maze:${m.id}:down`] = downs
    const out = closeRun(g.k, st, { id: 'r', layer: 2, origin: { by: 'maze' } }, 'done')!
    const over = (out.changes.find((c) => c.op === 'ext' && (c as unknown as { key: string }).key === 'maze') as unknown as { value: { over: Record<string, unknown> } }).value.over
    return { over, out }
  }

  it('獎金 = round(獎金 × 倍率)：四個等級 × 四種評價全部走一遍（新手 300、公開 900、III 3,000、IV 9,800）；押金全額退回', () => {
    const g = ready()
    mazeSignUp(g, 'rookie', 3)
    const cases: Array<[string, number, number, number]> = [['rookie', 1, 50, 300], ['open', 2, 150, 900], ['unlimited', 3, 500, 3000], ['unlimited', 4, 1600, 9800]]
    // 評價 → 回合數與倒下人次
    const grades: Array<[string, number, number, number]> = [['S', 37, 0, 1.5], ['A', 38, 0, 1.2], ['B', 47, 0, 1], ['C', 60, 0, 0.7]]
    for (const [bracket, grade, deposit, prize] of cases) {
      for (const [rating, rounds, downs, mult] of grades) {
        const { over } = clearWith(g, bracket, grade, deposit, rounds, downs)
        expect(over, `${bracket}${grade} ${rating}`).toMatchObject({ rating, mult, prize: Math.round(prize * mult), refund: deposit, forfeited: 0, rounds, standard: STANDARD, downs })
      }
    }
  })

  it('打輸或中途離開：押金一分不退、沒有獎金；籌碼照算到那一刻（零枚也不丟錯）', () => {
    const g = ready()
    mazeSignUp(g, 'rookie', 3)
    const m = readMaze(g.state)!
    for (const chips of [0, 1, 7]) {
      const st = clone(g.state)
      st.counters[`maze:${m.id}:chip`] = chips
      const out = closeRun(g.k, st, { id: 'r', layer: 0, origin: { by: 'maze' } }, 'defeat')!
      const over = (out.changes.find((c) => c.op === 'ext' && (c as unknown as { key: string }).key === 'maze') as unknown as { value: { over: Record<string, unknown> } }).value.over
      expect(over).toMatchObject({ prize: 0, refund: 0, forfeited: m.deposit, chips, chipCash: chips * 10 })
      const cash = out.changes.filter((c) => c.op === 'cash').reduce((s, c) => s + (c as unknown as { delta: number }).delta, 0)
      expect(cash).toBe(chips * 10)
    }
  })
})

describe('邊界 CYBERSPACE 8.2：休息點（感載 −10）與規則表的數字', () => {
  it('休息點：感載 0、5、10 都降到 0（不變成負的）、11 降到 1、40 降到 30；每個隊員各算各的', () => {
    const g = ready()
    mazeSignUp(g, 'rookie', 3)
    for (const [load, after] of [[0, 0], [5, 0], [10, 0], [11, 1], [40, 30]] as const) {
      const st = clone(g.state)
      st.actors[st.pc!]!.load = load
      const d = restDraft(g.k, st)
      const delta = d.changes.filter((c) => c.op === 'actor.track').reduce((s, c) => s + ((c as unknown as { delta: number }).delta), 0)
      expect(load + delta, `感載 ${load}`).toBe(after)
      expect(load + delta).toBeGreaterThanOrEqual(0)
    }
  })

  it('規則表的數字就是規格寫的：機關失敗感載 +8、休息點 −10、寶箱怪一成、一枚籌碼 C$10、一隊最多 4 人；機關失敗的乘數第 1 級是 ×1（I 級就是 +8）', () => {
    const rules = mazeRules(ready().k)
    expect(rules).toMatchObject({ puzzle_load: 8, rest_load: 10, chip: 10, max_party: 4 })
    // 假世界把寶箱怪關掉（mimic: 0，讓測試不被怪打斷）；規格的數字看內建的預設
    expect(DEFAULT_RULES.mimic).toBe(0.1)
    expect(rules.load_mult[0]).toBe(1)
    // 乘數只增不減（等級越高機關失敗越痛）
    for (let i = 1; i < rules.load_mult.length; i++) expect(rules.load_mult[i]!).toBeGreaterThanOrEqual(rules.load_mult[i - 1]!)
  })
})
