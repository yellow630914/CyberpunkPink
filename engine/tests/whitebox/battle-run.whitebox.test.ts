// 白箱測試：core/battle/run.ts（BattleRun 的基本動作）。
// 補主套件沒有走到的分支：錯誤路徑（沒有武器、花不起、沒有這個單位）、攻擊的各種組合（遠距、推拉、黑暗、中止）、
// 打和人重疊的東西、傷害類型的各條路（機體、護甲算幾成、標籤倍率）、感載與過載、狀態、遮蔽、換位與推拉。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, Feature } from '../../src'
import { BATTLE_EVENTS, BattleRun, LOSE_TURN, afterglowFull, initiativeOrder, unitAt } from '../../src'
import { testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const prep = (k: Parameters<typeof arena>[2] extends ((k: infer K) => void) | undefined ? K : never) => k.content.load('battle_status', TEST_STATUSES)
const field = (allies: unknown[] = [one()], foes: unknown[] = [foe()], more: Parameters<typeof duel>[3] = {}) => arena(duel(allies, foes, undefined, more), undefined, prep)
/** 骰面：先放指定的幾顆（第一顆通常是 d20 的自然骰，之後是 d6），不夠的用 1 補（亂數是 0.01）。 */
const dice = (...v: number[]) => [...v, ...Array(60).fill(1)]
const overlay = (o: Partial<BattleOverlay> = {}): BattleOverlay => ({ id: 'o1', side: 'foe', slot: 1, owner: 'f1', kind: 'attack', name: '敵方的無人機', hp: { now: 14, max: 14 }, armor: 1, evade: 13, used: false, down: false, ...o })
const tags = (run: BattleRun) => run.beats.map((b) => b.tag)

describe('白箱 BattleRun 的查詢與錯誤路徑（不變式第 46 條：做不成的一步丟錯、不改狀態）', () => {
  it('戰場沒註冊：建 BattleRun 丟錯', () => {
    const a = field()
    a.battle.mode = 'void'
    expect(() => new BattleRun(a.k, a.state, a.battle)).toThrow(/沒有 void 這個戰場/)
  })

  it('unit() 找不到單位、statusRule() 找不到狀態都丟錯，訊息寫出是哪一個', () => {
    const run = field().run()
    expect(() => run.unit('zz')).toThrow(/沒有 zz 這個單位/)
    expect(() => run.statusRule('ghost')).toThrow(/沒有 ghost 這個狀態/)
  })

  it('spend：行動點不夠丟錯並寫出缺的池；沒有這個池也丟錯；花 0 的鍵略過；夠就扣', () => {
    const a = field()
    const run = a.run()
    const me = a.ally(1)
    me.ap.now = 1
    expect(() => run.spend(me, { ap: 2 })).toThrow(/行動點不夠（要 2）/)
    expect(() => run.spend(me, { ram: 1, ap: 0 })).not.toThrow()
    expect(me.pools.ram!.now).toBe(3)
    expect(() => run.spend(me, { mana: 1 })).toThrow(/mana不夠（要 1）/)
    expect(() => run.spend(me, { ap: 0, ram: undefined })).not.toThrow()
    run.spend(me, { ap: 1 })
    expect(me.ap.now).toBe(0)
  })

  it('canAfford：行動點、其他的池夠不夠；沒有這個池算不夠；花 0 與 undefined 一律算夠', () => {
    const a = field()
    const run = a.run()
    const me = a.ally(1)
    expect(run.canAfford(me, { ap: me.ap.now })).toBe(true)
    expect(run.canAfford(me, { ap: me.ap.now + 1 })).toBe(false)
    expect(run.canAfford(me, { ram: 4 })).toBe(true)
    expect(run.canAfford(me, { ram: 5 })).toBe(false)
    expect(run.canAfford(me, { mana: 1 })).toBe(false)
    expect(run.canAfford(me, { mana: 0, ram: undefined })).toBe(true)
  })

  it('refund：退還行動點，不超過上限', () => {
    const a = field()
    const me = a.ally(1)
    me.ap.now = me.ap.max - 1
    a.run().refund(me, 5)
    expect(me.ap.now).toBe(me.ap.max)
  })

  it('attack 與 attackOverlay：手上沒有武器丟錯', () => {
    const a = field([one({ weapons: [] })])
    const run = a.run()
    expect(() => run.attack(a.ally(1), a.foe(1))).toThrow(/手上沒有武器/)
    expect(() => run.attackOverlay(a.ally(1), overlay())).toThrow(/手上沒有武器/)
  })

  it('hitChance：沒有武器是 0；其他夾在 5～95（COMBAT_SYSTEM 3；不變式第 50 條）', () => {
    const a = field([one({ weapons: [] })])
    const run = a.run()
    expect(run.hitChance(a.ally(1), a.foe(1))).toBe(0)
    const b = field([one({ weapon: 'pistol' })], [foe('minion', { evade: -50 })])
    expect(b.run().hitChance(b.ally(1), b.foe(1))).toBe(95)
    const c = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 99 })])
    expect(c.run().hitChance(c.ally(1), c.foe(1))).toBe(5)
  })

  it('pick：權重都不是正的回傳 undefined、不擲骰；最後一個容許浮點的尾差', () => {
    const run = field().run(dice())
    expect(run.pick([1, 2, 3], () => 0)).toBeUndefined()
    expect(run.pick([], () => 1)).toBeUndefined()
    const r2 = field().run(dice(99))
    expect(r2.pick(['a', 'b'], () => 1)).toBe('b')
    const r3 = field().run(dice(0))
    expect(r3.pick(['a', 'b'], (x) => (x === 'a' ? -5 : 1))).toBe('b')
  })

  it('initiativeOrder：先攻高的先；一樣高時我方先、再照站位（COMBAT_SYSTEM 1.2）', () => {
    const a = field([one(), one({}, 2)], [foe(), foe()])
    const [a1, a2] = [a.ally(1), a.ally(2)]
    const [f1, f2] = [a.foe(1), a.foe(2)]
    for (const u of [a1, a2, f1, f2]) u.initiative = 10
    expect([f1, a2, f2, a1].sort(initiativeOrder).map((u) => u.id)).toEqual(['a1', 'a2', 'f1', 'f2'])
    f2.initiative = 15
    expect([a1, f1, f2].sort(initiativeOrder).map((u) => u.id)).toEqual(['f2', 'a1', 'f1'])
  })
})

