// 驗收測試：dev/work/M4-ui-auction.md（cpp-ui）。拍賣行的介面：階段、會員與推薦、目錄與預展看貨、進場、一回合一回合的競價、離場與結算、進行中別的入口灰掉。
// 引擎用真的（AI 關著）；內容是測試自帶的最小假資料：一家拍賣行（週五黃金時段）、五件拍品（零件、義體、藝術品）、三位競標者、一位寫推薦函的 NPC，與一座帶 auction 的設施。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 auction 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack } from '@engine/src'
import { FakeProvider, Game, weekdayOf } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { auctionView, bidDraft, bidOptions, catalogView } from '@engine/src/features/auction'
import { actorOf as npcActorOf } from '@engine/src/features/npcs'
import { buildCreationReport } from '@engine/src/features/creation'
import { formatTime, toMinutes } from '@engine/src/core/util/time'
import { useEngine } from '../../src/stores/engine'
import { DRAFT } from '../commission/fixtures'
import AuctionDialog from '../../src/dialogs/AuctionDialog.vue'
import AuctionLobby from '../../src/components/auction/AuctionLobby.vue'
import AuctionFloor from '../../src/components/auction/AuctionFloor.vue'
import AuctionResult from '../../src/components/auction/AuctionResult.vue'
import mainSrc from '../../src/screens/MainScreen.vue?raw'
import { settlementOf, stageOf } from '../../src/lib/auctionView'
import { fmt } from '../../src/lib/price'
import { demoPack } from '../../src/data/demo'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>
const HOUSE = 'ah_t'

