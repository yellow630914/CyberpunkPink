// 驗收測試：dev/work/M4-training.md（cpp-feature）。基本功 5、6 級的請教（向人請教）與上課（去機構）。
// 規格：CORE_RULES 7.2 節「基本功的規則」、7.5 節（那張十八列的表只當例子，是內容）；NPC_SYSTEM 6.1 節的「請教」。
// 內容一律是測試自帶的最小假資料：兩項基本功（槍械、格鬥）、一個槍械 6 級親密度 45 的 NPC（喬）、一個槍械 5 級親密度 10 的（蘭）、
// 一個槍械 6 級親密度 0 而且立了旗標的（山姆）、一個槍械只有 3 級的（路人）、一個在別的街區的（遠方），一處教槍械的設施種類（靶場）。
// 別的功能的內容種類（區、街區、設施種類）與條件 at_facility 用測試臨時註冊的替身。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, meterOf, toMinutes } from '../../src'
import {
  DEFAULT_ABILITY_RULES, FACILITY_MAX, NEEDS_TEACHER, abilitiesFeature, abilitiesOf, abilityRules, lessonBlock, lessonDraft, skillUpBlock, skillUpDraft, taughtFlag, teachOptions, teachableSkills,
} from '../../src/features/abilities'
import { actionsFeature } from '../../src/features/actions'
import { lewdFeature } from '../../src/features/lewd'
import { CONSULT_KIND, interactions, npcsFeature } from '../../src/features/npcs'
import { securityFeature } from '../../src/features/security'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, any>

const STUBS: Feature = {
  id: 'test_stubs',
  install(k: Kernel) {
    for (const kind of ['district', 'block', 'facility_type']) k.content.defineKind({ kind, owner: 'test', validate: () => [] })
    // 站在哪一處設施：旗標 fac 是設施種類的 id
    k.conditions.register<{ kind: string; types?: string[] }>({
      kind: 'at_facility', owner: 'test_stubs', validate: () => [],
      test: (c, { state }) => (typeof state.flags.fac === 'string' ? (c.types ? c.types.includes(state.flags.fac) : true) : false),
    })
    k.conditions.register<{ kind: string; key: string }>({ kind: 'flag_on', owner: 'test_stubs', validate: () => [], test: (c, { state }) => state.flags[c.key] === true })
  },
}

const ATTRS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].map((id) => ({ id, name: id, desc: `${id}。` }))
const SKILLS = [['firearms', 'reflex'], ['brawl', 'body'], ['negotiate', 'charm']].map(([id, attr]) => ({ id: id!, name: id === 'firearms' ? '槍械' : id!, attr: attr!, desc: `${id}。` }))
const npc = (id: string, name: string, skills: Rec, more: Rec = {}) => ({
  id, name, kind: 'citizen', age: 40, guard: 12, wealth: 1, home: { district: 'd_hive', block: 'b_market' }, haunts: [{ district: 'd_hive', block: 'b_market' }], skills, ...more,
})
const JOE = npc('npc_joe', '喬', { firearms: 6, brawl: 2 })
const LAN = npc('npc_lan', '蘭', { firearms: 5 })
const SAM = npc('npc_sam', '山姆', { firearms: 6 })
const NOBODY = npc('npc_nobody', '路人', { firearms: 3 })
const FAR = npc('npc_far', '遠方的人', { firearms: 6 }, { home: { district: 'd_far' }, haunts: [{ district: 'd_far' }] })
const KINDS = [{ id: 'npc_chat', name: '聊天', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 10, max_minutes: 30, owner: 'npcs' }]

const baseContent = (): Rec => structuredClone({
  attribute: ATTRS, skill: SKILLS,
  district: [{ id: 'd_hive', name: '蜂巢', grade: 1, factions: [] }, { id: 'd_far', name: '遠方', grade: 1, factions: [] }],
  block: [{ id: 'b_market', district: 'd_hive', name: '市場', facilities: {} }],
  npc: [JOE, LAN, SAM, NOBODY, FAR],
  action_kind: KINDS,
  facility_type: [
    { id: 'ft_range', name: '東側靶場', teach: [{ skill: 'firearms', price: 1500, slots: 3 }, { skill: 'brawl', price: 800, slots: 2, needs: [{ kind: 'flag_on', key: 'member' }] }] },
    { id: 'ft_bar', name: '酒吧' },
  ],
})

