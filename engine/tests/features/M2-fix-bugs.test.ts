// M2 修 bug 批（dev/work/M2-fix-bugs.md）的行為測試：B016～B022、W014、W015 的回歸測試在各自搬過去的檔案
// （tests/boundary/B016、B018、B019；tests/whitebox/B020、B021、B022、W014-W015；B017 是接受的行為，tests/boundary/B017-*.accepted）；
// 這裡補每一項修正的周邊行為（來源分級、邊界、格式），街頭信譽與下限的規則在 M2-fixer-pay、M2-security。
// 規格：EVENTS 2.4（封閉清單與上限）、AI_TASKS 2.5、GAME_DESIGN 第 3 節第 13 條、DOWNTIME 2.2～2.3、dev/adr/0017 M2 修 bug 批的補記。

import { describe, expect, it } from 'vitest'
import type { EffectCtx } from '../../src'
import { ChangeError, effectCtx, meterOf } from '../../src'
import { chooseBranch, chooseFace, readRun } from '../../src/features/commission'
import { go } from '../../src/features/fixer'
import { makeCityGame, makeCommissionGame, RUNNER } from '../../src/testkit'

type CityGame = ReturnType<typeof makeCityGame>['game']
const resolve = (g: CityGame, effects: unknown[], source: EffectCtx['source'], opts: { clampAsked?: boolean; playerInput?: string } = {}) =>
  g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source, clampAsked: opts.clampAsked ?? true, ...(opts.playerInput ? { playerInput: opts.playerInput } : {}) }))
const commit = (g: CityGame, changes: Parameters<CityGame['commit']>[0]['changes']) =>
  g.commit({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })

// ===================================================================================================================
describe('B016：體悟（AI 一件事只能加 0～+5，不能扣）', () => {
  it('AI 往下不行：從 8 給 −9 拿到 0 變動；內建的結算照寫的算（−9 扣到 0 為止）', () => {
    const { game: g } = makeCityGame({ seed: 6 })
    commit(g, [{ op: 'meter', kind: 'insight', key: '_', set: 8 }])
    const ai = resolve(g, [{ kind: 'insight', amount: -9 }], 'ai')
    expect(ai.errors).toEqual([])
    expect(ai.changes.every((c) => c.op !== 'meter' || (c as { delta?: number }).delta === 0 || (c as { delta?: number }).delta === undefined)).toBe(true)
    commit(g, ai.changes)
    expect(meterOf(g.k, g.state, 'insight')).toBe(8)
    expect(ai.clamps[0]).toMatchObject({ from: -9, to: 0 })
    const builtin = resolve(g, [{ kind: 'insight', amount: -9 }], 'builtin')
    expect(builtin.changes).toEqual([{ op: 'meter', kind: 'insight', key: '_', delta: -8 }])
  })

  it('AI 往上照舊：+9 只收 5；量表的 cap 是 { down: 0, up: 5 }', () => {
    const { game: g } = makeCityGame({ seed: 6 })
    expect(g.k.meters.get('insight')!.cap).toEqual({ down: 0, up: 5 })
    const ai = resolve(g, [{ kind: 'insight', amount: 9 }], 'ai')
    expect(ai.changes).toEqual([{ op: 'meter', kind: 'insight', key: '_', delta: 5 }])
  })
})

