// 白箱：M2 引擎修正批（dev/work/M2-fix-review.md；commit a586efa、033f085、d7b4842；不變式第 115～127 條）。
// 覆蓋率對照的是這一批新寫的那幾行（git diff 53d44aa..HEAD -- engine/src）：沒走到的分支、格式檢查的錯誤路徑、退路（沒有人登記、查不到）。
// 會失敗的兩條（W014、W015）在 tests/pending/W014-W015-fix-review.test.ts，不在這裡。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { attachActivityEnd, clone, compareNatural, compareText, endActivity, isRecord, meterOf } from '../../src'
import { STRONG_PC, makeCityGame, makeGame, makeWorldGame } from '../../src/testkit'
import { chooseBranch, chooseFace, readRun } from '../../src/features/commission'
import { buildCreationReport } from '../../src/features/creation'
import type { CreationDraft } from '../../src/features/creation'
import { directorOf, eligibleEvents, scopeOf } from '../../src/features/director'
import { accept, fixerFeature, go } from '../../src/features/fixer'
import type { Offer } from '../../src/features/fixer'
import { breathDraft, sleepDraft } from '../../src/features/rest'
import { maxHpOf } from '../../src/features/rest/model'
import { originRosterDrafts, readRoster } from '../../src/features/roster'
import { securityFeature } from '../../src/features/security'
import { arrive } from '../../src/features/world'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 建議 1：排序不看語系（core/util/compare.ts）
// ===================================================================================================================

describe('建議 1（dev/adr/0017 M2 修正批 10；EVENTS 3.2 節「回退之後重來會得到同樣的結果」、不變式第 5 條）：compareText／compareNatural', () => {
  it('空字串：比任何非空的都小，兩個空字串相等（match 回 null 的退路）', () => {
    expect(compareNatural('', '')).toBe(0)
    expect(compareNatural('', 'a')).toBe(-1)
    expect(compareNatural('a', '')).toBe(1)
    expect(compareNatural('', '0')).toBe(-1)
  })

  it('數字位數一樣時照大小：u3 在 u2 後面、u10 在 u09 後面', () => {
    expect(compareNatural('u3', 'u2')).toBe(1)
    expect(compareNatural('u2', 'u3')).toBe(-1)
    expect(compareNatural('u10', 'u09')).toBe(1)
  })

  it('是全序：反對稱、遞移、只有一樣的字串比出 0（Array.sort 的結果才和輸入的順序無關）', () => {
    const s = fc.stringMatching(/^[a-c0-9_.\-]{0,6}$/)
    const sign = (n: number): number => Math.sign(n) || 0
    for (const cmp of [compareNatural, compareText]) {
      fc.assert(fc.property(s, s, s, (a, b, c) => {
        expect(sign(cmp(a, b))).toBe(-sign(cmp(b, a)) || 0)
        expect(cmp(a, b) === 0).toBe(a === b)
        if (cmp(a, b) < 0 && cmp(b, c) < 0) expect(cmp(a, c)).toBeLessThan(0)
      }), { numRuns: 3000, seed: 115 })
    }
  })

  it('同一組 id 不管一開始怎麼排，排完都一樣', () => {
    const ids = ['u10', 'u2', 'u01', 'u1', 'ch1', 'h1', 'a', 'a0', 'a-1', 'b_2']
    const want = [...ids].sort(compareNatural)
    fc.assert(fc.property(fc.shuffledSubarray(ids, { minLength: ids.length }), (xs) => {
      expect([...xs].sort(compareNatural)).toEqual(want)
    }), { numRuns: 200, seed: 116 })
  })
})

// ===================================================================================================================
// 應修 3：導演的範圍格式與「同一件委託不重複」（features/director/model.ts）
// ===================================================================================================================

