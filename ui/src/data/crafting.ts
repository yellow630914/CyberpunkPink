import type { Blueprint, Crafter } from '../lib/crafting'

/**
 * 會的設計圖（CRAFTING 第 3 節的槽，ITEMS 第 3 節的數值）。主角在這份假存檔裡會四張。
 * 三分咲的槽照 CRAFTING 第 12 節的例子：板材與致動器只收機械，神經元與外皮兩種都收。
 */
export const BLUEPRINTS: Blueprint[] = [
  {
    item: 'bp_sanbu', product: 'it_844ea8', family: '義體', grade: 2, brand: '緋櫻',
    slots: [
      { id: 'plate', type: '板材', required: true, material: '機' },
      { id: 'act', type: '致動器', required: true, material: '機' },
      { id: 'neuron', type: '機械神經元', required: true, material: '皆' },
      { id: 'skin', type: '外皮', required: false, material: '皆' },
      { id: 'hidden', type: '刃', required: false, material: '機', label: '內藏槽' },
    ],
    base: [['力量', '+2'], ['速度', '+1'], ['重量', 3], ['沉溺成本', 6]],
    setBonus: '緋櫻全套：同步回灌 −10%、要害 +1；授權鎖也是全套的',
  },
  {
    item: 'bp_m3rifle', product: 'it_c7dbe5', family: '武器', grade: 3, brand: '星旗',
    slots: [
      { id: 'barrel', type: '槍管', required: true, material: '機' },
      { id: 'mech', type: '機構', required: true, material: '機' },
      { id: 'plate', type: '板材', required: true, material: '機', label: '板材（槍托）' },
      { id: 'sensor', type: '感測器', required: false, material: '機', label: '感測器（瞄具）' },
      { id: 'act', type: '致動器', required: false, material: '機', label: '致動器（後座力補償）' },
    ],
    base: [['傷害', '4d6 物理，穿甲 2'], ['距離', '3～7'], ['彈匣', 3], ['重量', 3.5]],
    setBonus: '星旗全套：不卡彈、耐久 +',
  },
  {
    item: 'bp_vest', product: 'it_7d6ad2', family: '護甲', grade: 2, brand: '星旗',
    slots: [
      { id: 'fiber', type: '纖維', required: true, material: '機' },
      { id: 'plate1', type: '板材', required: true, material: '機', label: '板材 1' },
      { id: 'plate2', type: '板材', required: true, material: '機', label: '板材 2' },
      { id: 'skin', type: '外皮', required: false, material: '皆' },
    ],
    base: [['護甲', '3／5'], ['快取格', '+2'], ['重量', 3]],
    setBonus: '星旗全套：耐久 +',
  },
  {
    item: 'bp_meshtop', product: 'it_ccbaca', family: '服裝', grade: 1, brand: '同人',
    slots: [
      { id: 'fiber', type: '纖維', required: true, material: '皆' },
      { id: 'skin', type: '外皮', required: true, material: '皆', label: '外皮（面料）' },
    ],
    base: [['風格', '霓虹龐克 +2'], ['曝露度', 1]],
  },
]

/** 開場時三分咲的槽已經放好的（UI 第 9 節的例子）：板材是輕合金-100，神經元是活體神經。 */
export const START_FILL: Record<string, Record<string, string>> = {
  bp_sanbu: { plate: 'it_b86505', neuron: 'it_303b76' },
  bp_m3rifle: { barrel: 'it_c27d44' },
}

/** 這一份假存檔裡找得到的人（UI 第 9 節「誰來做」只列這個據點或設施有的）。 */
export const CRAFTERS: Crafter[] = [
  { id: 'self', name: '自己', skill: 0, fee: 0, hours: 2 },
  { id: 'zero', name: '零（夥伴）', skill: 2, fee: 0, hours: 3 },
  { id: 'fengfeng', name: '縫縫診所', fee: 600, hours: 2, quality: '穩定的成功，會登記', noOverspec: true },
  { id: 'doujin', name: '午夜印刷的社團', skill: 6, fee: 200, hours: 4, quality: '願意超規，成品可能多一個怪癖' },
]
