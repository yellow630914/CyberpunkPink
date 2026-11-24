// 驗收測試：dev/work/M3-ui-dive.md（cpp-ui）。潛入與登出：接入點上的選項與費用、潛入之後的去處、自己去挖的子網、迷宮館報名與結算、登出、潛入中現實的操作被擋。
// 引擎用真的（allFeatures 的 dive、netrun、maze、deck、enemies、world……）；內容是測試自帶的最小假資料：一塊街區兩間設施（潛艙店帶 dive、一間不帶）、
// 一副租用甲板、三筆去處、一座子網的區與設施類型、迷宮館的規則表與表、三個遊戲敵人、三隻假蕾絲。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 dive／maze 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Component } from 'vue'
import type { ContentPack, Feature } from '@engine/src'
import { netWeapon } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import DiveDialog from '../../src/dialogs/DiveDialog.vue'
import RestDialog from '../../src/dialogs/RestDialog.vue'
import SubnetScreen from '../../src/screens/SubnetScreen.vue'
import diveSrc from '../../src/dialogs/DiveDialog.vue?raw'
import endSrc from '../../src/components/EndCard.vue?raw'
import viewSrc from '../../src/lib/diveView.ts?raw'
import { bracketKey, bracketRule, costParts, deckLine, endParts, keptLine, mazeResultOf, sortSites } from '../../src/lib/diveView'
import { lifeDialogOf } from '../../src/lib/lifeView'
import { DIG_SITE, DIVE_SHOP } from '../../src/data/demo/net'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

// ---- 假資料 ----
const lace = (id: string, rank: string, color: string): Rec => ({
  id, name: `測試${id}`, desc: '測試用的網內敵人。', faction: 'f_a', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
const program = (id: string, rank: string): Rec => ({
  id, name: `遊戲敵人${id}`, desc: '迷宮館的遊戲敵人。', faction: 'maze', rank, grades: [1, 5], kind: 'program',
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
const COUNTS0 = { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] }
const DIGNET = {
  id: 'sub_dig', name: '測試挖的網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22], oneway: 0.5, fragile: 0.5, loops: 2,
  layer: { ...COUNTS0, foe: [1, 1], rest: [1, 1], archive: [1, 1] }, commission: { ...COUNTS0, foe: [1, 1] }, archive_table: [{ weight: 1, name: '舊檔', give: [{ kind: 'item', id: 'it_chip', qty: 1 }] }], affixes: [],
}
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }]
const MAP = {
  id: 'm_t', kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '潛艙店' }, { id: 'F2', at: [3, 1], mark: 'F', name: '雜貨店' }, { id: 'F3', at: [5, 1], mark: 'F', name: '空地' }, ...E],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
}
const PACK: ContentPack = {
  id: 'dive_ui_test',
  content: {
    special_map: [MAP],
    facility_type: [
      { id: 'fac_pod', name: '潛艙店', functions: ['dive'], dive: { fee: 30, rental: 'dk_rent', deposit: 50, safe: 1 } },
      { id: 'fac_plain', name: '商店' },
    ],
    district: [{ id: 'd_t', name: '測試區', grade: 1, price_mult: 1, blocks: ['b_t'] }],
    block: [{ id: 'b_t', district: 'd_t', name: '測試街', kind: 'block', map: 'm_t', exits: {}, facilities: { F1: { type: 'fac_pod', name: '潛艙店「測試」' }, F2: { type: 'fac_plain', name: '雜貨店' }, F3: { type: 'fac_plain', name: '空地' } } }],
    construct: [{ id: 'cs_kit', class: 'weapon', name: '比賽版構裝', desc: '館方的比賽版。', grade: 1, brand: '館', ram: 1, type: 'neural', archetype: 'rifle', legal: 'free' }],
    deck: [{ id: 'dk_rent', name: '租用甲板', desc: '租的。', grade: 1, slots: 2, firewall: 10, legal: 'free' }],
    item: [{ id: 'it_chip', name: '舊晶片', desc: '一枚舊晶片。', category: 'misc', grade: 1, size: 0, legal: 'free' }, { id: 'it_prize', name: '紀念品', desc: '館主給的。', category: 'misc', grade: 1, size: 0, legal: 'free' }],
    weapon_class: [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }, { id: 'maze', name: '迷宮館', short: '館', class: 'corp' }],
    enemy: [lace('en_pink_m', 'minion', 'pink'), lace('en_pink_e', 'elite', 'pink'), lace('en_white', 'minion', 'white'), lace('en_boss', 'boss', 'black'), program('mz_slime', 'minion'), program('mz_knight', 'elite'), program('mz_king', 'boss')],
    net_region: [DIGNET],
    net_facility: [{ id: 'nf_two', name: '倉儲', layers: ['staff', 'core'], controls: 0 }],
    net_affix: [{ id: 'af_shift', name: '換班中', region: 'sub_dig', fx: { foe_minus: 1 } }],
    net_site: [
      { id: 'site_dig', name: '甲公司的外圍網', kind: 'netrun', need: 'rental', desc: '自己去挖。', setup: { region: 'sub_dig', entry: 'dig', site: 'dig_a', grade: 1, faction: 'f_a', facility: 'nf_two', affixes: ['af_shift'], encounter: [] } },
      { id: 'site_own', name: '深處的網', kind: 'netrun', need: 'deck', desc: '只有自己的甲板進得去。', setup: { region: 'sub_dig', entry: 'dig', site: 'dig_b', grade: 1, faction: 'f_a' } },
    ],
    maze_table: [{ id: 'mz_chest', kind: 'chest', rows: [{ weight: 1, name: '籌碼', chips: [3, 5] }] }, { id: 'mz_prize', kind: 'prize', rows: [{ weight: 1, name: '紀念品', give: [{ kind: 'item', id: 'it_prize', qty: 1 }], chips: 5 }] }],
    maze_rule: [{ id: 'default', brackets: { rookie: { deck: 'dk_rent', kit: ['cs_kit'] } }, mimic: 0, chest_table: 'mz_chest', prize_table: 'mz_prize' }],
  },
} as unknown as ContentPack

