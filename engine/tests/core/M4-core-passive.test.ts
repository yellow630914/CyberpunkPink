// 驗收測試：dev/work/M4-core-passive.md（被動效果的來源 k.passives；節奏資源全身合計最多 +1；橋參數的有效值進戰鬥；沒有橋的人；sink_floor）。
// 規格：CRAFTING 5.5 節、ITEMS 4.1 節；LEWD_SYSTEM 第 1 節；CORE_RULES 4.2 節、4.3 節「沉溺的下限」；CYBERWARE 7.4 節；dev/adr/0019 第二節與 P13～P15、P65。
// 測試自己登記來源（cyber、drug……），回傳的清單由測試控制；內容用測試自帶的最小資料。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, Feature, GameState, Kernel, PassiveEffect, PassiveSource } from '../../src'
import {
  BattleRun, ContentError, MOD_KINDS, PASSIVE_SOURCES, TEMPO_SOURCES, beginTurn, clone, createKernel, passiveProblems, readyFeatures, regenTotal, setupBattle, syncCapOf, syncSensitivityOf,
} from '../../src'
import { characterFeature } from '../../src/features/character'
import { bridgeOf, lewdFeature } from '../../src/features/lewd'
import { enemyUnit, laceUnit, makeState } from '../../src/testkit'

// ---- 測試的小工具 ----

type Box = Partial<Record<PassiveSource, PassiveEffect[]>>

/** 十種來源都登記一遍，回傳的清單由 box 控制（測試改 box 就等於裝上、拿掉東西）。 */
const sources = (box: Box): Feature => ({
  id: 'test_sources',
  install(k: Kernel) {
    for (const s of PASSIVE_SOURCES) k.passives.register('test', s, () => box[s] ?? [])
  },
})
/** 區是別的功能的內容種類（lewd 的豔名量表要查得到區）。 */
const DISTRICTS: Feature = { id: 'test_districts', install: (k: Kernel) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }

const FEATURES = [DISTRICTS, characterFeature, lewdFeature]

function world(box: Box, o: { features?: Feature[]; pc?: Parameters<typeof makeState>[0] extends infer S ? (S extends { pc?: infer P } ? P : never) : never } = {}) {
  const k = createKernel([...(o.features ?? FEATURES), sources(box)])
  k.strict = true
  const state = makeState(o.pc ? { pc: o.pc } : {})
  return { k, state, box }
}

const attrOf = (k: Kernel, s: GameState, a: 'body' | 'resolve') => k.stats.effectiveAttr(s, 'pc', a)
const raw = (unit: unknown) => ({ from: 'unit', unit: unit as Record<string, unknown> })

/** 一場有主角（from: actor）的戰鬥，不經過提交。mode 是 meat 或 net。 */
function battleOf(k: Kernel, state: GameState, mode: 'meat' | 'net' = 'meat') {
  const setup: BattleSetup = {
    mode, grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
    allies: [{ from: 'actor', id: 'pc' }],
    foes: [raw(mode === 'net' ? laceUnit('minion', 1) : enemyUnit('minion', 1))],
  }
  const battle = clone(setupBattle(k, state, setup).battle)
  const run = new BattleRun(k, state, battle)
  return { run, battle, pc: battle.units.a1 as BattleUnit, foe: battle.units.f1 as BattleUnit }
}

const sum = (parts: Array<{ value: number }>) => parts.reduce((s, p) => s + p.value, 0)

// ---- 登錄表與接線 ----

