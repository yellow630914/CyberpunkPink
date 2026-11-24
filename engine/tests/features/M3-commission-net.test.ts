// 驗收測試：dev/work/M3-commission-net.md（cpp-feature）。features/commission 接上內海面：face.net 要的東西、收回的結果、追蹤度整趟累計、連動多幾種效果、隔離區、評價與後果、畫面。
// 規格：COMMISSIONS 2.2、2.3、第 3～5 節、6.4、第 8、11 節；CYBERSPACE 8.1；NETRUNNING 第 4 節；dev/adr/0018 第七、九、十節與 N13、N14、N15、N34。
// 內容一律是測試自帶的最小假資料：一件四階段的假副本（COMMISSIONS 第 11 節的樣本：前兩階段現實與內海都可選、第三階段只有現實而且給 airgap_open、第四階段只有內海而且 locked_by airgap_open）、
// DATA 9.3 節的小辦公室。`face.net` 是測試自己登記的假活動（不 import features/netrun），交回什麼由測試決定。敵對值的量表用測試裝的替身。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Report, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, endActivity, meterOf, toMinutes } from '../../src'
import { defeatFeature } from '../../src/features/defeat'
import { exploreFeature } from '../../src/features/explore'
import {
  AIRGAP_TEXT, DEFAULT_COMMISSION_RULES, DEFAULT_NET_RULES, TRACE_MARKS, chooseBranch, chooseFace, commissionFeature, commissionProblems, commissionView, netRules, ruleProblems, effectsFor, fallout, finish, rate, readRun, replay, retreat,
} from '../../src/features/commission'
import { makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

// ===================================================================================================================
// 假資料
// ===================================================================================================================

/** DATA 9.3 節的小辦公室（和 M2 的副本測試同一張）：E2 後門、T3 檔案間；兩個控制點的區是 c d 與 a b。 */
const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '主管室的控制面板' },
    { id: '$1', at: [3, 5], mark: '$', name: '檔案間的小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [
    { id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] },
    { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] },
  ],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
const MAP = { id: 'map_office_small', kind: 'office_small', size: [9, 9], sheets: [OFFICE] }

const SKILLS = [{ id: 'interface', attr: 'intellect' }, { id: 'stealth', attr: 'reflex' }, { id: 'negotiate', attr: 'charm' }].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))
const FACTIONS = ['hizakura', 'nora', 'watch_a', 'watch_b'].map((id) => ({ id, name: id, short: id, class: 'corp' }))

/** 現實面：一個階段沒有守備（encounter 空），目標是走到檔案間（T3）；從後門進。 */
const meat = (gives?: string, extra: Rec = {}): Rec => ({
  map: 'map_office_small', encounter: [], goal: { kind: 'reach', at: 'T3' }, ...(gives ? { gives } : {}), branches: [{ id: 'assault', kind: 'assault', entry: 'E2' }], ...extra,
})
const net = (extra: Rec = {}): Rec => ({ layer: 'guest', encounter: ['minion'], branches: [{ id: 'assault', kind: 'assault' }], ...extra })

/**
 * 四階段的假副本（中規模；主面內海）。
 *   1 現實、內海（內海給 cred：下一階段內海追蹤度 −15、蕾絲降一級）
 *   2 現實、內海（內海寫了 controls 與 gives tap：接管了才給；tap 讓第三階段現實的 f1:b 區被接管）
 *   3 只有現實（給 airgap_open）
 *   4 只有內海（隔離區：要 airgap_open）
 */
const DEF: Rec = {
  id: 'cm_net', name: '四階段的內海副本', kind: 'steal_data', main: 'net', scale: 'medium', grade: 3, target_faction: 'hizakura', employer: 'nora', district: 'glass_shore',
  defeat_event: 'df_custom', modifiers: ['night_shift'],
  stages: [
    { name: '外圍', faces: { meat: meat('badge'), net: net({ gives: 'cred', objective: { kind: 'download', turns: 2 }, lace: 'white', facility: 'lobby' }) } },
    { name: '員工層', faces: { meat: meat(), net: net({ layer: 'staff', gives: 'tap', controls: ['f1:b'] }) } },
    { name: '現實的資料埠', faces: { meat: meat('airgap_open') } },
    { name: '隔離區', faces: { net: net({ layer: 'core', encounter: ['boss', 'minion'], locked_by: 'airgap_open', objective: { kind: 'seize' } }) } },
  ],
  links: {
    badge: { type: 'skip', name: '員工證', effect: { stage: 2, encounter_half: true } },
    cred: { type: 'open', name: '員工憑證', effect: { stage: 2, trace_start: -15, lace_down: true, trace_half: true } },
    tap: { type: 'ease', name: '接管後門', effect: { stage: 3, controls: ['f1:b'] } },
    airgap_open: { type: 'open', name: '資料埠', effect: { stage: 4, gate_open: true, near_core: true } },
  },
}
/** 連動的 controls 寫 true（那張地圖全部的控制區）。 */
const DEF_ALL = { ...DEF, id: 'cm_net_all', links: { ...(DEF.links as Rec), tap: { type: 'ease', name: '接管全部', effect: { stage: 3, controls: true } } } }
/** 兩階段（小規模三階段）只為了看路線的後果：全走內海。 */
const DEF_NET3: Rec = {
  id: 'cm_net3', name: '全走內海', kind: 'steal_data', main: 'net', scale: 'small', grade: 2, target_faction: 'hizakura', district: 'glass_shore',
  stages: [{ faces: { net: net() } }, { faces: { net: net({ layer: 'staff' }) } }, { faces: { net: net({ layer: 'core' }) } }],
  links: {},
}

