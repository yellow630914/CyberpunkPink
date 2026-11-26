// 驗收測試：dev/work/M4-ui-body.md（cpp-ui）。角色的身體與橋分頁、診所對話框、藥、沉溺接上引擎的 cyberware、medical、drugs、sink、lewd。
// 引擎用真的；內容是測試自帶的最小假資料（兩座橋、幾件義體與零件、三間診所、藥）；示意世界包那一條用它自己的資料。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的 body 動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack } from '@engine/src'
import { toMinutes } from '@engine/src'
import { useEngine } from '../../src/stores/engine'
import BodyTab from '../../src/dialogs/character/BodyTab.vue'
import BridgeTab from '../../src/dialogs/character/BridgeTab.vue'
import ClinicDialog from '../../src/dialogs/ClinicDialog.vue'
import RetreatPanel from '../../src/components/body/RetreatPanel.vue'
import HpBar from '../../src/components/body/HpBar.vue'
import PartyRow from '../../src/components/PartyRow.vue'
import { chanceText, floorRows, floorSum, hpBlur, installRows } from '../../src/lib/bodyView'
import { DEMO_DECK_UID, blockIdOf } from '../../src/data/demo'
import { markerOfFacility } from '../../src/data/demo/world'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

// ---- 假資料 ----
const part = (id: string, type: string, o: Rec = {}): Rec => ({ id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...o })
const PARTS: Rec[] = [
  part('pt_plate', 'plate', { price: 400, stats: { armor: 2 } }), part('pt_act', 'actuator', { price: 300 }), part('pt_neuron', 'neuron', { price: 300 }),
  part('pt_lens', 'sensor', { price: 500 }), part('pt_chip', 'chip', { price: 100 }),
  part('pt_chip52', 'chip', { price: 900, bridge: { capacity: 52 } }), part('pt_chip64', 'chip', { price: 1600, bridge: { capacity: 64 } }),
  part('pt_sw_even', 'software', { price: 300, bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
  part('pt_sw_net', 'software', { price: 400, bridge: { split: { meat: 1, net: 3, social: 1, media: 1 } } }),
]
const bp = (id: string, o: Rec = {}): Rec => ({ id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 1, legal: 'register', price: 900, require: [], optional: [], ...o })
const BLUEPRINTS: Rec[] = [
  bp('bp_arm', { name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 3, effects: [{ attr: 'body', amount: 1 }], require: [{ type: 'plate' }, { type: 'actuator' }, { type: 'neuron' }] }),
  bp('bp_eye', { name: '義眼', slot: 'eye', invasiveness: 'light', sink_cost: 3, require: [{ type: 'sensor' }], effects: [{ stat: 'max_hp', amount: 1 }] }),
  bp('bp_pain', { name: '痛覺編輯器', slot: 'brain', invasiveness: 'surface', sink_cost: 1, tags: ['pain_editor'], require: [{ type: 'neuron' }] }),
  bp('bp_bridge', { name: '通用橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, grade: 2, bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }, { type: 'software' }], effects: [{ stat: 'max_hp', amount: 2 }] }),
  bp('bp_bridge2', { name: '潛網者橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 5, grade: 3, bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }, { type: 'software' }] }),
  bp('bp_sub', { name: '訂閱義眼', slot: 'eye', invasiveness: 'light', sink_cost: 2, lock: 'subscription', require: [{ type: 'sensor' }] }),
]
const drug = (id: string, name: string, d: Rec): Rec => ({ id, name, desc: `${name}。`, category: 'drug', grade: 1, size: 0, legal: 'free', drug: d })
const ITEMS: Rec[] = [
  drug('it_focus', '專注劑', { duration: { minutes: 240 }, effects: [{ check: { skills: ['hack'] }, amount: 2 }], addiction: { per_dose: 25, withdrawal: { days: 5, effects: [{ check: { skills: ['hack'] }, amount: -2 }] } } }),
  drug('it_calm', '鎮靜劑', { duration: { minutes: 1440 }, eases_withdrawal: true }),
]
const MAP = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
const PACK = {
  id: 'body_ui_test',
  content: {
    special_map: [MAP],
    facility_type: [
      { id: 'fac_clinic', name: '正規診所', clinic: { grade: 'clinic' }, therapy: { kind: 'counsel' } },
      { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
      { id: 'fac_shop', name: '雜貨店' },
      { id: 'fac_retreat', name: '傳教所', therapy: { kind: 'retreat' } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street', 'b_plain'] }],
    block: [
      { id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '清和診所' }, F2: { type: 'fac_black', name: '後巷' }, F3: { type: 'fac_retreat', name: '傳教所' } } },
      { id: 'b_plain', district: 'd_hive', name: '雜貨街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '雜貨店' } } },
    ],
    part: PARTS, blueprint: BLUEPRINTS, item: ITEMS,
    quirk: [{ id: 'cx_scar', name: '疤痕組織', desc: '縫合的地方留了疤。', kind: 'complication', pool: ['complication'], effects: [{ attr: 'reflex', amount: -1 }] }],
    // 沒有 ability 條件的人也能自己動刀：測試把手術的前提條件清空（abilities 的 daily 條件是另一個功能的事）
    cyber_rule: [{ id: 'default', self_requires: [] }],
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
const STOCK: Record<string, Rec> = {
  bp_arm: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron' }, bp_eye: { sensor: 'pt_lens' }, bp_pain: { neuron: 'pt_neuron' }, bp_sub: { sensor: 'pt_lens' },
  bp_bridge: { chip: 'pt_chip52', software: 'pt_sw_even' }, bp_bridge2: { chip: 'pt_chip64', software: 'pt_sw_net' },
}
const stack = (id: string, uid: string, extra: Rec = {}) => give(id, 1, { uid, parts: STOCK[id], ...extra })
const BAG = [stack('bp_arm', 'U_ARM'), stack('bp_eye', 'U_EYE'), stack('bp_pain', 'U_PAIN'), stack('bp_bridge2', 'U_BR2'), stack('bp_sub', 'U_SUB', { lock: { kind: 'subscription', owed: 0 } }), give('it_focus', 6), give('it_calm', 2), give('pt_neuron', 2)]

function start(o: { at?: 'F1' | 'F2' | 'F3' | 'plain'; bridge?: boolean; money?: number; bag?: unknown[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: 7, testContent: [PACK] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  const pc = e.pc!.id
  const changes = [
    { op: 'cred', delta: (o.money ?? 20000) - e.money.cred }, { op: 'cash', delta: (o.money === undefined ? 1000 : 0) - e.money.cash },
    ...(o.bag ?? BAG),
    { op: 'actor.ext', id: pc, key: 'bridge', value: { sensitivity: 50, tolerance: 30, craving: 30, docility: 30 } },
    ...(o.bridge === false ? [] : [{ op: 'actor.ext', id: pc, key: 'cyber', value: { pieces: [{ uid: 'B_START', bp: 'bp_bridge', kind_of: 'blueprint', slot: 'bridge', parts: STOCK.bp_bridge, sink: 4, at: 0, registered: true }] } }, { op: 'actor.track', id: pc, track: 'sink', delta: 4 }]),
  ]
  expect(e.commit({ summary: '給東西', changes: changes as never })).toBeNull()
  return { e, pinia, pc }
}
async function stand(e: Eng, at: 'F1' | 'F2' | 'F3' | 'plain'): Promise<void> {
  const r = at === 'plain' ? await e.world.arrive('b_plain', 'F1') : await e.world.arrive('b_street', at)
  expect(r.status).toBe('applied')
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
const minutes = (e: Eng) => toMinutes(e.state.time)

beforeEach(() => setActivePinia(createPinia()))

describe('身體分頁：部位與每一槽', () => {
  it('每個部位每一槽等於引擎的 cyberView；空槽也列出來', async () => {
    const { e, pinia } = start()
    const v = e.body.cyber()!
    const h = clean(await render(pinia, BodyTab))
    expect(v.parts).toHaveLength(11)
    for (const p of v.parts) {
      expect(h).toContain(`data-part="${p.id}"`)
      for (let i = 0; i < p.slots; i++) expect(h).toContain(`data-slot="${p.id}:${i}"`)
    }
    expect(h.match(/data-slot="/g)).toHaveLength(v.parts.reduce((n, p) => n + p.pieces.length, 0))
    // 橋的那一槽是滿的，其餘空槽的狀態是 empty
    expect(h).toContain('data-slot="bridge:0" data-status="ready"')
    expect(h).toContain('data-slot="eye:0" data-status="empty"')
  })

  it('裝一件之後：成本、下限、沉溺和引擎的狀態一致', async () => {
    const { e, pinia, pc } = start()
    await stand(e, 'F1')
    const before = e.body.cyber()!
    expect(e.body.install({ uid: 'U_EYE', via: 'clinic' })).toBeNull()
    const v = e.body.cyber()!
    const eye = v.parts.find((p) => p.id === 'eye')!.pieces[0]!
    expect(eye.name).toBe('義眼')
    expect(v.sink_floor).toBe(before.sink_floor + eye.sink)
    expect(e.state.actors[pc]!.sink).toBe(e.body.sink()!.value)
    expect(e.body.sink()!.floor).toBe(v.sink_floor)
    const h = clean(await render(pinia, BodyTab))
    expect(text(h)).toContain(`沉溺的下限 ${v.sink_floor}`)
    expect(h).toMatch(new RegExp(`data-sink-floor[^>]*>.*?<b[^>]*>${v.sink_floor}</b>`))
    expect(h).toMatch(new RegExp(`data-sink-value[^>]*>.*?<b[^>]*>${e.body.sink()!.value}</b>`))
  })

  it('下限的組成加起來等於 sink_floor；分段的名字與得失來自引擎', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    expect(e.body.install({ uid: 'U_EYE', via: 'clinic' })).toBeNull()
    const s = e.body.sink()!
    const rows = floorRows(s.floorParts)
    expect(rows.length).toBeGreaterThan(0)
    expect(floorSum(s.floorParts)).toBe(s.floor)
    const h = clean(await render(pinia, BodyTab))
    for (const r of rows) expect(h).toContain(`data-floor-part="${r.value}"`)
    expect(text(h)).toContain(s.band.name)
    expect(text(h)).toContain(String(s.shown))
  })

  it('休養中的那一件有標示，而且它的效果不在生效的清單裡', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    expect(e.body.install({ uid: 'U_ARM', via: 'clinic', side: 'l' })).toBeNull()
    const arm = e.body.cyber()!.parts.find((p) => p.id === 'arm_l')!.pieces[0]!
    expect(arm.status).toBe('recovering')
    const h = clean(await render(pinia, BodyTab))
    expect(h).toContain('data-slot="arm_l:0" data-status="recovering"')
    expect(h).toContain('data-badge="recovering"')
    // 引擎的被動效果裡沒有它的效果（義臂：體格 +1）；畫面的清單也沒有
    expect(e.body.passives().some((p) => 'attr' in p && p.attr === 'body' && p.label === '義臂')).toBe(false)
    const list = h.slice(h.indexOf('data-passives'), h.indexOf('data-drug-panel'))
    expect(list).not.toContain('義臂')
    // 休養的時間過去之後，它才進清單
    expect(e.commit({ summary: '睡', changes: [{ op: 'time', minutes: 24 * 60 + 5 }] as never })).toBeNull()
    expect(e.body.cyber()!.parts.find((p) => p.id === 'arm_l')!.pieces[0]!.status).toBe('ready')
    expect(e.body.passives().some((p) => 'attr' in p && p.attr === 'body' && p.label === '義臂')).toBe(true)
  })
})

describe('診所：報價與擋住的原因', () => {
  it('安裝的報價每個數字等於引擎的 installQuote', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const q = e.body.installQuote({ uid: 'U_ARM', via: 'clinic', side: 'l' })!
    expect(q.fee).toBeGreaterThan(0)
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'install', pick: 'U_ARM', via: 'clinic' }))
    const t = text(h)
    expect(t).toContain(q.fee.toLocaleString('en-US'))
    expect(h).toMatch(new RegExp(`data-row="沉溺成本"[^>]*>.*?<b[^>]*>\\+${q.sink}</b>`))
    // 休養與手術時間照引擎的分鐘數；每一行的字就是 installRows 給的
    for (const r of installRows(q, (id) => e.body.names.skill(id))) expect(t).toContain(r.value)
    expect(q.recovery_minutes).toBeGreaterThan(0)
  })

  it('黑診所的併發症機率有顯示', async () => {
    const { e, pinia } = start()
    await stand(e, 'F2')
    const q = e.body.installQuote({ uid: 'U_EYE', via: 'black' })!
    expect(q.complication).toBeGreaterThan(0)
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'install', pick: 'U_EYE' }))
    expect(h).toContain('data-surgeon="black"')
    expect(h).toMatch(/data-row="併發症"[^>]*>.*?<b[^>]*>[\d.]+%<\/b>/)
    expect(text(h)).toContain(`${Math.round(q.complication * 1000) / 10}%`)
  })

  it('自己動刀：DC 與成功率有顯示（成功率照引擎給的 DC 與加值）', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const surgeons = e.body.surgeons()
    expect(surgeons.map((s) => s.id)).toEqual(['clinic', 'self'])
    const q = e.body.installQuote({ uid: 'U_EYE', via: 'self' })!
    expect(q.fee).toBe(0)
    expect(q.self).toBeTruthy()
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'install', pick: 'U_EYE', via: 'self' }))
    expect(text(h)).toContain(`DC ${q.self!.dc}`)
    // 成功率是引擎的報價給的 chance（M4-fix-2 起自己動刀的報價帶 chance：0～1）；畫面照寫百分比，不自己擲骰算
    expect(q.self!.chance).toBeGreaterThan(0)
    expect(q.self!.chance).toBeLessThanOrEqual(1)
    expect(text(h)).toContain(`成功率 ${Math.round(q.self!.chance * 100)}%`)
    expect(chanceText({ chance: 0.85 })).toBe('・成功率 85%')
    expect(chanceText(q.self!)).toBe(`・成功率 ${Math.round(q.self!.chance * 100)}%`)
  })

  it('錢不夠時按鈕灰掉，原因和引擎逐字相同', async () => {
    const { e, pinia } = start({ money: 10 })
    await stand(e, 'F1')
    // 把錢花光：只剩幾塊
    const why = e.body.installBlock({ uid: 'U_ARM', via: 'clinic', side: 'l' })
    expect(why).toMatch(/錢不夠/)
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'install', pick: 'U_ARM', via: 'clinic' }))
    expect(h).toContain('aria-disabled="true"')
    expect(h).toMatch(/data-reason[^>]*>[^<]*錢不夠/)
    expect(text(h)).toContain(why!)
    // 按下去也只是被擋下：狀態不變
    expect(e.body.install({ uid: 'U_ARM', via: 'clinic', side: 'l' })).toBe(why)
    expect(e.body.cyber()!.parts.find((p) => p.id === 'arm_l')!.used).toBe(0)
  })

  it('不在診所開不了對話框：說原因、沒有分頁的內容', async () => {
    const { e, pinia } = start()
    await stand(e, 'plain')
    const gate = e.body.clinicGate()
    expect(gate).toBeTruthy()
    expect(e.body.clinic()).toBeNull()
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1 }))
    expect(h).toContain('data-gate')
    expect(text(h)).toContain(gate!)
    expect(h).not.toContain('data-tab=')
  })

  it('站在診所上開得了（clinicGate 是 null）', async () => {
    const { e } = start()
    await stand(e, 'F3')
    expect(e.body.clinicGate()).not.toBeNull()
    await stand(e, 'F1')
    expect(e.body.clinicGate()).toBeNull()
  })

  it('拆下：報價是引擎的 removeQuote，拆完收進背包', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    expect(e.body.install({ uid: 'U_EYE', via: 'clinic' })).toBeNull()
    const uid = e.body.cyber()!.parts.find((p) => p.id === 'eye')!.pieces[0]!.uid
    const rq = e.body.removeQuote({ uid, via: 'clinic' })!
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'remove', uid, via: 'clinic' }))
    expect(text(h)).toContain(rq.fee.toLocaleString('en-US'))
    const floor = e.body.cyber()!.sink_floor
    expect(e.body.remove({ uid, via: 'clinic' })).toBeNull()
    expect(e.body.cyber()!.sink_floor).toBeLessThan(floor)
    expect(e.body.cyber()!.parts.find((p) => p.id === 'eye')!.used).toBe(0)
  })

  it('授權鎖：有鎖的義體列在修理與解鎖，破解的報價有 DC 與成功率', async () => {
    const { e } = start()
    await stand(e, 'F1')
    expect(e.body.install({ uid: 'U_SUB', via: 'clinic' })).toBeNull()
    const lk = e.body.locks()
    expect(lk).toHaveLength(1)
    const q = e.body.crackQuote(lk[0]!.uid)!
    expect(q.dc).toBeGreaterThan(0)
    // 破解的報價帶 chance（M4-fix-2）
    expect(q.chance).toBeGreaterThan(0)
    expect(chanceText(q)).toBe(`・成功率 ${Math.round(q.chance * 100)}%`)
  })
})

