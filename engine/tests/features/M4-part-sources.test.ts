// 驗收測試：dev/work/M4-part-sources.md（cpp-feature）。未登錄零件的四個來源：委託的報酬（fixer 新掛點 fixer.reward）、同人社團的訂做、勢力的固定窗口、口頭要到。
// 規格：CRAFTING 11.1 節（四個來源與表下兩條）；FIXER 第 2 節①「報酬的另一種類型」、第 8 節；COMMISSIONS 第 8 節；FACTIONS 5.1 節最後一段、第 7 節同人眾那一列；SITES 13.5 節；dev/adr/0019 第十七節與 P69～P73。
// 內容一律用測試自帶的最小假資料：兩個勢力（f_brand 有 brand 與 leader，f_plain 都沒有）、兩種委託類型（t_hit 寫了 part_types、t_plain 沒寫）、兩位中間人、三個設施種類
// （一般的店、帶 unreg_desk 的委託台、只在週六開的攤位）、兩個區（等級 3 與等級 1）；M4-part-unreg 測試的那張小規則表。
// 副本本體用替身活動（commission，進去時存 entry 快照），評價由測試直接給；骰面：交涉擲骰把存檔的游標撥到想要的骰面，掛點的亂數從（種子、游標、用途）導出。
// 一起裝：world、security（好感量表）、favors（人情）、fixer、unreg；沒有裝 commission 本體（它的活動 kind 與替身撞名），格式檢查那一段照規格跳過。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, Report, ReportDraft } from '../../src'
import { ActionBlocked, UNREG_STACK_ID, attachActivityEnd, deriveRng, effectCtx, endActivity, isRecord, meterOf, toMinutes } from '../../src'
import { favorsFeature, favorsOf } from '../../src/features/favors'
import { accept, board, boardRow, briefOf, fixerFeature, go, haggle, haggledPurpose, jobOf, offerProblems, offersFor, payOptions, readFixer } from '../../src/features/fixer'
import type { FixerEntry, Offer } from '../../src/features/fixer'
import { securityFeature } from '../../src/features/security'
import {
  answerReward, deliverBlock, deliverDraft, orderBlock, orderDraft, orderOptions, orderPickups, pendingParts, unregFeature, unregOf, unregRuleProblems, unregRules, windowBlock, windowDraft, windowOptions,
} from '../../src/features/unreg'
import { worldFeature } from '../../src/features/world'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const MAP = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
/** 委託的現實面用的小房間（9×5）：兩種類型都 fits。 */
const ROOM = {
  id: 'map_room', kind: 'room', size: [9, 5], fits: ['t_hit', 't_plain'],
  sheets: [{
    id: 'room_a', name: '小房間', size: [9, 5],
    layout: ['####E####', '#..1.G..#', 'E...T...E', '#..2....#', '###X#####'],
    zones: ['####a####', '#aaaaaaa#', 'aaaaaaaaa', '#aaaaaaa#', '###a#####'],
    cells: [
      { id: 'E1', at: [4, 0], mark: 'E', kind: 'front', name: '北門' }, { id: 'E2', at: [0, 2], mark: 'E', kind: 'back', name: '西門' }, { id: 'E3', at: [8, 2], mark: 'E', kind: 'side', name: '東門' },
      { id: 'G1', at: [5, 1], mark: 'G', name: '守衛的位置' }, { id: 'T1', at: [4, 2], mark: 'T', name: '目標' }, { id: 'X1', at: [3, 4], mark: 'X', name: '撤離點' },
    ],
    spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [3, 3], cover: 'medium' }],
  }],
}
const typeEntry = (id: string, more: Rec = {}): Rec => ({
  id, name: `類型${id}`, main: 'meat', decisive: { kind: 'take', at: 'T' },
  stages: [{ name: '找到他', faces: ['meat', 'net', 'opinion'] }, { name: '靠近他', faces: ['meat', 'net'] }, { name: '動手', faces: ['meat'] }],
  extra: [{ name: '他的護衛', faces: ['meat', 'net'] }, { name: '最後一道門', faces: ['meat', 'opinion'] }],
  branches: { stealth: 'stealth', talk: 'negotiate' }, brief: '替{fixer}處理{faction}在{district}的一個人，地點在{place}。', gives: { meat: ['lk_key'], net: ['lk_cam', 'lk_door'] }, ...more,
})
const LINKS = [
  { id: 'lk_cam', name: '關掉監視器', from: 'net', to: 'meat', type: 'skip', effect: { skip_explore: true } },
  { id: 'lk_key', name: '門禁卡', from: 'meat', to: 'meat', type: 'open' },
  { id: 'lk_door', name: '接管控制節點', from: 'net', to: 'meat', type: 'ease', effect: { encounter_half: true } },
]

const SKILLS = ['stealth', 'negotiate', 'firearms', 'mechanics'].map((id) => ({ id, name: id, attr: id === 'stealth' || id === 'firearms' ? 'reflex' : id === 'mechanics' ? 'tech' : 'charm', desc: `${id}。` }))
const QUIRKS: Rec[] = [
  { id: 'qk_plain1', name: '話多', desc: '它在口袋裡會輕輕作響。', kind: 'quirk', pool: ['doujin'] },
  { id: 'qk_plain2', name: '偏黃', desc: '用久了表面會泛黃。', kind: 'quirk', pool: ['doujin'] },
  { id: 'qk_plain3', name: '會掉漆', desc: '邊緣的漆會一小塊一小塊掉。', kind: 'quirk', pool: ['doujin'] },
  { id: 'qk_flaw', name: '一般的瑕疵', desc: '二手的瑕疵。', kind: 'flaw', pool: ['flaw'] },
]
const OPTIONS = {
  skin: [
    { id: 'sk_style', name: '風格', put: 'stats', key: 'style', amount: 1, cost: 0.5, max: 3, tags: ['風格'] },
    { id: 'sk_social', name: '社交親和', put: 'affinity', key: 'social', amount: 1, cost: 0.5, max: 3, tags: ['社交'] },
    { id: 'sk_scan', name: '防掃描', put: 'stats', key: 'scan_guard', amount: 1, cost: 0.5, max: 2, tags: ['隱蔽'] },
  ],
  plate: [
    { id: 'pl_armor', name: '護甲', put: 'stats', key: 'armor', amount: 1, cost: 0.5, max: 2, tags: ['armor'] },
    { id: 'pl_light', name: '減重', put: 'stats', key: 'weight', amount: -1, cost: 0.5, max: 2 },
  ],
}

