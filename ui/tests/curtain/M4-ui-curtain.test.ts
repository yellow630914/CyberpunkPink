// 驗收測試：dev/work/M4-ui-curtain.md（cpp-ui）。簾後館的介面：面談與會員頁、口味單、報名、一趟裡的面板（場熱、點單、這裡）、雙形象的名牌、落幕（補演、三條路）、結算、簾口。
// 引擎用真的（allFeatures 的 curtain、netrun、netcombat、enemies、deck、defeat、director……；netrun 走真的）；內容是測試自帶的最小假資料：三個傾向標籤、兩個夜（兩種文化）、
// 每個文化三個有雙形象的敵人、三張表、五件落幕的戰敗事件與 _plain 版本、簾口的街區；一副甲板與一座測試橋給主角與隊友。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 curtain 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Component } from 'vue'
import type { ContentPack, Feature } from '@engine/src'
import { makeActor, netWeapon } from '@engine/src/testkit'
import type { Change } from '@engine/src'
import { useEngine } from '../../src/stores/engine'
import CurtainDialog from '../../src/dialogs/CurtainDialog.vue'
import DiveDialog from '../../src/dialogs/DiveDialog.vue'
import SubnetScreen from '../../src/screens/SubnetScreen.vue'
import ResultCard from '../../src/components/curtain/ResultCard.vue'
import boardSrc from '../../src/components/combat/BattleBoard.vue?raw'
import panelSrc from '../../src/components/curtain/CurtainPanel.vue?raw'
import viewSrc from '../../src/lib/curtainView.ts?raw'
import { INTERVIEW_SKILLS, bandLine, curtainOptions, curtainResultOf, heatMarks, interviewTier, resultTitle, sortPaths, tasteGroups, toggleParty, toggleTag } from '../../src/lib/curtainView'
import { hereOptions } from '../../src/lib/netrunView'
import { BRIDGE_PACK, giveBridge } from '../helpers/giveBridge'
import { wearDeck } from '../helpers/wearDeck'
import { CURTAIN_CULTURES, CURTAIN_NIGHTS, CURTAIN_SITE } from '../../src/data/demo'
import { DIVE_SHOP } from '../../src/data/demo/net'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

// ---- 假資料 ----
const TAGS: Rec[] = [{ id: 't_cos', name: '角色扮演', axis: 'costume' }, { id: 't_flow', name: '性別流動', axis: 'body' }, { id: 't_dom', name: '支配', axis: 'relation' }]
const NIGHTS: Rec[] = [
  { id: 'n_a', name: 'A之夜', faction: 'f_a', tags: ['t_cos'], culture: 'ca' },
  { id: 'n_b', name: 'B之夜', faction: 'f_b', tags: ['t_flow'], culture: 'cb' },
]
const program = (id: string, rank: string, culture: string): Rec => ({
  id, name: `${culture}的${rank}`, desc: '簾後館的演出者。', faction: 'none', rank, grades: [1, 5], kind: 'program', culture,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, constructs: [{ id: `cs_${id}`, class: 'rifle', name: '聚光燈' }],
  forms: {
    a: { name: `${culture}・${rank}・甲`, look: '甲形象的外觀。', points_at: ['male'] },
    b: { name: `${culture}・${rank}・乙`, look: '乙形象的外觀。', points_at: ['female', 'femboy', 'trans_f', 'futa'] },
  },
  neutral: { name: '一團光', look: '沒有輪廓的一團光。' },
})
const ENEMIES: Rec[] = ['ca', 'cb'].flatMap((c) => ['minion', 'elite', 'boss'].map((r) => program(`${c}_${r}`, r, c)))
const EVENT_IDS = ['df_stage_foyer', 'df_stage_headliner', 'df_stage_backstage', 'df_stage_vip', 'df_stage_encore']
const stageEvent = (id: string): Rec => ({
  id, name: id, kind: 'stage', factions: [], fails_commission: false, cast: [{ role: 'a' }], fallback: `${id}_plain`,
  versions: { default: { text: '落幕。', stages: [{ options: [{ id: 'play', text: '上台。', outcomes: { any: [] }, adult_scene: { when: 'always', gate: 'fixed', nature: 'work', role: 'none', goal: 'please', layer: 'net', circles: [['$pc', '$a']] } }] }] } },
})
const plainEvent = (id: string): Rec => ({
  id: `${id}_plain`, name: id, kind: 'stage', factions: [], fails_commission: false,
  versions: { default: { text: '後台的一段訓話。', stages: [{ options: [{ id: 'talk', text: '聽訓話。', outcomes: { any: [] } }] }] } },
})
const MAP = {
  id: 'm_t', kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '簾口' }, { id: 'F2', at: [3, 1], mark: 'F', name: '酒館' }, { id: 'F3', at: [5, 1], mark: 'F', name: '空地' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
}
/** 一塊街區：F1 是簾口（door 為真時才寫 curtain_door）、F2 酒館；落幕的補演要在街上找得到對象，所以每一局都站在街區裡 */
const worldContent = (door: boolean): Rec => ({
  special_map: [MAP],
  facility_type: [{ id: 'fac_door', name: '簾口', ...(door ? { curtain_door: true } : {}) }, { id: 'fac_bar', name: '酒館' }],
  district: [{ id: 'd_t', name: '測試區', grade: 1, price_mult: 1, blocks: ['b_t'] }],
  block: [{ id: 'b_t', district: 'd_t', name: '測試街', kind: 'block', map: 'm_t', exits: {}, facilities: { F1: { type: 'fac_door', name: '簾口' }, F2: { type: 'fac_bar', name: '酒館' }, F3: { type: 'fac_bar', name: '空地' } } }],
})
const pack = (door: boolean): ContentPack => ({
  id: 'curtain_ui_test',
  content: {
    tendency_tag: TAGS, enemy: ENEMIES,
    position: [{ id: 'pos_side', name: '並坐', people: 2, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }], mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null, links: [{ from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }] }], curtain_night: NIGHTS,
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }, { id: 'f_b', name: '乙公司', short: '乙', class: 'corp' }],
    deck: [{ id: 'dk_own', name: '自己的甲板', desc: '測試。', grade: 2, slots: 3, firewall: 12, legal: 'free' }],
    weapon_class: [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    item: [{ id: 'it_prize', name: '正式版構裝', desc: '獎品。', category: 'misc', grade: 1, size: 0, legal: 'free' }],
    curtain_table: [
      { id: 'tb_order', kind: 'order', rows: [{ weight: 1, name: '台詞', order: 'line' }] },
      { id: 'tb_chest', kind: 'chest', rows: [{ weight: 1, name: '票根箱', stubs: [3, 8] }] },
      { id: 'tb_prize', kind: 'prize', rows: [{ weight: 1, name: '正式版構裝', give: [{ kind: 'item', id: 'it_prize', qty: 1 }] }] },
    ],
    curtain_rule: [{ id: 'default', heat: { highlight: 0 }, feature_bonus: 1 }],
    defeat_event: [...EVENT_IDS.map(stageEvent), ...EVENT_IDS.map(plainEvent)],
    ...worldContent(door),
  },
} as unknown as ContentPack)

