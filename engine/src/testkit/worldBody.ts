// 測試基礎建設：最小的假世界，M4 的那幾筆（dev/test-harness.md 第 1 節；dev/work/M4-smoke.md 第 1 點）。接在 world.ts 的 TEST_WORLD（含 worldNet.ts 的內海）後面，
// 只給測試用，不放進 engine/data；全部是假資料、文字中性。
//
// 每一種只放驗主幹用得到的最少幾筆：
//   身體    橋兩座（tw 通用橋、偏內海的橋）、義體七件（義眼、義臂、皮下裝甲、反射加速器 III、藥泵、生體獸耳、光紋刺青）與它們的零件、手槍的設計圖與零件、兩筆併發症、一筆殘響
//   診所街  街區 tw_clinics：正規診所、無照診所、黑診所、調校診所（四個設施 F1～F4）；店街 tw_shops：槍店（店家代工）、同人攤（同人社團，帶未登錄零件的委託台）、原廠櫃檯、互助診所（戒斷）；
//           大廳 tw_hall：拍賣行、感官擂台、療養院；三條街用出口接在市場的西口後面：市場 ─E1/E2─ 診所街 ─E1/E2─ 店街 ─E1/E2─ 大廳
//   藥      雲絲（成癮重）、鎮靜劑（緩和戒斷）、抑制劑
//   調校    靜水（感載消退 +2、不能全同步）、聚光
//   長線    流竄 AI 一個與兩件蠱惑事件（登入、長休各一件）、牠的吻（惡意韌體）、一筆「發作很快」的惡意韌體
//   夜課    五個夜課技能（五個分支各一）、兩個體位（一個三人的 pos_tw_trio、並躺）、共鳴一筆、兩筆傾向標籤
//   契約    一位持約人要的 NPC（阿音）、指令事件三件（契約人那面）、持約人那面的事件三件、範圍 contract 的觸發點
//   簾後館  一個簾口（暗礁的一個節點，站上去才能報名）、兩個夜、兩個文化各三種敵人（雙形象）、三張表、落幕的事件
//   市集    未登錄零件：一張小規則表（unreg_rule）、四筆預設清單、兩筆怪癖、同人攤的委託台
//           拍賣：白槌（週五）、八件拍品、四位競標者、一位寫得出推薦函的 NPC、一位教義體學的 NPC
//   建角    出身一個、基本的技能與特質、生命軌跡每張表兩條（家人、那件事、朋友、仇人、舊情、想要的、性經歷、潛在性癖）
//
// 規則表（*_rule）：除了下面幾筆為了讓主幹走得通改的（unreg_rule 的委託報酬機率、事件範圍 contract 與 rogue_ai 的觸發點機率），一律不放：每個功能自己帶預設，資料的規則表由 dataRules 載。
// 拿掉某個功能時，用 worldFor(features, bodyWorld()) 濾掉那個功能的內容種類（和 TEST_WORLD 同一個做法）。

import type { ContentEntry, ContentPack } from '../core/content/registry'
import { testWorld } from './world'

type Rec = Record<string, unknown>

// ---- 識別字 ----

export const BODY_DISTRICT = 'tw_ward'
export const BODY_BLOCKS = { clinics: 'tw_clinics', shops: 'tw_shops', hall: 'tw_hall', curtain: 'tw_curtain_door' } as const
/** 診所街的四個設施標記（F1 正規診所、F2 無照診所、F3 黑診所、F4 調校診所） */
export const CLINIC_MARKS = { clinic: 'F1', unlicensed: 'F2', black: 'F3', tuning: 'F4' } as const
/** 店街的四個設施標記（F1 槍店、F2 同人攤、F3 原廠櫃檯、F4 互助診所） */
export const SHOP_MARKS = { gun: 'F1', doujin: 'F2', factory: 'F3', detox: 'F4' } as const
/** 大廳的三個設施標記（F1 拍賣行、F2 擂台、F3 療養院） */
export const HALL_MARKS = { auction: 'F1', arena: 'F2', therapy: 'F3' } as const
export const CURTAIN_SITE = 'ns_tw_curtain'
export const CURTAIN_DOOR_MARKER = 'F1'
export const CURTAIN_NIGHTS = { a: 'cn_tw_stage', b: 'cn_tw_honey' } as const
export const CURTAIN_CULTURES = { a: 'tw_stage_troupe', b: 'tw_honey_house' } as const
export const AUCTION_HOUSE = 'ah_tw_hammer'
export const AUCTION_REF_NPC = 'npc_tw_regular'
export const TUTOR_NPC = 'npc_tw_tutor'
export const HOLDER_NPC = 'npc_tw_ayin'
export const WINDOW_FACTION = 'f_tw_doujin'
export const ROGUE_AI = 'ai_tw_mommy'
export const ORIGIN = 'tw_origin'

// ---- 零件 ----

