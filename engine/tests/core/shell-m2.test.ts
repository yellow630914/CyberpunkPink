// 驗收測試：dev/work/M2-core-shell.md（snapshot.take、報告的 rewind、Game.rewindToKind、Game.commitNarrated、crossings、rest.done，
// 以及補充：actionKindToDef）。規格：dev/adr/0016 第二、六節；dev/adr/0011（快照）、0008（回到快照保留紀錄）；SERIES 第 6 節。
// 內容一律用測試自帶的最小假資料；AI 用假的服務商（FakeProvider）。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ActionKindEntry, Change, Feature, GameState, ReportDraft } from '../../src'
import {
  ActionBlocked, ChangeError, DAILY_RULE, DEFAULT_TIME_RULES, FakeProvider, MAX_CROSSINGS, NARRATED_CHAIN, REST_KINDS, actionKindToDef, clone, commitReport,
  countCrossings, createKernel, createStateKernel, crossings, dailyCrossings, fromMinutes, inputOf, restDone, sectionOf, snapshotText, toMinutes, unpackSave, weekdayOf, weeklyCrossings, weeklyRule,
} from '../../src'
import { BATTLE_SETUPS, TEST_ACTIVITY, TEST_COMBAT, TEST_SERIALIZE, makeBattleGame, makeGame, makeKernel, makeState, makeStateKernel, observed, playOut, stateHash, toyEnd, toyOf, toyStep } from '../../src/testkit'

const BUSY = '玩具活動進行中，先把它做完。'
const FIGHTING = '正在戰鬥，先把這一場打完。'
const NO_ENTRY = '沒有「entry」這種快照，回不去。'

const draft = (changes: Change[], action = 'test.note', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: `${action}。` }, ...extra,
})
/** 存快照的變更（一定要放報告的第一筆）。 */
const take = (kind: string, extra: Record<string, unknown> = {}): Change => ({ op: 'snapshot.take', kind, label: `快照 ${kind}`, ...extra })
/** 一筆「像買東西」的結算：花錢與時間，帶一拍經過給寫正文用。 */
const spend = (extra: Partial<ReportDraft> = {}): ReportDraft => draft([{ op: 'cash', delta: -50 }, { op: 'time', minutes: 30 }], 'trade.checkout', { kind: 'deal', timeline: [{ layer: 'meat', text: '你付了錢。' }], ...extra })
const T = (day: number, hour = 0, minute = 0) => ({ day, hour, minute })

type G = ReturnType<typeof makeGame>['game']
/** 去掉會因為「有沒有走鏈」而不同的欄位：正文、鏈的記號與鏈的那一筆變更。 */
const bare = (r: GameState['reports'][number]) => {
  const { narration: _n, chain: _c, ...rest } = r
  return { ...rest, changes: rest.changes.filter((c) => c.op !== 'chain') }
}
const actionsOf = (g: G) => g.state.reports.map((r) => [r.action, r.retracted ?? false])

