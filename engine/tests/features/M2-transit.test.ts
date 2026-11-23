// 驗收測試：dev/work/M2-transit.md（cpp-feature）。規格：DISTRICTS 1.2.1 節（公共交通、車資、搭車）；EVENTS 3.1 節（transit_wait、transit_stop、transit_taxi）；
// UI 3.13、3.14 節；LIFE 2.1 節（進站掃橋）；dev/adr/0016 第一、六節。
// 內容一律用測試自帶的最小假資料：兩個區（蜂巢 ×1、冠冕 ×1.5）、五塊街區各一個車站（A、B、C、D 在蜂巢，X 在冠冕）、
// 一條四站的地鐵（A—B—C—D，進站要掃橋的版本在另一個測試裡改）、一條三站的環線（A—C—X）、一條只收現金的巴士（A—X）。
// 掃橋用替身（活動 scan，回 passed 可以調），另有一個真的 security 的整合測試。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Kernel, Origin, Report, ReportDraft, SpecialMapEntry } from '../../src'
import { ActionBlocked, attachActivityEnd, clone, endActivity, toMinutes } from '../../src'
import { allFeatures } from '../../src/features'
import { directorFeature, eventRunFeature } from '../../src/features/director'
import { securityFeature } from '../../src/features/security'
import {
  DEFAULT_TRANSIT_RULES, advance, advanceBlock, alight, board, boardBlock, stationKey, taxi, taxiBlock, transitFeature, transitOf, transitView, wait, waitBlock,
} from '../../src/features/transit'
import type { BoardInput } from '../../src/features/transit'
import { arrive, worldFeature } from '../../src/features/world'
import { makeGame, observed } from '../../src/testkit'

// ---- 假資料 ----

/** 每一塊街區同一張版面：F1（站）在 (1,1)，E1、E2 在兩端。 */
const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5],
    layout: ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '車站' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
}

const block = (id: string, district: string, name: string) => ({ id, district, name, kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_station', name: `${name}站` } } })
const stop = (id: string, name: string, b: string) => ({ id, name, block: b, at: 'F1' })

const METRO = {
  id: 'l_metro', name: '地鐵紅線', kind: 'metro', stops: [stop('s_a', 'A', 'b_a'), stop('s_b', 'B', 'b_b'), stop('s_c', 'C', 'b_c'), stop('s_d', 'D', 'b_d')],
  minutes_per_stop: 5, wait: [2, 6], fare: { base: 2, per_stop: 1 }, pay: ['cred', 'cash'], night: false,
}
const LOOP = {
  id: 'l_loop', name: '輕軌環線', kind: 'light_rail', stops: [stop('r_a', 'A', 'b_a'), stop('r_c', 'C', 'b_c'), stop('r_x', 'X', 'b_x')],
  minutes_per_stop: 8, wait: [3, 5], fare: { base: 3, per_stop: 0 }, pay: ['cred', 'cash'], loop: true,
}
const BUS = {
  id: 'l_bus', name: '外環巴士', kind: 'bus', stops: [stop('u_a', 'A', 'b_a'), stop('u_x', 'X', 'b_x')],
  minutes_per_stop: 20, wait: [20, 20], fare: { base: 3, per_stop: 1 }, pay: ['cash'],
}

type Rec = Record<string, any>
const content = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP)],
    facility_type: [{ id: 'fac_station', name: '車站' }],
    district: [
      { id: 'd_hive', name: '蜂巢', grade: 1, price_mult: 1, blocks: ['b_a', 'b_b', 'b_c', 'b_d'] },
      { id: 'd_crown', name: '冠冕區', grade: 5, price_mult: 1.5, blocks: ['b_x'] },
    ],
    block: [block('b_a', 'd_hive', 'A'), block('b_b', 'd_hive', 'B'), block('b_c', 'd_hive', 'C'), block('b_d', 'd_hive', 'D'), block('b_x', 'd_crown', 'X')],
    transit_line: [structuredClone(METRO), structuredClone(LOOP), structuredClone(BUS)],
    transit_rule: [{ id: 'default', km: [{ a: 'd_hive', b: 'd_crown', km: 6 }], taxi_same_km: 2 }],
  }
  patch(c)
  return { id: 'transit_test', content: c as unknown as ContentPack['content'] }
}
const line = (c: Record<string, Rec[]>, id: string): Rec => c.transit_line!.find((l) => l.id === id)!

/** 掃橋的替身：活動 scan 開始就直接交回結果（passed 可以調）；記下收到的 setup 與 origin。 */
interface ScanStub { passed: boolean; calls: Array<{ setup: any; origin: Origin }> }
const scanStub = (stub: ScanStub): Feature => ({
  id: 'scan_stub',
  install(k: Kernel) {
    k.activity.define({
      kind: 'scan', owner: 'scan_stub', order: 35, active: () => null, allow: [], reason: () => '掃描中。',
      start(k2, state, setup, origin) {
        stub.calls.push({ setup: clone(setup), origin: clone(origin) })
        const end = endActivity(k2, { state, kind: 'scan', id: `sc${state.seq.uid + 1}`, origin, outcome: stub.passed ? 'pass' : 'stop', result: { passed: stub.passed, how: 'stub' } })
        const d: ReportDraft = {
          kind: 'action', action: stub.passed ? 'scan.pass' : 'scan.stop', location: clone(state.location), party: [], timeline: [],
          changes: [{ op: 'uid', advance: 1 }, ...end.changes], outcome: { result: stub.passed ? 'pass' : 'stop', summary: stub.passed ? '掃描過了。' : '被攔下來了。' },
        }
        return [attachActivityEnd(d, end)]
      },
    })
  },
})

