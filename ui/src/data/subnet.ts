/**
 * 子網地圖（docs/systems/CYBERSPACE.md 第 8 節，一層 11 × 9）。藍鯨物流的倉儲子網：設施類型「倉儲與物流」，員工、核心兩層（8.3 節）。
 * 版面：'#' 不通、'.' 鏈路，其他字母是節點（設施）：
 * S 入口、G 閘門、A 檔案庫、C 控制節點、L 蕾絲（遭遇）、P 人、W 警報節點、O 迴圈碎片、B 後門、T 目標。
 */
export type NodeKind = 'entrance' | 'gate' | 'archive' | 'control' | 'lace' | 'person' | 'alarm' | 'loop' | 'backdoor' | 'target'

export const NODE_INFO: Record<NodeKind, { name: string; icon: string; color: string; hint: string }> = {
  entrance: { name: '入口', icon: 'ic-fac_gate', color: '#45D6C5', hint: '這一層的進入點。第一層的入口連著企業的前台。' },
  gate: { name: '閘門', icon: 'ic-net_defense', color: '#1E2346', hint: '通往下一層。有憑證、後門鑰匙或破解時可以通過。' },
  archive: { name: '檔案庫', icon: 'ic-cargo', color: '#F2B33D', hint: '要拿的東西。下載時待在節點上，子網裡每回合追蹤度 +2。' },
  control: { name: '控制節點', icon: 'ic-fac_electro', color: '#8A6FE0', hint: '連著現實的裝置。接管之後，後面的現實階段可以用它（開門、關攝影機）。' },
  lace: { name: '蕾絲', icon: 'ic-net_body', color: '#F06AA0', hint: '一場戰鬥。可以潛行繞過，或用偽裝混過去。戰鬥每回合追蹤度 +3。' },
  person: { name: '人', icon: 'ic-bs_negotiate', color: '#3B8FD9', hint: '連在這座子網上的員工。可以快駭、可以談。' },
  alarm: { name: '警報節點', icon: 'ic-bs_investigate', color: '#E0642E', hint: '陷阱：踩到時追蹤度 +10。' },
  loop: { name: '迴圈碎片', icon: 'ic-dmg_neural', color: '#E0334A', hint: '陷阱：過介面或意志的檢定（II 級 DC 12），失敗的話感載 +8，被送回這一層的入口。' },
  backdoor: { name: '後門', icon: 'ic-net_tool', color: '#2EC2B0', hint: '安全點：可以短休，也可以從這裡正常登出。下次可以直接從這一層進來。' },
  target: { name: '目標', icon: 'ic-footage', color: '#F06AA0', hint: '委託寫死的節點：下載藍鯨的帳本，要待 3 個回合。' },
}

const KIND_BY_CHAR: Record<string, NodeKind> = { S: 'entrance', G: 'gate', A: 'archive', C: 'control', L: 'lace', P: 'person', W: 'alarm', O: 'loop', B: 'backdoor', T: 'target' }
export const nodeKindOf = (ch: string): NodeKind | null => KIND_BY_CHAR[ch] ?? null

export interface SubnetFloor { id: string; name: string; layer: string; rows: string[]; names: Record<string, string> }

export const BLUEWHALE: { name: string; facility: string; grade: string; floors: SubnetFloor[]; affixes: string[] } = {
  name: '藍鯨物流',
  facility: '倉儲與物流',
  grade: 'II',
  affixes: ['剛被翻過'],
  floors: [
    {
      id: 'staff', name: '員工層', layer: '員工',
      rows: [
        'S...W..#A##',
        '#.#.##.#.##',
        '#.#.##...C#',
        '#P#.###.###',
        '#...L...#B#',
        '###.#.#.#.#',
        '#O..#.#...#',
        '#.###.###.#',
        '#...A.....G',
      ],
      names: { '8,0': '提貨單的檔案庫', '9,2': '控制節點：第三倉的卸貨閘', '1,3': '值班的倉管', '4,4': '粉蕾絲・客服型', '9,4': '預埋的後門', '4,8': '排班表的檔案庫', '10,8': '往核心的閘門', '4,0': '警報節點', '1,6': '迴圈碎片', '0,0': '前台的接縫' },
    },
    {
      id: 'core', name: '核心', layer: '核心',
      rows: [
        '#####S#####',
        '#A..#.#..T#',
        '#.#.#.#.###',
        '#.#.....C.#',
        '#.###L###.#',
        '#...#.#...#',
        '###.#.#.###',
        '#P..O.L..B#',
        '###########',
      ],
      names: { '5,0': '從閘門下來', '1,1': '帳戶餘額的檔案庫', '9,1': '藍鯨的帳本', '8,3': '控制節點：整層樓的燈', '5,4': '白蕾絲・鑰匙', '1,7': '被困住的稽核員', '4,7': '迴圈碎片', '6,7': '精英：值班潛網者', '9,7': '後門' },
    },
  ],
}

/**
 * 巡邏（CYBERSPACE 8.4 節、NETRUNNING 第 5 節）：守衛程式沿著一條路來回走，你每走一步牠走一步。
 * 走到你旁邊（上下左右一格）就是遭遇：開戰、潛行，或用「斷路」把牠卡住三步。追蹤度到 30（起疑）起，每一層多一隊（extra）。
 */
export interface PatrolDef { id: string; floor: number; name: string; route: Array<[number, number]>; extra?: boolean }
const line = (y: number, x0: number, x1: number): Array<[number, number]> => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y])
const col = (x: number, y0: number, y1: number): Array<[number, number]> => Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i])
export const PATROLS: PatrolDef[] = [
  { id: 'p1', floor: 0, name: '守衛程式・甲', route: line(8, 5, 9) },
  { id: 'p2', floor: 0, name: '守衛程式・乙', route: col(3, 0, 4), extra: true },
  { id: 'p3', floor: 1, name: '守衛程式・丙', route: line(3, 3, 7) },
  { id: 'p4', floor: 1, name: '守衛程式・丁', route: line(5, 1, 3), extra: true },
]
