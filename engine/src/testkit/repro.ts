// 測試基礎建設：種子重播（dev/test-harness.md 第 4 節）。一份 repro 是「種子＋初始狀態的建構方式＋輸入序列＋期望」。
// 測試失敗時把它存成 engine/tests/fixtures/repro/<id>.json；tests/repro/replay.test.ts 會把資料夾裡的每一份重播一次。
// 這裡只有純函式（不讀寫檔案），讀寫在測試那一邊。

import type { ActionInput } from '../core/action/kinds'
import type { Feature } from '../core/kernel'
import type { GameState } from '../core/types'
import { hash32 } from '../core/util/rng'
import type { AdversarialMode, FakeReply } from '../shell/ai/fakeProvider'
import type { GameSetup, ScenarioId, StateOverrides, TestGame } from './factory'
import { makeGame } from './factory'
import { observed } from './invariants'

export type ReproInput =
  | { type: 'act'; input: ActionInput; autoRules?: boolean }
  | { type: 'undo'; n?: number }
  | { type: 'save_load' }
  | { type: 'reroll'; step?: string }
  | { type: 'retry'; step: string }
  | { type: 'use_rules'; step: string }
  | { type: 'ai'; settings: Record<string, unknown> }

export interface Repro {
  id: string
  /** 這份在重現什麼（bug 的 id、一句話） */
  note: string
  seed: number
  setup: {
    scenario: ScenarioId
    overrides?: Omit<StateOverrides, 'seed'>
    /** AI 的設定；沒有就是 AI 關閉 */
    ai?: Record<string, unknown>
    /** 假的服務商：劇本或對抗模式 */
    fake?: { script?: FakeReply[]; byTask?: Record<string, FakeReply[]>; adversarial?: { mode: AdversarialMode; tasks?: string[] } }
    /** 要裝的功能的 id（重播時由測試把 id 對到功能） */
    features?: string[]
  }
  inputs: ReproInput[]
  expect: {
    /** 跑完之後狀態的雜湊；沒寫就只檢查不變式與「跑兩次結果一樣」 */
    hash?: string
    /** 狀態裡某幾個位置的值，例如 { "money.cash": 12 } */
    paths?: Record<string, unknown>
    /** 預期這一串輸入的最後一步會丟出的錯誤訊息裡的一段字 */
    throws?: string
  }
}

/** 狀態的雜湊：鍵排序之後的 JSON。 */
export function stateHash(state: GameState): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v
  return (hash32(JSON.stringify(sorted(state))) >>> 0).toString(16).padStart(8, '0')
}

export function pathValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

export interface ReproResult {
  test: TestGame
  hash: string
  violations: string[]
  error?: string
}

/** 重播一份 repro。features 是「id → 功能」的對照（repro 裡只記 id）。 */
export async function runRepro(repro: Repro, features: Record<string, Feature> = {}): Promise<ReproResult> {
  const setup: GameSetup = {
    ...repro.setup.overrides, seed: repro.seed, scenario: repro.setup.scenario, ai: repro.setup.ai,
    ...(repro.setup.fake ? { fake: repro.setup.fake } : {}),
    features: (repro.setup.features ?? []).map((id) => {
      if (!features[id]) throw new Error(`repro ${repro.id} 要的功能 ${id} 沒有給`)
      return features[id]!
    }),
  }
  const test = makeGame(setup)
  const { game } = test
  let error: string | undefined
  const { violations } = await observed(game, async () => {
    try {
      for (const step of repro.inputs) {
        if (step.type === 'act') await game.act(step.input, { autoRules: step.autoRules ?? true })
        else if (step.type === 'undo') game.undoSteps(step.n ?? 1)
        else if (step.type === 'save_load') {
          const err = game.load(game.save('manual', 'repro'))
          if (err) throw new Error(err)
        } else if (step.type === 'reroll') await game.reroll(step.step ?? 'roll', { autoRules: true })
        else if (step.type === 'retry') await game.retryStep(step.step, { autoRules: true })
        else if (step.type === 'use_rules') await game.useRules(step.step, { autoRules: true })
        else if (step.type === 'ai') game.setAiSettings(step.settings)
      }
    } catch (e) {
      error = (e as Error).message
    }
  })
  return { test, hash: stateHash(game.state), violations, ...(error ? { error } : {}) }
}

/** 重播並對照期望。回傳問題的清單（空的就是通過）。會跑兩次，確認同一個種子、同一串輸入得到同一個結果。 */
export async function checkRepro(repro: Repro, features: Record<string, Feature> = {}): Promise<string[]> {
  const a = await runRepro(repro, features)
  const b = await runRepro(repro, features)
  const problems = [...a.violations]
  if (a.hash !== b.hash) problems.push(`跑兩次的結果不一樣（${a.hash} 與 ${b.hash}）`)
  if (repro.expect.throws !== undefined) {
    if (!a.error?.includes(repro.expect.throws)) problems.push(`預期丟出含「${repro.expect.throws}」的錯誤，實際是 ${a.error ?? '沒有錯誤'}`)
  } else if (a.error) problems.push(`丟出了錯誤：${a.error}`)
  if (repro.expect.hash && repro.expect.hash !== a.hash) problems.push(`狀態的雜湊是 ${a.hash}，期望 ${repro.expect.hash}`)
  for (const [path, want] of Object.entries(repro.expect.paths ?? {})) {
    const got = pathValue(a.test.game.state, path)
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${path} 是 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)
  }
  return problems
}
