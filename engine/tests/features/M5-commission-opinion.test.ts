// 驗收測試：dev/work/M5-commission-opinion.md（cpp-feature）。features/commission 接上輿論面：開這一段給什麼、交回收什麼、決定性與否、被收買與被帶走、
// 評價與後果、資料檢查、資料慣例的兩拍（commission.enter、commission.milestone）、直播中不能走潛行。
// 規格：COMMISSIONS 2.1、2.3、第 3～5 節、第 8、11 節；DATA 9.1；COMMISSION_TEMPLATES「opinion_setup 的骨架」；OPINION 第 6 節；dev/adr/0020 第六節、第十三節、V36～V38。
// `face.opinion` 是測試自己登記的假活動（不 import features/opinion），交回什麼由測試決定；格式照 M5-opinion-face 的 activity.end（outcome 與 result）。
// 內容一律是測試自帶的最小假資料。敵對值的量表與條件 live_on 用測試裝的替身。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Report, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, endActivity, meterOf } from '../../src'
import {
  DEFAULT_OPINION_RULES, LIVE_STEALTH_TEXT, branchViews, chooseBranch, chooseFace, commissionFeature, commissionProblems, commissionView, fallout, faceViews, opinionFaceRules, rate, readRun, replay,
  ruleProblems, DEFAULT_COMMISSION_RULES,
} from '../../src/features/commission'
import { makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' }, { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門' }, { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '網路孔' }, { id: 'C1', at: [2, 3], mark: 'C', name: '控制面板' }, { id: '$1', at: [3, 5], mark: '$', name: '小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '人質' }, { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' }, { id: 'K1', at: [7, 7], mark: 'K', name: '掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' }, { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [{ id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light'] }, { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door'] }],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
const MAP = { id: 'map_office_small', kind: 'office_small', size: [9, 9], sheets: [OFFICE] }
const FACTIONS = ['hizakura', 'nora'].map((id) => ({ id, name: id, short: id, class: 'corp' }))
const SKILLS = [{ id: 'stealth', attr: 'reflex' }, { id: 'negotiate', attr: 'charm' }].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))

const OPEN_A = { voice: 1, cells: ['wall'] }
const op = (gives?: string, extra: Rec = {}): Rec => ({
  gives, rounds: 3, opponent: { strength: 2 }, ...extra,
  branches: [
    { id: 'assault', kind: 'assault' },
    { id: 'talk', kind: 'talk', open: OPEN_A },
    { id: 'via', kind: 'linked', need: { link: 'op_major' } },
  ],
})
const OPINION_SETUP = {
  topic: { id: 'tp', kind: 'ignite', rounds: 4 },
  opponent: { id: 'pr_x', strength: 1, named: '某人' },
  base: { voice: 2 },
  from_links: [{ link: 'op_major', voice: 2 }, { link: 'tip', add_card: 'card_inside_scoop' }, { link: 'op_lost', wind: -1 }],
  from_flags: [{ flag: 'x' }],
}
const LINKS = {
  tip: { type: 'open', name: '內線' },
  op_major: { type: 'ease', name: '大勝的餘威', effect: { alert_start: -5 } },
  op_minor: { type: 'open', name: '小勝的口碑' },
  op_lost: { type: 'open', name: '輸了的傳聞', effect: { alert_start: 3 } },
}

/** 三階段、主面是輿論；第一階段的輿論面有 record、gives tip。 */
const OP3: Rec = {
  id: 'op3', name: '三階段的輿論委託', kind: 'smear', main: 'opinion', scale: 'small', grade: 3, target_faction: 'hizakura', employer: 'nora', district: 'glass_shore',
  defeat_event: 'df_custom', modifiers: ['night_shift'], stream_goals: ['goal_a', 'goal_b'],
  opinion_setup: OPINION_SETUP, links: LINKS,
  stages: [
    { name: '造勢', faces: { opinion: op('tip', { record: { type: 'scandal', involves: { factions: ['hizakura'] } } }) } },
    { name: '對質', faces: { opinion: op() } },
    { name: '決戰', faces: { opinion: op() } },
  ],
}
/** 現實委託：第一階段現實或輿論（有 opinion_setup），第二、三階段現實。 */
const meat = (extra: Rec = {}): Rec => ({
  map: 'map_office_small', encounter: [], goal: { kind: 'reach', at: 'T3' }, branches: [{ id: 'assault', kind: 'assault', entry: 'E2' }], ...extra,
})
const REAL: Rec = {
  id: 'real', name: '現實委託', kind: 'steal_data', main: 'meat', scale: 'small', grade: 2, target_faction: 'hizakura', district: 'glass_shore',
  opinion_setup: OPINION_SETUP, links: LINKS,
  stages: [
    { faces: { meat: meat(), opinion: op('tip') } },
    { faces: { meat: meat() } },
    { faces: { meat: meat() } },
  ],
}
/** 直播的測試：輿論面與現實面各有一條潛行。 */
const STEALTHY: Rec = {
  ...REAL, id: 'stealthy', stages: [
    { faces: { meat: meat({ branches: [{ id: 'assault', kind: 'assault', entry: 'E2' }, { id: 'sneak', kind: 'stealth', entry: 'E2' }, { id: 'chat', kind: 'talk', entry: 'E2' }] }) } },
    { faces: { meat: meat() } },
    { faces: { meat: meat() } },
  ],
}
/** 沒有 opinion_setup 的輿論委託（舊寫法）：只在沒有輿論戰內容的世界收。 */
const bare = (): Rec => ({ branches: [{ id: 'assault', kind: 'assault' }] })
const OLD: Rec = { ...OP3, id: 'old', stages: [{ faces: { opinion: bare() } }, { faces: { opinion: bare() } }, { faces: { opinion: bare() } }] }
delete OLD.opinion_setup

