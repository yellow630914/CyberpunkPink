// L7 門面 Game：行動的結果（applied／paused／refused）、提交的選項、開新局、讀檔、回到快照、時鐘。
// 規格：AI_TASKS 2.4、5.1、5.5 節；GAME_DESIGN 第 9 節；SERIES 第 6 節；CORE_RULES 7.4 節；dev/invariants.md 第 3、4、6 條。
// M0 的修正批次（2026-11-22）（審查 E2、E4；dev/bugs W001、W003、W008；介面回報的四個需求）加的介面都在這裡驗。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ActionKindDef, Change, Feature, GameState, ReportDraft } from '../../src'
import { Game, clone } from '../../src'
import { makeActor, makeGame, observed, stateHash } from '../../src/testkit'

const draft = (changes: Change[], action = 'test', summary = action): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary } })
const BEG: ActionKindDef = { id: 'beg', owner: 'test', name: '乞討', attr: 'charm', dc: 'normal', minutes: 60, maxMinutes: 120, reportKind: 'action', hint: ({ degree }) => (degree === 'fail' || degree === 'fumble' ? [] : [{ kind: 'cash', amount: 20 }]) }
const NEVER: ActionKindDef = { ...BEG, id: 'never', name: '做不到的事', block: () => '現在做不了這件事。' }
const actions: Feature = { id: 'test_actions', install: (k) => { k.actions.register(BEG); k.actions.register(NEVER) } }

describe('L7 Game：行動的三種結果分開（審查 E4）', () => {
  it('applied：套用了；refused：行動被擋下（附原因，狀態不變、不留回退、沒有鏈可以重試）；paused：鏈停下來等玩家（狀態還沒改，留著那一步回退）', async () => {
    const { game } = makeGame({ features: [actions], ai: { ai: 1 }, fake: { byTask: { judge: [{ refusal: true }] } } })
    const h0 = stateHash(game.state)

    const refused = await game.act({ kind: 'never' })
    expect(refused.status).toBe('refused')
    expect(refused.reason).toBe('現在做不了這件事。')
    expect(refused.reports).toEqual([])
    expect(stateHash(game.state)).toBe(h0)
    expect(game.undo.size).toBe(0)
    expect(game.lastRun).toBeNull()

    const paused = await game.act({ kind: 'beg', text: '我伸手' })
    expect(paused.status).toBe('paused')
    expect(paused.reason).toBeUndefined()
    expect(stateHash(game.state)).toBe(h0)
    expect(game.undo.size).toBe(1)
    expect(game.lastRun).toBe(paused.run)
    expect(game.stepActions('judge')).toEqual({ retry: null, useRules: null, reroll: '這一步不是擲骰，不能重擲。' })

    const applied = await game.useRules('judge')
    expect(applied.status).toBe('applied')
    expect(applied.reports).toHaveLength(1)
    expect(game.undo.size).toBe(1)
  })

  it('還沒有主角也是 refused；沒有這種行動、沒有這條鏈是程式的錯誤（丟出來），兩者都不改狀態與回退', async () => {
    const { game } = makeGame({ scenario: 'beforeCreation' })
    const h0 = stateHash(game.state)
    expect(await game.act({ kind: 'free', text: '還沒有主角就想動' })).toMatchObject({ status: 'refused', reason: '還沒有主角。' })
    await expect(game.act({ kind: 'no_such_action' })).rejects.toThrow(/沒有 no_such_action 這種行動/)
    await expect(game.runChain('no_such_chain', {})).rejects.toThrow(/沒有 no_such_chain 這條任務鏈/)
    expect(stateHash(game.state)).toBe(h0)
    expect(game.undo.size).toBe(0)
  })

  it('關掉 AI 取消進行中的鏈：結果是 cancelled，狀態不變，它留的那一步回退也拿掉', async () => {
    const { game } = makeGame({ features: [actions], ai: { ai: 1 }, fake: { byTask: { judge: [{ hang: true }] } }, idleTimeoutMs: 5000 })
    const h0 = stateHash(game.state)
    const pending = game.act({ kind: 'beg', text: '我伸手' })
    await new Promise((r) => setTimeout(r, 5))
    game.setAiSettings({ ai: 0 })
    expect((await pending).status).toBe('cancelled')
    expect(stateHash(game.state)).toBe(h0)
    expect(game.undo.size).toBe(0)
    expect(game.lastRun).toBeNull()
  })

  it('訂閱的人：套用時收到報告；重試已經套用的鏈時先收到一次回到套用前的通知', async () => {
    const { game } = makeGame({ features: [actions], ai: { ai: 1 }, fake: true })
    const seen: Array<[number, number]> = []
    game.subscribe((state, reports) => seen.push([state.reports.length, reports.length]))
    await game.act({ kind: 'beg', text: '我伸手' })
    expect(seen).toEqual([[2, 1]])
    await game.retryStep('text')
    expect(seen).toEqual([[2, 1], [1, 0], [2, 1]])
    await game.act({ kind: 'never' })
    expect(seen).toHaveLength(3)
  })
})

