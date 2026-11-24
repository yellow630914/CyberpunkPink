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

/**
 * ENEMIES 1.5 節「內海」那張表（BALANCE 2.4、2.6 節）：攻擊、防護、RAM（雜／精／首）、每回合回 RAM；感載上限、層數、行動點與現實同（用 ENEMY_CURVE 的）。
 * 表上沒有的兩欄照 dev/adr/0018：傷害骰（位階定顆數，再加等級骰；N18）、防火牆（迴避）= 11 ＋ 等級（N19）。
 * 和 engine/src/testkit/battle.ts 的 NET_TARGETS 是同一張表（測試會比對）。
 */
export const NET_CURVE = {
  attack: [3, 4, 5, 6, 7] as Five,
  guard: [1, 2, 3, 4, 5] as Five,
  ram: { minion: [4, 4, 5, 5, 6] as Five, elite: [6, 6, 7, 7, 8] as Five, boss: [8, 8, 9, 9, 10] as Five },
  ramRegen: [2, 2, 2, 3, 3] as Five,
  /** 網內敵人的傷害骰：雜兵 4、精英 5、首領 6（III 級起再加等級骰） */
  dice: { minion: 4, elite: 5, boss: 6 },
  /** 防火牆（迴避）= 這個數字 ＋ 等級 */
  firewall: 11,
}

/** 沒寫 sync 的預設（CYBERSPACE 6.4 節：雜兵標準、精英深、首領會換）。 */
export const DEFAULT_SYNC = { minion: 'standard', elite: 'deep', boss: 'shift' } as const
/** 會換檔的敵人換檔之前開的檔位與它的上限（N25）：深檔。 */
export const SHIFT_GEAR = 'deep'
/** 白蕾絲在戰鬥裡的追蹤度到這個數字，自己的回合開始就撤走（ENEMIES 第 9 節；和 netcombat 規則表的 trace.t2 同一個數字）。 */
export const WHITE_LEAVES_AT = 60
/** 會偏好深檔的敵人（ai.prefer_deep_sync）挑目標時，候選人在深檔、全檔各加的百分點（ENEMIES 第 9 節：回灌 ×1.5～×2）。 */
export const DEEP_SYNC_PCT = { deep: 50, full: 100 } as const

/** 遭遇的種類與點數的預算（ENEMIES 第 13 節）。 */
export const ENCOUNTER_BUDGET = { light: 2, normal: 4, heavy: 5.5, boss: 8 } as const

/** 掛在格上的小型無人機與砲塔每一台的點數（ENEMIES 第 13 節）。 */
export const OVERLAY_POINTS = 0.5
