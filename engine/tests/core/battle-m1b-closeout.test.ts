// 驗收測試：dev/work/M1b-core-closeout.md 的核心部分（掛著的東西的傷害入口、attack.before 取消這一擊、改打結算之後的掛點、
// 打掛著的東西也發 attack.before、沉溺的加法有一個擋得下的入口、到下次過載的狀態、資源池的中文名）。
// 規格：dev/adr/0015 第二、三節與 M1b-core-closeout 的實作補記。效果、掛點與規則表的狀態都是測試裡臨時註冊、自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, Feature, Kernel } from '../../src'
import { POOL_NAMES, STATUS_UNTILS, battleProblems, beginTurn, clone, poolName, poolShort } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, makeBattleGame } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(60).fill(1)]
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'shield', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
/** 數這個 run 擲了幾次骰（用來證明「沒有擲任何骰」）。 */
function counted(run: { roll(count: number, sides: number): number[] }): { n: number } {
  const seen = { n: 0 }
  const orig = run.roll.bind(run)
  run.roll = (c, s) => (seen.n++, orig(c, s))
  return seen
}
/** 敵方第 1 格掛一台的場地（沒有遮蔽）。 */
const hung = (o: Partial<BattleOverlay> = {}, prepare?: (k: Kernel) => void, foes: unknown[] = [foe('elite')]): Arena => {
  const a = arena(duel([one({ weapon: 'pistol' })], foes), undefined, (k) => {
    k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES } })
    prepare?.(k)
  })
  a.battle.overlays.push(overlay('o1', 'foe', 1, o))
  return a
}

describe('run.damageOverlay：掛著的東西的直接傷害', () => {
  it('護甲照扣、穿甲抵銷護甲、armorMult 乘在它的護甲上；耐久照扣', () => {
    const a = hung({ armor: 3, hp: { now: 99, max: 99 } })
    const o = a.battle.overlays[0]!
    const run = a.run()
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1))).toEqual({ dealt: 7, downed: false })
    expect(o.hp.now).toBe(92)
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1), { pierce: 2 }).dealt).toBe(9)
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1), { armorMult: 2 }).dealt).toBe(4)
    // 穿甲抵銷的只有護甲：護甲 3、穿甲 9 也不會多出傷害
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1), { pierce: 9 }).dealt).toBe(10)
    expect(o.hp.now).toBe(99 - 7 - 9 - 4 - 10)
  })

  it('傷害類型照規則表：電磁不看護甲、對機器加倍；熱能護甲只算一半；做的人的傷害倍率照乘', () => {
    const a = hung({ armor: 4, hp: { now: 99, max: 99 } })
    const o = a.battle.overlays[0]!
    const run = a.run()
    expect(run.damageOverlay(o, 5, 'em', a.ally(1)).dealt).toBe(10)
    expect(run.damageOverlay(o, 10, 'thermal', a.ally(1)).dealt).toBe(8)
    // 精英敵人的傷害倍率 0.6：10 × 0.6 = 6（護甲 0）
    const b = hung({ armor: 0, hp: { now: 99, max: 99 } })
    expect(b.run().damageOverlay(b.battle.overlays[0]!, 10, 'physical', b.foe(1)).dealt).toBe(6)
  })

  it('和 attackOverlay 是同一份算法：同一個擲出來的量，打出來的傷害一樣', () => {
    const a = hung({ armor: 2 })
    const r = a.run(dice(4, 5, 6)).attackOverlay(a.ally(1), a.battle.overlays[0]!, { natural: 20, pierce: 1 })
    expect(r.hit).toBe(true)
    const b = hung({ armor: 2 })
    const w = a.ally(1).weapons[0]!
    expect(b.run().damageOverlay(b.battle.overlays[0]!, r.raw, w.type, b.ally(1), { pierce: w.pierce + 1 }).dealt).toBe(r.dealt)
  })

  it('感載類的傷害對它無效（沒有橋）：記一拍、耐久不變、不算擊落', () => {
    const a = hung()
    const run = a.run()
    expect(run.damageOverlay(a.battle.overlays[0]!, 50, 'neural', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(a.battle.overlays[0]!.hp.now).toBe(20)
    expect(run.beats.map((b) => b.text)).toEqual(['o1沒有橋，神經傷害對它無效。'])
  })

  it('耐久歸零：擊落（down、overlay.down 掛點、一拍「被擊落了」）；已經擊落的什麼都不做；護甲擋光記一句', () => {
    const downs: string[] = []
    const a = hung({ hp: { now: 5, max: 5 }, armor: 5 }, (k) => k.battle.on('overlay.down', 't', ({ overlay: o, by }) => { downs.push(`${o.id}:${by?.id}`) }))
    const o = a.battle.overlays[0]!
    const run = a.run()
    expect(run.damageOverlay(o, 4, 'physical', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(run.beats.at(-1)!.text).toBe('o1的護甲擋下了這一擊。')
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1))).toEqual({ dealt: 5, downed: true })
    expect(o).toMatchObject({ down: true, hp: { now: 0 } })
    expect(downs).toEqual(['o1:a1'])
    expect(run.beats.map((b) => b.tag)).toEqual(['damage', 'damage', 'overlay.down'])
    const beats = run.beats.length
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(run.beats).toHaveLength(beats)
  })
})

