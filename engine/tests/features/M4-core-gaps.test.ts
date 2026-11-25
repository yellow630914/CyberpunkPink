// 驗收測試：dev/work/M4-core-gaps.md 的功能項（義體：第 1、2 項的資料端、3、4、5、20；網內與成人場景：4、15、16、17）。每一項至少一條行為測試。
// 規格：CYBERWARE 第 2、3、5 節；ITEMS 11.5 節；COMBAT_SYSTEM 第 6 節；LEWD_SYSTEM 3.1 節；dev/adr/0019 實作補記：M4-core-gaps。
// 內容一律用測試自帶的最小假資料：橋、義眼兩隻、腦裡的反射加速器、藥泵、冷卻迴路（jammable）、皮下裝甲、駭入接頭（trace_mod mult 0）、回報後門的晶片（trace_mod 夜鶯）、記憶庫（readable）、痛覺編輯器。
// 戰鬥直接沿用 M4-cyber-battle 的做法（makeGame 加 combat 與 cyberware、敵人不動）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, ContentPack, ReportDraft } from '../../src'
import { BattleRun, ContentError, clone, currentUnit } from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { PUMP_ACTION, cyberLive, cyberOf, cyberwareFeature, deckSourceOf, woundedUids } from '../../src/features/cyberware'
import { hackedAnswer, hackTraceAnswer, netTraceAnswer } from '../../src/features/cyberware/trace'
import { enemyUnit, makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const bp = (id: string, slot: string, over: Rec = {}): Rec => ({
  id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 2, legal: 'register', price: 900, require: [], optional: [], slot, invasiveness: 'light', sink_cost: 3, ...over,
})
const BLUEPRINTS = [
  bp('bp_bridge', 'bridge', { name: '橋', bridge: { tuning_slots: 2 } }),
  bp('bp_eye', 'eye', { name: '義眼', implant_kind: 'eye', effects: [{ attr: 'reflex', amount: 1 }] }),
  bp('bp_arm', 'arm', { name: '義臂', implant_kind: 'limb', effects: [{ mod: 'damage', amount: 2 }] }),
  bp('bp_brain_deck', 'brain', { name: '腦裡的甲板', deck: { slots: 3, firewall: 5 } }),
  bp('bp_heat', 'torso', { name: '熱驅動', battle: { scaling: [{ mod: 'damage', per_load: 10, amount: 1, tags: ['melee'] }] } }),
  bp('bp_cooler', 'torso', { name: '冷卻迴路', battle: { actions: [{ id: 'cyber_cooler', name: '冷卻迴路', icon: 'cooler', ap: 1, jammable: true, do: [{ op: 'vent', amount: 6 }] }] } }),
  bp('bp_pump', 'torso', { name: '藥泵', battle: { pump: true } }),
  bp('bp_kick', 'leg', { name: '推進腿', implant_kind: 'limb', battle: { toggle: { id: 'cyber_kick', name: '推進腿', icon: 'kick', upkeep_load: 2, mods: [{ mod: 'hit', amount: 1 }] } } }),
  // 駭入接頭：直接插進裝置，追蹤度不漲
  bp('bp_plug', 'arm', { name: '駭入接頭', implant_kind: 'limb', trace_mod: [{ mult: 0 }] }),
  // 夜鶯牌的晶片：在夜鶯的子網裡起跳 +5、每次上升 +1（回報後門）
  bp('bp_backdoor', 'brain', { name: '夜曲', trace_mod: [{ faction: 'f_nightingale', start: 5, rise: 1 }] }),
  // 皮下裝甲：不會被特殊效果打壞（只保護它自己那一種）；痛覺編輯器：無視重傷懲罰
  bp('bp_subdermal', 'torso', { name: '皮下裝甲', effects: [{ unit_tag: 'implant_hardened:torso', label: '皮下裝甲' }] }),
  bp('bp_pain_editor', 'brain', { name: '痛覺編輯器', effects: [{ unit_tag: 'ignore_wound_penalty', label: '痛覺編輯器' }] }),
  // 記憶庫：被駭時被讀走
  bp('bp_memory', 'brain', { name: '記憶庫', readable: { what: 'memory' } }),
]
const STATUS = (id: string, name: string, over: Rec = {}): Rec => ({ id, name, desc: `${name}。`, until: 'own_turn_end', turns: 1, kind: 'debuff', ...over })
const STATUSES = [
  STATUS('limb_hurt', '肢體受創', { until: 'battle_end', kind: 'wound' }), STATUS('dazed', '暈眩', { until: 'battle_end', kind: 'wound' }), STATUS('bleeding', '流血', { until: 'battle_end', kind: 'wound' }),
  STATUS('off_eye', '義眼失效'), STATUS('off_limb', '義肢失效'), STATUS('off_generic', '義體失效'),
  STATUS('pump_jam', '斷藥', { turns: 2 }),
]
const ITEMS = [
  { id: 'it_stim', name: '興奮劑', desc: '一劑藥。', category: 'drug', grade: 1, size: 0, legal: 'free', drug: { duration: { battle: true } }, use: { ap: 1, target: 'self', effects: [{ op: 'vent', amount: 5 }] } },
]
const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = { blueprint: clone(BLUEPRINTS), battle_status: clone(STATUSES), item: clone(ITEMS) }
  patch(c)
  return { id: 'core_gaps_features', content: c as unknown as ContentPack['content'] }
}

