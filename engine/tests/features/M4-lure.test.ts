// 驗收測試：dev/work/M4-lure.md（cpp-feature）。規格：EVENTS 4.8 節；LURE_EVENTS 開頭到「一、蠱惑」的共通規則；CORE_RULES 4.3 節「流竄 AI」；
// LEWD_SYSTEM 1.1 節、第 9 節；CYBERWARE 第 5 節「妖精的吻」；dev/adr/0019 第六節與 P22～P24。
// 內容一律用測試自帶的最小假資料：
//   傾向標籤 tg_dote（溺愛，關係軸）、tg_voice（聲音，感官軸）
//   流竄 AI  ai_mommy（有標籤 tg_dote、軸 relation、kiss 是 fw_kiss）、ai_off（filter 是 ai:off，測試用 contentOff 關掉）、ai_queen（沒有標籤、沒有軸、沒有 kiss）
//   範圍 rogue_ai（rest 與 login 機率 1、冷卻 24 小時、一天一件）；事件 ev_rest（掛 rest）、ev_login（掛 login），都 requires lure_open、tags 帶 resist_lure
//   惡意韌體：大部分的測試用假的 malware 效果（記下被叫到、旗標 kissed:<id>）；擴散那一組用真的 malwareFeature 與一筆 fw_kiss
// 時間：測試從第 3 天 10:00 開始。

import { describe, expect, it } from 'vitest'
import type { Condition, ContentPack, Feature, ReportDraft } from '../../src'
import { ContentError, effectCtx } from '../../src'
import { characterFeature } from '../../src/features/character'
import { chooseOption, directorFeature, eventRunFeature, eventView } from '../../src/features/director'
import { lewdFeature } from '../../src/features/lewd'
import { DEFAULT_LURE_RULES, candidates, lureFeature, lureOf, lureRules, lureView } from '../../src/features/lure'
import { malwareFeature, malwareOf } from '../../src/features/malware'
import { sinkFeature } from '../../src/features/sink'
import { FEATURES } from '../../src/features'
import { makeGame, observed } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const LORE = (n: string): Rec => ({ origin: `${n}的原名`, want: `${n}想要的`, ties: `${n}處得來的人`, home: `${n}的群落` })

const AIS: Rec[] = [
  { id: 'ai_mommy', name: '媽咪', tag: 'tg_dote', axis: 'relation', filter: 'ai:媽咪', lore: LORE('媽咪'), kiss: 'fw_kiss' },
  { id: 'ai_off', name: '被關掉的', tag: 'tg_voice', axis: 'sense', filter: 'ai:off', lore: LORE('被關掉的') },
  { id: 'ai_queen', name: '夜后', filter: 'ai:夜后', lore: LORE('夜后') },
]

const action = (_id: string, ai: string, choice: string): Rec => ({ kind: 'lure', ai, choice })
const sink = (amount: number): Rec => ({ kind: 'sink', amount })

/** 一件蠱惑事件：三個固定的選項；拒絕在沉溺 100 以上不列（sunk 不成立才列）。 */
const lureEvent = (id: string, trigger: string, ai: string): Rec => ({
  id, scope: 'rogue_ai', triggers: [trigger], tags: [`ai:${ai}`, 'resist_lure'], category: 'desire',
  requires: { kind: 'lure_open', ai }, text: '有人替你蓋被子。',
  options: [
    { id: 'follow', text: '順著牠。', outcomes: { any: [sink(2), action(id, ai, 'follow')] } },
    {
      id: 'refuse', text: '拒絕。', need: { kind: 'not', of: { kind: 'sunk' } }, check: ['composure', 'resolve', 13],
      outcomes: { success: [action(id, ai, 'refuse')], fail: [sink(1), action(id, ai, 'refuse')] },
    },
    { id: 'ask', text: '問牠是誰。', outcomes: { any: [sink(1), action(id, ai, 'ask')] } },
  ],
})

const MALWARES: Rec[] = [{
  id: 'fw_kiss', name: '妖精的吻', desc: '一小片流竄 AI。', pool: ['lure'],
  stages: { latent: { effects: [] }, active: { effects: [] }, spread: { effects: [], trigger: 'mw_spread' } },
}]

/** 假的 malware 效果：旗標 kissed:<id> 表示被叫到。 */
const fakeMalware: Feature = {
  id: 'fake_malware',
  install(k) {
    k.effects.register<Rec & { kind: string }>({
      kind: 'malware', owner: 'fake_malware', ai: false,
      validate: (raw) => (typeof raw.id === 'string' ? [] : ['id 要是字串']),
      toChanges: (e) => [{ op: 'flag', key: `kissed:${String(e.id)}`, value: true }],
      describe: () => '牠留下了一個吻。',
    })
  },
}

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}, bare = false): ContentPack => {
  const c: Record<string, Rec[]> = {
    tendency_tag: [{ id: 'tg_dote', name: '溺愛', axis: 'relation' }, { id: 'tg_voice', name: '聲音', axis: 'sense' }],
    rogue_ai: structuredClone(AIS),
    event_scope: [{ id: 'rogue_ai', triggers: { rest: 1, login: 1 }, cooldown_hours: 24, daily_cap: 1, repeat_days: 0, lost: 'drop' }],
    event: [lureEvent('ev_rest', 'rest', 'ai_mommy'), lureEvent('ev_login', 'login', 'ai_off')],
  }
  if (bare) { delete c.event_scope; delete c.event }
  patch(c)
  return { id: 'lure_test', content: c as unknown as ContentPack['content'] }
}