type G = ReturnType<typeof makeGame>['game']
interface Opts { time?: GameState['time']; pack?: ContentPack; features?: Feature[]; seed?: number; money?: { cred: number; cash: number }; rules?: Partial<GameState['rules']> }
const mk = (o: Opts = {}): G =>
  makeGame({
    scenario: 'withMoney', features: o.features ?? [worldFeature, transitFeature], content: [o.pack ?? content()], ...(o.seed !== undefined ? { seed: o.seed } : {}),
    patch: { ...(o.time ? { time: o.time } : {}), ...(o.money ? { money: o.money } : {}), ...(o.rules ? { rules: o.rules as GameState['rules'] } : {}) },
  }).game

const MORNING = { day: 1, hour: 8, minute: 0 }
const LATE = { day: 1, hour: 23, minute: 30 }

/** 站在某一站（走提交，和介面一樣）。 */
const stand = (g: G, b: string, at = 'F1'): void => { g.commit(arrive(g.k, g.state, b, at)) }
const min = (g: G): number => toMinutes(g.state.time)
const trip = (g: G) => transitOf(g.state).trip
const METRO_AB: BoardInput = { line: 'l_metro', pay: 'cred' }

/** 提交一份草稿；回傳那一份報告。 */
const one = (g: G, d: ReportDraft): Report => g.commit(d)[0]!
const rideTo = (g: G, stops: number): Report[] => Array.from({ length: stops }, () => one(g, advance(g.k, g.state)))

describe('上車', () => {
  it('不在車站上不能上車：給原因、狀態不動', () => {
    const g = mk()
    stand(g, 'b_a', 'E1') // 街區的入口，不是車站
    const before = structuredClone(g.state)
    expect(boardBlock(g.k, g.state, METRO_AB)).toMatch(/不在.*車站/)
    expect(() => board(g.k, g.state, METRO_AB)).toThrow(ActionBlocked)
    expect(g.state).toEqual(before)
    // 走到別的街區的車站也要是這條線停的站：D 站在地鐵上，但 b_x 的站不是地鐵的站
    stand(g, 'b_x')
    expect(boardBlock(g.k, g.state, METRO_AB)).toMatch(/不在.*車站/)
  })

  it('還沒到任何街區（沒有位置）時也上不了', () => {
    const g = mk()
    expect(boardBlock(g.k, g.state, METRO_AB)).toMatch(/不在.*車站/)
  })

  it('深夜停駛的線被擋下並有原因；不停駛的線照樣上得了', () => {
    const g = mk({ time: LATE })
    stand(g, 'b_a')
    expect(boardBlock(g.k, g.state, METRO_AB)).toBe('地鐵紅線深夜停駛，末班車已經過了。')
    expect(() => board(g.k, g.state, METRO_AB)).toThrow('地鐵紅線深夜停駛')
    expect(boardBlock(g.k, g.state, { line: 'l_loop', pay: 'cred' })).toBeNull()
  })

  it('錢不夠被擋：要起跳加一站；現金與帳戶分開算', () => {
    const g = mk({ money: { cred: 2, cash: 3 } })
    stand(g, 'b_a')
    expect(boardBlock(g.k, g.state, METRO_AB)).toBe('帳戶不夠：要 3，你有 2。')
    expect(boardBlock(g.k, g.state, { line: 'l_metro', pay: 'cash' })).toBeNull()
    expect(g.state.money).toEqual({ cred: 2, cash: 3 })
  })

  it('這條線不收的付法被擋（巴士只收現金）；沒有這條線、環線不能反著開、不在這個方向上的目的地都給原因', () => {
    const g = mk()
    stand(g, 'b_a')
    expect(boardBlock(g.k, g.state, { line: 'l_bus', pay: 'cred' })).toBe('外環巴士不收帳戶。')
    expect(boardBlock(g.k, g.state, { line: 'l_bus', pay: 'cash' })).toBeNull()
    expect(boardBlock(g.k, g.state, { line: 'l_nope', pay: 'cred' })).toMatch(/l_nope/)
    expect(boardBlock(g.k, g.state, { line: 'l_loop', pay: 'cred', dir: -1 })).toBe('輕軌環線是環線，只往一個方向開。')
    // A 是地鐵的起點站：往回開的方向沒有車
    expect(boardBlock(g.k, g.state, { line: 'l_metro', pay: 'cred', dir: -1 })).toMatch(/終點站/)
    expect(boardBlock(g.k, g.state, { ...METRO_AB, dest: 's_zzz' })).toMatch(/s_zzz/)
    stand(g, 'b_c')
    expect(boardBlock(g.k, g.state, { ...METRO_AB, dest: 's_a' })).toBeNull() // 沒指定方向：往開得到目的地的那一邊
    expect(boardBlock(g.k, g.state, { ...METRO_AB, dir: 1, dest: 's_a' })).toBe('A站不在這個方向上，車開不到那裡。')
  })

  it('上車：付起跳、這一趟開始、人在月台上；活動 ride 進行中；報告 transit.board；站記成去過', () => {
    const g = mk()
    stand(g, 'b_a')
    const t0 = min(g)
    const r = one(g, board(g.k, g.state, { ...METRO_AB, dest: 's_c' }))
    expect(r.action).toBe('transit.board')
    expect(g.state.money).toEqual({ cred: 998, cash: 500 })
    expect(min(g)).toBe(t0)
    expect(trip(g)).toEqual({ id: 'r1', n: 1, line: 'l_metro', dir: 1, at: 0, from: 's_a', dest: 's_c', pay: 'cred', phase: 'platform', rode: 0, paid: 2 })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['ride'])
    expect(transitOf(g.state).visited).toEqual([stationKey('b_a', 'F1')])
    // 已經在車上不能再上一次
    expect(boardBlock(g.k, g.state, { line: 'l_loop', pay: 'cred' })).toMatch(/已經在車上/)
  })

  it('用現金買票的那一趟，狀態裡記的是現金，扣的是現金', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, { line: 'l_metro', pay: 'cash' }))
    expect(trip(g)!.pay).toBe('cash')
    expect(g.state.money).toEqual({ cred: 1000, cash: 498 })
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state))
    expect(g.state.money).toEqual({ cred: 1000, cash: 497 })
    expect(trip(g)).toMatchObject({ pay: 'cash', paid: 3 })
  })
})

