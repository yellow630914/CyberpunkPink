/**
 * 世界編輯器的欄位表（docs/systems/DATA.md 的格式）：第三版把「區與街區、勢力、城市的大事、子網、蕾絲、設計圖、藥、服裝、飾品、
 * 成人道具、SKIN、技能、特質、輿論戰的對手、委託模板、委託副本、指南」接上通用的表單。每一種寫出欄位、型別、必填與說明；
 * 表單照這張表畫，檢查（lib/worldCheck.ts）照這張表擋必填、整數、範圍與選項。欄位名沿用 DATA.md 的 JSON。
 */
export type FieldType = 'text' | 'longtext' | 'int' | 'num' | 'enum' | 'bool' | 'list' | 'json'
export interface FieldDef { k: string; name: string; type: FieldType; req?: boolean; options?: string[]; min?: number; max?: number; hint?: string; def?: unknown }
export interface KindSchema { kind: string; name: string; source: string; fields: FieldDef[] }

const ID: FieldDef = { k: 'id', name: 'id', type: 'text', req: true, hint: '英文小寫與底線；整個世界唯一。' }
const NAME: FieldDef = { k: 'name', name: '名字', type: 'text', req: true }
const GRADE: FieldDef = { k: 'grade', name: '等級', type: 'int', req: true, min: 1, max: 5, hint: 'I～V 級寫成 1～5。', def: 1 }
const PRICE: FieldDef = { k: 'price', name: '價格', type: 'int', min: 0, def: 0 }
const LEGAL: FieldDef = { k: 'legal', name: '合法性', type: 'enum', options: ['free', 'register', 'permit', 'banned'], def: 'free', hint: '自由、登記、許可、違禁（ITEMS 1.4 節）。' }
const BRAND: FieldDef = { k: 'brand', name: '牌子', type: 'text', hint: '牌子的 id（ITEMS 1.2 節）。' }
const ADULT: FieldDef = { k: 'adult', name: '成人內容', type: 'bool', def: false, hint: '受內容篩選控制。' }
const TAGS: FieldDef = { k: 'tags', name: '標籤', type: 'list', def: [] }
const TEXT: FieldDef = { k: 'text', name: '說明', type: 'longtext' }

