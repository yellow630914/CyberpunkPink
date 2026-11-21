// 白箱測試：L5 行動核心（三段式 prepareAction → sanitizeJudgment → buildActionReport、行動種類、回合流程）。
// 補主套件沒有走到的分支與錯誤路徑。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ActionKindDef, Change, GameState, ReportDraft } from '../../src/core'
import {
  ActionBlocked, ActionRegistry, Probe, areaGrade, buildActionReport, clone, commitReport, commitTurn, createKernel, expectedAfterCommit, fallbackJudgment, fallbackReward,
  partySnapshot, prepareAction, rerollAction, rewardHint, sanitizeJudgment,
} from '../../src/core'
import { characterFeature } from '../../src/features/character'
import { MINI_PACK } from '../helpers/miniContent'
import { makeActor, makeState } from '../../src/testkit'

const KIND: ActionKindDef = { id: 'wb', owner: 'wb', name: '白箱', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 30, maxMinutes: 60, reportKind: 'action' }
const setup = (def: Partial<ActionKindDef> = {}, features = [] as Parameters<typeof createKernel>[0]) => {
  const k = createKernel(features)
  k.strict = true
  k.actions.register({ ...KIND, ...def })
  return { k, state: makeState() }
}
const noEffects = { effects: [], changes: [], lines: [], clamps: [], errors: [] }

describe('白箱 L5 行動種類的登錄表（AI_TASKS 3.1 節）', () => {
  it('重複註冊、maxMinutes 比 minutes 小都丟錯；list 列出全部', () => {
    const reg = new ActionRegistry(new Probe())
    reg.register(KIND)
    expect(() => reg.register(KIND)).toThrow(/已經由 wb 註冊/)
    expect(() => reg.register({ ...KIND, id: 'x', minutes: 10, maxMinutes: 5 })).toThrow(/maxMinutes 不能比 minutes 小/)
    expect(reg.list().map((d) => d.id)).toEqual(['wb'])
  })
})

describe('白箱 L5 第一段：擲骰（AI_TASKS 3.1 第 1 步；dev/invariants.md 第 5 條）', () => {
  it('沒有那種行動丟錯；主角的 id 指到不存在的角色也算還沒有主角', () => {
    const { k, state } = setup()
    expect(() => prepareAction(k, state, { kind: 'nope' })).toThrow(/沒有 nope 這種行動/)
    const s = clone(state)
    delete s.actors.pc
    expect(() => prepareAction(k, s, { kind: 'wb' })).toThrow(ActionBlocked)
  })

  it('block 回傳原因就擋下，訊息原樣給玩家；回傳 null 照做', () => {
    const { k, state } = setup({ block: (s) => (s.money.cash < 10 ? '身上沒有錢。' : null) })
    expect(() => prepareAction(k, state, { kind: 'wb' })).toThrow('身上沒有錢。')
    state.money.cash = 10
    expect(prepareAction(k, state, { kind: 'wb' }).input.kind).toBe('wb')
  })

  it('dc 可以是函式，回傳數字或檔位；都加上難度的偏移（BALANCE 7.2；CORE_RULES 3）', () => {
    const { k, state } = setup({ dc: (_s, input) => (input.text === 'hard' ? 'hard' : 11) })
    state.rules.dcOffset = 2
    expect(prepareAction(k, state, { kind: 'wb', text: 'hard' }).refDc).toBe(18)
    expect(prepareAction(k, state, { kind: 'wb' }).refDc).toBe(13)
  })

  it('玩家選的屬性與基本功蓋過種類的預設；不改傳進來的 input', () => {
    const { k, state } = setup()
    const input = { kind: 'wb', attr: 'body' as const, skill: 'stealth' }
    const p = prepareAction(k, state, input)
    expect([p.attr, p.skill]).toEqual(['body', 'stealth'])
    p.input.text = 'x'
    expect(input).toEqual({ kind: 'wb', attr: 'body', skill: 'stealth' })
  })

  it('沒有基本功的種類：pending 沒有 skill 欄位；退路的判定也沒有', () => {
    const { k, state } = setup({ skill: undefined })
    const p = prepareAction(k, state, { kind: 'wb' })
    expect('skill' in p).toBe(false)
    expect('skill' in fallbackJudgment(p)).toBe(false)
  })

  it('重擲：舊的骰面進 history、次數加一，骰面寫進檢定（AI_TASKS 2.4「每次重擲都記一筆」）', () => {
    const { k, state } = setup()
    const p0 = prepareAction(k, state, { kind: 'wb' })
    expect('rerolls' in p0.roll).toBe(false)
    const p1 = rerollAction(k, state, p0)
    const p2 = rerollAction(k, state, p1)
    expect(p2.reroll).toBe(2)
    expect(p2.history).toEqual([p0.roll.natural, p1.roll.natural])
    expect(p2.roll).toMatchObject({ rerolls: 2, history: [p0.roll.natural, p1.roll.natural] })
    // 擲骰不改狀態
    expect(state).toEqual(makeState())
  })

  it('這一區的等級：有 district 內容讀它的 grade；不在 1～5 或沒有就當 I 級（EVENTS 2.4）', () => {
    const k = createKernel()
    k.content.defineKind({ kind: 'district', owner: 'wb', validate: () => [] })
    k.content.load('district', [{ id: 'crown', grade: 5 }, { id: 'weird', grade: 9 }, { id: 'nograde' }])
    const at = (district?: string): number => areaGrade(k, makeState({ patch: { location: district ? { district } : {} } }))
    expect([at('crown'), at('weird'), at('nograde'), at('nowhere'), at()]).toEqual([5, 1, 1, 1, 1])
  })
})