const PACK: ContentPack = {
  id: 'm5_commission_opinion',
  content: {
    skill: SKILLS, faction: FACTIONS, special_map: [MAP as never], commission: [OP3 as never, REAL as never, STEALTHY as never],
    defeat_event: [{ id: 'df_custom', name: '副本自訂的戰敗', kind: 'custom', factions: [], fails_commission: true, versions: { default: { text: '你被帶走了。', effects: [] } } }],
  },
}

// ---- 替身 ----

/** 輿論戰的玩法的替身：登記 face.opinion，開的時候把 setup 與 origin 記在 ext；由測試用 endOp 交回結果。 */
const FAKE_OP: Feature = {
  id: 'fake_op',
  install(k) {
    k.activity.define({
      kind: 'face.opinion', owner: 'fake_op', order: 50,
      active: (s) => (s.ext.fake_op ? { id: 'face.opinion', label: '輿論' } : null),
      allow: ['commit:fake_op.'], reason: () => '替身活動開著。',
      start: (_k, _s, setup, origin) => [{
        kind: 'event', action: 'fake_op.open', location: {}, party: [], timeline: [],
        changes: [{ op: 'ext', key: 'fake_op', value: { setup, origin } }], outcome: { result: 'open', summary: 'face.opinion 開了。' },
      }],
    })
    k.activity.allow('commission', 'face.opinion.start', 'fake_op')
    k.activity.allow('commission', 'commit:fake_op.', 'fake_op')
  },
}
/** opinion 功能的內容種類（對手）：世界裡有它，副本的輿論面照新的規矩檢查。 */
const OPINION_KINDS: Feature = { id: 'op_kinds', install(k) { k.content.defineKind({ kind: 'pr_opponent', owner: 'op_kinds', validate: () => [] }) } }
const DEFEAT_KIND: Feature = { id: 'toy_defeat_kind', install(k) { k.content.defineKind({ kind: 'defeat_event', owner: 'toy_defeat_kind', validate: () => [] }) } }
const HOSTILITY = meterFeature(testMeter({ kind: 'hostility', owner: 'test_security', name: '敵對值', keyed: 'faction', min: 0, max: 100, start: 0, cap: { down: 20, up: 20 } }))
const LIVE = { on: false }
const LIVE_COND: Feature = {
  id: 'toy_live',
  install(k) { k.conditions.register({ kind: 'live_on', owner: 'toy_live', validate: () => [], test: () => LIVE.on, describe: () => '要正在直播' } as never) },
}

const SEEN: { ends: Array<{ kind: string; outcome: string; origin: Rec; result: Rec }> } = { ends: [] }
const OBSERVER: Feature = {
  id: 'observer',
  install(k) { k.hooks.on('activity.end', 'observer', ({ kind, outcome, origin, result }) => { SEEN.ends.push({ kind, outcome, origin: origin as never, result }) }) },
}
const endsOf = (kind: string) => SEEN.ends.filter((e) => e.kind === kind)

interface Opts { seed?: number; content?: ContentPack[]; features?: Feature[]; noOpinion?: boolean; noKinds?: boolean; live?: boolean }
function setup(o: Opts = {}) {
  SEEN.ends.length = 0
  LIVE.on = false
  return makeGame({
    seed: o.seed,
    features: [commissionFeature, DEFEAT_KIND, ...(o.noOpinion ? [] : [FAKE_OP]), ...(o.noKinds ? [] : [OPINION_KINDS]), HOSTILITY, OBSERVER, ...(o.live === false ? [] : [LIVE_COND]), ...(o.features ?? [])],
    content: o.content ?? [PACK],
    pc: { attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 }, skills: { stealth: 3, negotiate: 3 } } as never,
    actors: [makeActor({ id: 'a', name: '人a', role: 'npc', skills: {} })],
  })
}
type G = ReturnType<typeof setup>['game']