describe('橋', () => {
  it('四類容量等於引擎的衍生數值，畫面寫它的組成', async () => {
    const { e, pinia } = start()
    const cap = e.body.capacity()!
    const sk = e.skills.capacity()
    for (const c of ['meat', 'net', 'social', 'media'] as const) expect(cap.split[c]).toBe(sk[c].max)
    expect(cap.chip).toBe(52)
    const h = clean(await render(pinia, BridgeTab))
    expect(text(h)).toContain('通用橋')
    for (const c of ['meat', 'net', 'social', 'media'] as const) expect(h).toMatch(new RegExp(`data-cap="${c}"[^>]*>.*?data-cap-total[^>]*>${cap.split[c]}<`))
    expect(h).toContain('data-bridge-params')
    for (const p of e.body.bridgeParams()!) expect(h).toMatch(new RegExp(`data-param="${p.id}"[^>]*>.*?data-param-value[^>]*>${p.value}<`))
  })

  it('換橋的報價是兩倍：實收是安裝費乘引擎的倍數，兩座橋的容量前後都列出來', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    const q = e.body.bridgeQuote({ uid: 'U_BR2', via: 'clinic', keep: true })!
    expect(q.replaces?.name).toBe('通用橋')
    expect(q.fee).toBe(q.install_fee * 2)
    expect(q.before.split.net).toBe(13)
    expect(q.after.split.net).toBeGreaterThan(q.before.split.net)
    // 沒有橋的人第一座不加倍
    const none = start({ bridge: false })
    await stand(none.e, 'F1')
    const q0 = none.e.body.bridgeQuote({ uid: 'U_BR2', via: 'clinic' })!
    expect(q0.replaces).toBeNull()
    expect(q0.fee).toBe(q0.install_fee)
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'install', pick: 'U_BR2', via: 'clinic' }))
    expect(text(h)).toContain(q.fee.toLocaleString('en-US'))
    expect(h).toContain('data-keep')
  })

  it('換橋之後型號與容量換成新的橋', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    expect(e.body.swapBridge({ uid: 'U_BR2', via: 'clinic', keep: false })).toBeNull()
    expect(e.body.bridge()!.name).toBe('潛網者橋')
    expect(e.body.capacity()!.chip).toBe(64)
    const h = clean(await render(pinia, BridgeTab))
    expect(text(h)).toContain('潛網者橋')
  })

  it('沒有橋的人：不列容量，只寫一句', async () => {
    const { e, pinia } = start({ bridge: false })
    expect(e.body.bridge()).toBeNull()
    const h = clean(await render(pinia, BridgeTab))
    expect(h).toContain('data-no-bridge')
  })
})

