/**
 * 顯示用的名字表：戰鬥修正（被動效果的 { mod }）與衍生數值、成品數值鍵（{ stat }、成品 stats）的中文名。
 * 純對照，不含規則。畫面（身體、組裝、零件）一律問這裡，不自己維護一份（M4 收尾修正批；ui 的 bodyView、craftView 拿掉自己的表）。
 * 沒有名字的鍵回傳鍵本身。功能自己認的修正（abilities 的 FEATURE_MOD_KINDS）不在這張表裡，畫面用鍵本身。
 */

/** 戰鬥修正（MOD_KINDS）的名字：每一個核心認得的 mod 都有；tests/core/names.test.ts 對照 MOD_KINDS 擋住漏的。 */
export const MOD_NAMES: Readonly<Record<string, string>> = {
  hit: '命中', hit_against: '被命中', evade: '迴避', dice: '傷害骰', damage: '傷害', pierce: '穿甲', armor: '護甲', crit_margin: '要害門檻', save: '豁免', initiative: '先攻',
  ap_regen: '行動點回復', ram_regen: 'RAM 回復', load_dealt_pct: '造成的感載％', load_taken_pct: '受到的感載％', decay: '感載消退', move_ap: '換位行動點', action_ap: '行動點花費',
  action_ram: 'RAM 花費', heal_dealt: '造成的回復', vent_dealt: '造成的排感載', ai_target_pct: '被挑中的機率％', see_dark: '夜視', firewall: '防火牆', wound_grade: '重創級數',
  overlay_hp: '重疊物的耐久', overlay_armor: '重疊物的護甲', overlay_evade: '重疊物的迴避', overlay_cap: '重疊物的上限', overlay_backlash: '重疊物被擊落的反噬', cover_level: '遮蔽級數',
  admin_uses: '管理行動次數', refill: '回填', trace_round: '每回合追蹤度', trace_admin: '管理行動追蹤度', sync_cap: '同步檔位上限', sync_shifts: '換檔次數',
}

/** 衍生數值與成品數值鍵的名字（兩邊合在一張：armor、sink 這種兩邊都有的鍵意思一樣）。 */
export const STAT_NAMES: Readonly<Record<string, string>> = {
  // 衍生數值（k.stats）
  max_hp: '生命上限', armor: '護甲', load_cap: '感載上限', sink_floor: '沉溺的下限', ap_max: '行動點上限', ram_max: 'RAM 上限', ram_regen: 'RAM 回復', afterglow_cap: '承受層數',
  net_load_decay: '內海感載消退', cyber_count: '義體件數', bridge_sensitivity: '敏感度', bridge_tolerance: '耐受', bridge_craving: '慾求', bridge_docility: '馴化',
  bridge_cap_meat: '現實容量', bridge_cap_net: '內海容量', bridge_cap_social: '社交容量', bridge_cap_media: '媒體容量', surgery_sink_pct: '手術的沉溺成本％', carry_cap: '負重',
  hp_blur: '生命值顯示模糊',
  // 成品與零件的數值鍵
  damage: '傷害', hit: '命中', range_far: '遠射程', range_near: '近射程', sink: '沉溺', style: '風格', exposure: '曝露度', weight: '重量',
  mag: '彈匣', pierce: '穿透', conceal: '藏匿', evade: '迴避', capacity: '容量',
}

/** 戰鬥修正的名字（沒有的用鍵本身）。 */
export const modName = (id: string): string => MOD_NAMES[id] ?? id
/** 衍生數值或成品數值鍵的名字（沒有的用鍵本身）。 */
export const statName = (id: string): string => STAT_NAMES[id] ?? id
