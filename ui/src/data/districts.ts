import type { District, DistrictId, Facility } from './types'

/**
 * 八個區與街區（docs/world/DISTRICTS.md 第 2 節、docs/world/SITES.md 第 2～9 節）。
 * x、y 是區在 city-map.svg（1600 × 1000）上的位置，給城市地圖的熱點用。
 */
export const DISTRICTS: District[] = [
  { id: 'hive', name: '蜂巢', price: 0.8, security: '市警不來；東側有孤星連', style: '街頭', x: 1085, y: 640, blocks: ['天井市場', '四號塔', '西棟', '東側', '屋頂村'] },
  { id: 'ave42', name: '四十二番街', price: 1, security: '店家自己顧；市警收錢才來', style: '歡場、霓虹龐克', x: 860, y: 520, blocks: ['上城段', '中城段・北', '中城段・南', '刀巷', '下城段', '旅館坡'] },
  { id: 'sakura', name: '櫻町', price: 1.2, security: '緋櫻警備局（大街）；特攻姬（巷子）', style: '櫻町系', x: 520, y: 640, blocks: ['劇場通', '千本通', '電器街', '社宅群', '神社坡'] },
  { id: 'crown', name: '冠冕區', price: 3, security: '企業保全，兩分鐘內', style: '企業', x: 490, y: 380, blocks: ['中央廣場', '空中花園', '濱海', '服務層'] },
  { id: 'oldport', name: '舊港', price: 0.7, security: '沒有', style: '特攻、皮衣、旗袍', x: 880, y: 895, blocks: ['碼頭', '夜市碼頭', '貨櫃城', '倉庫區', '彈坑灣'] },
  { id: 'glass', name: '玻璃岸', price: 4, security: '私人保全', style: '高級訂製、哥德', x: 640, y: 100, blocks: ['別墅區', '俱樂部街', '遊艇碼頭'] },
  { id: 'rust', name: '鏽帶', price: 0.9, security: '黑泉與星旗的私兵', style: '工裝、荒地', x: 1420, y: 330, blocks: ['東門外', '廠前鎮', '薔薇驛', '機甲墳場', '骨場'] },
  { id: 'under', name: '地下層', price: 1, security: '沒有。貞網局偶爾下來', style: '無', x: 990, y: 760, blocks: ['月台市', '排水大廳', '轉播站', '書店街'] },
]
export const districtById = (id: DistrictId) => DISTRICTS.find(d => d.id === id)!

/**
 * 街區圖：13 × 9（DISTRICTS 1.3 節）。'#' 建築、'.' 街道、'F' 設施（照順序填入）、'>' 出口（照順序填入）。
 * 沒有手畫版面的街區用 BLOCK_TEMPLATE。
 */
export const BLOCK_TEMPLATE = [
  '##F##.###F###',
  '##.##.###.###',
  '>...........>',
  '##.###.##.F##',
  'F..###.##...#',
  '##.....F#.###',
  '##.###.##...>',
  '##F###.###F##',
  '######>######',
]

export interface BlockSpec {
  district: DistrictId
  name: string
  rows?: string[]
  facilities: Facility[]
  exits: string[]
}

const svc = (id: string, name: string, icon: string, services?: Facility['services']): Facility => ({ id, name, icon, kind: 'service', services })

