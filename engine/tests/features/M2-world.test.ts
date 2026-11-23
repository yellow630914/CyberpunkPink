// 驗收測試：dev/work/M2-world.md（cpp-feature）。規格：DISTRICTS 1.1～1.4 節；DATA 第 12 節（設施的種類）；EVENTS 3.1 節（enter_block、walk、enter_bridge、enter_facility）；
// UI 1.1 節（到了看得到能做的事、按了才做）；dev/adr/0012、0016 第二、六節與 G8。
// 內容一律用測試自帶的最小假資料：兩個區（蜂巢、鏽帶）、三塊街區（市場、塔下、院子）加一塊橋接區（閘門）。
//
//   市場 ── 塔下 ── 閘門（橋接區）── 院子
//   蜂巢（走一格 1 分鐘）          鏽帶（step_minutes 2）
// 每一塊版面是 14 × 5：E1 在 (0,2)、E2 在 (13,2)；市場與院子在 y=1 有三個設施的標記 (1,1)、(6,1)、(12,1)（圖例 F 對到 safe，標記 id 是 $1、$2、$3）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Kernel, Report, SpecialMapEntry } from '../../src'
import { ActionBlocked, ContentError, effectCtx, toMinutes } from '../../src'
import { allFeatures } from '../../src/features'
import { arrive, cityGraph, worldFeature, worldOf, worldProblems, worldView } from '../../src/features/world'
import { makeGame, observed } from '../../src/testkit'

// ---- 假資料 ----

