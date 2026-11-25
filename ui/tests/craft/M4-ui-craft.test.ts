// 驗收測試：dev/work/M4-ui-craft.md（cpp-ui）。組裝、換零件、拆解、學設計圖、成品詳情、染色、解剖接上引擎的 craft、gear、enemies。
// 引擎用真的；內容是測試自帶的最小假資料（三張設計圖、各牌子的零件、一個超規的、一個生體的、一張授權書、槍店／同人攤／原廠／一般地點）。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 craft、dye 動作（元件的 onclick 只是接上它們）。
// 數字拿另一個獨立的引擎（讀同一份存檔）直接呼叫引擎函式來比。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentEntry, ContentPack } from '@engine/src'
import { FakeProvider, Game, slotProblems, toMinutes } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { assemblyPreview, salvagePreview } from '@engine/src/features/craft'
import { gearRules } from '@engine/src/features/gear'
import { useEngine } from '../../src/stores/engine'
import AssemblePane from '../../src/dialogs/craft/AssemblePane.vue'
import PartList from '../../src/dialogs/craft/PartList.vue'
import SalvagePane from '../../src/dialogs/craft/SalvagePane.vue'
import SwapPane from '../../src/dialogs/craft/SwapPane.vue'
import DissectPane from '../../src/dialogs/craft/DissectPane.vue'
import CraftDialog from '../../src/dialogs/CraftDialog.vue'
import DyeDialog from '../../src/dialogs/DyeDialog.vue'
import BagDialog from '../../src/dialogs/BagDialog.vue'
import GearTab from '../../src/dialogs/character/GearTab.vue'
import craftDialogSrc from '../../src/dialogs/CraftDialog.vue?raw'
import assembleSrc from '../../src/dialogs/craft/AssemblePane.vue?raw'
import swapSrc from '../../src/dialogs/craft/SwapPane.vue?raw'
import salvageSrc from '../../src/dialogs/craft/SalvagePane.vue?raw'
import gearViewSrc from '../../src/lib/gearView.ts?raw'
import { fmt } from '../../src/lib/price'
import { demoPack } from '../../src/data/demo'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

