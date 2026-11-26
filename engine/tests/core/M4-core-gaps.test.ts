// 驗收測試：dev/work/M4-core-gaps.md 的核心項（cpp-architect 角色）。每一項至少一條行為測試。
// 1 重傷 −2 讀標籤；2 義體打不壞的標籤；5 斷藥的約定（核心的 vent）；7 被動效果 check.attrs；8 餘韻的正面效果加倍；9 建角規則與 available、kit_free 進核心的內容檢查；
// 10 同步最高檔 sync_cap_max；11 掛點 damage.hp；12 被動效果依軌道值縮放（per）；13 sink_resist（戰鬥與 sink 效果）；14 掛點 turn.control；
// 16 自由行動的視窗 action.window；18 狀態 until next_attack 與 BattleEndExtra.triggers；19 ReportOutcome.amnesia。
// 規格：CORE_RULES 4.1、4.2、4.3 節；CYBERWARE 第 3 節；ITEMS 11.5 節；LEWD_SYSTEM 第 4 節；dev/adr/0019 實作補記：M4-core-gaps。
// 內容一律用測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel, PassiveEffect, PassiveSource, ReportOutcome } from '../../src'
import {
  AFTERGLOW_DOUBLE, BattleRun, ContentError, IGNORE_WOUND_PENALTY, IMPLANT_HARDENED, PASSIVE_SOURCES, PUMP_JAM, SINK_RESIST, STATUS_UNTILS, SYNC_CAP_MAX_STAT,
  actionWindow, advance, aiStep, beginTurn, buildActionReport, clone, createKernel, effectCtx, fallbackJudgment, hostileSide, hostiles, passiveAmount, passiveProblems, prepareAction, rerollAction, setupBattle, sinkRise, syncCapOf,
} from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { enemyUnit, laceUnit, makeGame, makeState } from '../../src/testkit'

// ---- 小工具 ----

type Box = Partial<Record<PassiveSource, PassiveEffect[]>>
/** 十種來源都登記一遍，回傳的清單由 box 控制。 */
const sources = (box: Box): Feature => ({
  id: 'test_sources',
  install(k: Kernel) {
    for (const s of PASSIVE_SOURCES) k.passives.register('test', s, () => box[s] ?? [])
  },
})
const sum = (parts: Array<{ value: number }>) => parts.reduce((s, p) => s + p.value, 0)
const noReward = { effects: [], changes: [], lines: [], clamps: [] } as never

const STATUS = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, desc: `${name}。`, until: 'own_turn_end', turns: 1, kind: 'debuff', ...over })
const PACK: ContentPack = {
  id: 'core_gaps',
  content: {
    battle_status: [
      STATUS('off_arm', '義臂失效'), STATUS('off_eye', '義眼失效'), STATUS('off_generic', '義體失效'), STATUS('boost_arm', '義臂超頻', { kind: 'buff' }),
      STATUS('pump_jam', '斷藥', { turns: 2 }),
      STATUS('blind_hit', '下一次命中 −1', { until: 'next_attack', turns: 1, mods: { hit: -1 } }),
    ],
  } as unknown as ContentPack['content'],
}

function world(box: Box = {}, o: { features?: Feature[]; pc?: Parameters<typeof makeState>[0] extends infer S ? (S extends { pc?: infer P } ? P : never) : never } = {}) {
  const k = createKernel([characterFeature, ...(o.features ?? []), sources(box)])
  k.strict = true
  k.content.loadPack(PACK)
  const state = makeState(o.pc ? { pc: o.pc } : {})
  return { k, state, box }
}

const raw = (unit: unknown) => ({ from: 'unit', unit: unit as Record<string, unknown> })
/** 一場有主角（from: actor）的戰鬥，不經過提交。mode 是 meat 或 net；allies 可以再加。 */
function battleOf(k: Kernel, state: GameState, mode: 'meat' | 'net' = 'meat', o: { foe?: unknown; allies?: string[] } = {}) {
  const setup: BattleSetup = {
    mode, grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
    allies: (o.allies ?? ['pc']).map((id) => ({ from: 'actor', id })),
    foes: [raw(o.foe ?? (mode === 'net' ? laceUnit('minion', 1) : enemyUnit('minion', 1, { weapon: 'pistol' })))],
  }
  const battle = clone(setupBattle(k, state, setup).battle)
  const run = new BattleRun(k, state, battle)
  return { run, battle, pc: battle.units.a1 as BattleUnit, foe: battle.units.f1 as BattleUnit, units: battle.units as Record<string, BattleUnit> }
}

// ---- 1 重傷 −2 ----

