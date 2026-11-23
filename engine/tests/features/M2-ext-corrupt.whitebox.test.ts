// 白箱：M2 功能的狀態（state.ext.<功能>）被讀檔、舊版存檔或手改弄成形狀不對的東西時，每個功能的「讀」與「畫面的資料」不能丟例外。
// 規格：dev/invariants.md 第 6 條（讀不進來的存檔不改變現在的狀態；讀進來的就要能玩）、GAME_DESIGN 第 3 節第 13 條；功能的 `xxxOf(state)` 檔頭都寫「形狀不對的部分當成空的」。
// 做法：開一局有進度的城市（租屋、買東西、打工、搭車、接案、事件、場景……），對每一個功能的 ext 鍵與它底下的每一層鍵，換成十幾種壞值，
// 再呼叫每個功能匯出的讀取函式與畫面資料函式，記下丟例外的。唯二的例外見檢查處的註解（受控的「沒有這一件」錯誤、引擎自己寫的成人場景紀錄不驗形狀）。

import { describe, expect, it } from 'vitest'
import type { GameState } from '../../src'
import { board, readFixer, scoutView } from '../../src/features/fixer'
import { commissionView, readRun } from '../../src/features/commission'
import { directorView, eventView, directorOf, openEventOf } from '../../src/features/director'
import { favorsOf } from '../../src/features/favors'
import { billPreview, readBills } from '../../src/features/bills'
import { homeOf, readRest } from '../../src/features/rest'
import { rosterView, readRoster, candidatesOf } from '../../src/features/roster'
import { sceneView, sceneOf } from '../../src/features/scene'
import { favorView, hostilityView, scanView } from '../../src/features/security'
import { shopView, stockOf, bargainView, tradeOf } from '../../src/features/trade'
import { transitView, transitOf } from '../../src/features/transit'
import { readWork } from '../../src/features/work'
import { worldView, worldOf } from '../../src/features/world'
import { memoriesOf, newsOf, readNpcs, npcOf } from '../../src/features/npcs'
import { makeCityGame, doStep } from '../../src/testkit'

const BAD: unknown[] = [null, 'x', '', -1, 0, 1.5, Number.NaN, [], {}, true, [null], [1, 2], { a: 1 }, { id: 'x' }, [{}], [[]]]
const KEYS = ['world', 'transit', 'director', 'security', 'npcs', 'roster', 'bills', 'rest', 'trade', 'commission', 'fixer', 'scene', 'work', 'favors']

describe('白箱 M2 狀態的讀取：ext 被弄壞時不丟例外', () => {
  it('每個功能的 ext 鍵 × 每一層鍵 × 十六種壞值，讀取函式與畫面資料函式都只能回傳東西，不能丟例外', async () => {
    const { game } = makeCityGame({ seed: 7 })
    const steps: Array<[string, Record<string, unknown>]> = [
      ['flag', { key: 'tw_street_a', value: true }], ['walk', { to: 'across' }], ['until_idle', {}], ['walk', { to: 'E2' }], ['walk', { to: 'F1' }],
      ['ride', { line: 'tw_metro', dest: 's_market' }], ['buy', { shop: 's_tw_stall', item: 'i_tw_ration', qty: 2 }], ['work', { job: 'j_tw_porter', hours: 4 }],
      ['offer', { index: 0 }], ['scout', {}],
    ]
    for (const [name, args] of steps) { try { await doStep(game, name, args) } catch { /* 有些步驟被擋就算了 */ } }
    const k = game.k
    const base = game.state
    const job = readFixer(base).jobs[0]?.id ?? 'none'
    const readers: Array<[string, (s: GameState) => unknown]> = [
      ['worldView', (s) => worldView(k, s)], ['worldOf', (s) => worldOf(s)],
      ['transitView', (s) => transitView(k, s)], ['transitOf', (s) => transitOf(s)],
      ['directorView', (s) => directorView(s)], ['eventView', (s) => eventView(k, s)], ['directorOf', (s) => directorOf(s)], ['openEventOf', (s) => openEventOf(s)],
      ['scanView', (s) => scanView(k, s)], ['hostilityView', (s) => hostilityView(k, s)], ['favorView', (s) => favorView(k, s)],
      ['readNpcs', (s) => readNpcs(s)], ['newsOf', (s) => newsOf(s, 'npc_tw_vendor')], ['memoriesOf', (s) => memoriesOf(s)], ['npcOf', (s) => npcOf(k, s, 'npc_tw_vendor')],
      ['rosterView', (s) => rosterView(k, s)], ['readRoster', (s) => readRoster(s)], ['candidatesOf', (s) => candidatesOf(s)],
      ['billPreview', (s) => billPreview(k, s)], ['readBills', (s) => readBills(s)],
      ['homeOf', (s) => homeOf(k, s)], ['readRest', (s) => readRest(s)],
      ['shopView', (s) => shopView(k, s, 's_tw_stall')], ['stockOf', (s) => stockOf(k, s, 's_tw_stall')], ['bargainView', (s) => bargainView(k, s, 's_tw_stall')], ['tradeOf', (s) => tradeOf(s)],
      ['commissionView', (s) => commissionView(k, s)], ['readRun', (s) => readRun(s)],
      ['board', (s) => board(k, s, 'fx_tw_broker')], ['readFixer', (s) => readFixer(s)], ['scoutView', (s) => scoutView(k, s, job)],
      ['sceneView', (s) => sceneView(k, s)], ['sceneOf', (s) => sceneOf(s)],
      ['readWork', (s) => readWork(s)], ['favorsOf', (s) => favorsOf(s)],
    ]
    for (const [, fn] of readers) fn(base) // 原樣不會壞
    const crashes = new Map<string, string>()
    let calls = 0
    for (const key of KEYS) {
      const orig = base.ext[key]
      const variants: Array<{ label: string; ext: unknown }> = BAD.map((b) => ({ label: `${key}←${JSON.stringify(b)}`, ext: b }))
      if (orig && typeof orig === 'object') {
        for (const sub of Object.keys(orig as Record<string, unknown>)) {
          for (const b of BAD) {
            const copy = structuredClone(orig) as Record<string, unknown>
            copy[sub] = b
            variants.push({ label: `${key}.${sub}←${JSON.stringify(b)}`, ext: copy })
          }
          const copy = structuredClone(orig) as Record<string, unknown>
          delete copy[sub]
          variants.push({ label: `${key}.${sub}←(刪掉)`, ext: copy })
        }
      }
      for (const v of variants) {
        const s = structuredClone(base)
        s.ext[key] = v.ext
        for (const [name, fn] of readers) {
          try { fn(s); calls++ } catch (e) { crashes.set(`${name} | ${v.label}`, (e as Error).message.slice(0, 70)) }
        }
      }
    }
    expect(calls).toBeGreaterThan(5000)
    // 例外的兩類：scoutView 問一件手上沒有的委託（fixer 被弄壞時委託清單是空的）本來就是「沒有這一件」的受控錯誤；
    // 進行中的成人場景只有 id 的紀錄（scene 的活動狀態由引擎自己寫，sceneOf 只認得「有 id 的物件」，不另外驗形狀）
    const unexpected = [...crashes].filter(([a, b]) => !(a.startsWith('scoutView | fixer') && b.startsWith('手上沒有')) && !(a.startsWith('sceneView | scene←{"id":"x"}')))
    expect(unexpected).toEqual([])
  }, 60_000)
})