describe('M4-core-passive：來源登記與五種效果', () => {
  it('來源是封閉的十種；登記不在清單裡的來源丟錯；同一個來源可以由不同的人各登記一個', () => {
    expect([...PASSIVE_SOURCES]).toEqual(['cyber', 'drug', 'tuning', 'quirk', 'malware', 'sink', 'withdrawal', 'wound', 'contract', 'gear'])
    expect([...TEMPO_SOURCES]).toEqual(['cyber', 'drug', 'gear', 'construct'])
    const k = createKernel([])
    expect(() => k.passives.register('test', 'nope' as never, () => [])).toThrow(/不在清單裡/)
    k.passives.register('a', 'cyber', () => [{ attr: 'body', amount: 1 }])
    k.passives.register('b', 'cyber', () => [{ attr: 'body', amount: 2 }])
    expect(k.passives.registered()).toEqual([{ owner: 'a', source: 'cyber' }, { owner: 'b', source: 'cyber' }])
    const state = makeState()
    expect(k.stats.effectiveAttr(state, 'pc', 'body')).toBe(13)
  })

  it('of：每一筆帶 source、owner、label（沒寫用登記時給的，再沒有用來源的名字）；人不存在是空的', () => {
    const k = createKernel([])
    k.passives.register('cyberware', 'cyber', () => [{ attr: 'body', amount: 1 }, { stat: 'max_hp', amount: 2, label: '義臂' }])
    k.passives.register('drugs', 'drug', () => [{ unit_tag: 'jittery' }], '興奮劑')
    const state = makeState()
    expect(k.passives.of(state, 'pc')).toEqual([
      { attr: 'body', amount: 1, source: 'cyber', owner: 'cyberware', label: '義體' },
      { stat: 'max_hp', amount: 2, label: '義臂', source: 'cyber', owner: 'cyberware' },
      { unit_tag: 'jittery', source: 'drug', owner: 'drugs', label: '興奮劑' },
    ])
    expect(k.passives.of(state, 'nobody')).toEqual([])
  })

  it('{ attr }：有效屬性加上去，拿掉之後回到原值（也夾在 1～24）', () => {
    const { k, state, box } = world({})
    expect(attrOf(k, state, 'body')).toBe(10)
    box.cyber = [{ attr: 'body', amount: 2 }]
    expect(attrOf(k, state, 'body')).toBe(12)
    expect(k.stats.statParts(state, 'pc', 'max_hp')[0]!.value).toBe(44)
    expect(k.stats.attrParts(state, 'pc', 'body')).toEqual([{ label: '義體', value: 2, source: 'cyber' }])
    box.cyber = [{ attr: 'body', amount: 99 }]
    expect(attrOf(k, state, 'body')).toBe(24)
    box.cyber = []
    expect(attrOf(k, state, 'body')).toBe(10)
    expect(k.stats.attrParts(state, 'pc', 'body')).toEqual([])
  })

  it('{ stat }：衍生數值加上去、statParts 看得到 source: cyber；拿掉之後回到原值', () => {
    const { k, state, box } = world({})
    const base = k.stats.stat(state, 'pc', 'max_hp')
    box.cyber = [{ stat: 'max_hp', amount: 5, label: '皮下裝甲' }]
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(base + 5)
    expect(k.stats.statParts(state, 'pc', 'max_hp')).toContainEqual({ label: '皮下裝甲', value: 5, source: 'cyber' })
    expect(k.stats.stat(state, 'pc', 'load_cap')).toBe(k.stats.stat(makeState(), 'pc', 'load_cap'))
    box.cyber = []
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(base)
    expect(k.stats.statParts(state, 'pc', 'max_hp')).toHaveLength(1)
  })

  it('{ check }：skills 對檢定的基本功、tags 對檢定的標籤，有一邊對上就算；都沒對上不算', () => {
    const { k, state, box } = world({})
    box.cyber = [{ check: { skills: ['perform'] }, amount: 2 }, { check: { tags: ['social'] }, amount: 1 }, { check: { skills: ['hack'], tags: ['place:hive'] }, amount: 3 }]
    const ask = (ctx: { skill?: string; tags: string[] }) => k.stats.checkModifiers(state, 'pc', { attr: 'charm', ...ctx })
    expect(ask({ skill: 'perform', tags: [] })).toEqual([{ label: '義體', value: 2, source: 'cyber' }])
    expect(ask({ tags: ['social'] })).toEqual([{ label: '義體', value: 1, source: 'cyber' }])
    expect(sum(ask({ skill: 'perform', tags: ['social'] }))).toBe(3)
    expect(sum(ask({ skill: 'hack', tags: [] }))).toBe(3)
    expect(sum(ask({ skill: 'brawl', tags: ['place:hive'] }))).toBe(3)
    expect(ask({ skill: 'brawl', tags: ['combat'] })).toEqual([])
    box.cyber = []
    expect(ask({ skill: 'perform', tags: ['social'] })).toEqual([])
  })

  it('{ mod }：戰鬥的修正，單位有 actor 才有；source 是那一筆的來源；沒有 actor 的敵人沒有；tags 要全部在問的情境標籤裡', () => {
    const { k, state, box } = world({})
    box.cyber = [{ mod: 'hit', amount: 1 }, { mod: 'evade', amount: 2, tags: ['aimed', 'burst'] }]
    box.drug = [{ mod: 'hit', amount: 2, label: '興奮劑' }]
    const { run, pc, foe } = battleOf(k, state)
    expect(run.mods('hit', pc)).toEqual([{ label: '義體', value: 1, source: 'cyber' }, { label: '興奮劑', value: 2, source: 'drug' }])
    expect(run.mods('hit', foe)).toEqual([])
    expect(run.mods('evade', pc)).toEqual([])
    expect(run.mods('evade', pc, undefined, undefined, ['aimed'])).toEqual([])
    expect(run.mods('evade', pc, undefined, undefined, ['aimed', 'burst', 'x'])).toEqual([{ label: '義體', value: 2, source: 'cyber' }])
    box.cyber = box.drug = []
    expect(run.mods('hit', pc)).toEqual([])
  })

  it('{ unit_tag }：開打時（unit.ready）加到單位的標籤，不重複；沒有的人沒有', () => {
    const { k, state, box } = world({})
    box.cyber = [{ unit_tag: 'night_vision' }]
    box.gear = [{ unit_tag: 'night_vision' }, { unit_tag: 'armored' }]
    const { pc, foe } = battleOf(k, state)
    expect(pc.tags.filter((t) => t === 'night_vision')).toHaveLength(1)
    expect(pc.tags).toContain('armored')
    expect(foe.tags).not.toContain('night_vision')
    box.cyber = box.gear = []
    expect(battleOf(k, state).pc.tags).not.toContain('night_vision')
  })

  it('MOD_KINDS 多了 ram_regen；每一種修正都問得到（登記的是一個修正，不是逐種掛）', () => {
    expect(MOD_KINDS).toContain('ram_regen')
    const { k, state, box } = world({})
    box.cyber = MOD_KINDS.map((mod) => ({ mod, amount: 1 }))
    const { run, pc } = battleOf(k, state)
    for (const kind of MOD_KINDS) expect(sum(run.mods(kind, pc).filter((p) => p.source === 'cyber')), kind).toBe(1)
  })
})