describe('第 1 項：重傷的檢定 −2 讀標籤 ignore_wound_penalty（痛覺編輯器）', () => {
  const hurt = { hp: 5 }

  it('戰鬥：生命低於一半的人命中與豁免 −2；有標籤（被動效果 unit_tag 給）就沒有這一筆，其餘不變', () => {
    const { k, state, box } = world({}, { pc: hurt })
    const a = battleOf(k, state)
    expect(a.run.mods('hit', a.pc).find((p) => p.label === '重傷')).toMatchObject({ value: -2, source: 'condition' })
    expect(a.run.mods('save', a.pc).some((p) => p.label === '重傷')).toBe(true)
    // 迴避不是自己擲的檢定，本來就不扣
    expect(a.run.mods('evade', a.pc).some((p) => p.label === '重傷')).toBe(false)
    box.cyber = [{ unit_tag: IGNORE_WOUND_PENALTY, label: '痛覺編輯器' }]
    const b = battleOf(k, state)
    expect(b.pc.tags).toContain('ignore_wound_penalty')
    expect(b.run.mods('hit', b.pc).some((p) => p.label === '重傷')).toBe(false)
    expect(b.run.mods('save', b.pc).some((p) => p.label === '重傷')).toBe(false)
  })

  it('戰鬥外：角色的檢定修正也一樣（有標籤就沒有重傷的 −2）', () => {
    const { k, state, box } = world({}, { pc: hurt })
    const ask = () => k.stats.checkModifiers(state, 'pc', { attr: 'body', tags: [] }).filter((p) => p.label === '重傷')
    expect(ask()).toEqual([{ label: '重傷', value: -2, source: 'condition' }])
    box.cyber = [{ unit_tag: IGNORE_WOUND_PENALTY }]
    expect(ask()).toEqual([])
    box.cyber = []
    expect(ask()).toHaveLength(1)
  })
})

// ---- 2 打不壞的義體 ----

describe('第 2 項：run.implantStatus 讀標籤 implant_hardened（皮下裝甲不會被特殊效果打壞）', () => {
  const implants = [{ kind: 'torso', name: '皮下裝甲' }, { kind: 'arm', name: '義臂' }]
  const setUp = (tags: string[]) => {
    const { k, state } = world({})
    const a = battleOf(k, state)
    a.pc.implants = clone(implants)
    a.pc.tags.push(...tags)
    return a
  }

  it('沒有標籤：照舊挑第一件', () => {
    const a = setUp([])
    expect(a.run.implantStatus(a.pc, 'off')?.name).toBe('皮下裝甲')
    expect(a.pc.statuses.map((s) => s.id)).toEqual(['off_generic'])
  })

  it('implant_hardened:torso（只保護那一種）：沒指定時略過它去挑下一件；指定到它回傳 null、不記拍；超頻不受影響', () => {
    const a = setUp(['implant_hardened:torso'])
    expect(a.run.implantStatus(a.pc, 'off')?.name).toBe('義臂')
    const before = a.run.beats.length
    expect(a.run.implantStatus(a.pc, 'off', { kind: 'torso' })).toBeNull()
    expect(a.run.implantStatus(a.pc, 'off', { pick: 0 })).toBeNull()
    expect(a.run.beats).toHaveLength(before)
    // 超頻（boost）不看這個標籤
    expect(a.run.implantStatus(a.pc, 'boost', { kind: 'arm' })?.name).toBe('義臂')
  })

  it('implant_hardened（沒寫種類）：他的每一件都不會被打壞', () => {
    const a = setUp([IMPLANT_HARDENED])
    expect(a.run.implantStatus(a.pc, 'off')).toBeNull()
    expect(a.run.implantStatus(a.pc, 'off', { kind: 'arm' })).toBeNull()
    expect(a.pc.statuses).toEqual([])
  })
})

// ---- 5 斷藥 ----

describe('第 5 項：斷藥的約定（狀態 pump_jam）：核心的 run.vent 排不掉感載', () => {
  it('帶著 pump_jam 的單位 vent 回傳 0、感載不動；狀態拿掉之後排得掉', () => {
    const { k, state } = world({})
    const a = battleOf(k, state)
    a.pc.load!.now = 10
    expect(PUMP_JAM).toBe('pump_jam')
    expect(a.run.applyStatus(a.pc, PUMP_JAM)).toBe(true)
    expect(a.run.vent(a.pc, 6)).toBe(0)
    expect(a.pc.load!.now).toBe(10)
    a.run.removeStatus(a.pc, PUMP_JAM)
    expect(a.run.vent(a.pc, 6)).toBe(6)
    expect(a.pc.load!.now).toBe(4)
  })
})

// ---- 7 check.attrs ----

