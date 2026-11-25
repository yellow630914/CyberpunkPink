import type { ContentPack } from '@engine/src'
import { DISTRICTS, BLOCK_TEMPLATE, blockSpec } from '../districts'
import { LINES } from '../transit'
import { DISTRICT_MARKET } from './market'
import type { DistrictId, Facility } from '../types'
import { CRAFT_FACILITY_TYPE } from './craft'

/**
 * 示意世界包的城市部分：把 ui/src/data/districts.ts 的區、街區、設施整理成引擎的內容種類
 * （district、block、special_map、facility_type；格式見 dev/work/M2-world.md）。
 * 整份是資料轉換：沒有規則。正式內容匯入之後整包換掉（dev/work/M2-plan.md 使用者定案第 5 項）。
 *
 * 引擎的 id 只收小寫英文、數字與底線，所以街區的 id 是 `b_<區>_<第幾塊>`，名字（引擎的 name）照原樣。
 * 出口與設施是版面上的標記：E1、E2……與 F1、F2……（由上到下、由左到右）。
 * 設施的 `icon` 是示意包多給的欄位（畫面讀，引擎不讀）。
 */

/** 區裡有哪些勢力（目標勢力從這裡抽；引擎的 district 內容欄位 factions） */
export const DISTRICT_FACTIONS: Record<string, string[]> = {
  hive: ['lonestar'], ave42: ['strippers', 'guard'], sakura: ['hizakura'], crown: ['starbelle', 'kunlun'],
  oldport: ['tokko', 'nora'], glass: ['eden'], rust: ['blackspring'], under: ['netvigil'],
}

const GRADE: Record<string, number> = { hive: 1, ave42: 2, sakura: 2, crown: 5, oldport: 1, glass: 5, rust: 2, under: 1 }
/** 走一格幾分鐘（G8）：鏽帶 2，其餘用預設 1 */
const STEP_MINUTES: Record<string, number> = { rust: 2 }

export const blockIdOf = (district: DistrictId, name: string): string => {
  const d = DISTRICTS.find(x => x.id === district)
  const i = d ? d.blocks.indexOf(name) : -1
  if (i < 0) throw new Error(`示意包：${district} 沒有 ${name} 這塊街區。`)
  return `b_${district}_${i + 1}`
}
const NAME_TO_BLOCK = new Map<string, { id: string; district: string }>()
for (const d of DISTRICTS) for (const b of d.blocks) NAME_TO_BLOCK.set(b, { id: blockIdOf(d.id, b), district: d.id })

/** sleep：站在這種設施上可以睡一覺（rate 是生命值上限的幾成、cost 是一晚的價錢；格式見 features/rest） */
const FAC_TYPES: Array<{ id: string; name: string; sleep?: { rate: number; cost: number; treated?: boolean }; clinic?: { grade: 'clinic' | 'unlicensed' | 'black' }; detox?: { free: true }; therapy?: { kind: 'counsel' | 'retreat'; free?: boolean } }> = [
  { id: 'fac_shop', name: '商店' }, { id: 'fac_home', name: '住處' },
  // 診所三種（M4-ui-body；cyberware 的 surgeons 與 medical、drugs、sink 讀 clinic、detox、therapy 這幾個欄位）：縫縫診所是無照的（種類 id 照舊，NPC 的出沒表用它）、清和是正規診所（登記、能做心理治療）、後巷是黑診所
  { id: 'fac_clinic', name: '無照診所', clinic: { grade: 'unlicensed' }, sleep: { rate: 0.5, cost: 30, treated: true } },
  { id: 'fac_clinic_reg', name: '正規診所', clinic: { grade: 'clinic' }, therapy: { kind: 'counsel' } },
  { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
  { id: 'fac_talk', name: '談話的地方' },
  { id: 'fac_dungeon', name: '地下入口' }, { id: 'fac_transit', name: '車站' }, { id: 'fac_service', name: '服務' },
  { id: 'fac_inn', name: '旅店', sleep: { rate: 0.5, cost: 10 } }, { id: 'fac_camp', name: '營地', sleep: { rate: 0.3, cost: 0 } },
]
/** 有床位的舊設施（舊資料的 rest 服務裡睡一晚的那兩處）：種類換成有 sleep 的 */
const SLEEP_TYPE: Record<string, string> = { noid: 'fac_inn', camp: 'fac_camp', divepod: 'fac_dive', qinghe: 'fac_clinic_reg', backalley: 'fac_black' }
const typeOf = (f: Facility): string => SLEEP_TYPE[f.id] ?? CRAFT_FACILITY_TYPE[f.id] ?? `fac_${f.kind}`

/** 營業時間（示意）：酒吧與俱樂部夜裡開、商店與診所白天到晚上，其餘一直開。 */
const DAY = ['morning', 'noon', 'afternoon', 'prime']
const NIGHT = ['prime', 'late', 'dawn']
const OPEN: Record<string, { time: string[] }> = {
  alian: { time: DAY }, peach: { time: DAY }, noodle: { time: [...DAY, 'late'] }, gunshop: { time: DAY }, cybershop: { time: DAY }, qinghe: { time: ['morning', 'noon', 'afternoon'] },
  hebo: { time: DAY }, izakaya: { time: NIGHT }, champagne: { time: NIGHT }, mirror: { time: NIGHT }, blackspring: { time: NIGHT },
}

interface Built {
  id: string
  district: string
  name: string
  layout: string[]
  /** 標記 id → 設施（舊資料的）與位置 */
  facilities: Map<string, { fac: Facility; at: [number, number] }>
  exitMarkers: Array<{ marker: string; at: [number, number]; to: string }>
  station: string | null
}

const W = 13
const H = 9

/** 一塊街區最多放幾個出口：版面上的 '>' 加上邊上的街道（可以改成出口的格子） */
function capacityOf(name: string, district: DistrictId): number {
  const rows = blockSpec(district, name).rows ?? BLOCK_TEMPLATE
  let n = 0
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '>') n++
    else if (c === '.' && (x === 0 || x === W - 1 || y === 0 || y === H - 1)) n++
  }))
  return n
}

