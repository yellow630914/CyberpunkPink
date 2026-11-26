import type { Change, ContentEntry } from '@engine/src'
import { blockIdOf } from './world'

/**
 * 示意世界包的「未登錄零件」部分（M4-ui-parts；dev/adr/0019 第十七、十九節、CRAFTING 11.1、11.2 節）：
 * 一張小的規則表 unreg_rule（外皮、槍管、板材各兩三項方向；並把委託報酬的機率 sources.reward.chance 蓋成 1，讓第一件 III 級委託一定帶零件）、
 * 六筆預設清單（AI 關著或失敗時的名字與說明）、三筆怪癖（同人的池）、一個帶 unreg_desk 的攤位（天井市場的零件攤，同人眾的委託台）、
 * 一位教機械的 NPC（阿鉚，帶 tutor；每個時段沉溺 +1）、和開局用效果給到好感 100 與一個大人情的勢力（同人眾；`demoPartsChanges`）。
 * 整份是資料：沒有任何規則（價錢、等級上限、天數、怪癖的候選、學費與時段都是引擎的預設）。文字中性。數字是示意的。正式內容匯入之後整包換掉。
 * 不放進 engine/data。測試自帶更小的一份，不用這裡。
 */
type Rec = Record<string, unknown>

/** 勢力：同人眾（engine/data 已有；委託台的好感、固定窗口都看它） */
export const DEMO_WINDOW_FACTION = 'doujin'
/** 教機械的老師 */
export const DEMO_TUTOR_NPC = 'npc_arbo'
export { PARTS_FACILITY_TYPE } from './facilityTypes'

const opt = (id: string, name: string, put: 'stats' | 'affinity', key: string, amount: number, cost: number, max: number, o: Rec = {}): Rec => ({ id, name, put, key, amount, cost, max, ...o })
const unreg_rule: Rec[] = [{
  id: 'default',
  options: {
    skin: [
      opt('skin_social', '社交親和', 'affinity', 'social', 1, 0.5, 3, { tags: ['社交'] }),
      opt('skin_conceal', '藏匿', 'stats', 'conceal', 1, 0.5, 2, { tags: ['隱蔽'] }),
      opt('skin_style', '風格', 'stats', 'style', 1, 0.5, 3, { tags: ['風格'] }),
    ],
    barrel: [
      opt('barrel_damage', '傷害', 'stats', 'damage', 1, 1, 2, { tags: ['火力'] }),
      opt('barrel_range', '射程', 'stats', 'range_far', 1, 0.5, 2, { tags: ['射程'] }),
      opt('barrel_pierce', '穿透', 'stats', 'pierce', 1, 1, 1, { grade_min: 2, tags: ['火力'] }),
    ],
    plate: [
      opt('plate_armor', '護甲', 'stats', 'armor', 1, 0.5, 3, { max_at: { 1: 1, 2: 2 }, tags: ['防護'] }),
      opt('plate_light', '減重', 'stats', 'weight', -0.2, 0.5, 2, { tags: ['輕量'] }),
      opt('plate_conceal', '藏匿', 'stats', 'conceal', 1, 0.5, 2, { tags: ['隱蔽'] }),
    ],
  },
  // 委託報酬：III 級以上的委託一定多一件（正式的規則是 0.1）
  sources: { reward: { chance: 1 } },
}]

const preset = (id: string, type: string, name: string, desc: string, quirk_text: string, o: Rec = {}): Rec => ({ id, type, name, desc, quirk_text, ...o })
const unreg_preset: Rec[] = [
  preset('up_skin_snail', 'skin', '蝸殼', '一層薄薄的外皮，貼上去之後幾乎看不出接縫。', '在濕氣重的夜晚會輕輕發亮。'),
  preset('up_skin_haze', 'skin', '薄霧', '顏色很淡的外皮，在人群裡不太引人注意。', '碰到熱的東西會暫時變得有點透明。'),
  preset('up_barrel_stub', 'barrel', '短舌', '切短過的槍管，社團的人說這樣比較好帶。', '擊發之後會在掌心留下一點餘溫。'),
  preset('up_barrel_echo', 'barrel', '回音管', '內壁刻了細紋的槍管，聲音比別人的沉一點。', '空膛的時候，會發出很小的回聲。'),
  preset('up_plate_patch', 'plate', '拼貼', '用幾塊不同年份的板材拼起來，邊緣打磨得很仔細。', '放久了會自己發出細微的金屬聲。'),
  preset('up_plate_wall', 'plate', '老牆', '拆自一面舊牆的板材，又厚又重，倒是很可靠。', '摸起來總是比室溫涼一點。'),
]

const quirk: Rec[] = [
  { id: 'uq_squeak', name: '會作響', desc: '它在口袋裡會輕輕作響。', kind: 'quirk', pool: ['doujin'] },
  { id: 'uq_night', name: '夜光', desc: '天黑之後，接縫的地方會透出一圈淡淡的光。', kind: 'quirk', pool: ['doujin'] },
  { id: 'uq_stiff', name: '偏硬', desc: '手感比同類的硬一些，用慣了才順手。', kind: 'quirk', pool: ['doujin'], stats: { range_far: -1 } },
]

// ---- 委託台（一種設施：同人眾的攤位，每天都開） ----
const facility_type: Rec[] = [{ id: 'fac_unreg_desk', name: '同人社團的委託台', unreg_desk: { faction: DEMO_WINDOW_FACTION, brand: DEMO_WINDOW_FACTION } }]

// ---- 教機械的老師 ----
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']
const npc: Rec[] = [{
  id: DEMO_TUTOR_NPC, name: '阿鉚', kind: 'citizen', age: 47, gender: 'male', occupation: '做了二十年的機械維修師', guard: 13, wealth: 1,
  haunts: [{ district: 'hive', block: blockIdOf('hive', '四號塔'), facility: 'fac_talk', time: ALL }],
  persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] },
  bridge: { sensitivity: 30, tolerance: 35, craving: 20, docility: 20 }, sink: 6,
  attrs: { tech: 14, body: 11, resolve: 12 }, skills: { mechanics: 4 },
  // 只教機械；每個時段沉溺 +1（老師的癖好：上課的時候順便讓人試新的接口）
  tutor: { skills: ['mechanics'], sink: 1, where: '四號塔的晾衣場' },
}]

export function partsContent(): Record<string, ContentEntry[]> {
  return { unreg_rule, unreg_preset, quirk, facility_type, npc } as unknown as Record<string, ContentEntry[]>
}

/**
 * 開局用效果給到：同人眾的好感 100 與一個欠你的大人情（勢力的固定窗口、委託台的怪癖二選一都要這個）。
 * 好感是量表 favor 直接設定；人情走引擎的變更 favor.add。
 */
export function demoPartsChanges(): Change[] {
  return [
    { op: 'meter', kind: 'favor', key: DEMO_WINDOW_FACTION, set: 100 },
    { op: 'favor.add', dir: 'owed_to_pc', who: DEMO_WINDOW_FACTION, size: 'big', note: '同人眾的大人情' },
  ] as unknown as Change[]
}
