// 驗收測試：dev/work/M2-ui-people.md（cpp-ui）。這裡的人、說話與互動、關係、名冊與招募、人情、換配置接上引擎。
// 內容用測試自帶的最小假資料（一個區兩塊街區、兩個固定 NPC 加一位中間人與兩位行者、一個區的生成規則、兩樣東西、一處住處），不用示意世界包；
// 畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查；數字拿另一個獨立的引擎（讀同一份存檔）直接呼叫引擎函式來比。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature } from '@engine/src'
import { FakeProvider, Game, meterOf } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { CHAT_DONE_NOTE, affinityStage, interactions, npcsHere, recall } from '@engine/src/features/npcs'
import { recruitBlock, recruitDc, rosterView } from '@engine/src/features/roster'
import { favorsOf } from '@engine/src/features/favors'
import { useEngine } from '../../src/stores/engine'
import talkSrc from '../../src/dialogs/TalkDialog.vue?raw'
import relationsSrc from '../../src/dialogs/RelationsDialog.vue?raw'
import rosterSrc from '../../src/dialogs/RosterDialog.vue?raw'
import bridgeSrc from '../../src/dialogs/character/BridgeTab.vue?raw'
import mainSrc from '../../src/screens/MainScreen.vue?raw'
import viewSrc from '../../src/lib/peopleView.ts?raw'
import TalkDialog from '../../src/dialogs/TalkDialog.vue'
import RelationsDialog from '../../src/dialogs/RelationsDialog.vue'
import RosterDialog from '../../src/dialogs/RosterDialog.vue'
import BridgeTab from '../../src/dialogs/character/BridgeTab.vue'
import { favorTotals, knownRows, personRows, filterPersons, recruitIds } from '../../src/lib/peopleView'
import { demoPack, demoStartFeature } from '../../src/data/demo'

// ---- 假資料 ----

type Fx = Record<string, unknown>
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }]
const mapOf = (id: string, cells: Fx[]) => ({
  id, kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'],
    cells: [...cells, ...E], spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
})
const MAPS = [
  mapOf('m_t', [{ id: 'F1', at: [1, 1], mark: 'F', name: '雜貨店' }, { id: 'F2', at: [3, 1], mark: 'F', name: '麵攤' }, { id: 'F3', at: [5, 1], mark: 'F', name: '出租屋' }]),
  mapOf('m_u', [{ id: 'F1', at: [1, 1], mark: 'F', name: '空地' }, { id: 'F2', at: [3, 1], mark: 'F', name: '空地二' }, { id: 'F3', at: [5, 1], mark: 'F', name: '空地三' }]),
]
const WORLD = {
  special_map: MAPS, facility_type: [{ id: 'fac_shop', name: '商店' }, { id: 'fac_work', name: '打工' }, { id: 'fac_home', name: '住處' }],
  district: [{ id: 'd_t', name: '測試區', grade: 1, price_mult: 1, blocks: ['b_t', 'b_u'] }],
  block: [{
    id: 'b_t', district: 'd_t', name: '測試街', kind: 'block', map: 'm_t', exits: { E2: { to: 'b_u', arrive: 'E1' } },
    facilities: { F1: { type: 'fac_shop', name: '雜貨店' }, F2: { type: 'fac_work', name: '麵攤' }, F3: { type: 'fac_home', name: '出租屋' } },
  }, { id: 'b_u', district: 'd_t', name: '空街', kind: 'block', map: 'm_u', exits: { E1: { to: 'b_t', arrive: 'E2' } }, facilities: { F1: { type: 'fac_shop', name: '空地' }, F2: { type: 'fac_shop', name: '空地二' }, F3: { type: 'fac_shop', name: '空地三' } } }],
}
const DAY = ['morning', 'noon', 'afternoon']
const NIGHT = ['prime', 'late']
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']
const street = (time: string[]) => [{ district: 'd_t', block: 'b_t', time }]
const bridge = { sensitivity: 40, tolerance: 30, craving: 20, docility: 10 }
const npc = (id: string, name: string, more: Fx) => ({ id, name, kind: 'citizen', age: 30, guard: 12, wealth: 2, haunts: street(ALL), ...more })
const runner = (id: string, name: string, tier: number) => npc(id, name, {
  kind: 'runner', bridge, paths: [{ path: 'gunner', slot: 'main', tier }], tendencies: { axes: { relation: 1, sense: 0, body: 0, costume: 0 }, tags: { tg_dom: 'has' } },
})
const PACK: ContentPack = {
  id: 'people_ui_test',
  content: {
    ...WORLD,
    item: [
      { id: 't_bun', name: '糰糧', desc: '糰糧。', category: 'consumable', grade: 1, size: 0, legal: 'free', price: 70, tags: [] },
      { id: 't_deck', name: '甲板', desc: '一台甲板。', category: 'tool', grade: 2, size: 0, legal: 'free', price: 900, tags: ['deck'] },
    ],
    tendency_tag: [{ id: 'tg_dom', name: '主導', axis: 'relation' }],
    name_pool: [{ id: 'np_t', family: ['陸', '周', '王', '李'], given: ['守仁', '曉雯', '志明', '小芬'] }],
    npc_gen: [{ id: 'ng_t', district: 'd_t', citizens: 8, runners: 4, occupations: [['攤販', 1]], factions: [['none', 1]], names: ['np_t'], haunts: street(ALL) }],
    npc: [
      npc('npc_day', '日班阿志', { haunts: street(DAY) }),
      npc('npc_night', '夜班小夜', { haunts: street(NIGHT) }),
      npc('npc_mid', '中間人老蓮', { flags: ['fixer'], wealth: 3 }),
      runner('npc_run', '行者安', 3), runner('npc_run2', '行者鮑', 2), runner('npc_run3', '行者柯', 2),
    ],
    residence: [{ id: 'res_t', name: '出租屋', district: 'd_t', block: 'b_t', facility: 'F3', level: 1, rent: 100, cash_ok: true }],
    roster_rule: [{ id: 'default', cap_base: 0 }],
  } as unknown as ContentPack['content'],
}
const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
const BUSY_REASON = '測試的活動進行中，這件事現在不能做。'
const busy: Feature = {
  id: 'busy_test',
  install: (k) => k.activity.define({ kind: 'busy_test', owner: 'busy_test', order: 5, active: (s) => (s.ext.busy_test ? { id: 'b1', label: '測試活動' } : null), allow: [], reason: () => BUSY_REASON }),
}

