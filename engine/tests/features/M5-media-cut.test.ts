// 驗收測試：dev/work/M5-media-cut.md（cpp-feature）。媒體的後半：剪（七種角度）、三個數字、片的次數、重剪、偽造、發布（上架、賣斷、談判、留著）、片的標題與簡介。
// 規格：MEDIA 1.1 節、2.1 節、第 3 節、第 5 節；DATA 第 11 節（clip 與 card）；dev/adr/0020 第一節、V7～V11、V54。
// 內容一律用測試自帶的最小假資料：一個勢力（grade 3）、替身的量表（訂閱、公信力、人氣、聲望、敵對值與下限、豔名）、替身的條件（at_home、at_facility、channel_staff）、
// 替身的衍生數值 provider（cut_pick、forge_bonus、forge_quality、forge_risk 讀角色的 ext）。
// 骰子：上架的風險用 deriveRng 擲 d20，測試先算出那一顆再把片的風險設成剛好中或剛好沒中；談判與偽造用 dcOffset 把成敗壓死，並挑骰面不是自然 1 或 20 的種子。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Actor, Change, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, deriveRng, meterOf, toMinutes } from '../../src'
import { favorsFeature, favorsOf } from '../../src/features/favors'
import { chooseDefeatOption, defeatFeature, defeatOf, defeatOptions } from '../../src/features/defeat'
import {
  CLIP_INTRO_MAX, CLIP_TITLE_MAX, DEFAULT_ANGLES, DEFAULT_MEDIA_RULES, MEDIA_DEAL_ACTION, MEDIA_FORGE_ACTION, MEDIA_UPLOAD_ACTION, angleOptions, anglesOf, cut, cutPreview, deal, dealTargets, forge, forgeQuote,
  materialOf, materialsOf, mediaFeature, mediaRules, mediaView, readMedia, recut, retitle, sell, sellPrice, spend, upload, uploadPreview,
} from '../../src/features/media'
import { angleProblems } from '../../src/features/media/angles'
import type { CutInput } from '../../src/features/media'
import type { FootageInit } from '../../src/features/media/ops'
import { ruleProblems } from '../../src/features/media/model'
import { onRewind } from '../../src/features/media/record'
import { BATTLE_SETUPS, TEST_COMBAT, makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>
type G = ReturnType<typeof makeGame>['game']

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

interface ToyOpts {
  /** 不註冊這幾個量表（沒裝那個功能的局） */
  without?: string[]
  /** 不註冊替身的條件（沒有 channel 的局：channel_staff 沒有人註冊） */
  noStaffCondition?: boolean
}

const METERS: Array<[string, Rec]> = [
  ['subs', { name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' }],
  ['credibility', { name: '公信力', min: 0, max: 100, start: 50, keyed: 'none' }],
  ['popularity', { name: '人氣', min: 0, max: 100, start: 0, keyed: 'npc' }],
  ['standing', { name: '聲望', min: 0, max: 100, start: 50, keyed: 'faction' }],
  ['hostility', { name: '敵對值', min: 0, max: 100, start: 0, keyed: 'faction' }],
  ['hostility_floor', { name: '敵對值的下限', min: 0, max: 100, start: 0, keyed: 'faction' }],
  ['fame', { name: '豔名', min: 0, max: 100, start: 0, keyed: 'district' }],
]

/** 替身：量表、條件（狀態放在 ext.toy：{ home, facility, staff }）、衍生數值（角色 ext 的 cp、fb、fq、fr）。 */
const toy = (o: ToyOpts = {}): Feature => ({
  id: 'cut_toy',
  install(k: Kernel) {
    for (const kind of ['district', 'facility_type']) k.content.defineKind({ kind, owner: 'cut_toy', validate: () => [] })
    for (const [kind, def] of METERS) if (!o.without?.includes(kind)) k.meters.define({ kind, owner: 'cut_toy', ...def } as never)
    for (const [stat, key] of [['cut_pick', 'cp'], ['forge_bonus', 'fb'], ['forge_quality', 'fq'], ['forge_risk', 'fr']] as const) {
      k.stats.addStatProvider(stat, 'cut_toy', (state, actor) => {
        const v = state.actors[actor]?.ext[key]
        return typeof v === 'number' ? [{ label: '測試技能', value: v, source: 'perk' }] : []
      })
    }
    const toyState = (s: GameState): Rec => (s.ext.toy ?? {}) as Rec
    k.conditions.register({ kind: 'at_home', owner: 'cut_toy', validate: () => [], test: (_c: Rec, ctx: Rec) => toyState(ctx.state).home === true })
    k.conditions.register({ kind: 'at_facility', owner: 'cut_toy', validate: () => [], test: (c: Rec, ctx: Rec) => Array.isArray(c.types) && c.types.includes(toyState(ctx.state).facility) })
    if (!o.noStaffCondition) k.conditions.register({ kind: 'channel_staff', owner: 'cut_toy', validate: () => [], test: (c: Rec, ctx: Rec) => (toyState(ctx.state).staff ?? []).includes(c.role) })
  },
})

const PACK: ContentPack = {
  id: 'cut_toy_pack',
  content: {
    district: [{ id: 'd_a', name: '甲區' }],
    facility_type: [{ id: 'fac_studio', name: '轉播站', edit: true }, { id: 'fac_bar', name: '酒吧' }],
    faction: [
      { id: 'f_a', name: '星旗', short: '星旗', class: 'corp', grade: 3 },
      { id: 'f_b', name: '蜂巢會', short: '蜂巢會', class: 'street', grade: 'IV' },
      { id: 'f_c', name: '沒寫等級的勢力', short: '無等級', class: 'street' },
    ],
  },
}

const BOSS = makeActor({ id: 'npc_boss', name: '大老闆', role: 'npc', ext: {} })

interface MakeOpts {
  toy?: ToyOpts
  pc?: Rec
  seed?: number
  features?: Feature[]
  content?: ContentPack[]
  rules?: Rec
  /** 開局就在住處（預設是） */
  home?: boolean
  staff?: string[]
  facility?: string
  actors?: Actor[]
}

function make(o: MakeOpts = {}): G {
  const content: ContentPack[] = [PACK, ...(o.rules ? [{ id: 'cut_rules', content: { media_rule: [{ id: 'default', ...o.rules }] } }] : []), ...(o.content ?? [])]
  const t = makeGame({
    features: [mediaFeature, toy(o.toy), TEST_COMBAT, ...(o.features ?? [])], content, seed: o.seed, pc: { ext: {}, ...o.pc }, actors: [BOSS, ...(o.actors ?? [])],
    patch: { location: { district: 'd_a' } } as Partial<GameState>,
  })
  const g = t.game
  setToy(g, { home: o.home !== false, staff: o.staff ?? [], ...(o.facility ? { facility: o.facility } : {}) })
  return g
}

const sys = (changes: Change[], action = 'test.give', extra: Partial<ReportDraft> = {}): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...extra })
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const setToy = (g: G, v: Rec): void => { give(g, [{ op: 'ext', key: 'toy', value: v }]) }
const setMeter = (g: G, kind: string, key: string, value: number): void => { give(g, [{ op: 'meter', kind, key, set: value } as Change]) }
const media = (g: G) => readMedia(g.state)
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const meter = (g: G, kind: string, key?: string): number => meterOf(g.k, g.state, kind, key)

const ft = (o: Partial<FootageInit> = {}): FootageInit => ({
  title: '素材', text: '一段素材。', type: 'battle', quality: 3, authentic: 'real', exclusive: true, involves: { factions: ['f_a'], people: [] }, uses: 3, made_at: 0, origin: 'own',
  celebrity: false, self: false, adult: false, ...o,
})

/** 放一段素材進素材庫，回傳 id。 */
function addFootage(g: G, o: Partial<FootageInit> = {}): string {
  give(g, [{ op: 'media.make', footage: ft({ made_at: toMinutes(g.state.time), ...o }) }])
  return Object.keys(media(g).footage).at(-1)!
}

/** 剪一支片，回傳它的 id 與那一份報告。 */
function cutClip(g: G, o: CutInput): { id: string; report: ReportDraft } {
  const report = cut(g.k, g.state, o)
  g.commit(report)
  return { id: Object.keys(media(g).clips).at(-1)!, report }
}

const clipOf = (g: G, id: string) => media(g).clips[id]!
const footageOf = (g: G, id: string) => media(g).footage[id]!

/** 直接改一支片存的欄位（上架的風險、品質等；走 ext 變更，測試用）。 */
function patchClip(g: G, id: string, patch: Rec): void {
  const m = media(g)
  give(g, [{ op: 'ext', key: 'media', value: JSON.parse(JSON.stringify({ ...m, clips: { ...m.clips, [id]: { ...m.clips[id], ...patch } } })) }])
}

/** 這一顆 d20：上架的風險要擲的那一顆。 */
const dieOf = (g: G, ref: string): number => deriveRng(g.state.rng, `${MEDIA_UPLOAD_ACTION}/${ref}`).int(1, 20)

/** 沒有任何 rep（街頭信譽）的變更與效果（V54）。 */
function noRep(g: G): void {
  for (const r of g.state.reports) {
    expect(JSON.stringify(r.changes), r.action).not.toMatch(/"kind":"rep"/)
    expect(JSON.stringify(r.timeline), r.action).not.toMatch(/"kind":"rep"/)
  }
}

const kindsOf = (effects: Array<{ kind: string }>): string[] => effects.map((e) => e.kind)
const effectOf = (effects: Rec[], kind: string, key?: string): Rec | undefined => effects.find((e) => e.kind === kind && (key === undefined || e.key === key))

/** 挑一個種子：那個種子上某個用途的骰面符合條件（談判、偽造的成敗用 dcOffset 壓死之後，只剩自然 1 與 20 會例外）。 */
function gameWhere(build: (seed: number) => G, ok: (g: G) => boolean): G {
  for (let seed = 1; seed <= 60; seed++) {
    const g = build(seed)
    if (ok(g)) return g
  }
  throw new Error('找不到合適的種子')
}

const naturalOf = (g: G, purpose: string): number => deriveRng(g.state.rng, purpose).int(1, 20)

// ===================================================================================================================
describe('七種角度的適用類型（MEDIA 第 3 節的表）', () => {
  it('預設七筆，三類各自對；每一筆都過格式檢查', () => {
    expect(DEFAULT_ANGLES.map((a) => a.id)).toEqual(['documentary', 'daily', 'fun', 'hero', 'expose', 'sensational', 'smear'])
    expect(DEFAULT_ANGLES.map((a) => a.group)).toEqual(['neutral', 'neutral', 'neutral', 'positive', 'dispute', 'dispute', 'dispute'])
    for (const a of DEFAULT_ANGLES) expect(angleProblems(a as unknown as Rec), a.id).toEqual([])
    const g = make()
    expect(anglesOf(g.k).map((a) => a.id)).toEqual(DEFAULT_ANGLES.map((a) => a.id))
  })

  it('一段戰鬥的素材：選得了紀實、娛樂、英雄、煽情、抹黑；選不了日常與揭弊，原因寫出是哪一段、哪一型', () => {
    const g = make()
    const a = addFootage(g, { title: '倉庫的槍戰', type: 'battle' })
    const opts = Object.fromEntries(angleOptions(g.k, g.state, [a]).map((o) => [o.id, o]))
    expect(Object.entries(opts).filter(([, o]) => o.can).map(([id]) => id).sort()).toEqual(['documentary', 'fun', 'hero', 'sensational', 'smear'])
    expect(opts.daily).toMatchObject({ can: false, why: '「倉庫的槍戰」是戰鬥類的素材，日常角度只收日常、名人、親密類，所以選不了。' })
    expect(opts.expose).toMatchObject({ can: false, why: '「倉庫的槍戰」是戰鬥類的素材，揭弊角度只收罪證、醜聞類，所以選不了。' })
    expect(opts.documentary).toMatchObject({ can: true, why: null })
  })

  it.each([
    ['daily', ['daily', 'celebrity', 'intimate']],
    ['hero', ['battle', 'celebrity']],
    ['expose', ['crime', 'scandal']],
    ['sensational', ['intimate', 'scandal', 'battle']],
  ])('%s 角度收的類型逐個對', (angle, ok) => {
    const g = make()
    for (const type of ['battle', 'scandal', 'crime', 'intimate', 'celebrity', 'daily'] as const) {
      const id = addFootage(g, { type })
      const o = angleOptions(g.k, g.state, [id]).find((x) => x.id === angle)!
      expect(o.can, `${angle}/${type}`).toBe(ok.includes(type))
    }
  })

  it('紀實、娛樂、抹黑收任何類型', () => {
    const g = make()
    for (const type of ['battle', 'scandal', 'crime', 'intimate', 'celebrity', 'daily'] as const) {
      const id = addFootage(g, { type })
      const opts = angleOptions(g.k, g.state, [id])
      for (const a of ['documentary', 'fun', 'smear']) expect(opts.find((x) => x.id === a)!.can, `${a}/${type}`).toBe(true)
    }
  })

  it('兩三段一起剪：每一段都要落在角度的範圍裡，原因寫出是哪一段不行', () => {
    const g = make()
    const a = addFootage(g, { title: '甲', type: 'crime' })
    const b = addFootage(g, { title: '乙', type: 'battle' })
    const exp = angleOptions(g.k, g.state, [a, b]).find((x) => x.id === 'expose')!
    expect(exp).toMatchObject({ can: false })
    expect(exp.why).toContain('「乙」是戰鬥類')
    expect(angleOptions(g.k, g.state, [a, b]).find((x) => x.id === 'documentary')!.can).toBe(true)
  })

  it('來源本身不能剪：七種的原因都是那一句（沒選、四段、重複、不存在、只剩 1 次、用完）', () => {
    const g = make()
    const a = addFootage(g)
    const one = addFootage(g, { title: '只剩一次', uses: 1 })
    const zero = addFootage(g, { title: '用光的', uses: 3 })
    give(g, [{ op: 'media.use', ref: zero, take: 'all' }])
    const whyAll = (parts: string[]): Array<string | null> => [...new Set(angleOptions(g.k, g.state, parts).map((o) => o.why))]
    expect(whyAll([])).toEqual(['要先選一到三段素材。'])
    expect(whyAll([a, a])).toEqual(['同一段素材不能選兩次。'])
    expect(whyAll([a, addFootage(g), addFootage(g), addFootage(g)])).toEqual(['一支片最多用三段素材。'])
    expect(whyAll(['ft999'])).toEqual(['素材庫裡沒有這件素材。'])
    expect(whyAll([one])).toEqual(['「只剩一次」只剩 1 次：剪完會是 0 次，片一出生就用完了，所以剪不了。'])
    expect(whyAll([zero])).toEqual(['「用光的」已經用完了，只能留著當紀念。'])
  })
})

// ===================================================================================================================
describe('三個數字（MEDIA 第 3 節的算式）：每一種角度一組固定輸入', () => {
  // 品質 3、涉及 f_a（grade 3）、不是名人、真料。看點 = 品質 + 修正；可信 = 品質 × 2 + 修正；風險 = 3 + 修正
  const CASES: Array<[string, 'battle' | 'daily' | 'crime', number, number, number, string | null]> = [
    ['documentary', 'battle', 3, 8, 3, 'line'],
    ['daily', 'daily', 2, 7, 2, null],
    ['fun', 'battle', 5, 4, 3, 'decoy'],
    ['hero', 'battle', 4, 6, 3, 'line'],
    ['expose', 'crime', 3, 7, 4, 'line'],
    ['sensational', 'battle', 5, 5, 4, 'fuel'],
  ]
  it.each(CASES)('%s：看點 %i、可信 %i、風險 %i', (angle, type, draw, trust, risk, card) => {
    const g = make()
    const a = addFootage(g, { type, quality: 3 })
    const { id } = cutClip(g, { parts: [a], angle })
    expect(clipOf(g, id)).toMatchObject({ draw, trust, risk, forged: false })
    expect(clipOf(g, id).card?.kind ?? null).toBe(card)
  })

  it('抹黑：看點 +1、可信 −1、風險 +3，而且是假料（可信 −3、風險 +5）：看點 4、可信 2、風險 11；要指定另一個勢力', () => {
    const g = make()
    const a = addFootage(g, { type: 'battle', quality: 3 })
    expect(reasonOf(() => cut(g.k, g.state, { parts: [a], angle: 'smear' }))).toBe('抹黑要指定把責任導向哪一個勢力。')
    expect(reasonOf(() => cut(g.k, g.state, { parts: [a], angle: 'smear', blame: 'f_a' }))).toBe('星旗就是片裡拍到的勢力，抹黑要把責任導向另一個勢力。')
    expect(reasonOf(() => cut(g.k, g.state, { parts: [a], angle: 'smear', blame: 'f_zz' }))).toBe('查不到你指定的那個勢力。')
    const { id } = cutClip(g, { parts: [a], angle: 'smear', blame: 'f_b' })
    expect(clipOf(g, id)).toMatchObject({ draw: 4, trust: 2, risk: 11, forged: true, blame: 'f_b', card: { kind: 'fuel', value: 4 } })
  })

  it('涉及名人看點 +1；偽造的來源：可信 −3、風險 +5；可信夾 0～10；風險最少 0', () => {
    const g = make()
    const celeb = addFootage(g, { quality: 3, celebrity: true })
    expect(clipOf(g, cutClip(g, { parts: [celeb], angle: 'documentary' }).id)).toMatchObject({ draw: 4, celebrity: true })
    const fake = addFootage(g, { quality: 3, authentic: 'forged' })
    expect(clipOf(g, cutClip(g, { parts: [fake], angle: 'documentary' }).id)).toMatchObject({ trust: 5, risk: 8, forged: true })
    // 可信夾在 10：品質 5 × 2 + 2 = 12
    const top = addFootage(g, { quality: 5 })
    expect(clipOf(g, cutClip(g, { parts: [top], angle: 'documentary' }).id).trust).toBe(10)
    // 可信最少 0：品質 1、偽造、娛樂 = 2 − 2 − 3
    const low = addFootage(g, { quality: 1, authentic: 'forged' })
    expect(clipOf(g, cutClip(g, { parts: [low], angle: 'fun' }).id).trust).toBe(0)
  })

  it('風險最少 0：沒有涉及的勢力用基礎 2，規則表把基礎蓋成 0 之後日常 −1 還是 0', () => {
    const g = make({ rules: { risk: { base: 0, forged: 5 } } })
    const a = addFootage(g, { type: 'daily', involves: { factions: [], people: [] } })
    expect(clipOf(g, cutClip(g, { parts: [a], angle: 'daily' }).id).risk).toBe(0)
    const g2 = make()
    const b = addFootage(g2, { type: 'daily', involves: { factions: [], people: [] } })
    expect(clipOf(g2, cutClip(g2, { parts: [b], angle: 'daily' }).id).risk).toBe(1)
  })

  it('勢力的等級：數字、羅馬數字、沒寫（V8，當 2）；多個勢力取最高的', () => {
    const g = make()
    const level = (f: string[]): number => {
      const a = addFootage(g, { involves: { factions: f, people: [] } })
      return cutPreview(g.k, g.state, { parts: [a], angle: 'documentary' }).detail!.risk
    }
    expect(level(['f_a'])).toBe(3)
    expect(level(['f_b'])).toBe(4)
    expect(level(['f_c'])).toBe(2)
    expect(level(['f_a', 'f_b', 'f_c'])).toBe(4)
  })

  it('品質是來源品質的平均四捨五入；類型、涉及的勢力與人取聯集；獨家要每一段都是', () => {
    const g = make()
    const q = (list: number[]): number => cutPreview(g.k, g.state, { parts: list.map((x) => addFootage(g, { quality: x })), angle: 'documentary' }).detail!.quality
    expect(q([2, 3])).toBe(3)
    expect(q([1, 2])).toBe(2)
    expect(q([3, 3, 2])).toBe(3)
    expect(q([1, 1, 2])).toBe(1)
    const a = addFootage(g, { type: 'crime', involves: { factions: ['f_a'], people: ['npc_boss'] }, tags: ['t1'] })
    const b = addFootage(g, { type: 'scandal', involves: { factions: ['f_b'], people: [] }, exclusive: false, tags: ['t2'], self: true })
    const { id } = cutClip(g, { parts: [a, b], angle: 'expose' })
    expect(clipOf(g, id)).toMatchObject({ types: ['scandal', 'crime'], involves: { factions: ['f_a', 'f_b'], people: ['npc_boss'] }, exclusive: false, self: true, tags: ['t1', 't2'], from: [a, b] })
    expect(materialOf(g.k, g.state, id)!.tags).toEqual(['t1', 't2'])
  })

  it('親密類的看點加主角各區豔名最高那一區的級數（每 30 點一級）', () => {
    const g = make()
    setMeter(g, 'fame', 'd_a', 65)
    const a = addFootage(g, { type: 'intimate', quality: 2 })
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'fun' }).detail!.draw).toBe(2 + 2 + 2)
    const b = addFootage(g, { type: 'battle', quality: 2 })
    expect(cutPreview(g.k, g.state, { parts: [b], angle: 'fun' }).detail!.draw).toBe(4)
  })

  it('cut_pick 大於 0：pick 讓看點或可信 +1；cut_pick 是 0 時 pick 被忽略；card 的數字跟著', () => {
    const g = make({ pc: { ext: { cp: 1 } } })
    const a = addFootage(g, { type: 'battle', quality: 3 })
    const base = cutPreview(g.k, g.state, { parts: [a], angle: 'documentary' }).detail!
    expect(base).toMatchObject({ draw: 3, trust: 8, pick: null, pick_can: true })
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'documentary', pick: 'draw' }).detail).toMatchObject({ draw: 4, trust: 8, pick: 'draw' })
    const t = cutPreview(g.k, g.state, { parts: [a], angle: 'documentary', pick: 'trust' }).detail!
    expect(t).toMatchObject({ draw: 3, trust: 9, card: { kind: 'line', value: 9 } })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary', pick: 'trust' })
    expect(clipOf(g, id)).toMatchObject({ trust: 9, pick: 'trust' })
    const g0 = make()
    const b = addFootage(g0, { type: 'battle', quality: 3 })
    expect(cutPreview(g0.k, g0.state, { parts: [b], angle: 'documentary', pick: 'draw' }).detail).toMatchObject({ draw: 3, pick: null, pick_can: false })
  })

  it('card：紀實、英雄、揭弊是 line（可信）；煽情、抹黑是 fuel（看點）；日常 null；娛樂 decoy', () => {
    const g = make()
    const want: Record<string, string | null> = { documentary: 'line', hero: 'line', expose: 'line', sensational: 'fuel', smear: 'fuel', daily: null, fun: 'decoy' }
    for (const [angle, kind] of Object.entries(want)) {
      const type = angle === 'expose' ? 'crime' : angle === 'daily' ? 'daily' : 'battle'
      const a = addFootage(g, { type })
      const blame = angle === 'smear' ? { blame: 'f_b' } : {}
      const d = cutPreview(g.k, g.state, { parts: [a], angle, ...blame }).detail!
      expect(d.card?.kind ?? null, angle).toBe(kind)
      if (kind === 'line') expect(d.card!.value).toBe(d.trust)
      if (kind === 'fuel') expect(d.card!.value).toBe(d.draw)
    }
  })
})