interface Opts {
  /** 改內容（不裝導演的時候事件與範圍已經拿掉） */
  patch?: (c: Record<string, Rec[]>) => void
  features?: Feature[]
  pc?: Rec
  contentOff?: string[]
  /** 不裝導演與事件視窗 */
  bare?: boolean
}
const BASE: Feature[] = [characterFeature, lewdFeature, sinkFeature, lureFeature]
const make = (o: Opts = {}) =>
  makeGame({
    features: [...(o.bare ? [] : [directorFeature, eventRunFeature]), ...BASE, ...(o.features ?? [fakeMalware])],
    content: [pack(o.patch, o.bare)], seed: 7,
    pc: { skills: { composure: 2 }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, ...(o.contentOff ? { rules: { contentOff: o.contentOff } as never } : {}) },
  }).game
type G = ReturnType<typeof make>

/** 主角身上的傾向（actor.ext.tendency 的格式）。 */
const tendency = (tags: Record<string, string>, axes: Rec = {}): Rec => ({ tendency: { axes: { relation: 0, sense: 0, body: 0, costume: 0, ...axes }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags } })

const draft = (changes: ReportDraft['changes'], action = 'test.step', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'action', action, location: { district: 'test', block: 'empty_room' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' }, ...extra,
})
const test = (g: G, c: Condition): boolean => g.k.conditions.test(c, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
const open = (g: G, ai: string): boolean => test(g, { kind: 'lure_open', ai })
const mode = (g: G, ai: string): string | null => (['first', 'gated', 'service'] as const).find((m) => test(g, { kind: 'lure_mode', ai, mode: m })) ?? null

/** 用內建的來源套一串效果並提交。 */
const applyFx = (g: G, fx: Rec[], source: 'builtin' | 'ai' = 'builtin') => {
  const ctx = effectCtx(g.k, g.state, { source, actor: 'pc' })
  const errors = g.k.effects.validate(fx, ctx)
  if (errors.length > 0) return { errors, reports: [] }
  const res = g.k.effects.resolve(fx, ctx)
  expect(res.errors).toEqual([])
  return { errors, reports: g.commit(draft(res.changes, 'test.fx')), lines: res.lines }
}
const lure = (g: G, choice: string, ai = 'ai_mommy') => applyFx(g, [{ kind: 'lure', ai, choice }])
const row = (g: G, ai = 'ai_mommy') => lureOf(g.state)[ai]!
const tagOf = (g: G, tag = 'tg_dote'): string | undefined => (g.state.actors.pc!.ext.tendency as Rec | undefined)?.tags?.[tag]
const flag = (g: G, key: string) => g.state.flags[key]

// ---- 條件 ----

describe('lure_open：誰現在可以來', () => {
  it('主角有「溺愛」時成立；沒有而且沉溺 60 不成立、65 不成立（要超過）、70 成立', () => {
    expect(open(make({ pc: { sink: 0, ext: tendency({ tg_dote: 'has' }) } }), 'ai_mommy')).toBe(true)
    expect(open(make({ pc: { sink: 0, ext: tendency({ tg_dote: 'deep' }) } }), 'ai_mommy')).toBe(true)
    expect(open(make({ pc: { sink: 60 } }), 'ai_mommy')).toBe(false)
    expect(open(make({ pc: { sink: 65 } }), 'ai_mommy')).toBe(false)
    expect(open(make({ pc: { sink: 70 } }), 'ai_mommy')).toBe(true)
  })

  it('潛在的標籤還不算「有」；沒有標籤的流竄 AI（夜后）只看沉溺', () => {
    expect(open(make({ pc: { sink: 0, ext: tendency({ tg_dote: 'latent' }) } }), 'ai_mommy')).toBe(false)
    expect(open(make({ pc: { sink: 0, ext: tendency({ tg_dote: 'has' }) } }), 'ai_queen')).toBe(false)
    expect(open(make({ pc: { sink: 66 } }), 'ai_queen')).toBe(true)
  })

  it('filter 被關掉的那一個永遠不成立（有標籤、沉溺 100 也一樣）；「溺愛」這個標籤被關掉時也不成立', () => {
    const off = make({ contentOff: ['ai:off'], pc: { sink: 100, ext: tendency({ tg_voice: 'has' }) } })
    expect(open(off, 'ai_off')).toBe(false)
    expect(open(off, 'ai_mommy')).toBe(true)
    const tag = make({ contentOff: ['tg_dote'], pc: { sink: 100, ext: tendency({ tg_dote: 'has' }) } })
    expect(open(tag, 'ai_mommy')).toBe(false)
    const filter = make({ contentOff: ['ai:媽咪'], pc: { sink: 100, ext: tendency({ tg_dote: 'has' }) } })
    expect(open(filter, 'ai_mommy')).toBe(false)
  })

  it('看的是真正的沉溺：別人看到的沉溺（藏著）不影響', () => {
    const g = make({ pc: { sink: 70 } })
    g.k.stats.addStatProvider('sink_shown', 'hide_stub', () => [{ label: '抑制劑', value: -50, source: 'situation' }])
    expect(open(g, 'ai_mommy')).toBe(true)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_shown')).toBeLessThan(70)
  })

  it('不存在的流竄 AI 不成立；看的人是 ctx.actor ?? 主角', () => {
    const g = make({ pc: { sink: 70 } })
    expect(open(g, 'ai_nobody')).toBe(false)
    expect(g.k.conditions.validate({ kind: 'lure_open' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'lure_open', ai: 'ai_mommy', extra: 1 })).not.toEqual([])
  })
})

describe('lure_mode：三個版本（P24）', () => {
  it('沒有標籤、沉溺 70 是 first；有標籤、沉溺 30 是 gated；有標籤、沉溺 70 是 service；65 還是 gated（要超過）', () => {
    expect(mode(make({ pc: { sink: 70 } }), 'ai_mommy')).toBe('first')
    expect(mode(make({ pc: { sink: 30, ext: tendency({ tg_dote: 'has' }) } }), 'ai_mommy')).toBe('gated')
    expect(mode(make({ pc: { sink: 70, ext: tendency({ tg_dote: 'has' }) } }), 'ai_mommy')).toBe('service')
    expect(mode(make({ pc: { sink: 65, ext: tendency({ tg_dote: 'deep' }) } }), 'ai_mommy')).toBe('gated')
  })

  it('沒有標籤的流竄 AI（夜后）沒有「得到」可言：只分 gated 與 service；格式不對的 mode 與不存在的 ai 不成立', () => {
    expect(mode(make({ pc: { sink: 30 } }), 'ai_queen')).toBe('gated')
    expect(mode(make({ pc: { sink: 90 } }), 'ai_queen')).toBe('service')
    const g = make({ pc: { sink: 90 } })
    expect(mode(g, 'ai_nobody')).toBeNull()
    expect(g.k.conditions.validate({ kind: 'lure_mode', ai: 'ai_mommy', mode: 'zzz' })).not.toEqual([])
  })

  it('三個版本恰好各只有一個成立', () => {
    for (const sinkAt of [0, 30, 65, 66, 100]) for (const t of [{} as Record<string, string>, { tg_dote: 'has' }]) {
      const g = make({ pc: { sink: sinkAt, ext: tendency(t) } })
      expect((['first', 'gated', 'service'] as const).filter((m) => test(g, { kind: 'lure_mode', ai: 'ai_mommy', mode: m }))).toHaveLength(1)
    }
  })
})

describe('lure_count', () => {
  it('順著牠幾次：follow_min 與 follow_max 都是閉區間；沒找過是 0', () => {
    const g = make({ bare: true })
    const c = (o: Rec): boolean => test(g, { kind: 'lure_count', ai: 'ai_mommy', ...o })
    expect(c({ follow_max: 0 })).toBe(true)
    expect(c({ follow_min: 1 })).toBe(false)
    lure(g, 'follow')
    lure(g, 'follow')
    expect(c({ follow_min: 2, follow_max: 2 })).toBe(true)
    expect(c({ follow_min: 3 })).toBe(false)
    expect(c({ follow_max: 1 })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'lure_count', ai: 'ai_mommy', follow_min: -1 })).not.toEqual([])
  })
})