const origin = { by: 'fixer', ref: 'fx_1' }
const enter = (g: G, def = 'op3', extra: Rec = {}) => g.launch('commission', { def, ...extra }, origin)
const runOf = (g: G) => readRun(g.state)!
const view = (g: G) => commissionView(g.k, g.state)!
const face = (g: G, f: 'meat' | 'net' | 'opinion' = 'opinion') => g.commit(chooseFace(g.k, g.state, f))
const pick = (g: G, id = 'assault', input: Rec = {}) => g.commit(chooseBranch(g.k, g.state, id, input))
const hostilityOf = (g: G, f = 'hizakura') => meterOf(g.k, g.state, 'hostility', f)
const opened = (g: G) => g.state.ext.fake_op as { setup: Rec; origin: Rec }
const reason = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}

/** 替身活動交回：照規矩用 endActivity 發 activity.end，結束那份報告帶上 launch、rewind。 */
function endOp(g: G, outcome: string, result: Rec = {}, clear = true): Report[] {
  const open = opened(g)
  const end = endActivity(g.k, { state: g.state, kind: 'face.opinion', id: 'face.opinion', origin: open.origin as never, outcome, result })
  const d: ReportDraft = {
    kind: 'event', action: 'fake_op.close', location: {}, party: [], timeline: [], changes: [...(clear ? [{ op: 'ext', key: 'fake_op', value: null } as never] : []), ...end.changes],
    outcome: { result: outcome, summary: `face.opinion ${outcome}。` }, narration: { results: end.lines },
  }
  return g.commit(attachActivityEnd(d, end))
}
/** 一個輿論階段從頭到交回：選輿論、選分支、交回。 */
function playOp(g: G, outcome: string, result: Rec = {}, branch = 'assault', input: Rec = {}): Report[] {
  face(g)
  pick(g, branch, input)
  return endOp(g, outcome, { you: 10, foe: 4, ...result })
}

// ===================================================================================================================

describe('輿論面選得了選不了', () => {
  it('沒有人登記 face.opinion：輿論面照舊選不了；登記之後選得了', () => {
    const none = setup({ noOpinion: true }).game
    enter(none, 'real')
    expect(faceViews(none.k, runOf(none)).find((f) => f.face === 'opinion')).toMatchObject({ open: true, block: '這一面還沒有開放。' })
    const g = setup().game
    enter(g)
    expect(faceViews(g.k, runOf(g)).find((f) => f.face === 'opinion')!.block).toBeNull()
    expect(face(g).map((r) => r.action)).toEqual(['commission.face'])
  })

  it('沒有人登記時主面是輿論的委託進不去（最後一個階段沒有選得了的面）', () => {
    const none = setup({ noOpinion: true }).game
    expect(reason(() => enter(none))).toContain('沒有選得了的面')
  })
})

