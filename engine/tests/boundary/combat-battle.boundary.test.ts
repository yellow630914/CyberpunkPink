// 邊界測試：整場現實戰鬥的性質（fast-check）與戰鬥結束那條任務鏈的對抗性 AI 回應。cpp-tester-boundary 寫的。
//
// 1. 隨機的種子 × 情境 × 等級 × 遮蔽 × 埋伏 × 黑暗，雙方都由程式打完：每一步之後不變式第 45、49、52、53 條都成立
//    （站位、三條軌、行動點、遮蔽、AI 一回合最多 6 步），提交的不變式（第 2 條）沒有違規，同一個種子結果一樣（第 47 條）。
//    兩套行動都跑：測試用的最小行動（TEST_COMBAT）與正式的功能（allFeatures ＋ 核心資料）。
// 2. 戰鬥結束（AI_TASKS 3.9 節）：寫正文收到十種壞掉的回應 ×「玩家要求的結果也夾值」開與關（2.5 節），
//    結算的結果（三條軌、旗標、快照、亂數）和 AI 關閉時一模一樣；拒絕不自動重試、逾時會重試、少交 <covered> 只標記號；
//    寫正文寫了大數字也進不了狀態。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BattleSetup, BattleState, Feature, GameState, Grade } from '../../src'
import { ADVERSARIAL_MODES, BATTLE_SLOTS, clone, coverHpFor, modeOf } from '../../src'
import { allFeatures } from '../../src/features'
import { characterFeature } from '../../src/features/character'
import { CORE_PACK } from '../../data'
import type { BattleScenarioId } from '../../src/testkit'
import { BATTLE_SETUPS, TEST_COMBAT, makeBattleGame, makeGame, observed, stateHash } from '../../src/testkit'

// ---------------------------------------------------------------------------------------------
// 1. 整場戰鬥

/** 一份戰鬥狀態違反了哪幾條（空的就是都成立）。 */
function battleProblems(b: BattleState, aiMax: number): string[] {
  const p: string[] = []
  for (const side of ['ally', 'foe'] as const) {
    const on = Object.values(b.units).filter((u) => u.side === side && !u.out && u.slot >= 1)
    const slots = on.map((u) => u.slot)
    if (new Set(slots).size !== slots.length) p.push(`${side} 有兩個人站同一格：${slots.join(',')}`)
    if (slots.some((s) => s < 1 || s > BATTLE_SLOTS)) p.push(`${side} 有人站在第 1～4 格以外：${slots.join(',')}`)
    if (on.length > BATTLE_SLOTS) p.push(`${side} 場上超過四個人`)
    for (const id of b.reserve[side]) if (b.units[id]!.slot !== 0 && !b.units[id]!.out) p.push(`${id} 在後方等，卻站在第 ${b.units[id]!.slot} 格`)
    const ov = b.overlays.filter((o) => o.side === side && !o.down).map((o) => o.slot)
    if (new Set(ov).size !== ov.length) p.push(`${side} 一格掛了兩台以上`)
    b.cover[side].forEach((c, i) => {
      if (![0, 1, 2].includes(c.level)) p.push(`${side} 第 ${i + 1} 格的遮蔽等級 ${c.level}`)
      else if (c.level === 0 && c.hp !== 0) p.push(`${side} 第 ${i + 1} 格是暴露卻有耐久 ${c.hp}`)
      else if (c.level > 0) {
        const max = c.max?.[c.level - 1] ?? coverHpFor(modeOf({ get: () => undefined } as never, b.mode)?.numbers ?? (undefined as never), c.level as 1 | 2, b.grade)
        if (!(c.hp > 0 && c.hp <= max)) p.push(`${side} 第 ${i + 1} 格的耐久 ${c.hp} 不在 1～${max}`)
      }
    })
  }
  for (const u of Object.values(b.units)) {
    if (u.hp && (u.hp.now < 0 || u.hp.now > u.hp.max)) p.push(`${u.id} 生命 ${u.hp.now}／${u.hp.max}`)
    if (u.load && !u.out && (u.load.now < 0 || u.load.now >= u.load.max)) p.push(`${u.id} 感載 ${u.load.now}／${u.load.max}（沒倒下就應該在 0～上限−1）`)
    if (u.layers < 0 || u.layers > u.layersMax) p.push(`${u.id} 餘韻 ${u.layers}／${u.layersMax}`)
    if (u.ap.now < 0 || u.ap.now > u.ap.max) p.push(`${u.id} 行動點 ${u.ap.now}／${u.ap.max}`)
    for (const pool of Object.values(u.pools)) if (pool.now < 0 || pool.now > pool.max) p.push(`${u.id} 資源 ${pool.now}／${pool.max}`)
    if (u.hp && u.hp.now === 0 && !u.out) p.push(`${u.id} 生命 0 卻還在場上`)
  }
  if (b.aiSteps > aiMax) p.push(`AI 這一回合做了 ${b.aiSteps} 步（最多 ${aiMax}）`)
  return p
}

