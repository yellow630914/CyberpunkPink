// 驗收測試：dev/work/M2-roster.md（cpp-feature）。規格：FIXER 第 6 節；NPC_SYSTEM 第 10 節（10.0 隊伍、10.2 招募、10.4 忠誠、10.5 薪水與分紅、10.7 候選人）；
// COMMISSIONS 6.1 節；dev/adr/0016 第三、五節與 G4。
// 內容一律用測試自帶的最小假資料：幾位行者（安、鮑、柯、迪……，角色身上帶 ext.paths）、一位街坊、行動種類 npc_recruit（owner: roster）。
// 親密度與街頭信譽是別的功能的量表：測試用 testkit 的 meterFeature 替身定義；名冊的人用 makeActor 直接放進 state.actors。

import { describe, expect, it } from 'vitest'
import type { Actor, BattleSetup, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, BattleRun, ContentError, clone, createKernel, effectCtx, meterOf, prepareAction, restDone, setupBattle, toMinutes } from '../../src'
import {
  DEFAULT_ROSTER_RULES, availability, candidatesOf, feeOf, join, joinBlock, leave, memberOf, muster, musterBlocks, payOf, readRoster, recruitBlock, recruitDc, recruitInput, rosterCap, rosterFeature, rosterRules,
  rosterView, setPay, weeklyDrafts, weeklyPay,
} from '../../src/features/roster'
import type { MusterInput } from '../../src/features/roster'
import { npcsFeature } from '../../src/features/npcs'
import { BATTLE_SETUPS, TEST_COMBAT, enemyUnit, makeActor, makeGame, makeState, meterFeature, observed, partyUnit, playOut, testMeter } from '../../src/testkit'

// ---- 替身與假資料 ----

/** 別的功能的內容種類：路數（abilities 的；測試用它查「人面」這棵樹）。 */
const STUBS: Feature = {
  id: 'test_stubs',
  install(k: Kernel) {
    k.content.defineKind({ kind: 'path', owner: 'test', validate: () => [] })
  },
}
/** 親密度（npcs 的）與街頭信譽（fixer 的）：只借量表。 */
const METERS = meterFeature(
  testMeter({ kind: 'rep', name: '街頭信譽', keyed: 'none' }),
  testMeter({ kind: 'affinity', name: '親密度', min: -100, max: 100, keyed: 'npc' }),
)

type Rec = Record<string, unknown>
const ATTRS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].map((id) => ({ id, name: id, desc: `${id}。` }))
const SKILLS = [{ id: 'negotiate', name: '交涉', attr: 'charm', desc: '談條件。' }]
const RECRUIT = { id: 'npc_recruit', name: '招募', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 30, max_minutes: 60, owner: 'roster' }

const baseContent = (): Record<string, Rec[]> => structuredClone({
  attribute: ATTRS, skill: SKILLS, action_kind: [RECRUIT],
  path: [{ id: 'p_face', name: '人面的路', tree: '人面' }, { id: 'p_gun', name: '槍手', tree: '戰鬥直覺' }],
}) as Record<string, Rec[]>

const paths = (...rows: Array<[string, string, number]>) => ({ paths: rows.map(([path, slot, tier]) => ({ path, slot, tier })) })
/** 一位行者：主職是槍手，幾階照給。 */
const runner = (id: string, name: string, tier = 2, o: Partial<Actor> = {}): Actor => makeActor({ id, name, role: 'npc', ext: paths(['p_gun', 'main', tier]), ...o })
const CITIZEN = makeActor({ id: 'c_bob', name: '街坊鮑勃', role: 'npc' })
const ANN = () => runner('r_ann', '安', 3)
const BOB = () => runner('r_bob', '鮑', 2)
const CORA = () => runner('r_cora', '柯拉', 1)
const DEE = () => runner('r_dee', '迪', 2)
const EVE = () => runner('r_eve', '伊芙', 1)
const FAY = () => runner('r_fay', '菲', 4)
const ALL = (): Actor[] => [ANN(), BOB(), CORA(), DEE(), EVE(), FAY(), clone(CITIZEN)]