/** 戰鬥用：內海的武器很強（整場自動打一定贏） */
const HELPER: Feature = {
  id: 'dive_ui_helper',
  install(k) {
    k.battle.loadout('dive_ui_helper', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(60, 14)] } : undefined))
  },
}

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

/** 站在潛艙店（F1）上的一局；at 可以改站在別的設施 */
async function start(o: { facility?: string; cash?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: 7, testContent: [PACK], testFeatures: [HELPER] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  // 迷宮館在潛入中報名要有能用的武器構裝（潛入中不能換）：先把館方的比賽版裝好
  expect(e.commit({ summary: '裝比賽版構裝', changes: [{ op: 'actor.ext', id: e.state.pc!, key: 'deck', value: { slots: ['cs_kit'], scripts: [] } }] as never })).toBeNull()
  if (o.cash !== undefined) expect(e.commit({ summary: '設定現金', changes: [{ op: 'cash', delta: o.cash - e.money.cash }] })).toBeNull()
  expect((await e.world.arrive('b_t', o.facility ?? 'F1')).status).toBe('applied')
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
/** 這個元素（含子孫）裡的字 */
const within = (html: string, attr: string): string => {
  const h = clean(html)
  const i = h.indexOf(attr)
  return i < 0 ? '' : text(h.slice(i, i + 1500))
}

beforeEach(() => setActivePinia(createPinia()))

// ===================================================================================================================
describe('接入點：站在潛艙店上列出潛入', () => {
  it('格子上的項目是引擎的 dive.enter；選項與費用和 diveOptions 一樣（費用加押金、租的甲板）', async () => {
    const { e, pinia } = await start()
    const uses = e.world.grid()!.here.uses
    expect(uses.map((u) => u.id)).toContain('dive.enter')
    // 打開「這裡」的選項是打開同一個選項畫面，不是直接潛入
    expect(lifeDialogOf('dive.enter')).toEqual({ name: 'dive', props: {} })
    expect(lifeDialogOf('dive.exit')).toEqual({ name: 'dive', props: {} })
    const o = e.dive.options()
    expect(o.ok).toBe(true)
    expect(o).toMatchObject({ fee: 30, deposit: 50, cost: 80, deck: 'rental' })
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(text(h)).toContain('潛艙店「測試」')
    expect(within(h, 'data-deck')).toContain('租用的甲板：租用甲板')
    expect(h).toContain('data-cost-row')
    expect(within(h, 'data-total')).toContain('80')
    expect(tag(h, 'data-dive-enter')).not.toContain('aria-disabled')
    expect(h).not.toContain('data-enter-why')
  })

  it('錢不夠：按鈕灰掉，原因逐字是引擎的 blocks', async () => {
    const { e, pinia } = await start({ cash: 10 })
    const o = e.dive.options()
    expect(o.ok).toBe(false)
    expect(o.block).toContain('現金不夠')
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(tag(h, 'data-dive-enter')).toContain('aria-disabled="true"')
    expect(tag(h, 'data-dive-enter')).toContain(`title="${o.block}"`)
    expect(within(h, 'data-enter-why')).toContain(o.block!)
    // 被擋下的潛入：引擎的原因原樣回傳，現金不動
    const r = await e.dive.enter()
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(o.block)
    expect(e.money.cash).toBe(10)
  })

  it('不在接入點上：原因是引擎的那一句；沒有「潛入」的項目', async () => {
    const { e, pinia } = await start({ facility: 'F2' })
    expect(e.world.grid()!.here.uses.map((u) => u.id)).not.toContain('dive.enter')
    const o = e.dive.options()
    expect(o.block).toContain('這裡沒有接入點')
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(within(h, 'data-enter-why')).toContain(o.block!)
  })
})

// ===================================================================================================================
describe('潛入、去處、登出', () => {
  it('潛入：付費用與押金、租甲板、身體記在接入點；去處列出來，去不了的灰掉並寫引擎的原因', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    const loc = { ...e.state.location }
    expect((await e.dive.enter()).status).toBe('applied')
    const v = e.dive.view()
    expect(v.diving).toBe(true)
    expect(e.money.cash).toBe(1000 - 80)
    expect(v.dive).toMatchObject({ name: '潛艙店「測試」', deck: 'rental', paid: { fee: 30, deposit: 50 } })
    expect(e.state.location).toEqual(loc)
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(h).toContain('data-status')
    expect(within(h, 'data-body')).toContain('潛艙店「測試」')
    // 兩個去處：租的甲板能去自己去挖的；只有自己的甲板進得去的灰掉
    expect(h).toContain('data-site="site_dig"')
    expect(h).toContain('data-site="site_own"')
    const own = v.sites.find((s) => s.id === 'site_own')!
    expect(own.block).toContain('只有自己的甲板進得去')
    expect(tag(h, 'data-go="site_own"')).toContain('aria-disabled="true"')
    expect(tag(h, 'data-go="site_own"')).toContain(`title="${own.block}"`)
    expect(tag(h, 'data-go="site_dig"')).not.toContain('aria-disabled')
    // 去得了的排在前面
    expect(sortSites(v.sites).map((s) => s.id)).toEqual(['site_dig', 'site_own'])
    // 登出區：原因與提醒是引擎的
    expect(within(h, 'data-exit-note')).toContain(v.exit!.note)
  })

  it('選自己去挖的去處：到子網頁，抬頭有設施類型、第幾次進來、詞條；離開時列結算，按鈕回到去處', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    await e.dive.enter()
    expect((await e.dive.go('site_own')).reason).toBe(e.dive.view().sites.find((s) => s.id === 'site_own')!.block)
    expect((await e.dive.go('site_dig')).status).toBe('applied')
    const nv = e.net.view()!
    expect(nv.kind).toBe('netrun')
    expect(nv.dig).toMatchObject({ site: 'dig_a', facility: 'nf_two', visits: 1 })
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(h).toContain('data-dig')
    expect(within(h, 'data-dig-facility')).toContain('倉儲')
    expect(within(h, 'data-dig-visits')).toContain('第 1 次進來')
    expect(within(h, 'data-dig-affix')).toContain('換班中')
    // 離開：停在結算，不是直接跳回主畫面
    expect((await e.net.logout()).status).toBe('applied')
    expect(e.net.view()).toBeNull()
    const end = e.dive.lastEnd()!
    expect(end.dig).toBe(true)
    expect(end.summary).toBe(e.state.reports.find((r) => r.action === 'netrun.logout')!.outcome.summary)
    const h2 = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(h2).toContain('data-settle')
    expect(within(h2, 'data-end-summary')).toContain(end.summary)
    expect(text(h2)).toContain('回到去處')
    expect(h2).not.toContain('data-empty')
    // 還在潛入中：回到去處的清單，這座子網留著（七天內再進去是同一張圖）
    expect(e.dive.view().diving).toBe(true)
    const kept = e.dive.kept('dig_a')!
    expect(kept.daysAgo).toBe(0)
    const h3 = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(within(h3, 'data-kept')).toContain(keptLine(kept))
    // 再進去：第 2 次
    expect((await e.dive.go('site_dig')).status).toBe('applied')
    expect(e.net.view()!.dig!.visits).toBe(2)
    await e.net.logout()
  })

  it('登出：回到主畫面的位置、現金少了費用（押金退回）、租的甲板收回、皮換回來（不再潛入）', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    const loc = { ...e.state.location }
    await e.dive.enter()
    expect(e.money.cash).toBe(920)
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    expect(tag(h, 'data-exit-btn')).not.toContain('aria-disabled')
    const refund = e.dive.view().exit!.refund
    expect(refund).toBe(50)
    expect((await e.dive.exit()).status).toBe('applied')
    expect(e.dive.view().diving).toBe(false)
    expect(e.state.location).toEqual(loc)
    expect(e.money.cash).toBe(1000 - 30)
    expect(e.state.reports.at(-1)!.action).toBe('dive.exit')
    // 登出之後又能潛入
    expect(e.dive.options().ok).toBe(true)
  })

  it('潛入中按「休息」：被擋，顯示引擎的原因', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    expect(e.rest.sleepBlock()).toBeNull()
    await e.dive.enter()
    const why = e.rest.sleepBlock()
    expect(why).toContain('先登出')
    const h = clean(await render(pinia, RestDialog, { entryId: 1 }))
    expect(text(h)).toContain(why!)
    const r = await e.rest.breath()
    expect(r.status).toBe('refused')
    expect(r.reason).toContain('先登出')
  })

  it('潛入中登出被擋（正在網內的行程裡）：按鈕灰掉，原因是引擎的 exit.block', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    await e.dive.enter()
    await e.dive.go('site_dig')
    const block = e.dive.view().exit!.block
    expect(block).toContain('先把它做完')
    const r = await e.dive.exit()
    expect(r.reason).toBe(block)
    await e.net.logout()
    expect(e.dive.view().exit!.block).toBeNull()
    void pinia
  })
})

