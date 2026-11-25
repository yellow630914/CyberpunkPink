// 驗收測試：dev/work/M4-followups-2.md（cpp-architect 角色，sonnet；「二十之二」甲欄）。每一項至少一條行為測試。
// 這個檔案放核心、熔斷器、抵抗標籤、場景、各功能的零碎項目；有現成假資料的項目（M4-craft 的同人與排異、M4-medical 的 wound 與換義肢、M4-drugs 的斷藥與蜜糖會、
// M4-scene-ai 的 AI 角色資料與事件的 gate: ai、M4-core-passive 的 sink_floor 提醒）的測試放在各自的檔案裡，不在這裡重複。
// 規格：CYBERSPACE 6「精神污染」、8.7、8.8 節；CYBERWARE 7.1、7.5 節；CORE_RULES 4.3 節；CRAFTING 6、10.1 節；ITEMS 4.2 節；LEWD_SYSTEM 3.5、7.5 節；NIGHT_LESSONS；dev/adr/0019 實作補記：M4-followups-2。
// 內容一律用測試自帶的最小假資料。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentPack, Feature, ReportDraft } from '../../src'
import {
  BASE_SCENE_PARTS, BREAKER_CRUDE, BREAKER_CRUDE_CHANCE, BREAKER_FIRST, BattleRun, ContentError, NO_BREAKER, RESIST_TAGS, TEMPO_STAT_BLOCKED, checkParts, clone, createKernel, passiveProblems, readyFeatures, toMinutes,
} from '../../src'
import { MASKED, abilitiesFeature } from '../../src/features/abilities'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { cyberOf, cyberwareFeature, scanAnswer } from '../../src/features/cyberware'
import { lewdFeature } from '../../src/features/lewd'
import { BASE_PARTS } from '../../src/features/scene'
import { PERCEPTION_SKILLS, sinkFeature } from '../../src/features/sink'
import type { ScanSetup } from '../../src/features/security'
import { personView, planPerson, securityFeature } from '../../src/features/security'
import { arrive, worldFeature } from '../../src/features/world'
import { METER_CONTENT, TEST_WORLD, makeGame, makeWorldGame, meterFeature, testMeter } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, any>

afterEach(() => { vi.restoreAllMocks() })

const PACK_SEC = { id: 'sec_min', content: { faction: [{ id: 'f_alpha', name: '阿爾法公司', short: '阿爾法', class: 'corp' }] } } as unknown as ContentPack

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

// ======================================================================
// 第 1 項：核心
// ======================================================================

describe('第 1 項：passiveProblems 收 source（cyber／drug／gear 擋 { stat: ram_regen }）', () => {
  const k = createKernel([characterFeature])
  const ram = [{ stat: 'ram_regen', amount: 1 }]

  it('義體、藥、裝備三種來源寫 stat ram_regen／ap_regen 擋下，並指到修正 { mod }；其他來源、不帶來源、寫成 mod 都不擋', () => {
    for (const s of TEMPO_STAT_BLOCKED) {
      const p = passiveProblems(k, ram, 'effects', s)
      expect(p, s).toHaveLength(1)
      expect(p[0], s).toMatch(/^effects\[0\]\.stat：每回合的 RAM 回復請用修正 \{ mod: 'ram_regen' \}/)
      expect(passiveProblems(k, [{ stat: 'ap_regen', amount: 1 }], 'effects', s)[0]).toMatch(/行動點回復請用修正 \{ mod: 'ap_regen' \}/)
    }
    expect([...TEMPO_STAT_BLOCKED]).toEqual(['cyber', 'drug', 'gear'])
    for (const s of ['tuning', 'quirk', 'malware', 'sink', 'withdrawal', 'wound', 'contract', 'night'] as const) expect(passiveProblems(k, ram, 'effects', s), s).toEqual([])
    expect(passiveProblems(k, ram)).toEqual([])
    expect(passiveProblems(k, [{ mod: 'ram_regen', amount: 1 }], 'effects', 'cyber')).toEqual([])
    // 別的衍生數值不受影響
    expect(passiveProblems(k, [{ stat: 'max_hp', amount: 2 }], 'effects', 'drug')).toEqual([])
  })

  it('內容載入：設計圖、零件、怪癖的 effects 寫 stat ram_regen 在 ready 時擋下，訊息以 <種類>/<id>： 開頭', () => {
    const bp = (effects: Rec[]): Rec => ({ id: 'bp_x', kind: 'cyberware', name: '義眼', desc: '一顆義眼。', brand: 'hz', grade: 1, legal: 'free', price: 100, require: [], optional: [], slot: 'eye', invasiveness: 'light', sink_cost: 1, effects })
    const load = (effects: Rec[]) => {
      const kk = createKernel([characterFeature])
      kk.strict = true
      kk.content.loadPack({ id: 't', content: { blueprint: [bp(effects)] } } as unknown as ContentPack)
      return kk
    }
    expect(() => readyFeatures(load([{ stat: 'ram_regen', amount: 1 }]))).toThrow(/blueprint\/bp_x：effects\[0\]\.stat：每回合的 RAM 回復請用修正/)
    expect(() => readyFeatures(load([{ mod: 'ram_regen', amount: 1 }]))).not.toThrow()
  })
})