describe('M4-core-passive：if 與繞圈', () => {
  const HP_AT_LEAST: Feature = {
    id: 'test_cond',
    install: (k) => k.conditions.register<{ kind: string; min: number }>({
      kind: 't_hp', owner: 'test', validate: () => [],
      // 條件自己去讀衍生數值（max_hp）：又會回到被動效果的計算
      test: (c, ctx) => ctx.stats.stat(ctx.state, ctx.actor!, 'max_hp') >= c.min,
    }),
  }

  it('if 不成立的那一筆不算；成立才算；全部成立才算', () => {
    const { k, state, box } = world({}, { features: [...FEATURES, HP_AT_LEAST] })
    const base = k.stats.stat(state, 'pc', 'max_hp')
    box.cyber = [{ attr: 'charm', amount: 3, if: [{ kind: 'wounded' }] }, { stat: 'ap_max', amount: 1, if: [{ kind: 'track', track: 'hp', min: 1 }, { kind: 'track', track: 'sink', min: 5 }] }]
    expect(attrOf(k, state, 'resolve')).toBe(10)
    expect(k.stats.effectiveAttr(state, 'pc', 'charm')).toBe(10)
    expect(k.stats.stat(state, 'pc', 'ap_max')).toBe(4)
    expect(k.passives.of(state, 'pc')).toEqual([])
    state.actors.pc!.hp = 1
    state.actors.pc!.sink = 6
    expect(k.stats.effectiveAttr(state, 'pc', 'charm')).toBe(13)
    expect(k.stats.stat(state, 'pc', 'ap_max')).toBe(5)
    expect(k.passives.of(state, 'pc')).toHaveLength(2)
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(base)
  })

  it('條件自己會讀衍生數值（含這個人身上的被動效果）時不會無限遞迴；結果穩定、問幾次都一樣', () => {
    const { k, state, box } = world({}, { features: [...FEATURES, HP_AT_LEAST] })
    // 體格 +2（不帶 if，繞回來時還算）→ max_hp 44；{ stat: max_hp +5 } 的條件是「max_hp 至少 40」：繞回來時的 max_hp 是 44 ≥ 40，成立
    box.cyber = [{ attr: 'body', amount: 2 }, { stat: 'max_hp', amount: 5, if: [{ kind: 't_hp', min: 40 } as never] }]
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(49)
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(49)
    expect(k.passives.of(state, 'pc')).toHaveLength(2)
    // 條件要求的比不帶 if 的那幾筆算出來的還高：不成立（那一筆不算），結果是 44，也穩定
    box.cyber = [{ attr: 'body', amount: 2 }, { stat: 'max_hp', amount: 5, if: [{ kind: 't_hp', min: 45 } as never] }]
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(44)
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(44)
    expect(k.passives.of(state, 'pc')).toHaveLength(1)
  })

  it('來源的函式自己又去讀衍生數值（不該這樣寫，但不能讓整個遊戲卡死）：第二圈回來就什麼都不回，停得下來', () => {
    const k = createKernel([characterFeature])
    let calls = 0
    k.passives.register('test', 'cyber', (state, actor) => {
      calls += 1
      if (calls > 50) throw new Error('繞不完')
      return [{ attr: 'body', amount: 1 }, { stat: 'max_hp', amount: k.stats.stat(state, actor, 'ap_max') }]
    })
    const state = makeState()
    expect(() => k.stats.stat(state, 'pc', 'max_hp')).not.toThrow()
    expect(calls).toBeLessThan(50)
    // 繞完之後的狀態乾淨：第二次問的結果和第一次一樣
    const first = k.stats.stat(state, 'pc', 'max_hp')
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(first)
  })
})

