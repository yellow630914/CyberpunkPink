// 驗收測試：dev/work/M2-closeout.md 的核心部分（第 1～4 項的核心機制、第 10 項）。
// 第 1 項、第 2 項：活動的放行可以帶條件（k.activity.allow 的第四個參數）、開活動時把「要開的是哪一段」交給放行的判斷（launch）；
// 第 3 項：回到快照之後 report.after 接著提交的報告進回傳與通知；
// 第 4 項：special_map 的種類是 block 或 bridge 時不要求遭遇點；
// 第 10 項：規則表（overridable）可以被後載入的包取代，內容類 id 重複照舊擋下，loadPack 整包不收不會載到一半。
// 內容一律用測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Launch, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, ContentRegistry, Probe, STREET_MAP_KINDS, isStreetMapKind, sheetProblems, specialMapProblems } from '../../src'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK } from '../../data'
import { makeGame } from '../../src/testkit'

const draft = (action: string, o: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'action', action, location: { district: 'test', block: 'room' }, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: `${action}。` }, ...o,
})

// ===================================================================================================================
// 第 1、2 項：帶條件的放行與 launch
// ===================================================================================================================

/** 一種測試用的活動 x：旗標 x 開著就在進行；進行中什麼都不放行，除非另外加了放行。 */
const X: Feature = {
  id: 'x_stub',
  install(k) {
    k.activity.define({
      kind: 'x', owner: 'x_stub', order: 50,
      active: (s) => (s.flags.x ? { id: 'x1', label: 'X 進行中' } : null),
      allow: ['commit:test.'],
      reason: () => 'X 進行中，先把它做完。',
    })
    k.activity.define({
      kind: 'y', owner: 'x_stub', order: 60,
      active: () => null,
      allow: [],
      reason: () => 'Y 進行中。',
      start: (_k, state, setup) => [draft('y.open', { location: { ...state.location }, changes: [{ op: 'flag', key: 'y_open', value: true }], outcome: { result: 'open', summary: `Y 開了（${JSON.stringify(setup)}）。` } })],
    })
  },
}
const make = (features: Feature[] = [X]) => makeGame({ features }).game
const from = (by: string): Launch => ({ kind: 'y', setup: {}, origin: { by } })

describe('第 1 項：帶條件的放行（k.activity.allow(kind, prefix, owner, when)）', () => {
  it('前綴符合而且 when 回答 true 才放行；條件看的是現在的狀態；沒有條件的照舊一律放行', () => {
    const g = make()
    g.state.flags.x = true
    g.k.activity.allow('x', 'chain:free_action', 'x_stub', (s) => s.flags.open === true)
    g.k.activity.allow('x', 'commit:plain.', 'x_stub')
    expect(g.blockOf('chain:free_action')).toBe('X 進行中，先把它做完。')
    g.state.flags.open = true
    expect(g.blockOf('chain:free_action')).toBeNull()
    g.state.flags.open = false
    expect(g.blockOf('chain:free_action')).toBe('X 進行中，先把它做完。')
    // 前綴不符合就算條件成立也不放行；沒有條件的放行不受影響
    g.state.flags.open = true
    expect(g.blockOf('chain:other')).toBe('X 進行中，先把它做完。')
    g.state.flags.open = false
    expect(g.blockOf('commit:plain.go')).toBeNull()
    // 活動沒有進行中：什麼都不擋
    g.state.flags.x = false
    expect(g.blockOf('chain:free_action')).toBeNull()
  })

  it('那個活動還沒登記時加的條件放行先記著，登記時併進去（條件不會變成無條件）', () => {
    const g = make([])
    g.k.activity.allow('late', 'chain:free_action', 'x_stub', (s) => s.flags.open === true)
    g.k.activity.allow('late', 'commit:late.', 'x_stub')
    g.k.activity.define({ kind: 'late', owner: 'x_stub', order: 10, active: (s) => (s.flags.late ? { id: 'l', label: '晚到的活動' } : null), allow: [], reason: () => '晚到的活動進行中。' })
    g.state.flags.late = true
    expect(g.blockOf('chain:free_action')).toBe('晚到的活動進行中。')
    g.state.flags.open = true
    expect(g.blockOf('chain:free_action')).toBeNull()
    expect(g.blockOf('commit:late.x')).toBeNull()
  })

  it('條件的放行掛在登記的複製上：同一個定義物件登記在兩個核心上，彼此不影響', () => {
    const a = make(), b = make()
    a.state.flags.x = true
    b.state.flags.x = true
    a.k.activity.allow('x', 'chain:free_action', 'x_stub', () => true)
    expect(a.blockOf('chain:free_action')).toBeNull()
    expect(b.blockOf('chain:free_action')).toBe('X 進行中，先把它做完。')
  })
})

