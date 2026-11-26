import { describe, it, expect } from 'vitest'
import { fmtMod } from './creation'

/**
 * 建角在介面端留著的純文字（M4-ui-creation）：調整值的正負號。
 * 點數、能不能選、買得到什麼、建議組合、外觀裡推出來的三樣是引擎的，測試在 tests/creation/M4-ui-creation.test.ts 與 tests/fix/M4-fix-ui.test.ts。
 */
describe('調整值', () => {
  it('帶正負號', () => {
    expect(fmtMod(-2)).toBe('−2')
    expect(fmtMod(0)).toBe('+0')
    expect(fmtMod(3)).toBe('+3')
  })
})
