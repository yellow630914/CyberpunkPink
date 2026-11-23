// 驗收測試：dev/work/M2-ui-world.md（cpp-ui）。街區圖與走路、「這裡」、城市地圖與計程車、搭車、事件視窗、掃橋接上引擎。
// 內容用測試自帶的最小假資料（兩個區、三塊街區一排、兩條線、幾件事件），不用示意世界包；畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）；
// 數字拿另一個獨立的引擎（讀同一份存檔）直接呼叫來比。
//
//   b_a（d_a，走一格 1 分鐘）── b_b（d_b，走一格 2 分鐘）── b_c（d_b）
//   每一塊 14 × 5：西口 E1 在 (0,2)、東口 E2 在 (13,2)；b_a 有 F1 診所（下午才開）、F2 車站、F3 商店；b_b、b_c 各有一個車站 F1。
//   線 line_t：b_a F2 → b_b F1 → b_c F1（深夜停駛）；線 line_scan：b_a F2 → b_b F1（掃描強度 2、緋櫻）。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature, Report } from '@engine/src'
import { FakeProvider, Game } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { cityGraph, worldView } from '@engine/src/features/world'
import { transitView } from '@engine/src/features/transit'
import { scanView } from '@engine/src/features/security'
import { useEngine } from '../../src/stores/engine'
import { useGame } from '../../src/stores/game'
import HereOptions from '../../src/components/HereOptions.vue'
import EventDialog from '../../src/dialogs/EventDialog.vue'
import ScanDialog from '../../src/dialogs/ScanDialog.vue'
import CityDialog from '../../src/dialogs/CityDialog.vue'
import { cellInfo, cityMapView, exitList, fogOf, hereItems, taxiTargetsIn } from '../../src/lib/worldView'

// ---- 假資料 ----