describe('藥與成癮', () => {
  it('吃一劑之後列表多一筆，時間到了消失；成癮到依賴有標示', async () => {
    const { e, pinia } = start()
    expect(e.body.drugs()!.active).toHaveLength(0)
    expect(e.body.drugs()!.usable.map((u) => u.item)).toContain('it_focus')
    expect(e.body.useDrug('it_focus')).toBeNull()
    const v = e.body.drugs()!
    expect(v.active).toHaveLength(1)
    expect(v.active[0]!.left).toBe(240)
    let h = clean(await render(pinia, BodyTab))
    expect(h).toContain('data-active="it_focus"')
    expect(text(h)).toContain('剩 4 小時')
    expect(v.addiction[0]!.value).toBe(25)
    expect(v.addiction[0]!.stage).toBe('none')
    // 再吃一劑：成癮 50，到了依賴
    expect(e.body.useDrug('it_focus')).toBeNull()
    expect(e.body.drugs()!.addiction[0]!.stage).toBe('dependent')
    h = clean(await render(pinia, BodyTab))
    expect(h).toContain('data-stage="dependent"')
    // 藥效的時間過去之後就沒了
    const t0 = minutes(e)
    expect(e.commit({ summary: '過了', changes: [{ op: 'time', minutes: 241 }] as never })).toBeNull()
    expect(minutes(e) - t0).toBe(241)
    expect(e.body.drugs()!.active).toHaveLength(0)
    h = clean(await render(pinia, BodyTab))
    expect(h).not.toContain('data-active="it_focus"')
  })

  it('抑制劑的開關：開了之後帳單有一行，狀態是引擎的', () => {
    const { e } = start()
    expect(e.body.drugs()!.suppressant.weekly).toBe(false)
    expect(e.body.suppressantBlock(true)).toBeNull()
    expect(e.body.suppressant(true)).toBeNull()
    expect(e.body.drugs()!.suppressant.weekly).toBe(true)
    expect(e.body.suppressant(false)).toBeNull()
    expect(e.body.drugs()!.suppressant.weekly).toBe(false)
  })

  it('戒斷的分頁：成癮的藥列出來，報價與原因是引擎的', async () => {
    const { e, pinia } = start()
    await stand(e, 'F1')
    expect(e.body.useDrug('it_focus')).toBeNull()
    const a = e.body.drugs()!.addiction[0]!
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'detox' }))
    expect(h).toContain(`data-detox="${a.id}"`)
    if (a.detox.quote) expect(text(h)).toContain(String(a.detox.quote.after))
    if (a.detox.block) expect(text(h)).toContain(a.detox.block)
  })
})

