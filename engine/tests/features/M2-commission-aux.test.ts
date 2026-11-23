// 驗收測試：dev/work/M2-commission-aux.md（cpp-feature）。委託副本的輔助面：每個階段選面時，派了人、玩家沒選的面各擲一次，連動當場生效，自然 1 出事。
// 規格：COMMISSIONS 2.3 節（輔助面只能部署在這個階段可選、但玩家沒選的面上）、6.2～6.5 節；UI 7.4 節「輔助結算」；dev/adr/0016 第三節（共用的狀況 injured）。
// 內容一律是測試自帶的最小假資料：一件五階段的假副本（遭遇都是空的，所以不需要敵人）、DATA 9.3 節的小辦公室、三條假路數（只有 domains）、幾個假角色。
// 內海的玩法登記成替身（玩家選內海才選得了）；輿論面沒有登記任何玩法，輔助面照樣擲得了。
//
// 擲骰的測試不假設骰面：對每個種子先算「這一面擲出幾」（呼叫純函式的草稿看結果），挑到要的那個種子再提交。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Report, ReportDraft } from '../../src'
import { toMinutes } from '../../src'
import {
  auxChance, chooseBranch, chooseFace, classifyAux, commissionFeature, commissionRules, commissionView, effectsFor, readRun, ruleProblems,
} from '../../src/features/commission'
import type { CommissionEntry, Face } from '../../src/features/commission'
import { makeActor, makeGame, observed, stateHash } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

/** DATA 9.3 節的小辦公室。E3 正門、E1 窗、G1 主角要走到的地方（目標 reach）。 */
const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '主管室的控制面板' },
    { id: '$1', at: [3, 5], mark: '$', name: '檔案間的小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [
    { id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] },
    { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] },
  ],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
const MAP = { id: 'map_office_small', kind: 'office_small', size: [9, 9], sheets: [OFFICE] }

const SKILLS = ['firearms', 'brawl', 'stealth', 'athletics', 'interface', 'perform', 'negotiate'].map((id) => ({ id, name: `基本功${id}`, attr: 'body', desc: `${id}。` }))
const FACTIONS = ['hizakura', 'nora'].map((id) => ({ id, name: id, short: id, class: 'corp' }))

/** 三條假路數：只有 domains 有用（DATA 第 8 節）。 */
const PATHS = [
  { id: 'gunner', name: '槍手', tree: '戰鬥直覺', domains: { meat: 'strong', net: 'weak', opinion: 'none' } },
  { id: 'runner', name: '潛網者', tree: '網內', domains: { meat: 'mid', net: 'strong', opinion: 'weak' } },
  { id: 'fixer', name: '掮客', tree: '人面', domains: { meat: 'strong_support', net: 'mid', opinion: 'strong' } },
]
/** 假的路數內容種類（路數的功能是 abilities，這個功能不 import 它；測試只借它的內容種類）。 */
const FAKE_PATHS: Feature = { id: 'fake_paths', install(k) { k.content.defineKind({ kind: 'path', owner: 'fake_paths', validate: () => [] }) } }

const branch = (id: string, kind: string, entry: string, need?: Rec) => ({ id, kind, entry, ...(need ? { need } : {}) })
const REACH = { kind: 'reach', at: 'G1' }
const meat = (gives: string | undefined, extra: Rec = {}) => ({
  map: 'map_office_small', encounter: [], goal: REACH, ...(gives ? { gives } : {}), branches: [branch('assault', 'assault', 'E3')], ...extra,
})
const net = (gives?: string) => ({ layer: 'guest', encounter: [], ...(gives ? { gives } : {}), branches: [{ id: 'assault', kind: 'assault' }] })
const opinion = (gives?: string) => ({ encounter: [], ...(gives ? { gives } : {}), branches: [{ id: 'assault', kind: 'assault' }] })

/**
 * 五階段的假副本（大規模，等級 2：DC 是 10 ＋ 2 × 2 = 14）。主面現實。
 *   1 現實、內海    2 現實、內海、輿論（現實有一條要連動 n2 的路）    3 現實、內海    4 只有現實    5 只有現實（最後一個階段）
 */
const DEF = {
  id: 'cm_aux', name: '輔助面的假副本', kind: 'steal_item', main: 'meat', scale: 'large', grade: 2, target_faction: 'hizakura', district: 'glass_shore',
  stages: [
    { faces: { meat: meat('m1'), net: net('n1') } },
    { faces: { meat: meat('m2', { branches: [branch('assault', 'assault', 'E3'), branch('via_net', 'linked', 'E1', { link: 'n2' })] }), net: net('n2'), opinion: opinion('o2') } },
    { faces: { meat: meat('m3'), net: net('n1') } },
    { faces: { meat: meat('m4') } },
    { faces: { meat: meat(undefined) } },
  ],
  links: {
    m1: { type: 'skip', name: '員工證' }, m2: { type: 'skip', name: '訪客證' }, m3: { type: 'skip', name: '備用鑰匙' }, m4: { type: 'skip', name: '值班表' },
    n1: { type: 'ease', name: '內海的內應', effect: { alert_start: -10 } },
    n2: { type: 'open', name: '開著的後門' },
    o2: { type: 'ease', name: '輿論的風向' },
  },
}

const pathsOf = (...rows: Array<[string, number?]>) => ({ paths: rows.map(([path, tier], i) => ({ path, slot: i === 0 ? 'main' : 'sub', tier: tier ?? 2 })) })
const person = (id: string, skills: Record<string, number>, ext: Rec = {}, name = `人${id}`) => makeActor({ id, name, role: 'npc', skills, ext })

/** 兩個人在內海：甲 介面 3、潛網者（內海強）；乙 介面 1、沒有路數。 */
const A = person('a', { interface: 3 }, pathsOf(['runner']))
const B = person('b', { interface: 1 })
/** 現實面的槍手：槍械 3、槍手（現實強）；掮客：表演 2、掮客（輿論強）。 */
const GUN = person('g', { firearms: 3 }, pathsOf(['gunner']))
const FIX = person('f', { perform: 2, negotiate: 1 }, pathsOf(['fixer']))