// ===================================================================================================================
const markersOf = (e: Eng, mark: string) => e.net.sheet()!.markers.filter((m) => m.mark === mark)
function reveal(e: Eng): void {
  const g = e.net.grid()!
  const rows = Array.from({ length: g.size[1] }, () => '1'.repeat(g.size[0]))
  expect(e.commit({ summary: '看過', action: 'netrun.test', changes: [{ op: 'map.sheet', map: g.map, sheet: g.sheet, seen: rows }] as never })).toBeNull()
}
function teleport(e: Eng, p: [number, number]): void {
  const g = e.net.grid()!
  expect(e.commit({ summary: '傳送', action: 'netrun.test', changes: [{ op: 'map.at', to: { map: g.map, sheet: g.sheet, x: p[0], y: p[1] } }] as never })).toBeNull()
}
/** 站到旁邊（不是牆的鄰格；測試直接放過去） */
function standNear(e: Eng, p: [number, number]): void {
  const g = e.net.grid()!
  const pick = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [p[0] + dx, p[1] + dy] as [number, number]).find(([x, y]) => g.cells[y]?.[x] && g.cells[y]![x] !== 'wall' && g.cells[y]![x] !== 'net_foe')!
  teleport(e, pick)
}
/** 打完這一層、走到閘門、往下一層（最後一層是通過出口） */
async function clearLayer(e: Eng): Promise<void> {
  reveal(e)
  for (const foe of markersOf(e, 'f')) {
    if (e.net.grid()!.cells[foe.at[1]]![foe.at[0]] !== 'net_foe') continue
    standNear(e, foe.at)
    expect((await e.net.use('fight', foe.id)).status).toBe('applied')
    for (let i = 0; i < 400 && e.battle && !e.battle.result; i++) if (e.battleNext({ anyone: true }).status !== 'applied') break
    expect(e.battle?.result?.outcome).toBe('win')
    expect((await e.finishBattle()).status).toBe('applied')
  }
  teleport(e, markersOf(e, 'g')[0]!.at)
  expect((await e.net.use(e.net.view()!.gate.last ? 'pass' : 'descend')).status).toBe('applied')
}

