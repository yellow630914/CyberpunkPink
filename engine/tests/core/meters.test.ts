// 驗收測試：dev/work/M2-core-meters.md（量表 state.meters、meter 變更、自動註冊的同名效果與條件、存檔第 3 版）。
// 規格：dev/adr/0016 第三節；EVENTS 2.4 節（上限的寫法）；dev/adr/0007（效果的三級上限、一件事合計）；dev/invariants.md 第 94～98 條。
// 內容一律用測試自帶的最小假資料：量表是測試自己定義的（核心不定義任何一種），勢力與人用 testkit 的 METER_CONTENT，區是測試自己定義的內容種類。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { Change, GameState, Kernel, MeterDef, ReportDraft } from '../../src'
import {
  ChangeError, MIGRATIONS, SAVE_VERSION, STATE_VERSION, blankState, clone, commitReport, createStateKernel, effectCtx, meterBounds, meterDefProblems, meterOf, meterProblems,
  packSave, saveMeta, unpackSave, validateState,
} from '../../src'
import { METER_CONTENT, makeGame, makeKernel, makeState, meterFeature, stateHash, testMeter } from '../../src/testkit'

const draft = (changes: Change[], extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action: 'test.meter', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' }, ...extra,
})
const meter = (kind: string, key: string, how: { delta: number } | { set: number }): Change => ({ op: 'meter', kind, key, ...how })

/** 一個核心：定義給定的量表，載入假的勢力與人，再定義「區」這種內容（f_alpha、f_beta、npc_ann；區 test 與 d2）。 */
function setup(...defs: MeterDef[]): { k: Kernel; state: GameState } {
  const k = makeKernel()
  k.strict = true
  k.content.loadPack(METER_CONTENT)
  k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] })
  k.content.load('district', [{ id: 'test', name: '測試區' }, { id: 'd2', name: '第二區' }])
  for (const d of defs) k.meters.define(d)
  return { k, state: makeState() }
}
/** 套一串變更在一份複製的狀態上。 */
const applied = (k: Kernel, state: GameState, ...changes: Change[]): GameState => {
  const s = clone(state)
  k.changes.applyAll(s, changes)
  return s
}
const resolve = (k: Kernel, state: GameState, effects: unknown, source: 'builtin' | 'ai' | 'player' = 'builtin', extra: { clampAsked?: boolean; playerInput?: string } = {}) =>
  k.effects.resolve(effects, effectCtx(k, state, { source, ...extra }))
const condCtx = (k: Kernel, state: GameState) => ({ state, stats: k.stats, timeRules: k.timeRules })
const withMeter = (state: GameState, kind: string, key: string, value: number): GameState => {
  const s = clone(state)
  s.meters[kind] = { ...s.meters[kind], [key]: value }
  return s
}

describe('登錄表：define、get、探針、撞名', () => {
  it('定義一種量表：get 查得到、同名的效果與條件自動有；探針發 registry.register（效果、條件、量表各一筆）', () => {
    const k = makeKernel()
    k.probe.start()
    k.meters.define(testMeter({ cap: { down: 5, up: 10 } }))
    const events = k.probe.stop().filter((e) => e.type === 'registry.register').map((e) => e.data)
    expect(events).toEqual([
      { registry: 'effects', id: 'mood', owner: 'test' },
      { registry: 'conditions', id: 'mood', owner: 'test' },
      { registry: 'meters', id: 'mood', owner: 'test' },
    ])
    expect(k.meters.get('mood')).toMatchObject({ kind: 'mood', name: '心情', min: 0, max: 100, start: 0, keyed: 'none', cap: { down: 5, up: 10 } })
    expect(k.meters.has('mood')).toBe(true)
    expect(k.meters.kinds()).toEqual(['mood'])
    expect(k.effects.has('mood')).toBe(true)
    expect(k.conditions.kinds()).toContain('mood')
    expect(k.meters.get('ghost')).toBeUndefined()
  })

  it('核心自己不定義任何一種量表：新的核心什麼都沒有', () => {
    for (const k of [createStateKernel(), makeKernel()]) {
      expect(k.meters.kinds()).toEqual([])
      expect(k.meters.list()).toEqual([])
    }
  })

  it('存的是一份複製：改原本的物件不影響已經定義的量表', () => {
    const k = makeKernel()
    const def = testMeter({ cap: { down: 5, up: 10 } })
    k.meters.define(def)
    def.cap!.up = 999
    def.name = '被改掉了'
    expect(k.meters.get('mood')).toMatchObject({ name: '心情', cap: { down: 5, up: 10 } })
  })

  it('同一種重複定義丟錯，訊息寫出是誰定義的', () => {
    const k = makeKernel()
    k.meters.define(testMeter())
    expect(() => k.meters.define(testMeter({ owner: 'other' }))).toThrow('量表重複定義：mood（已經由 test 定義）')
  })

  it('定義不合格的丟錯，訊息寫出種類與哪裡不對；丟錯之後什麼都沒留下', () => {
    const k = makeKernel()
    const bad: Array<[Partial<MeterDef>, RegExp]> = [
      [{ kind: 'Bad Kind' }, /kind 的格式不對/],
      [{ owner: '' }, /owner/],
      [{ name: ' ' }, /name/],
      [{ min: 1.5 }, /min 要是整數/],
      [{ max: NaN }, /max 要是整數/],
      [{ min: 10, max: 5, start: 7 }, /min 不能比 max 大/],
      [{ start: 101 }, /start 要在 min～max 之內/],
      [{ start: 0.5 }, /start 要是整數/],
      [{ keyed: 'planet' as MeterDef['keyed'] }, /keyed 只能是/],
      [{ cap: { down: -1, up: 5 } }, /cap 要有 0 以上的整數/],
      [{ cap: { down: 1.5, up: 5 } }, /cap 要有 0 以上的整數/],
      [{ floor: 'mood' }, /floor 不能是自己/],
      [{ floor: 'Not An Id' }, /floor 要是另一種量表的 kind/],
      [{ adjust: 3 as unknown as MeterDef['adjust'] }, /adjust 要是函式/],
    ]
    for (const [over, re] of bad) {
      expect(() => k.meters.define(testMeter(over)), JSON.stringify(over)).toThrow(re)
      expect(meterDefProblems(testMeter(over)).length, JSON.stringify(over)).toBeGreaterThan(0)
    }
    expect(() => k.meters.define(testMeter({ kind: 'Bad Kind' }))).toThrow(/量表 Bad Kind 的定義不合格/)
    expect(k.meters.kinds()).toEqual([])
    expect(k.effects.has('mood')).toBe(false)
    // 沒有上限的量表（體悟）：max 寫 Infinity 合格
    expect(meterDefProblems(testMeter({ max: Infinity }))).toEqual([])
    expect(meterDefProblems(testMeter({ min: -Infinity, start: 0 }))).toEqual([])
  })

  it('名字和現有的效果或條件撞到就丟錯；撞名的那一種整筆不成立（效果、條件、量表都沒留下）', () => {
    const k = makeKernel()
    // 效果撞名（cash 是核心的效果）、條件撞名（money 是核心的條件，不是效果）、條件的組合用字
    expect(() => k.meters.define(testMeter({ kind: 'cash' }))).toThrow(/量表種類 cash 和已經註冊的效果撞名/)
    expect(() => k.meters.define(testMeter({ kind: 'money' }))).toThrow(/量表種類 money 和已經註冊的條件撞名/)
    for (const word of ['all', 'any', 'not']) expect(() => k.meters.define(testMeter({ kind: word }))).toThrow(/條件的組合用字/)
    expect(k.meters.kinds()).toEqual([])
    expect(k.effects.has('money')).toBe(false)
    expect(k.conditions.kinds().filter((x) => x === 'cash')).toEqual([])
    // 反過來：量表先定義了，之後有人註冊同名的效果，照原本的規矩丟錯
    k.meters.define(testMeter())
    expect(() => k.effects.register({ kind: 'mood', owner: 'late', validate: () => [], toChanges: () => [], describe: () => '' })).toThrow(/效果種類重複註冊：mood/)
    expect(() => k.conditions.register({ kind: 'mood', owner: 'late', validate: () => [], test: () => true })).toThrow(/條件種類重複註冊：mood/)
  })

  it('只有 L3 的核心（沒有效果與條件的登錄表）也能定義量表、套 meter 變更', () => {
    const k = createStateKernel()
    k.content.loadPack(METER_CONTENT)
    k.meters.define(testMeter({ kind: 'favor', keyed: 'faction', max: 50 }))
    const s = blankState(1)
    k.changes.applyAll(s, [meter('favor', 'f_alpha', { delta: 80 })])
    expect(s.meters).toEqual({ favor: { f_alpha: 50 } })
    expect(meterOf(k, s, 'favor', 'f_alpha')).toBe(50)
  })
})

