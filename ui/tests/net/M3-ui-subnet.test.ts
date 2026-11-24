// 驗收測試：dev/work/M3-ui-subnet.md（cpp-ui）。子網地圖接上引擎：地圖、迷霧、節點、巡邏、層、追蹤度、這一格與旁邊能做的事、登出。
// 引擎用真的（allFeatures 的 netrun、netcombat、deck、enemies……）；內容是測試自帶的最小假資料：一座小子網（net_region）、三隻假蕾絲、一副甲板與構裝。
// 副本用玩具活動（TEST_ACTIVITY）當成委託，放行 face.net 開始與這一段的報告。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 net 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature } from '@engine/src'
import { netWeapon, TEST_ACTIVITY } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import SubnetScreen from '../../src/screens/SubnetScreen.vue'
import src from '../../src/screens/SubnetScreen.vue?raw'
import { LINK_MARK, leaveTo, patrolTokens, traceStages, watchRunEnd } from '../../src/lib/netrunView'
import { pressE } from '../../src/lib/here'
import { hereOptions } from '../../src/lib/netrunView'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

// ---- 假資料 ----
const lace = (id: string, rank: string, color: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的網內敵人。', faction: 'f_a', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...more,
})
const COUNTS0 = { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] }
/** 小子網：11 × 9、兩層；每層一場遭遇、一個休息點、一個檔案庫、一個人；視野 2 格 */
const REGION = {
  id: 'sub_ui', name: '測試子網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22], oneway: 0.5, fragile: 0.5, loops: 2,
  layer: { ...COUNTS0, foe: [1, 1], rest: [1, 1], archive: [1, 1], person: [1, 1] },
  commission: { ...COUNTS0, foe: [1, 1], rest: [1, 1], person: [1, 1] },
}
const PACK: ContentPack = {
  id: 'subnet_ui_test',
  content: {
    weapon_class: [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }],
    deck: [{ id: 'dk_ii', name: '測試甲板 II', desc: '測試。', grade: 2, slots: 4, firewall: 12, legal: 'free' }],
    construct: [{ id: 'cs_rifle', class: 'weapon', name: '夜巡', grade: 3, legal: 'register', type: 'neural', ram: 1, archetype: 'rifle' }],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }],
    net_region: [REGION],
    enemy: [lace('en_pink_m', 'minion', 'pink'), lace('en_pink_e', 'elite', 'pink'), lace('en_white', 'minion', 'white', { position: { prefer: [4] } }), lace('en_boss', 'boss', 'black')],
  },
} as unknown as ContentPack

/** 戰鬥用：內海戰鬥的武器很強（讓整場自動打一定贏）；玩具活動（假的委託）放行 face.net 與這一段的報告 */
const HELPER: Feature = {
  id: 'subnet_ui_helper',
  install(k) {
    k.battle.loadout('subnet_ui_helper', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(60, 14)] } : undefined))
    k.activity.allow('toy', 'face.net.start', 'subnet_ui_helper')
    k.activity.allow('toy', 'commit:netrun.', 'subnet_ui_helper')
    k.activity.allow('toy', 'grid.', 'subnet_ui_helper')
    k.activity.allow('toy', 'commit:grid.', 'subnet_ui_helper')
    k.activity.allow('toy', 'battle.', 'subnet_ui_helper')
    k.activity.allow('toy', 'commit:battle.', 'subnet_ui_helper')
    k.activity.allow('toy', 'chain:battle_end', 'subnet_ui_helper')
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

const BASE = { region: 'sub_ui', grade: 1, faction: 'f_a', seed: 11, encounter: ['minion'] }
interface Opts { kind?: 'netrun' | 'face.net'; setup?: Rec; seed?: number; begin?: boolean }

