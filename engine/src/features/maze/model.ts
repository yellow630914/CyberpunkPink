// L6 功能 maze 的資料：規則表（maze_rule）、寶箱與獎品表（maze_table）、這一區的預設規則、狀態 state.ext.maze 的形狀與讀寫。
// 規格：CYBERSPACE 3.3 節、8.1 節（密度表迷宮館那一列、壓力條）、8.2 節（報名、三層、機關、時間與評價、寶箱、獎品、籌碼）；ENEMIES 第 9 節最後一列；DATA 第 10 節（maze 那一列）；
// dev/adr/0018 第六節與第十三節的掛點表；dev/work/M3-maze.md。
//
// 迷宮館是「一趟網內的行程」的第二個使用者：它只靠 features/netrun 的活動 netrun（launch，setup.region 整筆放這一區的規則）、掛點 netrun.round 與 netrun.close、
// 地圖實例的 ext.net（只讀格式）與 k.grid 的註冊接上去，不 import netrun。
//
// 狀態：state.ext.maze（只有這個功能寫）：{ id, bracket, grade, deposit, rented, origin, over? }。
//   累積的東西（每一層的探索與戰鬥回合、倒下的人次、籌碼）不放在這裡，放在核心的計數器 counters（鍵 maze:<id>:r<層>、maze:<id>:down、maze:<id>:chip）：
//   掛點 netrun.round 一段路好幾格時每一格各呼叫一次、讀到的狀態都是這一段路開始之前的，用「讀出來再寫回」的做法會漏算；計數器是加法，不會。結算之後歸零。

import type { ActorId, Change, ContentEntry, GameState, Kernel, Origin } from '../../core'
import { clone, isRecord } from '../../core'

export const OWNER = 'maze'
/** state.ext 的鍵：這一趟迷宮館（沒有在進行是沒有這個鍵）。 */
export const EXT = 'maze'
export const RULE_KIND = 'maze_rule'
export const TABLE_KIND = 'maze_table'
/** 一趟網內的行程的活動名字（features/netrun 的）：只用名字，不 import。 */
export const ACT_NETRUN = 'netrun'
/** 這一區的 id（也是 net_region 的一筆、地圖實例 ext.net.region 的值）。 */
export const REGION_ID = 'maze'
/** 開那一趟時 origin.by 寫這個，掛點收到的 run.origin.by 用它認得「這是迷宮館開的」。 */
export const ORIGIN_BY = 'maze'

export type Range2 = [number, number]
export type Rank = 'minion' | 'elite' | 'boss'
const RANKS: readonly Rank[] = ['minion', 'elite', 'boss']

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRange = (v: unknown, lo: number, hi: number): v is Range2 => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] >= lo && v[1] >= v[0] && v[1] <= hi

// ---- 規則表 maze_rule（id: default） ----

/** 一個組別的一個等級（無差別組有 III 與 IV 兩種）。 */
export interface BracketGrade {
  grade: number
  /** 押金（現金） */
  deposit: number
  /** 破關獎金（現金；乘評價的倍率） */
  prize: number
}

export interface BracketDef {
  name: string
  grades: BracketGrade[]
  /** 能不能用自己的構裝；false 是只能用 kit 裡的比賽版 */
  own: boolean
  /** 自己的構裝最高幾級（own 為 true 時） */
  max_grade: number
  /** 館方發的比賽甲板（deck 的 id；有寫就是一律租這一副） */
  deck?: string
  /** 比賽版構裝的 id：任何組別都能用 */
  kit: string[]
  /** 守閘門的那一場的組合（位階）。沒寫是用 netrun 的預設（最後一層是首領戰）；新手組與公開組由中頭目當館主，所以預設寫精英 */
  guard?: Rank[]
}

/** 評價的一列：照順序第一列符合的就是；ratio 是回合數對標準的比例上限、downs 是倒下的人數上限，沒寫是不限。 */
export interface RatingRow {
  rating: string
  ratio?: number
  downs?: number
  mult: number
}

/** 解機關的三個辦法（介面、街頭直覺或體格）：檢定用的屬性與基本功。 */
export interface SolveOption {
  id: string
  name: string
  attr: string
  skill?: string
}

