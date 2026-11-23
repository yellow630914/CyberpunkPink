// 驗收測試：dev/work/M2-fix-review.md（M2 引擎審查後的修正批；依據 dev/reviews/2026-11-23-M2.md、dev/adr/0016、0017）。
// 每一項一個 describe；內容一律用測試自帶的最小假資料（事件、範圍）加 testkit 的假世界（TEST_WORLD）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Report } from '../../src'
import { BATTLE_SETUPS, SUNDAY_MORNING, makeCityGame, playOut } from '../../src/testkit'
import { chooseOption, eventView } from '../../src/features/director'
import { board, advance, transitOf, wait } from '../../src/features/transit'
import { arrive } from '../../src/features/world'

type Fx = Record<string, unknown>

// ===================================================================================================================
// 必修 1：車上開打、開場景
// ===================================================================================================================

const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const RIDE_PACK = (trigger: 'transit_wait' | 'transit_stop' = 'transit_wait'): ContentPack => ({
  id: 'fix_ride',
  content: {
    event_scope: [{ id: 'transit', triggers: { transit_wait: 1, transit_stop: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
    event: [{
      id: 'ev_fix_ride', scope: 'transit', triggers: [trigger], category: 'trouble', adult: true,
      text: '有人在車廂裡盯著你。', cast: [{ role: 'a', gen: { kind: 'citizen', name: '陌生人' } }],
      options: [
        opt('fight', '動手。', { outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes, cover: 'sparse' }] } }),
        opt('go', '跟他走。', { adult_scene: { when: 'always', gate: 'fixed', nature: 'mutual', role: 'none', goal: 'please', circles: [['$pc', '$a']] } }),
        opt('look', '看回去。'),
      ],
    }],
  } as unknown as ContentPack['content'],
})

/** 站在塔下站、上車、等車（transit_wait 的事件在車上開起來）。 */
function onTheTrain(trigger: 'transit_wait' | 'transit_stop' = 'transit_wait', seed = 3) {
  const t = makeCityGame({ seed, content: [RIDE_PACK(trigger)], patch: { time: { ...SUNDAY_MORNING } } })
  const g = t.game
  g.commit(arrive(g.k, g.state, 'tw_tower', 'F2'))
  g.commit(board(g.k, g.state, { line: 'tw_metro', pay: 'cred' }))
  return g
}

describe('必修 1：車上的事件選開打或開場景', () => {
  it('探針：車上開打', () => {
    const g = onTheTrain()
    g.commit(wait(g.k, g.state))
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'ev_fix_ride' })
    const reports: Report[] = g.commit(chooseOption(g.k, g.state, 'fight'))
    throw new Error(JSON.stringify([reports.map((r) => r.action), g.state.location, transitOf(g.state).trip, !!g.state.battle]))
    void playOut
    void advance
  })
})
