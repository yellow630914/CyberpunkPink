// 驗收測試：dev/work/M2-fixer.md（cpp-feature）。中間人手上的委託、簡報、怎麼付、那一輪交涉、接案；未知清單與踩點；走到地點、帶著踩到的東西進副本；街頭信譽。
// 規格：FIXER 第 1、2 節（含「踩點的規則」）；COMMISSIONS 2.3 節「分支」、第 4 節；LIFE 1.1 節；CORE_RULES 第 8 節；UI 7.1、7.2 節；dev/adr/0016 第一、三節與 G18。
// 內容一律是測試自帶的最小假資料：委託用測試掛在 fixer.offers 上的假副本；副本本體用替身活動（commission）；人情與敵對值用真的 favors 或測試裝的量表。
// 骰面：測試把存檔的亂數游標撥到想要的骰面（findNatural），再提交，所以每一條結果都是固定的。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, attachActivityEnd, deriveRng, effectCtx, endActivity, isRecord, meterOf, toMinutes } from '../../src'
import { favorsFeature, favorsOf } from '../../src/features/favors'
import {
  DEFAULT_FIXER_RULES, LOCKED_METHODS, SCOUT_METHODS, accept, board, briefOf, buyIntel, drop, fixerFeature, fixerRules, go, haggle, haggledPurpose, intelOptions, jobOf, jobsOf, latestJob,
  offerProblems, payOptions, readFixer, scout, scoutPurpose, scoutView, scoutedOf, tableOf,
} from '../../src/features/fixer'
import type { Offer } from '../../src/features/fixer'
import { makeGame, meterFeature, observed, testMeter } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['stealth', 'investigate', 'streetwise', 'negotiate', 'interface', 'seduce', 'perform'].map((id) => ({ id, name: id, attr: id === 'stealth' ? 'reflex' : id === 'interface' || id === 'investigate' || id === 'streetwise' ? 'intellect' : 'charm', desc: `${id}。` }))

const PACK: ContentPack = {
  id: 'm2_fixer',
  content: {
    skill: SKILLS,
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'nora', name: '諾拉', short: '諾拉', class: 'corp' }],
    npc: [{ id: 'npc_mama', name: '媽媽桑' }, { id: 'npc_boss', name: '老闆' }],
    fixer: [
      { id: 'fx_a', name: '半夢的媽媽桑', npc: 'npc_mama', district: 'glass_shore', block: 'blk_shop', kinds: ['steal_item'], cut: 0.1 },
      { id: 'fx_b', name: '不輕易見客的老闆', npc: 'npc_boss', district: 'glass_shore', kinds: ['steal_item'], cut: 0.15, min_rep: 55 },
    ],
  },
}

const faces = (names: string[]): Rec => Object.fromEntries(names.map((f) => [f, {}]))
const commission = (id: string, scale: 'small' | 'medium' | 'large', grade: number, extra: Rec = {}): Rec => {
  const n = { small: 3, medium: 4, large: 5 }[scale]
  return {
    id, name: `委託 ${id}`, kind: 'steal_item', main: 'meat', scale, grade, target_faction: 'hizakura', district: 'glass_shore', block: 'blk_dock', conditions: ['no_kill'],
    stages: Array.from({ length: n }, (_, i) => ({ name: `階段${i + 1}`, faces: i === n - 1 ? faces(['meat']) : i === 0 ? faces(['meat', 'net']) : faces(['meat', 'opinion']) })),
    ...extra,
  }
}

/** 七項未知：路、守備、階段、蕾絲、目標、雇主、詞條各一（清單的順序就是揭開的順序）。 */
const UNKNOWNS = [
  { id: 'u_path', cat: 'path', text: '後門的班表有空檔', reveal: { branch: 'back_door' } },
  { id: 'u_guard', cat: 'guard', text: '第三階段守備有四個人', reveal: { guards: 3 } },
  { id: 'u_stage', cat: 'stage', text: '第二階段可以選輿論面', reveal: { stage: 2 } },
  { id: 'u_lace', cat: 'lace', text: '蕾絲是粉色的', reveal: { flag: 'lace_pink' } },
  { id: 'u_target', cat: 'target', text: '目標夜裡才回家', reveal: { flag: 'target_night' } },
  { id: 'u_employer', cat: 'employer', text: '雇主打算事後翻臉', reveal: { flag: 'employer_backstab' } },
  { id: 'u_mod', cat: 'modifier', text: '今晚有派對', reveal: { modifier: 'party' } },
]

const offerOf = (id: string, c: Rec, reward: number, extra: Rec = {}): Offer => ({ id, commission: c, title: `${id} 的委託`, brief: `簡報：${id}。`, reward, unknowns: UNKNOWNS, ...extra }) as unknown as Offer
const OFFERS: Offer[] = [
  offerOf('o_small', commission('cm_small', 'small', 1), 1000),
  offerOf('o_mid', commission('cm_mid', 'medium', 2), 2000),
  offerOf('o_large', commission('cm_large', 'large', 3), 3000),
  offerOf('o_gated', commission('cm_gated', 'small', 1), 1500, { min_rep: 35 }),
]