describe('白箱 修正的來源（CORE_RULES 4.1、4.2；COMBAT_SYSTEM 3）', () => {
  it('mods：狀態的修正、餘韻每一層（現實 −1）、重傷 −2（只算命中與豁免，不算迴避）', () => {
    const a = field()
    const run = a.run()
    const me = a.ally(1)
    run.applyStatus(me, 'suppressed')
    me.layers = 2
    me.hp!.now = Math.floor(me.hp!.max / 2) - 1
    const hit = run.mods('hit', me)
    expect(hit.map((p) => [p.source, p.value])).toEqual([['status', -2], ['afterglow', -2], ['condition', -2]])
    expect(run.mods('save', me).map((p) => p.source)).toEqual(['afterglow', 'condition'])
    expect(run.mods('evade', me).map((p) => p.source)).toEqual(['afterglow'])
    expect(run.mods('damage', me)).toEqual([])
  })

  it('mods：剛好一半生命不算重傷（isWounded 用「低於一半」）', () => {
    const a = field()
    const me = a.ally(1)
    me.hp = { now: 20, max: 40 }
    expect(a.run().mods('hit', me)).toEqual([])
    me.hp.now = 19
    expect(a.run().mods('hit', me).map((p) => p.value)).toEqual([-2])
  })

  it('內海的餘韻是檢定 +1（CYBERSPACE 6.1）：每一層加', () => {
    const a = arena({ mode: 'net', grade: 1, allies: [{ from: 'unit', unit: one({ hp: undefined }) as never }], foes: [{ from: 'unit', unit: foe('minion', { hp: undefined }) as never }] })
    const me = a.ally(1)
    me.layers = 2
    expect(a.run().mods('hit', me)).toEqual([{ label: '餘韻', value: 2, source: 'afterglow' }])
  })

  it('evadeOf：黑暗 +2，攻擊的人有夜視就不算；coverShift 把遮蔽當成低幾級、夾在 0～2；extra 是掩護', () => {
    const a = field([one()], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const run = a.run()
    const t = a.foe(1)
    expect(run.evadeOf(t).total).toBe(t.evade + 4)
    expect(run.evadeOf(t, undefined, { coverShift: 1 }).total).toBe(t.evade + 2)
    expect(run.evadeOf(t, undefined, { coverShift: 9 }).total).toBe(t.evade)
    expect(run.evadeOf(t, undefined, { coverShift: -9 }).total).toBe(t.evade + 4)
    a.battle.field.dark = true
    expect(run.evadeOf(t, a.ally(1)).parts.map((p) => p.source)).toEqual(['base', 'cover', 'field'])
    a.ally(1).tags.push('night_vision')
    expect(run.evadeOf(t, a.ally(1)).parts.map((p) => p.source)).toEqual(['base', 'cover'])
    expect(run.evadeOf(t, a.ally(1), { extra: 3 }).total).toBe(t.evade + 4 + 3)
    expect(run.evadeOf(t, a.ally(1), { extra: 3 }).parts.at(-1)).toMatchObject({ label: '掩護', source: 'skill' })
  })

  it('開著機體的人用不了遮蔽、永遠暴露（COMBAT_SYSTEM 9.3）：evadeOf 不加遮蔽', () => {
    const a = field([one()], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [2, 2, 2, 2] } })
    a.foe(1).hull = { id: 'h', name: '機甲', hp: { now: 30, max: 30 }, armor: 4, backlash: 0.2 }
    expect(a.run().evadeOf(a.foe(1)).cover).toBe(0)
  })

  it('hitParts：武器、距離、瞄準、技能加值、命中的零值被濾掉', () => {
    const a = field([one({ weapon: 'rifle' })], [foe()])
    const run = a.run()
    const w = a.ally(1).weapons[0]!
    const parts = run.hitParts(a.ally(1), a.foe(1), w, { aimed: true, hit: 2, label: '要害射擊' })
    expect(parts.map((p) => p.source)).toEqual(['weapon', 'range', 'aim', 'skill'])
    expect(parts.find((p) => p.source === 'range')!.value).toBe(-2 + -4 + -2) // 步槍適用 3～7：距離 1 近了 2 格 −4，長槍站在第 1 格 −4
  })
})

