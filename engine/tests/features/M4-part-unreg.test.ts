// 驗收測試：dev/work/M4-part-unreg.md（cpp-feature）。規格：CRAFTING 11.1 節、5.5 節、第 2.1 節；AI_TASKS 3.20 節第 1、4、6 步；dev/adr/0019 第十七節與 P66～P68、P74、P75。
// 內容一律用測試自帶的最小假資料：一張小的 unreg_rule（外皮三個選項、槍管三個選項、板材兩個選項〔護甲 max: 2、max_at: { 1: 1, 2: 1 }〕）、
// 四筆 quirk（兩筆沒有 stats、一筆 stats: { hit: -1 } 而且 applies: ['weapon']、一筆帶會被篩選關掉的 tags）、四筆 unreg_preset、一張手槍的設計圖與零件、一間收零件的店。
// 骰子：組裝的檢定用 vi.spyOn(Rng.prototype, 'next') 固定（只包住「建草稿」那一步）。框架與預設文字的亂數從（種子、流水號、用途）導出，不經過存檔亂數的游標。

import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ContentPack, Feature, ReportDraft } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { ActionBlocked, Rng, UNREG_STACK_ID, effectCtx, partOf, productOf, stackPart, toMinutes } from '../../src'
import { assembleDraft, craftFeature } from '../../src/features/craft'
import { characterFeature } from '../../src/features/character'
import { gearFeature } from '../../src/features/gear'
import { checkout, quote, sellBlock, shopView, stockOf, tradeFeature } from '../../src/features/trade'
import {
  DEFAULT_UNREG_RULES, deliverBlock, deliverDraft, frameOf, frameProblems, frameView, pendingParts, readyParts, textProblems, unregFeature, unregOf, unregRuleProblems, unregRules,
} from '../../src/features/unreg'
import { worldFeature } from '../../src/features/world'
import { makeGame } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'mechanics', name: '機械', attr: 'tech', desc: '機械。' },
  { id: 'cyberware', name: '義體學', attr: 'tech', desc: '義體學。' }, { id: 'medicine', name: '醫療', attr: 'tech', desc: '醫療。' },
]
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: ['concealable'], attr: 'reflex', skill: 'firearms' }]

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS: Rec[] = [
  part('pt_barrel', 'barrel', { price: 200, stats: { hit: 1, damage: 2 } }),
  part('pt_action', 'action', { price: 200, stats: { damage: 1 } }),
]
const BLUEPRINTS: Rec[] = [{
  id: 'bp_pistol', kind: 'weapon', name: '手槍', desc: '手槍。', brand: 'hz', grade: 2, legal: 'register', price: 100, size: 1, weight: 1, class: 'pistol', carry: 'side',
  require: [{ type: 'barrel' }, { type: 'action' }], optional: [], stock: { barrel: 'pt_barrel', action: 'pt_action' },
}]
const QUIRKS: Rec[] = [
  { id: 'qk_plain1', name: '話多', desc: '它在口袋裡會輕輕作響。', kind: 'quirk', pool: ['doujin'] },
  { id: 'qk_plain2', name: '偏黃', desc: '用久了表面會泛黃。', kind: 'quirk', pool: ['doujin'] },
  { id: 'qk_costly', name: '鬆動的準星', desc: '準星有點鬆。', kind: 'quirk', pool: ['doujin'], applies: ['weapon'], stats: { hit: -1 } },
  { id: 'qk_gross', name: '黏手', desc: '握起來黏黏的。', kind: 'quirk', pool: ['doujin'], tags: ['gross'] },
  { id: 'qk_flaw', name: '一般的瑕疵', desc: '二手的瑕疵。', kind: 'flaw', pool: ['flaw'] },
]
const PRESETS: Rec[] = [
  { id: 'pr_barrel_2a', type: 'barrel', grade: 2, name: '鐵牙', desc: '一根舊舊的槍管。', quirk_text: '扣下扳機總是慢半拍。' },
  { id: 'pr_barrel_2b', type: 'barrel', grade: 2, name: '蛇信', desc: '一根細長的槍管。' },
  { id: 'pr_barrel_any', type: 'barrel', name: '老砲', desc: '一根很老的槍管。' },
  { id: 'pr_skin_3', type: 'skin', grade: 3, name: '霧面', desc: '一層霧面的外皮。' },
]
const OPTIONS = {
  skin: [
    { id: 'sk_style', name: '風格', put: 'stats', key: 'style', amount: 1, cost: 0.5, max: 3, tags: ['風格'] },
    { id: 'sk_social', name: '社交親和', put: 'affinity', key: 'social', amount: 1, cost: 0.5, max: 3, tags: ['社交'] },
    { id: 'sk_scan', name: '防掃描', put: 'stats', key: 'scan_guard', amount: 1, cost: 0.5, max: 2, tags: ['隱蔽'] },
  ],
  barrel: [
    { id: 'br_damage', name: '傷害', put: 'stats', key: 'damage', amount: 1, cost: 1, max: 2, tags: ['傷害'] },
    { id: 'br_hit', name: '命中', put: 'stats', key: 'hit', amount: 1, cost: 0.5, max: 3, tags: ['準度'] },
    { id: 'br_pierce', name: '穿甲', put: 'stats', key: 'pierce', amount: 1, cost: 0.5, max: 2, grade_min: 2 },
  ],
  plate: [
    { id: 'pl_armor', name: '護甲', put: 'stats', key: 'armor', amount: 1, cost: 0.5, max: 2, max_at: { 1: 1, 2: 1 }, tags: ['armor'] },
    { id: 'pl_light', name: '減重', put: 'stats', key: 'weight', amount: -1, cost: 0.5, max: 2 },
  ],
}

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    skill: structuredClone(SKILLS), weapon_class: structuredClone(WEAPONS),
    special_map: [structuredClone(MAP) as unknown as Rec],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_shops'] }],
    block: [{ id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '雜貨店' } } }],
    facility_type: [{ id: 'fac_plain', name: '雜貨店' }],
    blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS), quirk: structuredClone(QUIRKS),
    unreg_rule: [{ id: 'default', options: structuredClone(OPTIONS) }],
    unreg_preset: structuredClone(PRESETS),
    shop_type: [{ id: 't_gun', name: '槍店', catalog: ['weapon'], buys: ['weapon', 'part', 'armor'], grade_max: 3, cash: true, shop_mult: 1, temper: 0 }],
    shop: [{ id: 's_gun', type: 't_gun', name: '槍店的櫃檯', district: 'd_hive', fixed_products: ['bp_pistol'] }],
  }
  patch(c)
  return { id: 'unreg_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：條件 at_home（旗標 home_level 是住處的等級）。 */
const HOME: Feature = {
  id: 'home_stub',
  install(k) {
    k.conditions.register<Condition & { level_min?: number }>({
      kind: 'at_home', owner: 'home_stub', validate: () => [],
      test: (c, { state }) => typeof state.flags.home_level === 'number' && state.flags.home_level >= (c.level_min ?? 0),
    })
  },
}

const make = (p: ContentPack = pack(), seed = 7) => {
  const { game } = makeGame({
    features: [characterFeature, worldFeature, HOME, gearFeature, tradeFeature, craftFeature, unregFeature], content: [p], seed,
    pc: { hp: 40, attrs: { tech: 14 }, skills: { firearms: 2, mechanics: 2, cyberware: 2, medicine: 1 } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 5000, cash: 500 } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const resolve = (g: G, effects: Rec[], source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
/** 內建的來源給一批效果，提交；回傳解出來的結果。 */
const give = (g: G, ...effects: Rec[]) => {
  const r = resolve(g, effects)
  expect(r.errors).toEqual([])
  g.commit(draft(r.changes))
  return r
}
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const last = (g: G) => g.state.reports[g.state.reports.length - 1]!
const now = (g: G) => toMinutes(g.state.time)
const withDice = <T,>(v: number, fn: () => T): T => {
  const spy = vi.spyOn(Rng.prototype, 'next').mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
afterEach(() => { vi.restoreAllMocks() })

const frame = (g: G, spec: Rec, seq = 1) => frameOf(g.k, g.state, { seq, ...spec })
const attrOf = (f: ReturnType<typeof frameOf>, id: string) => f.attrs.find((a) => a.option === id)

// ===================================================================================================================
describe('規則表', () => {
  it('預設值：份量、條數、表價、合法性、退格、來源上限、三段文字的字數；十二種零件，槍管與機構沒有生體版', () => {
    expect(DEFAULT_UNREG_RULES.cells).toEqual({ 1: 0.5, 2: 1, 3: 1.5, 4: 2 })
    expect(DEFAULT_UNREG_RULES.lines).toEqual({ 1: 1, 2: 2, 3: 2, 4: 3 })
    expect(DEFAULT_UNREG_RULES.price).toEqual({ 1: 200, 2: 600, 3: 2000, 4: 8000 })
    expect(DEFAULT_UNREG_RULES.legal).toEqual({ 1: 'free', 2: 'free', 3: 'permit', 4: 'banned' })
    expect(DEFAULT_UNREG_RULES.refund).toEqual({ plain: 0.5, costly: 1 })
    expect(DEFAULT_UNREG_RULES.text).toEqual({ name: [1, 10], desc: [4, 60], quirk: [4, 80] })
    expect(Object.fromEntries(Object.entries(DEFAULT_UNREG_RULES.sources).map(([id, s]) => [id, s.grade_cap]))).toEqual({ reward: 3, order: 3, window: 4, ask: 2, gift: 4 })
    expect(Object.keys(DEFAULT_UNREG_RULES.types).sort()).toEqual(['action', 'actuator', 'barrel', 'blade', 'chip', 'fiber', 'neuron', 'plate', 'power', 'sensor', 'skin', 'software'])
    expect(Object.entries(DEFAULT_UNREG_RULES.types).filter(([, t]) => t.bio === false).map(([id]) => id).sort()).toEqual(['action', 'barrel'])
    expect(DEFAULT_UNREG_RULES.options).toEqual({})
  })

  it('資料蓋掉預設（逐級、逐種零件）；格式不對的欄位忽略、unregRuleProblems 一條一句', () => {
    const g = make(pack((c) => { c.unreg_rule = [{ id: 'default', options: structuredClone(OPTIONS), price: { 2: 650 }, sources: { ask: { grade_cap: 1 } }, refund: { plain: 0.5 } }] }))
    const r = unregRules(g.k)
    expect(r.price).toEqual({ 1: 200, 2: 650, 3: 2000, 4: 8000 })
    expect(r.sources.ask!.grade_cap).toBe(1)
    expect(r.sources.gift!.grade_cap).toBe(4)
    expect(r.refund).toEqual({ plain: 0.5, costly: 1 })
    expect(r.options.skin).toHaveLength(3)
    const bad = unregRuleProblems({ cells: { 7: 1 }, price: { 1: -5 }, options: { skin: [{ id: 'x', put: 'stats', key: 'k', amount: 1, cost: 0.3, max: 1, name: 'x' }] }, text: { name: [5, 1] }, sources: { nope: {} } })
    expect(bad.length).toBeGreaterThanOrEqual(5)
    expect(bad.some((m) => m.includes('0.5'))).toBe(true)
  })

  it('載入時擋下：預設清單的類型不在 types 裡；options 給沒有生體版的類型寫了 material: bio', () => {
    expect(() => make(pack((c) => { c.unreg_preset!.push({ id: 'bad', type: 'nope', name: '怪', desc: '一句說明。' }) }))).toThrow(/nope/)
    expect(() => make(pack((c) => { c.unreg_rule = [{ id: 'default', options: { barrel: [{ id: 'b', name: 'b', put: 'stats', key: 'hit', amount: 1, cost: 0.5, max: 1, material: 'bio' }] } }] }))).toThrow(/沒有生體版/)
  })
})

// ===================================================================================================================
describe('frameOf', () => {
  it('同一個種子與 spec 兩次逐欄相同、不動存檔亂數的游標；流水號不同可以不同', () => {
    const g = make()
    const cursor = g.state.rng.cursor
    const a = frame(g, { type: 'skin', grade: 2, want: ['社交'] })
    const b = frame(g, { type: 'skin', grade: 2, want: ['社交'] })
    expect(a).toEqual(b)
    expect(g.state.rng.cursor).toBe(cursor)
    // 沒給類型時也照種子抽：同一個流水號抽到同一個
    expect(frame(g, {}, 5)).toEqual(frame(g, {}, 5))
    const seen = new Set(Array.from({ length: 40 }, (_, i) => frame(g, {}, i + 1).type))
    expect(seen.size).toBeGreaterThan(3)
  })

  it('預算：II 級抽到沒有 stats 的怪癖是 1.5，抽到 hit −1 的是 2；表價、合法性、份量、形狀照規則表', () => {
    const g = make()
    const plain = frame(g, { type: 'barrel', grade: 2, quirk: 'qk_plain1' })
    expect(plain.quirk).toEqual({ id: 'qk_plain1', refund: 0.5 })
    expect(plain.budget).toBe(1.5)
    const costly = frame(g, { type: 'barrel', grade: 2, quirk: 'qk_costly' })
    expect(costly.quirk).toEqual({ id: 'qk_costly', refund: 1 })
    expect(costly.budget).toBe(2)
    for (const [grade, price, legal] of [[1, 200, 'free'], [2, 600, 'free'], [3, 2000, 'permit'], [4, 8000, 'banned']] as const) {
      const f = frame(g, { type: 'barrel', grade })
      expect([f.price, f.legal, f.weight, f.size, f.brand, f.material]).toEqual([price, legal, 0.2, 1, 'doujin', 'mech'])
    }
  })

  it('used 不超過預算、條數不超過 lines；用不完的預算不補', () => {
    const g = make()
    for (let seq = 1; seq <= 60; seq++) for (const grade of [1, 2, 3, 4]) {
      const f = frame(g, { type: seq % 2 ? 'skin' : 'barrel', grade }, seq)
      expect(f.used).toBeLessThanOrEqual(f.budget)
      expect(f.attrs.length).toBeLessThanOrEqual(DEFAULT_UNREG_RULES.lines[grade]!)
      expect(f.attrs.every((a) => a.shares >= 1)).toBe(true)
    }
    // I 級：份量 0.5＋怪癖 0.5，只有一條屬性；外皮每份 0.5
    const one = frame(g, { type: 'skin', grade: 1, quirk: 'qk_plain1' })
    expect(one.attrs).toHaveLength(1)
    expect(one.budget).toBe(1)
    expect(one.attrs[0]!.shares).toBe(2)
    // 槍管的傷害一份 1 格：II 級預算 1.5，want 傷害：傷害 1 份（1 格）、剩 0.5 給一份命中；穿甲放不進（條數已滿）
    const d = frame(g, { type: 'barrel', grade: 2, quirk: 'qk_plain1', want: ['傷害'] })
    expect(d.attrs).toEqual([{ option: 'br_damage', shares: 1 }, expect.objectContaining({ shares: 1 })])
    expect(d.used).toBe(1.5)
  })

  it('want 指 id 或 tags、照 want 的順序排前面：want 社交的外皮，社交親和排第一而且份數最多', () => {
    const g = make()
    for (let seq = 1; seq <= 20; seq++) {
      const f = frame(g, { type: 'skin', grade: 2, quirk: 'qk_plain1', want: ['社交'] }, seq)
      expect(f.attrs[0]!.option).toBe('sk_social')
      const social = attrOf(f, 'sk_social')!.shares
      expect(f.attrs.slice(1).every((a) => a.shares < social)).toBe(true)
      expect(f.affinity.social).toBe(social)
    }
    // 指 id、指兩個：順序照 want
    const two = frame(g, { type: 'skin', grade: 2, quirk: 'qk_plain1', want: ['sk_scan', '風格'] })
    expect(two.attrs.map((a) => a.option)).toEqual(['sk_scan', 'sk_style'])
    // stats 與 affinity 是每一項 amount × 份數的合計
    expect(two.stats).toEqual({ scan_guard: attrOf(two, 'sk_scan')!.shares, style: attrOf(two, 'sk_style')!.shares })
  })

  it('怪癖：外皮抽不到 applies 只有武器的那一筆、槍管抽得到；tags 被篩選關掉的抽不到；只有 kind 是 quirk、池含 doujin 的才抽', () => {
    const g = make()
    const skins = new Set(Array.from({ length: 80 }, (_, i) => frame(g, { type: 'skin', grade: 2 }, i + 1).quirk?.id))
    expect(skins.has('qk_costly')).toBe(false)
    expect(skins.has('qk_flaw')).toBe(false)
    expect(skins.has('qk_gross')).toBe(true)
    const barrels = new Set(Array.from({ length: 80 }, (_, i) => frame(g, { type: 'barrel', grade: 2 }, i + 1).quirk?.id))
    expect(barrels.has('qk_costly')).toBe(true)
    // 關掉 gross 之後再也抽不到
    g.state.rules = { ...g.state.rules, contentOff: ['gross'] }
    const off = new Set(Array.from({ length: 80 }, (_, i) => frame(g, { type: 'skin', grade: 2 }, i + 1).quirk?.id))
    expect(off.has('qk_gross')).toBe(false)
    // spec.quirk 不在範圍裡（外皮指到只給武器的）：照抽，不用它
    expect(frame(g, { type: 'skin', grade: 2, quirk: 'qk_costly' }).quirk!.id).not.toBe('qk_costly')
  })

  it('一筆怪癖都抽不到：沒有怪癖、不退格', () => {
    const g = make(pack((c) => { c.quirk = [] }))
    const f = frame(g, { type: 'barrel', grade: 2 })
    expect(f.quirk).toBeNull()
    expect(f.budget).toBe(1)
    expect(frameProblems(g.k, f)).toEqual([])
  })

  it('II 級的板材護甲只有一份、III 級可以兩份', () => {
    const g = make()
    for (let seq = 1; seq <= 30; seq++) {
      expect(attrOf(frame(g, { type: 'plate', grade: 2, want: ['armor'] }, seq), 'pl_armor')!.shares).toBe(1)
      expect(attrOf(frame(g, { type: 'plate', grade: 1, want: ['armor'] }, seq), 'pl_armor')!.shares).toBe(1)
    }
    const three = frame(g, { type: 'plate', grade: 3, quirk: 'qk_plain1', want: ['armor'] })
    expect(attrOf(three, 'pl_armor')!.shares).toBe(2)
    expect(three.stats.armor).toBe(2)
  })

  it('候選要對得上 grade_min 與材質；沒有任何選項的類型照樣給（屬性是空的）', () => {
    const g = make()
    for (let seq = 1; seq <= 30; seq++) expect(attrOf(frame(g, { type: 'barrel', grade: 1 }, seq), 'br_pierce')).toBeUndefined()
    const chip = frame(g, { type: 'chip', grade: 3 })
    expect(chip.attrs).toEqual([])
    expect(chip.stats).toEqual({})
    expect(chip.used).toBe(0)
    expect(chip.price).toBe(2000)
  })

  it('槍管給生體被擋；不認得的類型被擋；等級 V 夾成 IV、來源上限夾下來', () => {
    const g = make()
    expect(reasonOf(() => frame(g, { type: 'barrel', material: 'bio' }))).toContain('沒有生體版')
    expect(reasonOf(() => frame(g, { type: 'nope' }))).toContain('nope')
    expect(frame(g, { type: 'skin', material: 'bio' }).material).toBe('bio')
    expect(frame(g, { type: 'skin', grade: 5 }).grade).toBe(4)
    expect(frame(g, { type: 'skin', grade: 9, source: 'gift' }).grade).toBe(4)
    expect(frame(g, { type: 'skin', grade: 4, source: 'ask' }).grade).toBe(2)
    expect(frame(g, { type: 'skin', grade: 4, source: 'reward' }).grade).toBe(3)
    expect(frame(g, { type: 'skin', source: 'order' }).grade).toBe(3)
    expect(frame(g, { type: 'skin', grade: 0 }).grade).toBe(1)
    expect(frame(g, { type: 'skin', brand: 'ka' }).brand).toBe('ka')
  })

  it('性質：隨機的類型、等級、want、種子，frameProblems 永遠是空的；stats 與 affinity 的每個鍵都出自那個類型的選項', () => {
    const g = make()
    const types = Object.keys(DEFAULT_UNREG_RULES.types)
    const tags = ['社交', '風格', '隱蔽', '傷害', '準度', 'armor', 'br_hit', 'zzz']
    fc.assert(fc.property(
      fc.constantFrom(...types), fc.integer({ min: -2, max: 7 }), fc.subarray(tags), fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 500 }),
      fc.constantFrom('reward', 'order', 'window', 'ask', 'gift'), fc.constantFrom('mech', 'bio'),
      (type, grade, want, seed, seq, source, material) => {
        g.state.rng.seed = seed
        const bio = material === 'bio' && DEFAULT_UNREG_RULES.types[type]!.bio !== false
        const f = frameOf(g.k, g.state, { type, grade, want, seq, source, material: bio ? 'bio' : 'mech' })
        expect(frameProblems(g.k, f, source)).toEqual([])
        const keys = new Set((unregRules(g.k).options[type] ?? []).map((o) => o.key))
        for (const key of [...Object.keys(f.stats), ...Object.keys(f.affinity)]) expect(keys.has(key)).toBe(true)
        expect(f.grade).toBeGreaterThanOrEqual(1)
        expect(f.grade).toBeLessThanOrEqual(unregRules(g.k).sources[source]!.grade_cap)
        expect(f.used).toBeLessThanOrEqual(f.budget)
      },
    ), { numRuns: 300 })
  })
})

// ===================================================================================================================
describe('frameProblems', () => {
  it('合格的空；每一種壞法各有一句', () => {
    const g = make()
    const good = frame(g, { type: 'barrel', grade: 2, quirk: 'qk_plain1', want: ['傷害'] })
    expect(frameProblems(g.k, good, 'gift')).toEqual([])
    const bad = (patch: Rec) => frameProblems(g.k, { ...structuredClone(good), ...patch })
    expect(bad({ type: 'nope' }).join('')).toContain('不是未登錄零件能出的')
    expect(bad({ material: 'bio' }).join('')).toContain('沒有生體版')
    expect(bad({ material: 'gas' }).join('')).toContain('材質')
    expect(bad({ grade: 5 }).join('')).toContain('V 級')
    expect(bad({ grade: 0 }).join('')).toContain('V 級')
    expect(frameProblems(g.k, { ...structuredClone(good), grade: 3 }, 'ask').join('')).toContain('最高只給 II 級')
    expect(bad({ attrs: [{ option: 'sk_style', shares: 1 }] }).join('')).toContain('不是這種零件能帶的屬性')
    expect(bad({ attrs: [{ option: 'br_hit', shares: 4 }] }).join('')).toContain('最多只能放 3 份')
    expect(bad({ attrs: [{ option: 'br_hit', shares: 1 }, { option: 'br_hit', shares: 1 }] }).join('')).toContain('重複')
    expect(bad({ attrs: [{ option: 'br_hit', shares: 1 }, { option: 'br_damage', shares: 1 }, { option: 'br_pierce', shares: 1 }] }).join('')).toContain('最多只能帶 2 條')
    expect(bad({ attrs: [{ option: 'br_damage', shares: 2 }] }).join('')).toContain('超過預算')
    expect(bad({ budget: 3 }).join('')).toContain('預算不等於')
    expect(bad({ quirk: { id: 'qk_nope', refund: 0.5 } }).join('')).toContain('怪癖查不到')
    expect(bad({ quirk: { id: 'qk_plain1', refund: 1 } }).join('')).toContain('退的格數不對')
    expect(bad({ quirk: { id: 'qk_flaw', refund: 0.5 } }).join('')).toContain('怪癖查不到')
    expect(bad({ stats: { damage: 99 } }).join('')).toContain('對不上')
    expect(bad({ attrs: 'x' }).join('')).toContain('屬性壞掉')
    expect(frameProblems(g.k, null)).toEqual(['零件的框架壞掉了。'])
    expect(frameProblems(g.k, 5)).toHaveLength(1)
  })
})

// ===================================================================================================================
describe('效果 part_unreg', () => {
  it('pending 多一筆、框架合格、預設的文字抽到同類同級的那一筆；source 預設 gift；一張 id 是流水號', () => {
    const g = make()
    const r = give(g, { kind: 'part_unreg', type: 'barrel', grade: 2, from: '雇主的謝禮' })
    expect(r.lines).toEqual(['一件未登錄零件（槍管，II級），等著交貨。'])
    const [p] = pendingParts(g.state)
    expect(pendingParts(g.state)).toHaveLength(1)
    expect(p).toMatchObject({ id: 'up1', source: 'gift', from: '雇主的謝禮', at: now(g) })
    expect(p!.hold).toBeUndefined()
    expect(frameProblems(g.k, p!.frame, p!.source)).toEqual([])
    expect(p!.frame).toMatchObject({ type: 'barrel', grade: 2, material: 'mech', brand: 'doujin' })
    expect(['鐵牙', '蛇信']).toContain(p!.preset.name)
    // 預設的怪癖文字：預設那一筆寫了就用它，沒寫用怪癖的 desc
    const q = g.k.content.get<Rec & { id: string }>('quirk', p!.frame.quirk!.id)!
    expect(p!.preset.quirk_text).toBe(p!.preset.name === '鐵牙' ? '扣下扳機總是慢半拍。' : q.desc)
    expect(unregOf(g.state).seq).toBe(1)
    // 框架和 frameOf 用同一個流水號算出來的一樣（讀檔重來也一樣）
    expect(p!.frame).toEqual(frameOf(g.k, { ...g.state, rng: g.state.rng }, { type: 'barrel', grade: 2, seq: 1, source: 'gift' }))
    const again = make()
    again.load(g.save())
    expect(pendingParts(again.state)).toEqual(pendingParts(g.state))
  })

  it('同一份報告給兩件一模一樣的：兩筆 id 不同、框架各自抽的、預設的名字不重複', () => {
    const g = make()
    give(g, { kind: 'part_unreg', type: 'barrel', grade: 2 }, { kind: 'part_unreg', type: 'barrel', grade: 2 })
    const [a, b] = pendingParts(g.state)
    expect([a!.id, b!.id]).toEqual(['up1', 'up2'])
    expect(a!.frame).toEqual(frameOf(g.k, g.state, { type: 'barrel', grade: 2, seq: 1 }))
    expect(b!.frame).toEqual(frameOf(g.k, g.state, { type: 'barrel', grade: 2, seq: 2 }))
    expect(a!.preset.name).not.toBe(b!.preset.name)
    expect(new Set(pendingParts(g.state).map((p) => p.preset.name)).size).toBe(2)
  })

  it('預設的文字：類型相同、等級相同的優先（沒寫等級的不搶）；沒有同級的退到同類；材質對不上的不收', () => {
    const g = make()
    const names = new Set<string>()
    for (let i = 0; i < 12; i++) { g.state.rng.seed = 100 + i; give(g, { kind: 'part_unreg', type: 'barrel', grade: 2 }); names.add(pendingParts(g.state).at(-1)!.preset.name) }
    // 同一份清單裡每一筆名字都不重複；II 級的槍管預設只有鐵牙、蛇信（老砲沒寫等級，排在後面）
    expect([...names].every((n) => ['鐵牙', '蛇信'].includes(n) || n.startsWith('無名的') || n === '老砲')).toBe(true)
    const h = make()
    give(h, { kind: 'part_unreg', type: 'barrel', grade: 2 })
    expect(['鐵牙', '蛇信']).toContain(pendingParts(h.state)[0]!.preset.name)
    give(h, { kind: 'part_unreg', type: 'barrel', grade: 3 })
    expect(['鐵牙', '蛇信', '老砲']).toContain(pendingParts(h.state)[1]!.preset.name) // 沒有 III 級的，退到同類
    give(h, { kind: 'part_unreg', type: 'skin', grade: 3 })
    expect(pendingParts(h.state)[2]!.preset.name).toBe('霧面')
    const same = make()
    give(same, { kind: 'part_unreg', type: 'skin', grade: 1 })
    expect(pendingParts(same.state)[0]!.preset.name).toBe('霧面') // 同類不同級
    // 同一份清單裡名字不重複：唯一的一筆被前面的拿走了，後面的叫「無名的…」
    give(same, { kind: 'part_unreg', type: 'skin', grade: 3 })
    expect(pendingParts(same.state)[1]!.preset.name).toBe('無名的外皮2')
    // 材質寫了的要對得上：生體的外皮不收「機械」的預設
    const m = make(pack((c) => { c.unreg_preset!.push({ id: 'pr_skin_mech', type: 'skin', grade: 2, material: 'mech', name: '機皮', desc: '一層機械的外皮。' }) }))
    give(m, { kind: 'part_unreg', type: 'skin', grade: 2, material: 'bio' })
    expect(pendingParts(m.state)[0]!.preset.name).toBe('霧面')
    give(m, { kind: 'part_unreg', type: 'skin', grade: 2 })
    expect(pendingParts(m.state)[1]!.preset.name).toBe('機皮')
  })

  it('沒有任何 unreg_preset 時名字是「無名的…」加流水號，說明是一句；數字不受影響', () => {
    const g = make(pack((c) => { c.unreg_preset = [] }))
    give(g, { kind: 'part_unreg', type: 'barrel', grade: 2 }, { kind: 'part_unreg', type: 'chip', grade: 1 })
    const [a, b] = pendingParts(g.state)
    expect(a!.preset).toMatchObject({ name: '無名的槍管1', desc: '一件沒有登記過的槍管。' })
    expect(b!.preset).toMatchObject({ name: '無名的晶片2', desc: '一件沒有登記過的晶片。', quirk_text: expect.any(String) })
    expect(a!.frame).toEqual(frameOf(g.k, g.state, { type: 'barrel', grade: 2, seq: 1 }))
  })

  it('指定了類型與等級才寫出來，沒指定是簡短的一句', () => {
    const g = make()
    expect(resolve(g, [{ kind: 'part_unreg' }]).lines).toEqual(['一件未登錄零件，等著交貨。'])
    expect(resolve(g, [{ kind: 'part_unreg', type: 'skin' }]).lines).toEqual(['一件未登錄零件，等著交貨。'])
    expect(resolve(g, [{ kind: 'part_unreg', type: 'skin', grade: 4 }]).lines).toEqual(['一件未登錄零件（外皮，IV級），等著交貨。'])
  })

  it('AI 與玩家要來的整筆被擋；內建的才收', () => {
    const g = make()
    for (const source of ['ai', 'player'] as const) {
      const r = resolve(g, [{ kind: 'part_unreg', type: 'barrel' }], source)
      expect(r.errors.join(), source).toContain('不是 AI 與玩家要的結果可以用的效果')
      expect(r.changes).toEqual([])
    }
    expect(g.k.effects.aiKinds()).not.toContain('part_unreg')
    expect(g.k.effects.kinds()).toContain('part_unreg')
  })

  it('格式：不認得的類型、槍管給生體、等級 V、材質、want、quirk、request 超過 80 字、source、hold、ready_minutes 都被擋', () => {
    const g = make()
    const errs = (e: Rec) => resolve(g, [{ kind: 'part_unreg', ...e }]).errors.join('')
    expect(errs({ type: 'nope' })).toContain('nope')
    expect(errs({ type: 'barrel', material: 'bio' })).toContain('沒有生體版')
    expect(errs({ grade: 5 })).toContain('V 級')
    expect(errs({ grade: 2.5 })).toContain('grade')
    expect(errs({ material: 'gas' })).toContain('material')
    expect(errs({ want: 'x' })).toContain('want')
    expect(errs({ want: [1] })).toContain('want')
    expect(errs({ quirk: 'qk_nope' })).toContain('quirk')
    expect(errs({ request: 'x'.repeat(81) })).toContain('request')
    expect(errs({ source: 'steal' })).toContain('source')
    expect(errs({ hold: 'now' })).toContain('hold')
    expect(errs({ ready_minutes: -1 })).toContain('ready_minutes')
    expect(errs({ once: '' })).toContain('once')
    expect(errs({ request: 'x'.repeat(80), type: 'barrel', grade: 2, want: ['傷害'], quirk: 'qk_plain1', source: 'order', hold: 'order', ready_minutes: 10, once: 'k', once_note: '嗯。' })).toBe('')
  })

  it('同一個 once 第二次落空並提醒一句（用 once_note，沒寫是預設的一句）；同一份報告裡兩次也是', () => {
    const g = make()
    give(g, { kind: 'part_unreg', type: 'skin', once: 'shop:ann' })
    expect(unregOf(g.state).once).toEqual(['shop:ann'])
    const second = resolve(g, [{ kind: 'part_unreg', type: 'skin', once: 'shop:ann', once_note: '老闆說：上次不是給過你了嗎。' }])
    expect(second.changes).toEqual([])
    expect(second.errors).toEqual([])
    expect(second.clamps[0]!.notice).toBe('老闆說：上次不是給過你了嗎。')
    expect(resolve(g, [{ kind: 'part_unreg', type: 'skin', once: 'shop:ann' }]).clamps[0]!.notice).toBe('這一件已經拿過了。')
    expect(pendingParts(g.state)).toHaveLength(1)
    const other = make()
    const both = resolve(other, [{ kind: 'part_unreg', once: 'k1' }, { kind: 'part_unreg', once: 'k1' }])
    other.commit(draft(both.changes))
    expect(pendingParts(other.state)).toHaveLength(1)
    expect(both.clamps).toHaveLength(1)
    // 沒給 once 的永遠收
    give(g, { kind: 'part_unreg', type: 'skin' }, { kind: 'part_unreg', type: 'skin' })
    expect(pendingParts(g.state)).toHaveLength(3)
  })

  it('hold 與 ready_minutes：hold: order 的 ready_at 是現在加上那麼多分鐘；request 記著', () => {
    const g = make()
    give(g, { kind: 'part_unreg', type: 'skin', grade: 2, source: 'order', hold: 'order', ready_minutes: 4320, request: '一層社交的外皮', want: ['社交'] })
    const p = pendingParts(g.state)[0]!
    expect(p).toMatchObject({ source: 'order', hold: 'order', ready_at: now(g) + 4320, request: '一層社交的外皮' })
    expect(p.frame.attrs[0]!.option).toBe('sk_social')
  })

  it('變更 unreg.pending 的格式：add 與 remove 擇一、不存在的 id、壞的 spec 都擋下', () => {
    const g = make()
    const bad = (c: Rec) => { try { g.commit(draft([c as never])); return '' } catch (e) { return String((e as Error).message) } }
    expect(bad({ op: 'unreg.pending' })).toContain('add 與 remove')
    expect(bad({ op: 'unreg.pending', remove: 'up9' })).toContain('up9')
    expect(bad({ op: 'unreg.pending', add: { type: 'nope' } })).toContain('nope')
    expect(bad({ op: 'unreg.pending', add: { type: 'barrel', material: 'bio' } })).toContain('生體')
    expect(bad({ op: 'unreg.once', id: '' })).toContain('id')
    expect(bad({ op: 'unreg.name', name: '' })).toContain('name')
    expect(pendingParts(g.state)).toEqual([])
  })

  it('壞掉的 state.ext.unreg 讀成空的，不丟錯', () => {
    const g = make()
    g.state.ext.unreg = { seq: -3, pending: ['x', { id: 5 }, { id: 'a', frame: 3 }], names: [1, '甲', '甲'], once: 'no' }
    expect(unregOf(g.state)).toEqual({ seq: 0, pending: [], names: ['甲'], once: [] })
    g.state.ext.unreg = 'garbage'
    expect(unregOf(g.state)).toEqual({ seq: 0, pending: [], names: [], once: [] })
  })
})

// ===================================================================================================================
describe('textProblems', () => {
  const setup = () => {
    const g = make()
    give(g, { kind: 'part_unreg', type: 'barrel', grade: 2, quirk: 'qk_plain1' })
    return g
  }
  const ok = { name: '赤鯉', desc: '槍口刻著一尾赤鯉的槍管。', quirk: '拿在手上時會發出輕輕的聲音。' }

  it('合格的是空的', () => {
    const g = setup()
    expect(textProblems(g.k, g.state, 'up1', ok)).toEqual([])
  })

  it('名字帶數字（半形、全形）、說明有數字、怪癖有數字，各一條而且帶欄位的名字', () => {
    const g = setup()
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: '赤鯉2' })).toEqual(['name：不能有阿拉伯數字。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: '赤鯉２' })).toHaveLength(1)
    expect(textProblems(g.k, g.state, 'up1', { ...ok, desc: '第9把槍管的說明。' })).toEqual(['desc：不能有阿拉伯數字。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, quirk: '一天會慢３秒鐘喔。' })).toEqual(['quirk：不能有阿拉伯數字。'])
  })

  it('名字和內容的零件重名、和給過的名字重名、有空白或標點、字數不對', () => {
    const g = setup()
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: 'pt_barrel' }).join('')).toContain('已經有一件零件叫這個名字')
    g.commit(draft([{ op: 'unreg.name', name: '赤鯉' }]))
    expect(textProblems(g.k, g.state, 'up1', ok).join('')).toContain('已經有一件零件叫這個名字')
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: '赤 鯉' }).join('')).toContain('空白與標點')
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: '赤鯉，' }).join('')).toContain('空白與標點')
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: '赤鯉赤鯉赤鯉赤鯉赤鯉赤' })).toEqual(['name：字數要在 1～10 個字之間。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: '   ' }).join('')).toContain('字數')
  })

  it('說明超長、太短，怪癖超長；頭尾空白不算字數', () => {
    const g = setup()
    expect(textProblems(g.k, g.state, 'up1', { ...ok, desc: '長'.repeat(61) })).toEqual(['desc：字數要在 4～60 個字之間。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, desc: '短' })).toEqual(['desc：字數要在 4～60 個字之間。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, quirk: '長'.repeat(81) })).toEqual(['quirk：字數要在 4～80 個字之間。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, desc: `  ${'長'.repeat(60)}  ` })).toEqual([])
  })

  it('多出來的欄位（例如 stats）算一條問題；缺的欄位、不是文字、不是物件、查不到的零件', () => {
    const g = setup()
    expect(textProblems(g.k, g.state, 'up1', { ...ok, stats: { damage: 9 } })).toEqual(['stats：多出來的欄位，只能寫 name、desc、quirk。'])
    expect(textProblems(g.k, g.state, 'up1', { name: '赤鯉', desc: '槍口刻著一尾赤鯉的槍管。' })).toEqual(['quirk：要是文字。'])
    expect(textProblems(g.k, g.state, 'up1', { ...ok, name: 5 })).toEqual(['name：要是文字。'])
    expect(textProblems(g.k, g.state, 'up1', 'x')).toHaveLength(1)
    expect(textProblems(g.k, g.state, 'up9', ok)).toEqual(['沒有這一件等著交貨的零件。'])
  })

  it('這一件沒有怪癖時 quirk 可以不寫', () => {
    const g = make(pack((c) => { c.quirk = [] }))
    give(g, { kind: 'part_unreg', type: 'barrel', grade: 2 })
    expect(textProblems(g.k, g.state, 'up1', { name: '赤鯉', desc: '槍口刻著一尾赤鯉的槍管。' })).toEqual([])
    expect(textProblems(g.k, g.state, 'up1', { name: '赤鯉', desc: '槍口刻著一尾赤鯉的槍管。', quirk: '' })).toEqual([])
  })
})

