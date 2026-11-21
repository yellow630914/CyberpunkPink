/**
 * 建角的資料（docs/systems/CHARACTER.md 第 1～5 節、CORE_RULES 第 1、2 節、CYBERWARE 第 7 節）。
 * 特質與生命軌跡的選項是示意：清單之後生成（CHARACTER 第 4 節、PLAN 5.2 節），這裡照文件裡的例子與格式寫。
 */
export const ATTRS = ['體格', '反應', '技術', '智識', '意志', '魅力'] as const
export type AttrName = typeof ATTRS[number]
export const ATTR_ARRAY = [15, 14, 13, 12, 10, 8] as const
export const ATTR_FREE = 2
export const ATTR_MAX = 18
/** 建角時可以把屬性往下壓到 4（調整值 −3），每壓 1 點換 1 點自由點數（DECISIONS 2026-11-21） */
export const ATTR_MIN = 4

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
export interface CyberOption {
  id: string; name: string; brand: string; grade: number; points: number; kind: 'bridge' | 'light' | 'invasive'; part: string; sink: number; cap?: [number, number, number, number]; note: string; corpOnly?: string
  /** 看得見的義體：寫進外觀的部位（NPC_SYSTEM 13.11 節的模板）；line 換掉牌子的外觀那一句 */
  visible?: { at: string; line?: string }
  /** 獸化零件（CULTURE 第 2 節、ITEMS 的耳與尾）：機械派或生體派、耳或尾 */
  beast?: { school: 'mech' | 'bio'; part: 'ears' | 'tail' }
}
export const CYBER_OPTIONS: CyberOption[] = [
  { id: 'br_hive', name: '蜂巢通用型', brand: '織女（二手）', grade: 1, points: 2, kind: 'bridge', part: '橋', sink: 5, cap: [10, 10, 10, 10], note: '便宜、到處能修。', visible: { at: '後頸' } },
  { id: 'br_junk', name: '拼裝橋', brand: '同人／黑市', grade: 1, points: 3, kind: 'bridge', part: '橋', sink: 6, cap: [12, 9, 13, 10], note: '一個隨機的怪癖；可能有後門，不在任何登記上。' , visible: { at: '後頸' } },
  { id: 'br_std', name: '織女 標準', brand: '織女', grade: 2, points: 5, kind: 'bridge', part: '橋', sink: 6, cap: [13, 13, 13, 13], note: '換配置只要半小時。' , visible: { at: '後頸' } },
  { id: 'br_field', name: '星旗 野戰', brand: '星旗', grade: 2, points: 5, kind: 'bridge', part: '橋', sink: 6, cap: [24, 8, 8, 8], note: '耐受 +15；敏感度 −15，開不了深同步。', corpOnly: '星旗' , visible: { at: '後頸' } },
  { id: 'br_deep', name: '夜鶯 深水', brand: '夜鶯', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 6, cap: [9, 24, 11, 10], note: 'RAM +2；回報後門。', corpOnly: '夜鶯' , visible: { at: '後頸' } },
  { id: 'br_hizakura', name: '緋櫻 奉公', brand: '緋櫻', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 7, cap: [20, 15, 10, 10], note: '授權鎖；出廠帶「忠犬」調校槽。', corpOnly: '緋櫻' , visible: { at: '後頸' } },
  { id: 'br_rei', name: '伊甸園 伶', brand: '伊甸園', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 6, cap: [9, 13, 22, 11], note: '人格面具切換不花行動；多半綁契約條款。', corpOnly: '伊甸園' , visible: { at: '後頸' } },
  { id: 'br_spot', name: '萬華鏡 聚光', brand: '萬華鏡', grade: 2, points: 6, kind: 'bridge', part: '橋', sink: 6, cap: [8, 12, 12, 22], note: '編輯點 +1；內建錄影。', corpOnly: '萬華鏡' , visible: { at: '後頸' } },
  { id: 'cw_eye', name: '標準義眼-100', brand: '織女', grade: 1, points: 2, kind: 'light', part: '眼', sink: 3, note: '視野裡顯示距離與對方的護甲類別。' , visible: { at: '左眼' } },
  { id: 'cw_voice', name: '囀・微糖', brand: '伊甸園', grade: 1, points: 1, kind: 'light', part: '喉', sink: 3, note: '聲帶：體格類加值改加在表演與誘惑。' , visible: { at: '喉嚨', line: '喉結底下有一圈細細的接縫，說話時會微微發亮' } },
  { id: 'cw_ears', name: '同人通用獸耳', brand: '同人', grade: 1, points: 1, kind: 'light', part: '耳', sink: 2, note: '可以選系，高頻聽得比較清楚。' , beast: { school: 'mech', part: 'ears' } },
  { id: 'cw_ears_bio', name: '生體獸耳・芽', brand: '蜜腺', grade: 2, points: 7, kind: 'light', part: '耳', sink: 0, note: '真的軟骨與毛；情緒外洩鎖不住；掃描器不當它是義體；每週營養劑 40。', beast: { school: 'bio', part: 'ears' } },
  { id: 'cw_tail', name: '通用尾 初版', brand: '同人', grade: 1, points: 1, kind: 'light', part: '尾', sink: 2, note: '平衡：落地與平衡的運動檢定 +1；情緒外洩。成人場景多一個「尾」部位。', beast: { school: 'mech', part: 'tail' } },
  { id: 'cw_tail_bio', name: '生體尾・芽', brand: '蜜腺', grade: 2, points: 7, kind: 'light', part: '尾', sink: 0, note: '同通用尾，情緒外洩鎖不住；每週營養劑 40。', beast: { school: 'bio', part: 'tail' } },
  { id: 'cw_pump', name: '藥泵-100', brand: '織女', grade: 1, points: 1, kind: 'light', part: '軀幹', sink: 3, note: '每場一次從藥泵用藥不花行動點。' },
  { id: 'cw_deck', name: '入門甲板-100', brand: '織女', grade: 1, points: 2, kind: 'light', part: '腦', sink: 5, note: '構裝槽 3；防火牆 10。' },
  { id: 'cw_arm', name: 'M1 義臂', brand: '星旗', grade: 1, points: 3, kind: 'invasive', part: '臂', sink: 7, note: '義臂；內藏槽 1。' , visible: { at: '左臂' } },
  { id: 'cw_leg', name: '花道・一分咲', brand: '緋櫻', grade: 1, points: 3, kind: 'invasive', part: '腿', sink: 6, note: '義腿：移動 +1。' , visible: { at: '左腿' } },
  { id: 'cw_armor', name: '皮下裝甲-100', brand: '織女', grade: 1, points: 4, kind: 'invasive', part: '軀幹', sink: 6, note: '生命值上限 +5；護甲 +1。' , visible: { at: '腰側', line: '皮膚底下摸得到一片一片的硬板，彎腰時看得到接縫' } },
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

/**
 * 外觀（CHARACTER 1.1 節、NPC_SYSTEM 4.3 節與 13.9～13.11 節的詞條）。和 NPC 用同一套部位：
 * 身形（身高、體型、身材帶、體態、膚色）、臉與眼、髮、身體的細節（胸、腰、臀、腿、手）。
 * 外露的義體、獸化、風格不在這裡選：由裝的義體與穿的衣服推出來（第四版）。
 * 每一格都是下拉；選項照 13.10 節的句子濃縮成詞條，程式組字時照身材帶抽那一格的句子。詞庫不收任何幼態的描述。
 */
export interface LookField { k: string; name: string; opts: string[]; hint?: string; /** 成人內容：內容篩選關掉「身體的私密描寫」時不顯示 */ adult?: boolean; /** 這一格只有在另一格不是「沒有」時才有意義 */ needs?: { k: string; not: string } }
export interface LookGroup { id: string; name: string; hint?: string; fields: LookField[] }
export const LOOKS = {
  gender: ['男', '女', '偽娘（含男娘）', 'TS', '扶他'],
  pronoun: ['她', '他', '祂', '自訂'],
  view: ['第二人稱', '第三人稱'],
}
export const LOOK_GROUPS: LookGroup[] = [
  { id: 'body', name: '身形', hint: '身材帶（纖細、勻稱、豐腴）決定其他部位從哪一欄抽句子，所以不會出現纖細的腰配豐腴的手臂（NPC_SYSTEM 13.9 節）。', fields: [
    { k: 'height', name: '身高', opts: ['150 公分以下', '150～159 公分', '160～169 公分', '170～179 公分', '180～189 公分', '190 公分以上'] },
    { k: 'build', name: '體型', opts: ['陽剛', '陰柔', '中性'], hint: '敘事怎麼寫這個身體；不改數值。' },
    { k: 'figure', name: '身材帶', opts: ['纖細', '勻稱', '豐腴'] },
    { k: 'posture', name: '體態', opts: ['走路很輕、貼著牆邊走', '站得很直、下巴微抬', '步子大、手臂擺得穩', '腰胯帶著上身擺動', '微微駝背、手插口袋', '走路慢而穩', '總是靠在什麼東西上'] },
    { k: 'skin', name: '膚色', opts: ['白皙', '偏白', '小麥色', '深褐', '深色', '曬斑與雀斑'] },
  ] },
  { id: 'face', name: '臉與眼', fields: [
    { k: 'face', name: '臉型', opts: ['瘦長臉', '瓜子臉', '鵝蛋臉', '心形臉', '方臉', '圓臉', '寬而飽滿的臉'] },
    { k: 'eyeShape', name: '眼型', opts: ['狹長的單眼皮', '有神的雙眼皮', '眼尾上挑', '眼尾下垂', '總是半瞇著', '大眼、睫毛長'] },
    { k: 'eyes', name: '眼睛的顏色', opts: ['黑', '深褐', '褐', '灰', '淺色', '異色', '義眼的冷光'] },
    { k: 'mark', name: '臉上的記號', opts: ['沒有', '雀斑', '酒窩', '嘴角的痣', '眉尾的舊疤', '臥蠶', '眉心的直紋', '深色的口紅'] },
  ] },
  { id: 'hair', name: '髮', fields: [
    { k: 'hair', name: '髮型', opts: ['剃到貼頭皮', '刺刺的短髮', '耳下的短髮', '不對稱短髮', '兩側推短、頭頂往後梳', '鮑伯頭', '齊瀏海', '及肩直髮', '長直髮', '長捲髮', '大波浪', '馬尾', '低馬尾', '雙馬尾', '一條粗辮子', '好幾條細辮子', '髮髻'] },
    { k: 'hairColor', name: '髮色', opts: ['黑', '深棕', '栗色', '淺褐', '金', '蜂蜜色', '銀白', '灰藍', '灰黑', '酒紅', '紅褐', '粉紅', '退了色的粉紅', '薄荷', '霓虹藍', '淡紫', '黑底挑染'] },
    { k: 'hairTexture', name: '髮質', opts: ['細而軟', '一般', '又多又厚'] },
  ] },
  { id: 'detail', name: '身體的細節', hint: '胸那一格：女性、TS（女）與扶他照〔乳〕寫，男性、男娘、TS（男）照〔平〕寫；「做過的」兩邊都可以選（NPC_SYSTEM 13.9 節）。', fields: [
    { k: 'chest', name: '胸', opts: ['平坦單薄', '平而結實', '厚實的胸膛', '小而挺', '大小適中', '飽滿', '豐滿', '很大', '做過的'] },
    { k: 'waist', name: '腰', opts: ['很細', '薄而平、看得到腹肌', '結實', '有一點軟肉', '圓潤柔軟', '厚實'] },
    { k: 'hips', name: '臀', opts: ['小而緊', '窄而高', '圓而翹', '寬而豐滿', '大而結實'] },
    { k: 'legs', name: '腿', opts: ['細而直', '修長', '結實有力', '大腿豐滿', '粗壯結實'] },
    { k: 'hands', name: '手', opts: ['指節分明、手指細長', '厚實、指腹有繭', '柔軟、手背有小窩', '指甲修長塗色', '手背有舊疤'] },
    { k: 'privates', name: '私處', adult: true, hint: '成人內容。場景的部位照 LEWD_SYSTEM 的 front（DATA 3.4 節的 scene_parts）；性別照第一格，扶他與做過的兩邊都可以選。', opts: ['（不寫）', '陰唇小而緊，顏色淺', '陰唇飽滿，顏色深', '陰蒂敏感、微微突起', '陰莖不大、包皮蓋著龜頭', '陰莖粗長，龜頭露在外面', '陰莖細長、微微上翹', '扶他：陰莖之下還有一道縫', '做過的（換了的）', '剃得乾乾淨淨', '修成一小撮', '自然、毛很多', '雷射除過毛、光滑', '私處有光紋刺青', '私密義體（感官強化）'] },
  ] },
]
/**
 * 外露的義體的外觀，照牌子抽一句（NPC_SYSTEM 13.11 節）。建角的「改造與風格」不再自己選，
 * 由第 6 步裝的義體與獸化零件、第 9 步的穿著推出來（lib/creation.ts 的 derivedLooks）。
 */
export const BRAND_LOOK: Record<string, string> = {
  織女: '白色的樹脂外殼，接縫裡透著一條細細的藍光',
  緋櫻: '櫻粉色的烤漆，關節旁邊印著一朵小小的櫻紋，表面亮得照得出人影',
  星旗: '橄欖綠的外殼，序號與財產編號都打在看得見的地方，漆掉了一半',
  蜜腺: '看起來是皮膚，摸起來比別處的皮膚涼一點，接縫是一圈淡粉色的疤',
  伊甸園: '仿真的皮膚做得比原生的還細，關節的地方蝕刻著一圈蕾絲的花紋',
  鉻娘子改: '鉻與液壓管全露在外面，焊痕沒有磨平，散熱孔一直在吐熱氣',
  同人: '外殼貼滿了貼紙，螺絲有三種顏色，看得出是好幾台東西拼起來的',
  二手: '上一任主人刻的字還在，有一塊外殼的顏色和其他地方不一樣',
}
/** 獸化的系（CULTURE 第 2 節）：機械派看外形與韌體、生體派看基因譜；在第 6 步跟著零件選。情緒與動作照系抽（NPC_SYSTEM 13.11 節）。 */
export const BEAST_LINES: Record<string, { mood: string; move: string }> = {
  貓: { mood: '不高興', move: '往後貼平' }, 狐: { mood: '在想事情', move: '慢慢轉向一邊' }, 兔: { mood: '緊張', move: '豎得筆直' }, 犬: { mood: '高興', move: '往兩邊垮下來' },
}
/** 每個出身白給的那一套日常服裝的風格（CHARACTER 5.4 節：一套出身那一區的日常服裝，風格對） */
export const ORIGIN_STYLE: Record<string, string> = { hive: '工裝', corp: '企業', nomad: '荒地', pleasure: '歡場', oldport: '特攻', sakura: '櫻町系', under: '工裝' }

/**
 * 生命軌跡跟著出身換說法（CHARACTER 第 2、3 節；DISTRICTS、LIFE、CULTURE、content/QUESTS 的「出身的開場」）。
 * 只換文字，不換結果：每一張表的選項與結果的種類照 LIFE_TABLES（CHARACTER 5.5 節的格式）。
 * flavor：那一張表在這個出身底下的一句話；opts：某個選項在這個出身底下的說法（text 選項的字、result 結果的寫法）。
 */
export interface LifeVariant { flavor: Record<string, string>; opts?: Record<string, { text?: string; result?: string }> }
export const LIFE_BY_ORIGIN: Record<string, LifeVariant> = {
  hive: {
    flavor: {
      family: '四號塔的單位一層住幾十戶，家人多半就住在你上下幾層，電梯壞了三年，見面靠爬樓梯。',
      incident: '天井市場的人都記帳：阿蓮的帳本上有你一頁，九號塔的封鎖線二十年沒拆過。',
      friend: '一起在屋頂村的水塔之間跑大的人，叫得出每一個攤販的名字。',
      enemy: '東側是孤星連的地盤，屋頂村是野良的；在塔裡結的仇，搭同一部電梯都躲不掉。',
      love: '在走廊的共用洗手台前認識的，在天台晾衣場分開的。',
      want: '蜂巢的人誇的是身體扛不扛得住日子；想要的東西，多半是一個能下樓的電梯和一個離開塔的理由。',
      sex: '隔間的牆很薄，蜂巢的人不太問別人的事。',
      latent: '鄰居之間不盯著別人後頸的光紋看；你自己也還沒發現的事，在塔裡藏得住。',
    },
    opts: {
      'family.alive': { text: '還在，住在同一棟塔', result: '一位 NPC：你的姊姊，蜂巢四號塔' },
      'family.faction': { text: '是孤星連或野良的人', result: '一位 NPC；孤星連或野良的好感 +15' },
      'incident.missing': { text: '有人在九號塔失蹤', result: '旗標：一條生活系列的開頭「九號塔」' },
      'friend.grew': { text: '在屋頂村一起長大的', result: '一位名冊上的人，親密度起始 30（蜂巢）' },
      'want.truth': { result: '個人目標：九號塔的封鎖線' },
    },
  },
  corp: {
    flavor: {
      family: '社宅出身：家人的住處、醫保和你的工作綁在同一份合約上，你離開公司，他們還在裡面。',
      incident: '離開公司，或被公司離開。身上還帶著一樣前公司的東西，有人會來收。',
      friend: '同一層樓的同期，或同一陣子被請走的人；潘妮那一類的人。',
      enemy: '冠冕區的人記仇記在人事檔案裡，等你下次掃橋時才發作。',
      love: '在員工食堂、加班的樓層或公司的聯誼上認識的；合約裡的社內戀愛條款寫得很清楚。',
      want: '你看得懂合約，也知道合約外面有多冷。',
      sex: '企業的人把這種事寫進保密條款；派遣合約的讀取級橋權看得到每一次你離開座位的時間。',
      latent: '在公司裡你從來沒有機會知道自己喜歡什麼。',
    },
    opts: {
      'family.alive': { text: '還在，住在原本那家企業的社宅', result: '一位 NPC：你的父親，原本那家企業的社宅' },
      'family.faction': { text: '還在原本那家企業上班', result: '一位 NPC；原本那家企業的好感 +15' },
      'incident.fired': { text: '被公司開除（這就是你出來的原因）', result: '原本那家企業的敵對值 +15' },
      'incident.debt': { text: '欠了一筆債（離職時的違約金）', result: '欠阿蓮 C$2,000' },
      'friend.job': { text: '同一個專案的同事', result: '一位名冊上的人，主職高一階' },
      'want.money': { text: '錢（贖回自己的合約）' },
    },
  },
  nomad: {
    flavor: {
      family: '車隊就是家：荒地上的車一輛接一輛，進城以後，家人還在野薔薇的車隊上跑。',
      incident: '在荒地上欠的東西用油和水算；進了城，換成信用點和人情。',
      friend: '同一輛車上長大的，或在加油站的營火邊認識的；真白那一類不太說話的人。',
      enemy: '公路上搶過你們貨的人，或被你們搶過的人；鏽帶的收費站記得每一塊車牌。',
      love: '在車隊停靠的宿營地，或某一趟長途護送上的同車人。',
      want: '車族的人想要的常常很簡單：一台自己的車，一條沒有收費站的路。',
      sex: '車隊上沒有秘密，帳篷的布也很薄。',
      latent: '荒地很大，城裡的規矩管不到那裡。',
    },
    opts: {
      'family.alive': { text: '還在，跟著野薔薇的車隊跑', result: '一位 NPC：你的叔叔，野薔薇的車隊' },
      'family.faction': { text: '是野薔薇的人', result: '一位 NPC；野薔薇的好感 +15' },
      'family.lost': { text: '在一次沙暴裡和車隊走散了' },
      'incident.fired': { text: '被趕出車隊（原本替一家企業跑貨）' },
      'friend.job': { text: '一起跑過一趟長途的', result: '一位名冊上的人，主職高一階' },
      'want.leave': { text: '回到荒地上' },
    },
  },
  pleasure: {
    flavor: {
      family: '在四十二番街的店裡長大：家人可能是店裡的人，也可能是一個每個月寄錢來的名字。',
      incident: '番街的人都欠著什麼：媽媽桑的人情、店裡的出場費，或一段被拍下來的帶子。',
      friend: '同一條街上的人偶、牛郎、調酒師；琥珀那一類的人。',
      enemy: '搶熟客的、專拍人偶下班的狗仔、在帶子街賣你影片的人。',
      love: '在店裡認識的客人，或下班以後在旅館坡的便利商店前認識的人。',
      want: '番街的豔名來得快、去得也快；你想要的，是一個不靠它也活得下去的理由。',
      sex: '你在店裡工作過：這張表的選項照實寫，所有人都是成年人。',
      latent: '番街什麼都看過；你自己的喜好，反而是最後一個知道的。',
    },
    opts: {
      'family.alive': { text: '還在，在番街的另一家店裡', result: '一位 NPC：你的母親，番街中城的店' },
      'family.faction': { text: '是蜜糖會的人', result: '一位 NPC；蜜糖會的好感 +15' },
      'incident.debt': { text: '欠了店裡一筆出場費', result: '欠阿蓮 C$2,000' },
      'incident.fall': { text: '替店裡頂了一次臨檢' },
      'friend.saved': { text: '在店裡替你擋過客人的', result: '一位名冊上的人，忠誠起始 +20' },
      'want.fame': { text: '名（番街的豔名之外的那種）' },
    },
  },
  oldport: {
    flavor: {
      family: '碼頭與黑市的人：家人在倉庫區上工，或在夜市碼頭擺攤，帳房陸伯都認得。',
      incident: '舊港沒有治安，只有胭脂堂的規矩：收得到就收，收不到不准砸攤。',
      friend: '從小一起在碼頭跑腿的；奈奈那一類消息靈通的人。',
      enemy: '舊港的仇在貨櫃城裡算，在彈坑灣裡了結。',
      love: '在夜市碼頭的燈下，或在渡輪的甲板上認識的。',
      want: '碼頭的人想要的東西都在船上：一批貨、一張船票，或一個不用再搬貨的日子。',
      sex: '倉庫的隔間沒有門，只有一塊布簾。',
      latent: '舊港不問身分，也不問別的。',
    },
    opts: {
      'family.alive': { text: '還在，在倉庫區上工', result: '一位 NPC：你的哥哥，舊港倉庫區' },
      'family.faction': { text: '是胭脂堂的人', result: '一位 NPC；胭脂堂的好感 +15' },
      'incident.debt': { text: '欠了胭脂堂一筆', result: '欠阿蓮 C$2,000' },
      'incident.fall': { text: '替碼頭的人頂罪' },
      'friend.grew': { text: '一起在碼頭跑腿長大的' },
      'want.leave': { text: '一張離開這座城的船票' },
    },
  },
  sakura: {
    flavor: {
      family: '櫻町的家人多半在社宅群，或在千本通開一間小店；他們都去看過你在地下二階的公演。',
      incident: '同人圈的事傳得比什麼都快：一本被下架的本子、一場被同擔鬧掉的公演。',
      friend: '劇場後台、女僕咖啡、同人展的攤位上認識的；燈那一類的人。',
      enemy: '搶同一個角色的、同擔拒否的、在討論板上寫你的人。',
      love: '在公演結束後的後台，或在神社坡的祭典上認識的。',
      want: '櫻町的人都想被記住：站上劇場通的大舞台，或一個訂閱數。',
      sex: '櫻町的規矩是不在店裡、不在舞台上；下了台以後的事，櫻町的人不問。',
      latent: '扮相是櫻町的日常；扮成別人的時候，你比較看得清楚自己。',
    },
    opts: {
      'family.alive': { text: '還在，在千本通開一間小店', result: '一位 NPC：你的阿姨，櫻町千本通' },
      'family.faction': { text: '是特攻姬或女僕公會的人', result: '一位 NPC；特攻姬或女僕公會的好感 +15' },
      'incident.fall': { text: '替社團頂了一次警備局的盤查' },
      'friend.job': { text: '一起辦過一場同人展的', result: '一位名冊上的人，主職高一階' },
      'want.remember': { text: '被記住（站上劇場通的舞台）' },
    },
  },
  under: {
    flavor: {
      family: '地下層的人沒有登記：家人可能在月台市的鋪位上，可能在更下面，也可能從來沒有名字。',
      incident: '地下層的事都和上面有關：被掃到一次、被貞網局帶走一個人、一份從舊網撈上來的檔案。',
      friend: '隔壁鋪位的、一起在排水大廳撿東西的；零那一類上網才說話的人。',
      enemy: '地下層的仇不寫在任何紀錄上，所以也沒有人替你作證。',
      love: '在轉播站的螢幕光底下，或在書店街的舊書架之間認識的。',
      want: '沒有登記的人想要的，常常是一張臉、一個名字，或一扇通到上面的門。',
      sex: '月台市的鋪位一格挨著一格，大家都學會了安靜。',
      latent: '在沒有人登記你的地方，你可以是任何人。',
    },
    opts: {
      'family.alive': { text: '還在，睡在月台市的另一頭', result: '一位 NPC：你的姊姊，地下層月台市' },
      'family.faction': { text: '是野良或牆語者的人', result: '一位 NPC；野良或牆語者的好感 +15' },
      'incident.bridge': { text: '橋出過事（在舊網節點裡）' },
      'incident.fired': { text: '從上面的公司逃下來的' },
      'friend.saved': { text: '在排水大廳把你拉上來的', result: '一位名冊上的人，忠誠起始 +20' },
      'want.truth': { text: '真相（你為什麼沒有登記）' },
    },
  },
}

/** 每個出身的兩個快速開始（CHARACTER 5.7 節，一個偏戰鬥、一個偏非戰鬥）。 */
export const QUICK_STARTS: Array<{ origin: string; name: string; role: string; line: string }> = [
  { origin: 'hive', name: '凜', role: '槍手', line: '四號塔長大的槍手，欠阿蓮一筆。' },
  { origin: 'hive', name: '小穗', role: '掮客', line: '在天井市場替人牽線的人。' },
  { origin: 'oldport', name: '阿海', role: '改造師', line: '倉庫區的拆體客，洗手不幹了。' },
  { origin: 'under', name: '影', role: '潛網者', line: '月台市長大，沒有登記的臉。' },
]