const street = (id: string, name: string, withFacilities: boolean): SpecialMapEntry => ({
  id: `m_${id}`, kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name, size: [14, 5],
    layout: ['##############', withFacilities ? '#F....F.....F#' : '#............#', 'E.1........2.E', '#............#', '##############'],
    legend: { F: 'safe' },
    cells: [
      ...(withFacilities ? [{ id: '$1', at: [1, 1] as [number, number], mark: '$', name: '一號攤位' }, { id: '$2', at: [6, 1] as [number, number], mark: '$', name: '二號攤位' }, { id: '$3', at: [12, 1] as [number, number], mark: '$', name: '三號攤位' }] : []),
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
})

const MAPS: SpecialMapEntry[] = [street('market', '市場', true), street('tower', '塔下', false), street('gate', '閘門', false), street('yard', '院子', true)]

const clinicHours = { time: ['morning', 'noon', 'afternoon'] }
const SATURDAY = { weekday: [5] }

const content = (patch: (c: Record<string, any[]>) => void = () => {}): ContentPack => {
  const c: Record<string, any[]> = {
    special_map: MAPS.map((m) => structuredClone(m)),
    facility_type: [{ id: 'fac_clinic', name: '診所' }, { id: 'fac_bar', name: '酒吧' }, { id: 'fac_stall', name: '攤販' }],
    district: [
      { id: 'd_hive', name: '蜂巢', grade: 1, price_mult: 1, blocks: ['b_market', 'b_tower', 'b_gate'] },
      { id: 'd_rust', name: '鏽帶', grade: 2, step_minutes: 2, blocks: ['b_yard'] },
    ],
    block: [
      { id: 'b_market', district: 'd_hive', name: '市場', kind: 'block', map: 'm_market', exits: { E2: { to: 'b_tower', arrive: 'E1' } }, facilities: { $1: { type: 'fac_clinic', name: '後巷診所', open: clinicHours }, $2: { type: 'fac_stall', name: '中段的小攤' }, $3: { type: 'fac_bar', name: '霓虹酒吧', open: SATURDAY } } },
      { id: 'b_tower', district: 'd_hive', name: '塔下', kind: 'block', map: 'm_tower', exits: { E1: { to: 'b_market', arrive: 'E2' }, E2: { to: 'b_gate', arrive: 'E1' } }, facilities: {} },
      { id: 'b_gate', district: 'd_hive', name: '閘門', kind: 'bridge', map: 'm_gate', exits: { E1: { to: 'b_tower', arrive: 'E2' }, E2: { to: 'b_yard', arrive: 'E1' } }, facilities: {} },
      { id: 'b_yard', district: 'd_rust', name: '院子', kind: 'block', map: 'm_yard', exits: { E1: { to: 'b_gate', arrive: 'E2' } }, facilities: { $1: { type: 'fac_stall', name: '鐵皮攤' } } },
    ],
  }
  patch(c)
  return { id: 'world_test', content: c }
}

type G = ReturnType<typeof makeGame>['game']
const world = (o: { time?: GameState['time']; pack?: ContentPack; features?: Feature[] } = {}): G =>
  makeGame({ features: o.features ?? [worldFeature], content: [o.pack ?? content()], ...(o.time ? { patch: { time: o.time } } : {}) }).game

/** 到一塊街區（走提交，和介面一樣）。 */
const go = (g: G, block: string, at?: string): Report[] => g.commit(arrive(g.k, g.state, block, at))
const where = (g: G) => g.state.location
const at = (g: G) => g.state.maps.at
const minutes = (g: G) => toMinutes(g.state.time)
const triggers = (rs: Report[]) => rs.flatMap((r) => r.triggers ?? [])
const test = (g: G, cond: Record<string, unknown>) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

describe('到一塊街區：arrive', () => {
  it('開一份實例、站到指定的標記、改 location；報告是 world.arrive 並帶 enter_block', () => {
    const g = world()
    const [r] = go(g, 'b_market', 'E2')
    expect(r!.action).toBe('world.arrive')
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_market' })
    expect(at(g)).toMatchObject({ sheet: 'street', x: 13, y: 2 })
    const inst = g.state.maps.instances[at(g)!.map]!
    expect(inst).toMatchObject({ def: 'm_market', owner: 'world', ext: { block: 'b_market' } })
    expect(worldOf(g.state)).toMatchObject({ instances: { b_market: inst.id }, visited: ['b_market'], steps: 0 })
    expect(r!.triggers).toEqual([{ point: 'enter_block', where: { district: 'd_hive', block: 'b_market' } }])
  })

  it('沒指定標記就站在第一個入口；站在設施的標記上時 location.facility 是那個標記', () => {
    const g = world()
    go(g, 'b_market')
    expect(at(g)).toMatchObject({ x: 0, y: 2 })
    go(g, 'b_yard', '$1')
    expect(at(g)).toMatchObject({ x: 1, y: 1 })
    expect(where(g)).toEqual({ district: 'd_rust', block: 'b_yard', facility: '$1' })
    go(g, 'b_tower', 'E2')
    expect(where(g).facility).toBeUndefined()
  })

  it('橋接區帶 enter_bridge', () => {
    const g = world()
    const [r] = go(g, 'b_gate')
    expect(r!.triggers).toEqual([{ point: 'enter_bridge', where: { district: 'd_hive', block: 'b_gate' } }])
  })

  it('沒有這塊街區、版面上沒有這個標記：丟錯，狀態不動', () => {
    const g = world()
    expect(() => arrive(g.k, g.state, 'b_nowhere')).toThrow(/b_nowhere/)
    expect(() => arrive(g.k, g.state, 'b_market', 'E9')).toThrow(/E9/)
    expect(g.state.maps.at).toBeNull()
  })

  it('不變式：報告套用之後等於實際的變化', async () => {
    const g = world()
    const { violations } = await observed(g, () => go(g, 'b_market'))
    expect(violations).toEqual([])
  })
})

describe('走到出口換街區', () => {
  it('走到出口那一格：這一段路到那裡為止，人在隔壁那一塊的對應標記上，location.block 換了', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const r = g.gridMove([13, 2])
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'world.arrive'])
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_tower' })
    expect(at(g)).toMatchObject({ x: 0, y: 2 })
    expect(g.state.maps.instances[at(g)!.map]!.ext).toEqual({ block: 'b_tower' })
    expect(r.reports[1]!.triggers).toEqual([{ point: 'enter_block', where: { district: 'd_hive', block: 'b_tower' } }])
    expect(worldOf(g.state).visited).toEqual(['b_market', 'b_tower'])
  })

  it('走進橋接區帶 enter_bridge；從橋接區走到另一個區的街區帶 enter_block，location.district 跟著換', () => {
    const g = world()
    go(g, 'b_tower', 'E1')
    let r = g.gridMove([13, 2])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'world.arrive'])
    expect(triggers(r.reports).filter((t) => t.point !== 'walk')).toEqual([{ point: 'enter_bridge', where: { district: 'd_hive', block: 'b_gate' } }])
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_gate' })
    // 站在橋接區的 E1：先離開那一格再走到東口
    g.gridMove('east')
    r = g.gridMove([13, 2])
    expect(triggers(r.reports).filter((t) => t.point !== 'walk')).toEqual([{ point: 'enter_block', where: { district: 'd_rust', block: 'b_yard' } }])
    expect(where(g)).toEqual({ district: 'd_rust', block: 'b_yard' })
  })

  it('一格一格走上出口也一樣', () => {
    const g = world()
    go(g, 'b_market', 'E2')
    g.gridMove('west')
    const r = g.gridMove('east')
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'world.arrive'])
    expect(where(g).block).toBe('b_tower')
  })

  it('回到原本那一塊：同一份實例，之前看過的格子還是看過的', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const first = at(g)!.map
    const seenAtStart = g.state.maps.instances[first]!.sheets.street!.seen[2]!
    expect(seenAtStart[8]).toBe('0') // 一開始只看得到五格以內
    g.gridMove([13, 2]) // 走過整條街，到塔下
    expect(where(g).block).toBe('b_tower')
    g.gridMove('east')
    g.gridMove('west') // 塔下的 E1 通回市場的 E2
    expect(where(g).block).toBe('b_market')
    expect(at(g)).toMatchObject({ map: first, x: 13, y: 2 })
    expect(Object.keys(g.state.maps.instances).sort()).toEqual([first, 'm2'])
    expect(worldOf(g.state).instances).toEqual({ b_market: first, b_tower: 'm2' })
    const seen = g.state.maps.instances[first]!.sheets.street!.seen
    expect(seen[2]![8]).toBe('1') // 走過的路還看得到
    expect(seen[2]!.slice(0, 14)).toBe('11111111111111')
    expect(worldOf(g.state).visited).toEqual(['b_market', 'b_tower'])
  })

  it('改過的格子也留著（同一份實例）', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const id = at(g)!.map
    g.commit({ kind: 'system', action: 'test.mark', location: {}, party: [], timeline: [], changes: [{ op: 'map.sheet', map: id, sheet: 'street', cells: { '5,3': { used: true } } }], outcome: { result: 'ok', summary: '標記' } })
    go(g, 'b_tower')
    go(g, 'b_market')
    expect(at(g)!.map).toBe(id)
    expect(g.state.maps.instances[id]!.sheets.street!.cells['5,3']).toEqual({ used: true })
  })
})