function start(o: Opts = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK], testFeatures: [HELPER, TEST_ACTIVITY] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '給東西', changes: [give('dk_ii', 1, { uid: 'D1' }), give('cs_rifle')] })).toBeNull()
  expect(e.deck.equip('D1')).toBeNull()
  expect(e.deck.install('cs_rifle')).toBeNull()
  if (o.begin !== false) {
    if (o.kind === 'face.net') expect(e.commit({ summary: '假委託', action: 'toy.test', changes: [{ op: 'ext', key: 'toy', value: { id: 't1', steps: 0, goal: 1, origin: { by: 'test' } } }] as never })).toBeNull()
    const origin = o.kind === 'face.net' ? { by: 'commission', ref: 'c1', ext: { commission: 'c1', stage: 1, face: 'net' } } : { by: 'ui' }
    const setup = o.kind === 'face.net' ? { ...BASE, layer: 'staff', commission: 'c1', stage: 1, face: 'net', ...(o.setup ?? {}) } : { ...BASE, ...(o.setup ?? {}) }
    expect(e.net.begin(setup, o.kind ?? 'netrun', origin)).toBeNull()
  }
  return { e, pinia }
}

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/subnet', component: { render: () => null } }, { path: '/commission', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>): Promise<string> {
  const r = router()
  await r.push('/subnet')
  await r.isReady()
  const app = createSSRApp(SubnetScreen)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const text = (s: string) => clean(s).replace(/<[^>]+>/g, '')

/** 把這一層全部標成看過（測試走遠路用；引擎的 map.sheet 變更，和探索一樣） */
function reveal(e: Eng): void {
  const g = e.net.grid()!
  const rows = Array.from({ length: g.size[1] }, () => '1'.repeat(g.size[0]))
  expect(e.commit({ summary: '看過', action: 'netrun.test', changes: [{ op: 'map.sheet', map: g.map, sheet: g.sheet, seen: rows }] as never })).toBeNull()
}
const markersOf = (e: Eng, mark: string) => e.net.sheet()!.markers.filter((m) => m.mark === mark)
const at = (e: Eng): [number, number] => e.net.grid()!.at
const cells = (html: string) => [...clean(html).matchAll(/<div role="gridcell" class="([^"]*)"[^>]*data-x="(\d+)" data-y="(\d+)"[^>]*>/g)].map((m) => ({ cls: m[1]!, x: Number(m[2]), y: Number(m[3]) }))
/** 一個選項的標籤（data-opt 是引擎的 use id，旁邊的遭遇節點是 id@節點） */
const optTag = (html: string, id: string): string | undefined => clean(html).match(new RegExp(`<button[^>]*data-opt="${id}"[^>]*>`))?.[0]
const tokTag = (html: string, kind: string): string | undefined => clean(html).match(new RegExp(`<button[^>]*class="[^"]*t-${kind}[^"]*"[^>]*>`))?.[0]
const tokCount = (html: string, kind: string): number => clean(html).match(new RegExp(`<button[^>]*class="[^"]*t-${kind} tok[^"]*"[^>]*>`, 'g'))?.length ?? 0
const setTrace = (e: Eng, delta: number) => expect(e.commit({ summary: '追蹤度', action: 'netrun.test', changes: [{ op: 'meter', kind: 'trace', key: e.net.grid()!.map, delta }] as never })).toBeNull()

/** 走到遭遇節點旁邊：試四個鄰格，走得過去的那一個 */
function standNextToFoe(e: Eng): string {
  reveal(e)
  const foe = markersOf(e, 'f')[0]!
  const g = e.net.grid()!
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const [x, y] = [foe.at[0] + dx, foe.at[1] + dy]
    const kind = g.cells[y]?.[x]
    if (!kind || kind === 'wall' || kind === 'net_foe') continue
    const r = e.net.walk([x, y])
    if (r.ok && e.net.view()!.near.length > 0) return foe.id
  }
  throw new Error('走不到遭遇節點旁邊')
}

beforeEach(() => setActivePinia(createPinia()))

describe('沒有進行中的行程', () => {
  it('打開 /subnet：一句話與回主畫面的按鈕，沒有假的藍鯨物流', async () => {
    const { pinia, e } = start({ begin: false })
    expect(e.net.view()).toBeNull()
    const h = clean(await render(pinia))
    expect(h).toContain('data-empty')
    expect(text(h)).toContain('現在沒有潛進任何子網。')
    expect(text(h)).toContain('回主畫面')
    expect(text(h)).not.toContain('藍鯨')
    expect(h).not.toContain('data-subnet')
  })
})

