// 驗收測試：dev/work/M2-ui-life.md（cpp-ui）。商店、每週帳單、打工、休息與住處接上引擎。
// 內容用測試自帶的最小假資料（一塊街區三個設施、一間店、六樣東西、一份工作、一處住處），不用示意世界包；
// 畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查；數字拿另一個獨立的引擎（讀同一份存檔）直接呼叫引擎函式來比。
//
//   b_t（d_t）：F1 商店（shop_cash 只收現金、shop_both 都收）、F2 打工的店、F3 住處

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature, Report } from '@engine/src'
import { FakeProvider, Game } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { checkout as tradeCheckout, planCheckout, quote, shopView } from '@engine/src/features/trade'
import { billPreview } from '@engine/src/features/bills'
import { jobsHere } from '@engine/src/features/work'
import { sleepDraft, sleepOptions } from '@engine/src/features/rest'
import { COMMISSION_ALLOW } from '@engine/src/features/commission'
import { useEngine } from '../../src/stores/engine'
import shopSrc from '../../src/dialogs/ShopDialog.vue?raw'
import billsSrc from '../../src/dialogs/BillsDialog.vue?raw'
import workSrc from '../../src/dialogs/WorkDialog.vue?raw'
import restSrc from '../../src/dialogs/RestDialog.vue?raw'
import viewSrc from '../../src/lib/lifeView.ts?raw'
import ShopDialog from '../../src/dialogs/ShopDialog.vue'
import BillsDialog from '../../src/dialogs/BillsDialog.vue'
import WorkDialog from '../../src/dialogs/WorkDialog.vue'
import RestDialog from '../../src/dialogs/RestDialog.vue'
import { addRow, billRows, failText, lifeDialogOf, needLack, removeRow, settledRows, slopeCells, stepText, toCart } from '../../src/lib/lifeView'

// ---- 假資料 ----