describe('迷宮館', () => {
  it('報名的組別：押金、獎金、構裝規則、不能報的原因都是引擎的 brackets', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    await e.dive.enter()
    const rows = e.maze.brackets()
    expect(rows.map((r) => r.id)).toEqual(['rookie', 'open', 'unlimited', 'unlimited'])
    const h = clean(await render(pinia, DiveDialog, { entryId: 1 }))
    for (const r of rows) {
      const key = bracketKey(r)
      expect(h).toContain(`data-bracket="${key}"`)
      expect(tag(h, `data-enroll="${key}"`)!.includes('aria-disabled')).toBe(r.block !== null)
      if (r.block) expect(tag(h, `data-enroll="${key}"`)).toContain(`title="${r.block}"`)
      expect(text(h)).toContain(bracketRule(r))
    }
    // 無差別組的第四級：錢不夠
    const iv = rows.find((r) => r.id === 'unlimited' && r.grade === 4)!
    expect(iv.block).toContain('押金不夠')
    expect(within(h, 'data-bracket="unlimited:4"')).toContain(iv.block!)
    // 新手組報得了：押金是 DEFAULT 的表上的數字
    const rookie = rows[0]!
    expect(rookie).toMatchObject({ grade: 1, deposit: 50, prize: 300, own: false, deck: 'dk_rent' })
    expect(rookie.block).toBeNull()
  })

  it('報新手組、走完三層：結算的評價、獎金、押金等於引擎的 maze.result；子網頁的抬頭是回合數對標準', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    await e.dive.enter()
    const before = e.money.cash
    expect((await e.maze.enter('rookie', 1)).status).toBe('applied')
    expect(e.net.view()!.kind).toBe('netrun')
    expect(e.money.cash).toBe(before - 50)
    // 館內子網頁：回合數對標準、籌碼、預估的評價；沒有追蹤度條
    const mv = e.maze.view()!
    expect(mv).toMatchObject({ bracket: 'rookie', grade: 1, deposit: 50, standard: 37 })
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(h).toContain('data-maze-panel')
    expect(h).not.toContain('data-trace-panel')
    expect(within(h, 'data-maze-rounds')).toContain(`${mv.rounds}／標準 ${mv.standard}`)
    expect(within(h, 'data-maze-rating')).toContain(`預估 ${mv.rating}`)
    expect(within(h, 'data-maze-chips')).toContain(`${mv.chips} 枚`)
    expect(within(h, 'data-maze-layers')).toContain('前庭')
    await clearLayer(e)
    await clearLayer(e)
    expect(e.net.view()!.layer.index).toBe(3)
    await clearLayer(e)
    expect(e.net.view()).toBeNull()
    // 結算
    const result = e.state.reports.find((r) => r.action === 'maze.result')!
    const data = result.timeline[0]!.data as Rec
    expect(data.outcome).toBe('done')
    const end = e.dive.lastEnd()!
    expect(end.maze!.data).toEqual(data)
    expect(end.maze!.summary).toBe(result.outcome.summary)
    const m = mazeResultOf(end.maze!.data)
    expect(m).toMatchObject({ done: true, rating: data.rating, prize: data.prize, refund: 50, chips: data.chips, chipCash: data.chipCash, rounds: data.rounds, standard: 37 })
    expect(e.money.cash).toBe(before - 50 + (data.prize as number) + 50 + (data.chipCash as number))
    const h2 = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(h2).toContain('data-settle')
    expect(within(h2, 'data-rating')).toContain(String(data.rating))
    expect(within(h2, 'data-m-prize')).toContain(Number(data.prize).toLocaleString('en-US'))
    expect(within(h2, 'data-m-deposit')).toContain('退回')
    expect(within(h2, 'data-m-rounds')).toContain(`${data.rounds}／標準 37`)
    expect(text(h2)).toContain('紀念品')
    // 租的甲板收回；還在潛入中，登出之後現金只少了潛入的費用
    expect(e.dive.view().diving).toBe(true)
    e.dive.clearEnd()
    expect((await e.dive.exit()).status).toBe('applied')
    expect(e.state.actors[e.state.pc!]!.ext.deck).not.toHaveProperty('rental')
  }, 30000)

  it('中途登出（拔線）：押金沒收，結算寫沒闖過', async () => {
    const { e, pinia } = await start({ cash: 1000 })
    await e.dive.enter()
    const before = e.money.cash
    await e.maze.enter('rookie', 1)
    expect((await e.net.logout()).status).toBe('applied')
    expect(e.money.cash).toBe(before - 50)
    const end = e.dive.lastEnd()!
    const m = mazeResultOf(end.maze!.data)
    expect(m).toMatchObject({ done: false, forfeited: 50, refund: 0, prize: 0 })
    const h = clean(await render(pinia, SubnetScreen, {}, '/subnet'))
    expect(within(h, 'data-m-deposit')).toContain('沒收')
    expect(within(h, 'data-rating')).toContain('—')
  })
})