const PACK: ContentPack = {
  id: 'm3_commission_net',
  content: {
    skill: SKILLS, faction: FACTIONS, special_map: [MAP as never], commission: [DEF as never, DEF_ALL as never, DEF_NET3 as never],
    defeat_event: [{ id: 'df_custom', name: '副本自訂的戰敗', kind: 'custom', factions: [], fails_commission: true, versions: { default: { text: '你被帶走了。', effects: [] } } }],
  },
}

// ---- 替身 ----

/** 內海的玩法的替身：只是登記 face.net，開的時候把 setup 與 origin 記在 ext；由測試自己用 endNet 交回結果。 */
const FAKE_NET: Feature = {
  id: 'fake_net',
  install(k) {
    k.activity.define({
      kind: 'face.net', owner: 'fake_net', order: 50,
      active: (s) => (isRec(s.ext.fake_net) ? { id: 'face.net', label: '內海' } : null),
      allow: ['commit:fake_net.', 'commit:defeat.'], reason: () => '替身活動開著。',
      start: (_k, _s, setup, origin) => [{
        kind: 'event', action: 'fake_net.open', location: {}, party: [], timeline: [],
        changes: [{ op: 'ext', key: 'fake_net', value: { setup, origin } }], outcome: { result: 'open', summary: 'face.net 開了。' },
      }],
    })
    k.activity.allow('commission', 'face.net.start', 'fake_net')
    k.activity.allow('commission', 'commit:fake_net.', 'fake_net')
  },
}
/** 敵對值的量表（security 的功能不 import）。 */
const HOSTILITY = meterFeature(testMeter({ kind: 'hostility', owner: 'test_security', name: '敵對值', keyed: 'faction', min: 0, max: 100, start: 0, cap: { down: 20, up: 20 } }))

const SEEN: { ends: Array<{ kind: string; outcome: string; origin: Rec; result: Rec }> } = { ends: [] }
const OBSERVER: Feature = {
  id: 'observer',
  install(k) { k.hooks.on('activity.end', 'observer', ({ kind, outcome, origin, result }) => { SEEN.ends.push({ kind, outcome, origin: origin as never, result }) }) },
}
const endsOf = (kind: string) => SEEN.ends.filter((e) => e.kind === kind)

interface Opts { seed?: number; content?: ContentPack[]; features?: Feature[] }
function setup(o: Opts = {}) {
  SEEN.ends.length = 0
  return makeGame({
    seed: o.seed, features: [exploreFeature, defeatFeature, commissionFeature, FAKE_NET, HOSTILITY, OBSERVER, ...(o.features ?? [])], content: o.content ?? [PACK],
    pc: { attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 }, skills: { interface: 5, stealth: 3 } } as never,
    actors: [makeActor({ id: 'a', name: '人a', role: 'npc', skills: { interface: 0 } })],
  })
}
type G = ReturnType<typeof setup>['game']

const origin = { by: 'fixer', ref: 'fx_1' }
const enter = (g: G, extra: Rec = {}, def = 'cm_net') => g.launch('commission', { def, ...extra }, origin)
const runOf = (g: G) => readRun(g.state)!
const view = (g: G) => commissionView(g.k, g.state)!
const face = (g: G, f: 'meat' | 'net' | 'opinion' = 'meat') => g.commit(chooseFace(g.k, g.state, f))
const pick = (g: G, id = 'assault') => g.commit(chooseBranch(g.k, g.state, id))
const minutes = (g: G) => toMinutes(g.state.time)
const hostilityOf = (g: G, f = 'hizakura') => meterOf(g.k, g.state, 'hostility', f)
const commit = (g: G, changes: Rec[]) => g.commit({ kind: 'system', action: 'commission.test', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: '測試' } })
const netOpen = (g: G) => g.state.ext.fake_net as { setup: Rec; origin: Rec }

/** 替身活動交回：照規矩用 endActivity 發 activity.end，結束那份報告帶上 launch、rewind。 */
function endNet(g: G, outcome: string, result: Rec): Report[] {
  const open = netOpen(g)
  const end = endActivity(g.k, { state: g.state, kind: 'face.net', id: 'face.net', origin: open.origin as never, outcome, result })
  const d: ReportDraft = {
    kind: 'event', action: 'fake_net.close', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'fake_net', value: null }, ...end.changes],
    outcome: { result: outcome, summary: `face.net ${outcome}。` }, narration: { results: end.lines },
  }
  return g.commit(attachActivityEnd(d, end))
}
/** 內海那一段從頭到交回：選內海、選分支、交回。 */
function playNet(g: G, outcome: string, result: Rec): Report[] {
  face(g, 'net')
  pick(g)
  return endNet(g, outcome, result)
}
/** 現實那一段：選現實、強攻、走到檔案間（里程碑自己接上）。 */
function playMeat(g: G): Report[] {
  face(g, 'meat')
  pick(g)
  return g.gridMove([1, 5]).reports
}
/** 狀態裡「回到進去之前」要比的欄位。 */
const snapshotOf = (s: GameState) => ({ time: s.time, money: s.money, inventory: s.inventory, flags: s.flags, counters: s.counters, maps: s.maps, snapshots: s.snapshots, meters: s.meters, rng: s.rng, ext: { ...s.ext, fake_net: undefined } })

// ===================================================================================================================