describe('開這一段（faceLaunch）', () => {
  it('假活動收到 opinion（面的 rounds、opponent 蓋掉副本的）、route、decisive、where、employer、links、分支的 open、desk、bring、outsource', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'minor')
    expect(runOf(g)).toMatchObject({ stage: 2, links: expect.arrayContaining([expect.objectContaining({ id: 'tip' }), expect.objectContaining({ id: 'op_minor' })]) })
    face(g)
    const reports = pick(g, 'talk', { desk: ['a', { actor: 'b', ep: 1 }], bring: ['ft1', 'ft2'], outsource: 'a' })
    expect(reports.map((r) => r.action)).toEqual(['commission.branch', 'fake_op.open'])
    const { setup: s, origin: o } = opened(g)
    expect(s).toMatchObject({
      commission: 'op3', stage: 2, face: 'opinion', branch: 'talk', branch_kind: 'talk', grade: 3, faction: 'hizakura', links: ['op_minor', 'tip'], decisive: false, employer: 'nora',
      where: { kind: 'smear', face: 'opinion', faction: 'hizakura', tags: ['night_shift'] },
      route: [{ stage: 1, face: 'opinion', branch: 'assault', kind: 'assault' }],
      open: OPEN_A, desk: ['a', { actor: 'b', ep: 1 }], bring: ['ft1', 'ft2'], outsource: 'a',
    })
    // 面的 rounds 蓋掉議題與副本的、opponent 一個一個欄位蓋（id 與 named 留著，strength 換成面的）
    expect(s.opinion).toEqual({ ...OPINION_SETUP, rounds: 3, opponent: { id: 'pr_x', strength: 2, named: '某人' } })
    // 面自己的 rounds、opponent、gives、branches 不再當面的資料帶過去；record 是給里程碑那一拍的
    for (const key of ['rounds', 'opponent', 'gives', 'branches', 'record']) expect(s).not.toHaveProperty(key)
    // 副本自訂的戰敗事件跟著 origin.ext（被帶走時戰敗的入口讀它；M5-defeat-entry）
    expect(o).toEqual({ by: 'commission', ref: 'op3', ext: { commission: 'op3', stage: 2, face: 'opinion', defeat_event: 'df_custom' } })
    expect(runOf(g)).toMatchObject({ step: 'play', face: 'opinion', pick: { desk: ['a', { actor: 'b', ep: 1 }], bring: ['ft1', 'ft2'], outsource: 'a' } })
    expect(view(g).goal).toMatchObject({ kind: 'face', done: false })
  })

  it('最後一個階段 decisive 是 true；沒給 desk、bring 就不帶；選別的面不記 pick', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'minor')
    playOp(g, 'minor')
    face(g)
    pick(g)
    expect(opened(g).setup).toMatchObject({ stage: 3, decisive: true })
    for (const key of ['desk', 'bring', 'outsource', 'open']) expect(opened(g).setup).not.toHaveProperty(key)
    expect(runOf(g)).not.toHaveProperty('pick')
  })

  it('壞的 desk、bring、outsource：整步不成立', () => {
    const { game: g } = setup()
    enter(g)
    face(g)
    expect(reason(() => chooseBranch(g.k, g.state, 'assault', { desk: 'a' as never }))).toContain('desk')
    expect(reason(() => chooseBranch(g.k, g.state, 'assault', { bring: [1] as never }))).toContain('bring')
    expect(reason(() => chooseBranch(g.k, g.state, 'assault', { outsource: '' }))).toContain('outsource')
    expect(runOf(g).step).toBe('branch')
  })

  it('沒有寫輿論戰的設定（舊寫法，在沒有輿論戰內容的世界收進來）：這一步不成立、原因是「這件委託沒有寫輿論戰的設定。」', () => {
    const { game: g } = setup({ noKinds: true, content: [{ ...PACK, content: { ...PACK.content, commission: [OLD as never] } } as ContentPack] })
    enter(g, 'old')
    face(g)
    expect(reason(() => chooseBranch(g.k, g.state, 'assault'))).toBe('這件委託沒有寫輿論戰的設定。')
    expect(runOf(g).step).toBe('branch')
  })

  it('同一個副本兩場輿論戰：第一場大勝之後，第二場收到的 links 有 op_major（from_links 讀得到）', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'major')
    face(g)
    pick(g)
    expect((opened(g).setup.links as string[])).toEqual(expect.arrayContaining(['tip', 'op_major']))
  })

  it('重來這一場之後（副本停在選完分支、這一段還沒開）：replay 再開一次，desk、bring 還在', () => {
    const { game: g } = setup()
    enter(g)
    face(g)
    pick(g, 'assault', { desk: ['a'], bring: ['ft1'] })
    // 模擬 opinion 回到開戰前的快照：活動不在了，副本還在 play 步驟
    g.commit({ kind: 'system', action: 'fake_op.clear', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'fake_op', value: null }], outcome: { result: 'ok', summary: '測試' } })
    const again = g.commit(replay(g.k, g.state))
    expect(again.map((r) => r.action)).toEqual(['commission.replay', 'fake_op.open'])
    expect(opened(g).setup).toMatchObject({ stage: 1, desk: ['a'], bring: ['ft1'], decisive: false })
  })
})