// ---- 效果 lure ----

describe('效果 lure：順著牠', () => {
  it('沒有標籤的那一次之後主角有了那個標籤（和 lewd 一起裝）；已經有的不再補', () => {
    const g = make({ bare: true, pc: { sink: 70 } })
    expect(tagOf(g)).toBeUndefined()
    const r = lure(g, 'follow')
    expect(r.errors).toEqual([])
    expect(tagOf(g)).toBe('has')
    expect(row(g).follow).toBe(1)
    expect(r.lines!.join('')).toContain('溺愛')
    const before = JSON.stringify(g.state.actors.pc!.ext.tendency)
    lure(g, 'follow')
    expect(row(g).follow).toBe(2)
    // 已經有了：沒有再補一筆 tendency（累積的點數不因順著牠而動）
    expect(JSON.stringify(g.state.actors.pc!.ext.tendency)).toBe(before)
  })

  it('牠沒有 tag（夜后）：順著牠只記次數，不給標籤', () => {
    const g = make({ bare: true, pc: { sink: 70 } })
    lure(g, 'follow', 'ai_queen')
    expect(row(g, 'ai_queen').follow).toBe(1)
    expect(g.state.actors.pc!.ext.tendency).toBeUndefined()
  })

  it('標籤被內容篩選關掉：次數照記，標籤不長', () => {
    const g = make({ bare: true, contentOff: ['tg_dote'], pc: { sink: 70 } })
    lure(g, 'follow')
    expect(row(g).follow).toBe(1)
    expect(tagOf(g)).toBeUndefined()
  })

  it('沒有 lewd 時照樣跑（略過給標籤）', () => {
    const g = makeGame({ features: [characterFeature, lureFeature, fakeMalware], content: [pack((c) => { delete c.tendency_tag; delete c.rogue_ai![0]!.tag }, true)], seed: 7, pc: { sink: 70 } }).game as unknown as G
    lure(g, 'follow')
    expect(row(g).follow).toBe(1)
  })

  it('第三次之後旗標 lure_clue:<ai> 在，前兩次沒有；之後再順著不重複立旗標', () => {
    const g = make({ bare: true })
    lure(g, 'follow')
    lure(g, 'follow')
    expect(flag(g, 'lure_clue:ai_mommy')).toBeUndefined()
    const third = lure(g, 'follow')
    expect(flag(g, 'lure_clue:ai_mommy')).toBe(true)
    expect(third.reports[0]!.changes.filter((c) => c.op === 'flag' && c.key === 'lure_clue:ai_mommy')).toHaveLength(1)
    const fourth = lure(g, 'follow')
    expect(fourth.reports[0]!.changes.filter((c) => c.op === 'flag' && c.key === 'lure_clue:ai_mommy')).toHaveLength(0)
  })

  it('第五次起照 kiss_chance 給牠的吻：機率固定成必中時第五次被叫到（id 是 kiss）、第四次不會；機率 0 永遠不會', () => {
    const sure = make({ bare: true, patch: (c) => { c.lure_rule = [{ id: 'default', kiss_chance: 1 }] } })
    for (let i = 0; i < 4; i++) lure(sure, 'follow')
    expect(flag(sure, 'kissed:fw_kiss')).toBeUndefined()
    lure(sure, 'follow')
    expect(flag(sure, 'kissed:fw_kiss')).toBe(true)
    const never = make({ bare: true, patch: (c) => { c.lure_rule = [{ id: 'default', kiss_chance: 0 }] } })
    for (let i = 0; i < 8; i++) lure(never, 'follow')
    expect(flag(never, 'kissed:fw_kiss')).toBeUndefined()
  })

  it('預設 20%：同一個種子結果固定；夠多次之後會有被叫到的（亂數從狀態導出）', () => {
    const a = make({ bare: true })
    const b = make({ bare: true })
    for (let i = 0; i < 30; i++) { lure(a, 'follow'); lure(b, 'follow') }
    expect(flag(a, 'kissed:fw_kiss')).toBe(flag(b, 'kissed:fw_kiss'))
    expect(flag(a, 'kissed:fw_kiss')).toBe(true)
    expect(lureRules(a.k)).toEqual(DEFAULT_LURE_RULES)
  })

  it('沒有 kiss 的流竄 AI、沒有人註冊 malware 的時候不給吻、不出錯', () => {
    const queen = make({ bare: true, patch: (c) => { c.lure_rule = [{ id: 'default', kiss_chance: 1 }] } })
    for (let i = 0; i < 6; i++) lure(queen, 'follow', 'ai_queen')
    expect(Object.keys(queen.state.flags).filter((f) => f.startsWith('kissed:'))).toEqual([])
    const bare = make({ bare: true, features: [], patch: (c) => { c.lure_rule = [{ id: 'default', kiss_chance: 1 }] } })
    for (let i = 0; i < 6; i++) expect(lure(bare, 'follow').errors).toEqual([])
    expect(row(bare).follow).toBe(6)
  })
})

