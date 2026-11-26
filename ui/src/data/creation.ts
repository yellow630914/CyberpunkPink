/**
 * 建角的資料（docs/systems/CHARACTER.md 第 1～5 節、CORE_RULES 第 1、2 節、CYBERWARE 第 7 節）。
 * 點數、數字、特質、生命軌跡、橋與義體、裝備的清單都是引擎與示意世界包的（data/demo/creation.ts）：這裡只有顯示用的名字與外觀的詞條。
 */
export const ATTRS = ['體格', '反應', '技術', '智識', '意志', '魅力'] as const
export type AttrName = typeof ATTRS[number]

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

/**
 * 外觀（CHARACTER 1.1 節、NPC_SYSTEM 4.3 節與 13.9～13.11 節的詞條）。和 NPC 用同一套部位：
 * 身形（身高、體型、身材帶、體態、聲音、膚色）、臉與眼（含唇）、髮（髮型分短、中長、長三組）、身體的細節（胸、腰、臀、腿、腳、手）。
 * 外露的義體、獸化、風格不在這裡選：由裝的義體與穿的衣服推出來（第四版）。
 * 每一格都是下拉；選項照 13.10 節的句子濃縮成詞條，程式組字時照身材帶抽那一格的句子。詞庫不收任何幼態的描述。
 */
export interface LookField {
  k: string; name: string; opts: string[]; hint?: string
  /** 成人內容：內容篩選關掉「身體的私密描寫」時不顯示 */ adult?: boolean
  /** 這一格只有在另一格不是「沒有」時才有意義 */ needs?: { k: string; not: string }
  /** 下拉分組（optgroup）：有這一項時，opts 是各組 items 攤平的結果，元件照 groups 畫 */ groups?: LookOptGroup[]
}
export interface LookOptGroup { group: string; items: string[] }
export interface LookGroup { id: string; name: string; hint?: string; fields: LookField[] }
export const LOOKS = {
  gender: ['男', '女', '偽娘（含男娘）', 'TS', '扶他'],
  pronoun: ['她', '他', '祂', '自訂'],
  view: ['第二人稱', '第三人稱'],
}
/** 有分組的格子：opts 由 groups 攤平，其他程式（隨機、成人分頁）照舊讀 opts。 */
function grouped(k: string, name: string, groups: LookOptGroup[], hint?: string): LookField {
  return { k, name, hint, groups, opts: groups.flatMap(g => g.items) }
}
/**
 * 體型決定身材帶的預設（CHARACTER 1.1 節）：選體型時身材帶跟著換，之後仍可單獨改身材帶。
 * 身材帶（纖細、勻稱、豐腴）才是組字時抽句子的那一欄；體型只是說這個身體的大致樣子，並且給身材帶一個預設。
 */
