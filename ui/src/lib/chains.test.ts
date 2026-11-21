import { describe, it, expect } from 'vitest'
import { CHAINS, CHAIN_FLOWS, chainLayout } from '../data/workshop'

describe('任務鏈的流程圖（第四版：23 條都有）', () => {
  it('每一條鏈都有流程圖；依賴只指向前面的步驟；最後一步是套用', () => {
    for (const c of CHAINS) {
      const f = CHAIN_FLOWS[c]
      expect(f, c).toBeTruthy()
      f.forEach((s, i) => s.deps.forEach(d => expect(d, `${c}/${s.n}`).toBeLessThanOrEqual(i)))
      expect(f[f.length - 1].kind, c).toBe('apply')
      expect(chainLayout(f).cols).toBeGreaterThan(1)
    }
  })
})
