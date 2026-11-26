import { describe, expect, it } from 'vitest'
import { netInventory, makeBodyGame, applyEffects, passTime, standAt, equipParty, NET_PC, TEST_NET_ADMIN, giveItem, diveIn, playNetStage, fightOut } from '../../src/testkit'
import { enterDraft, interviewDraft, tasteDraft, curtainView, memberView } from '../../src/features/curtain'
import { go as diveGo } from '../../src/features/dive'
import { readRun } from '../../src/features/netrun'

describe('scratch', () => {
  it('curtain', async () => {
    const t = makeBodyGame({ pc: NET_PC, features: [TEST_NET_ADMIN, { id: 'b030', install(k: any) { k.activity.allow('dive', 'commit:curtain.', 'b030') } } as any], patch: { inventory: netInventory(1) as never }, at: { block: 'tw_tower', marker: 'E1' } })
    const g = t.game
    equipParty(g, ['pc'])
    g.commit({ kind: 'system', action: 'test.rep', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'rep', key: '_', delta: 40 }] as never, outcome: { result: 'ok', summary: 't' } })
    console.log(applyEffects(g, [{ kind: 'curtain_invite' }]).errors)
    const r = g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))
    console.log(r.map((x) => x.action + ':' + x.outcome.result + ':' + x.outcome.summary))
    g.commit(tasteDraft(g.k, g.state, ['tg_tw_dom', 'tg_tw_sub', 'tg_tw_pamper']))
    standAt(g, 'tw_tower', 'F3')
    diveIn(g)
    const d = g.commit(diveGo(g.k, g.state, 'ns_tw_curtain'))
    console.log(d.map((x) => x.action + ':' + x.outcome.summary), g.state.location)
    const e = g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: 'cn_tw_stage' }))
    console.log(e.map((x) => x.action + ':' + x.outcome.summary))
    console.log(JSON.stringify(readRun(g.state))?.slice(0, 300))
    const { playCurtainRun } = await import('../../src/testkit')
    try {
    const res = await playCurtainRun(g, { extras: true, onFight: (gg, out) => console.log('FIGHT', out, JSON.stringify((gg.state.actors.pc!.ext.net)), gg.state.actors.pc!.load, gg.state.actors.pc!.afterglow) })
    console.log('ORDERS', res.orders, 'CHESTS', res.chests)
    } catch (e) {
      console.log('ERR', (e as Error).message)
      const b = g.battle
      if (b) {
        console.log('round', b.round, JSON.stringify(Object.values(b.units).map((u) => [u.id, u.side, u.name, u.rank, u.slot, JSON.stringify(u.load), u.out ?? '', u.ap.now, JSON.stringify(u.statuses?.map((x: any) => x.id)), JSON.stringify(u.tags)])))
        console.log(g.state.reports.slice(-3).map((r) => r.timeline.map((x) => x.text).join(' / ')).join('\n').slice(0, 2500))
        console.log('WEAPONS', JSON.stringify(b.units.a1!.weapons), JSON.stringify(b.units.a1!.ext))
        const o = g.battleOptions()
        console.log(o?.waiting, o?.current, JSON.stringify(o?.actions.map((a) => [a.id, a.ok, a.targets.length, a.blocks])))
      }
    }
    console.log(g.state.reports.slice(-12).map((r) => r.action + ':' + r.outcome.summary).join('\n'), JSON.stringify(curtainView(g.k, g.state)).slice(0, 1200))
    expect(true).toBe(true)
  }, 120000)
})