describe('AttackOpts.cancel：attack.before 取消這一擊', () => {
  const jam = (seen: { late: number; after: number; cancel: string[]; beatsAtCancel: string[] }): ((k: Kernel) => void) => (k) => {
    k.battle.on('attack.before', 'jam', ({ opts }) => { opts.cancel = '槍卡住了，這一擊沒有打出去。'; opts.cancelData = { jam: true } }, -10)
    k.battle.on('attack.before', 'late', () => { seen.late += 1 })
    k.battle.on('attack.after', 't', () => { seen.after += 1 })
    k.battle.on('attack.cancel', 't', ({ run, reason }) => { seen.cancel.push(reason); seen.beatsAtCancel.push(...run.beats.map((b) => b.text)) })
  }
  const fresh = () => ({ late: 0, after: 0, cancel: [] as string[], beatsAtCancel: [] as string[] })
  const field = (seen: ReturnType<typeof fresh>) => arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, jam(seen))

  it('不擲任何骰、不發 attack.after、後面的 attack.before 處理函式不再跑、目標不受影響；一拍（那一句話與資料），結果 aborted 並帶 cancelled', () => {
    const seen = fresh()
    const a = field(seen)
    const run = a.run(dice(20, 6, 6, 6, 6))
    const rolled = counted(run)
    const r = run.attack(a.ally(1), a.foe(1))
    expect(r).toMatchObject({ aborted: true, cancelled: '槍卡住了，這一擊沒有打出去。', hit: false, dealt: 0, downed: false })
    expect(rolled.n).toBe(0)
    expect(seen).toMatchObject({ late: 0, after: 0 })
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    expect(run.beats).toHaveLength(1)
    expect(run.beats[0]).toMatchObject({ text: '槍卡住了，這一擊沒有打出去。', data: { attacker: 'a1', target: 'f1', weapon: 'pistol', cancelled: true, jam: true } })
    expect(run.beats[0]!.roll).toBeUndefined()
  })

  it('彈匣照扣（扣在 attack.before 之前）；spend: 0 的不扣；attack.cancel 在那一拍記完之後才發、帶著那一句話', () => {
    const seen = fresh()
    const a = field(seen)
    const mag = a.ally(1).weapons[0]!.mag!
    const full = mag.now
    a.run(dice(15)).attack(a.ally(1), a.foe(1))
    expect(mag.now).toBe(full - 1)
    expect(seen.cancel).toEqual(['槍卡住了，這一擊沒有打出去。'])
    expect(seen.beatsAtCancel).toEqual(['槍卡住了，這一擊沒有打出去。'])
    a.run(dice(15)).attack(a.ally(1), a.foe(1), { spend: 0 })
    expect(mag.now).toBe(full - 1)
    a.run(dice(15)).attack(a.ally(1), a.foe(1), { spend: 2 })
    expect(mag.now).toBe(Math.max(0, full - 3))
  })

  it('沒有人取消的一擊照常打（不多一拍、不發 attack.cancel）', () => {
    const seen = fresh()
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, (k) => {
      k.battle.on('attack.cancel', 't', ({ reason }) => { seen.cancel.push(reason) })
    })
    const run = a.run(dice(4, 4, 4))
    const r = run.attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r.cancelled).toBeUndefined()
    expect(r.hit).toBe(true)
    expect(seen.cancel).toEqual([])
  })

  it('玩家的一步也一樣：行動做完，行動點照扣、目標不受傷', () => {
    const seen = fresh()
    const { game } = makeBattleGame({ features: [TEST_COMBAT, { id: 'jam', install: jam(seen) } as Feature], battle: duel([one({ weapon: 'pistol' })], [foe()]), seed: 4 })
    const b = game.state.battle!
    b.turn = b.order.indexOf('a1')
    const u = b.units.a1!
    u.ap.now = u.ap.max
    const ap = u.ap.now
    const hp = b.units.f1!.hp!.now
    const r = game.battleAct({ action: 'test.attack', target: { unit: 'f1' } })
    expect(r.status).not.toBe('refused')
    expect(game.state.battle!.units.a1!.ap.now).toBeLessThan(ap)
    expect(game.state.battle!.units.f1!.hp!.now).toBe(hp)
    expect(seen.cancel).toHaveLength(1)
  })
})

