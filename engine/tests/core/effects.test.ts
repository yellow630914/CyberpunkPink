import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { Effect, EffectCtx, EffectDef, Grade } from '../../src/core'
import { MONEY_CAP_BY_GRADE, REP_GRADE_STAT, areaGrade, askedMatches, createKernel, effectCtx, effectLevel, repGrade, shouldClamp } from '../../src/core'
import { makeState } from '../../src/testkit'

function setup(over: Partial<EffectCtx> = {}) {
  const k = createKernel()
  const state = over.state ?? makeState({ patch: { money: { cred: 100, cash: 100 } } })
  const ctx: EffectCtx = { state, actor: 'pc', grade: 1, source: 'ai', clampAsked: true, content: k.content, ...over }
  return { k, state, ctx }
}

// 規格：EVENTS 2.4 節（封閉清單與上限）；AI_TASKS 2.5 節（驗證與夾值）；dev/invariants.md 第 8、11、16 條
describe('L4 效果：封閉清單、驗證、夾值', () => {
  it('不在封閉清單裡的種類是格式錯誤，整批不收', () => {
    const { k, ctx } = setup()
    const r = k.effects.resolve([{ kind: 'cash', amount: 5 }, { kind: 'summon_dragon', amount: 1 }], ctx)
    expect(r.errors[0]).toMatch(/不在封閉清單裡/)
    expect(r.changes).toEqual([])
    expect(k.effects.resolve('nope', ctx).errors[0]).toMatch(/陣列/)
    expect(k.effects.resolve([5], ctx).errors[0]).toMatch(/物件/)
    expect(k.effects.resolve([{ kind: 'cash', amount: 'many' }], ctx).errors[0]).toMatch(/amount 要是整數/)
    expect(k.effects.resolve([{ kind: 'cash', amount: 1, asked: 5 }], ctx).errors[0]).toMatch(/asked/)
  })

  it('錢的上限照等級：I 級 120、II 級 360、III 級 1,200、IV 級 3,900、V 級 12,000。AI 給的看主角信譽那一階，內建的看區的等級', () => {
    expect(MONEY_CAP_BY_GRADE).toEqual({ 1: 120, 2: 360, 3: 1200, 4: 3900, 5: 12000 })
    for (const grade of [1, 2, 3, 4, 5] as Grade[]) {
      // AI 生成的：主角信譽那一階對應的等級（repGrade），和所在的區無關
      const ai = setup({ repGrade: grade, grade: 1 })
      const r = ai.k.effects.resolve([{ kind: 'cash', amount: 999999 }], ai.ctx)
      expect(r.changes).toEqual([{ op: 'cash', delta: MONEY_CAP_BY_GRADE[grade] }])
      expect(r.clamps).toHaveLength(1)
      expect(r.clamps[0]).toMatchObject({ from: 999999, to: MONEY_CAP_BY_GRADE[grade], path: 'effects[0]' })
      expect(setup({ grade, repGrade: 1 }).k.effects.resolve([{ kind: 'cash', amount: 999999 }], setup({ grade, repGrade: 1 }).ctx).changes).toEqual([{ op: 'cash', delta: 120 }])
      // 內建的事件：拿到的錢照事件所在的區的等級
      const built = setup({ source: 'builtin', grade, repGrade: 1 })
      expect(built.k.effects.resolve([{ kind: 'cash', amount: 999999 }], built.ctx).changes).toEqual([{ op: 'cash', delta: MONEY_CAP_BY_GRADE[grade] }])
    }
  })

  it('被夾值的提醒是白話，不出現欄位名稱', () => {
    const { k, ctx } = setup()
    const note = k.effects.resolve([{ kind: 'cash', amount: 5000 }], ctx).clamps[0]!.notice
    expect(note).toBe('你要的比這一區給得起的多，實際拿到 120 元。')
    expect(note).not.toMatch(/amount|cash|effects/)
  })

  it('性質：AI 自己生成的錢，夾過之後一定在上限內；沒超過的不動、不留記號', () => {
    fc.assert(fc.property(fc.integer({ min: -1e7, max: 1e7 }), fc.constantFrom<Grade>(1, 2, 3, 4, 5), (amount, grade) => {
      const { k, ctx } = setup({ repGrade: grade, state: makeState({ patch: { money: { cred: 1e8, cash: 0 } } }) })
      const r = k.effects.resolve([{ kind: 'cred', amount }], ctx)
      const e = (r.effects[0] ?? { amount: 0 }) as unknown as { amount: number }
      const cap = MONEY_CAP_BY_GRADE[grade]
      return Math.abs(e.amount) <= cap && (Math.abs(amount) > cap ? r.clamps.length === 1 : r.clamps.length === 0 && e.amount === amount)
    }))
  })

  it('扣的錢不超過手上有的（提交不會因為錢不夠而失敗）', () => {
    const { k, ctx } = setup({ source: 'builtin' })
    expect(k.effects.resolve([{ kind: 'cash', amount: -5000 }], ctx).changes).toEqual([{ op: 'cash', delta: -100 }])
    expect(k.effects.resolve([{ kind: 'cash', amount: 0 }], ctx).changes).toEqual([])
  })

  it('誰要的決定夾不夾：內建的照寫的算（只有拿到的錢照區的等級）；AI 的一律夾；玩家的看設定與 asked', () => {
    const big = { kind: 'cash', amount: 5000 }
    expect(setup({ source: 'builtin', grade: 5 }).k.effects.resolve([big], setup({ source: 'builtin', grade: 5 }).ctx).changes).toEqual([{ op: 'cash', delta: 5000 }])
    expect(setup({ source: 'builtin' }).k.effects.resolve([big], setup({ source: 'builtin' }).ctx).changes).toEqual([{ op: 'cash', delta: 120 }])
    // 玩家要求的、設定開著（預設）：照樣夾，附了 asked 也一樣
    const on = setup({ source: 'player', clampAsked: true, playerInput: '他給了我一張金卡' })
    expect(on.k.effects.resolve([{ ...big, asked: '一張金卡' }], on.ctx).changes).toEqual([{ op: 'cash', delta: 120 }])
    // 設定關著、asked 對得上：不夾、不提醒
    const off = setup({ source: 'player', clampAsked: false, playerInput: '他給了我一張金卡' })
    const free = off.k.effects.resolve([{ ...big, asked: '一張金卡' }], off.ctx)
    expect(free.changes).toEqual([{ op: 'cash', delta: 5000 }])
    expect(free.clamps).toEqual([])
    // 設定關著、沒附 asked 或對不上：當成 AI 自己加的，照夾
    expect(off.k.effects.resolve([big], off.ctx).changes).toEqual([{ op: 'cash', delta: 120 }])
    expect(off.k.effects.resolve([{ ...big, asked: '一把神劍' }], off.ctx).changes).toEqual([{ op: 'cash', delta: 120 }])
    // AI 自己生成的：設定關著、附了 asked 也夾
    const ai = setup({ source: 'ai', clampAsked: false, playerInput: '他給了我一張金卡' })
    expect(ai.k.effects.resolve([{ ...big, asked: '一張金卡' }], ai.ctx).changes).toEqual([{ op: 'cash', delta: 120 }])
  })

  it('asked 是字串比對：要真的出現在玩家這一回合的輸入裡', () => {
    expect(askedMatches('金卡', '給我一張金卡')).toBe(true)
    expect(askedMatches('  金卡 ', '給我一張金卡')).toBe(true)
    expect(askedMatches('銀卡', '給我一張金卡')).toBe(false)
    expect(askedMatches('', '給我一張金卡')).toBe(false)
    expect(askedMatches('金卡', undefined)).toBe(false)
    expect(askedMatches(undefined, '給我一張金卡')).toBe(false)
    expect(shouldClamp({ kind: 'cash' }, { source: 'builtin', clampAsked: true })).toBe(false)
  })

  it('格式錯誤不論開關都擋：設定關著、asked 對得上，不存在的種類照樣不收', () => {
    const off = setup({ source: 'player', clampAsked: false, playerInput: '天降一把神劍' })
    expect(off.k.effects.resolve([{ kind: 'godsword', asked: '神劍' }], off.ctx).errors).toHaveLength(1)
    expect(off.k.effects.resolve([{ kind: 'item', id: 'it_godsword', qty: 1, asked: '神劍' }], off.ctx).errors[0]).toMatch(/目錄還沒有載入/)
  })

  it('物品：引用不存在的 id 是格式錯誤；等級超過這一區的整筆拿掉並提醒', () => {
    const { k, ctx } = setup({ grade: 1 })
    k.content.defineKind({ kind: 'item', owner: 'test', validate: () => [] })
    k.content.load('item', [{ id: 'it_smoke', name: '菸', grade: 1 }, { id: 'it_rifle', name: '步槍', grade: 3 }])
    expect(k.effects.resolve([{ kind: 'item', id: 'it_nope', qty: 1 }], ctx).errors[0]).toMatch(/不存在的物品/)
    expect(k.effects.resolve([{ kind: 'item', id: 'it_smoke', qty: -1 }], ctx).errors[0]).toMatch(/不夠/)
    const r = k.effects.resolve([{ kind: 'item', id: 'it_smoke', qty: 1 }, { kind: 'item', id: 'it_rifle', qty: 1 }], ctx)
    expect(r.changes).toEqual([{ op: 'item', id: 'it_smoke', qty: 1 }])
    expect(r.lines).toEqual(['拿到：菸'])
    expect(r.clamps[0]!.notice).toMatch(/步槍/)
    expect(k.effects.resolve([{ kind: 'item', id: 'it_rifle', qty: 1 }], { ...ctx, source: 'builtin' }).changes).toHaveLength(1)
  })

  it('旗標：AI 與玩家要來的只能寫在 ai: 底下；時間不能是負的', () => {
    const { k, ctx } = setup()
    expect(k.effects.resolve([{ kind: 'flag', key: 'main_quest_done', value: true }], ctx).errors[0]).toMatch(/ai: 開頭/)
    expect(k.effects.resolve([{ kind: 'flag', key: 'ai:met_stranger', value: true }], ctx).changes).toEqual([{ op: 'flag', key: 'ai:met_stranger', value: true }])
    expect(k.effects.resolve([{ kind: 'flag', key: 'main_quest_done', value: true }], { ...ctx, source: 'builtin' }).errors).toEqual([])
    expect(k.effects.resolve([{ kind: 'time', hours: -1 }], ctx).errors).toHaveLength(1)
    expect(k.effects.resolve([{ kind: 'time', hours: 1.5 }], ctx).changes).toEqual([{ op: 'time', minutes: 90 }])
  })

  it('定案的結果一行一筆、是白話', () => {
    const { k, ctx } = setup()
    expect(k.effects.resolve([{ kind: 'cash', amount: 12 }, { kind: 'cred', amount: -30 }], ctx).lines).toEqual(['拿到：現金 12', '失去：帳戶 30'])
  })

  it('功能可以註冊自己的效果種類；重複註冊丟錯', () => {
    const { k, ctx } = setup()
    k.effects.register<{ kind: 'sink'; amount: number }>({
      kind: 'sink', owner: 'test',
      validate: (raw) => (Number.isInteger(raw.amount) ? [] : ['amount 要是整數']),
      clamp: (e) => (Math.abs(e.amount) <= 3 ? { effect: e } : { effect: { ...e, amount: Math.sign(e.amount) * 3 }, note: { from: e.amount, to: Math.sign(e.amount) * 3, limit: 3, notice: '沉溺一次最多動 3 點。' } }),
      toChanges: (e, c) => [{ op: 'actor.track', id: c.actor, track: 'sink', delta: e.amount }],
      describe: (e) => `沉溺：${e.amount > 0 ? '往下沉一點' : '往回拉一點'}`,
    })
    expect(k.effects.resolve([{ kind: 'sink', amount: 9 }], ctx).changes).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 3 }])
    expect(() => k.effects.register({ kind: 'sink', owner: 'x', validate: () => [], toChanges: () => [], describe: () => '' })).toThrow(/重複註冊/)
    expect(k.effects.kinds()).toContain('sink')
  })
})

