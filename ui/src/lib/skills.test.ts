import { describe, it, expect } from 'vitest'
import { SKILL_TREES, NIGHT_BRANCHES } from '../data/content.generated'
import { tierOpen, toNextTier, treeSpent, skillState, learnBlock, learnPreview, equipBlock, loadoutUse, rearrangeBlock, nightTierOpen, nightVisible, nightLearnBlock, nightNeedBlock, type NightProfile } from './skills'

const gun = SKILL_TREES.find(t => t.id === 'gun')!
const id = (n: string) => `gun:${n}`

describe('技能樹的資料（SKILL_TREES）', () => {
  it('八棵樹，每棵一個招牌，技能都有三條線', () => {
    expect(SKILL_TREES).toHaveLength(8)
    for (const t of SKILL_TREES) {
      expect(t.skills.filter(s => s.layer === 'sig')).toHaveLength(1)
      expect(t.skills.length).toBeGreaterThanOrEqual(24)
      for (const s of t.skills) if (s.pre) expect(t.skills.some(k => k.name === s.pre)).toBe(true)
    }
  })
  it('夜課五個分支', () => { expect(NIGHT_BRANCHES.map(b => b.name)).toEqual(['共通', '關係', '感官', '身體', '扮相']) })
})

describe('學技能（SKILLS 1.3 節）', () => {
  it('累計 40／120／240／400 開 2～5 階', () => {
    expect([0, 39, 40, 119, 120, 240, 399, 400, 999].map(tierOpen)).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5])
    expect(toNextTier(100)).toBe(20)
    expect(toNextTier(400)).toBe(0)
  })
  it('一個技能花「階 × 20」，算進那棵樹的累計', () => {
    expect(treeSpent(gun, new Set([id('戰鬥直覺'), id('定點射')]))).toBe(60)
  })
  it('前置要擋：沒學招牌就學不了要害射擊', () => {
    const s = gun.skills.find(k => k.name === '要害射擊')!
    expect(learnBlock(gun, s, new Set(), 100)).toBe('要先學會「戰鬥直覺」。')
    expect(learnBlock(gun, s, new Set([id('戰鬥直覺')]), 100)).toBeNull()
  })
  it('階還沒開：2 階的技能要累計 40', () => {
    const s = gun.skills.find(k => k.name === '定點射')!
    const learned = new Set([id('戰鬥直覺'), id('要害射擊')])
    expect(skillState(gun, s, new Set([id('戰鬥直覺')]))).toBe('locked')
    expect(skillState(gun, s, learned)).toBe('can')
    expect(learnBlock(gun, s, new Set([id('戰鬥直覺')]), 999)).toContain('累計花 40 點')
  })
  it('點數不夠時寫要多少、你有多少', () => {
    const s = gun.skills.find(k => k.name === '定點射')!
    expect(learnBlock(gun, s, new Set([id('戰鬥直覺'), id('要害射擊')]), 26)).toBe('要 40 歷練點，你有 26 點。')
  })
  it('學了之後的預覽：開出新的一階', () => {
    const s = gun.skills.find(k => k.name === '要害射擊')!
    const p = learnPreview(gun, s, new Set([id('戰鬥直覺')]))
    expect(p.after).toBe(40)
    expect(p.tierAfter).toBe(2)
    expect(p.opens.map(k => k.name)).toContain('定點射')
  })
})

describe('橋的容量（CORE_RULES 6.4 節）', () => {
  const cap = { 現實: 13, 內海: 13, 社交: 13, 媒體: 13 }
  it('共鳴不佔容量；超過時寫「現實不足 N」', () => {
    const cur = [{ id: 'a', category: '現實' as const, cap: 12 }, { id: 'r', category: '現實' as const, cap: 0, free: true }]
    expect(loadoutUse(cur).現實).toBe(12)
    expect(equipBlock(cap, cur, { id: 'b', category: '現實', cap: 3 })).toBe('現實不足 2')
    expect(equipBlock(cap, cur, { id: 'c', category: '社交', cap: 3 })).toBeNull()
  })
  it('換配置要在據點或調校診所，委託副本裡不能換', () => {
    expect(rearrangeBlock({ atHome: true, atClinic: false, inRun: false })).toBeNull()
    expect(rearrangeBlock({ atHome: false, atClinic: false, inRun: false })).toContain('據點')
    expect(rearrangeBlock({ atHome: true, atClinic: false, inRun: true })).toContain('委託副本')
  })
})

describe('夜課（LEWD_SYSTEM 第 10 節）', () => {
  const p: NightProfile & { params: Record<string, number> } = { count: 9, partners: 3, axes: { 關係: 1, 感官: 2, 身體: 0, 扮相: 1 }, tags: { 溺愛: '有' }, filtered: new Set(['束縛']), params: { 耐受: 38, 馴化: 15, 慾求: 22, 敏感度: 46 } }
  it('共通看次數或人數；其他看軸', () => {
    expect(nightTierOpen('common', p)).toBe(2)
    expect(nightTierOpen('sense', p)).toBe(2)
    expect(nightTierOpen('body', p)).toBe(0)
  })
  it('沒有的標籤不顯示，被篩選關掉的整個不出現', () => {
    const rel = NIGHT_BRANCHES.find(b => b.id === 'relation')!
    const pamper = rel.skills.find(s => s.tag === '溺愛')!
    const bind = rel.skills.find(s => s.tag === '束縛')!
    const little = rel.skills.find(s => s.tag === '妹系')!
    expect(nightVisible(pamper, p)).toBe('show')
    expect(nightVisible(bind, p)).toBe('filtered')
    expect(nightVisible(little, p)).toBe('hidden-tag')
  })
  it('體悟不夠、條件不夠都說原因', () => {
    const c = NIGHT_BRANCHES.find(b => b.id === 'common')!
    const s = c.skills.find(k => k.tier === 2)!
    expect(nightLearnBlock(s, new Set(), p, 4)).toContain('要 20 點體悟')
    expect(nightNeedBlock('耐受 40', p)).toBe('要耐受 40，你是 38。')
    expect(nightNeedBlock('對象 3 人', p)).toBeNull()
  })
})
