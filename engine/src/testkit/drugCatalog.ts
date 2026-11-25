// 測試基礎建設：ITEMS 4.2 節藥的目錄（示意資料；M4-followups-2 第 7 項）。
// 把「現在的藥格式（物品的 drug 欄位）寫得出來」的藥效逐項寫成資料；寫不出來的另列在 DRUG_GAPS（連同原因），留給內容階段與之後的功能。
// 示意資料只給測試與冒煙用：正式內容等潤色後經世界編輯器匯入（docs/plan/PLAN.md 第 1 節），不接進 engine/data 的 CORE_PACK。
// 份量照 4.2 節折成整數格（物品的 size 是 0～4 的整數：1.5 進位成 2）；價錢照表。
// 效果 id 約定：感知類 ＝ 調查、街頭直覺兩項基本功加標籤 perception（features/sink 的 PERCEPTION_SKILLS）；「所有檢定」＝六個屬性的 check.attrs。

import type { ContentEntry } from '../core'

type Rec = Record<string, unknown>

const ATTRS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm']
const skill = (skills: string[], amount: number): Rec => ({ check: { skills }, amount })
const perception = (amount: number): Rec => ({ check: { skills: ['investigate', 'streetwise'], tags: ['perception'] }, amount })
const everyCheck = (amount: number): Rec => ({ check: { attrs: ATTRS }, amount })
const mod = (kind: string, amount: number, layer?: 'meat' | 'net'): Rec => ({ mod: kind, amount, ...(layer ? { layer } : {}) })
const stat = (id: string, amount: number): Rec => ({ stat: id, amount })

const LEGAL = { free: 'free', register: 'register', permit: 'permit', banned: 'banned' } as const
const USE = { ap: 1, target: 'self', effects: [{ op: 'drug' }] }

function drug(id: string, name: string, o: { brand: string; grade: number; size: number; legal: keyof typeof LEGAL; price: number; drug: Rec; tags?: string[] }): ContentEntry & Rec {
  return {
    id, name, desc: `${name}：${o.brand}的藥（ITEMS 4.2 節）。`, category: 'drug', grade: o.grade, size: o.size, legal: LEGAL[o.legal], price: o.price,
    ...(o.tags ? { tags: o.tags } : {}), drug: o.drug, use: USE,
  }
}

const withdrawal = (per_dose: number, days: number, effects: Rec[]): Rec => ({ per_dose, withdrawal: { days, effects } })