describe('第 2 項：開活動時的 launch 交給放行的判斷（Game.launch、報告的 launch、Game.startBattle 都帶）', () => {
  const ok = (_s: GameState, _d: string, _dr: ReportDraft | undefined, launch?: Launch): boolean => launch?.origin?.by === 'ok'

  it('blockOf 的第三個參數：沒給 launch 的條件看不到來歷，不放行', () => {
    const g = make()
    g.state.flags.x = true
    g.k.activity.allow('x', 'y.start', 'x_stub', ok)
    expect(g.blockOf('y.start')).toBe('X 進行中，先把它做完。')
    expect(g.blockOf('y.start', undefined, from('no'))).toBe('X 進行中，先把它做完。')
    expect(g.blockOf('y.start', undefined, { kind: 'y', setup: {} })).toBe('X 進行中，先把它做完。')
    expect(g.blockOf('y.start', undefined, from('ok'))).toBeNull()
  })

  it('Game.launch：origin 是 ok 的開得起來，別人的被擋下、狀態不動', () => {
    const g = make()
    g.state.flags.x = true
    g.k.activity.allow('x', 'y.start', 'x_stub', ok)
    expect(() => g.launch('y', { n: 1 }, { by: 'no' })).toThrow(ActionBlocked)
    expect(() => g.launch('y', { n: 1 })).toThrow(ActionBlocked)
    expect(g.state.flags.y_open).toBeUndefined()
    const [r] = g.launch('y', { n: 1 }, { by: 'ok' })
    expect(r!.action).toBe('y.open')
    expect(g.state.flags.y_open).toBe(true)
  })

  it('報告帶的 launch（Game.commit 的 launchIn）：同一份規矩；被擋下整步不成立', () => {
    const g = make()
    g.state.flags.x = true
    g.k.activity.allow('x', 'y.start', 'x_stub', ok)
    const before = JSON.stringify(g.state)
    expect(() => g.commit(draft('test.go', { launch: [from('no')] }))).toThrow(ActionBlocked)
    expect(JSON.stringify(g.state)).toBe(before)
    const reports = g.commit(draft('test.go', { launch: [from('ok')] }))
    expect(reports.map((r) => r.action)).toEqual(['test.go', 'y.open'])
  })

  it('Game.startBattle 也帶 launch（kind 是 battle、沒有 origin）：條件放行看得到它是開戰', () => {
    const g = make()
    g.state.flags.x = true
    const seen: Array<Launch | undefined> = []
    g.k.activity.allow('x', 'battle.start', 'x_stub', (_s, _d, _dr, launch) => { seen.push(launch); return false })
    expect(() => g.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'actor', id: 'pc' }] } as never)).toThrow(ActionBlocked)
    expect(seen[0]).toMatchObject({ kind: 'battle' })
    expect(seen[0]!.origin).toBeUndefined()
  })
})

describe('permits：這一種活動放不放行這件事（導演問「車上還能不能開事件」用）', () => {
  it('沒有登記、沒有進行中：放行；進行中看前綴、條件與 allows', () => {
    const g = make()
    expect(g.k.activity.permits(g.state, 'nowhere', 'event.start')).toBe(true)
    expect(g.k.activity.permits(g.state, 'x', 'event.start')).toBe(true) // 還沒開始
    g.state.flags.x = true
    expect(g.k.activity.permits(g.state, 'x', 'event.start')).toBe(false)
    g.k.activity.allow('x', 'event.start', 'x_stub', ok2)
    expect(g.k.activity.permits(g.state, 'x', 'event.start')).toBe(false)
    expect(g.k.activity.permits(g.state, 'x', 'event.start', undefined, from('ok'))).toBe(true)
    expect(g.k.activity.permits(g.state, 'x', 'commit:test.a')).toBe(true)
    // 和 blockOf 一致
    expect(g.blockOf('event.start', undefined, from('ok'))).toBeNull()
  })
  function ok2(_s: GameState, _d: string, _dr: ReportDraft | undefined, launch?: Launch): boolean {
    return launch?.origin?.by === 'ok'
  }
})

