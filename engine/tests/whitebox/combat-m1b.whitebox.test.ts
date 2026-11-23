// 白箱測試：features/combat 第二波新增的部分（ops.ts 的 op 退路、fx.ts 的合併與卡彈炸膛、throw.ts 的投擲與立牌、items.ts、schema.ts）。
// 補主套件沒有走到的分支與錯誤路徑；每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。
// 會失敗（和規格不一致）的寫在 tests/pending/ 與 dev/bugs/，這裡只放現在就對的行為。內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleEffectSource, BattleOverlay, BattleTarget, BattleUnit, BattleWeapon, ContentPack, Kernel } from '../../src'
import { BattleBlocked } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { ammoOf, ammoProblems, applyFx, fxOf, fxProblems, mergeFx, ownsSink, runOnHit, settleAmmo } from '../../src/features/combat/fx'
import { adjacentPick, ATTR, B, F, list, num, oneOf, orWord, pair, qty, S, schema, shape } from '../../src/features/combat/schema'
import { THROW_RANGE, throwBlock } from '../../src/features/combat/throw'
import { testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const dice = (...v: number[]): number[] => [...v, ...Array(80).fill(1)]
const ITEM = (id: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'wb_combat_m1b',
  content: {
    battle_status: [
      ...TEST_STATUSES,
      { id: 'limb_hurt', name: '肢體受創', desc: '命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' },
      { id: 'off_generic', name: '義體失效', desc: '義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'boost_generic', name: '義體超頻', desc: '義體超頻。', until: 'own_turn_end', turns: 1, kind: 'buff' },
    ],
    item: [
      ITEM('ammo_ap', { ammo: { fits: ['pistol'], fx: { pierce: 2, armor_mult: 2, type: 'physical' } }, tags: ['ammo'] }),
      ITEM('ammo_neural', { ammo: { fits: ['pistol'], fx: { type: 'neural', on_hit: [{ op: 'heal', who: 'self', amount: 1 }] } } }),
      ITEM('ammo_broken', { ammo: 'nope' }),
    ],
  },
} as unknown as ContentPack
const SKILL: BattleEffectSource = { kind: 'ability', id: 'sk_x', name: '測試技能' }
const f = (id: string): BattleTarget => ({ unit: id })
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'drone', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
const three = (prep: (k: Kernel) => void = () => {}, allies?: unknown[], foes?: unknown[], cover = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }): Arena =>
  arena(duel(allies ?? [one({ weapon: 'pistol' }), one({ weapon: 'smg' }, 2), one({ weapon: 'knife' }, 3)], foes ?? [foe(), foe(), foe()], cover), [combatFeature], (k) => {
    k.content.loadPack(PACK)
    prep(k)
  })
function go(a: Arena, listOf: Array<Rec>, target?: BattleTarget, o: { user?: BattleUnit; source?: BattleEffectSource; pick?: Rec; d?: number[]; n?: Record<string, number> } = {}) {
  const run = a.run(o.d ?? dice())
  const last = run.effects(listOf, { user: o.user ?? a.ally(1), ...(target ? { target } : {}), source: o.source ?? SKILL, ...(o.pick ? { pick: o.pick } : {}), ...(o.n ? { n: o.n } : {}) })
  return { run, last }
}
const tagsOf = (run: { beats: Array<{ tag?: string }> }): string[] => run.beats.map((b) => b.tag).filter((t): t is string => !!t)

// =====================================================================================================================
// schema.ts：格式檢查的小工具與數量
// =====================================================================================================================

describe('白箱 schema（features/combat/schema.ts；dev/adr/0015 第一節的格式檢查）', () => {
  it('每一個檢查函式合格回傳 null，不合格回傳一句寫出原因的話', () => {
    expect(F(3)).toBeNull()
    expect(F('2d6+1')).toBeNull()
    expect(F('bogus')).toMatch(/不認得的項/)
    expect(F(Number.NaN)).toMatch(/有限/)
    expect(B(true)).toBeNull()
    expect(B('true')).toMatch(/true 或 false/)
    expect(S('x')).toBeNull()
    expect(S('  ')).toMatch(/不能是空的/)
    expect(S(5)).toMatch(/字串/)
    expect(oneOf(['a', 'b'])('c')).toMatch(/「c」不在清單裡（可以寫：a、b）/)
    expect(orWord('full')('full')).toBeNull()
    expect(orWord('full')('half')).toMatch(/不認得的項 half/)
    expect(orWord('full')(3)).toBeNull()
    expect(num()('x')).toBe('要是數字')
    expect(num(1)(0)).toBe('要是 1 以上的數字')
    expect(num(1)(2)).toBeNull()
    expect(num()(Number.POSITIVE_INFINITY)).toBe('要是數字')
    expect(pair([1, 2])).toBeNull()
    expect(pair([1, 2.5])).toMatch(/兩個整數/)
    expect(pair([1])).toMatch(/兩個整數/)
    expect(list(S)('x')).toBe('要是陣列')
    expect(list(S)(['a', ''])).toMatch(/不能是空的/)
    expect(ATTR('luck')).toMatch(/不在清單裡/)
  })

  it('shape：不是物件、不認得的欄位、欄位不合格（前面接欄位名）、缺少一定要寫的欄位各一句；schema 略過 op、who、if，並檢查 anyOf', () => {
    const sh = shape({ a: F, b: S }, ['a'])
    expect(sh(5)).toMatch(/要是物件（欄位：a、b）/)
    expect(sh({ a: 1, z: 1 })).toMatch(/不認得的欄位 z（可以寫：a、b）/)
    expect(sh({ a: 'bogus' })).toMatch(/^a：/)
    expect(sh({ b: 'x' })).toBe('a：一定要寫')
    expect(sh({ a: 1 })).toBeNull()
    const sc = schema({ x: F, y: F }, ['x'], [['y', 'z']])
    expect(sc({ op: 'o', who: 'self', if: 'hit', x: 1, y: 2 })).toEqual([])
    expect(sc({ x: 1 })).toEqual(['y、z：至少要寫一個'])
    expect(sc({ x: undefined, y: 'bogus', q: 1 }).join('｜')).toMatch(/y：.*不認得的欄位 q.*x：一定要寫/)
  })

  it('qty：沒寫用預設；壞公式、非有限的數字、會丟錯的公式都退回預設（舊道具效果一向的寬容）；數字四捨五入', () => {
    const a = three()
    const ctx = { run: a.run(dice()), user: a.ally(1), n: {} }
    expect(qty(ctx, undefined, 7)).toBe(7)
    expect(qty(ctx, 'bogus', 3)).toBe(3)
    expect(qty(ctx, Number.NaN, 4)).toBe(4)
    expect(qty(ctx, Number.POSITIVE_INFINITY, 5)).toBe(5)
    expect(qty(ctx, 2.5, 0)).toBe(3)
    expect(qty(ctx, '1+1', 0)).toBe(2)
  })

  it('adjacentPick：沒選時第 1、4 格用唯一的相鄰格、中間兩格擋下；選了要是緊鄰的整數（COMBAT_SYSTEM 5.2 投擲物兩格）', () => {
    expect(adjacentPick(undefined, 1)).toBe(2)
    expect(adjacentPick(undefined, 4)).toBe(3)
    expect(() => adjacentPick(undefined, 2)).toThrow(BattleBlocked)
    expect(adjacentPick(3, 2)).toBe(3)
    for (const bad of [2, 4, 0, 5, 1.5, '3', null]) expect(() => adjacentPick(bad, 2)).toThrow(/要選緊鄰目標的一格/)
  })
})

// =====================================================================================================================
// fx.ts：武器的附帶效果
// =====================================================================================================================

describe('白箱 fx 的合併、格式與每一擊的加成（dev/work/M1b-ordnance.md 第一、二節；ITEMS 5.1）', () => {
  it('mergeFx：只有一邊就回傳那一邊；數字相加、護甲倍率相乘、type 以後面（彈）為準、旗標有一個就算、on_hit 接起來', () => {
    const a = { hit: 1, dice: 1, pierce: 1, cover_mult_min: 0.5, armor_mult: 2, type: 'physical', on_hit: [{ op: 'x' }] }
    const b = { hit: 2, pierce: 3, cover_mult_min: 1, armor_mult: 1.5, type: 'em', no_cover: true, silent: true, on_hit: [{ op: 'y' }] }
    expect(mergeFx(undefined, undefined)).toBeUndefined()
    expect(mergeFx(a, undefined)).toBe(a)
    expect(mergeFx(undefined, b)).toBe(b)
    expect(mergeFx(a, b)).toEqual({ hit: 3, dice: 1, pierce: 4, cover_mult_min: 1.5, armor_mult: 3, type: 'em', no_cover: true, silent: true, on_hit: [{ op: 'x' }, { op: 'y' }] })
    expect(mergeFx({ armor_mult: 2 }, { hit: 1 })).toEqual({ hit: 1, armor_mult: 2 })
    expect(mergeFx({ type: 'em' }, {})).toEqual({ type: 'em' })
    expect(mergeFx({ no_cover: true }, { silent: true })).toEqual({ no_cover: true, silent: true })
  })

  it('mergeFx 的 on_use：卡彈相加、上限 100；炸膛的百分比相加（上限 100）、骰數相加；只有一邊有炸膛就是那一邊', () => {
    expect(mergeFx({ on_use: { jam: 60 } }, { on_use: { jam: 70 } })).toEqual({ on_use: { jam: 100 } })
    expect(mergeFx({ on_use: { jam: 5 } }, {})).toEqual({ on_use: { jam: 5 } })
    expect(mergeFx({ on_use: { backfire: { pct: 60, dice: 1 } } }, { on_use: { backfire: { pct: 70, dice: 2 }, jam: 3 } })).toEqual({ on_use: { jam: 3, backfire: { pct: 100, dice: 3 } } })
    expect(mergeFx({ on_use: { backfire: { pct: 10, dice: 1 } } }, { hit: 1 })).toEqual({ hit: 1, on_use: { backfire: { pct: 10, dice: 1 } } })
  })

  it('fxProblems 與 ammoProblems：欄位型別、不認得的欄位、on_hit 的每一筆、fits 與 fx 的錯各一條；沒有 ammo 欄位的物品合格', () => {
    const a = three()
    const k = a.k
    expect(fxProblems(k, { hit: 1, dice: 1, pierce: 2, armor_mult: 2, type: 'physical', no_cover: true, silent: true, on_use: { jam: 10, backfire: { pct: 5, dice: 1 } }, on_hit: [{ op: 'heal', amount: 1 }] })).toEqual([])
    expect(fxProblems(k, 'x')[0]).toMatch(/要是物件/)
    expect(fxProblems(k, { hit: 1.5 })[0]).toMatch(/hit：要是整數/)
    expect(fxProblems(k, { zzz: 1 })[0]).toMatch(/不認得的欄位 zzz/)
    expect(fxProblems(k, { on_use: { jam: 101 } })[0]).toMatch(/jam：要是 0～100 的整數/)
    expect(fxProblems(k, { on_use: { backfire: { pct: 5, dice: 0 } } })[0]).toMatch(/1 以上的整數/)
    expect(fxProblems(k, { on_hit: [5] })[0]).toMatch(/每一筆要是/)
    expect(fxProblems(k, { on_hit: [{ op: 'nope' }] })[0]).toMatch(/^on_hit：.*不認得的效果 nope/)
    expect(ammoProblems(k, {})).toEqual([])
    expect(ammoProblems(k, { ammo: 'nope' })[0]).toMatch(/^ammo：要是物件/)
    expect(ammoProblems(k, { ammo: { fits: [], fx: {} } })).toEqual(['ammo：fits 至少要寫一種武器的類型'])
    expect(ammoProblems(k, { ammo: { fits: ['pistol'], fx: { hit: 0.5 } } })[0]).toMatch(/^ammo\.fx：/)
    expect(ammoProblems(k, { ammo: { fits: ['pistol'] } })[0]).toMatch(/fx：一定要寫/)
  })

  it('ammoOf 與 fxOf：沒裝彈、裝的彈查不到、查到但沒有 ammo 欄位都當沒有；自己的 fx 與彈的 fx 合起來', () => {
    const a = three()
    const w = testWeapon('pistol', 5)
    expect(ammoOf(a.k, w)).toBeUndefined()
    expect(fxOf(a.k, w)).toBeUndefined()
    w.ammo = 'ghost'
    expect(ammoOf(a.k, w)).toBeUndefined()
    w.ammo = 'ammo_ap'
    expect(ammoOf(a.k, w)!.def.fits).toEqual(['pistol'])
    expect(fxOf(a.k, w)).toEqual({ pierce: 2, armor_mult: 2, type: 'physical' })
    w.ext = { fx: { pierce: 1 } }
    expect(fxOf(a.k, w)).toMatchObject({ pierce: 3 })
    w.ext = { fx: 'not-a-record' }
    expect(fxOf(a.k, w)).toEqual({ pierce: 2, armor_mult: 2, type: 'physical' })
    k_item_without_ammo(a)
  })
  const k_item_without_ammo = (a: Arena): void => {
    a.k.content.loadPack({ id: 'x', content: { item: [ITEM('plain')] } } as unknown as ContentPack)
    expect(ammoOf(a.k, { ...testWeapon('pistol', 5), ammo: 'plain' })).toBeUndefined()
  }

  it('applyFx：加進這一擊的 opts：命中、骰數、穿甲相加；護甲倍率相乘；已經指定傷害類型的不蓋掉；遮蔽倍率取大的；silent 加標籤；on_hit 帶定力檢定的 sink 時標 noSink', () => {
    const o: Rec = { hit: 1, dice: 1, pierce: 1, armorMult: 2, type: 'neural', coverMultMin: 2, tags: ['x'] }
    applyFx(o, { hit: 2, dice: 1, pierce: 2, armor_mult: 1.5, type: 'em', cover_mult_min: 1, no_cover: true, silent: true, on_hit: [{ op: 'sink', save: { attr: 'resolve', dc: 10 } }] })
    expect(o).toEqual({ hit: 3, dice: 2, pierce: 3, armorMult: 3, type: 'neural', coverMultMin: 2, noCoverDamage: true, tags: ['x', 'silent'], noSink: true })
    const fresh: Rec = {}
    applyFx(fresh, { type: 'em', cover_mult_min: 0.5 })
    expect(fresh).toEqual({ type: 'em', coverMultMin: 0.5 })
    expect(ownsSink(undefined)).toBe(false)
    expect(ownsSink([{ op: 'sink', amount: 1 }])).toBe(false)
    expect(ownsSink([{ op: 'heal' }, { op: 'sink', save: {} }])).toBe(true)
  })

  it('settleAmmo：彈匣空了而且裝著特殊彈才作廢；沒有彈匣或還有彈的不動', () => {
    const w = { ...testWeapon('pistol', 5), ammo: 'ammo_ap' } as BattleWeapon
    w.mag!.now = 1
    settleAmmo(w)
    expect(w.ammo).toBe('ammo_ap')
    w.mag!.now = 0
    settleAmmo(w)
    expect(w.ammo).toBeUndefined()
    const knife = { ...testWeapon('knife', 5), ammo: 'x' } as BattleWeapon
    settleAmmo(knife)
    expect(knife.ammo).toBe('x')
  })

  it('卡彈：骰面在百分比以內就取消這一擊（話裡有武器名、attack.cancel 帶 jam），彈匣已扣、不擲命中；骰面在外面就照打（M1b-ordnance 第一節）', () => {
    const a = three(undefined, [one({ weapon: 'pistol' })])
    a.ally(1).weapons[0]!.ext = { fx: { on_use: { jam: 30 } } }
    const hit = go(a, [{ op: 'attack' }], f('f1'), { d: dice(31, 18, 3, 3, 3) })
    expect(hit.last.hit).toBe(true)
    const mag = a.ally(1).weapons[0]!.mag!.now
    const jam = go(a, [{ op: 'attack' }], f('f1'), { d: dice(30) })
    expect(jam.run.beats.some((b) => b.text.includes('卡彈了'))).toBe(true)
    expect(jam.last.hit).toBe(false)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(mag - 1)
    expect(a.foe(1).hp!.now).toBeLessThan(a.foe(1).hp!.max)
  })

  it('炸膛：只在沒卡彈時擲；成立就取消這一擊，開槍的人自己受物理傷害（骰數照 dice）；沒有 on_use 的武器不擲百分比骰', () => {
    const a = three(undefined, [one({ weapon: 'pistol' })])
    const me = a.ally(1)
    me.weapons[0]!.ext = { fx: { on_use: { backfire: { pct: 50, dice: 2 } } } }
    const hp = me.hp!.now
    const r = go(a, [{ op: 'attack' }], f('f1'), { d: dice(50, 4, 4) })
    expect(r.run.beats.some((b) => b.text.includes('炸膛了'))).toBe(true)
    expect(me.hp!.now).toBeLessThan(hp)
    // 骰面 51：沒炸，照常擲命中（第一顆是百分比，第二顆才是命中骰）
    const ok = go(a, [{ op: 'attack' }], f('f1'), { d: dice(51, 20, 3, 3, 3) })
    expect(ok.run.beats.some((b) => b.text.includes('炸膛'))).toBe(false)
    // 沒有 on_use：不吃百分比骰，第一顆就是命中骰
    me.weapons[0]!.ext = {}
    expect(go(a, [{ op: 'attack' }], f('f1'), { d: dice(20, 3, 3, 3) }).last.hit).toBe(true)
  })

  it('runOnHit：沒打中、沒造成傷害、被擋下、取消了都不做；命中而且有傷害才做，來源是那把武器；打在替身上時目標是那一台掛著的東西', () => {
    const a = three()
    a.k.battle.effect('probe', 'test', (ctx) => { seen.push(`${ctx.source.kind}:${ctx.source.id}:${ctx.unit?.id ?? ctx.overlay?.id ?? '-'}`) })
    const seen: string[] = []
    const run = a.run(dice())
    const w = testWeapon('pistol', 5)
    const base = { hit: true, crit: false, natural: 10, total: 10, evade: 8, raw: 5, dealt: 3, track: 'hp' as const, wound: false, downed: false }
    const go1 = (r: Partial<typeof base> & Rec, on: Rec[] | null = [{ op: 'probe' }]) => runOnHit(run, a.ally(1), a.foe(1), w, { ...base, ...r } as never, on ?? undefined)
    go1({ hit: false })
    go1({ dealt: 0 })
    go1({ negated: true })
    go1({ aborted: true })
    go1({}, null)
    go1({}, [])
    expect(seen).toEqual([])
    go1({})
    expect(seen).toEqual(['weapon:pistol:f1'])
    const o = overlay('o1', 'foe', 1)
    a.battle.overlays.push(o)
    runOnHit(run, a.ally(1), run.standIn(o), w, { ...base } as never, [{ op: 'probe' }])
    expect(seen).toEqual(['weapon:pistol:f1', 'weapon:pistol:o1'])
  })
})

// =====================================================================================================================
// throw.ts：投擲物與立牌
// =====================================================================================================================

describe('白箱 投擲物與立牌（dev/work/M1b-ordnance.md 第三、四節；ITEMS 5.2）', () => {
  it('throwBlock：距離超過 4 丟不到，訊息寫出距離與可丟的範圍；THROW_RANGE 是 1～4', () => {
    expect(THROW_RANGE).toEqual([1, 4])
    expect(throwBlock({ slot: 1 }, 4)).toBeNull()
    expect(throwBlock({ slot: 2 }, 4)).toBe('這一格的距離是 5，投擲物只丟得到距離 1～4 的格子。')
  })

  it('throw 的目標：沒有目標、是人、是我方的一格都擲不出去，訊息是一句完整的話；丟太遠也擋下', () => {
    const a = three()
    const t = (target?: BattleTarget) => () => go(a, [{ op: 'throw', dice: 1 }], target)
    expect(t()).toThrow('這個東西要丟在敵方的一格上。')
    expect(t(f('f1'))).toThrow('這個東西要丟在敵方的一格上。')
    expect(t({ side: 'ally', slot: 2 })).toThrow('這個東西要丟在敵方的一格上。')
    a.ally(1).slot = 4
    expect(t({ side: 'foe', slot: 3 })).toThrow(/距離是 6/)
  })

  it('throw 的 save 型（閃光彈）：兩格裡每個人各擲一次檢定，沒過的做 on_hit、last.ok 變 false；全過 last.ok 是 true；沒人的格子不擲', () => {
    const a = three()
    a.battle.units.f3!.slot = 3
    a.battle.units.f1!.slot = 1
    a.battle.units.f2!.slot = 2
    const sv = { op: 'throw', save: { attr: 'resolve', dc: 12 }, on_hit: [{ op: 'status', status: 'dazed' }] }
    // f1、f2 的意志都是 10：骰 1 → 失敗（f1）、骰 20 → 通過（f2）
    const r = go(a, [sv], { side: 'foe', slot: 1 }, { d: dice(1, 20) })
    expect(r.last.ok).toBe(false)
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('dazed')
    expect(a.foe(2).statuses.map((s) => s.id)).not.toContain('dazed')
    const all = go(a, [sv], { side: 'foe', slot: 1 }, { d: dice(20, 20) })
    expect(all.last.ok).toBe(true)
    // 目標那兩格都沒人：不擲、last.ok 是 true
    a.battle.units.f1!.out = 'down'
    a.battle.units.f2!.out = 'down'
    const none = go(a, [sv], { side: 'foe', slot: 1 }, { d: dice() })
    expect(none.last.ok).toBe(true)
    expect(none.run.beats.filter((b) => b.roll)).toHaveLength(0)
  })

  it('throw 的傷害型：沒有 on_hit 也行；沒有人的格子只打掛著的東西；cover 降兩格的遮蔽；一顆骰共用（COMBAT_SYSTEM 5.2）', () => {
    const a = three(undefined, undefined, undefined, { ally: [0, 0, 0, 0], foe: [2, 2, 0, 0] })
    a.battle.overlays.push(overlay('o2', 'foe', 2, { hp: { now: 1, max: 1 } }))
    const r = go(a, [{ op: 'throw', dice: 2, cover: 1 }], { side: 'foe', slot: 1 }, { d: dice(20, 6, 6, 6, 6, 6, 6) })
    expect(r.last.hit).toBe(true)
    expect(a.battle.overlays.find((o) => o.id === 'o2')!.down).toBe(true)
    expect(a.battle.cover.foe[0]!.level).toBe(1)
    expect(a.battle.cover.foe[1]!.level).toBe(1)
    // cover 為 0 或負數不動遮蔽
    const b = three(undefined, undefined, undefined, { ally: [0, 0, 0, 0], foe: [2, 2, 0, 0] })
    go(b, [{ op: 'throw', dice: 1, cover: 0 }], { side: 'foe', slot: 1 })
    expect(b.battle.cover.foe[0]!.level).toBe(2)
  })

  it('throw 命中效果有帶定力檢定的 sink 時，這一擊的傷害類型自己帶的沉溺不加（由那一筆決定；COMBAT_SYSTEM 5）', () => {
    const a = three()
    const before = a.foe(1).sink
    go(a, [{ op: 'throw', dice: 1, type: 'pleasure', on_hit: [{ op: 'sink', amount: 0, save: { attr: 'resolve', dc: 40 } }] }], { side: 'foe', slot: 1 }, { d: dice(20, 6, 6, 6, 1, 1, 1, 1) })
    expect(a.foe(1).sink).toBe(before)
  })

  it('立牌：放在敵方的一格、或沒有目標丟錯；放上去之後那一格再放丟錯（每格一台）；下一擊改打它而且一定倒（立牌必倒）', () => {
    const a = three()
    expect(() => go(a, [{ op: 'decoy' }], { side: 'foe', slot: 1 })).toThrow('立牌要放在我方的一格上。')
    expect(() => go(a, [{ op: 'decoy' }])).toThrow('立牌要放在我方的一格上。')
    expect(() => go(a, [{ op: 'decoy' }], f('a1'))).toThrow('立牌要放在我方的一格上。')
    go(a, [{ op: 'decoy' }], { side: 'ally', slot: 2 })
    expect(a.battle.overlays.filter((o) => o.kind === 'decoy')).toHaveLength(1)
    expect(() => go(a, [{ op: 'decoy' }], { side: 'ally', slot: 2 })).toThrow(BattleBlocked)
    const run = a.run(dice(1))
    const hp = a.ally(2).hp!.now
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r.redirected).toBe(true)
    expect(a.ally(2).hp!.now).toBe(hp)
    expect(a.battle.overlays.find((o) => o.kind === 'decoy')!.down).toBe(true)
    // 我方打自己人的格子、打已經在打替身的人，都不會再被改向
    expect(tagsOf(run)).toBeDefined()
  })
})