type Eng = ReturnType<typeof useEngine>
/** 一局：建好角色、放進兩樣東西、站在測試街的街上（不在設施裡）；hour 是一天裡的幾點 */
async function setup(o: { seed?: number; hour?: number; at?: string; bare?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK], testFeatures: [busy] })
  e.setAi({ useAi: false })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '放進背包。', changes: [{ op: 'item', id: 't_bun', qty: 2 }, { op: 'item', id: 't_deck', qty: 1 }] })).toBeNull()
  e.ledger([{ op: 'cred', delta: 5000 - e.money.cred }, { op: 'cash', delta: 3000 - e.money.cash }])
  // 建角時出身的名冊（小麥、雷）會自己進名冊；bare 是把他們拿出去，剩下空的名冊（測招募與名冊滿用）
  if (o.bare) for (const id of e.people.roster().members.map((m) => (m as { id: string }).id)) expect((await e.people.removeMember(id)).status).toBe('applied')
  const r = await e.world.arrive('b_t', o.at)
  expect(r.status).toBe('applied')
  if (o.hour !== undefined) toHour(e, o.hour)
  return { pinia, e }
}
/** 把時間推到今天（或明天）的幾點整 */
function toHour(e: Eng, hour: number): void {
  const cur = e.state.time.hour * 60 + e.state.time.minute
  const delta = (hour * 60 - cur + 1440) % 1440
  if (delta > 0) expect(e.ledger([{ op: 'time', minutes: delta }])).toBeNull()
}
/** 另一個獨立的引擎讀同一份存檔 */
function oracle(e: Eng): Game {
  const g = new Game({ features: [...allFeatures(), busy], content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  return renderToString(app)
}
const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
const minutesOf = (e: Eng) => (e.state.time.day - 1) * 1440 + e.state.time.hour * 60 + e.state.time.minute
const countOf = (e: Eng, id: string) => e.gear.inventory().filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
const ids = (list: Array<{ id: string }>) => list.map((n) => n.id).sort()
/** 同一個種子換不同的種子重來，直到 pred 成立（擲骰的結果由引擎照種子決定；每一局從頭開，所以彼此獨立） */
async function untilOk<T>(tries: number, run: (seed: number) => Promise<T | null>): Promise<T> {
  for (let seed = 1; seed <= tries; seed++) {
    const r = await run(seed)
    if (r !== null) return r
  }
  throw new Error(`換了 ${tries} 個種子都沒有出現要的結果`)
}

beforeEach(() => setActivePinia(createPinia()))

// ---- 這裡的人 ----

describe('這裡的人（引擎的 npcsHere）', () => {
  it('走進一區之後「這裡的人」和引擎的 npcsHere 一樣；沒有生成之前不在名單上的人不會出現', async () => {
    const { e } = await setup({ hour: 10 })
    const g = oracle(e)
    const mine = ids(e.people.here())
    expect(mine).toEqual(ids(npcsHere(g.k, g.state)))
    expect(mine).toContain('npc_day')
    expect(mine).toContain('npc_run')
    // 生成規則（8 位街坊、4 位行者）：固定 NPC 六位佔名額，其餘六位是生成的，也在名單上
    expect(mine.filter((id) => id.startsWith('gen_'))).toHaveLength(6)
  })

  it('晚上才在的人白天不在，天黑之後才出現；白天才在的人相反', async () => {
    const { e } = await setup({ hour: 10 })
    expect(ids(e.people.here())).toContain('npc_day')
    expect(ids(e.people.here())).not.toContain('npc_night')
    toHour(e, 21)
    expect(ids(e.people.here())).toContain('npc_night')
    expect(ids(e.people.here())).not.toContain('npc_day')
  })
})

// ---- 說話與互動 ----

describe('對話畫面與互動選單（引擎的 interactions）', () => {
  it('每一種互動的 DC、成功率、不能做的原因和引擎一樣；威嚇中間人是灰的並有引擎的原因', async () => {
    const { e, pinia } = await setup({ hour: 10 })
    const g = oracle(e)
    const mine = e.people.interactions('npc_mid')
    expect(mine).toEqual(interactions(g.k, g.state, 'npc_mid'))
    const intimidate = mine.find((r) => r.kind === 'npc_intimidate')!
    expect(intimidate.ok).toBe(false)
    expect(intimidate.reason).toContain('中間人')
    const text = strip(await html(pinia, TalkDialog, { npcId: 'npc_mid' }))
    expect(text).toContain(intimidate.reason!)
    expect(text).toContain(`DC ${mine.find((r) => r.kind === 'npc_chat')!.dc}`)
    // 灰掉的按鈕不設 disabled：點了說原因（aria-disabled）
    const dom = await html(pinia, TalkDialog, { npcId: 'npc_mid' })
    expect(dom).toMatch(/data-do="npc_intimidate"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-do="npc_intimidate"/)
    // 先擋住：還沒有開放的幾項灰掉並寫「還沒有開放。」
    expect(text).toContain('還沒有開放。')
    for (const name of ['關係線', '傳訊息', '邀約', '採訪', '請教']) expect(text).toContain(name)
  })

  it('聊天成功之後親密度的數字與階段跟著變；同一天第二次聊天畫面提示不再加親密度，第二次的親密度不變', async () => {
    const out = await untilOk(40, async (seed) => {
      const { e, pinia } = await setup({ seed, hour: 10 })
      expect((await e.people.meet('npc_day')).status).toBe('applied')
      const before = e.people.affinity('npc_day')
      expect((await e.people.interact('npc_chat', 'npc_day')).status).toBe('applied')
      const after = e.people.affinity('npc_day')
      return after > before ? { e, pinia, before, after } : null
    })
    const { e, pinia, before, after } = out
    expect(after).toBeGreaterThan(before)
    // 階段是引擎的：和另一個引擎讀同一份存檔算的一樣
    const g = oracle(e)
    expect(e.people.stage('npc_day')).toEqual(affinityStage(meterOf(g.k, g.state, 'affinity', 'npc_day')))
    expect(strip(await html(pinia, TalkDialog, { npcId: 'npc_day' }))).toContain(`${after}${e.people.stage('npc_day').name}`)
    // 第二次聊天：照樣能聊，但不再加親密度；畫面有提示
    expect(e.people.interactions('npc_day').find((r) => r.kind === 'npc_chat')!.note).toBe(CHAT_DONE_NOTE)
    expect(strip(await html(pinia, TalkDialog, { npcId: 'npc_day' }))).toContain('不會再加親密度')
    const second = await e.people.interact('npc_chat', 'npc_day')
    expect(second.status).toBe('applied')
    expect(e.people.affinity('npc_day')).toBeLessThanOrEqual(after)
  })

  it('送禮選背包裡的東西：收下之後背包少一件（引擎的 npc_gift）；今天不能再送', async () => {
    const out = await untilOk(40, async (seed) => {
      const { e, pinia } = await setup({ seed, hour: 10 })
      await e.people.meet('npc_day')
      const row = e.people.interactions('npc_day').find((r) => r.kind === 'npc_gift')!
      expect(row.needs).toBe('item')
      expect(countOf(e, 't_bun')).toBe(2)
      const r = await e.people.interact('npc_gift', 'npc_day', { item: 't_bun' })
      expect(r.status).toBe('applied')
      return countOf(e, 't_bun') === 1 ? { e, pinia } : null
    })
    expect(countOf(out.e, 't_bun')).toBe(1)
    const again = out.e.people.interactions('npc_day').find((r) => r.kind === 'npc_gift')!
    expect(again.ok).toBe(false)
    expect(again.reason).toContain('今天')
    const refused = await out.e.people.interact('npc_gift', 'npc_day', { item: 't_bun' })
    expect(refused.status).toBe('refused')
  })

  it('已知的事：讀橋成功之後那一格從問號變成內容；沒有甲板時引擎擋下', async () => {
    const out = await untilOk(60, async (seed) => {
      const { e, pinia } = await setup({ seed, hour: 10 })
      await e.people.meet('npc_run')
      const before = strip(await html(pinia, TalkDialog, { npcId: 'npc_run' }))
      expect(before).toContain('？？？')
      expect(e.people.interactions('npc_run').find((r) => r.kind === 'npc_read_bridge')!.ok).toBe(true)
      await e.people.interact('npc_read_bridge', 'npc_run', { category: 'tendency' })
      return (e.people.rel('npc_run')?.known ?? []).some((f) => f.startsWith('tendency:')) ? { e, pinia } : null
    })
    const html2 = strip(await html(out.pinia, TalkDialog, { npcId: 'npc_run' }))
    expect(html2).toContain('主導')
    // 傾向那一格不再是問號
    const rows = knownRows(out.e.people.npc('npc_run')!, out.e.people.rel('npc_run')!.known, out.e.people.look)
    expect(rows.find((r) => r.key === 'tendency')).toMatchObject({ unknown: false, value: '主導' })
    expect(rows.find((r) => r.key === 'bridge')!.unknown).toBe(true)
  })

  it('沒有甲板：讀橋灰掉，原因是引擎的', async () => {
    const { e } = await setup({ hour: 10 })
    await e.people.meet('npc_run')
    expect(e.commit({ summary: '賣掉甲板。', changes: [{ op: 'item', id: 't_deck', qty: -1 }] })).toBeNull()
    const row = e.people.interactions('npc_run').find((r) => r.kind === 'npc_read_bridge')!
    expect(row.ok).toBe(false)
    expect(row.reason).toContain('甲板')
  })

  it('共同記憶是引擎的 recall；互動紀錄只列這個人的', async () => {
    const { e, pinia } = await setup({ hour: 10 })
    await e.people.meet('npc_day')
    await e.people.interact('npc_chat', 'npc_day')
    const g = oracle(e)
    expect(e.people.recall('npc_day')).toEqual(recall(g.k, g.state, { who: 'npc_day', where: { district: 'd_t', block: 'b_t' } }))
    expect(e.people.talkLog('npc_day').length).toBeGreaterThan(0)
    expect(e.people.talkLog('npc_night')).toEqual([])
    expect(strip(await html(pinia, TalkDialog, { npcId: 'npc_day' }))).toContain('共同記憶')
  })
})

// ---- 關係 ----

describe('關係（名單、關注、記憶的改寫、釘選、刪除）', () => {
  it('名單照引擎的親密度排；關注的開關是引擎的 watchNpc；記憶可以改寫、釘選、刪除', async () => {
    const { e, pinia } = await setup({ hour: 10 })
    await e.people.meet('npc_day')
    await e.people.meet('npc_run')
    e.ledger([{ op: 'meter', kind: 'affinity', key: 'npc_run', set: 45 } as never])
    expect(e.people.affinity('npc_run')).toBe(45)
    const rows = personRows(e.people.known(), (id) => ({ npc: e.people.npc(id)!, affinity: e.people.affinity(id), stageName: e.people.stage(id).name, rel: e.people.rel(id), loyalty: e.people.loyalty(id), member: false }), e.people.favors(), e.people.look)
    expect(rows[0]!.id).toBe('npc_run')
    expect(rows[0]!.stageName).toBe(e.people.stage('npc_run').name)
    expect(filterPersons(rows, '關注')).toEqual([])
    expect((await e.people.watch('npc_day', true)).status).toBe('applied')
    expect(filterPersons(personRows(e.people.known(), (id) => ({ npc: e.people.npc(id)!, affinity: e.people.affinity(id), stageName: '', rel: e.people.rel(id), loyalty: null, member: false }), e.people.favors(), e.people.look), '關注').map((r) => r.id)).toEqual(['npc_day'])
    // 記憶：手動記一筆再改寫、釘選、刪除
    expect(e.commit({ summary: '記一筆。', changes: [{ op: 'npcs.memory.add', where: { district: 'd_t' }, who: ['npc_day'], text: '一起吃了麵。', weight: 2 } as never] })).toBeNull()
    const m = e.people.memoriesOf('npc_day').find((x) => x.text === '一起吃了麵。')!
    expect(m).toBeTruthy()
    expect((await e.people.editMemory(m.id, { text: '一起吃了兩碗麵。' })).status).toBe('applied')
    expect((await e.people.editMemory(m.id, { pinned: true })).status).toBe('applied')
    expect(e.people.memoriesOf('npc_day').find((x) => x.id === m.id)).toMatchObject({ text: '一起吃了兩碗麵。', pinned: true })
    const dom = strip(await html(pinia, RelationsDialog, { npcId: 'npc_day' }))
    expect(dom).toContain('一起吃了兩碗麵。')
    expect(dom).toContain('已釘選')
    expect((await e.people.forgetMemory(m.id)).status).toBe('applied')
    expect(e.people.memoriesOf('npc_day').find((x) => x.id === m.id)).toBeUndefined()
  })
})

// ---- 名冊與招募 ----

describe('名冊與招募（引擎的 roster）', () => {
  it('招募：DC、成功率、原因是引擎的；成功之後名冊多一個人、容量的數字對', async () => {
    const out = await untilOk(60, async (seed) => {
      const { e, pinia } = await setup({ seed, hour: 10, bare: true })
      await e.people.meet('npc_run')
      const g = oracle(e)
      const info = e.people.recruitInfo('npc_run')
      expect(info.block).toBe(recruitBlock(g.k, g.state, 'npc_run'))
      expect(info.dc).toBe(recruitDc(g.k, g.state, 'npc_run').dc)
      expect(info.chance).not.toBeNull()
      const before = e.people.roster().size
      expect((await e.people.recruit('npc_run')).status).toBe('applied')
      return e.people.roster().size === before + 1 ? { e, pinia, before } : null
    })
    const { e, pinia } = out
    const g = oracle(e)
    expect(e.people.roster()).toEqual(rosterView(g.k, g.state))
    expect(e.people.roster().size).toBe(out.before + 1)
    const text = strip(await html(pinia, RosterDialog))
    expect(text).toContain('行者安')
    expect(text).toContain(`${e.people.roster().size}／${e.people.roster().cap}`)
  })

  it('名冊滿了：招募按鈕是灰的，原因是引擎的；把人拿出名冊之後空出位子', async () => {
    const { e, pinia } = await setup({ hour: 10, bare: true })
    for (const id of ['npc_run', 'npc_run2', 'npc_run3']) await e.people.meet(id)
    const cap = e.people.roster().cap
    expect(cap).toBe(2)
    for (const id of ['npc_run', 'npc_run2']) expect(e.commit({ summary: '進名冊', changes: [{ op: 'roster.join', who: id, since: e.state.time, reliability: 50, pay: 'fee' } as never] })).toBeNull()
    expect(e.people.roster().size).toBe(cap)
    const g = oracle(e)
    const info = e.people.recruitInfo('npc_run3')
    expect(info.block).toBe(recruitBlock(g.k, g.state, 'npc_run3'))
    expect(info.block).toContain('名冊滿了')
    const dom = await html(pinia, RosterDialog)
    expect(strip(dom)).toContain(info.block!)
    expect(dom).toMatch(/data-recruit-go="npc_run3"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-recruit-go="npc_run3"/)
    const refused = await e.people.recruit('npc_run3')
    expect(refused.status).toBe('refused')
    expect((await e.people.removeMember('npc_run')).status).toBe('applied')
    expect(e.people.roster().size).toBe(cap - 1)
    expect(e.people.recruitInfo('npc_run3').block).toBeNull()
  })

  it('成員的出場費、忠誠、有空沒有都是引擎的；沒空的寫出原因', async () => {
    const { e, pinia } = await setup({ hour: 10, bare: true })
    await e.people.meet('npc_run')
    expect(e.commit({ summary: '進名冊', changes: [{ op: 'roster.join', who: 'npc_run', since: e.state.time, reliability: 50, pay: 'fee' } as never, { op: 'meter', kind: 'loyalty', key: 'npc_run', set: 60 } as never] })).toBeNull()
    expect(e.commit({ summary: '受傷', changes: [{ op: 'actor.condition', id: 'npc_run', condition: 'injured' } as never] })).toBeNull()
    const g = oracle(e)
    const row = rosterView(g.k, g.state).members[0]!
    const text = strip(await html(pinia, RosterDialog))
    expect(row.busy.length).toBeGreaterThan(0)
    expect(text).toContain(row.busy[0]!)
    expect(text).toContain(String(row.fee).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
  })

  it('recruitIds：候選人在前、再來是認識的行者；已在名冊上的不列', () => {
    expect(recruitIds([{ who: 'a', at: { day: 1, hour: 0, minute: 0 } }], ['b', 'c', 'a'], ['c'], (id) => id !== 'x')).toEqual(['a', 'b'])
  })
})

// ---- 人情 ----

describe('人情（引擎的 favors）', () => {
  it('事件給了一個小人情之後錢包旁多一筆；用掉之後少一筆；你欠的分開記，被討時答應或回絕', async () => {
    const { e, pinia } = await setup({ hour: 10 })
    await e.people.meet('npc_day')
    expect(favorTotals(e.people.favors())).toEqual({ owedToYou: 0, youOwe: 0 })
    expect(e.commit({ summary: '人情。', changes: [{ op: 'favor.add', dir: 'owed_to_pc', who: 'npc_day', size: 'small', note: '你替他擋了一次。' } as never, { op: 'favor.add', dir: 'owed_by_pc', who: 'npc_day', size: 'mid' } as never] })).toBeNull()
    expect(favorTotals(e.people.favors())).toEqual({ owedToYou: 1, youOwe: 1 })
    const g = oracle(e)
    expect(e.people.favors()).toEqual(favorsOf(g.state))
    const dom = await html(pinia, RelationsDialog, { npcId: 'npc_day' })
    expect(strip(dom)).toContain('日班阿志')
    expect(dom).toContain('data-favor="fv_1"')
    expect(dom).toContain('data-owe="fv_2"')
    // 用掉：欠你的少一筆（引擎的 spend）
    expect((await e.people.favorUse('fv_1')).status).toBe('applied')
    expect(favorTotals(e.people.favors())).toEqual({ owedToYou: 0, youOwe: 1 })
    // 被討：回絕之後那一筆還在、答應之後清掉
    expect((await e.people.favorAnswer('fv_2', 'refuse')).status).toBe('applied')
    expect(favorTotals(e.people.favors()).youOwe).toBe(1)
    expect((await e.people.favorAnswer('fv_2', 'do')).status).toBe('applied')
    expect(favorTotals(e.people.favors())).toEqual({ owedToYou: 0, youOwe: 0 })
    expect(e.people.favorUseBlock('fv_1')).toContain('已經用掉')
  })
})

// ---- 換配置 ----

describe('橋分頁的換配置（引擎的 loadoutBlock 與 loadout_minutes）', () => {
  it('不在住處時套用是灰的並有引擎的原因；在住處套用之後時間多了引擎說的分鐘數', async () => {
    const { e, pinia } = await setup({ hour: 10 })
    const why = e.skills.loadoutBlock()
    expect(why).toContain('住處')
    const dom = await html(pinia, BridgeTab)
    expect(dom).toMatch(/data-act="apply"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-act="apply"/)
    expect(strip(dom)).toContain(why!)
    expect(strip(dom)).toContain(`套用要花 ${e.skills.loadoutMinutes()} 分鐘`)
    // 租下出租屋、站在那一間：可以換
    expect((await e.rest.rent('res_t')).status).toBe('applied')
    expect((await e.world.arrive('b_t', 'F3')).status).toBe('applied')
    expect(e.skills.loadoutBlock()).toBeNull()
    // 學會一個真的技能再裝上（給歷練點、學、裝：都問引擎）
    expect(e.commit({ summary: '歷練點', changes: [{ op: 'actor.ext', id: 'pc', key: 'abilities', value: { xp: 1000, learned: [], equipped: [], spent: {} } } as never, { op: 'actor.ext', id: 'pc', key: 'bridge', value: { capacity: { meat: 8, net: 8, social: 8, media: 8 } } } as never] })).toBeNull()
    const pick = e.skills.abilities().find((a) => e.skills.learnBlock(a.id) === null)
    expect(pick).toBeTruthy()
    expect(e.skills.learn(pick!.id)).toBeNull()
    const t0 = minutesOf(e)
    expect(e.skills.equip([pick!.id])).toBeNull()
    expect(minutesOf(e) - t0).toBe(e.skills.loadoutMinutes())
    expect(e.skills.loadoutMinutes()).toBeGreaterThan(0)
  })

  it('副本等進行中的活動擋住時整頁唯讀，原因是引擎的', async () => {
    const { e, pinia } = await setup({ hour: 10 })
    expect(e.skills.lock()).toBeNull()
    // 測試活動：狀態裡有 ext.busy_test 才算進行中（用引擎的提交寫進去）
    expect(e.commit({ summary: '活動', changes: [{ op: 'ext', key: 'busy_test', value: true } as never] })).toBeNull()
    expect(e.skills.lock()).toBe(BUSY_REASON)
    expect(strip(await html(pinia, BridgeTab))).toContain(BUSY_REASON)
  })
})

// ---- 原始碼的規定 ----

describe('畫面沒有規則', () => {
  const comps = { TalkDialog: talkSrc, RelationsDialog: relationsSrc, RosterDialog: rosterSrc, BridgeTab: bridgeSrc, peopleView: viewSrc }
  it('不 import ui/src/data/npcs、roster', () => {
    for (const [name, src] of Object.entries(comps)) {
      expect(src, name).not.toMatch(/data\/npcs|data\/roster/)
    }
    expect(mainSrc).not.toMatch(/data\/npcs|data\/roster/)
  })
  it('畫面裡沒有寫死的「半小時」或 30 分鐘；沒有 DC、親密度門檻的算式', () => {
    for (const [name, src] of Object.entries(comps)) {
      expect(src, name).not.toMatch(/半小時|30 分鐘|30 分/)
      expect(src, name).not.toMatch(/Math\.floor\([^)]*\/\s*(10|20)\s*\)/)
      expect(src, name).not.toMatch(/guard|difficulty\(|baseDc/)
    }
    // 階段的名字與下限只從引擎的 STAGES 來，不自己寫 20、40、60、80
    expect(viewSrc).not.toMatch(/>=\s*(20|40|60|80)\b/)
  })
})

// ---- 示意世界包 ----

describe('示意世界包的人', () => {
  it('載得進去：固定 NPC 用 engine/data 已有的 id；名冊有小麥與雷，候選人有奈奈與喬；每區有生成規則', () => {
    const g = new Game({ features: [...allFeatures(), demoStartFeature()], content: [CORE_PACK, demoPack()], fakeProvider: new FakeProvider() })
    expect(g.k.content.has('npc', 'npc_xiaomai')).toBe(true)
    expect(g.k.content.list('npc_gen')).toHaveLength(8)
    expect(g.k.content.get<{ id: string; paths?: unknown[] }>('npc', 'npc_xiaomai')?.paths).toBeTruthy()
    // 核心包的簡表被換成完整的，不重複
    expect(g.k.content.list('npc').filter((n) => n.id === 'npc_xiaomai')).toHaveLength(1)
  })
  it('開新局建角之後名冊裡有小麥與雷（引擎的角色、帶路數、忠誠）；候選人是奈奈與喬', () => {
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 3, draft: DRAFT as never })
    const view = e.people.roster()
    expect(view.members.map((m) => m.id).sort()).toEqual(['npc_ray', 'npc_xiaomai'])
    expect(e.people.candidates().map((c) => c.who).sort()).toEqual(['npc_jo', 'npc_nana'])
    expect(e.state.actors.npc_xiaomai!.ext.paths).toBeTruthy()
    expect(e.people.loyalty('npc_xiaomai')).not.toBeNull()
    expect(e.people.affinity('npc_xiaomai')).toBeGreaterThan(0)
    expect(e.people.stage('npc_xiaomai').name).toBeTruthy()
  })
})