// ===================================================================================================================
describe('frameView、readyParts', () => {
  it('給外殼組請求的資料：類型與材質的名字、等級、牌子、屬性的名字與數字、怪癖種類、request、同類同級的名字樣本', () => {
    const g = make(pack((c) => { c.faction = [{ id: 'doujin', name: '同人眾', short: '同人', class: 'street' }] }))
    give(g, { kind: 'part_unreg', type: 'barrel', grade: 2, quirk: 'qk_plain1', want: ['傷害'], request: '想要一根會咬人的槍管' })
    const v = frameView(g.k, g.state, 'up1')!
    expect(v).toMatchObject({
      id: 'up1', type: 'barrel', typeName: '槍管', material: 'mech', materialName: '機械', grade: 2, gradeName: 'II', brand: 'doujin', brandName: '同人眾',
      quirk: { id: 'qk_plain1', name: '話多', desc: '它在口袋裡會輕輕作響。' }, request: '想要一根會咬人的槍管',
    })
    expect(v.attrs[0]).toMatchObject({ id: 'br_damage', name: '傷害', shares: 1, put: 'stats', key: 'damage', amount: 1 })
    // 同類同級：內容的零件（pt_barrel）與兩筆預設（鐵牙、蛇信），照 id 排；最多 5 筆
    expect(v.samples).toEqual(['鐵牙', '蛇信', 'pt_barrel'])
    expect(frameView(g.k, g.state, 'up9')).toBeNull()
    const before = JSON.stringify(g.state)
    frameView(g.k, g.state, 'up1')
    expect(JSON.stringify(g.state)).toBe(before)
    // 勢力資料查不到就用牌子的 id
    expect(frameView(make().k, (() => { const h = make(); give(h, { kind: 'part_unreg', type: 'skin' }); return h.state })(), 'up1')!.brandName).toBe('doujin')
  })

  it('readyParts：沒有 hold 的每一筆；訂做的不在裡面', () => {
    const g = make()
    give(g, { kind: 'part_unreg', type: 'skin' }, { kind: 'part_unreg', type: 'skin', hold: 'order', ready_minutes: 0 }, { kind: 'part_unreg', type: 'chip' })
    expect(readyParts(g.k, g.state).map((p) => p.id)).toEqual(['up1', 'up3'])
    expect(pendingParts(g.state)).toHaveLength(3)
  })
})

