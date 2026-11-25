import type { Character, EquipSlotDef, ItemStack, PartyMember, EquipSlotId } from './types'

/** 穿著 10 格、飾品 5 格、攜帶 3 格（docs/gear/EQUIPMENT.md 第 2～4 節）。 */
export const EQUIP_SLOTS: EquipSlotDef[] = [
  { id: 'head', name: '頭部', group: '穿著', icon: 'ic-slot_head', accepts: 'head' },
  { id: 'face', name: '面部', group: '穿著', icon: 'ic-slot_face', accepts: 'face' },
  { id: 'coat', name: '外套', group: '穿著', icon: 'ic-slot_coat', accepts: 'coat' },
  { id: 'armor', name: '護甲', group: '穿著', icon: 'ic-slot_armor', accepts: 'armor', coveredByCoat: true },
  { id: 'top', name: '上身', group: '穿著', icon: 'ic-slot_top', accepts: 'top', coveredByCoat: true },
  { id: 'bottom', name: '下身', group: '穿著', icon: 'ic-slot_bottom', accepts: 'bottom' },
  { id: 'hands', name: '手', group: '穿著', icon: 'ic-slot_hands', accepts: 'hands' },
  { id: 'shoes', name: '鞋', group: '穿著', icon: 'ic-slot_shoes', accepts: 'shoes' },
  { id: 'bra', name: '內衣', group: '穿著', icon: 'ic-slot_bra', accepts: 'bra', coveredByCoat: true },
  { id: 'panties', name: '內褲', group: '穿著', icon: 'ic-slot_panties', accepts: 'panties' },
  { id: 'neck', name: '頸', group: '飾品', icon: 'ic-acc_neck', accepts: 'neck' },
  { id: 'leg', name: '腿', group: '飾品', icon: 'ic-acc_leg', accepts: 'leg' },
  { id: 'any1', name: '通用', group: '飾品', icon: 'ic-acc_ring', accepts: 'any1' },
  { id: 'any2', name: '通用', group: '飾品', icon: 'ic-acc_ring', accepts: 'any2' },
  { id: 'any3', name: '通用', group: '飾品', icon: 'ic-acc_ring', accepts: 'any3' },
  { id: 'main', name: '主武器', group: '攜帶', icon: 'ic-carry_main', accepts: 'main' },
  { id: 'side', name: '副武器', group: '攜帶', icon: 'ic-carry_side', accepts: 'side' },
  { id: 'melee', name: '近戰', group: '攜帶', icon: 'ic-carry_melee', accepts: 'melee' },
]

export const PROTAGONIST: Character = {
  name: '你',
  origin: '蜂巢的巷子',
  trees: ['槍手 3', '掮客 2'],
  xp: 26,
  insight: 4,
  rep: 38,
  repTitle: '熟面孔',
  hp: [38, 44],
  load: [11, 38],
  layers: [1, 3],
  afterglow: 1,
  sink: 58,
  traits: { good: ['巷子裡的眼睛', '手穩'], bad: ['欠阿蓮一筆'] },
  privates: { look: '剃得乾乾淨淨', note: '左邊大腿內側有一顆小痣。' },
  attrs: [
    { name: '體格', base: 12, eff: 12 },
    { name: '反應', base: 15, eff: 17, src: '早咲・五分咲 +2' },
    { name: '技術', base: 8, eff: 8 },
    { name: '智識', base: 13, eff: 14, src: '入門甲板-200 +1' },
    { name: '意志', base: 12, eff: 12 },
    { name: '魅力', base: 14, eff: 14 },
  ],
}

export const PARTY: PartyMember[] = [
  { id: 'me', name: '你', role: '槍手', sink: 58, hp: [38, 44], load: [11, 38], afterglow: 1, me: true },
  { id: 'npc_zero', name: '零', role: '潛網者', sink: 81, hp: [30, 36], load: [24, 40], afterglow: 2 },
]

