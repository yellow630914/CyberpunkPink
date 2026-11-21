/**
 * 建角的資料（docs/systems/CHARACTER.md 第 1～5 節、CORE_RULES 第 1、2 節、CYBERWARE 第 7 節）。
 * 特質與生命軌跡的選項是示意：清單之後生成（CHARACTER 第 4 節、PLAN 5.2 節），這裡照文件裡的例子與格式寫。
 */
export const ATTRS = ['體格', '反應', '技術', '智識', '意志', '魅力'] as const
export type AttrName = typeof ATTRS[number]
export const ATTR_ARRAY = [15, 14, 13, 12, 10, 8] as const
export const ATTR_FREE = 2
export const ATTR_MAX = 18

/** 十八項基本功，照屬性分六組（CORE_RULES 第 2 節）。icon 是第 2 層的基本功圖標。 */
export const BASIC_SKILLS: Array<{ attr: AttrName; name: string; icon: string; hint: string }> = [
  { attr: '體格', name: '格鬥', icon: 'ic-bs_brawl', hint: '近身的命中與擒拿。' },
  { attr: '體格', name: '運動', icon: 'ic-bs_athletics', hint: '攀爬、衝刺、破門、負重。' },
  { attr: '體格', name: '重裝', icon: 'ic-bs_heavy', hint: '重武器的命中，以及重型防具穿不穿得動。' },
  { attr: '反應', name: '槍械', icon: 'ic-bs_firearms', hint: '手槍到步槍的命中。' },
  { attr: '反應', name: '操縱', icon: 'ic-bs_piloting', hint: '車、無人機、機甲的移動與射擊。' },
  { attr: '反應', name: '隱匿', icon: 'ic-bs_stealth', hint: '潛行、藏東西、扒竊。' },
  { attr: '技術', name: '機械', icon: 'ic-bs_mechanics', hint: '武器與護甲的組裝與修理、陷阱、開鎖。' },
  { attr: '技術', name: '義體學', icon: 'ic-bs_cyberware', hint: '義體的組裝、安裝、拆卸。' },
  { attr: '技術', name: '醫療', icon: 'ic-bs_medicine', hint: '急救、手術、生體件。' },
  { attr: '智識', name: '介面', icon: 'ic-bs_interface', hint: '快駭、破解、網內的操作。' },
  { attr: '智識', name: '調查', icon: 'ic-bs_investigate', hint: '主動找：搜索、踩點、查證、看穿謊言。' },
  { attr: '智識', name: '街頭直覺', icon: 'ic-bs_streetwise', hint: '被動察覺：嗅得到麻煩、埋伏與跟蹤；認人、打聽、黑市的行情。' },
  { attr: '意志', name: '威嚇', icon: 'ic-bs_intimidate', hint: '恐嚇、對峙、審問。' },
  { attr: '意志', name: '定力', icon: 'ic-bs_resolve', hint: '抵抗誘惑、控制、契約指令。' },
  { attr: '意志', name: '同步', icon: 'ic-bs_sync', hint: '撐住回灌；同時連得住幾台無人機、多大的機甲。' },
  { attr: '魅力', name: '交涉', icon: 'ic-bs_negotiate', hint: '談判、殺價、說服。' },
  { attr: '魅力', name: '誘惑', icon: 'ic-bs_seduce', hint: '勾引、成人場景、感載的社交攻擊。' },
  { attr: '魅力', name: '表演', icon: 'ic-bs_perform', hint: '演戲、偽裝、唱歌、直播。' },
]
export const BASIC_POINTS = 10
export const BASIC_MAX = 3

export const CORPS = ['緋櫻', '星旗', '崑崙', '蜜腺', '夜鶯', '萬華鏡', '伊甸園', '黑泉', '天使急救', '織女', '貞網局', '甜心食品'] as const