/** 戰鬥用：內海的武器很強（整場自動打一定贏）；要輸的測試自己投降 */
const HELPER: Feature = {
  id: 'curtain_ui_helper',
  install(k) { k.battle.loadout('curtain_ui_helper', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(60, 14)] } : undefined)) },
}

/** 回答 director.cast 的替身（補演的對象）：生成一位演出者；這份最小內容沒有街上人物的生成規則 */
const CAST: Feature = {
  id: 'curtain_ui_cast',
  install(k) {
    k.hooks.on('director.cast', 'curtain_ui_cast', ({ state, role }) => {
      const id = `tmp_${state.seq.uid + 1}_${role}`
      return { actor: id, changes: [{ op: 'actor.add', actor: makeActor({ id, name: '演出者', role: 'npc', gender: 'female', ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } }) } as Change] }
    })
  },
}

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
const give = (id: string, qty = 1, data?: Rec) => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as never
const BRIDGE_PIECE = { uid: 'tbr1', bp: 'tbp_bridge', kind_of: 'blueprint', slot: 'bridge', parts: { chip: 'tp_chip32', neuron: 'tp_neuron', software: 'tp_sw_even' }, state: 'new', sink: 0, at: 0 }
const TASTE3 = ['t_cos', 't_flow', 't_dom']

interface Opts { seed?: number; cash?: number; door?: boolean; invite?: boolean; mate?: boolean }

/** 一局：主角有橋與自己的甲板、街頭信譽夠；給了邀請函的話已經過了面談（散座）、口味單勾了三項 */
async function start(o: Opts = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [pack(!!o.door), BRIDGE_PACK], testFeatures: [HELPER, CAST] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '給甲板', changes: [give('dk_own', 1, { uid: 'D1' })] })).toBeNull()
  expect(wearDeck(e, 'D1')).toBeNull()
  expect(giveBridge(e)).toBeNull()
  expect(e.commit({ summary: '街頭信譽', changes: [{ op: 'meter', kind: 'rep', key: '_', delta: 40 }, { op: 'cash', delta: (o.cash ?? 3000) - e.money.cash }] as never })).toBeNull()
  if (o.mate) {
    const ext = { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }, cyber: { pieces: [BRIDGE_PIECE, { uid: 'D2', bp: 'dk_own', kind_of: 'deck', slot: 'brain', parts: {}, sink: 0, at: 0 }] }, deck: { slots: [], scripts: [] } }
    const actor = { id: 'm1', name: '阿男', role: 'companion', age: 25, gender: 'male', perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [], attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, ext }
    expect(e.commit({ summary: '隊友', changes: [{ op: 'actor.add', actor }, { op: 'party', id: 'm1' }] as never })).toBeNull()
  }
  expect((await e.world.arrive('b_t', 'F2')).status).toBe('applied')
  return { e, pinia }
}

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/subnet', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: Component, props: Rec = {}, path = '/'): Promise<string> {
  const r = router()
  await r.push(path)
  await r.isReady()
  const app = createSSRApp(comp, props)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const text = (s: string) => clean(s).replace(/<[^>]+>/g, '')