// 規格：EVENTS 2.2 節
describe('L4 條件', () => {
  const test = (state: ReturnType<typeof makeState>, cond: Record<string, unknown>) => {
    const k = createKernel()
    expect(k.conditions.validate(cond)).toEqual([])
    return k.conditions.test(cond as never, { state, stats: k.stats, timeRules: k.timeRules })
  }

  it('旗標、計數器、錢、物品、屬性、基本功、時間', () => {
    const s = makeState({ pc: { attrs: { charm: 16 }, skills: { negotiate: 2 } }, patch: { flags: { met: true, n: 3, off: false }, counters: { kills: 2 }, money: { cred: 100, cash: 20 }, inventory: [{ id: 'it_a', qty: 2 }], time: { day: 14, hour: 21, minute: 0 } } })
    expect(test(s, { kind: 'flag', key: 'met' })).toBe(true)
    expect(test(s, { kind: 'flag', key: 'off' })).toBe(false)
    expect(test(s, { kind: 'flag', key: 'missing' })).toBe(false)
    expect(test(s, { kind: 'flag', key: 'n', eq: 3 })).toBe(true)
    expect(test(s, { kind: 'counter', key: 'kills', min: 2, max: 2 })).toBe(true)
    expect(test(s, { kind: 'counter', key: 'none', min: 1 })).toBe(false)
    expect(test(s, { kind: 'money', wallet: 'total', min: 120 })).toBe(true)
    expect(test(s, { kind: 'money', wallet: 'cash', min: 21 })).toBe(false)
    expect(test(s, { kind: 'has_item', id: 'it_a', min: 2 })).toBe(true)
    expect(test(s, { kind: 'has_item', id: 'it_a', min: 3 })).toBe(false)
    expect(test(s, { kind: 'attr', attr: 'charm', min: 16 })).toBe(true)
    expect(test(s, { kind: 'skill', skill: 'negotiate', min: 3 })).toBe(false)
    expect(test(s, { kind: 'time', segment: ['prime'], weekday: [0] })).toBe(true)
    expect(test(s, { kind: 'time', segment: ['dawn'] })).toBe(false)
  })

  it('組合：all、any、not；沒有條件就是成立', () => {
    const s = makeState({ patch: { flags: { a: true } } })
    expect(test(s, { kind: 'all', of: [{ kind: 'flag', key: 'a' }, { kind: 'not', of: { kind: 'flag', key: 'b' } }] })).toBe(true)
    expect(test(s, { kind: 'any', of: [{ kind: 'flag', key: 'b' }, { kind: 'flag', key: 'c' }] })).toBe(false)
    const k = createKernel()
    expect(k.conditions.test(undefined, { state: s, stats: k.stats, timeRules: k.timeRules })).toBe(true)
  })

  it('格式檢查：沒有的種類、缺欄位都擋下', () => {
    const k = createKernel()
    expect(k.conditions.validate({ kind: 'moon_phase' })[0]).toMatch(/沒有/)
    expect(k.conditions.validate({ kind: 'all', of: [{ kind: 'flag' }] })[0]).toMatch(/requires.of\[0\]/)
    expect(k.conditions.validate({ kind: 'attr', attr: 'luck' })).toHaveLength(1)
    expect(k.conditions.validate({ kind: 'time', segment: ['brunch'] })).toHaveLength(1)
    expect(k.conditions.validate('x')).toHaveLength(1)
  })
})