export interface MazeRules {
  brackets: Record<string, BracketDef>
  /** 每一層的名字與標準回合數（前庭 12、迴廊 15、館主廳 10） */
  layers: Array<{ name: string; standard: number }>
  rating: RatingRow[]
  /** 機關解失敗時，解的人感載加多少（I 級的數字，照 load_mult 乘） */
  puzzle_load: number
  load_mult: number[]
  /** 寶箱是寶箱怪的機率 */
  mimic: number
  /** 一枚比賽籌碼換多少現金 */
  chip: number
  /** 層與層之間的休息：感載減多少 */
  rest_load: number
  /** 一隊最多幾個人 */
  max_party: number
  /** 遊戲敵人的勢力（enemy_pick 用） */
  faction: string
  solve: SolveOption[]
  /** 寶箱怪與警報節點叫出來的敵人（位階） */
  mimic_foes: Rank[]
  chest_table?: string
  prize_table?: string
  /** 打輸時走的戰敗事件（內容的 defeat_event 的 id；沒寫照勢力的預設） */
  defeat_event?: string
  /** 蓋掉這一區的規則（net_region 的欄位，只收有寫的） */
  region?: Record<string, unknown>
}

export const DEFAULT_RULES: MazeRules = {
  brackets: {
    rookie: { name: '新手組', grades: [{ grade: 1, deposit: 50, prize: 300 }], own: false, max_grade: 1, kit: [], guard: ['elite', 'elite', 'minion'] },
    open: { name: '公開組', grades: [{ grade: 2, deposit: 150, prize: 900 }], own: true, max_grade: 2, kit: [], guard: ['elite', 'elite', 'minion'] },
    unlimited: { name: '無差別組', grades: [{ grade: 3, deposit: 500, prize: 3000 }, { grade: 4, deposit: 1600, prize: 9800 }], own: true, max_grade: 5, kit: [] },
  },
  layers: [{ name: '前庭', standard: 12 }, { name: '迴廊', standard: 15 }, { name: '館主廳', standard: 10 }],
  rating: [
    { rating: 'S', ratio: 1, downs: 0, mult: 1.5 },
    { rating: 'A', ratio: 1.25, downs: 1, mult: 1.2 },
    { rating: 'B', ratio: 1.6, downs: 2, mult: 1 },
    { rating: 'C', mult: 0.7 },
  ],
  puzzle_load: 8,
  load_mult: [1, 1.22, 1.49, 1.82, 2.22],
  mimic: 0.1,
  chip: 10,
  rest_load: 10,
  max_party: 4,
  faction: 'maze',
  solve: [
    { id: 'interface', name: '介面', attr: 'intellect', skill: 'interface' },
    { id: 'street', name: '街頭直覺', attr: 'intellect', skill: 'streetwise' },
    { id: 'body', name: '體格', attr: 'body' },
  ],
  mimic_foes: ['minion', 'minion'],
}

/** 這一區的規則（net_region 的一筆；開那一趟時整筆放在 setup.region）：CYBERSPACE 8.1 節密度表迷宮館那一列、8.2 節。 */
export const DEFAULT_REGION: Record<string, unknown> = {
  id: REGION_ID, name: '迷宮館', map_kind: 'maze', size: [9, 7], carve: [18, 24], sight: 2, pressure: 'none', safe: true, cover: 'medium', dc: [10, 13, 16, 19, 22],
  // 每層 2 場遭遇（守閘門的那一場是層主；第三層守閘門的是館主）、機關 1、寶箱 1～2、陷阱 0～1；休息點在層與層之間（這個功能自己做），沒有巡邏
  layer: { foe: [2, 2], patrol: [0, 0], archive: [1, 2], trap: [0, 1], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] },
  puzzle: [1, 1],
  // 警報節點在館裡不加追蹤度（這一區沒有追蹤度），改叫出兩個小兵（這個功能的 grid.onEnter）
  trap: { alarm: 0, loop_load: 8 },
  // 寶箱（檔案庫 a）與機關（m）由這個功能處理
  handled: ['a', 'm'],
}

export const BRACKET_ORDER = ['rookie', 'open', 'unlimited']

// ---- 格式檢查 ----