const PACK: ContentPack = {
  id: 'm2_commission_aux',
  content: { skill: SKILLS, faction: FACTIONS, special_map: [MAP as never], path: PATHS as never, commission: [DEF as never] },
}

/** 別的面（內海）的玩法的替身：只是登記這種活動，玩家選內海才選得了。 */
const FAKE_NET: Feature = {
  id: 'fake_net',
  install(k) {
    k.activity.define({
      kind: 'face.net', owner: 'fake_net', order: 50, active: () => null, allow: ['commit:fake_net.'], reason: () => '替身活動開著。',
      start: () => [{ kind: 'event', action: 'fake_net.open', location: {}, party: [], timeline: [], changes: [], outcome: { result: 'open', summary: 'face.net 開了。' } }],
    })
    k.activity.allow('commission', 'face.net.start', 'fake_net')
    k.activity.allow('commission', 'commit:fake_net.', 'fake_net')
  },
}

const SEEN: { ends: Array<{ kind: string; outcome: string; result: Rec }> } = { ends: [] }
const OBSERVER: Feature = {
  id: 'observer',
  install(k) { k.hooks.on('activity.end', 'observer', ({ kind, outcome, result }) => { SEEN.ends.push({ kind, outcome, result }) }) },
}

interface Opts { seed?: number; features?: Feature[]; content?: ContentPack[]; actors?: ReturnType<typeof makeActor>[] }
function setup(o: Opts = {}) {
  SEEN.ends.length = 0
  return makeGame({
    seed: o.seed, features: [FAKE_PATHS, commissionFeature, OBSERVER, ...(o.features ?? [])], content: o.content ?? [PACK],
    pc: { attrs: { body: 14 }, skills: { stealth: 2 } } as never, actors: o.actors ?? [A, B, GUN, FIX],
  })
}
type G = ReturnType<typeof setup>['game']

const origin = { by: 'fixer', ref: 'fx_1' }
const enter = (g: G, extra: Rec = {}, def: unknown = 'cm_aux') => g.launch('commission', { def, ...extra }, origin)
const runOf = (g: G) => readRun(g.state)!
const view = (g: G) => commissionView(g.k, g.state)!
const face = (g: G, f: Face = 'meat') => g.commit(chooseFace(g.k, g.state, f))
const pick = (g: G, id: string) => g.commit(chooseBranch(g.k, g.state, id))
const commit = (g: G, changes: Change[]) => g.commit({ kind: 'system', action: 'commission.test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
/** 測試自己改一下副本的狀態（跳到哪個階段、先給一個連動）。 */
const setRun = (g: G, patch: Partial<ReturnType<typeof runOf>>) => commit(g, [{ op: 'ext', key: 'commission', value: { ...runOf(g), ...patch } }])
const stand = (g: G, x: number, y: number) => commit(g, [{ op: 'map.at', to: { map: runOf(g).map!, sheet: 'office', x, y } }])
/** 一個階段從頭走完：選現實、強攻、走到目標（里程碑自己接上）。 */
function playMeat(g: G): Report[] {
  face(g)
  pick(g, 'assault')
  return stand(g, 5, 2)
}

const auxBeats = (d: Pick<ReportDraft, 'timeline'>) => d.timeline.filter((b) => b.tag === 'aux')
const beatOf = (d: Pick<ReportDraft, 'timeline'>, f: Face) => auxBeats(d).find((b) => b.data?.face === f)
const facing = (g: G, f: Face = 'meat') => chooseFace(g.k, g.state, f)
const conditionOf = (g: G, id: string, c = 'injured') => g.state.actors[id]!.conditions.find((x) => x.id === c)

/** 第一個讓 want 成立的種子（種子不同，同一件事的骰面不同）。 */
function seedWhere(mk: (seed: number) => G, want: (g: G) => boolean): number {
  for (let seed = 1; seed <= 400; seed++) if (want(mk(seed))) return seed
  throw new Error('找不到合適的種子')
}
/** 這一面擲出自然幾（只看草稿，不提交）。 */
const naturalAt = (g: G, f: Face, playerFace: Face = 'meat'): number | undefined => beatOf(facing(g, playerFace), f)?.roll?.natural

/** 甲乙去內海（甲介面 3、潛網者），玩家選現實：第一階段的標準情境。natural 是內海那一擲想要的骰面。 */
const netGame = (natural: number, extra: Rec = {}) => {
  const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] }, ...extra }); return game }
  return mk(seedWhere(mk, (g) => naturalAt(g, 'net') === natural))
}

// ===================================================================================================================