describe('等車與坐一站', () => {
  it('坐兩站：時間多了等車加兩站的分鐘數，錢少了起跳加兩站；每一站的報告帶 transit_stop', () => {
    const g = mk()
    stand(g, 'b_a')
    const t0 = min(g)
    one(g, board(g.k, g.state, METRO_AB))
    const w = one(g, wait(g.k, g.state))
    const waited = min(g) - t0
    expect(waited).toBeGreaterThanOrEqual(2)
    expect(waited).toBeLessThanOrEqual(6)
    expect(w.action).toBe('transit.wait')
    expect(w.triggers).toEqual([{ point: 'transit_wait', where: { line: 'l_metro', kind: 'metro', stop: 's_a', block: 'b_a', district: 'd_hive', period: 'peak' } }])
    const stops = rideTo(g, 2)
    expect(min(g) - t0).toBe(waited + 10)
    expect(g.state.money.cred).toBe(1000 - (2 + 2 * 1))
    expect(stops.map((r) => r.action)).toEqual(['transit.stop', 'transit.stop'])
    expect(stops.map((r) => r.triggers)).toEqual([
      [{ point: 'transit_stop', where: { line: 'l_metro', kind: 'metro', stop: 's_b', block: 'b_b', district: 'd_hive', period: 'peak' } }],
      [{ point: 'transit_stop', where: { line: 'l_metro', kind: 'metro', stop: 's_c', block: 'b_c', district: 'd_hive', period: 'peak' } }],
    ])
    expect(trip(g)).toMatchObject({ at: 2, rode: 2, paid: 4, phase: 'aboard' })
  })

  it('還在月台上不能坐車，要先等車；等過了不能再等；沒有在搭車時都被擋', () => {
    const g = mk()
    expect(waitBlock(g.k, g.state)).toBe('你沒有在搭車。')
    expect(advanceBlock(g.k, g.state)).toBe('你沒有在搭車。')
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    expect(advanceBlock(g.k, g.state)).toMatch(/等車/)
    expect(() => advance(g.k, g.state)).toThrow(ActionBlocked)
    one(g, wait(g.k, g.state))
    expect(waitBlock(g.k, g.state)).toMatch(/在車上了/)
    expect(() => wait(g.k, g.state)).toThrow(ActionBlocked)
    expect(advanceBlock(g.k, g.state)).toBeNull()
  })

  it('尖峰與深夜：每一站的 where.period 照時段（上午是 peak、深夜是 night、其餘 day）；不停駛的線深夜照樣坐得下去', () => {
    const periodOf = (time: GameState['time']): string => {
      const g = mk({ time })
      stand(g, 'b_a')
      one(g, board(g.k, g.state, { line: 'l_loop', pay: 'cred' }))
      one(g, wait(g.k, g.state))
      return (one(g, advance(g.k, g.state)).triggers![0]!.where as Rec).period
    }
    expect(periodOf(MORNING)).toBe('peak')
    expect(periodOf({ day: 1, hour: 12, minute: 0 })).toBe('day')
    expect(periodOf(LATE)).toBe('night')
  })

  it('transit_rule 可以改尖峰與深夜是哪些時段', () => {
    const g = mk({ pack: content((c) => { c.transit_rule![0]!.peak = ['dawn']; c.transit_rule![0]!.night = ['noon'] }), time: { day: 1, hour: 12, minute: 0 } })
    stand(g, 'b_a')
    expect(boardBlock(g.k, g.state, METRO_AB)).toMatch(/深夜停駛/) // 中午被當成深夜
    one(g, board(g.k, g.state, { line: 'l_loop', pay: 'cred' }))
    one(g, wait(g.k, g.state))
  })

  it('目的地只是記號：到了不會自動下車，繼續坐也行（到站在摘要提一句）', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, { ...METRO_AB, dest: 's_b' }))
    one(g, wait(g.k, g.state))
    const r = one(g, advance(g.k, g.state))
    expect(r.outcome.summary).toContain('這是你要去的那一站')
    expect(trip(g)).not.toBeNull()
    expect(advanceBlock(g.k, g.state)).toBeNull()
    one(g, advance(g.k, g.state))
    expect(trip(g)!.at).toBe(2)
  })

  it('錢不夠付下一站：被擋並建議下車；下車照樣下得了', () => {
    const g = mk({ money: { cred: 3, cash: 0 } })
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB)) // 付起跳 2，剩 1
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state)) // 付 1，剩 0
    expect(advanceBlock(g.k, g.state)).toMatch(/不夠付下一站的車資.*下車/)
    expect(alight(g.k, g.state).outcome.result).toBe('alighted')
  })
})