describe('交回：不是最後一個階段（V38）', () => {
  it('major：給 op_major 與這一面的 gives；進下一個階段；Run.opinion 記一筆', () => {
    const { game: g } = setup()
    enter(g)
    const reports = playOp(g, 'major', { you: 9, foe: 2 })
    expect(reports.map((r) => r.action)).toEqual(['fake_op.close', 'commission.milestone'])
    expect(runOf(g)).toMatchObject({ stage: 2, step: 'face', alert: 0 })
    expect(runOf(g).links.map((l) => [l.id, l.face, l.from])).toEqual([['op_major', 'opinion', 1], ['tip', 'opinion', 1]])
    expect(runOf(g).opinion).toEqual([{ stage: 1, outcome: 'major', you: 9, foe: 2 }])
    expect(hostilityOf(g)).toBe(0)
  })

  it('minor：給 op_minor 與 gives', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'minor')
    expect(runOf(g).links.map((l) => l.id)).toEqual(['op_minor', 'tip'])
    expect(runOf(g).stage).toBe(2)
  })

  it('draw：什麼都不給（連 gives 也沒有），也進下一個階段，警戒與敵對值不動', () => {
    const { game: g } = setup()
    enter(g)
    const reports = playOp(g, 'draw')
    expect(runOf(g)).toMatchObject({ stage: 2, step: 'face', links: [], alert: 0 })
    expect(hostilityOf(g)).toBe(0)
    expect(JSON.stringify(reports.at(-1)!.narration)).toContain('沒有贏')
  })

  it('lost：給 op_lost、不給 gives、警戒 +10、目標勢力敵對值 +3；進下一個階段', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'lost', { you: 1, foe: 8 })
    expect(runOf(g)).toMatchObject({ stage: 2, step: 'face', alert: 10, peak: 10 })
    expect(runOf(g).links.map((l) => l.id)).toEqual(['op_lost'])
    expect(hostilityOf(g)).toBe(3)
    expect(hostilityOf(g, 'nora')).toBe(0)
  })

  it('副本沒有寫 op_*：連動不給（警戒與敵對值照加）', () => {
    const plain = (g2?: string): Rec => ({ ...(g2 ? { gives: g2 } : {}), rounds: 3, branches: [{ id: 'assault', kind: 'assault' }] })
    const def = { ...OP3, id: 'no_links', links: { tip: LINKS.tip }, stages: [{ faces: { opinion: plain('tip') } }, { faces: { opinion: plain() } }, { faces: { opinion: plain() } }], opinion_setup: { ...OPINION_SETUP, from_links: [{ link: 'op_lost', wind: -1 }] } }
    const { game: g } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [def as never] } } as ContentPack] })
    enter(g, 'no_links')
    playOp(g, 'lost')
    expect(runOf(g).links).toEqual([])
    expect(runOf(g).alert).toBe(10)
  })

  it('階段只結算一次：同樣的 activity.end 再交回一次，什麼都不會多給', () => {
    const { game: g } = setup()
    enter(g)
    face(g)
    pick(g)
    const open = opened(g)
    endOp(g, 'lost', { you: 1, foe: 8 })
    const before = JSON.stringify([runOf(g), hostilityOf(g), g.state.reports.length])
    const end = endActivity(g.k, { state: g.state, kind: 'face.opinion', id: 'face.opinion', origin: open.origin as never, outcome: 'lost', result: {} })
    expect(end.changes).toEqual([])
    expect(JSON.stringify([runOf(g), hostilityOf(g), g.state.reports.length])).toBe(before)
    expect(runOf(g)).toMatchObject({ alert: 10, stage: 2 })
    expect(hostilityOf(g)).toBe(3)
  })

  it('不認得的結果：這一段沒有完成，可以再來一次', () => {
    const { game: g } = setup()
    enter(g)
    face(g)
    pick(g)
    endOp(g, 'unknown')
    expect(runOf(g)).toMatchObject({ stage: 1, step: 'play', done: false })
  })

  it('連動 op_lost 的效果（alert_start +3）對下一個階段生效；警戒 +10 之上再加', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'lost')
    expect(view(g).links.find((l) => l.id === 'op_lost')).toMatchObject({ stage: 2, used: false })
  })

  it('規則：commission_rule 蓋掉警戒與敵對值；沒蓋照預設（10、3、3、5）', () => {
    expect(DEFAULT_OPINION_RULES).toEqual({ op_lost_alert: 10, op_lost_hostility: 3, op_enemy_hostility: 3, op_bribe_favor: 5 })
    const pack = { ...PACK, content: { ...PACK.content, commission_rule: [{ id: 'default', op_lost_alert: 20, op_lost_hostility: 1 }] } } as ContentPack
    const { game: g } = setup({ content: [pack] })
    expect(opinionFaceRules(g.k)).toEqual({ ...DEFAULT_OPINION_RULES, op_lost_alert: 20, op_lost_hostility: 1 })
    enter(g)
    playOp(g, 'lost')
    expect(runOf(g).alert).toBe(20)
    expect(hostilityOf(g)).toBe(1)
    expect(ruleProblems({ op_lost_alert: 101 }).join('；')).toContain('op_lost_alert')
    expect(ruleProblems({ op_bribe_favor: 'x' }).join('；')).toContain('op_bribe_favor')
    expect(ruleProblems({ op_lost_alert: 5, op_enemy_hostility: 0 })).toEqual([])
  })
})