describe('狀態與變更：夾值、各記各的、起始值（驗收 1～3）', () => {
  it('0～100、起始 0：+30 再 +90 停在 100；set -5 停在 0；沒寫過的鍵是起始值', () => {
    const { k, state } = setup(testMeter())
    expect(meterOf(k, state, 'mood')).toBe(0)
    expect(state.meters).toEqual({})
    const a = applied(k, state, meter('mood', '_', { delta: 30 }))
    expect(meterOf(k, a, 'mood')).toBe(30)
    const b = applied(k, a, meter('mood', '_', { delta: 90 }))
    expect(b.meters).toEqual({ mood: { _: 100 } })
    expect(meterOf(k, b, 'mood')).toBe(100)
    expect(meterOf(k, applied(k, b, meter('mood', '_', { set: -5 })), 'mood')).toBe(0)
    expect(meterOf(k, applied(k, b, meter('mood', '_', { set: 999 })), 'mood')).toBe(100)
    expect(meterOf(k, applied(k, b, meter('mood', '_', { set: 42 })), 'mood')).toBe(42)
    // 往下扣也停在 0
    expect(meterOf(k, applied(k, a, meter('mood', '_', { delta: -500 })), 'mood')).toBe(0)
    // 沒寫過的鍵讀出來是 start（不是 0）
    const { k: k2, state: s2 } = setup(testMeter({ kind: 'calm', min: -50, max: 50, start: 20 }))
    expect(meterOf(k2, s2, 'calm')).toBe(20)
    expect(meterOf(k2, applied(k2, s2, meter('calm', '_', { delta: -100 })), 'calm')).toBe(-50)
  })

  it('沒有上限的量表（體悟）：max 是 Infinity，往上加不夾（夾在安全整數之內）', () => {
    const { k, state } = setup(testMeter({ kind: 'insight', max: Infinity }))
    expect(meterOf(k, applied(k, state, meter('insight', '_', { delta: 1_000_000 })), 'insight')).toBe(1_000_000)
    const big = applied(k, state, meter('insight', '_', { set: Number.MAX_SAFE_INTEGER }), meter('insight', '_', { delta: Number.MAX_SAFE_INTEGER }))
    expect(meterOf(k, big, 'insight')).toBe(Number.MAX_SAFE_INTEGER)
    expect(meterProblems(k.meters, big)).toEqual([])
  })

  it('每個鍵各記各的（勢力）；一個鍵動了，別的鍵還是起始值', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', keyed: 'faction', start: 10 }))
    const s = applied(k, state, meter('favor', 'f_alpha', { delta: 30 }), meter('favor', 'f_beta', { set: 5 }), meter('favor', 'f_alpha', { delta: 5 }))
    expect(s.meters).toEqual({ favor: { f_alpha: 45, f_beta: 5 } })
    expect(meterOf(k, s, 'favor', 'f_alpha')).toBe(45)
    expect(meterOf(k, s, 'favor', 'f_beta')).toBe(5)
    expect(meterOf(k, s, 'favor', 'npc_ann')).toBe(10)
  })

  it('keyed: district 省略鍵時記在現在這一區（效果與 meterOf 都是）；換了區就讀另一格', () => {
    const { k, state } = setup(testMeter({ kind: 'fame', keyed: 'district' }))
    expect(state.location.district).toBe('test')
    const r = resolve(k, state, [{ kind: 'fame', amount: 12 }])
    expect(r.changes).toEqual([meter('fame', 'test', { delta: 12 })])
    const s = applied(k, state, ...r.changes)
    expect(meterOf(k, s, 'fame')).toBe(12)
    expect(meterOf(k, s, 'fame', 'test')).toBe(12)
    // 換到另一區：現在這一區的數字是起始值，原本那一區的還在
    const moved = { ...s, location: { district: 'd2' } }
    expect(meterOf(k, moved, 'fame')).toBe(0)
    expect(meterOf(k, moved, 'fame', 'test')).toBe(12)
    expect(resolve(k, moved, [{ kind: 'fame', amount: 3 }]).changes).toEqual([meter('fame', 'd2', { delta: 3 })])
    // 不在任何一區：讀出來是起始值（不丟錯）
    expect(meterOf(k, { ...s, location: {} }, 'fame')).toBe(0)
  })

  it('keyed: map 省略鍵時用現在站的那張地圖的實例；keyed: none 用 _', () => {
    const { k, state } = setup(testMeter({ kind: 'alert', keyed: 'map' }), testMeter({ kind: 'rep', keyed: 'none' }))
    expect(meterOf(k, state, 'alert')).toBe(0)
    const on = { ...clone(state), maps: { instances: { mp_7: { id: 'mp_7', def: 'x', sheets: {} } }, at: { map: 'mp_7', sheet: 'a', x: 0, y: 0 }, seq: 0 } }
    const r = resolve(k, on, [{ kind: 'alert', amount: 20 }, { kind: 'rep', amount: 2 }])
    expect(r.changes).toEqual([meter('alert', 'mp_7', { delta: 20 }), meter('rep', '_', { delta: 2 })])
    const s = applied(k, on, ...r.changes)
    expect(meterOf(k, s, 'alert')).toBe(20)
    expect(meterOf(k, s, 'alert', 'mp_7')).toBe(20)
    expect(meterOf(k, s, 'rep')).toBe(2)
    // 離開地圖：現在沒有地圖，alert 讀出來是起始值
    expect(meterOf(k, { ...s, maps: { ...s.maps, at: null } }, 'alert')).toBe(0)
  })

  it('有 floor：下限那張是 30 時，往下扣只會停在 30；別的鍵的下限各算各的；下限那一種沒有人定義時當作沒有下限', () => {
    const floorDef = testMeter({ kind: 'hostility_floor', keyed: 'faction' })
    const hostility = testMeter({ kind: 'hostility', keyed: 'faction', floor: 'hostility_floor' })
    const { k, state } = setup(hostility, floorDef)
    const s0 = applied(k, state, meter('hostility_floor', 'f_alpha', { set: 30 }), meter('hostility', 'f_alpha', { delta: 50 }), meter('hostility', 'f_beta', { delta: 50 }))
    expect(meterOf(k, s0, 'hostility', 'f_alpha')).toBe(50)
    const s1 = applied(k, s0, meter('hostility', 'f_alpha', { delta: -80 }), meter('hostility', 'f_beta', { delta: -80 }))
    expect(meterOf(k, s1, 'hostility', 'f_alpha')).toBe(30)
    expect(meterOf(k, s1, 'hostility', 'f_beta')).toBe(0)
    expect(meterOf(k, applied(k, s0, meter('hostility', 'f_alpha', { set: 0 })), 'hostility', 'f_alpha')).toBe(30)
    // 下限提高之後，下一次動它才夾上來（變更套用時才夾）
    const raised = applied(k, s1, meter('hostility_floor', 'f_alpha', { set: 60 }))
    expect(meterOf(k, raised, 'hostility', 'f_alpha')).toBe(30)
    expect(meterOf(k, applied(k, raised, meter('hostility', 'f_alpha', { delta: -1 })), 'hostility', 'f_alpha')).toBe(60)
    // 下限比上限大：以上限為準
    const { k: k2, state: s2 } = setup(testMeter({ kind: 'lo', max: 200, keyed: 'faction' }), testMeter({ kind: 'hi', keyed: 'faction', floor: 'lo' }))
    expect(meterOf(k2, applied(k2, s2, meter('lo', 'f_alpha', { set: 150 }), meter('hi', 'f_alpha', { set: 0 })), 'hi', 'f_alpha')).toBe(100)
    expect(meterBounds(k2.meters, applied(k2, s2, meter('lo', 'f_alpha', { set: 150 })), k2.meters.get('hi')!, 'f_alpha')).toEqual({ lo: 100, hi: 100 })
    // 下限那一種沒有人定義（那個功能這一局沒裝）：當作沒有下限
    const { k: k3, state: s3 } = setup(testMeter({ kind: 'hostility', keyed: 'faction', floor: 'hostility_floor' }))
    expect(meterOf(k3, applied(k3, s3, meter('hostility', 'f_alpha', { delta: 10 }), meter('hostility', 'f_alpha', { delta: -80 })), 'hostility', 'f_alpha')).toBe(0)
  })
})

