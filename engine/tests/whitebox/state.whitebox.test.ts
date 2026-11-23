// 白箱測試：L3 狀態核心（變更的登錄表、提交報告、通用變更、掛鉤、背包）。
// 補主套件沒有走到的分支與錯誤路徑。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { Change, GameState, ReportDraft } from '../../src/core'
import {
  ChangeRegistry, HookBus, MAX_FOLLOW_UP_DEPTH, Probe, addItem, clone, commitReport, commitReportAll, countItem, createKernel, removeItem, underageAt, validateActor,
} from '../../src/core'
import { makeActor, makeState } from '../../src/testkit'

const draft = (changes: Change[], extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action: 'wb', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '白箱' }, ...extra,
})
const kernel = () => {
  const k = createKernel()
  k.strict = true
  return k
}
/** 驗一筆變更：回傳錯誤訊息（不套）。 */
const problemsOf = (state: GameState, c: Change): string[] => {
  const k = kernel()
  return k.changes.get(c.op)!.validate(state, c)
}
/** 提交一筆，回傳提交後的狀態；不合法就丟 ChangeError。 */
const commitOne = (state: GameState, ...changes: Change[]): GameState => {
  commitReport(kernel(), state, draft(changes))
  return state
}

describe('白箱 L3 變更的登錄表（GAME_DESIGN 3 第 1 條；dev/invariants.md 第 1 條）', () => {
  it('同一種變更註冊兩次丟錯，訊息寫出原本的擁有者', () => {
    const reg = new ChangeRegistry(new Probe())
    reg.register({ op: 'x', owner: 'a', validate: () => [], apply: () => {} })
    expect(() => reg.register({ op: 'x', owner: 'b', validate: () => [], apply: () => {} })).toThrow(/已經由 a 註冊/)
    expect(reg.ops()).toEqual(['x'])
  })

  it('describe：沒有 describe 的種類、回傳 null 的、沒註冊的都不出現在報告卡的摘要', () => {
    const k = kernel()
    const s = makeState()
    expect(k.changes.describe(s, [{ op: 'cash', delta: 0 }, { op: 'cash', delta: 12 }, { op: 'cred', delta: -3 }, { op: 'time', minutes: 5 }, { op: 'nope' }, { op: 'item', id: 'it_a', qty: -2 }]))
      .toEqual(['現金 +12', '帳戶 −3', '失去 it_a ×2'])
    expect(k.changes.describe(s, [{ op: 'item', id: 'it_b', qty: 3 }])).toEqual(['得到 it_b ×3'])
  })

  it('forLog：沒有瘦身版的種類原樣記；chain 只記 id 與樓層（AI_TASKS 5.5 節）', () => {
    const k = kernel()
    const c: Change[] = [{ op: 'cash', delta: 1 }, { op: 'chain', slot: { id: 'c1', floor: 1, detail: { big: true } } }, { op: 'nope', x: 1 }]
    expect(k.changes.forLog(c)).toEqual([{ op: 'cash', delta: 1 }, { op: 'chain', slot: { id: 'c1', floor: 1 } }, { op: 'nope', x: 1 }])
  })
})

