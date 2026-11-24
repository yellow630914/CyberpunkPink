// 驗收測試：dev/work/M2-fixer-pay.md（cpp-feature）。召集時替輔助面請人的四種辦法與向中間人借人；副本做完之後的入帳：報酬照付法、中間人的抽成、出場費與分紅、信譽、
// 一起去的人的忠誠與親密度；失敗（沒有報酬、信譽 −3）；撤退（請的人與付的錢都回去）。
// 規格：COMMISSIONS 6.1、6.5 節；NPC_SYSTEM 10.5、10.4、7.3 節；FIXER 第 2 節④、第 8 節；UI 7.3 節；dev/adr/0016 第三節與 G16。
// 內容一律是測試自帶的最小假資料：委託用測試掛在 fixer.offers 上的假副本；副本本體用替身活動（commission，進去時存 entry 快照）；
// 出場費（roster_fee）、名冊（in_roster）、忠誠、親密度、敵對值用測試裝的替身，人情用真的 favors。骰面：把存檔的亂數游標撥到想要的骰面再提交。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, Report, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, deriveRng, effectCtx, endActivity, isRecord, meterOf } from '../../src'
import { chooseBranch, chooseFace, commissionFeature, retreat } from '../../src/features/commission'
import { favorsFeature, favorsOf } from '../../src/features/favors'
import {
  DEFAULT_FIXER_RULES, abandonRepOf, accept, auxSetup, bondPurpose, borrowOption, borrowPrice, drop, fixerFeature, fixerRules, go, hire, hireBlocks, hireOptions, jobOf, readFixer, repGainOf, ruleProblems,
  splitPreview, unhire,
} from '../../src/features/fixer'
import type { AuxFace, HireWay, Offer } from '../../src/features/fixer'
import { makeActor, makeGame, meterFeature, observed, testMeter } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['stealth', 'negotiate', 'interface', 'perform', 'firearms'].map((id) => ({ id, name: id, attr: id === 'stealth' ? 'reflex' : id === 'interface' ? 'intellect' : id === 'firearms' ? 'reflex' : 'charm', desc: `${id}。` }))

const PACK: ContentPack = {
  id: 'm2_fixer_pay',
  content: {
    skill: SKILLS,
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }],
    npc: [{ id: 'npc_mama', name: '媽媽桑' }],
    fixer: [{ id: 'fx_a', name: '半夢的媽媽桑', npc: 'npc_mama', district: 'glass_shore', kinds: ['steal_item'], cut: 0.1 }],
  },
}

const faces = (names: string[]): Rec => Object.fromEntries(names.map((f) => [f, {}]))
/** 三個面都出現的假副本（輔助面才派得了人）。 */
const commission = (id: string, scale: 'small' | 'medium' | 'large', grade: number, extra: Rec = {}): Rec => {
  const n = { small: 3, medium: 4, large: 5 }[scale]
  return {
    id, name: `委託 ${id}`, kind: 'steal_item', main: 'meat', scale, grade, target_faction: 'hizakura', district: 'glass_shore',
    stages: Array.from({ length: n }, (_, i) => ({ name: `階段${i + 1}`, faces: i === n - 1 ? faces(['meat']) : i === 0 ? faces(['meat', 'net']) : faces(['meat', 'opinion']) })),
    ...extra,
  }
}
const offerOf = (id: string, c: Rec, reward: number, extra: Rec = {}): Offer => ({ id, commission: c, title: `${id} 的委託`, brief: `簡報：${id}。`, reward, unknowns: [], ...extra }) as unknown as Offer
const OFFERS: Offer[] = [
  offerOf('o_small', commission('cm_small', 'small', 1), 1000),
  offerOf('o_big', commission('cm_big', 'medium', 2), 2000),
  offerOf('o_large', commission('cm_large', 'large', 3), 3000),
  offerOf('o_nonet', commission('cm_nonet', 'small', 1, { stages: [{ faces: faces(['meat']) }, { faces: faces(['meat']) }, { faces: faces(['meat']) }] }), 1000),
]

const PROVIDER: Feature = {
  id: 'test_offers',
  install(k: Kernel) {
    k.hooks.on('fixer.offers', 'test_offers', ({ fixer }) => (fixer.id === 'fx_a' ? structuredClone(OFFERS) : undefined))
  },
}

/** 副本的替身活動（kind commission）：開始時存 entry 快照、記下收到的 setup 與 origin；進行中只放行 stub.。 */
const STUB: Feature = {
  id: 'cm_stub',
  install(k: Kernel) {
    k.activity.define({
      kind: 'commission', owner: 'cm_stub', order: 90,
      active: (s) => (isRecord(s.ext.cm_stub) ? { id: 'cm', label: '副本' } : null),
      allow: ['stub.', 'commit:stub.', 'rewind:entry'],
      reason: () => '副本進行中，只能做副本裡的事。',
      start: (_k, state, setup, origin) => [{
        kind: 'gig', action: 'stub.enter', location: { ...state.location }, party: [], timeline: [],
        changes: [{ op: 'snapshot.take', kind: 'entry', label: '進入副本前' }, { op: 'ext', key: 'cm_stub', value: { setup, origin } }],
        outcome: { result: 'entered', summary: '進了副本。' },
      }],
    })
  },
}

/** 名冊的替身：衍生數值 roster_fee（照表）與條件 in_roster（照名單）。 */
const FEES: Record<string, number> = {}
const ROSTER = new Set<string>()
const ROSTER_STUB: Feature = {
  id: 'test_roster',
  install(k: Kernel) {
    k.stats.defineStat({ id: 'roster_fee', owner: 'test_roster', name: '出場費', min: 0, base: (_s, actor) => FEES[actor] ?? 0 })
    k.conditions.register<{ kind: string; who: string }>({ kind: 'in_roster', owner: 'test_roster', validate: () => [], test: (c) => ROSTER.has(c.who) })
  },
}

const METERS = meterFeature(
  testMeter({ kind: 'hostility', owner: 'test_security', name: '敵對值', keyed: 'faction', min: 0, max: 100, start: 0, cap: { down: 10, up: 10 } }),
  testMeter({ kind: 'affinity', owner: 'test_npcs', name: '親密度', keyed: 'npc', min: -100, max: 100, start: 0, cap: { down: 8, up: 8 } }),
  testMeter({ kind: 'loyalty', owner: 'test_roster', name: '忠誠', keyed: 'npc', min: 0, max: 100, start: 30, cap: { down: 10, up: 10 } }),
)

const PC = { attrs: { reflex: 14, charm: 14, intellect: 14 }, skills: { stealth: 3, negotiate: 3, interface: 3, perform: 3 } }
const person = (id: string, role: 'npc' | 'companion' = 'npc') => makeActor({ id, name: `人${id}`, role, age: 27 })

/**
 * 人：npc 角色 ann（出場費 400）、bob（300）、dee（200）、cy（0，拿分紅）、out（不在名冊上）；
 * 隊伍裡（companion 角色）：pf（出場費 400）、pg（700）、ps（0，拿分紅）。名冊上的都在 ROSTER。
 */
const ACTORS = [person('ann'), person('bob'), person('dee'), person('cy'), person('out'), person('pf', 'companion'), person('pg', 'companion'), person('ps', 'companion')]
const FEE_TABLE: Record<string, number> = { ann: 400, bob: 300, dee: 200, cy: 0, pf: 400, pg: 700, ps: 0 }

type G = ReturnType<typeof makeGame>['game']
interface Opts { features?: Feature[]; content?: ContentPack[]; cash?: number; cred?: number; roster?: boolean; favors?: boolean; meters?: boolean; party?: string[] }
function setup(o: Opts = {}): G {
  for (const k of Object.keys(FEES)) delete FEES[k]
  Object.assign(FEES, FEE_TABLE)
  ROSTER.clear()
  for (const id of ['ann', 'bob', 'dee', 'cy', 'pf', 'pg', 'ps']) ROSTER.add(id)
  const party = new Set(o.party ?? [])
  const actors = ACTORS.filter((a) => a.role !== 'companion' || party.has(a.id))
  // 沒選進隊伍的 companion 不放進去；選了的 companion 自動進 state.party
  const features: Feature[] = [fixerFeature, PROVIDER, STUB, ...(o.roster === false ? [] : [ROSTER_STUB]), ...(o.favors === false ? [] : [favorsFeature]), ...(o.meters === false ? [] : [METERS]), ...(o.features ?? [])]
  return makeGame({
    features, content: o.content ?? [PACK], pc: PC as never, actors,
    patch: { money: { cred: o.cred ?? 0, cash: o.cash ?? 1000 } },
  }).game
}

// ---- 小工具 ----