describe('M4-core-passive：passiveProblems', () => {
  const k = createKernel([characterFeature])
  const problems = (raw: unknown) => passiveProblems(k, raw)

  it('五種各自合格的寫法沒有問題；一筆或一串都收', () => {
    expect(problems({ attr: 'body', amount: 2 })).toEqual([])
    expect(problems([
      { attr: 'body', amount: -1 }, { stat: 'max_hp', amount: 2.5 }, { check: { skills: ['perform'], tags: ['social'] }, amount: 1 },
      { mod: 'hit', amount: 1, tags: ['aimed'], layer: 'net' }, { unit_tag: 'night_vision' },
      { stat: 'max_hp', amount: 1, label: '義臂', if: [{ kind: 'wounded' }, { kind: 'any', of: [{ kind: 'track', track: 'hp', max: 5 }] }] },
      { mod: 'decay', amount: 2, layer: 'meat' }, { stat: 'net_load_decay', amount: 2 },
    ])).toEqual([])
  })

  it('擋得下：兩種以上的鍵並存、沒有任何一種鍵、amount 不對、mod 不在清單、layer 不是 meat 或 net、if 的條件種類沒有人註冊、不認得的欄位', () => {
    expect(problems({ attr: 'body', stat: 'max_hp', amount: 1 }).join('；')).toMatch(/attr、stat 只能寫一個/)
    expect(problems({ amount: 1 }).join('；')).toMatch(/要寫 attr、stat、check、mod、unit_tag 其中一個/)
    expect(problems({ attr: 'body', amount: 0 }).join('；')).toMatch(/amount：要是不為 0/)
    expect(problems({ attr: 'body' }).join('；')).toMatch(/amount/)
    expect(problems({ attr: 'body', amount: Number.NaN }).join('；')).toMatch(/amount/)
    expect(problems({ attr: 'body', amount: Infinity }).join('；')).toMatch(/amount/)
    expect(problems({ attr: 'body', amount: '2' }).join('；')).toMatch(/amount/)
    expect(problems({ attr: 'luck', amount: 1 }).join('；')).toMatch(/attr：要是 body/)
    expect(problems({ mod: 'nope', amount: 1 }).join('；')).toMatch(/mod：「nope」不是戰鬥修正的種類/)
    expect(problems({ mod: 'hit', amount: 1, layer: 'sky' }).join('；')).toMatch(/layer：要是 meat 或 net/)
    expect(problems({ stat: 'max_hp', amount: 1, layer: 'meat' }).join('；')).toMatch(/沒有 layer 這個欄位/)
    expect(problems({ attr: 'body', amount: 1, if: [{ kind: 'nope' }] }).join('；')).toMatch(/if\[0\].*nope/)
    expect(problems({ attr: 'body', amount: 1, if: { kind: 'wounded' } }).join('；')).toMatch(/if：要是條件的陣列/)
    expect(problems({ check: {}, amount: 1 }).join('；')).toMatch(/至少要寫一個/)
    expect(problems({ check: { skills: [] }, amount: 1 }).join('；')).toMatch(/至少要寫一個/)
    expect(problems({ check: { skills: [1] }, amount: 1 }).join('；')).toMatch(/skills：要是字串的陣列/)
    expect(problems({ unit_tag: '' }).join('；')).toMatch(/unit_tag/)
    expect(problems({ unit_tag: 'x', amount: 1 }).join('；')).toMatch(/沒有 amount/)
    expect(problems({ attr: 'body', amount: 1, note: 'x' }).join('；')).toMatch(/沒有 note 這個欄位/)
    expect(problems('x')).toHaveLength(1)
    expect(problems([{ attr: 'body', amount: 1 }, { attr: 'body', amount: 0 }])[0]).toMatch(/^effects\[1\]/)
  })

  it('每一條問題寫出是第幾筆；條件種類要看功能裝了沒（沒裝 character 的 kernel 不認得 wounded）', () => {
    const bare = createKernel([])
    expect(passiveProblems(bare, [{ attr: 'body', amount: 1, if: [{ kind: 'wounded' }] }], 'effects').join('；')).toMatch(/effects\[0\]\.if\[0\]/)
    expect(passiveProblems(k, [{ attr: 'body', amount: 1, if: [{ kind: 'wounded' }] }])).toEqual([])
  })

  it('感載消退（P65）：mod decay 沒寫 layer: meat 的擋下（沒寫、寫 net 都擋）；寫 meat 的過；內海寫 { stat: net_load_decay }', () => {
    expect(problems({ mod: 'decay', amount: 2 }).join('；')).toMatch(/mod 'decay' 一定要寫 layer: 'meat'/)
    expect(problems({ mod: 'decay', amount: 2, layer: 'net' }).join('；')).toMatch(/一定要寫 layer: 'meat'/)
    expect(problems({ mod: 'decay', amount: 2, layer: 'meat' })).toEqual([])
    expect(problems({ stat: 'net_load_decay', amount: 2 })).toEqual([])
  })
})

// ---- 內容裡的 effects（設計圖、零件、怪癖）：ready 之後檢查 ----

