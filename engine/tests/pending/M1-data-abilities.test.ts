// 驗收測試：dev/work/M1-data-abilities.md（cpp-data）。前置：M1-abilities 已經做完。做完之前照預期失敗。
// 規格：SKILL_TREES 槍手、掮客兩棵樹（各 27 個技能、5 個共鳴）；SKILLS 1.3、1.9、1.10 節；DATA 第 2 節。

import { describe, expect, it } from 'vitest'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK, SOURCES } from '../../data'

interface Sk { id: string; name: string; path: string; tier: number; layer: string; after?: string; kind: string; cap: number; xp: number; cells: number; text: string; use?: Record<string, unknown>; meat: unknown; net: unknown; opinion: unknown; prep?: unknown; daily?: unknown }
const game = () => new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })

describe('M1-data-abilities：槍手與掮客兩棵樹', () => {
  it('兩棵樹：各 27 個技能（1 個招牌、每階前層 3 個、後層 2～3 個）、5 個共鳴；容量與歷練照規則', () => {
    const g = game()
    expect(g.k.content.checkRefs()).toEqual([])
    expect(SOURCES.ability).toMatch(/SKILL_TREES/)
    const paths = g.k.content.list<{ id: string; name: string; tree: string; signature: string; category: string; domains: Record<string, string>; resonance: Array<{ tier: number; text: string }> }>('path')
    expect(paths.map((p) => [p.id, p.name, p.tree, p.category, p.signature])).toEqual([['gunner', '槍手', '戰鬥直覺', 'meat', 'sk_gunner_instinct'], ['fixer', '掮客', '人面', 'social', 'sk_fixer_face']])
    expect(paths[0]!.domains).toEqual({ meat: 'strong', net: 'weak', opinion: 'none' })
    expect(paths[1]!.domains).toEqual({ meat: 'strong_support', net: 'mid', opinion: 'mid' })
    const all = g.k.content.list<Sk>('ability')
    for (const p of paths) {
      const tree = all.filter((s) => s.path === p.id)
      expect(tree, p.id).toHaveLength(27)
      expect(p.resonance.map((r) => r.tier)).toEqual([1, 2, 3, 4, 5])
      expect(tree.filter((s) => s.layer === 'signature').map((s) => s.id)).toEqual([p.signature])
      for (const tier of [1, 2, 3, 4, 5]) {
        const at = tree.filter((s) => s.tier === tier && s.layer !== 'signature')
        expect(at.filter((s) => s.layer === 'front'), `${p.id} ${tier} 階前層`).toHaveLength(3)
        expect(at.filter((s) => s.layer === 'back').length, `${p.id} ${tier} 階後層`).toBeGreaterThanOrEqual(2)
      }
      for (const s of tree) {
        expect(s.id.startsWith(`sk_${p.id}_`), s.id).toBe(true)
        expect(s.xp, s.id).toBe(s.tier * 20)
        expect(s.cap >= 1 && s.cap <= 6, s.id).toBe(true)
        expect(s.text.length, s.id).toBeGreaterThan(8)
        if (s.layer !== 'signature') expect(tree.some((x) => x.id === s.after), `${s.id} 的前置 ${s.after}`).toBe(true)
        // 這棵樹「無」的戰場那一欄一定是 null；每個技能至少一欄有效果
        if (p.domains.opinion === 'none') expect(s.opinion, s.id).toBeNull()
        expect([s.meat, s.net, s.opinion, s.prep, s.daily].some((x) => x !== null && x !== undefined), s.id).toBe(true)
      }
      // 八個招牌的容量都是 3
      expect(tree.find((s) => s.layer === 'signature')!.cap).toBe(3)
    }
  })

  it('設計書舉例的幾個技能逐項對得上（SKILL_TREES）', () => {
    const g = game()
    const get = (id: string) => g.k.content.get<Sk>('ability', id)!
    expect(get('sk_gunner_aimed_shot')).toMatchObject({ name: '要害射擊', tier: 1, layer: 'front', after: 'sk_gunner_instinct', kind: 'active', cap: 1, use: { ap: 3 } })
    expect(get('sk_gunner_burst')).toMatchObject({ name: '連射控制', tier: 1, kind: 'active', cap: 1, use: { ap: 3 } })
    expect(get('sk_gunner_point_shot')).toMatchObject({ name: '定點射', tier: 2, after: 'sk_gunner_aimed_shot' })
    expect(get('sk_gunner_one_shot')).toMatchObject({ name: '一槍定局', tier: 5, layer: 'front', cap: 3, use: { ap: 3, per_fight: 1 }, net: null })
    expect(get('sk_fixer_focus_fire')).toMatchObject({ name: '集火', tier: 1, layer: 'front', after: 'sk_fixer_face', kind: 'active', cap: 1, use: { ap: 1 } })
    expect(get('sk_fixer_bail')).toMatchObject({ name: '保釋', tier: 3, kind: 'reaction', cap: 2 })
    expect(get('sk_fixer_prep')).toMatchObject({ name: '戰前佈置', kind: 'prep', meat: null, net: null })
    // 起手建議的容量對得上（SKILL_TREES 槍手：戰鬥直覺、要害射擊、掩護射擊、點放、看我的！、連射控制合計容量 9）
    const starter = ['sk_gunner_instinct', 'sk_gunner_aimed_shot', 'sk_gunner_cover_fire', 'sk_gunner_tap', 'sk_gunner_watch_me', 'sk_gunner_burst']
    expect(starter.reduce((n, id) => n + get(id).cap, 0)).toBe(9)
    expect(starter.reduce((n, id) => n + get(id).xp, 0)).toBe(120)
  })
})