const scenarioArb = fc.record({
  seed: fc.integer({ min: 1, max: 1_000_000 }),
  scenario: fc.constantFrom<BattleScenarioId>('encounter', 'encounterElite', 'boss', 'capture', 'hopeless'),
  grade: fc.constantFrom<Grade>(1, 2, 3, 4, 5),
  cover: fc.constantFrom('dense', 'medium', 'sparse', 'one_sided'),
  ambush: fc.constantFrom<'ally' | 'foe' | undefined>(undefined, 'ally', 'foe'),
  dark: fc.boolean(),
})
type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never

const setupOf = (s: Scenario): BattleSetup => ({ ...BATTLE_SETUPS[s.scenario](s.grade), cover: s.cover, ...(s.ambush ? { ambush: s.ambush } : {}), ...(s.dark ? { field: { dark: true } } : {}) })

const SETS: Array<{ name: string; features: () => Feature[]; content?: typeof CORE_PACK[] }> = [
  { name: '測試用的最小行動', features: () => [TEST_COMBAT] },
  { name: '正式的功能與資料', features: () => allFeatures(), content: [CORE_PACK] },
]

/** 打完一場，每一步檢查；回傳結果與最後的雜湊。 */
async function fight(s: Scenario, set: (typeof SETS)[number]) {
  const { game } = makeBattleGame({ battle: setupOf(s), seed: s.seed, features: set.features(), ...(set.content ? { content: set.content } : {}) })
  const aiMax = modeOf(game.k.content, 'meat')!.numbers.aiMaxSteps
  const first = battleProblems(game.battle!, aiMax)
  const { result, violations } = await observed(game, async () => {
    const problems: string[] = [...first]
    let steps = 0
    while (game.battle && !game.battle.result) {
      if (++steps > 3000) throw new Error('打了 3000 步還沒分出結果')
      const r = game.battleNext({ anyone: true })
      if (r.status !== 'applied') throw new Error(`一步沒有成立：${(r.reasons ?? []).join(' ')}`)
      problems.push(...battleProblems(game.battle!, aiMax).map((x) => `第 ${steps} 步：${x}`))
      if (problems.length) break
    }
    const outcome = game.battle?.result?.outcome
    const end = problems.length ? null : await game.finishBattle()
    return { problems, outcome, end, steps }
  })
  return { game, ...result, violations, hash: stateHash(game.state) }
}