// ---- 假資料 ----
const MAP = {
  id: 'm_auc', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5], layout: ['##########', '#F.F.....#', 'E.1....2.E', '#........#', '##########'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '拍賣行' }, { id: 'F2', at: [3, 1], mark: 'F', name: '雜貨店' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
const PART = (id: string, name: string, type: string, price: number): Rec => ({ id, name, type, material: 'mech', brand: 'star', grade: 3, price, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new' })
const PACK: ContentPack = {
  id: 'auction_ui_test',
  content: {
    special_map: [MAP],
    // 同一種設施也帶 craft 與 sleep：進行中這兩樣「這裡」的選項要灰掉（引擎的 blockOf）
    facility_type: [
      { id: 'fac_a_house', name: '拍賣行', auction: { house: HOUSE }, craft: { by: 'shop' }, sleep: { rate: 0.5, cost: 10 } },
      { id: 'fac_a_plain', name: '雜貨店' },
    ],
    district: [{ id: 'd_a', name: '拍賣區', grade: 1, price_mult: 1, blocks: ['b_a'] }],
    block: [{ id: 'b_a', district: 'd_a', name: '拍賣街', kind: 'block', map: 'm_auc', exits: {}, facilities: { F1: { type: 'fac_a_house', name: '拍賣行' }, F2: { type: 'fac_a_plain', name: '雜貨店' } } }],
    part: [PART('pt_a_barrel', '槍管「餘燼」', 'barrel', 600), PART('pt_a_plate', '板材「鏡面」', 'plate', 400), PART('pt_a_fiber', '纖維「鉻絲」', 'fiber', 500)],
    blueprint: [{ id: 'bp_a_arm', kind: 'cyberware', name: '義臂「鐵匠」', desc: '測試。', brand: 'star', grade: 3, legal: 'free', price: 900, size: 1, weight: 1, slot: 'arm', invasiveness: 'light', sink_cost: 2, require: [{ type: 'plate' }], optional: [], stock: { plate: 'pt_a_plate' } }],
    item: [
      { id: 'it_a_art1', name: '小油畫', desc: '測試。', category: 'misc', grade: 3, size: 1, legal: 'free', price: 1000 },
      { id: 'it_a_art2', name: '小雕像', desc: '測試。', category: 'misc', grade: 3, size: 1, legal: 'free', price: 2000 },
    ],
    auction_house: [{ id: HOUSE, name: '測試白槌', weekday: 4, segment: 'prime', lots: [5, 5], kinds: ['part', 'cyberware', 'art'], bidders: [3, 3], member: { faction: 'eden', favor_min: 40, ref: true } }],
    auction_lot: [
      { id: 'al_1', kind: 'part', part: 'pt_a_barrel', desc: '一根槍管。' }, { id: 'al_2', kind: 'part', part: 'pt_a_fiber' },
      { id: 'al_3', kind: 'cyberware', blueprint: 'bp_a_arm' },
      { id: 'al_4', kind: 'art', item: 'it_a_art1', market: 1000, name: '小油畫', cert: '附鑑定書，簽名相符。' }, { id: 'al_5', kind: 'art', item: 'it_a_art2', market: 2000, name: '小雕像' },
    ],
    auction_bidder: [
      { id: 'ab_1', name: '收藏家', interests: ['art'] }, { id: 'ab_2', name: '義體商人', interests: ['cyberware', 'part'] }, { id: 'ab_3', name: '來賓', interests: ['part', 'art'] },
    ],
    npc: [{ id: 'npc_a_ref', name: '常客', kind: 'citizen', age: 50, guard: 12, wealth: 3, auction_ref: true }],
  } as unknown as ContentPack['content'],
}

/** 把時鐘撥到下一個「星期 wd、hour 點」（0 是週一）；已經過了就撥到下一週 */
function goTo(e: Eng, wd: number, hour: number, minute = 0): void {
  const now = toMinutes(e.state.time)
  for (let d = e.state.time.day; d <= e.state.time.day + 8; d++) {
    const t = (d - 1) * 1440 + hour * 60 + minute
    if (t >= now && weekdayOf({ day: d, hour, minute }) === wd) { e.ledger([{ op: 'time', minutes: t - now }]); return }
  }
  throw new Error('找不到那個時間')
}
async function setup(o: { seed?: number; wd?: number; hour?: number; minute?: number; member?: boolean; cash?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK] })
  e.setAi({ useAi: false })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cred', delta: 20000 - e.money.cred }, { op: 'cash', delta: (o.cash ?? 20000) - e.money.cash }])
  expect((await e.world.arrive('b_a', 'F1')).status).toBe('applied')
  if (o.member) {
    e.ledger([{ op: 'meter', kind: 'affinity', key: 'npc_a_ref', set: 45 } as never])
    expect((await e.auction.ref({ house: HOUSE, npc: 'npc_a_ref', pay: 'affinity' })).status).toBe('applied')
  }
  goTo(e, o.wd ?? 4, o.hour ?? 20, o.minute ?? 0)
  return { pinia, e }
}
const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: Component, props: Rec = {}): Promise<string> {
  const r = router()
  await r.push('/')
  await r.isReady()
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  app.use(r)
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')
}
const text = (h: string) => h.replace(/<[^>]+>/g, '')
const tagOf = (html: string, attr: string): string => html.match(new RegExp(`<[^>]*${attr}(?![\\w-])[^>]*>`))?.[0] ?? ''
const after = (html: string, attr: string, n = 500): string => { const i = html.indexOf(attr); return i < 0 ? '' : html.slice(i, i + n) }
const lobby = (pinia: ReturnType<typeof createPinia>) => render(pinia, AuctionLobby, { house: HOUSE })

beforeEach(() => setActivePinia(createPinia()))