describe('attack.redirected：改打結算之後的掛點', () => {
  const redirecting = (log: Array<Record<string, unknown>>, afters: number[]) => (k: Kernel) => {
    k.battle.on('attack.before', 't', ({ opts }) => { opts.redirect = { overlay: 'o1' } })
    k.battle.on('attack.redirected', 't', ({ target, overlay: o, result, weapon, attacker }) => { log.push({ target: target.id, overlay: o.id, attacker: attacker.id, weapon: weapon.id, redirected: result.redirected, hit: result.hit, downed: result.downed, hp: o.hp.now }) })
    k.battle.on('attack.after', 't', () => { afters.push(1) })
  }

  it('打中：帶原本的目標、吃下這一擊的那一台與它的結果；不發 attack.after；原本的目標不受影響；彈匣只扣一次', () => {
    const log: Array<Record<string, unknown>> = []
    const afters: number[] = []
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, redirecting(log, afters))
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const mag = a.ally(1).weapons[0]!.mag!
    const full = mag.now
    const r = a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r).toMatchObject({ redirected: true, hit: true })
    expect(log).toEqual([{ target: 'f1', overlay: 'o1', attacker: 'a1', weapon: 'pistol', redirected: true, hit: true, downed: false, hp: 20 - r.dealt }])
    expect(afters).toEqual([])
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    expect(mag.now).toBe(full - 1)
  })

  it('打空（自然 1）、感載類的傷害（對它無效）也發；擊落時發的時候那一台已經 down', () => {
    const log: Array<Record<string, unknown>> = []
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, redirecting(log, []))
    a.battle.overlays.push(overlay('o1', 'foe', 1, { evade: 99 }))
    const miss = a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 1 })
    expect(miss).toMatchObject({ redirected: true, hit: false })
    const neural = a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20, type: 'neural' })
    expect(neural).toMatchObject({ redirected: true, hit: true, dealt: 0 })
    expect(log.map((l) => [l.hit, l.hp])).toEqual([[false, 20], [true, 20]])
    const b = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, (k) => {
      redirecting(log, [])(k)
      k.battle.on('attack.redirected', 'down', ({ overlay: o }) => { log.push({ downSeen: o.down }) })
    })
    b.battle.overlays.push(overlay('o1', 'foe', 1, { hp: { now: 1, max: 1 } }))
    expect(b.run(dice(6, 6, 6)).attack(b.ally(1), b.foe(1), { natural: 20 }).downed).toBe(true)
    expect(log.at(-1)).toEqual({ downSeen: true })
  })

  it('沒有改打的一擊、找不到那一台的一擊都不發', () => {
    const log: Array<Record<string, unknown>> = []
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, redirecting(log, []))
    a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(log).toEqual([])
    expect(a.foe(1).hp!.now).toBeLessThan(a.foe(1).hp!.max)
  })
})

