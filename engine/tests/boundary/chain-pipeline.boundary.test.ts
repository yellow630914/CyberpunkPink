// 邊界測試：任務鏈的管線（AI_TASKS 2.2 節：依賴、同時跑最多 3 個、判定與寫正文之間隔著程式、結果在寫正文之前）
// 與 2.5 節「time 不另外夾」。cpp-tester-boundary 寫的。
//
// 同時跑：0、1、3（上限）、4（上限+1）、10 個沒有依賴關係的 AI 步驟；性質：隨機的依賴圖，每一步都在它依賴的步驟完成之後才開始、
// 同時跑的請求不超過 3 個、套用最後。已知會失敗的用 it.fails 標著（見 dev/bugs/）。

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

  it.fails('B006：模板的格式檢查擋下「寫正文直接接在判定後面、中間沒有程式」的模板（validateTemplate 的說明寫了這一條，但沒有做）', () => {
    expect(() => validateTemplate({
      chain: 'no_code_between',
      steps: [{ id: 'judge', kind: 'ai', task: 'judge' }, { id: 'text', kind: 'ai', task: 'narrate', needs: ['judge'] }, { id: 'apply', kind: 'apply' }],
    })).toThrow()
  })
})

// ---------------------------------------------------------------------------------------------
// AI_TASKS 2.5 節、EVENTS 2.4 節：time 不另外夾

describe('邊界 AI_TASKS 2.5：time 不另外夾（設定開著也不夾）', () => {
  const act = async (hours: unknown, clamp_asked = 1) => {
    const { game } = makeGame({ ai: { ai: 1, clamp_asked, retry: { reward: 0 } }, fake: { byTask: { reward: [{ json: { items: [{ kind: 'time', hours, from: { source: 'degree' } }] } }] } } })
    const t0 = game.state.time
    const r = await game.act({ kind: 'free', text: '我等一下' }, { autoRules: true })
    const minutes = (r.run.draft.judge as { judgment: { minutes: number } }).judgment.minutes
    const passed = (game.state.time.day - t0.day) * 1440 + (game.state.time.hour - t0.hour) * 60 + (game.state.time.minute - t0.minute)
    return { game, r, minutes, passed }
  }

  it('0 小時：不推時間、不算失敗；1 小時：多 60 分鐘；24 小時：多一天。都不留夾值的記號', async () => {
    for (const [hours, extra] of [[0, 0], [1, 60], [24, 1440], [0.5, 30]] as const) {
      const { r, minutes, passed } = await act(hours)
      expect(r.status).toBe('applied')
      expect(passed, `${hours} 小時`).toBe(minutes + extra)
      expect(r.run.step('reward').marks).not.toContain('clamped')
    }
  })

  it('負數、NaN、字串、null 是格式錯誤：算回報失敗（自動重試設 0），照規則代替（退路），時間只走判定的那一段', async () => {
    for (const hours of [-1, Number.NaN, '3', null]) {
      const { r, minutes, passed } = await act(hours)
      expect(r.status).toBe('applied')
      expect(r.run.step('reward').status).toBe('fallback')
      expect(passed).toBe(minutes)
    }
  })

  it('現況：設定開著，AI 交 1,000 小時也照給（時間跳 41 天多）；判定的時間照樣夾在 240 分鐘', async () => {
    const { game, r, minutes, passed } = await act(1000)
    expect(minutes).toBeLessThanOrEqual(240)
    expect(passed).toBe(minutes + 60000)
    expect(r.run.step('reward').marks).not.toContain('clamped')
    expect(game.load(game.save())).toBeNull()
  })

  it.fails('B007：AI 交的 time 大到換算之後不是安全整數（1e308 小時）時，算回報就要判格式錯誤（走重試或退路），不是到套用才丟錯', async () => {
    const { r } = await act(1e308)
    expect(r.status).toBe('applied')
    expect(r.run.step('reward').status).not.toBe('done')
  })

  it('B007 的現況：算回報標成完成，套用時「變更不合法」丟錯，整個行動丟出去；狀態不變、回退不留步數', async () => {
    const { game } = makeGame({ ai: { ai: 1 }, fake: { byTask: { reward: [{ json: { items: [{ kind: 'time', hours: 1e308, from: { source: 'degree' } }] } }] } } })
    const h = stateHash(game.state)
    const { result, violations } = await observed(game, () => game.act({ kind: 'free', text: '我等一下' }, { autoRules: true }).then(() => 'ok', (e: Error) => e.message))
    expect(result).toMatch(/變更不合法/)
    expect(violations).toEqual([])
    expect(stateHash(game.state)).toBe(h)
    expect(game.undo.size).toBe(0)
  })

  it.fails('B007：AI 交 1e300 小時，時間的天數變成 4e298（不是安全整數，再加分鐘不會動）——驗證應該擋下', async () => {
    const { game, r } = await act(1e300)
    expect(r.run.step('reward').status).not.toBe('done')
    expect(Number.isSafeInteger(game.state.time.day)).toBe(true)
  })
})