type Fx = Record<string, unknown>
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }]
const mapOf = (id: string, cells: Fx[]) => ({
  id, kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'],
    cells: [...cells, ...E], spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
})
const MAPS = [
  mapOf('m_t', [{ id: 'F1', at: [1, 1], mark: 'F', name: '雜貨店' }, { id: 'F2', at: [3, 1], mark: 'F', name: '麵攤' }, { id: 'F3', at: [5, 1], mark: 'F', name: '出租屋' }]),
  mapOf('m_u', [{ id: 'F1', at: [1, 1], mark: 'F', name: '空地' }, { id: 'F2', at: [3, 1], mark: 'F', name: '空地二' }, { id: 'F3', at: [5, 1], mark: 'F', name: '空地三' }]),
]
const item = (id: string, name: string, category: string, price: number, extra: Fx = {}): Fx => ({
  id, name, desc: `${name}。`, category, grade: 1, size: 0, legal: 'free', price, tags: ['stock_t'], ...extra,
})
const ITEMS = [
  item('t_bun', '糰糧', 'consumable', 10, { tags: ['stock_t', 'food'] }),
  item('t_gel', '凝膠', 'consumable', 40, { tags: ['stock_t', 'medical'] }),
  item('t_gun', '手槍', 'weapon', 160, { legal: 'register' }),
  item('t_tool', '工具', 'tool', 90),
  item('t_part', '零件', 'part', 120),
  item('t_box', '置物箱', 'misc', 30),
]
const WORLD = {
  special_map: MAPS, facility_type: [{ id: 'fac_shop', name: '商店' }, { id: 'fac_work', name: '打工' }, { id: 'fac_home', name: '住處' }],
  district: [{ id: 'd_t', name: '測試區', grade: 1, price_mult: 1, blocks: ['b_t', 'b_u'] }],
  block: [{
    id: 'b_t', district: 'd_t', name: '測試街', kind: 'block', map: 'm_t', exits: { E2: { to: 'b_u', arrive: 'E1' } },
    facilities: { F1: { type: 'fac_shop', name: '雜貨店' }, F2: { type: 'fac_work', name: '麵攤' }, F3: { type: 'fac_home', name: '出租屋' } },
  }, { id: 'b_u', district: 'd_t', name: '空街', kind: 'block', map: 'm_u', exits: { E1: { to: 'b_t', arrive: 'E2' } }, facilities: { F1: { type: 'fac_shop', name: '空地' }, F2: { type: 'fac_shop', name: '空地二' }, F3: { type: 'fac_shop', name: '空地三' } } }],
}
const PACK: ContentPack = {
  id: 'life_ui_test',
  content: {
    ...WORLD, item: ITEMS,
    shop_type: [
      { id: 'st_cash', name: '現金店', catalog: ['stock_t'], buys: ['stock_t'], grade_max: 3, cash: 'only', scan_registered: false, shop_mult: 1, temper: 0 },
      { id: 'st_both', name: '都收的店', catalog: ['stock_t'], buys: ['stock_t'], grade_max: 3, cash: true, scan_registered: true, shop_mult: 1, temper: 0 },
    ],
    shop: [
      { id: 'shop_cash', type: 'st_cash', name: '現金雜貨', district: 'd_t', block: 'b_t', facility: 'F1' },
      { id: 'shop_both', type: 'st_both', name: '兩種錢的店', district: 'd_t' },
    ],
    job: [{
      id: 'job_t', name: '麵攤幫工', facility: 'b_t/F2', district: 'd_t', wage: 10, pay: 'cash',
      stages: [{ name: '洗碗', mult: 1 }, { name: '掌勺', mult: 1.5, need: { shifts: 2, affinity: 0 } }],
    }],
    residence: [{ id: 'res_t', name: '出租屋', district: 'd_t', block: 'b_t', facility: 'F3', level: 1, rent: 100, cash_ok: true }],
  } as unknown as ContentPack['content'],
}
const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
/** 進行中的活動（測試自己登記，什麼都不放行）：擋住時的原因是引擎的 reason */
const BUSY_REASON = '測試的活動進行中，這件事現在不能做。'
const busy: Feature = {
  id: 'busy_test',
  install: (k) => k.activity.define({ kind: 'busy_test', owner: 'busy_test', order: 5, active: (s) => (s.ext.busy_test ? { id: 'b1', label: '測試活動' } : null), allow: [], reason: () => BUSY_REASON }),
}