describe('snapshot.take：存的是這份報告套用之前的狀態（dev/adr/0016 第二節）', () => {
  it('一份報告先存快照再改錢：回到那份快照，錢是改之前的；快照的文字裡錢也是改之前的、不再包快照', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    const before = clone(game.state)
    game.commit(draft([take('entry', { label: '入口' }), { op: 'cash', delta: -200 }, { op: 'time', minutes: 60 }], 'dungeon.enter'))
    expect(game.state.money).toEqual({ cred: 1000, cash: 300 })
    expect(game.state.snapshots).toHaveLength(1)
    const slot = game.state.snapshots[0]!
    expect(slot).toMatchObject({ id: 's1', kind: 'entry', label: '入口' })
    expect(slot.owner).toBeUndefined()
    const inside = unpackSave(slot.raw)
    if (!inside.ok) throw new Error(inside.error)
    expect(inside.file.state.money).toEqual(before.money)
    expect(inside.file.state.time).toEqual(before.time)
    expect(inside.file.state.reports).toHaveLength(before.reports.length)
    expect(inside.file.state.snapshots).toEqual([])

    // 第二份快照存的時候第一份已經在狀態裡：第二份的文字裡仍然沒有快照
    game.commit(draft([take('stage'), { op: 'cash', delta: -100 }], 'dungeon.stage'))
    const second = unpackSave(game.state.snapshots[1]!.raw)
    if (!second.ok) throw new Error(second.error)
    expect(second.file.state.snapshots).toEqual([])
    expect(second.file.state.money.cash).toBe(300)
    expect(second.file.state.reports).toHaveLength(before.reports.length + 1)

    expect(game.rewindToKind('entry', '你回到了入口。')).toBeNull()
    expect(game.state.money).toEqual(before.money)
    expect(game.state.time).toEqual(before.time)
  })

  it('它不是報告的第一筆變更：擋下，訊息寫明要放第一筆；整份不套、狀態與能回退的步數都不變', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    game.commit(draft([{ op: 'flag', key: 'x', value: true }]))
    const h = stateHash(game.state)
    const steps = game.undo.size
    for (const changes of [[{ op: 'cash', delta: -1 }, take('entry')], [{ op: 'flag', key: 'y', value: 1 }, take('entry', { replace: true })]] as Change[][]) {
      expect(() => game.commit(draft(changes))).toThrow(ChangeError)
      expect(() => game.commit(draft(changes))).toThrow(/要放在報告的第一筆變更/)
    }
    // 一份報告裡的第二個 snapshot.take 也不行（只有第一筆能是）
    expect(() => game.commit(draft([take('entry'), take('stage')]))).toThrow(/changes\[1\].*第一筆/)
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(steps)
  })

  it('k.serialize 沒有注入：擋下，訊息寫出是哪個欄位；注入（makeKernel／makeStateKernel／TEST_SERIALIZE）之後存得進去、讀得回來', () => {
    for (const k of [createStateKernel(), createKernel()]) {
      const state = makeState()
      expect(() => commitReport(k, state, draft([take('entry')]))).toThrow(/沒有注入存快照的序列化函式（k\.serialize）/)
      expect(state.snapshots).toEqual([])
      expect(state.reports).toEqual([])
    }
    for (const k of [makeStateKernel(), makeKernel()]) {
      const state = makeState({ patch: { money: { cred: 0, cash: 40 } } })
      commitReport(k, state, draft([take('entry'), { op: 'cash', delta: -15 }]))
      expect(state.snapshots).toHaveLength(1)
      const back = unpackSave(state.snapshots[0]!.raw)
      if (!back.ok) throw new Error(back.error)
      expect(back.file.state.money.cash).toBe(40)
    }
    expect(unpackSave(TEST_SERIALIZE(makeState())).ok).toBe(true)
    // Game 自己注入的就是外殼的 snapshotText；序列化函式回傳不是文字時整份不套
    expect(makeGame().game.k.serialize).toBe(snapshotText)
    const bad = makeStateKernel()
    bad.serialize = () => ''
    const s = makeState()
    expect(() => commitReport(bad, s, draft([take('entry')]))).toThrow(/k\.serialize 要回傳存檔的文字/)
    expect(s.reports).toEqual([])
  })

  it('記進紀錄時不留文字與 data：只有 kind、label、owner、replace；快照本身（文字、id、data）在 state.snapshots', () => {
    const { game } = makeGame()
    game.commit(draft([take('stage', { owner: 'cm_1', replace: true, data: { stage: 2 } })], 'dungeon.stage'))
    const logged = game.state.reports.at(-1)!.changes
    expect(logged).toEqual([{ op: 'snapshot.take', kind: 'stage', label: '快照 stage', owner: 'cm_1', replace: true }])
    expect(JSON.stringify(game.state.reports)).not.toContain('cyberpunkpink-engine-save')
    expect(game.state.snapshots[0]).toMatchObject({ id: 's1', kind: 'stage', owner: 'cm_1', data: { stage: 2 } })
    // 沒寫 owner、replace、data 的就什麼都不多
    game.commit(draft([take('entry')]))
    expect(game.state.reports.at(-1)!.changes).toEqual([{ op: 'snapshot.take', kind: 'entry', label: '快照 entry' }])
    expect(game.state.snapshots[1]!.data).toBeUndefined()
    // 傳進去的 data 是複製的：之後改原物件不影響存著的
    const data = { n: 1 }
    game.commit(draft([take('x', { data })]))
    data.n = 99
    expect(game.state.snapshots[2]!.data).toEqual({ n: 1 })
  })

  it('replace 的第二份把第一份換掉；沒寫 replace 的兩份都在；不同 owner 互不影響；不同種類互不影響', () => {
    const { game } = makeGame()
    const ids = () => game.state.snapshots.map((s) => `${s.kind}/${s.owner ?? '-'}/${s.id}`)
    game.commit(draft([take('stage', { owner: 'a', replace: true })]))
    game.commit(draft([take('stage', { owner: 'a', replace: true })]))
    expect(ids()).toEqual(['stage/a/s2'])
    // 新的那一份存的是更晚的狀態：文字裡的紀錄比舊的多一份
    const raw = (i: number) => (unpackSave(game.state.snapshots[i]!.raw) as { ok: true; file: { state: GameState } }).file.state
    expect(raw(0).reports).toHaveLength(2)
    // 沒寫 replace：兩份都在
    game.commit(draft([take('stage', { owner: 'a' })]))
    expect(ids()).toEqual(['stage/a/s2', 'stage/a/s3'])
    // 不同 owner：換自己的，不動別人的
    game.commit(draft([take('stage', { owner: 'b', replace: true })]))
    expect(ids()).toEqual(['stage/a/s2', 'stage/a/s3', 'stage/b/s4'])
    game.commit(draft([take('stage', { owner: 'b', replace: true })]))
    expect(ids()).toEqual(['stage/a/s2', 'stage/a/s3', 'stage/b/s5'])
    // 同一個 owner 的 replace 把這個 owner 這一種的舊快照都拿掉（含沒寫 replace 存的兩份）
    game.commit(draft([take('stage', { owner: 'a', replace: true })]))
    expect(ids()).toEqual(['stage/b/s5', 'stage/a/s6'])
    // 不同種類：同一個 owner 也不動
    game.commit(draft([take('entry', { owner: 'a', replace: true })]))
    expect(ids()).toEqual(['stage/b/s5', 'stage/a/s6', 'entry/a/s7'])
    // 沒寫 owner 的算同一個「沒有 owner」：只換沒有 owner 的同一種，有 owner 的不動
    game.commit(draft([take('stage', { replace: true })]))
    game.commit(draft([take('stage', { replace: true })]))
    expect(ids()).toEqual(['stage/b/s5', 'stage/a/s6', 'entry/a/s7', 'stage/-/s9'])
  })

  it('id 用 s<流水號> 並把流水號用掉（戰鬥開打前的快照同一套）：每一份不重複，已經有人用的號碼跳過', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.commit(draft([take('entry')]))
    expect([game.state.snapshots[0]!.id, game.state.seq.uid]).toEqual(['s1', 1])
    // 別處已經用了 s2（snapshot.add 自己給 id）：take 跳過它
    game.commit(draft([{ op: 'snapshot.add', slot: { id: 's2', kind: 'old', label: '舊的', raw: 'x' } }]))
    game.commit(draft([take('stage')]))
    expect(game.state.snapshots.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(game.state.seq.uid).toBe(3)
    // 接著開戰：開打前的快照用 s<流水號 + 1>，不會撞上
    game.startBattle(BATTLE_SETUPS.encounter())
    expect(game.state.snapshots.map((s) => `${s.kind}/${s.id}`)).toEqual(['entry/s1', 'old/s2', 'stage/s3', 'battle/s4'])
    expect(new Set(game.state.snapshots.map((s) => s.id)).size).toBe(4)
  })

  it('欄位的格式：kind、label、owner、data、replace 不對的都擋下，狀態不變', () => {
    const { game } = makeGame()
    const h = stateHash(game.state)
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ kind: 'Bad Kind' }, /kind 的格式不對/], [{ kind: 5 }, /kind 的格式不對/], [{ label: 3 }, /label 要是字串/], [{ owner: '' }, /owner 要是非空的字串/],
      [{ owner: 5 }, /owner 要是非空的字串/], [{ data: [1] }, /data 要是一個物件/], [{ data: 'x' }, /data 要是一個物件/], [{ replace: 'yes' }, /replace 要是布林值/],
    ]
    for (const [patch, message] of bad) {
      const c = { op: 'snapshot.take', kind: 'entry', label: 'x', ...patch } as Change
      expect(() => game.commit(draft([c])), JSON.stringify(patch)).toThrow(message)
    }
    expect(stateHash(game.state)).toBe(h)
  })

  it('不變式第 2 條：存快照的報告 changes 套用之後等於實際的狀態（commitViolations 沒有違規），讀檔再存檔一模一樣', async () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    const { violations } = await observed(game, () => {
      game.commit(draft([take('entry', { owner: 'cm_1' }), { op: 'cash', delta: -20 }]))
      game.commit(draft([take('stage', { owner: 'cm_1', replace: true }), { op: 'time', minutes: 120 }]))
      return game.rewindToKind('stage', '回到階段。')
    })
    expect(violations).toEqual([])
    const after = clone(game.state)
    expect(game.load(game.save())).toBeNull()
    expect(game.state).toEqual(after)
  })
})

describe('存檔往返：快照帶著 owner（dev/adr/0016 第二節）', () => {
  it('帶著 owner 的快照存了再讀還在；owner 不是字串的存檔整筆不讀', () => {
    const { game } = makeGame()
    game.commit(draft([take('stage', { owner: 'cm_7', data: { stage: 3 } }), { op: 'flag', key: 'k', value: 1 }]))
    const text = game.save()
    const fresh = makeGame().game
    expect(fresh.load(text)).toBeNull()
    expect(fresh.state.snapshots).toHaveLength(1)
    expect(fresh.state.snapshots[0]).toMatchObject({ kind: 'stage', owner: 'cm_7', data: { stage: 3 } })
    expect(fresh.state).toEqual(game.state)
    // 讀回來的快照還能用
    expect(fresh.rewindToKind('stage', '回到階段。')).toBeNull()

    const broken = JSON.parse(text) as { state: GameState }
    ;(broken.state.snapshots[0] as unknown as { owner: unknown }).owner = 5
    expect(makeGame().game.load(JSON.stringify(broken))).toMatch(/存檔壞了.*owner/)
  })
})

