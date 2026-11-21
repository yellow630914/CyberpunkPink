/**
 * 契約（LEWD_SYSTEM 第 7 節、LIFE 3.4 節、UI 第 11 節）。面板不改任何數值，只是事件的入口與契約的檢視。
 * 主角在這份存檔裡是小契的持約人；主角身上沒有管理級的契約，「契約人的一面」用範例看。所有人都是成年人。
 */
export const RELATIONS = ['名實相符', '名義上的契約，實為夥伴', '情趣', '激烈', '戀人'] as const
export const ORDER_KINDS = ['差事', '改造', '侍奉', '工作', '規矩', '回報', '出借'] as const

export interface HeldContract {
  npc: string
  origin: string
  kind: '債務契約' | '工作契約' | '自願的私人契約'
  level: '管理'
  relation: typeof RELATIONS[number]
  debt: number
  home: string
  job: string
  split: string
  tame: number
  params: { 敏感度: number; 耐受: number; 慾求: number; 馴化: number }
  rules: string[]
  cyber: number
  /** 紙上勾了哪幾種指令（LIFE 3.4 節第四條） */
  orders: string[]
}
export const HELD: HeldContract[] = [
  {
    npc: 'npc_xiaoqi', origin: '欠胭脂堂的債，債權轉給你', kind: '債務契約', level: '管理', relation: '名實相符', debt: 8400,
    home: '四號塔（你的家）', job: '夜店「過載」的吧台', split: '她七成、你三成', tame: 38,
    params: { 敏感度: 41, 耐受: 33, 慾求: 27, 馴化: 38 }, rules: ['宵禁 02:00'], cyber: 2,
    orders: ['差事', '工作', '規矩', '回報', '侍奉'],
  },
]
/** 現在能對她做的事（LEWD_SYSTEM 7.5 節）：條件、冷卻；被篩選關掉的寫原因。 */
export const HOLDER_EVENTS = [
  { name: '派差事', state: '可以', note: '替你跑一趟、送東西、打聽' },
  { name: '安排工作', state: '可以', note: '換到別的店、別的班' },
  { name: '談一談', state: '可以', note: '問她最近怎樣；可能改親密度' },
  { name: '送去改造', state: '冷卻 3 天', note: '上次是第 11 天', cooldown: true, filter: 'filterContract' },
  { name: '叫來侍奉', state: '可以', note: '叫她過來；會不會進入成人場景由事件決定', filter: 'filterContract' },
]

/** 主角是契約人時的範例（不在這份存檔裡）。 */
export const SAMPLE_MINE = {
  holder: { name: '白薇', where: '四十二番街・伊甸園本店「樂園」', satisfaction: 62, relation: '名實相符' as const },
  queue: [
    { kind: '工作', text: '今晚 22:00 到「樂園」的二樓接待，做到 04:00。', due: '9 小時', penalty: '橋鎖住反射加速器一天' },
    { kind: '回報', text: '每週一次到樂園讓她看你的橋。', due: '2 天', penalty: '滿意 −10' },
    { kind: '差事', text: '把一個封好的晶片盒送到舊港的海棠樓。', due: '已經過期', penalty: '一陣感載 +12', overdue: true },
  ],
  rules: [['禁區', '冠冕區的中央廣場'], ['宵禁', '05:00'], ['指定服裝', '頸環不准拿下來'], ['不准見的人', '蘿莎（蜜糖會）']] as Array<[string, string]>,
  escape: [
    { path: '還清', step: '還差 C$21,400；滿意 80 以上可以談價' },
    { path: '找到合約的漏洞', step: '第四條劃掉了「出借」：可以拿這一頁去談' },
    { path: '蜜糖會的地下路線', step: '還沒有門路：糖姐的親密度要 40' },
  ],
  resistDc: 15,
}
