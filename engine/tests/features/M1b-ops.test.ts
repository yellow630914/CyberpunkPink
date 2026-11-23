// 驗收測試：dev/work/M1b-ops.md（cpp-feature）。features/combat 註冊的通用效果（op）。
// 規格：SKILLS 1.8 節「現實與內海共用」「只在現實」兩列（效果只能是這張清單上的事）；COMBAT_SYSTEM 第 4 節（傷害類型）、第 6 節（重創的輕與重）；
// dev/adr/0015 第一節與 E5、E7、E8。每個 op 至少一個測試，直接呼叫 run.effects；內容一律是測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleEffectLast, BattleEffectSource, BattleOverlay, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, attrMod, createKernel, readyFeatures, unitsOf } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { BATTLE_SETUPS, enemyUnit, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(80).fill(1)]
const ITEM = (id: string, more: Record<string, unknown> = {}) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'ops_test',
  content: {
    battle_status: [
      ...TEST_STATUSES,
      { id: 'limb_hurt', name: '肢體受創', desc: '命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' },
      { id: 'off_generic', name: '義體失效', desc: '義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'boost_generic', name: '義體超頻', desc: '義體超頻。', until: 'own_turn_end', turns: 1, kind: 'buff' },
    ],
    item: [ITEM('it_gel', { tags: ['medical'] })],
  },
}
const SKILL = { kind: 'ability', id: 'sk_x', name: '測試技能' } as const
const ITEM_SRC = { kind: 'item', id: 'it_gel', name: '急救凝膠' } as const
const GRENADE = { kind: 'item', id: 'it_nade', name: '破片手雷' } as const

type Prep = (k: Kernel) => void
/** 三對三的場地（我方 a1～a3、敵方 f1～f3；遮蔽預設全部暴露）。 */
const three = (prep: Prep = () => {}, cover: { ally: number[]; foe: number[] } = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies?: unknown[], foes?: unknown[]): Arena =>
  arena(duel(allies ?? [one({ weapon: 'pistol' }), one({ weapon: 'smg' }, 2), one({ weapon: 'knife' }, 3)], foes ?? [foe(), foe(), foe()], cover), [combatFeature], (k) => {
    k.content.loadPack(PACK)
    prep(k)
  })
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'drone', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
/** 對一個場地做一串效果；user 預設是 a1。 */
function go(a: Arena, list: Array<Record<string, unknown>>, target?: BattleTarget, o: { user?: BattleUnit; source?: BattleEffectSource; pick?: Record<string, unknown>; d?: number[]; n?: Record<string, number> } = {}) {
  const run = a.run(o.d ?? dice())
  const last = run.effects(list, { user: o.user ?? a.ally(1), ...(target ? { target } : {}), source: o.source ?? SKILL, ...(o.pick ? { pick: o.pick } : {}), ...(o.n ? { n: o.n } : {}) })
  return { run, last }
}
const rolls = (run: { beats: Array<{ roll?: { natural: number; dc: number; parts: Array<{ label: string; value: number; source?: string }> } }> }) => run.beats.filter((b) => b.roll).map((b) => b.roll!)
const f = (id: string): BattleTarget => ({ unit: id })

describe('登錄：這張清單上的 op 都由 combat 註冊，每個都帶格式檢查', () => {
  it('二十七個 op 都查得到、owner 是 combat；舊的五個道具效果（heal、cleanse、afterglow、vent、soft_cover）在同一張表上', () => {
    const a = three()
    const ops = ['attack', 'strike', 'damage', 'load', 'heal', 'vent', 'afterglow', 'status', 'unstatus', 'cleanse', 'soft_cover', 'check', 'shift', 'move', 'swap', 'cover', 'ap', 'mag', 'mag_cap', 'pool', 'implant', 'revive', 'wound', 'out', 'field', 'order', 'sink']
    for (const op of ops) expect(a.k.battle.getEffect(op), op).toMatchObject({ op, owner: 'combat' })
    for (const op of ops) expect(a.k.battle.getEffect(op)!.problems, op).toBeTypeOf('function')
    // 另外有兩個是 M1b-ordnance 註冊的（投擲物 throw、立牌 decoy），也是 combat 的
    expect(a.k.battle.effectIds().sort()).toEqual([...ops, 'throw', 'decoy'].sort())
  })
})

describe('attack：做的人用手上那一把打一次', () => {
  it('as：換一組屬性與基本功算命中，命中的明細多一項，數字是兩組的差（改造師用義體學打近戰）', () => {
    const a = three()
    const me = a.ally(1)
    me.attrs.tech = 16
    me.skills.cyberware = 4
    const plain = go(a, [{ op: 'attack' }], f('f1'), { d: dice(15, 1, 1, 1) })
    const withAs = go(a, [{ op: 'attack', as: { attr: 'tech', skill: 'cyberware' } }], f('f1'), { d: dice(15, 1, 1, 1) })
    const diff = attrMod(16) + 4 - (attrMod(15) + 2)
    expect(diff).toBe(3)
    const p0 = rolls(plain.run)[0]!.parts
    const p1 = rolls(withAs.run)[0]!.parts
    expect(p1).toHaveLength(p0.length + 1)
    expect(p1.find((p) => !p0.some((q) => q.label === p.label && q.value === p.value))).toMatchObject({ value: diff })
    // as 和 hit 合在同一項（紀錄上只有一項「加值」）
    const both = go(a, [{ op: 'attack', hit: 2, as: { attr: 'tech', skill: 'cyberware' } }], f('f1'), { d: dice(15, 1, 1, 1) })
    expect(rolls(both.run)[0]!.parts.reduce((s, p) => s + p.value, 0)).toBe(p0.reduce((s, p) => s + p.value, 0) + diff + 2)
  })

  it('spend: all 把彈匣打光；公式裡的 spent 是花掉的格數（連射：傷害骰多 spent − 1 顆），後面的效果也讀得到', () => {
    const a = three()
    const smg = a.ally(2)
    const seen: Array<[number, number]> = []
    const run = a.run(dice(10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1))
    const orig = run.roll.bind(run)
    run.roll = (c, s) => (seen.push([c, s]), orig(c, s))
    smg.hp!.now = 10
    const last = run.effects([{ op: 'attack', spend: 'all', dice: 'spent+-1', label: '連射' }, { op: 'heal', who: 'self', amount: 'spent' }], { user: smg, target: f('f1'), source: SKILL })
    expect(smg.weapons[0]!.mag!.now).toBe(0)
    // 衝鋒槍 3d6，彈匣 3 格：多 2 顆 = 5d6
    expect(seen).toContainEqual([5, 6])
    expect(smg.hp!.now).toBe(13)
    expect(last.hit).toBe(true)
    expect(run.beats.some((b) => b.text.includes('連射'))).toBe(true)
    // 數字的 spend 只扣那麼多格
    const b = three()
    go(b, [{ op: 'attack', spend: 2 }], f('f1'), { user: b.ally(2) })
    expect(b.ally(2).weapons[0]!.mag!.now).toBe(1)
  })

  it('結果放進 ctx.last（hit、crit、downed、dealt）；if: hit、miss 看得到；各種欄位照 AttackOpts：type、pierce、armor_mult、no_wound、auto_crit', () => {
    const a = three()
    const hitRun = go(a, [{ op: 'attack', type: 'neural' }, { op: 'heal', who: 'self', amount: 5, if: 'hit' }, { op: 'vent', who: 'self', amount: 5, if: 'miss' }], f('f1'), { d: dice(10, 1, 1, 1) })
    expect(hitRun.last).toMatchObject({ hit: true, crit: false, downed: false })
    expect(hitRun.last.dealt).toBeGreaterThan(0)
    expect(a.foe(1).load!.now).toBe(hitRun.last.dealt)
    // 自然 1：失手；auto_crit 命中就是要害
    const miss = go(a, [{ op: 'attack' }], f('f2'), { d: dice(1, 1, 1, 1) })
    expect(miss.last).toMatchObject({ hit: false, dealt: 0 })
    const crit = go(a, [{ op: 'attack', auto_crit: true }], f('f2'), { d: dice(10, 1, 1, 1, 1) })
    expect(crit.last.crit).toBe(true)
    // 穿甲與護甲倍率：護甲 4 的目標，手槍 3d6（骰面都是 6 = 18）
    const armored = three(undefined, undefined, undefined, [foe('minion', { armor: 4 })])
    const base = go(armored, [{ op: 'attack' }], f('f1'), { d: dice(10, 6, 6, 6) })
    // 手槍 3d6（骰面都是 6）＋ 固定傷害 1，我方的傷害倍率是 1
    expect(base.last.dealt).toBe(19 - 4)
    const pierce = go(armored, [{ op: 'attack', pierce: 4 }], f('f1'), { d: dice(10, 6, 6, 6) })
    expect(pierce.last.dealt).toBe(19)
    const mult = go(armored, [{ op: 'attack', armor_mult: 2 }], f('f1'), { d: dice(10, 6, 6, 6) })
    expect(mult.last.dealt).toBe(19 - 8)
  })

  it('對掛著的東西、沒有目標、手上沒有武器都不丟錯、沒有作用', () => {
    const a = three()
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const { run } = go(a, [{ op: 'attack' }], { overlay: 'o1' })
    expect(run.beats).toEqual([])
    expect(a.battle.overlays[0]!.hp.now).toBe(20)
    expect(go(a, [{ op: 'attack' }]).run.beats).toEqual([])
    a.ally(1).weapons = []
    expect(go(a, [{ op: 'attack' }], f('f1')).run.beats).toEqual([])
  })
})

