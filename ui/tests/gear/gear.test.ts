// 驗收測試：dev/work/M1b-ui-gear.md（cpp-ui）。「裝備」分頁與背包讀引擎。
// 內容用測試自帶的最小假資料，接在核心的內容後面（store 的 newGame 有一個只給測試用的 testContent）。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）；數字拿另一個獨立的引擎（讀同一份存檔）直接呼叫來比。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, ItemStack } from '@engine/src'
import { FakeProvider, Game } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { armorOf, concealment, equipBlock, gearOf, quickCapacity, scanFinds, weaponOf } from '@engine/src/features/gear'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import GearTab from '../../src/dialogs/character/GearTab.vue'
import BagDialog from '../../src/dialogs/BagDialog.vue'
import gearTabSrc from '../../src/dialogs/character/GearTab.vue?raw'
import bagSrc from '../../src/dialogs/BagDialog.vue?raw'
import viewSrc from '../../src/lib/gearView.ts?raw'
import { BAG_FILTERS, bagEntries, gearGroups, quickCells, quickPut, weaponLines } from '../../src/lib/gearView'
import type { BagFilterId } from '../../src/lib/gearView'

const bp = (id: string, kind: string, more: Record<string, unknown>) => ({ id, kind, name: `${id}名`, desc: `${id}。`, brand: 'starbelle', grade: 1, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...more })
const part = (id: string, type: string, grade: number, stats: Record<string, number> = {}) => ({ id, name: `${id}名`, type, material: 'mech', brand: 'starbelle', grade, price: 100, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new' })
const PACK: ContentPack = {
  id: 'ui_gear_test',
  content: {
    blueprint: [
      bp('bp_pistol', 'weapon', { name: '測試手槍', grade: 3, class: 'pistol', carry: 'side', require: [{ type: 'barrel' }] }),
      bp('bp_suit', 'armor', { name: '測試連身服', grade: 2, armor: 1, covers: ['upper', 'lower'], weight_class: 'medium', require: [{ type: 'fiber' }], quick: 2 }),
      bp('bp_coat', 'armor', { name: '測試長外套', armor: 0, covers: ['outer'], weight_class: 'light', require: [{ type: 'fiber' }], conceal: 5 }),
      bp('bp_heavy', 'armor', { name: '測試重甲', armor: 1, covers: ['armor'], weight_class: 'heavy', require: [{ type: 'plate' }] }),
    ],
    part: [part('pt_barrel', 'barrel', 3, { damage: 3, range_far: 1 }), part('pt_fiber', 'fiber', 2, { armor: 2 }), part('pt_plate', 'plate', 3, { armor: 3 })],
    item: [
      { id: 'it_medgel', name: '測試凝膠', desc: '一管凝膠。', category: 'consumable', grade: 1, size: 0, legal: 'free', use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 8 }] } },
      { id: 'it_stim', name: '測試興奮劑', desc: '一支興奮劑。', category: 'consumable', grade: 2, size: 0, legal: 'free', use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 4 }] } },
    ],
  },
}
const made = (uid: string, blueprint: string, parts: Record<string, string | string[]> = {}): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts } })
const INVENTORY: ItemStack[] = [
  made('g1', 'bp_pistol', { barrel: 'pt_barrel' }), made('g2', 'bp_suit', { fiber: 'pt_fiber' }), made('g3', 'bp_coat', { fiber: 'pt_fiber' }), made('g4', 'bp_heavy', { plate: 'pt_plate' }),
  { id: 'pt_barrel', qty: 1 }, { id: 'pt_fiber', qty: 2 }, { id: 'pt_plate', qty: 1 },
  { id: 'bp_pistol', qty: 1 },
  { id: 'it_medgel', qty: 6 }, { id: 'it_stim', qty: 1 },
]
const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: 7, testContent: [PACK] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '放進背包。', changes: INVENTORY.map((s) => ({ op: 'item', id: s.id, qty: s.qty, ...(s.data ? { data: s.data } : {}) })) })).toBeNull()
  return { pinia, e }
}
/** 另一個獨立的引擎讀同一份存檔：直接呼叫引擎函式，當標準答案。 */
function oracle(e: ReturnType<typeof useEngine>) {
  const g = new Game({ features: allFeatures(), content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, props)
  app.use(pinia)
  return renderToString(app)
}
const pc = (e: ReturnType<typeof useEngine>) => e.state.pc!
const gearNow = (e: ReturnType<typeof useEngine>) => gearOf(e.state, pc(e))
const cellOf = (e: ReturnType<typeof useEngine>, group: 'worn' | 'acc' | 'carry', slot: string) => gearGroups(e.gear.look, e.gear.inventory(), e.gear.of()).find((g) => g.id === group)!.cells.find((c) => c.slot === slot)!

describe('裝備分頁讀引擎（M1b-ui-gear）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('穿上一件之後：那一格顯示它、引擎的狀態裡也有；存檔再讀回來還在', () => {
    const { e } = setup()
    expect(cellOf(e, 'carry', 'side').item).toBeNull()
    expect(e.gear.equip('g1')).toBeNull()
    expect(cellOf(e, 'carry', 'side').item?.name).toBe('測試手槍')
    expect(gearNow(e).carry.side).toBe('g1')
    const raw = e.save()
    e.newGame({ seed: 99, testContent: [PACK] })
    expect(gearNow(e).carry).toEqual({})
    expect(e.load(raw)).toBeNull()
    expect(gearNow(e).carry.side).toBe('g1')
    expect(cellOf(e, 'carry', 'side').item?.name).toBe('測試手槍')
    // 脫下也是引擎的報告
    expect(e.gear.unequip('g1')).toBeNull()
    expect(gearNow(e).carry).toEqual({})
  })

  it('引擎說不能穿的東西：按鈕是灰的，title 是引擎回的那一句，畫面上沒有自己拼的原因', async () => {
    const { pinia, e } = setup()
    expect(e.gear.equip('g3')).toBeNull() // 外套
    const why = equipBlock(oracle(e).k, oracle(e).state, pc(e), 'g4')
    expect(why).toBe('穿重甲的時候不能再穿外套，先把外套脫掉。')
    expect(e.gear.equipBlock('g4')).toBe(why)
    // 裝備分頁：點護甲格，列出背包裡放得進來的重甲，灰掉、title 是那一句
    const tab = await html(pinia, GearTab, { select: { group: 'worn', slot: 'armor' } })
    expect(tab).toContain(`title="${why}"`)
    expect(tab).toMatch(/aria-disabled="true"[^>]*title="穿重甲/)
    // 背包：選到重甲時「裝上」是灰的，title 一樣
    const bag = await html(pinia, BagDialog, { entryId: 1, select: 'g4' })
    expect(bag).toContain('data-detail')
    expect(bag).toMatch(new RegExp(`aria-disabled="true"[^>]*title="${why}"[^>]*data-act="equip"|title="${why}"[^>]*data-act="equip"`))
    const before = gearNow(e)
    expect(e.gear.equip('g4')).toBe(why)
    expect(gearNow(e)).toEqual(before)
    // 畫面的程式裡沒有這句原因
    for (const src of [gearTabSrc, bagSrc]) expect(src).not.toContain('不能再穿外套')
  })

  it('連身的衣服佔兩格、兩格都顯示它；被外套蓋住的格子有「被外套蓋住」', async () => {
    const { pinia, e } = setup()
    expect(e.gear.equip('g2')).toBeNull()
    expect(cellOf(e, 'worn', 'upper').item?.name).toBe('測試連身服')
    expect(cellOf(e, 'worn', 'lower').item?.name).toBe('測試連身服')
    expect(gearNow(e).worn).toEqual({ upper: 'g2', lower: 'g2' })
    expect(e.gear.equip('g3')).toBeNull()
    expect(cellOf(e, 'worn', 'upper').covered).toBe(false)
    expect(await html(pinia, GearTab)).not.toContain('被外套蓋住')
    expect(e.gear.setCoat('closed')).toBeNull()
    expect(gearNow(e).coat).toBe('closed')
    expect(cellOf(e, 'worn', 'upper').covered).toBe(true)
    expect(await html(pinia, GearTab)).toContain('被外套蓋住')
  })

  it('快取格：放滿之後再放被引擎擋下、提示列是引擎的原因；用了幾格的數字跟著變', async () => {
    const { pinia, e } = setup()
    const cap = () => quickCapacity(oracle(e).k, oracle(e).state, gearNow(e))
    expect(e.gear.quickCapacity()).toBe(cap())
    const put = (id: string) => {
      const g = e.gear.of()
      const idx = quickCells(e.gear.look, g, e.gear.quickCapacity()).find((c) => !c.item)?.index ?? e.gear.quickCapacity()
      return e.gear.setQuick(quickPut(g, idx, id))
    }
    expect(await html(pinia, GearTab)).toMatch(/data-quick-count[^>]*>0／2</)
    expect(put('it_medgel')).toBeNull()
    expect(await html(pinia, GearTab)).toMatch(/data-quick-count[^>]*>1／2</)
    expect(put('it_stim')).toBeNull()
    expect(await html(pinia, GearTab)).toMatch(/data-quick-count[^>]*>2／2</)
    const before = gearNow(e).quick
    expect(put('it_medgel')).toBe('快取格只有 2 格。')
    expect(gearNow(e).quick).toEqual(before)
    // 穿上多給格子的衣服之後，上限（引擎的答案）跟著變，又放得進去了
    expect(e.gear.equip('g2')).toBeNull()
    expect(e.gear.quickCapacity()).toBe(cap())
    expect(e.gear.quickCapacity()).toBeGreaterThan(2)
    expect(await html(pinia, GearTab)).toMatch(new RegExp(`data-quick-count[^>]*>2／${e.gear.quickCapacity()}<`))
    expect(put('it_medgel')).toBeNull()
  })

  it('護甲、藏匿量、掃描的結果和直接呼叫引擎函式的結果一樣', async () => {
    const { pinia, e } = setup()
    for (const uid of ['g1', 'g2', 'g3']) expect(e.gear.equip(uid)).toBeNull()
    for (const coat of ['open', 'closed'] as const) {
      expect(e.gear.setCoat(coat)).toBeNull()
      const g = oracle(e)
      expect(e.gear.armor()).toBe(armorOf(g.k, g.state, pc(e)))
      expect(e.gear.concealment()).toEqual(concealment(g.k, g.state, pc(e)))
      for (const n of [0, 1, 2, 3]) expect(e.gear.scanFinds(n)).toEqual(scanFinds(g.k, g.state, pc(e), n))
      const page = await html(pinia, GearTab)
      expect(page).toMatch(new RegExp(`data-armor[^>]*>${armorOf(g.k, g.state, pc(e))}<`))
      expect(page).toMatch(new RegExp(`data-conceal[^>]*>${concealment(g.k, g.state, pc(e)).capacity}<`))
    }
    // 掃描：預設強度 2，手槍（大小 1）掃得到就寫「會被發現」
    const g = oracle(e)
    const found = scanFinds(g.k, g.state, pc(e), 2).includes('g1')
    expect(await html(pinia, GearTab)).toContain(found ? '會被發現' : '掃不到')
  })

  it('背包的篩選只留那一類；詳情裡武器的命中、骰數、射程和 weaponOf 一樣', async () => {
    const { pinia, e } = setup()
    const look = e.gear.look
    const inv = e.gear.inventory()
    const only = (f: BagFilterId) => bagEntries(look, inv, f).map((x) => x.key).sort()
    expect(only('all')).toHaveLength(inv.length)
    expect(only('gear')).toEqual(['g1', 'g2', 'g3', 'g4'])
    expect(only('part')).toEqual(['pt_barrel', 'pt_fiber', 'pt_plate'])
    expect(only('blueprint')).toEqual(['bp_pistol'])
    expect(only('consumable')).toEqual(['it_medgel', 'it_stim'])
    for (const f of ['cyberware', 'material', 'cargo', 'misc'] as const) expect(only(f)).toEqual([])
    expect(BAG_FILTERS.map((f) => f.id)).toEqual(['all', 'gear', 'cyberware', 'part', 'blueprint', 'consumable', 'material', 'cargo', 'misc'])
    // 全部加起來沒有漏
    const sum = BAG_FILTERS.filter((f) => f.id !== 'all').reduce((n, f) => n + only(f.id).length, 0)
    expect(sum).toBe(inv.length)
    // 武器的數字
    const g = oracle(e)
    const w = weaponOf(g.k, g.state, pc(e), 'g1')
    expect(e.gear.weapon('g1')).toEqual(w)
    const lines = Object.fromEntries(weaponLines(w).map((l) => [l.label, l.value]))
    expect(lines['命中']).toBe(`${w.hit >= 0 ? '+' : ''}${w.hit}`)
    expect(lines['骰數']).toContain(`${w.dice}d6`)
    expect(lines['射程']).toBe(`${w.range[0]}～${w.range[1]}`)
    // 畫面：選到手槍，詳情寫出三個數字；武器以外的沒有這幾列
    const page = await html(pinia, BagDialog, { entryId: 1, select: 'g1' })
    for (const l of weaponLines(w)) expect(page).toContain(l.value)
    expect(page).toMatch(/data-stat="命中"/)
    expect(page).toContain('測試手槍')
    expect(page).toContain('data-part')
    // 設計圖與零件沒有「裝上」按鈕；分頁的空類別有說明
    expect(bagEntries(look, inv, 'part').every((x) => x.what === null)).toBe(true)
  })

  it('戰鬥中整頁唯讀：原因是引擎的 blockOf，提交被擋、狀態不變', async () => {
    const { pinia, e } = setup()
    e.startBattle(BATTLE_SETUPS.encounter(1))
    const why = e.blockOf('commit:gear.equip')
    expect(why).toBeTruthy()
    expect(e.gear.lock()).toBe(why)
    const before = gearNow(e)
    expect(e.gear.equip('g1')).toBe(why)
    expect(e.gear.setCoat('closed')).toBe(why)
    expect(gearNow(e)).toEqual(before)
    expect(await html(pinia, GearTab, { select: { group: 'carry', slot: 'side' } })).toMatch(new RegExp(`data-lock[^>]*>${why}<`))
    expect(await html(pinia, BagDialog, { entryId: 1 })).toMatch(new RegExp(`data-lock[^>]*>${why}<`))
  })
})

describe('原始碼與版面', () => {
  const FILES: Record<string, string> = { 'dialogs/character/GearTab.vue': gearTabSrc, 'dialogs/BagDialog.vue': bagSrc, 'lib/gearView.ts': viewSrc }

  it('元件與 gearView 沒有護甲、藏匿、容量的算式，也不用假資料', () => {
    for (const [f, src] of Object.entries(FILES)) {
      expect(src, f).not.toMatch(/data\/items/)
      expect(src, f).not.toMatch(/stores\/game/)
      expect(src, f).not.toMatch(/useGame/)
      expect(src, f).not.toMatch(/QUICK_(BASE|MAX)/)
      expect(src, f).not.toMatch(/\b(armor|conceal\w*|quickCap\w*)\s*[+\-*/]=?\s*[\w(]/i)
      expect(src, f).not.toMatch(/armor_body|weight_class|conceal_add/)
    }
  })

  it('手機寬度下裝備格是三欄', () => {
    const css = gearTabSrc
    expect(css).toMatch(/@media \(max-width: 720px\)\s*\{[^}]*\.eqgrid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