const part = (id: string, name: string, type: string, o: Rec = {}): Rec => ({
  id, name, type, material: 'mech', brand: 'hz', grade: 2, price: 300, legal: 'free', cells: 1, stats: {}, weight: 0.5, size: 1, state: 'new', ...o,
})
const PARTS: Rec[] = [
  part('pt_tw_chip', '晶片「通用」', 'chip', { price: 900, bridge: { capacity: 52 } }),
  part('pt_tw_chip_hi', '晶片「餘燼」', 'chip', { grade: 3, price: 1600, brand: 'ka', bridge: { capacity: 64 } }),
  part('pt_tw_sw_even', '橋軟體「均衡」', 'software', { price: 300, bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
  part('pt_tw_sw_net', '橋軟體「潛網」', 'software', { price: 420, bridge: { split: { meat: 1, net: 3, social: 1, media: 1 } } }),
  part('pt_tw_lens', '感測器', 'sensor', { price: 500 }),
  part('pt_tw_plate', '合金板材', 'plate', { price: 400, stats: { armor: 2 } }),
  part('pt_tw_plate_skin', '皮下薄板', 'plate', { price: 350, stats: { armor: 2 } }),
  part('pt_tw_act', '致動器', 'actuator', { price: 450, grade: 3 }),
  part('pt_tw_neuron', '機械神經元', 'neuron', { price: 300 }),
  part('pt_tw_neuron_fast', '機械神經元「快」', 'neuron', { price: 520, grade: 3, brand: 'ka' }),
  part('pt_tw_chip_reflex', '反射晶片', 'chip', { price: 600, grade: 3, brand: 'ka' }),
  part('pt_tw_skin_bio', '獸耳外皮', 'skin', { price: 500, material: 'bio', grade: 1 }),
  part('pt_tw_ink', '光紋墨', 'skin', { price: 120, material: 'bio', grade: 1 }),
  // 手槍
  part('pt_tw_barrel', '槍管「定音」', 'barrel', { price: 300, stats: { damage: 1 }, weight: 0.5 }),
  part('pt_tw_barrel_hi', '槍管「餘燼」', 'barrel', { grade: 3, price: 620, brand: 'ka', stats: { damage: 2 }, legal: 'register' }),
  part('pt_tw_action', '機構「快門」', 'action', { price: 260, stats: { hit: 1 }, weight: 0.6 }),
  part('pt_tw_actuator_hi', '致動器「重錘」', 'actuator', { grade: 4, price: 900, brand: 'ka', stats: { body: 2 }, legal: 'register' }),
]

// ---- 設計圖 ----

const bp = (id: string, name: string, slot: string, o: Rec = {}): Rec => ({
  id, kind: 'cyberware', name, desc: `${name}：測試用的義體。`, brand: 'hz', grade: 2, legal: 'free', price: 900, require: [], optional: [], slot, invasiveness: 'light', sink_cost: 2, ...o,
})
const stockOf = (id: string): Record<string, string> => ({ ...((BLUEPRINTS.find((b) => b.id === id) as { stock?: Record<string, string> } | undefined)?.stock ?? {}) })
const BLUEPRINTS: Rec[] = [
  bp('bp_tw_bridge', '通用橋 II', 'bridge', {
    invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, price: 1200, require: [{ type: 'chip' }, { type: 'software' }], stock: { chip: 'pt_tw_chip', software: 'pt_tw_sw_even' },
  }),
  bp('bp_tw_bridge_net', '潛網者之友 III', 'bridge', {
    grade: 3, invasiveness: 'invasive', sink_cost: 5, bridge: { tuning_slots: 2 }, price: 2000, require: [{ type: 'chip' }, { type: 'software' }], stock: { chip: 'pt_tw_chip_hi', software: 'pt_tw_sw_net' },
  }),
  bp('bp_tw_eye', '義眼 II', 'eye', { sink_cost: 3, effects: [{ check: { skills: ['firearms'] }, amount: 1 }], require: [{ type: 'sensor' }], stock: { sensor: 'pt_tw_lens' } }),
  bp('bp_tw_arm', '義臂 III', 'arm', {
    grade: 3, invasiveness: 'invasive', sink_cost: 6, tags: ['limb'], effects: [{ attr: 'body', amount: 1 }], implant_kind: 'limb',
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }], stock: { plate: 'pt_tw_plate', actuator: 'pt_tw_act', neuron: 'pt_tw_neuron' },
  }),
  bp('bp_tw_plating', '皮下裝甲 II', 'torso', { sink_cost: 2, needs_bridge: false, require: [{ type: 'plate' }], stock: { plate: 'pt_tw_plate_skin' } }),
  // 反射加速器：戰鬥裡的開關（每回合行動點再 +1，維持要花感載）
  bp('bp_tw_accel', '反射加速器 III', 'brain', {
    grade: 3, brand: 'ka', invasiveness: 'invasive', sink_cost: 7, implant_kind: 'reflex', effects: [{ mod: 'initiative', amount: 2 }],
    require: [{ type: 'neuron' }, { type: 'chip' }], stock: { neuron: 'pt_tw_neuron_fast', chip: 'pt_tw_chip_reflex' },
    battle: { toggle: { id: 'cyber_reflex', name: '反射加速器', icon: 'reflex', levels: true, upkeep_load: { shallow: 2, standard: 3, deep: 4, full: 6 }, mods: [{ mod: 'ap_regen', amount: 1 }] } },
  }),
  bp('bp_tw_pump', '藥泵 II', 'torso', { sink_cost: 3, effects: [{ stat: 'max_hp', amount: 2 }], battle: { pump: true }, require: [{ type: 'actuator' }], stock: { actuator: 'pt_tw_act' } }),
  bp('bp_tw_ears', '生體獸耳 I', 'ear_throat', {
    grade: 1, sink_cost: 4, needs_bridge: false, tags: ['bio'], effects: [{ attr: 'charm', amount: 1 }], scene_parts: { adds: ['ear'], sensitivity: { ear: 15, all: 2 } },
    require: [{ type: 'skin', material: 'bio' }], stock: { skin: 'pt_tw_skin_bio' },
  }),
  bp('bp_tw_tattoo', '光紋刺青 I', 'skin', {
    grade: 1, invasiveness: 'surface', sink_cost: 1, needs_bridge: false, tattoo: { kind: 'deco' }, require: [{ type: 'skin', material: 'bio' }], stock: { skin: 'pt_tw_ink' },
  }),
  // 一般的武器：槍管決定傷害、機構決定準頭
  {
    id: 'bp_tw_pistol', kind: 'weapon', name: '手槍「回火」', desc: '測試用的手槍。', brand: 'hz', grade: 2, legal: 'register', price: 900, size: 1, weight: 0.5, class: 'pistol', carry: 'side',
    require: [{ type: 'barrel' }, { type: 'action' }], optional: [], stock: { barrel: 'pt_tw_barrel', action: 'pt_tw_action' },
  },
]
export const bodyStock = stockOf

// ---- 怪癖：併發症、殘響、同人的魔改 ----

const QUIRKS: Rec[] = [
  { id: 'cx_tw_scar', name: '疤痕組織', desc: '縫合的地方留了疤。', kind: 'complication', pool: ['complication'], effects: [{ attr: 'reflex', amount: -1 }] },
  { id: 'cx_tw_ache', name: '陰雨會痛', desc: '下雨天接口會痛。', kind: 'complication', pool: ['complication'], effects: [{ stat: 'max_hp', amount: -2 }] },
  { id: 'cx_tw_echo', name: '殘響', desc: '前一個主人的感覺。', kind: 'echo', pool: ['used'] },
  { id: 'cq_tw_loose', name: '鬆動', desc: '有個接點沒咬緊。', kind: 'flaw', pool: ['flaw'], stats: { hit: -1 } },
  { id: 'uq_tw_squeak', name: '會作響', desc: '它在口袋裡會輕輕作響。', kind: 'quirk', pool: ['doujin'] },
  { id: 'uq_tw_night', name: '夜光', desc: '天黑之後，接縫的地方會透出一圈淡淡的光。', kind: 'quirk', pool: ['doujin'] },
]