const sysDraft = (changes: ReportDraft['changes'], action = 'test.setup'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const ctxOf = (g: G) => effectCtx(g.k, g.state, { source: 'builtin' })
const give = (g: G, kind: 'owed_to_pc' | 'owed', who: string, size: string): void => {
  const r = g.k.effects.resolve([{ kind, who, size }], ctxOf(g))
  expect(r.errors).toEqual([])
  g.commit(sysDraft(r.changes))
}
const setRep = (g: G, n: number): void => {
  const r = g.k.effects.resolve([{ kind: 'rep', amount: n, final: true }], ctxOf(g))
  expect(r.errors).toEqual([])
  g.commit(sysDraft(r.changes))
}
const addCondition = (g: G, id: string, condition: string): void => void g.commit(sysDraft([{ op: 'actor.condition', id, condition }]))
const rep = (g: G): number => meterOf(g.k, g.state, 'rep')
const aff = (g: G, id: string): number => meterOf(g.k, g.state, 'affinity', id)
const loy = (g: G, id: string): number => meterOf(g.k, g.state, 'loyalty', id)
const host = (g: G): number => meterOf(g.k, g.state, 'hostility', 'hizakura')
const cash = (g: G): number => g.state.money.cash
const cred = (g: G): number => g.state.money.cred

function findNatural(g: G, purpose: string, want: number): void {
  for (let c = 0; c < 100000; c++) {
    if (deriveRng({ seed: g.state.rng.seed, cursor: c }, purpose, 0).int(1, 20) === want) {
      g.state.rng.cursor = c
      return
    }
  }
  throw new Error(`找不到骰面 ${want}`)
}

const take = (g: G, id = 'o_big', pay: 'cash' | 'cred' | 'favor' = 'cash'): Report[] => g.commit(accept(g.k, g.state, { id, fixer: 'fx_a' }, { pay }))
const job = (g: G, id = 'o_big') => jobOf(g.state, id)!
const doHire = (g: G, actor: string, way: HireWay, face: AuxFace = 'meat', id = 'o_big'): Report[] => g.commit(hire(g.k, g.state, id, { face, way, actor }))
const doBorrow = (g: G, face: AuxFace = 'meat', id = 'o_big'): Report[] => g.commit(hire(g.k, g.state, id, { face, way: 'borrow' }))
const doGo = (g: G, id = 'o_big'): Report[] => g.commit(go(g.k, g.state, id))
const isBusy = (g: G, id: string): boolean => g.state.actors[id]!.conditions.some((c) => c.id === 'busy')
const optionOf = (g: G, actor: string, way: HireWay, face: AuxFace = 'meat', id = 'o_big') => hireOptions(g.k, g.state, job(g, id), face, actor).find((o) => o.way === way)

/** 結束替身副本（發 activity.end，處理函式回傳的東西併進去）。 */
function endStub(g: G, outcome: string, result: Rec = {}): Report[] {
  const st = g.state.ext.cm_stub as { origin: { by: string; ref?: string } }
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: st.origin, outcome, result })
  return g.commit(attachActivityEnd({
    kind: 'gig', action: 'stub.end', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes],
    outcome: { result: outcome, summary: '副本結束。' },
  }, end))
}

/** 撤退（和真的副本一樣：結束的報告帶 rewind: entry）。 */
function retreatStub(g: G): Report[] {
  const st = g.state.ext.cm_stub as { origin: { by: string; ref?: string } }
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: st.origin, outcome: 'retreat', result: {} })
  return g.commit(attachActivityEnd({
    kind: 'gig', action: 'stub.retreat', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes],
    outcome: { result: 'retreat', summary: '撤退。' }, rewind: { kind: 'entry', summary: '你撤退了，所有進度回到進去之前。' },
  }, end))
}

const payout = (reports: Report[]): Report => reports.find((r) => r.action === 'fixer.payout')!

// ===================================================================================================================
// 四種辦法
// ===================================================================================================================

describe('hireOptions：四種辦法各自成不成立、代價、成功率', () => {
  it('付錢、用人情、欠人情、靠交情都列；付錢的代價是出場費，成功率 100', () => {
    const g = setup()
    take(g)
    const opts = hireOptions(g.k, g.state, job(g), 'meat', 'ann')
    expect(opts.map((o) => o.way)).toEqual(['pay', 'use_favor', 'owe_favor', 'bond'])
    const pay = opts[0]!
    expect(pay.price).toEqual({ cash: 400 })
    expect(pay.cost).toMatch(/400/)
    expect(pay.chance).toBe(100)
    expect(pay.block).toBeNull()
    // 沒有人欠你人情：用人情灰掉並說原因；欠人情、靠交情成立
    expect(opts[1]!.block).toMatch(/沒有欠你人情/)
    expect(opts[2]!.block).toBeNull()
    expect(opts[2]!.cost).toMatch(/你欠他一個小人情/)
    expect(opts[3]!.block).toBeNull()
  })

  it('付錢：錢不夠時灰掉並寫出差多少；拿分紅的人不收出場費', () => {
    const g = setup({ cash: 100 })
    take(g)
    const pay = optionOf(g, 'ann', 'pay')!
    expect(pay.block).toMatch(/400/)
    expect(pay.block).toMatch(/100/)
    expect(() => hire(g.k, g.state, 'o_big', { face: 'meat', way: 'pay', actor: 'ann' })).toThrow(ActionBlocked)
    const share = optionOf(g, 'cy', 'pay')!
    expect(share.price).toEqual({})
    expect(share.block).toBeNull()
    expect(share.cost).toMatch(/分紅/)
  })

  it('付錢：扣了出場費、人記進 aux、身上掛 busy；報告是 fixer.hire', () => {
    const g = setup()
    take(g)
    const [r] = doHire(g, 'ann', 'pay')
    expect(r!.action).toBe('fixer.hire')
    expect(r!.kind).toBe('gig')
    expect(cash(g)).toBe(600)
    expect(job(g).aux).toEqual({ meat: [{ actor: 'ann', way: 'pay', cost: { cash: 400 } }] })
    expect(isBusy(g, 'ann')).toBe(true)
  })

  it('用人情：用掉他欠你的一個小人情，那一筆沒了；錢不動', () => {
    const g = setup()
    take(g)
    give(g, 'owed_to_pc', 'ann', 'small')
    give(g, 'owed_to_pc', 'bob', 'small')
    expect(optionOf(g, 'ann', 'use_favor')!.block).toBeNull()
    doHire(g, 'ann', 'use_favor')
    expect(favorsOf(g.state).owed_to_pc.map((f) => f.who)).toEqual(['bob'])
    expect(cash(g)).toBe(1000)
    expect(job(g).aux.meat![0]).toMatchObject({ actor: 'ann', way: 'use_favor', cost: { favor: { kind: 'used', who: 'ann', size: 'small' } } })
    expect(isBusy(g, 'ann')).toBe(true)
  })

  it('用人情：沒有小的時用中的頂（整筆用掉）', () => {
    const g = setup()
    take(g)
    give(g, 'owed_to_pc', 'ann', 'mid')
    doHire(g, 'ann', 'use_favor')
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
    expect(job(g).aux.meat![0]!.cost.favor).toMatchObject({ kind: 'used', size: 'mid' })
  })

  it('欠人情：你欠他一個小人情；錢不動', () => {
    const g = setup()
    take(g)
    doHire(g, 'ann', 'owe_favor')
    const owed = favorsOf(g.state).owed_by_pc
    expect(owed).toHaveLength(1)
    expect(owed[0]).toMatchObject({ who: 'ann', size: 'small' })
    expect(cash(g)).toBe(1000)
    expect(isBusy(g, 'ann')).toBe(true)
  })

  it('靠交情：親密度 0 時 DC 20、成功率 30%；親密度 50 時 DC 10', () => {
    const g = setup()
    take(g)
    const bond = optionOf(g, 'ann', 'bond')!
    expect(bond.roll).toMatchObject({ dc: 20, skill: 'negotiate' })
    expect(bond.chance).toBe(30)
    expect(bond.cost).toMatch(/DC 20/)
    g.commit(sysDraft(g.k.effects.resolve([{ kind: 'affinity', key: 'ann', amount: 8 }], ctxOf(g)).changes))
    g.state.meters.affinity = { ann: 50 }
    expect(optionOf(g, 'ann', 'bond')!.roll!.dc).toBe(10)
    expect(optionOf(g, 'ann', 'bond')!.chance).toBeGreaterThan(30)
  })

  it('靠交情：固定骰面的成功一條——請到了，沒有代價', () => {
    const g = setup()
    take(g)
    findNatural(g, bondPurpose('o_big', 'ann'), 17)
    const [r] = doHire(g, 'ann', 'bond')
    expect(r!.timeline[0]!.roll).toMatchObject({ natural: 17, dc: 20, degree: 'success' })
    expect(job(g).aux.meat).toEqual([{ actor: 'ann', way: 'bond', cost: {} }])
    expect(isBusy(g, 'ann')).toBe(true)
    expect(cash(g)).toBe(1000)
    expect(job(g).bond_failed).toEqual([])
  })

  it('靠交情：固定骰面的失敗一條——沒請到、這個辦法灰掉並有原因，別的辦法照樣能用', () => {
    const g = setup()
    take(g)
    findNatural(g, bondPurpose('o_big', 'ann'), 4)
    const cursor = g.state.rng.cursor
    const [r] = doHire(g, 'ann', 'bond')
    expect(r!.timeline[0]!.roll).toMatchObject({ natural: 4 })
    expect(r!.outcome.result).toBe('bond_failed')
    expect(job(g).aux).toEqual({})
    expect(job(g).bond_failed).toEqual(['ann'])
    expect(isBusy(g, 'ann')).toBe(false)
    expect(g.state.rng.cursor).toBeGreaterThan(cursor)
    const bond = optionOf(g, 'ann', 'bond')!
    expect(bond.block).toMatch(/試過靠交情/)
    expect(() => hire(g.k, g.state, 'o_big', { face: 'meat', way: 'bond', actor: 'ann' })).toThrow(/試過靠交情/)
    expect(optionOf(g, 'ann', 'pay')!.block).toBeNull()
    expect(() => doHire(g, 'ann', 'pay')).not.toThrow()
    // 失敗只記在這一件、這個人身上：別人照常、別件委託也還能試
    take(g, 'o_small')
    expect(optionOf(g, 'bob', 'bond')!.block).toBeNull()
    expect(hireOptions(g.k, g.state, job(g, 'o_small'), 'meat', 'ann').find((o) => o.way === 'bond')!.block).toMatch(/忙/)
  })

  it('忠誠 70 的人不擲：沒有骰子、亂數不動、成功率 100', () => {
    const g = setup()
    take(g)
    g.state.meters.loyalty = { ann: 70, bob: 69 }
    const bond = optionOf(g, 'ann', 'bond')!
    expect(bond.roll).toBeNull()
    expect(bond.chance).toBe(100)
    expect(bond.cost).toMatch(/不用擲/)
    expect(optionOf(g, 'bob', 'bond')!.roll).not.toBeNull()
    const cursor = g.state.rng.cursor
    const [r] = doHire(g, 'ann', 'bond')
    expect(r!.timeline).toEqual([])
    expect(g.state.rng.cursor).toBe(cursor)
    expect(job(g).aux.meat![0]).toMatchObject({ actor: 'ann', way: 'bond' })
  })

  it('沒裝人情的功能時只有付錢與靠交情兩種', () => {
    const g = setup({ favors: false })
    take(g)
    expect(hireOptions(g.k, g.state, job(g), 'meat', 'ann').map((o) => o.way)).toEqual(['pay', 'bond'])
    expect(() => hire(g.k, g.state, 'o_big', { face: 'meat', way: 'use_favor', actor: 'ann' })).toThrow(/沒有開放/)
    expect(() => hire(g.k, g.state, 'o_big', { face: 'meat', way: 'owe_favor', actor: 'ann' })).toThrow(/沒有開放/)
  })

  it('沒裝名冊的功能：出場費當 0、不檢查名冊', () => {
    const g = setup({ roster: false })
    take(g)
    expect(optionOf(g, 'ann', 'pay')!.price).toEqual({})
    expect(optionOf(g, 'out', 'pay')!.block).toBeNull()
    doHire(g, 'out', 'pay')
    expect(cash(g)).toBe(1000)
    expect(job(g).aux.meat![0]).toMatchObject({ actor: 'out', way: 'pay' })
  })
})