/** 街區之間的走道：舊資料的出口名單（只收查得到的街區）成對連起來；任何一頭放不下的略過。 */
function edges(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const cap = new Map<string, number>()
  for (const d of DISTRICTS) for (const name of d.blocks) { const id = blockIdOf(d.id, name); out.set(id, []); cap.set(id, capacityOf(name, d.id)) }
  const add = (a: string, b: string) => {
    if (a === b || out.get(a)!.includes(b) || cap.get(a)! <= 0 || cap.get(b)! <= 0) return
    out.get(a)!.push(b); out.get(b)!.push(a)
    cap.set(a, cap.get(a)! - 1); cap.set(b, cap.get(b)! - 1)
  }
  for (const d of DISTRICTS) for (const name of d.blocks) {
    const id = blockIdOf(d.id, name)
    for (const to of blockSpec(d.id, name).exits) {
      const t = NAME_TO_BLOCK.get(to)
      if (t) add(id, t.id)
    }
  }
  return out
}

function build(): Built[] {
  const nbr = edges()
  const out: Built[] = []
  for (const d of DISTRICTS) for (const name of d.blocks) {
    const id = blockIdOf(d.id, name)
    const spec = blockSpec(d.id, name)
    const cells = (spec.rows ?? BLOCK_TEMPLATE).map(r => [...r])
    const want = nbr.get(id) ?? []
    // 設施：F 照順序填，多的 F 變牆
    const facAt = new Map<string, Facility>()
    let fi = 0
    cells.forEach((row, y) => row.forEach((c, x) => {
      if (c !== 'F') return
      const f = spec.facilities[fi++]
      if (f) facAt.set(`${x},${y}`, f); else row[x] = '#'
    }))
    // 出口：舊版面的 '>' 照順序換成 E，多的變街道；不夠的把邊上的街道換成 E
    let ei = 0
    cells.forEach(row => row.forEach((c, x) => {
      if (c !== '>') return
      if (ei < want.length) { row[x] = 'E'; ei++ } else row[x] = '.'
    }))
    for (let y = 0; y < H && ei < want.length; y++) for (let x = 0; x < W && ei < want.length; x++) {
      if ((x === 0 || x === W - 1 || y === 0 || y === H - 1) && cells[y][x] === '.') { cells[y][x] = 'E'; ei++ }
    }
    if (ei < want.length) throw new Error(`示意包：${name} 放不下 ${want.length} 個出口。`)
    // 車站：這塊街區有線停的話，在第一格內側的街道上擺一個車站設施
    const lines = LINES.filter(l => l.stops.some(s => s.block === name))
    let stationAt: string | null = null
    if (lines.length) {
      const st: Facility = {
        id: `station-${name}`, name: `${lines.map(l => l.name).join('、')}・${lines[0].stops.find(s => s.block === name)!.name}站`,
        icon: lines[0].icon, kind: 'transit', services: [{ name: '搭車', action: 'transit' }],
      }
      outer: for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (cells[y][x] === '.') { cells[y][x] = 'F'; facAt.set(`${x},${y}`, st); stationAt = `${x},${y}`; break outer }
      }
    }
    // 標記：E、F 各自由上到下、由左到右編號
    const facilities = new Map<string, { fac: Facility; at: [number, number] }>()
    const exitMarkers: Built['exitMarkers'] = []
    let en = 0, fn = 0
    let station: string | null = null
    cells.forEach((row, y) => row.forEach((c, x) => {
      if (c === 'E') { en++; exitMarkers.push({ marker: `E${en}`, at: [x, y], to: want[en - 1]! }) }
      if (c === 'F') {
        fn++
        const f = facAt.get(`${x},${y}`)!
        facilities.set(`F${fn}`, { fac: f, at: [x, y] })
        if (stationAt === `${x},${y}`) station = `F${fn}`
      }
    }))
    out.push({ id, district: d.id, name, layout: cells.map(r => r.join('')), facilities, exitMarkers, station })
  }
  return out
}

