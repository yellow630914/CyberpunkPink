// 驗收測試：dev/work/M2-core-fix1.md（核心小修第一批）。
// 1 自由行動與戰鬥結束的鏈在場上有具名的 NPC 時多一步算關係（relate）：外殼要有這個任務（退路什麼都不記）；
// 2 報告帶行動的輸入（Report.args）；3 行動種類給自己的退路（ActionKindDef.fallback）；
// 5 核心的 item 變更用 data.uid 拿走指名的那一件；6 行動種類宣告算回報只照規則（rewardByRules）；
// 另有起手變更（ActionKindDef.prelude）：算回報驗證用的狀態先套上它、報告把它排在最前面。
// （4 features/actions 不驗寫了 owner 的參考範圍：tests/core/activity.test.ts；npcs 與 trade 的用法在各自的功能測試。）
// 規格：AI_TASKS 2.5 節（上限）、3.1 節（自由行動的鏈）、4.1 節（reward、relate 的退路）；dev/adr/0016。

import { describe, expect, it } from 'vitest'
import type { ActionKindDef, Actor, Change, Feature, ReportDraft } from '../../src'
import { ActionRegistry, Probe, addItem, countItem, findByUid, inputOf, meterOf, removeItemByUid } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame, meterFeature, observed, playOut, testMeter } from '../../src/testkit'