type Fx = Record<string, unknown>
const SHEET = (rows: string[], cells: Fx[]) => ({ id: 'street', name: '街', size: [14, 5], layout: rows, cells, spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }] })
const mapOf = (id: string, rows: string[], cells: Fx[]) => ({ id, kind: 'street', size: [14, 5], sheets: [SHEET(rows, cells)] })
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }]
const MAPS = [
  mapOf('m_a', ['##############', '#F....F.....F#', 'E.1........2.E', '#............#', '##############'], [{ id: 'F1', at: [1, 1], mark: 'F', name: '診所' }, { id: 'F2', at: [6, 1], mark: 'F', name: '車站' }, { id: 'F3', at: [12, 1], mark: 'F', name: '商店' }, ...E]),
  mapOf('m_b', ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'], [{ id: 'F1', at: [1, 1], mark: 'F', name: '車站' }, ...E]),
  mapOf('m_c', ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'], [{ id: 'F1', at: [1, 1], mark: 'F', name: '車站' }, ...E]),
]
const FAC = [{ id: 'fac_clinic', name: '診所' }, { id: 'fac_station', name: '車站' }, { id: 'fac_shop', name: '商店' }]
const WORLD = {
  special_map: MAPS, facility_type: FAC,
  district: [
    { id: 'd_a', name: '甲區', grade: 1, price_mult: 1, blocks: ['b_a'], map_x: 300, map_y: 400, security: '店家自己顧', style: '街頭' },
    { id: 'd_b', name: '乙區', grade: 2, price_mult: 2, step_minutes: 2, blocks: ['b_b', 'b_c'] },
  ],
  block: [
    { id: 'b_a', district: 'd_a', name: '甲街', kind: 'block', map: 'm_a', exits: { E2: { to: 'b_b', arrive: 'E1' } }, facilities: { F1: { type: 'fac_clinic', name: '診所', open: { time: ['afternoon'] } }, F2: { type: 'fac_station', name: '甲站' }, F3: { type: 'fac_shop', name: '商店' } } },
    { id: 'b_b', district: 'd_b', name: '乙街', kind: 'block', map: 'm_b', exits: { E1: { to: 'b_a', arrive: 'E2' }, E2: { to: 'b_c', arrive: 'E1' } }, facilities: { F1: { type: 'fac_station', name: '乙站' } } },
    { id: 'b_c', district: 'd_b', name: '丙街', kind: 'block', map: 'm_c', exits: { E1: { to: 'b_b', arrive: 'E2' } }, facilities: { F1: { type: 'fac_station', name: '丙站' } } },
  ],
  transit_line: [
    { id: 'line_t', name: '測試線', kind: 'metro', minutes_per_stop: 5, wait: [3, 3], fare: { base: 2, per_stop: 1 }, pay: ['cred', 'cash'], night: false, stops: [{ id: 's1', name: '甲站', block: 'b_a', at: 'F2' }, { id: 's2', name: '乙站', block: 'b_b', at: 'F1' }, { id: 's3', name: '丙站', block: 'b_c', at: 'F1' }] },
    { id: 'line_scan', name: '掃描線', kind: 'metro', minutes_per_stop: 5, wait: [3, 3], fare: { base: 2, per_stop: 1 }, pay: ['cred'], scan: 2, faction: 'hizakura', stops: [{ id: 's1', name: '甲站', block: 'b_a', at: 'F2' }, { id: 's2', name: '乙站', block: 'b_b', at: 'F1' }] },
  ],
  transit_rule: [{ id: 'default', km: [{ a: 'd_a', b: 'd_b', km: 3 }] }],
}
const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const EVENT = {
  id: 'ev_a', scope: 'street', triggers: ['enter_block'], where: { block: 'b_b' }, text: '一個人擋住了去路。',
  options: [
    opt('talk', '試著說服他。', { check: ['negotiate', 'charm', 'easy'], outcomes: { critical: [{ kind: 'cash', amount: 40 }], success: [{ kind: 'cash', amount: 20 }], fail: [], fumble: [{ kind: 'cash', amount: -5 }] } }),
    opt('rich', '遞上一大筆錢。', { need: { kind: 'money', wallet: 'cash', min: 999999 }, show_locked: '你身上的現金不夠。' }),
    opt('leave', '轉身走開。'),
  ],
}
const STOP_EVENT = { id: 'ev_stop', scope: 'ride', triggers: ['transit_stop'], text: '車廂裡出了點事。', options: [opt('ok', '知道了。')] }
const DEFER_EVENT = { id: 'ev_b', scope: 'street2', triggers: ['enter_block'], where: { block: 'b_b' }, text: '第二件事。', options: [opt('ok', '好。')] }

interface PackOpts { street?: number; ride?: number; extra?: Fx[]; defer?: boolean }
function pack(o: PackOpts = {}): ContentPack {
  const street: Fx = { id: 'street', triggers: { enter_block: o.street ?? 0 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop', roller: 'pc', priority: 1 }
  // 第二個範圍同一回合也擲中：擋住型的名額只有一個，輸的那件延後（lost: defer）
  const street2: Fx = { id: 'street2', triggers: { enter_block: o.street ?? 0 }, cooldown_hours: 0, repeat_days: 0, lost: 'defer', roller: 'pc', priority: 2 }
  return {
    id: 'world_ui_test',
    content: {
      ...WORLD, event_scope: [street, ...(o.defer ? [street2] : []), { id: 'ride', triggers: { transit_stop: o.ride ?? 0 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop', roller: 'pc' }],
      event: [EVENT, STOP_EVENT, ...(o.defer ? [DEFER_EVENT] : []), ...(o.extra ?? [])],
    } as unknown as ContentPack['content'],
  }
}

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
type Eng = ReturnType<typeof useEngine>

/** 開一局：測試自帶的內容、建好角色、站在 b_a 的 at（預設西口）、帳戶 500、現金 300。 */
async function setup(o: PackOpts & { at?: string; block?: string; rules?: object; features?: Feature[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: 7, ...(o.rules ? { rules: o.rules } : {}), testContent: [pack(o)], ...(o.features ? { testFeatures: o.features } : {}) })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cred', delta: 500 - e.money.cred }, { op: 'cash', delta: 300 - e.money.cash }])
  const r = await e.world.arrive(o.block ?? 'b_a', o.at ?? 'E1')
  expect(r.status).toBe('applied')
  return { pinia, e, o }
}
/** 另一個獨立的引擎讀同一份存檔：直接呼叫引擎函式，當標準答案。 */
function oracle(e: Eng, o: PackOpts & { features?: Feature[] } = {}) {
  const g = new Game({ features: [...allFeatures(), ...(o.features ?? [])], content: [CORE_PACK, pack(o)], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, props)
  app.use(pinia)
  return renderToString(app)
}
const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
const minutesOf = (e: Eng) => (e.state.time.day - 1) * 1440 + e.state.time.hour * 60 + e.state.time.minute
const at = (e: Eng) => e.world.grid()!.at
const hostile = (e: Eng, n: number) => expect(e.commit({ summary: '放一個敵對值。', changes: [{ op: 'meter', kind: 'hostility', key: 'hizakura', set: n }] })).toBeNull()
/** 走到站上：b_a 的車站在 F2 (6,1)（站在設施上 location.facility = F2） */
async function toStation(e: Eng) {
  expect(e.world.walk([6, 1]).ok).toBe(true)
  expect(e.world.view().facility?.marker).toBe('F2')
}

beforeEach(() => setActivePinia(createPinia()))

describe('街區圖與走路（引擎的 gridView、gridMove）', () => {
  it('走一步之後：畫面讀到的位置、時間、走了幾格和引擎的狀態一致', async () => {
    const { e } = await setup()
    const t0 = minutesOf(e)
    const r = e.world.walk('east')
    expect(r.ok).toBe(true)
    expect(at(e)).toEqual([1, 2])
    expect(minutesOf(e) - t0).toBe(1)
    expect(e.world.view().steps).toBe(1)
    const o = oracle(e)
    expect(o.gridView()!.at).toEqual([1, 2])
    expect(worldView(o.k, o.state).steps).toBe(1)
    // 乙區走一格 2 分鐘
    expect(e.timeLabel).toBe(`${String(e.state.time.hour).padStart(2, '0')}:${String(e.state.time.minute).padStart(2, '0')}`)
  })

  it('走到出口：換到隔壁那一塊，站在對應的標記上；位置與街區名字是引擎的', async () => {
    const { e } = await setup()
    expect(e.world.walk([13, 2]).ok).toBe(true)
    const w = e.world.view()
    expect(w.block).toMatchObject({ id: 'b_b', name: '乙街' })
    expect(w.district).toMatchObject({ id: 'd_b', name: '乙區' })
    expect(at(e)).toEqual([0, 2])
    // 回來：同一份實例，看過的格子還在（迷霧）
    expect(e.world.walk([13, 2]).ok).toBe(true)
    expect(e.world.view().block?.id).toBe('b_c')
    // 站在出口上不能「走回去」：先離開那一格，再走上去（引擎是走上出口那一格才換街區）
    expect(e.world.walk('east').ok).toBe(true)
    expect(e.world.walk([0, 2]).ok).toBe(true)
    expect(e.world.view().block?.id).toBe('b_b')
    expect(e.world.view().visited).toEqual(['b_a', 'b_b', 'b_c'])
  })

  it('被牆擋下：提示列的字就是引擎 gridView.moves 的原因，位置時間不變', async () => {
    const { e } = await setup()
    const t0 = minutesOf(e)
    const moves = e.world.grid()!.moves
    for (const dir of ['west', 'north'] as const) {
      expect(moves[dir]).toBeTruthy()
      const r = e.world.walk(dir)
      expect(r).toEqual({ ok: false, reason: moves[dir] })
    }
    expect(at(e)).toEqual([0, 2])
    expect(minutesOf(e)).toBe(t0)
    expect(e.world.walk([5, 0]).ok).toBe(false)
  })

  it('格子的樣子：看過的才畫、出口與設施有名字（只整理，不判斷）', async () => {
    const { e } = await setup()
    const grid = e.world.grid()!
    const w = e.world.view()
    expect(cellInfo(0, 2, grid, w)).toEqual({ kind: 'street' }) // 西口沒有通到哪裡
    expect(fogOf(0, 2, grid)).toBe('visible')
    expect(cellInfo(0, 1, grid, w)).toEqual({ kind: 'building' })
    expect(cellInfo(1, 1, grid, w)).toMatchObject({ kind: 'fac' })
    const far = grid.cells[1]!.findIndex((c, x) => c === null && x > 8)
    expect(far).toBeGreaterThan(0)
    expect(fogOf(far, 1, grid)).toBe('hidden')
    expect(cellInfo(far, 1, grid, w)).toEqual({ kind: 'void' })
    expect(exitList(w).map(x => x.toName)).toEqual(['乙街'])
    expect(w.exits[0]!.at).toEqual([13, 2])
  })
})

describe('「這裡」列引擎回的每一項', () => {
  it('走上設施：列出引擎列的項目；不在營業時間的那一項是灰的、title 是引擎的原因', async () => {
    const { e, pinia } = await setup()
    expect(e.world.walk([1, 1]).ok).toBe(true)
    expect(e.world.view().facility).toMatchObject({ marker: 'F1', name: '診所' })
    const items = hereItems(e.world.grid())
    expect(items).toEqual(e.world.grid()!.here.uses.map(u => ({ id: u.id, name: u.name, reason: u.block })))
    expect(items).toHaveLength(1)
    expect(items[0]!.reason).toBeTruthy()
    const out = await html(pinia, HereOptions, { options: items.map(i => ({ id: i.id, name: i.name, reason: i.reason, run: () => {} })) })
    expect(out).toContain('is-unavailable')
    expect(out).toContain(`title="${items[0]!.reason}"`)
  })

  it('車站是開著的：引擎列「搭車」，沒有原因（不是灰的）', async () => {
    const { e, pinia } = await setup()
    await toStation(e)
    const items = hereItems(e.world.grid())
    expect(items.map(i => i.id)).toEqual(['transit.board'])
    expect(items[0]!.reason).toBeNull()
    const out = await html(pinia, HereOptions, { options: items.map(i => ({ id: i.id, name: i.name, reason: i.reason, run: () => {} })) })
    expect(out).not.toContain('is-unavailable')
    expect(strip(out)).toContain('搭車')
  })
})

describe('事件視窗', () => {
  async function withEvent(o: PackOpts = {}) {
    const s = await setup({ street: 1, ...o })
    expect(s.e.event.view()).toBeNull()
    expect(s.e.world.walk([13, 2]).ok).toBe(true) // 走到出口、到了乙街：enter_block 擲中，事件開起來
    return s
  }

  it('引擎開了事件：視窗出現、走路被擋（原因是引擎的）；選一個選項之後視窗關掉、紀錄多一份；選不了的選項是灰的', async () => {
    const { e, pinia } = await withEvent()
    const v = e.event.view()!
    expect(v.event).toBe('ev_a')
    expect(e.world.walk('east')).toEqual({ ok: false, reason: expect.stringContaining('眼前有一件事') })
    expect(e.world.walk('east').reason).toBe(e.blockOf('grid.move'))
    const locked = v.options.find(x => x.id === 'rich')!
    expect(locked.locked).toBe('你身上的現金不夠。')
    // 畫面：正文、三個選項（檢定的寫基本功、難度與成功率）、選不了的灰掉並寫引擎的原因
    const out = await html(pinia, EventDialog)
    expect(strip(out)).toContain('一個人擋住了去路。')
    expect(out).toMatch(/data-opt="rich"[^>]*>/)
    expect(out).toMatch(/class="[^"]*is-unavailable[^"]*"[^>]*data-opt="rich"/)
    expect(strip(out)).toContain('你身上的現金不夠。')
    const talk = v.options.find(x => x.id === 'talk')!
    expect(talk.check).toBeTruthy()
    expect(strip(out)).toContain(`DC ${talk.check!.dc}・成功率 ${talk.check!.chance}%`)
    // 沒有關閉鈕：擋住別的操作
    expect(out).not.toContain('aria-label="關閉"')
    expect(out).not.toContain('aria-label="返回"')
    // 選不了的被引擎擋下
    const refused = await e.event.choose('rich')
    expect(refused.status).toBe('refused')
    expect(e.event.view()).not.toBeNull()
    // 選一個
    const n = e.log.length
    const r = await e.event.choose('leave')
    expect(r.status).toBe('applied')
    expect(e.event.view()).toBeNull()
    expect(e.log.length).toBe(n + 1)
    expect(r.reports?.some(x => x.action === 'event.close')).toBe(true)
    // 事件收掉之後又能走
    expect(e.world.walk('east').ok).toBe(true)
  })

  it('有檢定的選項：擲骰與結果在報告裡，錢真的變了；視窗顯示的是引擎報告的擲骰', async () => {
    const { e } = await withEvent()
    const v = e.event.view()!
    const cash0 = e.money.cash
    const r = await e.event.choose('talk')
    expect(r.status).toBe('applied')
    const rep = r.reports!.find((x: Report) => x.action === 'event.close')!
    const roll = rep.timeline.find(b => b.roll)!.roll!
    expect(roll.dc).toBe(v.options.find(x => x.id === 'talk')!.check!.dc)
    const gain = { critical: 40, success: 20, fail: 0, fumble: -5 }[roll.degree as 'critical' | 'success' | 'fail' | 'fumble']
    expect(e.money.cash - cash0).toBe(gain)
  })

  it('「我要做別的」送出去的是自由行動，事件跟著結束', async () => {
    const { e } = await withEvent()
    const before = e.state.reports.length
    const r = await e.event.free('我二話不說擠過去。')
    expect(r.status).not.toBe('refused')
    expect(e.event.view()).toBeNull()
    const added = e.state.reports.slice(before).map(x => x.action)
    expect(added.length).toBeGreaterThanOrEqual(2)
    expect(added).toContain('event.close')
    const close = e.state.reports.slice(before).find(x => x.action === 'event.close')!
    expect(JSON.stringify(close.timeline)).toContain('event.free')
  })

  it('標題寫還有幾件延後的', async () => {
    const { e, pinia } = await withEvent({ defer: true, extra: [] })
    expect(e.event.director().deferred).toBe(1)
    expect(strip(await html(pinia, EventDialog))).toContain('還有 1 件延後的')
  })

  it('沒有開著的事件時不畫視窗', async () => {
    const { pinia } = await setup()
    expect((await html(pinia, EventDialog)).replace(/<!--[\s\S]*?-->/g, '')).toBe('')
  })
})

describe('掃橋', () => {
  async function scanning() {
    const s = await setup({ at: 'E1' })
    await toStation(s.e)
    hostile(s.e, 30)
    return s
  }

  it('事件是掃橋發起的：四步的狀態和引擎的 scanView 一樣，畫面逐列畫出來', async () => {
    const { e, pinia } = await scanning()
    const cred0 = e.money.cred
    const r = await e.transit.board({ line: 'line_scan', pay: 'cred' })
    expect(r.status).toBe('applied')
    const sv = e.event.scan()!
    expect(sv).not.toBeNull()
    const o = oracle(e)
    const truth = scanView(o.k, o.state)!
    expect(sv.steps.map(s => [s.id, s.state, s.note])).toEqual(truth.steps.map(s => [s.id, s.state, s.note]))
    expect(sv.steps.map(s => s.id)).toEqual(['identity', 'hostility', 'fake', 'bridge'])
    expect(sv.steps.find(s => s.id === 'hostility')!.state).toBe('attention')
    // 還沒上車、車資還沒扣
    expect(e.money.cred).toBe(cred0)
    expect(e.transit.view().ride).toBeNull()
    const out = await html(pinia, ScanDialog, { view: sv })
    for (const s of truth.steps) expect(out).toContain(`data-step="${s.id}" data-state="${s.state}"`)
    for (const op of truth.options) expect(strip(out)).toContain(op.text.slice(0, 4))
    // 事件視窗換成這個樣子
    const dlg = await html(pinia, EventDialog)
    expect(dlg).toContain('data-step="identity"')
    expect(strip(dlg)).toContain('掃橋')
  })

  it('選掉頭：人沒有過去，沒有上車、車資不扣、位置不變；視窗關掉', async () => {
    const { e } = await scanning()
    const cred0 = e.money.cred
    await e.transit.board({ line: 'line_scan', pay: 'cred' })
    const r = await e.event.choose('turn_back')
    expect(r.status).toBe('applied')
    expect(e.event.scan()).toBeNull()
    expect(e.event.view()).toBeNull()
    expect(e.transit.view().ride).toBeNull()
    expect(e.money.cred).toBe(cred0)
    expect(e.world.view().block?.id).toBe('b_a')
    expect(e.world.view().facility?.marker).toBe('F2')
  })

  it('選照常過：過了才上車（人在月台上），車資這時才扣', async () => {
    const { e } = await scanning()
    const cred0 = e.money.cred
    await e.transit.board({ line: 'line_scan', pay: 'cred' })
    const op = e.event.scan()!.options.find(x => x.id === 'proceed')!
    expect(op.locked).toBeNull()
    const r = await e.event.choose('proceed')
    expect(r.status).toBe('applied')
    const ride = e.transit.view().ride
    expect(ride?.phase).toBe('platform')
    expect(e.money.cred).toBe(cred0 - 2)
  })
})

describe('搭車', () => {
  it('站在車站上：這一站停哪幾條線、車資與分鐘都是引擎的 transitView；上車扣的錢、每站的時間和引擎一樣', async () => {
    const { e } = await setup()
    await toStation(e)
    const v = e.transit.view()
    expect(v.station?.lines.map(l => l.id)).toEqual(['line_t', 'line_scan'])
    const line = v.station!.lines[0]!
    const dir = line.directions[0]!
    expect(dir.stops.map(s => [s.name, s.count, s.fare, s.minutes])).toEqual([['乙站', 1, 3, 5], ['丙站', 2, 4, 10]])
    // 沒有原因就上得了；原因是引擎的
    const input = { line: 'line_t', dest: 's3', pay: 'cred' as const }
    expect(e.transit.boardBlock(input)).toBeNull()
    const cred0 = e.money.cred, t0 = minutesOf(e)
    expect((await e.transit.board(input)).status).toBe('applied')
    expect(e.money.cred).toBe(cred0 - line.fare.base) // 上車付起跳
    expect(e.transit.view().ride).toMatchObject({ phase: 'platform', dest: { id: 's3' } })
    expect((await e.transit.wait()).status).toBe('applied')
    expect(minutesOf(e) - t0).toBe(3) // 等車（測試的班距是 [3, 3]）
    const t1 = minutesOf(e)
    expect((await e.transit.advance()).status).toBe('applied')
    expect(minutesOf(e) - t1).toBe(line.minutes_per_stop)
    expect(e.money.cred).toBe(cred0 - line.fare.base - line.fare.per_stop)
    const o = oracle(e)
    expect(transitView(o.k, o.state).ride).toMatchObject({ at: 1, rode: 1, paid: 3 })
    expect(e.transit.view().ride!.stops.map(s => s.state)).toEqual(['past', 'here', 'ahead'])
  })

  it('坐到目的地：一站一站呼叫引擎，到了就停（不自動下車）；下車之後人在那一站', async () => {
    const { e } = await setup()
    await toStation(e)
    const cred0 = e.money.cred, t0 = minutesOf(e)
    await e.transit.board({ line: 'line_t', dest: 's3', pay: 'cred' })
    const r = await e.transit.rideToDest()
    expect(r).toEqual({ stopped: 'dest', stops: 2 })
    expect(e.transit.view().ride).toMatchObject({ at: 2, rode: 2, paid: 4 })
    expect(e.money.cred).toBe(cred0 - 4)
    expect(minutesOf(e) - t0).toBe(3 + 5 + 5)
    expect((await e.transit.alight()).status).toBe('applied')
    expect(e.transit.view().ride).toBeNull()
    expect(e.world.view().block?.id).toBe('b_c')
    expect(e.world.view().facility?.marker).toBe('F1')
  })

  it('快轉途中有事件就停在那一站；做完事件接著再坐', async () => {
    // 導演現在把「車上」當成別的活動進行中，擋住型的交通事件一律延後（見回報），所以用一個替身：每坐一站就開 ev_stop（引擎放行之後就是它自己開）
    const stopEvent: Feature = {
      id: 'stop_event_stub',
      install(k) {
        k.hooks.on('report.after', 'stop_event_stub', ({ report }) => (report.action === 'transit.stop' ? [{
          kind: 'event', action: 'stub.launch', location: { ...report.location }, party: [], timeline: [], changes: [],
          outcome: { result: 'ok', summary: '車上出了事。' }, launch: [{ kind: 'event', setup: { event: 'ev_stop' }, origin: { by: 'stub' } }],
        }] : undefined))
      },
    }
    const { e } = await setup({ features: [stopEvent] })
    await toStation(e)
    await e.transit.board({ line: 'line_t', dest: 's3', pay: 'cred' })
    const r = await e.transit.rideToDest()
    expect(r.stopped).toBe('event')
    expect(r.stops).toBe(1)
    expect(e.transit.view().ride).toMatchObject({ at: 1 })
    expect(e.event.view()?.event).toBe('ev_stop')
    // 車上時：走路被擋、事件開著也被擋
    expect(e.world.walk('east').ok).toBe(false)
    expect((await e.event.choose('ok')).status).toBe('applied')
    expect(e.event.view()).toBeNull()
  })

  it('深夜停駛、錢不夠：上車的原因是引擎的', async () => {
    const { e } = await setup()
    await toStation(e)
    e.ledger([{ op: 'time', minutes: 18 * 60 }]) // 08:00 → 02:00（深夜）
    const night = e.transit.view().station!.lines.find(l => l.id === 'line_t')!
    expect(night.open).toBe(false)
    expect(night.reason).toBeTruthy()
    expect(e.transit.boardBlock({ line: 'line_t', pay: 'cred' })).toBe(night.reason)
    expect(e.transit.boardBlock({ line: 'line_scan', pay: 'cash' })).toMatch(/不收/)
  })

  it('現金買票：這一趟記的是現金', async () => {
    const { e } = await setup()
    await toStation(e)
    const cash0 = e.money.cash
    await e.transit.board({ line: 'line_t', pay: 'cash' })
    expect(e.transit.view().ride).toMatchObject({ pay: 'cash', recorded: false })
    expect(e.money.cash).toBe(cash0 - 2)
  })
})

describe('城市地圖與計程車', () => {
  it('區與街區怎麼連是引擎的 cityGraph；你在哪裡是 worldView；地圖位置與治安是資料多給的欄位', async () => {
    const { e } = await setup()
    const view = cityMapView(e.world.graph(), (k, id) => e.world.entry<Record<string, unknown>>(k, id))
    expect(view.map(d => [d.id, d.blocks.map(b => b.id)])).toEqual([['d_a', ['b_a']], ['d_b', ['b_b', 'b_c']]])
    expect(view[0]).toMatchObject({ x: 300, y: 400, security: '店家自己顧', price: 1 })
    expect(view[1]).toMatchObject({ x: 800, y: 500, price: 2 })
    const o = oracle(e)
    expect(e.world.graph()).toEqual(cityGraph(o.k))
    expect(e.world.view().district?.id).toBe('d_a')
  })

  it('計程車：只去去過的車站；車資、公里、原因都是引擎的；叫了之後位置、帳戶、時間照引擎', async () => {
    const { e } = await setup()
    // 還沒去過任何站：全部叫不了（原因是引擎的）
    const before = e.transit.view().taxi.destinations
    expect(before.length).toBeGreaterThan(0)
    expect(before.every(d => d.reason)).toBe(true)
    expect((await e.transit.taxi(before[0]!.key)).status).toBe('refused')
    // 坐一趟到丙站再叫計程車回甲站
    await toStation(e)
    await e.transit.board({ line: 'line_t', dest: 's3', pay: 'cred' })
    await e.transit.rideToDest()
    await e.transit.alight()
    const dest = taxiTargetsIn(e.transit.view(), 'b_a')[0]!
    expect(dest.reason).toBeNull()
    const o = oracle(e)
    expect(dest.fare).toBe(transitView(o.k, o.state).taxi.destinations.find(d => d.key === dest.key)!.fare)
    const cred0 = e.money.cred, t0 = minutesOf(e)
    const r = await e.transit.taxi(dest.key)
    expect(r.status).toBe('applied')
    expect(e.money.cred).toBe(cred0 - dest.fare)
    expect(minutesOf(e) - t0).toBe(e.transit.view().taxi.minutes)
    expect(e.world.view().block?.id).toBe('b_a')
  })

  it('fastTravel 關著：計程車的按鈕是灰的，原因是引擎的', async () => {
    const { e, pinia } = await setup({ rules: { fastTravel: false } })
    const t = e.transit.view().taxi
    expect(t.reason).toMatch(/快速移動/)
    const why = taxiTargetsIn(e.transit.view(), 'b_b')[0]!.reason!
    expect(why).toMatch(/快速移動/)
    // 畫面：選了有車站的那一塊，叫計程車的按鈕 aria-disabled、title 與下面那一行都是引擎的原因；自己開車引擎還沒有，也是灰的
    const out = await html(pinia, CityDialog, { entryId: 0, block: 'b_b' })
    expect(out).toMatch(new RegExp(`aria-disabled="true"[^>]*title="${why}"`))
    expect(strip(out)).toContain(`叫計程車到乙站站`)
    expect(out).toContain(`<p class="why"`)
    expect(strip(out)).toContain(why)
    expect(out).toContain('title="自己的車還沒有接上引擎。"')
    // 開著的時候（沒去過）原因是「還沒去過」；去過之後沒有原因（按鈕不是灰的）
    const open = await setup()
    expect(taxiTargetsIn(open.e.transit.view(), 'b_b')[0]!.reason).toMatch(/還沒去過/)
  })
})

describe('示意世界包下的投影（useGame）', () => {
  it('開新局站在四號塔：g.district、g.loc.block、g.placeLabel 讀引擎的所在地', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const g = useGame()
    expect(g.district.id).toBe('hive')
    expect(g.loc.block).toBe('四號塔')
    expect(g.placeLabel).toContain('蜂巢')
    expect(g.placeLabel).toContain('四號塔')
    expect(g.facility?.id).toBe('rooftop')
    expect(g.loc.facility).toBe('rooftop')
    const e = useEngine()
    expect(e.world.view().exits.length).toBeGreaterThan(0)
    expect(e.log).toEqual([])
  })
})

// ---- 程式碼的檢查：元件與 lib/worldView.ts 裡沒有規則 ----

import mainSrc from '../../src/screens/MainScreen.vue?raw'
import gridMapSrc from '../../src/components/GridMap.vue?raw'
import cityMapSrc from '../../src/components/CityMap.vue?raw'
import hereSrc from '../../src/components/HereOptions.vue?raw'
import rideSrc from '../../src/components/RidePanel.vue?raw'
import cityDlgSrc from '../../src/dialogs/CityDialog.vue?raw'
import transitDlgSrc from '../../src/dialogs/TransitDialog.vue?raw'
import eventDlgSrc from '../../src/dialogs/EventDialog.vue?raw'
import scanDlgSrc from '../../src/dialogs/ScanDialog.vue?raw'
import pendingDlgSrc from '../../src/dialogs/PendingDialog.vue?raw'
import viewSrc from '../../src/lib/worldView.ts?raw'

const SOURCES: Record<string, string> = {
  'screens/MainScreen.vue': mainSrc, 'components/GridMap.vue': gridMapSrc, 'components/CityMap.vue': cityMapSrc, 'components/HereOptions.vue': hereSrc, 'components/RidePanel.vue': rideSrc,
  'dialogs/CityDialog.vue': cityDlgSrc, 'dialogs/TransitDialog.vue': transitDlgSrc, 'dialogs/EventDialog.vue': eventDlgSrc, 'dialogs/ScanDialog.vue': scanDlgSrc, 'dialogs/PendingDialog.vue': pendingDlgSrc,
  'lib/worldView.ts': viewSrc,
}
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('元件與 worldView.ts 裡沒有機率、車資與 DC 的算式', () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    it(`${name}：不 import 示意的區與路線假資料，不自己擲骰，不算車資與 DC`, () => {
      const c = code(src)
      expect(c).not.toMatch(/data\/districts|data\/transit|from '\.\.\/lib\/transit'/)
      expect(c).not.toMatch(/Math\.random|\brandInt\b|\brollDie\b|\brollDice\b|\brng\b|deriveRng|\.chance\(/)
      expect(c).not.toMatch(/\bdcFor\b|computeDegree|DC_TIERS|checkParts|taxiFare|fareFor|taxiQuote\(/)
      expect(c).not.toMatch(/fare\.base\s*[+*]|per_stop\s*\*|perStop\s*\*|\*\s*price/)
    })
  }
  it('MainScreen 不再用 useWalk 與舊的 g.moveBlock、g.blockMap（走路與換街區是引擎的）', () => {
    expect(code(mainSrc)).not.toMatch(/useWalk|moveBlock|blockMap|setFacility|loc\.pos/)
  })
})

describe('手機寬度：事件視窗與掃橋的選項直向排、不超出畫面', () => {
  for (const [name, src] of [['EventDialog', eventDlgSrc], ['ScanDialog', scanDlgSrc]] as const) {
    it(`${name}：720 以下選項只有一欄，選項能縮（min-width: 0）、長字會換行`, () => {
      const media = src.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/)
      expect(media, '要有手機的 media').toBeTruthy()
      expect(media![1]).toMatch(/\.opts \{ grid-template-columns: minmax\(0, 1fr\); \}/)
      expect(src).toMatch(/\.opt \{[^}]*min-width: 0/)
      expect(src).toMatch(/overflow-wrap: anywhere/)
    })
  }
})
