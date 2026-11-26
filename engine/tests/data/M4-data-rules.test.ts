// 驗收測試：dev/work/M4-data-rules.md（cpp-data）。M4 的規則表（只有數字與種類表，不含內容）。
// 規格：每一張表的出處見 data/index.ts 的 SOURCES_M4 與 SOURCES_M4_SUPPLEMENT；暫定的格子見 PROVISIONAL_M4。
// 資料與功能的預設要一致：每一張表逐格和功能匯出的 DEFAULT_… 比（設計書與預設對不上的地方記在回報，不在這裡自己挑一邊）。

import { describe, expect, it } from 'vitest'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { makeGame } from '../../src/testkit'
import { CORE_PACK, PROVISIONAL_M4, SOURCES, SOURCES_M4, SOURCES_M4_SUPPLEMENT } from '../../data'
import { DEFAULT_CYBER_RULES, ruleProblems as cyberProblems } from '../../src/features/cyberware/model'
import { DEFAULT_CRAFT_RULES, facilityCraftProblems, ruleProblems as craftProblems } from '../../src/features/craft/model'
import { DEFAULT_MEDICAL_RULES, ruleProblems as medicalProblems } from '../../src/features/medical/model'
import { DEFAULT_DRUG_RULES, ruleProblems as drugProblems } from '../../src/features/drugs/model'
import { DEFAULT_SINK_RULES, ruleProblems as sinkProblems } from '../../src/features/sink/model'
import { DEFAULT_LURE_RULES, ruleProblems as lureProblems } from '../../src/features/lure/model'
import { DEFAULT_MALWARE_RULES, ruleProblems as malwareProblems } from '../../src/features/malware/model'
import { DEFAULT_TUNING_RULES, ruleProblems as tuningProblems } from '../../src/features/tuning/model'
import { DEFAULT_CONTRACT_RULES, ruleProblems as contractProblems } from '../../src/features/contract/model'
import { DEFAULT_NIGHT_RULES, ruleProblems as nightProblems } from '../../src/features/nightclass/model'
import { DEFAULT_ARENA_RULES, facilityFieldProblems, ruleProblems as arenaProblems } from '../../src/features/arena/model'
import { DEFAULT_RULES as DEFAULT_CURTAIN_RULES, ruleProblems as curtainProblems } from '../../src/features/curtain/model'
import { DEFAULT_GEAR_RULES, ruleProblems as gearProblems } from '../../src/features/gear/rules'
import { DEFAULT_UNREG_RULES, deskProblems, frameOf, frameProblems, unregRuleProblems, unregRules } from '../../src/features/unreg'
import { DEFAULT_AUCTION_RULES, auctionRuleProblems } from '../../src/features/auction/model'
import { DEFAULT_SCENE_RULES, sceneRules } from '../../src/features/scene/model'
import { DEFAULT_ABILITY_RULES, abilityRules } from '../../src/features/abilities/loadout'
import { DEFAULT_SECURITY_RULES, securityRules } from '../../src/features/security/model'
import { DEFAULT_PERSON_RULES } from '../../src/features/security/personRules'
import { DEFAULT_RULE as DEFAULT_CREATION_RULE, rule as creationRule } from '../../src/features/creation/model'
import { cyberRules } from '../../src/features/cyberware/model'
import { medicalRules } from '../../src/features/medical/model'
import { contractRules } from '../../src/features/contract/model'
import eventScopes from '../../data/rules/event_scopes.json'
import statuses from '../../data/rules/battle_statuses.json'
import facilityTypes from '../../data/rules/facility_types.json'
import unregJson from '../../data/rules/unreg_rules.json'

type Rec = Record<string, unknown>
const plain = <T>(v: T): unknown => JSON.parse(JSON.stringify(v))
const game = () => new Game({ features: allFeatures(), content: [CORE_PACK] })
const raw = (g: Game, kind: string, id = 'default'): Rec => {
  const { id: _id, ...rest } = g.k.content.get(kind, id) as Rec
  return rest
}
const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Rec)[k] : undefined), o)

