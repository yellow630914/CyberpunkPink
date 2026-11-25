// M0 的規則數值包（工單 dev/work/M0-data.md）。JSON 不能寫註解，所以每一種資料的出處寫在 SOURCES。
// 內容類（world/ 的勢力、NPC、敵人、遭遇、戰敗事件、地圖；rules/ 的技能、路數、道具）是暫定示意資料（docs/plan/PLAN.md 第 1 節）：
// 只給測試與冒煙用，不在這裡修文字；潤色之後經世界編輯器的匯入路徑整批換掉。不要再往這裡加新的內容。
import type { ContentPack } from '../src'
import attributes from './rules/attributes.json'
import skills from './rules/skills.json'
import perks from './rules/perks.json'
import origins from './rules/origins.json'
import creation from './rules/creation.json'
import effectCaps from './rules/effect_caps.json'
import actions from './rules/actions.json'
import battleModes from './rules/battle_modes.json'
import damageTypes from './rules/damage_types.json'
import battleStatuses from './rules/battle_statuses.json'
import weaponClasses from './rules/weapon_classes.json'
import items from './rules/items.json'
import paths from './rules/paths.json'
import abilities from './rules/abilities.json'
import eventRules from './rules/event_rules.json'
import eventScopes from './rules/event_scopes.json'
import securityRules from './rules/security_rules.json'
import commissionRules from './rules/commission_rules.json'
import fixerRules from './rules/fixer_rules.json'
import tradeRules from './rules/trade_rules.json'
import shopTypes from './rules/shop_types.json'
import billRules from './rules/bill_rules.json'
import restRules from './rules/rest_rules.json'
import workRules from './rules/work_rules.json'
import sceneRules from './rules/scene_rules.json'
import lewdRules from './rules/lewd_rules.json'
import npcInteractRules from './rules/npc_interact_rules.json'
import rosterRules from './rules/roster_rules.json'
import favorRules from './rules/favor_rules.json'
import npcRules from './rules/npc_rules.json'
import npcLifeRules from './rules/npc_life_rules.json'
import transitRules from './rules/transit_rules.json'
import abilityRules from './rules/ability_rules.json'
import facilityTypes from './rules/facility_types.json'
import scanLevels from './rules/scan_levels.json'
import syncRules from './rules/sync_rules.json'
import deckRules from './rules/deck_rules.json'
import netcombatRules from './rules/netcombat_rules.json'
import netrunRules from './rules/netrun_rules.json'
import netRegions from './rules/net_regions.json'
import netFacilities from './rules/net_facilities.json'
import netEnemyRules from './rules/net_enemy_rules.json'
import mazeRules from './rules/maze_rules.json'
import mazeTables from './rules/maze_tables.json'
import maps from './world/maps.json'
import factions from './world/factions.json'
import npcs from './world/npcs.json'
import enemies from './world/enemies.json'
import encounters from './world/encounters.json'
import defeatEvents from './world/defeat_events.json'

/** 還沒有任何功能收的規則表（沒有內容種類，接進 CORE_PACK 會載入失敗）：只放檔案，等有功能認得再接。 */
export const UNWIRED: Record<string, unknown[]> = { scan_level: scanLevels }

export const CORE_PACK: ContentPack = {
  id: 'core',
  content: {
    attribute: attributes, skill: skills, perk: perks, faction: factions, npc: npcs, origin: origins, creation_rule: creation, effect_cap: effectCaps, action_kind: actions,
    battle_mode: battleModes, damage_type: damageTypes, battle_status: battleStatuses, weapon_class: weaponClasses, item: items, special_map: maps,
    enemy: enemies, encounter: encounters, defeat_event: defeatEvents,
    path: paths, ability: abilities,
    // M2 的規則表（dev/work/M2-data-rules.md）：只有數字與種類表，不含內容；每一張的數字等於那個功能匯出的 DEFAULT_…
    event_rule: eventRules, event_scope: eventScopes, security_rule: securityRules, commission_rule: commissionRules, fixer_rule: fixerRules,
    trade_rule: tradeRules, shop_type: shopTypes, bill_rule: billRules, rest_rule: restRules, work_rule: workRules, scene_rule: sceneRules,
    lewd_rule: lewdRules, npc_interact_rule: npcInteractRules, roster_rule: rosterRules, favor_rule: favorRules, npc_rule: npcRules,
    npc_life_rule: npcLifeRules, transit_rule: transitRules, ability_rule: abilityRules, facility_type: facilityTypes,
    // M3 的規則表（dev/work/M3-data-rules.md）：只有數字與種類表；每一張的數字等於那個功能匯出的 DEFAULT_…，全部標暫定（見 PROVISIONAL_M3）
    sync_rule: syncRules, deck_rule: deckRules, netcombat_rule: netcombatRules, netrun_rule: netrunRules, net_region: netRegions, net_facility: netFacilities,
    net_enemy_rule: netEnemyRules, maze_rule: mazeRules, maze_table: mazeTables,
  },
}

