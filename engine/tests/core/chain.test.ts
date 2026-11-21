import { describe, expect, it } from 'vitest'
import type { ActionKindDef, AiRequest, ChainDef, Feature, JudgeOutput, NarrateOutput, ResolvedEffects } from '../../src'
import { ADVERSARIAL_MODES, ChainRun, FakeProvider, Limiter, MAX_CONCURRENT_REQUESTS, TaskRegistry, adversarial, clone, inputOf, sectionOf, splitCovered, validateTemplate } from '../../src'
import { makeGame, observed } from '../../src/testkit'

/** 測試用的行動：乞討。成功拿現金 20、大成功 40（照等級）。 */
const beg: ActionKindDef = {
  id: 'beg', owner: 'test', name: '乞討', attr: 'charm', skill: 'perform', dc: 'easy', minutes: 60, maxMinutes: 120, reportKind: 'action',
  hint: ({ degree, grade }) => (degree === 'critical' ? [{ kind: 'cash', amount: 40 * grade }] : degree === 'success' ? [{ kind: 'cash', amount: 20 * grade }] : []),
}
const testFeature: Feature = { id: 'test_actions', install: (k) => k.actions.register(beg) }
/** 一定成功的主角（魅力 18、表演 6：最低 1+4+6=11 ≥ 10；自然 1 另外算） */
const ace = { attrs: { charm: 18 }, skills: { perform: 6 } }
const TEXT = '我跪下來求那個穿西裝的人，他心軟給了我一張金卡'
const judgeOk = (over: Record<string, unknown> = {}) => (req: AiRequest) => {
  const i = inputOf<{ roll: { degree: string }; ref_dc: number }>(req)
  return { json: { degree: i.roll.degree, dc: i.ref_dc, reason: '那個穿西裝的人看了你一眼。', twist: '他連菸帶硬幣一起丟給你', minutes: 60, ...over } }
}
const setup = (o: Parameters<typeof makeGame>[0] = {}) => makeGame({ features: [testFeature], pc: ace, ...o })