const PARAMS = { sensitivity: 50, tolerance: 30, craving: 30, docility: 30 }
const piece = (uid: string, bpId: string, slot: string, over: Rec = {}): Rec => ({ uid, bp: bpId, slot, parts: {}, sink: 3, at: 0, ...over })
const BRIDGE = piece('b1', 'bp_bridge', 'bridge', { sink: 4 })

interface Opts { pieces?: Rec[]; conditions?: string[]; mate?: boolean }
const make = (o: Opts = {}) => {
  const mate = makeActor({ id: 'mate', role: 'companion', name: '夥伴', ext: { bridge: PARAMS, cyber: { pieces: [BRIDGE] } } })
  const { game } = makeGame({
    features: [characterFeature, combatFeature, cyberwareFeature], content: [pack()], seed: 7,
    pc: { hp: 40, conditions: (o.conditions ?? []).map((id) => ({ id })), ext: { bridge: PARAMS, cyber: { pieces: o.pieces ?? [BRIDGE] } } },
    actors: o.mate ? [mate] : [],
  })
  return game
}
type G = ReturnType<typeof make>

const foe = () => ({ from: 'unit', unit: enemyUnit('minion', 1, { weapon: 'pistol', ap: { now: 0, max: 0, regen: 0 } }) as unknown as Rec })
const setup = (): BattleSetup => ({
  mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
  allies: [{ from: 'actor', id: 'pc' }], foes: [foe()] as never, origin: { escapable: true, place: '測試的巷子' },
})
const fight = (o: Opts = {}): G => {
  const g = make(o)
  g.startBattle(setup())
  return g
}
const unit = (g: G, id: string) => g.battle!.units[id]!
/** 一直往下輪，輪到這個單位為止（玩家的人結束回合、其他的由程式代打）。 */
function toTurn(g: G, id: string): void {
  for (let i = 0; i < 80; i++) {
    const cur = currentUnit(g.battle!)
    if (!cur) throw new Error('戰鬥已經沒有輪到的人')
    if (cur.id === id) return
    const r = cur.control === 'player' ? g.battleAct({ action: 'end_turn' }) : g.battleNext({ anyone: true })
    expect(r.status).toBe('applied')
  }
  throw new Error(`輪不到 ${id}`)
}
const run = (g: G): BattleRun => new BattleRun(g.k, g.state, clone(g.battle!))
const ids = (g: G): string[] => g.battleOptions()!.actions.map((a) => a.id)
const optionOf = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)

