import type { Change, ContentEntry } from '@engine/src'
import { DEMO_DECK, DEMO_DECK_SINK, DEMO_DECK_UID } from './net'

/**
 * 示意世界包的「身體」部分（M4-ui-body；dev/adr/0019 第三、五、六節）：兩座橋（蜂巢通用型與偏科的）、七件義體（義眼、義臂、皮下裝甲、反射加速器、藥泵、生體獸耳、光紋刺青）
 * 與它們的零件、兩筆併發症與兩筆殘響、四種藥與抑制劑，與開新局時的身體（`demoBodyChanges`：橋與甲板已經裝在身上，另外幾件放在背包裡）。
 * 診所、戒斷、治療的設施種類在 world.ts 的 FAC_TYPES（clinic、detox、therapy 的欄位）。調校、惡意韌體還沒有引擎的功能，等 M4-tuning、M4-malware 做完再補。
 * 整份是資料：沒有任何規則（費用、成本、休養、併發症的機率都是引擎的 cyber_rule 與 drug_rule 的預設）。數字照設計書的例子，是示意的。正式內容匯入之後整包換掉。
 * 不放進 engine/data。測試不用它（測試自帶最小假資料）。
 */
type Rec = Record<string, unknown>

// ---- 零件 ----
const part = (id: string, name: string, type: string, o: Rec = {}): Rec => ({
  id, name, type, material: 'mech', brand: '織女', grade: 2, price: 300, legal: 'free', cells: 1, stats: {}, weight: 0.5, size: 1, state: 'new', ...o,
})
const parts: Rec[] = [
  part('pt_chip_hive', '晶片「蜂巢 52」', 'chip', { price: 900, bridge: { capacity: 52 } }),
  part('pt_chip_ember', '晶片「餘燼 64」', 'chip', { grade: 3, price: 1600, brand: '鉻娘子', bridge: { capacity: 64 } }),
  part('pt_sw_even', '橋軟體「均衡」', 'software', { price: 300, bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
  part('pt_sw_net', '橋軟體「潛網者」', 'software', { price: 420, brand: '鉻娘子', bridge: { split: { meat: 1, net: 3, social: 1, media: 1 } } }),
  part('pt_lens', '感測器「寒鴉」', 'sensor', { price: 500 }),
  part('pt_plate_alloy', '合金板材', 'plate', { price: 400, stats: { armor: 2 } }),
  part('pt_plate_skin', '皮下薄板', 'plate', { price: 350, stats: { armor: 2 } }),
  part('pt_actuator', '致動器「鐵匠」', 'actuator', { price: 450, grade: 3 }),
  part('pt_neuron', '機械神經元', 'neuron', { price: 300 }),
  part('pt_neuron_fast', '機械神經元「快」', 'neuron', { price: 520, grade: 3, brand: '鉻娘子' }),
  part('pt_chip_reflex', '反射晶片', 'chip', { price: 600, grade: 3, brand: '鉻娘子' }),
  part('pt_ear_skin', '獸耳外皮', 'skin', { price: 500, material: 'bio', brand: '生體屋', grade: 1 }),
  part('pt_ink', '光紋墨', 'skin', { price: 120, material: 'bio', brand: '生體屋', grade: 1 }),
]

// ---- 設計圖 ----
const bp = (id: string, name: string, slot: string, o: Rec = {}): Rec => ({
  id, kind: 'cyberware', name, desc: `${name}：示意用的義體。`, brand: '織女', grade: 2, legal: 'free', price: 900, require: [], optional: [], slot, invasiveness: 'light', sink_cost: 2, ...o,
})
const blueprints: Rec[] = [
  bp('bp_bridge_hive', '蜂巢通用橋 II', 'bridge', {
    desc: '蜂巢街頭最常見的橋：四類容量平均分配，兩個調校槽。', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, price: 1200,
    require: [{ type: 'chip' }, { type: 'software' }], stock: { chip: 'pt_chip_hive', software: 'pt_sw_even' },
  }),
  bp('bp_bridge_net', '潛網者之友 III', 'bridge', {
    desc: '偏科的橋：內海的容量是別類的三倍，機能多一份回填。價錢貴、換橋的手術也貴。', grade: 3, brand: '鉻娘子', invasiveness: 'invasive', sink_cost: 5, bridge: { tuning_slots: 2 }, price: 2000,
    require: [{ type: 'chip' }, { type: 'software' }], stock: { chip: 'pt_chip_ember', software: 'pt_sw_net' }, effects: [{ mod: 'refill', amount: 1, label: '回填機能' }],
  }),
  bp('bp_eye', '義眼「寒鴉」II', 'eye', { sink_cost: 3, effects: [{ check: { skills: ['firearms'] }, amount: 1 }], require: [{ type: 'sensor' }], stock: { sensor: 'pt_lens' } }),
  bp('bp_arm', '義臂「鐵匠」III', 'arm', {
    grade: 3, invasiveness: 'invasive', sink_cost: 6, tags: ['limb'], effects: [{ attr: 'body', amount: 1 }],
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }], stock: { plate: 'pt_plate_alloy', actuator: 'pt_actuator', neuron: 'pt_neuron' },
  }),
  bp('bp_plating', '皮下裝甲 II', 'torso', {
    sink_cost: 2, needs_bridge: false, effects: [{ stat: 'bridge_sensitivity', amount: -15, label: '敏感度下降' }], require: [{ type: 'plate' }], stock: { plate: 'pt_plate_skin' },
  }),
  bp('bp_accel', '反射加速器 III', 'brain', {
    grade: 3, brand: '鉻娘子', invasiveness: 'invasive', sink_cost: 7, effects: [{ mod: 'initiative', amount: 2 }, { mod: 'ap_regen', amount: 1 }],
    require: [{ type: 'neuron' }, { type: 'chip' }], stock: { neuron: 'pt_neuron_fast', chip: 'pt_chip_reflex' },
  }),
  bp('bp_pump', '藥泵 II', 'torso', { sink_cost: 3, effects: [{ stat: 'max_hp', amount: 2 }], require: [{ type: 'actuator' }], stock: { actuator: 'pt_actuator' } }),
  bp('bp_ears', '生體獸耳 I', 'ear_throat', {
    grade: 1, brand: '生體屋', sink_cost: 4, needs_bridge: false, tags: ['bio'], effects: [{ attr: 'charm', amount: 1 }], scene_parts: { adds: ['ear'] },
    require: [{ type: 'skin', material: 'bio' }], stock: { skin: 'pt_ear_skin' },
  }),
  bp('bp_tattoo', '光紋刺青「花信」I', 'skin', {
    grade: 1, brand: '生體屋', invasiveness: 'surface', sink_cost: 1, needs_bridge: false, tattoo: { kind: 'deco' }, require: [{ type: 'skin', material: 'bio' }], stock: { skin: 'pt_ink' },
  }),
  // 痛覺編輯器：無視重傷懲罰；生命值的顯示變模糊（標籤 pain_editor 是介面讀的，lib/bodyView 的 PAIN_TAG）
  bp('bp_pain', '痛覺編輯器 II', 'brain', { sink_cost: 3, tags: ['pain_editor'], effects: [{ unit_tag: 'ignore_wound_penalty' }], require: [{ type: 'neuron' }], stock: { neuron: 'pt_neuron' } }),
  // 訂閱的義體：付訂閱費才不會鎖住
  bp('bp_eye_sub', '織女訂閱義眼 II', 'eye', { sink_cost: 3, lock: 'subscription', effects: [{ check: { skills: ['firearms'] }, amount: 1 }], require: [{ type: 'sensor' }], stock: { sensor: 'pt_lens' }, price: 700 }),
]

