// 白箱測試：M2-core-shell 新增的分支與錯誤路徑（snapshot.take、報告的 rewind、commitNarrated、走地圖與開活動帶 rewind）。
// 補 tests/core/shell-m2.test.ts 沒有走到的地方。規格：dev/adr/0016 第二節；dev/invariants.md 第 89～92 條。

import { describe, expect, it } from 'vitest'
import type { ActivityDef, Change, Feature, ReportDraft, SpecialMapEntry } from '../../src'
import { ActionBlocked, ChangeError, clone, commitReport, unpackSave } from '../../src'
import { TEST_ACTIVITY, makeGame, makeState, makeStateKernel, observed, stateHash } from '../../src/testkit'

const draft = (changes: Change[], action = 'wb.note', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: `${action}。` }, ...extra,
})
const take = (kind: string, extra: Record<string, unknown> = {}): Change => ({ op: 'snapshot.take', kind, label: `快照 ${kind}`, ...extra })
const retreat = (action = 'wb.retreat', kind = 'entry'): ReportDraft => draft([], action, { rewind: { kind, summary: '撤退。' } })

describe('白箱：snapshot.take（變更）', () => {
  it('直接問變更的登錄表：不給位置（不是從 applyAll 來）時不檢查第一筆；給了才檢查；位置只看 index', () => {
    const k = makeStateKernel()
    const def = k.changes.get('snapshot.take')!
    const state = makeState()
    const c = take('entry')
    expect(def.validate(state, c)).toEqual([])
    expect(def.validate(state, c, { index: 0, count: 3 })).toEqual([])
    expect(def.validate(state, c, { index: 2, count: 3 }).join()).toMatch(/第一筆變更/)
    expect(def.describe!(c, state)).toBeNull()
  })

  it('同一份報告裡 report.before 掛鉤加的變更接在最後面，不會把 snapshot.take 擠出第一筆', () => {
    const adder: Feature = { id: 'adder', install: (k) => k.hooks.on('report.before', 'adder', () => [{ op: 'flag', key: 'hooked', value: true }]) }
    const { game } = makeGame({ features: [adder] })
    game.commit(draft([take('entry')]))
    expect(game.state.snapshots).toHaveLength(1)
    expect(game.state.flags.hooked).toBe(true)
    // 快照存的是這份報告套用之前的狀態：掛鉤加的變更也還沒套上
    const inside = unpackSave(game.state.snapshots[0]!.raw)
    if (!inside.ok) throw new Error(inside.error)
    expect(inside.file.state.flags.hooked).toBeUndefined()
  })

  it('probe：存快照的報告探針看到的前後狀態對得上（commitViolations），試套用的那一次不留痕跡', async () => {
    const { game } = makeGame()
    const { violations, events } = await observed(game, () => game.commit(draft([take('entry'), { op: 'time', minutes: 10 }])))
    expect(violations).toEqual([])
    expect(events.filter((e) => e.type === 'report.after')).toHaveLength(1)
    expect(game.state.snapshots).toHaveLength(1)
    expect(game.state.seq.uid).toBe(1)
  })

  it('套用失敗（後面的變更不合法）時整份不留：快照與流水號都不變', () => {
    const { game } = makeGame()
    const h = stateHash(game.state)
    expect(() => game.commit(draft([take('entry'), { op: 'cash', delta: -1 }]))).toThrow(ChangeError)
    expect(stateHash(game.state)).toBe(h)
    expect(game.state.snapshots).toEqual([])
    expect(game.state.seq.uid).toBe(0)
  })

  it('直接用核心的 commitReport 存快照：序列化函式拿到的狀態 snapshots 是空的（快照裡不再包快照）', () => {
    const k = makeStateKernel()
    const seen: number[] = []
    const real = k.serialize!
    k.serialize = (s) => { seen.push(s.snapshots.length); return real(s) }
    const state = makeState()
    commitReport(k, state, draft([take('a')]))
    commitReport(k, state, draft([take('b')]))
    expect(state.snapshots).toHaveLength(2)
    // 試套用與真的套用各呼叫一次；每一次傳進去的 snapshots 都是空的
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.every((n) => n === 0)).toBe(true)
    // 傳進去的是淺拷貝：序列化函式不會動到真的狀態
    expect(state.snapshots.map((s) => s.kind)).toEqual(['a', 'b'])
  })
})

