import type { ItemDef } from './types'

/**
 * 物品目錄（假資料，取自 docs/gear/ITEMS.md）。id 就是第 3 層圖標的 id（docs/art/icons/items.csv），
 * 價錢是 ITEMS 的目錄價（成品欄）。服裝沒有寫等級的，照設計圖的版次給：初版、街 I；再版、巷 II。
 */
const list: ItemDef[] = [
  // ---- 義體（ITEMS 3.1） ----
  { id: 'it_3882ae', name: '織女 標準-300', kind: 'cyberware', type: '橋', grade: 3, brand: '織女', l2: 'ic-cw_bridge', price: 6910, weight: 0, legality: '許可', trade: '機械義體與零件',
    cyber: { part: 'bridge', invasive: '侵入', sink: 6, material: '機', effect: '現實／內海／社交／媒體 13／13／13／13；換配置半小時' },
    note: '最不挑零件的橋，是混搭的基底。' },
  { id: 'it_d553bd', name: '早咲・五分咲', kind: 'cyberware', type: '腦的義體', grade: 3, brand: '緋櫻', l2: 'ic-cw_brain', price: 14690, weight: 0, legality: '許可', trade: '機械義體與零件',
    cyber: { part: 'brain', invasive: '重度', sink: 12, material: '機', effect: '反射加速器：啟動後每回合多回 1 點行動點；開著時每回合自己受 4 點感載', license: '緋櫻・訂閱中，每週扣帳戶 210' },
    note: '過載時斷開；每場能啟動的次數是電量。' },
  { id: 'it_91ec53', name: '入門甲板-200', kind: 'cyberware', type: '腦的義體', grade: 2, brand: '織女', l2: 'ic-cw_brain', price: 2480, weight: 0, legality: '自由', trade: '電子',
    cyber: { part: 'brain', invasive: '侵入', sink: 5, material: '機', effect: '構裝槽 4；防火牆 12' } },
  { id: 'it_34c398', name: '標準義眼-100', kind: 'cyberware', type: '眼的義體', grade: 1, brand: '織女', l2: 'ic-cw_eye', price: 790, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'eye', invasive: '一般', sink: 3, material: '機', effect: '視野裡顯示距離與對方的護甲類別；可以錄自己看到的' } },
  { id: 'it_a4b7d6', name: '囀・微糖', kind: 'cyberware', type: '喉的義體', grade: 1, brand: '伊甸園', l2: 'ic-cw_earthroat', price: 470, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'earthroat', invasive: '一般', sink: 3, material: '機', effect: '聲帶：體格類加值改加在表演（唱）與誘惑（說）' } },
  { id: 'it_463387', name: '藥泵-100', kind: 'cyberware', type: '軀幹的義體', grade: 1, brand: '織女', l2: 'ic-cw_torso', price: 320, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'torso', invasive: '一般', sink: 3, material: '機', effect: '藥泵格 1；每場一次從藥泵用藥不花行動點' } },
  { id: 'it_2ddbd0', name: '光學迷彩-200', kind: 'cyberware', type: '皮膚的義體', grade: 2, brand: '織女', l2: 'ic-cw_skin', price: 1460, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'skin', invasive: '一般', sink: 6, material: '機', effect: '每回合一次花 1 點電量，隱匿 +4 到下一回合開始；被打中就現形' } },
  { id: 'it_7bda7b', name: 'M1 義臂', kind: 'cyberware', type: '臂的義體', grade: 1, brand: '星旗', l2: 'ic-cw_arm', price: 470, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'armR', invasive: '侵入', sink: 7, material: '機', effect: '義臂；內藏槽 1', warning: '二手：惡意韌體「搭便車」潛伏中，約 5 天後發作' } },
  { id: 'it_f559cd', name: '貓之手 改', kind: 'cyberware', type: '臂的內藏武器', grade: 1, brand: '鉻娘子改', l2: 'ic-cw_arm', price: 250, weight: 0, legality: '登記', trade: '機械義體與零件',
    cyber: { part: 'armR', invasive: '一般', sink: 6, material: '機', effect: '每場一次，一次近戰多一顆傷害骰，自己感載 +4' } },
  { id: 'it_c66e94', name: '花道・三分咲', kind: 'cyberware', type: '腿的義體', grade: 2, brand: '緋櫻', l2: 'ic-cw_leg', price: 2610, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'legL', invasive: '侵入', sink: 6, material: '機', effect: '義腿：移動 +1，跳躍與攀爬的運動 +1' } },
  { id: 'it_590ea7', name: '標準義眼-200', kind: 'cyberware', type: '眼的義體', grade: 2, brand: '織女', l2: 'ic-cw_eye', price: 2650, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'eye', invasive: '一般', sink: 3, material: '機', effect: '視野裡顯示距離與對方的護甲類別；可以錄自己看到的' } },
  { id: 'it_5a441e', name: '深水甲板 goodnight', kind: 'cyberware', type: '腦的義體', grade: 2, brand: '夜鶯', l2: 'ic-cw_brain', price: 3590, weight: 0, legality: '自由', trade: '電子',
    cyber: { part: 'brain', invasive: '侵入', sink: 6, material: '機', effect: '構裝槽 4；防火牆 12；任何牌子的構裝都不扣' } },

  // ---- 武器（ITEMS 3.2） ----
  { id: 'it_7eb6ee', name: 'M2 制式手槍', kind: 'weapon', type: '副武器・手槍', grade: 2, brand: '星旗', l2: 'ic-carry_side', price: 540, weight: 1.2, legality: '登記', trade: '武器', slot: 'side',
    stats: [['傷害', '3d6 物理'], ['距離', '1～4'], ['彈匣', '2 格']], note: '沒有晶片的槽，不能被駭；全套星旗不卡彈。' },
  { id: 'it_f0db7d', name: 'M1 制式手槍', kind: 'weapon', type: '副武器・手槍', grade: 1, brand: '星旗', l2: 'ic-carry_side', price: 160, weight: 1.2, legality: '登記', trade: '武器', slot: 'side',
    stats: [['傷害', '3d6 物理'], ['距離', '1～4'], ['彈匣', '2 格']] },
  { id: 'it_6fa4e8', name: 'M2 步槍', kind: 'weapon', type: '主武器・步槍', grade: 2, brand: '星旗', l2: 'ic-carry_main', price: 1510, weight: 3.5, legality: '許可', trade: '武器', slot: 'main',
    stats: [['傷害', '4d6 物理，穿甲 2'], ['距離', '3～7'], ['彈匣', '3 格']] },
  { id: 'it_c7dbe5', name: 'M3 步槍', kind: 'weapon', type: '主武器・步槍', grade: 3, brand: '星旗', l2: 'ic-carry_main', price: 4840, weight: 3.5, legality: '許可', trade: '武器', slot: 'main',
    stats: [['傷害', '4d6 物理，穿甲 2'], ['距離', '3～7'], ['彈匣', '3 格']], note: '多一個選配槽可以掛下掛榴彈。' },
  { id: 'it_e60505', name: '泵動霰彈槍・街', kind: 'weapon', type: '主武器・霰彈槍', grade: 1, brand: '無牌', l2: 'ic-carry_main', price: 210, weight: 3, legality: '許可', trade: '武器', slot: 'main',
    stats: [['傷害', '5d6（1～2）／3d6（3）'], ['距離', '1～3'], ['彈匣', '2 格']] },
  { id: 'it_7c9988', name: 'M3 霰彈槍', kind: 'weapon', type: '主武器・霰彈槍', grade: 3, brand: '星旗', l2: 'ic-carry_main', price: 2600, weight: 3, legality: '許可', trade: '武器', slot: 'main',
    stats: [['傷害', '5d6（1～2）／3d6（3）'], ['距離', '1～3'], ['彈匣', '2 格']] },
  { id: 'it_9db829', name: '剪刀', kind: 'weapon', type: '近戰・刃', grade: 2, brand: '無牌', l2: 'ic-carry_melee', price: 48, weight: 1, legality: '自由', trade: '武器', slot: 'melee', unique: true,
    stats: [['效果', '穿甲 +1；對有義體的目標傷害 +1']], note: '改造師的線任務掉落的獨特零件。要保養。' },

  // ---- 護甲與服裝（ITEMS 3.3、7.1） ----
  { id: 'it_476d39', name: '防彈皮背心 再版', kind: 'armor', type: '護甲', grade: 2, brand: '同人', l2: 'ic-slot_armor', price: 1010, weight: 2, legality: '自由', trade: '護甲與服裝', slot: 'armor',
    stats: [['護甲', '3／3']], note: '穿在最外面，外皮的風格算數，威脅感也算。' },
  { id: 'it_7d6ad2', name: '戰術背心 M2', kind: 'armor', type: '護甲', grade: 2, brand: '星旗', l2: 'ic-slot_armor', price: 1130, weight: 3, legality: '自由', trade: '護甲與服裝', slot: 'armor',
    stats: [['護甲', '3／5'], ['快取格', '+2']] },
  { id: 'it_2755c6', name: '巷口棒球帽', kind: 'clothing', type: '頭部', grade: 1, brand: '同人', l2: 'ic-slot_head', price: 170, weight: 0.3, legality: '自由', trade: '護甲與服裝', slot: 'head', stats: [['風格', '街頭 +1']] },
  { id: 'it_095658', name: '特攻黑口罩', kind: 'clothing', type: '面部', grade: 1, brand: '同人', l2: 'ic-slot_face', price: 220, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: 'face', stats: [['風格', '特攻 +1'], ['認出你的臉', '−2']] },
  { id: 'it_ccbaca', name: '網眼發光背心', kind: 'clothing', type: '上身', grade: 1, brand: '同人', l2: 'ic-slot_top', price: 170, weight: 0.3, legality: '自由', trade: '護甲與服裝', slot: 'top', stats: [['風格', '霓虹龐克 +2'], ['曝露度', '1']] },
  { id: 'it_f40614', name: '巷口工裝褲', kind: 'clothing', type: '下身', grade: 1, brand: '同人', l2: 'ic-slot_bottom', price: 170, weight: 0.6, legality: '自由', trade: '護甲與服裝', slot: 'bottom', stats: [['風格', '街頭 +1']] },
  { id: 'it_f13bde', name: '櫻町百褶裙', kind: 'clothing', type: '下身', grade: 1, brand: '同人', l2: 'ic-slot_bottom', price: 260, weight: 0.4, legality: '自由', trade: '護甲與服裝', slot: 'bottom', stats: [['風格', '櫻町系'], ['媒體', '+1']] },
  { id: 'it_f359b2', name: '巷口機能夾克', kind: 'clothing', type: '外套', grade: 2, brand: '無牌', l2: 'ic-slot_coat', price: 580, weight: 1, legality: '自由', trade: '護甲與服裝', slot: 'coat', stats: [['風格', '街頭 +2'], ['藏匿量', '3']] },
  { id: 'it_f992bc', name: '掮客的長風衣', kind: 'clothing', type: '外套', grade: 2, brand: '同人', l2: 'ic-slot_coat', price: 900, weight: 1.4, legality: '登記', trade: '護甲與服裝', slot: 'coat', stats: [['風格', '街頭 +2'], ['藏匿量', '5']], note: '屏蔽襯裡：大小 1 以下的東西掃不到。' },
  { id: 'it_e9d1f5', name: '骨節半指手套', kind: 'clothing', type: '手', grade: 1, brand: '同人', l2: 'ic-slot_hands', price: 170, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: 'hands', stats: [['風格', '街頭 +1']] },
  { id: 'it_b378fa', name: '巷口帆布高筒鞋', kind: 'clothing', type: '鞋', grade: 1, brand: '無牌', l2: 'ic-slot_shoes', price: 50, weight: 0.8, legality: '自由', trade: '護甲與服裝', slot: 'shoes' },
  { id: 'it_b7771d', name: '灰色運動內衣', kind: 'clothing', type: '內衣', grade: 1, brand: '無牌', l2: 'ic-slot_bra', price: 20, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: 'bra' },
  { id: 'it_7ed029', name: '無痕內褲', kind: 'clothing', type: '內褲', grade: 1, brand: '織女', l2: 'ic-slot_panties', price: 30, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: 'panties' },

  // ---- 飾品（ITEMS 7.2） ----
  { id: 'it_dacaa0', name: '皮項圈', kind: 'accessory', type: '頸', grade: 1, brand: '無牌', l2: 'ic-acc_neck', price: 60, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: 'neck', stats: [['風格', '+1']] },
  { id: 'it_e405cc', name: '霓虹網（發光網襪）', kind: 'accessory', type: '腿', grade: 1, brand: '同人', l2: 'ic-acc_leg', price: 60, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: 'leg', stats: [['風格', '+1'], ['曝露度', '+1']] },
  { id: 'it_cc2629', name: '腕錶型板子', kind: 'accessory', type: '通用', grade: 1, brand: '織女', l2: 'ic-acc_ring', price: 230, weight: 0.1, legality: '自由', trade: '電子', slot: ['any1', 'any2', 'any3'], stats: [['功能', '當板子用']] },
  { id: 'it_5b44cf', name: '髮飾麥克風', kind: 'accessory', type: '通用', grade: 1, brand: '同人', l2: 'ic-acc_ring', price: 180, weight: 0.1, legality: '自由', trade: '電子', slot: ['any1', 'any2', 'any3'], stats: [['功能', '收音的素材']] },
  { id: 'it_9c3cd2', name: '叮噹步（腳踝鈴鍊）', kind: 'accessory', type: '通用', grade: 1, brand: '同人', l2: 'ic-acc_ring', price: 60, weight: 0.1, legality: '自由', trade: '護甲與服裝', slot: ['any1', 'any2', 'any3'], stats: [['風格', '+1'], ['隱匿', '−1']],
    gift: { value: 4, preview: '價值 +2，合她的風格 +2' } },

  // ---- 零件（ITEMS 第 2 節、第 12 節） ----
  { id: 'it_c27d44', name: '標準槍管 M2', kind: 'part', type: '零件・槍管', grade: 2, brand: '星旗', l2: 'ic-part_barrel', price: 140, weight: 0.5, legality: '登記', trade: '機械義體與零件', stats: [['效果', '傷害 +2']] },
  { id: 'it_2ea9f1', name: '標準機構 M2', kind: 'part', type: '零件・機構', grade: 2, brand: '星旗', l2: 'ic-part_mech', price: 140, weight: 0.5, legality: '登記', trade: '機械義體與零件', stats: [['效果', '壓制 DC +2']] },
  { id: 'it_b86505', name: '輕合金-100', kind: 'part', type: '零件・板材', grade: 1, brand: '織女', l2: 'ic-part_plate', price: 50, weight: 0.5, legality: '自由', trade: '機械義體與零件', stats: [['效果', '護甲 +1；重量 +1']] },
  { id: 'it_85d0d4', name: '鐵管・街', kind: 'part', type: '零件・槍管', grade: 1, brand: '無牌', l2: 'ic-part_barrel', price: 40, weight: 0.5, legality: '自由', trade: '機械義體與零件', stats: [['效果', '傷害 +2；擲出自然 1 時卡彈']] },
  { id: 'it_19e4c0', name: '拼裝・街', kind: 'part', type: '零件・機構', grade: 1, brand: '無牌', l2: 'ic-part_mech', price: 40, weight: 0.5, legality: '自由', trade: '機械義體與零件' },
  { id: 'it_7057c2', name: '標準晶片-200', kind: 'part', type: '零件・晶片', grade: 2, brand: '織女', l2: 'ic-part_chip', price: 680, weight: 0.1, legality: '登記', trade: '電子', stats: [['總容量', '46'], ['效果', '防火牆 +2']] },
  { id: 'it_de01bf', name: '夜曲 goodnight', kind: 'part', type: '零件・晶片', grade: 2, brand: '夜鶯', l2: 'ic-part_chip', price: 980, weight: 0.1, legality: '登記', trade: '電子', stats: [['總容量', '46'], ['效果', 'RAM 上限 +2；回報後門']] },
  { id: 'it_7a9246', name: '轉播站的天線', kind: 'part', type: '零件・晶片', grade: 3, brand: '聖堂', l2: 'ic-part_chip', price: 864, weight: 0.2, legality: '許可', trade: '電子', unique: true,
    stats: [['總容量', '52'], ['效果', '防火牆 +2；不受電磁']], note: '主播結局「地下轉播站」的獨特零件。' },

  // ---- 藥、消耗品、彈藥（ITEMS 第 4、5 節） ----
  { id: 'it_57e531', name: '止痛劑（棉花）', kind: 'drug', type: '藥', grade: 1, brand: '蜜腺', l2: 'ic-drug', price: 30, weight: 0.1, legality: '自由', trade: '藥', stats: [['效果', '重傷檢定的 −2 不算'], ['時效', '一場戰鬥，或 4 小時']] },
  { id: 'it_101552', name: '「軟糖」', kind: 'drug', type: '藥', grade: 1, brand: '伊甸園', l2: 'ic-drug', price: 40, weight: 0.1, legality: '自由', trade: '藥', stats: [['效果', '慾求 +10'], ['時效', '2 小時']] },
  { id: 'it_39841b', name: '抑制劑', kind: 'consumable', type: '藥・一週份', grade: 1, brand: '蜜腺', l2: 'ic-consumable', price: 80, weight: 0.1, legality: '自由', trade: '藥', stats: [['效果', '沉溺的下限 −10，到下週一']], note: '停藥一週後下限 +15，持續兩週。' },
  { id: 'it_8c6664', name: 'M2 止血針', kind: 'consumable', type: '消耗品', grade: 2, brand: '星旗', l2: 'ic-consumable', price: 140, weight: 0.1, legality: '自由', trade: '藥', stats: [['效果', '解除流血']] },
  { id: 'it_9da44a', name: 'M84 閃光彈', kind: 'consumable', type: '消耗品・投擲', grade: 1, brand: '星旗', l2: 'ic-consumable', price: 70, weight: 0.3, legality: '自由', trade: '彈藥', stats: [['效果', '兩格裡的人過定力 DC 13；失敗少 1 點行動點']] },
  { id: 'it_3b3851', name: '煙霧彈', kind: 'consumable', type: '消耗品・投擲', grade: 1, brand: '無牌', l2: 'ic-consumable', price: 60, weight: 0.3, legality: '自由', trade: '彈藥', stats: [['效果', '一格變成半掩體，兩回合']] },
  { id: 'it_cdfc0b', name: '真的食物', kind: 'consumable', type: '食物', grade: 1, brand: '—', l2: 'ic-consumable', price: 60, weight: 0.5, legality: '自由', trade: '奢侈品',
    gift: { value: 3, preview: '價值 +1，合喜好 +2' }, note: '送禮時親密度 +2；生體件算「好的生活」。' },
  { id: 'it_964af0', name: '糰糧（一天份）', kind: 'consumable', type: '食物', grade: 1, brand: '—', l2: 'ic-consumable', price: 8, weight: 0.3, legality: '自由', trade: '食物', gift: { value: 0, preview: '價值不到 10，不加親密度' } },
  { id: 'it_d6d1e2', name: '街邊的麵', kind: 'consumable', type: '食物', grade: 1, brand: '—', l2: 'ic-consumable', price: 5, weight: 0.3, legality: '自由', trade: '食物' },
  { id: 'it_5e3de4', name: '頭燈', kind: 'consumable', type: '雜貨', grade: 1, brand: '—', l2: 'ic-consumable', price: 30, weight: 0.2, legality: '自由', trade: '日用', stats: [['效果', '地下層與地下城的光線']] },

  // ---- 工具與貨物 ----
  { id: 'it_2c5068', name: '開鎖工具', kind: 'tool', type: '工具', grade: 2, brand: '無牌', l2: 'ic-tool', price: 120, weight: 1, legality: '登記', trade: '日用', stats: [['效果', '機械鎖的機械 +2']] },
  { id: 'it_d2d2de', name: '板子', kind: 'tool', type: '工具', grade: 1, brand: '織女', l2: 'ic-tool', price: 140, weight: 0.5, legality: '自由', trade: '電子', stats: [['效果', '不連橋的終端']] },
  { id: 'it_d6c14d', name: '夜視鏡', kind: 'tool', type: '工具', grade: 2, brand: '星旗', l2: 'ic-tool', price: 270, weight: 1, legality: '自由', trade: '電子', stats: [['效果', '戴著時攻擊不受黑暗影響']] },
  { id: 'it_1ace6d', name: '醫療包', kind: 'tool', type: '工具', grade: 2, brand: '織女', l2: 'ic-tool', price: 270, weight: 1, legality: '自由', trade: '藥', stats: [['效果', '急救的醫療檢定 +2；一包用 5 次']] },
  { id: 'it_c7f823', name: '星旗軍規電源一箱', kind: 'cargo', type: '貨物', grade: 4, brand: '星旗', l2: 'ic-cargo', price: 20000, weight: 6, legality: '違禁', trade: '電子', note: '熔爐偶爾流出；櫻町的電器街底下有人收。' },
  { id: 'it_7f887b', name: '二手晶片一袋', kind: 'cargo', type: '貨物', grade: 1, brand: '—', l2: 'ic-cargo', price: 400, weight: 1, legality: '自由', trade: '電子' },
  { id: 'it_54ddd2', name: '黑帶一卷', kind: 'cargo', type: '貨物・素材', grade: 2, brand: '—', l2: 'ic-cargo', price: 500, weight: 0.2, legality: '違禁', trade: '素材與帶子',
    gift: { value: -3, preview: '不知道她碰不碰黑帶；送了不合，可能算冒犯' } },
  { id: 'box_unknown', name: '包著的盒子', kind: 'misc', type: '未知', grade: 1, brand: '—', l2: 'ic-unknown', price: 0, weight: 1, legality: '自由', trade: '日用', note: '打開或請人鑑定之後才知道是什麼。' },

  // ---- 家具（DOWNTIME 7.5、7.7 節；家具沒有等級，一律 I） ----
  { id: 'fu_plant', name: '植物（真的）', kind: 'furniture', type: '家具・裝飾', grade: 1, brand: '—', l2: 'ic-fac_furniture', price: 200, weight: 2, legality: '自由', trade: '家具', furniture: 'plant_real' },
  { id: 'fu_workbench', name: '機械工作台', kind: 'furniture', type: '家具・工作台', grade: 1, brand: '—', l2: 'ic-fac_furniture', price: 3000, weight: 20, legality: '自由', trade: '家具', furniture: 'workbench' },
  { id: 'fu_box', name: '置物箱', kind: 'furniture', type: '家具・儲物', grade: 1, brand: '—', l2: 'ic-fac_furniture', price: 40, weight: 2, legality: '自由', trade: '家具', furniture: 'box' },
  { id: 'fu_neon', name: '霓虹招牌', kind: 'furniture', type: '家具・裝飾', grade: 1, brand: '—', l2: 'ic-fac_furniture', price: 120, weight: 2, legality: '自由', trade: '家具', furniture: 'neon' },
  { id: 'fu_doublebed', name: '雙人床', kind: 'furniture', type: '家具・床', grade: 1, brand: '—', l2: 'ic-fac_furniture', price: 600, weight: 30, legality: '自由', trade: '家具', furniture: 'double_bed' },
  { id: 'fu_netpod', name: '接入艙', kind: 'furniture', type: '家具・接入點', grade: 1, brand: '—', l2: 'ic-fac_furniture', price: 4000, weight: 40, legality: '自由', trade: '家具', furniture: 'netpod' },
]

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map(i => [i.id, i]))
export const itemDef = (id: string): ItemDef => {
  const d = ITEMS[id]
  if (!d) throw new Error(`沒有這個物品：${id}`)
  return d
}