/** 新的規則表：種類 → [預設, 格式檢查]。 */
const NEW: Array<[string, unknown, (e: Rec) => string[]]> = [
  ['cyber_rule', DEFAULT_CYBER_RULES, cyberProblems], ['craft_rule', DEFAULT_CRAFT_RULES, craftProblems], ['medical_rule', DEFAULT_MEDICAL_RULES, medicalProblems],
  ['drug_rule', DEFAULT_DRUG_RULES, drugProblems], ['sink_rule', DEFAULT_SINK_RULES, sinkProblems], ['lure_rule', DEFAULT_LURE_RULES, lureProblems],
  ['malware_rule', DEFAULT_MALWARE_RULES, malwareProblems], ['tuning_rule', DEFAULT_TUNING_RULES, tuningProblems], ['contract_rule', DEFAULT_CONTRACT_RULES, contractProblems],
  ['night_rule', DEFAULT_NIGHT_RULES, nightProblems], ['arena_rule', DEFAULT_ARENA_RULES, arenaProblems], ['curtain_rule', DEFAULT_CURTAIN_RULES, curtainProblems],
  ['gear_rule', DEFAULT_GEAR_RULES, gearProblems], ['unreg_rule', DEFAULT_UNREG_RULES, unregRuleProblems], ['auction_rule', DEFAULT_AUCTION_RULES, auctionRuleProblems],
]

describe('M4-data-rules：載入與引用', () => {
  it('帶著全部功能載入整包資料沒有錯，引用都找得到', () => {
    expect(() => game()).not.toThrow()
    expect(game().k.content.checkRefs()).toEqual([])
  })

  it('十五種新的規則表各有一筆 default、被一個功能認得、寫了出處、格式檢查是空的', () => {
    const g = game()
    for (const [kind, , problems] of NEW) {
      expect(g.k.content.hasKind(kind), kind).toBe(true)
      expect(g.k.content.list(kind).map((e) => e.id), kind).toEqual(['default'])
      expect(SOURCES_M4[kind], kind).toMatch(/\S/)
      expect(problems(g.k.content.get(kind, 'default') as Rec), kind).toEqual([])
    }
    for (const kind of Object.keys(SOURCES_M4_SUPPLEMENT)) expect(SOURCES[kind] ?? SOURCES_M4[kind] ?? SOURCES_M4_SUPPLEMENT[kind], kind).toMatch(/\S/)
  })

  it('暫定的格子列出來了，而且都是那張表真的有的欄位（點號是裡面一層）', () => {
    const g = game()
    for (const [kind, fields] of Object.entries(PROVISIONAL_M4)) {
      for (const [path, p] of Object.entries(fields)) {
        expect(p, `${kind}.${path}`).toMatch(/P\d|M4-|CYBERSPACE|EQUIPMENT/)
        if (kind === 'event_scope') {
          const [scope, point] = path.split('.')
          expect((g.k.content.get(kind, scope!) as Rec).triggers, `${kind}.${path}`).toHaveProperty(point!)
        } else if (kind === 'battle_status') {
          expect(g.k.content.has(kind, path), path).toBe(true)
        } else {
          expect(at(raw(g, kind), path), `${kind}.${path}`).not.toBeUndefined()
        }
      }
    }
  })
})

