// 驗收測試：dev/work/M4-craft-teach.md（cpp-feature）。向 NPC 學工藝：機械、義體學、醫療 0～2 級，付學費、花時段，不花歷練點。
// 規格：CRAFTING 11.2 節；CORE_RULES 第 2 節、7.2 節、7.5 節；dev/adr/0019 第十九節與 P85。
// 內容一律是測試自帶的最小假資料：三項工藝基本功（機械、義體學、醫療）加槍械（5、6 級的請教互不干擾用）；
// 縫縫（教義體學與醫療）、印刷（教機械）、牆語者（教義體學，要勢力「回聲」好感 20、每堂沉溺 +1）、諾拉（只教醫療）、遠方的老師（教機械、在別的區）；
// 兩個區（蜂巢倍率 1、冠冕倍率 3）；好感用 security 定義的量表 favor，沉溺用 characterFeature 的 sink 效果。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, toMinutes } from '../../src'
import {
  DEFAULT_ABILITY_RULES, TUTOR_ACTION, abilitiesFeature, abilitiesOf, abilityRules, lessonDraft, skillUpDraft, teachOptions, tutorBlock, tutorDraft, tutorMax, tutorOptions,
} from '../../src/features/abilities'
import { actionsFeature } from '../../src/features/actions'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import { CONSULT_KIND, interactions, npcsFeature } from '../../src/features/npcs'
import { securityFeature } from '../../src/features/security'
import { makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

const STUBS: Feature = {
  id: 'test_stubs',
  install(k: Kernel) {
    for (const kind of ['district', 'block', 'facility_type']) k.content.defineKind({ kind, owner: 'test', validate: () => [] })
  },
}

const ATTRS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].map((id) => ({ id, name: id, desc: `${id}。` }))
const SKILLS = [['mechanics', 'tech', '機械'], ['cyberware', 'tech', '義體學'], ['medicine', 'intellect', '醫療'], ['firearms', 'reflex', '槍械'], ['negotiate', 'charm', '交涉']]
  .map(([id, attr, name]) => ({ id: id!, name: name!, attr: attr!, desc: `${id}。` }))
const npc = (id: string, name: string, more: Rec = {}) => ({
  id, name, kind: 'citizen', age: 40, guard: 12, wealth: 1, home: { district: 'd_hive', block: 'b_market' }, haunts: [{ district: 'd_hive', block: 'b_market' }], skills: {}, ...more,
})
const FENG = npc('npc_feng', '縫縫', { tutor: { skills: ['cyberware', 'medicine'], where: '地下室診所' } })
const PRESS = npc('npc_press', '印刷', { tutor: { skills: ['mechanics'] } })
const WALL = npc('npc_wall', '牆語者', { tutor: { skills: ['cyberware'], needs: [{ kind: 'favor', key: 'f_echo', min: 20 }], sink: 1 } })
const NORA = npc('npc_nora', '諾拉', { tutor: { skills: ['medicine'] } })
const FAR = npc('npc_far', '遠方的老師', { home: { district: 'd_far' }, haunts: [{ district: 'd_far' }], tutor: { skills: ['mechanics'] } })
const CROWN = npc('npc_crown', '冠冕的老師', { home: { district: 'd_crown', block: 'b_plaza' }, haunts: [{ district: 'd_crown', block: 'b_plaza' }], tutor: { skills: ['mechanics', 'medicine'] } })
// 既教工藝又是槍械 6 級的人（5、6 級的請教互不干擾）
const JOE = npc('npc_joe', '喬', { skills: { firearms: 6 }, tutor: { skills: ['mechanics'] } })
const GUN = npc('npc_gun', '槍手', { skills: { firearms: 6 } })
const KINDS = [{ id: 'npc_chat', name: '聊天', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 10, max_minutes: 30, owner: 'npcs' }]

const baseContent = (): Rec => structuredClone({
  attribute: ATTRS, skill: SKILLS,
  district: [
    { id: 'd_hive', name: '蜂巢', grade: 1, factions: [] }, { id: 'd_far', name: '遠方', grade: 1, factions: [] },
    { id: 'd_crown', name: '冠冕', grade: 4, factions: [], price_mult: 3 },
  ],
  block: [{ id: 'b_market', district: 'd_hive', name: '市場', facilities: {} }, { id: 'b_plaza', district: 'd_crown', name: '廣場', facilities: {} }],
  faction: [{ id: 'f_echo', name: '回聲帶', short: '回聲', class: 'street' }],
  npc: [FENG, PRESS, WALL, NORA, FAR, CROWN, JOE, GUN],
  action_kind: KINDS,
})

