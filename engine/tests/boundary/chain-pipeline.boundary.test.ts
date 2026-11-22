// 邊界測試：任務鏈的管線（AI_TASKS 2.2 節：依賴、同時跑最多 3 個、判定與寫正文之間隔著程式、結果在寫正文之前）
// 與 2.5 節、EVENTS 2.4 節的時間（time 自己不夾；一次行動的總時間合計後受行動種類的時間上限管）。cpp-tester-boundary 寫的。
//
// 同時跑：0、1、3（上限）、4（上限+1）、10 個沒有依賴關係的 AI 步驟；性質：隨機的依賴圖，每一步都在它依賴的步驟完成之後才開始、
// 同時跑的請求不超過 3 個、套用最後。B006、B007（dev/bugs/）已經修好，這裡有它們的回歸測試。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { AiRequest, ChainDef, ChainTemplate, NarrateOutput, ResolvedEffects, StepTemplate } from '../../src'
import { ChainRun, FREE_ACTION_TEMPLATE, FakeProvider, Limiter, MAX_CONCURRENT_REQUESTS, TaskRegistry, inputOf, sectionOf, validateTemplate } from '../../src'
import type { ProbeEvent } from '../../src'
import { makeGame, observed, stateHash } from '../../src/testkit'

/** 一個只回 { ok: 1 } 的任務，和一條照模板跑的鏈 */
function harness(template: ChainTemplate, delays: number[] = [], whens: ChainDef['whens'] = {}) {
  const script = Array.from({ length: 200 }, (_, i) => ({ json: { ok: 1 }, delayMs: delays[i % Math.max(1, delays.length)] ?? 2 }))
  const { game } = makeGame({ fake: new FakeProvider({ script }) })
  const tasks = new TaskRegistry(game.k.probe)
  tasks.register({ id: 'echo', owner: 'test', size: 'S', output: 'json', onExhausted: 'fallback', build: () => ({ system: '', sections: [] }), check: (raw) => ({ ok: true, value: raw }), fallback: () => ({ ok: 0 }) })
  const limiter = new Limiter()
  const def: ChainDef = {
    template, code: 'test', hasText: false,
    codeSteps: { mark: async () => { await new Promise((r) => setTimeout(r, 1)); return true }, gate: () => ({ branch: 'yes' }) },
    whens,
    aiInput: () => ({}),
    apply: () => ({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: [{ op: 'counter', key: 'applied', delta: 1 }], outcome: { result: 'ok', summary: '' } }),
  }
  const run = new ChainRun({ k: game.k, tasks, taskEnv: { hub: game.hub, limiter, probe: game.k.probe, now: () => 0, idleTimeoutMs: 500 } }, def, game.state, {}, game.settings)
  return { game, run, limiter }
}

const fan = (n: number): ChainTemplate => ({
  chain: `fan${n}`,
  steps: [
    { id: 'start', kind: 'code', run: 'mark' },
    ...Array.from({ length: n }, (_, i): StepTemplate => ({ id: `ai${i}`, kind: 'ai', task: 'echo', needs: ['start'] })),
    { id: 'apply', kind: 'apply' },
  ],
})

/** 探針的 chain.step 事件 → 每一步每一種狀態第一次出現的位置 */
function timeline(events: ProbeEvent[]): Array<{ step: string; status: string }> {
  return events.filter((e) => e.type === 'chain.step').map((e) => e.data as { step: string; status: string })
}

// ---------------------------------------------------------------------------------------------

