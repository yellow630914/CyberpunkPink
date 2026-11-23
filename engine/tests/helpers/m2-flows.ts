// M2 白箱與邊界測試共用：把主幹以外的幾條路線（街頭事件、場景、長時間、撤退、戰敗）各跑一遍，回傳玩過的遊戲。
// 每一條都是 doStep 的步驟（testkit 的 M2_STEPS）；被擋下的步驟不算錯（路線是拿來產生資料的，不是驗證步驟本身）。
import { makeCityGame, makeCommissionGame, doStep } from '../../src/testkit'
import type { Game } from '../../src/shell/game'

export type Step = { do: string; [k: string]: unknown }
export const steps = (...s: Step[]): Step[] => s

export const CITY_ROUTE: Step[] = steps(
  // 走到另一區、搭地鐵回市場、買東西、打工、回家（冒煙的城市主幹）
  { do: 'walk', to: 'E2' }, { do: 'walk', to: 'E2' }, { do: 'walk', to: 'F1' }, { do: 'ride', line: 'tw_metro', dest: 's_market' },
  { do: 'walk', to: 'F1' }, { do: 'buy', shop: 's_tw_stall', item: 'i_tw_ration', qty: 2 }, { do: 'walk', to: 'F2' }, { do: 'work', job: 'j_tw_porter', hours: 4 },
  { do: 'walk', to: 'E2' }, { do: 'walk', to: 'F1' },
  // 街頭事件與帶場景的事件
  { do: 'flag', key: 'tw_street_a', value: true }, { do: 'walk', to: 'across' }, { do: 'until_idle' },
  { do: 'flag', key: 'tw_street_a', value: false }, { do: 'flag', key: 'tw_street_b', value: true }, { do: 'walk', to: 'across' }, { do: 'until_idle' },
  // 週日晚上、睡一覺跨過週一、再過十二天
  { do: 'pass_until', day: 6, hour: 23 }, { do: 'sleep' }, { do: 'pass', minutes: 600 },
  ...Array.from({ length: 12 }, () => ({ do: 'pass', minutes: 1440 })),
)
export const COMMISSION_ROUTES: Step[][] = [
  steps({ do: 'scout' }, { do: 'go' }, { do: 'stage' }, { do: 'retreat' }, { do: 'go' }, { do: 'surrender' }, { do: 'accept_defeat' }),
  steps({ do: 'go' }, { do: 'stage' }, { do: 'surrender' }, { do: 'rewind_stage' }, { do: 'stage' }, { do: 'stage' }, { do: 'stage' }),
  steps({ do: 'scout' }, { do: 'scout' }, { do: 'muster' }, { do: 'go' }, { do: 'stage' }, { do: 'stage' }, { do: 'stage' }),
]

export async function play(game: Game, route: Step[]): Promise<void> {
  for (const s of route) {
    try {
      await doStep(game, s.do, s)
    } catch {
      /* 被擋的步驟不算錯 */
    }
  }
}

/** 每一條路線跑一遍（幾個種子），回傳玩過的遊戲。 */
export async function playAll(seeds: { city: number[]; commission: number[] } = { city: [7, 3], commission: [7, 3] }): Promise<Game[]> {
  const games: Game[] = []
  for (const seed of seeds.city) {
    const g = makeCityGame({ seed }).game
    await play(g, CITY_ROUTE)
    games.push(g)
  }
  for (const seed of seeds.commission) {
    for (const route of COMMISSION_ROUTES) {
      const g = makeCommissionGame({ seed }).game
      await play(g, route)
      games.push(g)
    }
  }
  return games
}