describe('meter 變更的格式與擋下', () => {
  it('量表的種類沒有人定義：變更被擋下、狀態不變，訊息寫出種類', () => {
    const { k, state } = setup(testMeter())
    const before = clone(state)
    expect(() => commitReport(k, state, draft([meter('hostility', 'f_alpha', { delta: 5 })]))).toThrow(ChangeError)
    expect(() => commitReport(k, state, draft([meter('hostility', 'f_alpha', { delta: 5 })]))).toThrow(/hostility/)
    // 同一份報告裡別的變更也不套
    expect(() => commitReport(k, state, draft([{ op: 'cash', delta: 0 }, meter('ghost', '_', { delta: 1 })]))).toThrow(/ghost/)
    expect(state).toEqual(before)
    expect(() => commitReport(k, state, draft([{ op: 'meter', kind: 5, key: '_', delta: 1 }]))).toThrow(/沒有人定義過/)
  })

  it('key 要是非空字串；不分對象只能是 _；勢力、區、人的鍵在內容裡查得到才收（人另外收存檔裡的角色 id）', () => {
    const { k, state } = setup(
      testMeter({ kind: 'm_none' }), testMeter({ kind: 'm_map', keyed: 'map' }), testMeter({ kind: 'm_fac', keyed: 'faction' }),
      testMeter({ kind: 'm_dis', keyed: 'district' }), testMeter({ kind: 'm_npc', keyed: 'npc' }),
    )
    const s = { ...state, actors: { ...state.actors, gen_walker: { ...state.actors.pc!, id: 'gen_walker', role: 'npc' as const } }, maps: { instances: { mp_1: { id: 'mp_1', def: 'x', sheets: {} } }, at: null, seq: 1 } }
    const ok = (kind: string, key: unknown) => k.changes.get('meter')!.validate(s, { op: 'meter', kind, key, delta: 1 })
    for (const kind of ['m_none', 'm_map', 'm_fac', 'm_dis', 'm_npc']) {
      for (const key of ['', 5, null, undefined, '__proto__']) expect(ok(kind, key), `${kind} ${String(key)}`).toEqual([expect.stringContaining('key 要是非空的字串')])
    }
    expect(ok('m_none', '_')).toEqual([])
    expect(ok('m_none', 'x')).toEqual([expect.stringContaining('不分對象')])
    expect(ok('m_map', 'mp_1')).toEqual([])
    // 地圖實例要存在（B018：key 寫一張不存在的實例是格式錯誤，不是照收）
    expect(ok('m_map', 'mp_999')).toEqual([expect.stringContaining('現在沒有 mp_999 這份地圖')])
    expect(ok('m_fac', 'f_alpha')).toEqual([])
    expect(ok('m_fac', 'f_zzz')).toEqual([expect.stringContaining('查不到 f_zzz')])
    expect(ok('m_dis', 'd2')).toEqual([])
    expect(ok('m_dis', 'nowhere')).toEqual([expect.stringContaining('查不到 nowhere')])
    expect(ok('m_npc', 'npc_ann')).toEqual([])
    expect(ok('m_npc', 'gen_walker')).toEqual([])
    expect(ok('m_npc', 'npc_zzz')).toEqual([expect.stringContaining('查不到 npc_zzz')])
    // 存檔裡的角色（含主角）也收
    expect(ok('m_npc', 'pc')).toEqual([])
  })

  it('delta 與 set 要有一個而且只有一個，是安全整數', () => {
    const { k, state } = setup(testMeter())
    const v = (c: Record<string, unknown>) => k.changes.get('meter')!.validate(state, { op: 'meter', kind: 'mood', key: '_', ...c })
    expect(v({})).toEqual([expect.stringContaining('delta 或 set')])
    expect(v({ delta: 1, set: 1 })).toEqual([expect.stringContaining('delta 或 set')])
    expect(v({ delta: 1.5 })).toEqual([expect.stringContaining('delta 要是整數')])
    expect(v({ set: Infinity })).toEqual([expect.stringContaining('set 要是整數')])
    expect(v({ set: NaN })).toEqual([expect.stringContaining('set 要是整數')])
    expect(v({ delta: '3' })).toEqual([expect.stringContaining('delta 要是整數')])
    expect(v({ delta: 2 ** 60 })).toEqual([expect.stringContaining('delta 要是整數')])
    expect(v({ delta: 0 })).toEqual([])
    expect(v({ set: 0 })).toEqual([])
    expect(v({ set: -(10 ** 12) })).toEqual([])
  })

  it('報告卡的一行白話：量表的名字加勢力的名字，不出現種類與欄位名', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', name: '好感', keyed: 'faction' }), testMeter({ kind: 'rep', name: '街頭信譽' }))
    const lines = k.changes.describe(state, [meter('favor', 'f_alpha', { delta: 5 }), meter('favor', 'f_beta', { delta: -3 }), meter('rep', '_', { set: 20 }), meter('rep', '_', { delta: 0 })])
    expect(lines).toEqual(['好感（阿爾法） +5', '好感（貝塔） −3', '街頭信譽 設為 20'])
  })

  it('報告卡的標籤：人用內容裡的名字（沒有就用存檔裡的角色名，再沒有就用 id），區用內容的名字；沒有人定義的種類不顯示', () => {
    const { k, state } = setup(testMeter({ kind: 'love', name: '親密度', keyed: 'npc' }), testMeter({ kind: 'fame', name: '豔名', keyed: 'district' }))
    const s = { ...state, actors: { ...state.actors, gen_walker: { ...state.actors.pc!, id: 'gen_walker', name: '路人甲', role: 'npc' as const } } }
    expect(k.changes.describe(s, [meter('love', 'npc_ann', { delta: 2 }), meter('love', 'gen_walker', { delta: -1 }), meter('love', 'npc_zzz', { delta: 1 }), meter('fame', 'd2', { delta: 3 }), meter('ghost', '_', { delta: 3 })]))
      .toEqual(['親密度（安） +2', '親密度（路人甲） −1', '親密度（npc_zzz） +1', '豔名（第二區） +3'])
  })

  it('提交：沒有人定義的種類整份不套；定義了的照常寫進狀態與紀錄，報告的變更和狀態一致', () => {
    const { k, state } = setup(testMeter())
    const before = clone(state)
    const report = commitReport(k, state, draft([meter('mood', '_', { delta: 7 })]))
    expect(report.changes).toEqual([meter('mood', '_', { delta: 7 })])
    expect(state.meters).toEqual({ mood: { _: 7 } })
    expect(state).not.toEqual(before)
    expect(() => commitReport(k, state, draft([meter('mood', '_', { delta: 1 }), meter('nope', '_', { delta: 1 })]))).toThrow(ChangeError)
    expect(state.meters).toEqual({ mood: { _: 7 } })
  })
})