describe('交回：決定性的一步（V37）', () => {
  const toLast = (g: G) => { enter(g); playOp(g, 'minor'); playOp(g, 'minor'); face(g); pick(g) }

  it('minor（或 major）：這一段做完，委託做完入帳（commission 的 activity.end outcome done）', () => {
    const { game: g } = setup()
    toLast(g)
    const reports = endOp(g, 'minor', { you: 8, foe: 6 })
    expect(reports.map((r) => r.action)).toEqual(['fake_op.close', 'commission.milestone', 'commission.finish'])
    expect(readRun(g.state)).toBeNull()
    expect(endsOf('commission').at(-1)).toMatchObject({ outcome: 'done', result: { commission: 'op3', opinion: [{ stage: 1 }, { stage: 2 }, { stage: 3, outcome: 'minor' }] } })
    expect(g.state.snapshots).toEqual([])
  })

  it('lost（opinion 已經處理過三選一，交回的是被接受的）：留失敗的記號、回到入口、發一次 commission.failed', () => {
    const { game: g } = setup()
    toLast(g)
    const reports = endOp(g, 'lost', { you: 2, foe: 9, board: 'draw' })
    expect(reports.slice(-2).map((r) => r.action)).toEqual(['rewind', 'commission.failed'])
    expect(readRun(g.state)).toBeNull()
    expect(endsOf('commission').filter((e) => e.outcome === 'failed')).toHaveLength(1)
    expect(endsOf('commission').at(-1)).toMatchObject({ outcome: 'failed', result: { rating: 'C', xp: 0, defeat: { opinion: true, outcome: 'lost', you: 2, foe: 9 } } })
    expect(g.state.ext.commission_failed).toMatchObject({ commission: 'op3', pending: false })
    expect(hostilityOf(g)).toBe(0)
    expect(g.state.snapshots).toEqual([])
  })

  it('draw 交回到決定性的一步也算沒有達成', () => {
    const { game: g } = setup()
    toLast(g)
    endOp(g, 'draw')
    expect(readRun(g.state)).toBeNull()
    expect(endsOf('commission').at(-1)).toMatchObject({ outcome: 'failed' })
  })

  it('lost 帶 bribed：一樣失敗回到入口（錢是 opinion 的事）；結果帶著 bribed', () => {
    const { game: g } = setup()
    toLast(g)
    endOp(g, 'lost', { bribed: 3000 })
    expect(readRun(g.state)).toBeNull()
    expect(endsOf('commission').at(-1)).toMatchObject({ outcome: 'failed', result: { defeat: { bribed: 3000 } } })
    expect(endsOf('commission').filter((e) => e.outcome === 'failed')).toHaveLength(1)
  })

  it('被帶走（captured）：同樣失敗回到入口，結果帶 captured；不是最後一個階段也一樣', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'lost', { captured: true })
    expect(readRun(g.state)).toBeNull()
    expect(endsOf('commission').at(-1)).toMatchObject({ outcome: 'failed', result: { defeat: { captured: true } } })
    const h = setup().game
    enter(h)
    playOp(h, 'major', { bribed: 500 })
    expect(readRun(h.state)).toBeNull()
  })
})

describe('評價與後果', () => {
  it('贏了的輿論階段算一個「交涉成功的階段」：+1；輸了、平手不算；同一個階段只算一次', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'major')
    const rules = DEFAULT_COMMISSION_RULES
    expect(rate(runOf(g), rules, 0, 0).parts).toMatchObject({ stealth: 1, score: 1 })
    expect(rate(runOf(g), rules, 0, 0).rating).toBe('A')
    playOp(g, 'draw')
    expect(rate(runOf(g), rules, 0, 0).parts.stealth).toBe(1)
    const h = setup().game
    enter(h)
    playOp(h, 'lost')
    expect(rate(runOf(h), rules, 0, 0).parts.stealth).toBe(0)
  })

  it('路線的後果：有階段走了輿論留下「公開的敵人」（預設 +3，一件委託一次）；commissionView 帶每一場的結果', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'minor')
    expect(fallout(runOf(g), DEFAULT_COMMISSION_RULES)).toMatchObject({ faction: 'hizakura', delta: 3, opinion: { stages: 1, delta: 3 } })
    playOp(g, 'major')
    expect(fallout(runOf(g), DEFAULT_COMMISSION_RULES).opinion).toEqual({ stages: 2, delta: 3 })
    expect(fallout(runOf(g), DEFAULT_COMMISSION_RULES, undefined, { ...DEFAULT_OPINION_RULES, op_enemy_hostility: 5 }).delta).toBe(5)
    expect(view(g).opinion).toEqual([{ stage: 1, outcome: 'minor', you: 10, foe: 4 }, { stage: 2, outcome: 'major', you: 10, foe: 4 }])
    expect(view(g).close.fallout.opinion).toBeDefined()
    expect(view(g).close.parts.stealth).toBe(2)
  })

  it('做完：目標勢力敵對值只加一次公開的敵人（沒有輸過），結果帶 hostility.opinion 與評價', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'minor')
    playOp(g, 'major')
    playOp(g, 'minor')
    expect(hostilityOf(g)).toBe(3)
    expect(endsOf('commission').at(-1)).toMatchObject({ outcome: 'done', result: { rating: 'S', hostility: { faction: 'hizakura', delta: 3, opinion: { stages: 3, delta: 3 } } } })
  })

  it('非決定性輸了 +3，做完再加公開的敵人 +3', () => {
    const { game: g } = setup()
    enter(g)
    playOp(g, 'lost')
    playOp(g, 'draw')
    playOp(g, 'minor')
    expect(hostilityOf(g)).toBe(6)
  })

  it('沒有走輿論的路線沒有 opinion 這一項', () => {
    const { game: g } = setup()
    enter(g, 'real')
    expect(fallout(runOf(g), DEFAULT_COMMISSION_RULES)).not.toHaveProperty('opinion')
  })
})

