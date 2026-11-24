import type { ContentPack, Feature } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { blockIdOf } from './world'

/**
 * 示意世界包的委託部分（dev/work/M2-ui-commission.md 第 6 項）：兩位中間人、兩種委託的類型、詞條、連動。
 * 格式是引擎的內容種類（fixer、commission_type、commission_modifier、commission_link）：整份是資料，沒有規則；
 * 地圖沿用 engine/data 已經有的（map_office_small、map_club），敵人也是（照區的勢力挑）。
 * 正式內容匯入之後整包換掉。M2 只有現實面有玩法（內海 M3、輿論 M5），所以每個階段都有現實面可選；
 * 內海與輿論面只列在階段上，派人輔助時照引擎擲骰。
 */

type Rec = Record<string, unknown>

const FIXERS: Rec[] = [
  // 阿蓮雜貨（天井市場）：新手的案子，信譽不用高；後台是蜂巢的孤星連（backer：它對你的敵對值到「懸賞」，這位中間人就不接你）
  { id: 'fx_alian', name: '阿蓮雜貨的後間', npc: 'npc_lian', district: 'hive', block: blockIdOf('hive', '天井市場'), kinds: ['steal_data', 'assassinate'], cut: 0.1, backer: 'lonestar' },
  // 夢露（中城段・北）：什麼案子都接，抽得多一點；後台是四十二番街的拆體客
  { id: 'fx_monroe', name: '夢露的店・後場', npc: 'npc_monroe', district: 'ave42', block: blockIdOf('ave42', '中城段・北'), kinds: ['steal_data', 'steal_net', 'assassinate'], cut: 0.15, backer: 'strippers' },
]

const TYPES: Rec[] = [
  {
    id: 'steal_data', name: '竊密', main: 'meat', decisive: { kind: 'take', at: 'T' },
    stages: [
      { name: '摸進去', faces: ['meat', 'net'] },
      { name: '往裡面走', faces: ['meat', 'opinion'] },
      { name: '拿到東西', faces: ['meat'] },
    ],
    extra: [{ name: '多一道門', faces: ['meat', 'net'] }, { name: '換班的空檔', faces: ['meat', 'opinion'] }],
    branches: { stealth: 'stealth', talk: 'negotiate' },
    brief: '{faction}在{district}的{place}放了一份資料，{fixer}要它。',
    gives: { meat: ['lk_key', 'lk_cut'], net: ['lk_cam'], opinion: ['lk_decoy'] },
  },
  {
    id: 'assassinate', name: '暗殺', main: 'meat', decisive: { kind: 'fight' },
    stages: [
      { name: '找到他', faces: ['meat', 'net', 'opinion'] },
      { name: '靠近他', faces: ['meat', 'net'] },
      { name: '動手', faces: ['meat'] },
    ],
    extra: [{ name: '他的護衛', faces: ['meat', 'net'] }, { name: '最後一道門', faces: ['meat', 'opinion'] }],
    branches: { stealth: 'stealth', talk: 'negotiate' },
    brief: '替{fixer}處理{faction}在{district}的一個人，地點在{place}。',
    gives: { meat: ['lk_key', 'lk_cut'], net: ['lk_cam'], opinion: ['lk_decoy'] },
  },
]

/**
 * 竊密（內海）：主面是內海的類型（M3-ui-commission-net；COMMISSIONS 7.1 節）。三個階段，最後一個只有內海（決定性的一步：進網內下載）；
 * 前兩個階段可選現實或內海。內海面蕾絲粉、目標是下載。現實面用的圖是引擎的小辦公室複本（fits 寫這個類型）。
 */
const NET_TYPES: Rec[] = [{
  id: 'steal_net', name: '竊密（內海）', main: 'net', decisive: { kind: 'fight' },
  stages: [
    { name: '訪客網', faces: ['meat', 'net'] },
    { name: '員工層', faces: ['net', 'meat'] },
    { name: '下載', faces: ['net'] },
  ],
  extra: [{ name: '多一層子網', faces: ['net'] }, { name: '中途出了狀況', faces: ['net', 'meat'] }],
  branches: { stealth: 'stealth' },
  brief: '{faction}在{district}的{place}有一份帳本，{fixer}要它。要潛進內海才拿得到。',
  gives: { net: ['lk_cam', 'lk_door', 'lk_cred'], meat: ['lk_cut', 'lk_key'] },
  net: { facility: 'archive', objectives: ['download'], lace: 'pink' },
}]
/** 引擎的小辦公室複本：fits 寫上面那個類型（地圖的 fits 是地圖自己宣告的，示意包不改引擎的檔） */
function demoOffice(): Rec {
  const src = (CORE_PACK.content as unknown as { special_map: Rec[] }).special_map.find((m) => m.id === 'map_office_small')
  if (!src) throw new Error('示意包：找不到引擎的 map_office_small。')
  return { ...structuredClone(src), id: 'map_demo_office', fits: ['steal_net'], district_weight: { hive: 1, ave42: 1 } }
}