describe('白箱 L5 第二段：判定的驗證與夾值（AI_TASKS 4.1、2.5；dev/invariants.md 第 15、19、28 條）', () => {
  const judge = (raw: unknown, o: { clampAsked?: boolean; text?: string; content?: boolean } = {}) => {
    const { k, state } = setup()
    if (o.content) k.content.loadPack({ id: 'skills', content: { skill: MINI_PACK.content.skill! } })
    const p = prepareAction(k, state, { kind: 'wb', text: o.text })
    return { p, r: sanitizeJudgment(k, state, p, raw, { clampAsked: o.clampAsked ?? true }) }
  }

  it('不是物件：整份是格式錯誤', () => {
    expect(judge('critical').r).toEqual({ judgment: null, errors: ['judgment：要是一個物件'], clamps: [] })
    expect(judge(null).r.errors).toHaveLength(1)
  })

  it('每一個欄位的格式錯誤都列出來（degree、attr、skill、dc、minutes、reason、twist、asked）', () => {
    const { r } = judge({ degree: 'great', attr: 'luck', skill: 5, dc: 'x', minutes: -1, reason: 1, twist: [], asked: 3 })
    expect(r.judgment).toBeNull()
    expect(r.errors.map((e) => e.split('：')[0])).toEqual(['judgment.degree', 'judgment.attr', 'judgment.skill', 'judgment.dc', 'judgment.minutes', 'judgment.reason', 'judgment.twist', 'judgment.asked'])
    expect(judge({ degree: 'success', dc: Infinity }).r.errors).toEqual(['judgment.dc：要是數字'])
    expect(judge({ degree: 'success', minutes: NaN }).r.errors).toEqual(['judgment.minutes：要是 0 以上的數字'])
  })

  it('基本功：載入了 skill 內容時要是其中一項；沒有載入時任何字串都收；空字串與 null 是不用基本功', () => {
    expect(judge({ degree: 'success', skill: 'flying' }, { content: true }).r.errors[0]).toMatch(/沒有 "flying" 這項基本功/)
    expect(judge({ degree: 'success', skill: 'flying' }).r.errors).toEqual([])
    expect('skill' in judge({ degree: 'success', skill: '' }).r.judgment!).toBe(false)
    // 沒給 skill 沿用 pending 的
    expect(judge({ degree: 'success' }).r.judgment!.skill).toBe('negotiate')
  })

  it('DC 取整數；沒給 DC 與時間時用參考值與平常的時間', () => {
    const { p, r } = judge({ degree: 'success', dc: p0dc() + 1.4 })
    expect(r.judgment!.dc).toBe(p.refDc + 1)
    const d = judge({ degree: 'success' })
    expect(d.r.judgment).toMatchObject({ dc: d.p.refDc, minutes: d.p.minutes })
  })

  it('時間超過上限夾在上限，提醒寫小時；剛好等於上限不夾', () => {
    const over = judge({ degree: 'success', minutes: 61 }).r
    expect(over.judgment!.minutes).toBe(60)
    expect(over.clamps[0]).toMatchObject({ path: 'judgment.minutes', from: 61, to: 60, notice: '這件事最多花 1 小時。' })
    expect(judge({ degree: 'success', minutes: 60 }).r.clamps).toEqual([])
  })

  it('new_person 與 newPerson 兩種寫法都收；reason、twist、asked 截斷長度', () => {
    expect(judge({ degree: 'success', new_person: true }).r.judgment!.newPerson).toBe(true)
    expect(judge({ degree: 'success', newPerson: true }).r.judgment!.newPerson).toBe(true)
    expect(judge({ degree: 'success', newPerson: 'yes' }).r.judgment!.newPerson).toBe(false)
    const j = judge({ degree: 'success', reason: 'r'.repeat(1000), twist: 't'.repeat(1000), asked: 'a'.repeat(1000) }).r.judgment!
    expect([j.reason.length, j.twist.length, j.asked!.length]).toEqual([600, 300, 400])
  })

  it('重擲過的 pending：重算的檢定帶 rerolls 與 history（AI_TASKS 2.4）', () => {
    const { k, state } = setup()
    const p = rerollAction(k, state, prepareAction(k, state, { kind: 'wb' }))
    const j = sanitizeJudgment(k, state, p, { degree: p.roll.degree }, { clampAsked: true }).judgment!
    expect(j.roll).toMatchObject({ rerolls: 1, history: p.history })
  })
})