describe('治療與痛覺編輯器', () => {
  it('急救與診所治療的報價是引擎的 medicalView；診所上才有診所治療', async () => {
    const { e, pinia, pc } = start()
    const v = e.body.medical()!
    expect(v.members.map((m) => m.id)).toContain(pc)
    expect(v.members[0]!.aid.quote?.dc).toBeGreaterThan(0)
    await stand(e, 'F1')
    expect(e.body.medical()!.clinic?.grade).toBe('clinic')
    const h = clean(await render(pinia, ClinicDialog, { entryId: 1, tab: 'care' }))
    expect(h).toContain('data-medical-panel')
    expect(h).toContain(`data-member="${pc}"`)
    expect(h).toContain('data-sink-panel')
  })

  it('心理治療在提供的設施上才有報價；不在原因是引擎的', async () => {
    const { e } = start()
    expect(e.body.therapyHere()).toBeNull()
    await stand(e, 'F1')
    expect(e.body.therapyHere()?.kind).toBe('counsel')
    const q = e.body.therapyQuote({})
    expect(q?.amount).toBeGreaterThan(0)
  })

  it('斷線靜修是進行中的活動：進去之後多「待下去」與「提早離開」，數字與原因是引擎的；提早離開不結算', async () => {
    const { e, pinia } = start()
    expect(e.body.retreat()).toBeNull()
    expect(clean(await render(pinia, RetreatPanel))).not.toContain('data-retreat-panel')
    await stand(e, 'F3')
    expect(e.body.therapyHere()?.kind).toBe('retreat')
    expect(e.commit({ summary: '沉溺上來了', action: 'ui.test_sink', changes: [{ op: 'actor.track', id: e.pc!.id, track: 'sink', delta: 30 }] as never })).toBeNull()
    const sink0 = e.body.sink()!.value
    expect(e.body.therapy({ kind: 'retreat' })).toBeNull()
    const v = e.body.retreat()!
    expect(v.facility).toBe('傳教所')
    expect(v.days_left).toBeGreaterThan(0)
    // 進行中：面板在，兩個按鈕都亮；潛入被引擎擋（活動 retreat）
    const h = clean(await render(pinia, RetreatPanel))
    expect(h).toContain('data-retreat-panel')
    expect(h).toContain('data-act="retreat-stay"')
    expect(h).toContain('data-act="retreat-leave"')
    // 橋關著（引擎的 bridgeClosed）：面板提一句技能不算數、容量 0
    expect(e.body.bridgeClosed()).toBe(true)
    expect(h).toContain('data-bridge-closed')
    expect(text(h)).toContain(`${v.days_left} 天`)
    expect(e.body.stayBlock()).toBeNull()
    expect(e.body.leaveBlock()).toBeNull()
    expect(e.blockOf('commit:netrun.start')).toBeTruthy()
    // 待下去：過一天，天數少一
    expect(e.body.stay()).toBeNull()
    expect(e.body.retreat()!.days_left).toBe(v.days_left - 1)
    // 提早離開：記號拿掉、沉溺沒降
    expect(e.body.leave()).toBeNull()
    expect(e.body.retreat()).toBeNull()
    expect(e.body.bridgeClosed()).toBe(false)
    expect(e.body.sink()!.value).toBe(sink0)
    expect(e.body.stayBlock()).toBeTruthy()
  })

  it('斷線靜修待到最後一天：引擎自己結算，沉溺往下降、記號拿掉', async () => {
    const { e } = start()
    await stand(e, 'F3')
    expect(e.commit({ summary: '沉溺上來了', action: 'ui.test_sink', changes: [{ op: 'actor.track', id: e.pc!.id, track: 'sink', delta: 30 }] as never })).toBeNull()
    expect(e.body.therapy({ kind: 'retreat' })).toBeNull()
    const v = e.body.retreat()!
    for (let i = 0; i < v.days_left + 2 && e.body.retreat(); i++) expect(e.body.stay()).toBeNull()
    expect(e.body.retreat()).toBeNull()
    expect(e.state.reports.some((r) => r.action === 'sink.retreat' && (r.outcome as { result?: string }).result === 'done')).toBe(true)
  })

  it('痛覺編輯器：生命值只剩模糊的分段，沒有數字', async () => {
    const { e, pinia } = start()
    expect(e.body.painBlind()).toBe(false)
    await stand(e, 'F1')
    expect(e.body.install({ uid: 'U_PAIN', via: 'clinic' })).toBeNull()
    expect(e.body.painBlind()).toBe(true)
    const m = e.body.medical()!.members[0]!
    const h = clean(await render(pinia, HpBar, { hp: m.hp, max: m.max_hp, blur: true }))
    expect(h).toContain('data-hp-blur')
    expect(h).not.toContain(String(m.hp))
    expect(hpBlur(m.hp, m.max_hp).filled).toBeGreaterThan(0)
    // 狀態列的小隊也一樣：引擎說是痛覺編輯器，那一列就沒有數字的量條
    const row = e.partyRows().find((r) => r.me)!
    expect(row.hpBlur).toBe(true)
    const hr = clean(await render(pinia, PartyRow, { m: row }))
    expect(hr).toContain('data-hp-blur')
    expect(hr).not.toContain('生命 ')
    const hb = clean(await render(pinia, HpBar, { hp: m.hp, max: m.max_hp }))
    expect(hb).not.toContain('data-hp-blur')
  })
})

