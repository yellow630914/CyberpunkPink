// 白箱測試：features/summons（無人機、載具、控制節點）。
// 補主套件沒有走到的分支：資料裡壞掉的值（等級、種類、索引、載具耐久）、目標不合的每一條原因、被擊落的後續、
// 節點的種類與格子。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, BattleUnit } from '../../src'
import { DRONE_CAP_BY_SYNC, DRONE_STATS, summonsFeature } from '../../src/features/summons'
import { TEST_COMBAT } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const dice = (...v: number[]) => [...v, ...Array(60).fill(1)]
const pilot = (summons: unknown, skills: Record<string, number> = { sync: 6, piloting: 3 }, o: Parameters<typeof one>[0] = {}) => one({ weapon: 'pistol', skills, ext: summons === null ? {} : { summons }, ...o })
const field = (allies: unknown[], foes: unknown[] = [foe('minion', { evade: 10 })], more: Parameters<typeof duel>[3] = {}) =>
  arena(duel(allies, foes, { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, more), [summonsFeature, TEST_COMBAT], (k) => k.content.load('battle_status', TEST_STATUSES))
type A = ReturnType<typeof field>
const act = (a: A, id: string) => a.k.battle.getAction(id)!
const deploy = (a: A, u: BattleUnit, drone: unknown, slot: number, dsl?: Parameters<A['run']>[0]) => act(a, 'drone.deploy').run(a.run(dsl), u, { side: u.side, slot }, { action: 'drone.deploy', pick: { drone } })
const overlayOf = (a: A, i = 0): BattleOverlay => a.battle.overlays[i]!

describe('白箱 資料裡的值（COMBAT_SYSTEM 9.1；ITEMS 3.2 節）', () => {
  it('同步對應的台數與每一級的生命、護甲照表', () => {
    expect(DRONE_CAP_BY_SYNC).toEqual([1, 1, 2, 2, 3, 3, 4])
    expect(DRONE_STATS).toEqual([{ hp: 14, armor: 1 }, { hp: 17, armor: 2 }, { hp: 20, armor: 3 }, { hp: 25, armor: 4 }])
  })

  it('等級夾進 1～4（0 與壞值當 I、9 當 IV、小數四捨五入）；名字沒寫用種類的名字；item 記下來', () => {
    const a = field([pilot({ drones: [{ kind: 'attack', grade: 9 }, { kind: 'shield', grade: 0 }, { kind: 'scout', grade: 'x' }, { kind: 'medic', grade: 2.6, name: '小護士', item: 'it_d' }] })])
    const me = a.ally(1)
    for (let i = 0; i < 4; i++) deploy(a, me, i, i + 1)
    expect(a.battle.overlays.map((o) => [o.name, o.hp.max, o.armor, o.ext!.grade])).toEqual([['攻擊無人機', 25, 4, 4], ['護盾無人機', 14, 1, 1], ['偵察無人機', 14, 1, 1], ['小護士', 20, 3, 3]])
    expect(a.battle.overlays[3]!.item).toBe('it_d')
    expect(a.battle.overlays[0]!.item).toBeUndefined()
    expect(a.battle.overlays.map((o) => o.evade)).toEqual([13, 13, 13, 13])
  })

  it('同步技能超出 0～6 夾進去、小數捨去；沒有 piloting 當 0', () => {
    const a = field([pilot({ drones: [{ kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }] }, { sync: 99 })])
    const me = a.ally(1)
    expect(act(a, 'drone.deploy').blocks!(a.run(), me)).toEqual([])
    for (let i = 0; i < 4; i++) deploy(a, me, i, i + 1)
    expect(act(a, 'drone.deploy').blocks!(a.run(), me)).toEqual(['同步 6 級只連得住 4 台。'])
    const b = field([pilot({ drones: [{ kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }] }, { sync: -3 })])
    deploy(b, b.ally(1), 0, 1)
    expect(act(b, 'drone.deploy').blocks!(b.run(), b.ally(1))).toEqual(['同步 0 級只連得住 1 台。'])
    const c = field([pilot({ drones: [{ kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }] }, { sync: 3.9 })])
    deploy(c, c.ally(1), 0, 1)
    deploy(c, c.ally(1), 1, 2)
    expect(act(c, 'drone.deploy').blocks!(c.run(), c.ally(1))).toEqual(['同步 3 級只連得住 2 台。'])
  })

  it('ext.summons 壞掉（不是物件、drones 不是陣列、載具不是物件）：當成沒有；有行動的人只有放得出去的', () => {
    for (const bad of ['x', 5, null, { drones: 'x' }, { drones: {} }, { vehicle: 'x' }]) {
      const a = field([pilot(bad)])
      expect(act(a, 'drone.deploy').has!(a.run(), a.ally(1)), JSON.stringify(bad)).toBe(false)
      expect(act(a, 'vehicle.call').has!(a.run(), a.ally(1)), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('白箱 放出的每一條原因（不變式第 46 條）', () => {
  const one1 = (drones: unknown[] = [{ kind: 'attack', grade: 1 }]) => field([pilot({ drones })])

  it('picks：不認得的種類寫「不認得這一台的種類」、名字用種類字串；已放出與已擊落各一句', () => {
    const a = one1([{ kind: 'turret', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'shield', grade: 1, name: '盾' }])
    const me = a.ally(1)
    me.uses['drone:1'] = 1
    me.uses['drone:2'] = 2
    const opts = act(a, 'drone.deploy').picks!(a.run(), me)[0]!.options
    expect(opts.map((o) => [o.label, o.blocks])).toEqual([['turret', ['不認得這一台的種類。']], ['攻擊無人機', ['這一台已經放出去了。']], ['盾', ['這一台被擊落了，這一場不能再放。']]])
  })

  it('run：索引不是整數、超出、種類不認得、已放出去的、那一格已經掛著一台、目標不是我方的格：各丟「沒有這一台無人機」或對應的原因', () => {
    const a = one1([{ kind: 'attack', grade: 1 }, { kind: 'turret', grade: 1 }, { kind: 'attack', grade: 1 }])
    const me = a.ally(1)
    for (const idx of [-1, 3, 1.5, '0', undefined, null, 1]) expect(() => deploy(a, me, idx, 1), String(idx)).toThrow(/沒有這一台無人機/)
    deploy(a, me, 0, 2)
    expect(() => deploy(a, me, 0, 3)).toThrow(/沒有這一台無人機/)
    expect(() => deploy(a, me, 2, 2)).toThrow(/這一格已經掛著一台了/)
    const d = act(a, 'drone.deploy')
    const bad = (target: unknown) => () => d.run(a.run(), me, target as never, { action: d.id, pick: { drone: 2 } })
    expect(bad(null)).toThrow(/要選我方的一格/)
    expect(bad({ unit: 'a1' })).toThrow(/要選我方的一格/)
    expect(bad({ side: 'foe', slot: 1 })).toThrow(/要選我方的一格/)
    expect(bad({ side: 'ally', slot: 0 })).toThrow(/要選我方的一格/)
    expect(bad({ side: 'ally', slot: 5 })).toThrow(/要選我方的一格/)
    expect(bad({ side: 'ally', slot: 1.5 })).toThrow(/要選我方的一格/)
  })

  it('targets：已經掛著一台的格子灰掉；空格也可以掛', () => {
    const a = one1()
    const me = a.ally(1)
    deploy(a, me, 0, 3)
    const t = act(a, 'drone.deploy').targets!(a.run(), me)
    expect(t.map((x) => x.blocks.length)).toEqual([0, 0, 1, 0])
    expect(t[2]!.blocks).toEqual(['這一格已經掛著一台了。'])
  })
})

describe('白箱 指揮、移動、收回的每一條原因（COMBAT_SYSTEM 9.1）', () => {
  const setup = (kind = 'attack') => {
    const a = field([pilot({ drones: [{ kind, grade: 1 }, { kind: 'medic', grade: 1 }] }), one({}, 2)])
    const me = a.ally(1)
    deploy(a, me, 0, 1)
    return { a, me }
  }
  const cmd = (a: A, me: BattleUnit, target: unknown, pick: Record<string, unknown> = {}, d?: number[]) => act(a, 'drone.command').run(a.run(d), me, target as never, { action: 'drone.command', pick })

  it('droneOf：目標不是 overlay、不存在、別人的、不是無人機（沒有 ext.drone）、已擊落：一律「沒有這一台無人機」', () => {
    const { a, me } = setup()
    const mine = overlayOf(a)
    a.battle.overlays.push({ ...mine, id: 'o9', owner: 'a2', ext: { drone: 0 } }, { ...mine, id: 'o8', ext: {} }, { ...mine, id: 'o7', down: true })
    for (const t of [null, { unit: 'f1' }, { overlay: 'zz' }, { overlay: 'o9' }, { overlay: 'o8' }, { overlay: 'o7' }]) expect(() => cmd(a, me, t, { at: 'f1' }), JSON.stringify(t)).toThrow(/沒有這一台無人機/)
    expect(act(a, 'drone.recall').targets!(a.run(), me).map((x) => x.target)).toEqual([{ overlay: 'o1' }])
  })

  it('指揮：動過了（run 直接呼叫也擋）；攻擊與干擾型要選敵人（pick.at）：不選、選我方的、選已退出的、選後方的、選不存在的都丟「要選一個敵人」', () => {
    const { a, me } = setup()
    const t = { overlay: 'o1' }
    for (const at of [undefined, 'a1', 'zz', 5]) expect(() => cmd(a, me, t, { at }), String(at)).toThrow(/要選一個敵人/)
    a.foe(1).out = 'down'
    expect(() => cmd(a, me, t, { at: 'f1' })).toThrow(/要選一個敵人/)
    a.foe(1).out = undefined
    a.foe(1).slot = 0
    expect(() => cmd(a, me, t, { at: 'f1' })).toThrow(/要選一個敵人/)
    a.foe(1).slot = 1
    cmd(a, me, t, { at: 'f1' }, dice(10))
    expect(overlayOf(a).used).toBe(true)
    expect(() => cmd(a, me, t, { at: 'f1' })).toThrow(/這一台這一回合動過了/)
    expect(act(a, 'drone.command').targets!(a.run(), me)[0]!.blocks).toEqual(['這一台這一回合動過了。'])
  })

  it('攻擊型：命中用操作者的反應調整與操縱；干擾型是電磁傷害、少一顆骰（COMBAT_SYSTEM 第 4、9.1 節）', () => {
    const { a, me } = setup()
    const run = a.run(dice(20))
    act(a, 'drone.command').run(run, me, { overlay: 'o1' }, { action: 'drone.command', pick: { at: 'f1' } })
    const roll = run.beats.find((b) => b.roll)!.roll!
    expect(roll.parts.find((p) => p.source === 'weapon')!.value).toBe(2 + 3) // mod(反應 15) + 操縱 3
    expect(roll).toMatchObject({ attr: 'reflex', skill: 'piloting' })
    const j = setup('jammer')
    const jr = j.a.run(dice(20))
    act(j.a, 'drone.command').run(jr, j.me, { overlay: 'o1' }, { action: 'drone.command', pick: { at: 'f1' } })
    expect(jr.beats.some((b) => b.tag === 'hit' || b.tag === 'crit')).toBe(true)
  })

  it('偵察型標記一個敵人；醫療型沒人在同一格丟「那一格沒有人」（run 的守門）；護盾型指揮就是守著（M1b-skill-pilot）；沒有定義的種類指揮不了', () => {
    const s = setup('scout')
    cmd(s.a, s.me, { overlay: 'o1' }, { at: 'f1' })
    expect(s.a.foe(1).statuses.map((x) => x.id)).toContain('marked')
    const m = setup('medic')
    m.me.slot = 0
    overlayOf(m.a).slot = 1
    m.a.ally(2).slot = 2
    m.a.ally(1).slot = 4
    expect(() => cmd(m.a, m.me, { overlay: 'o1' })).toThrow(/那一格沒有人/)
    const sh = setup('shield')
    expect(act(sh.a, 'drone.command').targets!(sh.a.run(), sh.me)[0]!.blocks).toEqual([])
    cmd(sh.a, sh.me, { overlay: 'o1' })
    expect(overlayOf(sh.a)).toMatchObject({ used: true, ext: { guard: 'own_turn_start' } })
    const weird = setup()
    overlayOf(weird.a).kind = 'turret'
    expect(() => cmd(weird.a, weird.me, { overlay: 'o1' })).toThrow(/這一台現在做不了事/)
    expect(overlayOf(weird.a).used).toBe(false)
  })

  it('picks：指揮只有攻擊、干擾、偵察型要選敵人；醫療與護盾的不用；移動只列換得過去的格；沒有格可換就沒有 pick', () => {
    const med = setup('medic')
    expect(act(med.a, 'drone.command').picks!(med.a.run(), med.me)).toEqual([])
    const att = setup()
    const picks = act(att.a, 'drone.command').picks!(att.a.run(), att.me)
    expect(picks[0]).toMatchObject({ key: 'at', required: true })
    expect(picks[0]!.options.every((o) => o.for!.some((f) => 'overlay' in f && f.overlay === 'o1'))).toBe(true)
    const mv = act(att.a, 'drone.move').picks!(att.a.run(), att.me)
    expect(mv[0]!.options.map((o) => o.value)).toEqual([2])
    const stuck = field([pilot({ drones: [{ kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }, { kind: 'attack', grade: 1 }] }, { sync: 6 })])
    for (let i = 0; i < 4; i++) deploy(stuck, stuck.ally(1), i, i + 1)
    expect(act(stuck, 'drone.move').picks!(stuck.run(), stuck.ally(1))).toEqual([])
    expect(act(stuck, 'drone.move').targets!(stuck.run(), stuck.ally(1)).every((t) => t.blocks[0] === '相鄰的格都掛著別台了。')).toBe(true)
  })

  it('移動：不是數字、不相鄰、掛著別台的格都丟原因；成功寫一拍；收回之後可以再放出同一台', () => {
    const { a, me } = setup()
    deploy(a, me, 1, 2)
    const mv = (to: unknown) => () => act(a, 'drone.move').run(a.run(), me, { overlay: 'o1' }, { action: 'drone.move', pick: { slot: to } })
    for (const to of [undefined, 'x', 3, 1, 2]) expect(mv(to), String(to)).toThrow(/只能換到相鄰、沒有掛著別台的格/)
    expect(() => act(a, 'drone.move').run(a.run(), me, { overlay: 'o1' }, { action: 'drone.move' })).toThrow(/只能換到相鄰/)
    expect(act(a, 'drone.recall').run(a.run(), me, { overlay: 'o2' }, { action: 'drone.recall' })).toBeUndefined()
    expect(me.uses['drone:1']).toBeUndefined()
    mv(2)()
    expect(overlayOf(a).slot).toBe(2)
    expect(a.battle.overlays).toHaveLength(1)
    deploy(a, me, 1, 3)
    expect(a.battle.overlays).toHaveLength(2)
  })
})

describe('白箱 被動與被擊落（COMBAT_SYSTEM 9.1）', () => {
  const setup = () => {
    const a = field([pilot({ drones: [{ kind: 'shield', grade: 1 }, { kind: 'attack', grade: 1 }] }), one({}, 2)])
    const me = a.ally(1)
    deploy(a, me, 0, 2)
    deploy(a, me, 1, 3)
    return { a, me }
  }

  it('護盾型：同一格的人迴避 +2；不同格、已擊落、不在場的不算（slot 0）', () => {
    const { a } = setup()
    const run = a.run()
    expect(run.mods('evade', a.ally(2)).map((p) => p.value)).toEqual([2])
    expect(run.mods('evade', a.ally(1))).toEqual([])
    overlayOf(a, 0).down = true
    expect(run.mods('evade', a.ally(2))).toEqual([])
    overlayOf(a, 0).down = false
    a.ally(2).slot = 0
    expect(run.mods('evade', a.ally(2))).toEqual([])
    expect(run.mods('hit', a.ally(1))).toEqual([])
  })

  it('被擊落：操作者感載 +5（不乘敏感度）、這一場不能再放；不是無人機的東西被擊落不處理；找不到操作者不丟錯；操作者已經退出就不加', () => {
    const { a, me } = setup()
    const run = a.run()
    me.sensitivity = 0
    run.dropOverlay(overlayOf(a, 1), a.foe(1))
    expect(me.load!.now).toBe(5)
    expect(me.uses['drone:1']).toBe(2)
    run.dropOverlay({ ...overlayOf(a, 0), id: 'oX', ext: {} }, undefined)
    expect(me.load!.now).toBe(5)
    run.dropOverlay({ ...overlayOf(a, 0), id: 'oY', owner: 'zz', ext: { drone: 0 } }, undefined)
    expect(a.run().mods('hit', me)).toEqual([])
    const b = setup()
    b.me.out = 'down'
    b.a.run().dropOverlay(overlayOf(b.a, 0), undefined)
    expect(b.me.load!.now).toBe(0)
    const c = setup()
    c.me.slot = 0
    c.a.run().dropOverlay(overlayOf(c.a, 0), undefined)
    expect(c.me.load!.now).toBe(0)
  })

  it('醫療型：每回合一次回 2d6、止血；回的量不超過上限', () => {
    const a = field([pilot({ drones: [{ kind: 'medic', grade: 1 }] })])
    const me = a.ally(1)
    deploy(a, me, 0, 1)
    me.hp!.now = me.hp!.max - 3
    const run = a.run(dice(6, 6))
    run.applyStatus(me, 'bleeding')
    act(a, 'drone.command').run(run, me, { overlay: 'o1' }, { action: 'drone.command' })
    expect(me.hp!.now).toBe(me.hp!.max)
    expect(me.statuses.map((s) => s.id)).not.toContain('bleeding')
  })
})

describe('白箱 載具與控制節點（COMBAT_SYSTEM 9.2、2.4）', () => {
  const car = (hp: unknown) => field([pilot({ vehicle: { name: '小貨車', hp } })])
  const call = (a: A, slot: unknown) => act(a, 'vehicle.call').run(a.run(), a.ally(1), { side: 'ally', slot } as never, { action: 'vehicle.call' })

  it('叫車：耐久格式不對（不是兩個、有零或負、不是數字）退回預設；寫對了用寫的；每場一次；目標不是我方的格丟錯', () => {
    for (const bad of ['x', [1], [30, 0], [-1, 5], [30, Number.NaN], [30, 60, 90]]) {
      const a = car(bad)
      call(a, 1)
      expect(a.battle.cover.ally[0], JSON.stringify(bad)).toMatchObject({ level: 2, hp: 30 })
      expect(a.battle.cover.ally[0]!.max).toBeUndefined()
    }
    const a = car([45, 90])
    expect(act(a, 'vehicle.call').blocks!(a.run(), a.ally(1))).toEqual([])
    call(a, 2)
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 2, hp: 90, max: [45, 90] })
    expect(a.ally(1).uses['vehicle.call']).toBe(1)
    expect(act(a, 'vehicle.call').blocks!(a.run(), a.ally(1))).toEqual(['這一場已經把車叫進來了。'])
    expect(() => act(a, 'vehicle.call').run(a.run(), a.ally(1), { side: 'foe', slot: 1 }, { action: 'vehicle.call' })).toThrow(/要選我方的一格/)
    expect(() => call(a, 9)).toThrow(/要選我方的一格/)
    const lost = field([pilot(null)])
    expect(() => act(lost, 'vehicle.call').run(lost.run(), lost.ally(1), { side: 'ally', slot: 1 }, { action: 'vehicle.call' })).toThrow(/沒有載具可以叫/)
  })

  const nodes = (kinds: Array<{ kind: string; name?: string }>, taken = true) => {
    const a = field([pilot({ drones: [{ kind: 'attack', grade: 1 }] })], [foe()], { nodes: kinds })
    if (taken) for (const n of a.battle.nodes) n.taken = true
    return a
  }
  const use = (a: A, target: unknown, pick: Record<string, unknown> = {}) => act(a, 'node.use').run(a.run(), a.ally(1), target as never, { action: 'node.use', pick })

  it('節點：沒有這個節點、沒拿下、用掉、沒有定義的種類（現在用不了）各一句；沒有節點的戰鬥沒有這個行動', () => {
    const a = nodes([{ kind: 'light' }, { kind: 'turret' }, { kind: 'door' }, { kind: 'light' }])
    a.battle.nodes[3]!.taken = false
    expect(() => use(a, null)).toThrow(/沒有這個節點/)
    expect(() => use(a, { node: 'n9' })).toThrow(/沒有這個節點/)
    expect(() => use(a, { node: 'n4' })).toThrow(/這個節點還沒有拿下/)
    expect(() => use(a, { node: 'n2' })).toThrow(/這個節點現在用不了/)
    a.battle.nodes[0]!.used = true
    expect(() => use(a, { node: 'n1' })).toThrow(/這個節點已經用掉了/)
    expect(act(a, 'node.use').targets!(a.run(), a.ally(1)).map((t) => t.blocks)).toEqual([['這個節點已經用掉了。'], [], [], ['這個節點還沒有拿下。']])
    expect(act(a, 'node.use').has!(a.run(), a.ally(1))).toBe(true)
    const none = field([pilot(null)])
    expect(act(none, 'node.use').has!(none.run(), none.ally(1))).toBe(false)
  })

  it('沒有拿下任何節點：行動灰掉「還沒有拿下任何控制節點」；有一個拿下就不灰', () => {
    const a = nodes([{ kind: 'light' }, { kind: 'door' }], false)
    expect(act(a, 'node.use').blocks!(a.run(), a.ally(1))).toEqual(['還沒有拿下任何控制節點。'])
    a.battle.nodes[1]!.taken = true
    expect(act(a, 'node.use').blocks!(a.run(), a.ally(1))).toEqual([])
  })

  it('防爆門：要選放在哪一格（1～4 的整數）；放下之後那一格是掩體、節點用掉；燈可以一直用，開關黑暗', () => {
    const a = nodes([{ kind: 'door', name: '防爆門' }, { kind: 'light', name: '燈' }])
    for (const slot of [undefined, 0, 5, 1.5, '2']) expect(() => use(a, { node: 'n1' }, { slot }), String(slot)).toThrow(/要選放在哪一格/)
    use(a, { node: 'n1' }, { slot: 3 })
    expect(a.battle.cover.ally[2]!.level).toBe(2)
    expect(a.battle.nodes[0]!.used).toBe(true)
    use(a, { node: 'n2' })
    expect(a.battle.field.dark).toBe(true)
    use(a, { node: 'n2' })
    expect(a.battle.field.dark).toBeUndefined()
    expect(a.battle.nodes[1]!.used).toBe(false)
    const picks = act(a, 'node.use').picks!(a.run(), a.ally(1))
    expect(picks[0]).toMatchObject({ key: 'slot', required: true })
    expect(picks[0]!.options.map((o) => o.value)).toEqual([1, 2, 3, 4])
    const lightOnly = nodes([{ kind: 'light' }])
    expect(act(lightOnly, 'node.use').picks!(lightOnly.run(), lightOnly.ally(1))).toEqual([])
  })
})