describe('第 7 項：被動效果的 check 多一個 attrs（依屬性比對）', () => {
  it('attrs 對上檢定用的屬性就算（不看基本功與標籤）；對不上不算；三種比對有一邊對上就算', () => {
    const { k, state, box } = world({})
    box.wound = [{ check: { attrs: ['body', 'reflex'] }, amount: -4, label: '肢體重創' }]
    const ask = (ctx: { attr: 'body' | 'reflex' | 'tech'; skill?: string; tags?: string[] }) => k.stats.checkModifiers(state, 'pc', { tags: [], ...ctx }).filter((p) => p.source === 'wound')
    expect(ask({ attr: 'body' })).toEqual([{ label: '肢體重創', value: -4, source: 'wound' }])
    expect(ask({ attr: 'reflex', skill: 'stealth' })).toHaveLength(1)
    expect(ask({ attr: 'tech', skill: 'medicine' })).toEqual([])
    box.wound = [{ check: { skills: ['hack'], attrs: ['body'] }, amount: 1 }]
    expect(ask({ attr: 'tech', skill: 'hack' })).toHaveLength(1)
    expect(ask({ attr: 'body', skill: 'brawl' })).toHaveLength(1)
    expect(ask({ attr: 'tech', skill: 'brawl' })).toEqual([])
  })

  it('格式：attrs 要是屬性的陣列；skills、tags、attrs 都沒寫（或是空的）不合格；多餘的欄位擋下', () => {
    const k = createKernel([])
    const p = (e: unknown) => passiveProblems(k, e)
    expect(p({ check: { attrs: ['body'] }, amount: 1 })).toEqual([])
    expect(p({ check: { attrs: ['bogus'] }, amount: 1 }).join('')).toContain('check.attrs')
    expect(p({ check: { attrs: [] }, amount: 1 }).join('')).toContain('至少要寫一個')
    expect(p({ check: { nope: [] }, amount: 1 }).join('')).toContain('沒有 nope 這個欄位')
  })

  it('醫療的預設（重創與休養的檢定減值）改用屬性：體格或反應的檢定都吃，直接用屬性的也吃；技術的不吃', async () => {
    const { medicalFeature, DEFAULT_MEDICAL_RULES } = await import('../../src/features/medical')
    const { cyberwareFeature } = await import('../../src/features/cyberware')
    expect(DEFAULT_MEDICAL_RULES.wound_effects.wound_limb).toEqual([{ check: { attrs: ['body', 'reflex'] }, amount: -4, label: '肢體重創' }])
    const g = makeGame({ features: [characterFeature, cyberwareFeature, medicalFeature], pc: { conditions: [{ id: 'wound_limb' }] } }).game
    const ask = (attr: 'body' | 'reflex' | 'tech', skill?: string) => g.k.stats.checkModifiers(g.state, 'pc', { attr, ...(skill ? { skill } : {}), tags: [] }).filter((p) => p.source === 'wound')
    expect(ask('body')).toHaveLength(1)
    expect(ask('reflex')).toHaveLength(1)
    expect(ask('tech', 'medicine')).toEqual([])
  })
})

// ---- 8 餘韻的正面效果加倍 ----

describe('第 8 項：餘韻的正面效果加倍（標籤 afterglow_double）', () => {
  it('內海：每層餘韻 +1 變 +2；現實：每層 −1 是負面的，不加倍；沒有標籤照舊', () => {
    const { k, state, box } = world({})
    const mod = (mode: 'meat' | 'net', glow = 2) => {
      const a = battleOf(k, state, mode)
      a.pc.layers = glow
      return sum(a.run.mods('hit', a.pc).filter((p) => p.source === 'afterglow'))
    }
    expect(mod('net')).toBe(2)
    expect(mod('meat')).toBe(-2)
    box.sink = [{ unit_tag: AFTERGLOW_DOUBLE, label: '溺感邊緣' }]
    expect(mod('net')).toBe(4)
    expect(mod('meat')).toBe(-2)
  })

  it('造成感載的百分比（每層 +10%）也是正面的：加倍成每層 +20%；afterglowPer 負的不動', () => {
    const { k, state, box } = world({})
    const a = battleOf(k, state)
    expect(a.run.afterglowPer(a.pc, 10)).toBe(10)
    box.sink = [{ unit_tag: AFTERGLOW_DOUBLE }]
    const b = battleOf(k, state)
    expect(b.run.afterglowPer(b.pc, 10)).toBe(20)
    expect(b.run.afterglowPer(b.pc, -1)).toBe(-1)
    // 實際打一發神經傷害：兩層餘韻的人打出去的感載比沒有標籤的多
    const dealt = (tagged: boolean) => {
      box.sink = tagged ? [{ unit_tag: AFTERGLOW_DOUBLE }] : []
      const x = battleOf(k, state, 'meat', { foe: enemyUnit('minion', 1, { weapon: 'pistol' }) })
      x.pc.layers = 2
      x.foe.load = { now: 0, max: 100 }
      x.foe.sensitivity = 100
      return x.run.damage(x.foe, 20, 'neural', x.pc).dealt
    }
    expect(dealt(true)).toBeGreaterThan(dealt(false))
  })
})

// ---- 10 同步最高檔 ----

describe('第 10 項：同步上限「最高到深檔」是核心的衍生數值 sync_cap_max', () => {
  it('基本是 3（全檔）；給 −1 最高到深，不管同步等級、沉溺與 sync_cap_bonus 加了多少；拿掉就回來', () => {
    const { k, box } = world({})
    const full = makeState({ pc: { skills: { sync: 6 }, ext: { bridge: { sensitivity: 100 } }, sink: 70 } })
    expect(SYNC_CAP_MAX_STAT).toBe('sync_cap_max')
    expect(k.stats.stat(full, 'pc', 'sync_cap_max')).toBe(3)
    expect(syncCapOf(k, full, 'pc')).toBe('full')
    box.tuning = [{ stat: 'sync_cap_max', amount: -1, label: '開不了全檔' }]
    expect(k.stats.stat(full, 'pc', 'sync_cap_max')).toBe(2)
    expect(syncCapOf(k, full, 'pc')).toBe('deep')
    // 本來就只到標準的人不變（它只往下夾，不抬高）
    const low = makeState({ pc: { skills: { sync: 0 } } })
    expect(syncCapOf(k, low, 'pc')).toBe('standard')
    box.tuning = []
    expect(syncCapOf(k, full, 'pc')).toBe('full')
  })
})