describe('同名的效果：k.effects.resolve（驗收 4）', () => {
  it('內建的照寫（沒有 cap 的限制）；一件事裡拆成幾筆結果一樣', () => {
    const { k, state } = setup(testMeter({ cap: { down: 5, up: 10 } }))
    const r = resolve(k, state, [{ kind: 'mood', amount: 60 }])
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([meter('mood', '_', { delta: 60 })])
    expect(r.clamps).toEqual([])
    expect(r.lines).toEqual(['心情：+60'])
    expect(r.effects).toMatchObject([{ kind: 'mood', amount: 60 }])
    const split = resolve(k, state, [{ kind: 'mood', amount: 30 }, { kind: 'mood', amount: 30 }])
    expect(applied(k, state, ...split.changes).meters).toEqual({ mood: { _: 60 } })
  })

  it('AI 的兩筆 +8 在上限 10 時合計只給 10，並有一筆提醒（用量表的名字，不出現欄位名）', () => {
    const { k, state } = setup(testMeter({ cap: { down: 10, up: 10 } }))
    const r = resolve(k, state, [{ kind: 'mood', amount: 8 }, { kind: 'mood', amount: 8 }], 'ai')
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([meter('mood', '_', { delta: 8 }), meter('mood', '_', { delta: 2 })])
    expect(applied(k, state, ...r.changes).meters).toEqual({ mood: { _: 10 } })
    expect(r.clamps).toEqual([{ path: 'effects[1]', from: 8, to: 2, limit: 10, notice: '一次最多讓心情上升 10 點，實際上升了 2 點。' }])
    expect(r.clamps[0]!.notice).not.toMatch(/amount|mood|effects|delta|cap/)
    // 三筆：第三筆整筆拿掉，也有提醒
    const three = resolve(k, state, [{ kind: 'mood', amount: 8 }, { kind: 'mood', amount: 8 }, { kind: 'mood', amount: 8 }], 'ai')
    expect(three.changes.map((c) => c.delta)).toEqual([8, 2])
    expect(three.clamps.map((c) => [c.path, c.to])).toEqual([['effects[1]', 2], ['effects[2]', 0]])
    expect(three.clamps[1]!.notice).toBe('一次最多讓心情上升 10 點，這一筆沒有再算。')
    // 玩家明說要的、設定「玩家要求的結果也夾值」開著：照樣夾；內建的不夾
    expect(resolve(k, state, [{ kind: 'mood', amount: 50 }], 'player', { playerInput: '給我 50' }).changes).toEqual([meter('mood', '_', { delta: 10 })])
    expect(resolve(k, state, [{ kind: 'mood', amount: 50 }], 'builtin').changes).toEqual([meter('mood', '_', { delta: 50 })])
  })

  it('往下扣也有上限（cap.down）；一正一負互相抵銷，合計沒超過就不動', () => {
    const { k, state } = setup(testMeter({ cap: { down: 10, up: 4 } }))
    const s = withMeter(state, 'mood', '_', 50)
    const r = resolve(k, s, [{ kind: 'mood', amount: -8 }, { kind: 'mood', amount: -8 }], 'ai')
    expect(r.changes.map((c) => c.delta)).toEqual([-8, -2])
    expect(r.clamps[0]!.notice).toBe('一次最多讓心情下降 10 點，實際下降了 2 點。')
    const mixed = resolve(k, s, [{ kind: 'mood', amount: 4 }, { kind: 'mood', amount: -8 }, { kind: 'mood', amount: 4 }], 'ai')
    expect(mixed.changes.map((c) => c.delta)).toEqual([4, -8, 4])
    expect(mixed.clamps).toEqual([])
  })

  it('分組是「種類加鍵」：不同的鍵各算各的；同一個鍵（含省略鍵解出來的）合在一起算', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', keyed: 'faction', cap: { down: 5, up: 5 } }), testMeter({ kind: 'fame', keyed: 'district', cap: { down: 5, up: 5 } }), testMeter({ kind: 'heat', keyed: 'faction', cap: { down: 5, up: 5 } }))
    const two = resolve(k, state, [{ kind: 'favor', key: 'f_alpha', amount: 4 }, { kind: 'favor', key: 'f_beta', amount: 4 }, { kind: 'heat', key: 'f_alpha', amount: 4 }], 'ai')
    expect(two.changes.map((c) => c.delta)).toEqual([4, 4, 4])
    expect(two.clamps).toEqual([])
    const same = resolve(k, state, [{ kind: 'favor', key: 'f_alpha', amount: 4 }, { kind: 'favor', key: 'f_alpha', amount: 4 }], 'ai')
    expect(same.changes.map((c) => c.delta)).toEqual([4, 1])
    // 省略鍵（現在這一區是 test）和寫明 test 是同一組
    const district = resolve(k, state, [{ kind: 'fame', amount: 4 }, { kind: 'fame', key: 'test', amount: 4 }, { kind: 'fame', key: 'd2', amount: 4 }], 'ai')
    expect(district.changes.map((c) => [c.key, c.delta])).toEqual([['test', 4], ['test', 1], ['d2', 4]])
  })

  it('玩家要的、設定關掉夾值而且附了原話：不夾（只擋格式）；沒附原話的照夾', () => {
    const { k, state } = setup(testMeter({ cap: { down: 5, up: 5 } }))
    const input = '他說我有 40 分的好感'
    const free = resolve(k, state, [{ kind: 'mood', amount: 40, asked: '40 分' }], 'player', { clampAsked: false, playerInput: input })
    expect(free.changes).toEqual([meter('mood', '_', { delta: 40 })])
    expect(free.clamps).toEqual([])
    expect(resolve(k, state, [{ kind: 'mood', amount: 40 }], 'player', { clampAsked: false, playerInput: input }).changes).toEqual([meter('mood', '_', { delta: 5 })])
  })

  it('adjust 回傳兩倍時先加倍再夾：夾的是範圍，不是寫的量', () => {
    const calls: Array<[string, number]> = []
    const doubled = testMeter({ kind: 'fame', keyed: 'district', adjust: (_s, key, d) => { calls.push([key, d]); return d * 2 } })
    const { k, state } = setup(doubled)
    expect(resolve(k, state, [{ kind: 'fame', amount: 30 }]).changes).toEqual([meter('fame', 'test', { delta: 60 })])
    expect(calls).toEqual([['test', 30]])
    // 先加倍再夾：+60 → 120 → 停在 100，變更寫的是實際動的量（100）
    const over = resolve(k, state, [{ kind: 'fame', amount: 60 }])
    expect(over.changes).toEqual([meter('fame', 'test', { delta: 100 })])
    expect(over.lines).toEqual(['心情（測試區）：+100'])
    // 已經有 50 再 +30：加倍成 60，夾在 100 → 實際 +50
    const half = withMeter(state, 'fame', 'test', 50)
    expect(resolve(k, half, [{ kind: 'fame', amount: 30 }]).changes).toEqual([meter('fame', 'test', { delta: 50 })])
    expect(applied(k, half, ...resolve(k, half, [{ kind: 'fame', amount: 30 }]).changes).meters.fame).toEqual({ test: 100 })
    // 往下扣也加倍：-30 → -60；已經有 50 的扣到 0
    expect(resolve(k, half, [{ kind: 'fame', amount: -30 }]).changes).toEqual([meter('fame', 'test', { delta: -50 })])
  })

  it('adjust 在 AI 的合計上限之前套：被放大的量才比 cap（AI 再怎麼被放大也不會超過）', () => {
    const { k, state } = setup(testMeter({ kind: 'hostility', keyed: 'faction', cap: { down: 10, up: 10 }, adjust: (_s, _k, d) => d * 2 }))
    // +8 加倍成 16，夾在上限 10
    const one = resolve(k, state, [{ kind: 'hostility', key: 'f_alpha', amount: 8 }], 'ai')
    expect(one.changes).toEqual([meter('hostility', 'f_alpha', { delta: 10 })])
    expect(one.clamps).toEqual([{ path: 'effects[0]', from: 16, to: 10, limit: 10, notice: '一次最多讓心情上升 10 點，實際上升了 10 點。' }])
    // 兩筆 +4：各加倍成 8，合計 16 超過 10，第二筆只剩 2
    const two = resolve(k, state, [{ kind: 'hostility', key: 'f_alpha', amount: 4 }, { kind: 'hostility', key: 'f_alpha', amount: 4 }], 'ai')
    expect(two.changes.map((c) => c.delta)).toEqual([8, 2])
    // 內建的不受 cap 管，加倍照算
    expect(resolve(k, state, [{ kind: 'hostility', key: 'f_alpha', amount: 8 }]).changes).toEqual([meter('hostility', 'f_alpha', { delta: 16 })])
    // resolve 吐出來的效果已經修正過：再丟進 resolve 不會修正第二次
    const again = resolve(k, state, one.effects)
    expect(again.changes).toEqual(one.changes)
  })

  it('adjust 回傳的小數四捨五入成整數（.5 往離 0 遠的那邊）；不是有限的數字丟錯', () => {
    const half = testMeter({ kind: 'fame', keyed: 'district', adjust: (_s, _k, d) => d * 0.5 })
    const { k, state } = setup(half)
    const at = withMeter(state, 'fame', 'test', 50)
    for (const [amount, delta] of [[3, 2], [1, 1], [-3, -2], [-1, -1], [4, 2], [-4, -2], [10, 5]] as const) {
      expect(resolve(k, at, [{ kind: 'fame', amount }]).changes, `${amount}`).toEqual([meter('fame', 'test', { delta })])
    }
    const { k: kb, state: sb } = setup(testMeter({ kind: 'bad', adjust: () => NaN }))
    expect(() => resolve(kb, sb, [{ kind: 'bad', amount: 1 }])).toThrow(/bad.*adjust 回傳了不是有限的數字/)
    // adjust 收到的是這一筆開始時的狀態、鍵與寫的量
    const seen: Array<[number, string, number]> = []
    const { k: k2, state: s2 } = setup(testMeter({ kind: 'spy', keyed: 'faction', adjust: (s, key, d) => { seen.push([s.meters.spy?.[key] ?? -1, key, d]); return d } }))
    resolve(k2, s2, [{ kind: 'spy', key: 'f_beta', amount: 3 }, { kind: 'spy', key: 'f_beta', amount: 4 }])
    expect(seen).toEqual([[-1, 'f_beta', 3], [3, 'f_beta', 4]])
  })

  it('範圍：實際動的量寫在效果與變更裡（已經到頭的整筆拿掉，不提醒）；同一批裡前面幾筆的結果算進去', () => {
    const { k, state } = setup(testMeter())
    const s = withMeter(state, 'mood', '_', 95)
    const near = resolve(k, s, [{ kind: 'mood', amount: 20 }])
    expect(near.changes).toEqual([meter('mood', '_', { delta: 5 })])
    expect(near.clamps).toEqual([])
    expect(near.lines).toEqual(['心情：+5'])
    const full = resolve(k, withMeter(state, 'mood', '_', 100), [{ kind: 'mood', amount: 20 }])
    expect(full.effects).toEqual([])
    expect(full.changes).toEqual([])
    expect(full.lines).toEqual([])
    const batch = resolve(k, state, [{ kind: 'mood', amount: 80 }, { kind: 'mood', amount: 80 }])
    expect(batch.changes.map((c) => c.delta)).toEqual([80, 20])
    expect(resolve(k, s, [{ kind: 'mood', amount: -200 }]).changes).toEqual([meter('mood', '_', { delta: -95 })])
    // 0 的量不產生任何東西
    expect(resolve(k, state, [{ kind: 'mood', amount: 0 }]).changes).toEqual([])
    // 加起來的結果有 floor 時也一樣
    const { k: kf, state: sf } = setup(testMeter({ kind: 'hostility', keyed: 'faction', floor: 'hostility_floor' }), testMeter({ kind: 'hostility_floor', keyed: 'faction' }))
    const f = applied(kf, sf, meter('hostility_floor', 'f_alpha', { set: 30 }), meter('hostility', 'f_alpha', { delta: 50 }))
    expect(resolve(kf, f, [{ kind: 'hostility', key: 'f_alpha', amount: -80 }]).changes).toEqual([meter('hostility', 'f_alpha', { delta: -20 })])
  })

  it('格式檢查：amount 要是整數；faction 與 npc 一定要寫 key；寫明的鍵要查得到；不分對象的 key 只能是 _', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', keyed: 'faction' }), testMeter({ kind: 'love', keyed: 'npc' }), testMeter({ kind: 'rep' }), testMeter({ kind: 'fame', keyed: 'district' }))
    const errs = (e: unknown) => resolve(k, state, [e]).errors.join('；')
    expect(errs({ kind: 'rep', amount: 1.5 })).toMatch(/amount 要是整數/)
    expect(errs({ kind: 'rep', amount: '3' })).toMatch(/amount 要是整數/)
    expect(errs({ kind: 'rep' })).toMatch(/amount 要是整數/)
    expect(errs({ kind: 'rep', amount: Infinity })).toMatch(/amount 要是整數/)
    expect(errs({ kind: 'favor', amount: 3 })).toMatch(/key 要寫明/)
    expect(errs({ kind: 'love', amount: 3 })).toMatch(/key 要寫明/)
    expect(errs({ kind: 'favor', key: 'f_zzz', amount: 3 })).toMatch(/查不到 f_zzz/)
    expect(errs({ kind: 'love', key: 'npc_zzz', amount: 3 })).toMatch(/查不到 npc_zzz/)
    expect(errs({ kind: 'fame', key: 'nowhere', amount: 3 })).toMatch(/查不到 nowhere/)
    expect(errs({ kind: 'rep', key: 'x', amount: 3 })).toMatch(/不分對象/)
    expect(errs({ kind: 'favor', key: '', amount: 3 })).toMatch(/key 要是非空的字串/)
    expect(errs({ kind: 'favor', key: 7, amount: 3 })).toMatch(/key 要是非空的字串/)
    // 合格的：具名的人、存檔裡的角色、區
    expect(errs({ kind: 'love', key: 'npc_ann', amount: 3 })).toBe('')
    expect(errs({ kind: 'love', key: 'pc', amount: 3 })).toBe('')
    expect(errs({ kind: 'fame', key: 'd2', amount: 3 })).toBe('')
    expect(errs({ kind: 'rep', key: '_', amount: 3 })).toBe('')
    // 有一筆不合格，整批不收
    const batch = resolve(k, state, [{ kind: 'rep', amount: 3 }, { kind: 'favor', amount: 3 }])
    expect(batch.changes).toEqual([])
    expect(batch.errors).toHaveLength(1)
    expect(batch.errors[0]).toMatch(/^effects\[1\]/)
  })

  it('不在任何一區（或不在地圖上）而省略了 key：這一筆沒有記下來，並用白話提醒', () => {
    const { k, state } = setup(testMeter({ kind: 'fame', keyed: 'district' }), testMeter({ kind: 'alert', keyed: 'map' }))
    const lost = { ...clone(state), location: {} }
    const r = resolve(k, lost, [{ kind: 'fame', amount: 5 }, { kind: 'alert', amount: 5 }])
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([])
    expect(r.clamps.map((c) => c.notice)).toEqual(['這一筆要算在你現在所在的區，但你現在不在任何一區，所以沒有記下來。', '這一筆要算在你現在所在的地圖，但你現在不在任何一張地圖上，所以沒有記下來。'])
    // 寫明了鍵的照常收
    expect(resolve(k, lost, [{ kind: 'fame', key: 'd2', amount: 5 }]).changes).toEqual([meter('fame', 'd2', { delta: 5 })])
  })

  it('結果的一行白話：量表的名字，勢力與區的名字放括號裡；不出現欄位名', () => {
    const { k, state } = setup(testMeter({ kind: 'hostility', name: '敵對值', keyed: 'faction' }), testMeter({ kind: 'fame', name: '豔名', keyed: 'district' }), testMeter({ kind: 'rep', name: '街頭信譽' }))
    const r = resolve(k, withMeter(state, 'rep', '_', 5), [
      { kind: 'hostility', key: 'f_alpha', amount: 5 }, { kind: 'fame', amount: 2 }, { kind: 'rep', amount: -3 }, { kind: 'hostility', key: 'f_beta', amount: 1 },
    ])
    expect(r.lines).toEqual(['敵對值（阿爾法）：+5', '豔名（測試區）：+2', '街頭信譽：−3', '敵對值（貝塔）：+1'])
    for (const l of r.lines) expect(l).not.toMatch(/amount|kind|key/)
  })

  it('resolve 回傳的變更一定套得上去，提交之後狀態對得上', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', keyed: 'faction', cap: { down: 5, up: 5 } }))
    const r = resolve(k, state, [{ kind: 'favor', key: 'f_alpha', amount: 4 }, { kind: 'favor', key: 'f_alpha', amount: 4 }], 'ai')
    const report = commitReport(k, state, draft(r.changes))
    expect(report.changes).toEqual(r.changes)
    expect(state.meters).toEqual({ favor: { f_alpha: 5 } })
  })
})