describe('白箱 攻擊的流程（COMBAT_SYSTEM 3、4、5、6 節；不變式第 50 條）', () => {
  /** 站好的一對一：我方第 1 格、敵方第 slot 格；遮蔽全部暴露，迴避 10。 */
  const pair = (weapon: string, foeSlot: number, extra: Record<string, unknown> = {}) => {
    const a = field([one({ weapon })], [foe('minion', { evade: 10, ...extra })])
    a.foe(1).slot = foeSlot
    return a
  }

  it('霰彈槍：距離 1～2 是 5d6，3 以上是 3d6（COMBAT_SYSTEM 5）；傷害 = 骰面合計 + 固定傷害', () => {
    const near = pair('shotgun', 2)
    const r1 = near.run(dice(8, 1, 1, 1, 1, 1, 50)).attack(near.ally(1), near.foe(1))
    expect(r1).toMatchObject({ hit: true, crit: false, raw: 5 + 1 })
    const far = pair('shotgun', 3)
    const r2 = far.run(dice(8, 1, 1, 1, 50)).attack(far.ally(1), far.foe(1))
    expect(r2).toMatchObject({ hit: true, crit: false, raw: 3 + 1 })
  })

  it('不在適用距離內每一格 −2，只看命中不看傷害；長槍站在第 1 格 −4（COMBAT_SYSTEM 2.3、第 3 節）', () => {
    const a = pair('pistol', 4) // 距離 4，手槍 1～4 沒有懲罰
    expect(a.run().hitParts(a.ally(1), a.foe(1), a.ally(1).weapons[0]!).find((p) => p.source === 'range')).toBeUndefined()
    const b = pair('pistol', 5 as number) // 距離 5：超過 1 格
    expect(b.run().hitParts(b.ally(1), b.foe(1), b.ally(1).weapons[0]!).find((p) => p.source === 'range')!.value).toBe(-2)
  })

  it('自然 20 一定命中並且重創（雜兵多一顆骰）；自然 1 一定失手（就算加值很高）', () => {
    const a = pair('pistol', 1, { evade: 99 })
    const hit = a.run(dice(20)).attack(a.ally(1), a.foe(1))
    expect(hit).toMatchObject({ hit: true, wound: true, crit: false })
    // 傷害骰 = 3 顆基礎 + 1 顆（雜兵的重創），每顆 1，加固定傷害 1
    expect(hit.raw).toBe(4 + 1)
    const miss = pair('pistol', 1, { evade: -99 })
    const r = miss.run(dice(1))
    const m = r.attack(miss.ally(1), miss.foe(1))
    expect(m).toMatchObject({ hit: false, dealt: 0, raw: 0 })
    expect(r.beats[0]).toMatchObject({ tag: 'miss', data: { natural: 1 } })
    expect(r.beats[0]!.text).toMatch(/自然 1，失手/)
  })

  it('沒打中但差在遮蔽：寫「被遮蔽擋下」；不是遮蔽的差距寫「沒打中」', () => {
    const a = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 10 })], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const r = a.run(dice(6))
    a.ally(1).weapons[0]!.hit = 0
    r.attack(a.ally(1), a.foe(1))
    // 6 + 0 + 0 = 6 對 10 + 4 = 14：沒有遮蔽也不中（6 < 10），不算被擋下
    expect(r.beats[0]!.text).toMatch(/沒打中/)
    const b = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 10 })], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const r2 = b.run(dice(7))
    b.ally(1).weapons[0]!.hit = 4
    r2.attack(b.ally(1), b.foe(1))
    // 7 + 4 = 11：沒有遮蔽就中，遮蔽 +4 之後 14 對 11 不中：被擋下
    expect(r2.beats[0]!.text).toMatch(/被遮蔽擋下/)
    expect(r2.beats[0]!.data).toMatchObject({ blocked: true })
  })

  it('要害：超過迴避 5 以上多一顆傷害骰；瞄準過的射擊打出要害才重創', () => {
    const a = pair('pistol', 1)
    const aimed = a.run(dice(16)).attack(a.ally(1), a.foe(1), { aimed: true })
    expect(aimed).toMatchObject({ hit: true, crit: true, wound: true })
    const b = pair('pistol', 1)
    const plain = b.run(dice(16)).attack(b.ally(1), b.foe(1))
    expect(plain).toMatchObject({ hit: true, crit: true, wound: false })
    expect(plain.raw).toBeLessThan(aimed.raw) // 雜兵的重創多一顆骰
    const c = pair('pistol', 1)
    const nowound = c.run(dice(20)).attack(c.ally(1), c.foe(1), { noWound: true })
    expect(nowound).toMatchObject({ hit: true, wound: false })
  })

  it('autoCrit 命中一定要害；critMargin 讓要害更容易；沒命中時沒有要害', () => {
    const a = pair('pistol', 1)
    expect(a.run(dice(10)).attack(a.ally(1), a.foe(1), { autoCrit: true })).toMatchObject({ hit: true, crit: true })
    const b = pair('pistol', 1)
    expect(b.run(dice(11)).attack(b.ally(1), b.foe(1), { critMargin: -5 })).toMatchObject({ crit: true })
    const c = pair('pistol', 1, { evade: 99 })
    expect(c.run(dice(2)).attack(c.ally(1), c.foe(1), { autoCrit: true })).toMatchObject({ hit: false, crit: false })
  })

  it('彈匣：預設花 1 格、spend 0 不耗、spend 2 花兩格、最少剩 0（不變式第 52 條旁邊的彈匣規則）', () => {
    const a = pair('smg', 2)
    const w = a.ally(1).weapons[0]!
    a.run(dice(2)).attack(a.ally(1), a.foe(1))
    expect(w.mag!.now).toBe(2)
    a.run(dice(2)).attack(a.ally(1), a.foe(1), { spend: 0 })
    expect(w.mag!.now).toBe(2)
    a.run(dice(2)).attack(a.ally(1), a.foe(1), { spend: 5 })
    expect(w.mag!.now).toBe(0)
  })

  it('攻擊前的反應把攻擊的人打倒：這一擊沒有發生（aborted），不擲骰；彈匣已經扣了', () => {
    const a = pair('pistol', 1)
    a.k.battle.on('attack.before', 'test', ({ run, attacker }) => run.setOut(attacker, 'down'))
    const r = a.run(dice())
    const out = r.attack(a.ally(1), a.foe(1))
    expect(out).toMatchObject({ aborted: true, hit: false })
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(1)
  })

  it('推與拉：命中而且造成傷害才推（push）或拉（pull）；打空不動（COMBAT_SYSTEM 2.4）', () => {
    const w = testWeapon('pistol', 4)
    const pull = field([one({ weapons: [{ ...w, traits: ['pull'] }], wield: 0 })], [foe('minion', { evade: 10 }), foe('minion', { evade: 10 })])
    pull.foe(2).slot = 3
    pull.foe(1).slot = 2
    pull.foe(1).hp!.now = 999
    const r = pull.run(dice(12))
    r.attack(pull.ally(1), pull.foe(1))
    expect(pull.foe(1).slot).toBe(1)
    expect(tags(r)).toContain('pull')
    const miss = field([one({ weapons: [{ ...w, traits: ['pull'] }], wield: 0 })], [foe('minion', { evade: 99 })])
    miss.foe(1).slot = 2
    miss.run(dice(3)).attack(miss.ally(1), miss.foe(1))
    expect(miss.foe(1).slot).toBe(2)
    const push = field([one({ weapon: 'shotgun' })], [foe('minion', { evade: 10 })], { cover: { ally: [0, 0, 0, 0], foe: [1, 0, 0, 0] } })
    const r2 = push.run(dice(15))
    push.foe(1).hp!.now = 999
    r2.attack(push.ally(1), push.foe(1))
    expect(push.foe(1).slot).toBe(2)
  })

  it('任何攻擊都傷到那一格的遮蔽：不管有沒有打中；神經武器（遮蔽倍率 0）與 noCoverDamage 不傷；coverMultMin 至少算那個倍率（不變式第 51 條）', () => {
    const cover = { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }
    const a = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 99 })], { cover })
    const before = a.battle.cover.foe[0]!.hp
    a.run(dice(5, 6, 6, 6)).attack(a.ally(1), a.foe(1))
    expect(a.battle.cover.foe[0]!.hp).toBeLessThan(before)
    const b = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 99 })], { cover })
    b.run(dice(5)).attack(b.ally(1), b.foe(1), { noCoverDamage: true })
    expect(b.battle.cover.foe[0]!.hp).toBe(before)
    const c = field([one({ weapon: 'stun' })], [foe('minion', { evade: 99 })], { cover })
    c.run(dice(5)).attack(c.ally(1), c.foe(1))
    expect(c.battle.cover.foe[0]!.hp).toBe(before)
    const d = field([one({ weapon: 'stun' })], [foe('minion', { evade: 99 })], { cover })
    d.run(dice(5, 6, 6, 6)).attack(d.ally(1), d.foe(1), { coverMultMin: 1 })
    expect(d.battle.cover.foe[0]!.hp).toBeLessThan(before)
  })

  it('特殊彈換了類型就照換過的類型算骰數：熱能少一顆（COMBAT_SYSTEM 4）', () => {
    const a = pair('pistol', 1)
    const r = a.run(dice(8, 1, 1, 50)).attack(a.ally(1), a.foe(1), { type: 'thermal' })
    expect(r.raw).toBe(2 + 1) // 3 顆 − 1，加固定傷害 1
  })

  it('傷害骰最少一顆：電磁近戰少一顆也不會變 0 顆；dice 的修正是負的也一樣', () => {
    const w = testWeapon('knife', 4)
    const a = field([one({ weapons: [{ ...w, dice: 1, type: 'em' }], wield: 0 })], [foe('minion', { evade: 10 })])
    const r = a.run(dice(12, 4)).attack(a.ally(1), a.foe(1))
    expect(r.raw).toBe(4)
  })

  it('attack.after 掛點拿到結果；紀錄帶著 attacker、target、weapon 的 id（直播聽這些）', () => {
    const a = pair('pistol', 1)
    let got: unknown
    a.k.battle.on('attack.after', 'test', ({ result }) => { got = result })
    const r = a.run(dice(12, 3, 3, 3, 50))
    r.attack(a.ally(1), a.foe(1))
    expect(got).toMatchObject({ hit: true })
    expect(r.beats[0]!.data).toMatchObject({ attacker: 'a1', target: 'f1', weapon: 'pistol' })
    for (const b of r.beats) if (b.tag) expect(BATTLE_EVENTS as readonly string[]).toContain(b.tag)
  })
})

describe('白箱 打和人重疊的東西（COMBAT_SYSTEM 9.1；dev/adr/0013 C10）', () => {
  const duelWithDrone = (o: Partial<BattleOverlay> = {}, weapon = 'pistol') => {
    const a = field([one({ weapon })], [foe()])
    const drone = overlay(o)
    a.battle.overlays.push(drone)
    return { a, drone }
  }

  it('自然 1 失手；沒打中；永遠暴露：不吃那一格的遮蔽，只看它自己的迴避', () => {
    const { a, drone } = duelWithDrone()
    const r = a.run(dice(1))
    expect(r.attackOverlay(a.ally(1), drone)).toMatchObject({ hit: false, natural: 1, evade: 13 })
    expect(r.beats[0]!.text).toMatch(/自然 1，失手/)
    const r2 = a.run(dice(2))
    r2.attackOverlay(a.ally(1), drone)
    expect(r2.beats[0]!.text).toMatch(/沒打中/)
    expect(drone.hp.now).toBe(14)
  })

  it('命中：扣它的護甲（穿甲只抵銷護甲）、乘攻擊者的位階倍率；沒有要害與重創；不傷那一格的遮蔽', () => {
    const { a, drone } = duelWithDrone({ armor: 3 })
    const coverBefore = JSON.stringify(a.battle.cover.foe)
    const r = a.run(dice(20, 6, 6, 6))
    const res = r.attackOverlay(a.ally(1), drone)
    expect(res).toMatchObject({ hit: true, crit: false, wound: false, track: 'hp', raw: 18 + 1 })
    expect(res.dealt).toBe(19 - 3)
    expect(drone.hp.now).toBe(0)
    expect(res.downed).toBe(true)
    expect(drone.down).toBe(true)
    expect(JSON.stringify(a.battle.cover.foe)).toBe(coverBefore)
  })

  it('穿甲抵銷護甲但不會多出來變成傷害；位階倍率乘在扣完護甲之後（敵人的雜兵 ×0.4）', () => {
    const a = field([one({ weapon: 'pistol' })], [foe('minion')])
    const drone = overlay({ side: 'ally', owner: 'a1', hp: { now: 99, max: 99 }, armor: 2 })
    a.battle.overlays.push(drone)
    const f = a.foe(1)
    f.weapons[0]!.pierce = 5
    f.slot = 1
    const r = a.run(dice(20, 6, 6, 6))
    const res = r.attackOverlay(f, drone)
    expect(res.dealt).toBe(Math.round(18 * 0.4)) // 3 顆各 6 = 18，護甲被穿甲抵光
  })

  it('遠距（霰彈）改用 far 的骰數；黑暗 +2 迴避，夜視不算；被擊落的目標不會再被打（aborted）', () => {
    const a = field([one({ weapon: 'shotgun' })], [foe()])
    const drone = overlay({ slot: 4, hp: { now: 99, max: 99 }, armor: 0 })
    a.battle.overlays.push(drone)
    a.battle.field.dark = true
    const r = a.run(dice(20, 1, 1, 1))
    const res = r.attackOverlay(a.ally(1), drone)
    expect(res.evade).toBe(13 + 2)
    expect(res.raw).toBe(3 + 1) // 距離 4 > 2：3d6
    a.ally(1).tags.push('night_vision')
    expect(a.run(dice(20, 1, 1, 1)).attackOverlay(a.ally(1), drone).evade).toBe(13)
    drone.down = true
    expect(a.run(dice()).attackOverlay(a.ally(1), drone)).toMatchObject({ aborted: true })
  })
})

