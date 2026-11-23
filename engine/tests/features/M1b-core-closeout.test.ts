// 驗收測試：dev/work/M1b-core-closeout.md 的功能部分（features/combat）：卡彈與炸膛移進 attack.before、打掛著的東西吃特殊彈、
// 立牌吃下一擊保證倒下、快感沉溺走 gainSink（取代 takeBackSink）、fx 合併的護甲倍率相乘、道具對一個敵人用（use.target: foe）與紙鶴。
// 規格：dev/adr/0015；ITEMS 5.1、5.2 節；COMBAT_SYSTEM 第 5 節。內容一律是測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, actionCost, createKernel, performAction, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { fxOf, mergeFx } from '../../src/features/combat/fx'
import { testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(80).fill(1)]
const ITEM = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, desc: `${name}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const SINK_SAVE = { op: 'sink', amount: 1, save: { attr: 'resolve', skill: 'composure', dc: 14 } }
const PACK: ContentPack = {
  id: 'closeout_test',
  content: {
    battle_status: TEST_STATUSES,
    item: [
      ITEM('am_hollow', '空尖彈', { category: 'ammo', ammo: { fits: ['pistol', 'smg'], fx: { dice: 1, armor_mult: 2 } } }),
      ITEM('am_x', '加厚彈', { category: 'ammo', ammo: { fits: ['pistol'], fx: { armor_mult: 1.5 } } }),
      ITEM('am_honey', '蜜彈', { category: 'ammo', ammo: { fits: ['pistol', 'smg'], fx: { type: 'pleasure', dice: -2, on_hit: [SINK_SAVE] } } }),
      ITEM('it_sacrament', '聖餐', { tags: ['throwable'], use: { ap: 2, target: 'foe_slot', modes: ['meat'], effects: [{ op: 'throw', dice: 2, type: 'pleasure', on_hit: [SINK_SAVE] }] } }),
      // 紙鶴：對一個敵人用、距離 1～5、標記到他下次過載；II 級另外讓自己不受黑暗影響（到戰鬥結束）
      ITEM('it_crane1', '紙鶴', { use: { ap: 1, ap_other: 2, target: 'foe', range: [1, 5], modes: ['meat'], effects: [{ op: 'status', status: 'marked', until: 'next_overload' }] } }),
      ITEM('it_crane_near', '近距紙鶴', { use: { ap: 1, target: 'foe', range: [1, 2], modes: ['meat'], effects: [{ op: 'status', status: 'marked', until: 'next_overload' }] } }),
      ITEM('it_crane_any', '不限距離的紙鶴', { use: { ap: 1, target: 'foe', modes: ['meat'], effects: [{ op: 'status', status: 'marked', until: 'next_overload' }] } }),
      ITEM('it_decoy', '等身立牌', { use: { ap: 1, target: 'ally_slot', modes: ['meat'], effects: [{ op: 'decoy' }] } }),
    ],
  },
}
const AP = { now: 99, max: 99, regen: 3 }
const cover0 = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }
const field = (o: { allies?: unknown[]; foes?: unknown[]; prep?: (k: Kernel) => void } = {}): Arena =>
  arena(duel(o.allies ?? [one({ weapon: 'pistol', ap: AP }), one({ weapon: 'smg' }, 2), one({ weapon: 'knife' }, 3)], o.foes ?? [foe(), foe(), foe()], cover0), [combatFeature], (k) => {
    k.content.loadPack(PACK)
    o.prep?.(k)
  })
const f = (id: string): BattleTarget => ({ unit: id })
const texts = (run: { beats: Array<{ text: string }> }) => run.beats.map((b) => b.text)
const weaponOf = (u: BattleUnit) => u.weapons[u.wield]!
const withFx = (weapon: string, fx: Record<string, unknown>, o: Record<string, unknown> = {}) =>
  one({ weapons: [{ ...testWeapon(weapon, 6), ext: { fx } }], wield: 0, ap: AP, ...o })
function act(a: Arena, u: BattleUnit, id: string, target?: BattleTarget, pick?: Record<string, unknown>, d: number[] = dice()) {
  const run = a.run(d)
  performAction(run, u, a.k.battle.getAction(id)!, target ?? null, { action: id, ...(target ? { target } : {}), ...(pick ? { pick } : {}) })
  return run
}
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'drone', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
function spyRolls(run: { roll(count: number, sides: number): number[] }): Array<[number, number]> {
  const seen: Array<[number, number]> = []
  const orig = run.roll.bind(run)
  run.roll = (c, s) => (seen.push([c, s]), orig(c, s))
  return seen
}

describe('卡彈與炸膛在命中骰自然 1 之後（attack.after；M1b-review-features E4）：每一種打人的方式都吃得到', () => {
  const JAM = { on_use: { jam: 'natural1' } }

  it('技能效果清單裡的 { op: attack } 自然 1 也會卡彈：那一擊照常失手、一拍卡彈、目標不受傷、彈匣清空；不是 1 就不卡', () => {
    const a = field({ allies: [withFx('pistol', JAM)] })
    const me = a.ally(1)
    const mag = weaponOf(me).mag!
    const hp = a.foe(1).hp!.now
    const run = a.run(dice(1, 6, 6, 6))
    const seen = spyRolls(run)
    run.effects([{ op: 'attack' }], { user: me, target: f('f1'), source: { kind: 'ability', id: 'x', name: '技能' } })
    expect(texts(run)).toEqual(expect.arrayContaining(['你 的手槍卡彈了，要換彈才能再射。']))
    expect(run.beats[0]!.roll?.natural).toBe(1)
    expect(run.beats.at(-1)!.data).toMatchObject({ unit: 'a1', jam: true })
    // 只擲了命中骰（沒有另外擲百分比骰）
    expect(seen[0]).toEqual([1, 20])
    expect(seen.some(([, sides]) => sides === 100)).toBe(false)
    expect(a.foe(1).hp!.now).toBe(hp)
    expect(mag.now).toBe(0)
    // 效果清單裡的下一筆：那一擊失手，if: hit 不成立
    const b = field({ allies: [withFx('pistol', JAM)] })
    const r2 = b.run(dice(1, 6)).effects([{ op: 'attack' }, { op: 'damage', amount: 5, if: 'hit' }], { user: b.ally(1), target: f('f1'), source: { kind: 'ability', id: 'x', name: '技能' } })
    expect(r2.hit).toBeFalsy()
    expect(b.foe(1).hp!.now).toBe(b.foe(1).hp!.max)
    // 命中骰是 15：沒有卡彈，彈匣只少一格
    const c = field({ allies: [withFx('pistol', JAM)] })
    c.run(dice(15, 3, 3, 3)).effects([{ op: 'attack' }], { user: c.ally(1), target: f('f1'), source: { kind: 'ability', id: 'x', name: '技能' } })
    expect(weaponOf(c.ally(1)).mag!.now).toBe(1)
  })

  it('行動點與彈匣照以前扣：射擊花武器的行動點、掃射花 2 格彈匣；自然 1 卡彈的掃射照樣擲壓制檢定（那一擊照常結算）', () => {
    const lmg = one({ weapons: [{ ...testWeapon('smg', 6), class: 'lmg', name: '輕機槍', traits: ['sweep'], mag: { now: 4, max: 4 }, ext: { fx: JAM } }], wield: 0, ap: AP })
    const a = field({ allies: [lmg] })
    const me = a.ally(1)
    const ap = me.ap.now
    const mag = weaponOf(me).mag!
    const run = act(a, me, 'shoot', f('f1'), { sweep: true }, dice(1))
    expect(texts(run)).toEqual(expect.arrayContaining(['你 的輕機槍卡彈了，要換彈才能再射。']))
    expect(me.ap.now).toBe(ap - (weaponOf(me).ap ?? 2))
    expect(mag.now).toBe(0)
    // 普通的射擊：花一格
    const b = field({ allies: [withFx('pistol', JAM)] })
    const mag2 = weaponOf(b.ally(1)).mag!
    const full2 = mag2.now
    act(b, b.ally(1), 'shoot', f('f1'), undefined, dice(15, 3, 3, 3))
    expect(mag2.now).toBe(full2 - 1)
  })

  it('炸膛：一拍「炸膛」在前、開槍的人自己受物理傷害在後（那一擊已經失手）；彈匣照扣；特殊彈打空就作廢', () => {
    const a = field({ allies: [withFx('pistol', { on_use: { backfire: { dice: 1 } } })] })
    const me = a.ally(1)
    const hp = me.hp!.now
    const run = act(a, me, 'shoot', f('f1'), undefined, dice(1, 1, 1, 1, 6))
    const t = texts(run)
    const at = t.findIndex((x) => /炸膛/.test(x))
    expect(at).toBeGreaterThan(0)
    expect(t[at + 1]).toMatch(/受到 \d+ 點物理傷害/)
    expect(run.beats[at]!.data).toMatchObject({ backfire: true })
    expect(me.hp!.now).toBeLessThan(hp)
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    // 彈匣只剩一格的特殊彈：卡彈把最後一格用掉，特殊彈作廢
    const b = field({ allies: [withFx('pistol', JAM)] })
    const w = weaponOf(b.ally(1))
    w.mag!.now = 1
    w.ammo = 'am_hollow'
    act(b, b.ally(1), 'shoot', f('f1'), undefined, dice(1, 1, 1, 1))
    expect([w.mag!.now, w.ammo]).toEqual([0, undefined])
  })

  it('卡彈不擋反應：反應在擲骰之前（attack.before），自然 1 照樣先起反應；卡彈之後的下一擊在換彈之前射不出去', () => {
    const seen: string[] = []
    const a = field({ allies: [withFx('pistol', JAM)], prep: (k) => k.battle.on('attack.before', 'react', () => { seen.push('reaction') }) })
    act(a, a.ally(1), 'shoot', f('f1'), undefined, dice(1, 1, 1, 1))
    expect(seen).toEqual(['reaction'])
    expect(a.k.battle.getAction('shoot')!.blocks!(a.run(), a.ally(1))).toEqual(['卡彈了，要先換彈。'])
  })

  it('打掛著的東西也卡彈、也吃特殊彈（attackOverlay 發 attack.after）；技能直接 attackOverlay 也一樣', () => {
    const a = field({ allies: [withFx('pistol', JAM)] })
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const run = a.run(dice(1, 6, 6, 6, 6))
    run.attackOverlay(a.ally(1), a.battle.overlays[0]!)
    expect(texts(run)).toEqual(expect.arrayContaining(['你 的手槍卡彈了，要換彈才能再射。']))
    expect(a.battle.overlays[0]!.hp.now).toBe(20)
    // 特殊彈：空尖多一顆傷害骰
    const b = field({ allies: [one({ weapon: 'pistol', ap: AP })] })
    weaponOf(b.ally(1)).ammo = 'am_hollow'
    b.battle.overlays.push(overlay('o1', 'foe', 1))
    const r2 = b.run(dice(8, 6, 6, 6, 6))
    const seen = spyRolls(r2)
    r2.attackOverlay(b.ally(1), b.battle.overlays[0]!)
    expect(seen.filter(([, s]) => s === 6).map(([c]) => c)).toEqual([4])
  })

  it('開槍的是和人重疊的東西（替身）：炸膛傷在那一台的耐久上，不是丟掉', () => {
    const a = field({ foes: [foe(), foe(), foe()] })
    const o = overlay('o1', 'foe', 1, { weapon: { ...testWeapon('pistol', 6), mag: { now: 2, max: 2 }, ext: { fx: { on_use: { backfire: { dice: 1 } } } } } as never, hp: { now: 20, max: 20 } })
    a.battle.overlays.push(o)
    const run = a.run(dice(1, 1, 1, 1, 5))
    run.overlayAttack(o, a.ally(1))
    expect(texts(run).some((x) => /炸膛/.test(x))).toBe(true)
    expect(o.hp.now).toBeLessThan(20)
  })
})

describe('立牌：吃下一擊保證倒下', () => {
  const placed = (): Arena => {
    const a = field({ allies: [one({ weapon: 'pistol', ap: AP, quick: [{ item: 'it_decoy', qty: 1 }] }), one({ weapon: 'smg' }, 2), one({ weapon: 'knife' }, 3)] })
    act(a, a.ally(1), 'item', { side: 'ally', slot: 2 }, { item: 'it_decoy' })
    return a
  }

  it('打空（自然 1）：立牌照樣倒下，原本的目標不受影響；下一擊照常打', () => {
    const a = placed()
    const victim = a.ally(2)
    const hp = victim.hp!.now
    const run = a.run(dice(3, 3, 3))
    const r = run.attack(a.foe(1), victim, { natural: 1 })
    expect(r).toMatchObject({ redirected: true, hit: false })
    expect(a.battle.overlays[0]).toMatchObject({ kind: 'decoy', down: true, hp: { now: 0 } })
    expect(texts(run).at(-1)).toBe('等身立牌被擊落了。')
    expect(victim.hp!.now).toBe(hp)
    const second = a.run(dice(15, 3, 3, 3)).attack(a.foe(1), victim)
    expect(second.redirected).toBeUndefined()
    expect(victim.hp!.now).toBeLessThan(hp)
  })

  it('感載類的傷害（對立牌無效）、被護甲擋光的一擊也一樣：立牌倒下', () => {
    const neural = placed()
    expect(neural.run(dice(3, 3, 3)).attack(neural.foe(1), neural.ally(2), { natural: 20, type: 'neural' })).toMatchObject({ redirected: true, dealt: 0 })
    expect(neural.battle.overlays[0]!.down).toBe(true)
    const armored = placed()
    armored.battle.overlays[0]!.armor = 99
    expect(armored.run(dice(3, 3, 3)).attack(armored.foe(1), armored.ally(2), { natural: 20 })).toMatchObject({ redirected: true, dealt: 0 })
    expect(armored.battle.overlays[0]!.down).toBe(true)
  })

  it('打中也只倒下一次：overlay.down 只發一次，不會重複記「被擊落了」', () => {
    const downs: string[] = []
    const a = placed()
    a.k.battle.on('overlay.down', 't', ({ overlay: o }) => { downs.push(o.id) })
    const run = a.run(dice(6, 6, 6))
    run.attack(a.foe(1), a.ally(2), { natural: 20 })
    expect(downs).toHaveLength(1)
    expect(texts(run).filter((t) => t.includes('被擊落了'))).toHaveLength(1)
  })

  it('別的種類的掛著的東西（無人機）擋下一擊不會因此倒下', () => {
    const a = field({ prep: (k) => k.battle.on('attack.before', 'redirect', ({ opts }) => { opts.redirect = { overlay: 'o1' } }) })
    a.battle.overlays.push(overlay('o1', 'ally', 2))
    a.run(dice(6)).attack(a.foe(1), a.ally(2), { natural: 1 })
    expect(a.battle.overlays[0]!.down).toBe(false)
  })
})

describe('fx 合併：armor_mult 相乘', () => {
  it('兩邊都有才乘；只有一邊就是那一邊；都沒有就沒有這個欄位；其餘的數字照舊相加', () => {
    expect(mergeFx({ armor_mult: 2 }, { armor_mult: 2 })).toEqual({ armor_mult: 4 })
    expect(mergeFx({ armor_mult: 2 }, { armor_mult: 1.5 })).toEqual({ armor_mult: 3 })
    expect(mergeFx({ armor_mult: 2 }, { pierce: 1 })).toEqual({ armor_mult: 2, pierce: 1 })
    expect(mergeFx({ hit: 1 }, { armor_mult: 0.5 })).toEqual({ hit: 1, armor_mult: 0.5 })
    expect(mergeFx({ hit: 1 }, { dice: 1 })).toEqual({ hit: 1, dice: 1 })
    expect('armor_mult' in mergeFx({ hit: 1 }, { dice: 1 })!).toBe(false)
    expect(mergeFx({ hit: 1, dice: 2 }, { hit: 2, dice: -1 })).toEqual({ hit: 3, dice: 1 })
  })

  it('武器自己的 ×2 加上特殊彈的 ×1.5：fxOf 是 ×3，打出去的傷害照 ×3 扣護甲（不是 ×3.5）', () => {
    const a = field({ allies: [withFx('pistol', { armor_mult: 2 })], foes: [foe('minion', { armor: 4, hp: { now: 999, max: 999 } })] })
    const w = weaponOf(a.ally(1))
    w.ammo = 'am_x'
    expect(fxOf(a.k, w)).toEqual({ armor_mult: 3 })
    const r = a.run(dice(6, 6, 6, 6, 6)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r.hit).toBe(true)
    expect(r.dealt).toBe(r.raw - 12)
  })
})

describe('快感的沉溺：定力擋走 gainSink，不再先加再扣', () => {
  /** 蜜彈打一擊：骰面 命中 8、傷害 4、定力檢定 save。回傳打完之後的場面，以及 attack.after 開頭那一刻目標的沉溺。 */
  function honey(save: number, o: { block?: boolean } = {}) {
    const atAfter: number[] = []
    const asked: string[] = []
    const a = field({
      allies: [one({ weapon: 'pistol', ap: AP })],
      foes: [foe('minion')],
      prep: (k) => {
        k.battle.on('attack.after', 'early', ({ target }) => { atAfter.push(target.sink) }, -50)
        k.battle.on('sink.before', 'spy', ({ type, out }) => { asked.push(String(type)); if (o.block) out.block = true })
      },
    })
    weaponOf(a.ally(1)).ammo = 'am_honey'
    const r = a.run(dice(8, 4, save)).attack(a.ally(1), a.foe(1))
    return { a, r, atAfter, asked }
  }

  it('帶定力檢定的 sink 在 on_hit 裡：這一擊的快感不自己加沉溺（沒有先加再扣）；檢定沒過才由那一筆加', () => {
    const fail = honey(2)
    expect(fail.r.hit).toBe(true)
    expect(fail.a.foe(1).load!.now).toBeGreaterThan(0)
    expect(fail.atAfter).toEqual([0])
    // 傷害類型自己的沉溺沒有問 sink.before（noSink）；on_hit 的 sink 效果走 run.gainSink，問一次（沒有傷害類型）
    expect(fail.asked).toEqual(['undefined'])
    expect(fail.a.foe(1).sink).toBe(1)
    const pass = honey(19)
    expect(pass.atAfter).toEqual([0])
    expect(pass.a.foe(1).sink).toBe(0)
    expect(pass.a.foe(1).load!.now).toBeGreaterThan(0)
  })

  it('投擲物一樣（聖餐）：快感的沉溺由 on_hit 的定力檢定決定', () => {
    const run = (save: number) => {
      const a = field({ allies: [one({ weapon: 'pistol', ap: AP, quick: [{ item: 'it_sacrament', qty: 1 }] })], foes: [foe('minion'), foe('minion')] })
      // 骰面：投擲的命中 15（兩個目標共用）、傷害骰（要害多一顆）、之後每個被打中的人一次定力檢定
      const r = act(a, a.ally(1), 'item', { side: 'foe', slot: 1 }, { item: 'it_sacrament', also: 2 }, dice(15, 2, 2, 2, save, 2, 2, 2, save))
      return { a, r }
    }
    expect(run(2).a.foe(1).sink).toBe(1)
    const pass = run(19)
    expect(pass.a.foe(1).sink).toBe(0)
    // 感載照加（傷害照打），沉溺由檢定決定
    expect(texts(pass.r).some((t) => /敵・保全.*感載 \+\d+/.test(t))).toBe(true)
  })

  it('on_hit 沒有帶檢定的 sink（或沒有 on_hit）的快感照舊：沉溺 +1，而且是問過 sink.before 的；擋下就只有感載', () => {
    const plain = (block: boolean) => {
      const asked: string[] = []
      const a = field({
        allies: [one({ weapon: 'pistol', ap: AP })], foes: [foe('minion')],
        prep: (k) => k.battle.on('sink.before', 'spy', ({ type, out }) => { asked.push(String(type)); if (block) out.block = true }),
      })
      a.run(dice(4, 4)).attack(a.ally(1), a.foe(1), { natural: 20, type: 'pleasure' })
      return { a, asked }
    }
    const open = plain(false)
    expect([open.a.foe(1).sink, open.asked]).toEqual([1, ['pleasure']])
    const closed = plain(true)
    expect([closed.a.foe(1).sink, closed.asked, closed.a.foe(1).load!.now > 0]).toEqual([0, ['pleasure'], true])
  })

  it('效果 load（快感）也走 gainSink：沒擋加 +1，擋下不加；神經沒有沉溺', () => {
    const run = (type: string, block: boolean) => {
      const a = field({ foes: [foe('minion')], prep: (k) => k.battle.on('sink.before', 'spy', ({ out }) => { if (block) out.block = true }) })
      a.run(dice()).effects([{ op: 'load', type, amount: 5 }], { user: a.ally(1), target: f('f1'), source: { kind: 'ability', id: 'x', name: '技能' } })
      return a.foe(1)
    }
    expect(run('pleasure', false)).toMatchObject({ sink: 1 })
    expect(run('pleasure', true).sink).toBe(0)
    expect(run('pleasure', true).load!.now).toBeGreaterThan(0)
    expect(run('neural', false).sink).toBe(0)
  })
})

describe('道具對一個敵人用（use.target: foe）與紙鶴', () => {
  const cranes = (...items: string[]): Arena => field({ allies: [one({ weapon: 'pistol', ap: AP, quick: items.map((item) => ({ item, qty: 1 })) }), one({ weapon: 'smg' }, 2)], foes: [foe(), foe(), foe()] })
  const use = (a: Arena, id: string, target: BattleTarget, d?: number[]) => act(a, a.ally(1), 'item', target, { item: id }, d)

  it('從快取格用在一個敵人身上：花 use.ap（不是替別人用的 ap_other）、用掉一個、標記到那個人下次過載', () => {
    const a = cranes('it_crane1')
    const me = a.ally(1)
    const ap = me.ap.now
    const run = use(a, 'it_crane1', f('f2'))
    expect(me.ap.now).toBe(ap - 1)
    expect(me.quick).toEqual([])
    expect(a.foe(2).statuses.map((s) => [s.id, s.until])).toEqual([['marked', { at: 'overload' }]])
    expect(a.foe(1).statuses).toEqual([])
    expect(texts(run)[0]).toBe('你 使用紙鶴，用在保全身上。')
    // 被標記的人：隊友打他命中 +2
    expect(run.mods('hit_against', a.foe(2), a.ally(2)).reduce((s, p) => s + p.value, 0)).toBe(2)
    // 費用：行動列問的就是 1 點（敵人不是「相鄰的隊友」）
    const b = cranes('it_crane1')
    expect(actionCost(b.run(), b.ally(1), b.k.battle.getAction('item')!, { action: 'item', target: f('f1'), pick: { item: 'it_crane1' } }).ap).toBe(1)
    expect(actionCost(b.run(), b.ally(1), b.k.battle.getAction('item')!, { action: 'item', target: { unit: 'a2' }, pick: { item: 'it_crane1' } }).ap).toBe(2)
  })

  it('到他下次過載就結束：過載的那一刻拿掉；沒過載就一直在（到戰鬥結束）', () => {
    const a = cranes('it_crane1')
    const run = use(a, 'it_crane1', f('f1'))
    for (let i = 0; i < 3; i++) run.addLoad(a.foe(2), 0)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
    run.addLoad(a.foe(1), 99999)
    // 過載之後只剩失去回合：標記拿掉了
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['lose_turn'])
    expect(texts(run).some((t) => /的標記結束了。$/.test(t))).toBe(true)
  })

  it('距離：use.range 之外的敵人在 targets 裡灰掉、寫出一句原因；硬用也擋下；沒寫 range 不限距離', () => {
    const a = cranes('it_crane_near')
    const def = a.k.battle.getAction('item')!
    const t = def.targets!(a.run(), a.ally(1)).filter((x) => 'unit' in x.target && x.target.unit.startsWith('f'))
    // 我在第 1 格：f1 距離 1、f2 距離 2、f3 距離 3
    expect(t.map((x) => [x.target, x.blocks])).toEqual([
      [f('f1'), []],
      [f('f2'), []],
      [f('f3'), ['這個道具只用得到距離 1～2 的敵人，這個人的距離是 3。']],
    ])
    expect(() => use(a, 'it_crane_near', f('f3'))).toThrow(BattleBlocked)
    expect(() => use(a, 'it_crane_near', f('f3'))).toThrow(/距離 1～2.*距離是 3/)
    expect(a.ally(1).quick).toHaveLength(1)
    expect(() => use(a, 'it_crane_near', f('f2'))).not.toThrow()
    // 沒寫 range：第 3 格的人也用得到
    const b = cranes('it_crane_any')
    expect(() => use(b, 'it_crane_any', f('f3'))).not.toThrow()
    // 站在第 2 格的人用同一個東西，距離不同（雙方站位 + 1）：從 a2 看，f2 是距離 3
    const c = cranes('it_crane_near')
    c.ally(2).quick = [{ item: 'it_crane_near', qty: 1 }]
    expect(() => act(c, c.ally(2), 'item', f('f2'), { item: 'it_crane_near' })).toThrow(/距離是 3/)
  })

  it('目標要是在場上的敵人：隊友、自己、格子、已經退出的人都擋下；選項（picks）適用場上每一個敵人', () => {
    const a = cranes('it_crane1')
    expect(() => use(a, 'it_crane1', { unit: 'a2' })).toThrow(/要用在一個敵人身上/)
    expect(() => use(a, 'it_crane1', { unit: 'a1' })).toThrow(/要用在一個敵人身上/)
    expect(() => use(a, 'it_crane1', { side: 'foe', slot: 1 })).toThrow(/要用在一個敵人身上/)
    a.foe(3).out = 'down'
    expect(() => use(a, 'it_crane1', f('f3'))).toThrow(/不在場上/)
    const picks = a.k.battle.getAction('item')!.picks!(a.run(), a.ally(1))
    expect(picks[0]!.options).toMatchObject([{ value: 'it_crane1', blocks: [], for: [f('f1'), f('f2')] }])
    // 沒有對一個敵人用的道具時，targets 裡沒有敵人（舊的行為不變）
    const none = field({ allies: [one({ weapon: 'pistol', ap: AP, quick: [{ item: 'it_decoy', qty: 1 }] })] })
    expect(none.k.battle.getAction('item')!.targets!(none.run(), none.ally(1)).filter((x) => 'unit' in x.target && x.target.unit.startsWith('f'))).toEqual([])
  })

  it('載入檢查：use.range 要是 [近, 遠] 的兩個整數，而且只有對一個敵人用的道具才能寫', () => {
    const load = (use: Record<string, unknown>) => {
      const k = createKernel([combatFeature])
      k.content.loadPack({ id: 'bad', content: { battle_status: TEST_STATUSES, item: [ITEM('it_b', '壞紙鶴', { use: { ap: 1, effects: [{ op: 'status', status: 'marked' }], ...use } })] } })
      return () => readyFeatures(k)
    }
    const ok = (use: Record<string, unknown>) => {
      const k = createKernel([combatFeature])
      return () => k.content.loadPack({ id: 'bad', content: { battle_status: TEST_STATUSES, item: [ITEM('it_b', '壞紙鶴', { use: { ap: 1, effects: [{ op: 'status', status: 'marked' }], ...use } })] } })
    }
    expect(load({ target: 'foe', range: [1, 5] })).not.toThrow()
    expect(load({ target: 'foe' })).not.toThrow()
    expect(ok({ target: 'foe', range: [0, 5] })).toThrow(/use\.range/)
    expect(ok({ target: 'foe', range: [3, 2] })).toThrow(/use\.range/)
    expect(ok({ target: 'foe', range: [1] })).toThrow(/use\.range/)
    expect(ok({ target: 'foe', range: [1.5, 2] })).toThrow(/use\.range/)
    expect(ok({ target: 'ally', range: [1, 2] })).toThrow(/use\.range.*foe/)
  })
})