/** 戰鬥中途打出一次重創（第二次打同一個部位就是重的）：在一份複本上讓 wound 掛點跑，回傳那一份複本上的主角單位。 */
function woundOnce(g: G, part: 'head' | 'limb', times = 2): { r: BattleRun; u: ReturnType<typeof unit> } {
  const r = run(g)
  const u = r.battle.units.a1!
  for (let i = 0; i < times; i++) g.k.battle.emit('wound', { run: r, attacker: r.battle.units.f1!, target: u, aimed: true, part })
  return { r, u }
}

// ---- 3 戰鬥中途的重創 ----

describe('第 3 項：戰鬥中途打出重的重創（頭、肢體）：義眼與腦裡的甲板、手臂與腿的義體這一場當下失效', () => {
  const eyes = [BRIDGE, piece('e1', 'bp_eye', 'eye'), piece('e2', 'bp_eye', 'eye')]
  const reflex = (g: G): number => g.k.stats.effectiveAttr(g.state, 'pc', 'reflex')

  it('輕的一級（第一次）不動義體；第二次（重的）第一隻義眼被打壞：implants、have 拿掉，紀錄一拍，第二隻照樣在', () => {
    const g = fight({ pieces: eyes })
    expect(unit(g, 'a1').implants).toHaveLength(2)
    const light = woundOnce(g, 'head', 1)
    expect(light.u.wounds.head).toBe(1)
    expect(light.u.implants).toHaveLength(2)
    const { r, u } = woundOnce(g, 'head')
    expect(u.wounds.head).toBe(2)
    expect(u.implants).toEqual([{ kind: 'eye', name: '義眼' }])
    expect(u.cyber).toBe(1)
    expect(r.beats.some((b) => b.text.includes('義眼被打壞了'))).toBe(true)
    // 同一部位再打一次（已經是重的）不會再壞第二隻：失效的是「第一件」，同一件不重複記
    g.k.battle.emit('wound', { run: r, attacker: r.battle.units.f1!, target: u, aimed: true, part: 'head' })
    expect(u.implants).toHaveLength(1)
  })

  it('讀的時候算、不寫狀態：戰鬥的狀態裡主角頭部重創到第二級，cyberLive 就把第一隻義眼當成 off（why wound）、屬性少那 1；戰鬥結束或拿掉就回來', () => {
    const g = fight({ pieces: eyes })
    expect(reflex(g)).toBe(12)
    g.state.battle!.units.a1!.wounds.head = 2
    expect(cyberLive(g.state, 'pc').filter((p) => p.off).map((p) => [p.uid, p.off!.why])).toEqual([['e1', 'wound']])
    expect(reflex(g)).toBe(11)
    // 沒有寫進角色：身上的義體沒有 off、也沒有 wound_head 的狀況
    expect(cyberOf(g.state, 'pc').filter((p) => p.off)).toEqual([])
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'wound_head')).toBe(false)
    g.state.battle!.units.a1!.wounds.head = 1
    expect(reflex(g)).toBe(12)
  })

  it('頭的重創也打壞腦裡的甲板（沒有眼時）；肢體的重創打壞第一件手臂或腿', () => {
    const brain = make({ pieces: [BRIDGE, piece('d1', 'bp_brain_deck', 'brain')] })
    expect(deckSourceOf(brain.k, brain.state, 'pc')?.uid).toBe('d1')
    brain.startBattle(setup())
    brain.state.battle!.units.a1!.wounds.head = 2
    expect(deckSourceOf(brain.k, brain.state, 'pc')).toBeUndefined()
    const limbs = [BRIDGE, piece('l1', 'bp_arm', 'arm_r'), piece('k1', 'bp_kick', 'leg_l')]
    const g = fight({ pieces: limbs })
    expect(unit(g, 'a1').implants!.map((i) => i.name)).toEqual(['義臂', '推進腿'])
    const { u } = woundOnce(g, 'limb')
    expect(u.implants!.map((i) => i.name)).toEqual(['推進腿'])
    expect([...woundedUids({ ...g.state, battle: { ...g.state.battle!, units: { a1: { ...unit(g, 'a1'), wounds: { limb: 2 } } } } as never }, 'pc')]).toEqual(['l1'])
  })

  it('失效的那一件的開關跟著關掉；別的義體、別人的單位、敵人不受影響；沒有義體的人什麼都不發生', () => {
    const g = fight({ pieces: [BRIDGE, piece('k1', 'bp_kick', 'leg_l'), piece('h1', 'bp_heat', 'torso')], mate: true })
    // 開著推進腿，然後肢體重創
    const r = run(g)
    const u = r.battle.units.a1!
    ;(u.ext.cyber as Rec).on = { cyber_kick: true }
    g.k.battle.emit('wound', { run: r, attacker: r.battle.units.f1!, target: u, aimed: true, part: 'limb' })
    g.k.battle.emit('wound', { run: r, attacker: r.battle.units.f1!, target: u, aimed: true, part: 'limb' })
    expect(u.implants!.map((i) => i.name)).toEqual(['熱驅動'])
    expect((u.ext.cyber as Rec).on).toBeUndefined()
    expect(r.beats.some((b) => b.text.includes('推進腿關掉了'))).toBe(true)
    // 隊友沒有義體：同樣的重創不出任何事
    const bare = fight({ pieces: [BRIDGE] })
    const w = woundOnce(bare, 'head')
    expect(w.u.implants).toBeUndefined()
    expect(w.r.beats.some((b) => b.text.includes('被打壞'))).toBe(false)
  })
})

