// 驗收測試：dev/work/M4-core-part-ai.md（cpp-architect 角色）。規格：AI_TASKS 第 1、2 節、3.20 節、4.4 節；PROMPTS 5.8 節 design_part；CRAFTING 11.1 節；
// dev/adr/0006、0016 第二節；dev/adr/0019 第十七節與 P71、P74；dev/test-harness.md 第 3 節；dev/invariants.md 新加的幾條。
// 內容一律用測試自帶的最小假資料：一張小的 unreg_rule（槍管三個選項、外皮兩個選項）、兩筆 quirk、一個內容裡的零件（「鐵牙槍管」，給「名字和既有零件同名」用）、
// 四筆槍管的預設清單（II 級）；不裝別的功能，等著交貨的零件用效果 part_unreg（內建的來源）加進來。AI 用假的服務商。
//
// 慣例：「基準」是同一個種子、同一份內容、AI 關著交貨的那一件（預設清單的文字）；AI 成功時除了三段文字，其餘逐欄和它相同；走了退路的和它整件相同。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, InlinePart, Report, ReportDraft } from '../../src'
import {
  ActionBlocked, DEFAULT_AI_SETTINGS, DEFAULT_TASK_SOURCE, FakeProvider, PART_ADVERSARIES, UNREG_STACK_ID, effectCtx, partAdversary, partAiOf, partScript, sanitizeAiSettings, sectionOf,
} from '../../src'
import type { PartAdversary } from '../../src'
import { characterFeature } from '../../src/features/character'
import { deliverBlock, pendingParts, unregFeature, unregOf } from '../../src/features/unreg'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const QUIRKS: Rec[] = [
  { id: 'qk_chatty', name: '話多', desc: '它在口袋裡會輕輕作響。', kind: 'quirk', pool: ['doujin'] },
  { id: 'qk_yellow', name: '偏黃', desc: '用久了表面會泛黃。', kind: 'quirk', pool: ['doujin'] },
]
const PARTS: Rec[] = [{ id: 'pt_barrel', name: '鐵牙槍管', type: 'barrel', material: 'mech', brand: 'hz', grade: 2, price: 200, legal: 'free', cells: 1, stats: { hit: 1 }, weight: 1, size: 1, state: 'new' }]
const PRESETS: Rec[] = [
  { id: 'pr_a', type: 'barrel', grade: 2, name: '老砲', desc: '一根舊舊的槍管。', quirk_text: '扣下扳機總是慢半拍。' },
  { id: 'pr_b', type: 'barrel', grade: 2, name: '蛇信', desc: '一根細長的槍管。' },
  { id: 'pr_c', type: 'barrel', grade: 2, name: '舊管', desc: '一根用過很久的槍管。' },
  { id: 'pr_d', type: 'barrel', grade: 2, name: '黑鐵', desc: '一根黑黑的槍管。' },
]
const OPTIONS = {
  barrel: [
    { id: 'br_damage', name: '傷害', put: 'stats', key: 'damage', amount: 1, cost: 1, max: 2, tags: ['傷害'] },
    { id: 'br_hit', name: '命中', put: 'stats', key: 'hit', amount: 1, cost: 0.5, max: 3, tags: ['準度'] },
    { id: 'br_pierce', name: '穿甲', put: 'stats', key: 'pierce', amount: 1, cost: 0.5, max: 2, grade_min: 2 },
  ],
}
const pack = (): ContentPack => ({
  id: 'part_ai_test',
  content: { quirk: structuredClone(QUIRKS), part: structuredClone(PARTS), unreg_rule: [{ id: 'default', options: structuredClone(OPTIONS) }], unreg_preset: structuredClone(PRESETS) } as unknown as ContentPack['content'],
})

/** 一個測試用的活動（事件視窗）：旗標 ev_stub 開著就是進行中，只放行自己的報告。 */
const EVENT_STUB: Feature = {
  id: 'ev_stub',
  install: (k) => k.activity.define({ kind: 'ev_stub', owner: 'ev_stub', order: 30, active: (s) => (s.flags.ev_stub ? { id: 'ev', label: '事件' } : null), allow: ['stub.'], reason: () => '事件進行中，只能做事件裡的事。' }),
}

interface Opts {
  fake?: FakeProvider
  ai?: Record<string, unknown>
  seed?: number
  features?: Feature[]
  /** 一開始給幾件等著交貨的（都是 II 級槍管，帶怪癖；預設一件） */
  give?: Rec[]
}
const GIVE: Rec = { kind: 'part_unreg', type: 'barrel', grade: 2, quirk: 'qk_chatty' }