describe('報告的 rewind：提交完回到最近一份那個種類的快照（dev/adr/0016 第二節）', () => {
  /** 進副本：存入口的快照、做幾件事，回傳存快照那一刻（報告之前）的狀態。 */
  const enter = (game: G) => {
    const atEntry = clone(game.state)
    game.commit(draft([take('entry', { label: '副本入口' }), { op: 'flag', key: 'in_dungeon', value: true }], 'dungeon.enter'))
    game.commit(draft([{ op: 'cash', delta: -100 }, { op: 'time', minutes: 120 }, { op: 'flag', key: 'stage', value: 2 }], 'dungeon.stage'))
    return atEntry
  }

  it('報告帶 rewind：提交之後狀態回到那一刻；這份報告與之後的紀錄還在、標成被收回；多一筆 summary 的 system 報告；不能回退到這之前', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    const atEntry = enter(game)
    const seen: string[][] = []
    game.subscribe((_s, reports) => seen.push(reports.map((r) => r.action ?? '')))
    const retreat = draft([{ op: 'cash', delta: -50 }], 'dungeon.retreat', { rewind: { kind: 'entry', summary: '你撤退了。這一段經歷被收回了。' } })

    const reports = game.commit(retreat)

    const s = game.state
    expect(s.money).toEqual(atEntry.money)
    expect(s.time).toEqual(atEntry.time)
    expect(s.flags).toEqual(atEntry.flags)
    expect(s.rng).toEqual(atEntry.rng)
    // 紀錄：快照之前的照舊；存快照的那份、之後的、帶 rewind 的這份都留著、標成被收回；最後多一筆交代這件事
    expect(actionsOf(game)).toEqual([['game.new', false], ['dungeon.enter', true], ['dungeon.stage', true], ['dungeon.retreat', true], ['rewind', false]])
    expect(s.reports[3]).toMatchObject({ action: 'dungeon.retreat', retracted: true, rewind: { kind: 'entry', summary: '你撤退了。這一段經歷被收回了。' } })
    expect(s.reports[3]!.changes).toEqual([{ op: 'cash', delta: -50 }])
    expect(s.reports.at(-1)).toMatchObject({ kind: 'system', outcome: { result: 'rewound', summary: '你撤退了。這一段經歷被收回了。' }, time: { start: atEntry.time, end: atEntry.time } })
    expect(new Set(s.reports.map((r) => r.id)).size).toBe(s.reports.length)
    expect(s.seq.report).toBe(s.reports.length)
    // 入口那一份連同更晚的快照都丟了；不能回退到這之前；通知的報告是這一步的（被收回的在前、交代的在後）
    expect(s.snapshots).toEqual([])
    expect(game.undo.size).toBe(0)
    expect(game.lastRun).toBeNull()
    expect(reports.map((r) => [r.action, r.retracted ?? false])).toEqual([['dungeon.retreat', true], ['rewind', false]])
    expect(seen).toEqual([['dungeon.retreat', 'rewind']])
    // 存檔再讀檔一模一樣；之後照常做事，紀錄編號不重複
    const after = clone(s)
    expect(game.load(game.save())).toBeNull()
    expect(game.state).toEqual(after)
    game.commit(draft([{ op: 'cash', delta: -1 }], 'after'))
    expect(new Set(game.state.reports.map((r) => r.id)).size).toBe(game.state.reports.length)
  })

  it('rewind.keep 回傳的變更套在回去之後的狀態上；掛點看到的 current 是回去之前（含這份報告）、restored 是快照那一刻', () => {
    const log: Array<{ last: string | undefined; restored: number }> = []
    const memory: Feature = {
      id: 'memory',
      install: (k) => k.hooks.on('rewind.keep', 'memory', ({ current, restored }) => {
        log.push({ last: current.reports.at(-1)?.action, restored: restored.reports.length })
        return current.ext.memory !== undefined ? [{ op: 'ext', key: 'memory', value: current.ext.memory }] : undefined
      }),
    }
    const { game } = makeGame({ features: [memory], scenario: 'withMoney' })
    enter(game)
    game.commit(draft([{ op: 'ext', key: 'memory', value: ['那一晚的事'] }, { op: 'ext', key: 'progress', value: { stage: 3 } }], 'dungeon.event'))
    game.commit(draft([], 'dungeon.retreat', { rewind: { kind: 'entry', summary: '撤退。' } }))
    expect(game.state.ext).toEqual({ memory: ['那一晚的事'] })
    expect(game.state.reports.at(-1)!.changes).toEqual([{ op: 'ext', key: 'memory', value: ['那一晚的事'] }])
    expect(log).toEqual([{ last: 'dungeon.retreat', restored: 1 }])
  })

  it('找不到那種快照：整步不成立（狀態、能回退的步數都不變、這份報告也不留），丟 ActionBlocked 並寫出原因', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    game.commit(draft([take('stage')], 'dungeon.stage')) // 有快照，但不是 entry
    const h = stateHash(game.state)
    const steps = game.undo.size
    const retreat = draft([{ op: 'cash', delta: -50 }], 'dungeon.retreat', { rewind: { kind: 'entry', summary: '撤退。' } })
    expect(() => game.commit(retreat)).toThrow(ActionBlocked)
    try { game.commit(retreat) } catch (e) { expect((e as ActionBlocked).reason).toBe(NO_ENTRY) }
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(steps)
    expect(game.state.money.cash).toBe(500)
    // 直接呼叫的也一樣：回傳原因，狀態不變
    expect(game.rewindToKind('entry', '撤退。')).toBe(NO_ENTRY)
    expect(stateHash(game.state)).toBe(h)
  })

  it('同一份報告不能同時帶 launch 與 rewind（launch 之後不會再有 rewind）；rewind 的格式不對也擋下；狀態不變', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    game.commit(draft([take('entry')]))
    const h = stateHash(game.state)
    const both = draft([], 'dungeon.retreat', { launch: [{ kind: 'toy', setup: {} }], rewind: { kind: 'entry', summary: '撤退。' } })
    expect(() => game.commit(both)).toThrow(ChangeError)
    expect(() => game.commit(both)).toThrow(/不能同時帶 launch 與 rewind/)
    for (const rewind of [{ kind: 'entry' }, { summary: 'x' }, { kind: '', summary: 'x' }, { kind: 'entry', summary: 3 }, 'entry']) {
      expect(() => game.commit(draft([], 'x', { rewind: rewind as never })), JSON.stringify(rewind)).toThrow(/rewind 要有 kind.*summary/)
    }
    // launch 是空陣列不算「寫了 launch」
    expect(() => game.commit(draft([], 'dungeon.retreat', { launch: [], rewind: { kind: 'entry', summary: '撤退。' } }))).not.toThrow()
    expect(stateHash(game.state)).not.toBe(h)
  })

  it('一步裡有兩份報告都帶 rewind：整步不成立（一步只能回到一份快照）', () => {
    const second: Feature = {
      id: 'second',
      install: (k) => k.hooks.on('turn.end', 'second', ({ report }) => (report.action === 'dungeon.retreat' ? [draft([], 'dungeon.retreat2', { rewind: { kind: 'entry', summary: '又一次。' } })] : undefined)),
    }
    const { game } = makeGame({ features: [second] })
    game.commit(draft([take('entry')]))
    const h = stateHash(game.state)
    expect(() => game.commit(draft([], 'dungeon.retreat', { rewind: { kind: 'entry', summary: '撤退。' } }))).toThrow(/2 份報告都帶 rewind.*一步只能回到一份快照/)
    expect(stateHash(game.state)).toBe(h)
  })

  it('rewindToKind：回到最近一份這個種類的快照，比它晚的快照一起丟、比它早的留著；找不到回傳原因', () => {
    const { game } = makeGame()
    game.commit(draft([take('entry')], 'a')) // s1
    game.commit(draft([take('stage', { owner: 'x' })], 'b')) // s2
    game.commit(draft([take('camp')], 'c1')) // s3
    game.commit(draft([take('stage', { owner: 'y' })], 'c')) // s4
    game.commit(draft([take('camp')], 'd')) // s5
    expect(game.state.snapshots.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(game.rewindToKind('stage', '回到最近的階段。')).toBeNull()
    // 最近的 stage 是 s4（owner y）：s4 與 s5 一起丟，其餘留著
    expect(game.state.snapshots.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(actionsOf(game)).toEqual([['game.new', false], ['a', false], ['b', false], ['c1', false], ['c', true], ['d', true], ['rewind', false]])
    expect(game.state.reports.at(-1)!.outcome.summary).toBe('回到最近的階段。')
    expect(game.rewindToKind('stage', '再往前。')).toBeNull()
    expect(game.state.snapshots.map((s) => s.id)).toEqual(['s1'])
    expect(game.rewindToKind('stage', '沒有了。')).toBe('沒有「stage」這種快照，回不去。')
    expect(game.rewindToKind('entry', '回到入口。')).toBeNull()
    expect(game.state.snapshots).toEqual([])
    // 回到更早的時間點之後，更晚的紀錄都在，只是被收回
    expect(game.state.reports.filter((r) => r.retracted).map((r) => r.action)).toEqual(['a', 'b', 'c1', 'c', 'd', 'rewind', 'rewind'])
    expect(game.state.reports.at(-1)).toMatchObject({ action: 'rewind', outcome: { summary: '回到入口。' } })
  })

  it('直接呼叫 rewindToKind 先問 blockOf(rewind:<種類>)：活動進行中被擋下回傳它的原因；活動放行了才回得去', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    game.commit(draft([take('entry')]))
    game.launch('toy', {})
    expect(game.rewindToKind('entry', '撤退。')).toBe(BUSY)
    expect(toyOf(game.state)).not.toBeNull()
    game.k.activity.allow('toy', 'rewind:', 'test')
    expect(game.rewindToKind('entry', '撤退。')).toBeNull()
    expect(toyOf(game.state)).toBeNull()
  })

  it('撤退：活動進行中提交一份帶 rewind 的報告（放行問的是 commit:<action>），回到進活動之前；活動跟著回去', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney' })
    game.commit(draft([take('entry'), { op: 'cash', delta: -10 }], 'toy.setup'))
    game.launch('toy', {})
    game.commit(toyStep(game.state))
    expect(game.blockOf('commit:test.other')).toBe(BUSY)
    game.commit(draft([], 'toy.retreat', { rewind: { kind: 'entry', summary: '你退出來了。' } }))
    expect(toyOf(game.state)).toBeNull()
    expect(game.state.money.cash).toBe(500)
    expect(actionsOf(game).map(([a]) => a)).toEqual(['game.new', 'toy.setup', 'toy.start', 'toy.step', 'toy.retreat', 'rewind'])
    expect(game.state.reports.filter((r) => r.retracted).map((r) => r.action)).toEqual(['toy.setup', 'toy.start', 'toy.step', 'toy.retreat'])
    expect(game.blockOf('commit:test.other')).toBeNull()
  })

  it('委託失敗：打輸之後「接受結果」的報告（丟掉開打前的快照）同時帶 rewind，回到入口：戰鬥、等著選的戰敗、快照都沒了', async () => {
    const { game } = makeGame({ features: [TEST_COMBAT], scenario: 'withMoney' })
    game.commit(draft([take('entry'), { op: 'cash', delta: -100 }], 'dungeon.enter'))
    game.startBattle(BATTLE_SETUPS.hopeless())
    expect(playOut(game).outcome).toBe('lose')
    await game.finishBattle()
    expect(game.pendingDefeat).not.toBeNull()
    // 沒有丟快照的報告被擋；有的過
    expect(() => game.commit(draft([], 'dungeon.fail', { rewind: { kind: 'entry', summary: '委託失敗了。' } }))).toThrow(ActionBlocked)
    game.commit(draft([{ op: 'snapshot.drop', kind: 'battle' }], 'defeat.accept', { rewind: { kind: 'entry', summary: '委託失敗了。' } }))
    expect(game.pendingDefeat).toBeNull()
    expect(game.state.battle).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.state.money.cash).toBe(500)
    expect(game.state.reports.at(-1)).toMatchObject({ action: 'rewind', outcome: { summary: '委託失敗了。' } })
  })

  it('不變式第 2 條：帶 rewind 的提交，每一份報告的 changes 套用之後都等於實際的狀態', async () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    enter(game)
    const { violations } = await observed(game, () => game.commit(draft([{ op: 'cash', delta: -5 }], 'dungeon.retreat', { rewind: { kind: 'entry', summary: '撤退。' } })))
    expect(violations).toEqual([])
  })
})