// ---- 11 damage.hp ----

describe('第 11 項：掛點 damage.hp（生命傷害要扣下去之前）：處理函式可以把一部分換成感載', () => {
  const play = (conv: ((amount: number) => number) | null, o: { bridge?: boolean } = {}) => {
    const { k, state } = world({}, o.bridge === false ? { pc: { ext: { bridge: null } } } : {})
    if (conv) k.battle.on('damage.hp', 'test', ({ amount, out }) => { out.toLoad = conv(amount) })
    const a = battleOf(k, state, 'meat', { foe: enemyUnit('minion', 1, { weapon: 'pistol' }) })
    a.pc.sensitivity = 100
    a.pc.armor = 0
    return a
  }

  it('沒有人回答：生命傷害照舊', () => {
    const a = play(null)
    const hp = a.pc.hp!.now
    expect(a.run.damage(a.pc, 10, 'physical').dealt).toBe(10)
    expect(a.pc.hp!.now).toBe(hp - 10)
    expect(a.pc.load!.now).toBe(0)
  })

  it('兩成換成感載：10 點傷害，生命扣 8、感載 +2（不乘敏感度）；紀錄那一拍寫著換了多少', () => {
    const a = play((n) => Math.round(n * 0.2))
    const hp = a.pc.hp!.now
    const r = a.run.damage(a.pc, 10, 'physical')
    expect(r.dealt).toBe(8)
    expect(a.pc.hp!.now).toBe(hp - 8)
    expect(a.pc.load!.now).toBe(2)
    expect(a.run.beats.find((b) => b.tag === 'damage')?.data).toMatchObject({ amount: 8, toLoad: 2 })
  })

  it('生命至少還是扣 1 點；要轉的比傷害還多也只轉到剩 1；沒有橋（沒有感載）的人不轉', () => {
    const a = play(() => 99)
    const hp = a.pc.hp!.now
    expect(a.run.damage(a.pc, 5, 'physical').dealt).toBe(1)
    expect(a.pc.hp!.now).toBe(hp - 1)
    expect(a.pc.load!.now).toBe(4)
    const b = play(() => 99, { bridge: false })
    expect(b.pc.load).toBeUndefined()
    const hp2 = b.pc.hp!.now
    expect(b.run.damage(b.pc, 5, 'physical').dealt).toBe(5)
    expect(b.pc.hp!.now).toBe(hp2 - 5)
  })
})

// ---- 12 per ----