describe('邊界：整場現實戰鬥的性質（隨機的種子、情境、等級、遮蔽、埋伏、黑暗）', () => {
  for (const set of SETS) {
    it(`${set.name}：每一步之後站位、三條軌、行動點、遮蔽、AI 的步數都在範圍內；提交沒有違規；一定分得出結果並結算`, async () => {
      await fc.assert(fc.asyncProperty(scenarioArb, async (s) => {
        const r = await fight(s, set)
        expect(r.problems, JSON.stringify(s)).toEqual([])
        expect(r.violations, JSON.stringify(s)).toEqual([])
        expect(['win', 'lose', 'fled', 'surrender']).toContain(r.outcome)
        expect(r.end!.status, JSON.stringify(s)).toBe('applied')
        expect(r.game.battle).toBeNull()
      }), { numRuns: 25 })
    }, 120_000)
  }

  it('同一個種子、同一份設定打兩次，整個狀態一模一樣（不變式第 47 條）', async () => {
    await fc.assert(fc.asyncProperty(scenarioArb, async (s) => {
      const a = await fight(s, SETS[1]!)
      const b = await fight(s, SETS[1]!)
      expect(a.hash).toBe(b.hash)
      expect(a.steps).toBe(b.steps)
    }), { numRuns: 8 })
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// 2. 戰鬥結束的任務鏈 × 對抗性的寫正文 ×「玩家要求的結果也夾值」開與關

/** 主角一個人（從角色上場、三條軌會寫回）對三個首領：一定打輸。 */
function lostBattle(o: { ai?: Record<string, unknown>; fake?: NonNullable<Parameters<typeof makeGame>[0]>['fake']; idleTimeoutMs?: number } = {}) {
  const t = makeGame({ features: [characterFeature, TEST_COMBAT], pc: { hp: 30, load: 3, afterglow: 1, sink: 4 }, actors: [], seed: 11, ...o })
  t.game.startBattle({ ...BATTLE_SETUPS.hopeless(), allies: [{ from: 'actor', id: 'pc' }] })
  while (t.game.battle && !t.game.battle.result) {
    const r = t.game.battleNext({ anyone: true })
    if (r.status !== 'applied') throw new Error((r.reasons ?? []).join(' '))
  }
  return t
}

/** 結算的結果：拿掉任務鏈細節與正文（那是寫正文唯一可以改的東西） */
function settled(s: GameState) {
  const c = clone(s)
  const out = c as unknown as Record<string, unknown>
  delete out.chains
  for (const r of c.reports) {
    delete (r as { chain?: unknown }).chain
    if (r.narration) {
      delete r.narration.text
      delete r.narration.uncovered
    }
  }
  return c
}

describe('邊界 AI_TASKS 3.9／2.5：戰鬥結束的寫正文收到壞掉的回應', () => {
  it('對照組：AI 關閉時只有戰報；主角帶著傷回來（生命最少剩 1）', async () => {
    const { game } = lostBattle()
    const r = await game.finishBattle()
    expect(r.status).toBe('applied')
    expect(game.state.actors.pc!.hp).toBeGreaterThanOrEqual(1)
    expect(r.reports[0]!.narration?.text).toBeUndefined()
  })

  for (const clampAsked of [1, 0]) {
    it(`${clampAsked ? '開' : '關'}：十種壞掉的回應，結算的結果都和 AI 關閉時一模一樣；每一步不是完成就是走退路；存讀檔一樣`, async () => {
      const base = lostBattle()
      await base.game.finishBattle()
      const expected = settled(base.game.state)
      for (const mode of ADVERSARIAL_MODES) {
        const { game, fake } = lostBattle({ ai: { ai: 1, narrate: 1, clamp_asked: clampAsked }, idleTimeoutMs: 30, fake: { adversarial: { mode } } })
        const { result, violations } = await observed(game, () => game.finishBattle({ autoRules: true }))
        expect(violations, mode).toEqual([])
        expect(result.status, mode).toBe('applied')
        expect(settled(game.state), mode).toEqual(expected)
        for (const s of result.run.steps.filter((x) => x.kind === 'ai' && x.status !== 'skipped')) expect(['done', 'fallback'], `${mode} ${s.id}`).toContain(s.status)
        expect(fake!.requestsFor('narrate').length, mode).toBeGreaterThanOrEqual(1)
        // 多出來的欄位、大數字都不在狀態裡（任務鏈細節以外）
        const { chains: _c, ...rest } = game.state
        expect(JSON.stringify(rest), mode).not.toContain('99999')
        const saved = game.save('manual', 't')
        const before = clone(game.state)
        expect(game.load(saved), mode).toBeNull()
        expect(game.state, mode).toEqual(before)
      }
    }, 60_000)
  }

  it('拒絕：只送一次、不自動重試；鏈停下來等玩家，戰鬥還沒收（狀態不變）；「用規則代替」之後照樣套用同一份結算', async () => {
    const base = lostBattle()
    await base.game.finishBattle()
    const { game, fake } = lostBattle({ ai: { ai: 1, narrate: 1, retry: { narrate: 3 } }, fake: { adversarial: { mode: 'refusal', tasks: ['narrate'] } } })
    const before = clone(game.state)
    const r = await game.finishBattle()
    expect(r.status).toBe('paused')
    expect(r.run.step('text').error?.kind).toBe('refusal')
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    expect(game.state.battle).toEqual(before.battle)
    expect(game.state.actors).toEqual(before.actors)
    const ruled = await game.useRules('text')
    expect(ruled.status).toBe('applied')
    expect(settled(game.state)).toEqual(settled(base.game.state))
  })

  it('逾時、串流中斷、壞掉的回應（空的正文）：照設定自動重試（retry 0 → 1 次、2 → 3 次），都失敗後停下來等玩家', async () => {
    for (const mode of ['timeout', 'stream_break', 'bad_json'] as const) {
      for (const [retry, sends] of [[0, 1], [2, 3]] as const) {
        const { game, fake } = lostBattle({ ai: { ai: 1, narrate: 1, retry: { narrate: retry } }, idleTimeoutMs: 20, fake: { adversarial: { mode, tasks: ['narrate'] } } })
        const before = clone(game.state)
        const r = await game.finishBattle()
        expect(fake!.requestsFor('narrate').length, `${mode} retry ${retry}`).toBe(sends)
        expect(r.status, `${mode} retry ${retry}`).toBe('paused')
        expect(game.state.actors, mode).toEqual(before.actors)
      }
    }
  })

  it('少交 <covered>：不算失敗、不重試、不改結算；漏掉的每一行都標出來', async () => {
    const { game, fake } = lostBattle({ ai: { ai: 1, narrate: 1 }, fake: { adversarial: { mode: 'no_covered', tasks: ['narrate'] } } })
    const r = await game.finishBattle()
    expect(r.status).toBe('applied')
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    const end = r.reports[0]!
    expect(end.narration!.results!.length).toBeGreaterThan(0)
    expect(end.narration!.uncovered).toEqual(end.narration!.results!.map((_, i) => i + 1))
  })

  it('寫正文自己寫了數字（「撿到 99,999,999 元、傷全好了」）：狀態一個數字都不變（正文怎麼處理看 B014：照存或被擋下都不改狀態）', async () => {
    const base = lostBattle()
    await base.game.finishBattle()
    for (const clampAsked of [1, 0]) {
      const { game } = lostBattle({ ai: { ai: 1, narrate: 1, clamp_asked: clampAsked }, fake: { byTask: { narrate: [{ text: '你在地上撿到 99999999 元，傷全好了，還多了一把神劍。\n<covered>1</covered>' }, { text: '你在地上撿到 99999999 元，傷全好了，還多了一把神劍。\n<covered>1</covered>' }] } } })
      const r = await game.finishBattle()
      // 被擋下（停在寫正文等玩家）或照存，結果都一樣：用規則代替之後狀態和 AI 關閉時一模一樣
      if (r.status === 'paused') expect((await game.useRules('text')).status).toBe('applied')
      expect(settled(game.state)).toEqual(settled(base.game.state))
    }
  })
})
