// L6 功能 netrun 的資料：活動的名字、狀態的形狀、區的規則表（net_region）與探索的數字（netrun_rule）。
// 規格：CYBERSPACE 8.1 節（生成的規則、密度表、節點）、8.3 節（一般子網）；NETRUNNING 第 5 節（追蹤度）；dev/adr/0018 第六、七節與 N2、N5、N26。
//
// 一趟網內的行程（活動 face.net 與 netrun 共用同一份狀態 state.ext.netrun）：
//   - 整趟是一份地圖實例（trace 量表的鍵就是它），每一層是實例裡的一張圖（sheet）；往下一層是把人放到下一張圖的入口，追蹤度不歸零。
//   - 生成器吐出的節點圖、藏起來的東西、保證的路存在實例的 ext.net（不在版面裡），每一個遭遇節點放誰也在那裡。
// 這個功能不 import 別的功能：敵人只經由單位來源 enemy_pick、副本的事只從 setup 與 origin 來、甲板只問衍生數值 deck_grade。
// 第二張（M3-netrun-nodes）加了：檔案庫的表（net_region.archive_table）、陷阱的數字（net_region.trap）、六種目標、控制節點、人、陷阱、巡邏、後門鑰匙與憑證、
// 擦痕跡與破解、帶出去才算數；它們的狀態在地圖實例的 ext.net（traps、patrols、controls、keys、wiped、used、opened）與這一趟的 goal、loot。

import type { ActivityEndMerged, Change, GameState, GenResult, GridPoint, Origin, UnitRef } from '../../core'
import { clone, isRecord } from '../../core'

export const OWNER = 'netrun'
/** state.ext 的鍵：一趟網內的行程（沒有在進行是沒有這個鍵）。 */
export const EXT = 'netrun'
export const ACT_NET = 'netrun'
export const ACT_FACE = 'face.net'
export const REGION_KIND = 'net_region'
export const RULE_KIND = 'netrun_rule'
export const TRACE = 'trace'
/** 網內的戰場（核心的 battle_mode）。 */
export const NET_MODE = 'net'

export type Rank = 'minion' | 'elite' | 'boss'
export const RANKS: readonly Rank[] = ['minion', 'elite', 'boss']
export type Range2 = [number, number]

// ---- 區的規則表 ----

/** 一層放什麼（CYBERSPACE 8.1 節的密度表）：每一項是 [最少, 最多]。patrol 這一張不放（下一張 M3-netrun-nodes 的巡邏是會動的東西，不是格子）。 */
export interface LayerCounts {
  foe: Range2
  patrol: Range2
  archive: Range2
  trap: Range2
  rest: Range2
  safe: Range2
  control: Range2
  person: Range2
}
export const COUNT_KEYS: readonly (keyof LayerCounts)[] = ['foe', 'patrol', 'archive', 'trap', 'rest', 'safe', 'control', 'person']

export interface NetRegion {
  id: string
  name: string
  /** 地圖的種類（NET_MAP_KINDS：subnet、maze、wreck、deep） */
  map_kind: string
  size: [number, number]
  /** 挖幾步（決定節點的多寡） */
  carve: Range2
  /** 視野的半徑（N26：子網 2 格） */
  sight: number
  /** 鏈路裡單向的、走過就斷的比例（0～1；生成器放得下幾個還看圖）、挖完之後最多再打通幾處讓路成環（0～6）。沒寫就是沒有單向、沒有會斷的 */
  oneway?: number
  fragile?: number
  loops?: number
  /** 壓力條：trace 是追蹤度，none 沒有 */
  pressure: 'trace' | 'none'
  /** true：這一區開的戰鬥帶場地效果 safe（倒下不加沉溺；迷宮館的熔斷保護） */
  safe?: boolean
  /** 遭遇的遮蔽：COVER_LAYOUTS 的名字，或八格逐格寫 */
  cover: string | { ally: number[]; foe: number[] }
  /** DC 照等級（I～V） */
  dc: number[]
  layer: LayerCounts
  /** 委託的階段用的那一組（蓋掉 layer） */
  commission?: LayerCounts
  /** 檔案庫的表（CYBERSPACE 8.3 節「檔案庫」d6）：每個檔案庫擲一次（照權重）；give 是一串效果（內建來源），數字可以寫照等級的五個值。沒有表的區開了是空的 */
  archive_table?: ArchiveRow[]
  /** 陷阱的數字（8.1 節：警報節點追蹤度 +10；迴圈碎片感載 +8，I 級的數字，照等級乘） */
  trap?: { alarm: number; loop_load: number }
}