describe('現實委託的第一階段可以選輿論', () => {
  it('選輿論：假活動收到 opinion；交回之後進第二階段（現實）', () => {
    const { game: g } = setup()
    enter(g, 'real')
    expect(view(g).faces.map((f) => [f.face, f.block])).toEqual([['meat', null], ['net', '這個階段沒有開這一面。'], ['opinion', null]])
    playOp(g, 'minor')
    expect(runOf(g)).toMatchObject({ stage: 2, step: 'face' })
    expect(runOf(g).links.map((l) => l.id)).toEqual(['op_minor', 'tip'])
    expect(view(g).faces.find((f) => f.face === 'opinion')!.open).toBe(false)
    expect(opened(g)).toBeUndefined()
  })
})

describe('資料慣例的兩拍', () => {
  it('進副本那一份有 commission.enter 一拍：id、grade、faction、stream_goals', () => {
    const { game: g } = setup()
    const reports = enter(g)
    const beat = reports[0]!.timeline.find((b) => b.tag === 'commission.enter')!
    expect(beat.data).toEqual({ id: 'op3', grade: 3, faction: 'hizakura', stream_goals: ['goal_a', 'goal_b'] })
    const h = setup().game
    expect(enter(h, 'real')[0]!.timeline.find((b) => b.tag === 'commission.enter')!.data).toEqual({ id: 'real', grade: 2, faction: 'hizakura', stream_goals: [] })
  })

  it('里程碑那一份有 commission.milestone 一拍：id、stage、face、faction、grade、record（面的資料寫了才有）', () => {
    const { game: g } = setup()
    enter(g)
    const r1 = playOp(g, 'minor').find((r) => r.action === 'commission.milestone')!
    expect(r1.timeline.find((b) => b.tag === 'commission.milestone')!.data).toEqual({
      id: 'op3', stage: 1, face: 'opinion', faction: 'hizakura', grade: 3, record: { type: 'scandal', involves: { factions: ['hizakura'] } },
    })
    const r2 = playOp(g, 'minor').find((r) => r.action === 'commission.milestone')!
    expect(r2.timeline.find((b) => b.tag === 'commission.milestone')!.data).toEqual({ id: 'op3', stage: 2, face: 'opinion', faction: 'hizakura', grade: 3 })
  })
})

describe('直播中不能走潛行', () => {
  const stealthy = (o: Opts = {}) => {
    const g = setup(o).game
    enter(g, 'stealthy')
    face(g, 'meat')
    return g
  }
  const blocks = (g: G) => Object.fromEntries(branchViews(g.k, g.state, runOf(g)).map((b) => [b.id, b.block]))

  it('live_on 的替身成立：潛行的分支灰掉、原因對；強攻與交涉照舊；選了丟 ActionBlocked', () => {
    const g = stealthy()
    LIVE.on = true
    expect(blocks(g)).toEqual({ assault: null, sneak: LIVE_STEALTH_TEXT, chat: null })
    expect(LIVE_STEALTH_TEXT).toBe('正在直播，沒辦法悄悄進去。')
    expect(reason(() => chooseBranch(g.k, g.state, 'sneak'))).toBe(LIVE_STEALTH_TEXT)
    expect(runOf(g).step).toBe('branch')
  })

  it('不成立：照舊；沒有人註冊條件：照舊', () => {
    const g = stealthy()
    expect(blocks(g)).toEqual({ assault: null, sneak: null, chat: null })
    const h = stealthy({ live: false })
    expect(blocks(h)).toEqual({ assault: null, sneak: null, chat: null })
  })
})