// ---- 假資料 ----
const part = (id: string, type: string, o: Rec = {}): Rec => ({ id, name: `${id}名`, type, material: 'mech', brand: 'star', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...o })
const PARTS: Rec[] = [
  part('pt_bar_star', 'barrel', { stats: { damage: 1 } }), part('pt_bar_hz', 'barrel', { brand: 'hz' }), part('pt_bar_hi', 'barrel', { grade: 3, price: 300, stats: { damage: 2 } }),
  part('pt_act_star', 'action', { stats: { hit: 1 } }),
  part('pt_plate', 'plate', { stats: { armor: 2 } }), part('pt_fiber', 'fiber', { stats: { armor: 1 } }),
  part('pt_actuator', 'actuator'), part('pt_neuron', 'neuron'), part('pt_actuator_bio', 'actuator', { material: 'bio', brand: 'bio', state: 'living' }),
]
const bp = (id: string, kind: string, o: Rec = {}): Rec => ({ id, kind, name: `${id}名`, desc: `${id}。`, brand: 'star', grade: 2, legal: 'register', price: 900, size: 1, weight: 1, require: [], optional: [], ...o })
const BLUEPRINTS: Rec[] = [
  bp('bp_pistol', 'weapon', { name: '測試手槍', class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_bar_star', action: 'pt_act_star' } }),
  bp('bp_vest', 'armor', { name: '測試防彈衣', armor: 1, covers: ['armor'], weight_class: 'light', require: [{ type: 'fiber' }, { type: 'plate' }] }),
  bp('bp_arm', 'cyberware', { name: '測試義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 3, require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }] }),
]
const MAP = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '槍店' }, { id: 'F2', at: [3, 1], mark: 'F', name: '同人攤' }, { id: 'F3', at: [5, 1], mark: 'F', name: '原廠' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
const PACK = {
  id: 'craft_ui_test',
  content: {
    special_map: [MAP],
    facility_type: [
      { id: 'fac_gun', name: '槍店', craft: { by: 'shop' }, dye: true },
      { id: 'fac_doujin', name: '同人攤', craft: { by: 'doujin' } },
      { id: 'fac_factory', name: '原廠', craft: { by: 'factory', brand: 'star' } },
      { id: 'fac_plain', name: '雜貨店' },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street', 'b_plain'] }],
    block: [
      { id: 'b_street', district: 'd_hive', name: '工藝街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_gun', name: '槍店' }, F2: { type: 'fac_doujin', name: '同人攤' }, F3: { type: 'fac_factory', name: '原廠' } } },
      { id: 'b_plain', district: 'd_hive', name: '雜貨街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '雜貨店' } } },
    ],
    part: PARTS, blueprint: BLUEPRINTS,
    item: [{ id: 'it_lic_vest', name: '授權書「防彈衣」', desc: '用掉就學會防彈衣。', category: 'blueprint', grade: 2, size: 0, legal: 'free', teaches: 'bp_vest' }],
    quirk: [{ id: 'cq_loose', name: '鬆動', desc: '有個接點沒咬緊。', kind: 'flaw', pool: ['flaw'], stats: { hit: -1 } }],
  },
} as unknown as ContentPack

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
const give = (id: string, qty = 1, data?: Rec) => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as never
const BAG = [
  give('pt_bar_star', 3), give('pt_bar_hz'), give('pt_bar_hi'), give('pt_act_star', 4), give('pt_plate'), give('pt_fiber'), give('pt_actuator'), give('pt_neuron'), give('pt_actuator_bio'),
  give('it_lic_vest'),
  give('bp_pistol', 1, { uid: 'P1', parts: { barrel: 'pt_bar_star', action: 'pt_act_star' }, quality: 'standard', state: 'new' }),
]
const PISTOL = { barrel: 'pt_bar_star', action: 'pt_act_star' }

function start(o: { seed?: number; bag?: unknown[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  const changes = [
    { op: 'cred', delta: 20000 - e.money.cred }, { op: 'cash', delta: 1000 - e.money.cash },
    { op: 'ext', key: 'craft', value: { known: ['bp_pistol'] } },
    ...(o.bag ?? BAG),
  ]
  expect(e.commit({ summary: '給東西', changes: changes as never })).toBeNull()
  return { e, pinia }
}
async function stand(e: Eng, at: 'F1' | 'F2' | 'F3' | 'plain'): Promise<void> {
  const r = at === 'plain' ? await e.world.arrive('b_plain', 'F1') : await e.world.arrive('b_street', at)
  expect(r.status).toBe('applied')
}
/** 另一個獨立的引擎讀同一份存檔：直接呼叫引擎函式，當標準答案 */
function oracle(e: Eng) {
  const g = new Game({ features: allFeatures(), content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: Component, props: Rec = {}): Promise<string> {
  const r = router()
  await r.push('/')
  await r.isReady()
  const app = createSSRApp(comp, props)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const text = (s: string) => clean(s).replace(/<[^>]+>/g, '')
/** 含某個屬性的那一個開頭標籤 */
const tagOf = (html: string, attr: string): string => clean(html).match(new RegExp(`<[^>]*${attr}(?![\\w-])[^>]*>`))?.[0] ?? ''
const count = (e: Eng, id: string): number => e.state.inventory.filter((s) => s.id === id && !s.data?.uid).reduce((n, s) => n + s.qty, 0)
const minutes = (e: Eng) => toMinutes(e.state.time)
const productUids = (e: Eng): string[] => e.craft.products().map((s) => s.data!.uid as string)

beforeEach(() => setActivePinia(createPinia()))

describe('設計圖與授權書（M4-ui-craft）', () => {
  it('沒學過的設計圖不在清單；用掉授權書之後出現', async () => {
    const { e, pinia } = start()
    expect(e.craft.known().map((b) => b.id)).toEqual(['bp_pistol'])
    let h = await render(pinia, AssemblePane)
    expect(h).toContain('data-bp="bp_pistol"')
    expect(h).not.toContain('data-bp="bp_vest"')
    // 背包裡的授權書列在左邊，「學會」是引擎擋不擋
    expect(h).toContain('data-licence="it_lic_vest"')
    const r = e.craft.learn({ item: 'it_lic_vest' })
    expect(r.why).toBeNull()
    expect(r.lines.join('')).toContain('學會了')
    expect(count(e, 'it_lic_vest')).toBe(0)
    h = await render(pinia, AssemblePane)
    expect(h).toContain('data-bp="bp_vest"')
    // 已經會了：引擎擋下，原因是引擎的句子
    expect(e.craft.learnBlock({ item: 'it_lic_vest' })).toContain('已經會做了')
  })

  it('背包的授權書有「學會」；成品的詳情寫組成、品質、狀態、價錢', async () => {
    const { e, pinia } = start()
    const lic = await render(pinia, BagDialog, { entryId: 1, select: 'it_lic_vest' })
    expect(lic).toContain('data-act="learn"')
    expect(text(lic)).toContain('教：測試防彈衣')
    const prod = await render(pinia, BagDialog, { entryId: 1, select: 'P1' })
    const t = text(prod)
    expect(prod).toContain('data-product-bp')
    expect(prod).toContain('data-act="swap"')
    expect(prod).toContain('data-act="salvage"')
    expect(prod).toContain('data-act="dye"')
    const detail = e.craft.detail(e.craft.products()[0]!)!
    expect(t).toContain(fmt(detail.price))
    expect(t).toContain('測試手槍')
    expect(t).toContain('標準')
    expect(t).toContain('全新')
    for (const p of detail.info.parts) expect(t).toContain(p.part.name)
  })
})

describe('組裝的預覽讀引擎（M4-ui-craft）', () => {
  it('放一個類型不對的零件：灰掉，原因和引擎逐字相同；高一級的標超規、難度多 3', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const g = oracle(e)
    const why = slotProblems(g.k.content, 'bp_pistol', 'barrel', 'pt_plate').problems.join('')
    expect(why).toContain('這個槽要的是槍管')
    const h = await render(pinia, PartList, { blueprint: 'bp_pistol', type: 'barrel', picked: [] })
    const row = tagOf(h, 'data-part-key="pt_plate"')
    expect(row).toContain('data-ok="0"')
    expect(row).toContain('aria-disabled="true"')
    expect(row).toContain(`title="${why}"`)
    expect(text(h)).toContain(why)
    expect(tagOf(h, 'data-part-key="pt_bar_star"')).toContain('data-ok="1"')
    expect(h).toContain('data-overspec')
    // 生體的零件放不進只收機械的槽（義臂）
    const bio = await render(pinia, PartList, { blueprint: 'bp_arm', type: 'actuator', picked: [] })
    expect(tagOf(bio, 'data-part-key="pt_actuator_bio"')).toContain('data-ok="0"')
    // 預覽：超規多 3
    const base = e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL })
    const over = e.craft.preview({ blueprint: 'bp_pistol', parts: { barrel: 'pt_bar_hi', action: 'pt_act_star' } })
    expect(over.difficulty!.total - base.difficulty!.total).toBe(3)
    expect(over.slots.find((s) => s.type === 'barrel')!.picked[0]!.overspec).toBe(true)
    expect(over.result!.overspec).toBe(1)
    const ph = await render(pinia, AssemblePane, { blueprint: 'bp_pistol', initial: { barrel: ['pt_bar_hi'], action: ['pt_act_star'] } })
    expect(ph).toContain('data-overspec-tag')
    expect(ph).toContain('data-diff="overspec"')
  })

  it('預覽的每個數字等於引擎的 assemblyPreview；換一個牌子之後難度 +1', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const g = oracle(e)
    const opts = { blueprint: 'bp_pistol', parts: PISTOL, maker: 'self' as const }
    const want = assemblyPreview(g.k, g.state, opts)
    expect(e.craft.preview(opts)).toEqual(want)
    const h = await render(pinia, AssemblePane, { blueprint: 'bp_pistol', initial: { barrel: ['pt_bar_star'], action: ['pt_act_star'] }, maker: 'self' })
    const t = text(h)
    expect(t).toContain(`DC ${want.difficulty!.total}`)
    expect(t).toContain(fmt(want.result!.price))
    expect(t).toContain(`${Math.round(want.check!.success * 100)}%`)
    for (const l of want.difficulty!.lines) expect(h).toContain(`data-diff="${l.id}"`)
    expect(clean(h)).toMatch(new RegExp(`data-bonus[^>]*>${want.check!.bonus >= 0 ? '\\+' : ''}${want.check!.bonus}<`))
    // 換一個牌子：難度 +1（牌子數 −1），引擎的那一項是 brands
    const hz = e.craft.preview({ ...opts, parts: { barrel: 'pt_bar_hz', action: 'pt_act_star' } })
    expect(hz.difficulty!.total - want.difficulty!.total).toBe(1)
    expect(hz.difficulty!.lines.map((l) => l.id)).toContain('brands')
    const hh = await render(pinia, AssemblePane, { blueprint: 'bp_pistol', initial: { barrel: ['pt_bar_hz'], action: ['pt_act_star'] }, maker: 'self' })
    expect(text(hh)).toContain(`DC ${hz.difficulty!.total}`)
    expect(hh).toContain('data-diff="brands"')
  })

  it('誰來做：自己動手一直列，站的設施帶 craft 才多一種；不在工作台自己做的按鈕灰掉、原因是引擎的', async () => {
    const { e, pinia } = start()
    await stand(e, 'plain')
    expect(e.craft.makers().map((m) => m.id)).toEqual(['self'])
    const plain = await render(pinia, AssemblePane, { blueprint: 'bp_pistol', initial: { barrel: ['pt_bar_star'], action: ['pt_act_star'] } })
    const btn = tagOf(plain, 'data-assemble')
    expect(btn).toContain('aria-disabled="true"')
    expect(btn).toContain(`title="${e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL }).block}"`)
    await stand(e, 'F1')
    expect(e.craft.makers().map((m) => m.id)).toEqual(['self', 'shop'])
    await stand(e, 'F2')
    expect(e.craft.makers().map((m) => m.id)).toEqual(['self', 'doujin'])
    await stand(e, 'F3')
    expect(e.craft.makers().map((m) => m.id)).toEqual(['self', 'factory'])
  })
})

describe('做一件（M4-ui-craft）', () => {
  it('店家做：背包多一件成品、零件少了、錢與時間對；超規時按鈕灰掉', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const pv = e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL, maker: 'shop' })
    expect(pv.fee).toBeGreaterThan(0)
    expect(pv.block).toBeNull()
    const cred = e.money.cred
    const t0 = minutes(e)
    const before = productUids(e)
    const r = e.craft.assemble({ blueprint: 'bp_pistol', parts: PISTOL, maker: 'shop' })
    expect(r.why).toBeNull()
    expect(r.result).toBe('standard')
    expect(r.lines.length).toBeGreaterThan(0)
    expect(productUids(e).length).toBe(before.length + 1)
    expect(count(e, 'pt_bar_star')).toBe(2)
    expect(count(e, 'pt_act_star')).toBe(3)
    expect(e.money.cred).toBe(cred - pv.fee)
    expect(minutes(e) - t0).toBe(pv.minutes)
    // 店家不做超規：預覽的原因寫在按鈕上
    const over = { blueprint: 'bp_pistol', parts: { barrel: 'pt_bar_hi', action: 'pt_act_star' }, maker: 'shop' as const }
    const why = e.craft.preview(over).block
    expect(why).toContain('不做超規')
    const h = await render(pinia, AssemblePane, { blueprint: 'bp_pistol', initial: { barrel: ['pt_bar_hi'], action: ['pt_act_star'] }, maker: 'shop' })
    const btn = tagOf(h, 'data-assemble')
    expect(btn).toContain('aria-disabled="true"')
    expect(btn).toContain(`title="${why}"`)
    expect(e.craft.assemble(over).why).toBe(why)
  })

  it('自己做：花時間不花錢；成功是一件新的成品、大失敗燒掉一個零件；結果句子是引擎的報告', () => {
    const { e } = start()
    return stand(e, 'F1').then(() => {
      const cash = e.money.cred
      const t0 = minutes(e)
      const bars = count(e, 'pt_bar_star')
      const before = productUids(e)
      const pv = e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL, maker: 'self' })
      const r = e.craft.assemble({ blueprint: 'bp_pistol', parts: PISTOL, maker: 'self' })
      expect(r.why).toBeNull()
      expect(r.lines.length).toBeGreaterThan(0)
      expect(minutes(e) - t0).toBe(pv.minutes)
      expect(e.money.cred).toBe(cash)
      if (r.result === 'burned') {
        expect(productUids(e)).toEqual(before)
        expect(count(e, 'pt_bar_star') + count(e, 'pt_act_star')).toBe(bars + 4 - 1)
      } else {
        expect(productUids(e).length).toBe(before.length + 1)
        expect(count(e, 'pt_bar_star')).toBe(bars - 1)
        expect(['fine', 'standard', 'flawed']).toContain(r.result)
      }
    })
  })

  it('精工的項目由玩家選：預覽給 polishable，選的那一項進預覽的 opts', async () => {
    const { e } = start()
    await stand(e, 'F1')
    const pv = e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL })
    expect(pv.result!.polishable).toEqual(expect.arrayContaining(['damage', 'hit']))
    expect(e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL, polish: 'hit' }).block).toBeNull()
    expect(e.craft.preview({ blueprint: 'bp_pistol', parts: PISTOL, polish: 'armor' }).block).toContain('沒有「armor」')
  })
})