describe('走路花時間（G8）', () => {
  it('走 10 格，時間多了 10 個 step_minutes：蜂巢沒寫是 1 分鐘', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const t0 = minutes(g)
    const r = g.gridMove([10, 2])
    expect(r.reports).toHaveLength(1)
    expect(minutes(g) - t0).toBe(10)
    expect(worldOf(g.state).steps).toBe(10)
  })

  it('鏽帶寫 2：走 10 格是兩倍', () => {
    const g = world()
    go(g, 'b_yard', 'E1')
    const t0 = minutes(g)
    g.gridMove([10, 2])
    expect(minutes(g) - t0).toBe(20)
    expect(worldOf(g.state).steps).toBe(10)
  })

  it('一格一格走：每一格都加時間，走過的格數累計', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const t0 = minutes(g)
    g.gridMove('east')
    g.gridMove('east')
    g.gridMove('south')
    expect(minutes(g) - t0).toBe(3)
    expect(worldOf(g.state).steps).toBe(3)
  })

  it('走不過去（牆）：整步不成立，不花時間也不算格數', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const t0 = minutes(g)
    const r = g.gridMove('north')
    expect(r.status).toBe('refused')
    expect(minutes(g)).toBe(t0)
    expect(worldOf(g.state).steps).toBe(0)
  })

  it('不在 world 開的實例上（別人開的地圖）：不加時間、不算格數', () => {
    const g = world()
    const id = g.enterMap('m_market')
    g.gridMove('east')
    expect(minutes(g)).toBe(toMinutes({ day: 1, hour: 8, minute: 0 }))
    expect(worldOf(g.state).steps).toBe(0)
    expect(g.state.maps.instances[id]!.owner).toBeUndefined()
  })
})