export interface Origin {
  id: string
  name: string
  line: string
  skill: string
  status: string
  home: string
  /** 好感 25 的勢力；兩個以上的是選一 */
  favor: string[]
  partner: string
  trait: { name: string; effect: string }
  /** 起始的錢的加減（CHARACTER 5.4 節：企業出身多、街頭出身少） */
  money: number
  extra?: string
}
export const ORIGINS: Origin[] = [
  { id: 'hive', name: '蜂巢', line: '巨型公寓裡長大的孩子，現在是大人了', skill: '街頭直覺', status: '市民', home: '蜂巢四號塔的單位', favor: ['孤星連', '野良'], partner: '小麥', trait: { name: '巷子裡的眼睛', effect: '在蜂巢的街頭直覺 +2' }, money: -200 },
  { id: 'corp', name: '企業', line: '社宅出身，離開了公司，或被公司離開', skill: '交涉', status: '市民（曾是社員）', home: '蜂巢四號塔的單位', favor: [...CORPS], partner: '潘妮', trait: { name: '看得懂合約', effect: '對企業的人社交檢定 +2' }, money: 800, extra: '十二家選一；選的那一家決定好感給誰、買得到哪一家的橋。不帶債。' },
  { id: 'nomad', name: '車族', line: '荒地上的車隊，進城討生活', skill: '操縱', status: '無籍', home: '一台能住的車，停在舊港的車廠', favor: ['野薔薇'], partner: '真白', trait: { name: '方向盤長在手上', effect: '操縱 +2' }, money: -300 },
  { id: 'pleasure', name: '歡場', line: '四十二番街的店裡長大、工作過', skill: '誘惑', status: '市民', home: '番街的隔間', favor: ['蜜糖會'], partner: '琥珀', trait: { name: '看人臉色', effect: '在歡場工作的收入 +15%' }, money: 0, extra: '扮相那一軸從 1 級開始，風格標籤「歡場」是「有」；四十二番街的豔名 +10。' },
  { id: 'oldport', name: '舊港', line: '碼頭與黑市的人', skill: '隱匿', status: '無籍', home: '舊港的倉庫隔間', favor: ['胭脂堂'], partner: '奈奈', trait: { name: '黑市熟客', effect: '黑市的交易收入 +15%' }, money: -200 },
  { id: 'sakura', name: '櫻町', line: '同人圈、女僕咖啡、劇場後台的人', skill: '表演', status: '市民', home: '櫻町的合租屋', favor: ['特攻姬', '女僕公會'], partner: '燈', trait: { name: '後台的人', effect: '在櫻町的表演 +2' }, money: 0, extra: '扮相那一軸從 1 級開始，風格標籤「櫻町系」是「有」；櫻町的豔名 +5。' },
  { id: 'under', name: '地下層', line: '沒有登記的人，從下面上來的', skill: '機械', status: '無籍', home: '月台市的鋪位', favor: ['野良', '牆語者'], partner: '零', trait: { name: '沒有登記的臉', effect: '被掃到時認出你的臉 −2' }, money: -400 },
]

export const START_MONEY = 1500

/** 起始的橋與義體（CHARACTER 2.1 節、CYBERWARE 7.1 節）。cap 是四類容量：現實／內海／社交／媒體。 */
export interface CyberOption { id: string; name: string; brand: string; grade: number; points: number; kind: 'bridge' | 'light' | 'invasive'; part: string; sink: number; cap?: [number, number, number, number]; note: string; corpOnly?: string }
export const CYBER_OPTIONS: CyberOption[] = [
  { id: 'br_hive', name: '蜂巢通用型', brand: '織女（二手）', grade: 1, points: 2, kind: 'bridge', part: '橋', sink: 5, cap: [10, 10, 10, 10], note: '便宜、到處能修。' },
  { id: 'br_junk', name: '拼裝橋', brand: '同人／黑市', grade: 1, points: 3, kind: 'bridge', part: '橋', sink: 6, cap: [12, 9, 13, 10], note: '一個隨機的怪癖；可能有後門，不在任何登記上。' },
  { id: 'br_std', name: '織女 標準', brand: '織女', grade: 2, points: 5, kind: 'bridge', part: '橋', sink: 6, cap: [13, 13, 13, 13], note: '換配置只要半小時。' },
  { id: 'br_field', name: '星旗 野戰', brand: '星旗', grade: 2, points: 5, kind: 'bridge', part: '橋', sink: 6, cap: [24, 8, 8, 8], note: '耐受 +15；敏感度 −15，開不了深同步。', corpOnly: '星旗' },
  { id: 'br_deep', name: '夜鶯 深水', brand: '夜鶯', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 6, cap: [9, 24, 11, 10], note: 'RAM +2；回報後門。', corpOnly: '夜鶯' },
  { id: 'br_hizakura', name: '緋櫻 奉公', brand: '緋櫻', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 7, cap: [20, 15, 10, 10], note: '授權鎖；出廠帶「忠犬」調校槽。', corpOnly: '緋櫻' },
  { id: 'br_rei', name: '伊甸園 伶', brand: '伊甸園', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 6, cap: [9, 13, 22, 11], note: '人格面具切換不花行動；多半綁契約條款。', corpOnly: '伊甸園' },
  { id: 'br_spot', name: '萬華鏡 聚光', brand: '萬華鏡', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 6, cap: [8, 12, 12, 22], note: '編輯點 +1；內建錄影。', corpOnly: '萬華鏡' },
  { id: 'cw_eye', name: '標準義眼-100', brand: '織女', grade: 1, points: 2, kind: 'light', part: '眼', sink: 3, note: '視野裡顯示距離與對方的護甲類別。' },
  { id: 'cw_voice', name: '囀・微糖', brand: '伊甸園', grade: 1, points: 1, kind: 'light', part: '喉', sink: 3, note: '聲帶：體格類加值改加在表演與誘惑。' },
  { id: 'cw_ears', name: '同人通用獸耳', brand: '同人', grade: 1, points: 1, kind: 'light', part: '耳', sink: 2, note: '可以選系，高頻聽得比較清楚。' },
  { id: 'cw_pump', name: '藥泵-100', brand: '織女', grade: 1, points: 1, kind: 'light', part: '軀幹', sink: 3, note: '每場一次從藥泵用藥不花行動點。' },
  { id: 'cw_deck', name: '入門甲板-100', brand: '織女', grade: 1, points: 2, kind: 'light', part: '腦', sink: 5, note: '構裝槽 3；防火牆 10。' },
  { id: 'cw_arm', name: 'M1 義臂', brand: '星旗', grade: 1, points: 3, kind: 'invasive', part: '臂', sink: 7, note: '義臂；內藏槽 1。' },
  { id: 'cw_leg', name: '花道・一分咲', brand: '緋櫻', grade: 1, points: 3, kind: 'invasive', part: '腿', sink: 6, note: '義腿：移動 +1。' },
  { id: 'cw_armor', name: '皮下裝甲-100', brand: '織女', grade: 1, points: 4, kind: 'invasive', part: '軀幹', sink: 6, note: '生命值上限 +5；護甲 +1。' },
]
export const CYBER_POINTS = 10
export const CYBER_POINT_MONEY = 500

