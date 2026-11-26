// 測試基礎建設：最小的假世界 TEST_WORLD（dev/test-harness.md 第 1 節；dev/work/M2-smoke.md 第 1 點）。只給測試用，不放進 engine/data。
//
// 一包內容，每一種只放「驗主幹用得到的最少幾筆」，帶著 allFeatures() 載入、不查外部資料：
//   區      tw_hive（蜂巢，等級 1）、tw_rust（鏽帶，等級 2、走一格 2 分鐘）
//   街區    tw_market（市場）、tw_tower（塔下）、tw_yard（院子），加一塊橋接區 tw_gate（閘門）；用出口接成一條線
//             市場 ─E2/E1─ 塔下 ─E2/E1─ 閘門 ─E2/E1─ 院子
//   設施    市場 F1 商行的門面（shop）、F2 碼頭（dock，打工）、F3 市場站（station）；塔下 F1 住處（home）、F2 塔下站；院子 F1 院子站
//   路線    tw_metro：市場站 → 塔下站 → 院子站（三站）
//   店      s_tw_stall（市場 F1；店主 npc_tw_vendor、後台勢力 f_corp），賣六樣東西（i_tw_*）
//   工作    j_tw_porter（碼頭；兩階段：搬貨、領班）
//   住處    r_tw_unit（塔下 F1，一級、週租 100）
//   勢力    f_corp、f_gang
//   NPC     npc_tw_vendor（街坊、店主與雇主）、npc_tw_friend（街坊）、npc_tw_fixer（中間人本人）；蜂巢一條生成規則 ng_tw_hive
//   中間人  fx_tw_broker（站在市場；做 t_tw_hit 這一類）
//   委託    類型 t_tw_hit（暗殺：三階段，現實面）加兩個連動，一件寫好的三階段副本 cm_tw_office（DATA 9.3 的小辦公室）
//   敵人    en_tw_mook、en_tw_elite、en_tw_boss（f_gang 的三個假兵種：一碰就倒）
//   事件    ev_tw_street（帶檢定的街頭事件）、ev_tw_scene（選項帶成人場景）；兩件都要旗標 tw_street_a／tw_street_b 才會被導演挑到（平常不打擾主幹）
//   戰敗    df_tw_generic（通用）、df_tw_pow（兩段，副本自訂、算委託失敗）
//   場景    三個基本體位（pos_tw_face、pos_tw_behind、pos_tw_lie）
//   其他    skill、weapon_class、item、shop_type、facility_type、name_pool、tendency_tag、event_scope
//
// 規則表（*_rule）一律不放：每個功能自己帶一份預設（DEFAULT_…），測試與真正的資料（engine/data 的規則表）的對照在 tests/data/M2-data-rules.test.ts。
// 拿掉某個功能時，用 worldFor(features) 把「那個功能的內容種類」濾掉（見下面）。

import type { ContentEntry, ContentPack } from '../core/content/registry'
import { ContentError } from '../core/content/registry'
import type { Feature } from '../core/kernel'
import { createKernel, readyFeatures } from '../core/kernel'
import { testWeapon } from './battle'
import { netContent } from './worldNet'

type Rec = Record<string, unknown>

// ---- 地圖 ----

/** 一塊街區的版面：14 × 5，E1 在西、E2 在東，設施標記 F1.. 排在 y=1。 */
function street(id: string, name: string, facilities: Array<[string, string]>): Rec {
  const row: string[] = Array.from({ length: 14 }, (_, x) => (x === 0 || x === 13 ? '#' : '.'))
  const xs = [1, 4, 7, 10]
  facilities.forEach((_, i) => { row[xs[i]!] = 'F' })
  return {
    id: `m_${id}`, kind: 'street', size: [14, 5],
    sheets: [{
      id: 'street', name, size: [14, 5],
      layout: ['##############', row.join(''), 'E.1........2.E', '#............#', '##############'],
      cells: [
        ...facilities.map(([mark, label], i) => ({ id: mark, at: [xs[i]!, 1], mark: 'F', name: label })),
        { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' },
      ],
      spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
    }],
  }
}

/** DATA 9.3 節的小辦公室（和委託副本的測試同一張）：E1 窗、E2 後門、E3 正門；T3 檔案間、X1 後門撤離點、G1 主管室門口。 */
const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '主管室的控制面板' },
    { id: '$1', at: [3, 5], mark: '$', name: '檔案間的小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [
    { id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] },
    { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] },
  ],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}

