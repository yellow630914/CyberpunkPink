import type { Change, ContentEntry } from '@engine/src'
import { DISTRICTS, blockSpec } from '../districts'
import { blockIdOf, markerOfFacility } from './world'

/**
 * 示意世界包的「內海」部分（M3-ui-deck；dev/adr/0018 第三節、dev/work/M3-deck.md 的格式）：
 * 一副 II 級的入門甲板、三個武器構裝（步槍、近戰、干擾各一）、兩個防護、兩個工具（一個被動）、一支腳本、兩套 SKIN，
 * 與開新局時送給主角並裝好的那份變更（`demoNetChanges`）。名字照 ITEMS 11 節的示意，數字是示意的。
 * 整份是資料：沒有任何規則（槽數、能不能裝、防護取哪一個都是引擎 features/deck 的）。
 * 構裝與 SKIN 的 id 沿用舊資料（`data/items2.ts`）的，畫面查得到圖標與染色；其餘新的。正式內容匯入之後整包換掉。
 * 不放進 engine/data。測試不用它（測試自帶最小假資料）。
 */
type Rec = Record<string, unknown>

/** 開局送的甲板在背包裡的編號（`actor.ext.deck.uid` 指向它） */
export const DEMO_DECK_UID = 'D_START'
export const DEMO_DECK = 'dk_nightingale_2'
export const DEMO_SCRIPT = 'it_script_refill'

const deck: Rec[] = [
  { id: DEMO_DECK, name: '夜鶯入門甲板 II', desc: '夜鶯的入門款：四個構裝槽，防火牆 12，記憶體稍微加寬。便宜、耐用、很多人的第一副甲板。', grade: 2, slots: 4, firewall: 12, ram: { max: 2, regen: 1 }, cooling: 1, brand: '夜鶯', legal: 'free', price: 2500 },
]

const weapon = (id: string, name: string, grade: number, o: Rec): Rec => ({ id, class: 'weapon', name, grade, brand: '夜鶯', ram: 1, type: 'neural', ...o })
const construct: Rec[] = [
  weapon('cs_night_rifle', '構裝「夜巡」III', 3, { desc: '步槍原型：穿透防護，近身扣命中。', archetype: 'rifle', legal: 'banned', price: 1800 }),
  weapon('cs_blade2', '構裝「光刃」II', 2, { desc: '近戰原型：只能打近身，無聲。', archetype: 'melee', legal: 'permit', price: 460 }),
  weapon('cs_static2', '構裝「靜電」II', 2, { desc: '干擾：命中時目標一類構裝停用一回合。', archetype: 'pistol', type: 'jam', ram: 2, brand: '織女', legal: 'permit', price: 520 }),
  { id: 'cs_window1', class: 'defense', name: '構裝「客服窗」I', grade: 1, brand: '夜鶯', guard: 2, legal: 'free', price: 230, desc: '穩，沒有懲罰。' },
  { id: 'cs_cool2', class: 'defense', name: '構裝「散熱罩」II', grade: 2, brand: '織女', guard: 3, legal: 'free', price: 450, desc: '防護 3；同時只有最高的那一件算數。' },
  { id: 'cs_probe2', class: 'tool', name: '構裝「探針」II', grade: 2, brand: '夜鶯', ap: 1, ram: 1, target: 'foe', do: [{ op: 'status', status: 'marked' }], legal: 'free', price: 520, desc: '標記一個敵人：打他的命中 +2。' },
  { id: 'cs_refill2', class: 'tool', name: '構裝「回填器」II', grade: 2, brand: '夜鶯', ap: 0, ram: 0, passive: true, mods: { ap_regen: 1 }, legal: 'free', price: 650, desc: '被動：裝著就有效，每回合多回 1 點行動點。佔一個構裝槽。' },
]

const skin: Rec[] = [
  { id: 'it_64cfe6', name: '預設化身', style: '街頭', style_value: 1, exposure: 0, cut: 'neutral', adult: false, price: 0 },
  { id: 'it_d212f6', name: '應援 T', style: '偶像', style_value: 2, exposure: 0, cut: 'neutral', adult: false, price: 130 },
]


// ---- 委託的內海面要的（M3-ui-commission-net；dev/work/M3-plan.md 第 15 題） ----

/** 蕾絲掛在哪些勢力下面：示意包裡有內海委託的區（蜂巢、四十二番街）的勢力 */
export const NET_FACTIONS = ['lonestar', 'strippers', 'guard'] as const