interface Opts {
  skills?: Rec
  xp?: number
  content?: (c: Rec) => void
  packs?: ContentPack[]
  money?: { cred: number; cash: number }
}
const ALL: Feature[] = [STUBS, actionsFeature, lewdFeature, securityFeature, npcsFeature, abilitiesFeature]
const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const make = (o: Opts = {}) => {
  const c = baseContent()
  o.content?.(c)
  const { game } = makeGame({
    features: ALL, content: [{ id: 'train_test', content: c } as unknown as ContentPack, ...(o.packs ?? [])], seed: 7,
    pc: { skills: { firearms: 4, brawl: 3, ...(o.skills ?? {}) }, ext: { abilities: { xp: o.xp ?? 300, learned: [], equipped: [], spent: {} } } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 5000, cash: 300 } } as never,
  })
  game.commit(draft([{ op: 'location', to: { district: 'd_hive', block: 'b_market' } }], 'test.go'))
  return game
}
type G = ReturnType<typeof make>
const give = (g: G, effects: Rec[]) => {
  const r = g.k.effects.resolve(effects, { state: g.state, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: g.k.content })
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes, 'test.give'))
}
/** 認識他（變成角色）並把親密度設成某個值。 */
const know = (g: G, id: string, affinity = 0) => give(g, [{ kind: 'meet', npc: id }, ...(affinity !== 0 ? [{ kind: 'affinity', key: id, amount: affinity }] : [])])
const flag = (g: G, key: string, value: unknown = true) => g.commit(draft([{ op: 'flag', key, value } as never], 'test.flag'))
const pc = (g: G) => g.state.actors.pc!
const minutes = (g: G) => toMinutes(g.state.time)
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const lesson = (g: G, from: Rec, pay?: 'affinity' | 'tuition' | 'favor', more: Rec = {}) => g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from, ...(pay ? { pay } : {}), ...more } as never))
const joe = { npc: 'npc_joe' }
const range = { facility: 'ft_range' }

describe('預設與格式', () => {
  it('規則的預設：親密度 40、學費 5 級 1,500 與 6 級 5,000、每級兩個時段、一個時段 240 分鐘', () => {
    expect(DEFAULT_ABILITY_RULES.teach).toEqual({ affinity: 40, tuition: { 5: 1500, 6: 5000 }, slots_per_level: 2, slot_minutes: 240 })
    expect(abilityRules(make().k).teach).toEqual(DEFAULT_ABILITY_RULES.teach)
    expect(FACILITY_MAX).toBe(5)
  })

  it('資料可以蓋掉規則；格式不對載入時擋下', () => {
    const rule = (teach: Rec): ContentPack => ({ id: 'rule', content: { ability_rule: [{ id: 'default', teach }] } } as unknown as ContentPack)
    const k = make({ packs: [rule({ affinity: 20, tuition: { 5: 100 }, slots_per_level: 1, slot_minutes: 60 })] }).k
    expect(abilityRules(k).teach).toEqual({ affinity: 20, tuition: { 5: 100, 6: 5000 }, slots_per_level: 1, slot_minutes: 60 })
    for (const bad of [{ affinity: 400 }, { tuition: { 9: 1 } }, { tuition: { 5: -1 } }, { slots_per_level: 0 }, { slot_minutes: 1.5 }, { xx: 1 }]) {
      expect(() => make({ packs: [rule(bad)] })).toThrow(/teach/)
    }
  })

  it('設施種類的 teach 欄格式不對載入時擋下，每一條寫出是哪一筆', () => {
    const bad = (teach: unknown, re: RegExp) => expect(() => make({ content: (c) => { c.facility_type[1].teach = teach } })).toThrow(re)
    bad([], /ft_bar：teach/)
    bad([{ skill: 'nope', price: 1, slots: 1 }], /ft_bar：teach\[0\]\.skill/)
    bad([{ skill: 'firearms', price: -1, slots: 1 }], /price/)
    bad([{ skill: 'firearms', price: 1, slots: 0 }], /slots/)
    bad([{ skill: 'firearms', price: 1, slots: 1, needs: [{ kind: 'no_such' }] }], /needs\[0\]/)
    bad([{ skill: 'firearms', price: 1, slots: 1 }, { skill: 'firearms', price: 2, slots: 1 }], /寫了兩次/)
  })
})