describe('Game.commitNarrated：結算之後寫正文（通用的鏈 narrated；dev/adr/0016 第二節）', () => {
  const withAi = (features: Feature[] = [TEST_ACTIVITY], o: Parameters<typeof makeGame>[0] = {}) => makeGame({ features, scenario: 'withMoney', fake: true, ...o })

  it('假的服務商開著：報告有正文；請求帶寫正文的模式、報告的摘要；套用的是同一份草稿', async () => {
    const { game, fake } = withAi()
    const r = await game.commitNarrated(spend(), { mode: 'continue' })
    expect(r.status).toBe('applied')
    expect(r.run.template.chain).toBe(NARRATED_CHAIN)
    expect(r.reports).toHaveLength(1)
    expect(r.reports[0]!.narration?.text).toContain('假的服務商')
    expect(game.state.reports.at(-1)!.narration?.text).toBe(r.reports[0]!.narration!.text)
    expect(game.state.money.cash).toBe(450)
    expect(game.state.time).toEqual({ day: 1, hour: 8, minute: 30 })
    const req = fake!.requestsFor('narrate')
    expect(req).toHaveLength(1)
    expect(sectionOf(req[0]!, 'mode')).toBe('continue')
    expect(inputOf<{ report: { action: string; kind: string; timeline: string[]; summary: string } }>(req[0]!).report).toMatchObject({ action: 'trade.checkout', kind: 'deal', timeline: ['你付了錢。'], summary: 'trade.checkout。' })
    expect(fake!.requests.map((x) => x.task)).toEqual(['narrate'])
  })

  it('AI 關著、或設定關掉寫正文時：沒有正文也不問服務商，其餘完全一樣；和 commit 的結果一樣（同一份草稿、同一組變更）', async () => {
    const on = withAi()
    const off = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney' })
    const quiet = withAi([TEST_ACTIVITY], { ai: { ai: 1, narrate: 0 } })
    const plain = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney' })
    const results = [await on.game.commitNarrated(spend(), { mode: 'new' }), await off.game.commitNarrated(spend(), { mode: 'new' }), await quiet.game.commitNarrated(spend(), { mode: 'new' })]
    plain.game.commit(spend())
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied'])
    expect(results.map((r) => r.reports[0]!.narration?.text !== undefined)).toEqual([true, false, false])
    expect(quiet.fake!.requests).toHaveLength(0)
    // 報告：除了正文與鏈的記號，三份一模一樣，也和 commit 的一樣
    const logged = [on.game, off.game, quiet.game].map((g) => bare(g.state.reports.at(-1)!))
    expect(logged[1]).toEqual(logged[0])
    expect(logged[2]).toEqual(logged[0])
    expect(logged[1]).toEqual(bare(plain.game.state.reports.at(-1)!))
    // 狀態：錢、時間、旗標、紀錄的條數一樣
    for (const g of [on.game, off.game, quiet.game]) {
      expect([g.state.money, g.state.time, g.state.flags, g.state.reports.length]).toEqual([plain.game.state.money, plain.game.state.time, plain.game.state.flags, plain.game.state.reports.length])
    }
  })

  it('草稿帶 adult：寫正文的請求走成人路由（請求的 adult 記號）；沒有 adult 的不走；其餘規則不因它而不同', async () => {
    const { game, fake } = withAi()
    await game.commitNarrated(spend({ adult: true }), { mode: 'new' })
    await game.commitNarrated(spend(), { mode: 'new' })
    const req = fake!.requestsFor('narrate')
    expect(req.map((r) => r.adult)).toEqual([true, undefined])
    expect(inputOf<{ report: { adult?: boolean } }>(req[0]!).report.adult).toBe(true)
    // 報告本身照樣帶 adult（紀錄裡看得到）、錢照樣扣
    expect(game.state.reports.at(-2)!.adult).toBe(true)
    expect(game.state.money.cash).toBe(400)
  })

  it('戰鬥中被擋下：回傳 refused 與原因（和 commit 同一句），狀態不變、不留回退、不問服務商', async () => {
    const { game, fake } = makeBattleGame({ scenario: 'withMoney', fake: true })
    const h = stateHash(game.state)
    const steps = game.undo.size
    const r = await game.commitNarrated(spend(), { mode: 'new' })
    expect(r).toMatchObject({ status: 'refused', reason: FIGHTING, reports: [] })
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(steps)
    expect(game.lastRun).toBeNull()
    expect(fake!.requests).toHaveLength(0)
    expect(() => game.commit(spend())).toThrow(ActionBlocked)
  })

  it('放行問的是 commit:<草稿的 action>：活動進行中放行 toy. 的草稿過、別的被擋', async () => {
    const { game } = withAi()
    game.launch('toy', {})
    expect(await game.commitNarrated(spend(), { mode: 'new' })).toMatchObject({ status: 'refused', reason: BUSY })
    const r = await game.commitNarrated(toyStep(game.state), { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(toyOf(game.state)!.steps).toBe(1)
    const end = await game.commitNarrated(toyEnd(game.k, game.state), { mode: 'new' })
    expect(end.status).toBe('applied')
    expect(toyOf(game.state)).toBeNull()
  })

  it('留一步回退（label 是名字）；attach 併進最新一樓、不另留；回退一步就回到做這件事之前', async () => {
    const { game } = withAi()
    expect(game.undo.size).toBe(0)
    await game.commitNarrated(spend(), { mode: 'new', label: '買東西' })
    expect(game.undo.size).toBe(1)
    expect(game.undo.labels()).toEqual(['買東西'])
    await game.commitNarrated(spend(), { mode: 'new', attach: true })
    expect(game.undo.size).toBe(1)
    expect(game.state.money.cash).toBe(400)
    // 沒給 label 用報告的摘要
    await game.commitNarrated(spend(), { mode: 'new' })
    expect(game.undo.labels().at(-1)).toBe('trade.checkout。')
    expect(game.undoSteps(1)).toBe(true)
    expect(game.state.money.cash).toBe(400)
    expect(game.undoSteps(1)).toBe(true)
    expect(game.state.money.cash).toBe(500)
  })

  it('重試、用規則代替照現有的鏈：停在半路時狀態還沒改；用規則代替之後套用、沒有正文', async () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney', fake: { byTask: { narrate: [{ refusal: true }] } } })
    const h = stateHash(game.state)
    const paused = await game.commitNarrated(spend(), { mode: 'new' })
    expect(paused.status).toBe('paused')
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(1)
    expect(game.stepActions('text')).toEqual({ retry: null, useRules: null, reroll: '這一步不是擲骰，不能重擲。' })
    const applied = await game.useRules('text')
    expect(applied.status).toBe('applied')
    expect(applied.reports[0]!.narration).toBeUndefined()
    expect(game.state.money.cash).toBe(450)
    expect(game.undo.size).toBe(1)

    // 重試：第二次服務商給得出正文
    const again = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney', fake: { byTask: { narrate: [{ refusal: true }] } } })
    expect((await again.game.commitNarrated(spend(), { mode: 'new' })).status).toBe('paused')
    const retried = await again.game.retryStep('text')
    expect(retried.status).toBe('applied')
    expect(retried.reports[0]!.narration?.text).toContain('假的服務商')
  })

  it('已經套用的最新一樓可以重試（回到套用之前再跑一次）；之後做了別的事就只能回退', async () => {
    const { game, fake } = withAi()
    await game.commitNarrated(spend(), { mode: 'new' })
    const money = clone(game.state.money)
    const count = game.state.reports.length
    expect(game.stepActions('text').retry).toBeNull()
    const r = await game.retryStep('text')
    expect(r.status).toBe('applied')
    expect(game.state.money).toEqual(money)
    expect(game.state.reports).toHaveLength(count)
    expect(fake!.requestsFor('narrate')).toHaveLength(2)
    game.commit(draft([{ op: 'cash', delta: -1 }]))
    expect(game.stepActions('text').retry).toMatch(/之後已經做了別的事/)
  })

  it('attach 的鏈停在半路又被別的事丟下：不多拿掉別人的回退步數', async () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney', fake: { byTask: { narrate: [{ refusal: true }] } } })
    game.commit(draft([{ op: 'flag', key: 'a', value: 1 }]))
    expect(game.undo.size).toBe(1)
    const paused = await game.commitNarrated(spend(), { mode: 'new', attach: true })
    expect(paused.status).toBe('paused')
    expect(game.undo.size).toBe(1) // attach：沒有另留
    game.commit(draft([{ op: 'flag', key: 'b', value: 1 }]))
    expect(game.undo.size).toBe(2) // 丟下那條鏈時沒有誤丟前一步的回退
    expect(game.lastRun).toBeNull()
  })

  it('草稿帶 launch：套用之後照常開活動，開出來的報告接在後面；開不成整步不成立（refused）', async () => {
    const { game, fake } = withAi()
    const r = await game.commitNarrated(spend({ launch: [{ kind: 'toy', setup: { goal: 3 }, origin: { by: 'trade', ref: 'q1' } }] }), { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => x.action)).toEqual(['trade.checkout', 'toy.start'])
    expect(toyOf(game.state)).toMatchObject({ goal: 3, origin: { by: 'trade', ref: 'q1' } })
    expect(fake!.requestsFor('narrate')).toHaveLength(1)

    const other = withAi()
    const h = stateHash(other.game.state)
    const refused = await other.game.commitNarrated(spend({ launch: [{ kind: 'toy', setup: { refuse: ['玩具活動現在開不了。'] } }] }), { mode: 'new' })
    expect(refused).toMatchObject({ status: 'refused', reason: '玩具活動現在開不了。', reports: [] })
    expect(stateHash(other.game.state)).toBe(h)
    expect(other.game.undo.size).toBe(0)
  })

  it('草稿帶 rewind：套用之後回到快照（正文留在被收回的那份報告上）；不能回退到這之前，這條鏈不能再重試；找不到快照時 refused、狀態不變', async () => {
    const { game } = withAi()
    game.commit(draft([take('entry')], 'dungeon.enter'))
    const r = await game.commitNarrated(spend({ rewind: { kind: 'entry', summary: '你退出來了。' } }), { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => [x.action, x.retracted ?? false])).toEqual([['trade.checkout', true], ['rewind', false]])
    expect(game.state.money.cash).toBe(500)
    expect(game.state.reports.find((x) => x.action === 'trade.checkout')).toMatchObject({ retracted: true, narration: { text: expect.stringContaining('假的服務商') } })
    expect(game.undo.size).toBe(0)
    expect(game.lastRun).toBeNull()
    expect(game.stepActions('text').retry).toMatch(/沒有可以重試的任務鏈/)

    const h = stateHash(game.state)
    const none = await game.commitNarrated(spend({ rewind: { kind: 'entry', summary: '再退一次。' } }), { mode: 'new' })
    expect(none).toMatchObject({ status: 'refused', reason: NO_ENTRY, reports: [] })
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(0)
  })

  it('mode 一定要給；不變式第 2 條：套用的每一份報告 changes 套用之後等於實際的狀態', async () => {
    const { game } = withAi()
    await expect(game.commitNarrated(spend(), {} as never)).rejects.toThrow(/要給寫正文的模式/)
    const { violations, result } = await observed(game, () => game.commitNarrated(spend({ launch: [{ kind: 'toy', setup: {} }] }), { mode: 'new' }))
    expect(result.status).toBe('applied')
    expect(violations).toEqual([])
  })

  it('FakeProvider 的對抗模式：正文違反硬規則（寫了 HP 數字）時驗證不過、重試之後停在半路，不改狀態；改用規則代替就套用', async () => {
    const bad = new FakeProvider({ byTask: { narrate: [{ text: 'HP: 10/40\n<covered></covered>' }, { text: 'HP: 10/40\n<covered></covered>' }] } })
    const { game } = makeGame({ features: [TEST_ACTIVITY], scenario: 'withMoney', fake: bad })
    const h = stateHash(game.state)
    expect((await game.commitNarrated(spend(), { mode: 'new' })).status).toBe('paused')
    expect(stateHash(game.state)).toBe(h)
    expect((await game.useRules('text')).status).toBe('applied')
  })
})

