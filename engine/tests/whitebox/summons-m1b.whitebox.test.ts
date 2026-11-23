// 白箱測試：features/summons（M1b：無人機的效果 drone.*、沒有操作者的每輪自己動、被電磁打到停機、被擊落的後果、臨時機）。
// 補主套件沒有走到的分支與錯誤路徑；每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。
// 會失敗（和規格不一致）的寫在 tests/pending/ 與 dev/bugs/，這裡只放現在就對的行為。內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleEffectSource, BattleOverlay, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { summonsFeature } from '../../src/features/summons'
import { DRONE_CAP_BY_SYNC, capBlock, capOf, capTags, droneWeapon, gradeOf, hang, isFixed, isShooter, isStunned, moveSlots, moveTo, stateOf, syncOf, widestCap } from '../../src/features/summons/drones'
import { testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const dice = (...v: number[]): number[] => [...v, ...Array(150).fill(1)]
const SRC: BattleEffectSource = { kind: 'ability', id: 'sk_drone', name: '指揮' }
const FEATURES = [combatFeature, summonsFeature]
const PACK = { id: 'wb_summons', content: { battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }, { id: 'rooted', name: '定住', desc: '定住。', no_move: true, until: 'own_turn_end', turns: 1, kind: 'debuff' }] } } as unknown as ContentPack
const quiet = { ap: { now: 0, max: 0, regen: 0 } }
const pilot = (o: Rec = {}) => one({
  weapon: 'pistol', skills: { piloting: 2, firearms: 2, sync: 4 }, ap: { now: 12, max: 12, regen: 3 },
  ext: { summons: { drones: [{ kind: 'attack', grade: 2 }, { kind: 'shield', grade: 1 }, { kind: 'scout', grade: 1 }, { kind: 'medic', grade: 1 }, { kind: 'jammer', grade: 1 }, { kind: 'ghost', grade: 1 }] } }, ...o,
} as never)
const idle = (o: Rec = {}) => foe('minion', { ...quiet, hp: { now: 200, max: 200 }, ...o } as never)
function world(o: { allies?: unknown[]; foes?: unknown[]; prep?: (k: Kernel) => void } = {}): Arena {
  return arena(duel(o.allies ?? [pilot(), one({}, 2)], o.foes ?? [idle(), idle()]), FEATURES, (k: Kernel) => {
    k.content.loadPack(PACK)
    o.prep?.(k)
    readyFeatures(k)
  })
}
const eff = (a: Arena, list: Rec[], target?: BattleTarget, o: { user?: BattleUnit; pick?: Rec; d?: number[]; attacker?: BattleUnit; victim?: BattleUnit } = {}) => {
  const run = a.run(o.d ?? dice(15))
  const last = run.effects(list, { user: o.user ?? a.ally(1), ...(target ? { target } : {}), source: SRC, ...(o.pick ? { pick: o.pick } : {}), ...(o.attacker ? { attacker: o.attacker } : {}), ...(o.victim ? { victim: o.victim } : {}) })
  return { run, last }
}
const err = (fn: () => void): string => {
  try { fn() } catch (e) { return e instanceof BattleBlocked ? e.reasons.join('') : (e as Error).message }
  return ''
}
const drone = (a: Arena, kind: string, slot: number, o: Partial<BattleOverlay> = {}, user: BattleUnit = a.ally(1)): BattleOverlay =>
  hang(a.run(dice()), user, slot, { kind: kind as never, grade: 1 }) && Object.assign(a.battle.overlays.at(-1)!, o)