describe('第 12 項：被動效果依軌道值縮放（per）', () => {
  const craving: PassiveEffect = { check: { attrs: ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'] }, per: { track: 'load', every: 10, amount: 1 }, label: '渴求' }

  it('戰鬥外：每 10 點感載 +1（讀角色的感載）；不到 10 點沒有這一筆；拿掉來源就回到原值', () => {
    const { k, box } = world({})
    box.tuning = [craving]
    const at = (load: number) => k.stats.checkModifiers(makeState({ pc: { load } }), 'pc', { attr: 'charm', tags: [] }).filter((p) => p.source === 'tuning')
    expect(at(0)).toEqual([])
    expect(at(9)).toEqual([])
    expect(at(10)).toEqual([{ label: '渴求', value: 1, source: 'tuning' }])
    expect(at(25)).toEqual([{ label: '渴求', value: 2, source: 'tuning' }])
    box.tuning = []
    expect(at(25)).toEqual([])
  })

  it('三種軌道與負的數字：stat 依餘韻層數每層 +2、attr 依沉溺每 20 點 −1', () => {
    const { k, box } = world({})
    box.cyber = [{ stat: 'ap_max', per: { track: 'afterglow', every: 1, amount: 2 } }, { attr: 'body', per: { track: 'sink', every: 20, amount: -1 } }]
    const s = makeState({ pc: { afterglow: 2, sink: 45 } })
    const base = k.stats.stat(makeState(), 'pc', 'ap_max')
    expect(k.stats.stat(s, 'pc', 'ap_max')).toBe(base + 4)
    expect(k.stats.effectiveAttr(s, 'pc', 'body')).toBe(8)
  })

  it('戰鬥裡的修正用單位這一場當下的感載（不是角色的）：感載一路上來，每 10 點多 +1', () => {
    const { k, state, box } = world({})
    box.tuning = [{ mod: 'hit', per: { track: 'load', every: 10, amount: 1 }, label: '渴求' }]
    const a = battleOf(k, state)
    const hit = () => sum(a.run.mods('hit', a.pc).filter((p) => p.source === 'tuning'))
    expect(state.actors.pc!.load).toBe(0)
    expect(hit()).toBe(0)
    a.pc.load!.now = 25
    expect(hit()).toBe(2)
    a.pc.load!.now = 40
    expect(hit()).toBe(4)
  })

  it('passiveAmount：直接讀內容裡的效果的功能用它（amount 就是 amount、per 照軌道值、unit_tag 是 0）；格式：amount 與 per 剛好寫一個、per 的欄位要對', () => {
    const state = makeState({ pc: { load: 30 } })
    expect(passiveAmount({ stat: 'x', amount: 3 }, state, 'pc')).toBe(3)
    expect(passiveAmount({ stat: 'x', per: { track: 'load', every: 10, amount: 2 } }, state, 'pc')).toBe(6)
    expect(passiveAmount({ stat: 'x', per: { track: 'load', every: 10, amount: 2 } }, state, 'pc', { load: 50 })).toBe(10)
    expect(passiveAmount({ unit_tag: 't' }, state, 'pc')).toBe(0)
    const k = createKernel([])
    const p = (e: unknown) => passiveProblems(k, e).join('｜')
    expect(p({ stat: 'x', per: { track: 'load', every: 10, amount: 1 } })).toBe('')
    expect(p({ stat: 'x', amount: 1, per: { track: 'load', every: 10, amount: 1 } })).toContain('只能寫一個')
    expect(p({ stat: 'x', per: { track: 'nope', every: 10, amount: 1 } })).toContain('per.track')
    expect(p({ stat: 'x', per: { track: 'load', every: 0, amount: 1 } })).toContain('per.every')
    expect(p({ stat: 'x', per: { track: 'load', every: 10, amount: 0 } })).toContain('per.amount')
    expect(p({ unit_tag: 'x', per: { track: 'load', every: 10, amount: 1 } })).toContain('沒有 per 這個欄位')
  })
})

// ---- 13 sink_resist ----

describe('第 13 項：sink_resist（沉溺每次上升 −1、最少 1）核心要讀的兩條路', () => {
  it('sinkRise：上升 3 變 2、2 變 1、1 還是 1、不帶標籤不變', () => {
    expect([3, 2, 1].map((n) => sinkRise(n, true))).toEqual([2, 1, 1])
    expect([3, 2, 1].map((n) => sinkRise(n, false))).toEqual([3, 2, 1])
  })

  it('戰鬥：run.gainSink 讀單位標籤（快感傷害每次 +1 不受影響、直接加 3 的變 2）；戰後昏倒的 +2 變 +1', () => {
    const { k, state, box } = world({})
    const a = battleOf(k, state)
    expect(a.run.gainSink(a.pc, 3)).toBe(3)
    box.tuning = [{ unit_tag: SINK_RESIST }]
    const b = battleOf(k, state)
    expect(b.run.gainSink(b.pc, 3)).toBe(2)
    expect(b.run.gainSink(b.pc, 1)).toBe(1)
    expect(b.pc.sink).toBe(3)
  })

  it('角色的 sink 效果（往上加的那一邊）：帶標籤的人 +3 變 +2；往下降（負的）不受影響；沒有標籤不變', () => {
    const { k, state, box } = world({})
    const resolve = (amount: number) => k.effects.resolve([{ kind: 'sink', amount }], effectCtx(k, makeState({ pc: { sink: 10 } }), { source: 'builtin' })).changes
    void state
    expect(resolve(3)).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 3 }])
    box.tuning = [{ unit_tag: SINK_RESIST }]
    expect(resolve(3)).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 2 }])
    expect(resolve(1)).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 1 }])
    expect(resolve(-3)).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: -3 }])
  })
})

// ---- 14 turn.control ----