describe('M4-data-rules：資料和功能的預設一致（逐格）', () => {
  for (const [kind, def] of NEW) {
    it(`${kind}：資料的每一格等於預設，功能讀出來的也一樣`, () => {
      const g = game()
      // unreg_rule 的 options 預設是空的（選項表由這一批填，另外在下面驗）；其餘逐格
      const { options: _o, ...rest } = def as Rec & { options?: unknown }
      const { options: _d, ...data } = raw(g, kind)
      expect(kind === 'unreg_rule' ? data : raw(g, kind)).toEqual(plain(kind === 'unreg_rule' ? rest : def))
      if (kind === 'unreg_rule') expect(plain(unregRules(g.k).options)).toEqual(plain(raw(g, kind).options))
    })
  }

  it('既有規則表補的 M4 欄位：scene_rule、ability_rule、security_rule、creation_rule 逐格等於預設', () => {
    const g = game()
    expect(raw(g, 'scene_rule')).toEqual(plain(DEFAULT_SCENE_RULES))
    expect(plain(sceneRules(g.k))).toEqual(plain(DEFAULT_SCENE_RULES))
    expect(raw(g, 'ability_rule')).toEqual(plain(DEFAULT_ABILITY_RULES))
    expect(plain(abilityRules(g.k))).toEqual(plain(DEFAULT_ABILITY_RULES))
    expect(raw(g, 'security_rule')).toEqual(plain({ ...DEFAULT_SECURITY_RULES, ...DEFAULT_PERSON_RULES }))
    expect(plain(securityRules(g.k)) as Rec).toMatchObject(plain(DEFAULT_SECURITY_RULES) as Rec)
    expect(raw(g, 'security_rule').readers).toEqual({})
    const c = raw(g, 'creation_rule')
    expect(c).toMatchObject(plain({ cyber_point_price: DEFAULT_CREATION_RULE.cyber_point_price, cyber_install_mult: DEFAULT_CREATION_RULE.cyber_install_mult, gear_point_price: DEFAULT_CREATION_RULE.gear_point_price, gear_grade_max: DEFAULT_CREATION_RULE.gear_grade_max, gear_kinds: DEFAULT_CREATION_RULE.gear_kinds }) as Rec)
    expect(plain(creationRule(g.k)) as Rec).toMatchObject(plain(DEFAULT_CREATION_RULE) as Rec)
    expect(raw(g, 'net_enemy_rule')).toEqual({ form_b_chance: 0.6 })
  })

  it('功能讀出來的規則等於預設（資料蓋上去之後沒有走樣）', () => {
    const g = game()
    expect(plain(cyberRules(g.k))).toEqual(plain(DEFAULT_CYBER_RULES))
    expect(plain(medicalRules(g.k))).toEqual(plain(DEFAULT_MEDICAL_RULES))
    expect(plain(contractRules(g.k))).toEqual(plain(DEFAULT_CONTRACT_RULES))
  })
})

describe('M4-data-rules：兩邊各有一份的數字', () => {
  it('cyber_rule 與 medical_rule 讀同一個 clinic.grade 的三個值：診所、無照、黑診所', () => {
    const g = game()
    const grades = ['clinic', 'unlicensed', 'black']
    const cyberGrades = Object.keys(raw(g, 'cyber_rule').surgeons as Rec).filter((k) => k !== 'self')
    expect(cyberGrades.sort()).toEqual([...grades].sort())
    expect(Object.keys(raw(g, 'medical_rule').heal_price as Rec).sort()).toEqual([...grades].sort())
    const have = (facilityTypes as Array<{ id: string; clinic?: { grade: string } }>).filter((f) => f.clinic).map((f) => f.clinic!.grade)
    expect(have.sort()).toEqual([...grades].sort())
  })

  it('contract_rule.resist 與 event_scopes.contract 的機率不重複定義', () => {
    const g = game()
    const scope = g.k.content.get('event_scope', 'contract') as Rec
    expect(Object.keys(scope.triggers as Rec).sort()).toEqual(['holder_order', 'order'])
    expect(Object.keys(raw(g, 'contract_rule')).filter((k) => k === 'triggers' || k === 'daily_roll')).toEqual([])
    // 每天擲不擲、下哪一種的機率只在 scope（daily_roll）；rule 只有抗拒的 DC 與滿意
    expect(scope.daily_roll).toEqual(plain({ eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }))
  })
})