// ===================================================================================================================
describe('deliverDraft', () => {
  const setup = (seed = 7) => {
    const g = make(pack(), seed)
    give(g, { kind: 'part_unreg', type: 'barrel', grade: 2, quirk: 'qk_plain1', from: '雇主的謝禮' })
    return g
  }
  const goodText = { name: '赤鯉', desc: '槍口刻著一尾赤鯉的槍管。', quirk: '拿在手上時會發出輕輕的聲音。' }

  it('不給 text：背包多一疊 UNREG_STACK_ID、stackPart 讀得到、state 是 doujin；pending 少一筆、names 多一個；報告帶整筆零件', () => {
    const g = setup()
    const pre = pendingParts(g.state)[0]!
    g.commit(deliverDraft(g.k, g.state, { id: 'up1' }))
    expect(pendingParts(g.state)).toEqual([])
    expect(unregOf(g.state).names).toEqual([pre.preset.name])
    const stack = g.state.inventory.find((s) => s.id === UNREG_STACK_ID)!
    expect(stack).toMatchObject({ qty: 1, data: { uid: 'up1' } })
    const p = stackPart(g.k.content, stack)!
    expect(p).toMatchObject({
      unreg: true, uid: 'up1', name: pre.preset.name, desc: pre.preset.desc, type: 'barrel', material: 'mech', brand: 'doujin', grade: 2, price: 600, legal: 'free',
      cells: 1, weight: 0.2, size: 1, state: 'doujin', quirk: 'qk_plain1', quirk_text: pre.preset.quirk_text, from: '雇主的謝禮', id: 'unreg:up1',
    })
    expect(p.stats).toEqual(pre.frame.stats)
    const rep = last(g)
    expect(rep).toMatchObject({ kind: 'action', action: 'unreg.deliver', outcome: { result: 'delivered' } })
    expect((rep.outcome as Rec).part).toMatchObject({ uid: 'up1', name: pre.preset.name, unreg: true })
    expect(rep.narration!.results!.join('')).toContain(pre.preset.name)
    expect(rep.narration!.results!.join('')).toContain('槍管')
    expect(rep.narration!.results!.join('')).toContain('II')
    expect(rep.narration!.results!.join('')).not.toMatch(/\d/)
    expect(deliverBlock(g.k, g.state, 'up1')).toContain('沒有這一件')
    // 存檔往返
    const again = make()
    again.load(g.save())
    expect(stackPart(again.k.content, again.state.inventory.find((s) => s.id === UNREG_STACK_ID))).toEqual(p)
  })

  it('份量無條件進位：I 級 0.5 → 1、III 級 1.5 → 2、IV 級 2 → 2', () => {
    const g = make()
    give(g, { kind: 'part_unreg', type: 'chip', grade: 1 }, { kind: 'part_unreg', type: 'chip', grade: 3 }, { kind: 'part_unreg', type: 'chip', grade: 4 })
    for (const id of ['up1', 'up2', 'up3']) g.commit(deliverDraft(g.k, g.state, { id }))
    expect(g.state.inventory.filter((s) => s.id === UNREG_STACK_ID).map((s) => stackPart(g.k.content, s)!.cells)).toEqual([1, 2, 2])
  })

  it('給合格的 text：名字是它、數字和不給的那一次逐欄相同', () => {
    const a = setup()
    a.commit(deliverDraft(a.k, a.state, { id: 'up1' }))
    const plain = stackPart(a.k.content, a.state.inventory.find((s) => s.id === UNREG_STACK_ID))!
    const b = setup()
    b.commit(deliverDraft(b.k, b.state, { id: 'up1', text: { name: ` ${goodText.name} `, desc: goodText.desc, quirk: goodText.quirk } }))
    const withText = stackPart(b.k.content, b.state.inventory.find((s) => s.id === UNREG_STACK_ID))!
    expect(withText).toMatchObject({ name: '赤鯉', desc: goodText.desc, quirk_text: goodText.quirk })
    const { name: _n, desc: _d, quirk_text: _q, ...restA } = plain
    const { name: _n2, desc: _d2, quirk_text: _q2, ...restB } = withText
    expect(restB).toEqual(restA)
    expect(unregOf(b.state).names).toEqual(['赤鯉'])
  })

  it('給不合格的 text 丟 ActionBlocked、狀態沒變', () => {
    const g = setup()
    const before = JSON.stringify(g.state)
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id: 'up1', text: { ...goodText, name: '赤鯉9' } }))).toContain('name：不能有阿拉伯數字。')
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id: 'up1', text: { ...goodText, stats: {} } }))).toContain('stats')
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id: 'up1', text: 'x' }))).toBeTruthy()
    expect(JSON.stringify(g.state)).toBe(before)
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
  })

  it('查不到的 id 被擋；hold: order 而時間沒到的被擋、寫出還要等幾天，時間到了就能交', () => {
    const g = make()
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id: 'up1' }))).toContain('沒有這一件')
    give(g, { kind: 'part_unreg', type: 'skin', source: 'order', hold: 'order', ready_minutes: 3 * 1440 })
    expect(deliverBlock(g.k, g.state, 'up1')).toBe('還要等 3 天。')
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id: 'up1' }))).toBe('還要等 3 天。')
    g.state.time = { ...g.state.time, day: g.state.time.day + 2 }
    expect(deliverBlock(g.k, g.state, 'up1')).toBe('還要等 1 天。')
    g.state.time = { ...g.state.time, day: g.state.time.day + 1 }
    expect(deliverBlock(g.k, g.state, 'up1')).toBeNull()
    g.commit(deliverDraft(g.k, g.state, { id: 'up1' }))
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(true)
  })

  it('把 pending 裡的框架改壞（直接改狀態）之後交貨被擋；不認得的怪癖、超過來源上限也是', () => {
    const g = setup()
    const raw = (g.state.ext.unreg as Rec).pending[0]
    raw.frame.attrs = [{ option: 'nope', shares: 1 }]
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id: 'up1' }))).toContain('不是這種零件能帶的屬性')
    const h = setup()
    ;(h.state.ext.unreg as Rec).pending[0].frame.grade = 5
    expect(reasonOf(() => deliverDraft(h.k, h.state, { id: 'up1' }))).toContain('V 級')
    const i = setup()
    ;(i.state.ext.unreg as Rec).pending[0].frame.stats = { damage: 50 }
    expect(reasonOf(() => deliverDraft(i.k, i.state, { id: 'up1' }))).toContain('對不上')
    const j = setup()
    ;(j.state.ext.unreg as Rec).pending[0].source = 'ask'
    ;(j.state.ext.unreg as Rec).pending[0].frame.grade = 3
    expect(reasonOf(() => deliverDraft(j.k, j.state, { id: 'up1' }))).toContain('最高只給 II 級')
  })
})