describe('邊界 AI_TASKS 2.2：同時跑的 AI 請求最多 3 個', () => {
  for (const n of [0, 1, 2, 3, 4, 10]) {
    it(`${n} 個沒有依賴關係的 AI 步驟：同時跑的最多 min(${n}, 3) = ${Math.min(n, 3)}；全部跑完、套用一次`, async () => {
      const { game, run, limiter } = harness(fan(n), [15])
      expect(MAX_CONCURRENT_REQUESTS).toBe(3)
      expect(await run.run()).toBe('applied')
      expect(limiter.peak).toBe(Math.min(n, 3))
      expect(limiter.active).toBe(0)
      expect(run.steps.filter((s) => s.kind === 'ai').every((s) => s.status === 'done')).toBe(true)
      expect(game.state.counters.applied).toBe(1)
    })
  }

  it('上限+1 的請求在排隊：第 4 個請求要等前面有一個結束才送出', async () => {
    const { run, limiter } = harness(fan(4), [30, 30, 30, 1])
    const starts: number[] = []
    const orig = limiter.run.bind(limiter)
    let running = 0
    limiter.run = (<T>(fn: () => Promise<T>) => orig(async () => { running++; starts.push(running); try { return await fn() } finally { running-- } })) as typeof limiter.run
    expect(await run.run()).toBe('applied')
    expect(Math.max(...starts)).toBe(3)
    expect(starts).toHaveLength(4)
  })

  it('性質：隨機的依賴圖（1～9 步、程式與 AI 混合、隨機的延遲）：每一步都在它依賴的步驟完成之後才開始；同時跑 ≤ 3；套用最後、只一次；套用之前狀態沒變', async () => {
    const graph = fc.integer({ min: 1, max: 9 }).chain((n) => fc.tuple(
      fc.array(fc.constantFrom<'ai' | 'code'>('ai', 'code'), { minLength: n, maxLength: n }),
      fc.array(fc.array(fc.nat(), { maxLength: 3 }), { minLength: n, maxLength: n }),
      fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 6 }),
    ))
    await fc.assert(fc.asyncProperty(graph, async ([kinds, rawNeeds, delays]) => {
      const steps: StepTemplate[] = kinds.map((kind, i) => {
        const needs = i === 0 ? [] : [...new Set(rawNeeds[i]!.map((x) => `s${x % i}`))]
        return kind === 'ai' ? { id: `s${i}`, kind, task: 'echo', needs } : { id: `s${i}`, kind, run: 'mark', needs }
      })
      const template: ChainTemplate = { chain: 'random', steps: [...steps, { id: 'apply', kind: 'apply' }] }
      validateTemplate(template)
      const { game, run, limiter } = harness(template, delays)
      const before = stateHash(game.state)
      game.k.probe.start()
      let midway = true
      const origCommit = run.def.apply
      run.def.apply = (ctx) => { midway = stateHash(game.state) === before; return origCommit(ctx) }
      const status = await run.run()
      const events = timeline(game.k.probe.stop())
      if (status !== 'applied' || !midway || limiter.peak > 3 || game.state.counters.applied !== 1) return false
      // 依賴：一步的 running 出現之前，它依賴的每一步都已經 done
      for (const s of steps) {
        const startAt = events.findIndex((e) => e.step === s.id && e.status === 'running')
        for (const n of s.needs ?? []) {
          const doneAt = events.findIndex((e) => e.step === n && e.status === 'done')
          if (doneAt < 0 || doneAt > startAt) return false
        }
      }
      const applyAt = events.findIndex((e) => e.step === 'apply' && e.status === 'running')
      return events.slice(0, applyAt).every((e) => e.step !== 'apply') && events.filter((e) => e.step !== 'apply' && e.status === 'done').every((e) => events.indexOf(e) < applyAt)
    }), { numRuns: 60 })
  })

  it('模板的格式：依賴排在後面的步驟、依賴自己、不存在的步驟、兩個 apply、apply 不在最後，都擋', () => {
    const apply = { id: 'apply', kind: 'apply' as const }
    expect(() => validateTemplate({ chain: 't', steps: [{ id: 'a', kind: 'code', run: 'x', needs: ['a'] }, apply] })).toThrow()
    expect(() => validateTemplate({ chain: 't', steps: [{ id: 'a', kind: 'code', run: 'x', needs: [''] }, apply] })).toThrow()
    expect(() => validateTemplate({ chain: 't', steps: [apply, { id: 'b', kind: 'apply' }] })).toThrow()
    expect(() => validateTemplate({ chain: 't', steps: [] })).toThrow()
    // 最小的合格模板：只有 apply
    expect(() => validateTemplate({ chain: 't', steps: [apply] })).not.toThrow()
    fc.assert(fc.property(fc.integer({ min: 2, max: 8 }), fc.nat(), (n, x) => {
      const i = x % (n - 1)
      const steps: StepTemplate[] = Array.from({ length: n }, (_, j) => ({ id: `s${j}`, kind: 'code', run: 'x', ...(j === i ? { needs: [`s${i + 1 + (x % (n - i - 1 || 1))}`] } : {}) }))
      try { validateTemplate({ chain: 't', steps: [...steps, apply] }); return false } catch { return true }
    }))
  })
})

