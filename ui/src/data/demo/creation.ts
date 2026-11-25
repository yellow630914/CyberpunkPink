import type { ContentEntry, ContentPack } from '@engine/src'

/**
 * 示意世界包的「建角」部分（M4-ui-creation；CHARACTER 第 2、3、5 節；dev/adr/0019 第十一節）：
 * 生命軌跡八張表的條目與傾向標籤（每張表三四條，含一條被內容篩選擋住的、一條出身限定的）、出身白給的東西（kit_free）、
 * 星旗與夜鶯兩家企業才買得到的橋與便宜的二手橋、日常服裝與幾件起始裝備、第 6 與第 9 步的清單（買得到什麼）、
 * 外觀要用的牌子與風格（外露的義體、獸耳、穿著推出來的外觀由介面組字，見 lib/creation.ts 的 derivedLooks）。
 * 整份是資料：沒有任何規則（點數、命中、價格、能不能選全是引擎的）。正式內容匯入之後整包換掉。不放進 engine/data。測試不用它。
 * 義體、零件、橋沿用 body.ts 與 craft.ts 的；這裡只補橋與衣服。
 */
type Rec = Record<string, unknown>

// ---- 傾向標籤：id 就是內容篩選的題材（rulesFromUi 的 contentOff），所以關掉題材時對應的條目整條消失 ----
export const TENDENCY_TAGS: Rec[] = [
  { id: 'pamper', name: '溺愛', axis: 'relation' },
  { id: 'voice', name: '聲音', axis: 'sense' },
  { id: 'restraint', name: '束縛', axis: 'relation' },
  { id: 'public', name: '暴露', axis: 'body' },
  { id: 'doll_chip', name: '人偶', axis: 'costume' },
]

// ---- 生命軌跡 ----
const entry = (table: string, id: string, text: string, over: Rec = {}): Rec => ({ id, table, text, result: {}, ...over })
const npc = (role: string, o: Rec = {}): Rec => ({ npc: { role, ...o } })

/** 出身的說法：只換文字，不換結果（CHARACTER 第 2、3 節） */
const family = (o: Record<string, string>): Rec => o