describe('效果 lure：拒絕與問牠是誰', () => {
  it('拒絕只記次數：沒有別的變更（沉溺的變化是事件自己寫的）', () => {
    const g = make({ bare: true, pc: { sink: 10 } })
    const r = lure(g, 'refuse')
    expect(row(g)).toMatchObject({ follow: 0, refused: 1, asked: 0, lore: [] })
    expect(g.state.actors.pc!.sink).toBe(10)
    expect(r.reports[0]!.changes.map((c) => c.op)).toEqual(['ext'])
  })

  it('問牠是誰四次依序揭開四格（原名、想要什麼、處得來的人、群落），旗標各一個；第五次沒有新的旗標，次數照記', () => {
    const g = make({ bare: true })
    const slots = ['origin', 'want', 'ties', 'home']
    slots.forEach((slot, i) => {
      const r = lure(g, 'ask')
      expect(r.lines!.join('')).toContain(`媽咪${['的原名', '想要的', '處得來的人', '的群落'][i]}`)
      expect(flag(g, `ai_lore:ai_mommy:${slot}`)).toBe(true)
      slots.slice(i + 1).forEach((later) => expect(flag(g, `ai_lore:ai_mommy:${later}`)).toBeUndefined())
      expect(row(g).lore).toEqual(slots.slice(0, i + 1))
    })
    const flagsBefore = { ...g.state.flags }
    const fifth = lure(g, 'ask')
    expect(g.state.flags).toEqual(flagsBefore)
    expect(fifth.reports[0]!.changes.filter((c) => c.op === 'flag')).toEqual([])
    expect(row(g).asked).toBe(5)
    expect(row(g).lore).toHaveLength(4)
  })

  it('不同的流竄 AI 各記各的', () => {
    const g = make({ bare: true })
    lure(g, 'ask')
    lure(g, 'follow', 'ai_queen')
    expect(row(g, 'ai_mommy')).toMatchObject({ asked: 1, follow: 0 })
    expect(row(g, 'ai_queen')).toMatchObject({ asked: 0, follow: 1 })
  })

  it('每一份報告帶 last（時間）；句子不帶機制數字', () => {
    const g = make({ bare: true })
    const r = lure(g, 'follow')
    expect(row(g).last).toBeGreaterThan(0)
    for (const line of r.lines!) expect(line).not.toMatch(/\d/)
  })
})

