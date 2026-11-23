// 驗收測試：dev/work/M2-security.md（cpp-feature）。規格：FACTIONS 第 5、6 節（好感與敵對值：分段、怎麼漲、怎麼降、下限）；CORE_RULES 第 8 節；
// LIFE 2.1～2.3 節（掃橋看的四樣、三種人、假身分）；EQUIPMENT 6.3、6.4 節（掃描強度、被發現之後）；UI 3.11 節；dev/adr/0016 第三、四、七節與 G17。
// 內容一律用測試自帶的最小假資料：三個勢力（收錢、不收錢、沒寫）、三個區（一般、冠冕 ×2、倍率 ×0.5 但貝塔照原樣）、幾種假身分與執照。
// 發起掃橋的功能（交通的閘門）用測試裡的替身 caller；身上會被掃到的東西多半用替身回答 scan.carried，另有幾件用真的 gear。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Origin, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx, meterOf } from '../../src'
import { directorFeature, chooseOption, eventRunFeature, eventView, openEventOf } from '../../src/features/director'
import { gearFeature } from '../../src/features/gear'
import { treatEvent } from '../../src/features/enemies/capture'
import type { CaptureCandidate } from '../../src/features/enemies/capture'
import {
  CLASS_NAME, DEFAULT_SECURITY_RULES, bribe, bribeBlock, bribePrice, bribeUnit, favorTier, favorView, floorOf, hostilityTier, hostilityView, resolveScan, planScan, scanView, securityFeature, timedFloors,
} from '../../src/features/security'
import type { ScanSetup } from '../../src/features/security'
import { makeGame, observed } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, unknown>
const SKILLS = [
  { id: 'perform', name: '表演', attr: 'charm', desc: '演一個你不是的人。' }, { id: 'firearms', name: '槍械', attr: 'reflex', desc: '開槍。' },
  { id: 'intimidate', name: '威嚇', attr: 'resolve', desc: '讓人怕你。' }, { id: 'negotiate', name: '交涉', attr: 'charm', desc: '把話談成。' },
  { id: 'seduce', name: '誘惑', attr: 'charm', desc: '讓人心動。' },
]
const FACTIONS = [
  { id: 'f_alpha', name: '阿爾法公司', short: '阿爾法', class: 'corp', bribe: true },
  { id: 'f_beta', name: '貝塔幫', short: '貝塔', class: 'street', bribe: false },
  { id: 'f_gamma', name: '伽瑪警局', short: '伽瑪', class: 'public' },
]
const DISTRICTS = [
  { id: 'test', name: '測試區' },
  { id: 'crown', name: '冠冕區', hostility_mult: { '*': 2 } },
  { id: 'tame', name: '安靜區', hostility_mult: { '*': 0.5, f_beta: 1 } },
]
const item = (id: string, more: Rec = {}) => ({ id, name: id, desc: `${id}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS = [
  item('it_fake1', { name: '一次性假身分', grade: 1, tags: ['fake_id'], legal: 'banned' }),
  item('it_fake2', { name: '淺層假身分', grade: 2, tags: ['fake_id'], legal: 'banned' }),
  item('it_fake3', { name: '深層假身分', grade: 3, tags: ['fake_id'], legal: 'banned' }),
  item('it_licence', { name: '保全執照', tags: ['license'], size: 0 }),
  item('it_licence_rifle', { name: '長槍執照', tags: ['license:it_rifle'], size: 0 }),
  // 替身回答 scan.carried 時用的東西
  item('it_gun', { name: '改裝手槍', legal: 'banned' }),
  item('it_rifle', { name: '霰彈槍', legal: 'permit' }),
  item('it_pistol', { name: '登記的手槍', legal: 'register' }),
  item('it_knife', { name: '小刀', legal: 'free' }),
]
const PACK: ContentPack = { id: 'security_test', content: { skill: SKILLS, faction: FACTIONS, district: DISTRICTS, item: ITEMS } as unknown as ContentPack['content'] }

/** 區是 world 的內容種類：測試自己定義。 */
const DISTRICT_KIND: Feature = { id: 'test_districts', install: (k) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }

/** 替身：身上掃得到的東西（照強度過濾：強度 1 只掃 size 2 以上，這裡用 min 表示）。 */
interface Carry { item: string; name: string; legal: string; min?: number }
const carrying = (list: Carry[]): Feature => ({
  id: 'carry_stub',
  install(k) {
    k.hooks.on('scan.carried', 'carry_stub', ({ strength }) => list.filter((c) => strength >= (c.min ?? 1)).map(({ item, name, legal }) => ({ item, name, legal })))
  },
})
const GUN: Carry = { item: 'it_gun', name: '改裝手槍', legal: 'banned' }
const RIFLE: Carry = { item: 'it_rifle', name: '霰彈槍', legal: 'permit' }
const PISTOL: Carry = { item: 'it_pistol', name: '登記的手槍', legal: 'register' }
const KNIFE: Carry = { item: 'it_knife', name: '小刀', legal: 'free' }

/** 發起掃橋的功能：記下 activity.end（kind 是 scan、origin.by 是 caller）。 */
interface Heard { kind: string; id: string; origin: Origin; outcome: string; result: Rec }
const caller = (log: Heard[]): Feature => ({
  id: 'caller',
  install(k) {
    k.hooks.on('activity.end', 'caller', (p) => {
      if (p.kind !== 'scan' || p.origin.by !== 'caller') return
      log.push({ kind: p.kind, id: p.id, origin: p.origin, outcome: p.outcome, result: p.result })
      return { lines: ['發起的人收到了結果'], changes: [{ op: 'flag', key: `scan_${String(p.result.how)}`, value: true }] }
    })
  },
})

interface Opts {
  features?: Feature[]
  content?: ContentPack[]
  seed?: number
  pc?: Parameters<typeof makeGame>[0] extends infer S ? (S extends { pc?: infer P } ? P : never) : never
  patch?: Partial<GameState>
  /** 安裝 director 與事件視窗（預設有） */
  window?: boolean
  rule?: Rec
}
const rulePack = (rule: Rec): ContentPack => ({ id: 'security_rule_test', content: { security_rule: [{ id: 'default', ...rule }] } as unknown as ContentPack['content'] })
const make = (o: Opts = {}) =>
  makeGame({
    features: [DISTRICT_KIND, ...(o.window === false ? [] : [directorFeature, eventRunFeature]), securityFeature, ...(o.features ?? [])],
    content: [PACK, ...(o.rule ? [rulePack(o.rule)] : []), ...(o.content ?? [])], seed: o.seed ?? 7,
    pc: o.pc ?? { skills: { perform: 1 } },
    patch: { money: { cred: 0, cash: 5000 }, time: { day: 3, hour: 10, minute: 0 }, ...o.patch },
  }).game
type G = ReturnType<typeof make>

const draft = (changes: Change[], action = 'test.give'): ReportDraft => ({
  kind: 'event', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
/** 用效果給：走和事件一樣的路（效果登錄表解析、提交）。 */
function give(g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin') {
  const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes))
  return r
}
const hostility = (g: G, f = 'f_alpha'): number => meterOf(g.k, g.state, 'hostility', f)
const favor = (g: G, f = 'f_alpha'): number => meterOf(g.k, g.state, 'favor', f)
/** 直接放一個敵對值（不經報告，所以不算「那一週有新的」）。 */
const setMeter = (g: G, kind: string, key: string, value: number) => {
  g.state.meters[kind] = { ...g.state.meters[kind], [key]: value }
}
const inDistrict = (district: string): Partial<GameState> => ({ location: { district, block: 'empty_room', scene: '一個空房間' } })
/** 時間往前走 minutes 分鐘（一份只有 time 變更的報告；time.passed 掛鉤在它之後跑）。 */
const advance = (g: G, minutes: number): Report[] => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')

// ===================================================================================================================
describe('量表：敵對值與好感', () => {
  it('敵對值 0～100、起始 0；好感 0～100、起始 10；同名的效果與條件核心自動有', () => {
    const g = make()
    expect(hostility(g)).toBe(0)
    expect(favor(g)).toBe(10)
    expect(g.k.meters.get('hostility')).toMatchObject({ min: 0, max: 100, start: 0, keyed: 'faction', floor: 'hostility_floor', cap: { down: 10, up: 10 } })
    expect(g.k.meters.get('favor')).toMatchObject({ min: 0, max: 100, start: 10, keyed: 'faction', cap: { down: 5, up: 5 } })
    expect(g.k.meters.get('hostility_floor')).toMatchObject({ min: 0, max: 100, start: 0, keyed: 'faction' })
    expect(g.k.effects.has('hostility') && g.k.effects.has('favor') && g.k.effects.has('hostility_floor')).toBe(true)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: 7 }, { kind: 'favor', key: 'f_beta', amount: 4 }])
    expect([hostility(g), favor(g, 'f_beta')]).toEqual([7, 14])
    expect(g.k.conditions.test({ kind: 'hostility', key: 'f_alpha', min: 5 } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(true)
  })

  it('敵對值 +5 在倍率 2 的區變成 +10；一般的區照寫；倍率 0.5 的區變成一半', () => {
    const at = (district: string, amount = 5, faction = 'f_alpha') => {
      const g = make({ patch: inDistrict(district) })
      give(g, [{ kind: 'hostility', key: faction, amount }])
      return hostility(g, faction)
    }
    expect(at('test')).toBe(5)
    expect(at('crown')).toBe(10)
    expect(at('tame', 4)).toBe(2)
    // 照勢力寫的蓋過 *：貝塔在安靜區照原樣
    expect(at('tame', 4, 'f_beta')).toBe(4)
  })

  it('倍率只算往上加的：往下降不乘', () => {
    const g = make({ patch: inDistrict('crown') })
    setMeter(g, 'hostility', 'f_alpha', 50)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: -6 }])
    expect(hostility(g)).toBe(44)
  })

  it('AI 的一件事合計不超過 10（含區的倍率：冠冕區 AI 給 +8 是 +10）；往下同樣最多 −10', () => {
    const g = make()
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: 6 }, { kind: 'hostility', key: 'f_alpha', amount: 6 }, { kind: 'hostility', key: 'f_alpha', amount: 6 }], 'ai')
    expect(hostility(g)).toBe(10)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: -25 }], 'ai')
    expect(hostility(g)).toBe(0)
    setMeter(g, 'hostility', 'f_alpha', 60)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: -25 }], 'ai')
    expect(hostility(g)).toBe(50)
    const crown = make({ patch: inDistrict('crown') })
    give(crown, [{ kind: 'hostility', key: 'f_alpha', amount: 8 }], 'ai')
    expect(hostility(crown)).toBe(10)
  })

  it('AI 給的好感一件事最多 ±5；好感起始 10、夾在 0～100', () => {
    const g = make()
    give(g, [{ kind: 'favor', key: 'f_alpha', amount: 30 }], 'ai')
    expect(favor(g)).toBe(15)
    give(g, [{ kind: 'favor', key: 'f_alpha', amount: -30 }], 'ai')
    expect(favor(g)).toBe(10)
    give(g, [{ kind: 'favor', key: 'f_alpha', amount: 200 }])
    expect(favor(g)).toBe(100)
    give(g, [{ kind: 'favor', key: 'f_alpha', amount: -500 }])
    expect(favor(g)).toBe(0)
  })

  it('下限：AI（一般事件）一件事最多 +5、永久、不能降；內建的照寫的算（EVENTS 2.4 的兩列之一）', () => {
    const g = make()
    give(g, [{ kind: 'hostility_floor', key: 'f_alpha', amount: 30 }], 'ai')
    expect(meterOf(g.k, g.state, 'hostility_floor', 'f_alpha')).toBe(5)
    give(g, [{ kind: 'hostility_floor', key: 'f_alpha', amount: -3 }], 'ai')
    expect(meterOf(g.k, g.state, 'hostility_floor', 'f_alpha')).toBe(5)
    give(g, [{ kind: 'hostility_floor', key: 'f_alpha', amount: 30 }])
    expect(meterOf(g.k, g.state, 'hostility_floor', 'f_alpha')).toBe(35)
  })

  it('下限抬高：敵對值跟著落在下限之上（一份報告裡）；降不到下限以下', () => {
    const g = make()
    setMeter(g, 'hostility', 'f_alpha', 10)
    give(g, [{ kind: 'hostility_floor', key: 'f_alpha', amount: 30 }])
    expect(hostility(g)).toBe(30)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: -20 }])
    expect(hostility(g)).toBe(30)
    // 敵對值本來就比下限高：不動
    setMeter(g, 'hostility', 'f_beta', 70)
    give(g, [{ kind: 'hostility_floor', key: 'f_beta', amount: 30 }])
    expect(hostility(g, 'f_beta')).toBe(70)
  })

  it('區的倍率格式有誤、勢力不存在時載入就擋下', () => {
    const bad = (district: Rec) => () => make({ content: [{ id: 'bad', content: { district: [{ id: 'bad_d', name: '壞區', ...district }] } as unknown as ContentPack['content'] }] })
    expect(bad({ hostility_mult: 2 })).toThrow(ContentError)
    expect(bad({ hostility_mult: { '*': -1 } })).toThrow(/hostility_mult/)
    expect(bad({ hostility_mult: { f_nobody: 2 } })).toThrow(/查不到/)
    expect(() => make({ content: [{ id: 'bad2', content: { faction: [{ id: 'f_bad', name: '壞', short: '壞', class: 'corp', bribe: 'yes' }] } as unknown as ContentPack['content'] }] })).toThrow(/bribe/)
  })
})

// ===================================================================================================================
describe('分段', () => {
  it('敵對值 19、20、40、60、80、100 各落在對的那一段（六段的 id 與名字）', () => {
    const g = make()
    const at = (v: number) => {
      setMeter(g, 'hostility', 'f_alpha', v)
      const t = hostilityTier(g.k, g.state, 'f_alpha')
      return [t.id, t.name, t.index, t.min]
    }
    expect(at(0)).toEqual(['unnoticed', '沒注意', 0, 0])
    expect(at(19)).toEqual(['unnoticed', '沒注意', 0, 0])
    expect(at(20)).toEqual(['recorded', '記名', 1, 20])
    expect(at(39)).toEqual(['recorded', '記名', 1, 20])
    expect(at(40)).toEqual(['trouble', '找麻煩', 2, 40])
    expect(at(60)).toEqual(['pursuit', '追捕', 3, 60])
    expect(at(80)).toEqual(['bounty', '懸賞', 4, 80])
    expect(at(99)).toEqual(['bounty', '懸賞', 4, 80])
    expect(at(100)).toEqual(['wanted', '通緝', 5, 100])
  })

  it('好感五段：外人、認得、友好、信任、自己人', () => {
    const g = make()
    const at = (v: number) => {
      setMeter(g, 'favor', 'f_alpha', v)
      return favorTier(g.k, g.state, 'f_alpha').name
    }
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(at)).toEqual(['外人', '外人', '認得', '認得', '友好', '友好', '信任', '信任', '自己人', '自己人'])
  })

  it('條件 hostility_tier：{ faction, min, max }，段寫 id 或第幾段；每個勢力各算各的', () => {
    const g = make()
    setMeter(g, 'hostility', 'f_alpha', 45)
    const test = (c: Rec) => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test({ kind: 'hostility_tier', faction: 'f_alpha', min: 'trouble' })).toBe(true)
    expect(test({ kind: 'hostility_tier', faction: 'f_alpha', min: 3 })).toBe(false)
    expect(test({ kind: 'hostility_tier', faction: 'f_alpha', min: 'recorded', max: 'trouble' })).toBe(true)
    expect(test({ kind: 'hostility_tier', faction: 'f_alpha', max: 'recorded' })).toBe(false)
    expect(test({ kind: 'hostility_tier', faction: 'f_beta', min: 'recorded' })).toBe(false)
    setMeter(g, 'favor', 'f_alpha', 65)
    expect(test({ kind: 'favor_tier', faction: 'f_alpha', min: 'trusted' })).toBe(true)
    expect(test({ kind: 'favor_tier', faction: 'f_alpha', min: 'kin' })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'hostility_tier', faction: 'f_alpha', min: 'nope' }, 'c').length).toBeGreaterThan(0)
    expect(g.k.conditions.validate({ kind: 'hostility_tier', min: 1 }, 'c').length).toBeGreaterThan(0)
    expect(g.k.conditions.validate({ kind: 'hostility_tier', faction: 'f_alpha' }, 'c').length).toBeGreaterThan(0)
  })

  it('規則可以用資料蓋掉：分段的門檻', () => {
    const g = make({ rule: { hostility_bands: [0, 10, 30, 50, 70, 90] } })
    setMeter(g, 'hostility', 'f_alpha', 10)
    expect(hostilityTier(g.k, g.state, 'f_alpha').id).toBe('recorded')
    setMeter(g, 'hostility', 'f_alpha', 90)
    expect(hostilityTier(g.k, g.state, 'f_alpha').id).toBe('wanted')
    expect(() => make({ rule: { hostility_bands: [0, 10, 5, 50, 70, 90] } })).toThrow(ContentError)
    expect(() => make({ rule: { decay_weekly: 5.5 } })).toThrow(ContentError)
  })
})

// ===================================================================================================================
describe('每週消退（FACTIONS 6.3 節：時間）', () => {
  // 預設的週一是第 7、14、21……天的 06:00：從第 6 天 22:00 走 8 小時剛好走到第 7 天 06:00
  const sundayNight = { day: 6, hour: 22, minute: 0 }
  const EIGHT_HOURS = 480

  it('一週沒有新的敵對值：−10', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    const r = advance(g, EIGHT_HOURS)
    expect(hostility(g)).toBe(40)
    expect(actions(r)).toEqual(['test.wait', 'security.decay'])
    expect(r[1]!.changes).toContainEqual({ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: -10 })
    expect(r[1]!.outcome.summary).toContain('50')
    expect(r[1]!.outcome.summary).toContain('40')
  })

  it('那一週有新的敵對值：−5；消退之後的下一週又是 −10', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: 3 }])
    expect(hostility(g)).toBe(53)
    advance(g, EIGHT_HOURS)
    expect(hostility(g)).toBe(48)
    // 沒有新的了：再過一週 −10
    advance(g, 7 * 1440)
    expect(hostility(g)).toBe(38)
  })

  it('「有新的」只看自己：別的勢力那一週沒有新的就 −10', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    setMeter(g, 'hostility', 'f_beta', 50)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: 1 }])
    advance(g, EIGHT_HOURS)
    expect([hostility(g, 'f_alpha'), hostility(g, 'f_beta')]).toEqual([46, 40])
  })

  it('不管敵對值是怎麼加的（掃橋、事件、直接的變更）都記得到；降下去的不算新的', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    setMeter(g, 'hostility', 'f_beta', 50)
    g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_alpha', set: 60 }]))
    g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_beta', delta: -4 }]))
    advance(g, EIGHT_HOURS)
    expect([hostility(g, 'f_alpha'), hostility(g, 'f_beta')]).toEqual([55, 36])
  })

  it('下限 30 時停在 30（−10 也一樣；−5 也一樣）', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 35)
    setMeter(g, 'hostility_floor', 'f_alpha', 30)
    advance(g, EIGHT_HOURS)
    expect(hostility(g)).toBe(30)
    advance(g, 7 * 1440)
    expect(hostility(g)).toBe(30)
    const h = make({ patch: { time: sundayNight } })
    setMeter(h, 'hostility', 'f_alpha', 33)
    setMeter(h, 'hostility_floor', 'f_alpha', 30)
    give(h, [{ kind: 'hostility', key: 'f_alpha', amount: 1 }])
    advance(h, EIGHT_HOURS)
    expect(hostility(h)).toBe(30)
  })

  it('兩週一次跨過：補兩次（第一週看有沒有新的、第二週沒有）', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    const r = advance(g, EIGHT_HOURS + 7 * 1440)
    expect(hostility(g)).toBe(30)
    expect(r.filter((x) => x.action === 'security.decay')).toHaveLength(1)
    const withNew = make({ patch: { time: sundayNight } })
    setMeter(withNew, 'hostility', 'f_alpha', 50)
    give(withNew, [{ kind: 'hostility', key: 'f_alpha', amount: 2 }])
    advance(withNew, EIGHT_HOURS + 7 * 1440)
    expect(hostility(withNew)).toBe(52 - 5 - 10)
    // 三個週一，而且碰到 0：不會低於 0
    const low = make({ patch: { time: sundayNight } })
    setMeter(low, 'hostility', 'f_alpha', 15)
    advance(low, EIGHT_HOURS + 14 * 1440)
    expect(hostility(low)).toBe(0)
  })

  it('沒有跨過週一、或沒有任何敵對值：不出報告', () => {
    const g = make({ patch: { time: sundayNight } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    expect(actions(advance(g, 60))).toEqual(['test.wait'])
    expect(hostility(g)).toBe(50)
    const none = make({ patch: { time: sundayNight } })
    expect(actions(advance(none, EIGHT_HOURS))).toEqual(['test.wait'])
  })

  it('規則可以用資料蓋掉（每週 −2、安靜的一週 −4）', () => {
    const g = make({ patch: { time: sundayNight }, rule: { decay_weekly: 2, decay_quiet: 4 } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    advance(g, EIGHT_HOURS)
    expect(hostility(g)).toBe(46)
  })
})

// ===================================================================================================================
describe('收買（FACTIONS 6.3 節）', () => {
  it('價錢：每降 1 點 50 ×（敵對值 ÷ 20 進位）；敵對值 45 降 10 點 = 50 × 3 × 10 = 1500', () => {
    expect([1, 20, 21, 40, 41, 45, 60, 100].map((h) => bribeUnit({ content: make().k.content }, h))).toEqual([50, 50, 100, 100, 150, 150, 150, 250])
    const g = make()
    setMeter(g, 'hostility', 'f_alpha', 45)
    expect(bribePrice(g.k, g.state, 'f_alpha', 10)).toBe(1500)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 10)).toBeNull()
    const r = g.commit(bribe(g.k, g.state, 'f_alpha', 10))
    expect(r.map((x) => x.action)).toEqual(['security.bribe'])
    expect(g.state.money.cash).toBe(3500)
    expect(hostility(g)).toBe(35)
    expect(r[0]!.outcome.summary).toContain('1500')
  })

  it('不收錢的勢力被擋下並有原因（寫 false 的、沒寫的都一樣）；錢與敵對值都沒動', () => {
    const g = make()
    setMeter(g, 'hostility', 'f_beta', 45)
    setMeter(g, 'hostility', 'f_gamma', 45)
    expect(bribeBlock(g.k, g.state, 'f_beta', 5)).toBe('貝塔不收錢。')
    expect(bribeBlock(g.k, g.state, 'f_gamma', 5)).toBe('伽瑪不收錢。')
    expect(() => bribe(g.k, g.state, 'f_beta', 5)).toThrow(ActionBlocked)
    expect(() => bribe(g.k, g.state, 'f_beta', 5)).toThrow('貝塔不收錢。')
    expect([g.state.money.cash, hostility(g, 'f_beta')]).toEqual([5000, 45])
  })

  it('現金不夠被擋下，原因寫出要多少、有多少', () => {
    const g = make({ patch: { money: { cred: 99999, cash: 1000 } } })
    setMeter(g, 'hostility', 'f_alpha', 45)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 10)).toBe('現金不夠：降 10 點要 1500 C$，你的現金只有 1000 C$。')
    expect(bribeBlock(g.k, g.state, 'f_alpha', 6)).toBeNull()
    expect(() => bribe(g.k, g.state, 'f_alpha', 10)).toThrow(ActionBlocked)
  })

  it('一次最多降 20 點；點數要是 1 以上的整數；最多降到下限；沒有敵對值不用收買；找不到的勢力', () => {
    const g = make({ patch: { money: { cred: 0, cash: 99999 } } })
    setMeter(g, 'hostility', 'f_alpha', 70)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 21)).toBe('收買一次最多降 20 點。')
    expect(bribeBlock(g.k, g.state, 'f_alpha', 20)).toBeNull()
    expect(bribeBlock(g.k, g.state, 'f_alpha', 0)).toMatch(/要收買幾點/)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 2.5)).toMatch(/要收買幾點/)
    setMeter(g, 'hostility_floor', 'f_alpha', 60)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 11)).toMatch(/最多還能降 10 點/)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 10)).toBeNull()
    setMeter(g, 'hostility', 'f_alpha', 60)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 1)).toMatch(/下限/)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 1)).not.toBeNull()
    setMeter(g, 'hostility', 'f_alpha', 0)
    setMeter(g, 'hostility_floor', 'f_alpha', 0)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 1)).toMatch(/不用收買/)
    expect(bribeBlock(g.k, g.state, 'f_nobody', 1)).toMatch(/沒有 f_nobody/)
  })

  it('收買降下來的不算「新的敵對值」；下一個週一仍然 −10', () => {
    const g = make({ patch: { time: { day: 6, hour: 22, minute: 0 } } })
    setMeter(g, 'hostility', 'f_alpha', 50)
    g.commit(bribe(g.k, g.state, 'f_alpha', 10))
    advance(g, 480)
    expect(hostility(g)).toBe(30)
  })

  it('敵對值的清單：現在有敵對值的勢力、哪一段、下限、收不收買', () => {
    const g = make()
    expect(hostilityView(g.k, g.state)).toEqual([])
    setMeter(g, 'hostility', 'f_alpha', 45)
    setMeter(g, 'hostility', 'f_beta', 82)
    setMeter(g, 'hostility_floor', 'f_beta', 40)
    setMeter(g, 'hostility_floor', 'f_gamma', 30)
    const v = hostilityView(g.k, g.state)
    expect(v.map((r) => [r.faction, r.value, r.tier.name, r.floor])).toEqual([['f_beta', 82, '懸賞', 40], ['f_alpha', 45, '找麻煩', 0], ['f_gamma', 0, '沒注意', 30]])
    expect(v[0]!.name).toBe('貝塔')
    expect(v[0]!.bribe).toBe('貝塔不收錢。')
    expect(v[1]!.bribe).toBeNull()
    setMeter(g, 'favor', 'f_alpha', 65)
    expect(favorView(g.k, g.state).map((r) => [r.faction, r.value, r.tier.name])).toEqual([['f_alpha', 65, '信任']])
  })
})

// ===================================================================================================================
describe('掃橋', () => {
  const gate = (o: Partial<ScanSetup> = {}): ScanSetup => ({ point: 'gate_a', name: '企業大門', strength: 2, faction: 'f_alpha', ...o })
  /** 發起掃橋（替身 caller 發起）：回傳那一步的報告。 */
  const scan = (g: G, setup: ScanSetup = gate()): Report[] => g.launch('scan', setup, { by: 'caller', ref: 'gate1', ext: { n: 1 } })
  const ids = (g: G): string[] => eventView(g.k, g.state)!.options.map((o) => o.id)
  const choose = (g: G, id: string): Report[] => g.commit(chooseOption(g.k, g.state, id))
  const has = (g: G, id: string): number => g.state.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
  const withGun = (o: Opts = {}, list: Carry[] = [GUN]): { g: G; log: Heard[] } => {
    const log: Heard[] = []
    const g = make({ ...o, features: [caller(log), carrying(list), ...(o.features ?? [])], patch: { inventory: [{ id: 'it_gun', qty: 1 }, { id: 'it_rifle', qty: 1 }, { id: 'it_pistol', qty: 1 }, { id: 'it_knife', qty: 1 }], ...o.patch } })
    return { g, log }
  }

  describe('不用跳事件', () => {
    it('強度 0 的點：不跳事件，直接一份 scan.pass，發起的替身收到 passed: true（origin 原樣）', () => {
      const { g, log } = withGun()
      const r = scan(g, gate({ strength: 0 }))
      expect(actions(r)).toEqual(['scan.pass'])
      expect(openEventOf(g.state)).toBeNull()
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({ kind: 'scan', origin: { by: 'caller', ref: 'gate1', ext: { n: 1 } }, outcome: 'pass', result: { passed: true, how: 'no_scan' } })
      expect(Object.keys(log[0]!.result).sort()).toEqual(['how', 'passed'])
      // 發起的人回傳的變更與句子併進那一份報告
      expect(g.state.flags.scan_no_scan).toBe(true)
      expect(r[0]!.narration?.results).toContain('發起的人收到了結果')
      // 強度 0 不問身上帶什麼：東西都還在
      expect(has(g, 'it_gun')).toBe(1)
    })

    it('什麼都沒掃到、身分沒問題、沒被認出來：直接通過（how: clear）', () => {
      const { g, log } = withGun({}, [])
      expect(actions(scan(g))).toEqual(['scan.pass'])
      expect(log[0]!.result).toEqual({ passed: true, how: 'clear' })
      expect(openEventOf(g.state)).toBeNull()
    })

    it('身上有東西、但這一級掃不到（強度 1 不掃小的）：直接通過', () => {
      const { g, log } = withGun({}, [{ ...GUN, min: 2 }])
      scan(g, gate({ strength: 1 }))
      expect(log[0]!.result).toEqual({ passed: true, how: 'clear' })
      const two = withGun({}, [{ ...GUN, min: 2 }])
      scan(two.g, gate({ strength: 2 }))
      expect(openEventOf(two.g.state)).not.toBeNull()
    })

    it('強度 0 的點就算被通緝也直接過（這裡沒有人掃）', () => {
      const { g, log } = withGun({}, [])
      setMeter(g, 'hostility', 'f_alpha', 100)
      scan(g, gate({ strength: 0 }))
      expect(log[0]!.result.passed).toBe(true)
    })
  })

  describe('跳事件：身上有掃得到的違禁品', () => {
    it('強度 2、身上有掃得到的違禁武器：跳出事件（照常過、掉頭；沒有假身分就沒有那個選項）；掃橋的框給介面畫', () => {
      const { g, log } = withGun()
      const r = scan(g)
      expect(actions(r)).toEqual(['event.open'])
      expect(openEventOf(g.state)).not.toBeNull()
      expect(log).toHaveLength(0)
      expect(ids(g)).toEqual(['proceed', 'turn_back'])
      expect(eventView(g.k, g.state)!.text).toContain('企業大門')
      expect(eventView(g.k, g.state)!.options[0]!.text).toContain('改裝手槍')
      const v = scanView(g.k, g.state)!
      expect(v).toMatchObject({ point: 'gate_a', name: '企業大門', strength: 2, scans: '掃所有武器與違禁的義體。', faction: { id: 'f_alpha', name: '阿爾法' } })
      expect(v.steps.map((s) => [s.id, s.state])).toEqual([['identity', 'pass'], ['hostility', 'pass'], ['fake', 'na'], ['bridge', 'na']])
      expect(v.steps[3]!.note).toMatch(/還沒有開放/)
      expect(v.carried.map((c) => [c.item, c.legal, c.seized])).toEqual([['it_gun', 'banned', true]])
      expect(v.options.map((o) => [o.id, o.locked])).toEqual([['proceed', null], ['turn_back', null]])
      // 事件開著時別的行動被擋下（句子是事件視窗給的）
      expect(g.blockOf('commit:test.walk')).toMatch(/先回應/)
    })

    it('選照常過：武器沒了、敵對值上升（違禁 +10）、passed: false（how: confiscated）；發起的人收到原樣的 origin', () => {
      const { g, log } = withGun()
      scan(g)
      const r = choose(g, 'proceed')
      expect(actions(r)).toEqual(['event.close'])
      expect(has(g, 'it_gun')).toBe(0)
      expect(has(g, 'it_rifle')).toBe(1)
      expect(hostility(g)).toBe(10)
      expect(openEventOf(g.state)).toBeNull()
      expect(g.state.ext.security_scan).toBeUndefined()
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({ kind: 'scan', origin: { by: 'caller', ref: 'gate1', ext: { n: 1 } }, outcome: 'stop', result: { passed: false, how: 'confiscated' } })
      expect(r[0]!.outcome.summary).toContain('改裝手槍')
      expect(r[0]!.outcome.summary).toContain('發起的人收到了結果')
      expect(g.state.flags.scan_confiscated).toBe(true)
      expect(scanView(g.k, g.state)).toBeNull()
    })

    it('選掉頭：什麼都沒變（東西、敵對值、錢），passed: false（how: turned_back）', () => {
      const { g, log } = withGun()
      scan(g)
      const before = JSON.stringify([g.state.inventory, g.state.meters, g.state.money])
      const r = choose(g, 'turn_back')
      expect(actions(r)).toEqual(['event.close'])
      expect(JSON.stringify([g.state.inventory, g.state.meters, g.state.money])).toBe(before)
      expect(log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
      expect(openEventOf(g.state)).toBeNull()
    })

    it('區的倍率：冠冕區違禁 +10 變 +20；沒有勢力的點只沒收、不加敵對值', () => {
      const { g } = withGun({ patch: inDistrict('crown') })
      scan(g)
      choose(g, 'proceed')
      expect(hostility(g)).toBe(20)
      const none = withGun()
      scan(none.g, gate({ faction: undefined }))
      choose(none.g, 'proceed')
      expect(has(none.g, 'it_gun')).toBe(0)
      expect(Object.keys(none.g.state.meters.hostility ?? {})).toEqual([])
      expect(none.log[0]!.result).toEqual({ passed: false, how: 'confiscated' })
    })

    it('照合法性：自由與登記類放行（passed: true）；許可類沒有執照沒收（+5）、有執照放行；違禁一律沒收', () => {
      const run = (list: Carry[], inv: Array<{ id: string; qty: number }> = []) => {
        const log: Heard[] = []
        const g = make({ features: [caller(log), carrying(list)], patch: { inventory: [{ id: 'it_gun', qty: 1 }, { id: 'it_rifle', qty: 1 }, { id: 'it_pistol', qty: 1 }, { id: 'it_knife', qty: 1 }, ...inv] } })
        scan(g)
        if (openEventOf(g.state)) choose(g, 'proceed')
        return { g, result: log[0]!.result }
      }
      const free = run([KNIFE, PISTOL])
      expect(free.result).toEqual({ passed: true, how: 'proceed' })
      expect([has(free.g, 'it_knife'), has(free.g, 'it_pistol'), hostility(free.g)]).toEqual([1, 1, 0])
      const permit = run([RIFLE])
      expect(permit.result).toEqual({ passed: false, how: 'confiscated' })
      expect([has(permit.g, 'it_rifle'), hostility(permit.g)]).toEqual([0, 5])
      const licensed = run([RIFLE], [{ id: 'it_licence', qty: 1 }])
      expect(licensed.result).toEqual({ passed: true, how: 'proceed' })
      expect([has(licensed.g, 'it_rifle'), hostility(licensed.g)]).toEqual([1, 0])
      // license:<物品的 id> 只對那一件有效
      expect(run([RIFLE], [{ id: 'it_licence_rifle', qty: 1 }]).result.passed).toBe(true)
      const mixed = run([KNIFE, RIFLE, GUN])
      expect([has(mixed.g, 'it_knife'), has(mixed.g, 'it_rifle'), has(mixed.g, 'it_gun'), hostility(mixed.g)]).toEqual([1, 0, 0, 10])
    })
  })

  describe('身分與敵對值', () => {
    it('need_class: member 的點：市民被攔下並有原因（照常過與假身分都不通，只有掉頭）', () => {
      const { g, log } = withGun({}, [])
      scan(g, gate({ need_class: 'member' }))
      expect(ids(g)).toEqual(['proceed', 'turn_back'])
      const o = eventView(g.k, g.state)!.options
      expect(o[0]!.locked).toBe('這裡要社員的身分才進得去，你是市民，被攔了下來。')
      expect(scanView(g.k, g.state)!.steps[0]).toMatchObject({ id: 'identity', state: 'attention' })
      expect(() => choose(g, 'proceed')).toThrow('被攔了下來')
      choose(g, 'turn_back')
      expect(log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
    })

    it('社員進得去；契約人當市民；need_class: citizen 時社員也進得去', () => {
      const member = withGun({ pc: { ext: { identity: { class: 'member' } } } }, [])
      scan(member.g, gate({ need_class: 'member' }))
      expect(member.log[0]!.result).toEqual({ passed: true, how: 'clear' })
      const upper = withGun({ pc: { ext: { identity: { class: 'member' } } } }, [])
      scan(upper.g, gate({ need_class: 'citizen' }))
      expect(upper.log[0]!.result.passed).toBe(true)
      const bound = withGun({ pc: { ext: { identity: { class: 'bound' } } } }, [])
      scan(bound.g, gate({ need_class: 'citizen' }))
      expect(bound.log[0]!.result.passed).toBe(true)
      const boundMember = withGun({ pc: { ext: { identity: { class: 'bound' } } } }, [])
      scan(boundMember.g, gate({ need_class: 'member' }))
      expect(openEventOf(boundMember.g.state)).not.toBeNull()
    })

    it('無籍沒有橋 ID 可掃：進不了強度 1 以上的點（強度 0 的地方照樣過）；也不會被認出來', () => {
      const run = (strength: number) => {
        const w = withGun({ pc: { ext: { identity: { class: 'unregistered' } } } }, [])
        setMeter(w.g, 'hostility', 'f_alpha', 50)
        scan(w.g, gate({ strength, faction: 'f_alpha' }))
        return w
      }
      expect(run(0).log[0]!.result.passed).toBe(true)
      const one = run(1)
      expect(openEventOf(one.g.state)).not.toBeNull()
      expect(eventView(one.g.k, one.g.state)!.options[0]!.locked).toBe('你是無籍，沒有橋 ID 可以掃，進不了要掃橋的地方。')
    })

    it('actor.ext.identity 沒寫、或寫壞了：當市民', () => {
      const g = make()
      expect(planScan(g.k, g.state, gate()).cls).toBe('citizen')
      g.state.actors.pc!.ext.identity = { class: 'wizard' }
      expect(planScan(g.k, g.state, gate()).cls).toBe('citizen')
      expect(CLASS_NAME).toEqual({ member: '社員', citizen: '市民', unregistered: '無籍', bound: '契約人' })
    })

    it('記名（20）以上被認出來：就算身上沒東西也跳事件；照常過就過了（不沒收、不加敵對值）；四步裡那一步是「注意」', () => {
      const { g, log } = withGun({}, [])
      setMeter(g, 'hostility', 'f_alpha', 25)
      scan(g)
      expect(ids(g)).toEqual(['proceed', 'turn_back'])
      const step = scanView(g.k, g.state)!.steps[1]!
      expect(step).toMatchObject({ id: 'hostility', state: 'attention' })
      expect(step.note).toContain('記名')
      choose(g, 'proceed')
      expect(log[0]!.result).toEqual({ passed: true, how: 'proceed' })
      expect(hostility(g)).toBe(25)
      // 19 沒有被認出來
      const quiet = withGun({}, [])
      setMeter(quiet.g, 'hostility', 'f_alpha', 19)
      scan(quiet.g)
      expect(quiet.log[0]!.result).toEqual({ passed: true, how: 'clear' })
    })

    it('別的勢力的敵對值不影響這個點；沒有勢力的點不看敵對值', () => {
      const { g, log } = withGun({}, [])
      setMeter(g, 'hostility', 'f_beta', 100)
      scan(g)
      expect(log[0]!.result.passed).toBe(true)
      const n = withGun({}, [])
      setMeter(n.g, 'hostility', 'f_alpha', 100)
      scan(n.g, gate({ faction: undefined }))
      expect(n.log[0]!.result.passed).toBe(true)
    })

    it('通緝（100）的勢力的檢查哨：三個選項裡只有掉頭走得通（照常過、假身分都被擋下並有原因）', () => {
      const { g, log } = withGun({ patch: { inventory: [{ id: 'it_fake3', qty: 1 }] } }, [])
      setMeter(g, 'hostility', 'f_alpha', 100)
      scan(g)
      expect(ids(g)).toEqual(['proceed', 'fake', 'turn_back'])
      const o = eventView(g.k, g.state)!.options
      expect(o.map((x) => x.locked !== null)).toEqual([true, true, false])
      expect(o[0]!.locked).toBe('阿爾法通緝著你，它的檢查哨一律攔你，只有掉頭走得通。')
      expect(o[1]!.locked).toBe(o[0]!.locked)
      expect(() => choose(g, 'proceed')).toThrow('通緝')
      expect(() => choose(g, 'fake')).toThrow(ActionBlocked)
      expect(openEventOf(g.state)).not.toBeNull()
      choose(g, 'turn_back')
      expect(log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
      // 99 還不是通緝
      const almost = withGun({}, [])
      setMeter(almost.g, 'hostility', 'f_alpha', 99)
      scan(almost.g)
      expect(eventView(almost.g.k, almost.g.state)!.options[0]!.locked).toBeNull()
    })
  })

  describe('假身分（ADR G17）', () => {
    const withFake = (items: Array<{ id: string; qty: number }>, o: Opts = {}, list: Carry[] = []) => withGun({ ...o, patch: { inventory: items, ...o.patch } }, list)

    it('身上沒有假身分時沒有那個選項；有才列', () => {
      const none = withGun({}, [])
      setMeter(none.g, 'hostility', 'f_alpha', 25)
      scan(none.g)
      expect(ids(none.g)).not.toContain('fake')
      const has2 = withFake([{ id: 'it_fake2', qty: 1 }])
      setMeter(has2.g, 'hostility', 'f_alpha', 25)
      scan(has2.g)
      expect(ids(has2.g)).toEqual(['proceed', 'fake', 'turn_back'])
    })

    it('等級不低於強度：自動過（淺層對強度 2）；淺層留著、一次性的用掉就沒了', () => {
      const shallow = withFake([{ id: 'it_fake2', qty: 1 }])
      setMeter(shallow.g, 'hostility', 'f_alpha', 25)
      scan(shallow.g)
      const o = eventView(shallow.g.k, shallow.g.state)!.options.find((x) => x.id === 'fake')!
      expect(o.check).toBeUndefined()
      expect(o.locked).toBeNull()
      expect(scanView(shallow.g.k, shallow.g.state)!.steps[2]).toMatchObject({ id: 'fake', state: 'pass' })
      const r = choose(shallow.g, 'fake')
      expect(shallow.log[0]!.result).toEqual({ passed: true, how: 'fake' })
      expect(has(shallow.g, 'it_fake2')).toBe(1)
      expect(r[0]!.outcome.summary).toContain('假身分')
      // 一次性的對強度 1 自動過（強度 1、記名）
      const once = withFake([{ id: 'it_fake1', qty: 2 }])
      setMeter(once.g, 'hostility', 'f_alpha', 25)
      scan(once.g, gate({ strength: 1 }))
      choose(once.g, 'fake')
      expect(once.log[0]!.result).toEqual({ passed: true, how: 'fake' })
      expect(has(once.g, 'it_fake1')).toBe(1)
    })

    it('有幾張就挑夠用的最低一張（不浪費好的）', () => {
      const w = withFake([{ id: 'it_fake3', qty: 1 }, { id: 'it_fake2', qty: 1 }, { id: 'it_fake1', qty: 1 }])
      setMeter(w.g, 'hostility', 'f_alpha', 25)
      scan(w.g, gate({ strength: 2 }))
      choose(w.g, 'fake')
      expect([has(w.g, 'it_fake1'), has(w.g, 'it_fake2'), has(w.g, 'it_fake3')]).toEqual([1, 1, 1])
      expect(w.log[0]!.result.passed).toBe(true)
      const one = withFake([{ id: 'it_fake3', qty: 1 }, { id: 'it_fake1', qty: 1 }])
      setMeter(one.g, 'hostility', 'f_alpha', 25)
      scan(one.g, gate({ strength: 1 }))
      choose(one.g, 'fake')
      expect([has(one.g, 'it_fake1'), has(one.g, 'it_fake3')]).toEqual([0, 1])
    })

    it('假身分只管身分：身上的違禁品照樣被沒收（passed: false，一次性的假身分也用掉）', () => {
      const w = withFake([{ id: 'it_fake1', qty: 1 }, { id: 'it_gun', qty: 1 }], {}, [GUN])
      scan(w.g, gate({ strength: 1 }))
      expect(ids(w.g)).toEqual(['proceed', 'fake', 'turn_back'])
      choose(w.g, 'fake')
      expect(w.log[0]!.result).toEqual({ passed: false, how: 'confiscated' })
      expect([has(w.g, 'it_fake1'), has(w.g, 'it_gun'), hostility(w.g)]).toEqual([0, 0, 10])
    })

    it('低一級：淺層對強度 3 要擲，難度 13 ＋ 3 × 2 = 19；框裡有成功率', () => {
      const w = withFake([{ id: 'it_fake2', qty: 1 }], {}, [{ ...GUN, min: 3 }])
      scan(w.g, gate({ strength: 3 }))
      expect(ids(w.g)).toEqual(['proceed', 'fake', 'turn_back'])
      const fake = eventView(w.g.k, w.g.state)!.options.find((x) => x.id === 'fake')!
      expect(fake.check).toMatchObject({ skill: 'perform', attr: 'charm', dc: 19 })
      expect(fake.locked).toBeNull()
      const v = scanView(w.g.k, w.g.state)!
      expect(v.steps[2]).toMatchObject({ state: 'attention' })
      expect(v.steps[2]!.note).toContain('19')
      const o = v.options.find((x) => x.id === 'fake')!
      expect(o.check).toMatchObject({ skill: 'perform', dc: 19 })
      expect(o.check!.chance).toBeGreaterThan(0)
      expect(o.check!.chance).toBeLessThan(100)
    })

    describe('擲骰：固定骰面下成功與失敗', () => {
      // 在同一個種子上先看骰面（骰面不看 DC），再把規則的難度底數調成想要的成功程度：強度 3 的 DC = 底數 + 6（記名以上再 +2）
      const rig = (seed: number, base: number, o: { gun?: boolean; recorded?: boolean } = {}) => {
        const w = withFake([{ id: 'it_fake2', qty: 1 }, ...(o.gun ? [{ id: 'it_gun', qty: 1 }] : [])], { seed, rule: { fake_dc_base: base } }, o.gun ? [{ ...GUN, min: 3 }] : [])
        if (o.recorded) setMeter(w.g, 'hostility', 'f_alpha', 25)
        scan(w.g, gate({ strength: 3 }))
        return w
      }
      const found = (() => {
        for (let seed = 1; seed < 300; seed++) {
          const w = rig(seed, 13, { gun: true })
          const roll = chooseOption(w.g.k, w.g.state, 'fake').timeline.find((b) => b.roll)!.roll!
          if (roll.natural >= 9 && roll.natural <= 15) return { seed, natural: roll.natural, total: roll.total }
        }
        throw new Error('找不到合適的種子')
      })()
      const ok = found.total - 6 - 1
      const bad = found.total - 6 + 1
      const play = (w: ReturnType<typeof rig>) => {
        const d = chooseOption(w.g.k, w.g.state, 'fake')
        const roll = d.timeline.find((b) => b.roll)!.roll!
        return { roll, reports: w.g.commit(d) }
      }

      it('擲得過：假身分過了身分這一關，淺層留著；報告的時間軸有那一次擲骰（身上的違禁品另算）', () => {
        const w = rig(found.seed, ok, { gun: true })
        const { roll, reports } = play(w)
        expect(roll.natural).toBe(found.natural)
        expect(roll.degree === 'success' || roll.degree === 'critical').toBe(true)
        expect(reports[0]!.timeline.some((b) => b.roll)).toBe(true)
        expect(has(w.g, 'it_fake2')).toBe(1)
        expect(w.log[0]!.result).toEqual({ passed: false, how: 'confiscated' })
        expect(has(w.g, 'it_gun')).toBe(0)
      })

      it('沒有違禁品、擲得過：passed: true（how: fake）；記名以上的難度多 2，所以底數調低 2 才一樣過', () => {
        const w = rig(found.seed, ok - 2, { recorded: true })
        const { roll } = play(w)
        expect(roll.dc).toBe(found.total - 1)
        expect(w.log[0]!.result).toEqual({ passed: true, how: 'fake' })
        expect(has(w.g, 'it_fake2')).toBe(1)
      })

      it('擲不過：被識破，假身分被收走、那個勢力的敵對值 +5、passed: false（how: fake_failed）；身上的東西沒動', () => {
        const w = rig(found.seed, bad, { gun: true })
        const { roll } = play(w)
        expect(roll.degree === 'fail' || roll.degree === 'fumble').toBe(true)
        expect(w.log[0]!.result).toEqual({ passed: false, how: 'fake_failed' })
        expect(has(w.g, 'it_fake2')).toBe(0)
        expect(has(w.g, 'it_gun')).toBe(1)
        expect(hostility(w.g)).toBe(5)
      })

      it('同一個種子：同樣的骰面、同樣的結果', () => {
        const a = play(rig(found.seed, bad, { gun: true }))
        const b = play(rig(found.seed, bad, { gun: true }))
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      })
    })

    it('更低不能用：一次性的對強度 3（相差兩級）被擋下並有原因；選項還在（身上有才列）', () => {
      const w = withFake([{ id: 'it_fake1', qty: 1 }], {}, [{ ...GUN, min: 3 }])
      scan(w.g, gate({ strength: 3 }))
      const o = eventView(w.g.k, w.g.state)!.options.find((x) => x.id === 'fake')!
      expect(o.locked).toBe('身上最好的假身分（一次性假身分）等級太低，過不了這一級的掃描。')
      expect(() => choose(w.g, 'fake')).toThrow(ActionBlocked)
      expect(has(w.g, 'it_fake1')).toBe(1)
      expect(scanView(w.g.k, w.g.state)!.steps[2]).toMatchObject({ state: 'attention' })
    })

    it('記名以上，用假身分的檢定 +2 難度；沒有被認出來不加', () => {
      const dcOf = (hostilityValue: number) => {
        const w = withFake([{ id: 'it_fake2', qty: 1 }], {}, [{ ...GUN, min: 3 }])
        setMeter(w.g, 'hostility', 'f_alpha', hostilityValue)
        scan(w.g, gate({ strength: 3 }))
        return eventView(w.g.k, w.g.state)!.options.find((x) => x.id === 'fake')!.check!.dc
      }
      expect([dcOf(0), dcOf(19), dcOf(20), dcOf(79)]).toEqual([19, 19, 21, 21])
    })
  })

  describe('沒有事件視窗、無效的設定、不能同時開兩個', () => {
    it('沒裝事件視窗：當成照常過，直接結算（沒收、敵對值、passed: false）', () => {
      const { g, log } = withGun({ window: false })
      const r = scan(g)
      expect(actions(r)).toEqual(['scan.stop'])
      expect(log[0]!.result).toEqual({ passed: false, how: 'confiscated' })
      expect([has(g, 'it_gun'), hostility(g)]).toEqual([0, 10])
      const w = withGun({ window: false }, [])
      setMeter(w.g, 'hostility', 'f_alpha', 100)
      scan(w.g)
      expect(w.log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
    })

    it('setup 不對：整步不成立、狀態不動', () => {
      const g = make({ features: [caller([])] })
      const before = JSON.stringify(g.state)
      for (const bad of [{}, { point: 'p', name: 'n', strength: 4 }, { point: 'p', name: 'n', strength: 1.5 }, { point: 'p', name: 'n', strength: 1, faction: 'f_nobody' }, { point: 'p', name: 'n', strength: 1, need_class: 'king' }, { point: '', name: 'n', strength: 1 }, null]) {
        expect(() => g.launch('scan', bad, { by: 'caller' })).toThrow(ActionBlocked)
      }
      expect(JSON.stringify(g.state)).toBe(before)
    })

    it('掃橋的事件開著時不能再開一個掃橋', () => {
      const { g } = withGun()
      scan(g)
      expect(() => scan(g)).toThrow(ActionBlocked)
    })

    it('resolveScan：「我要做別的」（free）算掉頭的一種：什麼都不變、passed: false', () => {
      const { g } = withGun()
      const p = planScan(g.k, g.state, gate())
      expect(resolveScan(g.k, g.state, p, 'free')).toMatchObject({ passed: false, how: 'free', changes: [] })
      expect(resolveScan(g.k, g.state, p, 'nonsense')).toMatchObject({ passed: false, how: 'turned_back', changes: [] })
    })
  })

  describe('存檔、種子與不變式', () => {
    const play = (seed: number) => {
      const { g, log } = withGun({ seed })
      scan(g)
      choose(g, 'proceed')
      return JSON.stringify([g.state.inventory, g.state.meters, g.state.rng, g.state.flags, log.map((l) => [l.outcome, l.result, l.origin])])
    }

    it('同一個種子、同樣的選擇：結果一樣', () => {
      expect(play(9)).toBe(play(9))
    })

    it('掃橋的事件開著時存檔再讀，照樣走得完（框、選項、結果不變）', () => {
      const { g } = withGun({ patch: { inventory: [{ id: 'it_gun', qty: 1 }, { id: 'it_fake2', qty: 1 }] } })
      setMeter(g, 'hostility', 'f_alpha', 25)
      scan(g)
      const raw = g.save()
      const log: Heard[] = []
      const h = make({ features: [caller(log), carrying([GUN])] })
      expect(h.load(raw)).toBeNull()
      expect(scanView(h.k, h.state)).toEqual(scanView(g.k, g.state))
      expect(eventView(h.k, h.state)).toEqual(eventView(g.k, g.state))
      choose(h, 'proceed')
      expect(log[0]).toMatchObject({ origin: { by: 'caller', ref: 'gate1', ext: { n: 1 } }, result: { passed: false, how: 'confiscated' } })
      expect(has(h, 'it_gun')).toBe(0)
      expect(hostility(h)).toBe(35)
      expect(h.state.ext.security_scan).toBeUndefined()
    })

    it('報告的紀錄不變式成立（開、選、收尾；強度 0 的直接通過）', async () => {
      const { g } = withGun()
      const { violations } = await observed(g, () => {
        scan(g, gate({ strength: 0 }))
        scan(g)
        choose(g, 'proceed')
      })
      expect(violations).toEqual([])
    })

    it('掛點回答的東西格式不對：略過；合法性不認得的當自由', () => {
      const bad: Feature = { id: 'bad_carry', install: (k) => k.hooks.on('scan.carried', 'bad_carry', () => [{ item: '', name: 'x', legal: 'banned' }, { name: 'y', legal: 'banned' } as never, { item: 'it_knife', name: '怪東西', legal: 'cursed' }]) }
      const log: Heard[] = []
      const g = make({ features: [caller(log), bad] })
      scan(g)
      expect(scanView(g.k, g.state)!.carried).toEqual([{ item: 'it_knife', name: '怪東西', legal: 'free', seized: false, note: '自由，放行。' }])
    })

    it('回退：選完之後回到掃橋之前，東西與敵對值都回來', () => {
      const { g } = withGun()
      scan(g)
      choose(g, 'proceed')
      expect(has(g, 'it_gun')).toBe(0)
      expect(g.undoSteps(1)).toBe(true)
      expect(has(g, 'it_gun')).toBe(1)
      expect(hostility(g)).toBe(0)
      expect(openEventOf(g.state)).not.toBeNull()
    })
  })
})

// ===================================================================================================================
describe('掃橋：身上的東西用真的 gear', () => {
  const PISTOL_BP = { id: 'bp_pistol', kind: 'weapon', name: '手槍', desc: '手槍。', brand: 'starbelle', grade: 1, legal: 'banned', price: 100, size: 2, weight: 1, require: [{ type: 'barrel' }, { type: 'plate' }], optional: [], class: 'pistol', carry: 'side' }
  const SMALL_BP = { ...PISTOL_BP, id: 'bp_holdout', name: '袖槍', size: 1 }
  const KNIFE_BP = { id: 'bp_knife', kind: 'weapon', name: '小刀', desc: '小刀。', brand: 'starbelle', grade: 1, legal: 'free', price: 10, size: 2, weight: 1, require: [{ type: 'blade' }], optional: [], class: 'melee', carry: 'melee' }
  const part = (id: string, type: string, more: Rec = {}) => ({ id, name: id, type, material: 'mech', brand: 'starbelle', grade: 1, price: 10, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...more })
  const GEAR_PACK: ContentPack = {
    id: 'security_gear',
    content: {
      weapon_class: [
        { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
        { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'firearms' },
      ],
      blueprint: [PISTOL_BP, SMALL_BP, KNIFE_BP],
      part: [part('pt_barrel', 'barrel'), part('pt_barrel_proof', 'barrel', { traits: ['scan_proof'] }), part('pt_plate', 'plate'), part('pt_plate_ceramic', 'plate', { traits: ['scan_proof'] }), part('pt_blade', 'blade')],
    } as unknown as ContentPack['content'],
  }
  const made = (uid: string, blueprint: string, parts: Rec) => ({ id: blueprint, qty: 1, data: { uid, parts } })
  const rig = (carry: Rec, inventory: unknown[]) => {
    const log: Heard[] = []
    const g = make({ features: [gearFeature, caller(log)], content: [GEAR_PACK], pc: { skills: { perform: 1 }, ext: { gear: { worn: {}, acc: {}, carry, quick: [], coat: 'open' } } }, patch: { inventory: inventory as never } })
    return { g, log }
  }
  const scan = (g: G, strength: number) => g.launch('scan', { point: 'gate_g', name: '閘門', strength, faction: 'f_alpha' }, { by: 'caller', ref: 'g1' })
  const pistol = (uid: string, plate = 'pt_plate') => made(uid, 'bp_pistol', { barrel: 'pt_barrel', plate })

  it('強度 2：攜帶格裡的違禁武器被掃到、列在掃橋的框裡；照常過 → 那一把沒了、敵對值 +10', () => {
    const { g, log } = rig({ side: 'w1' }, [pistol('w1')])
    scan(g, 2)
    const v = scanView(g.k, g.state)!
    expect(v.carried).toEqual([{ item: 'bp_pistol', name: '手槍', legal: 'banned', seized: true, note: '違禁，會被沒收。' }])
    g.commit(chooseOption(g.k, g.state, 'proceed'))
    expect(g.state.inventory.some((s) => s.id === 'bp_pistol')).toBe(false)
    expect(hostility(g)).toBe(10)
    expect(log[0]!.result).toEqual({ passed: false, how: 'confiscated' })
  })

  it('強度 1 只掃大小 2 以上的：大小 1 的袖槍直接過；大小 2 的手槍被掃到', () => {
    const small = rig({ side: 'w1' }, [made('w1', 'bp_holdout', { barrel: 'pt_barrel', plate: 'pt_plate' })])
    scan(small.g, 1)
    expect(small.log[0]!.result).toEqual({ passed: true, how: 'clear' })
    const big = rig({ side: 'w1' }, [pistol('w1')])
    scan(big.g, 1)
    expect(openEventOf(big.g.state)).not.toBeNull()
  })

  it('每個零件都掃不到的（陶瓷板材）、沒帶在攜帶格裡的：掃不到，直接過', () => {
    const proof = rig({ side: 'w1' }, [made('w1', 'bp_pistol', { barrel: 'pt_barrel_proof', plate: 'pt_plate_ceramic' })])
    scan(proof.g, 3)
    expect(proof.log[0]!.result).toEqual({ passed: true, how: 'clear' })
    // 只要有一個零件掃得到：整件還是掃得到
    const partly = rig({ side: 'w1' }, [made('w1', 'bp_pistol', { barrel: 'pt_barrel', plate: 'pt_plate_ceramic' })])
    scan(partly.g, 3)
    expect(openEventOf(partly.g.state)).not.toBeNull()
    const stashed = rig({}, [pistol('w1')])
    scan(stashed.g, 3)
    expect(stashed.log[0]!.result).toEqual({ passed: true, how: 'clear' })
  })

  it('自由的武器（小刀）掃得到也放行：跳事件（有東西被掃到），照常過 → passed: true、小刀還在', () => {
    const { g, log } = rig({ melee: 'k1' }, [made('k1', 'bp_knife', { blade: 'pt_blade' })])
    scan(g, 2)
    expect(scanView(g.k, g.state)!.carried).toMatchObject([{ item: 'bp_knife', legal: 'free', seized: false }])
    g.commit(chooseOption(g.k, g.state, 'proceed'))
    expect(log[0]!.result).toEqual({ passed: true, how: 'proceed' })
    expect(g.state.inventory.some((s) => s.id === 'bp_knife')).toBe(true)
  })
})

// ===================================================================================================================
describe('接上別的功能：俘虜處置的敵對值真的算進去（M2-enemy-encounter 的 capture）', () => {
  const cand = (o: Partial<CaptureCandidate> = {}): CaptureCandidate => ({ unit: 'f1', enemy: 'e_guard', name: '受俘的保全', rank: 'minion', grade: 2, faction: 'f_alpha', adult: null, pct: 40, roll: 10, ...o })
  const treat = (o: Opts = {}, c = cand(), ctx: { employer?: string } = {}) => {
    const log: Heard[] = []
    const g = make({ features: [caller(log)], pc: { attrs: { resolve: 14, charm: 12 }, skills: { intimidate: 2, negotiate: 1, perform: 1 } }, ...o })
    const event = treatEvent(g.k, g.state, c, ctx)
    g.launch('event', { inline: event }, { by: 'enemies', ref: 'b1', ext: { step: 'treat' } })
    return g
  }
  const pick = (g: G, id: string) => g.commit(chooseOption(g.k, g.state, id))

  it('交出去：敵對值 +2、雇主好感 +1（量表是真的，不是替身）；放走：什麼都不加；帶走不列（沒有場景）', () => {
    const hand = treat({}, cand(), { employer: 'f_beta' })
    expect(eventView(hand.k, hand.state)!.options.map((o) => o.id)).toEqual(['ask', 'handover', 'release'])
    pick(hand, 'handover')
    expect(hostility(hand)).toBe(2)
    expect(favor(hand, 'f_beta')).toBe(11)
    const free = treat()
    pick(free, 'release')
    expect(hostility(free)).toBe(0)
  })

  it('問話：不管成功程度，敵對值 +1（問話的 DC 是數字）', () => {
    const g = treat()
    pick(g, 'ask')
    expect(hostility(g)).toBe(1)
  })

  it('在冠冕區做這件事：交出去的 +2 照區的倍率變成 +4', () => {
    const g = treat({ patch: inDistrict('crown') })
    pick(g, 'handover')
    expect(hostility(g)).toBe(4)
  })

  it('這個勢力的敵對值那一週有新的：下一個週一消退 −5（俘虜的處置也記得到）', () => {
    const g = treat({ patch: { time: { day: 6, hour: 22, minute: 0 } } })
    setMeter(g, 'hostility', 'f_alpha', 30)
    pick(g, 'handover')
    expect(hostility(g)).toBe(32)
    advance(g, 480)
    expect(hostility(g)).toBe(27)
  })
})

describe('預設的規則數字', () => {
  it('照設計書：每週 −5、安靜 −10、收買 50 / 20 點進位 / 最多 20、假身分 13 ＋ 強度 × 2、記名 +2', () => {
    expect(DEFAULT_SECURITY_RULES).toMatchObject({ decay_weekly: 5, decay_quiet: 10, bribe_per_point: 50, bribe_step: 20, bribe_max: 20, fake_dc_base: 13, fake_dc_per_strength: 2, fake_recorded_bonus: 2 })
  })
})

// ===================================================================================================================
describe('敵對值的下限：永久的與有期限的，取最高的、不相加、各自到期（EVENTS 2.4 兩列、FACTIONS 6.3；M2-fix-bugs）', () => {
  const DAY = 1440
  const floorFx = (key: string, amount: number, days?: number): Rec => ({ kind: 'hostility_floor', key, amount, ...(days !== undefined ? { days } : {}) })
  const timed = (g: G): Array<{ faction: string; value: number }> => timedFloors(g.state).map((f) => ({ faction: f.faction, value: f.value }))

  it('有期限的（內建的戰敗與契約事件）：敵對值被推到下限之上，期間內降不下去；寫的是下限本身，不是再加多少', () => {
    const g = make()
    const r = give(g, [floorFx('f_alpha', 10, 7)])
    expect(r.lines).toEqual(['敵對值的下限（阿爾法）：至少 10，7 天'])
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(10)
    expect(hostility(g)).toBe(10)
    expect(meterOf(g.k, g.state, 'hostility_floor', 'f_alpha')).toBe(0) // 永久的量表沒動
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: -50 }])
    expect(hostility(g)).toBe(10)
    expect(hostilityView(g.k, g.state).map((x) => [x.faction, x.value, x.floor])).toEqual([['f_alpha', 10, 10]])
  })

  it('到期解除：剛好滿天數就沒有了，敵對值留在原處；之後可以降下去', () => {
    const g = make()
    give(g, [floorFx('f_alpha', 10, 3)])
    advance(g, 3 * DAY - 1)
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(10)
    advance(g, 1)
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(0)
    expect(hostility(g)).toBe(10)
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: -4 }])
    expect(hostility(g)).toBe(6)
    expect(hostilityView(g.k, g.state)[0]).toMatchObject({ value: 6, floor: 0 })
  })

  it('同時有好幾個：取最高的，不相加；各自到期各自解除', () => {
    const g = make()
    give(g, [{ kind: 'hostility_floor', key: 'f_alpha', amount: 30 }]) // 永久 30
    give(g, [floorFx('f_alpha', 10, 3)])
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(30) // 不是 40
    give(g, [floorFx('f_alpha', 50, 2), floorFx('f_alpha', 45, 6)])
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(50)
    expect(hostility(g)).toBe(50)
    advance(g, 2 * DAY)
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(45) // 50 的到期了，45 的還在
    advance(g, 4 * DAY)
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(30) // 都到期，只剩永久的（10 的早到期了）
    // 到期的在下一次寫入時順手清掉
    give(g, [floorFx('f_alpha', 12, 1)])
    expect(timed(g)).toEqual([{ faction: 'f_alpha', value: 12 }])
    // 別的勢力各算各的
    give(g, [floorFx('f_beta', 20, 5)])
    expect(floorOf(g.k, g.state, 'f_beta')).toBe(20)
    expect(floorOf(g.k, g.state, 'f_alpha')).toBe(30)
  })

  it('一般事件（AI）：永久的最多 +5、不能降、不能寫 days；玩家要的結果也不能寫 days（只有內建的事件資料）', () => {
    const g = make()
    give(g, [floorFx('f_alpha', 9)], 'ai')
    expect(meterOf(g.k, g.state, 'hostility_floor', 'f_alpha')).toBe(5)
    for (const source of ['ai', 'player'] as const) {
      for (const clampAsked of [true, false]) {
        const r = g.k.effects.resolve([{ ...floorFx('f_alpha', 10, 7), asked: '鎖橋' }], effectCtx(g.k, g.state, { source, clampAsked, playerInput: '鎖橋' }))
        expect(r.errors.join(), `${source} ${clampAsked}`).toContain('只有戰敗與契約事件')
        expect(r.changes).toEqual([])
      }
    }
    expect(timed(g)).toEqual([])
  })

  it('days 的格式：1～365 的整數；下限本身 1～100；不認得的勢力擋下', () => {
    const g = make()
    const errors = (fx: Rec): string => g.k.effects.resolve([fx], effectCtx(g.k, g.state, { source: 'builtin' })).errors.join()
    for (const days of [0, -1, 1.5, 366, '7', null, Number.NaN]) expect(errors(floorFx('f_alpha', 10, days as number)), String(days)).toContain('days 要是 1～365')
    for (const amount of [0, -5, 101]) expect(errors(floorFx('f_alpha', amount, 7)), String(amount)).toContain('amount（下限本身）')
    expect(errors(floorFx('f_nobody', 10, 7))).toContain('查不到')
    expect(errors({ kind: 'hostility_floor', amount: 10, days: 7 })).toContain('key 要寫明')
    expect(errors(floorFx('f_alpha', 10, 365))).toBe('')
  })

  it('每週消退照每個週一那一刻的下限算：有期限的下限在中間到期，到期之後的週一才往下掉', () => {
    const g = make({ patch: { time: { day: 3, hour: 10, minute: 0 } } })
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: 10 }], 'builtin')
    setMeter(g, 'hostility', 'f_alpha', 40)
    give(g, [floorFx('f_alpha', 40, 10)]) // 到第 13 天 10:00；週一是第 7、14 天 06:00
    advance(g, 12 * DAY) // 第 15 天 10:00：跨過兩個週一
    // 第 7 天的週一下限還在（40，不動）；第 14 天的週一下限已經到期，那一週沒有新的敵對值：−10
    expect(hostility(g)).toBe(30)
  })

  it('收買：下限是有期限的下限時也算（降不到下限以下）', () => {
    const g = make()
    give(g, [{ kind: 'hostility', key: 'f_alpha', amount: 10 }, floorFx('f_alpha', 20, 5)])
    expect(hostility(g)).toBe(20)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 1)).toContain('已經降到下限（20）')
    advance(g, 5 * DAY)
    expect(bribeBlock(g.k, g.state, 'f_alpha', 1)).toBeNull()
  })

  it('不變式、存檔：有期限的下限在存檔裡讀得回來', () => {
    const g = make()
    give(g, [floorFx('f_alpha', 10, 7)])
    const saved = JSON.parse(JSON.stringify(g.state)) as GameState
    expect(timedFloors(saved).map((f) => f.value)).toEqual([10])
  })
})