describe('M4-data-rules：event_scopes 與 battle_statuses', () => {
  const scope = (id: string) => (eventScopes as Array<Rec & { id: string }>).find((s) => s.id === id)!
  it('新的觸發點在各自範圍的表裡', () => {
    expect(scope('rogue_ai').triggers).toEqual({ login: 0.15, enter_floor: 0.1, rest: 0.15, kiss_choose: 1 })
    expect(scope('rogue_ai')).toMatchObject({ cooldown_hours: 24, daily_cap: 1 })
    expect(scope('contract').triggers).toEqual({ order: 1, holder_order: 1 })
    expect(scope('adult').triggers).toEqual({ arena_result: 1, foe_sunk: 0.5, impulse: 0.3 })
    expect((scope('street').triggers as Rec).auction_done).toBe(0.3)
  })

  it('縛的兩種、分心、斷藥的狀態資料', () => {
    const g = game()
    const row = (id: string) => g.k.content.get('battle_status', id) as Rec
    expect(row('bind_ap')).toMatchObject({ mods: { ap_regen: -1 }, until: 'battle_end', kind: 'debuff' })
    expect(row('bind_move')).toMatchObject({ no_move: true, until: 'battle_end', kind: 'debuff' })
    expect(row('distracted')).toMatchObject({ mods: { hit: -1 }, until: 'next_attack', turns: 1 })
    expect(row('pump_jam')).toMatchObject({ until: 'own_turn_end', turns: 2, kind: 'debuff' })
    expect((statuses as Array<{ id: string }>).filter((s) => s.id === 'pump_jam')).toHaveLength(1)
  })
})

describe('M4-data-rules：設施種類的 M4 欄位', () => {
  const f = (id: string) => (facilityTypes as Array<Rec & { id: string }>).find((x) => x.id === id)!
  it('診所三種、調校診所、療養院、傳教所、互助診所、店家、攤位、擂台', () => {
    expect(f('clinic').clinic).toEqual({ grade: 'clinic' })
    expect(f('clinic_unlicensed').clinic).toEqual({ grade: 'unlicensed' })
    expect(f('clinic_black').clinic).toEqual({ grade: 'black' })
    expect(f('tuning_clinic').tuning).toEqual({ install: true, quiet_room: true })
    expect(f('sanatorium').therapy).toEqual({ kind: 'counsel' })
    // 勢力的好感門檻（M4 收尾修正批補上）：傳教所要素體教好感 20、互助診所蜜糖會好感 30 免費、同人攤的訂做桌是同人眾的
    expect(f('mission').therapy).toEqual({ kind: 'retreat', favor: { faction: 'bare', min: 20 } })
    expect(f('aid_clinic').detox).toEqual({ favor: { faction: 'honey', min: 30 } })
    expect(f('apparel_shop').dye).toBe(true)
    expect(f('fan_stall').unreg_desk).toEqual({ faction: 'doujin' })
  })

  it('craft、arena、unreg_desk 通過各自功能的格式檢查', () => {
    for (const id of ['gun_shop', 'cyber_shop', 'apparel_shop', 'fan_stall']) expect(facilityCraftProblems(f(id).craft), id).toEqual([])
    expect(f('fan_stall').craft).toEqual({ by: 'doujin' })
    expect(f('gun_shop').craft).toEqual({ by: 'shop' })
    expect(facilityFieldProblems(f('arena').arena)).toEqual([])
    expect(f('arena').arena).toEqual({ grades: [1, 2, 3] })
    expect(deskProblems(f('fan_stall').unreg_desk)).toEqual([])
  })
})