const FACTIONS = [
  { id: 'f_brand', name: '同人社團', short: '社團', class: 'street', brand: 'hz', leader: 'npc_boss' },
  { id: 'f_plain', name: '路邊幫', short: '路幫', class: 'street' },
]

const pack = (o: { unreg?: boolean; sources?: Rec; offers?: boolean } = {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    skill: SKILLS, faction: FACTIONS, npc: [{ id: 'npc_boss', name: '社團的老闆' }, { id: 'npc_fx', name: '帳房' }],
    special_map: [MAP, ROOM],
    district: [
      { id: 'd_hive', name: '蜂巢', grade: 3, blocks: ['b_shops'], factions: ['f_plain', 'f_brand'] },
      { id: 'd_low', name: '低地', grade: 1, blocks: ['b_low'] },
    ],
    block: [
      { id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '雜貨店' }, F2: { type: 'fac_desk', name: '同人社團的委託台' }, F3: { type: 'fac_stall', name: '夜市的攤位' } } },
      { id: 'b_low', district: 'd_low', name: '低地街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '雜貨店' } } },
    ],
    facility_type: [
      { id: 'fac_plain', name: '雜貨店' },
      { id: 'fac_desk', name: '委託台', unreg_desk: { faction: 'f_brand', brand: 'hz' } },
      { id: 'fac_stall', name: '夜市攤位', unreg_desk: { weekdays: [5] } },
    ],
    quirk: structuredClone(QUIRKS),
    fixer: [
      { id: 'fx_a', name: '玻璃岸的帳房', npc: 'npc_fx', district: 'd_hive', kinds: ['t_hit'], cut: 0.1 },
      { id: 'fx_b', name: '舊港的帳房', npc: 'npc_fx', district: 'd_hive', kinds: ['t_plain'], cut: 0.1 },
      { id: 'fx_p', name: '特約的帳房', npc: 'npc_fx', district: 'd_hive', kinds: ['t_hit'], cut: 0.1 },
    ],
    commission_type: [typeEntry('t_hit', { part_types: ['skin', 'plate'] }), typeEntry('t_plain')],
    commission_link: structuredClone(LINKS),
  }
  if (o.unreg !== false) {
    c.unreg_rule = [{ id: 'default', options: structuredClone(OPTIONS), ...(o.sources ? { sources: structuredClone(o.sources) } : {}) }]
  }
  return { id: 'm4_part_sources', content: c as unknown as ContentPack['content'] }
}

/** 副本的替身活動（kind commission）：進去時存 entry 快照、記下 origin。 */
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

/** 別的功能經 fixer.offers 給的委託（不問 fixer.reward）：一件寫了委託人的、一件自己帶 extra 的。 */
const mkOffer = (id: string, grade: number, reward: number, more: Rec = {}, commission: Rec = {}): Offer => ({
  id, title: `${id} 的委託`, brief: `簡報：${id}。`, reward, unknowns: [], ...more,
  commission: {
    id: `cm_${id}`, name: `委託 ${id}`, kind: 't_hit', main: 'meat', scale: 'small', grade, target_faction: 'f_plain', district: 'd_hive',
    stages: [{ name: 'a', faces: { meat: {} } }, { name: 'b', faces: { meat: {} } }, { name: 'c', faces: { meat: {} } }], ...commission,
  },
}) as unknown as Offer
const EXTRA = (label = '一件寫好的東西'): Rec => ({ by: 'test', label, effects: [{ kind: 'part_unreg', source: 'reward', type: 'plate', grade: 3, brand: 'hz', from: '委託的報酬' }] })
const PROVIDED: Offer[] = [
  mkOffer('o_emp', 3, 2000, {}, { employer: 'f_brand' }),
  mkOffer('o_own', 3, 2000, { extra: { ...EXTRA(), cash_pct: 0.6 } }),
  mkOffer('o_two', 2, 1000, { extra: EXTRA('二級的委託也帶一件') }),
  mkOffer('o_plain', 3, 2000),
]
const PROVIDER: Feature = {
  id: 'test_offers',
  install(k: Kernel) {
    k.hooks.on('fixer.offers', 'test_offers', ({ fixer }) => (fixer.id === 'fx_p' ? structuredClone(PROVIDED) : undefined))
  },
}

// ---- 建局 ----

const PC = { hp: 40, attrs: { reflex: 14, charm: 14, tech: 14, intellect: 14 }, skills: { stealth: 3, negotiate: 3 } }
const DESK = { district: 'd_hive', block: 'b_shops', facility: 'F2' }
const STALL = { district: 'd_hive', block: 'b_shops', facility: 'F3' }
const SHOP = { district: 'd_hive', block: 'b_shops', facility: 'F1' }
const LOW = { district: 'd_low', block: 'b_low', facility: 'F1' }