/** 每一種資料的出處（文件與節） */
export const SOURCES: Record<string, string> = {
  attribute: 'CORE_RULES 第 1 節；DATA 第 1 節（id）',
  skill: 'CORE_RULES 第 2 節；英文 id 照 DATA 1.1 節',
  perk: 'CHARACTER 第 4、5.2、5.3、6 節（smooth_talker 在第 6 節）；其餘 provisional 的借自 ui/src/data/creation.ts 的 TRAITS 與 ORIGINS[].trait（dev/adr/0004 第 5 項）',
  origin: 'CHARACTER 第 2 節；勢力與 NPC 用 DATA 1.1 節 id 表的 id（好感的勢力引用 faction、名冊引用 npc）',
  faction: 'DATA 1.1 節的勢力表（id 照 FACTIONS 第 1 節；全名、短名、類）',
  npc: 'DATA 1.1 節的具名 NPC 表與流竄 AI 表（只有 id 與名字；流竄 AI 標 rogue_ai 與原本的產品名）。完整的 NPC 格式（DATA 第 8 節）在 M2 補',
  creation_rule: 'CHARACTER 第 5.1、5.3、5.4、5.6 節',
  effect_cap: 'EVENTS 第 2.4 節 cred、cash 那一列',
  action_kind: 'AI_TASKS 3.1 節的行動種類表（殺價、打工、日常直播等那三個系統搬進來再加）',
  battle_mode: 'COMBAT_SYSTEM 第 1.2、2.1、2.5、3、4、5、6、7 節；ENEMIES 1.5 節（位階的傷害倍率）；現實與內海兩筆（內海 net 照 CYBERSPACE 6.1 節的對照表與核心的預設，逐欄相同，M3-data-rules）。aiMaxSteps、decayBase、pierceOverflow 的出處見 dev/adr/0013',
  damage_type: 'COMBAT_SYSTEM 第 5 節「傷害類型」的表',
  battle_status: 'COMBAT_SYSTEM 第 5 節（壓制）、第 6 節（重創輕的一級）、第 5 節傷害類型（燃燒、失效）、第 7 節（失去回合）、標記的 +2 見 COMBAT_SYSTEM 9.1 節（偵察型）與 ITEMS 5.2 節（紙鶴），期限（到標記者的下一回合開始前）取工單；EVENTS 2.4.1 節（被壓住）；M1b-data-rules（dev/work/M1b-data-rules.md）：SKILL_TREES 改造師「拆解」「超頻」兩列（off_*、boost_*）、ITEMS 5.1 節電磁彈與 5.2 節閃光彈、一次性偵察機紙鶴（ap_minus_1、see_dark）、COMBAT_SYSTEM 2.5 節黑暗（see_dark）、dev/adr/0015 第二、三節（untargeted 與修正種類）；M3-data-rules：CYBERSPACE 6.2 節（閃斷）、6.5 節（干擾三類停用 jam_*）、SKILL_TREES 名媛／掮客／主播／偶像（focused 被集火、pacified 安撫、drowsy 誘惑）',
  weapon_class: 'COMBAT_SYSTEM 第 5 節的武器表；範圍寫法（神經武器骰數、彈匣、重武器）取驗收測試的值',
  item: 'ITEMS 5.2 節的消耗品表與日用品表（束帶、鎖橋器、急救凝膠、冷卻劑、止血針、醒腦針、煙霧彈 I～II）；size 0 照 EQUIPMENT 6.1 節',
  enemy: 'ENEMY_ROSTER 第一到第五部分（現實的制式兵種）；ENEMIES 1.5、1.6 節',
  encounter: 'dev/work/M1-data-enemies.md（基準，M2 換成委託模板與二十九種戰敗事件）',
  defeat_event: 'dev/work/M1-data-enemies.md（基準，M2 換成委託模板與二十九種戰敗事件）',
  path: 'SKILL_TREES 槍手、掮客；SKILLS 1.3、1.9、1.10 節',
  ability: 'SKILL_TREES 槍手、掮客；SKILLS 1.3、1.9、1.10 節',
  special_map: 'DATA 9.3 節（小辦公室樣本）、COMMISSION_MAPS 第 1、2 節（小辦公室）與第 8 節、1.6 節樣本（俱樂部）；C 的 cells 照第 2、8 節的控制區表補',
  // ---- M2 的規則表（dev/work/M2-data-rules.md）----
  event_rule: 'EVENTS 3.4 節（每回合一件擋住的加兩則通知；城裡每天 8 件）、3.5 節（最近 6 件、×0.35）、第 7 節（設定的樣子）',
  event_scope: 'EVENTS 3.3 節的表（機率、冷卻、不重複、每天上限）、3.4 節（優先序、延後 6 小時）、第 7 節的樣本（street、transit、contract、mascot 的欄位）；3.3 節的十種範圍加 transit（4.10 節）。登入與登出的觸發點名字、壓力條 15%、「每個階段最多一件」、契約與成人事件與流竄 AI 的機率設計書沒有單一數字，沒寫（見回報）',
  security_rule: 'FACTIONS 5.1 節（好感五段）、6.1 節（敵對值六段）、6.3 節（每週 −5、沒有新的 −10、收買每點 50、一次最多 −20）；found_banned、found_permit、caught_hostility 設計書沒寫數字（暫定）；dev/adr/0016 G17（fake_dc_*：暫定）',
  scan_level: 'EQUIPMENT 6.3 節「掃描的強度」表（0～3 四級）。沒有功能收這一種（掃描強度是 scan 活動的輸入，說明文字寫在 security 的程式裡），所以只放在 UNWIRED，不接進 CORE_PACK',
  commission_rule: 'COMMISSIONS 2.3 節（小 20、中 35、大 60 點）、6.2 節（每階段 2 小時）、6.4 節（DC 10 ＋ 等級 × 2、失敗壓力 +10、強 +4／中 +2／弱 0、撤一個階段）、第 8 節與 FACTIONS 6.2 節（路線的敵對值 +5～15）；ENEMIES 第 13 節（遭遇組合：一般 4 點＝四個雜兵、首領戰 8 點＝一個首領加三個雜兵；I 級沒有首領：兩個精英加兩個雜兵）、COMMISSION_TEMPLATES（報酬範圍＝基準 × 小 0.6 到大 1.8）；dev/adr/0016 G2、G9、G16（暫定）。生成的三個欄位（reward_range、scales_by_tier、encounters）和 commission 的欄位在同一筆。M3 加內海的八個欄位（net_alert、net_alert_at、net_hostility_step、net_hostility_max、net_located_hostility、net_watchers、net_watcher_hostility、rating_trace_peak）：COMMISSIONS 與 CYBERSPACE 6.8 節、NETRUNNING 第 5 節、FACTIONS 6.1 節；數字取 DEFAULT_NET_RULES（暫定，見 PROVISIONAL_M3）',
  fixer_rule: 'FIXER 第 2 節（付法：全額、85%、70%；踩點一個時段 4 小時、第 4 次起 +1）、LIFE 1.1 節（匯進帳戶敵對值 +2）、COMMISSIONS 6.5 節（借人出場費 ×1.5）、NPC_SYSTEM 10.5 節（分紅）；dev/adr/0016 G16、G18（暫定）。M3 加三個內海欄位（trace_start、net_layers、net_branch_skills）：NETRUNNING 第 5 節（起始值 15／30）、COMMISSIONS 內海階段的層、dev/adr/0018 N16；取 DEFAULT_FIXER_NET_RULES（暫定）',
  trade_rule: 'TRADE 3.2 節（收購 40%、區倍率 ×0.25、遞減 3%／50%／5 件）、4.1 節（十三個貿易類別）、4.2 節（行情夾 0.5～2.5）、4.3 節（貨物 90%）、第 5 節（殺價 DC 13、親密度 ÷25、結果表）、第 9 節（好感折扣、親密度 0.2%、敵對值加價、上限 30%）、第 2 節最後一條（上架件數）',
  shop_type: 'TRADE 第 2 節的表（只寫了每一格都有寫的四種：市場攤販、原廠直營、骨場、冷庫；其餘見回報）；店家倍率與店的脾氣照 3.2 節、第 5 節。賣與收的物品類別是照詞義對到 item 的類別（暫定）',
  bill_rule: 'DOWNTIME 5.1 節（利息第 5 項：胭脂堂收現金、伊甸園扣帳戶；新項目第 7 項）、5.2 節（第 3 週併成債、伊甸園敵對值 +10）；EVENTS 2.4 節（寬限 7 天、一半）；週利率 5% 設計書沒寫（暫定）',
  rest_rule: 'DOWNTIME 2.1 節（回 2 ＋ 體格、最少 1、前兩次）、2.2 節（16 小時、一半）、2.3 節（露宿 10%、自己的據點一級 55%、二三級 60%）、7.2 節（押金、鎖）、5.1 節（房租第 1 項）',
  work_rule: 'DOWNTIME 4.1 節（2、4、8 小時）、4.2 節（成功程度 1.5、1、0.5、0；大失敗 −3）；階段的倍率 1、1.5、2.5 是每份工作的 stages[].mult（4.1a 節），不在這張規則表',
  scene_rule: 'LEWD_SYSTEM 3.5 節（主動權、行動表、契合、評價表、體悟）；數字沒寫死的照 dev/adr/0016 G6、G11（暫定）',
  lewd_rule: 'CORE_RULES 4.2 節（耐受每 40 點）、LEWD_SYSTEM 第 1 節（慾求 60）；dev/adr/0016 G10、G14（暫定）；band_size、gear_cap、over_scale、axis_* 取自 ElondiaRPG 的做法與 M2-lewd 工單（暫定）',
  npc_interact_rule: 'NPC_SYSTEM 6.1 節（選單）、6.2 節（基準 DC 與修正）、6.3 節（送禮與偷竊）、6.4 節（讀橋：防護階街坊 0、行者 1、職員 2、帶旗標 manager 或 guard 的企業主管與保全 3）；設計書沒寫的數字（財富倍率中間的值、偷到的錢、大成功的親密度）暫定',
  roster_rule: 'NPC_SYSTEM 10.0（隊伍 4、同行 2）、10.2 節（招募 DC 16）、10.4 節（忠誠）、10.5 節（出場費）、10.7 節（起始忠誠）；FIXER 第 6 節（名冊容量）',
  favor_rule: 'TRADE 4.4 節（小 300、中 1,500）、FIXER 第 8 節（拒絕被討：信譽大跌，數字沒寫：暫定 −3）',
  npc_rule: 'NPC_SYSTEM 第 3、4 節（名單與生成）；數字沒寫的暫定',
  npc_life_rule: 'NPC_SYSTEM 3.2 節（每 3 天 25%）、第 8、9 節（共同記憶、NPC 自己的日子）；數字沒寫的暫定',
  transit_rule: 'DISTRICTS 1.2.1 節（浮空計程車起跳 25、每公里 4、10 分鐘；暫定值）',
  ability_rule: 'dev/adr/0016 G1（換配置半小時：暫定）；SKILLS 1.7 節；CORE_RULES 7.1 節（留家三成）；使用者定案 2026-11-23（M2-plan）',
  facility_type: 'SITES 第 16 節的設施總表（功能的說法對到 DATA 第 12 節的 functions）、DOWNTIME 2.3 節（睡處 sleep：潛艙店 20%、旅館 25%、診所病床 60%）；營業時段、districts、shop、jobs、train 沒有轉寫（見回報）',
  // ---- M3 的規則表（dev/work/M3-data-rules.md）；數字照設計書與各功能內建的預設，全部暫定（dev/adr/0018 第十四節 N1～N35） ----
  sync_rule: 'CORE_RULES 第 5 節、CYBERSPACE 6.4 節（四檔：−2／×0.5、0／×1、+2／×1.5、+4／×2.5；深檔要同步 3 級與敏感度 40、全檔 5 級與 70，數字取核心預設）；沉溺 60 以上上限 +1 級（CORE_RULES 4.3 節）',
  deck_rule: 'ITEMS 11.1 節（構裝等級的加值：II +1 命中、III 再多 1 顆骰、IV +2 與多 2 顆）、5.2 節（腳本最多「甲板等級 ＋1」支）、NETRUNNING 第 1 節（RAM 回復 2）；換裝 1 分鐘、V 級照 IV 暫定；cap_construct_grade 照使用者 2026-11-24 定案（照甲板）',
  netcombat_rule: 'CYBERSPACE 6.3 節（回填 +2 RAM）、6.5 節（干擾打牆 ×2）、6.6 節（管理行動七種）、6.8 節（戰鬥每回合追蹤度 +3、管理行動 +1、失敗 +5、白蕾絲 +5、門檻 30／60／90、定位後 3 回合）、6.7 節（倒下後 60 分鐘不能再潛入）、6.5 節（重創的構裝付錢修：構裝價的 10%，M3 白箱修正批）；各行動的行動點、換檔次數、換檔分界 0.6、管理行動的 RAM 與數字取功能預設（暫定）',
  netrun_rule: 'CYBERSPACE 8.1 節（探索回合感載消退 2、巡邏每 3 個節點走一步、下載 2～4 回合）、8.3 節（追蹤度在子網：警報 +10、下載每回合 +2、管理行動 +1／失敗 +5、30 起閘門 DC +2、巡邏 +1；七天內再進去一半起算、被定位多一個雜兵、後門一半機率清掉）、ENEMIES 第 13 節（遭遇 4／6／8 點）、BALANCE 2.1 節（等級倍率 1、1.22、1.49、1.82、2.22）；其餘取功能預設（暫定）',
  net_region: 'CYBERSPACE 8.1 節（每一層的密度表、DC 照等級、壓力條表）、8.2 節（迷宮館 9×7、18～24、機關 1）、8.3 節（一般子網 11×9、30～40、遭遇 2～3）、8.5 節（沉船帶）、8.6 節（深海）。subnet 與 maze 兩筆等於功能的預設；wreck 與 deep 只照密度表與壓力條寫（程式現在還沒有人讀，sight、cover 沒寫）',
  net_facility: 'CYBERSPACE 8.3 節「設施類型」d6 表的層與隔離區（機房 III 級以上）。每層控制節點的個數設計書只寫了種類沒寫數量，沒有寫 controls；控制節點的種類與檔案庫的偏向是內容，不在這裡。id 的數字前綴是 d6 的點數（自己去挖擲設施類型時照 id 排序取）',
  net_enemy_rule: 'ENEMIES 第 9 節（憑證）；憑證是哪一件物品是內容，這裡只放空的 default，等內容匯入再補 credential_item',
  maze_rule: 'CYBERSPACE 8.2 節（報名三組與押金獎金、三層與標準回合數 12／15／10、評價 S1.5／A1.2／B1／C0.7、機關失敗感載 +8、寶箱怪一成、籌碼 C$10、休息點感載 −10、最多四人）；評價的回合比例與倒下人數、解機關的辦法與守閘門的組合取功能預設（暫定）',
  maze_table: 'CYBERSPACE 8.2 節「寶箱」與「獎品表」d6：只寫得出籌碼與「再擲獎品表」的列（籌碼 3～8、10～15、30 枚）；要物品、構裝、SKIN 的列是內容，沒寫，所以權重只是示意（暫定）',
}

