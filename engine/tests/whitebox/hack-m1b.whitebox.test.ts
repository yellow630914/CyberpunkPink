// 白箱測試：features/hack（M1b 快駭：甲板與 RAM、內容種類 quickhack 的格式、快駭程式變成的行動、檢定、持續型、接管與改寫、控制節點、引爆）。
// 補主套件沒有走到的分支與錯誤路徑；每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。
// 會失敗（和規格不一致）的寫在 tests/pending/ 與 dev/bugs/，這裡只放現在就對的行為。內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOverlay, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, beginTurn, performAction, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { gradeFor, shapeAt, isExplosive } from '../../src/features/hack/actions'
import { GRADE_CHECK, canHack, cyberCount, deckOf, levelOfTier, runLevel, treeTier } from '../../src/features/hack/deck'
import type { QuickhackEntry } from '../../src/features/hack/kinds'
import { B, F, S, isInt, oneOf, schema } from '../../src/features/hack/schema'
import { hackFeature } from '../../src/features/hack'
import { testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const dice = (...v: number[]): number[] => [...v, ...Array(150).fill(1)]
const ITEM = (id: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const prog = (id: string, cls: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, class: cls, grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'load', amount: 4, type: 'neural' }], ...more })
const PROGRAMS: Rec[] = [
  prog('qh_noise', 'neural'),
  prog('qh_take', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', turns: 2 }] }),
  prog('qh_take_end', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', until: 'battle_end' }] }),
  prog('qh_rewrite', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', mode: 'rewrite' }] }),
  prog('qh_rewrite_end', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', mode: 'rewrite', until: 'battle_end' }] }),
  prog('qh_node', 'device', { ram: 2, target: 'node', do: [{ op: 'hack.node' }] }),
  prog('qh_boom', 'device', { ram: 2, do: [{ op: 'hack.detonate' }] }),
  prog('qh_boom_by_grade', 'device', { ram: 2, do: [{ op: 'status', status: 'jammed' }], by_grade: { '3': { do: [{ op: 'hack.detonate' }] } } }),
  prog('qh_blind', 'cyberware', { do: [{ op: 'implant', mode: 'off', kind: 'eye', turns: 2 }] }),
  prog('qh_support', 'support', { ram: 1, target: 'ally', do: [{ op: 'vent', amount: 5 }] }),
  prog('qh_ctrl', 'control', { ram: 2, do: [{ op: 'status', status: 'jammed' }] }),
  prog('qh_free_ram', 'device', { ram: 0, do: [{ op: 'status', status: 'jammed' }] }),
  prog('qh_by_grade_ap', 'device', { grades: [1, 2], by_grade: { '2': { ap: 3, bonus: 2 } }, do: [{ op: 'status', status: 'jammed' }] }),
]
const PACK: ContentPack = {
  id: 'wb_hack_m1b',
  content: {
    skill: [{ id: 'interface', name: '介面', attr: 'intellect', desc: '快駭與管理行動的介面。' }],
    battle_status: [...TEST_STATUSES, { id: 'off_generic', name: '義體失效', desc: '義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' }],
    item: [ITEM('it_nade', { name: '破片手雷', tags: ['explosive'] }), ITEM('it_gel', { name: '凝膠', tags: ['medical'] })],
    quickhack: PROGRAMS,
  },
} as unknown as ContentPack
const quiet = { ap: { now: 0, max: 0, regen: 0 } }
const ALL = PROGRAMS.map((p) => p.id as string)
const hacker = (slots: string[] = ALL, o: Rec = {}, deck: Rec = {}) => one({
  tags: ['quickhack'], attrs: { body: 10, reflex: 15, tech: 10, intellect: 14, resolve: 12, charm: 10 }, skills: { interface: 3, firearms: 2, composure: 1 },
  ap: { now: 30, max: 30, regen: 3 }, pools: { ram: { now: 60, max: 60, regen: 2 } },
  ext: { deck: { grade: 3, firewall: 12, slots, ...deck }, abilities: { equipped: [], tiers: { netrunner: 2 } } }, ...o,
} as never)
const idle = (o: Rec = {}) => foe('minion', { ...quiet, ...o } as never)
const FEATURES = [combatFeature, hackFeature]
function world(o: { allies?: unknown[]; foes?: unknown[]; more?: Rec; packs?: ContentPack[] } = {}): Arena {
  return arena(duel(o.allies ?? [hacker(), one({ weapon: 'pistol' }, 2)], o.foes ?? [idle(), idle()], undefined, o.more as never), FEATURES, (k: Kernel) => {
    k.content.loadPack(PACK)
    for (const p of o.packs ?? []) k.content.loadPack(p)
    readyFeatures(k)
  })
}
const cast = (a: Arena, action: string, target: BattleTarget | null, o: { d?: number[]; user?: string; pick?: Rec } = {}) => {
  const run = a.run(o.d ?? dice(15))
  const def = a.k.battle.getAction(action)!
  const input: BattleInput = { action, ...(target ? { target } : {}), ...(o.pick ? { pick: o.pick } : {}) }
  performAction(run, run.unit(o.user ?? 'a1'), def, target, input)
  return run
}
const U = (id: string): BattleTarget => ({ unit: id })
const overlay = (a: Arena, o: Partial<BattleOverlay> = {}): BattleOverlay =>
  a.run().addOverlay({ side: 'foe', slot: 2, kind: 'turret', name: '蜘蛛砲台', hp: { now: 20, max: 20 }, armor: 1, evade: 5, weapon: testWeapon('pistol', 30), auto: true, autonomous: true, ...o })
const err = (fn: () => void): string => {
  try { fn() } catch (e) { return e instanceof BattleBlocked ? e.reasons.join('') : (e as Error).message }
  return ''
}
const loadErr = (entry: Rec): string => err(() => world({ packs: [{ id: 'bad', content: { quickhack: [entry] } } as unknown as ContentPack] }))

// =====================================================================================================================
// 內容種類 quickhack 的格式檢查（DATA 7.5；features/hack/kinds.ts）
// =====================================================================================================================

describe('白箱 quickhack 的格式檢查（DATA 7.5 節；載入時擋下，訊息有欄位名）', () => {
  const ok = prog('qh_ok', 'neural')

  it('寫對的合格（含 needs、by_grade、bonus 與收下不讀的 trace、legal、price、script_twin、brand）', () => {
    expect(loadErr({ ...ok, needs: { bridged: true }, bonus: '1+1', by_grade: { '2': { ram: 3, ap: 2, bonus: 1, do: [{ op: 'load', amount: 5, type: 'neural' }] } }, trace: 1, legal: 'illegal', price: 100, script_twin: 'x', brand: 'y' })).toBe('')
  })

  it('name 與 desc 缺了、class、grades、ram、ap、target 寫錯各一條：訊息指出欄位', () => {
    expect(loadErr({ ...ok, name: ' ' })).toMatch(/要有 name/)
    expect(loadErr({ ...ok, desc: undefined })).toMatch(/要有 desc/)
    expect(loadErr({ ...ok, class: 'magic' })).toMatch(/class 只能是/)
    expect(loadErr({ ...ok, grades: [] })).toMatch(/grades 要是一到四個/)
    expect(loadErr({ ...ok, grades: [1, 1] })).toMatch(/grades 不能有重複/)
    expect(loadErr({ ...ok, grades: [5] })).toMatch(/grades 要是一到四個/)
    expect(loadErr({ ...ok, ram: -1 })).toMatch(/ram 要是 0 以上的整數/)
    expect(loadErr({ ...ok, ap: 4 })).toMatch(/ap 要是 0～3 的整數/)
    expect(loadErr({ ...ok, target: 'moon' })).toMatch(/target 只能是/)
    expect(loadErr({ ...ok, zzz: 1 })).toMatch(/zzz 不是可以用的鍵/)
  })

  it('needs：不是物件、不認得的鍵、值不是布林、目標不是敵人或敵方掛著的東西都擋下；do 不是陣列或空的、do 裡的 op 查不到都擋下', () => {
    expect(loadErr({ ...ok, needs: 'x' })).toMatch(/needs 要是物件/)
    expect(loadErr({ ...ok, needs: { fast: true } })).toMatch(/needs\.fast 不是可以用的鍵/)
    expect(loadErr({ ...ok, needs: { bridged: 'yes' } })).toMatch(/needs\.bridged 要是 true 或 false/)
    expect(loadErr({ ...ok, target: 'ally', needs: { bridged: true } })).toMatch(/needs 只對目標是敵人/)
    expect(loadErr({ ...ok, do: [] })).toMatch(/do 要是效果的陣列/)
    expect(loadErr({ ...ok, do: 'x' })).toMatch(/do 要是效果的陣列/)
    expect(loadErr({ ...ok, do: [{ op: 'nope' }] })).toMatch(/do：.*不認得的效果 nope/)
    expect(loadErr({ ...ok, bonus: 'bogus' })).toMatch(/bonus：/)
  })

  it('by_grade：不是物件、級不在 1～4、沒有這一級、值不是物件、不能蓋掉的欄位、ram／ap／bonus／do 寫錯各一條', () => {
    expect(loadErr({ ...ok, by_grade: 'x' })).toMatch(/by_grade 要是/)
    expect(loadErr({ ...ok, by_grade: { '5': {} } })).toMatch(/by_grade\.5：級只能是 1～4/)
    expect(loadErr({ ...ok, grades: [1, 2], by_grade: { '3': {} } })).toMatch(/by_grade\.3：這支程式沒有這一級（grades 是 1、2）/)
    expect(loadErr({ ...ok, by_grade: { '2': 5 } })).toMatch(/by_grade\.2 要是物件/)
    expect(loadErr({ ...ok, by_grade: { '2': { target: 'self' } } })).toMatch(/by_grade\.2\.target 不是可以蓋掉的欄位/)
    expect(loadErr({ ...ok, by_grade: { '2': { ram: -2 } } })).toMatch(/by_grade\.2\.ram 要是 0 以上的整數/)
    expect(loadErr({ ...ok, by_grade: { '2': { ap: 9 } } })).toMatch(/by_grade\.2\.ap 要是 0～3 的整數/)
    expect(loadErr({ ...ok, by_grade: { '2': { bonus: 'bogus' } } })).toMatch(/by_grade\.2\.bonus：/)
    expect(loadErr({ ...ok, by_grade: { '2': { do: [] } } })).toMatch(/by_grade\.2\.do 要是效果的陣列/)
    expect(loadErr({ ...ok, by_grade: { '2': { do: [{ op: 'nope' }] } } })).toMatch(/by_grade\.2\.do：/)
  })

  it('schema.ts 的小檢查：F、S、B、oneOf、isInt；schema 略過 op、who、if、略過 undefined 的欄位、擋不認得的欄位與缺少的必填', () => {
    expect(F('2d6')).toBeNull()
    expect(F('bogus')).toMatch(/不認得的項/)
    expect(S('x')).toBeNull()
    expect(S('')).toMatch(/字串/)
    expect(S(3)).toMatch(/字串/)
    expect(B(false)).toBeNull()
    expect(B(0)).toMatch(/true 或 false/)
    expect(oneOf(['a'])('b')).toMatch(/「b」不在清單裡/)
    expect(isInt(3)).toBe(true)
    expect(isInt(3.5)).toBe(false)
    expect(isInt('3')).toBe(false)
    const sc = schema({ x: F }, ['x'])
    expect(sc({ op: 'o', who: 'self', if: 'hit', x: 1 })).toEqual([])
    expect(sc({ x: undefined })).toEqual(['x：一定要寫'])
    expect(sc({ x: 1, q: 1 })[0]).toMatch(/不認得的欄位 q/)
  })

  it('各個 op 自己的格式檢查（載入時擋下）：hack.check 的 class 與 grade、hack.dot 缺 amount 或 turns、hack.takeover 的 until 與 mode、hack.detonate 的 cover', () => {
    const k = world().k
    const p = (list: Rec[]) => k.battle.effectProblems(list).join('｜')
    expect(p([{ op: 'hack.check', class: 'magic' }])).toMatch(/class：/)
    expect(p([{ op: 'hack.check', grade: 5 }])).toMatch(/grade：要是 1～4 的整數/)
    expect(p([{ op: 'hack.check', grade: 2.5 }])).toMatch(/grade：/)
    expect(p([{ op: 'hack.check', class: 'neural', grade: 2, bonus: 1, stop: true }])).toBe('')
    expect(p([{ op: 'hack.dot' }])).toMatch(/amount：一定要寫.*turns：一定要寫/)
    expect(p([{ op: 'hack.takeover', until: 'never' }])).toMatch(/until：/)
    expect(p([{ op: 'hack.takeover', mode: 'swap' }])).toMatch(/mode：/)
    expect(p([{ op: 'hack.detonate', cover: 3 }])).toMatch(/cover：要是 1 或 2/)
    expect(p([{ op: 'hack.detonate', cover: 1.5 }])).toMatch(/cover：/)
    expect(p([{ op: 'hack.detonate', dice: '2d6', type: 'thermal', cover: 2 }])).toBe('')
    expect(p([{ op: 'hack.node', x: 1 }])).toMatch(/不認得的欄位 x/)
  })
})

// =====================================================================================================================
// 甲板與主控（NETRUNNING 第 1 節；ITEMS 11.9；features/hack/deck.ts）
// =====================================================================================================================

describe('白箱 甲板與主控的讀法（deck.ts）', () => {
  const u = (ext: Rec = {}, o: Rec = {}): BattleUnit => ({ ...structuredClone(one(o as never)), tags: [], ext, ...o }) as unknown as BattleUnit

  it('deckOf：沒有或 grade 不是有限數字回 undefined；grade 取整並至少 1；firewall 壞了當 10；slots 只收字串；tree 空字串不算', () => {
    expect(deckOf(u())).toBeUndefined()
    expect(deckOf(u({ deck: 'x' }))).toBeUndefined()
    expect(deckOf(u({ deck: { grade: Number.NaN } }))).toBeUndefined()
    expect(deckOf(u({ deck: { grade: '3' } }))).toBeUndefined()
    expect(deckOf(u({ deck: { grade: 0.4 } }))).toEqual({ grade: 1, firewall: 10, slots: [] })
    expect(deckOf(u({ deck: { grade: 2.9, firewall: Number.POSITIVE_INFINITY, slots: ['a', 5, null, 'b'], tree: '' } }))).toEqual({ grade: 2, firewall: 10, slots: ['a', 'b'] })
    expect(deckOf(u({ deck: { grade: 2, firewall: 14, slots: 'a', tree: 'ghost' } }))).toEqual({ grade: 2, firewall: 14, slots: [], tree: 'ghost' })
  })

  it('treeTier：讀 ext.abilities.tiers[樹]（甲板的 tree 換樹）夾在 1～5；讀不到時敵人用自己的等級（夾 1～5），其他當 1', () => {
    expect(treeTier(u({ deck: { grade: 1 }, abilities: { tiers: { netrunner: 9 } } }))).toBe(5)
    expect(treeTier(u({ deck: { grade: 1 }, abilities: { tiers: { netrunner: 0 } } }))).toBe(1)
    expect(treeTier(u({ deck: { grade: 1, tree: 'ghost' }, abilities: { tiers: { netrunner: 4, ghost: 3 } } }))).toBe(3)
    expect(treeTier(u({ deck: { grade: 1 }, abilities: { tiers: { netrunner: 'x' } } }))).toBe(1)
    expect(treeTier(u({ deck: { grade: 1 }, abilities: 5 }))).toBe(1)
    const enemy = { ...u({ deck: { grade: 1 } }), enemy: 'en_x', grade: 3 } as BattleUnit
    expect(treeTier(enemy)).toBe(3)
    expect(treeTier({ ...enemy, grade: 9 } as BattleUnit)).toBe(5)
    expect(treeTier({ ...enemy, grade: Number.NaN } as BattleUnit)).toBe(1)
    expect(treeTier({ ...enemy, grade: 0 } as BattleUnit)).toBe(1)
  })

  it('levelOfTier、runLevel、canHack、cyberCount、GRADE_CHECK：階對照等級、與甲板取低；沒有甲板 0；義體數優先看 cyber、再看 implants', () => {
    expect([1, 2, 3, 4, 5].map(levelOfTier)).toEqual([1, 2, 3, 4, 4])
    expect(levelOfTier(0)).toBe(1)
    expect(runLevel(u())).toBe(0)
    expect(runLevel(u({ deck: { grade: 2 }, abilities: { tiers: { netrunner: 4 } } }))).toBe(2)
    expect(runLevel(u({ deck: { grade: 4 }, abilities: { tiers: { netrunner: 3 } } }))).toBe(3)
    expect(canHack({ ...u({ deck: { grade: 1 } }), tags: ['quickhack'] } as BattleUnit)).toBe(true)
    expect(canHack({ ...u({ deck: { grade: 1 } }), tags: [] } as BattleUnit)).toBe(false)
    expect(canHack({ ...u(), tags: ['quickhack'] } as BattleUnit)).toBe(false)
    expect(cyberCount({ cyber: 3, implants: [{}] } as never)).toBe(3)
    expect(cyberCount({ implants: [{}, {}] } as never)).toBe(2)
    expect(cyberCount({} as never)).toBe(0)
    expect(GRADE_CHECK).toEqual({ 1: 0, 2: 1, 3: 1, 4: 2 })
  })

  it('gradeFor 與 shapeAt：沒有那一級用它有的最高一級；不到最低一級是 null；支援類一律 0 點行動點；by_grade 蓋掉 ram、ap、do、bonus', () => {
    const e = { id: 'x', name: 'x', desc: 'x', class: 'neural', grades: [1, 3], ram: 2, ap: 2, target: 'foe', do: [{ op: 'a' }], by_grade: { '3': { ram: 5, ap: 1, do: [{ op: 'b' }], bonus: 2 } } } as unknown as QuickhackEntry
    expect(gradeFor(e, 0)).toBeNull()
    expect(gradeFor(e, 1)).toBe(1)
    expect(gradeFor(e, 2)).toBe(1)
    expect(gradeFor(e, 4)).toBe(3)
    expect(shapeAt(e, 1)).toEqual({ ram: 2, ap: 2, do: [{ op: 'a' }], bonus: 0 })
    expect(shapeAt(e, 3)).toEqual({ ram: 5, ap: 1, do: [{ op: 'b' }], bonus: 2 })
    expect(shapeAt({ ...e, class: 'support' } as QuickhackEntry, 1).ap).toBe(0)
    expect(shapeAt({ ...e, ap: undefined } as QuickhackEntry, 1).ap).toBe(1)
  })
})

// =====================================================================================================================
// 快駭程式變成的行動
// =====================================================================================================================

describe('白箱 快駭行動的條件、費用與目標（actions.ts；ITEMS 11.9）', () => {
  const def = (a: Arena, id: string) => a.k.battle.getAction(`hack.${id}`)!

  it('沒有甲板丟 BattleBlocked 並寫出「沒有甲板」；樹階不夠、甲板不夠各寫出自己的原因（含樹階與甲板等級的羅馬數字）', () => {
    const a = world({ allies: [hacker(['qh_ctrl'], { ext: { deck: { grade: 3, slots: ['qh_ctrl'] }, abilities: { tiers: { netrunner: 1 } } } }), one({}, 2)] })
    const run = a.run(dice(15))
    const mk = (id: string, grades: number[]) => ({ ...(PROGRAMS.find((p) => p.id === id) as object), grades }) as unknown as QuickhackEntry
    void mk
    const noDeck = world({ allies: [one({ tags: ['quickhack'] }), one({}, 2)] })
    expect(def(noDeck, 'qh_noise').blocks!(noDeck.run(), noDeck.ally(1))).toEqual(['沒有甲板，跑不了快駭程式。'])
    expect(() => def(noDeck, 'qh_noise').run(noDeck.run(), noDeck.ally(1), U('f1'), { action: 'hack.qh_noise' } as never)).toThrow(/沒有甲板/)
    // 程式最低 II 級：樹階 1 → 跑得動 I 級
    const high = world({ packs: [{ id: 'g2', content: { quickhack: [prog('qh_g2', 'device', { grades: [2, 3] })] } } as never], allies: [hacker(['qh_g2'], { ext: { deck: { grade: 3, slots: ['qh_g2'] }, abilities: { tiers: { netrunner: 1 } } } }), one({}, 2)] })
    expect(def(high, 'qh_g2').blocks!(high.run(), high.ally(1))).toEqual(['qh_g2最低要跑 II 級，主控的樹階只到 1 階（跑得動 I 級）。'])
    // 樹階夠、甲板 I 級
    const low = world({ packs: [{ id: 'g2', content: { quickhack: [prog('qh_g2', 'device', { grades: [2, 3] })] } } as never], allies: [hacker(['qh_g2'], {}, { grade: 1 }), one({}, 2)] })
    expect(def(low, 'qh_g2').blocks!(low.run(), low.ally(1))).toEqual(['qh_g2最低要跑 II 級，甲板只有 I 級。'])
    expect(run).toBeDefined()
  })

  it('費用：RAM 是 0 的程式不帶 ram 欄位；by_grade 的 ap 蓋掉（支援類不看）；甲板與樹階低的人顯示最低一級的費用', () => {
    const a = world()
    const run = a.run()
    expect(def(a, 'qh_free_ram').cost(run, a.ally(1), undefined as never)).toEqual({ ap: 1 })
    expect(def(a, 'qh_noise').cost(run, a.ally(1), undefined as never)).toEqual({ ap: 1, ram: 2 })
    expect(def(a, 'qh_support').cost(run, a.ally(1), undefined as never)).toEqual({ ap: 0, ram: 1 })
    // 樹階 2、甲板 3 → 跑 II 級：by_grade 2 的 ap 3
    expect(def(a, 'qh_by_grade_ap').cost(run, a.ally(1), undefined as never)).toEqual({ ap: 3, ram: 2 })
  })

  it('目標的條件：機器只吃裝置與控制類、machine 只打機器、義體類要有那一類的義體、控制類要先標記、引爆（含 by_grade 裡的）要有爆裂物；每一條一句話', () => {
    const a = world({ foes: [idle({ tags: ['machine'], implants: [{ kind: 'arm', name: '義臂' }] }), idle({ implants: [{ kind: 'arm', name: '義臂' }], quick: [{ item: 'it_nade', qty: 1 }] }), idle()] })
    const blocks = (id: string, target: string) => def(a, id).targets!(a.run(), a.ally(1)).find((t) => (t.target as { unit: string }).unit === target)!.blocks
    expect(blocks('qh_noise', 'f1')).toContain('保全是機器，只吃裝置與控制類的快駭。')
    expect(blocks('qh_blind', 'f2')).toEqual(['保全身上沒有eye類的義體。'])
    expect(blocks('qh_blind', 'f3')).toEqual(['保全身上沒有義體可以打。'])
    expect(blocks('qh_ctrl', 'f2')).toEqual(['保全身上還沒有標記：控制類的快駭要先標記他。'])
    expect(blocks('qh_boom', 'f1')).toEqual(['保全的快取格裡沒有爆裂物可以引爆。'])
    expect(blocks('qh_boom', 'f2')).toEqual([])
    expect(blocks('qh_boom_by_grade', 'f1')).toEqual(['保全的快取格裡沒有爆裂物可以引爆。'])
    expect(isExplosive(a.run(), 'it_nade')).toBe(true)
    expect(isExplosive(a.run(), 'it_gel')).toBe(false)
    expect(isExplosive(a.run(), 'ghost')).toBe(false)
  })

  it('目標：隊友類列場上其他隊友（不含自己）；敵方掛著的東西略過已擊落的，接管（不是改寫）時我方同一格已掛著別台就灰掉；節點已經拿下的灰掉（只有會拿節點的程式）', () => {
    const a = world({ more: { nodes: [{ kind: 'relay', name: '中繼站' }, { kind: 'relay', name: '備援站' }] } })
    expect(def(a, 'qh_support').targets!(a.run(), a.ally(1)).map((t) => t.target)).toEqual([U('a2')])
    const o1 = overlay(a, { slot: 1 })
    const o2 = overlay(a, { slot: 2, name: '舊砲台' })
    o2.down = true
    const t1 = def(a, 'qh_take').targets!(a.run(), a.ally(1))
    expect(t1.map((t) => t.target)).toEqual([{ overlay: o1.id }])
    expect(t1[0]!.blocks).toEqual([])
    a.run().addOverlay({ side: 'ally', slot: 1, kind: 'drone', name: '我的無人機', hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    expect(def(a, 'qh_take').targets!(a.run(), a.ally(1))[0]!.blocks).toEqual(['我方第 1 格已經掛著一台了，接管來的蜘蛛砲台沒有地方放。'])
    expect(def(a, 'qh_rewrite').targets!(a.run(), a.ally(1))[0]!.blocks).toEqual([])
    expect(def(a, 'qh_noise').targets!(a.run(), a.ally(1)).map((t) => (t.target as { unit: string }).unit)).toEqual(['f1', 'f2'])
    const nodes = a.battle.nodes
    expect(nodes).toHaveLength(2)
    nodes[0]!.taken = true
    const nt = def(a, 'qh_node').targets!(a.run(), a.ally(1))
    expect(nt.map((t) => t.blocks.length)).toEqual([1, 0])
    expect(nt[0]!.blocks[0]).toContain('已經拿下了')
    // 不拿節點的程式不灰掉
    expect(def(a, 'qh_noise').targets!(a.run(), a.ally(1)).every((t) => t.blocks.length === 0 || 'unit' in t.target)).toBe(true)
  })

  it('支援類每回合只能一次（用過再用灰掉，下回合開始解除）；支援類與對自己、隊友用的不必檢定（不擲骰，RAM 照扣）', () => {
    const a = world()
    const me = a.ally(1)
    const ram = me.pools.ram!.now
    const run = cast(a, 'hack.qh_support', U('a2'))
    expect(run.beats.filter((b) => b.roll)).toHaveLength(0)
    expect(me.pools.ram!.now).toBe(ram - 1)
    expect(def(a, 'qh_support').blocks!(a.run(), me)).toEqual(['支援類的快駭每回合只能用一次。'])
    beginTurn(a.run(dice(10)), me)
    expect(def(a, 'qh_support').blocks!(a.run(), me)).toEqual([])
  })
})

// =====================================================================================================================
// 效果：檢定、持續型、接管、節點、引爆
// =====================================================================================================================

describe('白箱 快駭的效果（ops.ts；NETRUNNING 2、COMBAT_SYSTEM 2.4；dev/adr/0015 E5、E9）', () => {
  const eff = (a: Arena, list: Rec[], target?: BattleTarget, o: { user?: BattleUnit; d?: number[]; n?: Record<string, number>; source?: { kind: 'hack'; id: string; name: string } } = {}) => {
    const run = a.run(o.d ?? dice(15))
    const last = run.effects(list, { user: o.user ?? a.ally(1), ...(target ? { target } : {}), source: o.source ?? { kind: 'hack', id: 'qh_test', name: '測試程式' }, ...(o.n ? { n: o.n } : {}) })
    return { run, last }
  }

  it('hack.check：沒寫 class 就沒有 hack:<類> 標籤、沒寫 grade 當 I 級（加值 0）；沒過而且沒寫 stop 就不停（後面的照做）；對自己、一格沒有東西可以對，直接算過', () => {
    const a = world()
    const seen: string[][] = []
    a.k.battle.modifier('t', (q) => { if (q.kind === 'hit') return []; seen.push(q.tags); return [] })
    const r = eff(a, [{ op: 'hack.check' }, { op: 'vent', who: 'self', amount: 0 }], U('f1'), { d: dice(1) })
    expect(r.last.ok).toBe(false)
    expect(r.run.beats.some((b) => b.text.includes('沒有效果（RAM 已經花掉了）'))).toBe(true)
    expect(r.last.stop).toBeUndefined()
    expect(seen.some((t) => t.includes('hack') && t.includes('quickhack') && !t.some((x) => x.startsWith('hack:')))).toBe(true)
    const withStop = eff(a, [{ op: 'hack.check', class: 'neural', stop: true }], U('f1'), { d: dice(1) })
    expect(withStop.last.stop).toBe(true)
    expect(eff(a, [{ op: 'hack.check' }], U('a1')).last.ok).toBe(true)
    expect(eff(a, [{ op: 'hack.check' }], { side: 'foe', slot: 1 }).last.ok).toBe(true)
    expect(eff(a, [{ op: 'hack.check' }]).last.ok).toBe(true)
  })

  it('hack.check 對控制節點：防火牆是節點自己的 ext.firewall，沒寫是 10；目標不是節點也不是人就算過；點到掛著的東西對它的迴避', () => {
    const a = world({ more: { nodes: [{ kind: 'relay', name: '中繼站' }] } })
    const node = a.battle.nodes[0]!
    node.ext = { firewall: 17 }
    const r1 = eff(a, [{ op: 'hack.check', class: 'device' }], { node: node.id }, { d: dice(10) })
    expect(r1.run.beats.find((b) => b.roll)!.roll!.dc).toBe(17)
    delete node.ext
    const r2 = eff(a, [{ op: 'hack.check', class: 'device' }], { node: node.id }, { d: dice(10) })
    expect(r2.run.beats.find((b) => b.roll)!.roll!.dc).toBe(10)
    node.ext = { firewall: 'x' }
    expect(eff(a, [{ op: 'hack.check' }], { node: node.id }, { d: dice(10) }).run.beats.find((b) => b.roll)!.roll!.dc).toBe(10)
    const o = overlay(a, { evade: 9 })
    const r3 = eff(a, [{ op: 'hack.check', class: 'device' }], { overlay: o.id }, { d: dice(10) })
    expect(r3.run.beats.find((b) => b.roll)!.roll!.dc).toBe(9)
  })

  it('hack.dot：對沒有橋的人無效並記一句；對退出的人沒有作用；新的蓋掉舊的（話裡說蓋掉了誰）；樹階沒給當 0；到期的那一次結算完就拿掉', () => {
    const a = world({ foes: [idle({ load: undefined }), idle()] })
    const nobridge = eff(a, [{ op: 'hack.dot', amount: 3, turns: 2 }], U('f1'))
    expect(nobridge.last.ok).toBe(false)
    expect(nobridge.run.beats.some((b) => b.text.includes('沒有橋'))).toBe(true)
    a.battle.units.f2!.out = 'down'
    expect(eff(a, [{ op: 'hack.dot', amount: 3, turns: 2 }], U('f2')).run.beats).toEqual([])
    a.battle.units.f2!.out = undefined
    delete a.battle.units.f2!.out
    eff(a, [{ op: 'hack.dot', amount: 2, turns: 1 }], U('f2'), { source: { kind: 'hack', id: 'a', name: '迴圈甲' } })
    const over = eff(a, [{ op: 'hack.dot', amount: '1d4', turns: 0 }], U('f2'), { source: { kind: 'hack', id: 'b', name: '迴圈乙' } })
    expect(over.run.beats.at(-1)!.text).toContain('蓋掉了迴圈甲')
    expect(over.run.beats.at(-1)!.text).toContain('之後 1 個回合')
    const dot = (a.battle.units.f2!.ext.hack as Rec).dot as Rec
    expect(dot.tier).toBe(0)
    const before = a.battle.units.f2!.load!.now
    beginTurn(a.run(dice(3)), a.battle.units.f2!)
    expect(a.battle.units.f2!.load!.now).toBeGreaterThan(before)
    expect((a.battle.units.f2!.ext.hack as Rec).dot).toBeUndefined()
  })

  it('hack.dot 結算時下 dot 的人已經不在 battle.units（沒有 by）：以受感載的人自己當做的人算公式，仍加感載（不丟錯）', () => {
    const a = world()
    eff(a, [{ op: 'hack.dot', amount: 5, turns: 2 }], U('f1'))
    ;((a.battle.units.f1!.ext.hack as Rec).dot as Rec).by = 'ghost'
    const before = a.battle.units.f1!.load!.now
    beginTurn(a.run(dice(3)), a.battle.units.f1!)
    expect(a.battle.units.f1!.load!.now).toBeGreaterThan(before)
  })

  it('hack.takeover：落在已經擊落的、我方的東西上沒有作用；已經被接管的不能再接管（ok: false）；我方同一格掛著別台時接管不了；rewrite 到戰鬥結束的話不一樣', () => {
    const a = world()
    const down = overlay(a, { slot: 1 })
    down.down = true
    expect(eff(a, [{ op: 'hack.takeover' }], { overlay: down.id }).run.beats).toEqual([])
    const mine = a.run().addOverlay({ side: 'ally', slot: 3, kind: 'drone', name: '我的無人機', hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    expect(eff(a, [{ op: 'hack.takeover' }], { overlay: mine.id }).run.beats).toEqual([])
    const t = overlay(a, { slot: 2 })
    expect(eff(a, [{ op: 'hack.takeover', turns: 2 }], { overlay: t.id }).last.ok).toBe(true)
    expect(t.side).toBe('ally')
    // 接管來的已經是我方的：再接管沒有作用（我方的東西）
    expect(eff(a, [{ op: 'hack.takeover' }], { overlay: t.id }).run.beats).toEqual([])
    // 改寫中的仍在敵方：不能再被接管
    const rw0 = overlay(a, { slot: 3 })
    eff(a, [{ op: 'hack.takeover', mode: 'rewrite' }], { overlay: rw0.id })
    const again = eff(a, [{ op: 'hack.takeover' }], { overlay: rw0.id })
    expect(again.last.ok).toBe(false)
    expect(again.run.beats.at(-1)!.text).toContain('已經被接管了')
    const b = world()
    const blocker = b.run().addOverlay({ side: 'ally', slot: 2, kind: 'drone', name: '佔位', hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    const t2 = overlay(b, { slot: 2 })
    const r = eff(b, [{ op: 'hack.takeover' }], { overlay: t2.id })
    expect(r.last.ok).toBe(false)
    expect(r.run.beats.at(-1)!.text).toContain('接管不了')
    expect(blocker.side).toBe('ally')
    const c = world()
    const t3 = overlay(c, { slot: 2 })
    const rw = eff(c, [{ op: 'hack.takeover', mode: 'rewrite', until: 'battle_end' }], { overlay: t3.id })
    expect(rw.run.beats.at(-1)!.text).toContain('到戰鬥結束它每一輪攻擊它原本的隊友')
    expect(t3.side).toBe('foe')
  })

  it('還回去：原本沒有操作者與自己動設定的不補；原本那一格被別台占了就挪到最近的空格；沒有空格就停機（不記還回去的話）', () => {
    const a = world()
    const t = overlay(a, { slot: 2, owner: undefined, auto: undefined, autonomous: undefined })
    delete t.owner
    eff(a, [{ op: 'hack.takeover', turns: 1 }], { overlay: t.id })
    expect(t.owner).toBe('a1')
    // 原本的那一格被敵方的別台占了（接管時它被收走了，那一格空出來）
    a.battle.overlays.push({ ...structuredClone(t), id: 'squatter', side: 'foe', slot: 2, owner: 'f1', ext: {} } as BattleOverlay)
    ;((t.ext!.hack as Rec).taken as Rec).fresh = false
    const run = a.run(dice())
    run.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(t.side).toBe('foe')
    expect(t.owner).toBeUndefined()
    expect(t.slot).not.toBe(2)
    expect(t.down).toBe(false)
    // 沒有空格：四格都被占了，停機
    const b = world()
    const t2 = overlay(b, { slot: 1 })
    eff(b, [{ op: 'hack.takeover', turns: 1 }], { overlay: t2.id })
    ;((t2.ext!.hack as Rec).taken as Rec).fresh = false
    for (const s of [1, 2, 3, 4]) b.battle.overlays.push({ ...structuredClone(t2), id: `x${s}`, side: 'foe', slot: s, owner: 'f1', ext: {}, down: false } as BattleOverlay)
    const r2 = b.run(dice())
    r2.k.battle.emit('turn.end', { run: r2, unit: b.ally(1) })
    expect(t2.down).toBe(true)
  })

  it('控制節點：沒選節點丟 BattleBlocked；已經拿下的回 ok: false 不再記一拍；拿下之後 taken 為真並記一拍', () => {
    const a = world({ more: { nodes: [{ kind: 'relay', name: '中繼站' }] } })
    expect(() => eff(a, [{ op: 'hack.node' }])).toThrow('要選一個控制節點。')
    expect(() => eff(a, [{ op: 'hack.node' }], { node: 'ghost' })).toThrow('要選一個控制節點。')
    expect(() => eff(a, [{ op: 'hack.node' }], U('f1'))).toThrow('要選一個控制節點。')
    const id = a.battle.nodes[0]!.id
    const first = eff(a, [{ op: 'hack.node' }], { node: id })
    expect(first.last.ok).toBe(true)
    expect(first.run.beats.at(-1)!.tag).toBe('node')
    const second = eff(a, [{ op: 'hack.node' }], { node: id })
    expect(second.last.ok).toBe(false)
    expect(second.run.beats).toEqual([])
  })

  it('引爆：沒有落點、落在替身或不在場上的人身上沒有作用；沒有爆裂物記一句並回 ok: false；有就用掉一件、那一格受傷、遮蔽降一級（dice、type、cover 可以改）', () => {
    const a = world({ foes: [idle({ quick: [{ item: 'it_nade', qty: 2 }, { item: 'ghost_item', qty: 1 }], hp: { now: 99, max: 99 } }), idle()] }, )
    expect(eff(a, [{ op: 'hack.detonate' }]).run.beats).toEqual([])
    a.battle.units.f2!.slot = 0
    expect(eff(a, [{ op: 'hack.detonate' }], U('f2')).run.beats).toEqual([])
    a.battle.units.f2!.slot = 2
    const none = eff(a, [{ op: 'hack.detonate' }], U('f2'))
    expect(none.last.ok).toBe(false)
    expect(none.run.beats.at(-1)!.text).toContain('沒有爆裂物可以引爆')
    a.battle.cover.foe[0]!.level = 2
    a.battle.cover.foe[0]!.hp = 40
    const hp = a.battle.units.f1!.hp!.now
    const boom = eff(a, [{ op: 'hack.detonate', dice: 4, type: 'physical', cover: 2 }], U('f1'), { d: dice(1) })
    expect(boom.last.ok).toBe(true)
    expect(boom.run.beats.some((b) => b.text.includes('引爆了') && b.text.includes('破片手雷'))).toBe(true)
    expect(a.battle.units.f1!.quick.find((q) => q.item === 'it_nade')!.qty).toBe(1)
    expect(a.battle.units.f1!.hp!.now).toBeLessThan(hp)
    expect(a.battle.cover.foe[0]!.level).toBe(0)
    // 默認：2d6 熱能、降一級；最後一件用完從快取格拿掉
    eff(a, [{ op: 'hack.detonate' }], U('f1'), { d: dice(3, 3) })
    expect(a.battle.units.f1!.quick.map((q) => q.item)).toEqual(['ghost_item'])
  })

  it('接管的回合數：公式（turns）至少 1；until battle_end 不倒數；做的人退出時還沒到期的改寫還回去（out 掛點）', () => {
    const a = world()
    const t = overlay(a, { slot: 2 })
    eff(a, [{ op: 'hack.takeover', turns: 0 }], { overlay: t.id })
    expect(((t.ext!.hack as Rec).taken as Rec).left).toBe(1)
    const b = world()
    const t2 = overlay(b, { slot: 2 })
    eff(b, [{ op: 'hack.takeover', mode: 'rewrite', turns: 5 }], { overlay: t2.id })
    expect(t2.side).toBe('foe')
    const run = b.run(dice())
    run.setOut(b.ally(1), 'down')
    expect(((t2.ext!.hack as Rec) ).taken).toBeUndefined()
    const c = world()
    const t3 = overlay(c, { slot: 2 })
    eff(c, [{ op: 'hack.takeover', until: 'battle_end' }], { overlay: t3.id })
    const rr = c.run(dice())
    for (let i = 0; i < 3; i++) rr.k.battle.emit('turn.end', { run: rr, unit: c.ally(1) })
    expect(t3.side).toBe('ally')
  })

  it('改寫：每輪開頭它自己選原本那一方的人開火；原本那一方沒有人在場、沒有武器、已經擊落的不打；這一擊把戰鬥打完就停（round.start）', () => {
    const a = world()
    const t = overlay(a, { slot: 2 })
    eff(a, [{ op: 'hack.takeover', mode: 'rewrite', turns: 3 }], { overlay: t.id })
    const run = a.run(dice(15, 3, 3, 3, 3, 3))
    run.k.battle.emit('round.start', { run, round: 2 })
    expect(run.beats.some((b) => b.text.includes('敵我名單被改寫'))).toBe(true)
    // 原本那一方（敵方）沒人在場：不開火
    const b = world()
    const t2 = overlay(b, { slot: 2 })
    eff(b, [{ op: 'hack.takeover', mode: 'rewrite', turns: 3 }], { overlay: t2.id })
    for (const id of ['f1', 'f2']) b.battle.units[id]!.out = 'down'
    const rb = b.run(dice())
    const n = rb.beats.length
    rb.k.battle.emit('round.start', { run: rb, round: 2 })
    expect(rb.beats).toHaveLength(n)
    // 沒有武器、被擊落的跳過
    const c = world()
    const t3 = overlay(c, { slot: 2 })
    eff(c, [{ op: 'hack.takeover', mode: 'rewrite', turns: 3 }], { overlay: t3.id })
    delete t3.weapon
    const rc = c.run(dice())
    rc.k.battle.emit('round.start', { run: rc, round: 2 })
    expect(rc.beats.some((x) => x.text.includes('敵我名單被改寫'))).toBe(false)
    // 這一擊打倒最後一個人：戰鬥結束，不再繼續
    const d = world({ foes: [idle({ hp: { now: 1, max: 1 } })] })
    const t4 = overlay(d, { slot: 1, weapon: testWeapon('pistol', 99, 5) })
    eff(d, [{ op: 'hack.takeover', mode: 'rewrite', turns: 3 }], { overlay: t4.id })
    const t5 = overlay(d, { slot: 2, weapon: testWeapon('pistol', 99, 5) })
    t5.ext = { hack: { taken: { by: 'a1', mode: 'rewrite', left: 3, fresh: false, from: { side: 'foe', owner: 'f1' } } } }
    const rd = d.run(dice(20, 6, 6, 6, 6, 6, 6, 20, 6, 6, 6, 6, 6, 6))
    rd.k.battle.emit('round.start', { run: rd, round: 2 })
    expect(d.battle.result?.outcome).toBe('win')
  })
})