describe('L7 Game.commit：留一步回退，或併進最新一樓（AI_TASKS 5.5 節；審查 S3、ui-undo-ledger-steps）', () => {
  it('預設留一步回退（第二個參數給字串就是名字）；attach 不留；失敗時狀態與回退都不變', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    game.commit(draft([{ op: 'cash', delta: -1 }], 'buy', '買了一包菸'))
    game.commit(draft([{ op: 'cash', delta: -1 }]), '自己取的名字')
    game.commit(draft([{ op: 'cash', delta: -1 }]), { label: '用選項取的名字' })
    expect(game.undo.labels()).toEqual(['買了一包菸', '自己取的名字', '用選項取的名字'])
    game.commit(draft([{ op: 'cash', delta: -1 }]), { attach: true })
    expect(game.undo.size).toBe(3)
    const h = stateHash(game.state)
    for (const opts of [{}, { attach: true }]) {
      expect(() => game.commit(draft([{ op: 'cash', delta: -99999 }]), opts)).toThrow(/現金不夠/)
      expect(stateHash(game.state)).toBe(h)
      expect(game.undo.size).toBe(3)
    }
    // 回退一步：最新那一步連同併進它的那一筆帳一起收回
    expect(game.undoSteps(1)).toBe(true)
    expect(game.state.money.cash).toBe(498)
  })

  it('性質：一串提交（留一步或併進），回退的步數只算留一步的那幾份（最多 5）；回退一步回到最後一份「留一步」的提交之前', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), (attaches) => {
      const { game } = makeGame({ scenario: 'withMoney' })
      const before: string[] = []
      for (const attach of attaches) {
        if (!attach) before.push(stateHash(game.state))
        game.commit(draft([{ op: 'cash', delta: -1 }]), { attach })
      }
      if (game.undo.size !== Math.min(before.length, 5)) return false
      if (before.length === 0) return game.undoSteps(1) === false
      return game.undoSteps(1) && stateHash(game.state) === before.at(-1)
    }))
  })

  it('任務鏈還在跑的時候不能提交別的報告（丟錯，狀態不變）；鏈跑完之後照常', async () => {
    const { game } = makeGame({ features: [actions], scenario: 'withMoney', ai: { ai: 1 }, fake: { byTask: { judge: [{ delayMs: 20, json: { degree: 'success' } }] } } })
    const pending = game.act({ kind: 'beg', text: '我伸手' })
    await new Promise((r) => setTimeout(r, 2))
    const h = stateHash(game.state)
    for (const attach of [false, true]) expect(() => game.commit(draft([{ op: 'cash', delta: -1 }]), { attach })).toThrow('上一條任務鏈還在跑。')
    expect(stateHash(game.state)).toBe(h)
    expect((await pending).status).toBe('applied')
    expect(game.commit(draft([{ op: 'cash', delta: -1 }]))).toHaveLength(1)
  })

  it('訂閱的人收到這一回合的每一份報告（含掛鉤接著提交的）；失敗時不通知', () => {
    const bill: Feature = { id: 'bill', install: (k) => k.hooks.on('time.passed', 'bill', () => [draft([{ op: 'cash', delta: -100 }], 'bill')]) }
    const { game } = makeGame({ features: [bill] })
    const seen: string[][] = []
    game.subscribe((_s, reports) => seen.push(reports.map((r) => r.action ?? '')))
    expect(() => game.commit(draft([{ op: 'time', minutes: 60 }], 'rest'))).toThrow(/現金不夠/)
    expect(seen).toEqual([])
    expect(game.undo.size).toBe(0)
    game.commit(draft([{ op: 'cash', delta: 100 }], 'gift'))
    game.commit(draft([{ op: 'time', minutes: 60 }], 'rest'))
    expect(seen).toEqual([['gift'], ['rest', 'bill']])
  })
})

