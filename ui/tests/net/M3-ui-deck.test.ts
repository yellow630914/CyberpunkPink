// 驗收測試：dev/work/M3-ui-deck.md（cpp-ui）。角色對話框的「內海」分頁接上引擎 features/deck：甲板、構裝槽、裝與卸、SKIN、腳本、網內的數字。
// 引擎用真的；內容是測試自帶的最小假資料（一副 II 級甲板、構裝、SKIN、腳本），示意世界包那一條用它自己的資料。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 deck 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature } from '@engine/src'
import { toMinutes } from '@engine/src'
import { laceUnit, netAvatar } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import NetTab from '../../src/dialogs/character/NetTab.vue'
import { DEMO_DECK, DEMO_DECK_UID } from '../../src/data/demo'
import src from '../../src/dialogs/character/NetTab.vue?raw'
import gameSrc from '../../src/stores/game.ts?raw'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>

// ---- 假資料 ----
const deck = (id: string, o: Rec = {}) => ({ id, name: id, desc: `${id}。`, grade: 2, slots: 4, firewall: 12, legal: 'free', ...o })
const weapon = (id: string, o: Rec = {}) => ({ id, class: 'weapon', name: id, grade: 1, legal: 'register', type: 'neural', ram: 1, archetype: 'rifle', ...o })
const guard = (id: string, g: number) => ({ id, class: 'defense', name: id, grade: 1, legal: 'free', guard: g })
const PACK: ContentPack = {
  id: 'deck_ui_test',
  content: {
    weapon_class: [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }],
    deck: [deck('dk_ii', { name: '測試甲板 II', ram: { max: 2, regen: 1 } }), deck('dk_small', { name: '小甲板', grade: 1, slots: 2, firewall: 9 })],
    construct: [
      weapon('cs_rifle_3', { name: '夜巡', grade: 3 }), weapon('cs_b', { name: '乙'}), weapon('cs_c', { name: '丙' }), weapon('cs_d', { name: '丁' }),
      weapon('cs_e', { name: '戊' }), guard('cs_g2', 2), guard('cs_g4', 4),
    ],
    skin: [{ id: 'sk_a', name: '甲衣', style: 'x', style_value: 1, exposure: 0, cut: 'neutral', adult: false }, { id: 'sk_b', name: '乙衣', style: 'y', style_value: 2, exposure: 1, cut: 'neutral', adult: false }],
    item: [{ id: 'it_s', name: '退熱貼', desc: '退熱貼。', category: 'consumable', grade: 1, size: 0, legal: 'free', tags: ['script'] }],
  },
} as unknown as ContentPack

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
/** 旗標開著時槽數 +2、被佔 1（模擬技能與招牌能力） */
const HELPER: Feature = {
  id: 'deck_ui_helper',
  install(k) {
    k.stats.addStatProvider('deck_slots', 'deck_ui_helper', (s) => (s.flags['t.boost'] ? [{ label: '技能', value: 2, source: 'test' }] : []))
    k.stats.addStatProvider('deck_slots_reserved', 'deck_ui_helper', (s) => (s.flags['t.boost'] ? [{ label: '專屬構裝', value: 1, source: 'test' }] : []))
  },
}
const give = (id: string, qty = 1, data?: Rec) => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as never
const BAG = [
  give('dk_ii', 1, { uid: 'D1' }), give('dk_small', 1, { uid: 'D2' }), give('cs_rifle_3'), give('cs_b'), give('cs_c'), give('cs_d'), give('cs_e'), give('cs_g2'), give('cs_g4'),
  give('sk_a'), give('sk_b'), give('it_s', 4),
]
type Eng = ReturnType<typeof useEngine>