const NPC: Actor = {
  id: 'n1', name: '路人甲', role: 'npc', age: 30, attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, perks: [],
  hp: 20, load: 0, afterglow: 0, sink: 0, conditions: [], ext: {},
}
/** 裝了這個功能、場上又有 role 是 npc 的角色，鏈就會跑算關係那一步（whens.cast_present 看的是功能的 id）。 */
const NPCS: Feature = { id: 'npcs', install() {} }
const draft = (changes: Change[], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const KARMA = testMeter({ kind: 'karma', name: '業力', min: -100, max: 100, cap: { down: 8, up: 8 } })
const judgeOk = () => (req: Parameters<typeof inputOf>[0]) => {
  const i = inputOf<{ roll: { degree: string }; ref_dc: number }>(req)
  return { json: { degree: i.roll.degree, dc: i.ref_dc, reason: '照骰子。', twist: '', minutes: 10, new_person: false } }
}

/** 一種測試用的行動：成功程度決定的規則表（fallback）、給 AI 看的參考範圍（hint）都能自己指定。 */
function kind(over: Partial<ActionKindDef> = {}): ActionKindDef {
  return { id: 'probe_act', owner: 'test', name: '試試看', attr: 'charm', dc: 'trivial', minutes: 10, maxMinutes: 30, reportKind: 'action', ...over }
}
const withKind = (def: ActionKindDef): Feature => ({ id: 'test_kind', install: (k) => k.actions.register(def) })
/** 把 NPC 放進角色表（工廠的 patch.actors 會整個取代，所以開局之後再放）。 */
const withNpc = <T extends { game: { state: { actors: Record<string, Actor> } } }>(t: T): T => {
  t.game.state.actors.n1 = structuredClone(NPC)
  return t
}
const ACE = { attrs: { charm: 20 }, skills: {} }

// ---- 1：算關係 ----

describe('1 自由行動：場上有具名的 NPC 時算關係那一步不丟錯（退路什麼都不記）', () => {
  it('AI 關著：relate 走退路（狀態 fallback）、其餘照常，報告沒有多出任何變更', async () => {
    const { game } = withNpc(makeGame({ features: [NPCS] }))
    const { result, violations } = await observed(game, () => game.act({ kind: 'free', text: '看看四周' }))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    expect(result.run.steps.map((s) => [s.id, s.status])).toEqual([
      ['roll', 'done'], ['judge', 'fallback'], ['hint', 'done'], ['person', 'skipped'], ['reward', 'fallback'], ['relate', 'fallback'], ['text', 'fallback'], ['apply', 'done'],
    ])
    expect(result.reports[0]!.changes.map((c) => c.op)).toEqual(['time', 'rng', 'chain'])
  })

  it('AI 開著：relate 照樣走退路，不向服務商發請求（AI 那一半還沒接上）；判定、寫正文照常問', async () => {
    const { game, fake } = withNpc(makeGame({ features: [NPCS], fake: {} }))
    const r = await game.act({ kind: 'free', text: '看看四周' })
    expect(r.status).toBe('applied')
    expect(r.run.steps.find((s) => s.id === 'relate')).toMatchObject({ status: 'fallback' })
    expect(fake!.requests.map((x) => x.task)).toEqual(['judge', 'reward', 'narrate'])
  })

  it('沒有 NPC 在場或沒裝 npcs：還是略過這一步（skipped）', async () => {
    const a = makeGame({ features: [NPCS] })
    expect((await a.game.act({ kind: 'free', text: '看看四周' })).run.steps.find((s) => s.id === 'relate')!.status).toBe('skipped')
    const b = withNpc(makeGame())
    expect((await b.game.act({ kind: 'free', text: '看看四周' })).run.steps.find((s) => s.id === 'relate')!.status).toBe('skipped')
  })

  it('戰鬥結束的鏈一樣：場上有 NPC 單位時 relate 走退路，戰鬥照常結算', async () => {
    const setup = BATTLE_SETUPS.encounter()
    const first = setup.allies[0] as { unit: Record<string, unknown> }
    first.unit.actor = 'n1'
    const { game } = withNpc(makeGame({ features: [TEST_COMBAT, NPCS], seed: 2 }))
    game.startBattle(setup)
    playOut(game)
    const r = await game.finishBattle()
    expect(r.status).toBe('applied')
    expect(game.lastRun!.steps.find((s) => s.id === 'relate')).toMatchObject({ status: 'fallback' })
  })
})

// ---- 2：報告帶行動的輸入 ----

describe('2 報告帶行動的輸入（Report.args）', () => {
  it('行動的報告帶整份輸入：功能自己加的欄位（對象、物品、店……）原樣都在；文字另外在 input', async () => {
    const seen: Array<ReportDraft['args']> = []
    const spy: Feature = { id: 'spy', install: (k) => k.hooks.on('report.before', 'spy', ({ draft: d }) => { if (d.action === 'probe_act') seen.push(d.args); return undefined }) }
    const { game } = makeGame({ features: [withKind(kind()), spy], pc: ACE })
    const input = { kind: 'probe_act', text: '送他一朵花', target: 'n1', item: 'it_flower', category: 'bridge' }
    const r = await game.act(input)
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.input).toBe('送他一朵花')
    expect(r.reports[0]!.args).toEqual(input)
    expect(seen).toEqual([input])
    // 存進紀錄、存檔讀回來都還在
    expect(game.state.reports.at(-1)!.args).toEqual(input)
    const saved = game.save('manual', 't')
    expect(game.load(saved)).toBeNull()
    expect(game.state.reports.at(-1)!.args).toEqual(input)
  })

  it('自由行動也帶：{ kind: free, text }；不是行動做出來的報告（直接提交的）沒有這一欄', async () => {
    const { game } = makeGame()
    const r = await game.act({ kind: 'free', text: '看看四周' })
    expect(r.reports[0]!.args).toEqual({ kind: 'free', text: '看看四周' })
    const [plain] = game.commit(draft([{ op: 'flag', key: 'x', value: true }]))
    expect(plain!.args).toBeUndefined()
  })

  it('重擲、重試之後套用的報告帶的是同一份輸入（輸入不會因為重試被改掉）', async () => {
    const { game } = makeGame({ features: [withKind(kind())], pc: ACE })
    const input = { kind: 'probe_act', target: 'n1' }
    const r = await game.act(input)
    expect(r.reports[0]!.args).toEqual(input)
    expect(input).toEqual({ kind: 'probe_act', target: 'n1' })
  })
})

// ---- 3：行動種類自己的退路 ----