describe('第 14 項：掛點 turn.control（傀儡絲：這一回合被遠端操控）', () => {
  /** 兩個我方（a1 是主角、a2 是夥伴）對一個敵人；只有 a1 被操控。 */
  const setup = (puppet: (unit: BattleUnit) => boolean) => {
    const k = createKernel([characterFeature, combatFeature])
    k.content.loadPack(PACK)
    k.battle.on('turn.control', 'test', ({ unit, out }) => { if (puppet(unit)) { out.puppet = true; out.why = '的義肢不聽使喚' } })
    const mate = { ...makeState().actors.pc!, id: 'mate', name: '夥伴', role: 'companion' as const }
    const state = makeState({ actors: [mate as never] })
    const a = battleOf(k, state, 'meat', { allies: ['pc', 'mate'] })
    return { k, a }
  }

  it('回合開始時被問到：控制權變成 ai、記著原本是誰；目標是自己這一方的別人（不含自己）；回合結束時還原', () => {
    const { a } = setup((u) => u.id === 'a1')
    const me = a.units.a1!
    me.control = 'player'
    expect(hostileSide(me)).toBe('foe')
    beginTurn(a.run, me)
    expect(me.control).toBe('ai')
    expect(me.puppet).toEqual({ control: 'player', why: '的義肢不聽使喚' })
    expect(hostileSide(me)).toBe('ally')
    expect(hostiles(a.battle, me).map((u) => u.id)).toEqual(['a2'])
    expect(a.run.beats.some((b) => b.text.includes('不聽使喚'))).toBe(true)
    // 回合結束：輪到下一個人之前還原（currentUnit 要是 a1 才會走這一段）
    a.battle.turn = a.battle.order.indexOf('a1')
    advance(a.run)
    expect(me.control).toBe('player')
    expect(me.puppet).toBeUndefined()
    expect(hostileSide(me)).toBe('foe')
  })

  it('沒有人設 puppet 什麼都不變；敵人的回合也問、不變成別人的目標', () => {
    const { a } = setup(() => false)
    const me = a.units.a1!
    me.control = 'player'
    beginTurn(a.run, me)
    expect(me.control).toBe('player')
    expect(me.puppet).toBeUndefined()
    expect(hostiles(a.battle, me).map((u) => u.id)).toEqual(['f1'])
  })

  it('被操控的回合 AI 替他做：射擊的目標是夥伴，不是對面的敵人（對面的不在目標清單裡）', () => {
    const { k, a } = setup((u) => u.id === 'a1')
    const me = a.units.a1!
    me.control = 'player'
    const weapon = a.units.f1!.weapons[0]!
    me.weapons = [clone(weapon)]
    me.ap.now = 4
    beginTurn(a.run, me)
    const shoot = k.battle.getAction('shoot')!
    const targets = shoot.targets!(a.run, me).map((t) => ('unit' in t.target ? t.target.unit : ''))
    expect(targets).toEqual(['a2'])
    const mateHp = a.units.a2!.hp!.now
    // aiStep 會挑夥伴、打出去（骰面靠種子，打不中也算做了一次）；對面的敵人一滴血都沒掉
    let did = false
    for (let i = 0; i < 4 && !did && me.ap.now > 0; i++) did = aiStep(a.run, me)
    expect(did).toBe(true)
    expect(a.run.beats.some((b) => b.data?.attacker === 'a1' && b.data?.target === 'a2')).toBe(true)
    expect(a.units.f1!.hp!.now).toBe(a.units.f1!.hp!.max)
    expect(a.units.a2!.hp!.now).toBeLessThanOrEqual(mateHp)
  })
})

// ---- 18 until next_attack、BattleEndExtra.triggers ----

describe('第 18 項：狀態的 until 多一種「到下一次攻擊」；BattleEndExtra 收 triggers', () => {
  it('next_attack 在清單裡；挑的「下一次命中 −1」：打出去的那一擊吃 −1，擲完就結束；第二次攻擊不再有', () => {
    expect(STATUS_UNTILS).toContain('next_attack')
    const { k, state } = world({})
    const a = battleOf(k, state)
    // 敵人是攻擊的人（它的武器 pistol）；對主角打
    expect(a.run.applyStatus(a.foe, 'blind_hit', { quiet: true })).toBe(true)
    expect(a.foe.statuses[0]!.until).toEqual({ at: 'attack' })
    const first = a.run.attack(a.foe, a.pc, { natural: 10 })
    expect(a.foe.statuses.some((s) => s.id === 'blind_hit')).toBe(false)
    expect(sum(a.run.mods('hit', a.foe))).toBe(0)
    // 第二次攻擊沒有這個 −1：同樣的骰面，合計比第一次多 1
    const second = a.run.attack(a.foe, a.pc, { natural: 10 })
    expect(second.total - 10).toBe(first.total - 10 + 1)
  })

  it('沒有攻擊就留到整場結束（回合開始與結束都不會數掉它）', () => {
    const { k, state } = world({})
    const a = battleOf(k, state)
    a.run.applyStatus(a.foe, 'blind_hit', { quiet: true })
    a.foe.control = 'ai'
    beginTurn(a.run, a.foe)
    advance(a.run)
    expect(a.foe.statuses.map((s) => s.id)).toContain('blind_hit')
  })

  it('BattleEndExtra.triggers：功能掛在結束的報告上，結束的那一份報告 triggers 帶著、不另外接報告', async () => {
    const g = makeGame({ features: [characterFeature, combatFeature, { id: 'trig', install: (k: Kernel) => k.battle.onEnd('trig', () => ({ lines: ['有人沉了'], triggers: [{ point: 'foe_sunk', where: { enemy: 'x' } }] })) }] }).game
    g.startBattle({ mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: [{ from: 'actor', id: 'pc' }], foes: [raw(enemyUnit('minion', 1))] as never, origin: { escapable: true } })
    g.state.battle!.result = { outcome: 'win', text: '贏了。' }
    const r = await g.finishBattle()
    const end = r.reports.find((x) => x.action === 'battle.end')!
    expect(end.triggers).toEqual([{ point: 'foe_sunk', where: { enemy: 'x' } }])
    expect(r.reports.filter((x) => x.action !== 'battle.end' && x.triggers?.some((t) => t.point === 'foe_sunk'))).toEqual([])
  })
})

// ---- 19 amnesia ----