describe('Game.rewindToStage：像副本的流程（snapshot.take 存 entry、再存 stage、開打、打輸、回到階段）', () => {
  const setup = () => makeGame({ features: [TEST_COMBAT], scenario: 'withMoney' })

  it('入口、階段、開打三份快照都在時打輸：rewindToStage 回到階段那一刻（時間、錢、紀錄），入口那一份還在', async () => {
    const { game } = setup()
    game.commit(draft([take('entry', { label: '入口', owner: 'cm_1' }), { op: 'cash', delta: -100 }, { op: 'time', minutes: 30 }], 'dungeon.enter'))
    const atStage = clone(game.state)
    game.commit(draft([take('stage', { label: '第一階段', owner: 'cm_1', replace: true }), { op: 'cash', delta: -50 }, { op: 'time', minutes: 120 }, { op: 'flag', key: 'stage', value: 1 }], 'dungeon.stage'))
    game.startBattle(BATTLE_SETUPS.hopeless())
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage', 'battle'])
    expect(playOut(game).outcome).toBe('lose')
    await game.finishBattle()
    expect(game.pendingDefeat).not.toBeNull()

    expect(game.rewindToStage()).toBeNull()

    expect(game.state.money).toEqual(atStage.money)
    expect(game.state.time).toEqual(atStage.time)
    expect(game.state.flags).toEqual(atStage.flags)
    expect(game.state.battle).toBeNull()
    expect(game.pendingDefeat).toBeNull()
    // 入口那一份還在（帶著 owner），階段與開打前的都丟了
    expect(game.state.snapshots.map((s) => [s.kind, s.owner])).toEqual([['entry', 'cm_1']])
    // 紀錄：階段之前的照舊；階段開始之後的（含打的那一場）被收回；最後交代這件事
    const kept = atStage.reports.length
    expect(game.state.reports.slice(0, kept).every((r) => !r.retracted)).toBe(true)
    expect(game.state.reports.slice(kept, -1).every((r) => r.retracted)).toBe(true)
    expect(game.state.reports.at(-1)).toMatchObject({ action: 'rewind', outcome: { summary: '你回到這個階段開始的時候。' } })
    expect(game.undo.size).toBe(0)
    // 入口那一份還用得到：回到入口
    expect(game.rewindToKind('entry', '你退出來了。')).toBeNull()
    expect(game.state.money.cash).toBe(500)
  })

  it('每個階段都 replace：只留最新的階段；打輸回到最新的階段開始時', async () => {
    const { game } = setup()
    game.commit(draft([take('entry', { owner: 'cm_1' })], 'dungeon.enter'))
    game.commit(draft([take('stage', { owner: 'cm_1', replace: true }), { op: 'time', minutes: 120 }], 'dungeon.stage1'))
    const atSecond = clone(game.state)
    game.commit(draft([take('stage', { owner: 'cm_1', replace: true }), { op: 'cash', delta: -20 }], 'dungeon.stage2'))
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    game.startBattle(BATTLE_SETUPS.hopeless())
    playOut(game)
    await game.finishBattle()
    expect(game.rewindToStage()).toBeNull()
    expect(game.state.time).toEqual(atSecond.time)
    expect(game.state.money).toEqual(atSecond.money)
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
  })

  it('不在副本裡（沒有階段快照）：等於重來這場戰鬥；沒在等戰敗的選擇時回傳原因', async () => {
    const { game } = setup()
    expect(game.rewindToStage()).toBe('現在沒有在等戰敗的選擇。')
    game.commit(draft([take('entry')], 'dungeon.enter'))
    game.startBattle(BATTLE_SETUPS.hopeless())
    playOut(game)
    await game.finishBattle()
    expect(game.rewindToStage()).toBeNull()
    expect(game.state.battle).not.toBeNull() // 重來：又開打了
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'battle'])
  })
})

