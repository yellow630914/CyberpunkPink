import type { Point } from '../data/types'
import { inBounds, key, reachable, parseRows } from './grid'

/**
 * 家園的格子規則（docs/systems/DOWNTIME.md 7.4～7.7 節）。
 * 地圖是 ASCII 版面：'#' 牆、'+' 門、'E' 大門、'.' 走廊、' ' 地圖外、大寫字母是房間（一個字母一間）。
 */
export type FurnFunc =
  | 'bed' | 'workbench' | 'surgery' | 'netpod' | 'stream' | 'storage' | 'safe' | 'restraint'
  | 'mechrack' | 'kitchen' | 'seat' | 'decor' | 'shower' | 'charger' | 'tank'

export interface FurnitureDef {
  id: string
  name: string
  /** 佔地：寬 × 高（格），轉 90 度時對調 */
  w: number
  h: number
  comfort: number
  style?: string
  beds?: number
  /** 儲物容量（種） */
  storage?: number
  funcs: FurnFunc[]
  /** 只能放在有這個標記的房間（例：整備架只能放在車庫） */
  onlyIn?: 'garage' | 'storeroom'
  price: number
  icon: string
  /** 浴廁的固定設備：不算家具位、不能搬 */
  fixed?: boolean
  adult?: boolean
}

export interface RoomDef { name: string; cap: number; /** 浴廁這類用途寫死的房間 */ fixedUse?: string; garage?: boolean }

export interface HomeLayout {
  tier: 0 | 1 | 2 | 3
  rows: string[]
  rooms: Record<string, RoomDef>
}

export type Rotation = 0 | 90 | 180 | 270
export interface PlacedFurniture { uid: string; def: string; x: number; y: number; rot: Rotation }

export type CellKind = 'wall' | 'door' | 'entrance' | 'hall' | 'room' | 'void'

export class HomeMap {
  readonly w: number
  readonly h: number
  readonly cells: string[][]
  constructor(readonly layout: HomeLayout) {
    this.cells = parseRows(layout.rows)
    this.h = this.cells.length
    this.w = this.cells[0].length
  }
  ch(x: number, y: number): string { return inBounds(this, x, y) ? this.cells[y][x] : ' ' }
  kind(x: number, y: number): CellKind {
    const c = this.ch(x, y)
    if (c === '#') return 'wall'
    if (c === '+') return 'door'
    if (c === 'E') return 'entrance'
    if (c === '.') return 'hall'
    if (c === ' ') return 'void'
    return 'room'
  }
  roomAt(x: number, y: number): string | null { return this.kind(x, y) === 'room' ? this.ch(x, y) : null }
  roomIds(): string[] { return Object.keys(this.layout.rooms).filter(id => this.cells.some(r => r.includes(id))) }
  roomCells(id: string): Point[] {
    const out: Point[] = []
    this.cells.forEach((r, y) => r.forEach((c, x) => { if (c === id) out.push({ x, y }) }))
    return out
  }
  /** 房間的外框（給畫面畫房名用）：最小的包圍矩形 */
  roomBox(id: string) {
    const cs = this.roomCells(id)
    const xs = cs.map(p => p.x), ys = cs.map(p => p.y)
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 }
  }
  entrance(): Point {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.cells[y][x] === 'E') return { x, y }
    throw new Error('家園版面沒有大門（E）')
  }
  floorWalkable(x: number, y: number): boolean {
    const k = this.kind(x, y)
    return k === 'room' || k === 'door' || k === 'entrance' || k === 'hall'
  }
}

export function footprint(def: Pick<FurnitureDef, 'w' | 'h'>, rot: Rotation): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: def.h, h: def.w } : { w: def.w, h: def.h }
}

export function cellsOf(p: Pick<PlacedFurniture, 'x' | 'y' | 'rot'>, def: Pick<FurnitureDef, 'w' | 'h'>): Point[] {
  const f = footprint(def, p.rot)
  const out: Point[] = []
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) out.push({ x: p.x + dx, y: p.y + dy })
  return out
}

/** 被家具佔住的格子 → 那件家具的 uid */
export function occupancy(placed: PlacedFurniture[], defs: Record<string, FurnitureDef>, ignoreUid?: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of placed) {
    if (p.uid === ignoreUid) continue
    for (const c of cellsOf(p, defs[p.def])) m.set(key(c), p.uid)
  }
  return m
}

/** 家具擋路，人走在其他可走的格子上。 */
export function walkGrid(map: HomeMap, placed: PlacedFurniture[], defs: Record<string, FurnitureDef>) {
  const occ = occupancy(placed, defs)
  return { w: map.w, h: map.h, passable: (x: number, y: number) => map.floorWalkable(x, y) && !occ.has(`${x},${y}`) }
}

export type PlaceResult = { ok: true; room: string } | { ok: false; reason: string }