// ---- 怪癖：兩筆併發症、兩筆殘響 ----
const quirks: Rec[] = [
  { id: 'cx_scar', name: '疤痕組織', desc: '縫合的地方留了疤，動作偶爾卡一下。', kind: 'complication', pool: ['complication'], applies: ['cyberware'], effects: [{ attr: 'reflex', amount: -1 }] },
  { id: 'cx_ache', name: '陰雨會痛', desc: '下雨天接口會痛，撐不了太久。', kind: 'complication', pool: ['complication'], applies: ['cyberware'], effects: [{ stat: 'max_hp', amount: -2 }] },
  { id: 'cx_echo_1', name: '殘響：舊主人的手', desc: '前一個主人用慣的力道，還留在這隻手上。', kind: 'echo', pool: ['used'] },
  { id: 'cx_echo_2', name: '殘響：夜班的眼睛', desc: '這雙眼睛看過太多夜班，一到凌晨就自己對焦。', kind: 'echo', pool: ['used'] },
]

// ---- 藥：四種與抑制劑 ----
const drugItem = (id: string, name: string, drug: Rec, o: Rec = {}): Rec => ({ id, name, desc: `${name}：示意用的藥。`, category: 'drug', grade: 1, size: 0, legal: 'free', price: 60, drug, ...o })
const items: Rec[] = [
  drugItem('it_drug_focus', '專注劑', { duration: { minutes: 240 }, effects: [{ check: { skills: ['hack'] }, amount: 2 }], addiction: { per_dose: 20, withdrawal: { days: 5, effects: [{ check: { skills: ['hack'] }, amount: -2 }] } } }),
  drugItem('it_drug_stim', '興奮劑', {
    duration: { battle: true }, effects: [{ mod: 'hit', amount: 1 }], side: [{ mod: 'evade', amount: -1 }], upkeep_load: 3,
    addiction: { per_dose: 10, withdrawal: { days: 3, effects: [{ mod: 'hit', amount: -1 }] } },
  }, { use: { ap: 1, target: 'self', effects: [{ op: 'drug' }] } }),
  drugItem('it_drug_calm', '鎮靜劑', { duration: { minutes: 1440 }, eases_withdrawal: true }),
  drugItem('it_drug_cloud', '雲絲', { duration: { minutes: 60 }, effects: [{ attr: 'charm', amount: 1 }], addiction: { per_dose: 45, withdrawal: { days: 5, effects: [{ attr: 'resolve', amount: -2 }] } } }, { price: 150 }),
  drugItem('it_supp', '抑制劑一週份', { suppressant: true }, { price: 80 }),
]

