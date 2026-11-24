// 驗收測試：dev/work/M3-ui-netcombat.md（cpp-ui）。內海戰鬥接上引擎：和現實戰鬥同一組戰鬥元件，照引擎給的戰場換皮換字，
// 加上同步檔位、追蹤度條、管理行動三塊；舊 Demo 的規則整份拿掉。
// 引擎用真的（allFeatures 的 netcombat、deck、enemies……）；內容是測試自帶的最小假資料：四個化身、三隻假蕾絲、幾個構裝。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）；「點按鈕」就是呼叫 useBattle 回給元件的那幾個函式（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { BattleOptions, BattleSetup, ContentPack } from '@engine/src'
import { END_TURN } from '@engine/src'
import { laceUnit, netAvatar, netWeapon } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import NetCombatScreen from '../../src/screens/NetCombatScreen.vue'
import CombatScreen from '../../src/screens/CombatScreen.vue'
import { useBattle } from '../../src/lib/useBattle'
import { combatKey } from '../../src/lib/keys'
import { ringOf, RING_KEYS } from '../../src/lib/battleView'
import { NET_SHIFT, defeatNetRows, gearPanel, netUnitOf, outLabel, traceBar, traceDelta } from '../../src/lib/netView'
import { danmakuOf, liveEventsOf } from '../../src/lib/liveEvents'
import { COMBAT_ICONS } from '../../src/data/combatIcons'

// 整頁的元件會 import 路由檔（建 hash 路由要瀏覽器的 location）：伺服器端渲染用不到，只留頁面清單
vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>

// ---- 假資料：四個化身、三隻蕾絲、最小的構裝 ----

const WEAPON_CLASSES = [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }]
const STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const hack = (id: string, name: string, admin: Rec) => ({ id, class: 'hack', name, grade: 1, legal: 'banned', admin })
const CONSTRUCTS = [
  hack('cs_mop', '拖把', { wipe: { amount: 10 } }),
  hack('cs_mason', '泥瓦匠', { wall: { ram: 1, amount: 50 } }),
]
const PACK: ContentPack = { id: 'net_ui_test', content: { weapon_class: WEAPON_CLASSES, battle_status: STATUSES, construct: CONSTRUCTS } } as unknown as ContentPack

const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'deep', broken: [] as string[], ...o })
const DECK = { grade: 2, firewall: 12, slots: [] as string[], constructs: [] as unknown[] }
const gun = () => netWeapon(30, 4, { id: 'cs_gun', name: '夜巡', class: 'rifle', traits: ['long'], range: [1, 7] })
/** 化身：第一個是潛網者（admin 標籤、管理行動 2 次）；RAM 4／10 */
const avatar = (i: number, o: Rec = {}) => netAvatar(i, 1, { weapons: [gun()], pools: { ram: { now: 4, max: 10, regen: 2 } }, ext: { net: NET(i === 0 ? { admin: 2 } : {}), deck: DECK }, ...(i === 0 ? { tags: ['netrunner', 'admin'] } : {}), ...o } as never)
const lace = (o: Rec = {}) => laceUnit('minion', 1, { weapons: [gun()], ext: { net: NET({ sync_max: 'standard' }), deck: DECK }, ...o } as never)
const raw = (u: unknown) => ({ from: 'unit', unit: u as Rec })
const setupOf = (o: { allies?: unknown[]; foes?: unknown[]; trace?: number | null; commission?: boolean } = {}): BattleSetup => ({
  mode: 'net', grade: 1, cover: 'medium',
  allies: (o.allies ?? [0, 1, 2, 3].map((i) => avatar(i))).map(raw), foes: (o.foes ?? [lace(), lace(), lace()]).map(raw),
  ...(o.trace === null ? {} : { field: { trace: o.trace ?? 20 } }),
  origin: { escapable: true, place: '測試用的子網', ...(o.commission ? { ext: { commission: 'job_1' } } : {}) },
}) as BattleSetup

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
type Eng = ReturnType<typeof useEngine>