// ---- 1、2 資料端：義體用被動效果給標籤 ----

describe('第 1、2 項的資料端：痛覺編輯器與皮下裝甲用被動效果 { unit_tag } 給核心的標籤', () => {
  it('皮下裝甲：進戰鬥的單位帶 implant_hardened:torso，特殊效果挑不到它（挑別的義體）；拆掉就挑得到', () => {
    const g = fight({ pieces: [BRIDGE, piece('s1', 'bp_subdermal', 'torso'), piece('a1', 'bp_arm', 'arm_r')] })
    const r = run(g)
    const u = r.battle.units.a1!
    expect(u.tags).toContain('implant_hardened:torso')
    expect(u.implants!.map((i) => i.name)).toEqual(['皮下裝甲', '義臂'])
    expect(r.implantStatus(u, 'off')?.name).toBe('義臂')
    expect(r.implantStatus(u, 'off', { kind: 'torso' })).toBeNull()
    const bare = fight({ pieces: [BRIDGE, piece('t1', 'bp_heat', 'torso')] })
    const r2 = run(bare)
    expect(r2.implantStatus(r2.battle.units.a1!, 'off', { kind: 'torso' })?.name).toBe('熱驅動')
  })

  it('痛覺編輯器：生命低於一半也沒有重傷的 −2（戰鬥裡與戰鬥外的檢定都是）；沒裝的人有', () => {
    const hurt = (pieces: Rec[]) => {
      const g = fight({ pieces })
      const r = run(g)
      const u = r.battle.units.a1!
      u.hp!.now = 5
      return { hit: r.mods('hit', u).some((p) => p.label === '重傷'), check: g.k.stats.checkModifiers({ ...g.state, actors: { ...g.state.actors, pc: { ...g.state.actors.pc!, hp: 5 } } }, 'pc', { attr: 'body', tags: [] }).some((p) => p.label === '重傷') }
    }
    expect(hurt([BRIDGE])).toEqual({ hit: true, check: true })
    expect(hurt([BRIDGE, piece('p1', 'bp_pain_editor', 'brain')])).toEqual({ hit: false, check: false })
  })
})

// ---- 5 斷藥 ----