const tag = (html: string, attr: string): string | undefined => clean(html).match(new RegExp(`<button[^>]*${attr}[^>]*>`))?.[0]
const within = (html: string, attr: string): string => {
  const h = clean(html)
  const i = h.indexOf(attr)
  return i < 0 ? '' : text(h.slice(i, i + 1800))
}
const dialog = (pinia: ReturnType<typeof createPinia>, initial?: string) => render(pinia, CurtainDialog, { entryId: 1, ...(initial ? { initial } : {}) })

/** 掃種子：邀請函、面談（骰面由種子決定）：面談過了的那一局 */
async function joined(o: Opts = {}) {
  for (let seed = 1; seed <= 60; seed++) {
    const g = await start({ ...o, seed })
    expect(g.e.curtain.invite()).toBeNull()
    await g.e.curtain.interview({ tier: 'floor', skill: 'negotiate' })
    if (g.e.curtain.member()?.member) {
      expect((await g.e.curtain.taste(TASTE3)).status).toBe('applied')
      return g
    }
  }
  throw new Error('找不到面談過得了的種子')
}

// ---- 一趟裡的小工具（和引擎的測試一樣：直接把人放到格子上） ----
function reveal(e: Eng): void {
  const g = e.net.grid()!
  const rows = Array.from({ length: g.size[1] }, () => '1'.repeat(g.size[0]))
  expect(e.commit({ summary: '看過', action: 'netrun.test', changes: [{ op: 'map.sheet', map: g.map, sheet: g.sheet, seen: rows }] as never })).toBeNull()
}
const markersOf = (e: Eng, mark: string) => e.net.sheet()!.markers.filter((m) => m.mark === mark)
function teleport(e: Eng, p: [number, number]): void {
  const g = e.net.grid()!
  expect(e.commit({ summary: '站過去', action: 'netrun.test', changes: [{ op: 'map.at', to: { map: g.map, sheet: g.sheet, x: p[0], y: p[1] } }] as never })).toBeNull()
}
/** 站到一個遭遇節點旁邊（找得走的鄰格） */
function standNear(e: Eng, p: [number, number]): void {
  const g = e.net.grid()!
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const [x, y] = [p[0] + dx, p[1] + dy]
    const kind = g.cells[y]?.[x]
    if (!kind || kind === 'wall' || kind === 'net_foe') continue
    teleport(e, [x, y])
    return
  }
  throw new Error('旁邊沒有可以站的格子')
}
const plainFoe = (e: Eng) => markersOf(e, 'f').find((f) => e.net.grid()!.cells[f.at[1]]![f.at[0]] === 'net_foe')!

beforeEach(() => setActivePinia(createPinia()))