describe('1 階段', () => {
  it('階段的顯示跟著時間變：週三還沒公布、週四白天預展中、週四晚上等開槌、週五 19:00 之後開槌中', async () => {
    const { e, pinia } = await setup({ wd: 2, hour: 12 })
    const stage = async () => /data-stage-id="([a-z]+)"/.exec(await lobby(pinia))?.[1]
    expect(await stage()).toBe('unannounced')
    expect(text(after(await lobby(pinia), 'data-stage', 200))).toContain('還沒公布')
    goTo(e, 3, 12)
    expect(await stage()).toBe('preview')
    expect(text(after(await lobby(pinia), 'data-stage', 200))).toContain('預展中')
    goTo(e, 3, 20)
    expect(await stage()).toBe('waiting')
    goTo(e, 4, 19, 30)
    expect(await stage()).toBe('live')
    expect(text(after(await lobby(pinia), 'data-stage', 200))).toContain('開槌中')
    // 開槌與公布的時間是引擎的 sessionOf
    const s = e.auction.session(HOUSE)!
    const h = await lobby(pinia)
    expect(text(after(h, 'data-start'))).toContain(e.auction.at(s.start))
    expect(text(after(h, 'data-catalog-at'))).toContain(e.auction.at(s.catalog_at))
    expect(stageOf(s, s.start - 1).id).toBe('waiting')
    expect(stageOf(s, s.end).id).toBe('ended')
  })
})

describe('2 會員與推薦', () => {
  it('不是會員：進場的按鈕灰掉、原因逐字相同；換了推薦之後亮起來', async () => {
    const { e, pinia } = await setup()
    const blocks = e.auction.enterBlocks(HOUSE)
    expect(blocks.length).toBeGreaterThan(0)
    const why = blocks.join('')
    expect(why).toContain('推薦函')
    let h = await lobby(pinia)
    const go = tagOf(h, 'data-enter-go')
    expect(go).toContain('aria-disabled="true"')
    expect(go).toContain(`title="${why}"`)
    for (const b of blocks) expect(text(h)).toContain(b)
    // 能寫推薦的人與兩種換法
    const refs = e.auction.refOptions(HOUSE)
    expect(refs.map((r) => r.npc)).toEqual(['npc_a_ref'])
    expect(h).toContain('data-ref="npc_a_ref"')
    const aff = tagOf(h, 'data-ref-pay="affinity"')
    expect(aff).toContain('aria-disabled="true"')
    expect(aff).toContain(`title="${e.auction.refBlock({ house: HOUSE, npc: 'npc_a_ref', pay: 'affinity' })}"`)
    // 親密度到 45：靠交情拿推薦函
    e.ledger([{ op: 'meter', kind: 'affinity', key: 'npc_a_ref', set: 45 } as never])
    h = await lobby(pinia)
    expect(tagOf(h, 'data-ref-pay="affinity"')).not.toContain('aria-disabled')
    expect((await e.auction.ref({ house: HOUSE, npc: 'npc_a_ref', pay: 'affinity' })).status).toBe('applied')
    expect(e.auction.member(HOUSE).member).toBe(true)
    h = await lobby(pinia)
    expect(h).toContain('data-is-member')
    expect(tagOf(h, 'data-enter-go')).not.toContain('aria-disabled')
    expect(h).not.toContain('data-enter-block')
  })

  it('停權中：寫到哪一天（引擎的那一句），不列推薦', async () => {
    const { e, pinia } = await setup({ member: true })
    e.commit({ summary: '鬧事', changes: [{ op: 'auction.patch', banned: { [HOUSE]: toMinutes(e.state.time) + 5 * 1440 } } as never] })
    const m = e.auction.member(HOUSE)
    expect(m.member).toBe(false)
    expect(m.banned).toBeDefined()
    const h = await lobby(pinia)
    expect(text(h)).toContain(m.reason!)
    expect(h).not.toContain('data-refs')
  })
})