export const BLOCKS: Record<string, BlockSpec> = {
  '四號塔': {
    district: 'hive', name: '四號塔',
    rows: [
      '###F####F####',
      '###.####.####',
      '>...........>',
      '#F.##.##.##F#',
      '##.##.##.####',
      '#F.....F....#',
      '##.###.##..##',
      '##F###.###F##',
      '######>######',
    ],
    facilities: [
      { id: 'rooftop', name: '屋頂的晾衣場', icon: 'ic-fac_home', kind: 'talk', npcIds: ['xiaomai'], services: [{ name: '吹風', action: 'rest' }] },
      { id: 'myhome', name: '你的單位（7 樓）', icon: 'ic-fac_home', kind: 'home', services: [{ name: '回家', action: 'home' }, { name: '睡一覺', action: 'rest' }] },
      { id: 'hebo', name: '何伯的樓長室', icon: 'ic-fac_home', kind: 'talk', npcIds: ['hebo'], services: [{ name: '付房租', price: 150, action: 'none' }] },
      { id: 'clinic', name: '縫縫診所（地下室）', icon: 'ic-fac_clinic', kind: 'clinic', services: [{ name: '處理傷口', price: 120, action: 'none' }, { name: '裝義體', action: 'none' }] },
      { id: 'print', name: '午夜印刷（7 樓）', icon: 'ic-fac_doujin', kind: 'service', services: [{ name: '印海報', price: 40, action: 'none' }] },
      { id: 'bath', name: '公共浴室', icon: 'ic-fac_hotel', kind: 'service', services: [{ name: '洗澡', price: 5, action: 'rest' }] },
      { id: 'chute', name: '垃圾滑道的投口', icon: 'ic-fac_under', kind: 'dungeon', services: [{ name: '下去探索', action: 'dungeon' }] },
      { id: 'elevator', name: '壞掉的電梯', icon: 'ic-fac_gate', kind: 'service' },
    ],
    exits: ['天井市場', '西棟', '屋頂村'],
  },
  '天井市場': {
    district: 'hive', name: '天井市場',
    facilities: [
      { id: 'alian', name: '阿蓮雜貨', icon: 'ic-fac_conv', kind: 'shop', shopId: 'alian', npcIds: ['alian'], services: [{ name: '買賣', action: 'shop' }] },
      svc('peach', '桃子屋蜂巢店', 'ic-fac_food', [{ name: '便當', price: 12, action: 'none' }]),
      svc('parts', '零件攤', 'ic-fac_scrapyard'),
      svc('gacha', '義體扭蛋攤', 'ic-fac_gacha', [{ name: '轉一次', price: 30, action: 'none' }]),
      svc('noodle', '麵攤', 'ic-fac_food', [{ name: '街邊的麵', price: 5, action: 'none' }]),
      svc('board', '牆報板', 'ic-fac_tapes'),
      svc('mutual', '互助會辦公室', 'ic-fac_home'),
    ],
    exits: ['四號塔', '屋頂村', '高架橋下', '西棟'],
  },
  '倉庫區': {
    district: 'oldport', name: '倉庫區',
    facilities: [
      { id: 'gunshop', name: '熔爐・槍店「回火」', icon: 'ic-fac_gunshop', kind: 'shop', shopId: 'gunshop', npcIds: ['laotie'], services: [{ name: '買賣', action: 'shop' }] },
      svc('coldstore', '冷庫', 'ic-fac_coldstore'),
      svc('toll', '鉻娘子的收費站', 'ic-fac_gate', [{ name: '過路費', price: 20, action: 'none' }]),
      svc('usedparts', '二手零件倉', 'ic-fac_scrapyard'),
      svc('fight', '黑拳的報名處', 'ic-fac_arena'),
    ],
    exits: ['碼頭', '貨櫃城', '夜市碼頭'],
  },
  '刀巷': {
    district: 'ave42', name: '刀巷',
    facilities: [
      { id: 'cybershop', name: '義體零件行', icon: 'ic-fac_cybershop', kind: 'shop', shopId: 'cybershop', services: [{ name: '買賣', action: 'shop' }] },
      svc('qinghe', '正規診所「清和」', 'ic-fac_clinic', [{ name: '裝義體', action: 'none' }]),
      svc('backalley', '黑診所「後巷」', 'ic-fac_clinic'),
      svc('bio', '生體件專賣', 'ic-fac_pharmacy'),
      svc('unlock', '授權鎖解鎖攤', 'ic-fac_electro'),
    ],
    exits: ['中城段・北', '燈籠巷', '下城段'],
  },
}

/** 沒有寫資料的街區：用通用的設施名，只能看、不能用。 */
export function blockSpec(district: DistrictId, name: string): BlockSpec {
  if (BLOCKS[name]) return BLOCKS[name]
  const d = DISTRICTS.find(x => x.id === district)!
  return {
    district, name,
    facilities: [svc(`${name}-1`, `${name}的店`, 'ic-fac_conv'), svc(`${name}-2`, `${name}的酒吧`, 'ic-fac_bar'), svc(`${name}-3`, '牆報板', 'ic-fac_tapes')],
    exits: d.blocks.filter(b => b !== name).slice(0, 3),
  }
}

export interface BlockMap { w: number; h: number; cells: string[][]; facilityAt: Map<string, Facility>; exitAt: Map<string, string> }

export function buildBlockMap(spec: BlockSpec): BlockMap {
  const rows = spec.rows ?? BLOCK_TEMPLATE
  const cells = rows.map(r => [...r])
  const facilityAt = new Map<string, Facility>()
  const exitAt = new Map<string, string>()
  let fi = 0, ei = 0
  cells.forEach((row, y) => row.forEach((c, x) => {
    if (c === 'F') {
      const f = spec.facilities[fi++]
      if (f) facilityAt.set(`${x},${y}`, f); else row[x] = '#'
    } else if (c === '>') {
      const e = spec.exits[ei++]
      if (e) exitAt.set(`${x},${y}`, e); else row[x] = '.'
    }
  }))
  return { w: cells[0].length, h: cells.length, cells, facilityAt, exitAt }
}