describe('L7 Game.newGame：開局是一件事（審查 S11）', () => {
  const creation = (state: GameState): ReportDraft => draft([{ op: 'actor.add', actor: makeActor({ name: '露', age: 22 }) }, { op: 'pc', id: 'pc' }, { op: 'cash', delta: state.rules.startMoney }], 'creation.commit')

  it('setup 回傳開局接著要提交的報告（建角）：一起進去，不留回退；訂閱的人收到兩份', () => {
    const game = new Game({ strict: true })
    const seen: string[][] = []
    game.subscribe((_s, reports) => seen.push(reports.map((r) => r.action ?? '')))
    const first = game.newGame({ seed: 7, rules: { difficulty: 'hard' }, setup: creation })
    expect(first.action).toBe('game.new')
    expect(game.state.reports.map((r) => r.action)).toEqual(['game.new', 'creation.commit'])
    expect(game.state.pc).toBe('pc')
    expect(game.state.money.cash).toBe(1500)
    expect(game.state.rules.dcOffset).toBe(1)
    expect(game.undo.size).toBe(0)
    expect(seen).toEqual([['game.new', 'creation.commit']])
  })

  it('setup 丟錯或回傳不合法的報告：現在這一局完全不動（狀態、回退、最新的鏈都在）', async () => {
    const { game } = makeGame()
    await game.act({ kind: 'free', text: '我看看四周' })
    const before = clone(game.state)
    expect(() => game.newGame({ seed: 9, setup: () => { throw new Error('要有名字。') } })).toThrow('要有名字。')
    expect(() => game.newGame({ seed: 9, setup: () => draft([{ op: 'actor.add', actor: { ...makeActor(), age: 17 } }]) })).toThrow(/18/)
    expect(() => game.newGame({ seed: 9, setup: () => [draft([{ op: 'flag', key: 'a', value: true }]), draft([{ op: 'cash', delta: -1 }])] })).toThrow(/現金不夠/)
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(1)
    expect(game.lastRun).not.toBeNull()
    // 沒有 setup 照舊：一份 game.new，沒有主角
    game.newGame({ seed: 9 })
    expect(game.state.pc).toBeNull()
    expect(game.state.reports).toHaveLength(1)
    expect(game.lastRun).toBeNull()
  })
})

describe('L7 Game.load：讀檔修復失敗也算讀檔失敗（W003）', () => {
  it('修復的變更不合法、修復的掛鉤丟錯：回傳錯誤訊息，狀態、回退、最新的鏈都不變', async () => {
    let mode: 'ok' | 'bad' | 'throw' = 'ok'
    const repair: Feature = { id: 'repair', install: (k) => k.hooks.on('save.loaded', 'repair', () => { if (mode === 'throw') throw new Error('修復的程式壞了'); return mode === 'bad' ? [{ op: 'cash', delta: -1 }] : [{ op: 'flag', key: 'repaired', value: true }] }) }
    const { game } = makeGame({ features: [repair] })
    const raw = game.save()
    await game.act({ kind: 'free', text: '我看看四周' })
    const before = clone(game.state)
    for (const m of ['bad', 'throw'] as const) {
      mode = m
      expect(game.load(raw)).toMatch(/修復沒有成功/)
      expect(game.state).toEqual(before)
      expect(game.undo.size).toBe(1)
      expect(game.lastRun).not.toBeNull()
    }
    mode = 'ok'
    expect(game.load(raw)).toBeNull()
    expect(game.state.flags.repaired).toBe(true)
    expect(game.state.reports.at(-1)!.action).toBe('save.repair')
    expect(game.undo.size).toBe(0)
  })
})