// ===================================================================================================================
// 第 3 項：回到快照之後接著提交的報告
// ===================================================================================================================

describe('第 3 項：回到快照之後 report.after 接著提交的報告也在回傳與通知裡', () => {
  const FOLLOW: Feature = {
    id: 'follow_stub',
    install(k) {
      k.hooks.on('report.after', 'follow_stub', ({ report }) => (report.action === 'rewind' ? [draft('test.after_rewind', { outcome: { result: 'noted', summary: '回到快照之後的後續。' } })] : undefined))
    },
  }
  const entry = (): ReportDraft => draft('test.entry', { changes: [{ op: 'snapshot.take', kind: 'entry', label: '入口' }] })
  const later = (): ReportDraft => draft('test.later', { changes: [{ op: 'cash', delta: 100 }] })
  const setup = () => {
    const g = makeGame({ features: [FOLLOW] }).game
    const heard: Report[][] = []
    g.subscribe((_s, reports) => { heard.push(reports) })
    g.commit(entry())
    g.commit(later())
    heard.length = 0
    return { g, heard }
  }

  it('帶 rewind 的報告：回傳是 [報告本身（標成被收回）、交代回到快照的、接著提交的]，通知的也是；接著提交的報告在紀錄裡、沒有被收回', () => {
    const { g, heard } = setup()
    const reports = g.commit(draft('test.retreat', { rewind: { kind: 'entry', summary: '你撤退了。' } }))
    expect(reports.map((r) => r.action)).toEqual(['test.retreat', 'rewind', 'test.after_rewind'])
    expect(reports[0]).toMatchObject({ retracted: true })
    expect(reports[2]).toMatchObject({ outcome: { summary: '回到快照之後的後續。' } })
    expect(reports[2]!.retracted).toBeUndefined()
    expect(heard).toHaveLength(1)
    expect(heard[0]!.map((r) => r.action)).toEqual(['test.retreat', 'rewind', 'test.after_rewind'])
    expect(g.state.reports.at(-1)!.action).toBe('test.after_rewind')
    expect(g.state.reports.at(-2)!.action).toBe('rewind')
    expect(g.state.money.cash).toBe(0) // 回到入口
  })

  it('Game.rewindToKind 與 Game.rewind：通知帶交代回到快照的報告加後續（沒有回傳報告的介面看通知）', () => {
    const a = setup()
    expect(a.g.rewindToKind('entry', '你回到入口。')).toBeNull()
    expect(a.heard).toHaveLength(1)
    expect(a.heard[0]!.map((r) => r.action)).toEqual(['rewind', 'test.after_rewind'])
    const b = setup()
    const raw = b.g.state.snapshots.find((x) => x.kind === 'entry')!.raw
    expect(b.g.rewind(raw, { summary: '你回去了。' }, [])).toBeNull()
    expect(b.heard[0]!.map((r) => r.action)).toEqual(['rewind', 'test.after_rewind'])
  })

  it('沒有人接著提交時和以前一樣：只有交代回到快照的那一份', () => {
    const g = makeGame({ features: [] }).game
    g.commit(entry())
    g.commit(later())
    const reports = g.commit(draft('test.retreat', { rewind: { kind: 'entry', summary: '你撤退了。' } }))
    expect(reports.map((r) => r.action)).toEqual(['test.retreat', 'rewind'])
  })
})

// ===================================================================================================================
// 第 4 項：街區地圖不要求遭遇點
// ===================================================================================================================