// ===================================================================================================================
describe('使用次數（MEDIA 2.1 節）', () => {
  it('素材 3：用掉一次剩 2、剪成片：素材剩 1、片 1', () => {
    const g = make()
    const a = addFootage(g)
    const sp = spend(g.k, g.state, { ref: a, how: 'post' })
    if ('block' in sp) throw new Error(sp.block)
    give(g, sp.changes)
    expect(footageOf(g, a).uses).toBe(2)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(footageOf(g, a).uses).toBe(1)
    expect(clipOf(g, id).uses).toBe(1)
  })

  it('兩段（3、2）剪成片：來源剩 2、1，片是 1', () => {
    const g = make()
    const a = addFootage(g, { uses: 3 })
    const b = addFootage(g, { uses: 2 })
    const { id } = cutClip(g, { parts: [a, b], angle: 'documentary' })
    expect([footageOf(g, a).uses, footageOf(g, b).uses]).toEqual([2, 1])
    expect(clipOf(g, id).uses).toBe(1)
    // 三段全 3：來源各剩 2，片 2
    const x = [addFootage(g), addFootage(g), addFootage(g)]
    expect(clipOf(g, cutClip(g, { parts: x, angle: 'documentary' }).id).uses).toBe(2)
    expect(x.map((r) => footageOf(g, r).uses)).toEqual([2, 2, 2])
  })

  it('剩 1 次的剪不了（整個不能剪，原因寫出是哪一段）；剪片前後次數都不動', () => {
    const g = make()
    const a = addFootage(g)
    const b = addFootage(g, { title: '最後一次', uses: 1 })
    expect(reasonOf(() => cut(g.k, g.state, { parts: [a, b], angle: 'documentary' }))).toBe('「最後一次」只剩 1 次：剪完會是 0 次，片一出生就用完了，所以剪不了。')
    expect([footageOf(g, a).uses, footageOf(g, b).uses]).toEqual([3, 1])
    expect(Object.keys(media(g).clips)).toEqual([])
  })

  it('片和來源各算各的：用片不動來源；用素材也不動剪出來的片；片用完 media.materials 不再列', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const sp = spend(g.k, g.state, { ref: id, how: 'post' })
    if ('block' in sp) throw new Error(sp.block)
    expect(sp.material).toMatchObject({ ref: id, kind: 'clip', uses: 1 })
    expect(clipOf(g, id).uses).toBe(2)
    give(g, sp.changes)
    expect([clipOf(g, id).uses, footageOf(g, a).uses]).toEqual([1, 2])
    give(g, [{ op: 'media.use', ref: id, take: 'all' }])
    expect([clipOf(g, id).uses, footageOf(g, a).uses]).toEqual([0, 2])
    expect(materialsOf(g.k, g.state).map((m) => m.ref)).toEqual([a])
    expect(materialsOf(g.k, g.state, ['clip'])).toEqual([])
    expect(spend(g.k, g.state, { ref: id })).toEqual({ block: `「${clipOf(g, id).title}」已經用完了，只能留著當紀念。` })
    expect(() => give(g, [{ op: 'media.use', ref: id, take: 1 }])).toThrow()
    // 用素材不動片
    const b = addFootage(g)
    const c = cutClip(g, { parts: [b], angle: 'fun' }).id
    give(g, [{ op: 'media.use', ref: b, take: 'all' }])
    expect(clipOf(g, c).uses).toBe(2)
  })

  it('media.materials 的掛點：素材與片都答，kinds 可以只要片', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const all = g.k.hooks.run('media.materials', { state: g.state }).flatMap((r) => r.result)
    expect(all.map((m) => m.ref).sort()).toEqual([a, id].sort())
    const clips = g.k.hooks.run('media.materials', { state: g.state, kinds: ['clip'] }).flatMap((r) => r.result)
    expect(clips).toEqual([expect.objectContaining({ ref: id, kind: 'clip', angle: 'documentary', card: { kind: 'line', value: 8 }, quality: 3 })])
    const sp = g.k.hooks.run('media.spend', { state: g.state, ref: id, how: 'deck' }).flatMap((r) => r.result)
    expect(sp[0]).toMatchObject({ changes: [{ op: 'media.use', ref: id, take: 1 }] })
  })

  it('片的新鮮度從剪的那天算起', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(materialOf(g.k, g.state, id)!.fresh).toBe('new')
    give(g, [{ op: 'time', minutes: 8 * 1440 }])
    expect(materialOf(g.k, g.state, id)!.fresh).toBe('old')
  })
})