describe('同名的條件（驗收 5）', () => {
  it('{ kind, key, min: 40 } 在 39 不成立、40 成立；max 同理；沒寫 min 與 max 的永遠成立', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', keyed: 'faction' }))
    const test = (cond: Record<string, unknown>, s: GameState) => k.conditions.test(cond as { kind: string }, condCtx(k, s))
    const at = (v: number) => withMeter(state, 'favor', 'f_alpha', v)
    expect(test({ kind: 'favor', key: 'f_alpha', min: 40 }, at(39))).toBe(false)
    expect(test({ kind: 'favor', key: 'f_alpha', min: 40 }, at(40))).toBe(true)
    expect(test({ kind: 'favor', key: 'f_alpha', min: 40 }, at(100))).toBe(true)
    expect(test({ kind: 'favor', key: 'f_alpha', max: 40 }, at(40))).toBe(true)
    expect(test({ kind: 'favor', key: 'f_alpha', max: 40 }, at(41))).toBe(false)
    expect(test({ kind: 'favor', key: 'f_alpha', min: 10, max: 20 }, at(15))).toBe(true)
    expect(test({ kind: 'favor', key: 'f_alpha' }, at(0))).toBe(true)
    // 別的鍵與沒寫過的鍵：看起始值（0）
    expect(test({ kind: 'favor', key: 'f_beta', min: 1 }, at(80))).toBe(false)
    expect(test({ kind: 'favor', key: 'f_beta', max: 0 }, at(80))).toBe(true)
    // 組合
    expect(test({ kind: 'all', of: [{ kind: 'favor', key: 'f_alpha', min: 10 }, { kind: 'not', of: { kind: 'favor', key: 'f_alpha', min: 50 } }] }, at(30))).toBe(true)
  })

  it('key 省略時照 keyed；起始值不是 0 的量表沒寫過時也照起始值判', () => {
    const { k, state } = setup(testMeter({ kind: 'fame', keyed: 'district', start: 20 }), testMeter({ kind: 'rep', start: 5 }), testMeter({ kind: 'alert', keyed: 'map' }))
    const test = (cond: Record<string, unknown>, s: GameState) => k.conditions.test(cond as { kind: string }, condCtx(k, s))
    expect(test({ kind: 'fame', min: 20 }, state)).toBe(true)
    expect(test({ kind: 'fame', min: 21 }, state)).toBe(false)
    expect(test({ kind: 'fame', min: 30 }, withMeter(state, 'fame', 'test', 30))).toBe(true)
    // 換了區：看那一區
    expect(test({ kind: 'fame', min: 30 }, { ...withMeter(state, 'fame', 'test', 30), location: { district: 'd2' } })).toBe(false)
    expect(test({ kind: 'rep', min: 5, max: 5 }, state)).toBe(true)
    expect(test({ kind: 'rep', min: 6 }, withMeter(state, 'rep', '_', 6))).toBe(true)
    // 不在區、不在地圖：看起始值
    expect(test({ kind: 'fame', max: 20 }, { ...state, location: {} })).toBe(true)
    expect(test({ kind: 'alert', min: 1 }, state)).toBe(false)
    expect(test({ kind: 'alert', key: 'mp_1', min: 1 }, withMeter(state, 'alert', 'mp_1', 1))).toBe(true)
  })

  it('格式檢查：faction 與 npc 一定要寫 key；不分對象只能 _；min、max 要是數字', () => {
    const { k } = setup(testMeter({ kind: 'favor', keyed: 'faction' }), testMeter({ kind: 'love', keyed: 'npc' }), testMeter({ kind: 'rep' }), testMeter({ kind: 'fame', keyed: 'district' }))
    const v = (c: unknown) => k.conditions.validate(c).join('；')
    expect(v({ kind: 'favor', key: 'f_alpha', min: 40 })).toBe('')
    expect(v({ kind: 'favor' })).toMatch(/key 要寫明/)
    expect(v({ kind: 'love', min: 1 })).toMatch(/key 要寫明/)
    expect(v({ kind: 'love', key: 'npc_ann', max: 3 })).toBe('')
    expect(v({ kind: 'favor', key: '', min: 1 })).toMatch(/key 要是非空的字串/)
    expect(v({ kind: 'rep' })).toBe('')
    expect(v({ kind: 'rep', key: '_', min: 0 })).toBe('')
    expect(v({ kind: 'rep', key: 'x' })).toMatch(/不分對象/)
    expect(v({ kind: 'fame', min: 3 })).toBe('')
    expect(v({ kind: 'rep', min: '3' })).toMatch(/min、max 要是數字/)
    expect(v({ kind: 'rep', max: NaN })).toMatch(/min、max 要是數字/)
    // 組合裡的也檢查
    expect(v({ kind: 'any', of: [{ kind: 'rep', min: 1 }, { kind: 'favor' }] })).toMatch(/requires\.of\[1\]/)
    // 沒寫 key 的 faction 條件直接 test：丟錯，寫出是哪一種
    expect(() => k.conditions.test({ kind: 'favor', min: 1 }, condCtx(k, makeState()))).toThrow(/favor.*要寫明 key/)
  })
})