describe('strike：不用手上的武器的一擊（臨時的武器）', () => {
  it('natural: true 擲一次，每個落點共用同一個骰面（一顆骰對兩格）；給數字就是那個面', () => {
    const a = three()
    const nade = go(a, [{ op: 'strike', who: 'area', dice: 3, hit: 5, natural: true, label: '投擲' }], { side: 'foe', slot: 1 }, { source: GRENADE, pick: { also: 2 }, d: dice(12, 1, 1, 1, 1, 1, 1) })
    expect(rolls(nade.run).map((r) => r.natural)).toEqual([12, 12])
    // 名字是來源的名字；沒給 natural 的各自擲
    expect(nade.run.beats.some((b) => b.text.includes('破片手雷') && b.text.includes('投擲'))).toBe(true)
    const own = go(a, [{ op: 'strike', who: 'area', dice: 3 }], { side: 'foe', slot: 1 }, { pick: { also: 2 }, d: dice(7, 1, 1, 1, 9, 1, 1, 1) })
    expect(rolls(own.run).map((r) => r.natural)).toEqual([7, 9])
    const fixed = go(a, [{ op: 'strike', who: 'area', dice: 3, natural: 18 }], { side: 'foe', slot: 1 }, { pick: { also: 2 } })
    expect(rolls(fixed.run).map((r) => r.natural)).toEqual([18, 18])
  })

  it('dice、type、hit、pierce 照欄位組武器：5 顆骰、命中加值、神經傷害打在感載上；不吃手上那把的彈匣', () => {
    const a = three()
    const mag = a.ally(1).weapons[0]!.mag!.now
    const { run, last } = go(a, [{ op: 'strike', dice: '2+3', type: 'neural', hit: '1+1', natural: 10 }], f('f1'), { d: dice(6, 6, 6, 6, 6) })
    expect(last.dealt).toBe(30)
    // 感載 22 的雜兵吃 30 點：過載（感載歸零、餘韻 +1）
    expect(a.foe(1).layers).toBe(1)
    expect(rolls(run)[0]!.parts.find((p) => p.source === 'weapon')).toMatchObject({ value: 2 })
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(mag)
  })

  it('落在掛著的東西上時走 attackOverlay：扣它的耐久、沒有要害；耐久歸零就被擊落', () => {
    const a = three()
    a.battle.overlays.push(overlay('o1', 'foe', 1, { armor: 2 }))
    const { run, last } = go(a, [{ op: 'strike', dice: 3, natural: 20 }], { overlay: 'o1' }, { source: GRENADE, d: dice(4, 4, 4) })
    expect(a.battle.overlays[0]!.hp.now).toBe(20 - (12 - 2))
    expect(last).toMatchObject({ hit: true, dealt: 10 })
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(2)
    const big = go(a, [{ op: 'strike', dice: 6, natural: 20, pierce: 2 }], { overlay: 'o1' }, { d: dice(6, 6, 6, 6, 6, 6) })
    expect(big.last.downed).toBe(true)
    expect(a.battle.overlays[0]!.down).toBe(true)
    expect(run.beats.length).toBeGreaterThan(0)
  })
})

describe('damage：不擲命中，直接照傷害類型打', () => {
  it('物理扣護甲（穿甲抵銷護甲）；結果進 last.dealt 與 last.downed；打倒了 if: downed 成立', () => {
    const a = three(undefined, undefined, undefined, [foe('minion', { armor: 3 }), foe(), foe()])
    const hp = a.foe(1).hp!.now
    const r1 = go(a, [{ op: 'damage', amount: 10 }], f('f1'))
    expect(r1.last.dealt).toBe(Math.round(7 * 1))
    expect(a.foe(1).hp!.now).toBe(hp - 7)
    const r2 = go(a, [{ op: 'damage', amount: 10, pierce: 2 }], f('f1'))
    expect(r2.last.dealt).toBe(9)
    // 打倒：生命 5 的人吃 99 點；if: downed 才做後面那筆
    a.foe(2).hp!.now = 5
    const r3 = go(a, [{ op: 'damage', amount: '9*11' }, { op: 'heal', who: 'self', amount: 3, if: 'downed' }], f('f2'))
    expect(a.foe(2).out).toBe('down')
    expect(r3.last.downed).toBe(true)
    a.ally(1).hp!.now = 10
    expect(go(a, [{ op: 'damage', amount: 1 }, { op: 'heal', who: 'self', amount: 3, if: 'downed' }], f('f3')).last.downed).toBe(false)
    expect(a.ally(1).hp!.now).toBe(10)
  })

  it('神經傷害打感載、對沒有橋的人無效；電磁對機器加倍', () => {
    const a = three()
    const r = go(a, [{ op: 'damage', amount: 10, type: 'neural' }], f('f1'))
    expect(r.last.dealt).toBe(10)
    expect(a.foe(1).load!.now).toBe(10)
    delete a.foe(2).load
    expect(go(a, [{ op: 'damage', amount: 10, type: 'neural' }], f('f2')).last.dealt).toBe(0)
  })

  it('落在掛著的東西上：扣耐久，照它的護甲與傷害類型（電磁對機器加倍、感載類無效）；耐久歸零就被擊落', () => {
    const a = three()
    a.battle.overlays.push(overlay('o1', 'foe', 1, { armor: 2 }))
    const phys = go(a, [{ op: 'damage', amount: 10 }], { overlay: 'o1' })
    expect(phys.last.dealt).toBe(8)
    expect(a.battle.overlays[0]!.hp.now).toBe(12)
    const neural = go(a, [{ op: 'damage', amount: 10, type: 'neural' }], { overlay: 'o1' })
    expect(neural.last.dealt).toBe(0)
    const em = go(a, [{ op: 'damage', amount: 8, type: 'em' }], { overlay: 'o1' })
    expect(em.last).toMatchObject({ dealt: 16, downed: true })
    expect(a.battle.overlays[0]).toMatchObject({ down: true })
    expect(em.run.beats.some((b) => b.tag === 'overlay.down')).toBe(true)
    // 已經擊落的再打沒有作用
    expect(go(a, [{ op: 'damage', amount: 10 }], { overlay: 'o1' }).run.beats).toEqual([])
  })
})