interface Opts { seed?: number; unreg?: boolean; favors?: boolean; sources?: Rec; cash?: number; day?: number; hour?: number; rep?: number; at?: Record<string, string> }
const make = (o: Opts = {}) => {
  const features: Feature[] = [worldFeature, securityFeature, ...(o.favors === false ? [] : [favorsFeature]), fixerFeature, STUB, PROVIDER, ...(o.unreg === false ? [] : [unregFeature])]
  const { game } = makeGame({
    features, content: [pack({ unreg: o.unreg, sources: o.sources })], seed: o.seed ?? 7, pc: PC as never,
    patch: { time: { day: o.day ?? 10, hour: o.hour ?? 10, minute: 0 }, money: { cred: 5000, cash: o.cash ?? 3000 } },
  })
  game.state.location = { ...(o.at ?? DESK) }
  if (o.rep !== undefined) setRep(game, o.rep)
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const resolve = (g: G, effects: Rec[], source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
const give = (g: G, ...effects: Rec[]) => {
  const r = resolve(g, effects)
  expect(r.errors).toEqual([])
  g.commit(sys(r.changes))
  return r
}
function setRep(g: G, n: number): void {
  const r = g.k.effects.resolve([{ kind: 'rep', amount: n - meterOf(g.k, g.state, 'rep'), final: true }], effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(r.errors).toEqual([])
  g.commit(sys(r.changes))
}
const setFavor = (g: G, faction: string, n: number): void => void g.commit(sys([{ op: 'meter', kind: 'favor', key: faction, set: n }]))
const owe = (g: G, who: string, size = 'big'): void => void give(g, { kind: 'owed_to_pc', who, size })
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const cash = (g: G): number => g.state.money.cash
const now = (g: G): number => toMinutes(g.state.time)
const fixerOf = (g: G, id: string): FixerEntry => g.k.content.get('fixer', id) as unknown as FixerEntry
const goDay = (g: G, days: number): void => { g.state.time = { ...g.state.time, day: g.state.time.day + days } }

/** 把存檔的亂數游標撥到想要的骰面（交涉的擲骰）。 */
function findNatural(g: G, purpose: string, want: number): void {
  for (let c = 0; c < 100000; c++) {
    if (deriveRng({ seed: g.state.rng.seed, cursor: c }, purpose, 0).int(1, 20) === want) {
      g.state.rng.cursor = c
      return
    }
  }
  throw new Error(`找不到骰面 ${want}`)
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
const retreatStub = (g: G): Report[] => {
  const st = g.state.ext.cm_stub as { origin: { by: string; ref?: string } }
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: st.origin, outcome: 'retreat', result: {} })
  return g.commit(attachActivityEnd({
    kind: 'gig', action: 'stub.retreat', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes],
    outcome: { result: 'retreat', summary: '撤退。' }, rewind: { kind: 'entry', summary: '你撤退了，所有進度回到進去之前。' },
  }, end))
}
const payout = (reports: Report[]): Report => reports.find((r) => r.action === 'fixer.payout')!
const take = (g: G, id: string, fixer: string, pay: 'cash' | 'cred' | 'favor' = 'cash'): Report[] => g.commit(accept(g.k, g.state, { id, fixer }, { pay }))
const doGo = (g: G, id: string): Report[] => g.commit(go(g.k, g.state, id))
const rewardPendings = (g: G) => pendingParts(g.state).filter((p) => p.source === 'reward')

/** 這個中間人在這幾天的委託（用掛點的結果；不經桌面）。 */
const offersOver = (g: G, fixer: string, days: number[]): Offer[] => days.flatMap((d) => offersFor(g.k, g.state, fixerOf(g, fixer), d))
const DAYS = Array.from({ length: 12 }, (_, i) => i + 1)

// ===================================================================================================================
// 規則表
// ===================================================================================================================

describe('規則表：四個來源的欄位', () => {
  it('預設值照 P69～P73（報酬、訂做、窗口、口頭要到）', () => {
    const g = make()
    const r = unregRules(g.k).sources
    expect(r.reward).toEqual({ grade_cap: 3, grade_min: 3, chance: 0.1, cash_pct: 0.6, s_chance: 0.1667, top_rating: 'S' })
    expect(r.order).toEqual({ grade_cap: 3, price_mult: 1.5, days: 3, max_open: 1, quirk_pick_favor: 60 })
    expect(r['window']).toEqual({ grade_cap: 4, favor: 100, size: 'big' })
    expect(r.ask).toEqual({ grade_cap: 2 })
  })

  it('資料逐項蓋掉（沒寫的鍵留著預設）；格式不對一條一句', () => {
    const g = make({ sources: { reward: { chance: 1 }, order: { days: 1 } } })
    const r = unregRules(g.k).sources
    expect(r.reward).toMatchObject({ chance: 1, cash_pct: 0.6, grade_min: 3 })
    expect(r.order).toMatchObject({ days: 1, price_mult: 1.5 })
    const bad = unregRuleProblems({ sources: { reward: { chance: 2, grade_min: 0, types: [] }, order: { price_mult: 0, days: -1, max_open: 0 }, 'window': { favor: 101, size: 'huge' } } })
    expect(bad.length).toBeGreaterThanOrEqual(8)
    expect(bad.some((m) => m.includes('reward.chance'))).toBe(true)
    expect(bad.some((m) => m.includes('window.size'))).toBe(true)
  })

  it('載入時擋下：unreg_desk 或 part_types 格式不對', () => {
    const bad = (patch: (c: Record<string, Rec[]>) => void): ContentPack => {
      const p = pack()
      patch(p.content as unknown as Record<string, Rec[]>)
      return p
    }
    const load = (p: ContentPack) => makeGame({ features: [worldFeature, securityFeature, favorsFeature, fixerFeature, unregFeature], content: [p], seed: 7, pc: PC as never })
    expect(() => load(bad((c) => { c.facility_type!.push({ id: 'fac_bad', name: '壞的', unreg_desk: { weekdays: [9] } }) }))).toThrow(/unreg_desk\.weekdays/)
    expect(() => load(bad((c) => { c.facility_type!.push({ id: 'fac_bad2', name: '壞的', unreg_desk: { faction: 'f_nope' } }) }))).toThrow(/f_nope/)
    expect(() => load(bad((c) => { c.commission_type!.push(typeEntry('t_bad', { part_types: ['nope'] })) }))).toThrow(/part_types/)
  })
})

// ===================================================================================================================
// 委託的報酬：掛點 fixer.reward
// ===================================================================================================================

describe('掛點 fixer.reward（offer）：生成時擲 chance，報酬欄多一件、現金先乘六成', () => {
  it('沒有人回答時 offersFor 的結果和沒裝 unreg 一樣；chance 設成 0 也一樣', () => {
    const none = make({ unreg: false, rep: 55 })
    const zero = make({ sources: { reward: { chance: 0 } }, rep: 55 })
    const a = offersOver(none, 'fx_a', DAYS)
    const b = offersOver(zero, 'fx_a', DAYS)
    expect(a.length).toBeGreaterThan(20)
    expect(b).toEqual(a)
    expect(a.every((o) => o.extra === undefined)).toBe(true)
  })

  it('chance 設成 1：III 級以上的委託多一件、reward 是原本的六成（十位）；II 級以下沒有；其餘欄位不變', () => {
    const base = make({ unreg: false, rep: 55 })
    const one = make({ sources: { reward: { chance: 1 } }, rep: 55 })
    for (const fixer of ['fx_a', 'fx_b']) {
      const before = offersOver(base, fixer, DAYS)
      const after = offersOver(one, fixer, DAYS)
      expect(after).toHaveLength(before.length)
      const grades = new Set(before.map((o) => o.commission.grade))
      expect([...grades].some((g) => (g as number) < 3) && [...grades].some((g) => (g as number) >= 3), `${fixer}：要同時抽得到 III 級以上與 II 級以下`).toBe(true)
      before.forEach((o, i) => {
        const x = after[i]!
        const grade = o.commission.grade as number
        const { reward, extra, ...rest } = x
        const { reward: reward0, ...rest0 } = o
        expect(rest).toEqual(rest0)
        if (grade >= 3) {
          expect(extra, `${o.id} 是 ${grade} 級`).toBeDefined()
          expect(reward).toBe(Math.round((reward0 * 0.6) / 10) * 10)
          expect(extra!.label).toMatch(/^一件未登錄零件（.+，(I|II|III)級）$/)
          expect(extra!.by).toBe('unreg')
          expect(extra!.cash_pct).toBe(0.6)
          const e = extra!.effects[0] as Rec
          expect(e).toMatchObject({ kind: 'part_unreg', source: 'reward', brand: 'doujin', from: '委託的報酬' })
          expect(e.grade).toBe(Math.min(grade, 3))
          // 類型：t_hit 寫了 part_types，t_plain 沒寫（從十二種抽）
          if (o.commission.kind === 't_hit') expect(['skin', 'plate']).toContain(e.type)
          else expect(Object.keys(unregRules(one.k).types)).toContain(e.type)
          expect(offerProblems(x)).toEqual([])
        } else {
          expect(extra).toBeUndefined()
          expect(reward).toBe(reward0)
        }
      })
    }
  })

  it('同一天問兩次結果相同（中間擲幾次骰都一樣）；不同的種子可以不同', () => {
    const g = make({ sources: { reward: { chance: 0.5 } }, rep: 55 })
    const first = offersOver(g, 'fx_a', DAYS)
    g.state.rng.cursor += 17
    const second = offersOver(g, 'fx_a', DAYS)
    expect(second).toEqual(first)
    const withExtra = first.filter((o) => o.extra).length
    expect(withExtra).toBeGreaterThan(0)
    expect(withExtra).toBeLessThan(first.filter((o) => (o.commission.grade as number) >= 3).length)
  })

  it('掛點的回答：委託人的牌子是勢力資料的 brand（沒有就 doujin）；等級不到 grade_min 沒有；types 規則蓋掉全部的類型', () => {
    const g = make({ sources: { reward: { chance: 1, types: ['plate'] } } })
    const ask = (employer: string | undefined, grade = 3, kind: string | undefined = 't_plain') => answerReward(g.k, { state: g.state, phase: 'offer', fixer: 'fx_a', seed: 'x/1/0', commission: { id: 'cm', grade, ...(kind ? { kind } : {}), ...(employer ? { employer } : {}) } })
    expect((ask('f_brand')!.effects[0] as Rec).brand).toBe('hz')
    expect((ask('f_plain')!.effects[0] as Rec).brand).toBe('doujin')
    expect((ask(undefined)!.effects[0] as Rec).brand).toBe('doujin')
    expect(ask('f_brand', 2)).toBeUndefined()
    expect((ask('f_brand', 5)!.effects[0] as Rec).grade).toBe(3)
    expect((ask(undefined, 3, 't_plain')!.effects[0] as Rec).type).toBe('plate')
    expect(['skin', 'plate']).toContain((ask(undefined, 3, 't_hit')!.effects[0] as Rec).type)
    // 經掛點的路和直接問一樣
    const hooked = g.k.hooks.run('fixer.reward', { state: g.state, phase: 'offer', fixer: 'fx_a', seed: 'x/1/0', commission: { id: 'cm', grade: 3, kind: 't_plain', employer: 'f_brand' } })
    expect(hooked.map((h) => h.owner)).toEqual(['unreg'])
  })
})

describe('接案：extra 抄進 terms，交涉加在六成之後的數字上，三種付法只算現金的那一部分', () => {
  const setup = () => {
    const g = make({ sources: { reward: { chance: 1 } }, rep: 55 })
    // 找一件有 extra 的
    for (const day of DAYS) {
      g.state.time = { ...g.state.time, day }
      const row = board(g.k, g.state, 'fx_a').offers.find((r) => r.offer.extra)
      if (row) return { g, row, base: offersFor(g.k, g.state, fixerOf(g, 'fx_a'), day).find((o) => o.id === row.id)! }
    }
    throw new Error('找不到有 extra 的委託')
  }

  it('簡報與桌面的列帶 extra_label；沒有 extra 的委託沒有這個欄位', () => {
    const { g, row } = setup()
    expect(row.extra_label).toBe(row.offer.extra!.label)
    expect(row.brief.extra_label).toBe(row.offer.extra!.label)
    expect(briefOf(g.k, row.offer).extra_label).toBe(row.offer.extra!.label)
    const plain = board(g.k, g.state, 'fx_a').offers.find((r) => !r.offer.extra)
    if (plain) {
      expect(plain.extra_label).toBeUndefined()
      expect('extra_label' in plain.brief).toBe(false)
    }
  })

  it('accept：terms.extra 在、接案的那一句多「，另外有<label>」；選匯進帳戶到手的是六成的 85%', () => {
    const { g, row } = setup()
    const opts = payOptions(g.k, row.offer, 'npc_fx')
    expect(opts.find((p) => p.id === 'cred')!.amount).toBe(Math.round(row.offer.reward * 0.85))
    const [r] = take(g, row.id, 'fx_a', 'cred')
    const job = jobOf(g.state, row.id)!
    expect(job.terms.extra).toMatchObject({ by: 'unreg', label: row.offer.extra!.label })
    expect(job.terms.reward).toBe(row.offer.reward)
    expect(r!.narration!.results![0]).toContain(`，另外有${row.offer.extra!.label}`)
  })

  it('交涉成功（大成功）加的是六成之後的數字', () => {
    const { g, row, base } = setup()
    expect(row.offer.reward).toBe(Math.round((base.reward / 1) * 1)) // 桌面上的數字就是掛點給的（已經乘過）
    findNatural(g, haggledPurpose('fx_a', row.id), 20)
    g.commit(haggle(g.k, g.state, { id: row.id, fixer: 'fx_a' }))
    const after = boardRow(g.k, g.state, { id: row.id, fixer: 'fx_a' })
    expect(after.haggled).toBe('critical')
    expect(after.offer.reward).toBe(Math.round(base.reward * 1.1))
    // 加價的底是六成的數字，不是原本的全額
    const full = Math.round(base.reward / 0.6)
    expect(after.offer.reward).toBeLessThan(full)
  })
})

describe('結算：fixer.payout 多給一件（談好的，或雇主多給的）', () => {
  /** 接一件經 fixer.offers 給的委託、出發、結束。 */
  const run = (g: G, id: string, outcome: 'done' | 'failed' | 'retreat', rating?: string): Report[] => {
    take(g, id, 'fx_p')
    doGo(g, id)
    return outcome === 'retreat' ? retreatStub(g) : endStub(g, outcome, rating ? { rating } : {})
  }

  it('談好的（terms.extra）：做完多一筆 reward，等級、類型、牌子照那一筆；現金照付法算（不受 extra 影響）、句子與紀錄都有', () => {
    const g = make({ sources: { reward: { chance: 0, s_chance: 0 } } })
    const cash0 = cash(g)
    const reports = run(g, 'o_own', 'done', 'B')
    const pend = rewardPendings(g)
    expect(pend).toHaveLength(1)
    expect(pend[0]!.frame).toMatchObject({ type: 'plate', grade: 3, brand: 'hz' })
    expect(pend[0]!.from).toBe('委託的報酬')
    // 現金：談好的 1200 全額（0.6 × 2000 是掛點算的，這件是手寫的 2000），B 級不加成，抽成 10%，主角兩份
    const p = payout(reports)
    expect(p.outcome.result).toBe('paid')
    expect(cash(g)).toBe(cash0 + jobOf(g.state, 'o_own')!.payout!.pc_net)
    expect(jobOf(g.state, 'o_own')!.payout!.extra).toEqual(expect.arrayContaining([expect.stringContaining('未登錄零件')]))
    expect(p.narration!.results!.some((l) => l.includes('一件未登錄零件') && !l.includes('雇主多給了'))).toBe(true)
  })

  it('談好的：失敗與撤退都沒有；沒有人註冊效果（沒裝 unreg）略過並多一句「<label>這一次沒有給成。」', () => {
    const f = make({ unreg: false })
    const reports = run(f, 'o_own', 'done', 'B')
    expect(payout(reports).narration!.results).toContain('一件寫好的東西這一次沒有給成。')
    expect(jobOf(f.state, 'o_own')!.payout!.extra).toContain('一件寫好的東西這一次沒有給成。')
    expect(f.state.ext.unreg).toBeUndefined()

    const g = make()
    run(g, 'o_own', 'failed')
    expect(rewardPendings(g)).toHaveLength(0)
    expect(jobOf(g.state, 'o_own')!.payout).toMatchObject({ outcome: 'failed' })
    const h = make()
    take(h, 'o_own', 'fx_p')
    doGo(h, 'o_own')
    retreatStub(h)
    expect(rewardPendings(h)).toHaveLength(0)
    expect(jobOf(h.state, 'o_own')!.status).toBe('active')
  })

  it('II 級的委託也能帶（掛點只管生成時擲出來的；別的功能自己帶 extra 的不看等級）', () => {
    const g = make()
    run(g, 'o_two', 'done', 'A')
    expect(rewardPendings(g)).toHaveLength(1)
  })

  it('雇主多給的：s_chance 是 1、評價 S 的那一趟多一筆、現金沒有少、句子開頭「雇主多給了一樣東西：」；A 級沒有；委託人的牌子', () => {
    const base = make({ sources: { reward: { chance: 0, s_chance: 0 } } })
    const g = make({ sources: { reward: { chance: 0, s_chance: 1 } } })
    run(base, 'o_emp', 'done', 'S')
    const reports = run(g, 'o_emp', 'done', 'S')
    expect(rewardPendings(base)).toHaveLength(0)
    const pend = rewardPendings(g)
    expect(pend).toHaveLength(1)
    expect(pend[0]!.frame.brand).toBe('hz') // o_emp 的委託人是 f_brand
    expect(pend[0]!.frame.grade).toBeLessThanOrEqual(3)
    expect(['skin', 'plate']).toContain(pend[0]!.frame.type)
    // 現金：和 s_chance 為 0 的同一局一樣（不扣、也不加成）
    expect(cash(g)).toBe(cash(base))
    expect(jobOf(g.state, 'o_emp')!.payout).toMatchObject({ reward: 2400, pc_net: jobOf(base.state, 'o_emp')!.payout!.pc_net })
    expect(payout(reports).narration!.results!.some((l) => l.startsWith('雇主多給了一樣東西：'))).toBe(true)
    expect(jobOf(g.state, 'o_emp')!.payout!.extra![0]).toMatch(/^雇主多給了一樣東西：/)

    const a = make({ sources: { reward: { chance: 0, s_chance: 1 } } })
    run(a, 'o_emp', 'done', 'A')
    expect(rewardPendings(a)).toHaveLength(0)
    expect(jobOf(a.state, 'o_emp')!.payout!.extra).toBeUndefined()
  })

  it('雇主多給的：失敗與撤退不給；已經談了 extra 的委託不再問第二次', () => {
    const f = make({ sources: { reward: { chance: 0, s_chance: 1 } } })
    run(f, 'o_emp', 'failed', 'S')
    expect(rewardPendings(f)).toHaveLength(0)
    const r = make({ sources: { reward: { chance: 0, s_chance: 1 } } })
    take(r, 'o_emp', 'fx_p')
    doGo(r, 'o_emp')
    retreatStub(r)
    expect(rewardPendings(r)).toHaveLength(0)
    const once = make({ sources: { reward: { chance: 0, s_chance: 1 } } })
    run(once, 'o_own', 'done', 'S')
    expect(rewardPendings(once)).toHaveLength(1)
  })

  it('整合：生成的委託 chance 1 → 接案 → 做完，多一筆 reward，等級不超過委託與 III、類型在 part_types 裡', () => {
    const g = make({ sources: { reward: { chance: 1, s_chance: 0 } }, rep: 55 })
    let picked: Offer | null = null
    for (const day of DAYS) {
      g.state.time = { ...g.state.time, day }
      const row = board(g.k, g.state, 'fx_a').offers.find((r) => r.offer.extra && !r.block)
      if (row) { picked = row.offer; break }
    }
    expect(picked).not.toBeNull()
    take(g, picked!.id, 'fx_a')
    doGo(g, picked!.id)
    endStub(g, 'done', { rating: 'B' })
    const pend = rewardPendings(g)
    expect(pend).toHaveLength(1)
    expect(pend[0]!.frame.grade).toBeLessThanOrEqual(Math.min(picked!.commission.grade as number, 3))
    expect(['skin', 'plate']).toContain(pend[0]!.frame.type)
    expect(pend[0]!.frame.brand).toBe('doujin')
    expect(readFixer(g.state).pending).toEqual([])
  })
})

// ===================================================================================================================
// 訂做
// ===================================================================================================================

describe('訂做', () => {
  it('不在委託台被擋並說原因；攤位只在週六開（今天沒開被擋、週六可以）', () => {
    const g = make({ at: SHOP })
    expect(orderOptions(g.k, g.state).blocks).toContain('要在同人社團的委託台才能訂做。')
    expect(orderOptions(g.k, g.state).desk).toBeNull()
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 2 }))).toContain('委託台')
    expect(cash(g)).toBe(3000)

    const s = make({ at: STALL, day: 10 })
    expect(orderOptions(s.k, s.state).desk).toMatchObject({ type: 'fac_stall', open: false })
    expect(reasonOf(() => orderDraft(s.k, s.state, { type: 'skin', grade: 1 }))).toContain('今天沒有開（開在週六）')
    const sat = make({ at: STALL, day: 12 })
    expect(orderOptions(sat.k, sat.state).desk).toMatchObject({ open: true })
    expect(orderBlock(sat.k, sat.state, { type: 'skin', grade: 1 })).toBeNull()
    // 沒有勢力的攤位：好感用不上、牌子是 doujin
    expect(orderOptions(sat.k, sat.state).favor).toBeNull()
    sat.commit(orderDraft(sat.k, sat.state, { type: 'skin', grade: 1 }))
    expect(pendingParts(sat.state)[0]!.frame.brand).toBe('doujin')
  })

  it('選項：類型與方向、每一級的價錢（表價 × 1.5）、天數、同時一張；現金不夠的那一級寫原因', () => {
    const g = make({ cash: 1000 })
    const v = orderOptions(g.k, g.state)
    expect(v.blocks).toEqual([])
    expect(v.desk).toMatchObject({ type: 'fac_desk', brand: 'hz', faction: 'f_brand', open: true })
    expect(v.grades.map((r) => [r.grade, r.price, r.days])).toEqual([[1, 300, 3], [2, 900, 3], [3, 3000, 3]])
    expect(v.grades[2]!.block).toContain('現金晶片不夠')
    expect(v.grades[1]!.block).toBeNull()
    expect(v.max_open).toBe(1)
    const skin = v.types.find((t) => t.id === 'skin')!
    expect(skin).toMatchObject({ name: '外皮', bio: true })
    expect(skin.directions.map((d) => [d.name, d.tags])).toEqual([['風格', ['風格']], ['社交親和', ['社交']], ['防掃描', ['隱蔽']]])
    expect(v.types.find((t) => t.id === 'barrel')!.bio).toBe(false)
  })

  it('II 級扣 900 現金（600 × 1.5）、不乘區倍率、花 10 分鐘；pending 多一筆 hold: order，牌子是委託台的，備註存下', () => {
    const g = make()
    const t0 = now(g)
    const reports = g.commit(orderDraft(g.k, g.state, { type: 'skin', grade: 2, request: '想要像霧一樣的' }))
    expect(reports[0]!.action).toBe('unreg.order')
    expect(cash(g)).toBe(2100)
    expect(g.state.money.cred).toBe(5000)
    expect(now(g)).toBe(t0 + 10)
    const [p] = pendingParts(g.state)
    expect(p).toMatchObject({ source: 'order', hold: 'order', ready_at: t0 + 3 * 1440, request: '想要像霧一樣的' })
    expect(p!.frame).toMatchObject({ type: 'skin', grade: 2, brand: 'hz', material: 'mech' })
  })

  it('訂做不擲檢定、不動亂數的游標；第二張訂單被擋（同時一張）；max_open 可以改', () => {
    const g = make()
    const cursor = g.state.rng.cursor
    g.commit(orderDraft(g.k, g.state, { type: 'skin', grade: 1 }))
    expect(g.state.rng.cursor).toBe(cursor)
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 1 }))).toContain('同時最多 1 張')
    expect(orderOptions(g.k, g.state).blocks.join()).toContain('同時最多 1 張')
    const two = make({ sources: { order: { max_open: 2 } } })
    two.commit(orderDraft(two.k, two.state, { type: 'skin', grade: 1 }))
    two.commit(orderDraft(two.k, two.state, { type: 'plate', grade: 1 }))
    expect(reasonOf(() => orderDraft(two.k, two.state, { type: 'skin', grade: 1 }))).toContain('同時最多 2 張')
  })

  it('其餘的擋下：現金不夠、等級超過上限、不認得的類型、沒有生體版的給生體、方向與備註的格式', () => {
    const g = make({ cash: 800 })
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 2 }))).toContain('現金晶片不夠：要 900，你有 800。')
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 4 }))).toContain('I～III')
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 0 }))).toContain('I～III')
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'nope', grade: 1 }))).toContain('沒有「nope」這一類')
    expect(reasonOf(() => orderDraft(g.k, g.state, { grade: 1 }))).toContain('要指定零件的類型')
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'barrel', material: 'bio', grade: 1 }))).toContain('沒有生體版')
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 1, want: 'x' as never }))).toContain('想要的方向')
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 1, request: 'x'.repeat(81) }))).toContain('備註')
    expect(cash(g)).toBe(800)
    expect(unregOf(g.state).pending).toEqual([])
  })

  it('指定方向：want: [社交] 的框架裡有社交親和（親和 +1 以上）；沒指定時照種子', () => {
    const g = make()
    g.commit(orderDraft(g.k, g.state, { type: 'skin', grade: 2, want: ['社交'] }))
    const f = pendingParts(g.state)[0]!.frame
    expect(f.attrs.some((a) => a.option === 'sk_social')).toBe(true)
    expect(f.affinity.social).toBeGreaterThanOrEqual(1)
    const h = make()
    h.commit(orderDraft(h.k, h.state, { type: 'skin', grade: 2, want: ['sk_scan', '風格'] }))
    expect(pendingParts(h.state)[0]!.frame.attrs.slice(0, 2).map((a) => a.option)).toEqual(['sk_scan', 'sk_style'])
  })

  it('怪癖：好感 60 以上給兩筆可以挑；59 不給挑、給了 quirk 被擋；挑了候選以外的被擋；同一天問幾次一樣；挑的那一筆成為框架的怪癖', () => {
    const g = make()
    setFavor(g, 'f_brand', 59)
    let v = orderOptions(g.k, g.state)
    expect(v.favor).toBe(59)
    expect(v.quirk_pick).toBe(false)
    expect(v.types.every((t) => t.quirks.length === 0)).toBe(true)
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 1, quirk: 'qk_plain1' }))).toContain('好感要到 60')

    setFavor(g, 'f_brand', 60)
    v = orderOptions(g.k, g.state)
    expect(v.quirk_pick).toBe(true)
    const q = v.types.find((t) => t.id === 'skin')!.quirks
    expect(q).toHaveLength(2)
    expect(new Set(q.map((x) => x.id)).size).toBe(2)
    expect(q.every((x) => ['qk_plain1', 'qk_plain2', 'qk_plain3'].includes(x.id))).toBe(true)
    g.state.rng.cursor += 5
    expect(orderOptions(g.k, g.state).types.find((t) => t.id === 'skin')!.quirks).toEqual(q) // 同一天、同一個設施、同一個類型
    // 候選以外的（連查得到的怪癖也一樣）被擋
    const other = ['qk_plain1', 'qk_plain2', 'qk_plain3', 'qk_flaw'].find((id) => !q.some((x) => x.id === id))!
    expect(reasonOf(() => orderDraft(g.k, g.state, { type: 'skin', grade: 1, quirk: other }))).toContain('不在這一次的候選裡')
    g.commit(orderDraft(g.k, g.state, { type: 'skin', grade: 2, quirk: q[1]!.id }))
    expect(pendingParts(g.state)[0]!.frame.quirk).toMatchObject({ id: q[1]!.id })
  })

  it('取貨：三天內被擋並寫還要幾天；滿三天、人不在委託台被擋；回到委託台 deliverDraft 成功，零件進背包', () => {
    const g = make()
    g.commit(orderDraft(g.k, g.state, { type: 'skin', grade: 2, want: ['社交'] }))
    const id = pendingParts(g.state)[0]!.id
    expect(orderPickups(g.k, g.state)).toEqual([])
    expect(deliverBlock(g.k, g.state, id)).toBe('還要等 3 天。')
    goDay(g, 2)
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id }))).toBe('還要等 1 天。')
    goDay(g, 1)
    g.state.location = { ...SHOP }
    expect(reasonOf(() => deliverDraft(g.k, g.state, { id }))).toBe('要到同人社團的委託台取貨。')
    expect(orderPickups(g.k, g.state)).toEqual([])
    g.state.location = { ...DESK }
    expect(orderPickups(g.k, g.state).map((p) => p.id)).toEqual([id])
    const reports = g.commit(deliverDraft(g.k, g.state, { id }))
    expect(reports[0]!.action).toBe('unreg.deliver')
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(true)
    expect(unregOf(g.state).pending).toEqual([])
    // 取過之後可以再訂一張
    expect(orderBlock(g.k, g.state, { type: 'skin', grade: 1 })).toBeNull()
  })

  it('取貨：另一個委託台（攤位）也算；沒寫 unreg_desk 的設施不算', () => {
    const g = make()
    g.commit(orderDraft(g.k, g.state, { type: 'skin', grade: 1 }))
    const id = pendingParts(g.state)[0]!.id
    goDay(g, 3)
    g.state.location = { ...STALL }
    expect(deliverBlock(g.k, g.state, id)).toBeNull()
    g.state.location = { ...LOW }
    expect(deliverBlock(g.k, g.state, id)).toBe('要到同人社團的委託台取貨。')
  })

  it('沒有裝 world（沒有條件 at_facility）：到處都不是委託台', () => {
    const { game } = makeGame({ features: [securityFeature, favorsFeature, fixerFeature, unregFeature], content: [{ id: 'bare', content: { unreg_rule: [{ id: 'default', options: structuredClone(OPTIONS) }], quirk: structuredClone(QUIRKS) } as never }], seed: 7, pc: PC as never })
    expect(orderOptions(game.k, game.state).desk).toBeNull()
    expect(orderOptions(game.k, game.state).blocks).toContain('要在同人社團的委託台才能訂做。')
  })
})