export const LIFEPATH: Rec[] = [
  // 家人
  entry('family', 'fam_tower', '還在，住在同一棟塔', {
    texts: family({ nomad: '還在車隊上跑', pleasure: '在店裡一起長大的姊妹', oldport: '在碼頭上討生活', corp: '還住在社宅裡', sakura: '在後台一起長大', under: '住在同一排鋪位' }),
    result: npc('family', { faction_from: 'origin', affinity: 20 }),
  }),
  entry('family', 'fam_lost', '失散了', { result: { goal: 'find_family' } }),
  entry('family', 'fam_gone', '過世了'),
  entry('family', 'fam_faction', '是某個勢力的人', { result: npc('family', { faction_from: 'origin', affinity: 5 }) }),
  // 那件事
  entry('incident', 'inc_debt', '欠了一筆債', { result: { effects: [{ kind: 'debt', to: 'lonestar', amount: 2000, rate: 0.05 }] } }),
  entry('incident', 'inc_bridge', '橋出過事', { result: { effects: [{ kind: 'sink_floor', amount: 5 }] } }),
  entry('incident', 'inc_dock', '碼頭上替人扛過一票貨，分到一筆錢', { origins: ['oldport'], result: { effects: [{ kind: 'cash', amount: 300 }] } }),
  entry('incident', 'inc_contract', '簽過一張不該簽的契約', { tags: ['contract'], result: { effects: [{ kind: 'debt', to: 'lonestar', amount: 1500, rate: 0.03 }] } }),
  // 朋友（最多一位）
  entry('friend', 'fr_grew', '一起長大的', { result: npc('friend', { faction_from: 'origin', affinity: 30, roster: true }) }),
  entry('friend', 'fr_saved', '救過你的', { result: npc('friend', { affinity: 40 }) }),
  entry('friend', 'fr_none', '沒什麼朋友'),
  // 仇人（最多一位）
  entry('enemy', 'en_hurt', '被你害過的', { result: npc('enemy', { affinity: -30, hostility: 10 }) }),
  entry('enemy', 'en_hurtyou', '害過你的', { result: npc('enemy', { faction_from: 'lonestar', affinity: -20, hostility: 15 }) }),
  entry('enemy', 'en_rival', '搶同一個位置的', { result: npc('enemy', { faction_from: 'rose', affinity: -10, hostility: 10 }) }),
  // 舊情
  entry('ex', 'ex_split', '分了', { result: npc('ex', { affinity: 10 }) }),
  entry('ex', 'ex_apart', '被拆散', { result: { ...npc('ex', { affinity: 25 }), goal: 'find_ex' } }),
  entry('ex', 'ex_contact', '還有聯絡', { result: npc('ex', { affinity: 40 }) }),
  entry('ex', 'ex_vanish', '對方不見了', { result: { goal: 'find_ex' } }),
  // 想要的
  entry('want', 'want_money', '錢', { result: { goal: 'get_rich' } }),
  entry('want', 'want_fame', '名', { result: { goal: 'get_known' } }),
  entry('want', 'want_leave', '離開這座城', { result: { goal: 'leave_city' } }),
  entry('want', 'want_truth', '真相', { result: { goal: 'find_truth' } }),
  // 性經歷（成人題材；所有相關的人都是成年人）
  entry('sex', 'sex_none', '沒有', { result: { sex_record: { times: 0, partners: 0, service_times: 0 } } }),
  entry('sex', 'sex_few', '很少', { result: { sex_record: { times: 3, partners: 1, service_times: 0 } } }),
  entry('sex', 'sex_normal', '普通', { result: { sex_record: { times: 12, partners: 4, service_times: 0 }, bridge: { tolerance: 5 } } }),
  entry('sex', 'sex_rich', '豐富，在歡場工作過', { tags: ['public'], result: { sex_record: { times: 40, partners: 14, service_times: 20 }, bridge: { craving: 5 }, axis: { costume: 1 } } }),
  // 潛在性癖：結果裡的傾向標籤被內容篩選關掉的整條不出現
  entry('kink', 'kink_pamper', '溺愛', { result: { tendency: [{ tag: 'pamper', state: 'latent' }] } }),
  entry('kink', 'kink_voice', '聲音', { result: { tendency: [{ tag: 'voice', state: 'latent' }] } }),
  entry('kink', 'kink_restraint', '束縛', { result: { tendency: [{ tag: 'restraint', state: 'latent' }] } }),
  entry('kink', 'kink_public', '暴露', { result: { tendency: [{ tag: 'public', state: 'latent' }] } }),
  entry('kink', 'kink_doll', '人偶', { result: { tendency: [{ tag: 'doll_chip', state: 'latent' }] } }),
]

// ---- 衣服、彈藥、橋與零件 ----
const wear = (id: string, name: string, desc: string, o: Rec = {}): Rec => ({ id, name, desc, category: 'clothing', grade: 1, size: 1, legal: 'free', price: 0, ...o })
/** 每個出身白給的那一套日常服裝（CHARACTER 5.4 節）；風格在 GEAR_STYLE */
export const DAILY_WEAR: Record<string, string> = {
  hive: 'it_wear_hive', corp: 'it_wear_corp', nomad: 'it_wear_nomad', pleasure: 'it_wear_pleasure', oldport: 'it_wear_oldport', sakura: 'it_wear_sakura', under: 'it_wear_under',
}
const ITEMS: Rec[] = [
  wear('it_wear_hive', '蜂巢的工裝', '洗得發白的連身工裝，膝蓋與手肘都補過。'),
  wear('it_wear_corp', '社宅的制服', '剪裁合身的深色套裝，還留著前一份工作的胸牌孔。'),
  wear('it_wear_nomad', '車隊的皮外套', '被沙塵磨出光澤的皮外套，內裡縫了防水布。'),
  wear('it_wear_pleasure', '番街的店服', '亮面的短外套，在霓虹底下很好看。'),
  wear('it_wear_oldport', '碼頭的雨衣', '防水、深色、有很多口袋，看起來像每個搬貨的人。'),
  wear('it_wear_sakura', '劇場的後台服', '繡著小徽章的黑色工作服，口袋裡總有幾枚別針。'),
  wear('it_wear_under', '下層的連帽衫', '寬鬆的連帽衫，帽子拉下來遮得住半張臉。'),
  wear('it_jacket_street', '街頭外套', '耐磨的短外套，肩上有一道醒目的反光條。', { price: 250 }),
  wear('it_coat_corp', '企業風衣', '長版的灰色風衣，看起來像剛從高樓裡走出來。', { grade: 2, price: 700 }),
  { id: 'it_ammo_std', name: '普通彈藥', desc: '一個彈匣的普通彈藥，手槍與衝鋒槍通用。', category: 'ammo', grade: 1, size: 0, legal: 'register', price: 40 },
]