// 規格：EVENTS 2.4 節（2026-11-21 定案）；AI_TASKS 2.5 節；dev/adr/0007；dev/invariants.md 第 16、29、31 條
describe('L4 效果：誰要的決定夾到哪一級；兩個等級；一件事合計；套得上去才算', () => {
  it('夾到哪一級：內建的照寫的算（builtin）；免夾的只擋格式的底線（floor）；其餘照上限（cap）', () => {
    const e = { kind: 'cash', asked: '一張金卡' }
    expect(effectLevel(e, { source: 'builtin', clampAsked: true })).toBe('builtin')
    expect(effectLevel(e, { source: 'ai', clampAsked: false, playerInput: '給我一張金卡' })).toBe('cap')
    expect(effectLevel(e, { source: 'player', clampAsked: true, playerInput: '給我一張金卡' })).toBe('cap')
    expect(effectLevel(e, { source: 'player', clampAsked: false, playerInput: '給我一張金卡' })).toBe('floor')
    expect(effectLevel(e, { source: 'player', clampAsked: false, playerInput: '我什麼都沒說' })).toBe('cap')
  })

  it('兩個等級：區的等級讀所在那一區的資料；信譽那一階讀衍生數值 rep_grade（街頭信譽的功能註冊；沒有就是 I 級）', () => {
    const k = createKernel()
    k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] })
    k.content.load('district', [{ id: 'crown', grade: 4 }])
    const state = makeState({ patch: { location: { district: 'crown' } } })
    expect(areaGrade(k, state)).toBe(4)
    expect(repGrade(k, state)).toBe(1)
    expect(effectCtx(k, state, { source: 'ai' })).toMatchObject({ actor: 'pc', grade: 4, repGrade: 1, source: 'ai', clampAsked: true })
    // 信譽的功能搬進來之後：註冊 rep_grade，AI 給的錢的上限跟著走；超出 1～5 的夾住
    let rep = 3
    k.stats.defineStat({ id: REP_GRADE_STAT, owner: 'reputation', name: '信譽那一階的委託等級', base: () => rep })
    expect(repGrade(k, state)).toBe(3)
    expect(k.effects.resolve([{ kind: 'cash', amount: 99999 }], effectCtx(k, state, { source: 'ai' })).changes).toEqual([{ op: 'cash', delta: 1200 }])
    expect(k.effects.resolve([{ kind: 'cash', amount: 99999 }], effectCtx(k, state, { source: 'builtin' })).changes).toEqual([{ op: 'cash', delta: 3900 }])
    expect(k.effects.resolve([{ kind: 'cash', amount: 99999 }], effectCtx(k, state, { source: 'builtin', grade: 2 })).changes).toEqual([{ op: 'cash', delta: 360 }])
    rep = 9
    expect(repGrade(k, state)).toBe(5)
    expect(repGrade(k, makeState({ pc: false }))).toBe(1)
  })

  it('功能註冊的效果：budget 是一件事合計的上限（同一組一起算），clamp 看當下的狀態（已經包含前面幾筆）', () => {
    const k = createKernel()
    type Fav = Effect & { faction: string; amount: number }
    const seenLevels: string[] = []
    const favor: EffectDef<Fav> = {
      kind: 'favor', owner: 'test',
      validate: (raw) => (typeof raw.faction === 'string' && Number.isInteger(raw.amount) ? [] : ['要有 faction 與整數的 amount']),
      // 每個勢力各記各的：一件事 ±5
      budget: (e, ctx) => {
        seenLevels.push(ctx.level)
        return ctx.level !== 'cap' ? null : { group: `favor:${e.faction}`, amount: e.amount, min: -5, max: 5, resize: (amount) => ({ ...e, amount }), notice: () => '好感一次只會動一點點。' }
      },
      // 好感最高 100
      clamp: (e, ctx) => {
        const now = (ctx.state.counters[`favor:${e.faction}`] ?? 0)
        const to = Math.min(e.amount, 100 - now)
        return to === e.amount ? { effect: e } : { effect: to === 0 ? null : { ...e, amount: to }, note: { from: e.amount, to, limit: 100, notice: '好感已經到頂了。' } }
      },
      toChanges: (e) => [{ op: 'counter', key: `favor:${e.faction}`, delta: e.amount }],
      describe: (e) => `好感：${e.faction} ${e.amount > 0 ? '上升' : '下降'}`,
    }
    k.effects.register(favor)
    const state = makeState({ patch: { counters: { 'favor:nora': 97 } } })
    const ctx = effectCtx(k, state, { source: 'ai' })
    const r = k.effects.resolve([{ kind: 'favor', faction: 'rose', amount: 4 }, { kind: 'favor', faction: 'nora', amount: 2 }, { kind: 'favor', faction: 'rose', amount: 4 }, { kind: 'favor', faction: 'nora', amount: 2 }], ctx)
    expect(r.changes).toEqual([{ op: 'counter', key: 'favor:rose', delta: 4 }, { op: 'counter', key: 'favor:nora', delta: 2 }, { op: 'counter', key: 'favor:rose', delta: 1 }, { op: 'counter', key: 'favor:nora', delta: 1 }])
    expect(r.clamps.map((c) => [c.path, c.from, c.to, c.notice])).toEqual([['effects[2]', 4, 1, '好感一次只會動一點點。'], ['effects[3]', 2, 1, '好感已經到頂了。']])
    expect(state.counters).toEqual({ 'favor:nora': 97 })
    // 內建的不算合計，但當下的狀態照樣管
    const built = k.effects.resolve([{ kind: 'favor', faction: 'rose', amount: 40 }, { kind: 'favor', faction: 'rose', amount: 80 }], effectCtx(k, state, { source: 'builtin' }))
    expect(built.changes).toEqual([{ op: 'counter', key: 'favor:rose', delta: 40 }, { op: 'counter', key: 'favor:rose', delta: 60 }])
    expect(new Set(seenLevels)).toEqual(new Set(['cap', 'builtin']))
  })

  it('套得上去才算：轉出來的變更在複製的狀態上驗過；套不上去的是格式錯誤（整批不收），不會到套用才丟錯', () => {
    const k = createKernel()
    k.effects.register({ kind: 'spend_counter', owner: 'test', validate: () => [], toChanges: (e) => [{ op: 'cash', delta: -(e.amount as number) }], describe: () => '花掉' })
    const state = makeState({ patch: { money: { cred: 0, cash: 10 } } })
    const ctx = effectCtx(k, state, { source: 'ai' })
    expect(k.effects.resolve([{ kind: 'spend_counter', amount: 6 }], ctx).changes).toEqual([{ op: 'cash', delta: -6 }])
    const r = k.effects.resolve([{ kind: 'spend_counter', amount: 6 }, { kind: 'spend_counter', amount: 6 }], ctx)
    expect(r).toMatchObject({ changes: [], effects: [], lines: [] })
    expect(r.errors).toEqual(['effects[1]：changes[0]（cash）：現金不夠：有 4，要扣 6'])
    // 呼叫的人接著要套的變更（tail）也一起驗
    const tail = k.effects.resolve([{ kind: 'spend_counter', amount: 6 }], { ...ctx, tail: [{ op: 'cash', delta: -5 }] })
    expect(tail.errors[0]).toMatch(/加上這次行動其餘的變更之後套不上去/)
    expect(k.effects.resolve([{ kind: 'spend_counter', amount: 6 }], { ...ctx, tail: [{ op: 'cash', delta: -4 }] }).errors).toEqual([])
    expect(state.money.cash).toBe(10)
  })

  it('行動的總時間：有給 action 時，time 效果合計之後連同判定的時間受上限管；沒有給（事件）不夾', () => {
    const k = createKernel()
    const state = makeState()
    const free = effectCtx(k, state, { source: 'ai' })
    expect(k.effects.resolve([{ kind: 'time', hours: 100 }], free)).toMatchObject({ changes: [{ op: 'time', minutes: 6000 }], clamps: [] })
    const act = effectCtx(k, state, { source: 'ai', action: { minutes: 30, maxMinutes: 240 } })
    const r = k.effects.resolve([{ kind: 'time', hours: 2 }, { kind: 'time', hours: 2 }], act)
    expect(r.changes).toEqual([{ op: 'time', minutes: 120 }, { op: 'time', minutes: 90 }])
    expect(r.lines).toEqual(['時間：過了 2 小時', '時間：過了 1 小時 30 分鐘'])
    expect(r.clamps[0]).toMatchObject({ path: 'effects[1]', from: 120, to: 90, limit: 210, notice: '這件事最多花 4 小時，所以只再多花了 1 小時 30 分鐘。' })
    // 判定已經把時間用完：結算的 time 整筆拿掉
    const used = k.effects.resolve([{ kind: 'time', hours: 1 }], effectCtx(k, state, { source: 'ai', action: { minutes: 240, maxMinutes: 240 } }))
    expect(used).toMatchObject({ changes: [], lines: [] })
    expect(used.clamps[0]!.notice).toBe('這件事最多花 4 小時，沒有再多花時間。')
    // 內建的結算不受上限管
    expect(k.effects.resolve([{ kind: 'time', hours: 100 }], effectCtx(k, state, { source: 'builtin', action: { minutes: 30, maxMinutes: 240 } })).clamps).toEqual([])
  })
})
