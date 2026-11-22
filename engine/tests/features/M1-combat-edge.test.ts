// combat 功能的補充測試（驗收測試 M1-combat.test.ts 沒走到的分支）：重傷的重級、戰後的紀錄、要活的、道具的錯誤、掃射與打遮蔽的錯誤。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { makeBattleGame, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const ITEM = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, desc: `${name}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'combat_edge',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '那隻手或腳的檢定 −2，到戰鬥結束。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }],
    item: [
      ITEM('it_lock', '鎖橋器', { tags: ['restraint'], consumable: false }),
      ITEM('it_tie', '束帶', { tags: ['restraint'] }),
      ITEM('it_self', '冷卻劑', { use: { ap: 1, target: 'self', effects: [{ op: 'afterglow', layers: -1 }] } }),
      ITEM('it_gel', '急救凝膠', { use: { ap: 1, ap_other: 2, target: 'ally', effects: [{ op: 'heal', amount: 8 }, { op: 'cleanse', status: 'bleeding' }] } }),
      ITEM('it_smoke', '煙霧彈', { use: { ap: 1, target: 'slot', effects: [{ op: 'soft_cover', kind: 'smoke', rounds: 2 }] } }),
      ITEM('it_net_only', '網內專用', { use: { ap: 1, target: 'self', modes: ['net'], effects: [{ op: 'vent', amount: 1 }] } }),
    ],
  },
}
const game = (battle: BattleSetup, seed = 7) => makeBattleGame({ features: [combatFeature], content: [PACK], battle, seed }).game
type G = ReturnType<typeof game>
const turnTo = (g: G, id: string): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)!

describe('重創的重級', () => {
  const a = () => arena(duel([one({ weapon: 'pistol' })], [foe('elite')]), [combatFeature], (k) => k.content.loadPack(PACK))
  const hit = (x: ReturnType<typeof a>, t: BattleUnit, part: string) => x.k.battle.emit('wound', { run: x.run([]), attacker: x.foe(1), target: t, aimed: true, part })

  it('肢體：第二次把肢體受創的修正改成 −4', () => {
    const x = a()
    const me = x.ally(1)
    hit(x, me, 'limb')
    expect(me.statuses.find((s) => s.id === 'limb_hurt')!.data).toBeUndefined()
    hit(x, me, 'limb')
    expect(me.wounds).toEqual({ limb: 2 })
    expect(me.statuses.find((s) => s.id === 'limb_hurt')!.data).toEqual({ hit: -4 })
  })

  it('軀幹：護甲歸零、生命上限 −5（只在從輕變重的那一次；再中不再扣）', () => {
    const x = a()
    const me = x.ally(1)
    const max = me.hp!.max
    me.hp!.now = max
    hit(x, me, 'torso')
    expect(me.armor).toBeGreaterThan(0)
    hit(x, me, 'torso')
    expect(me.armor).toBe(0)
    expect(me.hp).toEqual({ now: max - 5, max: max - 5 })
    hit(x, me, 'torso')
    expect(me.wounds).toEqual({ torso: 2 })
    expect(me.hp!.max).toBe(max - 5)
  })

  it('橋：承受層數 −1，最少 1；頭沒有額外的效果', () => {
    const x = a()
    const me = x.ally(1)
    me.layersMax = 2
    hit(x, me, 'bridge')
    hit(x, me, 'bridge')
    expect(me.layersMax).toBe(1)
    expect(me.load!.now).toBe(20)
    me.statuses = []
    hit(x, me, 'head')
    hit(x, me, 'head')
    expect(me.wounds.head).toBe(2)
    expect(me.statuses.map((s) => s.id)).toEqual(['dazed'])
  })

  it('不認得的部位名稱當成沒指定，改擲', () => {
    const x = a()
    const t = x.foe(1)
    x.k.battle.emit('wound', { run: x.run([60]), attacker: x.ally(1), target: t, aimed: true, part: 'tail' })
    expect(t.wounds).toEqual({ torso: 1 })
  })
})

