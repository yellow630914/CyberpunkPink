/**
 * 成人場景的資料（LEWD_SYSTEM 第 3 節；DATA 3.2、3.3、3.4 節的樣子）。所有參與者都是成年人。
 * 部位、體位、技能（建立連接的那一種行動）、道具、示範的場景。數字照 3.5 節的「一格」：
 * 對方的感載多 1d3，或自己的感載少 1d3，或契合 +3，或主動權 +10。
 */
export type PartId = '口' | '左手' | '右手' | '胸' | '前' | '後' | '腿足' | '尾'
export const BASE_PARTS: PartId[] = ['口', '左手', '右手', '胸', '前', '後', '腿足']
export type Who = 'me' | 'them'
export type SyncLevel = '淺' | '標準' | '深' | '全'
/** 同步原則（CORE_RULES 第 5 節）：受到的感載的倍率 */
export const SYNC_MULT: Record<SyncLevel, number> = { 淺: 0.5, 標準: 1, 深: 1.5, 全: 2.5 }

/** 體位：碰得到哪些部位（我的 → 對方的）、雙方受到的感載倍率、上位是誰、對應的標籤、要不要學 */
export interface Position {
  id: string; name: string
  /** 能建立的連接：[主動的一方的部位, 對方的部位]；兩邊都可以當主動的一方 */
  reach: Array<[PartId, PartId]>
  mult: Record<Who, number>
  top: Who | null
  tag?: string
  /** 基本的體位每個人都會；其餘的要學夜課的技能 */
  basic?: boolean
  lesson?: string
}
const HANDS: PartId[] = ['左手', '右手']
const handsTo = (parts: PartId[]): Array<[PartId, PartId]> => HANDS.flatMap(h => parts.map(p => [h, p] as [PartId, PartId]))
export const POSITIONS: Position[] = [
  { id: 'side', name: '並躺', basic: true, top: null, mult: { me: 1, them: 1 },
    reach: [['口', '口'], ['口', '胸'], ...handsTo(['胸', '前', '後', '腿足']), ['腿足', '腿足'], ['前', '前']] },
  { id: 'face', name: '面對面', basic: true, top: 'me', mult: { me: 1, them: 1.2 },
    reach: [['口', '口'], ['口', '胸'], ...handsTo(['胸', '前', '後']), ['前', '前'], ['胸', '胸']] },
  { id: 'behind', name: '從後面', basic: true, top: 'me', mult: { me: 1, them: 1.3 },
    reach: [['口', '後'], ...handsTo(['胸', '前']), ['前', '前'], ['前', '後'], ['尾', '前']] },
  { id: 'ride', name: '騎乘', top: 'them', mult: { me: 1.3, them: 1 }, tag: '主導', lesson: '夜課・騎乘',
    reach: [['口', '口'], ...handsTo(['胸', '前', '後']), ['前', '前'], ['胸', '口']] },
  { id: 'kneel', name: '跪姿', top: 'them', mult: { me: 1.2, them: 1.1 }, tag: '服從', lesson: '夜課・跪姿',
    reach: [['口', '前'], ['口', '腿足'], ...handsTo(['腿足', '前'])] },
]

/** 技能：用一個部位接對方的一個部位，建立連接；之後每回合照「持續」生效一次 */
export interface Technique {
  id: string; name: string; ap: number
  /** 用哪些部位（任一）→ 接對方的哪些部位（任一） */
  from: PartId[]; to: PartId[]
  /** 建立時：對方的感載骰（d3 的顆數，負的是 d6）、自己、契合 */
  now: { them: number; me: number; fit: number }
  /** 持續：每回合一次 */
  per: { them: number; me: number; fit: number }
  tag?: string
  /** 內容篩選（stores/settings 的 filter*）關掉時不出現 */
  filter?: 'filterRestraint' | 'filterPublic'
  /** 這一行在連接卡上寫的樣子 */
  verb: string
}
export const TECHNIQUES: Technique[] = [
  { id: 'stroke', name: '慢慢摸', ap: 1, from: ['左手', '右手'], to: ['胸', '前', '後', '腿足', '口'], now: { them: 1, me: 0, fit: 2 }, per: { them: 1, me: 0, fit: 2 }, verb: '慢慢摸' },
  { id: 'kiss', name: '親吻', ap: 1, from: ['口'], to: ['口', '胸'], now: { them: 1, me: 1, fit: 3 }, per: { them: 1, me: 1, fit: 2 }, verb: '吻著' },
  { id: 'lick', name: '用舌頭', ap: 2, from: ['口'], to: ['胸', '前', '後'], now: { them: 2, me: 0, fit: 2 }, per: { them: 2, me: 0, fit: 1 }, verb: '舔著' },
  { id: 'finger', name: '手指進去', ap: 2, from: ['左手', '右手'], to: ['前', '後'], now: { them: 2, me: 0, fit: 1 }, per: { them: 2, me: 0, fit: 1 }, verb: '手指在裡面' },
  { id: 'join', name: '插入', ap: 2, from: ['前', '尾'], to: ['前', '後'], now: { them: 2, me: 2, fit: 2 }, per: { them: 2, me: 2, fit: 2 }, verb: '在裡面' },
  { id: 'grind', name: '磨蹭', ap: 1, from: ['前', '腿足', '胸'], to: ['前', '腿足', '胸'], now: { them: 1, me: 1, fit: 2 }, per: { them: 1, me: 1, fit: 2 }, verb: '貼著磨蹭' },
  { id: 'hold', name: '按住手腕', ap: 1, from: ['左手', '右手'], to: ['左手', '右手'], now: { them: 0, me: 0, fit: 3 }, per: { them: 1, me: 0, fit: 1 }, tag: '拘束', filter: 'filterRestraint', verb: '按著' },
  { id: 'whisper', name: '耳邊的命令', ap: 1, from: ['口'], to: ['口'], now: { them: 1, me: 0, fit: 3 }, per: { them: 1, me: 0, fit: 1 }, tag: '御姐', verb: '在耳邊說' },
]