describe('應修 3（EVENTS 3.3 節「同一件委託不重複」、3.1 節壓力條）：範圍格式與讀存檔的退路', () => {
  it('events_as 的形狀不對（不是物件、值不是文字）：寫出原因；triggers 不是物件時不再逐條對照', () => {
    const { game: g } = makeWorldGame({ seed: 5 })
    const v = (e: Rec) => g.k.content.validate('event_scope', [{ id: 's_x', triggers: { stage: 1, pressure: 1 }, ...e }]).join('；')
    expect(v({ events_as: 'stage' })).toMatch(/events_as 要是/)
    expect(v({ events_as: { pressure: 3 } })).toMatch(/events_as 要是/)
    expect(v({ events_as: { pressure: '' } })).toMatch(/events_as 要是/)
    const bad = g.k.content.validate('event_scope', [{ id: 's_x', triggers: 'stage', events_as: { pressure: 'stage' } }]).join('；')
    expect(bad).not.toMatch(/events_as/)
  })

  it('讀存檔：in_commission 的形狀不對就整份丟掉（不讓壞掉的記錄擋住事件）；形狀對的照讀', () => {
    const base = { ext: {} } as Pick<GameState, 'ext'>
    for (const bad of ['x', { id: '', events: [] }, { id: 'cm', events: 'ev_a' }, { id: 'cm', events: [1] }, { events: ['ev_a'] }]) {
      expect(directorOf({ ...base, ext: { director: { in_commission: bad } } }).in_commission, JSON.stringify(bad)).toBeUndefined()
    }
    expect(directorOf({ ...base, ext: { director: { in_commission: { id: 'cm', events: ['ev_a'] } } } }).in_commission).toEqual({ id: 'cm', events: ['ev_a'] })
  })

  it('記錄是別件委託的：不擋現在這件的事件（「換了一件委託就從頭記」）', () => {
    const scope = { id: 'commission', triggers: { stage: 1, pressure: 1 }, events_as: { pressure: 'stage' }, priority: 1, in_commission: true, unique_in_commission: true, lost: 'drop' }
    const pack: ContentPack = { id: 'wb_cm', content: { event_scope: [scope], event: [{ id: 'ev_a', scope: 'commission', triggers: ['stage'], blocking: false, text: '小插曲。', effects: [] }] } as unknown as ContentPack['content'] }
    const { game: g } = makeWorldGame({ seed: 5, pc: STRONG_PC, content: [pack], patch: { time: { day: 3, hour: 10, minute: 0 } } })
    g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'wb', ref: 'cm_tw_office' })
    g.commit(chooseFace(g.k, g.state, 'meat'))
    expect(directorOf(g.state).in_commission).toEqual({ id: 'cm_tw_office', events: ['ev_a'] })
    const sc = scopeOf(g.k, 'commission')!
    // 同一件：stage 與 pressure（events_as 對到 stage）都不再給 ev_a
    expect(eligibleEvents(g.k, g.state, sc, 'stage').map((e) => e.id)).toEqual([])
    expect(eligibleEvents(g.k, g.state, sc, 'pressure').map((e) => e.id)).toEqual([])
    // 記錄是另一件委託的
    const other = clone(g.state)
    ;(other.ext.director as Rec).in_commission = { id: 'cm_other', events: ['ev_a'] }
    expect(eligibleEvents(g.k, other, sc, 'stage').map((e) => e.id)).toEqual(['ev_a'])
    // 範圍沒寫 unique_in_commission：記錄不管用
    expect(eligibleEvents(g.k, g.state, { ...sc, unique_in_commission: false }, 'stage').map((e) => e.id)).toEqual(['ev_a'])
  })
})

// ===================================================================================================================
// 應修 5、7：中間人的後台、委託人的好感、目標勢力的敵對值（features/fixer）
// ===================================================================================================================

