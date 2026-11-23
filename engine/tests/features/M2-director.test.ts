// 驗收測試：dev/work/M2-director.md（cpp-feature）。規格：EVENTS 第 1 節、2.1、2.2 節、第 3 節（觸發點、流程、機率與冷卻、排序與上限、類型平衡、佇列）、第 6 節（內容篩選）、第 7 節；
// dev/adr/0016 第二節（triggers）、第四節、第六節（time.passed 的順序）。
// 內容一律用測試自帶的最小假資料；事件視窗與副本用替身活動（kind 是 event、commission），照 0016 登記。
// 量表（敵對值、豔名）還在核心工單裡，權重的修正用旗標的條件代替。
//
// 預設的假資料：範圍 street（enter_block 機率 1、冷卻 0、不重複 0、輸了就作廢）、事件 ev_a（街頭、enter_block）。
// 起點是第 3 天（週四）10:00（上午）；每個「回合」是一個走 5 分鐘的行動，可以帶觸發點。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Report, ReportDraft, ReportTrigger } from '../../src'
import { ActionBlocked, ContentError, toMinutes } from '../../src'
import { addEventBodyCheck, categoryFactor, directorFeature, directorOf, directorView, eligibleEvents, eventWeight, runPasses, scopeOf } from '../../src/features/director'
import { TEST_ACTIVITY, makeGame, observed } from '../../src/testkit'

// ---- 替身：事件視窗（kind 是 event）與副本（kind 是 commission） ----

const STUB_EXT = 'event_stub'
const eventStub: Feature = {
  id: 'event_stub',
  install(k) {
    k.activity.define({
      kind: 'event', owner: 'event_stub', order: 30,
      active: (s) => (s.ext[STUB_EXT] ? { id: 'ev1', label: '事件視窗' } : null),
      allow: ['event.', 'commit:event.', 'commit:test.'],
      reason: () => '先回應事件。',
      start(_k, state, setup, origin) {
        if (state.flags.stub_refuse) throw new ActionBlocked('事件視窗現在開不起來。')
        return [{ kind: 'event', action: 'event.start', location: { ...state.location }, party: [], timeline: [], changes: [{ op: 'ext', key: STUB_EXT, value: { setup, origin } }], outcome: { result: 'open', summary: '事件視窗開了。' } }]
      },
    })
  },
}
const commissionStub: Feature = {
  id: 'commission_stub',
  install(k) {
    k.activity.define({
      kind: 'commission', owner: 'commission_stub', order: 90,
      active: (s) => (s.flags.in_commission ? { id: 'c1', label: '委託副本' } : null),
      allow: ['event.', 'commit:event.', 'commit:test.'],
      reason: () => '副本進行中。',
    })
  },
}

// ---- 假資料 ----

