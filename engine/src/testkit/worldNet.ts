// 測試基礎建設：最小的假世界，內海的那幾筆（dev/test-harness.md 第 1 節；dev/work/M3-smoke.md 第 1 點）。接在 world.ts 的 TEST_WORLD 後面，只給測試用，不放進 engine/data。
//
// 每一種只放驗主幹用得到的最少幾筆：
//   甲板    dk_tw_ii（II 級、6 槽，主角與隊友用）、dk_tw_rent（I 級、3 槽，租用與迷宮館新手組發的）
//   構裝    cs_tw_gun（槍）、cs_tw_blade（近戰）、cs_tw_jam（干擾）、cs_tw_guard（防護）、cs_tw_probe（工具）、cs_tw_blade_rent 與 cs_tw_gun_rent（比賽版）
//   道具    it_tw_script（腳本：回填包）、it_tw_chip（迷宮館的籌碼的替身不用，只當 maze_table 的獎品）
//   快駭    qh_tw_zap（一支快駭程式）
//   蕾絲    en_tw_white（白）、en_tw_pink_m（粉雜兵）、en_tw_pink_e（粉精英）、en_tw_gate（閘門守衛：粉蕾絲的首領）——都是野良幫（f_gang，蜂巢的那個勢力）的，一碰就倒
//   區      tw_subnet（一般子網，小一點的密度：9 × 7）
//   設施    nf_tw_office（網內的設施類型：兩層，自己去挖的子網用）
//   委託    類型 t_tw_steal（主面內海、三個階段、帶隔離區）、一件寫好的四階段副本 cm_tw_net（前兩階段現實與內海都可選、第三階段現實、第四階段內海下載而且是隔離區）加三個連動
//   中間人  fx_tw_netbroker（站在市場，另一個人；給 t_tw_steal 與那一件寫好的）；TEST_NET_OFFER 讓他桌上有那一件寫好的
//   戰敗    df_tw_pinned（被釘住：算委託失敗）
//   第二波  潛艙店（塔下 F3：fac_tw_pod，帶 dive）、兩筆去處（net_site：自己去挖的一座子網、一個沒有甲板也進得去的）、迷宮館的小表（maze_rule 與 maze_table：新手組一種、館方發比賽版構裝）
//
// 蕾絲的數字：位階的內海表照 ENEMIES 1.5 節，兵種自己的 mods 把感載壓得很低、防火牆壓低、攻擊壓低，讓一個化身一兩下就把牠打到過載、再打一下倒下（冒煙不測平衡）。

import type { Feature } from '../core/kernel'

type Rec = Record<string, unknown>

export const NET_FACTION = 'f_gang'
export const NET_FIXER = 'fx_tw_netbroker'
export const NET_OFFER_ID = 'of_tw_net'
export const NET_COMMISSION = 'cm_tw_net'
export const NET_REGION = 'tw_subnet'

// ---- 甲板與構裝 ----

const DECKS = [
  { id: 'dk_tw_ii', name: '入門甲板', desc: '測試用的 II 級甲板。', grade: 2, slots: 6, firewall: 12, ram: { max: 2, regen: 1 }, cooling: 1, legal: 'free', price: 2500 },
  { id: 'dk_tw_rent', name: '館方的比賽甲板', desc: '租用的 I 級甲板。', grade: 1, slots: 3, firewall: 9, ram: { max: 1 }, legal: 'free' },
]

const cs = (id: string, cls: string, o: Rec): Rec => ({ id, class: cls, name: id, grade: 1, legal: 'free', ...o })
const CONSTRUCTS = [
  cs('cs_tw_gun', 'weapon', { name: '街頭槍', archetype: 'pistol', type: 'neural', ram: 1 }),
  cs('cs_tw_blade', 'weapon', { name: '光刃', archetype: 'blade', type: 'neural', ram: 1 }),
  cs('cs_tw_jam', 'weapon', { name: '靜電', archetype: 'pistol', type: 'jam', ram: 2 }),
  cs('cs_tw_guard', 'defense', { name: '散熱罩', guard: 2 }),
  cs('cs_tw_probe', 'tool', { name: '探針', ap: 1, ram: 1, target: 'foe', do: [{ op: 'load', amount: 2, type: 'neural' }] }),
  // 館方發的比賽版（迷宮館的新手組只能用這兩件）
  cs('cs_tw_gun_rent', 'weapon', { name: '比賽用的槍', archetype: 'pistol', type: 'neural', ram: 1 }),
  cs('cs_tw_blade_rent', 'weapon', { name: '比賽用的刃', archetype: 'blade', type: 'neural', ram: 1 }),
]

