// 白箱測試：features/combat（現實戰鬥的行動表：射擊、近戰、換彈、換武器、打遮蔽、監視、制伏、脫離、投降、道具、重創）。
// 補主套件沒有走到的分支：脫離失敗、各行動的自動版本（監視觸發）與 AI 分數、道具的各種效果與壞資料、重創的戰後結果。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleActionDef, BattleOverlay, BattleUnit, ContentPack } from '../../src'
import { LOSE_TURN, createKernel, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { usableItems } from '../../src/features/combat/items'
import { testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const dice = (...v: number[]) => [...v, ...Array(80).fill(1)]
const ITEM = (id: string, more: Record<string, unknown> = {}) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'c',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '檢定 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }],
    item: [
      ITEM('it_heal', { use: { ap: 1, ap_other: 2, target: 'ally', effects: [{ op: 'heal', amount: 8 }] } }),
      ITEM('it_heal_nan', { use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 'x' }, { op: 'vent', amount: 'x' }] } }),
      ITEM('it_cool', { use: { ap: 1, target: 'self', effects: [{ op: 'afterglow', layers: -1 }, { op: 'vent', amount: 5 }] } }),
      ITEM('it_cool_up', { use: { ap: 1, target: 'self', effects: [{ op: 'afterglow', layers: 99 }] } }),
      ITEM('it_cool_zero', { use: { ap: 1, target: 'self', effects: [{ op: 'afterglow', layers: 0 }] } }),
      ITEM('it_clean', { use: { ap: 1, target: 'self', effects: [{ op: 'cleanse', by: 'first_aid' }, { op: 'cleanse', status: 'dazed' }, { op: 'cleanse' }] } }),
      ITEM('it_smoke', { use: { ap: 1, target: 'slot', effects: [{ op: 'soft_cover', kind: 'smoke' }, { op: 'soft_cover', kind: 'crowd', rounds: 2 }] } }),
      ITEM('it_slot_ally', { use: { ap: 1, target: 'ally_slot', effects: [{ op: 'soft_cover', kind: 'smoke', rounds: 1 }] } }),
      ITEM('it_throw', { use: { ap: 1, target: 'foe', effects: [{ op: 'heal', amount: 1 }] } }),
      ITEM('it_throw_slot', { use: { ap: 1, target: 'foe_slot', effects: [{ op: 'heal', amount: 1 }] } }),
      ITEM('it_net', { use: { ap: 1, target: 'self', modes: ['net'], effects: [{ op: 'vent', amount: 1 }] } }),
      ITEM('it_plain'),
      ITEM('it_tie', { tags: ['restraint'] }),
      ITEM('it_lock', { tags: ['restraint'], consumable: false }),
    ],
  },
}
const field = (allies: unknown[], foes: unknown[] = [foe('minion', { evade: 10 })], more: Parameters<typeof duel>[3] = {}) =>
  arena(duel(allies, foes, { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, more), [combatFeature], (k) => k.content.loadPack(PACK))
type A = ReturnType<typeof field>
const act = (a: A, id: string): BattleActionDef => a.k.battle.getAction(id)!
const quick = (...items: Array<[string, number]>) => items.map(([item, qty]) => ({ item, qty }))

describe('白箱 脫離（COMBAT_SYSTEM 1.3 節：對 10＋敵方最高的等級×2）', () => {
  it('失敗：只是白花行動點，寫一拍「脫離失敗」，戰鬥繼續；成功全隊離開、敵人還在（結果 fled）', () => {
    const a = field([one({ weapon: 'pistol', skills: { athletics: 0, stealth: 0 } })], [foe('elite', { grade: 3 })])
    const me = a.ally(1)
    me.attrs.body = 10
    const fail = a.run(dice(2))
    act(a, 'flee').run(fail, me, null, { action: 'flee' })
    expect(a.battle.result).toBeUndefined()
    expect(fail.beats.some((b) => b.tag === 'flee.fail')).toBe(true)
    const win = a.run(dice(20))
    act(a, 'flee').run(win, me, null, { action: 'flee' })
    expect(a.battle.result).toMatchObject({ outcome: 'fled' })
    expect(a.foe(1).out).toBeUndefined()
  })

  it('DC = 10 ＋ 敵方最高的等級 × 2：只算還在場上的敵人；敵人都退出了當 0 級', () => {
    const a = field([one({ weapon: 'pistol', skills: { athletics: 0 } })], [foe('minion', { grade: 1 }), foe('elite', { grade: 4 })])
    const me = a.ally(1)
    const dc = (run: ReturnType<A['run']>) => run.beats.find((b) => b.roll)!.roll!.dc
    const r1 = a.run(dice(5))
    act(a, 'flee').run(r1, me, null, { action: 'flee' })
    expect(dc(r1)).toBe(18)
    a.foe(2).out = 'fled'
    const r2 = a.run(dice(5))
    act(a, 'flee').run(r2, me, null, { action: 'flee' })
    expect(dc(r2)).toBe(12)
  })

  it('隊上運動與隱匿一樣高時用運動（體格）；隱匿比較高才用隱匿（反應）；全隊沒有人在場就什麼都不做', () => {
    const a = field([one({ weapon: 'pistol', skills: { athletics: 2, stealth: 2 } })])
    const r = a.run(dice(5))
    act(a, 'flee').run(r, a.ally(1), null, { action: 'flee' })
    expect(r.beats.find((b) => b.roll)!.roll).toMatchObject({ skill: 'athletics', attr: 'body' })
    const none = field([one({ weapon: 'pistol' })])
    none.ally(1).out = 'down'
    const rn = none.run()
    act(none, 'flee').run(rn, none.ally(1), null, { action: 'flee' })
    expect(rn.beats).toEqual([])
  })

  it('投降：花 0 點、一定成功、結果是 surrender；脫離的條件：不能脫離的戰鬥寫原因', () => {
    const a = field([one({ weapon: 'pistol' })])
    expect(act(a, 'surrender').cost(a.run(), a.ally(1))).toEqual({ ap: 0 })
    act(a, 'surrender').run(a.run(), a.ally(1), null, { action: 'surrender' })
    expect(a.battle.result).toMatchObject({ outcome: 'surrender' })
    expect(act(a, 'flee').blocks!(a.run(), a.ally(1))).toEqual([])
    a.battle.origin.escapable = false
    expect(act(a, 'flee').blocks!(a.run(), a.ally(1))).toEqual(['副本裡的戰鬥不能脫離，只能撤退。'])
    expect(act(a, 'flee').hold && act(a, 'surrender').hold).toBe(true)
  })
})

describe('白箱 監視的自動版本與 AI 分數（COMBAT_SYSTEM 1.3 節；ENEMIES 4.3 節）', () => {
  it('shoot.auto：手上沒有槍、近戰、彈匣空了不觸發（回 false）；能打就打一次、花彈匣 1 格', () => {
    const a = field([one({ weapon: 'pistol' })])
    const me = a.ally(1)
    const shoot = act(a, 'shoot')
    me.weapons = []
    expect(shoot.auto!(a.run(), me, a.foe(1))).toBe(false)
    me.weapons = [testWeapon('knife', 4)]
    expect(shoot.auto!(a.run(), me, a.foe(1))).toBe(false)
    me.weapons = [testWeapon('pistol', 4)]
    me.weapons[0]!.mag!.now = 0
    expect(shoot.auto!(a.run(), me, a.foe(1))).toBe(false)
    me.weapons[0]!.mag!.now = 2
    expect(shoot.auto!(a.run(dice(12)), me, a.foe(1))).toBe(true)
    expect(me.weapons[0]!.mag!.now).toBe(1)
  })

  it('melee.auto：不是近戰武器、不在近身不觸發；近身就打', () => {
    const a = field([one({ weapon: 'knife' })])
    const me = a.ally(1)
    const melee = act(a, 'melee')
    a.foe(1).slot = 2
    expect(melee.auto!(a.run(), me, a.foe(1))).toBe(false)
    a.foe(1).slot = 1
    expect(melee.auto!(a.run(dice(12)), me, a.foe(1))).toBe(true)
    me.weapons = [testWeapon('pistol', 4)]
    expect(melee.auto!(a.run(), me, a.foe(1))).toBe(false)
  })

  it('監視宣告：拿近戰武器是 melee、其餘是 shoot；已經在監視就灰掉；沒有武器的 AI 不列分數；所有目標命中率都低於 35% 才 1.5 分', () => {
    const a = field([one({ weapon: 'knife' })])
    const watch = act(a, 'watch')
    watch.run(a.run(), a.ally(1), null, { action: 'watch' })
    expect(a.ally(1).watch).toEqual({ action: 'melee' })
    expect(watch.blocks!(a.run(), a.ally(1))).toEqual(['已經在監視了。'])
    const b = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 99 })])
    watch.run(b.run(), b.ally(1), null, { action: 'watch' })
    expect(b.ally(1).watch).toEqual({ action: 'shoot' })
    expect(watch.aiScore!(b.run(), b.ally(1), null)).toBe(1.5)
    const c = field([one({ weapon: 'pistol' })], [foe('minion', { evade: -9 })])
    expect(watch.aiScore!(c.run(), c.ally(1), null)).toBeNull()
    c.ally(1).weapons = []
    expect(watch.aiScore!(c.run(), c.ally(1), null)).toBeNull()
    const none = field([one({ weapon: 'pistol' })])
    none.foe(1).out = 'down'
    expect(watch.aiScore!(none.run(), none.ally(1), null)).toBeNull()
  })

  it('射擊與近戰的 AI 分：命中率低於 35% 時 1、否則 2；打掩體裡的人，霰彈槍與重武器再 +0.5；沒有武器或沒有目標是 null', () => {
    const hi = field([one({ weapon: 'shotgun' })], [foe('minion', { evade: -9 })], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const shoot = act(hi, 'shoot')
    expect(shoot.aiScore!(hi.run(), hi.ally(1), hi.foe(1))).toBe(2.5)
    hi.ally(1).weapons[0]!.class = 'heavy'
    expect(shoot.aiScore!(hi.run(), hi.ally(1), hi.foe(1))).toBe(2.5)
    hi.ally(1).weapons[0]!.class = 'pistol'
    expect(shoot.aiScore!(hi.run(), hi.ally(1), hi.foe(1))).toBe(2)
    const lo = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 99 })])
    expect(act(lo, 'melee').aiScore!(lo.run(), lo.ally(1), lo.foe(1))).toBe(1)
    expect(shoot.aiScore!(lo.run(), lo.ally(1), null)).toBeNull()
    lo.ally(1).weapons = []
    expect(shoot.aiScore!(lo.run(), lo.ally(1), lo.foe(1))).toBeNull()
  })

  it('換彈的 AI 分：空了 3、只剩一格而容量大於 1 是 1、其餘與沒有彈匣的武器不列；沒有彈匣的 run 什麼都不做', () => {
    const a = field([one({ weapon: 'smg' })])
    const reload = act(a, 'reload')
    const me = a.ally(1)
    me.weapons[0]!.mag!.now = 0
    expect(reload.aiScore!(a.run(), me, null)).toBe(3)
    me.weapons[0]!.mag!.now = 1
    expect(reload.aiScore!(a.run(), me, null)).toBe(1)
    me.weapons[0]!.mag!.now = 2
    expect(reload.aiScore!(a.run(), me, null)).toBeNull()
    me.weapons = [testWeapon('sniper', 4)]
    me.weapons[0]!.mag!.now = 1
    expect(reload.aiScore!(a.run(), me, null)).toBeNull()
    me.weapons = [testWeapon('knife', 4)]
    expect(reload.aiScore!(a.run(), me, null)).toBeNull()
    expect(reload.blocks!(a.run(), me)).toEqual(['這把武器不用換彈。'])
    expect(() => reload.run(a.run(), me, null, { action: 'reload' })).not.toThrow()
    me.weapons = []
    expect(reload.blocks!(a.run(), me)).toEqual(['這把武器不用換彈。'])
  })
})

