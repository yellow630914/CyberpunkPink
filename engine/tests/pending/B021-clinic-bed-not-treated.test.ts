// B021（cpp-tester-whitebox，M2 白箱）：診所的病床算「傷口處理過」（DOWNTIME 2.3 節表：「診所的病床 | 60%，算處理過」；2.2 節重傷限制：處理過＝……診所治療、睡在有醫療床的據點）。
// 現況：rest 的 sleepDraft 只看身上有沒有 `treated` 狀況，睡在有 sleep 的設施（診所）不會算處理過：生命 5／40 睡診所只回到 20（一半），
// 付了 50 塊的病床和露宿受一樣的重傷限制；回復率 60% 的意義只剩「沒受傷的人」才看得到。
// 重現：tests/whitebox/fixtures/B021-clinic-bed-not-treated.json。修好之後搬到 tests/whitebox/（或併進 tests/features/M2-rest-housing.test.ts）。
// 修的時候要先決定設施怎麼標「醫療床」（例：facility_type 的 sleep 多一個 treated: true，資料 facility_types.json 的 clinic 要加）——cpp-architect 的範圍。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { billsFeature } from '../../src/features/bills'
import { characterFeature } from '../../src/features/character'
import { restFeature, sleepDraft, sleepOptions } from '../../src/features/rest'
import { arrive, worldFeature } from '../../src/features/world'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

const FIX = JSON.parse(readFileSync(new URL('../whitebox/fixtures/B021-clinic-bed-not-treated.json', import.meta.url), 'utf8')) as { seed: number; body: number; hp: number; pack: ContentPack; expect: { hpAfterTreated: number } }

function atClinic(hp: number, treated = false) {
  const { game } = makeGame({
    features: [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), characterFeature, worldFeature, billsFeature, restFeature],
    content: [METER_CONTENT, FIX.pack], seed: FIX.seed, pc: { hp, attrs: { body: FIX.body } }, patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 1000, cash: 100 } },
  })
  if (treated) game.state.actors.pc!.conditions.push({ id: 'treated' })
  game.commit(arrive(game.k, game.state, 'b_hive', 'F1'))
  return game
}

describe('B021：診所的病床算處理過（DOWNTIME 2.3）', () => {
  it('對照：站在診所上，睡處是診所的病床（60%、50 一晚）', () => {
    const g = atClinic(FIX.hp)
    const opt = sleepOptions(g.k, g.state).find((o) => o.id === 'facility')!
    expect(opt).toMatchObject({ rate: 0.6, cost: 50, block: null })
  })

  it('對照：已經處理過的人睡診所，回 24（60% × 40）到 29', () => {
    const g = atClinic(FIX.hp, true)
    g.commit(sleepDraft(g.k, g.state))
    expect(g.state.actors.pc!.hp).toBe(FIX.expect.hpAfterTreated)
  })

  it('生命 5／40、沒有處理過，睡診所的病床：算處理過，不受「最多回到一半」的限制，回到 29', () => {
    const g = atClinic(FIX.hp)
    g.commit(sleepDraft(g.k, g.state))
    expect(g.state.actors.pc!.hp).toBe(FIX.expect.hpAfterTreated)
  })
})