describe('白箱 L3 提交報告（GAME_DESIGN 3 第 3、13 條；dev/adr/0003）', () => {
  it('草稿自己帶了 time 時照用，不重算（dev/invariants.md 第 2 條）', () => {
    const k = kernel()
    const s = makeState()
    const t = { start: { day: 1, hour: 6, minute: 0 }, end: { day: 1, hour: 7, minute: 0 } }
    const r = commitReport(k, s, draft([{ op: 'time', minutes: 30 }], { time: t }))
    expect(r.time).toEqual(t)
    expect(s.time).toEqual({ day: 1, hour: 8, minute: 30 })
  })

  it('時間沒有往前走時不跑 time.passed；往前走才跑，拿到 from 與 to', () => {
    const k = kernel()
    const calls: string[] = []
    k.hooks.on('time.passed', 'wb', ({ from, to }) => { calls.push(`${from.hour}:${from.minute}->${to.hour}:${to.minute}`) })
    const s = makeState()
    commitReport(k, s, draft([{ op: 'cash', delta: 1 }]))
    expect(calls).toEqual([])
    commitReport(k, s, draft([{ op: 'time', minutes: 90 }]))
    expect(calls).toEqual(['8:0->9:30'])
  })

  it('report.after 與 time.passed 回傳的報告接著提交，照順序回傳；第一份是原本那一份', () => {
    const k = kernel()
    k.hooks.on('report.after', 'wb', ({ report }) => (report.action === 'wb' ? [draft([{ op: 'counter', key: 'after', delta: 1 }], { action: 'after' })] : undefined))
    k.hooks.on('time.passed', 'wb', () => [draft([{ op: 'counter', key: 'passed', delta: 1 }], { action: 'passed' })])
    const s = makeState()
    const rs = commitReportAll(k, s, draft([{ op: 'time', minutes: 1 }]))
    expect(rs.map((r) => r.action)).toEqual(['wb', 'after', 'passed'])
    expect(s.counters).toEqual({ after: 1, passed: 1 })
    expect(s.seq.report).toBe(3)
  })

  it(`掛鉤互相觸發超過 ${MAX_FOLLOW_UP_DEPTH} 層丟錯（防止無限迴圈）`, () => {
    const k = kernel()
    k.hooks.on('report.after', 'loop', () => [draft([{ op: 'counter', key: 'n', delta: 1 }])])
    const s = makeState()
    expect(() => commitReport(k, s, draft([]))).toThrow(new RegExp(`超過 ${MAX_FOLLOW_UP_DEPTH} 層`))
  })

  it('report.before 的掛鉤可以替報告加變更；回傳 undefined、null 的略過', () => {
    const k = kernel()
    k.hooks.on('report.before', 'a', () => [{ op: 'cash', delta: 7 }])
    k.hooks.on('report.before', 'b', () => null as never)
    k.hooks.on('report.before', 'c', () => undefined)
    const s = makeState()
    const r = commitReport(k, s, draft([{ op: 'cred', delta: 1 }]))
    expect(r.changes).toEqual([{ op: 'cred', delta: 1 }, { op: 'cash', delta: 7 }])
    expect(s.money).toEqual({ cred: 1, cash: 7 })
  })

  it('嚴格模式：report.before 的掛鉤直接改狀態被抓到，狀態完全不變（dev/invariants.md 第 1、3 條）', () => {
    const k = kernel()
    k.hooks.on('report.before', 'cheat', ({ state }) => { state.money.cash += 100 })
    const s = makeState()
    const before = clone(s)
    expect(() => commitReport(k, s, draft([]))).toThrow(/report.before 的掛鉤直接改了狀態：money.cash/)
    expect(s).toEqual(before)
  })

  it('不是嚴格模式時不做檢查（正式版）：掛鉤偷改的是複製的狀態，正式的狀態不受 report.before 影響', () => {
    const k = createKernel()
    k.hooks.on('report.before', 'cheat', ({ state }) => { state.money.cash += 100 })
    const s = makeState()
    commitReport(k, s, draft([]))
    // report.before 拿到的是 work（複製的那一份），提交時 work 換進來，所以偷改的會留下：這正是嚴格模式要抓的
    expect(s.money.cash).toBe(100)
  })
})