describe('沒有人定義的種類（驗收 6）：那個功能這一局沒裝', () => {
  it('變更被擋下、狀態不變；效果的格式檢查說沒有這種效果；條件說沒有這種條件；meterOf 回傳 0、不丟錯', () => {
    const { k, state } = setup(testMeter())
    const before = clone(state)
    expect(() => commitReport(k, state, draft([meter('hostility', 'f_alpha', { delta: 5 })]))).toThrow(/hostility/)
    expect(state).toEqual(before)
    expect(resolve(k, state, [{ kind: 'hostility', key: 'f_alpha', amount: 5 }]).errors[0]).toMatch(/不在封閉清單裡/)
    expect(k.effects.validate([{ kind: 'hostility', amount: 1 }], effectCtx(k, state, { source: 'builtin' }))[0]).toMatch(/不在封閉清單裡/)
    expect(k.conditions.validate({ kind: 'hostility', min: 1 })[0]).toMatch(/沒有 "hostility" 這種條件/)
    expect(() => k.conditions.test({ kind: 'hostility', min: 1 }, condCtx(k, state))).toThrow(/沒有 hostility 這種條件/)
    for (const [kind, key] of [['hostility', 'f_alpha'], ['hostility', undefined], ['affinity', 'npc_ann'], ['constructor', undefined], ['toString', 'x']] as const) {
      expect(meterOf(k, state, kind, key), `${kind} ${String(key)}`).toBe(0)
    }
  })

  it('存檔裡有沒人定義的種類：照樣讀得進來、留著、存回去一樣；之後那個功能裝上了就接得起來', () => {
    const state = makeState({ patch: { meters: { hostility: { f_alpha: 40 }, gone: { x: 1 } } } })
    const text = packSave(state, saveMeta(state, 'manual', 't'))
    const r = unpackSave(text)
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.file.state.meters).toEqual({ hostility: { f_alpha: 40 }, gone: { x: 1 } })
    const again = unpackSave(packSave(r.file.state, r.file.meta))
    expect(again.ok && again.file.state).toEqual(r.file.state)
    // 沒裝的那一局：讀是 0，動它被擋下，其他的事照做
    const { game } = makeGame()
    expect(game.load(text)).toBeNull()
    expect(game.state.meters.hostility).toEqual({ f_alpha: 40 })
    expect(meterOf(game.k, game.state, 'hostility', 'f_alpha')).toBe(0)
    expect(() => game.commit(draft([meter('hostility', 'f_alpha', { delta: 1 })]))).toThrow(ChangeError)
    game.commit(draft([{ op: 'flag', key: 'ok', value: true }]))
    expect(game.state.meters.gone).toEqual({ x: 1 })
    // 裝上那個功能的一局：接得起來
    const { game: g2 } = makeGame({ features: [meterFeature(testMeter({ kind: 'hostility', keyed: 'faction' }))], content: [METER_CONTENT] })
    expect(g2.load(text)).toBeNull()
    expect(meterOf(g2.k, g2.state, 'hostility', 'f_alpha')).toBe(40)
  })
})