interface Opts {
  pc?: Parameters<typeof makeGame>[0] extends infer S ? (S extends { pc?: infer P } ? P : never) : never
  actors?: Actor[]
  features?: Feature[]
  content?: (c: Record<string, Rec[]>) => void
  seed?: number
  patch?: Partial<GameState>
}
const make = (o: Opts = {}) => {
  const c = baseContent()
  o.content?.(c)
  const pack: ContentPack = { id: 'roster_test', content: c as unknown as ContentPack['content'] }
  const { game } = makeGame({
    features: o.features ?? [STUBS, METERS, rosterFeature], content: [pack], seed: o.seed ?? 7,
    pc: { attrs: { charm: 14 }, ...((o.pc ?? {}) as object) }, actors: o.actors ?? ALL(),
    patch: { time: { day: 3, hour: 10, minute: 0 }, ...(o.patch ?? {}) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const put = (g: G, changes: ReportDraft['changes']) => g.commit(draft(changes))
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const DAY = 1440
const loyalty = (g: G, id: string) => meterOf(g.k, g.state, 'loyalty', id)
const setMeter = (g: G, kind: string, key: string | undefined, set: number) => put(g, [{ op: 'meter', kind, key: key ?? '_', set }])
const members = (g: G) => Object.keys(readRoster(g.state).members)
const add = (g: G, ...ids: string[]) => ids.forEach((id) => g.commit(join(g.k, g.state, id)))
const addFixed = (g: G, id: string) => g.commit(join(g.k, g.state, id, { fixed: true }))
const condition = (g: G, id: string, condition: string, until?: number) => put(g, [{ op: 'actor.condition', id, condition, ...(until !== undefined ? { until } : {}) }])
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

// ---- 容量 ----

describe('名冊容量：3 ＋ mod(魅力) ＋ 人面階數 × 2', () => {
  it('魅力 14、沒有人面是 5；魅力 10 是 3；衍生數值 roster_cap 一樣', () => {
    const g = make()
    expect(rosterCap(g.k, g.state)).toBe(5)
    expect(g.k.stats.stat(g.state, 'pc', 'roster_cap')).toBe(5)
    const low = make({ pc: { attrs: { charm: 10 } } })
    expect(rosterCap(low.k, low.state)).toBe(3)
    const high = make({ pc: { attrs: { charm: 20 } } })
    expect(rosterCap(high.k, high.state)).toBe(8)
  })

  it('人面階數：主角的 ext.paths 裡 fixer 的階數、或路數資料的 tree 是「人面」的那一棵；階數 × 2', () => {
    const byId = make({ pc: { ext: paths(['fixer', 'main', 2]) } })
    expect(rosterCap(byId.k, byId.state)).toBe(3 + 2 + 4)
    const byTree = make({ pc: { ext: paths(['p_face', 'sub', 1], ['p_gun', 'main', 5]) } })
    expect(rosterCap(byTree.k, byTree.state)).toBe(3 + 2 + 2)
    // 戰鬥那一棵不算；讀不到路數當 0
    const gun = make({ pc: { ext: paths(['p_gun', 'main', 5]) } })
    expect(rosterCap(gun.k, gun.state)).toBe(5)
    // 技能的衍生數值 face_tier 有人註冊也算（取大的）
    const stat: Feature = { id: 'test_face', install: (k) => k.stats.defineStat({ id: 'face_tier', owner: 'test', name: '人面階數', base: () => 3 }) }
    const viaStat = make({ features: [STUBS, METERS, stat, rosterFeature] })
    expect(rosterCap(viaStat.k, viaStat.state)).toBe(3 + 2 + 6)
  })

  it('沒有主角、查不到的角色：容量是 0', () => {
    const g = make()
    expect(rosterCap(g.k, g.state, 'nobody')).toBe(0)
    expect(rosterCap(g.k, g.state, null)).toBe(0)
  })

  it('滿了之後進名冊與招募都被擋下並有原因（寫出幾個人、容量多少）；騰出位子之後又可以', () => {
    const g = make()
    add(g, 'r_ann', 'r_bob', 'r_cora', 'r_dee', 'r_eve')
    expect(members(g)).toHaveLength(5)
    expect(joinBlock(g.k, g.state, 'r_fay')).toBe('名冊滿了（5／5）：要先騰出位子，菲才進得來。')
    expect(reasonOf(() => join(g.k, g.state, 'r_fay'))).toContain('名冊滿了')
    expect(recruitBlock(g.k, g.state, 'r_fay')).toBe('名冊滿了（5／5）：要先騰出位子才能再招募。')
    g.commit(leave(g.state, 'r_eve'))
    expect(joinBlock(g.k, g.state, 'r_fay')).toBeNull()
    expect(recruitBlock(g.k, g.state, 'r_fay')).toBeNull()
  })
})

// ---- 招募 ----

describe('招募的 DC：16 − ⌊親密度 ÷ 10⌋ ＋ 2 × max(0, 他的主職階數 − 你的信譽階序)', () => {
  it('親密度 30、他 3 階、你是熟面孔 → 16 − 3 + 4 = 17，每一條來源列在明細裡', () => {
    const g = make()
    setMeter(g, 'affinity', 'r_ann', 30)
    setMeter(g, 'rep', undefined, 15)
    const d = recruitDc(g.k, g.state, 'r_ann')
    expect(d.dc).toBe(17)
    expect(d.mods).toEqual([
      { label: '招募的底', value: 16 },
      { label: '親密度 30', value: -3 },
      { label: '他的主職 3 階，你的信譽階序是 1', value: 4 },
    ])
  })

  it('信譽階序夠高就沒有那一條（不會變負）；親密度是負的 DC 反而高；沒有人定義親密度與信譽（沒裝那個功能）當 0', () => {
    const g = make()
    setMeter(g, 'rep', undefined, 55) // 搶手：階序 3
    expect(recruitDc(g.k, g.state, 'r_ann').dc).toBe(16)
    setMeter(g, 'rep', undefined, 90) // 傳說：階序 5，他才 3 階
    expect(recruitDc(g.k, g.state, 'r_ann').dc).toBe(16)
    setMeter(g, 'affinity', 'r_ann', -5)
    expect(recruitDc(g.k, g.state, 'r_ann').dc).toBe(17)
    const bare = make({ features: [STUBS, rosterFeature] })
    expect(recruitDc(bare.k, bare.state, 'r_ann').dc).toBe(16 + 2 * 3)
  })

  it('真的擲出來的 DC 就是它（行動 npc_recruit；存檔的難度偏移照加）', () => {
    const g = make()
    setMeter(g, 'affinity', 'r_ann', 30)
    setMeter(g, 'rep', undefined, 15)
    const input = recruitInput(g.k, g.state, 'r_ann')
    expect(prepareAction(g.k, g.state, input).roll.dc).toBe(17)
    g.state.rules.dcOffset = 2
    expect(prepareAction(g.k, g.state, input).roll.dc).toBe(19)
  })
})

describe('招募能不能做：只有行者；每一個原因一句', () => {
  it('街坊（沒有路數）不能招募；查不到的人、自己、已經在名冊上的人、「再想想」的人也都擋', () => {
    const g = make()
    expect(recruitBlock(g.k, g.state, 'c_bob')).toBe('街坊鮑勃不是行者，沒辦法招募（街坊與職員只能同行）。')
    expect(recruitBlock(g.k, g.state, 'nobody')).toBe('查不到 nobody 這個人：要先認識他。')
    expect(recruitBlock(g.k, g.state, 'pc')).toBe('你不用招募自己。')
    expect(recruitBlock(g.k, g.state, undefined)).toBe('要先指定對象。')
    expect(recruitBlock(g.k, g.state, 'r_ann')).toBeNull()
    add(g, 'r_ann')
    expect(recruitBlock(g.k, g.state, 'r_ann')).toBe('安已經在你的名冊上了。')
    put(g, [{ op: 'roster.think', who: 'r_bob' }])
    expect(recruitBlock(g.k, g.state, 'r_bob')).toBe('鮑說要再想想：睡一覺之後才能再問。')
  })

  it('Game.act 把不能招募的人擋在擲骰之前，原因就是上面那一句；輸入不必用 recruitInput 組（報告帶行動的輸入，不靠文字裡的標記）', async () => {
    const g = make()
    const r = await g.act({ kind: 'npc_recruit', target: 'c_bob', text: '招募街坊鮑勃' })
    expect(r.status).toBe('refused')
    expect(r.reason).toBe('街坊鮑勃不是行者，沒辦法招募（街坊與職員只能同行）。')
    const bare = await g.act({ kind: 'npc_recruit' })
    expect(bare.status).toBe('refused')
    expect(bare.reason).toBe('要先指定對象。')
    expect(members(g)).toEqual([])
    expect(recruitInput(g.k, g.state, 'r_ann')).toEqual({ kind: 'npc_recruit', target: 'r_ann', text: '招募安' })
  })

  it('資料裡沒有 npc_recruit：沒有這個行動，recruitInput 丟錯；不丟在載入時', () => {
    const g = make({ content: (c) => { c.action_kind = [] } })
    expect(g.k.actions.get('npc_recruit')).toBeUndefined()
    expect(() => recruitInput(g.k, g.state, 'r_ann')).toThrow('npc_recruit')
  })

  it('資料裡 npc_recruit 的條件不存在：載入時整批擋下並寫出是哪一筆', () => {
    expect(() => make({ content: (c) => { c.action_kind = [{ ...RECRUIT, requires: { kind: 'no_such_condition' }, blocked_text: '不行。' }] } })).toThrow(ContentError)
    expect(() => make({ content: (c) => { c.action_kind = [{ ...RECRUIT, requires: { kind: 'no_such_condition' }, blocked_text: '不行。' }] } })).toThrow('npc_recruit')
  })
})

// ---- 招募的結果：用換種子控制擲骰 ----

type Degree = 'critical' | 'success' | 'fail' | 'fumble'
/** 換種子：直到這一次招募預覽出來的結果合乎條件。 */
function rig(g: G, id: string, want: (d: Degree, margin: number) => boolean): void {
  const input = recruitInput(g.k, g.state, id)
  for (let seed = 1; seed < 4000; seed++) {
    g.state.rng.seed = seed
    const roll = prepareAction(g.k, g.state, input).roll
    if (want(roll.degree as Degree, roll.margin)) return
  }
  throw new Error('找不到合乎條件的種子')
}
/** 把 DC 壓到 14 左右（信譽高、有交情），一般的骰面才有成功也有失敗。 */
const easy = (g: G, ...ids: string[]) => {
  setMeter(g, 'rep', undefined, 90)
  for (const id of ids) setMeter(g, 'affinity', id, 20)
}
async function recruit(g: G, id: string, want: (d: Degree, margin: number) => boolean) {
  easy(g, id)
  rig(g, id, want)
  const r = await g.act(recruitInput(g.k, g.state, id))
  expect(r.status, r.reason).toBe('applied')
  return r
}

describe('招募的結果：成功進名冊；差一點的「再想想」，睡一覺之後才能再問', () => {
  it('成功：進名冊、忠誠起始 30、報告上有 roster.join 的變更；大成功一樣', async () => {
    for (const want of [(d: Degree) => d === 'success', (d: Degree) => d === 'critical']) {
      const g = make()
      await recruit(g, 'r_ann', want)
      expect(members(g)).toEqual(['r_ann'])
      expect(loyalty(g, 'r_ann')).toBe(30)
      expect(readRoster(g.state).members.r_ann).toMatchObject({ pay: 'fee', since: { day: 3 } })
      const last = g.state.reports.at(-1)!
      expect(last.action).toBe('npc_recruit')
      expect(last.args).toEqual({ kind: 'npc_recruit', target: 'r_ann', text: '招募安' })
      expect(last.changes.some((c) => c.op === 'roster.join' && c.who === 'r_ann')).toBe(true)
    }
  })

  it('差一點（失敗而差距不到 3 點）：沒有進名冊，記下「再想想」，再問被擋；睡一覺之後可以再問', async () => {
    const g = make()
    await recruit(g, 'r_ann', (d, m) => d === 'fail' && m > -3)
    expect(members(g)).toEqual([])
    expect(readRoster(g.state).thinking).toEqual(['r_ann'])
    expect(recruitBlock(g.k, g.state, 'r_ann')).toBe('安說要再想想：睡一覺之後才能再問。')
    // 喘口氣與階段之間的休息都不算
    for (const kind of ['breath', 'stage'] as const) put(g, restDone(g.k, g.state, kind))
    expect(readRoster(g.state).thinking).toEqual(['r_ann'])
    put(g, restDone(g.k, g.state, 'sleep'))
    expect(readRoster(g.state).thinking).toEqual([])
    expect(recruitBlock(g.k, g.state, 'r_ann')).toBeNull()
    // 再問一次成功就進去，也不會留著「再想想」
    await recruit(g, 'r_ann', (d) => d === 'success')
    expect(members(g)).toEqual(['r_ann'])
  })

  it('差很多的失敗與大失敗：什麼都不記，可以馬上再問', async () => {
    const g = make()
    await recruit(g, 'r_ann', (d, m) => d === 'fail' && m <= -3)
    expect(readRoster(g.state).thinking).toEqual([])
    expect(recruitBlock(g.k, g.state, 'r_ann')).toBeNull()
    await recruit(g, 'r_ann', (d) => d === 'fumble')
    expect(readRoster(g.state).thinking).toEqual([])
    expect(members(g)).toEqual([])
  })

  it('候選人是救過的：招募成功之後忠誠起始 50；介紹的 40；候選名單裡拿掉', async () => {
    const g = make()
    put(g, [{ op: 'roster.candidate', who: 'r_ann', at: { ...g.state.time }, source: 'rescued' }, { op: 'roster.candidate', who: 'r_bob', at: { ...g.state.time }, source: 'introduced' }])
    await recruit(g, 'r_ann', (d) => d === 'success')
    await recruit(g, 'r_bob', (d) => d === 'success')
    expect(loyalty(g, 'r_ann')).toBe(50)
    expect(loyalty(g, 'r_bob')).toBe(40)
    expect(candidatesOf(g.state)).toEqual([])
  })

  it('招募成功的報告通過不變式（changes 套用之後等於實際的變化）', async () => {
    const g = make()
    easy(g, 'r_ann')
    rig(g, 'r_ann', (d) => d === 'success')
    const { violations } = await observed(g, async () => { await g.act(recruitInput(g.k, g.state, 'r_ann')) })
    expect(violations).toEqual([])
    expect(members(g)).toEqual(['r_ann'])
  })
})

// ---- 進名冊與離開 ----

describe('進名冊 join、離開 leave', () => {
  it('進名冊：報告 roster.join；忠誠起始 30（救過的 50、介紹的 40、也可以直接指定）；可靠度在範圍內且同一個人永遠一樣', () => {
    const g = make()
    const [r] = g.commit(join(g.k, g.state, 'r_ann'))
    expect(r!.action).toBe('roster.join')
    expect(r!.outcome.summary).toBe('安進了你的名冊。')
    expect(loyalty(g, 'r_ann')).toBe(30)
    g.commit(join(g.k, g.state, 'r_bob', { source: 'rescued' }))
    g.commit(join(g.k, g.state, 'r_cora', { source: 'introduced' }))
    g.commit(join(g.k, g.state, 'r_dee', { loyalty: 77, reliability: 12 }))
    expect([loyalty(g, 'r_bob'), loyalty(g, 'r_cora'), loyalty(g, 'r_dee')]).toEqual([50, 40, 77])
    const m = readRoster(g.state).members
    expect(m.r_dee!.reliability).toBe(12)
    for (const id of ['r_ann', 'r_bob', 'r_cora']) {
      expect(m[id]!.reliability).toBeGreaterThanOrEqual(DEFAULT_ROSTER_RULES.reliability_min)
      expect(m[id]!.reliability).toBeLessThanOrEqual(DEFAULT_ROSTER_RULES.reliability_max)
    }
    // 同一個種子、同一個人：重來一局一樣
    const again = make()
    again.commit(join(again.k, again.state, 'r_ann'))
    expect(readRoster(again.state).members.r_ann!.reliability).toBe(m.r_ann!.reliability)
  })

  it('固定夥伴預設拿分紅，其餘預設出場費；進來那一刻就是「最近一次召集」', () => {
    const g = make()
    addFixed(g, 'r_ann')
    add(g, 'r_bob')
    const m = readRoster(g.state).members
    expect(m.r_ann).toMatchObject({ pay: 'share', fixed: true, since: g.state.time, last_called: g.state.time })
    expect(m.r_bob!.pay).toBe('fee')
    expect(m.r_bob!.fixed).toBeUndefined()
  })

  it('放不進去的原因：主角、查不到的人、已經在名冊上；街坊可以放進名冊（只是不能進隊伍）', () => {
    const g = make()
    expect(reasonOf(() => join(g.k, g.state, 'pc'))).toBe('主角不用進自己的名冊。')
    expect(reasonOf(() => join(g.k, g.state, 'nobody'))).toContain('nobody')
    add(g, 'r_ann')
    expect(reasonOf(() => join(g.k, g.state, 'r_ann'))).toBe('安已經在你的名冊上了。')
    expect(joinBlock(g.k, g.state, 'c_bob')).toBeNull()
  })

  it('離開：成員、同行、隊伍都拿掉；不在名冊上丟原因；報告 roster.leave', () => {
    const g = make()
    add(g, 'r_ann', 'r_bob')
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['r_bob'] }))
    expect(g.state.party).toEqual(['pc', 'r_ann'])
    const [r] = g.commit(leave(g.state, 'r_ann'))
    expect(r!.action).toBe('roster.leave')
    expect(r!.outcome.summary).toBe('你把安從名冊上拿掉了。')
    expect(members(g)).toEqual(['r_bob'])
    expect(g.state.party).toEqual(['pc'])
    g.commit(leave(g.state, 'r_bob', 'loyalty'))
    expect(readRoster(g.state).tagalong).toEqual([])
    expect(g.state.reports.at(-1)!.outcome.summary).toBe('鮑對你已經沒有信任了，離開了你的名冊。')
    expect(reasonOf(() => leave(g.state, 'r_ann'))).toBe('安不在你的名冊上。')
  })

  it('變更本身也守規矩：重複進、不存在的角色、不是成員的離開，整份報告不成立', () => {
    const g = make()
    add(g, 'r_ann')
    expect(() => put(g, [{ op: 'roster.join', who: 'r_ann', since: { ...g.state.time }, reliability: 50, pay: 'fee' }])).toThrow()
    expect(() => put(g, [{ op: 'roster.join', who: 'nobody', since: { ...g.state.time }, reliability: 50, pay: 'fee' }])).toThrow()
    expect(() => put(g, [{ op: 'roster.join', who: 'r_bob', since: { ...g.state.time }, reliability: 150, pay: 'fee' }])).toThrow()
    expect(() => put(g, [{ op: 'roster.join', who: 'r_bob', since: { ...g.state.time }, reliability: 50, pay: 'gift' }])).toThrow()
    expect(() => put(g, [{ op: 'roster.leave', who: 'r_bob' }])).toThrow()
    expect(members(g)).toEqual(['r_ann'])
  })
})

// ---- 召集 ----

describe('muster：隊伍含主角最多 4 人、同行最多 2 位', () => {
  const full = () => {
    const g = make({ pc: { attrs: { charm: 20 } } })
    add(g, 'r_ann', 'r_bob', 'r_cora', 'r_dee', 'r_eve', 'r_fay')
    return g
  }

  it('成功之後 state.party 就是主角加上那幾個人（主角在最前面，寫不寫都行）；同行寫進名冊；報告 roster.muster', () => {
    const g = full()
    const [r] = g.commit(muster(g.k, g.state, { party: ['r_ann', 'r_bob', 'r_cora'], tagalong: ['c_bob', 'r_dee'] }))
    expect(r!.action).toBe('roster.muster')
    expect(g.state.party).toEqual(['pc', 'r_ann', 'r_bob', 'r_cora'])
    expect(readRoster(g.state).tagalong).toEqual(['c_bob', 'r_dee'])
    // 主角自己寫進去也一樣；重複的人算一個
    g.commit(muster(g.k, g.state, { party: ['pc', 'r_fay', 'r_fay'] }))
    expect(g.state.party).toEqual(['pc', 'r_fay'])
    expect(readRoster(g.state).tagalong).toEqual([])
  })

  it('召集會換掉整個隊伍：沒再被點名的人離隊；一個人出門也行', () => {
    const g = full()
    g.commit(muster(g.k, g.state, { party: ['r_ann', 'r_bob'] }))
    g.commit(muster(g.k, g.state, { party: ['r_bob', 'r_cora'] }))
    expect(g.state.party).toEqual(['pc', 'r_bob', 'r_cora'])
    const [r] = g.commit(muster(g.k, g.state, {}))
    expect(g.state.party).toEqual(['pc'])
    expect(r!.outcome.summary).toBe('召集：這趟你一個人出門。')
  })

  it('第五個人被擋（含主角最多 4 人），原因寫出是誰；狀態不變', () => {
    const g = full()
    g.commit(muster(g.k, g.state, { party: ['r_ann'] }))
    const input: MusterInput = { party: ['r_bob', 'r_cora', 'r_dee', 'r_eve'] }
    expect(musterBlocks(g.k, g.state, input)).toEqual(['隊伍最多 4 人（含你自己），伊芙排不進去。'])
    expect(reasonOf(() => muster(g.k, g.state, input))).toBe('隊伍最多 4 人（含你自己），伊芙排不進去。')
    expect(g.state.party).toEqual(['pc', 'r_ann'])
    // 剛好 4 人（主角加三個）成立
    expect(musterBlocks(g.k, g.state, { party: ['r_bob', 'r_cora', 'r_dee'] })).toEqual([])
  })

  it('受傷的人被擋，寫出是誰、為什麼；躲風頭、被捕、在忙各有各的句子；到期了的狀態不算', () => {
    const g = full()
    condition(g, 'r_ann', 'injured')
    expect(musterBlocks(g.k, g.state, { party: ['r_ann'] })).toEqual(['安受傷了，現在沒空。'])
    expect(reasonOf(() => muster(g.k, g.state, { party: ['r_ann', 'r_bob'] }))).toBe('安受傷了，現在沒空。')
    condition(g, 'r_bob', 'lying_low')
    condition(g, 'r_cora', 'arrested')
    condition(g, 'r_dee', 'busy')
    expect(musterBlocks(g.k, g.state, { party: ['r_bob', 'r_cora', 'r_dee'] })).toEqual(['鮑正在躲風頭，現在沒空。', '柯拉被抓了，現在沒空。', '迪正在忙別的事，現在沒空。'])
    // 同一個人兩個狀態：兩句；到期的不算；還沒到期的算
    condition(g, 'r_eve', 'injured', toMinutes(g.state.time) - 1)
    condition(g, 'r_fay', 'busy', toMinutes(g.state.time) + 60)
    expect(musterBlocks(g.k, g.state, { party: ['r_eve'] })).toEqual([])
    expect(musterBlocks(g.k, g.state, { party: ['r_fay'] })).toEqual(['菲正在忙別的事，現在沒空。'])
    condition(g, 'r_eve', 'busy')
    condition(g, 'r_eve', 'lying_low')
    expect(musterBlocks(g.k, g.state, { party: ['r_eve'] })).toEqual(['伊芙正在忙別的事，現在沒空。', '伊芙正在躲風頭，現在沒空。'])
  })

  it('隊伍的人要是名冊上的行者：不在名冊上、街坊（不是行者）各一句；查不到的人也擋', () => {
    const g = make()
    add(g, 'r_ann', 'c_bob')
    expect(musterBlocks(g.k, g.state, { party: ['r_bob'] })).toEqual(['鮑不在你的名冊上，不能進隊伍（只能同行）。'])
    expect(musterBlocks(g.k, g.state, { party: ['c_bob'] })).toEqual(['街坊鮑勃不是行者，不能進隊伍（只能同行）。'])
    expect(musterBlocks(g.k, g.state, { party: ['nobody'] })).toEqual(['查不到 nobody 這個人。'])
    expect(reasonOf(() => muster(g.k, g.state, { party: ['r_bob', 'c_bob'] }))).toBe('鮑不在你的名冊上，不能進隊伍（只能同行）。街坊鮑勃不是行者，不能進隊伍（只能同行）。')
  })

  it('同行誰都可以（街坊、不在名冊上的人、受傷的人）；第三位被擋；查不到的人被擋；已經在隊上的不能再當同行', () => {
    const g = make()
    add(g, 'r_ann')
    condition(g, 'r_bob', 'injured')
    expect(musterBlocks(g.k, g.state, { tagalong: ['c_bob', 'r_bob'] })).toEqual([])
    expect(musterBlocks(g.k, g.state, { tagalong: ['c_bob', 'r_bob', 'r_cora'] })).toEqual(['同行最多 2 位，柯拉排不進去。'])
    expect(reasonOf(() => muster(g.k, g.state, { tagalong: ['c_bob', 'r_bob', 'r_cora'] }))).toBe('同行最多 2 位，柯拉排不進去。')
    expect(musterBlocks(g.k, g.state, { tagalong: ['nobody'] })).toEqual(['查不到 nobody 這個人。'])
    expect(musterBlocks(g.k, g.state, { party: ['r_ann'], tagalong: ['r_ann'] })).toEqual(['安已經在隊伍裡了，不用再當同行。'])
    // 主角不用也不能當同行：寫了就略過
    expect(musterBlocks(g.k, g.state, { tagalong: ['pc'] })).toEqual([])
  })

  it('被召集的名冊成員（隊伍與同行）記下召集的時間；沒被召集的不變', () => {
    const g = make({ pc: { attrs: { charm: 20 } } })
    add(g, 'r_ann', 'r_bob', 'r_cora')
    const joined = clone(g.state.time)
    advance(g, 3 * DAY)
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['r_bob', 'c_bob'] }))
    const m = readRoster(g.state).members
    expect(m.r_ann!.last_called).toEqual(g.state.time)
    expect(m.r_bob!.last_called).toEqual(g.state.time)
    expect(m.r_cora!.last_called).toEqual(joined)
  })

  it('召集的報告通過不變式；戰鬥進行中不能召集（commit:roster.muster 被核心的白名單擋下）', async () => {
    const g = make({ features: [TEST_COMBAT, STUBS, METERS, rosterFeature] })
    add(g, 'r_ann')
    const { violations } = await observed(g, () => { g.commit(muster(g.k, g.state, { party: ['r_ann'] })) })
    expect(violations).toEqual([])
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(g.blockOf('commit:roster.muster')).not.toBeNull()
  })
})