const faces = (names: string[]): Rec => Object.fromEntries(names.map((f) => [f, {}]))
const offer = (id: string, extra: Rec = {}): Offer => ({
  id, title: `${id} 的委託`, brief: `簡報：${id}。`, reward: 2000, unknowns: [],
  commission: {
    id: `cm_${id}`, name: `委託 ${id}`, kind: 'steal_item', main: 'meat', scale: 'small', grade: 1, target_faction: 'f_gang', district: 'd_x',
    stages: [{ faces: faces(['meat']) }, { faces: faces(['meat']) }, { faces: faces(['meat']) }], ...extra,
  },
}) as unknown as Offer
const FACTIONS = [{ id: 'f_gang', name: '野良幫', short: '野良', class: 'street' }, { id: 'f_corp', name: '緋櫻', short: '緋櫻', class: 'corp' }]
const fixerPack = (fixers: Rec[], extra: Rec = {}): ContentPack => ({
  id: 'wb_fixer',
  content: { faction: FACTIONS, npc: [{ id: 'npc_mama', name: '媽媽桑' }], fixer: fixers, ...extra } as unknown as ContentPack['content'],
})
const FX = { id: 'fx_a', name: '媽媽桑', npc: 'npc_mama', district: 'd_x', kinds: ['steal_item'], cut: 0.1 }
const OFFERS: Offer[] = [
  offer('o_none_target', { target_faction: 'none' }),
  offer('o_blank_employer', { employer: '   ' }),
  offer('o_none_employer', { employer: 'none' }),
  offer('o_employer', { employer: 'f_corp' }),
]
const OFFER_FEATURE: Feature = { id: 'wb_offers', install(k: Kernel) { k.hooks.on('fixer.offers', 'wb_offers', () => structuredClone(OFFERS)) } }
const CM_STUB: Feature = {
  id: 'cm_stub',
  install(k: Kernel) {
    k.activity.define({
      kind: 'commission', owner: 'cm_stub', order: 90,
      active: (st) => (isRecord(st.ext.cm_stub) ? { id: 'cm', label: '副本' } : null),
      allow: ['stub.', 'commit:stub.'], reason: () => '副本進行中。',
      start: (_k, st, setup, origin) => [{
        kind: 'gig', action: 'stub.enter', location: { ...st.location }, party: [], timeline: [],
        changes: [{ op: 'snapshot.take', kind: 'entry', label: '進入副本前' }, { op: 'ext', key: 'cm_stub', value: { setup, origin } }], outcome: { result: 'entered', summary: '進了副本。' },
      }],
    })
  },
}
function fixerGame(extra: ContentPack[] = []) {
  return makeGame({ features: [securityFeature, fixerFeature, OFFER_FEATURE, CM_STUB], content: [fixerPack([FX]), ...extra], patch: { money: { cred: 0, cash: 1000 } } }).game
}
type FG = ReturnType<typeof fixerGame>
const sys = (changes: ReportDraft['changes']): ReportDraft => ({ kind: 'system', action: 'test.setup', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const stubSetup = (g: FG) => (g.state.ext.cm_stub as { setup: Rec }).setup
function finishJob(g: FG, id: string, rating: string) {
  g.commit(accept(g.k, g.state, { id, fixer: 'fx_a' }, { pay: 'cash' }))
  g.commit(go(g.k, g.state, id))
  const st = g.state.ext.cm_stub as { origin: { by: string; ref?: string } }
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: st.origin, outcome: 'done', result: { rating, xp: 20 } })
  return g.commit(attachActivityEnd({
    kind: 'gig', action: 'stub.end', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes], outcome: { result: 'done', summary: '副本結束。' },
  }, end))
}