/** 一個組別的格式檢查：內建有的組別（新手、公開、無差別）可以只寫要改的欄位；新的組別要有 name 與 grades。 */
function bracketProblems(id: string, b: unknown): string[] {
  const at = `brackets.${id}`
  if (!isRecord(b)) return [`${at} 要是 { name, grades, own, max_grade, deck?, kit?, guard? }`]
  const p: string[] = []
  const known = Object.hasOwn(DEFAULT_RULES.brackets, id)
  if (b.name !== undefined || !known) if (!isText(b.name)) p.push(`${at}.name 要有名字`)
  if (b.grades !== undefined || !known) if (!(Array.isArray(b.grades) && b.grades.length >= 1 && b.grades.length <= 5 && b.grades.every((g) => isRecord(g) && isInt(g.grade) && g.grade >= 1 && g.grade <= 5 && isInt(g.deposit) && g.deposit >= 0 && isInt(g.prize) && g.prize >= 0))) p.push(`${at}.grades 要是一到五筆 { grade（1～5）, deposit, prize }（0 以上的整數）`)
  if (b.own !== undefined && typeof b.own !== 'boolean') p.push(`${at}.own 要是布林值`)
  if (b.max_grade !== undefined && !(isInt(b.max_grade) && b.max_grade >= 0 && b.max_grade <= 5)) p.push(`${at}.max_grade 要是 0～5 的整數`)
  if (b.deck !== undefined && !isText(b.deck)) p.push(`${at}.deck 要是甲板的 id`)
  if (b.kit !== undefined && !(Array.isArray(b.kit) && b.kit.every(isText))) p.push(`${at}.kit 要是構裝 id 的陣列`)
  if (b.guard !== undefined && !(Array.isArray(b.guard) && b.guard.length >= 1 && b.guard.length <= 8 && b.guard.every((r) => (RANKS as readonly unknown[]).includes(r)))) p.push(`${at}.guard 要是位階（${RANKS.join('、')}）的陣列`)
  return p
}

/** 一筆規則表的格式檢查（內容種類 maze_rule）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.brackets !== undefined) {
    if (!isRecord(e.brackets) || !Object.keys(e.brackets).length) p.push('brackets 要是 { 組別的 id: 一個組別 }')
    else for (const [id, b] of Object.entries(e.brackets)) p.push(...bracketProblems(id, b))
  }
  if (e.layers !== undefined && !(Array.isArray(e.layers) && e.layers.length >= 1 && e.layers.length <= 8 && e.layers.every((l) => isRecord(l) && isText(l.name) && isInt(l.standard) && l.standard >= 1 && l.standard <= 200))) p.push('layers 要是一到八層 { name, standard（1～200 的整數）}')
  if (e.rating !== undefined) {
    const r = e.rating
    if (!(Array.isArray(r) && r.length >= 1 && r.every((x) => isRecord(x) && isText(x.rating) && isNum(x.mult) && x.mult >= 0 && x.mult <= 20 && (x.ratio === undefined || (isNum(x.ratio) && x.ratio > 0)) && (x.downs === undefined || (isInt(x.downs) && x.downs >= 0))))) p.push('rating 要是一串 { rating, ratio?, downs?, mult }（照順序，第一列符合的就是；最後一列不寫門檻當作墊底）')
    else if ((r[r.length - 1] as RatingRow).ratio !== undefined || (r[r.length - 1] as RatingRow).downs !== undefined) p.push('rating 的最後一列不能寫 ratio 或 downs（它是墊底的，什麼都接）')
  }
  for (const [key, lo, hi] of [['puzzle_load', 0, 100], ['rest_load', 0, 100], ['chip', 0, 10000]] as const) if (e[key] !== undefined && !(isInt(e[key]) && (e[key] as number) >= lo && (e[key] as number) <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  if (e.max_party !== undefined && !(isInt(e.max_party) && e.max_party >= 1 && e.max_party <= 8)) p.push('max_party 要是 1～8 的整數')
  if (e.mimic !== undefined && !(isNum(e.mimic) && e.mimic >= 0 && e.mimic <= 1)) p.push('mimic 要是 0～1 的數字')
  if (e.load_mult !== undefined && !(Array.isArray(e.load_mult) && e.load_mult.length === 5 && e.load_mult.every((n) => isNum(n) && n >= 0 && n <= 20))) p.push('load_mult 要是五個數字（I～V 級各一）')
  if (e.faction !== undefined && !isText(e.faction)) p.push('faction 要是勢力的 id')
  if (e.solve !== undefined && !(Array.isArray(e.solve) && e.solve.length >= 1 && e.solve.every((s) => isRecord(s) && isText(s.id) && isText(s.name) && isText(s.attr) && (s.skill === undefined || isText(s.skill))))) p.push('solve 要是一串 { id, name, attr, skill? }（解機關的辦法）')
  if (e.mimic_foes !== undefined && !(Array.isArray(e.mimic_foes) && e.mimic_foes.length >= 1 && e.mimic_foes.length <= 8 && e.mimic_foes.every((r) => (RANKS as readonly unknown[]).includes(r)))) p.push(`mimic_foes 要是位階（${RANKS.join('、')}）的陣列`)
  for (const key of ['chest_table', 'prize_table', 'defeat_event'] as const) if (e[key] !== undefined && !isText(e[key])) p.push(`${key} 要是 id（字串）`)
  if (e.region !== undefined && !isRecord(e.region)) p.push('region 要是 net_region 的欄位（只寫要蓋掉的）')
  return p
}

/** 寶箱表與獎品表的一列：weight 權重；give 是一串效果（內建的來源，數字可以寫照等級的五個值）；chips 是比賽籌碼的數量（一個數字或 [最少, 最多]）；prize 為 true 是再擲一次獎品表。 */
export interface TableRow {
  weight: number
  name?: string
  give?: Array<Record<string, unknown>>
  chips?: number | Range2
  prize?: boolean
}

