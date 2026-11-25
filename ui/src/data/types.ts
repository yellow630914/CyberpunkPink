// 介面用的資料型別。欄位名照文件的資料格式（docs/gear/ITEMS.md 第 10 節、docs/systems/DOWNTIME.md 第 9 節），
// 但只放介面需要的；引擎做好之後，這些型別改成從引擎的型別匯入。

/** 物品等級 I～V，存成 1～5。 */
export type Grade = 1 | 2 | 3 | 4 | 5

export type ItemKind =
  | 'cyberware' | 'weapon' | 'armor' | 'clothing' | 'accessory' | 'part'
  | 'blueprint' | 'drug' | 'consumable' | 'ammo' | 'cargo' | 'tool' | 'furniture' | 'misc'
  | 'construct' | 'skin'

/** 背包的篩選（UI.md 3.7 節）。 */
export type BagFilter = 'all' | 'gear' | 'cyberware' | 'part' | 'blueprint' | 'consumable' | 'material' | 'cargo' | 'misc'

export type Legality = '自由' | '登記' | '許可' | '違禁'
export type Condition = '全新' | '二手' | '瑕疵' | '同人' | '精工'

export type TradeCategory =
  | '食物' | '日用' | '藥' | '彈藥' | '武器' | '護甲與服裝' | '機械義體與零件' | '生體件' | '電子' | '燃料' | '奢侈品' | '素材與帶子' | '家具'

export interface ItemDef {
  id: string
  name: string
  kind: ItemKind
  /** 種類的白話：「副武器」「腦的義體」「上身」 */
  type: string
  grade: Grade
  brand: string
  /** 第 3 層圖標（icons-l3-sprite.svg 的 id，例：it_7eb6ee）；沒有就用 l2。 */
  icon?: string
  /** 第 2 層圖標（icons-sprite.svg 的 id，例：ic-carry_side）。 */
  l2: string
  /** 目錄價（ITEMS 的「價」或「成品」欄，四十二番街、全新） */
  price: number
  weight: number
  legality: Legality
  trade: TradeCategory
  unique?: boolean
  stats?: Array<[string, string]>
  /** 物品說明：放在「?」裡，不直接顯示（UI 規則 5）。 */
  note?: string
  /** 可以裝的欄位（服裝、飾品、攜帶） */
  slot?: EquipSlotId | EquipSlotId[]
  /** 義體 */
  cyber?: { part: BodyPartId; invasive: '表層' | '一般' | '侵入' | '重度' | '極限'; sink: number; material: '機' | '生' | '皆'; effect: string; license?: string; warning?: string }
  /** 家具 */
  furniture?: string
  gift?: { value: number; preview: string }
  /** 目錄上的預設顏色（主色調、副色調；色票 id 或 #RRGGBB）。沒寫就照牌子（lib/dye.ts） */
  colors?: [string, string]
  /** 零件（CRAFTING 第 2、5 節）：類型、材質 */
  part?: { type: PartType; material: '機' | '生' }
  /** 構裝（ITEMS 11 節）：類別、RAM；SKIN：風格、風格值、曝露度 */
  net?: { cls: '武器' | '防護' | '工具' | '駭入' | '構裝體'; ram?: number } | { cls: 'SKIN'; style: string; styleValue: number; exposure: number }
}

export type PartType = '晶片' | '機械神經元' | '軟體' | '板材' | '致動器' | '感測器' | '電源' | '外皮' | '槍管' | '機構' | '刃' | '纖維'

export interface ItemStack {
  uid: string
  def: string
  qty: number
  condition: Condition
  /** 包著的盒子：鑑定之前只看得到第 1 層圖標 */
  unknown?: boolean
}

// ---- 身體與裝備 ----
export type BodyPartId = 'bridge' | 'brain' | 'eye' | 'earthroat' | 'torso' | 'skin' | 'armL' | 'armR' | 'legL' | 'legR' | 'intimate'

export interface BodyPartDef { id: BodyPartId; name: string; slots: number; extraSlots?: number; extraName?: string; icon: string; side: 'left' | 'right'; hint: string }

export type EquipSlotId =
  | 'head' | 'face' | 'top' | 'bottom' | 'coat' | 'armor' | 'hands' | 'shoes' | 'bra' | 'panties'
  | 'neck' | 'leg' | 'any1' | 'any2' | 'any3'
  | 'main' | 'side' | 'melee'

export interface EquipSlotDef { id: EquipSlotId; name: string; group: '穿著' | '飾品' | '攜帶'; icon: string; accepts: EquipSlotId; coveredByCoat?: boolean }

// ---- 人 ----
export interface Character {
  name: string
  origin: string
  trees: string[]
  xp: number
  insight: number
  rep: number
  repTitle: string
  hp: [number, number]
  load: [number, number]
  layers: [number, number]
  afterglow: number
  sink: number
  traits: { good: string[]; bad: string[] }
  /** 私處的樣子（建角第 1 步；成人內容） */
  privates?: { look: string; note: string }
  attrs: Array<{ name: string; base: number; eff: number; src?: string }>
}

export interface PartyMember { id: string; name: string; role: string; sink: number; hp: [number, number]; load: [number, number]; afterglow: number; me?: boolean; hpBlur?: boolean }

export interface Npc {
  id: string
  name: string
  district: string
  age: number
  identity: string
  tags: string[]
  relation: string
  affinity: number
  stage: string
  loyalty: number
  lineStage: number
  known: Array<{ k: string; v: string; unknown?: boolean }>
  memories: Array<{ when: string; text: string; weight: number }>
  mood: string
  /** 關係頁的分類（UI 3.9 節）：夥伴、名冊（生成的行者與契約人）、中間人、熟人 */
  group?: '夥伴' | '名冊' | '中間人' | '熟人'
  faction?: string
  /** 人情：正的是他欠你，負的是你欠他 */
  favor?: number
  watch?: boolean
  want?: string
  lastJob?: string
}

// ---- 地方 ----
export type DistrictId = 'hive' | 'ave42' | 'sakura' | 'crown' | 'oldport' | 'glass' | 'rust' | 'under'

export interface District { id: DistrictId; name: string; price: number; security: string; style: string; x: number; y: number; blocks: string[] }

export type FacilityKind = 'shop' | 'home' | 'clinic' | 'talk' | 'dungeon' | 'transit' | 'service'

export interface Facility {
  id: string
  name: string
  icon: string
  kind: FacilityKind
  shopId?: string
  npcIds?: string[]
  services?: Array<{ name: string; price?: number; action?: 'shop' | 'home' | 'dungeon' | 'talk' | 'rest' | 'transit' | 'garage' | 'mech' | 'clinic' | 'fixer' | 'cut' | 'dye' | 'none'; props?: Record<string, unknown> }>
}

export interface Shop {
  id: string
  name: string
  type: string
  district: DistrictId
  keeper: string
  keeperAffinity: number
  backer: string
  temper: string
  /** 店家倍率（TRADE 3.2 節） */
  shopMult: number
  acceptsAccount: boolean
  acceptsCash: boolean
  scansRegistered: boolean
  /** 這一區的類別行情（TRADE 4.2 節），例：{ 武器: -0.2 } */
  trend: Partial<Record<TradeCategory, number>>
  stock: Array<{ def: string; qty: number; special?: boolean; condition?: Condition }>
  discount: number
}

// ---- 格子 ----
export interface Point { x: number; y: number }
