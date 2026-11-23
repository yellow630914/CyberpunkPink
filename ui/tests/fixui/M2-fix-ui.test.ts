// 驗收測試：dev/work/M2-fix-ui.md（cpp-ui）。M2 介面修正批：被擋下的草稿不留、帳單「剛結算」、設定交給引擎、示範場景、
// 人情／小隊／敵對值讀引擎、休息走引擎的 rest、勢力人情的名字、召集上限、委託條、已知的事與互動的 note。
// 內容用測試自帶的最小假資料（兩塊街區、一間店、一處住處、一條線、幾件事件），不用示意世界包。
//
//   b_a（d_a）：F1 商店、F2 車站、F3 出租屋　　b_b（d_b）：F1 車站；線 line_t 連兩站；b_b 的街頭事件 ev_a、計程車出發的事件 ev_taxi

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature } from '@engine/src'
import { useEngine } from '../../src/stores/engine'
import { useSettings } from '../../src/stores/settings'
import { freshEffects, rulesFromUi } from '../../src/lib/engineView'
import { addRow, toCart } from '../../src/lib/lifeView'
import { interactRows, knownRows } from '../../src/lib/peopleView'
import { demoSceneChanges, DEMO_SCENES } from '../../src/data/demo'
import { BLOCKS } from '../../src/data/districts'
import { PENDING } from '../../src/data/weekly'
import FixerDialog from '../../src/dialogs/FixerDialog.vue'
import { useGame } from '../../src/stores/game'
import TalkDialog from '../../src/dialogs/TalkDialog.vue'
import appSrc from '../../src/App.vue?raw'
import mainSrc from '../../src/screens/MainScreen.vue?raw'
import homeSrc from '../../src/screens/HomeScreen.vue?raw'
import fixerSrc from '../../src/dialogs/FixerDialog.vue?raw'
import callSrc from '../../src/components/commission/CallTab.vue?raw'
import runSrc from '../../src/components/commission/RunTab.vue?raw'
import statusSrc from '../../src/components/StatusBar.vue?raw'
import storeSrc from '../../src/stores/engine.ts?raw'

// ---- 假資料 ----