export interface ArchiveRow {
  weight: number
  name: string
  give: Array<Record<string, unknown>>
}

export const DEFAULT_TRAP = { alarm: 10, loop_load: 8 }

/** 內建的一般子網（CYBERSPACE 8.1 節「每一層的密度」一般子網那一列；委託的階段照 N2：只有階段寫的那一場，加一隊可以躲的巡邏與一兩個陷阱）。 */
export const DEFAULT_REGIONS: Record<string, NetRegion> = {
  subnet: {
    id: 'subnet', name: '一般子網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
    layer: { foe: [2, 3], patrol: [1, 1], archive: [1, 2], trap: [1, 2], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
    commission: { foe: [1, 1], patrol: [1, 1], archive: [0, 0], trap: [1, 2], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
  },
}

// ---- 探索的數字（規則表 netrun_rule） ----

export interface NetrunRules {
  /** 每個探索回合感載消退 decay ＋ mod(意志)（CYBERSPACE 8.1 節「探索不算脫離戰鬥」） */
  decay: number
  /** 追蹤度的三個門檻（NETRUNNING 第 5 節；戰鬥那一份在 netcombat_rule，兩邊一樣） */
  t1: number
  t2: number
  t3: number
  /** 被定位之後倒數幾個探索回合（N15） */
  locate_rounds: number
  /** 追蹤度到 t1 之後閘門的 DC 加幾 */
  gate_t1_dc: number
  /** 贏了之後被釘住的隊友自動拆釘子多算幾個探索回合（N22） */
  unpinned_rounds: number
  /** 潛行繞過用的基本功（全隊各擲，取合計最高的那一項） */
  sneak_skills: string[]
  /** 遭遇的組合（位階；ENEMIES 第 13 節的點數：一般 4 點、層主 6 點、最後一場的首領戰 8 點）：plain 一般、guard 閘門前的層主、boss 最後一層的閘門守衛 */
  encounter: { plain: Rank[]; guard: Rank[]; boss: Rank[] }
  // ---- 第二張：節點 ----
  /** 下載與放東西沒寫 turns 時要做幾次「繼續」（8.1 節：2～4 個回合；放東西 2 個） */
  download_turns: number
  plant_turns: number
  /** 下載每回合追蹤度 +幾（放東西不加） */
  download_trace: number
  /** 管理行動（破解、接管、擦痕跡、對人快駭）每做一次追蹤度 +幾；檢定失敗再 +幾（CYBERSPACE 6.6 節、N23）；交涉與找人的檢定失敗也照失敗的數字 */
  admin_trace: number
  fail_trace: number
  /** 擦痕跡降多少 */
  wipe: number
  /** 巡邏：隊伍每過幾個探索回合走一個節點、路線幾個節點（最少、最多）、一隊的組合（位階；隨機挑一種）、追蹤度到 t1 時每層多幾隊 */
  patrol_every: number
  patrol_route: Range2
  patrol: Rank[][]
  patrol_t1: number
  /** 帶出去才算數：擲 d6，這個數字以下丟掉（1～3） */
  lose_max: number
  /** 戰鬥的等級倍率（BALANCE 2.1 節：×1、1.22、1.49、1.82、2.22）；陷阱的感載照它乘 */
  load_mult: number[]
  /** 主控屬於哪一路數（actor.ext.paths 的 path；階數就是管理行動的次數與檢定的加值） */
  master_path: string
  /** 各種檢定看哪幾項基本功（取加值最高的那一項） */
  talk_skills: string[]
  admin_skills: string[]
  hack_skills: string[]
}

export const DEFAULT_RULES: NetrunRules = {
  decay: 2, t1: 30, t2: 60, t3: 90, locate_rounds: 3, gate_t1_dc: 2, unpinned_rounds: 1, sneak_skills: ['stealth'],
  encounter: { plain: ['minion', 'minion', 'minion', 'minion'], guard: ['elite', 'elite', 'minion'], boss: ['boss', 'minion', 'minion', 'minion'] },
  download_turns: 3, plant_turns: 2, download_trace: 2, admin_trace: 1, fail_trace: 5, wipe: 5,
  patrol_every: 3, patrol_route: [3, 5], patrol: [['elite'], ['minion', 'minion']], patrol_t1: 1,
  lose_max: 3, load_mult: [1, 1.22, 1.49, 1.82, 2.22], master_path: 'netrunner', talk_skills: ['negotiate'], admin_skills: ['interface'], hack_skills: ['interface'],
}

// ---- 設定與狀態 ----

/** 連動給這一段的效果（M3-commission-net 算好給；dev/adr/0018 第九節）。 */
export interface Fx {
  half?: boolean
  minus?: number
  skip?: boolean
  trace_start?: number
  trace_half?: boolean
  lace_down?: boolean
  gate_open?: boolean
  near_core?: boolean
}

export type RunKind = typeof ACT_NET | typeof ACT_FACE

/** 目標的種類（CYBERSPACE 8.1 節「把固定目標放進生成的地圖」的表）。pass（通過這一層的閘門；委託的階段預設）與 clear（走完最後一層；自己去的那一趟預設）不放節點。 */
export const OBJECTIVE_KINDS = ['download', 'seize', 'find', 'defeat', 'plant', 'extract'] as const
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number]

/**
 * 這一趟的目標。除了 pass 與 clear，六種都在生成時放進一個節點，位置記在 at（圖的 id、標記的 id、格子）。
 * turns 是下載與放東西要做幾次「繼續」（沒寫照規則表）；progress 是做了幾次（離開那一格歸零）；foe 是打倒要指定的敵人（enemy 的 id）；
 * item 是帶出來要的東西（物品的 id；沒有這個物品就只記在 loot）；node 是接管對到現實的哪個控制節點；got 是帶出來已經拿到了；done 是完成了。
 */
export interface Goal {
  kind: string
  done?: boolean
  turns?: number
  progress?: number
  foe?: string
  item?: string
  node?: string
  got?: boolean
  layer?: string
  at?: { sheet: string; id: string; pos: [number, number] }
  [field: string]: unknown
}

/** 這一趟拿到的東西的一件（帶出去才算數：倒下與被定位時每一件擲一次 d6）。goal 是目標的那一件（帶出來：倒下一定丟）。 */
export interface LootEntry {
  kind: 'item' | 'cred' | 'cash'
  /** 物品的 id（kind 是 item 時） */
  id?: string
  qty: number
  name: string
  goal?: true
  /** 從哪個節點來（圖的 id／標記的 id） */
  from?: string
}

export interface NetRun {
  id: string
  kind: RunKind
  /** 當初是誰發起的（交回 activity.end 時原樣帶回去） */
  origin: Origin
  /** 區的 id（整筆區是別的功能自己帶來的時候是它自己給的 id） */
  region: string
  grade: number
  faction?: string
  /** 這一趟的地圖實例（追蹤度的鍵） */
  map: string
  /** 每一層的圖的 id，由淺到深 */
  layers: string[]
  /** 現在在第幾層（從 0 起算） */
  layer: number
  /** 探索回合數 */
  round: number
  goal: Goal
  /** 開始時的設定（整份留著：區是整筆給的、fx、where、stealth 之後都要讀） */
  setup: Record<string, unknown>
  /** 這一趟拿到的東西（檔案庫與目標；帶出去才算數） */
  loot: LootEntry[]
  /** 追蹤度最高到過多少 */
  peak: number
  /** 被定位之後還剩幾個探索回合；沒有被定位是沒有這個欄位 */
  located?: number
  /** 已經發過 enter_floor 觸發點的圖（自己的那一趟進每一層的第一步發一次） */
  entered: string[]
  /** setup.stealth 的第一次自動成功用掉了 */
  stealth_used?: boolean
  /** 戰鬥裡全員拔線：這一趟要結束了（戰鬥的結算套用之後由 report.after 接著收尾）。retreat 是委託副本（N13）、left 是自己去的那一趟 */
  over?: 'retreat' | 'left'
}

export interface FoeNode {
  foes: UnitRef[]
  faction?: string
  /** 守著這一層的閘門的那一場 */
  gate?: true
  /** 處理過了（打贏、繞過） */
  done?: true
}

/** 看不到的陷阱（N8；生成器放的 hidden）：found 是察覺了（那一格改成看得到的 net_alarm 或 net_loop）、checked 是察覺的檢定擲過了、used 是踩過了（失效）。 */
export interface TrapState {
  kind: 'net_alarm' | 'net_loop'
  at: [number, number]
  found?: true
  checked?: true
  used?: true
}

/** 一隊巡邏（會動的遭遇；CYBERSPACE 8.1 節）：route 是節點圖上的節點 id（來回走）、at 是現在在哪個節點、step 是走了幾步（路線的位置由它導出）。calm 是剛擦身而過、離開之前不再擲。 */
export interface Patrol {
  id: string
  sheet: string
  route: string[]
  foes: UnitRef[]
  faction?: string
  at: string
  step: number
  calm?: true
  /** 打贏了、沒有了（留著紀錄，編號不重複） */
  gone?: true
}

/** 控制節點：node 是對到現實的哪個控制節點（副本的 cn_ 開頭），taken 是接管了。 */
export interface ControlState {
  node?: string
  name?: string
  taken?: true
}

/** 地圖實例的 ext.net（這個功能寫）。圖、藏起來的東西與遭遇各自照圖（sheet）的 id 分開：一份實例有好幾層。 */
export interface NetExt {
  region: string
  grade: number
  faction?: string
  /** 這張地圖的 DC（照等級；N10） */
  dc: number
  graph: Record<string, GenResult['graph']>
  hidden: Record<string, GenResult['hidden']>
  safe_path: Record<string, Array<[number, number]>>
  /** 每一個遭遇節點放誰：圖的 id → 標記 id → 那一場 */
  foes: Record<string, Record<string, FoeNode>>
  /** 休息過的圖 */
  rested: string[]
  t30?: true
  t60?: true
  /** 看不到的陷阱：圖的 id → 每一個 */
  traps: Record<string, TrapState[]>
  /** 巡邏（每一隊記自己在哪一層） */
  patrols: Patrol[]
  /** 控制節點：圖的 id → 標記 id */
  controls: Record<string, Record<string, ControlState>>
  /** 拿到的憑證（交涉或快駭人拿到的；過閘門用掉一張） */
  keys: string[]
  /** 擦痕跡做了幾次：圖的 id → 次數（每一層最多主控的階數次） */
  wiped: Record<string, number>
  /** 處理過的檔案庫與人：圖的 id → 標記 id */
  used: Record<string, string[]>
  /** 閘門已經開了的圖（破解、憑證、後門鑰匙；守著它的遭遇還在） */
  opened: string[]
}

// ---- 讀寫 ----

/** 現在進行中的一趟（沒有是 null）。 */
export function readRun(state: GameState): NetRun | null {
  const v = state.ext[EXT]
  return isRecord(v) && typeof v.id === 'string' && typeof v.map === 'string' ? (v as unknown as NetRun) : null
}

/** 把這一趟整份換掉（null 是清掉）。 */
export const runChange = (run: NetRun | null): Change => ({ op: 'ext', key: EXT, value: run ? clone(run) : null })

/** 地圖實例的 ext.net（不是這個功能開的地圖是 null）。 */
export function netExt(state: GameState, map: string): NetExt | null {
  const v = state.maps.instances[map]?.ext?.net
  if (!isRecord(v) || !isRecord(v.graph) || !isRecord(v.foes)) return null
  // 第二張才有的欄位：舊的存檔沒有就補空的（拷貝，不動存檔裡的）
  return { traps: {}, patrols: [], controls: {}, keys: [], wiped: {}, used: {}, opened: [], ...v } as unknown as NetExt
}

/** 換掉實例的 ext.net（其餘的鍵不動）。 */
export function netExtChange(state: GameState, map: string, net: NetExt): Change {
  return { op: 'map.ext', map, value: { ...clone(state.maps.instances[map]?.ext ?? {}), net: clone(net) } }
}

/** 一張圖上這一格是不是節點（節點圖上的格子：有標記的、入口、沒標記的路口與死路、藏起來的東西佔的）。 */
export function nodeAt(net: NetExt, sheet: string, p: GridPoint | [number, number]): GenResult['graph']['nodes'][number] | undefined {
  const [x, y] = Array.isArray(p) ? p : [p.x, p.y]
  return net.graph[sheet]?.nodes.find((n) => n.at[0] === x && n.at[1] === y)
}

// ---- 小工具 ----

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isRange = (v: unknown, lo: number, hi: number): v is Range2 => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] >= lo && v[1] >= v[0] && v[1] <= hi

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }
/** 等級（1～5）：寫數字或羅馬數字都收；壞掉的是 undefined。 */
export function gradeOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5) return v
  if (typeof v === 'string' && Object.hasOwn(ROMAN, v)) return ROMAN[v]
  return undefined
}