describe('白箱 射擊、打遮蔽、換武器的細節（COMBAT_SYSTEM 1.3、2.1、第 5 節）', () => {
  it('射擊的目標也列出敵方的無人機；命中率與距離在 hint；打無人機走 attackOverlay（不傷遮蔽）；沒有目標不做事', () => {
    const a = field([one({ weapon: 'pistol' })], [foe('minion', { evade: 10 })], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const d: BattleOverlay = { id: 'o1', side: 'foe', slot: 1, owner: 'f1', kind: 'attack', name: '無人機', hp: { now: 99, max: 99 }, armor: 0, evade: 5, used: false, down: false }
    a.battle.overlays.push(d, { ...d, id: 'o2', down: true }, { ...d, id: 'o3', side: 'ally' })
    const shoot = act(a, 'shoot')
    const targets = shoot.targets!(a.run(), a.ally(1))
    expect(targets.map((t) => t.target)).toEqual([{ unit: 'f1' }, { overlay: 'o1' }])
    expect(targets[0]!.hint).toMatchObject({ distance: 1, chance: expect.any(Number) })
    const hp = a.battle.cover.foe[0]!.hp
    shoot.run(a.run(dice(20)), a.ally(1), { overlay: 'o1' }, { action: 'shoot' })
    expect(d.hp.now).toBeLessThan(99)
    expect(a.battle.cover.foe[0]!.hp).toBe(hp)
    expect(() => shoot.run(a.run(), a.ally(1), null, { action: 'shoot' })).not.toThrow()
    expect(() => shoot.run(a.run(), a.ally(1), { side: 'foe', slot: 1 }, { action: 'shoot' })).not.toThrow()
    shoot.run(a.run(), a.ally(1), { overlay: 'zz' }, { action: 'shoot' })
  })

  it('射擊的原因：沒有武器、近戰武器、彈匣空了；狙擊槍一槍 3 點；沒有武器時行動點 2', () => {
    const a = field([one({ weapon: 'sniper' })])
    const shoot = act(a, 'shoot')
    expect(shoot.cost(a.run(), a.ally(1))).toEqual({ ap: 3 })
    a.ally(1).weapons = []
    expect(shoot.blocks!(a.run(), a.ally(1))).toEqual(['手上沒有武器。'])
    expect(shoot.cost(a.run(), a.ally(1))).toEqual({ ap: 2 })
    a.ally(1).weapons = [testWeapon('knife', 4)]
    expect(shoot.blocks!(a.run(), a.ally(1))).toEqual(['手上是近戰武器，不能射擊。'])
    a.ally(1).weapons = [testWeapon('pistol', 4)]
    a.ally(1).weapons[0]!.mag!.now = 0
    expect(shoot.blocks!(a.run(), a.ally(1))).toEqual(['彈匣空了，要先換彈。'])
    expect(act(a, 'melee').blocks!(a.run(), a.ally(1))).toEqual(['手上不是近戰武器。'])
    expect(shoot.picks!(a.run(), a.ally(1))).toEqual([])
  })

  it('掃射：做完之後目標還在場上才過定力（DC 14），沒過被壓制；被打倒就不擲；彈匣不夠 2 格擋下', () => {
    const w = { ...testWeapon('rifle', 4), traits: ['sweep'], mag: { now: 4, max: 4 } }
    const a = field([one({ weapons: [w], wield: 0 })], [foe('minion', { evade: 10 })])
    const shoot = act(a, 'shoot')
    const run = a.run(dice(12, 1, 1, 1, 1, 1, 2))
    shoot.run(run, a.ally(1), { unit: 'f1' }, { action: 'shoot', pick: { sweep: true } })
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(2)
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('suppressed')
    const dead = field([one({ weapons: [{ ...w, mag: { now: 4, max: 4 } }], wield: 0 })], [foe('minion', { evade: 10, hp: { now: 1, max: 1 } })])
    const r2 = dead.run(dice(20))
    shoot.run(r2, dead.ally(1), { unit: 'f1' }, { action: 'shoot', pick: { sweep: true } })
    expect(dead.foe(1).out).toBe('down')
    expect(r2.beats.some((b) => b.text.includes('定力'))).toBe(false)
    dead.ally(1).weapons[0]!.mag!.now = 1
    expect(() => shoot.run(dead.run(), dead.ally(1), { unit: 'f1' }, { action: 'shoot', pick: { sweep: true } })).toThrow(/掃射要彈匣裡有 2 格/)
    expect(shoot.picks!(dead.run(), dead.ally(1))[0]!.options[0]!.blocks).toEqual(['掃射要彈匣裡有 2 格。'])
  })

  it('打遮蔽：花彈匣 1 格；傷害 = 骰面合計 × 倍率加倍（至少 ×1）；沒有武器、沒有目標、目標不是格子就不做事；列出的只有有遮蔽而且不是煙霧的格', () => {
    const a = field([one({ weapon: 'rifle' })], [foe()], { cover: { ally: [0, 0, 0, 0], foe: [2, 1, 0, 0] } })
    a.battle.cover.foe[1]!.soft = { kind: 'smoke' }
    const hit = act(a, 'hit_cover')
    expect(hit.targets!(a.run(), a.ally(1)).map((t) => t.target)).toEqual([{ side: 'foe', slot: 1 }])
    const me = a.ally(1)
    const before = a.battle.cover.foe[0]!.hp
    hit.run(a.run(dice(3, 3, 3, 3)), me, { side: 'foe', slot: 1 }, { action: 'hit_cover' })
    expect(me.weapons[0]!.mag!.now).toBe(2)
    expect(a.battle.cover.foe[0]!.hp).toBe(before - 12 * 1) // 4d6 各 3，倍率 0.5 × 2 = 1
    me.weapons = []
    expect(() => hit.run(a.run(), me, { side: 'foe', slot: 1 }, { action: 'hit_cover' })).not.toThrow()
    expect(hit.blocks!(a.run(), me)).toEqual(['手上沒有武器。'])
    me.weapons = [testWeapon('knife', 4)]
    expect(hit.blocks!(a.run(), me)).toEqual(['近戰武器打不了遮蔽。'])
    me.weapons = [testWeapon('pistol', 4)]
    hit.run(a.run(), me, null, { action: 'hit_cover' })
    hit.run(a.run(), me, { unit: 'f1' }, { action: 'hit_cover' })
    expect(me.weapons[0]!.mag!.now).toBe(2)
  })

  it('換武器：只有一把時灰掉、picks 是空的；不指定換到下一把（繞回第一把）；指定的那一把已經拿在手上也擋', () => {
    const a = field([one({ weapon: 'pistol' })])
    const me = a.ally(1)
    const swap = act(a, 'swap')
    expect(swap.blocks!(a.run(), me)).toEqual(['只有一把武器。'])
    expect(swap.picks!(a.run(), me)).toEqual([])
    me.weapons.push(testWeapon('smg', 4), testWeapon('knife', 4))
    expect(swap.picks!(a.run(), me)[0]!.options.map((o) => o.blocks)).toEqual([['這一把已經拿在手上。'], [], []])
    swap.run(a.run(), me, null, { action: 'swap' })
    swap.run(a.run(), me, null, { action: 'swap' })
    swap.run(a.run(), me, null, { action: 'swap' })
    expect(me.wield).toBe(0)
    expect(() => swap.run(a.run(), me, null, { action: 'swap', pick: { weapon: 0 } })).toThrow(/沒有這把武器/)
    swap.run(a.run(), me, null, { action: 'swap', pick: { weapon: 2 } })
    expect(me.wield).toBe(2)
  })
})

describe('白箱 制伏（COMBAT_SYSTEM 第 7 節）', () => {
  const lost = (u: BattleUnit) => u.statuses.push({ id: LOSE_TURN, until: { at: 'turn_start', of: u.id, turns: 1 } })

  it('DC = 10 ＋ 目標的等級 × 2，精英再 +2、首領再 +4；targets 的 hint 帶 dc', () => {
    const a = field([one({ weapon: 'knife', quick: quick(['it_tie', 1]) })], [foe('minion', { grade: 2 })])
    const sub = act(a, 'subdue')
    expect(sub.targets!(a.run(), a.ally(1))[0]!.hint).toEqual({ dc: 14 })
    a.foe(1).rank = 'elite'
    a.foe(1).grade = 3
    expect(sub.targets!(a.run(), a.ally(1))[0]!.hint).toEqual({ dc: 18 })
    a.foe(1).rank = 'boss'
    expect(sub.targets!(a.run(), a.ally(1))[0]!.hint).toEqual({ dc: 20 })
  })

  it('檢定失敗：束帶不消耗、這個人沒有退出；沒有束帶或鎖橋器（數量 0 與沒有 restraint 標籤的）灰掉', () => {
    const a = field([one({ weapon: 'knife', quick: quick(['it_tie', 1]), skills: { brawl: 0 } })])
    lost(a.foe(1))
    const sub = act(a, 'subdue')
    sub.run(a.run(dice(2)), a.ally(1), { unit: 'f1' }, { action: 'subdue' })
    expect(a.foe(1).out).toBeUndefined()
    expect(a.ally(1).quick).toEqual(quick(['it_tie', 1]))
    const b = field([one({ weapon: 'knife', quick: quick(['it_tie', 0], ['it_plain', 1], ['it_ghost', 1]) })])
    expect(act(b, 'subdue').blocks!(b.run(), b.ally(1))).toEqual(['快取格裡沒有束帶或鎖橋器。'])
  })

  it('成功：束帶用完就從快取格拿掉；制伏不是 unit 目標或沒有目標什麼都不做', () => {
    const a = field([one({ weapon: 'knife', quick: quick(['it_tie', 1]), skills: { brawl: 50 } })])
    lost(a.foe(1))
    const sub = act(a, 'subdue')
    expect(() => sub.run(a.run(), a.ally(1), null, { action: 'subdue' })).not.toThrow()
    expect(() => sub.run(a.run(), a.ally(1), { side: 'foe', slot: 1 }, { action: 'subdue' })).not.toThrow()
    sub.run(a.run(dice(15)), a.ally(1), { unit: 'f1' }, { action: 'subdue' })
    expect(a.foe(1).out).toBe('subdued')
    expect(a.ally(1).quick).toEqual([])
  })

  it('AI：只有 capture 打法才有分數 4；不是 capture 回 null；aiTarget：AI 挑的就是制伏得了的用它、否則改第一個制伏得了的、都沒有就用 AI 挑的、沒有目標是 null；aiSlotScore 只有 capture 才加', () => {
    const cap = { focus: 1, floor: 1, mode: 'capture' as const, fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 }
    const a = field([one({ weapon: 'pistol' }), one({}, 2)], [foe('minion', { ai: cap, quick: quick(['it_tie', 1]) })])
    const f = a.foe(1)
    const sub = act(a, 'subdue')
    expect(sub.aiScore!(a.run(), f, a.ally(1))).toBe(4)
    expect(sub.aiScore!(a.run(), f, null)).toBeNull()
    expect(sub.aiScore!(a.run(), a.ally(1), a.foe(1))).toBeNull()
    lost(a.ally(1))
    a.ally(1).layers = a.ally(1).layersMax
    expect(sub.aiTarget!(a.run(), f, a.ally(2))).toEqual({ unit: 'a1' })
    expect(sub.aiTarget!(a.run(), f, a.ally(1))).toEqual({ unit: 'a1' })
    a.ally(1).statuses = []
    expect(sub.aiTarget!(a.run(), f, a.ally(2))).toEqual({ unit: 'a2' })
    expect(sub.aiTarget!(a.run(), f, null)).toBeNull()
    expect(sub.aiSlotScore!(a.run(), f, 1)).toBe(0)
    lost(a.ally(1))
    expect(sub.aiSlotScore!(a.run(), f, 1)).toBe(4)
    expect(sub.aiSlotScore!(a.run(), f, 2)).toBe(0)
    f.ai = { ...cap, mode: 'lethal' }
    expect(sub.aiSlotScore!(a.run(), f, 1)).toBe(0)
  })

  it('制伏的原因寫的是缺的條件（對方沒有在失去回合、不在近身、精英與首領餘韻沒疊滿）；我方被制伏時對精英一樣的條件', () => {
    const a = field([one({ weapon: 'knife', quick: quick(['it_tie', 1]) })], [foe('elite')])
    a.foe(1).slot = 2
    const sub = act(a, 'subdue')
    expect(sub.targets!(a.run(), a.ally(1))[0]!.blocks).toEqual([
      '對方沒有在過載、失去回合。', '要在近身：雙方都站在第 1 格。', '精英與首領要餘韻疊滿才制伏得了（現在 0／2 層）。',
    ])
  })
})

describe('白箱 道具（COMBAT_SYSTEM 1.3 節；ITEMS 5.2 節；EQUIPMENT 4.1 節）', () => {
  const equipped = (...items: Array<[string, number]>) => field([one({ weapon: 'pistol', quick: quick(...items) }), one({}, 2)])
  const use = (a: A, id: string, target: unknown, d?: number[]) => act(a, 'item').run(a.run(d), a.ally(1), target as never, { action: 'item', pick: { item: id } })

  it('usableItems：數量 0、沒有 use、不在這個戰場的、內容裡沒有的都不算', () => {
    const a = equipped(['it_heal', 0], ['it_plain', 1], ['it_net', 1], ['it_ghost', 1], ['it_cool', 1])
    expect(usableItems(a.k, a.ally(1), 'meat').map((x) => x.slot.item)).toEqual(['it_cool'])
    expect(usableItems(a.k, a.ally(1), 'net').map((x) => x.slot.item)).toEqual(['it_net', 'it_cool'])
    expect(act(a, 'item').blocks!(a.run(), a.ally(1))).toEqual([])
    const none = equipped(['it_plain', 1])
    expect(act(none, 'item').blocks!(none.run(), none.ally(1))).toEqual(['快取格裡沒有能用的道具。'])
    expect(act(none, 'item').picks!(none.run(), none.ally(1))).toEqual([])
    expect(act(none, 'item').cost(none.run(), none.ally(1))).toEqual({ ap: 1 })
  })

  it('對一個敵人用的道具（foe）：選項灰掉寫「現在還不能這樣用」；run 也擋；丟在敵方一格的（foe_slot，M1b-ordnance）可以用：選項適用敵方四格、run 不擋、不丟在我方', () => {
    const a = equipped(['it_throw', 1], ['it_throw_slot', 1])
    const opts = act(a, 'item').picks!(a.run(), a.ally(1))[0]!.options
    expect(opts.map((o) => o.blocks)).toEqual([['這個道具現在還不能這樣用。'], []])
    expect(opts.map((o) => o.for)).toEqual([[], [1, 2, 3, 4].map((slot) => ({ side: 'foe', slot }))])
    expect(() => use(a, 'it_throw', { unit: 'f1' })).toThrow(/現在還不能這樣用/)
    expect(() => use(a, 'it_throw_slot', { side: 'foe', slot: 1 })).not.toThrow()
    const b = equipped(['it_throw', 1], ['it_throw_slot', 1])
    expect(() => use(b, 'it_throw_slot', { side: 'ally', slot: 1 })).toThrow(/丟在敵方/)
    expect(act(b, 'item').targets!(b.run(), b.ally(1)).map((t) => t.blocks.length)).toEqual([1, 1, 0, 0, 0, 0])
  })

  it('目標：沒給目標丟「要選一個目標」；不相鄰的隊友灰掉；格子只有格子用的道具才列；自己用的對隊友寫原因', () => {
    const a = equipped(['it_cool', 1])
    expect(() => act(a, 'item').run(a.run(), a.ally(1), null, { action: 'item' })).toThrow(/要選一個目標/)
    const t = act(a, 'item').targets!(a.run(), a.ally(1))
    expect(t.map((x) => x.blocks)).toEqual([[], ['快取格裡沒有可以用在別人身上的道具。']])
    a.ally(2).slot = 3
    expect(act(a, 'item').targets!(a.run(), a.ally(1))[1]!.blocks).toEqual(['要相鄰才用得到。', '快取格裡沒有可以用在別人身上的道具。'])
    const s = equipped(['it_smoke', 1])
    expect(act(s, 'item').targets!(s.run(), s.ally(1)).filter((x) => 'slot' in x.target)).toHaveLength(4)
    const sa = equipped(['it_slot_ally', 1])
    expect(act(sa, 'item').targets!(sa.run(), sa.ally(1)).filter((x) => 'slot' in x.target)).toHaveLength(4)
  })

  it('替隊友用花 ap_other（沒寫就和自己用一樣）；選了不存在的道具、沒選而有兩種道具都擋', () => {
    const a = equipped(['it_heal', 1], ['it_cool', 1])
    const item = act(a, 'item')
    const cost = (input: Record<string, unknown>) => item.cost(a.run(), a.ally(1), { action: 'item', ...input } as never).ap
    expect(cost({ pick: { item: 'it_heal' }, target: { unit: 'a2' } })).toBe(2)
    expect(cost({ pick: { item: 'it_heal' }, target: { unit: 'a1' } })).toBe(1)
    expect(cost({ pick: { item: 'it_cool' }, target: { unit: 'a2' } })).toBe(1)
    expect(cost({ pick: { item: 'it_ghost' } })).toBe(1)
    expect(cost({})).toBe(1)
    expect(() => item.run(a.run(), a.ally(1), { unit: 'a1' }, { action: 'item' })).toThrow(/要選用哪一個道具/)
    expect(() => use(a, 'it_ghost', { unit: 'a1' })).toThrow(/快取格裡沒有這個道具/)
  })

  it('效果：heal 壞掉的數量當 0；餘韻夾進 0～上限、沒有變化不寫紀錄；cleanse 用 by 或 status 或都沒有；vent 壞掉的數量當 0', () => {
    const a = equipped(['it_heal_nan', 1], ['it_cool', 1], ['it_cool_up', 1], ['it_cool_zero', 1], ['it_clean', 1])
    const me = a.ally(1)
    me.hp!.now = 10
    me.load!.now = 7
    use(a, 'it_heal_nan', { unit: 'a1' })
    expect([me.hp!.now, me.load!.now]).toEqual([10, 7])
    me.layers = 2
    const r = a.run()
    act(a, 'item').run(r, me, { unit: 'a1' }, { action: 'item', pick: { item: 'it_cool' } })
    expect([me.layers, me.load!.now]).toEqual([1, 2])
    expect(r.beats.some((b) => b.text.includes('餘韻 −1 層'))).toBe(true)
    use(a, 'it_cool_up', { unit: 'a1' })
    expect(me.layers).toBe(me.layersMax)
    const quiet = a.run()
    act(a, 'item').run(quiet, me, { unit: 'a1' }, { action: 'item', pick: { item: 'it_cool_zero' } })
    expect(quiet.beats.filter((b) => b.text.includes('餘韻'))).toEqual([])
    const clean = a.run()
    clean.applyStatus(me, 'bleeding')
    clean.applyStatus(me, 'dazed')
    act(a, 'item').run(clean, me, { unit: 'a1' }, { action: 'item', pick: { item: 'it_clean' } })
    expect(me.statuses.map((s) => s.id)).toEqual([])
  })

  it('煙霧彈（target: slot）：兩個效果（沒寫回合數的不會散；寫了的照回合）；用掉最後一個就從快取格拿掉；效果給了對人的目標就略過', () => {
    const a = equipped(['it_smoke', 1])
    use(a, 'it_smoke', { side: 'ally', slot: 2 })
    expect(a.battle.cover.ally[1]!.soft).toMatchObject({ kind: 'crowd', until: a.battle.round + 1 })
    expect(a.ally(1).quick).toEqual([])
    const ops = a.k.battle
    expect(() => ops.getItemOp('soft_cover')!({ run: a.run(), user: a.ally(1), target: { unit: 'a1' }, item: 'x' }, { kind: 'smoke' })).not.toThrow()
    expect(() => ops.getItemOp('heal')!({ run: a.run(), user: a.ally(1), target: { side: 'ally', slot: 1 }, item: 'x' }, { amount: 5 })).not.toThrow()
    expect(() => ops.getItemOp('afterglow')!({ run: a.run(), user: a.ally(1), target: { side: 'ally', slot: 1 }, item: 'x' }, { layers: 1 })).not.toThrow()
    expect(() => ops.getItemOp('cleanse')!({ run: a.run(), user: a.ally(1), target: { side: 'ally', slot: 1 }, item: 'x' }, { by: 'x' })).not.toThrow()
    expect(() => ops.getItemOp('vent')!({ run: a.run(), user: a.ally(1), target: { side: 'ally', slot: 1 }, item: 'x' }, { amount: 5 })).not.toThrow()
  })

  it('道具寫了沒有人註冊的效果：載入時（ready）擋下，訊息寫出是哪一個道具；run 時也丟錯', () => {
    const k = createKernel([combatFeature])
    k.content.loadPack({ id: 'x', content: { battle_status: TEST_STATUSES, item: [ITEM('it_weird', { use: { ap: 1, target: 'self', effects: [{ op: 'explode' }] } })] } })
    expect(() => readyFeatures(k)).toThrow(/item\/it_weird：不認得的效果 explode/)
    const a = arena(duel([one({ weapon: 'pistol', quick: quick(['it_weird', 1]) })], [foe()]), [combatFeature], (kk) => kk.content.loadPack({ id: 'y', content: { battle_status: TEST_STATUSES, item: [ITEM('it_weird', { use: { ap: 1, target: 'self', effects: [{ op: 'explode' }] } })] } }))
    expect(() => act(a, 'item').run(a.run(), a.ally(1), { unit: 'a1' }, { action: 'item', pick: { item: 'it_weird' } })).toThrow(/不認得的效果 explode/)
  })
})

describe('白箱 重創與戰後（COMBAT_SYSTEM 第 6、7 節）', () => {
  const hit = (a: A, t: BattleUnit, part?: string, aimed = false, by = 'f1') => a.k.battle.emit('wound', { run: a.run(dice(5)), attacker: a.battle.units[by]!, target: t, aimed, ...(part ? { part } : {}) })

  it('部位沒指定：擲 0～1 對到肢體、頭、軀幹、橋各佔四分之一；指定的部位照指定', () => {
    const seen = new Set<string>()
    for (const roll of [0.1, 0.3, 0.6, 0.9]) {
      const a = field([one({ weapon: 'pistol' })], [foe('elite')])
      a.k.battle.emit('wound', { run: a.run([Math.round(roll * 100)]), attacker: a.foe(1), target: a.ally(1), aimed: false })
      for (const p of Object.keys(a.ally(1).wounds)) seen.add(p)
    }
    expect([...seen].sort()).toEqual(['bridge', 'head', 'limb', 'torso'])
    const b = field([one({ weapon: 'pistol' })], [foe('elite')])
    hit(b, b.ally(1), 'head')
    expect(b.ally(1).wounds).toEqual({ head: 1 })
  })

  it('輕的效果每次都給（橋：感載 +10 不乘敏感度）；對敵人只算輕的一級；存檔規則可以關掉我方的重級', () => {
    const a = field([one({ weapon: 'pistol' })], [foe('elite')])
    const f = a.foe(1)
    hit(a, f, 'limb', false, 'a1')
    hit(a, f, 'limb', false, 'a1')
    expect(f.wounds).toEqual({ limb: 1 })
    const b = field([one({ weapon: 'pistol' })], [foe('elite')])
    b.ally(1).sensitivity = 0
    hit(b, b.ally(1), 'bridge')
    expect(b.ally(1).load!.now).toBe(10)
    b.state.rules.heavyWounds = false
    hit(b, b.ally(1), 'bridge')
    expect(b.ally(1).wounds).toEqual({ bridge: 1 })
    expect(b.ally(1).layersMax).toBe(3)
  })

  it('軀幹的重創：沒有角色的單位把整個護甲當成身上那一件；生命上限 −5 最少剩 1', () => {
    const a = field([one({ weapon: 'pistol', armor: 5 })], [foe('elite')])
    const me = a.ally(1)
    me.hp = { now: 3, max: 4 }
    hit(a, me, 'torso')
    hit(a, me, 'torso')
    expect(me.armor).toBe(0)
    expect(me.hp).toEqual({ now: 1, max: 1 })
    const noHp = field([one({ weapon: 'pistol', hp: undefined })], [foe('elite')])
    hit(noHp, noHp.ally(1), 'torso')
    expect(() => hit(noHp, noHp.ally(1), 'torso')).not.toThrow()
  })

  it('戰後：我方沒有角色的單位不寫重傷；頭、肢體、軀幹的重傷各寫一行與一個狀態，橋不留；要活的沒有人要時不寫', () => {
    const a = field([one({ weapon: 'pistol' })], [foe()])
    a.ally(1).wounds = { limb: 2, head: 2, torso: 2, bridge: 2 }
    const state = structuredClone(a.state)
    const ctx = (battle = a.battle, outcome = 'win') => ({ k: a.k, state, battle, outcome })
    expect(a.k.battle.endExtras(ctx())).toEqual([{ changes: [], lines: [] }])
    a.battle.units.a1!.actor = 'pc'
    a.state.actors.pc = state.actors.pc!
    const extras = a.k.battle.endExtras({ k: a.k, state: a.state, battle: a.battle, outcome: 'win' })
    expect(extras[0]!.lines).toEqual(['重傷：你的肢體（要治療）', '重傷：你的頭（要治療）', '重傷：你的軀幹（要治療）'])
    expect(extras[0]!.changes).toEqual([
      { op: 'actor.condition', id: 'pc', condition: 'wound_limb' }, { op: 'actor.condition', id: 'pc', condition: 'wound_head' }, { op: 'actor.condition', id: 'pc', condition: 'wound_torso' },
    ])
  })

  it('要活的：只在贏的時候寫；每個都制伏或投降才算達成；單位已經不存在的名字用 id', () => {
    const a = field([one({ weapon: 'pistol' })], [foe('minion', { name: '甲' }), foe('minion', { name: '乙' })])
    a.battle.origin.capture = ['f1', 'f2', 'f9']
    const run = (outcome: string) => a.k.battle.endExtras({ k: a.k, state: a.state, battle: a.battle, outcome }).flatMap((e) => e.lines ?? [])
    expect(run('lose')).toEqual([])
    a.foe(1).out = 'subdued'
    a.foe(2).out = 'surrendered'
    expect(run('win')).toEqual(['要活的：沒有達成（f9被打倒了）'])
    a.battle.origin.capture = ['f1', 'f2']
    expect(run('win')).toEqual(['要活的：達成'])
    a.foe(2).out = 'down'
    expect(run('win')).toEqual(['要活的：沒有達成（乙被打倒了）'])
  })
})