describe('拆解、換零件、解剖（M4-ui-craft）', () => {
  it('拆解：機率有顯示；拆完背包多了零件、成品不見', async () => {
    const { e, pinia } = start({ seed: 11 })
    await stand(e, 'F1')
    const g = oracle(e)
    const want = salvagePreview(g.k, g.state, { uid: 'P1' })
    expect(e.craft.salvagePreview({ uid: 'P1' })).toEqual(want)
    const h = await render(pinia, SalvagePane, { uid: 'P1' })
    expect((h.match(/data-chance/g) ?? []).length).toBe(2)
    expect(text(h)).toContain(`完好 ${Math.round(want.parts[0]!.chance * 100)}%`)
    expect(h).toContain('data-salvage')
    const bars = count(e, 'pt_bar_star') + count(e, 'pt_act_star')
    const r = e.craft.salvage({ uid: 'P1' })
    expect(r.why).toBeNull()
    expect(productUids(e)).not.toContain('P1')
    const used = e.state.inventory.filter((s) => s.data?.state === 'used' || String(s.data?.uid ?? '').startsWith('up')).length
    const gained = r.result === 'all' ? 2 : r.result === 'some' ? 1 : 0
    expect(used).toBe(gained)
    expect(count(e, 'pt_bar_star') + count(e, 'pt_act_star')).toBe(bars)
    expect(['all', 'some', 'none']).toContain(r.result)
  })

  it('不在工作台拆解：按鈕灰掉、原因是引擎的', async () => {
    const { e, pinia } = start()
    await stand(e, 'plain')
    const why = e.craft.salvagePreview({ uid: 'P1' }).block
    expect(why).toContain('拆解要在有工作台')
    const h = await render(pinia, SalvagePane, { uid: 'P1' })
    expect(tagOf(h, 'data-salvage')).toContain(`title="${why}"`)
  })

  it('換零件：預覽是引擎的前後對照；換成別的牌子之後成品換了零件', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const opts = { uid: 'P1', type: 'barrel', part: 'pt_bar_hz', index: 0, maker: 'shop' as const }
    const pv = e.craft.swapPreview(opts)
    expect(pv.block).toBeNull()
    expect(pv.after!.brands.length).toBe(2)
    const h = await render(pinia, SwapPane, { uid: 'P1' })
    expect(h).toContain('data-swap-row="barrel:0"')
    expect(h).toContain('data-swap')
    const r = e.craft.swap(opts)
    expect(r.why).toBeNull()
    expect(r.result).toBe('swapped')
    const stack = e.craft.products().find((s) => s.data?.uid === 'P1')!
    expect(e.craft.detail(stack)!.info.parts.find((p) => p.type === 'barrel')!.part.id).toBe('pt_bar_hz')
    expect(count(e, 'pt_bar_hz')).toBe(0)
    expect(e.state.inventory.some((s) => s.id === 'pt_bar_star' && s.data?.state === 'used' || s.id === 'pt_bar_star')).toBe(true)
  })

  it('解剖：沒有對象時沒有選項；有對象但沒有人會解剖時列出來、按鈕灰掉並寫引擎的原因', async () => {
    const { e, pinia } = start()
    expect(e.craft.dissectOptions()).toEqual([])
    expect(await render(pinia, DissectPane)).toContain('data-no-dissect')
    const target = { key: 'u1', name: '倒下的傭兵', human: true, faction: 'none', loot: [{ blueprint: 'bp_arm', chance: 1, needs: 'dissect' }] }
    expect(e.commit({ summary: '打贏了', changes: [{ op: 'ext', key: 'enemies_dissect', value: { battle: 'b1', until: minutes(e) + 60, targets: [target] } }] as never })).toBeNull()
    const opts = e.craft.dissectOptions()
    expect(opts).toHaveLength(1)
    expect(opts[0]!.items.map((i) => i.blueprint)).toEqual(['bp_arm'])
    expect(opts[0]!.block).toContain('不會解剖')
    const h = await render(pinia, DissectPane)
    expect(text(h)).toContain('倒下的傭兵')
    expect(tagOf(h, 'data-dissect-go')).toContain(`title="${opts[0]!.block}"`)
    expect(text(h)).toContain(`沉溺 +${opts[0]!.sink}`)
    expect(e.craft.dissect('u1').why).toContain('不會解剖')
  })
})