describe('meterOf', () => {
  it('faction 與 npc 的量表一定要寫 key（沒寫是呼叫的人的錯，丟錯並寫出量表）；district、map、none 照 keyed', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', name: '好感', keyed: 'faction' }), testMeter({ kind: 'love', keyed: 'npc' }), testMeter({ kind: 'fame', keyed: 'district', start: 3 }), testMeter({ kind: 'rep', start: 4 }))
    expect(() => meterOf(k, state, 'favor')).toThrow(/favor（好感）要寫明 key/)
    expect(() => meterOf(k, state, 'love')).toThrow(/love.*要寫明 key/)
    expect(meterOf(k, state, 'favor', 'f_alpha')).toBe(0)
    expect(meterOf(k, state, 'fame')).toBe(3)
    expect(meterOf(k, state, 'rep')).toBe(4)
    // 不分對象的：寫了別的鍵就是讀那個鍵（沒寫過，起始值）
    expect(meterOf(k, state, 'rep', 'other')).toBe(4)
  })

  it('讀不到原型鏈上的東西：種類或鍵叫 constructor、toString 也照常（沒寫過是起始值，寫了就是寫的）', () => {
    const { k, state } = setup(testMeter({ kind: 'constructor', start: 4 }), testMeter({ kind: 'favor', keyed: 'faction', start: 2 }))
    expect(meterOf(k, state, 'constructor')).toBe(4)
    expect(meterOf(k, state, 'favor', 'constructor')).toBe(2)
    const s = applied(k, state, meter('constructor', '_', { delta: 5 }))
    expect(s.meters).toEqual({ constructor: { _: 9 } })
    expect(Object.hasOwn(s.meters, 'constructor')).toBe(true)
    expect(meterOf(k, s, 'constructor')).toBe(9)
    expect(meterOf(k, s, 'favor', 'toString')).toBe(2)
  })

  it('meterProblems：每一種有人定義的量表的值都是整數、在範圍內；沒人定義的種類與 floor 不看', () => {
    const { k, state } = setup(testMeter({ kind: 'favor', keyed: 'faction' }))
    expect(meterProblems(k.meters, state)).toEqual([])
    const bad = { ...state, meters: { favor: { f_alpha: 150, f_beta: 1.5, npc_ann: -1, ok: 5 }, ghost: { x: 99999 } } }
    expect(meterProblems(k.meters, bad).sort()).toEqual([
      'meters.favor.f_alpha：150 超出範圍 0～100', 'meters.favor.f_beta：1.5 不是整數', 'meters.favor.npc_ann：-1 超出範圍 0～100',
    ].sort())
  })
})

describe('性質：任意一串變更與效果之後，每一個值都在範圍內', () => {
  const kinds = [
    testMeter({ kind: 'a', keyed: 'faction', min: -100, max: 100, start: 10 }),
    testMeter({ kind: 'b', keyed: 'faction', floor: 'c', max: 100 }),
    testMeter({ kind: 'c', keyed: 'faction', max: 100 }),
    testMeter({ kind: 'd', keyed: 'faction', max: Infinity }),
  ]
  const change = fc.record({
    kind: fc.constantFrom('a', 'b', 'c', 'd'), key: fc.constantFrom('f_alpha', 'f_beta'),
    how: fc.oneof(fc.integer({ min: -300, max: 300 }).map((delta) => ({ delta })), fc.integer({ min: -300, max: 300 }).map((set) => ({ set }))),
  })

  it('變更：套任意一串，每一步之後的值都等於「夾在 min～max、下限提高到下限那張同一個鍵的值」的算法，而且都在範圍內', () => {
    const { k, state } = setup(...kinds)
    fc.assert(fc.property(fc.array(change, { maxLength: 20 }), (list) => {
      let s = state
      for (const c of list) {
        const def = k.meters.get(c.kind)!
        const cur = meterOf(k, s, c.kind, c.key)
        const target = 'set' in c.how ? c.how.set : cur + c.how.delta
        const lo = c.kind === 'b' ? Math.max(def.min, meterOf(k, s, 'c', c.key)) : def.min
        const hi = Math.min(def.max, Number.MAX_SAFE_INTEGER)
        s = applied(k, s, meter(c.kind, c.key, c.how))
        if (meterOf(k, s, c.kind, c.key) !== Math.min(hi, Math.max(lo, target))) return false
        if (meterProblems(k.meters, s).length) return false
      }
      return true
    }))
  })

  it('效果：任意一批（內建與 AI、有 cap 與沒有）解出來的變更一定套得上去；AI 的每一組實際淨變化不超過 cap', () => {
    const capped = [
      testMeter({ kind: 'a', keyed: 'faction', min: -100, max: 100, start: 10, cap: { down: 10, up: 7 }, adjust: (_s, _k, d) => d * 2 }),
      testMeter({ kind: 'b', keyed: 'faction', cap: { down: 5, up: 5 } }),
    ]
    const { k, state } = setup(...capped)
    const eff = fc.record({ kind: fc.constantFrom('a', 'b'), key: fc.constantFrom('f_alpha', 'f_beta'), amount: fc.integer({ min: -40, max: 40 }) })
    fc.assert(fc.property(fc.array(eff, { maxLength: 12 }), fc.integer({ min: 0, max: 100 }), (list, start) => {
      const s0 = withMeter(withMeter(state, 'a', 'f_alpha', start), 'b', 'f_beta', start)
      const r = resolve(k, s0, list, 'ai')
      if (r.errors.length) return false
      const s1 = applied(k, s0, ...r.changes)
      if (meterProblems(k.meters, s1).length) return false
      const net = new Map<string, number>()
      for (const c of r.changes) net.set(`${String(c.kind)}:${String(c.key)}`, (net.get(`${String(c.kind)}:${String(c.key)}`) ?? 0) + (c.delta as number))
      for (const [group, n] of net) {
        const cap = capped.find((d) => group.startsWith(`${d.kind}:`))!.cap!
        if (n > cap.up || n < -cap.down) return false
      }
      return true
    }), { numRuns: 300 })
  })
})