/** ITEMS 4.2 節的藥：寫得出來的部分。 */
export const ITEMS_42_DRUGS: Array<ContentEntry & Rec> = [
  // 止痛劑（棉花）：重傷的檢定 −2 不算（單位標籤 ignore_wound_penalty，戰鬥外的重傷檢定與戰鬥裡的同一條）
  drug('drug_cotton', '止痛劑（棉花）', {
    brand: '蜜腺', grade: 1, size: 1, legal: 'free', price: 30,
    drug: { duration: { battle: true, minutes: 240 }, effects: [{ unit_tag: 'ignore_wound_penalty' }], addiction: withdrawal(6, 5, [stat('max_hp', -5)]) },
  }),
  // 強效止痛劑（大棉花）：重傷不算、生命上限 +5；成癮的懲罰：生命上限 −5、定力 −1
  drug('drug_cotton_xl', '強效止痛劑（大棉花）', {
    brand: '蜜腺', grade: 3, size: 2, legal: 'permit', price: 320,
    drug: { duration: { battle: true, minutes: 240 }, effects: [{ unit_tag: 'ignore_wound_penalty' }, stat('max_hp', 5)], addiction: withdrawal(12, 5, [stat('max_hp', -5), skill(['composure'], -1)]) },
  }),
  // 鎮靜劑（靜）：定力 +2、感載每回合自然消退 +1（現實與內海各寫一筆）；先攻 −3、表演與誘惑 −2；鎮靜（戒斷的懲罰減半）
  drug('drug_calm', '鎮靜劑（靜）', {
    brand: '蜜腺', grade: 1, size: 2, legal: 'free', price: 30,
    drug: {
      duration: { battle: true, minutes: 120 }, effects: [skill(['composure'], 2), mod('decay', 1, 'meat'), stat('net_load_decay', 1)], side: [mod('initiative', -3), skill(['perform', 'seduce'], -2)],
      eases_withdrawal: true, addiction: withdrawal(3, 3, []),
    },
  }),
  // 專注劑（白板）：介面 +2、機械與義體學 +2；沉溺 +3（24 小時後退回：用暫時的下限）；藥效過後頭痛 4 小時，所有檢定 −1；成癮：智識的檢定 −2
  drug('drug_focus', '專注劑（白板）', {
    brand: '織女', grade: 2, size: 2, legal: 'permit', price: 90,
    drug: {
      duration: { minutes: 240 }, effects: [skill(['interface'], 2), skill(['mechanics', 'cyberware'], 2)], instant: [{ kind: 'sink_floor', amount: 3, days: 1 }],
      after: { minutes: 240, effects: [everyCheck(-1)] }, addiction: withdrawal(8, 5, [{ check: { attrs: ['intellect'] }, amount: -2 }]),
    },
  }),
  // 提神錠（黑咖）：先攻 +3；成癮：先攻 −3
  drug('drug_coffee', '提神錠（黑咖）', {
    brand: '織女', grade: 1, size: 2, legal: 'free', price: 25,
    drug: { duration: { minutes: 240 }, effects: [mod('initiative', 3)], addiction: withdrawal(4, 3, [mod('initiative', -3)]) },
  }),
  // 耐受劑「犰狳」：耐受 +20（感載上限 +10 跟著來）；慾求 +10；成癮：耐受 −10
  drug('drug_armadillo', '耐受劑「犰狳」', {
    brand: '蜜腺', grade: 2, size: 2, legal: 'free', price: 100,
    drug: { duration: { battle: true, minutes: 120 }, effects: [stat('bridge_tolerance', 20)], side: [stat('bridge_craving', 10)], addiction: withdrawal(6, 5, [stat('bridge_tolerance', -10)]) },
  }),
  // M3 抗暈錠（飛官糖）：同步 +2、耐受 +10；交涉與表演 −2；成癮：同步 −2
  drug('drug_m3', 'M3 抗暈錠（飛官糖）', {
    brand: '星旗', grade: 2, size: 2, legal: 'free', price: 90,
    drug: { duration: { battle: true }, effects: [skill(['sync'], 2), stat('bridge_tolerance', 10)], side: [skill(['negotiate', 'perform'], -2)], addiction: withdrawal(5, 5, [skill(['sync'], -2)]) },
  }),
  // M7 戰鬥配方（紅線）：命中 +1、迴避 +1；感載上限 −4、沉溺 +1 不退；成癮：定力 −2
  drug('drug_m7', 'M7 戰鬥配方（紅線）', {
    brand: '星旗', grade: 3, size: 3, legal: 'banned', price: 290,
    drug: { duration: { battle: true }, effects: [mod('hit', 1), mod('evade', 1)], side: [stat('load_cap', -4)], instant: [{ kind: 'sink', amount: 1 }], addiction: withdrawal(20, 7, [skill(['composure'], -2)]) },
  }),
  // 速效興奮劑「搶拍」：先攻 +3；感載上限 −4；成癮：先攻 −3（「第一回合行動點從上限 +1 開始」寫不出來，見 DRUG_GAPS）
  drug('drug_snap', '速效興奮劑「搶拍」', {
    brand: '鉻娘子改', grade: 3, size: 3, legal: 'banned', price: 320,
    drug: { duration: { battle: true }, effects: [mod('initiative', 3)], side: [stat('load_cap', -4)], addiction: withdrawal(12, 5, [mod('initiative', -3)]) },
  }),
  // 興奮劑（快板）：每回合回復的行動點 +1（算在全身 +1 裡）、先攻 +3；每回合感載 +3；成癮：每回合回復的行動點 −1、先攻 −3
  drug('drug_allegro', '興奮劑（快板）', {
    brand: '鉻娘子改', grade: 4, size: 4, legal: 'banned', price: 1200,
    drug: { duration: { battle: true }, effects: [mod('ap_regen', 1), mod('initiative', 3)], upkeep_load: 3, addiction: withdrawal(15, 5, [mod('ap_regen', -1), mod('initiative', -3)]) },
  }),
  // 「火花」：每回合感載 +2；成癮：慾求 +10、定力 −1（「多半顆骰」寫不出來）
  drug('drug_spark', '「火花」', {
    brand: '鉻娘子改', grade: 2, size: 2, legal: 'banned', price: 100,
    drug: { duration: { battle: true }, upkeep_load: 2, addiction: withdrawal(10, 5, [stat('bridge_craving', 10), skill(['composure'], -1)]) },
  }),
  // 鏽水：威嚇 +2；交涉、誘惑、表演 −2；成癮：定力 −1（「面對恐懼與威嚇時定力 +2」「隔天宿醉」寫不出來）
  drug('drug_rust', '鏽水', {
    brand: '無牌', grade: 1, size: 2, legal: 'banned', price: 25,
    drug: { duration: { minutes: 120 }, effects: [skill(['intimidate'], 2)], side: [skill(['negotiate', 'seduce', 'perform'], -2)], addiction: withdrawal(5, 3, [skill(['composure'], -1)]) },
  }),
  // 感官藥劑（甜水）：感知類 +2；敏感度 +10；成癮：感知類 −2
  drug('drug_sweet', '感官藥劑（甜水）', {
    brand: '無牌', grade: 1, size: 1, legal: 'banned', price: 25,
    drug: { duration: { minutes: 120 }, effects: [perception(2)], side: [stat('bridge_sensitivity', 10)], addiction: withdrawal(8, 3, [perception(-2)]) },
  }),
  // 催情劑（蜜）：慾求 +20；受到的感載 ×1.25；成癮：慾求 +15、自然消退 −1（「自然消退減半」寫不出來）
  drug('drug_honey', '催情劑（蜜）', {
    brand: '伊甸園', grade: 2, size: 2, legal: 'banned', price: 130,
    drug: { duration: { minutes: 120 }, effects: [stat('bridge_craving', 20)], side: [mod('load_taken_pct', 25)], addiction: withdrawal(10, 5, [stat('bridge_craving', 15), mod('decay', -1, 'meat'), stat('net_load_decay', -1)]) },
  }),
  // 「軟糖」：慾求 +10；成癮：慾求 +5
  drug('drug_gummy', '「軟糖」', {
    brand: '伊甸園', grade: 1, size: 1, legal: 'free', price: 40,
    drug: { duration: { minutes: 120 }, effects: [stat('bridge_craving', 10)], addiction: withdrawal(3, 3, [stat('bridge_craving', 5)]) },
  }),
  // 「焦糖」：表演 +2、誘惑 +2；馴化 +10；成癮：表演與誘惑 −2
  drug('drug_caramel', '「焦糖」', {
    brand: '伊甸園', grade: 2, size: 2, legal: 'register', price: 130,
    drug: { duration: { minutes: 240 }, effects: [skill(['perform', 'seduce'], 2)], side: [stat('bridge_docility', 10)], addiction: withdrawal(8, 5, [skill(['perform', 'seduce'], -2)]) },
  }),
  // 「夜櫻」：表演 +2、感載上限 +8；藥效結束時一次灌 8 點感載；成癮：表演 −2、感載上限 −4
  drug('drug_yozakura', '「夜櫻」', {
    brand: '緋櫻', grade: 3, size: 3, legal: 'permit', price: 480,
    drug: { duration: { minutes: 240 }, effects: [skill(['perform'], 2), stat('load_cap', 8)], after: { instant: [{ kind: 'load', amount: 8 }] }, addiction: withdrawal(12, 5, [skill(['perform'], -2), stat('load_cap', -4)]) },
  }),
  // 「八重」：命中 +1、迴避 +1、先攻 +3、要害的門檻降 2；藥效結束後 24 小時敏感度 +20；成癮：命中 −1、敏感度 +10
  drug('drug_yae', '「八重」', {
    brand: '緋櫻', grade: 4, size: 4, legal: 'banned', price: 1800,
    drug: {
      duration: { battle: true }, effects: [mod('hit', 1), mod('evade', 1), mod('initiative', 3), mod('crit_margin', -2)], after: { minutes: 1440, effects: [stat('bridge_sensitivity', 20)] },
      addiction: withdrawal(15, 7, [mod('hit', -1), stat('bridge_sensitivity', 10)]),
    },
  }),
  // 「方糖」：RAM 上限 +1；吃了一直哼同一首歌（怪癖）：隱匿 −2；成癮：RAM 上限 −1
  drug('drug_sugar', '「方糖」', {
    brand: '同人', grade: 1, size: 1, legal: 'free', price: 20,
    drug: { duration: { battle: true, minutes: 240 }, effects: [stat('ram_max', 1)], side: [skill(['stealth'], -2)], addiction: withdrawal(4, 3, [stat('ram_max', -1)]) },
  }),
  // 「喵喵錠」：身上有獸化改造的人，運動 +2（條件 cyber 的 tag: beast，設計圖的 tags 寫 beast）；成癮：交涉 −2
  drug('drug_nyan', '「喵喵錠」', {
    brand: '同人', grade: 1, size: 1, legal: 'free', price: 20,
    drug: { duration: { minutes: 240 }, effects: [{ ...skill(['athletics'], 2), if: [{ kind: 'cyber', tag: 'beast' }] }], addiction: withdrawal(3, 3, [skill(['negotiate'], -2)]) },
  }),
  // 牆灰（灰）：RAM 上限 +2、同步檔位上限 +1 級；沉溺 +3 不退；成癮：（「每天沉溺 +1」「10% 種下妖精的吻」寫不出來）
  drug('drug_ash', '牆灰（灰）', {
    brand: '聖堂', grade: 3, size: 4, legal: 'banned', price: 380,
    drug: { duration: { battle: true, minutes: 60 }, effects: [stat('ram_max', 2), mod('sync_cap', 1)], instant: [{ kind: 'sink', amount: 3 }], addiction: withdrawal(25, 7, []) },
  }),
  // 「白澤」：每回合的 RAM 回復 +1（算在全身 +1 裡）、介面 +2；每回合感載 +2；成癮：RAM 上限 −1、介面 −2（「在崑崙的子網裡追蹤度 +10 起跳」寫不出來）
  drug('drug_baize', '「白澤」', {
    brand: '崑崙', grade: 4, size: 4, legal: 'banned', price: 1320,
    drug: { duration: { battle: true }, effects: [mod('ram_regen', 1), skill(['interface'], 2)], upkeep_load: 2, addiction: withdrawal(15, 5, [stat('ram_max', -1), skill(['interface'], -2)]) },
  }),
  // 「靜音」：橋的防火牆 +2；成癮：防火牆 −1（「夜鶯的回報後門」寫不出來）
  drug('drug_mute', '「靜音」', {
    brand: '夜鶯', grade: 2, size: 2, legal: 'register', price: 130,
    drug: { duration: { battle: true }, effects: [stat('deck_firewall', 2)], addiction: withdrawal(5, 3, [stat('deck_firewall', -1)]) },
  }),
  // 「上鏡」：表演 +2；成癮：表演 −2
  drug('drug_onair', '「上鏡」', {
    brand: '萬華鏡', grade: 1, size: 1, legal: 'free', price: 35,
    drug: { duration: { minutes: 240 }, effects: [skill(['perform'], 2)], addiction: withdrawal(4, 3, [skill(['perform'], -2)]) },
  }),
  // 「蝶粉」：別人看到的沉溺低一段（一段是 20 點，features/sink 的 hide_step）、隱匿 +2；敏感度 +10；成癮：別人看到的沉溺高一段
  drug('drug_butterfly', '「蝶粉」', {
    brand: '蜜腺', grade: 2, size: 2, legal: 'register', price: 100,
    drug: { duration: { minutes: 240 }, effects: [stat('sink_shown', -20), skill(['stealth'], 2)], side: [stat('bridge_sensitivity', 10)], addiction: withdrawal(6, 3, [stat('sink_shown', 20)]) },
  }),
]