describe('白箱：報告帶 rewind 回不去的各種原因（整步不成立，丟 ActionBlocked）', () => {
  it('快照的文字壞了：回傳存檔讀不進來的原因；狀態與回退步數不變', () => {
    const { game } = makeGame()
    game.commit(draft([{ op: 'snapshot.add', slot: { id: 's1', kind: 'entry', label: '壞的', raw: '{不是存檔' } }]))
    const h = stateHash(game.state)
    const steps = game.undo.size
    expect(() => game.commit(retreat())).toThrow(ActionBlocked)
    try { game.commit(retreat()) } catch (e) { expect((e as ActionBlocked).reason).toMatch(/這不是存檔/) }
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(steps)
  })

  it('快照不是這一局更早的狀態（別的局的存檔混進來）：回傳原因', () => {
    const other = makeGame({ seed: 99 }).game
    other.commit(draft([take('entry')]))
    other.commit(draft([{ op: 'flag', key: 'x', value: 1 }], 'wb.later'))
    other.commit(draft([{ op: 'flag', key: 'y', value: 1 }], 'wb.later2'))
    const { game } = makeGame()
    game.commit(draft([{ op: 'snapshot.add', slot: { id: 's1', kind: 'entry', label: '別局的', raw: other.save() } }]))
    // 別局存檔的紀錄比這一局多：不是更早的狀態
    expect(() => game.commit(retreat())).toThrow(/不是這一局更早的狀態/)
  })

  it('rewind.keep 回傳的變更不合法：沒有辦法回到那一刻，整步不成立（連這份報告也不留）', () => {
    const keeper: Feature = { id: 'keeper', install: (k) => k.hooks.on('rewind.keep', 'keeper', () => [{ op: 'cash', delta: -999_999 }]) }
    const { game } = makeGame({ features: [keeper] })
    game.commit(draft([take('entry')]))
    const h = stateHash(game.state)
    const steps = game.undo.size
    expect(() => game.commit(retreat())).toThrow(/沒有辦法回到那一刻.*現金不夠/)
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(steps)
  })

  it('開新局的開局報告帶 rewind（那時沒有任何快照）：開不成，原本那一局不動', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    const h = stateHash(game.state)
    expect(() => game.newGame({ seed: 5, setup: () => retreat('wb.start') })).toThrow(ActionBlocked)
    expect(stateHash(game.state)).toBe(h)
  })
})

