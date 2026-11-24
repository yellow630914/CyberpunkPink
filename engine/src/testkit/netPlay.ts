// 測試基礎建設：內海戰鬥的「會玩的玩家」（dev/work/M3-smoke.md 第 2 點）。
// playOut 讓雙方都由 AI 選動作；內海的我方化身若讓 AI 控制，武器構裝破損之後 AI 不會換構裝（net_swap 沒有 aiScore，dev/bugs/B023），
// 整場會拖成僵局。這裡的玩家照最簡單的辦法打：有攻擊構裝就攻擊、手上的破損了就換、RAM 不夠就回填、其餘結束回合；敵方照常由 AI。
// 冒煙與種子重播共用（untilIdle、playNetStage 遇到內海的戰鬥時都走這裡）。

import type { Game } from '../shell/game'

export interface NetPlayResult {
  outcome: string
  steps: number
  rounds: number
}

/** 把一場內海戰鬥打完：我方的回合照上面的辦法，敵方的回合讓 AI 走。打不完（超過 maxSteps）丟錯。只打到分出結果；結算（game.finishBattle）由呼叫的人做。 */
export function playNetOut(game: Game, maxSteps = 800): NetPlayResult {
  let steps = 0
  while (game.battle && !game.battle.result) {
    if (++steps > maxSteps) throw new Error(`內海的戰鬥打了 ${maxSteps} 步還沒分出結果`)
    const o = game.battleOptions()
    if (!o || o.waiting === 'over') break
    if (o.waiting === 'ai') {
      const r = game.battleNext()
      if (r.status !== 'applied') throw new Error(`自動戰鬥的一步沒有成立：${(r.reasons ?? []).join(' ')}`)
      continue
    }
    const ok = (id: string) => o.actions.find((a) => a.id === id && a.ok)
    const strike = ok('net_attack') ?? ok('net_melee')
    let input: { action: string; target?: { unit: string } } = { action: 'end_turn' }
    if (strike) {
      const t = strike.targets.find((x) => x.blocks.length === 0 && 'unit' in x.target)
      if (t) input = { action: strike.id, target: t.target as { unit: string } }
    }
    if (input.action === 'end_turn') {
      if (ok('net_swap') && game.battle!.units[o.current!]!.weapons.length > 1 && !(o.actions.find((a) => a.id === 'net_attack')?.ok)) input = { action: 'net_swap' }
      else if (ok('net_refill') && (game.battle!.units[o.current!]!.pools.ram?.now ?? 99) < 2) input = { action: 'net_refill' }
    }
    const r = game.battleAct(input as never)
    if (r.status !== 'applied') throw new Error(`內海的一步沒有成立（${input.action}）：${(r.reasons ?? []).join(' ')}`)
  }
  if (!game.battle?.result) throw new Error('現在沒有在戰鬥')
  return { outcome: game.battle.result.outcome, steps, rounds: game.battle.round }
}