export function bodyContent(): Record<string, ContentEntry[]> {
  return { part: parts, blueprint: blueprints, quirk: quirks, item: items } as unknown as Record<string, ContentEntry[]>
}

// ---- 開局的身體 ----

const BRIDGE_UID = 'B_START'
const EYE_UID = 'E_START'
/** 開局裝在身上的三件：橋、甲板（腦部）、義眼；沉溺的下限就是它們的成本合計（開局的沉溺補到下限） */
export const DEMO_START_SINK = 4 + DEMO_DECK_SINK + 3

const give = (id: string, qty = 1, data?: Rec): Change => ({ op: 'item', id, qty, ...(data ? { data } : {}) }) as unknown as Change
const stockOf = (bpId: string): Record<string, string> => {
  const b = blueprints.find((x) => x.id === bpId) as { stock?: Record<string, string> } | undefined
  return { ...(b?.stock ?? {}) }
}

/**
 * 開新局時的身體：橋、甲板、義眼已經裝在身上（使用者 2026-11-25：示意世界包開局直接裝著，不經手術與休養）；背包裡放幾件義體（義臂、皮下裝甲、反射加速器、藥泵、獸耳、刺青、痛覺編輯器、
 * 訂閱義眼、另一座橋）與幾種藥，讓診所與角色頁有東西可看。只給有主角的局（建角的開新局），跟在建角的報告後面。
 */
export function demoBodyChanges(pc = 'pc'): Change[] {
  const bag: Array<[string, string]> = [
    ['bp_arm', 'U_ARM'], ['bp_plating', 'U_PLATE'], ['bp_accel', 'U_ACCEL'], ['bp_pump', 'U_PUMP'], ['bp_ears', 'U_EARS'], ['bp_tattoo', 'U_INK'], ['bp_pain', 'U_PAIN'],
    ['bp_eye_sub', 'U_EYESUB'], ['bp_bridge_net', 'U_BRIDGE2'],
  ]
  return [
    ...bag.map(([id, uid]) => give(id, 1, { uid, parts: stockOf(id), ...(id === 'bp_eye_sub' ? { lock: { kind: 'subscription', owed: 0 } } : {}) })),
    give('it_drug_focus', 2), give('it_drug_stim', 2), give('it_drug_calm', 1), give('it_drug_cloud', 1), give('it_supp', 1),
    {
      op: 'actor.ext', id: pc, key: 'cyber',
      value: {
        pieces: [
          { uid: BRIDGE_UID, bp: 'bp_bridge_hive', kind_of: 'blueprint', slot: 'bridge', parts: stockOf('bp_bridge_hive'), sink: 4, at: 0, registered: true },
          { uid: DEMO_DECK_UID, bp: DEMO_DECK, kind_of: 'deck', slot: 'brain', parts: {}, sink: DEMO_DECK_SINK, at: 0, registered: true },
          { uid: EYE_UID, bp: 'bp_eye', kind_of: 'blueprint', slot: 'eye', parts: stockOf('bp_eye'), sink: 3, at: 0, registered: true },
        ],
      },
    } as unknown as Change,
    { op: 'actor.track', id: pc, track: 'sink', delta: DEMO_START_SINK } as unknown as Change,
  ]
}