export const BUILD_FIGURE: Record<string, string> = {
  嬌小: '纖細', 纖瘦: '纖細', 勻稱: '勻稱', 運動型: '勻稱', 豐滿: '豐腴', 高大結實: '豐腴',
}
export const LOOK_GROUPS: LookGroup[] = [
  { id: 'body', name: '身形', hint: '體型給身材帶一個預設（嬌小、纖瘦→纖細；勻稱、運動型→勻稱；豐滿、高大結實→豐腴），選了體型身材帶會跟著換，之後可以單獨改。身材帶決定其他部位從哪一欄抽句子，所以不會出現纖細的腰配豐腴的手臂（NPC_SYSTEM 13.9 節）。', fields: [
    { k: 'height', name: '身高', opts: ['150 公分以下', '150～159 公分', '160～169 公分', '170～179 公分', '180～189 公分', '190 公分以上'] },
    { k: 'build', name: '體型', opts: ['嬌小', '纖瘦', '勻稱', '運動型', '豐滿', '高大結實'], hint: '敘事怎麼寫這個身體，並決定身材帶的預設；不改數值。嬌小指骨架小、個子矮的成年人。' },
    { k: 'figure', name: '身材帶', opts: ['纖細', '勻稱', '豐腴'] },
    { k: 'posture', name: '體態', opts: ['走路很輕、貼著牆邊走', '站得很直、下巴微抬', '步子大、手臂擺得穩', '腰胯帶著上身擺動', '微微駝背、手插口袋', '走路慢而穩', '總是靠在什麼東西上'] },
    { k: 'voice', name: '聲音', opts: ['低沉沙啞', '清亮乾淨', '輕柔的氣音', '慵懶、尾音拖長', '乾脆利落、語速快', '溫潤低緩', '菸嗓', '義體喉的電子混音'] },
    { k: 'skin', name: '膚色', opts: ['白皙', '偏白', '小麥色', '深褐', '深色', '曬斑與雀斑'] },
  ] },
  { id: 'face', name: '臉與眼', fields: [
    { k: 'face', name: '臉型', opts: ['瘦長臉', '瓜子臉', '鵝蛋臉', '心形臉', '方臉', '圓臉', '寬而飽滿的臉'] },
    { k: 'eyeShape', name: '眼型', opts: ['狹長的單眼皮', '有神的雙眼皮', '眼尾上挑', '眼尾下垂', '總是半瞇著', '大眼、睫毛長'] },
    { k: 'eyes', name: '眼睛的顏色', opts: ['黑', '深褐', '褐', '琥珀', '灰', '灰綠', '淺藍', '綠', '異色', '義眼的冷光'] },
    { k: 'lips', name: '唇', opts: ['薄而緊抿', '薄、嘴角習慣往下壓', '上薄下厚', '唇峰分明、唇形清楚', '小而圓潤', '厚而飽滿', '豐厚柔軟、微微張著', '穿了唇環'] },
    { k: 'mark', name: '臉上的記號', opts: ['沒有', '雀斑', '酒窩', '嘴角的痣', '眉尾的舊疤', '臥蠶', '眉心的直紋', '深色的口紅'] },
  ] },
  { id: 'hair', name: '髮', hint: '髮型分短髮、中長髮、長髮三類，下拉裡分組。', fields: [
    grouped('hair', '髮型', [
      { group: '短髮', items: ['剃到貼頭皮', '刺刺的短髮', '耳下的短髮', '不對稱短髮', '兩側推短、頭頂往後梳', '側剃（一邊剃到頭皮）', '莫霍克', '鮑伯頭', '精靈短髮（後頸推短）', '捲翹的短髮', '齊瀏海短髮'] },
      { group: '中長髮', items: ['及肩直髮', '內彎的鎖骨髮', '外翹的中長髮', '狼尾', '層次剪的中長髮', '空氣瀏海中長髮', '半紮（半丸子）', '低馬尾', '側邊編一條小辮', '蓬鬆的捲髮到肩', '單邊夾耳後、單邊遮眼'] },
      { group: '長髮', items: ['長直髮', '姬髮（齊瀏海、兩側長鬢髮）', '公主切', '長捲髮', '大波浪', '高馬尾', '雙馬尾', '一條粗辮子', '好幾條細辮子', '髮髻', '丸子頭', '長長的挑染髒辮', '側剃加長髮'] },
    ]),
    { k: 'hairColor', name: '髮色', opts: ['黑', '深棕', '栗色', '淺褐', '金', '蜂蜜色', '銀白', '白金', '灰藍', '灰黑', '酒紅', '紅褐', '粉紅', '退了色的粉紅', '紫紅', '螢光綠', '薄荷', '霓虹藍', '淡紫', '黑底挑染', '漸層（黑到粉紅）', '漸層（藍到紫）', '漸層（銀白到霓虹藍）', '雙色（一半黑、一半白）', '雙色（黑與霓虹粉）', '雙色（金與酒紅）'] },
    { k: 'hairTexture', name: '髮質', opts: ['細而軟', '一般', '又多又厚'] },
  ] },
  { id: 'detail', name: '身體的細節', hint: '胸那一格：女性、TS 與扶他照〔乳〕寫，男性、男娘照〔平〕寫；「做過的」兩邊都可以選（NPC_SYSTEM 13.9 節）。', fields: [
    { k: 'chest', name: '胸', opts: ['平坦單薄', '平而結實', '厚實的胸膛', '小而挺', '大小適中', '飽滿', '豐滿', '很大', '做過的'] },
    { k: 'waist', name: '腰', opts: ['很細', '薄而平、看得到腹肌', '結實', '有一點軟肉', '圓潤柔軟', '厚實'] },
    { k: 'hips', name: '臀', opts: ['小而緊', '窄而高', '圓而翹', '寬而豐滿', '大而結實', '蜜桃形', '瘦而結實', '胯骨寬、圓出去'] },
    { k: 'legs', name: '腿', opts: ['細而直', '修長', '結實有力', '大腿豐滿', '粗壯結實', '小腿線條明顯', '大腿內側柔軟白皙', '大腿外側有刺青'] },
    { k: 'feet', name: '腳', opts: ['窄而長、腳背高', '小巧勻稱', '寬而厚實', '腳趾長而整齊', '腳底有厚繭', '腳踝纖細', '常光著腳、腳底粗糙', '趾甲塗了顏色'] },
    { k: 'hands', name: '手', opts: ['指節分明、手指細長', '厚實、指腹有繭', '柔軟、手背有小窩', '指甲修長塗色', '手背有舊疤', '戴著好幾枚粗戒指', '手背有刺青', '手穩而有力、虎口有硬皮'] },
    { k: 'privates', name: '私處', adult: true, hint: '成人內容。場景的部位照 LEWD_SYSTEM 的 front（DATA 3.4 節的 scene_parts）；性別照第一格，扶他與做過的兩邊都可以選。', opts: ['（不寫）', '陰唇小而緊，顏色淺', '陰唇飽滿，顏色深', '陰蒂敏感、微微突起', '陰莖不大、包皮蓋著龜頭', '陰莖粗長，龜頭露在外面', '陰莖細長、微微上翹', '扶他：陰莖之下還有一道縫', '做過的（換了的）', '剃得乾乾淨淨', '修成一小撮', '自然、毛很多', '雷射除過毛、光滑', '私處有光紋刺青', '私密義體（感官強化）'] },
  ] },
]
/** 每個出身的兩個快速開始（CHARACTER 5.7 節，一個偏戰鬥、一個偏非戰鬥）。 */
export const QUICK_STARTS: Array<{ origin: string; name: string; role: string; line: string }> = [
  { origin: 'hive', name: '凜', role: '槍手', line: '四號塔長大的槍手，欠阿蓮一筆。' },
  { origin: 'hive', name: '小穗', role: '掮客', line: '在天井市場替人牽線的人。' },
  { origin: 'oldport', name: '阿海', role: '改造師', line: '倉庫區的拆體客，洗手不幹了。' },
  { origin: 'under', name: '影', role: '潛網者', line: '月台市長大，沒有登記的臉。' },
]