/**
 * 能不能把家具放在這裡（DOWNTIME 7.4 節）：
 * 整件在同一間房的地板上；不壓牆、門、走廊；不和別的家具重疊；不超過這間房的家具位；
 * 限定房間的家具（整備架、倉庫貨架）只能放在那種房間；有人站著的格子不能放；
 * 放下之後，每一扇門與每一塊沒被佔住的地板都還要從大門走得到（不能把路堵死）。
 */
export function validatePlacement(
  map: HomeMap,
  defs: Record<string, FurnitureDef>,
  placed: PlacedFurniture[],
  cand: PlacedFurniture,
  opts: { people?: Point[]; roomUse?: Record<string, string | undefined> } = {},
): PlaceResult {
  const def = defs[cand.def]
  if (!def) return { ok: false, reason: '沒有這種家具。' }
  const cells = cellsOf(cand, def)
  if (cells.some(c => !inBounds(map, c.x, c.y))) return { ok: false, reason: '超出地圖。' }
  const kinds = cells.map(c => map.kind(c.x, c.y))
  if (kinds.some(k => k === 'wall' || k === 'void')) return { ok: false, reason: '壓到牆了。' }
  if (kinds.some(k => k === 'door' || k === 'entrance')) return { ok: false, reason: '不能擋住門。' }
  if (kinds.some(k => k === 'hall')) return { ok: false, reason: '走廊不能擺家具。' }
  const rooms = new Set(cells.map(c => map.roomAt(c.x, c.y)))
  if (rooms.size !== 1) return { ok: false, reason: '整件要放在同一間房裡。' }
  const room = [...rooms][0]!
  const rdef = map.layout.rooms[room]
  const occ = occupancy(placed, defs, cand.uid)
  const hit = cells.map(c => occ.get(key(c))).find(Boolean)
  if (hit) {
    const other = placed.find(p => p.uid === hit)!
    return { ok: false, reason: `和「${defs[other.def].name}」重疊。` }
  }
  if (opts.people?.some(p => cells.some(c => c.x === p.x && c.y === p.y))) return { ok: false, reason: '有人站在那裡。' }
  if (def.onlyIn === 'garage' && !rdef.garage) return { ok: false, reason: '只能放在放得下機甲的房間（車庫）。' }
  if (def.onlyIn === 'storeroom' && opts.roomUse?.[room] !== 'storeroom' && !rdef.fixedUse?.includes('後場'))
    return { ok: false, reason: '只能放在倉庫或店面的後場。' }
  if (!def.fixed) {
    const count = placed.filter(p => p.uid !== cand.uid && !defs[p.def].fixed && roomOf(map, p, defs) === room).length
    if (count + 1 > rdef.cap) return { ok: false, reason: `${rdef.name}的家具位滿了（${rdef.cap}／${rdef.cap}）。` }
  }
  // 不能把路堵死
  const after = [...placed.filter(p => p.uid !== cand.uid), cand]
  const g = walkGrid(map, after, defs)
  const reach = reachable(g, map.entrance())
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (g.passable(x, y) && !reach.has(`${x},${y}`)) return { ok: false, reason: '會把路堵死：有地方走不到了。' }
  }
  return { ok: true, room }
}

export function roomOf(map: HomeMap, p: PlacedFurniture, defs: Record<string, FurnitureDef>): string | null {
  const c = cellsOf(p, defs[p.def])[0]
  return map.roomAt(c.x, c.y)
}

// ---- 用途 ----
export interface RoomUse { id: string; name: string; need: string; effect: string; adult?: boolean }

/** 用途照房間裡的家具推出來（DOWNTIME 7.4 節的表）。順序就是預設的優先：越專門的越前面。 */
export const ROOM_USES: RoomUse[] = [
  { id: 'garage', name: '車庫', need: '整備架；只有放得下機甲的房間', effect: '機甲與載具停在這裡；可以在家修理、大修、換裝與升級機甲' },
  { id: 'clinic', name: '診療室', need: '手術椅或醫療床', effect: '在家睡一覺算傷口處理過；改造師可以在這裡裝侵入度「一般」以下的義體' },
  { id: 'netroom', name: '接入室', need: '接入艙', effect: '從家裡潛入：身體有鎖、有維生，可以多人一起潛' },
  { id: 'workshop', name: '工作間', need: '工作台', effect: '組裝難度 −1；換零件的時間減半' },
  { id: 'studio', name: '攝影間', need: '直播桌', effect: '放得下棚內設備，每類一件' },
  { id: 'playroom', name: '遊戲間', need: '拘束類家具', effect: '契約面板與居家事件多一些選項', adult: true },
  { id: 'storeroom', name: '倉庫', need: '兩件以上的儲物家具', effect: '這間的儲物容量 +25%' },
  { id: 'guest', name: '客房', need: '床，而且有住戶睡在這間', effect: '住客房的人每週親密度額外 +1' },
  { id: 'bedroom', name: '臥室', need: '床', effect: '那張床的舒適 +1（每間算一張）' },
]