// 規格：AI_TASKS 第 2 節（任務鏈的模型）、3.1 節（自由行動）、4.1 節（任務）、5.3 節（自動重試）、5.5 節（清理）
describe('L7 任務鏈：自由行動', () => {
  it('AI 關閉：每一步都走退路，鏈照樣跑完（判定照骰值、回報是參考範圍的一半、沒有正文）', async () => {
    const { game } = setup()
    const { result, violations } = await observed(game, () => game.act({ kind: 'beg', text: TEXT }))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    expect(result.run.steps.map((s) => [s.id, s.status])).toEqual([
      ['roll', 'done'], ['judge', 'fallback'], ['hint', 'done'], ['person', 'skipped'], ['reward', 'fallback'], ['relate', 'skipped'], ['text', 'fallback'], ['apply', 'done'],
    ])
    const report = result.reports[0]!
    expect(report.narration?.text).toBeUndefined()
    expect(report.outcome.summary).toContain('乞討')
    const degree = report.outcome.result
    expect(game.state.money.cash).toBe(degree === 'critical' ? 20 : degree === 'success' ? 10 : 0)
    expect(game.state.chains).toHaveLength(1)
    expect(game.state.seq).toMatchObject({ chain: 1, floor: 1 })
  })

  it('AI 開著：判定 → 參考範圍 → 算回報 → 寫正文 → 套用；寫正文收到 <results>、交 <covered>', async () => {
    const { game, fake } = setup({
      fake: {
        byTask: {
          judge: [judgeOk()],
          reward: [{ json: { items: [{ kind: 'cash', amount: 12, from: { source: 'judgment', quote: '連菸帶硬幣' } }] } }],
          narrate: [{ text: '路人把東西丟在你腳邊。\n<covered>1</covered>' }],
        },
      },
    })
    const { result, violations } = await observed(game, () => game.act({ kind: 'beg', text: TEXT }))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    expect(result.run.steps.filter((s) => s.kind === 'ai' && s.status !== 'skipped').map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(game.state.money.cash).toBe(12)
    const report = result.reports[0]!
    expect(report.narration).toEqual({ results: ['拿到：現金 12'], text: '路人把東西丟在你腳邊。' })
    expect(report.narration!.text).not.toContain('covered')
    expect(report.chain).toBe('c1')
    // 請求的順序：判定與寫正文之間隔著程式；結果任務在寫正文之前
    expect(fake!.requests.map((r) => r.task)).toEqual(['judge', 'reward', 'narrate'])
    const narrateReq = fake!.requestsFor('narrate')[0]!
    expect(sectionOf(narrateReq, 'results')).toBe('1. 拿到：現金 12')
    expect(sectionOf(narrateReq, 'previous_error')).toBeNull()
    expect(narrateReq.meta).toMatchObject({ chain: 'c1', step: 'text', attempt: 1 })
  })

  it('夾值發生在寫正文之前：寫正文收到的是夾過的值；報告卡有白話的提醒', async () => {
    const { game, fake } = setup({
      fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'cash', amount: 50000, asked: '一張金卡', from: { source: 'player', quote: '一張金卡' } }] } }] } },
    })
    const { run, reports } = await game.act({ kind: 'beg', text: TEXT })
    expect(run.step('reward').status).toBe('done')
    expect(run.step('reward').marks).toEqual(['clamped'])
    expect(run.step('reward').clamps![0]).toMatchObject({ from: 50000, to: 120 })
    expect(sectionOf(fake!.requestsFor('narrate')[0]!, 'results')).toBe('1. 拿到：現金 120')
    expect(JSON.stringify(fake!.requestsFor('narrate')[0])).not.toContain('50000')
    expect(game.state.money.cash).toBe(120)
    expect(reports[0]!.clamps![0]!.notice).toBe('你要的比這一區給得起的多，實際拿到 120 元。')
  })

  it('「玩家要求的結果也夾值」關著：附 asked 而且對得上的不夾；對不上的照夾', async () => {
    const reply = (asked: string) => ({ json: { items: [{ kind: 'cash', amount: 50000, asked, from: { source: 'player', quote: '一張金卡' } }] } })
    const off = setup({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { judge: [judgeOk()], reward: [reply('給了我一張金卡')] } } })
    await off.game.act({ kind: 'beg', text: TEXT })
    expect(off.game.state.money.cash).toBe(50000)
    expect(off.game.lastRun!.step('reward').marks).toEqual([])
    const mismatch = setup({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { judge: [judgeOk()], reward: [reply('玩家沒有說過的一句話')] } } })
    await mismatch.game.act({ kind: 'beg', text: TEXT })
    expect(mismatch.game.state.money.cash).toBe(120)
  })

  it('驗證不過算失敗：自動重試時把錯誤放進 <previous_error>，不帶上一次的整份輸出', async () => {
    const { game, fake } = setup({
      fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'godsword', power: 9001, from: { source: 'degree' } }] } }, { json: { items: [{ kind: 'cash', amount: 7, from: { source: 'degree' } }] } }] } },
    })
    const { run } = await game.act({ kind: 'beg', text: TEXT })
    const reqs = fake!.requestsFor('reward')
    expect(reqs).toHaveLength(2)
    expect(sectionOf(reqs[0]!, 'previous_error')).toBeNull()
    expect(sectionOf(reqs[1]!, 'previous_error')).toMatch(/reward\.items\[0\]\.kind.*不在封閉清單裡/)
    expect(sectionOf(reqs[1]!, 'previous_error')).not.toContain('9001')
    expect(reqs[1]!.meta.attempt).toBe(2)
    expect(run.step('reward').status).toBe('done')
    expect(run.step('reward').attempts!.map((a) => a.error?.kind)).toEqual(['validation', undefined])
    expect(game.state.money.cash).toBe(7)
  })

  it('依據對不上來源的回報不收（H14）', async () => {
    const { game } = setup({
      ai: { ai: 1, retry: { reward: 0 } },
      fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'cash', amount: 7, from: { source: 'judgment', quote: '判定裡沒有的一句話' } }] } }] } },
    })
    const { run } = await game.act({ kind: 'beg', text: TEXT })
    expect(run.step('reward').status).toBe('fallback')
    expect(run.step('reward').error?.details[0]).toMatch(/H14/)
  })

  it('自動重試都失敗：判定停下來等玩家；其他任務自動用規則代替', async () => {
    const { game, fake } = setup({ ai: { ai: 1, retry: { judge: 2, reward: 0 } }, fake: { adversarial: { mode: 'bad_json', tasks: ['judge', 'reward'] } } })
    const blocked = await game.act({ kind: 'beg', text: TEXT })
    expect(blocked.status).toBe('blocked')
    expect(fake!.requestsFor('judge')).toHaveLength(3)
    expect(blocked.run.step('judge').status).toBe('failed')
    expect(blocked.run.step('judge').error?.kind).toBe('format')
    expect(blocked.run.step('reward').status).toBe('waiting')
    expect(game.state.reports).toHaveLength(1)
    expect(game.state.money.cash).toBe(0)
    // 玩家按「用規則代替」：判定走退路，後面照跑；算回報壞掉但它會自動用規則代替
    const done = await game.useRules('judge')
    expect(done.status).toBe('applied')
    expect(done.run.step('judge')).toMatchObject({ status: 'fallback', byRules: true })
    expect(done.run.step('reward').status).toBe('fallback')
    expect(done.run.step('text').status).toBe('done')
  })

  it('被服務商拒絕：不自動重試；玩家可以重試或用規則代替', async () => {
    const { game, fake } = setup({ ai: { ai: 1, retry: { narrate: 3 } }, fake: { byTask: { narrate: [{ refusal: true }] } } })
    const blocked = await game.act({ kind: 'beg', text: TEXT })
    expect(blocked.status).toBe('blocked')
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    expect(blocked.run.step('text').error?.kind).toBe('refusal')
    // 數值在寫正文之前已經定案：改用規則照樣套用
    const done = await game.useRules('text')
    expect(done.status).toBe('applied')
    expect(done.reports[0]!.narration?.text).toBeUndefined()
    expect(game.state.money.cash).toBeGreaterThan(0)
  })

  it('逾時：閒置太久算失敗，會自動重試；取消的不重試', async () => {
    const { game, fake } = setup({ ai: { ai: 1, retry: { judge: 1 } }, idleTimeoutMs: 30, fake: { byTask: { judge: [{ hang: true }] } } })
    const r = await game.act({ kind: 'beg', text: TEXT })
    expect(r.status).toBe('applied')
    expect(r.run.step('judge').attempts!.map((a) => a.error?.kind)).toEqual(['timeout', undefined])
    expect(fake!.requestsFor('judge')).toHaveLength(2)
    expect(sectionOf(fake!.requestsFor('judge')[1]!, 'previous_error')).toBeNull()

    const c = setup({ ai: { ai: 1, retry: { judge: 3 } }, idleTimeoutMs: 5000, fake: { byTask: { judge: [{ hang: true }] } } })
    const pending = c.game.act({ kind: 'beg', text: TEXT })
    await new Promise((res) => setTimeout(res, 20))
    c.game.lastRun!.cancel()
    const cancelled = await pending
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.run.step('judge').error?.kind).toBe('cancel')
    expect(c.fake!.requestsFor('judge')).toHaveLength(1)
    expect(c.game.state.reports).toHaveLength(1)
  })

  it('對抗模式：十種壞掉的回應，沒有一種能把沒驗證過的東西寫進狀態', async () => {
    for (const mode of ADVERSARIAL_MODES) {
      const { game } = setup({ ai: { ai: 1 }, idleTimeoutMs: 30, fake: { adversarial: { mode } } })
      const { result, violations } = await observed(game, () => game.act({ kind: 'beg', text: TEXT }, { autoRules: true }))
      expect(violations, mode).toEqual([])
      expect(result.status, mode).toBe('applied')
      const s = game.state
      // 上限：I 級的錢 120；時間不超過這種行動的上限；DC 在參考值 ±3
      expect(s.money.cash, mode).toBeLessThanOrEqual(120)
      expect(s.time.day * 1440 + s.time.hour * 60 + s.time.minute, mode).toBeLessThanOrEqual(1440 + 8 * 60 + 120)
      const roll = result.reports[0]!.timeline[0]!.roll!
      expect(Math.abs(roll.dc - 10), mode).toBeLessThanOrEqual(3)
      expect(s.inventory, mode).toEqual([])
      expect(Object.keys(s.flags), mode).toEqual([])
      expect(JSON.stringify([result.run.draft, result.reports[0]!.timeline, s.actors, s.ext]), mode).not.toContain('status_bar')
      expect(JSON.stringify(s.reports), mode).not.toContain('status_bar')
    }
  })

  it('對抗模式的每一種都有對應的壞法', () => {
    const req = (task: string, input: unknown): AiRequest => ({ task, system: '', messages: [{ role: 'user', content: `<input>\n${JSON.stringify(input)}\n</input>` }], meta: { attempt: 1 } })
    const judge = req('judge', { roll: { degree: 'success', attr: 'charm', skill: null }, ref_dc: 13, minutes: 30 })
    const reward = req('reward', { hint: [{ kind: 'cash', amount: 20 }] })
    const narrate = req('narrate', { results: ['拿到：現金 12'], report: { actor: 'A', action: 'B', degree: 'C' } })
    expect(() => JSON.parse(adversarial('bad_json', judge).text!)).toThrow()
    expect(adversarial('over_cap', judge).json).toMatchObject({ dc: 99 })
    expect(adversarial('unknown_id', reward).json).toMatchObject({ items: [{ kind: 'no_such_effect' }, { id: 'it_no_such_thing' }] })
    expect(adversarial('missing_field', judge).json).not.toHaveProperty('degree')
    expect(adversarial('extra_field', judge).json).toHaveProperty('status_bar')
    expect(adversarial('refusal', judge).refusal).toBe(true)
    expect(adversarial('timeout', judge).hang).toBe(true)
    expect(adversarial('stream_break', judge).breakAfter).toBe(5)
    expect(adversarial('asked_mismatch', reward).json).toMatchObject({ items: [{ asked: '玩家沒有說過的一句話' }] })
    expect(adversarial('no_covered', narrate).text).not.toContain('<covered>')
  })

  it('對照：少交 <covered> 或漏了一行，標「沒寫到」；不算失敗、不自動重試、不改任何結果', async () => {
    const { game, fake } = setup({ fake: { byTask: { judge: [judgeOk()], narrate: [{ text: '只有一段正文，沒有交 covered。' }] } } })
    const { run, reports, status } = await game.act({ kind: 'beg', text: TEXT })
    expect(status).toBe('applied')
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    expect(run.step('text').status).toBe('done')
    expect(run.step('text').marks).toEqual(['uncovered'])
    expect(reports[0]!.narration!.uncovered).toEqual([1])
    expect(game.state.money.cash).toBeGreaterThan(0)
    expect(splitCovered('正文\n<covered>1, 3</covered>')).toEqual({ text: '正文', covered: [1, 3] })
    expect(splitCovered('正文\n<covered>2')).toEqual({ text: '正文', covered: [2] })
    expect(splitCovered('正文')).toEqual({ text: '正文', covered: null })
    // 手動重試「沒寫到」的寫正文：漏掉的那幾行帶進 <previous_error>
    await game.retryStep('text')
    expect(sectionOf(fake!.requestsFor('narrate')[1]!, 'previous_error')).toBe('正文沒有寫到 <results> 的第 1 行')
  })

  it('寫正文不能寫標題（H10）、不能是空的', async () => {
    const { game, fake } = setup({ ai: { ai: 1, retry: { narrate: 1 } }, fake: { byTask: { narrate: [{ text: '# 狀態\nHP 10\n<covered>1</covered>' }, { text: '\n<covered>1</covered>' }] } } })
    const r = await game.act({ kind: 'beg', text: TEXT })
    expect(r.status).toBe('blocked')
    expect(r.run.step('text').attempts!.map((a) => a.error?.details[0])).toEqual(['H10：正文不寫標題、狀態欄、系統訊息', '正文是空的'])
    expect(sectionOf(fake!.requestsFor('narrate')[1]!, 'previous_error')).toContain('H10')
  })

  it('重試一步：這一步與依賴它的後面幾步重跑；沒有依賴它的保留結果；擲骰不重擲', async () => {
    const { game, fake } = setup({ fake: true })
    const first = await game.act({ kind: 'beg', text: TEXT })
    const natural = first.reports[0]!.timeline[0]!.roll!.natural
    expect(first.run.dependents('reward')).toEqual(['text', 'apply'])
    expect(first.run.dependents('judge')).toEqual(['hint', 'person', 'reward', 'relate', 'text', 'apply'])
    expect(first.run.dependents('text')).toEqual(['apply'])
    // 已經套用的最新一樓：先回退這一次套用，再重跑
    const again = await game.retryStep('reward')
    expect(again.status).toBe('applied')
    expect(fake!.requests.map((r) => r.task)).toEqual(['judge', 'reward', 'narrate', 'reward', 'narrate'])
    expect(again.reports[0]!.timeline[0]!.roll!.natural).toBe(natural)
    expect(game.state.reports.filter((r) => r.action === 'beg')).toHaveLength(1)
    expect(game.state.chains).toHaveLength(1)
    // 只重試寫正文：結果的步驟在它前面，保留原本的結果
    await game.retryStep('text')
    expect(fake!.requests.map((r) => r.task).slice(5)).toEqual(['narrate'])
    expect(() => game.lastRun!.retry('apply')).toThrow()
  })

  it('重擲：換一顆骰，每次都記一筆；依賴它的步驟全部重跑', async () => {
    const { game, fake } = setup({ fake: true })
    const first = await game.act({ kind: 'beg', text: TEXT })
    const n0 = first.reports[0]!.timeline[0]!.roll!.natural
    const second = await game.reroll()
    const roll = second.reports[0]!.timeline[0]!.roll!
    expect(roll.rerolls).toBe(1)
    expect(roll.history).toEqual([n0])
    expect(second.run.step('roll').rerolls).toBe(1)
    expect(fake!.requestsFor('judge')).toHaveLength(2)
    const third = await game.reroll()
    expect(third.reports[0]!.timeline[0]!.roll!.history).toEqual([n0, roll.natural])
    expect(game.state.reports.filter((r) => r.action === 'beg')).toHaveLength(1)
    await expect(game.reroll('judge')).rejects.toThrow(/不是擲骰/)
  })

  it('各任務的開關：自由行動的判定關著就照骰值；敘事關著就不寫正文', async () => {
    const { game, fake } = setup({ ai: { ai: 1, judge_free: 0, narrate: 0 }, fake: true })
    const { run } = await game.act({ kind: 'beg', text: TEXT })
    expect(fake!.requests.map((r) => r.task)).toEqual(['reward'])
    expect(run.step('judge').status).toBe('fallback')
    expect(run.step('text').status).toBe('fallback')
    expect(run.step('reward').status).toBe('done')
  })

  it('潤色：開了的鏈在寫正文之後、套用之前多一步，只改文字', async () => {
    const { game, fake } = setup({ ai: { ai: 1, polish: { free: 1 } }, fake: { byTask: { polish: [{ text: '潤過的正文。\n<covered>1</covered>' }] } } })
    const { run, reports } = await game.act({ kind: 'beg', text: TEXT })
    expect(run.steps.map((s) => s.id)).toEqual(['roll', 'judge', 'hint', 'person', 'reward', 'relate', 'text', 'polish', 'apply'])
    expect(fake!.requests.map((r) => r.task)).toEqual(['judge', 'reward', 'narrate', 'polish'])
    expect(reports[0]!.narration!.text).toBe('潤過的正文。')
    const off = setup({ fake: true })
    expect((await off.game.act({ kind: 'beg', text: TEXT })).run.steps.map((s) => s.id)).not.toContain('polish')
  })

  it('任務鏈的細節存在存檔裡，只留最近五樓；回退刪掉一樓時它的任務鏈一起刪掉', async () => {
    const { game } = setup({ fake: true })
    for (let i = 0; i < 7; i++) await game.act({ kind: 'beg', text: TEXT })
    expect(game.state.chains).toHaveLength(7)
    expect(game.state.chains.filter((c) => !c.cleaned).map((c) => c.floor)).toEqual([3, 4, 5, 6, 7])
    const detail = game.state.chains[6]!.detail as { chain: string; steps: Array<{ id: string; status: string; attempts?: unknown[] }> }
    expect(detail.chain).toBe('free_action')
    expect(detail.steps.find((s) => s.id === 'judge')!.attempts).toHaveLength(1)
    expect(game.undoSteps(1)).toBe(true)
    expect(game.state.chains).toHaveLength(6)
  })

  it('探針看得到任務鏈每一步的狀態變化', async () => {
    const { game } = setup({ fake: true })
    const { events } = await observed(game, () => game.act({ kind: 'beg', text: TEXT }))
    const steps = events.filter((e) => e.type === 'chain.step').map((e) => `${(e.data as { step: string }).step}:${(e.data as { status: string }).status}`)
    expect(steps.slice(0, 4)).toEqual(['roll:running', 'roll:done', 'judge:running', 'judge:done'])
    expect(steps.at(-1)).toBe('apply:done')
    expect(steps).toContain('person:skipped')
  })
})