describe('load、heal、vent、afterglow', () => {
  it('load：對沒有橋的人是 0（記一句）；neural 與 pleasure 都加感載，pleasure 另加沉溺 +1；exact 不乘敏感度', () => {
    const a = three()
    delete a.foe(1).load
    const none = go(a, [{ op: 'load', amount: 10 }], f('f1'))
    expect(none.run.beats.map((b) => b.text).join()).toContain('沒有橋')
    expect(none.last.overloaded).toBe(false)
    const n = go(a, [{ op: 'load', amount: 10 }], f('f2'))
    expect([a.foe(2).load!.now, a.foe(2).sink]).toEqual([10, 0])
    expect(n.last.overloaded).toBe(false)
    go(a, [{ op: 'load', amount: 10, type: 'pleasure' }], f('f3'))
    expect([a.foe(3).load!.now, a.foe(3).sink]).toEqual([10, 1])
    a.foe(3).sensitivity = 100
    a.foe(3).load!.max = 100
    go(a, [{ op: 'load', amount: 10 }], f('f3'))
    expect(a.foe(3).load!.now).toBe(10 + 13)
    go(a, [{ op: 'load', amount: 10, exact: true }], f('f3'))
    expect(a.foe(3).load!.now).toBe(10 + 13 + 10)
  })

  it('load 讓對象過載時寫 last.overloaded，if: overloaded 看得到', () => {
    const a = three()
    const max = a.foe(1).load!.max
    const r = go(a, [{ op: 'load', amount: max + 10 }, { op: 'heal', who: 'self', amount: 4, if: 'overloaded' }], f('f1'), { user: a.ally(1) })
    expect(r.last.overloaded).toBe(true)
    expect(a.foe(1).layers).toBe(1)
    const calm = go(a, [{ op: 'load', amount: 1 }], f('f2'))
    expect(calm.last.overloaded).toBe(false)
    a.ally(1).hp!.now = 10
    go(a, [{ op: 'load', amount: 1 }, { op: 'heal', who: 'self', amount: 4, if: 'overloaded' }], f('f3'))
    expect(a.ally(1).hp!.now).toBe(10)
  })

  it('heal：帶著做的人與標籤，有人註冊 heal_dealt 時多回（技能是 [skill]、道具是 [item, …物品的標籤]）；對自己、隊友都行；vent 一樣吃 vent_dealt', () => {
    const a = three((k) => {
      k.battle.modifier('t', (q) => (q.kind === 'heal_dealt' && q.tags.includes('skill') ? [{ label: '技能', value: 4 }] : q.kind === 'heal_dealt' && q.tags.includes('medical') ? [{ label: '醫療', value: 2 }] : []))
      k.battle.modifier('t', (q) => (q.kind === 'vent_dealt' && q.tags.includes('skill') ? [{ label: '技能', value: 3 }] : []))
    })
    const t = a.ally(2)
    t.hp!.now = 10
    t.load!.now = 20
    go(a, [{ op: 'heal', amount: 5 }], f('a2'))
    expect(t.hp!.now).toBe(19)
    go(a, [{ op: 'heal', amount: 5 }], f('a2'), { source: ITEM_SRC })
    expect(t.hp!.now).toBe(26)
    go(a, [{ op: 'vent', amount: 5 }], f('a2'))
    expect(t.load!.now).toBe(12)
    // 道具沒有 medical 的標籤、技能的修正也不吃：+0
    const b = three((k) => k.battle.modifier('t', (q) => (q.kind === 'heal_dealt' && q.tags.includes('skill') ? [{ label: '技能', value: 4 }] : [])))
    b.ally(2).hp!.now = 10
    go(b, [{ op: 'heal', amount: 5 }], f('a2'), { source: ITEM_SRC })
    expect(b.ally(2).hp!.now).toBe(15)
    // 公式：half_tier_up
    go(b, [{ op: 'heal', amount: 'half_tier_up*2' }], f('a2'), { n: { tier: 3 } })
    expect(b.ally(2).hp!.now).toBe(15 + 4 + 4)
  })

  it('afterglow：amount 正的加、負的消，夾在 0～上限；沒有變化不寫紀錄；舊的 layers 寫法照舊', () => {
    const a = three()
    const t = a.ally(2)
    go(a, [{ op: 'afterglow', amount: 2 }], f('a2'))
    expect(t.layers).toBe(2)
    const r = go(a, [{ op: 'afterglow', amount: -1 }], f('a2'))
    expect(t.layers).toBe(1)
    expect(r.run.beats.some((b) => b.text.includes('餘韻 −1 層'))).toBe(true)
    go(a, [{ op: 'afterglow', amount: 99 }], f('a2'))
    expect(t.layers).toBe(t.layersMax)
    go(a, [{ op: 'afterglow', layers: -99 }], f('a2'))
    expect(t.layers).toBe(0)
    expect(go(a, [{ op: 'afterglow', amount: -1 }], f('a2')).run.beats).toEqual([])
  })
})

describe('status、unstatus、cleanse、soft_cover', () => {
  it('status：給狀態（turns、until、data 蓋掉預設，by 是做的人）；帶 save 而且對象過了檢定時沒有給上去', () => {
    const a = three()
    go(a, [{ op: 'status', status: 'suppressed', turns: 'half_tier_up', until: 'source_turn_start', data: { hit: -5 } }], f('f1'), { n: { tier: 3 } })
    expect(a.foe(1).statuses).toEqual([{ id: 'suppressed', by: 'a1', until: { at: 'turn_start', of: 'a1', turns: 2 }, data: { hit: -5 } }])
    // 過了檢定：自然 20 一定過
    const save = { attr: 'resolve', skill: 'composure', dc: 14, tags: ['resist:suppressed'] }
    const pass = go(a, [{ op: 'status', status: 'suppressed', save }], f('f2'), { d: dice(20) })
    expect(a.foe(2).statuses).toEqual([])
    expect(pass.run.beats.some((b) => b.roll && b.roll.dc === 14)).toBe(true)
    // 沒過：給上去
    go(a, [{ op: 'status', status: 'suppressed', save }], f('f2'), { d: dice(1) })
    expect(a.foe(2).statuses.map((s) => s.id)).toEqual(['suppressed'])
    // dc 也收公式
    const formula = go(a, [{ op: 'status', status: 'marked', save: { attr: 'resolve', dc: '10+spent*2' } }], f('f3'), { d: dice(10), n: { spent: 3 } })
    expect(rolls(formula.run)[0]!.dc).toBe(16)
  })

  it('status 的 save 標籤傳到修正（只對 resist:suppressed 加值的修正）；對自己下的不帶 other', () => {
    const a = three((k) => k.battle.modifier('t', (q) => (q.kind === 'save' && q.tags.includes('resist:suppressed') ? [{ label: '抗壓', value: 6 }] : [])))
    const r = go(a, [{ op: 'status', status: 'suppressed', save: { attr: 'resolve', dc: 14, tags: ['resist:suppressed'] } }, { op: 'status', status: 'marked', save: { attr: 'resolve', dc: 14 } }], f('f1'), { d: dice(10, 10) })
    const [first, second] = rolls(r.run)
    expect(first!.parts.some((p) => p.label === '抗壓')).toBe(true)
    expect(second!.parts.some((p) => p.label === '抗壓')).toBe(false)
  })

  it('unstatus：解除指定的狀態；或從 kinds 這幾種裡解除 count 個（從先得到的開始）', () => {
    const a = three()
    const t = a.foe(1)
    const run = a.run()
    for (const s of ['bleeding', 'marked', 'suppressed', 'frozen']) run.applyStatus(t, s)
    const done = (list: Array<Record<string, unknown>>) => run.effects(list, { user: a.ally(1), target: f('f1'), source: SKILL })
    done([{ op: 'unstatus', status: 'bleeding' }])
    expect(t.statuses.map((s) => s.id)).toEqual(['marked', 'suppressed', 'frozen'])
    done([{ op: 'unstatus', kinds: ['debuff', 'mark'], count: 1 }])
    expect(t.statuses.map((s) => s.id)).toEqual(['suppressed', 'frozen'])
    done([{ op: 'unstatus', kinds: ['debuff', 'mark'] }])
    expect(t.statuses.map((s) => s.id)).toEqual(['frozen'])
    done([{ op: 'unstatus', kinds: ['control'], count: 'tier' }, { op: 'unstatus', status: 'ghost' }])
    expect(t.statuses.map((s) => s.id)).toEqual(['frozen'])
    done([{ op: 'unstatus', kinds: ['control'], count: 2 }])
    expect(t.statuses).toEqual([])
  })

  it('cleanse 與 soft_cover：照現在的（by 解可以被它解的狀態、status 解指定的；煙霧是打不破的一格）', () => {
    const a = three()
    const run = a.run()
    run.applyStatus(a.ally(2), 'bleeding')
    run.applyStatus(a.ally(2), 'dazed')
    run.effects([{ op: 'cleanse', by: 'first_aid' }], { user: a.ally(1), target: f('a2'), source: ITEM_SRC })
    expect(a.ally(2).statuses.map((s) => s.id)).toEqual(['dazed'])
    run.effects([{ op: 'cleanse', status: 'dazed' }], { user: a.ally(1), target: f('a2'), source: ITEM_SRC })
    expect(a.ally(2).statuses).toEqual([])
    run.effects([{ op: 'soft_cover', kind: 'smoke', rounds: 2 }], { user: a.ally(1), target: { side: 'foe', slot: 2 }, source: ITEM_SRC })
    expect(a.battle.cover.foe[1]!.soft).toMatchObject({ kind: 'smoke', until: a.battle.round + 1 })
  })
})