// ===================================================================================================================
describe('剪的地點與時間（MEDIA 第 3 節；工單的 M4 對帳）', () => {
  it('不在住處也不在帶 edit 的設施：剪不了、偽造不了，原因是完整的一句', () => {
    const g = make({ home: false })
    const a = addFootage(g)
    const why = '剪片與偽造要在自己的住處，或有剪輯設備的地方（例如轉播站）。'
    expect(reasonOf(() => cut(g.k, g.state, { parts: [a], angle: 'documentary' }))).toBe(why)
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'documentary' })).toMatchObject({ ok: false, block: why, detail: expect.objectContaining({ draw: 3 }) })
    expect(reasonOf(() => forge(g.k, g.state, { type: 'crime', faction: 'f_a' }))).toBe(why)
  })

  it('住處（不看等級）與帶 edit 的設施都行；沒有 edit 的設施不行', () => {
    const g = make({ home: false, facility: 'fac_studio' })
    const a = addFootage(g)
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'documentary' }).ok).toBe(true)
    setToy(g, { facility: 'fac_bar', staff: [] })
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'documentary' }).ok).toBe(false)
    setToy(g, { home: true })
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'documentary' }).ok).toBe(true)
  })

  it('剪花一個時段（240 分鐘）；報告是 media.cut（broadcast）；規則表可以改分鐘', () => {
    const g = make()
    const a = addFootage(g)
    const t0 = toMinutes(g.state.time)
    const { report } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(report).toMatchObject({ kind: 'broadcast', action: 'media.cut' })
    expect(toMinutes(g.state.time) - t0).toBe(240)
    const g2 = make({ rules: { cut: { minutes: 90 } } })
    const b = addFootage(g2)
    const t1 = toMinutes(g2.state.time)
    cutClip(g2, { parts: [b], angle: 'documentary' })
    expect(toMinutes(g2.state.time) - t1).toBe(90)
  })

  it('戰鬥進行中不能剪、不能偽造、不能上架：沒有登記放行', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(reasonOf(() => cut(g.k, g.state, { parts: [addFootage(g)], angle: 'documentary' }))).toBe('正在戰鬥，先把這一場打完。')
    expect(reasonOf(() => forge(g.k, g.state, { type: 'crime', faction: 'f_a' }))).toBe('正在戰鬥，先把這一場打完。')
    expect(uploadPreview(g.k, g.state, { ref: id }).block).toBe('正在戰鬥，先把這一場打完。')
    expect(reasonOf(() => sell(g.k, g.state, id))).toBe('正在戰鬥，先把這一場打完。')
  })
})

