import type { Npc } from './types'

/** 固定 NPC（docs/world/NPCS.md）。數值是這份假存檔的狀態。 */
export const NPCS: Record<string, Npc> = {
  npc_xiaomai: {
    id: 'npc_xiaomai',
    name: '小麥',
    district: '蜂巢',
    age: 22,
    identity: '蜂巢的信差・名冊上的夥伴',
    tags: ['掮客 3', '名媛 2', '元氣', '天然'],
    relation: '同一棟塔裡一起長大的朋友。',
    affinity: 34,
    stage: '熟',
    loyalty: 72,
    lineStage: 2,
    mood: '心情不錯',
    known: [
      { k: '想要', v: '存錢把那隻顏色不對的右耳換掉。' },
      { k: '怕', v: '被關在室內不能動。' },
      { k: '傾向', v: '？？？', unknown: true },
      { k: '秘密', v: '？？？', unknown: true },
      { k: '沉溺', v: '12・清明' },
      { k: '人情', v: '她欠你 1' },
    ],
    memories: [
      { when: '第 9 天・四號塔・重要', text: '她替你把一封不能經過郵局的信送到了九號塔的封鎖線外面。', weight: 3 },
      { when: '第 3 天・天井市場・日常', text: '你們在阿蓮的店門口分一碗麵，她把蛋留給你。', weight: 1 },
    ],
  },
  npc_lian: {
    id: 'npc_lian', name: '阿蓮', district: '蜂巢', age: 37, identity: '蜂巢的中間人・阿蓮雜貨', tags: ['中間人'], relation: '你欠她一筆。', affinity: 41, stage: '交心', loyalty: 0, lineStage: 1, mood: '平常',
    known: [], memories: [],
  },
  npc_hebo: {
    id: 'npc_hebo', name: '何伯', district: '蜂巢', age: 71, identity: '四號塔的樓長', tags: ['樓長'], relation: '每個月來敲門收房租的人。', affinity: 18, stage: '生', loyalty: 0, lineStage: 1, mood: '平常',
    known: [], memories: [],
  },
  npc_laotie: {
    id: 'npc_laotie', name: '老鐵', district: '舊港', age: 52, identity: '槍店「回火」的店主', tags: ['店主'], relation: '賣過你兩把槍。', affinity: 24, stage: '熟', loyalty: 0, lineStage: 1, mood: '平常',
    known: [], memories: [],
  },
}

/** 和小麥說話的話題（UI.md 3.9 節的對話畫面）。回應是寫好的假資料，之後由 AI 的敘事任務產生。 */
export interface TalkTopic { id: string; name: string; isNew?: boolean; skill: string; mod: number; dc: number; lines: string[]; quote: string; changes: string[]; affinity: number }

export const XIAOMAI_TOPICS: TalkTopic[] = [
  { id: 'ear', name: '那隻右耳', skill: '交涉', mod: 5, dc: 12, affinity: 1,
    lines: ['你問她那隻深灰色的右耳是怎麼來的。小麥伸手摸了一下耳尖，說是兩年前在西棟的二手攤裝的，原本那隻被拆體客的人剪走了。'],
    quote: '「顏色不對，可是聽得很清楚。等我存夠了錢，就換一隻跟左邊一樣的。」',
    changes: ['親密度 +1', '已知：右耳的來歷'] },
  { id: 'notice', name: '七號塔的公告', isNew: true, skill: '交涉', mod: 5, dc: 12, affinity: 2,
    lines: ['小麥說七號塔的電梯又壞了，管理員這次沒有叫人修，反而在電梯門口貼了一張緋櫻警備局的公告。她說她送信經過的時候拍了一張照片，拿出手機給你看。'],
    quote: '「公告上說要清查沒登記的義體。我覺得他們要找的是人，不是義體。」',
    changes: ['親密度 +2', '傳聞：七號塔的清查公告', '共同記憶 +1'] },
  { id: 'ledger', name: '藍鯨的帳本', isNew: true, skill: '交涉', mod: 5, dc: 14, affinity: 1,
    lines: ['你提到藍鯨物流的帳本。小麥想了一下，說她上週替藍鯨的一個倉管送過兩次信，收件的地址都是舊港的第三倉。'],
    quote: '「信封很厚，摸起來像晶片。我沒有拆，真的。」',
    changes: ['親密度 +1', '線索：第三倉的地址'] },
  { id: 'route', name: '最近在送誰的信', skill: '街頭直覺', mod: 5, dc: 13, affinity: 1,
    lines: ['小麥把郵差包打開給你看，一半是四號塔住戶的帳單，另一半是寄到屋頂村的包裹。'],
    quote: '「三毛又在屋頂架了新的天線，說是要聽冠冕區的頻道。」',
    changes: ['親密度 +1'] },
]

export const XIAOMAI_INVITES = [
  { name: '一起吃晚餐', cost: 36, note: '露露餐館・現在就去，花 1 小時', ok: true },
  { name: '約一個時間', cost: 0, note: '指定日子、時段與地點，她會記得', ok: true },
  { name: '帶她回據點', cost: 0, note: '你的公寓・她會看一眼你的房間', ok: true },
  { name: '邀她同居', cost: 0, note: '要親密度 60（親近）以上，而且據點要有空床', ok: false, reason: '親密度 34，要 60 以上。' },
  { name: '召集出委託', cost: 0, note: '她現在有空；開召集頁', ok: true },
]

export const AFFINITY_STAGES = [
  { at: -100, name: '仇' }, { at: -40, name: '嫌' }, { at: 0, name: '生' }, { at: 20, name: '熟' },
  { at: 40, name: '交心' }, { at: 60, name: '親近' }, { at: 80, name: '羈絆' },
]
export function affinityStage(n: number): string {
  let s = '仇'
  for (const st of AFFINITY_STAGES) if (n >= st.at) s = st.name
  return s
}

export const RELATION_LINE = [
  { name: '認識', need: '招募' },
  { name: '信任', need: '20＋委託' },
  { name: '秘密', need: '40＋線一' },
  { name: '抉擇', need: '60＋線二' },
  { name: '結局', need: '80＋線三' },
]