const SCRIPT = {
  id: 'it_tw_script', name: '回填包', desc: '一支腳本：RAM +3。', category: 'misc', grade: 1, size: 0, legal: 'free', tags: ['script'],
  use: { ap: 1, target: 'self', effects: [{ op: 'net.ram', amount: 3, who: 'self' }] },
}
const CHIP = { id: 'it_tw_chip', name: '獎品晶片', desc: '迷宮館的獎品。', category: 'misc', grade: 1, size: 0, legal: 'free' }

const QUICKHACKS = [{ id: 'qh_tw_zap', name: '電擊', desc: '一支快駭程式：對一個敵人造成 3 點感載。', class: 'neural', grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'load', amount: 3, type: 'neural' }] }]

/** 干擾的武器要有三個停用的狀態（netcombat 載入時查）；資料的規則表（battle_status）有同樣三筆，假世界自己帶一份才能單獨載入。 */
const JAM_STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))

// ---- 蕾絲（野良幫的四種，一碰就倒） ----

const lace = (id: string, name: string, rank: string, o: Rec = {}): Rec => ({
  id, name, desc: '測試用的網內敵人。', faction: NET_FACTION, rank, grades: [1, 5], kind: 'lace', color: 'pink',
  position: { prefer: rank === 'boss' ? [3] : [1, 2], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
  constructs: [{ id: `cs_${id}`, class: 'pistol', type: 'neural', ram: 1 }], mods: { load: 0.5, attack: -10, evade: -6 }, defeat: 'df_tw_pinned', ...o,
})
const LACES = [
  lace('en_tw_white', '野良的白蕾絲', 'minion', { color: 'white', position: { prefer: [4] }, ai: { prefer: 'netrunner', focus: 1, flee_below: 0 }, constructs: undefined, defeat: undefined }),
  lace('en_tw_pink_m', '野良的粉蕾絲', 'minion'),
  lace('en_tw_pink_e', '野良的粉蕾絲（精英）', 'elite'),
  // 閘門守衛：粉蕾絲的首領（中間人生成的委託最後一個內海階段的決定性戰鬥是首領，面寫了 lace: pink，所以首領也要有粉的；顏色只有 kind 是 lace 的兵種可以寫）
  lace('en_tw_gate', '野良的閘門守衛', 'boss', { ai: { focus: 1, flee_below: 0, never_flee: true } }),
]

// ---- 區與設施 ----

/** 一般子網，小一點的密度：9 × 7、挖 18～24 步；委託的階段一場遭遇、一個陷阱、一個休息點、沒有巡邏（巡邏撞上就打，會打亂走幾個節點的測試）；自己去挖也只有守閘門的那一場（站一個人也打得贏）。 */
const REGION = {
  id: NET_REGION, name: '小子網', map_kind: 'subnet', size: [9, 7], carve: [18, 24], sight: 3, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { foe: [1, 1], patrol: [0, 0], archive: [1, 1], trap: [0, 1], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
  commission: { foe: [1, 1], patrol: [0, 0], archive: [1, 1], trap: [1, 1], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
}
const FACILITY = { id: 'nf_tw_office', name: '小辦公樓', layers: ['staff', 'core'], controls: 0 }

// ---- 委託 ----

const branch = (id: string, kind: string, entry?: string) => ({ id, kind, ...(entry ? { entry } : {}) })
/** 現實面用 TEST_WORLD 的小房間（tw_room：敞開、走得到每一格；三個入口、一個保全崗、一個目標、一個撤離點）。 */
const meatFace = (o: Rec = {}): Rec => ({ map: 'tw_room', encounter: ['minion', 'minion'], post: 'G1', branches: [branch('assault', 'assault', 'E2')], ...o })
const netFace = (o: Rec = {}): Rec => ({ layer: 'guest', region: NET_REGION, lace: 'pink', encounter: ['minion'], branches: [branch('assault', 'assault')], ...o })

/**
 * 一件寫好的四階段副本（中規模、主面內海）：
 *   1 現實與內海都可選（現實給 tw_badge；內海給 tw_cred）
 *   2 現實與內海都可選
 *   3 只有現實（要拿到目標；給 tw_airgap）
 *   4 只有內海（隔離區：要 tw_airgap；目標下載 2 次）
 * 敵人是野良幫的粉蕾絲（每個內海面都寫 lace: pink）；沒寫 defeat_event，戰敗照蕾絲自己寫的 pinned。
 */
export const CM_NET = {
  id: NET_COMMISSION, name: '四階段的內海副本', kind: 'steal_data', main: 'net', scale: 'medium', grade: 1, target_faction: NET_FACTION, employer: 'f_corp', district: 'tw_hive',
  stages: [
    { name: '外圍', faces: { meat: meatFace({ gives: 'tw_badge' }), net: netFace({ gives: 'tw_cred' }) } },
    { name: '員工層', faces: { meat: meatFace(), net: netFace({ layer: 'staff' }) } },
    { name: '現實的資料埠', faces: { meat: meatFace({ goal: { kind: 'take', at: 'T1' }, gives: 'tw_airgap' }) } },
    { name: '隔離區', faces: { net: netFace({ layer: 'core', encounter: ['minion'], locked_by: 'tw_airgap', objective: { kind: 'download', turns: 2 } }) } },
  ],
  links: {
    tw_badge: { type: 'skip', name: '員工證', effect: { stage: 2, encounter_half: true } },
    tw_cred: { type: 'open', name: '員工憑證', effect: { stage: 2, trace_start: -5, lace_down: true } },
    tw_airgap: { type: 'open', name: '資料埠', effect: { stage: 4, gate_open: true } },
  },
}

/** 一種類型（竊密：主面內海）：三個階段；前兩個階段現實與內海都可選，最後一個只有內海；有隔離區。 */
const TYPE_STEAL = {
  id: 't_tw_steal', name: '竊密', main: 'net', decisive: { kind: 'fight' },
  stages: [
    { name: '拿到入口', faces: ['meat', 'net'] },
    { name: '往下一層', faces: ['net', 'meat'] },
    { name: '下載', faces: ['net'] },
  ],
  extra: [{ name: '多一層子網', faces: ['net', 'meat'] }, { name: '中途出了狀況', faces: ['net', 'meat'] }],
  branches: { stealth: 'stealth' },
  brief: '{faction}在{district}的{place}裡有一份資料，{fixer}要它。',
  gives: { net: ['lk_tw_cred'], meat: ['lk_tw_airgap', 'lk_tw_badge'] },
  net: { objectives: ['download'], airgap: 1, lace: 'pink' },
}
const NET_LINKS = [
  { id: 'lk_tw_cred', name: '員工憑證', from: 'net', to: 'net', type: 'ease', effect: { encounter_half: true } },
  { id: 'lk_tw_badge', name: '員工證', from: 'meat', to: 'meat', type: 'skip', effect: { encounter_half: true } },
  { id: 'lk_tw_airgap', name: '資料埠', from: 'meat', to: 'net', type: 'open' },
]

const DEFEAT_PINNED = {
  id: 'df_tw_pinned', name: '被釘在線上', kind: 'pinned', factions: [], fails_commission: true,
  versions: { default: { text: '你被釘在一條放不完的等候音樂上，醒來時人已經在別人的機房。', stages: [{ options: [{ id: 'wait', text: '等著。', outcomes: { any: [] } }] }] } },
}

// ---- 第二波：潛艙店、去處、迷宮館 ----

/** 塔下的 F3：一間潛艙店（帶 dive：費用 30、租 I 級甲板、押金 50、安全 1）。 */
export const FACILITY_POD = { id: 'fac_tw_pod', name: '潛艙店', functions: ['dive'], dive: { fee: 30, rental: 'dk_tw_rent', deposit: 50, safe: 1 } }

/** 兩筆去處：自己去挖的一座子網（要有自己的甲板或租的）、一座沒有甲板也進得去的（訪客）。 */
export const NET_SITES = [
  { id: 'ns_tw_dig', name: '蜂巢的辦公樓', kind: 'netrun', need: 'rental', desc: '一座等著被挖的子網。', setup: { entry: 'dig', site: 'tw_site_a', region: NET_REGION, grade: 1, faction: NET_FACTION, facility: 'nf_tw_office', encounter: ['minion'] } },
  { id: 'ns_tw_guest', name: '訪客的小子網', kind: 'netrun', need: 'any', desc: '訪客也進得去的子網。', setup: { entry: 'dig', site: 'tw_site_b', region: NET_REGION, grade: 1, faction: NET_FACTION, facility: 'nf_tw_office', encounter: ['minion'] } },
]

/**
 * 迷宮館的小表：只有新手組（館方發 dk_tw_rent 與比賽版構裝、押金 50、獎金 300）；每層只有守閘門的那一場遭遇；寶箱表與獎品表各一列、固定給籌碼；層數、標準回合數與評價照內建的預設。
 * 規則表（maze_rule）通常不放進假世界；這一份是為了新手組能用假世界的構裝（資料的 kit 是空的）。
 */
export const MAZE_RULE = {
  id: 'default',
  brackets: {
    rookie: { name: '新手組', grades: [{ grade: 1, deposit: 50, prize: 300 }], own: false, max_grade: 1, deck: 'dk_tw_rent', kit: ['cs_tw_gun_rent', 'cs_tw_blade_rent'], guard: ['minion'] },
  },
  faction: NET_FACTION, mimic: 0, chest_table: 'mzt_tw_chest', prize_table: 'mzt_tw_prize',
  // 每層只有守閘門的那一場（一個人也打得贏）；機關一個、寶箱一兩個
  region: { layer: { foe: [1, 1], patrol: [0, 0], archive: [1, 1], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] } },
}
export const MAZE_TABLES = [
  { id: 'mzt_tw_chest', kind: 'chest', rows: [{ weight: 1, name: '比賽籌碼', chips: [3, 3] }] },
  { id: 'mzt_tw_prize', kind: 'prize', rows: [{ weight: 1, name: '三十枚籌碼', chips: 30 }] },
]

// ---- 整包（world.ts 的 testWorld 併進去） ----

/** 內海的幾筆（內容種類 → 一串）。world.ts 把它併進 TEST_WORLD；沒有人定義的種類由 worldFor 濾掉。 */
export function netContent(): Record<string, unknown[]> {
  return {
    deck: DECKS, construct: CONSTRUCTS, quickhack: QUICKHACKS, enemy: LACES, battle_status: JAM_STATUSES,
    net_region: [REGION], net_facility: [FACILITY],
    commission_type: [TYPE_STEAL], commission_link: NET_LINKS, commission: [CM_NET], defeat_event: [DEFEAT_PINNED],
    net_site: NET_SITES, maze_table: MAZE_TABLES,
    // 規則表：只有迷宮館這一份（理由見 MAZE_RULE）
    maze_rule: [MAZE_RULE],
    item: [SCRIPT, CHIP],
    fixer: [{ id: NET_FIXER, name: '網咖的掮客', npc: 'npc_tw_netbroker', district: 'tw_hive', block: 'tw_market', kinds: ['t_tw_steal'], cut: 0.1 }],
    npc: [{ id: 'npc_tw_netbroker', name: '掮客阿網', kind: 'citizen', age: 33, gender: 'male', guard: 15, wealth: 3, haunts: [{ district: 'tw_hive', block: 'tw_market' }] }],
    facility_type: [FACILITY_POD],
  }
}

/**
 * 讓中間人 fx_tw_netbroker 桌上多一件「寫好的」四階段副本（特殊任務的替身；回答 fixer.offers）：只回答那位中間人，其他人的桌面照舊。
 * 這是 testkit 的功能，不是假世界的內容；拿掉 fixer 時掛鉤沒人問，照樣載得起來。
 */
export const TEST_NET_OFFER: Feature = {
  id: 'test_net_offer',
  install(k) {
    k.hooks.on('fixer.offers', 'test_net_offer', ({ fixer }) => {
      if ((fixer as { id?: string }).id !== NET_FIXER) return []
      const def = k.content.get<typeof CM_NET>('commission', NET_COMMISSION)
      if (!def) return []
      return [{
        id: NET_OFFER_ID, commission: structuredClone(def), title: '四階段的內海委託', brief: '野良幫在蜂巢的辦公室裡有一份資料，掮客要它。',
        reward: 600, unknowns: [], min_rep: 0,
      }]
    })
  },
}
