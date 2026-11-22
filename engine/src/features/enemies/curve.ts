// 敵人的目標表（ENEMIES 1.5 節「現實」那張表；BALANCE 2.4 節）。索引 0 是 I 級。
// 和 engine/src/testkit/battle.ts 的 ENEMY_TARGETS 是同一張表（測試會比對）；功能不可以 import testkit，所以這裡自己寫一份。

type Five = readonly [number, number, number, number, number]

export const ENEMY_CURVE = {
  attack: [3, 4, 5, 6, 7] as Five,
  evade: [10, 12, 14, 16, 18] as Five,
  armor: [1, 2, 3, 4, 5] as Five,
  hp: { minion: [45, 55, 67, 82, 100] as Five, elite: [110, 130, 165, 205, 250] as Five, boss: [260, 300, 380, 470, 580] as Five },
  load: { minion: [22, 27, 33, 40, 49] as Five, elite: [37, 45, 55, 67, 82] as Five, boss: [52, 63, 77, 94, 115] as Five },
  layers: { minion: 1, elite: 2, boss: 4 },
  /** IV 級以上的精英與首領再 +1 */
  ap: { minion: 4, elite: 5, boss: 6 },
  /** 位階的傷害倍率，只乘在生命的傷害上 */
  rankDamage: { minion: 0.4, elite: 0.6, boss: 1 },
  /** capture 與 neural 的神經武器的骰數（再加等級骰） */
  captureDice: { minion: 4, elite: 6, boss: 11 },
  /** 遭遇的點數（ENEMIES 第 13 節） */
  points: { minion: 1, elite: 2.5, boss: 5 },
}

/** 遭遇的種類與點數的預算（ENEMIES 第 13 節）。 */
export const ENCOUNTER_BUDGET = { light: 2, normal: 4, heavy: 5.5, boss: 8 } as const

/** 掛在格上的小型無人機與砲塔每一台的點數（ENEMIES 第 13 節）。 */
export const OVERLAY_POINTS = 0.5