describe('邊界 AI_TASKS 2.2：判定與寫正文之間隔著程式；結果在寫正文之前', () => {
  it('自由行動的模板：寫正文依賴算回報，算回報依賴參考範圍（程式），參考範圍依賴判定', () => {
    const t = FREE_ACTION_TEMPLATE
    const needs = (id: string) => t.steps.find((s) => s.id === id)!.needs ?? []
    expect(needs('text')).toContain('reward')
    expect(needs('reward')).toContain('hint')
    expect(t.steps.find((s) => s.id === 'hint')!.kind).toBe('code')
    expect(needs('hint')).toContain('judge')
  })

  it('寫正文收到的 <results> 是夾過的值；寫正文交什麼數字都不改狀態（開與關兩條路）', async () => {
    for (const clamp_asked of [1, 0]) {
      const { game, fake } = makeGame({
        ai: { ai: 1, clamp_asked },
        fake: { byTask: {
          reward: [{ json: { items: [{ kind: 'cash', amount: 500, from: { source: 'degree' } }] } }],
          narrate: [(req: AiRequest) => ({ text: `你拿到 999999 元，還有一把神劍。\n<covered>${(inputOf<{ results: string[] }>(req).results).map((_, i) => i + 1).join(',')}</covered>` })],
        } },
      })
      const r = await game.act({ kind: 'free', text: '我要錢' })
      expect(r.status).toBe('applied')
      const results = sectionOf(fake!.requestsFor('narrate')[0]!, 'results')!
      expect(results).toContain('120')
      expect(results).not.toContain('500')
      expect(game.state.money.cash).toBe(120)
      expect((r.run.draft.text as NarrateOutput).text).toContain('999999')
      expect((r.run.draft.reward as ResolvedEffects).changes).toEqual([{ op: 'cash', delta: 120 }])
    }
  })

  it('B006：模板的格式檢查擋下「寫正文直接接在判定後面、中間沒有程式」的模板', () => {
    expect(() => validateTemplate({
      chain: 'no_code_between',
      steps: [{ id: 'judge', kind: 'ai', task: 'judge' }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge'] }, { id: 'apply', kind: 'apply' }],
    })).toThrow(/隔著程式/)
  })

  it('「隔著程式」怎麼算（dev/adr/0009）：寫正文依賴的步驟裡要有一個程式步驟，而且那個程式步驟依賴判定', () => {
    const judge: StepTemplate = { id: 'judge', kind: 'ai', task: 'judge' }
    const apply: StepTemplate = { id: 'apply', kind: 'apply' }
    const ok = (steps: StepTemplate[]) => expect(() => validateTemplate({ chain: 't', steps: [...steps, apply] })).not.toThrow()
    const bad = (steps: StepTemplate[]) => expect(() => validateTemplate({ chain: 't', steps: [...steps, apply] })).toThrow(/隔著程式/)
    // 程式夾在中間：直接的、隔一層 AI 的；寫正文可以同時直接依賴判定
    ok([judge, { id: 'hint', kind: 'code', run: 'x', needs: ['judge'] }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['hint'] }])
    ok([judge, { id: 'hint', kind: 'code', run: 'x', needs: ['judge'] }, { id: 'reward', kind: 'ai', task: 'reward', needs: ['judge', 'hint'] }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge', 'reward'] }])
    // 程式在判定之前（不是夾在中間）、程式和判定沒有關係、寫正文沒有依賴那個程式：都不算
    bad([{ id: 'roll', kind: 'code', run: 'x' }, { ...judge, needs: ['roll'] }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge'] }])
    bad([judge, { id: 'side', kind: 'code', run: 'x' }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge', 'side'] }])
    bad([judge, { id: 'hint', kind: 'code', run: 'x', needs: ['judge'] }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge'] }])
    // 只隔著 AI 的步驟（沒有程式）也不算
    bad([judge, { id: 'reward', kind: 'ai', task: 'reward', needs: ['judge'] }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['reward'] }])
    // 沒有判定的鏈、寫正文不依賴判定的鏈不受這一條限制
    ok([{ id: 'settle', kind: 'code', run: 'x' }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['settle'] }])
    ok([judge, { id: 'text', kind: 'ai', task: 'narrate' }])
    ok([{ id: 'text', kind: 'ai', task: 'narrate' }])
    // 兩個判定：每一個都要隔著程式
    bad([judge, { id: 'judge2', kind: 'ai', task: 'judge' }, { id: 'hint', kind: 'code', run: 'x', needs: ['judge'] }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['hint', 'judge2'] }])
    // 自由行動的模板合格
    expect(() => validateTemplate(FREE_ACTION_TEMPLATE)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------
// AI_TASKS 2.5 節、EVENTS 2.4 節：time 自己不夾；一次行動的總時間（判定的時間加上結算裡的 time）合計後受行動種類的時間上限管

describe('邊界 AI_TASKS 2.5／EVENTS 2.4：行動的總時間合計後受行動種類的時間上限管', () => {
  const FREE_MAX = 240
  const act = async (hours: unknown, clamp_asked = 1, asked?: string) => {
    const item = { kind: 'time', hours, ...(asked ? { asked, from: { source: 'player', quote: asked } } : { from: { source: 'degree' } }) }
    const { game } = makeGame({ ai: { ai: 1, clamp_asked, retry: { reward: 0 } }, fake: { byTask: { reward: [{ json: { items: [item] } }] } } })
    const t0 = game.state.time
    const r = await game.act({ kind: 'free', text: '我等一下，等很久很久' }, { autoRules: true })
    const minutes = (r.run.draft.judge as { judgment: { minutes: number } }).judgment.minutes
    const passed = (game.state.time.day - t0.day) * 1440 + (game.state.time.hour - t0.hour) * 60 + (game.state.time.minute - t0.minute)
    return { game, r, minutes, passed }
  }

  it('合計在上限內：0 小時不推時間、不算失敗；0.5、1、3.5 小時（合計剛好 240 分鐘）照給。都不留夾值的記號', async () => {
    for (const [hours, extra] of [[0, 0], [0.5, 30], [1, 60], [3.5, 210]] as const) {
      const { r, minutes, passed } = await act(hours)
      expect(minutes).toBe(30)
      expect(r.status).toBe('applied')
      expect(passed, `${hours} 小時`).toBe(minutes + extra)
      expect(r.run.step('reward').marks).not.toContain('clamped')
    }
  })

  it('合計超過上限（上限+1 分鐘、24 小時、1,000 小時）：結算的 time 被扣到合計剛好等於上限，留記號，提醒照實寫時數；存檔讀得回來', async () => {
    for (const hours of [211 / 60, 24, 1000]) {
      const { game, r, minutes, passed } = await act(hours)
      expect(passed, `${hours} 小時`).toBe(FREE_MAX)
      expect(r.run.step('reward').marks).toContain('clamped')
      const c = r.run.step('reward').clamps![0]!
      expect(c).toMatchObject({ to: FREE_MAX - minutes, limit: FREE_MAX - minutes })
      expect(c.notice).toBe('這件事最多花 4 小時，所以只再多花了 3 小時 30 分鐘。')
      expect(r.reports[0]!.narration!.results).toEqual(['時間：過了 3 小時 30 分鐘'])
      expect(game.load(game.save())).toBeNull()
    }
  })

  it('拆成幾筆給也一樣：三筆各 2 小時，合計扣到上限（從最後一筆往回扣）', async () => {
    const { game } = makeGame({ ai: { ai: 1 }, fake: { byTask: { reward: [{ json: { items: [1, 2, 3].map(() => ({ kind: 'time', hours: 2, from: { source: 'degree' } })) } }] } } })
    const r = await game.act({ kind: 'free', text: '我等一下' })
    expect(game.state.time).toEqual({ day: 1, hour: 12, minute: 0 })
    expect(r.reports[0]!.narration!.results).toEqual(['時間：過了 2 小時', '時間：過了 1 小時 30 分鐘'])
    expect(r.run.step('reward').clamps!.map((c) => c.path)).toEqual(['reward.items[1]', 'reward.items[2]'])
  })

  it('設定關著、玩家明說要的（asked 對得上）：time 不受上限管，照給；對不上的照樣合計後夾', async () => {
    const free = await act(1000, 0, '等很久很久')
    expect(free.passed).toBe(free.minutes + 60000)
    expect(free.r.run.step('reward').marks).not.toContain('clamped')
    const not = await act(1000, 0, '玩家沒有說過的話')
    expect(not.r.run.step('reward').status).toBe('fallback')
    expect(not.passed).toBe(not.minutes)
  })

  it('負數、NaN、字串、null 是格式錯誤：算回報失敗（自動重試設 0），照規則代替（退路），時間只走判定的那一段', async () => {
    for (const hours of [-1, Number.NaN, '3', null]) {
      const { r, minutes, passed } = await act(hours)
      expect(r.status).toBe('applied')
      expect(r.run.step('reward').status).toBe('fallback')
      expect(passed).toBe(minutes)
    }
  })

  it('B007：AI 交的 time 大到換算之後不是安全整數（1e308、1e300 小時；設定開或關都一樣），算回報就判格式錯誤（走重試或退路），不是到套用才丟錯', async () => {
    for (const hours of [1e308, 1e300, Number.MAX_VALUE]) {
      for (const clamp_asked of [1, 0]) {
        const { game, r, minutes, passed } = await act(hours, clamp_asked, clamp_asked ? undefined : '等很久很久')
        expect(r.status).toBe('applied')
        expect(r.run.step('reward').status).toBe('fallback')
        expect(r.run.step('reward').error?.details.join('')).toMatch(/hours/)
        expect(passed).toBe(minutes)
        expect(Number.isSafeInteger(game.state.time.day)).toBe(true)
      }
    }
  })

  it('B007：不走退路的寫法也一樣（自動重試用完之前就擋下）：行動不會整個丟出去，不變式成立', async () => {
    const { game } = makeGame({ ai: { ai: 1 }, fake: { byTask: { reward: [{ json: { items: [{ kind: 'time', hours: 1e308, from: { source: 'degree' } }] } }] } } })
    const { result, violations } = await observed(game, () => game.act({ kind: 'free', text: '我等一下' }, { autoRules: true }))
    expect(result.status).toBe('applied')
    expect(violations).toEqual([])
    expect(game.undo.size).toBe(1)
    expect(game.state.time).toEqual({ day: 1, hour: 8, minute: 30 })
  })

  it('性質：設定開著，不論 AI 交幾筆、多少小時的 time，行動花的時間不超過行動種類的上限；套用不會失敗', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.oneof(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.integer({ min: 0, max: 48 })), { maxLength: 5 }), fc.integer({ min: 0, max: 9999 }), async (list, judgeMinutes) => {
      const { game } = makeGame({ ai: { ai: 1 }, fake: { byTask: {
        judge: [(req: AiRequest) => ({ json: { degree: inputOf<{ roll: { degree: string } }>(req).roll.degree, minutes: judgeMinutes } })],
        reward: [{ json: { items: list.map((hours) => ({ kind: 'time', hours, from: { source: 'degree' } })) } }],
      } } })
      const r = await game.act({ kind: 'free', text: '我等一下' })
      const passed = (game.state.time.day - 1) * 1440 + (game.state.time.hour - 8) * 60 + game.state.time.minute
      return r.status === 'applied' && passed <= FREE_MAX && passed >= Math.min(judgeMinutes, FREE_MAX)
    }), { numRuns: 40 })
  })
})