describe('地圖：畫引擎的 gridView', () => {
  it('格子、看過的範圍、站的位置和 gridView 一樣；沒看過的格子不畫節點', async () => {
    const { e, pinia } = start()
    const g = e.net.grid()!
    const h = clean(await render(pinia))
    const cs = cells(h)
    expect(cs).toHaveLength(g.size[0] * g.size[1])
    for (const c of cs) {
      const kind = g.cells[c.y]![c.x]
      expect(c.cls.includes('f-hidden'), `(${c.x},${c.y})`).toBe(!kind)
      if (!kind) expect(c.cls).toContain('k-void')
    }
    // 沒看過的格子沒有圖示、沒有記號
    const hiddenHtml = [...h.matchAll(/<div role="gridcell" class="[^"]*f-hidden[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]!)
    expect(hiddenHtml.every((x) => !x.includes('<svg') && !x.includes('class="mk"'))).toBe(true)
    // 站的位置：代幣「你的化身」的位置
    const me = tokTag(h, 'me')!
    expect(me).toContain(`left:${(g.at[0] / g.size[0]) * 100}%`)
    expect(me).toContain(`top:${(g.at[1] / g.size[1]) * 100}%`)
    // 起點只看到一小塊（視野 2 格），整張圖有迷霧
    expect(cs.filter((c) => c.cls.includes('f-hidden')).length).toBeGreaterThan(20)
  })

  it('看過的範圍之外：全部標成看過之後迷霧沒了，節點有圖示；處理過的才打勾', async () => {
    const { e, pinia } = start()
    reveal(e)
    const h = clean(await render(pinia))
    const cs = cells(h)
    expect(cs.some((c) => c.cls.includes('f-hidden'))).toBe(false)
    expect(cs.filter((c) => c.cls.includes('k-node')).length).toBeGreaterThanOrEqual(e.net.sheet()!.markers.length - 1)
    expect(h).not.toMatch(/class="mk"[^>]*>✓/)
    // 遭遇節點站不上去：引擎給的原因
    const foe = markersOf(e, 'f')[0]!
    expect(e.net.grid()!.cells[foe.at[1]]![foe.at[0]]).toBe('net_foe')
  })

  it('單向與會斷的鏈路各有小記號（鍵是引擎的種類 net_valve、net_bridge）', () => {
    expect(LINK_MARK.net_valve!.mark).toBe('單')
    expect(LINK_MARK.net_bridge!.mark).toBe('斷')
  })
})

describe('走路與探索回合', () => {
  it('走一步：引擎的位置變了、畫面跟著；方向鍵就是 gridMove 的一個方向', async () => {
    const { e, pinia } = start()
    const before = at(e)
    const g = e.net.grid()!
    const dir = (['north', 'south', 'east', 'west'] as const).find((d) => g.moves[d] === null)!
    const r = e.net.walk(dir)
    expect(r.ok).toBe(true)
    const after = at(e)
    expect(after).not.toEqual(before)
    const h = clean(await render(pinia))
    const me = tokTag(h, 'me')!
    expect(me).toContain(`left:${(after[0] / g.size[0]) * 100}%`)
  })

  it('被擋下時是引擎的原因（走進牆）', () => {
    const { e } = start()
    const g = e.net.grid()!
    const dir = (['north', 'south', 'east', 'west'] as const).find((d) => g.moves[d] !== null)
    if (!dir) return
    const r = e.net.walk(dir)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe(g.moves[dir])
  })

  it('走到節點格：探索回合加一，畫面上的數字等於 netrunView', async () => {
    const { e, pinia } = start()
    reveal(e)
    expect(e.net.view()!.round).toBe(0)
    const rest = markersOf(e, 'r')[0]!
    expect(e.net.walk(rest.at).ok).toBe(true)
    expect(at(e)).toEqual(rest.at)
    const round = e.net.view()!.round
    expect(round).toBeGreaterThanOrEqual(1)
    const h = clean(await render(pinia))
    expect(h).toMatch(new RegExp(`data-round[^>]*>探索回合 <b[^>]*>${round}</b>`))
  })
})