describe('第 1 項：BASE_SCENE_PARTS 是核心的常數，scene 與 cyberware 共用', () => {
  it('七個基本部位；scene 的 BASE_PARTS 就是同一份（不是另外抄的）', () => {
    expect([...BASE_SCENE_PARTS]).toEqual(['mouth', 'hand_l', 'hand_r', 'chest', 'front', 'back', 'legs'])
    expect(BASE_PARTS).toBe(BASE_SCENE_PARTS)
  })
})

// ======================================================================
// 第 3 項：熔斷器三條
// ======================================================================

describe('第 3 項：熔斷器（CYBERSPACE 6「精神污染」；CYBERWARE 7.1、7.5 節）', () => {
  /** 一場現實的戰鬥，主角那一邊的單位帶這些標籤；回傳 run 與單位。 */
  const fight = (tags: string[], layers = 0) => {
    const a = arena(duel([one()], [foe()]))
    const me = a.ally(1)
    me.tags.push(...tags)
    me.layers = layers
    me.load = { now: 3, max: 10 }
    return { a, me }
  }

  it('機械式（breaker_first，織女 初鳴）：這一場第一次過載不疊餘韻（感載照樣歸零、照樣失去回合），第二次才疊；沒有這個標籤的人第一次就疊', () => {
    const { a, me } = fight([BREAKER_FIRST])
    const run = a.run()
    run.overload(me)
    expect(me.layers).toBe(0)
    expect(me.load!.now).toBe(0)
    expect(me.statuses.map((s) => s.id)).toContain('lose_turn')
    expect(run.beats.map((b) => b.text).join('')).toContain('機械熔斷器喀的一聲')
    me.load!.now = 3
    run.overload(me)
    expect(me.layers).toBe(1)
    expect(run.beats.at(-1)!.text).not.toContain('機械熔斷器')
    // 對照：沒有標籤，第一次就疊
    const plain = fight([])
    plain.a.run().overload(plain.me)
    expect(plain.me.layers).toBe(1)
  })

  it('機械式的熔斷器吃掉第一次過載：餘韻已經疊滿也不會昏過去；第二次才昏', () => {
    const { a, me } = fight([BREAKER_FIRST], 3)
    expect(me.layersMax).toBe(3)
    const run = a.run()
    run.overload(me)
    expect(me.out).toBeUndefined()
    expect(me.layers).toBe(3)
    me.load!.now = 3
    run.overload(me)
    expect(me.out).toBe('burnout')
  })

  it('黑市重接的熔斷器（breaker_crude，野戰・無鎖）：每次疊餘韻的過載有 BREAKER_CRUDE_CHANCE 的機會多疊一層；骰到才多、不超過承受層數；沒有標籤的人不擲', () => {
    expect(BREAKER_CRUDE_CHANCE).toBe(0.1)
    const hit = fight([BREAKER_CRUDE])
    const runHit = hit.a.run()
    vi.spyOn(runHit, 'rand').mockReturnValue(0.05)
    runHit.overload(hit.me)
    expect(hit.me.layers).toBe(2)
    expect(runHit.beats.map((b) => b.text).join('')).toContain('重接的熔斷器沒擋住')
    const miss = fight([BREAKER_CRUDE])
    const runMiss = miss.a.run()
    vi.spyOn(runMiss, 'rand').mockReturnValue(0.5)
    runMiss.overload(miss.me)
    expect(miss.me.layers).toBe(1)
    // 疊到承受層數為止：已經疊了 2 層，這一次疊到 3 層（滿）就不再多
    const cap = fight([BREAKER_CRUDE], 2)
    const runCap = cap.a.run()
    vi.spyOn(runCap, 'rand').mockReturnValue(0.01)
    runCap.overload(cap.me)
    expect(cap.me.layers).toBe(3)
    expect(cap.me.out).toBeUndefined()
    // 沒有標籤：不擲（骰序不變）
    const plain = fight([])
    const runPlain = plain.a.run()
    const spy = vi.spyOn(runPlain, 'rand')
    runPlain.overload(plain.me)
    expect(spy).not.toHaveBeenCalled()
    expect(plain.me.layers).toBe(1)
  })

  it('標籤的名字是核心匯出的常數', () => {
    expect([BREAKER_FIRST, BREAKER_CRUDE, NO_BREAKER]).toEqual(['breaker_first', 'breaker_crude', 'no_breaker'])
  })
})