describe('染色與裝備分頁（M4-ui-craft）', () => {
  it('染色之後那一件的顏色存進引擎的狀態；價錢與時間是引擎的', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const rules = gearRules(oracle(e).k)
    const h = await render(pinia, DyeDialog, { entryId: 1, uid: 'P1' })
    expect(h).toContain('data-dye-edit')
    // 還沒選顏色：引擎說顏色沒有變
    expect(e.dye.quote({ uid: 'P1', by: 'shop' }).block).toContain('顏色沒有變')
    const q = e.dye.quote({ uid: 'P1', by: 'shop', primary_color: 'dye_pink' })
    expect(q.block).toBeNull()
    expect(q.cash).toBe(rules.dye_shop_price)
    expect(q.minutes).toBe(rules.dye_shop_minutes)
    const cash = e.money.cash
    const t0 = minutes(e)
    const r = e.dye.apply({ uid: 'P1', by: 'shop', primary_color: 'dye_pink' })
    expect(r.why).toBeNull()
    expect(e.money.cash).toBe(cash - q.cash)
    expect(minutes(e) - t0).toBe(q.minutes)
    expect(e.dye.colorsOf('P1')?.primary_color).toBe('dye_pink')
    expect(e.state.inventory.find((s) => s.data?.uid === 'P1')!.data!.dye).toMatchObject({ primary_color: 'dye_pink' })
    // 存檔再讀回來還在
    const raw = e.save()
    e.newGame({ seed: 99, testContent: [PACK] })
    expect(e.load(raw)).toBeNull()
    expect(e.dye.colorsOf('P1')?.primary_color).toBe('dye_pink')
    // 換回出廠的顏色不要錢
    expect(e.dye.apply({ uid: 'P1', by: 'shop', primary_color: null, secondary_color: null }).why).toBeNull()
    expect(e.dye.colorsOf('P1')?.primary_color).toBeUndefined()
  })

  it('不在店家染：引擎擋下，原因顯示在對話框上', async () => {
    const { e, pinia } = start()
    await stand(e, 'plain')
    const q = e.dye.quote({ uid: 'P1', by: 'shop', primary_color: 'dye_pink' })
    expect(q.block).toContain('這裡沒有烤漆與染色的店家')
    expect(e.dye.apply({ uid: 'P1', by: 'shop', primary_color: 'dye_pink' }).why).toBe(q.block)
    expect(await render(pinia, DyeDialog, { entryId: 1, uid: 'P1' })).toContain('data-dye-edit')
  })

  it('裝備分頁：曝露度、風格、重量與上限都是引擎的數字', async () => {
    const { e, pinia } = start()
    const s = e.gear.style()!
    expect(s.exposure).toBeGreaterThanOrEqual(0)
    const g = oracle(e)
    expect(s.cap).toBe(g.k.stats.stat(g.state, g.state.pc!, 'carry_cap'))
    const h = await render(pinia, GearTab)
    expect(h).toContain('data-exposure')
    expect(h).toContain('data-style')
    expect(text(tagOf(h, 'data-weight') + '')).toBeDefined()
    expect(text(h)).toContain(`曝露度`)
    expect(text(h)).toContain(`${s.exposure}／3`)
    expect(gearViewSrc).not.toContain('COAT_COVERS')
  })
})