describe('觸發點：walk', () => {
  it('第 10 格的那一份報告帶 walk；沒到 10 格的不帶', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    let r = g.gridMove([9, 2])
    expect(triggers(r.reports)).toEqual([])
    r = g.gridMove('east')
    expect(triggers(r.reports)).toEqual([{ point: 'walk', where: { district: 'd_hive', block: 'b_market' } }])
  })

  it('累計的：先走 4 格再走 6 格，第二段的最後一格是第 10 格', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    expect(triggers(g.gridMove([4, 2]).reports)).toEqual([])
    const r = g.gridMove([10, 2])
    expect(triggers(r.reports).map((t) => t.point)).toEqual(['walk'])
    expect(worldOf(g.state).steps).toBe(10)
  })

  it('一段路走 10 格只帶一個；走到出口那一段（13 格）也只有一個，換街區的那份是另一份報告', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    expect(triggers(g.gridMove([10, 2]).reports)).toHaveLength(1)
    const r = g.gridMove([13, 2])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'world.arrive'])
    expect(triggers(r.reports).map((t) => t.point)).toEqual(['enter_block'])
    expect(worldOf(g.state).steps).toBe(13)
  })

  it('不同區的 walk 的 where 是自己那一區', () => {
    const g = world()
    go(g, 'b_yard', 'E1')
    const r = g.gridMove([10, 2])
    expect(triggers(r.reports)).toEqual([{ point: 'walk', where: { district: 'd_rust', block: 'b_yard' } }])
  })
})

describe('設施', () => {
  it('走上設施：location.facility 有值、帶 enter_facility（where.facility 是設施的種類）、條件 at_facility 成立；走開之後沒有', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    g.gridMove('east')
    expect(test(g, { kind: 'at_facility' })).toBe(false)
    const r = g.gridMove('north') // 一號攤位在 (1,1)
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_market', facility: '$1' })
    expect(triggers(r.reports)).toEqual([{ point: 'enter_facility', where: { district: 'd_hive', block: 'b_market', facility: 'fac_clinic' } }])
    expect(test(g, { kind: 'at_facility' })).toBe(true)
    expect(test(g, { kind: 'at_facility', types: ['fac_clinic'] })).toBe(true)
    expect(test(g, { kind: 'at_facility', types: ['fac_bar', 'fac_stall'] })).toBe(false)
    g.gridMove('south')
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_market' })
    expect('facility' in where(g)).toBe(false)
    expect(test(g, { kind: 'at_facility' })).toBe(false)
    expect(test(g, { kind: 'at_facility', types: ['fac_clinic'] })).toBe(false)
  })

  it('用目的地走到設施那一格：停在那一格上', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const r = g.gridMove([1, 1])
    expect(where(g).facility).toBe('$1')
    expect(at(g)).toMatchObject({ x: 1, y: 1 })
    expect(triggers(r.reports).map((t) => t.point)).toEqual(['enter_facility'])
  })

  it('設施不擋路：一段路經過的每個設施一格一格照走（各帶 enter_facility），最後停在哪就是哪一間；站著的那一間走開就清掉', () => {
    const g = world()
    go(g, 'b_market', '$1') // 從一號攤位沿著 y=1 走到三號攤位：途中經過 (6,1) 的二號攤位
    const t0 = minutes(g)
    const r = g.gridMove([12, 1])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(at(g)).toMatchObject({ x: 12, y: 1 })
    expect(minutes(g) - t0).toBe(11)
    expect(triggers(r.reports)).toEqual([
      { point: 'enter_facility', where: { district: 'd_hive', block: 'b_market', facility: 'fac_stall' } },
      { point: 'walk', where: { district: 'd_hive', block: 'b_market' } }, // 第 10 格
      { point: 'enter_facility', where: { district: 'd_hive', block: 'b_market', facility: 'fac_bar' } },
    ])
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_market', facility: '$3' })
  })

  it('經過設施但沒停在上面：走完之後 location.facility 是空的', () => {
    const g = world()
    go(g, 'b_market', '$1')
    g.gridMove([8, 1]) // 經過二號攤位 (6,1)，停在 (8,1)
    expect(at(g)).toMatchObject({ x: 8, y: 1 })
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_market' })
    expect(test(g, { kind: 'at_facility' })).toBe(false)
  })

  it('從設施走去出口：facility 清掉、換街區之後也沒有', () => {
    const g = world()
    go(g, 'b_market', '$1')
    expect(where(g).facility).toBe('$1')
    g.gridMove([13, 2])
    expect(where(g)).toEqual({ district: 'd_hive', block: 'b_tower' })
  })

  it('營業時間：在時段裡開著，這個功能不列任何事', () => {
    const g = world() // 第 1 天 08:00，上午；週二
    go(g, 'b_market', '$1')
    expect(g.gridView()!.here.uses).toEqual([])
  })

  it('不在營業的時段：列一項灰掉的並寫原因', () => {
    const g = world({ time: { day: 1, hour: 1, minute: 0 } }) // 深夜
    go(g, 'b_market', '$1')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'closed', name: '進去', block: '現在沒有開。' }])
  })

  it('不在營業的星期：週六才開的酒吧，週二是灰的、週六開著', () => {
    const tue = world() // 第 1 天週二
    go(tue, 'b_market', '$3')
    expect(tue.gridView()!.here.uses.map((u) => u.block)).toEqual(['現在沒有開。'])
    const sat = world({ time: { day: 5, hour: 8, minute: 0 } }) // 第 5 天週六
    go(sat, 'b_market', '$3')
    expect(sat.gridView()!.here.uses).toEqual([])
  })

  it('深夜跨過午夜算前一天：週六深夜到週日凌晨酒吧的星期還是週六，但沒有寫時段所以一直開', () => {
    const g = world({ time: { day: 6, hour: 1, minute: 0 } }) // 日曆上的週日凌晨 1 點，算週六的深夜
    go(g, 'b_market', '$3')
    expect(g.gridView()!.here.uses).toEqual([])
  })

  it('沒寫營業時間的設施一直開；不是設施的格子沒有東西', () => {
    const g = world({ time: { day: 1, hour: 1, minute: 0 } })
    go(g, 'b_yard', '$1')
    expect(g.gridView()!.here.uses).toEqual([])
    go(g, 'b_yard', 'E1')
    expect(g.gridView()!.here.uses).toEqual([])
  })
})