describe('應修 7（FACTIONS 6.1 節「懸賞：它罩的中間人不接你」；FIXER 第 1 節後台）：fixer.backer 的格式與引用', () => {
  it('backer 不是文字：寫出原因', () => {
    const g = fixerGame()
    expect(g.k.content.validate('fixer', [{ ...FX, id: 'fx_b', backer: 3 }]).join('；')).toMatch(/backer 要是勢力的 id/)
    expect(g.k.content.validate('fixer', [{ ...FX, id: 'fx_b', backer: '  ' }]).join('；')).toMatch(/backer 要是勢力的 id/)
    expect(g.k.content.validate('fixer', [{ ...FX, id: 'fx_b', backer: 'f_gang' }])).toEqual([])
  })

  it('backer 指到查不到的勢力：整包載不起來，寫出是哪一筆', () => {
    expect(() => makeGame({ features: [securityFeature, fixerFeature], content: [fixerPack([{ ...FX, backer: 'f_nope' }])] })).toThrow(/f_nope/)
  })
})

describe('應修 7（FACTIONS 6.1 節「以它為目標的委託」）：沒有目標勢力的委託', () => {
  it('target_faction 是 none：不問敵對值，出發照常（就算別的勢力在追捕你）', () => {
    const g = fixerGame()
    g.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_gang', set: 90 }]))
    g.commit(accept(g.k, g.state, { id: 'o_none_target', fixer: 'fx_a' }, { pay: 'cash' }))
    const reports = g.commit(go(g.k, g.state, 'o_none_target'))
    expect(stubSetup(g)).toMatchObject({ alert_start: 0 })
    expect(stubSetup(g)).not.toHaveProperty('encounter_plus')
    expect(reports[0]!.narration?.results).toEqual(['你帶著這件委託出發了：o_none_target 的委託。'])
  })
})

describe('應修 5（FACTIONS 5.2 節：完成它當委託人的委託 +3；評價最高 +5）：委託人好感的退路與規則', () => {
  const favor = (g: FG, f: string) => meterOf(g.k, g.state, 'favor', f)

  it('employer 是空白或 none：當作沒有委託人，誰的好感都不動', () => {
    for (const id of ['o_blank_employer', 'o_none_employer']) {
      const g = fixerGame()
      finishJob(g, id, 'S')
      expect(favor(g, 'f_corp'), id).toBe(10)
      expect(favor(g, 'f_gang'), id).toBe(10)
    }
  })

  it('規則把 favor_done 調成 0：評價 B 不加（不發 0 的效果）；評價 S 只加 favor_top', () => {
    const rule = { id: 'wb_rule', content: { fixer_rule: [{ id: 'default', favor_done: 0 }] } as unknown as ContentPack['content'] }
    const b = fixerGame([rule])
    const reports = finishJob(b, 'o_employer', 'B')
    expect(favor(b, 'f_corp')).toBe(10)
    const pay = reports.find((r) => r.action === 'fixer.payout')!
    expect(pay.changes.some((c) => c.op === 'meter' && c.kind === 'favor')).toBe(false)
    const s = fixerGame([rule])
    finishJob(s, 'o_employer', 'S')
    expect(favor(s, 'f_corp')).toBe(12)
  })

  it('規則的格式：favor_done、favor_top、hostile_budget、hostile_alert 超出範圍擋下', () => {
    const g = fixerGame()
    const v = (r: Rec) => g.k.content.validate('fixer_rule', [{ id: 'default', ...r }]).join('；')
    expect(v({ favor_done: -1 })).toMatch(/favor_done/)
    expect(v({ favor_top: 101 })).toMatch(/favor_top/)
    expect(v({ hostile_budget: 5 })).toMatch(/hostile_budget/)
    expect(v({ hostile_alert: 1.5 })).toMatch(/hostile_alert/)
    expect(v({ favor_done: 3, favor_top: 2, hostile_budget: 4, hostile_alert: 100 })).toBe('')
  })
})

// ===================================================================================================================
// 應修 7：沒有守備的階段不加雜兵（features/commission/run.ts planMeat）
// ===================================================================================================================

