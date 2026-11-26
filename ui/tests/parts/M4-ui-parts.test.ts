// 驗收測試：dev/work/M4-ui-parts.md（cpp-ui）。未登錄零件的畫面：委託的報酬欄與結算、背包與組裝認得內嵌的零件、委託台（訂做與取貨）、勢力的窗口、學工藝、設定的 partAi 與「用規則代替」。
// 引擎用真的（AI 關著；開著的只有 partAi 那一條）；內容是測試自帶的最小假資料：一個委託台、一座小街、一張小規則表、預設清單、三筆怪癖、一位老師，委託借用 tests/commission/fixtures 的中間人與三階段副本。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 unreg、training 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature, Kernel } from '@engine/src'
import { FakeProvider, Game, UNREG_STACK_ID } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { assemblyPreview } from '@engine/src/features/craft'
import { useEngine } from '../../src/stores/engine'
import { PACK as CM_PACK, OFFER_A, DRAFT } from '../commission/fixtures'
import TakePanel from '../../src/components/commission/TakePanel.vue'
import CommissionScreen from '../../src/screens/CommissionScreen.vue'
import BagDialog from '../../src/dialogs/BagDialog.vue'
import PartList from '../../src/dialogs/craft/PartList.vue'
import PartOrderDialog from '../../src/dialogs/PartOrderDialog.vue'
import RelationsDialog from '../../src/dialogs/RelationsDialog.vue'
import SettingsDialog from '../../src/dialogs/SettingsDialog.vue'
import PendingParts from '../../src/components/PendingParts.vue'
import PartWindow from '../../src/components/PartWindow.vue'
import TeachPanel from '../../src/components/TeachPanel.vue'
import mainSrc from '../../src/screens/MainScreen.vue?raw'
import { aiSettingsFromUi, uiFromAiSettings } from '../../src/lib/engineView'
import { deskOption, daysLeft, moveWant, partStatRows, toggleWant } from '../../src/lib/partsView'
import { fmt } from '../../src/lib/price'
import { demoPack } from '../../src/data/demo'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