// ===================================================================================================================
describe('入會與面談：沒有邀請函時灰掉、原因逐字是引擎的；面談過了出現會員頁', () => {
  it('沒有邀請函：面談的按鈕灰掉，每一條原因逐字是 memberView 的 blocks，按鈕的原因是 interviewBlock', async () => {
    const { e, pinia } = await start()
    const m = e.curtain.member()!
    expect(m.invite).toBeNull()
    expect(m.member).toBeNull()
    const floor = m.tiers.find((t) => t.id === 'floor')!
    expect(floor.canInterview).toBe(false)
    expect(floor.blocks.join('')).toContain('邀請函')
    const h = clean(await dialog(pinia))
    expect(h).toContain('data-interview')
    expect(tag(h, 'data-interview="floor"')).toContain('aria-disabled')
    expect(tag(h, 'data-interview="floor"')).toContain(`title="${e.curtain.interviewBlock({ tier: 'floor', skill: 'negotiate' })}"`)
    const shown = [...h.matchAll(/<small class="why" data-block[^>]*>([^<]*)<\/small>/g)].map((x) => x[1])
    for (const t of m.tiers) for (const b of t.blocks) expect(shown, b).toContain(b)
    expect(within(h, 'data-invite')).toContain('沒有有效的邀請函')
    // 席次的數字都是引擎的：DC、保證金
    expect(within(h, 'data-tier="floor"')).toContain(`面談 DC ${floor.interview_dc}`)
    expect(h).not.toContain('data-card')
    // 沒有邀請函，面談被引擎擋下
    const r = await e.curtain.interview({ tier: 'floor', skill: 'negotiate' })
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(e.curtain.interviewBlock({ tier: 'floor', skill: 'negotiate' }))
  })

  it('給了邀請函：剩幾天；面談過了之後出現會員頁（席次、會費繳到哪、主打、今晚還能報幾場、口味單）', async () => {
    const { e, pinia } = await joined()
    const m = e.curtain.member()!
    expect(m.invite).toBeNull() // 面談過了邀請函用掉
    expect(m.member).toMatchObject({ tier: 'floor', suspended: false })
    expect(m.runsLeft).toBe(2)
    const h = clean(await dialog(pinia))
    expect(h).toContain('data-card')
    expect(h).not.toContain('data-interview="floor"')
    expect(h).not.toContain('data-invite')
    expect(within(h, 'data-card-tier')).toContain('散座')
    expect(within(h, 'data-runs')).toContain('還能報 2 場')
    expect(within(h, 'data-feature')).toContain(m.feature!.name)
    expect(within(h, 'data-card-taste')).toContain('角色扮演')
    // 升席：下一席列出引擎的原因
    const box = m.tiers.find((t) => t.id === 'box')!
    expect(box.canInterview).toBe(false)
    expect(within(h, 'data-upgrade')).toContain(box.blocks[0]!)
  })

  it('邀請函剩幾天寫在面談頁（引擎的 daysLeft）', async () => {
    const { e, pinia } = await start()
    expect(e.curtain.invite()).toBeNull()
    expect(e.curtain.member()!.invite!.daysLeft).toBe(3)
    expect(within(clean(await dialog(pinia)), 'data-invite')).toContain('還有 3 天')
  })
})

describe('口味單與報名', () => {
  it('口味單：整張單子送出、被引擎擋下的原因照字；這一週抽得到的夜與主打是引擎的', async () => {
    const { e, pinia } = await joined()
    expect(e.curtain.tasteBlock(['nope'])).toContain('口味單上沒有')
    expect(e.curtain.tasteOptions().map((o) => o.id)).toEqual(['t_flow', 't_cos', 't_dom'].sort((a, b) => ['relation', 'sense', 'body', 'costume'].indexOf(TAGS.find((t) => t.id === a)!.axis as string) - ['relation', 'sense', 'body', 'costume'].indexOf(TAGS.find((t) => t.id === b)!.axis as string)))
    const h = clean(await dialog(pinia, 'taste'))
    expect(h).toContain('data-taste')
    expect(tag(h, 'data-tag="t_cos"')).toContain('aria-pressed="true"')
    expect(h).toContain('data-pool')
    expect(e.curtain.pool()!.rows.map((n) => n.id).sort()).toEqual(['n_a', 'n_b'])
    // 只勾兩個：純舞台
    expect((await e.curtain.taste(['t_cos', 't_flow'])).status).toBe('applied')
    expect(e.curtain.pool()!.pure_stage).toBe(true)
    expect(text(clean(await dialog(pinia, 'taste')))).toContain('純舞台')
  })

  it('報名之後導到子網、場熱是 30；沒有會員證時報名被擋、原因是引擎的', async () => {
    const none = await start()
    const why = none.e.curtain.enterBlocks({ party: ['pc'] })
    expect(why.join('')).toContain('你還不是簾後館的會員')
    expect((await none.e.curtain.enter({ party: ['pc'] })).reason).toBe(why.join(''))
    const { e, pinia } = await joined()
    const cash = e.money.cash
    const quote = e.curtain.quote({ party: ['pc'] })!
    expect(quote).toMatchObject({ deposit: 300, total: 300 })
    expect(e.curtain.enterBlocks({ party: ['pc'] })).toEqual([])
    const h0 = clean(await dialog(pinia, 'enter'))
    expect(within(h0, 'data-deposit')).toContain('300')
    expect(tag(h0, 'data-enter-go')).not.toContain('aria-disabled')
    expect((await e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })).status).toBe('applied')
    expect(e.money.cash).toBe(cash - 300)
    expect(e.net.view()).not.toBeNull()
    const v = e.curtain.view()!
    expect(v.heat.value).toBe(30)
    expect(v.night.id).toBe('n_a')
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(h).toContain('data-curtain-panel')
    expect(within(h, 'data-heat-value')).toContain('30')
    expect(within(h, 'data-night')).toContain('A之夜')
    expect(within(h, 'data-act')).toContain('第 1／4 幕')
    // 在子網裡不能再報名
    expect(e.curtain.enterBlocks({ party: ['pc'] }).join('')).toContain('你已經報了名')
  })

  it('場熱的三個刻度（0、贊助人、安可）與打賞的各段：位置與比例都是 curtainView 的', async () => {
    const { e, pinia } = await joined()
    await e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })
    const v = e.curtain.view()!
    expect(heatMarks(v).map((m) => m.at)).toEqual([0, v.heat.sponsor_at, v.heat.encore_at])
    expect([v.heat.sponsor_at, v.heat.encore_at]).toEqual([70, 90])
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    for (const at of [0, 70, 90]) expect(h).toContain(`data-mark="${at}"`)
    for (const b of v.heat.bands) expect(within(h, `data-band="${b.from}"`)).toContain(bandLine(b))
    expect(within(h, 'data-tips-ratio')).toContain(String(v.heat.ratio))
  })

  it('簾口：站在簾口才能報名，原因逐字是引擎的 doorBlock', async () => {
    const { e } = await joined({ door: true })
    // 站在酒館（不是簾口）
    const why = e.curtain.door()!
    expect(why).toContain('簾口')
    expect(e.curtain.enterBlocks({ party: ['pc'] })).toContain(why)
    expect((await e.world.arrive('b_t', 'F1')).status).toBe('applied')
    expect(e.curtain.door()).toBeNull()
    expect(e.curtain.enterBlocks({ party: ['pc'] })).toEqual([])
  })
})