describe('站在遭遇節點旁邊：開戰與潛行繞過', () => {
  it('右欄有開戰與潛行繞過（寫是哪個節點）；站在鏈路上時沒有', async () => {
    const { e, pinia } = start()
    expect(text(await render(pinia))).toContain('站在鏈路上')
    const id = standNextToFoe(e)
    const v = e.net.view()!
    expect(v.near.map((n) => n.id)).toContain(id)
    expect(v.near[0]!.uses.map((u) => u.id)).toEqual(['fight', 'sneak'])
    const h = clean(await render(pinia))
    expect(h).toContain(`data-opt="fight@${id}"`)
    expect(h).toContain(`data-opt="sneak@${id}"`)
    expect(h).toContain('data-near')
    // E 做的是第一個（預設）：右欄的選項順序就是引擎給的順序
    const opts = hereOptions(v, () => {})
    expect(opts[0]!.id).toBe(`fight@${id}`)
    expect(optTag(h, `fight@${id}`)).toMatch(/class="[^"]*\bauto\b/)
  })

  it('選開戰：引擎開了內海戰鬥；打贏回來，那個節點是鏈路的樣子（打勾）而且旁邊沒有遭遇了', async () => {
    const { e, pinia } = start()
    const id = standNextToFoe(e)
    const foe = markersOf(e, 'f')[0]!
    expect((await e.net.use('fight', id)).status).toBe('applied')
    expect(e.inBattle).toBe(true)
    expect(e.battleLayer()).toBe('net')
    for (let i = 0; i < 400 && e.battle && !e.battle.result; i++) {
      const r = e.battleNext({ anyone: true })
      if (r.status !== 'applied') break
    }
    expect(e.battle?.result?.outcome).toBe('win')
    expect((await e.finishBattle()).status).toBe('applied')
    expect(e.inBattle).toBe(false)
    // 回到這一頁：地圖已經是引擎的新狀態
    expect(e.net.view()).not.toBeNull()
    expect(e.net.view()!.near).toEqual([])
    expect(e.net.grid()!.cells[foe.at[1]]![foe.at[0]]).toBe('floor')
    expect(e.net.sheet()!.markers.find((m) => m.id === foe.id)!.used).toBe(true)
    const h = clean(await render(pinia))
    const cell = cells(h).find((c) => c.x === foe.at[0] && c.y === foe.at[1])!
    expect(cell.cls).toContain('k-node')
    expect(h).toMatch(/class="mk"[^>]*>✓/)
  })

  it('潛行繞過：用引擎的動作，不是畫面擲骰（結果不論成敗，節點的狀態都是引擎說的）', async () => {
    const { e } = start()
    const id = standNextToFoe(e)
    const r = await e.net.use('sneak', id)
    expect(r.status).toBe('applied')
    // 成功是節點處理掉；失敗是開戰。兩種都是引擎的狀態
    expect(e.inBattle || e.net.view()!.near.length === 0).toBe(true)
  })

  it('不在旁邊就用不了：引擎的原因', async () => {
    const { e } = start()
    reveal(e)
    const foe = markersOf(e, 'f')[0]!
    const r = await e.net.use('fight', foe.id)
    expect(r.status).toBe('refused')
    expect(r.reason).toContain('太遠')
  })
})

