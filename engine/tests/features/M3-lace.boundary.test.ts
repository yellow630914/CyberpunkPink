// 邊界測試：蕾絲（網內的敵人）每一級（I～V）每一種位階（雜兵、精英、首領）的數字對 ENEMIES 1.5 節「內海」那張表與 CYBERSPACE 6.2 節。
// 表：攻擊加值 +3～+7、防護 1～5、感載上限（雜／精／首）22／37／52 … 49／82／115、RAM 4／6／8 … 6／8／10、每回合回 RAM 2（IV 起 3）；
// 承受層數 1／2／4；行動點 4／5／6（IV 級起精英與首領再 +1）；網內敵人的傷害骰雜兵 4、精英 5、首領 6，III 級起再加等級骰（III +1、IV +2、V +3；CYBERSPACE 6.2 節）；
// 防火牆（迴避）11 ＋ 等級（dev/adr/0018 N19）；主角的感載上限約 38、3 層（CYBERSPACE 6.2 節）。
// 用自己帶的最小兵種（一個自己的勢力、沒有任何 mods），走真正的單位來源 enemy_pick，不用 testkit 的 laceUnit。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { makeNetBattleGame, netAvatar } from '../../src/testkit'

const RANKS = ['minion', 'elite', 'boss'] as const
const LOAD = [[22, 37, 52], [27, 45, 63], [33, 55, 77], [40, 67, 94], [49, 82, 115]]
const RAM = [[4, 6, 8], [4, 6, 8], [5, 7, 9], [5, 7, 9], [6, 8, 10]]
const REGEN = [2, 2, 2, 3, 3]
const ATTACK = [3, 4, 5, 6, 7]
const GUARD = [1, 2, 3, 4, 5]
const LAYERS = [1, 2, 4]
const BASE_DICE = [4, 5, 6]
const GRADE_DICE = [0, 0, 1, 2, 3]

const PACK: ContentPack = {
  id: 'wb_lace_table',
  content: {
    faction: [{ id: 'f_wb', name: '白箱幫', short: '白', class: 'street' }],
    enemy: RANKS.map((rank) => ({
      id: `en_wb_${rank}`, name: `白箱${rank}`, desc: '測試用的網內敵人，沒有任何修正。', faction: 'f_wb', rank, grades: [1, 5], kind: 'lace', color: 'pink',
      position: { prefer: [2] }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, constructs: [{ id: `cs_wb_${rank}`, class: 'pistol', type: 'neural', ram: 1 }],
    })),
  } as never,
}

function foesAt(grade: number) {
  const { game } = makeNetBattleGame({ noBattle: true, content: [PACK] as never })
  game.startBattle({
    mode: 'net', grade, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
    foes: RANKS.map((rank) => ({ from: 'enemy_pick', faction: 'f_wb', grade, rank, color: 'pink', seed: `wb/${rank}` })), origin: { escapable: true, place: '白箱', faction: 'f_wb' },
  } as never)
  const units = Object.values(game.battle!.units).filter((u) => u.side === 'foe')
  return RANKS.map((rank) => units.find((u) => u.enemy === `en_wb_${rank}`)!)
}

describe('邊界 ENEMIES 1.5 節（內海）：每一級每一種位階的蕾絲', () => {
  for (let grade = 1; grade <= 5; grade++) {
    it(`${['I', 'II', 'III', 'IV', 'V'][grade - 1]} 級：感載上限、承受層數、RAM 與回復、防護、防火牆、攻擊加值、行動點、傷害骰`, () => {
      const units = foesAt(grade)
      units.forEach((u, i) => {
        const at = `${['I', 'II', 'III', 'IV', 'V'][grade - 1]} 級${['雜兵', '精英', '首領'][i]}`
        expect(u.load!.max, `${at}的感載上限`).toBe(LOAD[grade - 1]![i])
        expect(u.layersMax, `${at}的承受層數`).toBe(LAYERS[i])
        expect(u.hp, `${at}沒有生命值`).toBeUndefined()
        expect(u.pools.ram, `${at}的 RAM`).toMatchObject({ max: RAM[grade - 1]![i], now: RAM[grade - 1]![i], regen: REGEN[grade - 1] })
        expect(u.armor, `${at}的防護`).toBe(GUARD[grade - 1])
        expect(u.evade, `${at}的防火牆`).toBe(11 + grade)
        const ap = [4, 5, 6][i]! + (grade >= 4 && i > 0 ? 1 : 0)
        expect(u.ap.max, `${at}的行動點`).toBe(ap)
        expect(u.weapons[0]!.hit, `${at}的攻擊加值`).toBe(ATTACK[grade - 1])
        expect(u.weapons[0]!.dice, `${at}的傷害骰`).toBe(BASE_DICE[i]! + GRADE_DICE[grade - 1]!)
      })
    })
  }

  it('性質：感載上限、RAM、防護、攻擊加值、傷害骰都隨等級只增不減，隨位階只增不減（雜兵 ≤ 精英 ≤ 首領）', () => {
    const all = [1, 2, 3, 4, 5].map((g) => foesAt(g))
    for (let g = 1; g < 5; g++) {
      all[g]!.forEach((u, i) => {
        const p = all[g - 1]![i]!
        expect(u.load!.max).toBeGreaterThan(p.load!.max)
        expect(u.pools.ram!.max).toBeGreaterThanOrEqual(p.pools.ram!.max)
        expect(u.armor).toBeGreaterThan(p.armor)
        expect(u.weapons[0]!.hit).toBeGreaterThan(p.weapons[0]!.hit)
        expect(u.weapons[0]!.dice).toBeGreaterThanOrEqual(p.weapons[0]!.dice)
      })
    }
    for (const units of all) for (let i = 1; i < 3; i++) {
      expect(units[i]!.load!.max).toBeGreaterThan(units[i - 1]!.load!.max)
      expect(units[i]!.layersMax).toBeGreaterThan(units[i - 1]!.layersMax)
      expect(units[i]!.weapons[0]!.dice).toBeGreaterThan(units[i - 1]!.weapons[0]!.dice)
    }
  })

  it('主角（CYBERSPACE 6.2 節）：同級主力的化身感載上限約 38、3 層、RAM 5 回復 2（沒有生命值）', () => {
    const a = netAvatar(0, 1)
    expect(a.load!.max).toBe(38)
    expect(a.layersMax).toBe(3)
    expect(a.hp).toBeUndefined()
    expect(a.pools.ram).toMatchObject({ max: 5, regen: 2 })
  })
})