describe('示意世界包開新局', () => {
  it('主角有橋、甲板在腦部、進得了內海', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    expect(e.newGame({ seed: 7, draft: DRAFT as never })).toEqual([])
    const v = e.body.cyber()!
    expect(v.bridge).toBe(true)
    const brain = v.parts.find((p) => p.id === 'brain')!
    expect(brain.pieces[0]!.uid).toBe(DEMO_DECK_UID)
    expect(brain.pieces[0]!.deck).toBe(true)
    expect(e.deck.view()!.deck.has).toBe(true)
    // 容量與橋參數來自引擎；下限就是身上義體成本的合計
    const cap = e.body.capacity()!
    expect(cap.split.net).toBeGreaterThan(0)
    expect(e.body.bridge()!.name).toContain('橋')
    expect(e.body.sink()!.floor).toBe(v.parts.flatMap((p) => p.pieces).reduce((n, p) => n + (p?.sink ?? 0), 0))
    expect(e.state.actors[e.pc!.id]!.sink).toBeGreaterThanOrEqual(e.body.sink()!.floor)
    // 潛入被擋的原因裡沒有「沒有橋」「沒有甲板」
    expect(e.dive.options().blocks.filter((b) => /橋|甲板/.test(b))).toEqual([])
    // 背包裡有義體可以裝、有藥可以吃
    expect(e.body.bag().length).toBeGreaterThan(3)
    expect(e.body.drugs()!.usable.length).toBeGreaterThan(0)
  })

  it('診所三種的設施種類載進來了：站在診所上才開得了，三種各是引擎的那一種', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    expect(e.newGame({ seed: 7, draft: DRAFT as never })).toEqual([])
    expect(e.body.clinicGate()).not.toBeNull()
    const block = blockIdOf('ave42', '刀巷')
    const grades: Record<string, string> = { qinghe: 'clinic', backalley: 'black' }
    for (const [fac, grade] of Object.entries(grades)) {
      const r = await e.world.arrive(block, markerOfFacility(block, fac)!)
      expect(r.status).toBe('applied')
      expect(e.body.clinic()?.grade).toBe(grade)
      expect(e.body.clinicGate()).toBeNull()
      expect(e.body.surgeons().map((s) => s.id)).toContain(grade)
    }
    // 縫縫診所（四號塔的地下室）是無照的
    const tower = blockIdOf('hive', '四號塔')
    const r = await e.world.arrive(tower, markerOfFacility(tower, 'clinic')!)
    expect(r.status).toBe('applied')
    expect(e.body.clinic()?.grade).toBe('unlicensed')
  })

  it('開局的義體與藥：背包裡的義體引擎裝得上（義臂在正規診所，報價與下限和引擎一致）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    expect(e.newGame({ seed: 7, draft: DRAFT as never })).toEqual([])
    const block = blockIdOf('ave42', '刀巷')
    await e.world.arrive(block, markerOfFacility(block, 'qinghe')!)
    e.ledger([{ op: 'cred', delta: 50000 }] as never)
    const arm = e.body.bag().find((b) => b.uid === 'U_ARM')!
    const q = e.body.installQuote({ uid: arm.uid, via: 'clinic', side: 'l' })!
    expect(q.fee).toBeGreaterThan(0)
    const floor = e.body.sink()!.floor
    expect(e.body.install({ uid: arm.uid, via: 'clinic', side: 'l' })).toBeNull()
    expect(e.body.sink()!.floor).toBe(floor + q.sink)
    // 訂閱的義眼帶著授權鎖
    expect(e.body.install({ uid: 'U_EYESUB', via: 'clinic' })).toBeNull()
    expect(e.body.locks().map((l) => l.kind)).toContain('subscription')
  })
})

describe('原始碼的檢查', () => {
  const all = import.meta.glob(['../../src/**/*.vue', '../../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const files = Object.entries(all).filter(([f]) => !/\.test\.ts$/.test(f))
  it('ui/src 沒有 lib/clinic，也沒有手術費一成的算式', () => {
    expect(files.length).toBeGreaterThan(50)
    for (const [f, s] of files) {
      expect(s, f).not.toMatch(/lib\/clinic['"]/)
      expect(s, f).not.toMatch(/from ['"]\.\/clinic['"]/)
      expect(s, f).not.toMatch(/price\s*\*\s*0\.(1|05)\b/)
    }
  })
  it('身體的元件不寫規則：沒有自己算費用、成本、機率的算式', () => {
    const mine = files.filter(([f]) => /components\/body\/|dialogs\/(ClinicDialog|character\/(BodyTab|BridgeTab))/.test(f))
    expect(mine.length).toBeGreaterThanOrEqual(7)
    for (const [f, s] of mine) {
      expect(s, f).not.toMatch(/Math\.random/)
      expect(s, f).not.toMatch(/\.(fee|sink|price|complication)\s*\*\s*[\d(]|[\d)]\s*\*\s*\w+\.(fee|sink|price|complication)\b/)
    }
  })
})