describe('crossings：跨過的時間點（L1；dev/adr/0016 第六節）', () => {
  it('同一刻不算跨過；剛好站在點上出發的不算，剛好走到點上的算；往回走是空的', () => {
    for (const f of [weeklyCrossings, dailyCrossings]) expect(f(T(7, 6, 0), T(7, 6, 0))).toEqual([])
    expect(weeklyCrossings(T(7, 5, 59), T(7, 6, 0))).toEqual([T(7, 6, 0)])
    expect(weeklyCrossings(T(7, 6, 0), T(7, 6, 1))).toEqual([])
    expect(weeklyCrossings(T(7, 6, 1), T(7, 5, 0))).toEqual([])
    expect(dailyCrossings(T(1, 7, 59), T(1, 8, 0))).toEqual([T(1, 8, 0)])
    expect(dailyCrossings(T(1, 8, 0), T(1, 23, 59))).toEqual([])
    expect(dailyCrossings(T(1, 8, 0), T(2, 8, 0))).toEqual([T(2, 8, 0)])
  })

  it('一次跨兩週回兩個點（週一 06:00，預設第 7、14、21 天是週一）', () => {
    expect(weeklyCrossings(T(1, 8), T(15, 8))).toEqual([T(7, 6), T(14, 6)])
    expect(weeklyCrossings(T(8), T(21, 12))).toEqual([T(14, 6), T(21, 6)])
    expect(weeklyCrossings(T(1, 8), T(6, 23, 59))).toEqual([])
    expect(countCrossings(T(1, 8), T(15, 8), weeklyRule())).toBe(2)
  })

  it('週一 06:00 與每天 08:00 各有一條：同一段時間各算各的', () => {
    expect(weeklyCrossings(T(7, 5), T(7, 9))).toEqual([T(7, 6)])
    expect(dailyCrossings(T(7, 5), T(7, 9))).toEqual([T(7, 8)])
    expect(dailyCrossings(T(1, 9), T(4, 9))).toEqual([T(2, 8), T(3, 8), T(4, 8)])
    expect(weeklyCrossings(T(6), T(8))).toEqual([T(7, 6)])
    expect(dailyCrossings(T(6), T(8))).toEqual([T(6, 8), T(7, 8)])
    expect(DAILY_RULE).toEqual({ every: 1440, offset: 480 })
  })

  it('週一照時段規則（TimeRules.mondayRemainder）：每一個點都是那天的週一 06:00', () => {
    const rules = { ...DEFAULT_TIME_RULES, mondayRemainder: 3 }
    const pts = weeklyCrossings(T(1), T(12), rules)
    expect(pts).toEqual([T(3, 6), T(10, 6)])
    for (const p of pts) expect(weekdayOf(p, rules)).toBe(0)
    expect(weeklyCrossings(T(1), T(2), { ...DEFAULT_TIME_RULES, mondayRemainder: 1 })).toEqual([T(1, 6)])
    for (const r of [0, 1, 2, 3, 4, 5, 6]) {
      const rl = { ...DEFAULT_TIME_RULES, mondayRemainder: r }
      const all = weeklyCrossings(T(1), T(30), rl)
      expect(all.length).toBeGreaterThanOrEqual(4)
      for (const p of all) expect([weekdayOf(p, rl), p.hour, p.minute], `r=${r}`).toEqual([0, 6, 0])
      expect(new Set(all.map((p) => p.day % 7)).size).toBe(1)
    }
  })

  it('一般的規則 { every, offset }（分鐘）：offset 照餘數算，可以超出一個週期或是負的', () => {
    expect(crossings(T(1, 1), T(1, 5), { every: 90, offset: 10 })).toEqual([T(1, 1, 40), T(1, 3, 10), T(1, 4, 40)])
    expect(crossings(T(1, 1), T(1, 5), { every: 90, offset: 100 })).toEqual(crossings(T(1, 1), T(1, 5), { every: 90, offset: 10 }))
    expect(crossings(T(1, 1), T(1, 5), { every: 90, offset: -80 })).toEqual(crossings(T(1, 1), T(1, 5), { every: 90, offset: 10 }))
  })

  it('壞的規則（every 不是正整數、offset 不是整數）丟 RangeError；跨過太多個點時 crossings 丟錯、countCrossings 照樣回數量', () => {
    for (const rule of [{ every: 0, offset: 0 }, { every: -5, offset: 0 }, { every: 1.5, offset: 0 }, { every: Number.NaN, offset: 0 }, { every: 10, offset: 1.5 }, { every: 10, offset: Number.NaN }]) {
      expect(() => crossings(T(1), T(2), rule), JSON.stringify(rule)).toThrow(RangeError)
      expect(() => countCrossings(T(1), T(2), rule), JSON.stringify(rule)).toThrow(RangeError)
    }
    const every = { every: 1, offset: 0 }
    expect(() => crossings(T(1), T(100_000), every)).toThrow(/超過 100000/)
    expect(countCrossings(T(1), T(100_000), every)).toBeGreaterThan(MAX_CROSSINGS)
    expect(crossings(T(1), T(1, 0, 5), every)).toHaveLength(5)
  })

  it('性質：回傳的點都在（from, to] 裡、都對得上 offset、彼此剛好差一個週期、數量等於 countCrossings，也等於一分鐘一分鐘數出來的', () => {
    const mod = (n: number, m: number) => ((n % m) + m) % m
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 0, max: 4000 }), fc.integer({ min: 1, max: 700 }), fc.integer({ min: -2000, max: 2000 }),
      (a, delta, every, offset) => {
        const from = fromMinutes(a), to = fromMinutes(a + delta)
        const pts = crossings(from, to, { every, offset }).map(toMinutes)
        let brute = 0
        for (let m = a + 1; m <= a + delta; m++) if (mod(m - offset, every) === 0) brute++
        return pts.length === countCrossings(from, to, { every, offset }) && pts.length === brute
          && pts.every((p, i) => p > a && p <= a + delta && mod(p - offset, every) === 0 && (i === 0 || p - pts[i - 1]! === every))
      },
    ), { numRuns: 200 })
    // 一段路拆成兩段：兩段的點加起來等於整段的（不重複、不漏）
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 50_000 }), fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 20_000 }),
      (a, d1, d2) => {
        const t0 = fromMinutes(a), t1 = fromMinutes(a + d1), t2 = fromMinutes(a + d1 + d2)
        return [...weeklyCrossings(t0, t1), ...weeklyCrossings(t1, t2)].length === weeklyCrossings(t0, t2).length
          && [...dailyCrossings(t0, t1), ...dailyCrossings(t1, t2)].length === dailyCrossings(t0, t2).length
      },
    ), { numRuns: 100 })
  })
})

