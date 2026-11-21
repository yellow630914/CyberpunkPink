import type { BodyPartDef, Character, EquipSlotDef, ItemStack, PartyMember, BodyPartId, EquipSlotId } from './types'

/** 義體的部位與槽數（docs/gear/CYBERWARE.md 第 1 節）。左右照 docs/art/body-slots.svg 的排法。 */
export const BODY_PARTS: BodyPartDef[] = [
  { id: 'brain', name: '腦', slots: 3, icon: 'ic-cw_brain', side: 'left', hint: '甲板、反射加速器、記憶庫、人格面具槽、人偶晶片。' },
  { id: 'eye', name: '眼', slots: 2, icon: 'ic-cw_eye', side: 'left', hint: '義眼（瞄準、夜視、錄影）、掃描器。' },
  { id: 'skin', name: '皮膚', slots: 2, icon: 'ic-cw_skin', side: 'left', hint: '觸覺強化皮膚、光學迷彩、光紋刺青。' },
  { id: 'armL', name: '左臂', slots: 2, icon: 'ic-cw_arm', side: 'left', hint: '義臂、內藏武器、駭入接頭、手術指。' },
  { id: 'legL', name: '左腿', slots: 2, icon: 'ic-cw_leg', side: 'left', hint: '義腿、跳躍增壓、靜音足墊。' },
  { id: 'earthroat', name: '耳與喉', slots: 2, icon: 'ic-cw_earthroat', side: 'right', hint: '聲紋偽裝、指向收音、費洛蒙腺。' },
  { id: 'bridge', name: '橋', slots: 1, extraSlots: 2, extraName: '調校槽', icon: 'ic-cw_bridge', side: 'right', hint: '邊緣橋本體，在後頸。型號決定四類技能的容量；另有 2 個調校槽。' },
  { id: 'torso', name: '軀幹', slots: 3, icon: 'ic-cw_torso', side: 'right', hint: '皮下裝甲、合成臟器、藥泵、備用心臟。' },
  { id: 'armR', name: '右臂', slots: 2, icon: 'ic-cw_arm', side: 'right', hint: '義臂、內藏武器、駭入接頭、手術指。' },
  { id: 'legR', name: '右腿', slots: 2, icon: 'ic-cw_leg', side: 'right', hint: '義腿、跳躍增壓、靜音足墊。' },
  { id: 'intimate', name: '私密', slots: 2, icon: 'ic-cw_intimate', side: 'right', hint: '感官強化、鎖具、藏匿艙。' },
]

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
  { id: 'zero', name: '零', role: '潛網者', sink: 81, hp: [30, 36], load: [24, 40], afterglow: 2 },
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
  { uid: 's20', def: 'it_39841b', qty: 1, condition: '全新' },
  { uid: 's21', def: 'fu_plant', qty: 1, condition: '全新' },
  { uid: 's22', def: 'fu_workbench', qty: 1, condition: '二手' },
  { uid: 's23', def: 'fu_box', qty: 2, condition: '全新' },
  { uid: 's24', def: 'it_5b44cf', qty: 1, condition: '全新' },
]

/** 裝在身上的義體：部位 → 每一槽的物品 id（null 是空槽）。橋的調校槽另算。 */
export const START_CYBER: Record<BodyPartId, Array<string | null>> = {
  bridge: ['it_3882ae', null, null],
  brain: ['it_d553bd', 'it_91ec53', null],
  eye: ['it_34c398', null],
  earthroat: ['it_a4b7d6', null],
  torso: ['it_463387', null, null],
  skin: ['it_2ddbd0', null],
  armL: [null, null],
  armR: ['it_7bda7b', 'it_f559cd'],
  legL: [null, null],
  legR: [null, null],
  intimate: [null, null],
}

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
