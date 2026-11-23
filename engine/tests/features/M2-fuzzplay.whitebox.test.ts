// 白箱：隨機玩（狀態機式的壞掉輸入）。對城市與委託兩個情境，每一步從一張選單隨機挑一個動作（有些參數是壞的），做很多步：
//   - 每一步只能成功，或丟「要玩家知道的原因」（ActionBlocked／GridBlocked／ChangeError／走不過去這類寫了原因的錯），絕不丟 TypeError／RangeError／ReferenceError；
//   - 每一份報告的變更套用之後等於狀態的變化（不變式第 2 條，observed）；
//   - 狀態隨時都過存檔的格式檢查（validateState）、存檔再讀檔狀態一樣（不變式第 6 條）、兩種錢不是負的、時間只往前走（除了回退、讀檔）；
//   - 同一個種子、同一串動作，結果一樣（種子重播）。
// 規格：dev/invariants.md 第 1、2、5、6、7 條；GAME_DESIGN 第 3 節（壞輸入整串不套、狀態不變）。

import { describe, expect, it } from 'vitest'
import { ActionBlocked, toMinutes } from '../../src'
import { breathDraft, leaveDraft, rentDraft, sleepDraft } from '../../src/features/rest'
import { setBill } from '../../src/features/bills'
import { taxi, transitOf } from '../../src/features/transit'
import { checkout } from '../../src/features/trade'
import { shift } from '../../src/features/work'
import { muster } from '../../src/features/roster'
import { M2_STEPS, makeCityGame, makeCommissionGame, observed, passTime, stateHash } from '../../src/testkit'
import { validateState } from '../../src/shell/save'
import type { Game } from '../../src/shell/game'

type Rnd = (n: number) => number
const mulberry = (seed: number): Rnd => {
  let a = seed >>> 0
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
  }
}

const MARKERS = ['E1', 'E2', 'F1', 'F2', 'F3', 'T1', 'X9']
const HOURS = [-1, 0, 1, 2, 4, 8, 9, Number.NaN]
const ACTIONS: Array<[string, (g: Game, r: Rnd) => unknown]> = [
  ['walk', (g, r) => M2_STEPS.walk!(g, { to: r(4) === 0 ? 'across' : MARKERS[r(MARKERS.length)]! })],
  ['pass', (g, r) => passTime(g, [1, 5, 60, 600, 1440][r(5)]!)],
  ['breath', (g) => g.commit(breathDraft(g.k, g.state))],
  ['sleep', (g, r) => g.commit(sleepDraft(g.k, g.state, r(3) === 0 ? { spot: 'wild' } : {}))],
  ['rent', (g) => g.commit(rentDraft(g.k, g.state, 'r_tw_unit'))],
  ['leave', (g) => g.commit(leaveDraft(g.k, g.state))],
  ['work', (g, r) => g.commit(shift(g.k, g.state, 'j_tw_porter', HOURS[r(HOURS.length)]!))],
  ['buy', (g, r) => g.commit(checkout(g.k, g.state, 's_tw_stall', { buy: [{ item: 'i_tw_ration', qty: [1, 2, 5, 25, 0, -1][r(6)]! }], pay: r(2) ? 'cash' : 'cred' }))],
  ['ride', (g) => M2_STEPS.ride!(g, { line: 'tw_metro', dest: 's_market' })],
  ['taxi', (g, r) => { const v = transitOf(g.state).visited; if (v.length) for (const d of taxi(g.k, g.state, v[r(v.length)]!)) g.commit(d) }],
  ['bill', (g, r) => setBill(g.k, g.state, 'rent', { stopped: r(2) === 0 })],
  ['flag', (g, r) => M2_STEPS.flag!(g, { key: r(2) ? 'tw_street_a' : 'tw_street_b', value: r(2) === 0 })],
  ['idle', (g) => M2_STEPS.until_idle!(g, {})],
  ['offer', (g, r) => M2_STEPS.offer!(g, { index: r(3) })],
  ['scout', (g) => M2_STEPS.scout!(g, {})],
  ['muster', (g) => M2_STEPS.muster!(g, {})],
  ['unmuster', (g) => g.commit(muster(g.k, g.state, { party: [], tagalong: [] }))],
  ['go', (g) => M2_STEPS.go!(g, {})],
  ['stage', (g) => M2_STEPS.stage!(g, {})],
  ['retreat', (g) => M2_STEPS.retreat!(g, {})],
  ['surrender', (g) => M2_STEPS.surrender!(g, {})],
  ['accept', (g) => M2_STEPS.accept_defeat!(g, {})],
  ['rewind_stage', (g) => M2_STEPS.rewind_stage!(g, {})],
  ['undo', (g) => g.undoSteps(1)],
  ['save_load', (g) => { const err = g.load(g.save('manual', 'fuzz')); if (err) throw new Error(`讀檔失敗：${err}`) }],
]