describe('哪幾面要擲', () => {
  it('第一階段可選現實與內海，玩家選現實、內海有一個人：擲一次（時間軸一拍，標籤 aux，帶擲骰的明細）；現實那一面是玩家自己玩的，不擲', () => {
    const { game } = setup()
    enter(game, { aux: { meat: ['g'], net: ['a'] } })
    const reports = face(game)
    expect(reports.map((r) => r.action)).toEqual(['commission.face'])
    const beats = auxBeats(reports[0]!)
    expect(beats).toHaveLength(1)
    expect(beats[0]).toMatchObject({ tag: 'aux', actor: 'a', layer: 'net', data: { face: 'net', stage: 1, roller: 'a', people: ['a'], skill: 'interface' } })
    expect(beats[0]!.roll).toMatchObject({ dice: '1d20', dc: 14 })
    // 選面那份報告的第一筆還是 stage 快照；亂數往前一格
    expect(reports[0]!.changes[0]).toMatchObject({ op: 'snapshot.take', kind: 'stage' })
    expect(reports[0]!.changes.filter((c) => c.op === 'rng')).toEqual([{ op: 'rng', advance: 1 }])
    expect(runOf(game)).toMatchObject({ step: 'branch', face: 'meat' })
  })

  it('玩家選內海（內海登記成替身的面）：現實那一面改擲，內海不擲', () => {
    const { game } = setup({ features: [FAKE_NET] })
    enter(game, { aux: { meat: ['g'], net: ['a'] } })
    const reports = face(game, 'net')
    const beats = auxBeats(reports[0]!)
    expect(beats.map((b) => b.data?.face)).toEqual(['meat'])
    expect(beats[0]).toMatchObject({ actor: 'g', layer: 'meat', data: { skill: 'firearms', people: ['g'] } })
  })

  it('三個面都可選：玩家選現實，內海與輿論各擲一次（照現實、內海、輿論的順序；輿論面沒有登記玩法照樣擲）', () => {
    const { game } = setup()
    enter(game, { aux: { net: ['a'], opinion: ['f'] } })
    setRun(game, { stage: 2 })
    const reports = face(game)
    expect(auxBeats(reports[0]!).map((b) => b.data?.face)).toEqual(['net', 'opinion'])
    expect(reports[0]!.changes.filter((c) => c.op === 'rng')).toEqual([{ op: 'rng', advance: 2 }])
    expect(runOf(game).aux!.log.map((r) => [r.stage, r.face, r.roller])).toEqual([[2, 'net', 'a'], [2, 'opinion', 'f']])
  })

  it('這個階段只有一個面可選：不擲（派了人也不擲）；最後一個階段不擲', () => {
    const { game } = setup()
    enter(game, { aux: { net: ['a'], opinion: ['f'] } })
    for (const stage of [4, 5]) {
      setRun(game, { stage, step: 'face' })
      const draft = facing(game)
      expect(auxBeats(draft), `第 ${stage} 階段`).toEqual([])
      expect(draft.changes.some((c) => c.op === 'rng')).toBe(false)
      expect(draft.narration).toBeUndefined()
      face(game)
      expect(runOf(game).aux).toBeUndefined()
      setRun(game, { step: 'face' })
    }
  })

  it('沒有派人的面不擲、不出事：時間軸什麼都沒多、亂數不動、狀態裡沒有輔助面的東西', () => {
    const { game } = setup()
    enter(game)
    const reports = face(game)
    expect(reports[0]!.timeline).toEqual([])
    expect(reports[0]!.changes.map((c) => c.op)).toEqual(['snapshot.take', 'ext'])
    expect(runOf(game).aux).toBeUndefined()
    expect(runOf(game).links).toEqual([])
    // 派了人的別的面不影響：aux 寫了別的面、這個階段沒有那一面也不擲
    const other = setup().game
    enter(other, { aux: { opinion: ['f'], meat: ['g'] } })
    expect(auxBeats(face(other)[0]!)).toEqual([])
  })

  it('派的人不在 state.actors 裡（還沒生成）：當作沒有人，不擲', () => {
    const { game } = setup()
    enter(game, { aux: { net: ['nobody'] } })
    expect(auxBeats(face(game)[0]!)).toEqual([])
    const half = setup().game
    enter(half, { aux: { net: ['nobody', 'a'] } })
    expect(beatOf(face(half)[0]!, 'net')).toMatchObject({ data: { people: ['a'], bonus: { crowd: 0 } } })
  })
})

