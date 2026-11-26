import type { Change, ContentEntry } from '@engine/src'

/**
 * 示意世界包的拍賣行（M4-ui-auction；dev/adr/0019 第十八節、LEWD_SYSTEM 6.2 節）：
 * 一家拍賣行（白槌：玻璃岸、週五、黃金時段那一段；好感或推薦函入會）、十件拍品（零件、義體、藝術品、機密各兩件、契約兩件；零件與義體用 craft.ts、body.ts 已有的）、
 * 五位競標者（一位是示意包裡認識的何伯）、一位寫得出推薦函的 NPC（常客），與一種帶 auction 的設施（把玻璃岸的「拍賣行」接上）。
 * 整份是資料：沒有任何規則（底價、一階、佣金、仿品、競標者的預算都是引擎的 auction_rule 預設）。文字中性。數字是示意的。
 * 開局：`demoAuctionChanges` 讓常客的親密度到 45（可以靠交情拿推薦函）；想直接給會員用效果 auction_ref（`demoAuctionRefEffect`）。
 * 不放進 engine/data。測試自帶更小的一份，不用這裡。
 */
type Rec = Record<string, unknown>

export const AUCTION_HOUSE = 'ah_white_hammer'
/** 寫得出推薦函的常客 */
export const AUCTION_REF_NPC = 'npc_regular'
export { AUCTION_FACILITY_TYPE } from './facilityTypes'

const facility_type: Rec[] = [{ id: 'fac_auction', name: '拍賣行', auction: { house: AUCTION_HOUSE } }]

// 週五（0 是週一）黃金時段（19～23）；一場六件（十件裡抽）、五位競標者裡到四～五位；契約至少一件
const auction_house: Rec[] = [{
  id: AUCTION_HOUSE, name: '白槌', weekday: 4, segment: 'prime', lots: [6, 6], kinds: ['part', 'cyberware', 'art', 'secret', 'contract'], must: ['contract'], bidders: [4, 5],
  member: { faction: 'eden', favor_min: 40, ref: true },
}]

const lot = (id: string, kind: string, o: Rec): Rec => ({ id, kind, ...o })
const auction_lot: Rec[] = [
  lot('al_barrel_ember', 'part', { part: 'pt_barrel_ember', desc: '鉻娘子的槍管，打磨得很乾淨。' }),
  lot('al_actuator_hi', 'part', { part: 'pt_actuator_hi', desc: '重型的致動器，原廠的包裝還在。' }),
  lot('al_arm', 'cyberware', { blueprint: 'bp_arm', desc: '義臂「鐵匠」的原廠組合。' }),
  lot('al_accel', 'cyberware', { blueprint: 'bp_accel', desc: '反射加速器，附一張保養紀錄。' }),
  lot('al_painting', 'art', { name: '《雨夜的霓虹》', item: 'it_auction_painting', market: 2400, desc: '一幅小尺寸的油畫，畫的是玻璃岸的雨夜。', cert: '附鑑定書，簽名與畫廊的登記相符。' }),
  lot('al_sculpt', 'art', { name: '纏線的小雕像', item: 'it_auction_sculpt', market: 1800, desc: '用舊線材纏成的小雕像，手掌大小。', cert: '附鑑定書，作者是玻璃岸的一位新銳。' }),
  lot('al_secret_key', 'secret', { name: '一把沒有標籤的鑰匙', item: 'it_auction_key', market: 3000, desc: '主辦方只說：它打得開一個地方。', cert: '主辦方不附任何說明。' }),
  lot('al_secret_note', 'secret', { name: '一則寫了一半的消息', effects: [{ kind: 'flag', key: 'demo_auction_note', value: true }], market: 2000, desc: '得標的人才看得到內容。', cert: '主辦方不附任何說明。' }),
  lot('al_contract_nana', 'contract', { name: '一份債務契約（奈奈）', npc: 'npc_nana', contract: { type: 'debt', debt: 2400 }, market: 2400, desc: '一份轉手的債權，債務人是一位年輕的行者。' }),
  lot('al_contract_jo', 'contract', { name: '一份債務契約（喬）', npc: 'npc_jo', contract: { type: 'debt', debt: 1800 }, market: 1800, desc: '一份轉手的債權，債務人在街上跑過一陣子單。' }),
]

const bidder = (id: string, name: string, interests: string[], o: Rec = {}): Rec => ({ id, name, interests, ...o })
const auction_bidder: Rec[] = [
  bidder('ab_collector', '戴手套的收藏家', ['art', 'secret']),
  bidder('ab_dealer', '義體商人老白', ['cyberware', 'part']),
  bidder('ab_broker', '穿灰西裝的掮客', ['contract', 'secret']),
  bidder('ab_hebo', '何伯', ['part', 'art'], { npc: 'npc_hebo' }),
  bidder('ab_guest', '不具名的來賓', ['art', 'cyberware', 'contract']),
]

const item = (id: string, name: string, price: number, desc: string): Rec => ({ id, name, desc, category: 'misc', grade: 3, size: 1, legal: 'free', price })
const items: Rec[] = [
  item('it_auction_painting', '《雨夜的霓虹》', 2400, '一幅小尺寸的油畫，畫的是玻璃岸的雨夜。'),
  item('it_auction_sculpt', '纏線的小雕像', 1800, '用舊線材纏成的小雕像，手掌大小。'),
  item('it_auction_key', '一把沒有標籤的鑰匙', 3000, '打得開一個地方，只是沒有人說得清是哪裡。'),
]

const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']
const npc: Rec[] = [{
  id: AUCTION_REF_NPC, name: '白槌的常客', kind: 'citizen', age: 52, gender: 'female', occupation: '每週五都來的老主顧', guard: 14, wealth: 4, auction_ref: [AUCTION_HOUSE],
  haunts: [{ district: 'glass', time: ALL }],
  persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] },
  attrs: { charm: 13, intellect: 13 }, skills: { negotiate: 3 },
}]

export function auctionContent(): Record<string, ContentEntry[]> {
  return { facility_type, auction_house, auction_lot, auction_bidder, item: items, npc } as unknown as Record<string, ContentEntry[]>
}

/** 開局：常客和你的親密度 45（夠靠交情寫推薦函；不是會員，要自己去拍賣行請他寫） */
export function demoAuctionChanges(): Change[] {
  return [{ op: 'meter', kind: 'affinity', key: AUCTION_REF_NPC, set: 45 }] as unknown as Change[]
}

/** 直接給推薦函的效果（開局想讓主角一進門就是會員時：用引擎的效果 auction_ref；沒有人註冊它時略過） */
export const demoAuctionRefEffect = (): Record<string, unknown> => ({ kind: 'auction_ref', house: AUCTION_HOUSE, by: AUCTION_REF_NPC })