describe('效果 move 與條件', () => {
  const resolve = (g: G, e: Record<string, unknown>) => g.k.effects.resolve([e], effectCtx(g.k, g.state, { source: 'builtin' }))

  it('move 把人帶到指定的街區（站在 at 這個標記上）；沒寫 at 是第一個入口', () => {
    const g = world()
    const r = resolve(g, { kind: 'move', block: 'b_yard', at: 'E1' })
    expect(r.errors).toEqual([])
    expect(r.lines).toEqual(['前往：院子'])
    g.commit({ kind: 'event', action: 'test.move', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '移動' } })
    expect(where(g)).toEqual({ district: 'd_rust', block: 'b_yard' })
    expect(at(g)).toMatchObject({ x: 0, y: 2 })
    const r2 = resolve(g, { kind: 'move', block: 'b_tower' })
    g.commit({ kind: 'event', action: 'test.move', location: {}, party: [], timeline: [], changes: r2.changes, outcome: { result: 'ok', summary: '移動' } })
    expect(where(g).block).toBe('b_tower')
    expect(at(g)).toMatchObject({ x: 0, y: 2 })
  })

  it('一批效果裡連續兩個 move：後面的看得到前面開的實例（不重複開）', () => {
    const g = world()
    const r = g.k.effects.resolve([{ kind: 'move', block: 'b_tower' }, { kind: 'move', block: 'b_market' }, { kind: 'move', block: 'b_tower', at: 'E2' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(r.errors).toEqual([])
    g.commit({ kind: 'event', action: 'test.move', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '移動' } })
    expect(Object.keys(g.state.maps.instances)).toHaveLength(2)
    expect(where(g).block).toBe('b_tower')
    expect(at(g)).toMatchObject({ x: 13, y: 2 })
  })

  it('不存在的街區、版面上沒有的標記：格式錯誤', () => {
    const g = world()
    expect(resolve(g, { kind: 'move', block: 'b_nowhere' }).errors.join('')).toMatch(/b_nowhere/)
    expect(resolve(g, { kind: 'move', block: 'b_market', at: 'E9' }).errors.join('')).toMatch(/E9/)
    expect(resolve(g, { kind: 'move' }).errors.length).toBeGreaterThan(0)
  })

  it('in_district、in_block', () => {
    const g = world()
    go(g, 'b_yard')
    expect(test(g, { kind: 'in_district', districts: ['d_rust'] })).toBe(true)
    expect(test(g, { kind: 'in_district', districts: ['d_hive'] })).toBe(false)
    expect(test(g, { kind: 'in_block', blocks: ['b_market', 'b_yard'] })).toBe(true)
    expect(test(g, { kind: 'in_block', blocks: ['b_market'] })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'in_block', blocks: [] })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'at_facility', types: ['fac_clinic'] })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'in_district' })).not.toEqual([])
  })

  it('不在任何街區時，三種條件都不成立', () => {
    const g = world()
    expect(test(g, { kind: 'in_district', districts: ['d_hive'] })).toBe(false)
    expect(test(g, { kind: 'in_block', blocks: ['b_market'] })).toBe(false)
    expect(test(g, { kind: 'at_facility', types: ['fac_clinic'] })).toBe(false)
  })
})