const part = (id: string, name: string, type: string, o: Rec = {}): Rec => ({
  id, name, type, material: 'mech', brand: '織女', grade: 2, price: 300, legal: 'free', cells: 1, stats: {}, weight: 0.5, size: 1, state: 'new', ...o,
})
const PARTS: Rec[] = [
  part('pt_chip_used', '晶片「蜂巢 36」（二手）', 'chip', { grade: 1, price: 350, bridge: { capacity: 36 } }),
  part('pt_sw_field', '橋軟體「野戰」', 'software', { price: 380, brand: '星旗', bridge: { split: { meat: 3, net: 1, social: 1, media: 1 } } }),
  part('pt_sw_deep', '橋軟體「深水」', 'software', { price: 400, brand: '夜鶯', bridge: { split: { meat: 1, net: 3, social: 1, media: 1 } } }),
]
const bridge = (id: string, name: string, o: Rec): Rec => ({
  id, kind: 'cyberware', name, desc: `${name}：示意用的橋。`, brand: '織女', grade: 2, legal: 'free', price: 1200, optional: [], slot: 'bridge', invasiveness: 'invasive', sink_cost: 4,
  bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }, { type: 'software' }], ...o,
})
const BLUEPRINTS: Rec[] = [
  bridge('bp_bridge_used', '拼裝橋 I（二手）', {
    desc: '便宜、到處能修：四類容量平均分配，容量小一點。', grade: 1, price: 500, sink_cost: 5, creation_points: 2, stock: { chip: 'pt_chip_used', software: 'pt_sw_even' },
  }),
  bridge('bp_bridge_field', '星旗 野戰橋 II', {
    desc: '星旗的野戰橋：現實的容量是別類的三倍。企業出身、而且是星旗才買得到。', brand: '星旗', price: 1400, available: { origins: ['corp'], faction: 'starbelle' },
    stock: { chip: 'pt_chip_hive', software: 'pt_sw_field' },
  }),
  bridge('bp_bridge_deep', '夜鶯 深水橋 II', {
    desc: '夜鶯的深水橋：內海的容量是別類的三倍。企業出身、而且是夜鶯才買得到。', brand: '夜鶯', price: 1400, available: { origins: ['corp'], faction: 'nightingale' },
    stock: { chip: 'pt_chip_hive', software: 'pt_sw_deep' },
  }),
]

export function creationContent(): Record<string, ContentEntry[]> {
  return { lifepath_entry: LIFEPATH, tendency_tag: TENDENCY_TAGS, item: ITEMS, part: PARTS, blueprint: BLUEPRINTS } as unknown as Record<string, ContentEntry[]>
}

// ---- 出身白給的（kit_free）：核心包的出身沒有這一欄，示意包在載入前補上 ----
const KIT_BASE = [{ id: 'it_d2d2de' }, { id: 'it_ammo_std', qty: 2 }]
export const KIT_FREE: Record<string, Array<{ id: string; qty?: number }>> = Object.fromEntries(
  Object.entries(DAILY_WEAR).map(([origin, wearId]) => [origin, [{ id: wearId }, ...KIT_BASE]]),
)