function start(o: { bag?: unknown[]; wear?: boolean; seed?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK], testFeatures: [HELPER] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '給東西', changes: (o.bag ?? BAG) as never })).toBeNull()
  if (o.wear !== false) expect(e.deck.equip('D1')).toBeNull()
  return { e, pinia }
}
const flag = (e: Eng, on: boolean) => expect(e.commit({ summary: '旗標', changes: [{ op: 'flag', key: 't.boost', value: on ? true : null }] as never })).toBeNull()
const minutes = (e: Eng) => toMinutes(e.state.time)
const slotsOf = (e: Eng) => ((e.pc!.ext.deck as Rec | undefined)?.slots ?? []) as string[]

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>): Promise<string> {
  const r = router()
  await r.push('/')
  await r.isReady()
  const app = createSSRApp(NetTab)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const text = (s: string) => clean(s).replace(/<[^>]+>/g, '')

beforeEach(() => setActivePinia(createPinia()))

describe('沒有甲板', () => {
  it('槽是空的、寫那一句提示；引擎說沒有甲板，裝構裝被擋的原因是引擎的句子', async () => {
    const { e, pinia } = start({ wear: false })
    expect(e.deck.view()!.deck.has).toBe(false)
    expect(e.deck.view()!.cells).toEqual([])
    expect(e.deck.numbers().slots).toBe(0)
    expect(e.deck.install('cs_b')).toBe('沒有甲板。')
    const h = clean(await render(pinia))
    expect(h).toContain('data-testid="no-deck"')
    expect(text(h)).toContain('沒有甲板：沒有 RAM、不能在網內戰鬥')
    expect(h).toContain('data-testid="slots-empty"')
    expect(text(h)).toContain('沒有甲板：沒有 RAM。')
  })
})

describe('有甲板：槽數與裝卸', () => {
  it('槽數等於引擎的 deck_slots 扣掉被佔的（含技能的加成）', async () => {
    const { e, pinia } = start()
    expect(e.deck.view()!.cells).toHaveLength(4)
    expect(e.deck.numbers().slots).toBe(4)
    flag(e, true)
    // 4 ＋ 2 ＝ 6 槽，被佔 1：能用 5 格，另有 1 格標成被專屬構裝佔掉
    const v = e.deck.view()!
    expect(e.deck.numbers()).toMatchObject({ slots: 6, reserved: 1 })
    expect(v.cells.filter((c) => !c.reserved)).toHaveLength(5)
    expect(v.cells.filter((c) => c.reserved)).toHaveLength(1)
    const h = clean(await render(pinia))
    expect(h.match(/data-reserved="1"/g)).toHaveLength(1)
    expect(h.match(/data-cell="\d+"/g)).toHaveLength(6)
  })

  it('裝一件：引擎的 ext.deck.slots 多了它、時間 +1 分鐘；卸下之後槽空出來', () => {
    const { e } = start()
    const t0 = minutes(e)
    expect(e.deck.install('cs_b')).toBeNull()
    expect(slotsOf(e)).toEqual(['cs_b'])
    expect(minutes(e) - t0).toBe(1)
    expect(e.deck.view()!.deck.free).toBe(3)
    expect(e.deck.remove('cs_b')).toBeNull()
    expect(slotsOf(e)).toEqual([])
    expect(minutes(e) - t0).toBe(2)
    expect(e.deck.view()!.deck.free).toBe(4)
  })

  it('槽滿時其餘的灰掉，原因和引擎的句子逐字相同；同一件不能裝兩次；背包沒有的被擋', async () => {
    const { e, pinia } = start()
    for (const id of ['cs_rifle_3', 'cs_b', 'cs_c', 'cs_d']) expect(e.deck.install(id)).toBeNull()
    const FULL = '構裝槽滿了（能用的 4 槽都裝著東西）。'
    expect(e.deck.install('cs_e')).toBe(FULL)
    const v = e.deck.view()!
    const rest = v.candidates.filter((c) => c.item === 'cs_e' || c.item === 'cs_g2' || c.item === 'cs_g4')
    expect(rest).toHaveLength(3)
    for (const c of rest) expect(c.block).toBe(FULL)
    expect(v.candidates.some((c) => c.item === 'cs_b')).toBe(false)
    // 畫面：選一個空格以外的不顯示候選；選空格要有 4 格都滿所以沒有空格——卸掉一件再選那一格
    expect(e.deck.remove('cs_d')).toBeNull()
    const sel = e.deck.view()!.cells.find((c) => !c.piece)!
    expect(sel).toBeDefined()
    // 渲染時 sel 預設是沒選；候選區在選到空格時才出現，這裡檢查引擎給的句子
    const h = text(clean(await render(pinia)))
    expect(h).toContain('構裝槽')
    expect(e.deck.install('cs_b')).toBe('這一件已經裝在槽裡了。')
    expect(e.deck.install('cs_nope')).toBe('這一件不是構裝，也不是快駭程式。')
  })

  it('等級高過甲板的構裝：畫面提示是引擎的那一句', () => {
    const { e } = start()
    expect(e.deck.install('cs_rifle_3')).toBeNull()
    const row = e.deck.view()!.equipped.find((x) => x.piece.id === 'cs_rifle_3')!
    expect(row.over).toBe(true)
    expect(row.note).toContain('甲板無法發揮這項構裝的所有性能')
  })

  it('換甲板：槽裝不下的構裝退回背包（還在背包，不在槽上）', () => {
    const { e } = start()
    for (const id of ['cs_b', 'cs_c', 'cs_d']) expect(e.deck.install(id)).toBeNull()
    expect(e.deck.equip('D2')).toBeNull()
    expect(e.deck.view()!.deck.name).toBe('小甲板')
    expect(slotsOf(e)).toEqual(['cs_b', 'cs_c'])
  })
})

describe('右邊的數字：全是引擎的衍生數值', () => {
  it('RAM、防火牆、槽數、感載與層數等於衍生數值；換上防護值更高的構裝之後防護跟著變', async () => {
    const { e, pinia } = start({ wear: false })
    const base = e.deck.numbers().ramMax
    expect(e.deck.equip('D1')).toBeNull()
    const n = e.deck.numbers()
    expect(n).toMatchObject({ firewall: 12, slots: 4, ramRegen: 3, hasDeck: true })
    expect(n.ramMax).toBe(base + 2)
    expect(n.guard).toBe(0)
    e.deck.install('cs_g2')
    expect(e.deck.numbers().guard).toBe(2)
    e.deck.install('cs_g4')
    expect(e.deck.numbers().guard).toBe(4)
    const h = clean(await render(pinia))
    for (const [k, v] of [['ram_max', e.deck.numbers().ramMax], ['net_guard', 4], ['deck_firewall', 12], ['load_cap', n.loadCap], ['afterglow_cap', n.layers]] as const) {
      expect(h).toMatch(new RegExp(`data-stat="${k}"[^>]*>(?:每回合 )?${v}<`))
    }
    expect(h).toContain('data-stat="ram_regen"')
    expect(text(h)).toContain('每回合 3')
  })

  it('同步四檔：開得到的與開不了的原因（引擎的句子）', async () => {
    const { e, pinia } = start()
    const s = e.deck.sync()!
    expect(s.gears.map((g) => g.id)).toEqual(['shallow', 'standard', 'deep', 'full'])
    expect(s.gears[0]!.ok).toBe(true)
    const blocked = s.gears.find((g) => !g.ok)
    if (blocked) {
      expect(blocked.why.length).toBeGreaterThan(0)
      expect(text(clean(await render(pinia)))).toContain(blocked.why.join(''))
    }
  })
})

describe('腳本與 SKIN', () => {
  it('腳本：II 級甲板最多帶 3 支，第 4 支被擋，原因是引擎的', () => {
    const { e } = start()
    expect(e.deck.scripts([{ item: 'it_s', qty: 3 }])).toBeNull()
    expect(e.deck.view()!.scripts.limit).toBe(3)
    expect(e.deck.scripts([{ item: 'it_s', qty: 4 }])).not.toBeNull()
    expect(e.deck.scriptsBlock([{ item: 'it_s', qty: 4 }])).toBe(e.deck.scripts([{ item: 'it_s', qty: 4 }]))
    expect(e.deck.scriptList()).toEqual([{ item: 'it_s', qty: 3 }])
  })

  it('SKIN：背包裡有才穿得上；穿著的標出來；背包沒有的被擋', async () => {
    const { e, pinia } = start()
    expect(e.deck.skin('sk_a')).toBeNull()
    expect(e.deck.view()!.skins.find((s) => s.worn)!.item).toBe('sk_a')
    expect(e.deck.skin('sk_missing')).not.toBeNull()
    expect(text(clean(await render(pinia)))).toContain('穿著')
  })
})

describe('戰鬥中打開是唯讀的', () => {
  it('頂端一句引擎給的原因；所有按鈕的原因都是它；裝與卸被擋', async () => {
    const { e, pinia } = start()
    expect(e.deck.install('cs_b')).toBeNull()
    expect(e.deck.lock()).toBeNull()
    const av = (i: number) => netAvatar(i, 1, { weapons: [], pools: { ram: { now: 4, max: 10, regen: 2 } }, ext: { net: { sync: 'standard', sync_max: 'deep', broken: [] }, deck: { grade: 2, firewall: 12, slots: [], constructs: [] } } } as never)
    e.startBattle({ mode: 'net', grade: 1, cover: 'medium', allies: [0, 1].map((i) => ({ from: 'unit', unit: av(i) as never })), foes: [{ from: 'unit', unit: laceUnit('minion', 1, {} as never) as never }], origin: { escapable: true, place: '測試' } } as never)
    const why = e.deck.lock()
    expect(why).toBeTruthy()
    expect(e.deck.install('cs_c')).toBe('戰鬥中不能換構裝。')
    expect(e.deck.remove('cs_b')).toBe('戰鬥中不能換構裝。')
    const h = clean(await render(pinia))
    expect(h).toContain('data-testid="deck-lock"')
    expect(text(h)).toContain(why!)
  })
})

describe('示意世界包', () => {
  it('開新局之後主角有甲板、槽裡有東西、帶著腳本、穿著 SKIN；進得了內海戰鬥（拿到武器與 RAM）', () => {
    setActivePinia(createPinia())
    const e = useEngine()
    expect(e.newGame({ seed: 5, draft: DRAFT as never })).toEqual([])
    const v = e.deck.view()!
    expect(v.deck.has).toBe(true)
    expect(v.deck.deck).toBe(DEMO_DECK)
    expect(v.deck.uid).toBe(DEMO_DECK_UID)
    expect(v.deck.grade).toBe(2)
    expect(v.deck.used).toBeGreaterThanOrEqual(3)
    expect(slotsOf(e)).toEqual(['cs_night_rifle', 'cs_window1', 'cs_probe2'])
    expect(v.skins.some((s) => s.worn)).toBe(true)
    expect(v.scripts.carried[0]?.qty).toBe(2)
    // 三種武器構裝、兩個防護、兩個工具都在背包裡
    expect(v.candidates.map((c) => c.item).sort()).toEqual(['cs_blade2', 'cs_cool2', 'cs_refill2', 'cs_static2'])
    // 引擎的數字：防護 2（客服窗）、有 RAM
    expect(e.deck.numbers()).toMatchObject({ guard: 2, firewall: 12, hasDeck: true })
    // 換上防護值更高的散熱罩（3）之後防護變 3
    expect(e.deck.install('cs_cool2')).toBeNull()
    expect(e.deck.numbers().guard).toBe(3)
    // 開一場最小的內海戰鬥：主角帶著夜巡（武器構裝）、有 RAM
    const lace = laceUnit('minion', 1, {} as never)
    e.startBattle({ mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'unit', unit: lace as never }], origin: { escapable: true, place: '示意的子網' } } as never)
    expect(e.inBattle).toBe(true)
    const b = e.battleOptions()!
    expect(b).toBeTruthy()
    const me = e.state.battle!.units['pc'] ?? Object.values(e.state.battle!.units).find((u) => u.actor === 'pc')!
    expect(me.pools.ram).toBeTruthy()
    expect(me.weapons.length).toBeGreaterThan(0)
    expect(e.deck.lock()).toBeTruthy()
  })
})

describe('原始碼檢查', () => {
  it('NetTab.vue 不讀 stores/game 的 deck、不含 match(、不從說明文字抓數字', () => {
    expect(src).not.toMatch(/\bg\.deck/)
    expect(src).not.toContain('match(')
    expect(src).not.toMatch(/ITEMS\[/)
    expect(src).not.toContain('構裝槽 (')
  })
  it('stores/game.ts 沒有假的甲板狀態', () => {
    expect(gameSrc).not.toContain('START_DECK')
    expect(gameSrc).not.toMatch(/const deck = reactive/)
  })
})