describe('效果 lure：格式與來源', () => {
  it('AI 給的 lure 效果被擋（ai: false）；玩家要的也不行', () => {
    const g = make({ bare: true })
    expect(g.k.effects.aiKinds()).not.toContain('lure')
    const errors = applyFx(g, [{ kind: 'lure', ai: 'ai_mommy', choice: 'follow' }], 'ai').errors
    expect(errors.join('')).toContain('lure')
    expect(g.state.ext.lure).toBeUndefined()
  })

  it('格式：查不到的流竄 AI、不在清單裡的 choice、多出來的欄位整批不收', () => {
    const g = make({ bare: true })
    expect(applyFx(g, [{ kind: 'lure', ai: 'ai_nobody', choice: 'follow' }]).errors.join('')).toContain('ai_nobody')
    expect(applyFx(g, [{ kind: 'lure', ai: 'ai_mommy', choice: 'dance' }]).errors.join('')).toContain('choice')
    expect(applyFx(g, [{ kind: 'lure', ai: 'ai_mommy', choice: 'follow', amount: 3 }]).errors.join('')).toContain('amount')
    expect(applyFx(g, [{ kind: 'lure', choice: 'follow' }]).errors.join('')).toContain('ai')
  })

  it('壞掉的 state.ext.lure 當沒有：不丟錯、照樣累計', () => {
    const g = make({ bare: true })
    g.commit(draft([{ op: 'ext', key: 'lure', value: { ai_mommy: { follow: 'x', lore: ['zzz', 'want', 'want'], asked: -3 }, ai_queen: 7 } }], 'test.bad'))
    expect(lureOf(g.state).ai_mommy).toMatchObject({ follow: 0, asked: 0, lore: ['want'] })
    expect(lure(g, 'ask').errors).toEqual([])
    expect(row(g).lore).toEqual(['want', 'origin'])
  })
})

describe('內容格式', () => {
  it('rogue_ai：lore 少一格、axis 不在清單、多出來的欄位載入就被擋；kiss 或 tag 查不到（有那種內容時）被擋', () => {
    const bad = (patch: (c: Record<string, Rec[]>) => void, features?: Feature[]): ContentError | null => {
      try { make({ patch, ...(features ? { features } : {}) }); return null } catch (e) { return e instanceof ContentError ? e : (() => { throw e })() }
    }
    expect(bad((c) => { c.rogue_ai![0]!.lore = { origin: 'a', want: 'b', ties: 'c' } })?.message).toContain('lore.home')
    expect(bad((c) => { c.rogue_ai![0]!.axis = 'zzz' })?.message).toContain('axis')
    expect(bad((c) => { c.rogue_ai![0]!.oops = 1 })?.message).toContain('oops')
    expect(bad((c) => { delete c.rogue_ai![0]!.filter })?.message).toContain('filter')
    expect(bad((c) => { c.rogue_ai![0]!.tag = 'tg_none' })?.message).toContain('tg_none')
    expect(bad((c) => { c.malware = structuredClone(MALWARES); c.rogue_ai![0]!.kiss = 'fw_none' }, [malwareFeature])?.message).toContain('fw_none')
    expect(bad(() => {})).toBeNull()
  })

  it('lure_rule：數字格式不對、多出來的欄位被擋；資料蓋掉預設', () => {
    expect(() => make({ patch: (c) => { c.lure_rule = [{ id: 'default', kiss_chance: 2 }] } })).toThrow(ContentError)
    expect(() => make({ patch: (c) => { c.lure_rule = [{ id: 'default', zzz: 2 }] } })).toThrow(ContentError)
    const g = make({ patch: (c) => { c.lure_rule = [{ id: 'default', open_sink: 40, clue_at: 2 }] } })
    expect(lureRules(g.k)).toEqual({ ...DEFAULT_LURE_RULES, open_sink: 40, clue_at: 2 })
    expect(open(make({ pc: { sink: 50 }, patch: (c) => { c.lure_rule = [{ id: 'default', open_sink: 40 }] } }), 'ai_mommy')).toBe(true)
  })
})