/** 核心包加上示意包要的幾個出身欄位（kit_free）。origin 不是可以被後載入的包蓋掉的內容種類，所以在載入前改。 */
export function withDemoOrigins(pack: ContentPack): ContentPack {
  const origins = (pack.content as Record<string, Rec[] | undefined>).origin
  if (!origins) return pack
  return { ...pack, content: { ...pack.content, origin: origins.map((o) => ({ ...o, kit_free: KIT_FREE[o.id as string] ?? [] })) } } as unknown as ContentPack
}

// ---- 第 6、9 步的清單（買得到什麼；能不能選與點數是引擎的） ----

/** 第 6 步的橋，照畫面上的順序 */
export const BRIDGE_LIST = ['bp_bridge_used', 'bp_bridge_hive', 'bp_bridge_net', 'bp_bridge_field', 'bp_bridge_deep']
/** 第 6 步的其他義體 */
export const CYBER_LIST = ['bp_eye', 'bp_ears', 'bp_tattoo', 'bp_pump', 'bp_plating', 'bp_pain', 'bp_arm', 'bp_accel']
/** 第 9 步的清單 */
export const GEAR_LIST: Array<{ cat: string; ids: string[] }> = [
  { cat: '武器', ids: ['it_f0db7d', 'it_e60505', 'it_6fa4e8', 'bp_pistol'] },
  { cat: '護甲與服裝', ids: ['it_jacket_street', 'it_coat_corp', 'it_7d6ad2', 'bp_vest'] },
  { cat: '工具與消耗品', ids: ['it_1ace6d', 'it_5e3de4', 'it_9da44a', 'it_3b3851', 'it_57e531', 'it_ammo_std'] },
  { cat: '甲板、構裝與 SKIN', ids: ['dk_nightingale_2', 'cs_window1', 'cs_blade2', 'cs_probe2', 'it_d212f6'] },
]
/** 出身的建議組合（超過點數的由引擎擋，畫面拿掉最後一件再問一次） */
export const SUGGESTED_KITS: Record<string, string[]> = {
  hive: ['it_f0db7d', 'it_jacket_street', 'it_1ace6d', 'it_9da44a'],
  corp: ['it_f0db7d', 'it_coat_corp', 'cs_window1'],
  nomad: ['it_e60505', 'it_jacket_street', 'it_1ace6d'],
  pleasure: ['it_f0db7d', 'it_jacket_street', 'it_9da44a'],
  oldport: ['it_f0db7d', 'it_jacket_street', 'it_3b3851', 'it_1ace6d'],
  sakura: ['it_jacket_street', 'it_d212f6', 'cs_window1'],
  under: ['it_f0db7d', 'it_jacket_street', 'cs_probe2', 'it_5e3de4'],
}

// ---- 外觀要用的（外露的義體與獸耳寫進外觀；風格由穿著推出來） ----
export interface CyberLook { at: string; line?: string; beast?: { school: 'mech' | 'bio'; part: 'ears' | 'tail' } }
/** 設計圖 id → 看得見的部位（外露的義體）與獸化零件（NPC_SYSTEM 13.11 節的模板） */
export const CYBER_LOOK: Record<string, CyberLook> = {
  bp_bridge_used: { at: '後頸' }, bp_bridge_hive: { at: '後頸' }, bp_bridge_net: { at: '後頸' }, bp_bridge_field: { at: '後頸' }, bp_bridge_deep: { at: '後頸' },
  bp_eye: { at: '左眼' },
  bp_arm: { at: '左臂' },
  bp_plating: { at: '腰側', line: '皮膚底下摸得到一片一片的硬板，彎腰時看得到接縫' },
  bp_ears: { at: '頭側', beast: { school: 'bio', part: 'ears' } },
}
/** 物品 id → 風格標籤（穿著推出風格；格式同舊資料的 stats「風格」） */
export const GEAR_STYLE: Record<string, string> = {
  it_wear_hive: '工裝', it_wear_corp: '企業', it_wear_nomad: '荒地', it_wear_pleasure: '歡場', it_wear_oldport: '特攻', it_wear_sakura: '櫻町系', it_wear_under: '工裝',
  it_jacket_street: '街頭 +1', it_coat_corp: '企業 +1', it_7d6ad2: '特攻 +1', bp_vest: '街頭 +1', it_d212f6: '偶像 +2',
}