// ---- 物品：藥、授權書、拍品的實物 ----

const drugItem = (id: string, name: string, drug: Rec, o: Rec = {}): Rec => ({ id, name, desc: `${name}：測試用的藥。`, category: 'drug', grade: 1, size: 0, legal: 'free', price: 60, drug, ...o })
const ITEMS: Rec[] = [
  // 成癮重的藥：每劑 +45，兩劑就到依賴；戒斷五天、意志 −2
  drugItem('it_tw_cloud', '雲絲', { duration: { minutes: 60 }, effects: [{ attr: 'charm', amount: 1 }], addiction: { per_dose: 45, withdrawal: { days: 5, effects: [{ attr: 'resolve', amount: -2 }] } } }, { price: 150 }),
  drugItem('it_tw_calm', '鎮靜劑', { duration: { minutes: 1440 }, eases_withdrawal: true }),
  drugItem('it_tw_supp', '抑制劑一週份', { suppressant: true }, { price: 80 }),
  { id: 'it_tw_lic', name: '授權書「手槍」', desc: '用掉之後學會這張設計圖的組法。', category: 'blueprint', grade: 2, size: 0, legal: 'free', price: 500, teaches: 'bp_tw_pistol' },
  { id: 'it_tw_painting', name: '一幅小畫', desc: '拍品。', category: 'misc', grade: 3, size: 1, legal: 'free', price: 2400 },
  { id: 'it_tw_sculpt', name: '纏線的小雕像', desc: '拍品。', category: 'misc', grade: 3, size: 1, legal: 'free', price: 1800 },
  { id: 'it_tw_key', name: '一把沒有標籤的鑰匙', desc: '拍品。', category: 'misc', grade: 3, size: 1, legal: 'free', price: 3000 },
  { id: 'it_tw_curtain_pin', name: '簾後館的紀念徽章', desc: '獎品室發的紀念品。', category: 'misc', grade: 2, size: 0, legal: 'free', price: 300 },
]

// ---- 調校、惡意韌體、流竄 AI ----

const TUNINGS: Rec[] = [
  { id: 'tu_tw_still', name: '靜水', desc: '每回合感載消退 +2 點；代價：開不了全同步。', effects: [{ stat: 'net_load_decay', amount: 2 }, { mod: 'decay', amount: 2, layer: 'meat' }], flags: ['no_full_sync'], price: 800 },
  { id: 'tu_tw_spot', name: '聚光', desc: '被注視時表演檢定 +2；代價：定力 −1。', effects: [{ check: { skills: ['perform'] }, amount: 2 }, { check: { skills: ['composure'] }, amount: -1 }], price: 900 },
]
const MALWARES: Rec[] = [
  // 牠的吻：潛伏沒有效果，發作與擴散各扣一點意志
  { id: 'mw_tw_kiss', name: '妖精的吻', desc: '一小片流竄 AI 留在橋上的東西。', pool: ['lure'], stages: { latent: { effects: [] }, active: { effects: [{ attr: 'resolve', amount: -1 }] }, spread: { effects: [{ attr: 'resolve', amount: -2 }] } } },
  // 一般的植入物：潛伏很短、發作有數字、清除要診所
  { id: 'mw_tw_worm', name: '蠕蟲', desc: '一種會慢慢吃掉橋容量的韌體。', pool: ['lace'], stages: { latent: { effects: [] }, active: { effects: [{ attr: 'intellect', amount: -1 }] }, spread: { effects: [{ attr: 'intellect', amount: -2 }] } } },
]
const ROGUE_AIS: Rec[] = [{
  id: ROGUE_AI, name: '媽咪', tag: 'tg_tw_pamper', axis: 'relation', filter: 'ai:媽咪', kiss: 'mw_tw_kiss',
  lore: { origin: '牠說自己原本是一間托兒所的排班程式。', want: '牠想要有人記得今天有沒有吃飯。', ties: '牠和夜班的人都處得來。', home: '牠說牠的家在舊港的某個機房。' },
}]
const flag = (key: string) => ({ kind: 'flag', key, value: true })
const sinkFx = (amount: number) => ({ kind: 'sink', amount })
const lureFx = (choice: string) => ({ kind: 'lure', ai: ROGUE_AI, choice })
const lureEvent = (id: string, trigger: string, text: string): Rec => ({
  id, scope: 'rogue_ai', triggers: [trigger], tags: ['ai:媽咪', 'resist_lure'], category: 'desire', requires: { kind: 'lure_open', ai: ROGUE_AI }, text, repeat_days: 0,
  options: [
    { id: 'follow', text: '順著牠。', outcomes: { any: [sinkFx(2), lureFx('follow')] } },
    { id: 'refuse', text: '拒絕。', need: { kind: 'not', of: { kind: 'sunk' } }, check: ['composure', 'resolve', 13], outcomes: { success: [lureFx('refuse')], fail: [sinkFx(1), lureFx('refuse')] } },
    { id: 'ask', text: '問牠是誰。', outcomes: { any: [sinkFx(1), lureFx('ask')] } },
  ],
})
const LURE_EVENTS: Rec[] = [
  lureEvent('lu_tw_login', 'login', '登入的一瞬間，有一個很輕的聲音說：回來啦。'),
  lureEvent('lu_tw_rest', 'rest', '你睡醒的時候，耳機裡有人說：我幫你把被子蓋好了。'),
]

// ---- 契約的事件 ----