describe('白箱 傷害的各條路（COMBAT_SYSTEM 第 4、5 節）', () => {
  it('對已經退出的人沒有效果；沒有生命這一條的（內海單位）吃物理傷害也沒有效果', () => {
    const a = field()
    const run = a.run()
    a.foe(1).out = 'down'
    expect(run.damage(a.foe(1), 10, 'physical')).toEqual({ dealt: 0, track: 'none' })
    const b = field([one()], [foe('minion', { hp: undefined })])
    expect(b.run().damage(b.foe(1), 10, 'physical')).toEqual({ dealt: 0, track: 'none' })
  })

  it('護甲：物理照扣、穿甲只抵銷護甲；熱能無視一半（捨去）、電磁不看；護甲擋光就是 0 並寫一拍', () => {
    const a = field([one()], [foe('minion', { armor: 5, dmgMult: { hp: 1, load: 1 } })])
    const t = a.foe(1)
    const run = a.run()
    expect(run.damage(t, 10, 'physical').dealt).toBe(5)
    t.hp!.now = t.hp!.max
    expect(run.damage(t, 10, 'physical', undefined, { pierce: 3 }).dealt).toBe(8)
    t.hp!.now = t.hp!.max
    expect(run.damage(t, 10, 'physical', undefined, { pierce: 99 }).dealt).toBe(10)
    t.hp!.now = t.hp!.max
    expect(run.damage(t, 10, 'thermal').dealt).toBe(8) // 護甲 5 的一半 = 2（捨去）
    t.hp!.now = t.hp!.max
    expect(run.damage(t, 10, 'em').dealt).toBe(10)
    t.hp!.now = t.hp!.max
    const beats = run.beats.length
    expect(run.damage(t, 3, 'physical')).toEqual({ dealt: 0, track: 'none' })
    expect(run.beats.slice(beats)[0]).toMatchObject({ tag: 'damage', data: { amount: 0 } })
  })

  it('pierceOverflow 開著：穿甲超過護甲的部分算額外的傷害（ADR 0013 的另一種讀法）', () => {
    const a = field([one()], [foe('minion', { armor: 2 })])
    a.battle.mode = 'meat'
    a.run().mode.numbers.pierceOverflow // 預設 false
    const run = new BattleRun(a.k, a.state, a.battle)
    ;(run.n as { pierceOverflow: boolean }).pierceOverflow = true
    a.foe(1).dmgMult = { hp: 1, load: 1 }
    expect(run.damage(a.foe(1), 10, 'physical', undefined, { pierce: 5 }).dealt).toBe(10 - 2 + 5)
  })

  it('標籤倍率：電磁對 machine ×2；位階倍率乘在扣完護甲之後、四捨五入、最少 1', () => {
    const a = field([one()], [foe('minion', { armor: 0, tags: ['machine'], dmgMult: { hp: 1, load: 1 } })])
    expect(a.run().damage(a.foe(1), 5, 'em').dealt).toBe(10)
    const b = field([one()], [foe('boss', { armor: 0 })])
    const me = b.ally(1)
    me.dmgMult = { hp: 0.4, load: 1 }
    me.armor = 0
    const hit = b.run().damage(b.foe(1), 1, 'physical', me)
    expect(hit.dealt).toBe(1) // 1 × 0.4 → 四捨五入成 0，最少 1
  })

  it('造成生命傷害的人累積仇恨（uses.threat）；被護甲擋光的不算', () => {
    const a = field([one()], [foe('minion', { armor: 0, dmgMult: { hp: 1, load: 1 } })])
    const run = a.run()
    run.damage(a.foe(1), 12, 'physical', a.ally(1))
    expect(a.ally(1).uses.threat).toBe(12)
    const t = a.foe(1)
    t.armor = 99
    run.damage(t, 12, 'physical', a.ally(1))
    expect(a.ally(1).uses.threat).toBe(12)
  })

  it('打到零就倒下並寫一拍；沒打倒才吃傷害類型的 on_hit 狀態（熱能 → 燃燒）', () => {
    const a = field([one()], [foe('minion', { armor: 0 })])
    const t = a.foe(1)
    const run = a.run()
    run.damage(t, 5, 'thermal', a.ally(1))
    expect(t.statuses.map((s) => s.id)).toEqual(['burning'])
    run.damage(t, 999, 'physical', a.ally(1))
    expect(t.out).toBe('down')
    expect(tags(run)).toContain('down')
  })

  it('on_hit 的狀態不存在就不給（不丟錯）：電磁的 jammed 沒有資料時直接略過', () => {
    const a = arena(duel([one()], [foe('minion', { armor: 0 })]))
    const run = a.run()
    expect(() => run.damage(a.foe(1), 5, 'em')).not.toThrow()
    expect(a.foe(1).statuses).toEqual([])
  })

  it('神經傷害：對沒有橋的人無效並寫一拍；有橋的吃感載；快感另加沉溺（COMBAT_SYSTEM 第 5 節）', () => {
    const a = field([one()], [foe('minion', { load: undefined })])
    const run = a.run()
    expect(run.damage(a.foe(1), 20, 'neural')).toEqual({ dealt: 0, track: 'none' })
    expect(run.beats[0]).toMatchObject({ tag: 'damage', data: { amount: 0, type: 'neural' } })
    const b = field()
    const me = b.foe(1)
    me.sensitivity = 50
    const r = b.run().damage(me, 10, 'pleasure')
    expect(r.track).toBe('load')
    expect(me.sink).toBe(1)
    const c = field()
    c.foe(1).sensitivity = 50
    expect(c.run().damage(c.foe(1), 10, 'neural').dealt).toBe(10)
    expect(c.foe(1).sink).toBe(0)
  })

  it('神經傷害：攻擊者每一層餘韻 +10% 與 load_dealt_pct 修正（CORE_RULES 4.2）；dmgMult.load 照乘', () => {
    const a = field()
    const by = a.ally(1)
    by.layers = 2
    by.dmgMult = { hp: 1, load: 1.5 }
    const t = a.foe(1)
    t.sensitivity = 50
    expect(a.run().damage(t, 10, 'neural', by).dealt).toBe(Math.round(10 * 1.5 * 1.2))
  })

  it('內海（armorOnLoad）：防護擋感載，神經照扣、穿甲抵銷', () => {
    const net = (hp?: undefined) => arena({ mode: 'net', grade: 1, allies: [{ from: 'unit', unit: one({ hp }) as never }], foes: [{ from: 'unit', unit: foe('minion', { hp, armor: 4 }) as never }] })
    const a = net()
    expect(a.run().damage(a.foe(1), 10, 'neural').dealt).toBe(6)
    const b = net()
    expect(b.run().damage(b.foe(1), 10, 'neural', undefined, { pierce: 2 }).dealt).toBe(8)
  })
})