describe('活動擋著的時候', () => {
  // 委託副本的替身：進行中（旗標）什麼都不放行
  const COMMISSION: Feature = {
    id: 'test_commission',
    install(k: Kernel) {
      k.activity.define({
        kind: 'commission', owner: 'test_commission', order: 90,
        active: (s) => (s.flags.in_commission ? { id: 'c1', label: '委託副本' } : null),
        allow: ['commit:test.'],
        reason: () => '委託副本進行中，先把它做完。',
      })
    },
  }
  const enter = (g: G) => g.commit({ kind: 'system', action: 'test.flag', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'in_commission', value: true }], outcome: { result: 'ok', summary: '進副本' } })

  it('world.arrive 被擋下：丟 ActionBlocked，狀態不動', () => {
    const g = world({ features: [worldFeature, COMMISSION] })
    go(g, 'b_market', 'E1')
    enter(g)
    const before = structuredClone(g.state)
    expect(() => g.commit(arrive(g.k, g.state, 'b_tower'))).toThrow(ActionBlocked)
    expect(g.blockOf('commit:world.arrive')).toBe('委託副本進行中，先把它做完。')
    expect(g.state).toEqual(before)
  })

  it('在街區上走路也被擋下（grid.move）', () => {
    const g = world({ features: [worldFeature, COMMISSION] })
    go(g, 'b_market', 'E1')
    enter(g)
    const r = g.gridMove('east')
    expect(r.status).toBe('refused')
    expect(r.reason).toBe('委託副本進行中，先把它做完。')
    expect(worldOf(g.state).steps).toBe(0)
  })
})

