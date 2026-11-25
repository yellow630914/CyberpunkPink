import type { Change, ContentEntry } from '@engine/src'

/**
 * 示意世界包的「組裝」部分（M4-ui-craft；dev/adr/0019 第四節）：三張設計圖（手槍、防彈衣、義臂；義臂用 body.ts 的 bp_arm）、
 * 各自幾個牌子的零件（星旗、織女、鉻娘子、同人）、每一類一個高一級的零件（超規用）、兩個生體零件、三筆瑕疵與怪癖、兩張授權書，
 * 槍店、同人攤、原廠各一間帶 craft 的設施種類（世界在 world.ts 把對應的舊設施指到這些種類），與開局的零件與設計圖（`demoCraftChanges`）。
 * 整份是資料：沒有任何規則（難度、工錢、成功率、拆解的機率都是引擎的 craft_rule 預設）。數字是示意的。正式內容匯入之後整包換掉。
 * 不放進 engine/data。測試不用它（測試自帶最小假資料）。
 */
type Rec = Record<string, unknown>

// ---- 零件 ----
const part = (id: string, name: string, type: string, o: Rec = {}): Rec => ({
  id, name, type, material: 'mech', brand: '星旗', grade: 2, price: 200, legal: 'free', cells: 1, stats: {}, weight: 0.4, size: 1, state: 'new', ...o,
})
const parts: Rec[] = [
  // 手槍：槍管與機構
  part('pt_barrel_star', '槍管「定音」', 'barrel', { price: 300, stats: { damage: 1 }, weight: 0.5 }),
  part('pt_barrel_hz', '槍管「織針」', 'barrel', { brand: '織女', price: 340, stats: { range_far: 1 }, weight: 0.4 }),
  part('pt_barrel_ember', '槍管「餘燼」', 'barrel', { brand: '鉻娘子', grade: 3, price: 620, stats: { damage: 2, range_far: 1 }, legal: 'register', weight: 0.6 }),
  part('pt_action_star', '機構「快門」', 'action', { price: 260, stats: { hit: 1 }, weight: 0.6 }),
  part('pt_action_doujin', '機構「社團改」', 'action', { brand: '同人', price: 180, state: 'doujin', stats: { hit: 1, damage: 1 }, drawback: { range_far: -1 }, weight: 0.6 }),
  // 防彈衣：纖維與板材
  part('pt_fiber_hz', '纖維「蛛絲」', 'fiber', { brand: '織女', price: 220, stats: { armor: 1 }, weight: 0.8 }),
  part('pt_fiber_star', '纖維「帆布」', 'fiber', { price: 160, stats: { armor: 1 }, weight: 1 }),
  part('pt_fiber_chrome', '纖維「鉻絲」', 'fiber', { brand: '鉻娘子', grade: 3, price: 480, stats: { armor: 2 }, weight: 0.9 }),
  part('pt_plate_star', '板材「老兵」', 'plate', { price: 330, stats: { armor: 2 }, weight: 1.2 }),
  part('pt_plate_chrome', '板材「鏡面」', 'plate', { brand: '鉻娘子', grade: 3, price: 560, stats: { armor: 3 }, weight: 1.1 }),
  // 義臂（bp_arm 要板材、致動器、神經元）：body.ts 已有 pt_plate_alloy、pt_actuator、pt_neuron，這裡補不同牌子、一個高一級的、兩個生體的
  part('pt_actuator_star', '致動器「老鐵」', 'actuator', { price: 380, stats: { body: 1 } }),
  part('pt_actuator_hi', '致動器「重錘」', 'actuator', { brand: '鉻娘子', grade: 4, price: 900, stats: { body: 2 }, legal: 'register' }),
  part('pt_actuator_bio', '培養肌「蜜腺」', 'actuator', { material: 'bio', brand: '生體屋', price: 700, stats: { body: 1 }, state: 'living' }),
  part('pt_neuron_bio', '活體神經「夜鶯」', 'neuron', { material: 'bio', brand: '生體屋', price: 650, state: 'living' }),
]