describe('戰後的結果', () => {
  it('我方有角色的人帶著重傷：寫一行、留一個狀態；橋的重傷不留；敵人不寫', async () => {
    const g = game(duel([one({ weapon: 'pistol' })], [foe('minion')]))
    const pc = g.state.pc!
    const me = g.state.battle!.units.a1!
    me.actor = pc
    me.wounds = { head: 2, bridge: 2, limb: 1 }
    g.state.battle!.units.f1!.wounds = { torso: 2 }
    turnTo(g, 'a1')
    g.battleAct({ action: 'surrender' })
    const end = await g.finishBattle()
    expect(end.reports[0]!.narration!.results!.filter((l) => l.startsWith('重傷'))).toEqual([`重傷：${me.name}的頭（要治療）`])
    expect(end.reports[0]!.changes.filter((c) => c.op === 'actor.condition')).toEqual([{ op: 'actor.condition', id: pc, condition: 'wound_head' }])
  })

  it('要活的：每個都制伏或投降才算達成；沒有達成時寫出被打倒的名字；沒贏不寫', async () => {
    const run = async (outs: Array<string | undefined>, win = true) => {
      const g = game(duel([one({ weapon: 'pistol' })], [foe('minion', { name: '甲' }), foe('minion', { name: '乙' })]))
      const b = g.state.battle!
      b.origin.capture = ['f1', 'f2']
      b.units.f1!.out = outs[0]
      b.units.f2!.out = outs[1]
      turnTo(g, 'a1')
      if (win) {
        const r = g.battleAct({ action: 'end_turn' })
        expect(r.status).toBe('applied')
      } else g.battleAct({ action: 'surrender' })
      return (await g.finishBattle()).reports[0]!.narration!.results!.filter((l) => l.startsWith('要活的'))
    }
    // out 寫在單位上，核心下一步收尾時才分出勝負；這裡直接看結果的那一行
    expect(await run(['subdued', 'surrendered'])).toEqual(['要活的：達成'])
    expect(await run(['subdued', 'down'])).toEqual(['要活的：沒有達成（乙被打倒了）'])
    expect(await run(['down', 'down'])).toEqual(['要活的：沒有達成（甲、乙被打倒了）'])
    expect(await run(['subdued', 'subdued'], false)).toEqual([])
  })
})