describe('算式：1d20 ＋ 最高的相關基本功 ＋ 分量修正 ＋ （人數 − 1），對 10 ＋ 等級 × 2', () => {
  it('基本功 3、路數在那一面是強、兩個人：加值 3 + 4 + 1；DC 是 10 + 等級 × 2（時間軸的檢定明細與 data 都對）', () => {
    const { game } = setup({ seed: 11 })
    enter(game, { aux: { net: ['a', 'b'] } })
    const beat = beatOf(facing(game), 'net')!
    expect(beat.data).toMatchObject({ roller: 'a', skill: 'interface', bonus: { skill: 3, path: 4, crowd: 1, total: 8 }, dc: 14, people: ['a', 'b'] })
    const roll = beat.roll!
    expect(roll.total).toBe(roll.natural + 8)
    expect(roll.dc).toBe(14)
    expect(roll.margin).toBe(roll.total - 14)
    expect(roll.skill).toBe('interface')
    expect(roll.parts.map((p) => [p.source, p.value])).toEqual([['skill', 3], ['path', 4], ['situation', 1]])
    expect(roll.natural).toBeGreaterThanOrEqual(1)
    expect(roll.natural).toBeLessThanOrEqual(20)
  })

  it('DC 跟著副本的等級走：等級 IV 是 18、等級 I 是 12（寫羅馬數字也行）', () => {
    for (const [grade, dc] of [['IV', 18], [1, 12], [5, 20]] as const) {
      const { game } = setup()
      enter(game, { aux: { net: ['a'] } }, { ...DEF, id: `cm_g${grade}`, grade })
      expect(beatOf(facing(game), 'net')!.roll!.dc, String(grade)).toBe(dc)
    }
  })

  it('分量修正：強 +4、中 +2、弱 0；路數在那個戰場沒有效果（none）和沒有路數都是 0；同一個人有幾條路數取最強的那條', () => {
    // 同一個人（介面 1）掛不同的路數，去內海：潛網者（強）、掮客（中）、槍手（弱）、沒有
    const cases: Array<[string, Rec, number]> = [['強', pathsOf(['runner']), 4], ['中', pathsOf(['fixer']), 2], ['弱', pathsOf(['gunner']), 0], ['沒有路數', {}, 0], ['路數查不到', pathsOf(['ghost']), 0]]
    for (const [name, ext, want] of cases) {
      const { game } = setup({ actors: [person('x', { interface: 1 }, ext)] })
      enter(game, { aux: { net: ['x'] } })
      expect(beatOf(facing(game), 'net')!.data, name).toMatchObject({ bonus: { skill: 1, path: want, crowd: 0, total: 1 + want } })
    }
    // none：槍手在輿論面沒有效果，0
    const none = setup({ actors: [person('x', { perform: 1 }, pathsOf(['gunner']))] }).game
    enter(none, { aux: { opinion: ['x'] } })
    setRun(none, { stage: 2 })
    expect(beatOf(facing(none), 'opinion')!.data).toMatchObject({ bonus: { path: 0 } })
    // 兩條路數：槍手（內海弱）與潛網者（內海強）→ 取強的
    const two = setup({ actors: [person('x', { interface: 1 }, pathsOf(['gunner'], ['runner']))] }).game
    enter(two, { aux: { net: ['x'] } })
    expect(beatOf(facing(two), 'net')!.data).toMatchObject({ bonus: { path: 4 } })
  })

  it('「強的輔助」（strong_support）算強：掮客在現實面 +4', () => {
    const { game } = setup({ features: [FAKE_NET], actors: [person('x', { brawl: 1 }, pathsOf(['fixer']))] })
    enter(game, { aux: { meat: ['x'] } })
    expect(beatOf(facing(game, 'net'), 'meat')!.data).toMatchObject({ bonus: { skill: 1, path: 4 } })
  })

  it('每一面看自己的那幾項基本功：現實取槍械、格鬥、隱匿、運動裡最高的；內海只看介面；輿論取表演、交涉裡最高的', () => {
    const x = person('x', { firearms: 1, brawl: 4, stealth: 2, athletics: 3, interface: 5, perform: 1, negotiate: 2 })
    const { game } = setup({ features: [FAKE_NET], actors: [x] })
    enter(game, { aux: { meat: ['x'] } })
    expect(beatOf(facing(game, 'net'), 'meat')!.data).toMatchObject({ skill: 'brawl', bonus: { skill: 4 } })
    const n = setup({ actors: [x] }).game
    enter(n, { aux: { net: ['x'] } })
    expect(beatOf(facing(n), 'net')!.data).toMatchObject({ skill: 'interface', bonus: { skill: 5 } })
    const o = setup({ actors: [x] }).game
    enter(o, { aux: { opinion: ['x'] } })
    setRun(o, { stage: 2 })
    expect(beatOf(facing(o), 'opinion')!.data).toMatchObject({ skill: 'negotiate', bonus: { skill: 2 } })
  })

  it('擲骰的是最高基本功的那個人（同級取分量修正高的）：兩個人時擲骰、受傷的都是他；人數 − 1 照加', () => {
    const hi = person('hi', { interface: 4 })
    const mid = person('mid', { interface: 2 }, pathsOf(['runner']))
    const tie = person('tie', { interface: 4 }, pathsOf(['runner']))
    const t1 = setup({ actors: [hi, mid] }).game
    enter(t1, { aux: { net: ['mid', 'hi'] } })
    expect(beatOf(facing(t1), 'net')).toMatchObject({ actor: 'hi', data: { roller: 'hi', bonus: { skill: 4, path: 0, crowd: 1 } } })
    const t2 = setup({ actors: [hi, tie] }).game
    enter(t2, { aux: { net: ['hi', 'tie'] } })
    expect(beatOf(facing(t2), 'net')).toMatchObject({ actor: 'tie', data: { roller: 'tie', bonus: { skill: 4, path: 4, crowd: 1 } } })
  })

  it('借來的人沒有分量修正（人數照算）', () => {
    const { game } = setup()
    enter(game, { aux: { net: ['a'], borrowed: ['a'] } })
    expect(beatOf(facing(game), 'net')!.data).toMatchObject({ bonus: { skill: 3, path: 0, crowd: 0, total: 3 } })
    // 兩個人、強的那個是借的：擲骰的人是他，但修正是 0；另一個沒借的不補上
    const two = setup().game
    enter(two, { aux: { net: ['a', 'b'], borrowed: ['a'] } })
    expect(beatOf(facing(two), 'net')!.data).toMatchObject({ roller: 'a', bonus: { skill: 3, path: 0, crowd: 1, total: 4 } })
    // 沒有借的對照
    const own = setup().game
    enter(own, { aux: { net: ['a', 'b'] } })
    expect(beatOf(facing(own), 'net')!.data).toMatchObject({ bonus: { path: 4, total: 8 } })
  })

  it('規則可以用資料蓋掉（commission_rule：看哪幾項基本功、分量修正、失敗的壓力、撤幾個階段、受傷幾天）；格式不對的欄位忽略', () => {
    const rule = { id: 'default', aux_skills: { net: ['perform'] }, aux_bonus: { strong: 6 }, aux_pressure: 20, aux_rest: 2, aux_injured_days: 5 }
    const pack: ContentPack = { ...PACK, content: { ...PACK.content, commission_rule: [rule] as never } }
    const x = person('x', { interface: 4, perform: 2 }, pathsOf(['runner']))
    const mk = (seed: number): G => { const { game } = setup({ seed, content: [pack], actors: [x] }); enter(game, { aux: { net: ['x'] } }); return game }
    const g = mk(seedWhere(mk, (t) => naturalAt(t, 'net') === 1))
    const t0 = toMinutes(g.state.time)
    const reports = face(g)
    expect(beatOf(reports[0]!, 'net')!.data).toMatchObject({ skill: 'perform', bonus: { skill: 2, path: 6 }, outcome: 'mishap' })
    expect(runOf(g).aux).toMatchObject({ pressure: { net: 20 }, rest: { net: 3 } })
    expect(conditionOf(g, 'x')).toEqual({ id: 'injured', until: t0 + 5 * 1440 })
    // 預設與格式
    const defaults = commissionRules(setup().game.k)
    expect(defaults).toMatchObject({ aux_pressure: 10, aux_rest: 1, aux_injured_days: 3, aux_bonus: { strong: 4, mid: 2, weak: 0, none: 0 } })
    expect(defaults.aux_skills).toEqual({ meat: ['firearms', 'brawl', 'stealth', 'athletics'], net: ['interface'], opinion: ['perform', 'negotiate'] })
    expect(ruleProblems({ aux_skills: { net: [] } })).toEqual([expect.stringMatching(/^aux_skills /)])
    expect(ruleProblems({ aux_skills: { sky: ['x'] } })).toHaveLength(1)
    expect(ruleProblems({ aux_bonus: { strong: -1 } })).toEqual([expect.stringMatching(/^aux_bonus /)])
    expect(ruleProblems({ aux_pressure: 'x', aux_rest: 9 })).toHaveLength(2)
    expect(ruleProblems(rule)).toEqual([])
    const bad: ContentPack = { ...PACK, content: { ...PACK.content, commission_rule: [{ id: 'default', aux_skills: { net: [] }, aux_bonus: { strong: 'x' }, aux_pressure: 30 }] as never } }
    // 載入時格式不對的規則會被擋（validate）；寫進去的都是合格的欄位時才生效
    expect(() => setup({ content: [bad] })).toThrow()
  })
})