describe('3 目錄與看貨', () => {
  it('目錄還沒公布：只有公布的時間；公布之後每一欄等於 catalogView；不是會員也看得到', async () => {
    const { e, pinia } = await setup({ wd: 2, hour: 12 })
    const closed = await lobby(pinia)
    expect(closed).toContain('data-catalog-closed')
    expect(closed).not.toContain('data-lot=')
    goTo(e, 3, 12)
    const view = e.auction.catalog(HOUSE)!
    expect(view.open).toBe(true)
    const h = await lobby(pinia)
    expect(e.auction.member(HOUSE).member).toBe(false)
    if (!view.open) return
    expect(view.lots).toHaveLength(5)
    for (const l of view.lots) {
      const chunk = after(h, `data-lot="${l.index}"`, 1400)
      const t = text(chunk)
      expect(t).toContain(l.name)
      expect(t).toContain(l.kind_name)
      expect(t).toContain(`底價 ${fmt(l.reserve)}`)
      expect(t).toContain(`一階 ${fmt(l.step)}`)
      expect(t).toContain(l.cert)
    }
    expect(text(h)).toContain(`${view.bidders.count} 位`)
    for (const n of view.bidders.names) expect(text(h)).toContain(n)
    expect(h).not.toMatch(/fake|budget|mult/)
  })

  it('看貨：零件與義體有按鈕（誰、哪一項基本功、DC、成功率都是引擎的）；看過之後那一件有標示；藝術品沒有看貨', async () => {
    const { e, pinia } = await setup({ wd: 3, hour: 12 })
    const view = e.auction.catalog(HOUSE)!
    if (!view.open) throw new Error('目錄沒有公布')
    const opts = e.auction.inspectOptions(HOUSE)
    expect(opts).toHaveLength(5)
    let h = await lobby(pinia)
    for (const o of opts) {
      const chunk = after(h, `data-lot="${o.index}"`, 1400)
      if (o.skill_name) {
        expect(chunk).toContain('data-lot-look')
        expect(text(chunk)).toContain(`${o.skill_name}・DC ${o.dc}・成功率 ${Math.round((o.success ?? 0) * 100)}%`)
        expect(tagOf(chunk, 'data-lot-look')).not.toContain('aria-disabled')
      } else {
        expect(chunk.slice(0, 1400).split('data-lot=')[1] ?? '').not.toContain('data-lot-look')
      }
    }
    const target = opts.find((o) => o.skill_name)!
    expect((await e.auction.inspect({ house: HOUSE, lot: target.index })).status).toBe('applied')
    const looked = (e.auction.catalog(HOUSE) as { lots: Array<{ index: number; looked?: { result: string; text: string } }> }).lots.find((l) => l.index === target.index)!.looked!
    expect(['ok', 'fake', 'unknown']).toContain(looked.result)
    h = await lobby(pinia)
    const chunk = after(h, `data-lot="${target.index}"`, 1600)
    expect(chunk).toContain('data-lot-looked')
    expect(chunk).toContain(`data-look="${looked.result}"`)
    expect(chunk.split('data-lot-look ')[0]).toBeDefined()
    // 同一件這一場看過就不能再看：引擎的原因
    expect(e.auction.inspectBlock({ house: HOUSE, lot: target.index })).toContain('已經看過了')
    // 預展以外的時間：灰掉，原因是引擎的
    goTo(e, 3, 20)
    const h2 = await lobby(pinia)
    const other = e.auction.inspectOptions(HOUSE).find((o) => o.skill_name && o.index !== target.index)!
    expect(other.can).toBe(false)
    expect(tagOf(after(h2, `data-lot="${other.index}"`, 1600), 'data-lot-look')).toContain('aria-disabled="true"')
  })
})