describe('attackOverlay 也發 attack.before', () => {
  interface Seen { before: Array<{ target: string; overlay: unknown; standIn: boolean; weapon: string; mag: number | undefined }>; after: string[]; cancel: string[]; order: string[] }
  const spy = (seen: Seen, hook?: (opts: import('../../src').AttackOpts) => void) => (k: Kernel) => {
    k.battle.on('attack.before', 't', ({ run, target, weapon, opts }) => {
      seen.before.push({ target: target.id, overlay: target.ext.overlay, standIn: run.isStandIn(target), weapon: weapon.id, mag: weapon.mag?.now })
      seen.order.push('before')
      hook?.(opts)
    })
    k.battle.on('attack.after', 't', ({ target }) => { seen.after.push(target.id); seen.order.push('after') })
    k.battle.on('attack.cancel', 't', ({ target, reason }) => { seen.cancel.push(`${target.id}:${reason}`) })
  }
  const fresh = (): Seen => ({ before: [], after: [], cancel: [], order: [] })

  it('目標是那一台的替身；彈匣先扣、之後才發；之後發 attack.after（同一個替身）', () => {
    const seen = fresh()
    const a = hung({}, spy(seen))
    const mag = a.ally(1).weapons[0]!.mag!
    const full = mag.now
    const r = a.run(dice(4, 4, 4)).attackOverlay(a.ally(1), a.battle.overlays[0]!, { natural: 20 })
    expect(r.hit).toBe(true)
    expect(seen.before).toEqual([{ target: 'o1', overlay: 'o1', standIn: true, weapon: 'pistol', mag: full - 1 }])
    expect(seen.after).toEqual(['o1'])
    expect(seen.order).toEqual(['before', 'after'])
    expect(mag.now).toBe(full - 1)
  })

  it('run.attack 的目標是替身時走同一條路：只發一次', () => {
    const seen = fresh()
    const a = hung({}, spy(seen))
    const run = a.run(dice(4, 4, 4))
    run.attack(a.ally(1), run.standIn(a.battle.overlays[0]!), { natural: 20 })
    expect(seen.order).toEqual(['before', 'after'])
  })

  it('處理函式改 opts 會影響這一擊（固定傷害 +5）', () => {
    const plain = hung({ hp: { now: 99, max: 99 } })
    const base = plain.run(dice(4, 4, 4)).attackOverlay(plain.ally(1), plain.battle.overlays[0]!, { natural: 20 })
    const seen = fresh()
    const a = hung({ hp: { now: 99, max: 99 } }, spy(seen, (opts) => { opts.damage = (opts.damage ?? 0) + 5 }))
    const r = a.run(dice(4, 4, 4)).attackOverlay(a.ally(1), a.battle.overlays[0]!, { natural: 20 })
    expect(r.dealt).toBe(base.dealt + 5)
  })

  it('opts.cancel：不擲骰、不發 attack.after、一拍、彈匣已扣、那一台不受影響、aborted；attack.cancel 的目標是替身', () => {
    const seen = fresh()
    const a = hung({}, spy(seen, (opts) => { opts.cancel = '槍卡住了。' }))
    const run = a.run(dice(15, 6, 6))
    const rolled = counted(run)
    const mag = a.ally(1).weapons[0]!.mag!
    const full = mag.now
    const r = run.attackOverlay(a.ally(1), a.battle.overlays[0]!)
    expect(r).toMatchObject({ aborted: true, cancelled: '槍卡住了。' })
    expect(rolled.n).toBe(0)
    expect(seen.after).toEqual([])
    expect(seen.cancel).toEqual(['o1:槍卡住了。'])
    expect(a.battle.overlays[0]!.hp.now).toBe(20)
    expect(mag.now).toBe(full - 1)
    expect(run.beats).toHaveLength(1)
    expect(run.beats[0]).toMatchObject({ text: '槍卡住了。', data: { attacker: 'a1', overlay: 'o1', cancelled: true } })
  })

  it('不看 opts.redirect：打的就是這一台；已經擊落的不發 attack.before、回傳 aborted', () => {
    const seen = fresh()
    const a = hung({}, spy(seen, (opts) => { opts.redirect = { overlay: 'o2' } }))
    a.battle.overlays.push(overlay('o2', 'foe', 2))
    const r = a.run(dice(4, 4, 4)).attackOverlay(a.ally(1), a.battle.overlays[0]!, { natural: 20 })
    expect(r.redirected).toBeUndefined()
    expect(a.battle.overlays.map((o) => o.hp.now < 20)).toEqual([true, false])
    a.battle.overlays[0]!.down = true
    const before = seen.before.length
    expect(a.run(dice(4, 4, 4)).attackOverlay(a.ally(1), a.battle.overlays[0]!)).toMatchObject({ aborted: true })
    expect(seen.before).toHaveLength(before)
  })

  it('反應把攻擊的人打倒：這一擊沒有發生（aborted、不發 attack.after）', () => {
    const seen = fresh()
    const a = hung({}, (k) => {
      spy(seen)(k)
      k.battle.on('attack.before', 'killer', ({ run, attacker }) => { run.setOut(attacker, 'down') })
    })
    const r = a.run(dice(4, 4, 4)).attackOverlay(a.ally(1), a.battle.overlays[0]!, { natural: 20 })
    expect(r.aborted).toBe(true)
    expect(seen.after).toEqual([])
    expect(a.battle.overlays[0]!.hp.now).toBe(20)
  })
})