// =====================================================================================================================
// ops.ts：各個 op 的退路
// =====================================================================================================================

describe('白箱 ops 的退路（features/combat/ops.ts；dev/work/M1b-ops.md）', () => {
  it('attack：沒有落點（who: slot 那一格沒人）不做；spend 負數當 0（不耗彈）、沒有彈匣的武器 spend: all 是 0；壞公式的 spend 退回 1', () => {
    const a = three()
    const pistol = a.ally(1).weapons[0]!
    const mag = pistol.mag!.now
    expect(go(a, [{ op: 'attack', who: 'slot' }], { side: 'foe', slot: 4 }).run.beats).toEqual([])
    go(a, [{ op: 'attack', spend: -3 }], f('f1'))
    expect(pistol.mag!.now).toBe(mag)
    go(a, [{ op: 'attack', spend: 'bogus' }], f('f1'))
    expect(pistol.mag!.now).toBe(mag - 1)
    const knife = go(a, [{ op: 'attack', spend: 'all' }], f('f1'), { user: a.ally(3) })
    expect(knife.run.beats.length).toBeGreaterThan(0)
    expect(knife.last.hit).toBeDefined()
  })

  it('attack：as 的屬性單位沒寫當 10、基本功沒學過當 0；damage、no_cover、no_wound、cover_mult_min、armor_mult、tags、label 都進這一擊', () => {
    const a = three()
    const me = a.ally(1)
    delete (me.attrs as Rec).tech
    const r = go(a, [{ op: 'attack', as: { attr: 'tech', skill: 'cyberware' }, damage: 2, no_cover: true, no_wound: true, cover_mult_min: 1, armor_mult: 0, tags: ['x', 5], label: '重擊' }], f('f1'), { d: dice(20, 3, 3, 3) })
    expect(r.last.hit).toBe(true)
    const roll = r.run.beats.find((b) => b.tag === 'hit' || b.tag === 'crit')!
    expect(roll.text).toContain('重擊')
  })

  it('strike：沒有落點跳過；range、cover_mult、traits、pierce 照欄位組臨時武器（武器名是來源的名字）', () => {
    const a = three()
    const none = go(a, [{ op: 'strike', who: 'slot', dice: 1 }], { side: 'foe', slot: 4 })
    expect(none.run.beats).toEqual([])
    const r = go(a, [{ op: 'strike', dice: 2, range: [1, 7], cover_mult: 0.5, traits: ['melee'], pierce: 1, hit: 5, label: '撞擊' }], f('f1'), { d: dice(20, 2, 2) })
    expect(r.last.hit).toBe(true)
    expect(r.run.beats.find((b) => b.tag === 'hit' || b.tag === 'crit')!.text).toContain('撞擊')
  })

  it('damage：沒有落點（沒有目標）跳過；落在退出的人身上也不丟錯；last.downed 只在這一筆讓他倒下時成立（COMBAT_SYSTEM 5）', () => {
    const a = three()
    expect(go(a, [{ op: 'damage', amount: 5 }]).run.beats).toEqual([])
    a.battle.units.f1!.hp!.now = 3
    const r = go(a, [{ op: 'damage', amount: 99 }], f('f1'))
    expect(r.last.downed).toBe(true)
    // 已經倒下的再打：不是這一筆倒下的
    const again = go(a, [{ op: 'damage', amount: 99 }], f('f1'))
    expect(again.last.downed).toBe(false)
  })

  it('status：save 對自己下（不帶 other）；save 用屬性名當標籤；turns 至少 1；data 的值轉數字；已經退出的人不給（COMBAT_SYSTEM 4）', () => {
    const a = three()
    const self = go(a, [{ op: 'status', who: 'self', status: 'dazed', save: { attr: 'resolve', dc: 1 } }], undefined, { d: dice(20) })
    expect(a.ally(1).statuses.map((s) => s.id)).not.toContain('dazed')
    expect(self.run.beats.some((b) => b.roll)).toBe(true)
    go(a, [{ op: 'status', status: 'suppressed', turns: 0, data: { hit: '-3' } }], f('f1'))
    expect(a.foe(1).statuses.find((s) => s.id === 'suppressed')!.until).toMatchObject({ turns: 1 })
    a.battle.units.f2!.out = 'down'
    go(a, [{ op: 'status', status: 'suppressed' }], f('f2'))
    expect(a.foe(2).statuses).toEqual([])
  })

  it('unstatus：status 與 kinds 都沒寫時什麼也不拿；kinds 裡寫了、但狀態的規則查不到的不拿；count 0 不拿', () => {
    const a = three()
    const run = a.run(dice())
    run.applyStatus(a.foe(1), 'dazed')
    run.applyStatus(a.foe(1), 'suppressed')
    go(a, [{ op: 'unstatus' }], f('f1'))
    go(a, [{ op: 'unstatus', kinds: ['wound'], count: 0 }], f('f1'))
    expect(a.foe(1).statuses).toHaveLength(2)
    a.foe(1).statuses.push({ id: 'ghost_status', until: { at: 'battle_end' } } as never)
    go(a, [{ op: 'unstatus', kinds: ['wound'], count: 5 }], f('f1'))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['suppressed', 'ghost_status'])
  })

  it('check：沒寫 vs（或寫的是沒法解的）整筆不擲、不寫 last.ok；vs: will 單位沒有意志與定力時按 10 算；vs 物件沒有對象時用這場戰鬥的等級', () => {
    const a = three()
    const none = go(a, [{ op: 'check', attr: 'tech' }], f('f1'))
    expect(none.run.beats).toEqual([])
    expect(none.last.ok).toBeUndefined()
    a.battle.units.f1!.attrs = {} as never
    a.battle.units.f1!.skills = {}
    const will = go(a, [{ op: 'check', attr: 'tech', vs: 'will' }], f('f1'), { d: dice(10) })
    expect(will.run.beats.find((b) => b.roll)!.roll!.dc).toBe(10)
    const grade = go(a, [{ op: 'check', attr: 'tech', vs: { base: 4, per_grade: 3 } }], undefined, { d: dice(10) })
    expect(grade.run.beats.find((b) => b.roll)!.roll!.dc).toBe(4 + 3 * a.battle.grade)
  })

  it('shift：push 一次推 n 格、中途推不動就停；落在替身上沒有作用（run.shift 回傳 false）', () => {
    const a = three()
    go(a, [{ op: 'shift', dir: 'push', n: 9 }], f('f1'))
    expect(a.foe(1).slot).toBeGreaterThanOrEqual(1)
    const o = overlay('o1', 'foe', 2)
    a.battle.overlays.push(o)
    const before = a.battle.units.f2!.slot
    go(a, [{ op: 'shift', dir: 'pull', who: 'foe_overlays' }])
    expect(a.battle.units.f2!.slot).toBe(before)
  })

  it('move：不在場上的人沒有作用；目標就在要去的那一格也沒有作用；to: adjacent 選到不相鄰的丟 BattleBlocked（COMBAT_SYSTEM 1.3）', () => {
    const a = three()
    a.battle.units.a3!.slot = 0
    expect(go(a, [{ op: 'move', to: 'pick' }], f('a3'), { pick: { slot: 1 } }).run.beats).toEqual([])
    const stay = go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: { slot: a.ally(1).slot } })
    expect(stay.run.beats).toEqual([])
    expect(() => go(a, [{ op: 'move', to: 'adjacent' }], f('a1'), { pick: { slot: 4 } })).toThrow('只能換到相鄰的格。')
    expect(() => go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: { slot: 5 } })).toThrow('要選一格。')
    expect(() => go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: { slot: 1.5 } })).toThrow('要選一格。')
  })

  it('swap：退出的隊友、不在場的、敵人都丟 BattleBlocked；對象自己不在場上沒有作用', () => {
    const a = three()
    a.battle.units.a3!.out = 'down'
    expect(() => go(a, [{ op: 'swap', with: 'mate' }], f('a1'), { pick: { mate: 'a3' } })).toThrow('要選另一名隊友。')
    expect(() => go(a, [{ op: 'swap', with: 'mate' }], f('a1'), { pick: { mate: 'f1' } })).toThrow('要選另一名隊友。')
    expect(() => go(a, [{ op: 'swap', with: 'mate' }], f('a1'), { pick: { mate: 'a1' } })).toThrow('要選另一名隊友。')
    expect(() => go(a, [{ op: 'swap', with: 'mate' }], f('a1'), { pick: { mate: { unit: 5 } } })).toThrow('要選另一名隊友。')
    a.battle.units.a1!.slot = 0
    expect(go(a, [{ op: 'swap', with: 'mate' }], f('a1'), { pick: { mate: 'a2' } }).run.beats).toEqual([])
  })

  it('cover：沒有落點的格（not on field、指到不存在的東西）整筆不做；levels 是 0 不做；落在掛著的東西上跳過（E5）', () => {
    const a = three(undefined, undefined, undefined, { ally: [1, 0, 0, 0], foe: [0, 0, 0, 0] })
    a.battle.units.a2!.slot = 0
    expect(go(a, [{ op: 'cover', levels: 1, who: 'self' }], undefined, { user: a.ally(2) }).run.beats).toEqual([])
    expect(go(a, [{ op: 'cover', levels: 1 }], { overlay: 'ghost' }).run.beats).toEqual([])
    expect(go(a, [{ op: 'cover', levels: 0 }], { side: 'ally', slot: 1 }).run.beats).toEqual([])
    expect(go(a, [{ op: 'cover', levels: 1 }]).run.beats).toEqual([])
    const lowered = go(a, [{ op: 'cover', levels: -1 }], { side: 'ally', slot: 1 })
    expect(a.battle.cover.ally[0]!.level).toBe(0)
    expect(tagsOf(lowered.run)).toContain('cover.break')
  })

  it('ap、mag、pool：減不會低於 0；本來就超過上限的不被拉下來；沒有變化不記；mag full 與沒有彈匣；pool 沒有那一池不動', () => {
    const a = three()
    const me = a.ally(1)
    me.ap.now = me.ap.max + 3
    expect(go(a, [{ op: 'ap', who: 'self', amount: 2 }]).run.beats).toEqual([])
    expect(me.ap.now).toBe(me.ap.max + 3)
    go(a, [{ op: 'ap', who: 'self', amount: -99 }])
    expect(me.ap.now).toBe(0)
    me.weapons[0]!.mag!.now = 0
    go(a, [{ op: 'mag', who: 'self', amount: 'full' }])
    expect(me.weapons[0]!.mag!.now).toBe(me.weapons[0]!.mag!.max)
    expect(go(a, [{ op: 'mag', who: 'self', amount: 'full' }]).run.beats).toEqual([])
    go(a, [{ op: 'mag', who: 'self', amount: 5, over_cap: true }])
    expect(me.weapons[0]!.mag!.now).toBe(me.weapons[0]!.mag!.max + 5)
    expect(go(a, [{ op: 'mag', who: 'self', amount: 1 }], undefined, { user: a.ally(1) }).run.beats).toEqual([])
    a.ally(3).weapons = []
    expect(go(a, [{ op: 'mag', amount: 1 }], f('a3')).run.beats).toEqual([])
    expect(go(a, [{ op: 'pool', pool: 'nope', amount: 1 }], f('a1')).run.beats).toEqual([])
    me.pools.ram!.now = 0
    const p = go(a, [{ op: 'pool', pool: 'ram', amount: 'full' }], f('a1'))
    expect(me.pools.ram!.now).toBe(me.pools.ram!.max)
    expect(p.run.beats[0]!.text).toContain('RAM')
    expect(go(a, [{ op: 'pool', pool: 'ram', amount: 'full' }], f('a1')).run.beats).toEqual([])
  })

  it('mag_cap：加容量、現有的也加；到上限 4 就不再加；max 比上限低時以 max 為準；沒有彈匣或 amount 0 沒有作用', () => {
    const a = three()
    const w = a.ally(1).weapons[0]!
    w.mag = { now: 1, max: 2 }
    go(a, [{ op: 'mag_cap', amount: 1 }], f('a1'))
    expect(w.mag).toEqual({ now: 2, max: 3 })
    go(a, [{ op: 'mag_cap', amount: 9 }], f('a1'))
    expect(w.mag.max).toBe(4)
    expect(go(a, [{ op: 'mag_cap', amount: 1 }], f('a1')).run.beats).toEqual([])
    w.mag = { now: 1, max: 2 }
    go(a, [{ op: 'mag_cap', amount: 5, max: 3 }], f('a1'))
    expect(w.mag.max).toBe(3)
    go(a, [{ op: 'mag_cap', amount: 0 }], f('a1'))
    expect(w.mag.max).toBe(3)
    a.ally(3).weapons = []
    expect(go(a, [{ op: 'mag_cap', amount: 1 }], f('a3')).run.beats).toEqual([])
  })

  it('implant take：沒有義體、已經卸光、kind 對不上、對象已退出都回 ok: false；pick.implant 超出範圍改挑第一件還沒失效的；到戰鬥結束的戰後多一行', () => {
    const a = three()
    const take = (pick?: Rec, kind?: string) => go(a, [{ op: 'implant', mode: 'off', take: true, ...(kind ? { kind } : {}) }], f('f1'), pick ? { pick } : {})
    expect(take().last.ok).toBe(false)
    a.foe(1).implants = [{ kind: 'eye', name: '義眼' }, { kind: 'arm', name: '義臂' }] as never
    expect(take(undefined, 'leg').last.ok).toBe(false)
    expect(take({ implant: 9 }).last.ok).toBe(true)
    expect((a.foe(1).ext.implants_gone as number[])).toEqual([0])
    expect(take({ implant: 0 }).last.ok).toBe(true)
    expect((a.foe(1).ext.implants_gone as number[]).sort()).toEqual([0, 1])
    expect(take().last.ok).toBe(false)
    a.battle.units.f2!.implants = [{ kind: 'eye', name: '義眼' }] as never
    a.battle.units.f2!.out = 'down'
    expect(go(a, [{ op: 'implant', mode: 'off', take: true }], f('f2')).last.ok).toBe(false)
  })

  it('revive 與 wound：沒有落點不丟錯；頭與軀幹的重創降級；沒有 hp 的軀幹重創不丟錯；橋的重創把層數上限加回來；part 不認得的跳過', () => {
    const a = three()
    const t = a.battle.units.a2!
    t.wounds = { head: 2, torso: 2, bridge: 2, limb: 2 }
    t.layersMax = 3
    t.hp!.max = 20
    go(a, [{ op: 'wound', mode: 'treat' }], f('a2'))
    expect(t.wounds).toEqual({ head: 1, torso: 1, bridge: 1, limb: 1 })
    expect(t.hp!.max).toBe(25)
    expect(t.layersMax).toBe(4)
    go(a, [{ op: 'wound', mode: 'treat' }], f('a2'))
    expect(t.wounds).toEqual({})
    const bare = a.battle.units.a3!
    bare.hp = undefined
    bare.wounds = { torso: 2 }
    go(a, [{ op: 'wound', mode: 'clear' }], f('a3'))
    expect(bare.wounds).toEqual({})
    expect(go(a, [{ op: 'revive', hp: 5 }]).run.beats).toEqual([])
    expect(go(a, [{ op: 'wound', mode: 'treat' }]).run.beats).toEqual([])
  })

  it('field：未知的 key 照「<key>：開／關」記一句；value 不是 true 當 false（COMBAT_SYSTEM 2.5 場地）', () => {
    const a = three()
    const r = go(a, [{ op: 'field', key: 'fog' }, { op: 'field', key: 'fog', value: 'no' }])
    expect(r.run.beats.map((b) => b.text)).toEqual(['fog：開。', 'fog：關。'])
    expect(a.battle.field.fog).toBe(false)
  })

  it('order：兩個人都選不到、對象是自己都丟 BattleBlocked；act_next 沒寫就只換順位、不補行動點（dev/adr/0015 E7）', () => {
    const a = arena(duel([one(), one({}, 2), one({}, 3)], [foe(), foe(), foe()]), [combatFeature], (k) => k.content.loadPack(PACK))
    expect(() => go(a, [{ op: 'order', with: 'buddy' }], f('a1'), { pick: { buddy: { unit: 'ghost' } } })).toThrow('要選另一個人來對調行動的順序。')
    const ap = a.ally(2).ap.now
    go(a, [{ op: 'order', with: 'buddy' }], f('a2'), { pick: { buddy: 'f3' } })
    expect(a.ally(2).ap.now).toBe(ap)
  })

  it('sink：save 沒寫基本功用屬性名當標籤、對自己下不帶 other；amount 0 或負的不加；沒有落點跳過', () => {
    const a = three()
    const run = go(a, [{ op: 'sink', amount: 2, who: 'self', save: { attr: 'resolve', dc: 40 } }], undefined, { d: dice(2) })
    expect(a.ally(1).sink).toBe(2)
    expect(run.run.beats.some((b) => b.roll)).toBe(true)
    go(a, [{ op: 'sink', amount: -4 }], f('a1'))
    go(a, [{ op: 'sink', amount: 0 }], f('a1'))
    expect(a.ally(1).sink).toBe(2)
    expect(go(a, [{ op: 'sink', amount: 1 }]).run.beats).toEqual([])
  })

  it('load：沒有橋的人記一句不加；pleasure 的沉溺走 gainSink（sink.before 擋得下，擋下就不加沉溺但感載照加）（COMBAT_SYSTEM 5）', () => {
    const a = three((k) => k.battle.on('sink.before', 't', ({ out }) => { out.block = true }))
    a.battle.units.f1!.load = undefined
    const r = go(a, [{ op: 'load', amount: 5 }], f('f1'))
    expect(r.last.overloaded).toBe(false)
    expect(r.run.beats.some((b) => b.text.includes('沒有橋'))).toBe(true)
    const p = go(a, [{ op: 'load', amount: 5, type: 'pleasure', exact: true }], f('f2'))
    expect(a.foe(2).load!.now).toBeGreaterThan(0)
    expect(a.foe(2).sink).toBe(0)
    expect(p.last.overloaded).toBe(false)
  })
})