describe('第 19 項：ReportOutcome 的 amnesia 是型別上的選填欄位', () => {
  it('不必轉型就能寫 amnesia: true；沒寫是 undefined', () => {
    const a: ReportOutcome = { result: 'done', summary: '賺了一點。', amnesia: true }
    const b: ReportOutcome = { result: 'done', summary: '賺了一點。' }
    expect(a.amnesia).toBe(true)
    expect(b.amnesia).toBeUndefined()
  })
})

// ---- 9 內容檢查 ----

describe('第 9 項：建角規則的新欄位、物品與設計圖的 available、出身的 kit_free 進核心的內容檢查', () => {
  const BASE_RULE = { id: 'default', attr_array: [14, 12, 10, 10, 8, 8], attr_free: 0, attr_max: 18, attr_min: 6, skill_points: 12, skill_max: 3, perk_points: 2, perk_max: 3, flaw_max: 2, min_age: 18, start_money: 1000 }
  const load = (content: Record<string, unknown[]>) => {
    const k = createKernel([])
    k.content.loadPack({ id: 'p', content } as unknown as ContentPack)
    return k
  }
  const problems = (content: Record<string, unknown[]>): string => {
    try {
      load(content)
      return ''
    } catch (e) {
      return e instanceof ContentError ? e.message : String(e)
    }
  }
  const ITEM = { id: 'it_a', name: '東西', desc: '一件東西。', category: 'consumable', grade: 1, size: 0, legal: 'free' }
  const BP = { id: 'bp_a', kind: 'weapon', name: '槍', desc: '一把槍。', brand: 'hz', grade: 1, legal: 'free', price: 100, size: 1, weight: 1, require: [], optional: [], class: 'pistol', carry: 'main' }

  it('creation_rule：五個新欄位好的收、壞的擋下（價錢與倍率要大於 0、等級上限 1～5 的整數、類別是字串陣列）', () => {
    expect(problems({ creation_rule: [{ ...BASE_RULE, cyber_point_price: 400, cyber_install_mult: 1.5, gear_point_price: 250, gear_grade_max: 3, gear_kinds: ['weapon', 'armor'] }] })).toBe('')
    for (const bad of [{ cyber_point_price: 0 }, { cyber_install_mult: -1 }, { gear_point_price: '250' }, { gear_grade_max: 'II' }, { gear_grade_max: 6 }, { gear_kinds: 'weapon' }, { gear_kinds: [1] }]) {
      expect(problems({ creation_rule: [{ ...BASE_RULE, ...bad }] }), JSON.stringify(bad)).toContain(Object.keys(bad)[0]!)
    }
  })

  it('物品與設計圖的 available：{ origins?, faction? }；格式不對擋下（含不認得的鍵）', () => {
    expect(problems({ item: [{ ...ITEM, available: { origins: ['corp'], faction: 'hz' } }] })).not.toContain('available')
    for (const bad of [{ origins: [] }, { origins: 'corp' }, { faction: 3 }, { nope: 1 }, 'corp']) {
      expect(problems({ item: [{ ...ITEM, available: bad }] }), JSON.stringify(bad)).toContain('available')
      expect(problems({ blueprint: [{ ...BP, available: bad }] }), JSON.stringify(bad)).toContain('available')
    }
  })

  it('available 的出身與勢力要查得到（引用檢查）', () => {
    const k = load({ item: [{ ...ITEM, available: { origins: ['no_such_origin'], faction: 'no_such_faction' } }] })
    const refs = k.content.checkRefs()
    expect(refs.join('｜')).toContain('origin/no_such_origin')
    expect(refs.join('｜')).toContain('faction/no_such_faction')
  })

  it('出身的 kit_free：{ id, qty? } 的陣列，數量 1～99；格式不對擋下', () => {
    const ORIGIN = { id: 'og', name: '出身', line: '一句。', home: 'd_x', skill_bonus: { brawl: 1 }, status: 'poor', favor: { choose_one: ['f_a'], value: 1 }, perk: 'pk', roster: [] }
    const msg = (kit_free: unknown) => problems({ origin: [{ ...ORIGIN, kit_free }] })
    expect(msg([{ id: 'it_a', qty: 2 }, { id: 'bp_a' }])).not.toContain('kit_free')
    expect(msg('it_a')).toContain('kit_free 要是')
    expect(msg([{ qty: 1 }])).toContain('kit_free[0]')
    expect(msg([{ id: 'it_a', qty: 0 }])).toContain('kit_free[0].qty')
    expect(msg([{ id: 'it_a', qty: 100 }])).toContain('kit_free[0].qty')
  })
})

// ---- 16 action.window ----