describe('L7 Game.rewind：回到快照那一刻，但保留之後的紀錄（SERIES 第 6 節：委託副本的撤退）', () => {
  const setup = (features: Feature[] = []) => makeGame({ features: [actions, ...features], scenario: 'withMoney', ai: { ai: 1 }, fake: true })

  it('生命、錢、時間、旗標、亂數的位置回到快照；之後的報告留著並標成被收回；流水號接著走；最後一份報告交代這件事；不能回退到這之前', async () => {
    const { game } = setup()
    await game.act({ kind: 'beg', text: '進副本之前' })
    const snap = game.save('snapshot', 'entry')
    const atEntry = clone(game.state)
    await game.act({ kind: 'beg', text: '副本裡的第一件事' })
    game.commit(draft([{ op: 'time', minutes: 120 }, { op: 'cash', delta: -100 }, { op: 'flag', key: 'stage', value: 2 }], 'stage'))
    const seen: string[][] = []
    game.subscribe((_s, reports) => seen.push(reports.map((r) => r.action ?? '')))
    const before = clone(game.state)

    expect(game.rewind(snap, { summary: '你退了出來。接下來這一段是沒有發生過的事。' })).toBeNull()

    const s = game.state
    expect(s.time).toEqual(atEntry.time)
    expect(s.money).toEqual(atEntry.money)
    expect(s.flags).toEqual(atEntry.flags)
    expect(s.rng).toEqual(atEntry.rng)
    expect(s.actors).toEqual(atEntry.actors)
    // 紀錄：快照之前的照舊；之後的留著、標成被收回，內容一個字不少（擲骰行還在）；再加一份交代這件事
    expect(s.reports.map((r) => [r.action, r.retracted ?? false])).toEqual([['game.new', false], ['beg', false], ['beg', true], ['stage', true], ['rewind', false]])
    expect(s.reports[2]).toEqual({ ...before.reports[2], retracted: true })
    expect(s.reports[2]!.timeline[0]!.roll).toBeDefined()
    expect(s.reports.at(-1)).toMatchObject({ id: 'r5', kind: 'system', outcome: { result: 'rewound', summary: '你退了出來。接下來這一段是沒有發生過的事。' }, time: { start: atEntry.time, end: atEntry.time } })
    expect(new Set(s.reports.map((r) => r.id)).size).toBe(s.reports.length)
    expect(s.seq.report).toBe(5)
    expect(s.seq.chain).toBe(before.seq.chain)
    expect(s.chains).toEqual(before.chains)
    expect(game.undo.size).toBe(0)
    expect(game.lastRun).toBeNull()
    expect(seen).toEqual([['rewind']])
    // 存檔再讀檔一模一樣；之後的行動照常，鏈的編號不重複
    const after = clone(game.state)
    expect(game.load(game.save())).toBeNull()
    expect(game.state).toEqual(after)
    const next = await game.act({ kind: 'beg', text: '再進去一次' })
    expect(next.status).toBe('applied')
    expect(new Set(game.state.chains.map((c) => c.id)).size).toBe(game.state.chains.length)
    expect(game.state.reports.at(-1)!.retracted).toBeUndefined()
  })

  it('功能要保留自己那一塊：掛 rewind.keep 回傳變更（例：性經歷、共同記憶），套在回去之後的狀態上', async () => {
    const memory: Feature = {
      id: 'memory',
      install: (k) => k.hooks.on('rewind.keep', 'memory', ({ current, restored }) => (current.ext.memory !== undefined && current.ext.memory !== restored.ext.memory ? [{ op: 'ext', key: 'memory', value: current.ext.memory }] : undefined)),
    }
    const { game } = setup([memory])
    const snap = game.save()
    game.commit(draft([{ op: 'ext', key: 'memory', value: ['那一晚的事'] }, { op: 'ext', key: 'progress', value: { stage: 3 } }]))
    expect(game.rewind(snap, { summary: '撤退。' })).toBeNull()
    expect(game.state.ext).toEqual({ memory: ['那一晚的事'] })
    expect(game.state.reports.at(-1)!.changes).toEqual([{ op: 'ext', key: 'memory', value: ['那一晚的事'] }])
  })

  it('失敗時回傳錯誤訊息，狀態不變：不是存檔、不是這一局更早的狀態、保留的變更不合法', async () => {
    let bad = false
    const keeper: Feature = { id: 'keeper', install: (k) => k.hooks.on('rewind.keep', 'keeper', () => (bad ? [{ op: 'cash', delta: -999999 }] : undefined)) }
    const { game } = setup([keeper])
    const other = makeGame({ features: [actions], scenario: 'withMoney', seed: 99 }).game
    await other.act({ kind: 'beg', text: '別的局' })
    await game.act({ kind: 'beg', text: '第一件事' })
    const snap = game.save()
    await game.act({ kind: 'beg', text: '第二件事' })
    const before = clone(game.state)
    expect(game.rewind('不是存檔', { summary: 'x' })).toMatch(/不是存檔/)
    // 報告比現在多（未來的狀態）或 id 對不上（別的局）
    const longer = JSON.parse(game.save()) as { state: GameState }
    longer.state.reports.push({ ...longer.state.reports.at(-1)!, id: 'r99' })
    expect(game.rewind(JSON.stringify(longer), { summary: 'x' })).toMatch(/不是這一局更早的狀態/)
    const foreign = JSON.parse(snap) as { state: GameState }
    foreign.state.reports[1]!.id = 'r77'
    expect(game.rewind(JSON.stringify(foreign), { summary: 'x' })).toMatch(/不是這一局更早的狀態/)
    bad = true
    expect(game.rewind(snap, { summary: 'x' })).toMatch(/沒有辦法回到那一刻.*現金不夠/)
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(2)
    // 別的局的存檔（種子不同，但報告的 id 剛好對得上）擋不了：呼叫的人只能拿這一局自己記的快照
    expect(other.state.reports).toHaveLength(2)
    bad = false
    expect(game.rewind(snap, { summary: 'x' })).toBeNull()
  })

  it('性質：做 a 件事、記快照、再做 b 件事、回到快照：報告有 1 + a + b + 1 份，其中 b 份被收回；錢與時間等於快照那一刻；不變式成立', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 4 }), async (seed, a, b) => {
      const { game } = makeGame({ features: [actions], scenario: 'withMoney', seed })
      for (let i = 0; i < a; i++) await game.act({ kind: 'beg', text: `之前 ${i}` })
      const snap = game.save()
      const at = clone(game.state)
      for (let i = 0; i < b; i++) await game.act({ kind: 'beg', text: `之後 ${i}` })
      const { result, violations } = await observed(game, () => game.rewind(snap, { summary: '撤退。' }))
      const s = game.state
      return result === null && violations.length === 0 && s.reports.length === 1 + a + b + 1 && s.reports.filter((r) => r.retracted).length === b
        && JSON.stringify(s.money) === JSON.stringify(at.money) && JSON.stringify(s.time) === JSON.stringify(at.time) && s.rng.cursor === at.rng.cursor
    }), { numRuns: 20 })
  })
})