describe('對外：worldView、cityGraph', () => {
  it('worldView：現在在哪一區哪一塊、出口通到哪、設施與開不開', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    const v = worldView(g.k, g.state)
    expect(v.district).toEqual({ id: 'd_hive', name: '蜂巢', grade: 1, price_mult: 1 })
    expect(v.block).toEqual({ id: 'b_market', name: '市場', kind: 'block' })
    expect(v.facility).toBeNull()
    expect(v.exits).toEqual([{ marker: 'E2', at: [13, 2], to: 'b_tower', toName: '塔下', toDistrict: 'd_hive', toKind: 'block', arrive: 'E1' }])
    expect(v.facilities).toEqual([
      { marker: '$1', at: [1, 1], name: '後巷診所', type: 'fac_clinic', typeName: '診所', open: true, reason: null },
      { marker: '$2', at: [6, 1], name: '中段的小攤', type: 'fac_stall', typeName: '攤販', open: true, reason: null },
      { marker: '$3', at: [12, 1], name: '霓虹酒吧', type: 'fac_bar', typeName: '酒吧', open: false, reason: '現在沒有開。' },
    ])
    expect(v.steps).toBe(0)
    expect(v.visited).toEqual(['b_market'])
  })

  it('worldView：站在設施上有 facility；橋接區的出口通到另一個區；沒有街區時是空的', () => {
    const g = world()
    expect(worldView(g.k, g.state)).toMatchObject({ district: null, block: null, facility: null, exits: [], facilities: [] })
    go(g, 'b_market', '$1')
    expect(worldView(g.k, g.state).facility).toEqual({ marker: '$1', name: '後巷診所', type: 'fac_clinic', typeName: '診所' })
    go(g, 'b_gate', 'E1')
    expect(worldView(g.k, g.state).exits.map((e) => [e.to, e.toDistrict, e.toKind])).toEqual([['b_tower', 'd_hive', 'block'], ['b_yard', 'd_rust', 'block']])
  })

  it('worldView：到了營業時間設施就開', () => {
    const g = world({ time: { day: 5, hour: 8, minute: 0 } })
    go(g, 'b_market')
    expect(worldView(g.k, g.state).facilities.map((f) => f.open)).toEqual([true, true, true])
  })

  it('cityGraph：區與街區、每一條走道只出現一次、哪兩個區相連', () => {
    const g = world()
    const c = cityGraph(g.k)
    expect(c.districts).toEqual([
      { id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_market', 'b_tower', 'b_gate'] },
      { id: 'd_rust', name: '鏽帶', grade: 2, blocks: ['b_yard'] },
    ])
    expect(c.blocks.map((b) => [b.id, b.district, b.kind])).toEqual([['b_market', 'd_hive', 'block'], ['b_tower', 'd_hive', 'block'], ['b_gate', 'd_hive', 'bridge'], ['b_yard', 'd_rust', 'block']])
    expect(c.links).toHaveLength(3)
    expect(c.links.map((l) => [l.a, l.b].sort().join('-')).sort()).toEqual(['b_gate-b_tower', 'b_gate-b_yard', 'b_market-b_tower'])
    expect(c.districtLinks).toEqual([['d_hive', 'd_rust']])
  })
})