describe('四種結果（COMMISSIONS 6.4 節的表）', () => {
  // 加值 8、DC 14：骰 12 合計 20（超過 5 以上）、骰 8 合計 16（成功）、骰 4 合計 12（失敗）、骰 1（自然 1）

  it('超過 5 以上：拿到這一面這個階段的連動、壓力不漲、沒有人出事', () => {
    const g = netGame(12)
    const reports = face(g)
    const beat = beatOf(reports[0]!, 'net')!
    expect(beat.roll).toMatchObject({ natural: 12, total: 20, dc: 14, margin: 6, degree: 'critical' })
    expect(beat.data).toMatchObject({ outcome: 'great', link: 'n1' })
    expect(runOf(g).links).toEqual([{ id: 'n1', from: 1, face: 'net', aux: true }])
    expect(runOf(g)).toMatchObject({ alert: 0, peak: 0 })
    expect(runOf(g).aux).toMatchObject({ pressure: {}, rest: {} })
    expect(conditionOf(g, 'a')).toBeUndefined()
    expect(beat.text).toMatch(/拿到連動「內海的內應」/)
  })

  it('成功：拿到連動；壓力不動；沒有人出事', () => {
    const g = netGame(8)
    const beat = beatOf(face(g)[0]!, 'net')!
    expect(beat.roll).toMatchObject({ natural: 8, total: 16, degree: 'success' })
    expect(beat.data).toMatchObject({ outcome: 'success', link: 'n1' })
    expect(runOf(g).links.map((l) => l.id)).toEqual(['n1'])
    expect(runOf(g).aux!.pressure).toEqual({})
    expect(conditionOf(g, 'a')).toBeUndefined()
    expect(runOf(g).aux!.log).toHaveLength(1)
  })

  it('失敗：沒拿到連動；這一面的壓力 +10（內海記在 aux.pressure；沒有人出事、下一個階段照擲）', () => {
    const g = netGame(4)
    const beat = beatOf(face(g)[0]!, 'net')!
    expect(beat.roll).toMatchObject({ natural: 4, total: 12, degree: 'fail' })
    expect(beat.data).toMatchObject({ outcome: 'fail', pressure: 10 })
    expect(beat.data).not.toHaveProperty('link')
    expect(runOf(g).links).toEqual([])
    expect(runOf(g).aux).toMatchObject({ pressure: { net: 10 }, rest: {} })
    expect(runOf(g).alert).toBe(0)
    expect(conditionOf(g, 'a')).toBeUndefined()
    expect(conditionOf(g, 'b')).toBeUndefined()
  })

  it('失敗落在現實面：壓力就是警戒 +10（整趟累計、最高 100；警戒的峰值跟著）', () => {
    const mk = (seed: number): G => { const { game } = setup({ seed, features: [FAKE_NET] }); enter(game, { aux: { meat: ['g'] }, alert_start: 20 }); return game }
    const g = mk(seedWhere(mk, (t) => naturalAt(t, 'meat', 'net') === 3))
    const beat = beatOf(face(g, 'net')[0]!, 'meat')!
    expect(beat.data).toMatchObject({ outcome: 'fail', pressure: 10, bonus: { skill: 3, path: 4, crowd: 0 } })
    expect(runOf(g)).toMatchObject({ alert: 30, peak: 30 })
    expect(view(g).alert).toMatchObject({ value: 30, peak: 30 })
    // 頂到 100 的時候只加到 100，紀錄的壓力是實際加的量
    const mk2 = (seed: number): G => { const { game } = setup({ seed, features: [FAKE_NET] }); enter(game, { aux: { meat: ['g'] }, alert_start: 95 }); return game }
    const g2 = mk2(seedWhere(mk2, (t) => naturalAt(t, 'meat', 'net') === 3))
    expect(beatOf(face(g2, 'net')[0]!, 'meat')!.data).toMatchObject({ outcome: 'fail', pressure: 5 })
    expect(runOf(g2)).toMatchObject({ alert: 100, peak: 100 })
  })

  it('失敗落在輿論面：沒有壓力條，不加', () => {
    const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { opinion: ['f'] } }); setRun(game, { stage: 2 }); return game }
    // 掮客在輿論強 +4、表演 2：加值 6、DC 14：骰 5 → 11，失敗
    const g = mk(seedWhere(mk, (t) => naturalAt(t, 'opinion') === 5))
    const beat = beatOf(face(g)[0]!, 'opinion')!
    expect(beat.data).toMatchObject({ outcome: 'fail', bonus: { skill: 2, path: 4, total: 6 } })
    expect(beat.data).not.toHaveProperty('pressure')
    expect(runOf(g)).toMatchObject({ alert: 0, peak: 0 })
    expect(runOf(g).aux!.pressure).toEqual({})
    expect(runOf(g).links).toEqual([])
  })

  it('自然 1 出事：擲骰的那個人身上多一個 injured（3 天）、沒拿到連動、這一面下一個階段不擲、再下一個階段恢復', () => {
    const g = netGame(1)
    const t0 = toMinutes(g.state.time)
    const beat = beatOf(face(g)[0]!, 'net')!
    expect(beat.roll!.natural).toBe(1)
    expect(beat.data).toMatchObject({ outcome: 'mishap', roller: 'a', injured: 'a', rest_until: 2, pressure: 10 })
    expect(beat.data).not.toHaveProperty('link')
    // 擲骰的甲受傷 3 天；同一面的乙沒事
    expect(conditionOf(g, 'a')).toEqual({ id: 'injured', until: t0 + 3 * 1440 })
    expect(conditionOf(g, 'b')).toBeUndefined()
    expect(runOf(g).links).toEqual([])
    expect(runOf(g).aux).toMatchObject({ rest: { net: 2 }, pressure: { net: 10 } })
    expect(beat.text).toMatch(/出事了.*人a受傷.*第 2 階段不擲/)

    // 玩完第一階段：第二階段內海休息（不擲；輿論面照擲），第三階段內海又擲了
    const mk = (seed: number): G => { const t = setup({ seed }).game; enter(t, { aux: { net: ['a', 'b'], opinion: ['f'] } }); return t }
    const h = mk(seedWhere(mk, (t) => naturalAt(t, 'net') === 1))
    face(h)
    expect(runOf(h).aux!.rest).toEqual({ net: 2 })
    pick(h, 'assault')
    stand(h, 5, 2)
    expect(runOf(h)).toMatchObject({ stage: 2, step: 'face' })
    expect(view(h).aux.find((a) => a.face === 'net')).toMatchObject({ resting: true, restUntil: 2, rolls: false })
    const second = face(h)
    expect(auxBeats(second[0]!).map((b) => b.data?.face)).toEqual(['opinion'])
    expect(second[0]!.narration?.results?.join('')).toMatch(/內海面的人上一次出了事，這個階段還在休息，不擲/)
    pick(h, 'assault')
    stand(h, 5, 2)
    expect(runOf(h)).toMatchObject({ stage: 3, step: 'face' })
    expect(view(h).aux.find((a) => a.face === 'net')).toMatchObject({ resting: false, rolls: true })
    const third = face(h)
    expect(auxBeats(third[0]!).map((b) => b.data?.face)).toEqual(['net'])
  })

  it('出事的人已經有更久的 injured 就不縮短；沒有期限的 injured 也不動', () => {
    const g = netGame(1)
    const long = toMinutes(g.state.time) + 10 * 1440
    commit(g, [{ op: 'actor.condition', id: 'a', condition: 'injured', until: long }])
    face(g)
    expect(conditionOf(g, 'a')).toEqual({ id: 'injured', until: long })
    const h = netGame(1)
    commit(h, [{ op: 'actor.condition', id: 'a', condition: 'injured' }])
    face(h)
    expect(conditionOf(h, 'a')).toEqual({ id: 'injured' })
    expect(runOf(h).aux!.rest).toEqual({ net: 2 })
  })

  it('自然 1 就算加值夠過 DC 也是出事；自然 20 就算沒到 DC + 5 也算大成功（和核心的檢定一致）', () => {
    expect(classifyAux({ natural: 1, degree: 'fumble' })).toBe('mishap')
    expect(classifyAux({ natural: 1, degree: 'success' })).toBe('mishap')
    expect(classifyAux({ natural: 20, degree: 'critical' })).toBe('great')
    expect(classifyAux({ natural: 9, degree: 'critical' })).toBe('great')
    expect(classifyAux({ natural: 9, degree: 'success' })).toBe('success')
    expect(classifyAux({ natural: 9, degree: 'fail' })).toBe('fail')
    // 低到大失敗（差 5 以上）但不是自然 1：只是失敗，不出事
    expect(classifyAux({ natural: 2, degree: 'fumble' })).toBe('fail')
  })

  it('同一個連動不重複拿；這一面沒寫 gives 的階段成功了也沒有連動可拿', () => {
    // 第三階段的內海也給 n1：已經有了就不再加（連動的清單裡只有一個）
    const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] } }); setRun(game, { stage: 3, links: [{ id: 'n1', from: 1, face: 'net' }] }); return game }
    const g = mk(seedWhere(mk, (t) => (naturalAt(t, 'net') ?? 0) >= 6 && (naturalAt(t, 'net') ?? 0) <= 10))
    const beat = beatOf(face(g)[0]!, 'net')!
    expect(beat.data).toMatchObject({ outcome: 'success' })
    expect(beat.data).not.toHaveProperty('link')
    expect(runOf(g).links).toEqual([{ id: 'n1', from: 1, face: 'net' }])
    expect(beat.text).toMatch(/「內海的內應」已經有了/)
    // 沒寫 gives
    const noGive = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    noGive.id = 'cm_nogive'
    delete (noGive.stages[0]!.faces.net as Rec).gives
    const mk2 = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] } }, noGive); return game }
    const g2 = mk2(seedWhere(mk2, (t) => naturalAt(t, 'net') === 8))
    const b2 = beatOf(face(g2)[0]!, 'net')!
    expect(b2.data).toMatchObject({ outcome: 'success' })
    expect(b2.text).toMatch(/沒有連動可拿/)
    expect(runOf(g2).links).toEqual([])
  })
})