describe('下車與終點站', () => {
  it('下車：人在那一站的街區、站在車站的標記上，活動 ride 結束；那一站記成去過；報告 transit.alight', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    one(g, wait(g.k, g.state))
    rideTo(g, 2)
    const r = one(g, alight(g.k, g.state))
    expect(r.action).toBe('transit.alight')
    expect(g.state.location).toEqual({ district: 'd_hive', block: 'b_c', facility: 'F1' })
    expect(g.state.maps.at).toMatchObject({ sheet: 'street', x: 1, y: 1 })
    expect(g.k.conditions.test({ kind: 'at_facility', types: ['fac_station'] } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(true)
    expect(trip(g)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(transitOf(g.state).visited).toEqual([stationKey('b_a', 'F1'), stationKey('b_c', 'F1')])
    expect(transitOf(g.state).trips).toBe(1)
    // 下了車可以接著搭下一趟：編號是 r2
    one(g, board(g.k, g.state, METRO_AB))
    expect(trip(g)!.id).toBe('r2')
  })

  it('下車時發 activity.end（kind 是 ride），聽的人拿得到線、站、坐了幾站、付了多少', () => {
    const g = mk()
    const seen: unknown[] = []
    g.k.hooks.on('activity.end', 'spy', (p) => { if (p.kind === 'ride') seen.push({ id: p.id, outcome: p.outcome, origin: p.origin, result: p.result }) })
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state))
    one(g, alight(g.k, g.state))
    expect(seen).toEqual([{ id: 'r1', outcome: 'alight', origin: { by: 'transit', ref: 'l_metro' }, result: { line: 'l_metro', stop: 's_b', rode: 1, paid: 3, pay: 'cred' } }])
  })

  it('車上時走地圖被擋下；別的功能的報告也被擋（白名單）；transit、event、free_action、npc 放行', () => {
    const g = mk()
    stand(g, 'b_a', 'E1')
    g.gridMove('east')
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    one(g, wait(g.k, g.state))
    const r = g.gridMove('east')
    expect(r.status).toBe('refused')
    expect(r.reason).toBe('你在車上，要先下車才能做這件事。')
    expect(() => g.commit(arrive(g.k, g.state, 'b_b'))).toThrow(ActionBlocked)
    expect(g.blockOf('commit:rest.sleep')).toBe('你在車上，要先下車才能做這件事。')
    for (const ok of ['commit:transit.stop', 'commit:event.choose', 'event.start', 'chain:free_action', 'commit:npc.talk']) expect(g.blockOf(ok), ok).toBeNull()
  })

  it('在月台上時的說法是「在月台上」；月台上下車：人還在原地、起跳不退，這一趟結束', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    expect(g.blockOf('commit:rest.sleep')).toBe('你在月台上，要先下車才能做這件事。')
    const loc = clone(g.state.location)
    const r = one(g, alight(g.k, g.state))
    expect(r.outcome.summary).toContain('沒有坐車')
    expect(g.state.location).toEqual(loc)
    expect(g.state.money.cred).toBe(998)
    expect(trip(g)).toBeNull()
  })

  it('到終點站一定要下車：不能再往前坐，原因寫出終點站；往回坐是另一趟', () => {
    const g = mk()
    stand(g, 'b_c')
    one(g, board(g.k, g.state, METRO_AB)) // C 往 D 方向
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state)) // 到 D：終點
    expect(advanceBlock(g.k, g.state)).toBe('這裡是地鐵紅線往D站的終點站，車不再往前開了，要在這一站下車。')
    expect(() => advance(g.k, g.state)).toThrow(ActionBlocked)
    one(g, alight(g.k, g.state))
    expect(g.state.location.block).toBe('b_d')
    // 往回開：D 站是終點，往前的方向沒有車；沒指定方向時自動往 A 的方向
    expect(boardBlock(g.k, g.state, { ...METRO_AB, dir: 1 })).toMatch(/終點站/)
    expect(boardBlock(g.k, g.state, METRO_AB)).toBeNull()
    one(g, board(g.k, g.state, { ...METRO_AB, dir: -1 }))
    one(g, wait(g.k, g.state))
    rideTo(g, 3)
    expect(trip(g)).toMatchObject({ at: 0, dir: -1 })
    expect(advanceBlock(g.k, g.state)).toMatch(/往A站的終點站/)
  })

  it('環線坐一圈回到上車的那一站；沒有終點，一直坐得下去', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, { line: 'l_loop', pay: 'cred', dest: 'r_x' }))
    one(g, wait(g.k, g.state))
    const t0 = min(g)
    const stops = rideTo(g, 3)
    expect(stops.map((r) => (r.triggers![0]!.where as Rec).stop)).toEqual(['r_c', 'r_x', 'r_a'])
    expect(min(g) - t0).toBe(24)
    expect(trip(g)).toMatchObject({ at: 0, rode: 3 })
    expect(advanceBlock(g.k, g.state)).toBeNull()
    rideTo(g, 2) // 再兩站
    expect(trip(g)!.rode).toBe(5)
    one(g, alight(g.k, g.state))
    expect(g.state.location).toEqual({ district: 'd_crown', block: 'b_x', facility: 'F1' }) // 五站：C、X、A、C、X
    expect(g.state.money.cred).toBe(1000 - 3) // 環線每站不加錢
  })

  it('轉乘：下車之後在那一站上另一條線', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    one(g, wait(g.k, g.state))
    rideTo(g, 2)
    one(g, alight(g.k, g.state)) // C 站
    expect(boardBlock(g.k, g.state, { line: 'l_loop', pay: 'cred' })).toBeNull()
    one(g, board(g.k, g.state, { line: 'l_loop', pay: 'cred' }))
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state))
    one(g, alight(g.k, g.state))
    expect(g.state.location).toMatchObject({ district: 'd_crown', block: 'b_x' })
  })
})