/** fixer.offers 的測試回答者：fx_a 有四件（同一天回答一樣的）；紀錄每一次被問的中間人與日子。 */
const CALLS: Array<{ fixer: string; day: number }> = []
const PROVIDER: Feature = {
  id: 'test_offers',
  install(k: Kernel) {
    k.hooks.on('fixer.offers', 'test_offers', ({ fixer, day }) => {
      CALLS.push({ fixer: fixer.id, day })
      return fixer.id === 'fx_a' ? structuredClone(OFFERS) : undefined
    })
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

/** 條件 in_block 的替身（world 的功能不 import）。 */
const IN_BLOCK: Feature = {
  id: 'test_in_block',
  install(k: Kernel) {
    k.conditions.register<{ kind: string; blocks: string[] }>({
      kind: 'in_block', owner: 'test_in_block',
      validate: () => [],
      test: (c, { state }) => !!state.location.block && c.blocks.includes(state.location.block),
    })
  },
}

const HOSTILITY = meterFeature(testMeter({ kind: 'hostility', owner: 'test_security', name: '敵對值', keyed: 'faction', min: 0, max: 100, start: 0, cap: { down: 10, up: 10 } }))

const PC = {
  attrs: { reflex: 14, charm: 14, intellect: 14 },
  skills: { stealth: 3, negotiate: 3, interface: 3, streetwise: 3, perform: 3, seduce: 3 },
}

type G = ReturnType<typeof makeGame>['game']
interface Opts { features?: Feature[]; content?: ContentPack[]; cash?: number }
function setup(o: Opts = {}): G {
  CALLS.length = 0
  return makeGame({
    features: [fixerFeature, PROVIDER, STUB, ...(o.features ?? [])], content: o.content ?? [PACK], pc: PC as never,
    ...(o.cash !== undefined ? { patch: { money: { cred: 0, cash: o.cash } } } : {}),
  }).game
}

// ---- 小工具 ----

const sysDraft = (changes: ReportDraft['changes'], action = 'test.setup'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const setRep = (g: G, n: number): void => {
  const r = g.k.effects.resolve([{ kind: 'rep', amount: n, final: true }], effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(r.errors).toEqual([])
  g.commit(sysDraft(r.changes))
}
const rep = (g: G): number => meterOf(g.k, g.state, 'rep')
const minutes = (g: G): number => toMinutes(g.state.time)

/** 把存檔的亂數游標撥到「這個用途擲出想要的骰面」的地方。 */
function findNatural(g: G, purpose: string, want: number): void {
  for (let c = 0; c < 100000; c++) {
    if (deriveRng({ seed: g.state.rng.seed, cursor: c }, purpose, 0).int(1, 20) === want) {
      g.state.rng.cursor = c
      return
    }
  }
  throw new Error(`找不到骰面 ${want}`)
}

const row = (g: G, id = 'o_small', fixer = 'fx_a') => board(g.k, g.state, fixer).offers.find((r) => r.id === id)!
const take = (g: G, id = 'o_small', pay: 'cash' | 'cred' | 'favor' = 'cash'): Report[] => g.commit(accept(g.k, g.state, { id, fixer: 'fx_a' }, { pay }))
const doScout = (g: G, job: string, method: string, natural: number): Report[] => {
  findNatural(g, scoutPurpose(job, jobOf(g.state, job)!.scouts + 1), natural)
  return g.commit(scout(g.k, g.state, job, method))
}
// 骰面對照（小型、等級 I：DC 12，加值 +5）
const CRIT = 14 // 19 ≥ 17：大成功（超過 5 以上）
const OK = 9 // 14：成功
const MISS = 4 // 9：失敗
const ONE = 1 // 自然 1

const give = (g: G, who: string, size: string): void => {
  const r = g.k.effects.resolve([{ kind: 'owed_to_pc', who, size }], effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(r.errors).toEqual([])
  g.commit(sysDraft(r.changes))
}

/** 結束替身副本（發 activity.end，處理函式回傳的東西併進去）。 */
function endStub(g: G, outcome: string, result: Rec = {}): Report[] {
  const st = g.state.ext.cm_stub as { origin: { by: string; ref?: string } }
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: st.origin, outcome, result })
  return g.commit(attachActivityEnd({
    kind: 'gig', action: 'stub.end', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes],
    outcome: { result: outcome, summary: '副本結束。' },
  }, end))
}

// ===================================================================================================================
// 中間人手上的委託
// ===================================================================================================================

describe('board：今天的委託', () => {
  it('問掛點拿（帶中間人與日子）；同一天問幾次一樣；每一件蓋上中間人的 id', () => {
    const g = setup()
    const a = board(g.k, g.state, 'fx_a')
    const b = board(g.k, g.state, 'fx_a')
    expect(a).toEqual(b)
    expect(a.open).toBe(true)
    expect(a.offers.map((r) => r.id)).toEqual(['o_small', 'o_mid', 'o_large', 'o_gated'])
    expect(a.offers.every((r) => r.offer.fixer === 'fx_a' && r.fixer === 'fx_a')).toBe(true)
    expect(CALLS.length).toBeGreaterThanOrEqual(2)
    expect(CALLS.every((c) => c.fixer === 'fx_a' && c.day === g.state.time.day)).toBe(true)
    // 沒有人回答的中間人沒有委託，但肯見你（沒有信譽門檻）
    expect(board(g.k, g.state, 'fx_b').open).toBe(false)
  })

  it('信譽不夠的列出來並帶門檻；接不了並有原因；信譽夠了就能接', () => {
    const g = setup()
    const gated = row(g, 'o_gated')
    expect(gated.min_rep).toBe(35)
    expect(gated.block).toMatch(/35/)
    expect(gated.block).toMatch(/你現在 0/)
    expect(row(g, 'o_small').block).toBeNull()
    expect(() => accept(g.k, g.state, { id: 'o_gated', fixer: 'fx_a' }, { pay: 'cash' })).toThrow(ActionBlocked)
    expect(() => haggle(g.k, g.state, { id: 'o_gated', fixer: 'fx_a' })).toThrow(/35/)
    setRep(g, 35)
    expect(row(g, 'o_gated').block).toBeNull()
    expect(() => take(g, 'o_gated')).not.toThrow()
  })

  it('中間人自己的門檻：信譽不夠時她不肯見你，沒有委託可以看', () => {
    const g = setup()
    const v = board(g.k, g.state, 'fx_b')
    expect(v).toMatchObject({ open: false, offers: [] })
    expect(v.reason).toMatch(/55/)
    expect(() => accept(g.k, g.state, { id: 'o_small', fixer: 'fx_b' }, { pay: 'cash' })).toThrow(/55/)
    setRep(g, 55)
    expect(board(g.k, g.state, 'fx_b').open).toBe(true)
  })

  it('掛點回傳格式不對、id 重複的委託被略過並說明原因，其餘照常', () => {
    const BAD: Feature = {
      id: 'test_bad_offers',
      install(k: Kernel) {
        k.hooks.on('fixer.offers', 'test_bad_offers', ({ fixer }) => (fixer.id === 'fx_a' ? ([{ id: 'o_broken', title: '缺東西' }, structuredClone(OFFERS[0]!)] as never) : undefined))
      },
    }
    const g = setup({ features: [BAD] })
    const v = board(g.k, g.state, 'fx_a')
    expect(v.offers.map((r) => r.id)).toEqual(['o_small', 'o_mid', 'o_large', 'o_gated'])
    expect(v.problems).toHaveLength(2)
    expect(v.problems[0]).toMatch(/第 1 件/)
    expect(v.problems[1]).toMatch(/o_small 重複/)
    expect(offerProblems(OFFERS[0])).toEqual([])
    expect(offerProblems({ ...OFFERS[0], unknowns: [{ id: 'x', cat: 'nope', text: 't', reveal: { stage: 9 } }] }).length).toBeGreaterThan(0)
  })
})

describe('簡報：只看得到最後一個階段', () => {
  it('其餘階段的面是問號（faces 是 null）；說主面、目標、條件', () => {
    const g = setup()
    const b = row(g).brief
    expect(b).toMatchObject({ grade: 1, stages: 3, main: 'meat', main_name: '現實', main_text: '這是一件要動手的委託。', target_faction: 'hizakura', target_name: '緋櫻', conditions: ['no_kill'] })
    expect(b.rows.map((r) => r.known)).toEqual([false, false, true])
    expect(b.rows.map((r) => r.faces)).toEqual([null, null, ['meat']])
    expect(b.rows[2]!.last).toBe(true)
  })

  it('揭開「階段」類的未知之後，那一階段不再是問號（簡報與踩點頁都是）', () => {
    const g = setup({ cash: 1000 })
    take(g)
    g.commit(buyIntel(g.k, g.state, 'o_small', 'u_stage'))
    const v = scoutView(g.k, g.state, 'o_small')
    expect(v.brief.rows.map((r) => r.known)).toEqual([false, true, true])
    expect(v.brief.rows[1]!.faces).toEqual(['meat', 'opinion'])
    expect(v.brief.rows[0]!.faces).toBeNull()
    // 沒接的委託的簡報不會有揭開的階段
    expect(briefOf(g.k, OFFERS[1]!).rows.filter((r) => r.known)).toHaveLength(1)
  })
})

// ===================================================================================================================
// 怎麼付
// ===================================================================================================================

describe('三種付法', () => {
  it('報酬 1,000 → 1,000、850、700；每一種寫出到手的數字與代價；換人情是小人情、記在中間人名下', () => {
    const g = setup({ features: [favorsFeature] })
    const opts = row(g).pay
    expect(opts.map((p) => [p.id, p.amount])).toEqual([['cash', 1000], ['cred', 850], ['favor', 700]])
    expect(opts.map((p) => p.wallet)).toEqual(['cash', 'cred', 'cash'])
    expect(opts[0]!.cost).toMatch(/洗錢/)
    expect(opts[1]!.cost).toMatch(/髒交易/)
    expect(opts[2]).toMatchObject({ favor: { size: 'small', who: 'npc_mama' } })
    expect(opts[2]!.cost).toMatch(/小人情/)
    expect(opts.every((p) => p.block === null)).toBe(true)
  })

  it('大型委託換中人情', () => {
    const g = setup({ features: [favorsFeature] })
    expect(row(g, 'o_large').pay[2]!.favor).toEqual({ size: 'mid', who: 'npc_mama' })
    expect(row(g, 'o_large').pay[2]!.cost).toMatch(/中人情/)
  })

  it('沒有人註冊 owed_to_pc 時沒有第三種；不能選', () => {
    const g = setup()
    expect(g.k.effects.has('owed_to_pc')).toBe(false)
    expect(row(g).pay.map((p) => p.id)).toEqual(['cash', 'cred'])
    expect(() => take(g, 'o_small', 'favor')).toThrow(/沒有開放/)
  })

  it('有人註冊敵對值時，匯進帳戶的代價寫出目標勢力的敵對值 +2；沒有人註冊時只寫留下紀錄', () => {
    const plain = row(setup()).pay[1]!
    expect(plain.hostility).toBeUndefined()
    expect(plain.cost).toBe('留下紀錄：這是一筆髒交易。')
    const g = setup({ features: [HOSTILITY] })
    const cred = row(g).pay[1]!
    expect(cred.hostility).toEqual({ faction: 'hizakura', amount: 2 })
    expect(cred.cost).toMatch(/緋櫻/)
    expect(cred.cost).toMatch(/\+2/)
  })

  it('規則的數字可以用 fixer_rule 蓋掉', () => {
    const over: ContentPack = { id: 'rule', content: { fixer_rule: [{ id: 'default', pay_cred: 0.9, pay_favor: 0.6 }] } }
    const g = setup({ features: [favorsFeature], content: [PACK, over] })
    expect(row(g).pay.map((p) => p.amount)).toEqual([1000, 900, 600])
    expect(fixerRules(g.k)).toMatchObject({ pay_cred: 0.9, pay_favor: 0.6, scout_minutes: DEFAULT_FIXER_RULES.scout_minutes })
    expect(() => setup({ content: [PACK, { id: 'bad', content: { fixer_rule: [{ id: 'default', pay_cred: 2 }] } }] })).toThrow(ContentError)
    expect(payOptions(g.k, { commission: OFFERS[0]!.commission, reward: 1000 }, 'npc_mama').map((p) => p.amount)).toEqual([1000, 900, 600])
  })
})

// ===================================================================================================================
// 那一輪交涉（G18）
// ===================================================================================================================

describe('接案前的那一輪交涉', () => {
  const ref = { id: 'o_small', fixer: 'fx_a' }
  const haggleWith = (g: G, natural: number): Report[] => {
    findNatural(g, haggledPurpose('fx_a', 'o_small'), natural)
    return g.commit(haggle(g.k, g.state, ref))
  }

  it('成功報酬 +5%、大成功 +10%；失敗沒有變化；結果記在桌面上，簡報與付法跟著變', () => {
    const ok = setup({ features: [favorsFeature] })
    haggleWith(ok, 10)
    expect(row(ok).offer.reward).toBe(1050)
    expect(row(ok).haggled).toBe('success')
    expect(row(ok).pay.map((p) => p.amount)).toEqual([1050, 893, 735])
    expect(tableOf(ok.state, 'fx_a').o_small).toMatchObject({ haggle: 'success', reward: 1050 })

    const crit = setup()
    haggleWith(crit, 16)
    expect(row(crit).offer.reward).toBe(1100)
    expect(row(crit).haggled).toBe('critical')

    const fail = setup()
    haggleWith(fail, 6)
    expect(row(fail).offer.reward).toBe(1000)
    expect(row(fail).haggled).toBe('fail')
  })

  it('第二次被擋下（談過就是談過，不管結果）', () => {
    for (const natural of [10, 6]) {
      const g = setup()
      haggleWith(g, natural)
      expect(() => haggle(g.k, g.state, ref)).toThrow(/談過一輪/)
      expect(row(g).haggle_block).toMatch(/談過一輪/)
    }
  })

  it('大失敗：這個中間人今天不再給這一件；隔天又有了；別件不受影響', () => {
    const g = setup()
    haggleWith(g, ONE)
    expect(board(g.k, g.state, 'fx_a').offers.map((r) => r.id)).toEqual(['o_mid', 'o_large', 'o_gated'])
    expect(() => accept(g.k, g.state, ref, { pay: 'cash' })).toThrow(/不在這位中間人手上/)
    g.commit(sysDraft([{ op: 'time', minutes: 24 * 60 }]))
    expect(board(g.k, g.state, 'fx_a').offers.map((r) => r.id)).toContain('o_small')
    expect(row(g).haggled).toBeNull()
  })

  it('交涉的結果進接案的條件；接案之後交涉過的記號帶在手上的委託上', () => {
    const g = setup()
    haggleWith(g, 16)
    take(g, 'o_small', 'cred')
    const job = jobOf(g.state, 'o_small')!
    expect(job.terms).toEqual({ reward: 1100, pay: 'cred', cut: 0.1 })
    expect(job.haggled).toBe('critical')
  })

  it('交涉是一次報告（gig），擲骰記在時間軸上；不花時間', () => {
    const g = setup()
    const t0 = minutes(g)
    const [r] = haggleWith(g, 10)
    expect(r).toMatchObject({ kind: 'gig', action: 'fixer.haggle' })
    expect(r!.timeline[0]!.roll).toMatchObject({ natural: 10, dc: 14, degree: 'success' })
    expect(minutes(g)).toBe(t0)
  })
})

// ===================================================================================================================
// 接案
// ===================================================================================================================

describe('接案', () => {
  it('照選的付法記下條件；委託進了手上、不再在桌上；不能重複接', () => {
    const g = setup({ features: [favorsFeature] })
    const [r] = take(g, 'o_small', 'favor')
    expect(r).toMatchObject({ kind: 'gig', action: 'fixer.accept' })
    const job = jobOf(g.state, 'o_small')!
    expect(job).toMatchObject({ id: 'o_small', fixer: 'fx_a', npc: 'npc_mama', status: 'active', scouts: 0, revealed: [], alert_start: 0, trace_start: 0, haggled: null, seq: 1 })
    expect(job.terms).toEqual({ reward: 1000, pay: 'favor', cut: 0.1 })
    expect(job.commission.id).toBe('cm_small')
    expect(job.unknowns).toHaveLength(7)
    expect(board(g.k, g.state, 'fx_a').offers.map((x) => x.id)).not.toContain('o_small')
    expect(() => take(g, 'o_small')).toThrow(/不在這位中間人手上/)
    // 接案不動錢、不花時間
    expect(g.state.money).toEqual({ cred: 0, cash: g.state.money.cash })
  })

  it('最近接的那一件排最前面；沒有主角、付法不對都擋下', () => {
    const g = setup()
    take(g, 'o_small')
    take(g, 'o_mid', 'cred')
    expect(latestJob(g.state)!.id).toBe('o_mid')
    expect(jobsOf(g.state).map((j) => j.seq)).toEqual([1, 2])
    expect(() => accept(g.k, g.state, { id: 'o_large', fixer: 'fx_a' }, { pay: 'bogus' as never })).toThrow(/付法只能是/)
    expect(() => accept(g.k, g.state, { id: 'o_large' }, { pay: 'cash' })).toThrow(/沒有寫是哪位中間人/)
  })

  it('放棄：從手上拿掉，今天不再給這一件；做完的不能放棄', () => {
    const g = setup()
    take(g)
    g.commit(drop(g.k, g.state, 'o_small'))
    expect(jobOf(g.state, 'o_small')).toBeNull()
    expect(board(g.k, g.state, 'fx_a').offers.map((x) => x.id)).not.toContain('o_small')
    expect(() => drop(g.k, g.state, 'o_small')).toThrow(/沒有 o_small/)
    take(g, 'o_mid')
    g.commit(go(g.k, g.state, 'o_mid'))
    endStub(g, 'done')
    expect(() => drop(g.k, g.state, 'o_mid')).toThrow(/做完/)
  })
})

// ===================================================================================================================
// 踩點
// ===================================================================================================================

describe('踩點：時間、次數、難度', () => {
  it('一次花一個時段（4 小時）；擲的是那個手段的基本功；報告是 gig', () => {
    const g = setup()
    take(g)
    const t0 = minutes(g)
    const [r] = doScout(g, 'o_small', 'survey', OK)
    expect(minutes(g) - t0).toBe(240)
    expect(r).toMatchObject({ kind: 'gig', action: 'fixer.scout' })
    expect(r!.timeline[0]).toMatchObject({ layer: 'meat', tag: 'fixer.scout' })
    expect(r!.timeline[0]!.roll).toMatchObject({ natural: OK, dc: 12, degree: 'success', skill: 'stealth' })
    expect(jobOf(g.state, 'o_small')!.scouts).toBe(1)
  })

  it('最多踩「階段數」次：小型踩第 4 次被擋；中型能踩 4 次，第 5 次被擋', () => {
    const g = setup()
    take(g)
    for (let i = 0; i < 3; i++) doScout(g, 'o_small', 'survey', MISS)
    expect(scoutView(g.k, g.state, 'o_small')).toMatchObject({ done: 3, max: 3 })
    expect(() => scout(g.k, g.state, 'o_small', 'survey')).toThrow(/最多踩 3 次/)
    expect(scoutView(g.k, g.state, 'o_small').methods.every((m) => m.block !== null)).toBe(true)

    const m = setup()
    take(m, 'o_mid')
    for (let i = 0; i < 4; i++) doScout(m, 'o_mid', 'survey', 6)
    expect(() => scout(m.k, m.state, 'o_mid', 'survey')).toThrow(/最多踩 4 次/)
  })

  it('DC = 10 ＋ 等級 × 2，第 4 次起 +1（中型、等級 II 驗：14、14、14、15）', () => {
    const g = setup()
    take(g, 'o_mid')
    const dcs: number[] = []
    for (let i = 0; i < 4; i++) {
      dcs.push(scoutView(g.k, g.state, 'o_mid').next_dc)
      const [r] = doScout(g, 'o_mid', 'survey', 6)
      expect(r!.timeline[0]!.roll!.dc).toBe(dcs[i])
    }
    expect(dcs).toEqual([14, 14, 14, 15])
    expect(scoutView(g.k, g.state, 'o_mid')).toMatchObject({ hard_from: 4, minutes: 240 })
  })
})

describe('踩點：四種結果（小型、DC 12）', () => {
  it('超過 5 以上：揭開兩項（照清單的順序，路在前面就是開出一條踩點開出來的路）', () => {
    const g = setup()
    take(g)
    const [r] = doScout(g, 'o_small', 'survey', CRIT)
    expect(r!.timeline[0]!.roll!.degree).toBe('critical')
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_path', 'u_guard'])
    expect(r!.narration!.results!.join('')).toMatch(/踩出了一條路/)
    expect(scoutedOf(jobOf(g.state, 'o_small')!).scouted).toMatchObject({ branches: ['back_door'], guards: [3], stages: [] })
  })

  it('成功：揭開一項', () => {
    const g = setup()
    take(g)
    doScout(g, 'o_small', 'survey', OK)
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_path'])
  })

  it('失敗：什麼都沒有（但次數與時間照算）', () => {
    const g = setup()
    take(g)
    const t0 = minutes(g)
    const [r] = doScout(g, 'o_small', 'survey', MISS)
    expect(jobOf(g.state, 'o_small')).toMatchObject({ revealed: [], scouts: 1, alert_start: 0 })
    expect(minutes(g) - t0).toBe(240)
    expect(r!.narration!.results!.join('')).toMatch(/什麼都沒有/)
  })

  it('自然 1：驚動目標，警戒的起始是 15（也揭不開東西）；再來一次自然 1 疊加；內海的手段加在追蹤度', () => {
    const g = setup()
    take(g)
    doScout(g, 'o_small', 'survey', ONE)
    expect(jobOf(g.state, 'o_small')).toMatchObject({ revealed: [], alert_start: 15, trace_start: 0 })
    expect(scoutedOf(jobOf(g.state, 'o_small')!).alert_start).toBe(15)
    doScout(g, 'o_small', 'bribe', ONE)
    expect(jobOf(g.state, 'o_small')!.alert_start).toBe(30)
    doScout(g, 'o_small', 'hack', ONE)
    expect(jobOf(g.state, 'o_small')).toMatchObject({ alert_start: 30, trace_start: 15 })
    expect(scoutedOf(jobOf(g.state, 'o_small')!)).toMatchObject({ alert_start: 30, trace_start: 15 })
  })
})

describe('踩點：手段與它能揭開的類', () => {
  it('五種手段各自的基本功與能揭開的類照表；進人偶館當班與派人去踩點是灰的', () => {
    expect(SCOUT_METHODS.map((m) => [m.id, m.skills, m.cats, m.layer])).toEqual([
      ['survey', ['stealth', 'investigate'], ['path', 'guard', 'stage'], 'meat'],
      ['ask', ['streetwise', 'negotiate'], ['target', 'employer', 'modifier'], 'meat'],
      ['hack', ['interface'], ['lace', 'stage', 'guard'], 'net'],
      ['bribe', ['negotiate', 'seduce'], ['path', 'guard'], 'meat'],
      ['press', ['perform'], ['target', 'modifier'], 'meat'],
    ])
    expect(LOCKED_METHODS.map((m) => m.id)).toEqual(['dollhouse', 'dispatch'])
    const g = setup()
    take(g)
    expect(() => scout(g.k, g.state, 'o_small', 'dollhouse')).toThrow(/還沒有開放/)
    expect(() => scout(g.k, g.state, 'o_small', 'dispatch')).toThrow(/還沒有開放/)
    expect(() => scout(g.k, g.state, 'o_small', 'bogus')).toThrow(/沒有 bogus/)
    expect(scoutView(g.k, g.state, 'o_small').locked.map((l) => l.block)).toEqual(['還沒有開放。', '還沒有開放。'])
  })

  it('實地勘查不會揭開「雇主」類：連踩三次大成功，雇主與目標、詞條都還是問號', () => {
    const g = setup()
    take(g)
    for (let i = 0; i < 3; i++) if (scoutView(g.k, g.state, 'o_small').methods[0]!.block === null) doScout(g, 'o_small', 'survey', CRIT)
    const revealed = jobOf(g.state, 'o_small')!.revealed
    expect(revealed).toEqual(['u_path', 'u_guard', 'u_stage'])
    for (const id of ['u_employer', 'u_target', 'u_mod', 'u_lace']) expect(revealed).not.toContain(id)
  })

  it('打聽揭得開目標、雇主、詞條（照清單的順序）；進度不足以揭開時這個手段被擋下、不浪費一次', () => {
    const g = setup()
    take(g)
    doScout(g, 'o_small', 'ask', CRIT)
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_target', 'u_employer'])
    expect(scoutedOf(jobOf(g.state, 'o_small')!).scouted.flags).toEqual(['target_night', 'employer_backstab'])
    doScout(g, 'o_small', 'ask', OK)
    expect(scoutedOf(jobOf(g.state, 'o_small')!).scouted.modifiers).toEqual(['party'])
    expect(() => scout(g.k, g.state, 'o_small', 'ask')).toThrow(/沒有東西可以揭開/)
    expect(jobOf(g.state, 'o_small')!.scouts).toBe(2)
  })

  it('淺層駭入揭開蕾絲、階段、守備；擲介面', () => {
    const g = setup()
    take(g)
    const [r] = doScout(g, 'o_small', 'hack', CRIT)
    expect(r!.timeline[0]).toMatchObject({ layer: 'net' })
    expect(r!.timeline[0]!.roll!.skill).toBe('interface')
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_guard', 'u_stage'])
  })

  it('每個格子下面寫哪些手段揭得開（沒揭開的不給內容）', () => {
    const g = setup()
    take(g)
    const rows = scoutView(g.k, g.state, 'o_small').unknowns
    expect(rows.find((u) => u.id === 'u_employer')).toMatchObject({ cat_name: '雇主', revealed: false, text: null, methods: ['ask'] })
    expect(rows.find((u) => u.id === 'u_path')!.methods).toEqual(['survey', 'bribe'])
    doScout(g, 'o_small', 'survey', OK)
    expect(scoutView(g.k, g.state, 'o_small').unknowns.find((u) => u.id === 'u_path')).toMatchObject({ revealed: true, text: '後門的班表有空檔' })
  })
})

describe('踩點頁的資料', () => {
  it('次數、下一次的 DC、上一次的結果、副本的樣子', () => {
    const g = setup()
    take(g)
    expect(scoutView(g.k, g.state, 'o_small')).toMatchObject({ done: 0, max: 3, next_dc: 12, last: null })
    doScout(g, 'o_small', 'survey', OK)
    const v = scoutView(g.k, g.state, 'o_small')
    expect(v.last).toMatchObject({ n: 1, method: 'survey', natural: OK, total: 14, dc: 12, degree: 'success', revealed: ['u_path'] })
    expect(v.methods).toHaveLength(5)
    expect(v.methods.every((m) => m.dc === 12)).toBe(true)
    expect(v.brief.rows).toHaveLength(3)
  })

  it('手上沒有的委託、做完的委託不能踩點', () => {
    const g = setup()
    expect(() => scout(g.k, g.state, 'o_small', 'survey')).toThrow(/手上沒有/)
    take(g)
    g.commit(go(g.k, g.state, 'o_small'))
    endStub(g, 'done')
    expect(() => scout(g.k, g.state, 'o_small', 'survey')).toThrow(/做完/)
    expect(scoutView(g.k, g.state, 'o_small').methods.every((m) => m.block !== null)).toBe(true)
  })
})

// ===================================================================================================================
// 買情報
// ===================================================================================================================

describe('買情報', () => {
  it('不擲：指定一項揭開，錢少了等級 × 300；不花時間、不算踩點的次數', () => {
    const g = setup({ cash: 1000 })
    take(g, 'o_mid')
    const t0 = minutes(g)
    const cursor = g.state.rng.cursor
    const [r] = g.commit(buyIntel(g.k, g.state, 'o_mid', 'u_employer'))
    expect(r).toMatchObject({ kind: 'gig', action: 'fixer.buy_intel' })
    expect(g.state.money.cash).toBe(1000 - 2 * 300)
    expect(jobOf(g.state, 'o_mid')).toMatchObject({ revealed: ['u_employer'], scouts: 0 })
    expect(minutes(g)).toBe(t0)
    expect(g.state.rng.cursor).toBe(cursor)
    expect(r!.timeline).toEqual([])
  })

  it('等級 I 的 300、等級 III 的 900；錢不夠、已經知道的、沒有的項都被擋下並有原因', () => {
    const g = setup({ cash: 800 })
    take(g)
    take(g, 'o_large')
    expect(intelOptions(g.k, g.state, jobOf(g.state, 'o_small')!)[0]).toMatchObject({ id: 'cash', price: 300, block: null })
    expect(intelOptions(g.k, g.state, jobOf(g.state, 'o_large')!)[0]).toMatchObject({ id: 'cash', price: 900 })
    expect(() => buyIntel(g.k, g.state, 'o_large', 'u_lace')).toThrow(/900/)
    g.commit(buyIntel(g.k, g.state, 'o_small', 'u_lace'))
    expect(() => buyIntel(g.k, g.state, 'o_small', 'u_lace')).toThrow(/已經知道/)
    expect(() => buyIntel(g.k, g.state, 'o_small', 'u_nope')).toThrow(/沒有 u_nope/)
    expect(g.state.money.cash).toBe(500)
  })

  it('用人情：有人註冊 owed_to_pc 才列；中間人欠你的人情用掉一個（小的先）', () => {
    const plain = setup()
    take(plain)
    expect(intelOptions(plain.k, plain.state, jobOf(plain.state, 'o_small')!).map((o) => o.id)).toEqual(['cash'])
    expect(() => buyIntel(plain.k, plain.state, 'o_small', 'u_lace', 'favor')).toThrow(/不能用人情/)

    const g = setup({ features: [favorsFeature] })
    take(g)
    const job = jobOf(g.state, 'o_small')!
    expect(intelOptions(g.k, g.state, job).map((o) => o.id)).toEqual(['cash', 'favor'])
    expect(intelOptions(g.k, g.state, job)[1]!.block).toMatch(/沒有欠你人情/)
    expect(() => buyIntel(g.k, g.state, 'o_small', 'u_lace', 'favor')).toThrow(/沒有欠你人情/)
    give(g, 'npc_mama', 'mid')
    give(g, 'npc_mama', 'small')
    give(g, 'npc_boss', 'small')
    const cash = g.state.money.cash
    g.commit(buyIntel(g.k, g.state, 'o_small', 'u_lace', 'favor'))
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_lace'])
    expect(g.state.money.cash).toBe(cash)
    expect(favorsOf(g.state).owed_to_pc.map((f) => [f.who, f.size])).toEqual([['npc_mama', 'mid'], ['npc_boss', 'small']])
  })
})

// ===================================================================================================================
// scoutedOf 與 scout_reveal
// ===================================================================================================================

describe('scoutedOf：整理給副本的東西', () => {
  it('沒揭開時什麼都沒有；揭開之後階段、路、守備、詞條、旗標各歸各的；警戒起始值跟著', () => {
    const g = setup({ cash: 5000 })
    take(g)
    expect(scoutedOf(jobOf(g.state, 'o_small')!)).toEqual({ scouted: { stages: [], branches: [], guards: [], modifiers: [], flags: [] }, alert_start: 0, trace_start: 0 })
    for (const id of ['u_mod', 'u_stage', 'u_path', 'u_guard', 'u_lace']) g.commit(buyIntel(g.k, g.state, 'o_small', id))
    expect(scoutedOf(jobOf(g.state, 'o_small')!).scouted).toEqual({ stages: [2], branches: ['back_door'], guards: [3], modifiers: ['party'], flags: ['lace_pink'] })
  })
})

describe('效果 scout_reveal', () => {
  const reveal = (g: G, e: Rec, source: 'builtin' | 'ai' = 'builtin') => {
    const r = g.k.effects.resolve([{ kind: 'scout_reveal', ...e }], effectCtx(g.k, g.state, { source }))
    if (r.errors.length === 0) g.commit(sysDraft(r.changes, 'test.reveal'))
    return r
  }

  it('揭開一項，不花時間、不算次數；沒寫 job 就是最近接的那一件', () => {
    const g = setup()
    take(g)
    take(g, 'o_mid')
    const t0 = minutes(g)
    const r = reveal(g, { cat: 'employer' })
    expect(r.lines[0]).toMatch(/雇主打算事後翻臉/)
    expect(jobOf(g.state, 'o_mid')).toMatchObject({ revealed: ['u_employer'], scouts: 0 })
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual([])
    expect(minutes(g)).toBe(t0)
    // 指定 job
    reveal(g, { job: 'o_small' })
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_path'])
    // 敵人的功能問話之後帶的是副本的 id（cm_mid 是 o_mid 的副本）
    reveal(g, { job: 'cm_mid', cat: 'target' })
    expect(jobOf(g.state, 'o_mid')!.revealed).toEqual(['u_employer', 'u_target'])
    // count
    reveal(g, { job: 'o_small', count: 2 })
    expect(jobOf(g.state, 'o_small')!.revealed).toEqual(['u_path', 'u_guard', 'u_stage'])
  })

  it('沒有手上的委託、指定的不是進行中的、格式不對都不收', () => {
    const g = setup()
    expect(reveal(g, {}).errors[0]).toMatch(/沒有進行中的委託/)
    take(g)
    expect(reveal(g, { job: 'o_none' }).errors[0]).toMatch(/o_none/)
    expect(reveal(g, { cat: 'bogus' }).errors[0]).toMatch(/cat/)
    expect(reveal(g, { count: 0 }).errors[0]).toMatch(/count/)
    g.commit(go(g.k, g.state, 'o_small'))
    endStub(g, 'done')
    expect(reveal(g, { job: 'o_small' }).errors[0]).toMatch(/o_small/)
  })

  it('AI 與玩家要的 scout_reveal 整批不收（不在 EVENTS 2.4 的 AI 效果表；ai: false）；內建的照收', () => {
    const g = setup()
    take(g)
    const r = reveal(g, { count: 2 }, 'ai')
    expect(r.errors.join()).toContain('不是 AI 與玩家要的結果可以用的效果')
    expect(r.changes).toEqual([])
    expect(jobOf(g.state, 'o_small')!.revealed).toHaveLength(0)
    expect(g.k.effects.aiKinds()).not.toContain('scout_reveal')
    reveal(g, { count: 1 })
    expect(jobOf(g.state, 'o_small')!.revealed).toHaveLength(1)
  })

  it('什麼都揭開了就不再動', () => {
    const g = setup()
    take(g)
    for (let i = 0; i < 8; i++) reveal(g, { count: 5 })
    expect(jobOf(g.state, 'o_small')!.revealed).toHaveLength(7)
    expect(() => reveal(g, {})).not.toThrow()
    expect(jobOf(g.state, 'o_small')!.revealed).toHaveLength(7)
  })
})

// ===================================================================================================================
// 出發
// ===================================================================================================================

describe('出發：go', () => {
  it('報告帶 launch 一個 commission：setup 帶副本、scouted、alert_start、terms；origin 是 { by: fixer, ref }', async () => {
    const g = setup({ cash: 5000 })
    haggleFirst(g)
    take(g, 'o_small', 'cred')
    doScout(g, 'o_small', 'survey', CRIT)
    doScout(g, 'o_small', 'ask', ONE)
    const draft = go(g.k, g.state, 'o_small')
    expect(draft).toMatchObject({ kind: 'gig', action: 'fixer.go' })
    expect(draft.launch).toHaveLength(1)
    expect(draft.launch![0]).toMatchObject({ kind: 'commission', origin: { by: 'fixer', ref: 'o_small' } })

    const { violations } = await observed(g, () => g.commit(draft))
    expect(violations).toEqual([])
    const st = g.state.ext.cm_stub as { setup: Rec; origin: Rec }
    expect(st.origin).toEqual({ by: 'fixer', ref: 'o_small' })
    expect((st.setup.def as Rec).id).toBe('cm_small')
    expect(st.setup.scouted).toMatchObject({ stages: [], branches: ['back_door'], guards: [3] })
    expect(st.setup.alert_start).toBe(15)
    expect(st.setup.terms).toEqual({ reward: 1100, pay: 'cred', cut: 0.1 })
    expect(st.setup.trace_start).toBeUndefined()
  })

  function haggleFirst(g: G): void {
    findNatural(g, haggledPurpose('fx_a', 'o_small'), 16)
    g.commit(haggle(g.k, g.state, { id: 'o_small', fixer: 'fx_a' }))
  }

  it('內海手段驚動目標：追蹤度的起始一起交出去', () => {
    const g = setup()
    take(g)
    doScout(g, 'o_small', 'hack', ONE)
    g.commit(go(g.k, g.state, 'o_small'))
    const st = g.state.ext.cm_stub as { setup: Rec }
    expect(st.setup).toMatchObject({ alert_start: 0, trace_start: 15 })
  })

  it('有條件 in_block 而且委託寫了入口的街區時，不在那一塊街區被擋；走到了就過', () => {
    const g = setup({ features: [IN_BLOCK] })
    take(g)
    expect(g.state.location.block).not.toBe('blk_dock')
    expect(() => go(g.k, g.state, 'o_small')).toThrow(/委託的地點（blk_dock）/)
    g.state.location.block = 'blk_dock'
    expect(go(g.k, g.state, 'o_small').launch).toHaveLength(1)
  })

  it('沒有人註冊 in_block 時不檢查；委託沒寫街區時也不檢查', () => {
    const g = setup()
    take(g)
    expect(() => go(g.k, g.state, 'o_small')).not.toThrow()
    const h = setup({ features: [IN_BLOCK] })
    take(h, 'o_mid')
    // o_mid 也寫了街區，換一件沒寫街區的
    const noBlock = structuredClone(OFFERS[1]!) as unknown as Rec
    delete (noBlock.commission as Rec).block
    const job = { ...jobOf(h.state, 'o_mid')!, commission: noBlock.commission as never }
    expect((job.commission as Rec).block).toBeUndefined()
    h.state.ext.fixer = { ...(h.state.ext.fixer as Rec), jobs: [job] }
    expect(() => go(h.k, h.state, 'o_mid')).not.toThrow()
  })

  it('副本進行中是封閉的：踩點、接案、交涉、買情報都被擋（白名單沒有 fixer.）', () => {
    const g = setup()
    take(g)
    g.commit(go(g.k, g.state, 'o_small'))
    expect(g.blockOf('commit:fixer.scout')).toMatch(/副本進行中/)
    expect(g.blockOf('commit:fixer.accept')).not.toBeNull()
    expect(g.blockOf('commit:fixer.go')).not.toBeNull()
    expect(() => g.commit(scout(g.k, g.state, 'o_small', 'survey'))).toThrow(ActionBlocked)
  })

  it('做完的、失敗的、沒接的委託出發不了', () => {
    const g = setup()
    expect(() => go(g.k, g.state, 'o_small')).toThrow(/手上沒有/)
    take(g)
    g.commit(go(g.k, g.state, 'o_small'))
    endStub(g, 'failed')
    expect(() => go(g.k, g.state, 'o_small')).toThrow(/失敗/)
  })
})

// ===================================================================================================================
// 副本回報
// ===================================================================================================================

describe('副本回報：只把手上那一件標成做完或失敗', () => {
  it('做完：手上那一件是 done；結束報告的結果多一句；其他的委託不動', () => {
    const g = setup()
    take(g)
    take(g, 'o_mid')
    g.commit(go(g.k, g.state, 'o_small'))
    const [r] = endStub(g, 'done', { rating: 'A', xp: 20 })
    expect(jobOf(g.state, 'o_small')!.status).toBe('done')
    expect(jobOf(g.state, 'o_mid')!.status).toBe('active')
    expect(r!.changes.some((c) => c.op === 'fixer.status')).toBe(true)
    expect(latestJob(g.state)!.id).toBe('o_mid')
  })

  it('失敗：手上那一件是 failed（在 commission.failed 那一份報告發的 activity.end）', () => {
    const g = setup()
    take(g)
    g.commit(go(g.k, g.state, 'o_small'))
    endStub(g, 'failed')
    expect(jobOf(g.state, 'o_small')!.status).toBe('failed')
  })

  it('不是自己發起的、撤退、查不到的委託都不處理', () => {
    const g = setup()
    take(g)
    g.commit(go(g.k, g.state, 'o_small'))
    endStub(g, 'retreat')
    expect(jobOf(g.state, 'o_small')!.status).toBe('active')
    // 別的功能發起的
    const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: { by: 'someone_else', ref: 'o_small' }, outcome: 'done', result: {} })
    expect(end.changes).toEqual([])
    const unknown = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: { by: 'fixer', ref: 'o_none' }, outcome: 'done', result: {} })
    expect(unknown.changes).toEqual([])
    // 別種活動
    const battle = endActivity(g.k, { state: g.state, kind: 'battle', id: 'b1', origin: { by: 'fixer', ref: 'o_small' }, outcome: 'win', result: {} })
    expect(battle.changes).toEqual([])
  })

  it('已經標過的不再標第二次', () => {
    const g = setup()
    take(g)
    g.commit(go(g.k, g.state, 'o_small'))
    endStub(g, 'done')
    const again = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: { by: 'fixer', ref: 'o_small' }, outcome: 'failed', result: {} })
    expect(again.changes).toEqual([])
    expect(jobOf(g.state, 'o_small')!.status).toBe('done')
  })

  it('撤退（回到快照）之後委託還在手上、踩過的點還在、錢與時間回到出發之前', () => {
    const g = setup({ cash: 3000 })
    take(g)
    doScout(g, 'o_small', 'survey', CRIT)
    g.commit(buyIntel(g.k, g.state, 'o_small', 'u_lace'))
    const before = jobOf(g.state, 'o_small')!
    const cash = g.state.money.cash
    g.commit(go(g.k, g.state, 'o_small'))
    expect(isRecord(g.state.ext.cm_stub)).toBe(true)
    const t0 = minutes(g)
    expect(g.rewindToKind('entry', '撤退，回到出發之前。')).toBeNull()
    expect(g.state.ext.cm_stub).toBeUndefined()
    const after = jobOf(g.state, 'o_small')!
    expect(after).toEqual({ ...before, departed: true }) // 出發過了的記號留著（放棄的信譽看它）
    expect(after).toMatchObject({ status: 'active', scouts: 1, revealed: ['u_path', 'u_guard', 'u_lace'] })
    expect(g.state.money.cash).toBe(cash)
    expect(minutes(g)).toBe(t0)
    // 回來之後可以繼續踩、再出發
    doScout(g, 'o_small', 'survey', OK)
    expect(jobOf(g.state, 'o_small')!.scouts).toBe(2)
    expect(() => g.commit(go(g.k, g.state, 'o_small'))).not.toThrow()
  })
})