describe('追蹤度條與倒數', () => {
  it('值與刻度對（引擎的 30、60、90），各段寫會發生什麼', async () => {
    const { e, pinia } = start()
    const v = e.net.view()!
    expect(v.trace.marks).toEqual([30, 60, 90])
    setTrace(e, 20)
    setTrace(e, 15)
    const h = clean(await render(pinia))
    expect(h).toMatch(/data-trace-value[^>]*>35</)
    for (const m of [30, 60, 90]) expect(h).toContain(`left:${m}%`)
    expect(text(h)).toContain('起疑')
    expect(h).toMatch(/data-trace-stage[^>]*>起疑</)
    expect(traceStages([30, 60, 90]).map((s) => s.at)).toEqual([30, 60, 90])
    expect(h).not.toContain('data-located')
  })

  it('用效果推到 90 之後顯示倒數（剩幾個探索回合是引擎的 trace.located）', async () => {
    const { e, pinia } = start()
    for (const d of [20, 20, 20, 20, 10]) setTrace(e, d)
    const v = e.net.view()!
    expect(v.trace.value).toBe(90)
    expect(v.trace.located).not.toBeNull()
    const h = clean(await render(pinia))
    expect(h).toContain('data-located')
    expect(text(h)).toContain(`還剩 ${v.trace.located} 個探索回合`)
    expect(h).toMatch(/data-trace-stage[^>]*>已被定位</)
  })
})

describe('層：只經由引擎的往下一層', () => {
  it('分頁寫每一層的名字與幾分之幾；還沒到的層上鎖，不能點過去', async () => {
    const { e, pinia } = start({ setup: { layers: ['staff', 'core'] } })
    const v = e.net.view()!
    expect(v.layer.total).toBe(2)
    const h = clean(await render(pinia))
    expect(h).toContain(`（1／2）`)
    expect(h).toContain(`（2／2）`)
    // 兩個分頁都不能點：目前那一層是選中、另一層 aria-disabled
    expect(h.match(/role="tab"[^>]*aria-selected="true"/g)).toHaveLength(1)
    expect(h.match(/role="tab"[^>]*aria-disabled="true"/g)).toHaveLength(1)
  })

  it('閘門被守著時往下一層被擋：引擎的原因（畫面沒有自己的判斷）', async () => {
    const { e } = start({ setup: { layers: ['staff', 'core'] } })
    reveal(e)
    const gate = markersOf(e, 'g')[0]!
    // 站不上去的話（要走的路被擋）就直接傳送過去：這一份只看引擎怎麼回答
    expect(e.commit({ summary: '傳送', action: 'netrun.test', changes: [{ op: 'map.at', to: { map: e.net.grid()!.map, sheet: e.net.grid()!.sheet, x: gate.at[0], y: gate.at[1] } }] as never })).toBeNull()
    const uses = e.net.view()!.here.uses
    const d = uses.find((u) => u.id === 'descend')!
    expect(d.block).toBeTruthy()
    const r = await e.net.use('descend')
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(d.block)
  })
})

describe('目標與下載', () => {
  it('下載：按三次「繼續」進度滿、這一趟結束，回到發起的那一頁（委託的是副本頁）', async () => {
    let t = start({ kind: 'face.net', setup: { objective: { kind: 'download', turns: 3 } } })
    // 生成的地圖有的目標被遭遇擋在後面：換種子找一張走得到目標的
    for (let sd = 1; sd < 60; sd++) {
      reveal(t.e)
      if (t.e.net.walk(t.e.net.view()!.goal.at!.pos).ok) break
      t = start({ kind: 'face.net', setup: { seed: sd, objective: { kind: 'download', turns: 3 } } })
    }
    const { e, pinia } = t
    const v0 = e.net.view()!
    expect(v0.kind).toBe('face.net')
    expect(v0.goal.kind).toBe('download')
    expect(v0.goal.at).not.toBeNull()
    expect(text(clean(await render(pinia)))).toContain('下載')
    expect(at(e)).toEqual(v0.goal.at!.pos)
    expect(e.net.view()!.here.uses.map((u) => u.id)).toContain('download')
    const progress: Array<number | null> = []
    for (let i = 0; i < 3; i++) {
      const r = await e.net.use('download')
      expect(r.status, r.reason).toBe('applied')
      progress.push(e.net.view()?.goal.progress ?? null)
      if (i < 2) expect(text(clean(await render(pinia)))).toContain(`進度 ${i + 1}／3`)
    }
    // 做滿三次：目標達成、這一趟結束（引擎沒有進行中的行程了），結算是引擎的報告
    expect(progress.slice(0, 2)).toEqual([1, 2])
    expect(e.net.view()).toBeNull()
    expect(e.state.reports.at(-1)!.action).toBe('netrun.end')
    // 回到發起的那一頁：委託的那一段回副本頁（見下一個測試的 watchRunEnd）
    expect(text(clean(await render(pinia)))).toContain('現在沒有潛進任何子網。')
  })

  it('這一趟結束之後離開這一頁：委託的那一段回副本頁，其餘回主畫面；一開始就沒有行程不算結束', async () => {
    expect(leaveTo('face.net')).toBe('/commission')
    expect(leaveTo('netrun')).toBe('/')
    expect(leaveTo(null)).toBe('/')
    const go: string[] = []
    let told = 0
    const face = ref<{ kind: string } | null>({ kind: 'face.net' })
    const stop = watchRunEnd(face, (p) => go.push(p), () => { told++ })
    face.value = { kind: 'face.net' }
    await nextTick()
    expect(go).toEqual([])
    face.value = null
    await nextTick()
    expect(go).toEqual(['/commission'])
    expect(told).toBe(1)
    stop()
    const mine = ref<{ kind: string } | null>({ kind: 'netrun' })
    watchRunEnd(mine, (p) => go.push(p), () => {})
    mine.value = null
    await nextTick()
    expect(go).toEqual(['/commission', '/'])
    const none = ref<{ kind: string } | null>(null)
    watchRunEnd(none, (p) => go.push(p), () => {})
    await nextTick()
    expect(go).toHaveLength(2)
  })
})