describe('3 行動種類的退路（ActionKindDef.fallback）：AI 關著時算回報用它，當成內建的來源，結果進 narration.results', () => {
  const lines = (r: { reports: Array<{ narration?: { results?: string[] } }> }) => r.reports[0]!.narration!.results

  it('AI 關著：照退路給的效果結算，不受 AI 的一件事上限管（業力的 cap 是 +8，退路給 +20 就是 +20）；預設的「參考範圍的一半」不再算', async () => {
    const def = kind({
      hint: () => [{ kind: 'karma', amount: 100 }],
      fallback: () => [{ kind: 'karma', amount: 20 }],
    })
    const { game } = makeGame({ features: [meterFeature(KARMA), withKind(def)], pc: ACE })
    const { result, violations } = await observed(game, () => game.act({ kind: 'probe_act' }))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    expect(meterOf(game.k, game.state, 'karma', '_')).toBe(20)
    expect(lines(result)).toEqual(['業力：+20'])
    expect(result.reports[0]!.clamps ?? []).toEqual([])
    expect(result.run.steps.find((s) => s.id === 'reward')!.status).toBe('fallback')
  })

  it('同樣的數字走預設的退路（沒寫 fallback）：參考範圍的一半、當成 AI 的來源被夾在 +8', async () => {
    const def = kind({ hint: () => [{ kind: 'karma', amount: 60 }] })
    const { game } = makeGame({ features: [meterFeature(KARMA), withKind(def)], pc: ACE })
    const r = await game.act({ kind: 'probe_act' })
    expect(meterOf(game.k, game.state, 'karma', '_')).toBe(8)
    expect(r.reports[0]!.clamps!.length).toBe(1)
  })

  it('退路收到成功程度、輸入、這一區的等級與參考範圍本身（沒有 hint 就是空的）', async () => {
    const got: Array<{ degree: string; target: unknown; hint: unknown; grade: number; actor: string }> = []
    const def = kind({
      hint: () => [{ kind: 'flag', key: 'hinted', value: true }],
      fallback: (c) => { got.push({ degree: c.degree, target: c.input.target, hint: c.hint, grade: c.grade, actor: c.actor }); return [] },
    })
    const { game } = makeGame({ features: [withKind(def)], pc: ACE })
    const r = await game.act({ kind: 'probe_act', target: 'n1' })
    expect(got).toEqual([{ degree: r.reports[0]!.outcome.result, target: 'n1', hint: [{ kind: 'flag', key: 'hinted', value: true }], grade: 1, actor: 'pc' }])
  })

  it('AI 開著而且交的合格：用 AI 的，退路不跑；AI 交的不合格、自動用規則（autoRules）：退路跑，結果不受上限管', async () => {
    let ran = 0
    const def = kind({ hint: () => [{ kind: 'karma', amount: 5 }], fallback: () => { ran++; return [{ kind: 'karma', amount: 30 }] } })
    const ai = makeGame({ features: [meterFeature(KARMA), withKind(def)], pc: ACE, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'karma', amount: 3, from: { source: 'degree' } }] } }] } } })
    const r1 = await ai.game.act({ kind: 'probe_act' }, { autoRules: true })
    expect(r1.status).toBe('applied')
    expect(meterOf(ai.game.k, ai.game.state, 'karma', '_')).toBe(3)
    expect(ran).toBe(0)
    const bad = makeGame({ features: [meterFeature(KARMA), withKind(def)], pc: ACE, fake: { adversarial: { mode: 'unknown_id', tasks: ['reward'] } } })
    const r2 = await bad.game.act({ kind: 'probe_act' }, { autoRules: true })
    expect(r2.status).toBe('applied')
    expect(ran).toBe(1)
    expect(meterOf(bad.game.k, bad.game.state, 'karma', '_')).toBe(30)
  })

  it('退路給的效果有一筆不合格：整批退成什麼都不給（鏈照樣跑完），不丟錯', async () => {
    const def = kind({ fallback: () => [{ kind: 'karma', amount: 5 }, { kind: 'no_such_effect' }] })
    const { game } = makeGame({ features: [meterFeature(KARMA), withKind(def)], pc: ACE })
    const r = await game.act({ kind: 'probe_act' })
    expect(r.status).toBe('applied')
    expect(meterOf(game.k, game.state, 'karma', '_')).toBe(0)
    expect(lines(r)).toEqual([])
  })

  it('退路的錢照內建的來源：只受區的等級管（I 級的區一次最多拿得到的現金）、不受 AI 的信譽上限管', async () => {
    const def = kind({ fallback: () => [{ kind: 'cash', amount: 100 }] })
    const { game } = makeGame({ features: [withKind(def)], pc: ACE })
    const r = await game.act({ kind: 'probe_act' })
    expect(r.status).toBe('applied')
    expect(game.state.money.cash).toBe(100)
  })
})

// ---- 6：算回報只照規則 ----

