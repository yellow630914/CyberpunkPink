// 隊伍共用的錢包：現金與三種人情（dev/work/M1b-review-features.md E2；FIXER 第 8 節：人情只記在主角名下，錢是隊伍的）。
// 戰鬥裡每個有角色的單位都帶一份池（核心照單位自己的池檢查與扣花費），所以這裡讓它們「看起來是同一份」：
// 每次有人花費之後（行動做完、反應扣完）把同一種池的每一份同步成同一個數字——
//   新的數字 = 上一次同步的數字 + 每一份自己改了多少的總和（花掉是負的；效果補回來是正的），夾在 0～池的上限；
// 上一次同步的數字記在每個單位自己的 ext.wallet 裡（存檔、回退一起走）。
// 結束時寫回只算一次差額（end.ts 用 walletOf）。

import type { BattleRun, BattleState, BattleUnit, GameState } from '../../core'
import { isRec } from './unitdata'

/** 隊伍共用的池。 */
export const SHARED_POOLS = ['cash', 'favor_small', 'favor_mid', 'favor_big'] as const

/** 有這個池、而且帶著角色的單位（隊伍的人；敵人沒有角色）。 */
const holdersOf = (battle: Pick<BattleState, 'units'>, name: string): BattleUnit[] => Object.values(battle.units).filter((u) => u.actor && u.pools[name])

const seenOf = (u: BattleUnit, name: string): number | undefined => {
  const w = isRec(u.ext.wallet) ? u.ext.wallet[name] : undefined
  return typeof w === 'number' ? w : undefined
}
const setSeen = (u: BattleUnit, name: string, v: number): void => {
  if (!isRec(u.ext.wallet)) u.ext.wallet = {}
  ;(u.ext.wallet as Record<string, number>)[name] = v
}

/** 記下這一份現在的數字（單位剛建好池、或剛同步完）。 */
export const rememberPool = (u: BattleUnit, name: string): void => {
  const p = u.pools[name]
  if (p) setSeen(u, name, p.now)
}

/** 這個池現在隊伍共用的數字與上限（不改任何東西）；沒有人帶這個池回傳 undefined。 */
export function walletOf(battle: Pick<BattleState, 'units'>, name: string): { now: number; max: number } | undefined {
  const hs = holdersOf(battle, name)
  if (!hs.length) return undefined
  const max = Math.max(...hs.map((u) => u.pools[name]!.max))
  const ref = seenOf(hs[0]!, name) ?? hs[0]!.pools[name]!.now
  const delta = hs.reduce((n, u) => n + (u.pools[name]!.now - (seenOf(u, name) ?? ref)), 0)
  return { now: Math.max(0, Math.min(max, ref + delta)), max }
}

/** 把隊伍每一份共用的池同步成同一個數字。 */
export function syncWallet(run: Pick<BattleRun, 'battle'>): void {
  for (const name of SHARED_POOLS) {
    const w = walletOf(run.battle, name)
    if (!w) continue
    for (const u of holdersOf(run.battle, name)) {
      const p = u.pools[name]!
      p.now = w.now
      p.max = w.max
      setSeen(u, name, w.now)
    }
  }
}

/** 隊伍的錢包記在誰名下：主角（人情）；沒有主角時是第一個有角色的單位。 */
export const walletActor = (state: Pick<GameState, 'pc' | 'actors'>, battle: Pick<BattleState, 'units'>): string | undefined => {
  if (state.pc && state.actors[state.pc]) return state.pc
  return Object.values(battle.units).find((u) => u.actor && state.actors[u.actor])?.actor
}