describe('向人請教：親密度', () => {
  it('槍械 4 向 6 級、親密度 45 的喬請教：不收錢；一個時段 +240 分鐘、還不能升；上完兩個之後花 50 歷練點升到 5；再上兩個升 6', () => {
    const g = make()
    know(g, 'npc_joe', 45)
    expect(meterOf(g.k, g.state, 'affinity', 'npc_joe')).toBe(45)
    const [opt] = teachOptions(g.k, g.state, { npc: 'npc_joe' })
    expect(opt).toMatchObject({ skill: 'firearms', name: '槍械', level: 5, max: 6, need: 2, done: 0, minutes: 240, xp: 50, ok: true, reason: null })
    expect(opt!.pays.map((p) => [p.pay, p.price, p.ok])).toEqual([['affinity', 0, true], ['favor', 0, false], ['tuition', 1500, true]])

    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe(NEEDS_TEACHER)
    const before = minutes(g)
    const cred = g.state.money.cred
    const r1 = lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, pay: 'affinity' })
    expect(r1.action).toBe('ability.lesson')
    expect(r1.outcome.result).toBe('lesson')
    g.commit(r1)
    expect(minutes(g) - before).toBe(240)
    expect(g.state.money.cred).toBe(cred)
    expect(abilitiesOf(g.state, 'pc').lessons).toEqual({ firearms: { level: 5, done: 1, need: 2, from: { npc: 'npc_joe' }, pay: 'affinity' } })
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe(NEEDS_TEACHER)

    const r2 = lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, pay: 'affinity' })
    expect(r2.outcome.result).toBe('complete')
    g.commit(r2)
    expect(minutes(g) - before).toBe(480)
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBeNull()
    expect(reasonOf(() => lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, pay: 'affinity' }))).toMatch(/已經上完了/)

    g.commit(skillUpDraft(g.k, g.state, 'pc', 'firearms'))
    expect(pc(g).skills.firearms).toBe(5)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(250)
    expect(abilitiesOf(g.state, 'pc').lessons).toBeUndefined()
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe(NEEDS_TEACHER)

    // 再上兩個可以升 6（歷練點 60）
    expect(teachOptions(g.k, g.state, { npc: 'npc_joe' })[0]).toMatchObject({ level: 6, max: 6, xp: 60 })
    lesson(g, joe, 'affinity')
    lesson(g, joe, 'affinity')
    g.commit(skillUpDraft(g.k, g.state, 'pc', 'firearms'))
    expect(pc(g).skills.firearms).toBe(6)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(190)
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe('槍械已經練到最高的 6 級了。')
    // 6 級了，沒有東西可以請教
    expect(teachOptions(g.k, g.state, { npc: 'npc_joe' })).toEqual([])
  })

  it('沒有上完的課，skillUpDraft 照舊被擋；歷練點照 7.2 節另外花（不夠就不給升）', () => {
    const g = make({ xp: 40 })
    know(g, 'npc_joe', 45)
    lesson(g, joe, 'affinity')
    lesson(g, joe, 'affinity')
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe('歷練點不夠（槍械升到 5 級要 50 點，現在 40 點）。')
    expect(skillUpBlock(g.k, g.state, 'pc', 'brawl')).toBeNull()
  })
})

