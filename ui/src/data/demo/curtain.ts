import type { ContentEntry } from '@engine/src'

/**
 * 示意世界包的簾後館（M4-ui-curtain；dev/adr/0019 第十二節、CYBERSPACE 8.7、8.8 節）：
 * 一個簾口設施（暗礁的一個節點，站在上面才能報名）、兩個夜（不同的文化）、每個文化兩種雙形象的敵人與一個層主（也有雙形象）、
 * 三張表（點單、賞箱、獎品）、一件 stage 種類的戰敗事件與它的 _plain 版本，與一份只改要改的規則表。
 * 整份是資料：沒有任何規則（席次、保證金、場熱、打賞、三條路的數字全用引擎的預設）。文字中性、不露骨；成人場景的正文是 AI 的事。
 * 所有人形的敵人都是成年人。不放進 engine/data；正式內容匯入時整包換掉。測試自帶更小的一份，不用這裡。
 */
type Rec = Record<string, unknown>

/** 簾口所在的街區（暗礁的一個節點；示意包放在「地下層」底下，只有去處「簾後館的簾口」走得到） */
export const CURTAIN_DISTRICT = 'under'
export const CURTAIN_BLOCK = 'b_under_curtain'
export const CURTAIN_DOOR_MARKER = 'F1'
/** 去處（net_site）：潛入之後選它，人就站到簾口 */
export const CURTAIN_SITE = 'site_curtain'
/** 兩個夜的 id 與文化 */
export const CURTAIN_NIGHTS = { stage: 'cn_stage', honey: 'cn_honey' } as const
export const CURTAIN_CULTURES = { stage: 'stage_troupe', honey: 'honey_house' } as const

// ---- 簾口：街區與設施 ----
const LAYOUT = ['###########', '#.........#', 'E..F......#', '#.........#', '###########']
const special_map: Rec[] = [{
  id: 'm_curtain_door', kind: 'block', size: [11, 5],
  sheets: [{ id: 'street', name: '鯨落・斷線的後門', size: [11, 5], layout: LAYOUT, cells: [{ id: 'E1', at: [0, 2], mark: 'E', name: '往鯨落' }, { id: CURTAIN_DOOR_MARKER, at: [3, 2], mark: 'F', name: '簾口' }] }],
}]
const block: Rec[] = [{
  id: CURTAIN_BLOCK, district: CURTAIN_DISTRICT, name: '鯨落・斷線的後門', kind: 'block', map: 'm_curtain_door', exits: {},
  facilities: { [CURTAIN_DOOR_MARKER]: { type: 'fac_curtain_door', name: '簾口' } },
}]
const facility_type: Rec[] = [{ id: 'fac_curtain_door', name: '簾口', curtain_door: true }]
const net_site: Rec[] = [{ id: CURTAIN_SITE, name: '簾後館的簾口', kind: 'block', need: 'deck', desc: '暗礁裡會員制的地城。簾口每週換位置，持有效的邀請函，鯨落「斷線」酒館後門的領位員會帶你過去。', block: CURTAIN_BLOCK, marker: CURTAIN_DOOR_MARKER }]

// ---- 夜與敵人 ----
/** 兩個夜：不同的文化、不同的包場勢力、對到的傾向標籤（傾向標籤是 creation.ts 與 scene.ts 的） */
const curtain_night: Rec[] = [
  { id: CURTAIN_NIGHTS.stage, name: '舞台之夜', faction: 'kaleido', tags: ['doll_chip', 'voice'], culture: CURTAIN_CULTURES.stage },
  { id: CURTAIN_NIGHTS.honey, name: '蜜糖之夜', faction: 'honey', tags: ['pamper', 'restraint', 'public'], culture: CURTAIN_CULTURES.honey },
]