describe('M4-core-passive：設計圖、零件、怪癖的 effects 在 ready 之後檢查', () => {
  const part = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: id, type: 'plate', material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
  })
  const arm = (id: string, effects?: unknown) => JSON.parse(JSON.stringify({
    id, kind: 'cyberware', name: id, desc: '義臂。', brand: 'hz', grade: 2, legal: 'register', price: 900, slot: 'arm', invasiveness: 'invasive', sink_cost: 6,
    require: [{ type: 'plate' }], optional: [], ...(effects !== undefined ? { effects } : {}),
  }))
  const quirk = (id: string, effects?: unknown) => ({ id, name: id, desc: '怪癖。', kind: 'quirk', stats: {}, pool: ['used'], ...(effects !== undefined ? { effects } : {}) })
  const GOOD = [{ attr: 'body', amount: 1 }, { mod: 'hit', amount: 1, layer: 'meat' }, { stat: 'max_hp', amount: 2, if: [{ kind: 'wounded' }] }]

  const loaded = (features: Feature[], content: { blueprint?: unknown[]; part?: unknown[]; quirk?: unknown[] }) => {
    const k = createKernel(features)
    if (content.part) k.content.load('part', content.part as never)
    if (content.blueprint) k.content.load('blueprint', content.blueprint as never)
    if (content.quirk) k.content.load('quirk', content.quirk as never)
    return k
  }

  it('合格的 effects 過；沒有裝任何功能的 kernel 也一樣（沒有 if 的）', () => {
    expect(() => readyFeatures(loaded([characterFeature], { part: [part('pt_a', { effects: GOOD })], blueprint: [arm('bp_arm', GOOD)], quirk: [quirk('q_a', GOOD)] }))).not.toThrow()
    expect(() => readyFeatures(loaded([], { part: [part('pt_a', { effects: GOOD.slice(0, 2) })], blueprint: [arm('bp_arm', GOOD.slice(0, 2))], quirk: [quirk('q_a', GOOD.slice(0, 2))] }))).not.toThrow()
    expect(() => readyFeatures(loaded([], { part: [part('pt_a')], blueprint: [arm('bp_arm')], quirk: [quirk('q_a')] }))).not.toThrow()
  })

  it('不合格的整批擋下（ContentError），每一條以「種類/id：」開頭，寫出是第幾筆', () => {
    const k = loaded([characterFeature], {
      part: [part('pt_bad', { effects: [{ attr: 'body', amount: 0 }] })],
      blueprint: [arm('bp_bad', [{ mod: 'nope', amount: 1 }])],
      quirk: [quirk('q_bad', [{ attr: 'body', stat: 'max_hp', amount: 1 }])],
    })
    let err: unknown
    try { readyFeatures(k) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ContentError)
    const list = (err as ContentError).problems
    expect(list.find((p) => p.startsWith('part/pt_bad：effects[0]'))).toMatch(/amount/)
    expect(list.find((p) => p.startsWith('blueprint/bp_bad：effects[0]'))).toMatch(/nope/)
    expect(list.find((p) => p.startsWith('quirk/q_bad：effects[0]'))).toMatch(/只能寫一個/)
  })

  it('條件種類要等功能都裝上才知道：沒裝 character 的世界，條件 wounded 查不到；裝了就過；mod decay 沒寫 layer 的擋下', () => {
    expect(() => readyFeatures(loaded([], { quirk: [quirk('q_a', [{ attr: 'body', amount: 1, if: [{ kind: 'wounded' }] }])] }))).toThrow(/quirk\/q_a：effects\[0\]\.if\[0\]/)
    expect(() => readyFeatures(loaded([characterFeature], { quirk: [quirk('q_a', [{ attr: 'body', amount: 1, if: [{ kind: 'wounded' }] }])] }))).not.toThrow()
    expect(() => readyFeatures(loaded([], { part: [part('pt_a', { effects: [{ mod: 'decay', amount: 2 }] })] }))).toThrow(/part\/pt_a：.*layer: 'meat'/)
  })
})

// ---- 感載消退的兩種寫法 ----

describe('M4-core-passive：layer 與感載消退（P65）', () => {
  const DECAY: Feature = { id: 'test_decay', install: (k) => k.stats.defineStat({ id: 'net_load_decay', owner: 'test', name: '感載消退', base: () => 0 }) }
  const turn = (run: BattleRun, u: BattleUnit) => {
    u.load!.now = 10
    u.uses.turns = 1
    beginTurn(run, u)
    return u.load!.now
  }

  it('layer: meat 的 mod 在現實的戰鬥算、內海的戰鬥不算；layer: net 反過來；沒寫 layer 兩層都算', () => {
    const { k, state, box } = world({}, { features: [...FEATURES, DECAY] })
    box.cyber = [{ mod: 'hit', amount: 1, layer: 'meat' }, { mod: 'hit', amount: 10, layer: 'net' }, { mod: 'hit', amount: 100 }]
    const meat = battleOf(k, state, 'meat')
    expect(sum(meat.run.mods('hit', meat.pc))).toBe(101)
    const net = battleOf(k, state, 'net')
    expect(sum(net.run.mods('hit', net.pc))).toBe(110)
  })

  it('{ stat: net_load_decay } 加 { mod: decay, layer: meat }：現實的戰鬥每回合多消退 2、內海的戰鬥每回合消退 2（不是 4）、衍生數值是 2', () => {
    const { k, state, box } = world({}, { features: [...FEATURES, DECAY] })
    // 沒裝東西：現實 2 ＋ mod(意志 10) = 2；內海 0
    const meat0 = battleOf(k, state, 'meat')
    expect(10 - turn(meat0.run, meat0.pc)).toBe(2)
    const net0 = battleOf(k, state, 'net')
    expect(10 - turn(net0.run, net0.pc)).toBe(0)
    box.tuning = [{ stat: 'net_load_decay', amount: 2 }, { mod: 'decay', amount: 2, layer: 'meat' }]
    expect(k.stats.stat(state, 'pc', 'net_load_decay')).toBe(2)
    const meat = battleOf(k, state, 'meat')
    expect(10 - turn(meat.run, meat.pc)).toBe(4)
    const net = battleOf(k, state, 'net')
    expect(net.pc.decay).toBe(2)
    expect(10 - turn(net.run, net.pc)).toBe(2)
    // 拿掉：回到原值
    box.tuning = []
    const meat1 = battleOf(k, state, 'meat')
    expect(10 - turn(meat1.run, meat1.pc)).toBe(2)
  })
})