/** 特質（CHARACTER 4.2、5.2、5.3 節）：一格 2 點，弱的 1 點，強的 3 點。缺陷退 1～3 點。 */
export interface TraitOption { id: string; name: string; cat: string; cost: number; effect: string; flaw?: boolean; adult?: boolean }
export const TRAITS: TraitOption[] = [
  { id: 't_people', name: '人面廣', cat: '街頭', cost: 2, effect: '街頭直覺 +2' },
  { id: 't_trouble', name: '嗅得到麻煩', cat: '街頭', cost: 2, effect: '先攻 +3' },
  { id: 't_black', name: '黑市熟客', cat: '街頭', cost: 1, effect: '黑市的交易收入 +15%' },
  { id: 't_talker', name: '能言善道', cat: '社交', cost: 2, effect: '交涉 +2' },
  { id: 't_reliable', name: '看起來可靠', cat: '社交', cost: 2, effect: '對市警與企業的人社交檢定 +2' },
  { id: 't_liar', name: '撒謊不眨眼', cat: '社交', cost: 2, effect: '表演 +2' },
  { id: 't_tough', name: '耐打', cat: '身體', cost: 2, effect: '生命值上限 +5' },
  { id: 't_steady', name: '手穩', cat: '身體', cost: 2, effect: '現實的命中 +1' },
  { id: 't_drink', name: '酒量好', cat: '身體', cost: 1, effect: '酒與藥的成癮檢定 +2' },
  { id: 't_tolerance', name: '天生耐受高', cat: '橋與神經', cost: 2, effect: '感載上限 +4' },
  { id: 't_sync', name: '同步體質', cat: '橋與神經', cost: 2, effect: '同步 +2' },
  { id: 't_hands', name: '巧手', cat: '技藝', cost: 2, effect: '機械 +2' },
  { id: 't_oldnet', name: '舊網的孩子', cat: '網路', cost: 2, effect: '介面 +2' },
  { id: 't_camera', name: '上鏡', cat: '媒體', cost: 2, effect: '打賞 +15%' },
  { id: 't_voice', name: '聲音好聽', cat: '媒體', cost: 1, effect: '唱歌與直播的表演 +2' },
  { id: 't_sensitive', name: '敏感體質', cat: '慾望', cost: 2, effect: '成人場景裡契合 +2', adult: true },
  { id: 'f_pain', name: '怕痛', cat: '缺陷', cost: 1, flaw: true, effect: '重傷檢定 −2' },
  { id: 'f_mouth', name: '口無遮攔', cat: '缺陷', cost: 2, flaw: true, effect: '交涉 −2' },
  { id: 'f_old', name: '舊傷', cat: '缺陷', cost: 2, flaw: true, effect: '生命值上限 −5' },
  { id: 'f_bed', name: '認床', cat: '缺陷', cost: 1, flaw: true, effect: '不在自己的床上睡，感載少退一半' },
  { id: 'f_lace', name: '對粉蕾絲沒抵抗力', cat: '缺陷', cost: 2, flaw: true, effect: '對粉蕾絲的定力 −2', adult: true },
  { id: 'f_favor', name: '欠著人情', cat: '缺陷', cost: 1, flaw: true, effect: '開場就欠阿蓮一個小人情' },
]
export const TRAIT_POINTS = 4
export const TRAIT_MAX = 8
export const FLAW_MAX = 2