/** 一間敞開的小房間（9×5，三個入口、一個保全崗、一個目標點、一個撤離點）：照類型生成的委託用它，走得到每一格。 */
const ROOM = {
  id: 'room', name: '密談的小房間', size: [9, 5],
  layout: ['####E####', '#..1.G..#', 'E...T...E', '#..2....#', '###X#####'],
  zones: ['####a####', '#aaaaaaa#', 'aaaaaaaaa', '#aaaaaaa#', '###a#####'],
  cells: [
    { id: 'E1', at: [4, 0], mark: 'E', kind: 'front', name: '北門' }, { id: 'E2', at: [0, 2], mark: 'E', kind: 'back', name: '西門' }, { id: 'E3', at: [8, 2], mark: 'E', kind: 'side', name: '東門' },
    { id: 'G1', at: [5, 1], mark: 'G', name: '守衛的位置' }, { id: 'T1', at: [4, 2], mark: 'T', name: '目標' }, { id: 'X1', at: [3, 4], mark: 'X', name: '撤離點' },
  ],
  spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [3, 3], cover: 'medium' }],
}

// ---- 基本資料 ----

const SKILLS = [
  { id: 'firearms', attr: 'reflex' }, { id: 'brawl', attr: 'body' }, { id: 'composure', attr: 'resolve' }, { id: 'stealth', attr: 'reflex' }, { id: 'negotiate', attr: 'charm' },
  { id: 'seduce', attr: 'charm' }, { id: 'perform', attr: 'charm' }, { id: 'mechanics', attr: 'tech' }, { id: 'interface', attr: 'intellect' }, { id: 'athletics', attr: 'body' },
  { id: 'investigate', attr: 'intellect' }, { id: 'streetwise', attr: 'intellect' },
].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))

const WEAPON_CLASSES = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  // 內海的近戰構裝用（M3）
  { id: 'blade', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
]

const FACTIONS = [
  { id: 'f_corp', name: '緋櫻重工', short: '緋櫻', class: 'corp' },
  { id: 'f_gang', name: '野良幫', short: '野良', class: 'street' },
]

const item = (id: string, name: string, more: Rec): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS = [
  item('i_tw_pistol', '街頭手槍', { category: 'weapon', grade: 2, price: 100 }),
  item('i_tw_vest', '防刺背心', { category: 'armor', grade: 2, price: 200 }),
  item('i_tw_medkit', '急救包', { category: 'consumable', price: 50, tags: ['medical'] }),
  item('i_tw_ration', '罐頭', { category: 'consumable', price: 10, tags: ['food'] }),
  item('i_tw_scrap', '舊零件', { category: 'consumable', price: 20, no_sell: true }),
  item('i_tw_charm', '護身符', { category: 'misc', price: 30 }),
]

// ---- 敵人（f_gang 的三個假兵種：生命減半、迴避與攻擊壓低，打得贏） ----

const enemy = (id: string, rank: string): Rec => ({
  id, name: `野良的${rank}`, desc: '測試用的敵人。', faction: 'f_gang', rank, grades: [1, 5], kind: 'human', mods: { hp: 0.5, evade: -30, attack: -8 },
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 },
})
const ENEMIES = [enemy('en_tw_mook', 'minion'), enemy('en_tw_elite', 'elite'), enemy('en_tw_boss', 'boss')]

// ---- 委託 ----

const branch = (id: string, kind: string, entry: string, need?: Rec) => ({ id, kind, entry, ...(need ? { need } : {}) })