describe('拿到的連動當場生效', () => {
  it('輔助面拿到的連動這個階段選分支時就看得到它開的路：同一個階段的 need.link 分支選得了', () => {
    // 第二階段：內海給 n2；現實有一條要 n2 的路（via_net）
    const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] } }); setRun(game, { stage: 2 }); return game }
    const win = mk(seedWhere(mk, (t) => (naturalAt(t, 'net') ?? 0) >= 6))
    expect(view(win).branches).toEqual([])
    face(win)
    const row = view(win).branches.find((b) => b.id === 'via_net')!
    expect(row).toMatchObject({ kind: 'linked', block: null, mark: 'link' })
    expect(runOf(win).links).toEqual([{ id: 'n2', from: 2, face: 'net', aux: true }])
    const reports = pick(win, 'via_net')
    expect(reports.map((r) => r.action)).toEqual(['commission.branch'])
    expect(runOf(win)).toMatchObject({ step: 'play', branch: 'via_net' })
    expect(win.state.maps.instances[runOf(win).map!]).toBeDefined()

    // 擲失敗的對照：沒拿到連動，這條路選不了，原因寫出連動的名字
    const lose = mk(seedWhere(mk, (t) => (naturalAt(t, 'net') ?? 99) <= 4 && naturalAt(t, 'net') !== 1))
    face(lose)
    expect(view(lose).branches.find((b) => b.id === 'via_net')!.block).toBe('還沒拿到連動「開著的後門」。')
    expect(() => chooseBranch(lose.k, lose.state, 'via_net')).toThrow(/還沒拿到連動/)
  })

  it('連動的效果對這個階段生效（沒寫 effect.stage 的輔助連動算這個階段，而不是下一個階段）：警戒的起始值跟著降', () => {
    const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] }, alert_start: 30 }); return game }
    const g = mk(seedWhere(mk, (t) => (naturalAt(t, 'net') ?? 0) >= 6))
    face(g)
    expect(effectsFor(runOf(g), 1)).toMatchObject({ alertDelta: -10, from: ['n1'] })
    expect(effectsFor(runOf(g), 2).alertDelta).toBe(0)
    expect(view(g).links).toEqual([expect.objectContaining({ id: 'n1', from: 1, face: 'net', stage: 1, used: true })])
    pick(g, 'assault')
    expect(runOf(g).start_alert).toBe(20)
  })

  it('玩家自己玩的那一面給的連動照舊在這一段做完時才給（下一個階段生效）；輔助面的連動記著 aux 標記', () => {
    const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] } }); return game }
    const g = mk(seedWhere(mk, (t) => (naturalAt(t, 'net') ?? 0) >= 6))
    playMeat(g)
    expect(runOf(g)).toMatchObject({ stage: 2 })
    expect(runOf(g).links).toEqual([{ id: 'n1', from: 1, face: 'net', aux: true }, { id: 'm1', from: 1, face: 'meat' }])
  })
})