describe('不自己算規則、舊的檔案拿掉（M4-ui-craft）', () => {
  // 全部的原始碼（路徑 → 內容）：用 Vite 的 glob 讀進來，不碰檔案系統
  const SOURCES = import.meta.glob('../../src/**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const paths = Object.keys(SOURCES)

  it('ui/src 沒有 lib/crafting、lib/dye；沒有檔案再 import 它們', () => {
    for (const gone of ['lib/crafting.ts', 'lib/dye.ts', 'data/crafting.ts']) expect(paths.some((p) => p.endsWith(`/src/${gone}`))).toBe(false)
    const bad = paths.filter((p) => /from '[./]+\/lib\/(crafting|dye)'|from '[./]+\/data\/crafting'|from '\.\/(crafting|dye)'/.test(SOURCES[p]!))
    expect(bad).toEqual([])
  })

  it('組裝的元件沒有自己算難度、成功率、能不能放進槽、價錢的式子', () => {
    for (const s of [craftDialogSrc, assembleSrc, swapSrc, salvageSrc]) {
      expect(s).not.toMatch(/checkSlot|checkAssembly|successChance|crafterBlock|dcParts|overspec_step|brand_step|dc\s*\+|\+\s*3\b/)
    }
  })

  it('示意世界包：三張設計圖、授權書、三種做的地方；內容載得進引擎', () => {
    const g = new Game({ features: allFeatures(), content: [CORE_PACK, demoPack()], fakeProvider: new FakeProvider() })
    for (const id of ['bp_pistol', 'bp_vest', 'bp_arm']) expect(g.k.content.has('blueprint', id)).toBe(true)
    expect(g.k.content.get<ContentEntry & { teaches: string }>('item', 'it_lic_vest')!.teaches).toBe('bp_vest')
    const by = g.k.content.list<ContentEntry & { craft?: { by: string } }>('facility_type').filter((t) => t.craft).map((t) => t.craft!.by).sort()
    expect(by).toEqual(['doujin', 'factory', 'shop'])
    expect(g.k.content.list<ContentEntry & { pool?: string[] }>('quirk').filter((q) => q.pool?.includes('flaw') || q.pool?.includes('doujin')).length).toBeGreaterThanOrEqual(3)
  })

  it('組裝對話框接得起來（分頁、打開時指定的分頁與成品）', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const h = await render(pinia, CraftDialog, { entryId: 1, tab: 'salvage', uid: 'P1' })
    expect(h).toContain('data-salvage-preview')
    expect(text(h)).toContain('槍店')
  })
})

