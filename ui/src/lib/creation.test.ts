import { describe, it, expect } from 'vitest'
import { ageBlock, freeValues, attrBlock, attrMod, attrBudget, attrStepBlock, fmtMod, basicLeft, basicStepBlock, cyberSummary, cyberPickBlock, cyberBlock, traitSummary, traitPickBlock, gearPoints, gearSummary, gearAddBlock, fitKit, derivedLooks, styleTags } from './creation'
import { CYBER_OPTIONS, TRAITS, SUGGESTED_KITS } from '../data/creation'
import { ITEMS } from '../data/items'

const opt = (id: string) => CYBER_OPTIONS.find(o => o.id === id)!
const trait = (id: string) => TRAITS.find(t => t.id === id)!

describe('年齡是硬界線（UI 第 14 節）', () => {
  it('只收整數，低於 18 擋下', () => {
    expect(ageBlock('18')).toBeNull()
    expect(ageBlock('17')).toContain('成年人')
    expect(ageBlock('19.5')).toBe('年齡要填整數。')
    expect(ageBlock('')).toBe('年齡要填整數。')
  })
})

describe('屬性：15、14、13、12、10、8 再加 2 點', () => {
  it('選過的數字從其他下拉消失', () => {
    expect(freeValues({ 體格: 15, 反應: 14 }, '技術')).toEqual([13, 12, 10, 8])
    expect(freeValues({ 體格: 15, 反應: 14 }, '體格')).toEqual([15, 13, 12, 10, 8])
  })
  it('六項都分了、自由點數剛好 2 點才過', () => {
    const pick = { 體格: 12, 反應: 15, 技術: 8, 智識: 13, 意志: 10, 魅力: 14 }
    expect(attrBlock(pick, {})).toBe('還有 2 點自由點數沒有用。')
    expect(attrBlock(pick, { 意志: 2 })).toBeNull()
    expect(attrBlock(pick, { 意志: 3 })).toBe('自由點數只有 2 點。')
    expect(attrBlock({ ...pick, 魅力: 15 }, { 意志: 2 })).toBe('每個數字只能用一次。')
    expect(attrBlock({ 體格: 12 }, {})).toBe('還有 5 項屬性沒有分配。')
  })
  it('單項最高 18；調整值無條件捨去', () => {
    expect(attrBlock({ 體格: 15, 反應: 14, 技術: 13, 智識: 12, 意志: 10, 魅力: 8 }, { 體格: 2 })).toBeNull()
    expect(attrMod(15)).toBe(2); expect(attrMod(8)).toBe(-1); expect(attrMod(13)).toBe(1)
  })
})

describe('屬性往下壓：最低 4，每壓 1 點換 1 點自由點數', () => {
  const pick = { 體格: 12, 反應: 15, 技術: 8, 智識: 13, 意志: 10, 魅力: 14 }
  it('壓下去的點數加進自由點數', () => {
    expect(attrBudget({ 技術: -4 })).toEqual({ total: 6, lowered: 4, spent: 0, left: 6 })
    expect(attrBudget({ 技術: -2, 反應: 3, 意志: 1 })).toMatchObject({ total: 4, spent: 4, left: 0 })
    expect(attrBlock(pick, { 技術: -2, 反應: 3, 意志: 1 })).toBeNull()
    expect(attrBlock(pick, { 技術: -2, 反應: 3 })).toBe('還有 1 點自由點數沒有用。')
  })
  it('最低 4（調整值 −3），最高照樣 18', () => {
    expect(attrBlock(pick, { 技術: -5, 反應: 3, 意志: 4 })).toBe('技術最低 4。')
    expect(attrStepBlock(pick, { 技術: -4 }, '技術', -1)).toContain('最低 4')
    expect(attrStepBlock(pick, {}, '技術', -1)).toBeNull()
    expect(attrStepBlock(pick, { 反應: 3 }, '反應', 1)).toContain('最高 18')
    expect(attrStepBlock(pick, { 意志: 2 }, '體格', 1)).toContain('自由點數用完了')
    expect(attrStepBlock(pick, { 意志: 2, 技術: -1 }, '技術', 1)).toBeNull()
    expect(attrMod(4)).toBe(-3); expect(attrMod(6)).toBe(-2)
    expect(fmtMod(-2)).toBe('−2'); expect(fmtMod(0)).toBe('+0')
  })
})

describe('基本功：10 點，單項最高 3 級', () => {
  it('剩幾點；超過上限或點數用完擋下', () => {
    expect(basicLeft({ 槍械: 3, 交涉: 2 })).toBe(5)
    expect(basicStepBlock({ 槍械: 3 }, '槍械', 1)).toContain('最高 3 級')
    expect(basicStepBlock({ 槍械: 3, 交涉: 3, 隱匿: 3, 運動: 1 }, '調查', 1)).toBe('點數用完了。')
    expect(basicStepBlock({}, '調查', -1)).toBe('已經是 0 級。')
  })
})