const scope = (id: string, o: Record<string, unknown> = {}) => ({ id, triggers: { enter_block: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop', ...o })
const ev = (id: string, sc = 'street', o: Record<string, unknown> = {}) => ({ id, scope: sc, triggers: ['enter_block'], ...o })
const note = (id: string, sc = 'street', o: Record<string, unknown> = {}) => ev(id, sc, { blocking: false, text: `通知 ${id}`, ...o })

type Content = Record<string, Array<Record<string, unknown>>>
const pack = (c: Content = {}): ContentPack => ({ id: 'director_test', content: { event_scope: [scope('street')], event: [ev('ev_a')], ...c } as ContentPack['content'] })

interface Opts { content?: Content; features?: Feature[]; seed?: number; time?: GameState['time']; flags?: Record<string, boolean | number | string> }
const START = { day: 3, hour: 10, minute: 0 }
const make = (o: Opts = {}) =>
  makeGame({
    features: o.features ?? [directorFeature, eventStub, commissionStub], content: [pack(o.content)],
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    patch: { time: o.time ?? START, ...(o.flags ? { flags: o.flags } : {}) },
  }).game
type G = ReturnType<typeof make>

const draftOf = (action: string, changes: ReportDraft['changes'], extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'action', action, location: { district: 'test', block: 'empty_room' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: action }, ...extra,
})
/** 一個回合：走 5 分鐘（可以改），帶觸發點。 */
const step = (g: G, triggers: ReportTrigger[] = [{ point: 'enter_block' }], minutes = 5): Report[] => g.commit(draftOf('test.step', [{ op: 'time', minutes }], { triggers }))
const setFlag = (g: G, key: string, value: boolean | number | string | null = true) => g.commit(draftOf('test.flag', [{ op: 'flag', key, value }]), { turn: false })
const setTime = (g: G, to: GameState['time']) => g.commit(draftOf('test.time', [{ op: 'time', minutes: toMinutes(to) - toMinutes(g.state.time) }]), { turn: false })
const close = (g: G) => g.commit(draftOf('event.close', [{ op: 'ext', key: STUB_EXT, value: null }]), { turn: false })
const opened = (g: G): string | null => ((g.state.ext[STUB_EXT] as { setup: { event: string } } | undefined)?.setup.event ?? null)
const notices = (rs: Report[]): string[] => rs.filter((r) => r.action === 'event.notice').map((r) => String(r.timeline[0]!.data!.event))
/** 走一個回合，回傳放行了哪一件擋住型的事件（沒有是 null）；放行了就關掉事件視窗，下一個回合才又擲得到。 */
const fire = (g: G, triggers?: ReportTrigger[], minutes?: number): string | null => {
  step(g, triggers, minutes)
  const id = opened(g)
  if (id) close(g)
  return id
}
const view = (g: G) => directorView(g.state)

// ---- 放行 ----

describe('放行：機率與事件視窗', () => {
  it('機率 1 的範圍、一件符合的事件：帶那個觸發點的回合之後，事件視窗的替身活動開起來；origin 是導演、帶範圍與觸發點', () => {
    const g = make()
    const rs = step(g)
    expect(opened(g)).toBe('ev_a')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event'])
    expect(rs.map((r) => r.action)).toEqual(['test.step', 'event.start'])
    expect(g.state.ext[STUB_EXT]).toMatchObject({ setup: { event: 'ev_a' }, origin: { by: 'director', ext: { scope: 'street', trigger: 'enter_block' } } })
  })

  it('機率 0 的不開；回合沒有帶觸發點也不開；範圍的表裡沒有這個觸發點也不開', () => {
    const g = make({ content: { event_scope: [scope('street', { triggers: { enter_block: 0 } })] } })
    step(g)
    expect(opened(g)).toBeNull()
    const h = make()
    step(h, [])
    step(h, [{ point: 'walk' }])
    expect(opened(h)).toBeNull()
    expect(directorOf(h.state).scopes).toEqual({})
  })

  it('放行之後記下：冷卻、今天的件數、這件事上次的日子、類型；報告的紀錄不變式成立', async () => {
    const g = make({ content: { event_scope: [scope('street', { cooldown_hours: 2 })], event: [ev('ev_a', 'street', { category: 'trouble' })] } })
    const { violations } = await observed(g, () => step(g))
    expect(violations).toEqual([])
    const d = directorOf(g.state)
    expect(d.scopes.street).toEqual({ until: toMinutes(START) + 5 + 120, day: 3, count: 1 })
    expect(d.seen.ev_a).toBe(3)
    expect(d.recent).toEqual(['trouble'])
    expect(d.city).toEqual({ day: 3, blocking: 1 })
  })

  it('同一個種子、同一串動作：放行的事件一模一樣；換一個種子會不一樣；回退再做一次也一樣', () => {
    const content: Content = { event_scope: [scope('street', { triggers: { enter_block: 0.5 } })], event: [ev('e1', 'street', { weight: 1 }), ev('e2', 'street', { weight: 1 }), ev('e3', 'street', { weight: 2 })] }
    const run = (seed: number): Array<string | null> => {
      const g = make({ content, seed })
      return Array.from({ length: 24 }, () => fire(g, undefined, 30))
    }
    const a = run(11)
    expect(run(11)).toEqual(a)
    expect(a.filter(Boolean).length).toBeGreaterThan(4)
    expect(new Set(a.filter(Boolean)).size).toBeGreaterThan(1)
    expect([3, 5, 8, 13].map(run).some((x) => JSON.stringify(x) !== JSON.stringify(a))).toBe(true)
    // 回退再做一次
    const g = make({ content, seed: 11 })
    const first: Array<string | null> = []
    for (let i = 0; i < 12; i++) {
      step(g, undefined, 30)
      first.push(opened(g))
      expect(g.undoSteps(1)).toBe(true)
      step(g, undefined, 30)
      expect(opened(g)).toBe(first[i])
      if (opened(g)) close(g)
    }
  })
})

describe('冷卻', () => {
  it('冷卻內第二次觸發不擲；過了冷卻又擲；directorView 看得到還剩多久', () => {
    const g = make({ content: { event_scope: [scope('street', { cooldown_hours: 2 })] } })
    expect(fire(g)).toBe('ev_a')
    expect(view(g).scopes.street!.cooldown_left).toBe(120) // 從放行的那一刻（走完 5 分鐘之後）起算
    expect(fire(g)).toBeNull()
    expect(fire(g, undefined, 60)).toBeNull()
    expect(view(g).scopes.street!.cooldown_left).toBe(55)
    expect(fire(g, undefined, 55)).toBe('ev_a') // 剛好走到冷卻結束的那一刻
    expect(view(g).scopes.street!.today).toBe(2)
  })

  it('篩完沒有事件時冷卻不動：之後條件成立馬上就擲得到', () => {
    const g = make({ content: { event_scope: [scope('street', { cooldown_hours: 6 })], event: [ev('ev_a', 'street', { requires: { kind: 'flag', key: 'ready' } })] } })
    expect(fire(g)).toBeNull()
    expect(directorOf(g.state).scopes).toEqual({})
    expect(view(g).scopes).toEqual({})
    setFlag(g, 'ready')
    expect(fire(g)).toBe('ev_a')
  })

  it('每天的上限：範圍今天放行滿了就不擲，隔天重算', () => {
    const g = make({ content: { event_scope: [scope('street', { daily_cap: 2 })] } })
    expect([fire(g), fire(g), fire(g)]).toEqual(['ev_a', 'ev_a', null])
    setTime(g, { day: 4, hour: 9, minute: 0 })
    expect(fire(g)).toBe('ev_a')
  })
})

// ---- 篩選 ----

describe('篩選：where、when、requires、被關掉的標籤、repeat_days 各一條擋下的例子', () => {
  const only = (e: Record<string, unknown>, o: Opts = {}) => make({ ...o, content: { event: [ev('ev_a', 'street', e)], ...o.content } })

  it('where：每個鍵對觸發點的 where 與目前的位置；陣列是任一個；寫複數的鍵（blocks）也認單數', () => {
    const g = only({ where: { block: ['b2', 'b3'] } })
    expect(fire(g, [{ point: 'enter_block', where: { block: 'b1' } }])).toBeNull()
    expect(fire(g, [{ point: 'enter_block', where: { block: 'b3' } }])).toBe('ev_a')
    const plural = only({ where: { blocks: ['uptown'] } })
    expect(fire(plural, [{ point: 'enter_block', where: { block: 'downtown' } }])).toBeNull()
    expect(fire(plural, [{ point: 'enter_block', where: { block: 'uptown' } }])).toBe('ev_a')
    // 觸發點沒有帶的鍵，看 state.location；兩邊都沒有就不成立
    const loc = only({ where: { district: 'test' } })
    expect(fire(loc)).toBe('ev_a')
    const missing = only({ where: { facility: 'bar' } })
    expect(fire(missing)).toBeNull()
    // 每個鍵都要對上
    const both = only({ where: { district: 'test', block: 'b2' } })
    expect(fire(both, [{ point: 'enter_block', where: { block: 'b1' } }])).toBeNull()
    expect(fire(both, [{ point: 'enter_block', where: { block: 'b2' } }])).toBe('ev_a')
  })

  it('when：時段與星期（0 是週一）', () => {
    const night = only({ when: { time: ['prime', 'late'] } })
    expect(fire(night)).toBeNull() // 上午 10 點
    setTime(night, { day: 3, hour: 20, minute: 0 })
    expect(fire(night)).toBe('ev_a')
    const monday = only({ when: { weekday: [0] } })
    expect(fire(monday)).toBeNull() // 第 3 天是週四
    setTime(monday, { day: 7, hour: 12, minute: 0 })
    expect(fire(monday)).toBe('ev_a')
    const both = only({ when: { time: ['morning'], weekday: [3] } })
    expect(fire(both)).toBe('ev_a')
  })

  it('requires：問 k.conditions（單一條件或條件的陣列，全部成立）', () => {
    const g = only({ requires: { kind: 'flag', key: 'ok' } })
    expect(fire(g)).toBeNull()
    setFlag(g, 'ok')
    expect(fire(g)).toBe('ev_a')
    const all = only({ requires: [{ kind: 'flag', key: 'a' }, { kind: 'flag', key: 'b' }] })
    setFlag(all, 'a')
    expect(fire(all)).toBeNull()
    setFlag(all, 'b')
    expect(fire(all)).toBe('ev_a')
  })

  it('玩家關掉的標籤：帶著它的事件不抽；關掉別的標籤不影響；重新打開又抽得到', () => {
    const g = only({ tags: ['ntr', 'intimate_body'] })
    g.commit(draftOf('test.rules', [{ op: 'rules', patch: { contentOff: ['ntr'] } }]), { turn: false })
    expect(g.state.rules.contentOff).toEqual(['ntr'])
    expect(fire(g)).toBeNull()
    g.commit(draftOf('test.rules', [{ op: 'rules', patch: { contentOff: ['pc_unwilling'] } }]), { turn: false })
    expect(fire(g)).toBe('ev_a')
    g.commit(draftOf('test.rules', [{ op: 'rules', patch: { contentOff: [] } }]), { turn: false })
    expect(fire(g)).toBe('ev_a')
  })

  it('repeat_days：這件事幾天內不再出現（寫在事件上蓋掉範圍的預設）；到了那一天又可以', () => {
    const g = make({ content: { event_scope: [scope('street', { repeat_days: 3 })], event: [ev('ev_a'), ev('ev_b', 'street', { weight: 0.0001, repeat_days: 0 })] } })
    expect(fire(g)).toBe('ev_a') // 第 3 天
    // 之後 ev_a 不抽，只剩 ev_b（它自己寫了不限）
    expect(fire(g)).toBe('ev_b')
    setTime(g, { day: 4, hour: 10, minute: 0 })
    expect(fire(g)).toBe('ev_b')
    setTime(g, { day: 5, hour: 10, minute: 0 })
    expect(fire(g)).toBe('ev_b')
    setTime(g, { day: 6, hour: 10, minute: 0 })
    expect(fire(g)).toBe('ev_a') // 第 6 天離上次 3 天：ev_a 又在候選裡（ev_b 的權重小到幾乎抽不到）
    expect(directorOf(g.state).seen.ev_a).toBe(6)
  })

  it('篩完剩下的是空的：eligibleEvents 回傳空陣列；範圍與觸發點對不上的事件不進候選', () => {
    const g = make({ content: { event_scope: [scope('street'), scope('transit', { triggers: { transit_stop: 1 } })], event: [ev('ev_a'), ev('ev_t', 'transit', { triggers: ['transit_stop'] })] } })
    const street = scopeOf(g.k, 'street')!
    expect(eligibleEvents(g.k, g.state, street, 'enter_block').map((e) => e.id)).toEqual(['ev_a'])
    expect(eligibleEvents(g.k, g.state, street, 'transit_stop')).toEqual([])
  })
})

// ---- 權重 ----

describe('權重與類型平衡', () => {
  const withRecent = (g: G, recent: string[]) => g.commit(draftOf('test.recent', [{ op: 'ext', key: 'director', value: { ...directorOf(g.state), recent } }]), { turn: false })
  const weightOf = (g: G, id: string) => eventWeight(g.k, g.state, g.k.content.get('event', id) as never)

  it('權重 ＝ weight × 成立的 weight_mods × 類型平衡；沒寫 weight 是 1', () => {
    const g = make({ content: { event: [ev('ev_a', 'street', { weight: 4, weight_mods: [{ if: { kind: 'flag', key: 'hot' }, mult: 2 }, { if: { kind: 'flag', key: 'cold' }, mult: 0.5 }] }), ev('ev_b')] } })
    expect(weightOf(g, 'ev_a')).toBe(4)
    expect(weightOf(g, 'ev_b')).toBe(1)
    setFlag(g, 'hot')
    expect(weightOf(g, 'ev_a')).toBe(8)
    setFlag(g, 'cold')
    expect(weightOf(g, 'ev_a')).toBe(4)
  })

  it('最近六件都是同一類時，那一類的候選權重是 0.35 的六次方倍；別的類型與沒有類型的不受影響', () => {
    const g = make({ content: { event: [ev('ev_t', 'street', { category: 'trouble' }), ev('ev_o', 'street', { category: 'opportunity' }), ev('ev_n')] } })
    withRecent(g, Array(6).fill('trouble'))
    expect(weightOf(g, 'ev_t')).toBeCloseTo(0.35 ** 6, 12)
    expect(weightOf(g, 'ev_o')).toBe(1)
    expect(weightOf(g, 'ev_n')).toBe(1)
    withRecent(g, ['trouble', 'opportunity', 'trouble', 'rumor'])
    expect(weightOf(g, 'ev_t')).toBeCloseTo(0.35 ** 2, 12)
    expect(categoryFactor(g.k, g.state, undefined)).toBe(1)
  })

  it('只記最近 category_recent 件：更早的不算；放行之後類型被記下、超過六件擠掉最舊的', () => {
    const g = make({ content: { event_scope: [scope('street')], event: [ev('ev_t', 'street', { category: 'trouble' })] } })
    withRecent(g, ['trouble', 'trouble', 'rumor', 'rumor', 'rumor', 'rumor', 'rumor', 'rumor'])
    expect(weightOf(g, 'ev_t')).toBe(1) // 最近六件裡沒有 trouble
    fire(g)
    expect(directorOf(g.state).recent.slice(-6)).toEqual(['rumor', 'rumor', 'rumor', 'rumor', 'rumor', 'trouble'])
    expect(weightOf(g, 'ev_t')).toBeCloseTo(0.35, 12)
  })

  it('抽選照權重：9 比 1 的兩件，多個種子抽下來多的那件佔大多數；權重 0（含修正成 0）的不會被抽到', () => {
    const tally = { heavy: 0, light: 0 }
    for (let seed = 1; seed <= 80; seed++) {
      const g = make({ seed, content: { event: [ev('heavy', 'street', { weight: 9 }), ev('light')] } })
      tally[fire(g) as 'heavy' | 'light'] += 1
    }
    expect(tally.heavy + tally.light).toBe(80)
    expect(tally.heavy).toBeGreaterThan(55)
    expect(tally.light).toBeGreaterThan(0)
    const g = make({ content: { event: [ev('zero', 'street', { weight: 0 }), ev('muted', 'street', { weight_mods: [{ if: { kind: 'flag', key: 'mute' }, mult: 0 }] })] } })
    setFlag(g, 'mute')
    expect(fire(g)).toBeNull()
    expect(directorOf(g.state).scopes).toEqual({})
  })
})

// ---- 排序與上限 ----

describe('一回合三個範圍都擲中擋住型：只放行一件', () => {
  const three = (a: Record<string, unknown>, b: Record<string, unknown>, c: Record<string, unknown>): Content => ({
    event_scope: [scope('sa', a), scope('sb', b), scope('sc', c)],
    event: [ev('ea', 'sa'), ev('eb', 'sb'), ev('ec', 'sc')],
  })

  it('有優先序的贏；其餘照 lost 作廢或延後（延後的記在 deferred，作廢的不留，也不吃冷卻）', () => {
    const g = make({ content: three({ priority: 2, lost: 'defer' }, { priority: 1, lost: 'drop' }, { lost: 'defer' }) })
    step(g)
    expect(opened(g)).toBe('eb')
    expect(g.k.activity.active(g.state)).toHaveLength(1)
    const d = directorOf(g.state)
    expect(d.deferred.map((q) => q.event)).toEqual(['ea', 'ec'])
    expect(Object.keys(d.scopes)).toEqual(['sb'])
    expect(view(g).deferred).toBe(2)
  })

  it('優先序小的先：數字 1 贏過 2；沒有優先序的輸給有優先序的', () => {
    const g = make({ content: three({ priority: 2 }, {}, { priority: 3 }) })
    step(g)
    expect(opened(g)).toBe('ea')
  })

  it('都沒有優先序：隨機留一個（同一個種子一樣），不同種子留的不同；每次只放行一件', () => {
    const winners = new Set<string | null>()
    for (let seed = 1; seed <= 30; seed++) {
      const g = make({ seed, content: three({}, {}, {}) })
      step(g)
      const w = opened(g)
      expect(w).not.toBeNull()
      winners.add(w)
      expect(g.k.activity.active(g.state)).toHaveLength(1)
      expect(directorOf(g.state).deferred).toEqual([])
      const again = make({ seed, content: three({}, {}, {}) })
      step(again)
      expect(opened(again)).toBe(w)
    }
    expect(winners.size).toBeGreaterThan(1)
  })
})

describe('延後與排隊', () => {
  const lostDefer: Content = { event_scope: [scope('street', { lost: 'defer', defer_hours: 3 }), scope('other', { priority: 1 })], event: [ev('ev_a'), ev('ev_o', 'other')] }

  it('下一個可以放行的回合先放延後的（不是新的候選）；放行之後從延後裡拿掉並吃冷卻', () => {
    const g = make({ content: lostDefer })
    step(g) // other 贏，street 的 ev_a 延後
    expect(opened(g)).toBe('ev_o')
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    close(g)
    // 這一回合 other 與 street 又都擲中：先放延後的 ev_a，這一回合的新候選照 lost 處理
    step(g, [{ point: 'enter_block' }])
    expect(opened(g)).toBe('ev_a')
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual([]) // 新的 ev_a 已經是放出去的那件，不再延後
  })

  it('這一回合有別的活動進行中（玩具活動）：擋住型的全部延後；副本不算別的活動', () => {
    const h = make({ features: [directorFeature, eventStub, TEST_ACTIVITY], content: { event_scope: [scope('street', { lost: 'drop' })], event: [ev('ev_a')] } })
    h.launch('toy', {})
    h.commit(draftOf('toy.step', [{ op: 'time', minutes: 5 }], { triggers: [{ point: 'enter_block' }] }))
    expect(opened(h)).toBeNull()
    expect(directorOf(h.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    expect(directorOf(h.state).scopes).toEqual({})
  })

  it('報告自己帶著要開的活動：擋住型的全部延後，等活動做完再放', () => {
    const h = make({ features: [directorFeature, eventStub, TEST_ACTIVITY], content: { event_scope: [scope('street')], event: [ev('ev_a')] } })
    h.commit(draftOf('test.step', [{ op: 'time', minutes: 5 }], { triggers: [{ point: 'enter_block' }], launch: [{ kind: 'toy', setup: {} }] }))
    expect(opened(h)).toBeNull()
    expect(directorOf(h.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    expect(h.k.activity.active(h.state).map((a) => a.kind)).toEqual(['toy'])
  })

  it('事件視窗開著時再有觸發點：延後；關掉之後的下一個回合（沒有觸發點也行）放出延後的', () => {
    const g = make()
    step(g)
    expect(opened(g)).toBe('ev_a')
    step(g)
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    expect(directorOf(g.state).scopes.street!.count).toBe(1) // 延後的不算放行
    close(g)
    step(g, [])
    expect(opened(g)).toBe('ev_a')
    expect(directorOf(g.state).deferred).toEqual([])
    expect(directorOf(g.state).scopes.street!.count).toBe(2)
  })

  it('延後的到期作廢、不吃冷卻', () => {
    const g = make({ content: { event_scope: [scope('street', { lost: 'defer', defer_hours: 3, cooldown_hours: 10 }), scope('first', { priority: 1 })], event: [ev('ev_a'), ev('ev_f', 'first')] } })
    step(g)
    expect(opened(g)).toBe('ev_f')
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    // 視窗一直開著，過了 3 小時還沒有機會放：作廢
    g.commit(draftOf('test.step', [{ op: 'time', minutes: 200 }]))
    expect(view(g).deferred).toBe(0)
    close(g)
    step(g, [])
    expect(directorOf(g.state).deferred).toEqual([])
    expect(opened(g)).toBeNull()
    expect(directorOf(g.state).scopes.street).toBeUndefined() // street 從來沒放行過，冷卻沒有動
  })

  it('沒有人登記事件視窗：擋住型的事件改成排隊，不丟錯；之後有人登記了就放出來', () => {
    const g = make({ features: [directorFeature] })
    expect(() => step(g)).not.toThrow()
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    expect(directorOf(g.state).scopes).toEqual({})
    // 同一件事不重複排
    step(g)
    expect(directorOf(g.state).deferred).toHaveLength(1)
    g.k.activity.define({ kind: 'event', owner: 'late', order: 30, active: (s) => (s.ext[STUB_EXT] ? { id: 'x', label: '事件' } : null), allow: ['commit:test.'], reason: () => '先回應事件。', start: (_k, s) => [{ kind: 'event', action: 'event.start', location: { ...s.location }, party: [], timeline: [], changes: [{ op: 'ext', key: STUB_EXT, value: { setup: { event: 'late' } } }], outcome: { result: 'open', summary: '開了' } }] })
    step(g, [])
    expect(directorOf(g.state).deferred).toEqual([])
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event'])
    expect(directorOf(g.state).scopes.street!.count).toBe(1)
  })

  it('事件視窗自己現在開不起來（ActionBlocked）：不丟錯、不吃冷卻，改成延後', () => {
    const g = make({ flags: { stub_refuse: true } })
    expect(() => step(g)).not.toThrow()
    expect(opened(g)).toBeNull()
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    expect(directorOf(g.state).scopes).toEqual({})
    setFlag(g, 'stub_refuse', null)
    step(g, [])
    expect(opened(g)).toBe('ev_a')
  })

  it('範圍的 defer_hours 沒寫時留 6 小時', () => {
    const g = make({ features: [directorFeature] })
    step(g)
    const q = directorOf(g.state).deferred[0]!
    expect(q.until - q.from).toBe(6 * 60)
  })
})

describe('城裡一天的上限', () => {
  const street: Content = { event_scope: [scope('street'), scope('inside', { triggers: { stage: 1 }, in_commission: true })], event: [ev('ev_a'), ev('ev_in', 'inside', { triggers: ['stage'] })] }

  it('城裡一天第 9 件擋住型不放行；隔天重算', () => {
    const g = make({ content: street })
    const out = Array.from({ length: 10 }, () => fire(g))
    expect(out.slice(0, 8)).toEqual(Array(8).fill('ev_a'))
    expect(out.slice(8)).toEqual([null, null])
    expect(view(g).today.city_blocking).toBe(8)
    expect(directorOf(g.state).deferred).toEqual([])
    setTime(g, { day: 4, hour: 10, minute: 0 })
    expect(fire(g)).toBe('ev_a')
  })

  it('副本內的不算在 8 件裡，副本內的範圍到了上限也照放', () => {
    const g = make({ content: street })
    setFlag(g, 'in_commission')
    expect([fire(g, [{ point: 'stage' }]), fire(g, [{ point: 'stage' }]), fire(g, [{ point: 'stage' }])]).toEqual(['ev_in', 'ev_in', 'ev_in'])
    expect(view(g).today.city_blocking).toBe(0)
    setFlag(g, 'in_commission', null)
    expect(Array.from({ length: 8 }, () => fire(g)).every((x) => x === 'ev_a')).toBe(true)
    expect(fire(g)).toBeNull()
    expect(view(g).today).toMatchObject({ released: 11, city_blocking: 8 })
    setFlag(g, 'in_commission')
    expect(fire(g, [{ point: 'stage' }])).toBe('ev_in')
  })

  it('event_rule 可以蓋掉上限（資料蓋掉預設）', () => {
    const g = make({ content: { ...street, event_rule: [{ id: 'default', city_daily_blocking: 2 }] } })
    expect([fire(g), fire(g), fire(g)]).toEqual(['ev_a', 'ev_a', null])
  })

  it('延後的事件也受城裡的上限管：滿了就留著，到期作廢', () => {
    const g = make({ content: { event_scope: [scope('street', { lost: 'defer', defer_hours: 5 }), scope('first', { priority: 1 })], event: [ev('ev_a'), ev('ev_f', 'first')], event_rule: [{ id: 'default', city_daily_blocking: 1 }] } })
    step(g)
    expect(opened(g)).toBe('ev_f')
    close(g)
    step(g, [])
    expect(opened(g)).toBeNull()
    expect(view(g).deferred).toBe(1)
  })
})

describe('副本進行中', () => {
  const content: Content = { event_scope: [scope('street'), scope('inside', { triggers: { stage: 1, enter_block: 0 }, in_commission: true })], event: [ev('ev_a'), ev('ev_in', 'inside', { triggers: ['stage'] })] }

  it('有 commission 的替身活動進行時，街頭的範圍不擲、in_commission 的照擲；副本不算「別的活動」，擋住型照放', () => {
    const g = make({ content })
    setFlag(g, 'in_commission')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])
    expect(fire(g)).toBeNull()
    expect(directorOf(g.state).scopes).toEqual({})
    expect(fire(g, [{ point: 'stage' }])).toBe('ev_in')
    setFlag(g, 'in_commission', null)
    expect(fire(g)).toBe('ev_a')
  })

  it('副本裡別的範圍延後的事件留著不放，出了副本才放', () => {
    const g = make({ content: { event_scope: [scope('street', { lost: 'defer', defer_hours: 24 }), scope('first', { priority: 1 })], event: [ev('ev_a'), ev('ev_f', 'first')] } })
    step(g)
    close(g)
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
    setFlag(g, 'in_commission')
    step(g, [])
    expect(opened(g)).toBeNull()
    expect(view(g).deferred).toBe(1)
    setFlag(g, 'in_commission', null)
    step(g, [])
    expect(opened(g)).toBe('ev_a')
  })
})

// ---- 通知 ----

describe('不擋的事件（通知）', () => {
  const sc = (id: string, o: Record<string, unknown> = {}) => scope(id, o)

  it('當場出一份 event.notice、效果套上去；不開事件視窗、不佔擋住的名額；類型與冷卻照記', () => {
    const g = make({ content: { event: [note('n1', 'street', { effects: [{ kind: 'cash', amount: 50 }], category: 'rumor' })] } })
    const rs = step(g)
    expect(notices(rs)).toEqual(['n1'])
    const r = rs.find((x) => x.action === 'event.notice')!
    expect(r.kind).toBe('event')
    expect(r.outcome).toMatchObject({ result: 'notice', summary: '通知 n1' })
    expect(r.timeline[0]!.data).toEqual({ event: 'n1', scope: 'street', trigger: 'enter_block' })
    expect(g.state.money.cash).toBe(50)
    expect(opened(g)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(directorOf(g.state)).toMatchObject({ recent: ['rumor'], city: { day: 0, blocking: 0 }, scopes: { street: { count: 1 } } })
  })

  it('一回合最多兩則，第三則排到下一回合；擋住型的另外算（一回合一件擋住加兩則通知）', () => {
    const g = make({ content: { event_scope: [sc('s1'), sc('s2'), sc('s3'), sc('s4')], event: [note('n1', 's1'), note('n2', 's2'), note('n3', 's3'), ev('blk', 's4')] } })
    const rs = step(g)
    expect(notices(rs)).toEqual(['n1', 'n2'])
    expect(opened(g)).toBe('blk')
    expect(view(g).notices).toBe(1)
    expect(directorOf(g.state).notices.map((q) => q.event)).toEqual(['n3'])
    close(g)
    const next = step(g, [])
    expect(notices(next)).toEqual(['n3'])
    expect(view(g).notices).toBe(0)
  })

  it('排隊的通知先放、再放新的；通知的件數與效果在同一回合裡一起算（錢不夠扣就是不夠，不會兩則各算各的）', () => {
    const g = make({ content: { event_scope: [sc('s1'), sc('s2')], event: [note('n1', 's1', { effects: [{ kind: 'cash', amount: 60 }] }), note('n2', 's2', { effects: [{ kind: 'cash', amount: -50 }] })] } })
    const rs = step(g)
    expect(notices(rs)).toEqual(['n1', 'n2'])
    expect(g.state.money.cash).toBe(10)
  })

  it('通知的內文用 effects 的格式檢查：效果不在封閉清單裡，整批擋下並寫出是哪一件', () => {
    expect(() => make({ content: { event: [note('n1', 'street', { effects: [{ kind: 'no_such_effect' }] })] } })).toThrow(/event\/n1/)
  })

  it('副本裡只收 in_commission 範圍的通知；其餘排隊等出副本', () => {
    const g = make({ content: { event_scope: [sc('street', { defer_hours: 48 }), sc('inside', { triggers: { stage: 1 }, in_commission: true })], event: [note('n_st', 'street'), note('n_in', 'inside', { triggers: ['stage'] })] } })
    setFlag(g, 'in_commission')
    expect(notices(step(g, [{ point: 'stage' }]))).toEqual(['n_in'])
    expect(notices(step(g))).toEqual([]) // 街頭的範圍不擲
    setFlag(g, 'in_commission', null)
    expect(notices(step(g))).toEqual(['n_st'])
  })

  it('成人的通知：報告記上 adult', () => {
    const g = make({ content: { event: [note('n1', 'street', { adult: true })] } })
    const rs = step(g)
    expect(rs.find((r) => r.action === 'event.notice')!.adult).toBe(true)
    expect(rs[0]!.adult).toBeUndefined()
  })

  it('不變式：通知與放行的報告套用之後等於實際的變化', async () => {
    const g = make({ content: { event_scope: [sc('s1'), sc('s2')], event: [note('n1', 's1', { effects: [{ kind: 'cash', amount: 20 }] }), ev('blk', 's2')] } })
    const { violations } = await observed(g, () => step(g))
    expect(violations).toEqual([])
  })
})

// ---- 每天、每週 ----

describe('time.passed：daily 與 weekly', () => {
  const clock: Content = {
    event_scope: [scope('chores', { triggers: { daily: 1 }, defer_hours: 48 }), scope('rent', { triggers: { weekly: 1 } })],
    event: [note('daily_n', 'chores', { triggers: ['daily'] }), note('weekly_n', 'rent', { triggers: ['weekly'] })],
  }
  const sleep = (g: G, to: GameState['time']): Report[] => g.commit(draftOf('test.sleep', [{ op: 'time', minutes: toMinutes(to) - toMinutes(g.state.time) }]))

  it('跨過週一 06:00：weekly 觸發一次（只一次）；沒跨過就不觸發', () => {
    const g = make({ content: clock, time: { day: 6, hour: 22, minute: 0 } })
    expect(notices(sleep(g, { day: 6, hour: 23, minute: 30 }))).toEqual([])
    expect(notices(sleep(g, { day: 7, hour: 7, minute: 0 }))).toEqual(['weekly_n'])
    expect(notices(sleep(g, { day: 7, hour: 7, minute: 30 }))).toEqual([])
  })

  it('跨過每天 08:00：daily 觸發；剛好站在 08:00 出發的不算，走到 08:00 的算', () => {
    const g = make({ content: clock, time: { day: 3, hour: 7, minute: 0 } })
    expect(notices(sleep(g, { day: 3, hour: 8, minute: 0 }))).toEqual(['daily_n'])
    expect(notices(sleep(g, { day: 3, hour: 9, minute: 0 }))).toEqual([])
  })

  it('一次睡過三天：daily 補三次（一回合最多兩則通知，第三則排到下一回合）；睡過十天也只補三次', () => {
    const g = make({ content: clock, time: { day: 2, hour: 9, minute: 0 } })
    const rs = sleep(g, { day: 5, hour: 9, minute: 0 })
    expect(notices(rs)).toEqual(['daily_n', 'daily_n'])
    expect(directorOf(g.state).notices.map((q) => q.event)).toEqual(['daily_n'])
    const h = make({ content: clock, time: { day: 2, hour: 9, minute: 0 } })
    const many = sleep(h, { day: 12, hour: 9, minute: 0 })
    expect(notices(many).length + directorOf(h.state).notices.length).toBe(3)
  })

  it('補的每一次都照範圍的冷卻：兩天一次的範圍睡三天只放兩次', () => {
    const g = make({ content: { ...clock, event_scope: [scope('chores', { triggers: { daily: 1 }, cooldown_hours: 48 }), scope('rent', { triggers: { weekly: 1 } })] }, time: { day: 2, hour: 9, minute: 0 } })
    const rs = sleep(g, { day: 5, hour: 9, minute: 0 })
    expect(notices(rs)).toEqual(['daily_n', 'daily_n']) // 第 3 天、第 5 天的 08:00（第 4 天還在冷卻裡）
    expect(directorOf(g.state).notices).toEqual([])
  })

  it('daily 與 weekly 都在同一趟裡：週一 06:00 的 weekly 在 08:00 的 daily 之前', () => {
    const g = make({ content: clock, time: { day: 6, hour: 20, minute: 0 } })
    const rs = sleep(g, { day: 7, hour: 9, minute: 0 })
    expect(notices(rs)).toEqual(['weekly_n', 'daily_n'])
  })

  it('daily 帶來的擋住型事件：開事件視窗；同一回合 turn.end 又有新的觸發點就延後（名額只有一個）', () => {
    const g = make({ content: { event_scope: [scope('street'), scope('chores', { triggers: { daily: 1 } })], event: [ev('ev_a'), ev('ev_d', 'chores', { triggers: ['daily'] })] }, time: { day: 3, hour: 7, minute: 0 } })
    g.commit(draftOf('test.sleep', [{ op: 'time', minutes: 90 }], { triggers: [{ point: 'enter_block' }] }))
    expect(opened(g)).toBe('ev_d')
    expect(directorOf(g.state).deferred.map((q) => q.event)).toEqual(['ev_a'])
  })

  it('不走時間的報告不觸發 daily；沒有範圍用到 daily 時什麼都不留', () => {
    const g = make()
    g.commit(draftOf('test.sleep', [{ op: 'time', minutes: 24 * 60 }]))
    expect(directorOf(g.state).scopes).toEqual({})
    expect(g.state.ext.director).toBeUndefined()
  })
})

// ---- 內容載入 ----

describe('內容載入：格式與引用', () => {
  const bad = (c: Content, features?: Feature[]) => () => make({ content: c, ...(features ? { features } : {}) })

  it('scope 查不到：擋下並寫出是哪一件', () => {
    expect(bad({ event: [ev('ev_x', 'nowhere')] })).toThrow(/event\/ev_x：scope nowhere 查不到/)
    expect(bad({ event: [ev('ev_x', 'nowhere')] })).toThrow(ContentError)
  })

  it('觸發點不在那個範圍的表裡：擋下並寫出是哪一件', () => {
    expect(bad({ event: [ev('ev_x', 'street', { triggers: ['enter_block', 'walk'] })] })).toThrow(/event\/ev_x：觸發點 walk 不在範圍 street 的表裡/)
  })

  it('requires 的條件種類沒有人註冊：擋下並寫出是哪一件（weight_mods 的條件一樣）', () => {
    expect(bad({ event: [ev('ev_x', 'street', { requires: { kind: 'no_such_condition' } })] })).toThrow(/event\/ev_x.*no_such_condition/)
    expect(bad({ event: [ev('ev_y', 'street', { weight_mods: [{ if: { kind: 'no_such_condition' }, mult: 2 }] })] })).toThrow(/event\/ev_y.*no_such_condition/)
    expect(bad({ event: [ev('ev_z', 'street', { requires: [{ kind: 'flag', key: 'a' }, { kind: 'no_such_condition' }] })] })).toThrow(/event\/ev_z/)
  })

  it('表頭的格式：欄位不對各自被擋下', () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ triggers: [] }, /triggers/], [{ where: { block: 3 } }, /where\.block/], [{ when: { time: ['teatime'] } }, /when/], [{ when: { moon: [1] } }, /when\.moon/],
      [{ weight: -1 }, /weight/], [{ weight_mods: [{ if: { kind: 'flag', key: 'a' } }] }, /mult/], [{ category: 'gossip' }, /category/], [{ blocking: 'yes' }, /blocking/],
      [{ repeat_days: 1.5 }, /repeat_days/], [{ tags: [1] }, /tags/], [{ adult: 1 }, /adult/],
    ]
    for (const [patch, re] of cases) expect(bad({ event: [ev('ev_x', 'street', patch)] }), JSON.stringify(patch)).toThrow(re)
  })

  it('範圍與規則的格式：機率要在 0～1、lost 只能是 drop 或 defer、每回合擋住型最多一件', () => {
    expect(bad({ event_scope: [scope('street', { triggers: { enter_block: 1.5 } })] })).toThrow(/機率/)
    expect(bad({ event_scope: [scope('street', { lost: 'later' })] })).toThrow(/lost/)
    expect(bad({ event_scope: [scope('street', { cooldown_hours: -1 })] })).toThrow(/cooldown_hours/)
    expect(bad({ event_scope: [scope('street', { roller: 'npc' })] })).toThrow(/roller/)
    expect(bad({ event_rule: [{ id: 'default', per_turn: { blocking: 2 } }] })).toThrow(/per_turn\.blocking/)
    expect(bad({ event_rule: [{ id: 'default', category_penalty: 2 }] })).toThrow(/category_penalty/)
  })

  it('內文的檢查可以再掛（給 M2-event-run）：掛上去的函式在載入時與載入之後各看一次，錯誤寫出是哪一件', () => {
    const hooked: Feature = { id: 'body_check', install: (k) => addEventBodyCheck(k, (_k, e, phase) => (e.id === 'ev_bad' ? [`內文不對（${phase}）`] : [])) }
    expect(bad({ event: [ev('ev_bad')] }, [directorFeature, eventStub, hooked])).toThrow(/event\/ev_bad：內文不對（load）/)
    expect(bad({ event: [ev('ev_ok')] }, [directorFeature, eventStub, hooked])).not.toThrow()
  })

  it('合格的資料可以載入；沒有範圍、沒有事件也行', () => {
    expect(bad({})).not.toThrow()
    expect(() => makeGame({ features: [directorFeature] })).not.toThrow()
  })
})

// ---- 檢視與不認得別人 ----

describe('directorView 與介面', () => {
  it('延後幾件、今天放行了幾件、每個範圍的冷卻還剩多久', () => {
    const g = make({ content: { event_scope: [scope('street', { cooldown_hours: 1, lost: 'defer' }), scope('first', { priority: 1, cooldown_hours: 2 })], event: [ev('ev_a'), ev('ev_f', 'first')] } })
    expect(view(g)).toEqual({ deferred: 0, notices: 0, today: { day: 3, released: 0, city_blocking: 0 }, scopes: {} })
    step(g)
    expect(view(g)).toEqual({ deferred: 1, notices: 0, today: { day: 3, released: 1, city_blocking: 1 }, scopes: { first: { cooldown_left: 120, today: 1 } } })
    setTime(g, { day: 4, hour: 10, minute: 0 })
    expect(view(g).today).toEqual({ day: 4, released: 0, city_blocking: 0 })
    expect(view(g).scopes.first).toEqual({ cooldown_left: 0, today: 0 })
  })

  it('directorOf 對壞掉的狀態不丟錯（當成空的）', () => {
    const g = make()
    g.commit(draftOf('test.break', [{ op: 'ext', key: 'director', value: { scopes: 3, deferred: [{ event: 1 }], city: 'x' } }]), { turn: false })
    expect(directorOf(g.state)).toMatchObject({ scopes: {}, deferred: [], city: { day: 0, blocking: 0 } })
    expect(() => step(g)).not.toThrow()
  })

  it('runPasses 可以直接叫：回傳報告草稿、不改狀態', () => {
    const g = make()
    const before = structuredClone(g.state)
    const drafts = runPasses(g.k, g.state, [{ triggers: [{ point: 'enter_block' }], at: g.state.time }], { turnKey: 'rX', launchPending: false })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.action).toBe('event.start')
    expect(g.state).toEqual(before)
  })

  it('沒有主角時不走導演', () => {
    const g = make()
    expect(runPasses(g.k, { ...g.state, pc: null }, [{ triggers: [{ point: 'enter_block' }], at: g.state.time }], { turnKey: 'r', launchPending: false })).toEqual([])
  })
})