// ===================================================================================================================
// 勢力的固定窗口
// ===================================================================================================================

describe('勢力的固定窗口', () => {
  const input = { faction: 'f_brand', type: 'skin', want: ['社交'] }

  it('好感 99 被擋（寫出差多少）；好感 100 但沒有大人情被擋；都成立：多一筆 IV 級、牌子是那個勢力的、大人情少一個、不花時間', () => {
    const g = make({ at: LOW })
    setFavor(g, 'f_brand', 99)
    owe(g, 'f_brand')
    expect(reasonOf(() => windowDraft(g.k, g.state, input))).toContain('好感要到 100（你現在 99）')
    setFavor(g, 'f_brand', 100)
    const h = make({ at: LOW })
    setFavor(h, 'f_brand', 100)
    expect(reasonOf(() => windowDraft(h.k, h.state, input))).toContain('欠你的大人情')
    expect(windowBlock(h.k, h.state, input)).toContain('社團或社團的老闆')

    const t0 = now(g)
    const before = favorsOf(g.state).owed_to_pc.length
    const reports = g.commit(windowDraft(g.k, g.state, input))
    expect(reports[0]!.action).toBe('unreg.window')
    expect(favorsOf(g.state).owed_to_pc.length).toBe(before - 1)
    expect(now(g)).toBe(t0)
    const p = pendingParts(g.state)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ source: 'window' })
    expect(p[0]!.hold).toBeUndefined()
    expect(p[0]!.frame).toMatchObject({ grade: 4, brand: 'hz', type: 'skin' })
    expect(p[0]!.frame.attrs.some((a) => a.option === 'sk_social')).toBe(true)
    expect(unregOf(g.state).once).toContain('window:f_brand')
  })

  it('同一個勢力第二次被擋（即使又有人情）；別的勢力不受影響，沒有 brand 的勢力牌子是勢力的 id', () => {
    const g = make()
    setFavor(g, 'f_brand', 100)
    setFavor(g, 'f_plain', 100)
    owe(g, 'f_brand')
    g.commit(windowDraft(g.k, g.state, input))
    owe(g, 'f_brand')
    expect(reasonOf(() => windowDraft(g.k, g.state, input))).toContain('已經用過了')
    expect(windowOptions(g.k, g.state).find((o) => o.faction === 'f_brand')).toMatchObject({ used: true })
    owe(g, 'f_plain')
    g.commit(windowDraft(g.k, g.state, { faction: 'f_plain', type: 'plate' }))
    expect(pendingParts(g.state).map((p) => p.frame.brand)).toEqual(['hz', 'f_plain'])
  })

  it('人情記在 leader 名下時也成立（用掉的是那一筆）；人情的大小要剛好是大人情', () => {
    const g = make()
    setFavor(g, 'f_brand', 100)
    owe(g, 'npc_boss', 'mid')
    expect(reasonOf(() => windowDraft(g.k, g.state, input))).toContain('欠你的大人情')
    owe(g, 'npc_boss', 'big')
    g.commit(windowDraft(g.k, g.state, input))
    expect(favorsOf(g.state).owed_to_pc.map((f) => [f.who, f.size])).toEqual([['npc_boss', 'mid']])
    expect(pendingParts(g.state)).toHaveLength(1)
  })

  it('windowOptions：每個勢力一列、帶原因與可以選的類型；不看人在哪裡；沒有人註冊 has_favor 時是空的；類型與方向的格式也擋', () => {
    const g = make({ at: LOW })
    const opts = windowOptions(g.k, g.state)
    expect(opts.map((o) => o.faction)).toEqual(['f_brand', 'f_plain'])
    expect(opts[0]).toMatchObject({ name: '社團', brand: 'hz', leader: 'npc_boss', favor: 10, favor_need: 100, grade: 4, used: false })
    expect(opts[1]).toMatchObject({ brand: 'f_plain' })
    expect(opts[0]!.blocks).toHaveLength(2) // 好感不夠、沒有人情：一條一個條件
    expect(opts[0]!.types.find((t) => t.id === 'skin')!.directions).toHaveLength(3)
    setFavor(g, 'f_brand', 100)
    owe(g, 'npc_boss')
    expect(windowOptions(g.k, g.state)[0]!.blocks).toEqual([])
    expect(windowBlock(g.k, g.state, { faction: 'f_brand' })).toContain('要指定零件的類型')
    expect(windowBlock(g.k, g.state, { faction: 'f_nope', type: 'skin' })).toContain('哪一個勢力')
    expect(windowBlock(g.k, g.state, { faction: 'f_brand', type: 'barrel', material: 'bio' })).toContain('沒有生體版')

    const none = make({ favors: false })
    expect(windowOptions(none.k, none.state)).toEqual([])
    expect(reasonOf(() => windowDraft(none.k, none.state, input))).toContain('沒有勢力的窗口')
  })
})