describe('rest.done：型別與「跑掛點、收變更」的小函式（dev/adr/0016 第六節）', () => {
  it('每個處理函式回傳的變更照順序接起來；沒有人聽、或回傳 void 的是空的；處理函式拿到休息的種類與休息做完之前的狀態', () => {
    const k = makeStateKernel()
    const state = makeState()
    expect(restDone(k, state, 'sleep')).toEqual([])
    const seen: string[] = []
    k.hooks.on('rest.done', 'a', ({ kind }) => { seen.push(kind); return [{ op: 'flag', key: `rested_${kind}`, value: true }] })
    k.hooks.on('rest.done', 'quiet', () => undefined)
    k.hooks.on('rest.done', 'b', ({ state: s }) => [{ op: 'counter', key: 'rests', delta: s.counters.rests ?? 1 }])
    expect(restDone(k, state, 'breath')).toEqual([{ op: 'flag', key: 'rested_breath', value: true }, { op: 'counter', key: 'rests', delta: 1 }])
    expect(restDone(k, state, 'stage').map((c) => c.key)).toEqual(['rested_stage', 'rests'])
    expect(seen).toEqual(['breath', 'stage'])
    expect([...REST_KINDS]).toEqual(['breath', 'sleep', 'stage'])
  })

  it('發的人（功能）把回傳的變更接在自己的休息報告後面：提交之後套用', () => {
    const heal: Feature = {
      id: 'heal',
      install: (k) => k.hooks.on('rest.done', 'heal', ({ kind }) => (kind === 'sleep' ? [{ op: 'actor.track', id: 'pc', track: 'sink', delta: 0 }, { op: 'flag', key: 'slept', value: true }] : undefined)),
    }
    const { game } = makeGame({ features: [heal] })
    const rest = (kind: 'breath' | 'sleep') => draft([{ op: 'time', minutes: kind === 'sleep' ? 480 : 60 }, ...restDone(game.k, game.state, kind)], `rest.${kind}`)
    game.commit(rest('breath'))
    expect(game.state.flags.slept).toBeUndefined()
    game.commit(rest('sleep'))
    expect(game.state.flags.slept).toBe(true)
    expect(game.state.time).toEqual({ day: 1, hour: 17, minute: 0 })
  })

  it('格式不對丟錯，訊息寫出是誰回傳的；休息的種類不對丟錯；嚴格模式下偷改狀態被抓到', () => {
    const state = makeState()
    for (const [bad, shape] of [['nope', 'bad_string'], [[{ kind: 'x' }], 'bad_op'], [{ op: 'flag' }, 'bad_object'], [[null], 'bad_null']] as const) {
      const k = makeStateKernel()
      k.hooks.on('rest.done', shape, () => bad as never)
      expect(() => restDone(k, state, 'breath'), shape).toThrow(new RegExp(`${shape} 回傳的不是變更的陣列`))
    }
    const k = makeStateKernel()
    expect(() => restDone(k, state, 'nap' as never)).toThrow(/休息的種類只能是 breath、sleep、stage/)
    const sneaky = makeStateKernel()
    sneaky.strict = true
    sneaky.hooks.on('rest.done', 'sneaky', ({ state: s }) => { s.flags.cheat = true })
    expect(() => restDone(sneaky, makeState(), 'sleep')).toThrow(/rest\.done 的掛鉤直接改了狀態/)
  })
})