describe('M4-data-rules：unreg_rule 的選項表（CRAFTING 5.5 節、CORE_RULES 7.4 節）', () => {
  /** 零件的 stats 鍵在功能裡有人讀的清單（沒有功能匯出清單，這裡逐條列出讀的地方）：
   *  features/gear/numbers.ts：armor、hit、damage、pierce、range_far、mag；features/gear/look.ts：style、exposure；
   *  features/cyberware/surgery.ts 與 craft/preview.ts：sink；features/cyberware/deck.ts：slots、firewall、ram_max、ram_regen、cooling。 */
  const READ_STATS = ['armor', 'hit', 'damage', 'pierce', 'range_far', 'mag', 'style', 'exposure', 'sink', 'slots', 'firewall', 'ram_max', 'ram_regen', 'cooling']
  const TYPES = ['chip', 'neuron', 'software', 'plate', 'actuator', 'sensor', 'power', 'skin', 'barrel', 'action', 'blade', 'fiber']
  const options = unregJson[0]!.options as unknown as Record<string, Array<{ id: string; put: string; key: string; amount: number; cost: number; max: number }>>

  it('十二種零件類型都有名字；沒有生體版與用在哪幾種成品照 CRAFTING 2.1、2.2 節', () => {
    const types = (unregJson[0] as Rec).types as Record<string, { name: string; bio?: boolean; kinds?: string[] }>
    expect(Object.keys(types).sort()).toEqual([...TYPES].sort())
    for (const t of TYPES) expect(types[t]!.name).toMatch(/\S/)
    expect(types.barrel!.bio).toBe(false)
    expect(types.action!.bio).toBe(false)
    expect(TYPES.filter((t) => types[t]!.bio === false).sort()).toEqual(['action', 'barrel'])
    expect(types.fiber!.kinds).toEqual(['armor'])
    expect(types.barrel!.kinds).toEqual(['weapon'])
  })

  it('每一項的 stats 鍵在功能裡讀得到、親和只用四類、cost 是 0.5 的倍數；cost 與 amount 照 7.4 節', () => {
    for (const [type, list] of Object.entries(options)) {
      expect(TYPES, type).toContain(type)
      for (const o of list) {
        if (o.put === 'stats') expect(READ_STATS, `${type}.${o.id}`).toContain(o.key)
        else expect(['meat', 'net', 'social', 'media'], `${type}.${o.id}`).toContain(o.key)
        expect(Number.isInteger(o.cost * 2), `${type}.${o.id}`).toBe(true)
      }
    }
    const find = (type: string, id: string) => options[type]!.find((o) => o.id === id)!
    expect(find('plate', 'armor')).toMatchObject({ amount: 1, cost: 1, max_at: { 1: 1, 2: 1 } })
    expect(find('fiber', 'armor')).toMatchObject({ amount: 1, cost: 1, max_at: { 1: 1, 2: 1 } })
    expect(find('sensor', 'hit')).toMatchObject({ amount: 1, cost: 1 })
    expect(find('skin', 'aff_social')).toMatchObject({ amount: 1, cost: 0.5 })
    expect(find('chip', 'ram')).toMatchObject({ amount: 1, cost: 1 })
  })

  it('有選項的類型：隨機的等級與種子跑 frameOf 一百次，frameProblems 都是空的；每一級抽得到的列出來', () => {
    const { game: g } = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 11 })
    const rules = unregRules(g.k)
    expect(Object.keys(rules.options).sort()).toEqual(Object.keys(options).sort())
    const noLine: string[] = []
    for (const type of Object.keys(options)) {
      for (const grade of [1, 2, 3, 4]) {
        let got = 0
        for (let seq = 1; seq <= 100; seq++) {
          const f = frameOf(g.k, g.state, { type, grade, seq, source: 'gift' })
          expect(frameProblems(g.k, f, 'gift'), `${type} ${grade} #${seq}`).toEqual([])
          if (f.attrs.length > 0) got++
        }
        if (got === 0) noLine.push(`${type}:${grade}`)
      }
    }
    // I 級只有 0.5 格：只有半格的選項（親和、傷害、彈匣）抽得到；整格的類型（板材、纖維、感測器）I 級抽不到屬性，是 CRAFTING 5.5 節的份量決定的
    expect(noLine.sort()).toEqual(['fiber:1', 'plate:1', 'sensor:1'])
  })

  it('沒有選項的類型（致動器、電源）不會壞：框架照樣給、屬性是空的', () => {
    const { game: g } = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 3 })
    for (const type of ['actuator', 'power']) {
      const f = frameOf(g.k, g.state, { type, grade: 3, seq: 1 })
      expect(f.attrs).toEqual([])
      expect(frameProblems(g.k, f)).toEqual([])
    }
  })
})