// ---- 出場費與分紅 ----

describe('出場費 roster_fee：主職階數² × 200 ×（1 ± 25%，照人固定）', () => {
  const feeBase = (tier: number) => tier * tier * 200
  /** 信譽拉高、忠誠拉到 50：兩個加成都不算，剩下純粹的 階數² × 200 × 浮動。 */
  const neutral = (g: G, ...ids: string[]) => {
    setMeter(g, 'rep', undefined, 90)
    for (const id of ids) setMeter(g, 'loyalty', id, 50)
  }

  it('同一個人每次問數字一樣（不管問幾次、中間做了別的事）；落在 ±25% 之內；用衍生數值問也一樣', () => {
    const g = make()
    add(g, 'r_bob') // 2 階：800
    neutral(g, 'r_bob')
    const first = feeOf(g.k, g.state, 'r_bob')
    expect(first).toBeGreaterThanOrEqual(feeBase(2) * 0.75)
    expect(first).toBeLessThanOrEqual(feeBase(2) * 1.25)
    for (let i = 0; i < 5; i++) expect(feeOf(g.k, g.state, 'r_bob')).toBe(first)
    put(g, [{ op: 'cash', delta: 50 }])
    advance(g, 60)
    expect(feeOf(g.k, g.state, 'r_bob')).toBe(first)
    expect(g.k.stats.stat(g.state, 'r_bob', 'roster_fee')).toBe(first)
    // 存檔讀回來還是一樣
    const other = make()
    expect(other.load(g.save())).toBeNull()
    expect(feeOf(other.k, other.state, 'r_bob')).toBe(first)
  })

  it('每個人各有各的浮動（不是全部一樣），每一個都在範圍裡；階數越高越貴（平方）', () => {
    const g = make({ pc: { attrs: { charm: 20 } }, actors: [...ALL(), ...['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map((id) => runner(id, id, 2))] })
    add(g, 'x1', 'x2', 'x3', 'x4', 'x5', 'x6')
    neutral(g, 'x1', 'x2', 'x3', 'x4', 'x5', 'x6')
    const fees = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map((id) => feeOf(g.k, g.state, id))
    expect(new Set(fees).size).toBeGreaterThan(2)
    for (const f of fees) {
      expect(f).toBeGreaterThanOrEqual(600)
      expect(f).toBeLessThanOrEqual(1000)
    }
    // 換一個種子，浮動跟著換（照人加種子固定）
    const h = make({ seed: 99, pc: { attrs: { charm: 20 } }, actors: [...ALL(), ...['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map((id) => runner(id, id, 2))] })
    add(h, 'x1', 'x2', 'x3', 'x4', 'x5', 'x6')
    neutral(h, 'x1', 'x2', 'x3', 'x4', 'x5', 'x6')
    expect(['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map((id) => feeOf(h.k, h.state, id))).not.toEqual(fees)
  })

  it('階數²：同一個種子下 1 階與 4 階相差大約 16 倍（各自的浮動在 ±25% 內）', () => {
    const g = make({ pc: { attrs: { charm: 20 } }, actors: [runner('lo', 'lo', 1), runner('hi', 'hi', 4)] })
    add(g, 'lo', 'hi')
    neutral(g, 'lo', 'hi')
    const lo = feeOf(g.k, g.state, 'lo')
    const hi = feeOf(g.k, g.state, 'hi')
    expect(lo).toBeLessThanOrEqual(250)
    expect(lo).toBeGreaterThanOrEqual(150)
    expect(hi).toBeGreaterThanOrEqual(feeBase(4) * 0.75)
    expect(hi).toBeLessThanOrEqual(feeBase(4) * 1.25)
    // 沒有 main 的那一列：取最高的階
    const noMain = make({ actors: [makeActor({ id: 'nm', name: '無主職', role: 'npc', ext: paths(['p_gun', 'sub', 3], ['p_face', 'third', 1])})] })
    add(noMain, 'nm')
    neutral(noMain, 'nm')
    expect(feeOf(noMain.k, noMain.state, 'nm')).toBeGreaterThanOrEqual(feeBase(3) * 0.75)
    expect(feeOf(noMain.k, noMain.state, 'nm')).toBeLessThanOrEqual(feeBase(3) * 1.25)
  })

  it('忠誠 20～39 時多 25%（20、39 算，19、40 不算）', () => {
    const g = make()
    add(g, 'r_bob')
    setMeter(g, 'loyalty', 'r_bob', 50)
    const normal = feeOf(g.k, g.state, 'r_bob')
    for (const [value, extra] of [[30, true], [20, true], [39, true], [19, false], [40, false], [100, false]] as const) {
      setMeter(g, 'loyalty', 'r_bob', value)
      const fee = feeOf(g.k, g.state, 'r_bob')
      if (extra) expect(Math.abs(fee - normal * 1.25), `忠誠 ${value}`).toBeLessThanOrEqual(1)
      else expect(fee, `忠誠 ${value}`).toBe(normal)
    }
  })

  it('信譽階序比他低再 +20%；一樣或更高不加；信譽沒人定義（沒裝）時階序當 0', () => {
    const g = make()
    add(g, 'r_bob') // 2 階
    setMeter(g, 'loyalty', 'r_bob', 50)
    setMeter(g, 'rep', undefined, 35) // 有號：階序 2
    const equal = feeOf(g.k, g.state, 'r_bob')
    setMeter(g, 'rep', undefined, 15) // 熟面孔：階序 1 < 2
    const lower = feeOf(g.k, g.state, 'r_bob')
    expect(Math.abs(lower - equal * 1.2)).toBeLessThanOrEqual(1)
    setMeter(g, 'rep', undefined, 90)
    expect(feeOf(g.k, g.state, 'r_bob')).toBe(equal)
    // 兩個加成疊在一起（乘起來）
    setMeter(g, 'rep', undefined, 15)
    setMeter(g, 'loyalty', 'r_bob', 30)
    expect(Math.abs(feeOf(g.k, g.state, 'r_bob') - equal * 1.2 * 1.25)).toBeLessThanOrEqual(2)
    const bare = make({ features: [STUBS, rosterFeature] })
    add(bare, 'r_bob')
    expect(feeOf(bare.k, bare.state, 'r_bob')).toBeGreaterThan(0)
  })

  it('拿分紅的人是 0；不在名冊上的人是 0；payOf 回答他拿的是出場費還是分紅', () => {
    const g = make()
    addFixed(g, 'r_ann')
    add(g, 'r_bob')
    expect(feeOf(g.k, g.state, 'r_ann')).toBe(0)
    expect(g.k.stats.stat(g.state, 'r_ann', 'roster_fee')).toBe(0)
    expect(feeOf(g.k, g.state, 'r_cora')).toBe(0)
    expect(feeOf(g.k, g.state, 'pc')).toBe(0)
    expect(payOf(g.state, 'r_ann')).toBe('share')
    expect(payOf(g.state, 'r_bob')).toBe('fee')
    expect(payOf(g.state, 'r_cora')).toBeNull()
    // 改成分紅：出場費變 0；改回來又有
    g.commit(setPay(g.state, 'r_bob', { pay: 'share' }))
    expect(payOf(g.state, 'r_bob')).toBe('share')
    expect(feeOf(g.k, g.state, 'r_bob')).toBe(0)
    g.commit(setPay(g.state, 'r_bob', { pay: 'fee' }))
    expect(feeOf(g.k, g.state, 'r_bob')).toBeGreaterThan(0)
  })
})

describe('每週薪水 weeklyPay：只有設了週薪的成員（拿分紅的不在這裡）', () => {
  it('沒設週薪是空的；設了之後照角色 id 排；改成分紅就沒有了；不給週薪（null）也沒有了', () => {
    const g = make()
    add(g, 'r_bob', 'r_ann')
    addFixed(g, 'r_cora')
    expect(weeklyPay(g.state)).toEqual([])
    g.commit(setPay(g.state, 'r_bob', { weekly: 300 }))
    g.commit(setPay(g.state, 'r_ann', { weekly: 500 }))
    expect(weeklyPay(g.state)).toEqual([{ who: 'r_ann', name: '安', amount: 500 }, { who: 'r_bob', name: '鮑', amount: 300 }])
    expect(memberOf(g.state, 'r_bob')!.weekly).toBe(300)
    g.commit(setPay(g.state, 'r_bob', { weekly: null }))
    expect(weeklyPay(g.state).map((x) => x.who)).toEqual(['r_ann'])
    g.commit(setPay(g.state, 'r_ann', { pay: 'share' }))
    expect(weeklyPay(g.state)).toEqual([])
    expect(memberOf(g.state, 'r_ann')!.weekly).toBeUndefined()
  })

  it('設不成的原因：不在名冊上、週薪不是正整數、分紅的人不能再給週薪；離開之後就沒有了', () => {
    const g = make()
    add(g, 'r_bob')
    addFixed(g, 'r_ann')
    expect(reasonOf(() => setPay(g.state, 'r_cora', { weekly: 100 }))).toBe('柯拉不在你的名冊上。')
    expect(reasonOf(() => setPay(g.state, 'r_bob', { weekly: 0 }))).toBe('週薪要是大於 0 的整數。')
    expect(reasonOf(() => setPay(g.state, 'r_bob', { weekly: 1.5 }))).toBe('週薪要是大於 0 的整數。')
    expect(reasonOf(() => setPay(g.state, 'r_ann', { weekly: 100 }))).toBe('安拿的是分紅，不能再給週薪。')
    g.commit(setPay(g.state, 'r_bob', { weekly: 100 }))
    g.commit(leave(g.state, 'r_bob'))
    expect(weeklyPay(g.state)).toEqual([])
  })

  it('進名冊時可以直接設週薪', () => {
    const g = make()
    g.commit(join(g.k, g.state, 'r_bob', { weekly: 250 }))
    expect(weeklyPay(g.state)).toEqual([{ who: 'r_bob', name: '鮑', amount: 250 }])
  })
})

// ---- 忠誠 ----

describe('忠誠：連兩週沒召集的生成行者 −2', () => {
  it('兩週沒被召集：−2；一週不扣；固定夥伴不扣', () => {
    const g = make()
    add(g, 'r_ann')
    addFixed(g, 'r_bob')
    advance(g, 7 * DAY)
    expect([loyalty(g, 'r_ann'), loyalty(g, 'r_bob')]).toEqual([30, 30])
    const rs = advance(g, 7 * DAY)
    expect(loyalty(g, 'r_ann')).toBe(28)
    expect(loyalty(g, 'r_bob')).toBe(30)
    const weekly = rs.find((r) => r.action === 'roster.weekly')!
    expect(weekly.kind).toBe('downtime')
    expect(weekly.outcome.summary).toBe('安已經 2 週沒被召集，忠誠 -2。')
    expect(weekly.changes).toEqual([{ op: 'meter', kind: 'loyalty', key: 'r_ann', delta: -2 }])
  })

  it('每滿兩週扣一次（2、4、6 週）：一次睡過四週是 −4；被召集之後重新數', () => {
    const g = make()
    add(g, 'r_ann', 'r_bob')
    advance(g, 28 * DAY)
    expect(loyalty(g, 'r_ann')).toBe(26)
    // 鮑：第一週過去之後被召集，從那一刻重新數
    const h = make()
    add(h, 'r_bob')
    advance(h, 7 * DAY)
    h.commit(muster(h.k, h.state, { party: ['r_bob'] }))
    advance(h, 7 * DAY)
    expect(loyalty(h, 'r_bob')).toBe(30)
    advance(h, 7 * DAY)
    expect(loyalty(h, 'r_bob')).toBe(28)
  })

  it('一次只跨一天、沒有跨過週一：什麼報告都沒有；沒有成員：沒有報告', () => {
    const g = make()
    const rs = advance(g, 60)
    expect(rs.map((r) => r.action)).toEqual(['test.wait'])
    add(g, 'r_ann')
    expect(advance(g, 60).map((r) => r.action)).toEqual(['test.wait'])
  })

  it('忠誠已經是 0：不再扣、沒有報告；被召集的同行也算「召集過」', () => {
    const g = make()
    add(g, 'r_ann')
    setMeter(g, 'loyalty', 'r_ann', 0)
    setPay(g.state, 'r_ann', {})
    const rs = advance(g, 14 * DAY)
    expect(rs.some((r) => r.action === 'roster.weekly')).toBe(false)
    const h = make()
    add(h, 'r_bob')
    advance(h, 7 * DAY)
    h.commit(muster(h.k, h.state, { tagalong: ['r_bob'] }))
    advance(h, 7 * DAY)
    expect(loyalty(h, 'r_bob')).toBe(30)
  })

  it('weeklyDrafts 是純函式：不改狀態；只有跨過週一才有東西', () => {
    const g = make()
    add(g, 'r_ann')
    const before = clone(g.state)
    const from = { ...g.state.time }
    const to = { day: from.day + 14, hour: from.hour, minute: from.minute }
    expect(weeklyDrafts(g.k, g.state, from, from)).toEqual([])
    const drafts = weeklyDrafts(g.k, g.state, from, to)
    expect(drafts.map((d) => d.action)).toEqual(['roster.weekly'])
    expect(g.state).toEqual(before)
  })
})

describe('每週忠誠 20 以下的人 30% 離開（固定骰面驗兩邊）', () => {
  const leaver = (g: G) => g.state.reports.filter((r) => r.action === 'roster.leave')

  it('機會 100%（資料蓋掉）：忠誠 15 的人過一週就離開；機會 0：留下', () => {
    const sure = make({ content: (c) => { c.roster_rule = [{ id: 'default', leave_chance: 1 }] } })
    add(sure, 'r_ann')
    setMeter(sure, 'loyalty', 'r_ann', 15)
    const rs = advance(sure, 7 * DAY)
    expect(members(sure)).toEqual([])
    const r = rs.find((x) => x.action === 'roster.leave')!
    expect(r.outcome.summary).toBe('安對你已經沒有信任了，離開了你的名冊。')
    expect(r.changes).toEqual([{ op: 'roster.leave', who: 'r_ann' }])
    const never = make({ content: (c) => { c.roster_rule = [{ id: 'default', leave_chance: 0 }] } })
    add(never, 'r_ann')
    setMeter(never, 'loyalty', 'r_ann', 15)
    advance(never, 7 * DAY)
    expect(members(never)).toEqual(['r_ann'])
    expect(leaver(never)).toEqual([])
  })

  it('20 以下（含 20）才擲；21 不擲，機會再高也不離開', () => {
    const at = (value: number) => {
      const g = make({ content: (c) => { c.roster_rule = [{ id: 'default', leave_chance: 1 }] } })
      add(g, 'r_ann')
      setMeter(g, 'loyalty', 'r_ann', value)
      advance(g, 7 * DAY)
      return members(g).length
    }
    expect([at(0), at(20), at(21), at(40)]).toEqual([0, 0, 1, 1])
  })

  it('預設 30%：換種子兩邊都會發生；同一個種子永遠同一個結果', () => {
    const run = (seed: number) => {
      const g = make({ seed })
      add(g, 'r_ann')
      setMeter(g, 'loyalty', 'r_ann', 15)
      advance(g, 7 * DAY)
      return members(g).length === 0
    }
    const results = Array.from({ length: 60 }, (_, i) => run(i + 1))
    const left = results.filter(Boolean).length
    expect(left).toBeGreaterThan(5)
    expect(left).toBeLessThan(40)
    expect(Array.from({ length: 60 }, (_, i) => run(i + 1))).toEqual(results)
  })

  it('離開的人也離開隊伍與同行；同一週別人不受影響；離開之後後面幾週不再處理他', () => {
    const g = make({ content: (c) => { c.roster_rule = [{ id: 'default', leave_chance: 1 }] } })
    add(g, 'r_ann', 'r_bob')
    g.commit(muster(g.k, g.state, { party: ['r_ann', 'r_bob'] }))
    setMeter(g, 'loyalty', 'r_ann', 10)
    advance(g, 28 * DAY)
    expect(members(g)).toEqual(['r_bob'])
    expect(g.state.party).toEqual(['pc', 'r_bob'])
    expect(leaver(g)).toHaveLength(1)
  })

  it('連兩週沒召集先扣再判斷：忠誠 22 的人兩週後變 20，下一次就會離開', () => {
    const g = make({ content: (c) => { c.roster_rule = [{ id: 'default', leave_chance: 1 }] } })
    add(g, 'r_ann')
    setMeter(g, 'loyalty', 'r_ann', 22)
    advance(g, 14 * DAY)
    expect(members(g)).toEqual([]) // 第二個週一扣到 20，當週就判斷
  })
})

describe('戰鬥裡倒下的成員忠誠 −3（activity.end 的戰鬥）', () => {
  it('倒下的成員 −3；沒上場的成員不變；主角與不在名冊上的人沒有忠誠這一列', async () => {
    const g = make({ features: [TEST_COMBAT, STUBS, METERS, rosterFeature] })
    add(g, 'r_ann', 'r_bob')
    const weak = (actor: string, i: number) => ({ from: 'unit', unit: partyUnit(i, 1, { actor, hp: { now: 1, max: 40 }, evade: 0 }) as unknown as Rec })
    const setup: BattleSetup = {
      mode: 'meat', grade: 1, cover: 'sparse',
      allies: [weak('pc', 0), weak('r_ann', 1), weak('c_bob', 2)] as never,
      foes: [enemyUnit('boss', 1), enemyUnit('boss', 1), enemyUnit('boss', 1)].map((u) => ({ from: 'unit', unit: u as unknown as Rec })) as never,
    }
    g.startBattle(setup)
    playOut(g)
    const downs = Object.values(g.state.battle!.units).filter((u) => u.side === 'ally' && (u.out === 'down' || u.out === 'burnout')).map((u) => u.actor)
    expect(downs).toContain('r_ann')
    const res = await g.finishBattle()
    expect(res.status).toBe('applied')
    expect(loyalty(g, 'r_ann')).toBe(30 - 3)
    expect(loyalty(g, 'r_bob')).toBe(30)
    expect(g.state.meters.loyalty?.pc).toBeUndefined()
    expect(g.state.meters.loyalty?.c_bob).toBeUndefined()
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('安在戰鬥裡倒下，忠誠 -3')
  })
})

// ---- 候補 ----

describe('戰鬥的候補：k.battle.bench', () => {
  /** 不經過提交的一場戰鬥：我方是主角和 r_in；名冊上另有幾個人。 */
  function arena() {
    const k = createKernel([TEST_COMBAT, STUBS, METERS, rosterFeature])
    const state = makeState({
      pc: { attrs: { charm: 20 } },
      actors: [runner('r_in', '已在場', 2), runner('r_free', '有空', 2), runner('r_arrested', '阿捕', 2), runner('r_injured', '阿傷', 2), runner('r_party', '隊上', 2), runner('r_tag', '同行', 2), makeActor({ id: 'r_citizen', name: '街坊', role: 'npc' })],
    })
    for (const id of ['r_in', 'r_free', 'r_arrested', 'r_injured', 'r_party', 'r_tag', 'r_citizen']) {
      k.changes.applyAll(state, [{ op: 'roster.join', who: id, since: { ...state.time }, reliability: 50, pay: 'fee' }])
    }
    k.changes.applyAll(state, [
      { op: 'actor.condition', id: 'r_arrested', condition: 'arrested' }, { op: 'actor.condition', id: 'r_injured', condition: 'injured' },
      { op: 'actor.condition', id: 'r_injured', condition: 'busy' },
      { op: 'party', id: 'r_party' }, { op: 'roster.muster', party: ['r_party'], tagalong: ['r_tag'], at: { ...state.time } },
    ])
    const setup: BattleSetup = {
      mode: 'meat', grade: 1, cover: 'sparse',
      allies: [{ from: 'unit', unit: partyUnit(0, 1, { actor: 'pc' }) as unknown as Rec }, { from: 'unit', unit: partyUnit(1, 1, { actor: 'r_in' }) as unknown as Rec }] as never,
      foes: [{ from: 'unit', unit: enemyUnit('minion', 1) as unknown as Rec }] as never,
    }
    const battle = clone(setupBattle(k, state, setup).battle)
    return { k, state, battle, run: () => new BattleRun(k, state, battle) }
  }

  it('有空的人 blocks 是空的、ref 是 { from: actor, id }；隊上的人與已經在這一場裡的人不列', () => {
    const a = arena()
    const bench = a.run().bench('ally')
    const ids = bench.map((e) => e.id)
    expect(ids).not.toContain('r_party')
    expect(ids).not.toContain('r_in')
    expect(ids).not.toContain('pc')
    const free = bench.find((e) => e.id === 'r_free')!
    expect(free).toEqual({ id: 'r_free', ref: { from: 'actor', id: 'r_free' }, name: '有空', blocks: [] })
  })

  it('被捕的人列著並有原因；受傷又在忙的兩句；同行與非行者也列著帶原因', () => {
    const a = arena()
    const by = Object.fromEntries(a.run().bench('ally').map((e) => [e.id, e.blocks]))
    expect(by.r_arrested).toEqual(['阿捕被抓了，現在沒空。'])
    expect(by.r_injured).toEqual(['阿傷正在忙別的事，現在沒空。', '阿傷受傷了，現在沒空。'])
    expect(by.r_tag).toEqual(['同行這趟是同行的，不會上場。'])
    expect(by.r_citizen).toEqual(['街坊不是行者，不能上場。'])
  })

  it('敵方沒有候補；名冊上的人叫進場：run.callIn 排進後方，名單裡就不再列他', () => {
    const a = arena()
    const run = a.run()
    expect(run.bench('foe')).toEqual([])
    const unit = run.callIn('ally', { from: 'actor', id: 'r_free' })
    expect(unit).not.toBeNull()
    expect(unit!.actor).toBe('r_free')
    expect(run.bench('ally').map((e) => e.id)).not.toContain('r_free')
  })

  it('狀況變了候補跟著變：被捕的人放出來就沒有原因；名冊拿掉的人不再列', () => {
    const a = arena()
    a.k.changes.applyAll(a.state, [{ op: 'actor.condition', id: 'r_arrested', condition: 'arrested', remove: true }, { op: 'roster.leave', who: 'r_free' }])
    const by = Object.fromEntries(a.run().bench('ally').map((e) => [e.id, e.blocks]))
    expect(by.r_arrested).toEqual([])
    expect(by).not.toHaveProperty('r_free')
  })
})

// ---- 候選人 ----

describe('效果 roster_add：進候選', () => {
  const give = (g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin') => {
    const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
    if (r.errors.length) throw new Error(r.errors.join('；'))
    if (r.changes.length) g.commit(draft(r.changes, 'test.give'))
    return r
  }

  it('候選名單有那個人（記下時間）；重複的不重複加；已經是成員的不加', () => {
    const g = make()
    give(g, [{ kind: 'roster_add', who: 'r_ann' }])
    expect(candidatesOf(g.state)).toEqual([{ who: 'r_ann', at: g.state.time }])
    const again = give(g, [{ kind: 'roster_add', who: 'r_ann' }])
    expect(again.changes).toEqual([])
    expect(candidatesOf(g.state)).toHaveLength(1)
    // 同一批裡寫兩次：也只有一個
    give(g, [{ kind: 'roster_add', who: 'r_bob' }, { kind: 'roster_add', who: 'r_bob' }])
    expect(candidatesOf(g.state).map((c) => c.who)).toEqual(['r_ann', 'r_bob'])
    add(g, 'r_cora')
    expect(give(g, [{ kind: 'roster_add', who: 'r_cora' }]).changes).toEqual([])
  })

  it('進了名冊就從候選拿掉；離開名冊之後可以再成為候選', () => {
    const g = make()
    give(g, [{ kind: 'roster_add', who: 'r_ann' }])
    add(g, 'r_ann')
    expect(candidatesOf(g.state)).toEqual([])
    g.commit(leave(g.state, 'r_ann'))
    give(g, [{ kind: 'roster_add', who: 'r_ann' }])
    expect(candidatesOf(g.state)).toHaveLength(1)
  })

  it('來源 rescued 與 introduced 記在候選上；別的來源、主角、沒寫 who 都不合格', () => {
    const g = make()
    give(g, [{ kind: 'roster_add', who: 'r_ann', source: 'rescued' }])
    expect(candidatesOf(g.state)[0]).toMatchObject({ who: 'r_ann', source: 'rescued' })
    for (const bad of [{ who: 'r_bob', source: 'bought' }, { who: 'pc' }, { source: 'rescued' }, { who: '' }]) {
      expect(g.k.effects.resolve([{ kind: 'roster_add', ...bad }], effectCtx(g.k, g.state, { source: 'builtin' })).errors.length, JSON.stringify(bad)).toBeGreaterThan(0)
    }
    // 救過的人進名冊：忠誠 50
    g.commit(join(g.k, g.state, 'r_ann'))
    expect(loyalty(g, 'r_ann')).toBe(50)
  })

  it('AI 給的：一件事最多一位候選人，多的拿掉並提醒；內建的不限', () => {
    const g = make()
    const r = give(g, [{ kind: 'roster_add', who: 'r_ann' }, { kind: 'roster_add', who: 'r_bob' }], 'ai')
    expect(candidatesOf(g.state).map((c) => c.who)).toEqual(['r_ann'])
    expect(r.clamps.length).toBe(1)
    expect(r.clamps[0]!.notice).toBe('一件事最多只會帶出一位名冊候選人，多的沒有算。')
    give(g, [{ kind: 'roster_add', who: 'r_cora' }, { kind: 'roster_add', who: 'r_dee' }])
    expect(candidatesOf(g.state).map((c) => c.who)).toEqual(['r_ann', 'r_cora', 'r_dee'])
  })

  it('不是角色的人也可以先記成候選（同一批裡認識他的效果可能排在後面）；報告一行寫名字', () => {
    const g = make()
    const r = give(g, [{ kind: 'roster_add', who: 'r_ann' }])
    expect(r.lines).toEqual(['名冊候選：安'])
  })

  it('候選名單過檔案往返不變', () => {
    const g = make()
    give(g, [{ kind: 'roster_add', who: 'r_ann', source: 'introduced' }, { kind: 'roster_add', who: 'r_bob' }])
    const other = make()
    expect(other.load(g.save())).toBeNull()
    expect(candidatesOf(other.state)).toEqual(candidatesOf(g.state))
  })
})

// ---- 忠誠的量表、條件 ----

describe('忠誠量表與條件', () => {
  it('量表：0～100、起始 30；同名的效果與條件核心自動有；AI 一件事最多 ±10', () => {
    const g = make()
    add(g, 'r_ann')
    expect(g.k.meters.get('loyalty')).toMatchObject({ min: 0, max: 100, keyed: 'npc', owner: 'roster' })
    const r = g.k.effects.resolve([{ kind: 'loyalty', key: 'r_ann', amount: 25 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([{ op: 'meter', kind: 'loyalty', key: 'r_ann', delta: 10 }])
    g.commit(draft(g.k.effects.resolve([{ kind: 'loyalty', key: 'r_ann', amount: 100 }], effectCtx(g.k, g.state, { source: 'builtin' })).changes))
    expect(loyalty(g, 'r_ann')).toBe(100)
    expect(test(g, { kind: 'loyalty', key: 'r_ann', min: 70 })).toBe(true)
    expect(test(g, { kind: 'loyalty', key: 'r_ann', max: 69 })).toBe(false)
  })

  it('條件 in_roster、in_party', () => {
    const g = make()
    expect(test(g, { kind: 'in_roster', who: 'r_ann' })).toBe(false)
    add(g, 'r_ann')
    expect(test(g, { kind: 'in_roster', who: 'r_ann' })).toBe(true)
    expect(test(g, { kind: 'in_party', who: 'r_ann' })).toBe(false)
    g.commit(muster(g.k, g.state, { party: ['r_ann'] }))
    expect(test(g, { kind: 'in_party', who: 'r_ann' })).toBe(true)
    expect(test(g, { kind: 'in_party', who: 'pc' })).toBe(true)
    g.commit(leave(g.state, 'r_ann'))
    expect(test(g, { kind: 'in_roster', who: 'r_ann' })).toBe(false)
    expect(test(g, { kind: 'in_party', who: 'r_ann' })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'in_roster' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'in_party', who: 'r_ann' })).toEqual([])
  })

  it('條件 in_tagalong（M2-closeout 第 7 項）：這一趟召集時排的同行才是；留在家的、隊上的、不在名冊上的都不是；離開名冊或重新召集就變', () => {
    const g = make()
    add(g, 'r_ann', 'r_bob', 'r_cora')
    expect(test(g, { kind: 'in_tagalong', who: 'r_bob' })).toBe(false)
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['r_bob'] }))
    expect(test(g, { kind: 'in_tagalong', who: 'r_bob' })).toBe(true)
    expect(test(g, { kind: 'in_tagalong', who: 'r_cora' })).toBe(false) // 留在家
    expect(test(g, { kind: 'in_tagalong', who: 'r_ann' })).toBe(false) // 在隊上（上場的，不是同行）
    expect(test(g, { kind: 'in_tagalong', who: 'c_bob' })).toBe(false) // 不在名冊上
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['r_cora'] }))
    expect(test(g, { kind: 'in_tagalong', who: 'r_bob' })).toBe(false)
    expect(test(g, { kind: 'in_tagalong', who: 'r_cora' })).toBe(true)
    g.commit(leave(g.state, 'r_cora'))
    expect(test(g, { kind: 'in_tagalong', who: 'r_cora' })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'in_tagalong' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'in_tagalong', who: 'r_bob' })).toEqual([])
  })
})

// ---- 規則 ----

describe('規則：roster_rule 蓋掉預設', () => {
  it('沒有資料時是設計書的預設；資料蓋掉其中幾個欄位', () => {
    expect(rosterRules(make().k)).toEqual(DEFAULT_ROSTER_RULES)
    const g = make({ content: (c) => { c.roster_rule = [{ id: 'default', cap_base: 1, party_max: 3, tagalong_max: 1, recruit_base: 10 }] } })
    expect(rosterRules(g.k)).toMatchObject({ cap_base: 1, party_max: 3, tagalong_max: 1, recruit_base: 10, down_delta: -3 })
    expect(rosterCap(g.k, g.state)).toBe(1 + 2)
    add(g, 'r_ann', 'r_bob')
    expect(musterBlocks(g.k, g.state, { party: ['r_ann', 'r_bob'] })).toEqual([])
    expect(musterBlocks(g.k, g.state, { party: ['r_ann', 'r_bob', 'r_cora'] }).some((m) => m === '隊伍最多 3 人（含你自己），柯拉排不進去。')).toBe(true)
    expect(musterBlocks(g.k, g.state, { tagalong: ['c_bob', 'r_dee'] })).toEqual(['同行最多 1 位，迪排不進去。'])
    expect(recruitDc(g.k, g.state, 'r_cora').dc).toBe(10 + 2)
  })

  it('格式不對的規則在載入時擋下，寫出是哪個欄位', () => {
    for (const bad of [{ leave_chance: 2 }, { party_max: 9 }, { idle_delta: 2 }, { face_path: '' }, { fee_base: -1 }, { reliability_min: 90, reliability_max: 10 }]) {
      expect(() => make({ content: (c) => { c.roster_rule = [{ id: 'default', ...bad }] } }), JSON.stringify(bad)).toThrow(ContentError)
    }
  })
})

// ---- 給介面看的 ----

describe('rosterView 與 availability', () => {
  it('列出成員的階數、出場費、忠誠、可靠度、有沒有空、在不在隊上；容量與候選人', () => {
    const g = make()
    add(g, 'r_ann', 'r_bob')
    condition(g, 'r_bob', 'injured')
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['c_bob'] }))
    const v = rosterView(g.k, g.state)
    expect(v).toMatchObject({ cap: 5, size: 2, tagalong: ['c_bob'], candidates: [] })
    const ann = v.members.find((m) => m.id === 'r_ann')!
    expect(ann).toMatchObject({ name: '安', main_tier: 3, pay: 'fee', loyalty: 30, fixed: false, busy: [], in_party: true, tagalong: false, weekly: null })
    expect(ann.fee).toBe(feeOf(g.k, g.state, 'r_ann'))
    expect(v.members.find((m) => m.id === 'r_bob')!.busy).toEqual(['鮑受傷了，現在沒空。'])
    expect(availability(g.state, 'r_ann')).toEqual([])
    expect(availability(g.state, 'r_bob')).toEqual(['鮑受傷了，現在沒空。'])
    expect(availability(g.state, 'r_cora')).toBeNull()
  })
})