describe('第 4 項：special_map 的 kind 是 block 或 bridge 時每張圖不要求遭遇點', () => {
  const sheet = (spots: Array<{ id: string; at: [number, number]; cover: string }> = []) => ({
    id: 's1', name: '測試街', size: [5, 3] as [number, number], layout: ['#####', spots.length ? 'E.1.2' : 'E...#', '#####'].map((r, i) => (i === 1 && spots.length === 0 ? 'E....' : r)),
    cells: [{ id: 'E1', at: [0, 1] as [number, number], mark: 'E', name: '入口' }],
    ...(spots.length ? { spots } : {}),
  })
  const SPOTS = [{ id: '!1', at: [2, 1] as [number, number], cover: 'sparse' }, { id: '!2', at: [4, 1] as [number, number], cover: 'sparse' }]
  const map = (kind: string, spots = SPOTS) => ({ id: 'm_t', kind, size: [5, 3], sheets: [sheet(spots)] })

  it('街區（block）與橋接區（bridge）的地圖沒有遭遇點也合格；有也合格', () => {
    expect(STREET_MAP_KINDS).toEqual(['block', 'bridge'])
    for (const kind of ['block', 'bridge']) {
      expect(isStreetMapKind(kind)).toBe(true)
      expect(specialMapProblems(map(kind, []))).toEqual([])
      expect(specialMapProblems(map(kind))).toEqual([])
    }
  })

  it('其他種類（副本的模板）照舊每一張至少 2 個遭遇點；街區地圖的其他檢查（入口走得到、標記對得上）照舊', () => {
    for (const kind of ['office_small', 'street', 'club']) {
      expect(isStreetMapKind(kind)).toBe(false)
      expect(specialMapProblems(map(kind, [])).join('\n')).toMatch(/至少要有 2 個遭遇點/)
      expect(specialMapProblems(map(kind))).toEqual([])
    }
    expect(isStreetMapKind(undefined)).toBe(false)
    const broken = map('block', [])
    broken.sheets[0]!.cells = [{ id: 'E1', at: [3, 1], mark: 'E', name: '入口' }] // 版面上的 E 在 0,1
    expect(specialMapProblems(broken).join('\n')).toMatch(/E1/)
  })

  it('sheetProblems 的 minSpots：單張圖的檢查也可以指定；預設 2', () => {
    const s = sheet([])
    expect(sheetProblems(s as never).join('\n')).toMatch(/至少要有 2 個遭遇點/)
    expect(sheetProblems(s as never, [], { minSpots: 0 })).toEqual([])
    expect(sheetProblems(s as never, [], { minSpots: 3 }).join('\n')).toMatch(/至少要有 3 個遭遇點/)
  })
})

// ===================================================================================================================
// 第 10 項：規則表可以被後載入的包取代
// ===================================================================================================================