describe('開這一段（faceLaunch）', () => {
  it('選內海面、選分支：假活動收到 layer、encounter、fx、trace、decisive、where 與面的其餘資料；origin.ext 有 commission、stage、face', () => {
    const { game: g } = setup()
    enter(g)
    face(g, 'net')
    const reports = pick(g)
    expect(reports.map((r) => r.action)).toEqual(['commission.branch', 'fake_net.open'])
    const open = netOpen(g)
    expect(open.setup).toMatchObject({
      commission: 'cm_net', stage: 1, face: 'net', branch: 'assault', branch_kind: 'assault', stealth: false, grade: 3, faction: 'hizakura',
      layer: 'guest', encounter: ['minion'], lace: 'white', facility: 'lobby', objective: { kind: 'download', turns: 2 },
      fx: {}, trace: 0, decisive: false, defeat_event: 'df_custom', employer: 'nora',
      where: { kind: 'steal_data', face: 'net', faction: 'hizakura', tags: ['night_shift'] },
    })
    // gives 與 branches 是副本自己的，不交給那一段；locked_by 也不用
    expect(open.setup).not.toHaveProperty('gives')
    expect(open.setup).not.toHaveProperty('branches')
    expect(open.setup).not.toHaveProperty('locked_by')
    expect(open.origin).toEqual({ by: 'commission', ref: 'cm_net', ext: { commission: 'cm_net', stage: 1, face: 'net' } })
    expect(runOf(g)).toMatchObject({ step: 'play', face: 'net', route: [{ stage: 1, face: 'net', branch: 'assault' }] })
    expect(view(g).goal).toMatchObject({ kind: 'face', done: false })
  })

  it('決定性的一步（最後一個階段）：decisive 是 true；現實面的開法不變（地圖 ext 沒有 fx 與 trace）', () => {
    const { game: g } = setup()
    enter(g)
    playMeat(g)
    expect(runOf(g).stage).toBe(2)
    face(g, 'meat')
    pick(g)
    const ext = (g.state.maps.instances[runOf(g).map!]!.ext ?? {}) as Rec
    expect(ext).not.toHaveProperty('fx')
    expect(ext).not.toHaveProperty('trace')
    expect(ext).not.toHaveProperty('controlled')
  })

  it('拿到 trace_start、lace_down、trace_half 的連動：下一個內海階段的 fx 帶著它們（只寫生效的鍵）；對現實階段不出現；對自己這一段之前的階段也不出現', () => {
    const { game: g } = setup()
    enter(g)
    face(g, 'net')
    pick(g)
    expect(netOpen(g).setup.fx).toEqual({})
    endNet(g, 'done', { trace: 20, peak: 20, controls: [] })
    expect(runOf(g)).toMatchObject({ stage: 2, links: [{ id: 'cred', from: 1, face: 'net' }] })
    expect(effectsFor(runOf(g), 2)).toMatchObject({ traceStart: -15, laceDown: true, traceHalf: true, gateOpen: false, nearCore: false })
    face(g, 'net')
    pick(g)
    expect(netOpen(g).setup.fx).toEqual({ trace_start: -15, lace_down: true, trace_half: true })
    expect(netOpen(g).setup.trace).toBe(20)
    // 同一個階段選現實：地圖的 ext 裡沒有 fx（現實面不看這些鍵）
    const h = setup().game
    enter(h)
    playNet(h, 'done', { trace: 20, peak: 20, controls: [] })
    face(h, 'meat')
    pick(h)
    const ext = (h.state.maps.instances[runOf(h).map!]!.ext ?? {}) as Rec
    expect(JSON.stringify(ext)).not.toMatch(/trace_start|lace_down|trace_half/)
  })

  it('gate_open 與 near_core：給第四階段（最後一個，決定性的一步）的內海面', () => {
    const { game: g } = setup()
    enter(g)
    playNet(g, 'done', { trace: 10, peak: 10, controls: [] })
    playNet(g, 'done', { trace: 10, peak: 10, controls: [{ id: 'c1', sheet: 'l1', node: 'f1:b' }] })
    playMeat(g)
    expect(runOf(g)).toMatchObject({ stage: 4, step: 'face' })
    face(g, 'net')
    pick(g)
    expect(netOpen(g).setup).toMatchObject({ fx: { gate_open: true, near_core: true }, decisive: true, layer: 'core', encounter: ['boss', 'minion'], objective: { kind: 'seize' } })
  })

  it('再來一次（replay）：同一個階段再開一次，帶現在的追蹤度', () => {
    const { game: g } = setup()
    enter(g)
    face(g, 'net')
    pick(g)
    endNet(g, 'lose', {})
    expect(runOf(g)).toMatchObject({ step: 'play', done: false, trace: 0 })
    const again = g.commit(replay(g.k, g.state))
    expect(again.map((r) => r.action)).toEqual(['commission.replay', 'fake_net.open'])
    expect(netOpen(g).setup).toMatchObject({ stage: 1, trace: 0, fx: {} })
  })
})