/** 目標勢力的四種蕾絲：白（雜兵）、粉雜兵、粉精英、閘門守衛（粉・首領）。數字是引擎照位階算的，這裡只有名字與位置偏好 */
const lace = (faction: string, rank: 'minion' | 'elite' | 'boss', color: 'white' | 'pink', name: string, desc: string): Rec => ({
  id: `en_net_${faction}_${rank}_${color}`, name, desc, faction, rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: color === 'white' ? [4] : [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
const enemy: Rec[] = NET_FACTIONS.flatMap((f) => [
  lace(f, 'minion', 'white', '白蕾絲「訪客」', '訪客網的接待員。不打人，追蹤度高了它就把你的位置報上去。'),
  lace(f, 'minion', 'pink', '粉蕾絲「侍者」', '會黏人的粉紅色小東西，沒有生命，只有防火牆與記憶體。'),
  lace(f, 'elite', 'pink', '粉蕾絲「領班」', '帶著一組腳本的領班，打它要花更多記憶體。'),
  lace(f, 'boss', 'pink', '閘門守衛', '守在閘門前的大傢伙：不打倒它，閘門就不開。'),
])

/** 子網的區：示意用的一般子網（蓋掉引擎內建的 subnet；委託的階段用 commission 那一組密度） */
const net_region: Rec[] = [{
  id: 'subnet', name: '一般子網（示意）', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { foe: [2, 3], patrol: [1, 1], archive: [1, 2], trap: [1, 2], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
  commission: { foe: [1, 1], patrol: [1, 1], archive: [0, 0], trap: [1, 2], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
}]

/** 設施種類：潛艙店（CYBERSPACE 第 2 節：街上的付費隔間；示意包的潛艙店賣腳本，甲板與構裝的店是內容，等匯入） */
const facility_type: Rec[] = [{ id: 'fac_dive', name: '潛艙店' }]
export const DIVE_SHOP = 'divepod'
const shop_type: Rec[] = [{ id: 'demo_divepod', name: '潛艙店', catalog: ['stock_divepod'], buys: ['stock_divepod'], grade_max: 3, cash: true, scan_registered: false, shop_mult: 1, temper: 0 }]
/** 潛艙店在示意包的哪一塊街區的哪個設施（舊資料的設施 id 是 divepod；找不到會丟錯） */
function divepodAt(): { district: string; block: string; marker: string } {
  for (const d of DISTRICTS) for (const name of d.blocks) {
    if (!blockSpec(d.id, name).facilities.some((f) => f.id === DIVE_SHOP)) continue
    const block = blockIdOf(d.id, name)
    const marker = markerOfFacility(block, DIVE_SHOP)
    if (marker) return { district: d.id, block, marker }
  }
  throw new Error('示意包：找不到潛艙店。')
}

const item: Rec[] = [
  {
    id: DEMO_SCRIPT, name: '腳本「回填包」II', desc: 'RAM 立刻回 3 點，不超過上限。一次性，存在甲板裡。', category: 'consumable', grade: 2, size: 0, legal: 'free', price: 90, tags: ['script', 'stock_divepod'], trade_category: 'electronics',
    use: { ap: 1, target: 'self', effects: [{ op: 'net.ram', amount: 3, who: 'self' }] },
  },
  {
    id: 'it_script_refill1', name: '腳本「回填包」I', desc: 'RAM 立刻回 2 點，不超過上限。一次性，存在甲板裡。', category: 'consumable', grade: 1, size: 0, legal: 'free', price: 40, tags: ['script', 'stock_divepod'], trade_category: 'electronics',
    use: { ap: 1, target: 'self', effects: [{ op: 'net.ram', amount: 2, who: 'self' }] },
  },
]

// 干擾武器要規則表裡有三個停用的狀態（正式的由 M3-data-rules 寫；規則表是可以被取代的內容，之後載入的同 id 會蓋掉這一份）
const battle_status: Rec[] = (['weapon', 'defense', 'tool'] as const).map((s) => ({
  id: `jam_${s}`, name: `${{ weapon: '武器', defense: '防護', tool: '工具' }[s]}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff',
}))

export function netContent(): Record<string, ContentEntry[]> {
  const at = divepodAt()
  const shop: Rec[] = [{ id: DIVE_SHOP, type: 'demo_divepod', name: '潛艙店「浮標」', district: at.district, block: at.block, facility: at.marker }]
  return { deck, construct, skin, item, battle_status, enemy, net_region, facility_type, shop_type, shop } as unknown as Record<string, ContentEntry[]>
}

/**
 * 開新局時送給主角的：一副甲板、各種構裝、兩套 SKIN、兩支腳本；裝好甲板、三個構裝（夜巡、客服窗、探針，留一個空槽）、
 * 穿著應援 T、帶著回填包。只給有主角的局（建角的開新局），跟在建角的報告後面。
 */
export function demoNetChanges(pc = 'pc'): Change[] {
  const give = (id: string, qty = 1, data?: Rec): Change => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as unknown as Change
  return [
    give(DEMO_DECK, 1, { uid: DEMO_DECK_UID }),
    ...construct.map((c) => give(c.id as string)),
    ...skin.map((s) => give(s.id as string)),
    give(DEMO_SCRIPT, 2),
    { op: 'actor.ext', id: pc, key: 'deck', value: { uid: DEMO_DECK_UID, slots: ['cs_night_rifle', 'cs_window1', 'cs_probe2'], skin: 'it_d212f6', scripts: [{ item: DEMO_SCRIPT, qty: 2 }] } } as unknown as Change,
  ]
}