/** 一件寫好的三階段副本（小規模，用小辦公室）：強攻永遠有；第一階段另有潛行；最後一個階段要拿到東西、帶到撤離點。戰敗事件是 df_tw_pow（算失敗）。 */
export const CM_OFFICE = {
  id: 'cm_tw_office', name: '辦公室的副本', kind: 'steal_item', main: 'meat', scale: 'small', grade: 1, target_faction: 'f_gang', employer: 'f_corp', district: 'tw_hive',
  defeat_event: 'df_tw_pow',
  stages: [
    {
      name: '外圍',
      faces: { meat: { map: 'tw_office', encounter: ['minion', 'minion', 'elite'], post: 'G1', branches: [branch('assault', 'assault', 'E3'), branch('duct', 'stealth', 'E1', { basic: 'stealth', level: 2 })] } },
    },
    { name: '中段', faces: { meat: { map: 'tw_office', encounter: ['minion', 'minion', 'elite'], post: 'G1', branches: [branch('assault', 'assault', 'E3')] } } },
    {
      name: '決定性的一步',
      faces: { meat: { map: 'tw_office', encounter: ['boss', 'minion', 'minion'], post: 'G1', goal: { kind: 'take', at: 'T3' }, branches: [branch('assault', 'assault', 'E2')] } },
    },
  ],
  links: {},
}

/** 一種類型（暗殺）：三個階段都有現實面；地圖用 fits 含它的 tw_room。 */
const TYPE_HIT = {
  id: 't_tw_hit', name: '暗殺', main: 'meat', decisive: { kind: 'take', at: 'T' },
  stages: [
    { name: '找到他', faces: ['meat'] },
    { name: '靠近他', faces: ['meat'] },
    { name: '動手', faces: ['meat'] },
  ],
  extra: [{ name: '他的護衛', faces: ['meat'] }, { name: '最後一道門', faces: ['meat'] }],
  branches: { stealth: 'stealth', talk: 'negotiate' },
  brief: '替{fixer}處理{faction}在{district}的一個人，地點在{place}。',
  gives: { meat: ['lk_tw_key', 'lk_tw_tip'] },
}

/** 兩個連動（照類型生成的委託要接得上至少兩個）：前面階段拿到的門禁卡開路、打聽到的班表讓後面的遭遇少一半。 */
const LINKS = [
  { id: 'lk_tw_key', name: '門禁卡', from: 'meat', to: 'meat', type: 'open' },
  { id: 'lk_tw_tip', name: '打聽到的班表', from: 'meat', to: 'meat', type: 'ease', effect: { encounter_half: true } },
]

// ---- 事件與戰敗事件 ----

const opt = (id: string, text: string, o: Rec = {}): Rec => ({ id, text, outcomes: { any: [] }, ...o })

/** 事件做完把自己的旗標收回（旗標是測試用來「要它發生才發生」的開關；不收回的話走幾步就又來一次）。 */
const clear = (key: string): Rec => ({ kind: 'flag', key, value: false })

/** 帶檢定的街頭事件（要旗標 tw_street_a，走路時觸發）：談一談（交涉對 DC 8）大成功 +100、成功 +50、失敗 −5、大失敗 −20（只用核心的效果：拿掉別的功能這件事照樣載得起來）；走開記一個旗標。 */
export const EV_STREET = {
  id: 'ev_tw_street', scope: 'street', triggers: ['walk'], category: 'opportunity', requires: { kind: 'flag', key: 'tw_street_a' },
  text: '一個攤販攔住你，說他有個消息要賣。',
  options: [
    opt('talk', '談一談。', {
      check: ['negotiate', 'charm', 8],
      outcomes: { critical: [{ kind: 'cash', amount: 100 }, clear('tw_street_a')], success: [{ kind: 'cash', amount: 50 }, clear('tw_street_a')], fail: [{ kind: 'cash', amount: -5 }, clear('tw_street_a')], fumble: [{ kind: 'cash', amount: -20 }, clear('tw_street_a')] },
    }),
    opt('leave', '走開。', { outcomes: { any: [{ kind: 'flag', key: 'tw_street_left', value: true }, clear('tw_street_a')] } }),
  ],
}

/** 選項帶成人場景的事件（要旗標 tw_street_b，走進街區或橋接區時觸發）：和這一區的人搭話，進場景。登場角色是臨時生成的路人。 */
export const EV_SCENE = {
  id: 'ev_tw_scene', scope: 'street', triggers: ['enter_block', 'enter_bridge'], category: 'desire', adult: true, requires: { kind: 'flag', key: 'tw_street_b' },
  text: '巷口有個熟客在等你。', cast: [{ role: 'a', gen: { kind: 'citizen', name: '熟客' } }],
  options: [
    opt('go', '跟他走。', { outcomes: { any: [clear('tw_street_b')] }, adult_scene: { when: 'always', gate: 'fixed', nature: 'mutual', role: 'none', goal: 'please', circles: [['$pc', '$a']] } }),
    opt('no', '不去。', { outcomes: { any: [clear('tw_street_b')] } }),
  ],
}