describe('check：做的人擲一次檢定', () => {
  /** 第 3 級的精英：DC 的 per_grade 看對象的等級。 */
  const elite3 = () => three(undefined, undefined, undefined, [enemyUnit('elite', 3), foe(), foe('boss')])

  it('vs: { base, per_grade, elite, boss }：對 III 級精英是 10 ＋ 2×3 ＋ 2 = 18；首領加 boss 那一項、雜兵不加', () => {
    const a = elite3()
    const spec = { op: 'check', attr: 'charm', skill: 'streetwise', vs: { base: 10, per_grade: 2, elite: 2, boss: 4 } }
    const r = go(a, [spec], f('f1'), { d: dice(20) })
    expect(rolls(r.run)[0]!.dc).toBe(18)
    expect(r.last.ok).toBe(true)
    expect(rolls(go(a, [spec], f('f2'), { d: dice(20) }).run)[0]!.dc).toBe(12)
    expect(rolls(go(a, [spec], f('f3'), { d: dice(20) }).run)[0]!.dc).toBe(16)
  })

  it('stop: true 而且沒過時後面的效果沒有做；過了照做；沒寫 stop 就不停（if: fail 看得到）', () => {
    const a = three()
    a.ally(1).hp!.now = 10
    const list = [{ op: 'check', attr: 'charm', vs: 15, stop: true }, { op: 'heal', who: 'self', amount: 5 }]
    const fail = go(a, list, f('f1'), { d: dice(2) })
    expect(fail.last).toMatchObject({ ok: false, stop: true })
    expect(a.ally(1).hp!.now).toBe(10)
    const pass = go(a, list, f('f1'), { d: dice(20) })
    expect(pass.last.ok).toBe(true)
    expect(pass.last.stop).toBeUndefined()
    expect(a.ally(1).hp!.now).toBe(15)
    go(a, [{ op: 'check', attr: 'charm', vs: 15 }, { op: 'heal', who: 'self', amount: 5 }, { op: 'heal', who: 'self', amount: 1, if: 'fail' }], f('f1'), { d: dice(2) })
    expect(a.ally(1).hp!.now).toBe(21)
  })

  it('vs: will 是 10 ＋ mod(意志) ＋ 定力；vs: evade 含遮蔽；vs: firewall 有甲板用甲板的、沒有的用不含遮蔽的迴避，再加 firewall 修正', () => {
    const a = three((k) => k.battle.modifier('t', (q) => (q.kind === 'firewall' && q.unit.id === 'f3' ? [{ label: '防火牆', value: 2 }] : [])), { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] })
    a.foe(1).attrs.resolve = 14
    a.foe(1).skills.composure = 2
    const dc = (target: string, vs: unknown) => rolls(go(a, [{ op: 'check', attr: 'intellect', vs }], f(target), { d: dice(20) }).run)[0]!.dc
    expect(dc('f1', 'will')).toBe(10 + attrMod(14) + 2)
    // 第 1 格是掩體：迴避 10 加掩體的加值
    const cover = a.run().evadeOf(a.foe(1), a.ally(1))
    expect(cover.cover).toBe(a.run().n.coverBonus[2])
    expect(dc('f1', 'evade')).toBe(cover.total)
    expect(cover.total).toBe(a.foe(1).evade + cover.cover)
    // 防火牆：沒有甲板用不含遮蔽的迴避（f1 站在掩體裡也不算）；有甲板用甲板的
    expect(dc('f1', 'firewall')).toBe(a.foe(1).evade)
    a.foe(2).ext.deck = { grade: 2, firewall: 15, slots: [] }
    expect(dc('f2', 'firewall')).toBe(15)
    a.foe(3).ext.deck = { grade: 2, firewall: 12, slots: [] }
    expect(dc('f3', 'firewall')).toBe(14)
    // 沒有對象（一格）的 keyword 跳過；數字照寫
    expect(go(a, [{ op: 'check', attr: 'charm', vs: 'will' }], { side: 'foe', slot: 2 }).run.beats).toEqual([])
    expect(dc('f1', 12)).toBe(12)
  })

  it('vs: { firewall: true, elite, boss }：防火牆再依對象的位階加 elite、boss（快駭的控制類）；沒寫的那一項是 0；evade、will 也能這樣寫', () => {
    const a = three(undefined, undefined, undefined, [foe(), foe('elite'), foe('boss')])
    const dc = (vs: unknown, target: string) => rolls(go(a, [{ op: 'check', attr: 'intellect', vs }], f(target), { d: dice(20) }).run)[0]!.dc
    const fw = { firewall: true, elite: 2, boss: 4 }
    // 三個人都沒有甲板：防火牆 = 不含遮蔽的迴避
    expect([dc(fw, 'f1'), dc(fw, 'f2'), dc(fw, 'f3')]).toEqual([a.foe(1).evade, a.foe(2).evade + 2, a.foe(3).evade + 4])
    // 沒寫 elite、boss：不加；公式也行
    expect(dc({ firewall: true }, 'f3')).toBe(a.foe(3).evade)
    expect(dc({ firewall: true, boss: 'grade*2' }, 'f3')).toBe(a.foe(3).evade + 2)
    // 有甲板：用甲板的
    a.foe(3).ext.deck = { grade: 2, firewall: 15, slots: [] }
    expect(dc(fw, 'f3')).toBe(19)
    // evade、will 的寫法
    expect(dc({ evade: true, boss: 3 }, 'f3')).toBe(a.run().evadeOf(a.foe(3), a.ally(1)).total + 3)
    a.foe(2).attrs.resolve = 14
    a.foe(2).skills.composure = 2
    expect(dc({ will: true, elite: 1 }, 'f2')).toBe(10 + attrMod(14) + 2 + 1)
    // 和字串寫法一樣的數字
    expect(dc('firewall', 'f3')).toBe(15)
  })

  it('防火牆：有甲板（要有 grade）沒寫 firewall 是 10；沒有 grade 的不算甲板、用迴避；firewall 修正帶這次檢定的標籤', () => {
    const asked: string[][] = []
    const a = three((k) => k.battle.modifier('t', (q) => {
      if (q.kind === 'firewall') asked.push(q.tags)
      return q.kind === 'firewall' && q.tags.includes('hack:neural') ? [{ label: '神經防火牆', value: 3 }] : []
    }))
    const dc = (tags?: string[]) => rolls(go(a, [{ op: 'check', attr: 'intellect', vs: 'firewall', ...(tags ? { tags } : {}) }], f('f1'), { d: dice(20) }).run)[0]!.dc
    a.foe(1).ext.deck = { grade: 2, slots: [] }
    expect(dc()).toBe(10)
    a.foe(1).ext.deck = { firewall: 15 }
    expect(dc()).toBe(a.foe(1).evade)
    a.foe(1).ext.deck = { grade: 2, firewall: 12, slots: [] }
    asked.length = 0
    expect(dc(['hack', 'hack:neural'])).toBe(15)
    expect(asked).toEqual([['hack', 'hack:neural']])
  })

  it('掛著的東西：對防火牆的檢定照它的迴避擲（沒有甲板；不發 check.before）；對 evade、will 或寫死的數字的檢定落在它身上時跳過', () => {
    const seen: string[] = []
    const a = three((k) => k.battle.on('check.before', 't', ({ unit, other }) => void seen.push(`${unit.id}>${other.id}`)))
    a.battle.overlays.push(overlay('o1', 'foe', 1, { evade: 7 }))
    const at = (vs: unknown): number[] => rolls(go(a, [{ op: 'check', attr: 'intellect', vs }], { overlay: 'o1' }, { d: dice(20) }).run).map((r) => r.dc)
    expect(at('firewall')).toEqual([7])
    expect(at({ firewall: true, elite: 2, boss: 4 })).toEqual([7])
    expect(at('evade')).toEqual([])
    expect(at('will')).toEqual([])
    expect(at(12)).toEqual([])
    expect(at({ base: 10 })).toEqual([])
    expect(seen).toEqual([])
  })

  it('控制節點與沒有對象：寫死的數字對節點照擲（不發 check.before）；防火牆、意志這種要看對象的沒有對象就整筆跳過', () => {
    const a = three()
    expect(rolls(go(a, [{ op: 'check', attr: 'intellect', vs: 14 }], { node: 'n1' }, { d: dice(20) }).run).map((r) => r.dc)).toEqual([14])
    expect(go(a, [{ op: 'check', attr: 'intellect', vs: 'firewall' }], { node: 'n1' }).run.beats).toEqual([])
    expect(go(a, [{ op: 'check', attr: 'intellect', vs: { firewall: true } }], { side: 'foe', slot: 2 }).run.beats).toEqual([])
  })

  it('bonus 可以是一串 { label, value }：每一項在明細裡各自一行（值是 0 的不列）；公式照常', () => {
    const a = three()
    const r = go(a, [{ op: 'check', attr: 'intellect', vs: 12, bonus: [{ label: '等級加值', value: 1 }, { label: '程式加值', value: 0 }, { label: '公式加值', value: 'tier+1' }] }], f('f1'), { d: dice(10), n: { tier: 2 } })
    const parts = rolls(r.run)[0]!.parts
    expect(parts.filter((p) => p.source === 'skill').map((p) => [p.label, p.value])).toEqual([['等級加值', 1], ['公式加值', 3]])
  })

  it('check 的格式檢查：vs 的防火牆寫法一次只能寫一種、值要是 true；bonus 的每一項要有 label 與 value', () => {
    const a = three()
    const bad = (e: Record<string, unknown>) => a.k.battle.effectProblems([{ op: 'check', attr: 'intellect', ...e }]).join('；')
    expect(bad({ vs: { firewall: true, elite: 2, boss: 4 } })).toBe('')
    expect(bad({ vs: { evade: true } })).toBe('')
    expect(bad({ vs: { firewall: true, will: true } })).toContain('只能寫一個')
    expect(bad({ vs: { firewall: false } })).toContain('firewall：要是 true')
    expect(bad({ vs: { firewall: true, elite: 'bogus' } })).toContain('elite')
    expect(bad({ vs: { firewall: true, base: 3 } })).toContain('base')
    expect(bad({ vs: 'nothing' })).toContain('nothing')
    expect(bad({ vs: 12, bonus: [{ label: '加值', value: 1 }] })).toBe('')
    expect(bad({ vs: 12, bonus: [{ label: '加值' }] })).toContain('value')
    expect(bad({ vs: 12, bonus: [{ value: 1 }] })).toContain('label')
  })

  it('bonus 與 tags：加值多一項、標籤傳到修正；對別人擲的檢定發 check.before（被快駭的一方可以改 DC），對自己擲的不發', () => {
    const seen: string[] = []
    const a = three((k) => {
      k.battle.modifier('t', (q) => (q.kind === 'save' && q.tags.includes('quickhack') ? [{ label: '快駭', value: 3 }] : []))
      k.battle.on('check.before', 't', ({ unit, other, opts }) => {
        seen.push(`${unit.id}>${other.id}`)
        opts.dc += 2
      })
    })
    const r = go(a, [{ op: 'check', attr: 'intellect', skill: 'hacking', vs: 12, bonus: '1+1', tags: ['quickhack'], label: '快駭' }], f('f1'), { d: dice(10) })
    const roll = rolls(r.run)[0]!
    expect(roll.dc).toBe(14)
    expect(roll.parts.map((p) => p.value)).toContain(3)
    expect(roll.parts.some((p) => p.label === '加值' && p.value === 2)).toBe(true)
    expect(seen).toEqual(['a1>f1'])
    expect(r.run.beats.some((b) => b.text.includes('快駭'))).toBe(true)
    go(a, [{ op: 'check', attr: 'intellect', vs: 12, who: 'self' }])
    expect(seen).toEqual(['a1>f1'])
  })
})