// ===================================================================================================================
describe('重剪（MEDIA 2.1 節）', () => {
  it('沒有製作：被擋，原因「要有製作才能重剪。」；沒有人註冊 channel_staff 這個條件也一樣', () => {
    const g = make()
    const { id } = cutClip(g, { parts: [addFootage(g)], angle: 'documentary' })
    expect(reasonOf(() => recut(g.k, g.state, { ref: id, angle: 'hero' }))).toBe('要有製作才能重剪。')
    const g2 = make({ toy: { noStaffCondition: true }, staff: ['producer'] })
    const c2 = cutClip(g2, { parts: [addFootage(g2)], angle: 'documentary' }).id
    expect(g2.k.conditions.kinds()).not.toContain('channel_staff')
    expect(reasonOf(() => recut(g2.k, g2.state, { ref: c2, angle: 'hero' }))).toBe('要有製作才能重剪。')
    // 別的職位不算
    const g3 = make({ staff: ['editor'] })
    const c3 = cutClip(g3, { parts: [addFootage(g3)], angle: 'documentary' }).id
    expect(reasonOf(() => recut(g3.k, g3.state, { ref: c3, angle: 'hero' }))).toBe('要有製作才能重剪。')
  })

  it('有製作：只改角度、重算三個數字與 card；不動來源、不扣片的次數、不花時間；第二次被擋', () => {
    const g = make({ staff: ['producer'] })
    const a = addFootage(g, { type: 'battle', quality: 3 })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(clipOf(g, id)).toMatchObject({ draw: 3, trust: 8, risk: 3, card: { kind: 'line', value: 8 } })
    const before = { src: footageOf(g, a).uses, uses: clipOf(g, id).uses, t: toMinutes(g.state.time) }
    const [rep] = g.commit(recut(g.k, g.state, { ref: id, angle: 'sensational' }))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.recut' })
    expect(clipOf(g, id)).toMatchObject({ angle: 'sensational', draw: 5, trust: 5, risk: 4, card: { kind: 'fuel', value: 5 }, recut: true })
    expect({ src: footageOf(g, a).uses, uses: clipOf(g, id).uses, t: toMinutes(g.state.time) }).toEqual(before)
    expect(reasonOf(() => recut(g.k, g.state, { ref: id, angle: 'hero' }))).toBe(`「${clipOf(g, id).title}」已經重剪過了：每支片最多重剪一次。`)
  })

  it('新角度仍要對得上來源的類型；同一個角度不算重剪；抹黑要指定另一個勢力並變成假料，換走之後恢復', () => {
    const g = make({ staff: ['producer'] })
    const a = addFootage(g, { type: 'battle' })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(reasonOf(() => recut(g.k, g.state, { ref: id, angle: 'expose' }))).toContain('是戰鬥類的素材，揭弊角度只收罪證、醜聞類')
    expect(reasonOf(() => recut(g.k, g.state, { ref: id, angle: 'documentary' }))).toContain('本來就是紀實的角度')
    expect(reasonOf(() => recut(g.k, g.state, { ref: id, angle: 'smear' }))).toBe('抹黑要指定把責任導向哪一個勢力。')
    expect(reasonOf(() => recut(g.k, g.state, { ref: id, angle: 'nope' }))).toBe('沒有這種角度。')
    g.commit(recut(g.k, g.state, { ref: id, angle: 'smear', blame: 'f_b' }))
    expect(clipOf(g, id)).toMatchObject({ forged: true, blame: 'f_b', trust: 2, risk: 11 })
    // 偽造的是角度，不是來源：沒有第二次重剪，所以這裡直接再造一支驗「換走之後恢復」
    const b = addFootage(g, { type: 'battle' })
    const c = cutClip(g, { parts: [b], angle: 'smear', blame: 'f_b' }).id
    expect(clipOf(g, c).forged).toBe(true)
    g.commit(recut(g.k, g.state, { ref: c, angle: 'hero' }))
    expect(clipOf(g, c)).toMatchObject({ forged: false, trust: 6, risk: 3 })
    expect(clipOf(g, c).blame).toBeUndefined()
  })

  it('用完的片、不存在的片不能重剪；重剪帶著剪的時候 cut_pick 的那一項', () => {
    const g = make({ staff: ['producer'], pc: { ext: { cp: 1 } } })
    const a = addFootage(g, { type: 'battle', quality: 3 })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary', pick: 'draw' })
    g.commit(recut(g.k, g.state, { ref: id, angle: 'hero' }))
    expect(clipOf(g, id)).toMatchObject({ draw: 5, trust: 6 })
    const b = addFootage(g, { type: 'battle' })
    const c = cutClip(g, { parts: [b], angle: 'documentary' }).id
    give(g, [{ op: 'media.use', ref: c, take: 'all' }])
    expect(reasonOf(() => recut(g.k, g.state, { ref: c, angle: 'hero' }))).toContain('已經用完了')
    expect(reasonOf(() => recut(g.k, g.state, { ref: 'cl999', angle: 'hero' }))).toBe('素材庫裡沒有這支片。')
  })
})

// ===================================================================================================================
describe('偽造（V7）', () => {
  const rollOf = (g: G): number => naturalOf(g, `${MEDIA_FORGE_ACTION}/${media(g).seq}`)
  const forgedFootage = (g: G) => Object.values(media(g).footage).at(-1)!

  it('產生一段 forged 的素材：醜聞或罪證、涉及指定的勢力、3 次、花一個時段、報告是 media.forge', () => {
    const g = make()
    const t0 = toMinutes(g.state.time)
    const [rep] = g.commit(forge(g.k, g.state, { type: 'crime', faction: 'f_a' }))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.forge' })
    expect(forgedFootage(g)).toMatchObject({ authentic: 'forged', type: 'crime', uses: 3, involves: { factions: ['f_a'], people: [] }, origin: 'own', exclusive: true })
    expect(toMinutes(g.state.time) - t0).toBe(240)
    expect(reasonOf(() => forge(g.k, g.state, { type: 'battle' as never, faction: 'f_a' }))).toBe('偽造只做醜聞或罪證類的素材。')
    expect(reasonOf(() => forge(g.k, g.state, { type: 'crime', faction: '' }))).toBe('要指定這段畫面栽在哪一個勢力頭上。')
    expect(reasonOf(() => forge(g.k, g.state, { type: 'crime', faction: 'f_zz' }))).toBe('查不到你指定的那個勢力。')
  })

  it('品質：成功 2、大成功 3、失敗 1，再加 forge_quality；擲的是介面（智識）對 15', () => {
    const run = (dcOffset: number, fq: number): { quality: number; degree: string } => {
      const g = gameWhere((seed) => make({ seed, pc: { ext: { fq } } }), (x) => ![1, 20].includes(rollOf(x)))
      g.state.rules.dcOffset = dcOffset
      const q = forgeQuote(g.k, g.state)!
      expect(q.dc).toBe(15 + dcOffset)
      const [rep] = g.commit(forge(g.k, g.state, { type: 'scandal', faction: 'f_a' }))
      expect(rep!.timeline[0]!.roll).toMatchObject({ attr: 'intellect', skill: 'interface', dc: 15 + dcOffset })
      return { quality: forgedFootage(g).quality, degree: rep!.outcome.result }
    }
    expect(run(-3, 0)).toEqual({ quality: 2, degree: 'success' })
    expect(run(-30, 0)).toEqual({ quality: 3, degree: 'critical' })
    expect(run(30, 0)).toEqual({ quality: 1, degree: 'fumble' })
    expect(run(-3, 1)).toEqual({ quality: 3, degree: 'success' })
    expect(run(30, 2)).toEqual({ quality: 3, degree: 'fumble' })
    expect(run(1, 0)).toEqual({ quality: 1, degree: 'fail' })
    expect(run(-30, 2)).toEqual({ quality: 5, degree: 'critical' })
  })

  it('forge_bonus 進擲骰的加值；報價的成功率與骰面對得上', () => {
    const g = make({ pc: { ext: { fb: 3 } } })
    const q = forgeQuote(g.k, g.state)!
    expect(q).toMatchObject({ dc: 15, bonus: 3, minutes: 240, quality: { ok: 2, crit: 3, fail: 1 } })
    // 加值 3：骰面 12 以上過關，再加自然 20；自然 1 不過
    expect(q.chance).toBeCloseTo(9 / 20)
    const [rep] = g.commit(forge(g.k, g.state, { type: 'crime', faction: 'f_a' }))
    expect(rep!.timeline[0]!.roll!.parts.map((p) => p.label)).toContain('假料的手藝')
  })

  it('用偽造的素材剪的片是假料；偽造的素材可以直接上架（風險 2 ＋ 5）', () => {
    const g = make()
    g.commit(forge(g.k, g.state, { type: 'crime', faction: 'f_a' }))
    const f = Object.keys(media(g).footage).at(-1)!
    expect(materialOf(g.k, g.state, f)).toMatchObject({ forged: true, risk: 7 })
    const { id } = cutClip(g, { parts: [f], angle: 'expose' })
    expect(clipOf(g, id)).toMatchObject({ forged: true })
    expect(clipOf(g, id).trust).toBe(clipOf(g, id).quality * 2 + 1 - 3)
  })
})