describe('進副本的 trace_start 與追蹤度整趟累計', () => {
  it('setup.trace_start 是 Run.trace 的起點（第一個內海階段的 setup.trace）；範圍 −30～100', () => {
    const { game: g } = setup()
    enter(g, { trace_start: 15 })
    expect(runOf(g)).toMatchObject({ trace: 15, net_peak: 15 })
    face(g, 'net')
    pick(g)
    expect(netOpen(g).setup.trace).toBe(15)
    const h = setup().game
    enter(h, { trace_start: -30 })
    expect(runOf(h).trace).toBe(-30)
    for (const bad of [-31, 101, 1.5, '3']) expect(() => enter(setup().game, { trace_start: bad })).toThrow(ActionBlocked)
  })

  it('交回 done、result.trace 42：Run.trace 是 42、接了里程碑、時間 +120 分鐘、拿到 gives；下一個內海階段的 setup.trace 是 42', () => {
    const { game: g } = setup()
    enter(g)
    face(g, 'net')
    pick(g)
    const t0 = minutes(g)
    const reports = endNet(g, 'done', { trace: 42, peak: 50, rounds: 9, loot: [], controls: [] })
    expect(reports.map((r) => r.action)).toEqual(['fake_net.close', 'commission.milestone'])
    expect(runOf(g)).toMatchObject({ stage: 2, step: 'face', trace: 42, net_peak: 50, links: [{ id: 'cred', from: 1, face: 'net' }] })
    expect(minutes(g)).toBe(t0 + 120)
    face(g, 'net')
    pick(g)
    expect(netOpen(g).setup.trace).toBe(42)
  })

  it('result.trace 與 peak 夾在 −30～100；沒給就維持原來的', () => {
    const { game: g } = setup()
    enter(g)
    playNet(g, 'done', { trace: 500, peak: 900 })
    expect(runOf(g)).toMatchObject({ trace: 100, net_peak: 100 })
    const h = setup().game
    enter(h)
    playNet(h, 'done', { trace: -99 })
    expect(runOf(h).trace).toBe(-30)
    const i = setup().game
    enter(i, { trace_start: 7 })
    playNet(i, 'done', {})
    expect(runOf(i)).toMatchObject({ trace: 7, net_peak: 7 })
  })

  it('現實的階段不動追蹤度', () => {
    const { game: g } = setup()
    enter(g, { trace_start: 12 })
    playMeat(g)
    expect(runOf(g)).toMatchObject({ stage: 2, trace: 12 })
  })
})

describe('警戒：到過 60 的那一次 +10，只加一次（N14）', () => {
  it('result.peak 65：警戒 +10；第二個內海階段再到 70，不再加；59 不加', () => {
    const { game: g } = setup()
    enter(g)
    const a = playNet(g, 'done', { trace: 40, peak: 65, controls: [] })
    expect(runOf(g)).toMatchObject({ alert: 10, peak: 10, net_alerted: true, trace: 40, net_peak: 65 })
    expect(a.flatMap((r) => r.outcome.summary + ((r.narration?.results ?? []).join('') ?? '')).join('')).toContain('警戒 +10')
    playNet(g, 'done', { trace: 70, peak: 70, controls: [{ id: 'c1', sheet: 'l1' }] })
    expect(runOf(g)).toMatchObject({ alert: 10, net_peak: 70, trace: 70 })
    const h = setup().game
    enter(h)
    playNet(h, 'done', { trace: 59, peak: 59 })
    expect(runOf(h)).toMatchObject({ alert: 0 })
    expect(runOf(h).net_alerted).toBeUndefined()
  })

  it('已經有警戒的：加在原來的上面，夾在 100；警戒的數字是規則表 net_alert、門檻 net_alert_at', () => {
    const { game: g } = setup()
    enter(g, { alert_start: 95 })
    playNet(g, 'done', { trace: 61, peak: 61 })
    expect(runOf(g).alert).toBe(100)
    const rule = { id: 'default', net_alert: 25, net_alert_at: 30 }
    const h = setup({ content: [{ ...PACK, content: { ...PACK.content, commission_rule: [rule] as never } }] }).game
    enter(h)
    playNet(h, 'done', { trace: 31, peak: 31 })
    expect(runOf(h).alert).toBe(25)
  })
})