describe('白箱：Game.launch 與走地圖碰到帶 rewind 的報告', () => {
  /** 一個活動，開始的報告就帶 rewind（撤退式的活動：開了就退回去）。 */
  const BOUNCE: ActivityDef = {
    kind: 'bounce', owner: 'bounce', order: 20, active: () => null, allow: [], reason: () => '',
    start: (_k, state) => [{ ...draft([{ op: 'flag', key: 'bounced', value: true }], 'bounce.start'), location: clone(state.location), rewind: { kind: 'entry', summary: '被彈回來了。' } }],
  }
  const bounce: Feature = { id: 'bounce', install: (k) => k.activity.define(BOUNCE) }

  it('Game.launch 開出來的報告帶 rewind：照樣回到快照；不能回退到這之前；沒有快照時整步不成立', () => {
    const { game } = makeGame({ features: [bounce], scenario: 'withMoney' })
    const none = stateHash(game.state)
    expect(() => game.launch('bounce', {})).toThrow(ActionBlocked)
    expect(stateHash(game.state)).toBe(none)
    expect(game.undo.size).toBe(0)

    game.commit(draft([take('entry'), { op: 'cash', delta: -100 }]))
    const reports = game.launch('bounce', {})
    expect(reports.map((r) => [r.action, r.retracted ?? false])).toEqual([['bounce.start', true], ['rewind', false]])
    expect(game.state.money.cash).toBe(500)
    expect(game.state.flags.bounced).toBeUndefined()
    expect(game.undo.size).toBe(0)
  })

  const STREET: SpecialMapEntry = {
    id: 'map_street', kind: 'street', size: [5, 3],
    sheets: [{
      id: 'street', name: '測試街', size: [5, 3], layout: ['#####', 'E.1.2', '#####'],
      cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '街口' }], spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [4, 1], cover: 'sparse' }],
    }],
  }
  const content = [{ id: 'maps', content: { special_map: [STREET] } }]
  /** 走到 x = 2 那一格，帶出一份撤退的報告（走地圖的 followUps）。 */
  const trap: Feature = {
    id: 'trap',
    install: (k) => k.grid.onEnter('trap', (ctx) => (ctx.at.x === 2 ? { followUps: [retreat('wb.trap')] } : undefined)),
  }

  it('走地圖時 followUps 帶 rewind：走這一步、接著的報告、回到快照是一次提交；人回到快照那一刻的位置（不在地圖上）', () => {
    const { game } = makeGame({ features: [trap], content })
    game.commit(draft([take('entry')]))
    game.enterMap('map_street')
    const steps = game.undo.size
    expect(game.state.maps.at).not.toBeNull()
    const r = game.gridMove([2, 1])
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => [x.action, x.retracted ?? false])).toEqual([['grid.move', true], ['wb.trap', true], ['rewind', false]])
    expect(game.state.maps.at).toBeNull()
    expect(game.state.maps.instances).toEqual({})
    expect(game.undo.size).toBe(0)
    expect(steps).toBeGreaterThan(0)
  })

  it('走地圖時找不到快照：整步不成立，人沒有走過去，回傳 refused 與原因', () => {
    const { game } = makeGame({ features: [trap], content })
    game.enterMap('map_street')
    const h = stateHash(game.state)
    const steps = game.undo.size
    const r = game.gridMove([2, 1])
    expect(r).toEqual({ status: 'refused', reason: '沒有「entry」這種快照，回不去。', reports: [] })
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(steps)
  })
})

describe('白箱：commitNarrated 的邊角', () => {
  it('上一條鏈還在跑時丟錯；沒有 narrated 以外的鏈被它影響（自由行動的鏈照樣在）', async () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY], fake: { byTask: { narrate: [{ hang: true }, { hang: true }] } }, idleTimeoutMs: 20 })
    const running = game.commitNarrated(draft([{ op: 'flag', key: 'a', value: 1 }]), { mode: 'new' })
    await expect(game.commitNarrated(draft([]), { mode: 'new' })).rejects.toThrow('上一條任務鏈還在跑。')
    expect(() => game.commit(draft([]))).toThrow('上一條任務鏈還在跑。')
    const r = await running // 逾時之後停在半路（等玩家）
    expect(r.status).toBe('paused')
    expect(game.chains.get('free_action')).toBeDefined()
    expect(game.chains.get('narrated')).toBeDefined()
  })

  it('草稿原樣套用：草稿自己帶的 narration.results 進寫正文的請求；草稿沒有的 narration 欄位不多出一個空的', async () => {
    const { game, fake } = makeGame({ fake: true })
    const r = await game.commitNarrated(draft([{ op: 'flag', key: 'a', value: 1 }], 'wb.note', { narration: { results: ['拿到了一把鑰匙。'] } }), { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(fake!.requestsFor('narrate')[0]!.messages[0]!.content).toContain('1. 拿到了一把鑰匙。')
    expect(r.reports[0]!.narration).toMatchObject({ results: ['拿到了一把鑰匙。'] })
    const off = makeGame()
    const plain = await off.game.commitNarrated(draft([{ op: 'flag', key: 'a', value: 1 }]), { mode: 'new' })
    expect('narration' in plain.reports[0]!).toBe(false)
  })

  it('開了潤色（settings.polish.narrated）：text 之後多一步 polish，走成人路由的草稿 polish 也帶 adult', async () => {
    const { game, fake } = makeGame({ fake: true, ai: { ai: 1, polish: { narrated: 1 } } })
    const r = await game.commitNarrated(draft([{ op: 'flag', key: 'a', value: 1 }], 'wb.note', { adult: true }), { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(r.run.steps.map((s) => s.id)).toEqual(['text', 'polish', 'apply'])
    expect(fake!.requests.map((q) => [q.task, q.adult])).toEqual([['narrate', true], ['polish', true]])
  })
})
