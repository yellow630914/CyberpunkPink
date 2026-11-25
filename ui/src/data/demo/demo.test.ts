import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from '../../stores/engine'
import { DRAFT } from '../../../tests/commission/fixtures'
import { playNetStage } from '../../../tests/commission/netPlay'
import { DEMO_NET_OFFER } from './commission'
import { FakeProvider, Game } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { arrive, cityGraph, worldProblems, worldView } from '@engine/src/features/world'
import { transitView } from '@engine/src/features/transit'
import { board, genProblems } from '@engine/src/features/fixer'
import { shopView } from '@engine/src/features/trade'
import { sleepOptions } from '@engine/src/features/rest'
import { jobsHere } from '@engine/src/features/work'
import { DEMO_HOLDER_NPC, demoHolderChanges, demoPack, demoStartFeature } from '.'
import { adjustDraft, heldIn, heldPeople, holderContractView, holderEvents, releaseDraft, triggerDraft } from '@engine/src/features/contract'

/** 示意世界包能被引擎載入：內容的格式、引用、出口成對、車站在街區的設施上，都由引擎的檢查把關。 */
const make = () => new Game({ features: [...allFeatures(), demoStartFeature()], content: [CORE_PACK, demoPack()], fakeProvider: new FakeProvider() })

describe('示意世界包', () => {
  it('引擎載得進去，世界的整體檢查沒有問題', () => {
    const g = make()
    expect(worldProblems(g.k)).toEqual([])
  })
  it('資料檢查沒有警告：網內的敵人（蕾絲、遊戲敵人）都有 constructs', () => {
    expect(make().contentWarnings()).toEqual([])
  })
  it('八個區、每個區至少一塊街區，城市圖的走道成對', () => {
    const g = make()
    const c = cityGraph(g.k)
    expect(c.districts).toHaveLength(8)
    for (const d of c.districts) expect(d.blocks.length).toBeGreaterThan(0)
    expect(c.links.length).toBeGreaterThan(10)
  })
  it('開新局站在四號塔的晾衣場，右邊的設施與出口都有', () => {
    const g = make()
    g.newGame({ seed: 1 })
    const w = worldView(g.k, g.state)
    expect(w.district?.id).toBe('hive')
    expect(w.block?.name).toBe('四號塔')
    expect(w.facility?.name).toBe('屋頂的晾衣場')
    expect(w.exits.length).toBeGreaterThan(0)
    expect(w.facilities.length).toBeGreaterThan(5)
  })
  it('天井市場有車站，站上列出紅線與輕軌以外的線', () => {
    const g = make()
    const b = 'b_hive_1'
    g.newGame({ seed: 1 })
    g.commit(arrive(g.k, g.state, b))
    const st = worldView(g.k, g.state).facilities.find(f => f.type === 'fac_transit')!
    g.commit(arrive(g.k, g.state, b, st.marker))
    const t = transitView(g.k, g.state)
    expect(t.station?.lines.map(l => l.id)).toEqual(['line_red'])
  })
  it('委託：兩位中間人、兩種類型、詞條與連動都能生成，沒有生成的問題；每位每天有案子', () => {
    const g = make()
    g.newGame({ seed: 3 })
    expect(genProblems(g.k)).toEqual([])
    for (const id of ['fx_alian', 'fx_monroe']) {
      const b = board(g.k, g.state, id)
      expect(b.open).toBe(true)
      expect(b.problems).toEqual([])
      expect(b.offers.length).toBeGreaterThan(0)
      for (const o of b.offers) expect(o.brief.stages).toBeGreaterThanOrEqual(3)
    }
  })
  it('中間人的店在街區上：阿蓮雜貨在天井市場、夢露在中城段・北', () => {
    const g = make()
    expect(g.k.content.get('fixer', 'fx_alian')?.block).toBe('b_hive_1')
    expect(g.k.content.get('fixer', 'fx_monroe')?.block).toBe('b_ave42_2')
  })
  it('過日子：三間店在自己的設施上列「進店」，貨架有東西、都有價錢與拆解', () => {
    const g = make()
    g.newGame({ seed: 5 })
    for (const [id, block, name] of [['alian', 'b_hive_1', '阿蓮雜貨'], ['gunshop', 'b_oldport_4', '回火'], ['cybershop', 'b_ave42_4', '義體零件行']] as const) {
      const shop = g.k.content.get<{ id: string; block: string; facility: string; name: string }>('shop', id)!
      expect(shop.block).toBe(block)
      expect(shop.name).toContain(name)
      g.commit(arrive(g.k, g.state, shop.block, shop.facility))
      expect(g.gridView()!.here.uses.map(u => u.id)).toContain(`trade.shop:${id}`)
      const v = shopView(g.k, g.state, id)
      expect(v.shelf.length).toBeGreaterThan(0)
      for (const r of v.shelf) expect(r.quote.steps.length).toBeGreaterThan(0)
    }
  })
  it('過日子：麵攤與雜貨店有打工；有住處可以租；有床位的旅店、營地與診所（診所的床算傷口處理過）', () => {
    const g = make()
    g.newGame({ seed: 5 })
    const job = g.k.content.get<{ id: string; facility: string }>('job', 'job_alian_counter')!
    const [block, marker] = job.facility.split('/')
    g.commit(arrive(g.k, g.state, block!, marker))
    expect(jobsHere(g.k, g.state).map(j => j.id)).toEqual(['job_alian_counter'])
    expect(g.k.content.list('residence').map(r => r.id)).toEqual(['res_hive_unit', 'res_oldport_container', 'res_ave42_capsule'])
    const noid = g.k.content.list<{ id: string; sleep?: unknown }>('facility_type').filter(t => t.sleep !== undefined && t.id.startsWith('fac_')).map(t => t.id)
    expect(noid.sort()).toEqual(['fac_camp', 'fac_clinic', 'fac_inn'])
    expect(g.k.content.get<{ id: string; sleep?: { treated?: boolean } }>('facility_type', 'fac_clinic')!.sleep?.treated).toBe(true)
    expect(g.k.content.get<{ id: string; sleep?: { treated?: boolean } }>('facility_type', 'fac_inn')!.sleep?.treated).toBeUndefined()
    // 站在旅店的設施上：引擎的睡處列表多一個設施的選項
    const inn = [...g.k.content.list<{ id: string; facilities: Record<string, { type: string }> }>('block')].flatMap(b => Object.entries(b.facilities).filter(([, f]) => f.type === 'fac_inn').map(([m]) => [b.id, m] as const))[0]!
    g.commit(arrive(g.k, g.state, inn[0], inn[1]))
    expect(sleepOptions(g.k, g.state).map(o => o.id)).toContain('facility')
  })
  it('內海：蕾絲、子網的區、潛艙店都載得進來；潛艙店在街區的設施上', () => {
    const g = make()
    for (const f of ['lonestar', 'strippers', 'guard']) {
      const lace = g.k.content.list<{ id: string; faction: string; kind: string; rank: string }>('enemy').filter(e => e.faction === f && e.kind === 'lace')
      expect(lace.map(e => e.rank).sort()).toEqual(['boss', 'elite', 'minion', 'minion'])
    }
    expect(g.k.content.get('net_region', 'subnet')).toBeDefined()
    const shop = g.k.content.get<{ id: string; block: string; facility: string }>('shop', 'divepod')!
    g.newGame({ seed: 5 })
    g.commit(arrive(g.k, g.state, shop.block, shop.facility))
    expect(g.gridView()!.here.uses.map(u => u.id)).toContain('trade.shop:divepod')
  })
  it('內海的類型生成得出來（沒有生成的問題）', () => {
    const g = make()
    g.newGame({ seed: 9 })
    expect(genProblems(g.k)).toEqual([])
    expect(g.k.content.get('fixer', 'fx_monroe')).toBeDefined()
  })
  it('寫好的內海委託：從接案走到做完（四階段：內海、現實、現實、隔離區的內海），戰鬥與下載自動走', async () => {
    setActivePinia(createPinia())
    const e = useEngine()
    expect(e.newGame({ seed: 11, draft: DRAFT as never })).toEqual([])
    expect((await e.world.arrive('b_hive_1')).status).toBe('applied')
    const offer = e.fixer.board('fx_alian').offers.find(o => o.id === DEMO_NET_OFFER)!
    expect(offer.net).not.toBeNull()
    expect((await e.fixer.accept({ id: offer.id, fixer: 'fx_alian' }, 'cash')).status).toBe('applied')
    expect((await e.fixer.go(offer.id)).status).toBe('applied')
    const meatTo = (x: number, y: number) => {
      const at = e.state.maps.at!
      expect(e.commit({ summary: '傳送', action: 'commission.test', changes: [{ op: 'map.at', to: { map: at.map, sheet: at.sheet, x, y } }] as never })).toBeNull()
    }
    // 1 內海
    expect((await e.commission.chooseFace('net')).reason).toBeUndefined()
    expect((await e.commission.chooseBranch('assault')).reason).toBeUndefined()
    await playNetStage(e)
    expect(e.commission.view()!.stage).toBe(2)
    // 2、3 現實
    expect((await e.commission.chooseFace('meat')).reason).toBeUndefined()
    expect((await e.commission.chooseBranch('assault')).reason).toBeUndefined()
    meatTo(1, 5)
    expect(e.commission.view()!.stage).toBe(3)
    expect((await e.commission.chooseFace('meat')).reason).toBeUndefined()
    expect((await e.commission.chooseBranch('assault')).reason).toBeUndefined()
    meatTo(1, 3)
    // 4 隔離區：拿到資料埠才選得了
    const v = e.commission.view()!
    expect(v.stage).toBe(4)
    expect(v.faces.find(f => f.face === 'net')!.block).toBeNull()
    expect((await e.commission.chooseFace('net')).reason).toBeUndefined()
    expect((await e.commission.chooseBranch('assault')).reason).toBeUndefined()
    await playNetStage(e)
    expect(e.commission.view()).toBeNull()
    expect(e.fixer.settledJob('cm_demo_net4')).not.toBeNull()
  })
  /** 開新局、放一位主角（建角走 store 的流程，這裡不重做；直接放進狀態，和引擎的測試工廠一樣）、套上「主角是持約人」的開局。 */
  const holderGame = () => {
    const g = make()
    g.newGame({ seed: 3 })
    Object.assign(g.state, {
      pc: 'pc', party: ['pc'],
      actors: { ...g.state.actors, pc: { id: 'pc', name: '主角', role: 'pc', age: 25, gender: 'female', perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [], attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } } },
    })
    g.commit({
      kind: 'action', action: 'game.demo', location: { ...g.state.location }, party: [], timeline: [], changes: demoHolderChanges(g.k, g.state), outcome: { result: 'ok', summary: '你買下了她的債。' },
    } as never)
    return g
  }
  it('主角是持約人的開局（第 18 題）：阿音在名冊上、債務契約剩 6,000、面板的兩頁讀得到、沒有多一份「成為持約人」的紀錄', () => {
    const g = holderGame()
    expect(g.state.actors[DEMO_HOLDER_NPC]?.name).toBe('阿音')
    expect(heldPeople(g.state)).toEqual([{ id: DEMO_HOLDER_NPC, home: 'own' }])
    expect(heldIn(g.state, DEMO_HOLDER_NPC)).toMatchObject({ type: 'debt', debt: 6000, relation: 'formal' })
    expect(g.state.actors[DEMO_HOLDER_NPC]!.ext.identity).toMatchObject({ class: 'bound' })
    expect(g.state.meters.affinity?.[DEMO_HOLDER_NPC]).toBe(45)
    expect(g.state.reports.filter(r => r.action === 'contract.hold')).toHaveLength(0)
    const v = holderContractView(g.k, g.state, DEMO_HOLDER_NPC)!
    expect(v).toMatchObject({ name: '阿音', level: 'manage', debt: 6000, affinity: 45, relation: 'formal' })
    expect(v.events.map(e => e.kind)).toEqual(['errand', 'modify', 'serve', 'work', 'talk'])
    expect(v.events.every(e => e.available)).toBe(true)
  })
  it('主角是持約人的開局：觸發一件差事，導演從範圍 contract 挑到示範事件、事件視窗開著；調整與解約都走引擎', () => {
    const g = holderGame()
    g.commit(adjustDraft(g.k, g.state, { npc: DEMO_HOLDER_NPC, patch: { split: 0.2, job: '麵攤洗碗' } }))
    expect(heldIn(g.state, DEMO_HOLDER_NPC)).toMatchObject({ split: 0.2, job: '麵攤洗碗' })
    g.commit(triggerDraft(g.k, g.state, { npc: DEMO_HOLDER_NPC, kind: 'errand' }))
    expect(g.state.reports.find(r => r.action === 'contract.trigger')?.triggers).toEqual([{ point: 'holder_order', where: { order: 'errand', npc: DEMO_HOLDER_NPC, relation: 'formal' } }])
    expect(g.state.reports.at(-1)).toMatchObject({ action: 'event.open', kind: 'event' })
    expect(holderEvents(g.k, g.state, DEMO_HOLDER_NPC).find(e => e.kind === 'errand')!.available).toBe(false)
    const g2 = holderGame()
    g2.commit(releaseDraft(g2.k, g2.state, { npc: DEMO_HOLDER_NPC, stay: true }))
    expect(heldPeople(g2.state)).toEqual([])
    expect(g2.state.flags[`released:${DEMO_HOLDER_NPC}`]).toBe(true)
  })
})