/** 開局的背包。uid 只在這一局裡唯一。 */
export const START_INVENTORY: ItemStack[] = [
  { uid: 's1', def: 'it_6fa4e8', qty: 1, condition: '二手' },
  { uid: 's2', def: 'it_9db829', qty: 1, condition: '全新' },
  { uid: 's3', def: 'it_7a9246', qty: 1, condition: '全新' },
  { uid: 's4', def: 'it_de01bf', qty: 2, condition: '全新' },
  { uid: 's5', def: 'it_b86505', qty: 4, condition: '全新' },
  { uid: 's6', def: 'it_c27d44', qty: 1, condition: '全新' },
  { uid: 's7', def: 'it_9da44a', qty: 3, condition: '全新' },
  { uid: 's8', def: 'it_101552', qty: 2, condition: '全新' },
  { uid: 's9', def: 'it_57e531', qty: 2, condition: '全新' },
  { uid: 's10', def: 'it_c7f823', qty: 1, condition: '全新' },
  { uid: 's11', def: 'it_f13bde', qty: 1, condition: '全新' },
  { uid: 's12', def: 'it_f992bc', qty: 1, condition: '二手' },
  { uid: 's13', def: 'it_cdfc0b', qty: 1, condition: '全新' },
  { uid: 's14', def: 'it_964af0', qty: 3, condition: '全新' },
  { uid: 's15', def: 'it_9c3cd2', qty: 1, condition: '全新' },
  { uid: 's16', def: 'it_54ddd2', qty: 1, condition: '全新' },
  { uid: 's17', def: 'it_5e3de4', qty: 1, condition: '全新' },
  { uid: 's18', def: 'it_d6c14d', qty: 1, condition: '二手' },
  { uid: 's19', def: 'box_unknown', qty: 1, condition: '全新', unknown: true },
  { uid: 's90', def: 'it_844ea8', qty: 1, condition: '全新' },
  { uid: 's91', def: 'tu_still', qty: 1, condition: '全新' },
  { uid: 's20', def: 'it_39841b', qty: 1, condition: '全新' },
  { uid: 's21', def: 'fu_plant', qty: 1, condition: '全新' },
  { uid: 's22', def: 'fu_workbench', qty: 1, condition: '二手' },
  { uid: 's23', def: 'fu_box', qty: 2, condition: '全新' },
  { uid: 's24', def: 'it_5b44cf', qty: 1, condition: '全新' },
  // 第二版：組裝用的設計圖與零件
  { uid: 's25', def: 'bp_sanbu', qty: 1, condition: '全新' },
  { uid: 's26', def: 'bp_m3rifle', qty: 1, condition: '全新' },
  { uid: 's27', def: 'bp_vest', qty: 1, condition: '全新' },
  { uid: 's28', def: 'bp_meshtop', qty: 1, condition: '全新' },
  { uid: 's29', def: 'it_70a527', qty: 1, condition: '全新' },
  { uid: 's30', def: 'it_3fe2b1', qty: 1, condition: '二手' },
  { uid: 's31', def: 'it_398b67', qty: 1, condition: '全新' },
  { uid: 's32', def: 'it_303b76', qty: 1, condition: '全新' },
  { uid: 's33', def: 'it_e7b262', qty: 1, condition: '全新' },
  { uid: 's34', def: 'it_7efcd5', qty: 2, condition: '全新' },
  { uid: 's35', def: 'it_dce350', qty: 1, condition: '全新' },
  { uid: 's36', def: 'it_9f910c', qty: 1, condition: '全新' },
  { uid: 's37', def: 'it_739e7c', qty: 1, condition: '二手' },
  { uid: 's38', def: 'it_0377b8', qty: 1, condition: '全新' },
  { uid: 's39', def: 'it_78acc1', qty: 1, condition: '全新' },
  { uid: 's40', def: 'it_d46a7e', qty: 1, condition: '全新' },
  { uid: 's41', def: 'cg_gel1', qty: 2, condition: '全新' },
  { uid: 's42', def: 'cs_cool1', qty: 1, condition: '全新' },
  { uid: 's43', def: 'cs_pistol1', qty: 1, condition: '二手' },
]

/** 穿在身上的：欄位 → 物品 id。 */
export const START_EQUIP: Partial<Record<EquipSlotId, string>> = {
  head: 'it_2755c6',
  face: 'it_095658',
  coat: 'it_f359b2',
  armor: 'it_476d39',
  top: 'it_ccbaca',
  bottom: 'it_f40614',
  hands: 'it_e9d1f5',
  shoes: 'it_b378fa',
  bra: 'it_b7771d',
  panties: 'it_7ed029',
  neck: 'it_dacaa0',
  leg: 'it_e405cc',
  any1: 'it_cc2629',
  side: 'it_7eb6ee',
}

/** 快取格（EQUIPMENT 4.1 節）：每個人 2 格，上限 8。 */
export const START_QUICK: Array<string | null> = ['it_8c6664', 'it_3b3851', null]