describe('L7 任務鏈的引擎：依賴、同時跑、分支', () => {
  it('同時跑的 AI 請求不超過 3 個，超過的排隊', async () => {
    const limiter = new Limiter()
    let running = 0, peak = 0
    await Promise.all(Array.from({ length: 10 }, () => limiter.run(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((res) => setTimeout(res, 5))
      running--
    })))
    expect(peak).toBe(MAX_CONCURRENT_REQUESTS)
    expect(limiter.peak).toBe(3)
    expect(limiter.active).toBe(0)
  })

  it('沒有依賴關係的步驟同時跑，但整條鏈最多 3 個請求在跑；分支沒走到的略過；被略過的依賴視為完成', async () => {
    const { game } = makeGame({ fake: new FakeProvider({ script: Array.from({ length: 6 }, () => ({ json: { ok: 1 }, delayMs: 15 })) }) })
    const tasks = new TaskRegistry(game.k.probe)
    tasks.register({ id: 'echo', owner: 'test', size: 'S', output: 'json', onExhausted: 'fallback', build: () => ({ system: '', sections: [] }), check: (raw) => ({ ok: true, value: raw }), fallback: () => ({ ok: 0 }) })
    const order: string[] = []
    const def: ChainDef = {
      template: {
        chain: 'fan',
        steps: [
          { id: 'gate', kind: 'code', run: 'gate', branch: { yes: ['in_a'], no: ['out_a'] } },
          ...['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, kind: 'ai' as const, task: 'echo', needs: ['gate'] })),
          { id: 'in_a', kind: 'ai', task: 'echo', needs: ['a'] },
          { id: 'out_a', kind: 'code', run: 'mark', needs: ['a'] },
          { id: 'after', kind: 'code', run: 'mark', needs: ['out_a', 'in_a'] },
          { id: 'apply', kind: 'apply' },
        ],
      },
      code: 'fan', hasText: false,
      codeSteps: { gate: () => ({ branch: 'yes' }), mark: (_c, s) => { order.push(s.id); return true } },
      aiInput: () => ({}),
      apply: () => ({ kind: 'system', action: 'fan', location: {}, party: [], timeline: [], changes: [{ op: 'counter', key: 'fan', delta: 1 }], outcome: { result: 'ok', summary: '' } }),
    }
    const env = { k: game.k, tasks, taskEnv: { hub: game.hub, limiter: game.limiter, probe: game.k.probe, now: () => 0, idleTimeoutMs: 500 } }
    const run = new ChainRun(env, def, game.state, {}, game.settings)
    expect(await run.run()).toBe('applied')
    expect(game.limiter.peak).toBe(3)
    expect(run.step('out_a').status).toBe('skipped')
    expect(run.step('in_a').status).toBe('done')
    expect(order).toEqual(['after'])
    expect(game.state.counters.fan).toBe(1)
    // 沒有正文的鏈算在當時最新的那一樓
    expect(game.state.chains[0]!.floor).toBe(1)
  })

  it('模板的格式檢查', () => {
    const base = { chain: 't', steps: [{ id: 'a', kind: 'code' as const, run: 'x' }, { id: 'apply', kind: 'apply' as const }] }
    expect(() => validateTemplate(base)).not.toThrow()
    expect(() => validateTemplate({ chain: 't', steps: [base.steps[0]!] })).toThrow(/apply/)
    expect(() => validateTemplate({ chain: 't', steps: [base.steps[1]!, base.steps[0]!] })).toThrow(/apply/)
    expect(() => validateTemplate({ chain: 't', steps: [base.steps[0]!, base.steps[0]!, base.steps[1]!] })).toThrow(/重複/)
    expect(() => validateTemplate({ chain: 't', steps: [{ id: 'a', kind: 'code', run: 'x', needs: ['zzz'] }, base.steps[1]!] })).toThrow(/不存在/)
    expect(() => validateTemplate({ chain: 't', steps: [{ id: 'a', kind: 'code', run: 'x', needs: ['b'] }, { id: 'b', kind: 'code', run: 'x' }, base.steps[1]!] })).toThrow(/前面/)
    expect(() => validateTemplate({ chain: 't', steps: [{ id: 'a', kind: 'ai' }, base.steps[1]!] })).toThrow(/task/)
  })

  it('鏈跑到一半（還沒套用）狀態完全沒變；草稿只在鏈裡', async () => {
    const { game } = setup({ ai: { ai: 1, retry: { judge: 0 } }, fake: { byTask: { judge: [{ refusal: true }] } } })
    const before = clone(game.state)
    const r = await game.act({ kind: 'beg', text: TEXT })
    expect(r.status).toBe('blocked')
    expect(game.state).toEqual(before)
    expect(r.run.draft.roll).toBeDefined()
    // 手動重試：這次假的服務商自己回合格的
    const done = await game.retryStep('judge')
    expect(done.status).toBe('applied')
    expect((done.run.draft.judge as JudgeOutput).judgment.reason).toBe('照骰子與情境判斷。')
    expect((done.run.draft.reward as ResolvedEffects).errors).toEqual([])
    expect((done.run.draft.text as NarrateOutput).uncovered).toEqual([])
  })

  it('停在半路的鏈被新的行動取代：作廢的那一條不留回退的步數', async () => {
    const { game } = setup({ ai: { ai: 1, retry: { judge: 0 } }, fake: { byTask: { judge: [{ refusal: true }] } } })
    await game.act({ kind: 'beg', text: TEXT })
    expect(game.undo.size).toBe(1)
    const r = await game.act({ kind: 'beg', text: TEXT })
    expect(r.status).toBe('applied')
    expect(game.undo.size).toBe(1)
  })
})