// ===================================================================================================================
// 請不了的人
// ===================================================================================================================

describe('請不到的人與原因', () => {
  it('隊上的人請不了並有原因；受傷、躲風頭、被捕、在忙的也請不了；不在名冊上的請不了', () => {
    const g = setup({ party: ['pf'] })
    take(g)
    expect(g.state.party).toContain('pf')
    const why = (actor: string) => hireBlocks(g.k, g.state, job(g), 'meat', actor)
    expect(why('pf')).toEqual([expect.stringMatching(/在你的隊上/)])
    expect(optionOf(g, 'pf', 'pay')!.block).toMatch(/隊上/)
    expect(() => doHire(g, 'pf', 'pay')).toThrow(/隊上/)
    expect(why('out')).toEqual([expect.stringMatching(/不在你的名冊上/)])
    addCondition(g, 'ann', 'injured')
    addCondition(g, 'bob', 'lying_low')
    addCondition(g, 'dee', 'arrested')
    expect(why('ann')).toEqual([expect.stringMatching(/受傷/)])
    expect(why('bob')).toEqual([expect.stringMatching(/躲風頭/)])
    expect(why('dee')).toEqual([expect.stringMatching(/關起來/)])
    for (const a of ['ann', 'bob', 'dee']) expect(hireOptions(g.k, g.state, job(g), 'meat', a).every((o) => o.block !== null)).toBe(true)
    addCondition(g, 'cy', 'busy')
    expect(why('cy')).toEqual([expect.stringMatching(/在忙/)])
    expect(why('pf')).toHaveLength(1)
  })

  it('每一條原因各一句（一個人同時有幾個狀況時一條一個）', () => {
    const g = setup({ party: ['pf'] })
    take(g)
    addCondition(g, 'pf', 'injured')
    expect(hireBlocks(g.k, g.state, job(g), 'meat', 'pf')).toHaveLength(2)
  })

  it('同一面最多 2 個，第三個人被擋；別的面還有位子', () => {
    const g = setup()
    take(g)
    doHire(g, 'ann', 'pay')
    doHire(g, 'bob', 'pay')
    expect(hireBlocks(g.k, g.state, job(g), 'meat', 'dee')).toEqual([expect.stringMatching(/最多 2 個/)])
    expect(() => doHire(g, 'dee', 'pay')).toThrow(/最多 2 個/)
    expect(() => doHire(g, 'dee', 'pay', 'net')).not.toThrow()
    expect(job(g).aux.meat).toHaveLength(2)
    expect(job(g).aux.net).toHaveLength(1)
  })

  it('同一個人不能請兩次；別件委託請了的人現在在忙', () => {
    const g = setup()
    take(g)
    take(g, 'o_small')
    doHire(g, 'ann', 'pay')
    expect(() => doHire(g, 'ann', 'owe_favor', 'net')).toThrow(/已經在這件委託裡了（派在現實面）/)
    expect(() => doHire(g, 'ann', 'pay', 'meat', 'o_small')).toThrow(/在忙/)
  })

  it('這件委託沒有的面、不存在的人、不存在的辦法、做完的委託、出發之後都請不了', () => {
    const g = setup()
    take(g, 'o_nonet')
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'net', way: 'pay', actor: 'ann' })).toThrow(/沒有內海面/)
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'moon' as never, way: 'pay', actor: 'ann' })).toThrow(/沒有「moon」/)
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'meat', way: 'pay', actor: 'ghost' })).toThrow(/查不到/)
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'meat', way: 'pay', actor: 'pc' })).toThrow(/主角自己/)
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'meat', way: 'steal' as never, actor: 'ann' })).toThrow(/辦法只能是/)
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'meat', way: 'pay' })).toThrow(/要說請誰/)
    expect(() => hire(g.k, g.state, 'o_none', { face: 'meat', way: 'pay', actor: 'ann' })).toThrow(/手上沒有/)
    doHire(g, 'ann', 'pay', 'meat', 'o_nonet')
    doGo(g, 'o_nonet')
    expect(() => doHire(g, 'bob', 'pay', 'meat', 'o_nonet')).toThrow() // 副本進行中：白名單沒有 fixer.hire
    expect(g.blockOf('commit:fixer.hire')).toMatch(/副本進行中/)
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'meat', way: 'pay', actor: 'bob' })).toThrow(/出發之前/)
    expect(() => unhire(g.k, g.state, 'o_nonet', 'ann')).toThrow(/出發之後不能退人/)
    endStub(g, 'done', { rating: 'B' })
    expect(() => hire(g.k, g.state, 'o_nonet', { face: 'meat', way: 'pay', actor: 'bob' })).toThrow(/做完了/)
  })
})

// ===================================================================================================================
// 借人
// ===================================================================================================================

describe('向中間人借人', () => {
  it('價錢是等級² × 200 的 1.5 倍；進了 aux 的 borrowed（出發時）；臨時角色在 state.actors、掛 busy、只有基本功', () => {
    const g = setup({ cash: 3000 })
    take(g) // 等級 2：4 × 200 × 1.5 = 1200
    expect(borrowPrice(g.k, job(g))).toBe(1200)
    expect(borrowOption(g.k, g.state, job(g), 'net').price).toEqual({ cash: 1200 })
    const [r] = doBorrow(g, 'net')
    expect(r!.action).toBe('fixer.hire')
    expect(cash(g)).toBe(1800)
    const entry = job(g).aux.net![0]!
    expect(entry).toMatchObject({ way: 'borrow', cost: { cash: 1200 } })
    const who = g.state.actors[entry.actor]!
    expect(who.conditions.map((c) => c.id)).toEqual(['busy'])
    expect(who.skills).toEqual({ interface: 2 })
    expect(who.role).toBe('npc')
    expect(g.state.party).not.toContain(entry.actor)
    expect(job(g).borrow_n).toBe(1)
    // 出發時進了 setup.aux.borrowed
    doGo(g)
    const st = g.state.ext.cm_stub as { setup: { aux: Rec } }
    expect(st.setup.aux).toEqual({ net: [entry.actor], borrowed: [entry.actor] })
  })

  it('只能付錢：錢不夠時灰掉；每一面最多 2 個；第二個借來的人 id 不撞', () => {
    const g = setup({ cash: 1300 })
    take(g)
    expect(borrowOption(g.k, g.state, job(g), 'meat').block).toBeNull()
    doBorrow(g)
    expect(borrowOption(g.k, g.state, job(g), 'meat').block).toMatch(/1,200/)
    expect(() => doBorrow(g)).toThrow(ActionBlocked)
    const g2 = setup({ cash: 5000 })
    take(g2)
    doBorrow(g2)
    doBorrow(g2)
    const ids = job(g2).aux.meat!.map((e) => e.actor)
    expect(new Set(ids).size).toBe(2)
    expect(borrowOption(g2.k, g2.state, job(g2), 'meat').block).toMatch(/最多 2 個/)
    expect(job(g2).borrow_n).toBe(2)
  })

  it('借來的人沒有分量修正：不看路數（aux 的 borrowed 標出來）；借來的人技能照那一面的基本功', () => {
    const g = setup({ cash: 5000 })
    take(g)
    doBorrow(g, 'opinion')
    expect(g.state.actors[job(g).aux.opinion![0]!.actor]!.skills).toEqual({ perform: 2, negotiate: 2 })
    doBorrow(g, 'meat')
    expect(Object.keys(g.state.actors[job(g).aux.meat![0]!.actor]!.skills).sort()).toEqual(['athletics', 'brawl', 'firearms', 'stealth'])
  })
})