// ---- 假資料 ----
const MAP = {
  id: 'm_parts', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5], layout: ['##########', '#F.F.....#', 'E.1....2.E', '#........#', '##########'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '同人社團的攤位' }, { id: 'F2', at: [3, 1], mark: 'F', name: '雜貨店' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
const opt = (id: string, name: string, put: string, key: string, amount: number, cost: number, max: number, o: Rec = {}): Rec => ({ id, name, put, key, amount, cost, max, ...o })
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']
const EFFECT_PLATE = { kind: 'part_unreg', source: 'reward', type: 'plate', grade: 3, brand: 'doujin', from: '委託的報酬' }
const EXTRA = { by: 'unreg', label: '一件未登錄零件（板材，III級）', cash_pct: 0.6, effects: [EFFECT_PLATE] }
const OFFER_X = { ...OFFER_A, id: 'of_ui_x', title: '附一件零件的案子', reward: 600, commission: { ...OFFER_A.commission, id: 'cm_ui_x' }, extra: EXTRA }
const PROVIDER_X: Feature = {
  id: 'ui_offers_x',
  install(k: Kernel) { k.hooks.on('fixer.offers', 'ui_offers_x', ({ fixer }) => (fixer.id === 'fx_ui' ? structuredClone([OFFER_X]) as never : undefined)) },
}
const PACK: ContentPack = {
  id: 'parts_ui_test',
  content: {
    special_map: [MAP],
    facility_type: [{ id: 'fac_t_desk', name: '同人社團的委託台', unreg_desk: { faction: 'doujin', brand: 'doujin' } }, { id: 'fac_t_plain', name: '雜貨店' }],
    district: [{ id: 'd_p', name: '零件區', grade: 1, price_mult: 1, blocks: ['b_p', 'b_p2'] }],
    block: [
      { id: 'b_p', district: 'd_p', name: '零件街', kind: 'block', map: 'm_parts', exits: {}, facilities: { F1: { type: 'fac_t_desk', name: '同人社團的攤位' }, F2: { type: 'fac_t_plain', name: '雜貨店' } } },
      { id: 'b_p2', district: 'd_p', name: '空街', kind: 'block', map: 'm_parts', exits: {}, facilities: { F1: { type: 'fac_t_plain', name: '雜貨店' } } },
    ],
    part: [
      { id: 'pt_p_plate', name: '板材「老兵」', type: 'plate', material: 'mech', brand: 'star', grade: 2, price: 300, legal: 'free', cells: 1, stats: { armor: 1 }, weight: 1, size: 1, state: 'new' },
      { id: 'pt_p_fiber', name: '纖維「帆布」', type: 'fiber', material: 'mech', brand: 'star', grade: 2, price: 200, legal: 'free', cells: 1, stats: { armor: 1 }, weight: 1, size: 1, state: 'new' },
    ],
    blueprint: [{ id: 'bp_p_vest', kind: 'armor', name: '測試防彈衣', desc: '測試。', brand: 'star', grade: 3, legal: 'register', price: 800, size: 1, weight: 1, armor: 1, covers: ['armor'], weight_class: 'light', require: [{ type: 'fiber' }, { type: 'plate' }], optional: [], stock: { fiber: 'pt_p_fiber', plate: 'pt_p_plate' } }],
    unreg_rule: [{
      id: 'default',
      options: {
        plate: [opt('plate_armor', '護甲', 'stats', 'armor', 1, 0.5, 3), opt('plate_light', '減重', 'stats', 'weight', -0.2, 0.5, 2)],
        skin: [opt('skin_social', '社交親和', 'affinity', 'social', 1, 0.5, 3), opt('skin_style', '風格', 'stats', 'style', 1, 0.5, 3)],
      },
      sources: { reward: { chance: 1 }, order: { days: 3 } },
    }],
    unreg_preset: [
      { id: 'up_t_1', type: 'plate', name: '拼貼', desc: '用幾塊舊板材拼起來的零件。', quirk_text: '放久了會自己發出細微的聲音。' },
      { id: 'up_t_2', type: 'plate', name: '老牆', desc: '拆自一面舊牆的板材，又厚又重。', quirk_text: '摸起來總是比室溫涼一點。' },
      { id: 'up_t_3', type: 'skin', name: '薄霧', desc: '顏色很淡的外皮，不太引人注意。', quirk_text: '碰到熱的東西會暫時變得有點透明。' },
    ],
    quirk: [
      { id: 'uq_t_a', name: '會作響', desc: '它在口袋裡會輕輕作響。', kind: 'quirk', pool: ['doujin'] },
      { id: 'uq_t_b', name: '夜光', desc: '天黑之後接縫會透出淡淡的光。', kind: 'quirk', pool: ['doujin'] },
      { id: 'uq_t_c', name: '偏硬', desc: '手感比同類的硬一些。', kind: 'quirk', pool: ['doujin'] },
    ],
    npc: [{ id: 'npc_p_tutor', name: '阿鉚', kind: 'citizen', age: 47, guard: 12, wealth: 1, haunts: [{ district: 'd_p', block: 'b_p', time: ALL }], tutor: { skills: ['mechanics'], sink: 1, where: '零件街' } }],
  } as unknown as ContentPack['content'],
}

async function setup(o: { seed?: number; ai?: boolean; at?: 'F1' | 'F2' | 'street' | 'none'; offers?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [CM_PACK, PACK], testFeatures: o.offers ? [PROVIDER_X] : [] })
  e.setAi({ useAi: o.ai === true })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cred', delta: 9000 - e.money.cred }, { op: 'cash', delta: 9000 - e.money.cash }])
  if (o.at !== 'none') expect((await e.world.arrive('b_p', o.at === 'street' ? undefined : o.at ?? 'F1')).status).toBe('applied')
  return { pinia, e }
}
const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: Component, props: Rec = {}, route = '/'): Promise<string> {
  const r = router()
  await r.push(route)
  await r.isReady()
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  app.use(r)
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')
}
const text = (h: string) => h.replace(/<[^>]+>/g, '')
const tagOf = (html: string, attr: string): string => html.match(new RegExp(`<[^>]*${attr}(?![\\w-])[^>]*>`))?.[0] ?? ''
/** 含某個屬性的那個標籤開始往後的一段 HTML（取裡面的字） */
const after = (html: string, attr: string, n = 500): string => { const i = html.indexOf(attr); return i < 0 ? '' : html.slice(i, i + n) }
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const gift = (type: string, grade: number, o: Rec = {}) => ({ op: 'unreg.pending', add: { source: 'gift', type, grade, from: '測試的禮物', ...o } }) as never
const unregStacks = (e: Eng) => e.state.inventory.filter((s) => s.id === UNREG_STACK_ID)
const oracle = (e: Eng) => {
  const g = new Game({ features: allFeatures(), content: [CORE_PACK, CM_PACK, PACK], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}

beforeEach(() => setActivePinia(createPinia()))

describe('1 報酬欄與結算', () => {
  it('簡報的報酬欄多一行；現金的數字就是引擎給的，畫面不另外算', async () => {
    const { e, pinia } = await setup({ offers: true })
    const board = e.fixer.board('fx_ui')
    const row = board.offers.find((o) => o.id === 'of_ui_x')!
    expect(row.brief.extra_label).toBe(EXTRA.label)
    expect(row.offer.reward).toBe(600)
    const h = await render(pinia, TakePanel, { fixerId: 'fx_ui' })
    expect(h).toContain('data-extra-card')
    expect(h).toContain('data-extra')
    expect(text(after(h, 'data-extra '))).toContain(EXTRA.label)
    expect(text(h)).toContain(fmt(600))
  })

  it('做完之後：結算頁列引擎記的 extra 句子；下一步零件進背包，等著交貨是空的', async () => {
    const { e, pinia } = await setup({ offers: true, at: 'none' })
    expect((await e.fixer.accept({ id: 'of_ui_x', fixer: 'fx_ui' }, 'cash')).status).toBe('applied')
    expect((await e.fixer.go('of_ui_x')).status).toBe('applied')
    for (let i = 0; i < 3; i++) {
      expect((await e.commission.chooseFace('meat')).status).toBe('applied')
      expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
      expect(e.world.walk([4, 2]).ok).toBe(true)
    }
    const job = e.fixer.settledJob('cm_ui_x')!
    expect(job.status).toBe('done')
    expect(job.payout!.extra!.length).toBeGreaterThan(0)
    const settle = await render(pinia, CommissionScreen, {}, '/commission?settled=of_ui_x')
    expect(settle).toContain('data-settle-extra')
    expect(text(settle)).toContain(job.payout!.extra![0]!)
    await flush()
    expect(e.unreg.pending()).toEqual([])
    const stacks = unregStacks(e)
    expect(stacks).toHaveLength(1)
    expect((stacks[0]!.data!.part as Rec).from).toBe('委託的報酬')
  })
})

describe('2 背包與組裝', () => {
  it('背包那一件顯示的每一條屬性等於引擎那一筆 InlinePart 的 stats 與 affinity；名字、說明、怪癖、來源、未登錄', async () => {
    const { e, pinia } = await setup()
    expect(e.commit({ summary: '給兩件', changes: [gift('plate', 3, { want: ['plate_armor'] }), gift('skin', 3, { want: ['skin_social', 'skin_style'] })] })).toBeNull()
    await flush()
    expect(e.unreg.pending()).toEqual([])
    const stacks = unregStacks(e)
    expect(stacks).toHaveLength(2)
    for (const stack of stacks) {
      const part = stack.data!.part as { uid: string; name: string; desc: string; stats: Record<string, number>; affinity?: Record<string, number>; quirk?: string; quirk_text?: string; from: string }
      const h = await render(pinia, BagDialog, { select: part.uid })
      const t = text(h)
      expect(t).toContain(part.name)
      expect(t).toContain(part.desc)
      expect(h).toContain('data-part-tag')
      expect(t).toContain('未登錄')
      expect(text(after(h, 'data-part-from'))).toContain(part.from)
      const rows = partStatRows({ stats: part.stats, affinity: part.affinity ?? {} })
      expect(rows.length).toBeGreaterThan(0)
      const shown = [...h.matchAll(/data-stat-key="([^"]+)"[^>]*><span[^>]*>([^<]*)<\/span><b[^>]*>([^<]*)<\/b>/g)].map((m) => [m[1], m[3]])
      expect(shown).toEqual(rows.map((r) => [r.key, r.text]))
      for (const [k, v] of Object.entries(part.stats)) if (v !== 0) expect(rows.find((r) => r.key === k)!.text).toBe(v > 0 ? `+${v}` : String(v))
      for (const [k, v] of Object.entries(part.affinity ?? {})) expect(rows.find((r) => r.key === `affinity.${k}`)!.text).toBe(`+${v}`)
      if (part.quirk) {
        expect(h).toContain('data-part-quirk')
        expect(t).toContain(part.quirk_text!)
      }
    }
    // 皮膚那一件帶親和
    const skin = stacks.map((s) => s.data!.part as { stats: Record<string, number>; affinity?: Record<string, number> }).find((p) => p.affinity?.social)
    expect(skin).toBeDefined()
  })

  it('組裝的零件清單列得出它；放進槽之後預覽的數字等於 assemblyPreview', async () => {
    const { e, pinia } = await setup()
    expect(e.commit({ summary: '給一件', changes: [gift('plate', 3, { want: ['plate_armor'] }), { op: 'ext', key: 'craft', value: { known: ['bp_p_vest'] } } as never, { op: 'item', id: 'pt_p_fiber', qty: 1 } as never] })).toBeNull()
    await flush()
    const uid = (unregStacks(e)[0]!.data as { uid: string }).uid
    expect(e.craft.parts().some((p) => p.key === uid && p.part.unreg === true)).toBe(true)
    const list = await render(pinia, PartList, { blueprint: 'bp_p_vest', type: 'plate', picked: [] })
    expect(tagOf(list, `data-part-key="${uid}"`)).toContain('data-ok="1"')
    expect(text(list)).toContain('未登錄')
    const opts = { blueprint: 'bp_p_vest', parts: { plate: uid, fiber: 'pt_p_fiber' }, maker: 'self' } as never
    const g = oracle(e)
    expect(e.craft.preview(opts)).toEqual(assemblyPreview(g.k, g.state, opts))
    // 有放進去：預覽的數值帶著那一件的護甲
    const part = unregStacks(e)[0]!.data!.part as { stats: Record<string, number> }
    const pv = e.craft.preview(opts)
    expect(pv.result!.stats.armor).toBe((part.stats.armor ?? 0) + 1) // 那一件的護甲加纖維的 1
    expect(pv.slots.find((sl) => sl.type === 'plate')!.picked).toHaveLength(1)
  })

  it('成品的零件標「二手」讀 productOf 的零件狀態（part_states）', async () => {
    const { e, pinia } = await setup()
    expect(e.commit({ summary: '給一件成品', changes: [{ op: 'item', id: 'bp_p_vest', qty: 1, data: { uid: 'V1', parts: { fiber: 'pt_p_fiber', plate: 'pt_p_plate' }, part_states: { plate: ['used'] } } } as never] })).toBeNull()
    const h = await render(pinia, BagDialog, { select: 'V1' })
    const plateRow = h.slice(h.indexOf('data-part-id="pt_p_plate"'), h.indexOf('data-part-id="pt_p_plate"') + 400)
    expect(text(plateRow)).toContain('二手')
    const fiberRow = h.slice(h.indexOf('data-part-id="pt_p_fiber"'), h.indexOf('data-part-id="pt_p_fiber"') + 400)
    expect(text(fiberRow.split('</div>')[0]!)).not.toContain('二手')
  })
})

describe('3 委託台', () => {
  it('不在委託台：沒有 desk，下單按鈕灰掉、原因是引擎的那一句', async () => {
    const { e, pinia } = await setup({ at: 'F2' })
    expect(e.unreg.desk()).toBeNull()
    const view = e.unreg.orderView()
    expect(view.blocks).toContain('要在同人社團的委託台才能訂做。')
    const h = await render(pinia, PartOrderDialog)
    const go = tagOf(h, 'data-order-go')
    expect(go).toContain('aria-disabled="true"')
    expect(go).toContain(`title="${e.unreg.orderBlock({ type: view.types[0]!.id, grade: 1 })}"`)
    expect(h).toContain('data-order-block')
    // 這裡的選項：站上委託台才列（MainScreen 讀 e.unreg.desk()）
    expect(mainSrc).toContain('e.unreg.desk()')
    expect(await setup({ at: 'F1' }).then(({ e: e2 }) => e2.unreg.desk()?.name)).toBe('同人社團的委託台')
  })

  it('站在委託台上：價錢與天數是 orderOptions 的；錢不夠時按鈕灰掉、原因逐字相同', async () => {
    const { e, pinia } = await setup()
    const view = e.unreg.orderView()
    expect(view.desk).not.toBeNull()
    expect(view.blocks).toEqual([])
    const h = await render(pinia, PartOrderDialog)
    for (const g of view.grades) expect(text(h)).toContain(fmt(g.price))
    expect(h).toContain('data-order-form')
    // 現金歸零：第 I 級的原因是引擎的那一句
    e.ledger([{ op: 'cash', delta: -e.money.cash }])
    const poor = e.unreg.orderView()
    const why = poor.grades[0]!.block!
    expect(why).toContain('現金晶片不夠')
    const type = poor.types[0]!.id
    expect(e.unreg.orderBlock({ type, grade: 1 })).toBe(why)
    const h2 = await render(pinia, PartOrderDialog)
    const go = tagOf(h2, 'data-order-go')
    expect(go).toContain('aria-disabled="true"')
    expect(go).toContain(`title="${why}"`)
    expect(text(h2)).toContain(why)
    const refused = await e.unreg.order({ type, grade: 1 })
    expect(refused.status).toBe('refused')
    expect(refused.reason).toBe(why)
  })

  it('下單：對話框有那一張訂單與「還要 3 天」；沒滿天數取不了；過三天回來可以取貨，取貨之後背包多一件', async () => {
    const { e, pinia } = await setup()
    const view = e.unreg.orderView()
    const price = view.grades[1]!.price
    const cash = e.money.cash
    const r = await e.unreg.order({ type: 'plate', grade: 2, want: ['plate_armor'], request: '想要低調一點' })
    expect(r.status).toBe('applied')
    expect(e.money.cash).toBe(cash - price)
    const pend = e.unreg.pending()
    expect(pend).toHaveLength(1)
    expect(pend[0]!.order).toBe(true)
    expect(pend[0]!.block).toBe('還要等 3 天。')
    const h = await render(pinia, PartOrderDialog)
    expect(h).toContain('data-orders')
    expect(text(after(h, 'data-eta'))).toContain('還要 3 天')
    expect(daysLeft(pend[0]!.readyAt!, e.unreg.now())).toBe(3)
    // 取貨按鈕灰掉、原因是引擎的
    expect(tagOf(h, 'data-pickup')).toContain('aria-disabled="true"')
    // 同時只能有一張：再下一張被擋下（引擎的那一句）
    expect(e.unreg.orderBlock({ type: 'plate', grade: 1 })).toContain('你已經有 1 張訂單在等了')
    // 離開委託台、過三天：時間到了還是要回委託台取貨
    e.ledger([{ op: 'time', minutes: 3 * 1440 }])
    await flush()
    expect(e.unreg.pending()).toHaveLength(1) // 訂做的不會自動交貨
    expect(e.unreg.deliverBlock(pend[0]!.id)).toBeNull()
    const ready = await render(pinia, PartOrderDialog)
    expect(ready).toContain('data-ready')
    expect(tagOf(ready, 'data-pickup')).not.toContain('aria-disabled')
    const got = await e.unreg.deliver(pend[0]!.id)
    expect(got.status).toBe('applied')
    expect(e.unreg.pending()).toEqual([])
    expect(unregStacks(e)).toHaveLength(1)
    const part = unregStacks(e)[0]!.data!.part as { desc: string; from: string }
    expect(part.from).toContain('訂做')
  })

  it('離開委託台之後不能取貨（引擎的那一句）；好感夠時有兩筆怪癖二選一；備註上限 80 字', async () => {
    const { e, pinia } = await setup()
    expect((await e.unreg.order({ type: 'plate', grade: 1 })).status).toBe('applied')
    const id = e.unreg.pending()[0]!.id
    e.ledger([{ op: 'time', minutes: 3 * 1440 }])
    expect((await e.world.arrive('b_p', 'F2')).status).toBe('applied')
    expect(e.unreg.deliverBlock(id)).toBe('要到同人社團的委託台取貨。')
    // 怪癖二選一：同人眾好感到門檻
    expect((await e.world.arrive('b_p', 'F1')).status).toBe('applied')
    expect(e.unreg.orderView().quirk_pick).toBe(false)
    expect(await render(pinia, PartOrderDialog)).not.toContain('data-quirk-pick')
    e.ledger([{ op: 'meter', kind: 'favor', key: 'doujin', set: 100 } as never])
    const v = e.unreg.orderView()
    expect(v.quirk_pick).toBe(true)
    const first = v.types[0]! // 對話框預設選第一個類型
    expect(first.quirks).toHaveLength(2)
    const plate = v.types.find((t) => t.id === 'plate')!
    expect(plate.quirks).toHaveLength(2)
    const h = await render(pinia, PartOrderDialog)
    expect(h).toContain('data-quirk-pick')
    for (const q of first.quirks) expect(text(h)).toContain(q.desc)
    expect(h).toContain('maxlength="80"')
    // 挑的怪癖進訂單的框架
    expect(e.unreg.orderBlock({ type: 'plate', grade: 1, quirk: plate.quirks[0]!.id })).toContain('同時最多') // 已經有一張在等了：被擋下的是張數，不是怪癖
    expect(e.unreg.orderBlock({ type: 'plate', grade: 1, quirk: 'uq_t_zzz' })).toContain('那個怪癖不在這一次的候選裡')
  })

  it('方向的排序是勾的順序（toggleWant、moveWant 只動字串；怎麼分預算是引擎的）', () => {
    expect(toggleWant([], 'a')).toEqual(['a'])
    expect(toggleWant(['a', 'b'], 'a')).toEqual(['b'])
    expect(moveWant(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveWant(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    const opt = deskOption({ name: '攤位' }, () => undefined, '被擋下的一句')
    expect(opt).toMatchObject({ id: 'unreg.desk', reason: '被擋下的一句' })
  })
})

describe('4 勢力的窗口', () => {
  async function withFavor() {
    const s = await setup()
    e0(s.e).commit({ summary: '好感與人情', changes: [{ op: 'meter', kind: 'favor', key: 'doujin', set: 100 }, { op: 'favor.add', dir: 'owed_to_pc', who: 'doujin', size: 'big' }] as never })
    return s
  }
  const e0 = (e: Eng) => e
  it('條件不成立的勢力灰掉並有原因（引擎的 blocks）；成立的亮著', async () => {
    const { e, pinia } = await withFavor()
    const rows = e.unreg.windowOptions()
    const mine = rows.find((r) => r.faction === 'doujin')!
    expect(mine.blocks).toEqual([])
    const other = rows.find((r) => r.faction === 'eden')!
    expect(other.blocks.length).toBeGreaterThan(0)
    const h = await render(pinia, PartWindow)
    expect(h).toContain('data-windows')
    expect(tagOf(h, 'data-window="doujin"')).not.toContain('is-unavailable')
    expect(tagOf(h, 'data-window="eden"')).toContain('is-unavailable')
    const idx = h.indexOf('data-window="eden"')
    const chunk = h.slice(idx, h.indexOf('data-window=', idx + 10) > 0 ? h.indexOf('data-window=', idx + 10) : undefined)
    for (const b of other.blocks) expect(text(chunk)).toContain(b)
    // 關係對話框帶著它
    expect(await render(pinia, RelationsDialog)).toContain('data-windows')
  })

  it('換了之後大人情少一個、同一個勢力不能再換；零件進背包', async () => {
    const { e } = await withFavor()
    const owed = () => e.people.favors().owed_to_pc.filter((f) => f.size === 'big').length
    expect(owed()).toBe(1)
    const input = { faction: 'doujin', type: 'plate', want: ['plate_armor'] }
    expect(e.unreg.windowBlock(input)).toBeNull()
    expect((await e.unreg.window(input)).status).toBe('applied')
    expect(owed()).toBe(0)
    const again = e.unreg.windowOptions().find((r) => r.faction === 'doujin')!
    expect(again.used).toBe(true)
    expect(again.blocks.join('')).toContain('已經用過了')
    expect(e.unreg.windowBlock(input)).toContain('已經用過了')
    const refused = await e.unreg.window(input)
    expect(refused.status).toBe('refused')
    await flush()
    expect(unregStacks(e)).toHaveLength(1)
    expect((unregStacks(e)[0]!.data!.part as { from: string }).from).toContain('固定窗口')
  })
})

describe('5 學工藝', () => {
  it('學費等於 tutorOptions 的數字；上完兩個時段之後是 1 級；2 級之後這一段不見', async () => {
    const { e, pinia } = await setup({ at: 'street' })
    expect((await e.people.meet('npc_p_tutor')).status).toBe('applied')
    const row = e.training.tutorOptions('npc_p_tutor').find((r) => r.skill === 'mechanics')!
    expect(row.ok).toBe(true)
    const h = await render(pinia, TeachPanel, { npc: 'npc_p_tutor', tutor: true })
    expect(h).toContain('data-tutor="mechanics"')
    expect(text(after(h, 'data-tuition'))).toContain(fmt(row.price))
    expect(text(h)).toContain('沉溺 +1')
    expect(row.level).toBe(1)
    const lv = () => e.state.actors[e.state.pc!]!.skills.mechanics ?? 0
    expect(lv()).toBe(0)
    for (let i = 0; i < row.need; i++) expect(e.training.tutorLesson({ npc: 'npc_p_tutor', skill: 'mechanics' })).toBeNull()
    expect(lv()).toBe(1)
    const next = e.training.tutorOptions('npc_p_tutor').find((r) => r.skill === 'mechanics')!
    expect(next.level).toBe(2)
    expect(next.price).not.toBe(row.price)
    for (let i = 0; i < next.need; i++) expect(e.training.tutorLesson({ npc: 'npc_p_tutor', skill: 'mechanics' })).toBeNull()
    expect(lv()).toBe(2)
    expect(e.training.tutorOptions('npc_p_tutor')).toEqual([])
    const done = await render(pinia, TeachPanel, { npc: 'npc_p_tutor', tutor: true })
    expect(done).not.toContain('data-tutor=')
  })
})

describe('6 設定與交貨', () => {
  it('設定頁有 partAi 的開關；轉成引擎的 partAi，存回來還原', async () => {
    expect(aiSettingsFromUi({ partAi: false }).partAi).toBe(false)
    expect(aiSettingsFromUi({ partAi: true }).partAi).toBe(true)
    expect(aiSettingsFromUi({}).partAi).toBeUndefined()
    expect(uiFromAiSettings({ partAi: false }).partAi).toBe(false)
    expect(uiFromAiSettings({ partAi: 1 }).partAi).toBe(true)
    const { pinia } = await setup()
    expect(text(await render(pinia, SettingsDialog, { tab: 'ai' }))).toContain('未登錄零件的名字交給 AI')
  })

  it('AI 開著時交貨走任務鏈（design 那一步做完）；partAi 關掉就直接交、每一步都略過', async () => {
    const on = await setup({ ai: true })
    expect(on.e.commit({ summary: '給一件', changes: [gift('plate', 2)] })).toBeNull()
    await flush()
    expect(unregStacks(on.e)).toHaveLength(1)
    const ids = on.e.chainSteps.map((s) => s.id)
    expect(ids).toContain('design')
    expect(on.e.chainSteps.find((s) => s.id === 'design')!.status).toBe('done')
    const off = await setup({ ai: true })
    off.e.setAi({ useAi: true, partAi: false })
    expect(off.e.commit({ summary: '給一件', changes: [gift('plate', 2)] })).toBeNull()
    await flush()
    expect(unregStacks(off.e)).toHaveLength(1)
    expect(off.e.chainSteps.some((s) => s.id === 'design')).toBe(false)
  })

  it('停在半路的那一筆不再自動碰；畫面提供「用規則代替」，按下去就交了', async () => {
    const { e, pinia } = await setup()
    expect(e.commit({ summary: '給一件', changes: [gift('plate', 2)] })).toBeNull()
    const id = e.unreg.pending()[0]!.id
    e.partPaused = [id]
    await flush()
    expect(e.unreg.pending()).toHaveLength(1) // 自動交貨沒有碰它
    const h = await render(pinia, PendingParts)
    expect(h).toContain('data-paused')
    expect(h).toContain('data-rules')
    expect((await e.unreg.deliver(id, { autoRules: true })).status).toBe('applied')
    expect(e.unreg.pending()).toEqual([])
    expect(e.partPaused).toEqual([])
  })

  it('每一步之後可以交的會自動交（被活動擋住的留到下一步）', async () => {
    const { e } = await setup()
    expect(e.commit({ summary: '給一件', changes: [gift('skin', 1)] })).toBeNull()
    expect(e.unreg.pending()).toHaveLength(1)
    await flush()
    expect(e.unreg.pending()).toEqual([])
    expect(unregStacks(e)).toHaveLength(1)
  })
})

describe('7 示意世界包與不自己算規則', () => {
  it('示意包載得進引擎：規則表、預設清單、怪癖、委託台、老師都在，沒有資料問題', () => {
    const g = new Game({ features: allFeatures(), content: [CORE_PACK, demoPack()], fakeProvider: new FakeProvider() })
    const c = g.k.content
    expect(c.list('unreg_preset')).toHaveLength(6)
    expect(c.list('quirk').filter((q) => (q as Rec).pool && ((q as Rec).pool as string[]).includes('doujin')).length).toBeGreaterThanOrEqual(3)
    expect(c.list('facility_type').some((t) => (t as Rec).unreg_desk !== undefined)).toBe(true)
    expect((c.get('npc', 'npc_arbo') as Rec).tutor).toBeDefined()
    const rule = c.get('unreg_rule', 'default') as unknown as Rec & { options: Record<string, unknown[]>; sources: { reward: { chance: number } } }
    expect(Object.keys(rule.options).sort()).toEqual(['barrel', 'plate', 'skin'])
    for (const k of Object.keys(rule.options)) expect(rule.options[k]!.length).toBeGreaterThanOrEqual(2)
    expect(rule.sources.reward.chance).toBe(1)
    expect(g.contentWarnings().filter((w) => /unreg|auction|tutor/.test(w))).toEqual([])
  })

  it('示意局的開局：同人眾好感 100 與一個大人情（窗口開得起來）、常客的親密度 45', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    expect(e.newGame({ seed: 3, draft: DRAFT as never })).toEqual([])
    e.setAi({ useAi: false })
    const mine = e.unreg.windowOptions().find((r) => r.faction === 'doujin')!
    expect(mine.blocks).toEqual([])
    expect(e.people.favors().owed_to_pc.filter((f) => f.size === 'big' && f.who === 'doujin')).toHaveLength(1)
    expect(e.state.meters.affinity!.npc_regular).toBe(45)
    expect(e.auction.member('ah_white_hammer').reason).toContain('推薦函')
    expect(e.auction.refOptions('ah_white_hammer')[0]!.pays.find((p) => p.pay === 'affinity')!.ok).toBe(true)
  })

  it('ui/src 沒有自己算未登錄零件價錢、學費、等級上限的式子；元件不讀引擎的狀態', () => {
    const SOURCES = import.meta.glob('../../src/**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const mine = Object.entries(SOURCES).filter(([p]) => /(partsView|PendingParts|PartWindow|PartOrderDialog)\.(ts|vue)$/.test(p))
    expect(mine.length).toBe(4)
    for (const [p, s] of mine) {
      const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code, p).not.toMatch(/price\s*\*|\*\s*(price|0\.5|0\.6|1\.5)|cash_pct|price_mult|grade_cap|tuition|\.price\s*[-+*/]|rules\.price/)
      expect(code, p).not.toMatch(/state\.ext|\.ext\./)
    }
  })
})