const cash = (amount: number) => ({ kind: 'cash', amount })
const done = (kind: string) => ({ kind: 'order_done', order_kind: kind })
const CONTRACT_BASE = { scope: 'contract', repeat_days: 0 }
const CONTRACT_EVENTS: Rec[] = [
  // 契約人那一面的指令事件（觸發點 order；做完用 order_done 把那一條收尾）
  {
    ...CONTRACT_BASE, id: 'ct_tw_order_errand', triggers: ['order'], where: { order: 'errand' }, category: 'favor', text: '你把東西送到了，收件的人在簽收單上按了個章。',
    options: [{ id: 'ok', text: '收好簽收單。', outcomes: { any: [done('errand'), flag('tw_bound_errand')] } }],
  },
  {
    ...CONTRACT_BASE, id: 'ct_tw_order_work', triggers: ['order'], where: { order: 'work' }, category: 'opportunity', text: '今天的班排在二樓的接待。',
    options: [{ id: 'work', text: '把班做完。', outcomes: { any: [done('work'), cash(120), flag('tw_bound_work')] } }],
  },
  {
    ...CONTRACT_BASE, id: 'ct_tw_order_report', triggers: ['order'], where: { order: 'report' }, category: 'rumor', text: '你照規定到了櫃檯，讓人看了你的橋。',
    options: [{ id: 'ok', text: '收好回條。', outcomes: { any: [done('report'), flag('tw_bound_report')] } }],
  },
  // 持約人那一面（觸發點 holder_order、released）
  {
    ...CONTRACT_BASE, id: 'ct_tw_errand', triggers: ['holder_order'], where: { order: 'errand' }, category: 'favor', text: '你交代下去的差事有了結果。',
    options: [{ id: 'take', text: '收下零錢。', outcomes: { any: [cash(20), flag('tw_holder_errand')] } }],
  },
  {
    ...CONTRACT_BASE, id: 'ct_tw_talk', triggers: ['holder_order'], where: { order: 'talk' }, category: 'rumor', text: '你找她坐下來談了一談。',
    options: [{ id: 'listen', text: '好好聽她說完。', outcomes: { any: [flag('tw_holder_talk')] } }],
  },
  {
    ...CONTRACT_BASE, id: 'ct_tw_released', triggers: ['released'], category: 'favor', text: '契約解除了。',
    options: [{ id: 'stay', text: '告訴她：想留下的話，名冊上還有她的位子。', outcomes: { any: [flag('tw_holder_stay')] } }],
  },
]
/** 範圍 contract 與 rogue_ai：和資料的規則表同一個 id（後載入的取代）；觸發機率調成 1，讓主幹每一次都會遇到。 */
const EVENT_SCOPES: Rec[] = [
  {
    id: 'contract', triggers: { order: 1, holder_order: 1, released: 1 }, priority: 2, daily_roll: { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] },
    satisfaction_mult: [[0, 1.5], [30, 1.0], [70, 0.6]], queue_max: 3, repeat_days: 0, lost: 'defer',
  },
  { id: 'rogue_ai', triggers: { login: 1, rest: 1 }, cooldown_hours: 0, daily_cap: 9, lost: 'defer' },
]

// ---- 成人場景：夜課、體位、共鳴 ----

const ROLES_TRIO = [{ id: 'a', upper: true }, { id: 'b', upper: false }, { id: 'c', upper: false }]
const tlink = (a: [string, string], b: [string, string]): Rec => ({ from: a, to: b })
const POSITIONS: Rec[] = [
  {
    id: 'pos_tw_trio', name: '三個人貼在一起', people: 3, roles: ROLES_TRIO, mult: { a: 1, b: 1.2, c: 1.2 }, initiative_drift: 2, drift: { a: 3, b: 0, c: 0 }, unlocked_by: null, text: '三個人靠得很近。',
    links: [
      tlink(['a', 'mouth'], ['b', 'mouth']), tlink(['a', 'hand_l'], ['b', 'chest']), tlink(['a', 'hand_r'], ['c', 'chest']), tlink(['a', 'mouth'], ['c', 'back']),
      tlink(['b', 'hand_l'], ['c', 'chest']), tlink(['b', 'mouth'], ['c', 'mouth']), tlink(['c', 'hand_r'], ['b', 'back']), tlink(['b', 'front'], ['c', 'front']),
    ],
  },
  {
    id: 'pos_tw_ride', name: '騎乘', people: 2, roles: [{ id: 'a', upper: false }, { id: 'b', upper: true }], mult: { a: 1.3, b: 1 }, initiative_drift: 3, tag: 'tg_tw_dom', unlocked_by: 'nt_tw_ride', text: '一個人坐在另一個人身上。',
    links: [tlink(['a', 'mouth'], ['b', 'mouth']), tlink(['a', 'hand_l'], ['b', 'chest']), tlink(['a', 'hand_r'], ['b', 'chest']), tlink(['a', 'front'], ['b', 'front'])],
  },
]
const HANDS = ['hand_l', 'hand_r']
const NIGHT_SKILLS: Rec[] = [
  { id: 'nt_tw_ride', name: '夜課・騎乘', branch: 'body', tier: 2, desc: '學會之後多會一個體位。' },
  {
    id: 'nt_tw_stroke', name: '指腹游走', branch: 'common', tier: 1, desc: '用指腹慢慢游走，每回合持續。',
    scene: { ap: 1, my_part: HANDS, their_part: ['chest', 'front', 'back', 'legs', 'mouth'], on_use: { their_load: '1d3', fit: 2 }, link: { their_load: '1d3', fit: 2 } },
  },
  {
    id: 'nt_tw_kiss', name: '親吻', branch: 'common', tier: 1, desc: '口與口、口與胸，雙方一起有感。',
    scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth', 'chest'], on_use: { their_load: '1d3', my_load: '1d3', fit: 3 }, link: { their_load: '1d3', my_load: '1d3', fit: 2 } },
  },
  {
    id: 'nt_tw_hold', name: '按住手腕', branch: 'relation', tier: 1, tag: 'tg_tw_dom', tags: ['restraint'], desc: '按住對方的手腕。',
    scene: { ap: 1, my_part: HANDS, their_part: HANDS, on_use: { fit: 3 }, link: { their_load: '1d3', fit: 1 } },
  },
  {
    id: 'nt_tw_slow', name: '慢慢摸索', branch: 'common', tier: 1, desc: '一個人慢慢找到自己的節奏；有人在也行。',
    scene: { ap: 1, my_part: HANDS, their_part: ['chest', 'front'], on_use: { their_load: '1d3', my_load: '1d3', fit: 2 }, link: { their_load: '1d3', my_load: '1d3', fit: 1 }, solo: 'ok' },
  },
  {
    id: 'nt_tw_show', name: '給人看', branch: 'costume', tier: 1, desc: '在別人的目光下放開一點；要有人在看才用得出來。',
    scene: { ap: 1, my_part: HANDS, their_part: ['chest', 'legs'], on_use: { their_load: '1d3', my_load: '1d3', fit: 3 }, link: { their_load: '1d3', my_load: '1d3', fit: 1 }, solo: 'audience' },
  },
]
const RESONANCES: Rec[] = [{ id: 'res_tw_common_2', name: '熟門熟路', branch: 'common', tier: 2, desc: '每一場有一次切換體位不花行動點。', scene: { free_switch: 1 } }]
// tg_tw_dom 是 TEST_WORLD 的（world.ts）
const TAGS: Rec[] = [{ id: 'tg_tw_sub', name: '服從', axis: 'relation' }, { id: 'tg_tw_pamper', name: '溺愛', axis: 'relation' }]

