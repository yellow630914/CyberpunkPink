// 驗收測試：dev/work/M3-ui-commission-net.md（cpp-ui）。委託的內海面：追蹤度條、面卡與隔離區、進入內海的一段、離開後的帳、簡報與踩點的內海標示。
// 引擎用真的（commission、fixer、netrun、netcombat、deck、enemies）；內容是測試自帶的最小假資料（fixtures.ts 的房間加一座蕾絲與一副甲板）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ContentPack, Feature, Kernel } from '@engine/src'
import { AIRGAP_TEXT } from '@engine/src/features/commission'
import { netWeapon } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import RunTab from '../../src/components/commission/RunTab.vue'
import TakePanel from '../../src/components/commission/TakePanel.vue'
import ScoutTab from '../../src/components/commission/ScoutTab.vue'
import app from '../../src/App.vue?raw'
import { DRAFT, PACK, html, text } from './fixtures'
import { playNetStage } from './netPlay'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

type Rec = Record<string, unknown>
const meat = (gives?: string, at = 'T1'): Rec => ({ map: 'ui_room_a', encounter: [], goal: { kind: 'reach', at }, ...(gives ? { gives } : {}), branches: [{ id: 'assault', kind: 'assault', entry: 'E1' }] })
const net = (extra: Rec = {}): Rec => ({ region: 'sub_ui', layer: 'guest', encounter: ['minion'], branches: [{ id: 'assault', kind: 'assault' }], ...extra })