type Eng = ReturnType<typeof useEngine>
async function setup(o: { seed?: number; at?: string; cred?: number; cash?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK], testFeatures: [busy] })
  e.setAi({ useAi: false })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cred', delta: (o.cred ?? 5000) - e.money.cred }, { op: 'cash', delta: (o.cash ?? 3000) - e.money.cash }])
  const r = await e.world.arrive('b_t', o.at ?? 'F1')
  expect(r.status).toBe('applied')
  return { pinia, e }
}
/** 另一個獨立的引擎讀同一份存檔 */
function oracle(e: Eng): Game {
  const g = new Game({ features: [...allFeatures(), busy], content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  return renderToString(app)
}
const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
const minutesOf = (e: Eng) => (e.state.time.day - 1) * 1440 + e.state.time.hour * 60 + e.state.time.minute
const countOf = (e: Eng, id: string) => e.gear.inventory().filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
/** 今天這間店上架的第一樣東西（照引擎的貨架） */
const firstShelf = (e: Eng, shop = 'shop_both') => e.trade.view(shop)!.shelf.find((r) => r.block === null)!

beforeEach(() => setActivePinia(createPinia()))

// ---- 商店 ----

describe('商店（TRADE；引擎的 trade）', () => {
  it('站在店的設施上，格子列出「進店」，對應到商店的對話框', async () => {
    const { e } = await setup()
    const use = e.world.grid()!.here.uses.find((u) => u.id.startsWith('trade.shop:'))!
    expect(use.id).toBe('trade.shop:shop_cash')
    expect(lifeDialogOf(use.id)).toEqual({ name: 'shop', props: { shopId: 'shop_cash' } })
    expect(lifeDialogOf('work.shift')?.name).toBe('work')
    expect(lifeDialogOf('rest.sleep')?.name).toBe('rest')
    expect(lifeDialogOf('transit.board')).toBeNull()
  })

  it('結帳之後引擎的背包多了買的、錢少了；存檔再讀還在', async () => {
    const { e } = await setup()
    const row = firstShelf(e)
    const before = e.money.cash
    const cart = toCart(addRow([], 'buy', row.item, 2), 'cash')
    const plan = e.trade.plan('shop_both', cart)
    expect(plan.problems).toEqual([])
    // 標準答案：另一個引擎直接呼叫 planCheckout、checkout
    const g0 = oracle(e)
    expect(plan).toEqual(planCheckout(g0.k, g0.state, 'shop_both', cart))
    expect(e.trade.view('shop_both')).toEqual(shopView(g0.k, g0.state, 'shop_both'))
    g0.commit(tradeCheckout(g0.k, g0.state, 'shop_both', cart))
    const r = await e.trade.checkout('shop_both', cart)
    expect(r.status).toBe('applied')
    expect(e.money).toEqual(g0.state.money)
    expect(e.gear.inventory()).toEqual(g0.state.inventory)
    expect(countOf(e, row.item)).toBe(2)
    expect(e.money.cash).toBe(before - plan.net)
    expect(e.state.reports.at(-1)!.action).toBe('trade.checkout')
    // 存檔再讀還在（另一個引擎讀同一份存檔）
    const g = oracle(e)
    expect(g.state.inventory.find((s) => s.id === row.item)?.qty).toBe(2)
    expect(g.state.money.cash).toBe(e.money.cash)
  })

  it('買與賣同一台：賣掉身上的、買新的，淨額照選的那種錢；今天賣完了就不能再買', async () => {
    const { e } = await setup()
    const a = firstShelf(e)
    expect((await e.trade.checkout('shop_both', toCart(addRow([], 'buy', a.item, 1), 'cred'))).status).toBe('applied')
    const view = e.trade.view('shop_both')!
    const sell = view.sell.find((s) => s.item === a.item)!
    expect(sell.block).toBeNull()
    const other = view.shelf.find((r) => r.item !== a.item && r.block === null)!
    const cart = toCart(addRow(addRow([], 'sell', a.item, 1), 'buy', other.item, 1), 'cash')
    const plan = e.trade.plan('shop_both', cart)
    const cash0 = e.money.cash, cred0 = e.money.cred
    expect(plan.net).toBe(plan.buyTotal - plan.sellTotal)
    expect((await e.trade.checkout('shop_both', cart)).status).toBe('applied')
    expect(e.money.cash).toBe(cash0 - plan.net)
    expect(e.money.cred).toBe(cred0)
    expect(countOf(e, a.item)).toBe(0)
    expect(countOf(e, other.item)).toBe(1)
  })

  it('價格拆解的每一步和引擎的 quote 一樣；畫面寫出每一步的名字與數字', async () => {
    const { e, pinia } = await setup()
    const row = firstShelf(e)
    const g = oracle(e)
    const q = quote(g.k, g.state, 'shop_both', row.item, 'buy')
    expect(row.quote).toEqual(q)
    expect(row.price).toBe(q.price)
    const text = strip(await html(pinia, ShopDialog, { shopId: 'shop_both' }))
    expect(text).toContain(row.name)
    // 選中那一件之後的拆解在 DOM 裡：把這一件放進車並選中（元件自己的狀態只能在瀏覽器裡點；這裡驗 stepText 對得上）
    for (const s of q.steps) {
      const t = stepText(s)
      expect(t.name).toBe(s.name)
      expect(t.value).toBe(s.value)
      expect(t.arrow).toBe(s.mult > 1 ? '▲' : s.mult < 1 ? '▼' : '')
    }
    expect(stepText({ id: 'district', name: '區倍率', mult: 0.8, value: 8 })).toMatchObject({ mult: '×0.80', arrow: '▼', pct: '−20%' })
    expect(stepText({ id: 'discount', name: '折扣', mult: 1.2, value: 12 })).toMatchObject({ mult: '×1.20', arrow: '▲', pct: '+20%' })
  })

  it('只收現金的店：帳戶那一格是灰的，title 是引擎的原因；結帳選帳戶被引擎擋下', async () => {
    const { e, pinia } = await setup()
    const v = e.trade.view('shop_cash')!
    expect(v.cash).toBe('only')
    expect(v.pay.cred).toBeTruthy()
    expect(v.pay.cash).toBeNull()
    const h = await html(pinia, ShopDialog, { shopId: 'shop_cash' })
    expect(h).toMatch(/data-pay="cred"[^>]*/)
    const credBtn = h.match(/<button[^>]*data-pay="cred"[^>]*>/)![0]
    expect(credBtn).toContain('is-unavailable')
    expect(credBtn).toContain(`title="${v.pay.cred}"`)
    expect(h.match(/<button[^>]*data-pay="cash"[^>]*>/)![0]).not.toContain('is-unavailable')
    const row = firstShelf(e, 'shop_cash')
    const r = await e.trade.checkout('shop_cash', toCart(addRow([], 'buy', row.item, 1), 'cred'))
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(v.pay.cred)
    expect(countOf(e, row.item)).toBe(0)
  })

  it('沒做成時的話：引擎的原因照寫；任務鏈停住的另有一句', () => {
    expect(failText({ status: 'applied' }, 'x')).toBeNull()
    expect(failText({ status: 'refused', reason: '引擎的原因。' }, 'x')).toBe('引擎的原因。')
    expect(failText({ status: 'refused' }, '備用的話。')).toBe('備用的話。')
    expect(failText({ status: 'paused' }, 'x')).toContain('任務鏈')
  })

  it('購物車的整理：同一件加個數、拿掉、換成引擎的購物車', () => {
    let rows = addRow([], 'buy', 'a')
    rows = addRow(rows, 'buy', 'a', 2)
    rows = addRow(rows, 'sell', 'b', 1, 'u1')
    expect(rows).toEqual([{ mode: 'buy', item: 'a', qty: 3 }, { mode: 'sell', item: 'b', qty: 1, uid: 'u1' }])
    expect(toCart(rows, 'cred')).toEqual({ buy: [{ item: 'a', qty: 3 }], sell: [{ item: 'b', qty: 1, uid: 'u1' }], pay: 'cred' })
    expect(removeRow(rows, 'buy:a:')).toHaveLength(1)
  })

  it('殺價成功之後今天的價錢變了，按鈕灰掉並寫今天殺過了', async () => {
    let won: { e: Eng; pinia: ReturnType<typeof createPinia> } | null = null
    let beforePrice = 0
    for (let seed = 1; seed <= 40 && !won; seed++) {
      const { e, pinia } = await setup({ seed })
      const row = firstShelf(e)
      beforePrice = row.price
      const r = await e.trade.bargain('shop_both', 'haggle')
      expect(r.status).toBe('applied')
      const today = e.trade.view('shop_both')!.bargain.today
      if (today && today.mult < 1) won = { e, pinia }
    }
    expect(won).not.toBeNull()
    const { e, pinia } = won!
    const v = e.trade.view('shop_both')!
    expect(v.shelf.find((r) => r.block === null)!.quote.steps.some((s) => s.id === 'bargain')).toBe(true)
    expect(v.shelf.find((r) => r.block === null)!.price).toBeLessThan(beforePrice)
    expect(v.bargain.block).toContain('今天已經')
    const h = await html(pinia, ShopDialog, { shopId: 'shop_both' })
    const btn = h.match(/<button[^>]*data-bargain[^>]*>/)![0]
    expect(btn).toContain('aria-disabled="true"')
    expect(btn).toContain('今天已經')
    // 再殺一次被引擎擋下
    const again = await e.trade.bargain('shop_both', 'haggle')
    expect(again.status).not.toBe('applied')
  })
})

// ---- 每週帳單 ----

describe('每週帳單（引擎的 bills）', () => {
  /** 租下出租屋、再讓時間跨過週一 */
  async function rentAndCross(cred = 5000) {
    const s = await setup({ at: 'F3', cred })
    expect((await s.e.rest.rent('res_t')).status).toBe('applied')
    return s
  }
  const crossMonday = (e: Eng) => e.ledger([{ op: 'time', minutes: 8 * 1440 }])

  it('預覽的每一項和引擎的 billPreview 一樣；改成用現金付之後下一次預覽跟著變', async () => {
    const { e, pinia } = await rentAndCross()
    const p = e.bills.preview()
    const g = oracle(e)
    expect(p).toEqual(billPreview(g.k, g.state))
    const rent = billRows(p).dues.find((r) => r.id === 'rent')!
    expect(rent).toMatchObject({ name: '出租屋的房租', amount: 100, pool: 'cred', cashOk: true, state: 'paid' })
    expect(strip(await html(pinia, BillsDialog))).toContain('出租屋的房租')
    const r = await e.bills.set('rent', { cash: true })
    expect(r.status).toBe('applied')
    expect(billRows(e.bills.preview()).dues.find((x) => x.id === 'rent')!.pool).toBe('cash')
    expect(e.bills.preview().money.cash.due).toBe(100)
    expect((await e.bills.set('rent', { stopped: true })).status).toBe('applied')
    expect(billRows(e.bills.preview()).dues.find((x) => x.id === 'rent')!.state).toBe('skipped')
  })

  it('跨過週一之後引擎出了 bill.settle，每一項付了多少、哪一項沒付成和報告一樣', async () => {
    const { e, pinia } = await rentAndCross(40)
    const before = e.state.reports.length
    expect(crossMonday(e)).toBeNull()
    const fresh = e.state.reports.slice(before)
    const settle = fresh.find((r) => r.action === 'bill.settle') as Report
    expect(settle).toBeTruthy()
    const rows = settledRows(e.bills.lastSettle())
    const rent = rows.find((r) => r.id === 'rent')!
    const beat = settle.timeline.find((b) => b.tag === 'bill.line')!.data as Record<string, unknown>
    expect(rent).toMatchObject({ paid: beat.paid, unpaid: beat.unpaid, amount: beat.amount })
    expect(rent.unpaid).toBeGreaterThan(0)
    const text = strip(await html(pinia, BillsDialog, { settled: true }))
    expect(text).toContain('剛結算的一週')
    expect(text).toContain(`欠 ${rent.unpaid}`)
    expect(e.bills.preview().overdue).toBeGreaterThan(0)
    expect(slopeCells(e.bills.preview()).find((c) => c.now)).toBeTruthy()
  })

  it('下坡路四格：現在在哪一格、付不清會走到哪一格都是引擎的', async () => {
    const { e } = await rentAndCross(0)
    e.ledger([{ op: 'cred', delta: -e.money.cred }, { op: 'cash', delta: -e.money.cash }])
    const p = e.bills.preview()
    const cells = slopeCells(p)
    expect(cells).toHaveLength(4)
    expect(cells.filter((c) => c.next)).toHaveLength(p.slopeIfShort ? 1 : 0)
    expect(billRows(p).dues.find((r) => r.id === 'rent')!.state).toBe('short')
  })
})

// ---- 打工 ----

describe('打工（引擎的 work）', () => {
  it('在打工的設施上，引擎列出「打工」；一班的時間與錢和引擎一致', async () => {
    const { e, pinia } = await setup({ at: 'F2' })
    expect(e.world.grid()!.here.uses.some((u) => u.id === 'work.shift')).toBe(true)
    const j = e.work.here()[0]!
    const g = oracle(e)
    expect(e.work.here()).toEqual(jobsHere(g.k, g.state))
    expect(strip(await html(pinia, WorkDialog))).toContain('麵攤幫工')
    const opt = j.options.find((o) => o.hours === 2)!
    const t0 = minutesOf(e), cash0 = e.money.cash
    const r = await e.work.shift(j.id, 2)
    expect(r.status).toBe('applied')
    expect(minutesOf(e) - t0).toBe(120)
    expect(e.money.cash - cash0).toBe(opt.expected)
    const last = e.work.here()[0]!.last!
    expect(last).toMatchObject({ hours: 2, amount: opt.expected, pay: 'cash', stage: 1 })
  })

  it('條件不夠的階段寫出還差什麼；條件到了升階的詢問是事件，視窗打開', async () => {
    const { e } = await setup({ at: 'F2' })
    const j0 = e.work.here()[0]!
    expect(j0.next?.number).toBe(2)
    expect(needLack(j0.next!.need)).toBe('做滿的班數還差 2')
    expect((await e.work.shift(j0.id, 2)).status).toBe('applied')
    expect(needLack(e.work.here()[0]!.next!.need)).toBe('做滿的班數還差 1')
    expect(e.event.view()).toBeNull()
    expect((await e.work.shift(j0.id, 2)).status).toBe('applied')
    expect(e.work.here()[0]!.next!.need!.met).toBe(true)
    expect(needLack(e.work.here()[0]!.next!.need)).toBe('')
    const ev = e.event.view()
    expect(ev).not.toBeNull()
    expect(ev!.options.length).toBeGreaterThan(0)
  })

  it('不在設施上時引擎沒有列打工，對話框寫這裡沒有可以打的工', async () => {
    const { e, pinia } = await setup({ at: 'F1' })
    expect(e.work.here()).toEqual([])
    expect(strip(await html(pinia, WorkDialog))).toContain('這裡沒有可以打的工')
  })
})

// ---- 休息與住處 ----

describe('休息與住處（引擎的 rest）', () => {
  const hurt = (e: Eng, n: number) => expect(e.commit({ summary: '受傷', changes: [{ op: 'actor.track', id: e.state.pc!, track: 'hp', delta: -n }] })).toBeNull()

  it('睡一覺：生命、時間和引擎一致；不到 16 小時按鈕是灰的並有原因', async () => {
    const { e, pinia } = await setup({ at: 'F1' })
    hurt(e, 8)
    const hp0 = e.pc!.hp
    const g = oracle(e)
    g.commit(sleepDraft(g.k, g.state, { spot: 'wild' }))
    const opts = e.rest.options()
    expect(opts).toEqual(sleepOptions(oracle(e).k, oracle(e).state))
    const r = await e.rest.sleep('wild')
    expect(r.status).toBe('applied')
    expect(e.pc!.hp).toBe(g.state.actors[g.state.pc!]!.hp)
    expect(e.pc!.hp).toBeGreaterThanOrEqual(hp0)
    expect(minutesOf(e)).toBe((g.state.time.day - 1) * 1440 + g.state.time.hour * 60 + g.state.time.minute)
    // 剛睡完：每一個選項都是灰的，原因是引擎的那一句
    const why = e.rest.sleepBlock()
    expect(why).toContain('距上次睡一覺')
    expect(e.rest.options().every((o) => o.block === why)).toBe(true)
    const h = await html(pinia, RestDialog)
    expect(h).toContain('data-sleep-why')
    expect(strip(h)).toContain('距上次睡一覺')
    expect((await e.rest.sleep('wild')).reason).toBe(why)
  })

  it('喘口氣：感載退、花一小時，結果是引擎的', async () => {
    const { e } = await setup({ at: 'F1' })
    const t0 = minutesOf(e)
    expect(e.rest.breathBlock()).toBeNull()
    expect((await e.rest.breath()).status).toBe('applied')
    expect(minutesOf(e) - t0).toBe(60)
    expect(e.rest.breaths().used).toBe(1)
  })

  it('租房扣押金、退租拿回；已經租著時再租被引擎擋下', async () => {
    const { e, pinia } = await setup({ at: 'F3' })
    const res = e.rest.residences().find((r) => r.id === 'res_t')!
    expect(res.block_reason).toBeNull()
    expect(res.deposit).toBe(200)
    const cred0 = e.money.cred
    expect((await e.rest.rent('res_t')).status).toBe('applied')
    expect(e.money.cred).toBe(cred0 - res.deposit)
    expect(e.rest.home()).toMatchObject({ id: 'res_t', rent: 100, deposit: 200, arrears: 0, locked: false })
    expect(e.rest.residences()[0]!.block_reason).toContain('已經租著')
    expect(strip(await html(pinia, RestDialog))).toContain('出租屋')
    // 在自己的住處：引擎列睡一覺與喘口氣
    const ids = e.world.grid()!.here.uses.map((u) => u.id)
    expect(ids).toEqual(expect.arrayContaining(['rest.sleep', 'rest.breath']))
    expect(e.rest.leaveBlock()).toBeNull()
    expect((await e.rest.leave()).status).toBe('applied')
    expect(e.money.cred).toBe(cred0)
    expect(e.rest.home()).toBeNull()
    expect(e.rest.leaveBlock()).toBe('你現在沒有租任何住處。')
  })
})

// ---- 活動進行中 ----

describe('有活動（委託副本、戰鬥）進行時這四塊的入口都被擋，原因是引擎的', () => {
  it('結帳、殺價、帳單設定、上班、睡覺與租房的原因是引擎的 blockOf；對話框顯示它', async () => {
    const { e, pinia } = await setup({ at: 'F1' })
    expect((await e.commit({ summary: '開活動', action: 'busy.on', changes: [{ op: 'ext', key: 'busy_test', value: { on: true } }] }))).toBeNull()
    const g = oracle(e)
    expect(e.trade.lock()).toBe(g.blockOf('commit:trade.checkout'))
    expect(e.trade.lock()).toBe(BUSY_REASON)
    expect(e.bills.lock()).toBe(BUSY_REASON)
    expect(e.work.lock()).toBe(BUSY_REASON)
    expect(e.rest.sleepBlock()).toBe(BUSY_REASON)
    expect(e.rest.breathBlock()).toBe(BUSY_REASON)
    expect(e.rest.residences()[0]!.block_reason).toBe(BUSY_REASON)
    const row = e.trade.view('shop_both')!.shelf[0]!
    const r = await e.trade.checkout('shop_both', toCart(addRow([], 'buy', row.item, 1), 'cash'))
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(BUSY_REASON)
    const h = await html(pinia, ShopDialog, { shopId: 'shop_both' })
    expect(h).toContain('data-lock')
    expect(strip(h)).toContain(BUSY_REASON)
    expect(h.match(/<button[^>]*data-checkout[^>]*>/)![0]).toContain('aria-disabled="true"')
    expect(strip(await html(pinia, BillsDialog))).toContain(BUSY_REASON)
  })

  it('真正的委託副本不放行這四塊（白名單裡沒有）', () => {
    for (const doing of ['commit:trade.checkout', 'commit:bill.set', 'commit:work.shift', 'commit:rest.sleep', 'commit:rest.breath', 'commit:home.rent', 'commit:home.leave']) {
      expect(COMMISSION_ALLOW.some((p) => doing.startsWith(p))).toBe(false)
    }
  })
})

// ---- 不寫規則 ----

describe('元件與 lifeView 不寫價錢、報酬、回復量的算式，也不 import 舊資料', () => {
  const FILES: Record<string, string> = { 'ShopDialog.vue': shopSrc, 'BillsDialog.vue': billsSrc, 'WorkDialog.vue': workSrc, 'RestDialog.vue': restSrc, 'lifeView.ts': viewSrc }
  it('不 import data/shops 與 data/weekly，也沒有舊的價格或帳單函式', () => {
    for (const [f, s] of Object.entries(FILES)) {
      expect(s, f).not.toMatch(/data\/shops|data\/weekly|settleBills|buyPrice|sellPrice|billMultiplier|downhillStage/)
    }
  })
  it('沒有價格、報酬、回復的常數（收購比例、區倍率、時薪乘法、回復率乘法）', () => {
    for (const [f, s] of Object.entries(FILES)) {
      expect(s, f).not.toMatch(/BUYBACK|DISTRICT_PRICE|CONDITION_MULT|wage\s*\*|\.rate\s*\*|price\s*\*\s*0\./)
    }
  })
})