describe('shift、move、swap、cover', () => {
  it('shift：push 往後推、pull 往前拉，n 是格數（目的格有人就交換）；到底了就不動', () => {
    const a = three()
    go(a, [{ op: 'shift', dir: 'push' }], f('f1'))
    expect([a.foe(1).slot, a.foe(2).slot]).toEqual([2, 1])
    go(a, [{ op: 'shift', dir: 'push', n: 'tier' }], f('f1'), { n: { tier: 2 } })
    // f1 在第 2 格：推兩次是 3 格（和 f3 交換）再到 4 格；第 3 格空了，補位把他拉回 3 格（後排自動往前）
    expect([a.foe(1).slot, a.foe(3).slot]).toEqual([3, 2])
    // 到底了（再推只是補位拉回來）：不丟錯
    go(a, [{ op: 'shift', dir: 'push', n: 5 }], f('f1'))
    expect(a.foe(1).slot).toBe(3)
    go(a, [{ op: 'shift', dir: 'pull' }], f('f1'))
    expect([a.foe(1).slot, a.foe(3).slot]).toEqual([2, 3])
    go(a, [{ op: 'shift', dir: 'pull', n: 9 }], f('f1'))
    expect(a.foe(1).slot).toBe(1)
    // 掛著的東西、替身都不動
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    expect(go(a, [{ op: 'shift', dir: 'push' }], { overlay: 'o1' }).run.beats).toEqual([])
  })

  it('move：to: pick 讀 pick.slot（和那一格的人交換、或移到空格），不花行動點；adjacent 還要求相鄰；沒選或選錯丟 BattleBlocked', () => {
    const a = three()
    const ap = a.ally(1).ap.now
    go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: { slot: 3 } })
    expect([a.ally(1).slot, a.ally(3).slot]).toEqual([3, 1])
    expect(a.ally(1).ap.now).toBe(ap)
    go(a, [{ op: 'move', to: 'adjacent' }], f('a1'), { pick: { slot: 2 } })
    expect([a.ally(1).slot, a.ally(2).slot]).toEqual([2, 3])
    expect(() => go(a, [{ op: 'move', to: 'adjacent' }], f('a1'), { pick: { slot: 1 } })).not.toThrow()
    a.ally(1).slot = 1
    a.ally(3).slot = 2
    a.ally(2).slot = 3
    expect(() => go(a, [{ op: 'move', to: 'adjacent' }], f('a1'), { pick: { slot: 3 } })).toThrow(BattleBlocked)
    expect(() => go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: {} })).toThrow(BattleBlocked)
    expect(() => go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: { slot: 9 } })).toThrow(BattleBlocked)
    // 選自己所在的那一格：什麼都不做
    expect(go(a, [{ op: 'move', to: 'pick' }], f('a1'), { pick: { slot: 1 } }).run.beats).toEqual([])
  })

  it('swap：對象和 pick 裡那個隊友交換位置；不是隊友、是自己、沒選丟 BattleBlocked', () => {
    const a = three()
    go(a, [{ op: 'swap', with: 'buddy' }], f('a1'), { pick: { buddy: 'a3' } })
    expect([a.ally(1).slot, a.ally(3).slot]).toEqual([3, 1])
    go(a, [{ op: 'swap', with: 'buddy' }], f('a1'), { pick: { buddy: { unit: 'a2' } } })
    expect([a.ally(1).slot, a.ally(2).slot]).toEqual([2, 3])
    for (const pick of [{ buddy: 'f1' }, { buddy: 'a1' }, {}, { buddy: 'zzz' }]) expect(() => go(a, [{ op: 'swap', with: 'buddy' }], f('a1'), { pick })).toThrow(BattleBlocked)
  })

  it('cover：levels 正的升負的降，目標那一格（一格、一個人、who: self 都行）；max 是這一格每一級的耐久', () => {
    const a = three()
    go(a, [{ op: 'cover', levels: 1 }], { side: 'foe', slot: 2 })
    expect(a.battle.cover.foe[1]).toMatchObject({ level: 1 })
    go(a, [{ op: 'cover', levels: 5, max: [10, 40] }], { side: 'ally', slot: 1 })
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 2, hp: 40, max: [10, 40] })
    go(a, [{ op: 'cover', levels: -1 }], { side: 'ally', slot: 1 })
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 1, hp: 10 })
    // 目標是人：他那一格；who: self：做的人那一格
    go(a, [{ op: 'cover', levels: '1+1' }], f('f3'))
    expect(a.battle.cover.foe[2]!.level).toBe(2)
    go(a, [{ op: 'cover', levels: 1, who: 'self' }], f('f1'), { user: a.ally(2) })
    expect(a.battle.cover.ally[1]!.level).toBe(1)
    go(a, [{ op: 'cover', levels: -9 }], { side: 'ally', slot: 1 })
    expect(a.battle.cover.ally[0]!.level).toBe(0)
    // 沒有目標、levels 是 0：沒有作用
    expect(go(a, [{ op: 'cover', levels: 1 }]).run.beats).toEqual([])
    expect(go(a, [{ op: 'cover', levels: 0 }], { side: 'ally', slot: 3 }).run.beats).toEqual([])
  })
})

describe('ap、mag、pool', () => {
  it('ap：加減行動點，不帶 over_cap 不超過上限（本來就超過的不會被拉下來）、減不會低於 0；over_cap 可以超過', () => {
    const a = three()
    const t = a.ally(2)
    t.ap.now = 2
    go(a, [{ op: 'ap', amount: 10 }], f('a2'))
    expect(t.ap.now).toBe(t.ap.max)
    go(a, [{ op: 'ap', amount: 2, over_cap: true }], f('a2'))
    expect(t.ap.now).toBe(t.ap.max + 2)
    go(a, [{ op: 'ap', amount: 1 }], f('a2'))
    expect(t.ap.now).toBe(t.ap.max + 2)
    go(a, [{ op: 'ap', amount: -99 }], f('a2'))
    expect(t.ap.now).toBe(0)
    go(a, [{ op: 'ap', amount: 'tier' }], f('a2'), { n: { tier: 2 } })
    expect(t.ap.now).toBe(2)
  })

  it('mag：amount 數字或 full，對象手上那一把；不帶 over_cap 不超過彈匣容量；沒有彈匣的武器跳過', () => {
    const a = three()
    const smg = a.ally(2).weapons[0]!
    smg.mag!.now = 0
    go(a, [{ op: 'mag', amount: 1 }], f('a2'))
    expect(smg.mag!.now).toBe(1)
    go(a, [{ op: 'mag', amount: 5 }], f('a2'))
    expect(smg.mag!.now).toBe(smg.mag!.max)
    go(a, [{ op: 'mag', amount: 1, over_cap: true }], f('a2'))
    expect(smg.mag!.now).toBe(smg.mag!.max + 1)
    go(a, [{ op: 'mag', amount: -2 }], f('a2'))
    expect(smg.mag!.now).toBe(smg.mag!.max - 1)
    go(a, [{ op: 'mag', amount: 'full' }], f('a2'))
    expect(smg.mag!.now).toBe(smg.mag!.max)
    expect(go(a, [{ op: 'mag', amount: 'full' }], f('a3')).run.beats).toEqual([])
  })

  it('pool：對象的一池資源加減、full 補滿；沒有那一池的人跳過', () => {
    const a = three()
    const ram = a.ally(2).pools.ram!
    ram.now = 1
    go(a, [{ op: 'pool', pool: 'ram', amount: 2 }], f('a2'))
    expect(ram.now).toBe(3)
    go(a, [{ op: 'pool', pool: 'ram', amount: 'full' }], f('a2'))
    expect(ram.now).toBe(ram.max)
    go(a, [{ op: 'pool', pool: 'ram', amount: -3 }], f('a2'))
    expect(ram.now).toBe(ram.max - 3)
    go(a, [{ op: 'pool', pool: 'ram', amount: 99 }], f('a2'))
    expect(ram.now).toBe(ram.max)
    expect(go(a, [{ op: 'pool', pool: 'ram', amount: 2 }], f('f1')).run.beats).toEqual([])
    expect(go(a, [{ op: 'pool', pool: 'nope', amount: 2 }], f('a2')).run.beats).toEqual([])
  })
})