// ===================================================================================================================
// 退人
// ===================================================================================================================

describe('unhire：出發之前可以退', () => {
  it('錢退、busy 拿掉；用掉的人情不退；欠下的人情取消', () => {
    const g = setup()
    take(g)
    give(g, 'owed_to_pc', 'bob', 'small')
    doHire(g, 'ann', 'pay')
    doHire(g, 'bob', 'use_favor')
    doHire(g, 'dee', 'owe_favor', 'net')
    expect(cash(g)).toBe(600)
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(1)
    const [pay] = g.commit(unhire(g.k, g.state, 'o_big', 'ann'))
    expect(pay!.action).toBe('fixer.unhire')
    expect(cash(g)).toBe(1000)
    expect(isBusy(g, 'ann')).toBe(false)
    expect(job(g).aux.meat!.map((e) => e.actor)).toEqual(['bob'])
    g.commit(unhire(g.k, g.state, 'o_big', 'bob'))
    expect(favorsOf(g.state).owed_to_pc).toEqual([]) // 用掉的不退
    expect(isBusy(g, 'bob')).toBe(false)
    g.commit(unhire(g.k, g.state, 'o_big', 'dee'))
    expect(favorsOf(g.state).owed_by_pc).toEqual([])
    expect(job(g).aux).toEqual({})
    expect(() => unhire(g.k, g.state, 'o_big', 'dee')).toThrow(/沒有請/)
  })

  it('借來的人退掉：錢退、臨時角色移除', () => {
    const g = setup({ cash: 3000 })
    take(g)
    doBorrow(g)
    const id = job(g).aux.meat![0]!.actor
    g.commit(unhire(g.k, g.state, 'o_big', id))
    expect(cash(g)).toBe(3000)
    expect(g.state.actors[id]).toBeUndefined()
    expect(job(g).aux).toEqual({})
  })
})

// ===================================================================================================================
// 出發
// ===================================================================================================================

describe('go：把 aux 整理成副本要的樣子', () => {
  it('每一面的角色 id、借來的併進 setup.aux；沒請人就沒有 aux', () => {
    const none = setup()
    take(none, 'o_small')
    doGo(none, 'o_small')
    expect((none.state.ext.cm_stub as { setup: Rec }).setup.aux).toBeUndefined()
    const g = setup({ cash: 5000 })
    take(g)
    doHire(g, 'ann', 'pay', 'meat')
    doHire(g, 'bob', 'owe_favor', 'meat')
    doHire(g, 'dee', 'pay', 'opinion')
    doBorrow(g, 'net')
    const borrowed = job(g).aux.net![0]!.actor
    expect(auxSetup(job(g))).toEqual({ meat: ['ann', 'bob'], net: [borrowed], opinion: ['dee'], borrowed: [borrowed] })
    doGo(g)
    expect((g.state.ext.cm_stub as { setup: { aux: Rec; terms: Rec } }).setup.aux).toEqual({ meat: ['ann', 'bob'], net: [borrowed], opinion: ['dee'], borrowed: [borrowed] })
  })

  it('請的人已經不在了：出發被擋並說原因', () => {
    const g = setup()
    take(g)
    doHire(g, 'ann', 'pay')
    g.commit(sysDraft([{ op: 'actor.remove', id: 'ann' }]))
    expect(() => go(g.k, g.state, 'o_big')).toThrow(/已經不在了/)
  })
})

// ===================================================================================================================
// 入帳
// ===================================================================================================================

describe('入帳：報酬照付法、抽成、出場費、分紅', () => {
  it('報酬 2,000、抽成 10%、出場費 400 的人、拿分紅的夥伴、評價 B、現金 → 抽 200、付 400、剩 1,400 分三份，主角拿兩份', () => {
    const g = setup({ party: ['pf', 'ps'] })
    take(g)
    const preview = splitPreview(g.k, g.state, job(g))
    expect(preview).toMatchObject({ reward: 2000, gross: 2000, cut: 200, pool: 1400, shares: 3, wallet: 'cash', rating: 'B' })
    expect(preview.segments.map((s) => [s.kind, s.who, s.amount])).toEqual([['cut', 'fx_a', 200], ['fee', 'pf', 400], ['share', 'ps', 466], ['boss', 'pc', 934]])
    expect(preview.segments.every((s) => s.wallet === 'cash')).toBe(true)
    expect(preview.pc_net).toBe(934)
    expect(preview.lines).toHaveLength(2)
    doGo(g)
    const reports = endStub(g, 'done', { rating: 'B', xp: 35 })
    const p = payout(reports)
    expect(p.kind).toBe('gig')
    expect(p.outcome.result).toBe('paid')
    expect(cash(g)).toBe(1000 + 934)
    expect(job(g).status).toBe('done')
    expect(job(g).payout).toMatchObject({ outcome: 'done', rating: 'B', reward: 2000, gross: 2000, cut: 200, pool: 1400, pc_net: 934, wallet: 'cash', debt: 0 })
    // 數字和 splitPreview 一樣（報告的時間軸帶著整份分帳）
    const split = p.timeline[0]!.data!.split as typeof preview
    expect(split).toMatchObject({ cut: 200, pool: 1400, pc_net: 934, segments: preview.segments })
    expect(readFixer(g.state).pending).toEqual([])
  })

  it('一起去的人親密度 +2；錢照說好的付了的人忠誠 +2；信譽照委託與主角的級（o_big 是 II 級、主角 I 級：高一級 +4）', () => {
    const g = setup({ party: ['pf', 'ps'] })
    take(g)
    doGo(g)
    endStub(g, 'done', { rating: 'B' })
    expect(rep(g)).toBe(4)
    expect(aff(g, 'pf')).toBe(2)
    expect(aff(g, 'ps')).toBe(2)
    expect(loy(g, 'pf')).toBe(32)
    expect(loy(g, 'ps')).toBe(32)
    expect(aff(g, 'ann')).toBe(0)
  })

  it('評價 S 多 20%、A 多 10%、C 少 10%；沒給評價當 B', () => {
    const g = setup()
    take(g)
    for (const [rating, reward] of [['S', 2400], ['A', 2200], ['B', 2000], ['C', 1800]] as const) expect(splitPreview(g.k, g.state, job(g), rating)).toMatchObject({ rating, reward })
    doGo(g)
    endStub(g, 'done', { rating: 'S' })
    expect(job(g).payout).toMatchObject({ rating: 'S', reward: 2400 })
    expect(cash(g)).toBe(1000 + 2160) // 2400 − 抽成 240，沒有別人分
    const h = setup()
    take(h)
    doGo(h)
    endStub(h, 'done', {})
    expect(job(h).payout).toMatchObject({ rating: 'B', reward: 2000 })
  })

  it('匯進帳戶：進的是帳戶、是 85%、目標勢力敵對值 +2、只加一次（不管幾個人分）', () => {
    const g = setup({ party: ['pf', 'ps'], cred: 50 })
    take(g, 'o_big', 'cred')
    const preview = splitPreview(g.k, g.state, job(g))
    expect(preview).toMatchObject({ wallet: 'cred', reward: 2000, gross: 1700, cut: 170, hostility: { faction: 'hizakura', amount: 2 } })
    expect(preview.segments.every((s) => s.wallet === 'cred')).toBe(true)
    doGo(g)
    const h0 = host(g)
    endStub(g, 'done', { rating: 'B' })
    // 1700 − 170 − 400 = 1130，兩個人分（夥伴 1 份、你 2 份）→ 夥伴 376、你 754
    expect(preview.pool).toBe(1130)
    expect(cred(g)).toBe(50 + 754)
    expect(cash(g)).toBe(1000)
    expect(host(g)).toBe(h0 + 2)
  })

  it('匯進帳戶：沒有人定義敵對值、或沒有目標勢力時不加', () => {
    const g = setup({ meters: false })
    take(g, 'o_big', 'cred')
    expect(splitPreview(g.k, g.state, job(g)).hostility).toBeNull()
    doGo(g)
    expect(() => endStub(g, 'done', { rating: 'B' })).not.toThrow()
    expect(cred(g)).toBe(1530)
    const h = setup()
    h.state.actors.pc = h.state.actors.pc!
    take(h, 'o_big', 'cred')
    expect(splitPreview(h.k, h.state, { ...job(h), commission: { ...job(h).commission, target_faction: 'none' } }).hostility).toBeNull()
  })

  it('換人情：抽成只算七成的那一部分、現金拿七成、多一個人情記在中間人名下（大型是中）', () => {
    const g = setup()
    take(g, 'o_big', 'favor')
    expect(splitPreview(g.k, g.state, job(g))).toMatchObject({ wallet: 'cash', gross: 1400, cut: 140, pool: 1260, favor: { who: 'npc_mama', size: 'small' } })
    doGo(g)
    endStub(g, 'done', { rating: 'B' })
    expect(cash(g)).toBe(1000 + 1260)
    expect(favorsOf(g.state).owed_to_pc).toEqual([expect.objectContaining({ who: 'npc_mama', size: 'small' })])
    const h = setup({ cash: 0 })
    take(h, 'o_large', 'favor')
    doGo(h, 'o_large')
    endStub(h, 'done', { rating: 'B' })
    expect(favorsOf(h.state).owed_to_pc).toEqual([expect.objectContaining({ who: 'npc_mama', size: 'mid' })])
  })

  it('沒人分紅時主角拿全部剩的；人情的功能沒裝時沒有人情那一份', () => {
    const g = setup()
    take(g)
    expect(splitPreview(g.k, g.state, job(g))).toMatchObject({ pool: 1800, shares: 2, pc_net: 1800 })
    const h = setup({ favors: false })
    take(h)
    expect(splitPreview(h.k, h.state, job(h)).favor).toBeNull()
  })
})