const LINKS: Rec[] = [
  { id: 'lk_cam', name: '關掉監視器', from: 'net', to: 'meat', type: 'skip', effect: { skip_explore: true } },
  { id: 'lk_cut', name: '大樓斷電', from: 'meat', to: 'meat', type: 'ease', effect: { encounter_half: true } },
  { id: 'lk_key', name: '員工憑證', from: 'meat', to: 'meat', type: 'open' },
  { id: 'lk_door', name: '接管控制節點', from: 'net', to: 'meat', type: 'ease', effect: { encounter_half: true } },
  { id: 'lk_cred', name: '員工憑證（網內）', from: 'net', to: 'net', type: 'ease', effect: { foes_minus: 1 } },
  { id: 'lk_decoy', name: '假消息', from: 'opinion', to: 'meat', type: 'ease', effect: { foes_minus: 1 } },
]

const MODIFIERS: Rec[] = [
  { id: 'md_extra', name: '多一名守衛', text: '每一場現實遭遇多一個敵人。', effect: { foes_plus: 1 } },
  { id: 'md_alarm', name: '警報剛換過', text: '進去的時候警戒就有 10。', effect: { alert_start: 10 } },
]

export function commissionContent(): NonNullable<ContentPack['content']> {
  return { fixer: FIXERS, commission_type: [...TYPES, ...NET_TYPES], commission_link: LINKS, commission_modifier: MODIFIERS, special_map: [demoOffice()] } as unknown as NonNullable<ContentPack['content']>
}

// ---- 一件寫好的四階段副本（COMMISSIONS 第 11 節的樣本）：主面是內海、第三階段是必經的現實階段 ----

/** 這件寫好的委託的 id（阿蓮雜貨的後間每天都有它） */
export const DEMO_NET_OFFER = 'of_demo_net4'

const meatFace = (gives: string | undefined, goal: string, extra: Rec = {}): Rec => ({
  map: 'map_office_small', encounter: [], goal: { kind: 'reach', at: goal }, ...(gives ? { gives } : {}),
  branches: [{ id: 'assault', kind: 'assault', entry: 'E2' }, { id: 'staff_door', kind: 'stealth', entry: 'E2', need: { basic: 'stealth', level: 3 } }], ...extra,
})
const netFace = (layer: string, extra: Rec = {}): Rec => ({
  layer, encounter: ['minion'], objective: { kind: 'download', turns: 2 }, branches: [{ id: 'assault', kind: 'assault' }, { id: 'borrowed_login', kind: 'stealth', need: { basic: 'interface', level: 2 } }], ...extra,
})

/**
 * 藍鯨物流的帳本：四個階段的竊密，主面內海。
 * 1 外圍：現實（摸進去拿員工證）或內海（訪客網，下載，給員工憑證）。2 員工層：現實或內海。3 現實的資料埠：只有現實，給「資料埠」。
 * 4 隔離區：只有內海，要先有「資料埠」（隔離區），到核心層下載。
 */
export const DEMO_NET_COMMISSION: Rec = {
  id: 'cm_demo_net4', name: '藍鯨物流的帳本', kind: 'steal_net', main: 'net', scale: 'medium', grade: 2, target_faction: 'lonestar', district: 'hive', conditions: [],
  stages: [
    { name: '外圍', faces: { meat: meatFace('badge', 'T3'), net: netFace('guest', { gives: 'cred', objective: { kind: 'download', turns: 2 }, lace: 'white' }) } },
    { name: '員工層', faces: { meat: meatFace(undefined, 'T3'), net: netFace('staff', { objective: { kind: 'download', turns: 2 } }) } },
    { name: '現實的資料埠', faces: { meat: meatFace('airgap_open', 'D1') } },
    { name: '隔離區', faces: { net: netFace('core', { encounter: ['boss'], locked_by: 'airgap_open', objective: { kind: 'download', turns: 2 }, lace: 'pink' }) } },
  ],
  links: {
    badge: { type: 'skip', name: '員工證', effect: { stage: 2, encounter_half: true } },
    cred: { type: 'open', name: '員工憑證', effect: { stage: 2, trace_start: -15, lace_down: true } },
    airgap_open: { type: 'open', name: '資料埠', effect: { stage: 4, gate_open: true, near_core: true } },
  },
}

const DEMO_NET_OFFER_ENTRY: Rec = {
  id: DEMO_NET_OFFER, title: '藍鯨物流的帳本', brief: '藍鯨物流的帳本在內海裡，要潛進去下載。第三階段要先在現實插上資料埠。', reward: 1800, min_rep: 0, commission: DEMO_NET_COMMISSION,
  unknowns: [
    { id: 'u_lace', cat: 'lace', text: '第一階段的訪客網由白蕾絲看守。', reveal: { flag: 'lace_s1' }, face: 'net' },
    { id: 'u_gate', cat: 'path', text: '員工層的現實面有一扇員工門，潛行過得去。', reveal: { stage: 2 } },
  ],
}

/** 掛上「阿蓮雜貨的後間今天有哪些委託」：多一件寫好的內海委託（示意包的功能；測試不裝它） */
export function demoCommissionFeature(): Feature {
  return {
    id: 'demo_commission',
    install(k) {
      k.hooks.on('fixer.offers', 'demo_start', ({ fixer }) => (fixer.id === 'fx_alian' ? [structuredClone(DEMO_NET_OFFER_ENTRY)] as never : undefined))
    },
  }
}