// ---- 節奏資源 ----

describe('M4-core-passive：節奏資源全身合計最多 +1（P13）', () => {
  /** 先攻到的回合開始：行動點與 RAM 都先清成 0、上限放大，只看這一個回合回了多少。 */
  function regen(box: Box, extra?: (k: Kernel) => void) {
    const { k, state } = world(box)
    extra?.(k)
    const { run, pc } = battleOf(k, state)
    pc.ap.max = 20
    pc.ap.now = 0
    pc.pools.ram!.max = 20
    pc.pools.ram!.now = 0
    pc.uses.turns = 1
    beginTurn(run, pc)
    return { ap: pc.ap.now - pc.ap.regen, ram: pc.pools.ram!.now - pc.pools.ram!.regen }
  }
  const ABILITY = (kind: 'ap_regen' | 'ram_regen') => (k: Kernel) => k.battle.modifier('test_ability', (q) => (q.kind === kind && q.unit.actor === 'pc' ? [{ label: '技能', value: 1, source: 'ability' }] : []))

  it('regenTotal：節奏來源的正值合計最多 +1，負值照算，其他來源照算', () => {
    expect(regenTotal([])).toBe(0)
    expect(regenTotal([{ value: 1, source: 'cyber' }])).toBe(1)
    expect(regenTotal([{ value: 1, source: 'cyber' }, { value: 1, source: 'drug' }, { value: 2, source: 'gear' }, { value: 1, source: 'construct' }])).toBe(1)
    expect(regenTotal([{ value: 1, source: 'cyber' }, { value: 1, source: 'ability' }, { value: 1, source: 'sync' }, { value: 1 }])).toBe(4)
    expect(regenTotal([{ value: 1, source: 'cyber' }, { value: 1, source: 'drug' }, { value: -1, source: 'cyber' }])).toBe(0)
    expect(regenTotal([{ value: -2, source: 'status' }, { value: 3, source: 'cyber' }])).toBe(-1)
  })

  it('義體與藥各給 ap_regen +1：回合回復只多 1；再加一個技能（來源 ability）的 +1 多到 2；沒有節奏來源的不受限', () => {
    expect(regen({}).ap).toBe(0)
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: 1 }] }).ap).toBe(1)
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: 1 }], drug: [{ mod: 'ap_regen', amount: 1 }] }).ap).toBe(1)
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: 1 }], drug: [{ mod: 'ap_regen', amount: 1 }], gear: [{ mod: 'ap_regen', amount: 2 }] }).ap).toBe(1)
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: 1 }], drug: [{ mod: 'ap_regen', amount: 1 }] }, ABILITY('ap_regen')).ap).toBe(2)
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: 2 }] }).ap).toBe(1)
    // 其他來源（技能）本身不受限
    expect(regen({}, (k) => { ABILITY('ap_regen')(k); k.battle.modifier('test_ability2', (q) => (q.kind === 'ap_regen' ? [{ label: '檔位', value: 2, source: 'sync' }] : [])) }).ap).toBe(3)
  })

  it('負值照算：節奏來源的 −1 不被正值的上限吃掉', () => {
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: 1 }, { mod: 'ap_regen', amount: -1 }], drug: [{ mod: 'ap_regen', amount: 1 }] }).ap).toBe(0)
    expect(regen({ cyber: [{ mod: 'ap_regen', amount: -1 }] }).ap).toBe(-1)
  })

  it('ram_regen 同一條夾法：義體與藥各 +1 只多 1，加技能的 +1 到 2', () => {
    expect(regen({}).ram).toBe(0)
    expect(regen({ cyber: [{ mod: 'ram_regen', amount: 1 }], drug: [{ mod: 'ram_regen', amount: 1 }] }).ram).toBe(1)
    expect(regen({ cyber: [{ mod: 'ram_regen', amount: 1 }], drug: [{ mod: 'ram_regen', amount: 1 }] }, ABILITY('ram_regen')).ram).toBe(2)
    expect(regen({ gear: [{ mod: 'ram_regen', amount: 1 }] }).ram).toBe(1)
  })

  it('甲板裡的工具構裝（features/deck 的修正）標的是 construct，也算節奏資源', () => {
    const k = createKernel([])
    k.battle.modifier('deck_like', (q) => (q.kind === 'ap_regen' ? [{ label: '構裝', value: 1, source: 'construct' }] : []))
    k.passives.register('test', 'cyber', () => [{ mod: 'ap_regen', amount: 1 }])
    const state = makeState()
    const { run, pc } = battleOf(k, state)
    expect(regenTotal(run.mods('ap_regen', pc))).toBe(1)
  })
})

// ---- 沒有橋的人 ----

