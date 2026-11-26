// 測試基礎建設：成人場景的小工具（dev/test-harness.md 第 1 節；dev/work/M4-smoke.md 第 3 點「成人場景」）。
//
//   sceneCast(...ids)            幾位 NPC（有橋參數；成年；女性或指定）：給 makeBodyGame 的 actors
//   giveInsight(game, n)         體悟（夜課學習要用；來源是歷練，這裡直接給）
//   openScene(game, setup)       開場景（走 Game.launch，和事件、委託帶出來的是同一條路）
//   sceneSteps(game, input)      下一個行動並提交
//   sceneRounds(game, n)         不做事、結束主角這回合並讓別人走完，過 n 個回合（主角的回合開始時停下）
//   stopScene(game)              停下：結算；回傳 { report, sink, bridge }：每個人的沉溺變化、橋參數變化（用結算前後的狀態算）
//
// 全部走真正的功能與真正的提交；AI 關著（結算全照規則）。

import type { Actor, Change, Report } from '../core'
import type { SceneInput } from '../features/scene'
import { sceneAct, sceneNext, sceneRawOf } from '../features/scene'
import type { Game } from '../shell/game'
import { makeActor } from './factory'

const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }

/** 幾位 NPC：成年、有橋參數；id 是 npc_tw_<名>。名字用 id 去掉前綴。 */
export function sceneCast(...names: string[]): Actor[] {
  return names.map((n) => makeActor({ id: `npc_tw_${n}`, name: n, role: 'npc', gender: 'female', age: 26, ext: { bridge: { ...BRIDGE } } }))
}

/** 體悟（夜課學習要用）。 */
export function giveInsight(game: Game, n: number): Report[] {
  return game.commit({ kind: 'system', action: 'test.insight', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'insight', key: '_', set: n } as unknown as Change], outcome: { result: 'ok', summary: '測試給的體悟。' } })
}

/** 開場景：走 Game.launch（事件、委託、戰敗帶出來的是同一條路）。 */
export function openScene(game: Game, setup: Record<string, unknown>): Report[] {
  return game.launch('scene', setup, { by: 'test' })
}

/** 主角做一個行動並提交。 */
export const sceneDo = (game: Game, input: SceneInput): Report[] => game.commit(sceneAct(game.k, game.state, input))

/** 結束主角這個回合、讓別人走完，直到又輪到主角（最多 20 步）。場景結束了就停。 */
export function sceneEndTurn(game: Game): Report[] {
  const out = game.commit(sceneAct(game.k, game.state, { kind: 'end_turn' }))
  for (let i = 0; i < 20; i++) {
    const s = sceneRawOf(game.state)
    if (!s || s.turn === game.state.pc) break
    out.push(...game.commit(sceneNext(game.k, game.state)))
  }
  return out
}

/** 過 n 個回合（每回合只結束回合、不做事）。 */
export function sceneRounds(game: Game, n: number): Report[] {
  const out: Report[] = []
  for (let i = 0; i < n && sceneRawOf(game.state); i++) out.push(...sceneEndTurn(game))
  return out
}

export interface SceneSettlement {
  reports: Report[]
  /** 每個人的沉溺變化（結算前後的差；只列有這個人的） */
  sink: Record<string, number>
  /** 每個人每一項橋參數的變化（只列有變的） */
  bridge: Record<string, Record<string, number>>
}

const sinkOf = (game: Game): Record<string, number> => Object.fromEntries(Object.values(game.state.actors).map((a) => [a.id, a.sink]))
const bridgeOf = (game: Game): Record<string, Record<string, number>> =>
  Object.fromEntries(Object.values(game.state.actors).flatMap((a) => (a.ext.bridge && typeof a.ext.bridge === 'object' ? [[a.id, { ...(a.ext.bridge as Record<string, number>) }]] : [])))

/** 停下（主角的行動）並結算；回傳結算的報告與沉溺、橋參數的變化。 */
export function stopScene(game: Game): SceneSettlement {
  const sink0 = sinkOf(game)
  const bridge0 = bridgeOf(game)
  const reports = game.commit(sceneAct(game.k, game.state, { kind: 'stop' }))
  const sink1 = sinkOf(game)
  const bridge1 = bridgeOf(game)
  const sink: Record<string, number> = {}
  for (const [id, v] of Object.entries(sink1)) if (id in sink0) sink[id] = v - sink0[id]!
  const bridge: Record<string, Record<string, number>> = {}
  for (const [id, b] of Object.entries(bridge1)) {
    const prev = bridge0[id]
    if (!prev) continue
    const d = Object.fromEntries(Object.entries(b).flatMap(([key, v]) => (v !== prev[key] ? [[key, v - (prev[key] ?? 0)]] : [])))
    if (Object.keys(d).length > 0) bridge[id] = d
  }
  return { reports, sink, bridge }
}