describe('撤退與被定位', () => {
  it('交回 retreat：時間、錢、背包回到進去之前，副本沒了（委託還在手上由中間人聽 commission 的 retreat）；和直接呼叫撤退的結果逐欄相同', () => {
    const play = (viaNet: boolean) => {
      const { game: g } = setup()
      const t0 = minutes(g)
      enter(g)
      commit(g, [{ op: 'cash', delta: 500 }, { op: 'time', minutes: 30 }])
      face(g, viaNet ? 'net' : 'meat')
      pick(g)
      const reports = viaNet ? endNet(g, 'retreat', { trace: 33, peak: 33 }) : g.commit(retreat(g.k, g.state))
      return { g, reports, t0 }
    }
    const a = play(true)
    const b = play(false)
    expect(readRun(a.g.state)).toBeNull()
    expect(minutes(a.g)).toBe(a.t0)
    expect(a.g.state.money).toEqual(b.g.state.money)
    expect(snapshotOf(a.g.state)).toEqual(snapshotOf(b.g.state))
    expect(a.reports.at(-1)!.rewind ?? a.reports.some((r) => r.action === 'rewind')).toBeTruthy()
    // 中間人那一邊聽到的是 commission 的 retreat，結果欄位一樣
    expect(endsOf('commission').map((e) => e.outcome)).toEqual(['retreat'])
    const ra = endsOf('commission')[0]!
    SEEN.ends.length = 0
    const c = play(false)
    expect(endsOf('commission')[0]).toEqual(ra)
    expect(c.g.state.snapshots).toEqual([])
  })

  it('交回 located：委託失敗、回到進去之前；最後兩份報告是回到快照的那一份與 commission.failed；失敗的結果評價 C、沒有歷練點', () => {
    const { game: g } = setup()
    enter(g)
    commit(g, [{ op: 'cash', delta: 500 }])
    const cash0 = g.state.money.cash
    face(g, 'net')
    pick(g)
    const reports = endNet(g, 'located', { trace: 95, peak: 95, located: true })
    expect(reports.slice(-2).map((r) => r.action)).toEqual(['rewind', 'commission.failed'])
    expect(readRun(g.state)).toBeNull()
    expect(g.state.money.cash).toBe(cash0 - 500)
    const failed = endsOf('commission').at(-1)!
    expect(failed).toMatchObject({ outcome: 'failed', result: { rating: 'C', xp: 0, defeat: { located: true, net: true } } })
    expect((g.state.ext.commission_failed as Rec)).toMatchObject({ commission: 'cm_net', pending: false })
  })

  it('被定位而失敗：目標勢力的敵對值另外 +5（失敗的路線後果不留，只有這一份）', () => {
    const { game: g } = setup()
    enter(g)
    playMeat(g)
    playNet(g, 'located', { trace: 90, peak: 90, located: true })
    expect(readRun(g.state)).toBeNull()
    expect(hostilityOf(g)).toBe(5)
    const result = endsOf('commission').at(-1)!.result
    expect(result.hostility).toMatchObject({ faction: 'hizakura', delta: 5, located: true })
  })

  it('不算失敗的戰敗（內海的階段）：回到選分支之前、Run.trace 維持這一段開始前的值、這一段選過的路線拿掉；被定位的記下來，做完時敵對值另外加', () => {
    const { game: g } = setup()
    enter(g, { trace_start: 5 })
    playNet(g, 'done', { trace: 30, peak: 30 })
    face(g, 'net')
    pick(g)
    // 這一段被打輸、接受戰敗（戰敗的功能是別人的：直接發 activity.end 的替身）
    const end = endActivity(g.k, { state: g.state, kind: 'defeat', id: 'd1', origin: { by: 'core', ext: { commission: 'cm_net', stage: 2, face: 'net' } }, outcome: 'accept', result: { fails_commission: false, located: true } })
    g.commit({ kind: 'system', action: 'defeat.accept', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'fake_net', value: null }, ...end.changes], outcome: { result: 'ok', summary: '接受戰敗' } })
    expect(runOf(g)).toMatchObject({ stage: 2, step: 'branch', trace: 30, net_located: true })
    expect(runOf(g).route.map((r) => r.stage)).toEqual([1])
    expect(runOf(g).face).toBe('net')
    expect(runOf(g).branch).toBeUndefined()
  })
})

describe('隔離區（locked_by）', () => {
  /** 一路走到第四階段。 */
  function toLast(g: G): void {
    enter(g)
    playNet(g, 'done', { trace: 10, peak: 10 })
    playNet(g, 'done', { trace: 10, peak: 10 })
  }

  it('第四階段在沒有 airgap_open 時內海面選不了、原因是那一句；第三階段做完之後選得了', () => {
    const { game: g } = setup()
    toLast(g)
    playMeat(g)
    // 第三階段是現實的、給了 airgap_open：第四階段開了
    expect(runOf(g)).toMatchObject({ stage: 4, step: 'face' })
    expect(runOf(g).links.map((l) => l.id)).toContain('airgap_open')
    expect(view(g).faces.find((f) => f.face === 'net')).toMatchObject({ block: null })
    expect(view(g).faces.find((f) => f.face === 'net')!.locked).toBeUndefined()
    // 另一局：直接把狀態改成第四階段、沒有連動
    const h = setup().game
    enter(h)
    commit(h, [{ op: 'ext', key: 'commission', value: { ...runOf(h), stage: 4 } }])
    const netFace = view(h).faces.find((f) => f.face === 'net')!
    expect(netFace).toMatchObject({ open: true, block: AIRGAP_TEXT, locked: AIRGAP_TEXT })
    expect(AIRGAP_TEXT).toBe('隔離區還沒有打開：要先在現實面插上資料埠。')
    expect(() => chooseFace(h.k, h.state, 'net')).toThrow(AIRGAP_TEXT)
    // 沒有鎖的面 locked 是 null
    expect(view(h).faces.find((f) => f.face === 'meat')!.locked).toBeUndefined()
  })

  it('最後一個階段只有這一面而且鎖著：進副本不擋（前面的階段拿得到那個連動）', () => {
    const { game: g } = setup()
    expect(() => enter(g)).not.toThrow()
    expect(readRun(g.state)).not.toBeNull()
  })

  it('格式檢查：locked_by 的連動沒有任何更早的階段會給，擋下；連動不存在也擋下；寫在自己那個階段給的也不算', () => {
    const base = DEF as Rec
    const stages = base.stages as Rec[]
    expect(commissionProblems(base)).toEqual([])
    // 沒有任何更早的階段給 airgap_open
    const noGiver = { ...base, stages: stages.map((s, i) => (i === 2 ? { ...s, faces: { meat: meat() } } : s)) }
    expect(commissionProblems(noGiver).join('；')).toMatch(/locked_by 寫了 airgap_open，但沒有任何更早的階段會給這個連動/)
    const ghost = { ...base, stages: stages.map((s, i) => (i === 3 ? { ...s, faces: { net: net({ layer: 'core', locked_by: 'nope' }) } } : s)) }
    expect(commissionProblems(ghost).join('；')).toMatch(/locked_by 寫了 nope，links 裡沒有這個連動/)
    // 同一個階段的別的面給它，不算「更早」
    const sameStage = { ...base, stages: stages.map((s, i) => (i === 3 ? { ...s, faces: { net: net({ layer: 'core', locked_by: 'tap', gives: 'tap' }) } } : i === 1 ? { ...s, faces: { meat: meat(), net: net({ layer: 'staff' }) } } : s)) }
    expect(commissionProblems(sameStage).join('；')).toMatch(/locked_by 寫了 tap，但沒有任何更早的階段會給這個連動/)
    expect(() => setup().game.launch('commission', { def: noGiver }, origin)).toThrow(ActionBlocked)
  })

  it('內海面的格式：layer 只能是四層（沒寫暫時不擋：生成器補上之前）；lace、objective、controls、locked_by 各有檢查', () => {
    const one = (extra: Rec) => commissionProblems({ ...DEF_NET3, stages: [{ faces: { net: net(extra) } }, (DEF_NET3.stages as Rec[])[1]!, (DEF_NET3.stages as Rec[])[2]!] }).join('；')
    expect(one({})).toBe('')
    expect(one({ layer: 'basement' })).toMatch(/layer 只能是 guest、staff、control、core/)
    expect(one({ lace: 'green' })).toMatch(/lace 只能是 white、pink、black/)
    expect(one({ objective: { kind: 'steal' } })).toMatch(/objective/)
    expect(one({ objective: { kind: 'download', turns: 11 } })).toMatch(/turns 要是 1～10/)
    for (const kind of ['download', 'seize', 'find', 'defeat', 'plant', 'extract']) expect(one({ objective: { kind } })).toBe('')
    expect(one({ controls: [] })).toMatch(/controls 要是/)
    expect(one({ controls: ['f1:b'] })).toBe('')
    expect(one({ facility: 3 })).toMatch(/facility/)
  })

  it('連動的新鍵：格式檢查（trace_start −100～100、旗標要是真假、controls 要是 true 或清單）', () => {
    const withEffect = (effect: Rec) => commissionProblems({ ...DEF, links: { ...(DEF.links as Rec), x: { type: 'open', name: 'x', effect } } }).join('；')
    expect(withEffect({ trace_start: -100, trace_half: true, lace_down: true, gate_open: true, near_core: true, controls: true })).toBe('')
    expect(withEffect({ controls: ['f1:b'] })).toBe('')
    expect(withEffect({ trace_start: 101 })).toMatch(/trace_start 要是 −100～100/)
    expect(withEffect({ trace_half: 1 })).toMatch(/trace_half 要是 true 或 false/)
    expect(withEffect({ controls: [] })).toMatch(/controls 要是 true/)
    expect(withEffect({ controls: 'f1:b' })).toMatch(/controls 要是 true/)
    expect(withEffect({ bogus: true })).toMatch(/bogus 不是可以用的鍵/)
  })
})