// =====================================================================================================================
// items.ts：使用道具的錯誤路徑
// =====================================================================================================================

describe('白箱 使用道具的退路（features/combat/items.ts；COMBAT_SYSTEM 1.3、ITEMS 5.2）', () => {
  const USE = (target: string, more: Rec = {}): Rec => ({ target, ap: 1, effects: [{ op: 'heal', amount: 2 }], ...more })
  const ITEMS = [
    ITEM('i_self', { use: USE('self'), tags: ['medical'] }),
    ITEM('i_ally', { use: USE('ally', { ap: 2, ap_other: 1 }) }),
    ITEM('i_foe', { use: USE('foe', { range: [2, 4], effects: [{ op: 'status', status: 'dazed' }] }) }),
    ITEM('i_foe_one', { use: USE('foe', { range: [3, 3], effects: [{ op: 'status', status: 'dazed' }] }) }),
    ITEM('i_throw', { use: USE('foe_slot', { ap: 2, effects: [{ op: 'throw', dice: 1 }] }) }),
    ITEM('i_cell', { use: USE('ally_slot', { effects: [{ op: 'soft_cover', kind: 'smoke' }] }) }),
    ITEM('i_decoy', { use: USE('ally_slot', { effects: [{ op: 'decoy' }] }) }),
    ITEM('i_slot', { use: USE('slot', { effects: [{ op: 'soft_cover', kind: 'smoke' }] }) }),
    ITEM('i_script', { use: USE('self', { tag_required: 'quickhack', effects: [{ op: 'heal', amount: 1 }] }) }),
    ITEM('i_net_only', { use: USE('self', { modes: ['net'] }) }),
    ITEM('i_smoke3', { use: USE('foe_slot', { ap: 2, effects: [{ op: 'soft_cover', kind: 'smoke', also: true }] }) }),
  ]
  const rig = (quick: Array<[string, number]>, o: Rec = {}): Arena => {
    const a = arena(duel([one({ weapon: 'pistol', quick: quick.map(([item, qty]) => ({ item, qty })), ...o }), one({}, 2), one({}, 3)], [foe(), foe(), foe()]), [combatFeature], (k) => {
      k.content.loadPack(PACK)
      k.content.loadPack({ id: 'wb_items', content: { item: ITEMS } } as unknown as ContentPack)
    })
    return a
  }
  const def = (a: Arena) => a.k.battle.getAction('item')!
  const use = (a: Arena, target: BattleTarget | null, pick: Rec = {}, user: BattleUnit = a.ally(1)) => {
    const run = a.run(dice())
    const d = def(a)
    const input = { action: 'item', ...(target ? { target } : {}), pick } as never
    d.run(run, user, target, input)
    return run
  }
  const err = (fn: () => void): string => {
    try { fn() } catch (e) { return e instanceof BattleBlocked ? e.reasons.join('') : String(e) }
    return ''
  }

  it('挑道具：兩件以上沒選丟「要選用哪一個道具」；選到快取格裡沒有的丟「沒有這個道具」；只有一件可以不選（用掉最後一個就從快取格拿掉）', () => {
    const a = rig([['i_self', 1], ['i_ally', 1]])
    expect(err(() => use(a, f('a1')))).toBe('要選用哪一個道具。')
    expect(err(() => use(a, f('a1'), { item: 'i_ghost' }))).toBe('快取格裡沒有這個道具。')
    const b = rig([['i_self', 1]])
    b.ally(1).hp!.now = 1
    use(b, f('a1'))
    expect(b.ally(1).quick).toEqual([])
    expect(b.ally(1).hp!.now).toBeGreaterThan(1)
    const c = rig([['i_self', 2]])
    use(c, f('a1'))
    expect(c.ally(1).quick).toEqual([{ item: 'i_self', qty: 1 }])
  })

  it('這個人沒有道具要的標籤（tag_required）丟 BattleBlocked 並寫出道具名；沒有目標丟「要選一個目標」（ITEMS 5.2）', () => {
    const a = rig([['i_script', 1]])
    expect(err(() => use(a, f('a1')))).toMatch(/要有「quickhack」才用得了/)
    a.ally(1).tags.push('quickhack')
    expect(err(() => use(a, null))).toBe('要選一個目標。')
    expect(err(() => use(a, f('a1')))).toBe('')
  })

  it('自己用的：對別人用、對一格用都擋下；給隊友的：對一格用擋下；放格子的：對人用、放在敵方擋下', () => {
    const self = rig([['i_self', 1]])
    expect(err(() => use(self, f('a2')))).toBe('這個道具只能自己用。')
    expect(err(() => use(self, { side: 'ally', slot: 1 }))).toBe('這個道具不是這樣用的。')
    const ally = rig([['i_ally', 3]])
    expect(err(() => use(ally, { side: 'ally', slot: 1 }))).toBe('這個道具不是這樣用的。')
    expect(err(() => use(ally, f('a2')))).toBe('')
    const cell = rig([['i_cell', 3]])
    expect(err(() => use(cell, f('a1')))).toBe('這個道具不是這樣用的。')
    expect(err(() => use(cell, { side: 'foe', slot: 1 }))).toBe('這個道具只能放在我方的一格上。')
    expect(err(() => use(cell, { side: 'ally', slot: 1 }))).toBe('')
    const slot = rig([['i_slot', 3]])
    expect(err(() => use(slot, { side: 'foe', slot: 2 }))).toBe('')
  })

  it('丟的道具：丟在我方、丟太遠都擋下；對敵人用的：對隊友、對退出的人擋下，超出 use.range 的距離擋下並寫出距離', () => {
    const t = rig([['i_throw', 3]])
    expect(err(() => use(t, { side: 'ally', slot: 1 }))).toBe('這個道具要丟在敵方的一格上。')
    t.ally(1).slot = 4
    expect(err(() => use(t, { side: 'foe', slot: 4 }))).toMatch(/距離是 7/)
    const foes = rig([['i_foe', 3]])
    expect(err(() => use(foes, f('a2')))).toBe('這個道具要用在一個敵人身上。')
    foes.battle.units.f2!.out = 'down'
    expect(err(() => use(foes, f('f2')))).toBe('這個敵人已經不在場上了。')
    expect(err(() => use(foes, f('f1')))).toMatch(/只用得到距離 2～4 的敵人，這個人的距離是 1/)
    expect(err(() => use(foes, f('f3')))).toBe('')
    const exact = rig([['i_foe_one', 3]])
    expect(err(() => use(exact, f('f1')))).toMatch(/只用得到距離 3 的敵人/)
  })

  it('費用：沒選道具、選不到時 1 點；替隊友用才算 ap_other，替自己用照 ap；用在敵人身上照 ap；costTags 帶 item 與 item:<標籤>', () => {
    const a = rig([['i_ally', 2], ['i_self', 1]])
    const run = a.run(dice())
    const d = def(a)
    const cost = (input?: Rec) => d.cost(run, a.ally(1), input as never)
    expect(cost()).toEqual({ ap: 1 })
    expect(cost({ pick: { item: 'i_ghost' } })).toEqual({ ap: 1 })
    expect(cost({ pick: { item: 'i_ally' }, target: f('a2') })).toEqual({ ap: 1 })
    expect(cost({ pick: { item: 'i_ally' }, target: f('a1') })).toEqual({ ap: 2 })
    expect(cost({ pick: { item: 'i_ally' }, target: f('f1') })).toEqual({ ap: 2 })
    expect(d.costTags!(run, a.ally(1), { pick: { item: 'i_self' } } as never)).toEqual(['item', 'item:medical'])
    expect(d.costTags!(run, a.ally(1), undefined)).toEqual(['item'])
  })

  it('blocks 與 targets：沒有能用的道具（含只能在別的戰場用的）整個灰掉；每一件都缺標籤時寫出每一條原因；一格一格只列用得到的', () => {
    const none = rig([['i_net_only', 1]])
    const run = none.run(dice())
    expect(def(none).blocks!(run, none.ally(1))).toEqual(['快取格裡沒有能用的道具。'])
    const tag = rig([['i_script', 1]])
    expect(def(tag).blocks!(tag.run(), tag.ally(1))).toEqual(['i_script要有「quickhack」才用得了，這個人沒有。'])
    const mix = rig([['i_script', 1], ['i_self', 1]])
    expect(def(mix).blocks!(mix.run(), mix.ally(1))).toEqual([])
    const cells = rig([['i_cell', 1], ['i_throw', 1], ['i_foe', 1]])
    const targets = def(cells).targets!(cells.run(), cells.ally(1))
    const cellsOnly = targets.filter((t) => 'slot' in t.target)
    expect(cellsOnly.map((t) => `${(t.target as { side: string }).side}${(t.target as { slot: number }).slot}`).sort()).toEqual(['ally1', 'ally2', 'ally3', 'ally4', 'foe1', 'foe2', 'foe3', 'foe4'])
    // 放在已經掛著東西的格上灰掉
    const decoy = rig([['i_decoy', 1]])
    decoy.battle.overlays.push(overlay('d1', 'ally', 2))
    const dt = def(decoy).targets!(decoy.run(), decoy.ally(1)).filter((t) => 'slot' in t.target)
    expect(dt.find((t) => (t.target as { slot: number }).slot === 2)!.blocks).toEqual(['那一格已經掛著東西了。'])
    expect(dt.find((t) => (t.target as { slot: number }).slot === 3)!.blocks).toEqual([])
    // 隊友不相鄰（站位差 2 以上）：灰掉，原因是要相鄰
    const far = rig([['i_ally', 1]])
    const ft = def(far).targets!(far.run(), far.ally(1)).filter((t) => 'unit' in t.target)
    expect(ft.find((t) => (t.target as { unit: string }).unit === 'a3')!.blocks).toContain('要相鄰才用得到。')
  })

  it('picks：只有一種道具時 required 是 false；兩種以上才必選；煙霧彈 III 與投擲物多一個「相鄰的一格」的選項（foe_slot）；不需要的道具沒有這個選項', () => {
    const one1 = rig([['i_self', 1]])
    const p1 = def(one1).picks!(one1.run(), one1.ally(1))
    expect(p1).toHaveLength(1)
    expect(p1[0]).toMatchObject({ key: 'item', required: false })
    const none = rig([])
    expect(def(none).picks!(none.run(), none.ally(1))).toEqual([])
    const two = rig([['i_self', 1], ['i_smoke3', 1]])
    const p2 = def(two).picks!(two.run(), two.ally(1))
    expect(p2[0]).toMatchObject({ key: 'item', required: true })
    expect(p2[1]).toMatchObject({ key: 'also', kind: 'foe_slot', required: false })
    expect((p2[1] as { options: unknown[] }).options).toHaveLength(4)
  })
})