describe('第 5 項：斷藥（狀態 pump_jam）：藥泵與標了 jammable 的行動（冷卻迴路）灰掉，說原因；別的義體照常', () => {
  const pieces = [BRIDGE, piece('p1', 'bp_pump', 'torso', { loaded: { item: 'it_stim', qty: 2 } }), piece('c1', 'bp_cooler', 'torso'), piece('h1', 'bp_heat', 'torso')]
  const jam = (g: G): void => { toTurn(g, 'a1'); unit(g, 'a1').statuses.push({ id: 'pump_jam', until: { at: 'battle_end' } }) }

  it('沒有斷藥：藥泵與冷卻迴路都能用', () => {
    const g = fight({ pieces })
    toTurn(g, 'a1')
    expect(optionOf(g, PUMP_ACTION)!.ok).toBe(true)
    expect(optionOf(g, 'cyber_cooler')!.ok).toBe(true)
  })

  it('帶著 pump_jam：藥泵與冷卻迴路灰掉、原因寫「斷藥中」；藥泵裡的藥沒有被用掉', () => {
    const g = fight({ pieces })
    jam(g)
    const pump = optionOf(g, PUMP_ACTION)!
    expect(pump.ok).toBe(false)
    expect(pump.blocks.join('')).toContain('斷藥中，藥泵')
    const cooler = optionOf(g, 'cyber_cooler')!
    expect(cooler.ok).toBe(false)
    expect(cooler.blocks.join('')).toContain('斷藥中，冷卻迴路')
    const r = g.battleAct({ action: PUMP_ACTION })
    expect(r.status).toBe('refused')
    expect(unit(g, 'a1').ext.cyber).toMatchObject({ pump: { p1: { item: 'it_stim', qty: 2 } } })
  })

  it('核心的 vent 也排不掉（除錯與回復對他都沒有效果）；沒有 jammable 的行動不受影響；斷藥拿掉就回來', () => {
    const g = fight({ pieces })
    jam(g)
    const r = run(g)
    const u = r.battle.units.a1!
    u.load!.now = 9
    expect(r.vent(u, 5)).toBe(0)
    expect(u.load!.now).toBe(9)
    expect(ids(g)).toContain('shoot')
    unit(g, 'a1').statuses = unit(g, 'a1').statuses.filter((s) => s.id !== 'pump_jam')
    expect(optionOf(g, PUMP_ACTION)!.ok).toBe(true)
    expect(optionOf(g, 'cyber_cooler')!.ok).toBe(true)
  })

  it('jammable 的格式：要是 true 或 false；寫別的在載入時擋下', () => {
    expect(() => makeGame({ features: [characterFeature, combatFeature, cyberwareFeature], content: [pack((c) => { c.blueprint!.find((b) => b.id === 'bp_cooler')!.battle.actions[0].jammable = 'yes' })] })).toThrow(ContentError)
  })
})

// ---- 4 追蹤度的義體回答 ----