// ---- 存檔與整合 ----

describe('存檔往返、回到快照、npcs 的人變成角色之後照樣進名冊', () => {
  it('存檔往返：名冊（成員、同行、候選、再想想）一模一樣；讀回來之後接著用', () => {
    const g = make({ pc: { attrs: { charm: 20 } } })
    add(g, 'r_ann', 'r_bob', 'r_cora')
    addFixed(g, 'r_dee')
    g.commit(setPay(g.state, 'r_bob', { weekly: 300 }))
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['c_bob'] }))
    put(g, [{ op: 'roster.candidate', who: 'r_eve', at: { ...g.state.time }, source: 'rescued' }, { op: 'roster.think', who: 'r_fay' }])
    const before = clone(readRoster(g.state))
    const other = make({ pc: { attrs: { charm: 20 } } })
    expect(other.load(g.save())).toBeNull()
    expect(readRoster(other.state)).toEqual(before)
    expect(other.state.party).toEqual(['pc', 'r_ann'])
    expect(loyalty(other, 'r_dee')).toBe(30)
    expect(weeklyPay(other.state)).toEqual(weeklyPay(g.state))
    expect(feeOf(other.k, other.state, 'r_cora')).toBe(feeOf(g.k, g.state, 'r_cora'))
    // 讀回來之後接著用：召集、離開
    other.commit(muster(other.k, other.state, { party: ['r_cora'] }))
    expect(other.state.party).toEqual(['pc', 'r_cora'])
  })

  it('回退一步（undo）與回到快照：名冊跟著回去', () => {
    const g = make()
    add(g, 'r_ann')
    const raw = g.save('snapshot')
    const keep = clone(readRoster(g.state))
    add(g, 'r_bob')
    g.commit(leave(g.state, 'r_ann'))
    expect(g.rewind(raw, { summary: '你回到了那一刻。' })).toBeNull()
    expect(readRoster(g.state)).toEqual(keep)
    const h = make()
    add(h, 'r_ann')
    expect(h.undoSteps(1)).toBe(true)
    expect(members(h)).toEqual([])
  })

  it('ext.roster 形狀壞掉：當成空的，不丟錯', () => {
    const g = make()
    g.state.ext.roster = { members: { r_ann: { nope: 1 }, r_bob: 'x' }, tagalong: 'y', candidates: [{ who: 5 }, null], thinking: [1, 'ok'] }
    expect(readRoster(g.state)).toEqual({ members: {}, tagalong: [], candidates: [], thinking: ['ok'] })
    expect(rosterView(g.k, g.state).members).toEqual([])
    expect(feeOf(g.k, g.state, 'r_ann')).toBe(0)
  })

  it('名冊的角色被拿掉（actor.remove）：名單不列他、召集與候補略過他，不丟錯', () => {
    const g = make()
    add(g, 'r_ann', 'r_bob')
    put(g, [{ op: 'actor.remove', id: 'r_ann' }])
    expect(rosterView(g.k, g.state).members.map((m) => m.id)).toEqual(['r_bob'])
    expect(weeklyPay(g.state)).toEqual([])
    advance(g, 14 * DAY)
    expect(musterBlocks(g.k, g.state, { party: ['r_ann'] })).toEqual(['查不到 r_ann 這個人。'])
  })

  it('同一個種子、同一串輸入：兩局的結果一模一樣（招募、召集、每週）', async () => {
    const run = async () => {
      const g = make({ pc: { attrs: { charm: 20 } } })
      add(g, 'r_ann', 'r_bob')
      g.commit(muster(g.k, g.state, { party: ['r_ann'] }))
      advance(g, 21 * DAY)
      return JSON.stringify([readRoster(g.state), g.state.meters, g.state.party])
    }
    expect(await run()).toBe(await run())
  })
})