describe('4 進場與競價', () => {
  it('進場：用現金或帳戶；進場之後是拍賣廳（第一件、現價是底價、沒有人最高）', async () => {
    const { e, pinia } = await setup({ member: true })
    expect(e.auction.enterBlocks(HOUSE)).toEqual([])
    const h = await lobby(pinia)
    expect(h).toContain('data-pay="cash"')
    expect(h).toContain('data-pay="cred"')
    expect((await e.auction.enter(HOUSE, 'cash')).status).toBe('applied')
    const v = e.auction.view()!
    expect(v.lot_no).toBe(1)
    expect(v.holder.id).toBeNull()
    const floor = await render(pinia, AuctionFloor, { view: v })
    expect(text(after(floor, 'data-lot-no', 300))).toContain(`${v.lot_no}／${v.lot_count}`)
    expect(text(after(floor, 'data-price ', 1200))).toContain(fmt(v.price))
    expect(text(after(floor, 'data-lot-name', 200))).toContain(v.lot.name)
    expect(v.price).toBe(v.reserve)
    // 頂端：這一場花了多少、那一種錢還剩多少
    expect(text(after(floor, 'data-spent ', 1200))).toContain(fmt(v.spent))
    expect(text(after(floor, 'data-money ', 1200))).toContain(fmt(v.money))
    expect(floor).toContain('data-money')
    // 外面的對話框換成拍賣廳
    const dlg = await render(pinia, AuctionDialog, { house: HOUSE })
    expect(dlg).toContain('data-floor-top')
    expect(dlg).not.toContain('data-enter-go')
    // 同一場不能再進（已經在裡面）
    expect(e.auction.enterBlocks(HOUSE).join('')).toContain('你已經在拍賣廳裡了')
  })

  it('加價的每個按鈕上的數字等於 bidOptions；錢不夠的那一個灰掉、原因是引擎的', async () => {
    const { e, pinia } = await setup({ member: true })
    // 現金只夠加一階（含佣金）：進場之前照第一件的底價與一階算好（佣金一成，四捨五入；進場之後引擎不收帳）
    const lot0 = (e.auction.catalog(HOUSE) as { lots: Array<{ reserve: number; step: number }> }).lots[0]!
    const one = lot0.reserve + lot0.step
    e.ledger([{ op: 'cash', delta: one + Math.round(one * 0.1) - e.money.cash }])
    await e.auction.enter(HOUSE, 'cash')
    const o2 = e.auction.bidOptions()!
    expect(o2.raise[0]!.total).toBe(e.money.cash)
    expect(o2.raise[0]!.can).toBe(true)
    expect(o2.raise[1]!.can).toBe(false)
    const floor = await render(pinia, AuctionFloor, { view: e.auction.view()! })
    for (const r of o2.raise) {
      const chunk = after(floor, `data-raise="${r.steps}"`, 900)
      expect(text(chunk)).toContain(`加 ${r.steps} 階`)
      expect(text(chunk)).toContain(`→ ${fmt(r.price!)}`)
      expect(text(chunk)).toContain(`含佣金 ${fmt(r.total!)}`)
    }
    expect(tagOf(floor, 'data-raise="1"')).not.toContain('aria-disabled')
    const dis = tagOf(floor, 'data-raise="2"')
    expect(dis).toContain('aria-disabled="true"')
    expect(dis).toContain(`title="${o2.raise[1]!.blocks.join('')}"`)
    expect(o2.raise[1]!.blocks.join('')).toContain('付不起')
    // 沒有人是最高的人時：可以等？不行（只能加價或退出）
    expect(tagOf(floor, 'data-wait')).toContain('aria-disabled="true"')
    expect(e.auction.bidOptions()!.wait.blocks.join('')).toContain('你不是目前最高的出價人')
  })

  it('玩家是最高的人時只有「等」亮著；一回合之後現價與最高的人等於引擎的狀態（另一個引擎照同一份存檔算）', async () => {
    let done = false
    for (let seed = 1; seed <= 40 && !done; seed++) {
      const { e, pinia } = await setup({ seed, member: true })
      await e.auction.enter(HOUSE, 'cash')
      const before = e.save()
      const first = e.auction.view()!
      const g = new Game({ features: allFeatures(), content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
      expect(g.load(before)).toBeNull()
      const draft = bidDraft(g.k, g.state, { act: 'raise', steps: 3 })
      g.commit(draft)
      expect((await e.auction.bid({ act: 'raise', steps: 3 })).status).toBe('applied')
      expect(e.auction.view()).toEqual(auctionView(g.k, g.state))
      expect(e.auction.bidOptions()).toEqual(bidOptions(g.k, g.state))
      const v = e.auction.view()
      if (!v || v.lot_no !== first.lot_no || v.holder.id !== 'pc') continue
      done = true
      const floor = await render(pinia, AuctionFloor, { view: v })
      expect(text(after(floor, 'data-price ', 1200))).toContain(fmt(v.price))
      expect(text(after(floor, 'data-holder ', 200))).toContain('你')
      expect(tagOf(floor, 'data-wait')).not.toContain('aria-disabled')
      for (const n of [1, 2, 3]) expect(tagOf(floor, `data-raise="${n}"`)).toContain('aria-disabled="true"')
      expect(tagOf(floor, 'data-fold')).toContain('aria-disabled="true"')
      expect(e.auction.bidOptions()!.raise[0]!.blocks.join('')).toContain('這一回合只能等')
      // 這一回合每個人的動作照報告的順序一行一行
      const report = e.auction.lastRound()!
      expect(report.action).toBe('auction.bid')
      const lines = [...floor.matchAll(/data-round-line[^>]*>([^<]*)</g)].map((m) => m[1])
      expect(lines).toEqual(report.timeline.map((b) => b.text))
    }
    expect(done).toBe(true)
  })

  it('落槌之後進到下一件；退出的競標者劃掉', async () => {
    const { e, pinia } = await setup({ member: true })
    await e.auction.enter(HOUSE, 'cash')
    expect(e.auction.view()!.lot_no).toBe(1)
    expect((await e.auction.bid({ act: 'fold' })).status).toBe('applied')
    const v = e.auction.view()!
    expect(v.lot_no).toBe(2)
    const last = e.auction.lastRound()!
    expect(last.timeline.some((b) => b.tag === 'auction.hammer')).toBe(true)
    const floor = await render(pinia, AuctionFloor, { view: v })
    expect(text(floor)).toContain('落槌')
    expect(floor).toContain('data-bidders')
    expect(v.bidders.every((b) => floor.includes(`data-bidder="${b.id}"`))).toBe(true)
    for (const b of v.bidders) expect(tagOf(floor, `data-bidder="${b.id}"`)).toContain(`data-out="${b.out ? '1' : '0'}"`)
  })

  it('仿品的記號與競標者的預算不在畫面上；元件與 lib 不讀引擎記在狀態裡的拍賣紀錄', async () => {
    const { e, pinia } = await setup({ member: true })
    await e.auction.enter(HOUSE, 'cash')
    const v = e.auction.view()!
    const floor = await render(pinia, AuctionFloor, { view: v })
    expect(floor).not.toMatch(/fake|budget|mult|interests/)
    expect(JSON.stringify(v)).not.toMatch(/fake|budget|mult/)
    // 看得到的只有 auctionView／bidOptions／catalogView 的欄位
    const raw = (e.state.ext as Rec).auction as { run?: { lots: Array<Rec> } }
    expect(raw.run!.lots.some((l) => 'fake' in l)).toBe(true) // 引擎記著（給引擎算）
    const SOURCES = import.meta.glob('../../src/**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const mine = Object.entries(SOURCES).filter(([p]) => /(AuctionDialog\.vue|AuctionLobby\.vue|AuctionFloor\.vue|AuctionResult\.vue|lib\/auctionView\.ts)$/.test(p))
    expect(mine.length).toBe(5)
    for (const [p, s] of mine) {
      const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code, p).not.toMatch(/ext\.auction|\.ext\b|auctionOf|readRun|\.fake\b|\.mult\b|state\.ext/)
    }
  })
})

describe('5 離場與結算', () => {
  it('離場要確認；離場之後有結算頁、時間是引擎的時間、同一場不能再進', async () => {
    const { e, pinia } = await setup({ member: true })
    await e.auction.enter(HOUSE, 'cash')
    expect((await e.auction.bid({ act: 'fold' })).status).toBe('applied')
    const floor = await render(pinia, AuctionFloor, { view: e.auction.view()! })
    expect(floor).toContain('data-leave')
    expect(floor).not.toContain('data-leave-confirm') // 還沒按：確認框不在
    const cash0 = e.money.cash
    expect((await e.auction.leave()).status).toBe('applied')
    expect(e.auction.view()).toBeNull()
    const s = e.auction.settlement()!
    expect(s.left).toBe(true)
    expect(s.rows).toHaveLength(5)
    expect(s.rows.map((r) => r.lot)).toEqual([0, 1, 2, 3, 4])
    // 時間：結束的那一刻就是引擎現在的時間
    expect(formatTime(s.end)).toBe(formatTime(e.state.time))
    const dlg = await render(pinia, AuctionDialog, { house: HOUSE })
    expect(dlg).toContain('data-result')
    expect(text(after(dlg, 'data-time', 200))).toContain(formatTime(e.state.time))
    expect(text(after(dlg, 'data-won-count', 200))).toContain(`${s.won.length} 件`)
    for (const r of s.rows) expect(dlg).toContain(`data-row="${r.lot}"`)
    // 付的錢等於結算頁寫的（價錢加佣金）
    const paid = s.won.reduce((n, w) => n + w.price + w.fee, 0)
    expect(s.spent).toBe(paid)
    expect(cash0 - e.money.cash).toBe(paid)
    // 同一場不能再進
    const why = e.auction.enterBlocks(HOUSE).join('')
    expect(why).not.toBe('')
    const again = await e.auction.enter(HOUSE, 'cash')
    expect(again.status).toBe('refused')
    expect(again.reason).toBe(why)
    const lobbyAgain = await render(pinia, AuctionResult, { settlement: s })
    expect(lobbyAgain).toContain('data-back')
  })

  it('一場喊完（每一件都落槌）：結算頁列每一件誰得標；玩家得標的清單與總數；得標拿到的句子是引擎的', async () => {
    const { e, pinia } = await setup({ seed: 3, member: true })
    await e.auction.enter(HOUSE, 'cash')
    // 每一件：第一回合加價 3 階，再等到落槌
    for (let guard = 0; guard < 80 && e.auction.view(); guard++) {
      const o = e.auction.bidOptions()!
      const pick = o.raise[2]!.can ? { act: 'raise' as const, steps: 3 } : o.wait.can ? { act: 'wait' as const } : { act: 'fold' as const }
      expect((await e.auction.bid(pick)).status).toBe('applied')
    }
    expect(e.auction.view()).toBeNull()
    const s = e.auction.settlement()!
    expect(s.left).toBe(false)
    expect(s.rows).toHaveLength(5)
    expect(s.won.length).toBeGreaterThan(0)
    const dlg = await render(pinia, AuctionDialog, { house: HOUSE })
    for (const r of s.rows) {
      const t = text(after(dlg, `data-row="${r.lot}"`, 600))
      expect(t).toContain(r.name)
      if (r.result === 'passed') expect(t).toContain('流標')
      else expect(t).toContain(`${r.won ? '你' : r.winnerName}得標`)
    }
    expect(s.gets.length).toBeGreaterThan(0)
    expect(dlg).toContain('data-mine')
    for (const g of s.gets) expect(text(dlg)).toContain(g)
    // 得標的東西真的在背包裡（零件、成品、物品其中之一）
    expect(e.state.inventory.length).toBeGreaterThan(0)
    expect(settlementOf(e.state.reports)!.spent).toBe(s.spent)
    // 進場那一份還沒有結束的報告時：不是結算
    expect(settlementOf(e.state.reports.slice(0, e.state.reports.findIndex((r) => r.action === 'auction.enter') + 1))).toBeNull()
  })
})

describe('6 進行中主畫面別的入口', () => {
  it('進行中「這裡」的其他項目灰掉、原因是引擎的 blockOf；結束之後亮回來', async () => {
    const { e } = await setup({ member: true })
    expect(e.blockOf('commit:craft.assemble')).toBeNull()
    expect(e.auction.here().map((h) => h.id)).toEqual([HOUSE])
    await e.auction.enter(HOUSE, 'cash')
    const why = e.blockOf('commit:craft.assemble')
    expect(why).not.toBeNull()
    expect(why).toContain('拍賣')
    expect(e.blockOf('commit:ability.lesson')).toBe(why)
    expect(e.blockOf('commit:unreg.order')).toBe(why)
    // 引擎在「這裡」列的各項（睡覺……）灰掉的原因也是活動擋住的那一句
    const uses = e.world.grid()!.here.uses
    const blocked = uses.filter((u) => u.block)
    expect(blocked.length).toBeGreaterThan(0)
    for (const u of blocked) expect(u.block).toBe(why)
    // MainScreen 的幾項選單用同一個 blockOf
    expect(mainSrc).toContain("e.blockOf('commit:craft.assemble')")
    expect(mainSrc).toContain("e.blockOf('commit:ability.lesson')")
    expect(mainSrc).toContain("e.blockOf('commit:unreg.order')")
    expect(mainSrc).toContain('auctionOption(')
    await e.auction.leave()
    expect(e.blockOf('commit:craft.assemble')).toBeNull()
  })

  it('示意包的拍賣行載得進引擎：十件拍品、五位競標者、設施、寫推薦的 NPC；目錄的資料沒有問題', () => {
    const g = new Game({ features: allFeatures(), content: [CORE_PACK, demoPack()], fakeProvider: new FakeProvider() })
    const c = g.k.content
    expect(c.list('auction_lot')).toHaveLength(10)
    const kinds = c.list('auction_lot').map((l) => (l as Rec).kind as string)
    for (const k of ['part', 'cyberware', 'art', 'secret']) expect(kinds.filter((x) => x === k)).toHaveLength(2)
    expect(kinds.filter((x) => x === 'contract')).toHaveLength(2)
    expect(c.list('auction_bidder')).toHaveLength(5)
    expect((c.get('auction_house', 'ah_white_hammer') as Rec).weekday).toBe(4)
    expect(c.list('facility_type').some((t) => (t as Rec).auction !== undefined)).toBe(true)
    expect(c.list('npc').some((n) => (n as Rec).auction_ref !== undefined)).toBe(true)
    expect(g.contentWarnings().filter((w) => /auction|拍賣/.test(w))).toEqual([])
    // 預展那一天（週四中午）目錄公布：六件、至少一件契約
    // 契約拍品只抽得到現在交得出去的（要有主角、債務人要是場上的角色；M4 收尾修正批，使用者 2026-11-26 裁決 5）：建一個主角，再讓兩位債務人在場上
    g.newGame({ seed: 5, setup: (state) => buildCreationReport(g.k, state, DRAFT as never) })
    g.commit({ kind: 'system', action: 'test.npcs', location: {}, party: [], timeline: [], changes: [...npcActorOf(g.k, g.state, 'npc_nana'), ...npcActorOf(g.k, g.state, 'npc_jo')], outcome: { result: 'ok', summary: '兩位債務人在場上。' } })
    const now = toMinutes(g.state.time)
    let target = now
    for (let d = g.state.time.day; d <= g.state.time.day + 8; d++) {
      const t = (d - 1) * 1440 + 12 * 60
      if (t >= now && weekdayOf({ day: d, hour: 12, minute: 0 }) === 3) { target = t; break }
    }
    g.commit({ kind: 'system', action: 'test.time', location: {}, party: [], timeline: [], changes: [{ op: 'time', minutes: target - now }], outcome: { result: 'ok', summary: '時間過去。' } })
    const cv = catalogView(g.k, g.state, 'ah_white_hammer')!
    expect(cv.open).toBe(true)
    if (cv.open) {
      expect(cv.lots).toHaveLength(6)
      expect(cv.lots.some((l) => l.kind === 'contract')).toBe(true)
      expect(cv.bidders.count).toBeGreaterThanOrEqual(4)
    }
  })
})