describe('M4-core-passive：沒有橋的人（P15）', () => {
  it('ext.bridge 是 null 的角色進現實戰鬥：沒有 load、沒有 pools.ram、有 unbridged；神經與快感傷害對他無效', () => {
    const { k, state } = world({}, { pc: { ext: { bridge: null } } })
    const { run, pc } = battleOf(k, state)
    expect(pc.load).toBeUndefined()
    expect(pc.pools.ram).toBeUndefined()
    expect(pc.tags).toContain('unbridged')
    expect(run.damage(pc, 10, 'neural')).toEqual({ dealt: 0, track: 'none' })
    expect(run.damage(pc, 10, 'pleasure')).toEqual({ dealt: 0, track: 'none' })
    expect(run.beats.some((b) => /沒有橋/.test(b.text))).toBe(true)
    // 生命傷害照常
    expect(run.damage(pc, 10, 'physical').track).toBe('hp')
  })

  it('有橋的人照舊：有 load 與 RAM，沒有 unbridged；沒裝 lewd、ext.bridge 沒寫的也算有橋', () => {
    const { k, state } = world({}, { pc: { ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } } })
    const a = battleOf(k, state).pc
    expect(a.load).toBeDefined()
    expect(a.pools.ram).toBeDefined()
    expect(a.tags).not.toContain('unbridged')
    const bare = world({}, { features: [] })
    const b = battleOf(bare.k, bare.state).pc
    expect(b.load).toBeDefined()
    expect(b.pools.ram).toBeDefined()
    expect(b.tags).not.toContain('unbridged')
  })

  it('沒有橋的人在內海戰鬥裡也沒有 RAM 與 load', () => {
    const { k, state } = world({}, { pc: { ext: { bridge: null } } })
    const { pc } = battleOf(k, state, 'net')
    expect(pc.load).toBeUndefined()
    expect(pc.pools.ram).toBeUndefined()
  })
})

// ---- 橋參數的有效值 ----

describe('M4-core-passive：橋參數的有效值只有一個讀法（P14）', () => {
  const bridge = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }

  it('{ stat: bridge_sensitivity, +20 }：戰鬥單位的 sensitivity、syncSensitivityOf、syncCapOf 讀到的、bridgeOf 的有效值是同一個數字', () => {
    const { k, state, box } = world({}, { pc: { ext: { bridge }, skills: { sync: 3 } } })
    expect(battleOf(k, state).pc.sensitivity).toBe(30)
    expect(syncCapOf(k, state, 'pc')).toBe('standard')
    box.cyber = [{ stat: 'bridge_sensitivity', amount: 20 }]
    const u = battleOf(k, state).pc
    expect(u.sensitivity).toBe(50)
    expect(syncSensitivityOf(k, state, 'pc')).toBe(50)
    expect(bridgeOf(k, state, 'pc')!.sensitivity).toMatchObject({ base: 30, value: 50 })
    // 深檔要同步 3 級與敏感度 40：來源給的 +20 讓他開得到深檔
    expect(syncCapOf(k, state, 'pc')).toBe('deep')
    box.cyber = []
    expect(battleOf(k, state).pc.sensitivity).toBe(30)
  })

  it('有效值 0～200、來源合計不另外夾：基本 100 加 150 是 200，基本 0 加 150 是 150，往下壓到 0 為止', () => {
    const { k, state, box } = world({}, { pc: { ext: { bridge: { ...bridge, craving: 100, docility: 0 } } } })
    box.cyber = [{ stat: 'bridge_craving', amount: 150 }, { stat: 'bridge_docility', amount: 150 }, { stat: 'bridge_tolerance', amount: -500 }]
    const v = bridgeOf(k, state, 'pc')!
    expect(v.craving.value).toBe(200)
    expect(v.docility.value).toBe(150)
    expect(v.tolerance.value).toBe(0)
    for (const p of ['sensitivity', 'tolerance', 'craving', 'docility'] as const) expect(v[p].value).toBe(k.stats.stat(state, 'pc', `bridge_${p}`))
  })

  it('{ stat: bridge_tolerance, +20 } 讓感載上限 +10（角色的 load_cap 與戰鬥單位的 load.max 都是）', () => {
    const { k, state, box } = world({}, { pc: { ext: { bridge } } })
    const before = k.stats.stat(state, 'pc', 'load_cap')
    const beforeMax = battleOf(k, state).pc.load!.max
    box.cyber = [{ stat: 'bridge_tolerance', amount: 20 }]
    expect(k.stats.stat(state, 'pc', 'load_cap')).toBe(before + 10)
    expect(battleOf(k, state).pc.load!.max).toBe(beforeMax + 10)
    box.cyber = []
    expect(k.stats.stat(state, 'pc', 'load_cap')).toBe(before)
  })

  it('沒裝 lewd（沒有人定義 bridge_*）時，核心照舊讀 ext.bridge 的基本值；承受層數與耐受的關係不變', () => {
    const { k, state } = world({}, { features: [characterFeature], pc: { ext: { bridge: { sensitivity: 70, tolerance: 40 } } } })
    const u = battleOf(k, state).pc
    expect(u.sensitivity).toBe(70)
    expect(u.load!.max).toBe(40)
  })

  it('bridge 效果寫回時保留 ext.bridge 裡別人的鍵（容量等），只改那一項參數', () => {
    const { k, state } = world({}, { pc: { ext: { bridge: { ...bridge, capacity: { memory: 4, io: 2 }, other: 'x' } } } })
    const ctx = { state, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as never
    const r = k.effects.resolve([{ kind: 'bridge', param: 'tolerance', amount: 10 }], ctx)
    expect(r.errors).toEqual([])
    const after = clone(state)
    k.changes.applyAll(after, r.changes)
    expect(after.actors.pc!.ext.bridge).toEqual({ sensitivity: 30, tolerance: 40, craving: 30, docility: 30, capacity: { memory: 4, io: 2 }, other: 'x' })
    // 寫回的是複製品，不是同一個物件
    expect((after.actors.pc!.ext.bridge as { capacity: object }).capacity).not.toBe((state.actors.pc!.ext.bridge as { capacity: object }).capacity)
  })
})

