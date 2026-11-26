// B032（M4 白箱，cpp-tester-whitebox）：斷線靜修期間沉溺漲到 100 以上，結算時照樣降 6，把人拉回 100 以下。
// 規格：DOWNTIME 3.3 節最後一條「沉溺 100 以上：不會自然下降，抑制劑無效，靜修沒用」；CORE_RULES 4.3 節（溺感者）。
// 進傳教所時有擋（therapy.ts：sink ≥ 100「你已經不想回去了。」），結算（retreat.ts 的 retreatSettle）沒有再看一次。
// 重現：engine/tests/whitebox/fixtures/B032-retreat-settles-when-sunk.json。dev/bugs/B032-retreat-settles-when-sunk.md。

import { describe, expect, it } from 'vitest'
import type { ContentPack, ReportDraft } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import { restFeature } from '../../src/features/rest'
import { retreatOf, sinkFeature, therapyDraft } from '../../src/features/sink'
import { arrive, worldFeature } from '../../src/features/world'
import { makeGame } from '../../src/testkit'

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [6, 3],
  sheets: [{
    id: 'street', name: '街', size: [6, 3], layout: ['##F###', 'E1..2E', '######'],
    cells: [{ id: 'F1', at: [2, 0], mark: 'F', name: '一號' }, { id: 'E1', at: [0, 1], mark: 'E', name: '西口' }, { id: 'E2', at: [5, 1], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [1, 1], cover: 'sparse' }, { id: '!2', at: [4, 1], cover: 'dense' }],
  }],
} as never
const PACK: ContentPack = {
  id: 'b032',
  content: {
    special_map: [MAP], facility_type: [{ id: 'fac_retreat', name: '傳教所', therapy: { kind: 'retreat' } }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '療養街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_retreat', name: '傳教所' } } }],
  } as never,
}
const draft = (changes: ReportDraft['changes'], action: string): ReportDraft => ({ kind: 'action', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })

describe('B032：斷線靜修的結算不看沉溺 100 以上（DOWNTIME 3.3 節「沉溺 100 以上……靜修沒用」）', () => {
  it('進去時 98、期間一件事件讓沉溺 +4（102）、待滿三天：沉溺停在 102（不降）、靜修的記號照樣拿掉', () => {
    const { game: g } = makeGame({ features: [characterFeature, worldFeature, restFeature, sinkFeature], content: [PACK], seed: 7, pc: { hp: 40, sink: 98 }, patch: { time: { day: 3, hour: 10, minute: 0 } } })
    g.commit(arrive(g.k, g.state, 'b_street', 'F1'))
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    // 靜修期間放行的事件（commit:event.）讓沉溺漲過 100
    g.commit(draft([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 4 }], 'event.test'))
    expect(g.state.actors.pc!.sink).toBe(102)
    // 時間到了（事件把時間推過結束）：結算
    const rs = g.commit(draft([{ op: 'time', minutes: 3 * 1440 }], 'event.test'))
    expect(rs.map((r) => r.action)).toContain('sink.retreat')
    expect(retreatOf(g.state)).toBeNull()
    expect(g.state.actors.pc!.sink).toBe(102)
  })
})