export const SCHEMAS: Record<string, KindSchema> = {
  block: { kind: 'block', name: '街區', source: 'DISTRICTS 1.3 節', fields: [ID, NAME, { k: 'district', name: '區', type: 'enum', req: true, options: ['hive', 'ave42', 'sakura', 'crown', 'oldport', 'glass', 'rust', 'under'], def: 'hive' }, { k: 'rows', name: '版面（13 × 9）', type: 'list', hint: '每一列一行，用逗號分開；# 建築、. 街道、F 設施、> 出口。', def: [] }, { k: 'facilities', name: '設施', type: 'list', def: [] }, { k: 'exits', name: '出口通往', type: 'list', def: [] }] },
  faction: { kind: 'faction', name: '勢力', source: 'FACTIONS', fields: [ID, NAME, { k: 'type', name: '種類', type: 'enum', options: ['corp', 'gang', 'public', 'community', 'none'], def: 'gang' }, { k: 'turf', name: '地盤', type: 'list', def: [] }, { k: 'pr', name: '輿論戰的對手', type: 'text', hint: '輿論戰對手的 id（pr_…）。' }, { k: 'hostility_start', name: '起始敵對值', type: 'int', min: 0, max: 100, def: 0 }, TEXT] },
  citynews: { kind: 'citynews', name: '城市的大事', source: 'EVENTS 第 8 節', fields: [ID, NAME, { k: 'when', name: '條件', type: 'text', req: true, hint: '計數器條件，例：wall >= 2。' }, { k: 'effect', name: '效果', type: 'json', def: {} }, TEXT] },
  subnet: { kind: 'subnet', name: '子網', source: 'DATA 第 10 節', fields: [ID, NAME, GRADE, { k: 'theme', name: '主題', type: 'text' }, { k: 'layers', name: '層', type: 'list', req: true, def: ['staff', 'core'] }, { k: 'affixes', name: '詞條', type: 'list', def: [] }, { k: 'objective', name: '目標', type: 'json', def: { kind: 'download', layer: 'core', turns: 3 } }, { k: 'faction', name: '勢力', type: 'text' }] },
  lace: { kind: 'lace', name: '蕾絲', source: 'DATA 6.2 節', fields: [ID, NAME, GRADE, { k: 'rank', name: '位階', type: 'enum', req: true, options: ['mook', 'elite', 'boss'], def: 'mook' }, { k: 'color', name: '顏色', type: 'enum', options: ['white', 'pink', 'black'], def: 'pink' }, { k: 'load_max', name: '感載上限', type: 'int', req: true, min: 1, def: 22 }, { k: 'layers', name: '承受層數', type: 'int', min: 0, max: 6, def: 1 }, { k: 'ap', name: '行動點', type: 'int', min: 0, max: 8, def: 4 }, { k: 'ram', name: 'RAM', type: 'int', min: 0, max: 12, def: 4 }, { k: 'defeat', name: '戰敗事件', type: 'text', def: 'pinned' }, { k: 'constructs', name: '構裝', type: 'json', def: [] }, ADULT] },
  bp: { kind: 'bp', name: '設計圖', source: 'DATA 7.1 節', fields: [ID, NAME, { k: 'kind2', name: '成品', type: 'enum', req: true, options: ['weapon', 'armor', 'cyberware', 'clothing', 'accessory'], def: 'weapon', hint: 'DATA 的 kind（成品的種類）；這裡的 kind 是內容的種類，所以改叫 kind2，匯出時換回來。' }, BRAND, GRADE, LEGAL, PRICE, { k: 'require', name: '必要的零件', type: 'list', def: [] }, { k: 'optional', name: '選配的零件', type: 'list', def: [] }] },
  drug: { kind: 'drug', name: '藥', source: 'ITEMS 第 9 節', fields: [ID, NAME, GRADE, LEGAL, PRICE, { k: 'effect', name: '效果', type: 'longtext', req: true }, { k: 'sink', name: '沉溺', type: 'int', min: 0, max: 10, def: 0 }, { k: 'addictive', name: '會成癮', type: 'bool', def: false }] },
  cloth: { kind: 'cloth', name: '服裝', source: 'EQUIPMENT 第 2 節', fields: [ID, NAME, { k: 'slot', name: '欄位', type: 'enum', req: true, options: ['head', 'face', 'coat', 'armor', 'top', 'bottom', 'hands', 'shoes', 'bra', 'panties'], def: 'top' }, GRADE, PRICE, { k: 'style', name: '風格', type: 'text' }, { k: 'exposure', name: '曝露度', type: 'int', min: 0, max: 5, def: 0 }, ADULT] },
  acc: { kind: 'acc', name: '飾品', source: 'EQUIPMENT 第 3 節', fields: [ID, NAME, { k: 'slot', name: '欄位', type: 'enum', req: true, options: ['neck', 'leg', 'any'], def: 'any' }, GRADE, PRICE, { k: 'effect', name: '效果', type: 'longtext' }] },
  adult: { kind: 'adult', name: '成人道具', source: 'DATA 3.3 節', fields: [ID, NAME, GRADE, PRICE, { k: 'adult', name: '成人內容', type: 'bool', def: true }, TAGS, { k: 'scene', name: '場景裡的用法', type: 'json', req: true, def: { ap: 1, as_part: 'toy', their_part: [], on_use: {} } }] },
  skin: { kind: 'skin', name: 'SKIN', source: 'DATA 7.4 節', fields: [ID, NAME, BRAND, { k: 'style', name: '風格', type: 'text', req: true }, { k: 'style_value', name: '風格值', type: 'int', min: 0, max: 5, def: 1 }, { k: 'exposure', name: '曝露度', type: 'int', min: 0, max: 5, def: 0 }, { k: 'cut', name: '版型', type: 'enum', options: ['female', 'male', 'any'], def: 'any' }, ADULT, PRICE] },
  tree: { kind: 'tree', name: '技能', source: 'DATA 第 2 節', fields: [ID, NAME, { k: 'path', name: '路數', type: 'enum', req: true, options: ['gunner', 'pilot', 'modder', 'netrunner', 'socialite', 'fixer', 'streamer', 'idol'], def: 'gunner' }, { k: 'tier', name: '階', type: 'int', req: true, min: 1, max: 5, def: 1 }, { k: 'kind2', name: '種類', type: 'enum', options: ['active', 'passive', 'stance'], def: 'active', hint: 'DATA 的 kind（主動、被動、姿態）；這裡改叫 kind2。' }, { k: 'xp', name: '歷練', type: 'int', min: 0, def: 40 }, { k: 'cells', name: '橋的格數', type: 'int', min: 0, max: 6, def: 1 }, { k: 'after', name: '前置', type: 'text' }, { k: 'use', name: '花費', type: 'json', def: { ap: 1 } }, TEXT] },
  trait: { kind: 'trait', name: '特質', source: 'CHARACTER 第 5 節', fields: [ID, NAME, { k: 'good', name: '正面', type: 'bool', def: true }, { k: 'cost', name: '點數', type: 'int', min: -4, max: 4, def: 1 }, { k: 'effect', name: '效果', type: 'json', def: {} }, TEXT] },
  opponent: { kind: 'opponent', name: '輿論戰的對手', source: 'DATA 6.3 節', fields: [ID, NAME, { k: 'faction', name: '勢力', type: 'text' }, { k: 'strength', name: '強度', type: 'int', req: true, min: 1, max: 3, def: 2, hint: '每回合的公關點 = 強度 × 2。' }, { k: 'start', name: '開場', type: 'enum', options: ['opposite', 'center', 'street'], def: 'opposite' }, { k: 'mimic', name: '模擬抽牌（mimic）', type: 'bool', def: false }, { k: 'actions', name: '行動表', type: 'json', def: [] }, { k: 'signature', name: '招牌招式', type: 'json', def: {} }] },
  tmpl: { kind: 'tmpl', name: '委託模板', source: 'COMMISSION_TEMPLATES', fields: [ID, NAME, { k: 'type', name: '類型', type: 'text', req: true }, { k: 'main', name: '主面', type: 'enum', req: true, options: ['meat', 'net', 'opinion'], def: 'meat' }, { k: 'stages', name: '階段', type: 'json', req: true, def: [] }, { k: 'conditions', name: '附帶條件', type: 'list', def: [] }, { k: 'reward_coef', name: '報酬的類型係數', type: 'num', min: 0.5, max: 2, def: 1 }] },
  run: { kind: 'run', name: '委託副本', source: 'COMMISSIONS 第 11 節', fields: [ID, NAME, { k: 'template', name: '模板', type: 'text', req: true }, GRADE, { k: 'size', name: '規模', type: 'enum', options: ['small', 'medium', 'large'], def: 'medium' }, { k: 'reward', name: '報酬', type: 'int', min: 0, def: 0 }, { k: 'fixer', name: '中間人', type: 'text' }, { k: 'opinion_setup', name: '輿論戰的開場表', type: 'json', def: null }] },
  guide: { kind: 'guide', name: '指南', source: 'GUIDES', fields: [ID, { k: 'title', name: '標題', type: 'text', req: true }, { k: 'trigger', name: '什麼時候跳出來', type: 'text', req: true }, { k: 'pages', name: '頁', type: 'list', req: true, def: [], hint: '一頁一句，用逗號分開。' }] },
}