describe('向人請教：學費與旗標', () => {
  it('親密度 10 的蘭（5 級）：靠親密度被擋並有原因；付 1,500 可以，第一個時段扣、第二個不再扣', () => {
    const g = make()
    know(g, 'npc_lan', 10)
    const opt = teachOptions(g.k, g.state, { npc: 'npc_lan' })[0]!
    expect(opt).toMatchObject({ level: 5, max: 5, ok: true })
    expect(opt.pays.find((p) => p.pay === 'affinity')).toMatchObject({ ok: false, reason: '你和蘭的親密度還不到 40（現在 10），他不會不收學費教你。' })
    expect(reasonOf(() => lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_lan' }, pay: 'affinity' }))).toBe('你和蘭的親密度還不到 40（現在 10），他不會不收學費教你。')
    const cred = g.state.money.cred
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_lan' }, pay: 'tuition' }))
    expect(g.state.money.cred).toBe(cred - 1500)
    expect(teachOptions(g.k, g.state, { npc: 'npc_lan' })[0]).toMatchObject({ done: 1, need: 2 })
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_lan' } }))
    expect(g.state.money.cred).toBe(cred - 1500)
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBeNull()
  })

  it('不指定付法時照親密度、旗標、學費的順序挑第一個行得通的；學費可以指定從現金付', () => {
    const g = make({ money: { cred: 5000, cash: 2000 } })
    know(g, 'npc_lan', 10)
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_lan' }, pool: 'cash' }))
    expect(g.state.money).toMatchObject({ cred: 5000, cash: 500 })
    expect(abilitiesOf(g.state, 'pc').lessons!.firearms!.pay).toBe('tuition')
    const poor = make({ money: { cred: 5000, cash: 300 } })
    know(poor, 'npc_lan', 10)
    expect(reasonOf(() => lessonDraft(poor.k, poor.state, { skill: 'firearms', from: { npc: 'npc_lan' }, pool: 'cash' }))).toBe('錢不夠：學費要 C$1,500，現金付不起。')
    poor.commit(lessonDraft(poor.k, poor.state, { skill: 'firearms', from: { npc: 'npc_lan' } }))
    expect(poor.state.money.cred).toBe(5000 - 1500)
  })

  it('錢不夠付學費被擋；6 級的學費是 5,000', () => {
    const poor = make({ money: { cred: 1000, cash: 100 } })
    know(poor, 'npc_lan', 10)
    expect(lessonBlock(poor.k, poor.state, { skill: 'firearms', from: { npc: 'npc_lan' }, pay: 'tuition' })).toBe('錢不夠：學費要 C$1,500，帳戶與現金付不起。')
    const g = make({ skills: { firearms: 5 }, money: { cred: 9000, cash: 0 } })
    know(g, 'npc_joe', 0)
    const opt = teachOptions(g.k, g.state, { npc: 'npc_joe' })[0]!
    expect(opt).toMatchObject({ level: 6 })
    expect(opt.pays.find((p) => p.pay === 'tuition')!.price).toBe(5000)
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, pay: 'tuition' }))
    expect(g.state.money.cred).toBe(4000)
  })

  it('立了旗標的山姆：不收錢也不看親密度（親密度 0）', () => {
    const g = make()
    know(g, 'npc_sam', 0)
    const opt = teachOptions(g.k, g.state, { npc: 'npc_sam' })[0]!
    expect(opt.pays.find((p) => p.pay === 'favor')).toMatchObject({ ok: false, reason: '你還沒替山姆做過一件事，他不會白教你。' })
    expect(opt.pays.find((p) => p.pay === 'affinity')!.ok).toBe(false)
    flag(g, taughtFlag('npc_sam', 'firearms'), 3)
    expect(taughtFlag('npc_sam', 'firearms')).toBe('taught:npc_sam:firearms')
    const cred = g.state.money.cred
    const r = lessonDraft(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_sam' }, pay: 'favor' })
    g.commit(r)
    expect(g.state.money.cred).toBe(cred)
    expect(abilitiesOf(g.state, 'pc').lessons!.firearms).toMatchObject({ pay: 'favor', done: 1 })
    // 不指定付法時也先走旗標
    lesson(g, { npc: 'npc_sam' })
    expect(g.state.money.cred).toBe(cred)
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBeNull()
  })

  it('他只有 5 級，主角 5 級時他不在可以教的清單裡；條件 can_teach 同一條', () => {
    const g = make({ skills: { firearms: 5 } })
    know(g, 'npc_lan', 50)
    know(g, 'npc_joe', 50)
    expect(teachOptions(g.k, g.state, { npc: 'npc_lan' })).toEqual([])
    expect(teachableSkills(g.k, g.state, 'pc', 'npc_lan')).toEqual([])
    const can = (npc: string, skill?: string) => g.k.conditions.test({ kind: 'can_teach', npc, ...(skill ? { skill } : {}) } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(can('npc_lan')).toBe(false)
    expect(can('npc_joe')).toBe(true)
    expect(can('npc_joe', 'firearms')).toBe(true)
    expect(can('npc_joe', 'brawl')).toBe(false)
    expect(can('npc_nobody')).toBe(false)
    expect(can('npc_missing')).toBe(false)
  })

  it('還沒到 4 級的基本功列得出來但上不了課；已經 6 級的不列', () => {
    const g = make({ skills: { firearms: 3 } })
    know(g, 'npc_joe', 50)
    const opt = teachOptions(g.k, g.state, { npc: 'npc_joe' })[0]!
    expect(opt).toMatchObject({ level: 4, ok: false })
    expect(opt.reason).toBe('槍械還沒到 4 級，可以直接花歷練點升，不用上課。')
    expect(reasonOf(() => lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, pay: 'affinity' }))).toBe(opt.reason)
  })
})