const df = (id: string, o: Rec): Rec => ({ id, name: id, kind: 'generic', factions: [], fails_commission: false, ...o })
const DEFEAT_EVENTS = [
  df('df_tw_generic', { default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', stages: [{ options: [opt('ok', '爬起來。')] }] } } }),
  df('df_tw_pow', {
    name: '被帶走', kind: 'pow', fails_commission: true,
    versions: { default: { text: '你被帶進了一間沒有窗的房間。', stages: [{ options: [opt('wait', '等著。'), opt('beg', '求饒。')] }, { text: '過了幾個小時，門開了。', options: [opt('out', '被放出來。', { outcomes: { any: [{ kind: 'cash', amount: -20 }] } })] }] } },
  }),
]

// ---- 場景的體位 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const POSITIONS = [
  {
    id: 'pos_tw_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1.5 }, initiative_drift: 3, tags: [], unlocked_by: null, text: '兩個人面對面。',
    links: [{ from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'front'], to: ['b', 'front'] }],
  },
  {
    id: 'pos_tw_behind', name: '從後面', people: 2, roles, mult: { a: 1, b: 1.25 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'front'], to: ['b', 'back'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'back'] }],
  },
  {
    id: 'pos_tw_lie', name: '並躺', people: 2, roles: [{ id: 'a', upper: false }, { id: 'b', upper: false }], mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'hand_l'], to: ['b', 'hand_l'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }],
  },
]

// ---- 整包 ----

/**
 * 最小的假世界。每個內容種類都是某一個功能的；沒有裝那個功能就載不進來，用 worldFor(features) 濾掉。
 * 主幹會碰到的東西都在這裡，其餘不放。回傳的是新的物件（呼叫的人可以改，不會動到下一次拿到的）。
 */
