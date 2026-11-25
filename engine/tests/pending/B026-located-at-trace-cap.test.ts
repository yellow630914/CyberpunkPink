// B026（邊界，2026-11-25）：追蹤度已經在 100（上限）時開戰，這一場永遠不會被定位、不會強制斷線。
// 規格：CYBERSPACE 6.8 節（到 90：定位。三回合後全隊被強制斷線，這場算戰敗）；NETRUNNING 第 5 節（90 以上：定位）。
//       使用者 2026-11-24 的裁決只讓「增援」看這一場有沒有跨過門檻，定位沒有這個例外。
// 重現：dev/bugs/B026-located-at-trace-cap.md；engine/tests/boundary/fixtures/B026-located-at-trace-cap.json。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { BattleRun, advance, clone, createKernel, readyFeatures, setupBattle } from '../../src'
import { netcombatFeature } from '../../src/features/netcombat'
import { laceUnit, makeState, netAvatar } from '../../src/testkit'

const JAM = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: s, desc: `${s}。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const NET = { sync: 'standard', sync_max: 'standard', broken: [] as string[] }

/** 一對一的內海戰鬥（裝 netcombat），開戰時 field.trace = trace；雙方都很難打倒對方（感載上限 999），一直輪到第 round 輪。 */
function battleAt(trace: number, rounds: number) {
  const k = createKernel([netcombatFeature])
  k.content.loadPack({ id: 'b026', content: { battle_status: JAM } } as unknown as ContentPack)
  readyFeatures(k)
  const state = makeState()
  const unit = (u: unknown) => ({ from: 'unit', unit: u as Record<string, unknown> })
  const setup = {
    mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, field: { trace },
    allies: [unit(netAvatar(0, 1, { control: 'ai', load: { now: 0, max: 999 }, ext: { net: NET } } as never))],
    foes: [unit(laceUnit('minion', 1, { load: { now: 0, max: 999 }, ext: { net: NET } } as never))],
  }
  const battle = clone(setupBattle(k, state, setup as never).battle)
  state.battle = battle
  const run = new BattleRun(k, state, battle)
  for (let guard = 0; guard < 400 && run.battle.round < rounds && !run.over; guard++) advance(run)
  return run
}

describe('B026：追蹤度在上限開戰也會被定位（CYBERSPACE 6.8 節）', () => {
  it('對照：從 95 開戰，第 2 輪 +3 到 98 開始倒數（這一條會過）', () => {
    const run = battleAt(95, 2)
    expect(typeof run.battle.field.located === 'number' || run.battle.field.located === true).toBe(true)
  })

  it('從 100 開戰：到第 2 輪已經在定位的倒數裡；第 5 輪開頭被強制斷線（戰敗）', () => {
    const r2 = battleAt(100, 2)
    expect(typeof r2.battle.field.located === 'number' || r2.battle.field.located === true).toBe(true)
    const r5 = battleAt(100, 6)
    expect(r5.battle.field.located).toBe(true)
    expect(r5.battle.result?.outcome).toBe('lose')
  })
})