// ---- 設施與街區 ----

const FACILITY_TYPES: Rec[] = [
  { id: 'fac_tw_clinic', name: '診所', clinic: { grade: 'clinic' } },
  { id: 'fac_tw_clinic_unlic', name: '無照診所', clinic: { grade: 'unlicensed' } },
  { id: 'fac_tw_clinic_black', name: '黑診所', clinic: { grade: 'black' } },
  { id: 'fac_tw_tuning', name: '調校診所', tuning: { install: true, quiet_room: true } },
  { id: 'fac_tw_gunshop', name: '槍店', craft: { by: 'shop' } },
  { id: 'fac_tw_doujin', name: '同人攤', craft: { by: 'doujin' }, unreg_desk: { faction: WINDOW_FACTION, brand: WINDOW_FACTION } },
  { id: 'fac_tw_factory', name: '原廠櫃檯', craft: { by: 'factory', brand: 'hz' } },
  { id: 'fac_tw_detox', name: '互助診所', detox: {} },
  { id: 'fac_tw_auction', name: '拍賣行', auction: { house: AUCTION_HOUSE } },
  { id: 'fac_tw_arena', name: '感官擂台', arena: { grades: [1, 2, 3] } },
  { id: 'fac_tw_therapy', name: '療養院', therapy: { kind: 'counsel' } },
  { id: 'fac_tw_curtain_door', name: '簾口', curtain_door: true },
]

/** 一塊街區的版面（和 world.ts 的 street 同一個樣子：14 × 5，E1 在西、E2 在東，設施標記排在 y=1）。 */
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
const SPECIAL_MAPS: Rec[] = [
  street('tw_clinics', '診所街', [['F1', '診所'], ['F2', '無照診所'], ['F3', '黑診所'], ['F4', '調校診所']]),
  street('tw_shops', '店街', [['F1', '槍店'], ['F2', '同人攤'], ['F3', '原廠櫃檯'], ['F4', '互助診所']]),
  street('tw_hall', '大廳', [['F1', '拍賣行'], ['F2', '感官擂台'], ['F3', '療養院']]),
  // 簾口：暗礁的一個節點（站在上面才能報名）
  {
    id: 'm_tw_curtain_door', kind: 'block', size: [11, 5],
    sheets: [{ id: 'street', name: '斷線的後門', size: [11, 5], layout: ['###########', '#.........#', 'E..F......#', '#.........#', '###########'], cells: [{ id: 'E1', at: [0, 2], mark: 'E', name: '往外' }, { id: CURTAIN_DOOR_MARKER, at: [3, 2], mark: 'F', name: '簾口' }] }],
  },
]
const DISTRICTS: Rec[] = [
  { id: BODY_DISTRICT, name: '診所區', grade: 1, price_mult: 1, blocks: [BODY_BLOCKS.clinics, BODY_BLOCKS.shops, BODY_BLOCKS.hall], factions: [] },
  { id: 'tw_under', name: '暗礁', grade: 1, price_mult: 1, blocks: [BODY_BLOCKS.curtain], factions: [] },
]
const BLOCKS: Rec[] = [
  {
    id: BODY_BLOCKS.clinics, district: BODY_DISTRICT, name: '診所街', kind: 'block', map: 'm_tw_clinics', exits: { E2: { to: 'tw_market', arrive: 'E1' }, E1: { to: BODY_BLOCKS.shops, arrive: 'E2' } },
    facilities: { F1: { type: 'fac_tw_clinic', name: '診所' }, F2: { type: 'fac_tw_clinic_unlic', name: '無照診所' }, F3: { type: 'fac_tw_clinic_black', name: '黑診所' }, F4: { type: 'fac_tw_tuning', name: '調校診所' } },
  },
  {
    id: BODY_BLOCKS.shops, district: BODY_DISTRICT, name: '店街', kind: 'block', map: 'm_tw_shops', exits: { E2: { to: BODY_BLOCKS.clinics, arrive: 'E1' }, E1: { to: BODY_BLOCKS.hall, arrive: 'E2' } },
    facilities: { F1: { type: 'fac_tw_gunshop', name: '槍店' }, F2: { type: 'fac_tw_doujin', name: '同人攤' }, F3: { type: 'fac_tw_factory', name: '原廠櫃檯' }, F4: { type: 'fac_tw_detox', name: '互助診所' } },
  },
  {
    id: BODY_BLOCKS.hall, district: BODY_DISTRICT, name: '大廳', kind: 'block', map: 'm_tw_hall', exits: { E2: { to: BODY_BLOCKS.shops, arrive: 'E1' } },
    facilities: { F1: { type: 'fac_tw_auction', name: '拍賣行' }, F2: { type: 'fac_tw_arena', name: '感官擂台' }, F3: { type: 'fac_tw_therapy', name: '療養院' } },
  },
  { id: BODY_BLOCKS.curtain, district: 'tw_under', name: '斷線的後門', kind: 'block', map: 'm_tw_curtain_door', exits: {}, facilities: { [CURTAIN_DOOR_MARKER]: { type: 'fac_tw_curtain_door', name: '簾口' } } },
]
const NET_SITES: Rec[] = [{ id: CURTAIN_SITE, name: '簾後館的簾口', kind: 'block', need: 'deck', desc: '暗礁裡會員制的地城。', block: BODY_BLOCKS.curtain, marker: CURTAIN_DOOR_MARKER }]