// ---- 設計圖：手槍、防彈衣 ----
const bp = (id: string, name: string, kind: string, o: Rec = {}): Rec => ({
  id, kind, name, desc: `${name}：示意用的設計圖。`, brand: '星旗', grade: 2, legal: 'register', price: 900, size: 1, weight: 0.5, require: [], optional: [], ...o,
})
const blueprints: Rec[] = [
  bp('bp_pistol', '手槍「回火」', 'weapon', {
    desc: '巷口槍店賣的制式手槍：槍管決定傷害，機構決定準頭。', class: 'pistol', carry: 'side', price: 900,
    require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_barrel_star', action: 'pt_action_star' },
  }),
  bp('bp_vest', '防彈衣「巷口」', 'armor', {
    desc: '纖維加一片板材的防彈背心；選配的外皮決定它穿起來像什麼。', armor: 1, covers: ['armor'], weight_class: 'medium', conceal: 2, price: 800,
    style: { tag: 'street', value: 1 }, exposure: 0,
    require: [{ type: 'fiber' }, { type: 'plate' }], optional: [{ type: 'skin' }], stock: { fiber: 'pt_fiber_star', plate: 'pt_plate_star' },
  }),
]

// ---- 怪癖：兩筆瑕疵、一筆同人的魔改 ----
const quirks: Rec[] = [
  { id: 'cq_loose', name: '鬆動', desc: '有個接點沒咬緊，用久了會晃。', kind: 'flaw', pool: ['flaw'], stats: { hit: -1 } },
  { id: 'cq_hot', name: '發熱', desc: '連續用幾次就燙手，要等它涼。', kind: 'flaw', pool: ['flaw'], stats: { range_far: -1 } },
  { id: 'cq_glow', name: '社團的手筆：發光', desc: '社團在外殼上加了一條會發光的紋路，看起來很酷，也很顯眼。', kind: 'quirk', pool: ['doujin'] },
]

// ---- 授權書 ----
const licence = (id: string, name: string, teaches: string, o: Rec = {}): Rec => ({
  id, name, desc: `${name}：用掉之後學會這張設計圖的組法。`, category: 'blueprint', grade: 2, size: 0, legal: 'free', price: 500, teaches, ...o,
})
const items: Rec[] = [
  licence('it_lic_vest', '授權書「巷口防彈衣」', 'bp_vest'),
  licence('it_lic_arm', '授權書「義臂・鐵匠」', 'bp_arm', { grade: 3, price: 1200 }),
]

// ---- 設施：槍店（店家代工與染色）、同人攤（同人社團）、原廠（織女） ----
const facility_type: Rec[] = [
  { id: 'fac_gunshop', name: '槍店', craft: { by: 'shop' }, dye: true, teach: [{ skill: 'firearms', price: 1200, slots: 2 }] },
  { id: 'fac_doujin', name: '同人攤', craft: { by: 'doujin' } },
  { id: 'fac_factory', name: '原廠櫃檯', craft: { by: 'factory', brand: '織女' } },
]
/** 舊設施的 id → 它的設施種類（world.ts 的 typeOf 用它） */
export const CRAFT_FACILITY_TYPE: Record<string, string> = { gunshop: 'fac_gunshop', print: 'fac_doujin', cybershop: 'fac_factory' }

export function craftContent(): Record<string, ContentEntry[]> {
  return { part: parts, blueprint: blueprints, quirk: quirks, item: items, facility_type } as unknown as Record<string, ContentEntry[]>
}

// ---- 開局的組裝 ----
const give = (id: string, qty = 1, data?: Rec): Change => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as unknown as Change

/**
 * 開新局時的組裝：會做手槍；背包裡放兩張授權書（防彈衣、義臂）與三張設計圖的零件，每一類兩三個牌子、一個超規用的、兩個生體的。
 * 沒有主角也能給（設計圖記在引擎的狀態裡）；跟在建角的報告後面。
 */
export function demoCraftChanges(): Change[] {
  return [
    { op: 'ext', key: 'craft', value: { known: ['bp_pistol'] } } as unknown as Change,
    give('it_lic_vest'), give('it_lic_arm'),
    give('pt_barrel_star'), give('pt_barrel_hz'), give('pt_barrel_ember'), give('pt_action_star'), give('pt_action_doujin'),
    give('pt_fiber_hz'), give('pt_fiber_star'), give('pt_fiber_chrome'), give('pt_plate_star'), give('pt_plate_chrome'), give('pt_plate_alloy'),
    give('pt_actuator_star'), give('pt_actuator_hi'), give('pt_actuator_bio'), give('pt_neuron_bio'), give('pt_actuator'), give('pt_neuron'),
  ]
}