function start(o: Parameters<typeof setupOf>[0] = {}, seed = 7) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed, testContent: [PACK], testFeatures: [] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.startBattle(setupOf(o))
  return { e, pinia }
}
/** 讓 AI 走到輪到玩家 */
function toPlayer(e: Eng): void {
  for (let i = 0; i < 100 && e.battleOptions()?.waiting === 'ai'; i++) e.battleNext()
  expect(e.battleOptions()?.waiting).toBe('player')
}
/** 輪到指定的我方單位（其餘的結束回合，AI 照走） */
function toUnit(e: Eng, id: string): void {
  for (let i = 0; i < 100; i++) {
    const o = e.battleOptions()!
    if (o.waiting === 'ai') { e.battleNext(); continue }
    if (o.waiting === 'over' || o.current === id) break
    e.battleAct({ action: END_TURN })
  }
  expect(e.battleOptions()?.current).toBe(id)
}
const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/netcombat', component: { render: () => null } }, { path: '/combat', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: object): Promise<string> {
  const r = router()
  await r.push('/netcombat')
  await r.isReady()
  const app = createSSRApp(comp)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const strip = (s: string) => clean(s).replace(/<[^>]+>/g, '')
/** 在元件的 setup 裡開一份 useBattle（和戰鬥畫面用的是同一份），回傳它給測試呼叫 */
async function board(pinia: ReturnType<typeof createPinia>, opts: { from?: string; enc?: string } = {}): Promise<ReturnType<typeof useBattle>> {
  let bt!: ReturnType<typeof useBattle>
  const Probe = defineComponent({ setup() { bt = useBattle({ from: () => opts.from ?? '/', fast: () => true, enc: () => opts.enc, fallback: false }); return () => h('div') } })
  await render(pinia, Probe)
  return bt
}

beforeEach(() => setActivePinia(createPinia()))

describe('開一場內海戰鬥：換成內海的字、卡片沒有生命那一條', () => {
  it('引擎的戰場資料說是內海：layer 是 net、遮蔽叫防火牆；畫面讀這個，不讀網址', () => {
    const { e } = start()
    expect(e.battleLayer()).toBe('net')
    expect(e.battleMode()).toMatchObject({ layer: 'net', coverWord: '防火牆' })
    expect(e.battleMode()!.coverNames).toEqual(['暴露', '半防火牆', '防火牆'])
  })

  it('內海戰鬥頁：卡片上有感載與 RAM 分格、沒有生命；遮蔽的字是引擎戰場資料裡的；標題是內海', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-layer="net"')
    expect(h).toContain('data-row="load"')
    expect(h).toContain('data-row="ram"')
    expect(h).not.toContain('data-row="hp"')
    for (const word of e.battleMode()!.coverNames.slice(1)) expect(h).toContain(`，${word}"`)
    expect(h).not.toContain('，半掩體')
    expect(strip(h)).toContain('INNER SEA // 測試用的子網')
    // 同一組元件：現實戰鬥的外殼拿到內海的戰鬥，畫出來的也是內海的卡片
    const h2 = clean(await render(pinia, CombatScreen))
    expect(h2).toContain('data-layer="net"')
    expect(h2).not.toContain('data-row="hp"')
  })

  it('現實戰鬥的卡片照舊有生命那一條', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 7, testContent: [PACK], testFeatures: [] })
    expect(e.createCharacter(DRAFT)).toEqual([])
    const { BATTLE_SETUPS } = await import('@engine/src/testkit')
    e.startBattle(BATTLE_SETUPS.encounter())
    expect(e.battleLayer()).toBe('meat')
    const h = clean(await render(pinia, CombatScreen))
    expect(h).toContain('data-layer="meat"')
    expect(h).toContain('data-row="hp"')
    expect(h).not.toContain('data-trace')
  })
})