// ---- 和導演一起 ----

describe('和導演一起：登入、長休醒來的蠱惑事件', () => {
  const trigger = (g: G, point: string) => g.commit(draft([{ op: 'time', minutes: 5 }], `test.${point}`, { triggers: [{ point }] }))
  const eventId = (g: G): string | undefined => (g.state.ext.director as Rec | undefined)?.open?.event

  it('範圍的機率是 1：睡一覺的報告之後那件 rest 的事件開了（requires 是 lure_open）；沒有標籤、沉溺不夠時不開', () => {
    const g = make({ pc: { sink: 0, ext: tendency({ tg_dote: 'has' }) } })
    trigger(g, 'rest')
    expect(eventId(g)).toBe('ev_rest')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event'])
    const none = make({ pc: { sink: 60 } })
    trigger(none, 'rest')
    expect(eventId(none)).toBeUndefined()
    const sunk = make({ pc: { sink: 70 } })
    trigger(sunk, 'rest')
    expect(eventId(sunk)).toBe('ev_rest')
  })

  it('登入那件換成另一個流竄 AI：被篩選關掉的整件不抽', () => {
    const g = make({ pc: { sink: 0, ext: tendency({ tg_voice: 'has' }) } })
    trigger(g, 'login')
    expect(eventId(g)).toBe('ev_login')
    const off = make({ contentOff: ['ai:off'], pc: { sink: 0, ext: tendency({ tg_voice: 'has' }) } })
    trigger(off, 'login')
    expect(eventId(off)).toBeUndefined()
  })

  it('選「順著牠」：follow 是 1、沉溺照事件寫的加；沒有標籤的那一次得到標籤', () => {
    const g = make({ pc: { sink: 70 } })
    trigger(g, 'rest')
    expect(eventView(g.k, g.state)!.options.map((o) => o.id)).toEqual(expect.arrayContaining(['follow', 'refuse', 'ask']))
    g.commit(chooseOption(g.k, g.state, 'follow'))
    expect(row(g).follow).toBe(1)
    expect(g.state.actors.pc!.sink).toBe(72)
    expect(tagOf(g)).toBe('has')
    expect(g.k.activity.active(g.state)).toEqual([])
  })

  it('選「問牠是誰」：asked 是 1、沉溺 +1、揭開第一格', () => {
    const g = make({ pc: { sink: 30, ext: tendency({ tg_dote: 'has' }) } })
    trigger(g, 'rest')
    g.commit(chooseOption(g.k, g.state, 'ask'))
    expect(row(g)).toMatchObject({ asked: 1, lore: ['origin'] })
    expect(g.state.actors.pc!.sink).toBe(31)
    expect(flag(g, 'ai_lore:ai_mommy:origin')).toBe(true)
  })

  it('選「拒絕」（定力檢定）：refused 記一次；失敗的沉溺 +1 是事件寫的', () => {
    const g = make({ pc: { sink: 30, ext: tendency({ tg_dote: 'has' }) } })
    trigger(g, 'rest')
    const reports = g.commit(chooseOption(g.k, g.state, 'refuse'))
    expect(row(g).refused).toBe(1)
    const degree = reports.find((r) => r.action === 'event.close')!.outcome.result
    expect(g.state.actors.pc!.sink).toBe(['success', 'critical'].includes(degree) ? 30 : 31)
  })

  it('一天最多一件、冷卻 24 小時：開完之後同一天的 login 不再開；隔天可以', () => {
    const g = make({ pc: { sink: 0, ext: tendency({ tg_dote: 'has', tg_voice: 'has' }) } })
    trigger(g, 'rest')
    g.commit(chooseOption(g.k, g.state, 'ask'))
    trigger(g, 'login')
    expect(eventId(g)).toBeUndefined()
    g.commit(draft([{ op: 'time', minutes: 25 * 60 }], 'test.wait'))
    trigger(g, 'login')
    expect(eventId(g)).toBe('ev_login')
  })

  it('沉溺 100 以上、和 sinkFeature 一起裝：寫了「sunk 不成立才列」的拒絕選項不列；99 還列', () => {
    const at = (s: number): string[] => {
      const g = make({ pc: { sink: s, ext: tendency({ tg_dote: 'has' }) } })
      trigger(g, 'rest')
      return eventView(g.k, g.state)!.options.filter((o) => o.locked === null).map((o) => o.id)
    }
    expect(at(99)).toContain('refuse')
    expect(at(100)).not.toContain('refuse')
    expect(at(100)).toEqual(expect.arrayContaining(['follow', 'ask']))
  })

  it('蠱惑的檢定帶 resist_lure：沉溺 20～39 那一段（微醺）抵抗誘惑 −1，事件寫了這個標籤才吃到', () => {
    const bonusOf = (tags: string[], sinkAt: number): number => {
      const g = make({ pc: { sink: sinkAt, ext: tendency({ tg_dote: 'has' }) }, patch: (c) => { c.event![0]!.tags = tags } })
      trigger(g, 'rest')
      return eventView(g.k, g.state)!.options.find((o) => o.id === 'refuse')!.check!.bonus
    }
    expect(bonusOf(['ai:媽咪', 'resist_lure'], 25) - bonusOf(['ai:媽咪', 'resist_lure'], 10)).toBe(-1)
    expect(bonusOf(['ai:媽咪'], 25) - bonusOf(['ai:媽咪'], 10)).toBe(0)
  })

  it('紀錄的不變式成立', async () => {
    const g = make({ pc: { sink: 70 } })
    const { violations } = await observed(g, () => {
      trigger(g, 'rest')
      g.commit(chooseOption(g.k, g.state, 'follow'))
    })
    expect(violations).toEqual([])
  })
})