describe('橋與義體：10 點，沒花完的每點換 500', () => {
  it('一定要一座橋；剩下的點數換錢；沉溺的下限加起來', () => {
    const s = cyberSummary([opt('br_std'), opt('cw_eye')])
    expect(s).toMatchObject({ spent: 7, left: 3, money: 1500, sinkFloor: 9 })
    expect(cyberBlock([opt('cw_eye')])).toBe('要選一座橋。')
  })
  it('企業出身才選得到那家企業的橋；點數不夠擋下；換橋只算新的那一座', () => {
    expect(cyberPickBlock([], opt('br_hizakura'), { id: 'hive' })).toContain('企業出身')
    expect(cyberPickBlock([], opt('br_hizakura'), { id: 'corp', corp: '緋櫻' })).toBeNull()
    expect(cyberPickBlock([opt('br_std'), opt('cw_armor')], opt('cw_arm'), { id: 'hive' })).toBe('要 3 點，剩 1 點。')
    expect(cyberPickBlock([opt('br_std'), opt('cw_armor')], opt('br_hive'), { id: 'hive' })).toBeNull()
  })
})

describe('特質：4 點，缺陷最多 2 個', () => {
  it('缺陷退的點數可以拿去買特質', () => {
    expect(traitSummary([trait('t_talker'), trait('f_mouth')], 4).left).toBe(4)
    expect(traitPickBlock([trait('t_talker'), trait('t_tough')], trait('t_steady'), 4)).toBe('要 2 點，剩 0 點。')
    expect(traitPickBlock([trait('f_pain'), trait('f_bed')], trait('f_old'), 4)).toBe('缺陷最多 2 個。')
  })
})

describe('起始裝備：12 點，只能買 I～II 級', () => {
  it('一件的點數＝目錄價 ÷ 250，無條件進位，最少 1', () => {
    expect(gearPoints(ITEMS.it_f0db7d)).toBe(1)
    expect(gearPoints(ITEMS.it_7eb6ee)).toBe(3)
    expect(gearPoints(ITEMS.it_6fa4e8)).toBe(7)
    expect(gearPoints(ITEMS.it_91ec53)).toBe(10)
  })
  it('III 級以上與獨特物品不能買；點數不夠擋下；沒花完每點換 250', () => {
    expect(gearAddBlock([], ITEMS.it_c7dbe5)).toContain('I～II')
    expect(gearAddBlock([], ITEMS.it_9db829)).toContain('獨特')
    expect(gearAddBlock([ITEMS.it_6fa4e8, ITEMS.it_7eb6ee], ITEMS.it_7eb6ee)).toBe('要 3 點，剩 2 點。')
    expect(gearSummary([ITEMS.it_6fa4e8]).money).toBe(1250)
  })
  it('建議組合超過 12 點時從最後一件拿掉', () => {
    for (const ids of Object.values(SUGGESTED_KITS)) expect(gearSummary(fitKit(ids.map(i => ITEMS[i]))).left).toBeGreaterThanOrEqual(0)
    expect(fitKit([ITEMS.it_6fa4e8, ITEMS.it_7eb6ee, ITEMS.it_7eb6ee]).length).toBe(2)
  })
})

describe('外觀裡推出來的三樣（第四版）', () => {
  it('風格標籤照物品的「風格」那一格', () => {
    expect(styleTags({ stats: [['風格', '街頭 +2']] })).toEqual([['街頭', 2]])
    expect(styleTags({ stats: [['風格', '櫻町系'], ['媒體', '+1']] })).toEqual([['櫻町系', 1]])
    expect(styleTags({ stats: [['風格', '+1']] })).toEqual([])
  })
  it('外露的義體照裝的義體與牌子的外觀；看不見的不寫', () => {
    const d = derivedLooks({ cyber: [opt('br_std'), opt('cw_eye'), opt('cw_pump')], gear: [], pronoun: '她', baseStyle: '工裝', line: '貓' })
    expect(d.cyber).toHaveLength(2)
    expect(d.cyber[1]).toContain('她的左眼是織女的標準義眼-100，白色的樹脂外殼')
    expect(d.beast).toEqual([])
  })
  it('獸化照裝的耳與尾；系照第 6 步選的', () => {
    const d = derivedLooks({ cyber: [opt('br_hive'), opt('cw_ears'), opt('cw_tail_bio')], gear: [], pronoun: '他', baseStyle: '工裝', line: '狐' })
    expect(d.beast[0]).toContain('他的頭上有一對狐耳')
    expect(d.beast[0]).toContain('慢慢轉向一邊')
    expect(d.beast[1]).toContain('狐尾，毛是真的')
    expect(d.cyber[0]).toContain('上一任主人刻的字')
  })
  it('風格：出身那套日常服裝加上穿的衣服，取最高的', () => {
    const d = derivedLooks({ cyber: [], gear: [ITEMS.it_f359b2, ITEMS.it_ccbaca], pronoun: '她', baseStyle: '工裝', line: '貓' })
    expect(d.style.main).toBe('街頭')
    expect(d.style.tags.find(t => t[0] === '霓虹龐克')![1]).toBe(2)
    expect(d.style.line).toContain('巷口機能夾克')
  })
})