// ===================================================================================================================
describe('直接上架（V9）', () => {
  /** 剪一支片（品質 3、勢力 f_a），把風險壓到剛好沒中，回傳 id。 */
  function clipOfAngle(g: G, angle: string, type: 'battle' | 'crime' | 'daily' | 'intimate' = 'battle', o: Partial<FootageInit> = {}, cutOpts: Partial<CutInput> = {}): string {
    const a = addFootage(g, { type, quality: 3, ...o })
    const { id } = cutClip(g, { parts: [a], angle, ...cutOpts })
    patchClip(g, id, { risk: 0 })
    return id
  }
  const base = (g: G): void => { setMeter(g, 'subs', '_', 1000); setMeter(g, 'credibility', '_', 50) }

  it('每一種角度的效果清單：訂閱、公信力與角度的範本，對 V9', () => {
    const g = make()
    base(g)
    const eff = (angle: string, type: 'battle' | 'crime' | 'daily', extra: Partial<CutInput> = {}): Rec[] => uploadPreview(g.k, g.state, { ref: clipOfAngle(g, angle, type, {}, extra) }).effects as Rec[]
    // 紀實：看點 3 → 訂閱 max(6, 1000 × 1.5%) = 15；可信 8 → (8−5)/2 = 1，再 +1 = 2
    expect(eff('documentary', 'battle')).toEqual([{ kind: 'subs', amount: 15, key: '_', adjusted: true }, { kind: 'credibility', amount: 2, key: '_', adjusted: true }])
    // 日常：看點 2、可信 7 → 訂閱 max(4, 1%) = 10；公信力 +1；人氣 +1
    const daily = eff('daily', 'daily')
    expect(daily.map((e) => [e.kind, e.amount])).toEqual([['subs', 10], ['credibility', 1], ['popularity', 1]])
    expect(effectOf(daily, 'popularity')!.key).toBe('pc')
    // 娛樂：看點 5、可信 4 → 訂閱 (2.5 + 1)% = 35；公信力 (4−5)/2 → 0（捨去）
    expect(eff('fun', 'battle').map((e) => [e.kind, e.amount])).toEqual([['subs', 35]])
    // 英雄：看點 4、可信 6 → 訂閱 (2 + 1)% = 30；公信力 0；人氣 +1
    expect(eff('hero', 'battle').map((e) => [e.kind, e.amount])).toEqual([['subs', 30], ['popularity', 1]])
    // 揭弊：看點 3、可信 7 → 訂閱 15；公信力 1 + 1 = 2；目標勢力聲望 −3、敵對值 +5
    const expose = eff('expose', 'crime')
    expect(expose.map((e) => [e.kind, e.key, e.amount])).toEqual([['subs', '_', 15], ['credibility', '_', 2], ['standing', 'f_a', -3], ['hostility', 'f_a', 5]])
    // 煽情：看點 5、可信 5 → 訂閱 (2.5 + 2)% = 45；公信力 0 − 1 = −1；沒有你在畫面裡就沒有豔名
    expect(eff('sensational', 'battle').map((e) => [e.kind, e.amount])).toEqual([['subs', 45], ['credibility', -1]])
    // 抹黑：看點 4、可信 2 → 訂閱 (2)% = 20；公信力 trunc(−1.5) = −1；把聲望 −3 記在指定的另一個勢力
    const smear = eff('smear', 'battle', { blame: 'f_b' })
    expect(smear.map((e) => [e.kind, e.key, e.amount])).toEqual([['subs', '_', 20], ['credibility', '_', -1], ['standing', 'f_b', -3]])
  })

  it('訂閱最少是看點 × 2 人：現有訂閱是 0 也有；上架之後量表真的動了，次數扣 1', () => {
    const g = make()
    const id = clipOfAngle(g, 'documentary')
    expect(meter(g, 'subs')).toBe(0)
    const before = clipOf(g, id).uses
    const [rep] = g.commit(upload(g.k, g.state, { ref: id }))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.upload', outcome: { result: 'posted' } })
    expect(meter(g, 'subs')).toBe(6)
    expect(meter(g, 'credibility')).toBe(52)
    expect(clipOf(g, id).uses).toBe(before - 1)
    noRep(g)
  })

  it('不剪的素材直接上架：沒有角度的單段片（看點 = 品質、可信 = 品質 × 2、風險 = 2），扣的是素材自己的次數', () => {
    const g = make({ rules: { risk: { base: 0, forged: 5 } } })
    const a = addFootage(g, { quality: 3, involves: { factions: [], people: [] } })
    const p = uploadPreview(g.k, g.state, { ref: a })
    expect(p).toMatchObject({ ok: true, risk: 0 })
    // 看點 3 → 訂閱 6；可信 6 → (6−5)/2 = 0
    expect(kindsOf(p.effects)).toEqual(['subs'])
    g.commit(upload(g.k, g.state, { ref: a }))
    expect(footageOf(g, a).uses).toBe(2)
    expect(meter(g, 'subs')).toBe(6)
  })

  it('匿名：訂閱與公信力少三成（往 0 捨去）、沒有敵對值、風險少 5；標題與勢力聲望照舊', () => {
    const g = make()
    base(g)
    const id = clipOfAngle(g, 'expose', 'crime')
    patchClip(g, id, { risk: 9 })
    const open = uploadPreview(g.k, g.state, { ref: id })
    const anon = uploadPreview(g.k, g.state, { ref: id, anon: true })
    expect(open.risk).toBe(9)
    expect(anon.risk).toBe(4)
    expect(anon.risk_parts).toEqual([{ label: '這支片的風險', value: 9 }, { label: '匿名上架', value: -5 }])
    expect(effectOf(open.effects, 'subs')!.amount).toBe(15)
    expect(effectOf(anon.effects, 'subs')!.amount).toBe(10) // 15 × 0.7 = 10.5 → 10
    expect(effectOf(anon.effects, 'credibility')!.amount).toBe(1) // 2 × 0.7 = 1.4 → 1
    expect(effectOf(open.effects, 'hostility', 'f_a')!.amount).toBe(5)
    expect(effectOf(anon.effects, 'hostility')).toBeUndefined()
    expect(effectOf(anon.effects, 'standing', 'f_a')!.amount).toBe(-3)
    // 風險不會是負的
    patchClip(g, id, { risk: 2 })
    expect(uploadPreview(g.k, g.state, { ref: id, anon: true }).risk).toBe(0)
  })

  it('風險擲中：涉及的每個勢力敵對值 +5；擲不中沒有；匿名擲中也沒有敵對值', () => {
    const run = (hit: boolean, anon = false): { host: number; result: string } => {
      const g = make()
      const id = clipOfAngle(g, 'documentary')
      const d = dieOf(g, id)
      patchClip(g, id, { risk: hit ? d + (anon ? 5 : 0) : Math.max(0, d - 1) })
      const [rep] = g.commit(upload(g.k, g.state, { ref: id, anon }))
      expect(rep!.timeline[0]!.data).toMatchObject({ roll: d, hit, anon })
      expect(rep!.changes.filter((c) => c.op === 'rng')).toEqual([{ op: 'rng', advance: 1 }])
      return { host: meter(g, 'hostility', 'f_a'), result: rep!.outcome.result }
    }
    expect(run(true)).toEqual({ host: 5, result: 'caught' })
    expect(run(false)).toEqual({ host: 0, result: 'posted' })
    expect(run(true, true)).toEqual({ host: 0, result: 'caught' })
  })

  it('風險擲中而且是假料：公信力 −8（匿名也一樣被拆穿）', () => {
    const g = make()
    base(g)
    const a = addFootage(g, { type: 'battle', quality: 3, authentic: 'forged' })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const d = dieOf(g, id)
    patchClip(g, id, { risk: d + 5 })
    const open = uploadPreview(g.k, g.state, { ref: id })
    expect(effectOf(open.hit_effects as Rec[], 'credibility')!.amount).toBe(-8)
    expect(effectOf(open.hit_effects as Rec[], 'hostility', 'f_a')!.amount).toBe(5)
    const anon = uploadPreview(g.k, g.state, { ref: id, anon: true })
    expect(effectOf(anon.hit_effects as Rec[], 'credibility')!.amount).toBe(-8)
    expect(effectOf(anon.hit_effects as Rec[], 'hostility')).toBeUndefined()
    const [rep] = g.commit(upload(g.k, g.state, { ref: id }))
    expect(rep!.outcome.result).toBe('exposed')
    // 紀實 trust 5 → (5−5)/2 = 0、+1 = 1；再 −8
    expect(meter(g, 'credibility')).toBe(50 + 1 - 8)
    expect(meter(g, 'hostility', 'f_a')).toBe(5)
  })

  it('forge_risk 讓假料的風險少；真料不受影響', () => {
    const g = make({ pc: { ext: { fr: -3 } } })
    const a = addFootage(g, { type: 'battle', quality: 3, authentic: 'forged' })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(clipOf(g, id).risk).toBe(8)
    expect(uploadPreview(g.k, g.state, { ref: id }).risk).toBe(5)
    const real = clipOfAngle(g, 'documentary')
    patchClip(g, real, { risk: 4 })
    expect(uploadPreview(g.k, g.state, { ref: real }).risk).toBe(4)
  })

  it('煽情、畫面裡有你而且是親密類：豔名 +1 記在現在這一區；不是親密類或沒有你就沒有', () => {
    const g = make()
    const self = clipOfAngle(g, 'sensational', 'intimate', { self: true })
    const p = uploadPreview(g.k, g.state, { ref: self })
    expect(effectOf(p.effects as Rec[], 'fame')).toMatchObject({ amount: 1, key: 'd_a' })
    g.commit(upload(g.k, g.state, { ref: self }))
    expect(meter(g, 'fame', 'd_a')).toBe(1)
    const noSelf = clipOfAngle(g, 'sensational', 'intimate')
    expect(effectOf(uploadPreview(g.k, g.state, { ref: noSelf }).effects as Rec[], 'fame')).toBeUndefined()
    const battle = clipOfAngle(g, 'sensational', 'battle', { self: true })
    expect(effectOf(uploadPreview(g.k, g.state, { ref: battle }).effects as Rec[], 'fame')).toBeUndefined()
  })

  it('沒有註冊 subs 的一局照樣上架得了，只是沒有那一筆（略過的種類列在 skipped）', () => {
    const g = make({ toy: { without: ['subs', 'popularity'] } })
    expect(g.k.effects.has('subs')).toBe(false)
    const id = clipOfAngle(g, 'hero')
    const p = uploadPreview(g.k, g.state, { ref: id })
    expect(p.ok).toBe(true)
    expect(kindsOf(p.effects)).toEqual([])
    expect(p.skipped.sort()).toEqual(['popularity', 'subs'])
    g.commit(upload(g.k, g.state, { ref: id }))
    expect(clipOf(g, id).uses).toBe(1)
  })

  it('一個量表都沒有（只裝 media）：上架一樣成立，只扣次數', () => {
    const g = make({ toy: { without: METERS.map(([k]) => k) } })
    const id = clipOfAngle(g, 'expose', 'crime')
    const p = uploadPreview(g.k, g.state, { ref: id })
    expect(p.effects).toEqual([])
    expect(() => g.commit(upload(g.k, g.state, { ref: id }))).not.toThrow()
    expect(clipOf(g, id).uses).toBe(1)
  })

  it('用完的、不存在的上架不了，原因是完整的一句', () => {
    const g = make()
    const id = clipOfAngle(g, 'documentary')
    give(g, [{ op: 'media.use', ref: id, take: 'all' }])
    expect(uploadPreview(g.k, g.state, { ref: id })).toMatchObject({ ok: false, block: `「${clipOf(g, id).title}」已經用完了，只能留著當紀念。` })
    expect(reasonOf(() => upload(g.k, g.state, { ref: 'cl999' }))).toBe('素材庫裡沒有這件料。')
  })

  it('風險擲中的敵對值照 hostility 的規矩：涉及兩個勢力各 +5', () => {
    const g = make()
    const a = addFootage(g, { involves: { factions: ['f_a', 'f_b'], people: [] } })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    patchClip(g, id, { risk: dieOf(g, id) })
    g.commit(upload(g.k, g.state, { ref: id }))
    expect([meter(g, 'hostility', 'f_a'), meter(g, 'hostility', 'f_b')]).toEqual([5, 5])
  })
})