describe('commissionView：每一面誰在那裡、這個階段的擲骰結果、成功率', () => {
  it('選面之前：三個面都列出來；有人的面帶人名、成功率與會不會擲；沒有人的面空著', () => {
    const { game } = setup()
    enter(game, { aux: { net: ['a', 'b'], opinion: ['f'], borrowed: ['b'] } })
    const rows = view(game).aux
    expect(rows.map((r) => [r.face, r.name])).toEqual([['meat', '現實'], ['net', '內海'], ['opinion', '輿論']])
    const [m, n, o] = rows
    expect(m).toMatchObject({ people: [], rolls: false, resting: false, restUntil: null, pressure: 0 })
    expect(m!.chance).toBeUndefined()
    expect(n).toMatchObject({ people: [{ id: 'a', name: '人a', borrowed: false }, { id: 'b', name: '人b', borrowed: true }], rolls: true, resting: false, pressure: 0 })
    expect(n!.chance).toMatchObject({ roller: 'a', dc: 14, bonus: { skill: 3, path: 4, crowd: 1, total: 8 }, chance: 75, mishap: 5, faces: { great: 10, success: 5, fail: 4, mishap: 1 } })
    // 輿論面這個階段沒有開：派了人也不會擲；輿論沒有壓力條
    expect(o).toMatchObject({ people: [{ id: 'f', name: '人f', borrowed: false }], rolls: false, pressure: null })
    expect(view(game).stage).toBe(1)
  })

  it('選面之後：玩家選的那一面不擲（rolls 是 false）；擲過的那一面帶這個階段的結果；下一個階段的畫面不再帶上一個階段的結果', () => {
    const mk = (seed: number): G => { const { game } = setup({ seed }); enter(game, { aux: { net: ['a', 'b'] } }); return game }
    const g = mk(seedWhere(mk, (t) => (naturalAt(t, 'net') ?? 0) >= 6))
    face(g)
    const net = view(g).aux[1]!
    expect(net.rolls).toBe(false)
    expect(net.result).toMatchObject({ stage: 1, face: 'net', roller: 'a', outcome: expect.stringMatching(/great|success/), link: 'n1', bonus: { skill: 3, path: 4, crowd: 1 } })
    expect(net.result!.roll.dc).toBe(14)
    pick(g, 'assault')
    stand(g, 5, 2)
    expect(view(g).stage).toBe(2)
    expect(view(g).aux[1]!.result).toBeUndefined()
    expect(runOf(g).aux!.log).toHaveLength(1)
  })

  it('壓力：現實是警戒、內海是追蹤度（先記著給 M3）、輿論沒有', () => {
    const g = netGame(4)
    face(g)
    expect(view(g).aux.map((r) => r.pressure)).toEqual([0, 10, null])
  })

  it('auxChance：還沒進副本也能問（召集的畫面）：派這些人去這一面，成功率、出事的機率、算式；借來的人沒有分量修正', () => {
    const { game } = setup()
    const def = DEF as unknown as CommissionEntry
    const full = auxChance(game.k, game.state, def, 'net', ['a', 'b'])!
    expect(full).toMatchObject({ face: 'net', roller: 'a', skill: 'interface', dc: 14, bonus: { skill: 3, path: 4, crowd: 1, total: 8 }, people: ['a', 'b'] })
    // 加值 8、DC 14：骰 11～20 大成功（10 面）、6～10 成功（5 面）、2～5 失敗（4 面）、1 出事
    expect(full.faces).toEqual({ great: 10, success: 5, fail: 4, mishap: 1 })
    expect(full.chance).toBe(75)
    expect(full.mishap).toBe(5)
    // 借來的甲：加值 3 + 0 + 1 = 4：骰 15～20 大成功（6 面）、10～14 成功（5 面）、2～9 失敗（8 面）、1 出事
    const borrowed = auxChance(game.k, game.state, def, 'net', ['a', 'b'], ['a'])!
    expect(borrowed.bonus).toMatchObject({ path: 0, total: 4 })
    expect(borrowed.faces).toEqual({ great: 6, success: 5, fail: 8, mishap: 1 })
    expect(borrowed.chance).toBe(55)
    // 一個人：沒有人數加值；等級高 DC 就高
    const one = auxChance(game.k, game.state, { ...def, grade: 'V' }, 'meat', ['g'])!
    expect(one).toMatchObject({ dc: 20, bonus: { skill: 3, path: 4, crowd: 0, total: 7 } })
    expect(one.faces.great + one.faces.success + one.faces.fail + one.faces.mishap).toBe(20)
    // 沒有人（或派的人不存在）：沒有成功率
    expect(auxChance(game.k, game.state, def, 'net', [])).toBeNull()
    expect(auxChance(game.k, game.state, def, 'net', ['nobody'])).toBeNull()
    // 和實際擲出來的結果同一套：挑一個骰面，算式與分類都對得上
    const mk = (seed: number): G => { const t = setup({ seed }).game; enter(t, { aux: { net: ['a', 'b'] } }); return t }
    for (const natural of [1, 4, 8, 12]) {
      const t = mk(seedWhere(mk, (x) => naturalAt(x, 'net') === natural))
      const beat = beatOf(facing(t), 'net')!
      const want = natural === 1 ? 'mishap' : natural === 12 ? 'great' : natural === 8 ? 'success' : 'fail'
      expect(beat.data!.outcome).toBe(want)
    }
  })
})

