// 白箱測試：features/defeat（戰敗：事件的格式、選哪一個事件與版本、扣錢、接受結果、等待中的戰敗的報告）。
// 補主套件沒有走到的分支：格式檢查的每一條、內容篩選與勢力的各種組合、版本退回、效果有問題的事件、default 的檢查。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { createKernel } from '../../src'
import { acceptDefeat, defeatFeature, defeatOf, pickDefeat } from '../../src/features/defeat'
import { TEST_COMBAT, makeBattleGame, makeGame, makeState, playOut } from '../../src/testkit'

const EV = { id: 'df_ok', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: false, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [] } } }
const FEATURES = [defeatFeature, TEST_COMBAT]
const pack = (events: unknown[]): ContentPack => ({ id: 'df', content: { faction: [{ id: 'nora', name: '野良', short: '野良', class: 'street' }, { id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }], defeat_event: events as never } })
const problems = (e: Record<string, unknown>): string => createKernel([defeatFeature]).content.validate('defeat_event', [e]).join('\n')
const edit = (field: string, value: unknown): string => {
  const e = { ...EV, [field]: value } as Record<string, unknown>
  if (value === undefined) delete e[field]
  return problems(e)
}
const ev = (over: Record<string, unknown>) => ({ ...EV, ...over })

describe('白箱 defeat_event 的格式（DATA 第 5 節；ENEMIES 第 6 節）', () => {
  it('合格的樣本收得進來；可以只寫一個版本', () => {
    expect(problems(EV)).toBe('')
    expect(problems(ev({ default: true, tags: ['pc_unwilling'], fallback: 'df_other', adult: true, versions: { masc: { text: 'x', effects: [{ kind: 'time', hours: 1 }] } } }))).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['kind', undefined, /kind 要是種類的 id/],
    ['factions', 'nora', /factions 要是勢力 id 的陣列/],
    ['factions', [3], /factions 要是勢力 id 的陣列/],
    ['fails_commission', undefined, /fails_commission 要是 true 或 false/],
    ['versions', undefined, /versions 要是物件/],
    ['versions', [], /versions 要是物件/],
    ['versions', {}, /versions 至少要寫一個版本/],
    ['versions', { weird: { text: 'x', effects: [] } }, /versions 的鍵只能是 default、masc、yuri（拿到 weird）/],
    ['versions', { default: 'x' }, /versions\.default 要是 \{ text, effects \}/],
    ['versions', { default: { text: ' ', effects: [] } }, /versions\.default\.text 要是一段敘事/],
    ['versions', { default: { text: 'x', effects: [3] } }, /versions\.default\.effects 要是效果（物件）的陣列/],
    ['default', 'yes', /default 要是 true 或 false/],
    ['tags', 'x', /tags 要是字串的陣列/],
    ['tags', [1], /tags 要是字串的陣列/],
    ['fallback', 3, /fallback 要是戰敗事件的 id/],
    ['adult', 'x', /adult 要是 true 或 false/],
  ] as const)('%s 寫成 %j 擋下', (field, value, re) => {
    expect(edit(field, value as unknown)).toMatch(re)
  })

  it('default: true 整份內容最多一筆：先載入的另一批已經有了，後載入的整批不收（不變式第 11 條）', () => {
    const k = createKernel([defeatFeature])
    k.content.load('defeat_event', [ev({ id: 'df_a', default: true })])
    expect(() => k.content.load('defeat_event', [ev({ id: 'df_b', default: true })])).toThrow(/default: true 整份內容裡最多一筆（df_a 已經是了）/)
    expect(() => k.content.load('defeat_event', [ev({ id: 'df_a', default: true })], { replace: true })).not.toThrow()
  })

  it('refs：勢力與 fallback 找不到的列出來', () => {
    const k = createKernel([defeatFeature])
    k.content.load('defeat_event', [ev({ factions: ['ghost'], fallback: 'df_ghost' })] as never)
    expect(k.content.checkRefs().join('\n')).toMatch(/faction\/ghost[\s\S]*defeat_event\/df_ghost/)
  })
})