// ===================================================================================================================
// 口頭要到
// ===================================================================================================================

describe('口頭要到（part_unreg 的 source: ask）', () => {
  const ask = (more: Rec = {}): Rec => ({ kind: 'part_unreg', source: 'ask', who: 'npc_boss', type: 'skin', ...more })

  it('帶 who 給得出來（等級最高 II）；pending 多一筆，once 自動是 ask:<who>', () => {
    const g = make({ at: DESK })
    give(g, ask({ grade: 4 }))
    const p = pendingParts(g.state)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ source: 'ask' })
    expect(p[0]!.frame.grade).toBe(2)
    expect(unregOf(g.state).once).toContain('ask:npc_boss')
    // 沒寫等級：也不超過 II
    const h = make({ at: DESK })
    give(h, ask())
    expect(pendingParts(h.state)[0]!.frame.grade).toBe(2)
  })

  it('等級也不超過主角所在那一區的等級（一區 I 級的地方只給 I 級）', () => {
    const g = make({ at: LOW })
    give(g, ask({ grade: 2 }))
    expect(pendingParts(g.state)[0]!.frame.grade).toBe(1)
    const low = make({ at: LOW })
    give(low, ask())
    expect(pendingParts(low.state)[0]!.frame.grade).toBe(1)
    const hi = make({ at: DESK })
    give(hi, ask({ grade: 1 }))
    expect(pendingParts(hi.state)[0]!.frame.grade).toBe(1)
  })

  it('同一個人第二次落空並寫「<名字>已經送過你一件了。」；換一個人可以；明寫的 once_note 蓋掉預設', () => {
    const g = make()
    give(g, ask())
    const again = resolve(g, [ask()])
    expect(again.errors).toEqual([])
    expect(again.changes).toEqual([])
    expect(again.clamps.map((c) => c.notice)).toContain('社團的老闆已經送過你一件了。')
    expect(pendingParts(g.state)).toHaveLength(1)
    give(g, ask({ who: 'npc_fx' }))
    expect(pendingParts(g.state)).toHaveLength(2)
    const noted = resolve(g, [ask({ once_note: '他笑著搖了搖頭。' })])
    expect(noted.clamps.map((c) => c.notice)).toContain('他笑著搖了搖頭。')
  })

  it('沒帶 who 被擋（整批不收）；AI 與玩家要的被擋；who 不是字串被擋', () => {
    const g = make()
    const miss = resolve(g, [{ kind: 'part_unreg', source: 'ask', type: 'skin' }])
    expect(miss.errors.join()).toContain('一定要寫 who')
    expect(miss.changes).toEqual([])
    expect(resolve(g, [ask({ who: 3 })]).errors.join()).toContain('who')
    for (const source of ['ai', 'player'] as const) {
      const r = resolve(g, [ask()], source)
      expect(r.errors.join(), source).toContain('不是 AI 與玩家要的結果可以用的效果')
      expect(r.changes).toEqual([])
    }
    // 別的來源不用 who
    expect(resolve(g, [{ kind: 'part_unreg', source: 'gift', type: 'skin' }]).errors).toEqual([])
  })
})

