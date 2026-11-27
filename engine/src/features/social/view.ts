// L6 功能 social 給畫面的「我的貼文」（M5-ui-social 要的）：追蹤、這一週發了幾篇、最近的貼文。純函式。

import type { GameState, Kernel } from '../../core'
import { meterOf } from '../../core'
import type { Post } from './model'
import { FOLLOWERS, readSocial, socialRules } from './model'

export interface SocialView {
  followers: number
  /** 這一週：發了幾篇、豔名加了幾次、豔名每週的上限 */
  week: { posts: number; fame: number; fame_cap: number }
  /** 最近的貼文（新的在前） */
  posts: Post[]
}

export function socialView(k: Kernel, state: GameState): SocialView {
  const s = readSocial(state)
  return {
    followers: meterOf(k, state, FOLLOWERS),
    week: { posts: s.week.posts, fame: s.week.fame, fame_cap: socialRules(k).fame_week_cap },
    posts: [...s.posts].reverse(),
  }
}