describe('入帳：出場費與分紅的細節', () => {
  it('報酬不夠付出場費時從主角身上同一種錢補；補得出來就不記欠，忠誠照付', () => {
    const g = setup({ party: ['pf', 'pg'], cash: 1000 })
    take(g, 'o_small') // 1000，抽成 100，剩 900；出場費 400 + 700
    const p = splitPreview(g.k, g.state, job(g, 'o_small'))
    expect(p).toMatchObject({ pool: 0, covered: 200, debt: 0, pc_net: -200 })
    expect(p.segments.filter((s) => s.kind === 'fee').map((s) => [s.who, s.paid, s.covered, s.debt])).toEqual([['pf', 400, 0, 0], ['pg', 500, 200, 0]])
    doGo(g, 'o_small')
    endStub(g, 'done', { rating: 'B' })
    expect(cash(g)).toBe(800)
    expect(loy(g, 'pg')).toBe(32)
  })

  it('補不出來的記成欠（一行結果）：忠誠照沒付算，不扣成負的錢', () => {
    const g = setup({ party: ['pf', 'pg'], cash: 100 })
    take(g, 'o_small')
    const p = splitPreview(g.k, g.state, job(g, 'o_small'))
    expect(p).toMatchObject({ covered: 100, debt: 100, pc_net: -100 })
    doGo(g, 'o_small')
    const reports = endStub(g, 'done', { rating: 'B' })
    expect(cash(g)).toBe(0)
    expect(loy(g, 'pf')).toBe(32)
    expect(loy(g, 'pg')).toBe(30)
    expect(aff(g, 'pg')).toBe(2)
    const lines = payout(reports).narration?.results ?? []
    expect(lines.filter((l) => /還欠/.test(l))).toHaveLength(1)
    expect(job(g, 'o_small').payout).toMatchObject({ debt: 100 })
  })

  it('匯進帳戶時不夠付的出場費從帳戶補（同一種錢）', () => {
    const g = setup({ party: ['pf', 'pg'], cash: 5000, cred: 300 })
    take(g, 'o_small', 'cred') // 850、抽成 85、剩 765；出場費 1100 → 缺 335，帳戶只有 300
    const p = splitPreview(g.k, g.state, job(g, 'o_small'))
    expect(p).toMatchObject({ wallet: 'cred', covered: 300, debt: 35 })
    doGo(g, 'o_small')
    endStub(g, 'done', { rating: 'B' })
    expect(cred(g)).toBe(0)
    expect(cash(g)).toBe(5000)
  })

  it('輔助面請來的人：付錢請的出場費召集時就付了，入帳時不再扣；用人情、靠交情請來的不拿錢也不佔分紅；拿分紅的夥伴分一份', () => {
    const g = setup({ party: ['pf'] })
    take(g)
    give(g, 'owed_to_pc', 'bob', 'small')
    doHire(g, 'ann', 'pay') // 400（預付）
    doHire(g, 'bob', 'use_favor')
    doHire(g, 'dee', 'owe_favor', 'net')
    doHire(g, 'cy', 'pay', 'net') // 拿分紅
    expect(cash(g)).toBe(600)
    const p = splitPreview(g.k, g.state, job(g))
    // 抽成 200、隊上的 pf 出場費 400 在入帳時付；剩 1,400 由 cy（1 份）與主角（2 份）分
    expect(p).toMatchObject({ cut: 200, pool: 1400, shares: 3, pc_net: 934 })
    expect(p.prepaid.map((x) => [x.who, x.prepaid])).toEqual([['ann', 400]])
    expect(p.outside.map((x) => [x.who, x.way])).toEqual([['bob', 'use_favor'], ['dee', 'owe_favor']])
    expect(p.segments.map((s) => s.kind + ':' + s.who)).toEqual(['cut:fx_a', 'fee:pf', 'share:cy', 'boss:pc'])
    doGo(g)
    endStub(g, 'done', { rating: 'B' })
    expect(cash(g)).toBe(600 + 934)
    // 一起去的人都親密度 +2（包含輔助面）；忠誠只給錢照說好的付了的人（付錢請的、拿分紅的、隊上的），用人情與靠交情的不給
    for (const id of ['pf', 'ann', 'bob', 'dee', 'cy']) expect(aff(g, id)).toBe(2)
    for (const id of ['pf', 'ann', 'cy']) expect(loy(g, id)).toBe(32)
    for (const id of ['bob', 'dee']) expect(loy(g, id)).toBe(30)
    expect(aff(g, 'out')).toBe(0)
  })

  it('做完之後請的人身上沒有 busy；借來的角色不在 state.actors；別的狀況不動', () => {
    const g = setup({ cash: 5000 })
    take(g)
    doHire(g, 'ann', 'pay')
    doBorrow(g, 'net')
    const lent = job(g).aux.net![0]!.actor
    doGo(g)
    g.state.actors.ann!.conditions.push({ id: 'injured' })
    endStub(g, 'done', { rating: 'B' })
    expect(isBusy(g, 'ann')).toBe(false)
    expect(g.state.actors.ann!.conditions.map((c) => c.id)).toEqual(['injured'])
    expect(g.state.actors[lent]).toBeUndefined()
    expect(aff(g, 'ann')).toBe(2)
  })

  it('入帳那一份報告是 fixer.payout（kind gig），接在副本結束的報告後面；手上那一件標成做完', () => {
    const g = setup()
    take(g)
    doGo(g)
    const reports = endStub(g, 'done', { rating: 'A' })
    expect(reports.map((r) => r.action)).toEqual(['stub.end', 'fixer.payout'])
    expect(payout(reports).kind).toBe('gig')
    expect(job(g).status).toBe('done')
    expect(reports[0]!.changes.some((c) => c.op === 'fixer.status')).toBe(true)
  })
})

// ===================================================================================================================
// 失敗與撤退
// ===================================================================================================================

describe('失敗：沒有報酬、信譽 −3、busy 拿掉；已經付的出場費不退', () => {
  it('失敗：沒有錢進來、信譽 −3（不低於 0）、請的人放掉、已經付的出場費不退', () => {
    const g = setup({ party: ['pf'], cash: 2000 })
    take(g)
    setRep(g, 10)
    doHire(g, 'ann', 'pay')
    doBorrow(g, 'net')
    const lent = job(g).aux.net![0]!.actor
    expect(cash(g)).toBe(2000 - 400 - 1200)
    doGo(g)
    const before = cash(g)
    const reports = endStub(g, 'failed', { rating: 'C' })
    expect(payout(reports).outcome.result).toBe('failed')
    expect(cash(g)).toBe(before)
    expect(rep(g)).toBe(7)
    expect(isBusy(g, 'ann')).toBe(false)
    expect(g.state.actors[lent]).toBeUndefined()
    expect(job(g).status).toBe('failed')
    expect(aff(g, 'pf')).toBe(0)
    expect(loy(g, 'ann')).toBe(30)
    expect(payout(reports).narration?.results).toContain('已經付出去的出場費不退。')
    // 信譽從 0 起不會變成負的
    const h = setup()
    take(h)
    doGo(h)
    endStub(h, 'failed')
    expect(rep(h)).toBe(0)
  })
})