describe('內海交給現實的控制區', () => {
  it('面的資料寫了 controls 與 gives：result.controls 有東西時里程碑給連動、下一個現實階段的地圖 ext.controlled 含 f1:b', () => {
    const { game: g } = setup()
    enter(g)
    playNet(g, 'done', { trace: 10, peak: 10 })
    const reports = playNet(g, 'done', { trace: 20, peak: 20, controls: [{ id: 'c1', sheet: 'l1', node: 'f1:b' }] })
    expect(reports.map((r) => r.action)).toEqual(['fake_net.close', 'commission.milestone'])
    expect(runOf(g).links.map((l) => l.id)).toContain('tap')
    expect(netOpenSetupControls(g)).toBeUndefined()
    face(g, 'meat')
    pick(g)
    const ext = (g.state.maps.instances[runOf(g).map!]!.ext ?? {}) as Rec
    expect(ext.controlled).toEqual(['f1:b'])
  })

  it('result.controls 是空的（沒有接管）：不給 gives、里程碑照樣做完（時間照走）；下一個現實階段的地圖沒有 controlled', () => {
    const { game: g } = setup()
    enter(g)
    playNet(g, 'done', { trace: 10, peak: 10 })
    const t0 = minutes(g)
    face(g, 'net')
    pick(g)
    expect(netOpen(g).setup.controls).toEqual(['f1:b'])
    const reports = endNet(g, 'done', { trace: 20, peak: 20, controls: [] })
    expect(reports.map((r) => r.action)).toEqual(['fake_net.close', 'commission.milestone'])
    expect(runOf(g)).toMatchObject({ stage: 3, step: 'face' })
    expect(runOf(g).links.map((l) => l.id)).not.toContain('tap')
    expect(runOf(g).no_gives).toBeUndefined()
    expect(minutes(g)).toBe(t0 + 120)
    expect(reports.flatMap((r) => r.narration?.results ?? []).join('')).toContain('沒有接管')
    face(g, 'meat')
    pick(g)
    expect((g.state.maps.instances[runOf(g).map!]!.ext ?? {}) as Rec).not.toHaveProperty('controlled')
  })

  it('沒寫 controls 的面不受影響：result.controls 是空的照樣給 gives', () => {
    const { game: g } = setup()
    enter(g)
    playNet(g, 'done', { trace: 10, peak: 10, controls: [] })
    expect(runOf(g).links.map((l) => l.id)).toEqual(['cred'])
  })

  it('連動的 controls 寫 true：這張地圖全部的控制區（每一張圖、每個控制點的區塊）', () => {
    const { game: g } = setup()
    enter(g, {}, 'cm_net_all')
    playNet(g, 'done', { trace: 10, peak: 10 })
    playNet(g, 'done', { trace: 20, peak: 20, controls: [{ id: 'c1', sheet: 'l1' }] })
    face(g, 'meat')
    pick(g)
    const ext = (g.state.maps.instances[runOf(g).map!]!.ext ?? {}) as Rec
    expect((ext.controlled as string[]).slice().sort()).toEqual(['office:a', 'office:b', 'office:c', 'office:d'])
  })
})