// ---- 沒有熔斷器的橋：掃不過閘門 ----

const bpOf = (id: string, over: Rec = {}): Rec => ({ id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 2, legal: 'register', price: 900, require: [], optional: [], invasiveness: 'invasive', sink_cost: 4, ...over })
const partOf = (id: string, type: string, over: Rec = {}): Rec => ({ id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over })
const BRIDGE_REQ = [{ type: 'chip' }, { type: 'neuron' }, { type: 'software' }]
const PARTS = [
  partOf('pt_chip52', 'chip', { price: 1000, bridge: { capacity: 52 } }),
  partOf('pt_neuron', 'neuron', { price: 300 }),
  partOf('pt_sw_net', 'software', { price: 200, bridge: { split: { meat: 8, net: 28, social: 8, media: 8 } } }),
]
const BRIDGE_PARTS = { chip: 'pt_chip52', neuron: 'pt_neuron', software: 'pt_sw_net' }
const TEMPLE = { id: 'fac_temple', name: '聖堂' }
const MAP = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
const CYBER_PACK = (more: Rec[] = []): ContentPack => ({
  id: 'followups2_cyber',
  content: {
    special_map: [MAP], district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_temple', name: '聖堂' }, F2: { type: 'fac_bar', name: '酒吧' } } }],
    facility_type: [TEMPLE, { id: 'fac_bar', name: '酒吧' }],
    part: structuredClone(PARTS),
    blueprint: [
      bpOf('bp_plain', { name: '標準橋', slot: 'bridge', bridge: { tuning_slots: 2 }, require: BRIDGE_REQ }),
      bpOf('bp_wild', { name: '聖堂自製', slot: 'bridge', bridge: { tuning_slots: 2 }, require: BRIDGE_REQ, legal: 'banned', effects: [{ unit_tag: 'no_breaker', label: '沒有熔斷器' }] }),
      bpOf('bp_kei', { name: '刻經', slot: 'bridge', bridge: { tuning_slots: 2, recall: { days: 7, at: ['fac_temple'], cat: 'net', per: 2 } }, require: BRIDGE_REQ }),
      ...more,
    ],
  } as unknown as ContentPack['content'],
})
const cyberGame = (features: Feature[] = [], pack: ContentPack = CYBER_PACK()) => {
  const { game } = makeGame({
    features: [characterFeature, worldFeature, lewdFeature, cyberwareFeature, ...features], content: [pack], seed: 7,
    pc: { hp: 40, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 20000, cash: 1000 } },
  })
  return game
}
type CG = ReturnType<typeof cyberGame>
const wearBridge = (g: CG, bp: string, over: Rec = {}) => {
  const ext = g.state.actors.pc!.ext as Rec
  ext.cyber = { pieces: [{ uid: 'br1', bp, slot: 'bridge', parts: BRIDGE_PARTS, sink: 4, at: toMinutes(g.state.time), registered: true, ...over }] }
}
const advance = (g: CG, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const stand = (g: CG, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const netCap = (g: CG) => g.k.stats.stat(g.state, 'pc', 'bridge_cap_net')

describe('第 3 項：沒有熔斷器的橋掃不過任何一道閘門（CYBERSPACE 6；聖堂自製、赤線系列）', () => {
  it('cyberware 的 scan.person 回答：橋的效果帶 no_breaker 標籤時回 breaker: false；一般的橋沒有這一項', () => {
    const wild = cyberGame()
    wearBridge(wild, 'bp_wild')
    expect(wild.k.passives.unitTags(wild.state, 'pc')).toContain(NO_BREAKER)
    expect(scanAnswer(wild.k, wild.state, 'pc')).toEqual({ breaker: false })
    const plain = cyberGame()
    wearBridge(plain, 'bp_plain')
    expect(scanAnswer(plain.k, plain.state, 'pc')).toBeUndefined()
  })

  it('security 讀到 breaker: false：只要這個點讀義體，這次就只剩掉頭（stop），讀到的句子與檢視都標出來；沒有這個回答時照舊', () => {
    const noFuse = makeGame({ features: [securityFeature, { id: 'nf', install: (k) => k.hooks.on('scan.person', 'nf', () => ({ breaker: false })) }], content: [PACK_SEC], pc: {} }).game
    const setup = { point: 'gate', name: '閘門', strength: 1 } as ScanSetup
    const plan = planPerson(noFuse.k, noFuse.state, 'pc', setup, 10)!
    expect(plan.noBreaker).toBe(true)
    expect(plan.stop).toBe('你的橋沒有熔斷器，這裡的掃描器一律攔你，只有掉頭走得通。')
    expect(plan.needsEvent).toBe(true)
    expect(plan.sentences).toContain('掃描器讀到你的橋上沒有熔斷器。')
    expect(personView(plan).no_breaker).toBe(true)
    // 這個點不讀義體（只讀沉溺）時不看這一項
    expect(planPerson(noFuse.k, noFuse.state, 'pc', { ...setup, reads: ['sink'] }, 10)?.noBreaker).toBeUndefined()
    const normal = makeGame({ features: [securityFeature], content: [PACK_SEC], pc: {} }).game
    expect(planPerson(normal.k, normal.state, 'pc', setup, 10)).toBeNull()
  })
})

describe('第 3 項：橋「每七天要回聖堂」（CYBERWARE 7.5 節刻經）', () => {
  const DAY = 1440

  it('設計圖 bridge.recall：超過一個期限內海的容量扣 per，再一個再扣；扣到 cap_min（8）為止；沒有設定的橋不扣', () => {
    const g = cyberGame()
    wearBridge(g, 'bp_kei')
    expect(netCap(g)).toBe(28)
    advance(g, 7 * DAY - 1)
    expect(netCap(g)).toBe(28)
    advance(g, 1)
    expect(netCap(g)).toBe(26)
    expect(g.k.stats.statParts(g.state, 'pc', 'bridge_cap_net').filter((p) => p.source === 'cyber').map((p) => p.value)).toEqual([-2])
    advance(g, 7 * DAY)
    expect(netCap(g)).toBe(24)
    // 扣到最少 8 為止（28 − 8 = 20）
    advance(g, 70 * DAY)
    expect(netCap(g)).toBe(8)
    // 別類的容量不扣
    expect(g.k.stats.stat(g.state, 'pc', 'bridge_cap_meat')).toBe(8)
    // 對照：沒有 recall 的橋怎麼放都不扣
    const plain = cyberGame()
    wearBridge(plain, 'bp_plain')
    advance(plain, 70 * DAY)
    expect(netCap(plain)).toBe(28)
  })

  it('站在聖堂（條件 at_facility）而且離上次隔了一天以上：這一回合結束時重刻，期限重新算；站在別的地方、剛刻過都不會發報告', () => {
    const g = cyberGame()
    wearBridge(g, 'bp_kei')
    advance(g, 8 * DAY)
    expect(netCap(g)).toBe(26)
    stand(g, 'F2')
    advance(g, 1)
    expect(netCap(g)).toBe(26)
    expect(g.state.reports.filter((r) => r.action === 'cyber.recall')).toHaveLength(0)
    stand(g, 'F1')
    const rep = g.state.reports.filter((r) => r.action === 'cyber.recall')
    expect(rep).toHaveLength(1)
    expect(rep[0]!.outcome.result).toBe('inscribed')
    expect(netCap(g)).toBe(28)
    expect((cyberOf(g.state, 'pc')[0] as Rec).inscribed).toBe(toMinutes(g.state.time))
    // 剛刻過：再待一會兒不再發報告
    advance(g, 60)
    expect(g.state.reports.filter((r) => r.action === 'cyber.recall')).toHaveLength(1)
    // 離開聖堂之後又過了一個期限：又扣
    stand(g, 'F2')
    advance(g, 7 * DAY)
    expect(netCap(g)).toBe(26)
    // 回去又刻
    stand(g, 'F1')
    expect(netCap(g)).toBe(28)
  })

  it('格式：bridge.recall 的欄位不對載入時擋下，訊息指出是哪一張設計圖', () => {
    const bad = (recall: Rec) => () => cyberGame([], CYBER_PACK([bpOf('bp_bad', { slot: 'bridge', bridge: { recall }, require: BRIDGE_REQ })]))
    expect(bad({ days: 0, at: ['fac_temple'], cat: 'net', per: 2 })).toThrow(/blueprint\/bp_bad：bridge\.recall\.days/)
    expect(bad({ days: 7, at: [], cat: 'net', per: 2 })).toThrow(/bridge\.recall\.at/)
    expect(bad({ days: 7, at: ['fac_temple'], cat: 'sky', per: 2 })).toThrow(/bridge\.recall\.cat/)
    expect(bad({ days: 7, at: ['fac_temple'], cat: 'net', per: 2, extra: 1 })).toThrow(ContentError)
  })
})

// ======================================================================
// 第 6 項：抵抗與感知的檢定標籤（CORE_RULES 4.3 節沉溺分段）
// ======================================================================

describe('第 6 項：沉溺的「抵抗」與「感知」加減真的算得進去', () => {
  const STATUS_PACK = { id: 'st', content: { battle_status: TEST_STATUSES, skill: [{ id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' }] } } as unknown as ContentPack
  /** 一場現實的戰鬥：我方是主角（actor pc，沉溺 sink）；敵方一個雜兵。 */
  function fightWith(sink: number) {
    const { game } = makeGame({ features: [characterFeature, combatFeature, sinkFeature], content: [STATUS_PACK], pc: { sink, attrs: { resolve: 10 }, skills: {} } })
    game.startBattle({
      mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'unit', unit: foe('minion', { weapon: 'pistol' }) as never }],
    })
    const run = new BattleRun(game.k, game.state, clone(game.battle!))
    return { run, me: run.battle.units.a1!, enemy: run.battle.units.f1! }
  }
  const source = { kind: 'item', id: 'x', name: 'x' } as const
  /** 敵人對主角擲一次檢定（對防守值），回傳那一次的 DC。 */
  const dcOf = (w: ReturnType<typeof fightWith>, vs: Rec, tags: string[]): number => {
    const before = w.run.beats.length
    w.run.effects([{ op: 'check', attr: 'intellect', vs, tags, label: '測試' }], { user: w.enemy, target: { unit: 'a1' }, source })
    const beat = w.run.beats.slice(before).find((b) => b.roll)
    return beat!.roll!.dc
  }

  it('對防火牆擲的控制類快駭（標籤 hack:control）：沉溺迷醉（60）的主角「抵抗控制 −2」，DC 低 2；沒有這個標籤、沉溺清明的人不變', () => {
    expect(RESIST_TAGS).toEqual({ 'hack:control': 'resist_control', persuade: 'resist_lure' })
    const drunk = fightWith(60)
    const clear = fightWith(0)
    const plain = dcOf(clear, { firewall: true }, ['hack', 'hack:control'])
    expect(dcOf(drunk, { firewall: true }, ['hack', 'hack:control'])).toBe(plain - 2)
    expect(dcOf(drunk, { firewall: true }, ['hack', 'hack:device'])).toBe(plain)
    expect(dcOf(clear, { firewall: true }, ['hack', 'hack:control'])).toBe(plain)
  })

  it('對意志擲的勸降（標籤 persuade）：沉溺 20～39 的「抵抗誘惑與勸降 −1」（一路到 60 以上都還在）、60 以上另外有控制的 −2；兩個標籤一起帶就都算', () => {
    const clear = fightWith(0)
    const base = dcOf(clear, { will: true }, [])
    const tipsy = fightWith(25)
    expect(dcOf(tipsy, { will: true }, ['persuade'])).toBe(base - 1)
    expect(dcOf(tipsy, { will: true }, ['hack:control'])).toBe(base)
    const drunk = fightWith(60)
    // 抵抗誘惑與勸降 −1 只在微醺那一段，迷醉沒有再加；迷醉多的是抵抗控制 −2
    expect(dcOf(drunk, { will: true }, ['persuade'])).toBe(base - 1)
    expect(dcOf(drunk, { will: true }, ['persuade', 'hack:control'])).toBe(base - 3)
  })

  it('被打的人自己擲的豁免（效果 status 的 save）：控制類的狀態自動帶 resist_control、寫了 persuade 的帶 resist_lure；沉溺的加減出現在擲骰的組成裡', () => {
    const drunk = fightWith(60)
    const before = drunk.run.beats.length
    drunk.run.effects([{ op: 'status', status: 'frozen', save: { attr: 'resolve', dc: 15 } }], { user: drunk.enemy, target: { unit: 'a1' }, source })
    const parts = drunk.run.beats.slice(before).find((b) => b.roll)!.roll!.parts
    expect(parts.filter((p) => p.source === 'sink').map((p) => p.value)).toEqual([-2])
    // 不是控制類的狀態、沒寫 persuade：沒有這一筆
    const b2 = drunk.run.beats.length
    drunk.run.effects([{ op: 'status', status: 'dazed', save: { attr: 'resolve', dc: 15 } }], { user: drunk.enemy, target: { unit: 'a1' }, source })
    expect(drunk.run.beats.slice(b2).find((b) => b.roll)!.roll!.parts.filter((p) => p.source === 'sink')).toEqual([])
    // 勸降：tags 寫 persuade 的存檔，帶 resist_lure（沉溺 60 的主角是 −1）
    const b3 = drunk.run.beats.length
    drunk.run.effects([{ op: 'status', status: 'dazed', save: { attr: 'resolve', dc: 15, tags: ['persuade'] } }], { user: drunk.enemy, target: { unit: 'a1' }, source })
    expect(drunk.run.beats.slice(b3).find((b) => b.roll)!.roll!.parts.filter((p) => p.source === 'sink').map((p) => p.value)).toEqual([-1])
  })

  it('感知類的檢定（調查、街頭直覺兩項基本功，或標籤 perception）：沉溺微醺（20～39）+1；其他基本功與清明的人沒有', () => {
    const { game } = makeGame({ features: [characterFeature, sinkFeature], pc: { sink: 25, skills: { investigate: 2, streetwise: 2, stealth: 2 } } })
    const sinkParts = (skill: string, tags: string[] = []) => checkParts(game.k.stats, game.state, 'pc', { attr: 'intellect', skill, tags }).filter((p) => p.source === 'sink').map((p) => p.value)
    expect(sinkParts('investigate')).toEqual([1])
    expect(sinkParts('streetwise')).toEqual([1])
    expect(sinkParts('stealth')).toEqual([])
    expect(sinkParts('stealth', ['perception'])).toEqual([1])
    const clear = makeGame({ features: [characterFeature, sinkFeature], pc: { sink: 5, skills: { investigate: 2 } } }).game
    expect(checkParts(clear.k.stats, clear.state, 'pc', { attr: 'intellect', skill: 'investigate', tags: [] }).filter((p) => p.source === 'sink')).toEqual([])
    expect([...PERCEPTION_SKILLS]).toEqual(['investigate', 'streetwise'])
  })
})

// ======================================================================
// 第 10 項：機構的營業時段（條件 at_facility 收 open）
// ======================================================================

describe('第 10 項：at_facility 收 open（設施現在開不開）', () => {
  const withHours = (open?: Rec): ContentPack => {
    const p = CYBER_PACK()
    ;(p.content as Rec).block[0].facilities.F1 = { type: 'fac_temple', name: '聖堂', ...(open ? { open } : {}) }
    return p
  }
  const at = (g: CG, c: Rec): boolean => g.k.conditions.test({ kind: 'at_facility', ...c }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('open: true 是現在開著、open: false 是現在沒開；沒寫 open 的設施一直開；types 照舊；不在設施上一律不成立', () => {
    // 時間是第 3 天 10:00，時段是 morning
    const morning = cyberGame([], withHours({ time: ['morning'] }))
    stand(morning, 'F1')
    expect(at(morning, { types: ['fac_temple'], open: true })).toBe(true)
    expect(at(morning, { types: ['fac_temple'], open: false })).toBe(false)
    expect(at(morning, { types: ['fac_temple'] })).toBe(true)
    expect(at(morning, { types: ['fac_bar'], open: true })).toBe(false)
    const night = cyberGame([], withHours({ time: ['prime'] }))
    stand(night, 'F1')
    expect(at(night, { types: ['fac_temple'], open: true })).toBe(false)
    expect(at(night, { types: ['fac_temple'], open: false })).toBe(true)
    // 站著不動，時間走到開門的時段
    advance(night, 10 * 60)
    expect(at(night, { types: ['fac_temple'], open: true })).toBe(true)
    // 沒寫 open 的設施：一直開
    const always = cyberGame([], withHours())
    stand(always, 'F1')
    expect(at(always, { open: true })).toBe(true)
    expect(at(always, { open: false })).toBe(false)
    // 不在設施上
    const nowhere = cyberGame([], withHours())
    expect(at(nowhere, { open: true })).toBe(false)
    // 格式
    expect(morning.k.conditions.validate({ kind: 'at_facility', open: 'yes' }, 'c').join()).toContain('open')
    expect(morning.k.conditions.validate({ kind: 'at_facility', types: ['fac_temple'], open: true }, 'c')).toEqual([])
  })
})

// ======================================================================
// 第 8 項：testkit 的示意工作用 need.hours
// ======================================================================

describe('第 8 項：testkit 的示意工作（TEST_WORLD）升階用累計時數 need.hours', () => {
  it('stages 的 need 寫 hours（30）、沒有舊的 shifts；整個示意世界載得進去', () => {
    const job = (TEST_WORLD.content as Rec).job[0]
    expect(job.stages[1].need).toEqual({ hours: 30, affinity: 20 })
    expect(JSON.stringify(TEST_WORLD.content)).not.toContain('"shifts"')
    expect(() => makeWorldGame()).not.toThrow()
  })
})

// ======================================================================
// 第 11 項：核心的小通用化
// ======================================================================

describe('第 11 項：量表條件的 key: any 是通用的', () => {
  const rep = testMeter({ kind: 'rep', name: '聲望', keyed: 'faction' })
  const fame = testMeter({ kind: 'fame', name: '豔名', keyed: 'district' })
  const mood = testMeter({ kind: 'mood', name: '心情', keyed: 'none' })
  const mk = () => makeGame({
    features: [characterFeature, meterFeature(rep, fame, mood), { id: 'districts', install: (k) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }],
    content: [METER_CONTENT, { id: 'd', content: { district: [{ id: 'd_a', name: '甲區' }, { id: 'd_b', name: '乙區' }] } } as unknown as ContentPack],
  }).game
  const test = (g: ReturnType<typeof mk>, c: Rec): boolean => g.k.conditions.test({ kind: 'x', ...c } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
  const cond = (kind: string, rest: Rec = {}) => ({ kind, key: 'any', ...rest })

  it('任一個鍵（勢力、區、人、不分對象的 _）達到就成立；全部沒達到不成立；max 也是「有一個鍵」', () => {
    const g = mk()
    const ok = (c: Rec): boolean => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(ok(cond('rep', { min: 20 }))).toBe(false)
    g.commit(draft([{ op: 'meter', kind: 'rep', key: 'f_beta', delta: 25 }]))
    expect(ok(cond('rep', { min: 20 }))).toBe(true)
    expect(ok(cond('rep', { min: 30 }))).toBe(false)
    // 區的量表：內容裡的每一區（沒寫過的區是起始值 0）
    expect(ok(cond('fame', { min: 20 }))).toBe(false)
    g.commit(draft([{ op: 'meter', kind: 'fame', key: 'd_b', delta: 22 }]))
    expect(ok(cond('fame', { min: 20 }))).toBe(true)
    expect(ok(cond('fame', { max: -1 }))).toBe(false)
    // 不分對象的量表：只有 _，any 就是它自己
    g.commit(draft([{ op: 'meter', kind: 'mood', key: '_', delta: 7 }]))
    expect(ok(cond('mood', { min: 5 }))).toBe(true)
    expect(ok(cond('mood', { min: 8 }))).toBe(false)
    // 寫明鍵的照舊
    expect(ok({ kind: 'rep', key: 'f_alpha', min: 20 })).toBe(false)
    expect(ok({ kind: 'rep', key: 'f_beta', min: 20 })).toBe(true)
    // 組合裡面也展開；格式上 any 是合格的 key
    expect(ok({ kind: 'not', of: cond('rep', { min: 20 }) })).toBe(false)
    expect(g.k.conditions.validate(cond('rep', { min: 20 }) as never, 'c')).toEqual([])
    void test
  })
})

describe('第 11 項：has_item 收道具標籤（tag）', () => {
  const ITEMS = [
    { id: 'it_a', name: '甲', desc: '甲。', category: 'consumable', grade: 1, size: 1, legal: 'free', tags: ['medkit'] },
    { id: 'it_b', name: '乙', desc: '乙。', category: 'consumable', grade: 1, size: 1, legal: 'free', tags: ['medkit', 'cheap'] },
    { id: 'it_c', name: '丙', desc: '丙。', category: 'consumable', grade: 1, size: 1, legal: 'free' },
  ]
  const mk = (inv: Rec[]) => makeGame({ features: [characterFeature], content: [{ id: 'i', content: { item: ITEMS } } as unknown as ContentPack], patch: { inventory: inv as never } }).game
  const has = (g: ReturnType<typeof mk>, c: Rec): boolean => g.k.conditions.test({ kind: 'has_item', ...c } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('tag：身上任何一種帶這個標籤的東西，件數合計到 min（沒寫 1）；id 與 tag 一起寫要兩個都對上；標籤不對、沒有這個東西不成立', () => {
    const g = mk([{ id: 'it_a', qty: 1 }, { id: 'it_b', qty: 2 }, { id: 'it_c', qty: 5 }])
    expect(has(g, { tag: 'medkit' })).toBe(true)
    expect(has(g, { tag: 'medkit', min: 3 })).toBe(true)
    expect(has(g, { tag: 'medkit', min: 4 })).toBe(false)
    expect(has(g, { tag: 'cheap', min: 2 })).toBe(true)
    expect(has(g, { tag: 'cheap', min: 3 })).toBe(false)
    expect(has(g, { tag: 'nope' })).toBe(false)
    expect(has(g, { id: 'it_c' })).toBe(true)
    expect(has(g, { id: 'it_c', tag: 'medkit' })).toBe(false)
    expect(has(g, { id: 'it_b', tag: 'medkit', min: 2 })).toBe(true)
    // 沒有東西
    expect(has(mk([]), { tag: 'medkit' })).toBe(false)
    // 格式：id 與 tag 至少寫一個
    expect(g.k.conditions.validate({ kind: 'has_item' }, 'c').join()).toContain('tag')
    expect(g.k.conditions.validate({ kind: 'has_item', tag: 'medkit' }, 'c')).toEqual([])
    expect(g.k.conditions.validate({ kind: 'has_item', id: 'it_a' }, 'c')).toEqual([])
  })
})

describe('第 11 項：條件 beast（身上有獸化改造）', () => {
  const EAR = bpOf('bp_ears', { name: '獸耳', slot: 'ear_throat', tags: ['beast'], needs_bridge: false, invasiveness: 'light', sink_cost: 2, require: [] })
  const EYE = bpOf('bp_eye', { name: '義眼', slot: 'eye', needs_bridge: false, invasiveness: 'light', sink_cost: 2, require: [] })
  const pieceOf = (uid: string, bp: string, slot: string) => ({ uid, bp, slot, parts: {}, sink: 2, at: 0, registered: true })
  const beast = (g: CG, who?: string): boolean => g.k.conditions.test({ kind: 'beast', ...(who ? { who } : {}) } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('設計圖的 tags 有 beast 的義體穿在身上才成立；沒穿、穿的是別的、已經拿掉了都不成立；who 指定別人', () => {
    const g = cyberGame([], CYBER_PACK([EAR, EYE]))
    expect(beast(g)).toBe(false)
    ;(g.state.actors.pc!.ext as Rec).cyber = { pieces: [pieceOf('e1', 'bp_eye', 'eye')] }
    expect(beast(g)).toBe(false)
    ;(g.state.actors.pc!.ext as Rec).cyber = { pieces: [pieceOf('e1', 'bp_eye', 'eye'), pieceOf('t1', 'bp_ears', 'ear_throat')] }
    expect(beast(g)).toBe(true)
    expect(beast(g, 'pc')).toBe(true)
    expect(beast(g, 'nobody')).toBe(false)
    ;(g.state.actors.pc!.ext as Rec).cyber = { pieces: [pieceOf('e1', 'bp_eye', 'eye')] }
    expect(beast(g)).toBe(false)
    expect(g.k.conditions.validate({ kind: 'beast', who: 3 } as never, 'c').join()).toContain('who')
    expect(g.k.conditions.validate({ kind: 'beast' } as never, 'c')).toEqual([])
  })
})

describe('第 7 項：scan.person 的 abilities 面具答 hide', () => {
  const mk = () => makeGame({
    features: [characterFeature, abilitiesFeature, securityFeature, { id: 'shown', install: (k) => k.stats.defineStat({ id: 'sink_shown', owner: 'shown', name: '別人看到的沉溺', base: () => 20, min: 0 }) }],
    content: [PACK_SEC, { id: 'sk', content: { skill: [{ id: 'sk_x', name: 'x', attr: 'body', desc: 'x。' }] } } as unknown as ContentPack], pc: { sink: 60 },
  }).game
  const sinkOf = (g: ReturnType<typeof mk>) => planPerson(g.k, g.state, 'pc', { point: 'gate', name: '閘門', strength: 1, reads: ['sink'] } as ScanSetup, 10)!.sink!

  it('戴著人格面具（狀況 masked）：掃描器問 scan.person 得到 hide 1，security 的看穿 DC 多 2；沒戴的沒有答案（hide 0）', () => {
    const g = mk()
    expect(sinkOf(g).hide).toBe(0)
    g.commit(draft([{ op: 'actor.condition', id: 'pc', condition: MASKED }]))
    const heard = (g.k.hooks as unknown as { run(n: string, p: unknown): Array<{ owner: string; result: unknown }> }).run('scan.person', { state: g.state, actor: 'pc', setup: { point: 'gate', name: '閘門', strength: 1 } })
    expect(heard.filter((h) => h.owner === 'abilities').map((h) => h.result)).toEqual([{ hide: 1 }])
    const masked = sinkOf(g)
    expect(masked.hide).toBe(1)
    // 藏得住：shown(20) 低於 real(60)，擲看穿的 DC 比沒戴時高 2
    expect(masked.roll!.dc).toBe(plain(g) + 2)
    // 卸下面具之後回到 0
    g.commit(draft([{ op: 'actor.condition', id: 'pc', condition: MASKED, remove: true }]))
    expect(sinkOf(g).hide).toBe(0)
  })
  const plain = (g: ReturnType<typeof mk>): number => {
    g.commit(draft([{ op: 'actor.condition', id: 'pc', condition: MASKED, remove: true }]))
    return sinkOf(g).roll!.dc
  }
})