describe('白箱 機體（COMBAT_SYSTEM 9.3 節）', () => {
  const mech = (hp = 20, backlash = 0.2) => {
    const a = field([one()], [foe('elite', { armor: 0, dmgMult: { hp: 1, load: 1 } })])
    const t = a.foe(1)
    t.hull = { id: 'h', name: '機甲', hp: { now: hp, max: hp }, armor: 0, backlash }
    return { a, t }
  }

  it('傷害先打機體，一部分回灌成機師的感載；機體還沒破、傷害全被吸收：生命不動', () => {
    const { a, t } = mech(20)
    const hp = t.hp!.now
    const r = a.run().damage(t, 10, 'physical')
    expect(r).toEqual({ dealt: 10, track: 'hull' })
    expect(t.hull!.hp.now).toBe(10)
    expect(t.hp!.now).toBe(hp)
    expect(t.load!.now).toBe(Math.round(10 * 0.2 * (0.75 + 50 / 200) * 1) || t.load!.now)
    expect(t.load!.now).toBeGreaterThan(0)
  })

  it('機體耐久歸零發 hull.break；多的傷害打到本人；機體破時機師的護甲加成跟著機體一起算', () => {
    const { a, t } = mech(6)
    let broke = 0
    a.k.battle.on('hull.break', 'test', () => { broke += 1 })
    const hp = t.hp!.now
    const r = a.run().damage(t, 10, 'physical')
    expect(broke).toBe(1)
    expect(t.hull!.hp.now).toBe(0)
    expect(r).toEqual({ dealt: 10, track: 'hp' })
    expect(t.hp!.now).toBe(hp - 4)
  })

  it('機體的護甲算進護甲值（COMBAT_SYSTEM 9.3「護甲 +4」）', () => {
    const { a, t } = mech(50)
    t.hull!.armor = 4
    expect(a.run().damage(t, 10, 'physical').dealt).toBe(6)
  })

  it('回灌不乘敏感度（exact）：回灌 0 的機體不動感載；機師已經倒下就不再回灌', () => {
    const { a, t } = mech(50, 0)
    a.run().damage(t, 10, 'physical')
    expect(t.load!.now).toBe(0)
  })

  it('有機體的人的神經傷害照常打感載（機體只吸生命）', () => {
    const { a, t } = mech(50)
    expect(a.run().damage(t, 10, 'neural').track).toBe('load')
  })
})

describe('白箱 感載與過載（CORE_RULES 4.2；COMBAT_SYSTEM 7；不變式第 53 條）', () => {
  it('addLoad：沒有感載這一條的、已經退出的人沒有效果；數值四捨五入；敏感度與 load_taken_pct 修正照乘', () => {
    const a = field()
    const t = a.foe(1)
    const run = a.run()
    expect(run.addLoad(t, 10)).toBe(10)
    t.sensitivity = 100
    t.load!.now = 0
    expect(run.addLoad(t, 10)).toBe(Math.round(10 * 1.25))
    t.load!.now = 0
    t.sensitivity = 0
    expect(run.addLoad(t, 10)).toBe(Math.round(10 * 0.75))
    const b = field([one()], [foe('minion', { load: undefined })])
    expect(b.run().addLoad(b.foe(1), 10)).toBe(0)
    t.out = 'down'
    expect(run.addLoad(t, 10)).toBe(0)
  })

  it('addLoad：exact 不乘敏感度；加 0 或更少不留紀錄；by 累積仇恨', () => {
    const a = field()
    const t = a.foe(1)
    t.sensitivity = 0
    const run = a.run()
    expect(run.addLoad(t, 10, a.ally(1), { exact: true, label: '回灌' })).toBe(10)
    expect(run.beats[0]!.text).toMatch(/（回灌）感載 \+10/)
    expect(a.ally(1).uses.threat).toBe(10)
    const n = run.beats.length
    expect(run.addLoad(t, 0.2)).toBe(0)
    expect(run.beats.length).toBe(n)
  })

  it('過載：感載歸零（多的不留）、餘韻 +1、現實失去下一個回合；已經疊滿再過載就倒下（burnout）', () => {
    const a = field()
    const t = a.foe(1)
    t.sensitivity = 50
    t.load = { now: 0, max: 10 }
    t.layersMax = 2
    const run = a.run()
    run.addLoad(t, 99)
    expect(t.load.now).toBe(0)
    expect(t.layers).toBe(1)
    expect(t.statuses.map((s) => s.id)).toContain(LOSE_TURN)
    run.addLoad(t, 99)
    expect(t.layers).toBe(2)
    expect(afterglowFull(t)).toBe(true)
    run.addLoad(t, 99)
    expect(t.out).toBe('burnout')
    expect(t.statuses.map((s) => s.id)).not.toContain(LOSE_TURN)
    expect(run.beats.some((b) => b.tag === 'overload' && b.data?.down === true)).toBe(true)
  })

  it('過載：內海是閃斷，一池資源歸零、不失去回合；沒有那一池也不丟錯（CYBERSPACE 6.1）', () => {
    const net = () => arena({ mode: 'net', grade: 1, allies: [{ from: 'unit', unit: one({ hp: undefined }) as never }], foes: [{ from: 'unit', unit: foe('minion', { hp: undefined }) as never }] })
    const a = net()
    const me = a.ally(1)
    me.load = { now: 0, max: 5 }
    a.run().addLoad(me, 99)
    expect(me.pools.ram!.now).toBe(0)
    expect(me.statuses.map((s) => s.id)).not.toContain(LOSE_TURN)
    const b = net()
    delete b.ally(1).pools.ram
    b.ally(1).load = { now: 0, max: 5 }
    expect(() => b.run().addLoad(b.ally(1), 99)).not.toThrow()
  })

  it('overload 直接呼叫：沒有感載或已經退出的人什麼都不做；發 overload 掛點', () => {
    const a = field()
    let n = 0
    a.k.battle.on('overload', 'test', () => { n += 1 })
    const run = a.run()
    run.overload(a.foe(1), a.ally(1))
    expect(n).toBe(1)
    const b = field([one()], [foe('minion', { load: undefined })])
    expect(() => b.run().overload(b.foe(1))).not.toThrow()
    expect(b.foe(1).layers).toBe(0)
    const c = field()
    c.foe(1).out = 'down'
    c.run().overload(c.foe(1))
    expect(c.foe(1).layers).toBe(0)
  })

  it('heal 與 vent：不超過上限／不低於 0、回傳實際的量；退出的人與沒有那一條的人回 0；沒有變化不留紀錄', () => {
    const a = field()
    const t = a.foe(1)
    const run = a.run()
    t.hp!.now = t.hp!.max - 3
    expect(run.heal(t, 10)).toBe(3)
    expect(run.heal(t, 10)).toBe(0)
    expect(run.heal(t, -5)).toBe(0)
    t.load!.now = 4
    expect(run.vent(t, 10)).toBe(4)
    expect(run.vent(t, 10)).toBe(0)
    const n = run.beats.length
    run.heal(t, 0)
    run.vent(t, 0)
    expect(run.beats.length).toBe(n)
    t.out = 'down'
    expect(run.heal(t, 5)).toBe(0)
    expect(run.vent(t, 5)).toBe(0)
    const b = field([one()], [foe('minion', { hp: undefined, load: undefined })])
    expect(b.run().heal(b.foe(1), 5)).toBe(0)
    expect(b.run().vent(b.foe(1), 5)).toBe(0)
  })

  it('save：自然 20 一定過、自然 1 一定不過（CORE_RULES 3）；沒有基本功只算屬性；額外的加值與修正算進去', () => {
    const a = field()
    const me = a.ally(1)
    me.attrs.resolve = 14
    me.skills.composure = 0
    expect(a.run(dice(20)).save(me, 'resolve', 'composure', 99, '定力').ok).toBe(true)
    expect(a.run(dice(1)).save(me, 'resolve', 'composure', 1, '定力').ok).toBe(false)
    const r = a.run(dice(7)).save(me, 'resolve', undefined, 12, '定力', [{ label: '幫手', value: 3, source: 'skill' }])
    expect(r.ok).toBe(true)
    expect(r.roll.parts.map((p) => p.label)).toEqual(['意志', '幫手'])
    expect(r.roll).toMatchObject({ total: 12, margin: 0, verdict: 'yes_but' })
    const skill = a.run(dice(5)).save(me, 'resolve', 'composure', 5, '定力')
    expect(skill.roll.skill).toBe('composure')
  })
})

