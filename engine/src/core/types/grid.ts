// L0 型別：格子地圖（MIGRATION E 的 grid、specialMaps；DATA 9.3 節；COMMISSION_MAPS 第 1 節）。
// 同一個地圖引擎畫兩個世界：現實用固定的版面（內容種類 special_map），內海用隨機生成（M3，同一個模型）。dev/adr/0012。

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

/** 一張地圖的實例：同一個定義可以開好幾份（每件委託各一份），結束時清掉（CODESCAN 2.2 節）。 */
export interface MapInstance {
  /** m1、m2…… */
  id: string
  /** 地圖定義的 id（內容種類 special_map） */
  def: string
  /** 開它的東西（委託的 id、任務的 id）：那件事結束時一起清掉 */
  owner?: string
  /** 隨機生成的地圖用的種子（M3） */
  seed?: number
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