describe('進站掃橋', () => {
  const scanned = (c: Record<string, Rec[]>): void => { line(c, 'l_metro').scan = 2; line(c, 'l_metro').faction = 'f_a' }
  const withFaction = (c: Record<string, Rec[]>): void => { c.faction = [{ id: 'f_a', name: '甲勢力', short: '甲', class: 'corp' }]; scanned(c) }

  it('掃橋的替身回 passed: false：沒有上車、沒有扣錢、沒有活動', () => {
    const stub: ScanStub = { passed: false, calls: [] }
    const g = mk({ features: [worldFeature, transitFeature, scanStub(stub)], pack: content(withFaction) })
    stand(g, 'b_a')
    const before = structuredClone(g.state.money)
    const reports = g.commit(board(g.k, g.state, METRO_AB))
    expect(reports.map((r) => r.action)).toEqual(['transit.board', 'scan.stop'])
    expect(trip(g)).toBeNull()
    expect(g.state.money).toEqual(before)
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(transitOf(g.state).visited).toEqual([])
    expect(reports[1]!.outcome.summary).toBeTruthy()
    // 發起掃橋的是 transit；強度與勢力照線
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.setup).toEqual({ point: 'l_metro:s_a', name: 'A站的閘門', strength: 2, faction: 'f_a' })
    expect(stub.calls[0]!.origin).toMatchObject({ by: 'transit', ref: 'board' })
  })

  it('掃橋過了才上車、車資這時才扣；沒有掃橋的線（強度 0 或沒寫）不開掃橋', () => {
    const stub: ScanStub = { passed: true, calls: [] }
    const g = mk({ features: [worldFeature, transitFeature, scanStub(stub)], pack: content(withFaction) })
    stand(g, 'b_a')
    const reports = g.commit(board(g.k, g.state, { ...METRO_AB, dest: 's_d' }))
    expect(reports.map((r) => r.action)).toEqual(['transit.board', 'scan.pass'])
    expect(g.state.money.cred).toBe(998)
    expect(trip(g)).toMatchObject({ id: 'r1', line: 'l_metro', phase: 'platform', dest: 's_d', pay: 'cred', paid: 2 })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['ride'])
    one(g, wait(g.k, g.state)) // 接著等車、坐車都照常
    // 環線沒有 scan：不經掃橋
    one(g, alight(g.k, g.state))
    stub.calls.length = 0
    g.commit(board(g.k, g.state, { line: 'l_loop', pay: 'cred' }))
    expect(stub.calls).toEqual([])
  })

  it('掃橋以現金買票：過了之後記的是現金', () => {
    const stub: ScanStub = { passed: true, calls: [] }
    const g = mk({ features: [worldFeature, transitFeature, scanStub(stub)], pack: content(withFaction) })
    stand(g, 'b_a')
    g.commit(board(g.k, g.state, { line: 'l_metro', pay: 'cash' }))
    expect(trip(g)!.pay).toBe('cash')
    expect(g.state.money).toEqual({ cred: 1000, cash: 498 })
  })

  it('沒有人登記掃橋（沒裝 security）：當成過了，直接上車', () => {
    const g = mk({ pack: content((c) => { line(c, 'l_metro').scan = 2 }), features: [worldFeature, transitFeature] })
    stand(g, 'b_a')
    const reports = g.commit(board(g.k, g.state, METRO_AB))
    expect(reports.map((r) => r.action)).toEqual(['transit.board'])
    expect(trip(g)).not.toBeNull()
  })

  it('掃橋開著之前就擋下的（錢不夠、深夜停駛）：不會去掃', () => {
    const stub: ScanStub = { passed: true, calls: [] }
    const g = mk({ features: [worldFeature, transitFeature, scanStub(stub)], pack: content(withFaction), time: LATE })
    stand(g, 'b_a')
    expect(() => board(g.k, g.state, METRO_AB)).toThrow(ActionBlocked)
    expect(stub.calls).toEqual([])
  })

  it('整合：真的 security 與事件視窗，強度 1、沒有勢力、身上沒東西的人直接過', () => {
    const g = mk({ features: [worldFeature, directorFeature, eventRunFeature, securityFeature, transitFeature], pack: content((c) => { line(c, 'l_metro').scan = 1; delete line(c, 'l_metro').faction }) })
    stand(g, 'b_a')
    const reports = g.commit(board(g.k, g.state, METRO_AB))
    expect(reports.map((r) => r.action)).toEqual(['transit.board', 'scan.pass'])
    expect(trip(g)).not.toBeNull()
    expect(g.state.money.cred).toBe(998)
  })
})