describe('actionKindToDef：資料 → 行動種類的定義（從 features/actions 搬進核心；補充）', () => {
  const entry = {
    id: 'seduce', name: '誘惑', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 30, max_minutes: 120, tags: ['social'], owner: 'npcs',
    requires: { kind: 'flag', key: 'ok' }, blocked_text: '現在不能誘惑。',
    hint: { success: [{ kind: 'cash', amount: 10 }] }, hint_by_grade: { 3: { success: [{ kind: 'cash', amount: 30 }], narrow: [{ kind: 'cash', amount: 20 }] } },
  } as unknown as ActionKindEntry
  const ctx = (state: GameState, degree: 'critical' | 'success' | 'fail' | 'fumble', grade: 1 | 2 | 3 | 4 | 5, narrow = false) => ({ state, input: { kind: 'seduce' }, actor: 'pc', degree, narrow, grade })

  it('欄位照資料轉；owner 是呼叫的功能給的（預設 actions）；寫了 owner 的資料可以由那個功能自己註冊進 k.actions', () => {
    const k = createKernel()
    const def = actionKindToDef(entry, k, 'npcs')
    expect(def).toMatchObject({ id: 'seduce', owner: 'npcs', name: '誘惑', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 30, maxMinutes: 120, reportKind: 'action', tags: ['social'] })
    expect(actionKindToDef(entry, k).owner).toBe('actions')
    k.actions.register(def)
    expect(k.actions.get('seduce')!.owner).toBe('npcs')
    // 沒有 skill、tags、requires、hint：就沒有那些欄位；tags 是複製的
    const bare = actionKindToDef({ id: 'loiter', name: '閒晃', attr: 'body', dc: 'easy', minutes: 10, max_minutes: 60 } as unknown as ActionKindEntry, k)
    expect(bare.skill).toBeUndefined()
    expect(bare.tags).toBeUndefined()
    expect(bare.block).toBeUndefined()
    expect(bare.hint).toBeUndefined()
    const t = (entry.tags as string[])
    expect(def.tags).not.toBe(t)
  })

  it('requires 與 blocked_text 變成 block：條件不成立回傳那一句，成立回傳 null', () => {
    const k = createKernel()
    const def = actionKindToDef(entry, k, 'npcs')
    const s = makeState()
    expect(def.block!(s, { kind: 'seduce' })).toBe('現在不能誘惑。')
    s.flags.ok = true
    expect(def.block!(s, { kind: 'seduce' })).toBeNull()
  })

  it('hint 與 hint_by_grade 變成 hint：照等級往下找表；成功但差距不到 3 用 narrow（沒寫就用 success）；傳回的是複製', () => {
    const k = createKernel()
    const def = actionKindToDef(entry, k, 'npcs')
    const s = makeState()
    const cash = (n: number) => [{ kind: 'cash', amount: n }]
    expect(def.hint!(ctx(s, 'success', 1))).toEqual(cash(10))
    expect(def.hint!(ctx(s, 'success', 2))).toEqual(cash(10)) // 2 級沒寫：用比它低、最近的那一級
    expect(def.hint!(ctx(s, 'success', 3))).toEqual(cash(30))
    expect(def.hint!(ctx(s, 'success', 3, true))).toEqual(cash(20))
    expect(def.hint!(ctx(s, 'success', 5))).toEqual(cash(30))
    expect(def.hint!(ctx(s, 'success', 1, true))).toEqual(cash(10)) // narrow 沒寫
    expect(def.hint!(ctx(s, 'fumble', 1))).toEqual([])
    const got = def.hint!(ctx(s, 'success', 1)) as unknown as Array<{ amount: number }>
    got[0]!.amount = 999
    expect(def.hint!(ctx(s, 'success', 1))).toEqual(cash(10))
  })
})