// ---- 勢力與 NPC ----

const FACTIONS: Rec[] = [
  { id: WINDOW_FACTION, name: '同人眾', short: '同人眾', class: 'street' },
  { id: 'f_tw_kaleido', name: '萬花筒', short: '萬花筒', class: 'corp' },
  { id: 'f_tw_honey', name: '蜜糖會', short: '蜜糖會', class: 'street' },
  { id: 'f_tw_gallery', name: '玻璃岸', short: '玻璃岸', class: 'corp' },
  { id: 'f_tw_eden', name: '樂園', short: '樂園', class: 'corp' },
]
const ALL_DAY = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']
const NPCS: Rec[] = [
  {
    id: HOLDER_NPC, name: '阿音', kind: 'citizen', age: 26, gender: 'female', occupation: '欠了債的駐唱歌手', guard: 12, wealth: 1, haunts: [{ district: 'tw_hive', block: 'tw_tower', time: ALL_DAY }],
    persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] }, bridge: { sensitivity: 40, tolerance: 25, craving: 30, docility: 35 }, sink: 10, attrs: { charm: 13, resolve: 9 }, skills: {},
  },
  {
    id: AUCTION_REF_NPC, name: '白槌的常客', kind: 'citizen', age: 52, gender: 'female', occupation: '每週五都來的老主顧', guard: 14, wealth: 4, auction_ref: [AUCTION_HOUSE],
    haunts: [{ district: 'tw_hive', block: 'tw_market', time: ALL_DAY }], persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] }, attrs: { charm: 13, intellect: 13 }, skills: { negotiate: 3 },
  },
  {
    id: TUTOR_NPC, name: '阿鉚', kind: 'citizen', age: 47, gender: 'male', occupation: '做了二十年的機械維修師', guard: 13, wealth: 1, haunts: [{ district: 'tw_hive', block: 'tw_market', time: ALL_DAY }],
    persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] }, bridge: { sensitivity: 30, tolerance: 35, craving: 20, docility: 20 }, sink: 6, attrs: { tech: 14, body: 11, resolve: 12 }, skills: { cyberware: 4 },
    tutor: { skills: ['cyberware'], sink: 1, where: '市場的角落' },
  },
]

// ---- 簾後館 ----

const program = (id: string, culture: string, rank: 'minion' | 'elite' | 'boss', a: [string, string], b: [string, string], neutral: [string, string]): Rec => ({
  id, name: a[0], desc: `簾後館的${rank === 'boss' ? '層主' : rank === 'elite' ? '熟面孔' : '演出者'}：只打感載，不打生命。`, faction: 'none', rank, grades: [1, 5], kind: 'program', culture,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, mods: { load: 0.5, attack: -10, evade: -6 },
  constructs: [{ id: `cs_${id}`, class: 'pistol', name: '聚光燈' }],
  forms: {
    a: { name: a[0], look: a[1], points_at: ['male'] },
    b: { name: b[0], look: b[1], points_at: ['female', 'femboy', 'trans_f', 'futa'] },
  },
  neutral: { name: neutral[0], look: neutral[1] },
})
const CURTAIN_ENEMIES: Rec[] = [
  program('cs_tw_stage_min', CURTAIN_CULTURES.a, 'minion', ['舞台上的領舞', '一身亮片的女演出者。'], ['舞台上的男主角', '穿著燕尾服的男演出者。'], ['一團聚光', '沒有輪廓的一團光。']),
  program('cs_tw_stage_eli', CURTAIN_CULTURES.a, 'elite', ['嚴厲的編舞老師', '戴著眼鏡的女老師。'], ['油膩的經紀人', '西裝皺巴巴的男經紀人。'], ['一面面具', '沒有表情的一面面具。']),
  program('cs_tw_stage_boss', CURTAIN_CULTURES.a, 'boss', ['台柱', '站在聚光燈正中央的女台柱。'], ['館主', '握著麥克風的男館主。'], ['主持人的輪廓', '只有一套制服的輪廓。']),
  program('cs_tw_honey_min', CURTAIN_CULTURES.b, 'minion', ['甜點師', '推著點心車的女服務生。'], ['黏人的大叔', '一直想搭話的男客人。'], ['一團糖霜', '一團黏黏的糖霜。']),
  program('cs_tw_honey_eli', CURTAIN_CULTURES.b, 'elite', ['蜜糖護士', '穿著粉色制服的女護理員。'], ['老教授', '戴著老花眼鏡的男教授。'], ['一套制服', '空空的一套白制服。']),
  program('cs_tw_honey_boss', CURTAIN_CULTURES.b, 'boss', ['蜜糖館長', '端著茶杯的女館長。'], ['老道', '拿著拂塵的男道長。'], ['茶席的輪廓', '一張擺好的茶席。']),
]
const CURTAIN_NIGHT_ENTRIES: Rec[] = [
  { id: CURTAIN_NIGHTS.a, name: '舞台之夜', faction: 'f_tw_kaleido', tags: ['tg_tw_dom'], culture: CURTAIN_CULTURES.a },
  { id: CURTAIN_NIGHTS.b, name: '蜜糖之夜', faction: 'f_tw_honey', tags: ['tg_tw_sub'], culture: CURTAIN_CULTURES.b },
]
const CURTAIN_TABLES: Rec[] = [
  { id: 'ct_tw_order', kind: 'order', rows: [{ weight: 3, name: '台詞', order: 'line' }, { weight: 2, name: '收尾', order: 'finish' }] },
  { id: 'ct_tw_chest', kind: 'chest', rows: [{ weight: 3, name: '票根箱', stubs: [3, 8] }, { weight: 1, name: '神祕的賞箱', prize: true }] },
  { id: 'ct_tw_prize', kind: 'prize', rows: [{ weight: 2, name: '紀念徽章', give: [{ kind: 'item', id: 'it_tw_curtain_pin', qty: 1 }] }, { weight: 1, name: '票根一把', stubs: [10, 20] }] },
]
const STAGE_EVENT_IDS = ['df_tw_stage_foyer', 'df_tw_stage_headliner', 'df_tw_stage_backstage', 'df_tw_stage_vip', 'df_tw_stage_encore']
const stageEvent = (id: string): Rec => ({
  id, name: '落幕', kind: 'stage', factions: [], fails_commission: false, cast: [{ role: 'a' }], fallback: `${id}_plain`,
  versions: {
    default: {
      text: '落幕了。館方派了補演。',
      stages: [{ options: [{ id: 'play', text: '上台。', outcomes: { any: [] }, adult_scene: { when: 'always', gate: 'fixed', nature: 'work', role: 'none', goal: 'please', layer: 'net', circles: [['$pc', '$a']] } }] }],
    },
  },
})
const plainEvent = (id: string): Rec => ({
  id: `${id}_plain`, name: '落幕', kind: 'stage', factions: [], fails_commission: false,
  versions: { default: { text: '落幕了。後台的一段訓話與帳。', stages: [{ options: [{ id: 'talk', text: '聽訓話。', outcomes: { any: [] } }] }] } },
})
const STAGE_EVENTS: Rec[] = [...STAGE_EVENT_IDS.map(stageEvent), ...STAGE_EVENT_IDS.map(plainEvent)]