export function testWorld(): ContentPack {
  const pack = structuredClone({
    id: 'test_world',
    content: {
      // 核心與共用
      skill: SKILLS, weapon_class: WEAPON_CLASSES, faction: FACTIONS, item: ITEMS,
      special_map: [
        street('tw_market', '市場', [['F1', '商行的門面'], ['F2', '碼頭'], ['F3', '市場站']]),
        street('tw_tower', '塔下', [['F1', '四號塔的單位'], ['F2', '塔下站'], ['F3', '潛艙店']]),
        street('tw_gate', '閘門', []),
        street('tw_yard', '院子', [['F1', '院子站']]),
        { id: 'tw_office', kind: 'office_small', size: [9, 9], sheets: [OFFICE] },
        { id: 'tw_room', kind: 'room', size: [9, 5], fits: ['t_tw_hit', 't_tw_steal'], sheets: [ROOM] },
      ] as unknown as Rec[],
      // world
      facility_type: [{ id: 'fac_shop', name: '商店' }, { id: 'fac_dock', name: '碼頭' }, { id: 'fac_station', name: '車站' }, { id: 'fac_home', name: '住處' }],
      district: [
        { id: 'tw_hive', name: '蜂巢', grade: 1, price_mult: 1, blocks: ['tw_market', 'tw_tower', 'tw_gate'], factions: ['f_gang'] },
        { id: 'tw_rust', name: '鏽帶', grade: 2, step_minutes: 2, blocks: ['tw_yard'], factions: ['f_corp'] },
      ],
      block: [
        { id: 'tw_market', district: 'tw_hive', name: '市場', kind: 'block', map: 'm_tw_market', exits: { E2: { to: 'tw_tower', arrive: 'E1' } }, facilities: { F1: { type: 'fac_shop', name: '商行的門面' }, F2: { type: 'fac_dock', name: '碼頭' }, F3: { type: 'fac_station', name: '市場站' } } },
        { id: 'tw_tower', district: 'tw_hive', name: '塔下', kind: 'block', map: 'm_tw_tower', exits: { E1: { to: 'tw_market', arrive: 'E2' }, E2: { to: 'tw_gate', arrive: 'E1' } }, facilities: { F1: { type: 'fac_home', name: '四號塔的單位' }, F2: { type: 'fac_station', name: '塔下站' }, F3: { type: 'fac_tw_pod', name: '潛艙店' } } },
        { id: 'tw_gate', district: 'tw_hive', name: '閘門', kind: 'bridge', map: 'm_tw_gate', exits: { E1: { to: 'tw_tower', arrive: 'E2' }, E2: { to: 'tw_yard', arrive: 'E1' } }, facilities: {} },
        { id: 'tw_yard', district: 'tw_rust', name: '院子', kind: 'block', map: 'm_tw_yard', exits: { E1: { to: 'tw_gate', arrive: 'E2' } }, facilities: { F1: { type: 'fac_station', name: '院子站' } } },
      ],
      // transit
      transit_line: [{
        id: 'tw_metro', name: '地鐵紅線', kind: 'metro', minutes_per_stop: 5, wait: [2, 6], fare: { base: 2, per_stop: 1 }, pay: ['cred', 'cash'], night: false,
        stops: [{ id: 's_market', name: '市場', block: 'tw_market', at: 'F3' }, { id: 's_tower', name: '塔下', block: 'tw_tower', at: 'F2' }, { id: 's_yard', name: '院子', block: 'tw_yard', at: 'F1' }],
      }],
      // trade
      shop_type: [{ id: 'st_tw', name: '雜貨店', catalog: ['weapon', 'armor', 'consumable', 'misc'], buys: ['weapon', 'consumable', 'misc'], grade_max: 3, cash: true, shop_mult: 0.9, temper: 0 }],
      shop: [{ id: 's_tw_stall', type: 'st_tw', name: '市場的商行', district: 'tw_hive', block: 'tw_market', facility: 'F1', owner: 'npc_tw_vendor', backer: 'f_corp' }],
      // work
      job: [{
        id: 'j_tw_porter', name: '搬貨', facility: 'fac_dock', employer: 'npc_tw_vendor', check: { attr: 'body', dc: 8 }, wage: 10, pay: 'cash',
        stages: [{ name: '搬貨', mult: 1 }, { name: '領班', mult: 1.5, need: { hours: 30, affinity: 20 } }],
      }],
      // rest
      residence: [{ id: 'r_tw_unit', name: '四號塔的單位', district: 'tw_hive', block: 'tw_tower', facility: 'F1', level: 1, rent: 100 }],
      // npcs
      npc: [
        { id: 'npc_tw_vendor', name: '攤主阿柯', kind: 'citizen', age: 40, gender: 'male', guard: 13, wealth: 2, faction: 'f_corp', haunts: [{ district: 'tw_hive', block: 'tw_market' }] },
        { id: 'npc_tw_friend', name: '街坊小周', kind: 'citizen', age: 28, gender: 'female', guard: 14, wealth: 1, haunts: [{ district: 'tw_hive', block: 'tw_tower' }] },
        { id: 'npc_tw_fixer', name: '中間人老周', kind: 'citizen', age: 45, gender: 'male', guard: 15, wealth: 3, haunts: [{ district: 'tw_hive', block: 'tw_market' }] },
      ],
      name_pool: [{ id: 'np_tw', family: ['陸', '周', '王', '李'], given: ['守仁', '曉雯', '志明', '小芬', '大偉', '佳怡'] }],
      npc_gen: [{ id: 'ng_tw_hive', district: 'tw_hive', citizens: 3, runners: 2, occupations: [['攤販', 2], ['社畜', 1]], factions: [['none', 1]], names: ['np_tw'], haunts: [{ block: 'tw_market' }, { block: 'tw_tower' }] }],
      // lewd
      tendency_tag: [{ id: 'tg_tw_dom', name: '支配', axis: 'relation' }],
      // director
      event_scope: [{ id: 'street', triggers: { walk: 1, enter_block: 1, enter_bridge: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
      event: [EV_STREET, EV_SCENE],
      // defeat
      defeat_event: DEFEAT_EVENTS,
      // scene
      position: POSITIONS,
      // enemies
      enemy: ENEMIES,
      // fixer
      fixer: [{ id: 'fx_tw_broker', name: '市場的中間人', npc: 'npc_tw_fixer', district: 'tw_hive', block: 'tw_market', kinds: ['t_tw_hit'], cut: 0.1 }],
      commission_type: [TYPE_HIT],
      commission_link: LINKS,
      // commission
      commission: [CM_OFFICE],
    } as unknown as ContentPack['content'],
  })
  // 內海的幾筆（M3；worldNet.ts）併在後面：同一種內容種類接在同一個陣列上
  for (const [kind, entries] of Object.entries(netContent())) pack.content[kind] = [...(pack.content[kind] ?? []), ...(structuredClone(entries) as unknown as ContentEntry[])]
  return pack
}

/** 一份新的 TEST_WORLD（每次呼叫是獨立的複本）。 */
export const TEST_WORLD: ContentPack = testWorld()

/**
 * 拿掉某些功能之後的假世界：「沒有人定義的內容種類」整個濾掉；再把「引用的東西跟著不見」的那幾筆濾掉（例：拿掉 world，引用街區的路線與商店）。
 * 其餘照載。回傳濾完的包、被濾掉的種類與被濾掉的幾筆（`種類/id`；測試可以看拿掉一個功能濾掉了什麼）。
 */
export function worldFor(features: Feature[], pack: ContentPack = testWorld()): { pack: ContentPack; dropped: string[]; droppedEntries: string[] } {
  const dropped: string[] = []
  const droppedEntries: string[] = []
  const content: ContentPack['content'] = {}
  const known = createKernel(features).content
  const drop = (kind: string, id: string): void => {
    content[kind] = (content[kind] ?? []).filter((e) => e.id !== id)
    if (!droppedEntries.includes(`${kind}/${id}`)) droppedEntries.push(`${kind}/${id}`)
  }
  for (const [kind, entries] of Object.entries(pack.content)) {
    if (known.hasKind(kind)) content[kind] = entries
    else dropped.push(kind)
  }
  // 格式不合的筆（例：它的效果由被拿掉的功能註冊）：整筆濾掉
  for (const kind of Object.keys(content)) {
    for (const p of known.validate(kind, content[kind])) {
      const m = /^([a-z0-9_]+)\/([A-Za-z0-9_]+)：/.exec(p)
      if (m) drop(m[1]!, m[2]!)
    }
  }
  // 引用斷掉的筆、第二段（ready）檢查不過的筆：每濾掉一批，可能又有別的筆跟著斷，所以濾到沒有為止
  for (let round = 0; round < 10; round++) {
    const k = createKernel(features)
    for (const [kind, entries] of Object.entries(content)) k.content.load(kind, entries)
    let gone = k.content.checkRefs().flatMap((p) => {
      const m = /^([a-z0-9_]+)\/([A-Za-z0-9_]+)：/.exec(p)
      return m ? [`${m[1]}/${m[2]}`] : []
    })
    if (gone.length === 0) {
      try {
        readyFeatures(k)
      } catch (e) {
        // ContentError 有一串問題（每一條開頭是「種類/id：」）：把每一條指到的筆都濾掉；有一條指不到筆就是真的錯，照丟
        const lines = e instanceof ContentError ? e.problems : [e instanceof Error ? e.message : '']
        const hits = lines.map((l) => /^([a-z0-9_]+)\/([A-Za-z0-9_]+)：/.exec(l)).filter((m): m is RegExpExecArray => !!m)
        if (hits.length === 0 || hits.length < lines.length) throw e
        gone = [...new Set(hits.map((m) => `${m[1]}/${m[2]}`))]
      }
    }
    if (gone.length === 0) break
    for (const key of gone) {
      const [kind, id] = key.split('/') as [string, string]
      drop(kind, id)
    }
  }
  return { pack: { ...pack, content }, dropped, droppedEntries }
}

/**
 * 主角的武器：骰數特別多的一把槍，讓假兵種一碰就倒。真的裝備（gear）要有設計圖與組裝，冒煙不測那一段，用戰鬥的 loadout 掛鉤直接給。
 * 現實的戰鬥功能與裝備功能照樣裝著；這個功能只是多給一把武器。
 */
export const TEST_GEAR: Feature = {
  id: 'test_gear',
  install(k) {
    // 只在現實的戰場給（內海的武器是甲板上的構裝，M3）
    k.battle.loadout('test_gear', (_state, _actor, mode) => (mode === 'net' ? undefined : { weapons: [testWeapon('pistol', 5, 30)] }))
  },
}