// ===================================================================================================================
describe('B018：警戒只在委託副本裡，key 要是存在的地圖實例', () => {
  function inStage() {
    const t = makeCommissionGame({ seed: 6 })
    const g = t.game
    g.commit(go(g.k, g.state, t.job))
    g.commit(chooseFace(g.k, g.state, 'meat'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    return { g, map: readRun(g.state)!.map! }
  }

  it('不在副本裡：AI 與玩家要的（不管夾不夾值）整筆拿掉，提醒說警戒只在委託副本裡；內建的照寫的算', () => {
    const { game: g } = makeCityGame({ seed: 6 })
    const at = g.state.maps.at!.map
    const ai = resolve(g, [{ kind: 'alert', amount: 5 }], 'ai')
    expect(ai.errors).toEqual([])
    expect(ai.changes).toEqual([])
    expect(ai.lines).toEqual([])
    expect(ai.clamps[0]!.notice).toBe('「警戒」這一筆沒有算：警戒只在委託副本裡有。')
    for (const clampAsked of [true, false]) {
      const p = resolve(g, [{ kind: 'alert', amount: 5, asked: '警戒' }], 'player', { clampAsked, playerInput: '警戒' })
      expect(p.changes, `${clampAsked}`).toEqual([])
    }
    expect(resolve(g, [{ kind: 'alert', amount: 5 }], 'builtin').changes).toEqual([{ op: 'meter', kind: 'alert', key: at, delta: 5 }])
  })

  it('同一批裡別的效果照收：警戒被拿掉，錢照給', () => {
    const { game: g } = makeCityGame({ seed: 6 })
    const r = resolve(g, [{ kind: 'alert', amount: 5 }, { kind: 'cash', amount: 10 }], 'ai')
    expect(r.changes).toEqual([{ op: 'cash', delta: 10 }])
    expect(r.lines).toHaveLength(1)
  })

  it('副本裡：照收；這一批的警戒被拿掉不佔別的警戒的合計（只算收下的）', () => {
    const { g, map } = inStage()
    const r = resolve(g, [{ kind: 'alert', amount: 12 }, { kind: 'alert', amount: 12 }], 'ai')
    // 拆成兩筆也一樣：合計 +20（12 ＋ 8）
    expect(r.changes.every((c) => c.op === 'meter' && c.kind === 'alert' && c.key === map)).toBe(true)
    expect(r.changes.reduce((sum, c) => sum + (c.delta as number), 0)).toBe(20)
  })

  it('key 寫一張不存在的地圖實例是格式錯誤（整批不收）；核心的 meter 變更也擋，不留沒用的鍵', () => {
    const { g } = inStage()
    for (const source of ['builtin', 'ai'] as const) {
      const r = resolve(g, [{ kind: 'alert', key: 'm999', amount: 1 }, { kind: 'cash', amount: 10 }], source)
      expect(r.errors.join(), source).toContain('現在沒有 m999 這份地圖')
      expect(r.changes).toEqual([])
    }
    const { game: city } = makeCityGame({ seed: 6 })
    const before = JSON.stringify(city.state.meters)
    expect(() => commit(city, [{ op: 'meter', kind: 'alert', key: 'm999', delta: 1 }])).toThrow(ChangeError)
    expect(JSON.stringify(city.state.meters)).toBe(before)
  })
})

// ===================================================================================================================
describe('B019：忠誠只有名冊上的人有', () => {
  it('AI 與玩家要的忠誠給不在名冊上的人：整筆拿掉並提醒；名冊上的照收；內建的結算照寫的算', () => {
    const { game: g } = makeCommissionGame({ seed: 6 })
    const mixed = g.k.effects.resolve([{ kind: 'loyalty', key: 'npc_tw_friend', amount: 5 }, { kind: 'loyalty', key: RUNNER, amount: 5 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(mixed.errors).toEqual([])
    expect(mixed.changes).toEqual([{ op: 'meter', kind: 'loyalty', key: RUNNER, delta: 5 }])
    expect(mixed.lines).toHaveLength(1)
    expect(mixed.clamps[0]!.notice).toBe('「忠誠」這一筆沒有算：忠誠只有名冊上的人有。')
    const asked = g.k.effects.resolve([{ kind: 'loyalty', key: 'npc_tw_friend', amount: 5, asked: '忠誠' }], effectCtx(g.k, g.state, { source: 'player', clampAsked: false, playerInput: '忠誠' }))
    expect(asked.changes).toEqual([])
    const builtin = g.k.effects.resolve([{ kind: 'loyalty', key: 'npc_tw_friend', amount: 5 }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(builtin.changes).toEqual([{ op: 'meter', kind: 'loyalty', key: 'npc_tw_friend', delta: 5 }])
  })

  it('不在名冊上的人被拿掉的那一筆不佔名冊上的人的合計（兩筆各自 +10 都收）', () => {
    const { game: g } = makeCommissionGame({ seed: 6 })
    const r = g.k.effects.resolve([{ kind: 'loyalty', key: RUNNER, amount: 10 }, { kind: 'loyalty', key: 'npc_tw_friend', amount: 10 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(r.changes).toEqual([{ op: 'meter', kind: 'loyalty', key: RUNNER, delta: 10 }])
    expect(meterOf(g.k, g.state, 'loyalty', RUNNER)).toBe(30)
  })
})

// ===================================================================================================================
describe('B022：封閉清單（AI 可以用的效果）', () => {
  it('aiKinds 沒有 debt、bargain、perk、scout_reveal、deck_rental、deck_script_use；meet、npc_known 保留給 AI；其餘的都在；錯誤訊息列的是 AI 能用的', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    const all = g.k.effects.kinds()
    const ai = g.k.effects.aiKinds()
    expect(all).toEqual(expect.arrayContaining(['debt', 'bargain', 'bill', 'cred']))
    expect(ai).not.toContain('debt')
    expect(ai).not.toContain('bargain')
    expect(ai).toEqual(expect.arrayContaining(['bill', 'cred', 'cash', 'hostility', 'insight']))
    expect(ai).toEqual(expect.arrayContaining(['meet', 'npc_known']))
    expect(all.filter((k) => !ai.includes(k)).sort()).toEqual(['bargain', 'debt', 'deck_rental', 'deck_script_use', 'perk', 'scout_reveal'])
    const err = resolve(g, [{ kind: 'debt', to: 'f_corp', amount: 100, rate: 0.1 }], 'ai').errors.join()
    expect(err).toContain('不是 AI 與玩家要的結果可以用的效果')
    expect(err).not.toContain('debt、') // 可以用的清單裡不列 debt
    const unknown = resolve(g, [{ kind: 'nope', amount: 1 }], 'ai').errors.join()
    expect(unknown).toContain('不在封閉清單裡')
    expect(unknown).not.toContain('bargain')
  })

  it('perk、scout_reveal 不給 AI（整批不收）；內建的不被封閉清單擋（perk 內建照收見 M0-perks）；meet、npc_known 仍給 AI', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    const cases: Array<[string, Record<string, unknown>]> = [['perk', { kind: 'perk', id: 'smooth_talker' }], ['scout_reveal', { kind: 'scout_reveal', job: 'nope' }]]
    for (const [kind, effect] of cases) {
      for (const source of ['ai', 'player'] as const) {
        const r = resolve(g, [effect], source)
        expect(r.errors.join(), `${kind}/${source}`).toContain('不是 AI 與玩家要的結果可以用的效果')
        expect(r.changes, `${kind}/${source}`).toEqual([])
      }
      // 內建的來源不被封閉清單擋（scout_reveal 指到沒有的委託只是沒東西可揭，不是被擋）
      expect(resolve(g, [effect], 'builtin').errors.join(), `${kind}/builtin`).not.toContain('不是 AI 與玩家要的結果可以用的效果')
    }
    expect(g.k.effects.aiKinds()).toEqual(expect.arrayContaining(['meet', 'npc_known']))
  })

  it('玩家要的結果也不能用（夾值關著、asked 對得上也一樣：封閉清單不是上限）；內建的照常', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    const debt = { kind: 'debt', to: 'f_corp', amount: 1_000_000_000, rate: 1, asked: '一筆債' }
    for (const clampAsked of [true, false]) {
      const r = resolve(g, [debt], 'player', { clampAsked, playerInput: '我要一筆債' })
      expect(r.errors.join(), `${clampAsked}`).toContain('不是 AI 與玩家要的結果可以用的效果')
      expect(r.changes).toEqual([])
    }
    expect(resolve(g, [{ ...debt, amount: 500, rate: 0.1 }], 'builtin').errors).toEqual([])
  })

  it('bill 新項目：AI 一件事的總額（每週的金額 × 週數）合計不超過信譽那一階的錢的上限（新手 120）；超過的縮短期數', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    const bill = (amount: number, weeks: number) => ({ kind: 'bill', name: '保護費', amount, weeks, pay: 'cred' })
    const give = (effects: unknown[], source: EffectCtx['source'] = 'ai') => resolve(g, effects, source).changes.filter((c) => c.op === 'bills.extra') as unknown as Array<{ amount: number; weeks: number }>
    expect(give([bill(10, 5)])).toEqual([expect.objectContaining({ amount: 10, weeks: 5 })]) // 50，沒超過
    expect(give([bill(30, 10)])).toEqual([expect.objectContaining({ amount: 30, weeks: 4 })]) // 300 → 縮成 4 週（120）
    expect(give([bill(9_000_000_000, 520)])).toEqual([expect.objectContaining({ amount: 120, weeks: 1 })]) // 付不起一期就把金額縮成上限
    // 拆成兩筆也一樣：合計 120
    const two = give([bill(60, 1), bill(60, 2)])
    expect(two.reduce((s, c) => s + c.amount * c.weeks, 0)).toBeLessThanOrEqual(120)
    expect(resolve(g, [bill(60, 1), bill(60, 2)], 'ai').clamps.length).toBeGreaterThan(0)
    // 內建的、玩家明說要而且夾值關著的：照寫的算
    expect(give([bill(9_000, 52)], 'builtin')).toEqual([expect.objectContaining({ amount: 9_000, weeks: 52 })])
    const asked = resolve(g, [{ ...bill(9_000, 52), asked: '保護費' }], 'player', { clampAsked: false, playerInput: '保護費' })
    expect(asked.changes.filter((c) => c.op === 'bills.extra')).toEqual([expect.objectContaining({ amount: 9_000, weeks: 52 })])
  })

  it('bill 加減某一項（item）不受新項目的總額管（照原本「不超過那一項金額的一半」）', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    const r = resolve(g, [{ kind: 'bill', item: 'rent', amount: 1 }], 'ai')
    expect(r.errors).toEqual([])
  })
})

// ===================================================================================================================
describe('B020：special_map 的格式檢查遇到壞形狀回問題清單', () => {
  const base = () => ({
    id: 'm_b20x', kind: 'street', size: [5, 3],
    sheets: [{
      id: 's', name: '街', size: [5, 3], layout: ['#####', 'E1F2E', '#####'],
      cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '西口' }, { id: 'F1', at: [2, 1], mark: 'F', name: '設施' }, { id: 'E2', at: [4, 1], mark: 'E', name: '東口' }],
      spots: [{ id: '!1', at: [1, 1], cover: 'sparse' }, { id: '!2', at: [3, 1], cover: 'dense' }],
    }],
  })
  const { game } = makeCityGame({ seed: 7 })
  const problems = (mutate: (m: ReturnType<typeof base>) => void): string[] => {
    const m = base()
    mutate(m)
    let out: string[] = []
    expect(() => { out = game.k.content.validate('special_map', [m as never]) }).not.toThrow()
    return out
  }

  it('合格的驗得過；問題訊息寫出是哪一張圖、哪一個欄位', () => {
    expect(problems(() => undefined)).toEqual([])
    expect(problems((m) => { (m.sheets[0] as Record<string, unknown>).cells = 'x' }).join()).toContain('sheets/s：cells 要是陣列')
    expect(problems((m) => { (m.sheets[0]!.cells[1] as Record<string, unknown>).at = [1] }).join()).toContain('cells[1]（F1）的 at 要是 [x, y] 兩個整數')
    expect(problems((m) => { (m.sheets[0]!.spots[0] as Record<string, unknown>).at = [0.5, 1] }).join()).toContain('spots[0]（!1）的 at 要是 [x, y] 兩個整數')
  })

  it('links、cell 的 id 與 mark 壞了也不丟例外', () => {
    for (const links of ['x', 5, null, {}, [null], [5], [{}], [{ to: 's' }], [{ to: 's', at: 'x' }], [{ to: 's', at: [null] }], [{ to: 's', at: [[1]] }]]) {
      const p = problems((m) => { (m.sheets[0] as Record<string, unknown>).links = links })
      expect(p.length > 0 || links === null, JSON.stringify(links)).toBe(true)
    }
    expect(problems((m) => { (m.sheets[0]!.cells[0] as Record<string, unknown>).mark = 5 }).join()).toContain('要有 mark')
    expect(problems((m) => { (m.sheets[0]!.cells[0] as Record<string, unknown>).id = null }).join()).toContain('要有 id')
    expect(problems((m) => { (m.sheets[0] as Record<string, unknown>).cells = [null, 5, 'x', [], {}] }).length).toBeGreaterThan(0)
    expect(problems((m) => { (m.sheets as unknown[])[0] = null }).length).toBeGreaterThan(0)
  })
})

// ===================================================================================================================
describe('W015：沒有跨過週一的 weekly 觸發點照收', () => {
  it('別的功能自己發的 weekly（不是時間過去帶來的）導演照擲一次', async () => {
    const { makeCityGame: city } = await import('../../src/testkit')
    const PACK = {
      id: 'w015b', content: {
        event_scope: [{ id: 'wk_test', triggers: { weekly: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
        event: [{ id: 'ev_w015b', scope: 'wk_test', triggers: ['weekly'], blocking: false, text: '一週又過了。', effects: [] }],
      } as never,
    }
    const t = city({ content: [PACK] })
    const g = t.game
    const before = g.state.reports.filter((r) => r.action === 'event.notice').length
    g.commit({ kind: 'system', action: 'test.weekly', location: {}, party: [], timeline: [], changes: [], triggers: [{ point: 'weekly' }], outcome: { result: 'ok', summary: '測試' } })
    expect(g.state.reports.filter((r) => r.action === 'event.notice').length - before).toBe(1)
  })
})