/** 四階段：1 現實或內海、2 現實或內海、3 只有現實（給資料埠）、4 只有內海（隔離區） */
const NET4 = {
  id: 'cm_net4', name: '內海的四階段', kind: 't_ui', main: 'net', scale: 'medium', grade: 1, target_faction: 'hizakura', district: 'ui_d', conditions: [],
  stages: [
    { name: '外圍', faces: { meat: meat(), net: net() } },
    { name: '員工層', faces: { meat: meat(), net: net({ layer: 'staff' }) } },
    { name: '現實的資料埠', faces: { meat: meat('airgap_open') } },
    { name: '隔離區', faces: { net: net({ layer: 'core', locked_by: 'airgap_open' }) } },
  ],
  links: { airgap_open: { type: 'open', name: '資料埠', effect: { stage: 4, gate_open: true } } },
}
/** 同一件，但資料埠是第三階段的內海面給的：玩家選現實就拿不到，隔離區鎖著 */
const NET4_GAP = { ...NET4, id: 'cm_net4_gap', stages: [...NET4.stages.slice(0, 2), { name: '資料埠在內海那一面', faces: { meat: meat(), net: net({ gives: 'airgap_open' }) } }, NET4.stages[3]] }
/** 純現實：三個階段都只有現實 */
const MEAT3 = {
  id: 'cm_meat3', name: '純現實的三階段', kind: 't_ui', main: 'meat', scale: 'small', grade: 2, target_faction: 'hizakura', district: 'ui_d', conditions: [],
  stages: ['甲', '乙', '丙'].map((name) => ({ name, faces: { meat: meat() } })), links: {},
}
const OFFERS = [
  { id: 'of_net4', title: '內海的四階段', brief: '潛進去。', reward: 1000, commission: NET4, unknowns: [{ id: 'u_lace', cat: 'lace', text: '第一階段由白蕾絲看守。', reveal: { flag: 'lace_s1' }, face: 'net' }, { id: 'u_g', cat: 'guard', text: '辦公層四個保全', reveal: { guards: 1 } }] },
  { id: 'of_net4_gap', title: '隔離區鎖著', brief: '潛進去。', reward: 1000, commission: NET4_GAP, unknowns: [] },
  { id: 'of_meat3', title: '純現實', brief: '動手。', reward: 800, commission: MEAT3, unknowns: [] },
]
const lace = (id: string, rank: string, color: string): Rec => ({
  id, name: `測試${id}`, desc: '測試用。', faction: 'hizakura', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
const COUNTS0 = { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] }
const NETPACK = {
  id: 'ui_net_pack',
  content: {
    net_region: [{ id: 'sub_ui', name: '測試子網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22], oneway: 0.5, fragile: 0.5, loops: 2, layer: { ...COUNTS0, foe: [1, 1], rest: [1, 1] }, commission: { ...COUNTS0, foe: [1, 1], rest: [1, 1] } }],
    deck: [{ id: 'dk_ii', name: '測試甲板 II', desc: '測試。', grade: 2, slots: 4, firewall: 12, legal: 'free' }],
    construct: [{ id: 'cs_rifle', class: 'weapon', name: '夜巡', grade: 3, legal: 'register', type: 'neural', ram: 1, archetype: 'rifle' }],
    weapon_class: [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    enemy: [lace('l_w', 'minion', 'white'), lace('l_p', 'minion', 'pink'), lace('l_e', 'elite', 'pink'), lace('l_b', 'boss', 'pink')],
  },
} as unknown as ContentPack
const OFFERS_FEATURE: Feature = {
  id: 'ui_net_offers',
  install(k: Kernel) { k.hooks.on('fixer.offers', 'ui_net_offers', ({ fixer }) => (fixer.id === 'fx_ui' ? structuredClone(OFFERS) as never : undefined)) },
}
const GEAR: Feature = { id: 'ui_net_gear', install(k) { k.battle.loadout('ui_net_gear', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(60, 14)] } : undefined)) } }
const give = (id: string, data?: Rec) => ({ op: 'item', id, qty: 1, ...(data ? { data } : {}) }) as never

function start(seed = 7) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed, testContent: [PACK, NETPACK], testFeatures: [OFFERS_FEATURE, GEAR] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '給東西', changes: [give('dk_ii', { uid: 'D1' }), give('cs_rifle')] })).toBeNull()
  expect(e.commit({ summary: '練槍', changes: [{ op: 'actor.skill', id: e.state.pc!, skill: 'firearms', delta: 5 }, { op: 'actor.skill', id: e.state.pc!, skill: 'interface', delta: 3 }] as never })).toBeNull()
  expect(e.deck.equip('D1')).toBeNull()
  expect(e.deck.install('cs_rifle')).toBeNull()
  return { e, pinia }
}
type Eng = ReturnType<typeof start>['e']
const depart = async (e: Eng, id: string) => {
  expect((await e.fixer.accept({ id, fixer: 'fx_ui' }, 'cash')).status).toBe('applied')
  const r = await e.fixer.go(id)
  expect(r.reason).toBeUndefined()
}
const minutes = (e: Eng) => e.state.time.day * 1440 + e.state.time.hour * 60 + e.state.time.minute
/** 把人傳到現實面的格子（測試用的引擎變更）並讓副本自己接里程碑 */
function meatTo(e: Eng, x: number, y: number) {
  const at = e.state.maps.at!
  expect(e.commit({ summary: '傳送', action: 'commission.test', changes: [{ op: 'map.at', to: { map: at.map, sheet: at.sheet, x, y } }] as never })).toBeNull()
}
async function stageMeat(e: Eng, at: [number, number] = [4, 2]) {
  expect((await e.commission.chooseFace('meat')).status).toBe('applied')
  expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
  meatTo(e, at[0], at[1])
}

describe('副本頁：追蹤度條', () => {
  it('有內海階段的委託顯示追蹤度條，值與刻度等於引擎的 commissionView().trace', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    const v = e.commission.view()!
    const h = await html(pinia, RunTab)
    expect(h).toContain('data-trace')
    expect(h).toContain(`data-value="${v.trace.value}"`)
    expect(text(h)).toContain(`刻度在 ${v.trace.marks.join('、')}`)
    expect(v.trace.marks).toEqual([30, 60, 90])
  })
  it('純現實的委託不顯示', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_meat3')
    expect(await html(pinia, RunTab)).not.toContain('data-trace')
  })
})

