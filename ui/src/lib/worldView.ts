import type { GridView } from '@engine/src'
import type { CityGraph, WorldView } from '@engine/src/features/world'
import type { RideView, TransitView } from '@engine/src/features/transit'

/**
 * 引擎的世界、交通、事件視窗的檢視整理成畫面要的樣子（M2-ui-world）。
 * 只做整理與排序：引擎給什麼就顯示什麼，這裡沒有機率、車資、DC、能不能做的判斷；原因一律是引擎寫好的句子。
 */

// ---- 街區圖 ----

/** GridMap 的一格長什麼樣子（和 components/GridMap.vue 的 CellView 同一個形狀） */
export interface CellInfo { kind: string; icon?: string; mark?: string; title?: string; tint?: string }

/** 引擎的格子種類 → 畫面的格子樣式。沒看過的格子是 null（迷霧由 fogOf 決定）。 */
const KIND_STYLE: Record<string, string> = { wall: 'building', floor: 'street', ground: 'street', spot: 'street', door: 'door', crowd: 'street' }

/** 這一格長什麼樣子：出口畫箭頭與「往某某」、設施畫圖標與名字、站著的那間設施標色。 */
export function cellInfo(x: number, y: number, grid: GridView, world: WorldView, icons: Record<string, string> = {}): CellInfo {
  const kind = grid.cells[y]?.[x]
  if (!kind) return { kind: 'void' }
  const at = (p: { at: [number, number] | null }) => p.at !== null && p.at[0] === x && p.at[1] === y
  if (kind === 'facility') {
    const f = world.facilities.find(at)
    if (f) return { kind: 'fac', ...(icons[f.marker] ? { icon: icons[f.marker] } : {}), title: f.open ? f.name : `${f.name}（${f.reason ?? '現在沒有開'}）`, ...(f.marker === world.facility?.marker ? { tint: 'var(--a)' } : {}) }
  }
  if (kind === 'entry') {
    const e = world.exits.find(at)
    if (e) return { kind: 'exit', mark: '→', title: `往${e.toName}` }
  }
  return { kind: KIND_STYLE[kind] ?? 'street' }
}

/** 迷霧：看過的格子顯示，沒看過的蓋住。 */
export const fogOf = (x: number, y: number, grid: GridView): 'hidden' | 'visible' => (grid.cells[y]?.[x] ? 'visible' : 'hidden')

/** 這一塊的出口，照位置由上到下、由左到右排（右欄「出口」列表）。 */
export function exitList(world: WorldView): WorldView['exits'] {
  return [...world.exits].sort((a, b) => (a.at?.[1] ?? 99) - (b.at?.[1] ?? 99) || (a.at?.[0] ?? 99) - (b.at?.[0] ?? 99))
}

/** 設施的圖標：示意包多給的欄位 `icon`（block 資料的 facilities[標記].icon）；沒有就不畫。 */
export function facilityIcons(block: { facilities?: Record<string, { icon?: string }> } | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [marker, f] of Object.entries(block?.facilities ?? {})) if (f.icon) out[marker] = f.icon
  return out
}

// ---- 「這裡」 ----

export interface HereItem { id: string; name: string; reason: string | null }

/** 站著的這一格能做的事：引擎一項一項給的（設施的、各功能的），灰掉的帶引擎的原因。 */
export function hereItems(grid: GridView | null): HereItem[] {
  return (grid?.here.uses ?? []).map(u => ({ id: u.id, name: u.name, reason: u.block }))
}

// ---- 城市地圖 ----

export interface CityDistrictView { id: string; name: string; grade: number; x: number; y: number; price: number | null; security: string; style: string; blocks: Array<{ id: string; name: string; kind: 'block' | 'bridge' }> }

/** 區與街區怎麼連（cityGraph）加上區的資料（地圖位置 map_x／map_y、物價、治安 security 與風格 style：district 內容的欄位，沒寫就空著）。 */
export function cityMapView(graph: CityGraph, entry: (kind: string, id: string) => Record<string, unknown> | undefined): CityDistrictView[] {
  return graph.districts.map(d => {
    const e = entry('district', d.id) ?? {}
    const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
    return {
      id: d.id, name: d.name, grade: d.grade, x: num(e.map_x, 800), y: num(e.map_y, 500), price: typeof e.price_mult === 'number' ? e.price_mult : null,
      security: typeof e.security === 'string' ? e.security : '', style: typeof e.style === 'string' ? e.style : '',
      blocks: d.blocks.flatMap(id => graph.blocks.filter(b => b.id === id).map(b => ({ id: b.id, name: b.name, kind: b.kind }))),
    }
  })
}

/** 計程車能去的地方（車站）在某一塊街區裡的，車站名稱順序照引擎。 */
export function taxiTargetsIn(view: TransitView, block: string): TransitView['taxi']['destinations'] {
  return view.taxi.destinations.filter(d => d.block === block)
}

// ---- 搭車 ----

export const PERIOD_NAME: Record<string, string> = { peak: '尖峰', night: '深夜', day: '平時' }

/** 路線條：每一站的樣式（過了的變淡、現在停靠的亮起、目的地金框）。 */
export function stripClass(s: RideView['stops'][number]): string {
  return [s.state, s.dest ? 'dest' : ''].filter(Boolean).join(' ')
}
