// L6 功能 live 的條件與衍生數值。
//   條件 live_on { mode?: 'activity' | 'slot', viewers_min?: number }  現在正在直播（V58：義體「聚光」的「被注視時」、場景「有人在看」、副本不能走潛行都問它）
//     它會被寫進被動效果的 if：test 只讀自己的狀態與量表（subs、這一場的熱度），不呼叫任何衍生數值（不然問被動效果時會繞圈；M4-core-passive 的守法）
//   衍生數值 live_goal_extra（開播時多抽幾個目標，玩家挑掉同樣多個）、live_record_quality（直播留下的紀錄品質加成）：只定義、預設 0，abilities 的技能加 provider

import type { Condition, Kernel } from '../../core'
import { isSafeInt, meterOf } from '../../core'
import { GOAL_EXTRA_STAT, MODES, OWNER, RECORD_QUALITY_STAT, liveRules, liveSession, viewersFrom } from './model'

interface LiveOnCond extends Condition { mode?: 'activity' | 'slot'; viewers_min?: number }

export function installConditions(k: Kernel): void {
  k.conditions.register<LiveOnCond>({
    kind: 'live_on', owner: OWNER,
    validate(raw) {
      const p = Object.keys(raw).filter((f) => f !== 'kind' && f !== 'mode' && f !== 'viewers_min').map((f) => `不認得的欄位 ${f}`)
      if (raw.mode !== undefined && !(MODES as readonly unknown[]).includes(raw.mode)) p.push('mode 要是 activity 或 slot')
      if (raw.viewers_min !== undefined && !(isSafeInt(raw.viewers_min) && raw.viewers_min >= 0)) p.push('viewers_min 要是 0 以上的整數')
      return p
    },
    test(c, ctx) {
      const s = liveSession(ctx.state)
      if (!s) return false
      if (c.mode !== undefined && s.mode !== c.mode) return false
      if (c.viewers_min === undefined) return true
      return viewersFrom(liveRules(k), meterOf(k, ctx.state, 'subs'), s.heat, s.house?.views_mult ?? 1).viewers >= c.viewers_min
    },
    describe: (c) => `要正在直播${c.mode === 'activity' ? '（掛在活動上的）' : c.mode === 'slot' ? '（時段直播）' : ''}${c.viewers_min !== undefined ? `，而且觀看數至少 ${c.viewers_min}` : ''}`,
  })
}

export function defineStats(k: Kernel): void {
  k.stats.defineStat({ id: GOAL_EXTRA_STAT, owner: OWNER, name: '多抽的直播目標', base: () => 0, min: 0, max: 3 })
  k.stats.defineStat({ id: RECORD_QUALITY_STAT, owner: OWNER, name: '直播紀錄的品質加成', base: () => 0, min: 0, max: 2 })
}