/** 生命軌跡（CHARACTER 第 3 節、5.5 節的結果格式）：每張可以擲、可以選、可以跳過。 */
export interface LifeOption { id: string; text: string; result: string; filter?: string }
export interface LifeTable { id: string; name: string; options: LifeOption[]; adult?: boolean }
export const LIFE_TABLES: LifeTable[] = [
  { id: 'family', name: '家人', options: [
    { id: 'alive', text: '還在，住在同一棟塔', result: '一位 NPC：你的姊姊，蜂巢四號塔' },
    { id: 'lost', text: '失散了', result: '旗標：一條生活系列的開頭「找人」' },
    { id: 'gone', text: '過世了', result: '沒有 NPC' },
    { id: 'faction', text: '是某個勢力的人', result: '一位 NPC；那個勢力的好感 +15' },
  ] },
  { id: 'incident', name: '那件事', options: [
    { id: 'debt', text: '欠了一筆債', result: '欠阿蓮 C$2,000' },
    { id: 'fired', text: '被公司開除', result: '原本那家企業的敵對值 +15' },
    { id: 'fall', text: '替人頂罪', result: '市警的敵對值 +15；一則線索' },
    { id: 'bridge', text: '橋出過事', result: '沉溺的下限 +5' },
    { id: 'missing', text: '有人失蹤', result: '旗標：一條生活系列的開頭「九號塔」' },
  ] },
  { id: 'friend', name: '朋友', options: [
    { id: 'grew', text: '一起長大的', result: '一位名冊上的人，親密度起始 30' },
    { id: 'saved', text: '救過你的', result: '一位名冊上的人，忠誠起始 +20' },
    { id: 'job', text: '一起做過一票的', result: '一位名冊上的人，主職高一階' },
  ] },
  { id: 'enemy', name: '仇人', options: [
    { id: 'hurt', text: '被你害過的', result: '一位帶著敵對值的 NPC' },
    { id: 'hurtyou', text: '害過你的', result: '一位 NPC；他所屬的勢力敵對值 +15' },
    { id: 'rival', text: '搶同一個位置的', result: '一位帶著敵對值的行者' },
  ] },
  { id: 'love', name: '舊情', options: [
    { id: 'split', text: '分了', result: '一位 NPC 與一段關係記憶' },
    { id: 'apart', text: '被拆散', result: '一位 NPC；一條系列的開頭' },
    { id: 'vanish', text: '對方不見了', result: '旗標：一條系列的開頭' },
    { id: 'contact', text: '還有聯絡', result: '一位 NPC，親密度起始 40' },
  ] },
  { id: 'want', name: '想要的', options: [
    { id: 'money', text: '錢', result: '個人目標：存到 C$50,000' },
    { id: 'fame', text: '名', result: '個人目標：街頭信譽到「有號」' },
    { id: 'person', text: '一個人', result: '個人目標：找到舊情那一位' },
    { id: 'truth', text: '真相', result: '個人目標：九號塔的封鎖線' },
    { id: 'leave', text: '離開這座城', result: '個人目標：一張出城的票' },
    { id: 'remember', text: '被記住', result: '個人目標：頻道訂閱 10,000' },
  ] },
  { id: 'sex', name: '性經歷', adult: true, options: [
    { id: 'none', text: '沒有', result: '性經歷記錄 0' },
    { id: 'few', text: '很少，和舊情那一位', result: '性經歷 3 次、1 人；連到舊情' },
    { id: 'normal', text: '普通', result: '性經歷 12 次、4 人；耐受 +5' },
    { id: 'rich', text: '豐富，在歡場工作過', result: '性經歷 40 次、14 人；慾求 +5；扮相 +1 級', filter: 'filterPublic' },
  ] },
  { id: 'latent', name: '潛在性癖', adult: true, options: [
    { id: 'pamper', text: '溺愛', result: '標籤「溺愛」潛在' },
    { id: 'little', text: '妹系', result: '標籤「妹系」潛在' },
    { id: 'bind', text: '束縛', result: '標籤「束縛」潛在', filter: 'filterRestraint' },
    { id: 'voice', text: '聲音', result: '標籤「聲音」潛在' },
    { id: 'show', text: '暴露', result: '標籤「暴露」潛在', filter: 'filterPublic' },
    { id: 'doll', text: '人偶', result: '標籤「人偶」潛在', filter: 'filterDollChip' },
  ] },
]