export interface MazeTable extends ContentEntry {
  kind: 'chest' | 'prize'
  rows: TableRow[]
}

/** 一筆表的格式檢查（內容種類 maze_table）。 */
export function tableProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.kind !== 'chest' && e.kind !== 'prize') p.push("kind 只能是 'chest'（寶箱）或 'prize'（獎品）")
  if (!(Array.isArray(e.rows) && e.rows.length >= 1)) return [...p, 'rows 要是至少一列 { weight, give?, chips?, prize? }']
  e.rows.forEach((row, i) => {
    const at = `rows[${i}]`
    if (!isRecord(row)) { p.push(`${at} 要是 { weight, give?, chips?, prize? }`); return }
    if (!(isNum(row.weight) && row.weight > 0)) p.push(`${at}.weight 要是大於 0 的數字`)
    if (row.name !== undefined && !isText(row.name)) p.push(`${at}.name 要有名字`)
    if (row.give !== undefined && !(Array.isArray(row.give) && row.give.every(isRecord))) p.push(`${at}.give 要是一串效果（每一筆是一個物件）`)
    if (row.chips !== undefined && !((isInt(row.chips) && row.chips >= 0) || isRange(row.chips, 0, 100000))) p.push(`${at}.chips 要是 0 以上的整數，或 [最少, 最多]`)
    if (row.prize !== undefined && typeof row.prize !== 'boolean') p.push(`${at}.prize 要是布林值`)
    if (row.give === undefined && row.chips === undefined && row.prize !== true) p.push(`${at} 什麼都沒給（要有 give、chips 或 prize）`)
  })
  return p
}

// ---- 讀規則 ----

type Cx = Pick<Kernel, 'content'>