const program = (id: string, culture: string, rank: 'minion' | 'elite' | 'boss', a: [string, string], b: [string, string], neutral: [string, string]): Rec => ({
  id, name: a[0], desc: `簾後館的${rank === 'boss' ? '層主' : rank === 'elite' ? '熟面孔' : '演出者'}：只打感載，不打生命。`, faction: 'none', rank, grades: [1, 5], kind: 'program', culture,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
  // 網內的敵人要有武器構裝（Game.contentWarnings 會點名沒有的）
  constructs: [{ id: `cs_${id}`, class: 'pistol', name: '聚光燈' }],
  forms: {
    a: { name: a[0], look: a[1], points_at: ['male'] },
    b: { name: b[0], look: b[1], points_at: ['female', 'femboy', 'trans_f', 'futa'] },
  },
  neutral: { name: neutral[0], look: neutral[1] },
})
const enemy: Rec[] = [
  program('cs_stage_min', CURTAIN_CULTURES.stage, 'minion', ['舞台上的領舞', '一身亮片的女演出者。'], ['舞台上的男主角', '穿著燕尾服的男演出者。'], ['一團聚光', '沒有輪廓的一團光。']),
  program('cs_stage_eli', CURTAIN_CULTURES.stage, 'elite', ['嚴厲的編舞老師', '戴著眼鏡、拿著節拍棒的女老師。'], ['油膩的經紀人', '西裝皺巴巴的男經紀人。'], ['一面面具', '沒有表情的一面面具。']),
  program('cs_stage_boss', CURTAIN_CULTURES.stage, 'boss', ['台柱', '站在聚光燈正中央的女台柱。'], ['館主', '握著麥克風的男館主。'], ['主持人的輪廓', '只有一套制服的輪廓。']),
  program('cs_honey_min', CURTAIN_CULTURES.honey, 'minion', ['甜點師', '推著點心車的女服務生。'], ['黏人的大叔', '一直想搭話的男客人。'], ['一團糖霜', '一團黏黏的糖霜。']),
  program('cs_honey_eli', CURTAIN_CULTURES.honey, 'elite', ['蜜糖護士', '穿著粉色制服的女護理員。'], ['老教授', '戴著老花眼鏡的男教授。'], ['一套制服', '空空的一套白制服。']),
  program('cs_honey_boss', CURTAIN_CULTURES.honey, 'boss', ['蜜糖館長', '端著茶杯的女館長。'], ['老道', '拿著拂塵的男道長。'], ['茶席的輪廓', '一張擺好的茶席。']),
]

// ---- 三張表 ----
const curtain_table: Rec[] = [
  { id: 'ct_order', kind: 'order', rows: [{ weight: 3, name: '台詞', order: 'line' }, { weight: 2, name: '收尾', order: 'finish' }, { weight: 2, name: '守規矩', order: 'rules' }, { weight: 1, name: '合演', order: 'duet' }] },
  { id: 'ct_chest', kind: 'chest', rows: [{ weight: 3, name: '票根箱', stubs: [3, 8] }, { weight: 1, name: '觀眾的紙條', double: true }, { weight: 1, name: '神祕的賞箱', prize: true }] },
  { id: 'ct_prize', kind: 'prize', rows: [{ weight: 2, name: '紀念徽章', give: [{ kind: 'item', id: 'it_curtain_pin', qty: 1 }] }, { weight: 1, name: '票根一把', stubs: [10, 20] }] },
]
const item: Rec[] = [{ id: 'it_curtain_pin', name: '簾後館的紀念徽章', desc: '獎品室發的：館方的紀念品。', category: 'misc', grade: 2, size: 0, legal: 'free', price: 300 }]

// ---- 戰敗事件：落幕。五件都接同一份骨架（輸在哪一幕走哪一件）；_plain 是純舞台的版本（後台的一段訓話與帳，沒有場景） ----
// cast 要寫 gen（npcs 的 director.cast 只認 npc、known、gen）：沒寫的話補演永遠略過。落幕那一區（簾口在 under）已有 npc_gen（people.ts）
const EVENT_IDS = ['df_stage_foyer', 'df_stage_headliner', 'df_stage_backstage', 'df_stage_vip', 'df_stage_encore']
const stageEvent = (id: string): Rec => ({
  id, name: '落幕', kind: 'stage', factions: [], fails_commission: false, cast: [{ role: 'a', gen: { kind: 'citizen' } }], fallback: `${id}_plain`,
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
const defeat_event: Rec[] = [...EVENT_IDS.map(stageEvent), ...EVENT_IDS.map(plainEvent)]

/** 規則表：只寫要改的（會費、保證金、場熱、打賞、三條路用引擎的預設）；示意包的簾後館不加別的規則 */
const curtain_rule: Rec[] = [{ id: 'default' }]

export function curtainContent(): Record<string, ContentEntry[]> {
  return { special_map, block, facility_type, net_site, curtain_night, enemy, curtain_table, item, defeat_event, curtain_rule } as unknown as Record<string, ContentEntry[]>
}
