import type { ItemDef, PartType } from './types'

/**
 * 第二版加的物品（假資料，取自 docs/gear/ITEMS.md）：組裝用的零件與設計圖、構裝與 SKIN、建角的起始裝備。
 * id 是第 3 層圖標的 id（docs/art/icons/items.csv）；同一個系列只有一個圖標的（構裝、消耗品分 I～IV），
 * 用自己的 id，圖標寫在 icon。
 */
export const EXTRA_ITEMS: ItemDef[] = [
  // ---- 零件（ITEMS 2.2、2.4、2.5、2.8、2.11、2.12） ----
  { id: 'it_70a527', name: '細工・三分咲', kind: 'part', type: '零件・致動器', grade: 2, brand: '緋櫻', l2: 'ic-part_actuator', price: 750, weight: 0.5, legality: '自由', trade: '機械義體與零件', part: { type: '致動器', material: '機' }, stats: [['效果', '連射的命中 +1']], note: '手很穩。' },
  { id: 'it_3fe2b1', name: '細工・五分咲', kind: 'part', type: '零件・致動器', grade: 3, brand: '緋櫻', l2: 'ic-part_actuator', price: 2400, weight: 0.5, legality: '許可', trade: '機械義體與零件', part: { type: '致動器', material: '機' }, stats: [['效果', '後座力 +1；體格類 +1']] },
  { id: 'it_398b67', name: '培養肌・芽', kind: 'part', type: '零件・致動器', grade: 2, brand: '蜜腺', l2: 'ic-part_actuator', price: 1000, weight: 0.5, legality: '自由', trade: '生體件', part: { type: '致動器', material: '生' }, stats: [['效果', '體格類 +1；隨成熟度長']] },
  { id: 'it_303b76', name: '活體神經・芽', kind: 'part', type: '零件・機械神經元', grade: 2, brand: '蜜腺', l2: 'ic-part_neuron', price: 1500, weight: 0.1, legality: '自由', trade: '生體件', part: { type: '機械神經元', material: '生' }, stats: [['效果', '沉溺成本 −2；感載的受傷倍率 +10%']] },
  { id: 'it_e7b262', name: '標準神經元-200', kind: 'part', type: '零件・機械神經元', grade: 2, brand: '織女', l2: 'ic-part_neuron', price: 680, weight: 0.1, legality: '登記', trade: '機械義體與零件', part: { type: '機械神經元', material: '機' }, stats: [['效果', '沉溺成本 −1；耐受 +5']] },
  { id: 'it_7efcd5', name: '白鐵 M2', kind: 'part', type: '零件・板材', grade: 2, brand: '星旗', l2: 'ic-part_plate', price: 180, weight: 1, legality: '自由', trade: '機械義體與零件', part: { type: '板材', material: '機' }, stats: [['效果', '護甲 +1']] },
  { id: 'it_dce350', name: '活皮・芽', kind: 'part', type: '零件・外皮', grade: 2, brand: '蜜腺', l2: 'ic-part_skin', price: 600, weight: 0.1, legality: '自由', trade: '生體件', part: { type: '外皮', material: '生' }, stats: [['效果', '風格 +1；有體溫；掃不到']] },
  { id: 'it_9f910c', name: '消光 M2', kind: 'part', type: '零件・外皮', grade: 2, brand: '星旗', l2: 'ic-part_skin', price: 270, weight: 0.1, legality: '登記', trade: '機械義體與零件', part: { type: '外皮', material: '機' }, stats: [['風格', '畫報系'], ['效果', '防掃描']] },
  { id: 'it_739e7c', name: '刀片・巷', kind: 'part', type: '零件・刃', grade: 2, brand: '無牌', l2: 'ic-part_blade', price: 260, weight: 0.3, legality: '登記', trade: '機械義體與零件', part: { type: '刃', material: '機' }, stats: [['效果', '近戰傷害 +1']] },
  { id: 'it_0377b8', name: '輕量纖維-200', kind: 'part', type: '零件・纖維', grade: 2, brand: '織女', l2: 'ic-part_fiber', price: 270, weight: 0.3, legality: '自由', trade: '護甲與服裝', part: { type: '纖維', material: '機' }, stats: [['效果', '隱匿 +1；重量 −1']] },
  { id: 'it_78acc1', name: '街布・巷', kind: 'part', type: '零件・纖維', grade: 2, brand: '無牌', l2: 'ic-part_fiber', price: 240, weight: 0.3, legality: '自由', trade: '護甲與服裝', part: { type: '纖維', material: '機' }, stats: [['效果', '重量 −1；隱匿 +1']] },
  { id: 'it_887c51', name: '三七開 再版', kind: 'part', type: '零件・軟體', grade: 2, brand: '同人', l2: 'ic-part_software', price: 600, weight: 0, legality: '自由', trade: '電子', part: { type: '軟體', material: '機' }, stats: [['效果', '橋的配分偏內海與媒體']] },
  { id: 'it_d46a7e', name: '大彈匣・貳', kind: 'part', type: '零件・機構', grade: 2, brand: '崑崙', l2: 'ic-part_mech', price: 560, weight: 0.5, legality: '登記', trade: '機械義體與零件', part: { type: '機構', material: '機' }, stats: [['效果', '彈匣 +1 格']] },

  // ---- 設計圖（ITEMS 第 3 節、CRAFTING 第 3 節） ----
  { id: 'bp_sanbu', name: '義臂「三分咲」', kind: 'blueprint', type: '設計圖・義體・臂', grade: 2, brand: '緋櫻', l2: 'ic-bp', icon: 'it_844ea8', price: 2610, weight: 0, legality: '自由', trade: '機械義體與零件', note: '緋櫻的花名系列。III 級是五分咲。' },
  { id: 'bp_m3rifle', name: 'M3 步槍', kind: 'blueprint', type: '設計圖・武器・步槍', grade: 3, brand: '星旗', l2: 'ic-bp', icon: 'it_c7dbe5', price: 4840, weight: 0, legality: '許可', trade: '武器' },
  { id: 'bp_vest', name: '戰術護甲', kind: 'blueprint', type: '設計圖・護甲', grade: 2, brand: '星旗', l2: 'ic-bp', icon: 'it_7d6ad2', price: 1130, weight: 0, legality: '自由', trade: '護甲與服裝' },
  { id: 'bp_meshtop', name: '網眼發光背心', kind: 'blueprint', type: '設計圖・服裝・上身', grade: 1, brand: '同人', l2: 'ic-bp', icon: 'it_ccbaca', price: 170, weight: 0, legality: '自由', trade: '護甲與服裝' },

  // ---- 組裝的成品（設計圖畫出來的那一件） ----
  { id: 'it_844ea8', name: '義臂「三分咲」', kind: 'cyberware', type: '臂的義體', grade: 2, brand: '緋櫻', l2: 'ic-cw_arm', price: 2610, weight: 0, legality: '自由', trade: '機械義體與零件',
    cyber: { part: 'armL', invasive: '侵入', sink: 6, material: '皆', effect: '義臂：力量 +2、速度 +1；內藏槽 1' }, note: '自己組的；裝到身上要在診所。' },

  // ---- 調校（LEWD_SYSTEM 第 4 節）：裝在橋的調校槽裡的韌體設定檔，在調校診所裝卸 ----
  { id: 'tu_pain', name: '調校「痛覺轉譯」', kind: 'cyberware', type: '調校', grade: 2, brand: '鉻娘子改', l2: 'ic-cw_bridge', price: 900, weight: 0, legality: '許可', trade: '電子',
    cyber: { part: 'bridge', invasive: '表層', sink: 1, material: '機', effect: '受到的生命值傷害有 20% 改成感載；代價：重傷時更容易過載' } },
  { id: 'tu_spot', name: '調校「聚光」', kind: 'cyberware', type: '調校', grade: 2, brand: '萬華鏡', l2: 'ic-cw_bridge', price: 1200, weight: 0, legality: '自由', trade: '電子',
    cyber: { part: 'bridge', invasive: '表層', sink: 1, material: '機', effect: '被注視時檢定 +2；代價：沒人看的時候定力 −2，豔名成長加倍' } },
  { id: 'tu_ice', name: '調校「冰后」', kind: 'cyberware', type: '調校', grade: 3, brand: '貞網局', l2: 'ic-cw_bridge', price: 2600, weight: 0, legality: '許可', trade: '電子',
    cyber: { part: 'bridge', invasive: '表層', sink: 0, material: '機', effect: '抵抗誘惑、勸降、粉蕾絲 +4；代價：親密關係不降低沉溺，餘韻沒有正面效果' } },
  { id: 'tu_still', name: '調校「靜水」', kind: 'cyberware', type: '調校', grade: 2, brand: '正規診所', l2: 'ic-cw_bridge', price: 800, weight: 0, legality: '自由', trade: '電子',
    cyber: { part: 'bridge', invasive: '表層', sink: 0, material: '機', effect: '每回合感載消退 +2 點，現實與內海都有效；代價：開不了全同步' } },

  // ---- 構裝（ITEMS 11.2～11.4） ----
  { id: 'cs_kefu1', name: '構裝「客服專線」I', kind: 'construct', type: '武器構裝・手槍', grade: 1, brand: '夜鶯', l2: 'ic-net_weapon', icon: 'it_051f1d', price: 200, weight: 0, legality: '登記', trade: '電子', net: { cls: '武器', ram: 1 }, stats: [['傷害', '3d6 神經'], ['距離', '1～4'], ['RAM', '1']], note: '回報後門：在夜鶯的子網裡每次攻擊追蹤度 +1。' },
  { id: 'cs_line1', name: '構裝「網線」I', kind: 'construct', type: '武器構裝・鞭', grade: 1, brand: '同人', l2: 'ic-net_weapon', icon: 'it_d1ad4d', price: 100, weight: 0, legality: '登記', trade: '電子', net: { cls: '武器', ram: 1 }, stats: [['傷害', '2d6 神經'], ['距離', '1～2']], note: '命中時把目標拉近一格。怪癖：自然 1 時纏住自己。' },
  { id: 'cs_window1', name: '構裝「客服窗」I', kind: 'construct', type: '防護構裝', grade: 1, brand: '夜鶯', l2: 'ic-net_defense', icon: 'it_3d7045', price: 230, weight: 0, legality: '自由', trade: '電子', net: { cls: '防護' }, stats: [['防護', '2']] },
  { id: 'cs_cool1', name: '構裝「散熱罩」I', kind: 'construct', type: '防護構裝', grade: 1, brand: '織女', l2: 'ic-net_defense', icon: 'it_7766b5', price: 140, weight: 0, legality: '自由', trade: '電子', net: { cls: '防護' }, stats: [['防護', '2'], ['效果', '每回合開始感載 −1']] },
  { id: 'cs_probe2', name: '構裝「探針」II', kind: 'construct', type: '工具構裝', grade: 2, brand: '夜鶯', l2: 'ic-net_tool', icon: 'it_652ac6', price: 520, weight: 0, legality: '自由', trade: '電子', net: { cls: '工具', ram: 1 }, stats: [['行動點', '1'], ['效果', '看一個敵人的感載與構裝；下一次打他 +2']] },
  { id: 'cs_pistol1', name: '構裝「入門手槍」I', kind: 'construct', type: '武器構裝・手槍', grade: 1, brand: '織女', l2: 'ic-net_weapon', icon: 'it_614652', price: 120, weight: 0, legality: '登記', trade: '電子', net: { cls: '武器', ram: 1 }, stats: [['傷害', '3d6 神經'], ['距離', '1～4']] },

  // ---- SKIN（ITEMS 11.8） ----
  { id: 'it_64cfe6', name: '預設化身', kind: 'skin', type: 'SKIN・中性', grade: 1, brand: '夜鶯', l2: 'ic-skin', price: 0, weight: 0, legality: '自由', trade: '電子', net: { cls: 'SKIN', style: '街頭', styleValue: 1, exposure: 0 }, note: '白色的人形，五官很淡，頭頂的名字是一串號碼。' },
  { id: 'it_d212f6', name: '應援 T', kind: 'skin', type: 'SKIN・中性', grade: 2, brand: '同人', l2: 'ic-skin', price: 130, weight: 0, legality: '自由', trade: '電子', net: { cls: 'SKIN', style: '偶像', styleValue: 2, exposure: 0 }, note: '印著推的名字的大 T 恤，兩手各握一根會變色的螢光棒。' },
  { id: 'it_0f2ab1', name: '家政課女僕服（網內版）', kind: 'skin', type: 'SKIN・女', grade: 3, brand: '緋櫻', l2: 'ic-skin', price: 900, weight: 0, legality: '自由', trade: '電子', net: { cls: 'SKIN', style: '女僕', styleValue: 3, exposure: 0 }, note: '黑色長裙配白圍裙，圍裙燙得筆直，頭上一朵蕾絲頭飾。' },

  // ---- 建角的起始裝備（CHARACTER 5.4 節） ----
  { id: 'it_5f8f4a', name: '入門甲板-100', kind: 'cyberware', type: '腦的義體', grade: 1, brand: '織女', l2: 'ic-cw_brain', price: 750, weight: 0, legality: '自由', trade: '電子', cyber: { part: 'brain', invasive: '侵入', sink: 5, material: '機', effect: '構裝槽 3；防火牆 10；潛入時每回合感載多消退 1 點' } },
  { id: 'cg_gel1', name: '急救凝膠 I', kind: 'consumable', type: '消耗品', grade: 1, brand: '織女', l2: 'ic-consumable', icon: 'it_a3d15c', price: 60, weight: 0.1, legality: '自由', trade: '藥', stats: [['效果', '立刻回 8 點生命值；止血']] },
  { id: 'cg_refill1', name: '腳本「回填包」I', kind: 'consumable', type: '腳本', grade: 1, brand: '夜鶯', l2: 'ic-consumable', icon: 'it_3241a5', price: 120, weight: 0, legality: '自由', trade: '電子', stats: [['效果', 'RAM 立刻回 2 點']] },
  { id: 'cg_eraser1', name: '腳本「本子橡皮擦」I', kind: 'consumable', type: '腳本', grade: 1, brand: '同人', l2: 'ic-consumable', icon: 'it_65ed16', price: 65, weight: 0, legality: '自由', trade: '電子', stats: [['效果', '追蹤度 −10']] },
  { id: 'cg_cool1', name: '冷卻劑 I', kind: 'consumable', type: '藥', grade: 1, brand: '蜜腺', l2: 'ic-consumable', icon: 'it_2e7f9a', price: 70, weight: 0.1, legality: '自由', trade: '藥', stats: [['效果', '消一層餘韻，排掉感載 4']] },
]

/** v1 的物品裡本來就是零件的那幾件：補上組裝用的類型與材質。 */
export const PART_OF: Record<string, { type: PartType; material: '機' | '生' }> = {
  it_c27d44: { type: '槍管', material: '機' },
  it_85d0d4: { type: '槍管', material: '機' },
  it_2ea9f1: { type: '機構', material: '機' },
  it_19e4c0: { type: '機構', material: '機' },
  it_b86505: { type: '板材', material: '機' },
  it_7057c2: { type: '晶片', material: '機' },
  it_de01bf: { type: '晶片', material: '機' },
  it_7a9246: { type: '晶片', material: '機' },
}