describe('上到一半換老師、人不在場', () => {
  it('上到一半換老師，進度不留（那一項重來）；換回來也不接回去', () => {
    const g = make()
    know(g, 'npc_joe', 45)
    know(g, 'npc_lan', 50)
    lesson(g, joe, 'affinity')
    expect(abilitiesOf(g.state, 'pc').lessons!.firearms).toMatchObject({ from: { npc: 'npc_joe' }, done: 1 })
    lesson(g, { npc: 'npc_lan' }, 'affinity')
    expect(abilitiesOf(g.state, 'pc').lessons!.firearms).toMatchObject({ from: { npc: 'npc_lan' }, done: 1, need: 2 })
    lesson(g, joe, 'affinity')
    expect(abilitiesOf(g.state, 'pc').lessons!.firearms).toMatchObject({ from: { npc: 'npc_joe' }, done: 1 })
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe(NEEDS_TEACHER)
  })

  it('人不在場：被擋並有原因；他不是角色（還沒認識）也查不到', () => {
    const g = make()
    know(g, 'npc_far', 50)
    expect(g.state.actors.npc_far).toBeDefined()
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_far' }, pay: 'affinity' })).toBe('遠方的人不在這裡：要在他現在所在的地方才能上課。')
    expect(teachOptions(g.k, g.state, { npc: 'npc_far' })[0]).toMatchObject({ ok: false, reason: '遠方的人不在這裡：要在他現在所在的地方才能上課。' })
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_ghost' }, pay: 'affinity' })).toBe('查不到這位老師。')
    // 還沒認識的人不是角色
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_joe' }, pay: 'affinity' })).toBe('查不到這位老師。')
  })

  it('隊上的老師（同行）不看出沒表', () => {
    const g = make()
    know(g, 'npc_far', 50)
    g.commit(draft([{ op: 'party', id: 'npc_far' } as never], 'test.party'))
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_far' }, pay: 'affinity' })).toBeNull()
  })

  it('他的基本功不夠格（只有 3 級）時沒有東西可以教；戰鬥中與進了委託副本都不能上課', () => {
    const g = make()
    know(g, 'npc_nobody', 50)
    expect(teachOptions(g.k, g.state, { npc: 'npc_nobody' })).toEqual([])
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: { npc: 'npc_nobody' }, pay: 'affinity' })).toBe('路人的槍械只有 3 級，不夠格教（要 5 級以上）。')
    know(g, 'npc_joe', 45)
    ;(g.state as Rec).battle = {}
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: joe, pay: 'affinity' })).toBe('戰鬥中不能上課。')
  })
})