describe('白箱 選哪一個事件與版本（ENEMIES 第 6 節；LEWD_SYSTEM 第 9 節）', () => {
  const game = (events: unknown[], pc: Record<string, unknown> = {}, rules: Record<string, unknown> = {}) =>
    makeGame({ features: FEATURES, content: [pack(events)], pc: pc as never, patch: { rules: rules as never } }).game
  const pick = (g: ReturnType<typeof game>, o: { faction?: string; roll?: number } = {}) => pickDefeat(g.k, g.state, { ...(o.faction !== undefined ? { faction: o.faction } : {}), roll: o.roll ?? 0.5 })

  it('沒有任何事件、或沒有勢力對得上也沒有 default：丟錯並寫出原因', () => {
    expect(() => pick(game([]))).toThrow(/沒有可用的戰敗事件/)
    expect(() => pick(game([ev({ id: 'df_n', factions: ['nora'] })]), { faction: 'eden' })).toThrow(/沒有可用的戰敗事件/)
    expect(() => pick(game([ev({ id: 'df_n', factions: ['nora'] })]))).toThrow(/沒有可用的戰敗事件/)
  })

  it('勢力對得上就用它（同勢力的取前面的）；沒寫勢力或對不上就用 default', () => {
    const g = game([ev({ id: 'df_n1', factions: ['nora'], fails_commission: true }), ev({ id: 'df_n2', factions: ['nora'] }), ev({ id: 'df_d', default: true })])
    expect(pick(g, { faction: 'nora' })).toMatchObject({ event: 'df_n1', fails_commission: true })
    expect(pick(g, { faction: 'eden' }).event).toBe('df_d')
    expect(pick(g).event).toBe('df_d')
  })

  it('內容篩選關掉帶某個標籤的題材：改走 fallback；fallback 也被關、或繞圈就用 default；default 自己被關就沒有事件', () => {
    const events = [
      ev({ id: 'df_n', factions: ['nora'], tags: ['pc_unwilling'], fallback: 'df_soft' }),
      ev({ id: 'df_soft', factions: [], tags: [] }),
      ev({ id: 'df_d', default: true }),
    ]
    expect(pick(game(events, {}, { contentOff: ['pc_unwilling'] }), { faction: 'nora' }).event).toBe('df_soft')
    const both = [ev({ id: 'df_n', factions: ['nora'], tags: ['pc_unwilling'], fallback: 'df_soft2' }), ev({ id: 'df_soft2', tags: ['pc_unwilling'] }), ev({ id: 'df_d', default: true })]
    expect(pick(game(both, {}, { contentOff: ['pc_unwilling'] }), { faction: 'nora' }).event).toBe('df_d')
    const loop = [ev({ id: 'df_a', factions: ['nora'], tags: ['pc_unwilling'], fallback: 'df_b' }), ev({ id: 'df_b', tags: ['pc_unwilling'], fallback: 'df_a' }), ev({ id: 'df_d', default: true })]
    expect(pick(game(loop, {}, { contentOff: ['pc_unwilling'] }), { faction: 'nora' }).event).toBe('df_d')
    const noDefault = game([ev({ id: 'df_a', factions: ['nora'], tags: ['pc_unwilling'] })], {}, { contentOff: ['pc_unwilling'] })
    expect(() => pick(noDefault, { faction: 'nora' })).toThrow(/沒有可用的戰敗事件/)
    const defaultOff = game([ev({ id: 'df_d', default: true, tags: ['pc_unwilling'] })], {}, { contentOff: ['pc_unwilling'] })
    expect(() => pick(defaultOff)).toThrow(/沒有可用的戰敗事件/)
    expect(() => pick(game([ev({ id: 'df_d', default: true, tags: ['pc_unwilling'] })], {}, { contentOff: ['pc_unwilling'] }), { faction: 'nora' })).toThrow(/沒有可用的戰敗事件/)
  })

  it('版本照主角的性別與骰面：男只走 masc；沒有那一版就退回 default；沒有主角時當女性（七成 default、三成 yuri）', () => {
    const all = ev({ id: 'df_v', default: true, versions: { default: { text: 'd', effects: [] }, masc: { text: 'm', effects: [] }, yuri: { text: 'y', effects: [] } } })
    expect(pick(game([all], { gender: 'male' }), { roll: 0.5 }).version).toBe('masc')
    expect(pick(game([all], { gender: 'female' }), { roll: 0.1 }).version).toBe('default')
    expect(pick(game([all], { gender: 'female' }), { roll: 0.95 }).version).toBe('yuri')
    const noMasc = ev({ id: 'df_v', default: true })
    expect(pick(game([noMasc], { gender: 'male' }), { roll: 0.5 }).version).toBe('default')
    const g = game([all])
    g.state.pc = '' as never
    expect(pick(g, { roll: 0.1 }).version).toBe('default')
    const onlyMasc = ev({ id: 'df_m', default: true, versions: { masc: { text: 'm', effects: [] } } })
    expect(pick(game([onlyMasc], { gender: 'female' }), { roll: 0.1 }).version).toBe('masc')
  })
})