const BUILT = build()
const BY_ID = new Map(BUILT.map(b => [b.id, b]))

/** 這塊街區的車站設施的標記（沒有車站是 null） */
export const stationMarkerOf = (blockId: string): string | null => BY_ID.get(blockId)?.station ?? null
/** 畫面還沒搬進引擎的舊服務（商店、診所、住處……）：依街區與標記找回舊的設施資料。引擎接上那些功能之後就不需要了。 */
export const legacyFacilityAt = (blockId: string, marker: string | null | undefined): Facility | null => (marker ? BY_ID.get(blockId)?.facilities.get(marker)?.fac ?? null : null)

/** 這塊街區裡舊設施（用舊的 id 找）的標記（找不到是 null）：示意包的商店、打工、住處指到版面上的設施用 */
export function markerOfFacility(blockId: string, facilityId: string): string | null {
  for (const [marker, f] of BY_ID.get(blockId)?.facilities ?? []) if (f.fac.id === facilityId) return marker
  return null
}

const exitName = (to: string): string => BY_ID.get(to)?.name ?? to

export function worldContent(): NonNullable<ContentPack['content']> {
  const special_map = BUILT.map(b => ({
    // kind 是 block：街區的地圖不要求遭遇點（核心的 STREET_MAP_KINDS）
    id: `m_${b.id}`, kind: 'block', size: [W, H] as [number, number],
    sheets: [{
      id: 'street', name: b.name, size: [W, H] as [number, number], layout: b.layout,
      cells: [
        ...b.exitMarkers.map(e => ({ id: e.marker, at: e.at, mark: 'E', name: `往${exitName(e.to)}` })),
        ...[...b.facilities].map(([marker, f]) => ({ id: marker, at: f.at, mark: 'F', name: f.fac.name })),
      ].sort((p, q) => (p.at[1] - q.at[1]) || (p.at[0] - q.at[0])),
    }],
  }))
  const block = BUILT.map(b => ({
    id: b.id, district: b.district, name: b.name, kind: 'block', map: `m_${b.id}`,
    exits: Object.fromEntries(b.exitMarkers.map(e => {
      const back = BY_ID.get(e.to)!.exitMarkers.find(x => x.to === b.id)!
      return [e.marker, { to: e.to, arrive: back.marker }]
    })),
    facilities: Object.fromEntries([...b.facilities].map(([marker, f]) => [marker, {
      type: typeOf(f.fac), name: f.fac.name, icon: f.fac.icon,
      ...(OPEN[f.fac.id] ? { open: OPEN[f.fac.id] } : {}),
    }])),
  }))
  const district = DISTRICTS.map(d => ({
    id: d.id, name: d.name, grade: GRADE[d.id] ?? 1, price_mult: d.price, ...(STEP_MINUTES[d.id] ? { step_minutes: STEP_MINUTES[d.id] } : {}),
    blocks: d.blocks.map(b => blockIdOf(d.id, b)),
    // 區的行情（TRADE 4.2：類別的倍率；引擎的 district.market，貿易類別的 id）
    ...(DISTRICT_MARKET[d.id] ? { market: DISTRICT_MARKET[d.id] } : {}),
    // 城市地圖的熱點位置、治安與風格的說明：引擎的 district 內容的欄位（畫面讀，引擎的規則不讀）
    map_x: d.x, map_y: d.y, security: d.security, style: d.style,
    // 目標勢力從這裡抽（生成委託用）
    factions: DISTRICT_FACTIONS[d.id] ?? [],
  }))
  return { special_map, block, district, facility_type: FAC_TYPES } as unknown as NonNullable<ContentPack['content']>
}

/** 開新局站在哪：四號塔的屋頂晾衣場（舊假存檔的起點） */
export function demoStart(): { block: string; at: string } {
  const id = blockIdOf('hive', '四號塔')
  const at = [...BY_ID.get(id)!.facilities].find(([, f]) => f.fac.id === 'rooftop')![0]
  return { block: id, at }
}

/** 兩個區在城市地圖上的距離換成公里（地圖 1600 像素約 16 公里；同一區算 1 公里由規則的預設處理）。 */
export function districtKm(): Array<{ a: string; b: string; km: number }> {
  const out: Array<{ a: string; b: string; km: number }> = []
  for (let i = 0; i < DISTRICTS.length; i++) for (let j = i + 1; j < DISTRICTS.length; j++) {
    const p = DISTRICTS[i], q = DISTRICTS[j]
    out.push({ a: p.id, b: q.id, km: Math.max(1, Math.round(Math.hypot(p.x - q.x, p.y - q.y) / 100)) })
  }
  return out
}