describe('應修 7（FACTIONS 6.1 節「遭遇預算 +1」；commission/model.ts RunSetup.encounter_plus「沒有守備的階段不加」）', () => {
  /** encounter 給 undefined 是整個欄位不寫。 */
  function open(encounter: string[] | undefined, plus: number) {
    const { game: g } = makeWorldGame({ seed: 5, pc: STRONG_PC, patch: { time: { day: 3, hour: 10, minute: 0 } } })
    g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
    const def = clone(g.k.content.get('commission', 'cm_tw_office')) as unknown as { stages: Array<{ faces: { meat: Rec } }> }
    if (encounter === undefined) delete def.stages[0]!.faces.meat.encounter
    else def.stages[0]!.faces.meat.encounter = encounter
    g.launch('commission', { def, encounter_plus: plus }, { by: 'wb', ref: 'cm_tw_office' })
    g.commit(chooseFace(g.k, g.state, 'meat'))
    const [r] = g.commit(chooseBranch(g.k, g.state, 'assault'))
    const run = readRun(g.state)!
    const guards = (g.state.maps.instances[run.map!]!.ext as { guards?: Record<string, { foes: unknown[] }> }).guards ?? {}
    return { lines: r!.narration?.results ?? [], foes: Object.values(guards).reduce((n, x) => n + x.foes.length, 0), guards }
  }

  it('這一段沒有守備（encounter 是空陣列）：encounter_plus 不加人、地圖上沒有保全崗、沒有「對方認得你」那一句', () => {
    const o = open([], 2)
    expect(o.foes).toBe(0)
    expect(o.guards).toEqual({})
    expect(o.lines.join('')).not.toMatch(/對方認得你/)
  })

  it('現實面整個沒寫 encounter：進副本就擋下並寫出原因（planMeat 的 `?? []` 退路走不到）', () => {
    expect(() => open(undefined, 2)).toThrow(/encounter 要寫/)
  })

  it('有守備：每一個 encounter_plus 是一個雜兵，加在後面，並說明', () => {
    const o = open(['elite'], 2)
    expect(o.foes).toBe(3)
    expect(o.lines.join('')).toMatch(/對方認得你，守備多了人/)
  })
})

// ===================================================================================================================
// M2-ui-life（修正批 13，H4）：沒有傷的人睡一覺、喘口氣
// ===================================================================================================================

describe('M2-fix-review 13（AI_TASKS 4.1 節正文的硬規則 H4：機制的數字不寫進文字）：沒有回生命值的句子', () => {
  const H4 = /(?:生命值?|傷害|血量)\s*[:：]?\s*[-−+＋－]\s*\d|\d+\s*點\s*(?:的\s*)?(?:傷害|生命|血量)/

  /** 城市情境的主角，生命值補滿。 */
  function full() {
    const t = makeCityGame({ seed: 4 })
    const pc = t.game.state.pc!
    t.game.state.actors[pc]!.hp = maxHpOf(t.game.k, t.game.state, pc)
    return t
  }

  it('滿血睡一覺：那一句寫「本來就沒有什麼傷」，不帶數字，也沒有回血的變更', () => {
    const t = full()
    const d = sleepDraft(t.game.k, t.game.state)
    const lines = d.narration?.results ?? []
    expect(lines.join('')).toMatch(/本來就沒有什麼傷，睡得很安穩/)
    expect(lines.join('')).not.toMatch(H4)
    expect(d.changes.some((c) => c.op === 'actor.track' && c.track === 'hp')).toBe(false)
  })

  it('滿血喘口氣：只有第一句，沒有回血的句子也沒有回血的變更', () => {
    const t = full()
    const d = breathDraft(t.game.k, t.game.state)
    expect(d.narration?.results).toEqual(['你坐下來喘了口氣，感載與餘韻都退了。'])
    expect(d.changes.some((c) => c.op === 'actor.track' && c.track === 'hp')).toBe(false)
  })
})

// ===================================================================================================================
// M2-ui-people（修正批 14）：出身的名冊進名冊的退路（features/roster/ops.ts originRosterDrafts）
// ===================================================================================================================

