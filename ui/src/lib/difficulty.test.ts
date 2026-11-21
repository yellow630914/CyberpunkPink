import { describe, it, expect } from 'vitest'
import { DIFF_PRESETS, copyPreset, clampCoef, clampInt, tableFor, scaleEnemy, prPoints, dcWith, DC_RANGE, PR_RANGE } from './difficulty'

describe('難度的係數（BALANCE 7.2、7.3 節）', () => {
  it('普通全部是 1、偏移 0；困難與傳奇照表', () => {
    const n = DIFF_PRESETS.普通
    expect([n.boss.hp, n.low12.dmg, n.low45.load, n.pr, n.dc]).toEqual([1, 1, 1, 0, 0])
    expect(DIFF_PRESETS.困難.low3.dmg).toBe(1.35)
    expect(DIFF_PRESETS.傳奇.low12.dmg).toBe(1.7)
    expect(DIFF_PRESETS.故事.dc).toBe(-2)
  })
  it('自訂從預設複製，改了不影響預設', () => {
    const t = copyPreset('困難')
    t.boss.hp = 2
    expect(DIFF_PRESETS.困難.boss.hp).toBe(1.15)
    expect(tableFor('自訂', t).boss.hp).toBe(2)
    expect(tableFor('普通', t).boss.hp).toBe(1)
  })
  it('範圍：係數 0.25～5、公關點 −3～+3、DC −4～+4', () => {
    expect(clampCoef(0.1)).toBe(0.25)
    expect(clampCoef(9)).toBe(5)
    expect(clampCoef(1.234)).toBe(1.23)
    expect(clampInt(7, DC_RANGE)).toBe(4)
    expect(clampInt(-9, PR_RANGE)).toBe(-3)
  })
  it('敵人照等級取那一列；公關點最少 1；DC 加偏移', () => {
    const t = copyPreset('普通')
    t.low3.hp = 2
    expect(scaleEnemy(t, 3, false, { hp: 45, load: 22 }).hp).toBe(90)
    expect(scaleEnemy(t, 2, false, { hp: 45, load: 22 }).hp).toBe(45)
    expect(prPoints(1, DIFF_PRESETS.故事)).toBe(1)
    expect(prPoints(3, DIFF_PRESETS.傳奇)).toBe(8)
    expect(dcWith(10, DIFF_PRESETS.故事)).toBe(8)
  })
})