interface Opts {
  skills?: Rec
  xp?: number
  content?: (c: Rec) => void
  packs?: ContentPack[]
  money?: { cred: number; cash: number }
  at?: Rec
  sink?: boolean
}
const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const make = (o: Opts = {}) => {
  const c = baseContent()
  o.content?.(c)
  const features: Feature[] = [STUBS, ...(o.sink === false ? [] : [characterFeature]), actionsFeature, lewdFeature, securityFeature, npcsFeature, abilitiesFeature]
  const { game } = makeGame({
    features, content: [{ id: 'tutor_test', content: c } as unknown as ContentPack, ...(o.packs ?? [])], seed: 7,
    pc: { skills: { mechanics: 0, cyberware: 0, medicine: 0, firearms: 4, ...(o.skills ?? {}) }, ext: { abilities: { xp: o.xp ?? 300, learned: [], equipped: [], spent: {} } } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 5000, cash: 300 } } as never,
  })
  game.commit(draft([{ op: 'location', to: o.at ?? { district: 'd_hive', block: 'b_market' } }], 'test.go'))
  return game
}
type G = ReturnType<typeof make>
const minutes = (g: G) => toMinutes(g.state.time)
const pc = (g: G) => g.state.actors.pc!
const give = (g: G, effects: Rec[]) => {
  const r = g.k.effects.resolve(effects, { state: g.state, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: g.k.content })
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes, 'test.give'))
}
/** 認識他（變成角色）並把親密度設成某個值。 */
const know = (g: G, id: string, affinity = 0) => give(g, [{ kind: 'meet', npc: id }, ...(affinity !== 0 ? [{ kind: 'affinity', key: id, amount: affinity }] : [])])
const setFavor = (g: G, n: number) => void g.commit(draft([{ op: 'meter', kind: 'favor', key: 'f_echo', set: n } as never], 'test.favor'))
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const up = (g: G, npcId: string, skill: string, more: Rec = {}) => g.commit(tutorDraft(g.k, g.state, { npc: npcId, skill, ...more }))
const opt = (g: G, npcId: string, skill: string, who?: string) => tutorOptions(g.k, g.state, { npc: npcId, ...(who ? { who } : {}) }).find((o) => o.skill === skill)

describe('預設與格式', () => {
  it('規則的預設：三項工藝、最高 2 級、1 級 C$300 兩個時段、2 級 C$800 四個時段、240 分鐘、照區物價', () => {
    expect(DEFAULT_ABILITY_RULES.tutor).toEqual({
      skills: ['mechanics', 'cyberware', 'medicine'], max_level: 2, steps: { 1: { price: 300, slots: 2 }, 2: { price: 800, slots: 4 } }, slot_minutes: 240, district_price: true,
    })
    const k = make().k
    expect(abilityRules(k).tutor).toEqual(DEFAULT_ABILITY_RULES.tutor)
    expect(tutorMax(k)).toBe(2)
  })

  it('資料可以蓋掉規則（steps 逐級逐欄蓋）；格式不對載入時擋下', () => {
    const rule = (tutor: Rec): ContentPack => ({ id: 'rule', content: { ability_rule: [{ id: 'default', tutor }] } } as unknown as ContentPack)
    const k = make({ packs: [rule({ steps: { 1: { price: 50 } }, slot_minutes: 60, district_price: false })] }).k
    expect(abilityRules(k).tutor).toMatchObject({ steps: { 1: { price: 50, slots: 2 }, 2: { price: 800, slots: 4 } }, slot_minutes: 60, district_price: false })
    for (const bad of [{ max_level: 0 }, { max_level: 6 }, { slot_minutes: 0 }, { district_price: 1 }, { skills: [1] }, { xx: 1 }, { steps: { 1: { price: -1 } } }, { steps: { 1: { slots: 0 } } }, { steps: { 9: { price: 1, slots: 1 } } }, { max_level: 3 }, 5]) {
      expect(() => make({ packs: [rule(bad as never)] }), JSON.stringify(bad)).toThrow(/tutor/)
    }
    // max_level 到 3 要寫第 3 級的一列
    expect(() => make({ packs: [rule({ max_level: 3, steps: { 3: { price: 1500, slots: 6 } } })] })).not.toThrow()
  })

  it('npc 的 tutor 欄格式不對載入時擋下，每一條寫出是哪一個人', () => {
    const bad = (tutor: unknown, re: RegExp) => expect(() => make({ content: (c) => { c.npc[0].tutor = tutor } })).toThrow(re)
    bad({ skills: [] }, /npc_feng：tutor\.skills/)
    bad({ skills: ['nope'] }, /tutor\.skills\[0\].*nope/)
    bad({ skills: ['firearms'] }, /firearms 不在規則 tutor\.skills/)
    bad({ skills: ['medicine', 'medicine'] }, /重複/)
    bad({ skills: ['medicine'], sink: -1 }, /tutor\.sink/)
    bad({ skills: ['medicine'], where: '' }, /tutor\.where/)
    bad({ skills: ['medicine'], needs: [{ kind: 'no_such' }] }, /needs\[0\]/)
    bad({ skills: ['medicine'], xx: 1 }, /tutor\.xx/)
    bad('x', /tutor/)
  })
})

