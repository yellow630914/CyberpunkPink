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
/** 潛艙店租給沒有甲板的客人的甲板 */
export const DIVE_RENTAL = 'dk_pod_rent'

const deck: Rec[] = [
  { id: DIVE_RENTAL, name: '潛艙店的租用甲板', desc: '潛艙店租給沒有甲板的客人：兩個構裝槽，防火牆 8。登出時要還，押金在那時候退。', grade: 1, slots: 2, firewall: 8, brand: '浮標', legal: 'free', price: 600 },
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

/**
 * 設施種類：潛艙店（CYBERSPACE 第 2 節：街上的付費隔間；示意包的潛艙店賣腳本，甲板與構裝的店是內容，等匯入）。
 * M3-ui-dive：帶 dive（每次潛入的費用、租給沒有甲板的人的甲板、押金、安全程度）；functions 有 dive 的才讀（features/dive）。數字是示意的。
 */
const facility_type: Rec[] = [{ id: 'fac_dive', name: '潛艙店', functions: ['dive'], dive: { fee: 40, rental: DIVE_RENTAL, deposit: 120, safe: 1 } }]
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

// ---- 去處與迷宮館（M3-ui-dive；dev/work/M3-ui-dive.md 第 6 項） ----

/** 自己去挖的子網的去處：蜂巢的企業（藍鯨物流是這一區委託的目標勢力）。租來的甲板也能去（need: rental）；同一個 site 七天內再進去是同一張圖。 */
export const DIG_SITE = 'site_dig_lonestar'
const net_site: Rec[] = [
  { id: DIG_SITE, name: '藍鯨物流的外圍網', kind: 'netrun', need: 'rental', desc: '自己去挖的子網：離開時追蹤度會化成那家企業對你的敵對值；七天內再進來是同一張圖。', setup: { region: 'subnet', entry: 'dig', site: 'dig_lonestar_1', grade: 2, faction: 'lonestar' } },
]
/** 設施類型與詞條（CYBERSPACE 8.3 節的表：層的名字、隔離區從幾級起、每層幾個控制節點）：示意用的兩種 */
const net_facility: Rec[] = [
  { id: 'nf_depot', name: '倉儲', layers: ['staff', 'core'], controls: 0 },
  { id: 'nf_lab', name: '研發', layers: ['guest', 'staff', 'control', 'core'], airgap_at: 4, controls: 1 },
]
const net_affix: Rec[] = [
  { id: 'af_shift', name: '換班中', region: 'subnet', fx: { foe_minus: 1 } },
  { id: 'af_quiet', name: '寂靜的巡邏', region: 'subnet', fx: { no_patrol: true } },
]

/**
 * 迷宮館（CYBERSPACE 8.2 節）：遊戲敵人、比賽甲板與比賽版構裝（新手組一律用館方發的）、寶箱表與獎品表、規則表（只寫要改的：兩組的比賽版）。
 * 其餘（押金、獎金、標準回合數、評價）用引擎的預設。迷宮館不是 net_site：報名是 maze 自己的入口（brackets、enter）。
 */
const program = (id: string, rank: string): Rec => ({
  id, name: { mz_slime: '遊戲敵人「史萊姆」', mz_knight: '遊戲敵人「騎士」', mz_king: '遊戲敵人「館主」' }[id], desc: '迷宮館的遊戲敵人：打倒不會死，只是被送回回復室。', faction: 'maze', rank, grades: [1, 5], kind: 'program',
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
const maze_extra: Rec = {
  faction: [{ id: 'maze', name: '迷宮館', short: '館', class: 'corp' }],
  enemy: [program('mz_slime', 'minion'), program('mz_knight', 'elite'), program('mz_king', 'boss')],
  deck: [{ id: 'dk_maze_rent', name: '迷宮館的比賽甲板', desc: '館方發的比賽用甲板：兩個構裝槽。破關或被送回回復室時收回。', grade: 1, slots: 2, firewall: 10, brand: '迷宮館', legal: 'free' }],
  construct: [{ id: 'cs_maze_kit', class: 'weapon', name: '比賽版構裝「木劍」', desc: '迷宮館發的比賽版：什麼組別都能用。', grade: 1, brand: '迷宮館', ram: 1, type: 'neural', archetype: 'pistol', legal: 'free' }],
  item: [{ id: 'it_maze_pin', name: '館主的紀念徽章', desc: '迷宮館的獎品室發的：破關的證明。', category: 'misc', grade: 2, size: 0, legal: 'free', price: 300 }],
  maze_table: [
    { id: 'mz_chest', kind: 'chest', rows: [{ weight: 3, name: '比賽籌碼', chips: [3, 8] }, { weight: 1, name: '神祕的寶箱', prize: true }] },
    { id: 'mz_prize', kind: 'prize', rows: [{ weight: 2, name: '紀念徽章', give: [{ kind: 'item', id: 'it_maze_pin', qty: 1 }] }, { weight: 1, name: '三十枚籌碼', chips: 30 }] },
  ],
  maze_rule: [{ id: 'default', brackets: { rookie: { deck: 'dk_maze_rent', kit: ['cs_maze_kit'] }, open: { kit: ['cs_maze_kit'] } }, chest_table: 'mz_chest', prize_table: 'mz_prize' }],
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

export function netContent(): Record<string, ContentEntry[]> {
  const at = divepodAt()
  const shop: Rec[] = [{ id: DIVE_SHOP, type: 'demo_divepod', name: '潛艙店「浮標」', district: at.district, block: at.block, facility: at.marker }]
  return {
    deck: [...deck, ...(maze_extra.deck as Rec[])], construct: [...construct, ...(maze_extra.construct as Rec[])], skin, item: [...item, ...(maze_extra.item as Rec[])],
    enemy: [...enemy, ...(maze_extra.enemy as Rec[])], net_region, facility_type, shop_type, shop, net_site, net_facility, net_affix,
    faction: maze_extra.faction, maze_table: maze_extra.maze_table, maze_rule: maze_extra.maze_rule,
  } as unknown as Record<string, ContentEntry[]>
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