const isCrash = (e: unknown): boolean => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError

async function run(seed: number, named: 'city' | 'commission', steps: number): Promise<{ hash: string; log: string[] }> {
  const rnd = mulberry(seed * 7919 + (named === 'city' ? 1 : 2))
  const t = named === 'city' ? makeCityGame({ seed }) : makeCommissionGame({ seed })
  const g = t.game
  const log: string[] = []
  const { violations } = await observed(g, async () => {
    let lastTime = toMinutes(g.state.time)
    for (let i = 0; i < steps; i++) {
      const [name, fn] = ACTIONS[rnd(ACTIONS.length)]!
      const before = stateHash(g.state)
      try {
        await fn(g, rnd)
        log.push(`${name}:ok`)
      } catch (e) {
        if (isCrash(e)) throw new Error(`第 ${i + 1} 步 ${name} 丟了 ${(e as Error).name}：${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(0, 4).join('\n')}`)
        log.push(`${name}:${e instanceof ActionBlocked ? 'blocked' : 'err'}`)
        // 壞輸入整串不套：被擋下的動作，狀態一個字都不變（走路走到一半、戰鬥打到一半的動作除外：它們自己會留下紀錄）
        if (e instanceof ActionBlocked && !['walk', 'idle', 'stage', 'ride', 'surrender', 'taxi'].includes(name)) expect(stateHash(g.state), `${name} 被擋下之後狀態變了`).toBe(before)
      }
      const problems = validateState(JSON.parse(JSON.stringify(g.state)))
      expect(problems, `第 ${i + 1} 步 ${name} 之後`).toEqual([])
      expect(g.state.money.cash).toBeGreaterThanOrEqual(0)
      expect(g.state.money.cred).toBeGreaterThanOrEqual(0)
      if (name !== 'undo' && name !== 'save_load' && name !== 'rewind_stage' && name !== 'retreat' && name !== 'accept') {
        expect(toMinutes(g.state.time), `第 ${i + 1} 步 ${name} 之後時間倒退`).toBeGreaterThanOrEqual(lastTime)
      }
      lastTime = toMinutes(g.state.time)
    }
  })
  expect(violations).toEqual([])
  // 存檔再讀檔：一樣
  const before = stateHash(g.state)
  expect(g.load(g.save('manual', 'end'))).toBeNull()
  expect(stateHash(g.state)).toBe(before)
  return { hash: before, log }
}

describe('白箱 M2 隨機玩：壞輸入與亂序的動作', () => {
  it('城市：六個種子各 45 步，不丟程式錯誤、不變式成立、狀態隨時合法；同一個種子重玩結果一樣', async () => {
    let ok = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = await run(seed, 'city', 45)
      ok += a.log.filter((x) => x.endsWith(':ok')).length
      if (seed <= 2) expect((await run(seed, 'city', 45)).hash).toBe(a.hash)
    }
    expect(ok).toBeGreaterThan(40)
  }, 120_000)

  it('委託：六個種子各 45 步（接案、踩點、召集、進副本、撤退、戰敗、回到階段開始）', async () => {
    let ok = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = await run(seed, 'commission', 45)
      ok += a.log.filter((x) => x.endsWith(':ok')).length
      if (seed <= 2) expect((await run(seed, 'commission', 45)).hash).toBe(a.hash)
    }
    expect(ok).toBeGreaterThan(40)
  }, 120_000)
})