describe('圓環與鍵位：照引擎給的行動排', () => {
  it('圓環的每一格、花費、灰掉的原因和 battleOptions 一樣；管理行動與換檔不在圓環上', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const o = e.battleOptions()!
    const bt = await board(pinia)
    const want = ringOf(o)
    const ids = bt.ringItems.value.map((x) => x.k)
    expect(ids).toEqual([...want.attack, ...want.supply, ...want.tactic].map((a) => a.id))
    expect(ids).toContain('net_attack')
    expect(ids.some((id) => id.startsWith('adm_') || id === NET_SHIFT)).toBe(false)
    for (const item of bt.ringItems.value) {
      const a = o.actions.find((x) => x.id === item.k)!
      expect(item.cost).toBe(a.cost.ap)
      if (a.ok) expect(item.reason).toBeNull()
      else if (a.blocks.length) expect(item.reason).toBe(a.blocks.join('\n'))
      else expect(item.reason).toBeTruthy()
      if (a.cost.ram) expect(item.ram).toBe(String(a.cost.ram))
    }
    // 鍵位 1～9 照圓環的順序
    expect(bt.keys.value).toEqual(RING_KEYS(o))
    expect(bt.ringItems.value.map((x) => x.key)).toEqual(ids.map((_, i) => i + 1))
  })

  it('數字鍵作用：對到那一格的行動（不用選目標的直接送出）；空白鍵結束回合', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const bt = await board(pinia)
    const who = e.battleOptions()!.current
    const refill = bt.keys.value.indexOf('net_refill')
    expect(refill).toBeGreaterThanOrEqual(0)
    const k = combatKey({ key: String(refill + 1) }, { typing: false, dialogOpen: false, targeting: false })
    expect(k).toEqual({ type: 'ring', i: refill })
    const apBefore = e.battle!.units[who!]!.ap.now
    bt.chooseAction(bt.keys.value[(k as { i: number }).i]!)
    expect(e.battle!.units[who!]!.ap.now).toBeLessThan(apBefore)
    // 要選目標的行動：按數字鍵只是選上，還沒送出
    const att = bt.keys.value.indexOf('net_attack')
    bt.chooseAction(bt.keys.value[att]!)
    expect(bt.selId.value).toBe('net_attack')
    // 空白鍵：結束回合
    expect(combatKey({ key: ' ' }, { typing: false, dialogOpen: false, targeting: true })).toEqual({ type: 'end' })
    bt.cancel()
    bt.endTurn()
    expect(e.battleOptions()!.current).not.toBe(who)
  })
})

