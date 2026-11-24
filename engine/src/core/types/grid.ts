// L0 型別：格子地圖（MIGRATION E 的 grid、specialMaps；DATA 9.3 節；COMMISSION_MAPS 第 1 節）。
// 同一個地圖引擎畫兩個世界：現實用固定的版面（內容種類 special_map），內海用隨機生成（M3，同一個模型；生成的結果存在實例裡）。dev/adr/0012、0018。

export interface GridPoint {
  x: number
  y: number
}

/**
 * 一格的種類（COMMISSION_MAPS 1.1 節「資料裡的名字」）。清單可以由資料的 legend 加：核心只看每一種的三個性質
 * （能不能走、擋不擋視線、是不是標記），見 core/grid/model.ts 的 CELL_TRAITS。
 */
export type CellKind = string

/** 一張圖上被改過的一格（門開了、標記被拿走、擺設被打掉）。只記和版面不一樣的地方。 */
export interface CellPatch {
  /** 換成另一種格子（上鎖的門打開之後是 door） */
  kind?: CellKind
  /** 這個標記用過了（拿走的憑證、插過的資料埠、打開的保險箱、打完的遭遇點） */
  used?: boolean
}

/** 會動的東西現在在哪（巡邏的保全）。鍵是標記的 id（G1、G2）。 */
export interface MoverState {
  at: [number, number]
  /** 走到路線的第幾段 */
  leg: number
  /** 拿掉了（打倒、引開） */
  gone?: boolean
}

export interface SheetState {
  /** 看過的格子：和版面一樣大，一列一個字串，每格 '1'（看過）或 '0' */
  seen: string[]
  /** 改過的格子，鍵是 'x,y' */
  cells: Record<string, CellPatch>
  movers: Record<string, MoverState>
}

// ---- 地圖的定義（DATA 9.3 節；內容種類 special_map）：型別放在 L0，因為地圖實例可以自己帶一份定義（MapInstance.gen），狀態要認得它的形狀 ----

/** 一個標記（DATA 9.3 節的 cells）。 */
export interface MarkerDef {
  /** 照「由上到下、由左到右」編號：E1、T2、$1、&1；網內的小寫標記是 g1、a1、c1（大寫與小寫各自編） */
  id: string
  at: [number, number]
  mark: string
  name: string
  /** 入口的種類與條件（COMMISSION_TEMPLATES 的 entries[].need）；其他標記沒有 */
  kind?: string
  need?: Record<string, unknown>
}

/** 遭遇點：在這裡開打時，戰場的八格遮蔽照它的配置。 */
export interface SpotDef {
  /** 模板的編號：!1、!2 */
  id: string
  at: [number, number]
  /** dense、medium、sparse、one_sided，或八格逐格寫 */
  cover: string | { ally: number[]; foe: number[] }
  /** 場地效果：dark、crowd…… */
  field?: string[]
}

export interface ControlDef {
  id: string
  at: [number, number]
  zones: string[]
  /** 子網裡對應的控制節點 id（cn_ 開頭） */
  node: string
  devices: string[]
}

export interface LinkDef {
  /** 這一張圖上的一格或幾格（樓梯、電梯、相通的門） */
  at: Array<[number, number]>
  /** 接到哪一張圖 */
  to: string
  /** 到了那一張站在哪；沒寫就站在那一張接回這一張的連接格 */
  land?: [number, number]
}

export interface PatrolDef {
  guard: string
  /** 照順序走過的區塊 */
  route: string[]
}

/** 一張圖（DATA 9.3 節的 sheets[]）。 */
export interface SheetDef {
  id: string
  name: string
  size: [number, number]
  layout: string[]
  legend?: Record<string, CellKind>
  zones?: string[]
  zone_names?: Record<string, string>
  cells?: MarkerDef[]
  spots?: SpotDef[]
  controls?: ControlDef[]
  patrols?: PatrolDef[]
  links?: LinkDef[]
  scout?: Array<{ reveal: string; at: string }>
  /** 整張沒有燈（排水道、隧道）：視野只剩腳下（SITES 第 11 節） */
  dark?: boolean
  /** 這一張圖的視野半徑（1～9），蓋掉核心的預設（平常 5 格、沒有燈 1 格）；沒寫照舊。網內的地圖由區的規則表給（子網是 2 格；dev/adr/0018 N26） */
  sight?: number
}

/**
 * 一個地圖的定義（DATA 9.3 節；一個模板一筆，裡面一到幾張圖）。內容種類 special_map。
 * 欄位的形狀和 ContentEntry（L2）一樣：id 加任意欄位。型別放在 L0，內容登錄表照這個形狀收。
 */
export interface SpecialMapEntry {
  id: string
  [field: string]: unknown
  /** 模板的種類（office_small、club、subnet……）。地圖屬於哪個世界看它：核心的 STREET_MAP_KINDS、NET_MAP_KINDS */
  kind: string
  size: [number, number]
  max_maps?: number
  district_weight?: Record<string, number>
  fits?: string[]
  sheets: SheetDef[]
}

/** 地圖實例自己帶的定義（生成的地圖；dev/adr/0018 第五節）。 */
export interface MapGen {
  /** 生成的結果，整份存在實例裡：規則表或生成器之後改了，存檔裡站的位置與處理過的節點照樣對得上。它的 id 等於實例的 def */
  map: SpecialMapEntry
  /** 生成用的種子（重現與除錯用；讀檔不會照它重新生成） */
  seed: number
  /** 誰生成的（功能或區的 id）；除錯用 */
  by: string
}

/** 一張地圖的實例：同一個定義可以開好幾份（每件委託各一份），結束時清掉（CODESCAN 2.2 節）。 */
export interface MapInstance {
  /** m1、m2…… */
  id: string
  /** 地圖定義的 id（內容種類 special_map）。有 gen 的實例，這個 id 等於 gen.map.id，內容裡不必有它 */
  def: string
  /** 開它的東西（委託的 id、任務的 id）：那件事結束時一起清掉 */
  owner?: string
  /** 這份實例自己帶的定義（生成的地圖）。有的話 gridHere、gridWalk、gridView 一律用它，不查內容（core/grid 的 instanceDef）。舊檔沒有是合法的 */
  gen?: MapGen
  /** 每一張圖的狀態，鍵是圖的 id；走進去才建立 */
  sheets: Record<string, SheetState>
  /** 發起的功能自己要記的東西（警戒、這一段用哪個遭遇點……） */
  ext?: Record<string, unknown>
}

/** 主角這一隊站在哪一張圖的哪一格。 */
export interface GridPos {
  /** 地圖實例的 id */
  map: string
  /** 圖的 id */
  sheet: string
  x: number
  y: number
}

export interface MapsState {
  instances: Record<string, MapInstance>
  /** 現在站的位置；不在格子地圖上是 null */
  at: GridPos | null
  /** 流水號 */
  seq: number
}