// ---- 和 npcs 一起：認識的人變成角色，帶著 ext.paths 進名冊 ----

describe('npcs 把人變成角色之後，名冊照樣接得上（兩個功能互不 import）', () => {
  const NPC_PACK: Record<string, Rec[]> = {
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1 }],
    block: [{ id: 'b_market', district: 'd_hive', name: '市場', facilities: {} }],
    path: [{ id: 'p_gun', name: '槍手', tree: '戰鬥直覺' }],
    npc: [
      { id: 'npc_ann', name: '安', kind: 'runner', age: 30, guard: 12, wealth: 1, haunts: [{ district: 'd_hive', block: 'b_market' }], paths: [{ path: 'p_gun', slot: 'main', tier: 3 }] },
      { id: 'npc_bob', name: '鮑勃', kind: 'citizen', age: 41, guard: 12, wealth: 1, haunts: [{ district: 'd_hive', block: 'b_market' }] },
    ],
  }
  const withNpcs = () => {
    const c = baseContent()
    Object.assign(c, NPC_PACK)
    const { game } = makeGame({
      features: [STUBS2, rosterFeature, npcsFeature], content: [{ id: 'roster_npcs', content: c as unknown as ContentPack['content'] }], seed: 7,
      pc: { attrs: { charm: 14 } }, patch: { time: { day: 3, hour: 10, minute: 0 } },
    })
    game.commit(draft([{ op: 'location', to: { district: 'd_hive', block: 'b_market' } }], 'test.go'))
    return game
  }
  const give = (g: G, effects: Rec[]) => {
    const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source: 'builtin' }))
    if (r.errors.length) throw new Error(r.errors.join('；'))
    g.commit(draft(r.changes, 'test.give'))
  }
  // 路數、區、街區是別的功能的內容種類：npcs 一起裝時 STUBS 不能再定義一次 path
  const STUBS2: Feature = { id: 'test_stubs2', install: (k) => { for (const kind of ['district', 'block', 'path']) k.content.defineKind({ kind, owner: 'test', validate: () => [] }) } }

  it('認識行者之後他是角色、身上帶 ext.paths：可以招募、進名冊、召集；街坊認識了也招募不了', () => {
    const g = withNpcs()
    give(g, [{ kind: 'meet', npc: 'npc_ann' }, { kind: 'meet', npc: 'npc_bob' }])
    expect(g.state.actors.npc_ann!.ext.paths).toEqual([{ path: 'p_gun', slot: 'main', tier: 3 }])
    expect(recruitBlock(g.k, g.state, 'npc_ann')).toBeNull()
    expect(recruitBlock(g.k, g.state, 'npc_bob')).toBe('鮑勃不是行者，沒辦法招募（街坊與職員只能同行）。')
    // 親密度是 npcs 的量表：加上去之後 DC 跟著降（16 − 3 + 信譽沒人定義的 3 階差 × 2）
    expect(recruitDc(g.k, g.state, 'npc_ann').dc).toBe(16 + 6)
    give(g, [{ kind: 'affinity', key: 'npc_ann', amount: 30 }])
    expect(recruitDc(g.k, g.state, 'npc_ann').dc).toBe(16 - 3 + 6)
    g.commit(join(g.k, g.state, 'npc_ann'))
    g.commit(muster(g.k, g.state, { party: ['npc_ann'], tagalong: ['npc_bob'] }))
    expect(g.state.party).toEqual(['pc', 'npc_ann'])
    expect(readRoster(g.state).tagalong).toEqual(['npc_bob'])
  })

  it('roster_add 之後候選名單有那個人；還沒認識的人（不是角色）也先記著，認識了才進得了名冊', () => {
    const g = withNpcs()
    give(g, [{ kind: 'roster_add', who: 'npc_ann', source: 'introduced' }])
    expect(candidatesOf(g.state).map((c) => c.who)).toEqual(['npc_ann'])
    expect(joinBlock(g.k, g.state, 'npc_ann')).toBe('查不到 npc_ann 這個角色：要先讓他變成角色才能進名冊。')
    give(g, [{ kind: 'meet', npc: 'npc_ann' }])
    g.commit(join(g.k, g.state, 'npc_ann'))
    expect(loyalty(g as never, 'npc_ann')).toBe(40)
    expect(candidatesOf(g.state)).toEqual([])
  })
})
