// L6 功能 netrun 的資料：活動的名字、狀態的形狀、區的規則表（net_region）與探索的數字（netrun_rule）。
// 規格：CYBERSPACE 8.1 節（生成的規則、密度表、節點）、8.3 節（一般子網）；NETRUNNING 第 5 節（追蹤度）；dev/adr/0018 第六、七節與 N2、N5、N26。
//
// 一趟網內的行程（活動 face.net 與 netrun 共用同一份狀態 state.ext.netrun）：
//   - 整趟是一份地圖實例（trace 量表的鍵就是它），每一層是實例裡的一張圖（sheet）；往下一層是把人放到下一張圖的入口，追蹤度不歸零。
//   - 生成器吐出的節點圖、藏起來的東西、保證的路存在實例的 ext.net（不在版面裡），每一個遭遇節點放誰也在那裡。
// 這個功能不 import 別的功能：敵人只經由單位來源 enemy_pick、副本的事只從 setup 與 origin 來、甲板只問衍生數值 deck_grade。

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
}

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
}

export const DEFAULT_RULES: NetrunRules = {
  decay: 2, t1: 30, t2: 60, t3: 90, locate_rounds: 3, gate_t1_dc: 2, unpinned_rounds: 1, sneak_skills: ['stealth'],
  encounter: { plain: ['minion', 'minion', 'minion', 'minion'], guard: ['elite', 'elite', 'minion'], boss: ['boss', 'minion', 'minion', 'minion'] },
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

/** 這一趟的目標。這一張只做 pass（通過這一層的閘門；委託的階段預設）與 clear（走完最後一層；自己去的那一趟預設）；別的種類只收下。 */
export interface Goal {
  kind: string
  done?: boolean
  [field: string]: unknown
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
  /** 這一趟拿到的東西（下一張 M3-netrun-nodes 寫） */
  loot: unknown[]
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
  return isRecord(v) && isRecord(v.graph) && isRecord(v.foes) ? (v as unknown as NetExt) : null
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
  return p
}

const NUMERIC_RULES: Array<[keyof Omit<NetrunRules, 'sneak_skills' | 'encounter'>, number, number]> = [
  ['decay', 0, 20], ['t1', 1, 100], ['t2', 1, 100], ['t3', 1, 100], ['locate_rounds', 1, 20], ['gate_t1_dc', 0, 10], ['unpinned_rounds', 0, 5],
]

/** 探索的數字的格式檢查（內容種類 netrun_rule）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of NUMERIC_RULES) if (e[key] !== undefined && !(isInt(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  if (e.sneak_skills !== undefined && !(Array.isArray(e.sneak_skills) && e.sneak_skills.length > 0 && e.sneak_skills.every(isText))) p.push('sneak_skills 要是至少一個基本功 id 的陣列')
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
     * （迷宮館結算評價、押金）。run 是結束之前的那一趟，唯讀。
     */
    'netrun.close': [{ state: GameState; run: NetRun; outcome: CloseOutcome }, CloseReturn | void]
  }
}

export type { ActivityEndMerged }