describe('登出', () => {
  it('委託的那一段：右欄寫引擎給的那一句（回到進副本之前）；按登出先跳確認框，取消不送、確認才送', async () => {
    const { e, pinia } = start({ kind: 'face.net' })
    const v = e.net.view()!
    expect(v.logout.note).toContain('進副本之前')
    expect(v.logout.block).toBeNull()
    const h = clean(await render(pinia))
    expect(h).toContain('data-logout-note')
    expect(text(h)).toContain(v.logout.note!)
    // 確認框不在畫面上時沒有送出任何報告；原始碼裡登出的按鈕只開確認框（askLogout），確認框的「登出」才呼叫 e.net.logout
    expect(h).not.toContain('data-confirm')
    expect(src).toMatch(/function askLogout\(\)[\s\S]*confirm\.value = true/)
    const ask = src.match(/function askLogout\(\) \{[\s\S]*?\n\}/)![0]
    expect(ask).not.toContain('e.net.logout')
    expect(src).toMatch(/data-cancel @click="confirm = false"/)
    expect(src).toMatch(/data-ok @click="doLogout"/)
    expect(e.net.view()).not.toBeNull()
    // 確認才送
    const before = e.state.reports.length
    expect((await e.net.logout()).status).toBe('applied')
    expect(e.state.reports.length).toBeGreaterThan(before)
    expect(e.net.view()).toBeNull()
  })

  it('自己潛進去的那一趟：沒有「回到進副本之前」那一句', async () => {
    const { e } = start()
    expect(e.net.view()!.logout.note).toBeNull()
    expect((await e.net.logout()).status).toBe('applied')
    expect(e.net.view()).toBeNull()
  })

  it('戰鬥中登出被擋：引擎的原因，按鈕灰掉', async () => {
    const { e, pinia } = start()
    const id = standNextToFoe(e)
    await e.net.use('fight', id)
    expect(e.inBattle).toBe(true)
    const v = e.net.view()!
    expect(v.logout.block).toContain('戰鬥')
    const h = clean(await render(pinia))
    expect(clean(h).match(/<button[^>]*data-logout[^>]*>/)![0]).toContain('aria-disabled="true"')
  })
})