/** 每一種資料裡「設計書沒有寫死、暫定」的欄位（dev/adr/0016 第八節與各功能的註解）。 */
export const PROVISIONAL: Record<string, string[]> = {
  security_rule: ['found_banned', 'found_permit', 'caught_hostility', 'fake_dc_base', 'fake_dc_per_strength', 'fake_recorded_bonus'],
  commission_rule: ['stage_minutes', 'stealth_fail_alert', 'check_fail_alert', 'reinforce_count', 'hard_alert', 'hard_grade_up', 'aux_injured_days', 'aux_skills', 'rating_links', 'rating_alert', 'rating_peak', 'scales_by_tier'],
  fixer_rule: ['haggle_dc_base', 'haggle_success', 'haggle_critical', 'rating_bonus', 'rep_same', 'rep_higher', 'rep_lower', 'rep_top', 'rep_failed', 'rep_abandon', 'rep_abandon_early', 'bond_dc_base', 'bond_affinity_step', 'bond_loyalty', 'trip_affinity', 'trip_loyalty'],
  trade_rule: ['dirty_hostility', 'list_size'],
  bill_rule: ['debt_rate'],
  scene_rule: ['bands', 'skip', 'skip_goal', 'goal_done_at', 'goal_stall_per_round', 'goal_please_per_climax', 'partner_weights'],
  lewd_rule: ['craving_divisor', 'fame_step', 'fame_penalty', 'default_bridge', 'band_size', 'gear_cap', 'over_scale', 'axis_max', 'axis_threshold'],
  npc_interact_rule: ['gift.wealth_mult', 'gift.critical', 'seduce.critical', 'steal.cash'],
  favor_rule: ['refuse_rep'],
  roster_rule: ['recruit_think_margin', 'reliability_min', 'reliability_max'],
  ability_rule: ['loadout_minutes'],
  transit_rule: ['taxi_base', 'taxi_per_km', 'taxi_minutes'],
  shop_type: ['catalog', 'buys'],
  facility_type: ['sleep.cost（旅館 20～40 取下限）'],
}

