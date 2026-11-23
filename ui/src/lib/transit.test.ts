import { describe, it, expect } from 'vitest'
import { driveBlock } from './transit'

// 公共交通與計程車的車資、時間、路線、能不能上車是引擎的（features/transit，驗收在 tests/M2-ui-world.test.ts）。這裡只剩引擎還沒有的「自己的車」。
describe('自己的車（引擎還沒有這個功能）', () => {
  it('要有車，不要錢', () => {
    const here = { district: 'hive' as const, block: '四號塔' }
    expect(driveBlock([], here, { district: 'crown', block: '濱海' })).toContain('沒有車')
    expect(driveBlock(['街車'], here, { district: 'crown', block: '濱海' })).toBeNull()
  })
})