// ===================================================================================================================
describe('拿到的零件：裝、拆、賣', () => {
  const deliver = (g: G, spec: Rec, text?: Rec) => {
    give(g, { kind: 'part_unreg', ...spec })
    const id = pendingParts(g.state).at(-1)!.id
    g.commit(deliverDraft(g.k, g.state, { id, ...(text ? { text } : {}) }))
    return id
  }

  it('裝進手槍（M4-craft 的 assembleDraft）：productOf 的 stats 與 quirks 算到它，legal 是最嚴的那個', () => {
    const g = make()
    g.state.flags.home_level = 2
    g.state.ext.craft = { known: ['bp_pistol'] }
    const uid = deliver(g, { type: 'barrel', grade: 3, quirk: 'qk_plain1', want: ['準度'] })
    g.state.inventory.push({ id: 'pt_action', qty: 1 })
    const p = stackPart(g.k.content, g.state.inventory.find((s) => s.id === UNREG_STACK_ID))!
    expect(p.legal).toBe('permit')
    g.commit(withDice(0.65, () => assembleDraft(g.k, g.state, { blueprint: 'bp_pistol', parts: { barrel: uid, action: 'pt_action' }, maker: 'self' })))
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
    const made = g.state.inventory.find((s) => s.id === 'bp_pistol' && s.data?.uid)!
    expect((made.data!.parts as Rec).barrel).toMatchObject({ unreg: true, uid, name: p.name })
    const info = productOf(g.k.content, 'bp_pistol', made.data)!
    expect(info.legal).toBe('permit')
    expect(info.quirks.map((q) => q.id)).toContain('qk_plain1')
    for (const [key, v] of Object.entries(p.stats)) expect(info.stats[key]).toBe(v + (key === 'damage' ? 1 : 0))
    expect(partOf(g.k.content, (made.data!.parts as Rec).barrel)).toMatchObject({ unreg: true, name: p.name })
  })

  it('在店裡賣得掉：價錢是表價的一半乘店的收購係數、依 uid 賣、背包少一疊；店的貨架上沒有它', () => {
    const g = make()
    const uid = deliver(g, { type: 'barrel', grade: 2 })
    expect(sellBlock(g.k, g.state, 's_gun', UNREG_STACK_ID, 1, uid)).toBeNull()
    expect(sellBlock(g.k, g.state, 's_gun', UNREG_STACK_ID, 1)).toContain('沒有 unreg_part') // 不指名就沒有實例資料：行為和原本一樣
    const q = quote(g.k, g.state, 's_gun', UNREG_STACK_ID, 'sell', { uid })
    expect(q.steps[0]).toMatchObject({ id: 'catalog', value: 300 }) // 表價 600 的一半
    expect(q.steps[1]).toMatchObject({ id: 'ratio' })
    expect(q.price).toBeGreaterThan(0)
    expect(q.price).toBeLessThan(300)
    const row = shopView(g.k, g.state, 's_gun').sell.find((r) => r.uid === uid)!
    expect(row).toMatchObject({ item: UNREG_STACK_ID, price: q.price, block: null })
    expect(row.name).toBe(stackPart(g.k.content, g.state.inventory[0]!)!.name)
    expect(shopView(g.k, g.state, 's_gun').shelf.some((r) => r.item === UNREG_STACK_ID)).toBe(false)
    expect(stockOf(g.k, g.state, 's_gun').every((r) => r.item !== UNREG_STACK_ID)).toBe(true)
    const cred = g.state.money.cred
    g.commit(checkout(g.k, g.state, 's_gun', { sell: [{ item: UNREG_STACK_ID, qty: 1, uid }], pay: 'cred' }))
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
    expect(g.state.money.cred - cred).toBe(q.price)
  })

  it('不收零件的店不收；穿戴不適用；二手的內容零件（帶 data.state）也是 ×0.5；沒有實例資料的零件行為不變（照樣不能賣）', () => {
    const g = make(pack((c) => { c.shop_type = [{ id: 't_gun', name: '槍店', catalog: ['weapon'], buys: ['weapon'], grade_max: 3, cash: true, shop_mult: 1, temper: 0 }] }))
    const uid = deliver(g, { type: 'barrel', grade: 2 })
    expect(sellBlock(g.k, g.state, 's_gun', UNREG_STACK_ID, 1, uid)).toContain('不收')
    const h = make()
    h.state.inventory.push({ id: 'pt_barrel', qty: 1, data: { uid: 'used1', state: 'used' } })
    expect(sellBlock(h.k, h.state, 's_gun', 'pt_barrel', 1, 'used1')).toBeNull()
    expect(quote(h.k, h.state, 's_gun', 'pt_barrel', 'sell', { uid: 'used1' }).steps[0]!.value).toBe(100)
    h.state.inventory.push({ id: 'pt_barrel', qty: 1, data: { uid: 'new1', state: 'new' } })
    expect(quote(h.k, h.state, 's_gun', 'pt_barrel', 'sell', { uid: 'new1' }).steps[0]!.value).toBe(200)
    h.state.inventory.push({ id: 'pt_barrel', qty: 1 })
    expect(sellBlock(h.k, h.state, 's_gun', 'pt_barrel', 1)).toContain('沒有 pt_barrel 這樣東西')
  })
})