/** 位階降一級（蕾絲降一級：首領變精英、精英變雜兵）。 */
export const rankDown = (r: Rank): Rank => (r === 'boss' ? 'elite' : 'minion')

/** 套上連動之後的遭遇：先少一半（進位留下），再少幾個；有遭遇的至少留一個（和現實面同一個算法）；蕾絲降一級。 */
export function encounterAfter(ranks: readonly Rank[], fx: Pick<Fx, 'half' | 'minus' | 'lace_down'>): Rank[] {
  if (ranks.length === 0) return []
  let n = ranks.length
  if (fx.half) n = Math.ceil(n / 2)
  n = Math.max(1, n - Math.max(0, Math.floor(fx.minus ?? 0)))
  const out = ranks.slice(0, n)
  return fx.lace_down ? out.map(rankDown) : out
}

// ---- 規則表的檢查 ----

const COVER_NAMES = ['dense', 'medium', 'sparse', 'one_sided']

function countsProblems(v: unknown, at: string): string[] {
  if (!isRecord(v)) return [`${at} 要是一個物件（${COUNT_KEYS.join('、')} 各是 [最少, 最多]）`]
  const p: string[] = []
  for (const key of Object.keys(v)) if (!(COUNT_KEYS as readonly string[]).includes(key)) p.push(`${at}.${key} 不是這一層會放的東西（${COUNT_KEYS.join('、')}）`)
  for (const key of COUNT_KEYS) if (v[key] !== undefined && !isRange(v[key], 0, 20)) p.push(`${at}.${key} 要是 [最少, 最多]，0～20 的整數`)
  return p
}

