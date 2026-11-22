// 驗收測試：dev/work/M1b-ordnance.md（cpp-feature）。武器的附帶效果 fx、特殊彈、投擲物、立牌與紙鶴。
// 規格：ITEMS 5.1 節（特殊彈的規則與那張表，只當成「格式要表達得出這六種」的對照）、5.2 節「投擲物的型」與表裡的手榴彈、燃燒彈、電磁手雷、霧彈、閃光彈、
// 煙霧彈、一綑炸藥、紙鶴、立牌；COMBAT_SYSTEM 第 5 節（傷害類型）；dev/adr/0015 第一、二節。內容一律是測試自帶的最小假資料：
// 沒有讀 engine/data 的內容類（物品、敵人、技能）；規則表（傷害類型）照正式的。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, beginTurn, createKernel, pickApplies, performAction, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { fxOf, mergeFx } from '../../src/features/combat/fx'
import { enemiesFeature } from '../../src/features/enemies'
import { makeBattleGame, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(80).fill(1)]
const ITEM = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, desc: `${name}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const GUNS = ['pistol', 'smg', 'rifle', 'sniper', 'lmg']
const BURN = { op: 'status', status: 'burning', turns: 2 }
const ammo = (id: string, name: string, fits: string[], fx: Record<string, unknown>) => ITEM(id, name, { category: 'ammo', ammo: { fits, fx } })
const throwItem = (id: string, name: string, e: Record<string, unknown>, more: Record<string, unknown> = {}) => ITEM(id, name, { tags: ['throwable'], use: { ap: 2, target: 'foe_slot', modes: ['meat'], effects: [{ op: 'throw', ...e }], ...more } })

const PACK: ContentPack = {
  id: 'ordnance_test',
  content: {
    battle_status: [
      ...TEST_STATUSES,
      { id: 'off_generic', name: '義體失效', desc: '義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'ap_minus_1', name: '行動點 −1', desc: '下一回合少 1 點行動點。', turn_start: { ap: -1 }, once: true, until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'see_dark', name: '不受黑暗影響', desc: '攻擊時不受黑暗影響。', mods: { see_dark: 1 }, until: 'own_turn_end', turns: 1, kind: 'buff' },
    ],
    item: [
      // 六種特殊彈（ITEMS 5.1 節）：穿甲 +2、空尖（多一顆、護甲兩倍）、改神經、改電磁、改熱能加燃燒、改快感
      ammo('am_ap', '穿甲彈', GUNS, { pierce: 2 }),
      ammo('am_hollow', '空尖彈', GUNS.slice(0, 4), { dice: 1, armor_mult: 2 }),
      ammo('am_neural', '感官彈', [...GUNS, 'shotgun'], { type: 'neural', dice: -1 }),
      ammo('am_em', '電磁彈', GUNS, { type: 'em', on_hit: [{ op: 'implant', mode: 'off', turns: 1 }] }),
      ammo('am_fire', '燃燒彈', ['rifle', 'pistol'], { type: 'thermal', on_hit: [BURN] }),
      ammo('am_honey', '蜜彈', ['pistol', 'smg'], { type: 'pleasure', dice: -2, on_hit: [{ op: 'sink', amount: 1, save: { attr: 'resolve', skill: 'composure', dc: 14 } }] }),
      ammo('am_shotgun', '鹿彈', ['shotgun'], { dice: 1 }),
      // 投擲物（一顆骰打兩格）：破片、閃光（過定力檢定）、一綑炸藥（遮蔽各降一級）、電磁、燃燒
      throwItem('it_nade', '破片手雷', { dice: 3, cover_mult: 2 }),
      throwItem('it_flash', '閃光彈', { save: { attr: 'resolve', skill: 'composure', dc: 13 }, on_hit: [{ op: 'status', status: 'ap_minus_1' }] }),
      throwItem('it_bundle', '一綑炸藥', { dice: 3, type: 'thermal', cover_mult: 2, cover: 1 }),
      throwItem('it_emp', '電磁手雷', { dice: 2, type: 'em', on_hit: [{ op: 'implant', mode: 'off', turns: 1 }] }),
      throwItem('it_napalm', '燃燒彈', { dice: 2, type: 'thermal', hit: 1, on_hit: [BURN] }),
      // 煙霧彈 III：兩格
      ITEM('it_smoke3', '煙霧彈', { use: { ap: 2, target: 'slot', modes: ['meat'], effects: [{ op: 'soft_cover', kind: 'smoke', rounds: 2, also: true }] } }),
      // 立牌：放在我方的一格
      ITEM('it_decoy', '等身立牌', { use: { ap: 1, target: 'ally_slot', modes: ['meat'], effects: [{ op: 'decoy' }] } }),
      // 紙鶴：不用新的 op，標記加（II 級）不受黑暗；標記一個敵人的目標（use.target: foe）還不能用，效果清單直接給 run.effects
      ITEM('it_crane1', '紙鶴', { use: { ap: 1, target: 'foe', modes: ['meat'], effects: [{ op: 'status', status: 'marked', until: 'battle_end' }] } }),
      ITEM('it_crane2', '紙鶴', { use: { ap: 1, target: 'foe', modes: ['meat'], effects: [{ op: 'status', status: 'marked', until: 'battle_end' }, { op: 'status', status: 'see_dark', who: 'self', until: 'battle_end' }] } }),
    ],
  },
}
const CRANE2 = (PACK.content.item!.find((x) => x.id === 'it_crane2') as unknown as { use: { effects: Array<Record<string, unknown>> } }).use.effects
const AP = { now: 99, max: 99, regen: 3 }

type Prep = (k: Kernel) => void
const cover0 = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }
/** 三對三：我方 a1～a3、敵方 f1～f3（預設全部暴露）。allies、foes 可以換。 */
const field = (o: { allies?: unknown[]; foes?: unknown[]; cover?: { ally: number[]; foe: number[] }; prep?: Prep } = {}): Arena =>
  arena(duel(o.allies ?? [one({ weapon: 'pistol' }), one({ weapon: 'smg' }, 2), one({ weapon: 'knife' }, 3)], o.foes ?? [foe(), foe(), foe()], o.cover ?? cover0), [combatFeature], (k) => {
    k.content.loadPack(PACK)
    o.prep?.(k)
  })
const f = (id: string): BattleTarget => ({ unit: id })
const rolls = (run: { beats: Array<{ roll?: { natural: number; parts: Array<{ label: string; value: number }> } }> }) => run.beats.filter((b) => b.roll).map((b) => b.roll!)
const texts = (run: { beats: Array<{ text: string }> }) => run.beats.map((b) => b.text).join('\n')
/** 讓 u 做一個行動（花費照扣、行動本身、做完的掛點），沒有檢查條件。 */
function act(a: Arena, u: BattleUnit, id: string, target?: BattleTarget, pick?: Record<string, unknown>, d: number[] = dice()) {
  const run = a.run(d)
  const def = a.k.battle.getAction(id)!
  const input = { action: id, ...(target ? { target } : {}), ...(pick ? { pick } : {}) }
  performAction(run, u, def, target ?? null, input)
  return run
}
const weaponOf = (u: BattleUnit) => u.weapons[u.wield]!
/** 一個單位帶著這把槍的附帶效果。 */
const withFx = (weapon: string, fx: Record<string, unknown>, o: Record<string, unknown> = {}) =>
  one({ weapons: [{ ...testWeapon(weapon, 6), ext: { fx } }], wield: 0, ...o })
/** 這一串骰子裡，傷害骰（d6）一次擲了幾顆：把 roll 包起來看。 */
function spyRolls(run: { roll(count: number, sides: number): number[] }): Array<[number, number]> {
  const seen: Array<[number, number]> = []
  const orig = run.roll.bind(run)
  run.roll = (c, s) => (seen.push([c, s]), orig(c, s))
  return seen
}
const d6s = (seen: Array<[number, number]>): number[] => seen.filter(([, s]) => s === 6).map(([c]) => c)

describe('fx：每一擊都帶的欄位與合併', () => {
  it('hit、dice、pierce 加在這一擊上；type 換傷害類型；沒有 fx 的武器不受影響', () => {
    const a = field({ allies: [withFx('pistol', { hit: 2, dice: 1, pierce: 1 })], foes: [foe('minion', { armor: 4 })] })
    const me = a.ally(1)
    const run = a.run(dice(6, 6, 6, 6, 6))
    const seen = spyRolls(run)
    const plain = field({ allies: [withFx('pistol', {})], foes: [foe('minion', { armor: 4 })] })
    const pr = plain.run(dice(6, 6, 6, 6, 6))
    const pseen = spyRolls(pr)
    const r = run.attack(me, a.foe(1))
    const p = pr.attack(plain.ally(1), plain.foe(1))
    expect(d6s(seen)).toEqual([4])
    expect(d6s(pseen)).toEqual([3])
    // 4d6 全 6 = 24（這把武器沒有固定傷害），穿甲 1 抵銷一點護甲：24 − (4 − 1) = 21；沒有 fx：18 − 4 = 14
    expect([r.dealt, p.dealt]).toEqual([21, 14])
    // 命中加 2：兩邊的命中明細差 2
    expect(rolls(run)[0]!.parts.reduce((s, x) => s + x.value, 0) - rolls(pr)[0]!.parts.reduce((s, x) => s + x.value, 0)).toBe(2)
  })

  it('武器自己的 fx 與特殊彈的 fx 合起來：數字相加、on_hit 接起來、type 以彈為準', () => {
    const a = field({ allies: [withFx('pistol', { hit: 1, dice: 1, pierce: 1, type: 'em', on_hit: [{ op: 'heal', amount: 1 }] })] })
    const w = weaponOf(a.ally(1))
    w.ammo = 'am_neural'
    expect(a.k.content.get('item', 'am_neural')).toBeTruthy()
    expect(fxOf(a.k, w)).toEqual({ hit: 1, dice: 0, pierce: 1, type: 'neural', on_hit: [{ op: 'heal', amount: 1 }] })
    expect(mergeFx({ on_use: { jam: 30, backfire: { pct: 10, dice: 1 } }, silent: true }, { on_use: { jam: 20, backfire: { pct: 5, dice: 2 } }, no_cover: true })).toEqual({
      silent: true, no_cover: true, on_use: { jam: 50, backfire: { pct: 15, dice: 3 } },
    })
    // 兩邊都沒有：沒有 fx
    expect(fxOf(a.k, { ...w, ext: {}, ammo: undefined })).toBeUndefined()
  })

  it('silent 只是攻擊的標籤；cover_mult_min 與 no_cover 照 AttackOpts', () => {
    const seen: string[][] = []
    const cover: Array<[number | undefined, boolean | undefined]> = []
    const a = field({
      allies: [withFx('pistol', { silent: true, cover_mult_min: 2, no_cover: true })],
      prep: (k) => k.battle.on('attack.before', 'spy', ({ opts }) => { seen.push([...(opts.tags ?? [])]); cover.push([opts.coverMultMin, opts.noCoverDamage]) }),
    })
    a.run(dice(15, 1, 1, 1)).attack(a.ally(1), a.foe(1))
    expect(seen).toEqual([['silent']])
    expect(cover).toEqual([[2, true]])
  })
})

describe('fx.on_hit：命中而且造成傷害之後做', () => {
  const burning = { on_hit: [BURN] }
  it('命中之後目標有 burning、兩回合後消失；沒中、被護甲擋光（傷害 0）時沒有', () => {
    const a = field({ allies: [withFx('pistol', burning)] })
    const run = a.run(dice(15, 3, 3, 3))
    const r = run.attack(a.ally(1), a.foe(1))
    expect(r.hit && r.dealt > 0).toBe(true)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['burning'])
    // 之後兩回合各燒一次，第二個回合開始時結束
    const turns = a.run(dice())
    beginTurn(turns, a.foe(1))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['burning'])
    beginTurn(turns, a.foe(1))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual([])

    // 沒中（自然 1）
    const b = field({ allies: [withFx('pistol', burning)] })
    expect(b.run(dice(1, 3, 3, 3)).attack(b.ally(1), b.foe(1)).hit).toBe(false)
    expect(b.foe(1).statuses).toEqual([])
    // 命中，但護甲把傷害擋光
    const c = field({ allies: [withFx('pistol', burning)], foes: [foe('minion', { armor: 99 })] })
    const blocked = c.run(dice(15, 3, 3, 3)).attack(c.ally(1), c.foe(1))
    expect(blocked).toMatchObject({ hit: true, dealt: 0 })
    expect(c.foe(1).statuses).toEqual([])
  })

  it('who 預設是被打的人；who: self 落在開槍的人；來源是這把武器；if: crit 看這一擊的結果', () => {
    const a = field({ allies: [withFx('pistol', { on_hit: [{ op: 'heal', who: 'self', amount: 5 }, { op: 'status', status: 'marked', if: 'crit' }] })] })
    const me = a.ally(1)
    me.hp!.now = 10
    a.run(dice(6, 3, 3, 3)).attack(me, a.foe(1))
    expect(me.hp!.now).toBe(15)
    // 一般命中不是要害：沒有標記
    expect(a.foe(1).statuses).toEqual([])
    const b = field({ allies: [withFx('pistol', { on_hit: [{ op: 'status', status: 'marked', if: 'crit' }] })] })
    b.run(dice(20, 3, 3, 3, 3)).attack(b.ally(1), b.foe(1), { autoCrit: true })
    expect(b.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
  })

  it('義體失效（implant）與沉溺（sink）也寫得出來', () => {
    const a = field({
      allies: [withFx('pistol', { on_hit: [{ op: 'implant', mode: 'off', turns: 1 }, { op: 'sink', amount: 2 }] })],
      foes: [foe('minion', { implants: [{ kind: 'arm', name: '義肢' }] })],
    })
    a.run(dice(15, 3, 3, 3)).attack(a.ally(1), a.foe(1))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_generic'])
    expect(a.foe(1).sink).toBe(2)
  })
})

describe('fx.on_use：卡彈與炸膛（開火之前擲的）', () => {
  it('jam: 100：沒有擲命中、彈匣少一格、有一拍說明卡彈、目標不受傷', () => {
    const a = field({ allies: [withFx('pistol', { on_use: { jam: 100 } })] })
    const me = a.ally(1)
    const hp = a.foe(1).hp!.now
    const run = act(a, me, 'shoot', f('f1'), undefined, dice(50, 15, 6, 6, 6))
    expect(rolls(run)).toEqual([])
    expect(weaponOf(me).mag!.now).toBe(1)
    expect(texts(run)).toMatch(/卡彈/)
    expect(a.foe(1).hp!.now).toBe(hp)
    expect(run.beats.some((b) => b.tag === 'hit' || b.tag === 'miss')).toBe(false)
  })

  it('卡彈的機率是百分比：擲到 ≤ jam 才卡；沒有 on_use 的武器不擲這一顆骰', () => {
    const a = field({ allies: [withFx('pistol', { on_use: { jam: 30 } })] })
    // 30 卡，31 不卡（接著照常擲命中：15）
    expect(texts(act(a, a.ally(1), 'shoot', f('f1'), undefined, dice(30)))).toMatch(/卡彈/)
    const ok = act(a, a.ally(1), 'shoot', f('f1'), undefined, dice(31, 15, 3, 3, 3))
    expect(rolls(ok)).toHaveLength(1)
    // 沒有 fx：第一顆骰就是命中的 d20（15 命中，傷害是之後的 d6）
    const plain = field()
    expect(rolls(act(plain, plain.ally(1), 'shoot', f('f1'), undefined, dice(15, 3, 3, 3)))[0]!.natural).toBe(15)
  })

  it('backfire: { pct: 100, dice: 1 }：這一擊不發生，開槍的人自己受傷；彈匣照扣', () => {
    const a = field({ allies: [withFx('pistol', { on_use: { backfire: { pct: 100, dice: 1 } } })] })
    const me = a.ally(1)
    const hp = me.hp!.now
    const run = act(a, me, 'shoot', f('f1'), undefined, dice(50, 6))
    expect(texts(run)).toMatch(/炸膛/)
    // 1d6 = 6，護甲 2：實際 4 點
    expect(me.hp!.now).toBe(hp - 4)
    expect(weaponOf(me).mag!.now).toBe(1)
    expect(rolls(run)).toEqual([])
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
  })

  it('近戰也走同一道關；打掛著的東西的射擊也會卡彈', () => {
    const a = field({ allies: [one({ weapons: [{ ...testWeapon('knife', 6), ext: { fx: { on_use: { jam: 100 } } } }], wield: 0 })] })
    expect(texts(act(a, a.ally(1), 'melee', f('f1'), undefined, dice(50)))).toMatch(/卡彈/)
    const b = field({ allies: [withFx('pistol', { on_use: { jam: 100 } })] })
    b.battle.overlays.push(overlay('o1', 'foe', 1))
    const run = act(b, b.ally(1), 'shoot', { overlay: 'o1' }, undefined, dice(50))
    expect(texts(run)).toMatch(/卡彈/)
    expect(b.battle.overlays[0]!.hp.now).toBe(20)
  })

  it('AI 的敵人拿著帶 fx 的武器，卡彈照樣發生；命中燃燒照樣發生', () => {
    const jammed = { ...testWeapon('pistol', 6), mag: { now: 2, max: 2 }, ext: { fx: { on_use: { jam: 100 } } } }
    const g1 = makeBattleGame({ features: [combatFeature], content: [PACK], seed: 3, battle: duel([one({ weapon: 'pistol' })], [foe('minion', { weapons: [jammed] })], cover0) }).game
    const reports = []
    for (let i = 0; i < 12 && g1.battle && !g1.battle.result; i++) reports.push(g1.battleNext({ anyone: true }))
    const beats = reports.flatMap((r) => r.reports.flatMap((x) => x.timeline))
    expect(beats.some((b) => /卡彈/.test(b.text))).toBe(true)
    // 敵人沒有打出任何一槍：沒有一拍的攻擊者是他
    expect(beats.filter((b) => (b.tag === 'hit' || b.tag === 'miss' || b.tag === 'crit') && (b.data as { attacker?: string } | undefined)?.attacker === 'f1')).toEqual([])
    expect(g1.battle!.units.f1!.weapons[0]!.mag!.now).toBeLessThan(2)

    const fiery = { ...testWeapon('pistol', 60), ext: { fx: { on_hit: [BURN] } } }
    const g2 = makeBattleGame({ features: [combatFeature], content: [PACK], seed: 3, battle: duel([one({ weapon: 'pistol', evade: -50 })], [foe('minion', { weapons: [fiery] })], cover0) }).game
    let burned = false
    for (let i = 0; i < 12 && g2.battle && !g2.battle.result && !burned; i++) {
      g2.battleNext({ anyone: true })
      burned = !!g2.battle?.units.a1?.statuses.some((s) => s.id === 'burning')
    }
    expect(burned).toBe(true)
  })
})

describe('特殊彈：六種各一筆假資料', () => {
  /** a1 裝著這種彈、打 f1（骰面：命中 15、傷害骰全 6）。回傳這一擊與擲了幾顆傷害骰。 */
  function shoot(am: string | undefined, o: { weapon?: string; foes?: unknown[]; d?: number[]; unit?: Record<string, unknown> } = {}) {
    const a = field({ allies: [one({ weapon: o.weapon ?? 'pistol', ...o.unit })], foes: o.foes ?? [foe('minion', { armor: 4 })] })
    if (am) weaponOf(a.ally(1)).ammo = am
    const run = a.run(o.d ?? dice(8, 6, 6, 6, 6))
    const seen = spyRolls(run)
    const r = run.attack(a.ally(1), a.foe(1))
    return { a, run, r, dice: d6s(seen) }
  }

  it('穿甲 +2：護甲 4 的目標少擋 2 點', () => {
    expect(shoot(undefined).r.dealt).toBe(19 - 4)
    expect(shoot('am_ap').r.dealt).toBe(19 - 2)
  })

  it('空尖：多一顆傷害骰、目標的護甲算兩倍', () => {
    const { r, dice } = shoot('am_hollow')
    expect(dice).toEqual([4])
    // 4d6 = 24 + 固定傷害 1 = 25，護甲 4 × 2 = 8
    expect(r.dealt).toBe(25 - 8)
  })

  it('改神經：傷害骰少一顆、改打感載、對沒有橋的目標無效', () => {
    const { a, r, dice } = shoot('am_neural', { foes: [foe('minion')] })
    expect(dice).toEqual([2])
    expect(r.track).toBe('load')
    expect(a.foe(1).load!.now).toBeGreaterThan(0)
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    const none = shoot('am_neural', { foes: [foe('minion', { load: undefined, tags: ['machine'] })] })
    expect(none.r).toMatchObject({ hit: true, dealt: 0, track: 'none' })
    expect(texts(none.run)).toMatch(/沒有橋/)
  })

  it('改電磁：傷害骰少一顆（傷害類型自己帶的）、命中後義體失效一回合', () => {
    const { a, r, dice } = shoot('am_em', { foes: [foe('minion', { implants: [{ kind: 'eye', name: '義眼' }] })] })
    expect(dice).toEqual([2])
    expect(r.hit).toBe(true)
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('off_generic')
    // 沒有義體的人沒有東西可以失效：不丟錯
    expect(() => shoot('am_em')).not.toThrow()
  })

  it('改熱能加燃燒：護甲只算一半、傷害骰少一顆、命中後燃燒', () => {
    const { a, r, dice } = shoot('am_fire')
    expect(dice).toEqual([2])
    // 2d6 = 12 + 1 = 13，護甲 4 的一半 = 2
    expect(r.dealt).toBe(13 - 2)
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('burning')
  })

  it('改快感：傷害骰少兩顆、感載、沉溺 +1，定力檢定過了就擋掉沉溺', () => {
    // 骰面：命中 15、傷害骰（1 顆）4、目標的定力檢定（DC 14，沒有定力加值）
    const fail = shoot('am_honey', { foes: [foe('minion')], d: dice(8, 4, 2) })
    expect(fail.dice).toEqual([1])
    expect(fail.a.foe(1).load!.now).toBeGreaterThan(0)
    expect(fail.a.foe(1).sink).toBe(1)
    const pass = shoot('am_honey', { foes: [foe('minion')], d: dice(8, 4, 19) })
    expect(pass.a.foe(1).load!.now).toBeGreaterThan(0)
    expect(pass.a.foe(1).sink).toBe(0)
    // 對沒有橋的目標無效：沒有感載、沒有檢定、沒有沉溺
    const none = shoot('am_honey', { foes: [foe('minion', { load: undefined, tags: ['machine'] })], d: dice(8, 4, 2) })
    expect(none.r.dealt).toBe(0)
    expect(none.a.foe(1).sink).toBe(0)
  })

  it('打掛著的東西的射擊也吃到特殊彈（空尖：多一顆）', () => {
    const a = field({ allies: [one({ weapon: 'pistol' })] })
    weaponOf(a.ally(1)).ammo = 'am_hollow'
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const run = a.run(dice(8, 6, 6, 6, 6))
    const seen = spyRolls(run)
    act2(a, run, 'shoot', { overlay: 'o1' })
    expect(d6s(seen)).toEqual([4])
  })
})

/** 用現成的 run 做一個行動（要自己 spy 骰子時）。 */
function act2(a: Arena, run: ReturnType<Arena['run']>, id: string, target: BattleTarget, pick?: Record<string, unknown>, u: BattleUnit = a.ally(1)) {
  performAction(run, u, a.k.battle.getAction(id)!, target, { action: id, target, ...(pick ? { pick } : {}) })
}
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'drone', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})

describe('換彈：選特殊彈', () => {
  const quick = [{ item: 'am_ap', qty: 2 }, { item: 'am_shotgun', qty: 1 }, { item: 'am_neural', qty: 1 }]
  const withQuick = (): Arena => field({ allies: [one({ weapon: 'pistol', ap: AP, quick: quick.map((q) => ({ ...q })) })] })

  it('選項只列 fits 包含手上那一把的類型的彈；不合的不列；可以不選', () => {
    const a = withQuick()
    const def = a.k.battle.getAction('reload')!
    weaponOf(a.ally(1)).mag!.now = 0
    const picks = def.picks!(a.run(), a.ally(1))
    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ key: 'ammo', kind: 'choice', required: false })
    expect(picks[0]!.options.map((o) => [o.value, o.label, o.blocks])).toEqual([['am_ap', '穿甲彈 ×2', []], ['am_neural', '感官彈 ×1', []]])
    // 手上換成霰彈槍：只剩鹿彈與感官彈
    a.ally(1).weapons = [testWeapon('shotgun', 6)]
    expect(def.picks!(a.run(), a.ally(1))[0]!.options.map((o) => o.value)).toEqual(['am_shotgun', 'am_neural'])
    // 近戰武器不用換彈：沒有選項
    a.ally(1).weapons = [testWeapon('knife', 6)]
    expect(def.picks!(a.run(), a.ally(1))).toEqual([])
  })

  it('選了之後：快取格少一件、彈匣是滿的、weapon.ammo 記下這一種；沒選：裝普通彈，ammo 清掉', () => {
    const a = withQuick()
    const me = a.ally(1)
    weaponOf(me).mag!.now = 0
    act(a, me, 'reload', undefined, { ammo: 'am_ap' })
    expect(weaponOf(me).mag).toEqual({ now: 2, max: 2 })
    expect(weaponOf(me).ammo).toBe('am_ap')
    expect(me.quick.find((q) => q.item === 'am_ap')!.qty).toBe(1)
    // 用到沒有：那一格從快取格裡拿掉
    weaponOf(me).mag!.now = 0
    act(a, me, 'reload', undefined, { ammo: 'am_ap' })
    expect(me.quick.map((q) => q.item)).toEqual(['am_shotgun', 'am_neural'])
    // 沒選：普通彈
    weaponOf(me).mag!.now = 1
    act(a, me, 'reload')
    expect(weaponOf(me).ammo).toBeUndefined()
    expect(weaponOf(me).mag!.now).toBe(2)
  })

  it('裝不進這把槍的、快取格裡沒有的：擋下，快取格不動', () => {
    const a = withQuick()
    const me = a.ally(1)
    weaponOf(me).mag!.now = 0
    expect(() => act(a, me, 'reload', undefined, { ammo: 'am_shotgun' })).toThrow(BattleBlocked)
    expect(() => act(a, me, 'reload', undefined, { ammo: 'am_em' })).toThrow(BattleBlocked)
    expect(() => act(a, me, 'reload', undefined, { ammo: 7 })).toThrow(BattleBlocked)
    expect(me.quick).toEqual(quick)
    expect(weaponOf(me).mag!.now).toBe(0)
  })

  it('彈匣是滿的：沒有特殊彈可換就灰掉；裝著特殊彈、或快取格裡有合用的彈時可以換彈種（剩下的格數作廢）', () => {
    const plain = field()
    expect(plain.k.battle.getAction('reload')!.blocks!(plain.run(), plain.ally(1))).toEqual(['彈匣是滿的。'])
    const a = withQuick()
    const def = a.k.battle.getAction('reload')!
    expect(def.blocks!(a.run(), a.ally(1))).toEqual([])
    // 滿的、沒選、沒有裝著特殊彈：擋下
    expect(() => act(a, a.ally(1), 'reload')).toThrow(BattleBlocked)
    act(a, a.ally(1), 'reload', undefined, { ammo: 'am_ap' })
    // 已經是這種彈而且是滿的：這一項灰掉
    expect(def.picks!(a.run(), a.ally(1))[0]!.options.find((o) => o.value === 'am_ap')!.blocks).toEqual(['彈匣裡已經是這種彈，而且是滿的。'])
    expect(() => act(a, a.ally(1), 'reload', undefined, { ammo: 'am_ap' })).toThrow(BattleBlocked)
    // 中途換回普通彈：不選，原本剩下的格數作廢
    weaponOf(a.ally(1)).mag!.now = 1
    act(a, a.ally(1), 'reload')
    expect(weaponOf(a.ally(1))).toMatchObject({ mag: { now: 2, max: 2 } })
    expect(weaponOf(a.ally(1)).ammo).toBeUndefined()
  })

  it('打空之後下一匣是普通彈；裝著的時候每一擊都吃到彈的效果', () => {
    const a = field({ allies: [one({ weapon: 'pistol', ap: AP, quick: [{ item: 'am_ap', qty: 1 }] })], foes: [foe('minion', { armor: 4, hp: { now: 500, max: 500 } })] })
    const me = a.ally(1)
    weaponOf(me).mag!.now = 0
    act(a, me, 'reload', undefined, { ammo: 'am_ap' })
    const dealt = (): number => {
      const before = a.foe(1).hp!.now
      act(a, me, 'shoot', f('f1'), undefined, dice(8, 6, 6, 6))
      return before - a.foe(1).hp!.now
    }
    expect(dealt()).toBe(19 - 2)
    expect(weaponOf(me).ammo).toBe('am_ap')
    expect(dealt()).toBe(19 - 2)
    // 彈匣打空：特殊彈作廢（那一件在換彈時已經用掉了）
    expect(weaponOf(me).mag!.now).toBe(0)
    expect(weaponOf(me).ammo).toBeUndefined()
    // 下一匣：沒選就是普通彈，沒有穿甲
    act(a, me, 'reload')
    expect(dealt()).toBe(19 - 4)
  })

  it('監視的自動射擊、技能裡的攻擊也吃到彈的效果', () => {
    const a = field({ allies: [one({ weapon: 'pistol' })], foes: [foe('minion', { armor: 4 })] })
    const me = a.ally(1)
    weaponOf(me).ammo = 'am_ap'
    const hp = a.foe(1).hp!.now
    // 監視的自動射擊：行動的 auto
    expect(a.k.battle.getAction('shoot')!.auto!(a.run(dice(8, 6, 6, 6)), me, a.foe(1))).toBe(true)
    expect(hp - a.foe(1).hp!.now).toBe(19 - 2)
    // 技能（效果清單）裡的攻擊
    const hp2 = a.foe(1).hp!.now
    a.run(dice(8, 6, 6, 6)).effects([{ op: 'attack' }], { user: me, target: f('f1'), source: { kind: 'ability', id: 'sk_x', name: '技能' } })
    expect(hp2 - a.foe(1).hp!.now).toBe(19 - 2)
  })

  it('戰鬥結束：裝著沒打完的特殊彈作廢，不還給快取格', () => {
    const a = withQuick()
    const me = a.ally(1)
    weaponOf(me).mag!.now = 0
    act(a, me, 'reload', undefined, { ammo: 'am_ap' })
    expect(weaponOf(me).ammo).toBe('am_ap')
    // 結束的結算不會把它變成物品（combat 的結束變更只有傷勢與制伏）
    const extras = a.k.battle.endExtras({ k: a.k, state: a.state, battle: a.battle, outcome: 'win' })
    expect(JSON.stringify(extras)).not.toMatch(/am_ap/)
    expect(me.quick.find((q) => q.item === 'am_ap')!.qty).toBe(1)
  })
})

describe('投擲物：一顆骰打兩格', () => {
  const thrower = (items: Array<{ item: string; qty: number }>, extra: Record<string, unknown> = {}) => one({ weapon: 'pistol', ap: AP, quick: items, ...extra })
  /** 敵方第 1、2 格有人，第 2 格另外掛著一台無人機。 */
  const target = (items = [{ item: 'it_nade', qty: 2 }]): Arena => {
    const a = field({ allies: [thrower(items)], foes: [foe(), foe(), foe()] })
    a.battle.overlays.push(overlay('o1', 'foe', 2))
    return a
  }
  const cell = (slot: number): BattleTarget => ({ side: 'foe', slot })

  it('兩格裡的人與掛在那兩格的無人機用同一個骰面（紀錄裡三拍的骰面一樣）；也都被打到', () => {
    const a = target()
    const me = a.ally(1)
    const run = act(a, me, 'item', cell(1), { item: 'it_nade', also: 2 }, dice(17, 3, 3, 3, 3, 3, 3, 3, 3, 3))
    const r = rolls(run)
    expect(r).toHaveLength(3)
    expect(new Set(r.map((x) => x.natural))).toEqual(new Set([17]))
    // 第 1、2 格的人與無人機都掉血；第 3 格的人沒事
    expect(a.foe(1).hp!.now).toBeLessThan(a.foe(1).hp!.max)
    expect(a.foe(2).hp!.now).toBeLessThan(a.foe(2).hp!.max)
    expect(a.battle.overlays[0]!.hp.now).toBeLessThan(20)
    expect(a.foe(3).hp!.now).toBe(a.foe(3).hp!.max)
    // 2 點行動點、用掉一件
    expect(me.ap.now).toBe(me.ap.max - 2)
    expect(me.quick).toEqual([{ item: 'it_nade', qty: 1 }])
    // 命中加值：1d20 ＋ mod(反應 15) ＋ 運動（這個測試單位 1）
    expect(r[0]!.parts.reduce((s, x) => s + x.value, 0)).toBe(2 + 1)
  })

  it('目標在中間的格子（第 2、3 格）一定要選相鄰的一格；在邊上（第 1、4 格）只有一個相鄰的格，不選也行', () => {
    const a = target()
    expect(() => act(a, a.ally(1), 'item', cell(2), { item: 'it_nade' })).toThrow(/要選相鄰的一格/)
    expect(() => act(a, a.ally(1), 'item', cell(2), { item: 'it_nade', also: 4 })).toThrow(/緊鄰/)
    expect(() => act(a, a.ally(1), 'item', cell(1), { item: 'it_nade', also: 3 })).toThrow(/緊鄰/)
    expect(a.ally(1).quick).toEqual([{ item: 'it_nade', qty: 2 }])
    // 第 1 格不選：打第 1、2 格
    const run = act(a, a.ally(1), 'item', cell(1), { item: 'it_nade' }, dice(15, 3, 3, 3, 3, 3, 3, 3, 3, 3))
    expect(rolls(run)).toHaveLength(3)
    // 第 4 格不選：打第 3、4 格（第 4 格沒有人：只有第 3 格的人擲一次）
    const b = target()
    expect(rolls(act(b, b.ally(1), 'item', cell(4), { item: 'it_nade' }))).toHaveLength(1)
  })

  it('宣告：picks 有 also，選項只適用於緊鄰目標的格（第 1 格只有第 2 格，第 4 格只有第 3 格）', () => {
    const a = target([{ item: 'it_nade', qty: 1 }, { item: 'it_decoy', qty: 1 }])
    const picks = a.k.battle.getAction('item')!.picks!(a.run(), a.ally(1))
    const also = picks.find((p) => p.key === 'also')!
    expect(also).toMatchObject({ kind: 'foe_slot', required: false })
    const valuesFor = (slot: number) => also.options.filter((o) => pickApplies(o, cell(slot))).map((o) => o.value)
    expect([1, 2, 3, 4].map(valuesFor)).toEqual([[2], [1, 3], [2, 4], [3]])
    // 道具那一項寫出哪些要選相鄰的格
    expect(picks[0]!.options.map((o) => [o.value, (o.hint as { also?: boolean }).also])).toEqual([['it_nade', true], ['it_decoy', undefined]])
    // 只帶不要 also 的道具時：沒有這一項
    const b = field({ allies: [thrower([{ item: 'it_decoy', qty: 1 }])] })
    expect(b.k.battle.getAction('item')!.picks!(b.run(), b.ally(1)).map((p) => p.key)).toEqual(['item'])
  })

  it('距離：投的人到目標那一格的距離要在 1～4；距離 5 的格子灰掉，原因是一句完整的話；硬丟也擋下', () => {
    const a = field({ allies: [one({ weapon: 'knife' }), one({ weapon: 'knife' }, 2), thrower([{ item: 'it_nade', qty: 1 }])] })
    const me = a.ally(3)
    expect(me.slot).toBe(3)
    const targets = a.k.battle.getAction('item')!.targets!(a.run(), me).filter((t) => 'slot' in t.target)
    // 第 3 格丟第 1 格＝距離 3、第 2 格＝4、第 3 格＝5、第 4 格＝6
    expect(targets.map((t) => [(t.target as { slot: number }).slot, t.blocks.length])).toEqual([[1, 0], [2, 0], [3, 1], [4, 1]])
    expect(targets[2]!.blocks[0]).toMatch(/距離是 5.*1～4.*。$/)
    expect(() => act(a, me, 'item', cell(3), { item: 'it_nade', also: 2 })).toThrow(/距離是 5/)
    expect(() => act(a, me, 'item', cell(4), { item: 'it_nade' })).toThrow(BattleBlocked)
    expect(me.quick).toEqual([{ item: 'it_nade', qty: 1 }])
    act(a, me, 'item', cell(2), { item: 'it_nade', also: 1 })
    expect(me.quick).toEqual([])
    // 丟在我方的格子上：擋下
    const b = target()
    expect(() => act(b, b.ally(1), 'item', { side: 'ally', slot: 2 }, { item: 'it_nade' })).toThrow(BattleBlocked)
  })

  it('閃光彈：不造成傷害，兩格裡的人過檢定，沒過的人下一回合少行動點', () => {
    const a = field({ allies: [thrower([{ item: 'it_flash', qty: 1 }])], foes: [foe('minion', { ap: { now: 0, max: 4, regen: 3 } }), foe('minion', { ap: { now: 0, max: 4, regen: 3 } }), foe()] })
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    // 第 1 格的人檢定 2（沒過），第 2 格的人檢定 19（過了，DC 13）
    const run = act(a, a.ally(1), 'item', cell(1), { item: 'it_flash', also: 2 }, dice(2, 19))
    expect(rolls(run).map((x) => x.natural)).toEqual([2, 19])
    for (const i of [1, 2]) expect(a.foe(i).hp!.now).toBe(a.foe(i).hp!.max)
    expect(a.battle.overlays[0]!.hp.now).toBe(20)
    expect(run.beats.some((b) => b.tag === 'hit' || b.tag === 'damage')).toBe(false)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['ap_minus_1'])
    expect(a.foe(2).statuses).toEqual([])
    // 下一回合開始：少 1 點行動點（第一個回合不回行動點，先當成已經過了一個回合）
    for (const i of [1, 2]) a.foe(i).uses.turns = 1
    const turns = a.run(dice())
    beginTurn(turns, a.foe(1))
    beginTurn(turns, a.foe(2))
    expect([a.foe(1).ap.now, a.foe(2).ap.now]).toEqual([2, 3])
  })

  it('一綑炸藥：熱能、打兩格，那兩格的遮蔽各降一級', () => {
    const a = field({ allies: [thrower([{ item: 'it_bundle', qty: 1 }])], cover: { ally: [0, 0, 0, 0], foe: [2, 2, 1, 0] } })
    act(a, a.ally(1), 'item', cell(1), { item: 'it_bundle', also: 2 }, dice(20, 3, 3, 3, 3, 3, 3))
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([1, 1, 1, 0])
    expect(a.foe(1).hp!.now).toBeLessThan(a.foe(1).hp!.max)
  })

  it('電磁手雷、燃燒彈：命中的人才吃 on_hit（沒中的不吃）', () => {
    const a = field({ allies: [thrower([{ item: 'it_emp', qty: 1 }])], foes: [foe('minion', { implants: [{ kind: 'arm', name: '義肢' }] }), foe('minion', { implants: [{ kind: 'arm', name: '義肢' }] })] })
    // 同一個骰面對兩個人：10 ＋ 加值 3 = 13，打得中迴避 10 的、打不中迴避 14 的
    a.foe(2).evade = 14
    act(a, a.ally(1), 'item', cell(1), { item: 'it_emp', also: 2 }, dice(10, 3, 3, 3, 3))
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('off_generic')
    expect(a.foe(2).statuses.map((s) => s.id)).not.toContain('off_generic')
    const b = field({ allies: [thrower([{ item: 'it_napalm', qty: 1 }])] })
    act(b, b.ally(1), 'item', cell(1), { item: 'it_napalm', also: 2 }, dice(15, 3, 3, 3, 3))
    expect(b.foe(1).statuses.map((s) => s.id)).toContain('burning')
    expect(b.foe(2).statuses.map((s) => s.id)).toContain('burning')
  })

  it('宣告和行動對得上：每一個沒灰掉的目標、每一個適用的 also 選項都做得成', () => {
    const items = [{ item: 'it_nade', qty: 1 }]
    for (const slot of [1, 2, 3, 4]) {
      const a = target(items)
      const def = a.k.battle.getAction('item')!
      const opt = def.targets!(a.run(), a.ally(1)).find((t) => 'slot' in t.target && t.target.side === 'foe' && t.target.slot === slot)!
      expect(opt.blocks).toEqual([])
      const also = def.picks!(a.run(), a.ally(1)).find((p) => p.key === 'also')!.options.filter((o) => pickApplies(o, cell(slot)))
      for (const o of also) {
        const b = target(items)
        expect(() => act(b, b.ally(1), 'item', cell(slot), { item: 'it_nade', also: o.value })).not.toThrow()
      }
    }
  })

  it('煙霧彈 III：用 soft_cover，目標那一格加玩家選的相鄰一格都變成打不破的半掩體；在邊上不選就用唯一的相鄰格', () => {
    const a = field({ allies: [thrower([{ item: 'it_smoke3', qty: 3 }])] })
    const mine = (slot: number): BattleTarget => ({ side: 'ally', slot })
    act(a, a.ally(1), 'item', mine(2), { item: 'it_smoke3', also: 3 })
    expect(a.battle.cover.ally.map((c) => !!c.soft)).toEqual([false, true, true, false])
    expect(() => act(a, a.ally(1), 'item', mine(3), { item: 'it_smoke3' })).toThrow(/要選相鄰的一格/)
    act(a, a.ally(1), 'item', mine(1), { item: 'it_smoke3' })
    expect(a.battle.cover.ally.map((c) => !!c.soft)).toEqual([true, true, true, false])
    // 宣告：also 是我方的格
    expect(a.k.battle.getAction('item')!.picks!(a.run(), a.ally(1)).find((p) => p.key === 'also')).toMatchObject({ kind: 'ally_slot' })
  })
})

describe('立牌：放在格子上的消耗品', () => {
  const setup = (): Arena => field({ allies: [one({ weapon: 'pistol', ap: AP, quick: [{ item: 'it_decoy', qty: 2 }] }), one({ weapon: 'smg' }, 2), one({ weapon: 'knife' }, 3)] })
  const mine = (slot: number): BattleTarget => ({ side: 'ally', slot })

  it('放在我方一格：沒有操作者、耐久 1、種類 decoy；每格最多一台', () => {
    const a = setup()
    act(a, a.ally(1), 'item', mine(2), { item: 'it_decoy' })
    expect(a.battle.overlays).toHaveLength(1)
    const d = a.battle.overlays[0]!
    expect(d).toMatchObject({ kind: 'decoy', side: 'ally', slot: 2, name: '等身立牌', hp: { now: 1, max: 1 }, down: false })
    expect(d.owner).toBeUndefined()
    // 那一格已經掛著東西：灰掉、寫出原因；硬放也擋下
    const def = a.k.battle.getAction('item')!
    const cells = def.targets!(a.run(), a.ally(1)).filter((t) => 'slot' in t.target)
    expect(cells.map((t) => t.blocks)).toEqual([[], ['那一格已經掛著東西了。'], [], []])
    expect(() => act(a, a.ally(1), 'item', mine(2), { item: 'it_decoy' })).toThrow(BattleBlocked)
    expect(a.ally(1).quick).toEqual([{ item: 'it_decoy', qty: 1 }])
    // 放在敵方的格子上：擋下
    expect(() => act(a, a.ally(1), 'item', { side: 'foe', slot: 1 }, { item: 'it_decoy' })).toThrow(BattleBlocked)
  })

  it('下一次以那一格的人為目標的攻擊打在立牌上、那個人不受傷、立牌沒了；再下一次照常', () => {
    const a = setup()
    act(a, a.ally(1), 'item', mine(2), { item: 'it_decoy' })
    const victim = a.ally(2)
    const hp = victim.hp!.now
    const first = a.run(dice(15, 3, 3, 3)).attack(a.foe(1), victim)
    expect(first).toMatchObject({ redirected: true, hit: true })
    expect(victim.hp!.now).toBe(hp)
    expect(a.battle.overlays[0]!.down).toBe(true)
    // 再下一次照常
    const second = a.run(dice(15, 3, 3, 3)).attack(a.foe(1), victim)
    expect(second.redirected).toBeUndefined()
    expect(victim.hp!.now).toBeLessThan(hp)
  })

  it('只改打對面來的攻擊；打別格的人不受影響；掛著的東西本身被打照常', () => {
    const a = setup()
    act(a, a.ally(1), 'item', mine(2), { item: 'it_decoy' })
    const other = a.ally(3)
    const r = a.run(dice(15, 3, 3, 3)).attack(a.foe(1), other)
    expect(r.redirected).toBeUndefined()
    expect(a.battle.overlays[0]!.down).toBe(false)
    // 我方自己人打那一格的人（反應、誤傷）：不改打
    const own = a.run(dice(15, 3, 3, 3)).attack(a.ally(1), a.ally(2))
    expect(own.redirected).toBeUndefined()
    expect(a.battle.overlays[0]!.down).toBe(false)
  })
})

describe('紙鶴：不用新的 op，效果清單就寫得出來', () => {
  it('I 級：標記一個敵人（到戰鬥結束）；II 級：另外讓自己不受黑暗影響', () => {
    const a = field()
    const me = a.ally(1)
    const run = a.run(dice())
    run.effects((PACK.content.item!.find((x) => x.id === 'it_crane1') as unknown as { use: { effects: Array<Record<string, unknown>> } }).use.effects, { user: me, target: f('f1'), source: { kind: 'item', id: 'it_crane1', name: '紙鶴' } })
    expect(a.foe(1).statuses.map((s) => [s.id, s.until])).toEqual([['marked', { at: 'battle_end' }]])
    expect(me.statuses).toEqual([])
    run.effects(CRANE2, { user: me, target: f('f2'), source: { kind: 'item', id: 'it_crane2', name: '紙鶴' } })
    expect(a.foe(2).statuses.map((s) => s.id)).toEqual(['marked'])
    expect(me.statuses.map((s) => s.id)).toEqual(['see_dark'])
    // 不受黑暗：全場黑暗時，自己攻擊不吃黑暗的迴避加值
    a.battle.field.dark = true
    expect(run.seesDark(me)).toBe(true)
    expect(run.seesDark(a.ally(2))).toBe(false)
    // 被標記的人：隊友打他的命中加值
    expect(run.mods('hit_against', a.foe(1), me).reduce((s, p) => s + p.value, 0)).toBe(2)
  })
})

describe('格式檢查：fx、ammo、throw 的欄位寫錯在載入時擋下，訊息裡有那個欄位', () => {
  const load = (item: { id: string; [field: string]: unknown }) => {
    const k = createKernel([combatFeature])
    k.content.loadPack({ id: 'bad', content: { battle_status: TEST_STATUSES, item: [item] } })
    return () => readyFeatures(k)
  }
  const good = ammo('am_ok', '好彈', ['pistol'], { pierce: 2, on_hit: [BURN] })

  it('合格的特殊彈、投擲物、立牌：載入沒有問題', () => {
    expect(load(good)).not.toThrow()
    expect(load(throwItem('it_ok', '手雷', { dice: 3, cover_mult: 2, cover: 1, on_hit: [BURN], type: 'thermal', hit: 'tier' }))).not.toThrow()
    expect(load(throwItem('it_ok2', '閃光', { save: { attr: 'resolve', skill: 'composure', dc: 13 }, on_hit: [BURN] }))).not.toThrow()
  })

  it('ammo：fits、fx 缺了或寫錯', () => {
    expect(load(ITEM('it_b', '壞彈', { ammo: { fx: {} } }))).toThrow(/item\/it_b：.*ammo.*fits/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: [], fx: {} } }))).toThrow(/item\/it_b：.*fits/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'] } }))).toThrow(/item\/it_b：.*fx/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: 'pistol', fx: {} } }))).toThrow(/item\/it_b：.*fits/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { type: 'laser' } } }))).toThrow(/item\/it_b：.*type/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { pierce: 'lots' } } }))).toThrow(/item\/it_b：.*pierce/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { mystery: 1 } } }))).toThrow(/item\/it_b：.*mystery/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { on_use: { jam: 150 } } } }))).toThrow(/item\/it_b：.*jam/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { on_use: { backfire: { pct: 10 } } } } }))).toThrow(/item\/it_b：.*dice/)
    // on_hit 裡的效果：不認得的 op、欄位寫錯（訊息裡寫出那個 op）
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { on_hit: [{ op: 'explode' }] } } }))).toThrow(/item\/it_b：.*on_hit.*explode/)
    expect(load(ITEM('it_b', '壞彈', { ammo: { fits: ['pistol'], fx: { on_hit: [{ op: 'status', status: 'burning', turns: '2d6+foo' }] } } }))).toThrow(/item\/it_b：.*on_hit.*status.*turns/)
  })

  it('throw：欄位寫錯、use 不對（要 foe_slot 與 2 點行動點）', () => {
    expect(load(throwItem('it_b', '壞手雷', { dice: 3, type: 'laser' }))).toThrow(/item\/it_b：.*throw.*type/)
    expect(load(throwItem('it_b', '壞手雷', { dice: '3d6+foo' }))).toThrow(/item\/it_b：.*throw.*dice.*foo/)
    expect(load(throwItem('it_b', '壞手雷', { dice: 3, spin: 1 }))).toThrow(/item\/it_b：.*throw.*spin/)
    expect(load(throwItem('it_b', '壞手雷', { dice: 3, cover: 5 }))).toThrow(/item\/it_b：.*throw.*cover/)
    expect(load(throwItem('it_b', '壞手雷', {}))).toThrow(/item\/it_b：.*throw.*dice、save/)
    expect(load(throwItem('it_b', '壞手雷', { save: { attr: 'resolve', dc: 13 }, dice: 3 }))).toThrow(/item\/it_b：.*throw.*save/)
    expect(load(throwItem('it_b', '壞手雷', { save: { attr: 'luck', dc: 13 } }))).toThrow(/item\/it_b：.*throw.*attr/)
    expect(load(throwItem('it_b', '壞手雷', { dice: 3, on_hit: [{ op: 'explode' }] }))).toThrow(/item\/it_b：.*throw.*on_hit.*explode/)
    expect(load(throwItem('it_b', '壞手雷', { dice: 3 }, { target: 'ally' }))).toThrow(/item\/it_b：.*use\.target.*foe_slot/)
    expect(load(throwItem('it_b', '壞手雷', { dice: 3 }, { ap: 1 }))).toThrow(/item\/it_b：.*use\.ap.*2/)
    expect(load(ITEM('it_b', '壞立牌', { use: { ap: 1, target: 'self', effects: [{ op: 'decoy' }] } }))).toThrow(/item\/it_b：.*use\.target.*decoy/)
    expect(load(ITEM('it_b', '壞立牌', { use: { ap: 1, target: 'ally_slot', effects: [{ op: 'decoy', hp: 5 }] } }))).toThrow(/item\/it_b：.*decoy.*hp/)
    expect(load(ITEM('it_b', '壞煙霧', { use: { ap: 1, target: 'slot', effects: [{ op: 'soft_cover', kind: 'smoke', also: 'yes' }] } }))).toThrow(/item\/it_b：.*soft_cover.*also/)
  })

  it('敵人資料的武器寫 fx：格式不對在載入時擋下', () => {
    const SKILLS = ['firearms', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : 'reflex', desc: `${id}。` }))
    const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
    const enemy = (id: string, fx: unknown) => ({
      id, name: '測試敵人', desc: '測試用的敵人。', faction: 'hizakura', rank: 'minion', grades: [1, 5], kind: 'human',
      position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol', fx }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.3 },
    })
    const mk = (fx: unknown) => {
      const k = createKernel([combatFeature, enemiesFeature])
      k.content.loadPack({ id: 'e', content: { battle_status: TEST_STATUSES, skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }], enemy: [enemy('en_t', fx)] } })
      return () => readyFeatures(k)
    }
    expect(mk({ on_hit: [BURN], on_use: { jam: 10 }, silent: true })).not.toThrow()
    expect(mk({ type: 'laser' })).toThrow(/enemy\/en_t：weapons\[0\]\.fx：.*type/)
    expect(mk({ on_hit: [{ op: 'explode' }] })).toThrow(/enemy\/en_t：weapons\[0\]\.fx：.*explode/)
    expect(mk({ on_use: { jam: -1 } })).toThrow(/enemy\/en_t：weapons\[0\]\.fx：.*jam/)
  })
})