// ===================================================================================================================
describe('整理的函式與只轉接的規定', () => {
  it('diveView 的整理：去得了的在前、費用拆成兩行、留著的子網一句話、迷宮館的結算讀引擎的資料', () => {
    expect(costParts({ fee: 30, deposit: 50, cost: 80 }).map((p) => p.amount)).toEqual([30, 50])
    expect(costParts({ fee: 0, deposit: 0, cost: 0 })).toEqual([])
    expect(sortSites([{ id: 'a', name: 'a', kind: 'netrun', need: 'deck', block: 'x' }, { id: 'b', name: 'b', kind: 'netrun', need: 'any', block: null }]).map((s) => s.id)).toEqual(['b', 'a'])
    expect(keptLine({ daysAgo: 0, located: false })).toContain('今天')
    expect(keptLine({ daysAgo: 3, located: true })).toContain('3 天前')
    expect(deckLine({ deck: 'own', here: null })).toBe('自己的甲板')
    expect(deckLine({ deck: 'none', here: null })).toContain('訪客')
    expect(endParts({ summary: '你登出了。敵對值 +2。', lines: ['敵對值 +2。'] })).toEqual({ head: '你登出了。', lines: ['敵對值 +2。'] })
    expect(endParts({ summary: '你登出了。', lines: [] })).toEqual({ head: '你登出了。', lines: [] })
    expect(mazeResultOf({ outcome: 'forfeit', rounds: 3 })).toMatchObject({ done: false, rating: null, rounds: 3, prize: 0 })
  })

  it('元件與整理函式裡沒有規則：不寫死費用、押金、倍率或評價的門檻，不 import 引擎的規則函式', () => {
    for (const s of [diveSrc, endSrc, viewSrc]) {
      expect(s).not.toMatch(/Math\.(random|round|floor|ceil)\(/)
      expect(s).not.toMatch(/\bfee\s*[*+-]/)
      expect(s).not.toMatch(/^import (?!type)[^\n]*@engine\/src\/features\/(dive|maze|netrun)'/m)
    }
    expect(viewSrc).not.toMatch(/\b1\.[25]\b|\b0\.7\b/)
  })
})

// ===================================================================================================================
describe('示意世界包：潛艙店「浮標」與去處', () => {
  it('開局的示意包：潛艙店帶 dive、自己去挖的去處、迷宮館的規則；走完潛入、去處、離開、登出', async () => {
    setActivePinia(createPinia())
    const e = useEngine()
    expect(e.newGame({ seed: 11, draft: DRAFT as never })).toEqual([])
    const shop = e.world.entry<{ block: string; facility: string }>('shop', DIVE_SHOP)!
    expect((await e.world.arrive(shop.block, shop.facility)).status).toBe('applied')
    expect(e.world.grid()!.here.uses.map((u) => u.id)).toContain('dive.enter')
    const o = e.dive.options()
    expect(o.ok).toBe(true)
    expect(o.here).toMatchObject({ name: '潛艙店「浮標」', fee: 40 })
    const cash = e.money.cash
    expect((await e.dive.enter()).status).toBe('applied')
    expect(e.money.cash).toBe(cash - o.cost)
    const site = e.dive.view().sites.find((s) => s.id === DIG_SITE)!
    expect(site.block).toBeNull()
    expect((await e.dive.go(DIG_SITE)).status).toBe('applied')
    expect(e.net.view()!.dig).not.toBeNull()
    expect(e.net.view()!.region.name).toContain('一般子網')
    await e.net.logout()
    expect(e.dive.lastEnd()).not.toBeNull()
    // 迷宮館的組別在示意包裡有：新手組一律用館方發的比賽版（身上的構裝要先拿掉）
    expect(e.maze.brackets().map((b) => b.name)).toEqual(['新手組', '公開組', '無差別組', '無差別組'])
    expect((await e.dive.exit()).status).toBe('applied')
  })
})