// ---- 未登錄零件 ----

const opt = (id: string, name: string, put: 'stats' | 'affinity', key: string, amount: number, cost: number, max: number, o: Rec = {}): Rec => ({ id, name, put, key, amount, cost, max, ...o })
const UNREG_RULE: Rec[] = [{
  id: 'default',
  options: {
    skin: [opt('skin_social', '社交親和', 'affinity', 'social', 1, 0.5, 3, { tags: ['社交'] }), opt('skin_style', '風格', 'stats', 'style', 1, 0.5, 3, { tags: ['風格'] })],
    barrel: [opt('barrel_damage', '傷害', 'stats', 'damage', 1, 1, 2, { tags: ['火力'] }), opt('barrel_range', '射程', 'stats', 'range_far', 1, 0.5, 2, { tags: ['射程'] })],
    plate: [opt('plate_armor', '護甲', 'stats', 'armor', 1, 0.5, 3, { max_at: { 1: 1, 2: 2 }, tags: ['防護'] }), opt('plate_light', '減重', 'stats', 'weight', -0.2, 0.5, 2, { tags: ['輕量'] })],
  },
  // 委託報酬：III 級以上的委託一定多一件（正式的規則是 0.1）
  sources: { reward: { chance: 1 } },
}]
const preset = (id: string, type: string, name: string, desc: string, quirk_text: string): Rec => ({ id, type, name, desc, quirk_text })
const UNREG_PRESETS: Rec[] = [
  preset('up_tw_skin_snail', 'skin', '蝸殼', '一層薄薄的外皮。', '在濕氣重的夜晚會輕輕發亮。'),
  preset('up_tw_skin_haze', 'skin', '薄霧', '顏色很淡的外皮。', '碰到熱的東西會暫時變得有點透明。'),
  preset('up_tw_barrel_stub', 'barrel', '短舌', '切短過的槍管。', '擊發之後會在掌心留下一點餘溫。'),
  preset('up_tw_plate_patch', 'plate', '拼貼', '用幾塊不同年份的板材拼起來。', '放久了會自己發出細微的金屬聲。'),
]

// ---- 拍賣 ----

const AUCTION_HOUSES: Rec[] = [{
  id: AUCTION_HOUSE, name: '白槌', weekday: 4, segment: 'prime', lots: [8, 8], kinds: ['part', 'cyberware', 'art', 'secret', 'contract'], must: ['contract'], bidders: [4, 4],
  member: { faction: 'f_tw_gallery', favor_min: 40, ref: true },
}]
const lot = (id: string, kind: string, o: Rec): Rec => ({ id, kind, ...o })
const AUCTION_LOTS: Rec[] = [
  lot('al_tw_barrel', 'part', { part: 'pt_tw_barrel_hi', desc: '一根槍管。' }),
  lot('al_tw_actuator', 'part', { part: 'pt_tw_actuator_hi', desc: '一具致動器。' }),
  lot('al_tw_arm', 'cyberware', { blueprint: 'bp_tw_arm', desc: '義臂的原廠組合。' }),
  lot('al_tw_accel', 'cyberware', { blueprint: 'bp_tw_accel', desc: '反射加速器。' }),
  lot('al_tw_painting', 'art', { name: '一幅小畫', item: 'it_tw_painting', market: 2400, desc: '一幅小尺寸的油畫。', cert: '附鑑定書。' }),
  lot('al_tw_sculpt', 'art', { name: '纏線的小雕像', item: 'it_tw_sculpt', market: 1800, desc: '手掌大小的小雕像。', cert: '附鑑定書。' }),
  lot('al_tw_key', 'secret', { name: '一把沒有標籤的鑰匙', item: 'it_tw_key', market: 3000, desc: '主辦方只說：它打得開一個地方。', cert: '主辦方不附任何說明。' }),
  lot('al_tw_contract', 'contract', { name: '一份債務契約（阿音）', npc: HOLDER_NPC, contract: { type: 'debt', debt: 2400 }, market: 2400, desc: '一份轉手的債權。' }),
]
const bidder = (id: string, name: string, interests: string[]): Rec => ({ id, name, interests })
const AUCTION_BIDDERS: Rec[] = [
  bidder('ab_tw_collector', '戴手套的收藏家', ['art', 'secret']), bidder('ab_tw_dealer', '義體商人', ['cyberware', 'part']),
  bidder('ab_tw_broker', '穿灰西裝的掮客', ['contract', 'secret']), bidder('ab_tw_guest', '不具名的來賓', ['art', 'cyberware', 'contract']),
]

// ---- 建角 ----