export interface Prop { id: string; name: string; note: string; ap: number }
export const SCENE_ITEMS: Prop[] = [
  { id: 'lube', name: '潤滑凝膠', note: '這一場所有連接的持續感載 +1（雙方）。', ap: 1 },
  { id: 'calm', name: '冷靜貼片', note: '自己的感載 −1d6，契合 −1。', ap: 1 },
]

/** 參與者 */
export interface Actor {
  name: string; role: string
  load: number; loadMax: number
  after: number; layers: number
  /** 敏感度 0～100：受到的感載 × (0.75 + 敏感度 ÷ 200)（CORE_RULES 4.2 節） */
  sens: number
  /** 意志的調整值：克制與每回合的消退 */
  will: number
  /** 馴化（橋參數）：開場的主動權 */
  tame: number
  tags: string[]
  /** 多出來的部位（義體、改造：例如尾巴） */
  extraParts?: PartId[]
  knows: string[]
}

export type Nature = '兩情相悅' | '交易（你是客人）' | '工作'
export const NATURE_INIT: Record<Nature, number> = { 兩情相悅: 0, '交易（你是客人）': 20, 工作: -20 }
export interface SceneSetup {
  id: string; place: string; nature: Nature
  /** 目的（套話、取悅……）；沒有就是 null */
  goal: string | null
  me: Actor; them: Actor
  /** 開場的體位 */
  pos: string
  /** 第一次和這個人 */
  first?: boolean
  /** scene_gate 的那一句（確認框的標題） */
  opening: string
  /** 名冊上的人（結算關係用） */
  npcId?: string
}

/** 示範的場景：琥珀（「半夢」的人偶・名媛，成年人），兩情相悅，順便套話。 */
export const DEMO_SCENES: SceneSetup[] = [
  {
    id: 'amber', place: '櫻町「半夢」的二樓', nature: '兩情相悅', goal: '套話：三樓那位常客', pos: 'side', first: true, opening: '琥珀拉著你上了二樓',
    me: { name: '你', role: '槍手', load: 0, loadMax: 38, after: 0, layers: 3, sens: 46, will: 0, tame: 10, tags: ['主導'], knows: ['side', 'face', 'behind'] },
    them: { name: '琥珀', role: '「半夢」的人偶・名媛・29 歲', load: 0, loadMax: 36, after: 0, layers: 3, sens: 58, will: 1, tame: 30, tags: ['御姐', '服從'], knows: ['side', 'face', 'ride', 'kneel'] },
  },
  {
    id: 'rin', place: '四號塔的屋頂', nature: '兩情相悅', goal: null, pos: 'face', opening: '小麥把郵差包放下，往你身邊靠過來', npcId: 'npc_xiaomai',
    me: { name: '你', role: '槍手', load: 0, loadMax: 38, after: 0, layers: 3, sens: 46, will: 0, tame: 10, tags: ['主導'], knows: ['side', 'face', 'behind'] },
    them: { name: '小麥', role: '蜂巢的信差・26 歲', load: 0, loadMax: 30, after: 0, layers: 2, sens: 52, will: 0, tame: 15, tags: ['獸'], extraParts: ['尾'], knows: ['side', 'face', 'behind'] },
  },
]