describe('浮空計程車', () => {
  const X = stationKey('b_x', 'F1')

  it('沒去過的站被擋；去過之後叫得到', () => {
    const g = mk()
    stand(g, 'b_a')
    expect(taxiBlock(g.k, g.state, X)).toBe('你還沒去過X站，浮空計程車只載你去去過的站。')
    expect(() => taxi(g.k, g.state, X)).toThrow(ActionBlocked)
    expect(taxiBlock(g.k, g.state, 'nowhere:F1')).toMatch(/沒有/)
    // 下車過就算去過
    one(g, board(g.k, g.state, { line: 'l_loop', pay: 'cred' }))
    one(g, wait(g.k, g.state))
    rideTo(g, 1)
    one(g, alight(g.k, g.state))
    expect(taxiBlock(g.k, g.state, stationKey('b_a', 'F1'))).toBeNull() // 上車的那一站
    expect(taxiBlock(g.k, g.state, stationKey('b_c', 'F1'))).toBe('你已經在C站了。')
    expect(taxiBlock(g.k, g.state, X)).toMatch(/還沒去過X站/) // 路過沒停的不算
  })

  it('transit_rule.anywhere 放寬：沒去過的站也叫得到', () => {
    const g = mk({ pack: content((c) => { c.transit_rule![0]!.anywhere = true }) })
    stand(g, 'b_a')
    expect(taxiBlock(g.k, g.state, X)).toBeNull()
  })

  it('fastTravel 關著不能叫', () => {
    const g = mk({ rules: { fastTravel: false } })
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [X], trips: 0, trip: null }
    expect(taxiBlock(g.k, g.state, X)).toBe('存檔規則關掉了快速移動，浮空計程車叫不到。')
    expect(transitView(g.k, g.state).taxi.reason).toBe('存檔規則關掉了快速移動，浮空計程車叫不到。')
    // 搭大眾運輸不受影響
    expect(boardBlock(g.k, g.state, METRO_AB)).toBeNull()
  })

  it('有些區不去：目的地在 no_taxi 的區被擋', () => {
    const g = mk({ pack: content((c) => { c.transit_rule![0]!.no_taxi = ['d_crown'] }) })
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [X, stationKey('b_c', 'F1')], trips: 0, trip: null }
    expect(taxiBlock(g.k, g.state, X)).toBe('浮空計程車不進冠冕區。')
    expect(taxiBlock(g.k, g.state, stationKey('b_c', 'F1'))).toBeNull()
  })

  it('車資 = 起跳 ＋ 每公里 × 公里數，乘目的地那一區的物價；帳戶付、時間 10 分鐘', () => {
    const g = mk()
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [X, stationKey('b_c', 'F1')], trips: 0, trip: null }
    const t0 = min(g)
    // 蜂巢到冠冕 6 公里：(25 + 4 × 6) × 1.5 = 73.5 → 74
    const [d, a] = taxi(g.k, g.state, X)
    expect(g.state.money.cred).toBe(1000)
    g.commit(d!)
    expect(g.state.money).toEqual({ cred: 926, cash: 500 })
    expect(min(g) - t0).toBe(10)
    g.commit(a!)
    expect(g.state.location).toEqual({ district: 'd_crown', block: 'b_x', facility: 'F1' })
    expect(g.state.maps.at).toMatchObject({ x: 1, y: 1 })
    // 回蜂巢 C 站：(25 + 4 × 6) × 1 = 49（同樣 6 公里，蜂巢的物價 1）
    const [d2] = taxi(g.k, g.state, stationKey('b_c', 'F1'))
    g.commit(d2!)
    expect(g.state.money.cred).toBe(926 - 49)
    expect(min(g) - t0).toBe(20)
  })

  it('同一區 taxi_same_km 公里；兩區之間表上沒有的用預設公里；物價低於 1 當 1', () => {
    const g = mk({ pack: content((c) => { c.district![0]!.price_mult = 0.5; c.transit_rule![0] = { id: 'default', taxi_same_km: 3, taxi_default_km: 9 } }) })
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [X, stationKey('b_c', 'F1')], trips: 0, trip: null }
    const sameDistrict = transitView(g.k, g.state).taxi.destinations.find((x) => x.key === stationKey('b_c', 'F1'))!
    expect(sameDistrict).toMatchObject({ km: 3, fare: 37, districtName: '蜂巢' }) // (25 + 12) × max(1, 0.5)
    const far = transitView(g.k, g.state).taxi.destinations.find((x) => x.key === X)!
    expect(far).toMatchObject({ km: 9, fare: 92 }) // (25 + 36) × 1.5 = 91.5，四捨五入 92
  })

  it('出發與抵達各一份報告，各帶 transit_taxi（where.phase）', () => {
    const g = mk()
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [X], trips: 0, trip: null }
    const ds = taxi(g.k, g.state, X)
    expect(ds).toHaveLength(2)
    const rs = ds.flatMap((d) => g.commit(d))
    expect(rs.map((r) => r.action)).toEqual(['transit.taxi', 'transit.taxi'])
    expect(rs.map((r) => r.triggers)).toEqual([
      [{ point: 'transit_taxi', where: { phase: 'depart', kind: 'taxi', district: 'd_hive', block: 'b_a' } }],
      [{ point: 'transit_taxi', where: { phase: 'arrive', kind: 'taxi', block: 'b_x', district: 'd_crown' } }],
    ])
  })

  it('錢不夠、在車上、已經在那一站：被擋並有原因', () => {
    const g = mk({ money: { cred: 10, cash: 500 } })
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [X, stationKey('b_a', 'F1')], trips: 0, trip: null }
    expect(taxiBlock(g.k, g.state, X)).toBe('帳戶不夠：要 74，你有 10。')
    expect(taxiBlock(g.k, g.state, stationKey('b_a', 'F1'))).toBe('你已經在A站了。')
    one(g, board(g.k, g.state, { line: 'l_bus', pay: 'cash' }))
    expect(taxiBlock(g.k, g.state, X)).toBe('你在車上，要先下車才能叫計程車。')
  })

  it('不在任何站上也叫得到（從城市地圖直接叫）', () => {
    const g = mk()
    stand(g, 'b_a', 'E1')
    g.state.ext.transit = { visited: [X], trips: 0, trip: null }
    expect(taxiBlock(g.k, g.state, X)).toBeNull()
  })
})

describe('亂數與存檔', () => {
  const waitMinutes = (seed: number): number => {
    const g = mk({ seed })
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    const t0 = min(g)
    one(g, wait(g.k, g.state))
    return min(g) - t0
  }

  it('同一個種子等車的分鐘數一樣；不同種子散在範圍裡', () => {
    expect(waitMinutes(7)).toBe(waitMinutes(7))
    const all = Array.from({ length: 40 }, (_, i) => waitMinutes(i + 1))
    expect(all.every((m) => m >= 2 && m <= 6)).toBe(true)
    expect(new Set(all).size).toBeGreaterThan(2)
  })

  it('等車用掉一次亂數：下一趟的等車不會和上一趟一樣固定', () => {
    const g = mk({ seed: 11 })
    stand(g, 'b_a')
    const seen = new Set<number>()
    for (let i = 0; i < 12; i++) {
      one(g, board(g.k, g.state, METRO_AB))
      const t0 = min(g)
      one(g, wait(g.k, g.state))
      seen.add(min(g) - t0)
      one(g, alight(g.k, g.state))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('車上存檔再讀，接著坐、接著下車', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, { ...METRO_AB, dest: 's_d' }))
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state))
    const raw = g.save()
    const g2 = mk()
    expect(g2.load(raw)).toBeNull()
    expect(transitOf(g2.state)).toEqual(transitOf(g.state))
    expect(g2.k.activity.active(g2.state).map((a) => a.kind)).toEqual(['ride'])
    expect(g2.gridMove('east').status).toBe('refused')
    one(g2, advance(g2.k, g2.state))
    expect(trip(g2)).toMatchObject({ at: 2, rode: 2 })
    one(g2, alight(g2.k, g2.state))
    expect(g2.state.location).toMatchObject({ block: 'b_c', facility: 'F1' })
    expect(g2.k.activity.active(g2.state)).toEqual([])
  })

  it('不變式：一趟的報告套用之後等於實際的變化（含掃橋與計程車）', async () => {
    const g = mk()
    stand(g, 'b_a')
    const { violations } = await observed(g, () => {
      one(g, board(g.k, g.state, METRO_AB))
      one(g, wait(g.k, g.state))
      rideTo(g, 3)
      one(g, alight(g.k, g.state))
      for (const d of taxi(g.k, g.state, stationKey('b_a', 'F1'))) g.commit(d)
    })
    expect(violations).toEqual([])
  })
})