/**
 * ITEMS 4.2 節寫不出來的藥效（連同原因）：現在的藥格式（持續、被動效果、立即的效果、藥效過後）接不上的，留給內容階段或之後的功能。
 * 「寫了一半」的藥（上面的目錄只放得下的部分）也列在這裡：id 是上面目錄的 id，沒有目錄的是整種寫不出來。
 */
export const DRUG_GAPS: Array<{ drug: string; effect: string; why: string }> = [
  { drug: 'drug_cotton', effect: '生命值只看得到四段（滿、過半、不到一半、危險）', why: '顯示規則：生命值的呈現在介面，引擎沒有「模糊顯示」的狀態（M4-ui-body）' },
  { drug: 'drug_cotton_xl', effect: '重創（輕、重）的檢定懲罰都不算；藥效結束時那 5 點上限收回、多出來的生命值跟著扣掉', why: '重創的懲罰是 medical 的傷勢被動效果，沒有「忽略重創」的標籤；上限收回要在藥效結束那一刻改生命值（藥格式沒有「結束時」的鉤子，只有 after.instant）' },
  { drug: 'drug_calm', effect: '睡一覺的回復率 −10%（成癮的懲罰）', why: 'rest 的回復率沒有衍生數值或修正可以掛' },
  { drug: 'drug_focus', effect: '沉溺 +3「24 小時後退回」', why: '目錄用暫時的下限（sink_floor 效果，days: 1）近似；它不會把沉溺自己減回去（ITEMS：加在目前的沉溺上、時間到減回去）' },
  { drug: 'drug_coffee', effect: '解除「疲勞」；下一次睡一覺的回復率 −10%', why: '沒有「疲勞」這個狀況；回復率同上' },
  { drug: 'drug_armadillo', effect: '慾求過 60 時戰鬥一開始就帶著感載；自然消退變慢', why: '慾求的消退與開戰感載是 lewd 的橋參數規則，沒有掛點' },
  { drug: 'drug_m7', effect: '不受連射的壓制；每天一次衝動事件', why: '壓制免疫沒有標籤；衝動事件是導演的事（事件資料）' },
  { drug: 'drug_snap', effect: '第一回合的行動點從上限 +1 開始（不佔全身 +1 的額度）', why: '戰鬥開始時的行動點不是修正；ap_regen 受全身 +1 管（M4-drugs 回報）' },
  { drug: 'drug_allegro', effect: '藥效過後疲勞：所有檢定 −1，到喘口氣為止', why: 'after.effects 一定要寫 minutes，沒有「到喘口氣為止」' },
  { drug: 'drug_spark', effect: '你造成的神經與快感傷害多半顆骰；帶著餘韻時再多半顆', why: '傷害骰的「半顆」沒有修正種類' },
  { drug: 'drug_rust', effect: '面對恐懼與威嚇時定力 +2；隔天第一個時段宿醉，所有檢定 −1', why: '沒有「恐懼與威嚇」的檢定標籤；「隔天第一個時段」不是持續時間' },
  { drug: 'drug_honey', effect: '感載的自然消退減半', why: '消退只能加減點數，沒有「減半」' },
  { drug: 'drug_ash', effect: '10% 被種下妖精的吻；成癮：每天沉溺 +1', why: '藥的立即效果沒有機率；成癮的懲罰是被動效果，沒有「每天」的週期' },
  { drug: 'drug_baize', effect: '在崑崙的子網裡追蹤度從 +10 開始', why: '追蹤度起跳是義體設計圖的 trace_mod，藥沒有掛' },
  { drug: 'drug_mute', effect: '夜鶯的回報後門：在夜鶯的子網裡追蹤度從 +10 開始', why: '同上' },
  { drug: 'drug_nyan', effect: '怪癖：說話帶尾音，情緒藏不住', why: '敘事，不是數字' },
  { drug: 'drug_sugar', effect: '怪癖：一直哼同一首動畫歌', why: '敘事；隱匿 −2 已寫' },
  { drug: 'it_listen', effect: '「諦聽」：打給失去回合或被制伏的人，他的定力 −4（審問用）；被打的人沉溺 +1、成癮 +5', why: '藥格式只有「自己吃」，沒有對別人用' },
  { drug: 'it_lotus', effect: '「睡蓮」：下在飲料裡，對方定力 DC 16，失敗就睡兩個小時；對方宿醉；成癮 +2', why: '同上（對別人用、檢定、睡著）' },
  { drug: 'it_allnight', effect: '「通宵 MAX」：輿論戰每回合編輯點 +1、開場手牌 +1', why: '輿論戰是 M5' },
]