describe('M2-fix-review 14（CHARACTER 第 1 節出身的名冊；NPC_SYSTEM 10.0）：originRosterDrafts 的退路', () => {
  const ORIGIN_PACK = (roster: unknown): ContentPack => ({
    id: 'wb_origin',
    content: {
      perk: [{ id: 'origin_wb', name: '出身的小特質', category: 'origin', cost: 2, flaw: false, desc: '測試用。', checks: { skills: ['streetwise'], bonus: 1 } }],
      origin: [{ id: 'o_wb', name: '測試出身', line: '測試用', skill_bonus: { streetwise: 1 }, status: 'citizen', home: '塔下', favor: { choose_one: ['f_corp'], value: 25 }, perk: 'origin_wb', roster }],
    } as unknown as ContentPack['content'],
  })
  const DRAFT: CreationDraft = {
    name: '露', gender: 'female', age: 22, origin: 'o_wb', originChoice: { favor: 'f_corp' },
    attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }, attrBonus: { tech: -4, reflex: 3, resolve: 3 },
    skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 }, perks: [],
  }
  function created(roster: string[]) {
    const t = makeWorldGame({ scenario: 'beforeCreation', content: [ORIGIN_PACK(roster)] })
    t.game.commit(buildCreationReport(t.game.k, t.game.state, DRAFT))
    return t.game
  }
  const withRoster = (state: GameState, roster: unknown): GameState => {
    const s = clone(state)
    ;(s.actors[s.pc!]!.ext.origin as Rec).roster = roster
    return s
  }
  const adds = (d: ReportDraft): number => d.changes.filter((c) => c.op === 'actor.add').length

  it('還沒有主角、出身沒有 roster、roster 不是陣列：什麼都不做', () => {
    const g = created([])
    expect(originRosterDrafts(g.k, { ...clone(g.state), pc: null } as unknown as GameState)).toEqual([])
    expect(originRosterDrafts(g.k, withRoster(g.state, undefined))).toEqual([])
    expect(originRosterDrafts(g.k, withRoster(g.state, 'npc_tw_friend'))).toEqual([])
    const s = clone(g.state)
    s.actors[s.pc!]!.ext.origin = 'o_wb'
    expect(originRosterDrafts(g.k, s)).toEqual([])
  })

  it('不是文字、空白的 id 略過；其餘照常進名冊', () => {
    const g = created([])
    const drafts = originRosterDrafts(g.k, withRoster(g.state, [42, '  ', null, 'npc_tw_friend']))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.outcome.summary).toMatch(/出身帶來的夥伴/)
  })

  it('寫到主角自己：略過（主角不進自己的名冊）', () => {
    const g = created([])
    expect(originRosterDrafts(g.k, withRoster(g.state, [g.state.pc]))).toEqual([])
  })

  it('查不到的 npc（meet 效果回錯誤）：略過，後面的人照常', () => {
    const g = created([])
    const drafts = originRosterDrafts(g.k, withRoster(g.state, ['npc_nobody', 'npc_tw_friend']))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.changes.some((c) => c.op === 'actor.add' && (c as { actor?: { id?: string } }).actor?.id === 'npc_nobody')).toBe(false)
  })

  it('已經是角色、但不在名冊上的人：不再 meet 一次（沒有 actor.add），直接進名冊', () => {
    const g = created(['npc_tw_friend'])
    expect(Object.keys(readRoster(g.state).members)).toEqual(['npc_tw_friend'])
    const s = withRoster(g.state, ['npc_tw_friend'])
    ;(s.ext.roster as Rec).members = {}
    const drafts = originRosterDrafts(g.k, s)
    expect(drafts).toHaveLength(1)
    expect(adds(drafts[0]!)).toBe(0)
    // 已經在名冊上的：略過
    expect(originRosterDrafts(g.k, withRoster(g.state, ['npc_tw_friend']))).toEqual([])
  })
})