describe('去機構上課', () => {
  it('第一個時段扣學費、上完資料寫的時段數（3 個）之後可以升 5', () => {
    const g = make()
    flag(g, 'fac', 'ft_range')
    const [opt] = teachOptions(g.k, g.state)
    expect(opt).toMatchObject({ skill: 'firearms', from: range, fromName: '東側靶場', level: 5, max: 5, need: 3, ok: true })
    expect(opt!.pays).toEqual([{ pay: 'tuition', price: 1500, ok: true, reason: null }])
    const cred = g.state.money.cred
    const before = minutes(g)
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: range }))
    expect(g.state.money.cred).toBe(cred - 1500)
    expect(minutes(g) - before).toBe(240)
    expect(teachOptions(g.k, g.state, { facility: 'ft_range' })[0]).toMatchObject({ done: 1, need: 3 })
    expect(teachOptions(g.k, g.state, { facility: 'ft_range' })[0]!.pays[0]!.price).toBe(0)
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: range }))
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe(NEEDS_TEACHER)
    const last = lessonDraft(g.k, g.state, { skill: 'firearms', from: range })
    expect(last.outcome.result).toBe('complete')
    g.commit(last)
    expect(g.state.money.cred).toBe(cred - 1500)
    expect(minutes(g) - before).toBe(720)
    g.commit(skillUpDraft(g.k, g.state, 'pc', 'firearms'))
    expect(pc(g).skills.firearms).toBe(5)
  })

  it('主角已經 5 級時機構不列；直接要上就被擋，句子寫「機構只教到 5 級」；6 級的更是', () => {
    const g = make({ skills: { firearms: 5 } })
    flag(g, 'fac', 'ft_range')
    expect(teachOptions(g.k, g.state, { facility: 'ft_range' }).map((o) => o.skill)).toEqual(['brawl'])
    expect(reasonOf(() => lessonDraft(g.k, g.state, { skill: 'firearms', from: range }))).toBe('機構只教到 5 級，6 級要向人請教。')
    const top = make({ skills: { firearms: 6 } })
    flag(top, 'fac', 'ft_range')
    expect(lessonBlock(top.k, top.state, { skill: 'firearms', from: range })).toBe('槍械已經練到最高的 6 級了。')
  })

  it('needs 的條件不成立被擋，並寫出是哪一個條件；成立就能上', () => {
    const g = make({ skills: { brawl: 4 } })
    flag(g, 'fac', 'ft_range')
    expect(lessonBlock(g.k, g.state, { skill: 'brawl', from: range })).toBe('東側靶場的課要符合條件「flag_on」才能上，現在還不符合。')
    expect(teachOptions(g.k, g.state, { facility: 'ft_range' }).find((o) => o.skill === 'brawl')).toMatchObject({ ok: false })
    flag(g, 'member', true)
    expect(lessonBlock(g.k, g.state, { skill: 'brawl', from: range })).toBeNull()
  })

  it('不在那個設施被擋並有原因；那裡沒開這一門課也擋；錢不夠擋', () => {
    const g = make()
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: range })).toBe('你不在東側靶場，要站在那裡才能上課。')
    expect(teachOptions(g.k, g.state)).toEqual([])
    flag(g, 'fac', 'ft_bar')
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: range })).toBe('你不在東側靶場，要站在那裡才能上課。')
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: { facility: 'ft_bar' } })).toBe('酒吧沒有開槍械的課。')
    const poor = make({ money: { cred: 100, cash: 100 } })
    flag(poor, 'fac', 'ft_range')
    expect(lessonBlock(poor.k, poor.state, { skill: 'firearms', from: range })).toBe('錢不夠：學費要 C$1,500，帳戶與現金付不起。')
  })

  it('換了機構（或換成向人請教）進度不留', () => {
    const g = make()
    flag(g, 'fac', 'ft_range')
    lesson(g, range)
    know(g, 'npc_joe', 45)
    lesson(g, joe, 'affinity')
    expect(abilitiesOf(g.state, 'pc').lessons!.firearms).toMatchObject({ from: { npc: 'npc_joe' }, done: 1, need: 2 })
  })
})