/** 新的一筆：必填與有預設值的欄位先填好 */
export function blankEntry(kind: string, id: string): Record<string, unknown> {
  const sc = SCHEMAS[kind]
  const out: Record<string, unknown> = { id, kind, name: '新的一筆' }
  for (const f of sc?.fields ?? []) if (!(f.k in out) && f.def !== undefined) out[f.k] = structuredClone(f.def)
  if (kind === 'guide') out.title = '新的指南'
  return out
}

/** 一個欄位的值合不合格式（型別、範圍、選項）。回傳錯誤的說明，合格回傳 null */
export function fieldError(f: FieldDef, v: unknown): string | null {
  const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length && f.req)
  if (empty) return f.req ? `少了必填的欄位 ${f.k}` : null
  switch (f.type) {
    case 'int': case 'num':
      if (typeof v !== 'number' || Number.isNaN(v)) return `${f.k} 要是數字`
      if (f.type === 'int' && !Number.isInteger(v)) return `${f.k} 要是整數`
      if (f.min !== undefined && v < f.min) return `${f.k} 不能小於 ${f.min}`
      if (f.max !== undefined && v > f.max) return `${f.k} 不能大於 ${f.max}`
      return null
    case 'enum': return f.options && !f.options.includes(String(v)) ? `${f.k} 要是 ${f.options.join('、')} 其中一個` : null
    case 'bool': return typeof v === 'boolean' ? null : `${f.k} 要是是或否`
    case 'list': return Array.isArray(v) ? null : `${f.k} 要是清單`
    default: return null
  }
}