const U = (id: string): BattleTarget => ({ unit: id })
const ghostTurret = (a: Arena, slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay =>
  a.run().addOverlay({ side: 'foe', slot, kind: 'turret', name: `砲塔${slot}`, hp: { now: 10, max: 10 }, armor: 0, evade: 0, weapon: testWeapon('pistol', 50), auto: true, ...o })

// =====================================================================================================================
// 格式檢查與落點（ops.ts）
// =====================================================================================================================

describe('白箱 drone.* 的格式檢查與落點（dev/work/M1b-skill-pilot.md 第一節）', () => {
  const problems = (list: Rec[]): string => world().k.battle.effectProblems(list).join('｜')

  it('格式：drone.act 一整組一定要寫 at；drone 與 kind 只能寫一個；grade 只給臨時機；各欄位的型別、不認得的欄位各一條', () => {
    expect(problems([{ op: 'drone.act', which: 'all' }])).toMatch(/一定要寫 at/)
    expect(problems([{ op: 'drone.act', which: 'all', at: 'attacker' }])).toBe('')
    expect(problems([{ op: 'drone.act', at: 'nobody' }])).toMatch(/「nobody」不在清單裡/)
    expect(problems([{ op: 'drone.act', at: 'pick:' }])).toMatch(/不在清單裡/)
    expect(problems([{ op: 'drone.act', which: 'x' }])).toMatch(/which：/)
    expect(problems([{ op: 'drone.act', mark_used: 'yes' }])).toMatch(/mark_used：要是 true 或 false/)
    expect(problems([{ op: 'drone.act', foo: 1 }])).toMatch(/不認得的欄位 foo/)
    expect(problems([{ op: 'drone.deploy' }])).toMatch(/要寫一個，只能寫一個/)
    expect(problems([{ op: 'drone.deploy', drone: 'a', kind: 'attack' }])).toMatch(/只能寫一個/)
    expect(problems([{ op: 'drone.deploy', drone: 'a', grade: 2 }])).toMatch(/grade 只有臨時機/)
    expect(problems([{ op: 'drone.deploy', kind: 'attack', grade: 5 }])).toMatch(/grade：要是 1～4/)
    expect(problems([{ op: 'drone.deploy', drone: '1x' }])).toMatch(/drone：要是 pick 的鍵/)
    expect(problems([{ op: 'drone.deploy', kind: 'attack', turns: 0 }])).toMatch(/turns：要是 1 以上的整數/)
    expect(problems([{ op: 'drone.deploy', kind: 'tank' }])).toMatch(/kind：「tank」不在清單裡/)
    expect(problems([{ op: 'drone.deploy', kind: 'attack', grade: 2, turns: 2, over_cap: true, no_backlash: true }])).toBe('')
    expect(problems([{ op: 'drone.move' }])).toMatch(/to：一定要寫/)
    expect(problems([{ op: 'drone.repair' }])).toMatch(/amount：一定要寫/)
    expect(problems([{ op: 'drone.smoke' }])).toMatch(/rounds：一定要寫/)
    expect(problems([{ op: 'drone.smoke', rounds: 1.5 }])).toMatch(/rounds：要是 1 以上的整數/)
    expect(problems([{ op: 'drone.ram', type: ' ' }])).toMatch(/type：要是字串/)
    expect(problems([{ op: 'drone.guard', which: 'others' }])).toMatch(/which：/)
    expect(problems([{ op: 'drone.guard', until: 'never' }])).toMatch(/until：/)
    expect(problems([{ op: 'drone.escort', evade: 'bogus' }])).toMatch(/evade：/)
    expect(problems([{ op: 'drone.escort', off: 1 }])).toMatch(/off：/)
  })

  it('落點：目標是敵方的人、站在第 0 格的我方、敵方的一格、沒有目標都找不到那一台（沒有這一台無人機）；目標是我方一格或一個人時是那一格上自己的一台', () => {
    const a = world()
    const d = drone(a, 'scout', 2)
    const run = (target?: BattleTarget) => err(() => eff(a, [{ op: 'drone.smoke', rounds: 1 }], target))
    expect(run({ unit: 'f1' })).toBe('沒有這一台無人機。')
    expect(run({ side: 'foe', slot: 2 })).toBe('沒有這一台無人機。')
    expect(run()).toBe('沒有這一台無人機。')
    expect(run({ unit: 'a1' })).toBe('沒有這一台無人機。')
    a.ally(2).slot = 0
    expect(run({ unit: 'a2' })).toBe('沒有這一台無人機。')
    a.ally(2).slot = 2
    expect(run({ unit: 'a2' })).toBe('')
    expect(run({ side: 'ally', slot: 2 })).toBe('')
    expect(run({ overlay: d.id })).toBe('')
    expect(run({ overlay: 'ghost' })).toBe('沒有這一台無人機。')
    // 別人的、已被擊落的
    const other = a.run().addOverlay({ side: 'ally', slot: 3, kind: 'scout', name: '別人的', hp: { now: 5, max: 5 }, armor: 0, evade: 0, owner: 'a2' })
    expect(run({ overlay: other.id })).toBe('沒有這一台無人機。')
    // 已經被擊落的：核心不對擊落的做（整筆跳過，不丟錯也沒有作用）
    d.down = true
    expect(run({ overlay: d.id })).toBe('')
    expect(err(() => eff(a, [{ op: 'drone.guard', who: 'pick:x' }], undefined, { pick: { x: d.id } }))).toBe('')
    expect(d.ext!.guard).toBeUndefined()
  })

  it('drone.smoke：rounds 不是數字用 2；變成那一格打不破的半掩體（COMBAT_SYSTEM 2.5）；drone.repair：不超過耐久上限，公式可寫，負的當 0', () => {
    const a = world()
    const d = drone(a, 'medic', 2)
    d.hp.now = 3
    eff(a, [{ op: 'drone.smoke', rounds: 'x' }], { overlay: d.id })
    expect(a.battle.cover.ally[1]!.soft).toMatchObject({ kind: 'smoke' })
    const r = eff(a, [{ op: 'drone.repair', amount: 99 }], { overlay: d.id })
    expect(d.hp.now).toBe(d.hp.max)
    expect(r.run.beats.at(-1)!.text).toContain(`回復了 ${d.hp.max - 3} 點耐久`)
    d.hp.now = 3
    eff(a, [{ op: 'drone.repair', amount: -5 }], { overlay: d.id })
    expect(d.hp.now).toBe(3)
    eff(a, [{ op: 'drone.repair', amount: '1+1' }], { overlay: d.id })
    expect(d.hp.now).toBe(5)
  })

  it('drone.move：沒選（pick 沒有那個鍵）就不動；選了照 moveTo 檢查；固定的（砲塔）不能移動；any 要是沒掛別台的格', () => {
    const a = world()
    const d = drone(a, 'scout', 2)
    const mv = (pick: Rec, e: Rec = {}) => err(() => eff(a, [{ op: 'drone.move', to: 'to', ...e }], { overlay: d.id }, { pick }))
    expect(mv({})).toBe('')
    expect(d.slot).toBe(2)
    expect(mv({ to: 3 })).toBe('')
    expect(d.slot).toBe(3)
    expect(mv({ to: 1 })).toBe('只能換到相鄰、沒有掛著別台的格。')
    expect(mv({ to: 'x' })).toBe('只能換到相鄰、沒有掛著別台的格。')
    expect(mv({ to: 9 }, { any: true })).toBe('要選一個沒有掛著別台的格。')
    expect(mv({ to: 3 }, { any: true })).toBe('要選一個沒有掛著別台的格。')
    expect(mv({ to: 1 }, { any: true })).toBe('')
    d.ext = { ...d.ext, fixed: true }
    expect(isFixed(d)).toBe(true)
    expect(moveSlots(a.run(), d)).toEqual([])
    expect(mv({ to: 2 })).toMatch(/固定在這一格/)
  })

  it('drone.ram：沒有目標、目標是我方的人、已退出的人、不在敵方第 1 格都擋下（各一句）；撞過去自己被擊落、目標受傷往後推；type 與 dice 有預設', () => {
    const a = world({ foes: [idle(), idle()] })
    const d = drone(a, 'attack', 1)
    const ram = (target?: BattleTarget, e: Rec = {}) => err(() => eff(a, [{ op: 'drone.ram', ...e }], target, { d: dice(3, 3, 3) }))
    expect(ram({ overlay: d.id })).toBe('要選一個敵人。')
    expect(ram(U('a2'))).toBe('沒有這一台無人機。')
    // 目標落在敵人身上，但這一台是用 who: 'self' 選的：用 pick:at 指到我方的人 → ctx.unit 是我方
    const run = a.run(dice(3, 3, 3))
    expect(err(() => run.effects([{ op: 'drone.ram', who: 'pick:at' }], { user: a.ally(1), target: { overlay: d.id }, source: SRC, pick: { at: 'a2' } }))).toBe('要選一個敵人。')
    a.battle.units.f1!.out = 'down'
    expect(err(() => run.effects([{ op: 'drone.ram', who: 'pick:at' }], { user: a.ally(1), target: { overlay: d.id }, source: SRC, pick: { at: 'f1' } }))).toBe('要選一個敵人。')
    delete a.battle.units.f1!.out
    a.battle.units.f2!.slot = 2
    expect(err(() => run.effects([{ op: 'drone.ram', who: 'pick:at' }], { user: a.ally(1), target: { overlay: d.id }, source: SRC, pick: { at: 'f2' } }))).toBe('只能撞敵方第 1 格的人。')
    const hp = a.foe(1).hp!.now
    const ok = a.run(dice(4, 4, 4, 1, 1))
    ok.effects([{ op: 'drone.ram', who: 'pick:at', type: 'em', dice: '2d6' }], { user: a.ally(1), target: { overlay: d.id }, source: SRC, pick: { at: 'f1' } })
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
    expect(d.down).toBe(true)
    expect(a.foe(1).slot).toBe(2)
  })

  it('drone.guard：which 是 same_slot 或 all 時各取那一組並照 max 截斷；until battle_end 守到整場；預設到操作者的下一個回合開始；沒有這一台就丟錯', () => {
    const a = world()
    const d1 = drone(a, 'shield', 1)
    const d2 = drone(a, 'shield', 2)
    a.ally(1).slot = 1
    eff(a, [{ op: 'drone.guard', which: 'same_slot' }])
    expect(d1.ext!.guard).toBe('own_turn_start')
    expect(d2.ext!.guard).toBeUndefined()
    eff(a, [{ op: 'drone.guard', which: 'all', max: 1, until: 'battle_end' }])
    expect(d1.ext!.guard).toBe('battle_end')
    expect(d2.ext!.guard).toBeUndefined()
    eff(a, [{ op: 'drone.guard', which: 'all', max: 'x' }])
    expect(d2.ext!.guard).toBe('own_turn_start')
    eff(a, [{ op: 'drone.guard', which: 'all', max: -1 }])
    expect(() => eff(a, [{ op: 'drone.guard' }])).toThrow('沒有這一台無人機。')
  })

  it('drone.escort：開著記下迴避與最多幾格（沒寫 evade 是 1、max 至少 1、預設 2）；{ off: true } 收起；收起時不記話', () => {
    const a = world()
    const me = a.ally(1)
    const on = eff(a, [{ op: 'drone.escort' }])
    expect(me.uses['escort.evade']).toBe(1)
    expect(me.uses['escort.max']).toBe(2)
    expect(on.run.beats.at(-1)!.text).toContain('護航編隊')
    eff(a, [{ op: 'drone.escort', evade: 2, max: 0 }])
    expect(me.uses['escort.max']).toBe(1)
    expect(me.uses['escort.evade']).toBe(2)
    const off = eff(a, [{ op: 'drone.escort', off: true }])
    expect(me.uses['escort.evade']).toBeUndefined()
    expect(off.run.beats).toEqual([])
  })
})

describe('白箱 drone.act 與 drone.deploy 的退路', () => {
  it('drone.act：這一台動過了丟「這一台這一回合動過了」，ignore_used 例外；mark_used 為 false 不記動過；整組沒有目標敵人就不做', () => {
    const a = world()
    const d = drone(a, 'attack', 1)
    d.used = true
    expect(err(() => eff(a, [{ op: 'drone.act', at: 'pick:at' }], { overlay: d.id }, { pick: { at: 'f1' } }))).toBe('這一台這一回合動過了。')
    eff(a, [{ op: 'drone.act', at: 'pick:at', ignore_used: true, mark_used: false }], { overlay: d.id }, { pick: { at: 'f1' } })
    expect(d.used).toBe(true)
    d.used = false
    eff(a, [{ op: 'drone.act', at: 'pick:at', mark_used: false }], { overlay: d.id }, { pick: { at: 'f1' } })
    expect(d.used).toBe(false)
    const none = eff(a, [{ op: 'drone.act', which: 'all', at: 'pick:at' }], undefined, { pick: { at: 'a2' } })
    expect(none.run.beats).toEqual([])
    // at 寫 attacker 但沒有 attacker、at 指到退出的敵人：都當沒有目標
    a.battle.units.f2!.out = 'down'
    expect(eff(a, [{ op: 'drone.act', which: 'all', at: 'attacker' }]).run.beats).toEqual([])
    expect(eff(a, [{ op: 'drone.act', which: 'all', at: 'pick:at' }], undefined, { pick: { at: { unit: 'f2' } } }).run.beats).toEqual([])
    expect(eff(a, [{ op: 'drone.act', which: 'all', at: 'pick:at' }], undefined, { pick: { at: { unit: 5 } } }).run.beats).toEqual([])
  })

  it('drone.act 一整組：others 排除被打的那一台（反應裡是被打的替身對應的）；same_slot 只動同一格的；max 照公式截斷；沒開火能力與停機的不動；打到戰鬥結束就停', () => {
    const a = world()
    const d1 = drone(a, 'attack', 1)
    const d2 = drone(a, 'jammer', 2)
    const d3 = drone(a, 'attack', 3)
    a.ally(1).slot = 1
    const others = eff(a, [{ op: 'drone.act', which: 'others', at: 'pick:at', max: 'x' }], { overlay: d1.id }, { pick: { at: 'f1' } })
    expect(others.run.beats.filter((b) => b.tag === 'hit' || b.tag === 'miss' || b.tag === 'crit')).toHaveLength(2)
    expect(d1.used).toBe(false)
    expect(d2.used && d3.used).toBe(true)
    // 反應裡：victim 是替身，排除那一台
    d2.used = false
    d3.used = false
    const standIn = a.run().standIn(d3)
    const react = eff(a, [{ op: 'drone.act', which: 'others', at: 'attacker' }], undefined, { attacker: a.foe(1), victim: standIn })
    expect(d3.used).toBe(false)
    expect(d1.used && d2.used).toBe(true)
    expect(react.run.beats.some((b) => b.tag === 'hit' || b.tag === 'miss' || b.tag === 'crit')).toBe(true)
    // 同一格：操作者站第 1 格 → 只有 d1；max 0 一台也不動
    for (const d of [d1, d2, d3]) d.used = false
    eff(a, [{ op: 'drone.act', which: 'same_slot', at: 'pick:at' }], undefined, { pick: { at: 'f1' } })
    expect([d1.used, d2.used, d3.used]).toEqual([true, false, false])
    for (const d of [d1, d2, d3]) d.used = false
    eff(a, [{ op: 'drone.act', which: 'all', at: 'pick:at', max: 0 }], undefined, { pick: { at: 'f1' } })
    expect(d1.used).toBe(false)
    // 停機的、沒有開火能力（護盾）的不動
    const shield = drone(a, 'shield', 4)
    d2.ext = { ...d2.ext, stun: 2 }
    eff(a, [{ op: 'drone.act', which: 'all', at: 'pick:at' }], undefined, { pick: { at: 'f1' } })
    expect(d2.used).toBe(false)
    expect(shield.used).toBe(false)
    expect(isStunned(d2)).toBe(true)
    // 做的人自己倒下：一台都不再動
    const b = world()
    const e1 = drone(b, 'attack', 1)
    b.ally(1).out = 'down'
    eff(b, [{ op: 'drone.act', which: 'all', at: 'pick:at' }], undefined, { pick: { at: 'f1' } })
    expect(e1.used).toBe(false)
  })

  it('drone.deploy（單位上的）：沒有這一台、已經放出去的、種類不認得的、pick 不是整數也不是種類都丟「沒有這一台無人機」；沒選我方的一格丟「要選我方的一格」', () => {
    const a = world()
    const dep = (pick: Rec, target?: BattleTarget, e: Rec = {}) => err(() => eff(a, [{ op: 'drone.deploy', drone: 'd', ...e }], target, { pick }))
    const slot2: BattleTarget = { side: 'ally', slot: 2 }
    expect(dep({ d: 99 }, slot2)).toBe('沒有這一台無人機。')
    expect(dep({}, slot2)).toBe('沒有這一台無人機。')
    expect(dep({ d: 1.5 }, slot2)).toBe('沒有這一台無人機。')
    expect(dep({ d: 5 }, slot2)).toBe('沒有這一台無人機。')
    expect(dep({ d: 'healer' }, slot2)).toBe('沒有這一台無人機。')
    expect(dep({ d: 0 }, { side: 'foe', slot: 2 })).toBe('要選我方的一格。')
    expect(dep({ d: 0 }, { unit: 'a1' })).toBe('要選我方的一格。')
    expect(dep({ d: 0 })).toBe('要選我方的一格。')
    expect(dep({ d: 0 }, { side: 'ally', slot: 9 })).toBe('要選我方的一格。')
    expect(dep({ d: 0 }, { side: 'ally', slot: 1.5 })).toBe('要選我方的一格。')
    expect(dep({ d: 'attack' }, slot2)).toBe('')
    expect(stateOf(a.ally(1), 0)).toBe(1)
    expect(dep({ d: 'attack' }, { side: 'ally', slot: 3 })).toBe('沒有這一台無人機。')
  })

  it('drone.deploy：同步的上限（over_cap 例外）；上限寫出同步級數；時限 turns 記成到第幾輪；沒有空格（臨時機）記一句不丟錯；沒指定格時挑有人站、離自己近的空格', () => {
    const a = world({ allies: [pilot({ skills: { piloting: 2, sync: 0 } }), one({}, 2)] })
    expect(err(() => eff(a, [{ op: 'drone.deploy', kind: 'attack' }], { side: 'ally', slot: 1 }))).toBe('')
    expect(err(() => eff(a, [{ op: 'drone.deploy', kind: 'shield' }], { side: 'ally', slot: 2 }))).toMatch(/同步 0 級只連得住 1 台/)
    expect(err(() => eff(a, [{ op: 'drone.deploy', kind: 'shield', over_cap: true, turns: 2 }], { side: 'ally', slot: 2 }))).toBe('')
    const t = a.battle.overlays.at(-1)!
    expect(t.ext!.until).toBe(a.battle.round + 1)
    expect(t.ext!.overCap).toBe(true)
    // 沒指定格：我方站著 a1(1)、a2(2)；a1 有掛、a2 有掛；挑有人站的空格，最近的先
    const b = world({ allies: [pilot({ skills: { piloting: 2, sync: 6 } }), one({}, 2), one({}, 3)] })
    eff(b, [{ op: 'drone.deploy', kind: 'scout', grade: '1+1' }])
    expect(b.battle.overlays.at(-1)).toMatchObject({ slot: 1, kind: 'scout' })
    expect(b.battle.overlays.at(-1)!.ext!.grade).toBe(2)
    eff(b, [{ op: 'drone.deploy', kind: 'scout' }])
    expect(b.battle.overlays.at(-1)!.slot).toBe(2)
    // 四格都掛滿：記一句
    for (const s of [1, 2, 3, 4]) if (!b.battle.overlays.some((o) => o.side === 'ally' && o.slot === s)) drone(b, 'scout', s, {}, b.ally(1))
    const full = eff(b, [{ op: 'drone.deploy', kind: 'scout', over_cap: true }])
    expect(full.run.beats.at(-1)!.text).toContain('沒有空的格子可以放偵察無人機')
  })
})

// =====================================================================================================================
// drones.ts：共用的部分
// =====================================================================================================================

describe('白箱 drones.ts 的共用部分（COMBAT_SYSTEM 9.1）', () => {
  it('gradeOf／syncOf／capOf／capTags／widestCap：等級夾 1～4（NaN、字串當 1）、同步夾 0～6；上限查表加 overlay_cap 修正且最少 0；支援型多帶 support', () => {
    expect([0, 1, 4, 9, Number.NaN].map((g) => gradeOf({ kind: 'attack', grade: g as never }))).toEqual([1, 1, 4, 4, 1])
    expect(gradeOf({ kind: 'attack', grade: '3' as never })).toBe(3)
    const a = world()
    const u = (sync: number) => ({ ...a.ally(1), skills: { sync } }) as BattleUnit
    expect([-3, 0, 2, 6, 99].map((s) => syncOf(u(s)))).toEqual([0, 0, 2, 6, 6])
    expect(DRONE_CAP_BY_SYNC).toEqual([1, 1, 2, 2, 3, 3, 4])
    expect(capOf(a.run(), u(4))).toBe(3)
    a.k.battle.modifier('neg', (q) => (q.kind === 'overlay_cap' ? [{ label: 'x', value: -99 }] : []))
    expect(capOf(a.run(), u(4))).toBe(0)
    expect(capTags('shield')).toEqual(['shield', 'support'])
    expect(capTags('attack')).toEqual(['attack'])
    expect(widestCap(a.run(), u(4))).toBe(0)
  })

  it('capBlock：支援型還放得下而這一台不是支援型時，句子說多出來的那一台只能是護盾、偵察或醫療；否則只寫連得住幾台', () => {
    const a = world({ allies: [pilot({ skills: { piloting: 2, sync: 0 } }), one({}, 2)] })
    a.k.battle.modifier('support', (q) => (q.kind === 'overlay_cap' && q.tags.includes('support') ? [{ label: '多工', value: 1 }] : []))
    drone(a, 'attack', 1)
    expect(capBlock(a.run(), a.ally(1), 'attack')).toBe('同步 0 級連得住 1 台，已經放滿了；多出來的那一台只能是護盾型、偵察型或醫療型。')
    expect(capBlock(a.run(), a.ally(1), 'scout')).toBeNull()
    drone(a, 'scout', 2)
    expect(capBlock(a.run(), a.ally(1), 'scout')).toBe('同步 0 級只連得住 2 台。')
    expect(capBlock(a.run(), a.ally(1), 'attack')).toBe('同步 0 級只連得住 1 台。')
  })

  it('hang：單位上沒有那一台、種類不認得、臨時機沒給種類都丟「沒有這一台無人機」；單位上的記進 uses；臨時機不記；耐久與護甲照等級（夾 1～4）', () => {
    const a = world()
    const run = a.run(dice())
    expect(err(() => hang(run, a.ally(1), 1, { idx: 99 }))).toBe('沒有這一台無人機。')
    expect(err(() => hang(run, a.ally(1), 1, { idx: 5 }))).toBe('沒有這一台無人機。')
    expect(err(() => hang(run, a.ally(1), 1, {}))).toBe('沒有這一台無人機。')
    expect(err(() => hang(run, a.ally(1), 1, { kind: 'tank' as never }))).toBe('沒有這一台無人機。')
    const o = hang(run, a.ally(1), 1, { idx: 0 })
    expect(a.ally(1).uses['drone:0']).toBe(1)
    expect(o.hp.max).toBe(17)
    const t = hang(run, a.ally(1), 2, { kind: 'scout', grade: 9, name: '小偵', item: 'it_x' })
    expect(t.hp.max).toBe(25)
    expect(t.name).toBe('小偵')
    expect(t.item).toBe('it_x')
    expect(Object.keys(a.ally(1).uses).filter((k) => k.startsWith('drone:'))).toEqual(['drone:0'])
    const low = hang(run, a.ally(1), 3, { kind: 'scout', grade: -5 })
    expect(low.hp.max).toBe(14)
    expect(err(() => hang(run, a.ally(1), 1, { kind: 'scout' }))).toMatch(/已經掛著|掛/)
  })

  it('droneWeapon：攻擊型物理、干擾型電磁；骰數 2 加等級的骰；命中用操作者的反應與操縱（沒學過是 0）；沒有等級當 1', () => {
    const a = world()
    const o = drone(a, 'attack', 1)
    const w = droneWeapon(a.ally(1), o, 'em')
    expect(w).toMatchObject({ type: 'em', class: 'drone', skill: 'piloting', attr: 'reflex' })
    const bare = { ...a.ally(1), skills: {} } as BattleUnit
    expect(droneWeapon(bare, { ...o, ext: undefined } as BattleOverlay, 'physical').hit).toBe(droneWeapon(bare, o, 'physical').hit)
    expect(isShooter({ ...o, kind: 'scout' } as BattleOverlay)).toBe(false)
    expect(isShooter({ ...o, kind: 'scout', weapon: testWeapon('pistol', 1) } as BattleOverlay)).toBe(true)
  })

  it('moveTo：固定的不能動；不是整數、超出 1～4、不相鄰、目標格掛著別台都擋下；any 要是不同的、沒掛別台的格', () => {
    const a = world()
    const d = drone(a, 'scout', 2)
    drone(a, 'scout', 4)
    const mv = (to: unknown, any = false) => err(() => moveTo(a.run(), a.ally(1), d, to, any))
    expect(mv(2.5)).toBe('只能換到相鄰、沒有掛著別台的格。')
    expect(mv(0)).toBe('只能換到相鄰、沒有掛著別台的格。')
    expect(mv(5, true)).toBe('要選一個沒有掛著別台的格。')
    expect(mv(2, true)).toBe('要選一個沒有掛著別台的格。')
    expect(mv(4, true)).toBe('要選一個沒有掛著別台的格。')
    expect(mv(3)).toBe('')
    expect(d.slot).toBe(3)
    expect(mv(1, true)).toBe('')
    expect(stateOf(a.ally(1), 7)).toBe(0)
  })
})

// =====================================================================================================================
// hooks.ts 與 auto.ts：被動、停機、到期、被擊落、自己動
// =====================================================================================================================

describe('白箱 hooks／auto：沒有操作者的每輪自己動、停機、到期、被擊落（ENEMIES 第 10 節；COMBAT_SYSTEM 9.1、2.5）', () => {
  const roundStart = (a: Arena, round = 2, d = dice(15, 3, 3, 3, 3)) => {
    const run = a.run(d)
    run.k.battle.emit('round.start', { run, round })
    return run
  }

  it('護航編隊：操作者退出或迴避值是 0 時沒有加成；有加成只給無人機掛著的前 max 格上的隊友；護盾型給同一格的人 +2；偵察型給同一格的人看得見黑暗', () => {
    const a = world({ allies: [pilot(), one({}, 2), one({}, 3)] })
    drone(a, 'shield', 2)
    drone(a, 'scout', 3)
    const run = a.run(dice())
    const evade = (id: string) => run.mods('evade', a.battle.units[id]!).map((p) => `${p.label}${p.value}`)
    expect(evade('a2')).toEqual(['護盾無人機2'])
    a.ally(1).uses['escort.evade'] = 1
    a.ally(1).uses['escort.max'] = 1
    expect(evade('a2')).toEqual(['護盾無人機2', '護航編隊1'])
    expect(evade('a3')).toEqual([])
    a.ally(1).uses['escort.max'] = 2
    expect(evade('a3')).toEqual(['護航編隊1'])
    a.ally(1).uses['escort.evade'] = 0
    expect(evade('a3')).toEqual([])
    a.ally(1).uses['escort.evade'] = 1
    a.ally(1).out = 'down'
    expect(evade('a3')).toEqual([])
    expect(run.mods('see_dark', a.ally(3)).map((p) => p.label)).toEqual(['偵察無人機'])
    expect(run.mods('see_dark', a.ally(2))).toEqual([])
    a.ally(3).slot = 0
    expect(run.mods('see_dark', a.ally(3))).toEqual([])
  })

  it('守著：打人的攻擊才改打守著的那一台；自己人打、已經設了 redirect、目標是替身的不搶；擋下後守著用掉；被取消的不用掉', () => {
    const a = world()
    const g = drone(a, 'shield', 1)
    g.ext = { ...g.ext, guard: 'battle_end' }
    const run = a.run(dice(15, 3, 3, 3))
    a.ally(2).slot = 1
    a.ally(1).slot = 2
    const hp = a.ally(2).hp!.now
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r.redirected).toBe(true)
    expect(a.ally(2).hp!.now).toBe(hp)
    expect(g.ext!.guard).toBeUndefined()
    expect(run.beats.some((b) => b.text.includes('擋下了這一擊'))).toBe(true)
    g.ext = { ...g.ext, guard: 'battle_end' }
    // 隊友打隊友：不改向
    const friendly = a.run(dice(15, 3, 3, 3)).attack(a.ally(1), a.ally(2))
    expect(friendly.redirected).toBeUndefined()
    // 已經指定 redirect 的不搶（別的反應先設）
    const other = a.run().addOverlay({ side: 'ally', slot: 3, kind: 'decoy', name: '別的', hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    a.k.battle.on('attack.before', 'first', ({ opts }) => { opts.redirect = { overlay: other.id } }, -200)
    const r2 = a.run(dice(15, 3, 3, 3)).attack(a.foe(1), a.ally(2))
    expect(r2.redirected).toBe(true)
    expect(g.ext!.guard).toBe('battle_end')
  })

  it('守著到操作者的下一個回合開始結束；被電磁打到的 stun 1 到操作者回合開始變 2、回合結束拿掉；別人的不動（hooks.ts turn.start、turn.end）', () => {
    const a = world()
    const d = drone(a, 'shield', 1)
    d.ext = { ...d.ext, guard: 'own_turn_start', stun: 1 }
    const keep = drone(a, 'scout', 2)
    keep.ext = { ...keep.ext, guard: 'battle_end' }
    const run = a.run(dice())
    run.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(d.ext!.guard).toBe('own_turn_start')
    run.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(d.ext!.guard).toBeUndefined()
    expect(d.ext!.stun).toBe(2)
    expect(keep.ext!.guard).toBe('battle_end')
    run.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(d.ext!.stun).toBeUndefined()
  })

  it('電磁傷害：打在掛著的東西上的停一回合（已經停著的不重複記）；打在機器單位上的失去下一個回合；不是電磁、沒命中、不是機器的不受影響；替身當攻擊者時不記 by', () => {
    const a = world({ foes: [idle({ tags: ['machine'] }), idle()] })
    const o = drone(a, 'scout', 1)
    const em = { ...testWeapon('pistol', 99), type: 'em' as const }
    const hitOverlay = () => a.run(dice(20, 3, 3, 3)).attackOverlay(a.foe(1), o, { weapon: em, spend: 0 })
    hitOverlay()
    expect(o.ext!.stun).toBe(1)
    const beats = a.run().beats.length
    hitOverlay()
    expect(o.ext!.stun).toBe(1)
    expect(beats).toBe(0)
    // 機器單位
    const m = a.run(dice(20, 3, 3, 3))
    m.attack(a.ally(2), a.foe(1), { weapon: em, spend: 0 })
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('lose_turn')
    // 不是機器
    a.run(dice(20, 3, 3, 3)).attack(a.ally(2), a.foe(2), { weapon: em, spend: 0 })
    expect(a.foe(2).statuses.map((s) => s.id)).not.toContain('lose_turn')
    // 沒命中
    const b = world({ foes: [idle({ tags: ['machine'] })] })
    b.run(dice(1, 3, 3)).attack(b.ally(2), b.foe(1), { weapon: em, spend: 0 })
    expect(b.foe(1).statuses).toEqual([])
    // 替身（敵方的砲塔）打機器：不帶 by
    const c = world({ allies: [pilot({ tags: ['machine'] }), one({}, 2)] })
    const t = ghostTurret(c, 1, { weapon: { ...testWeapon('pistol', 99), type: 'em' } })
    c.run(dice(20, 3, 3, 3)).overlayAttack(t, c.ally(1), { spend: 0 })
    expect(c.ally(1).statuses.map((s) => s.id)).toContain('lose_turn')
    expect(c.ally(1).statuses.find((s) => s.id === 'lose_turn')!.by).toBeUndefined()
  })

  it('臨時機到期自己收回（不灌感載）；單位上的那一台回到手上；沒有操作者的臨時機也收；還沒到期的不動（round.start）', () => {
    const a = world()
    const run0 = a.run(dice())
    const mine = hang(run0, a.ally(1), 1, { idx: 0, limits: { until: 2 } })
    const spare = hang(run0, a.ally(1), 2, { kind: 'scout', grade: 1, limits: { until: 2 } })
    const orphan = a.run().addOverlay({ side: 'ally', slot: 3, kind: 'scout', name: '孤兒', hp: { now: 5, max: 5 }, armor: 0, evade: 0, ext: { until: 1, drone: 0 } })
    const keep = hang(run0, a.ally(1), 4, { kind: 'scout', grade: 1, limits: { until: 9 } })
    const load = a.ally(1).load!.now
    const run = roundStart(a, 3)
    const ids = a.battle.overlays.map((o) => o.id)
    expect(ids).toEqual([keep.id])
    expect(a.ally(1).uses['drone:0']).toBeUndefined()
    expect(a.ally(1).load!.now).toBe(load)
    expect(run.beats.filter((b) => b.text.includes('時限到了，自己收回'))).toHaveLength(3)
    expect(mine.id).toBeDefined()
    expect(spare.id).toBeDefined()
    expect(orphan.id).toBeDefined()
    // 還沒到期
    const b = world()
    const t = hang(b.run(), b.ally(1), 1, { kind: 'scout', grade: 1, limits: { until: 3 } })
    roundStart(b, 3)
    expect(b.battle.overlays.map((o) => o.id)).toEqual([t.id])
  })

  it('沒有操作者的：每輪清 used；auto 的各自己動一次；有操作者的、被接管的、停機的（停機標記拿掉並記一拍）不動；戰鬥結束就停', () => {
    const a = world({ foes: [idle({ hp: { now: 999, max: 999 } }), idle()] })
    const t1 = ghostTurret(a, 1)
    const t2 = ghostTurret(a, 2, { ext: { hack: { taken: { by: 'a1' } } } })
    const t3 = ghostTurret(a, 3, { ext: { stun: 1 } })
    const t4 = ghostTurret(a, 4, { owner: 'f1' })
    t2.used = true
    t4.used = true
    const run = roundStart(a)
    expect(t1.used).toBe(true)
    expect(t2.used).toBe(true)
    expect(t3.ext!.stun).toBeUndefined()
    expect(run.beats.some((b) => b.text.includes('這一輪停機'))).toBe(true)
    expect(t4.used).toBe(false)
    // 打倒最後一個人：後面的不再動
    const b = world({ allies: [one({ hp: { now: 1, max: 1 } })], foes: [idle()] })
    const x = ghostTurret(b, 1, { weapon: testWeapon('pistol', 99, 5) })
    const y = ghostTurret(b, 2, { weapon: testWeapon('pistol', 99, 5) })
    const rb = b.run(dice(20, 6, 6, 6, 6, 6, 6, 6, 6, 20, 6, 6, 6, 6, 6, 6, 6, 6))
    rb.k.battle.emit('round.start', { run: rb, round: 2 })
    expect(b.battle.result?.outcome).toBe('lose')
    expect(x.used).toBe(true)
    expect(y.used).toBe(false)
  })

  it('auto：攻擊與干擾型沒有武器時照記著的操作者算（操作者不在了就沒有武器、什麼也不做）；偵察型標記敵人；醫療型只救受傷的同一格；護盾型守著（已有就不重做）；不認得的種類什麼也不做', () => {
    const a = world({ foes: [idle(), idle()] })
    const atk = drone(a, 'attack', 1, { auto: true, ext: { drone: 0, grade: 1, operator: 'a1', orphan: true } })
    delete atk.owner
    const jam = drone(a, 'jammer', 2, { auto: true, ext: { drone: 4, grade: 1, operator: 'ghost' } })
    delete jam.owner
    const run = roundStart(a, 2, dice(15, 3, 3, 3, 3, 3, 3, 3))
    expect(atk.used).toBe(true)
    expect(jam.used).toBe(false)
    expect(run.beats.some((b) => b.tag === 'hit' || b.tag === 'miss' || b.tag === 'crit')).toBe(true)
    const b = world()
    const scout = drone(b, 'scout', 1)
    delete scout.owner
    scout.auto = true
    scout.side = 'foe'
    const med = drone(b, 'medic', 2)
    delete med.owner
    med.auto = true
    med.side = 'foe'
    const mate = b.foe(2)
    mate.hp!.now = 1
    const shield = drone(b, 'shield', 3)
    delete shield.owner
    shield.auto = true
    shield.side = 'foe'
    const odd = drone(b, 'scout', 4)
    delete odd.owner
    odd.auto = true
    odd.side = 'foe'
    odd.kind = 'mystery' as never
    const rb = roundStart(b, 2, dice(15, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3))
    expect(scout.used).toBe(true)
    expect(med.used).toBe(false)
    expect(shield.ext!.guard).toBe('battle_end')
    expect(odd.used).toBe(false)
    expect(rb.beats.some((x) => x.text.includes('標記了'))).toBe(true)
    // 醫療型：同一格的人受傷才救
    med.slot = 2
    mate.slot = 2
    mate.hp!.now = 1
    roundStart(b, 3, dice(3, 3, 3, 3, 3, 3, 3, 3, 3, 3))
    expect(mate.hp!.now).toBeGreaterThan(1)
    expect(med.used).toBe(true)
    const full = world()
    const m2 = drone(full, 'medic', 1)
    delete m2.owner
    m2.auto = true
    m2.side = 'foe'
    full.foe(1).hp!.now = full.foe(1).hp!.max
    roundStart(full, 2, dice())
    expect(m2.used).toBe(false)
    // 護盾型已經守著：不重做
    shield.ext = { ...shield.ext, guard: 'own_turn_start' }
    roundStart(b, 4, dice(3, 3, 3, 3, 3, 3))
    expect(shield.ext!.guard).toBe('own_turn_start')
  })

  it('被擊落：操作者的 uses 記成 2（這一場不能再放）、感載 +5（overlay_backlash 修正加減、最少 0）；臨時機（idx −1）與 noBacklash 不灌；沒有操作者的、操作者不在的、操作者退出的不灌', () => {
    const a = world()
    const run = a.run(dice())
    const d = hang(run, a.ally(1), 1, { idx: 0 })
    const load = a.ally(1).load!.now
    run.dropOverlay(d)
    expect(a.ally(1).uses['drone:0']).toBe(2)
    expect(a.ally(1).load!.now).toBe(load + 5)
    // 修正 −9：最少 0，不灌
    a.k.battle.modifier('soft', (q) => (q.kind === 'overlay_backlash' ? [{ label: '緩衝', value: -9 }] : []))
    const d2 = hang(run, a.ally(1), 2, { idx: 1 })
    run.dropOverlay(d2)
    expect(a.ally(1).load!.now).toBe(load + 5)
    // 臨時機、noBacklash
    const b = world()
    const rb = b.run(dice())
    const t = hang(rb, b.ally(1), 1, { kind: 'scout', grade: 1, limits: { noBacklash: true } })
    rb.dropOverlay(t)
    expect(Object.keys(b.ally(1).uses).filter((k) => k.startsWith('drone:'))).toEqual([])
    const nb = hang(rb, b.ally(1), 2, { idx: 0, limits: { noBacklash: true } })
    rb.dropOverlay(nb)
    expect(b.ally(1).load!.now).toBe(0)
    expect(b.ally(1).uses['drone:0']).toBe(2)
    // 臨時機沒寫 no_backlash 照灌（SKILL_TREES 蜂群「被擊落時你的感載不增加」由資料的 no_backlash 決定）
    const plain = hang(rb, b.ally(1), 3, { kind: 'scout', grade: 1 })
    rb.dropOverlay(plain)
    expect(b.ally(1).load!.now).toBe(5)
    b.ally(1).load!.now = 0
    // 沒有操作者（敵方的）、操作者不在 battle.units、操作者已退出
    const c = world()
    const rc = c.run(dice())
    const orphan = hang(rc, c.ally(1), 1, { idx: 0 })
    delete orphan.owner
    rc.dropOverlay(orphan)
    const lost = hang(rc, c.ally(1), 2, { idx: 1 })
    lost.owner = 'nobody'
    rc.dropOverlay(lost)
    const gone = hang(rc, c.ally(1), 3, { idx: 2 })
    c.ally(1).out = 'down'
    rc.dropOverlay(gone)
    expect(c.ally(1).load!.now).toBe(0)
    // 不是無人機（砲塔）被擊落沒有後果
    const d3 = ghostTurret(c, 4)
    expect(() => rc.dropOverlay(d3)).not.toThrow()
  })

  it('自律的一台自己開火命中 −2（ext.orphan）；沒有 orphan 標記的、不是替身的攻擊者不扣', () => {
    const a = world()
    const o = drone(a, 'attack', 1, { ext: { drone: 0, grade: 1, operator: 'a1', orphan: true }, weapon: testWeapon('pistol', 10) })
    const plain = drone(a, 'attack', 2, { weapon: testWeapon('pistol', 10) })
    const run = a.run(dice())
    const hit = (ov: BattleOverlay) => run.mods('hit', run.standIn(ov), a.foe(1), ov.weapon).map((p) => `${p.label}${p.value}`)
    expect(hit(o)).toContain('自律-2')
    expect(hit(plain)).not.toContain('自律-2')
    expect(run.mods('hit', a.ally(1), a.foe(1)).map((p) => p.label)).not.toContain('自律')
  })
})