const draft = (changes: ReportDraft['changes']): ReportDraft => ({
  kind: 'action', action: 'test.step', location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

function make(o: Opts = {}) {
  const features = o.features ?? [characterFeature, unregFeature, EVENT_STUB]
  const { game, fake } = makeGame({ features, content: [pack()], seed: o.seed ?? 11, ...(o.fake ? { fake: o.fake, ai: { ai: 1, ...(o.ai ?? {}) } } : { ai: o.ai ?? { ai: 0 } }) })
  for (const e of o.give ?? [GIVE]) {
    const r = game.k.effects.resolve([e], effectCtx(game.k, game.state, { source: 'builtin' }))
    expect(r.errors).toEqual([])
    game.commit(draft(r.changes))
  }
  game.undo.clear()
  return { game, fake }
}
type G = ReturnType<typeof make>['game']

const partOfBag = (g: G): InlinePart | undefined => g.state.inventory.find((s) => s.id === UNREG_STACK_ID)?.data?.part as InlinePart | undefined
const bag = (g: G): InlinePart[] => g.state.inventory.filter((s) => s.id === UNREG_STACK_ID).map((s) => s.data!.part as InlinePart)
const idsOf = (g: G): string[] => pendingParts(g.state).map((p) => p.id)
const dReq = (fake: FakeProvider) => fake.requestsFor('design_part')
/** 三段文字以外的欄位（逐欄比的時候拿掉）。 */
const withoutTexts = (p: InlinePart): Omit<InlinePart, 'name' | 'desc' | 'quirk_text'> => {
  const { name: _n, desc: _d, quirk_text: _q, ...rest } = p
  return rest
}
const reasonOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
/** 等到服務商收到 design_part 的請求（請求已經在路上，才去回退或讀檔）。 */
const requested = async (fake: FakeProvider): Promise<void> => {
  for (let i = 0; i < 200 && dReq(fake).length === 0; i++) await new Promise((r) => setTimeout(r, 1))
  expect(dReq(fake).length).toBeGreaterThan(0)
}
const kinds = (r: { reports: Report[] }): string[] => r.reports.map((x) => x.action ?? '')

/** 基準：同一個種子、AI 關著交貨的那一件。 */
async function baseline(seed = 11, give?: Rec[]): Promise<InlinePart> {
  const { game } = make({ seed, ...(give ? { give } : {}) })
  const id = idsOf(game)[0]!
  await game.unregDeliver(id)
  return partOfBag(game)!
}

// ======================================================================
describe('設定與登記', () => {
  it('partAi 預設開、沒寫就是開；false 與 0 關；壞值用預設；預設的設定物件沒有這一格（cpp-ai-v1 的形狀不變）', () => {
    expect('partAi' in DEFAULT_AI_SETTINGS).toBe(false)
    expect(partAiOf(DEFAULT_AI_SETTINGS)).toBe(true)
    expect(partAiOf(sanitizeAiSettings({ partAi: false }))).toBe(false)
    expect(partAiOf(sanitizeAiSettings({ partAi: 0 }))).toBe(false)
    expect(partAiOf(sanitizeAiSettings({ partAi: 1 }))).toBe(true)
    expect(partAiOf(sanitizeAiSettings({ partAi: 'no' }))).toBe(true)
    expect('partAi' in sanitizeAiSettings({})).toBe(false)
  })

  it('任務 design_part：M、json、用盡走退路、固定重試 2 次、用主力；鏈 part_unreg 的步驟照 AI_TASKS 3.20 節', () => {
    const { game } = make()
    const t = game.tasks.get('design_part')!
    expect(t).toMatchObject({ id: 'design_part', size: 'M', output: 'json', onExhausted: 'fallback', retries: 2 })
    expect(t.schema?.name).toBe('submit_part')
    expect(t.adult).toBeUndefined()
    expect(DEFAULT_TASK_SOURCE.design_part).toBe('主力')
    const chain = game.chains.get('part_unreg')!
    expect(chain.template.steps.map((s) => `${s.id}:${s.kind}${s.task ? `:${s.task}` : ''}`)).toEqual(['frame:code', 'design:ai:design_part', 'deliver:code', 'text:ai:narrate', 'apply:apply'])
    // 判定與寫正文之間沒有判定的步驟；設定關掉重試也不影響它（retries 寫死）
    expect(t.fallback({} as never, {} as never)).toBeNull()
  })
})

// ======================================================================
describe('AI 關著：直接交貨，用預設清單，沒有請求', () => {
  it('背包多一件、名字是預設清單的；pending 拿掉；回的是 applied 與交貨的報告；回傳的鏈每一步都略過', async () => {
    const { game, fake } = make({ fake: new FakeProvider(), ai: { ai: 0 } })
    const [id] = idsOf(game)
    expect(id).toBeDefined()
    const preset = unregOf(game.state).pending[0]!.preset
    const cursor = game.state.rng.cursor
    const r = await game.unregDeliver(id!)
    expect(r.status).toBe('applied')
    expect(kinds(r)[0]).toBe('unreg.deliver')
    expect(r.run.status).toBe('applied')
    expect(r.run.steps.map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'skipped'])
    expect(bag(game)).toHaveLength(1)
    expect(partOfBag(game)).toMatchObject({ unreg: true, name: preset.name, desc: preset.desc, quirk_text: preset.quirk_text, state: 'doujin' })
    expect(PRESETS.map((p) => p.name)).toContain(partOfBag(game)!.name)
    expect(idsOf(game)).toEqual([])
    expect(unregOf(game.state).names).toEqual([preset.name])
    // 任務鏈沒有請求；也沒有留下任務鏈的紀錄
    expect(fake!.requests).toEqual([])
    expect(game.state.chains).toEqual([])
    expect(game.state.rng.cursor).toBe(cursor)
  })

  it('沒有服務商（總開關開著、沒有假的也沒有金鑰）也直接交；沒裝 unreg 的遊戲被擋、原因是找不到那一筆', async () => {
    const { game } = make({ ai: { ai: 1 } })
    expect(game.lastRun).toBeNull()
    await game.unregDeliver(idsOf(game)[0]!)
    expect(bag(game)).toHaveLength(1)
    const bare = makeGame({ features: [characterFeature], fake: new FakeProvider(), ai: { ai: 1 } }).game
    expect(await reasonOf(() => bare.unregDeliver('up1'))).toBe('沒有這一件等著交貨的零件。')
  })
})

// ======================================================================
describe('假服務商自動回應：名字是 AI 給的、數字與 AI 關著逐欄相同、有一段正文', () => {
  it('名字是「測試件」加國字流水號；stats、affinity、price、grade、legal、quirk 和基準逐欄相同；三段文字是 AI 的；正文寫進報告', async () => {
    const base = await baseline()
    const { game, fake } = make({ fake: new FakeProvider() })
    const id = idsOf(game)[0]!
    const cursor = game.state.rng.cursor
    const r = await game.unregDeliver(id)
    expect(r.status).toBe('applied')
    const p = partOfBag(game)!
    expect(p.name).toBe('測試件一')
    expect(p.name).not.toBe(base.name)
    expect(p.desc).toMatch(/^（假的服務商）/)
    expect(p.quirk_text).toMatch(/^（假的服務商）/)
    expect(/\d/.test(`${p.name}${p.desc}${p.quirk_text}`)).toBe(false)
    expect(withoutTexts(p)).toEqual(withoutTexts(base))
    for (const f of ['stats', 'affinity', 'price', 'grade', 'legal', 'quirk'] as const) expect(p[f], f).toEqual(base[f])
    // 一段正文；套用之後 pending 拿掉、名字記下
    const report = r.reports[0]!
    expect(report.action).toBe('unreg.deliver')
    expect(report.narration?.text).toMatch(/（假的服務商）/)
    expect(game.state.chains).toHaveLength(1)
    expect(idsOf(game)).toEqual([])
    expect(unregOf(game.state).names).toEqual(['測試件一'])
    // 一次請求各一個任務；游標不動
    expect(dReq(fake!)).toHaveLength(1)
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    expect(game.state.rng.cursor).toBe(cursor)
    // 任務鏈列看得到每一步
    expect(r.run.steps.map((s) => [s.id, s.status])).toEqual([['frame', 'done'], ['design', 'done'], ['deliver', 'done'], ['text', 'done'], ['apply', 'done']])
    expect(game.lastRun).toBe(r.run)
  })

  it('請求的結構：固定前段是五條規則；<frame> 沒有任何阿拉伯數字；<data> 是名字樣本；沒有玩家描述就沒有 <request>；<input> 帶 id', async () => {
    const { game, fake } = make({ fake: new FakeProvider() })
    await game.unregDeliver(idsOf(game)[0]!)
    const req = dReq(fake!)[0]!
    expect(req.system).toContain('submit_part')
    for (const n of ['1.', '2.', '3.', '4.', '5.']) expect(req.system).toContain(n)
    expect(req.system).toContain('不寫數字')
    expect(req.messages[0]!.content).not.toContain('<previous_error>')
    const frame = sectionOf(req, 'frame')!
    expect(frame).toContain('槍管')
    expect(frame).toContain('機械')
    expect(frame).toContain('II')
    expect(frame).toContain('話多')
    expect(/[0-9０-９]/.test(frame)).toBe(false)
    expect(sectionOf(req, 'request')).toBeNull()
    expect(sectionOf(req, 'data')).toContain('鐵牙槍管')
    expect(JSON.parse(sectionOf(req, 'input')!).id).toBe('up1')
    expect(req.schema?.name).toBe('submit_part')
    expect(req.adult).toBeUndefined()
  })

  it('玩家的描述原樣放進 <request>：不篩選、不改寫（含數字與標點）', async () => {
    const wish = '想要一把像舊貨的槍管，3 號，「別太亮」！'
    const { game, fake } = make({ fake: new FakeProvider(), give: [{ ...GIVE, request: wish }] })
    await game.unregDeliver(idsOf(game)[0]!)
    expect(sectionOf(dReq(fake!)[0]!, 'request')).toBe(wish)
    expect(JSON.parse(sectionOf(dReq(fake!)[0]!, 'input')!).request).toBe(wish)
  })

  it('沒有怪癖的框架：quirk 寫空字串也過（P74：這個零件沒有怪癖時 quirk 可以不寫）', async () => {
    // 只留一個不抽怪癖的設定：type 沒有候選怪癖（applies 對不上）時 frameOf 不抽
    const none = (): ContentPack => ({ ...pack(), content: { ...pack().content, quirk: [{ id: 'qk_x', name: '外皮才有', desc: '只有外皮的怪癖。', kind: 'quirk', pool: ['doujin'], applies: ['armor'] }] } as never })
    const { game, fake } = makeGame({ features: [characterFeature, unregFeature], content: [none()], seed: 11, fake: new FakeProvider(), ai: { ai: 1 } })
    const r = game.k.effects.resolve([{ kind: 'part_unreg', type: 'barrel', grade: 2 }], effectCtx(game.k, game.state, { source: 'builtin' }))
    game.commit(draft(r.changes))
    expect(unregOf(game.state).pending[0]!.frame.quirk).toBeNull()
    await game.unregDeliver('up1')
    const p = partOfBag(game as never)!
    expect(p.name).toBe('測試件一')
    expect(p.quirk).toBeUndefined()
    expect(dReq(fake!)[0]!.messages[0]!.content).toContain('沒有（quirk 寫空字串）')
  })
})

// ======================================================================
describe('對抗：每個劇本都重試不超過 2 次就走退路，零件照樣交到手上', () => {
  const RETRY_NOTE: Record<PartAdversary, RegExp | null> = {
    bad_json: /JSON|\(root\)/, name_digit: /不能有阿拉伯數字/, name_dup: /已經有一件零件叫這個名字/, desc_long: /desc：字數要在 4～60/, extra_stats: /stats：多出來的欄位/, refusal: null,
  }

  for (const name of PART_ADVERSARIES) {
    it(`${name}：最多 3 次請求（重試 2 次；拒絕不重試）、名字是預設清單的、零件和基準整件相同、沒有任何 AI 的數字`, async () => {
      const base = await baseline()
      const fake = new FakeProvider({ byTask: { design_part: partScript(name, { dup: '鐵牙槍管' }) } })
      const { game } = make({ fake })
      const r = await game.unregDeliver(idsOf(game)[0]!)
      expect(r.status).toBe('applied')
      const n = dReq(fake).length
      expect(n).toBe(name === 'refusal' ? 1 : 3)
      expect(n).toBeLessThanOrEqual(3)
      // 重試的請求把錯誤原樣帶回去
      const note = RETRY_NOTE[name]
      if (note) {
        const second = dReq(fake)[1]!.messages[0]!.content
        expect(second).toContain('<previous_error>')
        expect(sectionOf(dReq(fake)[1]!, 'previous_error')).toMatch(note)
      }
      // 走了退路：design 那一步是 fallback，值是 null；預設清單的文字，整件和基準逐欄相同
      expect(r.run.step('design').status).toBe('fallback')
      expect(r.run.draft.design).toBeNull()
      expect(partOfBag(game)).toEqual(base)
      expect(PRESETS.map((p) => p.name)).toContain(partOfBag(game)!.name)
      // 狀態裡沒有任何來自 AI 的數字：多的 stats 欄位（傷害 99）沒有進零件，也不在狀態的任何地方（任務鏈的紀錄留著每一次請求的原文，不算在內）
      expect(JSON.stringify({ ...game.state, chains: [] })).not.toContain('"damage":99')
      if (name === 'extra_stats') expect(JSON.stringify(game.state.chains)).toContain('damage\\":99')
      expect(partOfBag(game)!.stats).toEqual(base.stats)
      expect(partOfBag(game)!.name).not.toContain('測試件')
    })
  }

  it('逾時、網路錯誤也一樣：重試 2 次後走退路（設定把重試次數開到 3 也不多）', async () => {
    const base = await baseline()
    for (const reply of [{ hang: true }, { networkError: '斷線了' }]) {
      const fake = new FakeProvider({ byTask: { design_part: Array.from({ length: 6 }, () => reply) } })
      const { game } = make({ fake, ai: { retry: { '*': 3, design_part: 3 } } })
      const r = await game.unregDeliver(idsOf(game)[0]!)
      expect(r.status).toBe('applied')
      expect(dReq(fake)).toHaveLength(3)
      expect(r.run.step('design').status).toBe('fallback')
      expect(partOfBag(game)).toEqual(base)
    }
  })

  it('第一次不合格、第二次合格：用 AI 的名字，請求 2 次，第二次帶 <previous_error>', async () => {
    const fake = new FakeProvider({ byTask: { design_part: [(req) => partAdversary('name_digit', req)] } })
    const { game } = make({ fake })
    const r = await game.unregDeliver(idsOf(game)[0]!)
    expect(dReq(fake)).toHaveLength(2)
    expect(sectionOf(dReq(fake)[1]!, 'previous_error')).toMatch(/不能有阿拉伯數字/)
    expect(partOfBag(game)!.name).toBe('測試件一')
    expect(r.run.step('design').status).toBe('done')
  })

  it('AI 回的名字帶了類型、等級、牌子、價錢之類的欄位一律不收（多的欄位算失敗）；三段文字以外什麼都進不了零件', async () => {
    const bad = { name: '好名字', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。', grade: 5, brand: 'evil', price: 1, type: 'plate' }
    const fake = new FakeProvider({ byTask: { design_part: Array.from({ length: 4 }, () => ({ json: bad })) } })
    const { game } = make({ fake })
    const base = await baseline()
    await game.unregDeliver(idsOf(game)[0]!)
    expect(partOfBag(game)).toEqual(base)
    expect(partOfBag(game)).toMatchObject({ grade: 2, type: 'barrel', brand: 'doujin' })
    expect(sectionOf(dReq(fake)[1]!, 'previous_error')).toMatch(/grade：多出來的欄位/)
  })
})

// ======================================================================
describe('partAi 關掉、被活動擋住、時間沒到', () => {
  it('partAi 關掉：不發任何請求（連寫正文都沒有）；名字是預設清單的，和基準相同', async () => {
    const base = await baseline()
    const { game, fake } = make({ fake: new FakeProvider(), ai: { partAi: false } })
    const r = await game.unregDeliver(idsOf(game)[0]!)
    expect(r.status).toBe('applied')
    expect(fake!.requests).toEqual([])
    expect(partOfBag(game)).toEqual(base)
  })

  it('只關掉寫正文（narrate: false）：還是問 design_part，只是沒有正文', async () => {
    const { game, fake } = make({ fake: new FakeProvider(), ai: { narrate: false } })
    const r = await game.unregDeliver(idsOf(game)[0]!)
    expect(dReq(fake!)).toHaveLength(1)
    expect(fake!.requestsFor('narrate')).toHaveLength(0)
    expect(partOfBag(game)!.name).toBe('測試件一')
    expect(r.reports[0]!.narration?.text).toBeUndefined()
  })

  for (const mode of ['AI 開著', 'AI 關著'] as const) {
    it(`事件視窗開著時被擋（${mode}）：丟 ActionBlocked、原因照活動的、狀態與請求都不動、pending 還在；事件結束之後再叫一次成功`, async () => {
      const { game, fake } = make(mode === 'AI 開著' ? { fake: new FakeProvider() } : { fake: new FakeProvider(), ai: { ai: 0 } })
      const id = idsOf(game)[0]!
      game.state.flags.ev_stub = true
      const before = JSON.stringify(game.state)
      const undoDepth = game.undo.size
      expect(deliverBlock(game.k, game.state, id)).toBe('事件進行中，只能做事件裡的事。')
      expect(await reasonOf(() => game.unregDeliver(id))).toBe('事件進行中，只能做事件裡的事。')
      expect(JSON.stringify(game.state)).toBe(before)
      expect(game.undo.size).toBe(undoDepth)
      expect(fake!.requests).toEqual([])
      expect(idsOf(game)).toEqual([id])
      expect(bag(game)).toEqual([])
      delete game.state.flags.ev_stub
      const r = await game.unregDeliver(id)
      expect(r.status).toBe('applied')
      expect(bag(game)).toHaveLength(1)
      expect(idsOf(game)).toEqual([])
    })
  }

  it('查不到的那一筆被擋、原因是功能的那一句；訂做的（hold: order）時間沒到被擋、原因是「還要等幾天」', async () => {
    const { game } = make({ fake: new FakeProvider(), give: [GIVE, { ...GIVE, hold: 'order', ready_minutes: 3 * 1440 }] })
    expect(await reasonOf(() => game.unregDeliver('up99'))).toBe('沒有這一件等著交貨的零件。')
    const order = idsOf(game)[1]!
    expect(unregOf(game.state).pending[1]!.hold).toBe('order')
    const reason = await reasonOf(() => game.unregDeliver(order))
    expect(reason).toBe('還要等 3 天。')
    expect(reason).toBe(deliverBlock(game.k, game.state, order))
    expect(idsOf(game)).toHaveLength(2)
    // 沒有 hold 的那一筆照常交
    await game.unregDeliver(idsOf(game)[0]!)
    expect(idsOf(game)).toEqual([order])
  })
})

// ======================================================================
describe('交貨不推進存檔亂數的游標；同一個存檔交貨兩次拿到的數字相同', () => {
  for (const mode of ['AI 開著', 'AI 關著'] as const) {
    it(`${mode}：交貨前後游標相同；讀檔重來、回退重來，數字（含文字）逐欄相同`, async () => {
      const { game } = make(mode === 'AI 開著' ? { fake: new FakeProvider() } : { fake: new FakeProvider(), ai: { ai: 0 } })
      const id = idsOf(game)[0]!
      const saved = game.save()
      const cursor = game.state.rng.cursor
      await game.unregDeliver(id)
      expect(game.state.rng.cursor).toBe(cursor)
      const first = structuredClone(partOfBag(game)!)
      expect(game.load(saved)).toBeNull()
      expect(idsOf(game)).toEqual([id])
      expect(bag(game)).toEqual([])
      await game.unregDeliver(id)
      expect(partOfBag(game)).toEqual(first)
      expect(game.state.rng.cursor).toBe(cursor)
      // 回退一步：pending 回來、零件沒了；再交一次還是同一件
      expect(game.undoSteps(1)).toBe(true)
      expect(idsOf(game)).toEqual([id])
      expect(bag(game)).toEqual([])
      await game.unregDeliver(id)
      expect(partOfBag(game)).toEqual(first)
    })
  }
})

// ======================================================================
describe('同一筆同時只跑一條；回退或讀檔時丟掉還在跑的', () => {
  it('同一筆連叫兩次拿到同一個 Promise、只問一次；別的筆同時叫會被「鏈還在跑」擋下（狀態不動）', async () => {
    const { game, fake } = make({ fake: new FakeProvider(), give: [GIVE, GIVE] })
    const [a, b] = idsOf(game) as [string, string]
    const p1 = game.unregDeliver(a)
    const p2 = game.unregDeliver(a)
    expect(p2).toBe(p1)
    await expect(game.unregDeliver(b)).rejects.toThrow('上一條任務鏈還在跑。')
    const r = await p1
    expect(r.status).toBe('applied')
    expect(dReq(fake!)).toHaveLength(1)
    expect(idsOf(game)).toEqual([b])
    // 跑完之後再交另一筆
    await game.unregDeliver(b)
    expect(bag(game)).toHaveLength(2)
    expect(new Set(bag(game).map((p) => p.name)).size).toBe(2)
  })

  it('還在跑的時候回退：那一條被取消、狀態回到交貨之前、pending 還在；再叫一次成功', async () => {
    const fake = new FakeProvider({ byTask: { design_part: [{ json: { name: '慢慢來', desc: '一件慢慢寫的零件。', quirk: '它總是慢半拍才響。' }, delayMs: 60 }] } })
    const { game } = make({ fake })
    const id = idsOf(game)[0]!
    const p = game.unregDeliver(id)
    await requested(fake)
    expect(game.undoSteps(1)).toBe(true)
    const r = await p
    expect(r.status).toBe('cancelled')
    expect(bag(game)).toEqual([])
    expect(idsOf(game)).toEqual([id])
    const again = await game.unregDeliver(id)
    expect(again.status).toBe('applied')
    expect(partOfBag(game)!.name).toBe('測試件一')
  })

  it('還在跑的時候讀檔：同樣被取消、不套用；pending 還在', async () => {
    const fake = new FakeProvider({ byTask: { design_part: [{ json: { name: '慢慢來', desc: '一件慢慢寫的零件。', quirk: '它總是慢半拍才響。' }, delayMs: 60 }] } })
    const { game } = make({ fake })
    const id = idsOf(game)[0]!
    const saved = game.save()
    const p = game.unregDeliver(id)
    await requested(fake)
    expect(game.load(saved)).toBeNull()
    expect((await p).status).toBe('cancelled')
    expect(bag(game)).toEqual([])
    expect(idsOf(game)).toEqual([id])
    expect((await game.unregDeliver(id)).status).toBe('applied')
  })
})

// ======================================================================
describe('寫正文失敗：鏈停在半路、狀態沒變；再叫一次或用規則代替', () => {
  it('寫正文被拒絕：鏈 paused、pending 還在、零件沒進背包；useRules 之後套用（沒有正文）、名字仍是 AI 給的', async () => {
    const fake = new FakeProvider({ byTask: { narrate: Array.from({ length: 4 }, () => ({ refusal: true })) } })
    const { game } = make({ fake })
    const id = idsOf(game)[0]!
    const r = await game.unregDeliver(id)
    expect(r.status).toBe('paused')
    expect(r.run.step('design').status).toBe('done')
    expect(r.run.step('text').status).toBe('failed')
    expect(bag(game)).toEqual([])
    expect(idsOf(game)).toEqual([id])
    const done = await game.useRules('text')
    expect(done.status).toBe('applied')
    expect(partOfBag(game)!.name).toBe('測試件一')
    expect(done.reports[0]!.narration?.text).toBeUndefined()
    expect(idsOf(game)).toEqual([])
  })

  it('opts.autoRules：停在半路時自動改用規則', async () => {
    const fake = new FakeProvider({ byTask: { narrate: Array.from({ length: 4 }, () => ({ refusal: true })) } })
    const { game } = make({ fake })
    const r = await game.unregDeliver(idsOf(game)[0]!, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(bag(game)).toHaveLength(1)
  })
})

// ======================================================================
describe('不改規則：功能的純函式照舊、AI 的輸出只有三段文字', () => {
  it('design_part 的 check：只收 { name, desc, quirk }；多一個欄位、數字、重複的名字都不過，錯誤是 textProblems 的原句', () => {
    const { game } = make()
    const t = game.tasks.get('design_part')!
    const view = { id: idsOf(game)[0]! } as never
    const input = { state: game.state, view }
    const ok = t.check({ name: '好名字', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。' }, input, {} as never)
    expect(ok).toMatchObject({ ok: true, value: { name: '好名字', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。' } })
    for (const raw of [
      { name: '好名字', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。', stats: { damage: 9 } },
      { name: '好名字2', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。' },
      { name: '鐵牙槍管', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。' },
      { name: '好名字', desc: '短', quirk: '一件有點麻煩的事情。' },
      '不是物件', null, [],
    ]) {
      const r = t.check(raw, input, {} as never)
      expect(r.ok).toBe(false)
    }
    const bad = t.check({ name: '好名字', desc: '一句好的說明喔。', quirk: '一件有點麻煩的事情。', grade: 5 }, input, {} as never)
    expect(bad).toEqual({ ok: false, errors: ['grade：多出來的欄位，只能寫 name、desc、quirk。'] })
  })
})