describe('同步檔位', () => {
  it('四檔一排、現在的那一檔亮；點深檔之後引擎的單位是深檔', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const bt = await board(pinia)
    const g = bt.gears.value!
    expect(g.cells.map((c) => c.gear)).toEqual(['shallow', 'standard', 'deep', 'full'])
    expect(g.cells.filter((c) => c.current).map((c) => c.gear)).toEqual(['standard'])
    expect(g.locked).toBeNull()
    const who = e.battleOptions()!.current!
    bt.shiftTo('deep')
    expect((e.battle!.units[who]!.ext.net as Rec).sync).toBe('deep')
    expect(bt.gears.value!.cells.find((c) => c.current)!.gear).toBe('deep')
  })

  it('開不了的那一檔：灰掉、原因和引擎的句子逐字相同；點它不會換', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const bt = await board(pinia)
    const who = e.battleOptions()!.current!
    const full = bt.gears.value!.cells.find((c) => c.gear === 'full')!
    const engineSays = e.netBattle()!.units.find((u) => u.unit === who)!.gears.find((x) => x.gear === 'full')!.blocks.join('\n')
    expect(engineSays).not.toBe('')
    expect(full.reason).toBe(engineSays)
    // 直接送給引擎，擋下的原因也是同一句
    const r = e.battleAct({ action: NET_SHIFT, pick: { gear: 'full' } })
    expect(r.status).toBe('refused')
    expect((r.reasons ?? []).join('\n')).toBe(engineSays)
    bt.shiftTo('full')
    expect(bt.hint.value).toBe(engineSays)
    expect((e.battle!.units[who]!.ext.net as Rec).sync).toBe('standard')
  })

  it('同一回合第二次點不動：整排灰掉、原因是引擎的句子', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const bt = await board(pinia)
    const who = e.battleOptions()!.current!
    bt.shiftTo('deep')
    expect(e.netBattle()!.units.find((u) => u.unit === who)!.shifted).toBe(true)
    const g = bt.gears.value!
    const shiftOpt = e.battleOptions()!.actions.find((a) => a.id === NET_SHIFT)!
    expect(shiftOpt.ok).toBe(false)
    expect(g.locked).toBe(shiftOpt.blocks.join('\n'))
    bt.shiftTo('shallow')
    expect((e.battle!.units[who]!.ext.net as Rec).sync).toBe('deep')
    expect(bt.hint.value).toBe(g.locked)
    // 畫面：整排的按鈕都標灰
    const h = clean(await render(pinia, NetCombatScreen))
    const sync = h.slice(h.indexOf('data-sync'), h.indexOf('data-sync') + 1800)
    expect((sync.match(/is-unavailable/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('每張我方的卡片上標檔位；敵人的卡片不標', async () => {
    const { e, pinia } = start()
    toPlayer(e)
    const h = clean(await render(pinia, NetCombatScreen))
    expect((h.match(/data-mark="gear"/g) ?? []).length).toBe(4)
    void e
  })

  it('不是你的回合：整排灰掉（gearPanel）', () => {
    const { e } = start()
    const o = e.battleOptions() as BattleOptions
    const nv = e.netBattle()!.units[0]
    expect(gearPanel(nv, undefined, false)!.locked).toBe('現在不是你的回合。')
    expect(gearPanel(undefined, undefined, true)).toBeNull()
    void o
  })
})

describe('追蹤度條', () => {
  it('條的值、刻度、跨過幾個門檻都和 netBattleView 一樣', async () => {
    const { e, pinia } = start({ trace: 45 })
    toPlayer(e)
    const v = e.netBattle()!
    const bar = traceBar(v)!
    expect(bar).toMatchObject({ value: v.trace, marks: [v.thresholds.t1, v.thresholds.t2, v.thresholds.t3], zone: 1, located: null })
    expect(v.trace).toBe(45)
    const bt = await board(pinia)
    expect(bt.trace.value).toEqual(bar)
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-trace')
    expect(h).toContain('data-value="45"')
    expect(strip(h)).toContain('追蹤度')
  })

  it('被定位的倒數：還剩幾輪', () => {
    const v = { trace: 90, thresholds: { t1: 30, t2: 60, t3: 90 }, located: 2 } as never
    expect(traceBar(v)).toMatchObject({ zone: 3, located: 2 })
    expect(traceBar({ ...(v as object), located: 0 } as never)!.located).toBe(0)
  })

  it('沒有追蹤度的戰鬥不顯示', async () => {
    const { e, pinia } = start({ trace: null })
    toPlayer(e)
    expect(e.netBattle()!.trace).toBeNull()
    expect(traceBar(e.netBattle())).toBeNull()
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).not.toContain('data-trace')
    expect(h).toContain('data-layer="net"')
  })

  it('追蹤度每次變動：照那一拍的 trace 事件算變了多少（畫面據此跳一下）', () => {
    const rep = (data: Rec) => ({ timeline: [{ tag: 'trace', text: '追蹤度。', data }] })
    expect(traceDelta([rep({ value: 23, amount: 3 }), rep({ value: 21, amount: -2 })])).toBe(1)
    expect(traceDelta([{ timeline: [{ tag: 'hit' }] }])).toBe(0)
  })

  it('開打之後引擎讓追蹤度走一輪：條跟著引擎的值變，bump 記下那一拍的變動', async () => {
    const { e, pinia } = start({ trace: 20 })
    const bt = await board(pinia)
    const before = e.netBattle()!.trace!
    for (let i = 0; i < 200 && e.netBattle()!.trace === before; i++) {
      const o = e.battleOptions()!
      if (o.waiting === 'ai') bt.engine.battleNext()
      else if (o.waiting === 'player') { const r = e.battleAct({ action: END_TURN }); void r }
    }
    expect(e.netBattle()!.trace).toBeGreaterThan(before)
    expect(bt.trace.value!.value).toBe(e.netBattle()!.trace)
  })
})

describe('管理行動', () => {
  it('只在有 admin 的人輪到時出現；七個按鈕各寫 RAM，次數是引擎的', async () => {
    const { e, pinia } = start()
    const bt = await board(pinia)
    toUnit(e, 'a2')
    expect(bt.admin.value).toBeNull()
    expect(clean(await render(pinia, NetCombatScreen))).not.toContain('data-admin-panel')
    toUnit(e, 'a1')
    const p = bt.admin.value!
    expect(p.buttons).toHaveLength(7)
    const o = e.battleOptions()!
    for (const b of p.buttons) expect(b.ram).toBe(o.actions.find((a) => a.id === b.id)!.cost.ram ?? 0)
    const adm = e.netBattle()!.units.find((u) => u.unit === 'a1')!.admin!
    expect(p).toMatchObject({ limit: adm.limit, used: adm.used, left: adm.left })
    expect(adm.limit).toBe(2)
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-admin-panel')
    expect(strip(h)).toContain('這一回合還能做 2／2 次')
    // 灰掉的帶引擎的原因：每一個按鈕的 reason 就是 battleOptions 的 blocks
    for (const b of p.buttons) { const a = o.actions.find((x) => x.id === b.id)!; expect(b.reason).toBe(a.ok ? null : a.blocks.join('\n') || null) }
  })

  it('次數用完全部灰掉；原因是引擎的', async () => {
    const { e, pinia } = start()
    const bt = await board(pinia)
    toUnit(e, 'a1')
    // 擦痕跡不用選目標：做兩次（次數 2）
    for (let i = 0; i < 2; i++) bt.chooseAction('adm_wipe')
    const p = bt.admin.value!
    const used = e.netBattle()!.units.find((u) => u.unit === 'a1')!.admin!
    expect(used).toMatchObject({ left: 0, used: 2 })
    expect(p.left).toBe(0)
    expect(p.buttons.every((b) => !!b.reason)).toBe(true)
    const o = e.battleOptions()!
    for (const b of p.buttons) expect(b.reason).toBe(o.actions.find((a) => a.id === b.id)!.blocks.join('\n'))
    const h = clean(await render(pinia, NetCombatScreen))
    const chunk = h.slice(h.indexOf('data-admin-panel'), h.indexOf('data-admin-panel') + 4000)
    expect((chunk.match(/data-admin="adm_/g) ?? []).length).toBe(7)
    expect((chunk.match(/is-unavailable/g) ?? []).length).toBeGreaterThanOrEqual(7)
  })

  it('要選格子或目標的走現有的目標流程：選上之後等目標', async () => {
    const { e, pinia } = start()
    const bt = await board(pinia)
    toUnit(e, 'a1')
    bt.chooseAction('adm_mark')
    expect(bt.selId.value).toBe('adm_mark')
    expect(bt.selAction.value!.targets.length).toBeGreaterThan(0)
  })

  it('技能清單裡不重複列七個管理行動；花管理行動的技能查引擎的技能資料（沒有就是 0）', async () => {
    const { e, pinia } = start()
    const bt = await board(pinia)
    toUnit(e, 'a1')
    expect(bt.skillList.value.some(({ a }) => a.id.startsWith('adm_'))).toBe(false)
    expect(e.skillAdminCost('no_such_skill')).toBe(0)
  })
})

describe('標記：閃斷、構裝、被釘住', () => {
  it('把一個單位打到過載：卡片上有閃斷的標', async () => {
    // 蕾絲的感載上限很低、只差 1 點：一擊就過載
    const weak = lace({ load: { now: 21, max: 22 } })
    const { e, pinia } = start({ foes: [weak, lace(), lace()] })
    let flashed = false
    for (let i = 0; i < 12 && !flashed; i++) {
      const o = e.battleOptions()!
      if (o.waiting === 'ai') e.battleNext()
      else if (o.waiting === 'player') {
        const r = e.battleAct({ action: 'net_attack', target: { unit: 'f1' } })
        if (r.status === 'refused') e.battleAct({ action: END_TURN })
      } else break
      flashed = !!e.battle!.units.f1!.statuses.find((s) => s.id === 'flash')
    }
    expect(flashed).toBe(true)
    const bt = await board(pinia)
    const cell = bt.view.value!.cells.find((c) => c.unit?.id === 'f1')!
    expect(cell.unit!.statusIds).toContain('flash')
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-mark="st:flash"')
    expect(strip(h)).toContain('閃斷')
  })

  it('被釘住的人退出了戰鬥、沒有卡片：標在先攻條上', async () => {
    expect(outLabel('pinned')).toBe('被釘住')
    expect(outLabel('jacked_out')).toBe('已拔線')
    expect(outLabel(undefined)).toBeUndefined()
  })

  it('破損的槽、停用的構裝、標記都從引擎給的欄位來', async () => {
    const { e, pinia } = start({ allies: [avatar(0, { ext: { net: NET({ broken: ['cs_gun'], admin: 2 }), deck: DECK } }), avatar(1), avatar(2), avatar(3)] })
    toPlayer(e)
    const v = e.netBattle()!
    expect(v.units.find((u) => u.unit === 'a1')!.broken).toEqual([{ id: 'cs_gun', name: 'cs_gun' }])
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-mark="broken:cs_gun"')
  })
})

describe('結束：拔線、戰敗', () => {
  it('四個人都拔線：顯示撤退的那一句、沒有戰敗面板', async () => {
    const { e, pinia } = start({ commission: false })
    for (let i = 0; i < 100 && e.battleOptions()!.waiting !== 'over'; i++) {
      const o = e.battleOptions()!
      if (o.waiting === 'ai') e.battleNext()
      else { const r = e.battleAct({ action: 'net_jack_out' }); expect(r.status, JSON.stringify(r.reasons)).toBe('applied') }
    }
    expect(e.battleOptions()!.waiting).toBe('over')
    expect(e.battle!.result!.outcome).toBe('jack_out')
    const text = e.battle!.result!.text
    expect(text).not.toBe('')
    const bt = await board(pinia)
    expect(bt.retreat.value).toBe(true)
    expect(bt.resultName.value).toBe('撤退')
    expect(bt.lost.value).toBe(false)
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-end="retreat"')
    expect(strip(h)).toContain(text)
    expect(h).not.toContain('data-defeat')
    expect(strip(h)).toContain('回去')
    // 結算之後不留等著選的戰敗
    expect((await e.finishBattle()).status).toBe('applied')
    expect(e.pendingDefeat).toBeNull()
  })

  it('投降與戰敗照舊（戰敗面板）；內海的戰敗面板多顯示被定位與被扣線的列', () => {
    expect(defeatNetRows({ net: false, tethered: true, located: true })).toEqual([])
    expect(defeatNetRows({ net: true, tethered: false, located: false })).toEqual([])
    expect(defeatNetRows({ net: true, tethered: true, located: false }).map((r) => r.v).join('')).toContain('被扣線')
    expect(defeatNetRows({ net: true, tethered: false, located: true }).map((r) => r.v).join('')).toContain('被定位')
  })

  it('這一場在委託副本裡（netBattleView 給的）：拔線的提示加一句「全員拔線會回到進副本之前」', async () => {
    const a = start({ commission: true })
    toPlayer(a.e)
    expect(a.e.netBattle()!.commission).toBe(true)
    expect(strip(await render(a.pinia, NetCombatScreen))).toContain('全員拔線會回到進副本之前')
    const b = start({ commission: false })
    toPlayer(b.e)
    expect(b.e.netBattle()!.commission).toBe(false)
    expect(clean(await render(b.pinia, NetCombatScreen))).not.toContain('data-commission-note')
  })

  it('沒有進行中的戰鬥：不開舊 Demo 的假戰鬥，寫一句話與「回去」', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 7, testContent: [PACK], testFeatures: [] })
    expect(e.createCharacter(DRAFT)).toEqual([])
    const h = clean(await render(pinia, NetCombatScreen))
    expect(h).toContain('data-nobattle')
    expect(e.inBattle).toBe(false)
  })
})

describe('氣氛：彈幕照事件標籤放，不影響任何數字；觀看數拿掉', () => {
  const rep = (...beats: Array<{ tag: string; text: string; data?: Rec }>) => [{ timeline: beats }] as never
  it('內海的幾種事件（換檔、干擾、破損、釘住、拔線、管理行動、追蹤度、被定位）進彈幕；追蹤度與被定位不算好事', () => {
    const ev = liveEventsOf(rep(
      { tag: 'shift', text: '零換到深檔。', data: { unit: 'a1' } },
      { tag: 'jam', text: '干擾。', data: { target: 'f1' } },
      { tag: 'break', text: '破損。', data: { target: 'f1' } },
      { tag: 'pin', text: '釘住。', data: { target: 'f1', side: 'foe' } },
      { tag: 'jack_out', text: '拔線。', data: { target: 'a1', side: 'ally' } },
      { tag: 'admin', text: '造牆。', data: { unit: 'a1', ok: true } },
      { tag: 'trace', text: '追蹤度 +3。', data: { amount: 3, value: 23 } },
      { tag: 'located', text: '被定位。', data: { located: true } },
    ), { units: { a1: { side: 'ally' }, f1: { side: 'foe' } } } as never)
    expect(ev.map((x) => x.tag)).toEqual(['shift', 'jam', 'break', 'pin', 'jack_out', 'admin', 'trace', 'located'])
    expect(ev.map((x) => x.good)).toEqual([true, true, true, true, false, true, false, false])
    expect(danmakuOf(ev).map((d) => d.text)).toHaveLength(8)
    expect(danmakuOf(ev).filter((d) => d.kind === 'hot')).toHaveLength(1)
  })

  it('NetCombatScreen 不再有觀看數；沒有 LiveWindow（直播的容器在 M5）', () => {
    expect(netScreenSrc).not.toMatch(/觀看|viewers|LiveWindow/)
    expect(boardSrc).toContain('v-if="!isNet')
  })
})

describe('圖示：引擎的鍵都有圖（沒有圖的先借最接近的）', () => {
  it('refill、script、tool、shift、admin、hack 與環上其餘的鍵', () => {
    for (const k of ['refill', 'swap', 'script', 'cover', 'watch', 'subdue', 'flee', 'surrender', 'melee', 'shoot', 'tool', 'shift', 'admin', 'hack', 'node']) expect(COMBAT_ICONS[k], k).toBeTruthy()
  })
})

// ---- 舊 Demo 的規則整份拿掉 ----

import netScreenSrc from '../../src/screens/NetCombatScreen.vue?raw'
import boardSrc from '../../src/components/combat/BattleBoard.vue?raw'
describe('舊 Demo 的內海戰鬥已經拿掉', () => {
  it('ui/src 裡沒有任何檔 import lib/combat/net、NET_ENCOUNTERS；net.ts、net4.test.ts、real.ts 不存在', () => {
    const all = import.meta.glob(['../../src/**/*.vue', '../../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    for (const [f, src] of Object.entries(all)) {
      expect(src, f).not.toMatch(/combat\/net['"]/)
      expect(src, f).not.toMatch(/combat\/real['"]/)
      expect(src, f).not.toMatch(/\bNET_ENCOUNTERS\b/)
    }
    const files = Object.keys(import.meta.glob(['../../src/lib/combat/net.ts', '../../src/lib/combat/net4.test.ts', '../../src/lib/combat/real.ts', '../../src/data/encounters.ts', '../../src/lib/combat/real4.test.ts']))
    expect(files).toEqual([])
  })

  it('NetCombatScreen.vue 與共用的元件裡沒有 d20、Math.random、applyDifficulty；netView 沒有擲骰', () => {
    for (const src of [netScreenSrc, boardSrc]) expect(src).not.toMatch(/d20|Math\.random|applyDifficulty/)
    const libs = import.meta.glob(['../../src/lib/netView.ts', '../../src/lib/useBattle.ts', '../../src/components/combat/Net*.vue'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(libs).length).toBeGreaterThanOrEqual(5)
    for (const [f, src] of Object.entries(libs)) expect(src, f).not.toMatch(/d20|Math\.random|applyDifficulty|mulberry|\brng\b/)
  })

  it('App 看引擎開的戰場在哪一層換頁與換皮，不看網址參數', async () => {
    const app = (await import('../../src/App.vue?raw')).default
    expect(app).toMatch(/battleLayer\(\)/)
    expect(app).toContain("'/netcombat'")
    expect(app).not.toMatch(/route\.query\.enc/)
  })

  it('netUnitOf：輪到的人不在 netBattleView 裡（敵人）是 undefined', () => {
    expect(netUnitOf(null, null)).toBeUndefined()
  })
})