describe('撤退：請的人與付的錢都回去', () => {
  it('撤退之後付出去的出場費回來了、人也不再是 busy、借來的人不見、aux 清空；用掉的人情不退', () => {
    const g = setup({ cash: 5000 })
    take(g)
    give(g, 'owed_to_pc', 'bob', 'small')
    const cash0 = cash(g)
    doHire(g, 'ann', 'pay')
    doHire(g, 'bob', 'use_favor')
    doHire(g, 'dee', 'owe_favor', 'net')
    doBorrow(g, 'opinion')
    const lent = job(g).aux.opinion![0]!.actor
    expect(cash(g)).toBe(cash0 - 400 - 1200)
    doGo(g)
    expect(g.state.actors[lent]).toBeDefined()
    retreatStub(g)
    expect(g.state.ext.cm_stub).toBeUndefined()
    expect(cash(g)).toBe(cash0)
    for (const id of ['ann', 'bob', 'dee']) expect(isBusy(g, id)).toBe(false)
    expect(g.state.actors[lent]).toBeUndefined()
    expect(job(g)).toMatchObject({ status: 'active', aux: {} })
    expect(favorsOf(g.state).owed_to_pc).toEqual([]) // 用掉的人情不退
    expect(favorsOf(g.state).owed_by_pc).toEqual([]) // 欠下的人情取消
    expect(readFixer(g.state).pending).toEqual([])
    expect(rep(g)).toBe(0)
    // 回來之後可以重新請人、再出發
    doHire(g, 'ann', 'pay')
    expect(() => doGo(g)).not.toThrow()
  })

  it('撤退不走失敗：信譽不動、沒有報酬、委託還在手上', () => {
    const g = setup()
    take(g)
    setRep(g, 20)
    doHire(g, 'ann', 'pay')
    doGo(g)
    const reports = retreatStub(g)
    expect(reports.some((r) => r.action === 'fixer.payout')).toBe(false)
    expect(rep(g)).toBe(20)
    expect(job(g).status).toBe('active')
    expect(job(g).payout).toBeNull()
  })

  it('沒請人的撤退不多出變更', () => {
    const g = setup()
    take(g)
    doGo(g)
    const cash0 = cash(g)
    retreatStub(g)
    expect(cash(g)).toBe(cash0)
    expect(job(g).aux).toEqual({})
  })
})

// ===================================================================================================================
// 規則、格式與其他
// ===================================================================================================================

describe('規則 fixer_rule', () => {
  it('預設值照規格（G16、COMMISSIONS 6.5、NPC_SYSTEM 10.5）', () => {
    expect(DEFAULT_FIXER_RULES).toMatchObject({
      rating_bonus: { S: 0.2, A: 0.1, B: 0, C: -0.1 }, rep_same: 2, rep_higher: 4, rep_lower: 0, rep_top: 1, rep_failed: -3, rep_abandon: -5, rep_abandon_early: -2, borrow_base: 200, borrow_mult: 1.5, boss_shares: 2, aux_max: 2, bond_dc_base: 20, bond_affinity_step: 5, bond_loyalty: 70,
      trip_affinity: 2, trip_loyalty: 2,
    })
  })

  it('資料蓋掉預設：評價加成、信譽、借人倍率、老闆份數、每一面幾個人、親密度與忠誠', () => {
    const rule = { id: 'default', rating_bonus: { S: 0.5 }, rep_higher: 5, rep_top: 0, rep_failed: -7, borrow_mult: 2, boss_shares: 3, aux_max: 1, trip_affinity: 4, trip_loyalty: 6 }
    const g = setup({ content: [PACK, { id: 'rules', content: { fixer_rule: [rule] } }], party: ['ps'], cash: 5000 })
    expect(fixerRules(g.k)).toMatchObject({ rep_higher: 5, rep_top: 0, rep_failed: -7, borrow_mult: 2, boss_shares: 3, aux_max: 1, rating_bonus: { S: 0.5, A: 0.1, B: 0, C: -0.1 } })
    take(g)
    expect(borrowPrice(g.k, job(g))).toBe(1600)
    expect(splitPreview(g.k, g.state, job(g), 'S')).toMatchObject({ reward: 3000, shares: 4 })
    doHire(g, 'ann', 'pay')
    expect(hireBlocks(g.k, g.state, job(g), 'meat', 'bob')).toEqual([expect.stringMatching(/最多 1 個/)])
    doGo(g)
    endStub(g, 'done', { rating: 'S' })
    expect(rep(g)).toBe(5)
    expect(aff(g, 'ps')).toBe(4)
    expect(loy(g, 'ps')).toBe(36)
    const h = setup({ content: [PACK, { id: 'rules', content: { fixer_rule: [rule] } }] })
    take(h)
    doGo(h)
    endStub(h, 'failed')
    expect(rep(h)).toBe(0)
    setRep(h, 20)
    expect(rep(h)).toBe(20)
  })

  it('格式不對的欄位忽略並報問題', () => {
    expect(ruleProblems({ rep_same: 'x' })).toEqual([expect.stringMatching(/^rep_same /)])
    expect(ruleProblems({ rating_bonus: { Z: 1 } })).toEqual([expect.stringMatching(/^rating_bonus\.Z/)])
    expect(ruleProblems({ rating_bonus: { S: 'x' } })).toEqual([expect.stringMatching(/^rating_bonus\.S /)])
    expect(ruleProblems({ rating_bonus: 3 })).toEqual([expect.stringMatching(/^rating_bonus /)])
    expect(ruleProblems({ aux_max: 3, boss_shares: 0 })).toHaveLength(2)
    expect(ruleProblems({ rep_same: 3, rating_bonus: { S: 0.3 }, borrow_mult: 2.5 })).toEqual([])
    expect(() => setup({ content: [PACK, { id: 'bad', content: { fixer_rule: [{ id: 'default', aux_max: 9 }] } }] })).toThrow(/aux_max/)
  })
})

describe('不變式、存檔與舊檔', () => {
  it('請人、退人、借人、出發、入帳、撤退都不違反不變式', async () => {
    const g = setup({ cash: 5000, party: ['pf'] })
    take(g)
    give(g, 'owed_to_pc', 'bob', 'small')
    const run = async (fn: () => unknown) => expect((await observed(g, fn as never)).violations).toEqual([])
    await run(() => doHire(g, 'ann', 'pay'))
    await run(() => doHire(g, 'bob', 'use_favor'))
    await run(() => doHire(g, 'dee', 'owe_favor', 'net'))
    await run(() => doBorrow(g, 'opinion'))
    await run(() => g.commit(unhire(g.k, g.state, 'o_big', 'dee')))
    await run(() => doGo(g))
    await run(() => retreatStub(g))
    await run(() => doGo(g))
    await run(() => endStub(g, 'done', { rating: 'A' }))
  })

  it('存檔讀回來，請的人、借來的臨時角色、靠交情失敗的記號都在', () => {
    const g = setup({ cash: 5000 })
    take(g)
    findNatural(g, bondPurpose('o_big', 'bob'), 4)
    doHire(g, 'bob', 'bond')
    doHire(g, 'ann', 'pay')
    doBorrow(g, 'net')
    const text = g.save('manual', 'now')
    const h = setup({ cash: 5000 })
    expect(h.load(text)).toBeNull()
    expect(readFixer(h.state)).toEqual(readFixer(g.state))
    expect(job(h)).toMatchObject({ bond_failed: ['bob'], borrow_n: 1 })
    expect(Object.keys(job(h).aux).sort()).toEqual(['meat', 'net'])
  })

  it('M2-fixer 時存下的手上委託（沒有 aux 等欄位）讀進來補上預設值', () => {
    const g = setup()
    take(g)
    const raw = g.state.ext.fixer as { jobs: Rec[] }
    delete raw.jobs[0]!.aux
    delete raw.jobs[0]!.bond_failed
    delete raw.jobs[0]!.borrow_n
    delete raw.jobs[0]!.payout
    expect(job(g)).toMatchObject({ aux: {}, bond_failed: [], borrow_n: 0, payout: null })
    expect(() => doHire(g, 'ann', 'pay')).not.toThrow()
  })

  it('等著結算的事（pending）不留在提交之後：做完之後清掉', () => {
    const g = setup()
    take(g)
    doGo(g)
    endStub(g, 'done', { rating: 'B' })
    expect(readFixer(g.state).pending).toEqual([])
    expect(job(g).payout).not.toBeNull()
  })
})

// ===================================================================================================================
// 接上真的 commission（整合）：fixer.go 開副本、輔助面真的擲、做完與撤退真的走 activity.end
// ===================================================================================================================