/** 開內海時 setup 裡的 controls（現實階段用不到，這裡只是確認它不會跑到現實的 setup）。 */
const netOpenSetupControls = (g: G): unknown => (isRec(g.state.ext.fake_net) ? netOpen(g).setup.controls : undefined)

describe('輔助面（內海）失敗的壓力', () => {
  /** 找一個種子：玩家選現實、派 a 去內海，那一擲失敗。 */
  function failingSeed(): number {
    for (let seed = 1; seed <= 400; seed++) {
      const { game: g } = setup({ seed })
      enter(g, { aux: { net: ['a'] } })
      const d = chooseFace(g.k, g.state, 'meat')
      if (d.timeline.some((b) => b.tag === 'aux' && (b.data?.outcome === 'fail'))) return seed
    }
    throw new Error('找不到合適的種子')
  }

  it('輔助面內海失敗：Run.trace +10（接在進副本時的 trace_start 上）、net_peak 跟著；畫面內海面的壓力顯示 Run.trace；舊欄位 aux.pressure.net 照寫一份', () => {
    const { game: g } = setup({ seed: failingSeed() })
    enter(g, { aux: { net: ['a'] }, trace_start: 5 })
    face(g, 'meat')
    expect(runOf(g)).toMatchObject({ trace: 15, net_peak: 15, alert: 0 })
    expect(runOf(g).aux!.pressure.net).toBe(15)
    expect(view(g).aux.find((a) => a.face === 'net')!.pressure).toBe(15)
    expect(view(g).trace).toEqual({ value: 15, marks: [30, 60, 90], peak: 15 })
  })

  it('舊存檔（aux.pressure.net 有值、Run 沒有 trace）：讀進來併進 Run.trace；新的值已經在的以 Run.trace 為準', () => {
    const { game: g } = setup()
    enter(g)
    const old = { ...runOf(g), aux: { pressure: { net: 20 }, rest: {}, log: [] } } as Rec
    delete old.trace
    delete old.net_peak
    commit(g, [{ op: 'ext', key: 'commission', value: old }])
    expect(runOf(g)).toMatchObject({ trace: 20, net_peak: 20 })
    commit(g, [{ op: 'ext', key: 'commission', value: { ...old, trace: 3, net_peak: 3 } }])
    expect(runOf(g)).toMatchObject({ trace: 3, net_peak: 3 })
  })
})