// ===================================================================================================================
// 補：結構檢查
// ===================================================================================================================

describe('整體', () => {
  it('沒有人回答 fixer.reward（沒裝 unreg）時 fixer 照常跑：桌面、接案、結算都沒有 extra', () => {
    const g = make({ unreg: false, rep: 55 })
    const row = board(g.k, g.state, 'fx_a').offers[0]
    expect(row).toBeDefined()
    expect(row!.offer.extra).toBeUndefined()
    expect(row!.extra_label).toBeUndefined()
    take(g, row!.id, 'fx_a')
    expect(jobOf(g.state, row!.id)!.terms.extra).toBeUndefined()
    doGo(g, row!.id)
    const reports = endStub(g, 'done', { rating: 'S' })
    expect(payout(reports).outcome.result).toBe('paid')
    expect(jobOf(g.state, row!.id)!.payout!.extra).toBeUndefined()
  })

  it('terms.extra 讀檔時整理：格式壞掉的丟掉、不丟錯', () => {
    const g = make()
    take(g, 'o_own', 'fx_p')
    const raw = (g.state.ext.fixer as Rec).jobs[0]
    raw.terms.extra = { label: 3 }
    expect(jobOf(g.state, 'o_own')!.terms.extra).toBeUndefined()
    raw.terms.extra = { by: 'x', label: 'y', effects: [{ kind: 'part_unreg' }] }
    expect(jobOf(g.state, 'o_own')!.terms.extra).toMatchObject({ label: 'y' })
  })

  it('offerProblems 查 extra 的格式', () => {
    const o = { ...PROVIDED[0]!, extra: { by: 'x', label: '', cash_pct: 2, effects: [] } }
    expect(offerProblems(o).length).toBeGreaterThanOrEqual(3)
    expect(offerProblems({ ...PROVIDED[0]!, extra: EXTRA() })).toEqual([])
  })
})