// ===================================================================================================================
describe('賣斷（V10）', () => {
  it('價錢 = 80 × 品質² ×（獨家 1.5）× 剩下的次數 ÷ 3；進帳戶；次數扣光；其他都沒有', () => {
    const g = make()
    const a = addFootage(g, { quality: 3, exclusive: true, uses: 3 })
    expect(sellPrice(g.k, g.state, a)).toBe(1080)
    const b = addFootage(g, { quality: 2, exclusive: false, uses: 3 })
    give(g, [{ op: 'media.use', ref: b, take: 1 }])
    expect(sellPrice(g.k, g.state, b)).toBe(213) // 80 × 4 × 2 / 3 = 213.33
    const before = g.state.money.cred
    const [rep] = g.commit(sell(g.k, g.state, a))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.sell', outcome: { result: 'sold' } })
    expect(g.state.money.cred).toBe(before + 1080)
    expect(footageOf(g, a).uses).toBe(0)
    expect(sellPrice(g.k, g.state, a)).toBeNull()
    expect(reasonOf(() => sell(g.k, g.state, a))).toContain('已經用完了')
    expect(meter(g, 'hostility', 'f_a')).toBe(0)
    noRep(g)
  })

  it('片也能賣：用片的品質與次數；來源不動', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(sellPrice(g.k, g.state, id)).toBe(Math.round(80 * 9 * 1.5 * (2 / 3)))
    g.commit(sell(g.k, g.state, id))
    expect(clipOf(g, id).uses).toBe(0)
    expect(footageOf(g, a).uses).toBe(2)
  })

  it('規則表可以改價錢；不存在回原因', () => {
    const g = make({ rules: { sell: { price: 100, exclusive: 2 } } })
    const a = addFootage(g, { quality: 2, uses: 3 })
    expect(sellPrice(g.k, g.state, a)).toBe(800)
    expect(sellPrice(g.k, g.state, 'ft999')).toBeNull()
    expect(reasonOf(() => sell(g.k, g.state, 'ft999'))).toBe('素材庫裡沒有這件料。')
  })
})

// ===================================================================================================================
describe('拿去談判（V10）', () => {
  const dealGame = (offset: number, want: 'good' | 'bad', o: MakeOpts = {}): G => gameWhere(
    (seed) => make({ seed, ...o }),
    (g) => { g.state.rules.dcOffset = offset; const n = naturalOf(g, `${MEDIA_DEAL_ACTION}/ft1`); return want === 'good' ? n !== 1 : n !== 20 },
  )

  it('對象是涉及的勢力與人；DC = 13 ＋ 等級 × 2；勢力的等級照資料，人當 2 級', () => {
    const g = make()
    const a = addFootage(g, { involves: { factions: ['f_a', 'f_b'], people: ['npc_boss'] } })
    const t = dealTargets(g.k, g.state, a)
    expect(t.map((x) => [x.id, x.kind, x.name, x.grade, x.dc])).toEqual([['f_a', 'faction', '星旗', 3, 19], ['f_b', 'faction', '蜂巢會', 4, 21], ['npc_boss', 'person', '大老闆', 2, 17]])
    expect(t.every((x) => x.chance >= 0 && x.chance <= 1)).toBe(true)
    expect(dealTargets(g.k, g.state, 'ft999')).toEqual([])
  })

  it('成功：拿賣斷價的 2 倍現金；次數扣光；勢力的敵對值下限 +5；擲的是交涉或威嚇', () => {
    const g = dealGame(-100, 'good')
    const a = addFootage(g, { quality: 3, exclusive: true })
    expect(a).toBe('ft1')
    const cash = g.state.money.cash
    const [rep] = g.commit(deal(g.k, g.state, { ref: a, target: 'f_a', skill: 'negotiate' }))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.deal', outcome: { result: 'dealt' } })
    expect(rep!.timeline[0]!.roll).toMatchObject({ skill: 'negotiate', attr: 'charm', dc: 19 - 100 })
    expect(g.state.money.cash).toBe(cash + 2160)
    expect(footageOf(g, a).uses).toBe(0)
    expect(meter(g, 'hostility_floor', 'f_a')).toBe(5)
    expect(meter(g, 'hostility', 'f_a')).toBe(0)
    noRep(g)
  })

  it('失敗：那個勢力敵對值 +5，下限也 +5；錢拿不到；次數照樣扣光', () => {
    const g = dealGame(100, 'bad')
    const a = addFootage(g, { quality: 3 })
    const cash = g.state.money.cash
    const [rep] = g.commit(deal(g.k, g.state, { ref: a, target: 'f_a', skill: 'intimidate' }))
    expect(rep).toMatchObject({ outcome: { result: 'refused' } })
    expect(rep!.timeline[0]!.roll).toMatchObject({ skill: 'intimidate', attr: 'resolve' })
    expect(g.state.money.cash).toBe(cash)
    expect(footageOf(g, a).uses).toBe(0)
    expect(meter(g, 'hostility', 'f_a')).toBe(5)
    expect(meter(g, 'hostility_floor', 'f_a')).toBe(5)
  })

  it('成功拿人情：中人情，記在欠你的那一邊（favors 有裝才有）', () => {
    const g = gameWhere((seed) => make({ seed, features: [favorsFeature] }), (x) => { x.state.rules.dcOffset = -100; return naturalOf(x, `${MEDIA_DEAL_ACTION}/ft1`) !== 1 })
    const a = addFootage(g, { involves: { factions: ['f_a'], people: ['npc_boss'] } })
    const cash = g.state.money.cash
    g.commit(deal(g.k, g.state, { ref: a, target: 'npc_boss', take: 'favor' }))
    expect(favorsOf(g.state).owed_to_pc).toEqual([expect.objectContaining({ who: 'npc_boss', size: 'mid' })])
    // 對象是人：沒有敵對值，也沒有下限
    expect(meter(g, 'hostility_floor', 'f_a')).toBe(0)
    expect(g.state.money.cash).toBe(cash)
  })

  it('沒有人情可記的局：選人情被擋，只能拿現金', () => {
    const g = make()
    const a = addFootage(g)
    expect(reasonOf(() => deal(g.k, g.state, { ref: a, target: 'f_a', take: 'favor' }))).toBe('現在沒有地方記人情，只能拿現金。')
  })

  it('被擋：對象不在這件料裡、用完了、技能不對', () => {
    const g = make()
    const a = addFootage(g, { involves: { factions: ['f_a'], people: [] } })
    expect(reasonOf(() => deal(g.k, g.state, { ref: a, target: 'f_b' }))).toBe('這件料裡沒有拍到這個人或勢力，沒有東西可以拿去跟他談。')
    expect(reasonOf(() => deal(g.k, g.state, { ref: a, target: 'f_a', skill: 'stealth' as never }))).toBe('談判只能擲交涉或威嚇。')
    give(g, [{ op: 'media.use', ref: a, take: 'all' }])
    expect(reasonOf(() => deal(g.k, g.state, { ref: a, target: 'f_a' }))).toContain('已經用完了')
  })

  it('一個量表都沒有的局：談判照樣成立（敵對值與下限略過）', () => {
    const g = gameWhere((seed) => make({ seed, toy: { without: METERS.map(([k]) => k) } }), (x) => { x.state.rules.dcOffset = 100; return naturalOf(x, `${MEDIA_DEAL_ACTION}/ft1`) !== 20 })
    const a = addFootage(g)
    expect(() => g.commit(deal(g.k, g.state, { ref: a, target: 'f_a' }))).not.toThrow()
    expect(footageOf(g, a).uses).toBe(0)
  })
})

// ===================================================================================================================
describe('留著當保命符（V11）：回答 defeat.options', () => {
  const pendingOf = (faction: string | undefined): Rec => ({ event: 'd1', version: 'default', ...(faction ? { faction } : {}), outcome: 'lose', fails_commission: true, lines: [], choices: ['accept', 'retry', 'stage'], view: 'always', skipped: true, battle: 'b1' })
  const optionsOf = (g: G, faction: string | undefined): Rec[] => g.k.hooks.run('defeat.options', { state: g.state, pending: pendingOf(faction) as never }).flatMap((r) => r.result as Rec[])

  it('持有涉及贏的那一方、罪證類、品質 4 以上、還有次數的料：多一條；選了之後那一件是 0 次、敵對值下限 +5', () => {
    const g = make()
    const a = addFootage(g, { type: 'crime', quality: 4, title: '黑帳' })
    const opts = optionsOf(g, 'f_a')
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({ id: 'media_keep', name: '帶子會自己發出去', blocks: [] })
    expect(opts[0]!.desc).toContain('黑帳')
    give(g, opts[0]!.changes)
    expect(footageOf(g, a).uses).toBe(0)
    expect(meter(g, 'hostility_floor', 'f_a')).toBe(5)
    expect(optionsOf(g, 'f_a')).toEqual([])
  })

  it('品質 3 的不算；不是罪證類的不算；涉及別的勢力的不算；用完的不算；沒有贏的勢力不問', () => {
    const g = make()
    addFootage(g, { type: 'crime', quality: 3 })
    addFootage(g, { type: 'scandal', quality: 5 })
    addFootage(g, { type: 'crime', quality: 5, involves: { factions: ['f_b'], people: [] } })
    const used = addFootage(g, { type: 'crime', quality: 5 })
    give(g, [{ op: 'media.use', ref: used, take: 'all' }])
    expect(optionsOf(g, 'f_a')).toEqual([])
    expect(optionsOf(g, undefined)).toEqual([])
    expect(optionsOf(g, 'f_b')).toHaveLength(1)
  })

  it('剪成罪證類的片也算（取品質高的、次數多的）；留著不扣次數（只有選了才扣）', () => {
    const g = make()
    const a = addFootage(g, { type: 'crime', quality: 4 })
    const b = addFootage(g, { type: 'crime', quality: 5, title: '更重的' })
    const { id } = cutClip(g, { parts: [a], angle: 'expose' })
    const opts = optionsOf(g, 'f_a')
    expect(opts[0]!.changes[0]).toEqual({ op: 'media.use', ref: b, take: 'all' })
    expect(footageOf(g, b).uses).toBe(3)
    // 把 b 用掉：換成剪出來的片（品質 4）
    give(g, [{ op: 'media.use', ref: b, take: 'all' }])
    expect(optionsOf(g, 'f_a')[0]!.changes[0]).toEqual({ op: 'media.use', ref: id, take: 'all' })
  })

  it('規則表可以改門檻', () => {
    const g = make({ rules: { keep: { quality_min: 3, floor: 8 } } })
    addFootage(g, { type: 'crime', quality: 3 })
    const opts = optionsOf(g, 'f_a')
    expect(opts).toHaveLength(1)
    give(g, opts[0]!.changes)
    expect(meter(g, 'hostility_floor', 'f_a')).toBe(8)
  })

  it('沒有敵對值下限的量表（沒裝 security）：選項照樣出現，只是沒有那一筆', () => {
    const g = make({ toy: { without: ['hostility_floor'] } })
    addFootage(g, { type: 'crime', quality: 4 })
    const opts = optionsOf(g, 'f_a')
    expect(opts[0]!.changes).toHaveLength(1)
  })
})