describe('進副本時檢查 setup.aux 的格式', () => {
  it('每一面 1～2 個人、同一個人不能派去兩個面、每一項要是角色 id 的陣列；不合格就進不去（什麼都不留）', () => {
    const { game } = setup()
    expect(() => enter(game, { aux: { net: ['a', 'b', 'g'] } })).toThrow(/內海面最多派 2 個人/)
    expect(() => enter(game, { aux: { net: ['a'], opinion: ['a'] } })).toThrow(/a 不能同時派去內海面和輿論面/)
    expect(() => enter(game, { aux: { net: ['a', 'a'] } })).toThrow(/a 在內海面列了兩次/)
    expect(() => enter(game, { aux: { net: 'a' } })).toThrow(/aux\.net 要是角色 id 的陣列/)
    expect(() => enter(game, { aux: { borrowed: [1] } })).toThrow(/aux\.borrowed 要是角色 id 的陣列/)
    expect(() => enter(game, { aux: 'a' })).toThrow(/aux 要是/)
    expect(readRun(game.state)).toBeNull()
    expect(game.state.snapshots).toEqual([])
    // 合格的（含沒人的空陣列、借來的人不在任何一面）照原樣記下
    expect(() => enter(game, { aux: { meat: [], net: ['a', 'b'], borrowed: ['b', 'zz'] } })).not.toThrow()
    expect(runOf(game).setup.aux).toEqual({ meat: [], net: ['a', 'b'], borrowed: ['b', 'zz'] })
  })
})

describe('整趟：同一個種子結果一樣、不變式、交回給發起的人', () => {
  it('五個階段走完：每個階段的輔助面都擲；紀錄（run.aux.log）帶到 activity.end 的 result.aux_log；同一個種子同一串輸入同一個結果', async () => {
    const play = async () => {
      const { game } = setup({ seed: 31 })
      const { violations } = await observed(game, async () => {
        enter(game, { aux: { net: ['a', 'b'], opinion: ['f'] } })
        for (let stage = 1; stage <= 5; stage++) {
          expect(runOf(game).stage).toBe(stage)
          playMeat(game)
        }
      })
      expect(violations).toEqual([])
      expect(readRun(game.state)).toBeNull()
      return { hash: stateHash(game.state), end: SEEN.ends.find((e) => e.kind === 'commission')! }
    }
    const first = await play()
    const second = await play()
    expect(first.hash).toBe(second.hash)
    expect(first.end).toEqual(second.end)
    const log = first.end.result.aux_log as Array<{ stage: number; face: string; outcome: string; roll: { natural: number; total: number; dc: number } }>
    // 一二三階段的內海各擲（除非出事休息）；輿論只有第二階段開著；四、五階段只有一個面
    expect(log.every((r) => r.stage <= 3)).toBe(true)
    expect(log.filter((r) => r.face === 'opinion').map((r) => r.stage)).toEqual([2])
    expect(log.filter((r) => r.face === 'net').map((r) => r.stage).length).toBeGreaterThanOrEqual(1)
    for (const r of log) expect(r.roll.dc).toBe(14)
    expect(first.end.result.aux).toEqual({ net: ['a', 'b'], opinion: ['f'] })
  })

  it('同一個種子：選面那一份報告的擲骰一模一樣（骰面、算式、結果）；換一個種子骰面會不同', () => {
    const roll = (seed: number) => {
      const { game } = setup({ seed })
      enter(game, { aux: { net: ['a', 'b'] } })
      const beat = beatOf(face(game)[0]!, 'net')!
      return { roll: beat.roll, data: beat.data, links: runOf(game).links, aux: runOf(game).aux }
    }
    expect(roll(9)).toEqual(roll(9))
    const naturals = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => roll(s).roll!.natural))
    expect(naturals.size).toBeGreaterThan(1)
  })

  it('回到這個階段開始時（戰敗三選一的第三個，用階段的快照回去）：輔助面的結果、連動、受傷、休息全部回去；重新選面，骰面和第一次一樣', () => {
    const g = netGame(1)
    const first = beatOf(facing(g), 'net')!.roll
    const t0 = toMinutes(g.state.time)
    face(g)
    expect(conditionOf(g, 'a')).toBeDefined()
    expect(runOf(g).aux).toBeDefined()
    // 副本裡不放行 rewind:stage（M2 修正批 2）：回到階段開始的入口是戰敗的三選一（Game.rewindToStage），那一步用的就是這個 rewindTo
    expect(g.rewindToKind('stage', '回到這個階段開始時')).toMatch(/進行中/)
    const slot = [...g.state.snapshots].reverse().find((x) => x.kind === 'stage')!
    expect(g.rewindTo(slot.id, { summary: '回到這個階段開始時' })).toBeNull()
    expect(runOf(g)).toMatchObject({ stage: 1, step: 'face', links: [] })
    expect(runOf(g).aux).toBeUndefined()
    expect(conditionOf(g, 'a')).toBeUndefined()
    expect(toMinutes(g.state.time)).toBe(t0)
    expect(beatOf(facing(g), 'net')!.roll).toEqual(first)
  })

  it('輔助面擲出來的亂數會往前：同一階段後面的檢定（分支的潛行）不會和它擲出同一顆', () => {
    const { game } = setup({ seed: 17 })
    enter(game, { aux: { net: ['a'] } })
    const cursor0 = game.state.rng.cursor
    face(game)
    expect(game.state.rng.cursor).toBe(cursor0 + 1)
  })
})

describe('接口：不 import 別的功能、不改核心', () => {
  it('這個功能單獨裝起來就能用（沒有 roster、abilities）：路數的分量修正讀內容 path 與角色的 ext.paths', () => {
    const { game } = setup()
    expect(game.k.content.hasKind('path')).toBe(true)
    enter(game, { aux: { net: ['a'] } })
    expect(beatOf(facing(game), 'net')!.data).toMatchObject({ bonus: { path: 4 } })
  })

  it('內容裡沒有 path 這個種類（沒裝路數的功能）：分量修正是 0，其餘照擲', () => {
    const t = makeGame({ features: [commissionFeature], content: [{ ...PACK, content: { skill: SKILLS, faction: FACTIONS, special_map: [MAP as never], commission: [DEF as never] } }], pc: {} as never, actors: [A] })
    t.game.launch('commission', { def: 'cm_aux', aux: { net: ['a'] } }, origin)
    expect(beatOf(chooseFace(t.game.k, t.game.state, 'meat'), 'net')!.data).toMatchObject({ bonus: { skill: 3, path: 0 } })
  })
})