describe('對外：transitView', () => {
  it('站在車站上：這一站停哪幾條線、開不開與原因、每一站的車資與幾分鐘', () => {
    const g = mk()
    stand(g, 'b_c')
    const v = transitView(g.k, g.state)
    expect(v.ride).toBeNull()
    expect(v.station).toMatchObject({ key: 'b_c:F1', name: 'C' })
    expect(v.station!.lines.map((l) => [l.id, l.open, l.reason])).toEqual([['l_metro', true, null], ['l_loop', true, null]])
    const metro = v.station!.lines[0]!
    expect(metro).toMatchObject({ kind: 'metro', scan: 0, pay: ['cred', 'cash'], wait: [2, 6], minutes_per_stop: 5, fare: { base: 2, per_stop: 1 }, affordable: ['cred', 'cash'] })
    expect(metro.directions.map((d) => [d.dir, d.toward, d.reason])).toEqual([[1, 'D', null], [-1, 'A', null]])
    expect(metro.directions[0]!.stops).toEqual([{ id: 's_d', name: 'D', count: 1, fare: 3, minutes: 5 }])
    expect(metro.directions[1]!.stops).toEqual([{ id: 's_b', name: 'B', count: 1, fare: 3, minutes: 5 }, { id: 's_a', name: 'A', count: 2, fare: 4, minutes: 10 }])
    const loop = v.station!.lines[1]!
    expect(loop.directions).toHaveLength(1)
    expect(loop.directions[0]).toMatchObject({ dir: 1, toward: null })
    expect(loop.directions[0]!.stops.map((s) => [s.id, s.count, s.fare, s.minutes])).toEqual([['r_x', 1, 3, 8], ['r_a', 2, 3, 16], ['r_c', 3, 3, 24]])
  })

  it('終點站：只列得出去的方向；深夜：線不開並寫原因；錢不夠：affordable 少那一種', () => {
    const g = mk({ time: LATE, money: { cred: 2, cash: 500 } })
    stand(g, 'b_d')
    const metro = transitView(g.k, g.state).station!.lines.find((l) => l.id === 'l_metro')!
    expect(metro).toMatchObject({ open: false, reason: '地鐵紅線深夜停駛，末班車已經過了。', affordable: ['cash'] })
    expect(metro.directions.map((d) => [d.dir, d.reason])).toEqual([[-1, null]]) // 往 D 的方向是終點站，不列
    expect(transitView(g.k, g.state).station!.lines.map((l) => l.id)).toEqual(['l_metro'])
  })

  it('不在車站上沒有 station；在車上有 ride：路線條、現在第幾站、還有幾站', () => {
    const g = mk()
    expect(transitView(g.k, g.state).station).toBeNull()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, { ...METRO_AB, dest: 's_c' }))
    let v = transitView(g.k, g.state)
    expect(v.station).toBeNull()
    expect(v.ride).toMatchObject({ line: { id: 'l_metro', name: '地鐵紅線', kind: 'metro' }, dir: 1, toward: 'D', phase: 'platform', at: 0, rode: 0, toTerminal: 3, minutes_per_stop: 5, pay: 'cred', paid: 2, recorded: true })
    expect(v.ride!.actions.wait).toBeNull()
    expect(v.ride!.actions.advance).toMatch(/等車/)
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state))
    v = transitView(g.k, g.state)
    expect(v.ride!.stops.map((s) => [s.id, s.state, s.dest, s.transfers])).toEqual([['s_a', 'past', false, ['l_loop', 'l_bus']], ['s_b', 'here', false, []], ['s_c', 'ahead', true, ['l_loop']], ['s_d', 'ahead', false, []]])
    expect(v.ride).toMatchObject({ at: 1, rode: 1, toTerminal: 2, dest: { id: 's_c', name: 'C' }, toDest: { stops: 1, minutes: 5 }, phase: 'aboard', paid: 3 })
    expect(v.ride!.actions).toEqual({ wait: expect.stringMatching(/在車上了/), advance: null })
    one(g, advance(g.k, g.state))
    expect(transitView(g.k, g.state).ride!.toDest).toBeNull() // 到了
    one(g, advance(g.k, g.state))
    expect(transitView(g.k, g.state).ride).toMatchObject({ toTerminal: 0 })
    expect(transitView(g.k, g.state).ride!.actions.advance).toMatch(/終點站/)
  })

  it('用現金買的那一趟，recorded 是 false（不留紀錄）', () => {
    const g = mk()
    stand(g, 'b_a')
    one(g, board(g.k, g.state, { line: 'l_metro', pay: 'cash' }))
    expect(transitView(g.k, g.state).ride!.recorded).toBe(false)
  })

  it('計程車：每一站的車資、公里、去過沒有、叫不成的原因', () => {
    const g = mk()
    stand(g, 'b_a')
    const t = transitView(g.k, g.state).taxi
    expect(t.minutes).toBe(10)
    expect(t.destinations.map((d) => [d.key, d.visited, d.reason])).toEqual([
      ['b_a:F1', false, '你已經在A站了。'], ['b_b:F1', false, '你還沒去過B站，浮空計程車只載你去去過的站。'], ['b_c:F1', false, expect.any(String)],
      ['b_d:F1', false, expect.any(String)], ['b_x:F1', false, expect.any(String)],
    ])
    expect(t.destinations.find((d) => d.key === 'b_x:F1')).toMatchObject({ km: 6, fare: 74, district: 'd_crown', districtName: '冠冕區', blockName: 'X' })
  })

  it('站的格子列「搭車」（gridView 的 uses）；深夜每一條線都停駛時灰掉並寫原因；車站以外的格子沒有', () => {
    const g = mk()
    stand(g, 'b_a')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'transit.board', name: '搭車', block: null }])
    const night = mk({ time: LATE, pack: content((c) => { c.transit_line = [structuredClone(METRO)] }) })
    stand(night, 'b_a')
    expect(night.gridView()!.here.uses).toEqual([{ id: 'transit.board', name: '搭車', block: '地鐵紅線深夜停駛，末班車已經過了。' }])
    const g3 = mk()
    stand(g3, 'b_a', 'E1')
    expect(g3.gridView()!.here.uses).toEqual([])
  })
})