/** 一筆區的格式檢查（內容種類 net_region）。 */
export function regionProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.map_kind)) p.push('map_kind 要是地圖的種類（subnet、maze、wreck、deep）')
  if (!(Array.isArray(e.size) && e.size.length === 2 && e.size.every((n) => isInt(n) && n >= 5 && n <= 41))) p.push('size 要是 [寬, 高]，各 5～41 的整數')
  if (!isRange(e.carve, 1, 500)) p.push('carve 要是 [最少, 最多]，1～500 的整數')
  if (e.sight !== undefined && !(isInt(e.sight) && e.sight >= 1 && e.sight <= 9)) p.push('sight 要是 1～9 的整數')
  for (const f of ['oneway', 'fragile'] as const) if (e[f] !== undefined && !(typeof e[f] === 'number' && e[f] >= 0 && e[f] <= 1)) p.push(`${f} 要是 0～1 的數字`)
  if (e.loops !== undefined && !(isInt(e.loops) && e.loops >= 0 && e.loops <= 6)) p.push('loops 要是 0～6 的整數')
  if (e.pressure !== 'trace' && e.pressure !== 'none') p.push("pressure 只能是 'trace' 或 'none'")
  if (e.safe !== undefined && typeof e.safe !== 'boolean') p.push('safe 要是布林值')
  if (e.cover !== undefined) {
    const c = e.cover
    const okName = typeof c === 'string' && COVER_NAMES.includes(c)
    const okRows = isRecord(c) && ['ally', 'foe'].every((s) => Array.isArray(c[s]) && (c[s] as unknown[]).length === 4 && (c[s] as unknown[]).every((n) => isInt(n) && n >= 0 && n <= 2))
    if (!okName && !okRows) p.push(`cover 要是 ${COVER_NAMES.join('、')} 之一，或 { ally, foe } 各四格（0～2）`)
  }
  if (!(Array.isArray(e.dc) && e.dc.length === 5 && e.dc.every((n) => isInt(n) && n >= 0 && n <= 60))) p.push('dc 要是五個整數（I～V 級各一）')
  p.push(...countsProblems(e.layer, 'layer'))
  if (e.commission !== undefined) p.push(...countsProblems(e.commission, 'commission'))
  if (e.archive_table !== undefined) {
    if (!Array.isArray(e.archive_table)) p.push('archive_table 要是一串列：{ weight, name, give }')
    else {
      e.archive_table.forEach((row, i) => {
        const at = `archive_table[${i}]`
        if (!isRecord(row)) p.push(`${at} 要是 { weight, name, give }`)
        else {
          if (!(typeof row.weight === 'number' && Number.isFinite(row.weight) && row.weight > 0)) p.push(`${at}.weight 要是大於 0 的數字`)
          if (!isText(row.name)) p.push(`${at}.name 要有名字`)
          if (!(Array.isArray(row.give) && row.give.every(isRecord))) p.push(`${at}.give 要是一串效果（每一筆是一個物件）`)
        }
      })
    }
  }
  if (e.trap !== undefined) {
    const t = e.trap
    if (!isRecord(t)) p.push('trap 要是 { alarm, loop_load }')
    else {
      for (const key of Object.keys(t)) if (key !== 'alarm' && key !== 'loop_load') p.push(`trap.${key} 不認得（alarm、loop_load）`)
      for (const key of ['alarm', 'loop_load'] as const) if (t[key] !== undefined && !(isInt(t[key]) && t[key] >= 0 && t[key] <= 100)) p.push(`trap.${key} 要是 0～100 的整數`)
    }
  }
  return p
}