describe('做不成的一步', () => {
  it('掃射：沒有 sweep 特性、對和人重疊的東西，都擋下並寫出原因', () => {
    const g = game(duel([one({ weapon: 'rifle' })], [foe()]))
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })).toMatchObject({ status: 'refused', reasons: ['這把武器不能掃射。'] })
    const lmg = one({ weapon: 'rifle' })
    lmg.weapons[0] = { ...testWeapon('rifle', 4), traits: ['sweep'], mag: { now: 4, max: 4 } }
    const h = game(duel([lmg], [foe()]))
    h.state.battle!.overlays.push({ id: 'o1', side: 'foe', slot: 1, owner: 'f1', kind: 'attack', name: '無人機', hp: { now: 10, max: 10 }, armor: 0, evade: 10, used: false, down: false })
    turnTo(h, 'a1')
    const t = opt(h, 'shoot').targets
    expect(t.map((x) => x.target)).toEqual([{ unit: 'f1' }, { overlay: 'o1' }])
    expect(h.battleAct({ action: 'shoot', target: { overlay: 'o1' }, pick: { sweep: true } }).status).toBe('refused')
    expect(h.battleAct({ action: 'shoot', target: { overlay: 'o1' } }).status).toBe('applied')
    expect(h.battle!.units.a1!.weapons[0]!.mag!.now).toBe(3)
  })

  it('換武器：指定的索引不對', () => {
    const two = one({ weapon: 'rifle' })
    two.weapons.push(testWeapon('pistol', 4))
    const g = game(duel([two], [foe()]))
    turnTo(g, 'a1')
    for (const weapon of [0, 2, -1, 'x']) expect(g.battleAct({ action: 'swap', pick: { weapon } })).toMatchObject({ status: 'refused', reasons: ['沒有這把武器。'] })
  })

  it('打遮蔽：空彈匣、沒有遮蔽可打時寫出原因；煙霧打不破', () => {
    const g = game(duel([one({ weapon: 'pistol' })], [foe()], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }))
    turnTo(g, 'a1')
    expect(opt(g, 'hit_cover')).toMatchObject({ ok: false, blocks: ['沒有可以選的目標。'] })
    g.state.battle!.cover.foe[1] = { level: 1, hp: 5, soft: { kind: 'smoke', until: 9 } } as never
    expect(opt(g, 'hit_cover').targets).toEqual([])
    g.state.battle!.units.a1!.weapons[0]!.mag!.now = 0
    expect(opt(g, 'hit_cover').blocks).toContain('彈匣空了，要先換彈。')
  })

  it('道具：沒選而有兩種、選了別人用只能自己用的、對格子用對人的、模式不對的', () => {
    const quick = [{ item: 'it_self', qty: 1 }, { item: 'it_gel', qty: 1 }, { item: 'it_smoke', qty: 1 }, { item: 'it_net_only', qty: 1 }, { item: 'it_tie', qty: 1 }]
    const g = game(duel([one({ weapon: 'pistol', quick }), one({ weapon: 'pistol' }, 2)], [foe()]))
    turnTo(g, 'a1')
    const t = opt(g, 'item').targets.map((x) => x.target)
    expect(t).toEqual([{ unit: 'a1' }, { unit: 'a2' }, ...[1, 2, 3, 4].map((slot) => ({ side: 'ally', slot }))])
    const act = (pick: Record<string, unknown> | undefined, target: object) => g.battleAct({ action: 'item', target: target as never, ...(pick ? { pick } : {}) })
    expect(act(undefined, { unit: 'a1' })).toMatchObject({ status: 'refused', reasons: ['要選用哪一個道具。'] })
    expect(act({ item: 'it_self' }, { unit: 'a2' })).toMatchObject({ status: 'refused', reasons: ['這個道具只能自己用。'] })
    expect(act({ item: 'it_self' }, { side: 'ally', slot: 1 })).toMatchObject({ status: 'refused', reasons: ['這個道具不是這樣用的。'] })
    expect(act({ item: 'it_gel' }, { side: 'ally', slot: 1 })).toMatchObject({ status: 'refused', reasons: ['這個道具不是這樣用的。'] })
    expect(act({ item: 'it_smoke' }, { unit: 'a1' })).toMatchObject({ status: 'refused', reasons: ['這個道具不是這樣用的。'] })
    expect(act({ item: 'it_net_only' }, { unit: 'a1' })).toMatchObject({ status: 'refused', reasons: ['快取格裡沒有這個道具。'] })
    expect(g.battle!.units.a1!.quick).toHaveLength(5)
    // 替隊友用要 2 點
    expect(g.battleOptions()!.actions.find((a) => a.id === 'item')!.cost.ap).toBe(1)
    expect(act({ item: 'it_gel' }, { unit: 'a2' }).status).toBe('applied')
    expect(g.battle!.units.a1!.ap.now).toBe(g.battle!.units.a1!.ap.max - 2)
  })

  it('制伏：有束帶先用束帶；只有鎖橋器時不消耗', () => {
    const run = (quick: Array<{ item: string; qty: number }>) => {
      const g = game(duel([one({ weapon: 'knife', quick, skills: { brawl: 60 } })], [foe()]))
      turnTo(g, 'a1')
      g.state.battle!.units.f1!.statuses.push({ id: 'lose_turn', until: { at: 'turn_start', of: 'f1', turns: 1 } })
      const r = g.battleAct({ action: 'subdue', target: { unit: 'f1' } })
      expect(r.status).toBe('applied')
      return g.battle!.units.a1!.quick
    }
    expect(run([{ item: 'it_lock', qty: 1 }, { item: 'it_tie', qty: 2 }])).toEqual([{ item: 'it_lock', qty: 1 }, { item: 'it_tie', qty: 1 }])
    expect(run([{ item: 'it_lock', qty: 1 }])).toEqual([{ item: 'it_lock', qty: 1 }])
  })

  it('脫離：隱匿比運動高的人用反應擲；站位在前的優先', () => {
    const g = game(duel([one({ weapon: 'pistol', skills: { athletics: 1, stealth: 50 } }), one({ weapon: 'pistol', skills: { athletics: 1, stealth: 50 } }, 2)], [foe()]))
    turnTo(g, 'a2')
    const r = g.battleAct({ action: 'flee' })
    const roll = r.reports[0]!.timeline.find((b) => b.roll)!.roll!
    expect(roll).toMatchObject({ skill: 'stealth', attr: 'reflex', dc: 12 })
    expect(r.reports[0]!.timeline.find((b) => b.roll)!.text.startsWith(g.battle!.units.a1!.name)).toBe(true)
  })
})