export interface RoomInfo { id: string; name: string; cells: number; furniture: PlacedFurniture[]; cap: number; qualified: string[]; use: string | null; fixedUse?: string }

export function deriveRooms(
  map: HomeMap,
  defs: Record<string, FurnitureDef>,
  placed: PlacedFurniture[],
  opts: { chosen?: Record<string, string | undefined>; residentRooms?: string[]; adult?: boolean } = {},
): RoomInfo[] {
  return map.roomIds().map(id => {
    const rdef = map.layout.rooms[id]
    const inRoom = placed.filter(p => roomOf(map, p, defs) === id)
    const funcs = new Set(inRoom.flatMap(p => defs[p.def].funcs))
    const storageCount = inRoom.filter(p => defs[p.def].funcs.includes('storage')).length
    const hasBed = funcs.has('bed')
    const q: string[] = []
    if (!rdef.fixedUse) {
      if (funcs.has('mechrack') && rdef.garage) q.push('garage')
      if (funcs.has('surgery')) q.push('clinic')
      if (funcs.has('netpod')) q.push('netroom')
      if (funcs.has('workbench') || funcs.has('surgery') || funcs.has('mechrack')) q.push('workshop')
      if (funcs.has('stream')) q.push('studio')
      if (funcs.has('restraint') && opts.adult !== false) q.push('playroom')
      if (storageCount >= 2) q.push('storeroom')
      if (hasBed && opts.residentRooms?.includes(id)) q.push('guest')
      if (hasBed) q.push('bedroom')
    }
    const chosen = opts.chosen?.[id]
    const use = rdef.fixedUse ? null : chosen && q.includes(chosen) ? chosen : q[0] ?? null
    return {
      id, name: rdef.name, cells: map.roomCells(id).length, furniture: inRoom,
      cap: rdef.cap, qualified: q, use, fixedUse: rdef.fixedUse,
    }
  })
}

// ---- 舒適度與儲物 ----
export const COMFORT_TIERS = [
  { at: 6, name: '睡得好', effect: '回復率 +10%；感載上限 +5' },
  { at: 12, name: '精神飽滿', effect: '回復率 +20%；感載上限 +5；定力 +1' },
  { at: 20, name: '安穩', effect: '回復率 +30%；感載上限 +10；定力 +1；每週的沉溺自然下降再 −1' },
]

export interface ComfortBreakdown { furniture: number; sets: number; built: number; people: number; bedrooms: number; crowding: number; total: number; beds: number; tier: string | null }

/**
 * 舒適度 = 家具的舒適合計 ＋ 套組 ＋ 住處自帶 ＋ 住戶與家務 ＋ 臥室 − 擁擠（DOWNTIME 7.6 節）。
 * 套組：同一個風格的家具 4 件以上 +2。擁擠：住的人比床位多，每多一人 −2。
 */
export function comfort(
  defs: Record<string, FurnitureDef>,
  placed: PlacedFurniture[],
  rooms: RoomInfo[],
  opts: { built?: number; peopleBonus?: number; sleepers: number },
): ComfortBreakdown {
  const furniture = placed.reduce((s, p) => s + defs[p.def].comfort, 0)
  const styles = new Map<string, number>()
  for (const p of placed) { const st = defs[p.def].style; if (st) styles.set(st, (styles.get(st) ?? 0) + 1) }
  const sets = [...styles.values()].filter(n => n >= 4).length * 2
  const beds = placed.reduce((s, p) => s + (defs[p.def].beds ?? 0), 0)
  const bedrooms = rooms.filter(r => r.use === 'bedroom').length
  const crowding = Math.max(0, opts.sleepers - beds) * 2
  const built = opts.built ?? 0
  const people = opts.peopleBonus ?? 0
  const total = furniture + sets + built + people + bedrooms - crowding
  const tier = [...COMFORT_TIERS].reverse().find(t => total >= t.at)?.name ?? null
  return { furniture, sets, built, people, bedrooms, crowding, total, beds, tier }
}

export function storage(defs: Record<string, FurnitureDef>, rooms: RoomInfo[]): { kinds: number; safe: number } {
  let kinds = 0, safe = 0
  for (const r of rooms) {
    let roomCap = 0
    for (const p of r.furniture) {
      const d = defs[p.def]
      if (d.funcs.includes('safe')) safe += d.storage ?? 0
      else if (d.funcs.includes('storage')) roomCap += d.storage ?? 0
    }
    kinds += r.use === 'storeroom' ? Math.floor(roomCap * 1.25) : roomCap
  }
  return { kinds, safe }
}