// ---- 沉溺的下限 ----

describe('M4-core-passive：sink_floor（CORE_RULES 4.3 節「沉溺的下限」）', () => {
  const FLOOR: Feature = { id: 'test_floor', install: (k) => k.stats.addStatProvider('sink_floor', 'test', () => [{ label: '義體', value: 8, source: 'cyber' }]) }
  const sinkBy = (k: Kernel, state: GameState, amount: number, source: 'builtin' | 'ai' | 'player' = 'builtin') => {
    const r = k.effects.resolve([{ kind: 'sink', amount }], { state, actor: 'pc', grade: 1, source, clampAsked: true, content: k.content } as never)
    const after = clone(state)
    k.changes.applyAll(after, r.changes)
    return { r, sink: after.actors.pc!.sink }
  }

  it('sink_floor 是衍生數值：基礎 0、最少 0；有人加就加上去（被動效果也行）', () => {
    const { k, state, box } = world({})
    expect(k.stats.stat(state, 'pc', 'sink_floor')).toBe(0)
    box.cyber = [{ stat: 'sink_floor', amount: 5 }]
    expect(k.stats.stat(state, 'pc', 'sink_floor')).toBe(5)
    box.cyber = [{ stat: 'sink_floor', amount: -5 }]
    expect(k.stats.stat(state, 'pc', 'sink_floor')).toBe(0)
  })

  it('下限 8：沉溺 10 的人 sink −5 只降到 8；已經在 8 的人整筆拿掉並有提醒；比下限低的也不會被拉上去', () => {
    const { k } = world({}, { features: [...FEATURES, FLOOR] })
    const at10 = sinkBy(k, makeState({ pc: { sink: 10 } }), -5)
    expect(at10.sink).toBe(8)
    // 只降到一半被下限擋住：提醒一句「只浮到 N」（M4-followups-2 第 1 項）
    expect(at10.r.clamps.map((c) => c.notice)).toEqual(['身上的義體讓你只浮到 8。'])
    const at8 = sinkBy(k, makeState({ pc: { sink: 8 } }), -5)
    expect(at8.sink).toBe(8)
    expect(at8.r.changes).toEqual([])
    expect(at8.r.clamps.map((c) => c.notice)).toEqual(['身上的義體讓你浮不上來，這一筆沒有算。'])
    const at5 = sinkBy(k, makeState({ pc: { sink: 5 } }), -3)
    expect(at5.sink).toBe(5)
    expect(at5.r.clamps).toHaveLength(1)
    // 剛好夠降到下限的一筆原樣過
    expect(sinkBy(k, makeState({ pc: { sink: 10 } }), -2).sink).toBe(8)
    expect(sinkBy(k, makeState({ pc: { sink: 10 } }), -1).sink).toBe(9)
  })

  it('往上加不受影響（內建、AI、玩家都一樣）；AI 一件事 ±3 照舊', () => {
    const { k } = world({}, { features: [...FEATURES, FLOOR] })
    expect(sinkBy(k, makeState({ pc: { sink: 8 } }), 5).sink).toBe(13)
    expect(sinkBy(k, makeState({ pc: { sink: 0 } }), 5).sink).toBe(5)
    expect(sinkBy(k, makeState({ pc: { sink: 10 } }), 9, 'ai').sink).toBe(13)
    expect(sinkBy(k, makeState({ pc: { sink: 10 } }), -9, 'ai').sink).toBe(8)
    expect(sinkBy(k, makeState({ pc: { sink: 20 } }), -9, 'ai').sink).toBe(17)
  })

  it('下限是 0（沒有人加）時和以前一樣：不低於 0、到底了不提醒', () => {
    const { k } = world({})
    expect(sinkBy(k, makeState({ pc: { sink: 4 } }), -9).sink).toBe(0)
    const z = sinkBy(k, makeState({ pc: { sink: 0 } }), -3)
    expect(z.sink).toBe(0)
    expect(z.r.clamps).toEqual([])
  })

  it('下限跟著被動效果走：來源拿掉，沉溺又降得下去', () => {
    const { k, box } = world({})
    const state = makeState({ pc: { sink: 10 } })
    box.cyber = [{ stat: 'sink_floor', amount: 6 }]
    expect(sinkBy(k, state, -9).sink).toBe(6)
    box.cyber = []
    expect(sinkBy(k, state, -9).sink).toBe(1)
  })
})