describe('白箱 L3 通用變更的驗證與套用（GAME_DESIGN 3 第 13 條；dev/invariants.md 第 3、7、12 條）', () => {
  it('cred、cash：delta 要是整數；扣到負數不合法；describe 的 + 與 −', () => {
    const s = makeState({ patch: { money: { cred: 5, cash: 5 } } })
    expect(problemsOf(s, { op: 'cash', delta: 1.5 })).toEqual(['delta 要是整數'])
    expect(problemsOf(s, { op: 'cred', delta: '3' })).toEqual(['delta 要是整數'])
    expect(problemsOf(s, { op: 'cred', delta: -6 })[0]).toMatch(/帳戶不夠：有 5，要扣 6/)
    expect(problemsOf(s, { op: 'cash', delta: -5 })).toEqual([])
  })

  it('time：0 分鐘合法（不推進），負數與小數不合法（CORE_RULES 2：時間只往前走）', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'time', minutes: 0 })).toEqual([])
    expect(problemsOf(s, { op: 'time', minutes: 1.5 })).toHaveLength(1)
    expect(problemsOf(s, { op: 'time', minutes: -1 })).toHaveLength(1)
  })

  it('flag：key 要是非空字串；value 只能是布林、數字、字串或 null；null 是拿掉（EVENTS 2.4 flag）', () => {
    const s = makeState({ patch: { flags: { a: 1 } } })
    expect(problemsOf(s, { op: 'flag', key: '', value: 1 })).toEqual(['key 要是字串'])
    expect(problemsOf(s, { op: 'flag', key: 'x', value: { o: 1 } })).toEqual(['value 只能是布林、數字、字串或 null'])
    expect(problemsOf(s, { op: 'flag', key: 7, value: [] })).toHaveLength(2)
    commitOne(s, { op: 'flag', key: 'a', value: null }, { op: 'flag', key: 'b', value: 'x' })
    expect(s.flags).toEqual({ b: 'x' })
  })

  it('counter：要有 key 與整數的 delta；沒有的計數器從 0 開始', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'counter', key: '', delta: 1 })).toHaveLength(1)
    expect(problemsOf(s, { op: 'counter', key: 'n', delta: 0.5 })).toHaveLength(1)
    commitOne(s, { op: 'counter', key: 'n', delta: -2 })
    expect(s.counters.n).toBe(-2)
  })

  it('item：id 格式、qty 不為 0 的整數、拿走時要夠；帶實例資料的各自一疊（CODESCAN 2.4）', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'item', id: 'Bad Id', qty: 1 })).toEqual(['物品的 id 格式不對'])
    expect(problemsOf(s, { op: 'item', id: 'it_a', qty: 0 })).toEqual(['qty 要是不為 0 的整數'])
    expect(problemsOf(s, { op: 'item', id: 'it_a', qty: 1.5 })).toEqual(['qty 要是不為 0 的整數'])
    expect(problemsOf(s, { op: 'item', id: 'it_a', qty: -1 })[0]).toMatch(/不夠 1 個/)
    commitOne(s, { op: 'item', id: 'it_a', qty: 1, data: { dye: 'pink' } }, { op: 'item', id: 'it_a', qty: 2 }, { op: 'item', id: 'it_a', qty: 1, data: { dye: 'blue' } })
    expect(s.inventory).toEqual([{ id: 'it_a', qty: 1, data: { dye: 'pink' } }, { id: 'it_a', qty: 2 }, { id: 'it_a', qty: 1, data: { dye: 'blue' } }])
    // 先拿沒有實例資料的那一疊
    commitOne(s, { op: 'item', id: 'it_a', qty: -3 })
    expect(s.inventory).toEqual([{ id: 'it_a', qty: 1, data: { dye: 'blue' } }])
  })

  it('location：to 要是物件；rng：advance 要是正整數', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'location', to: 'hive' })).toEqual(['to 要是地點'])
    expect(problemsOf(s, { op: 'rng', advance: 0 })).toEqual(['advance 要是正整數'])
    commitOne(s, { op: 'location', to: { district: 'hive' } }, { op: 'rng', advance: 3 })
    expect(s.location).toEqual({ district: 'hive' })
    expect(s.rng.cursor).toBe(3)
  })

  it('rules：patch 只能改存檔規則裡有的欄位（MIGRATION A 存檔規則）', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'rules', patch: { nope: 1 } })).toHaveLength(1)
    expect(problemsOf(s, { op: 'rules', patch: 'x' })).toHaveLength(1)
    commitOne(s, { op: 'rules', patch: { fastTravel: false } })
    expect(s.rules.fastTravel).toBe(false)
  })

  it('actor.add：角色的骨架每一個欄位都檢查（AI_TASKS 3.19；dev/invariants.md 第 12 條）', () => {
    expect(validateActor('x')).toEqual(['角色要是一個物件'])
    const bad = { id: 'Bad Id', name: ' ', role: 'boss', age: '20', attrs: { body: 1 }, skills: { a: 7 }, perks: [1], hp: -1, load: 1.5, sink: 'x', afterglow: 0, conditions: {}, ext: [] }
    expect(validateActor(bad)).toEqual([
      'id 的格式不對', '要有名字', 'role 只能是 pc、companion、npc', '年齡要是整數', '六項屬性都要是整數', '基本功等級要是 0～6 的整數', 'perks 要是 id 的陣列',
      'hp 要是 0 以上的整數', 'load 要是 0 以上的整數', 'sink 要是 0 以上的整數', 'conditions 要是陣列', 'ext 要是物件',
    ])
    expect(validateActor({ ...makeActor(), skills: { a: -1 } })).toEqual(['基本功等級要是 0～6 的整數'])
    expect(validateActor({ ...makeActor(), attrs: 'x' })).toEqual(['六項屬性都要是整數'])
    expect(validateActor({ ...makeActor(), skills: null })).toEqual(['基本功等級要是 0～6 的整數'])
    expect(validateActor({ ...makeActor(), perks: 'a' })).toEqual(['perks 要是 id 的陣列'])
  })

  it('actor.remove：不能拿掉主角；拿掉的人同時離隊', () => {
    const s = makeState({ actors: [makeActor({ id: 'c1', role: 'companion' })] })
    expect(problemsOf(s, { op: 'actor.remove', id: 'pc' })).toEqual(['不能拿掉主角'])
    expect(problemsOf(s, { op: 'actor.remove', id: 'ghost' })).toEqual(['沒有 ghost 這個角色'])
    commitOne(s, { op: 'actor.remove', id: 'c1' })
    expect(s.actors.c1).toBeUndefined()
    expect(s.party).toEqual(['pc'])
  })

  it('actor.track：track 只能是四條之一、delta 要是整數；最低夾在 0（dev/invariants.md 第 7 條）', () => {
    const s = makeState({ pc: { hp: 3 } })
    expect(problemsOf(s, { op: 'actor.track', id: 'pc', track: 'mp', delta: 1 })).toEqual(['track 只能是 hp、load、sink、afterglow'])
    expect(problemsOf(s, { op: 'actor.track', id: 'pc', track: 'hp', delta: 0.5 })).toEqual(['delta 要是整數'])
    expect(problemsOf(s, { op: 'actor.track', id: 9, track: 'hp', delta: 1 })).toEqual(['沒有 9 這個角色'])
    commitOne(s, { op: 'actor.track', id: 'pc', track: 'hp', delta: -10 })
    expect(s.actors.pc!.hp).toBe(0)
  })

  it('actor.skill：角色、skill 的格式、整數 delta、結果在 0～6（CORE_RULES 2；dev/invariants.md 第 7 條）', () => {
    const s = makeState({ pc: { skills: { negotiate: 5 } } })
    expect(problemsOf(s, { op: 'actor.skill', id: 'ghost', skill: 'negotiate', delta: 1 })).toEqual(['沒有 ghost 這個角色'])
    expect(problemsOf(s, { op: 'actor.skill', id: 'pc', skill: 'Bad', delta: 1 })).toEqual(['要有 skill 與整數的 delta'])
    expect(problemsOf(s, { op: 'actor.skill', id: 'pc', skill: 'negotiate', delta: 1.5 })).toEqual(['要有 skill 與整數的 delta'])
    expect(problemsOf(s, { op: 'actor.skill', id: 'pc', skill: 'negotiate', delta: 2 })[0]).toMatch(/會變成 7/)
    expect(problemsOf(s, { op: 'actor.skill', id: 'pc', skill: 'stealth', delta: -1 })[0]).toMatch(/會變成 -1/)
    commitOne(s, { op: 'actor.skill', id: 'pc', skill: 'stealth', delta: 2 })
    expect(s.actors.pc!.skills.stealth).toBe(2)
  })

  it('actor.perk：加、拿掉、重複、沒有的、格式不對', () => {
    const s = makeState({ pc: { perks: ['tough'] } })
    expect(problemsOf(s, { op: 'actor.perk', id: 'ghost', perk: 'tough' })).toEqual(['沒有 ghost 這個角色'])
    expect(problemsOf(s, { op: 'actor.perk', id: 'pc', perk: 'Bad Id' })).toEqual(['perk 的 id 格式不對'])
    expect(problemsOf(s, { op: 'actor.perk', id: 'pc', perk: 'tough' })[0]).toMatch(/已經有/)
    expect(problemsOf(s, { op: 'actor.perk', id: 'pc', perk: 'smooth', remove: true })[0]).toMatch(/沒有 smooth/)
    commitOne(s, { op: 'actor.perk', id: 'pc', perk: 'smooth' }, { op: 'actor.perk', id: 'pc', perk: 'tough', remove: true })
    expect(s.actors.pc!.perks).toEqual(['smooth'])
  })

  it('actor.condition：同一個狀態只留一筆（換掉期限）；remove 拿掉；until 要是整數（EVENTS 2.4.1）', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'actor.condition', id: 'pc', condition: 'Bad Id' })).toEqual(['condition 的 id 格式不對'])
    expect(problemsOf(s, { op: 'actor.condition', id: 'pc', condition: 'drugged', until: 1.5 })).toEqual(['until 要是整數（總分鐘數）'])
    commitOne(s, { op: 'actor.condition', id: 'pc', condition: 'drugged' }, { op: 'actor.condition', id: 'pc', condition: 'drugged', until: 600 })
    expect(s.actors.pc!.conditions).toEqual([{ id: 'drugged', until: 600 }])
    commitOne(s, { op: 'actor.condition', id: 'pc', condition: 'drugged', remove: true })
    expect(s.actors.pc!.conditions).toEqual([])
  })

  it('actor.ext 與 ext：整份換掉；null 與 undefined 是拿掉；key 要是字串', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'actor.ext', id: 'pc', key: '' })).toEqual(['key 要是字串'])
    expect(problemsOf(s, { op: 'ext', key: 3 })).toEqual(['key 要是字串'])
    commitOne(s, { op: 'actor.ext', id: 'pc', key: 'bridge', value: { tolerance: 4 } }, { op: 'ext', key: 'shop', value: { open: true } })
    expect(s.actors.pc!.ext.bridge).toEqual({ tolerance: 4 })
    expect(s.ext.shop).toEqual({ open: true })
    commitOne(s, { op: 'actor.ext', id: 'pc', key: 'bridge', value: null }, { op: 'ext', key: 'shop' })
    expect(s.actors.pc!.ext.bridge).toBeUndefined()
    expect(s.ext.shop).toBeUndefined()
  })

  it('pc：主角的 role 要是 pc；已經在隊伍裡的不重複加', () => {
    const s = makeState({ actors: [makeActor({ id: 'n1', role: 'npc' }), makeActor({ id: 'p2', role: 'pc' })] })
    expect(problemsOf(s, { op: 'pc', id: 'n1' })).toEqual(['主角的 role 要是 pc'])
    expect(problemsOf(s, { op: 'pc', id: 'ghost' })).toEqual(['沒有 ghost 這個角色'])
    commitOne(s, { op: 'pc', id: 'pc' })
    expect(s.party).toEqual(['pc'])
    commitOne(s, { op: 'pc', id: 'p2' })
    expect(s.pc).toBe('p2')
    expect(s.party).toEqual(['p2', 'pc'])
  })

  it('party：主角不能離隊；進隊不重複', () => {
    const s = makeState({ actors: [makeActor({ id: 'c1', role: 'companion' })] })
    expect(problemsOf(s, { op: 'party', id: 'pc', remove: true })).toEqual(['主角不能離隊'])
    commitOne(s, { op: 'party', id: 'c1' }, { op: 'party', id: 'c1' })
    expect(s.party).toEqual(['pc', 'c1'])
    commitOne(s, { op: 'party', id: 'c1', remove: true })
    expect(s.party).toEqual(['pc'])
  })

  it('chain：同一條鏈再記一次不多算一條、換掉細節；五樓以前的清掉（AI_TASKS 5.5；dev/invariants.md 第 24 條）', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'chain', slot: { id: 'c', floor: 'x' } })).toEqual(['slot 要有 id 與 floor'])
    commitOne(s, { op: 'chain', slot: { id: 'c1', floor: 1, detail: { v: 1 } } })
    commitOne(s, { op: 'chain', slot: { id: 'c1', floor: 1, detail: { v: 2 } } })
    expect(s.seq.chain).toBe(1)
    expect(s.chains).toEqual([{ id: 'c1', floor: 1, detail: { v: 2 } }])
    commitOne(s, { op: 'chain', slot: { id: 'c6', floor: 6 } })
    expect(s.chains[0]).toEqual({ id: 'c1', floor: 1, cleaned: true })
    // 已經清過的不再動；較低的樓層不會把 seq.floor 拉回去
    commitOne(s, { op: 'chain', slot: { id: 'c0', floor: 0 } })
    expect(s.seq.floor).toBe(6)
    expect(s.chains.find((x) => x.id === 'c0')).toEqual({ id: 'c0', floor: 0, cleaned: true })
  })

  it('narration：只能補已經提交的報告；text、results、uncovered 分別合併', () => {
    const s = makeState()
    expect(problemsOf(s, { op: 'narration', report: 'r9' })).toEqual(['沒有 r9 這份報告'])
    commitOne(s, { op: 'cash', delta: 1 })
    commitOne(s, { op: 'narration', report: 'r1', results: ['a'] })
    commitOne(s, { op: 'narration', report: 'r1', text: '正文', uncovered: [0] })
    expect(s.reports[0]!.narration).toEqual({ results: ['a'], text: '正文', uncovered: [0] })
    commitOne(s, { op: 'narration', report: 'r1' })
    expect(s.reports[0]!.narration).toEqual({ results: ['a'], text: '正文', uncovered: [0] })
  })

  it('underageAt：最外層的 age 路徑寫成 age；不是數字的 age 不算（AI_TASKS 3.19；dev/invariants.md 第 12 條）', () => {
    expect(underageAt({ age: 3 })).toEqual(['age'])
    expect(underageAt([{ age: 17 }])).toEqual(['[0].age'])
    expect(underageAt({ age: '12' })).toEqual([])
    expect(underageAt(null)).toEqual([])
  })
})