describe('進入內海的一段', () => {
  it('選內海面與強攻：引擎開了網內的行程（App 照它換到子網頁）；副本頁寫「回到子網」', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    expect((await e.commission.chooseFace('net')).status).toBe('applied')
    expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
    expect(e.net.view()?.kind).toBe('face.net')
    expect(app).toMatch(/eng\.net\.view\(\)\?\.id[\s\S]*push\('\/subnet'\)/)
    expect(await html(pinia, RunTab)).toContain('data-to-subnet')
  })
  it('通過閘門之後回到副本頁：階段軌往前一格、城裡多 2 小時、寫離開時的追蹤度', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    const t0 = minutes(e)
    expect((await e.commission.chooseFace('net')).status).toBe('applied')
    expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
    expect(await playNetStage(e)).toBeGreaterThan(0)
    expect(e.net.view()).toBeNull()
    const v = e.commission.view()!
    expect(v.stage).toBe(2)
    expect(v.step).toBe('face')
    expect(minutes(e) - t0).toBeGreaterThanOrEqual(120)
    const h = await html(pinia, RunTab)
    expect(h).toContain('data-net-last')
    expect(text(h)).toContain(`第 1 階段（內海）做完：離開時追蹤度 ${v.trace.value}`)
  })
  it('在子網裡登出並確認：回到召集之前的狀態，紀錄標成被收回', async () => {
    const { e } = start()
    const m0 = minutes(e)
    const cash0 = e.money.cash
    await depart(e, 'of_net4')
    expect((await e.commission.chooseFace('net')).status).toBe('applied')
    expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
    expect(e.net.view()!.logout.note).toBeTruthy()
    expect((await e.net.logout()).status).toBe('applied')
    expect(e.net.view()).toBeNull()
    expect(e.commission.view()).toBeNull()
    expect(minutes(e) - m0).toBeLessThanOrEqual(60)
    expect(e.money.cash).toBe(cash0)
    expect(e.state.reports.some((r) => r.retracted === true)).toBe(true)
  })
})

describe('隔離區', () => {
  it('第三階段做完、拿到資料埠之後，第四階段的內海面選得了', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    await stageMeat(e)
    await stageMeat(e)
    await stageMeat(e)
    const v = e.commission.view()!
    expect(v.stage).toBe(4)
    const f = v.faces.find((x) => x.face === 'net')!
    expect(f.locked).toBeUndefined()
    expect(f.block).toBeNull()
    expect(await html(pinia, RunTab)).not.toContain('data-locked="1"')
  })
  it('沒拿到資料埠：內海面變淡，原因和引擎的句子逐字相同', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4_gap')
    await stageMeat(e)
    await stageMeat(e)
    await stageMeat(e)
    const v = e.commission.view()!
    expect(v.stage).toBe(4)
    const f = v.faces.find((x) => x.face === 'net')!
    expect(f.locked).toBe(AIRGAP_TEXT)
    expect(f.block).toBe(AIRGAP_TEXT)
    const h = await html(pinia, RunTab)
    const chunk = h.slice(h.indexOf('data-face="net"'), h.indexOf('data-face="net"') + 700)
    expect(chunk).toContain('data-locked="1"')
    expect(text(chunk)).toContain(AIRGAP_TEXT)
    expect((await e.commission.chooseFace('net')).reason).toBe(AIRGAP_TEXT)
  })
})

describe('簡報與踩點', () => {
  it('簡報：主面是內海的標「這是一件要潛進去的委託」，引擎的提醒照列', async () => {
    const { e, pinia } = start()
    const row = e.fixer.board('fx_ui').offers.find((o) => o.id === 'of_net4')!
    expect(row.net).not.toBeNull()
    const h = await html(pinia, TakePanel, { fixerId: 'fx_ui' })
    expect(h).toContain('data-offer="of_net4"')
    expect(h).toContain('data-net-note')
  })
  it('踩點：內海的未知照面標色', async () => {
    const { e, pinia } = start()
    expect((await e.fixer.accept({ id: 'of_net4', fixer: 'fx_ui' }, 'cash')).status).toBe('applied')
    const h = await html(pinia, ScoutTab, { jobId: 'of_net4' })
    expect(h).toContain('data-unknown="u_lace"')
    expect(h).toMatch(/class="[^"]*\bnet\b[^"]*"[^>]*data-unknown="u_lace"/)
    expect(text(h)).toContain('內海')
    expect(e.fixer.scoutView('of_net4').unknowns.find((u) => u.id === 'u_lace')!.face).toBe('net')
  })
})
