import type { WorldEntry } from '../lib/worldCheck'

/**
 * 世界編輯器的假資料（樣稿 docs/mockups/world-editor.html）：世界包「帳本外傳」，疊在基本世界上。
 * 故意留了幾個錯（樣稿裡的那四個格式錯誤與一個年齡），檢查要抓得到。
 */
export const CATEGORIES: Array<{ id: string; name: string; kinds: Array<{ id: string; name: string; kind?: WorldEntry['kind'] }> }> = [
  { id: 'world', name: '世界', kinds: [{ id: 'site', name: '地點', kind: 'site' }, { id: 'blocks', name: '區與街區' }, { id: 'facility', name: '設施', kind: 'facility' }, { id: 'faction', name: '勢力' }, { id: 'citynews', name: '城市的大事' }] },
  { id: 'net', name: '內海', kinds: [{ id: 'subnet', name: '子網' }, { id: 'lace', name: '蕾絲' }] },
  { id: 'people', name: '人物', kinds: [{ id: 'npc', name: '人物', kind: 'npc' }] },
  { id: 'items', name: '物品', kinds: [{ id: 'item', name: '零件', kind: 'item' }, { id: 'bp', name: '設計圖' }, { id: 'drug', name: '藥' }, { id: 'cloth', name: '服裝' }, { id: 'acc', name: '飾品' }, { id: 'adult', name: '成人道具' }, { id: 'skin', name: 'SKIN' }] },
  { id: 'skills', name: '技能', kinds: [{ id: 'tree', name: '技能樹' }, { id: 'trait', name: '特質' }] },
  { id: 'enemies', name: '敵人', kinds: [{ id: 'enemy', name: '敵人', kind: 'enemy' }] },
  { id: 'events', name: '事件', kinds: [{ id: 'event', name: '事件', kind: 'event' }] },
  { id: 'quests', name: '任務', kinds: [{ id: 'series', name: '特殊任務與系列', kind: 'series' }, { id: 'tmpl', name: '委託模板' }, { id: 'run', name: '委託副本' }, { id: 'counter', name: '劇情計數器', kind: 'counter' }] },
  { id: 'guides', name: '指南', kinds: [{ id: 'guide', name: '指南' }] },
]

export const PACK = { id: 'ledger_side', name: '帳本外傳', base: '基本世界' }

export const START_ENTRIES: WorldEntry[] = [
  {
    id: 'ev_ledger_dock_carrier', kind: 'event', name: '碼頭上看到搬帳本的人', series: 'ledger', triggers: ['enter', 'wait'],
    where: 'site_oldport_dock_3', when: '深夜、凌晨',
    requires: { mode: '全部', flags: ['s:ledger:lost_known'], counters: { hizakura: 'in [-1, 1]', harbor_heat: '>= 2' }, rep: '熟面孔以上', sink: '< 70' },
    category: '線索', weight: 3, cast: '$a 生成：碼頭工人，胭脂堂',
    text: '三號碼頭的照明只剩兩盞還亮著。一個穿著胭脂堂碼頭班制服的男人推著一台手推車經過，車上的紙箱用防水布蓋著，邊角露出一截藍鯨物流的封條。',
    options: [
      { text: '跟上去，看他把箱子送到哪裡。', check: '隱匿・反應・普通', success: { flag: 's:ledger:carrier_asked', counters: { contract: 1 } }, fail: { hostility: 'rouge_hall +3' } },
      { text: '塞錢給他，問箱子裡是什麼。', check: '交涉・魅力・簡單', success: { cash: -200, item: 'pt_ledger_cipher', cashGain: 50000 }, fail: { cash: -200 } },
      { text: '', any: { affinity: '$a −2' } },
    ],
  },
  { id: 'ev_ledger_warehouse', kind: 'event', name: '倉庫的位置', series: 'ledger', text: '第三倉的後門用的是舊式的機械鎖。', options: [{ text: '撬開它。', check: '機械・技術・普通', success: { flag: 's:ledger:warehouse_found' } }], requires: { flags: ['s:ledger:carrier_asked'] } },
  { id: 'ev_ledger_raid', kind: 'event', name: '清空倉庫', series: 'ledger', text: '倉庫裡只剩空的貨架和一台還開著的冷氣。', options: [{ text: '翻一下角落。', success: { flag: 's:ledger:raid_failed' } }], requires: { flags: ['s:ledger:warehouse_found'] } },
  { id: 'npc_dock_runner', kind: 'npc', name: '阿柴', age: 17, district: '舊港', identity: '碼頭的跑腿' },
  { id: 'npc_dock_boss', kind: 'npc', name: '老潘', age: 48, district: '舊港', identity: '胭脂堂的碼頭班班長' },
  { id: 'en_dock_guard', kind: 'enemy', name: '碼頭的保全', grade: 1 },
  { id: 'en_dock_guard', kind: 'enemy', name: '三號碼頭的守衛', grade: 2 },
  { id: 'it_ledger_tape', kind: 'item', name: '帳本的備份帶', grade: 2 },
  { id: 'dock_union', kind: 'counter', name: '碼頭工會', range: [-3, 3], builtin: false },
  { id: 'ledger', kind: 'series', name: '帳本', members: ['偷帳本', '帳本被搬去哪了', 'ev_ledger_dock_carrier', 'ev_ledger_warehouse', 'ev_ledger_raid'] },
  { id: 'fac_pawn', kind: 'facility', name: '當舖', functions: ['收購', '典當', '鑑定'], hours: '10:00～02:00', shop: '雜貨・收購比例 30%', jobs: [] },
  { id: 'fac_clinic', kind: 'facility', name: '診所', functions: ['處理傷口', '裝義體', '拆義體', '調參數'], hours: '24 小時', shop: '藥', jobs: ['護理助手'], builtin: true },
  { id: 'fac_pod', kind: 'facility', name: '潛艙店', functions: ['潛入', '改化身', '換 SKIN', '睡一覺'], hours: '24 小時', shop: 'SKIN', jobs: ['值班'], builtin: true },
  { id: 'fac_police', kind: 'facility', name: '市警分局', functions: ['保釋', '報案', '查登記'], hours: '24 小時', shop: '', jobs: [], builtin: true },
  { id: 'site_oldport_dock_3', kind: 'site', name: '舊港・三號碼頭', district: 'oldport' },
]

/** 基本世界裡有的東西（引用檢查要認得）。 */
export const BUILTIN = {
  items: new Set(['it_c27d44', 'it_6fa4e8', 'it_7eb6ee']),
  counters: new Set(['wall', 'truth', 'hizakura', 'contract']),
  flagsRead: new Set(['s:ledger:lost_known']),
}
/** 劇情計數器的目前值（取自存檔「夜班之後」）。內建的四個也能在世界包裡改範圍。 */
export const COUNTERS = [
  { id: 'wall', name: '粉牆', range: [0, 6], value: 1, builtin: true },
  { id: 'truth', name: '真相', range: [0, 6], value: 2, builtin: true },
  { id: 'hizakura', name: '緋櫻', range: [-3, 3], value: 0, builtin: true },
  { id: 'contract', name: '契約', range: [-3, 3], value: 1, builtin: true },
]
export const LEGEND = { name: '港口的冬天', series: 'legend_harbor', cond: 'wall >= 2 且 truth >= 3' }