// ===================================================================================================================
describe('片的標題與簡介（MEDIA 第 3 節；使用者 2026-11-25）', () => {
  it('空著用程式的模板：角度的名字加第一段來源的標題；簡介是來源的說明；沒有 titled', () => {
    const g = make()
    const a = addFootage(g, { title: '倉庫的槍戰', text: '倉庫的槍戰。拍到了要害的一擊。' })
    const { id, report } = cutClip(g, { parts: [a], angle: 'hero' })
    expect(clipOf(g, id)).toMatchObject({ title: '英雄：倉庫的槍戰', intro: '倉庫的槍戰。拍到了要害的一擊。' })
    expect(clipOf(g, id).titled).toBeUndefined()
    expect(report.input).toBeUndefined()
    expect(materialOf(g.k, g.state, id)).toMatchObject({ title: '英雄：倉庫的槍戰', intro: '倉庫的槍戰。拍到了要害的一擊。' })
  })

  it('玩家寫的原樣存（不篩選、不 trim）；titled；上架那一份報告的 input 是標題與簡介', () => {
    const g = make()
    const a = addFootage(g)
    const title = '  我的第一支片 <b>！  '
    const intro = '  \n一句話   '
    const { id, report } = cutClip(g, { parts: [a], angle: 'documentary', title, intro })
    expect(clipOf(g, id)).toMatchObject({ title, intro, titled: true })
    expect(report.input).toBe(`${title}\n${intro}`)
    expect(report.narration!.results!.join()).not.toContain('最多')
    patchClip(g, id, { risk: 0 })
    const [rep] = g.commit(upload(g.k, g.state, { ref: id }))
    expect(rep!.input).toBe(`${title}\n${intro}`)
  })

  it('31 個字的標題只留 30 個，報告有那一句提醒；簡介 101 字同理；剛好 30、100 不提醒', () => {
    const g = make()
    const a = addFootage(g)
    const long = 'あ'.repeat(31)
    const { id, report } = cutClip(g, { parts: [a], angle: 'documentary', title: long, intro: '字'.repeat(101) })
    expect(Array.from(clipOf(g, id).title)).toHaveLength(CLIP_TITLE_MAX)
    expect(clipOf(g, id).title).toBe('あ'.repeat(30))
    expect(Array.from(clipOf(g, id).intro)).toHaveLength(CLIP_INTRO_MAX)
    expect(report.narration!.results).toContain('標題最多 30 字，超過的部分沒有留下。')
    expect(report.narration!.results).toContain('簡介最多 100 字，超過的部分沒有留下。')
    expect(report.clamps!.map((c) => c.path)).toEqual(['clip.title', 'clip.intro'])
    expect(report.clamps![0]).toMatchObject({ from: long, to: 'あ'.repeat(30), limit: 30 })
    const b = addFootage(g)
    const ok = cutClip(g, { parts: [b], angle: 'documentary', title: 'あ'.repeat(30), intro: '字'.repeat(100) })
    expect(ok.report.narration!.results).toHaveLength(1)
    expect(ok.report.clamps).toBeUndefined()
  })

  it('照「字」算：一個表情符號（兩個 UTF-16 單位）算一個字；不會截在半個字上', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary', title: '😀'.repeat(31) })
    expect(clipOf(g, id).title).toBe('😀'.repeat(30))
    const b = addFootage(g)
    expect(clipOf(g, cutClip(g, { parts: [b], angle: 'documentary', title: '😀'.repeat(30) }).id).title).toBe('😀'.repeat(30))
  })

  it('模板太長也照字截（沒有提醒：不是玩家寫的）', () => {
    const g = make()
    const a = addFootage(g, { title: '很'.repeat(60), text: '長'.repeat(300) })
    const { id, report } = cutClip(g, { parts: [a], angle: 'documentary' })
    expect(Array.from(clipOf(g, id).title)).toHaveLength(30)
    expect(Array.from(clipOf(g, id).intro)).toHaveLength(100)
    expect(report.narration!.results).toHaveLength(1)
  })

  it('同一個種子有沒有寫標題，三個數字、片的次數、上架的每一筆效果都一樣', () => {
    const run = (o: Partial<CutInput>) => {
      const g = make({ seed: 11 })
      setMeter(g, 'subs', '_', 1000)
      const a = addFootage(g, { type: 'crime', quality: 4, celebrity: true })
      const { id } = cutClip(g, { parts: [a], angle: 'expose', ...o })
      const c = clipOf(g, id)
      const p = uploadPreview(g.k, g.state, { ref: id })
      const [rep] = g.commit(upload(g.k, g.state, { ref: id }))
      return { nums: [c.draw, c.trust, c.risk, c.uses, c.quality, c.card], effects: p.effects, risk: p.risk, changes: rep!.changes, result: rep!.outcome.result, hit: rep!.timeline[0]!.data!.hit }
    }
    expect(run({ title: '玩家取的名字', intro: '玩家寫的簡介' })).toEqual(run({}))
  })

  it('retitle：Material.title 跟著變；給空字串改回模板；沒給的欄位不動；報告是 media.retitle（system、不花時間）', () => {
    const g = make()
    const a = addFootage(g, { title: '來源', text: '來源的說明。' })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const t0 = toMinutes(g.state.time)
    const [rep] = g.commit(retitle(g.k, g.state, id, { title: '新名字' }))
    expect(rep).toMatchObject({ kind: 'system', action: 'media.retitle' })
    expect(toMinutes(g.state.time)).toBe(t0)
    expect(materialOf(g.k, g.state, id)).toMatchObject({ title: '新名字', intro: '來源的說明。' })
    expect(materialsOf(g.k, g.state).find((m) => m.ref === id)!.title).toBe('新名字')
    expect(clipOf(g, id)).toMatchObject({ titled: true, own_title: true })
    g.commit(retitle(g.k, g.state, id, { intro: '新的簡介' }))
    expect(clipOf(g, id)).toMatchObject({ title: '新名字', intro: '新的簡介', own_title: true, own_intro: true })
    g.commit(retitle(g.k, g.state, id, { title: '' }))
    expect(clipOf(g, id)).toMatchObject({ title: '紀實：來源', intro: '新的簡介', titled: true })
    expect(clipOf(g, id).own_title).toBeUndefined()
    g.commit(retitle(g.k, g.state, id, { intro: '' }))
    expect(clipOf(g, id)).toMatchObject({ intro: '來源的說明。' })
    expect(clipOf(g, id).titled).toBeUndefined()
  })

  it('retitle 超過上限照字截並提醒；沒給欄位、片不存在、戰鬥中都被擋', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const draft = retitle(g.k, g.state, id, { title: 'x'.repeat(31), intro: 'y'.repeat(101) })
    g.commit(draft)
    expect(clipOf(g, id).title).toBe('x'.repeat(30))
    expect(clipOf(g, id).intro).toBe('y'.repeat(100))
    expect(draft.narration!.results).toEqual(expect.arrayContaining(['標題最多 30 字，超過的部分沒有留下。', '簡介最多 100 字，超過的部分沒有留下。']))
    expect(reasonOf(() => retitle(g.k, g.state, id, {}))).toBe('要寫標題或簡介其中一項。')
    expect(reasonOf(() => retitle(g.k, g.state, 'cl999', { title: 'x' }))).toBe('素材庫裡沒有這支片。')
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(reasonOf(() => retitle(g.k, g.state, id, { title: 'x' }))).toBe('正在戰鬥，先把這一場打完。')
  })

  it('重剪不動標題與簡介；retitle 不影響任何數字', () => {
    const g = make({ staff: ['producer'] })
    const a = addFootage(g, { type: 'battle' })
    const { id } = cutClip(g, { parts: [a], angle: 'documentary', title: '玩家的標題', intro: '玩家的簡介' })
    const nums = (c: ReturnType<typeof clipOf>) => [c.draw, c.trust, c.risk, c.uses, c.quality]
    const before = nums(clipOf(g, id))
    g.commit(retitle(g.k, g.state, id, { title: '改過的標題' }))
    expect(nums(clipOf(g, id))).toEqual(before)
    g.commit(recut(g.k, g.state, { ref: id, angle: 'hero' }))
    expect(clipOf(g, id)).toMatchObject({ title: '改過的標題', intro: '玩家的簡介', angle: 'hero' })
  })
})