const lp = (table: string, id: string, text: string, over: Rec = {}): Rec => ({ id, table, text, result: {}, ...over })
const LIFEPATH: Rec[] = [
  lp('family', 'lp_tw_fam_tower', '住在同一棟塔', { result: { npc: { role: 'family', faction_from: 'origin', affinity: 20 } } }),
  lp('family', 'lp_tw_fam_gone', '失散了'),
  lp('incident', 'lp_tw_inc_debt', '欠了一筆債', { result: { effects: [{ kind: 'debt', to: 'f_gang', amount: 2000, rate: 0.05 }, { kind: 'sink_floor', amount: 5 }] } }),
  lp('incident', 'lp_tw_inc_cash', '分到一筆錢', { result: { effects: [{ kind: 'cash', amount: 100 }] } }),
  lp('friend', 'lp_tw_fr_old', '一起長大的', { result: { npc: { role: 'friend', faction_from: 'origin', affinity: 30, roster: true } } }),
  lp('friend', 'lp_tw_fr_none', '沒什麼朋友'),
  lp('enemy', 'lp_tw_en_rival', '搶同一個位置的', { result: { npc: { role: 'enemy', faction_from: 'f_gang', affinity: -20, hostility: 15 } } }),
  lp('enemy', 'lp_tw_en_loose', '一個沒有勢力的仇人', { result: { npc: { role: 'enemy', hostility: 10 } } }),
  lp('ex', 'lp_tw_ex_gone', '分了', { result: { npc: { role: 'ex', affinity: 10 } } }),
  lp('ex', 'lp_tw_ex_none', '沒有舊情'),
  lp('want', 'lp_tw_want_money', '錢', { result: { goal: 'get_rich' } }),
  lp('want', 'lp_tw_want_leave', '離開這座城', { result: { goal: 'leave_city' } }),
  lp('sex', 'lp_tw_sex_some', '普通', { tags: ['lp_adult'], result: { sex_record: { times: 12, partners: 3, service_times: 2 }, bridge: { craving: 8, tolerance: -5, sensitivity: 10 } } }),
  lp('sex', 'lp_tw_sex_none', '幾乎沒有', { tags: ['lp_adult'], result: { sex_record: { times: 1, partners: 1, service_times: 0 } } }),
  lp('kink', 'lp_tw_kink_rope', '被綁過', { result: { tendency: [{ tag: 'tg_tw_dom', state: 'latent' }] } }),
  lp('kink', 'lp_tw_kink_none', '沒有特別的'),
]
const ORIGINS: Rec[] = [{
  id: ORIGIN, name: '蜂巢', line: '巨型公寓裡長大的孩子，現在是大人了', skill_bonus: { streetwise: 1 }, status: 'citizen', home: '蜂巢四號塔的單位', favor: { choose_one: ['f_gang'], value: 25 }, perk: 'perk_tw_origin',
  roster: ['npc_tw_friend'],
}]
const PERKS: Rec[] = [
  { id: 'perk_tw_origin', name: '巷子裡的眼睛', category: 'origin', cost: 2, flaw: false, desc: '街頭直覺 +2。', checks: { skills: ['streetwise'], bonus: 2 } },
  { id: 'perk_tw_smooth', name: '能言善道', category: 'social', cost: 2, flaw: false, desc: '交涉的檢定 +2。', checks: { skills: ['negotiate'], bonus: 2 } },
  { id: 'perk_tw_tough', name: '耐打', category: 'body', cost: 2, flaw: false, desc: '生命值上限 +5。', stats: { max_hp: 5 } },
]
const ATTRIBUTES: Rec[] = [
  { id: 'body', name: '體格', desc: '生命值、近戰與重裝。' }, { id: 'reflex', name: '反應', desc: '槍械命中、迴避、先攻。' }, { id: 'tech', name: '技術', desc: '組裝與改裝、醫療。' },
  { id: 'intellect', name: '智識', desc: '竄網、RAM、調查。' }, { id: 'resolve', name: '意志', desc: '感載上限與消退。' }, { id: 'charm', name: '魅力', desc: '交涉、誘惑、表演。' },
]

// 技能：資料的技能表（dataRules）已經有，這裡補的是只載假世界時引用得到它們（worldFor 單載這一包；兩邊都有時 makeWorldGame 用資料的那一份）
const SKILLS: Rec[] = [
  { id: 'cyberware', name: '義體學', attr: 'tech', desc: '義體學。' },
  { id: 'medicine', name: '醫療', attr: 'tech', desc: '醫療。' },
]

// ---- 整包 ----

/** M4 的幾筆（內容種類 → 一串）。bodyWorld() 把它併進 TEST_WORLD；沒有人定義的種類由 worldFor 濾掉。 */
export function bodyContent(): Record<string, unknown[]> {
  return {
    skill: SKILLS, faction: FACTIONS, part: PARTS, blueprint: BLUEPRINTS, quirk: QUIRKS, item: ITEMS, tuning: TUNINGS, malware: MALWARES, rogue_ai: ROGUE_AIS,
    event_scope: EVENT_SCOPES, event: [...CONTRACT_EVENTS, ...LURE_EVENTS],
    position: POSITIONS, night_skill: NIGHT_SKILLS, night_resonance: RESONANCES, tendency_tag: TAGS,
    facility_type: FACILITY_TYPES, special_map: SPECIAL_MAPS, district: DISTRICTS, block: BLOCKS, net_site: NET_SITES, npc: NPCS,
    enemy: CURTAIN_ENEMIES, curtain_night: CURTAIN_NIGHT_ENTRIES, curtain_table: CURTAIN_TABLES, defeat_event: STAGE_EVENTS, curtain_rule: [{ id: 'default' }],
    unreg_rule: UNREG_RULE, unreg_preset: UNREG_PRESETS,
    auction_house: AUCTION_HOUSES, auction_lot: AUCTION_LOTS, auction_bidder: AUCTION_BIDDERS,
    lifepath_entry: LIFEPATH, origin: ORIGINS, perk: PERKS, attribute: ATTRIBUTES,
  }
}

/**
 * TEST_WORLD（含內海）加上 M4 的幾筆：市場的西口接上診所街。回傳新的物件（呼叫的人可以改，不會動到下一次拿到的）。
 * 同一種內容種類接在同一個陣列上；同一個事件範圍（contract、rogue_ai）和資料的規則表同 id，後載入的取代。
 */
export function bodyWorld(): ContentPack {
  const pack = testWorld()
  for (const [kind, entries] of Object.entries(bodyContent())) pack.content[kind] = [...(pack.content[kind] ?? []), ...(structuredClone(entries) as unknown as ContentEntry[])]
  const market = (pack.content.block ?? []).find((b) => b.id === 'tw_market') as unknown as { exits: Record<string, unknown> } | undefined
  if (!market) throw new Error('bodyWorld：TEST_WORLD 沒有 tw_market')
  market.exits.E1 = { to: BODY_BLOCKS.clinics, arrive: 'E2' }
  return pack
}
