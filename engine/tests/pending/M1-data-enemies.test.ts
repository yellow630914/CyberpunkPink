// 驗收測試：dev/work/M1-data-enemies.md（cpp-data）。前置：M1-data-rules、M1-enemies、M1-defeat 已經做完。做完之前照預期失敗。
// 規格：ENEMY_ROSTER（二十九個勢力的制式兵種）；ENEMIES 1.5、1.6 節、第 8.1 節（勢力的預設）、第 13 節；DATA 第 6.1 節。

import { describe, expect, it } from 'vitest'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { ENEMY_CURVE, encounterPoints } from '../../src/features/enemies'
import { CORE_PACK, SOURCES } from '../../data'

interface EnemyRow { [key: string]: unknown; id: string; name: string; desc: string; faction: string; rank: 'minion' | 'elite' | 'boss'; grades: [number, number]; kind: string; mode: string; mods?: Record<string, number>; weapons: Array<{ class: string }>; position: { prefer: number[] }; adult?: string[] | null; named?: boolean }
const game = () => new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
const rows = (g: Game) => g.k.content.list<EnemyRow>('enemy')

describe('M1-data-enemies：敵人名冊', () => {
  it('整包載得進去、引用都找得到；每個敵人屬於一個勢力（或 none），等級範圍落在那個勢力的範圍裡（ENEMIES 1.6 節）', () => {
    const g = game()
    expect(g.k.content.checkRefs()).toEqual([])
    expect(SOURCES.enemy).toMatch(/ENEMY_ROSTER/)
    const RANGE: Record<string, [number, number]> = { hizakura: [2, 5], starbelle: [2, 5], nectar: [2, 5], nightingale: [2, 5], kunlun: [2, 4], eden: [1, 4], kaleido: [1, 4] }
    const list = rows(g)
    // 現實的制式兵種（蕾絲、程式、內海的化身在 M3）：名冊第一到第五部分裡「種類」是人、機器、吉祥物的那些，一共約 140 筆
    expect(list.length).toBeGreaterThanOrEqual(130)
    expect(list.length).toBeLessThanOrEqual(150)
    // 二十九個勢力每一個都有現實的兵種
    expect(new Set(list.map((e) => e.faction).filter((f) => f !== 'none')).size).toBe(29)
    for (const e of list) {
      expect(e.id.startsWith('en_'), e.id).toBe(true)
      expect(['human', 'unbridged', 'machine', 'mascot'], `${e.id} 的 kind`).toContain(e.kind)
      expect(e.named, e.id).toBeUndefined() // 具名敵人跟著任務走，不進名冊
      expect(e.desc.length, e.id).toBeGreaterThan(10)
      expect(e.grades[0], e.id).toBeLessThanOrEqual(e.grades[1])
      const r = RANGE[e.faction]
      if (r) expect(e.grades[0] >= r[0] && e.grades[1] <= r[1], `${e.id} 的等級 ${e.grades} 超出 ${e.faction} 的範圍`).toBe(true)
      expect(e.position.prefer.every((s) => s >= 1 && s <= 4), e.id).toBe(true)
    }
  })

  it('每個兵種落在目標表的 ±15% 之內，兵種寫的修正除外（ENEMIES 1.3 節）：修正只寫相對於表的倍數或加減', () => {
    for (const e of rows(game())) {
      const m = e.mods ?? {}
      for (const key of Object.keys(m)) expect(['hp', 'load', 'armor', 'evade', 'attack', 'sensitivity', 'ap', 'layers'], `${e.id}.mods.${key}`).toContain(key)
      // 倍數類（生命、感載）寫成 0.5～1.5；加減類寫成整數
      for (const key of ['hp', 'load']) if (m[key] !== undefined) expect(m[key]! >= 0.5 && m[key]! <= 1.5, `${e.id}.mods.${key}`).toBe(true)
      for (const key of ['armor', 'evade', 'attack', 'ap', 'layers']) if (m[key] !== undefined) expect(Number.isInteger(m[key]), `${e.id}.mods.${key}`).toBe(true)
    }
  })

  it('設計書舉例的那幾個兵種逐項對得上（ENEMY_ROSTER 緋櫻重工）', () => {
    const g = game()
    const get = (id: string) => g.k.content.get<EnemyRow>('enemy', id)!
    expect(get('en_hz_patrol')).toMatchObject({ name: '警備局巡查', faction: 'hizakura', rank: 'minion', grades: [2, 3], kind: 'human', mode: 'capture', position: { prefer: [2, 3] }, weapons: [{ class: 'neural_gun' }], ai: { prefer: 'overloaded', focus: 1, flee_below: 0.3 }, adult: ['服從', '束縛'] })
    expect(get('en_hz_patrol').mods ?? {}).toEqual({})
    expect(get('en_hz_riot')).toMatchObject({ rank: 'minion', grades: [3, 5], position: { prefer: [1] }, mods: { hp: 1.1, armor: 2, evade: -1 } })
    expect(get('en_hz_hk_maid')).toMatchObject({ name: '家政課女僕', rank: 'elite', grades: [3, 5], mods: { hp: 0.9, evade: 1, armor: 1, sensitivity: 40 }, defeat: 'tuning', ai: { prefer: 'leader', focus: 1.2, flee_below: 0.2 } })
    expect(g.k.content.get('enemy', 'en_hz_lace_maid')).toBeUndefined() // 蕾絲是內海的敵人，M3 再收
  })

  it('遭遇：每一級至少一場一般遭遇（4 點上下）與一場首領戰（8 點上下），只用制式兵種', () => {
    const g = game()
    const encounters = g.k.content.list<{ id: string; grade: number; kind: 'normal' | 'boss' | 'light' | 'heavy'; foes: Array<{ enemy: string; grade?: number }> }>('encounter')
    for (const grade of [1, 2, 3, 4, 5]) {
      const at = encounters.filter((e) => e.grade === grade)
      expect(at.some((e) => e.kind === 'normal'), `${grade} 級的一般遭遇`).toBe(true)
      if (grade >= 2) expect(at.some((e) => e.kind === 'boss'), `${grade} 級的首領戰`).toBe(true)
    }
    const budget = { light: 2, normal: 4, heavy: 5.5, boss: 8 }
    for (const e of encounters) {
      const pts = encounterPoints(g.k, e.foes, e.grade)
      expect(Math.abs(pts - budget[e.kind]), `${e.id}：${pts} 點`).toBeLessThanOrEqual(0.75)
      expect(e.foes.length, e.id).toBeGreaterThan(0)
    }
    expect(ENEMY_CURVE.points).toEqual({ minion: 1, elite: 2.5, boss: 5 })
  })

  it('戰敗事件（略過版用的那幾筆）：有一筆通用的；二十九種的內容留到 M2', () => {
    const g = game()
    const list = g.k.content.list<{ id: string; default?: boolean; versions: Record<string, { text: string }> }>('defeat_event')
    expect(list.filter((e) => e.default).map((e) => e.id)).toEqual(['df_generic'])
    expect(list.find((e) => e.id === 'df_generic')!.versions.default!.text.length).toBeGreaterThan(5)
  })
})