describe('內容的格式與檢查', () => {
  const bad = (patch: (c: Record<string, Rec[]>) => void) => () => mk({ pack: content(patch) })

  it('預設的內容載得進來', () => {
    expect(bad(() => {})).not.toThrow()
  })

  it('線的格式：種類、站、班距、車資、付法、掃描強度', () => {
    expect(bad((c) => { line(c, 'l_metro').kind = 'rocket' })).toThrow(/transit_line\/l_metro.*kind/)
    expect(bad((c) => { line(c, 'l_metro').stops = [line(c, 'l_metro').stops[0]] })).toThrow(/至少兩站/)
    expect(bad((c) => { line(c, 'l_metro').stops[1].id = 's_a' })).toThrow(/重複/)
    expect(bad((c) => { line(c, 'l_metro').wait = [6, 2] })).toThrow(/wait/)
    expect(bad((c) => { line(c, 'l_metro').minutes_per_stop = 0 })).toThrow(/minutes_per_stop/)
    expect(bad((c) => { line(c, 'l_metro').fare = { base: -1, per_stop: 1 } })).toThrow(/fare/)
    expect(bad((c) => { line(c, 'l_metro').pay = ['gold'] })).toThrow(/pay/)
    expect(bad((c) => { line(c, 'l_metro').pay = [] })).toThrow(/pay/)
    expect(bad((c) => { line(c, 'l_metro').scan = 4 })).toThrow(/scan/)
    expect(bad((c) => { line(c, 'l_loop').stops = line(c, 'l_loop').stops.slice(0, 2) })).toThrow(/環線至少要有三站/)
  })

  it('每一站的街區與設施要找得到；勢力要找得到', () => {
    expect(bad((c) => { line(c, 'l_metro').stops[0].block = 'b_nope' })).toThrow(/transit_line\/l_metro.*b_nope/)
    expect(bad((c) => { line(c, 'l_metro').stops[0].at = 'F9' })).toThrow(/transit_line\/l_metro.*s_a.*F9/)
    expect(bad((c) => { line(c, 'l_metro').faction = 'f_nope' })).toThrow(/faction\/f_nope/)
    expect(bad((c) => { line(c, 'l_metro').stops[1] = { id: 's_b', name: 'A又一站', block: 'b_a', at: 'F1' } })).toThrow(/s_b.*同一個地方/)
  })

  it('transit_rule 的格式', () => {
    expect(bad((c) => { c.transit_rule![0]!.taxi_base = -1 })).toThrow(/taxi_base/)
    expect(bad((c) => { c.transit_rule![0]!.peak = ['teatime'] })).toThrow(/peak/)
    expect(bad((c) => { c.transit_rule![0]!.km = [{ a: 'x' }] })).toThrow(/km\/0/)
    expect(bad((c) => { c.transit_rule![0]!.no_taxi = [1] })).toThrow(/no_taxi/)
  })

  it('沒有 transit_rule 時用內建的預設（起跳 25、每公里 4、10 分鐘）', () => {
    expect(DEFAULT_TRANSIT_RULES).toMatchObject({ taxi_base: 25, taxi_per_km: 4, taxi_minutes: 10 })
    const g = mk({ pack: content((c) => { delete c.transit_rule }) })
    stand(g, 'b_a')
    g.state.ext.transit = { visited: [stationKey('b_c', 'F1')], trips: 0, trip: null }
    const dests = transitView(g.k, g.state).taxi.destinations
    expect(dests.find((d) => d.key === 'b_c:F1')).toMatchObject({ km: 2, fare: 33 }) // 同一區 2 公里：25 + 4 × 2
    expect(dests.find((d) => d.key === 'b_x:F1')).toMatchObject({ km: 10, fare: 98 }) // 表上沒有的 10 公里：(25 + 40) × 1.5 = 97.5
  })
})

describe('和其他功能一起裝', () => {
  it('裝上全部的功能：沒有登錄表衝突，上車、坐一站、下車照常', () => {
    const feats = allFeatures().some((f) => f.id === 'transit') ? allFeatures() : [...allFeatures(), transitFeature]
    const withWorld = feats.some((f) => f.id === 'world') ? feats : [...feats, worldFeature]
    const g = mk({ features: withWorld })
    stand(g, 'b_a')
    one(g, board(g.k, g.state, METRO_AB))
    one(g, wait(g.k, g.state))
    one(g, advance(g.k, g.state))
    one(g, alight(g.k, g.state))
    expect(g.state.location.block).toBe('b_b')
  })
})

