import { describe, it, expect } from 'vitest'
import { fmtMod, derivedLooks, styleTags } from './creation'
import type { LookCyber } from './creation'

/**
 * 建角在介面端留著的純文字（M4-ui-creation）：調整值的正負號與外觀裡推出來的三樣。
 * 點數、能不能選與原因是引擎的，測試在 tests/creation/M4-ui-creation.test.ts。
 */
const bridge: LookCyber = { name: '織女 標準', brand: '織女', bridge: true, visible: { at: '後頸' } }
const eye: LookCyber = { name: '標準義眼-100', brand: '織女', visible: { at: '左眼' } }
const pump: LookCyber = { name: '藥泵-100', brand: '織女' }
const ears: LookCyber = { name: '同人通用獸耳', brand: '同人', beast: { school: 'mech', part: 'ears' } }
const tail: LookCyber = { name: '生體尾・芽', brand: '蜜腺', beast: { school: 'bio', part: 'tail' } }
const used: LookCyber = { name: '蜂巢通用型', brand: '織女（二手）', bridge: true, visible: { at: '後頸' } }

describe('調整值', () => {
  it('帶正負號', () => {
    expect(fmtMod(-2)).toBe('−2')
    expect(fmtMod(0)).toBe('+0')
    expect(fmtMod(3)).toBe('+3')
  })
})

describe('外觀裡推出來的三樣（第四版）', () => {
  it('風格標籤照物品的「風格」那一格', () => {
    expect(styleTags({ stats: [['風格', '街頭 +2']] })).toEqual([['街頭', 2]])
    expect(styleTags({ stats: [['風格', '櫻町系'], ['媒體', '+1']] })).toEqual([['櫻町系', 1]])
    expect(styleTags({ stats: [['風格', '+1']] })).toEqual([])
  })
  it('外露的義體照裝的義體與牌子的外觀；看不見的不寫', () => {
    const d = derivedLooks({ cyber: [bridge, eye, pump], gear: [], pronoun: '她', baseStyle: '工裝', line: '貓' })
    expect(d.cyber).toHaveLength(2)
    expect(d.cyber[1]).toContain('她的左眼是織女的標準義眼-100')
    expect(d.beast).toEqual([])
  })
  it('獸化照裝的耳與尾；系照第 6 步選的', () => {
    const d = derivedLooks({ cyber: [used, ears, tail], gear: [], pronoun: '他', baseStyle: '工裝', line: '狐' })
    expect(d.beast[0]).toContain('他的頭上有一對狐耳')
    expect(d.beast[0]).toContain('慢慢轉向一邊')
    expect(d.beast[1]).toContain('狐尾，毛是真的')
    expect(d.cyber[0]).toContain('後頸是織女的蜂巢通用型的橋接口')
  })
  it('風格：出身那套日常服裝加上穿的衣服，取最高的', () => {
    const d = derivedLooks({ cyber: [], gear: [{ name: '巷口機能夾克', kind: 'clothing', stats: [['風格', '街頭 +2']] }, { name: '霓虹外套', kind: 'clothing', stats: [['風格', '霓虹龐克 +2']] }], pronoun: '她', baseStyle: '工裝', line: '貓' })
    expect(d.style.main).toBe('街頭')
    expect(d.style.tags.find(t => t[0] === '工裝')![1]).toBe(1)
    expect(d.style.tags.find(t => t[0] === '霓虹龐克')![1]).toBe(2)
    expect(d.style.line).toContain('巷口機能夾克')
  })
})
