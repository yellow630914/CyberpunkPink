// L6 功能 world 的資料與純函式：內容的型別與格式檢查、狀態的形狀、查詢。不碰登錄表（登錄在 index.ts）。
// 規格：DISTRICTS 1.1、1.2、1.3、1.4 節；DATA 第 12 節（設施的種類）；dev/adr/0012（格子地圖）、0016 第六節與 G8；dev/work/M2-world.md。
//
// 內容種類：
//   district       { id, name, grade, price_mult?, step_minutes?, blocks: [街區 id], factions?: [勢力 id] }
//   block          { id, district, name, kind: 'block' | 'bridge', map: 地圖 id（special_map）, exits, facilities }
//                  exits       { [標記 id]: { to: 街區 id, arrive: 對面的標記 id } }（版面上的 E）
//                  facilities  { [標記 id]: { type, name, npc?, open?: { time?: [時段], weekday?: [0～6] } } }（版面上的 F，圖例由資料加）
//   facility_type  { id, name }（清單是資料；別的功能多讀的欄位照樣放這裡）
// 一塊街區用的版面是那張地圖的第一張圖（sheets[0]）。
//
// 狀態 state.ext.world：{ instances: { [街區 id]: 地圖實例 id }, visited: [街區 id], steps: 走了幾格 }。

import type { ContentEntry, GameState, Kernel, SegmentId, Weekday } from '../../core'
import { SEGMENT_IDS, isRecord, isSafeInt, segmentOf, segmentWeekdayOf } from '../../core'
import type { MarkerDef, SheetDef, SpecialMapEntry } from '../../core'

export const OWNER = 'world'
export const EXT = 'world'
export const DISTRICT_KIND = 'district'
export const BLOCK_KIND = 'block'
export const FACILITY_TYPE_KIND = 'facility_type'

/** 走一格花幾分鐘（G8）：區的資料 step_minutes 沒寫時用這個。 */
export const DEFAULT_STEP_MINUTES = 1
/** 在街區裡每走這麼多格帶一個 walk 的觸發點（EVENTS 3.1 節）。 */
export const WALK_TRIGGER_EVERY = 10
/** 設施沒開時給玩家看的原因。 */
export const CLOSED_REASON = '現在沒有開。'

export interface DistrictEntry extends ContentEntry {
  name: string
  /** 1～5；核心的 areaGrade 讀它 */
  grade: number
  price_mult?: number
  step_minutes?: number
  blocks: string[]
  factions?: string[]
}

export interface ExitDef {
  to: string
  arrive: string
}

export interface OpenDef {
  time?: SegmentId[]
  weekday?: Weekday[]
}

export interface FacilityDef {
  type: string
  name: string
  npc?: string
  open?: OpenDef
}

export interface BlockEntry extends ContentEntry {
  district: string
  name: string
  kind: 'block' | 'bridge'
  map: string
  exits: Record<string, ExitDef>
  facilities: Record<string, FacilityDef>
}

export interface FacilityTypeEntry extends ContentEntry {
  name: string
}

