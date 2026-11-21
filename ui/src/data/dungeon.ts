/**
 * 地下城式的任務區域（docs/world/SITES.md 第 11 節）：蜂巢的垃圾滑道，3 層（垂直）、黑、會刷新。每層 11 × 9。
 * 版面：'#' 牆、'.' 地板、S 進來的地方、U 往上、D 往下的通道、E 遭遇、T 陷阱、L 藏貨、R 安全點。
 */
export type DungeonFeature = 'start' | 'up' | 'down' | 'enemy' | 'trap' | 'loot' | 'rest'
export const FEATURE_OF: Record<string, DungeonFeature> = { S: 'start', U: 'up', D: 'down', E: 'enemy', T: 'trap', L: 'loot', R: 'rest' }
export const FEATURE_INFO: Record<DungeonFeature, { name: string; icon: string; hint: string }> = {
  start: { name: '投口', icon: 'ic-fac_under', hint: '從四號塔的投口滑下來的地方，也是長休的營地。' },
  up: { name: '往上', icon: 'ic-fac_gate', hint: '回到上一層。' },
  down: { name: '往下的通道', icon: 'ic-fac_metro', hint: '往下一層。有的通道有東西守著。' },
  enemy: { name: '遭遇', icon: 'ic-dmg_physical', hint: '鼠型無人機或拆體客。可以打，也可以繞路。' },
  trap: { name: '陷阱', icon: 'ic-dmg_emp', hint: '漏電、蒸氣、捕獸夾式的抓捕索、會叫的感測器。黑暗裡察覺陷阱 DC +3。' },
  loot: { name: '藏貨', icon: 'ic-cargo', hint: '卡住的東西、拆體客藏的貨。' },
  rest: { name: '安全點', icon: 'ic-fac_hotel', hint: '可以短休；長休要在入口。' },
}
export interface DungeonFloor { name: string; rows: string[]; names: Record<string, string> }
export const TRASH_CHUTE: { name: string; district: string; light: string; refresh: string; floors: DungeonFloor[] } = {
  name: '垃圾滑道', district: '蜂巢', light: '黑', refresh: '會',
  floors: [
    { name: '第 1 層・投口下', rows: [
      '#####S#####',
      '#...#.#...#',
      '#.L.#.#.E.#',
      '#...#...#.#',
      '##.####.#.#',
      '#..T....#R#',
      '#.#####.#.#',
      '#...E.....#',
      '#####D#####',
    ], names: { '2,2': '卡住的行李箱', '8,2': '鼠型無人機 ×2', '3,5': '漏電的管線', '9,5': '乾燥的檢修平台', '4,7': '鼠型無人機', '5,8': '往下的滑道' } },
    { name: '第 2 層・積水層', rows: [
      '#####U#####',
      '#.....#...#',
      '#.###.#.L.#',
      '#.#E..T...#',
      '#.#.###.###',
      '#...#R..#.#',
      '###.#.###.#',
      '#L..E.....#',
      '#########D#',
    ], names: { '8,2': '拆體客藏的貨', '3,3': '拆體客的眼線', '6,3': '會叫的感測器', '5,5': '廢棄的配電室', '1,7': '漂來的工具箱', '4,7': '鼠型無人機 ×3', '9,8': '更深的滑道' } },
    { name: '第 3 層・奈落', rows: [
      '#########U#',
      '#...#.....#',
      '#.L.#.###.#',
      '#...T.#L#.#',
      '###.###.#.#',
      '#E..#...E.#',
      '#.#.#.#####',
      '#.#...L..R#',
      '###########',
    ], names: { '2,2': '一箱二手晶片', '4,3': '捕獸夾式的抓捕索', '7,3': '拆體客的貨櫃', '1,5': '拆體客 ×2', '8,5': '改裝的清潔機', '6,7': '裡面敲打的聲音', '9,7': '通風口下' } },
  ],
}