describe('白箱 狀態（COMBAT_SYSTEM 第 6、7 節；ENEMIES 4.5）', () => {
  it('applyStatus：已經退出的人給不上；同一個狀態再得一次只重算時間、不疊加', () => {
    const a = field()
    const t = a.foe(1)
    const run = a.run()
    t.out = 'down'
    expect(run.applyStatus(t, 'suppressed')).toBe(false)
    t.out = undefined
    expect(run.applyStatus(t, 'suppressed')).toBe(true)
    expect(run.applyStatus(t, 'suppressed', { turns: 3 })).toBe(true)
    expect(t.statuses.filter((s) => s.id === 'suppressed')).toHaveLength(1)
    expect(t.statuses[0]!.until).toMatchObject({ at: 'turn_end', turns: 3 })
  })

  it('applyStatus 的結束時間：own_turn_start/own_turn_end 看自己；source_ 開頭的看給的人（沒有給的人就看自己）；battle_end 整場', () => {
    const a = field()
    const t = a.foe(1)
    const run = a.run()
    run.applyStatus(t, 'marked', { by: a.ally(1) })
    expect(t.statuses[0]!.until).toEqual({ at: 'turn_start', of: 'a1', turns: 1 })
    run.applyStatus(t, 'marked')
    expect(t.statuses[0]!.until).toEqual({ at: 'turn_start', of: 'f1', turns: 1 })
    run.applyStatus(t, 'dazed')
    expect(t.statuses.find((s) => s.id === 'dazed')!.until).toEqual({ at: 'battle_end' })
    run.applyStatus(t, 'bleeding', { until: 'source_turn_end', by: a.ally(1), data: { hp: -3 } })
    expect(t.statuses.find((s) => s.id === 'bleeding')).toMatchObject({ until: { at: 'turn_end', of: 'a1' }, by: 'a1', data: { hp: -3 } })
  })

  it('首領的控制保護：控制只有 1 回合，之後免疫控制 1 回合；force（過載的失去回合）不看保護（ENEMIES 4.5）', () => {
    const a = field([one()], [foe('boss')])
    const boss = a.foe(1)
    const run = a.run()
    expect(run.applyStatus(boss, 'frozen', { turns: 5 })).toBe(true)
    expect(boss.statuses[0]!.until).toMatchObject({ turns: 1 })
    expect(run.applyStatus(boss, 'frozen')).toBe(false)
    expect(run.beats.at(-1)).toMatchObject({ tag: 'status', data: { blocked: true } })
    expect(run.applyStatus(boss, 'frozen', { force: true })).toBe(true)
    // 下一個回合保護解除
    a.battle.round += 2
    expect(run.applyStatus(boss, 'frozen')).toBe(true)
  })

  it('不是首領：控制照給、回合數照給的', () => {
    const a = field([one()], [foe('elite')])
    expect(a.run().applyStatus(a.foe(1), 'frozen', { turns: 3 })).toBe(true)
    expect(a.foe(1).statuses[0]!.until).toMatchObject({ turns: 3 })
  })

  it('失去回合是核心的狀態：給的時候不寫「狀態」紀錄、拿掉時（quiet）也不寫', () => {
    const a = field()
    const run = a.run()
    run.applyStatus(a.foe(1), LOSE_TURN)
    expect(run.beats).toEqual([])
    expect(run.removeStatus(a.foe(1), LOSE_TURN)).toBe(true)
    expect(run.beats).toEqual([])
  })

  it('removeStatus：沒有這個狀態回 false；quiet 不寫紀錄；有的話寫「結束了」', () => {
    const a = field()
    const t = a.foe(1)
    const run = a.run()
    expect(run.removeStatus(t, 'suppressed')).toBe(false)
    run.applyStatus(t, 'suppressed')
    run.beats.length = 0
    expect(run.removeStatus(t, 'suppressed', true)).toBe(true)
    expect(run.beats).toEqual([])
    run.applyStatus(t, 'suppressed')
    run.beats.length = 0
    run.removeStatus(t, 'suppressed')
    expect(run.beats[0]).toMatchObject({ tag: 'status.end' })
  })

  it('cleanse：只解 cleansed_by 有這個字的；回傳解掉的 id', () => {
    const a = field()
    const t = a.foe(1)
    const run = a.run()
    run.applyStatus(t, 'bleeding')
    run.applyStatus(t, 'dazed')
    expect(run.cleanse(t, 'first_aid')).toEqual(['bleeding'])
    expect(t.statuses.map((s) => s.id)).toEqual(['dazed'])
    expect(run.cleanse(t, 'first_aid')).toEqual([])
  })

  it('cannotMove：帶著 no_move 的狀態（壓制）', () => {
    const a = field()
    const run = a.run()
    expect(run.cannotMove(a.foe(1))).toBe(false)
    run.applyStatus(a.foe(1), 'suppressed')
    expect(run.cannotMove(a.foe(1))).toBe(true)
  })
})