describe('run.gainSink 與 sink.before：沉溺的加法有一個擋得下的入口', () => {
  it('不擋：加上去、回傳實際加了多少、不記拍；非正數、已經退出的、替身沒有作用', () => {
    const a = arena(duel([one()], [foe()]))
    const run = a.run()
    expect(run.gainSink(a.foe(1), 2)).toBe(2)
    expect(a.foe(1).sink).toBe(2)
    expect(run.beats).toEqual([])
    expect(run.gainSink(a.foe(1), 0)).toBe(0)
    expect(run.gainSink(a.foe(1), -3)).toBe(0)
    expect(a.foe(1).sink).toBe(2)
    a.foe(1).out = 'down'
    expect(run.gainSink(a.foe(1), 1)).toBe(0)
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const stand = run.standIn(a.battle.overlays[0]!)
    expect(run.gainSink(stand, 3)).toBe(0)
    expect(stand.sink).toBe(0)
  })

  it('sink.before 帶著對象、量、傷害類型、做的人；處理函式設 out.block 就不加（回傳 0）；可以只擋某一種', () => {
    const seen: Array<{ unit: string; amount: number; type?: string; by?: string }> = []
    const a = arena(duel([one()], [foe()]), undefined, (k) => {
      k.battle.on('sink.before', 'composure', ({ unit, amount, type, by, out }) => {
        seen.push({ unit: unit.id, amount, ...(type ? { type } : {}), ...(by ? { by: by.id } : {}) })
        if (type === 'pleasure') out.block = true
      })
    })
    const run = a.run()
    expect(run.gainSink(a.foe(1), 2, { type: 'pleasure', by: a.ally(1) })).toBe(0)
    expect(a.foe(1).sink).toBe(0)
    expect(run.gainSink(a.foe(1), 2, { type: 'neural' })).toBe(2)
    expect(seen).toEqual([{ unit: 'f1', amount: 2, type: 'pleasure', by: 'a1' }, { unit: 'f1', amount: 2, type: 'neural' }])
  })

  it('damage() 的快感：感載照加，沉溺 +1 走 sink.before；擋下就只有感載；noSink 略過掛點、不加', () => {
    let asked = 0
    let block = false
    const a = arena(duel([one()], [foe()]), undefined, (k) => k.battle.on('sink.before', 't', ({ out }) => { asked += 1; if (block) out.block = true }))
    const run = a.run()
    const hit = (o: { noSink?: boolean } = {}) => run.damage(a.foe(1), 10, 'pleasure', a.ally(1), o)
    expect(hit()).toMatchObject({ track: 'load' })
    expect([a.foe(1).sink, asked]).toEqual([1, 1])
    block = true
    expect(hit()).toMatchObject({ track: 'load' })
    expect([a.foe(1).sink, asked, a.foe(1).load!.now > 10]).toEqual([1, 2, true])
    block = false
    hit({ noSink: true })
    expect([a.foe(1).sink, asked]).toEqual([1, 2])
    // 神經沒有沉溺：不問
    run.damage(a.foe(1), 5, 'neural', a.ally(1))
    expect(asked).toBe(2)
  })

  it('AttackOpts.noSink：這一擊的快感不加沉溺（感載照加）；沒寫的照加', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]))
    a.run(dice(4, 4)).attack(a.ally(1), a.foe(1), { natural: 20, type: 'pleasure', noSink: true })
    expect([a.foe(1).sink, a.foe(1).load!.now > 0]).toEqual([0, true])
    a.run(dice(4, 4)).attack(a.ally(1), a.foe(1), { natural: 20, type: 'pleasure' })
    expect(a.foe(1).sink).toBe(1)
  })
})