describe('白箱 L3 掛鉤（CODESCAN 第 3 節）', () => {
  it('order 小的先跑，同一個 order 照註冊順序；owners 列出順序', () => {
    const bus = new HookBus(new Probe())
    const seen: string[] = []
    bus.on('game.new', 'b', () => { seen.push('b') }, 5)
    bus.on('game.new', 'a', () => { seen.push('a') }, -1)
    bus.on('game.new', 'c', () => { seen.push('c') }, 5)
    expect(bus.owners('game.new')).toEqual(['a', 'b', 'c'])
    expect(bus.owners('turn.end')).toEqual([])
    bus.run('game.new', { state: makeState() })
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(bus.run('turn.end', { state: makeState(), report: {} as never, reports: [] })).toEqual([])
  })
})

describe('白箱 L3 背包（CODESCAN 2.4 節）', () => {
  it('addItem、removeItem 的 qty ≤ 0 什麼都不做；不夠時 removeItem 丟錯', () => {
    const inv = [{ id: 'a', qty: 1 }]
    addItem(inv, 'a', 0)
    addItem(inv, 'a', -3)
    removeItem(inv, 'a', 0)
    expect(inv).toEqual([{ id: 'a', qty: 1 }])
    expect(() => removeItem(inv, 'a', 2)).toThrow(/不夠 2 個/)
  })

  it('removeItem：先拿沒有實例資料的；一疊不夠接著拿下一疊；拿空的疊被移除', () => {
    const inv = [{ id: 'a', qty: 1, data: { x: 1 } }, { id: 'b', qty: 1 }, { id: 'a', qty: 2 }, { id: 'a', qty: 2, data: { x: 2 } }]
    removeItem(inv, 'a', 4)
    expect(inv).toEqual([{ id: 'b', qty: 1 }, { id: 'a', qty: 1, data: { x: 2 } }])
    expect(countItem(inv, 'a')).toBe(1)
  })
})
