import type { ContentPack } from '@engine/src'
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
  // 阿蓮雜貨（天井市場）：新手的案子，信譽不用高
  { id: 'fx_alian', name: '阿蓮雜貨的後間', npc: 'npc_lian', district: 'hive', block: blockIdOf('hive', '天井市場'), kinds: ['steal_data', 'assassinate'], cut: 0.1 },
  // 夢露（中城段・北）：什麼案子都接，抽得多一點
  { id: 'fx_monroe', name: '夢露的店・後場', npc: 'npc_monroe', district: 'ave42', block: blockIdOf('ave42', '中城段・北'), kinds: ['steal_data', 'assassinate'], cut: 0.15 },
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

const LINKS: Rec[] = [
  { id: 'lk_cam', name: '關掉監視器', from: 'net', to: 'meat', type: 'skip', effect: { skip_explore: true } },
  { id: 'lk_cut', name: '大樓斷電', from: 'meat', to: 'meat', type: 'ease', effect: { encounter_half: true } },
  { id: 'lk_key', name: '員工憑證', from: 'meat', to: 'meat', type: 'open' },
  { id: 'lk_decoy', name: '假消息', from: 'opinion', to: 'meat', type: 'ease', effect: { foes_minus: 1 } },
]

const MODIFIERS: Rec[] = [
  { id: 'md_extra', name: '多一名守衛', text: '每一場現實遭遇多一個敵人。', effect: { foes_plus: 1 } },
  { id: 'md_alarm', name: '警報剛換過', text: '進去的時候警戒就有 10。', effect: { alert_start: 10 } },
]

export function commissionContent(): NonNullable<ContentPack['content']> {
  return { fixer: FIXERS, commission_type: TYPES, commission_link: LINKS, commission_modifier: MODIFIERS } as unknown as NonNullable<ContentPack['content']>
}