describe('第 10 項：內容登錄表的 overridable（規則表）', () => {
  const registry = () => {
    const r = new ContentRegistry()
    r.defineKind({ kind: 'thing_rule', owner: 't', overridable: true, validate: (e) => (typeof e.n === 'number' ? [] : ['n 要是數字']) })
    r.defineKind({ kind: 'thing', owner: 't', validate: () => [] })
    return r
  }
  const pack = (id: string, content: ContentPack['content']): ContentPack => ({ id, content })

  it('規則表：後載入的包同一個 id 整筆取代前面的（不是合併：沒寫的欄位不見了）；沒重複的照舊加進來', () => {
    const r = registry()
    r.loadPack(pack('core', { thing_rule: [{ id: 'default', n: 1, extra: 'a' }, { id: 'other', n: 5 }] }))
    r.loadPack(pack('mine', { thing_rule: [{ id: 'default', n: 2 }, { id: 'new', n: 9 }] }))
    expect(r.get('thing_rule', 'default')).toEqual({ id: 'default', n: 2 })
    expect(r.get('thing_rule', 'other')).toEqual({ id: 'other', n: 5 })
    expect(r.get('thing_rule', 'new')).toEqual({ id: 'new', n: 9 })
    expect(r.list('thing_rule').map((e) => e.id)).toEqual(['default', 'other', 'new'])
    expect(r.isOverridable('thing_rule')).toBe(true)
    expect(r.isOverridable('thing')).toBe(false)
    expect(r.isOverridable('nowhere')).toBe(false)
  })

  it('取代的那一筆也要過格式檢查：不合格整包不收，原本的那一筆還在', () => {
    const r = registry()
    r.loadPack(pack('core', { thing_rule: [{ id: 'default', n: 1 }] }))
    expect(() => r.loadPack(pack('mine', { thing_rule: [{ id: 'default', n: 'x' }] }))).toThrow(/n 要是數字/)
    expect(r.get('thing_rule', 'default')).toEqual({ id: 'default', n: 1 })
  })

  it('同一個包裡 id 重複照舊擋下（規則表也一樣）', () => {
    const r = registry()
    expect(() => r.loadPack(pack('mine', { thing_rule: [{ id: 'default', n: 1 }, { id: 'default', n: 2 }] }))).toThrow(/重複/)
  })

  it('內容類（不是規則表）：id 已經載入過照舊整包擋下；整包不收，同一包裡別的種類也沒有載到一半', () => {
    const r = registry()
    r.loadPack(pack('core', { thing: [{ id: 'a' }] }))
    let error: unknown
    try {
      r.loadPack(pack('mine', { thing_rule: [{ id: 'fresh', n: 1 }], thing: [{ id: 'a' }] }))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ContentError)
    expect((error as ContentError).problems.join('\n')).toContain('thing/a：id 重複')
    expect(r.has('thing_rule', 'fresh')).toBe(false) // 規則表那一批沒有先載進去
    expect(r.list('thing').map((e) => e.id)).toEqual(['a'])
  })

  it('load 單獨呼叫：規則表預設取代、其他種類照舊擋；opts.replace 照舊可以強制', () => {
    const r = registry()
    r.load('thing_rule', [{ id: 'default', n: 1 }])
    r.load('thing_rule', [{ id: 'default', n: 2 }])
    expect(r.get('thing_rule', 'default')).toMatchObject({ n: 2 })
    r.load('thing', [{ id: 'a' }])
    expect(() => r.load('thing', [{ id: 'a' }])).toThrow(/id 重複/)
    expect(() => r.load('thing', [{ id: 'a' }], { replace: true })).not.toThrow()
    expect(() => r.load('thing_rule', [{ id: 'default', n: 3 }], { replace: false })).toThrow(/id 重複/)
  })

  it('哪些種類是規則表：所有 *_rule、事件範圍、設施種類、店的種類、戰鬥的模式與狀態……；技能、物品、敵人、事件、勢力這類內容不是', () => {
    const g = new Game({ features: allFeatures(), content: [CORE_PACK] })
    const kinds = g.k.content.kindIds()
    const expectRules = [
      ...kinds.filter((k) => k.endsWith('_rule')),
      'event_scope', 'facility_type', 'shop_type', 'effect_cap', 'action_kind', 'battle_mode', 'damage_type', 'battle_status', 'weapon_class',
    ]
    expect(expectRules.length).toBeGreaterThan(20)
    for (const k of expectRules) expect(g.k.content.isOverridable(k), k).toBe(true)
    for (const k of ['attribute', 'skill', 'perk', 'origin', 'faction', 'npc', 'item', 'enemy', 'encounter', 'defeat_event', 'path', 'ability', 'event', 'special_map', 'block', 'district', 'transit_line', 'fixer', 'position']) {
      if (kinds.includes(k)) expect(g.k.content.isOverridable(k), k).toBe(false)
    }
    // CORE_PACK 帶的每一種規則表，後載入的包都能取代它的每一筆（用同一份資料再載一次不丟錯）
    for (const k of expectRules) {
      const entries = (CORE_PACK.content as Record<string, unknown[]>)[k]
      if (entries) expect(() => g.k.content.load(k, entries), k).not.toThrow()
    }
  })

  it('整個遊戲：核心包之後的包取代核心包的規則表（transit_rule、event_scope、facility_type），其餘的核心內容照舊在；內容類同 id 還是擋', () => {
    const mine: ContentPack = {
      id: 'mine',
      content: {
        transit_rule: [{ id: 'default', taxi_base: 99 }],
        event_scope: [{ id: 'street', triggers: { enter_block: 0 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
        facility_type: [{ id: 'tuning_clinic', name: '測試診所' }],
      } as unknown as ContentPack['content'],
    }
    const g = new Game({ features: allFeatures(), content: [CORE_PACK, mine] })
    expect(g.k.content.get('transit_rule', 'default')).toEqual({ id: 'default', taxi_base: 99 })
    expect(g.k.content.get('event_scope', 'street')).toMatchObject({ triggers: { enter_block: 0 } })
    expect(g.k.content.get('facility_type', 'tuning_clinic')).toEqual({ id: 'tuning_clinic', name: '測試診所' })
    expect(g.k.content.has('event_scope', 'site')).toBe(true) // 沒被蓋掉的還在
    expect(g.k.content.checkRefs()).toEqual([])
    // 內容類：同一個 id 還是擋
    const dup: ContentPack = { id: 'dup', content: { faction: [{ id: 'hizakura', name: '重複', short: '重', class: 'corp' }] } as unknown as ContentPack['content'] }
    expect(() => new Game({ features: allFeatures(), content: [CORE_PACK, dup] })).toThrow(/id 重複/)
  })
})

// Probe 與 ContentRegistry 的匯出由 src/index.ts 給：這裡只確認測試能建一個空的核心登錄表
describe('登錄表的建構', () => {
  it('new ContentRegistry() 不需要 probe', () => {
    expect(() => new ContentRegistry()).not.toThrow()
    expect(typeof Probe).toBe('function')
  })
})