export interface WorldState {
  /** 每一塊街區開過的地圖實例（整局只有一份） */
  instances: Record<string, string>
  /** 去過的街區，照第一次去的順序 */
  visited: string[]
  /** 在街區裡一共走了幾格 */
  steps: number
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

/** 讀 state.ext.world：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function worldOf(state: Pick<GameState, 'ext'>): WorldState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const instances: Record<string, string> = {}
  if (isRecord(r.instances)) for (const [b, id] of Object.entries(r.instances)) if (isText(id)) instances[b] = id
  return {
    instances,
    visited: Array.isArray(r.visited) ? r.visited.filter(isText) : [],
    steps: isSafeInt(r.steps) && r.steps >= 0 ? r.steps : 0,
  }
}

// ---- 內容的格式檢查（單筆） ----

export function districtProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!(isSafeInt(e.grade) && e.grade >= 1 && e.grade <= 5)) p.push('grade 要是 1～5 的整數')
  if (e.price_mult !== undefined && !(typeof e.price_mult === 'number' && Number.isFinite(e.price_mult) && e.price_mult > 0)) p.push('price_mult 要是大於 0 的數字')
  if (e.step_minutes !== undefined && !(isSafeInt(e.step_minutes) && e.step_minutes >= 1 && e.step_minutes <= 60)) p.push('step_minutes 要是 1～60 的整數')
  if (!isIdList(e.blocks) || e.blocks.length === 0) p.push('blocks 要是街區 id 的陣列，每個區至少一塊街區')
  else if (new Set(e.blocks).size !== e.blocks.length) p.push('blocks 的街區 id 不能重複')
  if (e.factions !== undefined && !isIdList(e.factions)) p.push('factions 要是勢力 id 的陣列')
  return p
}

function facilityProblems(marker: string, f: unknown): string[] {
  const at = `facilities/${marker}`
  if (!isRecord(f)) return [`${at}：要是一個物件`]
  const p: string[] = []
  if (!isText(f.type)) p.push(`${at}：要有 type（設施的種類）`)
  if (!isText(f.name)) p.push(`${at}：要有 name`)
  if (f.npc !== undefined && !isText(f.npc)) p.push(`${at}：npc 要是 NPC 的 id`)
  if (f.open !== undefined) {
    if (!isRecord(f.open)) p.push(`${at}：open 要是 { time?, weekday? }`)
    else {
      const o = f.open
      if (o.time !== undefined && !(Array.isArray(o.time) && o.time.length > 0 && o.time.every((s) => (SEGMENT_IDS as readonly unknown[]).includes(s)))) p.push(`${at}：open.time 要是時段 id 的陣列（${SEGMENT_IDS.join('、')}）`)
      if (o.weekday !== undefined && !(Array.isArray(o.weekday) && o.weekday.length > 0 && o.weekday.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))) p.push(`${at}：open.weekday 要是 0～6 的陣列（0 是週一）`)
    }
  }
  return p
}

export function blockProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.district)) p.push('要有 district（區的 id）')
  if (!isText(e.name)) p.push('要有 name')
  if (e.kind !== 'block' && e.kind !== 'bridge') p.push("kind 只能是 'block' 或 'bridge'")
  if (!isText(e.map)) p.push('要有 map（地圖 id）')
  const exits = e.exits === undefined ? {} : e.exits
  if (!isRecord(exits)) p.push('exits 要是 { [標記 id]: { to, arrive } }')
  else {
    for (const [marker, x] of Object.entries(exits)) {
      if (!isRecord(x) || !isText(x.to) || !isText(x.arrive)) p.push(`exits/${marker}：要有 to（街區 id）與 arrive（對面的標記 id）`)
    }
  }
  const facilities = e.facilities === undefined ? {} : e.facilities
  if (!isRecord(facilities)) p.push('facilities 要是 { [標記 id]: { type, name } }')
  else {
    for (const [marker, f] of Object.entries(facilities)) {
      p.push(...facilityProblems(marker, f))
      if (isRecord(exits) && marker in exits) p.push(`${marker}：不能同時是出口與設施`)
    }
  }
  return p
}

export function facilityTypeProblems(e: Record<string, unknown>): string[] {
  return isText(e.name) ? [] : ['要有 name']
}

/** 一塊街區的出口與設施（欄位沒寫就是空的）。 */
export const exitsOf = (b: BlockEntry): Record<string, ExitDef> => (isRecord(b.exits) ? b.exits : {})
export const facilitiesOf = (b: BlockEntry): Record<string, FacilityDef> => (isRecord(b.facilities) ? b.facilities : {})

// ---- 查詢 ----

type Cx = Pick<Kernel, 'content'>

export const blockEntry = (k: Cx, id: string | undefined): BlockEntry | undefined => (id ? k.content.get<BlockEntry>(BLOCK_KIND, id) : undefined)
export const districtEntry = (k: Cx, id: string | undefined): DistrictEntry | undefined => (id ? k.content.get<DistrictEntry>(DISTRICT_KIND, id) : undefined)

/** 一塊街區用的那張圖（地圖的第一張）。找不到回傳 undefined。 */
export function sheetOfBlock(k: Cx, block: BlockEntry): { map: SpecialMapEntry; sheet: SheetDef } | undefined {
  const map = k.content.get<SpecialMapEntry>('special_map', block.map)
  const sheet = map?.sheets?.[0]
  return map && sheet ? { map, sheet } : undefined
}

export const markerOf = (sheet: SheetDef, id: string): MarkerDef | undefined => (sheet.cells ?? []).find((m) => m.id === id)

/** 走一格花幾分鐘：那一區的 step_minutes，沒寫照 G8。 */
export function stepMinutes(k: Cx, block: BlockEntry | undefined): number {
  const d = districtEntry(k, block?.district)
  return d && isSafeInt(d.step_minutes) && d.step_minutes >= 1 ? d.step_minutes : DEFAULT_STEP_MINUTES
}

/** 設施現在開不開：沒寫 open 就一直開；時段與星期都要在裡面（星期照時段算，深夜跨過午夜的那一段算前一天）。 */
export function facilityOpen(k: Pick<Kernel, 'timeRules'>, state: GameState, f: FacilityDef): boolean {
  const o = f.open
  if (!o) return true
  if (o.time && !o.time.includes(segmentOf(state.time, k.timeRules))) return false
  if (o.weekday && !o.weekday.includes(segmentWeekdayOf(state.time, k.timeRules))) return false
  return true
}

/** 現在站的這一份地圖實例是不是 world 開的；是的話回傳它是哪一塊街區。 */
export function worldBlockAt(k: Cx, state: GameState, mapId: string | undefined): BlockEntry | undefined {
  const inst = mapId ? state.maps.instances[mapId] : undefined
  if (!inst || inst.owner !== OWNER) return undefined
  const id = isRecord(inst.ext) ? inst.ext.block : undefined
  return typeof id === 'string' ? blockEntry(k, id) : undefined
}

// ---- 內容的整體檢查（跨筆） ----

/**
 * 載入之後的整體檢查：出口與設施的標記在版面上找得到、`to` 指得到、出口成對（從甲走到乙，乙也有回甲的出口）、區與街區互相對得上、
 * 每個區至少一塊街區。回傳問題的清單，每一條寫出是哪一筆（空的就是沒問題）。
 */
export function worldProblems(k: Cx): string[] {
  const p: string[] = []
  const districts = k.content.list<DistrictEntry>(DISTRICT_KIND)
  const blocks = k.content.list<BlockEntry>(BLOCK_KIND)
  const has = (kind: string, id: string) => k.content.has(kind, id)

  for (const d of districts) {
    if (!Array.isArray(d.blocks) || d.blocks.length === 0) {
      p.push(`district/${d.id}：每個區至少要有一塊街區`)
      continue
    }
    for (const bid of d.blocks) {
      const b = blockEntry(k, bid)
      if (!b) p.push(`district/${d.id}：blocks 裡的 ${bid} 沒有這塊街區`)
      else if (b.district !== d.id) p.push(`district/${d.id}：blocks 列了 ${bid}，但 block/${bid} 的 district 是 ${b.district}`)
    }
  }

  for (const b of blocks) {
    const d = districtEntry(k, b.district)
    if (!d) p.push(`block/${b.id}：district ${b.district} 沒有這個區`)
    else if (!d.blocks.includes(b.id)) p.push(`block/${b.id}：district/${d.id} 的 blocks 沒有列它`)
    const sheet = sheetOfBlock(k, b)
    if (!sheet) {
      p.push(`block/${b.id}：map ${b.map} 找不到（或沒有圖）`)
      continue
    }
    const cells = sheet.sheet.cells ?? []
    for (const [marker, x] of Object.entries(exitsOf(b))) {
      const cell = cells.find((c) => c.id === marker)
      if (!cell) p.push(`block/${b.id}：出口 ${marker} 在 ${b.map} 的版面上找不到`)
      else if (cell.mark !== 'E') p.push(`block/${b.id}：出口 ${marker} 在版面上不是 E（是 ${cell.mark}）`)
      const to = blockEntry(k, x.to)
      if (!to) {
        p.push(`block/${b.id}：出口 ${marker} 通到 ${x.to}，沒有這塊街區`)
        continue
      }
      const away = sheetOfBlock(k, to)
      if (away && !markerOf(away.sheet, x.arrive)) p.push(`block/${b.id}：出口 ${marker} 到了 ${x.to} 要站在 ${x.arrive}，那一塊的版面上找不到`)
      if (!Object.values(exitsOf(to)).some((back) => back.to === b.id)) p.push(`block/${b.id}：出口 ${marker} 通到 ${x.to}，但 ${x.to} 沒有通回 ${b.id} 的出口（出口要成對）`)
    }
    for (const [marker, f] of Object.entries(facilitiesOf(b))) {
      const cell = cells.find((c) => c.id === marker)
      if (!cell) p.push(`block/${b.id}：設施 ${marker}（${f.name}）在 ${b.map} 的版面上找不到`)
      else if (cell.mark === 'E') p.push(`block/${b.id}：設施 ${marker}（${f.name}）在版面上是 E，那是出口的標記`)
      if (!has(FACILITY_TYPE_KIND, f.type)) p.push(`block/${b.id}：設施 ${marker}（${f.name}）的種類 ${f.type} 沒有這筆 facility_type`)
    }
  }
  return p
}