describe('學工藝：0 → 1 → 2', () => {
  it('義體學 0 級：列出義體學與醫療（C$300、2 個時段）；第一個時段扣 300、+240 分鐘、還是 0 級；第二個時段不再扣、升到 1、歷練點不動；1 → 2 扣 800、四個時段後是 2', () => {
    const g = make()
    expect(tutorOptions(g.k, g.state, { npc: 'npc_feng' }).map((o) => [o.skill, o.name, o.level, o.max, o.price, o.need, o.done, o.ok])).toEqual([
      ['cyberware', '義體學', 1, 2, 300, 2, 0, true], ['medicine', '醫療', 1, 2, 300, 2, 0, true],
    ])
    expect(opt(g, 'npc_feng', 'cyberware')).toMatchObject({ npcName: '縫縫', where: '地下室診所', minutes: 240, sink: 0, reason: null, note: null })

    const before = minutes(g)
    const cred = g.state.money.cred
    const xp = abilitiesOf(g.state, 'pc').xp
    const r1 = tutorDraft(g.k, g.state, { npc: 'npc_feng', skill: 'cyberware' })
    expect(r1.action).toBe(TUTOR_ACTION)
    expect(r1.outcome.result).toBe('lesson')
    g.commit(r1)
    expect(minutes(g) - before).toBe(240)
    expect(g.state.money.cred).toBe(cred - 300)
    expect(pc(g).skills.cyberware).toBe(0)
    expect(abilitiesOf(g.state, 'pc').lessons).toEqual({ cyberware: { level: 1, done: 1, need: 2, from: { tutor: 'npc_feng' } } })
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_feng: 'cyberware' })
    expect(opt(g, 'npc_feng', 'cyberware')).toMatchObject({ done: 1, need: 2, price: 0 })

    const r2 = tutorDraft(g.k, g.state, { npc: 'npc_feng', skill: 'cyberware' })
    expect(r2.outcome.result).toBe('complete')
    g.commit(r2)
    expect(minutes(g) - before).toBe(480)
    expect(g.state.money.cred).toBe(cred - 300)
    expect(pc(g).skills.cyberware).toBe(1)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(xp)
    expect(abilitiesOf(g.state, 'pc').spent).toEqual({})
    expect(abilitiesOf(g.state, 'pc').lessons).toBeUndefined()
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_feng: 'cyberware' })

    // 1 → 2：各付各的
    expect(opt(g, 'npc_feng', 'cyberware')).toMatchObject({ level: 2, price: 800, need: 4, done: 0, ok: true })
    for (let i = 0; i < 4; i++) {
      expect(pc(g).skills.cyberware).toBe(1)
      up(g, 'npc_feng', 'cyberware')
      expect(g.state.money.cred).toBe(cred - 300 - 800)
    }
    expect(pc(g).skills.cyberware).toBe(2)
    expect(minutes(g) - before).toBe(480 + 4 * 240)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(xp)

    // 2 級之後這條路關了：列表沒有這一項（只剩被鎖住的醫療），直接問回那一句
    expect(tutorOptions(g.k, g.state, { npc: 'npc_feng' }).map((o) => [o.skill, o.ok])).toEqual([['medicine', false]])
    expect(tutorBlock(g.k, g.state, { npc: 'npc_feng', skill: 'cyberware' })).toBe('已經 2 級以上，這條路走不了；再上去要自己花歷練點練。')
    expect(reasonOf(() => tutorDraft(g.k, g.state, { npc: 'npc_feng', skill: 'cyberware' }))).toMatch(/^已經 2 級以上/)
    // 花歷練點升 3 級的路不受影響（不需要課）
    g.commit(skillUpDraft(g.k, g.state, 'pc', 'cyberware'))
    expect(pc(g).skills.cyberware).toBe(3)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(xp - 30)
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_feng: 'cyberware' })
  })

  it('學費可以指定從現金付；現金不夠被擋；帳戶、現金都不夠的原因寫兩邊', () => {
    const g = make({ money: { cred: 100, cash: 300 } })
    expect(tutorBlock(g.k, g.state, { npc: 'npc_press', skill: 'mechanics', pay: 'cred' })).toBe('錢不夠：學費要 C$300，帳戶付不起。')
    g.commit(tutorDraft(g.k, g.state, { npc: 'npc_press', skill: 'mechanics', pay: 'cash' }))
    expect(g.state.money).toMatchObject({ cred: 100, cash: 0 })
    const poor = make({ money: { cred: 100, cash: 100 } })
    expect(opt(poor, 'npc_press', 'mechanics')).toMatchObject({ ok: false, reason: '錢不夠：學費要 C$300，帳戶與現金付不起。', price: 300 })
    expect(reasonOf(() => tutorDraft(poor.k, poor.state, { npc: 'npc_press', skill: 'mechanics' }))).toMatch(/錢不夠/)
    expect(poor.state.money).toMatchObject({ cred: 100, cash: 100 })
  })

  it('1 級的人只列 1 → 2：C$800、四個時段', () => {
    const g = make({ skills: { medicine: 1 } })
    expect(opt(g, 'npc_nora', 'medicine')).toMatchObject({ level: 2, price: 800, need: 4 })
  })
})