describe('第 4 項：義體回答快駭與網內的追蹤度（hack.trace_mod、netrun.trace_mod）：駭入接頭不漲、回報後門起跳 +5 與每次 +1', () => {
  const g = make({ pieces: [BRIDGE, piece('g1', 'bp_plug', 'arm_l'), piece('d1', 'bp_backdoor', 'brain')] })
  const k = g.k

  it('快駭：駭入接頭 mult 0；回報後門只在夜鶯的那一場 add 1（faction 對不上不算）', () => {
    expect(hackTraceAnswer(k, g.state, 'pc', undefined)).toEqual({ mult: 0 })
    expect(hackTraceAnswer(k, g.state, 'pc', 'f_nightingale')).toEqual({ add: 1, mult: 0 })
    const only = make({ pieces: [BRIDGE, piece('d1', 'bp_backdoor', 'brain')] })
    expect(hackTraceAnswer(only.k, only.state, 'pc', 'f_nightingale')).toEqual({ add: 1 })
    expect(hackTraceAnswer(only.k, only.state, 'pc', 'f_other')).toBeUndefined()
  })

  it('網內探索：起跳只看 start（回報後門 +5）；上升看 rise 與 mult；隊上每個人的合起來；沒有義體的人沒有回答', () => {
    const only = make({ pieces: [BRIDGE, piece('d1', 'bp_backdoor', 'brain')], mate: true })
    expect(netTraceAnswer(only.k, only.state, ['pc', 'mate'], 'f_nightingale', 'start')).toEqual({ add: 5 })
    expect(netTraceAnswer(only.k, only.state, ['pc', 'mate'], 'f_nightingale', 'rise')).toEqual({ add: 1 })
    expect(netTraceAnswer(only.k, only.state, ['pc', 'mate'], 'f_other', 'start')).toBeUndefined()
    expect(netTraceAnswer(only.k, only.state, ['mate'], 'f_nightingale', 'start')).toBeUndefined()
    expect(netTraceAnswer(k, g.state, ['pc'], undefined, 'rise')).toEqual({ mult: 0 })
  })

  it('休養中、失效（off）的義體不回答；掛點真的接上：k.hooks.run 問得到', () => {
    const rest = make({ pieces: [BRIDGE, piece('g1', 'bp_plug', 'arm_l', { off: { why: 'lock' } }), piece('d1', 'bp_backdoor', 'brain', { ready_at: 999999 })] })
    expect(hackTraceAnswer(rest.k, rest.state, 'pc', 'f_nightingale')).toBeUndefined()
    const asked = k.hooks.run('hack.trace_mod', { state: g.state, actor: 'pc', layer: 'net', action: 'x', faction: 'f_nightingale', trace: 2 })
    expect(asked.map((x) => x.owner)).toEqual(['cyberware'])
    const net = k.hooks.run('netrun.trace_mod', { state: g.state, party: ['pc'], faction: 'f_nightingale', when: 'start', amount: 0 })
    expect(net.map((x) => x.result)).toEqual([{ add: 5 }])
  })

  it('設計圖的 trace_mod 與 readable 格式不對在載入時擋下', () => {
    const bad = (patch: Rec) => () => makeGame({ features: [characterFeature, combatFeature, cyberwareFeature], content: [pack((c) => { Object.assign(c.blueprint!.find((b) => b.id === 'bp_plug')!, patch) })] })
    expect(bad({ trace_mod: [{ mult: -1 }] })).toThrow(/trace_mod\[0\]\.mult/)
    expect(bad({ trace_mod: [{ faction: 'x' }] })).toThrow(/至少寫一個/)
    expect(bad({ trace_mod: [{ rise: 1.5 }] })).toThrow(/rise/)
    expect(bad({ trace_mod: [{ mult: 0, nope: 1 }] })).toThrow(/沒有這個欄位/)
    expect(bad({ readable: { what: 3 } })).toThrow(/readable\.what/)
    expect(bad({ readable: { wut: 'x' } })).toThrow(/readable/)
  })
})

// ---- 20 被駭時讀走 ----

describe('第 20 項：網內被駭（掛點 net.hacked）：記憶庫被對方讀走', () => {
  it('身上有生效的記憶庫就讀走（read 列來源、名字與 what，一句話寫是誰的哪一件）；沒有就沒有回答；休養中或失效的不算', () => {
    const g = make({ pieces: [BRIDGE, piece('m1', 'bp_memory', 'brain')], mate: true })
    const a = hackedAnswer(g.k, g.state, ['pc', 'mate'])!
    expect(a.read).toEqual([{ source: 'cyber', name: '記憶庫', what: 'memory' }])
    expect(a.lines).toEqual(['測試主角的記憶庫被對方讀走了。'])
    const none = make({ pieces: [BRIDGE] })
    expect(hackedAnswer(none.k, none.state, ['pc'])).toBeUndefined()
    const off = make({ pieces: [BRIDGE, piece('m1', 'bp_memory', 'brain', { off: { why: 'lock' } })] })
    expect(hackedAnswer(off.k, off.state, ['pc'])).toBeUndefined()
    // 掛點真的接上
    const asked = g.k.hooks.run('net.hacked', { state: g.state, run: {} as never, outcome: 'located', party: ['pc'] })
    expect(asked.map((x) => x.owner)).toEqual(['cyberware'])
  })

  it('沒有人聽的時候什麼都沒有（沒有裝 cyberware 的 kernel）', () => {
    const { game } = makeGame({ features: [characterFeature] })
    expect(game.k.hooks.run('net.hacked', { state: game.state, run: {} as never, outcome: 'located', party: ['pc'] })).toEqual([])
  })
})

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
void draft