// ===================================================================================================================
describe('檢視、規則表與角度的資料', () => {
  it('mediaView 列片：次數、用完、角度的名字、能不能重剪與原因', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'hero' })
    const row = mediaView(g.k, g.state).clips[0]!
    expect(row).toMatchObject({ ref: id, kind: 'clip', angle: 'hero', angle_name: '英雄', spent: false, from: [a], can_recut: false, recut_why: '要有製作才能重剪。', recut: false, titled: false, uses: 2 })
    const g2 = make({ staff: ['producer'] })
    const c2 = cutClip(g2, { parts: [addFootage(g2)], angle: 'hero' }).id
    expect(mediaView(g2.k, g2.state).clips[0]).toMatchObject({ ref: c2, can_recut: true, recut_why: null })
    give(g2, [{ op: 'media.use', ref: c2, take: 'all' }])
    expect(mediaView(g2.k, g2.state).clips[0]).toMatchObject({ spent: true, can_recut: false })
  })

  it('規則表 media_rule 蓋掉剪、偽造、上架、賣斷、談判、保命符的數字；格式不對的欄位忽略並被內容檢查擋下', () => {
    const g = make({ rules: { forge: { dc: 18 }, upload: { subs_min: 5 }, deal: { dc: 10 }, grade_default: 4, keep: { type: 'scandal' } } })
    const r = mediaRules(g.k)
    expect(r.forge).toMatchObject({ dc: 18, minutes: 240, q_ok: 2 })
    expect(r.upload).toMatchObject({ subs_min: 5, subs_pct: 0.5 })
    expect(r.deal).toMatchObject({ dc: 10, floor: 5 })
    expect(r.grade_default).toBe(4)
    expect(r.keep).toMatchObject({ type: 'scandal', quality_min: 4 })
    // 預設不被改到
    expect(DEFAULT_MEDIA_RULES.forge.dc).toBe(15)
    expect(ruleProblems({ forge: { dc: 99 }, upload: { anon_mult: 2 }, sell: 3, keep: { type: 'nope' }, grade_default: 9 })).toEqual(expect.arrayContaining([
      'forge.dc 要是 1～40 的數字', 'upload.anon_mult 要是 0～1 的數字', 'sell 要是物件', 'keep.type 要是 battle、scandal、crime、intimate、celebrity、daily 其中一個', 'grade_default 要是 1～5 的整數',
    ]))
    expect(ruleProblems({})).toEqual([])
    // 格式不對的規則表在內容載入時就被擋
    expect(() => make({ rules: { upload: { anon_mult: 5 } } })).toThrow('upload.anon_mult 要是 0～1 的數字')
  })

  it('footage_angle 資料：同 id 整筆蓋掉、新 id 加在後面、格式不對的忽略', () => {
    const angles = [
      { id: 'hero', name: '傳奇', group: 'positive', types: ['battle'], draw: 3, trust: 3, risk: 0, card: 'line', upload: [] },
      { id: 'gossip', name: '八卦', group: 'neutral', types: 'any', draw: 1, trust: -3, risk: 2, card: 'fuel', upload: [{ kind: 'subs', pct: 5 }] },
    ]
    const g = make({ content: [{ id: 'cut_angles', content: { footage_angle: angles } }] })
    const list = anglesOf(g.k)
    expect(list.map((a) => a.id)).toEqual([...DEFAULT_ANGLES.map((a) => a.id), 'gossip'])
    expect(list.find((a) => a.id === 'hero')).toMatchObject({ name: '傳奇', draw: 3, upload: [] })
    const a = addFootage(g, { type: 'battle', quality: 3 })
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'hero' }).detail).toMatchObject({ draw: 6, trust: 9, risk: 3, angle_name: '傳奇' })
    expect(cutPreview(g.k, g.state, { parts: [a], angle: 'gossip' }).detail).toMatchObject({ draw: 4, trust: 3, card: { kind: 'fuel', value: 4 } })
    // 格式
    expect(angleProblems({ name: '', group: 'x', types: [], draw: 99, trust: 0, risk: 0, card: 'zz', upload: [{ kind: 'subs' }] }).length).toBeGreaterThanOrEqual(5)
    expect(angleProblems({ name: 'a', group: 'neutral', types: 'any', draw: 0, trust: 0, risk: 0, card: null, upload: [{ kind: 'credibility', pct: 3 }] })).toEqual(['upload[0].pct 只有 subs 可以用'])
  })

  it('footage_angle 的上架範本：資料可以加新的效果（例：人氣 +2）', () => {
    const angles = [{ id: 'idol', name: '應援', group: 'positive', types: ['celebrity'], draw: 1, trust: 0, risk: 0, card: 'line', upload: [{ kind: 'popularity', amount: 2 }] }]
    const g = make({ content: [{ id: 'cut_angles', content: { footage_angle: angles } }] })
    const a = addFootage(g, { type: 'celebrity' })
    const { id } = cutClip(g, { parts: [a], angle: 'idol' })
    expect(effectOf(uploadPreview(g.k, g.state, { ref: id }).effects as Rec[], 'popularity')).toMatchObject({ amount: 2, key: 'pc' })
  })
})

// ===================================================================================================================
describe('街頭信譽與分層（V54）', () => {
  it('這個功能產生的所有報告（剪、重剪、偽造、上架、賣斷、談判、retitle）沒有任何 rep 的變更或效果', () => {
    const g = make({ staff: ['producer'], pc: { ext: { cp: 1 } } })
    const a = addFootage(g, { type: 'crime', quality: 4 })
    const b = addFootage(g, { type: 'crime', quality: 4 })
    const c = addFootage(g, { type: 'crime', quality: 4 })
    const { id } = cutClip(g, { parts: [a], angle: 'expose', pick: 'trust', title: '標題' })
    patchClip(g, id, { risk: dieOf(g, id) })
    g.commit(upload(g.k, g.state, { ref: id }))
    g.commit(retitle(g.k, g.state, id, { title: '改' }))
    g.commit(recut(g.k, g.state, { ref: id, angle: 'documentary' }))
    g.commit(forge(g.k, g.state, { type: 'crime', faction: 'f_a' }))
    g.commit(sell(g.k, g.state, b))
    g.state.rules.dcOffset = -100
    g.commit(deal(g.k, g.state, { ref: c, target: 'f_a' }))
    const actions = g.state.reports.map((r) => r.action)
    for (const x of ['media.cut', 'media.upload', 'media.retitle', 'media.recut', 'media.forge', 'media.sell', 'media.deal']) expect(actions).toContain(x)
    noRep(g)
    // 報告裡的變更只有這幾種
    const ops = new Set(g.state.reports.filter((r) => r.action?.startsWith('media.')).flatMap((r) => r.changes.map((x) => x.op)))
    expect([...ops].every((op) => ['time', 'rng', 'cred', 'cash', 'meter', 'media.use', 'media.clip', 'media.make', 'media.recut', 'media.retitle'].includes(op))).toBe(true)
  })

  it('原始碼只 import 核心；不讀別的功能的 state.ext；不直接寫 rep', () => {
    const dir = join(fileURLToPath(new URL('../../src/features/media/', import.meta.url)))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/from '(\.\.?\/[^']+)'/g)) expect(m[1]!.startsWith('../../core') || m[1]!.startsWith('./'), `${f}: ${m[1]}`).toBe(true)
      expect(src, f).not.toMatch(/state\.ext\.(?!media\b)[a-z_]+/)
      expect(src, f).not.toMatch(/kind: 'rep'/)
    }
  })

  it('這個功能沒有新的 ai: false 效果：效果清單與上一張一樣只有 footage', () => {
    const g = make()
    expect(g.k.effects.kinds().filter((k) => k.startsWith('media') || k === 'footage')).toEqual(['footage'])
  })
})

// ===================================================================================================================
describe('留著當保命符：接上真的戰敗功能（features/defeat）', () => {
  it('等著三選一的戰敗：多一個選項；選了不進戰敗事件，那一件用完、敵對值下限 +5，等待中的戰敗清掉', () => {
    const g = make({ features: [defeatFeature] })
    const a = addFootage(g, { type: 'crime', quality: 5, title: '黑帳' })
    const pending: Rec = { event: 'df_x', version: 'default', faction: 'f_a', outcome: 'lose', fails_commission: true, lines: [], choices: ['accept', 'retry', 'stage'], view: 'never', skipped: true, battle: 'b1', stage: 'played' }
    give(g, [{ op: 'ext', key: 'defeat', value: pending }])
    expect(defeatOptions(g.k, g.state).map((o) => o.id)).toEqual(['media_keep'])
    const [rep] = g.commit(chooseDefeatOption(g.k, g.state, 'media_keep'))
    expect(rep).toMatchObject({ action: 'defeat.option', outcome: { result: 'media_keep' } })
    expect(footageOf(g, a).uses).toBe(0)
    expect(meter(g, 'hostility_floor', 'f_a')).toBe(5)
    expect(defeatOf(g.state)).toBeNull()
    expect(defeatOptions(g.k, g.state)).toEqual([])
  })

  it('品質 3 的罪證：沒有這個選項，選了丟錯', () => {
    const g = make({ features: [defeatFeature] })
    addFootage(g, { type: 'crime', quality: 3 })
    const pending: Rec = { event: 'df_x', version: 'default', faction: 'f_a', outcome: 'lose', fails_commission: true, lines: [], choices: ['accept', 'retry', 'stage'], view: 'never', skipped: true, battle: 'b1', stage: 'played' }
    give(g, [{ op: 'ext', key: 'defeat', value: pending }])
    expect(defeatOptions(g.k, g.state)).toEqual([])
    expect(() => chooseDefeatOption(g.k, g.state, 'media_keep')).toThrow(/沒有「media_keep」/)
  })
})

// ===================================================================================================================
describe('回到快照與壞存檔', () => {
  it('回到快照（rewind.keep）：片、素材的次數與流水號用回去之前的', () => {
    const g = make()
    const restored = structuredClone(g.state)
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const changes = onRewind(g.state, restored)!
    const kept = (changes[0] as unknown as { value: Rec }).value
    expect(Object.keys(kept.clips)).toEqual([id])
    expect(kept.footage[a].uses).toBe(2)
    expect(kept.seq).toBe(media(g).seq)
  })

  it('存檔裡壞掉的片略過，不擋遊戲；好的照讀', () => {
    const g = make()
    const a = addFootage(g)
    const { id } = cutClip(g, { parts: [a], angle: 'documentary' })
    const raw = JSON.parse(JSON.stringify(media(g)))
    raw.clips.cl_bad = { from: 'nope' }
    raw.clips.cl_bad2 = null
    raw.clips[id].draw = 'x'
    raw.clips[id].card = { kind: 'zzz', value: 1 }
    const fake = readMedia({ ext: { media: raw } } as never)
    expect(Object.keys(fake.clips)).toEqual([id])
    expect(fake.clips[id]).toMatchObject({ draw: 0, card: null, angle: 'documentary' })
  })
})