describe('implant、revive、wound、out、field、order、sink', () => {
  const implants = (a: Arena) => {
    a.foe(1).implants = [{ kind: 'eye', name: '義眼' }, { kind: 'arm', name: '義臂' }]
  }

  it('implant：off 讓一件義體失效、boost 超頻；pick.implant 有給就照它；結果進 last.ok（有沒有挑到）', () => {
    const a = three()
    implants(a)
    const r = go(a, [{ op: 'implant', mode: 'off', turns: 2 }], f('f1'))
    expect(r.last.ok).toBe(true)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_generic'])
    expect(a.foe(1).statuses[0]!.until).toMatchObject({ turns: 2 })
    expect(r.run.beats.some((b) => b.text.includes('義眼') && b.text.includes('失效'))).toBe(true)
    // 兩件都退回 off_generic：第二次沒有可挑的；用 pick 指定第二件就挑得到
    expect(go(a, [{ op: 'implant', mode: 'off' }], f('f1')).last.ok).toBe(false)
    const picked = go(a, [{ op: 'implant', mode: 'off' }], f('f1'), { pick: { implant: 1 } })
    expect(picked.last.ok).toBe(true)
    expect(picked.run.beats.some((b) => b.text.includes('義臂'))).toBe(true)
    expect(go(a, [{ op: 'implant', mode: 'boost', kind: 'arm' }], f('f1')).last.ok).toBe(true)
    expect(a.foe(1).statuses.map((s) => s.id).sort()).toEqual(['boost_generic', 'off_generic'])
    expect(go(a, [{ op: 'implant', mode: 'boost', kind: 'leg' }], f('f1')).last.ok).toBe(false)
    expect(go(a, [{ op: 'implant', mode: 'off' }], f('f2')).last.ok).toBe(false)
    const ok = go(a, [{ op: 'implant', mode: 'off' }, { op: 'heal', who: 'self', amount: 3, if: 'fail' }], f('f2'))
    expect(ok.last.ok).toBe(false)
  })

  it('revive：把倒下的人救回來（生命是給的數字）；不是倒下（昏過去、被制伏）的、還站著的沒有作用', () => {
    const a = three()
    const run = a.run()
    run.setOut(a.ally(2), 'down')
    expect(a.ally(2).out).toBe('down')
    go(a, [{ op: 'revive', hp: '3+4' }], f('a2'))
    expect(a.ally(2)).toMatchObject({ slot: 3 })
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(2).hp!.now).toBe(7)
    expect(a.ally(2).ap.now).toBe(0)
    // 昏過去（burnout）、被制伏的不收
    run.setOut(a.ally(3), 'burnout')
    go(a, [{ op: 'revive', hp: 5 }], f('a3'))
    expect(a.ally(3).out).toBe('burnout')
    expect(go(a, [{ op: 'revive' }], f('a1')).run.beats).toEqual([])
    a.foe(1).hp!.now = 1
    go(a, [{ op: 'damage', amount: 99 }], f('f1'))
    go(a, [{ op: 'revive' }], f('f1'))
    expect(a.foe(1).hp!.now).toBe(1)
  })

  it('wound：treat 輕的解除、重的降成輕的（肢體的 −4 回到狀態自己的數字、軀幹的生命上限與橋的層數加回來）；clear 全部清掉；part 只處理那一個', () => {
    const a = three()
    const t = a.ally(2)
    const run = a.run()
    t.wounds = { limb: 2, head: 1, torso: 2, bridge: 2 }
    run.applyStatus(t, 'limb_hurt', { data: { hit: -4 } })
    run.applyStatus(t, 'dazed')
    run.applyStatus(t, 'bleeding')
    t.hp!.max -= 5
    t.layersMax -= 1
    const max = t.hp!.max
    const layers = t.layersMax
    // 只處理頭：輕的解除
    go(a, [{ op: 'wound', mode: 'treat', part: 'head' }], f('a2'))
    expect(t.wounds).toEqual({ limb: 2, torso: 2, bridge: 2 })
    expect(t.statuses.map((s) => s.id)).toEqual(['limb_hurt', 'bleeding'])
    // 全部 treat：重的各降成輕的
    go(a, [{ op: 'wound', mode: 'treat' }], f('a2'))
    expect(t.wounds).toEqual({ limb: 1, torso: 1, bridge: 1 })
    expect(t.statuses.find((s) => s.id === 'limb_hurt')!.data).toBeUndefined()
    expect(t.hp!.max).toBe(max + 5)
    expect(t.layersMax).toBe(layers + 1)
    // 再 treat 一次：輕的解除
    go(a, [{ op: 'wound', mode: 'treat' }], f('a2'))
    expect(t.wounds).toEqual({})
    expect(t.statuses).toEqual([])
    // clear：重的也一次清掉
    t.wounds = { limb: 2, torso: 2 }
    run.applyStatus(t, 'limb_hurt', { data: { hit: -4 } })
    run.applyStatus(t, 'bleeding')
    go(a, [{ op: 'wound', mode: 'clear' }], f('a2'))
    expect(t.wounds).toEqual({})
    expect(t.statuses).toEqual([])
    expect(go(a, [{ op: 'wound', mode: 'clear' }], f('a2')).run.beats).toEqual([])
  })

  it('out：surrendered、fled 讓對象退出；退出的人不在場上', () => {
    const a = three()
    go(a, [{ op: 'out', how: 'surrendered' }], f('f1'))
    expect(a.foe(1).out).toBe('surrendered')
    go(a, [{ op: 'out', how: 'fled' }], f('f2'))
    expect(a.foe(2).out).toBe('fled')
    expect(unitsOf(a.battle, 'foe').map((u) => u.id)).toEqual(['f3'])
  })

  it('out 被 out.before 擋下時不退出', () => {
    const a = three((k) => k.battle.on('out.before', 't', ({ how, out }) => { if (how === 'surrendered') out.prevent = true }))
    go(a, [{ op: 'out', how: 'surrendered' }], f('f1'))
    expect(a.foe(1).out).toBeUndefined()
    go(a, [{ op: 'out', how: 'fled' }], f('f1'))
    expect(a.foe(1).out).toBe('fled')
  })

  it('field：dark 開關場地的黑暗（全場迴避 +2）；沒變化不重複記', () => {
    const a = three()
    const evade = () => a.run().evadeOf(a.foe(1)).total
    const base = evade()
    const on = go(a, [{ op: 'field', key: 'dark' }])
    expect(a.battle.field.dark).toBe(true)
    expect(evade()).toBe(base + a.run().n.darkEvade)
    expect(on.run.beats.map((b) => b.tag)).toEqual(['field'])
    expect(go(a, [{ op: 'field', key: 'dark', value: true }]).run.beats).toEqual([])
    const off = go(a, [{ op: 'field', key: 'dark', value: false }])
    expect(a.battle.field.dark).toBe(false)
    expect(off.run.beats).toHaveLength(1)
    expect(evade()).toBe(base)
    // 落在好幾個人身上也只記一次
    expect(go(a, [{ op: 'field', key: 'dark', who: 'foes' }]).run.beats).toHaveLength(1)
  })

  describe('order：先攻對調', () => {
    const full = () => three()
    const eight = () => arena(BATTLE_SETUPS.encounter(), [combatFeature], (k) => k.content.loadPack(PACK))

    it('對象和 pick 裡的人對調順位，現在輪到的人不變', () => {
      const a = eight()
      const before = [...a.battle.order]
      const turnId = before[a.battle.turn]!
      go(a, [{ op: 'order', with: 'buddy' }], f(before[3]!), { pick: { buddy: before[1] } })
      const order = [...a.battle.order]
      expect([order[1], order[3]]).toEqual([before[3], before[1]])
      expect(order[a.battle.turn]).toBe(turnId)
      expect(() => go(a, [{ op: 'order', with: 'buddy' }], f('a1'), { pick: { buddy: 'a1' } })).toThrow(BattleBlocked)
      expect(() => go(a, [{ op: 'order', with: 'buddy' }], f('a1'), { pick: {} })).toThrow(BattleBlocked)
      expect(full().battle.order.length).toBe(6)
    })

    it('act_next：被換到前面、這一輪還沒動過的馬上輪到他（排在現在這一位後面），並拿回 1 點行動點', () => {
      const a = eight()
      a.battle.turn = 0
      const [, x, , , , y] = a.battle.order
      a.battle.units[y!]!.ap.now = 0
      go(a, [{ op: 'order', with: 'buddy', act_next: true }], f(y!), { pick: { buddy: x } })
      expect(a.battle.order[1]).toBe(y)
      expect(a.battle.units[y!]!.ap.now).toBe(1)
      expect(a.battle.order[5]).toBe(x)
    })

    it('act_next：一個動過、一個沒動過的對調：原本沒動過、被換到前面（對調後排在現在這一位前面）的接著動；動過的被換到後面', () => {
      const a = eight()
      a.battle.turn = 3
      const before = [...a.battle.order]
      const [x, , , cur, , , y] = before
      // x 排在第 0 位（動過），y 排在第 6 位（還沒動過）；對調後 y 在第 0 位、x 在第 6 位
      a.battle.units[y!]!.ap.now = 0
      go(a, [{ op: 'order', with: 'buddy', act_next: true }], f(x!), { pick: { buddy: y } })
      const order = a.battle.order
      expect(order[a.battle.turn]).toBe(cur)
      expect(order[a.battle.turn + 1]).toBe(y)
      expect(order.indexOf(x!)).toBeGreaterThan(a.battle.turn + 1)
      expect([...order].sort()).toEqual([...before].sort())
      expect(a.battle.units[y!]!.ap.now).toBe(1)
      // 反過來：y 是目標、x 是 with，結果一樣（誰是目標不影響誰被換到前面）
      const b = eight()
      b.battle.turn = 3
      go(b, [{ op: 'order', with: 'buddy', act_next: true }], f(y!), { pick: { buddy: x } })
      expect(b.battle.order[b.battle.turn + 1]).toBe(y)
      // 沒寫 act_next：只換順位，不接著動
      const c = eight()
      c.battle.turn = 3
      go(c, [{ op: 'order', with: 'buddy' }], f(x!), { pick: { buddy: y } })
      expect(c.battle.order[0]).toBe(y)
      expect(c.battle.order[c.battle.turn]).toBe(cur)
    })

    it('act_next：兩個人這一輪都動過了：只換順位（不會再輪一次），被換到前面的拿回 1 點；不寫 act_next 不拿', () => {
      const a = eight()
      a.battle.turn = 4
      const before = [...a.battle.order]
      const [, x, , y] = before
      a.battle.units[y!]!.ap.now = 0
      go(a, [{ op: 'order', with: 'buddy', act_next: true }], f(x!), { pick: { buddy: y } })
      expect(a.battle.order.slice(0, 6)).toEqual([before[0], y, before[2], x, before[4], before[5]])
      expect(a.battle.order[a.battle.turn]).toBe(before[4])
      expect(a.battle.units[y!]!.ap.now).toBe(1)
      const b = eight()
      const [, p, , , , q] = b.battle.order
      b.battle.units[q!]!.ap.now = 0
      go(b, [{ op: 'order', with: 'buddy' }], f(q!), { pick: { buddy: p } })
      expect(b.battle.units[q!]!.ap.now).toBe(0)
      expect(b.battle.order[1]).toBe(q)
    })
  })

  it('sink：沉溺加幾點；帶 save 而且過了檢定就不加', () => {
    const a = three()
    go(a, [{ op: 'sink', amount: 2 }], f('f1'))
    expect(a.foe(1).sink).toBe(2)
    go(a, [{ op: 'sink', amount: 'tier+1', save: { attr: 'resolve', skill: 'composure', dc: 12 } }], f('f1'), { d: dice(20), n: { tier: 2 } })
    expect(a.foe(1).sink).toBe(2)
    go(a, [{ op: 'sink', amount: 'tier+1', save: { attr: 'resolve', skill: 'composure', dc: 12 } }], f('f1'), { d: dice(1), n: { tier: 2 } })
    expect(a.foe(1).sink).toBe(5)
  })
})