function p0dc(): number {
  const { k, state } = setup()
  return prepareAction(k, state, { kind: 'wb' }).refDc
}

describe('白箱 L5 參考範圍與退路（AI_TASKS 3.1 第 3 步、4.1）', () => {
  it('rewardHint：narrow 只在成功而且差距不到 3 時為真；拿到這一區的等級', () => {
    const seen: unknown[] = []
    const { k, state } = setup({ hint: (c) => { seen.push({ degree: c.degree, narrow: c.narrow, grade: c.grade }); return [] } })
    const p = prepareAction(k, state, { kind: 'wb' })
    const j = fallbackJudgment(p)
    rewardHint(k, state, p, { ...j, degree: 'success', roll: { ...j.roll, margin: 2 } })
    rewardHint(k, state, p, { ...j, degree: 'success', roll: { ...j.roll, margin: 3 } })
    rewardHint(k, state, p, { ...j, degree: 'critical', roll: { ...j.roll, margin: 1 } })
    expect(seen).toEqual([{ degree: 'success', narrow: true, grade: 1 }, { degree: 'success', narrow: false, grade: 1 }, { degree: 'critical', narrow: false, grade: 1 }])
  })

  it('fallbackReward：amount 減半往 0 取整，減到 0 的拿掉；沒有 amount 的原樣（複製）', () => {
    const item = { kind: 'item', id: 'it_a', qty: 1 }
    const out = fallbackReward([{ kind: 'cash', amount: 7 }, { kind: 'cash', amount: -3 }, { kind: 'cash', amount: 1 }, { kind: 'cash', amount: -1 }, item])
    expect(out).toEqual([{ kind: 'cash', amount: 3 }, { kind: 'cash', amount: -1 }, item])
    expect(out[2]).not.toBe(item)
  })
})