/**
 * M3 規則表裡暫定的格子（dev/work/M3-data-rules.md）：M3 的每一張規則表數字都是功能內建的預設，設計書沒有逐格寫死，一律暫定（平衡在另一個工作階段做）；
 * 這裡只列「設計書完全沒寫、或功能自己挑的」欄位。鍵是種類，或「種類/id」（net_region 沒有 default）。
 */
export const PROVISIONAL_M3: Record<string, string[]> = {
  sync_rule: ['sink_bonus_at', 'gears.deep.need_sensitivity', 'gears.full.need_sensitivity'],
  deck_rule: ['swap_minutes', 'cap_construct_grade', 'grade_bonus.5'],
  netcombat_rule: ['ap', 'sync_shifts', 'shift_split', 'admin_full', 'burn_minutes', 'admin'],
  netrun_rule: ['gate_t1_dc', 'unpinned_rounds', 'sneak_skills', 'encounter', 'download_turns', 'plant_turns', 'wipe', 'patrol', 'patrol_route', 'patrol_t1', 'lose_max', 'master_path', 'talk_skills', 'admin_skills', 'hack_skills',
    'round_minutes', 'keep_days', 'revisit_trace', 'located_foe_plus', 'leave_hostility', 'leave_hostility_max', 'located_hostility', 'backdoor_clear', 'dig_archive_plus'],
  'net_region/subnet': ['sight', 'cover', 'commission'],
  'net_region/maze': ['sight', 'cover', 'trap'],
  'net_region/wreck': ['size', 'carve', 'layer.safe', 'pressure'],
  'net_region/deep': ['size', 'carve', 'layer.safe', 'layer.trap', 'pressure'],
  net_facility: ['controls'],
  maze_rule: ['rating', 'solve', 'mimic_foes', 'brackets.rookie.guard', 'brackets.open.guard', 'load_mult'],
  maze_table: ['mzt_chest', 'mzt_prize'],
  commission_rule: ['net_alert', 'net_alert_at', 'net_hostility_step', 'net_hostility_max', 'net_located_hostility', 'net_watchers', 'net_watcher_hostility', 'rating_trace_peak'],
  fixer_rule: ['trace_start', 'net_layers', 'net_branch_skills'],
  battle_status: ['jam_weapon', 'jam_defense', 'jam_tool', 'focused', 'pacified', 'drowsy'],
}
