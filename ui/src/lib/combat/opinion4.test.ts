import { describe, it, expect } from 'vitest'
import { OpinionWar, clipCard, TOPICS, CITY_EVENTS } from './opinion'
import { seeded } from './rng'

const clip = { id: 'c1', name: '碼頭的交貨', angle: '揭弊' as const, looks: 4, cred: 4, who: ['藍鯨物流'], types: ['罪證'] }
describe('輿論戰・第四版', () => {
  it('片進牌庫：拍到當事人全額、類型相同減半、無關只能當轉移焦點', () => {
    const t = TOPICS.find(x => x.id === 'scandal')!
    expect(clipCard(clip, t)).toMatchObject({ t: 2, w: 2, rel: '全額' })
    expect(clipCard({ ...clip, who: [] }, t)).toMatchObject({ t: 2, w: 1, rel: '減半' })
    expect(clipCard({ ...clip, who: [], types: ['日常'] }, t)).toMatchObject({ t: 3, rel: '無關' })
    expect(clipCard({ ...clip, angle: '煽情', looks: 4 }, t)).toMatchObject({ t: 1, v: 4, c: 2 })
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_1', clips: [clip], events: false }, seeded(1))
    expect([...o.deck, ...o.hand]).toContain('clip:c1')
    expect(o.card('clip:c1').n).toBe('片：碼頭的交貨')
  })
  it('城市事件每回合翻一張：停電讓主流那一排不能被佔、另一樁醜聞雙方聲量 −2', () => {
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_2', events: false }, seeded(2))
    o.useEvents = true
    o.rng = () => CITY_EVENTS.findIndex(e => e.id === 'blackout') / CITY_EVENTS.length + 0.001
    o.flipEvent()
    expect(o.locked).toEqual([3, 4, 5])
    o.own[4] = 0; o.own.fill(0); o.own[7] = 1; o.va = 10
    expect(o.canCap(4, 1)).toBe(false)
    o.rng = () => 0.001
    o.va = 5; o.vb = 5
    o.flipEvent()
    expect(o.event!.id).toBe('scandal2')
    expect([o.va, o.vb]).toEqual([3, 3])
  })
  it('收買：對手落後時開價；收下就拿錢、算敗', () => {
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_2', events: false }, seeded(3))
    o.round = 3
    o.own.fill(0); o.own[4] = 1; o.own[3] = 1; o.own[8] = 2
    o.endTurn()
    expect(o.offer?.price).toBe(1500)
    o.acceptBribe()
    expect(o.end?.result).toBe('敗')
    expect(o.bribed).toBe(1500)
  })
  it('找上門：星旗落後 2 分就來；擋不住時把你帶走；擋住了而且在直播，多一張料', () => {
    const lose = new OpinionWar({ topic: 'scandal', foe: 'pr_starbelle', events: false, guard: -20 }, seeded(4))
    lose.round = 2; lose.own.fill(0); lose.own[4] = 1; lose.own[8] = 2
    lose.endTurn()
    expect(lose.captured).toBe(true)
    expect(lose.end?.result).toBe('敗')
    const win = new OpinionWar({ topic: 'scandal', foe: 'pr_starbelle', events: false, guard: 40, live: true }, seeded(4))
    win.round = 2; win.own.fill(0); win.own[4] = 1; win.own[8] = 2
    win.endTurn()
    expect(win.visited).toBe(true)
    expect([...win.hand, ...win.deck]).toContain('visit')
  })
  it('招牌：星旗的律師函 −2；崑崙下架數字最高的料；夜鶯佔著夜鶯直播時防守 +1', () => {
    const s = new OpinionWar({ topic: 'scandal', foe: 'pr_starbelle', events: false }, seeded(5))
    s.endTurn(); while (s.foeStep());
    expect(s.lines.some(l => l.t.includes('編輯點 −2'))).toBe(true)
    const k = new OpinionWar({ topic: 'scandal', foe: 'pr_kunlun', events: false }, seeded(6))
    k.hand = ['clip', 'doc', 'talk']
    k.endTurn(); k.foeStep()
    expect(k.hand).not.toContain('doc')
    const n = new OpinionWar({ topic: 'scandal', foe: 'pr_nightingale', events: false }, seeded(7))
    n.own.fill(0); n.own[5] = 2; n.own[4] = 1; n.w = 0
    expect(n.def(5, 1)).toBe(4)
  })
})