describe('白箱 L5 第三段：組報告（AI_TASKS 3.1 第 4 步；GAME_DESIGN 3 第 3 條；dev/invariants.md 第 2、16 條）', () => {
  it('隊伍的快照：沒有功能註冊上限時記 0；不在 actors 裡的隊員略過；剛加入的人「前」用現在的值', () => {
    const k = createKernel()
    const before = makeState()
    const after = clone(before)
    after.actors.c1 = makeActor({ id: 'c1', role: 'companion', name: '新人', hp: 9 })
    after.party.push('c1', 'ghost')
    after.actors.pc!.hp = 30
    const snap = partySnapshot(k, before, after)
    expect(snap).toEqual([
      { id: 'pc', name: '測試主角', hp: [40, 30, 0], load: [0, 0, 0], sink: [0, 0, 0], afterglow: 0 },
      { id: 'c1', name: '新人', hp: [9, 9, 0], load: [0, 0, 0], sink: [0, 0, 0], afterglow: 0 },
    ])
  })

  it('隊伍的快照：角色功能註冊了上限時記上限（CORE_RULES 4.1、4.2）', () => {
    const k = createKernel([characterFeature])
    const s = makeState()
    expect(partySnapshot(k, s, s)[0]!.hp).toEqual([40, 40, 40])
  })

  it('時間是 0 不加 time 變更；亂數游標一定往前一格；其他步驟的變更與定案的結果接在後面', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'wb', text: '說服他' })
    const j = { ...fallbackJudgment(p), minutes: 0, twist: '可是他起疑了。', reason: '' }
    const d = buildActionReport(k, state, {
      pending: p, judgment: j, reward: { ...noEffects, changes: [{ op: 'cash', delta: 5 }], lines: ['拿到：現金 5'] },
      extraChanges: [{ op: 'flag', key: 'ai:met', value: true }], extraLines: ['認識了一個人'], text: '正文', uncovered: [1], chain: 'c9',
      judgeClamps: [{ path: 'judgment.dc', from: 30, to: 16, notice: 'n' }],
    })
    expect(d.changes).toEqual([{ op: 'cash', delta: 5 }, { op: 'flag', key: 'ai:met', value: true }, { op: 'rng', advance: 1 }])
    expect(d.input).toBe('說服他')
    expect(d.chain).toBe('c9')
    expect(d.clamps).toHaveLength(1)
    expect(d.narration).toEqual({ results: ['拿到：現金 5', '認識了一個人'], text: '正文', uncovered: [1] })
    expect(d.timeline[0]!.text).toBe('白箱')
    expect(d.outcome.summary).toContain('可是他起疑了。拿到：現金 5。認識了一個人。')
    const before = clone(state)
    const r = commitReport(k, state, d)
    expect(state).toEqual(expectedAfterCommit(k, before, r))
  })

  it('沒有 text、沒有 uncovered、沒有 chain、沒有夾值：這些欄位不出現', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'wb' })
    const d = buildActionReport(k, state, { pending: p, judgment: fallbackJudgment(p), reward: noEffects, uncovered: [] })
    expect(['input', 'chain', 'clamps'].filter((f) => f in d)).toEqual([])
    expect(d.narration).toEqual({ results: [] })
    expect(d.changes.at(-2)).toEqual({ op: 'time', minutes: 30 })
  })

  it('組報告時變更不合法（例：扣的錢不夠）丟 ChangeError，狀態不變（dev/invariants.md 第 3、16 條）', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'wb' })
    const before = clone(state)
    expect(() => buildActionReport(k, state, { pending: p, judgment: fallbackJudgment(p), reward: { ...noEffects, changes: [{ op: 'cash', delta: -1 }] } })).toThrow(/現金不夠/)
    expect(state).toEqual(before)
  })
})

describe('白箱 L5 回合流程（CODESCAN「回合結束」；GAME_DESIGN 3 第 3 條）', () => {
  const draft = (changes: Change[], action = 'act'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: 's' } })

  it('turn.end 回傳的報告接著提交；拿到的是行動本身那一份報告', () => {
    const k = createKernel()
    k.strict = true
    const seen: Array<string | undefined> = []
    k.hooks.on('turn.end', 'wb', ({ report }) => { seen.push(report.action); return [draft([{ op: 'counter', key: 'turn', delta: 1 }], 'turn')] })
    k.hooks.on('turn.end', 'none', () => undefined)
    const s: GameState = makeState()
    const rs = commitTurn(k, s, draft([{ op: 'cash', delta: 1 }]))
    expect(rs.map((r) => r.action)).toEqual(['act', 'turn'])
    expect(seen).toEqual(['act'])
    expect(s.counters.turn).toBe(1)
  })
})