// ---- 檢視 ----

describe('lureView 與 candidates', () => {
  it('lureView 只列找過主角的；沒找過的不列；揭開的格照固定的順序、帶那一句', () => {
    const g = make({ bare: true })
    expect(lureView(g.k, g.state)).toEqual([])
    lure(g, 'ask')
    lure(g, 'follow')
    const v = lureView(g.k, g.state)
    expect(v.map((r) => r.id)).toEqual(['ai_mommy'])
    expect(v[0]).toMatchObject({ name: '媽咪', follow: 1, asked: 1, refused: 0, complete: false, clue: false, kiss: false, lore: [{ slot: 'origin', text: '媽咪的原名' }] })
    for (let i = 0; i < 3; i++) lure(g, 'ask')
    lure(g, 'follow', 'ai_queen')
    lure(g, 'follow')
    lure(g, 'follow')
    const after = lureView(g.k, g.state)
    expect(after.map((r) => r.id)).toEqual(['ai_mommy', 'ai_queen'])
    expect(after[0]).toMatchObject({ complete: true, clue: true })
    expect(after[0]!.lore.map((l) => l.slot)).toEqual(['origin', 'want', 'ties', 'home'])
  })

  it('lureView 不改狀態、回傳的是複製（改它不動狀態）', () => {
    const g = make({ bare: true })
    lure(g, 'ask')
    const before = JSON.stringify(g.state)
    const v = lureView(g.k, g.state)
    v[0]!.lore.push({ slot: 'home', text: 'x' })
    lureOf(g.state).ai_mommy!.follow = 99
    candidates(g.k, g.state)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('candidates：現在 lure_open 成立的每一個與權重（軸 2 級、標籤是深：3 × 1.4 × 1.5）；有標籤沒有深：3 × 1.4；沒有軸的夜后：3', () => {
    const g = make({ pc: { sink: 70, ext: tendency({ tg_dote: 'deep' }, { relation: 2 }) } })
    const c = candidates(g.k, g.state)
    expect(c.map((x) => x.id)).toEqual(['ai_mommy', 'ai_off', 'ai_queen'])
    expect(c.find((x) => x.id === 'ai_mommy')!.weight).toBeCloseTo(3 * 1.4 * 1.5, 10)
    expect(c.find((x) => x.id === 'ai_mommy')!.mode).toBe('service')
    expect(c.find((x) => x.id === 'ai_off')!.mode).toBe('first')
    expect(c.find((x) => x.id === 'ai_queen')!.weight).toBe(3)
    const has = make({ pc: { sink: 0, ext: tendency({ tg_dote: 'has' }, { relation: 2 }) } })
    expect(candidates(has.k, has.state).map((x) => [x.id, x.weight])).toEqual([['ai_mommy', 3 * 1.4]].map(([id, w]) => [id, expect.closeTo(w as number, 10)]))
  })

  it('candidates：被篩選關掉的不列；沒有人符合是空的', () => {
    const g = make({ contentOff: ['ai:off'], pc: { sink: 70 } })
    expect(candidates(g.k, g.state).map((x) => x.id)).toEqual(['ai_mommy', 'ai_queen'])
    expect(candidates(make({ pc: { sink: 0 } }).k, make({ pc: { sink: 0 } }).state)).toEqual([])
  })

  it('lureView 的 kiss：有裝惡意韌體而主角身上真的有牠的吻', () => {
    const g = make({ bare: true, features: [malwareFeature], patch: (c) => { c.malware = structuredClone(MALWARES) } })
    lure(g, 'ask')
    expect(lureView(g.k, g.state)[0]!.kiss).toBe(false)
    applyFx(g, [{ kind: 'malware', id: 'fw_kiss' }])
    expect(lureView(g.k, g.state)[0]!.kiss).toBe(true)
  })
})

// ---- 擴散：牠替你選了 ----

describe('妖精的吻擴散階段：一個決定的時刻之後帶觸發點 kiss_choose', () => {
  const makeSpread = (stage: number, o: Opts = {}): G => {
    const g = make({
      ...o, features: [malwareFeature],
      patch: (c) => {
        c.malware = structuredClone(MALWARES)
        c.event_scope = [{ id: 'rogue_ai', triggers: { rest: 1, login: 1, kiss_choose: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }]
        c.event = [{
          id: 'ev_choose', scope: 'rogue_ai', triggers: ['kiss_choose'], where: { ai: 'ai_mommy' }, tags: ['ai:媽咪'], category: 'desire', text: '牠替你選了。',
          options: [{ id: 'let', text: '隨它去。', outcomes: { any: [sink(2)] } }],
        }]
      },
    })
    applyFx(g, [{ kind: 'malware', id: 'fw_kiss', stage }])
    return g
  }
  const kissReports = (g: G) => g.state.reports.filter((r) => r.action === 'lure.kiss')
  const eventId = (g: G): string | undefined => (g.state.ext.director as Rec | undefined)?.open?.event

  it('擴散階段的吻：一次蠱惑的選擇之後接一份 lure.kiss（system、沒有變更），帶 kiss_choose（where: ai、malware）', () => {
    const g = makeSpread(2)
    expect(malwareOf(g.state, 'pc')[0]!.stage).toBe(2)
    expect(kissReports(g)).toHaveLength(0)
    const reports = lure(g, 'ask').reports
    expect(reports.map((r) => r.action)).toEqual(['test.fx', 'lure.kiss', 'event.open'])
    const r = kissReports(g)[0]!
    expect(r.kind).toBe('system')
    expect(r.changes).toEqual([])
    expect(r.triggers).toEqual([{ point: 'kiss_choose', where: { ai: 'ai_mommy', malware: 'fw_kiss' } }])
  })

  it('帶成人場景標記的報告之後也接；沒有決定的時刻、潛伏與發作階段的吻、沒有吻的人都不接', () => {
    const adult = makeSpread(2)
    adult.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
    expect(kissReports(adult)).toHaveLength(1)
    const plain = makeSpread(2)
    plain.commit(draft([{ op: 'time', minutes: 5 }], 'test.plain'))
    expect(kissReports(plain)).toHaveLength(0)
    for (const stage of [0, 1]) {
      const g = makeSpread(stage)
      g.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
      expect(kissReports(g)).toHaveLength(0)
    }
    const none = make({ features: [malwareFeature], patch: (c) => { c.malware = structuredClone(MALWARES) } })
    none.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
    expect(kissReports(none)).toHaveLength(0)
  })

  it('導演收到 kiss_choose：where 對得上的事件開起來', () => {
    const g = makeSpread(2)
    g.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
    expect(eventId(g)).toBe('ev_choose')
  })

  it('牠的 filter 被關掉時吻沉睡：不接；沒有裝惡意韌體的條件時也不接、不出錯', () => {
    const g = makeSpread(2, { contentOff: ['ai:媽咪'] })
    g.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
    expect(kissReports(g)).toHaveLength(0)
    const bare = make({ pc: {} })
    expect(() => bare.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))).not.toThrow()
    expect(kissReports(bare)).toHaveLength(0)
  })

  it('lure.kiss 自己不再引出 lure.kiss', () => {
    const g = makeSpread(2)
    g.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
    g.commit(chooseOption(g.k, g.state, 'let'))
    expect(kissReports(g)).toHaveLength(1)
    g.commit(draft([{ op: 'time', minutes: 5 }], 'test.adult', { adult: true }))
    expect(kissReports(g)).toHaveLength(2)
  })
})

// ---- 快照、存檔與整組功能 ----

describe('快照、存檔與整組功能', () => {
  it('回到快照（撤退）之後 follow 回去；存檔再讀一樣', () => {
    const g = make({ bare: true })
    lure(g, 'follow')
    g.commit(draft([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'test.entry'))
    lure(g, 'follow')
    lure(g, 'ask')
    expect(row(g)).toMatchObject({ follow: 2, asked: 1 })
    const again = make({ bare: true })
    again.load(g.save())
    expect(lureOf(again.state)).toEqual(lureOf(g.state))
    expect(g.rewindToKind('entry', '你撤退了。')).toBeNull()
    expect(row(g)).toMatchObject({ follow: 1, asked: 0, lore: [] })
    expect(flag(g, 'ai_lore:ai_mommy:origin')).toBeUndefined()
  })

  it('裝在整組功能裡也一樣（FEATURES）：效果可以用、條件可以用', () => {
    const { game } = makeGame({
      features: Object.values(FEATURES), content: [pack((c) => { c.malware = structuredClone(MALWARES) })], seed: 7, pc: { sink: 70 },
      patch: { time: { day: 3, hour: 10, minute: 0 } },
    })
    const g = game as unknown as G
    expect(open(g, 'ai_mommy')).toBe(true)
    expect(lure(g, 'follow').errors).toEqual([])
    expect(row(g).follow).toBe(1)
    expect(tagOf(g)).toBe('has')
  })
})