/** 起始的裝備（CHARACTER 5.4 節）：12 點，只能買 I～II 級；一件的點數＝目錄價 ÷ 250，無條件進位，最少 1。 */
export const GEAR_POINTS = 12
export const GEAR_POINT_MONEY = 150
export const GEAR_CATALOG: Array<{ cat: string; ids: string[] }> = [
  { cat: '武器', ids: ['it_f0db7d', 'it_7eb6ee', 'it_e60505', 'it_6fa4e8'] },
  { cat: '護甲與服裝', ids: ['it_476d39', 'it_7d6ad2', 'it_f359b2', 'it_f13bde', 'it_ccbaca'] },
  { cat: '工具', ids: ['it_2c5068', 'it_d6c14d', 'it_1ace6d'] },
  { cat: '消耗品', ids: ['cg_gel1', 'it_8c6664', 'it_9da44a', 'it_3b3851', 'cg_cool1', 'cg_refill1', 'cg_eraser1', 'it_5e3de4'] },
  { cat: '甲板、構裝與 SKIN', ids: ['it_5f8f4a', 'cs_kefu1', 'cs_line1', 'cs_cool1', 'cs_window1', 'it_d212f6'] },
]
/** 出身的建議組合（照 CHARACTER 5.4 節的表，換成這份假資料裡有的條目；超過 12 點的拿掉最後一件）。 */
export const SUGGESTED_KITS: Record<string, string[]> = {
  hive: ['it_f0db7d', 'it_476d39', 'it_5f8f4a', 'cs_kefu1', 'cg_gel1', 'cg_gel1'],
  corp: ['it_7eb6ee', 'it_f359b2', 'cg_gel1'],
  nomad: ['it_e60505', 'it_f359b2', 'it_2c5068'],
  pleasure: ['it_f0db7d', 'it_ccbaca', 'it_f13bde', 'it_9da44a'],
  oldport: ['it_f0db7d', 'it_476d39', 'it_5f8f4a', 'cg_refill1', 'cg_cool1'],
  sakura: ['it_f13bde', 'it_5f8f4a', 'cs_line1', 'it_d212f6'],
  under: ['it_5f8f4a', 'cs_kefu1', 'cs_cool1', 'cg_eraser1', 'it_f0db7d'],
}

/** 外觀的下拉（CHARACTER 1.1 節）。 */
export const LOOKS = {
  gender: ['男', '女', '偽娘（含男娘）', 'TS', '扶他'],
  pronoun: ['她', '他', '祂', '自訂'],
  view: ['第二人稱', '第三人稱'],
  build: ['陽剛', '陰柔', '中性'],
  height: ['矮', '中等', '高'],
  skin: ['白皙', '小麥色', '深色', '帶光紋'],
  hair: ['短髮', '長直髮', '馬尾', '雙馬尾', '剃邊', '捲髮'],
  hairColor: ['黑', '銀白', '粉紅', '薄荷', '紫', '金'],
  eyes: ['黑', '褐', '灰', '義眼的冷光', '異色'],
  beast: ['沒有', '貓耳', '狐耳與尾巴', '兔耳'],
  cyber: ['看不出來', '一隻義臂', '後頸的橋露在外面', '臉上的光紋'],
}

/** 每個出身的兩個快速開始（CHARACTER 5.7 節，一個偏戰鬥、一個偏非戰鬥）。 */
export const QUICK_STARTS: Array<{ origin: string; name: string; role: string; line: string }> = [
  { origin: 'hive', name: '凜', role: '槍手', line: '四號塔長大的槍手，欠阿蓮一筆。' },
  { origin: 'hive', name: '小穗', role: '掮客', line: '在天井市場替人牽線的人。' },
  { origin: 'oldport', name: '阿海', role: '改造師', line: '倉庫區的拆體客，洗手不幹了。' },
  { origin: 'under', name: '影', role: '潛網者', line: '月台市長大，沒有登記的臉。' },
]