describe('落在掛著的東西上：除了 strike、damage，其餘的 op 不丟錯、沒有作用', () => {
  it('每個 op 對一台掛著的東西都跳過（沒有拍、耐久與位置不變）', () => {
    const a = three()
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const list: Array<Record<string, unknown>> = [
      { op: 'attack' }, { op: 'load', amount: 5 }, { op: 'heal', amount: 5 }, { op: 'vent', amount: 5 }, { op: 'afterglow', amount: 1 },
      { op: 'status', status: 'suppressed' }, { op: 'status', status: 'suppressed', save: { attr: 'resolve', dc: 10 } }, { op: 'unstatus', status: 'suppressed' },
      { op: 'cleanse', by: 'first_aid' }, { op: 'check', attr: 'charm', vs: 10 }, { op: 'check', attr: 'charm', vs: 'will' }, { op: 'shift', dir: 'push' },
      { op: 'move', to: 'pick' }, { op: 'swap', with: 'buddy' }, { op: 'cover', levels: 1 }, { op: 'ap', amount: 1 }, { op: 'mag', amount: 'full' },
      { op: 'pool', pool: 'ram', amount: 1 }, { op: 'implant', mode: 'off' }, { op: 'revive' }, { op: 'wound', mode: 'clear' }, { op: 'out', how: 'fled' },
      { op: 'order', with: 'buddy' }, { op: 'sink', amount: 1 },
    ]
    for (const e of list) {
      const { run, last } = go(a, [e], { overlay: 'o1' }, { pick: { slot: 2, buddy: 'f2' } })
      expect(run.beats, String(e.op)).toEqual([])
      expect(last, String(e.op)).toEqual({})
    }
    expect(a.battle.overlays[0]).toMatchObject({ hp: { now: 20 }, slot: 1, down: false })
    expect(a.foe(1).slot).toBe(1)
  })
})

describe('wound_grade：重創的級數加減（features/combat 擲部位時問被打的人）', () => {
  const hit = (a: Arena, t: BattleUnit, part: string) => a.k.battle.emit('wound', { run: a.run(dice(5)), attacker: a.foe(1), target: t, aimed: false, part })

  it('−1：第二次打在同一個部位原本會變重，改成還是輕的；沒有修正就照常變重', () => {
    const a = three((k) => k.battle.modifier('t', (q) => (q.kind === 'wound_grade' && q.unit.id === 'a1' ? [{ label: '護具', value: -1 }] : [])))
    hit(a, a.ally(1), 'limb')
    hit(a, a.ally(1), 'limb')
    expect(a.ally(1).wounds).toEqual({ limb: 1 })
    expect(a.ally(1).statuses.find((s) => s.id === 'limb_hurt')!.data).toBeUndefined()
    hit(a, a.ally(2), 'limb')
    hit(a, a.ally(2), 'limb')
    expect(a.ally(2).wounds).toEqual({ limb: 2 })
    expect(a.ally(2).statuses.find((s) => s.id === 'limb_hurt')!.data).toEqual({ hit: -4 })
  })

  it('+1：第一次就是重的（要有重的那一級才行：敵人與存檔規則關掉重的時不能更重）', () => {
    const a = three((k) => k.battle.modifier('t', (q) => (q.kind === 'wound_grade' ? [{ label: '脆弱', value: 1 }] : [])))
    hit(a, a.ally(1), 'limb')
    expect(a.ally(1).wounds).toEqual({ limb: 2 })
    expect(a.ally(1).statuses.find((s) => s.id === 'limb_hurt')!.data).toEqual({ hit: -4 })
    hit(a, a.foe(2), 'limb')
    expect(a.foe(2).wounds).toEqual({ limb: 1 })
    a.state.rules.heavyWounds = false
    hit(a, a.ally(3), 'head')
    expect(a.ally(3).wounds).toEqual({ head: 1 })
  })

  it('−1 不會讓第一次的輕傷變成沒有傷（最少是輕的）', () => {
    const a = three((k) => k.battle.modifier('t', (q) => (q.kind === 'wound_grade' ? [{ label: '護具', value: -5 }] : [])))
    hit(a, a.ally(1), 'head')
    expect(a.ally(1).wounds).toEqual({ head: 1 })
  })
})