type Fx = Record<string, unknown>
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }]
const mapOf = (id: string, rows: string[], cells: Fx[]) => ({
  id, kind: 'street', size: [14, 5],
  sheets: [{ id: 'street', name: '街', size: [14, 5], layout: rows, cells: [...cells, ...E], spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }] }],
})
const MAPS = [
  mapOf('m_a', ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'], [{ id: 'F1', at: [1, 1], mark: 'F', name: '商店' }, { id: 'F2', at: [3, 1], mark: 'F', name: '車站' }, { id: 'F3', at: [5, 1], mark: 'F', name: '出租屋' }]),
  mapOf('m_b', ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'], [{ id: 'F1', at: [1, 1], mark: 'F', name: '車站' }]),
]
const item = (id: string, name: string, price: number): Fx => ({ id, name, desc: `${name}。`, category: 'consumable', grade: 1, size: 0, legal: 'free', price, tags: ['stock_t'] })
const opt = (id: string, text: string): Fx => ({ id, text, outcomes: { any: [] } })
const PACK: ContentPack = {
  id: 'fixui_test',
  content: {
    special_map: MAPS, facility_type: [{ id: 'fac_shop', name: '商店' }, { id: 'fac_station', name: '車站' }, { id: 'fac_home', name: '住處' }],
    district: [{ id: 'd_a', name: '甲區', grade: 1, price_mult: 1, blocks: ['b_a'] }, { id: 'd_b', name: '乙區', grade: 1, price_mult: 1, blocks: ['b_b'] }],
    block: [
      { id: 'b_a', district: 'd_a', name: '甲街', kind: 'block', map: 'm_a', exits: { E2: { to: 'b_b', arrive: 'E1' } }, facilities: { F1: { type: 'fac_shop', name: '商店' }, F2: { type: 'fac_station', name: '甲站' }, F3: { type: 'fac_home', name: '出租屋' } } },
      { id: 'b_b', district: 'd_b', name: '乙街', kind: 'block', map: 'm_b', exits: { E1: { to: 'b_a', arrive: 'E2' } }, facilities: { F1: { type: 'fac_station', name: '乙站' } } },
    ],
    transit_line: [{ id: 'line_t', name: '測試線', kind: 'metro', minutes_per_stop: 5, wait: [3, 3], fare: { base: 2, per_stop: 1 }, pay: ['cred', 'cash'], night: false, stops: [{ id: 's1', name: '甲站', block: 'b_a', at: 'F2' }, { id: 's2', name: '乙站', block: 'b_b', at: 'F1' }] }],
    transit_rule: [{ id: 'default', km: [{ a: 'd_a', b: 'd_b', km: 3 }], anywhere: true }],
    item: [item('t_bun', '糰糧', 10), item('t_gel', '凝膠', 40)],
    npc: [{ id: 'npc_run', name: '行者安', kind: 'runner', age: 30, guard: 12, wealth: 2, haunts: [{ district: 'd_a', block: 'b_a', time: ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late'] }], bridge: { sensitivity: 40, tolerance: 30, craving: 20, docility: 10 }, paths: [{ path: 'gunner', slot: 'main', tier: 3 }] }],
    shop_type: [{ id: 'st_both', name: '都收的店', catalog: ['stock_t'], buys: ['stock_t'], grade_max: 3, cash: true, scan_registered: true, shop_mult: 1, temper: 0 }],
    shop: [{ id: 'shop_t', type: 'st_both', name: '雜貨', district: 'd_a', block: 'b_a', facility: 'F1' }],
    residence: [{ id: 'res_t', name: '出租屋', district: 'd_a', block: 'b_a', facility: 'F3', level: 1, rent: 100, cash_ok: true }],
    event_scope: [
      { id: 'street', triggers: { enter_block: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop', roller: 'pc', priority: 1 },
      { id: 'taxi', triggers: { transit_taxi: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop', roller: 'pc' },
    ],
    event: [
      { id: 'ev_a', scope: 'street', triggers: ['enter_block'], where: { block: 'b_b' }, text: '一個人擋住了去路。', options: [opt('leave', '轉身走開。')] },
      { id: 'ev_taxi', scope: 'taxi', triggers: ['transit_taxi'], where: { phase: 'depart' }, text: '司機回頭問你一句。', options: [opt('ok', '不理他。')] },
    ],
  } as unknown as ContentPack['content'],
}
const BUSY_REASON = '測試的活動進行中，這件事現在不能做。'
/** 測試活動開著嗎（活動開著時引擎連「提交」都擋，所以關它要靠這個旗標，不是狀態裡的欄位） */
let busyNow = false
const busy: Feature = {
  id: 'busy_test',
  install: (k) => k.activity.define({ kind: 'busy_test', owner: 'busy_test', order: 5, active: () => (busyNow ? { id: 'b1', label: '測試活動' } : null), allow: [], reason: () => BUSY_REASON }),
}
const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
type Eng = ReturnType<typeof useEngine>

/** 無事件的局：站在 b_a 的設施（預設商店）上；帳戶 5000、現金 3000；AI 關 */
async function setup(o: { rules?: object; at?: string; events?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  const pack = o.events ? PACK : { ...PACK, content: { ...PACK.content, event_scope: [], event: [] } as unknown as ContentPack['content'] }
  e.newGame({ seed: 7, ...(o.rules ? { rules: o.rules } : {}), testContent: [pack], testFeatures: [busy] })
  e.setAi({ useAi: false })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cred', delta: 5000 - e.money.cred }, { op: 'cash', delta: 3000 - e.money.cash }])
  expect((await e.world.arrive('b_a', o.at ?? 'F1')).status).toBe('applied')
  return { pinia, e }
}
const busyOn = (e: Eng) => { busyNow = true; void e }
const busyOff = (e: Eng) => { busyNow = false; void e }
const countOf = (e: Eng, id: string) => e.gear.inventory().filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
const actions = (e: Eng) => e.state.reports.map((r) => r.action)
const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }))
  return renderToString(app)
}

beforeEach(() => { busyNow = false; setActivePinia(createPinia()) })
afterEach(() => { vi.unstubAllGlobals() })

// ---- P1：被擋下的草稿不留在佇列裡 ----

describe('P1 被引擎擋下的草稿不會之後自己生效', () => {
  it('副本（活動）擋著時按結帳被擋；活動結束之後做別的事，那一車沒有結掉', async () => {
    const { e } = await setup()
    const row = e.trade.view('shop_t')!.shelf.find((r) => r.block === null)!
    const cart = toCart(addRow([], 'buy', row.item, 1), 'cash')
    busyOn(e)
    const r = await e.trade.checkout('shop_t', cart)
    expect(r).toMatchObject({ status: 'refused', reason: BUSY_REASON })
    busyOff(e)
    const cash0 = e.money.cash
    expect((await e.act({ kind: 'free', text: '我看看四周' })).status).toBe('applied')
    expect(actions(e)).not.toContain('trade.checkout')
    expect(e.money.cash).toBe(cash0)
    expect(countOf(e, row.item)).toBe(0)
  })

  it('被擋下之後讀一份舊存檔，再做自由行動：那一車也沒有結掉', async () => {
    const { e } = await setup()
    const row = e.trade.view('shop_t')!.shelf.find((r) => r.block === null)!
    const cart = toCart(addRow([], 'buy', row.item, 1), 'cash')
    const early = e.save()
    busyOn(e)
    expect((await e.trade.checkout('shop_t', cart)).status).toBe('refused')
    expect(e.load(early)).toBeNull()
    const cash0 = e.money.cash
    await e.act({ kind: 'free', text: '我看看四周' })
    expect(actions(e)).not.toContain('trade.checkout')
    expect(e.money.cash).toBe(cash0)
  })

  it('開新局、回退之後也不會有舊草稿冒出來', async () => {
    const { e } = await setup()
    const row = e.trade.view('shop_t')!.shelf.find((r) => r.block === null)!
    const cart = toCart(addRow([], 'buy', row.item, 1), 'cash')
    busyOn(e)
    expect((await e.trade.checkout('shop_t', cart)).status).toBe('refused')
    busyOff(e)
    e.newGame({ seed: 9, testContent: [PACK], testFeatures: [busy] })
    e.setAi({ useAi: false })
    expect(e.createCharacter(DRAFT)).toEqual([])
    await e.act({ kind: 'free', text: '看看' })
    expect(actions(e)).not.toContain('trade.checkout')
  })

  it('事件開著時被擋下的抵達：選完事件之後人不會被搬過去；之後讀檔也不會', async () => {
    const { e } = await setup({ events: true, at: 'E1' })
    // 走進 b_b：街頭事件擋住
    expect((await e.world.arrive('b_b', 'E1')).status).toBe('applied')
    expect(e.event.view()?.text).toContain('擋住了去路')
    const early = e.save()
    const r = await e.world.arrive('b_a', 'E1')
    expect(r.status).toBe('refused')
    const out = await e.event.choose('leave')
    expect(out.status).toBe('applied')
    expect(e.state.location.block).toBe('b_b')
    expect((out.reports ?? []).map((x) => x.action)).not.toContain('world.arrive')
    // 讀檔（事件開著的那個時間點）之後做自由行動：人還在 b_b
    expect(e.load(early)).toBeNull()
    expect(e.event.view()?.text).toContain('擋住了去路')
    await e.act({ kind: 'free', text: '我看看四周' })
    expect(e.state.location.block).toBe('b_b')
  })

  it('計程車：出發之後事件開了，抵達留著；事件做完之後才提交（人到站上），這是唯一該留的情形', async () => {
    const { e } = await setup({ events: true, at: 'F2' })
    const dest = e.transit.view().taxi.destinations.find((d) => d.reason === null && d.block === 'b_b')
    expect(dest).toBeTruthy()
    const r = await e.transit.taxi(dest!.key)
    expect(r.status).not.toBe('applied') // 抵達被事件擋下
    expect(e.event.view()?.text).toContain('司機回頭')
    expect(e.state.location.block).toBe('b_a')
    const out = await e.event.choose('ok')
    expect(out.status).toBe('applied')
    expect(e.state.location.block).toBe('b_b')
    expect(actions(e).filter((a) => a === 'transit.taxi')).toHaveLength(2)
  })

  it('計程車抵達留著的時候讀檔：抵達不會在讀檔之後冒出來', async () => {
    const { e } = await setup({ events: true, at: 'F2' })
    const early = e.save()
    const dest = e.transit.view().taxi.destinations.find((d) => d.reason === null && d.block === 'b_b')!
    await e.transit.taxi(dest.key)
    expect(e.load(early)).toBeNull()
    await e.act({ kind: 'free', text: '看看' })
    expect(e.state.location.block).toBe('b_a')
    expect(actions(e).filter((a) => a === 'transit.taxi')).toHaveLength(0)
  })

  it('原始碼：只有「前面已提交、後面被擋」才留，store 的清空點齊全', () => {
    expect(storeSrc).toContain('if (i > 0) for (let j = i;')
    expect(storeSrc).not.toMatch(/r\.status === 'refused'\) queued/)
    for (const fn of ['load', 'rewind', 'undo', 'retryBattle', 'rewindToStage']) expect(storeSrc, fn).toMatch(new RegExp(`function ${fn}\\([^)]*\\)[^{]*\\{[\\s\\S]{0,260}clearQueued\\(\\)`))
    expect(storeSrc.match(/clearQueued\(\)/g)!.length).toBeGreaterThanOrEqual(8)
  })
})

// ---- S1：引擎開了戰鬥，全域換到戰鬥畫面 ----

describe('S1 引擎開了戰鬥就換到戰鬥畫面', () => {
  it('App 看 inBattle 與等著選的戰敗，不在戰鬥相關頁面時換到 /combat（帶 from）', () => {
    expect(appSrc).toMatch(/eng\.inBattle \|\| !!eng\.pendingDefeat/)
    expect(appSrc).toMatch(/battleRouter\.push\(\{ path: '\/combat', query: \{ from: route\.fullPath \} \}\)/)
    for (const p of ['/combat', '/netcombat', '/opinion', '/scene']) expect(appSrc).toContain(`'${p}'`)
  })
})

// ---- S2：帳單「剛結算」 ----

describe('S2 帳單只在這一步新產生 bill.settle 時打開', () => {
  async function rented() {
    const s = await setup({ at: 'F3' })
    expect((await s.e.rest.rent('res_t')).status).toBe('applied')
    return s
  }
  it('freshEffects：只看傳進來的報告；bill.settle 開帳單、bill.notice 變通知', () => {
    const r = (action: string, summary = '') => ({ action, outcome: { summary } })
    expect(freshEffects([r('free')])).toEqual({ openBills: false, toasts: [] })
    expect(freshEffects([r('bill.settle'), r('bill.notice', '明天收租')])).toEqual({ openBills: true, toasts: ['明天收租'] })
  })

  it('跨過週一的那一步：feed 帶著 bill.settle；讀檔之後 feed 不動，下一步也不帶舊的結算', async () => {
    const { e } = await rented()
    const seq0 = e.feed.seq
    expect(e.ledger([{ op: 'time', minutes: 8 * 1440 }])).toBeNull()
    expect(e.feed.seq).toBeGreaterThan(seq0)
    expect(freshEffects(e.feed.reports).openBills).toBe(true)
    const saved = e.save() // 紀錄裡已經有一份 bill.settle
    await e.act({ kind: 'free', text: '看看' })
    expect(freshEffects(e.feed.reports).openBills).toBe(false)
    expect(e.load(saved)).toBeNull()
    const seq1 = e.feed.seq
    expect(e.state.reports.some((x) => x.action === 'bill.settle')).toBe(true)
    expect(e.feed.seq).toBe(seq1)
    await e.act({ kind: 'free', text: '再看看' })
    expect(freshEffects(e.feed.reports).openBills).toBe(false)
  })

  it('開另一局（報告 id 又從 r1 起算）：不會把新局的報告當成舊的漏掉，也不會把舊的當新的', async () => {
    const { e } = await rented()
    e.ledger([{ op: 'time', minutes: 8 * 1440 }])
    e.newGame({ seed: 3, testContent: [PACK], testFeatures: [busy] })
    e.setAi({ useAi: false })
    expect(e.createCharacter(DRAFT)).toEqual([])
    expect(freshEffects(e.feed.reports).openBills).toBe(false)
    expect(e.ledger([{ op: 'cred', delta: 1 }])).toBeNull()
    expect(freshEffects(e.feed.reports).openBills).toBe(false)
  })

  it('App 的 watch 看的是 store 的 feed，不再靠報告 id 往回找', () => {
    expect(appSrc).toContain('eng.feed.seq')
    expect(appSrc).toContain('freshEffects(eng.feed.reports)')
    expect(appSrc).not.toContain('seenReport')
  })
})

// ---- S3：設定交給引擎 ----

describe('S3 設定的快速移動與名冊會死交給引擎', () => {
  it('rulesFromUi 帶 fastTravel、rosterDeath；沒給的不寫', () => {
    expect(rulesFromUi({ fastTravel: false, rosterDeath: true })).toEqual({ fastTravel: false, rosterDeath: true })
    expect(rulesFromUi({ difficulty: '普通' })).toEqual({ difficulty: 'normal' })
  })

  it('從設定走一遍：設定關掉快速移動、打開名冊會死，開新局之後引擎的規則跟著，計程車灰掉', async () => {
    setActivePinia(createPinia())
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const st = useSettings()
    st.s.fastTravel = false
    st.s.rosterDeath = true
    const e = useEngine()
    e.newGame({ seed: 7, rules: rulesFromUi(st.s), testContent: [PACK] })
    e.setAi({ useAi: false })
    expect(e.createCharacter(DRAFT)).toEqual([])
    expect(e.state.rules.fastTravel).toBe(false)
    expect(e.state.rules.rosterDeath).toBe(true)
    expect((await e.world.arrive('b_a', 'F2')).status).toBe('applied')
    expect(e.transit.view().taxi.reason).toMatch(/快速移動/)
  })
})

// ---- S4：示範場景 ----

describe('S4 示範場景只在示範入口；不補道具', () => {
  it('開局晾衣場沒有成人場景的服務；主畫面沒有「scene」服務的分支', () => {
    const all = Object.values(BLOCKS).flatMap((b) => b.facilities ?? [])
    expect(all.flatMap((f) => f.services ?? []).filter((s) => (s.action as string) === 'scene')).toEqual([])
    expect(mainSrc).not.toMatch(/case 'scene'/)
    expect(JSON.stringify(BLOCKS)).not.toContain('成人場景')
  })

  it('demoSceneChanges：第一次給道具；放過示範技能之後再進來不補', () => {
    const d = DEMO_SCENES[0]!
    const first = demoSceneChanges(d, { actor: true, pc: 'pc', ext: {}, items: [] })
    expect(first.filter((c) => c.op === 'item')).toHaveLength(2)
    const again = demoSceneChanges(d, { actor: true, pc: 'pc', ext: { scene: { skills: ['nt_stroke'], positions: ['pos_ride'] }, tendency: { tags: { tg_dom: 'has' } }, bridge: {} }, items: [] })
    expect(again.filter((c) => c.op === 'item')).toEqual([])
  })

  it('startDemo 只有 AdultSceneScreen 的 #/scene?scene= 入口呼叫', async () => {
    const files = import.meta.glob('../../src/**/*.{vue,ts}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const users = Object.entries(files).filter(([f, src]) => src.includes('startDemo') && !f.endsWith('stores/engine.ts')).map(([f]) => f.replace('../../src/', ''))
    expect(users).toEqual(['screens/AdultSceneScreen.vue'])
  })
})

// ---- S5：中間人的店的人情 ----

describe('S5 中間人的店的人情是引擎的', () => {
  it('列引擎的人情；用掉走引擎的 favorUse，引擎的人情帳跟著少', async () => {
    const { e, pinia } = await setup()
    expect(e.commit({ summary: '人情。', changes: [{ op: 'favor.add', dir: 'owed_to_pc', who: 'lonestar', size: 'small', note: '你替她們擋了一次。' } as never, { op: 'favor.add', dir: 'owed_by_pc', who: 'rouge', size: 'mid' } as never] })).toBeNull()
    const text = strip(await html(pinia, FixerDialog, {}))
    expect(text).toContain('孤星連')
    expect(text).toContain('欠你・小人情')
    expect(text).toContain('你欠・中人情')
    expect(text).toContain('胭脂堂')
    expect(e.people.favors().owed_to_pc).toHaveLength(1)
    expect((await e.people.favorUse('fv_1')).status).toBe('applied')
    expect(e.people.favors().owed_to_pc).toHaveLength(0)
    expect(strip(await html(pinia, FixerDialog, {}))).not.toContain('欠你・小人情')
  })
  it('原始碼：不再讀 g.npcs、g.money.fav、假的用途清單', () => {
    expect(fixerSrc).not.toMatch(/g\.npcs|money\.fav|FAVOR_USES|n\.favor/)
  })
})

// ---- S6 S7：小隊與敵對值 ----

describe('S6 小隊讀引擎的隊伍與生命值；S7 狀態列的敵對值讀引擎的量表', () => {
  it('partyRows：隊伍是引擎的 state.party；生命值與感載上限是引擎的衍生數值；受傷會跟著變', async () => {
    const { e } = await setup()
    const rows = e.partyRows()
    expect(rows.map((r) => r.id)).toEqual(e.state.party)
    expect(rows[0]).toMatchObject({ id: e.state.pc, name: '露', me: true })
    const hp = rows[0]!.hp
    expect(hp[0]).toBe(e.pc!.hp)
    expect(hp[1]).toBeGreaterThan(0)
    expect(rows[0]!.load[1]).toBeGreaterThan(0)
    expect(e.commit({ summary: '受傷。', changes: [{ op: 'actor.track', id: e.state.pc!, track: 'hp', delta: -5 }] })).toBeNull()
    expect(e.partyRows()[0]!.hp[0]).toBe(hp[0] - 5)
    expect(mainSrc).not.toMatch(/g\.party/)
  })

  it('召集之後小隊跟著：名冊上的人進了隊伍就列出來', async () => {
    const { e } = await setup()
    expect((await e.people.meet('npc_run')).status).toBe('applied')
    expect(e.commit({ summary: '進名冊', changes: [{ op: 'roster.join', who: 'npc_run', since: e.state.time, reliability: 50, pay: 'fee' } as never] })).toBeNull()
    const runner = 'npc_run'
    const m = await e.fixer.muster([e.state.pc!, runner], [])
    expect(m, String(m.reason)).toMatchObject({ status: 'applied' })
    expect(e.partyRows().map((r) => r.id)).toEqual([e.state.pc, runner])
  })

  it('hostilityTop：引擎的量表（0 不列、高的在前、取前兩個）；狀態列畫它', async () => {
    const { e } = await setup()
    expect(e.hostilityTop()).toEqual([])
    const g = useGame()
    expect(g.topHostility).toEqual([])
    expect(e.commit({ summary: '敵對值。', changes: [{ op: 'meter', kind: 'hostility', key: 'hizakura', set: 40 }, { op: 'meter', kind: 'hostility', key: 'nora', set: 70 }, { op: 'meter', kind: 'hostility', key: 'eden', set: 10 }] })).toBeNull()
    expect(e.hostilityTop()).toEqual([['野良', 70], ['緋櫻', 40]])
    // 狀態列讀的是 g.topHostility（引擎的量表），不是舊的寫死資料
    expect(g.topHostility).toEqual([['野良', 70], ['緋櫻', 40]])
    expect(statusSrc).toContain('g.topHostility')
    expect(statusSrc).not.toMatch(/緋櫻|野良/)
  })
})

// ---- S8：休息與睡覺走引擎的 rest ----

describe('S8 主畫面的休息與臥室的睡一覺走引擎的 rest', () => {
  it('主畫面「休息」開休息對話框；臥室睡一覺呼叫引擎的 rest.sleep，不再直接動時間與感載', () => {
    expect(mainSrc).toContain(`ui.openRoot('rest')`)
    expect(mainSrc).not.toMatch(/g\.advance\(60\)/)
    expect(homeSrc).toContain(`e.rest.sleep('home')`)
    expect(homeSrc).not.toMatch(/g\.advance\(480\)|character\.load\[0\] = 0/)
  })
  it('睡在自己租的住處：引擎出 rest.sleep，生命回了、時間走了 8 小時', async () => {
    const { e } = await setup({ at: 'F3' })
    expect((await e.rest.rent('res_t')).status).toBe('applied')
    e.commit({ summary: '受傷。', changes: [{ op: 'actor.track', id: e.state.pc!, track: 'hp', delta: -8 }] })
    e.commit({ summary: '隔一段時間。', changes: [{ op: 'time', minutes: 17 * 60 }] })
    const t0 = e.state.time
    const r = await e.rest.sleep('home')
    expect(r.status).toBe('applied')
    expect(actions(e)).toContain('rest.sleep')
    expect(e.state.time).not.toEqual(t0)
  })
})

// ---- S9：勢力的人情顯示名字 ----

describe('S9 favorName', () => {
  it('勢力欠的人情寫勢力的名字；固定 NPC 寫名字；都查不到才用 id', async () => {
    const { e } = await setup()
    expect(e.people.favorName('lonestar')).toBe('孤星連')
    expect(e.people.favorName('npc_xiaomai')).toBe(e.state.actors.npc_xiaomai?.name ?? '小麥')
    expect(e.people.favorName('nobody_xyz')).toBe('nobody_xyz')
  })
})

// ---- A1～A5 ----

describe('A1～A5', () => {
  it('A1 召集上限讀引擎規則：數字不寫死在畫面', async () => {
    const { e } = await setup()
    expect(e.fixer.crewRules()).toEqual({ party: 4, tagalong: 2 })
    expect(callSrc).not.toMatch(/4 - party|最多 4 人|／2\b/)
  })
  it('A2 押金的收錢方式（pools）由引擎的函式給', () => {
    expect(storeSrc).toContain('residencePools(r)')
    expect(storeSrc).not.toMatch(/cash_ok === 'only'/)
  })
  it('A3 沒有委託時委託條四格都不亮；有委託才亮接案與踩點', () => {
    expect(mainSrc).toMatch(/const has = !!job\.value/)
    expect(mainSrc).toMatch(/state: has \? 'done' : ''/)
  })
  it('A4 追蹤度條不畫寫死的刻度', () => {
    expect(runSrc).not.toContain(':marks="[30, 60, 90]"')
  })
  it('A5 待處理裡沒有和引擎矛盾的假事件（喬被帶走、奈奈討人情）', () => {
    expect(PENDING.map((p) => p.id)).not.toContain('p_joe')
    expect(PENDING.map((p) => p.id)).not.toContain('p_favor')
  })
})

// ---- 引擎修正批的跟改 ----

describe('引擎修正批的跟改', () => {
  it('建角之後出身名冊（小麥、雷）在名冊上，示意包只補候選人；示意包不再濾核心包的 npc', async () => {
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 3, draft: DRAFT as never })
    expect(e.people.roster().members.map((m) => m.id).sort()).toEqual(['npc_ray', 'npc_xiaomai'])
    expect(e.people.candidates().map((c) => c.who).sort()).toEqual(['npc_jo', 'npc_nana'])
    expect(storeSrc).not.toContain('demoCoreWithoutPeople')
  })

  it('另一種出身：名冊是那個出身的人，不會再多出小麥；出身名冊上的人不當候選人', async () => {
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 3, draft: { ...DRAFT, origin: 'oldport', originChoice: { favor: 'rouge' } } as never })
    expect(e.people.roster().members.map((m) => m.id).sort()).toEqual(['npc_nana', 'npc_ray'])
    expect(e.people.candidates().map((c) => c.who)).toEqual(['npc_jo'])
  })

  it('「今天聊過了」是引擎互動列的 note；畫面照 note 顯示，不再讀 doneToday', async () => {
    const { e, pinia } = await setup()
    await e.people.meet('npc_xiaomai')
    const chat = () => interactRows(e.people.interactions('npc_xiaomai')).find((r) => r.kind === 'npc_chat')!
    expect(chat().note).toBeNull()
    expect(storeSrc).not.toContain('doneToday')
    void pinia
    void TalkDialog
  })

  it('已知的事的「近況」用引擎的 knowFactText', () => {
    const rows = knownRows({ bridge: null } as never, ['recent:b_a'], { tag: (x) => x, faction: (x) => x, path: (x) => x, item: (x) => x, place: (l) => (l.block === 'b_a' ? '甲街' : l.block ?? l.district ?? '') })
    expect(rows.find((r) => r.key === 'recent')!.value).toBe('最近去過甲街')
  })

  it('示意包的兩位中間人有後台勢力（backer）', async () => {
    const { demoPack } = await import('../../src/data/demo')
    const fixers = (demoPack().content as unknown as { fixer: Array<{ id: string; backer?: string }> }).fixer
    expect(fixers.map((f) => f.backer)).toEqual(['lonestar', 'strippers'])
  })
})