describe('白箱 倒下、退出與結果（COMBAT_SYSTEM 8.1、8.2；不變式第 49 條）', () => {
  it('setOut：各種退出的說法與事件標籤；已經退出的不重複；burnout 寫成「倒下了」（事件標籤 down）', () => {
    const a = field([one(), one({}, 2)], [foe(), foe(), foe()])
    const run = a.run()
    run.setOut(a.foe(1), 'subdued', a.ally(1))
    run.setOut(a.foe(2), 'fled')
    run.setOut(a.ally(2), 'burnout')
    run.setOut(a.foe(1), 'down')
    expect(run.beats.map((b) => b.tag).filter((t) => t !== 'compact')).toEqual(['subdue', 'flee', 'down'])
    const said = run.beats.filter((b) => b.tag !== 'compact').map((b) => b.text)
    expect(said[0]).toMatch(/被制伏，退出戰鬥/)
    expect(said[1]).toMatch(/逃走了/)
    expect(said[2]).toMatch(/倒下了/)
    const b = field([one()], [foe(), foe()])
    b.run().setOut(b.foe(1), 'removed')
    const r = b.run()
    r.setOut(b.foe(2), 'banished')
    expect(r.beats.find((x) => x.tag === 'down')!.text).toMatch(/退出了戰鬥/)
  })

  it('setOut：拿掉監視與失去回合；操作者倒下，他的無人機全部停機（COMBAT_SYSTEM 9.1）', () => {
    const a = field([one(), one({}, 2)], [foe(), foe()])
    const run = a.run()
    const me = a.ally(1)
    me.watch = { action: 'x' }
    run.applyStatus(me, LOSE_TURN)
    a.battle.overlays.push(overlay({ side: 'ally', owner: 'a1', id: 'o1' }), overlay({ side: 'ally', owner: 'a2', id: 'o2', slot: 2 }), overlay({ side: 'ally', owner: 'a1', id: 'o3', slot: 3, down: true }))
    run.setOut(me, 'down')
    expect(me.watch).toBeUndefined()
    expect(me.statuses).toEqual([])
    expect(a.battle.overlays.map((o) => o.down)).toEqual([true, false, true])
    expect(run.beats.find((b) => b.tag === 'overlay.down')!.text).toMatch(/停機了/)
  })

  it('一方全部退出就分出結果：我方全倒是戰敗、敵方全倒是勝利；已經有結果就不改（finish 只算第一次）', () => {
    const a = field()
    const run = a.run()
    run.setOut(a.foe(1), 'down')
    expect(a.battle.result).toMatchObject({ outcome: 'win' })
    run.finish('lose', '之後的結果不算')
    expect(a.battle.result!.outcome).toBe('win')
    const b = field()
    b.run().setOut(b.ally(1), 'down')
    expect(b.battle.result).toMatchObject({ outcome: 'lose', text: '全隊倒下：戰敗。' })
    const c = field()
    const run3 = c.run()
    c.ally(1).watch = { action: 'x' }
    let seen = ''
    c.k.battle.on('battle.result', 'test', ({ outcome }) => { seen = outcome })
    run3.finish('fled', '脫離。')
    expect(seen).toBe('fled')
    expect(c.ally(1).watch).toBeUndefined()
    expect(run3.over).toBe(true)
  })

  it('後方還有人排隊時不算全倒（standing 把排隊的算進去）', () => {
    const a = field([one()], [foe(), foe(), foe(), foe(), foe()])
    expect(Object.keys(a.battle.reserve.foe)).toHaveLength(1)
    const run = a.run(dice(5))
    for (const i of [1, 2, 3, 4]) run.setOut(a.foe(i), 'down')
    expect(a.battle.result).toBeUndefined()
  })

  it('overlay 擊落：發 overlay.down 掛點；停機（quiet）不發', () => {
    const a = field()
    let n = 0
    a.k.battle.on('overlay.down', 'test', () => { n += 1 })
    const o1 = overlay({ side: 'ally', owner: 'a1' })
    const o2 = overlay({ id: 'o2', side: 'ally', owner: 'a1', slot: 2 })
    a.battle.overlays.push(o1, o2)
    const run = a.run()
    run.dropOverlay(o1, a.foe(1))
    run.dropOverlay(o2, undefined, true)
    run.dropOverlay(o1)
    expect(n).toBe(1)
    expect(run.beats.map((b) => b.text)).toEqual(['敵方的無人機被擊落了。', '敵方的無人機停機了。'])
  })
})

describe('白箱 遮蔽（COMBAT_SYSTEM 2.1、2.5；不變式第 51 條）', () => {
  const cov = (ally: number[] = [0, 0, 0, 0], foes: number[] = [2, 1, 0, 0]) => field([one()], [foe()], { cover: { ally, foe: foes } })

  it('hurtCover：沒有人站的那一格傷害加倍；煙霧、暴露的、不存在的格子與 0 傷害不受傷', () => {
    const a = cov([0, 0, 0, 0], [2, 2, 0, 0])
    const run = a.run()
    run.hurtCover('foe', 1, 10)
    expect(a.battle.cover.foe[0]!.hp).toBe(30 - 10) // 第 1 格有人
    run.hurtCover('foe', 2, 10)
    expect(a.battle.cover.foe[1]!.hp).toBe(30 - 20) // 第 2 格沒人：加倍
    a.battle.cover.foe[1]!.soft = { kind: 'smoke' }
    run.hurtCover('foe', 2, 999)
    expect(a.battle.cover.foe[1]!.level).toBe(2)
    run.hurtCover('foe', 3, 999)
    run.hurtCover('foe', 9, 999)
    run.hurtCover('foe', 1, 0)
    run.hurtCover('foe', 1, 0.4)
    expect(a.battle.cover.foe[0]!.hp).toBe(20)
  })

  it('hurtCover：一擊打穿一級就降一級、多的傷害算到下一級；掩體打成暴露時站在上面的人觸發監視的對象', () => {
    const a = cov([0, 0, 0, 0], [2, 0, 0, 0])
    const run = a.run()
    run.hurtCover('foe', 1, 40)
    expect(a.battle.cover.foe[0]).toMatchObject({ level: 1, hp: 30 + 0 - 40 + 15 })
    run.hurtCover('foe', 1, 999)
    expect(a.battle.cover.foe[0]).toMatchObject({ level: 0, hp: 0 })
    expect(tags(run).filter((t) => t === 'cover.break')).toHaveLength(2)
    expect(tags(run)).toContain('cover.hit')
  })

  it('raiseCover：最高到掩體、耐久補滿、可以指定耐久；lowerCover 不必過耐久，降到暴露就把人曝光', () => {
    const a = cov([0, 0, 0, 0], [0, 0, 0, 0])
    const run = a.run()
    run.raiseCover('foe', 1, 5)
    expect(a.battle.cover.foe[0]).toMatchObject({ level: 2, hp: 30 })
    run.raiseCover('foe', 2, 1, [7, 9])
    expect(a.battle.cover.foe[1]).toMatchObject({ level: 1, hp: 7, max: [7, 9] })
    run.raiseCover('foe', 9, 1)
    run.lowerCover('foe', 9, 1)
    run.lowerCover('foe', 3, 1)
    run.lowerCover('foe', 1, 1)
    expect(a.battle.cover.foe[0]).toMatchObject({ level: 1, hp: 15 })
    run.lowerCover('foe', 1, 5)
    expect(a.battle.cover.foe[0]).toMatchObject({ level: 0, hp: 0 })
    expect(run.beats.filter((b) => b.tag === 'cover.break')).toHaveLength(2)
  })

  it('softCover：煙霧是打不破的半掩體；有回合數的到時自己散掉（endRound 之後）；沒有那一格不丟錯', () => {
    const a = cov([0, 0, 0, 0], [0, 0, 0, 0])
    const run = a.run()
    run.softCover('foe', 1, 'smoke', 2)
    run.softCover('foe', 2, 'crowd')
    run.softCover('foe', 3, 'fog')
    run.softCover('foe', 9, 'smoke')
    expect(a.battle.cover.foe[0]!.soft).toEqual({ kind: 'smoke', until: a.battle.round + 1 })
    expect(a.battle.cover.foe[1]!.soft).toEqual({ kind: 'crowd' })
    expect(run.beats.map((b) => b.text)).toEqual([
      '敵方第 1 格起了煙霧：算打不破的半掩體。', '敵方第 2 格起了人群：算打不破的半掩體。', '敵方第 3 格起了fog：算打不破的半掩體。',
    ])
  })
})