describe('存檔第 3 版（驗收 7）', () => {
  it('STATE_VERSION 與 SAVE_VERSION 是 3；遷移步驟表每一版一步、不缺號，第 2 版升第 3 版有一步', () => {
    expect(STATE_VERSION).toBe(3)
    expect(SAVE_VERSION).toBe(3)
    expect(MIGRATIONS.map((m) => m.from)).toEqual([1, 2])
    expect(MIGRATIONS.find((m) => m.from === 2)!.note).toMatch(/meters/)
    expect(blankState(1).meters).toEqual({})
    expect(blankState(1).version).toBe(3)
  })

  it('第 2 版的舊檔（tests/fixtures/saves/v2-m1.json）讀得進來、meters 是空的、其餘原樣；裡面的第 2 版快照回得去', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(new URL('../fixtures/saves/v2-m1.json', import.meta.url), 'utf8')
    const old = JSON.parse(text) as { version: number; state: Record<string, any> }
    expect(old.version).toBe(2)
    expect(old.state.meters).toBeUndefined()
    const r = unpackSave(text)
    expect(r).toMatchObject({ ok: true, fromVersion: 2 })
    if (!r.ok) return
    const s = r.file.state
    expect(s.version).toBe(3)
    expect(r.file.version).toBe(3)
    expect(s.meters).toEqual({})
    for (const k of Object.keys(old.state)) if (k !== 'version') expect(s[k as keyof typeof s], k).toEqual(old.state[k])
    // 讀進來的那一份存得下去、再讀回來一模一樣
    const again = unpackSave(packSave(s, r.file.meta))
    expect(again.ok && again.file.state).toEqual(s)
    // Game 讀得進來；之後可以寫量表；第 2 版的快照（階段開始時）回得去，回去之後是第 3 版的狀態、量表是空的
    const { game } = makeGame({ features: [meterFeature(testMeter())] })
    expect(game.load(text)).toBeNull()
    expect(game.state.money).toEqual(old.state.money)
    expect(game.state.meters).toEqual({})
    game.commit(draft([meter('mood', '_', { delta: 9 })]))
    expect(meterOf(game.k, game.state, 'mood')).toBe(9)
    expect(game.rewindToKind('stage', '回到階段。')).toBeNull()
    expect(game.state.version).toBe(3)
    expect(game.state.meters).toEqual({})
    expect(game.state.reports.some((x) => x.retracted)).toBe(true)
  })

  it('第 1 版的舊檔也讀得進來（一路升到第 3 版），meters 是空的', async () => {
    const { readFileSync } = await import('node:fs')
    const r = unpackSave(readFileSync(new URL('../fixtures/saves/v1-m0.json', import.meta.url), 'utf8'))
    expect(r).toMatchObject({ ok: true, fromVersion: 1, file: { version: 3 } })
    if (r.ok) expect(r.file.state.meters).toEqual({})
  })

  it('第 3 版存了再讀，數字一樣；Game.save、Game.load 也是', () => {
    const { game } = makeGame({ features: [meterFeature(testMeter({ kind: 'favor', keyed: 'faction' }), testMeter({ kind: 'rep' }))], content: [METER_CONTENT] })
    game.commit(draft([meter('favor', 'f_alpha', { delta: 33 }), meter('favor', 'f_beta', { set: 7 }), meter('rep', '_', { delta: 12 })]))
    const hash = stateHash(game.state)
    const text = game.save('manual', 'now')
    expect(JSON.parse(text).version).toBe(3)
    expect(JSON.parse(text).state.meters).toEqual({ favor: { f_alpha: 33, f_beta: 7 }, rep: { _: 12 } })
    game.commit(draft([meter('favor', 'f_alpha', { delta: 50 })]))
    expect(game.state.meters.favor!.f_alpha).toBe(83)
    expect(game.load(text)).toBeNull()
    expect(stateHash(game.state)).toBe(hash)
    expect(game.state.meters).toEqual({ favor: { f_alpha: 33, f_beta: 7 }, rep: { _: 12 } })
    const r = unpackSave(text)
    expect(r.ok && r.file.state.meters).toEqual({ favor: { f_alpha: 33, f_beta: 7 }, rep: { _: 12 } })
  })

  it('結構檢查：meters 要是「種類 → 鍵 → 整數」；沒有 meters 的存檔（缺欄位）補空表', () => {
    const base = () => clone(makeState()) as unknown as Record<string, unknown>
    const with_ = (meters: unknown) => validateState({ ...base(), meters })
    expect(with_({})).toEqual([])
    expect(with_({ x: { a: 1, b: -5 } })).toEqual([])
    expect(with_([])).toEqual([expect.stringContaining('meters')])
    expect(with_(null)).toEqual([expect.stringContaining('meters')])
    expect(with_({ x: 5 })).toEqual([expect.stringContaining('meters.x')])
    expect(with_({ x: { a: 1.5 } })).toEqual([expect.stringContaining('meters.x.a')])
    expect(with_({ x: { a: '3' } })).toEqual([expect.stringContaining('meters.x.a')])
    expect(with_({ x: { a: Infinity } })).toEqual([expect.stringContaining('meters.x.a')])
    expect(with_({ x: { '': 1 } })).toEqual([expect.stringContaining('meters.x.')])
    // 壞的存檔整筆不讀
    const file = JSON.parse(packSave(makeState(), saveMeta(makeState(), 'manual', 't')))
    file.state.meters = { x: { a: 2.5 } }
    expect(unpackSave(JSON.stringify(file))).toMatchObject({ ok: false, error: expect.stringContaining('存檔壞了') })
    delete file.state.meters
    const r = unpackSave(JSON.stringify(file))
    expect(r.ok && r.file.state.meters).toEqual({})
  })
})

describe('接上提交、回退與快照', () => {
  it('回退一步量表跟著回去；回到快照量表跟著回去（快照存的是整份狀態）', () => {
    const { game } = makeGame({ features: [meterFeature(testMeter())] })
    game.commit(draft([meter('mood', '_', { delta: 10 })]))
    const take: Change = { op: 'snapshot.take', kind: 'stage', label: '階段', owner: 'cm_1' }
    game.commit(draft([take, meter('mood', '_', { delta: 20 })]))
    expect(meterOf(game.k, game.state, 'mood')).toBe(30)
    game.commit(draft([meter('mood', '_', { delta: 40 })]))
    expect(meterOf(game.k, game.state, 'mood')).toBe(70)
    // 回到快照：快照是「第二份報告套用之前」，那時是 10
    expect(game.rewindToKind('stage', '回到階段。')).toBeNull()
    expect(meterOf(game.k, game.state, 'mood')).toBe(10)
    // 回退
    game.commit(draft([meter('mood', '_', { delta: 5 })]))
    expect(meterOf(game.k, game.state, 'mood')).toBe(15)
    expect(game.undoSteps()).toBe(true)
    expect(meterOf(game.k, game.state, 'mood')).toBe(10)
  })

  it('別的變更（時間、錢、旗標、計數器）不動量表（量表只經由 meter 變更改）', () => {
    const { game } = makeGame({ features: [meterFeature(testMeter())] })
    game.commit(draft([meter('mood', '_', { delta: 10 })]))
    game.commit(draft([{ op: 'time', minutes: 600 }, { op: 'cash', delta: 0 }, { op: 'flag', key: 'x', value: true }, { op: 'counter', key: 'n', delta: 3 }]))
    expect(game.state.meters).toEqual({ mood: { _: 10 } })
  })
})