describe('接上真的 commission 功能', () => {
  /** 只有內海面與輿論面的三階段假副本（內海是主面；內海的玩法用替身活動，輿論面只能派人去）。 */
  const REAL_DEF = {
    id: 'cm_real', name: '整合用的副本', kind: 'steal_data', main: 'net', scale: 'small', grade: 1, target_faction: 'hizakura', district: 'glass_shore', links: {},
    stages: [
      { name: '一', faces: { net: { layer: 'guest', encounter: [], branches: [{ id: 'assault', kind: 'assault' }] }, opinion: { encounter: [], branches: [{ id: 'assault', kind: 'assault' }] } } },
      { name: '二', faces: { net: { layer: 'guest', encounter: [], branches: [{ id: 'assault', kind: 'assault' }] }, opinion: { encounter: [], branches: [{ id: 'assault', kind: 'assault' }] } } },
      { name: '三', faces: { net: { layer: 'guest', encounter: [], branches: [{ id: 'assault', kind: 'assault' }] } } },
    ],
  }
  const REAL_PROVIDER: Feature = {
    id: 'test_real_offers',
    install(k: Kernel) {
      k.hooks.on('fixer.offers', 'test_real_offers', ({ fixer }) => (fixer.id === 'fx_a' ? [offerOf('o_real', REAL_DEF, 2000)] : undefined))
    },
  }
  /** 內海面玩法的替身：只是登記這種活動，由測試自己送出結束（照 M2-commission-run 的做法）。 */
  const FAKE_NET: Feature = {
    id: 'fake_net',
    install(k: Kernel) {
      k.activity.define({
        kind: 'face.net', owner: 'fake_net', order: 50,
        active: (s) => (isRecord(s.ext.fake_net) ? { id: 'face.net', label: '內海' } : null),
        allow: ['commit:fake_net.'], reason: () => '替身活動開著。',
        start: (_k, _state, setup, origin) => [{
          kind: 'event', action: 'fake_net.open', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'fake_net', value: { setup, origin } }], outcome: { result: 'open', summary: '內海開了。' },
        }],
      })
      k.activity.allow('commission', 'face.net.start', 'fake_net')
      k.activity.allow('commission', 'commit:fake_net.', 'fake_net')
    },
  }
  function setupReal(o: { cash?: number } = {}): G {
    for (const k of Object.keys(FEES)) delete FEES[k]
    Object.assign(FEES, FEE_TABLE)
    ROSTER.clear()
    for (const id of ['ann', 'bob', 'dee', 'cy']) ROSTER.add(id)
    return makeGame({
      features: [fixerFeature, REAL_PROVIDER, commissionFeature, FAKE_NET, ROSTER_STUB, favorsFeature, METERS], content: [PACK], pc: PC as never,
      actors: ACTORS.filter((a) => a.role !== 'companion'), patch: { money: { cred: 0, cash: o.cash ?? 5000 } },
    }).game
  }
  function endNet(g: G): Report[] {
    const open = g.state.ext.fake_net as { origin: never }
    const end = endActivity(g.k, { state: g.state, kind: 'face.net', id: 'face.net', origin: open.origin, outcome: 'done', result: {} })
    return g.commit({ kind: 'event', action: 'fake_net.close', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'fake_net', value: null }, ...end.changes], outcome: { result: 'done', summary: '內海結束。' } })
  }
  /** 三個階段都打內海（輔助面輿論由派去的人擲）。 */
  function playAll(g: G): Report[] {
    const all: Report[] = []
    for (let i = 0; i < 3; i++) {
      all.push(...g.commit(chooseFace(g.k, g.state, 'net')))
      all.push(...g.commit(chooseBranch(g.k, g.state, 'assault')))
      all.push(...endNet(g))
    }
    return all
  }

  it('出發帶著 aux；做完之後入帳（真的 activity.end、評價由 commission 給）；請的人放掉、借來的人移除', () => {
    const g = setupReal()
    take(g, 'o_real')
    doHire(g, 'ann', 'pay', 'opinion', 'o_real')
    doBorrow(g, 'opinion', 'o_real')
    const lent = job(g, 'o_real').aux.opinion![1]!.actor
    const cash0 = cash(g)
    expect(cash0).toBe(5000 - 400 - 300)
    doGo(g, 'o_real')
    expect(g.state.actors.ann!.conditions.some((c) => c.id === 'busy')).toBe(true)
    const reports = playAll(g)
    const p = payout(reports)
    expect(p).toBeDefined()
    expect(reports.map((r) => r.action).slice(-3)).toEqual(['commission.milestone', 'commission.finish', 'fixer.payout'])
    expect(job(g, 'o_real').status).toBe('done')
    const rating = job(g, 'o_real').payout!.rating
    expect(['S', 'A', 'B', 'C']).toContain(rating)
    // 付錢請的 ann 出場費已經預付：入帳時主角拿（報酬 − 抽成）：沒有別人分
    const reward = job(g, 'o_real').payout!.reward
    expect(cash(g)).toBe(cash0 + reward - Math.round(reward * 0.1))
    expect(rep(g)).toBe(2)
    expect(job(g, 'o_real').payout!.rep).toEqual({ from: 0, to: 2 }) // 入帳記下信譽實際的變化（畫面的結算讀它）
    expect(aff(g, 'ann')).toBe(2)
    expect(loy(g, 'ann')).toBe(32)
    expect(g.state.actors.ann!.conditions.some((c) => c.id === 'busy')).toBe(false)
    expect(g.state.actors[lent]).toBeUndefined()
    expect(readFixer(g.state).pending).toEqual([])
  })

  it('撤退（真的 commission.retreat 帶 rewind）：付出去的錢回來、busy 拿掉、借來的人移除、委託還在手上', () => {
    const g = setupReal()
    take(g, 'o_real')
    doHire(g, 'ann', 'pay', 'opinion', 'o_real')
    doBorrow(g, 'opinion', 'o_real')
    const lent = job(g, 'o_real').aux.opinion![1]!.actor
    doGo(g, 'o_real')
    g.commit(chooseFace(g.k, g.state, 'net'))
    const reports = g.commit(retreat(g.k, g.state))
    expect(reports.some((r) => r.action === 'fixer.payout')).toBe(false)
    expect(cash(g)).toBe(5000)
    expect(g.state.actors.ann!.conditions.some((c) => c.id === 'busy')).toBe(false)
    expect(g.state.actors[lent]).toBeUndefined()
    expect(job(g, 'o_real')).toMatchObject({ status: 'active', aux: {}, payout: null })
    expect(rep(g)).toBe(0)
    expect(g.state.ext.commission).toBeUndefined()
  })

  it('撤退之後才放棄算出發後（真的 commission.retreat：快照回到進副本之前，出發過的記號還在）', () => {
    const g = setupReal()
    setRep(g, 20)
    take(g, 'o_real')
    doGo(g, 'o_real')
    g.commit(chooseFace(g.k, g.state, 'net'))
    g.commit(retreat(g.k, g.state))
    expect(job(g, 'o_real')).toMatchObject({ status: 'active', departed: true })
    expect(rep(g)).toBe(20)
    g.commit(drop(g.k, g.state, 'o_real'))
    expect(rep(g)).toBe(15)
  })
})

// ===================================================================================================================
// 街頭信譽新規則（CORE_RULES 8.1、LIFE 1.3 與第 9 節；2026-11-23 使用者定案；M2-fix-bugs）
// ===================================================================================================================

describe('街頭信譽：完成委託看委託的級和主角的級', () => {
  /** 主角的級：無名、熟面孔 I；有號 II；搶手 III（rep 0 → 35 → 55）。o_small 是 I、o_big 是 II、o_large 是 III。 */
  const finish = (rating: 'S' | 'A' | 'B' | 'C', jobId: string, rep0: number): number => {
    const g = setup()
    if (rep0 > 0) setRep(g, rep0)
    take(g, jobId)
    doGo(g, jobId)
    endStub(g, 'done', { rating })
    return rep(g) - rep0
  }

  it('同級 +2，評價 S 再 +1（無名主角做 I 級、有號做 II 級、搶手做 III 級）', () => {
    expect(finish('B', 'o_small', 0)).toBe(2)
    expect(finish('S', 'o_small', 0)).toBe(3)
    expect(finish('A', 'o_small', 10)).toBe(2) // 熟面孔以下都是 I 級
    expect(finish('B', 'o_big', 35)).toBe(2)
    expect(finish('S', 'o_big', 35)).toBe(3)
    expect(finish('B', 'o_large', 55)).toBe(2)
  })

  it('高一級以上 +4，評價 S 也再 +1', () => {
    expect(finish('B', 'o_big', 0)).toBe(4) // II 級對 I 級主角
    expect(finish('S', 'o_big', 0)).toBe(5)
    expect(finish('B', 'o_large', 0)).toBe(4) // 高兩級也是 +4，不是更多
    expect(finish('C', 'o_large', 35)).toBe(4) // III 級對 II 級主角
  })

  it('比主角低級的委託信譽不變（S 也一樣）；錢照給', () => {
    expect(finish('B', 'o_small', 35)).toBe(0)
    expect(finish('S', 'o_small', 55)).toBe(0)
    expect(finish('S', 'o_big', 55)).toBe(0)
    const g = setup()
    setRep(g, 35)
    take(g, 'o_small')
    doGo(g, 'o_small')
    const cash0 = cash(g)
    const reports = endStub(g, 'done', { rating: 'S' })
    expect(cash(g)).toBeGreaterThan(cash0)
    expect(payout(reports).narration?.results?.join('')).not.toMatch(/街頭信譽/)
  })

  it('委託的結算可以讓人升階（不受非委託來源「不能跨階」的夾值管）：34 做同級 +2 → 36（有號）', () => {
    const g = setup()
    setRep(g, 34)
    take(g, 'o_small') // 熟面孔（I 級）做 I 級
    doGo(g, 'o_small')
    endStub(g, 'done', { rating: 'B' })
    expect(rep(g)).toBe(36)
    expect(g.k.stats.stat(g.state, 'pc', 'rep_grade')).toBe(2)
  })

  it('失敗 −3，不分等級；信譽不會掉到 0 以下', () => {
    for (const [jobId, rep0] of [['o_small', 40], ['o_big', 0], ['o_large', 80]] as const) {
      const g = setup()
      if (rep0 > 0) setRep(g, rep0)
      take(g, jobId)
      doGo(g, jobId)
      endStub(g, 'failed')
      expect(rep(g), jobId).toBe(Math.max(0, rep0 - 3))
    }
  })

  it('預告：repGainOf 和入帳用同一份算法（relation、amount、top）', () => {
    const g = setup()
    setRep(g, 35)
    take(g, 'o_small')
    take(g, 'o_big')
    take(g, 'o_large')
    expect(repGainOf(g.k, g.state, job(g, 'o_small'), 'S')).toEqual({ relation: 'lower', amount: 0, top: false })
    expect(repGainOf(g.k, g.state, job(g, 'o_big'), 'S')).toEqual({ relation: 'same', amount: 3, top: true })
    expect(repGainOf(g.k, g.state, job(g, 'o_large'), 'B')).toEqual({ relation: 'higher', amount: 4, top: false })
  })

  it('規則表可以換數字：同級、高一級、低級、S 的加成、失敗、放棄', () => {
    const rule = { id: 'default', rep_same: 1, rep_higher: 6, rep_lower: 1, rep_top: 2, rep_failed: -1, rep_abandon: -9, rep_abandon_early: -4 }
    const g = setup({ content: [PACK, { id: 'rules', content: { fixer_rule: [rule] } }] })
    setRep(g, 35)
    take(g, 'o_small')
    take(g, 'o_big')
    take(g, 'o_large')
    expect(repGainOf(g.k, g.state, job(g, 'o_small'), 'S').amount).toBe(1) // 低級：rep_lower，S 不加
    expect(repGainOf(g.k, g.state, job(g, 'o_big'), 'S').amount).toBe(3)
    expect(repGainOf(g.k, g.state, job(g, 'o_large'), 'S').amount).toBe(8)
    g.commit(drop(g.k, g.state, 'o_small'))
    expect(rep(g)).toBe(31) // 還沒出發：rep_abandon_early（−4）
    doGo(g, 'o_big')
    retreatStub(g)
    g.commit(drop(g.k, g.state, 'o_big'))
    expect(rep(g)).toBe(22) // 出發過：rep_abandon（−9）
  })
})