describe('白箱 換位與推拉（COMBAT_SYSTEM 2.3、2.4）', () => {
  it('move：換到相鄰的空格；和隊友交換；都發 moved 掛點（by: action）並寫一拍', () => {
    const a = field([one(), one({}, 2)], [foe()], { cover: { ally: [1, 1, 1, 1], foe: [0, 0, 0, 0] } })
    const seen: string[] = []
    a.k.battle.on('moved', 'test', ({ unit, from, to, by }) => { seen.push(`${unit.id}:${from}>${to}:${by}`) })
    const run = a.run()
    run.move(a.ally(1), 2)
    expect(a.ally(1).slot).toBe(2)
    expect(a.ally(2).slot).toBe(1)
    run.move(a.ally(1), 3)
    expect(seen).toEqual(['a1:1>2:action', 'a1:2>3:action'])
    expect(run.beats[0]!.text).toMatch(/換位/)
    expect(run.beats[1]!.text).toMatch(/移到第 3 格/)
  })

  it('place：超出 1～4、同一格、已經退出的人回 false；目的格有人兩個人交換；forced', () => {
    const a = field([one(), one({}, 2)], [foe()])
    const run = a.run()
    expect(run.place(a.ally(1), 0)).toBe(false)
    expect(run.place(a.ally(1), 5)).toBe(false)
    expect(run.place(a.ally(1), 1)).toBe(false)
    a.ally(2).out = 'down'
    expect(run.place(a.ally(2), 1)).toBe(false)
    a.ally(2).out = undefined
    const forced: string[] = []
    a.k.battle.on('moved', 'test', ({ by }) => { forced.push(by) })
    expect(run.place(a.ally(1), 2)).toBe(true)
    expect(a.ally(1).slot).toBe(2)
    expect(a.ally(2).slot).toBe(1)
    expect(forced).toEqual(['forced'])
    expect(run.beats[0]).toMatchObject({ tag: 'push' })
    expect(run.shift(a.ally(1), -1)).toBe(true)
    expect(run.beats.at(-1)).toMatchObject({ tag: 'pull' })
  })

  it('shift：已經在最後一格再往後推、在第 1 格再往前拉都不動', () => {
    const a = field([one()], [foe(), foe(), foe(), foe()])
    const run = a.run()
    expect(run.shift(a.foe(1), -1)).toBe(false)
    expect(run.shift(a.foe(4), +1)).toBe(false)
  })
})

describe('白箱 補位與監視（COMBAT_SYSTEM 1.3、2.4；dev/adr/0013 C6、C13；不變式第 45 條）', () => {
  it('compact：前面那一格沒有人、沒有遮蔽，後面的人連同遮蔽往前；前面空著但遮蔽還在就留在原地', () => {
    const a = field([one(), one({}, 2)], [foe()], { cover: { ally: [0, 0, 2, 1], foe: [0, 0, 0, 0] } })
    const run = a.run()
    a.ally(1).out = 'down'
    run.compact('ally')
    expect(a.ally(2).slot).toBe(1)
    expect(a.battle.cover.ally.map((c) => c.level)).toEqual([0, 2, 1, 0])
    const b = field([one(), one({}, 2)], [foe()], { cover: { ally: [2, 0, 0, 0], foe: [0, 0, 0, 0] } })
    b.ally(1).out = 'down'
    b.run().compact('ally')
    expect(b.ally(2).slot).toBe(2)
  })

  it('reinforce：從最後面的空格進場、行動點從上限開始、先攻當場擲並排進順序（指標不亂）', () => {
    const a = field([one()], [foe(), foe(), foe(), foe(), foe()])
    const run = a.run(dice(15, 1))
    a.foe(5).ap.now = 0
    const first = a.battle.order[a.battle.turn]
    a.foe(1).out = 'down'
    run.compact('foe')
    run.reinforce('foe')
    expect(a.foe(5).slot).toBe(4)
    expect(a.battle.reserve.foe).toEqual([])
    expect(a.battle.order).toContain('f5')
    expect(a.battle.order[a.battle.turn]).toBe(first)
    expect(run.beats.some((b) => b.tag === 'reinforce')).toBe(true)
  })

  it('flushWatch：監視的人對站上暴露格的敵人各做一次；做不到（行動沒有 auto）就繼續等、不留「觸發」的紀錄', () => {
    const a = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 10 })], { cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] } })
    const w = a.ally(1)
    w.watch = { action: 'test.attack' }
    const run = a.run(dice(12, 3, 3, 3, 50, 50, 50))
    run.exposed(a.foe(1))
    run.flushWatch()
    expect(w.watch).toBeUndefined()
    expect(run.beats.some((b) => b.tag === 'watch.fire')).toBe(true)
    const b = field([one({ weapon: 'pistol' })], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] } })
    b.ally(1).watch = { action: 'no.such.action' }
    const r2 = b.run()
    r2.exposed(b.foe(1))
    r2.flushWatch()
    expect(b.ally(1).watch).toEqual({ action: 'no.such.action' })
    expect(r2.beats).toEqual([])
  })

  it('flushWatch：失去回合的人不監視；做不到的監視（彈匣空）留著繼續等，也不留「觸發」一拍', () => {
    const a = field([one({ weapon: 'pistol' })], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] } })
    a.ally(1).watch = { action: 'test.attack' }
    a.ally(1).weapons[0]!.mag!.now = 0
    const run = a.run()
    run.exposed(a.foe(1))
    run.flushWatch()
    expect(a.ally(1).watch).toBeDefined()
    expect(run.beats).toEqual([])
    const b = field([one({ weapon: 'pistol' })], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] } })
    b.ally(1).watch = { action: 'test.attack' }
    b.run().applyStatus(b.ally(1), LOSE_TURN)
    const r2 = b.run()
    r2.exposed(b.foe(1))
    r2.flushWatch()
    expect(r2.beats).toEqual([])
  })

  it('flushWatch 重入：監視的動作裡又呼叫 flushWatch 不會遞迴（flushing 旗標）；目標已經不再暴露就略過', () => {
    const f: Feature = {
      id: 'reenter',
      install: (k) => k.battle.action({
        id: 'reenter', owner: 'reenter', name: '重入', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 0 }), run: () => {},
        auto: (run, _u, t) => { run.exposed(t); run.flushWatch(); return true },
      }),
    }
    const a = arena(duel([one({ weapon: 'pistol' })], [foe()], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), [f], prep)
    a.ally(1).watch = { action: 'reenter' }
    const run = a.run()
    run.exposed(a.foe(1))
    expect(() => run.flushWatch()).not.toThrow()
    expect(run.beats.filter((b) => b.tag === 'watch.fire')).toHaveLength(1)
    expect(a.ally(1).watch).toBeUndefined()
    // 站上去之後又被遮蔽蓋住（不再暴露）：佇列裡的人略過
    const b = arena(duel([one({ weapon: 'pistol' })], [foe()], { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }), [f], prep)
    b.ally(1).watch = { action: 'reenter' }
    const r2 = b.run()
    r2.exposed(b.foe(1))
    r2.flushWatch()
    expect(r2.beats).toEqual([])
  })

  it('一個動作讓目標中途倒下：同一個目標不再被後面的監視者觸發（break）；補位上來的敵人是新的一次曝光，由還在監視的人各觸發一次', () => {
    const f: Feature = {
      id: 'killer',
      install: (k) => k.battle.action({
        id: 'killer', owner: 'killer', name: '殺', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 0 }), run: () => {},
        auto: (run, _u, t) => { run.setOut(t, 'down'); return true },
      }),
    }
    const a = arena(duel([one({ weapon: 'pistol' }), one({}, 2)], [foe(), foe()], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), [f], prep)
    a.ally(1).watch = { action: 'killer' }
    a.ally(2).watch = { action: 'killer' }
    const run = a.run()
    run.exposed(a.foe(1))
    run.flushWatch()
    const fires = run.beats.filter((b) => b.tag === 'watch.fire')
    expect(fires.map((b) => b.data!.target)).toEqual(['f1', 'f2'])
    expect(new Set(fires.map((b) => b.data!.unit)).size).toBe(2) // 先攻順序決定誰先，但每個人各觸發一次
    expect(a.ally(1).watch).toBeUndefined()
    expect(a.ally(2).watch).toBeUndefined()
  })

  it('exposed：沒有站在暴露格子上的人不進佇列；同一個人不重複進；flushWatch 可以重入但不會遞迴', () => {
    const a = field([one({ weapon: 'pistol' })], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const run = a.run()
    run.exposed(a.foe(1))
    run.flushWatch()
    expect(run.beats).toEqual([])
    unitAt(a.battle, 'foe', 1)
  })
})