describe('格式檢查：欄位寫錯在載入時擋下，訊息裡有那個欄位', () => {
  const problems = (list: unknown) => three().k.battle.effectProblems(list)

  it('不認得的 type、公式寫錯、型別不對、不認得的欄位、缺少一定要寫的欄位，各一條寫出欄位名字的訊息', () => {
    expect(problems([{ op: 'attack', type: 'laser' }]).join()).toMatch(/type：.*laser/)
    expect(problems([{ op: 'heal', amount: '2d6+foo' }]).join()).toMatch(/amount：.*foo/)
    expect(problems([{ op: 'heal', amount: '2d6+foo' }])).toHaveLength(1)
    expect(problems([{ op: 'attack', dice: '1d6+x' }]).join()).toMatch(/dice：.*x/)
    expect(problems([{ op: 'attack', aimed: 'yes' }]).join()).toMatch(/aimed/)
    expect(problems([{ op: 'attack', spend: 'most' }]).join()).toMatch(/spend/)
    expect(problems([{ op: 'attack', as: { attr: 'tech' } }]).join()).toMatch(/as：.*skill/)
    expect(problems([{ op: 'attack', as: { attr: 'luck', skill: 'x' } }]).join()).toMatch(/as：.*attr/)
    expect(problems([{ op: 'attack', bonus: 3 }]).join()).toMatch(/不認得的欄位 bonus/)
    expect(problems([{ op: 'heal' }]).join()).toMatch(/amount：一定要寫/)
    expect(problems([{ op: 'status' }]).join()).toMatch(/status/)
    expect(problems([{ op: 'status', status: 'x', until: 'forever' }]).join()).toMatch(/until/)
    expect(problems([{ op: 'status', status: 'x', save: { attr: 'resolve' } }]).join()).toMatch(/save：.*dc/)
    expect(problems([{ op: 'status', status: 'x', data: { hit: 'lots' } }]).join()).toMatch(/data/)
    expect(problems([{ op: 'unstatus' }]).join()).toMatch(/status、kinds/)
    expect(problems([{ op: 'unstatus', kinds: ['good'] }]).join()).toMatch(/kinds/)
    expect(problems([{ op: 'load', amount: 5, type: 'em' }]).join()).toMatch(/type/)
    expect(problems([{ op: 'check', attr: 'charm', vs: 'luck' }]).join()).toMatch(/vs/)
    expect(problems([{ op: 'check', attr: 'charm', vs: { per_grade: 1 } }]).join()).toMatch(/vs：.*base/)
    expect(problems([{ op: 'check', vs: 3 }]).join()).toMatch(/attr：一定要寫/)
    expect(problems([{ op: 'shift', dir: 'sideways' }]).join()).toMatch(/dir/)
    expect(problems([{ op: 'move', to: 'anywhere' }]).join()).toMatch(/to/)
    expect(problems([{ op: 'cover', levels: 1, max: [1] }]).join()).toMatch(/max/)
    expect(problems([{ op: 'mag', amount: 'half' }]).join()).toMatch(/amount/)
    expect(problems([{ op: 'implant', mode: 'break' }]).join()).toMatch(/mode/)
    expect(problems([{ op: 'wound', mode: 'treat', part: 'tail' }]).join()).toMatch(/part/)
    expect(problems([{ op: 'out', how: 'down' }]).join()).toMatch(/how/)
    expect(problems([{ op: 'field', key: 'smoke' }]).join()).toMatch(/key/)
    expect(problems([{ op: 'strike', dice: 3, natural: 25 }]).join()).toMatch(/natural/)
    expect(problems([{ op: 'strike' }]).join()).toMatch(/dice/)
    expect(problems([{ op: 'order' }]).join()).toMatch(/with/)
    expect(problems([{ op: 'sink', amount: 1, save: { attr: 'resolve', dc: 'x' } }]).join()).toMatch(/save：.*dc/)
    expect(problems([{ op: 'cleanse' }]).join()).toMatch(/by、status/)
    expect(problems([{ op: 'soft_cover' }]).join()).toMatch(/kind/)
  })

  it('who 與 if 由核心查；寫對的整份清單合格（每個 op 至少一筆）', () => {
    expect(problems([{ op: 'heal', amount: 1, who: 'nobody' }]).join()).toMatch(/nobody/)
    expect(problems([{ op: 'heal', amount: 1, if: 'maybe' }]).join()).toMatch(/maybe/)
    expect(problems([
      { op: 'attack', hit: 1, dice: 'spent+-1', damage: '1d6', pierce: 1, type: 'em', aimed: true, spend: 'all', cover_shift: 1, cover_mult_min: 1, no_cover: true, no_wound: true, auto_crit: true, armor_mult: 2, as: { attr: 'tech', skill: 'cyberware' }, label: '重擊', tags: ['skill'] },
      { op: 'strike', dice: 'tier+1', type: 'physical', hit: 4, range: [1, 7], pierce: 0, cover_mult: 0.25, natural: true, label: '投擲', traits: ['blast'], who: 'area' },
      { op: 'damage', amount: '2d6', type: 'thermal', pierce: 1 }, { op: 'load', amount: 4, type: 'pleasure', exact: true }, { op: 'heal', amount: 'half_tier_up' }, { op: 'vent', amount: 4 },
      { op: 'afterglow', amount: -1 }, { op: 'afterglow', layers: 1 }, { op: 'status', status: 'marked', turns: 2, until: 'source_turn_end', data: { hit: -1 }, save: { attr: 'resolve', skill: 'composure', dc: '10+tier', tags: ['hack'] } },
      { op: 'unstatus', status: 'marked' }, { op: 'unstatus', kinds: ['debuff', 'control'], count: 2 }, { op: 'cleanse', by: 'first_aid' }, { op: 'soft_cover', kind: 'smoke', rounds: 2 },
      { op: 'check', attr: 'intellect', skill: 'hacking', vs: 'firewall', bonus: 2, tags: ['quickhack'], label: '快駭', stop: true }, { op: 'check', attr: 'charm', vs: { base: 10, per_grade: 2, elite: 2, boss: 4 } },
      { op: 'shift', dir: 'push', n: 2 }, { op: 'move', to: 'adjacent' }, { op: 'swap', with: 'buddy' }, { op: 'cover', levels: -1, max: [10, 20] }, { op: 'ap', amount: 1, over_cap: true },
      { op: 'mag', amount: 'full', over_cap: true }, { op: 'pool', pool: 'ram', amount: 'full' }, { op: 'implant', mode: 'boost', kind: 'eye', turns: 2, until: 'own_turn_start' },
      { op: 'revive', hp: 5 }, { op: 'wound', mode: 'treat', part: 'limb' }, { op: 'out', how: 'fled' }, { op: 'field', key: 'dark', value: true }, { op: 'order', with: 'buddy', act_next: true },
      { op: 'sink', amount: 1, save: { attr: 'resolve', skill: 'composure', dc: 12 } },
    ])).toEqual([])
  })

  it('道具的 use.effects 在 ready 時用同一個函式查：寫錯的欄位擋下，訊息有道具與欄位', () => {
    const load = (effects: unknown[]) => {
      const k = createKernel([combatFeature])
      k.content.loadPack({ id: 'x', content: { battle_status: TEST_STATUSES, item: [ITEM('it_bad', { use: { ap: 1, target: 'self', effects } })] } })
      return () => readyFeatures(k)
    }
    expect(load([{ op: 'attack', type: 'laser' }])).toThrow(/item\/it_bad：.*type/)
    expect(load([{ op: 'heal', amount: '2d6+foo' }])).toThrow(/item\/it_bad：.*amount.*foo/)
    expect(load([{ op: 'heal', amount: '2d6+1' }, { op: 'afterglow', layers: -1 }])).not.toThrow()
  })
})

describe('一整串效果：技能與道具都寫成 [{ op, ... }]', () => {
  it('例：連射（attack 花光彈匣 + 壓制檢定）一串做完，上一筆的結果與 spent 往下傳', () => {
    const a = three()
    const smg = a.ally(2)
    const run = a.run(dice(15, ...Array(10).fill(3), 1))
    const last: BattleEffectLast = run.effects([
      { op: 'attack', spend: 'all', dice: 'spent+-1', label: '連射' },
      { op: 'status', status: 'suppressed', save: { attr: 'resolve', skill: 'composure', dc: '10+spent*2', tags: ['resist:suppressed'] } },
    ], { user: smg, target: f('f1'), source: SKILL })
    expect(last.hit).toBe(true)
    expect(rolls(run).find((r) => r.dc === 16)).toBeTruthy()
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['suppressed'])
    expect(testWeapon('smg', 1).mag!.max).toBe(3)
  })
})