describe('L7 Game.clock 與存檔的摘要', () => {
  it('現在是星期幾、哪個時段、離收租日幾天（照這一局的時段規則；CORE_RULES 7.4 節）', () => {
    const { game } = makeGame()
    expect(game.clock()).toEqual({ weekday: 1, segment: 'morning', segmentWeekday: 1, daysToMonday: 6 })
    game.commit(draft([{ op: 'time', minutes: 6 * 1440 - 8 * 60 + 60 }]))
    expect(game.state.time).toEqual({ day: 7, hour: 1, minute: 0 })
    // 第 7 天凌晨 1 點：日曆上已經是週一（收租日），但這一段還算週日的深夜
    expect(game.clock()).toEqual({ weekday: 0, segment: 'late', segmentWeekday: 6, daysToMonday: 0 })
    game.commit(draft([{ op: 'time', minutes: 120 }]))
    expect(game.clock()).toEqual({ weekday: 0, segment: 'dawn', segmentWeekday: 0, daysToMonday: 0 })
  })

  it('存檔的摘要有出身（W008）：出身放在 actor.ext.origin 的 id；名字用內容查', () => {
    const { game } = makeGame({ pc: { ext: { origin: { id: 'hive', favor: 'lonestar' } } } })
    expect(JSON.parse(game.save()).meta.pc).toEqual({ name: '測試主角', origin: 'hive' })
    const named = makeGame({ pc: { ext: { origin: 'oldport' } }, content: [{ id: 'o', content: { skill: [{ id: 'stealth', name: '隱匿', attr: 'reflex', desc: '潛行。' }], perk: [{ id: 'p', name: '特質', category: 'origin', cost: 1, flaw: false, desc: '說明。' }], faction: [{ id: 'rouge', name: '胭脂堂', short: '胭脂堂', class: 'street' }], origin: [{ id: 'oldport', name: '舊港', line: '碼頭', skill_bonus: { stealth: 1 }, status: 'unregistered', home: '倉庫', favor: { choose_one: ['rouge'], value: 25 }, perk: 'p', roster: [] }] } }] }).game
    expect(JSON.parse(named.save()).meta.pc).toEqual({ name: '測試主角', origin: 'oldport', originName: '舊港' })
    expect(JSON.parse(makeGame().game.save()).meta.pc).toEqual({ name: '測試主角' })
  })
})