describe('6 算回報只照規則（ActionKindDef.rewardByRules）：AI 不被問 reward，結果照判定定案的成功程度', () => {
  const rules = () => kind({ hint: () => [{ kind: 'karma', amount: 99 }], fallback: ({ degree }) => [{ kind: 'karma', amount: degree === 'critical' ? 6 : 1 }], rewardByRules: true })

  it('AI 開著：沒有 reward 的請求，步驟是 fallback；就算劇本準備了別的 reward 也不會用；判定與寫正文照常問 AI', async () => {
    const { game, fake } = makeGame({
      features: [meterFeature(KARMA), withKind(rules())], pc: ACE,
      fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'karma', amount: 8, from: { source: 'degree' } }] } }] } },
    })
    const r = await game.act({ kind: 'probe_act' })
    expect(r.status).toBe('applied')
    expect(fake!.requests.map((x) => x.task)).toEqual(['judge', 'narrate'])
    expect(r.run.steps.find((s) => s.id === 'reward')).toMatchObject({ status: 'fallback' })
    expect(r.run.steps.find((s) => s.id === 'judge')!.status).toBe('done')
    expect(meterOf(game.k, game.state, 'karma', '_')).toBe(r.reports[0]!.outcome.result === 'critical' ? 6 : 1)
  })

  it('AI 判定被夾回骰值之後的成功程度才是退路看到的（AI 說大成功、骰面其實失敗：看到的是失敗）', async () => {
    const seen: string[] = []
    const def = kind({ fallback: ({ degree }) => { seen.push(degree); return [] }, rewardByRules: true, attr: 'charm', dc: 'extreme' })
    const { game } = makeGame({ features: [withKind(def)], fake: { byTask: { judge: [{ json: { degree: 'critical', dc: 25, reason: '運氣很好。', twist: '', minutes: 10 } }] } } })
    const r = await game.act({ kind: 'probe_act' })
    expect(r.status).toBe('applied')
    expect(seen).toEqual([r.reports[0]!.outcome.result])
    expect(r.reports[0]!.outcome.result).not.toBe('critical')
  })

  it('AI 關著：同樣走退路；沒有 judge 與 reward 的請求', async () => {
    const { game } = makeGame({ features: [meterFeature(KARMA), withKind(rules())], pc: ACE })
    const r = await game.act({ kind: 'probe_act' })
    expect(r.status).toBe('applied')
    expect(r.run.steps.find((s) => s.id === 'reward')!.status).toBe('fallback')
  })

  it('註冊時檢查：要有 fallback 才能設 rewardByRules', () => {
    const reg = new ActionRegistry(new Probe())
    expect(() => reg.register(kind({ rewardByRules: true }))).toThrow(/rewardByRules 要有 fallback/)
    expect(() => reg.register(kind({ rewardByRules: true, fallback: () => [] }))).not.toThrow()
  })
})

// ---- 起手 ----

describe('起手變更（ActionKindDef.prelude）：算回報驗證用的狀態先套上它，報告把它排在最前面', () => {
  // 親密度那類「照人記」的量表，鍵要是已經存在的角色：起手先把人放進角色表，後面的效果才驗得過
  const AFF = testMeter({ kind: 'bond', name: '交情', keyed: 'npc', min: -100, cap: { down: 8, up: 8 } })
  const meet = (): Change => ({ op: 'actor.add', actor: NPC })
  const def = (over: Partial<ActionKindDef> = {}) => kind({ prelude: (s) => (s.actors.n1 ? [] : [meet()]), fallback: () => [{ kind: 'bond', key: 'n1', amount: 2 }], ...over })

  it('AI 關著：起手的變更在最前面，退路的效果驗證時看得到那個人（沒有起手整批會因為查不到 n1 退成空的）', async () => {
    const { game } = makeGame({ features: [meterFeature(AFF), withKind(def())], pc: ACE })
    const { result, violations } = await observed(game, () => game.act({ kind: 'probe_act', target: 'n1' }))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    expect(result.reports[0]!.changes.map((c) => c.op).slice(0, 2)).toEqual(['actor.add', 'meter'])
    expect(game.state.actors.n1!.name).toBe('路人甲')
    expect(meterOf(game.k, game.state, 'bond', 'n1')).toBe(2)
    expect(result.reports[0]!.narration!.results).toEqual(['交情（路人甲）：+2'])
  })

  it('沒有起手（人本來就在）：不重複加；AI 開著時 AI 給的效果一樣先看到起手之後的狀態', async () => {
    const known = withNpc(makeGame({ features: [meterFeature(AFF), withKind(def())], pc: ACE }))
    const r = await known.game.act({ kind: 'probe_act' })
    expect(r.reports[0]!.changes.map((c) => c.op)).not.toContain('actor.add')
    expect(meterOf(known.game.k, known.game.state, 'bond', 'n1')).toBe(2)
    const ai = makeGame({
      features: [meterFeature(AFF), withKind(def())], pc: ACE,
      fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'bond', key: 'n1', amount: 4, from: { source: 'degree' } }] } }] } },
    })
    const r2 = await ai.game.act({ kind: 'probe_act' }, { autoRules: true })
    expect(r2.status).toBe('applied')
    expect(r2.run.steps.find((s) => s.id === 'reward')!.status).toBe('done')
    expect(meterOf(ai.game.k, ai.game.state, 'bond', 'n1')).toBe(4)
    expect(r2.reports[0]!.changes[0]!.op).toBe('actor.add')
  })

  it('沒有起手時，同樣的效果對還沒有的人驗證不過（所以退路退成什麼都不給）：證明起手真的改變了驗證用的狀態', async () => {
    const { game } = makeGame({ features: [meterFeature(AFF), withKind(def({ prelude: undefined }))], pc: ACE })
    const r = await game.act({ kind: 'probe_act' })
    expect(r.status).toBe('applied')
    expect(game.state.actors.n1).toBeUndefined()
    expect(r.reports[0]!.narration!.results).toEqual([])
  })
})