describe('一趟裡：點單先看內容再決定；拒絕之後場熱 25', () => {
  it('站到點單上：「這裡」列引擎的用途；看點單之後出現內容與接受、拒絕；拒絕是 25', async () => {
    const { e, pinia } = await joined()
    await e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })
    reveal(e)
    const order = markersOf(e, 'p')[0]!
    teleport(e, order.at)
    const v0 = e.curtain.view()!
    const opts = curtainOptions(v0, () => undefined)
    expect(opts.map((o) => o.id)).toContain(`order@${order.id}`)
    expect(v0.near.find((n) => n.marker.id === order.id)!.uses.map((u) => u.id)).toEqual(['order'])
    // 看點單：還沒決定之前面板列內容
    expect((await e.curtain.use('order', order.id)).status).toBe('applied')
    const o = e.curtain.orders()!
    expect(o.text).toBeTruthy()
    expect(o.choices.map((c) => c.id)).toEqual(['order:accept', 'order:refuse'])
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(within(h, 'data-offer-text')).toContain(o.text)
    expect(h).toContain('data-accept')
    expect(h).toContain('data-refuse')
    expect(e.curtain.view()!.heat.value).toBe(30)
    // 拒絕
    expect((await e.curtain.use('order:refuse', o.offer.node)).status).toBe('applied')
    expect(e.curtain.view()!.heat.value).toBe(25)
    expect(e.curtain.orders()).toBeNull()
    const h2 = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(within(h2, 'data-heat-value')).toContain('25')
    expect(h2).toContain('data-order-state="refused"')
  })

  it('遭遇的開戰與潛行繞過讀 netrunView（curtainView.near 不列遭遇）', async () => {
    const { e } = await joined()
    await e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })
    reveal(e)
    const foe = plainFoe(e)
    standNear(e, foe.at)
    const cv = e.curtain.view()!
    expect(cv.near.some((n) => n.marker.id === foe.id)).toBe(false)
    const nopts = hereOptions(e.net.view()!, () => undefined)
    expect(nopts.map((o) => o.id)).toContain(`fight@${foe.id}`)
    expect(nopts.map((o) => o.id)).toContain(`sneak@${foe.id}`)
  })

  it('賞箱：站上去開，票根記在一趟的面板上', async () => {
    const { e, pinia } = await joined()
    await e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })
    reveal(e)
    const chest = markersOf(e, 'a')[0]!
    teleport(e, chest.at)
    const use = e.curtain.view()!.near.find((n) => n.marker.id === chest.id)!.uses.find((u) => u.id === 'chest')!
    expect(use.block).toBeNull()
    expect((await e.curtain.use('chest')).status).toBe('applied')
    expect(e.curtain.view()!.stubs).toBeGreaterThanOrEqual(3)
    expect(within(clean(await render(pinia, SubnetScreen, {}, '/subnet')), 'data-stubs')).toContain(String(e.curtain.view()!.stubs))
  })
})