describe('放棄手上的委託：街頭信譽 出發前 −2、出發後 −5（LIFE 第 9 節；使用者 2026-11-24 裁決）', () => {
  it('出發前放棄：從手上拿掉、中間人今天不再給這一件、信譽 −2；結果寫在報告裡', () => {
    const g = setup()
    setRep(g, 20)
    take(g, 'o_small')
    expect(job(g, 'o_small').departed).toBeUndefined()
    expect(abandonRepOf(g.k, job(g, 'o_small'))).toBe(-2)
    const reports = g.commit(drop(g.k, g.state, 'o_small'))
    expect(rep(g)).toBe(18)
    expect(jobOf(g.state, 'o_small')).toBeNull()
    expect(reports[0]!.narration?.results?.join('')).toContain('街頭信譽')
  })

  it('出發後放棄（出發之後、副本還沒結束就回到手上的情況見下一條）：go 記下出發過了，之後放棄 −5', () => {
    const g = setup()
    setRep(g, 20)
    take(g, 'o_small')
    doGo(g, 'o_small')
    expect(job(g, 'o_small').departed).toBe(true)
    expect(abandonRepOf(g.k, job(g, 'o_small'))).toBe(-5)
    // 副本進行中放棄被活動擋掉；做完前沒有別的路，這裡用替身撤退回到手上
    retreatStub(g)
    expect(job(g, 'o_small')).toMatchObject({ status: 'active', departed: true })
    g.commit(drop(g.k, g.state, 'o_small'))
    expect(rep(g)).toBe(15)
  })

  it('規則表兩個數字各自管各自的；舊存檔的委託沒有 departed 當成沒出發', () => {
    const g = setup({ content: [PACK, { id: 'rules', content: { fixer_rule: [{ id: 'default', rep_abandon: -7, rep_abandon_early: -1 }] } }] })
    setRep(g, 30)
    take(g, 'o_small')
    expect(abandonRepOf(g.k, job(g, 'o_small'))).toBe(-1)
    expect(abandonRepOf(g.k, { ...job(g, 'o_small'), departed: true })).toBe(-7)
    g.commit(drop(g.k, g.state, 'o_small'))
    expect(rep(g)).toBe(29)
  })

  it('信譽 0 放棄不會變負的；出發後放棄比失敗（−3）更糟、出發前放棄比失敗輕', () => {
    const g = setup()
    take(g, 'o_small')
    g.commit(drop(g.k, g.state, 'o_small'))
    expect(rep(g)).toBe(0)
    const a = setup()
    setRep(a, 30)
    take(a, 'o_small')
    a.commit(drop(a.k, a.state, 'o_small'))
    const f = setup()
    setRep(f, 30)
    take(f, 'o_small')
    doGo(f, 'o_small')
    endStub(f, 'failed')
    expect(rep(a)).toBeGreaterThan(rep(f))
    const late = setup()
    setRep(late, 30)
    take(late, 'o_small')
    doGo(late, 'o_small')
    retreatStub(late)
    late.commit(drop(late.k, late.state, 'o_small'))
    expect(rep(late)).toBeLessThan(rep(f))
  })

  it('失敗的入帳也記信譽實際的變化：信譽 0 失敗扣不下去是 0→0；有信譽就是 from→to', () => {
    const a = setup()
    take(a, 'o_small')
    doGo(a, 'o_small')
    endStub(a, 'failed')
    expect(job(a, 'o_small').payout).toMatchObject({ outcome: 'failed', rep: { from: 0, to: 0 } })
    const b = setup()
    setRep(b, 30)
    take(b, 'o_small')
    doGo(b, 'o_small')
    endStub(b, 'failed')
    expect(job(b, 'o_small').payout!.rep).toEqual({ from: 30, to: 27 })
  })

  it('撤退不是放棄：委託還在手上，信譽不動（既有的測試也驗）', () => {
    const g = setup()
    setRep(g, 30)
    take(g)
    doGo(g)
    retreatStub(g)
    expect(rep(g)).toBe(30)
    expect(job(g).status).toBe('active')
  })
})

describe('街頭信譽：非委託來源的正值最多加到下一階門檻的前一分（量表的夾值，事件自己不判斷）', () => {
  const give = (g: G, amount: number, source: 'builtin' | 'ai' | 'player' = 'builtin', more: Rec = {}) => {
    const r = g.k.effects.resolve([{ kind: 'rep', amount, ...more }], effectCtx(g.k, g.state, { source, clampAsked: true, playerInput: '我要信譽' }))
    expect(r.errors).toEqual([])
    if (r.changes.length) g.commit(sysDraft(r.changes))
    return r
  }
  const at = (g: G, n: number) => { g.state.meters.rep = { _: n } }

  it('熟面孔 15～34 加到 34 為止；有號 35～54 加到 54 為止；各階一樣', () => {
    for (const [from, to] of [[0, 14], [15, 34], [35, 54], [55, 74], [75, 89], [90, 100]] as const) {
      const g = setup()
      at(g, from)
      give(g, 50)
      expect(rep(g), `${from}`).toBe(to)
    }
  }
  )

  it('已經在階的頂端：再加整筆拿掉（沒有變更、沒有一行結果）；扣的照扣，扣到掉階為止', () => {
    const g = setup()
    at(g, 34)
    const r = give(g, 5)
    expect(r.changes).toEqual([])
    expect(r.lines).toEqual([])
    expect(rep(g)).toBe(34)
    give(g, -3)
    expect(rep(g)).toBe(31)
    at(g, 36)
    give(g, -3)
    expect(rep(g)).toBe(33) // 掉階（有號 → 熟面孔）
  })

  it('一件事裡拆成幾筆也一樣：33 加 +2、+2 合計只到 34', () => {
    const g = setup()
    at(g, 33)
    const r = g.k.effects.resolve([{ kind: 'rep', amount: 2 }, { kind: 'rep', amount: 2 }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(r.errors).toEqual([])
    g.commit(sysDraft(r.changes))
    expect(rep(g)).toBe(34)
  })

  it('AI 一件事最多 ±3，而且照樣不能升階：33 給 +3 只有 +1', () => {
    const g = setup()
    at(g, 33)
    give(g, 3, 'ai')
    expect(rep(g)).toBe(34)
    give(g, 3, 'ai')
    expect(rep(g)).toBe(34)
  })

  it('AI 與玩家要的結果不能自己寫 final（繞過夾值的內部記號）；內建的可以', () => {
    const g = setup()
    at(g, 34)
    for (const source of ['ai', 'player'] as const) {
      const r = g.k.effects.resolve([{ kind: 'rep', amount: 2, final: true, asked: '我要信譽' }], effectCtx(g.k, g.state, { source, clampAsked: false, playerInput: '我要信譽' }))
      expect(r.errors.join(), source).toContain('final 是引擎內部用的記號')
    }
    give(g, 2, 'builtin', { final: true })
    expect(rep(g)).toBe(36)
  })

  it('玩家明說要、而且設定「玩家要求的結果也夾值」關著的（刻意作弊）不受這條管', () => {
    const g = setup()
    at(g, 34)
    const r = g.k.effects.resolve([{ kind: 'rep', amount: 5, asked: '我要信譽' }], effectCtx(g.k, g.state, { source: 'player', clampAsked: false, playerInput: '我要信譽' }))
    g.commit(sysDraft(r.changes))
    expect(rep(g)).toBe(39)
  })
})