describe('到下次過載（until: next_overload）', () => {
  const PACK = { id: 'p', content: { battle_status: [...TEST_STATUSES, { id: 'watched', name: '被盯上', desc: '被盯上：到下次過載。', until: 'next_overload', turns: 1, kind: 'mark' }] } }
  const field = () => arena(duel([one(), one({}, 2)], [foe(), foe()]), undefined, (k) => k.content.loadPack(PACK))

  it('STATUS_UNTILS 有 next_overload；狀態資料的預設結束時間也能寫它；給上去的是 { at: overload }', () => {
    expect(STATUS_UNTILS).toContain('next_overload')
    const a = field()
    const run = a.run()
    run.applyStatus(a.foe(1), 'watched')
    run.applyStatus(a.foe(2), 'marked', { until: 'next_overload' })
    expect(a.foe(1).statuses[0]).toMatchObject({ id: 'watched', until: { at: 'overload' } })
    expect(a.foe(2).statuses[0]).toMatchObject({ id: 'marked', until: { at: 'overload' } })
    expect(battleProblems(a.battle)).toEqual([])
    // 存讀檔往返：狀態還在、形狀一樣
    expect(clone(a.battle).units.f2!.statuses[0]!.until).toEqual({ at: 'overload' })
  })

  it('帶著它的人過載的那一刻拿掉（記一拍「結束了」）；別人過載、他的回合開始與結束都不拿', () => {
    const a = field()
    const run = a.run()
    run.applyStatus(a.foe(1), 'marked', { until: 'next_overload' })
    run.addLoad(a.foe(2), 99999)
    expect(a.foe(2).layers).toBe(1)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
    beginTurn(run, a.foe(1))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
    const n = run.beats.length
    run.addLoad(a.foe(1), 99999)
    expect(a.foe(1).statuses.map((s) => s.id)).not.toContain('marked')
    expect(run.beats.slice(n).map((b) => b.tag)).toContain('status.end')
    expect(run.beats.slice(n).find((b) => b.tag === 'status.end')!.text).toMatch(/的標記結束了。$/)
  })

  it('餘韻疊滿、這一次過載會昏過去的也拿掉；沒有過載就留到戰鬥結束（不寫「結束時間」的狀態在核心不會自己消失）', () => {
    const a = field()
    const run = a.run()
    run.applyStatus(a.foe(1), 'marked', { until: 'next_overload' })
    a.foe(1).layers = a.foe(1).layersMax
    run.addLoad(a.foe(1), 99999)
    expect(a.foe(1).out).toBe('burnout')
    expect(a.foe(1).statuses.some((s) => s.id === 'marked')).toBe(false)
    const b = field()
    b.run().applyStatus(b.foe(1), 'marked', { until: 'next_overload' })
    for (let i = 0; i < 3; i++) beginTurn(b.run(), b.foe(1))
    expect(b.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
  })
})

describe('資源池的中文名（「不夠」那一句）', () => {
  it('名字表：行動點、RAM、現金、三種人情；沒列的池用它自己的鍵；poolShort 的句子格式', () => {
    expect(POOL_NAMES).toEqual({ ap: '行動點', ram: 'RAM', cash: '現金', favor_small: '小人情', favor_mid: '中人情', favor_big: '大人情' })
    expect(poolName('mana')).toBe('mana')
    expect(poolShort('cash', 500, 300)).toBe('現金不夠（要 500，現在 300）。')
    expect(poolShort('ram', 9, 4)).toBe('RAM 不夠（要 9，現在 4）。')
    expect(poolShort('favor_big', 1, 0)).toBe('大人情不夠（要 1，現在 0）。')
  })

  it('行動列表的灰掉原因用中文名；句子格式不變；不夠的每一種各一句', () => {
    const extra: Feature = {
      id: 'extra',
      install: (k) => {
        k.battle.action({ id: 'buy', owner: 'extra', name: '買通', desc: 'x', group: 'tactic', icon: 'item', target: 'none', cost: () => ({ ap: 1, cash: 500, favor_small: 1, favor_mid: 1, favor_big: 1, ram: 3, mana: 2 }), run: () => {} })
      },
    }
    const { game } = makeBattleGame({ features: [TEST_COMBAT, extra], battle: BATTLE_SETUPS.encounter(), seed: 3 })
    const b = game.state.battle!
    b.turn = b.order.indexOf('a1')
    const me = b.units.a1!
    me.ap.now = me.ap.max
    const pool = (now: number) => ({ now, max: 999, regen: 0 })
    me.pools = { cash: pool(300), favor_small: pool(1), favor_mid: pool(0), ram: pool(1) }
    const buy = game.battleOptions()!.actions.find((a) => a.id === 'buy')!
    expect(buy.ok).toBe(false)
    expect(buy.blocks).toEqual([
      '現金不夠（要 500，現在 300）。',
      '中人情不夠（要 1，現在 0）。',
      '大人情不夠（要 1，現在 0）。',
      'RAM 不夠（要 3，現在 1）。',
      'mana 不夠（要 2，現在 0）。',
    ])
    // 夠了的池不寫；行動點的句子照舊
    me.ap.now = 0
    expect(game.battleOptions()!.actions.find((a) => a.id === 'buy')!.blocks[0]).toBe('行動點不夠（要 1 點，現在 0 點）。')
  })
})

describe('BATTLE_EVENTS 不需要新事件：取消那一拍沒有標籤', () => {
  it('取消的那一拍沒有 tag（資料帶 cancelled: true）', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, (k) => k.battle.on('attack.before', 't', ({ opts }) => { opts.cancel = '卡住了。' }))
    const run = a.run(dice(15))
    run.attack(a.ally(1), a.foe(1))
    expect(run.beats[0]!.tag).toBeUndefined()
  })
})