// ---- 5：核心的 item 變更用 data.uid 拿走指名的那一件 ----

describe('5 item 變更：拿走時寫 data.uid 就拿指名的那一件', () => {
  const stacks = () => [{ id: 'part', qty: 1, data: { uid: 'u1', tune: 1 } }, { id: 'part', qty: 2, data: { uid: 'u2' } }, { id: 'part', qty: 3 }]
  const item = (qty: number, data?: Record<string, unknown>): Change => ({ op: 'item', id: 'part', qty, ...(data ? { data } : {}) })

  it('指名拿走：只動那一疊；拿光那一疊就整個移除；沒有實例資料的那一疊與別的實例原封不動', () => {
    const { game } = makeGame()
    game.state.inventory = stacks()
    game.commit(draft([item(-1, { uid: 'u1' })]))
    expect(game.state.inventory).toEqual([{ id: 'part', qty: 2, data: { uid: 'u2' } }, { id: 'part', qty: 3 }])
    game.commit(draft([item(-1, { uid: 'u2' })]))
    expect(game.state.inventory).toEqual([{ id: 'part', qty: 1, data: { uid: 'u2' } }, { id: 'part', qty: 3 }])
    expect(countItem(game.state.inventory, 'part')).toBe(4)
  })

  it('不指名照舊：先拿沒有實例資料的那一疊；寫了 data 但沒有 uid 也當沒指名', () => {
    const { game } = makeGame()
    game.state.inventory = stacks()
    game.commit(draft([item(-2)]))
    expect(game.state.inventory.map((s) => [s.data?.uid ?? null, s.qty])).toEqual([['u1', 1], ['u2', 2], [null, 1]])
    game.commit(draft([item(-1, { tune: 9 })]))
    expect(game.state.inventory.map((s) => [s.data?.uid ?? null, s.qty])).toEqual([['u1', 1], ['u2', 2]])
  })

  it('找不到那一件、數量比那一疊多、id 對不上：整份報告不收，狀態不動，原因寫出是哪一件', () => {
    const { game } = makeGame()
    game.state.inventory = stacks()
    const before = JSON.stringify(game.state.inventory)
    expect(() => game.commit(draft([item(-1, { uid: 'u9' })]))).toThrow(/uid u9/)
    expect(() => game.commit(draft([item(-2, { uid: 'u1' })]))).toThrow(/uid u1.*不夠 2/)
    expect(() => game.commit(draft([{ op: 'item', id: 'other', qty: -1, data: { uid: 'u1' } }]))).toThrow(/other/)
    expect(JSON.stringify(game.state.inventory)).toBe(before)
  })

  it('得到（qty > 0）時 data 仍是新那一疊的實例資料，uid 不是拿走的意思', () => {
    const { game } = makeGame()
    game.commit(draft([item(1, { uid: 'u7' }), item(1, { uid: 'u8' })]))
    expect(game.state.inventory).toEqual([{ id: 'part', qty: 1, data: { uid: 'u7' } }, { id: 'part', qty: 1, data: { uid: 'u8' } }])
  })

  it('背包的輔助函式：findByUid、removeItemByUid（不夠就丟錯）', () => {
    const inv = stacks()
    expect(findByUid(inv, 'part', 'u2')!.qty).toBe(2)
    expect(findByUid(inv, 'part', 'nope')).toBeUndefined()
    expect(findByUid(inv, 'other', 'u2')).toBeUndefined()
    expect(findByUid(inv, 'part', undefined)).toBeUndefined()
    expect(findByUid(inv, 'part', '')).toBeUndefined()
    removeItemByUid(inv, 'part', 'u2', 2)
    expect(inv.map((s) => s.data?.uid ?? null)).toEqual(['u1', null])
    expect(() => removeItemByUid(inv, 'part', 'u1', 2)).toThrow()
    addItem(inv, 'part', 1, { uid: 'u3' })
    expect(inv.at(-1)).toEqual({ id: 'part', qty: 1, data: { uid: 'u3' } })
  })
})
