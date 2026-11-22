// M1b-core-fix3 後續：buff 的 own_turn_end 對自己給的從下一個回合算起（UnitBuff.skip），所以心流、子彈時間的 turns 是 2。
// 規格：SKILL_TREES 槍手：心流「從這一回合起連續三個回合」（這個回合 + 2）；子彈時間「你的下兩個回合」。

import { describe, expect, it } from 'vitest'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK } from '../../data'

interface Eff { op: string; id?: string; turns?: number; until?: string }
interface Sk { [key: string]: unknown; id: string; meat?: { do?: Eff[] } }

describe('M1b-data-fix3：心流、子彈時間的 turns', () => {
  const g = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
  const buffOf = (id: string, buff: string): Eff => g.k.content.get<Sk>('ability', id)!.meat!.do!.find((e) => e.op === 'buff' && e.id === buff)!

  it('心流是 turns 2、子彈時間是 turns 2，都到自己的回合結束（給自己時核心略過目前這個回合）', () => {
    expect(buffOf('sk_gunner_flow', 'flow')).toMatchObject({ turns: 2, until: 'own_turn_end' })
    expect(buffOf('sk_gunner_bullet_time', 'bullet_time')).toMatchObject({ turns: 2, until: 'own_turn_end' })
  })
})