/** 每一種新內容的樣本（基本世界裡的那幾筆，標成內建） */
export const SCHEMA_SAMPLES: Array<Record<string, unknown>> = [
  { id: 'blk_lantern', kind: 'block', name: '燈籠巷', district: 'ave42', rows: [], facilities: ['燈籠攤', '算命的'], exits: ['刀巷', '中城段・北'], builtin: true },
  { id: 'fc_nora', kind: 'faction', name: '野良', type: 'community', turf: ['hive', 'under'], pr: 'pr_nora', hostility_start: 30, text: '屋頂村與地下層的自治社群。', builtin: true },
  { id: 'cn_blackout', kind: 'citynews', name: '鏽帶大停電', when: 'grid <= -2', effect: { district: 'rust', state: 'blackout', days: 3 }, text: '鏽帶的變電所被人炸了，三天沒電。', builtin: true },
  { id: 'nm_bluewhale', kind: 'subnet', name: '藍鯨物流', grade: 2, theme: 'logistics', layers: ['staff', 'core'], affixes: ['剛被翻過'], objective: { kind: 'download', layer: 'core', turns: 3 }, faction: 'bluewhale', builtin: true },
  { id: 'en_lace_pink_maid_g1', kind: 'lace', name: '粉蕾絲（女僕型）', grade: 1, rank: 'mook', color: 'pink', load_max: 22, layers: 1, ap: 4, ram: 4, defeat: 'pinned', constructs: [{ id: 'stream', dice: '3d6', type: 'neural', range: [2, 5], ram: 1 }], adult: false, builtin: true },
  { id: 'bp_rifle_starbelle_3', kind: 'bp', name: '星旗 M3 步槍', kind2: 'weapon', brand: 'starbelle', grade: 3, legal: 'permit', price: 2400, require: ['barrel', 'action', 'plate'], optional: ['sensor', 'actuator', 'chip', 'software'], builtin: true },
  { id: 'dg_honey_inhib', kind: 'drug', name: '蜜腺的抑制劑', grade: 2, legal: 'register', price: 300, effect: '每週服用，沉溺的下限暫時 −10；停藥一週後 +15，持續兩週。', sink: 0, addictive: true, builtin: true },
  { id: 'cl_raincoat_neon', kind: 'cloth', name: '霓虹雨衣', slot: 'coat', grade: 1, price: 120, style: '霓虹龐克', exposure: 0, adult: false, builtin: true },
  { id: 'ac_bell_choker', kind: 'acc', name: '鈴鐺頸圈', slot: 'neck', grade: 1, price: 60, effect: '走路會響。', builtin: true },
  { id: 'it_toy_pulse_2', kind: 'adult', name: '脈衝環', grade: 2, price: 600, adult: true, tags: [], scene: { ap: 1, as_part: 'toy', their_part: ['front', 'chest'], on_use: { their_load: '1d6', fit: 2 } }, builtin: true },
  { id: 'skin_maid_homeec', kind: 'skin', name: '家政課女僕服（網內版）', brand: 'hizakura', style: 'maid', style_value: 3, exposure: 0, cut: 'female', adult: false, price: 900, builtin: true },
  { id: 'sk_fixer_focus_fire', kind: 'tree', name: '集火', path: 'fixer', tier: 2, kind2: 'active', xp: 40, cells: 2, after: 'sk_fixer_face', use: { ap: 1 }, text: '指定一個敵人。到你的下一個回合開始前，全隊打他 +2。', builtin: true },
  { id: 'trait_smooth_talker', kind: 'trait', name: '嘴甜', good: true, cost: 1, effect: { negotiate: 1 }, text: '交涉的檢定 +1。', builtin: true },
  { id: 'pr_jess', kind: 'opponent', name: '第一手的潔絲', faction: 'none', strength: 3, start: 'opposite', mimic: true, actions: [{ do: 'counter', when: 'you_captured' }, { do: 'deny', when: 'wind >= 2' }, { do: 'capture', when: 'not_own(kaleido)' }, { do: 'release', when: 'always' }], signature: { id: 'front_page', text: '第一回合她的第一個行動一定是搶萬華鏡那一格。' }, builtin: true },
  { id: 'ct_type_steal_data', kind: 'tmpl', name: '竊密（資料）', type: '竊密', main: 'net', stages: [{ name: '拿到入口', faces: ['meat', 'net'] }, { name: '往下一層', faces: ['net'] }, { name: '下載', faces: ['net'], key: true }], conditions: ['no_trace', 'no_kill'], reward_coef: 1, builtin: true },
  { id: 'cm_0412', kind: 'run', name: '藍鯨物流的帳本', template: 'ct_type_steal_data', grade: 2, size: 'medium', reward: 6800, fixer: 'npc_monroe', opinion_setup: null, builtin: true },
  { id: 'g_commission', kind: 'guide', name: '委託', title: '委託副本：階段、面與分支', trigger: '第一次進委託副本', pages: ['一個副本有三到五個階段。', '每個階段寫明可以選哪些面，你選一個自己玩，其餘的面可以派人去當輔助。'], builtin: true },
]