describe('白箱 結算與接受結果（COMBAT_SYSTEM 8.3、8.4 節；dev/adr/0013 D11）', () => {
  const lose = async (events: unknown[], o: { faction?: string; gender?: string; rules?: Record<string, unknown>; cash?: number } = {}) => {
    const { game } = makeBattleGame({ features: FEATURES, content: [pack(events)], battle: 'hopeless', seed: 3, pc: { gender: o.gender ?? 'female' } as never, patch: { money: { cred: 0, cash: o.cash ?? 1000 }, rules: (o.rules ?? {}) as never } })
    game.state.battle!.origin.faction = o.faction ?? 'nora'
    playOut(game)
    const r = await game.finishBattle()
    return { game, reports: r.reports }
  }

  it('版本沒有寫的鍵：退回 default，default 也沒有就用寫了的第一個', async () => {
    const onlyYuri = ev({ id: 'df_y', factions: ['nora'], versions: { yuri: { text: '只有一種寫法。', effects: [] } } })
    const { game, reports } = await lose([onlyYuri])
    expect(defeatOf(game.state)!.version).toBe('yuri')
    expect(reports[1]!.outcome.summary).toBe('只有一種寫法。')
  })

  it('接受結果：fails_commission 是 false 的摘要說委託還在；事件不在內容裡丟錯；效果有問題在載入時就丟錯並寫出哪一件', async () => {
    const { game } = await lose([ev({ id: 'df_ok2', factions: ['nora'], versions: { default: { text: '無事。', effects: [] } } })])
    const [r] = game.commit(acceptDefeat(game.k, game.state))
    expect(r!.outcome.summary).toBe('你接受了這個結果。這一趟的委託還在。')
    expect(r!.narration!.results).toEqual([])
    const lost = await lose([ev({ id: 'df_ok3', factions: ['nora'] })])
    lost.game.state.ext.defeat = { ...(defeatOf(lost.game.state) as object), event: 'df_gone' }
    expect(() => acceptDefeat(lost.game.k, lost.game.state)).toThrow(/戰敗事件 df_gone 不在內容裡/)
    // 效果的種類沒有人註冊（沒裝提供它的功能）：載入時就被擋下，訊息指出是哪一件事件（M4-followups；以前要等到接受那一步才丟錯）
    await expect(lose([ev({ id: 'df_bad', factions: ['nora'], versions: { default: { text: '壞的。', effects: [{ kind: 'no_such_effect' }] } } })])).rejects.toThrow(/defeat_event\/df_bad/)
  })

  it('接受結果：報告把開打前的快照丟掉（才算選完）、清掉 ext；沒有等待中的戰敗丟錯', async () => {
    const { game } = await lose([ev({ id: 'df_ok4', factions: ['nora'] })])
    const draft = acceptDefeat(game.k, game.state)
    expect(draft.changes).toEqual(expect.arrayContaining([{ op: 'ext', key: 'defeat', value: null }, { op: 'snapshot.drop', kind: 'battle' }]))
    expect(() => acceptDefeat(makeGame({ features: FEATURES, content: [pack([])] }).game.k, makeState())).toThrow(/沒有等待中的戰敗/)
  })

  it('戰敗扣錢：defeatMoneyLoss 的比例取整數、沒有上限（undefined）時只看比例；沒有現金時不扣', async () => {
    const take = ev({ id: 'df_t', factions: ['nora'], versions: { default: { text: '被洗劫。', effects: [{ kind: 'cash', amount: -900 }] } } })
    const half = await lose([take], { cash: 1001, rules: { defeatMoneyLoss: 0.5 } })
    half.game.commit(acceptDefeat(half.game.k, half.game.state))
    expect(1001 - half.game.state.money.cash).toBe(500)
    const none = await lose([take], { cash: 0, rules: { defeatMoneyLoss: 1 } })
    expect(defeatOf(none.game.state)!.lines).toEqual([])
    none.game.commit(acceptDefeat(none.game.k, none.game.state))
    expect(none.game.state.money.cash).toBe(0)
  })

  it('等待中的戰敗的報告：別的報告不產生；等待中的戰敗被清掉了或事件被拿掉了就寫「你輸了。」', async () => {
    const { game, reports } = await lose([ev({ id: 'df_ok5', factions: ['nora'] })])
    expect(reports.map((r) => r.action)).toEqual(['battle.end', 'defeat.pending'])
    const cloneState = structuredClone(game.state)
    cloneState.ext.defeat = { ...(defeatOf(cloneState) as object), event: 'df_removed' }
    const out = game.k.hooks.run('report.after', { state: cloneState, report: { ...reports[0]!, action: 'battle.end', outcome: { result: 'lose', summary: '' } } } as never).flatMap((x) => x.result ?? [])
    expect(out.length).toBeGreaterThan(0)
    expect(out.find((d) => (d as { action?: string }).action === 'defeat.pending')).toMatchObject({ outcome: { result: 'defeat', summary: '你輸了。' } })
    const none = structuredClone(game.state)
    delete none.ext.defeat
    expect(game.k.hooks.run('report.after', { state: none, report: { ...reports[0]!, outcome: { result: 'lose', summary: '' } } } as never).flatMap((x) => x.result ?? [])).toEqual([])
    const win = game.k.hooks.run('report.after', { state: game.state, report: { ...reports[0]!, outcome: { result: 'win', summary: '' } } } as never).flatMap((x) => x.result ?? [])
    expect(win).toEqual([])
    const other = game.k.hooks.run('report.after', { state: game.state, report: { ...reports[0]!, action: 'battle.step', outcome: { result: 'lose', summary: '' } } } as never).flatMap((x) => x.result ?? [])
    expect(other).toEqual([])
  })

  it('defeatOf：不是物件、沒有 event 都是 null；事件 id 不是字串也是 null', () => {
    const s = makeState()
    expect(defeatOf(s)).toBeNull()
    s.ext.defeat = 'x'
    expect(defeatOf(s)).toBeNull()
    s.ext.defeat = { event: 5 }
    expect(defeatOf(s)).toBeNull()
    s.ext.defeat = { event: 'df_x' }
    expect(defeatOf(s)).toEqual({ event: 'df_x' })
  })
})