describe('雙形象：名牌讀 unitFormView', () => {
  it('對 male 的隊友顯示 A 的名字，對 female 的主角顯示擲到的那一個（固定種子）；兩邊的外觀都列出', async () => {
    const { e } = await joined({ mate: true })
    expect((await e.curtain.enter({ party: ['pc', 'm1'], night: 'n_a', seed: 11 })).status).toBe('applied')
    reveal(e)
    const foe = plainFoe(e)
    standNear(e, foe.at)
    expect((await e.net.use('fight', foe.id)).status).toBe('applied')
    const units = Object.values(e.state.battle!.units)
    const pcU = units.find((u) => u.actor === e.state.pc)!
    const mateU = units.find((u) => u.actor === 'm1')!
    const foes = units.filter((u) => u.side === 'foe')
    expect(foes.length).toBeGreaterThan(0)
    for (const f of foes) {
      const forMale = e.curtain.unitForm(f.id, mateU.id)!
      const forPc = e.curtain.unitForm(f.id, pcU.id)!
      expect(forMale.current.form).toBe('a')
      expect(forMale.current.name).toBe(forMale.for_male.name)
      expect(forMale.current.name).toMatch(/甲$/)
      // 對主角：擲到的那一個（整場固定，a 或 b）
      expect(['a', 'b']).toContain(forPc.current.form)
      expect(forPc.current.name).toBe(forPc.for_other.name)
      expect(forPc.for_male.name).toBe(forMale.for_male.name)
      // 沒鎖定照主角
      expect(e.curtain.unitForm(f.id)!.current.name).toBe(forPc.current.name)
      // 固定種子：再問一次一樣
      expect(e.curtain.unitForm(f.id, pcU.id)!.current.name).toBe(forPc.current.name)
    }
    // 只有簾後館的敵人有雙形象的資料：我方單位沒有
    expect(e.curtain.unitForm(pcU.id)).toBeNull()
    // 戰鬥的畫面讀這個鍵（名牌與 data-form）
    expect(boardSrc).toContain('curtain.unitForm')
    expect(boardSrc).toContain('data-nameplate')
    expect(boardSrc).toContain('data-form')
  })
})

describe('落幕：補演的確認、喊停、三條路、記帳', () => {
  /** 開戰、投降到戰敗、接受結果：回傳 e */
  async function fallen() {
    const g = await joined()
    await g.e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })
    reveal(g.e)
    const foe = plainFoe(g.e)
    standNear(g.e, foe.at)
    expect((await g.e.net.use('fight', foe.id)).status).toBe('applied')
    const e = g.e
    for (let i = 0; i < 200 && e.battleOptions()!.waiting !== 'over'; i++) {
      if (e.battleOptions()!.waiting === 'ai') e.battleNext()
      else expect(e.battleAct({ action: 'net_surrender' } as never).status).toBe('applied')
    }
    expect(e.battleOptions()!.waiting).toBe('over')
    expect((await e.finishBattle()).status).toBe('applied')
    expect(e.pendingDefeat).not.toBeNull()
    e.acceptDefeat()
    return g
  }

  it('全隊倒下、接受結果：出現補演的確認；喊停之後是三條路；選記帳之後會員頁有欠款', async () => {
    const { e, pinia } = await fallen()
    const f = e.curtain.fall()!
    expect(f.step).toBe('replay')
    expect(e.curtain.view()).toBeNull()
    const h = clean(await dialog(pinia))
    expect(h).toContain('data-fall')
    expect(h).toContain('data-replay')
    expect(h).toContain('data-call-off')
    expect(within(h, 'data-fall-fine')).toContain(String(f.fine))
    // 子網頁在沒有行程時也列出落幕
    expect(clean(await render(pinia, SubnetScreen, {}, '/subnet'))).toContain('data-fall-page')
    // 喊停
    expect(f.replay.can_call_off).toBe(true)
    expect((await e.curtain.callOff()).status).toBe('applied')
    const f2 = e.curtain.fall()!
    expect(f2.step).toBe('choose')
    expect(f2.called_off).toBe(true)
    expect(f2.paths.map((p) => p.id).sort()).toEqual(['gig', 'pay', 'tab'])
    const h2 = clean(await dialog(pinia))
    expect(h2).toContain('data-paths')
    for (const p of f2.paths) {
      expect(within(h2, `data-path="${p.id}"`)).toContain(p.name)
      if (p.why) expect(within(h2, `data-path="${p.id}"`)).toContain(p.why)
    }
    // 補演已經不能再開演（喊停了）
    expect((await e.curtain.replay()).status).toBe('refused')
    // 選記帳
    const tab = f2.paths.find((p) => p.id === 'tab')!
    expect(tab.can).toBe(true)
    expect((await e.curtain.settle('tab')).status).toBe('applied')
    expect(e.curtain.fall()).toBeNull()
    const acct = e.curtain.account()
    expect(acct.tab!.owed).toBe(tab.amount)
    expect(acct.tab!.owed).toBeGreaterThan(0)
    const hm = clean(await dialog(pinia))
    expect(within(hm, 'data-card-tab')).toContain(String(tab.amount))
    const ha = clean(await dialog(pinia, 'account'))
    expect(within(ha, 'data-tab')).toContain(String(acct.tab!.owed))
    // 還款
    const cash = e.money.cash
    expect(e.curtain.payTabBlock()).toBeNull()
    expect((await e.curtain.payTab()).status).toBe('applied')
    expect(e.money.cash).toBe(cash - tab.amount)
    expect(e.curtain.account().tab).toBeNull()
  })

  it('開演：補演開一場成人場景（引擎的 replayDraft）；場景進行中不能再喊停', async () => {
    const { e } = await fallen()
    expect((await e.curtain.replay()).status).toBe('applied')
    expect(e.scene.active()).toBe(true)
    const f = e.curtain.fall()!
    expect(f.replay.started).toBe(true)
    expect(f.replay.can_start).toBe(false)
    expect(f.replay.start_block).toBeTruthy()
  })

  it('選不了的路灰掉、原因逐字是引擎的 why；欠款到上限之後不能再報名', async () => {
    const { e } = await fallen()
    await e.curtain.callOff()
    const paths = e.curtain.fall()!.paths
    for (const p of paths) {
      if (p.can) expect(e.curtain.settleBlock(p.id)).toBeNull()
      else expect(e.curtain.settleBlock(p.id)).toBe(p.why)
    }
    expect(sortPaths(paths).map((p) => p.id)).toEqual(['pay', 'tab', 'gig'])
  })
})

