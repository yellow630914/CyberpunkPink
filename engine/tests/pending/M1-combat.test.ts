// 驗收測試：dev/work/M1-combat.md（cpp-feature）。工單做完之前照預期失敗（features/combat 還不存在）。
// 規格：COMBAT_SYSTEM 1.3 節（行動表）、第 5 節（彈匣、輕機槍的掃射、打遮蔽）、第 6 節（重創）、第 7 節（制伏）、
// 8.5 節（投降）；ENEMIES 4.3 節（AI 的分數）；ITEMS 5.2 節（道具）；docs/plan/PLAN.md 5.5 節第一項（制伏灰掉要寫出缺哪個條件）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack } from '../../src'
import { END_TURN, MOVE } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { makeBattleGame, playOut, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const ITEM = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, desc: `${name}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'combat_test',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '那隻手或腳的檢定 −2，到戰鬥結束。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }],
    item: [
      ITEM('it_zip_tie', '束帶', { tags: ['restraint'] }),
      ITEM('it_medgel_1', '急救凝膠', { use: { ap: 1, ap_other: 2, target: 'ally', modes: ['meat'], effects: [{ op: 'heal', amount: 8 }, { op: 'cleanse', by: 'first_aid' }] } }),
      ITEM('it_coolant_1', '冷卻劑', { use: { ap: 1, target: 'self', modes: ['meat'], effects: [{ op: 'afterglow', layers: -1 }, { op: 'vent', amount: 4 }] } }),
      ITEM('it_smoke_1', '煙霧彈', { use: { ap: 1, target: 'slot', modes: ['meat'], effects: [{ op: 'soft_cover', kind: 'smoke', rounds: 2 }] } }),
    ],
  },
}
const FEATURES = [combatFeature]
const game = (battle: BattleSetup, seed = 7) => makeBattleGame({ features: FEATURES, content: [PACK], battle, seed }).game
type G = ReturnType<typeof game>
/** 把回合轉到某個人，行動點補滿（測試用：直接改狀態；之後的每一步照常經過提交）。 */
const turnTo = (g: G, id: string, control: 'player' | 'ai' = 'player'): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = control
  return u
}
const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)!
const targetOf = (g: G, action: string, unit: string) => opt(g, action).targets.find((t) => 'unit' in t.target && t.target.unit === unit)!
const tags = (reports: Array<{ timeline: Array<{ tag?: string }> }>) => reports.flatMap((r) => r.timeline.map((b) => b.tag))

describe('行動表（COMBAT_SYSTEM 1.3 節）', () => {
  it('只有這張表上的行動，照圓環的圈排：內環攻擊、中環補充與切換、外環戰術；結束回合、脫離、投降在圓環外面', () => {
    const g = game(duel([one({ weapon: 'rifle' })], [foe()]))
    turnTo(g, 'a1')
    const actions = g.battleOptions()!.actions
    expect(actions.map((a) => a.id)).toEqual(['shoot', 'melee', 'reload', 'swap', 'item', MOVE, 'hit_cover', 'watch', 'subdue', END_TURN, 'flee', 'surrender'])
    expect(Object.fromEntries(actions.map((a) => [a.id, a.group]))).toEqual({
      shoot: 'attack', melee: 'attack', reload: 'supply', swap: 'supply', item: 'supply',
      [MOVE]: 'tactic', hit_cover: 'tactic', watch: 'tactic', subdue: 'tactic', [END_TURN]: 'system', flee: 'system', surrender: 'system',
    })
    expect(Object.fromEntries(actions.map((a) => [a.id, a.cost.ap]))).toEqual({ shoot: 2, melee: 2, reload: 1, swap: 1, item: 1, [MOVE]: 1, hit_cover: 2, watch: 2, subdue: 2, [END_TURN]: 0, flee: 2, surrender: 0 })
    // 脫離與投降要長按才生效
    expect(actions.filter((a) => a.hold).map((a) => a.id)).toEqual(['flee', 'surrender'])
    for (const a of actions) expect(a.desc.length, a.id).toBeGreaterThan(5)
    // 沒有瞄準、連射、側襲這些基本行動（它們是技能）
    for (const id of ['aim', 'burst', 'flank']) expect(actions.some((a) => a.id === id)).toBe(false)
  })

  it('射擊：花彈匣 1 格；手上是近戰武器或彈匣空了不能射，寫出原因；狙擊槍的一槍花 3 點', () => {
    const g = game(duel([one({ weapon: 'rifle' }), one({ weapon: 'sniper' }, 2), one({ weapon: 'knife' }, 3)], [foe(), foe()]))
    const me = turnTo(g, 'a1')
    expect(opt(g, 'shoot')).toMatchObject({ ok: true, cost: { ap: 2 }, target: 'foe' })
    const r = g.battleAct({ action: 'shoot', target: { unit: 'f2' } })
    expect(r.status).toBe('applied')
    expect(g.battle!.units.a1!.weapons[0]!.mag!.now).toBe(2)
    expect(g.battle!.units.a1!.ap.now).toBe(me.ap.max - 2)
    expect(tags(r.reports).some((t) => t === 'hit' || t === 'miss' || t === 'crit')).toBe(true)
    turnTo(g, 'a1').weapons[0]!.mag!.now = 0
    expect(opt(g, 'shoot').blocks).toEqual(['彈匣空了，要先換彈。'])
    expect(opt(g, 'melee').blocks).toEqual(['手上不是近戰武器。'])
    turnTo(g, 'a2')
    expect(opt(g, 'shoot').cost.ap).toBe(3)
    turnTo(g, 'a3')
    expect(opt(g, 'shoot').blocks).toEqual(['手上是近戰武器，不能射擊。'])
    expect(opt(g, 'reload').blocks).toEqual(['這把武器不用換彈。'])
  })

  it('近戰：只能打近身（雙方的第 1 格）；打不到的目標灰掉並寫出原因', () => {
    const g = game(duel([one({ weapon: 'knife' }), one({ weapon: 'knife' }, 2)], [foe(), foe()]))
    turnTo(g, 'a1')
    expect(targetOf(g, 'melee', 'f1').blocks).toEqual([])
    expect(targetOf(g, 'melee', 'f2').blocks).toEqual(['近戰只能打近身（雙方的第 1 格）。'])
    expect(g.battleAct({ action: 'melee', target: { unit: 'f2' } })).toMatchObject({ status: 'refused', reasons: ['近戰只能打近身（雙方的第 1 格）。'] })
    expect(g.battleAct({ action: 'melee', target: { unit: 'f1' } }).status).toBe('applied')
    turnTo(g, 'a2')
    expect(opt(g, 'melee').ok).toBe(false)
    expect(targetOf(g, 'melee', 'f1').blocks).toEqual(['近戰只能打近身（雙方的第 1 格）。'])
  })

  it('換彈把彈匣補滿；換武器換成另一把（只有一把時不能換）', () => {
    const two = one({ weapon: 'rifle' })
    two.weapons.push(testWeapon('pistol', 4))
    const g = game(duel([two, one({ weapon: 'pistol' }, 2)], [foe()]))
    turnTo(g, 'a1').weapons[0]!.mag!.now = 1
    expect(g.battleAct({ action: 'reload' }).status).toBe('applied')
    expect(g.battle!.units.a1!.weapons[0]!.mag).toEqual({ now: 3, max: 3 })
    expect(opt(g, 'reload').blocks).toEqual(['彈匣是滿的。'])
    expect(g.battleAct({ action: 'swap' }).status).toBe('applied')
    expect(g.battle!.units.a1!.wield).toBe(1)
    expect(g.battleAct({ action: 'swap', pick: { weapon: 0 } }).status).toBe('applied')
    expect(g.battle!.units.a1!.wield).toBe(0)
    expect(g.battle!.units.a1!.ap.now).toBe(g.battle!.units.a1!.ap.max - 3)
    turnTo(g, 'a2')
    expect(opt(g, 'swap').blocks).toEqual(['只有一把武器。'])
  })

  it('打遮蔽：不打人、不擲命中，倍率加倍（至少 ×1）；花彈匣 1 格；只能選有遮蔽的格', () => {
    const g = game(duel([one({ weapon: 'pistol' })], [foe()], { ally: [0, 0, 0, 0], foe: [2, 0, 1, 0] }))
    turnTo(g, 'a1')
    expect(opt(g, 'hit_cover').targets.map((t) => [t.target, t.blocks.length === 0])).toEqual([[{ side: 'foe', slot: 1 }, true], [{ side: 'foe', slot: 3 }, true]])
    const r = g.battleAct({ action: 'hit_cover', target: { side: 'foe', slot: 1 } })
    expect(r.status).toBe('applied')
    const beats = r.reports.flatMap((x) => x.timeline)
    expect(beats.some((b) => b.tag === 'hit' || b.tag === 'miss' || b.tag === 'crit')).toBe(false)
    // 手槍 3d6、遮蔽倍率 ×0.25：加倍是 ×0.5，至少算 ×1 → 3～18
    const hit = beats.find((b) => b.tag === 'cover.hit')!.data as { amount: number; side: string; slot: number }
    expect(hit).toMatchObject({ side: 'foe', slot: 1 })
    expect(hit.amount).toBeGreaterThanOrEqual(3)
    expect(hit.amount).toBeLessThanOrEqual(18)
    expect(g.battle!.units.a1!.weapons[0]!.mag!.now).toBe(1)
    expect(g.battle!.cover.foe[0]!.hp).toBe(30 - hit.amount)
    const knife = game(duel([one({ weapon: 'knife' })], [foe()], { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }))
    turnTo(knife, 'a1')
    expect(opt(knife, 'hit_cover').blocks).toEqual(['近戰武器打不了遮蔽。'])
  })

  it('監視：宣告時花 2 點；到下一回合開始前第一次有敵人站上暴露的格子就自動攻擊一次，不另花行動點、彈匣照扣', () => {
    const g = game(duel([one({ weapon: 'pistol' })], [foe(), foe()], { ally: [1, 0, 0, 0], foe: [1, 1, 0, 0] }))
    const me = turnTo(g, 'a1')
    expect(g.battleAct({ action: 'watch' }).status).toBe('applied')
    expect(g.battle!.units.a1!.watch).toEqual({ action: 'shoot' })
    expect(g.battle!.units.a1!.ap.now).toBe(me.ap.max - 2)
    expect(opt(g, 'watch').blocks).toEqual(['已經在監視了。'])
    turnTo(g, 'f2')
    const r = g.battleAct({ action: MOVE, target: { side: 'foe', slot: 3 } })
    expect(tags(r.reports)).toEqual(expect.arrayContaining(['move', 'watch.fire']))
    expect(g.battle!.units.a1!.watch).toBeUndefined()
    expect(g.battle!.units.a1!.weapons[0]!.mag!.now).toBe(1)
    expect(g.battle!.units.a1!.ap.now).toBe(me.ap.max - 2)
  })
})

describe('制伏（COMBAT_SYSTEM 第 7 節）：灰掉時寫出缺的是哪個條件', () => {
  const setup = (rank: 'minion' | 'elite' | 'boss', quick = [{ item: 'it_zip_tie', qty: 1 }], brawl = 40) => {
    const g = game(duel([one({ weapon: 'knife', quick, skills: { brawl, firearms: 2 } }), one({ weapon: 'pistol', quick }, 2)], [foe(rank), foe('minion')]))
    turnTo(g, 'a1')
    return g
  }
  const stun = (g: G, id: string, layers?: number) => {
    const t = g.state.battle!.units[id]!
    t.statuses.push({ id: 'lose_turn', until: { at: 'turn_start', of: id, turns: 1 } })
    if (layers !== undefined) t.layers = layers
    return t
  }

  it('每一個缺的條件各一句：對方沒有在過載、不在近身、精英與首領的餘韻沒有疊滿、快取格裡沒有束帶或鎖橋器', () => {
    const g = setup('elite', [])
    expect(opt(g, 'subdue').ok).toBe(false)
    expect(opt(g, 'subdue').blocks).toEqual(['快取格裡沒有束帶或鎖橋器。'])
    expect(targetOf(g, 'subdue', 'f1').blocks).toEqual(['對方沒有在過載、失去回合。', '精英與首領要餘韻疊滿才制伏得了（現在 0／2 層）。'])
    expect(targetOf(g, 'subdue', 'f2').blocks).toEqual(['對方沒有在過載、失去回合。', '要在近身：雙方都站在第 1 格。'])
    // 試玩時的那一幕：精英過載了、只有一層 → 只剩「餘韻沒有疊滿」這一條
    stun(g, 'f1', 1)
    expect(targetOf(g, 'subdue', 'f1').blocks).toEqual(['精英與首領要餘韻疊滿才制伏得了（現在 1／2 層）。'])
    expect(g.battleAct({ action: 'subdue', target: { unit: 'f1' } })).toMatchObject({ status: 'refused', reasons: ['快取格裡沒有束帶或鎖橋器。'] })
    // 動手的人不在第 1 格
    turnTo(g, 'a2')
    expect(targetOf(g, 'subdue', 'f1').blocks).toEqual(['要在近身：雙方都站在第 1 格。', '精英與首領要餘韻疊滿才制伏得了（現在 1／2 層）。'])
  })

  it('條件都齊了就能按；格鬥檢定對 10 ＋ 目標的等級 × 2（精英再 +2、首領再 +4）；成功就綁起來、退出戰鬥', () => {
    for (const [rank, dc, layers] of [['minion', 12, 0], ['elite', 14, 2], ['boss', 16, 4]] as const) {
      const g = setup(rank)
      stun(g, 'f1', layers)
      expect(opt(g, 'subdue').ok, rank).toBe(true)
      expect(targetOf(g, 'subdue', 'f1')).toMatchObject({ blocks: [], hint: { dc } })
      const r = g.battleAct({ action: 'subdue', target: { unit: 'f1' } })
      expect(r.status).toBe('applied')
      const roll = r.reports[0]!.timeline.find((b) => b.roll)!.roll!
      expect(roll.dc).toBe(dc)
      expect(roll.skill).toBe('brawl')
      // 格鬥 40：只有自然 1 會失手
      if (roll.natural !== 1) {
        expect(g.battle!.units.f1!.out).toBe('subdued')
        expect(tags(r.reports)).toContain('subdue')
      }
      expect(g.battle!.units.a1!.ap.now).toBe(g.battle!.units.a1!.ap.max - 2)
    }
  })

  it('雜兵不必灌到倒下就抓得到：過載、失去回合的那一刻就可以；沒過檢定只是這 2 點不退', () => {
    const g = setup('minion', [{ item: 'it_zip_tie', qty: 1 }], -40)
    stun(g, 'f1', 1)
    const r = g.battleAct({ action: 'subdue', target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    const roll = r.reports[0]!.timeline.find((b) => b.roll)!.roll!
    if (roll.natural !== 20) expect(g.battle!.units.f1!.out).toBeUndefined()
    expect(g.battle!.units.a1!.ap.now).toBe(g.battle!.units.a1!.ap.max - 2)
  })
})

describe('脫離與投降（COMBAT_SYSTEM 1.3、8.5 節）', () => {
  it('脫離：花 2 點，由隊上運動或隱匿最高的人擲一次，對 10 ＋ 敵方最高的等級 × 2；成功全隊離開，失敗只是這 2 點不退', () => {
    const run = (athletics: number) => {
      const g = game(duel([one({ weapon: 'pistol', skills: { athletics: 0, stealth: 0 } }), one({ weapon: 'pistol', skills: { athletics, stealth: 1 } }, 2)], [foe('minion'), foe('minion', { grade: 3 })]))
      turnTo(g, 'a1')
      const r = g.battleAct({ action: 'flee' })
      return { g, r, roll: r.reports[0]!.timeline.find((b) => b.roll)!.roll! }
    }
    const ok = run(60)
    expect(ok.roll.dc).toBe(10 + 3 * 2)
    expect(ok.roll.parts.some((p) => p.value === 60)).toBe(true) // 用的是隊上運動最高的那個人
    if (ok.roll.natural !== 1) {
      expect(ok.g.battle!.result).toMatchObject({ outcome: 'fled' })
      expect(ok.r.over).toBe(true)
      expect(tags(ok.r.reports)).toContain('flee')
    }
    const bad = run(-60)
    if (bad.roll.natural !== 20) {
      expect(bad.g.battle!.result).toBeUndefined()
      expect(tags(bad.r.reports)).toContain('flee.fail')
      expect(bad.g.battle!.units.a1!.ap.now).toBe(bad.g.battle!.units.a1!.ap.max - 2)
    }
  })

  it('副本裡的戰鬥不能脫離（只能撤退），可以投降', () => {
    const g = game(duel([one({ weapon: 'pistol' })], [foe()], undefined, { origin: { escapable: false } }))
    turnTo(g, 'a1')
    expect(opt(g, 'flee')).toMatchObject({ ok: false, blocks: ['副本裡的戰鬥不能脫離，只能撤退。'] })
    expect(opt(g, 'surrender').ok).toBe(true)
  })

  it('投降：不花行動點、一定成功；戰鬥立刻結束、算戰敗；每個人停在那一刻的生命、感載與餘韻，還站著的人不算倒下', async () => {
    const g = game(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe()]))
    const me = turnTo(g, 'a1')
    me.ap.now = 0
    g.state.battle!.units.a2!.hp!.now = 17
    const r = g.battleAct({ action: 'surrender' })
    expect(r).toMatchObject({ status: 'applied', over: true })
    expect(g.battle!.result).toMatchObject({ outcome: 'surrender' })
    expect(tags(r.reports)).toContain('surrender')
    expect(Object.values(g.battle!.units).filter((u) => u.side === 'ally').map((u) => u.out)).toEqual([undefined, undefined])
    const end = await g.finishBattle()
    expect(end.reports[0]!.outcome.result).toBe('surrender')
    expect(end.reports[0]!.narration!.results).toEqual([])
  })
})

describe('道具：戰鬥中只能用快取格裡的（EQUIPMENT 4.1 節；ITEMS 5.2 節）', () => {
  it('急救凝膠：自己用 1 點、替相鄰的隊友用 2 點；回生命、止血；用掉就從快取格少一個', () => {
    const g = game(duel([one({ weapon: 'pistol', quick: [{ item: 'it_medgel_1', qty: 2 }] }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], [foe()]))
    const me = turnTo(g, 'a1')
    me.hp!.now = 20
    me.statuses.push({ id: 'bleeding', until: { at: 'battle_end' } })
    g.state.battle!.units.a2!.hp!.now = 30
    const item = opt(g, 'item')
    expect(item.ok).toBe(true)
    // 相鄰的隊友可以選，隔一格的不行
    expect(item.targets.map((t) => [t.target, t.blocks])).toEqual([[{ unit: 'a1' }, []], [{ unit: 'a2' }, []], [{ unit: 'a3' }, ['要相鄰才用得到。']]])
    expect(g.battleAct({ action: 'item', target: { unit: 'a1' }, pick: { item: 'it_medgel_1' } }).status).toBe('applied')
    let u = g.battle!.units.a1!
    expect(u.hp!.now).toBe(28)
    expect(u.statuses.some((s) => s.id === 'bleeding')).toBe(false)
    expect(u.quick).toEqual([{ item: 'it_medgel_1', qty: 1 }])
    expect(u.ap.now).toBe(u.ap.max - 1)
    expect(g.battleAct({ action: 'item', target: { unit: 'a2' }, pick: { item: 'it_medgel_1' } }).status).toBe('applied')
    u = g.battle!.units.a1!
    expect(g.battle!.units.a2!.hp!.now).toBe(38)
    expect(u.ap.now).toBe(u.ap.max - 3)
    expect(u.quick).toEqual([])
    expect(opt(g, 'item').blocks).toEqual(['快取格裡沒有能用的道具。'])
  })

  it('冷卻劑：消一層餘韻、排感載；煙霧彈：一格變成打不破的半掩體，兩回合後散掉', () => {
    const g = game(duel([one({ weapon: 'pistol', quick: [{ item: 'it_coolant_1', qty: 1 }, { item: 'it_smoke_1', qty: 1 }, { item: 'it_zip_tie', qty: 1 }] })], [foe()]))
    const me = turnTo(g, 'a1')
    me.layers = 2
    me.load!.now = 10
    expect(g.battleAct({ action: 'item', target: { unit: 'a1' }, pick: { item: 'it_coolant_1' } }).status).toBe('applied')
    expect(g.battle!.units.a1!).toMatchObject({ layers: 1, load: { now: 6 } })
    const r = g.battleAct({ action: 'item', target: { side: 'ally', slot: 1 }, pick: { item: 'it_smoke_1' } })
    expect(r.status).toBe('applied')
    expect(g.battle!.cover.ally[0]!.soft).toEqual({ kind: 'smoke', until: g.battle!.round + 1 })
    // 束帶不是拿來「用」的道具：不能選
    expect(g.battleAct({ action: 'item', target: { unit: 'a1' }, pick: { item: 'it_zip_tie' } }).status).toBe('refused')
  })

  it('內容裡的道具用了不認得的效果：載入時擋下', () => {
    const bad: ContentPack = { id: 'bad', content: { item: [ITEM('it_weird', '怪東西', { use: { ap: 1, target: 'self', effects: [{ op: 'summon_dragon' }] } })] } }
    expect(() => makeBattleGame({ features: FEATURES, content: [bad] })).toThrow(/it_weird.*summon_dragon/)
  })
})

describe('武器的特性與重創（COMBAT_SYSTEM 第 5、6 節）', () => {
  it('輕機槍的掃射：多花彈匣 1 格（一共 2 格）；不管有沒有打中，目標過定力 DC 14，失敗就被壓制', () => {
    const lmg = one({ weapon: 'rifle' })
    lmg.weapons[0] = { ...testWeapon('rifle', 4), id: 'lmg', name: '輕機槍', class: 'lmg', range: [3, 6], pierce: 0, mag: { now: 4, max: 4 }, coverMult: 1, traits: ['sweep', 'heavy'] }
    const g = game(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2), lmg], [foe('minion', { skills: { composure: -40 } })]))
    turnTo(g, 'a3')
    const r = g.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })
    expect(r.status).toBe('applied')
    expect(g.battle!.units.a3!.weapons[0]!.mag!.now).toBe(2)
    const save = r.reports[0]!.timeline.filter((b) => b.roll).at(-1)!.roll!
    expect(save).toMatchObject({ dc: 14, skill: 'composure' })
    if (save.natural !== 20 && !g.battle!.units.f1!.out) expect(g.battle!.units.f1!.statuses.map((s) => s.id)).toContain('suppressed')
    // 只剩一格時不能掃射
    turnTo(g, 'a3').weapons[0]!.mag!.now = 1
    expect(g.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })).toMatchObject({ status: 'refused', reasons: ['掃射要彈匣裡有 2 格。'] })
  })

  it('重創擲部位（肢體、頭、軀幹、橋），第一次是輕的：肢體檢定 −2、頭暈眩、軀幹流血、橋感載 +10；對敵人只算輕的', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('elite')]), FEATURES, (k) => k.content.loadPack(PACK))
    const expectPart = (rand: number, part: string, check: (t: BattleUnit) => void) => {
      const t = a.foe(1)
      t.statuses = []
      t.wounds = {}
      t.load!.now = 0
      const run = a.run([rand])
      a.k.battle.emit('wound', { run, attacker: a.ally(1), target: t, aimed: false })
      expect(t.wounds, part).toEqual({ [part]: 1 })
      expect(run.beats.some((b) => b.tag === 'wound' && (b.data as { part: string }).part === part)).toBe(true)
      check(t)
    }
    // 部位各佔四分之一，照 肢體、頭、軀幹、橋 的順序
    expectPart(10, 'limb', (t) => expect(t.statuses.map((s) => s.id)).toEqual(['limb_hurt']))
    expectPart(30, 'head', (t) => expect(t.statuses.map((s) => s.id)).toEqual(['dazed']))
    expectPart(60, 'torso', (t) => expect(t.statuses.map((s) => s.id)).toEqual(['bleeding']))
    expectPart(90, 'bridge', (t) => expect(t.load!.now).toBe(10))
    // 瞄準過的射擊由攻擊者選部位，不擲
    const t = a.foe(1)
    t.statuses = []
    t.wounds = {}
    a.k.battle.emit('wound', { run: a.run([]), attacker: a.ally(1), target: t, aimed: true, part: 'head' })
    expect(t.wounds).toEqual({ head: 1 })
    // 敵人同一個部位再中一次：還是輕的
    a.k.battle.emit('wound', { run: a.run([]), attacker: a.ally(1), target: t, aimed: true, part: 'head' })
    expect(t.wounds).toEqual({ head: 1 })
  })

  it('我方同一場、同一個部位再中一次才變重；存檔規則可以關掉重的那一級', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('elite')]), FEATURES, (k) => k.content.loadPack(PACK))
    const me = a.ally(1)
    for (let i = 0; i < 2; i++) a.k.battle.emit('wound', { run: a.run([]), attacker: a.foe(1), target: me, aimed: true, part: 'torso' })
    expect(me.wounds).toEqual({ torso: 2 })
    a.state.rules.heavyWounds = false
    me.wounds = {}
    for (let i = 0; i < 2; i++) a.k.battle.emit('wound', { run: a.run([]), attacker: a.foe(1), target: me, aimed: true, part: 'torso' })
    expect(me.wounds).toEqual({ torso: 1 })
  })
})

describe('敵人會用這張行動表（ENEMIES 4.3 節）；整場打得完', () => {
  it('capture 的敵人看到近身、正在失去回合的人，手上有束帶就優先制伏（分數 4）', () => {
    const cop = foe('minion', { capture: true, quick: [{ item: 'it_zip_tie', qty: 1 }], skills: { brawl: 40 } })
    const g = game(duel([one({ weapon: 'pistol' })], [cop], { ally: [0, 0, 0, 0], foe: [1, 0, 0, 0] }), 3)
    const me = g.state.battle!.units.a1!
    me.statuses.push({ id: 'lose_turn', until: { at: 'turn_start', of: 'a1', turns: 1 } })
    me.layers = me.layersMax
    turnTo(g, 'f1', 'ai')
    // 分數平方加權：制伏 16 對射擊 4，連抽幾次一定會出現制伏
    let tried = false
    for (let i = 0; i < 6 && g.battle && !g.battle.result && !tried; i++) {
      turnTo(g, 'f1', 'ai')
      g.state.battle!.aiSteps = 0
      const r = g.battleNext()
      tried = r.reports.some((x) => x.timeline.some((b) => b.roll?.skill === 'brawl'))
    }
    expect(tried).toBe(true)
  })

  it('一般遭遇用正式的行動表打得完（雙方由程式選動作）；結束時「要活的」的條件寫進結果', async () => {
    const { game: g } = makeBattleGame({ features: FEATURES, content: [PACK], seed: 5 })
    g.state.battle!.origin.capture = ['f4']
    const r = playOut(g)
    expect(['win', 'lose']).toContain(r.outcome)
    const end = await g.finishBattle()
    if (r.outcome === 'win') expect(end.reports[0]!.narration!.results!.join('')).toMatch(/要活的.*(沒有達成|達成)/)
  })
})