describe('資料檢查', () => {
  const bad = (patch: Rec, base: Rec = OP3, strict = true) => commissionProblems({ ...base, ...patch } as never, strict).join('；')
  const stagesWith = (f: Rec, last: Rec = op()) => [{ faces: { opinion: f } }, { faces: { opinion: op() } }, { faces: { opinion: last } }]

  it('好的副本沒有問題', () => {
    expect(commissionProblems(OP3)).toEqual([])
    expect(commissionProblems(REAL)).toEqual([])
  })

  it('開了輿論面而沒有 opinion_setup：不收（世界裡沒有輿論戰的內容時照舊收）', () => {
    expect(bad({ opinion_setup: undefined })).toContain('opinion_setup 要寫')
    expect(bad({ opinion_setup: undefined }, OP3, false)).toBe('')
    const { game: g } = setup()
    expect(reason(() => enter(g, 'nope'))).toContain('沒有 nope')
    expect(reason(() => g.launch('commission', { def: { ...OLD, id: 'inline_old' } }, origin))).toContain('opinion_setup 要寫')
    const lenient = setup({ noKinds: true }).game
    lenient.launch('commission', { def: { ...OLD, id: 'inline_old' } }, origin)
    expect(readRun(lenient.state)!.def.id).toBe('inline_old')
  })

  it('opinion_setup 缺 topic 或 opponent、格式不對', () => {
    expect(bad({ opinion_setup: { ...OPINION_SETUP, topic: undefined } })).toContain('opinion_setup.topic')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, opponent: undefined } })).toContain('opinion_setup.opponent')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, opponent: { strength: 1 } } })).toContain('opinion_setup.opponent.id')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, opponent: { id: 'x', strength: 0 } } })).toContain('strength')
    expect(bad({ opinion_setup: 'x' })).toContain('opinion_setup 要是')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, base: { voice: 'x' } } })).toContain('base.voice')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, rounds: 0 } })).toContain('rounds')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, from_links: 'x' } })).toContain('from_links 要是陣列')
  })

  it('from_links 指到的連動要在 links 裡或是三個保留的鍵（op_major、op_minor、op_lost）', () => {
    expect(bad({ opinion_setup: { ...OPINION_SETUP, from_links: [{ link: 'ghost' }] } })).toContain('ghost')
    expect(bad({ links: { tip: LINKS.tip, op_major: LINKS.op_major }, opinion_setup: { ...OPINION_SETUP, from_links: [{ link: 'op_minor', voice: 1 }] } })).toBe('')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, from_links: [{ voice: 1 }] } })).toContain('from_links[0].link')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, from_links: [{ link: 'tip', add_card: 1 }] } })).toContain('add_card')
    expect(bad({ opinion_setup: { ...OPINION_SETUP, from_links: [{ link: 'tip', opponent_pr_first_round: 1.5 }] } })).toContain('opponent_pr_first_round')
  })

  it('輿論面的分支種類只有 assault、talk、linked、scouted：寫 stealth 擋下；分支的 open 與面的 rounds、opponent 查格式', () => {
    const stealthFace = op('tip')
    ;(stealthFace.branches as Rec[]).push({ id: 'sneak', kind: 'stealth' })
    expect(bad({ stages: stagesWith(stealthFace) })).toContain('輿論面沒有潛行')
    expect(bad({ stages: stagesWith(stealthFace) }, OP3, false)).toBe('')
    const openBad = op('tip')
    ;(openBad.branches as Rec[])[1].open = { voice: 'x', cells: 'y' }
    expect(bad({ stages: stagesWith(openBad) })).toMatch(/open\.voice.*open\.cells/)
    expect(bad({ stages: stagesWith(op('tip', { rounds: 0 })) })).toContain('.rounds')
    expect(bad({ stages: stagesWith(op('tip', { opponent: 5 })) })).toContain('.opponent')
  })

  it('主面是輿論的委託最後一個階段只有輿論面', () => {
    const last = [{ faces: { opinion: op() } }, { faces: { opinion: op() } }, { faces: { opinion: op(), meat: meat() } }]
    expect(bad({ stages: last })).toContain('最後一個階段只有主面')
    const noMain = [{ faces: { opinion: op() } }, { faces: { opinion: op() } }, { faces: { meat: meat() } }]
    expect(bad({ stages: noMain })).toContain('最後一個階段要有主面')
  })

  it('stream_goals 要是字串的陣列', () => {
    expect(bad({ stream_goals: 'goal_a' })).toContain('stream_goals 要是字串的陣列')
    expect(bad({ stream_goals: [1] })).toContain('stream_goals')
    expect(bad({ stream_goals: ['ok'] })).toBe('')
  })
})