describe('內容檢查：載入時擋下並寫出是哪一筆', () => {
  const bad = (patch: (c: Record<string, any[]>) => void) => () => world({ pack: content(patch) })
  const block = (c: Record<string, any[]>, id: string) => c.block!.find((b) => b.id === id)!

  it('合格的資料：沒有問題', () => {
    const g = world()
    expect(worldProblems(g.k)).toEqual([])
  })

  it('出口不成對：甲通到乙，乙沒有通回甲的出口', () => {
    expect(bad((c) => {
      block(c, 'b_tower').exits = { E2: { to: 'b_gate', arrive: 'E1' } } // 拿掉塔下通回市場的
    })).toThrow(/block\/b_market.*b_tower.*成對/)
  })

  it('出口的標記在版面上找不到', () => {
    expect(bad((c) => {
      block(c, 'b_market').exits = { E9: { to: 'b_tower', arrive: 'E1' } }
    })).toThrow(/block\/b_market.*E9/)
  })

  it('出口的標記在版面上不是 E', () => {
    expect(bad((c) => {
      block(c, 'b_market').exits = { E2: { to: 'b_tower', arrive: 'E1' }, $1: { to: 'b_tower', arrive: 'E1' } }
      delete block(c, 'b_market').facilities.$1
    })).toThrow(/block\/b_market.*\$1.*不是 E/)
  })

  it('出口到了對面要站的標記，對面的版面上找不到', () => {
    expect(bad((c) => {
      block(c, 'b_market').exits = { E2: { to: 'b_tower', arrive: 'E7' } }
    })).toThrow(/block\/b_market.*b_tower.*E7/)
  })

  it('設施的標記在版面上找不到', () => {
    expect(bad((c) => {
      block(c, 'b_market').facilities.$7 = { type: 'fac_clinic', name: '幽靈診所' }
    })).toThrow(/block\/b_market.*\$7.*幽靈診所/)
  })

  it('設施的標記其實是出口（E）', () => {
    expect(bad((c) => {
      block(c, 'b_tower').facilities = { E1: { type: 'fac_stall', name: '門口的攤' } }
      delete block(c, 'b_tower').exits.E1
    })).toThrow(/block\/b_tower.*E1.*門口的攤/)
  })

  it('同一個標記不能同時是出口與設施', () => {
    expect(bad((c) => {
      block(c, 'b_market').facilities.E2 = { type: 'fac_stall', name: '攤' }
    })).toThrow(/block\/b_market.*E2.*出口與設施/)
  })

  it('to 指不到、設施的種類沒有、地圖沒有、區沒有：寫出是哪一筆', () => {
    expect(bad((c) => { block(c, 'b_market').exits.E2!.to = 'b_nowhere' })).toThrow(/block\/b_market.*b_nowhere/)
    expect(bad((c) => { block(c, 'b_market').facilities.$1.type = 'fac_nope' })).toThrow(/block\/b_market.*fac_nope/)
    expect(bad((c) => { block(c, 'b_market').map = 'm_nope' })).toThrow(/block\/b_market.*m_nope/)
    expect(bad((c) => { block(c, 'b_market').district = 'd_nope' })).toThrow(/block\/b_market.*d_nope/)
  })

  it('每個區至少一塊街區；區的 blocks 與街區的 district 對得上', () => {
    expect(bad((c) => { c.district!.push({ id: 'd_empty', name: '空區', grade: 1, blocks: [] }) })).toThrow(/district\/d_empty.*至少/)
    expect(bad((c) => { block(c, 'b_yard').district = 'd_hive' })).toThrow(/b_yard/)
    expect(bad((c) => { c.district![1].blocks = ['b_yard', 'b_market'] })).toThrow(/district\/d_rust.*b_market/)
  })

  it('格式：grade、step_minutes、kind、營業時間', () => {
    expect(bad((c) => { c.district![0].grade = 9 })).toThrow(ContentError)
    expect(bad((c) => { c.district![0].step_minutes = 0 })).toThrow(/step_minutes/)
    expect(bad((c) => { block(c, 'b_market').kind = 'alley' })).toThrow(/kind/)
    expect(bad((c) => { block(c, 'b_market').facilities.$1.open = { time: ['teatime'] } })).toThrow(/open\.time/)
    expect(bad((c) => { block(c, 'b_market').facilities.$1.open = { weekday: [7] } })).toThrow(/open\.weekday/)
    expect(bad((c) => { c.facility_type![0].name = '' })).toThrow(/facility_type\/fac_clinic/)
  })
})

describe('存檔往返', () => {
  it('位置、站的設施、看過的格子、走了幾格都不變', () => {
    const g = world()
    go(g, 'b_market', 'E1')
    g.gridMove([13, 2]) // 到塔下
    g.gridMove('east')
    g.gridMove('west') // 回市場
    go(g, 'b_market', '$1')
    g.gridMove('south')
    g.gridMove('north') // 走上一號攤位
    expect(where(g).facility).toBe('$1')
    const raw = g.save()
    const g2 = world()
    expect(g2.load(raw)).toBeNull()
    expect(g2.state.location).toEqual(g.state.location)
    expect(g2.state.maps).toEqual(g.state.maps)
    expect(worldOf(g2.state)).toEqual(worldOf(g.state))
    expect(worldOf(g2.state).steps).toBeGreaterThan(13)
    expect(test(g2, { kind: 'at_facility', types: ['fac_clinic'] })).toBe(true)
    // 讀回來接著走：還是同一份實例
    const id = at(g2)!.map
    g2.gridMove('south')
    expect(at(g2)!.map).toBe(id)
    expect(worldView(g2.k, g2.state).facility).toBeNull()
  })
})

describe('和其他功能一起裝', () => {
  it('裝上全部的功能：沒有登錄表衝突，到街區、走路、走上設施都照常', () => {
    const feats = allFeatures().some((f) => f.id === 'world') ? allFeatures() : [...allFeatures(), worldFeature]
    const g = world({ features: feats })
    go(g, 'b_market', 'E1')
    expect(g.gridMove([10, 2]).status).toBe('applied')
    expect(worldOf(g.state).steps).toBe(10)
    go(g, 'b_market', '$1')
    expect(test(g, { kind: 'at_facility', types: ['fac_clinic'] })).toBe(true)
  })
})