// ===================================================================================================================
// 街頭信譽
// ===================================================================================================================

describe('街頭信譽（rep）', () => {
  it('量表 0～100、單一；同名的效果與條件有；rep 35 時 rep_grade 是 2', () => {
    const g = setup()
    expect(g.k.meters.get('rep')).toMatchObject({ owner: 'fixer', min: 0, max: 100, start: 0, keyed: 'none', cap: { down: 3, up: 3 } })
    expect(g.k.effects.has('rep')).toBe(true)
    expect(rep(g)).toBe(0)
    expect(g.k.stats.stat(g.state, 'pc', 'rep_grade')).toBe(1)
    setRep(g, 35)
    expect(rep(g)).toBe(35)
    expect(g.k.stats.stat(g.state, 'pc', 'rep_grade')).toBe(2)
    expect(g.k.conditions.test({ kind: 'rep', min: 35 } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(true)
  })

  it('六階對 I～V 級：0、15 是 I，35 是 II，55 是 III，75 是 IV，90 是 V；範圍夾在 0～100', () => {
    const g = setup()
    const grades: Array<[number, number]> = [[0, 1], [14, 1], [15, 1], [35, 2], [55, 3], [75, 4], [90, 5], [100, 5]]
    for (const [value, grade] of grades) {
      g.state.meters.rep = { _: value }
      expect(g.k.stats.stat(g.state, 'pc', 'rep_grade')).toBe(grade)
    }
    setRep(g, 500)
    expect(rep(g)).toBe(100)
    setRep(g, -500)
    expect(rep(g)).toBe(0)
  })

  it('AI 給的一件事最多加減 3', () => {
    const g = setup()
    const up = g.k.effects.resolve([{ kind: 'rep', amount: 10 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(up.effects[0]).toMatchObject({ amount: 3 })
    expect(up.clamps.length).toBe(1)
    g.state.meters.rep = { _: 50 }
    const down = g.k.effects.resolve([{ kind: 'rep', amount: -10 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(down.effects[0]).toMatchObject({ amount: -3 })
  })

  it('非主角沒有街頭信譽的等級', () => {
    const g = setup()
    g.state.meters.rep = { _: 90 }
    expect(g.k.stats.stat(g.state, 'nobody', 'rep_grade')).toBe(0)
  })
})

// ===================================================================================================================
// 內容與其他
// ===================================================================================================================

describe('內容格式', () => {
  it('fixer 的格式問題一條一句；引用的 NPC 查不到時載入完成後報錯', () => {
    const NPCS: ContentPack = { id: 'npcs', content: { npc: [{ id: 'npc_mama', name: '媽媽桑' }] } }
    const bad = (e: Rec) => setup({ content: [NPCS, { id: 'bad', content: { fixer: [{ id: 'fx_x', npc: 'npc_mama', district: 'd', kinds: ['a'], cut: 0.1, ...e }] } }] })
    expect(() => bad({ cut: 2 })).toThrow(/cut 要是 0～1/)
    expect(() => bad({ kinds: [] })).toThrow(/kinds/)
    expect(() => bad({ min_rep: 101 })).toThrow(/min_rep/)
    expect(() => bad({ npc: '' })).toThrow(/npc/)
    expect(() => bad({})).not.toThrow()
    expect(() => makeGame({ features: [fixerFeature], content: [{ id: 'r', content: { npc: [{ id: 'npc_mama', name: '媽媽桑' }], fixer: [{ id: 'fx_x', npc: 'npc_ghost', district: 'd', kinds: ['a'], cut: 0.1 }] } }] })).toThrow(/npc_ghost 查不到/)
  })

  it('沒有的中間人丟 ActionBlocked', () => {
    const g = setup()
    expect(() => board(g.k, g.state, 'fx_none')).toThrow(/沒有 fx_none/)
  })
})

describe('不變式與寫正文', () => {
  it('接案、交涉、踩點、買情報、出發都不違反不變式', async () => {
    const g = setup({ cash: 3000, features: [favorsFeature] })
    const run = async (fn: () => unknown) => expect((await observed(g, fn as never)).violations).toEqual([])
    await run(() => take(g, 'o_small', 'favor'))
    await run(() => doScout(g, 'o_small', 'survey', CRIT))
    await run(() => g.commit(buyIntel(g.k, g.state, 'o_small', 'u_lace')))
    await run(() => g.commit(go(g.k, g.state, 'o_small')))
    await run(() => endStub(g, 'done'))
  })

  it('走 commitNarrated（AI 關著）和 commit 同一份草稿、同一份變更', async () => {
    const g = setup()
    take(g)
    findNatural(g, scoutPurpose('o_small', 1), OK)
    const res = await g.commitNarrated(scout(g.k, g.state, 'o_small', 'survey'), { mode: 'narrate' })
    expect(res.status).toBe('applied')
    expect(jobOf(g.state, 'o_small')).toMatchObject({ scouts: 1, revealed: ['u_path'] })
  })

  it('存檔讀回來，手上的委託、揭開的未知、桌面都在', () => {
    const g = setup({ cash: 1000 })
    findNatural(g, haggledPurpose('fx_a', 'o_small'), 10)
    g.commit(haggle(g.k, g.state, { id: 'o_small', fixer: 'fx_a' }))
    take(g)
    doScout(g, 'o_small', 'survey', CRIT)
    const text = g.save('manual', 'now')
    const h = setup({ cash: 1000 })
    expect(h.load(text)).toBeNull()
    expect(readFixer(h.state)).toEqual(readFixer(g.state))
    expect(jobOf(h.state, 'o_small')).toMatchObject({ scouts: 1, revealed: ['u_path', 'u_guard'], haggled: 'success' })
  })
})