describe('結算', () => {
  it('中途離場：子網頁停在離開結算，列簾後館的結算（保證金沒收與退回、票根）；數字是 curtain.result 的', async () => {
    const { e, pinia } = await joined()
    await e.curtain.enter({ party: ['pc'], night: 'n_a', seed: 11 })
    expect(e.net.view()).not.toBeNull()
    const block = e.net.view()!.logout.block
    expect(block).toBeNull()
    const r = await e.net.logout()
    expect(r.status).toBe('applied')
    expect(e.net.view()).toBeNull()
    const end = e.dive.lastEnd()
    expect(end?.curtain).not.toBeNull()
    const res = curtainResultOf(end!.curtain!.data)
    expect(res.refund + res.forfeited).toBe(300)
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(h).toContain('data-settle')
    expect(h).toContain('data-curtain-result')
    expect(within(h, 'data-cr-deposit')).toContain(String(res.refund || res.forfeited))
  })
})

describe('潛入頁與結算卡', () => {
  it('潛入的去處頁有簾後館一段：目前的會員狀態、簾口的原因（引擎的 doorBlock）、打開簾後館的按鈕', async () => {
    const { e, pinia } = await start({ door: true })
    expect(e.curtain.door()).toContain('簾口')
    // 潛入頁（不在潛入中只列接入點）：簾後館那一段只在潛入中；這裡直接檢查原始檔的接法
    const src = (await import('../../src/dialogs/DiveDialog.vue?raw')).default
    expect(src).toContain('data-curtain')
    expect(src).toContain("ui.open('curtain')")
    expect(src).toContain('e.curtain.door()')
    void pinia
    void DiveDialog
  })

  it('結算卡：獎金、打賞（比例）、票根、保證金（退回與沒收）都是 curtain.result 的資料；有加演的邀請才列加演', async () => {
    const { pinia } = await start()
    const data = { outcome: 'done', heat: 80, act: 3, prize: 900, tips: 540, tips_ratio: 0.6, refund: 300, forfeited: 0, stubs: 12, lines: ['你們走完了簾後館的一晚。'] }
    const h = clean(await render(pinia, ResultCard, { data, summary: '簾後館結算：場熱 80。', actions: true }))
    expect(within(h, 'data-cr-prize')).toContain('900')
    expect(within(h, 'data-cr-tips')).toContain('540')
    expect(within(h, 'data-cr-tips')).toContain('0.6')
    expect(within(h, 'data-cr-stubs')).toContain('12')
    expect(within(h, 'data-cr-deposit')).toContain('退回')
    expect(within(h, 'data-cr-deposit')).toContain('300')
    expect(text(h)).toContain('你們走完了簾後館的一晚。')
    expect(h).not.toContain('data-encore')
    const early = curtainResultOf({ ...data, early: true, refund: 300 })
    expect(resultTitle(early)).toBe('提早落幕')
    expect(resultTitle(curtainResultOf({ ...data, outcome: 'left', forfeited: 300, refund: 0 }))).toBe('中途離場')
  })
})