describe('第 16 項：自由行動的視窗（核心的掛點 action.window）', () => {
  const FREE = { kind: 'free', text: '我想想怎麼辦' }
  const make = (handler?: (p: { input: { kind: string; text?: string } }) => unknown) => {
    const g = makeGame({ features: [characterFeature] }).game
    if (handler) g.k.hooks.on('action.window', 'test', handler as never)
    return g
  }

  it('沒有人回答：選項是空的、沒有替玩家選；prepareAction 照原本的行動擲骰，沒有 replaced', () => {
    const g = make()
    expect(actionWindow(g.k, g.state, FREE)).toEqual({ options: [] })
    const p = prepareAction(g.k, g.state, FREE)
    expect(p.input).toEqual(FREE)
    expect(p.replaced).toBeUndefined()
  })

  it('插一個選項：帶是誰插的；行動種類查不到的選項不列', () => {
    const g = make(() => ({ option: { id: 'whisper', label: '順著那個聲音說', input: { kind: 'free', text: '好' } } }))
    expect(actionWindow(g.k, g.state, FREE).options).toEqual([{ id: 'whisper', label: '順著那個聲音說', input: { kind: 'free', text: '好' }, owner: 'test' }])
    const h = make(() => ({ option: { id: 'x', label: '不存在的行動', input: { kind: 'no_such_kind' } } }))
    expect(actionWindow(h.k, h.state, FREE).options).toEqual([])
  })

  it('替玩家選：prepareAction 擲的是換掉之後的行動，pending.replaced 記著原本的、原因與誰換的；換成不存在的行動、或和原本一樣的不換', () => {
    const g = make(() => ({ replace: { input: { kind: 'free', text: '好' }, why: '那個聲音搶在你前面開了口。' } }))
    const p = prepareAction(g.k, g.state, FREE)
    expect(p.input).toEqual({ kind: 'free', text: '好' })
    expect(p.replaced).toEqual({ from: FREE, why: '那個聲音搶在你前面開了口。', owner: 'test' })
    const h = make(() => ({ replace: { input: { kind: 'no_such_kind' }, why: '亂換。' } }))
    expect(prepareAction(h.k, h.state, FREE).replaced).toBeUndefined()
    const same = make(() => ({ replace: { input: FREE, why: '沒換。' } }))
    expect(prepareAction(same.k, same.state, FREE).replaced).toBeUndefined()
  })

  it('替玩家選只能換成同一種行動（M4 收尾修正批 應修 2）：換成別種（就算存在、沒被擋）不收，免得繞過原本的任務鏈與放行', () => {
    const g = makeGame({ features: [characterFeature] }).game
    g.k.actions.register({ id: 'other_kind', name: '別的行動', owner: 'test', reportKind: 'action', attr: 'charm', dc: 10, minutes: 5, maxMinutes: 30 } as never)
    g.k.hooks.on('action.window', 'test', (() => ({ replace: { input: { kind: 'other_kind' }, why: '換成別的。' } })) as never)
    expect(actionWindow(g.k, g.state, FREE).replace).toBeUndefined()
    expect(prepareAction(g.k, g.state, FREE).replaced).toBeUndefined()
  })

  it('替玩家選的原因進報告：timeline 多一拍 action.override（帶原本的 input 與是誰換的）、結果與摘要多一句原因；沒有被換的行動沒有這一拍', () => {
    const g = make(() => ({ replace: { input: { kind: 'free', text: '好' }, why: '那個聲音搶在你前面開了口。' } }))
    const p = prepareAction(g.k, g.state, FREE)
    const d = buildActionReport(g.k, g.state, { pending: p, judgment: fallbackJudgment(p), reward: noReward, uncovered: [] })
    expect(d.timeline[0]).toMatchObject({ tag: 'action.override', text: '那個聲音搶在你前面開了口。', data: { from: FREE, owner: 'test' } })
    expect(d.narration?.results?.[0]).toBe('那個聲音搶在你前面開了口')
    expect(d.outcome.summary).toContain('那個聲音搶在你前面開了口。')
    expect(d.args).toMatchObject({ kind: 'free', text: '好' })
    const plain = make()
    const q = prepareAction(plain.k, plain.state, FREE)
    const e = buildActionReport(plain.k, plain.state, { pending: q, judgment: fallbackJudgment(q), reward: noReward, uncovered: [] })
    expect(e.timeline.map((b) => b.tag)).not.toContain('action.override')
  })

  it('重擲：換過的行動還是換過的、原因與原本的行動原樣帶下去（原本只剩換過的那一句、記號丟了）；骰面換一顆、舊的記進 history', () => {
    const g = make(() => ({ replace: { input: { kind: 'free', text: '好' }, why: '那個聲音搶在你前面開了口。' } }))
    const p = prepareAction(g.k, g.state, FREE)
    const again = rerollAction(g.k, g.state, p)
    expect(again.replaced).toEqual(p.replaced)
    expect(again.input).toEqual(p.input)
    expect(again.reroll).toBe(1)
    expect(again.history).toEqual([p.roll.natural])
    const third = rerollAction(g.k, g.state, again)
    expect(third.replaced).toEqual(p.replaced)
    // 視窗這一次不再回答換（回答不是從狀態導出的）：用換過的那一個，記號照樣帶著
    let calls = 0
    const h = make(() => (calls++ === 0 ? { replace: { input: { kind: 'free', text: '好' }, why: '那個聲音搶在你前面開了口。' } } : undefined))
    const q = prepareAction(h.k, h.state, FREE)
    expect(rerollAction(h.k, h.state, q).replaced).toEqual(q.replaced)
  })
})