describe('一位老師對一個人只教一項', () => {
  it('縫縫教了義體學，再學醫療被擋（只帶一個人一項）；換諾拉教醫療可以；縫縫還是能繼續教義體學', () => {
    const g = make()
    up(g, 'npc_feng', 'cyberware')
    expect(opt(g, 'npc_feng', 'medicine')).toMatchObject({ ok: false, reason: '縫縫只帶一個人一項。' })
    expect(opt(g, 'npc_feng', 'cyberware')).toMatchObject({ ok: true })
    expect(reasonOf(() => tutorDraft(g.k, g.state, { npc: 'npc_feng', skill: 'medicine' }))).toBe('縫縫只帶一個人一項。')
    const cred = g.state.money.cred
    up(g, 'npc_nora', 'medicine')
    expect(g.state.money.cred).toBe(cred - 300)
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_feng: 'cyberware', npc_nora: 'medicine' })
  })

  it('第一次選了就定了：縫縫教醫療升到 2 級之後，義體學還是不教', () => {
    const g = make()
    for (let i = 0; i < 2; i++) up(g, 'npc_feng', 'medicine')
    for (let i = 0; i < 4; i++) up(g, 'npc_feng', 'medicine')
    expect(pc(g).skills.medicine).toBe(2)
    expect(tutorBlock(g.k, g.state, { npc: 'npc_feng', skill: 'cyberware' })).toBe('縫縫只帶一個人一項。')
    expect(tutorOptions(g.k, g.state, { npc: 'npc_feng' }).map((o) => o.skill)).toEqual(['cyberware'])
  })

  it('名冊上的人照同一條：他的基本功、他自己的老師鎖，學費照主角的錢付', () => {
    const g = make()
    g.commit(draft([{ op: 'actor.add', actor: makeActor({ id: 'rn', name: '阿隊', role: 'companion', skills: { medicine: 0 }, ext: {} }) } as never, { op: 'party', id: 'rn' } as never], 'test.party'))
    expect(opt(g, 'npc_feng', 'medicine', 'rn')).toMatchObject({ ok: true, level: 1 })
    const cred = g.state.money.cred
    up(g, 'npc_feng', 'medicine', { who: 'rn' })
    up(g, 'npc_feng', 'medicine', { who: 'rn' })
    expect(g.state.actors.rn!.skills.medicine).toBe(1)
    expect(pc(g).skills.medicine).toBe(0)
    expect(g.state.money.cred).toBe(cred - 300)
    expect(abilitiesOf(g.state, 'rn').tutored).toEqual({ npc_feng: 'medicine' })
    // 主角自己的紀錄與鎖不受影響
    expect(abilitiesOf(g.state, 'pc').tutored).toBeUndefined()
    expect(opt(g, 'npc_feng', 'cyberware')).toMatchObject({ ok: true })
    expect(opt(g, 'npc_feng', 'cyberware', 'rn')).toMatchObject({ ok: false, reason: '縫縫只帶一個人一項。' })
    // 不在隊上的人不行
    g.commit(draft([{ op: 'party', id: 'rn', remove: true } as never], 'test.party2'))
    expect(tutorBlock(g.k, g.state, { npc: 'npc_feng', skill: 'medicine', who: 'rn' })).toBe('阿隊不在隊上。')
  })
})