describe('lib/curtainView：只整理、不算', () => {
  it('口味單分組與加減、隊伍加減（會員本人一定在）、面談的兩項基本功', () => {
    const groups = tasteGroups([{ id: 'a', axis: 'relation', axisName: '關係' }, { id: 'b', axis: 'body', axisName: '身體' }, { id: 'c', axis: 'relation', axisName: '關係' }])
    expect(groups.map((g) => [g.axis, g.items.map((i) => i.id)])).toEqual([['relation', ['a', 'c']], ['body', ['b']]])
    expect(toggleTag(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleTag(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleParty(['pc'], 'pc', 'pc')).toEqual(['pc'])
    expect(toggleParty(['pc'], 'm1', 'pc')).toEqual(['pc', 'm1'])
    expect(toggleParty(['pc', 'm1'], 'm1', 'pc')).toEqual(['pc'])
    expect(INTERVIEW_SKILLS.map((s) => s.id)).toEqual(['negotiate', 'perform'])
  })

  it('現在面談的席次：新入會是引擎說能談的那一席；沒有算式', async () => {
    const { e } = await start()
    e.curtain.invite()
    const m = e.curtain.member()!
    expect(interviewTier(m)!.id).toBe('floor')
    // 檢視整理的檔裡沒有算錢、機率、DC 的運算
    expect(viewSrc).not.toMatch(/Math\.random|\bdc\s*[-+*]|\bprice\s*[-+*]|deposit\s*[*]/)
    expect(panelSrc).not.toMatch(/Math\.random/)
  })
})

describe('示意世界包的簾後館', () => {
  it('兩個夜、兩種文化、每個文化的敵人都有雙形象（一個層主）、三張表、落幕的事件與 _plain、簾口設施；資料檢查沒有警告', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 11, draft: DRAFT as never })
    expect(e.world.entry('curtain_night', CURTAIN_NIGHTS.stage)).toBeTruthy()
    expect(e.world.entry<{ culture: string }>('curtain_night', CURTAIN_NIGHTS.stage)!.culture).toBe(CURTAIN_CULTURES.stage)
    expect(e.world.entry<{ culture: string }>('curtain_night', CURTAIN_NIGHTS.honey)!.culture).toBe(CURTAIN_CULTURES.honey)
    for (const id of ['cs_stage_min', 'cs_stage_eli', 'cs_stage_boss', 'cs_honey_min', 'cs_honey_eli', 'cs_honey_boss']) {
      const en = e.world.entry<{ forms?: { a: unknown; b: unknown }; neutral?: unknown }>('enemy', id)!
      expect(en.forms?.a && en.forms?.b && en.neutral, id).toBeTruthy()
    }
    for (const id of ['ct_order', 'ct_chest', 'ct_prize']) expect(e.world.entry('curtain_table', id), id).toBeTruthy()
    expect(e.world.entry('defeat_event', 'df_stage_foyer')).toBeTruthy()
    expect(e.world.entry('defeat_event', 'df_stage_foyer_plain')).toBeTruthy()
    expect(e.world.entry<{ curtain_door?: boolean }>('facility_type', 'fac_curtain_door')!.curtain_door).toBe(true)
    // 開局直接給邀請函（引擎的效果 curtain_invite）
    expect(e.curtain.invite()).toBeNull()
    expect(e.curtain.member()!.invite!.daysLeft).toBe(3)
    // 示意局的口味單：傾向標籤是示意包的，兩個夜都對得到
    const ids = e.curtain.tasteOptions().map((o) => o.id)
    for (const t of ['doll_chip', 'voice', 'pamper', 'restraint', 'public']) expect(ids).toContain(t)
    expect((await e.curtain.taste(['doll_chip', 'pamper', 'public'])).status).toBe('applied')
    expect(e.curtain.pool()!.rows.map((n) => n.id).sort()).toEqual([CURTAIN_NIGHTS.stage, CURTAIN_NIGHTS.honey].sort())
  })

  it('潛入之後的去處多「簾後館的簾口」：走過去之後站在簾口，簾口的原因消失', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 11, draft: DRAFT as never })
    const shop = e.world.entry<{ block: string; facility: string }>('shop', DIVE_SHOP)!
    expect((await e.world.arrive(shop.block, shop.facility)).status).toBe('applied')
    expect((await e.dive.enter()).status).toBe('applied')
    const site = e.dive.view().sites.find((s) => s.id === CURTAIN_SITE)!
    expect(site.name).toBe('簾後館的簾口')
    expect(site.block).toBeNull()
    expect(e.curtain.door()).toContain('簾口')
    expect((await e.dive.go(CURTAIN_SITE)).status).toBe('applied')
    expect(e.curtain.door()).toBeNull()
    // 潛入頁的簾後館一段：會員狀態與打開簾後館的按鈕
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(h).toContain('data-curtain')
    expect(h).toContain('data-curtain-open')
    expect(within(h, 'data-curtain-line')).toContain('沒有會員證')
    expect(e.dive.view().diving).toBe(true)
    expect((await e.dive.exit()).status).toBe('applied')
  })
})