describe('名冊上的人照同一條路', () => {
  it('隊員自己的歷練點與基本功；學費、時間照樣花；不在隊上的被擋', () => {
    const g = make()
    know(g, 'npc_joe', 45)
    know(g, 'npc_lan', 45)
    g.state.actors.npc_lan!.skills.firearms = 4
    g.state.actors.npc_lan!.ext.abilities = { xp: 100, learned: [], equipped: [], spent: {} }
    expect(lessonBlock(g.k, g.state, { skill: 'firearms', from: joe, actor: 'npc_lan', pay: 'affinity' })).toBe('蘭不在隊上。')
    g.commit(draft([{ op: 'party', id: 'npc_lan' } as never], 'test.party'))
    const before = minutes(g)
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, actor: 'npc_lan', pay: 'affinity' }))
    g.commit(lessonDraft(g.k, g.state, { skill: 'firearms', from: joe, actor: 'npc_lan', pay: 'affinity' }))
    expect(minutes(g) - before).toBe(480)
    expect(skillUpBlock(g.k, g.state, 'npc_lan', 'firearms')).toBeNull()
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe(NEEDS_TEACHER)
    g.commit(skillUpDraft(g.k, g.state, 'npc_lan', 'firearms'))
    expect(g.state.actors.npc_lan!.skills.firearms).toBe(5)
    expect(abilitiesOf(g.state, 'npc_lan').xp).toBe(50)
  })
})

describe('NPC 的互動選單：請教', () => {
  const row = (g: G, id: string) => interactions(g.k, g.state, id).find((v) => v.kind === CONSULT_KIND)

  it('can_teach 成立的人多一項「請教」，交接記號指向 abilities 的 teachOptions；沒有東西可教的人沒有', () => {
    const g = make()
    know(g, 'npc_joe', 45)
    know(g, 'npc_nobody', 45)
    expect(row(g, 'npc_joe')).toMatchObject({ kind: 'npc_consult', name: '請教', ok: true, reason: null, needs: null, handoff: { to: 'abilities.teachOptions', npc: 'npc_joe' } })
    expect(interactions(g.k, g.state, 'npc_joe').map((v) => v.kind)).toEqual(['npc_chat', 'npc_consult'])
    expect(row(g, 'npc_nobody')).toBeUndefined()
    expect(interactions(g.k, g.state, 'npc_nobody').map((v) => v.kind)).toEqual(['npc_chat'])
  })

  it('人不在這裡時那一項灰掉並寫原因；主角已經不比他低時整項不列', () => {
    const g = make()
    know(g, 'npc_far', 45)
    expect(row(g, 'npc_far')).toMatchObject({ ok: false, reason: '他不在這裡：要在同一個地方才做得到。' })
    const top = make({ skills: { firearms: 6 } })
    know(top, 'npc_joe', 45)
    expect(row(top, 'npc_joe')).toBeUndefined()
  })

  it('沒裝 abilities 時選單照舊（沒有請教）', () => {
    const { game } = makeGame({
      features: [STUBS, actionsFeature, lewdFeature, securityFeature, npcsFeature], content: [{ id: 'p', content: baseContent() } as unknown as ContentPack], seed: 7,
      patch: { time: { day: 3, hour: 10, minute: 0 } } as never,
    })
    game.commit(draft([{ op: 'location', to: { district: 'd_hive', block: 'b_market' } }], 'test.go'))
    expect(interactions(game.k, game.state, 'npc_joe').map((v) => v.kind)).toEqual(['npc_chat'])
  })
})
