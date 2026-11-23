/**
 * 主角在第二版多出來的資料（假存檔「夜班之後」）：基本功、學會與裝上的技能、夜課、橋參數、傾向、豔名、性經歷、
 * 甲板與構裝、SKIN、指南、快照。數字照 CORE_RULES 第 2、7 節、SKILLS 1.3 節、LEWD_SYSTEM 第 1、5 節。
 */
export const START_BASICS: Record<string, number> = {
  格鬥: 1, 運動: 2, 重裝: 0, 槍械: 4, 操縱: 0, 隱匿: 2, 機械: 1, 義體學: 0, 醫療: 1,
  介面: 2, 調查: 2, 街頭直覺: 4, 威嚇: 1, 定力: 2, 同步: 1, 交涉: 3, 誘惑: 1, 表演: 1,
}

/** 學會的技能（槍手 3 階、掮客 2 階）與裝在橋上的。id 是「樹:名字」。 */
export const START_LEARNED = [
  'gun:戰鬥直覺', 'gun:要害射擊', 'gun:掩護射擊', 'gun:連射控制', 'gun:點放', 'gun:定點射', 'gun:壓制姿態',
  'broker:人面', 'broker:集火', 'broker:小心後面！',
]
export const START_NIGHT = ['night:common:慢慢摸', 'night:common:偷偷看你']

/** 橋的型號：容量照 CYBERWARE 7.1 節（織女 標準，晶片 III）。調校槽在 cyber.bridge 的第 2、3 格。 */
export const BRIDGE_MODEL = { item: 'it_3882ae', name: '織女 標準', chip: 'III', cap: { 現實: 13, 內海: 13, 社交: 13, 媒體: 13 }, feature: '換配置只要半小時' }

/** 調校（LEWD_SYSTEM 第 4 節）：裝在橋的調校槽裡的韌體設定檔，每個都是雙面的。 */
export const TUNINGS = [
  { name: '痛覺轉譯', pro: '受到的生命值傷害有 20% 改成感載', con: '重傷時更容易過載', seller: '鉻娘子、黑拳圈' },
  { name: '聚光', pro: '被注視時檢定 +2', con: '沒人看的時候定力 −2；豔名成長加倍', seller: '萬華鏡的藝人合約' },
  { name: '冰后', pro: '抵抗誘惑、勸降、粉蕾絲 +4', con: '親密關係不降低沉溺；餘韻沒有正面效果', seller: '企業高層、貞網局探員' },
  { name: '靜水', pro: '每回合感載自然消退加倍', con: '開不了全同步', seller: '正規診所' },
]

export const START_PARAMS = { 敏感度: 46, 耐受: 38, 慾求: 22, 馴化: 15 }
/** 傾向（LEWD_SYSTEM 1.1 節）：四條軸 0～5 級；標籤只有沒有、有、深。潛在的不顯示。 */
export const START_TENDENCY = {
  axes: { 關係: 1, 感官: 2, 身體: 0, 扮相: 1 },
  tags: { 溺愛: '有', 聲音: '有', 窺視: '有', 霓虹龐克: '有', 街頭: '深' } as Record<string, '有' | '深'>,
  latent: ['暴露'],
}
/** 每一區的豔名 0～100（LEWD_SYSTEM 第 5 節）。 */
export const START_FAME: Record<string, number> = { hive: 12, ave42: 31, sakura: 4, crown: 0, oldport: 6, glass: 0, rust: 0, under: 2 }
/** 性經歷記錄（LEWD_SYSTEM 3.4 節）：AI 在場景後記下，主角、夥伴、NPC 各有一份。 */
export const START_SEX = {
  count: 9, partners: 3, first: '第 2 年・和舊情那一位・在屋頂村', favorite: '雷',
  recent: [
    { when: '第 11 天', who: '雷', where: '番街下城段的旅館坡', kind: '兩個人' },
    { when: '第 6 天', who: '一位生成的舞者', where: '夜店「過載」的後台', kind: '兩個人' },
  ],
}

/** 甲板與構裝（CYBERSPACE 4.2 節、ITEMS 第 11 節）：入門甲板-200 構裝槽 4、防火牆 12。 */
export const START_DECK = { slots: ['cs_kefu1', 'cs_window1', 'cs_probe2', null] as Array<string | null>, activeGuard: 'cs_window1' as string | null, skins: ['it_64cfe6', 'it_d212f6', 'it_0f2ab1'], skinWorn: 'it_d212f6' }

/** 備忘錄：收進來的指南（看過的與沒看過的）。 */
export const START_GUIDES = { collected: ['g_check', 'g_money', 'g_run', 'g_combat'], seen: ['g_check', 'g_money'] }
