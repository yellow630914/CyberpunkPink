import type { DistrictId } from './types'

/**
 * 公共交通（docs/world/DISTRICTS.md 1.2.1 節、docs/art/transit-map.svg）。站點擺在街區圖上（車站設施），
 * 走到車站按 E（或點「這裡」的「搭車」），再選這條線的一站。大眾運輸不能從城市地圖直接叫。
 * 車資文件裡沒有寫：下面的數字是這一版的假設（DECISIONS 2026-11-21），等經濟的框架定了再對。
 */
export type LineId = 'red' | 'sakura' | 'loop' | 'bus' | 'ferry'
export interface TransitStop { name: string; district: DistrictId; block: string }
export interface TransitLine {
  id: LineId; name: string; icon: string
  /** 每站幾分鐘、等車大約幾分鐘 */
  perStop: number; wait: number
  /** 車資：基本＋每站 */
  fare: { base: number; perStop: number }
  pay: string
  loop?: boolean
  note: string
  stops: TransitStop[]
}

export const LINES: TransitLine[] = [
  { id: 'red', name: '地鐵紅線', icon: 'ic-fac_metro', perStop: 5, wait: 4, fare: { base: 2, perStop: 1 }, pay: '帳戶刷卡（留紀錄）或現金單程票', note: '進站掃橋；深夜停駛',
    stops: [
      { name: '冠冕中央', district: 'crown', block: '中央廣場' }, { name: '番街上城', district: 'ave42', block: '上城段' },
      { name: '番街中城', district: 'ave42', block: '中城段・北' }, { name: '番街下城', district: 'ave42', block: '下城段' },
      { name: '蜂巢天井', district: 'hive', block: '天井市場' }, { name: '東門', district: 'rust', block: '東門外' },
    ] },
  { id: 'sakura', name: '地鐵櫻線', icon: 'ic-fac_metro', perStop: 5, wait: 4, fare: { base: 2, perStop: 1 }, pay: '帳戶刷卡（留紀錄）或現金單程票', note: '進站掃橋；舊港碼頭站入夜後沒有站務員',
    stops: [
      { name: '冠冕中央', district: 'crown', block: '中央廣場' }, { name: '櫻町劇場前', district: 'sakura', block: '劇場通' },
      { name: '千本通', district: 'sakura', block: '千本通' }, { name: '舊港碼頭', district: 'oldport', block: '碼頭' },
    ] },
  { id: 'loop', name: '輕軌環線', icon: 'ic-fac_metro', perStop: 8, wait: 4, fare: { base: 3, perStop: 0 }, pay: '帳戶或現金；不掃橋', loop: true, note: '高架，繞一圈；擠，扒手多',
    stops: [
      { name: '蜂巢', district: 'hive', block: '西棟' }, { name: '櫻町', district: 'sakura', block: '電器街' }, { name: '番街中城', district: 'ave42', block: '中城段・南' },
    ] },
  { id: 'bus', name: '外環巴士', icon: 'ic-fac_bus', perStop: 20, wait: 20, fare: { base: 3, perStop: 1 }, pay: '只收現金', note: '班次少；鏽帶區內唯一的大眾運輸',
    stops: [
      { name: '東門', district: 'rust', block: '東門外' }, { name: '精煉廠', district: 'rust', block: '廠前鎮' }, { name: '薔薇驛', district: 'rust', block: '薔薇驛' },
      { name: '骨場', district: 'rust', block: '骨場' }, { name: '玻璃岸', district: 'glass', block: '別墅區' },
    ] },
  { id: 'ferry', name: '渡輪', icon: 'ic-fac_ferry', perStop: 15, wait: 30, fare: { base: 6, perStop: 2 }, pay: '現金或人情；不問身分', note: '胭脂堂經營；可以帶貨',
    stops: [
      { name: '舊港碼頭', district: 'oldport', block: '碼頭' }, { name: '冠冕區濱海', district: 'crown', block: '濱海' }, { name: '玻璃岸遊艇碼頭', district: 'glass', block: '遊艇碼頭' },
    ] },
]

/** 浮空計程車：任意兩個地面站點（DISTRICTS 1.2.1 節），不進舊港與鏽帶深處，地下層沒有地面站點。 */
export const TAXI = { base: 25, perKm: 4, minutes: 10, sameDistrictMinutes: 6 }
export const TAXI_NO_GO: Record<string, string> = {
  貨櫃城: '浮空計程車不進舊港深處。', 倉庫區: '浮空計程車不進舊港深處。', 彈坑灣: '浮空計程車不進舊港深處。',
  機甲墳場: '浮空計程車不進鏽帶深處。', 骨場: '浮空計程車不進鏽帶深處。',
}