describe('巡邏', () => {
  it('代幣在引擎說的位置；看不到的時候不畫', () => {
    const base = { id: 'p1', node: 'n1', calm: false }
    const view = { patrols: [{ ...base, at: [3, 4], visible: true }, { ...base, id: 'p2', at: [5, 6], visible: false }] } as never
    const t = patrolTokens(view)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ id: 'p1', x: 3, y: 4, kind: 'enemy' })
  })

  it('引擎有巡邏時，畫面上的代幣數等於看得到的巡邏數', async () => {
    const { e, pinia } = start({ setup: { region: { ...REGION, id: 'sub_p', layer: { ...REGION.layer, patrol: [1, 1] } } } })
    const v = e.net.view()!
    expect(v.patrols.length).toBeGreaterThanOrEqual(1)
    const h = clean(await render(pinia))
    expect(tokCount(h, 'enemy')).toBe(v.patrols.filter((p) => p.visible).length)
    reveal(e)
    // 全部看過之後，看不看得到仍然是引擎說了算（視野內才看得到）
    const h2 = clean(await render(pinia))
    expect(tokCount(h2, 'enemy')).toBe(e.net.view()!.patrols.filter((p) => p.visible).length)
  })
})

describe('這一格與旁邊能做的事（E）', () => {
  it('休息點：右欄列引擎給的「短休」；E 做預設；灰掉的帶引擎的原因', async () => {
    const { e, pinia } = start()
    reveal(e)
    const rest = markersOf(e, 'r')[0]!
    expect(e.net.walk(rest.at).ok).toBe(true)
    const v = e.net.view()!
    expect(v.here.uses.map((u) => u.id)).toEqual(['rest'])
    let did = ''
    const opts = hereOptions(v, (id) => { did = id })
    expect(pressE(opts)).toBeNull()
    expect(did).toBe('rest')
    const h = clean(await render(pinia))
    expect(h).toContain('data-opt="rest"')
    expect(optTag(h, 'rest')).toMatch(/class="[^"]*\bauto\b/)
    expect((await e.net.use('rest')).status).toBe('applied')
    // 用過之後再按：引擎的原因，右欄灰掉
    const v2 = e.net.view()!
    expect(v2.here.uses[0]!.block).toContain('用過了')
    const h2 = clean(await render(pinia))
    expect(optTag(h2, 'rest')).toContain('is-unavailable')
  })

  it('管理行動沒有主控就沒有；化身列出每個隊員的感載與同步上限', async () => {
    const { e, pinia } = start()
    expect(e.net.view()!.admin).toEqual([])
    const h = clean(await render(pinia))
    expect(h).not.toContain('data-admin')
    expect(h).toContain('data-party')
    expect(h.match(/data-member="/g)).toHaveLength(e.net.party().length)
    expect(text(h)).toContain('同步上限')
  })
})

describe('入口', () => {
  it('主畫面的「潛入」「子網」與家園的接入室（M3-ui-dive 之後）：沒有行程時打開潛入與登出，不再是假的；在網內時回到子網', () => {
    const files = import.meta.glob(['../../src/screens/MainScreen.vue', '../../src/screens/HomeScreen.vue'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const main = Object.entries(files).find(([k]) => k.endsWith('MainScreen.vue'))![1]
    const home = Object.entries(files).find(([k]) => k.endsWith('HomeScreen.vue'))![1]
    expect(main).toContain("ui.openRoot('dive')")
    expect(main).not.toContain('還沒有開放。')
    expect(main).toContain('e.net.view() !== null')
    expect(home).toContain('e.net.view()')
    expect(home).toContain("ui.openRoot('dive')")
  })
})

describe('掃原始碼：畫面沒有自己的規則', () => {
  const all = import.meta.glob(['../../src/**/*.vue', '../../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const paths = Object.keys(all)
  it('ui/src 沒有任何檔 import stores/subnet、data/subnet，兩個檔不存在', () => {
    expect(paths.some((p) => /\/(stores|data)\/subnet\.ts$/.test(p))).toBe(false)
    for (const [f, s] of Object.entries(all)) expect(s, f).not.toMatch(/from ['"][^'"]*(stores|data)\/subnet['"]/)
  })
  it('SubnetScreen.vue 沒有 addTrace、movePatrols 這類自己算的函式，也不寫死色碼', () => {
    for (const w of ['addTrace', 'movePatrols', 'patrolPos', 'Math.random', 'stepTo', 'reveal(']) expect(src, w).not.toContain(w)
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })
})