describe('評價與路線的後果', () => {
  const run = (route: Rec[], trace: number, netPeak: number, faction = 'hizakura', extra: Rec = {}) =>
    ({ route, links: [], trace, net_peak: netPeak, def: { target_faction: faction }, ...extra }) as never
  const R = DEFAULT_COMMISSION_RULES
  const s = (n: number, face: string, kind = 'assault', roll?: string) => ({ stage: n, face, kind, ...(roll ? { roll } : {}) })

  it('壓力條那兩項對內海照同一個門檻看追蹤度：最後在 60 以上 −1（59 不扣）、到過 90 再 −1（89 不扣）；和警戒是同一項（兩邊都過只扣一次）', () => {
    expect(rate(run([], 59, 0), R, 0, 0).parts).toMatchObject({ alert: 0, peak: 0 })
    expect(rate(run([], 60, 0), R, 0, 0).parts).toMatchObject({ alert: -1, peak: 0 })
    expect(rate(run([], 0, 89), R, 0, 0).parts.peak).toBe(0)
    expect(rate(run([], 0, 90), R, 0, 0).parts.peak).toBe(-1)
    expect(rate(run([], 60, 90), R, 0, 0)).toMatchObject({ rating: 'C', parts: { alert: -1, peak: -1, score: -2 } })
    expect(rate(run([], 80, 95), R, 70, 100).parts).toMatchObject({ alert: -1, peak: -1, score: -2 })
    // 舊的 Run（沒有追蹤度）不受影響
    expect(rate({ route: [], links: [], def: {} } as never, R, 0, 0).rating).toBe('B')
  })

  it('做完時 Run.trace 45：目標勢力的敵對值多 3（每 20 點 +1、進位）；評價在追蹤度最後 60 以上時少一級', () => {
    const f = (t: number, extra: Rec = {}) => fallout(run([s(1, 'net')], t, t, 'hizakura', extra), R)
    expect([0, 1, 20, 21, 45, 60, 81, 100].map((t) => f(t).delta)).toEqual([0, 1, 1, 2, 3, 3, 5, 5])
    expect(f(45)).toMatchObject({ faction: 'hizakura', delta: 3, reality: 0, net: { stages: 1, trace: 45, located: 0, delta: 3 } })
    expect(f(-20).delta).toBe(0)
    // 沒有走內海的階段：不加
    expect(fallout(run([s(1, 'meat')], 100, 100), R)).toEqual({ faction: 'hizakura', delta: 8, reality: 1, assault: 1 })
    // 被定位（不算失敗的戰敗）另外 +5；現實的那一份照加
    expect(f(45, { net_located: true }).delta).toBe(8)
    expect(fallout(run([s(1, 'meat'), s(2, 'net')], 20, 20), R).delta).toBe(8 + 1)
    // 沒有目標勢力：不加目標勢力的，管網路的照加
    expect(fallout(run([s(1, 'net')], 45, 45, 'none'), R, { ...DEFAULT_NET_RULES, net_watchers: ['watch_a'] })).toMatchObject({ faction: null, delta: 0, watchers: [{ faction: 'watch_a', delta: 2 }] })
  })

  it('做完（finish）：結算進敵對值量表與 activity.end 的結果；評價扣在追蹤度最後 60 以上', () => {
    // 三個內海的階段（小規模）全走內海：用 cm_net3；最後一個階段交回 trace 45
    const h = setup().game
    enter(h, {}, 'cm_net3')
    playNet(h, 'done', { trace: 30, peak: 30 })
    playNet(h, 'done', { trace: 40, peak: 40 })
    expect(runOf(h)).toMatchObject({ stage: 3, step: 'face', trace: 40 })
    const reports = playNet(h, 'done', { trace: 45, peak: 50 })
    expect(reports.map((r) => r.action)).toEqual(['fake_net.close', 'commission.milestone', 'commission.finish'])
    expect(hostilityOf(h)).toBe(3)
    const done = endsOf('commission').at(-1)!
    expect(done).toMatchObject({ outcome: 'done', result: { trace: 45, net_peak: 50, rating: 'B', hostility: { faction: 'hizakura', delta: 3, net: { stages: 3, trace: 45, delta: 3 } } } })
    // 追蹤度最後在 60 以上：少一級
    const i = setup().game
    enter(i, {}, 'cm_net3')
    playNet(i, 'done', { trace: 30, peak: 30 })
    playNet(i, 'done', { trace: 40, peak: 40 })
    playNet(i, 'done', { trace: 61, peak: 61 })
    expect(endsOf('commission').at(-1)!.result).toMatchObject({ rating: 'C', rating_parts: { alert: -1, peak: 0 }, hostility: { delta: 4 } })
    expect(hostilityOf(i)).toBe(4)
  })

  it('管網路的勢力（規則表 net_watchers）各 +2；目標勢力也在清單裡時兩份加在一起一次結算；規則表沒寫是空的', () => {
    expect(netRules(setup().game.k)).toEqual(DEFAULT_NET_RULES)
    const rule = { id: 'default', net_watchers: ['watch_a', 'watch_b', 'hizakura'] }
    const { game: h } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission_rule: [rule] as never } }] })
    enter(h, {}, 'cm_net3')
    playNet(h, 'done', { trace: 20, peak: 20 })
    playNet(h, 'done', { trace: 20, peak: 20 })
    playNet(h, 'done', { trace: 20, peak: 20 })
    expect([hostilityOf(h, 'watch_a'), hostilityOf(h, 'watch_b'), hostilityOf(h)]).toEqual([2, 2, 3])
    expect(endsOf('commission').at(-1)!.result.hostility).toMatchObject({ watchers: [{ faction: 'watch_a', delta: 2 }, { faction: 'watch_b', delta: 2 }, { faction: 'hizakura', delta: 2 }] })
  })

  it('規則的數字可以用資料蓋掉（net_hostility_step、net_hostility_max、net_located_hostility）；格式不對的欄位忽略', () => {
    const rule = { id: 'default', net_hostility_step: 10, net_hostility_max: 2 }
    const { game: h } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission_rule: [rule] as never } }] })
    const rules = netRules(h.k)
    expect(rules).toMatchObject({ net_hostility_step: 10, net_hostility_max: 2, net_watchers: [] })
    expect(ruleProblems({ net_watchers: 'x', net_alert: 101, net_hostility_step: 0 })).toHaveLength(3)
    expect(fallout(run([s(1, 'net')], 45, 45), DEFAULT_COMMISSION_RULES, rules).delta).toBe(2)
  })
})

describe('畫面（commissionView）', () => {
  it('trace 的值與刻度、到過的最高值', () => {
    const { game: g } = setup()
    enter(g, { trace_start: 10 })
    expect(view(g).trace).toEqual({ value: 10, marks: [30, 60, 90], peak: 10 })
    expect([...TRACE_MARKS]).toEqual([30, 60, 90])
    playNet(g, 'done', { trace: 35, peak: 72, controls: [] })
    expect(view(g).trace).toEqual({ value: 35, marks: [30, 60, 90], peak: 72 })
    // 警戒條不受影響（現實的壓力）
    expect(view(g).alert).toMatchObject({ value: 10, reinforce: 60 })
  })

  it('隔離區的面有 locked（原因；沒有鎖的面沒有這個欄位）；內海面的輔助壓力顯示 Run.trace', () => {
    const { game: g } = setup()
    enter(g, { trace_start: 8 })
    expect(view(g).faces.map((f) => [f.face, f.locked])).toEqual([['meat', undefined], ['net', undefined], ['opinion', undefined]])
    expect(view(g).aux.map((a) => a.pressure)).toEqual([0, 8, null])
  })

  it('一做完就是 done 的階段：finish 之後狀態沒了；強制呼叫 finish 在中途不成立', () => {
    const { game: g } = setup()
    enter(g)
    expect(() => finish(g.k, g.state)).toThrow(ActionBlocked)
  })
})

describe('共用的規則：現有的行為不變', () => {
  it('放行清單不加（face.net.start 與 commit:netrun. 是 netrun 自己加的）；現實面的撤退照舊', () => {
    const { game: g } = setup()
    enter(g)
    face(g, 'meat')
    pick(g)
    const reports = g.commit(retreat(g.k, g.state))
    expect(reports.some((r) => r.action === 'rewind' || r.rewind)).toBe(true)
    expect(readRun(g.state)).toBeNull()
  })
})