type NumericRule = 'decay' | 't1' | 't2' | 't3' | 'locate_rounds' | 'gate_t1_dc' | 'unpinned_rounds' | 'download_turns' | 'plant_turns' | 'download_trace' | 'admin_trace' | 'fail_trace' | 'wipe'
  | 'patrol_every' | 'patrol_t1' | 'lose_max'
export const NUMERIC_RULES: Array<[NumericRule, number, number]> = [
  ['decay', 0, 20], ['t1', 1, 100], ['t2', 1, 100], ['t3', 1, 100], ['locate_rounds', 1, 20], ['gate_t1_dc', 0, 10], ['unpinned_rounds', 0, 5],
  ['download_turns', 1, 10], ['plant_turns', 1, 10], ['download_trace', 0, 20], ['admin_trace', 0, 20], ['fail_trace', 0, 30], ['wipe', 0, 30],
  ['patrol_every', 1, 20], ['patrol_t1', 0, 3], ['lose_max', 0, 6],
]
export const TEXT_LIST_RULES = ['sneak_skills', 'talk_skills', 'admin_skills', 'hack_skills'] as const

/** 探索的數字的格式檢查（內容種類 netrun_rule）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of NUMERIC_RULES) if (e[key] !== undefined && !(isInt(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  for (const key of TEXT_LIST_RULES) if (e[key] !== undefined && !(Array.isArray(e[key]) && (e[key] as unknown[]).length > 0 && (e[key] as unknown[]).every(isText))) p.push(`${key} 要是至少一個基本功 id 的陣列`)
  if (e.patrol_route !== undefined && !isRange(e.patrol_route, 2, 8)) p.push('patrol_route 要是 [最少, 最多]，2～8 個節點')
  if (e.patrol !== undefined && !(Array.isArray(e.patrol) && e.patrol.length > 0 && e.patrol.every((g) => Array.isArray(g) && g.length >= 1 && g.length <= 4 && g.every((r) => (RANKS as readonly unknown[]).includes(r))))) p.push(`patrol 要是一串巡邏的組合（每一組是 1～4 個位階：${RANKS.join('、')}）`)
  if (e.load_mult !== undefined && !(Array.isArray(e.load_mult) && e.load_mult.length === 5 && e.load_mult.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20))) p.push('load_mult 要是五個數字（I～V 級各一）')
  if (e.master_path !== undefined && !isText(e.master_path)) p.push('master_path 要是路數的 id')
  if (e.encounter !== undefined) {
    const en = e.encounter
    if (!isRecord(en)) p.push('encounter 要是 { plain?, guard?, boss? }')
    else {
      for (const key of Object.keys(en)) if (!['plain', 'guard', 'boss'].includes(key)) p.push(`encounter.${key} 不認得（plain、guard、boss）`)
      for (const key of ['plain', 'guard', 'boss']) {
        const v = en[key]
        if (v !== undefined && !(Array.isArray(v) && v.length <= 8 && v.every((r) => (RANKS as readonly unknown[]).includes(r)))) p.push(`encounter.${key} 要是位階（${RANKS.join('、')}）的陣列，最多八個`)
      }
    }
  }
  return p
}

/** 結束時問 netrun.close 的處理函式回傳的東西。 */
export interface CloseReturn {
  changes?: Change[]
  lines?: string[]
}

export type CloseOutcome = 'done' | 'left' | 'retreat' | 'located' | 'defeat'

declare module '../../core' {
  interface HookMap {
    /**
     * 網內的一趟過了一個探索回合（站上一個節點、下載、休息……）：之後的區（迷宮館的計時、沉船帶的訊號）回答，回傳要加的變更。
     * state 是這一段路開始之前的狀態（一段路好幾格時每一格各問一次，讀到的 run.round 是這一段路開始時的）。
     */
    'netrun.round': [{ state: GameState; run: NetRun }, Change[] | void]
    /**
     * 這一趟結束了：outcome 是怎麼結束的（done、left、retreat、located；戰敗被接受是 defeat）。回答的人回傳要加的變更與給玩家看的句子
     * （迷宮館結算評價、押金）。run 是結束之前的那一趟，唯讀。lost 是這一趟倒下或被定位時丟掉的東西（帶出去才算數；沒有丟東西的時候沒有這個欄位）。
     */
    'netrun.close': [{ state: GameState; run: NetRun; outcome: CloseOutcome; lost?: LootEntry[] }, CloseReturn | void]
  }
}

export type { ActivityEndMerged }