/** 現在生效的規則：maze_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。組別照 id 併（資料寫的蓋掉內建的同 id，沒寫的組別留著）。 */
export function mazeRules(k: Cx): MazeRules {
  const out: MazeRules = clone(DEFAULT_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get(RULE_KIND, 'default') as Record<string, unknown> | undefined
  if (!e) return out
  const bad = new Set<string>(ruleProblems(e).map((m) => m.split(/[ .[]/)[0]!))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('brackets')) for (const [id, b] of Object.entries(e.brackets as Record<string, Record<string, unknown>>)) {
    const base = out.brackets[id] ?? { name: id, grades: [], own: true, max_grade: 5, kit: [] }
    out.brackets[id] = { ...base, ...clone(b), kit: Array.isArray(b.kit) ? [...(b.kit as string[])] : base.kit } as BracketDef
  }
  if (ok('layers')) out.layers = (e.layers as MazeRules['layers']).map((l) => ({ name: l.name, standard: l.standard }))
  if (ok('rating')) out.rating = clone(e.rating as RatingRow[])
  for (const key of ['puzzle_load', 'rest_load', 'chip', 'max_party', 'mimic'] as const) if (ok(key)) out[key] = e[key] as number
  if (ok('load_mult')) out.load_mult = [...(e.load_mult as number[])]
  if (ok('faction')) out.faction = e.faction as string
  if (ok('solve')) out.solve = clone(e.solve as SolveOption[])
  if (ok('mimic_foes')) out.mimic_foes = [...(e.mimic_foes as Rank[])]
  for (const key of ['chest_table', 'prize_table', 'defeat_event'] as const) if (ok(key)) out[key] = e[key] as string
  if (ok('region')) out.region = clone(e.region as Record<string, unknown>)
  return out
}

/** 這一區的規則（整筆；開那一趟時放在 setup.region）：預設的，被 maze_rule 的 region 蓋掉有寫的欄位；layer 的各項個別蓋；handled 一定含 a 與 m。 */
export function mazeRegion(rules: MazeRules): Record<string, unknown> {
  const base = clone(DEFAULT_REGION)
  const over = rules.region ?? {}
  const out: Record<string, unknown> = { ...base, ...clone(over), id: REGION_ID }
  out.layer = { ...(base.layer as Record<string, unknown>), ...(isRecord(over.layer) ? clone(over.layer) : {}) }
  out.handled = [...new Set<string>([...(base.handled as string[]), ...(Array.isArray(over.handled) ? (over.handled as string[]) : [])])]
  return out
}

/** 兩張表：規則裡指定的 id，沒指定就是這一種裡 id 排最前面的那一張；沒有是 null。 */
export function tableOf(k: Cx, kind: 'chest' | 'prize', rules: MazeRules): MazeTable | null {
  if (!k.content.hasKind(TABLE_KIND)) return null
  const want = kind === 'chest' ? rules.chest_table : rules.prize_table
  if (want) return (k.content.get(TABLE_KIND, want) as MazeTable | undefined) ?? null
  return k.content.list<MazeTable>(TABLE_KIND).filter((t) => t.kind === kind).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null
}

// ---- 狀態 ----

export interface MazeResult {
  /** 怎麼結束的（netrun.close 的 outcome） */
  outcome: string
  /** 評價（破關才有） */
  rating?: string
  mult?: number
  rounds: number
  standard: number
  downs: number
  chips: number
  /** 破關獎金（已乘評價） */
  prize: number
  /** 退回來的押金 */
  refund: number
  /** 沒收的押金 */
  forfeited: number
  /** 籌碼換成的現金 */
  chipCash: number
  /** 獎品室給的東西（句子） */
  lines: string[]
}

export interface MazeState {
  /** 這一趟的編號（計數器的鍵用） */
  id: string
  bracket: string
  grade: number
  deposit: number
  /** 租了館方甲板的人（結算時收回） */
  rented: ActorId[]
  /** 從誰那裡報的名（原樣記著，交回時用） */
  origin: Origin
  /** 結算完了、等著發 maze.result 的那一份報告收尾（結果在這裡） */
  over?: MazeResult
}

/** 讀 state.ext.maze：沒有、或形狀不對當成沒有。回傳的是複製品。 */
export function readMaze(state: Pick<GameState, 'ext'>): MazeState | null {
  const raw = state.ext[EXT]
  if (!isRecord(raw) || !isText(raw.id) || !isText(raw.bracket) || !isInt(raw.grade) || !isInt(raw.deposit)) return null
  return {
    id: raw.id, bracket: raw.bracket, grade: raw.grade, deposit: raw.deposit,
    rented: Array.isArray(raw.rented) ? raw.rented.filter(isText) : [],
    origin: isRecord(raw.origin) && isText(raw.origin.by) ? (clone(raw.origin) as unknown as Origin) : { by: ORIGIN_BY },
    ...(isRecord(raw.over) ? { over: clone(raw.over) as unknown as MazeResult } : {}),
  }
}

/** 寫狀態的變更（null 是清掉）。 */
export const mazeChange = (m: MazeState | null): Change => ({ op: 'ext', key: EXT, value: m ? (clone(m) as unknown as Record<string, unknown>) : null })

// ---- 計數器（加法，不怕同一段路好幾次問掛點讀到舊狀態） ----

export const roundKey = (id: string, layer: number): string => `maze:${id}:r${layer}`
export const downKey = (id: string): string => `maze:${id}:down`
export const chipKey = (id: string): string => `maze:${id}:chip`

const count = (state: Pick<GameState, 'counters'>, key: string): number => {
  const v = state.counters[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 每一層用了幾個回合（探索加戰鬥）、倒下的人次、籌碼。 */
export function tallyOf(state: Pick<GameState, 'counters'>, m: Pick<MazeState, 'id'>, layers: number): { rounds: number[]; downs: number; chips: number } {
  return {
    rounds: Array.from({ length: layers }, (_, i) => count(state, roundKey(m.id, i))),
    downs: count(state, downKey(m.id)),
    chips: count(state, chipKey(m.id)),
  }
}

/** 把這一趟的計數器歸零的變更（每一個加一個負的自己；沒有累積的不寫）。 */
export function resetTally(state: Pick<GameState, 'counters'>, m: Pick<MazeState, 'id'>, layers: number): Change[] {
  const out: Change[] = []
  for (const key of [...Array.from({ length: layers }, (_, i) => roundKey(m.id, i)), downKey(m.id), chipKey(m.id)]) {
    const v = count(state, key)
    if (v !== 0) out.push({ op: 'counter', key, delta: -v })
  }
  return out
}

// ---- 評價 ----

/** 評價：總回合數對標準的比例與倒下的人數；照順序第一列符合的就是，最後一列墊底。 */
export function rate(rules: MazeRules, rounds: number, standard: number, downs: number): RatingRow {
  const ratio = standard > 0 ? rounds / standard : Infinity
  for (const row of rules.rating.slice(0, -1)) {
    if ((row.ratio === undefined || ratio <= row.ratio) && (row.downs === undefined || downs <= row.downs)) return row
  }
  return rules.rating[rules.rating.length - 1]!
}