describe('已經夠高的人', () => {
  it('一開始就 2 級、3 級的人整個不列這一項；can_tutor 也不成立', () => {
    for (const lv of [2, 3]) {
      const g = make({ skills: { cyberware: lv } })
      expect(tutorOptions(g.k, g.state, { npc: 'npc_wall' })).toEqual([])
      expect(tutorOptions(g.k, g.state, { npc: 'npc_feng' }).map((o) => o.skill)).toEqual(['medicine'])
      expect(g.k.conditions.test({ kind: 'can_tutor', npc: 'npc_wall' }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(false)
      expect(g.k.conditions.test({ kind: 'can_tutor', npc: 'npc_feng', skill: 'cyberware' }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(false)
      expect(g.k.conditions.test({ kind: 'can_tutor', npc: 'npc_feng', skill: 'medicine' }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(true)
      expect(tutorBlock(g.k, g.state, { npc: 'npc_wall', skill: 'cyberware' })).toMatch(/已經 2 級以上/)
    }
  })

  it('沒有 tutor 的人、老師不教的那一項、不是工藝的基本功都不列、也被擋', () => {
    const g = make()
    expect(tutorOptions(g.k, g.state, { npc: 'npc_gun' })).toEqual([])
    expect(tutorBlock(g.k, g.state, { npc: 'npc_gun', skill: 'mechanics' })).toBe('這個人不教工藝。')
    expect(tutorBlock(g.k, g.state, { npc: 'npc_press', skill: 'medicine' })).toBe('印刷不教醫療。')
    expect(tutorBlock(g.k, g.state, { npc: 'npc_joe', skill: 'firearms' })).toMatch(/槍械不能向人學/)
    expect(tutorBlock(g.k, g.state, { npc: 'npc_nobody', skill: 'mechanics' })).toBe('這個人不教工藝。')
    expect(g.k.conditions.test({ kind: 'can_tutor', npc: 'npc_gun' }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(false)
  })
})

describe('區物價', () => {
  it('倍率 3 的冠冕：0 → 1 學費 900（四捨五入）；1 → 2 是 2,400；錢不夠被擋、一毛不扣', () => {
    const g = make({ at: { district: 'd_crown', block: 'b_plaza' } })
    expect(opt(g, 'npc_crown', 'mechanics')).toMatchObject({ price: 900, need: 2 })
    const cred = g.state.money.cred
    up(g, 'npc_crown', 'mechanics')
    expect(g.state.money.cred).toBe(cred - 900)
    up(g, 'npc_crown', 'mechanics')
    expect(g.state.money.cred).toBe(cred - 900)
    expect(opt(g, 'npc_crown', 'mechanics')).toMatchObject({ level: 2, price: 2400, need: 4 })

    const poor = make({ at: { district: 'd_crown', block: 'b_plaza' }, money: { cred: 600, cash: 200 } })
    expect(opt(poor, 'npc_crown', 'mechanics')).toMatchObject({ ok: false, price: 900, reason: '錢不夠：學費要 C$900，帳戶與現金付不起。' })
    expect(reasonOf(() => tutorDraft(poor.k, poor.state, { npc: 'npc_crown', skill: 'mechanics' }))).toMatch(/錢不夠/)
    expect(poor.state.money).toMatchObject({ cred: 600, cash: 200 })
    expect(minutes(poor)).toBe(minutes(make()))
  })

  it('district_price 關掉就不乘；倍率不是整數時四捨五入', () => {
    const rule: ContentPack = { id: 'rule', content: { ability_rule: [{ id: 'default', tutor: { district_price: false } }] } } as unknown as ContentPack
    const g = make({ at: { district: 'd_crown', block: 'b_plaza' }, packs: [rule] })
    expect(opt(g, 'npc_crown', 'mechanics')).toMatchObject({ price: 300 })
    const odd = make({ at: { district: 'd_crown', block: 'b_plaza' }, content: (c) => { c.district[2].price_mult = 1.55 } })
    expect(opt(odd, 'npc_crown', 'mechanics')).toMatchObject({ price: 465 })
    const odd2 = make({ at: { district: 'd_crown', block: 'b_plaza' }, content: (c) => { c.district[2].price_mult = 1.115 } })
    expect(opt(odd2, 'npc_crown', 'mechanics')).toMatchObject({ price: 335 })
  })
})

describe('老師的條件與每堂的沉溺', () => {
  it('牆語者要回聲的好感 20：19 被擋並是條件的那一句；20 可以；每上一個時段沉溺 +1（上完 0 → 1 是 +2）', () => {
    const g = make()
    const sink0 = pc(g).sink
    setFavor(g, 19)
    expect(opt(g, 'npc_wall', 'cyberware')).toMatchObject({ ok: false, sink: 1, reason: '牆語者的課：回聲的好感要在 20 以上才能上。' })
    expect(reasonOf(() => tutorDraft(g.k, g.state, { npc: 'npc_wall', skill: 'cyberware' }))).toBe('牆語者的課：回聲的好感要在 20 以上才能上。')
    expect(pc(g).sink).toBe(sink0)
    expect(g.state.money.cred).toBe(5000)

    setFavor(g, 20)
    expect(opt(g, 'npc_wall', 'cyberware')).toMatchObject({ ok: true })
    const r1 = tutorDraft(g.k, g.state, { npc: 'npc_wall', skill: 'cyberware' })
    g.commit(r1)
    expect(pc(g).sink).toBe(sink0 + 1)
    up(g, 'npc_wall', 'cyberware')
    expect(pc(g).sink).toBe(sink0 + 2)
    expect(pc(g).skills.cyberware).toBe(1)
    // 沉溺的那一筆是報告裡的變更（回退才收得回來）
    expect(r1.changes.some((c) => c.op === 'actor.track' && (c as Rec).track === 'sink' && (c as Rec).delta === 1)).toBe(true)
  })

  it('沒有 sink 的老師不加沉溺；沒裝 sink 效果（沒有 characterFeature）時略過、課照上', () => {
    const g = make()
    const sink0 = pc(g).sink
    up(g, 'npc_feng', 'cyberware')
    expect(pc(g).sink).toBe(sink0)
    const bare = make({ sink: false })
    setFavor(bare, 20)
    expect(bare.k.effects.has('sink')).toBe(false)
    up(bare, 'npc_wall', 'cyberware')
    up(bare, 'npc_wall', 'cyberware')
    expect(pc(bare).skills.cyberware).toBe(1)
  })
})

describe('在場、換老師、作廢', () => {
  it('老師不在場被擋並有原因；不扣錢不花時間', () => {
    const g = make()
    const t = minutes(g)
    expect(opt(g, 'npc_far', 'mechanics')).toMatchObject({ ok: false, reason: '遠方的老師不在這裡：要在他現在所在的地方才能上課。' })
    expect(reasonOf(() => tutorDraft(g.k, g.state, { npc: 'npc_far', skill: 'mechanics' }))).toMatch(/不在這裡/)
    expect(minutes(g)).toBe(t)
    expect(g.state.money.cred).toBe(5000)
    expect(abilitiesOf(g.state, 'pc').tutored).toBeUndefined()
  })

  it('上到一半換老師：進度從頭、錢不退（新老師再收一次學費）；前一位老師的鎖還在', () => {
    const g = make()
    up(g, 'npc_feng', 'medicine')
    expect(g.state.money.cred).toBe(4700)
    expect(opt(g, 'npc_nora', 'medicine')).toMatchObject({ done: 0, price: 300 })
    up(g, 'npc_nora', 'medicine')
    expect(g.state.money.cred).toBe(4400)
    expect(abilitiesOf(g.state, 'pc').lessons).toEqual({ medicine: { level: 1, done: 1, need: 2, from: { tutor: 'npc_nora' } } })
    expect(pc(g).skills.medicine).toBe(0)
    // 回頭找縫縫也是從頭
    expect(opt(g, 'npc_feng', 'medicine')).toMatchObject({ done: 0, price: 300, ok: true })
    up(g, 'npc_feng', 'medicine')
    up(g, 'npc_feng', 'medicine')
    expect(g.state.money.cred).toBe(4100)
    expect(pc(g).skills.medicine).toBe(1)
    // 兩位老師都教過醫療，各自鎖在醫療上
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_feng: 'medicine', npc_nora: 'medicine' })
  })

  it('上到一半那一項已經因為別的原因升到這一級（花歷練點升了）：這一段作廢、回一句說明，下一級重來', () => {
    const g = make()
    up(g, 'npc_feng', 'medicine')
    // 別的原因升了一級（不經過 skillUpDraft，所以課沒有被清掉）
    g.commit(draft([{ op: 'actor.skill', id: 'pc', skill: 'medicine', delta: 1 } as never], 'test.skill'))
    expect(pc(g).skills.medicine).toBe(1)
    // 課還記著，但已經作廢
    expect(abilitiesOf(g.state, 'pc').lessons?.medicine?.level).toBe(1)
    const o = opt(g, 'npc_feng', 'medicine')!
    expect(o).toMatchObject({ level: 2, done: 0, need: 4, price: 800, ok: true })
    expect(o.note).toBe('醫療已經是 1 級了，先前上到一半的課作廢，從下一級重新上起。')
    const r = tutorDraft(g.k, g.state, { npc: 'npc_feng', skill: 'medicine' })
    expect(r.outcome.summary).toContain('作廢')
    g.commit(r)
    expect(abilitiesOf(g.state, 'pc').lessons).toEqual({ medicine: { level: 2, done: 1, need: 4, from: { tutor: 'npc_feng' } } })
    expect(opt(g, 'npc_feng', 'medicine')!.note).toBeNull()
  })
})

describe('規則改了數字', () => {
  const rule = (tutor: Rec, ability: Rec = {}): ContentPack => ({ id: 'rule', content: { ability_rule: [{ id: 'default', tutor, ...ability }] } } as unknown as ContentPack)

  it('tutor.max_level 改成 4：規則的數字照寫，但不會超過 skill_free_max', () => {
    const steps = { 3: { price: 1500, slots: 6 }, 4: { price: 3000, slots: 8 } }
    const high = make({ packs: [rule({ max_level: 4, steps })], skills: { mechanics: 2 } })
    expect(tutorMax(high.k)).toBe(4)
    expect(opt(high, 'npc_press', 'mechanics')).toMatchObject({ level: 3, max: 4, price: 1500, need: 6 })
    // skill_free_max 3：最多只教到 3
    const capped = make({ packs: [rule({ max_level: 4, steps }, { skill_free_max: 3 })], skills: { mechanics: 3 } })
    expect(tutorMax(capped.k)).toBe(3)
    expect(tutorOptions(capped.k, capped.state, { npc: 'npc_press' })).toEqual([])
    expect(tutorBlock(capped.k, capped.state, { npc: 'npc_press', skill: 'mechanics' })).toBe('已經 3 級以上，這條路走不了；再上去要自己花歷練點練。')
    // skill_free_max 1：1 級的人不能再用這條路
    const one = make({ packs: [rule({}, { skill_free_max: 1 })], skills: { mechanics: 1 } })
    expect(tutorOptions(one.k, one.state, { npc: 'npc_press' })).toEqual([])
    expect(tutorOptions(make({ packs: [rule({}, { skill_free_max: 1 })] }).k, make({ packs: [rule({}, { skill_free_max: 1 })] }).state, { npc: 'npc_press' })).toHaveLength(1)
  })

  it('tutor.skills 縮成一項時，老師資料裡寫的別項載入時擋下', () => {
    expect(() => make({ packs: [rule({ skills: ['mechanics'] })] })).toThrow(/不在規則 tutor\.skills/)
  })
})

describe('和 5、6 級的請教互不干擾', () => {
  it('同一個人既是槍械 6 級又教機械：兩邊的課各記各的（lessons 不同的鍵）；請教那一段不受影響', () => {
    const g = make({ skills: { firearms: 4 } })
    know(g, 'npc_joe', 45)
    up(g, 'npc_joe', 'mechanics')
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_joe' }, pay: 'affinity' }))
    expect(abilitiesOf(g.state, 'pc').lessons).toEqual({
      mechanics: { level: 1, done: 1, need: 2, from: { tutor: 'npc_joe' } },
      firearms: { level: 5, done: 1, need: 2, from: { npc: 'npc_joe' }, pay: 'affinity' },
    })
    expect(teachOptions(g.k, g.state, { npc: 'npc_joe' })[0]).toMatchObject({ skill: 'firearms', done: 1 })
    expect(tutorOptions(g.k, g.state, { npc: 'npc_joe' }).map((o) => [o.skill, o.done])).toEqual([['mechanics', 1]])
    up(g, 'npc_joe', 'mechanics')
    expect(pc(g).skills.mechanics).toBe(1)
    // 工藝那一項升完課拿掉，槍械的課還在
    expect(abilitiesOf(g.state, 'pc').lessons).toEqual({ firearms: { level: 5, done: 1, need: 2, from: { npc: 'npc_joe' }, pay: 'affinity' } })
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_joe: 'mechanics' })
    // 洗點、升級這些動手腳把 tutored 洗掉的事不會發生
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_joe' }, pay: 'affinity' }))
    g.commit(skillUpDraft(g.k, g.state, 'pc', 'firearms'))
    expect(abilitiesOf(g.state, 'pc').tutored).toEqual({ npc_joe: 'mechanics' })
  })
})

describe('NPC 的互動選單：請教', () => {
  const row = (g: G, id: string) => interactions(g.k, g.state, id).find((v) => v.kind === CONSULT_KIND)

  it('只帶 tutor 的人也列出「請教」，交接記號多一個 also；沒有 tutor、也沒有 5、6 級可教的人沒有', () => {
    const g = make()
    expect(row(g, 'npc_feng')).toMatchObject({ kind: 'npc_consult', name: '請教', ok: true, reason: null, handoff: { to: 'abilities.teachOptions', npc: 'npc_feng', also: ['abilities.tutorOptions'] } })
    expect(interactions(g.k, g.state, 'npc_feng').map((v) => v.kind)).toEqual(['npc_chat', 'npc_consult'])
    // 條件不成立、錢不夠不影響有沒有這一項（原因寫在 tutorOptions）
    expect(row(g, 'npc_wall')).toBeDefined()
    expect(row(g, 'npc_nora')).toBeDefined()
  })

  it('只有 can_teach 的人照舊（沒有 also）；兩邊都成立的人一項、也帶 also', () => {
    const g = make()
    know(g, 'npc_gun', 45)
    know(g, 'npc_joe', 45)
    expect(row(g, 'npc_gun')?.handoff).toEqual({ to: 'abilities.teachOptions', npc: 'npc_gun' })
    const joe = row(g, 'npc_joe')!
    expect(joe.handoff).toEqual({ to: 'abilities.teachOptions', npc: 'npc_joe', also: ['abilities.tutorOptions'] })
    expect(interactions(g.k, g.state, 'npc_joe').filter((v) => v.kind === CONSULT_KIND)).toHaveLength(1)
  })

  it('主角三項工藝都 2 級以上時，只教工藝的人沒有別的可教就不列；還有一項沒到頂就列', () => {
    const done = make({ skills: { mechanics: 2, cyberware: 2, medicine: 2 } })
    expect(row(done, 'npc_feng')).toBeUndefined()
    expect(row(done, 'npc_press')).toBeUndefined()
    expect(interactions(done.k, done.state, 'npc_feng').map((v) => v.kind)).toEqual(['npc_chat'])
    const part = make({ skills: { mechanics: 2, cyberware: 2 } })
    expect(row(part, 'npc_feng')).toBeDefined()
    expect(row(part, 'npc_press')).toBeUndefined()
  })

  it('人不在這裡時那一項灰掉並寫原因；沒裝 abilities 時沒有這一項', () => {
    const g = make()
    expect(row(g, 'npc_far')).toMatchObject({ ok: false, reason: '他不在這裡：要在同一個地方才做得到。' })
    const { game } = makeGame({
      features: [STUBS, actionsFeature, lewdFeature, securityFeature, npcsFeature], content: [{ id: 'p', content: baseContent() } as unknown as ContentPack], seed: 7,
      patch: { time: { day: 3, hour: 10, minute: 0 } } as never,
    })
    game.commit(draft([{ op: 'location', to: { district: 'd_hive', block: 'b_market' } }], 'test.go'))
    expect(interactions(game.k, game.state, 'npc_feng').map((v) => v.kind)).toEqual(['npc_chat'])
  })
})
